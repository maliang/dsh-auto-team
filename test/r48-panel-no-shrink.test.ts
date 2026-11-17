/**
 * r48 回归：面板外壳抗压缩 + 单一滚动容器。
 *
 * 事故现场：面板容器溢出后，36px 页签条被压到十几 px。
 * 根因：滚动主体用 `flex: 1 1 auto` 时 flex-basis = 内容高度（可达数千 px），
 * 容器溢出后 flex-shrink 按 basis 加权把负空间分摊给**所有**子项，固定高度外壳被连带压扁。
 *
 * 修复契约（r48 锁定，删除或回退任一环都必须变红）：
 *   ① [data-tab-bar] 固定 36px，且 flex 不 grow / 不 shrink；
 *   ② [data-panel-body] `flex: 1 1 0` + `min-height: 0` + `overflow: auto`（唯一纵向滚动主体）；
 *   ③ 固定高度外壳（head / meta / 暂停横幅 / error）一律 `flex: 0 0 auto`；
 *   ④ 反例守卫：面板作用域内任何 [data-tab-bar] 规则都不得出现 grow/shrink 的非零值；
 *   ⑤ 左栏（library / panellist）与右栏（panel）共用同一条 :is(...) 规则，不得分叉。
 *
 * 本仓没有浏览器，沿用 r17 的「读源码 + 断言关键声明」解析式回归：
 * 只锁组件真实渲染的 DOM 钩子（Panel.tsx），不锁内部类名。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = readFileSync(join(ROOT, 'src/client/styles.ts'), 'utf8')
const PANEL_SOURCE = readFileSync(join(ROOT, 'src/client/Panel.tsx'), 'utf8')

/** 去掉注释，避免注释里的选择器/数值把判据判绿（例如注释里的 `flex: 1 1 auto`）。 */
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

/** 极简规则扫描：CSS 无嵌套，`selector { body }` 正则已够（@media/@container 内层同样命中）。 */
const RULES: Rule[] = []
{
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(CSS)) !== null) {
    RULES.push({ selectors: splitSelectors(match[1]), body: match[2] })
  }
}

/** 选择器归一化：空白与逗号后的空格不参与比较，防止格式化把断言弄成假红。 */
function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, ' ').replace(/,\s*/g, ',').trim()
}

function declsOf(rule: Rule): string[] {
  return rule.body
    .split(';')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length > 0)
}

/** 取选择器完全匹配的规则（允许同一选择器出现在多条规则里，聚合后判断）。 */
function rulesFor(selector: string): Rule[] {
  const wanted = normalizeSelector(selector)
  const hits = RULES.filter((rule) => rule.selectors.some((item) => normalizeSelector(item) === wanted))
  assert.ok(hits.length > 0, `styles.ts 缺少选择器：${selector}`)
  return hits
}

function declsFor(selector: string): string[] {
  return rulesFor(selector).flatMap(declsOf)
}

function expectDecl(selector: string, decl: string): void {
  const normalized = declsFor(selector)
  assert.ok(
    normalized.includes(decl),
    `${selector} 缺少声明「${decl}」；实际为：${normalized.join('; ')}`,
  )
}

/** 面板作用域内、选择器命中某个钩子的全部规则（用于反例守卫）。 */
function panelRulesWith(hook: string): Rule[] {
  return RULES.filter((rule) =>
    rule.selectors.some((item) => item.includes('[data-auto-team-panel]') && item.includes(hook)),
  )
}

const PANEL = '[data-auto-team-panel]'
const SHARED = ':is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist])'
const TAB_BAR = `${SHARED} [data-tab-bar]`
const TAB = `${SHARED} [data-tab]`
const TAB_ACTIVE = `${SHARED} [data-tab][data-active="true"]`

const BODY = `${PANEL} [data-panel-body]`
const HEAD = `${PANEL} [data-panel-head]`
const META = `${PANEL} [data-panel-meta]`
const PAUSED = `${PANEL} [data-panel-paused-banner]`
const ERROR = `${PANEL} [data-error]`

