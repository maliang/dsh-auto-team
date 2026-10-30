/**
 * 编排核心单测：并发切片 / 角色缺失不派发 / 依赖未过门禁不派发 /
 * 恢复幂等（AC-17）/ 回执唯一完成入口（AC-19）/ rework 次数上限。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MemberBinding, Plan, PlanTask, Role, RoleModelRoute } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import type { RoleRepo } from '../src/host/roles/repo.ts'
import type { HostMember } from '../src/host/team/watcher.ts'
import { createMemberWatcher, normalizeHostStatus, reconcileMembers } from '../src/host/team/watcher.ts'
import type { RoutePort } from '../src/host/team/route.ts'
import {
  applyReceipt,
  dispatchReady,
  memberNameFor,
  resumeRun,
  runningCount,
  type DispatchDeps,
  type ResumeDeps,
  type SpawnInput,
} from '../src/host/team/dispatch.ts'
import { HOST_MEMBER_NAME, HOST_MEMBER_NAME_MAX, MAX_ATTEMPTS } from '../src/host/config.ts'

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

function makeRole(id: string, model?: RoleModelRoute): Role {
  return { id, name: id, duty: '负责交付', skillIds: [], model, builtin: true, updatedAt: now }
}

function makeRoleRepo(roles: Role[]): RoleRepo {
  const map = new Map(roles.map((role) => [role.id, role]))
  return {
    list: () => [...map.values()],
    get: (id: string) => map.get(id),
    save: (role: Role) => ({ ok: true as const, role }),
    remove: () => ({ ok: true as const }),
    seed: () => {},
  }
}

function bindingOf(taskId: string, name: string, memberId = `m-${name}`): MemberBinding {
  return { taskId, roleId: 'dev', memberId, name, spawnedAt: now }
}

function makeStore(): { store: RunsStore; dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-dispatch-'))
  return { store: new RunsStore(dir), dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

interface DepsOptions {
  roles?: Role[]
  members?: HostMember[]
  hostLimit?: number
  routePort?: RoutePort
}

function makeDeps(store: RunsStore, options: DepsOptions = {}): { deps: DispatchDeps; spawned: SpawnInput[] } {
  const spawned: SpawnInput[] = []
  const deps: DispatchDeps = {
    store,
    roles: makeRoleRepo(options.roles ?? [makeRole('dev')]),
    buildPrompt: (input) => `你是 ${input.role?.name ?? '成员'}；任务：${input.task.title}（${input.name}）`,
    listMembers: async () => options.members ?? [],
    spawn: async (input) => {
      spawned.push(input)
      return { ok: true, memberId: `m-${input.name}` }
    },
    hostConcurrency: () => ({ limit: options.hostLimit ?? 8, source: 'host' }),
    routePort: options.routePort,
    now: () => now,
  }
  return { deps, spawned }
}

test('dispatch：并发位切片——maxConcurrent=2 时只派前两个，其余 CONCURRENCY_FULL 且不报错', async () => {
  const { store, cleanup } = makeStore()
  try {
    const state = makeState([makeTask('t1'), makeTask('t2'), makeTask('t3')], {
      plan: makePlan([makeTask('t1'), makeTask('t2'), makeTask('t3')], { maxConcurrent: 2 }),
    })
    const { deps, spawned } = makeDeps(store, { hostLimit: 8 })
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, ['t1', 't2'])
    assert.equal(spawned.length, 2)
    assert.equal(result.errors.length, 0)
    assert.deepEqual(
      result.skipped.map((item) => [item.taskId, item.reason]),
      [['t3', 'CONCURRENCY_FULL']],
    )
    assert.equal(runningCount(result.state.plan.tasks), 2)
    assert.equal(result.state.bindings.length, 2)
    // 成员名确定性：spawn 用的名字必须等于 memberNameFor
    assert.equal(spawned[0]?.name, memberNameFor(result.state.plan.tasks[0]!))
  } finally {
    cleanup()
  }
})

test('dispatch：角色缺失不派发、不猜角色、任务保持 pending', async () => {
  const { store, cleanup } = makeStore()
  try {
    const state = makeState([makeTask('t1', { roleId: 'ghost' })])
    const { deps, spawned } = makeDeps(store)
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, [])
    assert.equal(spawned.length, 0)
    assert.deepEqual(
      result.skipped.map((item) => [item.taskId, item.reason]),
      [['t1', 'ROLE_UNAVAILABLE']],
    )
    assert.equal(result.state.plan.tasks[0]?.status, 'pending')
    assert.equal(result.state.bindings.length, 0)
  } finally {
    cleanup()
  }
})

test('dispatch：依赖未 done 的下游一律不派发（只有 ready 任务进切片）', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1'), makeTask('t2', { dependsOn: ['t1'] })]
    const { deps, spawned } = makeDeps(store)
    const result = await dispatchReady(makeState(tasks), deps)

    assert.deepEqual(result.started, ['t1'])
    assert.equal(spawned.length, 1)
    assert.equal(result.state.plan.tasks[1]?.status, 'pending')
    assert.equal(
      result.skipped.some((item) => item.taskId === 't2'),
      false,
    )
  } finally {
    cleanup()
  }
})

test('dispatch：被标 interrupted 的任务可用同一个确定性名字重建成员（AC-17 恢复后能恢复运行）', async () => {
  const { store, cleanup } = makeStore()
  try {
    // 宿主重启后的样子：任务被对账标成 interrupted、旧成员已不在名单里，
    // 但 binding 还在（未 retired）。resume 不会新建（防翻倍），恢复运行只能靠一次显式 dispatch。
    const tasks = [
      makeTask('t1', { status: 'done' }),
      makeTask('t2', { status: 'interrupted', memberId: 'm-dev-t2', dependsOn: ['t1'] }),
    ]
    const state = makeState(tasks, { bindings: [bindingOf('t2', 'dev-t2')] })
    const { deps, spawned } = makeDeps(store)
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, ['t2'], 'interrupted 且依赖已 done 的任务必须可重新派发')
    assert.equal(spawned.length, 1)
    assert.equal(spawned[0]?.name, 'dev-t2', '重建必须沿用确定性名字，否则绑定与审计认不回同一个任务')
    const rebuilt = result.state.plan.tasks.find((task) => task.id === 't2')
    assert.equal(rebuilt?.status, 'running')
    assert.equal(
      result.state.bindings.filter((item) => item.taskId === 't2' && !item.retired).length,
      1,
      '旧 binding 必须退役，任何时刻同一任务只有一个在飞成员',
    )
  } finally {
    cleanup()
  }
})

test('dispatch：并发位已满时全部 skipped=CONCURRENCY_FULL，不新建成员也不报错', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1', { status: 'running', memberId: 'm-dev-t1' }), makeTask('t2')]
    const state = makeState(tasks, {
      plan: makePlan(tasks, { maxConcurrent: 1 }),
      bindings: [bindingOf('t1', 'dev-t1')],
    })
    const { deps, spawned } = makeDeps(store)
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, [])
    assert.equal(spawned.length, 0)
    assert.equal(result.errors.length, 0)
    assert.deepEqual(
      result.skipped.map((item) => item.reason),
      ['CONCURRENCY_FULL'],
    )
  } finally {
    cleanup()
  }
})

test('dispatch：角色声明了模型且预校验失败 → MODEL_UNRESOLVABLE，不派发', async () => {
  const { store, cleanup } = makeStore()
  try {
    const role = makeRole('dev', { provider: 'fake', model: 'not-exist' })
    const routePort: RoutePort = { resolveRoute: async () => null }
    const state = makeState([makeTask('t1')])
    const { deps, spawned } = makeDeps(store, { roles: [role], routePort })
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, [])
    assert.equal(spawned.length, 0)
    assert.equal(result.skipped[0]?.reason, 'MODEL_UNRESOLVABLE')
    assert.equal(result.state.plan.tasks[0]?.status, 'pending')
  } finally {
    cleanup()
  }
})

test('resume：同一成员连续恢复两次，第二次必须 resumed=0 且 unchanged=true（AC-17 幂等）', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1', { status: 'running', memberId: 'm-dev-t1' })]
    const state = makeState(tasks, { bindings: [bindingOf('t1', 'dev-t1')] })
    const members: HostMember[] = [{ id: 'm-dev-t1', name: 'dev-t1', status: 'running' }]
    const sent: string[] = []
    const deps: ResumeDeps = {
      store,
      listMembers: async () => members,
      sendMessage: async (_memberId, text) => {
        sent.push(text)
        return { ok: true }
      },
      now: () => now,
    }

    const first = await resumeRun(state, deps)
    const second = await resumeRun(first.state, deps)

    assert.equal(first.resumed, 1)
    assert.equal(first.unchanged, false)
    assert.equal(second.resumed, 0)
    assert.equal(second.unchanged, true)
    // 幂等的机械判据：两次 bindings 长度相同（没有重复建成员/重复绑定）
    assert.equal(first.state.bindings.length, state.bindings.length)
    assert.equal(second.state.bindings.length, state.bindings.length)
    assert.equal(sent.length, 1)
  } finally {
    cleanup()
  }
})

test('resume：成员已不在名单里 → 标 interrupted，且不自动新建成员', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1', { status: 'running', memberId: 'm-dev-t1' })]
    const state = makeState(tasks, { bindings: [bindingOf('t1', 'dev-t1')] })
    const deps: ResumeDeps = { store, listMembers: async () => [], now: () => now }
    const result = await resumeRun(state, deps)

    assert.equal(result.resumed, 0)
    assert.equal(result.state.plan.tasks[0]?.status, 'interrupted')
    assert.equal(result.state.bindings.filter((item) => !item.retired).length, 0)
  } finally {
    cleanup()
  }
})

test('applyReceipt：rework 下游保持 blocked，第 3 次尝试转 failed', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [
      makeTask('t1', { status: 'running', memberId: 'm-dev-t1' }),
      makeTask('t2', { status: 'blocked', dependsOn: ['t1'] }),
    ]
    let state = makeState(tasks, { bindings: [bindingOf('t1', 'dev-t1')] })

    state = applyReceipt(state, 't1', { verdict: 'rework', note: '验收命令失败' }, now + 1)
    assert.equal(state.plan.tasks[0]?.status, 'rework')
    assert.equal(state.plan.tasks[0]?.attempts, 1)
    assert.equal(state.plan.tasks[1]?.status, 'blocked', '返工期间下游必须保持 blocked')

    state = applyReceipt(state, 't1', { verdict: 'rework' }, now + 2)
    assert.equal(state.plan.tasks[0]?.attempts, 2)
    assert.equal(state.plan.tasks[1]?.status, 'blocked')

    state = applyReceipt(state, 't1', { verdict: 'rework' }, now + 3)
    assert.equal(state.plan.tasks[0]?.attempts, MAX_ATTEMPTS)
    assert.equal(state.plan.tasks[0]?.status, 'failed', '达到上限必须转 failed 而不是无限返工')
    assert.ok(state.messages.length >= 3)
  } finally {
    cleanup()
  }
})

test('端到端：派发→回执 done→解锁下游→再派发→全部完成，plan 收敛到 terminated', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [
      makeTask('t1'),
      makeTask('t2', { status: 'blocked', dependsOn: ['t1'] }),
      makeTask('t3', { status: 'blocked', dependsOn: ['t2'] }),
    ]
    let state = makeState(tasks)

    // ① 第一轮派发：只有 t1 就绪
    const first = await dispatchReady(state, makeDeps(store).deps)
    state = first.state
    assert.deepEqual(first.started, ['t1'])

    // ② 回执 done：t2 从 blocked 解锁为 pending
    state = applyReceipt(state, 't1', { verdict: 'done' }, now + 10)
    assert.equal(state.plan.tasks[0]?.status, 'done')
    assert.equal(state.plan.tasks[1]?.status, 'pending')

    // ③ 第二轮派发：t2 上成员
    const second = await dispatchReady(state, makeDeps(store).deps)
    state = second.state
    assert.deepEqual(second.started, ['t2'])

    state = applyReceipt(state, 't2', { verdict: 'done' }, now + 20)
    assert.equal(state.plan.tasks[2]?.status, 'pending')

    // ④ 第三轮：t3 收尾
    const third = await dispatchReady(state, makeDeps(store).deps)
    state = third.state
    assert.deepEqual(third.started, ['t3'])

    state = applyReceipt(state, 't3', { verdict: 'done' }, now + 30)
    store.save(state)

    const reloaded = store.load('run-1')
    assert.ok(reloaded, '终态必须落盘可读回')
    assert.deepEqual(
      reloaded.plan.tasks.map((item) => item.status),
      ['done', 'done', 'done'],
    )
    assert.equal(reloaded.plan.status, 'terminated', '全部任务完成后 plan 必须收敛到 terminated')
    assert.equal(runningCount(reloaded.plan.tasks), 0)
    assert.ok(reloaded.messages.length >= 3, '每个任务至少一条回执消息进账本')
  } finally {
    cleanup()
  }
})

test('memberNameFor：确定性且归一为宿主 memberName() 的硬契约（HOST_MEMBER_NAME）', () => {
  const task = makeTask('t 1', { roleId: 'Architect X' })
  const name = memberNameFor(task)
  assert.equal(name, 'architect-x-t-1', '大写与空格都必须折成 lower-kebab')
  assert.equal(memberNameFor(task), name, '同一任务反复派发必须得到同一个名字')
  assert.match(name, HOST_MEMBER_NAME)

  const long = memberNameFor(makeTask('x'.repeat(80), { roleId: 'r'.repeat(40) }))
  assert.equal(long.length, HOST_MEMBER_NAME_MAX)
  assert.match(long, HOST_MEMBER_NAME, '截断不得留下结尾分隔符')

  assert.equal(memberNameFor(makeTask('###', { roleId: '###' })), 'member', '归一后为空要有兜底名')
})

/**
 * 类门禁（QA A-1 / N2）：宿主成员名字符集是**硬契约**，而任务 id 是模型自填的。
 * 逐个喂敌意 id，断言生成的名字一定满足 `config.ts` 的 `HOST_MEMBER_NAME`：
 * 把实现改回旧规则（保留大写 / 保留下划线）时本用例必红。
 */
