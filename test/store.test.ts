/**
 * 存储层单测：`RunState` v2 原子读写、v1 裸 `Plan` 自动升级、消息账本上限 200。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_MAX_CONCURRENT, MAX_CONCURRENT_LIMIT } from '../src/host/config.ts'
import type { MemberBinding, MessageRecord, PlanTask } from '../src/shared/types.ts'
import type { RunState } from '../src/host/store.ts'
import {
  MESSAGES_LIMIT,
  RUN_STATE_VERSION,
  RunsStore,
  STALL_ALERTS_LIMIT,
  StaleWriteError,
  finishedAtOf,
  lockedSnapshot,
  mergeRunState,
  saveWithCas,
  makeRunId,
  uniqueRunId,
  wrapLegacy,
} from '../src/host/store.ts'

const now = 1_700_000_000_000

/** v1 时代的裸 Plan（今天仍可能存在于用户的 runs/ 目录里）。 */
function legacyPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: 'run-legacy',
    sessionId: 's-legacy',
    createdAt: now,
    status: 'draft',
    tasks: [
      { id: 't1', title: '骨架', roleId: 'architect', dependsOn: [], acceptance: 'pnpm typecheck', status: 'done' },
      { id: 't2', title: '实现', roleId: 'dev', dependsOn: ['t1'], acceptance: 'pnpm test', status: 'pending' },
    ],
    maxConcurrent: 3,
    ...overrides,
  }
}

function messages(count: number, prefix = 'm'): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    at: now + index,
    from: 'captain',
    to: 'dev-t1',
    body: `${prefix}${index}`,
  }))
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-store-'))
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('wrapLegacy 把 v1 裸 Plan 升成 v2（补三个空数组与 plannedAt）', () => {
  const state = wrapLegacy(legacyPlan())
  assert.ok(state)
  assert.equal(state.version, RUN_STATE_VERSION)
  assert.equal(state.plan.runId, 'run-legacy')
  assert.equal(state.plan.tasks.length, 2)
  assert.equal(state.plan.tasks[0].status, 'done')
  assert.equal(state.plannedAt, now)
  assert.deepEqual(state.messages, [])
  assert.deepEqual(state.bindings, [])
  assert.deepEqual(state.routeAudits, [])
})

test('wrapLegacy 保留 v2 的账本与审计，且 plannedAt 早于首个 spawnedAt（AC-30）', () => {
  const state = wrapLegacy({
    version: 2,
    plan: legacyPlan({ runId: 'run-v2' }),
    plannedAt: now,
    messages: [{ at: now + 1, from: 'captain', to: 'dev-t1', body: '开始' }],
    bindings: [{ taskId: 't1', roleId: 'dev', memberId: 'm1', name: 'dev-t1', spawnedAt: now + 2 }],
    routeAudits: [{ taskId: 't1', roleId: 'dev', declared: null, at: now + 3, verdict: 'unverified' }],
  })
  assert.ok(state)
  assert.equal(state.plannedAt, now)
  assert.equal(state.messages[0].body, '开始')
  assert.equal(state.bindings[0].memberId, 'm1')
  assert.equal(state.routeAudits[0].verdict, 'unverified')
  assert.ok(state.plannedAt < state.bindings[0].spawnedAt)

  const bare = wrapLegacy({ version: 2, plan: legacyPlan({ runId: 'run-v2b' }) })
  assert.ok(bare)
  assert.deepEqual(bare.messages, [])
  assert.deepEqual(bare.bindings, [])
  assert.deepEqual(bare.routeAudits, [])
})

test('wrapLegacy 对坏输入返回 null（不抛异常）', () => {
  const bad: unknown[] = [
    null,
    undefined,
    42,
    'plan',
    [],
    {},
    { plan: {} },
    { runId: '', sessionId: 's', tasks: [] },
    { runId: 'x', sessionId: 's', tasks: 'nope' },
  ]
  for (const raw of bad) {
    assert.equal(wrapLegacy(raw), null)
  }
})

test('消息账本上限 200 条：超出丢最旧，保留最后 200 条且顺序不变', () => {
  const state = wrapLegacy({
    ...legacyPlan(),
    version: 2,
    plannedAt: now,
    messages: messages(MESSAGES_LIMIT + 50),
  })
  assert.ok(state)
  assert.equal(state.messages.length, MESSAGES_LIMIT)
  assert.equal(state.messages[0].body, 'm50')
  assert.equal(state.messages.at(-1)?.body, `m${MESSAGES_LIMIT + 49}`)
})

test('wrapLegacy：progress 只留 at 为有限数字的键，alertedAt 非法则删（AC-13 数据源的可信度）', () => {
  const state = wrapLegacy({
    ...legacyPlan(),
    version: 2,
    plannedAt: now,
    progress: {
      'member-1': { at: now, alertedAt: now + 1 },
      'member-2': { at: now }, // 无 alertedAt：正常
      'member-3': { at: Number.NaN }, // at 非法 → 整条丢
      'member-4': { at: 'oops' }, // at 类型不对 → 整条丢
      'member-5': { alertedAt: now }, // 缺 at → 整条丢
      'member-6': { at: now, alertedAt: 'oops' }, // only alertedAt 非法 → 保留 at
      'member-7': 'not-an-object',
    },
  })
  assert.ok(state)
  assert.deepEqual(Object.keys(state.progress ?? {}).sort(), ['member-1', 'member-2', 'member-6'])
  assert.deepEqual(state.progress?.['member-1'], { at: now, alertedAt: now + 1 })
  assert.deepEqual(state.progress?.['member-6'], { at: now }, 'alertedAt 非法只删该字段，不丢记录')
  const bare = wrapLegacy({ ...legacyPlan(), version: 2 })
  assert.ok(bare)
  assert.deepEqual(bare.progress, {}, '缺省补空对象，不是 undefined')
})

