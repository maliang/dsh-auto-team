/**
 * r16 T6：左栏 glyph / 右栏内联项目库的可见性协议（AC-8 / AC-9）。
 *
 * 这一层判据分两段：
 *   ① 行为层：直接驱动 `visibleLibrarySurface` / `consumeLibraryOpenRequest` / `createOpenLibrary`
 *      （`slots.ts` 是纯 TS、零 JSX，能在 node --test 里跑真实代码）；
 *   ② 结构层：`node --test` 不转 JSX，组件只能按源码判据 —— `data-last-open-result`、
 *      逐字 hint、`data-library-surface` 必须真的出现在模板里（不是只写在注释/样式里）。
 *
 * 为什么必须测 watchdog：宿主 `mainArea.open()` 说「开了」但主区没挂载时，
 * 没有 watchdog 的版本会返回 main 然后什么都不出现 —— 这正是用户报的「点了没反应」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIBRARY_OPEN_PENDING_MS,
  LIBRARY_OPEN_WATCHDOG_MS,
  LIBRARY_SURFACE_ATTR,
  OPEN_LIBRARY_EVENT,
  PANEL_TAB_KIND,
  PANELLIST_ID,
  consumeLibraryOpenRequest,
  createOpenLibrary,
  markLibraryOpenRequest,
  resetLibraryOpenRequest,
  visibleLibrarySurface,
} from '../src/client/slots.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function sourceOf(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

/** 去注释后的代码：只写在注释里的钩子/文案不算数（QA 的 D1 就是这种假绿）。 */
function codeOnlyOf(relPath: string): string {
  return sourceOf(relPath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/* ─────────────────── 全局桩（node 里没有 document / window） ─────────────────── */

type Patch = Record<string, unknown>

function withGlobals<T>(patch: Patch, run: () => T): T {
  const store = globalThis as unknown as Record<string, unknown>
  const saved = new Map<string, unknown>()
  for (const key of Object.keys(patch)) {
    saved.set(key, store[key])
    store[key] = patch[key]
  }
  try {
    return run()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete store[key]
      else store[key] = value
    }
  }
}

/** 假 document：按 `[data-library-surface="main|panel"]` 返回带 getClientRects 的节点。 */
function docWith(rects: Partial<Record<'main' | 'panel', number>>): unknown {
  return {
    querySelector(selector: string) {
      const match = /data-library-surface="(main|panel)"/.exec(selector)
      if (match === null) return null
      const surface = match[1] as 'main' | 'panel'
      const count = rects[surface]
      if (count === undefined) return null
      return { getClientRects: () => ({ length: count }) }
    },
  }
}

/** 假 window：只记事件名，够判「降级事件到底派发没有」。 */
function winWithLog(): { window: unknown; events: string[] } {
  const events: string[] = []
  return {
    events,
    window: {
      dispatchEvent(event: { type?: unknown }) {
        events.push(String(event?.type))
        return true
      },
    },
  }
}

/* ─────────────────── 假 ctx：mainArea / sidebarRight 两个可选服务 ─────────────────── */

interface CtxOptions {
  withMain?: boolean
  withPanel?: boolean
  openResult?: unknown
  openThrows?: boolean
}

function fakeCtx(options: CtxOptions = {}): {
  ctx: unknown
  mainCalls: string[]
  openTabs: string[]
} {
  const mainCalls: string[] = []
  const openTabs: string[] = []
  const scope: Record<string, unknown> = {}
  if (options.withMain !== false) {
    scope.mainArea = {
      open(id: string) {
        mainCalls.push(id)
        if (options.openThrows === true) throw new Error('main refused')
        return options.openResult
      },
    }
  }
  if (options.withPanel !== false) {
    scope.sidebarRight = {
      openTab(kind: string) {
        openTabs.push(kind)
      },
    }
  }
  const ctx = {
    slots: { inject() {}, register() {} },
    inject(_deps: readonly string[], fn: (services: Record<string, unknown>) => void) {
      fn(scope)
    },
  }
  return { ctx, mainCalls, openTabs }
}

/* ───────────────────────────── ① surface 判据 ───────────────────────────── */

test('visibleLibrarySurface：main 优先于 panel，隐藏节点不算，node 环境返回 null', () => {
  assert.equal(LIBRARY_SURFACE_ATTR, 'data-library-surface')
  assert.equal(visibleLibrarySurface(), null, '没有 document 时必须返回 null，不许抛')

  withGlobals({ document: docWith({ main: 1, panel: 1 }) }, () => {
    assert.equal(visibleLibrarySurface(), 'main', '主区与内联同时可见时以主区为准（单一 surface）')
  })
  withGlobals({ document: docWith({ panel: 1 }) }, () => {
    assert.equal(visibleLibrarySurface(), 'panel')
  })
  withGlobals({ document: docWith({ main: 0, panel: 0 }) }, () => {
    assert.equal(visibleLibrarySurface(), null, '节点在 DOM 里但 getClientRects 为空 = 不可见')
  })
  withGlobals({ document: docWith({}) }, () => {
    assert.equal(visibleLibrarySurface(), null)
  })
  withGlobals(
    {
      document: {
        querySelector() {
          throw new Error('宿主 DOM 桩不完整')
        },
      },
    },
    () => {
      assert.equal(visibleLibrarySurface(), null, '查询抛错必须吞掉，不许打断点击链')
    },
  )
})

test('pending 标记：1.5s 内有效、消费即失效、过期不算数', () => {
  resetLibraryOpenRequest()
  assert.equal(consumeLibraryOpenRequest(1000), false, '没点过时不许补开内联')

  markLibraryOpenRequest(1000)
  assert.equal(consumeLibraryOpenRequest(1000), true)
  assert.equal(consumeLibraryOpenRequest(1000), false, '消费即清空（同一次点击最多降级一次）')

  markLibraryOpenRequest(2000)
  assert.equal(consumeLibraryOpenRequest(2000 + LIBRARY_OPEN_PENDING_MS), true, '刚好 1.5s 仍算数')
  markLibraryOpenRequest(3000)
  assert.equal(consumeLibraryOpenRequest(3000 + LIBRARY_OPEN_PENDING_MS + 1), false, '过期请求不算数')
  resetLibraryOpenRequest()
})

/* ─────────────────────── ② createOpenLibrary 三种结局 ─────────────────────── */

test('主区可用且真的挂载：返回 main，watchdog 不再降级（不双开）', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    t.mock.timers.reset()
    resetLibraryOpenRequest()
  })
  const { ctx, mainCalls, openTabs } = fakeCtx()
  const openLibrary = createOpenLibrary(ctx as never)
  withGlobals({ document: docWith({ main: 1 }) }, () => {
    assert.equal(openLibrary('sess-1'), 'main')
    t.mock.timers.tick(LIBRARY_OPEN_WATCHDOG_MS)
  })
  assert.deepEqual(mainCalls, [PANELLIST_ID], '主区必须用栏目 id 打开')
  assert.deepEqual(openTabs, [], '主区已可见时不许再开面板（AC-9 第 4 条）')
})

