/**
 * 「任务」页（r14 AC-4 / AC-7 / AC-10 / AC-11）。
 *
 * 组成（DESIGN §1 的自上而下顺序）：
 *   `RunHeader`（run 头：计划状态、开始时间、合计 token/用时、暂停）
 *   → `RoleGrid`（角色卡片 2 列：状态/当前任务/用量/用时）
 *   → `TaskOverview`（左进度环 + 右「未完成/已完成」分组列表）
 *   → `FlowCanvas`（可平移流转画布，点节点定位任务行）
 *
 * 为什么没有「派发」按钮（AC-11）：计划落盘后由宿主自动派发，界面上**不允许**出现一个
 * 「点了也常常失败」的派发按钮。用户能做的只有暂停/继续与任务级可逆动作。
 *
 * 数据全部来自 `buildRunDetail({snapshot})` —— 与左栏历史详情共用同一个装配函数（AC-18），
 * 所以两处的任务表不可能出现不同的 token/用时。
 */
import * as React from 'react'
import type { PlanStatus, PanelSnapshot } from '../../shared/types.ts'
import type { TabProps } from '../Panel.tsx'
import { buildRunDetail } from '../viewmodel.ts'
import type { InflightState } from '../viewmodel.ts'
import { RunHeader } from '../views/RunHeader.tsx'
import { RoleGrid } from '../views/RoleCard.tsx'
import { TaskOverview } from '../views/TaskOverview.tsx'
import { FlowCanvas } from '../views/FlowCanvas.tsx'
import { EmptyState } from '../views/EmptyState.tsx'
import { scrollToTaskRow, useExpandedTask, useTabScroll } from './rows.ts'

/** 派发在途指示：`dispatching` 由快照状态给出，`dispatched` 是离开派发态后的 3 秒成功提示。 */
const DISPATCHED_FLASH_MS = 3_000

function useInflight(snapshot: PanelSnapshot | undefined): InflightState {
  const [flashed, setFlashed] = React.useState(false)
  const previous = React.useRef<PlanStatus | undefined>(undefined)
  const status = snapshot?.planStatus
  const absent = snapshot === undefined

  React.useEffect(() => {
    const before = previous.current
    previous.current = status
    if (before !== 'dispatching' || status === 'dispatching' || absent) return undefined
    setFlashed(true)
    const timer = setTimeout(() => setFlashed(false), DISPATCHED_FLASH_MS)
    return () => clearTimeout(timer)
  }, [status, absent])

  if (status === 'dispatching') return 'dispatching'
  return flashed ? 'dispatched' : 'idle'
}

export function TasksTab(props: TabProps): React.ReactElement {
  const scroll = useTabScroll('tasks')
  const [expanded, toggleTask, expandTask] = useExpandedTask('tasks')
  const snapshot = props.snapshot
  const detail = React.useMemo(() => buildRunDetail({ snapshot: snapshot ?? null }), [snapshot])
  const inflight = useInflight(snapshot)
  const taskIds = React.useMemo(() => (detail === null ? [] : detail.tasks.map((task) => task.id)), [detail])

  if (detail === null) {
    return (
      <div data-region="tasks-tab" data-tab-scroll="tasks" ref={scroll.ref} onScroll={scroll.onScroll}>
        <EmptyState
          title="尚未生成计划"
          hint="告诉队长要达成的目标，计划落盘后会自动开跑"
          next="对队长说一句话即可"
        />
      </div>
    )
  }

  return (
    <div data-region="tasks-tab" data-tab-scroll="tasks" ref={scroll.ref} onScroll={scroll.onScroll}>
      <RunHeader detail={detail} paused={props.paused} inflight={inflight} onTogglePause={props.onTogglePause} />
      <RoleGrid roles={detail.roles} />
      <TaskOverview
        tasks={detail.tasks}
        expandedTaskId={expanded}
        onToggleTask={(taskId) => toggleTask(taskId)}
      />
      <FlowCanvas
        flow={detail.flow}
        onSelectTask={(taskId) => {
          // 点节点 = 展开该任务并滚到它（DESIGN §4）；先展开再滚，否则行高还没变。
          expandTask(taskId)
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => scrollToTaskRow(taskId, taskIds))
          } else {
            scrollToTaskRow(taskId, taskIds)
          }
        }}
      />
    </div>
  )
}

export default TasksTab