test('wrapLegacy：stallAlerts 只留 kind=tool 且 at/text 有效的条目，超出上限截尾', () => {
  const tooMany = Array.from({ length: STALL_ALERTS_LIMIT + 7 }, (_, index) => ({
    at: now + index,
    kind: 'tool' as const,
    text: `告警 ${index}`,
  }))
  const state = wrapLegacy({
    ...legacyPlan(),
    version: 2,
    plannedAt: now,
    stallAlerts: [
      { at: now, kind: 'spawn', text: '别的 kind 不许混进来' },
      { at: 'oops', kind: 'tool', text: 'at 非法' },
      { at: now, kind: 'tool', text: '' },
      ...tooMany,
    ],
  })
  assert.ok(state)
  assert.equal(state.stallAlerts?.length, STALL_ALERTS_LIMIT)
  assert.equal(state.stallAlerts?.[0]?.text, `告警 ${7}`, '丢最旧，保留最新一段')
  assert.ok(state.stallAlerts?.every((alert) => alert.kind === 'tool'))
})

test('save：progress 裁剪到 live bindings、stallAlerts 截尾（落盘文件不无限增长）', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const state = wrapLegacy({
      ...legacyPlan(),
      version: 2,
      plannedAt: now,
      bindings: [
        { taskId: 't1', roleId: 'dev', memberId: 'member-1', name: 'dev-t1', spawnedAt: now },
        { taskId: 't2', roleId: 'dev', memberId: 'member-2', name: 'dev-t2', spawnedAt: now, retired: true },
        { taskId: 't3', roleId: 'dev', memberId: 'member-3', name: 'dev-t3', spawnedAt: now },
      ],
      progress: {
        'member-1': { at: now },
        'member-2': { at: now }, // retired：不再对账，落盘时丢掉
        'member-3': { at: now },
        'member-9': { at: now }, // 没有 binding：丢掉
      },
      stallAlerts: Array.from({ length: STALL_ALERTS_LIMIT + 3 }, (_, index) => ({
        at: now + index,
        kind: 'tool' as const,
        text: `告警 ${index}`,
      })),
    })
    assert.ok(state)
    store.save(state)

    const loaded = store.load('run-legacy')
    assert.ok(loaded)
    assert.deepEqual(Object.keys(loaded.progress ?? {}).sort(), ['member-1', 'member-3'])
    assert.equal(loaded.stallAlerts?.length, STALL_ALERTS_LIMIT)
    assert.equal(loaded.stallAlerts?.at(-1)?.text, `告警 ${STALL_ALERTS_LIMIT + 2}`)
    assert.equal(loaded.version, RUN_STATE_VERSION, '新增字段是可选增量：版本号不变')
  })
})

test('RunsStore.save/load 往返一致，原子写不留 .tmp', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const state = wrapLegacy({
      ...legacyPlan(),
      version: 2,
      plannedAt: now,
      messages: messages(3),
    })
    assert.ok(state)
    store.save(state)

    assert.deepEqual(readdirSync(dir), ['run-legacy.json'])
    assert.equal(JSON.parse(readFileSync(join(dir, 'run-legacy.json'), 'utf8')).version, RUN_STATE_VERSION)

    const loaded = store.load('run-legacy')
    assert.ok(loaded)
    assert.equal(loaded.version, RUN_STATE_VERSION)
    assert.equal(loaded.plannedAt, now)
    assert.equal(loaded.messages.length, 3)
    assert.equal(loaded.messages[2].body, 'm2')
    assert.equal(loaded.plan.tasks.length, 2)
  })
})

test('interrupted 状态必须能读回（AC-18 不许显示成 pending，AC-17 才挑得中要恢复的任务）', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const state = wrapLegacy({ ...legacyPlan(), version: 2, plannedAt: now })
    assert.ok(state)
    state.plan.tasks[0].status = 'interrupted'
    store.save(state)

    const loaded = store.load('run-legacy')
    assert.ok(loaded)
    assert.equal(
      loaded.plan.tasks[0].status,
      'interrupted',
      'TASK_STATUSES 白名单漏掉 interrupted 会把它归回 pending：面板显示「待办」而非「已中断」，resume 也会静默跳过',
    )
  })
})

test('save 落盘前把消息账本裁到 200 条', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const state = wrapLegacy({ ...legacyPlan(), version: 2, plannedAt: now, messages: messages(240) })
    assert.ok(state)
    store.save(state)

    const loaded = store.load('run-legacy')
    assert.ok(loaded)
    assert.equal(loaded.messages.length, MESSAGES_LIMIT)
    assert.equal(loaded.messages.at(-1)?.body, 'm239')
  })
})

test('load 能读磁盘上的 v1 裸 Plan 文件（自动升到当前版本）', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'legacy.json'), JSON.stringify(legacyPlan({ runId: 'legacy' })), 'utf8')
    const state = new RunsStore(dir).load('legacy')
    assert.ok(state)
    assert.equal(state.version, RUN_STATE_VERSION)
    assert.deepEqual(state.messages, [])
    assert.equal(state.plannedAt, now)
  })
})

test('宿主重启（新 store 实例）后仍读回消息账本/绑定/审计', () => {
  withTempDir((dir) => {
    const first = new RunsStore(dir)
    const state = wrapLegacy({
      version: 2,
      plan: legacyPlan({ runId: 'run-restart' }),
      plannedAt: now,
      messages: messages(2),
      bindings: [{ taskId: 't1', roleId: 'dev', memberId: 'm1', name: 'dev-t1', spawnedAt: now + 10 }],
      routeAudits: [{ taskId: 't1', roleId: 'dev', declared: { provider: 'p', model: 'm' }, at: now + 11, verdict: 'drift' }],
    })
    assert.ok(state)
    first.save(state)

    // 模拟宿主重启：全新实例、全新内存，只能靠磁盘恢复。
    const second = new RunsStore(dir)
    const restored = second.load('run-restart')
    assert.ok(restored)
    assert.equal(restored.messages.length, 2)
    assert.equal(restored.bindings.length, 1)
    assert.equal(restored.bindings[0].name, 'dev-t1')
    assert.equal(restored.routeAudits[0].verdict, 'drift')
    assert.ok(restored.plannedAt < restored.bindings[0].spawnedAt)
    assert.equal(second.latestForSession('s-legacy')?.plan.runId, 'run-restart')
  })
})

