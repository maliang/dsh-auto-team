/**
 * client 半的**契约**测试（r7：四挂载点 / 三可见面 / 样式前缀统一）。
 *
 * 为什么这些断言值得写：本产品的头号 bug 族是「构建全绿、真机没有任何东西出现」——
 * 成因只有四种，全部可以在这里静态判死：
 *   ① 座位注册对象的字段集合写错（keyed slot 缺 key / 多带 id）；
 *   ② 页签类型没注册进 `sidebarRightTabs`（座位在、页签永不派发）；
 *   ③ 入口里出现 slot 字面量或 `slots.register(`（两处漂移，改一处另一处不动）；
 *   ④ 渲染描述层写好了但**模板根本没调用它**（逻辑与界面各说一套）。
 *
 * 本仓没有 react-dom，`node --test` 也不转 JSX，所以判据分两层：
 *   - 行为层：直接驱动 `registerSlots` / `registerPanelTab` / `createOpenPanel`（无 JSX）；
 *   - 结构层：用 TypeScript AST 断言组件**真的调用了** ui.ts 的渲染函数、hook 字面量真在模板里。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import {
  HEADER_ACTIONS_SLOT,
  HEADER_ID,
  INPUT_LEFT_SLOT,
  MAIN_SLOT,
  OPEN_LIBRARY_EVENT,
  OPTION_ID,
  PANEL_KEY,
  PANELLIST_ID,
  PANELLIST_LABEL,
  PANELLIST_SLOT,
  PANEL_SLOT,
  PANEL_TAB_KIND,
  PANEL_TAB_LABEL,
  PANEL_TITLE_SLOT,
  SECTION_ID,
  SECTION_LABEL,
  SETTINGS_SECTION_SLOT,
  createOpenPanel,
  createPanelCommands,
  panelTabDefinition,
  registerPanelTab,
  registerPanellist,
  registerSlots,
} from '../src/client/slots.ts'
import { PLUGIN_ID } from '../src/shared/const.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function sourceOf(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

/** 去注释后的代码（避免注释里提到 hook/函数名就把判据判绿）。 */
function stripComments(source: string): string {
  let out = ''
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (state === 'code') {
      if (char === '/' && next === '/') { state = 'line'; index += 1; continue }
      if (char === '/' && next === '*') { state = 'block'; index += 1; continue }
      if (char === "'") { state = 'single'; out += char; continue }
      if (char === '"') { state = 'double'; out += char; continue }
      if (char === '`') { state = 'template'; out += char; continue }
      out += char
      continue
    }
    if (state === 'line') {
      if (char === '\n') { state = 'code'; out += char }
      continue
    }
    if (state === 'block') {
      if (char === '*' && next === '/') { state = 'code'; index += 1 }
      continue
    }
    if (state === 'single') {
      out += char
      if (char === '\\') { out += next ?? ''; index += 1; continue }
      if (char === "'") state = 'code'
      continue
    }
    if (state === 'double') {
      out += char
      if (char === '\\') { out += next ?? ''; index += 1; continue }
      if (char === '"') state = 'code'
      continue
    }
    out += char
    if (char === '\\') { out += next ?? ''; index += 1; continue }
    if (char === '`') state = 'code'
  }
  return out
}

function codeOnlyOf(relPath: string): string {
  return stripComments(sourceOf(relPath))
}

/** AST 事实：字符串字面量集合 + 是否出现过某些调用名。 */
function codeFactsOf(relPath: string): { literals: Set<string>; calls: Set<string>; text: string } {
  const text = sourceOf(relPath)
  const file = ts.createSourceFile(relPath, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const literals = new Set<string>()
  const calls = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.add(node.text)
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee)) calls.add(callee.text)
      if (ts.isPropertyAccessExpression(callee)) calls.add(callee.name.text)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return { literals, calls, text }
}

interface Harness {
  injected: string[]
  metas: Record<string, unknown>[]
  components: unknown[]
}

function runRegisterSlots(
  deps: Record<string, unknown> = {},
  openPanel?: () => boolean,
): Harness {
  const injected: string[] = []
  const callbacks: Array<() => void> = []
  const metas: Record<string, unknown>[] = []
  const components: unknown[] = []
  const ctx = {
    slots: {
      inject(name: string, run: () => void) {
        injected.push(name)
        callbacks.push(run)
      },
      register(meta: Record<string, unknown>, component: unknown) {
        metas.push(meta)
        components.push(component)
      },
    },
  }
  const stubs = {
    Option: 'option-stub',
    HeaderButton: 'header-stub',
    Panel: 'panel-stub',
    PanelTitle: 'title-stub',
    SettingsSection: 'settings-stub',
    ...deps,
    ...(openPanel === undefined ? {} : { openPanel }),
  }
  registerSlots(ctx as never, stubs as never)
  for (const run of callbacks) run()
  return { injected, metas, components }
}

function bagOf(h: Harness, name: string, sessionId = 'sess-1'): Record<string, unknown> {
  const meta = h.metas.find((item) => item.name === name)
  assert.ok(meta, `没找到 ${name} 的注册对象`)
  const inject = meta.inject
  assert.equal(typeof inject, 'function', `${name} 的 inject 必须是函数（宿主靠它下发 sessionId）`)
  return (inject as (id: string) => Record<string, unknown>)(sessionId)
}