test('memberNameFor：任何模型自填 id 都归一为宿主合法名（HOST_MEMBER_NAME 类门禁）', () => {
  const hostile = [
    'Login_Flow',
    't 1',
    'Architect X',
    't.1',
    't:1',
    'T1',
    '重构-登录',
    '登录',
    'a!!b',
    '_leading',
    'trailing_',
    'x'.repeat(120),
    '9lives',
    'a--b',
    'A_B-C.D',
  ]
  for (const id of hostile) {
    for (const roleId of ['dev', 'Dev Lead', '前端', 'Q_A']) {
      const name = memberNameFor(makeTask(id, { roleId }))
      assert.match(name, HOST_MEMBER_NAME, `id=${id} roleId=${roleId} → ${name}`)
      assert.ok(name.length <= HOST_MEMBER_NAME_MAX, `id=${id} 名字超长：${name}`)
      assert.equal(name, memberNameFor(makeTask(id, { roleId })), '归一必须确定（AC-17 幂等）')
    }
  }
  // 差分对照：小写 id 的既有名字不因归一化而漂移（防止规则被改成恒过/恒变）。
  assert.equal(memberNameFor(makeTask('t1', { roleId: 'dev' })), 'dev-t1')
})

/* ------------------------------------------------------------------ *
 * 成员存活对账（AC-18 的反面目标：面板不能显示「运行中」而成员已经死了）
 * ------------------------------------------------------------------ */

