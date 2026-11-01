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
  PlanStatus,
  PlanTask,
  ProgressRecord,
  RouteAudit,
  TaskStatus,
  TriggerKind,
  TriggerRecord,
} from '../shared/types.ts'
import { DEFAULT_MAX_CONCURRENT, MAX_CONCURRENT_LIMIT, TRIGGER_KINDS, TRIGGER_LOG_LIMIT } from './config.ts'

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
}

/** 运行列表的一行（面板/恢复入口用，不含消息账本等大字段）。 */
export interface RunSummary {
  runId: string
  sessionId: string
  createdAt: number
  status: PlanStatus
  tasks: number
  done: number
}

export class RunsStore {
  /** 显式字段赋值而非构造器参数属性：node --test 的类型剥离（strip-only）不支持参数属性。 */
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
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
  save(state: RunState): void {
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
    }
    const tmp = `${path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
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
      out.push({
        runId: plan.runId,
        sessionId: plan.sessionId,
        createdAt: plan.createdAt,
        status: plan.status,
        tasks: plan.tasks.length,
        done: plan.tasks.filter((task) => task.status === 'done').length,
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
 */
const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'blocked',
  'ready',
  'running',
  'paused',
  'gate',
  'done',
  'rework',
  'failed',
  'interrupted',
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

function normalizePlan(raw: Record<string, unknown>): Plan | null {
  const { runId, sessionId, tasks } = raw
  if (typeof runId !== 'string' || runId === '') return null
  if (typeof sessionId !== 'string' || !Array.isArray(tasks)) return null
  return {
    runId,
    sessionId,
    createdAt: finiteNumber(raw.createdAt, 0),
    status: PLAN_STATUSES.includes(raw.status as PlanStatus) ? (raw.status as PlanStatus) : 'draft',
    tasks: tasks.map(normalizeTask).filter((task): task is PlanTask => task !== null),
    maxConcurrent: clampConcurrency(raw.maxConcurrent),
  }
}

/** 单个任务的最小结构校验：旧文件里缺字段时补默认值，坏条目直接丢弃。 */
function normalizeTask(raw: unknown): PlanTask | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null
  return {
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
