/**
 * 挂载点契约守卫（AC-6 / AC-7）：用 fake slots **驱动真实的 `registerSlots`**。
 *
 * 为什么不能只断言「代码里写了 key」：keyed slot 的判据在**宿主运行期**
 * （缺 `key` → `Uncaught Error: keyed slot "..." requires options.key`；缺 `inject`
 * → 组件永远拿不到 sessionId，退化成兜底值 `'current'`）。构建全绿、单测全绿、页签永不出现，
 * 是 r6 之前真实发生过的缺陷。所以这里把宿主的注册口做成 fake，跑一遍真代码，
 * 断言注册对象的**字段集合与字面值**，并让缺 key 时红在 `requires key` 这条断言文本上。
 *
 * fake slots 语义照 cordis（同机样本 `dsh-better-sidebar`）：
 *   `slots.inject(name, cb)` —— 挂载点存在时才调 `cb`；`cb` 里 `slots.register(meta, comp)`。
 * 因此回调要**手动触发**（等价于挂载点存在），这样才能断言到 register 的入参。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import {
  DOCK_SLOT,
  PANEL_KEY,
  PANEL_SLOT,
  PANEL_TAB_KIND,
  PANEL_TAB_LABEL,
  PANEL_TITLE_SLOT,
  createOpenPanel,
  registerPanelTab,
  registerSlots,
  type SlotMeta,
} from '../src/client/slots.ts'
import { PLUGIN_ID } from '../src/shared/const.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

interface Injected {
  name: string
  run: () => void
}

interface Harness {
  ctx: { slots: { inject(name: string, fn: () => unknown): void; register(meta: SlotMeta, component: unknown): unknown } }
  injected: Injected[]
  metas: SlotMeta[]
  components: unknown[]
}

/** 跑一遍真实注册流程：先收集 inject，再逐个触发回调（模拟三个挂载点都存在）。 */
function runRegisterSlots(): Harness {
  const injected: Injected[] = []
  const metas: SlotMeta[] = []
  const components: unknown[] = []
  const ctx = {
    slots: {
      inject(name: string, fn: () => unknown) {
        injected.push({ name, run: () => void fn() })
      },
      register(meta: SlotMeta, component: unknown) {
        metas.push(meta)
        components.push(component)
        return meta
      },
    },
  }
  registerSlots(ctx, { Toggle: 'toggle-stub', Panel: 'panel-stub', PanelTitle: 'title-stub' })

  const beforeTrigger = metas.length
  assert.equal(beforeTrigger, 0, 'register 只能发生在 inject 回调里（挂载点不存在时零注册）')
  for (const item of injected) item.run()
  return { ctx, injected, metas, components }
}

function sourceOf(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

/** 该文件里真实的代码节点（注释/字符串不参与）——检查「不许出现」时不能只看子串，否则会命中注释。 */
function codeFactsOf(relPath: string): { registerCalls: number; literals: Set<string> } {
  const source = sourceOf(relPath)
  const kind = relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, kind)
  const literals = new Set<string>()
  let registerCalls = 0
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) literals.add(node.text)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'register') {
      registerCalls += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { registerCalls, literals }
}

/** meta 的 runtime 形状（shallow clone 后取键，避免把类型声明当作事实）。 */
function keysOf(meta: SlotMeta): string[] {
  return Object.keys(meta)
}

/**
 * 只留代码、去掉注释后的源码。
 * 「不许出现 ctx.get」这类判据必须走它：本项目注释里本来就在解释「为什么不用 ctx.get」，
 * 直接对全文做正则会把解释本身当成违规（判据写错，不是实现错了）。
 * 用状态机而不是 AST：注释作为 trivia 挂在 token 上，`getChildren` 拿不到全部注释。
 */
