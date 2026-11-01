/**
 * E2 `conversation.session.header.actions`：会话头「自动团队」按钮（DESIGN §2.2，AC-13）。
 *
 * 点击语义只有一条：打开右栏面板。
 *   ① 宿主提供 `sidebarRight.openTab` → 直接开（`openPanel()` 返回 true，由 `createOpenPanel` 生成）；
 *   ② 服务缺失/尚未就绪 → `window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT))`，
 *      由已挂载的面板自己切页（面板没挂载时无人接收，属正常，不报错）。
 * 两个分支都要覆盖：只做 ① 会在服务晚到的真机上「点了没反应」，只做 ② 会在面板未打开时
 * 派发一个没人听的事件 —— r1~r6 的 Toggle 就是后者。
 *
 * 文案/角标/aria 全部来自 `ui.headerButtonView`；本组件不写中文状态。
 */
import * as React from 'react'
import { useAutoTeamStyle } from './styles.ts'
import { sessionIdOf, usePanelState } from './state.ts'
import { headerButtonView } from './ui.ts'

/** 面板未就绪时的回退通道（`Panel.tsx` 订阅它切到「计划」页）。 */
export const OPEN_PANEL_EVENT = 'dsh-auto-team:open-panel'

export interface HeaderButtonProps {
  sessionId?: string
  session?: { id?: string }
  /** 宿主原生「打开页签」动作（由 `slots.createOpenPanel` 下发给本座位）。 */
  openPanel?: () => boolean
  [key: string]: unknown
}

export function AutoTeamHeaderButton(props: HeaderButtonProps): React.ReactElement {
  useAutoTeamStyle()
  const sessionId = sessionIdOf(props as Record<string, unknown>)
  const view = usePanelState(sessionId)
  const snapshot = view.snapshot
  const [opened, setOpened] = React.useState(false)

  const tasks = snapshot?.tasks ?? []
  const done = tasks.filter((task) => task.status === 'done').length
  const ui = headerButtonView({
    enabled: snapshot?.enabled === true,
    planStatus: snapshot?.planStatus,
    done,
    total: tasks.length,
  })

  function open(): void {
    const native = typeof props.openPanel === 'function' ? props.openPanel : undefined
    if (native !== undefined && native() === true) {
      setOpened(true)
      return
    }
    // 回退：面板已挂载 → 自己切页；未挂载 → 事件无人接收（不发任何请求，不报错）。
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT))
    }
    setOpened(true)
  }

  return (
    <button
      type="button"
      data-auto-team-header-button
      data-pressed={opened ? 'true' : 'false'}
      aria-pressed={opened}
      aria-label={ui.ariaLabel}
      title={ui.ariaLabel}
      onClick={open}
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
