/**
 * 面板的**纯视图模型**：没有 JSX、没有 React、没有 IO。
 *
 * 存在的理由（TECHNICAL §6 / DESIGN §0.4）：AC-18 的「成员已死但面板还显示运行中」、
 * AC-22 的「逐角色模型逐字展示 + 未下发标注」这些**可核验文本**原先长在带 JSX 的组件里，
 * 只能靠 QA 眼看。抽到这里之后 `node --test` 就能直接断言文案与状态映射。
 *
 * 纪律：
 *  1. 单向流动 —— viewmodel 出文案，组件只渲染。组件里**禁止**再写一份状态→文案的映射表
 *     （同一状态两处文案必然漂移，是本项目的历史 bug 族）。
 *  2. 数据只读不造 —— 缺字段一律给保守默认值（见 viewExtras），绝不用 `!` 强断。
 *  3. 纯函数 —— 同样的输入永远同样的输出，时间由调用方传入（便于单测固定）。
 */
import { TASK_STATUS_LABELS, taskActionAllowed, taskActionDisabledReason } from '../shared/task-actions.ts'
import type { TaskActionName } from '../shared/task-actions.ts'
import { roleStateOf, roleUsageCellOf } from '../shared/role-view.ts'
import type {
  CaptainModelView,
  DeviationView,
  DurationCell,
  DurationState,
  FlowEdgeView,
  FlowNodeView,
  FlowView,
  LibraryView,
  MemberStatus,
  MemberView,
  MemoryCurateReport,
  MemoryEntryView,
  MemoryFileView,
  MemoryItemView,
  MemoryLevel,
  MemoryQuotaView,
  MemoryTrack,
  PanelAction,
  PanelSnapshot,
  PendingConfirmationView,
  PlanRevision,
  PlanStatus,
  PlanTask,
  Role,
  RoleModelRoute,
  RoleTaskRef,
  RoleUsageView,
  RunDetailView,
  ScopeLockView,
  TaskDetailView,
  TaskStatus,
  TokenTotals,
  UsageCell,
  UsageMetric,
  UsageSource,
} from '../shared/types.ts'

/** dock 胶囊的 5 种 tone（DESIGN §2：关/待派发=idle，计划就绪=plan，在跑=run，失败=fail，全绿=done）。 */
export type CapsuleTone = 'idle' | 'run' | 'plan' | 'done' | 'fail'

export interface Capsule {
  tone: CapsuleTone
  text: string
  /** 悬停说明（阶段判定 detail）；缺省时渲染方回落用 text（r26）。 */
  title?: string
}

/** 徽标的语义 tone（styles.ts 的 [data-tone] 选择器据此上色）。 */
export type BadgeTone = 'business' | 'neutral' | 'warn' | 'danger' | 'success'

/** 「图标 + 文字 + 颜色」三元组：色弱与暗色主题下靠形状仍可分（DESIGN §0.4）。 */
export interface Badge {
  icon: string
  text: string
  tone: BadgeTone
}

/**
 * 任务状态（13 态）→ 徽标三元组：**文案一律读 `TASK_STATUS_LABELS`**（AC-27）。
 *
 * 宿主拒绝文案与面板徽标从同一张表派生；这里只补「图标 + 色调」两个视觉维度，
 * 不再写第二份中文。r11 新增 waiting / cancelled / skipped：等待是琥珀（被挡住，不是失败），
 * 取消与跳过是中性 —— 用户主动行为不该标红。
 */
const TASK_BADGES: Record<string, Badge> = {
  running: { icon: '●', text: TASK_STATUS_LABELS.running, tone: 'business' },
  blocked: { icon: '⛓', text: TASK_STATUS_LABELS.blocked, tone: 'warn' },
  rework: { icon: '↺', text: TASK_STATUS_LABELS.rework, tone: 'warn' },
  done: { icon: '✓', text: TASK_STATUS_LABELS.done, tone: 'success' },
  failed: { icon: '✕', text: TASK_STATUS_LABELS.failed, tone: 'danger' },
  interrupted: { icon: '⚡', text: TASK_STATUS_LABELS.interrupted, tone: 'danger' },
  pending: { icon: '·', text: TASK_STATUS_LABELS.pending, tone: 'neutral' },
  ready: { icon: '▸', text: TASK_STATUS_LABELS.ready, tone: 'business' },
  gate: { icon: '⚖', text: TASK_STATUS_LABELS.gate, tone: 'warn' },
  paused: { icon: '⏸', text: TASK_STATUS_LABELS.paused, tone: 'warn' },
  waiting: { icon: '⏳', text: TASK_STATUS_LABELS.waiting, tone: 'warn' },
  cancelled: { icon: '⊘', text: TASK_STATUS_LABELS.cancelled, tone: 'neutral' },
  skipped: { icon: '↷', text: TASK_STATUS_LABELS.skipped, tone: 'neutral' },
}

/** 成员状态（7 态）∪ 任务状态（13 态）的完整映射表 —— **全项目唯一一份**。 */
const BADGES: Record<string, Badge> = {
  ...TASK_BADGES,
  idle: { icon: '○', text: '空闲', tone: 'neutral' },
  // r21：宿主新增的两个成员态（`MemberStatus`），任务态表里没有同名词。
  // 「停止中」= 中断已发出、尚未确认；「已停止」= 已确认停止，都是忠实回显宿主字段。
  stopping: { icon: '◔', text: '停止中', tone: 'warn' },
  stopped: { icon: '■', text: '已停止', tone: 'neutral' },
}

const UNKNOWN_BADGE: Badge = { icon: '?', text: '未知', tone: 'neutral' }

/**
 * 成员卡专用徽标表（r21）。
 *
 * 与任务卡共用 `badge.text` 会冲突：任务 `waiting` 的文案是「等待中」（13 态词表，
 * 被 test/viewmodel.test.ts 与 test/client-ui.test.ts 钉死），而成员 `waiting` 的语义
 * 是**等待写域**。任务卡继续用 `statusBadge`，成员卡用本表 —— 两边都只读宿主状态，
 * 各自的中文在唯一一张表里。
 */
const MEMBER_BADGES: Record<string, Badge> = {
  ...BADGES,
  waiting: { icon: '⏳', text: '等待写域', tone: 'warn' },
}

/**
 * 成员状态 → 徽标（r21）：只给成员卡/成员页用。
 *
 * 之前成员卡的 `waiting` 落到任务词表显示「等待中」，看不出成员在等写域；
 * `stopping`/`stopped` 没有词表条目时更会回显英文原文。
 */
export function memberStatusBadge(status: MemberStatus | string): Badge {
  return MEMBER_BADGES[status] ?? { ...UNKNOWN_BADGE, text: status === '' ? '未知' : status }
}

/** 成员状态的悬停说明（r21）：只解释宿主已下发的事实，不推断「应该已经停了」。 */
export function memberStatusTitleOf(status: MemberStatus | string): string | undefined {
  if (status === 'stopping') return '已发出中断，尚未确认停止'
  if (status === 'stopped') return '中断已确认，成员已停止'
  return undefined
}

/** 需要独立徽标提示的成员态（r21）：这些态在角色卡上会被角色聚合状态盖住。 */
export const MEMBER_CARD_STATUSES: readonly MemberStatus[] = [
  'waiting',
  'stopping',
  'stopped',
  'cancelled',
]

/**
 * 角色卡上的成员态 chip（r21）：只在「角色状态看不出成员实况」时返回。
 *
 * 角色卡的状态来自 `roleStateOf(tasks)`（按任务聚合）；成员被中断/任务作废/等写域时，
 * 角色卡可能仍显示「待命」。这份 chip 只补成员事实，不替换角色状态。
 */
export function memberCardChipOf(member: MemberView | undefined): Badge | undefined {
  if (member === undefined) return undefined
  if (!MEMBER_CARD_STATUSES.includes(member.status)) return undefined
  const badge = memberStatusBadge(member.status)
  // r21 AC-4：已确认停止的成员把确认时刻一起显示（时间戳由宿主给，客户端零推断）。
  if (member.status === 'stopped' && typeof member.stoppedAt === 'number' && member.stoppedAt > 0) {
    return { ...badge, text: `${badge.text} ${formatStamp(member.stoppedAt)}` }
  }
  return badge
}

/**
 * 状态 → 徽标三元组。
 *
 * 入参故意放宽到 string：宿主侧的 4 态（running|inactive|provisioning|failed）在
 * `host/team/watcher.ts` 就被映射成 7 态了，组件拿到的永远是 7 态；放宽只是为了
 * 遇到未预期值时**显示原文而不是空白**（空白正是「界面点了没反应」的同类体验）。
 */
export function statusBadge(status: MemberStatus | TaskStatus | string): Badge {
  return BADGES[status] ?? { ...UNKNOWN_BADGE, text: status === '' ? '未知' : status }
}

/** 各处展示「最近一次刷新/事件」用的时钟格式（本地时间，秒级 —— 对账要用到秒）。 */
export function formatClock(ts: number | null | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '—'
  const date = new Date(ts)
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value))
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 计划时间戳（AC-30）：要能一眼看出「计划生成于派发之前」，所以带日期。 */
export function formatStamp(ts: number | null | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '—'
  const date = new Date(ts)
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value))
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(ts)}`
}

/** 相对时间（成员「最近事件」一列）：`now` 由调用方传入，保证纯函数可测。 */
export function formatRelative(ts: number | null | undefined, now: number): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '—'
  const base = Number.isFinite(now) ? now : ts
  const delta = Math.max(0, base - ts)
  if (delta < 5000) return '刚刚'
  if (delta < 60_000) return `${Math.floor(delta / 1000)} 秒前`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return `${Math.floor(delta / 86_400_000)} 天前`
}

/** 取末尾 n 行（门禁证据只给尾部，全量在 artifacts 指向的日志里）。 */
export function tailLines(text: string | null | undefined, n: number): string[] {
  if (typeof text !== 'string' || text === '') return []
  const count = Math.floor(n)
  if (!Number.isFinite(count) || count <= 0) return []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  // 命令输出几乎总以换行结尾，末尾的空行不该占用「尾部 n 行」的名额
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()
  return lines.slice(-count)
}

/* ────────────────────────── 运行时投影（容忍字段缺席） ────────────────────────── */

/** 一条直达消息（AC-16）：from/to/taskId/时间戳都要能核验。 */
export interface MessageView {
  at: number
  from: string
  to: string
  toMemberId?: string
  taskId?: string
  body: string
  messageId?: string
}

/** 一次逐角色模型的路由审计（AC-22）。 */
export interface RouteView {
  taskId: string
  roleId: string
  declared: RoleModelRoute | null
  actual: RoleModelRoute | null
  at: number
  verdict: 'ok' | 'drift' | 'unverified'
}

export interface ConcurrencyView {
  limit: number
  running: number
  source: 'host' | 'default'
  /** 用户设置里填的上限；缺省等于 `limit`（老快照没有这两个字段时按「没被夹」渲染）。 */
  requested: number
  /** true = 填的值被更小的上限夹住，界面必须给出可读说明（R2 / QA-R7-03）。 */
  clamped: boolean
}

export interface ViewExtras {
  plannedAt?: number
  messages: MessageView[]
  routeAudits: RouteView[]
  concurrency: ConcurrencyView
}

/** 宿主未给出并发上限时的展示兜底（与 host/config.ts 的默认值同值；client 不得 import host）。 */
const FALLBACK_CONCURRENCY_LIMIT = 3

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function routeOf(value: unknown): RoleModelRoute | null {
  if (value === null || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const provider = str(raw.provider).trim()
  const model = str(raw.model).trim()
  if (provider === '' && model === '') return null
  const route: RoleModelRoute = { provider, model }
  const effort = raw.reasoningEffort
  if (effort === 'low' || effort === 'medium' || effort === 'high') route.reasoningEffort = effort
  return route
}

function messagesOf(value: unknown): MessageView[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const raw = (item ?? {}) as Record<string, unknown>
    const message: MessageView = {
      at: num(raw.at) ?? 0,
      from: str(raw.from),
      to: str(raw.to),
      body: str(raw.body),
    }
    const toMemberId = str(raw.toMemberId)
    if (toMemberId !== '') message.toMemberId = toMemberId
    const taskId = str(raw.taskId)
    if (taskId !== '') message.taskId = taskId
    const messageId = str(raw.messageId)
    if (messageId !== '') message.messageId = messageId
    return message
  })
}

function routesOf(value: unknown): RouteView[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const raw = (item ?? {}) as Record<string, unknown>
    const verdict = raw.verdict === 'ok' || raw.verdict === 'drift' ? raw.verdict : 'unverified'
    return {
      taskId: str(raw.taskId),
      roleId: str(raw.roleId),
      declared: routeOf(raw.declared),
      actual: routeOf(raw.actual),
      at: num(raw.at) ?? 0,
      verdict,
    }
  })
}

function countRunning(tasks: PlanTask[]): number {
  return tasks.filter((task) => task.status === 'running' || task.status === 'gate').length
}

function concurrencyOf(value: unknown, tasks: PlanTask[]): ConcurrencyView {
  const raw = (value ?? {}) as Record<string, unknown>
  const limit = num(raw.limit)
  const running = num(raw.running)
  const effective = limit !== undefined && limit > 0 ? limit : FALLBACK_CONCURRENCY_LIMIT
  const requested = num(raw.requested)
  return {
    limit: effective,
    running: running !== undefined && running >= 0 ? running : countRunning(tasks),
    source: raw.source === 'host' ? 'host' : 'default',
    requested: requested !== undefined && requested > 0 ? requested : effective,
    clamped: requested !== undefined && requested > effective,
  }
}

/**
 * 面板快照之外的扩展字段（plannedAt / messages / routeAudits / concurrency）。
 *
 * 为什么单独投影而不是直接读字段：这几个字段是本期新增的，宿主与 client 的发布节奏
 * 可以不同步。缺字段时给空数组/兜底值，界面降级成「少一栏」而不是整页白屏。
 */
export function viewExtras(snapshot: PanelSnapshot | null | undefined): ViewExtras {
  const raw = (snapshot ?? {}) as Record<string, unknown>
  const tasks = Array.isArray(raw.tasks) ? (raw.tasks as PlanTask[]) : []
  const extras: ViewExtras = {
    messages: messagesOf(raw.messages),
    routeAudits: routesOf(raw.routeAudits),
    concurrency: concurrencyOf(raw.concurrency, tasks),
  }
  const plannedAt = num(raw.plannedAt)
  if (plannedAt !== undefined) extras.plannedAt = plannedAt
  return extras
}

/** 取某任务/角色最近一次路由审计。 */
export function routeAuditFor(
  audits: readonly RouteView[],
  key: { taskId?: string; roleId?: string },
): RouteView | undefined {
  let found: RouteView | undefined
  for (const audit of audits) {
    if (key.taskId !== undefined && audit.taskId !== key.taskId) continue
    if (key.roleId !== undefined && audit.roleId !== key.roleId) continue
    if (found === undefined || audit.at >= found.at) found = audit
  }
  return found
}

/** 把 `provider/model #effort` 这样的文本解析回 structure（宿主老字段 modelRoute 是字符串）。 */
export function parseRouteText(text: string | null | undefined): RoleModelRoute | null {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (raw === '') return null
  const [head, ...rest] = raw.split('#')
  const [provider = '', model = ''] = (head ?? '').split('/')
  const effort = rest.join('#').trim()
  const route: RoleModelRoute = { provider: provider.trim(), model: model.trim() }
  if (effort === 'low' || effort === 'medium' || effort === 'high') route.reasoningEffort = effort
  if (route.provider === '' && route.model === '') return null
  return route
}