test('open() 说成功但主区没挂载：500ms watchdog 降级到右栏并派发事件（AC-8 不静默）', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => {
    t.mock.timers.reset()
    resetLibraryOpenRequest()
  })
  const { ctx, openTabs } = fakeCtx()
  const recorder = winWithLog()
  const openLibrary = createOpenLibrary(ctx as never)
  withGlobals({ document: docWith({}), window: recorder.window }, () => {
    assert.equal(openLibrary('sess-1'), 'main', '先乐观返回 main，由 watchdog 纠正')
    assert.deepEqual(recorder.events, [], 'watchdog 之前不许急着降级（主区可能正在挂载）')
    t.mock.timers.tick(LIBRARY_OPEN_WATCHDOG_MS)
    assert.deepEqual(openTabs, [PANEL_TAB_KIND], 'watchdog 必须把右栏页签打开')
    t.mock.timers.tick(1)
    assert.deepEqual(recorder.events, [OPEN_LIBRARY_EVENT], '降级必须派发一次 open-library 事件')
  })
  assert.equal(consumeLibraryOpenRequest(), true, '降级必须留下 pending 标记供 Panel mount 消费')
})

test('主区服务缺失：立即降级 event（旧宿主 / main 未注册的路径）', () => {
  resetLibraryOpenRequest()
  const { ctx, openTabs, mainCalls } = fakeCtx({ withMain: false })
  const recorder = winWithLog()
  let result = ''
  withGlobals({ document: docWith({}), window: recorder.window }, () => {
    result = createOpenLibrary(ctx as never)('sess-1')
  })
  assert.equal(result, 'event')
  assert.deepEqual(mainCalls, [], '没有主区服务时不许假装调过')
  assert.deepEqual(openTabs, [PANEL_TAB_KIND])
  assert.deepEqual(recorder.events, [OPEN_LIBRARY_EVENT])
  assert.equal(consumeLibraryOpenRequest(), true)
  resetLibraryOpenRequest()
})

test('主区显式拒绝 / 抛错：立即降级 event，不抛未捕获异常', () => {
  resetLibraryOpenRequest()
  for (const options of [{ openResult: false }, { openThrows: true }]) {
    const { ctx, openTabs } = fakeCtx(options)
    const recorder = winWithLog()
    let result = ''
    withGlobals({ document: docWith({}), window: recorder.window }, () => {
      result = createOpenLibrary(ctx as never)('sess-1')
    })
    assert.equal(result, 'event', `mainArea.open ${JSON.stringify(options)} 时必须降级`)
    assert.deepEqual(openTabs, [PANEL_TAB_KIND])
    assert.deepEqual(recorder.events, [OPEN_LIBRARY_EVENT])
  }
  resetLibraryOpenRequest()
})