test('reconcileMembers：成员不在名单里 → 任务 interrupted 并留下中断消息', () => {
  const tasks = [makeTask('t1', { status: 'running', memberId: 'm-dev-t1' })]
  const state = makeState(tasks, { bindings: [bindingOf('t1', 'dev-t1')] })
  const result = reconcileMembers(state, [], now)

  assert.equal(result.changed, 1)
  assert.equal(result.state.plan.tasks[0]?.status, 'interrupted')
  assert.ok(result.state.messages.some((item) => /已失联/.test(item.body)))
})

test('reconcileMembers：宿主 inactive / failed → interrupted；重试次数用尽才转 failed', () => {
  const tasks = [makeTask('t1', { status: 'running', memberId: 'm-dev-t1' })]
  const state = makeState(tasks, { bindings: [bindingOf('t1', 'dev-t1')] })
  const dead: HostMember[] = [{ id: 'm-dev-t1', name: 'dev-t1', status: 'inactive' }]

  const once = reconcileMembers(state, dead, now)
  assert.equal(once.state.plan.tasks[0]?.status, 'interrupted')

  const exhausted = reconcileMembers(
    makeState([makeTask('t1', { status: 'running', memberId: 'm-dev-t1', attempts: MAX_ATTEMPTS })], {
      bindings: [bindingOf('t1', 'dev-t1')],
    }),
    dead,
    now,
  )
  assert.equal(exhausted.state.plan.tasks[0]?.status, 'failed')
  assert.ok(exhausted.state.messages.some((item) => /转人工/.test(item.body)))
})

