/**
 * 右侧运行抽屉（r14 AC-16 / AC-17）——**只负责壳**：遮罩、dialog 语义、Esc/遮罩/按钮三条
 * 关闭路径、焦点陷阱与进出场动画；内容由调用方（`LibraryPage`）组装。
 *
 * 为什么把壳单独成件：抽屉必须活在 `[data-library-shell]` 内（absolute 定位），而「同一时刻
 * 最多一个」由调用方的 `openRunId` 单值决定；把焦点逻辑收在壳里，页面层就只剩状态与复原。
 *
 * 焦点：打开时记住入口由调用方做（页面层知道触发行），壳只负责「进入后焦点落在第一个可聚焦
 * 元素」与 Tab 循环；关闭动画结束后才调用 `onClose`，页面层在那一刻做 scrollTop/焦点复原。
 *
 * 动画：进入走 styles.ts 的 `auto-team-drawer-in`（160ms）；退出按要求 120ms——用内联
 * transition 反向位移后卸载，`prefers-reduced-motion` 下直接关闭、不等待。
 */
import * as React from 'react'

export interface RunDrawerProps {
  open: boolean
  title: string
  subtitle: string
  onClose: () => void
  children: React.ReactNode
  /** 抽屉对应的 runId（`[data-drawer-run]` 钩子；AC-15/16 的取证抓手）。 */
  runId?: string
}

/** 退出动画时长（DESIGN §0.4：进入 160ms / 退出 120ms）。 */
const EXIT_MS = 120

/** 可聚焦元素（与宿主面板的可见性无关；隐藏元素在 querySelectorAll 里会被过滤掉）。 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function focusablesOf(root: HTMLElement): HTMLElement[] {
  const list = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
  // `offsetParent === null` 会漏掉 position:fixed 元素；抽屉内元素都是普通流布局，安全。
  return list.filter((node) => node.offsetParent !== null || node === document.activeElement)
}

export function RunDrawer(props: RunDrawerProps): React.ReactElement | null {
  const { open, title, subtitle, onClose, children, runId } = props
  const titleId = React.useId()
  const drawerRef = React.useRef<HTMLDivElement | null>(null)
  const closingRef = React.useRef(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCloseRef = React.useRef(onClose)
  const [closing, setClosing] = React.useState(false)

  // 页面层每次轮询都会给一个新函数；requestClose 必须稳定，否则焦点 effect 会在用户打字时
  // 反复重跑并把焦点抢回关闭按钮（快照 2s 一刷，用户根本没法 Tab）。
  onCloseRef.current = onClose

  // 抽屉是常驻组件、靠 open 切换显隐：关闭后必须把内部状态清干净，否则下一次打开会带着
  // closing=true/closingRef=true 进场——视觉上是透明的，且 close 被守卫拦住再也关不掉。
  React.useEffect(() => {
    if (open) return
    closingRef.current = false
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setClosing(false)
  }, [open])

  const requestClose = React.useCallback(() => {
    if (!open || closingRef.current) return
    closingRef.current = true
    if (prefersReducedMotion()) {
      onCloseRef.current()
      return
    }
    setClosing(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onCloseRef.current()
    }, EXIT_MS)
  }, [open])

  // 打开后焦点进入抽屉；Esc 关闭；Tab/Shift+Tab 在抽屉内循环（焦点陷阱）。
  React.useEffect(() => {
    if (!open) return undefined
    const node = drawerRef.current
    if (node !== null) {
      const first = focusablesOf(node)[0]
      if (first !== undefined) first.focus()
      else node.focus()
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const root = drawerRef.current
      if (root === null) return
      const list = focusablesOf(root)
      if (list.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || !root.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, requestClose])

  // 卸载时清掉退出计时器（页面切走/会话关闭时不该留一个 setTimeout 摸已卸载的组件）。
  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  if (!open) return null

  const closingStyle: React.CSSProperties | undefined = closing
    ? { opacity: 0, transform: 'translateX(16px)', transition: 'opacity 120ms ease, transform 120ms ease' }
    : undefined
  const maskStyle: React.CSSProperties | undefined = closing
    ? { opacity: 0, transition: 'opacity 120ms ease' }
    : undefined

  return (
    <>
      <div data-run-drawer-mask style={maskStyle} onClick={requestClose} aria-hidden="true" />
      <div
        ref={drawerRef}
        data-run-drawer
        data-drawer-run={runId}
        data-closing={closing ? 'true' : 'false'}
        style={closingStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header data-drawer-head>
          <div data-drawer-titles>
            <h2 data-drawer-title id={titleId} title={title}>
              {title}
            </h2>
            <span data-drawer-subtitle title={subtitle}>
              {subtitle}
            </span>
          </div>
          <button type="button" data-drawer-close aria-label="关闭详情" title="关闭详情" onClick={requestClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div data-drawer-body>{children}</div>
      </div>
    </>
  )
}

export default RunDrawer
