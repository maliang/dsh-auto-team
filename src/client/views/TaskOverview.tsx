/**
 * 任务总览（r14 AC-10 / AC-11）：左边进度环、右边分组任务列表。
 *
 * 为什么把「环 + 列表」绑成一件：AC-11 要求改一个任务状态后，环与两组计数在**同一帧**
 * 一起更新。如果环和列表各自派生，就可能一帧里环已经是 3/5、列表还是「未完成 · 3」。
 * 本组件先调一次 `taskOverviewOf`（环的 done/total/ratio/dashOffset 与两组行视图），
 * 再把 `tasks` 交给 `TaskTable grouped` —— 后者用的是同一个纯函数，输入相同结果必然相同。
 *
 * 布局（DESIGN §2.3）：`[环 64px][gap 12][列表 220px]`，环列 sticky 顶部（滚列表时环不动）。
 * 列表列必须 `min-width: 0`，否则 220px 的列会被内容撑破（grid 的默认 min-width:auto）。
 *
 * r18b：环与列表都按**全量**任务算（`groups.open` 含所有非 done 状态，
 * `groups.done` 含所有 done），r18 的「只列进行中 / 只留最近完成一个」已按用户要求回滚。
 * 组件不二次筛选；空组由 TaskTable 的 grouped 分支隐藏。
 */
import * as React from 'react'
import type { MemberView, TaskDetailView } from '../../shared/types.ts'
import { PROGRESS_RING_SIZE, taskOverviewOf } from '../viewmodel.ts'
import { ProgressRing } from './ProgressRing.tsx'
import { TaskTable } from './TaskTable.tsx'

export interface TaskOverviewProps {
  tasks: TaskDetailView[]
  expandedTaskId?: string
  onToggleTask: (taskId: string) => void
  /** r17：任务行 → 子智能体（历史 run 不传）。 */
  members?: MemberView[]
  onOpenMember?: (member: MemberView, taskId: string) => void
}

export function TaskOverview(props: TaskOverviewProps): React.ReactElement {
  const { tasks, expandedTaskId, onToggleTask, members, onOpenMember } = props
  const overview = taskOverviewOf(tasks, expandedTaskId)
  return (
    <section data-task-overview aria-label="任务总览">
      <div data-overview-ring>
        <ProgressRing
          done={overview.done}
          total={overview.total}
          size={PROGRESS_RING_SIZE}
          dashOffset={overview.dashOffset}
        />
      </div>
      <div data-overview-list>
        <TaskTable
          tasks={tasks}
          expandedTaskId={expandedTaskId}
          onToggleTask={onToggleTask}
          members={members}
          onOpenMember={onOpenMember}
          grouped
        />
      </div>
    </section>
  )
}

export default TaskOverview
