/**
 * 自动派发（r13 AC-8/9/10）：计划落盘后**零用户动作**起人。
 *
 * 这个模块只做「什么时候值得调一次派发」的判断与串行化，**不实现任何派发规则**：
 * 并发上限、依赖门禁、写域等待、暂停四道闸全在 `team/dispatch.ts` 的 `dispatchReady` 里，
 * 这里通过注入的 `dispatch` 端口调用那个**同一个**闭包。任何在自动路径上重写一遍闸门的做法
 * 都会立刻和手动 `auto_team_dispatch` 分叉（AC-9 的四道闸就会有一侧失效）。
 *
 * 三件事必须由本模块（而不是调用方）保证：
 *  1. **单飞**：同一个 run 同时只允许一次在跑的派发。`dispatchReady` 是 async 的
 *     （`listMembers` / `spawn` 都 await），两次并发调用会用同一份旧状态各算一遍 ready 集合，
 *     于是同一任务被建出两个成员 —— 这是并发路径上唯一真正危险的竞态。
 *  2. **幂等**：派发前重新 `store.load`，并以「就绪任务还没有未退役 binding」为最低判据；
 *     真正的判重仍由 `dispatchReady` 完成（它已有 binding→ALREADY_RUNNING 的既有逻辑）。
 *  3. **退避**：连续失败到 `AUTO_DISPATCH_RETRY_LIMIT` 就停手并留下可见状态，
 *     否则 watcher 每 1.5s 的 tick 会把同一失败重放到宿主日志/配额被烧穿。
 *
 * 状态**刻意不落盘**：失败计数与单飞表都是「本进程此刻」的事实，写进 RunState 会跨重启残留，
 * 让一次旧失败永久掐死新进程里的自动派发（用户看不到任何原因）。
 */
import { AUTO_DISPATCH_RETRY_LIMIT } from '../../shared/const.ts'
import { readyTasks } from '../plan/graph.ts'
import type { RunState, RunsStore } from '../store.ts'

/** 5 个触发点（缺一个 AC-8 的变异用例就会红）。 */
export type AutoDispatchCause = 'plan-saved' | 'task-terminal' | 'member-exit' | 'tasks-added' | 'tick'

/**
 * 派发端口的最小投影。
 *
 * 结构上与 `bridge.ts` 的 `DispatchOutcome` / `DispatchPort` 兼容（bridge.ts:115-127），
 * 但**不 import bridge**：`bridge.ts` 反向依赖 `team/dispatch.ts`，自动派发再依赖 bridge
 * 就会把编排接口层拉进派发路径，单测也得多带一层桥的依赖。
 */
export interface AutoDispatchOutcome {
  started: string[]
  skipped?: ReadonlyArray<{ taskId: string; reason: string }>
  errors?: ReadonlyArray<{ taskId: string; error: string; code?: string }>
}

export interface AutoDispatchDeps {
  store: RunsStore
  /** 与 `bridge.act('dispatch')` 完全相同的那个闭包（四道闸的唯一实现处）。 */
  dispatch: (state: RunState) => Promise<AutoDispatchOutcome>
  now?: () => number
  /** 需要人看见的结论（由装配层写成 `kind:'status'` 活动，本模块不落盘）。 */
  onStatus?: (runId: string, text: string) => void
}

export interface AutoDispatchReport {
  runId: string
  cause: AutoDispatchCause
  /** 是否真的调了派发端口（被闸门挡下 = false）。 */
  attempted: boolean
  started: string[]
  /** 本批 spawn 报错数（不是「失败任务数」，是 errors 长度）。 */
  failed: number
  /** 被 dispatchReady 跳过的数量（并发满/角色缺失/已在跑等）。 */
  skipped: number
  reason?: string
}

export interface AutoDispatcher {
  /** fire-and-forget：调用方（工具/事件/轮询）从不 await，工具返回不等派发。 */
  kick(sessionId: string, runId: string | undefined, cause: AutoDispatchCause): void
  /** watcher tick 兜底：扫活动 run，逐个走与 kick 相同的路径。 */
  tick(): Promise<AutoDispatchReport[]>
  inflight(sessionId: string): boolean
  /** 用户显式动作后解除退避（停止计数清零）。 */
  reset(runId: string): void
  dispose(): void
}