function stripComments(source: string): string {
  let out = ''
  let index = 0
  let mode: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  while (index < source.length) {
    const char = source[index] ?? ''
    const next = source[index + 1] ?? ''
    if (mode === 'code') {
      if (char === '/' && next === '/') {
        mode = 'line'
        index += 2
        continue
      }
      if (char === '/' && next === '*') {
        mode = 'block'
        index += 2
        continue
      }
      if (char === "'") mode = 'single'
      else if (char === '"') mode = 'double'
      else if (char === '`') mode = 'template'
      out += char
      index += 1
      continue
    }
    if (mode === 'line') {
      if (char === '\n') {
        mode = 'code'
        out += char
      }
      index += 1
      continue
    }
    if (mode === 'block') {
      if (char === '*' && next === '/') {
        mode = 'code'
        index += 2
      } else index += 1
      continue
    }
    // 字符串/模板字符串里原样保留（注释符在其中不是注释）
    if (char === '\\') {
      out += char + next
      index += 2
      continue
    }
    if (
      (mode === 'single' && char === "'") ||
      (mode === 'double' && char === '"') ||
      (mode === 'template' && char === '`')
    ) {
      mode = 'code'
    }
    out += char
    index += 1
  }
  return out
}

function codeOnlyOf(relPath: string): string {
  return stripComments(sourceOf(relPath))
}

test('三个挂载点各注册一次，且 inject 名与 register 名逐字相同', () => {
  const h = runRegisterSlots()

  assert.deepEqual(
    h.injected.map((item) => item.name),
    [DOCK_SLOT, PANEL_SLOT, PANEL_TITLE_SLOT],
    `三个挂载点必须都注册，实际 ${JSON.stringify(h.injected.map((item) => item.name))}`,
  )
  assert.equal(h.metas.length, 3, `三个 inject 回调各应注册一个组件，实际 ${h.metas.length}`)
  assert.deepEqual(h.components, ['toggle-stub', 'panel-stub', 'title-stub'], '组件必须原样交给宿主')
  for (let index = 0; index < h.injected.length; index += 1) {
    const name = h.injected[index]?.name
    const metaName = h.metas[index]?.name
    assert.equal(
      metaName,
      name,
      `inject("${String(name)}") 的回调里 register 的 name 必须是 "${String(name)}"，实际 "${String(metaName)}"`,
    )
  }
})

test('keyed slot（面板 body 与标题）必须带 key，且两处同 key', () => {
  const h = runRegisterSlots()
  const keyed = h.metas.filter((meta) => meta.name === PANEL_SLOT || meta.name === PANEL_TITLE_SLOT)
  assert.equal(keyed.length, 2, 'sidebar.right.pane.tab 与 .title 都必须注册')

  for (const meta of keyed) {
    assert.equal(
      typeof meta.key === 'string' && meta.key !== '',
      true,
      `keyed slot "${meta.name}" requires key（缺了宿主抛 Uncaught Error: keyed slot ... requires options.key，页签永不出现）`,
    )
  }
  assert.equal(
    keyed[0]?.key,
    keyed[1]?.key,
    '页签 body 与 title 必须用同一个 key，宿主据此把标题挂到同一个页签上',
  )
  assert.equal(keyed[0]?.key, PANEL_KEY, `页签 key 必须等于 PANEL_KEY（${PANEL_KEY}）`)
  assert.equal(PANEL_KEY, `${PLUGIN_ID}-panel`, 'PANEL_KEY 必须以 PLUGIN_ID 为前缀且项目内唯一')
})

test('非 keyed 的 dock 不许带 key（带上等于对非 keyed slot 撒谎）', () => {
  const h = runRegisterSlots()
  const dock = h.metas.find((meta) => meta.name === DOCK_SLOT)
  assert.ok(dock, 'dock 必须注册')
  assert.equal(dock.key, undefined, `conversation.composer.dock 不是 keyed slot，不许传 key：${String(dock.key)}`)
  assert.equal(typeof dock.id, 'string', 'dock 用 id 标识（宿主同机样本 { name, id, order }）')
  assert.equal(typeof dock.order, 'number', 'dock 用 order 控制与其它 dock 项的先后')
})

test('三处 inject 都把宿主 sessionId 原样交给组件（AC-7）', () => {
  const h = runRegisterSlots()
  assert.equal(h.metas.length, 3)
  for (const meta of h.metas) {
    assert.equal(typeof meta.inject, 'function', `${meta.name} 必须传 inject(sessionId)，否则组件永远拿到兜底值`)
    const bag = (meta.inject as (sessionId: string) => Record<string, unknown>)('sess-1')
    assert.deepEqual(bag, { sessionId: 'sess-1' }, `${meta.name} 的 inject 必须原样返回 { sessionId }`)
  }
  const distinct = new Set(h.metas.map((meta) => (meta.inject as (id: string) => Record<string, unknown>)('sess-2').sessionId))
  assert.deepEqual([...distinct], ['sess-2'], 'sessionId 必须透传真实值，不许硬编码')
})

