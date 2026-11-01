/**
 * 计划页签（DESIGN §2.3 / TECHNICAL §4.7）。
 *
 * 任务行是本页的全部内容，三条硬规矩：
 *  1. **10 态文案与色调只来自 `progressOf(task)`**（经 `ui.taskRowView` 打包），
 *     组件里不许再写一个「进行中/已完成」的 switch —— 这是本项目文案漂移的高发点。
 *  2. **暂停不清证据**：`退出码 N` 由 `taskRowView.evidence` 给，暂停时照常渲染；
 *     没有证据时整块不渲染（不写「—」占位，DESIGN §2.3）。
 *  3. **列表顺序即计划顺序**：暂停后不重排，用户才能看出「谁被打断」。
 */
import * as React from 'react'
import type { PlanTask, Role } from '../../shared/types.ts'
import type { TabProps } from '../Panel.tsx'
import { progressOf, formatStamp, recentTriggersOf, actFeedback, hintOf } from '../viewmodel.ts'
import type { ClientAction } from '../viewmodel.ts'
import { taskRowView } from '../ui.ts'

/** 哪些状态允许改角色：已开始/已结束的任务换角色没有意义（会误导「改了会重跑」）。 */
export function roleEditable(task: PlanTask): boolean {
  return task.status === 'pending' || task.status === 'blocked' || task.status === 'ready'
}

const TASK_TONE_DATA: Record<string, string> = {
  ok: 'success',
  warn: 'warn',
  bad: 'danger',
  muted: 'neutral',
}

export function PlanTab(props: TabProps): React.ReactElement {
  const { snapshot, act } = props
  const [busy, setBusy] = React.useState(false)
  const [hint, setHint] = React.useState<string | undefined>(undefined)

  const tasks: PlanTask[] = snapshot?.tasks ?? []
  const roles: Role[] = snapshot?.roles ?? []
  const runId = snapshot?.runId
  const paused = snapshot?.paused === true
  const dispatching = snapshot?.planStatus === 'dispatching'
  const triggers = recentTriggersOf(snapshot)

  async function send(action: ClientAction, done: string): Promise<void> {
    setBusy(true)
    try {
      const feedback = await actFeedback(act, action)
      setHint(hintOf(feedback) ?? (feedback.ok ? done : '动作未生效'))
    } finally {
      setBusy(false)
    }
  }

  if (runId === undefined) {
    return (
      <section data-auto-team-plan data-empty>
        <p>还没有计划。</p>
        <p data-empty-next>把目标发进会话并启用自动团队，队长会先产出计划，再任务行出现在这里。</p>
        {triggers.length === 0 ? null : (
          <ul data-plan-triggers>
            {triggers.map((item) => (
              <li key={`${item.at}-${item.sourceLabel}`} data-auto-team-trigger data-source={item.sourceLabel}>
                <span data-trigger-badge>{item.sourceLabel}</span>
                <span data-trigger-clock>{item.clock}</span>
                <span data-trigger-text>{item.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  const done = tasks.filter((task) => task.status === 'done').length

  return (
    <section data-auto-team-plan data-paused={paused ? 'true' : 'false'}>
      <div data-plan-meta-row>
        <span data-plan-run-id title={runId}>
          运行 {runId}
        </span>
        {typeof snapshot?.plannedAt === 'number' ? (
          <span data-plan-planned-at>{formatStamp(snapshot.plannedAt)}</span>
        ) : null}
        <span data-plan-concurrency data-concurrency-source={snapshot?.concurrency?.source ?? 'default'}>
          并发 {snapshot?.concurrency?.running ?? 0}/{snapshot?.concurrency?.limit ?? 0} · 完成 {done}/{tasks.length}
        </span>
      </div>

      {triggers.length === 0 ? null : (
        <ul data-plan-triggers>
          {triggers.map((item) => (
            <li key={`${item.at}-${item.sourceLabel}`} data-auto-team-trigger data-source={item.sourceLabel}>
              <span data-trigger-badge>{item.sourceLabel}</span>
              <span data-trigger-clock>{item.clock}</span>
              <span data-trigger-text>{item.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div data-plan-actions>
        <button
          type="button"
          data-plan-dispatch
          disabled={busy || paused || dispatching}
          title={paused ? '已暂停：先点页头的「继续任务」' : '把就绪任务派发给成员'}
          onClick={() => void send({ type: 'dispatch' }, '已请求派发')}
        >
          {dispatching ? '派发中…' : '开始派发'}
        </button>
        <button
          type="button"
          data-plan-cancel
          disabled={busy}
          onClick={() => void send({ type: 'cancel' }, '已请求取消计划')}
        >
          取消计划
        </button>
      </div>

      {hint === undefined ? null : (
        <div data-hint role="status">
          {hint}
        </div>
      )}

      <div data-plan-table>
        {tasks.length === 0 ? (
          <div data-empty>计划里还没有任务。</div>
        ) : (
          tasks.map((task) => {
            const row = taskRowView(task, roles)
            const progress = progressOf(task)
            return (
              <article
                key={task.id}
                data-plan-row
                data-task-id={task.id}
                data-status={progress.status}
                data-tone={TASK_TONE_DATA[row.statusTone] ?? 'neutral'}
                data-paused={progress.status === 'paused' ? 'true' : 'false'}
              >
                <header data-task-head>
                  <span data-task-id-label>{task.id}</span>
                  <span data-task-title title={row.title}>
                    {row.title}
                  </span>
                  <span
                    data-task-status-badge
                    data-tone={TASK_TONE_DATA[row.statusTone] ?? 'neutral'}
                    data-status={progress.status}
                  >
                    {row.statusLabel}
                  </span>
                </header>

                {row.content === '' ? null : (
                  <p data-task-acceptance title={row.content}>
                    {row.content}
                  </p>
                )}

                <footer data-task-foot>
                  {roleEditable(task) ? (
                    <select
                      data-task-role
                      value={task.roleId}
                      disabled={busy}
                      onChange={(event) =>
                        void send(
                          { type: 'setTaskRole', taskId: task.id, roleId: event.target.value },
                          `已把 ${task.id} 指派给 ${event.target.value}`,
                        )
                      }
                    >
                      <option value="">未分配</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span data-task-role-readonly>{roleLabelOf(task, roles)}</span>
                  )}

                  {row.evidence === '' ? null : (
                    <span data-task-has-evidence data-evidence={row.evidence}>
                      {row.evidence}
                    </span>
                  )}

                  <button
                    type="button"
                    data-task-receipt
                    disabled={busy}
                    title="人工放行门禁（宿主会记一笔证据）"
                    onClick={() => void send({ type: 'receipt', taskId: task.id, note: '面板手动放行' }, `已放行 ${task.id}`)}
                  >
                    放行
                  </button>

                  <button
                    type="button"
                    data-task-resume
                    disabled={busy}
                    onClick={() => void send({ type: 'resume', taskId: task.id }, `已请求续聊 ${task.id}`)}
                  >
                    续聊
                  </button>
                </footer>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}

/** 只读角色名（不可编辑时显示；文案与 `ui.taskRowView().roleLabel` 同口径）。 */
function roleLabelOf(task: PlanTask, roles: Role[]): string {
  const id = task.roleId ?? ''
  if (id === '') return '未分配'
  const found = roles.find((role) => role.id === id)
  return found === undefined ? id : found.name
}

export default PlanTab
