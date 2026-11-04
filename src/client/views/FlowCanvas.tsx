/**
 * 可平移的无限流转画布（r14 AC-4 / AC-5 / AC-22）。
 *
 * 结构：`[data-flow-canvas]`（固定视口，overflow:hidden、touch-action:none）
 *      → `[data-flow-viewport]`（可平移层，`transform: translate3d(x, y, 0)`）
 *        → edge SVG + 绝对定位节点（180×76）。
 *
 * 为什么拖动**不走 React state**：60 帧拖动如果每帧 setState，就是 60 次 re-render +
 * 重排，AC-22 的「平均帧间隔 ≤20ms」直接崩。这里 pointermove 只写
 * `viewport.style.transform`（rAF 合帧：一帧最多一次写），`pointerup` 才落 state/ref。
 *
 * 4px 阈值用**累计位移**（`Math.hypot`），不是单帧位移：单帧位移会让慢速拖动一帧一帧地
 * 触发拖动，尾随的 `click` 就把节点选中了。拖动结束后第一次 `click` 被一次性抑制
 * （`suppressClickRef`，并在 0ms 后自动清空，避免吞掉下一次真实点击）。
 *
 * 键盘（画布可聚焦）：方向键 ±24px、`Home`/`r`/`R` 复位；平移上限 ±20000px（防止把
 * 画布甩到永远找不回来的地方）。
 */
import * as React from 'react'
import type { FlowView } from '../../shared/types.ts'
import { flowLayoutOf, statusBadge } from '../viewmodel.ts'

export interface FlowCanvasProps {
  flow: FlowView
  onSelectTask: (taskId: string) => void
}

/** 平移上限（±）：与 DESIGN §2.4 一致，够远但不会迷失。 */
export const FLOW_PAN_LIMIT = 20000
/** 拖动判定阈值（累计位移，px）。 */
export const FLOW_DRAG_THRESHOLD = 4
/** 键盘单步（px）。 */
export const FLOW_KEY_STEP = 24
/** 复位动画时长（ms）—— 与 styles.ts 的 transition 一致。 */
const RESET_MS = 180

function clampPan(value: number): number {
  return Math.max(-FLOW_PAN_LIMIT, Math.min(FLOW_PAN_LIMIT, value))
}

