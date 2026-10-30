/**
 * 成员存活对账（AC-18 的**反面目标**靠这里才可能成立）。
 *
 * 面板显示的成员状态如果只由 `task.status` 推导，那么「把成员进程杀掉」这件事
 * 在界面上永远不可见：任务还是 running，胶囊还是「运行中」，直到用户点开发现没动静。
 * 浏览器看不见的时候（面板没开）也必须对账，所以轮询在 host 侧，不在 client 侧。
 *
 * 宿主只有 4 个状态（running / provisioning / inactive / failed，或缺席），
 * 本项目有 7 个成员态；**映射只允许写在这一个文件里**（bridge.toMemberStatus 是展示层的映射，
 * 这里是持久层对任务的映射），组件里禁止再写第二张表。
 */
import type { RunState } from '../store.ts'
import type { RunsStore } from '../store.ts'
import type { PlanTask } from '../../shared/types.ts'
import { MAX_ATTEMPTS, WATCHER_INTERVAL_MS } from '../config.ts'
import { appendMessage, makeMessage } from './messages.ts'

/** 宿主成员行：只信任这三个字段，其余一律不读（宿主形状可能变，见 adapters）。 */
export interface HostMember {
  id: string
  name: string
  status: string
}

export interface WatcherDeps {
  store: RunsStore
  listMembers(): Promise<HostMember[]>
  now?(): number
  intervalMs?: number
  /** 对账发生变更时的回调（宿主装配层用它刷新快照/打点，不在这里硬编码）。 */
  onReconciled?(state: RunState): void
}

export interface ReconcileResult {
  state: RunState
  changed: number
}

export interface MemberWatcher {
  tick(): Promise<number>
  start(): void
  stop(): void
}

/**
 * 把宿主成员名单对账到任务状态：
 *  - 成员缺席 / inactive / failed → 任务 `interrupted`（attempts 用尽则 `failed`）；
 *  - 成员重新出现（running / provisioning）→ 中断态任务恢复 `running`；
 *  - 拿不到成员行（status 未知）→ **不动**：未知不等于死亡，误杀比漏报更伤。
 *
 * 只处理 running / gate / interrupted 三类任务：done / failed 是终态，rework 由回执链路负责。
 */
export function reconcileMembers(state: RunState, members: HostMember[], now?: number): ReconcileResult {
  const at = now ?? Date.now()
  let next = state
  let changed = 0

  for (const task of next.plan.tasks) {
    if (task.status !== 'running' && task.status !== 'gate' && task.status !== 'interrupted') continue

    const binding = next.bindings.find((item) => item.taskId === task.id && !item.retired)
    const member = binding
      ? members.find((row) => row.id === binding.memberId || row.name === binding.name)
      : undefined

    if (!member) {
      if (task.status === 'interrupted') continue
      const exhausted = (task.attempts ?? 0) >= MAX_ATTEMPTS
      next = patch(next, task.id, { status: exhausted ? 'failed' : 'interrupted' })
      next = appendMessage(
        next,
        makeMessage({
          from: 'captain',
          to: 'user',
          taskId: task.id,
          at,
          body: exhausted
            ? `成员「${binding?.name ?? task.roleId}」已失联且重试次数用尽（${task.attempts ?? 0}/${MAX_ATTEMPTS}）：任务「${task.title}」转人工。`
            : `成员「${binding?.name ?? task.roleId}」已失联：任务「${task.title}」标记为中断，可在面板点「恢复」重试。`,
        }),
      )
      changed += 1
      continue
    }

    const status = normalizeHostStatus(member.status)

    if (status === 'dead') {
      if (task.status === 'interrupted') continue
      const exhausted = (task.attempts ?? 0) >= MAX_ATTEMPTS
      next = patch(next, task.id, { status: exhausted ? 'failed' : 'interrupted' })
      next = appendMessage(
        next,
        makeMessage({
          from: 'captain',
          to: 'user',
          taskId: task.id,
          at,
          body: exhausted
            ? `成员「${member.name}」已退出（宿主状态 ${member.status}）且重试次数用尽：任务「${task.title}」转人工。`
            : `成员「${member.name}」已退出（宿主状态 ${member.status}）：任务「${task.title}」标记为中断。`,
        }),
      )
      changed += 1
      continue
    }

    if (status === 'alive' && task.status === 'interrupted') {
      // 成员回来了（宿主重启后按名字重绑成功等）：状态跟着事实走。
      next = patch(next, task.id, { status: 'running' })
      changed += 1
      continue
    }

    // alive 且任务本来就在跑，或 unknown：都不需要改状态。
  }

  return { state: next, changed }
}

/** 轮询器：一个 run 一次 listMembers（不是一任务一次），只在存在非终态任务时才查。 */
export function createMemberWatcher(deps: WatcherDeps): MemberWatcher {
  const now = deps.now ?? Date.now
  const intervalMs = deps.intervalMs ?? WATCHER_INTERVAL_MS
  let timer: ReturnType<typeof setInterval> | null = null
  let busy = false

  async function tick(): Promise<number> {
    if (busy) return 0
    busy = true
    try {
      const runs = deps.store.list()
      let members: HostMember[] | null = null
      let changed = 0

      for (const summary of runs) {
        const state = deps.store.load(summary.runId)
        if (!state) continue
        const active = state.plan.tasks.some(
          (task) => task.status === 'running' || task.status === 'gate' || task.status === 'interrupted',
        )
        if (!active) continue

        if (members === null) {
          try {
            members = await deps.listMembers()
          } catch {
            // 名单不可得：本轮什么都不改，等下一轮（宁可漏报一轮，也不误杀全部成员）。
            return changed
          }
        }

        const result = reconcileMembers(state, members, now())
        if (result.changed > 0) {
          deps.store.save(result.state)
          deps.onReconciled?.(result.state)
          changed += result.changed
        }
      }

      return changed
    } finally {
      busy = false
    }
  }

  return {
    tick,
    start() {
      if (timer !== null) return
      timer = setInterval(() => {
        void tick().catch(() => {
          /* 轮询异常不打断插件：下一轮继续 */
        })
      }, intervalMs)
      // 不让 watcher 拦住进程退出（宿主关闭时能立刻回收）。
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref()
    },
    stop() {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
  }
}

/** 宿主 4 态 → 本项目需要的三分法：alive / dead / unknown。 */
export function normalizeHostStatus(status: string | undefined): 'alive' | 'dead' | 'unknown' {
  const value = (status ?? '').trim().toLowerCase()
  if (value === 'running' || value === 'provisioning' || value === 'busy' || value === 'active') return 'alive'
  if (value === 'inactive' || value === 'failed' || value === 'stopped' || value === 'terminated') return 'dead'
  return 'unknown'
}

function patch(state: RunState, taskId: string, changes: Partial<PlanTask>): RunState {
  return {
    ...state,
    plan: {
      ...state.plan,
      tasks: state.plan.tasks.map((task) => (task.id === taskId ? { ...task, ...changes } : task)),
    },
  }
}
