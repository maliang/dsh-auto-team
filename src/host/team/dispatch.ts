/**
 * 派发编排主干：**只在这里创建成员**。
 *
 * 四件事必须同时成立，否则「并行团队」就是假的：
 *  1. 并发切片：in-flight ≤ min(计划上限, 宿主上限, MAX_CONCURRENT_LIMIT)，多出来的任务
 *     不报错、只标记「并发已满」——报错会让队长以为计划坏了；
 *  2. 角色缺失**不派发**：猜一个角色比不派发更糟（成员会用错技能/错模型干活）；
 *  3. 幂等：已有 binding 且成员还活着 → 只发续跑消息，绝不重复建人（AC-17 的判据之一）；
 *  4. 成员名确定性（`roleId-taskId`）：宿主重启后 id→name 的内存表就没了，
 *     名字是唯一能重建「这条任务归谁」的键，所以它必须是可推导的，而不是随机数。
 *
 * 本文件纯依赖注入（store/spawn/roles/buildPrompt/listMembers 全由外部传入），
 * 因此不需要起宿主就能用 node --test 完全覆盖。
 */
import type { Plan, PlanTask, RejectionCode, Role, RoleModelRoute } from '../../shared/types.ts'
import type { RunState } from '../store.ts'
import type { RunsStore } from '../store.ts'
import type { RoleRepo } from '../roles/repo.ts'
import type { HostMember } from '../adapters.ts'
import {
  DEFAULT_MAX_CONCURRENT,
  HOST_MEMBER_NAME_MAX,
  MAX_ATTEMPTS,
  MAX_CONCURRENT_LIMIT,
  RESUME_DEBOUNCE_MS,
} from '../config.ts'
import { readyTasks } from '../plan/graph.ts'
import { appendMessage, makeMessage } from './messages.ts'
import { auditRoute, preflightRoutes, type RoutePort } from './route.ts'

/** 创建成员的入参：名字是确定性的，路由是角色声明的（宿主可能不支持 model，见 L1）。 */
export interface SpawnInput {
  plan: Plan
  task: PlanTask
  role: Role | undefined
  /** 成员名（= memberNameFor(task)，同一任务反复重试也是同一个名字）。 */
  name: string
  prompt: string
}

/** 提示词构造入参（不含 prompt 本身，prompt 由它产出）。 */
export type PromptInput = Omit<SpawnInput, 'prompt'>

export type SpawnPort = (
  input: SpawnInput,
) => Promise<
  | { ok: true; memberId: string; actual?: RoleModelRoute | null }
  | { ok: false; error: string }
>

export type SendPort = (memberId: string, text: string) => Promise<{ ok: boolean; error?: string; code?: RejectionCode }>

export interface DispatchDeps {
  store: RunsStore
  spawn: SpawnPort
  roles: RoleRepo
  /** 方法式声明（而非属性式）以便既有实现的窄参数签名仍可传入。 */
  buildPrompt(input: PromptInput): string
  listMembers(): Promise<HostMember[]>
  /** 可选：逐角色模型预校验端口（AC-22）；未提供时视为「不预校验」。 */
  routePort?: RoutePort
  /** 可选：续跑/返工消息发送端口；未提供时只记账不发消息。 */
  sendMessage?: SendPort
  /** 可选：宿主实际并发上限（缺省用 DEFAULT_MAX_CONCURRENT）。 */
  hostConcurrency?(): { limit: number; source: 'host' | 'default' }
  now?(): number
}

export interface DispatchResult {
  state: RunState
  started: string[]
  skipped: { taskId: string; reason: RejectionCode | 'ALREADY_RUNNING' }[]
  errors: { taskId: string; error: string; code?: RejectionCode }[]
}

export interface ResumeDeps {
  store: RunsStore
  listMembers(): Promise<HostMember[]>
  sendMessage?: SendPort
  now?(): number
}

export interface ResumeResult {
  state: RunState
  resumed: number
  skipped: number
  unchanged: boolean
}

