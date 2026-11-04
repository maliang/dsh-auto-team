/**
 * r16 样式契约（T3）：环 80 / 列头 / tN / 胶囊 / refs / 内联库。
 *
 * 为什么这些断言值得写：本仓没有 react-dom，也没有浏览器跑 CSS，样式层的回归
 * 只能靠「读源码 + 断言关键声明」判死。这里只锁 r16 的设计数字（DESIGN §0.1/§2/§6）
 * 与两条硬纪律：
 *   ① 字号只能走 `font:` 简写（`font-size: var(--dsw-font…)` 是无效声明，静默继承父级字号）；
 *   ② 颜色只能引用宿主 token，不新增 `--dsw-*` 自定义属性（设计系统越权）。
 *
 * 选择器一律用真实 DOM 钩子（组件与 QA 探针共用），不锁组件内部类名。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE = readFileSync(join(ROOT, 'src/client/styles.ts'), 'utf8')

/** 去掉注释，避免注释里的数字/选择器把判据判绿。 */
const CSS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

interface Rule {
  selectors: string[]
  body: string
}

/** 极简规则扫描：CSS 无嵌套，`selector { body }` 正则已够（@media 内的内层规则同样命中）。 */
const RULES: Rule[] = []
{
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(CSS)) !== null) {
    const selectors = match[1]
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    RULES.push({ selectors, body: match[2] })
  }
}

function ruleOf(selector: string): string {
  const hit = RULES.find((rule) => rule.selectors.includes(selector))
  assert.ok(hit, `styles.ts 缺少选择器：${selector}`)
  return hit.body
}

function has(selector: string): boolean {
  return RULES.some((rule) => rule.selectors.includes(selector))
}

/** 断言某条规则里有该声明（按 `;` 切分后做前缀匹配，容忍空白与值里的空格）。 */
function expectDecl(selector: string, decl: string): void {
  const body = ruleOf(selector)
  const normalized = body
    .split(';')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length > 0)
  assert.ok(
    normalized.includes(decl),
    `${selector} 缺少声明「${decl}」；实际为：${normalized.join('; ')}`,
  )
}

/** 断言规则体里有该片段（用于 font 简写这类带多个空格的复合值）。 */
function expectMatch(selector: string, re: RegExp): void {
  const body = ruleOf(selector).replace(/\s+/g, ' ')
  assert.match(body, re, `${selector} 未匹配 ${re}`)
}

test('r16 任务总览：80 + 8 + 208 网格（DESIGN §2.1 = 296 内容宽）', () => {
  expectDecl('[data-task-overview]', 'display: grid')
  expectDecl('[data-task-overview]', 'grid-template-columns: 80px minmax(0, 1fr)')
  expectDecl('[data-task-overview]', 'gap: 8px')
  expectDecl('[data-task-overview]', 'padding: 8px 12px 10px')
  expectDecl('[data-task-overview] [data-overview-ring]', 'width: 80px')
  expectDecl('[data-task-overview] [data-overview-ring]', 'height: 80px')
  expectDecl('[data-task-overview] [data-overview-list]', 'min-width: 0')

  // 列表 meta 行：角色名先让位、token/用时保持不省略（184px 的取舍）
  const meta = '[data-task-overview] [data-task-line="meta"]'
  expectDecl(meta, 'gap: 4px')
  expectDecl(meta, 'overflow: hidden')
  expectMatch('[data-task-overview] [data-task-role]', /text-overflow: ellipsis/)
  expectDecl('[data-task-overview] [data-task-line="meta"] [data-cell="token"]', 'flex: 0 0 auto')
  expectDecl('[data-task-overview] [data-task-line="meta"] [data-cell="duration"]', 'flex: 0 0 auto')
})

