/**
 * r18b t8 样式契约：任务页顶部 **run 横向滑动卡**（六项在卡内 3 列 × 2 行）/ 分组标题 / 样式纪律。
 *
 * 用户口径（2026-11-05）：「每条 run 做成一个卡，多个同时进行的任务通过点卡切换查看详情」，
 * 并选定「横向滑动卡，六项在卡内两行」。这里守的是：
 *  ① 卡不换行、卡宽固定 216px、容器横向滚动并吸附卡左缘；320px 面板里第二张必须露出
 *     ≥ 1/3 卡宽（否则用户看不出可以横滑）；
 *  ② 卡内是「L1 header（标题 + 徽标同一行）// meta // 六项 3 列 × 2 行，每格 label 上 /
 *     value 下两行」三行网格；r18b t10 把卡高控制在 96–108px（min-height 96，标题第一层），
 *     并且**六项零截断**：t9 的「label + value 同行」在真机被 ellipsis 截断，t10 回退竖排；当前 run（左侧 3px 竖条）
 *     与正在查看（10% 淡底 + 1px 内描边）是两个独立状态位，可同现；focus/disabled 肉眼可见；
 *  ③ 旧「纵向整宽行」规则与更早的卡片/下拉/返回键规则（`data-run-cards` / `data-run-card-*` /
 *     `data-run-back` / `data-run-switcher*`）必须删干净 —— 留着会让「样式看起来写了，
 *     其实一条都没生效」；`data-run-id` 仍归 RunHeader，删除时只删与卡片绑定的规则。
 *
 * 为什么用静态断言：本仓没有浏览器，也没装 cssom；样式回归只能「读源码 + 断言关键声明」。
 * 选择器一律取组件真实渲染的 DOM 钩子（与 `test/r18-run-cards.test.ts` 的真实元素树同源），
 * 并反向断言钩子仍存在于组件源码，避免「样式写了但 DOM 改名」的假绿。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = readFileSync(join(ROOT, 'src/client/styles.ts'), 'utf8')
const RUN_SWITCHER = readFileSync(join(ROOT, 'src/client/views/RunSwitcher.tsx'), 'utf8')
/** 去掉注释的组件源码：注释里提到 `<div>` / 旧钩子（说明改了什么）不能把判据判红。 */
const RUN_SWITCHER_CODE = RUN_SWITCHER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const TASK_TABLE = readFileSync(join(ROOT, 'src/client/views/TaskTable.tsx'), 'utf8')
/** 去掉注释的 TaskTable：注释里说明「r18 的最近完成已回滚」不能把判据判红。 */
const TASK_TABLE_CODE = TASK_TABLE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** 去掉注释，避免注释里的选择器/数字把判据判绿（styles.ts 顶部有 r18b 说明文字）。 */
const CSS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

interface Rule {
  selectors: string[]
  body: string
}

/** 按顶层逗号切选择器：`:is(a, b) [data-x]` 里的逗号属于函数参数，不能拆开。 */
function splitSelectors(source: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const char of source) {
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  out.push(current.trim())
  return out.filter((item) => item.length > 0)
}

const RULES: Rule[] = []
{
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(CSS)) !== null) {
    RULES.push({ selectors: splitSelectors(match[1]), body: match[2] })
  }
}

/** reduced-motion 块里只写 transition/animation: none，不算「重复定义」。 */
function isMotionReset(body: string): boolean {
  return body.includes('transition: none')
}

function bodiesOf(selector: string): string[] {
  const hits = RULES.filter((rule) => rule.selectors.includes(selector))
  assert.ok(hits.length > 0, `styles.ts 缺少选择器：${selector}`)
  return hits.map((rule) => rule.body)
}

function declsOf(selector: string): string[] {
  return bodiesOf(selector)
    .flatMap((body) => body.split(';'))
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length > 0)
}

function expectDecl(selector: string, decl: string): void {
  const normalized = declsOf(selector)
  assert.ok(
    normalized.includes(decl),
    `${selector} 缺少声明「${decl}」；实际为：${normalized.join('; ')}`,
  )
}

function has(selector: string): boolean {
  return RULES.some((rule) => rule.selectors.includes(selector))
}

