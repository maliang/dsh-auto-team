/**
 * r16 · 角色列画布（`flowLayoutOf` 派生 + FlowCanvas 钩子）的单测。
 *
 * 为什么单独成文件：AC-12/13/14 的三条事实（列=角色、列序=首次出现、节点 tN）
 * 全部由 `flowLayoutOf()` 一次派生，组件只渲染。`node --test` 不转 JSX，
 * 所以组件层用源码钩子锁契约（有 `data-flow-stage`、没有 `data-flow-node-role`），
 * 布局层用夹具把列序/坐标/列间箭头逐字算死。
 *
 * 反例（TECHNICAL §8 的变异点）在这里也守：把 `roleId` 换成 `roleName` 分组、
 * 或拿旧 `node.column` 当列号，本文件都会红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  FLOW_COLUMN_STEP,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_TOP,
  FLOW_NODE_WIDTH,
  FLOW_PADDING,
  FLOW_ROLE_FALLBACK,
  FLOW_ROW_STEP,
  FLOW_STAGE_LINK_Y,
  FLOW_STAGE_TOP,
  flowLayoutOf,
  flowNodeViewOf,
  statusBadge,
} from '../src/client/viewmodel.ts'
import type { FlowEdgeView, FlowNodeView, FlowView, TaskStatus } from '../src/shared/types.ts'

/* ────────────────────────── 夹具 ────────────────────────── */

/**
 * 单个流转节点。`column/row` 故意填 9：布局必须忽略它们（它们只是旧的依赖深度），
 * 任何「拿 node.column 当列号」的实现都会在本文件里露馅。
 */
function nodeOf(id: string, status: TaskStatus, extra: Partial<FlowNodeView> = {}): FlowNodeView {
  return {
    id,
    title: `任务 ${id}`,
    status,
    column: 9,
    row: 9,
    usage: { source: 'provider', tokens: { total: 1230 } },
    duration: { text: '2 分 14 秒', state: 'done' },
    ...extra,
  }
}

function flowOf(nodes: FlowNodeView[], edges: FlowEdgeView[] = []): FlowView {
  const columns = nodes.reduce((max, node) => Math.max(max, node.column + 1), 0)
  const rows = nodes.reduce((max, node) => Math.max(max, node.row + 1), 0)
  return { nodes, edges, columns, rows }
}

/* ────────────────────────── 列 = 角色 ────────────────────────── */

test('AC-12：列 = 有任务的角色，按首次出现顺序，组内按计划顺序', () => {
  const flow = flowOf([
    nodeOf('t1', 'done', { roleId: 'qa', roleName: '测试' }),
    nodeOf('t2', 'running', { roleId: 'dev', roleName: '开发' }),
    nodeOf('t3', 'waiting', { roleId: 'qa', roleName: '测试' }),
  ])
  const layout = flowLayoutOf(flow)

  assert.equal(layout.stages.length, 2, '两个角色 → 两列')
  assert.deepEqual(layout.stages.map((stage) => stage.name), ['测试', '开发'], '列序 = 首次出现')
  assert.deepEqual(layout.stages.map((stage) => stage.count), [2, 1], '×N = 该角色任务数')
  assert.deepEqual(layout.stages.map((stage) => stage.index), [0, 1])
  assert.deepEqual(layout.stages.map((stage) => stage.roleId), ['qa', 'dev'])
  // 列头几何：left = 12 + i*208，top = 12
  assert.deepEqual(layout.stages.map((stage) => stage.x), [FLOW_PADDING, FLOW_PADDING + FLOW_COLUMN_STEP])
  assert.deepEqual(layout.stages.map((stage) => stage.y), [FLOW_STAGE_TOP, FLOW_STAGE_TOP])

  // 节点归属与列内行号：column 是角色列索引，不再等于 node.column(9)
  const columns = new Map(layout.nodes.map((entry) => [entry.node.id, entry.column]))
  assert.equal(columns.get('t1'), 0)
  assert.equal(columns.get('t3'), 0)
  assert.equal(columns.get('t2'), 1)
  assert.deepEqual(
    layout.nodes.filter((entry) => entry.column === 0).map((entry) => entry.row),
    [0, 1],
    '同列内按计划顺序排行',
  )
  assert.deepEqual(layout.nodes.map((entry) => entry.y), [FLOW_NODE_TOP, FLOW_NODE_TOP, FLOW_NODE_TOP + FLOW_ROW_STEP])
})