/** 路由文案：`provider/model #effort`，逐字不省略（AC-22）。 */
export function routeTextOf(route: RoleModelRoute | null | undefined): string {
  if (route === null || route === undefined) return ''
  const provider = (route.provider ?? '').trim()
  const model = (route.model ?? '').trim()
  if (provider === '' && model === '') return ''
  const effort = route.reasoningEffort !== undefined ? ` #${route.reasoningEffort}` : ''
  return `${provider}/${model}${effort}`
}

function routeVerdictLabel(audit: RouteView | null | undefined): string {
  if (audit === null || audit === undefined) return '未下发'
  if (audit.verdict === 'ok') return '已核对'
  if (audit.verdict === 'drift') {
    const actual = routeTextOf(audit.actual)
    return actual === '' ? '路由漂移' : `路由漂移（实际 ${actual}）`
  }
  return '未下发'
}

/**
 * 逐角色模型文案（AC-22）。
 *
 * 三档口径（诚实优先于好看）：
 *  - 未配置 → `会话默认模型`；
 *  - 已配置且审计 ok → `provider/model · 已核对`；
 *  - 已配置但宿主没下发（verdict=unverified，或压根没审计过）→ 显式 `· 未下发`。
 *    **绝不静默退回队长模型** —— 用户必须知道这一条没生效。
 */
export function formatModelRoute(
  route: RoleModelRoute | null | undefined,
  audit?: RouteView | null,
): string {
  const base = routeTextOf(route)
  if (base === '') return '会话默认模型'
  return `${base} · ${routeVerdictLabel(audit)}`
}

/** 成员行上的路由文案：优先用宿主新给的 route 对象，否则解析老的 modelRoute 字符串。 */
export function memberRouteText(
  member: MemberView,
  audits: readonly RouteView[] = [],
): string {
  const explicit = (member as unknown as { model?: RoleModelRoute }).model
  const declared = routeOf(explicit) ?? parseRouteText(member.modelRoute)
  const audit = routeAuditFor(audits, { taskId: member.taskId, roleId: member.roleId })
  if (declared === null) {
    // 宿主既没给 route 对象、modelRoute 也解析不出结构：原样展示，别吞掉信息
    const raw = typeof member.modelRoute === 'string' ? member.modelRoute.trim() : ''
    if (raw === '') return '会话默认模型'
    return `${raw} · ${routeVerdictLabel(audit)}`
  }
  return formatModelRoute(declared, audit)
}

/* ─────────────────── 停滞条与账本（r4：第二层停滞检测） ─────────────────── */

/**
 * 停滞短标签（TECHNICAL §5.1 冻结的文案，逐字）。
 *
 * 面板正文用的是更好读、且写明「成员还活着」的整句（`STALL_LEAD` + 秒数 + `STALL_TAIL`，
 * 逐字来自 DESIGN §7.5）；这句只作为停滞条的悬停说明，交代判定口径是「无实质工具调用」，
 * 而不是「成员已退出」——`interrupted` 才是那个意思。
 */
export const STALL_SUFFIX = '无实质工具调用，疑似停滞'

/** 停滞整句的前半段（不含秒数，秒数由渲染处用宿主下发的文本插入）。 */
export const STALL_LEAD = '疑似停滞 · 成员还活着，但已'

/** 停滞整句的后半段。 */
export const STALL_TAIL = '没有实质产出'

/** 账本正文超过这个字符数就要折叠（DESIGN §0.7）。 */
export const LEDGER_FOLD_CHARS = 120

/** 账本正文超过这个行数就要折叠（DESIGN §0.7）。 */
export const LEDGER_FOLD_LINES = 3

export interface StallRow {
  /** 是否渲染停滞条：`running` 且宿主判定的 `stalled` 为真。 */
  show: boolean
  /** 只放宿主下发的 `stalledSecondsText`，客户端绝不自己从毫秒算。 */
  secondsText: string
  /** 整句（含 ⏳ 与秒数），供单测与无障碍文案复用，渲染处按段拆。 */
  text: string
}

/**
 * 成员行停滞条（AC-12 / AC-14）。
 *
 * 判定只用宿主下发的 `stalled`，**不看 `stalledForMs > 0`**——阈值只有一个出口（watcher），
 * 客户端再有第二个比较就等于把判定分叉。`interrupted` / `failed` 永不渲染停滞条：
 * 那两种是「已经出事」，与「活着但没产出」是两回事（PRD 反面目标 4）。
 */
export function stalledRowOf(member: MemberView): StallRow {
  // 旧快照没有这三个字段：按「未停滞」处理，不得抛错（AC-12 的向后兼容）
  const stalled = (member as { stalled?: unknown }).stalled === true
  if (member.status !== 'running' || !stalled) return { show: false, secondsText: '', text: '' }
  const raw = typeof member.stalledSecondsText === 'string' ? member.stalledSecondsText.trim() : ''
  // 宿主理论上总会给秒数；万一没给，宁可显示占位符也不在客户端造一份格式化（零格式化铁律）
  const secondsText = raw === '' ? '—' : raw
  return { show: true, secondsText, text: `⏳ ${STALL_LEAD} ${secondsText} ${STALL_TAIL}` }
}

/** 账本 `from` 的显示名：captain→队长、peer→上游直投，其余（成员名）原样。 */
const PEER_LABELS: Readonly<Record<string, string>> = { captain: '队长', peer: '上游直投' }

export function peerLabelOf(from: string | null | undefined): string {
  const raw = typeof from === 'string' ? from.trim() : ''
  return PEER_LABELS[raw] ?? raw
}

/**
 * 账本正文是否需要折叠（AC-14 的可见侧：直投 body 最长 800 字，整段平铺会把账本撑爆）。
 *
 * 阈值是「字符数 > 120 或 行数 > 3」而不是纯行数：peer body 有 `white-space: pre-wrap`
 * 的多行结构，也可能是一行超长路径。
 */
export function ledgerBodyFoldable(body: string | null | undefined): boolean {
  const text = typeof body === 'string' ? body : ''
  return text.length > LEDGER_FOLD_CHARS || text.split('\n').length > LEDGER_FOLD_LINES
}

/**
 * dock 胶囊文案（DESIGN §2 的 5 种 tone）。
 *
 * 优先级有意如此：失败 > 中断 > 在跑 > 全绿 > 计划就绪 —— 用户最需要「坏消息」先冒头。
 */
export function capsuleOf(enabled: boolean, snapshot: PanelSnapshot | null | undefined): Capsule {
  if (!enabled) return { tone: 'idle', text: '已关闭' }
  if (snapshot === null || snapshot === undefined) return { tone: 'idle', text: '待派发' }

  const tasks = snapshot.tasks ?? []
  const members = snapshot.members ?? []
  const extras = viewExtras(snapshot)
  const failed = tasks.filter((task) => task.status === 'failed').length
  const interrupted = members.filter((member) => member.status === 'interrupted').length
  const running = countRunning(tasks)
  const done = tasks.filter((task) => task.status === 'done').length
  const limit = extras.concurrency.limit
  // r26：胶囊也读同一个阶段判定 —— 但只有「计划就绪」这条规则并入本函数
  // （其余分支与判定表 5/6/7/9 条同文案，且胶囊额外带并发上限，保持现状不另造一套）。
  const stage = runStageOf({
    // 快照没有计划态字段时，只要已经有任务就说明计划存在（旧宿主快照），按 draft 参与判定；
    // 零任务则保持 undefined → 规则 1「未启用」不会误伤「待派发」的既有文案。
    planStatus: snapshot.planStatus ?? (tasks.length > 0 ? 'draft' : undefined),
    total: tasks.length,
    done,
    running,
    failed,
    interrupted,
    members: members.length,
  })

  if (snapshot.planStatus === 'cancelled') return { tone: 'idle', text: '已取消' }
  if (snapshot.planStatus === 'terminated') return { tone: 'idle', text: '已终止' }
  if (snapshot.planStatus === 'paused') return { tone: 'idle', text: '已暂停' }
  if (failed > 0) return { tone: 'fail', text: `有失败 · ${failed}` }
  if (interrupted > 0) return { tone: 'fail', text: `已中断 · ${interrupted}` }
  if (running > 0) return { tone: 'run', text: `运行中 ${running}/${limit}` }
  if (tasks.length > 0 && done === tasks.length) {
    return { tone: 'done', text: `已完成 · ${tasks.length} 任务` }
  }
  // AC-30：计划已生成但**一个成员都还没创建** —— 这是「先计划、后派发」的可视证据。
  // r26：必须同时满足判定表第 10 条（零成员 **且** 一个都没完成），draft + 部分完成
  // 不能再被说成「计划就绪」。
  if (stage.key === 'ready') {
    return { tone: 'plan', text: stage.label, ...(stage.detail === undefined ? {} : { title: stage.detail }) }
  }
  if (members.length === 0) return { tone: 'idle', text: '待派发' }
  if (snapshot.planStatus === 'dispatching') {
    return { tone: 'run', text: `派发中 · ${members.length}/${limit}` }
  }
  return { tone: 'idle', text: `进行中 · ${done}/${tasks.length}` }
}

/* ────────────────────────── 动作与回执 ────────────────────────── */

/**
 * 面板可发的动作。
 *
 * 为什么在 PanelAction 之外再补三个形态：`dispatch{runId}` / `setTaskRole` / `receipt`
 * 是本期新增的（AC-30 / AC-14 / AC-19）。写成联合而不是篡改类型契约 ——
 * 契约的唯一来源仍是 `src/shared/types.ts`，这里只是「client 侧可能多问一句」的视图。
 * 收紧的唯一入口是 `Panel.tsx` 里的那一处 `as PanelAction`。
 */
export type ClientAction =
  | PanelAction
  | { type: 'dispatch'; runId?: string }
  | { type: 'setTaskRole'; taskId: string; roleId: string }
  | { type: 'receipt'; taskId: string; note?: string }

/** 一次动作的结果摘要（只给界面用：成功/拒绝/传输失败三种都要有话可说）。 */
export interface ActFeedback {
  ok: boolean
  message?: string
  notices: string[]
}

/**
 * 把 act() 的返回**解一次包**（唯一解包口，组件里不许再解）。
 *
 * 兼容三种历史形态：
 *   { error }                                  —— 传输/校验失败
 *   { data: { snapshot, rejected, notices } }   —— 本期 ActResult 包装
 *   { data: PanelSnapshot }                     —— 脚手架期直接返回快照
 */
export function feedbackOf(result: unknown): ActFeedback {
  if (result === null || result === undefined) return { ok: true, notices: [] }
  const box = result as Record<string, unknown>
  const transportError = str(box.error)
  if (transportError !== '') return { ok: false, message: transportError, notices: [] }

  const payload = (box.data ?? box) as Record<string, unknown>
  if (payload === null || typeof payload !== 'object') return { ok: true, notices: [] }

  const notices = Array.isArray(payload.notices)
    ? payload.notices.filter((item): item is string => typeof item === 'string')
    : []

  const rejected = payload.rejected as Record<string, unknown> | undefined
  if (rejected !== undefined && rejected !== null && typeof rejected === 'object') {
    const message = str(rejected.message).trim()
    const code = str(rejected.code).trim()
    return { ok: false, message: message !== '' ? message : code !== '' ? code : '动作被拒绝', notices }
  }

  return { ok: true, notices }
}

/** 错误的展示文案（空字符串一律换成一句能读懂的话，避免「点了没反应」）。 */
export function hintOf(feedback: ActFeedback): string | undefined {
  if (feedback.ok) return feedback.notices.length > 0 ? feedback.notices.join(' · ') : undefined
  const message = (feedback.message ?? '').trim()
  return message === '' ? '动作未生效（宿主未说明原因）' : message
}

/**
 * 发一个动作并**保证**拿到一句能给用户看的话。
 *
 * 为什么要包一层：`act` 可能 reject（宿主路由未注册、网络中断、宿主侧抛异常）。
 * 直接 `await act(...)` 而不 try/catch 的后果是按钮永远停在 busy 态且界面毫无反应 ——
 * 这正是本项目历史上「点了没反应」那一族 bug 的成因之一，所以在客户端唯一入口处兜住。
 */
export async function actFeedback<A>(
  act: (action: A) => Promise<unknown>,
  action: A,
): Promise<ActFeedback> {
  try {
    return feedbackOf(await act(action))
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), notices: [] }
  }
}

/* ─────────────────── r5：队长模型与「最近推进」（AC-2 / AC-17） ─────────────────── */

/** 「最近推进」默认条数（DESIGN §3：计划页顶部一行，最多 3 条）。 */
export const TRIGGER_ROW_LIMIT = 3

/** 一行「最近推进」：来源徽标 + 时钟 + 已由 host 侧写好的中文原因。 */
export interface TriggerRowView {
  at: number
  /** `HH:MM:SS`（客户端不自己算阈值，只用既有 formatClock 同源格式）。 */
  clock: string
  text: string
  sourceLabel: '自动' | '用户'
  /** 活动事件 kind（9 个既有值之一），渲染成 `data-auto-team-trigger`。 */
  kind: string
}

/**
 * 快照 → 「最近推进」行（**最新在前**）。
 *
 * 只读 `activity`，不读 `triggers`：`activity` 是面板既有数据源，`triggers` 是排查用的原始账本
 * （含 dropped）。两条都渲染会出现「同一次推进显示两遍」，也会让面板看起来在讲内部实现。
 *
 * 只取**带 `source`** 的事件：缺省 = 历史事件（老数据没有来源，不能倒推成自动，
 * 那会把用户自己点出来的动作说成「系统自动推进」）。
 */
export function recentTriggersOf(
  snapshot: PanelSnapshot | null | undefined,
  limit: number = TRIGGER_ROW_LIMIT,
): TriggerRowView[] {
  const activity = Array.isArray(snapshot?.activity) ? (snapshot as PanelSnapshot).activity : []
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : TRIGGER_ROW_LIMIT
  if (count === 0) return []

  const rows: TriggerRowView[] = []
  for (let index = activity.length - 1; index >= 0 && rows.length < count; index -= 1) {
    const event = activity[index]
    if (event === undefined || event === null || typeof event !== 'object') continue
    const source = event.source
    // 缺省/未知来源 = 历史事件：不渲染，避免把用户动作标成自动
    if (source !== 'trigger' && source !== 'user') continue
    const text = str(event.text).trim()
    if (text === '') continue
    rows.push({
      at: typeof event.at === 'number' ? event.at : 0,
      clock: formatClock(event.at),
      text,
      sourceLabel: source === 'trigger' ? '自动' : '用户',
      kind: str(event.kind) === '' ? 'status' : str(event.kind),
    })
  }
  return rows
}

/** 队长模型三态标签（AC-2）：`unsupported` 必须看起来就是「没生效」，不能像已配置。 */
export interface CaptainModelLabel {
  label: string
  tone: 'ok' | 'warn' | 'muted'
}

/**
 * 队长模型 → 头部一行标签。
 *
 * 三态语义（与 `CaptainModelView.source` 一一对应，不在这里重新推断）：
 *  - `configured`：宿主已按配置指定了主 session 模型 → 展示具体路由，tone=ok；
 *  - `host-default`：没有队长专用配置，跟随宿主默认 → tone=muted（不是错，但也不是「生效」）；
 *  - `unsupported`：宿主给主 session 指定模型的能力未验证/不可用 → tone=warn，文案必须说「未生效」。
 */
