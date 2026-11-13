/**
 * r17 样式契约（t3b）：run 切换器 / 子智能体主界面 / 历史六项 / 可点角色卡。
 *
 * 这四项是 r17 新增交互的「可见身份」，共同的无障碍/布局风险是：
 *  ① 顶部 run 区在 320px 面板里一行一条（r18b t2 由下拉/横卡改为历史同款 run 行），
 *     行内不能横向溢出，整行可点；逐项视觉细节由 `test/r18-styles.test.ts` 守护；
 *  ② 子智能体主界面必须自己滚动（宿主主区高度链已在 t3a 接好，这里是页面内部）；
 *  ③ 历史六项是 3 列 × 2 行，不可得项必须与真 0 视觉可分；
 *  ④ 可点角色卡不能只靠 hover 暗示（触屏/键盘用户看不到 hover）。
 *
 * 本仓没有浏览器，样式回归只能「读源码 + 断言关键声明」。选择器一律用组件真实
 * 渲染的 DOM 钩子（RunSwitcher.tsx / MemberPage.tsx / HistoryTab.tsx / RoleCard.tsx），
 * 不锁内部类名；同时断言钩子仍存在于组件源码，避免「样式写了但 DOM 改名」的假绿。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = readFileSync(join(ROOT, 'src/client/styles.ts'), 'utf8')
const RUN_SWITCHER = readFileSync(join(ROOT, 'src/client/views/RunSwitcher.tsx'), 'utf8')
const MEMBER_PAGE = readFileSync(join(ROOT, 'src/client/views/MemberPage.tsx'), 'utf8')
const HISTORY_TAB = readFileSync(join(ROOT, 'src/client/tabs/HistoryTab.tsx'), 'utf8')
const ROLE_CARD = readFileSync(join(ROOT, 'src/client/views/RoleCard.tsx'), 'utf8')

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

const RULES: Rule[] = []
{
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(CSS)) !== null) {
    RULES.push({ selectors: splitSelectors(match[1]), body: match[2] })
  }
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

/** r17 新增块之外的旧规则不在本次「新块纪律」范围内（旧块有 16 进制兜底值）。 */
const R17_SELECTORS = [
  '[data-region="run-switcher"]',
  '[data-region="run-switcher"] [data-active-run-cards]',
  '[data-region="run-switcher"] [data-active-run]',
  '[data-region="run-switcher"] [data-active-run][data-current="true"]',
  '[data-region="run-switcher"] [data-active-run][data-selected="true"]',
  '[data-region="run-switcher"] [data-active-run-title]',
  '[data-region="run-switcher"] [data-active-run-status]',
  '[data-region="run-switcher"] [data-active-run-meta]',
  '[data-region="run-switcher"] [data-active-run-usage]',
  '[data-region="run-switcher"] [data-active-run-metric]',
  '[data-region="run-switcher"] [data-active-run-metric-value]',
  ':is([data-auto-team-library], [data-auto-team-panellist]) [data-library-shell] [data-member-surface]',
  '[data-member-page]',
  '[data-member-page] [data-member-bar]',
  '[data-member-page] [data-member-back]',
  '[data-member-page] [data-member-head]',
  '[data-member-page] [data-member-name]',
  '[data-member-page] [data-member-status]',
  '[data-member-page] [data-member-model]',
  '[data-member-page] [data-member-route-audit]',
  '[data-member-page] [data-member-task]',
  '[data-member-page] [data-region="member-messages"]',
  '[data-member-page] [data-member-task-head]',
  '[data-member-page] [data-member-task-title]',
  '[data-member-page] [data-member-task-cells]',
  '[data-member-page] [data-region="member-messages"] [data-member-message-list]',
  '[data-member-page] [data-member-message-body]',
  '[data-region="history-list"] [data-history-line="usage"]',
  '[data-region="history-list"] [data-history-usage] [data-history-metric]',
  '[data-region="history-list"] [data-history-usage] [data-usage-metric-label]',
  '[data-region="history-list"] [data-history-usage] [data-usage-metric-value]',
  '[data-role-grid] [data-role-card][data-role-card-open="true"]',
]

