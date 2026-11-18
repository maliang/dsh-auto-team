/**
 * r52 · 流程图排版与降噪回归。
 *
 * ① 行序：同列 5 个任务按上游平均行号（barycenter）重排，交叉数下降且两次派生一致；
 * ② 同列边：从列右侧固定 lane 回绕，路径不进入同列任何节点的内部；
 * ③ 跨列边：同一空隙的多条边分配不同中道 lane，间距 ≥6px；
 * ④ 环依赖/缺失端点/空计划：不抛异常，路径与坐标不得出现 NaN/Infinity；
 * ⑤ 悬停降噪：默认 0.45，聚焦时相关边 1、其它边 0.12，组件补 data-from/data-to。
 *
 * 组件层不 import FlowCanvas.tsx：node --test 不转 JSX，沿用仓库既有做法，
 * 用源码钩子锁住 `data-edge-focus` 与悬停/聚焦事件契约。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { AUTO_TEAM_CSS } from '../src/client/styles.ts'
import {
  FLOW_COLUMN_STEP,
  FLOW_EDGE_LANE_GAP,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH,
  FLOW_PADDING,
  FLOW_WRAP_LANE_OFFSET,
  flowLayoutOf,
} from '../src/client/viewmodel.ts'
import type { FlowEdgeView, FlowNodeView, FlowView, TaskStatus } from '../src/shared/types.ts'

/* ────────────────────────── 夹具与几何工具 ────────────────────────── */

function nodeOf(id: string, roleId: 'dev' | 'qa', status: TaskStatus = 'done'): FlowNodeView {
  return {
    id,
    title: `任务 ${id}`,
    status,
    column: 9, // 旧依赖深度：布局必须忽略它
    row: 9,
    usage: { source: 'provider', tokens: { total: 0 } },
    duration: { text: '—', state: 'done' },
    roleId,
    roleName: roleId === 'dev' ? '开发' : '测试',
  }
}

function flowOf(nodes: FlowNodeView[], edges: FlowEdgeView[] = []): FlowView {
  return { nodes, edges, columns: 1, rows: 1 }
}

interface Point {
  x: number
  y: number
}

/** 解析 `M/L/Q` 正交圆角路径；Q 段同时收控制点与终点，几何断言够用。 */
function pointsOf(d: string): Point[] {
  const points: Point[] = []
  const re = /([MLQ])([^MLQ]*)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(d)) !== null) {
    const nums = match[2]!
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
    if (match[1] === 'Q') {
      points.push({ x: nums[0]!, y: nums[1]! })
      points.push({ x: nums[2]!, y: nums[3]! })
    } else {
      points.push({ x: nums[0]!, y: nums[1]! })
    }
  }
  return points
}

/** 第一条竖移段的 x（没有竖移返回 null）；同列回绕与跨列中道都用它。 */
function verticalXOf(d: string): number | null {
  const points = pointsOf(d)
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!
    const cur = points[i]!
    if (prev.x === cur.x && prev.y !== cur.y) return cur.x
  }
  return null
}

/** 轴对齐路径段是否与节点内部相交（端点在节点右边界上，不算内部）。 */
function segmentHitsNode(a: Point, b: Point, node: { x: number; y: number }): boolean {
  const left = node.x
  const right = node.x + FLOW_NODE_WIDTH
  const top = node.y
  const bottom = node.y + FLOW_NODE_HEIGHT
  return (
    Math.max(a.x, b.x) > left &&
    Math.min(a.x, b.x) < right &&
    Math.max(a.y, b.y) > top &&
    Math.min(a.y, b.y) < bottom
  )
}

/** 计划顺序下的列内基准行号（与实现的 baseRowOf 同口径，按角色分组）。 */
function planRowsOf(flow: FlowView): Map<string, number> {
  const cursors = new Map<string, number>()
  const rows = new Map<string, number>()
  for (const node of flow.nodes) {
    const key = node.roleId ?? node.roleName ?? ''
    const row = cursors.get(key) ?? 0
    cursors.set(key, row + 1)
    rows.set(node.id, row)
  }
  return rows
}

