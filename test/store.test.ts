/**
 * 存储层单测：`RunState` v2 原子读写、v1 裸 `Plan` 自动升级、消息账本上限 200。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_MAX_CONCURRENT, MAX_CONCURRENT_LIMIT } from '../src/host/config.ts'
import {
  MESSAGES_LIMIT,
  RUN_STATE_VERSION,
  RunsStore,
  STALL_ALERTS_LIMIT,
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
    assert.equal(JSON.parse(readFileSync(join(dir, 'run-legacy.json'), 'utf8')).version, 2)

    const loaded = store.load('run-legacy')
    assert.ok(loaded)
    assert.equal(loaded.version, 2)
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

test('load 能读磁盘上的 v1 裸 Plan 文件（自动升 v2）', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'legacy.json'), JSON.stringify(legacyPlan({ runId: 'legacy' })), 'utf8')
    const state = new RunsStore(dir).load('legacy')
    assert.ok(state)
    assert.equal(state.version, 2)
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