export function captainModelLabelOf(
  view: CaptainModelView | null | undefined,
): CaptainModelLabel {
  if (view === null || view === undefined || typeof view !== 'object') {
    return { label: '队长模型 · 未投影', tone: 'muted' }
  }
  const value = str(view.value).trim()
  if (view.source === 'configured') {
    return { label: `队长模型 ${value !== '' ? value : '已配置'}`, tone: 'ok' }
  }
  if (view.source === 'host-default') {
    return { label: '队长模型 跟随宿主默认', tone: 'muted' }
  }
  // unsupported 之外的未知取值也走这条：宁可显示「未生效」也不要假装生效
  return { label: '队长模型 宿主不支持 · 未生效', tone: 'warn' }
}

/* ─────────────────────────── 任务行进度（AC-14） ─────────────────────────── */

/** 任务行的语义 tone（styles.ts 的 [data-tone] 据此上色；与 BadgeTone 不同族，故单列）。 */
export type ProgressTone = 'ok' | 'warn' | 'bad' | 'muted'

export interface TaskProgress {
  status: TaskStatus
  label: string
  tone: ProgressTone
  percent: number
}

/**
 * `TaskStatus` 13 态 → 进度值与颜色（**全项目唯一一份**，AC-14 判据落在 progressOf 上）。
 *
 * label 一律从 `statusBadge` 取，这里**不再写第二遍中文** —— 同一状态两处文案必然漂移。
 * percent 口径：待派发 0 → 就绪 10 → 阻塞/等待 20 → 待返工 40 → 运行中/已暂停 50 →
 * 门禁中 80 → 已通过 100；失败/已中断/已取消/已跳过归 0（要重跑，进度不保留）。
 * 已暂停取 50：暂停冻结在「中途」，既不能假装完成（100），也不能假装没开始（0）。
 */
const TASK_PROGRESS: Record<TaskStatus, { tone: ProgressTone; percent: number }> = {
  pending: { tone: 'muted', percent: 0 },
  ready: { tone: 'muted', percent: 10 },
  blocked: { tone: 'warn', percent: 20 },
  // r11：等待写域 = 被挡住但没失败，进度与阻塞同档；取消/跳过是用户主动行为，退回 0 且不标红。
  waiting: { tone: 'warn', percent: 20 },
  rework: { tone: 'warn', percent: 40 },
  running: { tone: 'ok', percent: 50 },
  paused: { tone: 'warn', percent: 50 },
  gate: { tone: 'warn', percent: 80 },
  done: { tone: 'ok', percent: 100 },
  cancelled: { tone: 'muted', percent: 0 },
  skipped: { tone: 'muted', percent: 0 },
  failed: { tone: 'bad', percent: 0 },
  interrupted: { tone: 'bad', percent: 0 },
}

/** 单条任务的展示态：状态 / 中文标签 / 颜色 / 进度百分比（缺状态一律按 pending 兜底）。 */
export function progressOf(task: PlanTask): TaskProgress {
  const raw = (task as { status?: unknown } | null | undefined)?.status
  const status = typeof raw === 'string' && raw in TASK_PROGRESS ? (raw as TaskStatus) : 'pending'
  const row = TASK_PROGRESS[status]
  return { status, label: statusBadge(status).text, tone: row.tone, percent: row.percent }
}

/* ─────────────────────── 计划状态中文（AC-14 页头 chip） ─────────────────────── */

/** 计划状态的语义 tone。 */
export type PlanStatusTone = 'ok' | 'warn' | 'bad' | 'muted'

export interface PlanStatusView {
  label: string
  tone: PlanStatusTone
}

/**
 * `PlanStatus` 5 态 → 中文 + 颜色（AC-14 页头「完成 x/N + 计划状态」）。
 *
 * 放在 viewmodel 而不是 ui/组件里的理由：13 态中文标签的守卫判据是「只许出现在
 * viewmodel.ts」，而「已暂停」既是任务态也是计划态 —— 分两处写必然被守卫判红，也必然漂移。
 */
const PLAN_STATUS: Record<PlanStatus, PlanStatusView> = {
  draft: { label: '已计划', tone: 'ok' },
  dispatching: { label: '派发中', tone: 'ok' },
  paused: { label: '已暂停', tone: 'warn' },
  terminated: { label: '已终止', tone: 'muted' },
  cancelled: { label: '已取消', tone: 'muted' },
}

/** 计划状态中文：未启用（无计划）走「未启用」，未知取值同样保守回落。 */
export function planStatusView(planStatus?: PlanStatus): PlanStatusView {
  if (!planStatus) return { label: '未启用', tone: 'muted' }
  return PLAN_STATUS[planStatus] ?? { label: '未启用', tone: 'muted' }
}

/** `PlanStatusTone` → `BadgeTone`：计划态没有 run/success/danger，按语义就近对齐。 */
const PLAN_TONE_BADGE_TONE: Record<PlanStatusTone, BadgeTone> = {
  ok: 'business',
  warn: 'warn',
  bad: 'danger',
  muted: 'neutral',
}

/* ───────────── r26：运行阶段（唯一判定，判定表 1..11） ───────────── */

/**
 * 阶段判定表的 11 个结果，数组顺序即优先级（先命中先返回，见 `runStageOf`）。
 *
 * 为什么要单独一个「阶段」而不是继续用 `PlanStatus`：`draft` 既可能是「刚拆好任务、
 * 一个成员都没有」，也可能是「派发过但成员全挂了」；直接把 `draft` 当「计划就绪」渲染
 * 正是历史 bug 的来源。阶段把计划态 + 计数 + 收口信息压成一个用户可读的结论，
 * 是 run 卡 / 历史行 / 页头 chip / run 头 / dock 胶囊的**唯一**文案来源。
 */
export type RunStageKey =
  | 'disabled'
  | 'cancelled'
  | 'terminated'
  | 'paused'
  | 'failed'
  | 'interrupted'
  | 'running'
  | 'closing'
  | 'dispatching'
  | 'ready'
  | 'pending'

/**
 * 阶段判定的输入。计数全部可选：旧数据 / 详情投影没有这些数字时**保持 undefined**，
 * 绝不拿 0 或别的字段反推（反推会把「不知道」说成「没有」）。
 */
export interface RunStageInput {
  planStatus?: PlanStatus
  total?: number
  done?: number
  running?: number
  failed?: number
  interrupted?: number
  members?: number
  terminationReason?: string
  finishedAt?: number
}

export interface RunStageView {
  key: RunStageKey
  label: string
  tone: PlanStatusTone
  /** 人话解释「为什么是这个阶段」：渲染成 title/tooltip，不占版面。 */
  detail?: string
}

/** 阶段图标：只补「形状」一个视觉维度，文案仍只来自 `runStageOf`。 */
const RUN_STAGE_ICON: Record<RunStageKey, string> = {
  disabled: '·',
  cancelled: '⊘',
  terminated: '■',
  paused: '⏸',
  failed: '✕',
  interrupted: '⚑',
  running: '▶',
  closing: '◔',
  dispatching: '◐',
  ready: '·',
  pending: '○',
}

/** 计数规整：只接受有限非负数；缺失 / NaN / 负数一律 `undefined`（不补 0）。 */
function stageCountOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

/**
 * 计划 goal 里的阶段判定表（r26）：**唯一**的阶段判定实现。
 *
 * 优先级从高到低，先命中先返回：
 *  1 无计划 → 未启用；2 已取消；3 已终止（detail 取终止原因）；4 已暂停；
 *  5 有失败；6 已中断；7 执行中；8 任务全部结束但计划未收口 → 待收口；
 *  9 派发中；10 计划就绪（total>0 && 零成员 && done===0）；11 待派发。
 *
 * 「计划就绪」只允许在规则 10 命中时出现 —— 这是 `draft` 不再直接当徽标的机械保证。
 */
export function runStageOf(input: RunStageInput): RunStageView {
  const planStatus = input.planStatus
  const total = stageCountOf(input.total)
  const done = stageCountOf(input.done)
  const running = stageCountOf(input.running)
  const failed = stageCountOf(input.failed)
  const interrupted = stageCountOf(input.interrupted)
  const members = stageCountOf(input.members)
  const reason =
    typeof input.terminationReason === 'string' ? input.terminationReason.trim() : ''
  const finishedAt = stageCountOf(input.finishedAt)
  // 「已收口」= 有终止原因且真的有结束时刻；只有半截信息时按未收口处理（更保守）。
  const closed = reason !== '' && finishedAt !== undefined && finishedAt > 0

  if (planStatus === undefined) {
    return {
      key: 'disabled',
      label: '未启用',
      tone: 'muted',
      detail: '还没有计划：给出目标后，宿主会先拆解任务，再派发给成员',
    }
  }
  if (planStatus === 'cancelled') {
    return {
      key: 'cancelled',
      label: '已取消',
      tone: 'muted',
      detail: reason !== '' ? reason : '计划已取消，不再派发新任务',
    }
  }
  if (planStatus === 'terminated') {
    return {
      key: 'terminated',
      label: '已终止',
      tone: 'muted',
      detail: reason !== '' ? reason : '计划已终止，不再派发新任务',
    }
  }
  if (planStatus === 'paused') {
    return {
      key: 'paused',
      label: '已暂停',
      tone: 'warn',
      detail: '计划已暂停，继续后才会派发新任务',
    }
  }
  if (failed !== undefined && failed > 0) {
    return {
      key: 'failed',
      label: `有失败 · ${failed}`,
      tone: 'bad',
      detail: `${failed} 个任务失败，需要返工或重跑`,
    }
  }
  if (interrupted !== undefined && interrupted > 0) {
    return {
      key: 'interrupted',
      label: `已中断 · ${interrupted}`,
      tone: 'bad',
      detail: `${interrupted} 个成员已中断，可续聊恢复`,
    }
  }
  if (running !== undefined && running > 0) {
    return {
      key: 'running',
      label: total === undefined ? '执行中' : `执行中 · ${done ?? 0}/${total}`,
      tone: 'ok',
      detail:
        total === undefined
          ? `${running} 个任务正在执行`
          : `${total} 个任务已完成 ${done ?? 0} 个，${running} 个正在执行`,
    }
  }
  // 规则 8：任务全部结束，但计划没有收口（没有终止原因 / 没有结束时刻）。
  if (total !== undefined && total > 0 && done === total && !closed) {
    return {
      key: 'closing',
      label: '待收口',
      tone: 'warn',
      detail: '任务已全部结束，计划尚未收口',
    }
  }
  if (planStatus === 'dispatching' || (members !== undefined && members > 0)) {
    return {
      key: 'dispatching',
      label: total === undefined ? '派发中' : `派发中 · ${done ?? 0}/${total}`,
      tone: 'ok',
      detail:
        total === undefined
          ? '计划正在把就绪任务派给成员'
          : `计划正在派发：${done ?? 0}/${total} 个任务已结束`,
    }
  }
  // 规则 10：唯一合法的「计划就绪」。
  if (total !== undefined && total > 0 && members === 0 && done === 0) {
    return {
      key: 'ready',
      label: `计划就绪 · ${total} 任务`,
      tone: 'ok',
      detail: `${total} 个任务已就绪，还没有派发给成员`,
    }
  }
  return {
    key: 'pending',
    label: '待派发',
    tone: 'muted',
    detail:
      total !== undefined && total > 0
        ? `计划尚未进入派发：${done ?? 0}/${total} 个任务已结束`
        : '计划还没有可派发的任务',
  }
}

/** 阶段 → 徽标三元组（图标本表、文案本函数上游、tone 走计划态映射）。 */
export function runStageBadge(stage: RunStageView): Badge {
  return {
    icon: RUN_STAGE_ICON[stage.key] ?? '?',
    text: stage.label,
    tone: PLAN_TONE_BADGE_TONE[stage.tone],
  }
}

/**
 * run 详情（`RunDetailView`，不带计数）→ 阶段。
 *
 * 计数**从真实任务列表派生**（精确值，不是猜）；`members` 这类详情里没有的信息
 * 保持 undefined，让规则 9/10 不被误命中。
 */
export function stageOfDetail(
  detail: RunDetailView,
  counts: Partial<RunStageInput> = {},
): RunStageView {
  const tasks = detail.tasks ?? []
  const done = tasks.filter((task) => task.status === 'done').length
  const running = tasks.filter((task) => task.status === 'running' || task.status === 'gate').length
  const failed = tasks.filter((task) => task.status === 'failed').length
  return runStageOf({
    ...counts,
    planStatus: detail.planStatus,
    total: counts.total ?? tasks.length,
    done: counts.done ?? done,
    running: counts.running ?? running,
    failed: counts.failed ?? failed,
    ...(detail.terminationReason !== undefined
      ? { terminationReason: detail.terminationReason }
      : {}),
    ...(detail.finishedAt !== undefined ? { finishedAt: detail.finishedAt } : {}),
  })
}

/**
 * 当前 run 的阶段判定输入：宿主投影 `runCounts` 优先；旧快照没有投影时按
 * `tasks` / `members` **精确派生**（不是拿 0 冒充缺失：running/failed 由任务态直接数，
 * interrupted 由成员态直接数，members 就是快照里本 run 的成员数）。
 *
 * `planStatus` 保持原样（缺失即 undefined）—— 阶段函数据此走规则 1「未启用」。
 */
export function currentRunStageInputOf(snapshot: PanelSnapshot | null | undefined): RunStageInput {
  const tasks = snapshot?.tasks ?? []
  const members = snapshot?.members ?? []
  const counts = snapshot?.runCounts ?? {}
  const done = tasks.filter((task) => task.status === 'done').length
  return {
    planStatus: snapshot?.planStatus,
    total: tasks.length,
    done,
    running:
      counts.running ?? tasks.filter((task) => task.status === 'running' || task.status === 'gate').length,
    failed: counts.failed ?? tasks.filter((task) => task.status === 'failed').length,
    interrupted: counts.interrupted ?? members.filter((member) => member.status === 'interrupted').length,
    members: counts.members ?? members.length,
  }
}

/* ───────────── r24：残留计划（未收口的 run 可见、可终止） ───────────── */

/**
 * 「还没有收口」的计划态 —— 与宿主 `reconcileStalePlans` 用**同一个集合**。
 *
 * 只有这三种态可能出现在「计划还在，进程已经没了」的场景里；终态
 * （`terminated` / `cancelled`）本身已经收口，不会再被认为是残留。
 */
const UNCLOSED_PLAN_STATUSES: readonly PlanStatus[] = ['draft', 'dispatching', 'paused']

/** 残留计划徽标文案（唯一来源；历史行与 run 卡都读它）。 */
export const RESIDUAL_RUN_BADGE_TEXT = '未收口·可能残留'

/** 徽标悬停解释：说清「凭什么这么判」以及「能做什么」，不做「系统认为」式推断。 */
export const RESIDUAL_RUN_TITLE =
  '计划态为草稿/派发中/已暂停，且没有结束时刻：这次运行没有收口，可能残留。确认没有成员在跑后可点「终止计划」'

/** 终止残留计划的按钮文案（破坏性动作：用结果命名，不用「确定」）。 */
export const CLOSE_RUN_LABEL = '终止计划'

/** 终止成功后的就地提示（宿主返回的新快照会把这一行刷成终态，提示只在刷不到时可见）。 */
export const CLOSE_RUN_DONE_TEXT = '已终止该残留计划'

/** 终止失败、且宿主没给原因的兜底文案（`hintOf` 已优先透传 `rejected.message`）。 */
export const CLOSE_RUN_FAILED_TEXT = '终止失败：宿主未说明原因，请稍后重试'

