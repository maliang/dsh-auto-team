/**
 * 页签共享的行视图 + 页签本地状态（r13 T7）。
 *
 * 为什么单独一个模块：**历史页与左栏用同一套行**（AC-18「右栏与左栏 deep equal」的延伸）。
 * 如果各写一份，一处改了另一处不改，就会出现「同一个 run 在历史里显示 12.3k、在左栏显示
 * 不可得」这种自相矛盾。行视图只引用 `viewmodel.ts` 的文案函数，**绝不自己拼数字**：
 * token 文本来自宿主下发的 `UsageCell`（`source==='unavailable'` 时显式「不可得」，不估算），
 * 用时文本来自宿主下发的 `DurationCell.text`（客户端没有第二套时长格式化，AC-7）。
 *
 * 页签本地状态（滚动位置、展开的任务、历史已加载条数）放模块级 Map：页签组件切换是被卸载的，
 * 放 useState 会在每次切页签时丢掉「我刚才展开的是哪个任务」。模块级 Map 让这三个小状态
 * 跨卸载存活，又不会触发额外渲染。
 */
import { durationCellOf } from '../../shared/duration.ts'
import * as React from 'react'
import type {
  DurationCell,
  MemberStatus,
  MemberView,
  ProjectRunSummaryView,
  ProjectView,
  RunSummary,
  UsageCell,
  UsageMetric,
} from '../../shared/types.ts'
import {
  durationTextOf,
  durationTitleOf,
  formatStamp,
  goalTitleOf,
  isClosedRun,
  isResidualRun,
  RESIDUAL_RUN_BADGE,
  runStageBadge,
  runStageOf,
  statusBadge,
  tokenTextOf,
  tokenTitleOf,
  usageMetricsOf,
} from '../viewmodel.ts'
import type { Badge, BadgeTone } from '../viewmodel.ts'

/* ───────────────────────────── 行视图 ───────────────────────────── */

export interface RunRowView {
  runId: string
  /** 主标题：run 级 goal（截断 24 字）。r17 起历史行与项目 run 行同口径，都是「任务名」。 */
  title: string
  /**
   * r14 AC-15：标题来源。`goal` = 真的记录了目标；`fallback` = 旧 run / 无目标，
   * 界面据此打 `data-title-source="fallback"`（诚实标注，不是假装有目标）。
   */
  titleSource: 'goal' | 'fallback'
  /** `title` 属性用的完整文本（标题被截断时仍能悬停看全）。 */
  titleTitle?: string
  /** 次行：开始 / 结束时间戳与任务数。 */
  metaText: string
  statusText: string
  statusTone: BadgeTone
  statusIcon: string
  /** r26：阶段 detail（人话解释），渲染为徽标 title；缺席时只显示 `状态：…`。 */
  statusTitle?: string
  tokenText: string
  tokenTitle: string
  tokenSource: 'provider' | 'unavailable'
  /** r17：宿主给好的六项指标（顺序固定）；空数组 = 旧数据，只显示合计，不自己拆。 */
  usageMetrics: UsageMetric[]
  durationText: string
  durationTitle: string
  durationState: DurationCell['state']
  active: boolean
  /** r21：宿主记录的终止原因（旧 run 没有 → 缺席，行内不渲染、不占位）。 */
  terminationText?: string
  /**
   * r24：残留计划徽标（warn）。存在 = 这一行是「未收口、可能残留」的 run，
   * 调用方要同时给出「终止计划」入口；缺席 = 不渲染徽标、不占位。
   */
  residualBadge?: Badge
}