export function FlowCanvas(props: FlowCanvasProps): React.ReactElement {
  const { flow, onSelectTask } = props
  const layout = React.useMemo(() => flowLayoutOf(flow), [flow])
  const markerId = `auto-team-flow-arrow-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const panRef = React.useRef({ x: 0, y: 0 })
  const frameRef = React.useRef<number | null>(null)
  const pendingRef = React.useRef<{ x: number; y: number } | null>(null)
  const dragRef = React.useRef<{
    pointerId: number
    startX: number
    startY: number
    baseX: number
    baseY: number
    moved: boolean
  } | null>(null)
  const suppressClickRef = React.useRef(false)
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)

  const paint = React.useCallback((x: number, y: number) => {
    const viewport = viewportRef.current
    if (viewport === null) return
    viewport.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }, [])

  /** rAF 合帧：同一帧内的多次 pointermove 只保留最后一次待写值。 */
  const schedulePaint = React.useCallback(
    (x: number, y: number) => {
      panRef.current = { x, y }
      if (typeof requestAnimationFrame !== 'function') {
        paint(x, y)
        return
      }
      pendingRef.current = { x, y }
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        const next = pendingRef.current
        pendingRef.current = null
        if (next !== null) paint(next.x, next.y)
      })
    },
    [paint],
  )

  const cancelFrame = React.useCallback(() => {
    if (frameRef.current === null) return
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  const resetView = React.useCallback(() => {
    cancelFrame()
    pendingRef.current = null
    panRef.current = { x: 0, y: 0 }
    setDragging(false)
    setResetting(true)
    paint(0, 0)
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current)
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null
      setResetting(false)
    }, RESET_MS)
  }, [cancelFrame, paint])

  React.useEffect(() => {
    return () => {
      cancelFrame()
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current)
    }
  }, [cancelFrame])

  const clearSuppressLater = () => {
    // `click` 在 pointerup 之后、同一个任务里同步派发；0ms 定时器在它之后才跑，
    // 所以既能抑制「拖动尾随的一次点击」，又不会吞掉下一次真实点击。
    setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target !== null && target.closest('[data-canvas-reset]') !== null) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: panRef.current.x,
      baseY: panRef.current.y,
      moved: false,
    }
    suppressClickRef.current = false
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < FLOW_DRAG_THRESHOLD) return
      drag.moved = true
      setDragging(true)
      setResetting(false)
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // 老浏览器/合成事件没有 pointer capture：不影响平移，只是移出画布后收不到 move。
      }
    }
    schedulePaint(clampPan(drag.baseX + dx), clampPan(drag.baseY + dy))
  }

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (!drag.moved) return
    suppressClickRef.current = true
    clearSuppressLater()
    setDragging(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // 同上：没捕获成功就不用释放。
    }
  }

  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { key } = event
    if (key === 'Home' || key === 'r' || key === 'R') {
      event.preventDefault()
      resetView()
      return
    }
    let dx = 0
    let dy = 0
    if (key === 'ArrowLeft') dx = -FLOW_KEY_STEP
    else if (key === 'ArrowRight') dx = FLOW_KEY_STEP
    else if (key === 'ArrowUp') dy = -FLOW_KEY_STEP
    else if (key === 'ArrowDown') dy = FLOW_KEY_STEP
    else return
    event.preventDefault()
    schedulePaint(clampPan(panRef.current.x + dx), clampPan(panRef.current.y + dy))
  }

  return (
    <section data-region="task-flow" aria-label="任务流转">
      {layout.nodes.length === 0 ? (
        <p data-flow-empty>计划里还没有任务，落盘后这里会画出依赖关系</p>
      ) : null}
      <div
        data-flow-canvas
        data-dragging={dragging ? 'true' : 'false'}
        data-resetting={resetting ? 'true' : 'false'}
        tabIndex={0}
        role="group"
        aria-label="任务流转图，可拖动平移，方向键移动，R 键重置"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        onKeyDown={onKeyDown}
      >
        <div
          data-flow-viewport
          ref={viewportRef}
          style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
        >
          <svg
            data-flow-edges
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
          >
            <defs>
              <marker
                id={markerId}
                data-flow-arrow
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" />
              </marker>
            </defs>
            {layout.edges.map((edge) => (
              <path
                key={edge.key}
                data-flow-edge={edge.key}
                data-upstream-done={edge.upstreamDone ? 'true' : 'false'}
                d={edge.d}
                fill="none"
                markerEnd={`url(#${markerId})`}
              />
            ))}
          </svg>
          {layout.nodes.map(({ node, cell, x, y }) => {
            const badge = statusBadge(node.status)
            return (
              <button
                key={node.id}
                type="button"
                data-flow-node={node.id}
                data-status={node.status}
                data-flow-column={String(node.column)}
                data-flow-row={String(node.row)}
                style={{ left: `${x}px`, top: `${y}px` }}
                title={cell.title}
                aria-label={cell.label}
                onClick={() => onSelectTask(node.id)}
              >
                <span data-flow-line="title">
                  <span data-flow-dot data-tone={badge.tone} aria-hidden="true" />
                  <span data-flow-node-role title={cell.roleText}>
                    {cell.roleText}
                  </span>
                  <span data-flow-status>{badge.text}</span>
                </span>
                <span data-flow-line="task">
                  <span data-flow-node-title title={node.title}>
                    {cell.taskTitle}
                  </span>
                </span>
                <span data-flow-line="meta">
                  <span data-cell="token" data-usage-source={node.usage.source}>
                    {cell.tokenText}
                  </span>
                  <span data-flow-sep aria-hidden="true">
                    ·
                  </span>
                  <span data-cell="duration" data-duration-state={node.duration.state}>
                    {cell.durationText}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          data-canvas-reset
          aria-label="重置画布视图"
          onClick={resetView}
        >
          重置视图
        </button>
        <p data-flow-legend>
          <span data-legend-line="solid" aria-hidden="true" />
          实线 = 上游已完成
          <span data-legend-line="dashed" aria-hidden="true" />
          虚线 = 上游未完成
        </p>
      </div>
    </section>
  )
}

export default FlowCanvas