test('list 汇总各 run，latestForSession 取该会话最新一次', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const older = wrapLegacy(legacyPlan({ runId: 'run-a', sessionId: 's1', createdAt: now }))
    const newer = wrapLegacy(legacyPlan({ runId: 'run-b', sessionId: 's1', createdAt: now + 1000 }))
    const other = wrapLegacy(legacyPlan({ runId: 'run-c', sessionId: 's2', createdAt: now + 500 }))
    assert.ok(older)
    assert.ok(newer)
    assert.ok(other)
    store.save(older)
    store.save(newer)
    store.save(other)

    const summaries = store.list()
    assert.deepEqual(
      summaries.map((summary) => summary.runId),
      ['run-b', 'run-c', 'run-a'],
    )
    const first = summaries.find((summary) => summary.runId === 'run-a')
    assert.equal(first?.tasks, 2)
    assert.equal(first?.done, 1)
    assert.equal(store.latestForSession('s1')?.plan.runId, 'run-b')
    assert.equal(store.latestForSession('s2')?.plan.runId, 'run-c')
    assert.equal(store.latestForSession('missing'), null)
  })
})

test('空目录 / 缺失文件返回空结果，不抛错', () => {
  withTempDir((dir) => {
    const store = new RunsStore(join(dir, 'nope'))
    assert.deepEqual(store.list(), [])
    assert.equal(store.load('run-x'), null)
    assert.equal(store.latestForSession('s1'), null)
  })
})

test('runId 路径穿越被拒绝：load 返回 null，save 抛明确错误', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    assert.equal(store.load('../evil'), null)
    assert.equal(store.load('a/b'), null)
    const state = wrapLegacy(legacyPlan())
    assert.ok(state)
    assert.throws(
      () => store.save({ ...state, plan: { ...state.plan, runId: '../evil' } }),
      /非法 runId/,
    )
  })
})

test('同一毫秒两次出计划必须拿到不同 runId，且两份计划各自落盘（D2）', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const frozen = 1793390000000
    // 修复前 makeRunId 不含毫秒内去重：同样入参必然给出同一个 id（这就是被 QA 复现的覆盖）。
    assert.equal(makeRunId('sess-same-ms', frozen), makeRunId('sess-same-ms', frozen), '生成器本身仍是纯函数')

    const first = uniqueRunId(store, 'sess-same-ms', frozen)
    const stateA = wrapLegacy(legacyPlan({ runId: first, sessionId: 'sess-same-ms' }))
    assert.ok(stateA)
    store.save(stateA)

    const second = uniqueRunId(store, 'sess-same-ms', frozen)
    assert.notEqual(second, first, '同一毫秒的第二份计划必须换 id，否则后一份静默覆盖前一份')
    const stateB = wrapLegacy(
      legacyPlan({
        runId: second,
        sessionId: 'sess-same-ms',
        tasks: [{ id: 't9', title: '第二份', roleId: 'dev', dependsOn: [], acceptance: 'true', status: 'pending' }],
      }),
    )
    assert.ok(stateB)
    store.save(stateB)

    // 两份都在盘上、任务互不相同：第一份的任务没有被第二份吃掉
    const loadedA = store.load(first)
    const loadedB = store.load(second)
    assert.equal(loadedA?.plan.tasks.length, 2)
    assert.equal(loadedB?.plan.tasks.length, 1)
    assert.equal(store.list().length, 2)
  })
})

test('uniqueRunId 跳过已被占用的 id（连撞 3 次也不覆盖）', () => {
  const taken = new Set<string>()
  const lookup = {
    load: (runId: string) => (taken.has(runId) ? wrapLegacy(legacyPlan({ runId })) : null),
  }
  const frozen = 1
  for (let attempt = 0; attempt <= 3; attempt += 1) taken.add(makeRunId('s', frozen, attempt === 0 ? '' : String(attempt)))
  const picked = uniqueRunId(lookup, 's', frozen)
  assert.equal(taken.has(picked), false, '返回的 id 必须是空闲的')
  assert.equal(picked, makeRunId('s', frozen, '4'))
})

test('旧文件缺字段时给安全默认值，并发上限被夹到硬上限', () => {
  const missing = wrapLegacy({ runId: 'r1', sessionId: 's1', tasks: [] })
  assert.ok(missing)
  assert.equal(missing.plan.maxConcurrent, DEFAULT_MAX_CONCURRENT)
  assert.equal(missing.plan.status, 'draft')
  assert.equal(missing.plannedAt, 0)

  const huge = wrapLegacy(legacyPlan({ maxConcurrent: 99 }))
  assert.ok(huge)
  assert.equal(huge.plan.maxConcurrent, MAX_CONCURRENT_LIMIT)

  const garbageTask = wrapLegacy({ runId: 'r2', sessionId: 's1', tasks: [{ id: 't1' }, null, 'x'] })
  assert.ok(garbageTask)
  assert.equal(garbageTask.plan.tasks.length, 1)
  assert.equal(garbageTask.plan.tasks[0].status, 'pending')
  assert.deepEqual(garbageTask.plan.tasks[0].dependsOn, [])
})

/* ───────────────────── r7 T1：暂停记账（RUN_STATE_VERSION = 3） ───────────────────── */

test('r7：RUN_STATE_VERSION 升到 3，暂停记账原子落盘后可原样读回', () => {
  assert.equal(RUN_STATE_VERSION, 3)
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const state = wrapLegacy(legacyPlan())
    assert.ok(state)
    assert.equal(state.pause, undefined, '未暂停的运行不该凭空有 pause')
    state.plan.tasks[0].status = 'paused'
    // 暂停/继续是一次事务：计划状态 + 每条任务原状态写在同一个对象里（AC-9）。
    state.pause = { at: now, planStatus: 'dispatching', tasks: { t1: 'running', t2: 'ready' } }
    store.save(state)

    const loaded = store.load('run-legacy')
    assert.ok(loaded)
    assert.equal(loaded.version, RUN_STATE_VERSION)
    assert.deepEqual(loaded.pause, { at: now, planStatus: 'dispatching', tasks: { t1: 'running', t2: 'ready' } })
    assert.equal(loaded.plan.tasks[0].status, 'paused', 'paused 任务状态必须读回 paused，不许归回 pending')
  })
})