/**
 * 成员名：`<roleId>-<taskId>`，归一为宿主 `memberName()` 的硬契约
 * `HOST_MEMBER_NAME`（lower-kebab，见 config.ts）。
 *
 * 确定性是 AC-17 的地基——同一任务无论第几次派发都得到同一个名字，
 * 宿主重启后能靠名字把任务重新绑回成员。
 *
 * 为什么必须**小写 + 折叠下划线**：`roleId` / `taskId` 是模型自填的（`Login_Flow`、`t 1`、
 * `重构-登录` 都可能出现），旧实现只把非法字符换成 `-` 并保留大小写，于是生成
 * `dev-Login_Flow`，宿主 `spawnTeammate` 直接抛 `TEAM_INVALID_MEMBER_NAME`，成员一个也建不出来、
 * 任务永远停在 pending（面板只留一条 error notice，看起来像「点了没反应」）。
 * 归一化后任何输入都映射到合法名字：大写折成小写、非 `[a-z0-9]` 连续段折成单个 `-`。
 */
export function memberNameFor(task: PlanTask): string {
  const raw = `${task.roleId}-${task.id}`
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (normalized === '') return 'member'
  // 截断后可能落在分隔符上（`dev-t1-xxxxx-`），结尾的 `-` 同样违约，二次归一。
  const truncated = normalized.slice(0, HOST_MEMBER_NAME_MAX).replace(/-+$/g, '')
  return truncated === '' ? 'member' : truncated
}

/** 在飞任务数：running + gate（gate 期间成员仍占着一个并发位）。 */
export function runningCount(tasks: PlanTask[]): number {
  return tasks.filter((task) => task.status === 'running' || task.status === 'gate').length
}

