/**
 * r18b t2：任务页顶部 **run 行**的投影契约（纯 `node --test`，不渲染 JSX）。
 *
 * 用户口径（2026-11-05）：「run 位置应该和历史列表显示的内容一致，不同的是 run 位置只显示
 * 正在进行的任务，如果没有正在进行的任务则显示最后一个任务」，顶部不再有 run 切换器。
 *
 * 这里锁定三件事：
 *  ① `activeRunRowsOf` 的过滤/回退/排序/选中语义（含宿主并行任务 t1 的 `ongoing` 契约）；
 *  ② 每行展示字段**复用** `runSummaryRowOf`（与历史列表同一个投影，不另拼一份）；
 *  ③ 组件与任务页的接线（新钩子出现、旧卡片/返回按钮钩子消失、组件零格式化）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PanelSnapshot, PlanTask, RunSummary, UsageCell } from '../src/shared/types.ts'
import { activeRunRowsOf } from '../src/client/nav.ts'
import { runSummaryRowOf } from '../src/client/tabs/rows.ts'
import type { UsageMetricKey } from '../src/shared/types.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const T1 = Date.parse('2026-11-04T10:00:00+08:00')
const T2 = Date.parse('2026-11-05T09:00:00+08:00')
const T3 = Date.parse('2026-11-05T10:00:00+08:00')

/** 宿主 t1 的契约字段：`ongoing` 可能是 undefined（旧数据 / 未合并）。 */
type RunSummaryFixture = RunSummary & { ongoing?: number }

const METRIC_KEYS: readonly UsageMetricKey[] = [
  'input',
  'cacheRead',
  'cacheWrite',
  'output',
  'calls',
  'hitRate',
]

function usageOf(): UsageCell {
  return {
    source: 'provider',
    text: '2,100',
    tokens: { total: 2100, input: 1000, cacheRead: 500, cacheWrite: 200, output: 400, calls: 3 },
    details: [
      { key: 'input', label: '输入', text: '1,000', available: true },
      { key: 'cacheRead', label: '缓存读', text: '500', available: true },
      { key: 'cacheWrite', label: '写缓存', text: '200', available: true },
      { key: 'output', label: '输出', text: '400', available: true },
      { key: 'calls', label: '调用', text: '3', available: true },
      { key: 'hitRate', label: '命中率', text: '不可得', available: false },
    ],
  }
}

function codeOf(rel: string): string {
  const source = readFileSync(join(ROOT, rel), 'utf8')
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function taskOf(id: string, status: PlanTask['status']): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    status,
    dependsOn: [],
    acceptance: 'pnpm typecheck',
  } as PlanTask
}

function summaryOf(runId: string, overrides: Partial<RunSummaryFixture> = {}): RunSummaryFixture {
  return {
    runId,
    sessionId: 'sess-1',
    createdAt: T1,
    plannedAt: T1,
    status: 'dispatching',
    tasks: 3,
    done: 1,
    goal: `目标 ${runId}`,
    usage: usageOf(),
    ...overrides,
  }
}

function snapshotOf(overrides: Partial<PanelSnapshot> = {}): PanelSnapshot {
  return {
    enabled: true,
    runId: 'r2',
    planStatus: 'dispatching',
    plannedAt: T1,
    tasks: [taskOf('a', 'done'), taskOf('b', 'running')],
    members: [],
    messages: [],
    routeAudits: [],
    roles: [],
    activity: [],
    runs: [],
    ...overrides,
  } as unknown as PanelSnapshot
}

/* ───────────────────────────── 过滤 / 回退 ───────────────────────────── */

test('activeRunRowsOf：没有快照 / 没有 runs 时返回 null（调用方不渲染这块）', () => {
  assert.equal(activeRunRowsOf({ snapshot: null }), null)
  assert.equal(activeRunRowsOf({ snapshot: undefined }), null)
  assert.equal(activeRunRowsOf({ snapshot: snapshotOf({ runs: [] }) }), null)
})

test('activeRunRowsOf：只显示 ongoing > 0 的 run，按 plannedAt 倒序', () => {
  const view = activeRunRowsOf({
    snapshot: snapshotOf({
      runs: [
        summaryOf('r1', { status: 'terminated', plannedAt: T1, ongoing: 0 }),
        summaryOf('r2', { plannedAt: T1, ongoing: 2 }),
        summaryOf('r3', { plannedAt: T2, ongoing: 1 }),
      ],
    }),
  })
  assert.ok(view)
  assert.equal(view.fallback, false)
  assert.deepEqual(view.rows.map((row) => row.runId), ['r3', 'r2'], '进行中的 run 按时间倒序')
  assert.equal(view.rows.every((row) => row.hasOngoing), true)
  assert.equal(view.rows.some((row) => row.runId === 'r1'), false, '已终止的 run 不该出现在顶部')
})

