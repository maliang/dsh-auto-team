/**
 * 任务流转图（r13 AC-6）：纯 SVG + div 自绘，零图形库。
 *
 * 布局：列 = 最长依赖深度，行 = 同列内计划顺序；节点 148×56，列步进 188、行步进 72。
 * 画布 300px 高、外层滚动 —— 图只回答「谁卡在谁后面」，不做缩放/拖拽平移（面板里
 * 的手势会和页面滚动打架）。
 *
 * 静态可判读（不是只靠颜色）：上游未完成的连线是**虚线**，节点第一行有状态点 + 状态文案，
 * 第二行是 token 与用时；第二行超过 128px 时整体 `ellipsis` 并在 `title` 里给全文 ——
 * 绝不让节点被内容撑宽而破坏列布局。
 */
import * as React from 'react'
import type { FlowView } from '../../shared/types.ts'
import { flowLayoutOf, statusBadge, tokenTitleOf } from '../viewmodel.ts'

export interface FlowGraphProps {
  flow: FlowView
  onSelectTask: (taskId: string) => void
}

export function FlowGraph(props: FlowGraphProps): React.ReactElement {
  const { flow, onSelectTask } = props
  const layout = flowLayoutOf(flow)
  const rawId = React.useId()
  const markerId = `auto-team-flow-arrow-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <section
      data-region="task-flow"
      aria-label={`任务流转图：${flow.nodes.length} 个任务、${flow.columns} 列`}
    >
      {flow.nodes.length === 0 ? (
        <p data-flow-empty>还没有任务可以画流转图</p>
      ) : (
        <>
          <div data-flow-canvas>
            <div
              data-flow-inner
              style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
            >
              <svg
                data-flow-edges
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                aria-hidden="true"
                focusable="false"
              >
                <defs>
                  <marker
                    id={markerId}
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path data-flow-arrow d="M 0 0 L 8 4 L 0 8 z" />
                  </marker>
                </defs>
                {layout.edges.map((edge) => (
                  <path
                    key={edge.key}
                    data-flow-edge
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
                    data-flow-column={node.column}
                    data-flow-row={node.row}
                    style={{ left: `${x}px`, top: `${y}px` }}
                    aria-label={cell.label}
                    title={cell.title}
                    onClick={() => onSelectTask(node.id)}
                  >
                    <span data-flow-line="title">
                      <span data-flow-id>{node.id}</span>
                      <span data-flow-dot data-tone={badge.tone} aria-hidden="true" />
                      <span data-flow-status>{badge.text}</span>
                    </span>
                    <span data-flow-line="meta">
                      <span data-cell="token" data-usage-source={node.usage.source} title={tokenTitleOf(node.usage)}>
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
          </div>
          <p data-flow-legend>
            <span data-legend-line="solid" aria-hidden="true" /> 上游已完成
            <span data-legend-line="dashed" aria-hidden="true" /> 上游未完成
          </p>
        </>
      )}
    </section>
  )
}

export default FlowGraph