test('r7：paused 是 TASK_STATUSES 的合法值（读盘不归回 pending，否则恢复会重派已完成任务）', () => {
  const state = wrapLegacy({
    runId: 'r1',
    sessionId: 's1',
    tasks: [
      { id: 't1', title: '冻结中', roleId: 'dev', dependsOn: [], acceptance: 'pnpm test', status: 'paused' },
      { id: 't2', title: '真脏值', roleId: 'dev', dependsOn: [], acceptance: 'pnpm test', status: 'whatever' },
    ],
  })
  assert.ok(state)
  assert.equal(state.plan.tasks[0].status, 'paused')
  assert.equal(state.plan.tasks[1].status, 'pending', '白名单外的状态仍归回 pending')
})

test('r7：normalizePause 白名单 —— 四项任一不合格就整体视为未暂停', () => {
  const base = { at: now, planStatus: 'dispatching', tasks: { t1: 'running' } }
  const okCase = wrapLegacy({ ...legacyPlan(), pause: base })
  assert.ok(okCase)
  assert.deepEqual(okCase.pause, base)

  const cases: { label: string; pause: unknown }[] = [
    { label: 'at 非数字', pause: { ...base, at: 'now' } },
    { label: 'at 非有限', pause: { ...base, at: Number.POSITIVE_INFINITY } },
    { label: 'planStatus 非法', pause: { ...base, planStatus: 'whatever' } },
    { label: 'tasks 不是对象', pause: { ...base, tasks: [] } },
    { label: '任务状态在白名单外', pause: { ...base, tasks: { t1: 'whatever' } } },
    { label: '任务 id 为空串', pause: { ...base, tasks: { '': 'running' } } },
    { label: 'pause 不是对象', pause: 'paused' },
  ]
  for (const item of cases) {
    const state = wrapLegacy({ ...legacyPlan(), pause: item.pause })
    assert.ok(state)
    assert.equal(state.pause, undefined, `${item.label}：半份暂停记录必须整体丢弃（否则会派发其实在跑的任务）`)
  }

  const emptyTasks = wrapLegacy({ ...legacyPlan(), pause: { at: now, planStatus: 'draft', tasks: {} } })
  assert.ok(emptyTasks)
  assert.deepEqual(emptyTasks.pause, { at: now, planStatus: 'draft', tasks: {} }, '空 tasks 合法（刚计划就暂停）')
})

test('r7：save() 会把手搓的非法 pause 归一掉，盘上不许出现脏记账', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const state = wrapLegacy(legacyPlan())
    assert.ok(state)
    state.pause = { at: now, planStatus: 'bogus', tasks: {} } as unknown as NonNullable<typeof state.pause>
    store.save(state)
    const raw = JSON.parse(readFileSync(join(dir, 'run-legacy.json'), 'utf8')) as Record<string, unknown>
    assert.equal('pause' in raw, false, '非法 pause 不许落盘（JSON.stringify 丢掉 undefined 键）')
  })
})

test('r7：v2 老文件（无 pause 字段）升到 v3 后仍是「未暂停」', () => {
  withTempDir((dir) => {
    // v2 时代的文件形状：有 version:2、没有 pause。
    const v2 = { ...legacyPlan(), version: 2, plannedAt: now, messages: [], bindings: [], routeAudits: [] }
    writeFileSync(join(dir, 'run-legacy.json'), `${JSON.stringify(v2, null, 2)}\n`, 'utf8')
    const store = new RunsStore(dir)
    const loaded = store.load('run-legacy')
    assert.ok(loaded)
    assert.equal(loaded.version, RUN_STATE_VERSION, '读回即升版，不需要迁移脚本')
    assert.equal(loaded.pause, undefined)
    assert.equal(loaded.plan.tasks.length, 2)
  })
})

test('r7：暂停记账随运行落盘 —— 另一个 store 实例也能读到（跨重启不丢）', () => {
  withTempDir((dir) => {
    const first = new RunsStore(dir)
    const state = wrapLegacy(legacyPlan())
    assert.ok(state)
    state.pause = { at: now, planStatus: 'dispatching', tasks: { t1: 'done', t2: 'ready' } }
    first.save(state)

    const second = new RunsStore(dir)
    const loaded = second.load('run-legacy')
    assert.ok(loaded)
    assert.equal(loaded.pause?.tasks.t2, 'ready', '恢复时按原状态还原（ready 不该被改成 pending）')
    assert.equal(loaded.pause?.tasks.t1, 'done', '已完成任务的原状态也记着，恢复时不得回退')
    assert.equal(second.list()[0].status, loaded.plan.status, '列表口径不受 pause 影响')
  })
})

test('r14 AC-15：plan.goal 随 run 落盘，并由 list() 投影到 RunSummary（客户端不必再读盘）', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const state = wrapLegacy(legacyPlan({ goal: '  把任务页改成可拖动的无限画布  ' }))
    assert.ok(state)
    // 归一口径：首尾空白丢掉（否则项目列表标题会带上不可见缩进）
    assert.equal(state.plan.goal, '把任务页改成可拖动的无限画布')
    store.save(state)

    const summary = store.list()[0]
    assert.equal(summary.goal, '把任务页改成可拖动的无限画布', 'list() 必须投影 goal，避免 library 二次读盘')
    assert.equal(store.load('run-legacy')?.plan.goal, '把任务页改成可拖动的无限画布', '落盘后重新读出来也得在')
  })
})

test('r14 AC-18：没有 goal 的旧 run 形状不变 —— 可选字段不出现，而不是空串', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const state = wrapLegacy(legacyPlan())
    assert.ok(state)
    assert.equal(state.plan.goal, undefined)
    store.save(state)
    assert.equal('goal' in store.list()[0], false, '旧夹具投影后不得多出 goal: undefined/空串')
    assert.equal(store.load('run-legacy')?.plan.goal, undefined)
  })
})