test('reconcileMembers：成员活着且任务曾被标中断 → 恢复 running', () => {
  const tasks = [makeTask('t1', { status: 'interrupted', memberId: 'm-dev-t1' })]
  const state = makeState(tasks, { bindings: [bindingOf('t1', 'dev-t1')] })
  const result = reconcileMembers(state, [{ id: 'm-dev-t1', name: 'dev-t1', status: 'running' }], now)

  assert.equal(result.changed, 1)
  assert.equal(result.state.plan.tasks[0]?.status, 'running')
})

test('reconcileMembers：状态未知（宿主给了没见过的值）→ 一律不动，不误杀', () => {
  assert.equal(normalizeHostStatus('weird'), 'unknown')
  const tasks = [makeTask('t1', { status: 'running', memberId: 'm-dev-t1' })]
  const state = makeState(tasks, { bindings: [bindingOf('t1', 'dev-t1')] })
  const result = reconcileMembers(state, [{ id: 'm-dev-t1', name: 'dev-t1', status: 'weird' }], now)

  assert.equal(result.changed, 0)
  assert.equal(result.state.plan.tasks[0]?.status, 'running')
})

test('createMemberWatcher：只有在存在非终态任务时才查名单；名单不可得不写盘（不误杀）', async () => {
  const { store, dir, cleanup } = makeStore()
  try {
    // 只有终态任务的 run：一次 listMembers 都不该发生
    store.save(
      makeState([makeTask('t1', { status: 'done' })], {
        plan: makePlan([makeTask('t1', { status: 'done' })], { runId: 'run-done', status: 'terminated' }),
      }),
    )
    let calls = 0
    const watcher = createMemberWatcher({
      store,
      listMembers: async () => {
        calls += 1
        return []
      },
      now: () => now,
    })
    assert.equal(await watcher.tick(), 0)
    assert.equal(calls, 0, '终态 run 不该消耗宿主接口')

    // 有在飞任务但名单抛错：本轮返回 0，且落盘状态保持原样
    const live = makeState([makeTask('t1', { status: 'running', memberId: 'm-dev-t1' })], {
      plan: makePlan([makeTask('t1', { status: 'running', memberId: 'm-dev-t1' })], { runId: 'run-live' }),
      bindings: [bindingOf('t1', 'dev-t1')],
    })
    store.save(live)
    const failing = createMemberWatcher({
      store,
      listMembers: async () => {
        throw new Error('NO_CALLER')
      },
      now: () => now,
    })
    assert.equal(await failing.tick(), 0)
    assert.equal(store.load('run-live')?.plan.tasks[0]?.status, 'running', '拿不到名单绝不能把成员全判死')

    // 名单可得且成员已死：对账结果必须落盘
    const reconciled: RunState[] = []
    const ok = createMemberWatcher({
      store,
      listMembers: async () => [],
      now: () => now,
      onReconciled: (state) => void reconciled.push(state),
    })
    assert.equal(await ok.tick(), 1)
    assert.equal(reconciled.length, 1)
    // 直接读盘验证「对账结果真的写进了文件」（TASK_STATUSES 漏 interrupted 的缺陷已在 T9 修掉，
    // store.load() 现在也能读回 interrupted；这里保留原文读取，是为了断言落盘事实本身）。
    const persisted = JSON.parse(readFileSync(join(dir, 'run-live.json'), 'utf8')) as {
      plan: { tasks: Array<{ status: string }> }
      messages: Array<{ body: string }>
    }
    assert.equal(persisted.plan.tasks[0]?.status, 'interrupted', '成员死亡必须落盘为 interrupted')
    assert.ok(persisted.messages.some((item) => /已失联/.test(item.body)), '中断原因必须留在账本里')
  } finally {
    cleanup()
  }
})

