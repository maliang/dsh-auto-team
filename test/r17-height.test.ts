/**
 * r17 需求④ 样式契约：自动团队主界面 100% 高度 + 抽屉高度修正。
 *
 * 事故现场（2026-11-05 真机）：从侧边栏进入「自动团队」主界面后，内容只有自身高度，
 * 底部留一大片空白；详情列不内滚；打开运行抽屉时抽屉只有内容那么高。
 *
 * 根因是高度链在 `[data-auto-team-library]` 根节点就断了：
 *   根（无 height/flex）→ shell（只有 container-type）→ body（flex 但没有 flex:1）
 * 抽屉是 `position:absolute; inset:0` 挂在 shell 里，shell 多高它就多高 —— 所以「抽屉高度不对」
 * 是同一个根因的第二个症状，不是抽屉自己的问题。
 *
 * 本仓没有浏览器，样式回归只能「读源码 + 断言关键声明」。这里锁的是**高度链**这条不变量：
 * 根 100% + flex 纵向 → shell flex:1 → body flex:1 + min-height:0 → 各列各自内滚；
 * 抽屉 top/right/bottom:0 且 body 内滚，抽屉就永远等于主区高度。
 *
 * 选择器一律用组件真实渲染的 DOM 钩子（LibraryPage.tsx / RunDrawer.tsx），不锁内部类名。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = readFileSync(join(ROOT, 'src/client/styles.ts'), 'utf8')
const LIBRARY_SOURCE = readFileSync(join(ROOT, 'src/client/LibraryPage.tsx'), 'utf8')
const DRAWER_SOURCE = readFileSync(join(ROOT, 'src/client/views/RunDrawer.tsx'), 'utf8')

/** 去掉注释，避免注释里的选择器/数字把判据判绿。 */
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
    const selectors = splitSelectors(match[1])
    RULES.push({ selectors, body: match[2] })
  }
}

/**
 * 同一选择器可能出现在多条规则里（r14 的分栏变量与 r17 的高度链分开写）。
 * 断言时把它们的规则体合并，避免「先命中的那条没有该声明」造成假红/假绿。
 */
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

/** 断言某条规则里有该声明（按 `;` 切分后做整串匹配，容忍空白与值里的空格）。 */
function expectDecl(selector: string, decl: string): void {
  const normalized = declsOf(selector)
  assert.ok(
    normalized.includes(decl),
    `${selector} 缺少声明「${decl}」；实际为：${normalized.join('; ')}`,
  )
}

const ROOT_MAIN = '[data-auto-team-library][data-library-surface="main"]'
const SHARED = ':is([data-auto-team-library], [data-auto-team-panellist])'
const SHELL = `${SHARED} [data-library-shell]`
const HEAD = `${SHARED} [data-library-head]`
const BODY = `${SHARED} [data-library-body]`
const SPLIT = `${SHARED} [data-project-split]`
const DETAIL = `${SHARED} [data-region="project-detail"]`
const DRAWER = '[data-run-drawer]'
const DRAWER_HEAD = '[data-run-drawer] [data-drawer-head]'
const DRAWER_BODY = '[data-run-drawer] [data-drawer-body]'
const DRAWER_MASK = '[data-run-drawer-mask]'

test('r17 ④ 主界面根节点：main 槽位撑满宿主主内容区（100% + 纵向 flex）', () => {
  expectDecl(ROOT_MAIN, 'display: flex')
  expectDecl(ROOT_MAIN, 'flex: 1 1 auto')
  expectDecl(ROOT_MAIN, 'flex-direction: column')
  expectDecl(ROOT_MAIN, 'box-sizing: border-box')
  expectDecl(ROOT_MAIN, 'width: 100%')
  expectDecl(ROOT_MAIN, 'height: 100%')
  expectDecl(ROOT_MAIN, 'min-width: 0')
  expectDecl(ROOT_MAIN, 'min-height: 0')
  expectDecl(ROOT_MAIN, 'overflow: hidden')

  // 100vh 会把宿主窗口 chrome（标题栏/工具条）也算进去，主区必然溢出；
  // 高度只能相对宿主主内容区，禁止视口单位。
  const rootBodies = bodiesOf(ROOT_MAIN).join(';')
  assert.equal(/100vh|100dvh/.test(rootBodies), false, `${ROOT_MAIN} 不得使用视口高度单位`)

  // 只认 main：右栏内联（panel）与侧栏图标（panellist）不能被这条规则撑高。
  assert.equal(ROOT_MAIN.includes('panellist'), false, '根节点规则不得覆盖侧栏图标')
  assert.equal(ROOT_MAIN.includes('"panel"'), false, '根节点规则不得覆盖右栏内联面')
})

test('r17 ④ 高度链：shell → body 逐级 flex:1，头部固定 44px', () => {
  // shell 是相对定位的包含块，必须自己吃掉根节点的剩余高度。
  expectDecl(SHELL, 'display: flex')
  expectDecl(SHELL, 'flex: 1 1 auto')
  expectDecl(SHELL, 'flex-direction: column')
  expectDecl(SHELL, 'position: relative')
  expectDecl(SHELL, 'box-sizing: border-box')
  expectDecl(SHELL, 'width: 100%')
  expectDecl(SHELL, 'min-width: 0')
  expectDecl(SHELL, 'min-height: 0')
  expectDecl(SHELL, 'overflow: hidden')

  // 头部不参与伸缩：44px 是设计稿尺寸，不能被内容压扁或撑大。
  expectDecl(HEAD, 'flex: 0 0 44px')
  expectDecl(HEAD, 'height: 44px')
  expectDecl(HEAD, 'box-sizing: border-box')

  // 分栏容器拿走头部之外的剩余高度，min-height:0 才允许子列内滚而不是把页面撑高。
  expectDecl(BODY, 'display: flex')
  expectDecl(BODY, 'flex: 1 1 auto')
  expectDecl(BODY, 'min-height: 0')
  expectDecl(BODY, 'overflow: hidden')

  expectDecl(SPLIT, 'display: flex')
  expectDecl(SPLIT, 'flex: 1 1 auto')
  expectDecl(SPLIT, 'min-height: 0')
  expectDecl(SPLIT, 'overflow: hidden')

  // 详情列：自己滚，不撑高父级（折叠成上下两段时同样成立）。
  expectDecl(DETAIL, 'flex: 1 1 auto')
  expectDecl(DETAIL, 'min-height: 0')
  expectDecl(DETAIL, 'overflow: auto')
})

