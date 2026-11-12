/**
 * r26 QA 回归：计划阶段判定表（`runStageOf`）+ 宿主阶段计数派生 + 派发推进。
 *
 * 断言口径（每条都问过「把实现改回错误版本会不会红」）：
 *  - 判定表 11 条分支逐条命中；**顺序**也断言（failed>0 与 running>0 同时成立必须是「有失败」，
 *    把规则 5/7 对调立刻红）。
 *  - 守卫：`draft + running/failed/members/done===total` 四种输入都不得出现「计划就绪」；
 *    只有 `draft + 零成员 + 零完成 + total>0` 命中规则 10。把规则 10 的 `members === 0`
 *    放宽成「缺省也算 0」或把 `done === 0` 去掉，守卫用例立刻红。
 *  - 宿主计数：running | gate → running、failed → failed、interrupted → interrupted、
 *    未退役 binding → members；把 gate 漏算或把 retired binding 算进来都会红。
 *  - 旧数据：`store.list()` 的 summary **不带**这四个键（不补 0）；客户端拿不到计数时
 *    必须保守回落「待派发」，不能把缺失当 0 断言成「计划就绪」。
 *  - 派发推进：bridge 的 `case 'dispatch'` 与 auto-dispatch 的 `dispatchOnce` 都只在
 *    `outcome.started.length > 0` 时 draft→dispatching；全失败保持 draft；已是 dispatching
 *    时二次派发不再写盘（用 store.writeEpoch 数写盘次数）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridge, type Bridge, type BridgeDeps } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, advancePlanToDispatching, type RunState } from '../src/host/store.ts'
import { createAutoDispatcher } from '../src/host/team/auto-dispatch.ts'
import {
  currentRunStageInputOf,
  runStageOf,
  type RunStageInput,
  type RunStageKey,
} from '../src/client/viewmodel.ts'
import { runSummaryRowOf } from '../src/client/tabs/rows.ts'
import type { MemberBinding, Plan, PlanTask, Role, RunSummary, TaskStatus } from '../src/shared/types.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r26'
const RUN = 'run-r26'

/* ───────────────────────────── 夹具 ───────────────────────────── */

function taskOf(id: string, status: TaskStatus, extra: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: `exit ${id}`,
    status,
    ...extra,
  }
}

function planOf(over: Partial<Plan> = {}): Plan {
  return {
    runId: RUN,
    sessionId: SESSION,
    createdAt: NOW - 60_000,
    status: 'draft',
    tasks: [taskOf('t1', 'ready')],
    maxConcurrent: 3,
    ...over,
  }
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: planOf(),
    plannedAt: NOW - 60_000,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...over,
  }
}

function bindingOf(over: Partial<MemberBinding> = {}): MemberBinding {
  return {
    taskId: 't1',
    roleId: 'dev',
    memberId: 'member-1',
    name: '开发-1',
    spawnedAt: NOW - 10_000,
    ...over,
  }
}

function roleOf(id: string, name: string): Role {
  return { id, name, duty: `${name}的职责`, skillIds: [], builtin: false, updatedAt: NOW }
}

interface Harness {
  dir: string
  store: RunsStore
  bridge: Bridge
}

function makeHarness(overrides: Partial<BridgeDeps> = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r26-'))
  const store = new RunsStore(join(dir, 'runs'))
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir: join(dir, 'skills'), now: () => NOW })
  roles.seed()
  roles.save(roleOf('dev', '开发'))
  const deps: BridgeDeps = {
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: false }),
    applyReceipt: (state) => state,
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
    now: () => NOW,
    ...overrides,
  }
  mkdirSync(join(dir, 'artifacts'), { recursive: true })
  return { dir, store, bridge: createBridge(deps) }
}

async function enable(bridge: Bridge): Promise<void> {
  const result = await bridge.act(SESSION, { type: 'toggle', enabled: true })
  assert.equal(result.rejected, undefined, '启用动作本身不应被拒')
}

/* ───────────────── ① 判定表：11 条分支逐条命中 ───────────────── */

