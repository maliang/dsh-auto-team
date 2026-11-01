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
  PANEL_TITLE_SLOT,
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
