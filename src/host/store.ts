/**
 * 运行状态仓库：`<home>/.dsh/auto-team/runs/<runId>.json` 一运行一文件。
 *
 * 落盘形态是 `RunState` v2（`plan + plannedAt + messages + bindings + routeAudits`），
 * 而不是裸 `Plan`：消息账本、成员绑定、逐角色路由审计都必须持久化，否则重启后面板
 * 无证据（AC-16/AC-17/AC-22）、恢复也无法幂等。
 *
 * 兼容：v1 裸 `Plan` 文件由 `wrapLegacy` 自动升到 v2（补空数组），因此不需要迁移脚本。
 *
 * 写盘纪律：先写 `<file>.tmp` 再 rename（同目录 rename 是原子的），避免面板在写到一半时
 * 读到半个 JSON 而整块显示空白——这类「偶发空白」在用户侧表现为「面板有时候不显示」。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type {
  ActivityEvent,
  MemberBinding,
  MessageRecord,
  Plan,
  PlanRevision,
  PlanStatus,
  PlanTask,
  ProgressRecord,
  RouteAudit,
  RunSummary,
  TaskStatus,
  TokenTotals,
  TriggerKind,
  TriggerRecord,
} from '../shared/types.ts'
import { DEFAULT_MAX_CONCURRENT, MAX_CONCURRENT_LIMIT, TRIGGER_KINDS, TRIGGER_LOG_LIMIT } from './config.ts'

/**
 * 运行列表的一行：定义单点在 `shared/types.ts`（`LibraryView.runs` 也是它）。
 *
 * 这里只转出 —— client 不允许 import host，共享契约必须住在 shared。
 */
export type { RunSummary }

/**
 * Trigger 账本上限（`TRIGGER_LOG_LIMIT = 100`）。
 *
 * **唯一定义在 `config.ts`**（配置单点；阈值/窗口/上限各只允许一处 `export const`），
 * 这里只转出，让 `store.ts` 与 `MESSAGES_LIMIT` / `STALL_ALERTS_LIMIT` 同族拿到上限。
 */
export { TRIGGER_LOG_LIMIT }

/** 落盘结构版本：3 是 RunState + 暂停记账（2 = RunState，1 = 历史的裸 Plan）。 */
export const RUN_STATE_VERSION = 3

/** 消息账本上限（AC-16）：超出丢最旧，保证落盘文件不会无限增长。 */
export const MESSAGES_LIMIT = 200

/**
 * 停滞告警上限：一次运行里最多保留最近多少条 `stallAlerts`。
 *
 * 告警由 `watcher.tick` 追加（每 episode 一条），成员反复卡住也能涨到几百条；
 * 落盘文件是对账与面板的唯一数据源，必须像消息账本一样有上限，否则单个 run 文件会无限变大。
 */
export const STALL_ALERTS_LIMIT = 50

/**
 * 暂停记账（r7 AC-9）：暂停不是「把状态改掉」，而是一次可逆事务。
 *
 * 为什么原状态记在这里而不写在 `PlanTask` 上：AC-10 冻结了 `PlanTask` 的字段集，
 * 而且暂停/继续必须**原子**落盘「计划状态 + 每条任务原状态」——拆成两处就是两套真值与
 * 两条回滚路径（本项目历史 bug 族：同一份数据两条链路给不同结论）。
 *
 * `tasks` 只记被冻结任务的**原状态**；恢复时按它还原，缺失的按 `ready` 兜底，
 * 已经 `done` 的任务**永不回退**（AC-9：暂停不能把已完成的工作变回未完成）。
 */
export interface PauseRecord {
  /** 进入暂停的时刻（毫秒）。 */
  at: number
  /** 暂停前的计划状态（`dispatching` 或 `draft`），恢复时原样还原。 */
  planStatus: PlanStatus
  /** 任务 id → 暂停前的状态。 */
  tasks: Record<string, TaskStatus>
}

/**
 * 一次运行的完整落盘状态（v3）。
 *
 * 注意 `plannedAt` 必须早于首个 `bindings[].spawnedAt` —— 这是 AC-30「先计划、后派发」
 * 的机械证据，不能在派发时补写。
 */
export interface RunState {
  version: typeof RUN_STATE_VERSION
  plan: Plan
  plannedAt: number
  messages: MessageRecord[]
  bindings: MemberBinding[]
  routeAudits: RouteAudit[]
  /**
   * 成员推进记录（key = memberId）：最近一次实质工具调用时间 + 本轮告警标记。
   * 缺省 = 还没有任何推进信号，停滞判定的基线回落到 `binding.spawnedAt`。
   */
  progress?: Record<string, ProgressRecord>
  /**
   * 停滞告警事件（`kind` 恒为 `'tool'`），由 watcher.tick 追加、`bridge.activityOf` 只读合并。
   * 必须落盘：只有落盘才能跨重启保持「一次 episode 一条告警」的幂等。
   */
  stallAlerts?: ActivityEvent[]
  /**
   * Trigger 账本（accepted / dropped 都留），由 `team/trigger-bus.ts` 追加。
   *
   * 为什么必须落盘：幂等（同一 `dedupeKey` 在窗口内只推进一次）与可解释性
   * （「为什么没推进」）都要**跨重启**成立；只在内存里存的话重启后同一个事件会被再推一次。
   */
  triggers?: TriggerRecord[]
  /**
   * 暂停记账（r7 AC-9）：存在即「当前处于暂停态」。
   * 与 `plan.status === 'paused'` 的区别：这里是**可还原的原状态**，`plan.status` 只是对外的当前态。
   */
  pause?: PauseRecord
  /** r13：本 run 所属项目（工作区 basename）；缺省 = 旧 run，左栏归入「历史运行（未记录工作区）」。 */
  project?: string
  /** r13 AC-20：进入终态（全部任务终态 / 取消）的时刻；进行中缺省。 */
  finishedAt?: number
  /** r13 AC-19：token 用量累加（宿主事件投喂，见 `team/usage.ts`）。缺省 = 从未收到用量事件。 */
  usage?: UsageRecord
  /** r13 AC-20：任务计时（key = taskId，起点由 dispatch 写入、终点由 receipt 写入）。 */
  taskTimes?: Record<string, TaskTimeRecord>
  /** r13 AC-13：未决确认（同一 run 只允许一条；不设 TTL，由用户显式确认/拒绝）。 */
  pendingConfirmation?: PendingConfirmation
  /**
   * r13 AC-11：用户已确认过「强制并行」的 taskId 集合。
   *
   * 记在 run 上而不是进程内：确认是一次**持久授权**，重启后再撞同一写域不应再弹窗。
   */
  forceParallel?: string[]
  /**
   * r21 AC-3：run 收口原因（与 `finishedAt` 同时落盘）。
   *
   * 为什么必须落盘：面板要在历史里回答「这个 run 为什么停了」；只在内存里存的话，
   * 重启后旧 run 就只剩一个「已终止/已取消」标签，用户无法区分「全部做完自然收口」、
   * 「用户取消」与「被需求修订取代」。时间统一以 `finishedAt` 为准，这里不再存第二份时刻。
   */
  termination?: TerminationRecord
  /**
   * r23：终态 run 的记忆沉淀幂等键（epoch ms）。
   *
   * `saveState` 在 receipt/停滞/暂停恢复等路径会被反复调用；没有这个字段的话同一条失败教训
   * 会被反复 upsert，`修正 N` 一路涨。**只有终态沉淀成功（包括 0 条草稿）后才写入**，
   * 非终态与异常路径都不写，下一次保存重试（fail-open）。
   */
  memorySunkAt?: number
}

