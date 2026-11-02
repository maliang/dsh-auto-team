/**
 * 编排核心单测：并发切片 / 角色缺失不派发 / 依赖未过门禁不派发 /
 * 恢复幂等（AC-17）/ 回执唯一完成入口（AC-19）/ rework 次数上限。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GateEvidence, MemberBinding, Plan, PlanTask, Role, RoleModelRoute } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import type { RoleRepo } from '../src/host/roles/repo.ts'
import type { HostMember } from '../src/host/team/watcher.ts'
import { createMemberWatcher, normalizeHostStatus, reconcileMembers } from '../src/host/team/watcher.ts'
import type { RoutePort } from '../src/host/team/route.ts'
import {
  NAME_SUFFIX_MAX,
  allocateMemberNames,
  applyReceipt,
  dispatchReady,
  memberNameFor,
  resumeRun,
  runningCount,
  shortIdentityHash,
  withNameSuffix,
  type DispatchDeps,
  type PromptInput,
  type ResumeDeps,
  type SpawnInput,
} from '../src/host/team/dispatch.ts'
import { HOST_MEMBER_NAME, HOST_MEMBER_NAME_MAX, MAX_ATTEMPTS } from '../src/host/config.ts'
import { applyScopeWaits, releaseScopes } from '../src/host/team/scope-locks.ts'

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
    // r7 T1：RoleRepo 新增 restoreDefaults，桩必须跟着契约走（缺了 typecheck 直接红）。
    restoreDefaults: () => ({ restored: [], kept: [] }),
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
    const state = makeState(tasks, { bindings: [bindingOf('t2', memberNameFor(makeTask('t2')))] })
    const { deps, spawned } = makeDeps(store)
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, ['t2'], 'interrupted 且依赖已 done 的任务必须可重新派发')
    assert.equal(spawned.length, 1)
    assert.equal(
      spawned[0]?.name,
      memberNameFor(makeTask('t2')),
      '重建必须沿用确定性名字（同一 roleId+taskId 恒得同名），否则绑定与审计认不回同一个任务',
    )
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
  assert.match(name, /^architect-x-t-1-[0-9a-z]{6}$/, '大写与空格都必须折成 lower-kebab（可读段），再拼 6 位身份哈希')
  assert.equal(name.slice(0, -7), 'architect-x-t-1', '去掉 -<哈希 6 位> 后必须是与旧实现一致的可读段')
  assert.equal(memberNameFor(task), name, '同一任务反复派发必须得到同一个名字')
  assert.match(name, HOST_MEMBER_NAME)

  const long = memberNameFor(makeTask('x'.repeat(80), { roleId: 'r'.repeat(40) }))
  assert.equal(long.length, HOST_MEMBER_NAME_MAX, '两段各顶到 20 + 分隔符 + 哈希应恰好是上限 48')
  assert.match(long, HOST_MEMBER_NAME, '截断不得留下结尾分隔符')
  assert.equal(
    long.slice(-6),
    shortIdentityHash(`${'r'.repeat(40)}\u0000${'x'.repeat(80)}`),
    '末 6 位必须是原始 roleId\\0taskId 的哈希——截断不允许裁到它',
  )
  // 与上一个长 id 只差最后两个字符：可读段截断后完全相同，名字必须仍然不同（反面目标 ③ 的正面覆盖）。
  const other = memberNameFor(makeTask(`${'x'.repeat(78)}yy`, { roleId: 'r'.repeat(40) }))
  assert.notEqual(other, long, '截断不得吃掉唯一性')
  assert.equal(other.slice(0, -7), long.slice(0, -7), '两个长 id 的可读段相同，差异只能来自身份哈希')

  assert.match(memberNameFor(makeTask('###', { roleId: '###' })), /^member-[0-9a-z]{6}$/, '归一后为空要有兜底名（仍带身份哈希）')
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
  // 差分对照：小写 id 的可读段不因归一化而漂移（防止规则被改成恒过/恒变）。
  // 形态变成 `<roleId>-<taskId>-<h6>`，所以断言「可读段 + 字符集 + 同输入恒等」，不放宽成「只要合法就算过」。
  const plain = memberNameFor(makeTask('t1', { roleId: 'dev' }))
  assert.ok(plain.startsWith('dev-t1-'), `可读段必须保持 dev-t1：${plain}`)
  assert.match(plain, /^dev-t1-[0-9a-z]{6}$/)
  assert.equal(memberNameFor(makeTask('t1', { roleId: 'dev' })), plain, '同输入必须恒等（AC-17 幂等）')
})

/* ------------------------------------------------------------------ *
 * 成员名唯一性（R2-1 缺陷的正向覆盖）
 *
 * 旧实现只做归一化：`dev/登录流程` 与 `dev/注册接口` 都塌成 `dev`，同角色第二个就绪任务的
 * spawn 被宿主以重名拒绝，错误被吞成「永久 pending」。以下用例逐个复现该塌缩面。
 * ------------------------------------------------------------------ */

test('memberNameFor：同角色的两个中文 id 必须得到不同名字（缺陷本体）', () => {
  const left = memberNameFor(makeTask('登录流程'))
  const right = memberNameFor(makeTask('注册接口'))

  assert.notEqual(left, right, '两个中文 taskId 归一后可读段同为空，只剩身份哈希能区分')
  assert.notEqual(left, 'dev', '名字绝不能塌缩回角色名')
  assert.notEqual(right, 'dev')
  for (const name of [left, right]) {
    assert.match(name, HOST_MEMBER_NAME)
    assert.ok(name.length <= HOST_MEMBER_NAME_MAX, `名字超长：${name}`)
    assert.match(name, /^dev-[0-9a-z]{6}$/, `纯中文 id 的可读段为空，名字应形如 dev-<h6>：${name}`)
  }
})

