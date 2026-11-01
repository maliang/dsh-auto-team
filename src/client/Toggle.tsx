/**
 * 输入框下方 32px 开关行（conversation.composer.dock）。
 *
 * 设计约束（DESIGN §2 / AC-12）：
 *  - 这是**开关状态的唯一来源**，面板只展示与提供入口，不再各自存一份 enabled；
 *  - 开关只改「启用/停用」，**绝不派发**（反目标 1：点开关不等于把任务扔出去）；
 *  - 文案来自 `viewmodel.capsuleOf`（单向：viewmodel 出文案，本组件只渲染）；
 *  - 最坏文案（`计划就绪 · 5 任务`）306px ≤ 320px；宽度 <360px 时隐藏文字（见 styles.ts）。
 */
import * as React from 'react'
import { useAutoTeamStyle } from './styles.ts'
import { sessionIdOf, usePanelState } from './state.ts'
import { capsuleOf, feedbackOf, hintOf } from './viewmodel.ts'
import type { PanelAction } from '../shared/types.ts'

export interface ToggleProps {
  sessionId?: string
  session?: { id?: string }
  /** 宿主原生「打开本插件页签」动作（`sidebarRight.openTab`，由 slots.ts 的 inject 下发）。 */
  openPanel?: () => boolean
  [key: string]: unknown
}

/** 面板入口事件：宿主无 `sidebarRight` 服务时的**回退**（面板已挂载则切到「计划」页）。 */
export const OPEN_PANEL_EVENT = 'dsh-auto-team:open-panel'

export function Toggle(props: ToggleProps): React.ReactElement {
  useAutoTeamStyle()
  const sessionId = sessionIdOf(props as Record<string, unknown>)
  const view = usePanelState(sessionId)
  const snapshot = view.snapshot ?? undefined
  const enabled = snapshot?.enabled === true
  const capsule = capsuleOf(enabled, snapshot)

  const [busy, setBusy] = React.useState(false)
  const [hint, setHint] = React.useState<string | undefined>(undefined)

  async function toggle(): Promise<void> {
    setBusy(true)
    setHint(undefined)
    // 注意：这里只发 toggle。派发是面板里「开始派发」的专属动作（AC-30）。
    try {
      const result = await view.act({ type: 'toggle', enabled: !enabled } as PanelAction)
      setHint(hintOf(feedbackOf(result)))
    } catch (err) {
      // act 本身抛错（宿主 route 未注册等）也必须说出来，否则开关看起来"点了没反应"
      setHint(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function openPanel(): void {
    // 优先走宿主原生路径 `sidebarRight.openTab(kind)`（页面型页签的唯一打开方式，QA-02 修复）；
    // 拿不到服务时才回退到窗口事件（旧行为：没人监听时按钮等于无效）。
    const viaHost = typeof props.openPanel === 'function' ? props.openPanel : undefined
    if (viaHost !== undefined && viaHost() === true) return
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT))
    }
  }

  const error = view.error ?? undefined
  const disabled = busy || (view.loading && snapshot === undefined)

  return (
    <div data-dsh-auto-team-toggle data-enabled={enabled ? 'true' : 'false'}>
      <span data-toggle-switch>
        <button
          type="button"
          role="switch"
          onClick={() => void toggle()}
          disabled={disabled}
          data-toggle-control
          aria-checked={enabled}
          aria-label={enabled ? '关闭自动团队' : '启用自动团队'}
          title={enabled ? '关闭自动团队（只改开关，不会派发任务）' : '启用自动团队'}
        >
          <span data-toggle-track aria-hidden="true">
            <span data-toggle-knob />
          </span>
        </button>
        <span data-toggle-label>自动团队</span>
      </span>

      <span data-toggle-capsule data-tone={capsule.tone} aria-live="polite">
        {capsule.text}
      </span>

      <button type="button" onClick={openPanel} data-toggle-open-panel>
        面板
      </button>

      {error !== undefined ? (
        <span data-error role="alert">
          {error}
        </span>
      ) : null}
      {hint !== undefined ? (
        <span data-hint role="status">
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export default Toggle