/** r21：收口原因。`kind` 只描述**用户可理解的来源**，不是新的命运状态。 */
export interface TerminationRecord {
  reason: string
  kind: 'cancelled' | 'terminated' | 'superseded' | 'stale'
}

/** 用量归属三态（降级只允许单向：`per-member → aggregate-only → unavailable`）。 */
export type UsageAttribution = 'per-member' | 'aggregate-only' | 'unavailable'

/** r13 AC-19：一次 run 的用量累加记录（落盘；`total` 是合计，分项只在来源真的给分项时才写）。 */
export interface UsageRecord {
  attribution: UsageAttribution
  /** key = memberId（同一成员续聊会累加）。 */
  byMember: Record<string, TokenTotals>
  /** key = taskId（同一任务返工会累加）。 */
  byTask: Record<string, TokenTotals>
  /** run 合计；缺省 = 还没有任何数字（与 `total: 0` 不同）。 */
  total?: TokenTotals
  updatedAt: number
}

/** r13 AC-20：一个任务的计时区间；只有起点 = 正在跑，两端都有 = 已结束。 */
export interface TaskTimeRecord {
  startedAt?: number
  endedAt?: number
}

/**
 * 计划已收口（不会再变）的状态：只有它们才有「结束时刻」。
 *
 * r25：显式导出成 `PLAN_TERMINAL_STATUSES` 并只服务 **run 级**语义（结束时刻、列表里的
 * `ongoing`/`active` 归零）。**不要**拿它跟任务级的 `SUMMARY_TERMINAL_STATUSES` 混用：
 * 前者判 plan.status，后者判 task.status，两张表回答的是不同问题。
 */
export const PLAN_TERMINAL_STATUSES: ReadonlySet<PlanStatus> = new Set<PlanStatus>([
  'terminated',
  'cancelled',
])

/**
 * run 的结束时刻（r20）。
 *
 * 真实落盘值优先（r20 起 `team/dispatch.applyReceipt` 收口、`bridge.cancel` 取消都会写
 * `finishedAt`）。历史 run（r20 之前只改 `plan.status`、不记时间）用**可核实的事实**回退：
 *  1. 各任务 `taskTimes[].endedAt` 的最大值 —— 收口只会发生在最后一个任务结束之后；
 *  2. 最后一条消息的 `at` —— 没有任务时间的旧 run（例如派发前取消）只剩消息时间可核。
 * 取两者较大值（结束时刻不早于任一可核事实）。都拿不到 → `undefined`，界面继续显示
 * 「不可得」，绝不拿 `now` 冒充；进行中的 run 没有结束时刻，不看回退。
 *
 * 只读派生、不落盘：替代口径是**下限**，写进文件会与真实收口时刻混成同一种证据。
 */
export function finishedAtOf(state: RunState): number | undefined {
  const recorded = finiteOptional(state.finishedAt)
  if (recorded !== undefined) return recorded
  if (!PLAN_TERMINAL_STATUSES.has(state.plan.status)) return undefined
  let latest: number | undefined
  for (const record of Object.values(state.taskTimes ?? {})) {
    const endedAt = finiteOptional(record?.endedAt)
    if (endedAt !== undefined && (latest === undefined || endedAt > latest)) latest = endedAt
  }
  const lastMessage = state.messages?.[state.messages.length - 1]
  const lastAt = finiteOptional(lastMessage?.at)
  if (lastAt !== undefined && (latest === undefined || lastAt > latest)) latest = lastAt
  return latest
}

/**
 * r26：真实派发成功后的计划态推进 —— `draft → dispatching`。
 *
 * 只进不退、幂等：只有 `draft` 会被改写；已是 `dispatching`（重复派发/并发成功）、
 * `paused`、`terminated`、`cancelled` 一律返回 `null`（调用方不写盘）。派发失败路径
 * 不得调用本函数，因此失败时计划保持 `draft`，用户仍能再次点派发。
 */
export function advancePlanToDispatching(state: RunState): RunState | null {
  if (state.plan.status !== 'draft') return null
  return { ...state, plan: { ...state.plan, status: 'dispatching' } }
}

/** r24：残留计划判定阈值 —— 30 分钟内没有任何可核活动且没有存活成员。 */
export const STALE_PLAN_MS = 30 * 60 * 1000

/** r24：只有「还在进行」的计划会被自动收口；终态与暂停不算（暂停是用户主动事务）。 */
const STALE_CANDIDATE_STATUSES: ReadonlySet<PlanStatus> = new Set<PlanStatus>([
  'draft',
  'dispatching',
  'paused',
])

/** r24：自动收口的固定文案（面板原文渲染，不拼装）。 */
export const STALE_PLAN_REASON = '计划长时间无活动且没有成员在跑，已自动收口'

/**
 * r24：一次 run 的「最后活动时刻」—— 取所有可核实事实的最大值。
 *
 * 候选事实：`plannedAt`、各任务计时区间两端、消息账本各条 `at`、需求修订时刻、
 * 任务 `revisedAt`。故意**不**看 `Date.now()`：没有活动就是没有活动，拿当前时刻兜底
 * 会让残留 run 永远显得「刚刚活跃过」。
 */