/* ------------------------------------------------------------------ *
 * 逐角色模型漂移审计（AC-22）——真机时序下必须落在 binding 落盘之后
 *
 * 宿主在 `spawnTeammate()` **内部**先 await `agent/created` 才返回，事件到达时
 * `state.bindings` 还没有这条任务，所以「事件里查 binding 再审计」在真机上永远查不到
 * （旧实现如此：`routeAudits` 恒空，面板把已生效的模型显示成「未下发」）。
 * 修复后的契约：实际路由随 spawn 返回值带回，binding 落盘后同一笔写进 RunState。
 * ------------------------------------------------------------------ */

function makeAuditDeps(
  store: RunsStore,
  model: RoleModelRoute | undefined,
  spawnResult: RoleModelRoute | null | undefined,
): DispatchDeps {
  return {
    store,
    roles: makeRoleRepo([makeRole('dev', model)]),
    buildPrompt: () => '你是 dev；任务 t1',
    listMembers: async () => [],
    spawn: async (input) => ({
      ok: true as const,
      memberId: `m-${input.name}`,
      ...(spawnResult === undefined ? {} : { actual: spawnResult }),
    }),
    hostConcurrency: () => ({ limit: 8, source: 'host' as const }),
    now: () => now,
  }
}

test('dispatch：实际路由随 spawn 带回 → 同一笔写里落 ok 审计（N1 真机时序）', async () => {
  const { store, cleanup } = makeStore()
  try {
    const declared: RoleModelRoute = { provider: 'deepseek', model: 'deepseek-reasoner' }
    const result = await dispatchReady(makeState([makeTask('t1')]), makeAuditDeps(store, declared, declared))

    const audit = result.state.routeAudits.find((item) => item.taskId === 't1')
    assert.equal(audit?.verdict, 'ok', '观测到的实际路由与声明一致必须判 ok')
    assert.deepEqual(audit?.actual, declared)
    assert.equal(audit?.roleId, 'dev')
    assert.equal(result.state.plan.tasks[0]?.status, 'running', 'ok 审计不得改变任务状态')

    // 落盘事实（不是只在内存里）：面板读的是 store.load() 的结果
    const reloaded = store.load('run-1')
    assert.equal(reloaded?.routeAudits.find((item) => item.taskId === 't1')?.verdict, 'ok')
  } finally {
    cleanup()
  }
})