test('activeRunRowsOf：没有进行中的 run 时只显示「最后一个 run」一条', () => {
  const view = activeRunRowsOf({
    snapshot: snapshotOf({
      runs: [
        summaryOf('rA', { status: 'terminated', plannedAt: T1, ongoing: 0 }),
        summaryOf('rB', { status: 'terminated', plannedAt: T3, ongoing: 0 }),
        summaryOf('rC', { status: 'cancelled', plannedAt: T2, ongoing: 0 }),
      ],
    }),
  })
  assert.ok(view)
  assert.equal(view.fallback, true)
  assert.deepEqual(view.rows.map((row) => row.runId), ['rB'], '只留最新一条，且不按数组顺序')
  assert.equal(view.rows[0]?.hasOngoing, false, '兜底行必须自报「没有进行中任务」')
})

test('activeRunRowsOf：显式 ongoing 优先，0 不会因为 active=true 又被兜底成进行中', () => {
  const view = activeRunRowsOf({
    snapshot: snapshotOf({
      runs: [
        summaryOf('rZero', { active: true, done: 1, tasks: 3, ongoing: 0, plannedAt: T2 }),
        summaryOf('rOld', { active: false, done: 0, tasks: 3, plannedAt: T1, ongoing: 0 }),
      ],
    }),
  })
  assert.ok(view)
  assert.equal(view.fallback, true, 'ongoing:0 是权威值，不该再用 active/done 反推')
  assert.deepEqual(view.rows.map((row) => row.runId), ['rZero'])
})

test('activeRunRowsOf：旧数据没有 ongoing 时按 active && done < tasks 兜底', () => {
  const view = activeRunRowsOf({
    snapshot: snapshotOf({
      runs: [
        summaryOf('rLive', { active: true, done: 1, tasks: 3, plannedAt: T1 }),
        summaryOf('rDead', { active: false, done: 0, tasks: 3, plannedAt: T2 }),
      ],
    }),
  })
  assert.ok(view)
  assert.equal(view.fallback, false)
  assert.deepEqual(view.rows.map((row) => row.runId), ['rLive'])
})

/* ───────────────────────────── 选中 / 当前 ───────────────────────────── */

test('activeRunRowsOf：selected = store 选中的 runId，缺省回落到当前 run', () => {
  const snapshot = snapshotOf({
    runId: 'r2',
    runs: [
      summaryOf('r2', { plannedAt: T2, ongoing: 1 }),
      summaryOf('r3', { plannedAt: T1, ongoing: 2 }),
    ],
  })
  const fallback = activeRunRowsOf({ snapshot })
  assert.ok(fallback)
  assert.equal(fallback.selectedRunId, 'r2')
  assert.deepEqual(
    fallback.rows.filter((row) => row.selected).map((row) => row.runId),
    ['r2'],
  )

  const picked = activeRunRowsOf({ snapshot, selectedRunId: 'r3' })
  assert.ok(picked)
  assert.equal(picked.selectedRunId, 'r3')
  assert.deepEqual(
    picked.rows.filter((row) => row.selected).map((row) => row.runId),
    ['r3'],
    'store 里的选中必须覆盖当前 run',
  )

  const current = picked.rows.find((row) => row.current)
  assert.equal(current?.runId, 'r2', 'current 仍标在真正的当前 run 上（与 selected 是两回事）')
  assert.equal(current?.selected, false)
})

test('activeRunRowsOf：选中一条不在这批行里的 run 时，没有行被标成选中', () => {
  const view = activeRunRowsOf({
    snapshot: snapshotOf({ runs: [summaryOf('r2', { ongoing: 1 })] }),
    selectedRunId: 'rHistory',
  })
  assert.ok(view)
  assert.equal(view.selectedRunId, 'rHistory')
  assert.equal(view.rows.some((row) => row.selected), false, '不把历史 run 硬塞进「进行中」列表')
})

test('activeRunRowsOf：快照没有 runId 时用 active 的 run 当当前 run', () => {
  const view = activeRunRowsOf({
    snapshot: snapshotOf({
      runId: undefined,
      runs: [summaryOf('r1', { active: true, ongoing: 1 }), summaryOf('r2', { plannedAt: T2, ongoing: 1 })],
    }),
  })
  assert.ok(view)
  assert.equal(view.currentRunId, 'r1')
  assert.equal(view.rows.find((row) => row.runId === 'r1')?.current, true)
})