/** 派发：把 ready 的任务按空闲并发位创建成员。 */
export async function dispatchReady(state: RunState, deps: DispatchDeps): Promise<DispatchResult> {
  const now = deps.now ?? Date.now
  const started: string[] = []
  const skipped: DispatchResult['skipped'] = []
  const errors: DispatchResult['errors'] = []
  let next = state
  let changed = false

  const planStatus = next.plan.status
  if (planStatus !== 'draft' && planStatus !== 'dispatching' && planStatus !== 'paused') {
    // 已终止/取消的计划不再派发：明确拒绝，而不是静默什么都不做。
    for (const task of next.plan.tasks) {
      if (task.status === 'pending' || task.status === 'ready') skipped.push({ taskId: task.id, reason: 'NO_PLAN' })
    }
    return { state: next, started, skipped, errors }
  }

  // 成员名单：拿不到就**保守当作成员都还活着**，宁可少派一个，也不重复建人。
  let members: HostMember[] | null = null
  try {
    members = await deps.listMembers()
  } catch {
    members = null
  }

  const hostLimit = deps.hostConcurrency ? deps.hostConcurrency().limit : DEFAULT_MAX_CONCURRENT
  const planned = next.plan.maxConcurrent > 0 ? next.plan.maxConcurrent : DEFAULT_MAX_CONCURRENT
  const limit = Math.max(1, Math.min(planned, hostLimit, MAX_CONCURRENT_LIMIT))
  let slots = limit - runningCount(next.plan.tasks)

  // 可派发集合 = 「还没开始/返工中且依赖已过门禁」+ 「被对账标成 interrupted、依赖已过门禁」。
  //
  // 后半部分是 AC-17「恢复后能恢复运行」的唯一入口：resume 刻意**不新建**成员（防自动翻倍），
  // 宿主重启/成员被杀之后，interrupted 任务只有靠一次显式 dispatch 才能用同一个确定性名字重建成员。
  // 少了这一段，任务会永远停在 interrupted —— 既派不出去，也不会自己变回 running。
  const depsDone = (task: (typeof next.plan.tasks)[number]): boolean =>
    task.dependsOn.every((dep) => next.plan.tasks.find((item) => item.id === dep)?.status === 'done')
  const recoverable = next.plan.tasks
    .filter((task) => task.status === 'interrupted' && depsDone(task))
    .map((task) => task.id)
  const ready = [...new Set([...readyTasks(next.plan.tasks), ...recoverable])]
  if (ready.length === 0) {
    if (changed) deps.store.save(next)
    return { state: next, started, skipped, errors }
  }

  if (slots <= 0) {
    for (const taskId of ready) skipped.push({ taskId, reason: 'CONCURRENCY_FULL' })
    return { state: next, started, skipped, errors }
  }

  for (const taskId of ready) {
    const task = next.plan.tasks.find((item) => item.id === taskId)
    if (!task) continue

    // 依赖未过门禁（防御性二次校验）：置 blocked，且**不算一次派发尝试**。
    const unfinished = task.dependsOn.filter((dep) => {
      const upstream = next.plan.tasks.find((item) => item.id === dep)
      return !upstream || upstream.status !== 'done'
    })
    if (unfinished.length > 0) {
      next = patchTask(next, taskId, { status: 'blocked' })
      changed = true
      continue
    }

    if (slots <= 0) {
      skipped.push({ taskId, reason: 'CONCURRENCY_FULL' })
      continue
    }

    // 步 a：角色缺失 → 不派发、不猜角色，任务留在原地等用户配。
    const role = deps.roles.get(task.roleId)
    if (!role) {
      skipped.push({ taskId, reason: 'ROLE_UNAVAILABLE' })
      continue
    }

    // 步 b：已有 binding 且在飞成员还活着 → 只续跑，不重建（幂等）。
    const binding = liveBinding(next, taskId)
    if (binding) {
      const alive = members === null || members.some((member) => member.id === binding.memberId || member.name === binding.name)
      if (alive) {
        const at = now()
        const text = resumeText(task)
        if (deps.sendMessage) {
          try {
            await deps.sendMessage(binding.memberId, text)
          } catch {
            /* 发送失败不拦派发：成员仍活着，下一轮 watcher/resume 会再试 */
          }
        }
        next = appendMessage(
          next,
          makeMessage({ from: 'captain', to: binding.name, toMemberId: binding.memberId, taskId, at, body: text }),
        )
        next = patchTask(next, taskId, {
          status: task.status === 'gate' ? 'gate' : 'running',
          memberId: binding.memberId,
          lastResumeAt: at,
          lastResumeStatus: task.status,
        })
        changed = true
        skipped.push({ taskId, reason: 'ALREADY_RUNNING' })
        continue
      }
      // 成员已死：退役旧 binding，重新建人（同一确定性名字）。
      next = {
        ...next,
        bindings: next.bindings.map((item) => (item.taskId === taskId && !item.retired ? { ...item, retired: true } : item)),
      }
      changed = true
    }

    // 步 c：逐角色模型预校验（AC-22）。解析不到就拒绝派发，绝不静默回退队长模型。
    if (role.model && deps.routePort) {
      const preflight = await preflightRoutes([role], deps.routePort)
      if (preflight.failed.length > 0) {
        skipped.push({ taskId, reason: 'MODEL_UNRESOLVABLE' })
        continue
      }
    }

    // 步 e：创建成员。
    const name = memberNameFor(task)
    let prompt = ''
    try {
      prompt = deps.buildPrompt({ plan: next.plan, task, role, name })
    } catch (error) {
      errors.push({ taskId, error: `生成提示词失败：${messageOf(error)}` })
      continue
    }

    try {
      const spawned = await deps.spawn({ plan: next.plan, task, role, name, prompt })
      if (!spawned.ok) {
        errors.push({ taskId, error: spawned.error })
        continue
      }
      const at = now()
      next = {
        ...next,
        bindings: [
          ...next.bindings,
          { taskId, roleId: task.roleId, memberId: spawned.memberId, name, spawnedAt: at },
        ],
      }
      next = patchTask(next, taskId, {
        status: 'running',
        memberId: spawned.memberId,
        attempts: task.attempts ?? 0,
      })
      // 步 f：逐角色模型漂移审计（AC-22）。
      //
      // 时序是这条审计的全部难点：宿主在 `spawnTeammate()` **内部**先 await `agent/created`
      // 监听，再返回 `{ member }`；事件到达那一刻 binding 还不存在，所以「事件里查 binding」
      // 在真机上永远查不到（旧实现在 index.ts 里这么写，结果 routeAudits 恒为空、面板把
      // 已经生效的模型显示成「未下发」）。改成由 spawn 端口把事件里观测到的实际路由带回来，
      // 在 binding 落盘之后**同一笔**写进 RunState。
      //
      // 角色没声明模型时不审计：那不是「未下发」，面板本来就该显示「会话默认模型」。
      // 声明了却拿不到实际值 → auditRoute 落 unverified（绝不拿声明值假装生效）。
      if (role.model) {
        next = auditRoute(next, taskId, role.model, spawned.actual ?? null, at)
      }
      next = appendMessage(
        next,
        makeMessage({
          from: 'captain',
          to: name,
          toMemberId: spawned.memberId,
          taskId,
          at,
          body: `任务「${task.title}」已派发给你（角色 ${role.name}）。验收判定：${task.acceptance === '' ? '（未声明，需人工确认）' : task.acceptance}`,
        }),
      )
      started.push(taskId)
      changed = true
      slots -= 1
    } catch (error) {
      errors.push({ taskId, error: messageOf(error) })
    }
  }

  if (changed) deps.store.save(next)
  return { state: next, started, skipped, errors }
}

