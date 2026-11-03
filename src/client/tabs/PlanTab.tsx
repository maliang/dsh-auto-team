/**
 * 计划页签（DESIGN §2.3 / TECHNICAL §4.7）。
 *
 * 任务行是本页的全部内容，四条硬规矩：
 *  1. **13 态文案与色调只来自 `progressOf(task)`**（经 `ui.taskRowView` 打包），
 *     组件里不许再写一个「进行中/已完成」的 switch —— 这是本项目文案漂移的高发点。
 *  2. **暂停不清证据**：`退出码 N` 由 `taskRowView.evidence` 给，暂停时照常渲染；
 *     没有证据时整块不渲染（不写「—」占位，DESIGN §2.3）。
 *  3. **列表顺序即计划顺序**：暂停后不重排，用户才能看出「谁被打断」。
 *  4. **r11 三块新区域都长在本页内**（AC-21 零新增槽位）：
 *     写域占用在动作行与任务表之间、等待条在 acceptance 与 foot 之间、执行痕迹在页面最末。
 *     等待原因 / 占用原因 / 留痕原因一律渲染快照原文（DESIGN §0.1「零拼装」）。
 */
import * as React from 'react'
import type { PlanTask, Role } from '../../shared/types.ts'
import type { TabProps } from '../Panel.tsx'
import {
  progressOf,
  formatStamp,
  recentTriggersOf,
  actFeedback,
  hintOf,
  scopeLockRowsOf,
  deviationRowsOf,
  deviationWriteCountOf,
} from '../viewmodel.ts'
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

/** 单任务动作的默认 title（enabled 时给一句「点了会发生什么」）。 */
const TASK_ACTION_HINT: Record<string, string> = {
  cancel: '取消这个任务（不可撤销，正在跑的成员会被中断）',
  skip: '跳过这个任务（下游视为依赖满足）',
  'edit-acceptance': '修改验收命令，下次门禁生效',
}

/** 改验收浮层的空值判定：trim 后为空即不可提交（AC-27 的 0 请求）。 */
function isBlankAcceptance(value: string): boolean {
  return value.trim() === ''
}

