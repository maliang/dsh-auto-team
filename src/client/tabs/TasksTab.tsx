/**
 * 「任务」页（r14 AC-4 / AC-7 / AC-10 / AC-11；r17 加 run 切换与成员导航）。
 *
 * 组成（DESIGN §1 的自上而下顺序）：
 *   `RunSwitcher`（进行中 run 的行列表；没有进行中的 run 时显示最后一条，r18b t2）
 *   → `RunHeader`（run 头：计划状态、开始时间、合计 token/用时、暂停）
 *   → `RoleGrid`（角色卡片 2 列：状态/当前任务/用量/用时，点卡片打开子智能体）
 *   → `TaskOverview`（左进度环 + 右「未完成/已完成」分组列表，任务行可打开子智能体）
 *   → `FlowCanvas`（可平移流转画布，点节点打开执行该节点的子智能体）
 *
 * 为什么没有「派发」按钮（AC-11）：计划落盘后由宿主自动派发，界面上**不允许**出现一个
 * 「点了也常常失败」的派发按钮。用户能做的只有暂停/继续与任务级可逆动作。
 *
 * 数据全部来自 `buildRunDetail({snapshot})` —— 与左栏历史详情共用同一个装配函数（AC-18），
 * 所以两处的任务表不可能出现不同的 token/用时。历史 run 走显式的 `runDetail` 分支，
 * 且**不提供成员导航**（历史快照没有成员/消息，导过去只会是空页）。
 */
import * as React from 'react'
import type { MemberView, PlanStatus, PanelSnapshot } from '../../shared/types.ts'
import type { TabProps } from '../Panel.tsx'
import { buildRunDetail, planGoalOf, stageOfDetail } from '../viewmodel.ts'
import type { InflightState, RunStageView } from '../viewmodel.ts'
import { activeRunRowsOf, memberForRole, navigateToMember, tasksEmptyStateOf } from '../nav.ts'
import { RunHeader } from '../views/RunHeader.tsx'
import { RunSwitcher } from '../views/RunSwitcher.tsx'
import { RunCloseAction } from '../views/RunCloseAction.tsx'
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
  // 历史 run 只有宿主下发的详情，没有 members/messages —— 成员导航必须关掉。
  const historicalRunId =
    props.detailRunId !== null && props.detailRunId !== snapshot?.runId ? props.detailRunId : null
  const detail = React.useMemo(
    () =>
      historicalRunId === null
        ? buildRunDetail({ snapshot: snapshot ?? null })
        : buildRunDetail(
            { snapshot: snapshot ?? null, runDetail: props.detail ?? undefined },
            historicalRunId,
          ),
    [snapshot, props.detail, historicalRunId],
  )
  const inflight = useInflight(snapshot)
  // r26：run 头的阶段与卡片/历史行同源。当前 run 优先用宿主下发的 `runCounts`
  // （t1 已补齐），缺省时从真实任务/成员列表派生；历史 run 无成员信息，members 保持 undefined。
  const stage = React.useMemo<RunStageView | undefined>(() => {
    if (detail === null) return undefined
    const current = historicalRunId === null && snapshot !== undefined
    const counts = current && snapshot.runCounts !== undefined ? snapshot.runCounts : {}
    // 快照里的 members 已是宿主过滤掉 retired 绑定后的列表（见 bridge 的计数口径），
    // 这里不再按状态二次过滤 —— 否则「已完成但绑定还在」的成员会被漏算成 0。
    const memberCount = current ? (snapshot.members ?? []).length : undefined
    return stageOfDetail(detail, memberCount === undefined ? counts : { ...counts, members: memberCount })
  }, [detail, historicalRunId, snapshot])
  // r21：目标与修订史只存在于**当前 run** 的快照上（历史 run 的 RunDetailView 没有 goal/revisions）。
  // 历史视图整块不传，run 头不占位。
  const planGoal = React.useMemo(() => {
    if (historicalRunId !== null || snapshot === undefined || detail === null) return null
    if (detail.runId !== snapshot.runId) return null
    return planGoalOf(snapshot.goal, snapshot.revisions, snapshot.runId)
  }, [historicalRunId, snapshot, detail])
  // 历史详情读取中（D3）：失败后 libraryError 非空，此时既不是 loading，也不能禁用 run 行，
  // 否则用户会被困在「读不到」的页面里连当前 run 都点不回去。
  const detailLoading =
    historicalRunId !== null && detail === null && props.libraryError === null
  // r18b t2：顶部只放「进行中的 run」行（没有则一条最后 run 的兜底行），
  // 展示字段与历史列表同一套投影（`runSummaryRowOf`），不再有切换器/返回按钮。
  const runRows = React.useMemo(
    () => activeRunRowsOf({ snapshot, selectedRunId: historicalRunId }),
    [snapshot, historicalRunId],
  )
  const taskIds = React.useMemo(
    () => (detail === null ? [] : detail.tasks.map((task) => task.id)),
    [detail],
  )
  const members = historicalRunId === null && snapshot !== undefined ? snapshot.members : []

  const openMember = (member: MemberView, taskId?: string): void => {
    navigateToMember(props.sessionId, member.memberId, taskId)
  }

  const selectRun = (runId: string): void => {
    if (runId === '') return
    if (runId === snapshot?.runId) {
      if (props.detailRunId !== null) props.closeRun()
      return
    }
    if (runId === historicalRunId) return
    void props.openRun(runId)
  }

  const runRowsBar =
    runRows === null ? null : (
      // r24：残留计划的卡下方注入「终止计划」（二次确认 + 失败原因都在 RunCloseAction 里）；
      // 普通卡不传额外节点，结构与 r18 完全一致。
      <RunSwitcher
        view={runRows}
        onSelect={selectRun}
        busy={detailLoading}
        residualAction={(row) =>
          row.residualBadge === undefined ? null : (
            <RunCloseAction
              runId={row.runId}
              badge={row.residualBadge}
              act={props.act}
              variant="card"
            />
          )
        }
      />
    )

  if (detail === null) {
    const empty = tasksEmptyStateOf({
      historicalRunId,
      libraryError: props.libraryError,
    })
    return (
      <div data-region="tasks-tab" data-tab-scroll="tasks" ref={scroll.ref} onScroll={scroll.onScroll}>
        {runRowsBar}
        <EmptyState title={empty.title} hint={empty.hint} next={empty.next} />
      </div>
    )
  }

  return (
    <div data-region="tasks-tab" data-tab-scroll="tasks" ref={scroll.ref} onScroll={scroll.onScroll}>
      {runRowsBar}
      <RunHeader
        detail={detail}
        paused={props.paused}
        inflight={inflight}
        onTogglePause={props.onTogglePause}
        plan={planGoal}
        stage={stage}
      />
      <RoleGrid roles={detail.roles} members={members} onOpenMember={openMember} />
      <TaskOverview
        tasks={detail.tasks}
        expandedTaskId={expanded}
        onToggleTask={(taskId) => toggleTask(taskId)}
        members={members}
        onOpenMember={openMember}
      />
      <FlowCanvas
        flow={detail.flow}
        members={members}
        onOpenMember={openMember}
        onSelectTask={(taskId) => {
          // 当前 run 里节点一定绑着角色 → 优先打开成员；找不到成员时退回「展开并滚到任务行」。
          const task = detail.tasks.find((item) => item.id === taskId)
          const member = task === undefined ? undefined : memberForRole(members, task.roleId, task.id)
          if (member !== undefined) {
            openMember(member, taskId)
            return
          }
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