/**
 * 幂等恢复（AC-17）：只认「成员还在不在」，不猜、不自动建人。
 *
 * 判据：`lastResumeAt + RESUME_DEBOUNCE_MS` 内的第二次调用必须 `resumed=0 && unchanged=true`，
 * 且**不新增 binding**（成员数两次相等）——这样面板「续跑」按钮连点也不会造出一堆重复成员。
 */
export async function resumeRun(state: RunState, deps: ResumeDeps): Promise<ResumeResult> {
  const now = deps.now ?? Date.now
  let next = state
  let resumed = 0
  let skipped = 0
  let changedCount = 0

  const candidates = next.plan.tasks.filter(
    (task) => task.status === 'running' || task.status === 'gate' || task.status === 'interrupted',
  )
  if (candidates.length === 0) return { state: next, resumed, skipped, unchanged: true }

  let members: HostMember[] | null = null
  try {
    members = await deps.listMembers()
  } catch {
    // 名单不可得 → 一律不判定（宁可什么都不做，也不把活成员误标成中断）。
    return { state: next, resumed, skipped: candidates.length, unchanged: true }
  }

  for (const task of candidates) {
    const binding = liveBinding(next, task.id)
    if (!binding) {
      // 没有 binding 的「运行中」只可能是脏数据：标中断，等人工/重新派发。
      if (task.status !== 'interrupted') {
        next = patchTask(next, task.id, { status: 'interrupted' })
        changedCount += 1
      } else {
        skipped += 1
      }
      continue
    }

    // 名字是唯一可重建的键（宿主重启后 id→name 内存表就没了）。
    const found = members.find((member) => member.id === binding.memberId || member.name === binding.name)
    if (!found) {
      if (task.status !== 'interrupted') {
        next = patchTask(next, task.id, { status: 'interrupted' })
        next = {
          ...next,
          bindings: next.bindings.map((item) =>
            item.taskId === task.id && !item.retired ? { ...item, retired: true } : item,
          ),
        }
        changedCount += 1
      } else {
        skipped += 1
      }
      continue
    }

    const at = now()
    const debounced = task.lastResumeStatus === task.status && at - (task.lastResumeAt ?? 0) < RESUME_DEBOUNCE_MS
    if (debounced) {
      skipped += 1
      continue
    }

    const text = resumeText(task)
    if (deps.sendMessage) {
      try {
        await deps.sendMessage(binding.memberId, text)
      } catch {
        /* 发送失败也要更新去抖时间戳，否则每次轮询都会重复发 */
      }
    }
    next = patchTask(next, task.id, { lastResumeAt: at, lastResumeStatus: task.status, memberId: binding.memberId })
    next = appendMessage(
      next,
      makeMessage({ from: 'captain', to: binding.name, toMemberId: binding.memberId, taskId: task.id, at, body: text }),
    )
    resumed += 1
    changedCount += 1
  }

  if (changedCount > 0) deps.store.save(next)
  return { state: next, resumed, skipped, unchanged: resumed === 0 && changedCount === 0 }
}

