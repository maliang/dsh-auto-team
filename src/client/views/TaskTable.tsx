/**
 * 任务表（r13 AC-3 / AC-4 / AC-16 / AC-17；r14 AC-11 / AC-12）。
 *
 * 为什么不是单行表格：320px 面板的内容宽只有 296px 五个字段放不进一行，硬塞会把
 * token 数字截断 —— 截断数字等于造假。所以：
 *   第一行：标题（弹性）+ 状态 badge（最坏 58px）
 *   第二行：角色 / token / 用时（tabular-nums，窄容器里靠 ellipsis 省字，**不省数字**）
 *
 * r14 的两种形态：
 *  - 默认（历史页/抽屉等宽容器）：`[data-task-head]` 表头 + 单一 `ul`；
 *  - `grouped`（右栏任务总览 220px 列表）：**去掉 sticky 表头**（220px 塞不下 r13 的
 *    `1fr 76px 84px` 网格，硬留会把 token 截断），改成两个分组 `未完成 · N` / `已完成 · N`，
 *    组头 sticky 24px。分组与进度环**同源**：都调 `taskOverviewOf`（AC-11 的同帧一致）。
 *
 * 交互：整行是一个按钮（点击展开/收起），`aria-expanded` + `aria-controls` 指向详情块；
 * 展开是内联的（DESIGN §3.2），不做抽屉 —— 抽屉会把面板里的其它任务全遮住。
 *
 * 可逆动作（重试、跳过、取消）由 T7 在详情块里挂按钮；本组件只渲染事实，不执行动作，
 * 也不做确认判断（确认闸在宿主，客户端不得自行乐观放行）。
 */
import * as React from 'react'
import type { TaskDetailView } from '../../shared/types.ts'
import type { TaskRowView } from '../viewmodel.ts'
import { TASK_TABLE_HEADER, taskDetailOf, taskOverviewOf, taskRowOf } from '../viewmodel.ts'
import { EmptyState } from './EmptyState.tsx'

export interface TaskTableProps {
  tasks: TaskDetailView[]
  expandedTaskId?: string
  onToggleTask: (taskId: string) => void
  /** r14：右栏任务总览用的分组形态（两组 + 组头，无表头）。 */
  grouped?: boolean
}

const GROUP_LABEL: Record<'open' | 'done', string> = {
  open: '未完成',
  done: '已完成',
}

