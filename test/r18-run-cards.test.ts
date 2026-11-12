/**
 * r18b t8：任务页顶部 **run 横向滑动卡** 的元素树测试。
 *
 * 用户口径（2026-11-05）：「每条 run 做成一个卡，多个同时进行的任务通过点卡切换查看详情」，
 * 并选定「横向滑动卡，六项在卡内两行」。
 *
 * 本仓没有 `react-dom`，`node --test` 也不转 JSX，所以这里用 `typescript.transpileModule`
 * 把 `RunSwitcher.tsx` 就地编译成 CJS，再用 `new Function`（`require` 由 `createRequire`
 * 提供；react 在 lockfile 里）拿到**真实的元素树**。断言的是可执行事实：卡数、横滑容器、
 * 点击回调、busy 禁用、aria/data 钩子、每卡六项的顺序与 available 标记、卡内 tag 集合。
 *
 * 数据侧走真实投影 `activeRunRowsOf`（`nav.ts`）→ 真实 `runSummaryRowOf`（`tabs/rows.ts`），
 * 保证「卡内文案在投影里一次性派生，组件只贴 DOM」。
 *
 * r18b t9（用户：「任务卡高度可以再小一些，以任务名称显示为主」）：卡内改成
 * 「L1 header（标题 + 状态同一行）→ meta → 六项 3 列 × 2 行」。
 * r18b t10（真机实测 t9 的「label + value 同行」被省略号截断，用户要求辅助信息显示全）：
 * 六项每格回到 **label 上 / value 下**，结构不变（仍是 6 个 span，每格 span + b）。
 * 这里只锁**结构**（谁在谁里面、六项仍是 6 个、每格 label/value 两个元素、文案不截断），
 * 不锁像素——高度/字号/间距由 `test/r18-styles.test.ts` 守。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PanelSnapshot, PlanTask, RunSummary, UsageCell } from '../src/shared/types.ts'
import { activeRunRowsOf } from '../src/client/nav.ts'
import { runSummaryRowOf } from '../src/client/tabs/rows.ts'
import type { RunSwitcherProps } from '../src/client/views/RunSwitcher.tsx'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ts = require('typescript') as typeof import('typescript')

const T1 = Date.parse('2026-11-04T10:00:00+08:00')
const T2 = Date.parse('2026-11-05T09:00:00+08:00')
const T3 = Date.parse('2026-11-05T10:00:00+08:00')

const METRIC_KEYS = ['input', 'cacheRead', 'cacheWrite', 'output', 'calls', 'hitRate']

type RunSummaryFixture = RunSummary & { ongoing?: number }

/* ────────────────────────── 夹具（真实快照 → 真实投影） ────────────────────────── */

function usageOf(): UsageCell {
  return {
    source: 'provider',
    text: '2,100',
    tokens: { total: 2100, input: 1000, cacheRead: 500, cacheWrite: 200, output: 400, calls: 3 },
    details: [
      { key: 'input', label: '输入', text: '1,000', available: true },
      { key: 'cacheRead', label: '缓存读', text: '500', available: true },
      { key: 'cacheWrite', label: '写缓存', text: '200', available: true },
      { key: 'output', label: '输出', text: '400', available: true },
      { key: 'calls', label: '调用', text: '3', available: true },
      { key: 'hitRate', label: '命中率', text: '不可得', available: false },
    ],
  }
}

function taskOf(id: string, status: PlanTask['status']): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    status,
    dependsOn: [],
    acceptance: 'pnpm typecheck',
  } as PlanTask
}

function summaryOf(runId: string, overrides: Partial<RunSummaryFixture> = {}): RunSummaryFixture {
  return {
    runId,
    sessionId: 'sess-1',
    createdAt: T1,
    plannedAt: T1,
    status: 'dispatching',
    tasks: 3,
    done: 1,
    goal: `目标 ${runId}`,
    usage: usageOf(),
    ...overrides,
  }
}