export function PlanTab(props: TabProps): React.ReactElement {
  const { snapshot, act } = props
  const [busy, setBusy] = React.useState(false)
  const [hint, setHint] = React.useState<string | undefined>(undefined)
  /** 正在飞的任务动作（非乐观：整组 disabled + 转环，快照回来才解除）。 */
  const [pending, setPending] = React.useState<{ taskId: string; action: string } | null>(null)
  /** 成功闪烁（DESIGN §4：data-flash 300ms）。 */
  const [flashTaskId, setFlashTaskId] = React.useState<string | null>(null)
  /** 每张卡自己的失败原因（foot 下方一行 [data-error]，不占页面级 hint）。 */
  const [taskErrors, setTaskErrors] = React.useState<Record<string, string | undefined>>({})
  /** 改验收浮层：草稿随输入实时更新，取消即丢弃。 */
  const [editor, setEditor] = React.useState<{ taskId: string; draft: string } | null>(null)
  const [editorError, setEditorError] = React.useState<string | undefined>(undefined)
  const [savingEditor, setSavingEditor] = React.useState(false)
  const lastTriggerRef = React.useRef<HTMLElement | null>(null)
  const flashTimer = React.useRef<number | undefined>(undefined)

  const tasks: PlanTask[] = snapshot?.tasks ?? []
  const roles: Role[] = snapshot?.roles ?? []
  const runId = snapshot?.runId
  const paused = snapshot?.paused === true
  const dispatching = snapshot?.planStatus === 'dispatching'
  const triggers = recentTriggersOf(snapshot)
  const locks = scopeLockRowsOf(snapshot)
  const deviations = deviationRowsOf(snapshot)
  const deviationWrites = deviationWriteCountOf(deviations)

  React.useEffect(() => {
    return () => {
      if (flashTimer.current !== undefined) window.clearTimeout(flashTimer.current)
    }
  }, [])

  /** 浮层关闭后把焦点还给「验收」按钮（DESIGN §6）。 */
  React.useEffect(() => {
    if (editor === null && lastTriggerRef.current !== null) {
      lastTriggerRef.current.focus()
      lastTriggerRef.current = null
    }
  }, [editor])

  /** 浮层外 pointerdown 关闭；浮层内点击不关闭（DESIGN §4）。 */
  React.useEffect(() => {
    if (editor === null) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Element | null
      if (target !== null && typeof target.closest === 'function' && target.closest('[data-acceptance-editor]') !== null) {
        return
      }
      setEditor(null)
      setEditorError(undefined)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [editor])

  function flash(taskId: string): void {
    setFlashTaskId(taskId)
    if (flashTimer.current !== undefined) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashTaskId(null), 300)
  }

  async function send(action: ClientAction, done: string): Promise<void> {
    setBusy(true)
    try {
      const feedback = await actFeedback(act, action)
      setHint(hintOf(feedback) ?? (feedback.ok ? done : '动作未生效'))
    } finally {
      setBusy(false)
    }
  }

  /** 单任务动作（取消 / 跳过）：失败只落到这张卡上，成功闪一下。 */
  async function runTaskAction(
    action: ClientAction,
    taskId: string,
    actionName: 'cancel' | 'skip',
  ): Promise<void> {
    setPending({ taskId, action: actionName })
    setTaskErrors((prev) => ({ ...prev, [taskId]: undefined }))
    try {
      const feedback = await actFeedback(act, action)
      const failure = hintOf(feedback)
      if (!feedback.ok) {
        setTaskErrors((prev) => ({ ...prev, [taskId]: failure ?? '动作未生效' }))
        return
      }
      flash(taskId)
    } finally {
      setPending(null)
    }
  }

  function openEditor(task: PlanTask, event: React.MouseEvent<HTMLButtonElement>): void {
    lastTriggerRef.current = event.currentTarget
    setEditor({ taskId: task.id, draft: typeof task.acceptance === 'string' ? task.acceptance : '' })
    setEditorError(undefined)
  }

  async function saveAcceptance(): Promise<void> {
    if (editor === null || isBlankAcceptance(editor.draft)) return
    setSavingEditor(true)
    setEditorError(undefined)
    try {
      const feedback = await actFeedback(act, {
        type: 'updateAcceptance',
        taskId: editor.taskId,
        acceptance: editor.draft,
      })
      if (!feedback.ok) {
        // 失败不关闭浮层：用户改了一半的命令不能丢（DESIGN §4）。
        setEditorError(hintOf(feedback) ?? '保存失败')
        return
      }
      flash(editor.taskId)
      setEditor(null)
    } finally {
      setSavingEditor(false)
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
        {/*
          派发必须由队长（Agent 身份）执行：宿主只允许顶层会话创建成员，而面板走 HTTP，
          没有 `ctx.agents.currentInitiator()`，点这里只会得到「当前没有活跃的队长会话」。
          所以这里不做成可点按钮，只说明该怎么派发（r12 真机实测）。
        */}
        <span
          data-plan-dispatch-hint
          role="note"
          title="派发需要以队长 Agent 身份调用 auto_team_dispatch（HTTP 面板路径拿不到该身份）"
        >
          {paused ? '已暂停：先点页头的「继续任务」' : dispatching ? '派发中…' : '派发需由队长执行：在对话里说「开始派发」'}
        </span>
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

      {/* 写域占用：动作行与任务表之间（DESIGN §2.3）；空数组连组标题都不渲染。 */}
      {locks.length === 0 ? null : (
        <section data-scope-locks aria-label="写域占用">
          <div data-locks-head>{`写域占用 · ${locks.length} 处`}</div>
          <ul data-lock-list>
            {locks.map((lock) => (
              <li key={lock.path} data-lock-row data-task-id={lock.holderTaskId}>
                <code data-lock-path>{lock.path}</code>
                <span data-lock-holder title={lock.holderLabel}>
                  {lock.holderLabel}
                </span>
                {lock.waiters.length === 0 ? null : (
                  <ul data-lock-waiters>
                    {lock.waiters.map((waiter) => (
                      <li key={`${waiter.taskId}-${waiter.reason}`} data-lock-waiter data-task-id={waiter.taskId}>
                        {waiter.label}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div data-plan-table>
        {tasks.length === 0 ? (
          <div data-empty>计划里还没有任务。</div>
        ) : (
          tasks.map((task) => {
            const row = taskRowView(task, roles)
            const progress = progressOf(task)
            const tone = TASK_TONE_DATA[row.statusTone] ?? 'neutral'
            const taskPending = pending !== null && pending.taskId === task.id
            const editing = editor !== null && editor.taskId === task.id
            const waitReason = progress.status === 'waiting' ? row.waitReason : ''
            const taskError = taskErrors[task.id]
            return (
              <article
                key={task.id}
                data-plan-row
                data-task-id={task.id}
                data-status={progress.status}
                data-tone={tone}
                data-paused={progress.status === 'paused' ? 'true' : 'false'}
                data-editing={editing ? 'true' : 'false'}
                data-flash={flashTaskId === task.id ? 'true' : undefined}
              >
                <header data-task-head>
                  <span data-task-id-label>{task.id}</span>
                  <span data-task-title title={row.title}>
                    {row.title}
                  </span>
                  <span data-task-status-badge data-tone={tone} data-status={progress.status}>
                    {row.statusLabel}
                  </span>
                </header>

                {row.content === '' ? null : (
                  <p data-task-acceptance title={row.content}>
                    {row.content}
                  </p>
                )}

                {/* 等待条：仅 waiting 且宿主给了原因；文本逐字取快照（AC-20）。 */}
                {waitReason === '' ? null : (
                  <p data-wait-reason role="note" data-task-id={task.id}>
                    {waitReason}
                  </p>
                )}

                <footer data-task-foot>
                  {roleEditable(task) ? (
                    <select
                      data-task-role
                      value={task.roleId}
                      disabled={busy || taskPending}
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
                    disabled={busy || taskPending}
                    title="人工放行门禁（宿主会记一笔证据）"
                    onClick={() => void send({ type: 'receipt', taskId: task.id, note: '面板手动放行' }, `已放行 ${task.id}`)}
                  >
                    放行
                  </button>

                  <button
                    type="button"
                    data-task-resume
                    disabled={busy || taskPending}
                    onClick={() => void send({ type: 'resume', taskId: task.id }, `已请求续聊 ${task.id}`)}
                  >
                    续聊
                  </button>

                  {/* 三动作：disabled 与原因来自 shared 允许表；飞中整组 disabled（非乐观）。 */}
                  <span data-task-actions>
                    {row.actions.map((action) => {
                      const disabled = action.disabled || busy || taskPending
                      const busyHere = taskPending && pending !== null && pending.action === action.action
                      const title = action.disabled && action.reason !== undefined ? action.reason : TASK_ACTION_HINT[action.action]
                      return (
                        <button
                          key={action.action}
                          type="button"
                          data-task-action={action.action}
                          disabled={disabled}
                          aria-disabled={action.disabled ? 'true' : undefined}
                          aria-label={
                            action.disabled && action.reason !== undefined
                              ? `${action.ariaLabel}（${action.reason}）`
                              : action.ariaLabel
                          }
                          title={title}
                          onClick={(event) => {
                            if (action.action === 'edit-acceptance') {
                              openEditor(task, event)
                              return
                            }
                            if (action.action === 'cancel') {
                              void runTaskAction(
                                { type: 'cancelTask', taskId: task.id },
                                task.id,
                                'cancel',
                              )
                              return
                            }
                            void runTaskAction(
                              { type: 'skipTask', taskId: task.id },
                              task.id,
                              'skip',
                            )
                          }}
                        >
                          {action.label}
                          {busyHere ? <span data-task-action-spinner aria-hidden="true" /> : null}
                        </button>
                      )
                    })}
                  </span>
                </footer>

                {taskError === undefined ? null : (
                  <div data-error role="alert">
                    {taskError}
                  </div>
                )}

                {/* 改验收：卡内绝对浮层（不是模态），失败不关闭、保留输入（DESIGN §4）。 */}
                {editing && editor !== null ? (
                  <div
                    data-acceptance-editor
                    role="dialog"
                    aria-modal="false"
                    aria-label={`修改 ${task.id} 的验收命令`}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setEditor(null)
                        setEditorError(undefined)
                      }
                    }}
                  >
                    <div data-acceptance-editor-head>
                      <span data-acceptance-editor-title>{`改验收 · ${task.id}`}</span>
                      <span data-task-status-badge data-tone={tone} data-status={progress.status}>
                        {row.statusLabel}
                      </span>
                    </div>
                    <textarea
                      data-acceptance-input
                      aria-label="验收命令"
                      rows={3}
                      autoFocus
                      value={editor.draft}
                      onChange={(event) => setEditor({ taskId: task.id, draft: event.target.value })}
                    />
                    <p data-acceptance-hint>一条能在本仓库真跑通的命令，exit 0 才算过；空值不能保存</p>
                    {editorError === undefined ? null : (
                      <div data-error role="alert">
                        {editorError}
                      </div>
                    )}
                    <div data-acceptance-actions>
                      <button
                        type="button"
                        data-acceptance-cancel
                        disabled={savingEditor}
                        onClick={() => {
                          setEditor(null)
                          setEditorError(undefined)
                        }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        data-acceptance-save
                        disabled={savingEditor || isBlankAcceptance(editor.draft)}
                        aria-disabled={isBlankAcceptance(editor.draft) ? 'true' : undefined}
                        title={isBlankAcceptance(editor.draft) ? '验收命令不能为空' : '保存后下次门禁生效'}
                        onClick={() => void saveAcceptance()}
                      >
                        {savingEditor ? '保存中…' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })
        )}
      </div>

      {/* 执行痕迹：页面最末，审计不是告警（DESIGN §3.6）；0 条不渲染。 */}
      {deviations.length === 0 ? null : (
        <section data-deviation aria-label="执行痕迹">
          <div data-deviation-head>{`执行痕迹 · 队长亲手写了 ${deviationWrites} 次`}</div>
          <ul data-deviation-list>
            {deviations.map((record, index) => (
              <li key={`${record.at}-${record.toolName}-${index}`} data-deviation-row>
                <time data-deviation-at>{record.at}</time>
                <span data-deviation-tool>{record.toolName}</span>
                <code data-deviation-paths>{record.paths}</code>
                {record.countLabel === '' ? null : <span data-deviation-count>{record.countLabel}</span>}
                <span data-deviation-reason>{record.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