/** 残留计划徽标（warn tone：不是失败，但需要用户处理）。 */
export const RESIDUAL_RUN_BADGE: Badge = { icon: '⚠', text: RESIDUAL_RUN_BADGE_TEXT, tone: 'warn' }

/** 判定所需的宿主事实（`RunSummary` 的超集兼容：只要这两项）。 */
export interface ResidualRunFacts {
  status: PlanStatus
  finishedAt?: number
}

/**
 * 是否残留计划：**只读宿主事实**，不看任务数、不看 `active`。
 *
 * `active` 在宿主侧等于 `ongoing > 0`（有未终态任务），无法区分「正在跑」与「进程没了」；
 * 因此残留判定严格按 r24 口径：计划态 ∈ {draft,dispatching,paused} 且没有 `finishedAt`。
 * 正在跑的 run 也满足这一条 —— 它同样是「没收口」，徽标文案说的是「可能残留」。
 */
export function isResidualRun(run: ResidualRunFacts): boolean {
  if (!UNCLOSED_PLAN_STATUSES.includes(run.status)) return false
  return run.finishedAt === undefined || !(run.finishedAt > 0)
}

/* ───────────── r25：终态 run 绝不显示为「进行中」 ───────────── */

/**
 * 已收口（终态）的计划态 —— 与宿主 `PLAN_TERMINAL_STATUSES` 用**同一个集合**。
 *
 * 这两个态的 run 里可能还留着旧数据（任务没被终结、宿主下发的 `ongoing > 0`），
 * 客户端必须自己把它们从「进行中」里排除：这是与宿主修正并行的双保险。
 */
const TERMINAL_PLAN_STATUSES: readonly PlanStatus[] = ['terminated', 'cancelled']

/** 判定「run 已收口」所需的宿主事实（`RunSummary` 的超集兼容：只要这三项）。 */
export interface ClosedRunFacts {
  status: PlanStatus
  finishedAt?: number
  terminationReason?: string
}

/**
 * run 是否已经收口（终态）。
 *
 * 两条判据（与任务卡口径一致）：
 *  - 计划态就是 `terminated` / `cancelled`：宿主已明确收口，**即使还带着旧任务的 ongoing>0**；
 *  - 带了终止原因且落了结束时刻：宿主 r21 起终止时才写 `terminationReason`，
 *    两者同时存在说明这次运行已经结束（防旧宿主把计划态写成非终态）。
 *
 * 只读宿主事实，不按 `active` / 任务数反推。
 */
export function isClosedRun(run: ClosedRunFacts): boolean {
  if (TERMINAL_PLAN_STATUSES.includes(run.status)) return true
  const reason = typeof run.terminationReason === 'string' ? run.terminationReason.trim() : ''
  return reason !== '' && typeof run.finishedAt === 'number' && run.finishedAt > 0
}

/**
 * 「终止计划」的二次确认内容（`PendingConfirmationView` 的唯一构造点）。
 *
 * 走既有 `confirmDialogOf` 渲染，因此标题/按钮文案来自 `CONFIRM_VERBS.closeRun`，
 * 这里只提供**影响范围**：1 次运行、停止派发新任务；有存活成员时宿主会拒绝。
 */
export function closeRunPendingOf(runId: string, now: number = Date.now()): PendingConfirmationView {
  return {
    id: `close-run-${runId}`,
    action: 'closeRun',
    runId,
    createdAt: now,
    summary:
      '影响 1 次运行：标记为已终止，不再派发新任务、不再等待门禁；若仍有存活成员，宿主会拒绝本次终止并说明原因',
    irreversible: true,
    waitedText: '刚刚',
  }
}

/* ──────── r11：单任务干预 / 写域占用 / 执行痕迹（F4~F7，DESIGN §3.3~§3.6） ──────── */

/**
 * 三个动作的按钮文案。**只允许出现在这里**：组件里再写一份「取消/跳过/验收」，
 * aria-label 与按钮文字就会在第一次改文案时漂移。
 */
const TASK_ACTION_LABEL: Record<TaskActionName, string> = {
  cancel: '取消',
  skip: '跳过',
  'edit-acceptance': '验收',
}

/** 按钮顺序：取消 → 跳过 → 改验收（破坏性弱的靠右，验收最靠右最不易误点）。 */
const TASK_ACTION_ORDER: readonly TaskActionName[] = ['cancel', 'skip', 'edit-acceptance']

/** 一行动作按钮的视图（disabled 与原因都从 shared 的允许表派生，客户端不再自己判状态）。 */
export interface TaskActionView {
  action: TaskActionName
  label: string
  /** 带任务 id 的全意可访问名（DESIGN §6：不能只读「取消」）。 */
  ariaLabel: string
  disabled: boolean
  /** 仅 disabled 时给：宿主同一张表的拒绝文案，渲染成 title。 */
  reason?: string
}

function actionAriaLabelOf(action: TaskActionName, taskId: string): string {
  if (action === 'cancel') return `取消任务 ${taskId}`
  if (action === 'skip') return `跳过任务 ${taskId}`
  return `修改 ${taskId} 的验收命令`
}

/** 13 态 × 3 动作的 disabled 视图：**唯一来源是 `TASK_ACTION_ALLOW`**（AC-27）。 */
export function taskActionsOf(task: PlanTask): TaskActionView[] {
  const { status } = progressOf(task)
  return TASK_ACTION_ORDER.map((action) => {
    const allowed = taskActionAllowed(action, status)
    const view: TaskActionView = {
      action,
      label: TASK_ACTION_LABEL[action],
      ariaLabel: actionAriaLabelOf(action, task.id),
      disabled: !allowed,
    }
    if (!allowed) {
      const reason = taskActionDisabledReason(action, status)
      view.reason = reason === '' ? '当前状态不允许该动作' : reason
    }
    return view
  })
}

/**
 * 等待条文案（AC-20）：**原样返回快照里的 `waitReason`**，不 trim、不拼接、不截断。
 *
 * 宿主已经写明「等待 t2 释放 src/host/bridge.ts」；客户端只要在它前面凑一个字，
 * 逐字断言就会在无害重构后失效（DESIGN §0.1「零拼装」）。
 */
export function waitReasonOf(task: PlanTask): string {
  const raw = (task as PlanTask & { waitReason?: unknown }).waitReason
  return typeof raw === 'string' ? raw : ''
}

/** 写域占用里的一条等待者（label = `{taskId} · {member}（{reason}）`，reason 原文）。 */
export interface ScopeLockWaiterView {
  taskId: string
  member: string
  label: string
  reason: string
}

/** 写域占用的一行（同一路径的多个等待者合并进 waiters，不重复渲染路径行）。 */
export interface ScopeLockRowView {
  path: string
  holderTaskId: string
  /** `{holderTaskId} · {holderMember ?? '未派成员'}` —— 客户端只做 id 与成员名的拼接。 */
  holderLabel: string
  waiters: ScopeLockWaiterView[]
}

function memberNameOf(member: unknown): string {
  return typeof member === 'string' && member.trim() !== '' ? member : '未派成员'
}

/** 单条锁 → 行视图（ui.ts 的 `scopeLockRowView` 直接委托它，避免两份映射）。 */
export function scopeLockRowOf(lock: ScopeLockView): ScopeLockRowView {
  const holderMember = memberNameOf(lock.holderMember)
  const waiters: ScopeLockWaiterView[] = []
  const rawWaiters = Array.isArray(lock.waiters) ? lock.waiters : []
  for (const waiter of rawWaiters) {
    const taskId = str(waiter?.taskId)
    const member = memberNameOf(waiter?.member)
    const reason = str(waiter?.reason)
    waiters.push({ taskId, member, label: `${taskId} · ${member}（${reason}）`, reason })
  }
  return {
    path: str(lock.path),
    holderTaskId: str(lock.holderTaskId),
    holderLabel: `${str(lock.holderTaskId)} · ${holderMember}`,
    waiters,
  }
}

/** 快照 → 写域占用行；空数组返回 `[]`（组件据此渲染 0 节点，连组标题都不出现）。 */
export function scopeLockRowsOf(snapshot: PanelSnapshot | null | undefined): ScopeLockRowView[] {
  const locks = Array.isArray(snapshot?.scopeLocks) ? snapshot.scopeLocks : []
  return locks.map((lock) => scopeLockRowOf(lock))
}

/** 执行痕迹的一行（时间 / 工具 / 路径 / ×N / 原因原文）。 */
export interface DeviationRowView {
  at: string
  toolName: string
  /** 多个路径用「、」连接（DESIGN §3.6）。 */
  paths: string
  count: number
  /** `count > 1` 才是 `×N`，否则空串（组件据空串决定不渲染该 span）。 */
  countLabel: string
  reason: string
}

/** 单条留痕 → 行视图（ui.ts 的 `deviationRowView` 直接委托它）。 */
export function deviationRowOf(record: DeviationView): DeviationRowView {
  const paths = Array.isArray(record.paths) ? record.paths.filter((p): p is string => typeof p === 'string') : []
  const rawCount = Number(record.count)
  const count = Number.isFinite(rawCount) ? Math.max(1, Math.floor(rawCount)) : 1
  return {
    at: formatClock(record.at),
    toolName: str(record.toolName),
    paths: paths.join('、'),
    count,
    countLabel: count > 1 ? `×${count}` : '',
    reason: str(record.reason),
  }
}

/** 快照 → 执行痕迹行；空数组返回 `[]`（0 节点）。 */
export function deviationRowsOf(snapshot: PanelSnapshot | null | undefined): DeviationRowView[] {
  const records = Array.isArray(snapshot?.deviations) ? snapshot.deviations : []
  return records.map((record) => deviationRowOf(record))
}

/**
 * 组标题里的「亲手写了 N 次」：累加合并后的 `count`（不是记录条数）。
 *
 * `×N` 是「同一键 60 秒内合并了几次」的语义，所以标题的总次数必须是 `Σcount`；
 * 用 `rows.length` 会让「10 次同键」显示成「1 次」，与 AC-24 的合并语义自相矛盾。
 */
export function deviationWriteCountOf(rows: readonly DeviationRowView[]): number {
  return rows.reduce((sum, row) => sum + row.count, 0)
}

/* ═══════════════════ r13：run 详情唯一装配（AC-7 / AC-18） ═══════════════════ */

/**
 * 状态词常量（**不是格式化**）：宿主 `format.ts` 负责算文本，这里只负责在宿主没给文本时
 * 不发明、不补 0 —— 「不可得」与「未开始」是两种不同的事实，混用会让人以为计划没跑。
 */
export const UNAVAILABLE_TEXT = '不可得'
export const NOT_STARTED_TEXT = '未开始'

/** 千分位分组：与宿主 `format.ts` 的 `groupDigits` 逐字一致（客户端唯一的分组实现）。 */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 可用数字（有限、非负）。`0` 合法 —— 「花了 0 token」是真话，不是缺失。 */
function usableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** 带单位的 token 阶梯（从大到小，先命中先返回）：与宿主 `TOKEN_UNITS` 同表。 */
const CLIENT_TOKEN_UNITS: ReadonlyArray<{ readonly divisor: number; readonly suffix: string }> = [
  { divisor: 1_000_000_000, suffix: 'B' },
  { divisor: 1_000_000, suffix: 'M' },
  { divisor: 1_000, suffix: 'K' },
]

/**
 * 带单位的 token 文本（r19）：与宿主 `src/host/format.ts` 的 `formatTokenUnits` **逐字一致**
 * （跨端不能互相 import，只能靠两侧测试同表锁定）。
 *
 * 规则：`< 1,000` 原样整数；`≥ 1e3 / 1e6 / 1e9` 升到 K / M / B，固定两位小数；
 * 四舍五入进位跨阈值时顺延上一级（`999,999` → `1.00M`，界面永不出现 `1000.00K`）。
 *
 * 只在宿主没给 `cell.text`（旧快照）时兜底；有 `text` 时一律用宿主的，客户端不重算。
 */
function tokenUnitsText(total: number | undefined): string {
  if (!usableNumber(total)) return UNAVAILABLE_TEXT
  const value = Math.round(total)
  if (value < 1_000) return String(value)
  for (let index = 0; index < CLIENT_TOKEN_UNITS.length; index += 1) {
    const unit = CLIENT_TOKEN_UNITS[index]
    if (value < unit.divisor) continue
    const text = (value / unit.divisor).toFixed(2)
    if (Number(text) >= 1_000 && index > 0) {
      const next = CLIENT_TOKEN_UNITS[index - 1]
      return `${(value / next.divisor).toFixed(2)}${next.suffix}`
    }
    return `${text}${unit.suffix}`
  }
  return String(value)
}

/** 合计文本兜底（旧数据无 `cell.text`）：动态单位，与宿主同口径。 */
function fullTokenText(total: number | undefined): string {
  return tokenUnitsText(total)
}

/**
 * 紧凑合计（流转节点第二行，128px 宽）。
 *
 * r19 起改用与合计相同的动态单位：单位文本最长 7 字符（`999.99K`），刚好落在旧的
 * 7 字符预算内，因此**不再截断数字**（截断等于造假），也不需要第二套「一位小数小写 k」
 * 的口径。保留独立导出只为兼容既有调用点。
 */
function compactTokenText(total: number | undefined): string {
  return tokenUnitsText(total)
}

/**
 * token 单元格文本：`provider` 用宿主文本（带 K/M/B 单位），`unavailable` 一律「不可得」。
 *
 * r19：以为单位是唯一展示口径；旧数据没有 `text` 时按同一算法兜底（`fullTokenText`）。
 * 为什么不显示 `-` 或 `0`：`-` 会被读成「还没跑」，`0` 会被读成「跑了但没花 token」，
 * 两者都是假话；「不可得」是唯一诚实的第三种状态（DESIGN §2.2）。
 */
export function tokenTextOf(cell: UsageCell | null | undefined): string {
  if (!cell || cell.source !== 'provider') return UNAVAILABLE_TEXT
  // 宿主已经算好的展示文本优先（r17）；旧数据没有 text 时才按数字补一遍。
  if (typeof cell.text === 'string' && cell.text !== '') return cell.text
  return fullTokenText(cell.tokens?.total)
}

/** 流转节点第二行用的紧凑 token（宽 128px，单位文本最长 7 字符）；口径与合计一致。 */
export function compactTokenTextOf(cell: UsageCell | null | undefined): string {
  if (!cell || cell.source !== 'provider') return UNAVAILABLE_TEXT
  return compactTokenText(cell.tokens?.total)
}

/**
 * 六项指标明细（r17）：只透传宿主 `details`，客户端不重算命中率、不猜缺失分项。
 *
 * 旧数据没有 `details` 时返回空数组，调用方退化为只显示合计。
 */
export function usageMetricsOf(cell: UsageCell | null | undefined): UsageMetric[] {
  if (!cell || cell.source !== 'provider' || !Array.isArray(cell.details)) return []
  return cell.details
}

/** token 单元格的 `title`：不可得时给原因；可得时优先展开宿主给的六项明细。 */
export function tokenTitleOf(cell: UsageCell | null | undefined): string {
  if (!cell || cell.source !== 'provider') return cell?.reason ?? '该处没有用量来源'
  const parts: string[] = [`合计 ${fullTokenText(cell.tokens?.total)} token`]
  const details = usageMetricsOf(cell)
  if (details.length > 0) {
    for (const metric of details) parts.push(`${metric.label} ${metric.text}`)
    return parts.join(' · ')
  }
  if (usableNumber(cell.tokens?.input)) parts.push(`输入 ${fullTokenText(cell.tokens?.input)}`)
  if (usableNumber(cell.tokens?.output)) parts.push(`输出 ${fullTokenText(cell.tokens?.output)}`)
  return parts.join(' · ')
}

