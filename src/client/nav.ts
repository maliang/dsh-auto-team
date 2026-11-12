/**
 * r17 / r18b：任务页 run 行 + 「在主界面打开子智能体」的导航与纯投影。
 *
 * r18b t2：顶部不再是 run 切换器，而是 `activeRunRowsOf` 产出的 run 行 ——
 * 只显示还有进行中任务的 run，一条都没有时只显示「最后一个 run」；每行的展示字段
 * 复用历史列表的 `runSummaryRowOf`（同一个投影，组件不再单独拼文案）。
 *
 * r18b t11：卡内 meta 行另给一份**紧凑全文** `cardMetaText`（见 `cardMetaTextOf`）——
 * 历史列表那句 `开始 … · 结束 … · 任务 d/t` 在 196px 卡宽里必然被截断，任务数看不到；
 * 格式化仍在投影里单点做，组件只贴文本。
 *
 * 这个文件**不渲染、不碰宿主**：导航状态是一个 30 行的订阅式单例，
 * 投影函数只吃 `PanelSnapshot` / `RunSummary` 里的既有形状，因此可以直接
 * `node --test` 跑（组件层再用 `useSyncExternalStore` 订阅同一份状态）。
 *
 * 为什么导航状态不放进 `state.ts`：`state.ts` 的 store 是**按会话**拉数据的缓存，
 * 而「现在主界面看的是项目库还是某个成员」是纯 UI 选择，切会话时也不该丢
 * （成员找不到时由页面给可读兜底，见 `LibraryPage.tsx`）。
 */
import type {
  MemberView,
  MessageRecord,
  PanelSnapshot,
  Role,
  RouteAudit,
  RunSummary,
  TaskDetailView,
} from '../shared/types.ts'
import type { BadgeTone } from './viewmodel.ts'
import {
  durationTextOf,
  durationTitleOf,
  formatClock,
  formatStamp,
  isClosedRun,
  ledgerBodyFoldable,
  memberStatusBadge,
  memberStatusTitleOf,
  peerLabelOf,
  routeTextOf,
  runStageOf,
  statusBadge,
  tokenTextOf,
  tokenTitleOf,
} from './viewmodel.ts'
import { runSummaryRowOf } from './tabs/rows.ts'
import type { RunRowView } from './tabs/rows.ts'
import { requestLibrarySurface } from './slots.ts'
import type { LibraryOpenResult } from './slots.ts'

/* ───────────────────────── 主界面导航（项目库 ⇄ 成员页） ───────────────────────── */

export type MainNavView =
  | { kind: 'library' }
  /**
   * `sessionId`：打开这个成员页的会话（r17 t8 起带）。
   *
   * 宿给 `main` 槽位的 props **没有** sessionId，只靠 `sessionIdOf(props)` 会退回
   * `'current'`，拿到的是没有该成员的快照 → 页面显示「成员已不在当前 run 里」。
   * 因此导航自己记住来源会话，页面据此决定用哪个会话的快照（`resolveMemberSessionId`）。
   */
  | { kind: 'member'; memberId: string; taskId?: string; sessionId?: string }

/** 稳定的「项目库」对象：订阅方可用引用相等快速判断。 */
const LIBRARY_NAV: MainNavView = { kind: 'library' }

let currentNav: MainNavView = LIBRARY_NAV
const navListeners = new Set<() => void>()

/** 当前主界面视图（`useSyncExternalStore` 的 getSnapshot）。 */
export function mainNavView(): MainNavView {
  return currentNav
}

/** 订阅导航变化；返回取消订阅函数。 */
export function subscribeMainNav(listener: () => void): () => void {
  navListeners.add(listener)
  return () => {
    navListeners.delete(listener)
  }
}

function setNav(next: MainNavView): MainNavView {
  currentNav = next
  for (const listener of [...navListeners]) {
    try {
      listener()
    } catch (error) {
      // 一个订阅者渲染出错不能连累其他订阅者（React 会在自己的错误边界里处理它）。
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[dsh-auto-team] 导航订阅回调异常', error)
      }
    }
  }
  return currentNav
}

/**
 * 主界面切到某个成员（空 memberId = 回项目库，避免把空页签当成成员页）。
 *
 * `sessionId` 只在**非空**时写进导航状态：缺省 / 空串都不写这个键，
 * 这样 `mainNavView()` 的 deepEqual 不会因为一个空字段而漂移。
 */