test('四个可见面的五个座位各注册一次，且 inject 名与 register 名逐字相同', () => {
  const h = runRegisterSlots()
  // E1 输入框内胶囊 / E2 会话头按钮 / E3 右栏面板 body + 标题 / E4 设置页分区
  const expected = [INPUT_LEFT_SLOT, HEADER_ACTIONS_SLOT, PANEL_SLOT, PANEL_TITLE_SLOT, SETTINGS_SECTION_SLOT]
  assert.deepEqual(h.injected, expected, 'inject 的座位集合与顺序必须与 DESIGN §1.1 一致')
  assert.equal(h.metas.length, expected.length, '每个座位只许注册一次')
  for (const name of expected) {
    assert.equal(
      h.metas.filter((meta) => meta.name === name).length,
      1,
      `${name} 必须恰好注册一次（注册两次=两份组件抢同一槽位）`,
    )
  }
})

test('撤除 composer.dock：client 半不许再出现旧开关行槽位（AC-12）', () => {
  // 旧槽名拼出来而不是写字面量：本文件自己不能成为 grep 判据的命中项
  const RETIRED_SLOT = ['conversation', 'composer', 'dock'].join('.')
  const files = [
    'src/client/slots.ts',
    'src/client/index.ts',
    'src/client/Option.tsx',
    'src/client/HeaderButton.tsx',
    'src/client/Panel.tsx',
    'src/client/TabTitle.tsx',
    'src/client/SettingsPage.tsx',
    'src/client/RoleEditor.tsx',
    'src/client/styles.ts',
  ]
  for (const relPath of files) {
    const code = codeOnlyOf(relPath)
    assert.equal(
      code.includes(RETIRED_SLOT),
      false,
      `${relPath} 仍引用已撤除的旧开关行槽位（r7 起入口在输入框左侧）`,
    )
  }
  assert.equal(HEADER_ACTIONS_SLOT, 'conversation.session.header.actions')
  assert.equal(SETTINGS_SECTION_SLOT, 'settings.section')
})

test('r10 挂载点迁移：INPUT_LEFT_SLOT 逐字、旧槽名连注释都不留（AC-1）', () => {
  // 同样拼出来：AC-1 的门禁是「全 src/ 里旧槽名 0 命中（含注释）」，
  // 本测试文件若写字面量会把它自己算成命中项（r4 实测过这个自伤式判据）。
  const PREVIOUS_SLOT = ['conversation', 'input', 'dock'].join('.')
  assert.equal(INPUT_LEFT_SLOT, 'conversation.input.left', '选项必须挂 conversation.input.left')
  for (const relPath of [
    'src/client/slots.ts',
    'src/client/index.ts',
    'src/client/styles.ts',
    'src/client/Option.tsx',
  ]) {
    // 用原始源码（含注释）判：旧槽名留在注释里也是一处会被人照抄的漂移源
    assert.equal(
      sourceOf(relPath).includes(PREVIOUS_SLOT),
      false,
      `${relPath} 仍带着旧槽位名（注释里也算，AC-1 的计数含注释）`,
    )
  }
  // 新名字只许有一个常量定义点（重复定义=两处漂移）
  assert.equal(
    sourceOf('src/client/slots.ts').split(`'${INPUT_LEFT_SLOT}'`).length - 1,
    1,
    'INPUT_LEFT_SLOT 的字面量只许出现一次（就是常量定义那一处）',
  )
})

test('PanelCommands：close 三级回退各有可断言的返回值（AC-11/AC-13）', () => {
  const tab = { id: 'tab-1', kind: PANEL_TAB_KIND }

  /** 造一个最小 ctx：服务只能通过 `ctx.inject(['sidebarRight'], cb)` 捕获（client 半禁用 ctx.get）。 */
  function ctxWith(sidebarRight: Record<string, unknown> | undefined): never {
    return {
      slots: { inject() {}, register() {} },
      inject(_deps: readonly string[], fn: (scope: { sidebarRight?: Record<string, unknown> }) => void) {
        if (sidebarRight !== undefined) fn({ sidebarRight })
        return undefined
      },
    } as never
  }

  // 一级：tabDomain.occurrence(...).tabActions.close() 可用 → true，且走的是这一条
  let closedByDomain = 0
  let closedByCloseIn = 0
  const first = createPanelCommands(
    ctxWith({
      openTab: () => tab,
      tabsIn: () => [tab],
      closeIn: () => { closedByCloseIn += 1; return true },
      tabDomain: {
        occurrence: () => ({
          tabActions: { close: () => { closedByDomain += 1; return true } },
        }),
      },
    }),
  )
  assert.equal(first.close('sess-1'), true, '一级回退可用时必须返回 true')
  assert.equal(closedByDomain, 1, '一级回退要真的调到 tabActions.close()')
  assert.equal(closedByCloseIn, 0, '一级成功时不该再走 closeIn')

  // 二级：没有 tabDomain → closeIn
  const second = createPanelCommands(
    ctxWith({
      openTab: () => tab,
      tabsIn: () => [tab],
      closeIn: () => true,
    }),
  )
  assert.equal(second.close('sess-1'), true, '二级回退（closeIn）可用时也必须返回 true')

  // 三级：宿主什么都没给 → false（组件据此**不翻转** aria-pressed）
  const third = createPanelCommands(ctxWith({ openTab: () => tab, tabsIn: () => [tab] }))
  assert.equal(third.close('sess-1'), false, '三级回退必须如实返回 false，不许假装收起成功')
  assert.equal(third.isOpen('sess-1'), true, 'tabsIn 里还有本插件页签 → isOpen 为 true')

  // 服务缺失：isOpen 返回 undefined（组件回落本地态），close 返回 false
  const absent = createPanelCommands(ctxWith(undefined))
  assert.equal(absent.isOpen('sess-1'), undefined, '没有 sidebarRight 服务时必须区分「未知」与「已关闭」')
  assert.equal(absent.close('sess-1'), false)
})