test('runStageOf：11 条分支逐条命中（文案/键/tone 全表）', () => {
  const cases: Array<[RunStageInput, RunStageKey, string, string]> = [
    [{}, 'disabled', '未启用', 'muted'],
    [{ planStatus: 'cancelled' }, 'cancelled', '已取消', 'muted'],
    [{ planStatus: 'terminated' }, 'terminated', '已终止', 'muted'],
    [{ planStatus: 'paused' }, 'paused', '已暂停', 'warn'],
    [{ planStatus: 'dispatching', total: 5, done: 0, running: 2, failed: 3 }, 'failed', '有失败 · 3', 'bad'],
    [{ planStatus: 'dispatching', total: 5, done: 0, running: 1, interrupted: 2 }, 'interrupted', '已中断 · 2', 'bad'],
    [{ planStatus: 'dispatching', total: 5, done: 1, running: 2 }, 'running', '执行中 · 1/5', 'ok'],
    [{ planStatus: 'dispatching', total: 3, done: 3, members: 1 }, 'closing', '待收口', 'warn'],
    [{ planStatus: 'dispatching', total: 4, done: 1 }, 'dispatching', '派发中 · 1/4', 'ok'],
    [{ planStatus: 'draft', total: 3, done: 0, members: 0 }, 'ready', '计划就绪 · 3 任务', 'ok'],
    [{ planStatus: 'draft', total: 3, done: 1, members: 0 }, 'pending', '待派发', 'muted'],
  ]
  for (const [input, key, label, tone] of cases) {
    const stage = runStageOf(input)
    assert.equal(stage.key, key, `${JSON.stringify(input)} 的阶段键`)
    assert.equal(stage.label, label, `${JSON.stringify(input)} 的阶段文案`)
    assert.equal(stage.tone, tone, `${JSON.stringify(input)} 的 tone`)
    assert.ok((stage.detail ?? '').trim() !== '', '每个阶段都要有人话 detail（title 用）')
  }
  assert.equal(new Set(cases.map(([, key]) => key)).size, 11, '11 条分支必须互不相同')

  // detail 透传终止原因；无原因给可读默认值（不是空串/undefined）
  assert.equal(runStageOf({ planStatus: 'terminated', terminationReason: '计划长时间无活动' }).detail, '计划长时间无活动')
  assert.equal(runStageOf({ planStatus: 'terminated' }).detail, '计划已终止，不再派发新任务')
  assert.equal(runStageOf({ planStatus: 'cancelled' }).detail, '计划已取消，不再派发新任务')

  // total 缺席时 running/dispatching 用不带进度的措辞（不编 0/0）
  assert.equal(runStageOf({ planStatus: 'dispatching', running: 1 }).label, '执行中')
  assert.equal(runStageOf({ planStatus: 'dispatching' }).label, '派发中')
})

/* ───────────────── ② 判定表：优先级顺序 ───────────────── */

test('runStageOf：优先级 —— 失败 > 中断 > 在跑 > 待收口 > 派发中 > 就绪', () => {
  // 队长点名的反例：failed>0 同时 running>0 必须是「有失败」，不能是「执行中」
  const failedAndRunning = runStageOf({ planStatus: 'dispatching', total: 5, done: 1, running: 2, failed: 1 })
  assert.equal(failedAndRunning.key, 'failed', 'failed 的优先级高于 running')
  assert.notEqual(failedAndRunning.label, '执行中 · 1/5')

  assert.equal(runStageOf({ planStatus: 'dispatching', total: 5, interrupted: 2, running: 2 }).key, 'interrupted', 'interrupted 优先于 running')
  assert.equal(runStageOf({ planStatus: 'dispatching', total: 5, failed: 1, interrupted: 2 }).key, 'failed', 'failed 优先于 interrupted')

  // 终态 / 暂停在计数之前：坏消息也要让位给「这条流水线已经不在跑」
  assert.equal(runStageOf({ planStatus: 'terminated', failed: 3, running: 1 }).key, 'terminated')
  assert.equal(runStageOf({ planStatus: 'cancelled', failed: 3 }).key, 'cancelled')
  assert.equal(runStageOf({ planStatus: 'paused', failed: 3, running: 1 }).key, 'paused')
  assert.equal(runStageOf({ failed: 3 } as RunStageInput).key, 'disabled', '无计划时连失败都不算')

  // running 优先于「任务全结束但未收口」（否则最后几个任务刚结束就被写成待收口）
  const runningWhileAllDone = runStageOf({ planStatus: 'dispatching', total: 3, done: 3, running: 1, members: 1 })
  assert.equal(runningWhileAllDone.key, 'running')

  // 待收口优先于派发中（done===total 时不能被写成「派发中 · 3/3」）
  const allDone = runStageOf({ planStatus: 'dispatching', total: 3, done: 3, members: 1 })
  assert.equal(allDone.key, 'closing')
  assert.equal(allDone.label, '待收口')

  // 已收口（有原因 + 有结束时刻）时不再命中待收口
  const closed = runStageOf({ planStatus: 'terminated', total: 3, done: 3, terminationReason: '用户终止', finishedAt: NOW })
  assert.equal(closed.key, 'terminated')
})

