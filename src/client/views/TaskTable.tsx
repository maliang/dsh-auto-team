/**
 * 任务表（r13 AC-3 / AC-4 / AC-16 / AC-17）：两行式任务行 + 展开详情。
 *
 * 为什么不是单行表格：320px 面板的内容宽只有 296px，五个字段放不进一行，硬塞会把
 * token 数字截断 —— 截断数字等于造假。所以：
 *   第一行：标题（弹性）+ 状态 badge（最坏 58px）
 *   第二行：`minmax(0,1fr) 76px 84px` —— 角色 / token / 用时，与表头同一套网格
 * 76px 按 `999,999,999` 的 tabular-nums 实测（约 67px）核算，84px 按 `999 小时 59 分` 核算。
 *
 * 交互：整行是一个按钮（点击展开/收起），`aria-expanded` + `aria-controls` 指向详情块；
 * 展开是内联的（DESIGN §3.2），不做抽屉 —— 抽屉会把面板里的其它任务全遮住。
 *
 * 可逆动作（重试、跳过、取消）由 T7 在详情块里挂按钮；本组件只渲染事实，不执行动作，
 * 也不做确认判断（确认闸在宿主，客户端不得自行乐观放行）。
 */
import * as React from 'react'
import type { TaskDetailView } from '../../shared/types.ts'
import { TASK_TABLE_HEADER, taskDetailOf, taskRowOf } from '../viewmodel.ts'
import { EmptyState } from './EmptyState.tsx'

export interface TaskTableProps {
  tasks: TaskDetailView[]
  expandedTaskId?: string
  onToggleTask: (taskId: string) => void
}

export function TaskTable(props: TaskTableProps): React.ReactElement {
  const { tasks, expandedTaskId, onToggleTask } = props
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="尚未生成计划"
        hint="告诉队长要达成的目标，计划落盘后会自动开跑"
        next="对队长说一句话即可"
      />
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
        {tasks.map((task) => {
          const row = taskRowOf(task, expandedTaskId === task.id)
          const panel = row.expanded ? taskDetailOf(task) : null
          const detailId = `auto-team-task-detail-${task.id}`
          return (
            <li
              key={task.id}
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
                  <span data-task-title title={row.title}>
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
        })}
      </ul>
    </div>
  )
}

export default TaskTable