test('AC-12：出现顺序由节点数组决定（角色先出现的先成列）', () => {
  const layout = flowLayoutOf(
    flowOf([
      nodeOf('t1', 'done', { roleId: 'dev', roleName: '开发' }),
      nodeOf('t2', 'done', { roleId: 'qa', roleName: '测试' }),
    ]),
  )
  assert.deepEqual(layout.stages.map((stage) => stage.name), ['开发', '测试'])
  assert.equal(layout.nodes[0]?.column, 0)
  assert.equal(layout.nodes[1]?.column, 1)
})

test('AC-12：没有任务的角色不出列（列只从节点派生）', () => {
  const layout = flowLayoutOf(flowOf([nodeOf('t1', 'done', { roleId: 'dev', roleName: '开发' })]))
  assert.equal(layout.stages.length, 1, '只有 dev 有任务 → 只有一列')
  assert.deepEqual(layout.stages.map((stage) => stage.name), ['开发'])
  assert.equal(layout.stages.reduce((sum, stage) => sum + stage.count, 0), layout.nodes.length)
})

test('AC-12：同 roleName 不同 roleId 不合并（key 用 roleId）', () => {
  const layout = flowLayoutOf(
    flowOf([
      nodeOf('t1', 'done', { roleId: 'dev-a', roleName: '开发' }),
      nodeOf('t2', 'running', { roleId: 'dev-b', roleName: '开发' }),
    ]),
  )
  assert.equal(layout.stages.length, 2, '同名角色但 id 不同 → 两列')
  assert.deepEqual(layout.stages.map((stage) => stage.roleId), ['dev-a', 'dev-b'])
  assert.deepEqual(layout.stages.map((stage) => stage.count), [1, 1])
})

/* ────────────────────────── 旧快照回退 ────────────────────────── */

test('AC-12：旧快照无 roleId → 按 roleName 回退分组', () => {
  const layout = flowLayoutOf(
    flowOf([
      nodeOf('t1', 'done', { roleName: '开发' }),
      nodeOf('t2', 'running', { roleName: '测试' }),
      nodeOf('t3', 'waiting', { roleName: '开发' }),
    ]),
  )
  assert.deepEqual(layout.stages.map((stage) => stage.name), ['开发', '测试'])
  assert.deepEqual(layout.stages.map((stage) => stage.count), [2, 1])
  assert.equal(layout.stages[0]?.roleId, undefined, '回退列没有 roleId')
})

test('AC-12：roleId/roleName 都没有 → 单列「角色未记录」，宽度不溢出右栏', () => {
  const layout = flowLayoutOf(flowOf([nodeOf('t1', 'done'), nodeOf('t2', 'running')]))
  assert.equal(layout.stages.length, 1)
  assert.equal(layout.stages[0]?.name, FLOW_ROLE_FALLBACK)
  assert.equal(layout.stages[0]?.count, 2)
  assert.equal(layout.width, FLOW_PADDING * 2 + FLOW_NODE_WIDTH, '单列 = 24+180 = 204')
})

/* ────────────────────────── 列间箭头 / 任务边 ────────────────────────── */

test('AC-12：相邻列头之间画箭头（y=28，左列全 done 才实线）', () => {
  const layout = flowLayoutOf(
    flowOf([
      nodeOf('t1', 'done', { roleId: 'dev', roleName: '开发' }),
      nodeOf('t2', 'running', { roleId: 'qa', roleName: '测试' }),
      nodeOf('t3', 'waiting', { roleId: 'ops', roleName: '运维' }),
    ]),
  )
  assert.equal(layout.stageLinks.length, 2, '3 列 → 2 条列间箭头')
  const [first, second] = layout.stageLinks
  assert.ok(first !== undefined && second !== undefined)
  assert.equal(first.from, FLOW_PADDING + FLOW_NODE_WIDTH + 4)
  assert.equal(first.to, FLOW_PADDING + FLOW_COLUMN_STEP - 4)
  assert.match(first.d, new RegExp(`^M [\\d.]+ ${FLOW_STAGE_LINK_Y} L [\\d.]+ ${FLOW_STAGE_LINK_Y}$`))
  assert.equal(first.upstreamDone, true, '左列（dev）全部 done → 实线')
  assert.equal(second.upstreamDone, false, '左列（qa）有在跑任务 → 虚线')
})