function layoutRowsOf(layout: ReturnType<typeof flowLayoutOf>): Map<string, number> {
  return new Map(layout.nodes.map((entry) => [entry.node.id, entry.row]))
}

/**
 * 分层交叉数：取两条边的上下游行号，若上下游的相对顺序相反则记一次交叉。
 * 这是相邻列之间最经典的行序指标，barycenter 的作用就是压低它。
 */
function crossingCount(rows: Map<string, number>, edges: readonly FlowEdgeView[]): number {
  const pairs: { src: number; dst: number }[] = []
  for (const edge of edges) {
    const src = rows.get(edge.from)
    const dst = rows.get(edge.to)
    if (src === undefined || dst === undefined) continue
    pairs.push({ src, dst })
  }
  let count = 0
  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = i + 1; j < pairs.length; j += 1) {
      const a = pairs[i]!
      const b = pairs[j]!
      if ((a.src - b.src) * (a.dst - b.dst) < 0) count += 1
    }
  }
  return count
}

/* ────────────────────────── ① 行序 ────────────────────────── */

test('r52①：同列 5 个任务按上游平均行号重排，交叉数下降且两次派生一致', () => {
  const upstream = [nodeOf('u0', 'dev'), nodeOf('u1', 'dev'), nodeOf('u2', 'dev')]
  const downstream = [
    nodeOf('d1', 'qa'),
    nodeOf('d2', 'qa'),
    nodeOf('d3', 'qa'),
    nodeOf('d4', 'qa'),
    nodeOf('d5', 'qa'),
  ]
  // 5 个同列（qa）任务的上游分别落在 dev 列第 1/0/2/1/2 行。
  const edges: FlowEdgeView[] = [
    { from: 'u1', to: 'd1', upstreamDone: true },
    { from: 'u0', to: 'd2', upstreamDone: true },
    { from: 'u2', to: 'd3', upstreamDone: true },
    { from: 'u1', to: 'd4', upstreamDone: false },
    { from: 'u2', to: 'd5', upstreamDone: false },
  ]
  const flow = flowOf([...upstream, ...downstream], edges)

  const before = crossingCount(planRowsOf(flow), edges)
  const layout = flowLayoutOf(flow)
  const afterRows = layoutRowsOf(layout)
  const after = crossingCount(afterRows, edges)

  assert.equal(new Set(downstream.map((node) => afterRows.get(node.id))).size, 5, '5 个下游各占一行')
  assert.ok(before > 0, `夹具在计划顺序下本就应有交叉（实际 ${before}）`)
  assert.ok(after < before, `重排后交叉数必须下降：${before} → ${after}`)
  assert.equal(after, 0, `这组夹具重排后应无逆序（实际 ${after}）`)
  // 平局按计划下标：d1 与 d4 的上游平均行号同为 1，d1 必须仍在前。
  assert.ok(afterRows.get('d1')! < afterRows.get('d4')!, '同平均行号时按计划下标稳定排序')
  // 无上游的源列保持计划顺序。
  assert.deepEqual(upstream.map((node) => afterRows.get(node.id)), [0, 1, 2])

  // 确定性：同一份快照的结构化克隆再派生一次，整份布局深度相等。
  const clone = JSON.parse(JSON.stringify(flow)) as FlowView
  assert.deepEqual(flowLayoutOf(clone), layout)
})

/* ────────────────────────── ② 同列回绕 ────────────────────────── */

