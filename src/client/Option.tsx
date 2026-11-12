/**
 * E1 `conversation.input.left`：输入框**左侧**的「自动团队」胶囊选项（DESIGN §2.1，AC-1~AC-7）。
 *
 * 职责边界（本文件只做三件事，别加第四件）：
 *   1. 取数：`usePanelState(sessionId)` —— 与右栏面板、会话头按钮**共用同一个 store**（单一数据源）；
 *   2. 贴 DOM：文案/aria **全部**来自 `ui.optionView`（渲染描述层），本组件不写任何中文状态
 *      （根 hook `data-auto-team-option` 与 `optionView().hook` 逐字相同，由
 *      `test/client-contract.test.ts` 的 AST 守卫比对，防两处漂移）；
 *   3. 点击只发 `act({type:'toggle'})`，**绝不隐式派发**（反面目标 1：打开开关不该自动起人）。
 *
 * r10 的两条修订（AC-5 / AC-6）：
 *   - **零红字**：失败不渲染任何文本节点（旧版右侧那段红字节点已整段删除，
 *     `role="alert"` 也一并去掉 —— 红字会让输入框工具条抖宽，且「操作失败」这种可恢复
 *     异常用红违反 DESIGN §0.1-3）。失败只体现在**琥珀实心状态点 + 琥珀描边**，
 *     原因进 `title` / `aria-label`，全文留在面板的 `[data-error]` 里。
 *   - **可见文案逐字「自动团队」**：状态语义全部进 `aria-label`，界面不再随状态变宽。
 *
 * busy 期间：`ui.state === 'busy'` → 文案逐字不变 + `aria-busy` + 12×12 旋转环（CSS），
 * 点击入口自己拦掉。**绝不做乐观切换** —— 等服务端快照回来再变态，
 * 否则「点了没反应/失败再变回来」是本项目最难解释的体验。
 */
import * as React from 'react'
import { useAutoTeamStyle } from './styles.ts'
import { sessionIdOf, usePanelState } from './state.ts'
import { currentRunStageInputOf, feedbackOf, hintOf } from './viewmodel.ts'
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

  const enabled = snapshot?.enabled === true
  // 状态文案的唯一来源是 viewmodel 的阶段判定：计数优先用宿主投影 runCounts，
  // 旧快照则从 tasks/members 精确派生（缺什么就不传什么，绝不补 0）。
  const stage = currentRunStageInputOf(snapshot)

  const ui = optionView({
    enabled,
    busy,
    ...stage,
    failure: error,
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
    // 失败原因只作为 title/aria-label 的原材料（`optionView` 加「操作失败：」前缀）；
    // 成功时 `hintOf` 返回心跳 notice，那是「已启用」之类的好消息 —— 不当失败处理。
    const feedback = feedbackOf(result)
    setError(feedback.ok ? undefined : hintOf(feedback))
  }

  return (
    <span
      data-auto-team-option
      data-state={ui.state}
      data-enabled={enabled ? 'true' : 'false'}
      data-flash={flash ? 'true' : 'false'}
      data-error-state={ui.failure === undefined ? 'false' : 'true'}
      data-dot-tone={ui.dotTone}
      role="switch"
      tabIndex={0}
      aria-checked={ui.pressed}
      aria-label={ui.ariaLabel}
      aria-busy={busy ? 'true' : undefined}
      aria-disabled={busy ? 'true' : undefined}
      title={ui.failure ?? ui.ariaLabel}
      onClick={() => void toggle()}
      onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        void toggle()
      }}
    >
      <span data-option-dot data-tone={ui.dotTone} aria-hidden="true" />
      <span data-option-label>{ui.label}</span>
      {busy ? <span data-option-spinner aria-hidden="true" /> : null}
    </span>
  )
}

export default AutoTeamOption
