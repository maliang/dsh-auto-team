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
import * as React from 'react'
import type { DurationCell, ProjectRunSummaryView, ProjectView, RunSummary, UsageCell } from '../../shared/types.ts'
import {
  durationTextOf,
  durationTitleOf,
  formatStamp,
  goalTitleOf,
  statusBadge,
  tokenTextOf,
  tokenTitleOf,
} from '../viewmodel.ts'
import type { BadgeTone } from '../viewmodel.ts'

/* ───────────────────────────── 行视图 ───────────────────────────── */

export interface RunRowView {
  runId: string
  /** 主标题：项目库 run 行 = run 级 goal（截断 24 字），历史行 = 项目名/runId。 */
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
  tokenText: string
  tokenTitle: string
  tokenSource: 'provider' | 'unavailable'
  durationText: string
  durationTitle: string
  durationState: DurationCell['state']
  active: boolean
}

function rowOf(input: {
  runId: string
  title: string
  titleSource?: 'goal' | 'fallback'
  titleTitle?: string
  metaText: string
  status: string
  usage: UsageCell
  duration: DurationCell
  active: boolean
}): RunRowView {
  const badge = statusBadge(input.status)
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
    durationText: durationTextOf(input.duration),
    durationTitle: durationTitleOf(input.duration),
    durationState: input.duration.state,
    active: input.active,
  }
  if (input.titleTitle !== undefined) view.titleTitle = input.titleTitle
  return view
}

/** 无 DurationCell 时的降级：只给时间戳，**不给时长**（客户端没有第二套时长格式化）。 */
const NO_DURATION: DurationCell = { text: '—', state: 'unavailable' }

/**
 * 历史列表行（右栏「历史」页）—— 数据来自 `snapshot.runs` / `library.runs`（`RunSummary`）。
 *
 * `RunSummary` 只有 `usageTotals`（没有用法单元格），所以这里把总量包成 `UsageCell`；
 * 文本仍由 `tokenTextOf` 生成，不存在第二套格式化。用时则退化为时间戳（同上）。
 */
export function runSummaryRowOf(run: RunSummary, now: number = Date.now()): RunRowView {
  const usage: UsageCell =
    run.usageTotals !== undefined && typeof run.usageTotals.total === 'number'
      ? { source: 'provider', tokens: run.usageTotals }
      : { source: 'unavailable', reason: '该次运行没有用量记录' }
  const start = formatStamp(run.plannedAt ?? run.createdAt)
  const end = run.active === true ? '进行中' : formatStamp(run.finishedAt)
  return rowOf({
    runId: run.runId,
    title: run.project !== undefined && run.project !== '' ? run.project : run.runId,
    metaText: `开始 ${start} · 结束 ${end} · 任务 ${run.done}/${run.tasks}`,
    status: run.status,
    usage,
    duration: NO_DURATION,
    active: run.active === true,
  })
}

/** 项目库里的「最近 run」行（左栏）—— 数据来自 `ProjectRunSummaryView`，用量/用时都是宿主算好的单元格。 */
export function projectRunRowOf(run: ProjectRunSummaryView): RunRowView {
  const start = formatStamp(run.plannedAt)
  const end = formatStamp(run.finishedAt)
  // r14 AC-15：标题 = run 级 goal（24 字截断在 goalTitleOf 单点做，组件不再截）。
  const goal = goalTitleOf(run.goal, run.runId)
  return rowOf({
    runId: run.runId,
    title: goal.text,
    titleSource: goal.source,
    titleTitle: goal.title,
    metaText: `开始 ${start} · 结束 ${end} · 任务 ${run.done}/${run.tasks}`,
    status: run.planStatus,
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