test('r52②：同列边从列右侧 lane 回绕，路径不进入同列任何节点内部', () => {
  const flow = flowOf(
    [nodeOf('t1', 'qa'), nodeOf('t2', 'qa'), nodeOf('t3', 'qa'), nodeOf('t4', 'qa')],
    [
      { from: 't1', to: 't3', upstreamDone: true },
      { from: 't1', to: 't4', upstreamDone: false },
    ],
  )
  const layout = flowLayoutOf(flow)
  const byId = new Map(layout.nodes.map((entry) => [entry.node.id, entry]))
  const t1 = byId.get('t1')!
  const t3 = byId.get('t3')!
  const t4 = byId.get('t4')!
  const columnRight = t1.x + FLOW_NODE_WIDTH

  assert.ok(t3.row > t1.row && t4.row > t3.row, '夹具必须让 t3 夹在 t1→t4 之间')
  const edge = layout.edges.find((item) => item.key === 't1->t4')
  assert.ok(edge !== undefined, 't1→t4 同列边必须存在')

  const points = pointsOf(edge.d)
  assert.deepEqual(points[0], { x: columnRight, y: t1.y + FLOW_NODE_HEIGHT / 2 }, '从源节点右边出')
  assert.deepEqual(
    points[points.length - 1],
    { x: columnRight, y: t4.y + FLOW_NODE_HEIGHT / 2 },
    '从目标节点右边入',
  )
  for (const point of points) {
    assert.ok(point.x >= columnRight, `路径不得回到节点列内：x=${point.x}`)
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), '坐标必须有限')
  }
  assert.equal(verticalXOf(edge.d), columnRight + FLOW_WRAP_LANE_OFFSET, '竖移必须落在列右侧固定 lane')

  for (let i = 1; i < points.length; i += 1) {
    for (const entry of layout.nodes) {
      assert.equal(
        segmentHitsNode(points[i - 1]!, points[i]!, entry),
        false,
        `t1→t4 的第 ${i} 段不得穿过 ${entry.node.id} 的节点内部`,
      )
    }
  }
  assert.equal(/NaN|Infinity/.test(edge.d), false)
})

/* ────────────────────────── ③ 跨列 lane ────────────────────────── */

test('r52③：同一空隙的多条跨列边中道互不相同，间距 ≥6px', () => {
  const flow = flowOf(
    [
      nodeOf('s0', 'dev'),
      nodeOf('s1', 'dev'),
      nodeOf('s2', 'dev'),
      nodeOf('t0', 'qa'),
      nodeOf('t1', 'qa'),
      nodeOf('t2', 'qa'),
    ],
    [
      { from: 's0', to: 't2', upstreamDone: true },
      { from: 's1', to: 't2', upstreamDone: false },
      { from: 's2', to: 't2', upstreamDone: false },
    ],
  )
  const layout = flowLayoutOf(flow)
  const lanes = layout.edges
    .map((edge) => verticalXOf(edge.d))
    .filter((lane): lane is number => lane !== null)
  assert.equal(lanes.length, 2, 's0→t2 与 s1→t2 需要竖移，s2→t2 同排不占 lane')
  assert.equal(new Set(lanes).size, 2, `多条中道必须互不相同：${lanes}`)

  const sorted = [...lanes].sort((a, b) => a - b)
  const columnRight = FLOW_PADDING + FLOW_NODE_WIDTH
  const nextColumnLeft = FLOW_PADDING + FLOW_COLUMN_STEP
  for (const lane of sorted) {
    assert.ok(lane > columnRight && lane < nextColumnLeft, `lane 必须落在列间空隙：${lane}`)
  }
  assert.ok(
    sorted[1]! - sorted[0]! >= FLOW_EDGE_LANE_GAP,
    `相邻 lane 间距必须 ≥${FLOW_EDGE_LANE_GAP}px，实际 ${sorted[1]! - sorted[0]!}`,
  )
  for (const edge of layout.edges) assert.equal(/NaN|Infinity/.test(edge.d), false)
})

/* ────────────────────────── ④ 异常输入 ────────────────────────── */

