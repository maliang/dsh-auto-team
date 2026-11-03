/**
 * 不可逆动作确认弹窗（r13 AC-11 / AC-12 / AC-13）。
 *
 * 五条硬约束（每一条都是真机上会出事的地方）：
 *  1. **默认焦点在「取消」**：不可逆动作的安全默认值是「不做」，回车不能直接造成破坏。
 *  2. `Esc` = 取消；`Tab` 只在两个按钮间循环（焦点不逃到面板背后）。
 *  3. 标题是**动词短语**（终止运行 / 中断成员 / 跳过任务 / 重新门禁 / 强制并行），
 *     按钮不得写「确定」——用户必须能在按下前读出「会发生什么」。
 *  4. 影响面文案 `summary` 来自宿主（含下游数量、写域冲突对象），客户端不改写、不截断。
 *  5. 不乐观确认：`busy` 时两个按钮都禁用并 `aria-busy`，等宿主快照把 pending 清掉。
 *
 * `fixed` 在带 `transform` 的祖先里会退化成相对定位（真机右栏就有这种祖先），
 * 所以运行时量一次宽度/定位，不可靠时切 `data-dialog-mode="inline"` 用内联兜底。
 */
import * as React from 'react'
import type { PendingConfirmationView } from '../../shared/types.ts'
import { confirmDialogOf } from '../viewmodel.ts'

export interface ConfirmDialogProps {
  pending: PendingConfirmationView
  busy?: boolean
  onConfirm: () => void
  onReject: () => void
}

export function ConfirmDialog(props: ConfirmDialogProps): React.ReactElement {
  const { pending, busy, onConfirm, onReject } = props
  const view = confirmDialogOf(pending)
  const dialogRef = React.useRef<HTMLDivElement>(null)
  const rejectRef = React.useRef<HTMLButtonElement>(null)
  const [mode, setMode] = React.useState<'fixed' | 'inline'>('fixed')
  const titleId = React.useId()
  const summaryId = React.useId()

  // 每次换一条 pending 都把焦点放回「取消」（不是上一轮点过的「确认」）。
  React.useEffect(() => {
    rejectRef.current?.focus()
  }, [pending.id])

  React.useEffect(() => {
    const check = (): void => {
      const dialog = dialogRef.current
      if (!dialog) return
      const rect = dialog.getBoundingClientRect()
      const overlay = dialog.parentElement
      const positioned = overlay ? window.getComputedStyle(overlay).position === 'fixed' : false
      if (rect.width < 360 || !positioned) setMode('inline')
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (busy !== true) onReject()
        return
      }
      if (event.key !== 'Tab') return
      const actions = dialogRef.current?.querySelectorAll<HTMLElement>('[data-dialog-action]')
      if (!actions || actions.length === 0) return
      const first = actions[0]
      const last = actions[actions.length - 1]
      const active = document.activeElement
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onReject])

  return (
    <div data-confirm-overlay data-dialog-mode={mode}>
      <div
        ref={dialogRef}
        data-confirm-dialog
        data-dialog-mode={mode}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
      >
        <div data-dialog-head>
          <h2 id={titleId} data-dialog-title>
            {view.title}
          </h2>
          <span data-dialog-irreversible>{view.irreversibleText}</span>
        </div>
        <dl data-dialog-fields>
          <dt>动作</dt>
          <dd data-dialog-action-name>{view.actionLabel}</dd>
          <dt>对象</dt>
          <dd data-dialog-object>{view.objectText}</dd>
          <dt>影响</dt>
          <dd id={summaryId} data-dialog-summary>
            {view.summary}
          </dd>
          <dt>已等待</dt>
          <dd data-dialog-waited>{view.waitedText}</dd>
        </dl>
        <div data-dialog-actions>
          <button
            ref={rejectRef}
            type="button"
            data-dialog-action="reject"
            data-variant="ghost"
            disabled={busy === true}
            onClick={onReject}
          >
            {view.rejectLabel}
          </button>
          <button
            type="button"
            data-dialog-action="confirm"
            data-variant="danger"
            aria-busy={busy === true}
            disabled={busy === true}
            onClick={onConfirm}
          >
            {busy === true ? <span data-dialog-spinner aria-hidden="true" /> : null}
            {view.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