/* ─────────── r20：run 结束时刻 = 落盘值优先，历史终态按可核实事实回退 ─────────── */

function stateWith(
  over: {
    status?: 'dispatching' | 'cancelled' | 'terminated'
    finishedAt?: number
    taskTimes?: Record<string, { startedAt?: number; endedAt?: number }>
    messages?: Array<{ at: number }>
  } = {},
) {
  const state = wrapLegacy({
    version: RUN_STATE_VERSION,
    plan: legacyPlan({ runId: 'r-finished', status: over.status ?? 'terminated' }),
    plannedAt: now,
    ...(over.finishedAt !== undefined ? { finishedAt: over.finishedAt } : {}),
    ...(over.taskTimes !== undefined ? { taskTimes: over.taskTimes } : {}),
    messages: (over.messages ?? []).map((message, index) => ({
      at: message.at,
      from: 'captain',
      to: 'dev-t1',
      body: `msg-${index}`,
    })),
  })
  assert.ok(state)
  return state
}

test('finishedAtOf：真实落盘值优先（哪怕历史事实推出更晚的时刻）', () => {
  const state = stateWith({
    status: 'terminated',
    finishedAt: now + 500,
    taskTimes: { t1: { startedAt: now, endedAt: now + 900 } },
    messages: [{ at: now + 800 }],
  })
  assert.equal(finishedAtOf(state), now + 500, '落盘值是真实收口证据，不能被回退口径覆盖')
})

test('finishedAtOf：历史终态缺落盘值时，取 max(任务 endedAt) 与最后消息 at 的较大值', () => {
  const fromTaskTimes = stateWith({
    status: 'terminated',
    taskTimes: {
      t1: { startedAt: now, endedAt: now + 100 },
      t2: { startedAt: now + 50, endedAt: now + 400 },
      t3: { startedAt: now + 60, endedAt: Number.NaN },
    },
  })
  assert.equal(finishedAtOf(fromTaskTimes), now + 400, '取任务结束时刻最大值；NaN 不得参与比较')

  const fromMessage = stateWith({
    status: 'cancelled',
    taskTimes: { t1: { startedAt: now, endedAt: now + 100 } },
    messages: [{ at: now + 200 }, { at: now + 300 }],
  })
  assert.equal(finishedAtOf(fromMessage), now + 300, '最后一条消息晚于所有任务结束时刻 → 取消息时间')

  const cancelledOnlyMessage = stateWith({ status: 'cancelled', messages: [{ at: now + 700 }] })
  assert.equal(finishedAtOf(cancelledOnlyMessage), now + 700, '派发前取消的旧 run 只剩消息时间可核')
})

test('finishedAtOf：都拿不到 / 进行中 → undefined，绝不拿 now 冒充', () => {
  assert.equal(finishedAtOf(stateWith({ status: 'terminated' })), undefined, '终态但无任何可核事实')
  assert.equal(
    finishedAtOf(stateWith({ status: 'dispatching', taskTimes: { t1: { endedAt: now + 100 } }, finishedAt: undefined })),
    undefined,
    '进行中的 run 没有结束时刻，不做回退',
  )
})

/* ─────────── r59 遗留 D1/D2：严格 CAS 真的接上了，且锁内重读有明确判据 ─────────── */

test('r59 D1：saveWithCas 显式 CAS 撞上锁外写者后重基重试，不静默覆盖', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const seeded = wrapLegacy(legacyPlan({ runId: 'r-cas' }))
    assert.ok(seeded)
    store.save(seeded) // rev=1
    const stale = store.load('r-cas')
    assert.ok(stale)
    // 锁外写者先落一版（模拟用量投影 / 宿主端口回调）：盘上 rev=2
    const other = store.load('r-cas')
    assert.ok(other)
    store.save({ ...other, project: '其他写者' })
    // 拿着 rev=1 的旧快照写：首次 CAS 必失败，helper 必须在锁内重读并重基后成功
    const applied = saveWithCas(store, { ...stale, project: '本次改动' })
    assert.equal(store.load('r-cas')?.project, '本次改动')
    assert.equal(store.load('r-cas')?.rev, applied.rev)
    assert.ok((applied.rev ?? 0) > 2, '重基后版本必须高于锁外写者那一版')
  })
})

test('r59 D1：重试次数用尽必须抛 StaleWriteError（最多 2 次重试 = 3 次尝试）', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const seeded = wrapLegacy(legacyPlan({ runId: 'r-cas' }))
    assert.ok(seeded)
    store.save(seeded)
    const stale = store.load('r-cas')
    assert.ok(stale)
    // 桩：盘上版本永远比手里的新 → 每次 CAS 都失败
    let attempts = 0
    const foreverStale = {
      save: () => {
        attempts += 1
        throw new StaleWriteError('r-cas', 0, attempts + 1)
      },
      load: () => ({ ...stale, rev: attempts + 1 }),
    }
    assert.throws(
      () => saveWithCas(foreverStale, stale),
      (error: unknown) => error instanceof StaleWriteError,
      '重试耗尽必须原样抛出，不许吞掉或无限重试',
    )
    assert.equal(attempts, 3, 'maxRetries=2 → 最多 3 次写盘尝试')
  })
})

test('r59 D2：lockedSnapshot 只在盘上版本严格更新时改用盘上状态', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    const seeded = wrapLegacy(legacyPlan({ runId: 'r-snap' }))
    assert.ok(seeded)
    store.save(seeded) // rev=1
    const mine = store.load('r-snap')
    assert.ok(mine)
    // 同版本：调用方手里可能带着尚未落盘的纯函数结果，必须保留
    assert.equal(lockedSnapshot(store, mine), mine, '同版本不得替换调用方快照')
    // 盘上更新：说明拿锁前有锁外写者落过盘，必须以盘为准
    const other = store.load('r-snap')
    assert.ok(other)
    store.save({ ...other, project: '锁外写者' })
    const fresh = lockedSnapshot(store, mine)
    assert.notEqual(fresh, mine)
    assert.equal(fresh.project, '锁外写者')
    // 从没落过盘的快照（无 rev）即使与盘上同名 run 相撞也不被替换
    const unsaved = { ...mine, rev: undefined, project: '未落盘' }
    assert.equal(lockedSnapshot(store, unsaved), unsaved, '无 rev 的未落盘快照必须原样保留')
    // 盘上没有这个 run：退回传入快照（行为与加锁前一致）
    assert.equal(lockedSnapshot(store, { ...mine, plan: { ...mine.plan, runId: 'r-missing' } }).plan.runId, 'r-missing')
  })
})