export function lastActivityAtOf(state: RunState): number {
  let latest = finiteOptional(state.plannedAt) ?? finiteOptional(state.plan.createdAt) ?? 0
  const bump = (value: unknown): void => {
    const at = finiteOptional(value)
    if (at !== undefined && at > latest) latest = at
  }
  for (const record of Object.values(state.taskTimes ?? {})) {
    bump(record?.startedAt)
    bump(record?.endedAt)
  }
  for (const message of state.messages ?? []) bump(message?.at)
  for (const revision of state.plan.revisions ?? []) bump(revision?.at)
  for (const task of state.plan.tasks) bump(task.revisedAt)
  return latest
}

/**
 * r25：计划收口时一并终结的「残留任务」状态词。
 *
 * 用**任务级**终态集合的反面：done/failed/cancelled/skipped/interrupted 之外的一切
 * （running/gate/rework/pending/blocked/ready/paused/waiting）都必须被终结，否则已收口的
 * run 里会留下「还在跑 / 还能点派发」的假活任务，面板的 ongoing/active 也会自相矛盾。
 * 集合本身复用 `SUMMARY_TERMINAL_STATUSES`（与 `team/dispatch.ts` 的终态表同源），
 * 不在这里再抄一份，避免新增终态时漂移。
 */
export function cancelResidualTasks(
  state: RunState,
  finishedAt: number,
  reason: string,
): { tasks: PlanTask[]; changed: number } {
  const cancelReason = `计划已收口：${reason}`
  let changed = 0
  const tasks = state.plan.tasks.map((task) => {
    if (SUMMARY_TERMINAL_STATUSES.has(task.status)) return task
    changed += 1
    return {
      ...task,
      status: 'cancelled' as TaskStatus,
      cancelledAt: finishedAt,
      cancelReason,
      cancelledBy: 'stale' as const,
    }
  })
  return { tasks, changed }
}

/**
 * r24：残留计划自动对账（进程内只调用一次，见 `bridge.createBridge`）。
 *
 * 对「仍在进行、无 `finishedAt`/`termination`、最后活动早于 `staleMs`、且本进程没有该 run
 * 存活成员」的 run 落盘收口（`status='terminated'` + `finishedAt=最后活动时刻` +
 * `termination.kind='stale'`）。r25：**同一次落盘**把残留任务一并终结（见
 * {@link cancelResidualTasks}），不能先写终态再补任务 —— 中间态被面板读到就是脏数据。
 * 幂等：第二次启动时状态已是终态，直接跳过，不再改写文件。
 *
 * 返回被收口的 runId 列表（供日志/测试断言；正常运行时通常为空）。
 */
export function reconcileStalePlans(
  store: Pick<RunsStore, 'list' | 'load' | 'save'>,
  options: {
    now: number
    staleMs?: number
    /** 该 run 在本进程里是否还有存活成员（缺省 = 没有，因此调用点必须在派发之前）。 */
    hasLiveMembers?: (runId: string) => boolean
  },
): string[] {
  const staleMs = options.staleMs ?? STALE_PLAN_MS
  const now = options.now
  const reconciled: string[] = []
  for (const summary of store.list()) {
    const state = store.load(summary.runId)
    if (state === null) continue
    if (!STALE_CANDIDATE_STATUSES.has(state.plan.status)) continue
    if (state.finishedAt !== undefined) continue
    if (state.termination !== undefined) continue
    if (options.hasLiveMembers?.(state.plan.runId) === true) continue
    const lastActivityAt = lastActivityAtOf(state)
    if (lastActivityAt >= now - staleMs) continue
    const cancelled = cancelResidualTasks(state, lastActivityAt, STALE_PLAN_REASON)
    try {
      store.save({
        ...state,
        plan: { ...state.plan, status: 'terminated', tasks: cancelled.tasks },
        finishedAt: lastActivityAt,
        termination: { kind: 'stale', reason: STALE_PLAN_REASON },
      })
      reconciled.push(state.plan.runId)
    } catch {
      // 单个文件写失败不能阻断其余 run 的对账，也不能让启动失败：下一次启动会重试。
    }
  }
  return reconciled
}

/** r25：历史 run 没有收口原因时的兜底文案（不编造具体来源，只说「已结束」）。 */
const CLOSED_RUN_FALLBACK_REASON = '该运行已结束'

/**
 * r25：一次性修正已收口的历史 run —— 终态 run 里仍留着非终态任务时，按
 * {@link cancelResidualTasks} 把它们一并终结（`cancelledBy='stale'`）。
 *
 * 幂等判据是「没有残留任务就**不写盘**」：第二次启动零 `save`，文件字节逐字不变。
 * 单个 run 修失败只跳过并 `onWarn`，绝不让启动/面板读取失败 —— 历史脏数据不该导致
 * 整个面板打不开。返回被修正的 runId 列表（正常运行时为空）。
 */
