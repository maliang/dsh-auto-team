/**
 * 成员页：角色 / 任务 / 状态 / 最近事件 / **实际模型路由**（AC-22 逐字）+ 回执 + 消息账本。
 *
 * 为什么三样东西放在同一页（TECHNICAL §6）：
 *   状态、实际模型、证据、直达消息都属于「某个成员」，分页放会让用户来回跳着对账；
 *   AC-16（消息可核验）、AC-18（成员已死但面板说运行中）、AC-19（回执与门禁证据）
 *   全部要靠这一页的同一行来读。
 */
import * as React from 'react'
import type { TabProps } from '../Panel.tsx'
import { actFeedback, formatClock, formatRelative, hintOf, memberRouteText, statusBadge, tailLines, viewExtras } from '../viewmodel.ts'

/** 心跳阈值：超过它仍显示「运行中」，就在行内挂一个存疑标记（AC-18 的可见侧）。 */
const STALE_MS = 15_000

export function MembersTab(props: TabProps): React.ReactElement {
  const { snapshot, act } = props
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [note, setNote] = React.useState<Record<string, string>>({})
  const [openEvidence, setOpenEvidence] = React.useState<string | undefined>(undefined)
  const [hint, setHint] = React.useState<string | undefined>(undefined)

  const members = snapshot?.members ?? []
  const tasks = snapshot?.tasks ?? []
  const extras = viewExtras(snapshot)
  const now = Date.now()

  if (members.length === 0) {
    return (
      <div data-auto-team-members data-empty>
        <p>还没有成员。</p>
        <p data-empty-next>
          下一步：去「计划」页确认任务图与角色，点「开始派发」后成员会出现在这里 ——
          可继续（中断后续聊）、可发直达消息、可通过回执把结果交给门禁。
        </p>
      </div>
    )
  }

  async function send(memberId: string): Promise<void> {
    const text = (draft[memberId] ?? '').trim()
    if (text === '') return
    const feedback = await actFeedback(act, { type: 'message', memberId, text })
    setHint(hintOf(feedback))
    if (feedback.ok) setDraft((current) => ({ ...current, [memberId]: '' }))
  }

  async function receipt(taskId: string, memberId: string): Promise<void> {
    const text = (note[memberId] ?? '').trim()
    const action = text === '' ? { type: 'receipt' as const, taskId } : { type: 'receipt' as const, taskId, note: text }
    const feedback = await actFeedback(act, action)
    setHint(hintOf(feedback))
    if (feedback.ok) setNote((current) => ({ ...current, [memberId]: '' }))
  }

  return (
    <div data-auto-team-members>
      {hint !== undefined ? (
        <div data-hint role="status">
          {hint}
        </div>
      ) : null}

      {members.map((member) => {
        const task = tasks.find((item) => item.id === member.taskId)
        const evidence = task?.evidence
        const badge = statusBadge(member.status)
        const route = memberRouteText(member, extras.routeAudits)
        const lastEvent = member.lastEventAt
        const stale = member.status === 'running' && lastEvent > 0 && now - lastEvent > STALE_MS
        return (
          <div
            key={member.memberId}
            data-auto-team-member
            data-member-id={member.memberId}
            data-status={member.status}
            data-stale={stale ? 'true' : 'false'}
          >
            <span data-member-name title={member.name}>
              {member.name}
            </span>
            <span data-member-task>{member.taskId ?? '—'}</span>
            <span data-status data-tone={badge.tone}>
              <span data-badge-icon aria-hidden="true">
                {badge.icon}
              </span>
              {badge.text}
            </span>
            <span data-member-last-event title={formatClock(lastEvent)}>
              {formatRelative(lastEvent, now)}
            </span>

            {/* 第二行：模型路由单独占位、等宽、不截断（AC-22 逐字一致的几何保证） */}
            <span data-model-route data-model-route-value={route}>
              {route}
            </span>
            {stale ? (
              <span data-member-stale-hint role="status">
                心跳已超过 {Math.floor(STALE_MS / 1000)} 秒，宿主正在对账（成员进程可能已退出）
              </span>
            ) : null}

            <span data-member-actions>
              <input
                data-member-receipt-note
                value={note[member.memberId] ?? ''}
                placeholder="回执备注（可选）"
                onChange={(event) =>
                  setNote((current) => ({ ...current, [member.memberId]: event.target.value }))
                }
              />
              <button
                type="button"
                data-member-receipt
                data-task-id={member.taskId ?? ''}
                disabled={member.taskId === undefined || member.taskId === ''}
                title="成员报告已完成：宿主据此跑门禁并落证据（AC-19）"
                onClick={() => void receipt(member.taskId ?? '', member.memberId)}
              >
                回执
              </button>
              <button
                type="button"
                data-member-resume
                disabled={!member.canResume}
                title={member.canResume ? '在同一成员上下文里继续，不新建成员' : '该成员当前不需要续聊'}
                onClick={() => void act({ type: 'resume', memberId: member.memberId })}
              >
                继续
              </button>
              {evidence !== undefined ? (
                <button
                  type="button"
                  data-member-evidence
                  aria-expanded={openEvidence === member.taskId}
                  onClick={() =>
                    setOpenEvidence((current) =>
                      current === member.taskId ? undefined : member.taskId,
                    )
                  }
                >
                  证据
                </button>
              ) : null}
            </span>

            <span data-member-message-row>
              <input
                data-member-message
                value={draft[member.memberId] ?? ''}
                placeholder="发直达消息…"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [member.memberId]: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void send(member.memberId)
                }}
              />
              <button type="button" data-member-send onClick={() => void send(member.memberId)}>
                发送
              </button>
            </span>

            {evidence !== undefined && openEvidence === member.taskId ? (
              <div data-evidence-drawer data-task-id={evidence.taskId}>
                <div data-evidence-line>
                  <span data-evidence-label>命令</span>
                  <code data-evidence-command>{evidence.command}</code>
                </div>
                <div data-evidence-line>
                  <span data-evidence-label>退出码</span>
                  <code data-evidence-exit data-exit-code={evidence.exitCode}>
                    {evidence.exitCode}
                  </code>
                </div>
                <div data-evidence-line>
                  <span data-evidence-label>产物</span>
                  <code data-evidence-artifacts>
                    {evidence.artifacts.length > 0 ? evidence.artifacts.join('、') : '（无）'}
                  </code>
                </div>
                <div data-evidence-line>
                  <span data-evidence-label>时间</span>
                  <code>{formatClock(evidence.at)}</code>
                </div>
                <pre data-evidence-tail>
                  {tailLines(evidence.tail, 40).join('\n') || '（无输出）'}
                </pre>
              </div>
            ) : null}
          </div>
        )
      })}

      <div data-message-ledger data-count={extras.messages.length}>
        <div data-ledger-head>
          <strong>直达消息</strong>
          <span data-ledger-meta>共 {extras.messages.length} 条（上限 200，超出丢最旧）</span>
        </div>
        {extras.messages.length === 0 ? (
          <div data-empty>还没有直达消息。队长给成员的任务交接与返工意见都会记在这里。</div>
        ) : (
          <ol data-ledger-list>
            {extras.messages.map((message, index) => (
              <li
                key={message.messageId ?? `${message.at}-${index}`}
                data-message
                data-from={message.from}
                data-to={message.to}
                data-task-id={message.taskId ?? ''}
                data-at={message.at}
              >
                <span data-message-route>
                  {message.from} → {message.to}
                </span>
                {message.taskId !== undefined ? (
                  <span data-message-task>{message.taskId}</span>
                ) : null}
                <time data-message-at dateTime={new Date(message.at).toISOString()}>
                  {formatClock(message.at)}
                </time>
                <span data-message-body>{message.body}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

export default MembersTab