export function openMemberNav(memberId: string, taskId?: string, sessionId?: string): MainNavView {
  const id = typeof memberId === 'string' ? memberId.trim() : ''
  if (id === '') return openLibraryNav()
  const session = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (typeof taskId === 'string' && taskId.trim() !== '') {
    return setNav(
      session === ''
        ? { kind: 'member', memberId: id, taskId: taskId.trim() }
        : { kind: 'member', memberId: id, taskId: taskId.trim(), sessionId: session },
    )
  }
  return setNav(
    session === '' ? { kind: 'member', memberId: id } : { kind: 'member', memberId: id, sessionId: session },
  )
}

/** 主界面切回项目库。 */
export function openLibraryNav(): MainNavView {
  return setNav(LIBRARY_NAV)
}

/** 测试隔离用：清掉导航状态与订阅者（不在生产过程调用）。 */
export function resetMainNav(): void {
  currentNav = LIBRARY_NAV
  navListeners.clear()
}

export interface MemberNavigation {
  /** 导航状态（已切换）。 */
  nav: MainNavView
  /** 打开主区的结局；`null` = 还没注册过 opener（单测 / 非浏览器宿主）。 */
  surface: LibraryOpenResult | null
}

/**
 * 点角色卡 / 任务行 / 流程图节点的唯一入口：先切主界面视图，再请求打开项目库主区。
 *
 * 顺序不能反——`requestLibrarySurface` 可能在 500ms 后降级到右栏内联，
 * 那时主界面必须已经是成员页，否则内联里会闪一下项目库再跳。
 */
export function navigateToMember(
  sessionId: string | undefined,
  memberId: string,
  taskId?: string,
): MemberNavigation {
  const nav = openMemberNav(memberId, taskId, sessionId)
  const surface = requestLibrarySurface(sessionId)
  return { nav, surface }
}

/**
 * 成员页该用哪个会话的快照。
 *
 * 优先级：**导航里记下的来源会话** > slot props 的会话。
 * 宿给 `main` 槽位的 props 没有 sessionId，`sessionIdOf(props)` 会退回 `'current'`，
 * 那份快照里通常没有这个成员；导航记住了来源会话时以它为准。
 */
export function resolveMemberSessionId(propsSessionId: string, nav: MainNavView): string {
  if (nav.kind === 'member' && typeof nav.sessionId === 'string' && nav.sessionId.trim() !== '') {
    return nav.sessionId
  }
  return propsSessionId
}

/**
 * 导航是否「陈旧」：props 给的是**真实会话**，而成员页是在**另一个会话**里打开的。
 *
 * `'current'` 是「宿主没告诉我们」的哨兵，不算真实会话 —— 主界面正是靠这个哨兵
 * 落到导航会话上，不能反过来判成陈旧。
 */
export function isStaleMemberNav(propsSessionId: string, nav: MainNavView): boolean {
  const propsSession = typeof propsSessionId === 'string' ? propsSessionId.trim() : ''
  if (propsSession === '' || propsSession === 'current') return false
  if (nav.kind !== 'member') return false
  if (typeof nav.sessionId !== 'string' || nav.sessionId.trim() === '') return false
  return nav.sessionId.trim() !== propsSession
}

/* ───────────────────────── 任务行/角色卡 → 成员 ───────────────────────── */

function latestOf(list: readonly MemberView[]): MemberView {
  let best = list[0]
  for (const member of list) {
    if (member.lastEventAt > best.lastEventAt) best = member
    else if (member.lastEventAt === best.lastEventAt && member.memberId < best.memberId) best = member
  }
  return best
}

/**
 * 给一个计划任务找执行它的成员。
 *
 * 优先级：**明确绑定了该 taskId 的成员** > 正在跑的成员 > 最近活跃的成员。
 * 角色可能先后有多个成员（返工/续聊会新建），所以不能按 roleId 取第一个。
 */
export function memberForRole(
  members: readonly MemberView[] | null | undefined,
  roleId: string,
  taskId?: string,
): MemberView | undefined {
  const list = Array.isArray(members) ? members.filter((member) => member.roleId === roleId) : []
  if (list.length === 0) return undefined
  if (typeof taskId === 'string' && taskId !== '') {
    const bound = list.filter((member) => member.taskId === taskId)
    if (bound.length > 0) return latestOf(bound)
  }
  const running = list.filter((member) => member.status === 'running')
  if (running.length > 0) return latestOf(running)
  return latestOf(list)
}

/* ───────────────────────── 任务页 run 行（r18b t2） ───────────────────────── */

