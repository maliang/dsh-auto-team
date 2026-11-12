/**
 * E2 `conversation.session.header.actions`：会话头「自动团队」按钮（DESIGN §2.2，AC-11 / AC-13）。
 *
 * r10 的语义变化：从「只能打开」变成「**可开可收**」。
 *   ① 已开 → 调 `closePanel()`（宿主三级回退，见 `slots.createPanelCommands`）；
 *      返回 false = 宿主没提供任何关闭入口 → **不翻转** `aria-pressed`，按钮保持「已打开」，
 *      title 说明原因（AC-11：状态必须是真的，宁可停在「没关上」也不能假装关上）；
 *   ② 未开 → 调 `openPanel()`；返回 false → 回退到 `window.dispatchEvent(OPEN_PANEL_EVENT)`
 *      （面板已挂载时自己切页；未挂载时事件无人接收，属正常）。
 *
 * 为什么两个分支都要有：只做 ① 会在服务晚到的真机上「点了没反应」，只做 ② 会在面板未打开时
 * 派发一个没人听的事件 —— r1~r6 的 Toggle 就是后者。
 *
 * `aria-pressed` 的值来自 `isPanelOpen()`（真实页签状态）优先，缺失时才用本地态：
 * 用户从页签 × 关掉面板后，按钮不会继续显示「已打开」（AC-11 的非乐观判据）。
 *
 * 文案/角标/aria 全部来自 `ui.headerButtonView`；本组件不写中文状态。
 */
import * as React from 'react'
import { useAutoTeamStyle } from './styles.ts'
import { sessionIdOf, usePanelState } from './state.ts'
import { currentRunStageInputOf } from './viewmodel.ts'
import { headerButtonView } from './ui.ts'

/** 面板未就绪时的回退通道（`Panel.tsx` 订阅它切到「计划」页）。 */
export const OPEN_PANEL_EVENT = 'dsh-auto-team:open-panel'

/** 关不掉的回退通道：`Panel.tsx` 订阅它，把「收起失败」的原因显示在面板错误区。 */
export const PANEL_CLOSE_EVENT = 'dsh-auto-team:close-panel'

export interface HeaderButtonProps {
  sessionId?: string
  session?: { id?: string }
  /** 宿主原生「打开页签」动作（`slots.createPanelCommands().open`）。 */
  openPanel?: () => boolean
  /** 「收起本插件页签」（`slots.createPanelCommands().close`，内部三级回退）。 */
  closePanel?: () => boolean
  /** 本插件页签是否开着；`undefined` = 宿主没这个能力 → 退回本地态。 */
  isPanelOpen?: () => boolean | undefined
  [key: string]: unknown
}

export function AutoTeamHeaderButton(props: HeaderButtonProps): React.ReactElement {
  useAutoTeamStyle()
  const sessionId = sessionIdOf(props as Record<string, unknown>)
  const view = usePanelState(sessionId)
  const snapshot = view.snapshot
  const [localOpen, setLocalOpen] = React.useState(false)
  const closeRefused = React.useRef(false)

  // 阶段计数与输入框胶囊同源（runCounts 优先，旧快照按 tasks/members 精确派生）。
  const stage = currentRunStageInputOf(snapshot)
  const hasOpen = typeof props.openPanel === 'function'
  const hasClose = typeof props.closePanel === 'function'
  const canProbe = typeof props.isPanelOpen === 'function'

  // 每次渲染都问一次真实页签状态（很便宜：宿主侧是一次数组查找）。
  // 放在渲染期而不是 effect 里：effect 会晚一帧，用户会看到「已打开」闪一下。
  const probed = canProbe ? props.isPanelOpen!() : undefined
  // 宿主报了状态就完全听它的；没这个能力才退回本地态。
  // 「关不掉」时保持 true（closeRefused）—— 宁可真话「还没关上」，也不假装关上。
  const opened = probed ?? (closeRefused.current ? true : localOpen)

  const ui = headerButtonView({
    enabled: snapshot?.enabled === true,
    ...stage,
    opened,
    available: hasOpen,
    canClose: hasClose,
  })

  function dispatch(eventName: string): void {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
    window.dispatchEvent(new CustomEvent(eventName))
  }

  function onClick(): void {
    if (ui.action === 'open') {
      if (hasOpen && props.openPanel!() === true) {
        setLocalOpen(true)
        closeRefused.current = false
        return
      }
      // 回退：面板已挂载 → 自己切页；未挂载 → 事件无人接收（不发任何请求，不报错）。
      dispatch(OPEN_PANEL_EVENT)
      setLocalOpen(true)
      return
    }

    // action === 'close'
    if (hasClose && props.closePanel!() === true) {
      setLocalOpen(false)
      closeRefused.current = false
      return
    }
    // 三级回退都没关上：保持「已打开」的显示、把原因交给面板错误区（**不翻转** aria-pressed）。
    closeRefused.current = true
    dispatch(PANEL_CLOSE_EVENT)
  }

  return (
    <button
      type="button"
      data-auto-team-header-button
      data-pressed={opened ? 'true' : 'false'}
      data-action={ui.action}
      aria-pressed={opened}
      aria-label={ui.ariaLabel}
      title={ui.ariaLabel}
      onClick={onClick}
    >
      <span data-header-icon aria-hidden="true">
        ◧
      </span>
      <span data-header-label>{ui.label}</span>
      {ui.badge === '' ? null : <span data-header-badge>{ui.badge}</span>}
    </button>
  )
}

export default AutoTeamHeaderButton
