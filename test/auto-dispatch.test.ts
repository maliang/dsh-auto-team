/**
 * r13 T3：自动派发单测。
 *
 * 覆盖三组不变量：
 *  1. `shouldAutoDispatch` 的每道前置闸（计划状态 / 暂停双闸 / 无就绪 / 全部已派）；
 *  2. 派发器本身：5 个触发点都会真的调派发端口、单飞不重复起人、幂等、连续失败退避与 reset；
 *  3. 与**真实** `dispatchReady` 的合体（AC-9 四道闸 + AC-20 计时 + AC-11 forceParallel 放行）——
 *     自动派发必须是既有派发路径的调用方，而不是第二条实现，所以这里直接跑真编排层。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MemberBinding, Plan, PlanTask, Role } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import type { RoleRepo } from '../src/host/roles/repo.ts'
import type { HostMember } from '../src/host/team/watcher.ts'
import {
  AUTO_DISPATCH_STALLED_TEXT,
  createAutoDispatcher,
  shouldAutoDispatch,
  type AutoDispatchCause,
  type AutoDispatchOutcome,
} from '../src/host/team/auto-dispatch.ts'
import { applyReceipt, dispatchReady, type DispatchDeps, type SpawnInput } from '../src/host/team/dispatch.ts'
import { AUTO_DISPATCH_RETRY_LIMIT } from '../src/shared/const.ts'

const now = 1_700_000_000_000

function makeTask(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'pnpm typecheck',
    status: 'pending',
    ...overrides,
  }
}

function makePlan(tasks: PlanTask[], overrides: Partial<Plan> = {}): Plan {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    createdAt: now,
    status: 'dispatching',
    tasks,
    maxConcurrent: 3,
    ...overrides,
  }
}

function makeState(tasks: PlanTask[], overrides: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: makePlan(tasks),
    plannedAt: now,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...overrides,
  }
}

function makeRole(id: string): Role {
  return { id, name: id, duty: '负责交付', skillIds: [], builtin: true, updatedAt: now }
}

function makeRoleRepo(roles: Role[]): RoleRepo {
  const map = new Map(roles.map((role) => [role.id, role]))
  return {
    list: () => [...map.values()],
    get: (id: string) => map.get(id),
    save: (role: Role) => ({ ok: true as const, role }),
    remove: () => ({ ok: true as const }),
    seed: () => {},
    restoreDefaults: () => ({ restored: [], kept: [] }),
  }
}

function bindingOf(taskId: string, name: string, spawnedAt = now): MemberBinding {
  return { taskId, roleId: 'dev', memberId: `m-${name}`, name, spawnedAt }
}

function makeStore(): { store: RunsStore; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-auto-dispatch-'))
  return { store: new RunsStore(dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

interface DepsOptions {
  hostLimit?: number
  members?: HostMember[]
}

function makeDeps(store: RunsStore, options: DepsOptions = {}): { deps: DispatchDeps; spawned: SpawnInput[] } {
  const spawned: SpawnInput[] = []
  const deps: DispatchDeps = {
    store,
    roles: makeRoleRepo([makeRole('dev')]),
    buildPrompt: (input) => `你是 ${input.role?.name ?? '成员'}；任务：${input.task.title}（${input.name}）`,
    listMembers: async () => options.members ?? [],
    spawn: async (input) => {
      spawned.push(input)
      return { ok: true, memberId: `m-${input.name}` }
    },
    hostConcurrency: () => ({ limit: options.hostLimit ?? 8, source: 'host' }),
    now: () => now,
  }
  return { deps, spawned }
}

const delay = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** kick 是 setTimeout(0) + fire-and-forget：刷几拍让定时器与内部 await 链都跑完。 */
async function flush(rounds = 6): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await delay(0)
}