test('memberNameFor：仅大小写/分隔符不同的 id 必须得到不同名字（可读段相同、哈希不同）', () => {
  const pairs: Array<[string, string]> = [
    ['Login_Flow', 'login-flow'],
    ['t1', 'T1'],
  ]
  for (const [a, b] of pairs) {
    const left = memberNameFor(makeTask(a))
    const right = memberNameFor(makeTask(b))
    assert.notEqual(left, right, `${a} 与 ${b} 不得同名`)
    // 去掉 `-<哈希 6 位>` 后可读段相同 —— 差异全部来自「原始串」哈希，证明确实先编码身份再归一。
    assert.equal(left.slice(0, -7), right.slice(0, -7), `${a}/${b} 的可读段应当相同（只差哈希）`)
    assert.match(left, HOST_MEMBER_NAME)
    assert.match(right, HOST_MEMBER_NAME)
  }
})

test('memberNameFor：同角色 5 个任务（中文/拉丁/长 id 混合）两两唯一', () => {
  const ids = ['login', '登录流程', 'x'.repeat(40), 'T1', 'Login_Flow']
  const names = ids.map((id) => memberNameFor(makeTask(id)))

  assert.equal(new Set(names).size, ids.length, `名字必须两两唯一：${names.join(', ')}`)
  for (const name of names) {
    assert.match(name, HOST_MEMBER_NAME, `非法名字：${name}`)
    assert.ok(name.length <= HOST_MEMBER_NAME_MAX, `名字超长：${name}`)
  }
})

test('memberNameFor：48 上限边界 + 字符集 + 确定性（截断只裁可读段，永不裁哈希）', () => {
  const roleId = 'r'.repeat(40)
  const id = 'x'.repeat(40)
  const name = memberNameFor(makeTask(id, { roleId }))

  assert.equal(name.length, HOST_MEMBER_NAME_MAX, '可读段 20+1+20 加分隔符与 6 位哈希应恰好顶到上限')
  assert.match(name, HOST_MEMBER_NAME)
  assert.equal(name.slice(-6), shortIdentityHash(`${roleId}\u0000${id}`), '末 6 位必须是原始 roleId\\0taskId 的哈希')
  assert.equal(memberNameFor(makeTask(id, { roleId })), name, '同输入必须恒等（AC-3 确定性）')
})

/* ------------------------------------------------------------------ *
 * 消歧（AC-4）：名字被占 → 确定性追加序号继续派发，不停派
 *
 * R3 取代了 R2 的「撞名=错误，停派并留 pending」契约：撞名只是名字冲突，不是任务错误。
 * 生产算法本不该撞名，这些用例靠注入 `deps.memberNameFor` 造出撞名面。
 * 判据：都 spawn、名字为 `base`/`base-2`、errors 空、任务 running、renamed 恰好一条。
 * ------------------------------------------------------------------ */

test('dispatch：注入的取名端口恒同名 → 两条任务以 dev-dup / dev-dup-2 都派出，只有第二条消歧', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1'), makeTask('t2')]
    const { deps, spawned } = makeDeps(store)
    // 刻意把所有任务映射成同一个名字：旧实现在这里停派，新契约必须照派只换名字。
    deps.memberNameFor = () => 'dev-dup'
    const result = await dispatchReady(makeState(tasks), deps)

    assert.deepEqual(result.started, ['t1', 't2'], '撞名不再停派：两条任务都必须启动')
    assert.deepEqual(
      spawned.map((input) => input.name),
      ['dev-dup', 'dev-dup-2'],
      '第一条用本名，第二条确定性追加序号',
    )
    assert.deepEqual(result.errors, [], '消歧是正常路径，不产生错误')
    assert.deepEqual(
      result.state.plan.tasks.map((task) => task.status),
      ['running', 'running'],
      '两条任务都必须真的在跑（不许留 pending）',
    )
    assert.equal(result.state.bindings.length, 2, '两条任务各写一条 binding')
    assert.deepEqual(
      result.renamed.map((item) => item.taskId),
      ['t2'],
      '只有被改名的任务产生消歧记录（AC-5）',
    )
    assert.deepEqual(result.renamed[0], { taskId: 't2', base: 'dev-dup', final: 'dev-dup-2' })
  } finally {
    cleanup()
  }
})

test('dispatch：与既有未退役 binding 同名 → 新任务以 -2 派发，既有成员与任务不受影响', async () => {
  const { store, cleanup } = makeStore()
  try {
    // t0 已完成、binding 仍在（名字被占用）；t2 算出的名字与之相同。
    const tasks = [makeTask('t0', { status: 'done' }), makeTask('t2')]
    const state = makeState(tasks, { bindings: [bindingOf('t0', 'dev-dup')] })
    const { deps, spawned } = makeDeps(store)
    deps.memberNameFor = () => 'dev-dup'
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, ['t2'], '被占名的是 t2，它必须改名后照派')
    assert.deepEqual(
      spawned.map((input) => input.name),
      ['dev-dup-2'],
      '未退役 binding 占着 dev-dup，新任务顺延到 -2',
    )
    assert.deepEqual(result.errors, [], '名字被占不是错误')
    assert.equal(result.state.plan.tasks.find((task) => task.id === 't2')?.status, 'running')
    const kept = result.state.bindings.find((item) => item.taskId === 't0')
    assert.equal(kept?.name, 'dev-dup', '既有 binding 必须原样保留')
    assert.equal(kept?.retired, undefined, '既有 binding 不得被退役（成员仍活着）')
    assert.deepEqual(result.renamed, [{ taskId: 't2', base: 'dev-dup', final: 'dev-dup-2' }])
  } finally {
    cleanup()
  }
})