test('AC-12：单列不画列间箭头；空计划不产生任何几何', () => {
  const single = flowLayoutOf(flowOf([nodeOf('t1', 'done', { roleId: 'dev', roleName: '开发' })]))
  assert.deepEqual(single.stageLinks, [])

  const empty = flowLayoutOf(flowOf([]))
  assert.deepEqual(empty.nodes, [])
  assert.deepEqual(empty.stages, [])
  assert.deepEqual(empty.stageLinks, [])
  assert.deepEqual(empty.edges, [])
  assert.equal(empty.width, FLOW_PADDING * 2)
  assert.equal(empty.height, FLOW_PADDING * 2)
  assert.equal(Number.isNaN(empty.width) || Number.isNaN(empty.height), false, '空计划不得 NaN')
})

test('AC-14：任务边保留 r14 语义（贝塞尔 + upstreamDone），缺端点/成环直接跳过', () => {
  const layout = flowLayoutOf({
    nodes: flowOf([
      nodeOf('t1', 'done', { roleId: 'dev', roleName: '开发' }),
      nodeOf('t2', 'running', { roleId: 'dev', roleName: '开发' }),
    ]).nodes,
    edges: [
      { from: 't1', to: 't2', upstreamDone: true },
      { from: 't1', to: 't404', upstreamDone: false },
    ],
    columns: 1,
    rows: 1,
  })
  assert.equal(layout.edges.length, 1, '缺端点的边被跳过')
  const edge = layout.edges[0]
  assert.ok(edge !== undefined)
  assert.equal(edge.upstreamDone, true)
  // 同列回边时控制点可以落在负坐标（贝塞尔外推），这是合法 SVG，不能当 NaN 处理
  assert.match(edge.d, /^M -?[\d.]+ -?[\d.]+ C -?[\d.]+ -?[\d.]+, -?[\d.]+ -?[\d.]+, -?[\d.]+ -?[\d.]+$/)
  assert.equal(/NaN|Infinity/.test(edge.d), false)
})

test('AC-12/13：画布宽高随列数/最多任务数增长（两列 412，行步进 80）', () => {
  const layout = flowLayoutOf(
    flowOf([
      nodeOf('t1', 'done', { roleId: 'dev', roleName: '开发' }),
      nodeOf('t2', 'running', { roleId: 'dev', roleName: '开发' }),
      nodeOf('t3', 'running', { roleId: 'dev', roleName: '开发' }),
      nodeOf('t4', 'waiting', { roleId: 'qa', roleName: '测试' }),
    ]),
  )
  assert.equal(layout.width, FLOW_PADDING * 2 + FLOW_NODE_WIDTH + FLOW_COLUMN_STEP, '两列 = 24+180+208 = 412')
  assert.equal(
    layout.height,
    FLOW_NODE_TOP + FLOW_NODE_HEIGHT + 2 * FLOW_ROW_STEP + FLOW_PADDING,
    '最高列 3 个任务 → 54+64+160+12',
  )
  assert.equal(layout.nodes[0]?.x, FLOW_PADDING)
  assert.equal(layout.nodes[3]?.x, FLOW_PADDING + FLOW_COLUMN_STEP)
})

/* ────────────────────────── 节点 cell ────────────────────────── */