function fakeDispatcher(
  store: RunsStore,
  outcome: (state: RunState) => Promise<AutoDispatchOutcome> = async () => ({ started: [], skipped: [], errors: [] }),
): { dispatcher: ReturnType<typeof createAutoDispatcher>; calls: string[]; causes: AutoDispatchCause[]; statuses: string[] } {
  const calls: string[] = []
  const causes: AutoDispatchCause[] = []
  const statuses: string[] = []
  const dispatcher = createAutoDispatcher({
    store,
    dispatch: (state) => {
      calls.push(state.plan.runId)
      return outcome(state)
    },
    onStatus: (runId, text) => statuses.push(`${runId}:${text}`),
  })
  return { dispatcher, calls, causes, statuses }
}

/* ───────────────────────────── 1. shouldAutoDispatch 各闸 ───────────────────────────── */

test('shouldAutoDispatch：只有 dispatching/draft + 未暂停 + 有未被派出的就绪任务才放行', () => {
  const ready = makeState([makeTask('t1')])
  assert.deepEqual(shouldAutoDispatch(ready), { ok: true })

  const draft = makeState([makeTask('t1')], { plan: makePlan([makeTask('t1')], { status: 'draft' }) })
  assert.equal(shouldAutoDispatch(draft).ok, true)

  for (const status of ['paused', 'terminated', 'cancelled'] as const) {
    const state = makeState([makeTask('t1')], { plan: makePlan([makeTask('t1')], { status }) })
    const verdict = shouldAutoDispatch(state)
    assert.equal(verdict.ok, false, status)
    assert.match(verdict.reason ?? '', new RegExp(status))
  }

  // 暂停双闸：planStatus 还是 dispatching、但 run 上有 pause 记账 → 绝不派发。
  const paused = makeState([makeTask('t1')], { pause: { at: now, planStatus: 'dispatching', tasks: {} } })
  assert.equal(shouldAutoDispatch(paused).ok, false)
  assert.match(shouldAutoDispatch(paused).reason ?? '', /暂停/)

  // 没有就绪任务（全部终态或者依赖未满足）。
  const blockedOnly = makeState([makeTask('t1', { status: 'blocked', dependsOn: ['t0'] })])
  assert.equal(shouldAutoDispatch(blockedOnly).ok, false)

  // 就绪任务已有未退役 binding = 已经派过，不该重复触发（AC-10 的幂等判据）。
  const bound = makeState([makeTask('t1', { status: 'running' })])
  assert.equal(shouldAutoDispatch(bound).ok, false)
  const boundReady = makeState([makeTask('t1')], { bindings: [bindingOf('t1', 'dev-t1')] })
  const verdict = shouldAutoDispatch(boundReady)
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason ?? '', /均已派出/)
  // 退役的 binding 不算「已派出」：重建成员是合法路径。
  const retired = makeState([makeTask('t1')], { bindings: [{ ...bindingOf('t1', 'dev-t1'), retired: true }] })
  assert.equal(shouldAutoDispatch(retired).ok, true)

  // 写域闸挡下的 waiting：没放行前不算可动，用户确认「强制并行」后必须被判成可派发（否则 tick 永远不复活它）。
  const waiting = makeState([makeTask('t1', { status: 'waiting', waitingOn: ['t0'] })])
  assert.equal(shouldAutoDispatch(waiting).ok, false)
  assert.equal(shouldAutoDispatch({ ...waiting, forceParallel: ['t1'] }).ok, true)
  // 放行的是别的任务时，不得顺带复活被挡的这一个。
  assert.equal(shouldAutoDispatch({ ...waiting, forceParallel: ['t2'] }).ok, false)
})

/* ───────────────────────────── 2. 派发器：5 触发 / 单飞 / 幂等 / 退避 ───────────────────────────── */