/* ───────────────── ③ 守卫：draft 不得冒充「计划就绪」 ───────────────── */

test('runStageOf：draft 的四类残留输入都不得出现「计划就绪」', () => {
  const guards: Array<[string, RunStageInput]> = [
    ['draft + running>0', { planStatus: 'draft', total: 3, done: 0, members: 0, running: 1 }],
    ['draft + done===total', { planStatus: 'draft', total: 3, done: 3, members: 0, running: 0 }],
    ['draft + failed>0', { planStatus: 'draft', total: 3, done: 0, members: 0, failed: 1 }],
    ['draft + members>0', { planStatus: 'draft', total: 3, done: 0, members: 1 }],
  ]
  for (const [name, input] of guards) {
    const stage = runStageOf(input)
    assert.notEqual(stage.key, 'ready', `${name} 不得命中计划就绪`)
    assert.doesNotMatch(stage.label, /计划就绪/, `${name} 的文案不得出现「计划就绪」`)
  }

  // 唯一合法命中：零成员 + 零完成 + total>0（计数必须显式给 0，缺省不算 0）
  const ready = runStageOf({ planStatus: 'draft', total: 3, done: 0, running: 0, failed: 0, interrupted: 0, members: 0 })
  assert.equal(ready.key, 'ready')
  assert.equal(ready.label, '计划就绪 · 3 任务')

  // 缺计数 ≠ 0：只给 planStatus + total 时必须走最保守的「待派发」
  const uncounted = runStageOf({ planStatus: 'draft', total: 3 })
  assert.equal(uncounted.key, 'pending', '缺成员/失败计数时不能断言就绪')
  assert.equal(uncounted.label, '待派发')
})

/* ───────────────── ④ 宿主：RunSummary 计数从 RunState 派生 ───────────────── */

test('宿主：snapshot.runs 与 runCounts 从真实 RunState 派生四项计数（retired 不计成员）', () => {
  const h = makeHarness()
  h.store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [
          taskOf('t1', 'running', { memberId: 'm1' }),
          taskOf('t2', 'gate', { memberId: 'm2' }),
          taskOf('t3', 'failed'),
          taskOf('t4', 'interrupted', { memberId: 'm3' }),
          taskOf('t5', 'done'),
          taskOf('t6', 'pending'),
        ],
      }),
      bindings: [
        bindingOf({ taskId: 't1', memberId: 'm1', name: '开发-1' }),
        // 已退休的 binding 不得算进 members
        bindingOf({ taskId: 't2', memberId: 'm2', name: '开发-2', retired: true }),
        bindingOf({ taskId: 't4', memberId: 'm3', name: '开发-3' }),
      ],
    }),
  )

  const snapshot = h.bridge.snapshot(SESSION)
  assert.deepEqual(snapshot.runCounts, { running: 2, failed: 1, interrupted: 1, members: 2 }, 'running|gate 都算 running；retired binding 不算成员')
  const row = snapshot.runs?.find((run) => run.runId === RUN)
  assert.ok(row, '当前会话的 run 必须出现在历史列表里')
  assert.equal(row.running, 2)
  assert.equal(row.failed, 1)
  assert.equal(row.interrupted, 1)
  assert.equal(row.members, 2)
  assert.equal(row.done, 1)
  assert.equal(row.tasks, 6)

  // store.list() 只投影原始事实，不派生阶段计数 —— 旧路径不会凭 0 猜「没有失败/没有成员」
  const summary = h.store.list()[0]
  assert.ok(summary)
  for (const key of ['running', 'failed', 'interrupted', 'members'] as const) {
    assert.equal(Object.prototype.hasOwnProperty.call(summary, key), false, `store.list 不得补 ${key}=0`)
    assert.equal(summary[key], undefined)
  }
})