function expectMatch(selector: string, re: RegExp): void {
  const body = bodiesOf(selector).join(';').replace(/\s+/g, ' ')
  assert.match(body, re, `${selector} 未匹配 ${re}`)
}

/** 某个选择器上唯一一条「非 reduced-motion」规则体（用于单点定义/尺寸解析）。 */
function bodyOf(selector: string): string {
  const hits = bodiesOf(selector).filter((body) => !isMotionReset(body))
  assert.equal(hits.length, 1, `${selector} 应当只有一条规则（实际 ${hits.length} 条）`)
  return hits[0] as string
}

/** 取某条声明里的全部 px 数字（padding 这类简写要按顺序读）。 */
function pxListOf(selector: string, prop: string): number[] {
  const match = new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(bodyOf(selector))
  assert.ok(match, `${selector} 缺少 ${prop}`)
  return [...(match[1] as string).matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((item) => Number(item[1]))
}

function pxOf(selector: string, prop: string): number {
  const list = pxListOf(selector, prop)
  assert.ok(list.length > 0, `${selector} 的 ${prop} 没有 px 值`)
  return list[0] as number
}

/* ───────────────────────────── 选择器清单 ───────────────────────────── */

const SECTION = '[data-region="run-switcher"]'
const CARDS = `${SECTION} [data-active-run-cards]`
const CARD = `${SECTION} [data-active-run]`
const HEAD = `${SECTION} [data-active-run-head]`
const TITLE = `${SECTION} [data-active-run-title]`
const STATUS = `${SECTION} [data-active-run-status]`
const META = `${SECTION} [data-active-run-meta]`
const USAGE = `${SECTION} [data-active-run-usage]`
const METRIC = `${SECTION} [data-active-run-metric]`
const METRIC_LABEL = `${SECTION} [data-active-run-metric-label]`
const METRIC_VALUE = `${SECTION} [data-active-run-metric-value]`
const UNAVAILABLE = `${SECTION} [data-active-run-metric][data-available="false"] [data-active-run-metric-value]`

/** 旧卡片/下拉/返回键钩子：r18b t2 已从组件删除，样式里也必须一条不剩。 */
const DEAD_HOOKS = [
  'data-run-cards',
  'data-run-card',
  'data-run-card-title',
  'data-run-card-badge',
  'data-run-card-status',
  'data-run-card-progress',
  'data-run-switcher-label',
  'data-run-switcher-caption',
  'data-run-switcher-status',
  'data-run-switcher-hint',
  'data-run-back',
  'data-historical',
]

const TONE_SELECTORS = (
  [
    ['success', '--dsw-alias-state-success-primary'],
    ['warn', '--dsw-alias-state-warn-primary'],
    ['danger', '--dsw-alias-state-error-primary'],
    ['business', '--dsw-alias-state-business-primary'],
  ] as const
).map(([tone]) => `${STATUS}[data-tone="${tone}"]`)

const RUN_SELECTORS = [
  SECTION,
  CARDS,
  CARD,
  HEAD,
  `${CARD}:hover:not(:disabled):not([data-selected="true"])`,
  `${CARD}:active:not(:disabled):not([data-selected="true"])`,
  `${CARD}:focus-visible`,
  `${CARD}:disabled`,
  `${CARD}[data-current="true"]`,
  `${CARD}[data-selected="true"]`,
  TITLE,
  STATUS,
  ...TONE_SELECTORS,
  META,
  USAGE,
  METRIC,
  METRIC_LABEL,
  METRIC_VALUE,
  UNAVAILABLE,
  `[data-region="task-list"] [data-group-head]`,
]

/* ───────────────────────────── ① 横滑容器 ───────────────────────────── */

test('r18b t8 ① 横滑容器：卡不换行、溢出横向滚动、吸附卡左缘、细滚动条', () => {
  expectDecl(CARDS, 'display: flex')
  expectDecl(CARDS, 'gap: 8px')
  expectDecl(CARDS, 'overflow-x: auto')
  // 纵向不许滚：卡的阴影/焦点环不该在容器里被纵向裁出一条滚动条
  expectDecl(CARDS, 'overflow-y: hidden')
  expectDecl(CARDS, 'scroll-snap-type: x proximity')
  expectDecl(CARDS, 'scrollbar-width: thin')
  expectDecl(CARDS, 'box-sizing: border-box')
  expectDecl(CARDS, 'min-width: 0')
  expectDecl(CARDS, 'max-width: 100%')
  // padding 4 给卡边留呼吸位（焦点环走 outline-offset: -2px，不靠外扩空间）
  assert.deepEqual(pxListOf(CARDS, 'padding'), [4])
  // 容器本身不许比面板宽：负 margin 会让 [data-panel-body] 多出一条整页横向滚动条
  expectDecl(CARDS, 'margin: 0')
  assert.equal(/margin:[^;]*-4px/.test(bodyOf(CARDS)), false, '容器不得用负 margin 补偿')

  // 外层 section 保留钩子、不再纵向排整宽行
  expectDecl(SECTION, 'min-width: 0')
  expectDecl(SECTION, 'max-width: 100%')
  assert.equal(/flex-direction:\s*column/.test(bodyOf(SECTION)), false, 'section 不再纵向堆行')
})

test('r18b t8 ① 320px 算术：216px 卡 + 8 间距 → 第二张露出 88px，六项每列约 63px', () => {
  const panel = 320
  const card = pxOf(CARD, 'width')
  assert.equal(card, 216, '卡宽必须 216px（三连写 width/min/max 之外的单一来源）')
  assert.equal(pxOf(CARD, 'min-width'), 216)
  assert.equal(pxOf(CARD, 'max-width'), 216)
  const gap = pxOf(CARDS, 'gap')
  assert.equal(gap, 8)
  const railPadding = pxListOf(CARDS, 'padding')[0] as number

  // 一屏可见：第一张整卡 + 第二张的露出量
  const visibleSecond = panel - railPadding * 2 - card - gap
  assert.ok(
    visibleSecond >= card / 3,
    `320px 面板里第二张只露出 ${visibleSecond}px（应 ≥ ${Math.round(card / 3)}px，否则看不出能横滑）`,
  )
  assert.equal(visibleSecond, 88)

  // 卡内六项 3 列：内容宽 = 216 - 左竖条 3 - 右边框 1 - 左右 padding 16 = 196
  const inner = card - 3 - 1 - 8 * 2
  const colGap = 3
  const column = (inner - colGap * 2) / 3
  assert.ok(column >= 60, `六项每列只有 ${column.toFixed(1)}px（应 ≥ 60px 才放得下长标签）`)
  // t10 零截断的关键：两条都按真机最长文案算，且必须窄于列宽。
  //   label「输入未命中」= 5 个汉字 × 11px = 55px（竖排后不再和 value 抢同一行）
  //   value「246.91K」≈ 7 字符 × 6px ≈ 42px
  assert.ok(column >= 55, `列宽 ${column.toFixed(1)}px 放不下最长标签「输入未命中」（55px）`)
  assert.ok(column >= 42, `列宽 ${column.toFixed(1)}px 放不下最长数值「246.91K」（≈42px）`)
  // 按任务书口径复核：(216 - 内边距 16 - 2×列距) / 3 也必须 ≥ 60
  const bookColumn = (card - 8 * 2 - colGap * 2) / 3
  assert.ok(bookColumn >= 60, `按任务书口径列宽 ${bookColumn.toFixed(1)}px 应 ≥ 60px`)

  // 固定宽度靠三连写守住（flex 项默认会被压扁，只写 width 会在卡多时失效）
  expectDecl(CARDS, 'display: flex')
  expectDecl(CARD, 'flex: 0 0 auto')
  assert.equal(/width:\s*100%/.test(bodyOf(CARD)), false, '卡不得再占满整行')
})

/* ─────────────────── ② 卡几何 / 三行网格 / 六项 3 列 ─────────────────── */

test('r18b t10 ② 卡：216×min96 紧凑三行网格，标题第一层，可点且 focus/disabled 可见', () => {
  expectDecl(CARD, 'display: grid')
  // 单列：三块（header / meta / 六项）各占一行，不再做「标题 | 徽标」两列网格
  expectDecl(CARD, 'grid-template-columns: minmax(0, 1fr)')
  expectDecl(CARD, 'align-content: start')
  expectDecl(CARD, 'gap: 3px')
  expectDecl(CARD, 'box-sizing: border-box')
  const minHeight = pxOf(CARD, 'min-height')
  assert.ok(
    minHeight >= 96 && minHeight <= 108,
    `卡 min-height 应在 96–108px（目标约 96–108），实际 ${minHeight}`,
  )
  // 不写死 height：内容多（长 meta / 六项变长）时可以自然长高，不裁字
  assert.equal(/(?:^|;)\s*height:/.test(bodyOf(CARD)), false, '卡不得写死 height')

  // padding 6px 8px：上下不超过 8、左右不超过 8（高度账里上下各 6）
  const padding = pxListOf(CARD, 'padding')
  assert.deepEqual(padding, [6, 8])
  for (const value of padding) assert.ok(value <= 8, `卡 padding ${value}px 超过 8px`)

  expectMatch(CARD, /border-radius:\s*var\(--dsw-radius-md/)
  // 竖条用常驻透明左边框占位：切卡时标题不位移
  expectDecl(CARD, 'border-left: 3px solid transparent')
  expectDecl(CARD, 'border: 1px solid var(--dsw-alias-border-l1, currentColor)')
  expectDecl(CARD, 'background: var(--dsw-alias-bg-layer-2, transparent)')
  expectDecl(CARD, 'scroll-snap-align: start')
  expectDecl(CARD, 'text-align: left')
  expectDecl(CARD, 'cursor: pointer')
  expectMatch(CARD, /transition:\s*background-color[^;]*border-color/)

  // L1 header：标题与徽标同一行（flex），标题吃剩余宽度
  expectDecl(HEAD, 'display: flex')
  expectDecl(HEAD, 'align-items: center')
  expectDecl(HEAD, 'min-width: 0')
  expectDecl(HEAD, 'overflow: hidden')

  // 标题：视觉第一层 —— 13px、weight ≥ 600、占满剩余宽度、单行省略
  expectDecl(TITLE, 'flex: 1 1 auto')
  expectDecl(TITLE, 'min-width: 0')
  expectDecl(TITLE, 'white-space: nowrap')
  expectDecl(TITLE, 'text-overflow: ellipsis')
  expectDecl(TITLE, 'overflow: hidden')
  expectMatch(TITLE, /font:\s*var\(--dsw-font-xs-13/)
  const titleWeight = /font-weight:\s*(\d+)/.exec(bodyOf(TITLE))
  assert.ok(titleWeight, '标题必须显式写 font-weight')
  assert.ok(Number(titleWeight[1]) >= 600, `标题 font-weight 应 ≥600，实际 ${titleWeight[1]}`)

  // t10 高度账靠行高收：标题行 18px（token 的 20px 行高被显式盖掉）
  assert.equal(pxOf(TITLE, 'line-height'), 18, '标题行高必须是 18px（高度账 1+6+18+3+13+3+55+6+1=106）')

  // 标题右侧徽标：10–11px、右对齐、不参与压缩，18px 胶囊，卡窄所以封顶 96px
  expectDecl(STATUS, 'display: inline-flex')
  expectDecl(STATUS, 'flex: 0 0 auto')
  expectDecl(STATUS, 'height: 18px')
  expectDecl(STATUS, 'max-width: 96px')
  expectDecl(STATUS, 'border-radius: 999px')
  expectDecl(STATUS, 'white-space: nowrap')
  expectMatch(STATUS, /font:\s*var\(--dsw-font-xxxs-11/)

  // meta 行：单独一行、单行省略（全文由组件的 title 属性兜住）
  expectDecl(META, 'white-space: nowrap')
  expectDecl(META, 'text-overflow: ellipsis')
  expectDecl(META, 'font-variant-numeric: tabular-nums')
  assert.equal(pxOf(META, 'line-height'), 13, 'meta 行高必须是 13px（高度账里 L2 = 13）')

  // 旧两列网格的定位声明必须删净：否则 grid-row/column 会把三块排回旧位置
  for (const [name, selector] of [
    ['title', TITLE],
    ['status', STATUS],
    ['meta', META],
    ['usage', USAGE],
  ] as const) {
    assert.equal(/grid-row|grid-column/.test(bodyOf(selector)), false, `${name} 仍残留旧网格定位`)
  }

  // focus 环画在卡内（滚动容器会裁掉外扩描边）
  expectDecl(`${CARD}:focus-visible`, 'outline: 2px solid var(--dsw-alias-state-business-primary, currentColor)')
  expectDecl(`${CARD}:focus-visible`, 'outline-offset: -2px')
  // disabled：压暗但不至于读不清
  expectDecl(`${CARD}:disabled`, 'cursor: not-allowed')
  expectDecl(`${CARD}:disabled`, 'opacity: 0.6')
  // hover/active 不覆盖选中卡的淡底
  expectDecl(
    `${CARD}:hover:not(:disabled):not([data-selected="true"])`,
    'background: var(--dsw-alias-interactive-bg-hover, transparent)',
  )
})

test('r18b t10 ② 六项：3 列 × 2 行，每格 label 上 / value 下，label/value 零截断', () => {
  expectDecl(USAGE, 'display: grid')
  expectDecl(USAGE, 'grid-template-columns: repeat(3, minmax(0, 1fr))')
  // 列距 3、行距 2（「格子行距 2px」）
  assert.deepEqual(pxListOf(USAGE, 'gap'), [2, 3])
  expectDecl(USAGE, 'border-top: 1px dashed var(--dsw-alias-border-l1, currentColor)')
  // 指标区 = 上边框 + 2px padding-top + 两行 (12 + 13) + 行距 2 = 55px
  const usagePaddingTop = pxListOf(USAGE, 'padding-top')[0] as number
  assert.ok(usagePaddingTop <= 3, `六项 padding-top 应 ≤3px，实际 ${usagePaddingTop}`)

  // 每格：上下两行（column），t9 的「同行」规则必须删净
  expectDecl(METRIC, 'display: flex')
  expectDecl(METRIC, 'flex-direction: column')
  assert.equal(
    /flex-direction:\s*row/.test(bodyOf(METRIC)),
    false,
    '六项每格必须竖排：t9 的同行 row 规则必须删掉',
  )
  expectDecl(METRIC, 'align-items: flex-start')
  expectDecl(METRIC, 'min-width: 0')
  expectMatch(METRIC, /font:\s*var\(--dsw-font-xxxs-11/)

  // label：11px 三级色、单行、行高 12 —— 且**不许省略**（t9 真机截断的直接原因）
  expectDecl(METRIC_LABEL, 'flex: 0 0 auto')
  expectDecl(METRIC_LABEL, 'white-space: nowrap')
  expectDecl(METRIC_LABEL, 'color: var(--dsw-alias-label-tertiary, inherit)')
  expectMatch(METRIC_LABEL, /font:\s*var\(--dsw-font-xxxs-11/)
  assert.equal(pxOf(METRIC_LABEL, 'line-height'), 12, 'label 行高必须是 12px')
  for (const [name, selector] of [
    ['label', METRIC_LABEL],
    ['value', METRIC_VALUE],
  ] as const) {
    const body = bodyOf(selector)
    assert.equal(/text-overflow/.test(body), false, `${name} 不得再写 text-overflow（会截成「246.…」）`)
    assert.equal(/overflow\s*:\s*hidden/.test(body), false, `${name} 不得写 overflow: hidden`)
    // font 简写会把 line-height 一起重置回 token 的 16px —— 行高必须写在 font 之后，
    // 否则高度账里 label 12 / value 13 在真机上会变成 16，卡又长回 110px+。
    const fontAt = body.indexOf('font:')
    const lineHeightAt = body.search(/line-height:\s*\d+px/)
    assert.ok(fontAt >= 0, `${name} 缺 font 简写`)
    assert.ok(
      lineHeightAt > fontAt,
      `${name} 的 line-height 必须写在 font 简写之后（font 会重置行高）`,
    )
  }

  // value：11px/600 tabular、行高 13、单行、同样不省略
  expectDecl(METRIC_VALUE, 'flex: 0 0 auto')
  expectDecl(METRIC_VALUE, 'white-space: nowrap')
  expectDecl(METRIC_VALUE, 'font-variant-numeric: tabular-nums')
  expectDecl(METRIC_VALUE, 'font-weight: 600')
  expectMatch(METRIC_VALUE, /font:\s*var\(--dsw-font-xxxs-11/)
  assert.equal(pxOf(METRIC_VALUE, 'line-height'), 13, 'value 行高必须是 13px')
  // 旧 12px 竖排值规则删净
  assert.equal(
    /--dsw-font-xxs-12/.test(bodyOf(METRIC_VALUE)),
    false,
    '六项值不再用旧的 12px 字号',
  )

  // 不可得 ≠ 0：虚线 + 三级色 + 400（0 仍是实线、主色、600）
  expectDecl(UNAVAILABLE, 'border-bottom: 1px dashed var(--dsw-alias-border-l2, currentColor)')
  expectDecl(UNAVAILABLE, 'color: var(--dsw-alias-label-tertiary, inherit)')
  expectDecl(UNAVAILABLE, 'font-weight: 400')
  expectDecl(UNAVAILABLE, 'cursor: help')
})

test('r18b t10 ② 高度账：卡自然高度 96–108px，全部靠行高/间距/内边距收', () => {
  const padding = pxListOf(CARD, 'padding') // [6, 8]
  const border = 1 + 1
  const head = pxOf(TITLE, 'line-height')
  const meta = pxOf(META, 'line-height')
  const blockGap = pxOf(CARD, 'gap')
  const labelLine = pxOf(METRIC_LABEL, 'line-height')
  const valueLine = pxOf(METRIC_VALUE, 'line-height')
  const usagePaddingTop = pxListOf(USAGE, 'padding-top')[0] as number
  const usageRowGap = pxListOf(USAGE, 'gap')[0] as number
  const usageBorder = 1
  const rows = 2

  const usage = usageBorder + usagePaddingTop + rows * (labelLine + valueLine) + usageRowGap
  const natural = border + padding[0]! * 2 + head + meta + blockGap * 2 + usage
  assert.ok(natural >= 96 && natural <= 108, `卡自然高度 ${natural}px 应落在 96–108px`)
  assert.equal(natural, 106, '高度账：1+6+18+3+13+3+(1+2+50+2)+6+1 = 106')
  // 竖排六项的代价只有 19px（t9 同行指标区 38 → t10 55），换来的是零截断
  assert.equal(usage, 55)
})

/* ─────────────── ② 当前 run / 正在查看 / fallback 正交 ─────────────── */

test('r18b t8 ② 当前 run=左侧竖条，正在查看=淡底+内描边，两维正交且 fallback 无警示色', () => {
  const currentBody = bodyOf(`${CARD}[data-current="true"]`)
  const selectedBody = bodyOf(`${CARD}[data-selected="true"]`)
  const currentDecls = declsOf(`${CARD}[data-current="true"]`)
  const selectedDecls = declsOf(`${CARD}[data-selected="true"]`)

  // 「当前」只管一维：左侧竖条颜色（宽度在基础规则里已是 3px，不参与状态切换）
  assert.deepEqual(currentDecls, [
    'border-left-color: var(--dsw-alias-state-business-primary, currentColor)',
  ], `当前卡只该改竖条颜色，实际：${currentDecls.join('; ')}`)
  assert.equal(/background/.test(currentBody), false, '当前卡不得靠底色表达（会与选中混淆）')

  // 「正在查看」只管淡底 + 内描边，不碰 border-left（否则两维会互相覆盖）
  expectMatch(`${CARD}[data-selected="true"]`, /background:\s*color-mix\(in srgb, var\(--dsw-alias-state-business-primary[^)]*\) 10%, transparent\)/)
  expectMatch(`${CARD}[data-selected="true"]`, /box-shadow:\s*inset 0 0 0 1px color-mix\(/)
  assert.equal(/border-left/.test(selectedBody), false, '选中卡不得改 border-left（那是「当前」的信号）')
  assert.equal(/outline/.test(selectedBody), false, '选中不是焦点，不得复用 focus 环')

  // 两者可同现：规则互不覆盖，且各自只出现在一个选择器里
  assert.equal(RULES.filter((rule) => rule.selectors.includes(`${CARD}[data-current="true"]`)).length, 1)
  assert.equal(RULES.filter((rule) => rule.selectors.includes(`${CARD}[data-selected="true"]`)).length, 1)
  assert.equal(
    /state-(warn|error)-primary/.test(currentBody + selectedBody),
    false,
    '当前/选中都不得用警示色（不是异常状态）',
  )

  // fallback（没有进行中的 run，只剩最新一条兜底）不加任何规则：它就是一张普通卡
  const fallbackRules = RULES.filter((rule) =>
    rule.selectors.some((selector) => selector.includes('data-fallback')),
  )
  assert.deepEqual(fallbackRules, [], 'data-fallback 必须零规则（它靠卡内徽标/meta 说明，不靠样式）')
})

/* ───────────── ③ 旧行/旧卡片规则删净 + 钩子与真实 DOM 一致 ───────────── */

test('r18b t8 ③ 旧纵向整宽行与卡片/下拉/返回键规则已删，样式钩子与 RunSwitcher 真实 DOM 一致', () => {
  // 旧「纵向整宽行」的独有规则：行占满整宽 + 最后一行去分隔线
  assert.equal(has(`${CARD}:last-child`), false, '旧行规则 [data-active-run]:last-child 必须删除')
  assert.equal(/width:\s*100%/.test(bodyOf(CARD)), false, '行改卡后不得再有 width: 100%')
  assert.equal(/flex-direction:\s*column/.test(bodyOf(SECTION)), false, 'section 不再纵向堆叠')

  for (const hook of DEAD_HOOKS) {
    assert.equal(CSS.includes(hook), false, `样式里残留旧钩子 ${hook}`)
  }

  // 组件源码：横滑容器是 span（button 内容模型只允许 phrasing content），卡是原生 button
  assert.match(RUN_SWITCHER_CODE, /<span data-active-run-cards>/)
  assert.match(RUN_SWITCHER_CODE, /<button[\s\S]*?type="button"[\s\S]*?data-active-run/)
  assert.equal((RUN_SWITCHER_CODE.match(/<section/g) ?? []).length, 1)
  assert.equal((RUN_SWITCHER_CODE.match(/<div/g) ?? []).length, 0, 'button 内不许出现 div')
  // 卡必须在横滑容器里面（容器先开、卡后开）
  assert.ok(
    (RUN_SWITCHER_CODE.indexOf('data-active-run-cards') ?? -1) <
      (RUN_SWITCHER_CODE.indexOf('<button') ?? -1),
    '横滑容器必须在卡之前渲染',
  )
  // 卡仍靠原生属性表达状态
  assert.match(RUN_SWITCHER, /disabled=\{busy\}/)
  assert.match(RUN_SWITCHER, /aria-pressed=\{row\.selected\}/)
  assert.match(RUN_SWITCHER, /data-current=\{row\.current \? 'true' : 'false'\}/)
  assert.match(RUN_SWITCHER, /data-selected=\{row\.selected \? 'true' : 'false'\}/)
})

/* ───────────────────────────── ④ 分组标题 ───────────────────────────── */

test('r18b t3 ④ 分组标题：24px 组头、11px 二级色、计数等宽（未完成 / 已完成）', () => {
  const head = '[data-region="task-list"] [data-group-head]'
  expectDecl(head, 'display: flex')
  expectDecl(head, 'align-items: center')
  expectDecl(head, 'box-sizing: border-box')
  expectDecl(head, 'height: 24px')
  expectDecl(head, 'padding: 0 12px')
  expectDecl(head, 'border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor)')
  expectDecl(head, 'background: var(--dsw-alias-bg-layer-1, transparent)')
  expectDecl(head, 'color: var(--dsw-alias-label-secondary, inherit)')
  expectMatch(head, /font: var\(--dsw-font-xxxs-11, 11px\/16px sans-serif\)/)
  // 「N」在两组里出现在同一位置：等宽数字才不会让标题左右跳
  expectDecl(head, 'font-variant-numeric: tabular-nums')

  // 组头文案仍是 TaskTable 的单一来源（t5 已恢复为「未完成 / 已完成」）
  assert.match(TASK_TABLE, /open: '未完成'/)
  assert.match(TASK_TABLE, /done: '已完成'/)
  assert.equal(/最近完成/.test(TASK_TABLE_CODE), false, '分组文案里不得再出现旧的「最近完成」')
  assert.match(TASK_TABLE, /data-group-head/)
  assert.match(TASK_TABLE, /\$\{GROUP_LABEL\[key\]\} · \$\{rows\.length\}/)
  // 样式表的注释也应跟着改（只改注释，不改规则）
  assert.match(SOURCE, /「未完成 · N」\/「已完成 · N」/)
})

/* ───────────────────────────── ⑤ 样式纪律 ───────────────────────────── */

test('r18b t8 ⑤ 纪律：字号只用 font 简写、颜色只用宿主 token、选择器挂在 data-* 钩子上', () => {
  for (const selector of RUN_SELECTORS) {
    assert.ok(has(selector), `r18b 样式块缺少选择器：${selector}`)
    const body = bodiesOf(selector).join(';')
    // AGENTS §4：--dsw-font-* 是 font 简写复合值，写成 font-size 是无效声明且静默继承
    assert.equal(/font-size\s*:/.test(body), false, `${selector} 不得使用 font-size（要写 font: 简写）`)
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(body), false, `${selector} 出现裸色值，颜色必须走宿主 token`)
  }

  // 全表：没有任何 `font-size: var(--dsw-font…)`
  assert.equal(/font-size\s*:\s*var\(--dsw-font/.test(CSS), false, '出现 font-size: var(--dsw-font…)')

  // 只用、不定义设计 token
  assert.equal(/(^|[;{\s])--dsw-[a-z0-9-]+\s*:/.test(CSS), false, '样式表里定义了 --dsw-* 变量')

  // 选择器全部挂在组件真实渲染的 data-* 钩子上（不锁内部类名，也不发明新前缀）
  const ALLOWED_HOOKS = new Set([
    'data-region',
    'data-active-run',
    'data-active-run-cards',
    'data-active-run-head',
    'data-active-run-title',
    'data-active-run-status',
    'data-active-run-meta',
    'data-active-run-usage',
    'data-active-run-metric',
    'data-active-run-metric-label',
    'data-active-run-metric-value',
    'data-current',
    'data-selected',
    'data-available',
    'data-tone',
    'data-group-head',
  ])
  for (const selector of RUN_SELECTORS) {
    assert.match(selector, /\[data-/, `选择器没有 data-* 钩子：${selector}`)
    for (const match of selector.matchAll(/\[(data-[a-z-]+)/g)) {
      const hook = match[1] as string
      assert.ok(ALLOWED_HOOKS.has(hook), `使用了未登记的 DOM 钩子 ${hook}（${selector}）`)
    }
  }

  // 花括号配对：少一个会静默吞掉一整段规则
  let depth = 0
  for (const char of CSS) {
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      assert.ok(depth >= 0, '出现多余的 }')
    }
  }
  assert.equal(depth, 0, '花括号未配对')

  // 同一钩子单点定义（reduced-motion 块只写 transition/animation: none，不算重复）
  for (const selector of RUN_SELECTORS) {
    const count = RULES.filter((rule) => rule.selectors.includes(selector) && !isMotionReset(rule.body)).length
    assert.equal(count, 1, `选择器重复定义：${selector}（出现 ${count} 次）`)
  }

  // 卡与横滑容器都有 transition/snap → reduced-motion 必须把它们一起停掉
  const reducedSelectors = RULES.filter((rule) => isMotionReset(rule.body)).flatMap((rule) => rule.selectors)
  assert.ok(reducedSelectors.includes(CARD), '减少动效块缺 [data-region="run-switcher"] [data-active-run]')
  assert.ok(
    reducedSelectors.includes(CARDS),
    '减少动效块缺 [data-region="run-switcher"] [data-active-run-cards]',
  )
})