test('kick：5 个触发点都会真的调用派发端口（AC-8 的五个变异面）', async () => {
  const { store, cleanup } = makeStore()
  try {
    store.save(makeState([makeTask('t1')]))
    const { dispatcher, calls } = fakeDispatcher(store)
    const causes: AutoDispatchCause[] = ['plan-saved', 'task-terminal', 'member-exit', 'tasks-added', 'tick']
    for (const [index, cause] of causes.entries()) {
      dispatcher.kick('session-1', 'run-1', cause)
      await flush()
      assert.equal(calls.length, index + 1, `触发点 ${cause} 必须调用派发端口`)
    }
    assert.equal(new Set(calls).size, 1)
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('kick：runId 缺省时按会话解析最近一次 run，未知会话/未知 run 不派发也不抛', async () => {
  const { store, cleanup } = makeStore()
  try {
    store.save(makeState([makeTask('t1')]))
    const { dispatcher, calls } = fakeDispatcher(store)
    dispatcher.kick('session-1', undefined, 'member-exit')
    await flush()
    assert.deepEqual(calls, ['run-1'])

    dispatcher.kick('session-other', undefined, 'member-exit')
    dispatcher.kick('session-1', 'run-missing', 'tick')
    await flush()
    assert.deepEqual(calls, ['run-1'])
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('runId 与会话不匹配时拒绝派发（防串号）', async () => {
  const { store, cleanup } = makeStore()
  try {
    store.save(makeState([makeTask('t1')]))
    const { dispatcher, calls } = fakeDispatcher(store)
    dispatcher.kick('session-1', 'run-1', 'task-terminal')
    await flush()
    assert.equal(calls.length, 1)

    // 用另一个会话 + 同一个 runId：必须被拒，端口不能再被调。
    dispatcher.reset('run-1')
    dispatcher.kick('session-2', 'run-1', 'task-terminal')
    await flush()
    assert.equal(calls.length, 1)
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('单飞：同一 run 并发两次 kick 只调一次派发端口，且期间 inflight 为真', async () => {
  const { store, cleanup } = makeStore()
  try {
    store.save(makeState([makeTask('t1')]))
    const calls: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const dispatcher = createAutoDispatcher({
      store,
      dispatch: async (state) => {
        calls.push(state.plan.runId)
        await gate
        return { started: [], skipped: [], errors: [] }
      },
    })
    dispatcher.kick('session-1', 'run-1', 'plan-saved')
    dispatcher.kick('session-1', 'run-1', 'tasks-added')
    await delay(2)
    assert.equal(calls.length, 1)
    assert.equal(dispatcher.inflight('session-1'), true)
    assert.equal(dispatcher.inflight('session-2'), false)
    release()
    await flush()
    assert.equal(dispatcher.inflight('session-1'), false)
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('退避：连续失败到上限后停手并播报一次；reset 后恢复（AC-8 失败可见）', async () => {
  const { store, cleanup } = makeStore()
  try {
    store.save(makeState([makeTask('t1')]))
    const { dispatcher, calls, statuses } = fakeDispatcher(store, async () => {
      throw new Error('spawn 端口炸了')
    })
    for (let index = 0; index < AUTO_DISPATCH_RETRY_LIMIT; index += 1) {
      dispatcher.kick('session-1', 'run-1', 'tick')
      await flush()
    }
    assert.equal(calls.length, AUTO_DISPATCH_RETRY_LIMIT)
    assert.equal(statuses.length, 1)
    assert.match(statuses[0]!, /run-1:自动派发连续失败，需人工处理/)
    assert.equal(statuses[0]!.includes(AUTO_DISPATCH_STALLED_TEXT), true)

    // 到上限后 tick 也不再重试（否则 watcher 每 1.5s 会重放同一条失败）。
    await dispatcher.tick()
    dispatcher.kick('session-1', 'run-1', 'tick')
    await flush()
    assert.equal(calls.length, AUTO_DISPATCH_RETRY_LIMIT)

    dispatcher.reset('run-1')
    dispatcher.kick('session-1', 'run-1', 'tick')
    await flush()
    assert.equal(calls.length, AUTO_DISPATCH_RETRY_LIMIT + 1)
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('退避：部分成功（started 非空）清零计数，不累计为失败', async () => {
  const { store, cleanup } = makeStore()
  try {
    store.save(makeState([makeTask('t1')]))
    let round = 0
    const { dispatcher, calls, statuses } = fakeDispatcher(store, async () => {
      round += 1
      // 交替：失败 → 失败 → 有进展，理论上永远到不了上限。
      if (round % 3 === 0) return { started: ['t1'], skipped: [], errors: [{ taskId: 't2', error: 'x' }] }
      return { started: [], skipped: [], errors: [{ taskId: 't1', error: 'x' }] }
    })
    for (let index = 0; index < 8; index += 1) {
      dispatcher.kick('session-1', 'run-1', 'tick')
      await flush()
    }
    assert.equal(calls.length, 8)
    assert.deepEqual(statuses, [])
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('tick：只扫活动 run，返回报告；非活动/已终止 run 不派发', async () => {
  const { store, cleanup } = makeStore()
  try {
    store.save(makeState([makeTask('t1')]))
    store.save(
      makeState([makeTask('t1', { status: 'done' })], { plan: makePlan([makeTask('t1', { status: 'done' })], { runId: 'run-done', status: 'terminated' }) }),
    )
    store.save(
      makeState([makeTask('t1', { status: 'done' })], { plan: makePlan([makeTask('t1', { status: 'done' })], { runId: 'run-2', status: 'dispatching' }) }),
    )
    const { dispatcher, calls } = fakeDispatcher(store)
    const reports = await dispatcher.tick()
    assert.deepEqual(calls, ['run-1'])
    assert.equal(reports.length, 1)
    assert.equal(reports[0]!.runId, 'run-1')
    assert.equal(reports[0]!.cause, 'tick')
    assert.equal(reports[0]!.attempted, true)
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('dispose：之后 kick 不再派发，残留定时器被清空', async () => {
  const { store, cleanup } = makeStore()
  try {
    store.save(makeState([makeTask('t1')]))
    const { dispatcher, calls } = fakeDispatcher(store)
    dispatcher.kick('session-1', 'run-1', 'plan-saved')
    dispatcher.dispose()
    await flush()
    assert.deepEqual(calls, [])
    assert.equal(await dispatcher.tick().then((items) => items.length), 0)
  } finally {
    cleanup()
  }
})

/* ───────────────────── 3. 与真实 dispatchReady 合体（AC-9 四道闸 / AC-20 / AC-11） ───────────────────── */

test('AC-9 并发闸：maxConcurrent=1 且 3 个就绪 → 自动派发只起 1 人，其余 CONCURRENCY_FULL', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')]
    store.save(makeState(tasks, { plan: makePlan(tasks, { maxConcurrent: 1 }) }))
    const { deps, spawned } = makeDeps(store)
    const dispatcher = createAutoDispatcher({ store, dispatch: (state) => dispatchReady(state, deps) })
    const reports = await dispatcher.tick()
    assert.equal(spawned.length, 1)
    assert.deepEqual(reports[0]!.started, ['t1'])
    assert.equal(reports[0]!.skipped, 2)
    assert.equal(store.load('run-1')!.plan.tasks.filter((task) => task.status === 'running').length, 1)
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('AC-9 依赖闸：上游未终态 → 下游 spawn 0；上游 done 后自动补齐', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1', { status: 'running', memberId: 'm-dev-t1' }), makeTask('t2', { dependsOn: ['t1'] })]
    const state: RunState = makeState(tasks, {
      plan: makePlan(tasks, { maxConcurrent: 2 }),
      bindings: [bindingOf('t1', 'dev-t1')],
    })
    store.save(state)
    const { deps, spawned } = makeDeps(store, { members: [{ id: 'm-dev-t1', name: 'dev-t1', status: 'running' }] })
    const dispatcher = createAutoDispatcher({ store, dispatch: (next) => dispatchReady(next, deps) })
    await dispatcher.tick()
    assert.deepEqual(spawned.map((item) => item.task.id), [])

    // 上游进入终态（回执）→ 下游解锁，下一次 tick 自动补齐。
    const done = applyReceipt(store.load('run-1')!, 't1', { verdict: 'done' }, now + 1_000)
    store.save(done)
    await dispatcher.tick()
    assert.deepEqual(spawned.map((item) => item.task.id), ['t2'])
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('AC-9 写域闸：冲突任务停在 waiting 且 spawn 0；确认 forceParallel 后同一任务被放行', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [
      makeTask('t1', { status: 'running', memberId: 'm-dev-t1', writeScopes: ['src/host/bridge.ts'] }),
      makeTask('t2', { writeScopes: ['src/host/bridge.ts'] }),
    ]
    const base = makeState(tasks, { plan: makePlan(tasks, { maxConcurrent: 2 }), bindings: [bindingOf('t1', 'dev-t1')] })
    store.save(base)
    const { deps, spawned } = makeDeps(store, { members: [{ id: 'm-dev-t1', name: 'dev-t1', status: 'running' }] })
    const dispatcher = createAutoDispatcher({ store, dispatch: (next) => dispatchReady(next, deps) })

    await dispatcher.tick()
    assert.deepEqual(spawned.map((item) => item.task.id), [])
    const waiting = store.load('run-1')!.plan.tasks.find((task) => task.id === 't2')!
    assert.equal(waiting.status, 'waiting')
    assert.deepEqual(waiting.waitingOn, ['t1'])

    // 用户在确认弹窗里批准「强制并行」：bridge 把 taskId 记进 run 的 forceParallel。
    const forcedState = store.load('run-1')!
    store.save({ ...forcedState, forceParallel: ['t2'] })
    await dispatcher.tick()
    assert.deepEqual(spawned.map((item) => item.task.id), ['t2'])
    const started = store.load('run-1')!.plan.tasks.find((task) => task.id === 't2')!
    assert.equal(started.status, 'running')
    assert.equal(started.waitingOn, undefined)
    assert.equal(started.waitReason, undefined)
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('AC-9 暂停闸：paused 期间 spawn 0；恢复后自动补齐', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1')]
    store.save(makeState(tasks, {
      plan: makePlan(tasks, { status: 'paused' }),
      pause: { at: now, planStatus: 'dispatching', tasks: {} },
    }))
    const { deps, spawned } = makeDeps(store)
    const dispatcher = createAutoDispatcher({ store, dispatch: (state) => dispatchReady(state, deps) })
    const pausedReports = await dispatcher.tick()
    assert.deepEqual(pausedReports, [])
    assert.equal(spawned.length, 0)

    // 恢复：planStatus 还原 + 清掉 pause 记账（bridge resume 的同一口径）。
    const paused = store.load('run-1')!
    store.save({ ...paused, plan: { ...paused.plan, status: 'dispatching' }, pause: undefined })
    await dispatcher.tick()
    assert.deepEqual(spawned.map((item) => item.task.id), ['t1'])
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('AC-20：spawn 成功写 startedAt，回执写 endedAt；重放回执与重派都不刷新起点', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1')]
    store.save(makeState(tasks))
    const { deps, spawned } = makeDeps(store)
    const dispatcher = createAutoDispatcher({ store, dispatch: (state) => dispatchReady(state, deps) })
    await dispatcher.tick()
    assert.equal(spawned.length, 1)
    const afterDispatch = store.load('run-1')!
    assert.equal(afterDispatch.taskTimes?.['t1']?.startedAt, now)
    assert.equal(afterDispatch.taskTimes?.['t1']?.endedAt, undefined)

    const done = applyReceipt(afterDispatch, 't1', { verdict: 'done' }, now + 5_000)
    store.save(done)
    const afterReceipt = store.load('run-1')!
    assert.equal(afterReceipt.taskTimes?.['t1']?.endedAt, now + 5_000)

    // 重放同一条回执：终点不得漂移（面板重新读一次逐毫秒相同）。
    const replay = applyReceipt(afterReceipt, 't1', { verdict: 'done' }, now + 9_000)
    assert.equal(replay.taskTimes?.['t1']?.endedAt, now + 5_000)
    assert.equal(replay.taskTimes?.['t1']?.startedAt, now)

    // 返工后重派：同一个起点，不重新计时。
    const rework = makeState([makeTask('t1', { status: 'rework' })], {
      plan: makePlan([makeTask('t1', { status: 'rework' })]),
      taskTimes: { t1: { startedAt: now - 1_000 } },
    })
    store.save(rework)
    await dispatcher.tick()
    assert.equal(store.load('run-1')!.taskTimes?.['t1']?.startedAt, now - 1_000)
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('幂等（AC-10）：同一次自动派发重复触发 → 新增成员 0，端口每轮仍会被调一次', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1')]
    store.save(makeState(tasks))
    const { deps, spawned } = makeDeps(store)
    let dispatched = 0
    const dispatcher = createAutoDispatcher({
      store,
      dispatch: async (state) => {
        dispatched += 1
        return dispatchReady(state, deps)
      },
    })
    await dispatcher.tick()
    const bound = store.load('run-1')!
    assert.equal(bound.bindings.length, 1)
    assert.equal(spawned.length, 1)

    // 任务已 running：shouldAutoDispatch 直接挡住，端口都不调（零动作也不产生第二个成员）。
    await dispatcher.tick()
    assert.equal(dispatched, 1)
    assert.equal(store.load('run-1')!.bindings.length, 1)
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

/* ───────────── 4. r14：受理制的后台侧（manual 触发 / 失败播报 / 报告环） ───────────── */

test('r14 AC-3：manual 受理后由 kick 派发；全失败 onError、成功 onClear，报告带可读 errors', async () => {
  const { store, cleanup } = makeStore()
  try {
    store.save(makeState([makeTask('t1')]))
    const failures: string[] = []
    const cleared: string[] = []
    let mode: 'fail' | 'ok' = 'fail'
    const dispatcher = createAutoDispatcher({
      store,
      dispatch: async () => {
        if (mode === 'fail') return { started: [], skipped: [], errors: [{ taskId: 't1', error: 'spawn 失败' }] }
        return { started: ['t1'], skipped: [], errors: [] }
      },
      now: () => now,
      onError: (runId, text) => failures.push(`${runId}:${text}`),
      onClear: (runId) => cleared.push(runId),
    })

    // 工具受理后正是这个形状：fire-and-forget 的 kick('manual')，调用方不 await。
    dispatcher.kick('session-1', 'run-1', 'manual')
    await flush()

    const reports = dispatcher.reportsOf('session-1')
    assert.equal(reports.length, 1)
    assert.equal(reports[0].cause, 'manual', '受理制必须有自己的 cause，便于解释「这次是谁触发的」')
    assert.equal(reports[0].attempted, true)
    assert.equal(reports[0].failed, 1)
    assert.deepEqual(reports[0].errors, ['t1：spawn 失败'], 'errors 给原文，failed 只给条数')
    assert.equal(failures.length, 1)
    assert.match(failures[0], /派发失败：后台未能创建成员（t1：spawn 失败）/)

    // 有成员真的起来：清掉上一次失败文案（面板不该一直挂着过期红字），且退避计数被清。
    mode = 'ok'
    dispatcher.kick('session-1', 'run-1', 'manual')
    await flush()
    assert.deepEqual(cleared, ['run-1'])
    const after = dispatcher.reportsOf('session-1')
    assert.equal(after.length, 2)
    assert.deepEqual(after[1].started, ['t1'])
    assert.deepEqual(after[1].errors, [])
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})

test('r14：报告环 cap 5 且 reportsOf 返回副本（内存态，不是账本）', async () => {
  const { store, cleanup } = makeStore()
  try {
    store.save(makeState([makeTask('t1')]))
    const dispatcher = createAutoDispatcher({
      store,
      dispatch: async () => ({ started: [], skipped: [{ taskId: 't1', reason: '并发已满' }], errors: [] }),
      now: () => now,
    })
    for (let index = 0; index < 7; index += 1) {
      dispatcher.kick('session-1', 'run-1', 'manual')
      await flush()
    }
    const reports = dispatcher.reportsOf('session-1')
    assert.equal(reports.length, 5, '只留最近 5 条（进程重启即空，不当事实账本）')
    assert.equal(dispatcher.reportsOf('other-session').length, 0, '按会话隔离')

    reports.length = 0
    assert.equal(dispatcher.reportsOf('session-1').length, 5, 'reportsOf 必须回副本')
    dispatcher.dispose()
  } finally {
    cleanup()
  }
})