test('withNameSuffix：短名直接拼接；超长只压可读段、6 位身份哈希逐字保留（AC-2）', () => {
  assert.equal(withNameSuffix('dev-dup', 2), 'dev-dup-2', '不超上限时就是原样拼接')
  assert.equal(withNameSuffix('dev-dup', 0), 'dev-dup', '非正序号不改名（防呆）')
  assert.equal(withNameSuffix('dev-dup', -3), 'dev-dup')

  // 真实算法产出的 48 字顶格名：追加 -2 时必须把可读段压掉 2 个字符，哈希一个字节都不能动。
  const roleId = 'r'.repeat(30)
  const id = 'x'.repeat(30)
  const base = memberNameFor(makeTask(id, { roleId }))
  const hash = shortIdentityHash(`${roleId}\u0000${id}`)
  assert.equal(base.length, HOST_MEMBER_NAME_MAX, '前提：本名恰好顶到 48')

  const two = withNameSuffix(base, 2)
  assert.ok(two.length <= HOST_MEMBER_NAME_MAX, `消歧后仍不得超 48：${two.length}`)
  assert.match(two, HOST_MEMBER_NAME, `消歧后必须仍合法：${two}`)
  assert.ok(two.includes(hash), `6 位身份哈希必须逐字保留：${two}`)
  assert.ok(two.endsWith('-2'))

  const ninetyNine = withNameSuffix(base, NAME_SUFFIX_MAX)
  assert.ok(ninetyNine.length <= HOST_MEMBER_NAME_MAX, `-99 也不得超 48：${ninetyNine.length}`)
  assert.match(ninetyNine, HOST_MEMBER_NAME)
  assert.ok(ninetyNine.includes(hash), '更长的序号只压可读段，哈希不动')
  assert.ok(ninetyNine.endsWith('-99'))

  // 可读段被压空时用 member 兜底，绝不能出现以分隔符开头的名字。
  const degenerate = withNameSuffix(`${'-'.repeat(45)}-abcdef`, 2)
  assert.equal(degenerate, 'member-abcdef-2')
  assert.match(degenerate, HOST_MEMBER_NAME)
})

test('allocateMemberNames：同一输入重复调用结果完全相同（确定性，AC-3）', () => {
  const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')]
  const options = { nameOf: () => 'dev-dup' }
  const first = allocateMemberNames(tasks, options)
  const second = allocateMemberNames(tasks, options)

  assert.deepEqual([...first.entries()], [...second.entries()], '无时间无随机：两次调用必须逐字段相同')
  assert.deepEqual(
    tasks.map((task) => first.get(task.id)?.final),
    ['dev-dup', 'dev-dup-2', 'dev-dup-3'],
    '三个同名任务按计划顺序拿 base / -2 / -3',
  )
  // 交换任务顺序后「名字集合」不变（归属可以变）：名字可用性不许取决于任务顺序。
  const reversed = allocateMemberNames([...tasks].reverse(), options)
  assert.deepEqual(
    [...reversed.values()].map((item) => item.final).sort(),
    [...first.values()].map((item) => item.final).sort(),
  )
})

test('allocateMemberNames：不抢他人本名（AC-4 的唯一正确实现）', () => {
  const tasks = [makeTask('t1'), makeTask('t2')]
  // t2 的本名就是 t1 的第一个候选号；t1 必须跳过 dev-2 去 dev-3。
  const names = allocateMemberNames(tasks, {
    nameOf: (task) => (task.id === 't2' ? 'dev-2' : 'dev'),
    reserved: [{ taskId: 't0', name: 'dev' }],
  })

  assert.deepEqual(names.get('t1'), { taskId: 't1', base: 'dev', final: 'dev-3', suffix: 3, reused: false })
  assert.deepEqual(names.get('t2'), { taskId: 't2', base: 'dev-2', final: 'dev-2', suffix: 0, reused: false })
})

test('allocateMemberNames：同任务未退役 binding 判 reused，名字不递增（恢复不翻倍）', () => {
  const tasks = [makeTask('t1'), makeTask('t2')]
  const names = allocateMemberNames(tasks, {
    nameOf: () => 'dev-dup',
    reserved: [
      { taskId: 't1', name: 'dev-dup' },
      { taskId: 't2', name: 'dev-dup-2' },
    ],
  })

  assert.deepEqual(names.get('t1'), { taskId: 't1', base: 'dev-dup', final: 'dev-dup', suffix: 0, reused: true })
  assert.deepEqual(names.get('t2'), { taskId: 't2', base: 'dev-dup', final: 'dev-dup-2', suffix: 0, reused: true })
})

test('allocateMemberNames：序号 -2…maxSuffix 全被占 → suffix=null（可观测，不静默）', () => {
  const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')]
  const names = allocateMemberNames(tasks, { nameOf: () => 'dev-dup', maxSuffix: 2 })

  assert.equal(names.get('t1')?.final, 'dev-dup')
  assert.equal(names.get('t2')?.final, 'dev-dup-2')
  assert.equal(names.get('t3')?.suffix, null, 'maxSuffix=2 时第三个同名任务无处可去')
  assert.equal(names.get('t3')?.final, 'dev-dup', '耗尽时 final 回落本名，由调用方判错误')
})