export function repairClosedRuns(
  store: Pick<RunsStore, 'list' | 'load' | 'save'>,
  options: { onWarn?: (message: string) => void } = {},
): string[] {
  const repaired: string[] = []
  for (const summary of store.list()) {
    try {
      const state = store.load(summary.runId)
      if (state === null) continue
      if (!PLAN_TERMINAL_STATUSES.has(state.plan.status)) continue
      const finishedAt = finishedAtOf(state) ?? lastActivityAtOf(state)
      const reason = state.termination?.reason ?? CLOSED_RUN_FALLBACK_REASON
      const cancelled = cancelResidualTasks(state, finishedAt, reason)
      if (cancelled.changed === 0) continue
      store.save({ ...state, plan: { ...state.plan, tasks: cancelled.tasks } })
      repaired.push(state.plan.runId)
    } catch (error) {
      options.onWarn?.(
        `自动团队：修正已收口运行的残留任务失败（${summary.runId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
  return repaired
}

/**
 * r13 AC-11：需要用户确认的 5 类不可逆动作。
 *
 * 用 `PanelAction` 的变体而不是字符串：确认后要**原样重放**这条动作，
 * 存成字符串就得再解析一次，解析漏一个字段就是另一条执行路径。
 */
export type IrreversiblePanelAction =
  | { type: 'cancel' }
  | { type: 'cancelTask'; taskId: string; reason?: string }
  | { type: 'skipTask'; taskId: string }
  | { type: 'updateAcceptance'; taskId: string; acceptance: string }
  | { type: 'forceParallel'; taskId: string }

/** r13 AC-13：一条待确认记录（`summary` 是宿主生成的影响面文案，逐字展示）。 */
export interface PendingConfirmation {
  id: string
  action: IrreversiblePanelAction
  runId: string
  createdAt: number
  summary: string
  irreversible: true
  taskId?: string
}

/**
 * `RunsStore.save` 的写盘选项。
 *
 * 历史列表（`bridge.historyOf`）的 5 秒 memo 以 `writeEpoch()` 为失效判据：任何一次
 * 「会改变历史行」的落盘都必须让旧缓存作废。只有一个例外，见 `historyNeutral`。
 */
export interface SaveOptions {
  /**
   * 这次写盘**不影响历史列表行**：仅供「只改 usage」的投影刷新使用。
   *
   * 历史行确实带 `usageTotals`，但投影写盘在每个轮询帧都可能发生；若它也失效 memo，
   * 面板 2 秒一刷就会重新全量 `list()`，把 5 秒合并读的意义抹掉（t4 明确禁止的退化）。
   * 状态 / 终止原因 / 任务状态等真正决定历史行的写一律**不得**走这个豁免。
   */
  historyNeutral?: boolean
}

export class RunsStore {
  /** 显式字段赋值而非构造器参数属性：node --test 的类型剥离（strip-only）不支持参数属性。 */
  private readonly dir: string
  /**
   * 成功落盘次数（单调递增）——历史列表 memo 的「写后失效」判据。
   *
   * 放在 store 而不是 bridge：写库的不止 `bridge.saveState`（dispatch / watcher / tools /
   * reconcile 都直接 `store.save`）。把版本号收敛到**唯一写入口** `save()`，这些路径
   * 才都能让历史缓存失效，而不必在每个调用点手工补一次 `historyMemo = null`。
   */
  private writeCount: number

  constructor(dir: string) {
    this.dir = dir
    this.writeCount = 0
  }

  /**
   * 当前写盘版本号：`bridge.historyOf` 用它判断 5 秒 memo 是否已过期。
   * 只读；`historyNeutral` 的写不计入（见 `SaveOptions`）。
   */
  writeEpoch(): number {
    return this.writeCount
  }

  /** 读一个 run；v1 裸 Plan 会被 `wrapLegacy` 升成 v2；文件缺失/损坏返回 null。 */
  load(runId: string): RunState | null {
    const path = this.fileFor(runId)
    if (path === null || !existsSync(path)) return null
    try {
      return wrapLegacy(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      return null
    }
  }

  /** 整体原子写（tmp + rename）；消息账本 / 停滞记录 / 告警都按上限裁剪后再落盘。 */
  save(state: RunState, options?: SaveOptions): void {
    const path = this.fileFor(state.plan.runId)
    if (path === null) throw new Error(`非法 runId：${state.plan.runId}`)
    mkdirSync(this.dir, { recursive: true })
    const bindings = state.bindings ?? []
    const normalized: RunState = {
      ...state,
      version: RUN_STATE_VERSION,
      messages: capMessages(state.messages),
      bindings,
      routeAudits: state.routeAudits ?? [],
      // 成员死后其推进记录不再有任何用处：只留 live bindings 的 memberId，避免文件无限增长。
      progress: capProgress(state.progress, bindings),
      stallAlerts: capStallAlerts(state.stallAlerts ?? []),
      triggers: capTriggers(state.triggers ?? []),
      // 暂停记账也走归一化：桥里手搓的 PauseRecord 合法与否不应该决定盘上是什么形状。
      pause: normalizePause(state.pause),
      // r13 追加字段同样归一：坏数据（NaN / 负数 / 缺字段）只能被丢掉，不能让落盘失败。
      project: normalizeLabel(state.project),
      finishedAt: finiteOptional(state.finishedAt),
      usage: normalizeUsage(state.usage),
      taskTimes: normalizeTaskTimes(state.taskTimes),
      pendingConfirmation: normalizePending(state.pendingConfirmation),
      forceParallel: normalizeIdList(state.forceParallel),
      termination: normalizeTermination(state.termination),
    }
    const tmp = `${path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
    // 写后失效点：只有 rename 成功才算「盘上真的变了」。写失败不推进版本号，
    // 历史 memo 继续保持 —— 读到的仍是上一次成功落盘的那份，不存在半截状态。
    if (options?.historyNeutral !== true) this.writeCount += 1
  }

  /** 按会话取最近一次运行（面板「计划」页与「恢复」的默认数据源）。 */
  latestForSession(sessionId: string): RunState | null {
    const runs = this.list()
      .map((summary) => this.load(summary.runId))
      .filter((state): state is RunState => state !== null && state.plan.sessionId === sessionId)
      .sort((a, b) => b.plan.createdAt - a.plan.createdAt)
    return runs[0] ?? null
  }

  list(): RunSummary[] {
    if (!existsSync(this.dir)) return []
    const out: RunSummary[] = []
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith('.json')) continue
      const state = this.load(entry.slice(0, -'.json'.length))
      if (state === null) continue
      const { plan } = state
      // r18b：`ongoing` 与 `active` 用**同一个**谓词算，避免「还有进行中任务」出现两种口径。
      // 旧文件缺 `tasks` 时 `wrapLegacy`/`normalizePlan` 已判成非法 run（load 返回 null → 跳过），
      // 因此这里拿到的 `plan.tasks` 恒为数组，统计不会抛。
      //
      // r25：已收口（terminated/cancelled）的 run 一律 ongoing=0、active=false —— 收口动作
      // 会把残留任务一并终结，但历史脏数据/旧版本收口的 run 仍可能带着 running/pending 任务；
      // 若照任务表数下去，左栏会永远标「活跃」、历史详情还会显示「进行中」，与终态自相矛盾。
      // 非终态 run 的算法逐字不变（不把两张终态表混用）。
      const planClosed = PLAN_TERMINAL_STATUSES.has(plan.status)
      const ongoing = planClosed ? 0 : plan.tasks.filter((task) => !SUMMARY_TERMINAL_STATUSES.has(task.status)).length
      const resolvedFinishedAt = finishedAtOf(state)
      out.push({
        runId: plan.runId,
        sessionId: plan.sessionId,
        createdAt: plan.createdAt,
        status: plan.status,
        tasks: plan.tasks.length,
        done: plan.tasks.filter((task) => task.status === 'done').length,
        // r13：左栏项目页/历史页要的四个可选量；拿不到就不写（面板显示「不可得」而不是 0）。
        ...(normalizeLabel(state.project) !== undefined ? { project: normalizeLabel(state.project) } : {}),
        // r14 AC-15：run 级目标（旧 run 没有就不写，客户端走 fallback —— 不猜、不迁移）。
        ...(normalizeLabel(plan.goal) !== undefined ? { goal: normalizeLabel(plan.goal) } : {}),
        plannedAt: state.plannedAt,
        // r20：历史 run 没有 finishedAt 时按可核实事实回退（见 `finishedAtOf`）；仍无 → 不写。
        ...(resolvedFinishedAt !== undefined ? { finishedAt: resolvedFinishedAt } : {}),
        ...(state.usage?.total !== undefined ? { usageTotals: state.usage.total } : {}),
        // r21：收口原因（旧 run 没有就不写，历史列表显示「未记录原因」而不是编一个）。
        ...(state.termination !== undefined ? { terminationReason: state.termination.reason } : {}),
        ongoing,
        active: planClosed ? false : ongoing > 0,
      })
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * runId → 文件路径。runId 是文件名主体，必须拒绝路径分隔符与 `..`，
   * 否则一个脏 runId 就能把 `runs/` 之外的文件读写掉。
   */
  private fileFor(runId: string): string | null {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) return null
    if (runId.includes('..')) return null
    return `${this.dir}/${runId}.json`
  }
}

/**
 * 把任意落盘内容升成 `RunState` v2（纯函数，无 IO，供单测）。
 *
 * - v2（`{ version: 2, plan, ... }`）：规范化数组字段，缺失补空；
 * - v1（裸 `Plan`）：包成 v2，`plannedAt` 取 `plan.createdAt`，其余三个集合为空；
 * - 其它（null / 非对象 / 缺 runId·sessionId·tasks）：返回 null，由调用方当成「没有这次运行」。
 *
 * `progress` / `stallAlerts` / `triggers` 是 v2 之后**追加的可选字段**：旧 v2 文件没有它们时补空对象/空数组，
 * 因此 `version` 不变（不需要迁移脚本，也不会让旧文件被判成坏文件）。
 */
export function wrapLegacy(raw: unknown): RunState | null {
  if (!isRecord(raw)) return null
  const plan = normalizePlan(isRecord(raw.plan) ? raw.plan : raw)
  if (plan === null) return null
  return {
    version: RUN_STATE_VERSION,
    plan,
    plannedAt: finiteNumber(raw.plannedAt, plan.createdAt),
    messages: capMessages(asArray<MessageRecord>(raw.messages)),
    bindings: asArray<MemberBinding>(raw.bindings),
    routeAudits: asArray<RouteAudit>(raw.routeAudits),
    progress: normalizeProgress(raw.progress),
    stallAlerts: normalizeStallAlerts(raw.stallAlerts),
    triggers: normalizeTriggers(raw.triggers),
    // v2 老文件没有 pause 字段：归一后是 undefined = 未暂停（向后兼容，不需要迁移脚本）。
    pause: normalizePause(raw.pause),
    // r13：旧 v3 文件没有这些字段，归一后是 undefined —— 面板按「不可得」显示，load 绝不抛。
    project: normalizeLabel(raw.project),
    finishedAt: finiteOptional(raw.finishedAt),
    usage: normalizeUsage(raw.usage),
    taskTimes: normalizeTaskTimes(raw.taskTimes),
    pendingConfirmation: normalizePending(raw.pendingConfirmation),
    forceParallel: normalizeIdList(raw.forceParallel),
    termination: normalizeTermination(raw.termination),
    // r23：自动沉淀幂等键必须随 run 一起读回；丢了它，每次 load→save 都会重写同一条记忆。
    memorySunkAt: finiteOptional(raw.memorySunkAt),
  }
}

/**
 * runId 生成：时间戳 + 会话短 hash（+ 可选 salt）。
 *
 * 时间戳是**毫秒**级，同一会话同一毫秒连出两份计划本来会得到同一个 id，后一份静默覆盖
 * 前一份（QA D2）。因此把去重做成显式 salt：唯一性由 {@link uniqueRunId} 负责，
 * 生成器本身保持纯函数（同样的入参给同样的值，便于单测）。
 */
export function makeRunId(sessionId: string, now: number, salt = ''): string {
  let hash = 0
  for (let index = 0; index < sessionId.length; index += 1) {
    hash = (hash * 31 + sessionId.charCodeAt(index)) % 0xffff
  }
  const suffix = salt === '' ? '' : `-${salt}`
  return `run-${now.toString(36)}-${hash.toString(36)}${suffix}`
}

/** uniqueRunId 只依赖「按 id 读盘」，便于单测注入假 store。 */
export interface RunIdLookup {
  load(runId: string): RunState | null
}

/**
 * 保证在盘上空的 runId：从 `makeRunId(sessionId, now)` 起，撞了就按 -1、-2… 递增 salt。
 *
 * 这是 D2 的机械修复点：**任何**「同一毫秒内可能连出两份计划」的路径都走这里，
 * 而不是各自拼 id。上限 1000 次后加随机后缀兜底（极端情况下也不覆盖别人的计划）。
 */
export function uniqueRunId(store: RunIdLookup, sessionId: string, now: number): string {
  const first = makeRunId(sessionId, now)
  if (store.load(first) === null) return first
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = makeRunId(sessionId, now, String(attempt))
    if (store.load(candidate) === null) return candidate
  }
  return makeRunId(sessionId, now, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
}

const PLAN_STATUSES: readonly PlanStatus[] = ['draft', 'dispatching', 'paused', 'terminated', 'cancelled']
/**
 * 落盘任务的合法状态白名单（读盘时用来把脏值归回 pending）。
 *
 * `interrupted` 必须在这里：watcher 把「成员进程已死、上下文仍在」写成 interrupted（AC-18），
 * 如果读盘时被当成脏值归回 pending，面板会显示「待办」而不是「已中断」，
 * 而 resume 只挑 running|gate|interrupted —— 恢复就会静默跳过这些任务（AC-17 失效）。
 *
 * `paused` 同理（r7 AC-9）：暂停期间任务被冻结成 paused，读盘若归回 pending，
 * 恢复时会把它当「待办」重派一次 —— 已完成的工作被重跑，是暂停功能最坏的事故形态。
 *
 * `waiting`（r11 AC-16）**必须**在白名单里：它的等待关系不落盘（无锁表），但状态本身要落盘，
 * 否则重启后等待中的任务被归回 pending，下一轮把它当普通待办派发出去 —— 写域互斥静默失效。
 * `cancelled` / `skipped`（r11 AC-15/AC-26）是终态：归回 pending 会让「已跳过」的任务复活，
 * 而 skipped 同时是「依赖已满足」的判据（graph.depSatisfied），必须原样存活。
 */
const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'blocked',
  'ready',
  'running',
  /** r11 AC-14：写域被别人占着，等它释放（不占并发、不派成员）。 */
  'waiting',
  'paused',
  'gate',
  'done',
  'rework',
  'failed',
  'interrupted',
  /** r11 AC-15：用户取消（终态，释放写域）。 */
  'cancelled',
  /** r11 AC-26：用户跳过（终态，释放写域，并视为依赖已满足）。 */
  'skipped',
]

/** 消息账本裁剪：只保留最新 `MESSAGES_LIMIT` 条（顺序不变）。 */
function capMessages(messages: MessageRecord[]): MessageRecord[] {
  return messages.length <= MESSAGES_LIMIT ? messages : messages.slice(-MESSAGES_LIMIT)
}

/** 停滞告警裁剪：只保留最新 `STALL_ALERTS_LIMIT` 条（顺序不变）。 */
function capStallAlerts(alerts: ActivityEvent[]): ActivityEvent[] {
  return alerts.length <= STALL_ALERTS_LIMIT ? alerts : alerts.slice(-STALL_ALERTS_LIMIT)
}

/** Trigger 账本裁剪：只保留最新 `TRIGGER_LOG_LIMIT` 条（顺序不变，照 `capStallAlerts` 的形状）。 */
function capTriggers(triggers: TriggerRecord[]): TriggerRecord[] {
  return triggers.length <= TRIGGER_LOG_LIMIT ? triggers : triggers.slice(-TRIGGER_LOG_LIMIT)
}

/**
 * 推进记录裁剪：只保留 live bindings（`!retired`）的 memberId。
 *
 * 为什么在 `save()` 里做而不是在判定里做：判定需要历史记录（否则成员一退休就把基线丢了），
 * 而落盘只需要「对账用得上的那些」——成员死了它的推进记录再也不会被读。
 * 传入的 bindings 为空时返回空对象（不是 undefined）：落盘形态稳定，读取端不必判两种空。
 */
function capProgress(
  progress: Record<string, ProgressRecord> | undefined,
  bindings: MemberBinding[],
): Record<string, ProgressRecord> {
  const out: Record<string, ProgressRecord> = {}
  if (!progress) return out
  const live = new Set(bindings.filter((binding) => !binding.retired).map((binding) => binding.memberId))
  for (const [memberId, record] of Object.entries(progress)) {
    if (live.has(memberId)) out[memberId] = record
  }
  return out
}

/** `progress` 规范化：`at` 必须是有限数字，否则整条丢；`alertedAt` 非法则删（不影响 `at` 的有效性）。 */
function normalizeProgress(raw: unknown): Record<string, ProgressRecord> {
  const out: Record<string, ProgressRecord> = {}
  if (!isRecord(raw)) return out
  for (const [memberId, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    const at = value.at
    if (typeof at !== 'number' || !Number.isFinite(at)) continue
    const record: ProgressRecord = { at }
    const alertedAt = value.alertedAt
    if (typeof alertedAt === 'number' && Number.isFinite(alertedAt)) record.alertedAt = alertedAt
    out[memberId] = record
  }
  return out
}

/**
 * 停滞告警规范化：只留 `kind === 'tool'` 且 `at`/`text` 有效的条目（上限截尾）。
 *
 * 为什么不接受别的 kind：`stallAlerts` 只承载停滞告警，混进其它 kind 会让面板活动流
 * 出现两条来源不同、措辞却相似的行——正是 PRD 反面目标 1 要消灭的重复告警。
 */
function normalizeStallAlerts(raw: unknown): ActivityEvent[] {
  const kept: ActivityEvent[] = []
  for (const value of asArray<unknown>(raw)) {
    if (!isRecord(value)) continue
    if (value.kind !== 'tool') continue
    if (typeof value.at !== 'number' || !Number.isFinite(value.at)) continue
    if (typeof value.text !== 'string' || value.text === '') continue
    kept.push(value as unknown as ActivityEvent)
  }
  return capStallAlerts(kept)
}

/**
 * Trigger 账本规范化：只留字段形状完整、`kind` 在白名单内的条目（上限截尾）。
 *
 * 白名单 `TRIGGER_KINDS` 从 `config.ts` 取（跨文件单点，`team/trigger.ts` 的 `fastOf` 用同一份）
 * —— 两处各写一份字面量时，新增第 5 类会漏改一处，表现为「事件能进来、读盘被当脏值丢掉」。
 *
 * 为什么要逐字段校验而不是整体 `as TriggerRecord[]`：`triggers` 是**可解释性证据**，
 * 一条缺 `dedupeKey` 的脏记录会让去重永久失效（同一事件反复推进），
 * 一条 `at` 非数字的记录会让面板排序出现 `NaN` 行。宁可丢一条，不可留半条。
 */
function normalizeTriggers(raw: unknown): TriggerRecord[] {
  const kept: TriggerRecord[] = []
  for (const value of asArray<unknown>(raw)) {
    if (!isRecord(value)) continue
    if (typeof value.kind !== 'string') continue
    if (!TRIGGER_KINDS.includes(value.kind as TriggerKind)) continue
    if (value.source !== 'event' && value.source !== 'poll') continue
    if (typeof value.at !== 'number' || !Number.isFinite(value.at)) continue
    if (typeof value.runId !== 'string' || value.runId === '') continue
    if (typeof value.dedupeKey !== 'string' || value.dedupeKey === '') continue
    if (typeof value.reason !== 'string' || value.reason === '') continue
    if (typeof value.text !== 'string' || value.text === '') continue
    if (typeof value.accepted !== 'boolean') continue
    kept.push(value as unknown as TriggerRecord)
  }
  return capTriggers(kept)
}

/**
 * 暂停记账归一化（r7 AC-9）：白名单校验，任何一项不合格就整体视为「未暂停」。
 *
 * 为什么整体丢弃而不是局部修补：`pause` 是恢复时的**唯一依据**，半份记录会导致
 * 「有的任务还原成 running、有的回落 ready」——那比当成未暂停更危险（会派发一个其实在跑的任务）。
 * 整体丢弃的后果只有一个：用户需要重新点一次继续（可见、可恢复）。
 */
function normalizePause(raw: unknown): PauseRecord | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return undefined
  if (!PLAN_STATUSES.includes(raw.planStatus as PlanStatus)) return undefined
  if (!isRecord(raw.tasks)) return undefined
  const tasks: Record<string, TaskStatus> = {}
  for (const [taskId, status] of Object.entries(raw.tasks)) {
    if (taskId === '') return undefined
    if (!TASK_STATUSES.includes(status as TaskStatus)) return undefined
    tasks[taskId] = status as TaskStatus
  }
  return { at: raw.at, planStatus: raw.planStatus as PlanStatus, tasks }
}

/* ──────────── r13 追加字段的归一（坏数据只能被丢掉，绝不能让 load/save 抛） ──────────── */

/** r21：收口记录归一 —— 空 reason 视为没有记录（面板显示「未记录原因」而不是空白）。 */
function normalizeTermination(raw: unknown): TerminationRecord | undefined {
  if (!isRecord(raw)) return undefined
  const reason = normalizeLabel(raw.reason)
  if (reason === undefined) return undefined
  const kind =
    raw.kind === 'cancelled' || raw.kind === 'terminated' || raw.kind === 'superseded' || raw.kind === 'stale'
      ? raw.kind
      : 'terminated'
  return { reason, kind }
}

/**
 * 列表摘要用的终态集合：必须与 `team/dispatch.ts` 的 `TERMINAL_TASK_STATUSES` 一致。
 *
 * 不直接 import 那个模块是为了让 `store.ts`（落盘层）保持零运行时依赖 ——
 * 这里只服务「左栏是否标活跃 / run 还有几个进行中任务」这两件事（r18b：`active` 与
 * `ongoing` 共用它），语义偏差的后果只是圆点多一个或少一个，不是派发错误。
 */
const SUMMARY_TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'done',
  'failed',
  'cancelled',
  'skipped',
  'interrupted',
])