function TaskRow(props: {
  row: TaskRowView
  task: TaskDetailView
  done: boolean
  onToggleTask: (taskId: string) => void
}): React.ReactElement {
  const { row, task, done, onToggleTask } = props
  const panel = row.expanded ? taskDetailOf(task) : null
  const detailId = `auto-team-task-detail-${task.id}`
  return (
    <li
      data-task-row
      // r13：行上直接给出任务 id —— 展开定位/深链不必再靠「第 n 行」推断，
      // 左栏与右栏复用同一组件时也能一眼对上是哪个任务。
      data-task-id={task.id}
      data-status={task.status}
      data-expanded={row.expanded ? 'true' : 'false'}
    >
      <button
        type="button"
        data-task-toggle
        aria-expanded={row.expanded}
        aria-controls={detailId}
        onClick={() => onToggleTask(task.id)}
      >
        <span data-task-line="title">
          {done ? (
            <span data-done-mark aria-hidden="true">
              ✓
            </span>
          ) : null}
          <span data-task-title title={row.title} data-done={done ? 'true' : 'false'}>
            {row.title}
          </span>
          <span data-badge data-tone={row.badge.tone} title={`状态：${row.badge.text}`}>
            <span aria-hidden="true">{row.badge.icon}</span> {row.badge.text}
          </span>
        </span>
        <span data-task-line="meta">
          <span data-task-role title={`角色：${row.roleName}`}>
            {row.roleName}
          </span>
          <span data-cell="token" data-usage-source={row.tokenSource} title={row.tokenTitle}>
            {row.tokenText}
          </span>
          <span data-cell="duration" data-duration-state={row.durationState} title={row.durationTitle}>
            {row.durationText}
          </span>
        </span>
      </button>
      {panel ? (
        <div id={detailId} data-task-detail>
          <dl data-task-detail-grid>
            <dt>验收</dt>
            <dd>
              <code data-detail-acceptance>{panel.acceptance}</code>
            </dd>
            <dt>依赖</dt>
            <dd data-detail-depends>{panel.dependsText}</dd>
            <dt>写域</dt>
            <dd data-detail-scope>{panel.scopeText}</dd>
            <dt>消息</dt>
            <dd data-detail-messages>{panel.messageText}</dd>
            {panel.attemptsText ? (
              <>
                <dt>尝试</dt>
                <dd data-detail-attempts>{panel.attemptsText}</dd>
              </>
            ) : null}
            {panel.waitReason ? (
              <>
                <dt>等待</dt>
                <dd data-wait-reason>{panel.waitReason}</dd>
              </>
            ) : null}
            {panel.usageReason ? (
              <>
                <dt>用量</dt>
                <dd data-detail-reason>{panel.usageReason}</dd>
              </>
            ) : null}
            {panel.durationReason ? (
              <>
                <dt>用时</dt>
                <dd data-detail-reason>{panel.durationReason}</dd>
              </>
            ) : null}
            {panel.evidence ? (
              <>
                <dt>门禁</dt>
                <dd data-gate-evidence>
                  <span data-gate-exit data-exit-ok={panel.evidence.exitOk ? 'true' : 'false'}>
                    {panel.evidence.exitText}
                  </span>
                  <code data-gate-command>{panel.evidence.command}</code>
                  {panel.evidence.tail.length > 0 ? (
                    <pre data-gate-tail>{panel.evidence.tail.join('\n')}</pre>
                  ) : null}
                  {panel.evidence.artifacts.length > 0 ? (
                    <span data-gate-artifacts>{panel.evidence.artifacts.join(' · ')}</span>
                  ) : null}
                  <span data-gate-at>{panel.evidence.atText}</span>
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </li>
  )
}

export function TaskTable(props: TaskTableProps): React.ReactElement {
  const { tasks, expandedTaskId, onToggleTask, grouped } = props
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="尚未生成计划"
        hint="告诉队长要达成的目标，计划落盘后会自动开跑"
        next="对队长说一句话即可"
      />
    )
  }

  if (grouped === true) {
    // 与进度环同一派生函数（AC-11）：环的比例与两个分组的计数不可能分叉。
    const overview = taskOverviewOf(tasks, expandedTaskId)
    const byId = new Map(tasks.map((task) => [task.id, task]))
    return (
      <div data-region="task-list" data-grouped="true">
        {(['open', 'done'] as const).map((key) => {
          const rows = overview.groups[key]
          return (
            <section key={key} data-task-group={key}>
              <div data-group-head>
                {`${GROUP_LABEL[key]} · ${rows.length}`}
              </div>
              <ul data-task-rows>
                {rows.map((row) => {
                  const task = byId.get(row.id)
                  if (task === undefined) return null
                  return <TaskRow key={row.id} row={row} task={task} done={key === 'done'} onToggleTask={onToggleTask} />
                })}
              </ul>
            </section>
          )
        })}
      </div>
    )
  }

  return (
    <div data-region="task-list">
      <div data-task-head aria-hidden="true">
        <span data-head-cell="left">{TASK_TABLE_HEADER.left}</span>
        <span data-head-cell="token">{TASK_TABLE_HEADER.token}</span>
        <span data-head-cell="duration">{TASK_TABLE_HEADER.duration}</span>
      </div>
      <ul data-task-rows>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            row={taskRowOf(task, expandedTaskId === task.id)}
            task={task}
            done={task.status === 'done'}
            onToggleTask={onToggleTask}
          />
        ))}
      </ul>
    </div>
  )
}

export default TaskTable