test('r17 ④ 抽屉：铺满 shell 整条高度，标题固定、正文内滚', () => {
  expectDecl(DRAWER, 'position: absolute')
  expectDecl(DRAWER, 'top: 0')
  expectDecl(DRAWER, 'right: 0')
  expectDecl(DRAWER, 'bottom: 0')
  expectDecl(DRAWER, 'display: flex')
  expectDecl(DRAWER, 'flex-direction: column')
  expectDecl(DRAWER, 'box-sizing: border-box')
  expectDecl(DRAWER, 'width: min(520px, 100%)')
  expectDecl(DRAWER, 'max-height: 100%')
  expectDecl(DRAWER, 'min-height: 0')
  expectDecl(DRAWER, 'overflow: hidden')

  expectDecl(DRAWER_HEAD, 'flex: 0 0 44px')
  expectDecl(DRAWER_HEAD, 'height: 44px')
  expectDecl(DRAWER_HEAD, 'box-sizing: border-box')

  expectDecl(DRAWER_BODY, 'flex: 1 1 auto')
  expectDecl(DRAWER_BODY, 'min-height: 0')
  expectDecl(DRAWER_BODY, 'overflow: auto')

  // 遮罩与抽屉同一包含块：shell 撑满后遮罩才是整块主区，而不是内容高度。
  expectDecl(DRAWER_MASK, 'position: absolute')
  expectDecl(DRAWER_MASK, 'inset: 0')
})

test('r17 ④ 钩子一致性：CSS 选择器都对应组件真实渲染的 DOM', () => {
  // 根节点确实带 data-library-surface，且只在 main / panel 两个值之间切换。
  assert.match(LIBRARY_SOURCE, /data-auto-team-library/, 'LibraryPage 根节点缺少 data-auto-team-library')
  assert.match(
    LIBRARY_SOURCE,
    /data-library-surface=\{props\.inline === true \? 'panel' : 'main'\}/,
    'LibraryPage 根节点的 data-library-surface 取值变了，高度链选择器会失配',
  )
  assert.match(LIBRARY_SOURCE, /data-library-shell/, 'LibraryContent 缺少 data-library-shell')
  assert.match(LIBRARY_SOURCE, /data-library-body/, 'LibraryContent 缺少 data-library-body')
  assert.match(LIBRARY_SOURCE, /data-project-split/, 'LibraryContent 缺少 data-project-split')

  // 抽屉必须渲染在 shell 内（absolute 才有正确包含块），三个高度钩子缺一不可。
  assert.match(DRAWER_SOURCE, /data-run-drawer-mask/, 'RunDrawer 缺少遮罩钩子')
  assert.match(DRAWER_SOURCE, /data-run-drawer(?![-\w])/, 'RunDrawer 缺少抽屉钩子')
  assert.match(DRAWER_SOURCE, /data-drawer-head/, 'RunDrawer 缺少 data-drawer-head')
  assert.match(DRAWER_SOURCE, /data-drawer-body/, 'RunDrawer 缺少 data-drawer-body')

  // 右栏内联面另有自己的高度规则（它不经过 main 根节点的 100%），不能被本次改动删掉。
  expectDecl(
    '[data-auto-team-panel] [data-panel-library-inline] [data-auto-team-library]',
    'flex: 1 1 auto',
  )
})

test('r17 ④ 样式纪律：只用宿主 token，字号走 font 简写', () => {
  const r17Blocks = [
    ...bodiesOf(ROOT_MAIN).map((body) => ({ selector: ROOT_MAIN, body })),
    ...bodiesOf(SHELL).map((body) => ({ selector: SHELL, body })),
    ...bodiesOf(HEAD).map((body) => ({ selector: HEAD, body })),
    ...bodiesOf(BODY).map((body) => ({ selector: BODY, body })),
    ...bodiesOf(DETAIL).map((body) => ({ selector: DETAIL, body })),
    ...bodiesOf(DRAWER).map((body) => ({ selector: DRAWER, body })),
    ...bodiesOf(DRAWER_HEAD).map((body) => ({ selector: DRAWER_HEAD, body })),
    ...bodiesOf(DRAWER_BODY).map((body) => ({ selector: DRAWER_BODY, body })),
  ]
  for (const { selector, body } of r17Blocks) {
    assert.equal(
      /font-size\s*:\s*var\(--dsw-font/.test(body),
      false,
      `${selector} 使用了 font-size: var(--dsw-font…)，该 token 是 font 简写复合值（无效声明）`,
    )
    assert.equal(
      /#[0-9a-fA-F]{3,8}\b/.test(body),
      false,
      `${selector} 出现裸色值，颜色必须走宿主 --dsw-* token`,
    )
  }
})