/**
 * 顶部 run 行：**与历史列表同一套展示字段**（`runSummaryRowOf` 的 `RunRowView`），
 * 只额外加「这一行在当前列表里的位置/选中态」。
 *
 * 复用 `RunRowView` 是刻意的：用户口径是「run 位置和历史列表显示的内容一致」，
 * 所以标题/状态徽标/meta/token 六项必须走同一个投影，不能在这个组件里另拼一份。
 */
export interface ActiveRunRow extends RunRowView {
  /**
   * r18b t11：**卡内 meta 行的紧凑全文**（`216px` 卡里内容宽只有 `196px`，历史列表那句
   * `开始 11-05 13:35:00 · 结束 进行中 · 任务 0/1` 必然被省略号截断，用户看不到任务数）。
   *
   * 只在 `activeRunRowsOf` 一处格式化，组件直接贴（零格式化铁律）；完整的历史文案仍在
   * 继承来的 `metaText` 上，作为 `title` 供悬停查看。
   */
  cardMetaText: string
  /** 本会话的「当前 run」（与「选中」是两回事：可以选中一条历史 run 查看）。 */
  current: boolean
  /** 当前正在查看的 run（`store 选中 runId ?? 当前 runId`）。 */
  selected: boolean
  /** 这一行确实还有非终态任务；false = 没有进行中的 run 时兜底出来的「最后一个 run」。 */
  hasOngoing: boolean
}

export interface ActiveRunsView {
  /** 要渲染的 run 行（≤ 进行中的 run 数；没有进行中的 run 时只有 1 条兜底行）。 */
  rows: ActiveRunRow[]
  /** 生效的选中 runId（store 选中优先，否则当前 run；空串 = 快照没给 runId）。 */
  selectedRunId: string
  /** 本会话当前 run 的 id（快照缺 runId 时按 `active` 的 run 兜底）。 */
  currentRunId: string
  /** true = 没有任何进行中的 run，`rows` 是「最后一个 run」的兜底行。 */
  fallback: boolean
}

export interface ActiveRunsSource {
  snapshot: PanelSnapshot | null | undefined
  /** 右栏共享的选中 run（`PanelView.detailRunId`）；null/缺省 = 当前 run。 */
  selectedRunId?: string | null
}

/**
 * 一个 run 还剩几个非终态任务（= 用户口径里的「进行中」）。
 *
 * 宿主并行任务 t1 起在 `RunSummary` 上派生 `ongoing`（非终态任务数）。
 * 本文件不依赖 `types.ts` 已合入该字段：显式值优先，缺省时按
 * `active === true && done < tasks` 兜底（与宿主「非终态」同一口径，不重算任务状态）。
 *
 * r25：已收口的 run（terminated/cancelled，或带 terminationReason + finishedAt）
 * **一律返回 0** —— 旧数据/旧宿主可能还下发 `ongoing > 0`，但终态 run 绝不能
 * 显示成「进行中」；这是与宿主 `PLAN_TERMINAL_STATUSES` 修正并行的双保险。
 */
function ongoingCountOf(run: RunSummary): number {
  if (isClosedRun(run)) return 0
  const explicit = (run as RunSummary & { ongoing?: number }).ongoing
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) return explicit
  if (run.active === true && run.done < run.tasks) return run.tasks - run.done
  return 0
}

/** 按 `plannedAt ?? createdAt` 取最新的一条（相同时间保留先出现的，排序稳定）。 */
function latestRunOf(runs: readonly RunSummary[]): RunSummary {
  let best = runs[0] as RunSummary
  for (const run of runs) {
    if ((run.plannedAt ?? run.createdAt) > (best.plannedAt ?? best.createdAt)) best = run
  }
  return best
}

/** 计数兜底：缺失 / NaN / 负数 / 非数字一律 0（卡内不出现 `NaN` / `undefined`）。 */
function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * r18b t11：卡内 meta 行的**紧凑全文**（唯一的格式化点）。
 *
 * - 未结束（`finishedAt` 缺失 / 非正数）：`13:35:00 起 · 进行中 · 任务 0/1`
 * - 已结束：`13:35:00 → 13:58:12 · 任务 1/1`
 * - 已收口但没有结束时刻（r25 旧数据）：`13:35:00 起 · 已终止 · 任务 0/1`
 *   —— 绝不能把终态 run 写成「进行中」。
 *
 * 用 `formatClock`（`HH:MM:SS`）而不是 `formatStamp`（`MM-DD HH:MM:SS`）是宽度预算决定的：
 * 196px 内容宽、11px 字号下，最长一条约 26 字符（两个 8 字符时钟 + 4 个 ` 起 · ` 类片段
 * + `任务 12/34`）刚好放得下；带日期则多 6 字符，必然省略号截断（真机证据见
 * `docs/teamflow/2026-11-05-r18b-run-rows/t11-card-meta.md`）。
 */