test('dispatch：宿主未回报实际路由 → 审计落 unverified，绝不拿声明值假装生效', async () => {
  const { store, cleanup } = makeStore()
  try {
    const declared: RoleModelRoute = { provider: 'deepseek', model: 'deepseek-reasoner' }
    for (const missing of [undefined, null] as const) {
      const result = await dispatchReady(makeState([makeTask('t1')]), makeAuditDeps(store, declared, missing))
      const audit = result.state.routeAudits.find((item) => item.taskId === 't1')
      assert.equal(audit?.verdict, 'unverified', `spawnResult=${String(missing)} 必须判未核实`)
      assert.equal(audit?.actual, null, '拿不到实际值就是 null，不许填声明值')
    }
  } finally {
    cleanup()
  }
})

test('dispatch：实际路由漂移 → 审计落 drift 且任务转 failed', async () => {
  const { store, cleanup } = makeStore()
  try {
    const declared: RoleModelRoute = { provider: 'deepseek', model: 'deepseek-reasoner' }
    const actual: RoleModelRoute = { provider: 'openai', model: 'gpt-x' }
    const result = await dispatchReady(makeState([makeTask('t1')]), makeAuditDeps(store, declared, actual))

    const audit = result.state.routeAudits.find((item) => item.taskId === 't1')
    assert.equal(audit?.verdict, 'drift')
    assert.equal(result.state.plan.tasks[0]?.status, 'failed', '漂移不得继续当作在跑')
  } finally {
    cleanup()
  }
})

test('dispatch：角色未声明模型 → 不落审计（面板应显示「会话默认模型」而非「未下发」）', async () => {
  const { store, cleanup } = makeStore()
  try {
    const result = await dispatchReady(makeState([makeTask('t1')]), makeAuditDeps(store, undefined, null))
    assert.deepEqual(result.state.routeAudits, [])
    assert.equal(result.state.plan.tasks[0]?.status, 'running')
  } finally {
    cleanup()
  }
})