/** 固定高度外壳的四个直系子选择器：head / meta / 暂停横幅 / error。 */
const FIXED_SHELLS = [`${PANEL} > [data-panel-head]`, `${PANEL} > [data-panel-meta]`, `${PANEL} > [data-panel-paused-banner]`, `${PANEL} > [data-error]`]

/** flex 简写是否「不 grow 也不 shrink」：flex: 0 0 auto / flex: none。 */
function assertNotGrowable(selector: string, rule: Rule, decl: string): void {
  const shorthand = /^flex\s*:\s*(.+)$/.exec(decl)
  if (shorthand !== null) {
    const value = shorthand[1].trim()
    if (value === 'none') return
    const parts = value.split(/\s+/)
    assert.equal(parts[0], '0', `${selector} 不得 grow：${decl}`)
    if (parts.length > 1) assert.equal(parts[1], '0', `${selector} 不得 shrink：${decl}`)
    return
  }
  assert.equal(/^flex-grow\s*:\s*(?!0\b)/.test(decl), false, `${selector} 不得 grow：${decl}`)
  assert.equal(/^flex-shrink\s*:\s*(?!0\b)/.test(decl), false, `${selector} 不得 shrink：${decl}`)
}

test('r48 ① 页签条：固定 36px 且 flex 不 grow / 不 shrink', () => {
  expectDecl(TAB_BAR, 'height: 36px')
  expectDecl(TAB_BAR, 'box-sizing: border-box')

  // 断言等价两种合法写法：flex: 0 0 auto（当前实现）或显式 flex-shrink: 0。
  const decls = declsFor(TAB_BAR)
  const hasFixedFlex = decls.some((decl) => decl === 'flex: 0 0 auto' || decl === 'flex: none')
  const hasNoShrink = decls.includes('flex-shrink: 0')
  assert.ok(
    hasFixedFlex || hasNoShrink,
    `[data-tab-bar] 必须声明 flex: 0 0 auto 或 flex-shrink: 0；实际为：${decls.join('; ')}`,
  )

  // 36px 是设计稿的固定高度：不允许被内容撑大（height 仍是 36，min-height 兜底不冲突）。
  const body = rulesFor(TAB_BAR).map((rule) => rule.body).join(';')
  assert.equal(/height\s*:\s*auto/.test(body), false, '[data-tab-bar] 的 36px 固定高度不得被 height:auto 覆盖')
})

test('r48 ② 滚动主体：flex: 1 1 0 + min-height: 0 + overflow: auto', () => {
  expectDecl(BODY, 'flex: 1 1 0')
  expectDecl(BODY, 'min-height: 0')
  expectDecl(BODY, 'overflow: auto')

  // 反例守卫：body 不得再出现 basis=auto 的写法（那正是本次事故的根因）。
  for (const rule of rulesFor(BODY)) {
    for (const decl of declsOf(rule)) {
      assert.notEqual(decl, 'flex: 1 1 auto', '[data-panel-body] 不得回退为 flex: 1 1 auto（basis=内容高度会被压缩）')
      assert.notEqual(decl, 'flex: auto', '[data-panel-body] 不得使用 flex: auto')
    }
  }

  // 单一滚动容器：固定高度外壳一律不许纵向滚动。
  for (const selector of [HEAD, META, PAUSED, ERROR]) {
    for (const decl of declsFor(selector)) {
      assert.equal(
        /^overflow(-y)?\s*:\s*(auto|scroll)\b/.test(decl),
        false,
        `${selector} 不得自己纵向滚动（纵向滚动只允许 [data-panel-body]）：${decl}`,
      )
    }
  }
})