function snapshotOf(overrides: Partial<PanelSnapshot> = {}): PanelSnapshot {
  return {
    enabled: true,
    runId: 'r2',
    planStatus: 'dispatching',
    plannedAt: T1,
    tasks: [taskOf('a', 'done'), taskOf('b', 'running')],
    members: [],
    messages: [],
    routeAudits: [],
    roles: [],
    activity: [],
    runs: [],
    ...overrides,
  } as unknown as PanelSnapshot
}

function viewOf(overrides: Partial<PanelSnapshot> = {}, selectedRunId?: string) {
  const view = activeRunRowsOf({ snapshot: snapshotOf(overrides), selectedRunId })
  assert.ok(view, '夹具应当产出非空投影')
  return view
}

/* ───────────────────────── 就地编译 + 真实元素树 ───────────────────────── */

const componentSource = readFileSync(join(ROOT, 'src/client/views/RunSwitcher.tsx'), 'utf8')
const compiled = ts.transpileModule(componentSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  },
  fileName: join(ROOT, 'src/client/views/RunSwitcher.tsx'),
}).outputText
const moduleShim: { exports: Record<string, unknown> } = { exports: {} }
new Function('require', 'module', 'exports', compiled)(require, moduleShim, moduleShim.exports)
const RunSwitcher = moduleShim.exports.RunSwitcher as (props: RunSwitcherProps) => unknown
assert.equal(typeof RunSwitcher, 'function', 'RunSwitcher 必须是可调用组件')

interface HostNode {
  type: string
  props: Record<string, unknown>
}

function isElement(value: unknown): value is { type: unknown; props: Record<string, unknown> } {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value
}

/** 收集渲染树里的宿主元素（string type），按文档顺序。 */
function elementsOf(node: unknown, out: HostNode[] = []): HostNode[] {
  if (Array.isArray(node)) {
    for (const child of node) elementsOf(child, out)
    return out
  }
  if (!isElement(node)) return out
  if (typeof node.type === 'string') out.push({ type: node.type, props: node.props })
  elementsOf(node.props.children, out)
  return out
}

/** 拼接可见文本（字符串子节点直接累加）。 */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!isElement(node)) return ''
  return textOf(node.props.children)
}

/** 只取直接子元素（不递归）：用来断言「section 下只有横滑容器」「容器下只有卡」。 */
function childElementsOf(node: { props: Record<string, unknown> }): HostNode[] {
  const out: HostNode[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    if (!isElement(value)) return
    if (typeof value.type === 'string') out.push({ type: value.type, props: value.props })
  }
  visit(node.props.children)
  return out
}

function hookOf(nodes: HostNode[], hook: string): HostNode[] {
  return nodes.filter((node) => node.props[hook] !== undefined)
}

function render(props: RunSwitcherProps): HostNode[] {
  return elementsOf(RunSwitcher(props))
}

function sectionOf(nodes: HostNode[]): HostNode {
  const section = nodes.find((node) => node.type === 'section')
  assert.ok(section, '没渲染 section')
  return section
}

function cardsRailOf(nodes: HostNode[]): HostNode {
  const rail = nodes.find((node) => node.props['data-active-run-cards'] !== undefined)
  assert.ok(rail, '没渲染横滑容器 [data-active-run-cards]')
  return rail
}

/** 一张卡 = 一个 button[data-active-run]（卡内不再包 div）。 */
function cardsOf(nodes: HostNode[]): HostNode[] {
  return nodes.filter((node) => node.type === 'button' && node.props['data-active-run'] !== undefined)
}

function cardOf(nodes: HostNode[], runId: string): HostNode {
  const card = cardsOf(nodes).find((node) => node.props['data-run-id'] === runId)
  assert.ok(card, `没渲染 run 卡 ${runId}`)
  return card
}

function metricsOf(card: HostNode): HostNode[] {
  return elementsOf(card.props.children).filter(
    (node) => node.props['data-active-run-metric'] !== undefined,
  )
}

/* ─────────────────────────── 卡数 / 横滑容器 / 旧钩子 ─────────────────────────── */