/** 可选毫秒值：有限、非负、取整；其余（含 `NaN` / `-1` / 字符串）一律视为缺失。 */
function finiteOptional(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
}

/** 可选标签（项目名 / id / reason）：非空字符串才留，去首尾空白。 */
function normalizeLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text === '' ? undefined : text
}

/** id 列表（`forceParallel`）：去空、去重、保序；空数组归一成 `undefined`（= 没有授权）。 */
function normalizeIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const entry of value) {
    const text = normalizeLabel(entry)
    if (text !== undefined && !out.includes(text)) out.push(text)
  }
  return out.length > 0 ? out : undefined
}

/**
 * 一组 token 数字：丢非有限/负数；`total` 缺失时按 `input + cacheRead + output` 补（tech §2.5）。
 *
 * r17 新增 `cacheRead/cacheWrite/calls`：真实宿主把命中缓存的部分单独放在 `cacheReadTokens`
 * （`totalTokens` 已含它），这里必须逐项保留 —— 漏一个字段，重新载入 run 后六项指标就没了。
 */
export function normalizeTokenTotals(raw: unknown): TokenTotals | undefined {
  if (!isRecord(raw)) return undefined
  const input = finiteOptional(raw.input)
  const output = finiteOptional(raw.output)
  const cacheRead = finiteOptional(raw.cacheRead)
  const cacheWrite = finiteOptional(raw.cacheWrite)
  const calls = finiteOptional(raw.calls)
  const declared = finiteOptional(raw.total)
  if (
    declared === undefined &&
    input === undefined &&
    output === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined &&
    calls === undefined
  ) {
    return undefined
  }
  const totals: TokenTotals = { total: declared ?? (input ?? 0) + (cacheRead ?? 0) + (output ?? 0) }
  if (input !== undefined) totals.input = input
  if (output !== undefined) totals.output = output
  if (cacheRead !== undefined) totals.cacheRead = cacheRead
  if (cacheWrite !== undefined) totals.cacheWrite = cacheWrite
  if (calls !== undefined) totals.calls = calls
  return totals
}