function rowOf(input: {
  runId: string
  title: string
  titleSource?: 'goal' | 'fallback'
  titleTitle?: string
  metaText: string
  status: string
  /** r18b t7：计划行传 `runStageBadge()`；不传则沿用任务/成员态映射（既有调用方零变化）。 */
  badge?: Badge
  /** r26：阶段 detail（徽标悬停解释）；由 `runSummaryRowOf` / `projectRunRowOf` 传入。 */
  statusTitle?: string
  usage: UsageCell
  duration: DurationCell
  /** r20：标题可覆盖（历史行「算不出用时」要给具体原因，通用文案在这几种情况下不准）。 */
  durationTitle?: string
  active: boolean
  /** r21：宿主下发的终止原因（已 `trim`，空串视同缺席）。 */
  terminationText?: string
  /**
   * r24 / 用户 2026-11-13：残留计划徽标；由 `runSummaryRowOf` 按宿主事实判定后传入
   * （投影本身不判定）。判定要求「确认没有存活成员」，有存活成员或读不到存活数都不出徽标。
   */
  residualBadge?: Badge
}): RunRowView {
  const badge = input.badge ?? statusBadge(input.status)
  const view: RunRowView = {
    runId: input.runId,
    title: input.title,
    titleSource: input.titleSource ?? 'fallback',
    metaText: input.metaText,
    statusText: badge.text,
    statusTone: badge.tone,
    statusIcon: badge.icon,
    tokenText: tokenTextOf(input.usage),
    tokenTitle: tokenTitleOf(input.usage),
    tokenSource: input.usage.source,
    usageMetrics: usageMetricsOf(input.usage),
    durationText: durationTextOf(input.duration),
    durationTitle: input.durationTitle ?? durationTitleOf(input.duration),
    durationState: input.duration.state,
    active: input.active,
  }
  if (input.titleTitle !== undefined) view.titleTitle = input.titleTitle
  if (input.statusTitle !== undefined) view.statusTitle = input.statusTitle
  // r21：终止原因只透传宿主字段（历史 / 当前 run 同口径），空串不落成占位。
  if (input.terminationText !== undefined && input.terminationText.trim() !== '') {
    view.terminationText = input.terminationText.trim()
  }
  // r24：残留徽标只透传判定结果；未残留的 run 保持字段缺席（行内不占位）。
  if (input.residualBadge !== undefined) view.residualBadge = input.residualBadge
  return view
}

/**
 * 历史行的用量单元格：宿主派生的 `usage` 优先（含 `text` + 六项 `details`）；
 * 旧快照只有 `usageTotals` 时退回合计，**不**在客户端拆六项（六项文案的单一来源是宿主）。
 */
function summaryUsageOf(run: RunSummary): UsageCell {
  if (run.usage !== undefined) return run.usage
  if (run.usageTotals !== undefined && typeof run.usageTotals.total === 'number') {
    return { source: 'provider', tokens: run.usageTotals }
  }
  return { source: 'unavailable', reason: '该次运行没有用量记录' }
}

/**
 * 历史列表行的用时（r20）。
 *
 * 这里**没有**宿主下发的 `DurationCell`：`RunSummary`（`shared/types.ts:667`）只有
 * `plannedAt`/`finishedAt`，宿主 `bridge.historyOf` 也只额外派生了 `usage`。
 * 但 r20 t1 已经把 `finishedAt` 补成可核实值（终态落盘优先，历史 run 用
 * `store.finishedAtOf` 回退），所以列表行可以用**宿主给的时间戳 + shared/duration.ts
 * 的唯一实现**算出同一个单元格 —— 不是第二套格式化，也没有 0 或估算补位：
 *  - 没有 `plannedAt`（旧 run）→ 不可得；
 *  - 终态（cancelled/terminated）但没有 `finishedAt` → 不可得（不算到「现在」）；
 *  - 有 `finishedAt` → done；否则 running（按 `now` 计时）。
 *
 * 策略与宿主 `library.durationOfSummary` 逐条对齐（同一份判定，避免两端口径漂移）。
 */
function historyDurationOf(run: RunSummary, now: number): DurationCell {
  if (run.plannedAt === undefined) return durationCellOf({ state: 'unavailable', now })
  const ended = run.finishedAt !== undefined
  const terminal = run.status === 'cancelled' || run.status === 'terminated'
  if (!ended && terminal) return durationCellOf({ startAt: run.plannedAt, state: 'unavailable', now })
  return durationCellOf({
    startAt: run.plannedAt,
    ...(ended ? { endAt: run.finishedAt } : {}),
    state: ended ? 'done' : 'running',
    now,
  })
}

/** 历史行「算不出用时」的具体原因（`durationTitleOf` 的通用文案在这几种情况下不够准）。 */
function historyDurationTitleOf(cell: DurationCell, run: RunSummary): string {
  if (cell.state !== 'unavailable') return durationTitleOf(cell)
  if (run.plannedAt === undefined) return '该次运行没有记录开始时刻（旧数据），算不出用时'
  if (run.finishedAt === undefined) return '该次运行没有结束时刻（宿主未落盘），算不出用时'
  return durationTitleOf(cell)
}