test('3 条进行中的 run → 3 张卡，且都在唯一的横滑容器里', () => {
  const view = viewOf({
    runs: [
      summaryOf('r1', { status: 'terminated', plannedAt: T1, ongoing: 0 }),
      summaryOf('r2', { plannedAt: T1, ongoing: 2 }),
      summaryOf('r3', { plannedAt: T2, ongoing: 1 }),
      summaryOf('r4', { plannedAt: T3, ongoing: 1 }),
    ],
  })
  const nodes = render({ view, onSelect: () => {} })

  const section = sectionOf(nodes)
  assert.equal(section.props['data-region'], 'run-switcher')
  assert.equal(section.props['data-active-runs'], 3)
  assert.equal(section.props['data-fallback'], 'false')

  // 唯一横滑容器，且它就是 section 的直接子节点：卡全部收在里面才能横向滚动。
  const rails = hookOf(nodes, 'data-active-run-cards')
  assert.equal(rails.length, 1, '横滑容器只能有一个')
  const rail = rails[0] as HostNode
  assert.equal(rail.type, 'span', '横滑容器用 span（button 内容模型只允许 phrasing content）')
  assert.deepEqual(childElementsOf(section).map((node) => node.type), ['span'])

  const cards = cardsOf(nodes)
  assert.equal(cards.length, 3, '进行中的三条 run 各一张卡（已终止的 r1 不出现）')
  assert.deepEqual(
    cards.map((node) => node.props['data-run-id']),
    ['r4', 'r3', 'r2'],
    '卡序与投影一致：新的在前',
  )
  // 容器里的宿主子元素恰好就是这三张卡，没有夹层。
  assert.deepEqual(
    childElementsOf(rail).map((node) => node.type),
    ['button', 'button', 'button'],
  )

  // 旧钩子一个不剩。
  for (const dead of ['data-run-cards', 'data-run-card', 'data-run-back']) {
    assert.equal(hookOf(nodes, dead).length, 0, `旧钩子 ${dead} 必须删干净`)
  }
  assert.equal(nodes.some((node) => node.type === 'select'), false, '顶部不再有 run 切换器')
  assert.equal(nodes.some((node) => node.type === 'option'), false)
})

test('没有进行中的 run 时只渲染最新一条兜底卡，并标记 fallback', () => {
  const view = viewOf({
    runs: [
      summaryOf('rA', { status: 'terminated', plannedAt: T1, ongoing: 0 }),
      summaryOf('rB', { status: 'terminated', plannedAt: T3, ongoing: 0 }),
      summaryOf('rC', { status: 'cancelled', plannedAt: T2, ongoing: 0 }),
    ],
  })
  const nodes = render({ view, onSelect: () => {} })
  const cards = cardsOf(nodes)
  assert.equal(cards.length, 1)
  assert.equal(cards[0]?.props['data-run-id'], 'rB')
  assert.equal(cards[0]?.props['data-ongoing'], 'false')
  assert.equal(sectionOf(nodes).props['data-fallback'], 'true')
})

/* ───────────────────────────── 点击 / 禁用 ───────────────────────────── */

test('点每张卡都把该卡 runId 回调给 onSelect（当前 run 的卡也照常回调）', () => {
  const view = viewOf({
    runs: [
      summaryOf('r2', { plannedAt: T2, ongoing: 1 }),
      summaryOf('r3', { plannedAt: T1, ongoing: 2 }),
    ],
  })
  const picked: string[] = []
  const nodes = render({ view, onSelect: (runId) => picked.push(runId) })

  ;(cardOf(nodes, 'r3').props.onClick as () => void)()
  ;(cardOf(nodes, 'r2').props.onClick as () => void)()
  assert.deepEqual(picked, ['r3', 'r2'])
})

test('busy 时每张卡都 disabled，且程序化 click 也不会回调', () => {
  const view = viewOf({
    runs: [summaryOf('r2', { ongoing: 1 }), summaryOf('r3', { ongoing: 2 })],
  })
  const picked: string[] = []
  const nodes = render({ view, onSelect: (runId) => picked.push(runId), busy: true })

  for (const card of cardsOf(nodes)) {
    assert.equal(card.props.disabled, true)
    ;(card.props.onClick as () => void)()
  }
  assert.deepEqual(picked, [], 'busy 期间连点不该打乱历史详情请求顺序')
})