test('dispatch：两个中文 id 的任务都真派出，名字两两唯一且不超 48（AC-10 派发侧）', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('登录流程'), makeTask('注册接口')]
    const { deps, spawned } = makeDeps(store)
    const result = await dispatchReady(makeState(tasks), deps)

    assert.deepEqual(result.started, ['登录流程', '注册接口'], '归一后同为空的两条任务都必须派出')
    assert.equal(spawned.length, 2)
    const names = spawned.map((input) => input.name)
    assert.equal(new Set(names).size, 2, `名字必须两两唯一：${names.join(', ')}`)
    for (const name of names) {
      assert.match(name, HOST_MEMBER_NAME)
      assert.ok(name.length <= HOST_MEMBER_NAME_MAX)
    }
    assert.deepEqual(result.renamed, [], '真实算法不撞名，不该产生消歧记录')
  } finally {
    cleanup()
  }
})

test('dispatch：重试不重复 notice —— 第二次派发全部 ALREADY_RUNNING，名字与 binding 不变', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1'), makeTask('t2')]
    const members: HostMember[] = []
    const { deps, spawned } = makeDeps(store, { members })
    deps.memberNameFor = () => 'dev-dup'

    const first = await dispatchReady(makeState(tasks), deps)
    assert.equal(first.renamed.length, 1, '第一轮确实改名了')
    // 成员活着回到名单里：第二轮只能是 ALREADY_RUNNING，不许再造人、不许再提示改名。
    for (const input of spawned) members.push({ id: `m-${input.name}`, name: input.name, status: 'active' })
    const second = await dispatchReady(first.state, deps)

    assert.deepEqual(second.started, [], '已在飞的任务不重复 spawn')
    assert.equal(second.renamed.length, 0, '同一消歧只提示一次（AC-5 抑制条件）')
    assert.equal(second.state.bindings.length, first.state.bindings.length, 'binding 数量不变')
    assert.deepEqual(
      second.state.bindings.map((item) => item.name),
      ['dev-dup', 'dev-dup-2'],
      '名字不递增（恢复后重绑不得翻倍）',
    )
  } finally {
    cleanup()
  }
})

test('dispatch：成员死亡后重建沿用 -2（不递增到 -3），且不重复提示改名', async () => {
  const { store, cleanup } = makeStore()
  try {
    // 上一轮已消歧出 dev-dup-2，宿主重启后该成员不在名单里，任务被对账标成 interrupted。
    const tasks = [
      makeTask('t1', { status: 'running', memberId: 'm-dev-dup' }),
      makeTask('t2', { status: 'interrupted', memberId: 'm-dev-dup-2' }),
    ]
    const state = makeState(tasks, {
      bindings: [bindingOf('t1', 'dev-dup'), bindingOf('t2', 'dev-dup-2')],
    })
    const { deps, spawned } = makeDeps(store, {
      members: [{ id: 'm-dev-dup', name: 'dev-dup', status: 'active' }],
    })
    deps.memberNameFor = () => 'dev-dup'
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, ['t2'])
    assert.deepEqual(spawned.map((input) => input.name), ['dev-dup-2'], '沿用自己老 binding 的名字，不升到 -3')
    assert.deepEqual(result.renamed, [], '沿用旧名不算消歧，不产生 notice')
    assert.deepEqual(
      result.state.bindings.filter((item) => !item.retired).map((item) => item.name),
      ['dev-dup', 'dev-dup-2'],
    )
  } finally {
    cleanup()
  }
})