/**
 * 快照兜底：宿主没下发 `liveMembers` 时，按成员列表数「还有可能在跑」的成员。
 *
 * `MemberView.status` 是面板态（由任务状态派生），**不是**宿主 4 态，所以这里只认
 * 含「工作还在进行中」的态（含等写域、派发前、停止中）；`done` / `failed` /
 * `interrupted` / `cancelled` / `stopped` 一律不算 —— 它们不含「此刻有人在跑」的证据，
 * 把 `done` 算成存活还会让「任务全完成、进程已退」的旧残留永远显示不出来。
 *
 * 传 `undefined`（快照还没到 / 旧载荷不带 members）→ 返回 `undefined`（无法确认），
 * 调用方据此不提示；**不补 0**。
 */
const LIVE_MEMBER_STATUSES: readonly MemberStatus[] = [
  'running',
  'idle',
  'blocked',
  'rework',
  'waiting',
  'stopping',
]

export function liveMembersOfSnapshot(members: readonly MemberView[] | undefined): number | undefined {
  if (members === undefined) return undefined
  return members.filter((member) => LIVE_MEMBER_STATUSES.includes(member.status)).length
}

/**
 * 历史列表行（右栏「历史」页）—— 数据来自 `snapshot.runs` / `library.runs`（`RunSummary`）。
 *
 * r17：顶部是「任务名」（run 级 goal；缺省走 `goalTitleOf` 的诚实 fallback），
 * 底部是 token 六项（`RunSummary.usage.details`，宿主 `format.ts` 单一来源，客户端只透传）。
 * 旧数据没有 `usage` 时退回 `usageTotals`：只显示合计，不自己拆六项。
 * r20：次行补上用时（`historyDurationOf`，宿主时间戳 + shared 唯一实现；缺值即不可得）。
 *
 * `members` 只在**该 run 就是快照当前 run** 时传入：快照的成员列表不区分 run，
 * 拿别的 run 的成员兜底会把存活数算错。宿主字段 `liveMembers` 优先，快照只是兜底。
 */
export function runSummaryRowOf(
  run: RunSummary,
  now: number = Date.now(),
  members?: readonly MemberView[],
): RunRowView {
  const goal = goalTitleOf(run.goal, run.runId)
  const start = formatStamp(run.plannedAt ?? run.createdAt)
  // r25：终态 run 即使旧宿主还下发 active=true/ongoing>0，也不能显示成「进行中」。
  const live = run.active === true && !isClosedRun(run)
  const end = live ? '进行中' : formatStamp(run.finishedAt)
  const duration = historyDurationOf(run, now)
  // r26：历史行 / 顶部 run 卡共用同一个阶段判定（计数由宿主补齐，旧数据缺省时保持 undefined）。
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
  // 用户 2026-11-13：残留判定再收一道 —— 宿主存活成员数优先，宿主没给（旧快照 /
  // 读失败）才用该 run 的成员快照兜底；两路都拿不到就是「无法确认」，不提示。
  const liveMembers = run.liveMembers ?? liveMembersOfSnapshot(members)
  return rowOf({
    runId: run.runId,
    title: goal.text,
    titleSource: goal.source,
    titleTitle: goal.title,
    metaText: `开始 ${start} · 结束 ${end} · 任务 ${run.done}/${run.tasks}`,
    status: run.status,
    badge: runStageBadge(stage),
    ...(stage.detail !== undefined ? { statusTitle: stage.detail } : {}),
    usage: summaryUsageOf(run),
    duration,
    durationTitle: historyDurationTitleOf(duration, run),
    active: live,
    ...(run.terminationReason !== undefined ? { terminationText: run.terminationReason } : {}),
    // r24：三种未收口计划态、没有结束时刻，且确认没有存活成员 → 历史行/顶部 run 卡都
    // 可见「可能残留」并给终止入口。有存活成员或读不到存活数时不显示（不制造噪音）。
    ...(isResidualRun({ status: run.status, finishedAt: run.finishedAt, liveMembers })
      ? { residualBadge: RESIDUAL_RUN_BADGE }
      : {}),
  })
}

/** 项目库里的「最近 run」行（左栏）—— 数据来自 `ProjectRunSummaryView`，用量/用时都是宿主算好的单元格。 */
export function projectRunRowOf(run: ProjectRunSummaryView): RunRowView {
  const start = formatStamp(run.plannedAt)
  const end = formatStamp(run.finishedAt)
  // r14 AC-15：标题 = run 级 goal（24 字截断在 goalTitleOf 单点做，组件不再截）。
  const goal = goalTitleOf(run.goal, run.runId)
  // r26：项目页行没有计数（`ProjectRunSummaryView` 不带 running/failed/members），
  // 只按已知的 total/done 判定；缺计数时规则 5/6/7/10 不命中，保守落到待派发/派发中/待收口，
  // 绝不拿 0 补猜。
  const stage = runStageOf({
    planStatus: run.planStatus,
    total: run.tasks,
    done: run.done,
    ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
  })
  return rowOf({
    runId: run.runId,
    title: goal.text,
    titleSource: goal.source,
    titleTitle: goal.title,
    metaText: `开始 ${start} · 结束 ${end} · 任务 ${run.done}/${run.tasks}`,
    status: run.planStatus,
    badge: runStageBadge(stage),
    ...(stage.detail !== undefined ? { statusTitle: stage.detail } : {}),
    usage: run.usage,
    duration: run.duration,
    active: false,
  })
}