function cardMetaTextOf(run: RunSummary): string {
  const start = formatClock(run.plannedAt ?? run.createdAt)
  const done = countOf(run.done)
  const tasks = countOf(run.tasks)
  const finishedAt = run.finishedAt
  if (typeof finishedAt === 'number' && Number.isFinite(finishedAt) && finishedAt > 0) {
    return `${start} → ${formatClock(finishedAt)} · 任务 ${done}/${tasks}`
  }
  // r26：未结束的 run 也读阶段判定 —— 只有真的在推进（执行中/派发中）才写「进行中」这个
  // 时间窗词；已暂停 / 有失败 / 已中断 / 待收口 / 计划就绪 / 待派发 / 已终止 一律写阶段，
  // 否则 paused、全部完成未收口的 run 都会被误写成「进行中」。
  const stage = runStageOf({
    planStatus: run.status,
    total: run.tasks,
    done: run.done,
    ...(run.running !== undefined ? { running: run.running } : {}),
    ...(run.failed !== undefined ? { failed: run.failed } : {}),
    ...(run.interrupted !== undefined ? { interrupted: run.interrupted } : {}),
    ...(run.members !== undefined ? { members: run.members } : {}),
    ...(run.terminationReason !== undefined ? { terminationReason: run.terminationReason } : {}),
    ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
  })
  if (stage.key === 'running' || stage.key === 'dispatching') {
    return `${start} 起 · 进行中 · 任务 ${done}/${tasks}`
  }
  return `${start} 起 · ${stage.label}`
}

/**
 * 任务页顶部的 run 行投影。
 *
 * 规则（用户 2026-11-05 口径）：
 *  ① 候选 = 本会话 `runs` 里 `ongoing > 0` 的 run，按 `plannedAt ?? createdAt` 倒序；
 *  ② 没有候选时，只显示「最后一个 run」（按同一时间字段取最新的一条）；
 *  ③ `runs` 为空（未启用 / 快照未到）→ 返回 `null`，调用方不渲染这一块。
 *
 * 选中语义：`selected = (source.selectedRunId || currentRunId) === run.runId`。
 * 选中的 run 不在候选里时**不会**被塞进来 —— 这里是「进行中 run 的状态位」，
 * 不是完整切换器；历史 run 仍从历史页进入（见 `HistoryTab`）。
 */
export function activeRunRowsOf(source: ActiveRunsSource): ActiveRunsView | null {
  const snapshot = source.snapshot ?? null
  const runs: RunSummary[] = Array.isArray(snapshot?.runs) ? snapshot.runs : []
  if (runs.length === 0) return null

  const currentRunId =
    typeof snapshot?.runId === 'string' && snapshot.runId !== ''
      ? snapshot.runId
      : runs.find((run) => run.active === true)?.runId ?? ''
  const storeSelected =
    typeof source.selectedRunId === 'string' && source.selectedRunId.trim() !== ''
      ? source.selectedRunId
      : ''
  const selectedRunId = storeSelected !== '' ? storeSelected : currentRunId

  const ongoing = runs.filter((run) => ongoingCountOf(run) > 0)
  const fallback = ongoing.length === 0
  const picked = fallback
    ? [latestRunOf(runs)]
    : [...ongoing].sort(
        (a, b) => (b.plannedAt ?? b.createdAt) - (a.plannedAt ?? a.createdAt),
      )

  const rows: ActiveRunRow[] = picked.map((run) => {
    const hasOngoing = ongoingCountOf(run) > 0
    return {
      ...runSummaryRowOf(run),
      cardMetaText: cardMetaTextOf(run),
      current: run.runId === currentRunId,
      selected: run.runId === selectedRunId,
      hasOngoing,
    }
  })
  return { rows, selectedRunId, currentRunId, fallback }
}

/** 任务页空态的三段式文案（`EmptyState` 的 title/hint/next）。 */
export interface TasksEmptyStateView {
  title: string
  hint: string
  next: string
}

