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
  MemoryItemView,
  PanelAction,
  PanelSnapshot,
  PendingConfirmationView,
  PlanStatus,
  PlanTask,
  Role,
  RoleModelRoute,
  RoleUsageView,
  RunDetailView,
  ScopeLockView,
  TaskDetailView,
  TaskStatus,
  TokenTotals,
  UsageCell,
  UsageSource,
} from '../shared/types.ts'

/** dock 胶囊的 5 种 tone（DESIGN §2：关/待派发=idle，计划就绪=plan，在跑=run，失败=fail，全绿=done）。 */
export type CapsuleTone = 'idle' | 'run' | 'plan' | 'done' | 'fail'

export interface Capsule {
  tone: CapsuleTone
  text: string
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
}

const UNKNOWN_BADGE: Badge = { icon: '?', text: '未知', tone: 'neutral' }

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

  if (snapshot.planStatus === 'cancelled') return { tone: 'idle', text: '已取消' }
  if (snapshot.planStatus === 'terminated') return { tone: 'idle', text: '已终止' }
  if (snapshot.planStatus === 'paused') return { tone: 'idle', text: '已暂停' }
  if (failed > 0) return { tone: 'fail', text: `有失败 · ${failed}` }
  if (interrupted > 0) return { tone: 'fail', text: `已中断 · ${interrupted}` }
  if (running > 0) return { tone: 'run', text: `运行中 ${running}/${limit}` }
  if (tasks.length > 0 && done === tasks.length) {
    return { tone: 'done', text: `已完成 · ${tasks.length} 任务` }
  }
  // AC-30：计划已生成但**一个成员都还没创建** —— 这是「先计划、后派发」的可视证据
  if (tasks.length > 0 && members.length === 0) {
    return { tone: 'plan', text: `计划就绪 · ${tasks.length} 任务` }
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
  draft: { label: '计划就绪', tone: 'ok' },
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

/** 千分位分组：与宿主 `format.ts` 的 `groupDigits` 逐字一致（客户端唯一的数字分组实现）。 */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 可用数字（有限、非负）。`0` 合法 —— 「花了 0 token」是真话，不是缺失。 */
function usableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function fullTokenText(total: number | undefined): string {
  if (!usableNumber(total)) return UNAVAILABLE_TEXT
  return groupDigits(String(Math.round(total)))
}

function oneDecimal(value: number): string {
  const text = value.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

function compactTokenText(total: number | undefined): string {
  if (!usableNumber(total)) return UNAVAILABLE_TEXT
  const value = Math.round(total)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${oneDecimal(value / 1_000)}k`
  return `${oneDecimal(value / 1_000_000)}M`
}

/**
 * token 单元格文本：`provider` 走千分位，`unavailable` 一律「不可得」。
 *
 * 为什么不显示 `-` 或 `0`：`-` 会被读成「还没跑」，`0` 会被读成「跑了但没花 token」，
 * 两者都是假话；「不可得」是唯一诚实的第三种状态（DESIGN §2.2）。
 */
export function tokenTextOf(cell: UsageCell | null | undefined): string {
  if (!cell || cell.source !== 'provider') return UNAVAILABLE_TEXT
  return fullTokenText(cell.tokens?.total)
}

/** 流转节点第二行用的紧凑 token（宽 128px）；超过 7 字符时由调用方降级到它。 */
export function compactTokenTextOf(cell: UsageCell | null | undefined): string {
  if (!cell || cell.source !== 'provider') return UNAVAILABLE_TEXT
  return compactTokenText(cell.tokens?.total)
}

/** token 单元格的 `title`：不可得时给原因，可得时给输入/输出明细。 */
export function tokenTitleOf(cell: UsageCell | null | undefined): string {
  if (!cell || cell.source !== 'provider') return cell?.reason ?? '该处没有用量来源'
  const parts: string[] = [`合计 ${fullTokenText(cell.tokens?.total)} token`]
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
    case 'unavailable':
      return '没有开始时间，算不出用时'
    default:
      return `开始 ${formatStamp(cell.startAt)} · 结束 ${formatStamp(cell.endAt)}`
  }
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
}

export function runHeadOf(detail: RunDetailView, inflight: InflightState = 'idle'): RunHeadView {
  const status = planStatusView(detail.planStatus)
  const inflightView = inflightOf(inflight)
  const head: RunHeadView = {
    runId: detail.runId,
    planStatusLabel: status.label,
    planStatusTone: status.tone,
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
  if (head.usageSource !== 'provider') head.downgrade = `token ${UNAVAILABLE_TEXT}（无用量来源）`
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
}

export function taskRowOf(task: TaskDetailView, expanded: boolean): TaskRowView {
  return {
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
  if (task.duration.state === 'unavailable') panel.durationReason = '没有开始时间，算不出用时'
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

/* ───────────── 流转图 ───────────── */

/** 节点几何（DESIGN §2.4：行高 = 8+20+4+16+8 = 56，宽 148 按最长 ID + 状态文案核算）。 */
export const FLOW_NODE_WIDTH = 148
export const FLOW_NODE_HEIGHT = 56
export const FLOW_COLUMN_STEP = 188
export const FLOW_ROW_STEP = 72
export const FLOW_PADDING = 12

export interface FlowNodeCellView {
  tokenText: string
  durationText: string
  /** 节点第二行的整串（`1,203 · 3 分 12 秒`），超宽时 CSS 加 ellipsis。 */
  text: string
  title: string
  label: string
}

export function flowNodeViewOf(node: FlowNodeView): FlowNodeCellView {
  const full = tokenTextOf(node.usage)
  const tokenText = full.length > 7 ? compactTokenTextOf(node.usage) : full
  const durationText = durationTextOf(node.duration)
  return {
    tokenText,
    durationText,
    text: `${tokenText} · ${durationText}`,
    title: `${node.id} ${node.title}\ntoken ${full} · 用时 ${durationText}`,
    label: `任务 ${node.id} ${node.title}，${statusBadge(node.status).text}，token ${full}，用时 ${durationText}`,
  }
}

export interface FlowLayoutNode {
  node: FlowNodeView
  cell: FlowNodeCellView
  x: number
  y: number
}

export interface FlowLayoutEdge {
  key: string
  d: string
  upstreamDone: boolean
}

export interface FlowLayout {
  width: number
  height: number
  nodes: FlowLayoutNode[]
  edges: FlowLayoutEdge[]
}

/** 节点左上角坐标 → 三次贝塞尔（水平出入，避免折线穿过节点）。 */
export function flowLayoutOf(flow: FlowView): FlowLayout {
  const columns = Math.max(1, flow.columns)
  const rows = Math.max(1, flow.rows)
  const nodes: FlowLayoutNode[] = flow.nodes.map((node) => ({
    node,
    cell: flowNodeViewOf(node),
    x: FLOW_PADDING + node.column * FLOW_COLUMN_STEP,
    y: FLOW_PADDING + node.row * FLOW_ROW_STEP,
  }))
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
  return {
    width: FLOW_PADDING * 2 + FLOW_NODE_WIDTH + (columns - 1) * FLOW_COLUMN_STEP,
    height: FLOW_PADDING * 2 + FLOW_NODE_HEIGHT + (rows - 1) * FLOW_ROW_STEP,
    nodes,
    edges,
  }
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
export function buildTaskDetail(task: PlanTask, parts: TaskDetailContext): TaskDetailView {
  const detail: TaskDetailView = {
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
export function buildFlow(tasks: PlanTask[], cells: FlowCells = {}): FlowView {
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
      column,
      row,
      usage: usageCellOr(cells.usage?.[task.id], '该任务没有可用用量事件'),
      duration: cells.durations?.[task.id] ?? fallbackDurationOf(progressOf(task).status),
    }
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

/** 逐角色聚合：只列真正有任务的角色（没任务的角色不占位置）。 */
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
    return {
      roleId,
      name: known?.name ?? list[0]?.roleName ?? roleId,
      tasks: list.length,
      usage: sumUsage(
        list.map((task) => task.usage),
        '该角色没有可用用量事件',
      ),
    }
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
  const detail: RunDetailView = {
    runId: snapshotRunId,
    // 快照不带会话 id（会话是请求维度而非 run 维度）；T7 在需要时由 api 层补齐。
    sessionId: '',
    planStatus: snapshot.planStatus ?? 'draft',
    usage: snapshot.runUsage ?? sumUsage(taskViews.map((task) => task.usage), '该 run 没有可用用量事件'),
    duration,
    roles: roleUsageOf(taskViews, roles),
    tasks: taskViews,
    flow: buildFlow(tasks, { usage: snapshot.taskUsage, durations: snapshot.taskDurations }),
  }
  if (snapshot.project) detail.project = snapshot.project
  if (snapshot.plannedAt) detail.plannedAt = snapshot.plannedAt
  if (duration.endAt) detail.finishedAt = duration.endAt
  if (snapshot.pendingConfirmation) detail.pendingConfirmation = snapshot.pendingConfirmation
  return detail
}
