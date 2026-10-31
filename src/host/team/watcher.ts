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
import { STALL_ALERTS_LIMIT } from '../store.ts'
import type { ActivityEvent, PlanTask } from '../../shared/types.ts'
import { MAX_ATTEMPTS, STALL_MS, WATCHER_INTERVAL_MS } from '../config.ts'
import { appendMessage, makeMessage } from './messages.ts'
import { clearAlerted, stallOf, stallSentence } from './stall.ts'

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
  /**
   * 停滞阈值（毫秒）。缺省取 `config.STALL_MS`；装配层显式传参便于演练/演练阈值，
   * 判定本身不读常量（AC-13：判定实现只有一个，阈值只做参数）。
   */
  stallMs?: number
  /** 对账发生变更时的回调（宿主装配层用它刷新快照/打点，不在这里硬编码）。 */
  onReconciled?(state: RunState): void
  /**
   * 每轮对账之后的 Trigger 轮询兜底（AC-18 / r5）。
   *
   * 挂在**既有的 1500ms tick** 上，不新增 `setInterval`（AC-20：定时器仍只有本文件一处）；
   * 判定口径在 `team/trigger-bus.ts`，这里只是「有节奏地叫它一次」，不做任何判定。
   * 抛错必须被吞掉：轮询失败不能打断成员存活对账（那会让「成员死了」永远报不出来）。
   */
  onPoll?(state: RunState): Promise<void>
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

/**
 * 停滞告警的**唯一判定出口**（AC-8）。
 *
 * 事件订阅（`adapters.onMemberProgress`）只负责 `touchProgress` 推进 `at`，从不产生告警；
 * 告警只在 watcher 的 tick 里、对着落盘状态算一次。这样「事件一条 + 轮询一条」的重复
 * 告警在结构上不可能发生 —— 不是靠纪律，是因为只有这一个地方会 push。
 *
 * 幂等：`progress[memberId].alertedAt` 存在即表示本 episode 已告警过；成员恢复产出后
 * `clearAlerted` 清掉标记，下一轮卡住才允许再响一次。
 *
 * @returns `state` 换了新引用即表示有变更（调用方据此决定是否 save）；未停滞时**不碰** plan，
 *          所以 `plan.tasks` 与入参深相等（AC-13）。
 */
export function stallAlertsOf(
  state: RunState,
  now: number,
  stallMs: number,
): { state: RunState; raised: ActivityEvent[] } {
  const raised: ActivityEvent[] = []
  let progress = state.progress ?? {}
  let mutated = false

  for (const task of state.plan.tasks) {
    // 终态任务不再产出，判它停滞只会制造假告警（成员 done 后本来就该安静）。
    if (task.status !== 'running') continue
    const binding = state.bindings.find((item) => !item.retired && item.taskId === task.id)
    if (!binding) continue
    const memberId = binding.memberId
    const record = progress[memberId]
    const judge = stallOf(record?.at, binding.spawnedAt, now, stallMs)

    if (!judge.stalled) {
      if (record?.alertedAt !== undefined) {
        progress = clearAlerted(progress, memberId)
        mutated = true
      }
      continue
    }

    if (record?.alertedAt !== undefined) continue // 本 episode 已告警：静默（一次 episode 一条）

    const at = record?.at ?? binding.spawnedAt
    progress = { ...progress, [memberId]: { at, alertedAt: now } }
    mutated = true
    raised.push({
      at: now,
      kind: 'tool',
      memberId,
      taskId: task.id,
      text: stallSentence(binding.name, judge.stalledForMs),
    })
  }

  if (raised.length === 0) return { state: mutated ? { ...state, progress } : state, raised }
  const stallAlerts = [...(state.stallAlerts ?? []), ...raised]
  return {
    state: {
      ...state,
      progress,
      stallAlerts: stallAlerts.length > STALL_ALERTS_LIMIT ? stallAlerts.slice(-STALL_ALERTS_LIMIT) : stallAlerts,
    },
    raised,
  }
}

/** 轮询器：一个 run 一次 listMembers（不是一任务一次），只在存在非终态任务时才查。 */
export function createMemberWatcher(deps: WatcherDeps): MemberWatcher {
  const now = deps.now ?? Date.now
  const intervalMs = deps.intervalMs ?? WATCHER_INTERVAL_MS
  const stallMs = deps.stallMs ?? STALL_MS
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

        // 顺序固定：先对账存活，再判停滞（对账把任务判成 interrupted 后就不该再报停滞）。
        const at = now()
        const reconciled = reconcileMembers(state, members, at)
        const judged = stallAlertsOf(reconciled.state, at, stallMs)
        if (reconciled.changed > 0 || judged.state !== reconciled.state) {
          deps.store.save(judged.state)
          deps.onReconciled?.(judged.state)
          changed += reconciled.changed + judged.raised.length
        }

        // Trigger 轮询兜底（AC-18）：紧跟在「对账 → 停滞判定」之后，喂的是同一份已落盘状态，
        // 所以 poll 看到的世界与刚写下去的一致（不会基于旧状态重复推导同一条 Trigger）。
        if (deps.onPoll !== undefined) {
          try {
            await deps.onPoll(judged.state)
          } catch {
            // 兜底失败只影响本轮少一次推进，绝不能连累存活对账（下一轮 tick 会补上）。
          }
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