test('PLUGIN_ID 只进 id/key，不许进 name（写进 name 会静默不挂载）', () => {
  const h = runRegisterSlots()
  for (const meta of h.metas) {
    assert.equal(meta.name.includes(PLUGIN_ID), false, `name 不许含插件名：${meta.name}`)
  }
  assert.ok(
    h.metas.some((meta) => String(meta.id ?? '').includes(PLUGIN_ID) || String(meta.key ?? '').includes(PLUGIN_ID)),
    'id/key 至少一处应以 PLUGIN_ID 标识归属',
  )
})

test('注册对象的字段集合是白名单（keyed 不许夹带 id/order，PRD 待澄清 a2 未验证）', () => {
  const h = runRegisterSlots()
  const allowed = new Set(['name', 'id', 'key', 'order', 'inject'])
  for (const meta of h.metas) {
    const extra = keysOf(meta).filter((key) => !allowed.has(key))
    assert.deepEqual(extra, [], `${meta.name} 带上了未在样本里验证过的字段：${extra.join(', ')}`)
  }
  const keyed = h.metas.filter((meta) => meta.key !== undefined)
  for (const meta of keyed) {
    assert.deepEqual(keysOf(meta).sort(), ['inject', 'key', 'name'], `keyed slot ${meta.name} 的字段集合按真实样本只有 name/key/inject`)
  }
})