test('客户端：旧 RunSummary 缺计数时保守回落，不得把 undefined 当 0 断言「计划就绪」', () => {
  const legacy: RunSummary = {
    runId: 'run-legacy',
    sessionId: SESSION,
    createdAt: NOW,
    status: 'draft',
    tasks: 3,
    done: 0,
  }
  assert.equal(runSummaryRowOf(legacy).statusText, '待派发', '缺计数 → 待派发（不是计划就绪）')

  const counted: RunSummary = { ...legacy, running: 0, failed: 0, interrupted: 0, members: 0 }
  assert.equal(runSummaryRowOf(counted).statusText, '计划就绪 · 3 任务', '计数齐全且全 0 才命中规则 10')
})

/* ───────────────── ⑤ 宿主：dispatch 推进只进不退 ───────────────── */

test('bridge dispatch：成功才 draft→dispatching；失败保持 draft；二次派发不再写盘', async () => {
  let outcome: 'ok' | 'fail' = 'ok'
  let dispatchCalls = 0
  const h = makeHarness({
    dispatch: async () => {
      dispatchCalls += 1
      return outcome === 'ok'
        ? { started: ['t1'], skipped: [], errors: [] }
        : { started: [], skipped: [], errors: [{ taskId: 't1', error: 'spawn 失败', code: 'BAD_REQUEST' }] }
    },
  })
  h.store.save(stateOf())
  await enable(h.bridge)

  const epochBefore = h.store.writeEpoch()
  const accepted = await h.bridge.act(SESSION, { type: 'dispatch' })
  assert.equal(accepted.rejected, undefined, '成功派发不应被拒')
  assert.equal(dispatchCalls, 1)
  assert.equal(h.store.load(RUN)?.plan.status, 'dispatching', 'started>0 → 计划推进到 dispatching')
  assert.equal(h.store.writeEpoch(), epochBefore + 1, '推进恰好一次写盘')

  // 二次派发：已是 dispatching，advance 返回 null → 不得再写盘（幂等）
  const epochAfterFirst = h.store.writeEpoch()
  const again = await h.bridge.act(SESSION, { type: 'dispatch', runId: RUN })
  assert.equal(again.rejected, undefined, '二次派发可以受理（成员已在跑不是错误）')
  assert.equal(h.store.load(RUN)?.plan.status, 'dispatching', '只进不退：仍为 dispatching')
  assert.equal(h.store.writeEpoch(), epochAfterFirst, '二次派发不得重复推进落盘')

  // 全失败：开始前是 draft → 保持 draft，且零写盘
  const failed = makeHarness({
    dispatch: async () => ({ started: [], skipped: [], errors: [{ taskId: 't1', error: 'spawn 失败', code: 'BAD_REQUEST' }] }),
  })
  failed.store.save(stateOf())
  await enable(failed.bridge)
  const failedEpoch = failed.store.writeEpoch()
  const rejected = await failed.bridge.act(SESSION, { type: 'dispatch' })
  assert.equal(rejected.rejected?.code, 'BAD_REQUEST')
  assert.equal(rejected.rejected?.message, 'spawn 失败')
  assert.equal(failed.store.load(RUN)?.plan.status, 'draft', '全失败必须保持 draft（还能再点派发）')
  assert.equal(failed.store.writeEpoch(), failedEpoch, '失败不得推进落盘')

  // 纯函数：只进不退/幂等
  const drafted = stateOf()
  const advanced = advancePlanToDispatching(drafted)
  assert.equal(advanced?.plan.status, 'dispatching')
  assert.deepEqual(advanced?.plan.tasks, drafted.plan.tasks, '推进只改计划状态，不动任务')
  assert.equal(drafted.plan.status, 'draft', '不得原地修改入参')
  for (const status of ['dispatching', 'paused', 'terminated', 'cancelled'] as const) {
    assert.equal(advancePlanToDispatching(stateOf({ plan: planOf({ status }) })), null, `${status} 不再推进`)
  }
})

/* ───────────────── ⑥ auto-dispatch：同一推进条件 ───────────────── */

