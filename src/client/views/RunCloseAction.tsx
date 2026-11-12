/**
 * r24 t2：一行「未收口·可能残留」的 run 的**终止入口**（历史列表 / 顶部 run 卡共用）。
 *
 * 为什么单独一个组件：两处都要「徽标 + 终止按钮 + 二次确认 + 失败原因」，
 * 各写一份就会在第一次改文案/改动作名时漂移。这里只做一件事：
 * 把 `PanelAction.closeRun` 包上既有 `ConfirmDialog`（`confirmDialogOf` 的动词表已含 closeRun），
 * 成功靠宿主返回的新快照原地刷新，失败把 `rejected.message` 显示在这一行（**不静默**）。
 *
 * 本仓没有 `react-dom`（见 `src/client/ui.ts` 文件头），所以确认弹窗按既有做法内联渲染，
 * 由 `ConfirmDialog` 的 fixed/inline 双模式兜住窄面板与定位上下文 —— 不做 `createPortal`。
 */
import * as React from 'react'
import type { ClientAction } from '../viewmodel.ts'
import type { Badge } from '../viewmodel.ts'
import {
  actFeedback,
  CLOSE_RUN_DONE_TEXT,
  CLOSE_RUN_FAILED_TEXT,
  CLOSE_RUN_LABEL,
  closeRunPendingOf,
  hintOf,
  RESIDUAL_RUN_TITLE,
} from '../viewmodel.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'

export interface RunCloseActionProps {
  runId: string
  /** 残留徽标（由 `rows.ts` 的行投影判定，组件不重复判）。徽标与按钮成对出现。 */
  badge: Badge
  /** 面板唯一的动作入口（`store.act` 的包装）；成功的新快照由它写回视图。 */
  act: (action: ClientAction) => Promise<unknown>
  /** `card` = 顶部 216px run 卡内（更紧凑）；缺省 = 历史行（整宽）。 */
  variant?: 'history' | 'card'
}

export function RunCloseAction(props: RunCloseActionProps): React.ReactElement {
  const { runId, badge, act, variant = 'history' } = props
  const [pending, setPending] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  /**
   * 本行已经终止成功。宿主的 `runs` 列表有 5s memo，动作返回的新快照里这一行可能
   * 还是「派发中」——先按已终止渲染（不再显示「未收口」徽标），等快照追上来。
   */
  const [done, setDone] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  /** 只在「弹窗从开到关」时把焦点还给触发按钮，挂载时绝不抢焦点。 */
  const wasOpen = React.useRef(false)

  React.useEffect(() => {
    if (pending) {
      wasOpen.current = true
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    triggerRef.current?.focus()
  }, [pending])

  // 幂等 id + 固定的影响面说明：同一个 run 每次弹窗都是同一条待确认内容。
  const dialogPending = React.useMemo(() => closeRunPendingOf(runId), [runId])

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    // actFeedback 兜住 reject 与 `{error}` / `{data:{rejected}}` 三种失败形态。
    const feedback = await actFeedback(act, { type: 'closeRun', runId })
    setBusy(false)
    setPending(false)
    if (feedback.ok) {
      // 成功时新快照会把这一行刷成终态；快照没追上（宿主历史列表 5s memo）时用本地态兜住。
      setDone(true)
      setNotice(hintOf(feedback) ?? CLOSE_RUN_DONE_TEXT)
      return
    }
    setError(hintOf(feedback) ?? CLOSE_RUN_FAILED_TEXT)
  }

  return (
    <span data-run-close data-run-close-for={runId} data-variant={variant} data-done={done ? 'true' : 'false'}>
      {done ? null : (
        <span data-badge data-tone={badge.tone} data-residual-run title={RESIDUAL_RUN_TITLE}>
          <span aria-hidden="true">{badge.icon}</span> {badge.text}
        </span>
      )}
      {notice !== null ? (
        <span data-run-close-notice role="status">
          {notice}
        </span>
      ) : null}
      {error !== null ? (
        // 失败原因必须可读、可悬停看全文（320px 用 overflow-wrap 换行，不做省略）。
        <span data-run-close-error role="alert" title={error}>
          {error}
        </span>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        data-close-run={runId}
        title={done ? CLOSE_RUN_DONE_TEXT : `${CLOSE_RUN_LABEL}：${runId}（不可撤销）`}
        disabled={busy}
        aria-busy={busy}
        aria-disabled={done}
        onClick={() => {
          // 已终止后按钮仍留在 DOM 里（焦点要能回来），但不再打开确认弹窗。
          if (done || busy) return
          setError(null)
          setNotice(null)
          setPending(true)
        }}
      >
        {CLOSE_RUN_LABEL}
      </button>
      {pending ? (
        <ConfirmDialog
          pending={dialogPending}
          busy={busy}
          onConfirm={() => void confirm()}
          onReject={() => {
            if (busy) return
            setPending(false)
          }}
        />
      ) : null}
    </span>
  )
}

export default RunCloseAction