test('dispatch：序号空间 -2…-99 全部被占 → 一条 MEMBER_NAME_COLLISION，不静默留 pending（AC-6）', async () => {
  const { store, cleanup } = makeStore()
  try {
    // 99 个未退役 binding 占满 dev-dup 与 dev-dup-2…-99（模拟宿主里已有一堆同名前缀成员）。
    const occupied = ['dev-dup', ...Array.from({ length: NAME_SUFFIX_MAX - 1 }, (_, i) => `dev-dup-${i + 2}`)]
    const state = makeState([makeTask('t1')], {
      bindings: occupied.map((name, index) => bindingOf(`ghost-${index}`, name)),
    })
    const { deps, spawned } = makeDeps(store)
    deps.memberNameFor = () => 'dev-dup'
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, [])
    assert.equal(spawned.length, 0)
    assert.equal(result.errors.length, 1, '恰好一条可观测错误')
    assert.equal(result.errors[0]?.code, 'MEMBER_NAME_COLLISION')
    assert.ok(result.errors[0]?.error.includes('dev-dup'), '错误必须指出被占满的候选名')
    assert.ok(
      (result.errors[0]?.error ?? '').includes(`-${NAME_SUFFIX_MAX}`),
      '错误必须说明序号空间上限',
    )
    // 无静默滞留：每个就绪任务都必须落在 started ∪ skipped ∪ errors 里。
    const accounted = new Set([
      ...result.started,
      ...result.skipped.map((item) => item.taskId),
      ...result.errors.map((item) => item.taskId),
    ])
    const silent = result.state.plan.tasks.filter((task) => task.status === 'pending' && !accounted.has(task.id))
    assert.deepEqual(silent.map((task) => task.id), [], 'pending 任务必须都有可观测归属')
    assert.equal(result.state.bindings.length, occupied.length, '失败侧不写 binding')
  } finally {
    cleanup()
  }
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

function evidenceOf(taskId: string, overrides: Partial<GateEvidence> = {}): GateEvidence {
  return { taskId, command: 'pnpm -s test', exitCode: 0, tail: 'ok 164 tests', artifacts: ['lib/index.js'], at: now, ...overrides }
}

const peerCount = (state: RunState): number => state.messages.filter((item) => item.from === 'peer').length
const captainCount = (state: RunState): number => state.messages.filter((item) => item.from === 'captain').length

test('applyReceipt：done 且门禁 exit 0 → 每个下游一条 from:peer 交接（AC-1/2/3）', async () => {
  const tasks = [
    makeTask('t1', { status: 'running', memberId: 'm-dev-t1' }),
    makeTask('t2', { status: 'blocked', dependsOn: ['t1'] }),
    makeTask('t3', { status: 'pending', dependsOn: ['t1'] }),
  ]
  const state = makeState(tasks, { bindings: [bindingOf('t1', 'dev-t1'), bindingOf('t3', 'dev-t3')] })
  const next = applyReceipt(state, 't1', { verdict: 'done', evidence: evidenceOf('t1') }, now + 1)

  const peers = next.messages.filter((item) => item.from === 'peer')
  assert.deepEqual(peers.map((item) => item.messageId), ['handoff:t1->t2', 'handoff:t1->t3'], '幂等键必须是 handoff:<上游>-><下游>')
  assert.deepEqual(peers.map((item) => item.taskId), ['t2', 't3'])
  // to 的两档：下游尚未创建 → task:<id>；已创建 → 成员名 + toMemberId（实发靠它定位）。
  assert.deepEqual(peers.map((item) => item.to), ['task:t2', 'dev-t3'])
  assert.equal(peers[1]?.toMemberId, 'm-dev-t3')
  assert.equal(peers[0]?.toMemberId, undefined)
  assert.ok(peers[0]?.body.includes('【上游直投】t1 任务t1 已通过门禁'), peers[0]?.body)
  assert.ok(peers[0]?.body.includes('命令：pnpm -s test'))
  assert.ok(peers[0]?.body.includes('产物：lib/index.js'))
  assert.ok(!peers[0]?.body.includes('captain'), 'PEER 正文不许出现 captain')

  // AC-3：投递前后 from:'captain' 条数不变；member→captain 回执照旧只有 1 条。
  assert.equal(captainCount(next), captainCount(state))
  assert.equal(next.messages.filter((item) => item.from === 'member').length, 1)
})

test('applyReceipt：重复 done 不新增 peer 交接（AC-5），rework/failed 一条都不投（AC-1）', async () => {
  const tasks = [
    makeTask('t1', { status: 'running', memberId: 'm-dev-t1' }),
    makeTask('t2', { status: 'blocked', dependsOn: ['t1'] }),
  ]
  const state = makeState(tasks, { bindings: [bindingOf('t1', 'dev-t1')] })

  const once = applyReceipt(state, 't1', { verdict: 'done', evidence: evidenceOf('t1') }, now + 1)
  assert.equal(peerCount(once), 1)
  const twice = applyReceipt(once, 't1', { verdict: 'done', evidence: evidenceOf('t1') }, now + 2)
  assert.equal(peerCount(twice), 1, '重复回执必须幂等：(A,B) 至多一条')

  assert.equal(peerCount(applyReceipt(state, 't1', { verdict: 'rework', evidence: evidenceOf('t1') }, now + 3)), 0)
  assert.equal(peerCount(applyReceipt(state, 't1', { verdict: 'failed', evidence: evidenceOf('t1') }, now + 4)), 0)
})

test('applyReceipt：done 但证据缺失 / exitCode=null（超时被杀）/ 非 0 → 都不投递', async () => {
  const tasks = [
    makeTask('t1', { status: 'running', memberId: 'm-dev-t1' }),
    makeTask('t2', { status: 'blocked', dependsOn: ['t1'] }),
  ]
  const state = makeState(tasks, { bindings: [bindingOf('t1', 'dev-t1')] })

  assert.equal(peerCount(applyReceipt(state, 't1', { verdict: 'done' }, now + 1)), 0, '没跑过门禁就没有「已通过」')
  assert.equal(peerCount(applyReceipt(state, 't1', { verdict: 'done', evidence: evidenceOf('t1', { exitCode: null }) }, now + 2)), 0)
  assert.equal(peerCount(applyReceipt(state, 't1', { verdict: 'done', evidence: evidenceOf('t1', { exitCode: 1 }) }, now + 3)), 0)
})

test('dispatchReady：下游创建时把上游交接注入首条提示词（AC-4b 的唯一注入点）', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [
      makeTask('t1', { status: 'running', memberId: 'm-dev-t1' }),
      makeTask('t2', { status: 'blocked', dependsOn: ['t1'] }),
    ]
    let state = makeState(tasks, { bindings: [bindingOf('t1', 'dev-t1')] })
    state = applyReceipt(state, 't1', { verdict: 'done', evidence: evidenceOf('t1') }, now + 1)

    const { deps, spawned } = makeDeps(store)
    const seen: PromptInput[] = []
    const build = deps.buildPrompt
    deps.buildPrompt = (input) => {
      seen.push(input)
      return build(input)
    }

    const result = await dispatchReady(state, deps)
    assert.deepEqual(result.started, ['t2'])
    assert.equal(seen.length, 1)
    const body = result.state.messages.find((item) => item.messageId === 'handoff:t1->t2')?.body
    assert.ok(body, '账本里必须有这条交接')
    // 账本与提示词必须是同一个字符串（AC-4 的「逐字一致」在注入侧的判据）。
    assert.deepEqual(seen[0]?.handoffs, [body])
    assert.ok(seen[0]?.handoffs?.[0]?.includes('产物：lib/index.js'))
    // 只有首条提示词走 handoffs：spawn 的 prompt 本身不是这里拼的，但仍要确认成员真的被创建。
    assert.equal(spawned.length, 1)
  } finally {
    cleanup()
  }
})