/* ───────────────────── 展示字段复用历史列表投影 ───────────────────── */

test('activeRunRowsOf：每行字段与 runSummaryRowOf 完全一致（标题/状态/meta/token 六项）', () => {
  const run = summaryOf('r2')
  const view = activeRunRowsOf({ snapshot: snapshotOf({ runId: 'r2', runs: [run] }) })
  assert.ok(view)
  const row = view.rows[0]
  assert.ok(row)
  const base = runSummaryRowOf(run)
  assert.equal(row.title, base.title, '标题必须复用历史行投影（goal 截断单点）')
  assert.equal(row.titleSource, base.titleSource)
  assert.equal(row.titleTitle, base.titleTitle)
  assert.equal(row.metaText, base.metaText, '次行 meta 与历史列表逐字一致')
  assert.equal(row.statusText, base.statusText)
  assert.equal(row.statusTone, base.statusTone)
  assert.equal(row.statusIcon, base.statusIcon)
  assert.equal(row.tokenText, base.tokenText)
  assert.equal(row.tokenSource, base.tokenSource)
  assert.deepEqual(row.usageMetrics, base.usageMetrics)
})

test('activeRunRowsOf：token 六项按宿主下发的顺序透传（input/cacheRead/cacheWrite/output/calls/hitRate）', () => {
  const view = activeRunRowsOf({ snapshot: snapshotOf({ runs: [summaryOf('r2')] }) })
  assert.ok(view)
  const metrics = view.rows[0]?.usageMetrics ?? []
  assert.deepEqual(metrics.map((metric) => metric.key), [...METRIC_KEYS])
  assert.equal(metrics.at(-1)?.available, false, '缺项保留 available:false，不改写成 0')
  assert.equal(metrics.at(-1)?.text, '不可得', '缺项文案来自宿主，客户端不重算')
})

/* ───────────────── r18b t11：卡内 meta 紧凑全文（cardMetaText） ───────────────── */

/**
 * 独立推导 `HH:MM:SS`（**不** import 被测的 `formatClock`）：用被测逻辑证明被测逻辑
 * 等于没证明；这里按「本地时间、两位补零」重写一遍，逐字比对。
 */
function clockOf(ts: number): string {
  const at = new Date(ts)
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value))
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

test('cardMetaText：未结束是「<HH:MM:SS> 起 · 进行中 · 任务 d/t」逐字', () => {
  const view = activeRunRowsOf({
    snapshot: snapshotOf({ runId: 'rLive', runs: [summaryOf('rLive', { done: 2, tasks: 3, ongoing: 1, active: true })] }),
  })
  assert.ok(view)
  const row = view.rows[0]
  assert.ok(row)
  // T1 = 2026-11-04 10:00（本地时区），clockOf 与 formatClock 同为本地时间。
  assert.equal(row.cardMetaText, `${clockOf(T1)} 起 · 进行中 · 任务 2/3`)
  assert.match(row.cardMetaText, /^\d{2}:\d{2}:\d{2} 起 · 进行中 · 任务 \d+\/\d+$/)
  assert.equal(row.cardMetaText.length <= 28, true, `文案过长：${row.cardMetaText}`)
  // 完整的历史长文案仍在 metaText 上（卡内 title 用它），两者不是同一份文本。
  assert.match(row.metaText, /^开始 .+ · 结束 进行中 · 任务 2\/3$/)
  assert.notEqual(row.cardMetaText, row.metaText)
})

test('cardMetaText：已结束是「<start> → <finishedAt> · 任务 d/t」逐字（不再出现「进行中」）', () => {
  const view = activeRunRowsOf({
    snapshot: snapshotOf({
      runId: 'rEnded',
      runs: [
        summaryOf('rEnded', {
          plannedAt: T2,
          finishedAt: T3,
          status: 'terminated',
          done: 3,
          tasks: 3,
          ongoing: 0,
          active: false,
        }),
      ],
    }),
  })
  assert.ok(view)
  const row = view.rows[0]
  assert.ok(row)
  assert.equal(row.cardMetaText, `${clockOf(T2)} → ${clockOf(T3)} · 任务 3/3`)
  assert.match(row.cardMetaText, /^\d{2}:\d{2}:\d{2} → \d{2}:\d{2}:\d{2} · 任务 \d+\/\d+$/)
  assert.equal(row.cardMetaText.includes('进行中'), false, '已结束的 run 不该说「进行中」')
  assert.equal(row.cardMetaText.length <= 28, true, `文案过长：${row.cardMetaText}`)
})