/** 用时文本：**只读**宿主下发的 `text`，客户端不拼「分 / 小时」（AC-7 的 grep 断言靠这条成立）。 */
export function durationTextOf(cell: DurationCell | null | undefined): string {
  return cell?.text ?? UNAVAILABLE_TEXT
}

/** 用时单元格的 `title`。 */
export function durationTitleOf(cell: DurationCell | null | undefined): string {
  if (!cell) return '没有用时记录'
  switch (cell.state) {
    case 'not-started':
      return '任务尚未开始'
    case 'running':
      return '正在计时'
    case 'unavailable': {
      // r24：宿主会说明「为什么不可得」（例如旧 run 完成于起止记录上线前）。
      // 有原因就逐字透传；旧快照没有 reason 才退回通用文案（既有断言保持不变）。
      const reason = (cell.reason ?? '').trim()
      return reason !== '' ? reason : '没有开始时间，算不出用时'
    }
    default:
      return `开始 ${formatStamp(cell.startAt)} · 结束 ${formatStamp(cell.endAt)}`
  }
}

/**
 * 角色卡「累计用时」的 `title`（r20）—— **不能**走 `durationTitleOf`。
 *
 * 角色用时是**聚合值**（`shared/role-view.ts#roleDurationOf` 把该角色名下任务逐个相加），
 * 聚合区间没有单一「开始/结束时刻」，所以 cell 里刻意不带 `startAt`/`endAt`；
 * 走通用的 `durationTitleOf` 会拼出「开始 — · 结束 —」这种自相矛盾的解释。
 *
 * 四态文案（与卡片上的可见文本分工：卡片只放 `cell.text`，这里解释「这个数怎么来的」）：
 *  - done / running → 「该角色名下任务用时合计：<text>（N 个任务）」；
 *  - not-started → 任务都还没开始，暂无累计用时（**不是 0 秒**）；
 *  - unavailable → 合计不可得 + cell.text 里宿主给的原因（缺开始/结束时刻等）；
 *  - 旧快照没有 duration 字段 → 说明是旧数据，不补 0。
 *
 * 纯函数、零格式化：时长文案一律取自宿主下发的 `cell.text`。
 */
export function roleDurationTitleOf(duration: DurationCell | undefined, tasks?: number): string {
  if (duration === undefined) return '旧快照没有该角色的用时数据'
  if (duration.state === 'not-started') return '该角色名下的任务都还没开始，暂无累计用时'
  if (duration.state === 'unavailable') {
    // 宿主把原因写进 text（`不可得：任务 t1 缺少开始/结束时刻…`）；去掉前缀后接在解释后面。
    const reason = duration.text.startsWith(UNAVAILABLE_TEXT)
      ? duration.text.slice(UNAVAILABLE_TEXT.length).replace(/^[：:]\s*/, '')
      : duration.text
    return reason === '' ? '该角色名下任务用时合计不可得' : `该角色名下任务用时合计不可得：${reason}`
  }
  const count =
    typeof tasks === 'number' && Number.isFinite(tasks) && tasks > 0 ? `（共 ${Math.round(tasks)} 个任务）` : ''
  const running = duration.state === 'running' ? '，进行中的任务按当前时刻计入' : ''
  return `该角色名下任务用时合计：${duration.text}${count}${running}`
}

/** 缺单元格时的兜底：保留原因，不冒充 0。 */
export function usageCellOr(cell: UsageCell | null | undefined, reason: string): UsageCell {
  return cell ?? { source: 'unavailable', reason }
}

/** 派发在途三态（DESIGN §2.5：`dispatching` 即时、`dispatched` 保留 3s、之后回 idle）。 */
export type InflightState = 'dispatching' | 'dispatched' | 'idle'

const INFLIGHT_TEXT: Record<InflightState, string> = {
  dispatching: '正在派发…',
  dispatched: '已派发',
  idle: '自动派发已开启',
}

export interface InflightView {
  state: InflightState
  text: string
  /** 前两态显示脉动圆点，idle 显示静态勾。 */
  dot: boolean
}

export function inflightOf(state: InflightState): InflightView {
  const normalized: InflightState = state in INFLIGHT_TEXT ? state : 'idle'
  return { state: normalized, text: INFLIGHT_TEXT[normalized], dot: normalized !== 'idle' }
}

/* ───────────── run 头 ───────────── */

export interface RunHeadView {
  runId: string
  planStatusLabel: string
  planStatusTone: PlanStatusTone
  /** r26：阶段 detail（人话解释），渲染为 `[data-plan-status]` 的 title。 */
  planStatusDetail?: string
  plannedAtText: string
  /** 起止时钟（`10:21:03 → 进行中`）；时钟不是时长，允许客户端用 formatClock。 */
  windowText: string
  durationText: string
  durationState: DurationState
  usageText: string
  usageSource: UsageSource
  usageTitle: string
  inflightText: string
  inflightState: InflightState
  /** 用量拿不到时的降级说明（有数据但拿不到该量，**不复用空态**）。 */
  downgrade?: string
  /** r21：宿主记录的收口原因（旧 run 没有该字段 → 缺席，界面不占位、不编原因）。 */
  terminationReason?: string
}

/**
 * r26：第三参可传入阶段视图；不传时保持旧行为（原始计划状态）。
 * 任务页会把 `stageOfDetail` 的结果传进来，所以 run 头的徽标与卡片/历史行同源。
 */
export function runHeadOf(
  detail: RunDetailView,
  inflight: InflightState = 'idle',
  stage?: RunStageView,
): RunHeadView {
  const status = planStatusView(detail.planStatus)
  const inflightView = inflightOf(inflight)
  const head: RunHeadView = {
    runId: detail.runId,
    planStatusLabel: stage === undefined ? status.label : stage.label,
    planStatusTone: stage === undefined ? status.tone : stage.tone,
    plannedAtText: detail.plannedAt ? `计划于 ${formatStamp(detail.plannedAt)}` : '计划时间未记录',
    windowText: `${detail.plannedAt ? formatClock(detail.plannedAt) : '--:--:--'} → ${
      detail.finishedAt ? formatClock(detail.finishedAt) : '进行中'
    }`,
    durationText: durationTextOf(detail.duration),
    durationState: detail.duration?.state ?? 'unavailable',
    usageText: tokenTextOf(detail.usage),
    usageSource: detail.usage?.source ?? 'unavailable',
    usageTitle: tokenTitleOf(detail.usage),
    inflightText: inflightView.text,
    inflightState: inflightView.state,
  }
  if (stage !== undefined && stage.detail !== undefined) head.planStatusDetail = stage.detail
  if (head.usageSource !== 'provider') head.downgrade = `token ${UNAVAILABLE_TEXT}（无用量来源）`
  // r21：只透传宿主落盘的 reason；没有就缺席（历史列表旧数据不显示「未记录原因」占位）。
  if (detail.terminationReason !== undefined && detail.terminationReason.trim() !== '') {
    head.terminationReason = detail.terminationReason.trim()
  }
  return head
}

/* ───────────── 角色条 ───────────── */

export interface RoleChipView {
  roleId: string
  name: string
  taskCount: number
  usageText: string
  usageSource: UsageSource
  usageTitle: string
}

export function roleChipsOf(roles: readonly RoleUsageView[]): RoleChipView[] {
  return roles.map((role) => ({
    roleId: role.roleId,
    name: role.name,
    taskCount: role.tasks,
    usageText: tokenTextOf(role.usage),
    usageSource: role.usage?.source ?? 'unavailable',
    usageTitle: `${role.name} · ${role.tasks} 个任务 · ${tokenTitleOf(role.usage)}`,
  }))
}

/* ───────────── 任务行 ───────────── */

/** 任务表表头文案（表头与第二行共用同一网格，见 DESIGN §2.1）。 */
export const TASK_TABLE_HEADER = {
  left: '任务 · 角色 · 状态',
  token: 'token',
  duration: '用时',
} as const

/**
 * r21：宿主在**当前 run 快照**的 `PlanTask` 上下发的修订/作废事实位。
 *
 * 注意：`shared/types.ts#TaskDetailView`（历史 run 详情的任务投影）还没有这几个字段，
 * 宿主 `library.taskDetailOf` 也没投影 —— 所以它们在客户端是**可选**的：
 *  - 当前 run：`snapshot.tasks` 是原始 `PlanTask`，字段直接可见；
 *  - 历史 run：宿主没下发 → 字段缺席，卡片不显示修订/作废说明（不自行推断）。
 *
 * 这是宿主契约缺口，等宿主把字段补进 `TaskDetailView` 后删除本地的可选扩展即可。
 */
export interface TaskRevisionFacts {
  revisedAt?: number
  revisionNote?: string
  cancelledAt?: number
  cancelReason?: string
  // r25：与 shared/types.ts 的 PlanTask/TaskDetailView 同步扩 'stale'（计划收口连带终结）。
  cancelledBy?: 'revision' | 'user' | 'stale'
}

/** 任务卡可消费的来源：`TaskDetailView`（历史）+ 可选修订事实（当前 run 才有）。 */
export type TaskCardSource = TaskDetailView & TaskRevisionFacts

export interface TaskRowView {
  id: string
  title: string
  badge: Badge
  roleName: string
  tokenText: string
  tokenSource: UsageSource
  tokenTitle: string
  durationText: string
  durationState: DurationState
  durationTitle: string
  expanded: boolean
  /** r21：被需求修订改写过 → 可见徽标「已修订」（文案唯一出处在这里）。 */
  revisedText?: string
  /** r21：修订说明（宿主 `revisionNote`），徽标的 title 与行内说明共用。 */
  revisionNote?: string
  /** r21：任务作废原因（宿主 `cancelReason`），只对已取消任务展示。 */
  cancelReason?: string
  /**
   * r21：任务在等写域时的可见标记（`等待写域`）。
   *
   * `status='waiting'` 在任务词表里是「等待中」（被单测钉死）；但宿主 r21 的 waiting
   * 语义就是等写域锁，这里只**追加**一枚标记，不改 badge 文案（否则会与既有断言打架）。
   */
  waitScopeText?: string
}

/** 修订徽标文案（r21）：宿主只下发事实位，中文在客户端这一处。 */
export const TASK_REVISED_TEXT = '已修订'

/**
 * r25：取消原因的中文兜底 —— **只读 `cancelledBy` 的语义，绝不回显英文枚举**。
 *
 * 宿主正常会写 `cancelReason`（如「计划已收口：…」）；旧数据只有 `cancelledBy` 时
 * 卡片仍要能回答「为什么没了」，因此按来源翻成中文。新增来源必须先在这里补文案。
 */
const CANCEL_BY_REASON: Record<'revision' | 'user' | 'stale', string> = {
  revision: '被需求修订作废',
  user: '队长取消任务',
  stale: '计划已收口，任务随计划一起终结',
}

/** 已取消但宿主既没给原因、也没给来源：如实说明，不伪造理由、不留空白。 */
export const CANCEL_REASON_UNKNOWN_TEXT = '已取消，宿主未记录原因'

export function taskRowOf(task: TaskCardSource, expanded: boolean): TaskRowView {
  const row: TaskRowView = {
    id: task.id,
    title: task.title,
    badge: statusBadge(task.status),
    roleName: task.roleName || task.roleId,
    tokenText: tokenTextOf(task.usage),
    tokenSource: task.usage.source,
    tokenTitle: tokenTitleOf(task.usage),
    durationText: durationTextOf(task.duration),
    durationState: task.duration.state,
    durationTitle: durationTitleOf(task.duration),
    expanded,
  }
  // r21：只在宿主真的写了 `revisedAt` 时标「已修订」，不拿 revisionNote 反推。
  if (typeof task.revisedAt === 'number' && task.revisedAt > 0) {
    row.revisedText = TASK_REVISED_TEXT
    const note = task.revisionNote?.trim()
    if (note !== undefined && note !== '') row.revisionNote = note
  }
  // 取消原因是「为什么没了」的唯一解释；不把原因复制到非取消任务上。
  // r25：宿主没写 cancelReason 时按 cancelledBy 翻成中文（stale 等枚举绝不上屏）。
  if (task.status === 'cancelled') {
    const reason = task.cancelReason?.trim()
    if (reason !== undefined && reason !== '') row.cancelReason = reason
    else {
      const by = task.cancelledBy
      const fallback = by === undefined ? '' : CANCEL_BY_REASON[by]
      row.cancelReason = fallback !== '' ? fallback : CANCEL_REASON_UNKNOWN_TEXT
    }
  }
  // 等写域（宿主 r11/r21 语义）：只有任务真的在 waiting 且宿主给了等待原因时才标；
  // 不拿状态自行推断「应该是在等写域」。
  if (task.status === 'waiting') {
    const waitReason = task.waitReason?.trim()
    if (waitReason !== undefined && waitReason !== '') row.waitScopeText = '等待写域'
  }
  return row
}

export interface GateEvidenceView {
  command: string
  exitText: string
  exitOk: boolean
  tail: string[]
  artifacts: string[]
  atText: string
}

export interface TaskDetailPanelView {
  acceptance: string
  dependsText: string
  scopeText: string
  messageText: string
  attemptsText?: string
  waitReason?: string
  usageReason?: string
  /** provider 时的六项指标（宿主 `details` 透传）；缺失 = 旧数据，只显示合计。 */
  usageMetrics?: UsageMetric[]
  durationReason?: string
  evidence?: GateEvidenceView
}

/** 展开区的内容（键值行）。没有的东西给「未声明 / 无」，不留空行。 */
export function taskDetailOf(task: TaskDetailView): TaskDetailPanelView {
  const panel: TaskDetailPanelView = {
    acceptance: task.acceptance?.trim() || '（未声明验收命令）',
    dependsText: task.dependsOn.length > 0 ? task.dependsOn.join(' / ') : '无前置任务',
    scopeText: task.writeScopes && task.writeScopes.length > 0 ? task.writeScopes.join(' / ') : '未声明写域',
    messageText: `${task.messageCount} 条直接消息`,
  }
  if (typeof task.attempts === 'number' && task.attempts > 1) panel.attemptsText = `第 ${task.attempts} 次尝试`
  if (task.waitReason) panel.waitReason = task.waitReason
  if (task.usage.source !== 'provider') panel.usageReason = task.usage.reason ?? '该任务没有可用用量事件'
  else {
    const metrics = usageMetricsOf(task.usage)
    if (metrics.length > 0) panel.usageMetrics = metrics
  }
  if (task.duration.state === 'unavailable') {
    // r24：展开区与单元格 title 用同一句原因（宿主 `DurationCell.reason`），不再各写一份。
    const reason = (task.duration.reason ?? '').trim()
    panel.durationReason = reason !== '' ? reason : '没有开始时间，算不出用时'
  }
  const evidence = task.evidence
  if (evidence) {
    panel.evidence = {
      command: evidence.command,
      exitText: evidence.exitCode === null ? '超时或被信号终止' : `退出码 ${evidence.exitCode}`,
      exitOk: evidence.exitCode === 0,
      tail: tailLines(evidence.tail, 6),
      artifacts: evidence.artifacts ?? [],
      atText: formatStamp(evidence.at),
    }
  }
  return panel
}

/* ───────────── 任务总览（环 + 两组） ───────────── */

