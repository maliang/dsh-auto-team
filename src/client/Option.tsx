/**
 * E1 `conversation.input.dock`：输入框内的「自动团队」胶囊选项（DESIGN §2.1，AC-12）。
 *
 * 职责边界（本文件只做三件事，别加第四件）：
 *   1. 取数：`usePanelState(sessionId)` —— 与右栏面板、会话头按钮**共用同一个 store**（单一数据源）；
 *   2. 贴 DOM：文案/aria **全部**来自 `ui.optionView`（渲染描述层），本组件不写任何中文状态
 *      （根 hook `data-auto-team-option` 与 `optionView().hook` 逐字相同，由
 *      `test/client-contract.test.ts` 的 AST 守卫比对，防两处漂移）；
 *   3. 点击只发 `act({type:'toggle'})`，**绝不隐式派发**（反面目标 1：打开开关不该自动起人）。
 *
 * busy 期间：`ui.state === 'busy'` → 文案逐字不变 + `aria-busy` + 右侧 12×12 旋转环（CSS），
 * 点击入口自己拦掉。**绝不做乐观切换** —— 等服务端快照回来再变态，
 * 否则「点了没反应/失败再变回来」是本项目最难解释的体验（AC-15）。
 */
import * as React from 'react'
import { useAutoTeamStyle } from './styles.ts'
import { sessionIdOf, usePanelState } from './state.ts'
import { feedbackOf, hintOf } from './viewmodel.ts'
import { optionView } from './ui.ts'

export interface OptionProps {
  sessionId?: string
  session?: { id?: string }
  [key: string]: unknown
}

export function AutoTeamOption(props: OptionProps): React.ReactElement {
  useAutoTeamStyle()
  const sessionId = sessionIdOf(props as Record<string, unknown>)
  const view = usePanelState(sessionId)
  const snapshot = view.snapshot
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [flash, setFlash] = React.useState(false)

  const tasks = snapshot?.tasks ?? []
  const done = tasks.filter((task) => task.status === 'done').length
  const enabled = snapshot?.enabled === true

  const ui = optionView({
    enabled,
    busy,
    planStatus: snapshot?.planStatus,
    done,
    total: tasks.length,
  })

  // 服务端确认的 300ms hit-flash（DESIGN §0.3）：只有「值与点击前不同」才闪，
  // 首次挂载不闪（否则打开页面就亮一下，像是自己点了）。
  const lastEnabled = React.useRef<boolean | undefined>(undefined)
  React.useEffect(() => {
    const previous = lastEnabled.current
    lastEnabled.current = enabled
    if (previous === undefined || previous === enabled) return
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), 300)
    return () => clearTimeout(timer)
  }, [enabled])

  async function toggle(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(undefined)
    const result = await view.act({ type: 'toggle', enabled: !enabled })
    setBusy(false)
    setError(hintOf(feedbackOf(result)))
  }

  return (
    <span
      data-auto-team-option
      data-state={ui.state}
      data-enabled={enabled ? 'true' : 'false'}
      data-flash={flash ? 'true' : 'false'}
      data-error-state={error !== undefined ? 'true' : 'false'}
      role="switch"
      tabIndex={0}
      aria-checked={ui.pressed}
      aria-label={ui.ariaLabel}
      aria-busy={busy ? 'true' : undefined}
      aria-disabled={busy ? 'true' : undefined}
      title={ui.ariaLabel}
      onClick={() => void toggle()}
      onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        void toggle()
      }}
    >
      <span data-option-dot aria-hidden="true" />
      <span data-option-label>{ui.label}</span>
      {busy ? <span data-option-spinner aria-hidden="true" /> : null}
      {error !== undefined ? (
        <span data-option-error role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}

export default AutoTeamOption