test('AC-13：节点 cell 的 tN/标题/状态/第二行全部来自 flowNodeViewOf', () => {
  const node = nodeOf('t3', 'gate', { roleId: 'qa', roleName: '测试', title: '写门禁探针' })
  const cell = flowNodeViewOf(node)
  const badge = statusBadge('gate')
  assert.equal(node.id, 't3')
  assert.match(node.id, /^t\d+$/, 'tN 编号是硬约束')
  assert.equal(cell.taskTitle, '写门禁探针')
  assert.equal(cell.statusText, badge.text)
  assert.equal(cell.tone, badge.tone)
  assert.match(cell.tokenText, /1\.23K/, 'token 走动态单位（1,230 → 1.23K）')
  assert.equal(cell.durationText, '2 分 14 秒')
  assert.equal(cell.text, `${cell.tokenText} · ${cell.durationText}`)
  // 角色名只进 title/aria（hover 仍知道归属），不进第一行文本
  assert.match(cell.title, /角色 测试/)
  assert.match(cell.label, /^t3：写门禁探针，/)
  assert.match(cell.label, /token 1\.23K/)
})

/* ────────────────────────── FlowCanvas 源码钩子 ────────────────────────── */

const CANVAS_SOURCE = readFileSync(new URL('../src/client/views/FlowCanvas.tsx', import.meta.url), 'utf8')
const CANVAS_CODE = CANVAS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('AC-12：FlowCanvas 渲染列头（徽标/名字/×N）与列间箭头', () => {
  assert.match(CANVAS_CODE, /layout\.stages\.map/)
  assert.match(CANVAS_CODE, /data-flow-stage\b/)
  assert.match(CANVAS_CODE, /data-flow-stage-badge/)
  assert.match(CANVAS_CODE, /data-flow-stage-count>\s*×\{stage\.count\}/)
  assert.match(CANVAS_CODE, /data-flow-stage-link/)
  assert.match(CANVAS_CODE, /layout\.stageLinks\.map/)
  // 列头不是 button：pointerdown 冒泡给画布，拖列头也能平移
  assert.equal(/<button[^>]*data-flow-stage/.test(CANVAS_CODE), false, '列头不是按钮')
})

test('AC-13：节点第一行是 tN + 标题 + 状态胶囊，节点内不再渲染角色名', () => {
  assert.match(CANVAS_CODE, /data-flow-node-id>\{node\.id\}/)
  assert.match(CANVAS_CODE, /data-flow-node-title title=\{node\.title\}/)
  assert.match(CANVAS_CODE, /data-flow-status data-tone=\{cell\.tone\}/)
  assert.match(CANVAS_CODE, /data-flow-line="meta"/)
  assert.equal(CANVAS_CODE.includes('data-flow-node-role'), false, '角色名只在列头')
  // data-flow-column/row 必须用派生值，不能读 node.column / node.row
  assert.match(CANVAS_CODE, /data-flow-column=\{String\(column\)\}/)
  assert.match(CANVAS_CODE, /data-flow-row=\{String\(row\)\}/)
  assert.equal(/node\.column/.test(CANVAS_CODE), false, '不信任旧 node.column')
})

test('AC-14：拖动/复位/键盘与图例沿用 r14，图例文案改为已完成/未完成', () => {
  assert.match(CANVAS_CODE, /requestAnimationFrame\(/)
  assert.match(CANVAS_CODE, /style\.transform = /)
  assert.match(CANVAS_CODE, /FLOW_DRAG_THRESHOLD/)
  assert.match(CANVAS_CODE, /FLOW_PAN_LIMIT/)
  assert.match(CANVAS_CODE, /FLOW_KEY_STEP/)
  assert.match(CANVAS_CODE, /data-canvas-reset/)
  assert.match(CANVAS_CODE, /data-flow-legend/)
  assert.match(CANVAS_CODE, /实线 = 已完成/)
  assert.match(CANVAS_CODE, /虚线 = 未完成/)
  // 画布/视口/任务边钩子是左栏与抽屉共用的外部契约，不能改名
  for (const hook of ['data-flow-canvas', 'data-flow-viewport', 'data-flow-edges', 'data-flow-edge=']) {
    assert.equal(CANVAS_CODE.includes(hook), true, `必须保留 ${hook}`)
  }
  assert.equal(/from '(d3|mermaid|reactflow|cytoscape)/.test(CANVAS_CODE), false, '不引图形库')
})