/** 进度环几何（r16 DESIGN §0：80×80、圆心 40、r=34、stroke=8）。 */
export const PROGRESS_RING_SIZE = 80
export const PROGRESS_RING_VIEWBOX = 80
export const PROGRESS_RING_RADIUS = 34
export const PROGRESS_RING_STROKE = 8
export const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RING_RADIUS

export interface TaskOverviewView {
  done: number
  total: number
  /** 圆心文本，严格 `done/total`（0 任务 = `0/0`，不写 NaN、不写百分比）。 */
  text: string
  /** 环的无障碍名（`role="img"` 用，读屏不读两个数字拼起来的文本）。 */
  ariaLabel: string
  /** 0..1；`total === 0` 时为 0（弧长退化为整圈轨迹）。 */
  ratio: number
  /** 传给 `stroke-dashoffset` 的像素值；由本函数算好，组件不做除法（避免两处舍入）。 */
  dashOffset: number
  groups: { open: TaskRowView[]; done: TaskRowView[] }
}

/**
 * 任务总览的**唯一**派生点（r14 AC-10 / AC-11；r18b 恢复全量列表）。
 *
 * 一次调用同时产出环的比例、圆心文本与两个分组 —— 组件不再自己做除法或二次过滤，
 * 所以「改一个任务 running→done」时环与两组必然同一帧一致（AC-11）。
 *
 * 口径（r18b 按用户要求回滚 r18 的过滤）：
 *  - **环**按**全量**任务算：分子只认 `status === 'done'`，分母是全部任务
 *    （`cancelled`/`skipped` 计入分母、不计入分子，AC-10）；
 *  - **列表也是全量**：`groups.open` = 所有非 done 任务（`cancelled`/`skipped` 同样
 *    留在未完成组，不再被剔除），`groups.done` = 所有 done 任务；两组都保持计划顺序。
 *
 * 空组的隐藏不在这里做：由 TaskTable 的 grouped 分支按 `rows.length === 0` 过滤
 * （全部完成或没有任务时 open 组为空，因此「全部完成时没有『未完成 · 0』组头」仍然成立）。
 */
export function taskOverviewOf(
  tasks: readonly TaskDetailView[],
  expandedTaskId?: string,
): TaskOverviewView {
  const open: TaskRowView[] = []
  const done: TaskRowView[] = []
  for (const task of tasks) {
    const row = taskRowOf(task, task.id === expandedTaskId)
    if (task.status === 'done') done.push(row)
    else open.push(row)
  }
  const total = tasks.length
  const ratio = total === 0 ? 0 : done.length / total
  return {
    done: done.length,
    total,
    text: `${done.length}/${total}`,
    ariaLabel: `已完成 ${done.length} / 共 ${total}`,
    ratio,
    dashOffset: PROGRESS_RING_CIRCUMFERENCE * (1 - ratio),
    groups: { open, done },
  }
}

/* ───────────── 目标标题（项目页 run 行） ───────────── */

/** 行标题最多显示多少个字符（r14 AC-15 / DESIGN §3；按 code point 计，中文与 emoji 都算 1）。 */
export const GOAL_TITLE_MAX = 24

export interface GoalTitleView {
  /** 行里显示的文本（超出 24 字截断并补 `…`）。 */
  text: string
  /** `title` 属性用的完整原文（截断与否都给全文，鼠标悬停能看全）。 */
  title: string
  source: 'goal' | 'fallback'
}

/**
 * run 级标题的**唯一截断点**（r14 AC-15）：组件只渲染，不再二次截断/补 `…`。
 *
 * 没有 goal 的旧 run 用「未命名任务 · runId 后 6 位」——**不拿任务标题或 runId 冒充目标**，
 * 也不猜（AC-15 明确禁止标题等于 `t1`/裸 runId）。
 */
export function goalTitleOf(goal: string | undefined, runId: string): GoalTitleView {
  const full = (goal ?? '').trim()
  if (full === '') {
    return {
      text: `未命名任务 · ${runId.slice(-6)}`,
      title: `本轮没有记录目标（run ${runId}）`,
      source: 'fallback',
    }
  }
  const chars = Array.from(full)
  if (chars.length <= GOAL_TITLE_MAX) return { text: full, title: full, source: 'goal' }
  return { text: `${chars.slice(0, GOAL_TITLE_MAX).join('')}…`, title: full, source: 'goal' }
}

/* ───────────── r21：需求修订（同一个 runId 内并入） ───────────── */

/**
 * 宿主追加段落的标题格式：`## 需求修订（YYYY-MM-DD HH:mm）`。
 *
 * 与 `src/host/plan/plan.ts#revisePlan` 的落盘格式**逐字对应**；客户端只做切分，
 * 不重写标题、不重排时间 —— 用户原文（含换行）原样保留。
 */
const REVISION_HEADING = /^## 需求修订（([^）\n]*)）[ \t]*$/gm

export interface PlanGoalSectionView {
  key: string
  /** true = 需求修订追加段（不是原目标）。 */
  revision: boolean
  heading: string
  /** 段正文：用户原文，保留换行。 */
  body: string
}

/** run 头的「目标 + 追加需求」视图（r21）。 */
export interface PlanGoalView {
  sections: PlanGoalSectionView[]
  /** `本次运行已被修订 N 次`；没有修订史时不出。 */
  revisionCountText?: string
  /** `已并入 <runId>`：目标里确实出现了修订段/修订史时才有。 */
  mergedText?: string
  /** 最近一次修订的说明（`changeSummary` + 时刻）；只有修订史能给出。 */
  latestRevisionText?: string
}

/**
 * 目标全文 → 分段视图（r21）。
 *
 * 输入是宿主下发的 `PanelSnapshot.goal`（原目标 + 逐次追加的「## 需求修订（…）」段）
 * 与 `PanelSnapshot.revisions`。函数是纯的：
 *  - 没有目标、也没有修订史 → `null`（run 头整块不渲染，不占位）；
 *  - `goal` 里没有修订标题 → 只有「原始目标」一段；
 *  - 修订段与修订史**同一份用户原文**，只切分、不改写、不补时刻。
 */
export function planGoalOf(
  goal: string | undefined,
  revisions: readonly PlanRevision[] | undefined,
  runId: string,
): PlanGoalView | null {
  const text = (goal ?? '').trim()
  const history = Array.isArray(revisions) ? revisions : []
  if (text === '' && history.length === 0) return null

  const headings = [...text.matchAll(REVISION_HEADING)]
  const sections: PlanGoalSectionView[] = []
  if (headings.length === 0) {
    if (text !== '') {
      sections.push({ key: 'goal-origin', revision: false, heading: '原始目标', body: text })
    }
  } else {
    const firstIndex = headings[0].index ?? 0
    const origin = text.slice(0, firstIndex).trim()
    if (origin !== '') {
      sections.push({ key: 'goal-origin', revision: false, heading: '原始目标', body: origin })
    }
    headings.forEach((heading, index) => {
      const start = (heading.index ?? 0) + heading[0].length
      const end = index + 1 < headings.length ? (headings[index + 1].index ?? text.length) : text.length
      const body = text.slice(start, end).trim()
      sections.push({
        key: `goal-revision-${index + 1}`,
        revision: true,
        heading: `需求修订（${heading[1]}）`,
        body,
      })
    })
  }

  const view: PlanGoalView = { sections }
  const hasRevisionSection = sections.some((section) => section.revision)
  if (history.length > 0) {
    view.revisionCountText = `本次运行已被修订 ${history.length} 次`
    const latest = history[history.length - 1]
    const summary = (latest.changeSummary ?? '').trim()
    view.latestRevisionText =
      summary === ''
        ? `最近一次修订于 ${formatStamp(latest.at)}`
        : `最近修订 ${formatStamp(latest.at)}：${summary}`
  }
  if (history.length > 0 || hasRevisionSection) view.mergedText = `已并入 ${runId}`
  return view
}

/* ───────────── 项目库分栏宽度 ───────────── */

/** 项目列表列宽（r14 DESIGN §3）：默认 220，夹在 160–360（再窄放不下项目名，再宽挤掉详情）。 */
export const LIB_LIST_DEFAULT = 220
export const LIB_LIST_MIN = 160
export const LIB_LIST_MAX = 360

/** 任意输入 → 合法列宽；非数字（NaN/Infinity）回默认值，不做 `Math.min(undefined)` 这种 NaN 传染。 */
export function clampListWidth(width: number): number {
  if (!Number.isFinite(width)) return LIB_LIST_DEFAULT
  return Math.min(LIB_LIST_MAX, Math.max(LIB_LIST_MIN, Math.round(width)))
}

/** 拖动增量 → 新列宽（先归一再夹取，避免从 NaN 起点一路 NaN）。 */
export function nextListWidth(current: number, deltaPx: number): number {
  const base = clampListWidth(current)
  const delta = Number.isFinite(deltaPx) ? deltaPx : 0
  return clampListWidth(base + delta)
}

/* ───────────── 流转图 ───────────── */

/**
 * 角色列画布几何（r16 DESIGN §0）：节点 180×64，列步进 208、行步进 80；
 * 列头 32px 高贴顶 12，节点从 54 起。两列总宽 412 > 296 靠拖动平移，不缩放。
 */
export const FLOW_NODE_WIDTH = 180
export const FLOW_NODE_HEIGHT = 64
export const FLOW_COLUMN_STEP = 208
export const FLOW_ROW_STEP = 80
export const FLOW_PADDING = 12
export const FLOW_STAGE_TOP = 12
export const FLOW_STAGE_HEIGHT = 32
export const FLOW_NODE_TOP = 54
export const FLOW_STAGE_LINK_Y = 28
export const FLOW_STAGE_LINK_INSET = 4

/** 缺角色名时的兜底文案（旧 run 的 `TaskDetailView.roleName` 恒有，这里只防脏数据）。 */
export const FLOW_ROLE_FALLBACK = '角色未记录'

export interface FlowNodeCellView {
  tokenText: string
  durationText: string
  /** 角色名：r16 只用于 title/aria，不再渲染进节点第一行（第一行是 tN + 标题 + 状态）。 */
  roleText: string
  /** 节点第一行的任务简述（给人看的名字，不是任务 id）。 */
  taskTitle: string
  /** 第二行的整串（`1.20K · 3 分 12 秒`），超宽时 CSS 加 ellipsis。 */
  text: string
  title: string
  label: string
  /** 状态中文（唯一词表 `statusBadge().text`，不另造第二套）。 */
  statusText: string
  /** 状态胶囊的 tone（`data-tone` 上色）。 */
  tone: BadgeTone
}

export function flowNodeViewOf(node: FlowNodeView): FlowNodeCellView {
  // r19：token 一律给宿主文本（已带 K/M/B 单位、两位小数），客户端不重算、不截断；
  // r13 曾在这里超过 7 位换紧凑写法，单位化后最长 7 字符（`999.99K`），该分支已无必要。
  const full = tokenTextOf(node.usage)
  const durationText = durationTextOf(node.duration)
  const roleText = (node.roleName ?? '').trim() || FLOW_ROLE_FALLBACK
  // r16：状态词与 tone 只从 statusBadge 取（13 态一张表），组件不再自己映射。
  const status = statusBadge(node.status)
  // r17：token 不可得时把原因带进 title/label（用户问「这些不可得是怎么回事儿」，
  // 节点上只写「token 不可得」看不出缘由；RunHeader / RoleCard / TaskTable 三处
  // 的 title 早已带 reason，这里补齐流程卡片）。可得到数字时保持原串，不加后缀。
  const tokenNote = node.usage !== undefined && node.usage.source === 'provider' ? '' : `（${tokenTitleOf(node.usage)}）`
  return {
    tokenText: full,
    durationText,
    roleText,
    taskTitle: node.title,
    text: `${full} · ${durationText}`,
    statusText: status.text,
    tone: status.tone,
    title: `${node.id} ${node.title} · 角色 ${roleText} · token ${full}${tokenNote} · 用时 ${durationText}`,
    label: `${node.id}：${node.title}，${status.text}，token ${full}${tokenNote}，用时 ${durationText}`,
  }
}

/** r16 AC-16：角色卡 refs 行的单枚 chip（`tN` + 状态彩点）。 */
export interface RoleTaskRefView {
  id: string
  status: TaskStatus
  tone: BadgeTone
  text: string
  title: string
  label: string
}

/**
 * 角色任务引用 → chip 视图（唯一派生点，RoleCard 只渲染）。
 *
 * 文案只写 `tN`，状态中文只取 `statusBadge().text`（`done` = 「已通过」），
 * 不另造「已完成/未开始」第二套词；彩点颜色由 `tone` 决定，与角色卡状态点同族。
 */
export function roleTaskRefViewOf(ref: RoleTaskRef): RoleTaskRefView {
  const badge = statusBadge(ref.status)
  const text = `${ref.id} · ${badge.text}`
  return {
    id: ref.id,
    status: ref.status,
    tone: badge.tone,
    text: ref.id,
    title: text,
    label: text,
  }
}

export interface FlowLayoutNode {
  node: FlowNodeView
  cell: FlowNodeCellView
  x: number
  y: number
  /** 角色列索引（r16 派生值；不读 `FlowNodeView.column`，那个是旧的依赖深度）。 */
  column: number
  /** 角色列内序号（派生）。 */
  row: number
}

export interface FlowLayoutEdge {
  key: string
  d: string
  upstreamDone: boolean
}

/** r16：一个角色列（列 = 有任务的角色，按计划里首次出现顺序）。 */
export interface FlowStageView {
  /** 分组键：`roleId` → `roleName` → `角色未记录`（同名不同 id 不会合并）。 */
  key: string
  index: number
  roleId?: string
  /** 列头显示的角色名。 */
  name: string
  count: number
  x: number
  y: number
  allDone: boolean
}

/** r16：相邻列之间的箭头（列头 y 高度上的水平线）。 */
export interface FlowStageLinkView {
  key: string
  from: number
  to: number
  d: string
  upstreamDone: boolean
}

export interface FlowLayout {
  width: number
  height: number
  nodes: FlowLayoutNode[]
  edges: FlowLayoutEdge[]
  stages: FlowStageView[]
  stageLinks: FlowStageLinkView[]
}

/**
 * 流转图布局（r16 AC-12/AC-13 的唯一派生点）。
 *
 * 列不再等于依赖深度，而是**角色**：按 `roleId → roleName → 「角色未记录」` 建组，
 * 首次出现决定列序；组内按计划顺序排行。旧快照没有 `roleId` 时回退 `roleName`，
 * 两者都没有才落单列。`node.column/node.row` 与 `flow.columns/flow.rows` 一律不读 ——
 * 同一个任务图在两个客户端版本里不能有两种列序。
 *
 * 节点边（依赖）仍是三次贝塞尔，端点缺失或环依赖直接跳过，绝不产生 NaN。
 */
