/**
 * r17：子智能体主界面（主区里点角色卡 / 任务行 / 流程图节点后打开）。
 *
 * 纯展示组件：成员、任务、消息、路由审计的取数与文案都在 `nav.ts#memberPageOf`
 * 里完成，这里只按 `MemberPageView` 铺 DOM（因此不需要 hook，也不会重复格式化）。
 */
import * as React from 'react'
import type { MemberPageView } from '../nav.ts'
import EmptyState from './EmptyState.tsx'

export interface MemberPageProps {
  /** `null` = 导航指向的成员已不在当前快照里（被清理 / 切了会话）。 */
  view: MemberPageView | null
  memberId: string
  onBack: () => void
  /** `panel` = 右栏内联降级面；`main` = 主区页面。 */
  surface?: 'main' | 'panel'
}

export function MemberPage(props: MemberPageProps): React.ReactElement {
  const { view, memberId, onBack, surface = 'main' } = props
  return (
    <div
      data-member-page
      data-member-id={memberId}
      data-member-surface={surface}
      data-member-found={view === null ? 'false' : 'true'}
    >
      <div data-member-bar>
        <button type="button" data-member-back onClick={onBack}>
          ← 返回项目库
        </button>
        <span data-member-crumb>子智能体</span>
      </div>

      {view === null ? (
        <EmptyState
          title="成员已不在当前 run 里"
          hint={`快照里找不到 ${memberId}（可能已被清理，或切到了别的会话）。`}
          next="回到项目库，从角色卡或任务行重新选择成员。"
        />
      ) : (
        <>
          <header data-member-head>
            <h2 data-member-name>{view.name}</h2>
            <span data-member-status data-tone={view.statusTone} title={view.statusTitle}>
              {view.statusText}
            </span>
            <span data-member-role data-role-id={view.roleId}>
              {view.roleName}
            </span>
            <span data-member-model data-usage-source={view.routeAudit?.verdict ?? 'declared'}>
              {view.modelRoute}
            </span>
          </header>

          <dl data-member-facts>
            <dt>职责</dt>
            <dd data-member-duty>{view.duty === '' ? '—' : view.duty}</dd>
            <dt>最近活动</dt>
            <dd data-member-last-active>{view.lastActiveText}</dd>
            <dt>停滞</dt>
            <dd data-member-stalled data-stalled={view.stalled ? 'true' : 'false'}>
              {view.stalled ? view.stalledText : view.stallNote === '' ? '未停滞' : view.stallNote}
            </dd>
            <dt>续聊</dt>
            <dd data-member-resume>{view.resumeText}</dd>
          </dl>

          {view.routeAudit !== undefined ? (
            <p
              data-member-route-audit
              data-verdict={view.routeAudit.verdict}
              data-tone={view.routeAudit.tone}
            >
              {view.routeAudit.text}
            </p>
          ) : (
            <p data-member-route-audit data-verdict="none">
              尚未收到该成员的路由审计。
            </p>
          )}

          <section data-member-task data-task-id={view.task?.taskId ?? ''}>
            <h3 data-member-section-title>执行任务</h3>
            {view.task === undefined ? (
              <p data-member-task-empty>{view.taskText}</p>
            ) : (
              <>
                <div data-member-task-head>
                  <span data-member-task-id>{view.task.taskId}</span>
                  <strong data-member-task-title>{view.task.title}</strong>
                  <span data-member-task-status data-tone={view.task.statusTone}>
                    {view.task.statusText}
                  </span>
                </div>
                <div data-member-task-cells>
                  <span data-cell="token" data-usage-source={view.task.usageSource} title={view.task.tokenTitle}>
                    {view.task.tokenText}
                  </span>
                  <span data-member-cell-sep>·</span>
                  <span data-cell="duration" data-duration-state={view.task.durationState} title={view.task.durationTitle}>
                    {view.task.durationText}
                  </span>
                </div>
                <dl data-member-task-facts>
                  <dt>验收</dt>
                  <dd data-member-acceptance>{view.task.acceptance}</dd>
                  <dt>前置</dt>
                  <dd data-member-depends>{view.task.dependsText}</dd>
                  <dt>写域</dt>
                  <dd data-member-scope>{view.task.scopeText}</dd>
                  <dt>门禁</dt>
                  <dd data-member-evidence>{view.task.evidenceText}</dd>
                </dl>
              </>
            )}
          </section>

          <section data-region="member-messages" data-message-count={view.messageCount}>
            <h3 data-member-section-title>直接消息 · {view.messageCount}</h3>
            {view.messages.length === 0 ? (
              <p data-member-messages-empty>{view.emptyMessagesText}</p>
            ) : (
              <ol data-member-message-list>
                {view.messages.map((message) => (
                  <li
                    key={message.messageId}
                    data-member-message
                    data-message-id={message.messageId}
                    data-foldable={message.foldable ? 'true' : 'false'}
                  >
                    <div data-member-message-head>
                      <span data-member-message-from>{message.fromText}</span>
                      <span data-member-message-arrow>→</span>
                      <span data-member-message-to>{message.toText}</span>
                      <span data-member-message-at>{message.atText}</span>
                    </div>
                    {message.foldable ? (
                      <details data-member-message-fold>
                        <summary>展开全文</summary>
                        <p data-member-message-body>{message.body}</p>
                      </details>
                    ) : (
                      <p data-member-message-body>{message.body}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  )
}

export default MemberPage