test('auto-dispatch：仅在 started>0 时推进；全失败保持 draft；幂等不重复写盘', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r26-auto-'))
  const store = new RunsStore(join(dir, 'runs'))
  let mode: 'ok' | 'fail' = 'ok'
  const dispatcher = createAutoDispatcher({
    store,
    dispatch: async () =>
      mode === 'ok'
        ? { started: ['t1'], skipped: [], errors: [] }
        : { started: [], skipped: [], errors: [{ taskId: 't1', error: 'boom' }] },
    now: () => NOW,
  })
  try {
    store.save(stateOf())
    const reports = await dispatcher.tick()
    assert.equal(reports.length, 1)
    assert.deepEqual(reports[0].started, ['t1'])
    assert.equal(store.load(RUN)?.plan.status, 'dispatching', '自动路径同样推进')

    const epoch = store.writeEpoch()
    const second = await dispatcher.tick()
    assert.equal(second.length, 1, '任务仍无 binding，tick 仍会尝试')
    assert.equal(store.load(RUN)?.plan.status, 'dispatching', '已是 dispatching：只进不退')
    assert.equal(store.writeEpoch(), epoch, 'advance 返回 null 时不得重复落盘')
  } finally {
    dispatcher.dispose()
  }

  // 全失败：保持 draft，且报告里有可读原因
  const dir2 = mkdtempSync(join(tmpdir(), 'auto-team-r26-auto-fail-'))
  const store2 = new RunsStore(join(dir2, 'runs'))
  mode = 'fail'
  const failing = createAutoDispatcher({
    store: store2,
    dispatch: async () => ({ started: [], skipped: [], errors: [{ taskId: 't1', error: 'boom' }] }),
    now: () => NOW,
  })
  try {
    store2.save(stateOf())
    const before = store2.writeEpoch()
    const reports = await failing.tick()
    assert.equal(reports[0].failed, 1)
    assert.match(reports[0].errors[0] ?? '', /t1：boom/)
    assert.match(reports[0].reason ?? '', /全部失败/)
    assert.equal(store2.load(RUN)?.plan.status, 'draft', '全失败保持 draft')
    assert.equal(store2.writeEpoch(), before, '失败不得推进落盘')
  } finally {
    failing.dispose()
  }
})

/* ───────────────── ⑦ 历史 run 与当前 run 同输入 → 逐字相等 ───────────────── */

test('历史 run 与当前 run 用同一判定函数：阶段视图逐字相等', () => {
  const h = makeHarness()
  h.store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [
          taskOf('t1', 'running', { memberId: 'm1' }),
          taskOf('t2', 'failed'),
          taskOf('t3', 'pending'),
        ],
      }),
      bindings: [bindingOf({ taskId: 't1', memberId: 'm1' })],
    }),
  )
  const snapshot = h.bridge.snapshot(SESSION)
  const row = snapshot.runs?.find((run) => run.runId === RUN)
  assert.ok(row)
  const fromHistory = runStageOf({
    planStatus: row.status,
    total: row.tasks,
    done: row.done,
    ...(row.running !== undefined ? { running: row.running } : {}),
    ...(row.failed !== undefined ? { failed: row.failed } : {}),
    ...(row.interrupted !== undefined ? { interrupted: row.interrupted } : {}),
    ...(row.members !== undefined ? { members: row.members } : {}),
    ...(row.terminationReason !== undefined ? { terminationReason: row.terminationReason } : {}),
    ...(row.finishedAt !== undefined ? { finishedAt: row.finishedAt } : {}),
  })
  const fromCurrent = runStageOf(currentRunStageInputOf(snapshot))
  assert.deepEqual(fromHistory, fromCurrent, '同一条 run 在历史行与当前 run 的阶段必须逐字相等')
  assert.equal(fromCurrent.key, 'failed')
  assert.equal(runSummaryRowOf(row).statusText, fromCurrent.label, '历史行渲染的徽标文案也同源')

  // 零计数场景：两边都必须命中「计划就绪」，而不是一边就绪一边待派发
  const h2 = makeHarness()
  h2.store.save(
    stateOf({
      plan: planOf({
        status: 'draft',
        tasks: [taskOf('a', 'pending'), taskOf('b', 'blocked', { dependsOn: ['a'] })],
      }),
    }),
  )
  const snapshot2 = h2.bridge.snapshot(SESSION)
  const row2 = snapshot2.runs?.find((run) => run.runId === RUN)
  assert.ok(row2)
  const history2 = runStageOf({
    planStatus: row2.status,
    total: row2.tasks,
    done: row2.done,
    ...(row2.running !== undefined ? { running: row2.running } : {}),
    ...(row2.failed !== undefined ? { failed: row2.failed } : {}),
    ...(row2.interrupted !== undefined ? { interrupted: row2.interrupted } : {}),
    ...(row2.members !== undefined ? { members: row2.members } : {}),
  })
  const current2 = runStageOf(currentRunStageInputOf(snapshot2))
  assert.deepEqual(history2, current2)
  assert.equal(current2.label, '计划就绪 · 2 任务')
})