// ---------- r7：暂停不是可派发状态（纯函数层的第二道闸门，TECHNICAL §6.1） ----------

test('dispatch：planStatus=paused 时纯函数层也不派发（不靠 bridge 闸门兜底）', async () => {
  const { store, cleanup } = makeStore()
  try {
    // 暂停态 + 两个「本来可派发」的任务（ready / pending）。纯函数层若没拦，这两个必然被 spawn，
    // 所以 `spawned.length === 0` 是能分辨的判据（不是空跑也绿的那种）。
    const tasks = [makeTask('t1', { status: 'ready' }), makeTask('t2', { status: 'pending' })]
    const state = makeState(tasks, { plan: makePlan(tasks, { status: 'paused' }) })
    const { deps, spawned } = makeDeps(store)
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, [], '暂停期间不许起人')
    assert.equal(spawned.length, 0, 'spawn 端口一次都不能被调用')
    assert.deepEqual(
      result.skipped.map((item) => [item.taskId, item.reason]),
      [
        ['t1', 'NO_PLAN'],
        ['t2', 'NO_PLAN'],
      ],
      '被拦下的任务必须逐条报出来（面板据此解释「为什么点了没动」）',
    )
    assert.equal(result.state.plan.tasks[0]?.status, 'ready', '状态不许被改写')
  } finally {
    cleanup()
  }
})

test('dispatch：同一份状态把 planStatus 换回 dispatching 就会派发（对照实验，证明上面的 0 是「被拦」）', async () => {
  const { store, cleanup } = makeStore()
  try {
    const tasks = [makeTask('t1', { status: 'ready' })]
    const state = makeState(tasks, { plan: makePlan(tasks, { status: 'dispatching' }) })
    const { deps, spawned } = makeDeps(store)
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, ['t1'], '未暂停时同一份状态必须真派出（否则上面的断言不承载信息）')
    assert.equal(spawned.length, 1)
  } finally {
    cleanup()
  }
})

test('applyReceipt：返工上限可取 settings 值，缺省仍是 config.MAX_ATTEMPTS（AC-13 生效点，值不变）', () => {
  const evidence = evidenceOf('t1', { exitCode: 1, tail: 'boom' })
  const base = makeState([makeTask('t1', { status: 'running' })])

  // 上限 1：第 1 次返工就到顶（`nextAttempts >= limit`），必须直接转 failed —— 这正是「可配」与
  // 「写死 3」的可分判据；上限仍然缺省取常量时，同一输入必须是 rework。
  const first = applyReceipt(base, 't1', { verdict: 'rework', evidence }, now, 1)
  assert.equal(first.plan.tasks[0]?.status, 'failed', '上限 1 时第 1 次返工即到顶')
  assert.equal(first.plan.tasks[0]?.attempts, 1)

  // 不传上限：沿用 config 常量（MAX_ATTEMPTS），第 2 次仍应是 rework —— 「常量值不变」不许被悄悄改。
  const loose = applyReceipt(base, 't1', { verdict: 'rework', evidence }, now)
  assert.equal(loose.plan.tasks[0]?.status, 'rework', `缺省上限是 MAX_ATTEMPTS(${MAX_ATTEMPTS})，第 1 次不许转 failed`)
  assert.equal(loose.plan.tasks[0]?.attempts, 1)
  const second = applyReceipt(loose, 't1', { verdict: 'rework', evidence }, now)
  assert.equal(second.plan.tasks[0]?.status, 'rework', '第 2 次仍在上限内')
  const third = applyReceipt(second, 't1', { verdict: 'rework', evidence }, now)
  assert.equal(third.plan.tasks[0]?.status, MAX_ATTEMPTS <= 3 ? 'failed' : 'rework', `第 3 次按 MAX_ATTEMPTS(${MAX_ATTEMPTS}) 到顶`)
})

// ── r11 · 写域等待 / 释放 / 依赖语义（T2）────────────────────────────────────

const SCOPED_PATH = 'src/host/bridge.ts'
const WAIT_REASON = `等待 t1 释放 ${SCOPED_PATH}`

/** 同域两条任务：t1 在飞持有写域，t2 正被它挡住。 */
function waitingPair(): RunState {
  return makeState(
    [
      makeTask('t1', { status: 'running', writeScopes: [SCOPED_PATH] }),
      makeTask('t2', { status: 'waiting', writeScopes: [SCOPED_PATH], waitingOn: ['t1'], waitReason: WAIT_REASON }),
    ],
    { bindings: [bindingOf('t1', 'dev-t1'), bindingOf('t2', 'dev-t2')] },
  )
}