test('面板本身打不开：返回 error（glyph 据此变红，不许静默）', () => {
  resetLibraryOpenRequest()
  const { ctx } = fakeCtx({ withMain: false, withPanel: false })
  const recorder = winWithLog()
  let result = ''
  withGlobals({ window: recorder.window }, () => {
    result = createOpenLibrary(ctx as never)('sess-1')
  })
  assert.equal(result, 'error')
  resetLibraryOpenRequest()
})

test('watchdog 只用一次性 setTimeout —— src 里 setInterval 仍是 1 处', () => {
  const code = codeOnlyOf('src/client/slots.ts')
  assert.equal(/setInterval\s*\(/.test(code), false, 'slots.ts 不许出现 setInterval')
  assert.equal(code.includes('LIBRARY_OPEN_WATCHDOG_MS'), true, 'watchdog 预算必须是可测的常量')
  assert.match(code, /setTimeout\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?LIBRARY_OPEN_WATCHDOG_MS/)
})

/* ───────────────────────── ③ 组件源码钩子（不转 JSX） ───────────────────────── */

/** 切出 PanellistEntry 的实现体（到下一个顶层导出为止）。 */
function panellistBody(): string {
  const code = codeOnlyOf('src/client/LibraryPage.tsx')
  const start = code.indexOf('export function PanellistEntry')
  const end = code.indexOf('export function LibraryPage', start)
  assert.ok(start > 0 && end > start, 'LibraryPage.tsx 必须能切出 PanellistEntry 实现体')
  return code.slice(start, end)
}

test('glyph：data-last-open-result 初值 none，点后必是 main|event|error（AC-8 可观测）', () => {
  const body = panellistBody()
  assert.equal(body.includes('data-last-open-result={result}'), true, 'glyph 必须把结果写进 data-last-open-result')
  assert.match(body, /useState<GlyphOpenState>\('none'\)/, '初值必须是 none')
  assert.equal(body.includes('data-open-error'), true, 'error 分支要有 data-open-error 钩子')
  assert.equal(body.includes('项目库暂时打不开，请稍后再试'), true, 'error 的 <title> 文案必须可见')
  assert.equal(body.includes('打开项目库'), true, '正常态 <title> 必须是「打开项目库」')
  // 700ms 校准：以真实可见 surface 为准（watchdog 500ms 之后再落结果，1s 预算内完成）
  assert.match(body, /visibleLibrarySurface\(\)/, '校准必须读 visibleLibrarySurface，不能沿用返回值')
  assert.match(body, /\}\s*,\s*700\s*,?\)/, '700ms 校准定时器必须存在')
  assert.equal(body.includes('stopPropagation'), false, 'glyph 不许 stopPropagation（宿主行 selectPanel 要照常执行）')
  assert.equal(/<button/.test(body), false, 'glyph 不许包 <button>（外层已经是按钮）')
  assert.equal(body.includes('role="presentation"'), true)
  assert.equal(body.includes('data-auto-team-panellist'), true)
  // r13 的样式给 glyph 设了 pointer-events:none；不在这层兜底，onClick 永远收不到事件。
  assert.match(body, /pointerEvents:\s*'auto'/, '注入动作时必须自己重新打开 pointer-events，否则点击链断在 CSS')
})

test('Panel：单一 surface + 逐字 hint + 挂载补回内联（AC-9）', () => {
  const code = codeOnlyOf('src/client/Panel.tsx')
  assert.equal(code.includes('主区不可用，已在右栏打开'), true, '内联说明必须逐字一致')
  assert.match(code, /visibleLibrarySurface\(\)\s*===\s*'main'/, '收到事件时必须先判主区是否已可见')
  assert.match(code, /consumeLibraryOpenRequest\(\)/, 'mount 时要消费 pending 标记（刷新/重挂补回内联）')
  assert.equal(code.includes('data-panel-library-inline'), true)
  assert.equal(code.includes('data-library-inline-back'), true, '返回面板的按钮必须在')
  assert.equal(code.includes('data-panel-library-warn'), true, '说明前的小圆点必须在（aria-hidden）')
  assert.equal(code.includes('主区未开放，项目库在面板内展开'), false, '旧文案必须彻底替换（不允许两套说法）')
})

test('LibraryPage 根：main / panel 两个 surface 标记都由 inline 决定（AC-9 唯一钩子）', () => {
  const code = codeOnlyOf('src/client/LibraryPage.tsx')
  assert.match(
    code,
    /data-library-surface=\{props\.inline === true \? 'panel' : 'main'\}/,
    '根节点必须按 inline 标 data-library-surface（main|panel）',
  )
  assert.equal(code.includes('data-auto-team-library'), true)
  // 主区与内联共用同一份内容体，不许为内联另写第二份项目库
  assert.match(code, /<LibraryContent \{\.\.\.props\} root="library" \/>/, '内联与主区必须共用 LibraryContent')
})