test('r16 进度环：80×80、stroke 8、C=213.628 对应的两档字号', () => {
  expectDecl('[data-progress-ring]', 'width: 80px')
  expectDecl('[data-progress-ring]', 'height: 80px')
  expectDecl('[data-progress-ring] [data-ring-track]', 'stroke-width: 8')
  expectDecl('[data-progress-ring] [data-ring-arc]', 'stroke-width: 8')
  expectDecl('[data-progress-ring] [data-ring-arc]', 'stroke: var(--dsw-alias-state-business-primary, currentColor)')
  expectDecl('[data-progress-ring] [data-ring-arc]', 'transition: stroke-dashoffset 240ms ease')
  expectDecl(
    '[data-progress-ring] [data-ring-arc][data-complete="true"]',
    'stroke: var(--dsw-alias-state-success-primary, currentColor)',
  )

  // 长档（999/999，≥6 字）= 13px；短档（99/99、3/9，≤5 字）= 16px；两档都 tabular
  const base = '[data-progress-ring] [data-progress-text]'
  expectMatch(base, /font: var\(--dsw-font-xs-13, 13px\/16px sans-serif\)/)
  expectDecl(base, 'font-weight: 600')
  expectDecl(base, 'font-variant-numeric: tabular-nums')
  expectMatch(
    '[data-progress-ring] [data-progress-text][data-text-tier="short"]',
    /font: var\(--dsw-font-h3-16, 16px\/20px sans-serif\)/,
  )
  expectDecl('[data-progress-ring] [data-progress-text][data-text-tier="short"]', 'font-variant-numeric: tabular-nums')
  expectMatch(
    '[data-progress-ring] [data-progress-text][data-text-tier="long"]',
    /font: var\(--dsw-font-xs-13, 13px\/16px sans-serif\)/,
  )
  expectDecl('[data-progress-ring] [data-progress-text][data-text-tier="long"]', 'font-variant-numeric: tabular-nums')

  // 旧几何必须彻底退场：64px 环、stroke 6、r28 都不许留下
  assert.equal(CSS.includes('stroke-width: 6'), false, '旧环 stroke-width: 6 未清理')
  assert.equal(CSS.includes('rotate(-90 32 32)'), false, '旧 64 环的旋转中心残留')
})

test('r16 角色列头：180×32、18 徽标、13/600 名字、×N 计数', () => {
  const stage = '[data-region="task-flow"] [data-flow-stage]'
  expectDecl(stage, 'position: absolute')
  expectDecl(stage, 'width: 180px')
  expectDecl(stage, 'height: 32px')
  expectDecl(stage, 'gap: 6px')
  expectDecl(stage, 'padding: 0 8px')
  expectDecl(stage, 'border: 1px solid var(--dsw-alias-border-l1, currentColor)')
  expectDecl(stage, 'border-radius: var(--dsw-radius-sm, 8px)')
  expectDecl(stage, 'background: var(--dsw-alias-bg-layer-2, transparent)')

  const badge = '[data-region="task-flow"] [data-flow-stage-badge]'
  expectDecl(badge, 'width: 18px')
  expectDecl(badge, 'height: 18px')
  expectDecl(badge, 'border-radius: 999px')
  expectDecl(badge, 'border: 1px solid var(--dsw-alias-border-l2, currentColor)')
  expectDecl(badge, 'background: var(--dsw-alias-bg-layer-1, transparent)')
  expectMatch(badge, /font: var\(--dsw-font-xxxs-11, 11px\/16px sans-serif\)/)
  expectDecl(badge, 'font-weight: 600')
  expectDecl(badge, 'font-variant-numeric: tabular-nums')

  const name = '[data-region="task-flow"] [data-flow-stage-name]'
  expectMatch(name, /font: var\(--dsw-font-xs-13, 13px\/20px sans-serif\)/)
  expectDecl(name, 'font-weight: 600')
  expectMatch(name, /text-overflow: ellipsis/)
  expectDecl(name, 'flex: 1 1 auto')
  expectDecl(name, 'min-width: 0')

  const count = '[data-region="task-flow"] [data-flow-stage-count]'
  expectDecl(count, 'flex: 0 0 auto')
  expectDecl(count, 'color: var(--dsw-alias-label-secondary, inherit)')
  expectMatch(count, /font: var\(--dsw-font-xxxs-11, 11px\/16px sans-serif\)/)
  expectDecl(count, 'font-variant-numeric: tabular-nums')

  // 列间箭头不吃指针（拖动/点击都交给节点）
  expectDecl('[data-region="task-flow"] [data-flow-stage-link]', 'pointer-events: none')
})