/** 只数写域释放通知（`rel-` 前缀），与普通派发/回执消息区分。 */
function releaseMessages(state: RunState) {
  return state.messages.filter((message) => (message.messageId ?? '').startsWith('rel-'))
}

function statusOf(state: RunState, id: string) {
  return state.plan.tasks.find((task) => task.id === id)?.status
}

function withStatus(tasks: RunState['plan']['tasks'], id: string, status: string) {
  return tasks.map((task) => (task.id === id ? { ...task, status: status as (typeof task)['status'] } : task))
}

test('dispatch：写域被占用转 waiting，不 spawn、不占并发位（AC-14）', async () => {
  const { store, cleanup } = makeStore()
  try {
    const state = makeState([
      makeTask('t1', { status: 'running', writeScopes: [SCOPED_PATH] }),
      makeTask('t2', { writeScopes: [SCOPED_PATH] }),
      makeTask('t3', { writeScopes: ['src/host/tools.ts'] }),
    ])
    const { deps, spawned } = makeDeps(store)
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, ['t3'], '同域任务必须排队，异域任务照常派发')
    assert.equal(spawned.length, 1, 'waiting 不许 spawn 成员')
    assert.equal(statusOf(result.state, 't2'), 'waiting')
    assert.deepEqual(result.state.plan.tasks.find((task) => task.id === 't2')?.waitingOn, ['t1'])
    assert.equal(
      result.state.plan.tasks.find((task) => task.id === 't2')?.waitReason,
      WAIT_REASON,
      'AC-14 逐字样例：等待 t1 释放 src/host/bridge.ts',
    )
    assert.equal(runningCount(result.state.plan.tasks), 2, 'waiting 不计入在飞数（t1 + t3）')
  } finally {
    cleanup()
  }
})

test('dispatch：同批写域重叠按计划顺序串行，第一个 running 其余 waiting（AC-17）', async () => {
  const { store, cleanup } = makeStore()
  try {
    const state = makeState([
      makeTask('t1', { writeScopes: [SCOPED_PATH] }),
      makeTask('t2', { writeScopes: [SCOPED_PATH] }),
    ])
    const { deps, spawned } = makeDeps(store)
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, ['t1'])
    assert.equal(spawned.length, 1)
    assert.equal(statusOf(result.state, 't2'), 'waiting')
    assert.deepEqual(result.state.plan.tasks.find((task) => task.id === 't2')?.waitingOn, ['t1'])
  } finally {
    cleanup()
  }
})

test('applyReceipt：done 释放写域 → 等待者恰一条通知，下一轮按计划顺序派出（AC-15/AC-18）', async () => {
  const { store, cleanup } = makeStore()
  try {
    const released = applyReceipt(waitingPair(), 't1', { verdict: 'done' }, now)
    const rel = releaseMessages(released)
    assert.equal(rel.length, 1, '每个等待者恰一条释放通知')
    assert.equal(rel[0]?.from, 'captain')
    assert.equal(rel[0]?.to, 'dev-t2', 'to 是等待者成员名')
    assert.equal(rel[0]?.taskId, 't2')
    assert.equal(rel[0]?.body, `t1 已结束并释放 ${SCOPED_PATH}，你可以接着改（任务 t2）。`)

    // 重放同一条回执：幂等键 rel-<holder>-<waiter>-<seq> 挡住第二条
    const replay = applyReceipt(released, 't1', { verdict: 'done' }, now)
    assert.equal(releaseMessages(replay).length, 1, '重放回执不许二次唤醒')

    const { deps } = makeDeps(store)
    const result = await dispatchReady(replay, deps)
    assert.deepEqual(result.started, ['t2'], '释放后等待者转 pending 并被派出')
    assert.equal(statusOf(result.state, 't2'), 'running')
  } finally {
    cleanup()
  }
})

test('写域释放：五终态各释放一次，非终态（rework）不释放（AC-15）', () => {
  const episodes: Array<{ label: string; release: (state: RunState) => RunState }> = [
    { label: 'done', release: (state) => applyReceipt(state, 't1', { verdict: 'done' }, now) },
    { label: 'failed', release: (state) => applyReceipt(state, 't1', { verdict: 'failed' }, now) },
    { label: 'interrupted', release: (state) => reconcileMembers(state, [], now).state },
    {
      label: 'cancelled',
      release: (state) => releaseScopes({ ...state, plan: { ...state.plan, tasks: withStatus(state.plan.tasks, 't1', 'cancelled') } }, 't1', now),
    },
    {
      label: 'skipped',
      release: (state) => releaseScopes({ ...state, plan: { ...state.plan, tasks: withStatus(state.plan.tasks, 't1', 'skipped') } }, 't1', now),
    },
  ]

  for (const episode of episodes) {
    const released = episode.release(waitingPair())
    assert.equal(releaseMessages(released).length, 1, `${episode.label} 终态必须立即释放写域`)
  }

  const reworking = applyReceipt(waitingPair(), 't1', { verdict: 'rework' }, now)
  assert.equal(statusOf(reworking, 't1'), 'rework', '前置条件：rework 不是终态')
  assert.equal(releaseMessages(reworking).length, 0, 'rework 不许释放（否则「只在 done 释放」这个 bug 测不出来）')
})