test('r17 ⑥ run 区：横向滑动卡，一 run 一卡、卡宽 216px，320px 面板里露出下一张', () => {
  const section = '[data-region="run-switcher"]'
  expectDecl(section, 'box-sizing: border-box')
  expectDecl(section, 'min-width: 0')
  expectDecl(section, 'max-width: 100%')
  expectDecl(section, 'padding: 0')
  expectDecl(section, 'border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor)')
  // r18b t8：整宽纵向行改成横滑卡，section 不再自己纵向堆叠
  assert.equal(
    /flex-direction:\s*column/.test(bodiesOf(section).join(';')),
    false,
    'run 区不再纵向堆行',
  )

  // 横滑容器：卡不换行（flex 默认 nowrap），越过面板宽度就横向滚动
  const cards = `${section} [data-active-run-cards]`
  expectDecl(cards, 'display: flex')
  expectDecl(cards, 'gap: 8px')
  expectDecl(cards, 'overflow-x: auto')
  expectDecl(cards, 'overflow-y: hidden')
  expectDecl(cards, 'scroll-snap-type: x proximity')

  // 卡是固定宽按钮：可点、单行省略、聚焦可见（逐项尺寸断言在 r18-styles ①②）
  const card = `${section} [data-active-run]`
  expectDecl(card, 'display: grid')
  expectDecl(card, 'flex: 0 0 auto')
  expectDecl(card, 'width: 216px')
  expectDecl(card, 'min-width: 216px')
  expectDecl(card, 'max-width: 216px')
  expectDecl(card, 'box-sizing: border-box')
  expectDecl(card, 'text-align: left')
  expectDecl(card, 'cursor: pointer')
  expectDecl(card, 'scroll-snap-align: start')
  assert.ok(has(`${card}:focus-visible`), '卡缺 :focus-visible')

  // 320px 面板算术：216 卡 + 8 间距，第二张至少露出 1/3 卡宽（否则看不出可横滑）
  const visibleSecond = 320 - 4 * 2 - 216 - 8
  assert.ok(visibleSecond >= 216 / 3, `320px 下第二张只露出 ${visibleSecond}px`)

  // 标题/徽标/meta/六项都是 span 钩子，样式只能挂在这些钩子上
  for (const part of ['title', 'status', 'meta', 'usage', 'metric', 'metric-label', 'metric-value']) {
    assert.ok(has(`${section} [data-active-run-${part}]`), `run 卡缺 ${part} 样式钩子`)
  }

  // 「当前 run」与「正在查看的 run」是两个独立信号：竖条 vs 淡底/描边
  expectDecl(
    `${card}[data-current="true"]`,
    'border-left-color: var(--dsw-alias-state-business-primary, currentColor)',
  )
  const selected = `${card}[data-selected="true"]`
  assert.match(bodiesOf(selected).join(';'), /background:\s*color-mix\(/, '选中卡应有淡底')
  assert.equal(/border-left/.test(bodiesOf(selected).join(';')), false, '选中态不得复用当前 run 的竖条')

  // fallback（无进行中 run 时的最后一条）是中性态，不另造外观、不用警示色
  assert.equal(
    RULES.some((rule) => rule.selectors.some((selector) => selector.includes('data-fallback'))),
    false,
    'data-fallback 不应有专属样式',
  )
})

test('r17 ⑥ 子智能体主界面：外壳接住高度，页面内滚，320px 不横向溢出', () => {
  const surface =
    ':is([data-auto-team-library], [data-auto-team-panellist]) [data-library-shell] [data-member-surface]'
  expectDecl(surface, 'display: flex')
  expectDecl(surface, 'flex: 1 1 auto')
  expectDecl(surface, 'flex-direction: column')
  expectDecl(surface, 'min-width: 0')
  expectDecl(surface, 'min-height: 0')
  expectDecl(surface, 'overflow: hidden')

  const page = '[data-member-page]'
  expectDecl(page, 'display: flex')
  expectDecl(page, 'flex: 1 1 auto')
  expectDecl(page, 'flex-direction: column')
  expectDecl(page, 'box-sizing: border-box')
  expectDecl(page, 'width: 100%')
  expectDecl(page, 'height: 100%')
  expectDecl(page, 'min-width: 0')
  expectDecl(page, 'min-height: 0')
  expectDecl(page, 'overflow: auto')

  // 返回条 sticky：页面滚很长时「回项目库」一直在
  const bar = '[data-member-page] [data-member-bar]'
  expectDecl(bar, 'position: sticky')
  expectDecl(bar, 'top: 0')
  expectDecl(bar, 'z-index: 2')
  expectDecl(bar, 'height: 32px')
  expectDecl(bar, 'flex: 0 0 32px')
  expectDecl(bar, 'border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor)')

  const back = '[data-member-page] [data-member-back]'
  expectDecl(back, 'height: 24px')
  expectDecl(back, 'padding: 0 8px')
  expectDecl(back, 'cursor: pointer')
  assert.ok(has(`${back}:hover`), '成员页返回键缺 hover')
  assert.ok(has(`${back}:focus-visible`), '成员页返回键缺 :focus-visible')

  // 头部：名字可省略、状态徽标不被压扁、模型/角色整行不让 320px 横向溢出
  const head = '[data-member-page] [data-member-head]'
  expectDecl(head, 'display: flex')
  expectDecl(head, 'flex-wrap: wrap')
  expectDecl(head, 'gap: 4px 8px')
  const name = '[data-member-page] [data-member-name]'
  expectDecl(name, 'flex: 0 1 auto')
  expectDecl(name, 'min-width: 0')
  expectMatch(name, /text-overflow: ellipsis/)
  expectMatch(name, /font: var\(--dsw-font-sm-14, 14px\/20px sans-serif\)/)
  expectDecl(name, 'font-weight: 600')

  const status = '[data-member-page] [data-member-status]'
  expectDecl(status, 'flex: 0 0 auto')
  expectDecl(status, 'height: 18px')
  expectDecl(status, 'border-radius: 999px')
  for (const [tone, token] of [
    ['business', '--dsw-alias-state-business-primary'],
    ['warn', '--dsw-alias-state-warn-primary'],
    ['danger', '--dsw-alias-state-error-primary'],
    ['success', '--dsw-alias-state-success-primary'],
  ] as const) {
    expectDecl(
      `[data-member-page] [data-member-status][data-tone="${tone}"]`,
      `color: var(${token}, currentColor)`,
    )
  }

  const model = '[data-member-page] [data-member-model]'
  expectDecl(model, 'flex: 1 0 100%')
  expectDecl(model, 'min-width: 0')
  expectDecl(model, 'overflow-wrap: anywhere')
  expectMatch(model, /font-family: var\(--ds-font-family-code, ui-monospace, monospace\)/)

  // 事实表按 max-content 列排：中文标签不被折断，值列可换行
  for (const facts of [
    '[data-member-page] [data-member-facts]',
    '[data-member-page] [data-member-task-facts]',
  ]) {
    expectDecl(facts, 'display: grid')
    expectDecl(facts, 'grid-template-columns: max-content minmax(0, 1fr)')
    expectDecl(facts, 'gap: 2px 8px')
  }
  // 停滞条：琥珀只做竖条与 8% 底，正文不用琥珀（11px 琥珀对比度不达标）
  const stalled = '[data-member-page] [data-member-stalled][data-stalled="true"]'
  expectDecl(stalled, 'border-left: 2px solid var(--dsw-alias-state-warn-primary, currentColor)')
  expectDecl(
    stalled,
    'background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 8%, transparent)',
  )
  assert.equal(/color: var\(--dsw-alias-state-warn/.test(bodiesOf(stalled).join(';')), false, '停滞正文不得用琥珀色')

  // 路由审计：左侧竖条表达 verdict，正文保持可读
  const audit = '[data-member-page] [data-member-route-audit]'
  expectDecl(audit, 'border-left: 2px solid var(--dsw-alias-border-l3, currentColor)')
  expectDecl(audit, 'overflow-wrap: anywhere')
  expectDecl(`${audit}[data-tone="danger"]`, 'border-left-color: var(--dsw-alias-state-error-primary, currentColor)')
  expectDecl(`${audit}[data-tone="warn"]`, 'border-left-color: var(--dsw-alias-state-warn-primary, currentColor)')
  expectDecl(`${audit}[data-tone="success"]`, 'border-left-color: var(--dsw-alias-state-success-primary, currentColor)')

  // 任务块：tN 徽标不被压扁，标题省略，数字一律 tabular
  const taskId = '[data-member-page] [data-member-task-id]'
  expectDecl(taskId, 'min-width: 24px')
  expectDecl(taskId, 'height: 18px')
  expectDecl(taskId, 'font-variant-numeric: tabular-nums')
  const title = '[data-member-page] [data-member-task-title]'
  expectDecl(title, 'flex: 1 1 120px')
  expectDecl(title, 'min-width: 0')
  expectMatch(title, /text-overflow: ellipsis/)
  const cells = '[data-member-page] [data-member-task-cells]'
  expectDecl(cells, 'display: flex')
  expectDecl(cells, 'font-variant-numeric: tabular-nums')
  for (const selector of [
    '[data-member-page] [data-member-task-cells] [data-cell="token"][data-usage-source="unavailable"]',
    '[data-member-page] [data-member-task-cells] [data-cell="duration"][data-duration-state="unavailable"]',
    '[data-member-page] [data-member-task-cells] [data-cell="duration"][data-duration-state="not-started"]',
  ]) {
    expectDecl(selector, 'color: var(--dsw-alias-label-tertiary, inherit)')
    expectDecl(selector, 'text-decoration: underline dotted')
  }

  // 消息列表固定最大高度内滚；正文换行不撑破 320px
  const list = '[data-member-page] [data-region="member-messages"] [data-member-message-list]'
  expectDecl(list, 'max-height: 240px')
  expectDecl(list, 'overflow: auto')
  expectDecl(list, 'padding: 0')
  expectDecl(list, 'list-style: none')
  const body = '[data-member-page] [data-member-message-body]'
  expectDecl(body, 'white-space: pre-wrap')
  expectDecl(body, 'overflow-wrap: anywhere')
  expectDecl(
    '[data-member-page] [data-member-message-fold] summary',
    'color: var(--dsw-alias-state-business-primary, currentColor)',
  )
  assert.ok(
    has('[data-member-page] [data-member-message-fold] summary:focus-visible'),
    '可展开消息缺 :focus-visible（键盘用户打不开折叠）',
  )
})

test('r17 ⑥ 历史行六项：3 列 × 2 行，标签/数字分栏，不可得项与真 0 可分', () => {
  const usage = '[data-region="history-list"] [data-history-line="usage"]'
  expectDecl(usage, 'display: grid')
  expectDecl(usage, 'grid-template-columns: repeat(3, minmax(0, 1fr))')
  expectDecl(usage, 'gap: 2px 8px')
  expectDecl(usage, 'padding-top: 4px')
  expectDecl(usage, 'border-top: 1px dashed var(--dsw-alias-border-l1, currentColor)')

  const metric = '[data-region="history-list"] [data-history-usage] [data-history-metric]'
  expectDecl(metric, 'display: flex')
  expectDecl(metric, 'flex-direction: column')
  expectDecl(metric, 'min-width: 0')

  const label = '[data-region="history-list"] [data-history-usage] [data-usage-metric-label]'
  expectDecl(label, 'color: var(--dsw-alias-label-tertiary, inherit)')
  expectDecl(label, 'overflow: hidden')
  expectMatch(label, /text-overflow: ellipsis/)
  expectDecl(label, 'white-space: nowrap')
  expectMatch(metric, /font: var\(--dsw-font-xxxs-11, 11px\/16px sans-serif\)/)

  const value = '[data-region="history-list"] [data-history-usage] [data-usage-metric-value]'
  expectDecl(value, 'color: var(--dsw-alias-label-primary, inherit)')
  expectDecl(value, 'font-weight: 600')
  expectDecl(value, 'font-variant-numeric: tabular-nums')
  expectDecl(value, 'overflow: hidden')
  expectMatch(value, /text-overflow: ellipsis/)
  expectMatch(value, /font: var\(--dsw-font-xxs-12, 12px\/16px sans-serif\)/)

  // 唯一区分「宿主没上报」与真 0 的钩子：data-available="false"
  const unavailable =
    '[data-region="history-list"] [data-history-usage] [data-available="false"] [data-usage-metric-value]'
  expectDecl(unavailable, 'color: var(--dsw-alias-label-tertiary, inherit)')
  expectDecl(unavailable, 'font-weight: 400')
  expectDecl(unavailable, 'border-bottom: 1px dashed var(--dsw-alias-border-l2, currentColor)')
})

test('r17 ⑥ 可点角色卡：常驻描边 + 右下 chevron，hover/active/focus 三态齐全', () => {
  const card = '[data-role-grid] [data-role-card][data-role-card-open="true"]'
  expectDecl(card, 'position: relative')
  expectDecl(card, 'cursor: pointer')
  expectDecl(
    card,
    'border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 28%, transparent)',
  )

  expectDecl(`${card}:hover`, 'background: var(--dsw-alias-bg-layer-2, transparent)')
  expectDecl(
    `${card}:hover`,
    'border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 55%, transparent)',
  )
  expectDecl(`${card}:active`, 'background: var(--dsw-alias-interactive-bg-active, transparent)')
  expectDecl(`${card}:focus-visible`, 'outline: 2px solid var(--dsw-alias-state-business-primary, currentColor)')
  expectDecl(`${card}:focus-visible`, 'outline-offset: 1px')

  // 可点击暗示不能只在 hover 里：右下角常驻 chevron + meta 行让位
  const meta = `${card} [data-role-line="meta"]`
  expectDecl(meta, 'padding-right: 10px')
  const mark = `${card}::after`
  expectDecl(mark, 'content: "›"')
  expectDecl(mark, 'position: absolute')
  expectDecl(mark, 'right: 6px')
  expectDecl(mark, 'bottom: 3px')
  expectDecl(mark, 'color: var(--dsw-alias-state-business-primary, currentColor)')
  expectDecl(mark, 'pointer-events: none')

  // 不可点的角色卡（历史 run / 无成员）保持原样：没有 pointer 与描边
  const base = '[data-role-grid] [data-role-card]'
  const baseBody = bodiesOf(base).join(';')
  assert.equal(/cursor: pointer/.test(baseBody), false, '不可点角色卡不得出现 pointer')
  assert.equal(has('[data-role-grid] [data-role-card][data-role-card-open="false"]'), false, '不可点态不需要额外规则')
})

test('r17 ⑥ 钩子一致性：样式选择器与四个组件的真实 DOM 对得上', () => {
  for (const hook of [
    'data-region="run-switcher"',
    'data-active-runs',
    'data-fallback',
    'data-active-run-cards',
    'data-active-run',
    'data-current',
    'data-selected',
    'data-ongoing',
    'data-active-run-title',
    'data-title-source',
    'data-active-run-status',
    'data-active-run-meta',
    'data-active-run-usage',
    'data-active-run-metric',
    'data-available',
    'data-active-run-metric-label',
    'data-active-run-metric-value',
  ]) {
    assert.match(RUN_SWITCHER, new RegExp(hook), `RunSwitcher 缺少 ${hook}`)
  }
  assert.match(RUN_SWITCHER, /data-tone=\{row\.statusTone\}/, 'RunSwitcher 状态徽标的 tone 钩子变了')
  // 旧卡片/下拉/返回键钩子必须一个不剩（DOM 与样式同源，只改一边就会出死规则）。
  // 注释里说明「旧钩子已删」是允许的，所以先剥掉注释再断言。
  const switcherCode = RUN_SWITCHER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const dead of ['data-run-cards', 'data-run-card', 'data-run-back', 'data-run-switcher-label', 'data-historical']) {
    assert.equal(switcherCode.includes(dead), false, `RunSwitcher 仍渲染旧钩子 ${dead}`)
  }

  for (const hook of [
    'data-member-page',
    'data-member-surface',
    'data-member-bar',
    'data-member-back',
    'data-member-crumb',
    'data-member-head',
    'data-member-name',
    'data-member-status',
    'data-member-role',
    'data-member-model',
    'data-member-facts',
    'data-member-route-audit',
    'data-member-task',
    'data-member-section-title',
    'data-member-task-id',
    'data-member-task-title',
    'data-member-task-status',
    'data-member-task-cells',
    'data-member-task-facts',
    'data-member-message-list',
    'data-member-message-body',
    'data-member-message-fold',
  ]) {
    assert.match(MEMBER_PAGE, new RegExp(hook), `MemberPage 缺少 ${hook}`)
  }
  // 主界面外壳由 LibraryPage 渲染：成员面必须仍是 shell 的直接子节点，flex 才能接住高度
  const LIBRARY_PAGE = readFileSync(join(ROOT, 'src/client/LibraryPage.tsx'), 'utf8')
  assert.match(LIBRARY_PAGE, /data-library-shell/, 'LibraryPage 缺少 data-library-shell')
  assert.match(LIBRARY_PAGE, /data-member-surface/, 'LibraryPage 缺少 data-member-surface 外壳')

  for (const hook of [
    'data-history-line="usage"',
    'data-history-usage',
    'data-history-metric',
    'data-usage-metric-label',
    'data-usage-metric-value',
    'data-available={metric.available',
  ]) {
    assert.match(HISTORY_TAB, new RegExp(hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `HistoryTab 缺少 ${hook}`)
  }

  assert.match(ROLE_CARD, /data-role-card-open/, 'RoleCard 缺少 data-role-card-open')
  // r33：可点态由 onJump 驱动（入口统一走 memberJumpOf），语义/焦点不变量不变。
  assert.match(ROLE_CARD, /role=\{onJump === undefined \? undefined : 'button'\}/, '可点角色卡缺 button 语义')
  assert.match(ROLE_CARD, /tabIndex=\{onJump === undefined \? undefined : 0\}/, '可点角色卡缺键盘焦点')
})

test('r17 ⑥ 样式纪律：新块只用宿主 token、字号走 font 简写、花括号配对', () => {
  for (const selector of R17_SELECTORS) {
    assert.ok(has(selector), `r17 样式块缺少选择器：${selector}`)
    const body = bodiesOf(selector).join(';')
    assert.equal(
      /font-size\s*:\s*var\(--dsw-font/.test(body),
      false,
      `${selector} 使用了 font-size: var(--dsw-font…)，该 token 是 font 简写复合值`,
    )
    assert.equal(
      /#[0-9a-fA-F]{3,8}\b/.test(body),
      false,
      `${selector} 出现裸色值，颜色必须走宿主 --dsw-* token`,
    )
  }

  // 只使用、不定义设计 token；不用视口高度（宿主主区不是视口）
  assert.equal(/(^|[;{\s])--dsw-[a-z0-9-]+\s*:/.test(CSS), false, '样式表里定义了 --dsw-* 变量')
  // r17 新块不许用视口高度（旧弹层里的 calc(100vh - 48px) 不在此范围）
  for (const selector of R17_SELECTORS) {
    assert.equal(
      /100vh|100dvh/.test(bodiesOf(selector).join(';')),
      false,
      `${selector} 使用了视口高度单位`,
    )
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

  // 同一钩子单点定义（reduced-motion 块允许再列一次，只写 transition/animation: none）
  for (const selector of R17_SELECTORS) {
    const count = RULES.filter(
      (rule) => rule.selectors.includes(selector) && !rule.body.includes('transition: none'),
    ).length
    assert.equal(count, 1, `选择器重复定义：${selector}（出现 ${count} 次）`)
  }

  // 新增过渡必须在减少动效时停掉
  const reduced = RULES.filter((rule) => rule.body.includes('transition: none'))
  const reducedSelectors = reduced.flatMap((rule) => rule.selectors).join('\n')
  for (const selector of [
    '[data-region="run-switcher"] [data-active-run-cards]',
    '[data-region="run-switcher"] [data-active-run]',
    '[data-member-page] [data-member-back]',
  ]) {
    assert.match(reducedSelectors, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `减少动效块缺 ${selector}`)
  }
})
