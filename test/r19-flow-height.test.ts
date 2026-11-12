/**
 * r19 样式契约：右侧面板流转图画布高度 300px → 600px（需求原话「高度增加为当前的两倍」）。
 *
 * 为什么只改 CSS：FlowCanvas 用 `clientHeight` 做「重置居中」与平移边界的计算
 * （见 src/client/views/FlowCanvas.tsx），画布自己多高它就按多高算，没有写死的 300 依赖；
 * 节点 148×56、步进 188/72、字号全部不动——本次只改 `[data-flow-canvas]` 的静态高度。
 *
 * 本仓没有浏览器，样式回归只能「读源码 + 断言关键声明」。这里锁四条不变量：
 *   1) 画布基础规则 height: 600px，且全仓不再出现 `height: 300px`；
 *   2) 只有这一处给画布定高——外层 `[data-region="task-flow"]` 不得再挂 height/max-height，
 *      画布自身的其它命中规则也不得出现 max-height（两处高度互相打架时以谁为准说不清）；
 *   3) `overflow: hidden` 必须保留（r14 把画布改成「固定视口 + 可平移层」，改成 auto 会
 *      出现无意义的滚动条并把平移层移出可视区）；
 *   4) `position: relative` 必须保留（r14 D4：viewport 与「重置视图」是 position:absolute，
 *      画布不是定位上下文时会锚到宿主 pane 上）。
 *
 * 选择器一律用组件真实渲染的 DOM 钩子（FlowCanvas.tsx），不锁内部类名。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = readFileSync(join(ROOT, 'src/client/styles.ts'), 'utf8')
const CANVAS_SOURCE = readFileSync(join(ROOT, 'src/client/views/FlowCanvas.tsx'), 'utf8')

/** 去掉注释，避免注释里的数字/选择器把判据判绿。 */
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

/** 极简规则扫描：CSS 无嵌套，`selector { body }` 正则已够（@media/@container 内层规则同样命中）。 */
const RULES: Rule[] = []
{
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(CSS)) !== null) {
    RULES.push({ selectors: splitSelectors(match[1]), body: match[2] })
  }
}

function declsOf(body: string): string[] {
  return body
    .split(';')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length > 0)
}

/** 精确命中某选择器的全部规则体（同一选择器允许分成多条规则写）。 */
function bodiesOf(selector: string): string[] {
  const hits = RULES.filter((rule) => rule.selectors.includes(selector))
  assert.ok(hits.length > 0, `styles.ts 缺少选择器：${selector}`)
  return hits.map((rule) => rule.body)
}

function declsFor(selector: string): string[] {
  return bodiesOf(selector).flatMap((body) => declsOf(body))
}

/** 所有同时命中「task-flow 区域」与「flow-canvas」的规则（含 :focus-visible 等状态变体）。 */
function canvasRules(): Rule[] {
  return RULES.filter(
    (rule) =>
      rule.selectors.some((selector) => selector.includes('[data-region="task-flow"]')) &&
      rule.selectors.some((selector) => selector.includes('[data-flow-canvas]')),
  )
}

const CANVAS = '[data-region="task-flow"] [data-flow-canvas]'
const REGION = '[data-region="task-flow"]'

test('r19 画布高度翻倍：基础规则 height: 600px，全仓不再有 height: 300px', () => {
  const decls = declsFor(CANVAS)
  assert.ok(decls.includes('height: 600px'), `画布高度必须是 600px；实际为：${decls.join('; ')}`)
  assert.equal(
    decls.some((decl) => /^height: 300px$/.test(decl)),
    false,
    '画布规则不得再出现 height: 300px',
  )

  // 所有命中画布的规则里只允许一条 height 声明，且就是 600px（状态变体不许偷偷改高度）。
  const heights = canvasRules()
    .flatMap((rule) => declsOf(rule.body))
    .filter((decl) => /^height:/.test(decl))
  assert.deepEqual(heights, ['height: 600px'], `画布高度声明应唯一且为 600px；实际为：${heights.join('; ')}`)

  // 区块横幅注释也要同步（避免后人照着旧注释把 300px 改回去）。
  const banner = /\/\*[^*]*流转图[\s\S]*?\*\//.exec(SOURCE)
  assert.ok(banner !== null, 'styles.ts 缺少流转图区块注释')
  assert.equal(banner[0].includes('300px'), false, `流转图注释不得再留 300px：${banner[0]}`)
})

test('r19 高度只有一处：外层 task-flow 不再给画布设固定高度 / max-height', () => {
  const regionDecls = declsFor(REGION)
  assert.equal(
    regionDecls.some((decl) => /^(height|max-height|min-height):/.test(decl)),
    false,
    `外层 ${REGION} 不得设置高度类声明（会与画布 600px 打架）；实际为：${regionDecls.join('; ')}`,
  )

  for (const rule of canvasRules()) {
    const decls = declsOf(rule.body)
    assert.equal(
      decls.some((decl) => /^max-height:/.test(decl)),
      false,
      `画布规则不得出现 max-height（高度由 height 一处定义）：${rule.selectors.join(', ')}`,
    )
  }

  // 画布高度不跟视口单位绑定：宿主面板高度不确定，vh 会让取景随窗口抖动。
  const canvasBodies = canvasRules()
    .map((rule) => rule.body)
    .join(';')
  assert.equal(/\b(100vh|100dvh)\b/.test(canvasBodies), false, '画布高度不得使用视口单位')
})

test('r19 视口契约：overflow: hidden 与 position: relative 都不能动', () => {
  const decls = declsFor(CANVAS)
  assert.ok(decls.includes('overflow: hidden'), `画布必须保持 overflow: hidden；实际为：${decls.join('; ')}`)
  assert.equal(
    decls.some((decl) => /^overflow(-x|-y)?: (auto|scroll)$/.test(decl)),
    false,
    'overflow 不许改成 auto/scroll（r14 固定视口 + 可平移层依赖 hidden）',
  )
  assert.ok(decls.includes('position: relative'), `画布必须保持 position: relative；实际为：${decls.join('; ')}`)

  // 组件侧不得对画布高度有任何假设：平移是纯 pointer 增量、重置只是把 translate 归零，
  // 所以本次只改 CSS 就够（若将来有人在组件里写死 300/画布高度，这里会先红）。
  assert.equal(CANVAS_SOURCE.includes('300'), false, 'FlowCanvas 不得出现写死的 300（高度只由 CSS 决定）')
  assert.equal(/clientHeight/.test(CANVAS_SOURCE), false, 'FlowCanvas 不读 clientHeight，画布多高与组件逻辑无关')
})