export interface ProjectNavView {
  id: string
  name: string
  path?: string
  metaText: string
  tokenText: string
  tokenTitle: string
  active: boolean
  unknown: boolean
}

/** 左栏项目导航行；`usage` 是宿主算好的 `UsageCell`（项目总量）。 */
export function projectNavOf(project: ProjectView, active: boolean): ProjectNavView {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    metaText: `${project.runs} 次运行 · ${project.lastActiveAt !== undefined ? formatStamp(project.lastActiveAt) : '无记录'}`,
    tokenText: tokenTextOf(project.usage),
    tokenTitle: tokenTitleOf(project.usage),
    active,
    unknown: project.unknown === true,
  }
}

/* ───────────────────────────── 页签本地状态 ───────────────────────────── */

export interface TabMemory {
  scrollTop: number
  expandedTaskId?: string
  /** 历史页「已加载条数」：首屏 50，每次 +50（PRD §11）。 */
  historyLimit: number
}

const tabMemory = new Map<string, TabMemory>()

export function tabMemoryOf(key: string): TabMemory {
  const existing = tabMemory.get(key)
  if (existing !== undefined) return existing
  const created: TabMemory = { scrollTop: 0, historyLimit: 0 }
  tabMemory.set(key, created)
  return created
}

/** 测试用：清空页签本地状态（模块级 Map 会跨用例存活）。 */
export function resetTabMemory(): void {
  tabMemory.clear()
}

/** 滚动位置跨页签切换保持（页签组件会被卸载，useState 存不住）。 */
export function useTabScroll(key: string): {
  ref: React.RefObject<HTMLDivElement>
  onScroll: () => void
} {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const node = ref.current
    if (node !== null) node.scrollTop = tabMemoryOf(key).scrollTop
  }, [key])
  const onScroll = React.useCallback(() => {
    const node = ref.current
    if (node !== null) tabMemoryOf(key).scrollTop = node.scrollTop
  }, [key])
  return { ref, onScroll }
}

/**
 * 展开的任务 id（跨页签切换保持；同一时刻只展开一行，避免 320px 面板被详情挤爆）。
 *
 * 返回三元组：`[当前展开的 id, 切换（同一 id 再点收起）, 强制展开（流转图点节点用）]`。
 * 分开是因为「点节点」的语义是定位到该任务，不该因为目标已展开又把它收起来。
 */
export function useExpandedTask(
  key: string,
): [string | undefined, (taskId: string) => void, (taskId: string) => void] {
  const [expanded, setExpanded] = React.useState<string | undefined>(() => tabMemoryOf(key).expandedTaskId)
  const toggle = React.useCallback(
    (taskId: string) => {
      setExpanded((current) => {
        const next = current === taskId ? undefined : taskId
        tabMemoryOf(key).expandedTaskId = next
        return next
      })
    },
    [key],
  )
  const expand = React.useCallback(
    (taskId: string) => {
      tabMemoryOf(key).expandedTaskId = taskId
      setExpanded(taskId)
    },
    [key],
  )
  return [expanded, toggle, expand]
}

/**
 * 点流转节点 → 展开对应任务并滚到它。
 *
 * 为什么用序号定位而不是 `[data-task-id]`：`TaskTable`（T6 产物，只读）的行上没有 id 属性，
 * 但行顺序与 `tasks` 数组严格一致（同一个 `map`）。序号定位是这里唯一不越界改别人文件的解法；
 * 若 T6 以后给行加了 `data-task-id`，这里应换成属性选择器（见 [OUT-OF-SCOPE]）。
 */
export function scrollToTaskRow(taskId: string, taskIds: readonly string[]): void {
  if (typeof document === 'undefined') return
  const index = taskIds.indexOf(taskId)
  if (index < 0) return
  const rows = document.querySelectorAll('[data-region="task-list"] [data-task-row]')
  const node = rows[index]
  if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' })
}