test('r16 画布节点：180×64、tN 徽标 24×18 code 字体、标题 ellipsis', () => {
  const node = '[data-region="task-flow"] [data-flow-node]'
  expectDecl(node, 'width: 180px')
  expectDecl(node, 'height: 64px')
  expectDecl(node, 'gap: 4px')
  expectDecl(node, 'padding: 8px 10px')
  assert.equal(/[\s;{]height: 76px/.test(CSS), false, '旧节点 76px 几何未清理')

  const id = '[data-region="task-flow"] [data-flow-node-id]'
  expectDecl(id, 'min-width: 24px')
  expectDecl(id, 'height: 18px')
  expectDecl(id, 'padding: 0 4px')
  expectDecl(id, 'border-radius: var(--dsw-radius-xs, 4px)')
  expectDecl(id, 'background: var(--dsw-alias-bg-layer-2, transparent)')
  expectDecl(id, 'text-align: center')
  expectDecl(id, 'border: 1px solid var(--dsw-alias-border-l1, currentColor)')
  expectMatch(id, /font: 600 11px\/18px var\(--ds-font-family-code, ui-monospace, monospace\)/)
  expectDecl(id, 'font-variant-numeric: tabular-nums')

  const title = '[data-region="task-flow"] [data-flow-node-title]'
  expectDecl(title, 'flex: 1 1 auto')
  expectDecl(title, 'min-width: 0')
  expectMatch(title, /text-overflow: ellipsis/)
  expectMatch(title, /font: var\(--dsw-font-xxxs-11, 11px\/16px sans-serif\)/)

  // 节点首行容器：tN + 标题 + 状态胶囊同高 20
  const titleLine = '[data-region="task-flow"] [data-flow-line="title"]'
  expectDecl(titleLine, 'display: flex')
  expectDecl(titleLine, 'align-items: center')
  expectDecl(titleLine, 'gap: 4px')
  expectDecl(titleLine, 'height: 20px')

  // 第二行数字不省略：token/用时 flex:0 0 auto，分隔点 label-tertiary
  expectDecl('[data-region="task-flow"] [data-flow-line="meta"] [data-cell="token"]', 'flex: 0 0 auto')
  expectDecl('[data-region="task-flow"] [data-flow-line="meta"] [data-cell="duration"]', 'flex: 0 0 auto')
  expectDecl('[data-region="task-flow"] [data-flow-sep]', 'color: var(--dsw-alias-label-tertiary, inherit)')
})

test('r16 状态胶囊：18 高 / 999 / 11-500 / 5 个 tone 的 10% 底与 40% 边', () => {
  const status = '[data-region="task-flow"] [data-flow-status]'
  expectDecl(status, 'height: 18px')
  expectDecl(status, 'max-width: 48px')
  expectDecl(status, 'padding: 0 5px')
  expectDecl(status, 'border-radius: 999px')
  expectMatch(status, /font: var\(--dsw-font-xxxs-11, 11px\/16px sans-serif\)/)
  expectDecl(status, 'font-weight: 500')
  expectDecl(status, 'display: inline-flex')
  expectDecl(status, 'justify-content: center')
  expectMatch(status, /text-overflow: ellipsis/)

  const tones: Array<[string, string]> = [
    ['business', '--dsw-alias-state-business-primary'],
    ['success', '--dsw-alias-state-success-primary'],
    ['warn', '--dsw-alias-state-warn-primary'],
    ['danger', '--dsw-alias-state-error-primary'],
  ]
  for (const [tone, token] of tones) {
    const selector = `[data-region="task-flow"] [data-flow-status][data-tone="${tone}"]`
    expectDecl(selector, `color: var(${token}, currentColor)`)
    expectDecl(
      selector,
      `border-color: color-mix(in srgb, var(${token}, currentColor) 40%, transparent)`,
    )
    expectDecl(
      selector,
      `background: color-mix(in srgb, var(${token}, currentColor) 10%, transparent)`,
    )
  }
  // neutral：文字仍可读（label-secondary），不用 color-mix
  const neutral = '[data-region="task-flow"] [data-flow-status][data-tone="neutral"]'
  expectDecl(neutral, 'color: var(--dsw-alias-label-secondary, inherit)')
  expectDecl(neutral, 'border-color: var(--dsw-alias-border-l1, currentColor)')
  expectDecl(neutral, 'background: var(--dsw-alias-bg-layer-2, transparent)')
})

test('r16 角色卡 refs：tN chip + 6px 状态彩点（5 tone 全靠 currentColor）', () => {
  const line = '[data-role-grid] [data-role-line="refs"]'
  expectDecl(line, 'display: flex')
  expectDecl(line, 'flex-wrap: wrap')
  expectDecl(line, 'gap: 4px')
  expectDecl(line, 'min-height: 18px')
  expectDecl('[data-role-grid] [data-role-task-refs]', 'flex-wrap: wrap')
  expectDecl('[data-role-grid] [data-role-task-refs]', 'gap: 4px')
  expectDecl('[data-role-grid] [data-role-task-refs]', 'min-height: 18px')

  const chip = '[data-role-grid] [data-role-task-ref]'
  expectDecl(chip, 'display: inline-flex')
  expectDecl(chip, 'height: 18px')
  expectDecl(chip, 'padding: 0 4px')
  expectDecl(chip, 'border-radius: 999px')
  expectDecl(chip, 'border: 1px solid var(--dsw-alias-border-l1, currentColor)')
  expectDecl(chip, 'background: var(--dsw-alias-bg-layer-2, transparent)')
  expectDecl(chip, 'max-width: 100%')

  const dot = '[data-role-grid] [data-task-ref-dot]'
  expectDecl(dot, 'width: 6px')
  expectDecl(dot, 'height: 6px')
  expectDecl(dot, 'margin-right: 4px')
  expectDecl(dot, 'border-radius: 50%')
  expectDecl(dot, 'background: currentColor')

  const dotTones: Array<[string, string]> = [
    ['business', '--dsw-alias-state-business-primary'],
    ['success', '--dsw-alias-state-success-primary'],
    ['warn', '--dsw-alias-state-warn-primary'],
    ['danger', '--dsw-alias-state-error-primary'],
    ['neutral', '--dsw-alias-label-tertiary'],
  ]
  for (const [tone, token] of dotTones) {
    expectDecl(
      `[data-role-grid] [data-task-ref-dot][data-tone="${tone}"]`,
      `color: var(${token}, currentColor)`,
    )
  }

  const refId = '[data-role-grid] [data-task-ref-id]'
  expectMatch(refId, /font: 600 11px\/16px var\(--ds-font-family-code, ui-monospace, monospace\)/)
  expectDecl(refId, 'font-variant-numeric: tabular-nums')
  expectMatch(refId, /text-overflow: ellipsis/)
})

test('r16 左栏 glyph 与右栏内联库：32 条 / 28 返回键 / 11-500 提示', () => {
  const glyph = '[data-auto-team-panellist][data-panellist-glyph]'
  expectDecl(glyph, 'display: block')
  expectDecl(glyph, 'opacity: 0.9')
  expectDecl(glyph, 'color: inherit')
  expectDecl(`${glyph}:hover`, 'opacity: 1')
  expectDecl(`${glyph}:active`, 'transform: scale(0.92)')
  expectDecl(
    `${glyph}[data-open-error="true"]`,
    'color: var(--dsw-alias-state-error-primary, currentColor)',
  )

  const inline = '[data-auto-team-panel] [data-panel-library-inline]'
  expectDecl(inline, 'display: flex')
  expectDecl(inline, 'flex: 1 1 auto')
  expectDecl(inline, 'flex-direction: column')
  expectDecl(inline, 'min-height: 0')
  expectDecl(inline, 'overflow: hidden')

  const bar = '[data-auto-team-panel] [data-panel-library-bar]'
  expectDecl(bar, 'height: 32px')
  expectDecl(bar, 'padding: 0 8px')
  expectDecl(bar, 'gap: 8px')
  expectDecl(bar, 'border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor)')
  expectDecl(bar, 'background: var(--dsw-alias-bg-layer-2, transparent)')

  const back = '[data-auto-team-panel] [data-library-inline-back]'
  expectDecl(back, 'height: 28px')
  expectDecl(back, 'border-radius: var(--dsw-radius-xs, 4px)')
  expectDecl(back, 'border: 1px solid var(--dsw-alias-border-l2, currentColor)')
  expectDecl(back, 'cursor: pointer')
  expectMatch(back, /font: var\(--dsw-font-xxxs-11, 11px\/16px sans-serif\)/)
  assert.ok(has(`${back}:focus-visible`), '返回键缺 :focus-visible')
  assert.ok(has(`${back}:hover`), '返回键缺 :hover')

  const hint = '[data-auto-team-panel] [data-panel-library-hint]'
  expectDecl(hint, 'color: var(--dsw-alias-label-secondary, inherit)')
  expectDecl(hint, 'font-weight: 500')
  expectDecl(hint, 'white-space: nowrap')
  expectMatch(hint, /text-overflow: ellipsis/)
  expectMatch(hint, /font: var\(--dsw-font-xxxs-11, 11px\/16px sans-serif\)/)

  for (const selector of [
    '[data-auto-team-panel] [data-panel-library-warn]',
    '[data-auto-team-panel] [data-library-notice]:empty',
  ]) {
    expectDecl(selector, 'width: 6px')
    expectDecl(selector, 'height: 6px')
    expectDecl(selector, 'border-radius: 50%')
    expectDecl(selector, 'background: var(--dsw-alias-state-warn-primary, currentColor)')
  }

  // 内联库主体继续走 LibraryPage 自己的滚动，不产生第二个滚动容器
  expectDecl('[data-auto-team-panel] [data-panel-library-inline] [data-auto-team-library]', 'overflow: hidden')
})

test('r16 全局样式纪律：字号只走 font 简写、不新增设计 token、旧几何不回归', () => {
  // ① font-size: var(--dsw-font…) 是无效声明（该 token 是 font 简写），必须零命中
  assert.equal(
    /font-size:\s*var\(--dsw-font/.test(CSS),
    false,
    '出现 font-size: var(--dsw-font…)：该 token 是 font 简写，必须改用 font:',
  )
  // ② 不新增/覆盖 --dsw-* 自定义属性（只用、不定义）
  assert.equal(
    /(^|[;{\s])--dsw-[a-z0-9-]+\s*:/.test(CSS),
    false,
    '样式表里定义了 --dsw-* 变量：设计 token 只能由宿主提供',
  )
  // ③ 旧 r14 几何退场：76 节点、64 环、56 胶囊、列步进 220 的 node 高度
  assert.equal(/[\s;{]height: 76px/.test(CSS), false, '旧节点 76px 残留')
  assert.equal(CSS.includes('stroke-width: 6'), false, '旧环 stroke 6 残留')
  assert.equal(/\[data-progress-ring\][^}]*width: 64px/.test(CSS), false, '旧环 64px 残留')
  assert.equal(CSS.includes('max-width: 56px'), false, '旧状态文字 max-width 56 残留')
  // ④ 节点两行结构：角色名不再占据节点主标签（旧选择器已删除）
  assert.equal(has('[data-region="task-flow"] [data-flow-node-role]'), false, '节点内角色名选择器应删除')

  // ⑤ reduced-motion：新增的动效全部有降级
  const reduced = RULES.filter((rule) => rule.body.includes('transition: none'))
  assert.ok(reduced.length > 0, '缺少 prefers-reduced-motion 降级块')
  const reducedAll = reduced.map((rule) => rule.selectors.join(',')).join('\n')
  assert.match(reducedAll, /data-panellist-glyph/)
  assert.match(reducedAll, /data-panel-library-inline/)
  assert.match(reducedAll, /data-ring-arc/)
})

test('r16 样式表语法：花括号配对，且新增钩子只定义一次', () => {
  let depth = 0
  for (const ch of CSS) {
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      assert.ok(depth >= 0, '出现多余的 }')
    }
  }
  assert.equal(depth, 0, '花括号未配对（构建会被静默吞掉一整段规则）')

  // 同一钩子写两处 = 后一处覆盖前一处，两处漂移时测试看不出来；新钩子必须单点定义
  const unique = [
    '[data-region="task-flow"] [data-flow-stage]',
    '[data-region="task-flow"] [data-flow-node-id]',
    '[data-region="task-flow"] [data-flow-status]',
    '[data-role-grid] [data-role-task-ref]',
    '[data-role-grid] [data-task-ref-dot]',
    '[data-auto-team-panel] [data-panel-library-bar]',
    '[data-auto-team-panel] [data-panel-library-hint]',
    '[data-auto-team-panellist][data-panellist-glyph]',
    '[data-progress-ring] [data-progress-text][data-text-tier="short"]',
  ]
  for (const selector of unique) {
    // reduced-motion 块允许再列一次（只写 transition/animation: none），不算重复定义
    const count = RULES.filter(
      (rule) => rule.selectors.includes(selector) && !rule.body.includes('transition: none'),
    ).length
    assert.equal(count, 1, `选择器重复定义：${selector}（出现 ${count} 次）`)
  }
})