/* ─────────── r60 D3：CAS 撞车必须三方合并，不得抹掉锁外写者刚写的内容 ─────────── */

/** 三方合并的公共夹具：`runId` 每个用例不同，避免冲突告警的去重表串场。 */
function mergeState(runId: string, over: Partial<RunState> = {}): RunState {
  const seeded = wrapLegacy({ ...legacyPlan({ runId }), plannedAt: now })
  assert.ok(seeded)
  return { ...seeded, ...over }
}

function messageOf(at: number, body: string, extra: Partial<MessageRecord> = {}): MessageRecord {
  return { at, from: 'captain', to: 'dev-t1', body, ...extra }
}

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: 'exit 0', status: 'pending', ...over }
}

function bindingOf(memberId: string, taskId: string): MemberBinding {
  return { taskId, roleId: 'dev', memberId, name: `dev-${taskId}`, spawnedAt: now }
}

test('r60 D3：mergeRunState 逐字段三方合并（对方改的留下、我方改的留下）', () => {
  const base = mergeState('r-merge-3way')
  const ours: RunState = {
    ...base,
    project: '本次动作的项目',
    plan: { ...base.plan, status: 'paused' },
  }
  const theirs: RunState = {
    ...base,
    finishedAt: now + 5,
    plan: { ...base.plan, goal: '锁外写者改的目标' },
  }
  const merged = mergeRunState(base, ours, theirs)
  assert.equal(merged.project, '本次动作的项目', 'ours 改、theirs 未改 → 取 ours')
  assert.equal(merged.finishedAt, now + 5, 'ours 未改、theirs 改 → 取 theirs（锁外写者刚写的内容必须存活）')
  assert.equal(merged.plan.status, 'paused', 'ours 改 plan.status → 保留')
  assert.equal(merged.plan.goal, '锁外写者改的目标', 'theirs 改 plan 的另一个字段 → 保留（不是整块替换）')
  assert.equal(merged.rev, theirs.rev, 'rev 一律取 theirs（CAS 基准只能是盘上那一版）')
})

test('r60 D3：两边改同一字段冲突 → 取我方，并写一条含 runId 与字段名的去重 warn', () => {
  const runId = 'r-merge-conflict'
  const seeded = mergeState(runId)
  const ancestor: RunState = { ...seeded, plan: { ...seeded.plan, maxConcurrent: 3 } }
  const ours: RunState = { ...ancestor, plan: { ...ancestor.plan, maxConcurrent: 2 } }
  const theirs: RunState = { ...ancestor, plan: { ...ancestor.plan, maxConcurrent: 4 } }
  const warns: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((value) => String(value)).join(' '))
  }
  try {
    const merged = mergeRunState(ancestor, ours, theirs)
    assert.equal(merged.plan.maxConcurrent, 2, '冲突取值规则：两边都改且不同 → 取 ours')
    const again = mergeRunState(ancestor, ours, theirs)
    assert.equal(again.plan.maxConcurrent, 2)
  } finally {
    console.warn = original
  }
  const conflicts = warns.filter((line) => line.includes(runId) && line.includes('plan.maxConcurrent'))
  assert.equal(conflicts.length, 1, `同一处冲突必须只报一次，实际 ${JSON.stringify(warns)}`)
})

test('r60 D3：messages 按 (at,from,toMemberId,body) 去重并按时升序，两边新写的都保留', () => {
  const runId = 'r-merge-messages'
  const oldest = messageOf(now, '开局')
  const base = mergeState(runId, { messages: [oldest] })
  const oursMsg = messageOf(now + 200, '本次动作写入的账本', { taskId: 't1' })
  const theirsMsg = messageOf(now + 100, '锁外写者写入的账本', { toMemberId: 'm-t2' })
  const ours: RunState = { ...base, messages: [oldest, oursMsg] }
  const theirs: RunState = { ...base, messages: [oldest, theirsMsg, { ...theirsMsg }] }
  const merged = mergeRunState(base, ours, theirs)
  assert.deepEqual(
    merged.messages.map((message) => message.body),
    ['开局', '锁外写者写入的账本', '本次动作写入的账本'],
    '两边新写的消息都要在，且按 at 升序',
  )
  assert.equal(merged.messages.length, 3, '重复身份（同一 at/from/toMemberId/body）必须去重')
})

test('r60 D3：plan.tasks 先按 id 对齐再逐字段合并（两边各改不同字段都保留）', () => {
  const runId = 'r-merge-tasks'
  const base = mergeState(runId, {
    plan: { runId, sessionId: 's-legacy', createdAt: now, status: 'dispatching', maxConcurrent: 3, tasks: [taskOf('t1'), taskOf('t2')] },
  })
  const evidence = { taskId: 't1', command: 'pnpm test', exitCode: 0, tail: 'ok', artifacts: [], at: now }
  const ours: RunState = {
    ...base,
    plan: {
      ...base.plan,
      tasks: [
        { ...base.plan.tasks[0], status: 'running', memberId: 'm-t1' },
        base.plan.tasks[1],
        taskOf('t3'),
      ],
    },
  }
  const theirs: RunState = {
    ...base,
    plan: {
      ...base.plan,
      tasks: [
        { ...base.plan.tasks[0], title: '锁外改的标题', evidence },
        { ...base.plan.tasks[1], status: 'gate' },
      ],
    },
  }
  const merged = mergeRunState(base, ours, theirs)
  const t1 = merged.plan.tasks.find((task) => task.id === 't1')
  const t2 = merged.plan.tasks.find((task) => task.id === 't2')
  assert.equal(t1?.status, 'running', 'ours 改的 status 保留')
  assert.equal(t1?.memberId, 'm-t1', 'ours 改的 memberId 保留')
  assert.equal(t1?.title, '锁外改的标题', 'theirs 改的另一个字段保留')
  assert.deepEqual(t1?.evidence, evidence, 'theirs 写的门禁证据保留（锁外写者刚写的内容不能被抹掉）')
  assert.equal(t2?.status, 'gate', 'theirs 改的 t2 状态保留')
  assert.equal(merged.plan.tasks.some((task) => task.id === 't3'), true, 'ours 新增的任务保留')
  assert.equal(merged.plan.tasks.length, 3)
})