/**
 * 任务页空态文案（r17 D3）：历史详情读不到（被清理 / 404 / 网络失败）时，
 * 不能再沿用「正在读取历史 run…」——那会让用户一直等一个永远不会来的响应。
 *
 * `libraryError` 只在**选中历史 run 且详情为空**时有意义；当前 run 的空态是
 * 「尚未生成计划」，与读取失败无关。
 */
export function tasksEmptyStateOf(input: {
  historicalRunId: string | null
  libraryError: string | null
}): TasksEmptyStateView {
  if (input.historicalRunId === null) {
    return {
      title: '尚未生成计划',
      hint: '告诉队长要达成的目标，计划落盘后会自动开跑',
      next: '对队长说一句话即可',
    }
  }
  if (input.libraryError !== null) {
    return {
      title: '读不到这条历史 run',
      hint: input.libraryError,
      next: '返回当前 run 或换一条历史 run',
    }
  }
  return {
    title: '正在读取历史 run…',
    hint: '历史 run 详情会在加载完成后替换这一屏',
    next: '读取中，不用重复点击',
  }
}

/* ───────────────────────── 子智能体主界面 ───────────────────────── */

export interface MemberTaskView {
  taskId: string
  title: string
  statusText: string
  statusTone: BadgeTone
  acceptance: string
  dependsText: string
  scopeText: string
  tokenText: string
  tokenTitle: string
  usageSource: string
  durationText: string
  durationTitle: string
  durationState: string
  evidenceText: string
}

export interface MemberMessageView {
  messageId: string
  fromText: string
  toText: string
  atText: string
  body: string
  foldable: boolean
}

export interface MemberRouteAuditView {
  verdict: 'ok' | 'drift' | 'unverified'
  text: string
  tone: BadgeTone
}

export interface MemberPageView {
  memberId: string
  name: string
  statusText: string
  statusTone: BadgeTone
  /** r21：停止态/其它态的悬停说明（只解释宿主已下发的事实，如「尚未确认停止」）。 */
  statusTitle?: string
  roleId: string
  roleName: string
  duty: string
  modelRoute: string
  routeAudit?: MemberRouteAuditView
  lastActiveText: string
  stalled: boolean
  stalledText: string
  canResume: boolean
  resumeText: string
  taskText: string
  task?: MemberTaskView
  messages: MemberMessageView[]
  messageCount: number
  emptyMessagesText: string
}

export interface MemberPageSource {
  member: MemberView
  /** run 详情里的角色用量投影（缺省 = 当前 run 里没有这个角色）。 */
  role?: { roleId: string; name: string; activeTaskId?: string } | null
  /** 角色定义（职责 / 技能），来自 `snapshot.roles`。 */
  roleDefinition?: Role | null
  /** 该成员执行的任务；缺省 = 未绑定任务或任务不在当前 run 里。 */
  task?: TaskDetailView | null
  messages?: readonly MessageRecord[] | null
  audits?: readonly RouteAudit[] | null
  now?: number
}

/** 成员消息最多展示几条（宿主账本最多 200 条，全铺会把成员页撑爆）。 */
export const MEMBER_MESSAGE_LIMIT = 8

function latestAuditOf(
  audits: readonly RouteAudit[],
  member: MemberView,
): RouteAudit | undefined {
  const exact = member.taskId === undefined
    ? []
    : audits.filter((audit) => audit.taskId === member.taskId)
  const pool = exact.length > 0 ? exact : audits.filter((audit) => audit.roleId === member.roleId)
  let best: RouteAudit | undefined
  for (const audit of pool) {
    if (best === undefined || audit.at >= best.at) best = audit
  }
  return best
}

function routeAuditViewOf(
  member: MemberView,
  audits: readonly RouteAudit[],
): MemberRouteAuditView | undefined {
  const audit = latestAuditOf(audits, member)
  if (audit === undefined) return undefined
  const declared = routeTextOf(audit.declared) || member.modelRoute || '会话默认模型'
  const actual = routeTextOf(audit.actual)
  if (audit.verdict === 'ok') {
    return { verdict: 'ok', tone: 'success', text: `声明 ${declared} · 已核对` }
  }
  if (audit.verdict === 'drift') {
    const actualText = actual === '' ? '未知' : actual
    return { verdict: 'drift', tone: 'danger', text: `路由漂移：声明 ${declared}，实际 ${actualText}` }
  }
  return { verdict: 'unverified', tone: 'warn', text: `声明 ${declared} · 宿主未回传实际路由` }
}