/** 连续失败到达上限时的可见文案（逐字，供面板/探针断言复用）。 */
export const AUTO_DISPATCH_STALLED_TEXT = '自动派发连续失败，需人工处理'

/**
 * 「现在值得调一次派发吗」的纯判定（AC-9 的前置闸，不替代 dispatchReady 的四道闸）。
 *
 * 刻意**不判并发上限**：那是 `dispatchReady` 的职责，在这里再算一遍就会出现第二套并发口径，
 * 两边一旦漂移，面板/自动派发/手动派发就会对「该不该起人」给出不同答案。
 */
export function shouldAutoDispatch(state: RunState): { ok: boolean; reason?: string } {
  const status = state.plan.status
  if (status !== 'draft' && status !== 'dispatching') {
    return { ok: false, reason: `计划状态为 ${status}，不自动派发` }
  }
  // 双闸：`dispatchReady` 内部也判一次。这里判是为了让 tick 不白跑、且面板能拿到原因。
  if (state.pause !== undefined || state.plan.tasks.some((task) => task.status === 'paused')) {
    return { ok: false, reason: '已暂停，恢复后再自动补齐' }
  }
  // 写域闸挡下的 waiting 任务不在 readyTasks 口径里；用户确认「强制并行」后由 dispatchReady 的
  // `reviveForcedWaits` 把它们放回 pending。这里必须用同一投影判，否则 waiting 是唯一可动对象时
  // shouldAutoDispatch 会先判「没有就绪任务」，复活逻辑永远等不到调用（AC-11 的 forceParallel 死路）。
  const forced = new Set(state.forceParallel ?? [])
  const projected =
    forced.size === 0
      ? state.plan.tasks
      : state.plan.tasks.map((task) => (task.status === 'waiting' && forced.has(task.id) ? { ...task, status: 'pending' as const } : task))
  const ready = readyTasks(projected)
  if (ready.length === 0) return { ok: false, reason: '没有就绪任务' }
  const liveBound = new Set(state.bindings.filter((binding) => binding.retired !== true).map((binding) => binding.taskId))
  const fresh = ready.filter((taskId) => !liveBound.has(taskId))
  if (fresh.length === 0) {
    // 就绪任务都已经有在册成员 = 已经派过（幂等，AC-10 的「再调 dispatch 新增成员 0」）。
    return { ok: false, reason: '就绪任务均已派出成员，无需重复派发' }
  }
  return { ok: true }
}

interface Inflight {
  sessionId: string
  promise: Promise<AutoDispatchReport>
}