test('r52④：环依赖/缺失端点/空计划不抛异常，路径不得出现 NaN/Infinity', () => {
  const cycle = flowOf(
    [nodeOf('c1', 'qa'), nodeOf('c2', 'qa')],
    [
      { from: 'c1', to: 'c2', upstreamDone: true },
      { from: 'c2', to: 'c1', upstreamDone: false },
      { from: 'c1', to: 'ghost', upstreamDone: false },
      { from: 'ghost', to: 'c2', upstreamDone: true },
    ],
  )
  const layout = flowLayoutOf(cycle)
  const keys = layout.edges.map((edge) => edge.key)
  assert.equal(keys.includes('c1->ghost'), false, '缺失终点的边跳过')
  assert.equal(keys.includes('ghost->c2'), false, '缺失起点的边跳过')
  for (const edge of layout.edges) {
    assert.equal(/NaN|Infinity/.test(edge.d), false, `${edge.key} 不得含 NaN/Infinity`)
    for (const point of pointsOf(edge.d)) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${edge.key} 坐标必须有限`)
    }
  }

  const empty = flowLayoutOf(flowOf([]))
  assert.deepEqual(empty.nodes, [])
  assert.deepEqual(empty.edges, [])
  assert.deepEqual(empty.stages, [])
  assert.equal(empty.width, FLOW_PADDING * 2)
  assert.equal(empty.height, FLOW_PADDING * 2)
  assert.ok(Number.isFinite(empty.width) && Number.isFinite(empty.height))
})

/* ────────────────────────── ⑤ 悬停降噪 ────────────────────────── */

/** 去掉 CSS 注释再找规则：注释会夹在 `;` 与属性名之间，让声明解析漏项。 */
const CSS = AUTO_TEAM_CSS.replace(/\/\*[\s\S]*?\*\//g, '')

function ruleBlock(selector: string): string {
  const at = CSS.indexOf(selector)
  assert.notEqual(at, -1, `缺少样式规则：${selector}`)
  const open = CSS.indexOf('{', at)
  const close = CSS.indexOf('}', open)
  assert.ok(open > at && close > open, `样式规则不完整：${selector}`)
  return CSS.slice(open + 1, close)
}

function decl(block: string, prop: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(block)
  return match === null ? null : match[1]!.trim()
}

function effectiveOpacity(block: string): number {
  return Number(decl(block, 'stroke-opacity') ?? 1) * Number(decl(block, 'opacity') ?? 1)
}

test('r52⑤：边默认 0.45、聚焦相关边 1、其余 0.12，组件补 data-from/data-to', () => {
  const base = ruleBlock('[data-region="task-flow"] [data-flow-edge]')
  const off = ruleBlock('[data-flow-edge][data-edge-focus="off"]')
  const on = ruleBlock('[data-flow-edge][data-edge-focus="on"]')

  assert.ok(Math.abs(effectiveOpacity(base) - 0.45) < 1e-9, `默认边不透明度应为 0.45，实际 ${effectiveOpacity(base)}`)
  assert.equal(decl(base, 'stroke-width'), '1', '默认边宽 1px')
  assert.ok(Math.abs(effectiveOpacity(off) - 0.12) < 1e-9, `非聚焦边不透明度应为 0.12，实际 ${effectiveOpacity(off)}`)
  assert.equal(decl(off, 'stroke-width'), '1', '非聚焦边仍细 1px')
  assert.ok(Math.abs(effectiveOpacity(on) - 1) < 1e-9, `聚焦相关边不透明度应为 1，实际 ${effectiveOpacity(on)}`)
  assert.equal(decl(on, 'stroke-width'), '1.75', '聚焦相关边加粗到 1.75')

  const source = readFileSync(new URL('../src/client/views/FlowCanvas.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.match(source, /export function edgeEndpointsOf\(/)
  assert.match(source, /key\.indexOf\('->'\)/)
  assert.match(source, /data-from=\{ends\.from\}/)
  assert.match(source, /data-to=\{ends\.to\}/)
  assert.match(source, /data-edge-focus=\{focusNodeId === null \? undefined : related \? 'on' : 'off'\}/)
  assert.match(source, /ends\.from === focusNodeId \|\| ends\.to === focusNodeId/)
  assert.match(source, /onPointerEnter=\{\(\) => setHoverNodeId\(node\.id\)\}/)
  assert.match(source, /onFocus=\{\(\) => setHoverNodeId\(node\.id\)\}/)
  assert.match(source, /onPointerLeave=\{/)
  assert.match(source, /onBlur=\{/)
})