test('写域释放：同一持有者的多个等待者各恰一条通知（AC-18）', () => {
  const state = makeState(
    [
      makeTask('t1', { status: 'running', writeScopes: [SCOPED_PATH] }),
      makeTask('t2', { status: 'waiting', writeScopes: [SCOPED_PATH], waitingOn: ['t1'], waitReason: WAIT_REASON }),
      makeTask('t3', { status: 'waiting', writeScopes: [SCOPED_PATH], waitingOn: ['t1'], waitReason: WAIT_REASON }),
    ],
    { bindings: [bindingOf('t1', 'dev-t1'), bindingOf('t2', 'dev-t2'), bindingOf('t3', 'dev-t3')] },
  )
  const rel = releaseMessages(releaseScopes(state, 't1', now))

  assert.equal(rel.length, 2)
  assert.deepEqual(rel.map((message) => message.to).sort(), ['dev-t2', 'dev-t3'])
  assert.deepEqual(rel.map((message) => message.taskId).sort(), ['t2', 't3'])
  assert.equal(new Set(rel.map((message) => message.messageId)).size, 2, '幂等键两两不同')
})

test('重启：waiting 与写域字段原样存活，按计划顺序重算后可派发（AC-16）', async () => {
  const { store, dir, cleanup } = makeStore()
  try {
    store.save(waitingPair())
    const reloaded = new RunsStore(dir).load('run-1')
    assert.ok(reloaded, '新 store 实例必须能读回同一份运行状态')

    const waiter = reloaded.plan.tasks.find((task) => task.id === 't2')
    assert.equal(waiter?.status, 'waiting', 'waiting 不在白名单里会被归回 pending，重启后互斥静默失效')
    assert.deepEqual(waiter?.waitingOn, ['t1'])
    assert.equal(waiter?.waitReason, WAIT_REASON)
    assert.deepEqual(waiter?.writeScopes, [SCOPED_PATH], '写域必须存活')

    // 无锁表：持有者一结束，下一轮从 plan 现算即可放行
    const done = applyReceipt(reloaded, 't1', { verdict: 'done' }, now)
    const { deps } = makeDeps(store)
    const result = await dispatchReady(done, deps)
    assert.deepEqual(result.started, ['t2'])
  } finally {
    cleanup()
  }
})

test('applyScopeWaits：无变化时返回同一引用（幂等），解除后清空等待字段（AC-14）', () => {
  const base = waitingPair()
  assert.equal(applyScopeWaits(base, now), base, '没有变化必须返回同一引用，不制造无谓落盘')

  const freed = { ...base, plan: { ...base.plan, tasks: withStatus(base.plan.tasks, 't1', 'done') } }
  const revived = applyScopeWaits(freed, now)
  const waiter = revived.plan.tasks.find((task) => task.id === 't2')
  assert.equal(waiter?.status, 'pending', '写域空了就放回 pending')
  assert.equal(waiter?.waitingOn, undefined)
  assert.equal(waiter?.waitReason, undefined)
  assert.equal(applyScopeWaits(revived, now), revived, '二次调用仍无变化')
})

test('dispatch：磁盘上残留的不一致等待关系被重算——持有者已 done、等待者仍 waiting（AC-16）', async () => {
  const { store, cleanup } = makeStore()
  try {
    // 场景：上一轮在「持有者转 done」与「等待者转 pending」之间崩掉/被杀，盘上就长这样。
    // 没有锁表可修，唯一正确出路是每轮按 plan 现算 —— 这正是 AC-16 要的行为。
    const state = makeState(
      [
        makeTask('t1', { status: 'done', writeScopes: [SCOPED_PATH] }),
        makeTask('t2', { status: 'waiting', writeScopes: [SCOPED_PATH], waitingOn: ['t1'], waitReason: WAIT_REASON }),
      ],
      { bindings: [bindingOf('t2', 'dev-t2')] },
    )
    const { deps } = makeDeps(store)
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, ['t2'], '重建等待关系后必须直接派发，而不是永远卡在 waiting')
    assert.equal(statusOf(result.state, 't2'), 'running')
  } finally {
    cleanup()
  }
})

test('dispatch：并发满的早退分支也必须落盘（否则这一轮的等待判定白算）', async () => {
  const { store, dir, cleanup } = makeStore()
  try {
    // t1 占着唯一名额并把写域拿在手上；t3 的等待关系已失效（写域不冲突）→ 本轮会被放回 pending。
    // 此时 slots=0 提前返回，若不保存，磁盘上 t3 仍是 waiting，面板会一直显示在等一条无关的路径。
    const tasks = [
      makeTask('t1', { status: 'running', writeScopes: [SCOPED_PATH] }),
      makeTask('t2', { status: 'waiting', writeScopes: [SCOPED_PATH], waitingOn: ['t1'], waitReason: WAIT_REASON }),
      makeTask('t3', { status: 'waiting', writeScopes: ['src/host/tools.ts'], waitingOn: ['t1'], waitReason: '等待 t1 释放 src/host/tools.ts' }),
    ]
    const state = makeState(tasks, { plan: makePlan(tasks, { maxConcurrent: 1 }) })
    const { deps } = makeDeps(store)
    const result = await dispatchReady(state, deps)

    assert.deepEqual(result.started, [], '并发位已满，本轮不许起人')
    assert.equal(statusOf(result.state, 't3'), 'pending')
    const reloaded = new RunsStore(dir).load('run-1')
    assert.equal(reloaded?.plan.tasks.find((task) => task.id === 't3')?.status, 'pending', '早退分支必须保存，否则等待关系停在盘上')
    assert.equal(reloaded?.plan.tasks.find((task) => task.id === 't2')?.status, 'waiting', '真正冲突的等待者必须保持 waiting')
  } finally {
    cleanup()
  }
})