test('r60 D3：bindings / taskTimes / progress / usage.byMember 按键三方合并', () => {
  const runId = 'r-merge-keyed'
  const base = mergeState(runId, {
    bindings: [bindingOf('m-t1', 't1')],
    taskTimes: { t1: { startedAt: now } },
    progress: { 'm-t1': { at: now, calls: 1 } },
    usage: { attribution: 'per-member', byMember: { 'm-t1': { total: 10 } }, byTask: { t1: { total: 10 } }, updatedAt: now },
  })
  const ours: RunState = {
    ...base,
    bindings: [{ ...bindingOf('m-t1', 't1'), retired: true }, bindingOf('m-t2', 't2')],
    taskTimes: { t1: { startedAt: now, endedAt: now + 10 } },
    progress: { 'm-t1': { at: now + 10, calls: 3 } },
    usage: { ...base.usage!, byMember: { 'm-t1': { total: 20 } }, updatedAt: now + 10 },
  }
  const theirs: RunState = {
    ...base,
    bindings: [bindingOf('m-t1', 't1'), bindingOf('m-t3', 't3')],
    taskTimes: { t1: { startedAt: now }, t2: { startedAt: now + 5 } },
    progress: { 'm-t1': { at: now, calls: 1 }, 'm-t3': { at: now + 5, calls: 2 } },
    usage: {
      ...base.usage!,
      byMember: { 'm-t1': { total: 10 }, 'm-t3': { total: 5 } },
      byTask: { t1: { total: 10 }, t3: { total: 5 } },
      updatedAt: now + 5,
    },
  }
  const merged = mergeRunState(base, ours, theirs)
  assert.deepEqual(
    merged.bindings.map((binding) => binding.memberId).sort(),
    ['m-t1', 'm-t2', 'm-t3'],
    'bindings 按 memberId 对齐：两边各自新增的绑定都要在',
  )
  assert.equal(merged.bindings.find((binding) => binding.memberId === 'm-t1')?.retired, true, 'ours 改的 retired 保留')
  assert.equal(merged.taskTimes?.t1.endedAt, now + 10, 'ours 写的结束时刻保留')
  assert.equal(merged.taskTimes?.t2.startedAt, now + 5, 'theirs 新增的任务计时保留')
  assert.equal(merged.progress?.['m-t1'].calls, 3, 'ours 推进的步数保留')
  assert.equal(merged.progress?.['m-t3'].calls, 2, 'theirs 新增的推进记录保留')
  assert.equal(merged.usage?.byMember['m-t1'].total, 20, 'ours 累加的用量保留')
  assert.equal(merged.usage?.byMember['m-t3'].total, 5, 'theirs 新增成员的用量保留')
  assert.equal(merged.usage?.byTask.t3.total, 5, 'theirs 新增任务的用量保留')
})

test('r60 D3：saveWithCas 撞车后三方合并，锁外写者的账本必须活到落盘（丢更新判定）', () => {
  withTempDir((dir) => {
    const runId = 'r-merge-cas'
    const store = new RunsStore(dir)
    const seeded = wrapLegacy({ ...legacyPlan({ runId }), plannedAt: now })
    assert.ok(seeded)
    store.save(seeded) // rev=1
    const mine = store.load(runId)
    assert.ok(mine)

    const marker = messageOf(now + 50, '锁外写者写入的账本标记')
    let injected = false
    // 代理：在桥内第一次 save 之前插一次外部写盘（锁内 load 之后、save 之前的窗口）。
    const proxy = {
      load: (id: string) => store.load(id),
      save: (state: RunState, options?: { expectRev?: number }) => {
        if (!injected) {
          injected = true
          const disk = store.load(runId)
          assert.ok(disk)
          store.save({ ...disk, messages: [...disk.messages, marker] })
        }
        store.save(state, options)
      },
    }
    const applied = saveWithCas(proxy, { ...mine, plan: { ...mine.plan, status: 'paused' } })

    const disk = store.load(runId)
    assert.ok(disk)
    assert.equal(injected, true, '外部写盘必须真的发生过（否则没测到 CAS 窗口）')
    assert.equal(disk.plan.status, 'paused', '本次动作必须真的落盘')
    assert.equal(
      disk.messages.some((message) => message.body === marker.body),
      true,
      '锁外写者刚写的账本被 CAS 重试抹掉了 —— 只重基版本号就是丢更新',
    )
    assert.equal(disk.rev, applied.rev, '落盘版本号必须与返回的快照一致')
  })
})

test('r60 D3 边界：ours 没动 messages 时整段取 theirs（锁外账本一条都不能少）', () => {
  const runId = 'r-merge-only-theirs'
  const oldest = messageOf(now, '开局')
  const base = mergeState(runId, { messages: [oldest] })
  const marker = messageOf(now + 30, '锁外写者的账本')
  const ours: RunState = { ...base, plan: { ...base.plan, status: 'paused' } }
  const theirs: RunState = { ...base, messages: [oldest, marker], finishedAt: now + 40 }
  const merged = mergeRunState(base, ours, theirs)
  assert.deepEqual(
    merged.messages.map((message) => message.body),
    ['开局', '锁外写者的账本'],
    'ours 未动 messages → 必须整段取 theirs',
  )
  assert.equal(merged.finishedAt, now + 40, 'theirs 改的标量字段存活')
  assert.equal(merged.plan.status, 'paused', 'ours 改的字段同时存活')
})