/* ───────────────────────────── 钩子 / 展示字段 ───────────────────────────── */

test('当前/选中钩子、aria-pressed 与 title 都来自投影（两个状态位正交）', () => {
  const view = viewOf(
    {
      runId: 'r2',
      runs: [
        summaryOf('r2', { plannedAt: T2, ongoing: 1 }),
        summaryOf('r3', { plannedAt: T1, ongoing: 2 }),
      ],
    },
    'r3',
  )
  const nodes = render({ view, onSelect: () => {} })

  const current = cardOf(nodes, 'r2')
  assert.equal(current.props['data-current'], 'true')
  assert.equal(current.props['data-selected'], 'false')
  assert.equal(current.props['aria-pressed'], false)

  const selected = cardOf(nodes, 'r3')
  assert.equal(selected.props['data-current'], 'false')
  assert.equal(selected.props['data-selected'], 'true')
  assert.equal(selected.props['aria-pressed'], true)
  assert.equal(selected.props['title'], view.rows.find((row) => row.runId === 'r3')?.titleTitle)
  // 卡仍是原生 button，禁用/选中不靠 class
  assert.equal(current.type, 'button')
  assert.equal(current.props.type, 'button')
})

test('卡内文案全部来自 RunRowView：标题 / 状态徽标（data-tone）/ meta', () => {
  const snapshot = snapshotOf({ runs: [summaryOf('r2', { ongoing: 1 })] })
  const view = viewOf(snapshot)
  const base = runSummaryRowOf(snapshot.runs?.[0] as RunSummaryFixture)
  const nodes = render({ view, onSelect: () => {} })
  const card = cardOf(nodes, 'r2')
  const inside = childElementsOf(card)

  // r18b t9：L1 是一个 header span，标题与状态徽标同在它里面（同一行排布）。
  const head = inside.find((node) => node.props['data-active-run-head'] !== undefined)
  assert.ok(head, '卡内缺 L1 header [data-active-run-head]')
  assert.equal(head.type, 'span', 'header 必须是 span（button 里不许 div）')
  assert.deepEqual(
    childElementsOf(head).map((node) => node.type),
    ['span', 'span'],
    'L1 里只有标题与状态两个 span',
  )
  const inHead = childElementsOf(head)
  const title = inHead.find((node) => node.props['data-active-run-title'] !== undefined)
  assert.ok(title, 'L1 里缺标题')
  assert.equal(textOf(title.props.children), base.title)
  assert.equal(title.props['data-title-source'], base.titleSource)

  const status = inHead.find((node) => node.props['data-active-run-status'] !== undefined)
  assert.ok(status, 'L1 里缺状态徽标（与标题同一 header）')
  assert.equal(status.props['data-tone'], base.statusTone)
  assert.match(
    textOf(status.props.children),
    new RegExp(base.statusText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )

  // meta 仍是卡的直接子元素（单独一行）；t11 起卡内贴**紧凑全文** `cardMetaText`，
  // 完整的历史文案 `metaText` 放 title（悬停可看「开始/结束/任务」原始全文）。
  const meta = inside.find((node) => node.props['data-active-run-meta'] !== undefined)
  assert.ok(meta)
  const metaRow = view.rows.find((item) => item.runId === 'r2')
  assert.ok(metaRow)
  assert.equal(textOf(meta.props.children), metaRow.cardMetaText, '卡内贴紧凑全文（t11）')
  assert.equal(meta.props.title, base.metaText, 'title 仍给历史列表的完整文案')
  assert.match(meta.props.title as string, /^开始 .+ · 结束 .+ · 任务 \d+\/\d+$/)

  // 三块内容都在同一张卡里（L1 header / meta 行 / 六项），卡之间不串。
  const all = elementsOf(card.props.children)
  for (const hook of ['data-active-run-title', 'data-active-run-status', 'data-active-run-meta', 'data-active-run-usage']) {
    assert.equal(hookOf(all, hook).length >= 1, true, `卡内缺 ${hook}`)
  }
})

test('r18b t11：卡内 meta 是紧凑全文（≤28 字符、两种形态），title 是完整历史文案', () => {
  // 真机证据（216×107 卡、196px 内容宽）：历史长文案
  //   `开始 11-05 13:35:00 · 结束 进行中 · 任务 0/1` → metaClipped=true，「任务 0/1」看不到。
  const live = summaryOf('rLive', { done: 0, tasks: 1, ongoing: 1, active: true })
  const ended = summaryOf('rEnded', {
    plannedAt: T2,
    finishedAt: T3,
    status: 'terminated',
    done: 3,
    tasks: 3,
    ongoing: 0,
    active: false,
  })
  // 已结束的 run 没有进行中任务 → 单独走 fallback（与真机「只剩一个 run」的形态一致）。
  const views = [viewOf({ runs: [live] }), viewOf({ runs: [ended] })]

  for (const view of views) {
    for (const card of cardsOf(render({ view, onSelect: () => {} }))) {
      const runId = card.props['data-run-id'] as string
      const row = view.rows.find((item) => item.runId === runId)
      assert.ok(row, `投影里没有 ${runId} 这一行`)
      const meta = childElementsOf(card).find(
        (node) => node.props['data-active-run-meta'] !== undefined,
      )
      assert.ok(meta)

      // 卡内 = 紧凑全文（组件不拼字符串，逐字等于投影）。
      assert.equal(textOf(meta.props.children), row.cardMetaText)
      // title = 历史列表的完整文案（开始 / 结束 / 任务 三段都在，悬停可看原文）。
      assert.equal(meta.props.title, row.metaText)
      assert.match(meta.props.title as string, /开始 .+ · 结束 .+ · 任务 \d+\/\d+/)
      assert.notEqual(row.cardMetaText, row.metaText, '紧凑全文必须与历史长文案不同')

      // 宽度预算：196px 内容宽、11px 字号 —— 文案不得超过 28 个字符（防回归撑爆）。
      assert.ok(
        row.cardMetaText.length <= 28,
        `meta 过长（${row.cardMetaText.length} 字符）：${row.cardMetaText}`,
      )
      // 视觉零截断的前提：DOM 文案里不许出现省略号。
      assert.equal(textOf(meta.props.children).includes('…'), false)
    }
  }

  assert.match(views[0]!.rows[0]!.cardMetaText, /^\d{2}:\d{2}:\d{2} 起 · 进行中 · 任务 0\/1$/)
  assert.match(
    views[1]!.rows[0]!.cardMetaText,
    /^\d{2}:\d{2}:\d{2} → \d{2}:\d{2}:\d{2} · 任务 3\/3$/,
  )
})

test('r18b t10 紧凑排版：卡内只有「L1 header / meta / 六项」三个 span，没有夹层 div', () => {
  const view = viewOf({ runs: [summaryOf('r2', { ongoing: 1 })] })
  const nodes = render({ view, onSelect: () => {} })
  const card = cardOf(nodes, 'r2')

  // 单列三行，顺序固定：header → meta → usage；中间不许夹包装层（夹层会把 gap 翻倍）。
  assert.deepEqual(
    childElementsOf(card).map((node) => node.type),
    ['span', 'span', 'span'],
  )
  assert.deepEqual(
    childElementsOf(card).map((node) =>
      ['data-active-run-head', 'data-active-run-meta', 'data-active-run-usage'].find(
        (hook) => node.props[hook] !== undefined,
      ),
    ),
    ['data-active-run-head', 'data-active-run-meta', 'data-active-run-usage'],
  )
  // 整棵树零 div（button 的内容模型只允许 phrasing content）。
  assert.equal(elementsOf(card.props.children).some((node) => node.type === 'div'), false)
})

test('计划状态徽标（r18b t7）：terminated 渲染成「■ 已终止」，不再是「? terminated」', () => {
  const view = viewOf({ runs: [summaryOf('rT', { status: 'terminated', ongoing: 0 })] })
  const nodes = render({ view, onSelect: () => {} })
  const inside = elementsOf(cardOf(nodes, 'rT').props.children)
  const status = inside.find((node) => node.props['data-active-run-status'] !== undefined)
  assert.ok(status)
  assert.equal(status.props['data-tone'], 'neutral', '已终止是中性色，不标红')
  assert.equal(textOf(status.props.children).trim(), '■ 已终止')
  assert.doesNotMatch(textOf(status.props.children), /terminated/i, '不许回显宿主裸英文')
  assert.doesNotMatch(textOf(status.props.children), /\?/, '不许出现未知徽标问号')

  const paused = viewOf({ runs: [summaryOf('rP', { status: 'paused', ongoing: 1 })] })
  const pausedStatus = elementsOf(
    cardOf(render({ view: paused, onSelect: () => {} }), 'rP').props.children,
  ).find((node) => node.props['data-active-run-status'] !== undefined)
  assert.equal(textOf(pausedStatus?.props.children).trim(), '⏸ 已暂停')
  assert.equal(pausedStatus?.props['data-tone'], 'warn')
})

test('每张卡六项：3 列 × 2 行所对应的 6 个 span，key 顺序固定，值直接用宿主文案', () => {
  const view = viewOf({
    runs: [summaryOf('r2', { ongoing: 1 }), summaryOf('r3', { plannedAt: T2, ongoing: 2 })],
  })
  const nodes = render({ view, onSelect: () => {} })

  for (const card of cardsOf(nodes)) {
    const usage = childElementsOf(card).find(
      (node) => node.props['data-active-run-usage'] !== undefined,
    )
    assert.ok(usage, '每张卡都要有六项容器')
    const metrics = childElementsOf(usage).filter(
      (node) => node.props['data-active-run-metric'] !== undefined,
    )
    assert.equal(metrics.length, 6, '六项：3 列 × 2 行')
    assert.deepEqual(metrics.map((node) => node.props['data-active-run-metric']), METRIC_KEYS)
    assert.deepEqual(
      metrics.map((node) => node.props['data-available']),
      ['true', 'true', 'true', 'true', 'true', 'false'],
    )
    // 每格 = label span + b 值（卡内只有 span/b）；t10 只是 CSS 改成上下两行，
    // DOM 上仍是「两个元素」，标签在前、值在后。
    for (const metric of metrics) {
      const kids = childElementsOf(metric)
      assert.deepEqual(kids.map((node) => node.type), ['span', 'b'])
      assert.equal(kids[0]?.props['data-active-run-metric-label'], true, '第一个元素必须是 label')
      assert.equal(kids[1]?.props['data-active-run-metric-value'], true, '第二个元素必须是 value')
      const label = textOf(kids[0]?.props.children)
      assert.ok(label.length > 0, 'label 不许为空')
      assert.equal(label.includes('…'), false, `label 被截断：${label}`)
      assert.equal(textOf(kids[1]?.props.children).includes('…'), false, '卡内文案不许出现省略号')
    }
  }

  const metrics = metricsOf(cardOf(nodes, 'r2'))
  const texts = metrics.map((node) => textOf(node.props.children))
  assert.equal(texts[0], '输入 1,000', '数值是宿主格式化好的文本，组件不补千分位')
  assert.equal(texts.at(-1), '命中率 不可得', '缺项不许补 0')
})

test('r18b t10 真机最长文案原样进 DOM：5 字标签 + 7 字符数值都不截断', () => {
  // 真机（216×96 卡）t9 实测被省略号截断的六项原文，按同一顺序做夹具：
  //   「输入未命中 246.…」「输入命中 2」「写缓存 0」「输出 12.3.…」
  //   「调用次数 不…」「缓存命中率 7」
  const longDetails = [
    { key: 'inputMiss', label: '输入未命中', text: '246.91K', available: true },
    { key: 'inputHit', label: '输入命中', text: '2', available: true },
    { key: 'cacheWrite', label: '写缓存', text: '0', available: true },
    { key: 'output', label: '输出', text: '12.3K', available: true },
    { key: 'calls', label: '调用次数', text: '不可得', available: false },
    { key: 'hitRate', label: '缓存命中率', text: '78%', available: true },
  ] as UsageCell['details']
  const usage: UsageCell = {
    source: 'provider',
    text: '259.21K',
    tokens: { total: 259210, input: 1000, cacheRead: 500, cacheWrite: 200, output: 400, calls: 3 },
    details: longDetails,
  }
  const view = viewOf({ runs: [summaryOf('rLong', { ongoing: 1, usage })] })
  const nodes = render({ view, onSelect: () => {} })
  const metrics = metricsOf(cardOf(nodes, 'rLong'))

  assert.equal(metrics.length, 6)
  const pairs = metrics.map((metric) => {
    const kids = childElementsOf(metric)
    return [textOf(kids[0]?.props.children), textOf(kids[1]?.props.children), textOf(metric.props.children)]
  })
  assert.deepEqual(pairs, [
    ['输入未命中', '246.91K', '输入未命中 246.91K'],
    ['输入命中', '2', '输入命中 2'],
    ['写缓存', '0', '写缓存 0'],
    ['输出', '12.3K', '输出 12.3K'],
    ['调用次数', '不可得', '调用次数 不可得'],
    ['缓存命中率', '78%', '缓存命中率 78%'],
  ])
  // 每个格子把「标签：值」全文放进 title（视觉零截断，但悬停/读屏仍有完整原文）
  for (const [index, metric] of metrics.entries()) {
    const [label, value] = pairs[index] as [string, string]
    assert.equal(metric.props.title, `${label}：${value}`)
    assert.equal(textOf(metric.props.children).includes('…'), false, 'DOM 文案里不得有省略号')
  }
})

test('卡内只有 phrasing content：所有后代 tag ∈ {span, b}，整棵树零 div', () => {
  const view = viewOf({
    runs: [summaryOf('r2', { ongoing: 1 }), summaryOf('r3', { plannedAt: T2, ongoing: 2 })],
  })
  const nodes = render({ view, onSelect: () => {} })

  assert.equal(nodes.some((node) => node.type === 'div'), false, 'RunSwitcher 不许渲染 div')
  for (const card of cardsOf(nodes)) {
    const tags = new Set(elementsOf(card.props.children).map((node) => node.type))
    for (const tag of tags) {
      assert.ok(['span', 'b'].includes(tag), `卡内出现非 phrasing 元素 <${tag}>`)
    }
  }
})

test('RunSwitcher.tsx 不做数字/时间格式化（只贴投影）', () => {
  const code = componentSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /toLocaleString|Intl\.NumberFormat|toFixed|padStart/)
  assert.doesNotMatch(code, /小时|分钟/)
  // 卡是 button，里面有 div 就是非法嵌套。
  assert.doesNotMatch(code, /<div/)
  for (const hook of [
    'data-region="run-switcher"',
    'data-active-runs',
    'data-active-run-cards',
    'data-active-run',
    'data-run-id',
    'data-current',
    'data-selected',
    'data-ongoing',
    'aria-pressed',
    'data-active-run-head',
    'data-active-run-title',
    'data-title-source',
    'data-active-run-status',
    'data-active-run-meta',
    'data-active-run-usage',
    'data-active-run-metric',
    'data-available',
  ]) {
    assert.ok(code.includes(hook), `RunSwitcher 缺钩子 ${hook}`)
  }
  for (const dead of ['data-run-cards', 'data-run-card', 'data-run-back', 'onBack', 'canSwitch']) {
    assert.equal(code.includes(dead), false, `旧切换器残留：${dead}`)
  }
  // 卡内文案只来自投影字段：组件不许自己拼 meta / 标题。
  // （t11：正文贴紧凑全文 `cardMetaText`，`title` 放历史列表的完整 `metaText`）
  assert.match(code, /<span data-active-run-meta[^>]*title=\{row\.metaText\}>\{row\.cardMetaText\}<\/span>/)
  assert.match(code, /data-active-run-title data-title-source=\{row\.titleSource\}/)
})