export function createAutoDispatcher(deps: AutoDispatchDeps): AutoDispatcher {
  const now = deps.now ?? Date.now
  /** key = runId：单飞粒度按 run，不按 session（一个会话可能留有多份历史 run）。 */
  const inflightRuns = new Map<string, Inflight>()
  /** 连续失败计数；有进展（started 非空）即清零。 */
  const failures = new Map<string, number>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let disposed = false

  function stalled(runId: string): boolean {
    return (failures.get(runId) ?? 0) >= AUTO_DISPATCH_RETRY_LIMIT
  }

  function bumpFailure(runId: string): void {
    const count = (failures.get(runId) ?? 0) + 1
    failures.set(runId, count)
    // 只在跨过上限那一刻播报一次：之后自动重试已停止，再喊就是噪音。
    if (count >= AUTO_DISPATCH_RETRY_LIMIT) {
      deps.onStatus?.(runId, `${AUTO_DISPATCH_STALLED_TEXT}（连续 ${count} 次）`)
    }
  }

  function reportOf(
    runId: string,
    cause: AutoDispatchCause,
    patch: Partial<AutoDispatchReport> = {},
  ): AutoDispatchReport {
    return { runId, cause, attempted: false, started: [], failed: 0, skipped: 0, ...patch }
  }

  async function dispatchOnce(
    sessionId: string,
    runId: string,
    cause: AutoDispatchCause,
  ): Promise<AutoDispatchReport> {
    const state = deps.store.load(runId)
    if (state === null) return reportOf(runId, cause, { reason: 'run 不存在或无法读取' })
    // 防串号：runId 与 sessionId 不匹配时绝不派发（否则一个错误的 runId 会替别的会话起人）。
    if (state.plan.sessionId !== sessionId) {
      return reportOf(runId, cause, { reason: `run 属于会话 ${state.plan.sessionId}，与请求会话不一致` })
    }
    const verdict = shouldAutoDispatch(state)
    if (!verdict.ok) return reportOf(runId, cause, { reason: verdict.reason })

    try {
      const result = await deps.dispatch(state)
      const started = result.started ?? []
      const failed = result.errors?.length ?? 0
      // 「一个都没起来且有错误」才算一次失败：部分成功说明路径是通的，不该累计退避。
      if (started.length === 0 && failed > 0) bumpFailure(runId)
      else failures.delete(runId)
      return reportOf(runId, cause, {
        attempted: true,
        started,
        failed,
        skipped: result.skipped?.length ?? 0,
        ...(started.length === 0 && failed > 0 ? { reason: `本批 spawn 全部失败（${failed} 条错误）` } : {}),
      })
    } catch (error) {
      bumpFailure(runId)
      return reportOf(runId, cause, {
        attempted: true,
        failed: 1,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function run(
    sessionId: string,
    requestedRunId: string | undefined,
    cause: AutoDispatchCause,
  ): Promise<AutoDispatchReport | null> {
    if (disposed) return null
    // 未给 runId（例如成员退出事件只带 sessionId）才去扫最近一次 run —— 扫盘放在这里，
    // kick 本身必须瞬时返回，不能因为跑一次 store 扫描而阻塞工具返回。
    const runId = requestedRunId ?? deps.store.latestForSession(sessionId)?.plan.runId
    if (runId === undefined) return null
    if (inflightRuns.has(runId)) return null // 单飞：不排队，下一次 tick/触发点会补
    if (stalled(runId)) return null
    const promise = dispatchOnce(sessionId, runId, cause)
    inflightRuns.set(runId, { sessionId, promise })
    try {
      return await promise
    } finally {
      inflightRuns.delete(runId)
    }
  }

  function kick(sessionId: string, runId: string | undefined, cause: AutoDispatchCause): void {
    if (disposed) return
    // setTimeout(0) 而不是直接 void run()：kick 的调用点都在「刚写完盘的同一个 tick」里
    // （工具返回前/事件回调中），延后一拍让落盘与快照先完成，也避免调用方 await 到派发。
    const handle = setTimeout(() => {
      timers.delete(handle)
      void run(sessionId, runId, cause).catch(() => {
        /* run() 内部已把所有失败转成报告；这里只兜住 Promise 链，绝不让未处理拒绝冒到宿主 */
      })
    }, 0)
    timers.add(handle)
  }

  async function tick(): Promise<AutoDispatchReport[]> {
    if (disposed) return []
    let summaries: ReturnType<RunsStore['list']>
    try {
      summaries = deps.store.list()
    } catch {
      return [] // 盘读不了不该连累 watcher 的其余职责（存活对账/停滞判定）
    }
    const reports: AutoDispatchReport[] = []
    for (const summary of summaries) {
      // `active` 由 store 按「还有非终态任务」算；旧文件缺字段时退回 planStatus 判定。
      if (summary.active === false) continue
      if (summary.status !== 'draft' && summary.status !== 'dispatching') continue
      if (inflightRuns.has(summary.runId)) continue
      const report = await run(summary.sessionId, summary.runId, 'tick')
      if (report !== null) reports.push(report)
    }
    return reports
  }

  function inflight(sessionId: string): boolean {
    for (const entry of inflightRuns.values()) {
      if (entry.sessionId === sessionId) return true
    }
    return false
  }

  function reset(runId: string): void {
    failures.delete(runId)
  }

  function dispose(): void {
    disposed = true
    for (const handle of timers) clearTimeout(handle)
    timers.clear()
    inflightRuns.clear()
    failures.clear()
    void now
  }

  return { kick, tick, inflight, reset, dispose }
}