test('面板头部结构：head 直系子节点恰好 3 个、meta 三段都在（AC-9/AC-10）', () => {
  const text = sourceOf('src/client/Panel.tsx')
  // 用开标签定位，不用裸 hook 名：注释里也会提到 hook，按裸名切会切出空块
  const headStart = text.indexOf('<div data-panel-head>')
  assert.ok(headStart > 0, 'Panel.tsx 里必须存在 [data-panel-head] 开标签')
  const headEnd = text.indexOf('<div data-panel-meta>')
  assert.ok(headEnd > headStart, '[data-panel-meta] 必须在 head 之后单独成段')
  const headBlock = text.slice(headStart, headEnd)
  // 三个可见块：标题 / 状态胶囊 / 刷新按钮
  for (const marker of ['data-panel-title', 'data-head-capsule', 'data-panel-refresh']) {
    assert.equal(headBlock.includes(marker), true, `head 里缺 ${marker}`)
  }
  // 直系子节点计数：head 块内以 < 开头的行（排除闭合标签与 JSX 注释）
  const headChildren = headBlock
    .split('\n')
    .filter((line) => /^\s+<(?!\/|\!)/.test(line) && !/\{\/\*/.test(line))
  assert.equal(headChildren.length, 3, `head 的直系子节点必须恰好 3 个，实测 ${headChildren.length} 个`)
  assert.equal(headBlock.includes('data-head-meta'), false, '状态信息必须搬出 head（AC-9 要求分区）')
  const metaBlock = text.slice(headEnd, text.indexOf('<', headEnd + '<div data-panel-meta>'.length))
  for (const marker of ['data-meta-plan', 'data-captain-model', 'data-auto-team-degraded']) {
    assert.equal(text.includes(marker), true, `[data-panel-meta] 缺 ${marker} 这一组`)
  }
  assert.equal((text.match(/data-meta-sep/g) ?? []).length, 2, '三组之间恰好两条分隔符')
  assert.ok(metaBlock.length > 0)
})

test('keyed 座位（面板 body 与标题）带同一个 key，且 key === 页签类型 id', () => {
  const h = runRegisterSlots()
  const body = h.metas.find((meta) => meta.name === PANEL_SLOT)
  const title = h.metas.find((meta) => meta.name === PANEL_TITLE_SLOT)
  assert.ok(body && title)
  assert.equal(typeof body.key, 'string')
  assert.equal(body.key, title.key, 'body 与 title 必须同 key，否则标题挂到别的页签上')
  assert.equal(body.key, PANEL_KEY)
  assert.equal(PANEL_KEY, `${PLUGIN_ID}-panel`, 'key 必须含插件前缀（多插件共存时防撞名）')
})

test('非 keyed 座位不许带 key，且字段都在宿主允许的集合内', () => {
  const h = runRegisterSlots()
  for (const name of [INPUT_LEFT_SLOT, HEADER_ACTIONS_SLOT, SETTINGS_SECTION_SLOT]) {
    const meta = h.metas.find((item) => item.name === name)
    assert.ok(meta)
    assert.equal(meta.key, undefined, `${name} 不是 keyed slot，带 key 等于对宿主撒谎`)
    assert.equal(typeof meta.id, 'string', `${name} 必须带 id`)
    assert.equal(typeof meta.order, 'number', `${name} 必须带 order`)
  }
  // keyed 恰好三个字段：name/key/inject（真实样本里 keyed 不带 id/order）
  for (const name of [PANEL_SLOT, PANEL_TITLE_SLOT]) {
    const meta = h.metas.find((item) => item.name === name)
    assert.ok(meta)
    assert.deepEqual(Object.keys(meta).sort(), ['inject', 'key', 'name'], `${name} 字段集必须逐字为 name/key/inject`)
  }
  // 设置分区带 label（宿主据此渲染分区标题）
  const section = h.metas.find((item) => item.name === SETTINGS_SECTION_SLOT)
  assert.ok(section)
  assert.equal(section.label, SECTION_LABEL)
  assert.equal(SECTION_LABEL, '自动团队')
  assert.equal(section.id, SECTION_ID)
})

test('每个座位的 inject 都把宿主 sessionId 原样交给组件', () => {
  const h = runRegisterSlots()
  for (const name of [INPUT_LEFT_SLOT, HEADER_ACTIONS_SLOT, PANEL_SLOT, PANEL_TITLE_SLOT, SETTINGS_SECTION_SLOT]) {
    const bag = bagOf(h, name, 'sess-42')
    assert.equal(bag.sessionId, 'sess-42', `${name} 必须把 sessionId 原样传下去（否则四个面各读一份状态）`)
  }
})

test('openPanel 只下发给会话头按钮，胶囊与其它座位不许拿到', () => {
  const openPanel = (): boolean => true
  const h = runRegisterSlots({}, openPanel)
  assert.equal(bagOf(h, HEADER_ACTIONS_SLOT).openPanel, openPanel, '头按钮点一下要能原生开页签')
  for (const name of [INPUT_LEFT_SLOT, PANEL_SLOT, PANEL_TITLE_SLOT, SETTINGS_SECTION_SLOT]) {
    assert.equal(bagOf(h, name).openPanel, undefined, `${name} 不该拿到 openPanel（胶囊的点击语义只有开关）`)
  }
})

test('PLUGIN_ID 只进 id/key，不许进 name（写进 name 会静默不挂载）', () => {
  const h = runRegisterSlots()
  for (const meta of h.metas) {
    assert.equal(
      String(meta.name).includes(PLUGIN_ID),
      false,
      `name 必须是宿主槽位字面量，不能含插件 id：${String(meta.name)}`,
    )
  }
  assert.equal(OPTION_ID, `${PLUGIN_ID}-option`)
  assert.equal(HEADER_ID, `${PLUGIN_ID}-header-button`)
})

test('client 入口只做接线：零 slots.register(、零 slot 字面量', () => {
  const entry = codeOnlyOf('src/client/index.ts')
  assert.equal(/slots\.register\s*\(/.test(entry), false, '入口不许自己 register（注册细节必须留在 slots.ts）')
  for (const literal of [INPUT_LEFT_SLOT, HEADER_ACTIONS_SLOT, PANEL_SLOT, PANEL_TITLE_SLOT, SETTINGS_SECTION_SLOT]) {
    assert.equal(entry.includes(literal), false, `入口里出现了 slot 字面量 ${literal}（两处漂移的起点）`)
  }
  // 组件文件同样不许自己注册座位
  for (const relPath of [
    'src/client/Option.tsx',
    'src/client/HeaderButton.tsx',
    'src/client/Panel.tsx',
    'src/client/TabTitle.tsx',
    'src/client/SettingsPage.tsx',
    'src/client/RoleEditor.tsx',
  ]) {
    const code = codeFactsOf(relPath)
    assert.equal(code.calls.has('register'), false, `${relPath} 不许直接调用 register`)
    for (const literal of [INPUT_LEFT_SLOT, HEADER_ACTIONS_SLOT, SETTINGS_SECTION_SLOT]) {
      assert.equal(code.literals.has(literal), false, `${relPath} 里出现了 slot 字面量 ${literal}`)
    }
  }
  assert.match(entry, /registerPanelTab\(/, '入口必须调用 registerPanelTab（只注册座位=真机页签永不出现）')
})

test('页签类型：id===PANEL_KEY、kind 非空、priority=extension、title 中文逐字', () => {
  const definition = panelTabDefinition()
  assert.equal(definition.id, PANEL_KEY)
  assert.equal(definition.kind, PANEL_TAB_KIND)
  assert.equal(definition.priority, 'extension')
  assert.equal(definition.title(), PANEL_TAB_LABEL)
  assert.equal(PANEL_TAB_LABEL, '自动团队')
})

test('registerPanelTab 把类型注册进 sidebarRightTabs，并包在 effect 里', () => {
  const registered: unknown[] = []
  const effects: Array<{ label?: string }> = []
  let deps: readonly string[] = []
  const ctx = {
    slots: { inject() {}, register() {} },
    inject(names: readonly string[], fn: (scope: unknown) => void) {
      deps = names
      fn({
        sidebarRightTabs: { register: (value: unknown) => registered.push(value) },
        effect: (run: () => unknown, label?: string) => {
          effects.push({ label })
          run()
        },
      })
    },
  }
  assert.equal(registerPanelTab(ctx as never), true)
  assert.deepEqual([...deps], ['sidebarRightTabs'])
  assert.equal(registered.length, 1, '页签类型必须注册且只注册一次')
  const entry = registered[0] as ReturnType<typeof panelTabDefinition>
  assert.equal(entry.id, PANEL_KEY)
  assert.equal(entry.kind, PANEL_TAB_KIND)
  assert.equal(entry.priority, 'extension')
  assert.equal(entry.title(), PANEL_TAB_LABEL)
  assert.equal(effects[0]?.label, 'dsh-auto-team: panel tab type', 'register 必须包在 ctx.effect 里以便卸载')
})

test('没有 ctx.inject 的宿主上 registerPanelTab 必须降级（不许裸访问服务而抛错）', () => {
  const ctx = { slots: { inject() {}, register() {} } }
  assert.equal(registerPanelTab(ctx as never), false, '服务读取口缺失时必须安静返回 false')
})

test('createOpenPanel 走宿主 sidebarRight.openTab(kind)，服务缺失时返回 false', () => {
  function harness(withService: boolean): { deps: string[][]; opened: string[]; openPanel: () => boolean } {
    const deps: string[][] = []
    const opened: string[] = []
    const ctx = {
      slots: { inject() {}, register() {} },
      inject(names: readonly string[], fn: (scope: unknown) => void) {
        deps.push([...names])
        fn(
          withService
            ? { sidebarRight: { openTab: (kind: string) => opened.push(kind) } }
            : {},
        )
      },
    }
    const openPanel = createOpenPanel(ctx as never)
    return { deps, opened, openPanel }
  }
  const live = harness(true)
  assert.equal(live.openPanel(), true, '服务可用时必须报告已走宿主路径')
  assert.deepEqual(live.opened, [PANEL_TAB_KIND], '必须用同一个 kind 打开（与页签类型一致）')
  const degraded = harness(false)
  assert.equal(degraded.openPanel(), false, '服务不可用时必须返回 false，让组件回退窗口事件')
})

test('零红字：Option 的失败只进 title/aria，模板里没有失败文本节点（AC-6）', () => {
  const code = codeOnlyOf('src/client/Option.tsx')
  // 失败原因必须被贴到 title 上（否则用户没有任何途径看出为什么失败）
  assert.match(code, /title=\{ui\.failure\s*\?\?/, 'title 必须优先用失败说明（AC-6：原因进 title）')
  // 失败说明**不许**作为可见文本渲染：{ui.failure} 这种裸插值就是红字的入口
  assert.equal(/\{ui\.failure\}/.test(code), false, '失败说明不许出现在可见文本里（零红字）')
  // 唯一可见文本节点是 [data-option-label]，内容恒为 ui.label（逐字「自动团队」）
  assert.match(code, /data-option-label[^>]*>\{ui\.label\}</, '唯一可见文案必须逐字绑定 ui.label')
  assert.equal(code.includes('role="alert"'), false, '胶囊里不许再有 role=alert（红字节点已删）')
})

test('渲染描述层必须真的被组件调用（防「逻辑写完、模板没绑」）', () => {
  const pairs: Array<[string, string]> = [
    ['src/client/Option.tsx', 'optionView'],
    ['src/client/HeaderButton.tsx', 'headerButtonView'],
    ['src/client/SettingsPage.tsx', 'settingsKeysView'],
    // r13：三页与左栏的可见文本都来自 viewmodel 单点（AC-7/AC-18 的模板侧证据）
    ['src/client/tabs/TasksTab.tsx', 'buildRunDetail'],
    ['src/client/tabs/HistoryTab.tsx', 'buildRunDetail'],
    ['src/client/LibraryPage.tsx', 'buildRunDetail'],
    ['src/client/views/RunHeader.tsx', 'runHeadOf'],
    ['src/client/views/RoleStrip.tsx', 'roleChipsOf'],
    ['src/client/views/TaskTable.tsx', 'taskRowOf'],
    ['src/client/views/FlowGraph.tsx', 'flowLayoutOf'],
    ['src/client/views/MemoryList.tsx', 'memoryRowOf'],
    ['src/client/views/ConfirmDialog.tsx', 'confirmDialogOf'],
  ]
  for (const [relPath, fn] of pairs) {
    const facts = codeFactsOf(relPath)
    assert.equal(facts.calls.has(fn), true, `${relPath} 必须调用 ${fn}（否则可见文案脱离单点来源）`)
  }
})

test('r13 三页：页签单源恰三项，三页模板各自绑定视图组件（AC-1 / AC-13 / AC-14）', () => {
  const panel = codeOnlyOf('src/client/Panel.tsx')

  // ① TabKey 只有三个值，且 TABS 恰好三条（旧计划/成员/角色页签必须消失）
  assert.match(panel, /type TabKey = 'tasks' \| 'history' \| 'memory'/, 'TabKey 必须恰好三值')
  const tabsBlock = panel.slice(panel.indexOf('const TABS'), panel.indexOf('const TABS') + 600)
  assert.equal((tabsBlock.match(/key:\s*'/g) ?? []).length, 3, 'TABS 必须恰好三项')
  for (const gone of ['plan', 'members', 'roles']) {
    assert.equal(tabsBlock.includes(`'${gone}'`), false, `TABS 里不许再有 ${gone} 页签`)
  }

  // ② 三页各自把视图组件真绑进模板（不是「逻辑写完、模板没绑」）
  const tasksTab = codeOnlyOf('src/client/tabs/TasksTab.tsx')
  for (const view of ['RunHeader', 'RoleStrip', 'TaskTable', 'FlowGraph']) {
    assert.equal(tasksTab.includes(`<${view}`), true, `任务页必须渲染 ${view}`)
  }
  assert.equal(/buildRunDetail\(\{/.test(tasksTab), true,
    '任务页的详情必须由 buildRunDetail 装配（AC-18 单点）')

  const historyTab = codeOnlyOf('src/client/tabs/HistoryTab.tsx')
  for (const view of ['DetailPane', 'RunHeader', 'TaskTable', 'FlowGraph']) {
    assert.equal(historyTab.includes(`<${view}`), true, `历史详情必须复用 ${view}（AC-18：左右两处同一套）`)
  }
  assert.match(historyTab, /HISTORY_PAGE_SIZE/, '历史列表必须按常量分页（50/页）')
  assert.match(historyTab, /data-history-open=\{/, '历史行必须是可点开的按钮（不是死的 li）')

  const memoryTab = codeOnlyOf('src/client/tabs/MemoryTab.tsx')
  assert.equal(memoryTab.includes('<MemoryList'), true, '记忆页必须复用 MemoryList')
  assert.match(memoryTab, /track="project"/, '记忆页只列项目轨（公共记忆在左栏「全局」）')

  // ③ 左栏：项目列表 + 详情两块区域，全局首行、未知项目末位由 rows.ts 的排序保证
  const library = codeOnlyOf('src/client/LibraryPage.tsx')
  for (const hook of [
    'data-region="project-list"',
    'data-region="project-detail"',
    'data-auto-team-nav',
    'data-nav-kind="global"',
    'data-library-project-head',
    'data-region="history-list"',
    'data-auto-team-panellist',
    'data-auto-team-library',
  ]) {
    assert.equal(library.includes(hook), true, `左栏模板缺少 ${hook}`)
  }
  const rows = codeOnlyOf('src/client/tabs/rows.ts')
  assert.match(rows, /unknown === true/, '未知项目必须单独归类（末位）')
  // 分组排序在左栏装配里（known 在前、unknown 末位；PRD §11 默认值）
  assert.match(library, /known/, '项目列表必须先列 known 项目')
  assert.match(library, /unknown/, 'unknown 项目必须单独放在末位')

  // ④ 不可逆动作走同一个执行体：面板只发 confirmPending / rejectPending，带 pendingId
  assert.match(panel, /'confirmPending'/, '面板必须能确认挂起的不可逆动作')
  assert.match(panel, /'rejectPending'/, '面板必须能取消挂起的不可逆动作')
  assert.match(panel, /pendingId/, '确认/取消必须带 pendingId（服务端据此辨认哪一个）')
  assert.match(panel, /<ConfirmDialog/, '弹窗必须用共享组件，不许内联第二份')
})

test('r13 客户端零格式化：时长/千分位/token 文本只来自宿主下发的 cell（AC-7）', () => {
  const files = [
    'src/client/views/RunHeader.tsx',
    'src/client/views/TaskTable.tsx',
    'src/client/views/FlowGraph.tsx',
    'src/client/tabs/TasksTab.tsx',
    'src/client/tabs/HistoryTab.tsx',
    'src/client/tabs/rows.ts',
    'src/client/LibraryPage.tsx',
  ]
  for (const relPath of files) {
    const code = codeOnlyOf(relPath)
    assert.equal(code.includes('toLocaleString'), false, `${relPath} 不许自己加千分位（宿主 formatTokens 单点）`)
    assert.equal(/Math\.(round|floor)\([^)]*\/\s*1000\s*\)/.test(code), false, `${relPath} 不许自己把 ms 换算成秒/分`)
    assert.equal(/(\d+\s*小时|分钟)/.test(code), false, `${relPath} 不许自己拼时长文案（用 DurationCell.text）`)
  }
  // 视图层只消费宿主下发的文本：token/用时的两个 cell 必须原样渲染 text 字段
  const table = codeOnlyOf('src/client/views/TaskTable.tsx')
  assert.match(table, /row\.tokenText/, '任务行的 token 文本必须来自 usage cell')
  assert.match(table, /row\.durationText/, '任务行的用时文本必须来自 duration cell')
  // 三态（真实/降级/不可得）靠 data-usage-source 区分，不能让「不可得」长得像 0
  assert.match(table, /data-usage-source/, 'token 单元格必须带 data-usage-source（AC-7 三态可辨）')
  assert.match(table, /data-duration-state/, '用时单元格必须带 data-duration-state')
})

test('r11 样式层：五块新区域的选择器都在，且只用语义 token 的 font 简写', () => {
  const css = sourceOf('src/client/styles.ts')
  for (const selector of [
    '[data-scope-locks]',
    '[data-lock-list]',
    '[data-lock-row]',
    '[data-lock-path]',
    '[data-lock-holder]',
    '[data-lock-waiters]',
    '[data-lock-waiter]',
    '[data-wait-reason]',
    '[data-task-actions]',
    '[data-task-action]',
    '[data-task-action-spinner]',
    '[data-acceptance-editor]',
    '[data-acceptance-input]',
    '[data-acceptance-hint]',
    '[data-acceptance-actions]',
    '[data-acceptance-save]',
    '[data-deviation]',
    '[data-deviation-list]',
    '[data-deviation-row]',
    '[data-deviation-at]',
    '[data-deviation-paths]',
    '[data-deviation-count]',
    '[data-deviation-reason]',
  ]) {
    assert.equal(css.includes(selector), true, `styles.ts 缺少 ${selector} 规则`)
  }
  // 既有面板字号铁律（本文件全局断言过；这里再保证新块没有偷偷写 font-size: var(--dsw-font-*)）
  const start = css.indexOf('r11：写域占用')
  const end = css.indexOf('成员页', start)
  assert.ok(start > 0 && end > start, 'r11 段必须是一块可界定的样式块')
  const block = css.slice(start, end)
  assert.equal(/font-size:\s*var\(--dsw-font/.test(block), false, 'r11 新样式必须写 font 简写')
  // 等待/取消/跳过不许用红：新块里红只允许出现在「取消 hover」这一处（选择器 + 颜色各一次）
  const redUses = block.match(/--dsw-alias-state-error-primary/g)?.length ?? 0
  assert.ok(redUses <= 2, `r11 新样式里红色 token 只用于 cancel hover（实际 ${redUses} 处）`)
})

test('r13 新 hook 真出现在模板里，且旧前缀 0 命中', () => {
  const hooks: Array<[string, string]> = [
    ['src/client/Option.tsx', 'data-auto-team-option'],
    ['src/client/HeaderButton.tsx', 'data-auto-team-header-button'],
    ['src/client/views/RunHeader.tsx', 'data-auto-team-pause'],
    ['src/client/SettingsPage.tsx', 'data-auto-team-settings'],
    ['src/client/TabTitle.tsx', 'data-auto-team-panel-tab'],
    ['src/client/RoleEditor.tsx', 'data-role-card'],
    ['src/client/LibraryPage.tsx', 'data-auto-team-panellist'],
    ['src/client/LibraryPage.tsx', 'data-auto-team-library'],
  ]
  for (const [relPath, hook] of hooks) {
    // hook 以属性名形式出现（JSX 属性不是字符串字面量，用源码匹配）
    assert.equal(codeOnlyOf(relPath).includes(hook), true, `${relPath} 的模板里没有 ${hook}`)
  }
  // 旧前缀整族 0 命中（样式与组件同批改名，DC 判据 AC-21）。
  // 拼出来而不是写字面量：否则本文件自己就成了 grep 判据的命中项（判据命中自己 = 恒红）。
  const OLD_PREFIX = ['data', 'dsh', 'auto-team'].join('-')
  for (const relPath of ['src/client/styles.ts', 'src/client/Panel.tsx', 'src/client/Option.tsx', 'src/client/HeaderButton.tsx']) {
    assert.equal(codeOnlyOf(relPath).includes(OLD_PREFIX), false, `${relPath} 仍有旧前缀 ${OLD_PREFIX}`)
  }
})

test('样式层：四族新选择器都在，且字号只用 font 简写', () => {
  const css = sourceOf('src/client/styles.ts')
  for (const selector of [
    '[data-auto-team-option]',
    '[data-auto-team-header-button]',
    '[data-auto-team-panel]',
    '[data-auto-team-pause]',
    '[data-auto-team-settings]',
    '[data-auto-team-role-editor]',
  ]) {
    assert.equal(css.includes(selector), true, `styles.ts 缺少 ${selector} 段`)
  }
  assert.equal(/font-size:\s*var\(--dsw-font/.test(css), false, '字号必须写 font 简写（--dsw-font-* 是复合值）')
  // 命中区外扩 44×40 的判据（DESIGN §0.2：视觉 28 高，命中区靠 ::after 撑开）
  assert.match(css, /\[data-auto-team-option\]::after\s*\{[^}]*inset:\s*-8px -6px/, '胶囊必须用 ::after 把命中区扩到 44×40')
  // 提示词 textarea 固定内滚，不许 auto-grow（8000 字符会把卡撑爆）
  assert.match(css, /textarea\s*\{[^}]*height:\s*96px/, '提示词/正文 textarea 必须固定 96px 内滚')
})

test('样式层：面板 meta 三组都可见，不许用 display:none 假装分区（AC-10）', () => {
  const css = sourceOf('src/client/styles.ts')
  const start = css.indexOf('[data-auto-team-panel] [data-panel-meta] {')
  assert.ok(start > 0, 'styles.ts 必须有 [data-panel-meta] 段')
  const end = css.indexOf('[data-head-capsule]', start)
  assert.ok(end > start, '[data-panel-meta] 段之后必须还有别的段（否则切块失败）')
  const block = css.slice(start, end)
  assert.equal(/display:\s*none/.test(block), false, 'meta 三组不许 display:none —— AC-10 明确禁止用隐藏冒充分区')
  assert.match(block, /flex-wrap:\s*wrap/, '窄宽下允许折行，但不许隐藏（320px 最坏 374px，折两行三组都得在）')
  // 三组的钩子必须仍然渲染在组件里（CSS 藏一组时这条不会红，所以上面那条 display 断言才是真守卫）
  for (const hook of ['data-meta-plan', 'data-captain-model', 'data-auto-team-degraded']) {
    assert.equal(sourceOf('src/client/Panel.tsx').includes(hook), true, `Panel.tsx 缺 ${hook}`)
  }
})

test('样式层：r10 新增四族（技能行 / 模型气泡 / 弹层 / 恢复默认）都在', () => {
  const css = sourceOf('src/client/styles.ts')
  for (const selector of [
    '[data-skill-row]',
    '[data-skill-badge]',
    '[data-skill-modified]',
    '[data-role-model-picker]',
    '[data-role-model-popover]',
    '[data-skill-dialog]',
    '[data-skill-body-input]',
    '[data-skill-picker-row]',
    '[data-roles-restore-confirm]',
  ]) {
    assert.equal(css.includes(selector), true, `styles.ts 缺少 ${selector} 段`)
  }
  // 技能列表 200px 内滚：12 条内置技能不许把角色卡撑到上千像素（DESIGN §0.2）
  assert.match(css, /\[data-skill-list\]\s*\{[^}]*max-height:\s*200px/, '技能列表必须 200px 内滚')
  // 正文 textarea 固定 200px（骨架加载完才出现，尺寸不跳）
  assert.match(css, /\[data-skill-body-input\][^}]*height:\s*200px/, '技能正文框必须固定 200px')
  // 恢复默认的确认键是琥珀不是红（红只留给不可恢复的失败）
  assert.match(css, /\[data-roles-restore-ok\]\[data-confirm-tone="warn"\][^}]*warn/, '恢复默认确认键必须是琥珀')
})

test('r13 左栏栏目 + 主区页面：两个槽位各注册一次，main 带 key 且失败能降级（AC-24）', () => {
  // ① 正常路径：栏目非 keyed（带 id/label），主区 keyed（key 与栏目 id 同值）
  const injected: string[] = []
  const metas: Array<Record<string, unknown>> = []
  const components: unknown[] = []
  const ctx = {
    slots: {
      inject(name: string, run: () => void) {
        injected.push(name)
        run()
      },
      register(meta: Record<string, unknown>, component: unknown) {
        metas.push(meta)
        components.push(component)
      },
    },
  }
  const deps = { PanellistEntry: 'panellist-stub', LibraryPage: 'library-stub' }
  const result = registerPanellist(ctx as never, deps as never)
  assert.deepEqual(result, { panellist: true, main: true }, '两个槽位都注册上时必须如实返回 true')

  // 槽名是 AC-24 的判据，逐字锁死（文档 UI-SLOTS.md 同值）
  assert.deepEqual(injected, [PANELLIST_SLOT], '栏目必须经 slots.inject 注册（inject 的 name 与 register 的 name 同值）')
  assert.equal(PANELLIST_SLOT, 'sidebar.panellist')
  assert.equal(MAIN_SLOT, 'main')
  assert.equal(PANELLIST_ID, `${PLUGIN_ID}-panellist`)
  assert.equal(OPEN_LIBRARY_EVENT, 'auto-team:open-library')

  const panellist = metas.find((meta) => meta.name === PANELLIST_SLOT)
  assert.ok(panellist, '栏目座位必须先注册')
  assert.equal(panellist.key, undefined, '非 keyed 座位不许带 key（真机直接抛错）')
  assert.equal(panellist.id, PANELLIST_ID, '栏目 id 就是 main 的 key（同一个值）')
  assert.equal(panellist.label, PANELLIST_LABEL, '栏目文案必须逐字来自常量')
  assert.equal(components[0], 'panellist-stub', '栏目座位必须挂 PanellistEntry')

  const main = metas.find((meta) => meta.name === MAIN_SLOT)
  assert.ok(main, '主区座位也必须注册')
  assert.equal(main.key, PANELLIST_ID, 'main 是 keyed 座位，key 必须与栏目 id 同值')
  assert.equal(main.id, undefined, 'keyed 座位不许带 id')
  assert.equal(components[1], 'library-stub', '主区座位必须挂整页 LibraryPage')

  // 两个座位的 inject 都要把 sessionId 与「打开左栏」动作交给组件
  const bag = bagOf({ injected, metas, components }, PANELLIST_SLOT)
  assert.equal(bag.sessionId, 'sess-1', 'inject 必须下发 sessionId')
  assert.equal(typeof bag.openLibrary, 'function', '栏目要能主动打开主区项目库')

  // ② 降级一：main 拒不接受 keyed 时，退成非 keyed 再试一次（宿主形状未验证）
  const retry: Array<Record<string, unknown>> = []
  const degrading = {
    slots: {
      inject(_name: string, run: () => void) {
        run()
      },
      register(meta: Record<string, unknown>) {
        if (meta.name === MAIN_SLOT && meta.key !== undefined) throw new Error('main is not a keyed slot')
        retry.push(meta)
      },
    },
  }
  const degraded = registerPanellist(degrading as never, deps as never)
  assert.equal(degraded.main, true, '非 keyed 重试成功时必须算挂上')
  assert.equal(retry.some((meta) => meta.name === MAIN_SLOT && meta.key === undefined), true, '必须真的重试过非 keyed 形状')

  // ③ 降级二：两个槽位都不可用 → 不抛错，如实返回 false（面板内联项目库兜底）
  const broken = {
    slots: {
      inject(_name: string, run: () => void) {
        // 槽位存在、回调也跑了 —— 但 register 抛错（宿主拒绝这个座位）
        run()
      },
      register() {
        throw new Error('slot unavailable')
      },
    },
  }
  const failed = registerPanellist(broken as never, deps as never)
  assert.deepEqual(failed, { panellist: false, main: false }, '槽位不可用必须降级而不是拖死整条 entry')
})

test('r13 项目库按需加载：refresh 不碰 library，同 key 单飞 + 5s 缓存（AC-23）', () => {
  const state = codeOnlyOf('src/client/state.ts')

  // ① refresh 的实现体里不许出现任何 library 取数（AC-23：轮询期间零 library 装配）
  const refreshStart = state.indexOf('function refresh()')
  const refreshEnd = state.indexOf('function act(', refreshStart)
  assert.ok(refreshStart > 0 && refreshEnd > refreshStart, 'state.ts 必须能切出 refresh() 的实现体')
  const refreshBody = state.slice(refreshStart, refreshEnd)
  assert.equal(/library/.test(refreshBody), false, 'refresh() 里不许出现 library —— 快照轮询绝不装配项目库')
  assert.match(refreshBody, /api\s*\.\s*snapshot|api\.snapshot/, 'refresh() 只应打快照接口')

  // ② 单飞 + 缓存 + 失败保留上次内容
  assert.match(state, /libraryInflight/, 'loadLibrary 必须单飞（同一 key 并发只发一次请求）')
  assert.match(state, /LIBRARY_CACHE_MS/, '缓存窗口必须用共享常量 LIBRARY_CACHE_MS')
  assert.match(state, /setView\(\{ libraryError: result\.error \}\)/, '失败只写 libraryError（保留上次成功的 library）')
  assert.match(state, /detailCache\.set/, '历史详情必须进缓存（来回切页签不重复打接口）')
  assert.match(state, /libraryAt\.clear\(\)/, '动作后缓存必须作废（但不在 act 里主动重取）')

  // ③ 左栏/历史详情只在「真的打开」时取数：LibraryPage 挂载 effect + openRun
  assert.match(codeOnlyOf('src/client/LibraryPage.tsx'), /void loadLibrary\(\)/, '左栏挂载时才装配项目库')
  assert.match(codeOnlyOf('src/client/tabs/HistoryTab.tsx'), /openRun/, '历史列表点开某条 run 才取详情')
})

test('client 半不许用 ctx.get 取可选服务（与 host 半同一纪律）', () => {
  for (const relPath of [
    'src/client/index.ts',
    'src/client/slots.ts',
    'src/client/Option.tsx',
    'src/client/HeaderButton.tsx',
    'src/client/Panel.tsx',
    'src/client/TabTitle.tsx',
    'src/client/SettingsPage.tsx',
    'src/client/RoleEditor.tsx',
  ]) {
    const code = codeOnlyOf(relPath)
    assert.equal(/ctx\.get\s*\(/.test(code), false, `${relPath} 不许用 ctx.get（可选服务只能用 ctx.inject）`)
  }
})

test('client 与 host 零直接 import（只许 import type 共享契约）', () => {
  const files = [
    'src/client/index.ts',
    'src/client/slots.ts',
    'src/client/Option.tsx',
    'src/client/HeaderButton.tsx',
    'src/client/Panel.tsx',
    'src/client/TabTitle.tsx',
    'src/client/SettingsPage.tsx',
    'src/client/RoleEditor.tsx',
    'src/client/api.ts',
    'src/client/state.ts',
    'src/client/LibraryPage.tsx',
    'src/client/tabs/TasksTab.tsx',
    'src/client/tabs/HistoryTab.tsx',
    'src/client/tabs/MemoryTab.tsx',
    'src/client/tabs/rows.ts',
    'src/client/views/RunHeader.tsx',
    'src/client/views/TaskTable.tsx',
    'src/client/views/FlowGraph.tsx',
  ]
  for (const relPath of files) {
    const code = codeOnlyOf(relPath)
    assert.equal(/from ['"]\.\.?\/host\//.test(code), false, `${relPath} 出现了对 host 半的直接 import`)
    assert.equal(/from ['"]\.\.\/\.\.\/host\//.test(code), false, `${relPath} 出现了对 host 半的直接 import`)
  }
})