test('r60 D3 边界：两边各追加同一条账本 → 合并只留一条；各自独有的都保留', () => {
  const runId = 'r-merge-messages-same'
  const oldest = messageOf(now, '开局')
  const shared = messageOf(now + 10, '两边都会写的那条')
  const mine = messageOf(now + 20, '我方独有')
  const other = messageOf(now + 30, '对方独有')
  const base = mergeState(runId, { messages: [oldest] })
  const merged = mergeRunState(
    base,
    { ...base, messages: [oldest, shared, mine] },
    { ...base, messages: [oldest, shared, other] },
  )
  assert.deepEqual(
    merged.messages.map((message) => message.body),
    ['开局', '两边都会写的那条', '我方独有', '对方独有'],
    '同身份去重、不同身份都要保留、按时升序',
  )
})

test('r60 D3 边界：两边改同一 task 的同一字段到不同值 → 取 ours 且写一条含 runId 与字段路径的 warn', () => {
  const runId = 'r-merge-task-conflict'
  const base = mergeState(runId, {
    plan: { runId, sessionId: 's-legacy', createdAt: now, status: 'dispatching', maxConcurrent: 3, tasks: [taskOf('t1'), taskOf('t2')] },
  })
  const ours: RunState = {
    ...base,
    plan: { ...base.plan, tasks: [base.plan.tasks[0], { ...base.plan.tasks[1], status: 'running' }] },
  }
  const theirs: RunState = {
    ...base,
    plan: { ...base.plan, tasks: [base.plan.tasks[0], { ...base.plan.tasks[1], status: 'gate', evidence: { taskId: 't2', command: 'x', exitCode: 0, tail: '', artifacts: [], at: now } }] },
  }
  const warns: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((value) => String(value)).join(' '))
  }
  let merged: RunState
  try {
    merged = mergeRunState(base, ours, theirs)
  } finally {
    console.warn = original
  }
  const t2 = merged.plan.tasks.find((task) => task.id === 't2')
  assert.equal(t2?.status, 'running', '同一 task 同一字段冲突 → 取 ours')
  assert.deepEqual(t2?.evidence, (theirs.plan.tasks[1] as PlanTask).evidence, 'theirs 在同一条上的其它字段仍保留')
  const conflicts = warns.filter((line) => line.includes(runId) && line.includes('status'))
  assert.equal(conflicts.length, 1, `冲突必须只报一次且带字段路径，实际 ${JSON.stringify(warns)}`)
})

test('r60 D3 边界：三方合并路径重试耗尽仍抛 StaleWriteError，盘上不留半成品', () => {
  withTempDir((dir) => {
    const runId = 'r-merge-exhaust'
    const store = new RunsStore(dir)
    const seeded = wrapLegacy({ ...legacyPlan({ runId }), plannedAt: now })
    assert.ok(seeded)
    store.save(seeded)
    const mine = store.load(runId)
    assert.ok(mine)
    const before = store.load(runId)
    assert.ok(before)

    let attempts = 0
    let loads = 0
    const foreverStale = {
      load: (id: string) => {
        loads += 1
        const current = store.load(id)
        if (current === null) return null
        // 每次重读都像是刚被别的写者推进过：rev 递增 → 每次都必陈旧
        return {
          ...current,
          rev: (current.rev ?? 0) + 1000,
          messages: [...current.messages, messageOf(now + loads, `锁外写者第 ${loads} 次`)],
        }
      },
      save: (state: RunState) => {
        attempts += 1
        throw new StaleWriteError(state.plan.runId, 1, 2)
      },
    }
    assert.throws(
      () => saveWithCas(foreverStale, { ...mine, plan: { ...mine.plan, status: 'paused' } }),
      (error: unknown) => error instanceof StaleWriteError,
      '重试耗尽必须原样抛出，不许吞掉或无限重试',
    )
    assert.equal(attempts, 3, 'maxRetries=2 → 最多 3 次写盘尝试')
    assert.equal(store.load(runId)?.plan.status, before.plan.status, '失败不得落任何半成品')
  })
})

// r61：本条覆盖的是 **D4 早窗口**（动作 load 之后、helper 内部 load 之前的外部写盘），不是 D3 的三方合并。
// 测试名按 r60 QA 报告 §7.5 的非阻塞建议改正（只改名与注释，断言未动）。
test('r60 D4 早窗口：外部写盘发生在动作 load 之后、helper 内部 load 之前（base 必须取拿锁时的快照）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-store-early-'))
  try {
    const runId = 'r-merge-early'
    const store = new RunsStore(dir)
    const seeded = wrapLegacy({ ...legacyPlan({ runId }), plannedAt: now })
    assert.ok(seeded)
    store.save(seeded)

    const marker = messageOf(now + 60, '早窗口锁外写者写入的账本')
    const applied = await store.withRunLock(runId, () => {
      // 动作开始：锁内 load 出 rev=1 的快照
      const actionStart = store.load(runId)
      assert.ok(actionStart)
      // 动作 await 期间：锁外写者（另一个 store 实例，完全不经锁）落盘 rev=2 + 一条账本标记
      const outsider = new RunsStore(dir)
      const disk = outsider.load(runId)
      assert.ok(disk)
      outsider.save({ ...disk, messages: [...disk.messages, marker] })
      // 动作拿着 rev=1 的结果写盘：base 必须用「拿锁时」的快照，而不是此刻的盘上态
      return saveWithCas(store, { ...actionStart, plan: { ...actionStart.plan, status: 'paused' } })
    })

    const after = store.load(runId)
    assert.ok(after)
    assert.equal(after.plan.status, 'paused', '本次动作必须落盘')
    assert.equal(
      after.messages.some((message) => message.body === marker.body),
      true,
      'base 必须取「动作开始时」的锁内快照；取写盘前一刻的盘上态会让 theirs===base 分支把锁外写者的字段整段丢掉',
    )
    assert.equal(after.rev, applied.rev)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