export function flowLayoutOf(flow: FlowView): FlowLayout {
  // 1. 分组：key 与展示名分离（同 roleName 不同 roleId 恰好同名时不能合并）。
  const keys: string[] = []
  const groups = new Map<string, FlowNodeView[]>()
  for (const node of flow.nodes) {
    const key = node.roleId ?? node.roleName ?? FLOW_ROLE_FALLBACK
    const list = groups.get(key)
    if (list === undefined) {
      keys.push(key)
      groups.set(key, [node])
    } else {
      list.push(node)
    }
  }
  // 2. 列：index = 组下标；列头固定在顶部，节点从 FLOW_NODE_TOP 起。
  const stages: FlowStageView[] = keys.map((key, index) => {
    const list = groups.get(key) ?? []
    const first = list[0]
    const name = (first?.roleName ?? '').trim() || first?.roleId || FLOW_ROLE_FALLBACK
    const stage: FlowStageView = {
      key,
      index,
      name,
      count: list.length,
      x: FLOW_PADDING + index * FLOW_COLUMN_STEP,
      y: FLOW_STAGE_TOP,
      allDone: list.every((node) => node.status === 'done'),
    }
    if (first?.roleId !== undefined) stage.roleId = first.roleId
    return stage
  })
  let maxCount = 0
  for (const stage of stages) maxCount = Math.max(maxCount, stage.count)

  // 3. 行：组内保持原数组顺序（一次遍历 + 游标，O(n)）。
  const stageIndex = new Map(stages.map((stage) => [stage.key, stage]))
  const cursors = new Map<string, number>()
  const nodes: FlowLayoutNode[] = flow.nodes.map((node) => {
    const key = node.roleId ?? node.roleName ?? FLOW_ROLE_FALLBACK
    const column = stageIndex.get(key)?.index ?? 0
    const row = cursors.get(key) ?? 0
    cursors.set(key, row + 1)
    return {
      node,
      cell: flowNodeViewOf(node),
      column,
      row,
      x: FLOW_PADDING + column * FLOW_COLUMN_STEP,
      y: FLOW_NODE_TOP + row * FLOW_ROW_STEP,
    }
  })

  const byId = new Map(nodes.map((entry) => [entry.node.id, entry]))
  const edges: FlowLayoutEdge[] = []
  for (const edge of flow.edges as readonly FlowEdgeView[]) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const x1 = from.x + FLOW_NODE_WIDTH
    const y1 = from.y + FLOW_NODE_HEIGHT / 2
    const x2 = to.x - 2
    const y2 = to.y + FLOW_NODE_HEIGHT / 2
    const bend = Math.max(24, Math.abs(x2 - x1) / 2)
    edges.push({
      key: `${edge.from}->${edge.to}`,
      d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
      upstreamDone: edge.upstreamDone,
    })
  }

  // 4. 列间箭头：从上游列头右缘到下游列头左缘。
  const stageLinks: FlowStageLinkView[] = []
  for (let i = 1; i < stages.length; i += 1) {
    const prev = stages[i - 1]
    const cur = stages[i]
    if (prev === undefined || cur === undefined) continue
    const from = prev.x + FLOW_NODE_WIDTH + FLOW_STAGE_LINK_INSET
    const to = cur.x - FLOW_STAGE_LINK_INSET
    stageLinks.push({
      key: `${prev.key}->${cur.key}`,
      from,
      to,
      d: `M ${from} ${FLOW_STAGE_LINK_Y} L ${to} ${FLOW_STAGE_LINK_Y}`,
      upstreamDone: prev.allDone,
    })
  }

  // 5. 画布尺寸：空计划给最小 24×24（= 两侧 padding），不得 NaN。
  const width =
    stages.length === 0
      ? FLOW_PADDING * 2
      : FLOW_PADDING * 2 + FLOW_NODE_WIDTH + (stages.length - 1) * FLOW_COLUMN_STEP
  const height =
    stages.length === 0
      ? FLOW_PADDING * 2
      : FLOW_NODE_TOP + FLOW_NODE_HEIGHT + (maxCount - 1) * FLOW_ROW_STEP + FLOW_PADDING
  return { width, height, nodes, edges, stages, stageLinks }
}

/* ───────────── 记忆行 ───────────── */

export interface MemoryRowView {
  key: string
  name: string
  title: string
  tokenText: string
  tokenTitle: string
  timeText: string
}

/** 记忆行：token 一律带 `≈`（估算口径），并解释它是按字符数推的、不是 provider 上报值。 */
export function memoryRowOf(item: MemoryItemView): MemoryRowView {
  const estimate = usableNumber(item.tokenEstimate) ? Math.round(item.tokenEstimate) : 0
  return {
    key: `${item.track}/${item.name}`,
    name: item.name,
    title: item.title || item.name,
    tokenText: `≈${groupDigits(String(estimate))} token`,
    tokenTitle: '按字符数估算（≈ 字符数 / 2），不是 provider 上报值',
    timeText: item.createdAt
      ? `建立 ${formatStamp(item.createdAt)} · 修改 ${formatStamp(item.updatedAt)}`
      : `修改 ${formatStamp(item.updatedAt)}`,
  }
}

/* ───────────── r23 记忆条目视图（面板记忆页；宿主解析，客户端只排版） ───────────── */

/**
 * 主题标题：与宿主目录的标题保持一致，仅用于展示。
 *
 * 注意：这里**不解析 md、不拼来源/时间/修正次数** —— 那些一律用宿主下发的
 * `MemoryEntryView.text / sourceText / stamp / revisions`，避免客户端与宿主各写一套格式。
 */
const MEMORY_TOPIC_LABELS: Record<string, string> = {
  conventions: '团队约定',
  architecture: '架构与契约',
  commands: '构建与门禁命令',
  pitfalls: '失败与教训',
  workflow: '流程与协作',
  ui: '界面与样式',
  host: '宿主集成',
  domain: '业务与项目',
}

/** 旧快照没有 `quotas` 时的兜底上限：与宿主 `PROJECT_MAX_FILES` / `PUBLIC_MAX_FILES` 同口径。 */
const MEMORY_DEFAULT_MAX_FILES: Record<MemoryTrack, number> = { project: 8, public: 6 }
/** 旧快照没有 `maxEntriesPerFile` 时的兜底上限（宿主 `ENTRIES_PER_FILE`）。 */
const MEMORY_DEFAULT_MAX_ENTRIES = 40

export type MemoryWarningTone = 'info' | 'warn' | 'danger'

export interface MemoryWarningView {
  key: string
  tone: MemoryWarningTone
  text: string
}

export interface MemoryQuotaRowView {
  track: MemoryTrack
  files: number
  maxFiles: number
  totalEntries: number
  maxEntriesPerFile: number
  /** 顶栏文案，例：`项目记忆 5/8 · 63 条`（中文由客户端拼，数字全部来自宿主）。 */
  text: string
  tone: 'ok' | 'warn' | 'danger'
  warnings: MemoryWarningView[]
  legacyFileCount: number
}

/**
 * 配额行：宿主只给数字，中文提示在这里单点拼。
 *
 * `quota` 缺省（旧快照）时用 `files` 的 canonical 计数兜底；**不猜**未下发的上限，
 * 只退回与宿主常量同口径的默认值，并在提示里明确这是「未下发」而不是真实统计。
 */
export function memoryQuotaRowOf(
  track: MemoryTrack,
  quota: MemoryQuotaView | undefined,
  files: readonly MemoryFileView[],
  legacyFileCount?: number,
): MemoryQuotaRowView {
  const canonical = files.filter((file) => file.track === track && file.canonical && !file.legacy)
  const fallbackFiles = canonical.length
  const fallbackEntries = canonical.reduce((sum, file) => sum + (usableNumber(file.active) ? file.active : 0), 0)
  const maxFiles = usableNumber(quota?.maxFiles) && quota.maxFiles > 0
    ? Math.round(quota.maxFiles)
    : MEMORY_DEFAULT_MAX_FILES[track]
  const count = usableNumber(quota?.files) ? Math.round(quota.files) : fallbackFiles
  const totalEntries = usableNumber(quota?.totalEntries) ? Math.round(quota.totalEntries) : fallbackEntries
  const maxEntriesPerFile = usableNumber(quota?.maxEntriesPerFile) && quota.maxEntriesPerFile > 0
    ? Math.round(quota.maxEntriesPerFile)
    : MEMORY_DEFAULT_MAX_ENTRIES
  const nearFiles = quota === undefined ? count >= maxFiles - 1 : quota.nearFiles === true
  const overFiles = quota === undefined ? count > maxFiles : quota.overFiles === true
  const nearFullFiles = Array.isArray(quota?.nearFullFiles) ? quota.nearFullFiles.filter((name) => typeof name === 'string') : []
  const fullFiles = Array.isArray(quota?.fullFiles) ? quota.fullFiles.filter((name) => typeof name === 'string') : []
  const legacy = usableNumber(legacyFileCount) ? Math.round(legacyFileCount) : 0

  const warnings: MemoryWarningView[] = []
  if (overFiles) {
    warnings.push({
      key: 'over-files',
      tone: 'danger',
      text: `主题文件数 ${count}/${maxFiles} 已超出上限：请手工删除多余的主题文件`,
    })
  } else if (nearFiles) {
    warnings.push({
      key: 'near-files',
      tone: 'warn',
      text: `主题文件数 ${count}/${maxFiles} 已接近上限：继续沉淀会先淘汰旧条目`,
    })
  }
  if (fullFiles.length > 0) {
    warnings.push({
      key: 'full-files',
      tone: 'warn',
      text: `${fullFiles.join('、')} 已满 ${maxEntriesPerFile} 条：新写入会先淘汰最旧的 P2`,
    })
  }
  if (nearFullFiles.length > 0) {
    warnings.push({
      key: 'near-full-files',
      tone: 'warn',
      text: `${nearFullFiles.join('、')} 接近满（${maxEntriesPerFile} 条上限）：建议清理低优先级条目，或把要保留的升为 P0`,
    })
  }

  const tone: MemoryQuotaRowView['tone'] = overFiles ? 'danger' : warnings.some((item) => item.tone === 'warn') ? 'warn' : 'ok'
  return {
    track,
    files: count,
    maxFiles,
    totalEntries,
    maxEntriesPerFile,
    text: `${track === 'public' ? '公共记忆' : '项目记忆'} ${count}/${maxFiles} · ${totalEntries} 条`,
    tone,
    warnings,
    legacyFileCount: legacy,
  }
}

export interface MemoryFileRowView {
  key: string
  name: string
  /** 主题标题；不是 canonical 主题（misc/手写文件）时退回文件名。 */
  title: string
  distributionText: string
  distributionTitle: string
  countText: string
  metaText: string
  readOnly: boolean
  active: number
  superseded: number
}

/** 单个记忆文件的行文案：等级分布与条目数全部来自 `file.levels / active / superseded`。 */
export function memoryFileRowOf(file: MemoryFileView): MemoryFileRowView {
  const label = file.topic === null ? '' : MEMORY_TOPIC_LABELS[file.topic] ?? ''
  const active = usableNumber(file.active) ? Math.max(0, Math.round(file.active)) : 0
  const superseded = usableNumber(file.superseded) ? Math.max(0, Math.round(file.superseded)) : 0
  const levels = file.levels ?? { P0: 0, P1: 0, P2: 0 }
  const distributionText = memoryLevelsTextOf(levels)
  const meta: string[] = [file.name]
  if (file.readOnly) meta.push('只读（手工维护）')
  else if (!file.canonical) meta.push('非主题文件')
  return {
    key: `${file.track}/${file.name}`,
    name: file.name,
    title: label !== '' ? label : file.name,
    distributionText,
    distributionTitle: '活动条目的等级分布：P0 铁律 / P1 教训 / P2 常规',
    countText: superseded > 0 ? `活动 ${active} 条 · 已作废 ${superseded}` : `活动 ${active} 条`,
    metaText: meta.join(' · '),
    readOnly: file.readOnly === true,
    active,
    superseded,
  }
}

function memoryLevelsTextOf(levels: { P0: number; P1: number; P2: number }): string {
  const parts: string[] = []
  for (const level of ['P0', 'P1', 'P2'] as const) {
    const value = levels[level]
    const count = usableNumber(value) ? Math.max(0, Math.round(value)) : 0
    if (count > 0) parts.push(`${level} ${count}`)
  }
  return parts.length === 0 ? '暂无活动条目' : parts.join(' · ')
}

export type MemoryEntryTone = 'strong' | 'normal' | 'muted'

export interface MemoryEntryRowView {
  key: string
  id: string
  level: MemoryLevel
  levelText: string
  text: string
  /** 宿主格式化好的 `来源：… · … · 修正 N`；客户端不做二次格式化。 */
  sourceText: string
  revisions: number
  superseded: boolean
  supersededText: string
  tone: MemoryEntryTone
}

export function memoryEntryRowOf(entry: MemoryEntryView): MemoryEntryRowView {
  const level: MemoryLevel = entry.level === 'P0' || entry.level === 'P1' ? entry.level : 'P2'
  const text = typeof entry.text === 'string' ? entry.text : ''
  const sourceText = typeof entry.sourceText === 'string' ? entry.sourceText : ''
  return {
    key: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `${entry.file}:${entry.at}:${entry.level}`,
    id: typeof entry.id === 'string' ? entry.id : '',
    level,
    levelText: level,
    text: text.trim() === '' ? '（空条目）' : text,
    sourceText: sourceText.trim() === '' ? `来源：${entry.source}` : sourceText,
    revisions: usableNumber(entry.revisions) ? Math.max(1, Math.round(entry.revisions)) : 1,
    superseded: entry.superseded === true,
    supersededText: '已作废',
    tone: level === 'P0' ? 'strong' : level === 'P1' ? 'normal' : 'muted',
  }
}

export interface MemoryEntriesView {
  active: MemoryEntryRowView[]
  superseded: MemoryEntryRowView[]
}

/** 活动/已作废分栏：宿主字段直接过滤，不解析正文。 */
export function memoryEntriesOf(entries: readonly MemoryEntryView[]): MemoryEntriesView {
  const active: MemoryEntryRowView[] = []
  const superseded: MemoryEntryRowView[] = []
  for (const entry of entries) {
    const row = memoryEntryRowOf(entry)
    if (row.superseded) superseded.push(row)
    else active.push(row)
  }
  return { active, superseded }
}

export interface MemoryCurationReportView {
  phase: 'preview' | 'done'
  headline: string
  counts: string[]
  warnings: string[]
  canApply: boolean
  applyLabel: string
  closeLabel: string
}

/** 整理报告：dry-run 只报「将新增 / 已存在 / 已满」，执行完才显示已写入。 */
export function memoryCurationReportOf(report: MemoryCurateReport): MemoryCurationReportView {
  const preview = report.dryRun === true
  const added = usableNumber(report.added) ? Math.max(0, Math.round(report.added)) : 0
  const extracted = usableNumber(report.extracted) ? Math.max(0, Math.round(report.extracted)) : 0
  const scanned = usableNumber(report.scannedFiles) ? Math.max(0, Math.round(report.scannedFiles)) : 0
  const skippedExisting = usableNumber(report.skippedExisting) ? Math.max(0, Math.round(report.skippedExisting)) : 0
  const skippedFull = usableNumber(report.skippedFull) ? Math.max(0, Math.round(report.skippedFull)) : 0
  const skippedInvalid = usableNumber(report.skippedInvalid) ? Math.max(0, Math.round(report.skippedInvalid)) : 0
  const target = report.target
  const counts = [`扫描旧流水 ${scanned} 个文件`, `提取 ${extracted} 条`, `已存在 ${skippedExisting} 条`, `已满跳过 ${skippedFull} 条`]
  if (skippedInvalid > 0) counts.push(`无法解析 ${skippedInvalid} 个文件`)
  if (target !== undefined && typeof target.name === 'string') {
    counts.push(`目标 ${target.name}：${target.before} → ${target.after} 条`)
  }
  const warnings = Array.isArray(report.warnings)
    ? report.warnings.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
  return {
    phase: preview ? 'preview' : 'done',
    headline: preview
      ? `预演完成：将新增 ${added} 条 P1 教训`
      : added > 0
        ? `整理完成：新增 ${added} 条 P1 教训`
        : '整理完成：没有需要新增的条目',
    counts,
    warnings,
    canApply: preview && added > 0,
    applyLabel: `确认写入 ${added} 条`,
    closeLabel: preview ? '取消预览' : '关闭报告',
  }
}