test('cardMetaText：done/tasks 缺失按 0 兜底、plannedAt 缺失退回 createdAt，不出现 NaN/undefined', () => {
  const view = activeRunRowsOf({
    snapshot: snapshotOf({
      runId: 'rSparse',
      runs: [
        summaryOf('rSparse', {
          plannedAt: undefined,
          createdAt: T2,
          done: undefined,
          tasks: undefined,
          ongoing: 1,
        }),
      ],
    }),
  })
  assert.ok(view)
  const row = view.rows[0]
  assert.ok(row)
  assert.equal(row.cardMetaText, `${clockOf(T2)} 起 · 进行中 · 任务 0/0`)
  assert.equal(row.cardMetaText.includes('NaN'), false, '缺失计数不许变成 NaN')
  assert.equal(row.cardMetaText.includes('undefined'), false, '缺失计数不许把 undefined 贴进界面')
  assert.equal(row.cardMetaText.length <= 28, true)
})

test('cardMetaText：finishedAt 为非正数/NaN 时按「未结束」处理，不渲染一个破折号终点', () => {
  for (const finishedAt of [0, Number.NaN, -1]) {
    const view = activeRunRowsOf({
      snapshot: snapshotOf({ runs: [summaryOf('rBadEnd', { finishedAt, ongoing: 1, done: 1, tasks: 2 })] }),
    })
    assert.ok(view)
    const text = view.rows[0]?.cardMetaText ?? ''
    assert.equal(text, `${clockOf(T1)} 起 · 进行中 · 任务 1/2`, `finishedAt=${String(finishedAt)}`)
    assert.equal(text.includes('→'), false)
    assert.equal(text.includes('—'), false)
  }
})


/* ───────────────────────────── 组件 / 接线 ───────────────────────────── */

test('RunSwitcher.tsx：run 行钩子齐全，旧卡片/返回按钮/切换器钩子已删', () => {
  const source = codeOf('src/client/views/RunSwitcher.tsx')
  for (const hook of [
    'data-region="run-switcher"',
    'data-active-runs',
    'data-active-run',
    'data-run-id',
    'data-current',
    'data-selected',
    'aria-pressed',
    'data-active-run-title',
    'data-active-run-status',
    'data-tone={row.statusTone}',
    'data-active-run-meta',
    'data-active-run-usage',
    'data-active-run-metric',
    'data-available',
  ]) {
    assert.ok(source.includes(hook), `RunSwitcher 缺钩子 ${hook}`)
  }
  for (const dead of ['data-run-cards', 'data-run-card', 'data-run-back', 'onBack', 'historical', 'canSwitch']) {
    assert.equal(source.includes(dead), false, `旧切换器钩子/字段必须删干净：${dead}`)
  }
  assert.doesNotMatch(source, /<select/)
  assert.doesNotMatch(source, /<option/)
  // 整行是 button → 内容必须全是 phrasing content（span/b），不许出现 div。
  assert.doesNotMatch(source, /<div/)
  assert.match(source, /onClick=\{\(\) => pick\(row\.runId\)\}/)
  assert.match(source, /view\.rows\.map\(/)
  // t11：卡内贴紧凑全文，完整历史文案只放 title（组件零格式化，不自己拼）。
  assert.match(source, /title=\{row\.metaText\}>\{row\.cardMetaText\}/)
  // 组件零格式化：数字/时间文本只能来自投影。
  assert.doesNotMatch(source, /toLocaleString|Intl\.NumberFormat|toFixed|padStart/)
  assert.doesNotMatch(source, /小时|分钟/)
})

test('TasksTab.tsx：顶部渲染 run 行，切历史 run 仍走既有 openRun 路径，不再有 onBack', () => {
  const source = codeOf('src/client/tabs/TasksTab.tsx')
  assert.match(source, /<RunSwitcher/)
  assert.match(source, /activeRunRowsOf\(\{/)
  assert.match(source, /selectedRunId: historicalRunId/)
  assert.match(source, /props\.openRun/)
  assert.match(source, /selectRun/)
  assert.equal(source.includes('onBack'), false, 'r18b t2 删除了「回到当前 run」按钮')
  assert.equal(source.includes('runSwitcherOf'), false, '调用方只走新投影')
  // D3：空态文案由纯函数统一决定（历史详情丢失时不许再说「正在读取」）
  assert.match(source, /tasksEmptyStateOf\(\{/)
  assert.match(source, /busy=\{detailLoading\}/)
  // 历史 run 不能拿当前快照冒充自己的成员
  assert.match(source, /historicalRunId === null && snapshot !== undefined \? snapshot\.members : \[\]/)
})
