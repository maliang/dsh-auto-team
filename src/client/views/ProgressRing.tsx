/**
 * 进度环（r14 AC-10 / AC-11 / AC-22）。
 *
 * 几何（DESIGN §2.2）：64×64 视口、圆心 (32,32)、r=28、stroke=6、`rotate(-90)` 让弧从
 * 12 点方向开始；弧长 `2πr ≈ 175.93`，`dashoffset = C × (1 − done/total)` 由
 * `viewModel.taskOverviewOf` 一次算好（组件**不做除法**，避免两处舍入给出不同进度）。
 *
 * 圆心文字强制 `done/total`（0 任务显示 `0/0`，不写 NaN、不写百分比）：数字是最需要
 * 精确的东西，宁可换字号也不截断。`≤5` 字 13px、`≥6` 字 11px（`999/999` 的半对角
 * 22.1 < 内圆半径 25，放得下）。
 *
 * 为什么单列一个组件：右栏任务总览与项目库抽屉复用同一个环 —— 抽屉里再画一个「差不多」的
 * 环，两个数字迟早不一致（r13 的教训）。
 */
import * as React from 'react'
import { PROGRESS_RING_CIRCUMFERENCE, PROGRESS_RING_RADIUS, PROGRESS_RING_STROKE } from '../viewmodel.ts'

export interface ProgressRingProps {
  done: number
  total: number
  /** 宽度/高度（viewBox 固定 64×64，缩放由 CSS 负责）；缺省 64。 */
  size?: number
  /**
   * 预计算的 `stroke-dashoffset`（`taskOverviewOf` 的返回值）。
   * 缺省时按 `done/total` 现算 —— 只给独立使用（无总览上下文）的调用方兜底。
   */
  dashOffset?: number
}

export function ProgressRing(props: ProgressRingProps): React.ReactElement {
  const { done, total, size = 64 } = props
  const safeTotal = Number.isFinite(total) ? total : 0
  const safeDone = Number.isFinite(done) ? done : 0
  const ratio = safeTotal === 0 ? 0 : Math.min(1, Math.max(0, safeDone / safeTotal))
  const dashOffset = props.dashOffset ?? PROGRESS_RING_CIRCUMFERENCE * (1 - ratio)
  const text = `${safeDone}/${safeTotal}`
  // 两档字号：用属性交给 CSS，避免在 JSX 里写内联 font-size（设计 token 只允许 font 简写）。
  const textTier = text.length <= 5 ? 'short' : 'long'
  return (
    <svg
      data-progress-ring
      data-done={String(safeDone)}
      data-total={String(safeTotal)}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={`已完成 ${safeDone} / 共 ${safeTotal}`}
    >
      <circle
        data-ring-track
        cx="32"
        cy="32"
        r={PROGRESS_RING_RADIUS}
        fill="none"
        strokeWidth={PROGRESS_RING_STROKE}
      />
      <circle
        data-ring-arc
        data-complete={safeTotal > 0 && safeDone >= safeTotal ? 'true' : 'false'}
        cx="32"
        cy="32"
        r={PROGRESS_RING_RADIUS}
        fill="none"
        strokeWidth={PROGRESS_RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={PROGRESS_RING_CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
        transform="rotate(-90 32 32)"
      />
      <text data-progress-text data-text-tier={textTier} x="32" y="32" textAnchor="middle" dominantBaseline="central">
        {text}
      </text>
    </svg>
  )
}

export default ProgressRing