function normalizeTotalsMap(raw: unknown): Record<string, TokenTotals> {
  const out: Record<string, TokenTotals> = {}
  if (!isRecord(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    const totals = normalizeTokenTotals(value)
    if (totals !== undefined) out[key] = totals
  }
  return out
}

/**
 * 用量记录归一（AC-19）：分项逐条校验，`attribution` 非法时按「有什么推什么」重推。
 *
 * 一个数字都没有的记录归成 `undefined`（= 没收到用量），而不是 `total: 0` ——
 * 后者会让面板诚实地显示「0 token」，而事实是从没拿到过数据。
 */
export function normalizeUsage(raw: unknown): UsageRecord | undefined {
  if (!isRecord(raw)) return undefined
  const byMember = normalizeTotalsMap(raw.byMember)
  const byTask = normalizeTotalsMap(raw.byTask)
  const total = normalizeTokenTotals(raw.total)
  if (total === undefined && Object.keys(byMember).length === 0 && Object.keys(byTask).length === 0) return undefined
  const declared = raw.attribution
  const attribution: UsageAttribution =
    declared === 'per-member' || declared === 'aggregate-only' || declared === 'unavailable'
      ? declared
      : Object.keys(byMember).length > 0
        ? 'per-member'
        : 'aggregate-only'
  const record: UsageRecord = { attribution, byMember, byTask, updatedAt: finiteOptional(raw.updatedAt) ?? 0 }
  if (total !== undefined) record.total = total
  return record
}

/** 任务计时归一（AC-20）：只留毫秒整数；`endedAt < startedAt` 的整条丢弃（时间倒流是坏数据）。 */
export function normalizeTaskTimes(raw: unknown): Record<string, TaskTimeRecord> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, TaskTimeRecord> = {}
  for (const [taskId, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    const startedAt = finiteOptional(value.startedAt)
    const endedAt = finiteOptional(value.endedAt)
    if (startedAt === undefined && endedAt === undefined) continue
    if (startedAt !== undefined && endedAt !== undefined && endedAt < startedAt) continue
    const record: TaskTimeRecord = {}
    if (startedAt !== undefined) record.startedAt = startedAt
    if (endedAt !== undefined) record.endedAt = endedAt
    out[taskId] = record
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 待确认动作归一：只认 5 类不可逆动作，且必须补齐该动作执行所需的最小字段。 */
function normalizeIrreversibleAction(raw: unknown): IrreversiblePanelAction | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') return undefined
  switch (raw.type) {
    case 'cancel':
      return { type: 'cancel' }
    case 'cancelTask': {
      const taskId = normalizeLabel(raw.taskId)
      if (taskId === undefined) return undefined
      const reason = normalizeLabel(raw.reason)
      return reason === undefined ? { type: 'cancelTask', taskId } : { type: 'cancelTask', taskId, reason }
    }
    case 'skipTask': {
      const taskId = normalizeLabel(raw.taskId)
      return taskId === undefined ? undefined : { type: 'skipTask', taskId }
    }
    case 'updateAcceptance': {
      const taskId = normalizeLabel(raw.taskId)
      if (taskId === undefined || typeof raw.acceptance !== 'string') return undefined
      return { type: 'updateAcceptance', taskId, acceptance: raw.acceptance }
    }
    case 'forceParallel': {
      const taskId = normalizeLabel(raw.taskId)
      return taskId === undefined ? undefined : { type: 'forceParallel', taskId }
    }
    default:
      return undefined
  }
}

/** 未决确认归一（AC-13）：缺 `id` / `action` / `runId` 整条丢弃（残缺记录无法被确认或拒绝）。 */
export function normalizePending(raw: unknown): PendingConfirmation | undefined {
  if (!isRecord(raw)) return undefined
  const id = normalizeLabel(raw.id)
  const runId = normalizeLabel(raw.runId)
  const action = normalizeIrreversibleAction(raw.action)
  const createdAt = finiteOptional(raw.createdAt)
  if (id === undefined || runId === undefined || action === undefined || createdAt === undefined) return undefined
  const pending: PendingConfirmation = {
    id,
    action,
    runId,
    createdAt,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    irreversible: true,
  }
  const taskId = normalizeLabel(raw.taskId)
  if (taskId !== undefined) pending.taskId = taskId
  return pending
}

function normalizePlan(raw: Record<string, unknown>): Plan | null {
  const { runId, sessionId, tasks } = raw
  if (typeof runId !== 'string' || runId === '') return null
  if (typeof sessionId !== 'string' || !Array.isArray(tasks)) return null
  const plan: Plan = {
    runId,
    sessionId,
    createdAt: finiteNumber(raw.createdAt, 0),
    status: PLAN_STATUSES.includes(raw.status as PlanStatus) ? (raw.status as PlanStatus) : 'draft',
    tasks: tasks.map(normalizeTask).filter((task): task is PlanTask => task !== null),
    maxConcurrent: clampConcurrency(raw.maxConcurrent),
  }
  // r14 AC-15：`wrapLegacy` / 旧文件透传 goal；写成可选字段，旧夹具形状保持不变。
  const goal = normalizeLabel(raw.goal)
  if (goal !== undefined) plan.goal = goal
  // r21：需求修订留痕（旧文件没有 = 从未修订；坏条目丢弃而不是让整个 run 读不出来）。
  const revisions = normalizeRevisions(raw.revisions)
  if (revisions.length > 0) plan.revisions = revisions
  return plan
}

/** r21：修订记录归一 —— `at` 必须有效、`text` 允许为空（只改任务时没有新需求正文）。 */
function normalizeRevisions(raw: unknown): PlanRevision[] {
  const out: PlanRevision[] = []
  for (const value of asArray<unknown>(raw)) {
    if (!isRecord(value)) continue
    const at = finiteOptional(value.at)
    if (at === undefined) continue
    const revision: PlanRevision = {
      at,
      text: typeof value.text === 'string' ? value.text : '',
      updatedTaskIds: stringList(value.updatedTaskIds),
      addedTaskIds: stringList(value.addedTaskIds),
      cancelledTaskIds: stringList(value.cancelledTaskIds),
    }
    if (typeof value.changeSummary === 'string' && value.changeSummary.trim() !== '') {
      revision.changeSummary = value.changeSummary.trim()
    }
    out.push(revision)
  }
  return out
}

/** 单个任务的最小结构校验：旧文件里缺字段时补默认值，坏条目直接丢弃。 */
function normalizeTask(raw: unknown): PlanTask | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null
  const task: PlanTask = {
    ...(raw as unknown as PlanTask),
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : raw.id,
    roleId: typeof raw.roleId === 'string' ? raw.roleId : '',
    dependsOn: Array.isArray(raw.dependsOn)
      ? raw.dependsOn.filter((dep): dep is string => typeof dep === 'string')
      : [],
    acceptance: typeof raw.acceptance === 'string' ? raw.acceptance : '',
    status: TASK_STATUSES.includes(raw.status as TaskStatus) ? (raw.status as TaskStatus) : 'pending',
  }

  // r11 新增的三个可选字段：只有真的带内容才留在对象上（旧文件的形态保持不变）。
  const writeScopes = stringList(raw.writeScopes)
  if (writeScopes.length > 0) task.writeScopes = writeScopes
  else delete task.writeScopes

  const waitingOn = stringList(raw.waitingOn)
  if (waitingOn.length > 0) task.waitingOn = waitingOn
  else delete task.waitingOn

  const waitReason = typeof raw.waitReason === 'string' ? raw.waitReason.trim() : ''
  if (waitReason !== '') task.waitReason = waitReason
  else delete task.waitReason

  // r21：需求修订留痕 —— 只在真的有值时留在对象上，旧文件的形态保持不变。
  const revisedAt = finiteOptional(raw.revisedAt)
  if (revisedAt !== undefined) task.revisedAt = revisedAt
  else delete task.revisedAt
  const revisionNote = typeof raw.revisionNote === 'string' ? raw.revisionNote.trim() : ''
  if (revisionNote !== '') task.revisionNote = revisionNote
  else delete task.revisionNote
  const cancelledAt = finiteOptional(raw.cancelledAt)
  if (cancelledAt !== undefined) task.cancelledAt = cancelledAt
  else delete task.cancelledAt
  const cancelReason = typeof raw.cancelReason === 'string' ? raw.cancelReason.trim() : ''
  if (cancelReason !== '') task.cancelReason = cancelReason
  else delete task.cancelReason
  const cancelledBy =
    raw.cancelledBy === 'revision' || raw.cancelledBy === 'user' || raw.cancelledBy === 'stale'
      ? raw.cancelledBy
      : undefined
  if (cancelledBy !== undefined) task.cancelledBy = cancelledBy
  else delete task.cancelledBy

  return task
}

/** 字符串数组清洗：丢非字符串、去首尾空白、丢空串（保持声明顺序）。 */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/** 并发上限统一夹到 [1, MAX_CONCURRENT_LIMIT]，缺失取默认 3。 */
function clampConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_CONCURRENT
  return Math.min(MAX_CONCURRENT_LIMIT, Math.max(1, Math.trunc(value)))
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