/** 回执应用：`done` 是任务完成的**唯一**写点（AC-19 的机械保证）。 */
export function applyReceipt(
  state: RunState,
  taskId: string,
  receipt: { verdict: 'done' | 'rework' | 'failed'; note?: string; evidence?: import('../../shared/types.ts').GateEvidence },
  now?: number,
): RunState {
  const at = now ?? Date.now()
  const task = state.plan.tasks.find((item) => item.id === taskId)
  if (!task) return state

  const attempts = task.attempts ?? 0
  const evidence = receipt.evidence ?? task.evidence
  let next = state
  let body = ''

  if (receipt.verdict === 'done') {
    next = patchTask(next, taskId, { status: 'done', evidence })
    body = gateSummary(task, evidence, '门禁通过')
  } else if (receipt.verdict === 'failed') {
    next = patchTask(next, taskId, { status: 'failed', attempts: attempts + 1, evidence })
    body = gateSummary(task, evidence, '已被判定失败')
  } else {
    const nextAttempts = attempts + 1
    const giveUp = nextAttempts >= MAX_ATTEMPTS
    next = patchTask(next, taskId, {
      status: giveUp ? 'failed' : 'rework',
      attempts: nextAttempts,
      evidence,
    })
    body = giveUp
      ? `返工已达上限（${nextAttempts}/${MAX_ATTEMPTS} 次）：任务「${task.title}」已转人工，下游保持阻塞。${receipt.note ?? ''}`.trim()
      : `返工第 ${nextAttempts}/${MAX_ATTEMPTS} 次：任务「${task.title}」未通过门禁，请按证据修改后再次回报。${receipt.note ?? ''}`.trim()
  }

  next = appendMessage(
    next,
    makeMessage({
      from: 'member',
      to: 'captain',
      toMemberId: task.memberId,
      taskId,
      at,
      body: evidence ? `${body}｜证据：exit=${evidence.exitCode ?? 'null'} ${evidence.tail}` : body,
    }),
  )

  // done 后解锁下游：blocked → pending，让下一轮 dispatch 自然取到。
  if (receipt.verdict === 'done') {
    next = {
      ...next,
      plan: {
        ...next.plan,
        tasks: next.plan.tasks.map((item) => {
          if (item.status !== 'blocked') return item
          const allDone = item.dependsOn.every(
            (dep) => next.plan.tasks.find((candidate) => candidate.id === dep)?.status === 'done',
          )
          return allDone ? { ...item, status: 'pending' as const } : item
        }),
      },
    }
  }

  // 全部终态 → 计划终止（面板胶囊才会从「运行中」翻到「已完成/有失败」）。
  const allSettled = next.plan.tasks.every((item) => item.status === 'done' || item.status === 'failed')
  if (allSettled && next.plan.tasks.length > 0) {
    next = { ...next, plan: { ...next.plan, status: 'terminated' } }
  }

  return next
}

/** 续跑文案：明确「从哪继续」，避免成员当作新任务重头做一遍。 */
export function resumeText(task: PlanTask): string {
  return `继续执行任务「${task.title}」（${task.id}）：沿用你已有的上下文，补齐未完成部分；完成后按验收判定回报回执。`
}

function gateSummary(task: PlanTask, evidence: PlanTask['evidence'], prefix: string): string {
  const exit = evidence ? `退出码 ${evidence.exitCode ?? 'null（超时/被杀）'}` : '无门禁证据'
  return `${prefix}：任务「${task.title}」（${exit}）`
}

function liveBinding(state: RunState, taskId: string) {
  return state.bindings.find((item) => item.taskId === taskId && !item.retired)
}

function patchTask(state: RunState, taskId: string, patch: Partial<PlanTask>): RunState {
  return {
    ...state,
    plan: {
      ...state.plan,
      tasks: state.plan.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