function memberTaskOf(task: TaskDetailView): MemberTaskView {
  const badge = statusBadge(task.status)
  const evidence = task.evidence
  return {
    taskId: task.id,
    title: task.title,
    statusText: badge.text,
    statusTone: badge.tone,
    acceptance: task.acceptance?.trim() || '（未声明验收命令）',
    dependsText: task.dependsOn.length > 0 ? task.dependsOn.join(' / ') : '无前置任务',
    scopeText:
      task.writeScopes !== undefined && task.writeScopes.length > 0
        ? task.writeScopes.join(' / ')
        : '未声明写域',
    tokenText: tokenTextOf(task.usage),
    tokenTitle: tokenTitleOf(task.usage),
    usageSource: task.usage.source,
    durationText: durationTextOf(task.duration),
    durationTitle: durationTitleOf(task.duration),
    durationState: task.duration.state,
    evidenceText:
      evidence === undefined
        ? '暂无门禁证据'
        : `${evidence.command} → ${evidence.exitCode === null ? '超时或被信号终止' : `退出码 ${evidence.exitCode}`}`,
  }
}

/**
 * 子智能体主界面的纯投影。
 *
 * 所有「格式化」都走宿主下发的文本（`tokenText` / `durationText` / `formatStamp`），
 * 这里不算任何毫秒数——零格式化铁律同样适用于成员页。
 */
export function memberPageOf(source: MemberPageSource): MemberPageView {
  const { member } = source
  const role = source.role ?? null
  const roleDefinition = source.roleDefinition ?? null
  const task = source.task ?? null
  const audits = Array.isArray(source.audits) ? source.audits : []
  const messages = Array.isArray(source.messages) ? source.messages : []

  const scoped = messages.filter(
    (message) =>
      (member.taskId !== undefined && message.taskId === member.taskId) ||
      message.toMemberId === member.memberId,
  )
  const views: MemberMessageView[] = [...scoped]
    .sort((a, b) => b.at - a.at)
    .slice(0, MEMBER_MESSAGE_LIMIT)
    .map((message, index) => ({
      messageId:
        typeof message.messageId === 'string' && message.messageId !== ''
          ? message.messageId
          : `${message.at}-${index}`,
      fromText: peerLabelOf(message.from),
      toText: message.to,
      atText: formatStamp(message.at),
      body: message.body,
      foldable: ledgerBodyFoldable(message.body),
    }))

  const stalled = member.status === 'running' && member.stalled === true
  // r21：成员卡用成员专用词表（waiting = 等待写域；stopping/stopped 有中文），任务卡仍用 statusBadge。
  const badge = memberStatusBadge(member.status)
  // r21 AC-4：已确认停止的成员把确认时刻一起显示（「已停止 11-10 14:33:20」，时间戳由宿主给）。
  const stoppedSuffix =
    member.status === 'stopped' && typeof member.stoppedAt === 'number' && member.stoppedAt > 0
      ? ` ${formatStamp(member.stoppedAt)}`
      : ''
  const roleName = role?.name ?? roleDefinition?.name ?? member.roleId
  const taskText =
    task !== null
      ? `${task.id} · ${task.title}`
      : member.taskId !== undefined && member.taskId !== ''
        ? `任务 ${member.taskId}（不在当前 run 的任务表里）`
        : '未绑定任务'

  const view: MemberPageView = {
    memberId: member.memberId,
    name: member.name,
    statusText: `${badge.text}${stoppedSuffix}`,
    statusTone: badge.tone,
    roleId: member.roleId,
    roleName,
    duty: roleDefinition?.duty?.trim() ?? '',
    modelRoute: member.modelRoute?.trim() || '会话默认模型',
    lastActiveText: formatStamp(member.lastEventAt) || '无活动记录',
    stalled,
    stalledText: stalled ? `⏳ ${member.stalledSecondsText || '—'} 无实质产出` : '',
    canResume: member.canResume === true,
    resumeText: member.canResume === true ? '可从面板「继续」恢复该成员' : '不可续聊',
    taskText,
    messages: views,
    messageCount: scoped.length,
    emptyMessagesText:
      member.taskId === undefined
        ? '该成员还没有直接消息。'
        : '还没有与该成员/任务相关的直接消息。',
  }
  const statusTitle = memberStatusTitleOf(member.status)
  if (statusTitle !== undefined) view.statusTitle = statusTitle
  if (task !== null) view.task = memberTaskOf(task)
  const routeAudit = routeAuditViewOf(member, audits)
  if (routeAudit !== undefined) view.routeAudit = routeAudit
  return view
}