export interface MemoryCurationOutcome {
  ok: boolean
  message?: string
  report?: MemoryCurateReport
  notices: string[]
}

/**
 * `act({type:'curateMemory'})` 的解包口（`feedbackOf` 的姊妹函数）。
 *
 * 为什么要单独一个：整理报告在 `ActResult.curation`，而 `feedbackOf` 会把它丢掉；
 * 组件里直接 `result.data.curation` 又会让「整包赋值」那一族 bug 复活。
 */
export function memoryCurationOutcomeOf(result: unknown): MemoryCurationOutcome {
  if (result === null || result === undefined) return { ok: true, notices: [] }
  const box = result as Record<string, unknown>
  const transportError = str(box.error)
  if (transportError !== '') return { ok: false, message: transportError, notices: [] }

  const payload = (box.data ?? box) as Record<string, unknown>
  if (payload === null || typeof payload !== 'object') return { ok: true, notices: [] }

  const notices = Array.isArray(payload.notices)
    ? payload.notices.filter((item): item is string => typeof item === 'string')
    : []
  const rejected = payload.rejected as Record<string, unknown> | undefined
  if (rejected !== undefined && rejected !== null && typeof rejected === 'object') {
    const message = str(rejected.message).trim()
    const code = str(rejected.code).trim()
    return { ok: false, message: message !== '' ? message : code !== '' ? code : '整理被拒绝', notices }
  }

  const report = payload.curation
  if (report === null || report === undefined || typeof report !== 'object') {
    return { ok: true, notices }
  }
  const typed = report as MemoryCurateReport
  if (typed.ok === false) {
    const message = Array.isArray(typed.warnings) ? typed.warnings.find((item) => typeof item === 'string') : undefined
    return { ok: false, message: message ?? '整理失败', report: typed, notices }
  }
  return { ok: true, report: typed, notices }
}

/* ───────────── 确认弹窗 ───────────── */

export interface ConfirmVerb {
  title: string
  action: string
  confirm: string
  object: 'task' | 'run'
}

const CONFIRM_VERBS: Record<string, ConfirmVerb> = {
  cancel: { title: '终止运行', action: '取消运行', confirm: '终止运行', object: 'run' },
  cancelTask: { title: '中断成员', action: '中断成员', confirm: '中断成员', object: 'task' },
  skipTask: { title: '跳过任务', action: '跳过任务', confirm: '跳过任务', object: 'task' },
  updateAcceptance: { title: '重新门禁', action: '重跑门禁', confirm: '重新门禁', object: 'task' },
  forceParallel: { title: '强制并行', action: '强制并行', confirm: '强制并行', object: 'task' },
  // r24：收口一条残留计划（终态 run 幂等返回 unchanged，有存活成员则被宿主拒绝）。
  closeRun: { title: '终止残留计划', action: '终止计划', confirm: '终止计划', object: 'run' },
}

const FALLBACK_VERB: ConfirmVerb = { title: '不可逆操作', action: '执行动作', confirm: '确认执行', object: 'task' }

/** 弹窗标题/按钮文案：动词短语，绝不用「确定」（DESIGN §2.6）。 */
export function confirmVerbOf(action: string): ConfirmVerb {
  return CONFIRM_VERBS[action] ?? FALLBACK_VERB
}

export interface ConfirmDialogView {
  title: string
  actionLabel: string
  objectText: string
  summary: string
  waitedText: string
  confirmLabel: string
  rejectLabel: string
  irreversibleText: string
}

export function confirmDialogOf(pending: PendingConfirmationView): ConfirmDialogView {
  const verb = confirmVerbOf(pending.action)
  return {
    title: `确认${verb.title}？`,
    actionLabel: `${verb.action}（${pending.action}）`,
    objectText: verb.object === 'task' ? `任务 ${pending.taskId ?? '（未知）'}` : `运行 ${pending.runId}`,
    summary: pending.summary,
    waitedText: pending.waitedText || '刚刚',
    confirmLabel: verb.confirm,
    rejectLabel: '取消',
    irreversibleText: '此操作不可撤销',
  }
}

/* ───────────── 装配：任务 / 流转 / 角色 / run 详情 ───────────── */

export interface TaskDetailContext {
  roleName: string
  usage?: UsageCell
  duration?: DurationCell
  messageCount: number
}

/** 没有计时来源时的兜底：未开始的状态词 = 未开始，其余 = 不可得。 */
function fallbackDurationOf(status: TaskStatus): DurationCell {
  switch (status) {
    case 'pending':
    case 'blocked':
    case 'ready':
    case 'waiting':
      return { state: 'not-started', text: NOT_STARTED_TEXT }
    default:
      return { state: 'unavailable', text: UNAVAILABLE_TEXT }
  }
}

/**
 * 逐任务详情装配。
 *
 * 第二参故意**不叫 `ctx`**：宿主的 `ctx` 是服务定位器，client 侧有守卫断言
 * 「client 里出现的 `ctx.<x>` 必须是 inject 过的服务」（test/host-contract.test.ts），
 * 这里只是普通的装配入参，用 `ctx` 会被静态守卫误判成服务访问。
 */
export function buildTaskDetail(task: PlanTask, parts: TaskDetailContext): TaskCardSource {
  const detail: TaskCardSource = {
    id: task.id,
    title: task.title,
    roleId: task.roleId,
    roleName: parts.roleName || task.roleId,
    status: progressOf(task).status,
    dependsOn: [...(task.dependsOn ?? [])],
    acceptance: task.acceptance ?? '',
    usage: usageCellOr(parts.usage, '该任务没有可用用量事件'),
    duration: parts.duration ?? fallbackDurationOf(progressOf(task).status),
    messageCount: parts.messageCount,
  }
  if (task.writeScopes) detail.writeScopes = [...task.writeScopes]
  if (task.evidence) detail.evidence = task.evidence
  if (typeof task.attempts === 'number') detail.attempts = task.attempts
  const waitReason = waitReasonOf(task)
  if (waitReason) detail.waitReason = waitReason
  // r21：快照任务直接把修订/作废事实位带进卡片视图（历史 `TaskDetailView` 没有这些字段）。
  if (typeof task.revisedAt === 'number') detail.revisedAt = task.revisedAt
  if (typeof task.revisionNote === 'string') detail.revisionNote = task.revisionNote
  if (typeof task.cancelledAt === 'number') detail.cancelledAt = task.cancelledAt
  if (typeof task.cancelReason === 'string') detail.cancelReason = task.cancelReason
  if (task.cancelledBy !== undefined) detail.cancelledBy = task.cancelledBy
  return detail
}

export interface FlowCells {
  usage?: Record<string, UsageCell>
  durations?: Record<string, DurationCell>
}

/**
 * 依赖拓扑 → 流转图。列 = 最长依赖深度（0 起），行 = 同列内计划顺序。
 *
 * 环（坏计划 / 历史脏数据）不能让渲染死循环：遇到回边按深度 0 处理，图仍然画得出来。
 */
export function buildFlow(
  tasks: PlanTask[],
  cells: FlowCells = {},
  roleNameOf?: (roleId: string) => string,
): FlowView {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (id: string): number => {
    const cached = depth.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    const task = byId.get(id)
    if (!task) return 0
    visiting.add(id)
    let value = 0
    for (const dep of task.dependsOn ?? []) {
      if (!byId.has(dep)) continue
      value = Math.max(value, depthOf(dep) + 1)
    }
    visiting.delete(id)
    depth.set(id, value)
    return value
  }
  const rowCursor = new Map<number, number>()
  const nodes: FlowNodeView[] = []
  for (const task of tasks) {
    const column = depthOf(task.id)
    const row = rowCursor.get(column) ?? 0
    rowCursor.set(column, row + 1)
    const node: FlowNodeView = {
      id: task.id,
      title: task.title,
      status: progressOf(task).status,
      // r16 AC-12：角色归属必须随节点下发（宿主 flowOf 同样填），客户端据此分列；
      // column/row 仍是旧的依赖深度，只为兼容旧消费方，不再参与角色列布局。
      roleId: task.roleId,
      column,
      row,
      usage: usageCellOr(cells.usage?.[task.id], '该任务没有可用用量事件'),
      duration: cells.durations?.[task.id] ?? fallbackDurationOf(progressOf(task).status),
    }
    // r14 AC-5：节点首行显示角色名。PlanTask 只有 roleId，名字由调用方给（快照路径取 roles 表）。
    if (roleNameOf !== undefined) node.roleName = roleNameOf(task.roleId)
    nodes.push(node)
  }
  const edges: FlowEdgeView[] = []
  for (const task of tasks) {
    for (const dep of task.dependsOn ?? []) {
      const upstream = byId.get(dep)
      if (!upstream) continue
      edges.push({ from: dep, to: task.id, upstreamDone: progressOf(upstream).status === 'done' })
    }
  }
  const columns = nodes.reduce((max, node) => Math.max(max, node.column + 1), 0)
  const rows = nodes.reduce((max, node) => Math.max(max, node.row + 1), 0)
  return { nodes, edges, columns, rows }
}

/**
 * 用量合计：全部任务都有来源才敢给一个数。
 *
 * 部分缺失时**不**把已知项加起来 —— 那会得出一个比真实值小的数字，比「不可得」更误导。
 */
function sumUsage(cells: readonly UsageCell[], missingReason: string): UsageCell {
  let total = 0
  let available = 0
  for (const cell of cells) {
    if (cell.source === 'provider' && cell.tokens) {
      total += cell.tokens.total
      available += 1
    }
  }
  if (available === 0) return { source: 'unavailable', reason: missingReason }
  if (available < cells.length) return { source: 'unavailable', reason: '部分任务没有可用用量事件' }
  return { source: 'provider', tokens: { total } }
}

/**
 * 逐角色聚合：只列真正有任务的角色（没任务的角色不占位置）。
 *
 * r14 AC-7/AC-8/AC-9：状态 / 当前任务 / 用时走 `shared/role-view.ts#roleStateOf`，
 * 用量走同文件的 `roleUsageCellOf` —— 与宿主 `library.rolesOf` **同一份实现**，
 * 所以右栏与抽屉里的文案逐字相等（AC-17）。r13 里这里另写了一份「部分缺失即不可得」
 * 的合计，宿主却把已知项加起来（QA D2），两边因此对同一张角色卡说两种话。
 */
export function roleUsageOf(tasks: readonly TaskDetailView[], roles: readonly Role[]): RoleUsageView[] {
  const order: string[] = []
  const groups = new Map<string, TaskDetailView[]>()
  for (const task of tasks) {
    const list = groups.get(task.roleId)
    if (list) list.push(task)
    else {
      groups.set(task.roleId, [task])
      order.push(task.roleId)
    }
  }
  return order.map((roleId) => {
    const list = groups.get(roleId) ?? []
    const known = roles.find((role) => role.id === roleId)
    const state = roleStateOf(list)
    const view: RoleUsageView = {
      roleId,
      name: known?.name ?? list[0]?.roleName ?? roleId,
      tasks: list.length,
      usage: roleUsageCellOf(list.map((task) => task.usage)),
      done: state.done,
      state: state.state,
      stateText: state.stateText,
      duration: state.duration,
      // r16 AC-16：角色卡 refs 行按计划顺序列出该角色的任务编号（只加可选字段，旧快照安全）。
      taskRefs: list.map((task) => ({ id: task.id, status: task.status })),
    }
    if (state.activeTaskId !== undefined) view.activeTaskId = state.activeTaskId
    if (state.activeTaskTitle !== undefined) view.activeTaskTitle = state.activeTaskTitle
    return view
  })
}

/** 左右栏（snapshot / library）共用的装配输入。 */
export interface RunDetailSource {
  snapshot: PanelSnapshot | null
  runDetail?: RunDetailView
  library?: LibraryView | null
}

/**
 * **唯一**的 run 详情装配入口（AC-18）：右栏传 snapshot，左栏传 library / 历史详情。
 *
 * 三源优先级：显式 `runDetail` → `library.detail` → `snapshot`。带 `runId` 时只有明确
 * 指向该 run 的来源才可用，否则返回 `null`（渲染空态），绝不把 A 的详情贴到 B 的标题下。
 */
export function buildRunDetail(source: RunDetailSource, runId?: string): RunDetailView | null {
  const direct = source.runDetail ?? source.library?.detail
  if (direct && (runId === undefined || direct.runId === runId)) return direct

  const snapshot = source.snapshot
  const snapshotRunId = snapshot?.runId
  if (!snapshot || typeof snapshotRunId !== 'string' || snapshotRunId === '') return null
  if (runId !== undefined && snapshotRunId !== runId) return null

  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : []
  const roles = Array.isArray(snapshot.roles) ? snapshot.roles : []
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : []
  const roleNameOf = (roleId: string): string => roles.find((role) => role.id === roleId)?.name ?? roleId
  const taskViews = tasks.map((task) =>
    buildTaskDetail(task, {
      roleName: roleNameOf(task.roleId),
      usage: snapshot.taskUsage?.[task.id],
      duration: snapshot.taskDurations?.[task.id],
      messageCount: messages.filter((message) => message.taskId === task.id).length,
    }),
  )
  const duration: DurationCell = snapshot.runDuration ?? { state: 'unavailable', text: UNAVAILABLE_TEXT }
  // 宿主快照**永远**带 `runUsage`（没有用量事件时是 `unavailable` 单元格而不是缺字段），
  // 所以这里不能用 `??` 判「缺」：r17 真机实测 `runUsage={source:'unavailable'}` 时
  // `??` 永不回退，`sumUsage` 的聚合分支成了单测里才走得到的死代码 —— 即使任务级用量
  // 已经打通，面板「成员合计」仍会恒显示「不可得」。优先级：
  //   ① 宿主 run 合计（provider）= 权威值，直接采用；
  //   ② 否则若任务级有数据（完整才给数、部分缺失仍不可得，不低估），用聚合值；
  //   ③ 再否则保留宿主给的 unavailable 原因（如「尚无用量事件」），没有才用兜底文案。
  const taskUsageCells = taskViews.map((task) => task.usage)
  const aggregatedUsage = sumUsage(taskUsageCells, '该 run 没有可用用量事件')
  const hasTaskUsage = taskUsageCells.some((cell) => cell.source === 'provider' && cell.tokens !== undefined)
  const usage: UsageCell =
    snapshot.runUsage?.source === 'provider'
      ? snapshot.runUsage
      : aggregatedUsage.source === 'provider' || hasTaskUsage
        ? aggregatedUsage
        : (snapshot.runUsage ?? aggregatedUsage)
  const detail: RunDetailView = {
    runId: snapshotRunId,
    // 快照不带会话 id（会话是请求维度而非 run 维度）；T7 在需要时由 api 层补齐。
    sessionId: '',
    planStatus: snapshot.planStatus ?? 'draft',
    usage,
    duration,
    roles: roleUsageOf(taskViews, roles),
    tasks: taskViews,
    flow: buildFlow(tasks, { usage: snapshot.taskUsage, durations: snapshot.taskDurations }, roleNameOf),
  }
  if (snapshot.project) detail.project = snapshot.project
  if (snapshot.plannedAt) detail.plannedAt = snapshot.plannedAt
  if (duration.endAt) detail.finishedAt = duration.endAt
  if (snapshot.pendingConfirmation) detail.pendingConfirmation = snapshot.pendingConfirmation
  return detail
}