test('r48 ③ 固定高度外壳：head / meta / 暂停横幅 / error 一律 flex: 0 0 auto', () => {
  // 直系子元素契约（组规则）：四个选择器共用一条 flex: 0 0 auto。
  const normalizedFixed = FIXED_SHELLS.map(normalizeSelector)
  const groupRule = RULES.find((rule) =>
    normalizedFixed.every((wanted) => rule.selectors.some((item) => normalizeSelector(item) === wanted)),
  )
  assert.ok(groupRule !== undefined, `缺少面板直系子元素组规则：${FIXED_SHELLS.join(' / ')}`)
  assert.ok(
    declsOf(groupRule).includes('flex: 0 0 auto'),
    `面板直系固定高度外壳组规则缺少 flex: 0 0 auto；实际为：${declsOf(groupRule).join('; ')}`,
  )

  // 每段自己的规则也必须固定（组规则失配时仍能被单独发现）。
  for (const selector of [HEAD, META, PAUSED, ERROR]) {
    expectDecl(selector, 'flex: 0 0 auto')
  }

  // 反例守卫：固定高度外壳不得 grow。
  for (const selector of [HEAD, META, PAUSED, ERROR]) {
    for (const rule of rulesFor(selector)) {
      for (const decl of declsOf(rule)) {
        if (/^flex\s*:|^flex-grow\s*:/.test(decl)) assertNotGrowable(selector, rule, decl)
      }
    }
  }
})

test('r48 ④ 反例守卫：面板作用域内任何 [data-tab-bar] 规则都不得 grow / shrink', () => {
  const tabBarRules = panelRulesWith('[data-tab-bar]')
  assert.ok(tabBarRules.length > 0, '面板作用域内没有 [data-tab-bar] 规则')

  for (const rule of tabBarRules) {
    for (const selector of rule.selectors) {
      for (const decl of declsOf(rule)) {
        if (/^flex\b/.test(decl)) assertNotGrowable(`[data-tab-bar]（${selector}）`, rule, decl)
      }
    }
  }

  // 字符串级反例：即使写在别的规则里也不许出现这两条。
  const all = tabBarRules.map((rule) => rule.body).join(';')
  assert.equal(/flex-shrink\s*:\s*1\b/.test(all), false, '[data-tab-bar] 规则不得出现 flex-shrink: 1')
  assert.equal(/flex\s*:\s*1\s+1\s+auto\b/.test(all), false, '[data-tab-bar] 规则不得出现 flex: 1 1 auto')
})

test('r48 ⑤ 左右两侧共用同一条规则，不得分叉', () => {
  // tab-bar / tab / 选中态：同一条 :is(panel, library, panellist) 规则必须同时覆盖三侧。
  for (const selector of [TAB_BAR, TAB, TAB_ACTIVE]) {
    const hits = RULES.filter((rule) =>
      rule.selectors.some(
        (item) =>
          normalizeSelector(item) === normalizeSelector(selector) &&
          item.includes('[data-auto-team-panel]') &&
          item.includes('[data-auto-team-library]') &&
          item.includes('[data-auto-team-panellist]'),
      ),
    )
    assert.ok(hits.length > 0, `缺少左右共用规则：${selector}`)
  }

  // 分叉守卫：上述钩子的 flex / height 声明只能来自共用规则；
  // 若有人为 panel 单写一条 `[data-auto-team-panel] [data-tab-bar] { flex: ... }`，这里必须变红。
  for (const selector of [TAB_BAR, TAB, TAB_ACTIVE]) {
    const hook = selector.replace(`${SHARED} `, '')
    const panelOnly = panelRulesWith(hook).filter(
      (rule) =>
        rule.selectors.some(
          (item) => item.includes('[data-auto-team-panel]') && !item.includes('[data-auto-team-library]'),
        ),
    )
    for (const rule of panelOnly) {
      for (const decl of declsOf(rule)) {
        assert.equal(
          /^(flex|height|min-height)\b/.test(decl),
          false,
          `[data-auto-team-panel] 单独为 ${hook} 声明了 ${decl}，左右两侧样式的单一来源被打破`,
        )
      }
    }
  }

  // DOM 钩子一致性：Panel.tsx 真实渲染了页签条 / 滚动主体，选择器没有悬空。
  assert.match(PANEL_SOURCE, /data-panel-body/, 'Panel 缺少 data-panel-body')
  assert.match(PANEL_SOURCE, /data-panel-tabs data-tab-bar/, 'Panel 的页签条缺少 data-tab-bar')
  assert.match(PANEL_SOURCE, /data-panel-head/, 'Panel 缺少 data-panel-head')
  assert.match(PANEL_SOURCE, /data-panel-meta/, 'Panel 缺少 data-panel-meta')
  assert.match(PANEL_SOURCE, /data-panel-paused-banner/, 'Panel 缺少 data-panel-paused-banner')
})
