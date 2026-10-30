/**
 * 计划页：任务 / 依赖 / 角色（可替换）/ 判定口径 / 预计并发；「开始派发」是唯一的成员创建入口（AC-30）。
 *
 * 三个可核验点都在这里：
 *  - **计划时间戳**：派发前就在，给 AC-30「计划条目早于首个成员创建」留证据；
 *  - **并发三元组**：运行中 / 上限 / 来源（host 或默认），让用户知道并发是宿主给的还是兜底值；
 *  - **角色下拉**：派发前逐任务替换角色（AC-14），一旦任务开跑就禁用（改也改不动）。
 */
import * as React from 'react'
import type { TabProps } from '../Panel.tsx'
import type { PlanTask } from '../../shared/types.ts'
import { actFeedback, formatStamp, hintOf, statusBadge, viewExtras } from '../viewmodel.ts'

/** 任务未开跑时才允许换角色（AC-14 的窗口期）。 */
function roleEditable(task: PlanTask): boolean {
  return task.status === 'pending' || task.status === 'blocked' || task.status === 'ready'
}

export function PlanTab(props: TabProps): React.ReactElement {
  const { snapshot, act } = props
  const [busy, setBusy] = React.useState(false)
  const [hint, setHint] = React.useState<string | undefined>(undefined)

  const runId = snapshot?.runId
  const tasks = snapshot?.tasks ?? []
  const roles = snapshot?.roles ?? []
  const extras = viewExtras(snapshot)

  async function dispatch(): Promise<void> {
    setBusy(true)
    setHint(undefined)
    // runId 带上：host 据此拒绝「没有计划就派发」以及重复派发（AC-30）
    const feedback = await actFeedback(act, { type: 'dispatch', runId })
    setBusy(false)
    setHint(hintOf(feedback))
  }

  async function cancel(): Promise<void> {
    setBusy(true)
    setHint(undefined)
    const feedback = await actFeedback(act, { type: 'cancel' })
    setBusy(false)
    setHint(hintOf(feedback))
  }

  async function changeRole(taskId: string, roleId: string): Promise<void> {
    const feedback = await actFeedback(act, { type: 'setTaskRole', taskId, roleId })
    setHint(hintOf(feedback))
  }

  if (runId === undefined || runId === '') {
    return (
      <div data-auto-team-plan data-empty>
        <p>还没有执行计划。</p>
        <p data-empty-next>
          下一步：让队长在当前会话里说清目标，它会用 <code>auto_team_plan</code> 拆出任务图 ——
          计划会先出现在这里，**此时不会创建任何成员**，确认无误后再点「开始派发」。
        </p>
      </div>
    )
  }

  const dispatching = snapshot?.planStatus === 'dispatching'
  const done = tasks.filter((task) => task.status === 'done').length

  return (
    <div data-auto-team-plan data-run-id={runId} data-plan-status={snapshot?.planStatus}>
      <div data-plan-meta-row>
        <span data-plan-planned-at title={formatStamp(extras.plannedAt)}>
          计划时间 {formatStamp(extras.plannedAt)}
        </span>
        <span data-plan-run-id>run {runId}</span>
        <span data-plan-status-label>状态 {snapshot?.planStatus ?? '—'}</span>
      </div>

      <div data-plan-concurrency data-concurrency-source={extras.concurrency.source}>
        <span data-concurrency-running>运行中 {extras.concurrency.running}</span>
        <span data-concurrency-sep>/</span>
        <span data-concurrency-limit>上限 {extras.concurrency.limit}</span>
        <span data-concurrency-source-label>
          来源 {extras.concurrency.source === 'host' ? '宿主' : '默认值'}
        </span>
        <span data-concurrency-done>
          进度 {done}/{tasks.length}
        </span>
      </div>

      <div data-plan-actions>
        <button
          type="button"
          onClick={() => void dispatch()}
          disabled={busy || dispatching}
          data-plan-dispatch
          title={dispatching ? '已派发，等待成员创建完成' : '按任务图创建成员并并行执行'}
        >
          {dispatching ? '派发中…' : '开始派发'}
        </button>
        <button type="button" onClick={() => void cancel()} disabled={busy} data-plan-cancel>
          取消运行
        </button>
        <span data-plan-members>成员 {snapshot?.members.length ?? 0}</span>
      </div>

      {hint !== undefined ? (
        <div data-hint role="status">
          {hint}
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <div data-empty data-empty-next>
          计划里还没有任务，让队长补充拆解后再派发。
        </div>
      ) : (
        <div data-plan-table>
          {tasks.map((task) => {
            const badge = statusBadge(task.status)
            const editable = roleEditable(task)
            return (
              <div
                key={task.id}
                data-plan-row
                data-task-id={task.id}
                data-status={task.status}
              >
                <span data-task-id-label>{task.id}</span>
                <span data-task-title title={task.title}>
                  {task.title}
                </span>

                <select
                  data-task-role
                  data-role-value={task.roleId}
                  value={task.roleId}
                  disabled={!editable}
                  title={editable ? '派发前可替换执行角色' : '任务已开跑，不能再换角色'}
                  onChange={(event) => void changeRole(task.id, event.target.value)}
                >
                  {roles.every((role) => role.id !== task.roleId) ? (
                    <option value={task.roleId}>{task.roleId}（已不在角色库）</option>
                  ) : null}
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>

                <span data-task-status-badge data-tone={badge.tone} data-status={task.status}>
                  <span data-badge-icon aria-hidden="true">
                    {badge.icon}
                  </span>
                  {badge.text}
                </span>

                {task.dependsOn.length > 0 ? (
                  <span data-task-deps>依赖 {task.dependsOn.join('、')}</span>
                ) : null}
                {task.acceptance !== '' ? (
                  <span data-task-acceptance title={task.acceptance}>
                    判定 {task.acceptance}
                  </span>
                ) : null}
                {task.evidence !== undefined ? (
                  <span data-task-has-evidence data-exit-code={task.evidence.exitCode}>
                    证据已就位（退出码 {task.evidence.exitCode}）
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default PlanTab