test('client 入口只做接线：零 slots.register(、零 slot 字面量（防两处漂移）', () => {
  const entry = sourceOf('src/client/index.ts')
  assert.ok(entry.includes('registerSlots('), 'index.ts 必须调用 registerSlots(')
  assert.equal(
    codeFactsOf('src/client/index.ts').registerCalls,
    0,
    'index.ts 内不许直接 slots.register(（注册只许经 slots.ts 的 registerSlots，两处漂移是历史实锤的失效形态）',
  )

  const literals = [DOCK_SLOT, PANEL_SLOT, PANEL_TITLE_SLOT]
  // 组件文件同样不许重复 slot 字面量：字样只允许出现在 slots.ts。
  // 注意用 AST 取字符串字面量：这些文件的**注释**里本来就写着 slot 名（解释去哪注册），
  // 子串匹配会把注释当违规，属于「判据写错」而不是「实现错了」。
  for (const relPath of ['src/client/index.ts', 'src/client/Toggle.tsx', 'src/client/Panel.tsx', 'src/client/TabTitle.tsx']) {
    const facts = codeFactsOf(relPath)
    assert.equal(facts.registerCalls, 0, `${relPath} 不许直接 slots.register(`)
    for (const literal of literals) {
      assert.equal(
        facts.literals.has(literal),
        false,
        `${relPath} 不许出现 slot 字面量 "${literal}"（只许在 src/client/slots.ts）`,
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// QA-02 类门禁：页签**类型**必须注册进宿主 `sidebarRightTabs`，且 id 与 keyed 座位的 key 相同。
//
// 上面 7 条只验「座位注册对象的形状」，验不出「宿主根本没有这个 kind 的 tab」——
// 这正是 r6 真机不出现面板的根因（构建全绿 / 控制台零报错 / keyed 座位永不派发）。
// 所以这里用 fake `ctx.inject` 驱动真实 `registerPanelTab`，把宿主契约钉成断言：
//   ① 必须通过 `ctx.inject(['sidebarRightTabs'], cb)` 拿服务（不用 ctx.get：I8 要求它只出现在 host/adapters.ts）；
//   ② register 的入参必须带 `id === PANEL_KEY`（否则 keyed 座位的 key 指向不存在的类型）；
//   ③ 注册必须包在 `ctx.effect(...)` 里（宿主卸载时据返回的 disposer 回收）。
// ─────────────────────────────────────────────────────────────────────────────

interface TabTypeHarness {
  deps: string[][]
  effects: (string | undefined)[]
  registered: { id: string; kind: string; priority: string; title: () => string }[]
}

/** 跑一遍真实的 `registerPanelTab`：fake `ctx.inject` 收集依赖，再手动触发回调（等价服务就绪）。 */
function runRegisterPanelTab(): TabTypeHarness {
  const deps: string[][] = []
  const effects: (string | undefined)[] = []
  const registered: TabTypeHarness['registered'] = []
  const pending: (() => void)[] = []
  const scope = {
    sidebarRightTabs: {
      register(definition: TabTypeHarness['registered'][number]) {
        registered.push(definition)
        return () => {}
      },
    },
    effect(fn: () => unknown, label?: string) {
      effects.push(label)
      pending.push(() => void fn())
      return () => {}
    },
  }
  const ctx = {
    slots: { inject() {}, register: () => ({}) },
    inject(names: readonly string[], fn: (value: unknown) => void) {
      deps.push([...names])
      pending.push(() => fn(scope))
    },
  }

  const ok = registerPanelTab(ctx as unknown as Parameters<typeof registerPanelTab>[0])
  assert.equal(ok, true, 'registerPanelTab 必须在有 ctx.inject 时返回 true（false=宿主契约缺失，页签永不出现）')
  assert.equal(registered.length, 0, 'register 只能发生在 ctx.inject 回调里（服务未就绪时零注册）')
  for (const run of pending) run()
  return { deps, effects, registered }
}

test('页签类型必须注册进 sidebarRightTabs：id===PANEL_KEY、kind 非空、priority 为 extension', () => {
  const h = runRegisterPanelTab()

  assert.deepEqual(h.deps, [['sidebarRightTabs']], `必须经 ctx.inject 取 sidebarRightTabs 服务，实际 ${JSON.stringify(h.deps)}`)
  assert.equal(h.registered.length, 1, `必须注册恰好一个页签类型，实际 ${h.registered.length}`)
  const definition = h.registered[0]
  assert.ok(definition, '页签类型定义必须存在')
  assert.equal(
    definition.id,
    PANEL_KEY,
    `页签类型 id 必须是 "${PANEL_KEY}"，否则 keyed 座位（key 同为 PANEL_KEY）永不派发`,
  )
  assert.ok(typeof definition.kind === 'string' && definition.kind !== '', 'kind 不能为空：sidebarRight.openTab 按 kind 打开')
  assert.equal(definition.priority, 'extension', '第三方插件必须声明 priority="extension"（样本 dsh-plugin-teamflow 同）')
  assert.equal(typeof definition.title, 'function', 'title 必须是函数（宿主在渲染时取值）')
  assert.equal(definition.title(), PANEL_TAB_LABEL, `页签标题必须与 PANEL_TAB_LABEL（${PANEL_TAB_LABEL}）一致`)
  assert.deepEqual(
    h.effects,
    ['dsh-auto-team: panel tab type'],
    `注册必须包在 ctx.effect 里，实际 ${JSON.stringify(h.effects)}`,
  )
})

test('页签类型 id 与两处 keyed 座位的 key 逐一相等（缺类型=座位永不派发）', () => {
  const tabs = runRegisterPanelTab()
  const seats = runRegisterSlots()
  const definition = tabs.registered[0]
  assert.ok(definition, '页签类型定义必须存在')
  const keyed = seats.metas.filter((meta) => meta.name === PANEL_SLOT || meta.name === PANEL_TITLE_SLOT)
  assert.equal(keyed.length, 2, 'sidebar.right.pane.tab 与 .title 都必须注册')
  for (const meta of keyed) {
    assert.equal(
      meta.key,
      definition.id,
      `${meta.name} 的 key 必须等于页签类型 id（${definition.id}），否则宿主找不到该 kind 的 tab`,
    )
  }
})

test('没有 ctx.inject 的宿主上 registerPanelTab 必须降级（不许裸访问服务而抛错）', () => {
  const ctx = { slots: { inject() {}, register: () => ({}) } }
  const ok = registerPanelTab(ctx as unknown as Parameters<typeof registerPanelTab>[0])
  assert.equal(ok, false, '拿不到 ctx.inject 时必须返回 false 而不是抛错（整条 client entry 不许因可选服务崩掉）')
})

// ─────────────────────────────────────────────────────────────────────────────
// QA-02 配套：页面型页签必须**打开**才会出现（`sidebarRight.openTab`）。
// 旧实现只 `window.dispatchEvent` 一个自己定义的事件，页签未打开时没有监听者 → 按钮无效。
// ─────────────────────────────────────────────────────────────────────────────

test('createOpenPanel 走宿主 sidebarRight.openTab(kind)，服务缺失时返回 false', () => {
  function harness(withService: boolean): { deps: string[][]; opened: string[]; openPanel: () => boolean } {
    const deps: string[][] = []
    const opened: string[] = []
    const pending: ((value: unknown) => void)[] = []
    const ctx = {
      slots: { inject() {}, register: () => ({}) },
      inject(names: readonly string[], fn: (value: unknown) => void) {
        deps.push([...names])
        pending.push(fn)
      },
    }
    const openPanel = createOpenPanel(ctx as unknown as Parameters<typeof createOpenPanel>[0])
    if (withService) {
      for (const fn of pending) fn({ sidebarRight: { openTab: (kind: string) => opened.push(kind) } })
    }
    return { deps, opened, openPanel }
  }

  const live = harness(true)
  assert.deepEqual(live.deps, [['sidebarRight']], `必须经 ctx.inject 取 sidebarRight 服务，实际 ${JSON.stringify(live.deps)}`)
  assert.equal(live.openPanel(), true, '服务可用时必须报告已走宿主路径')
  assert.deepEqual(live.opened, [PANEL_TAB_KIND], `必须用 sidebarRight.openTab(kind) 打开页签，实际打开 ${JSON.stringify(live.opened)}`)

  const degraded = harness(false)
  assert.equal(degraded.openPanel(), false, '服务不可用时必须返回 false，让组件回退旧行为')
  assert.deepEqual(degraded.opened, [], '服务不可用时不许假装打开')
})

test('开关行拿得到 openPanel（宿主服务就绪时随 inject 下发给 Toggle）', () => {
  const openPanel = (): boolean => true
  const injected: { name: string; run: () => void }[] = []
  const metas: SlotMeta[] = []
  const ctx = {
    slots: {
      inject(name: string, fn: () => unknown) {
        injected.push({ name, run: () => void fn() })
      },
      register(meta: SlotMeta) {
        metas.push(meta)
        return meta
      },
    },
  }
  registerSlots(ctx, { Toggle: 'toggle-stub', Panel: 'panel-stub', PanelTitle: 'title-stub', openPanel })
  for (const item of injected) item.run()

  const dock = metas.find((meta) => meta.name === DOCK_SLOT)
  assert.ok(dock, 'dock 必须注册')
  const bag = (dock.inject as (sessionId: string) => Record<string, unknown>)('sess-9')
  assert.equal(bag.sessionId, 'sess-9', 'sessionId 必须照旧透传')
  assert.equal(bag.openPanel, openPanel, '宿主服务就绪时 openPanel 必须随 inject 下发给 Toggle（否则「面板」按钮回退到无效的窗口事件）')
})

test('client 入口必须调用 registerPanelTab（只注册座位=真机永不出现页签）', () => {
  const entry = sourceOf('src/client/index.ts')
  assert.ok(
    entry.includes('registerPanelTab('),
    'index.ts 必须调用 registerPanelTab(：页签类型不注册，keyed 座位永不派发（QA-02 的根因）',
  )
  assert.equal(
    codeFactsOf('src/client/index.ts').registerCalls,
    0,
    'index.ts 仍不许直接 slots.register(（注册细节留在 slots.ts）',
  )
})

test('client 半不许用 ctx.get 取可选服务（与 host 半同一纪律：只许 adapters.ts）', () => {
  for (const relPath of ['src/client/index.ts', 'src/client/slots.ts', 'src/client/Toggle.tsx', 'src/client/TabTitle.tsx']) {
    assert.equal(
      /\bctx\s*\.\s*get\b/.test(codeOnlyOf(relPath)),
      false,
      `${relPath} 不许用 ctx.get（可选服务只许经 ctx.inject 回调取；QA 的 I8 判据要求 ctx.get 只出现在 src/host/adapters.ts）`,
    )
  }
})
