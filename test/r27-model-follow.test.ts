/**
 * r27：角色模型真动态跟随会话默认（QA 回归）。
 *
 * 覆盖四层：
 *  1. 宿主读口 `readSessionRoute` / `readCallerRoute` 的三形状与缺失语义（不抛、不补猜、不半截）；
 *  2. `modelRouteOf` 的四情形（角色声明 / 会话路由 / currentSelection / 都读不到），provider 与
 *     model 必须成对；
 *  3. 复用闸门（成员会话真实路由 vs 本次目标路由）四种组合 + 目标路由回退到会话当前路由；
 *  4. 审计：spawn/复用后 actual 取成员会话真实路由，verdict 为 ok / drift / unverified。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MemberBinding, Plan, PlanTask, Role, RoleModelRoute } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import type { RoleRepo } from '../src/host/roles/repo.ts'
import type { HostMember } from '../src/host/team/watcher.ts'
import type { HostContext } from '../src/host/adapters.ts'
import { canReadSessionRoute, createSpawnPorts, readCallerRoute, readSessionRoute } from '../src/host/adapters.ts'
import { dispatchReady, routeAllowsReuse, type DispatchDeps, type SpawnInput } from '../src/host/team/dispatch.ts'

const NOW = 1_800_000_000_000
const ROUTE_A: RoleModelRoute = { provider: 'magpie', model: 'group/deppseekv4.1-flash' }
const ROUTE_B: RoleModelRoute = { provider: 'deepseek-official', model: 'deepseek-flash' }

/* ─────────── ① readSessionRoute / readCallerRoute ─────────── */

interface SessionShape {
  requestHeader?: () => unknown
}

function ctxWithSessions(sessions: Record<string, SessionShape | undefined>): HostContext {
  return {
    agents: {
      currentInitiator: () => ({ id: 'lead-session' }),
      get: (sessionId: string) => {
        const session = sessions[sessionId]
        return session === undefined ? undefined : { session }
      },
    },
  } as unknown as HostContext
}

test('readSessionRoute：完整 config → 逐字返回 provider/model（合法 effort 才带上）', () => {
  const ctx = ctxWithSessions({
    'lead-session': {
      requestHeader: () => ({ config: { provider: 'magpie', model: 'group/deppseekv4.1-flash', reasoningEffort: 'high' } }),
    },
  })
  assert.deepEqual(readSessionRoute(ctx, 'lead-session'), {
    provider: 'magpie',
    model: 'group/deppseekv4.1-flash',
    reasoningEffort: 'high',
  })
})

test('readSessionRoute：requestHeader 返回 undefined / config 缺 model → undefined（不补猜）', () => {
  const noHeader = ctxWithSessions({ 'lead-session': { requestHeader: () => undefined } })
  assert.equal(readSessionRoute(noHeader, 'lead-session'), undefined)

  const missingModel = ctxWithSessions({ 'lead-session': { requestHeader: () => ({ config: { provider: 'magpie' } }) } })
  assert.equal(readSessionRoute(missingModel, 'lead-session'), undefined, '只有 provider 是半截路由，必须判为读不到')

  const missingProvider = ctxWithSessions({ 'lead-session': { requestHeader: () => ({ config: { model: 'm' } }) } })
  assert.equal(readSessionRoute(missingProvider, 'lead-session'), undefined)

  const emptyStrings = ctxWithSessions({ 'lead-session': { requestHeader: () => ({ config: { provider: '', model: '' } }) } })
  assert.equal(readSessionRoute(emptyStrings, 'lead-session'), undefined)

  const badEffort = ctxWithSessions({
    'lead-session': { requestHeader: () => ({ config: { provider: 'p', model: 'm', reasoningEffort: 'extreme' } }) },
  })
  assert.deepEqual(readSessionRoute(badEffort, 'lead-session'), { provider: 'p', model: 'm' }, '非法 effort 忽略，不影响成对路由')
})

test('readSessionRoute：session 不存在 / agents.get 不可用 / 读口抛错 → undefined 且不抛', () => {
  assert.equal(readSessionRoute(ctxWithSessions({}), 'missing'), undefined)
  assert.equal(readSessionRoute({ agents: {} } as unknown as HostContext, 'lead-session'), undefined)
  assert.equal(
    readSessionRoute(
      { agents: { get: () => ({ session: { requestHeader: () => { throw new Error('宿主读口超时') } } }) } } as unknown as HostContext,
      'lead-session',
    ),
    undefined,
    '读 requestHeader 抛错只能退化成读不到',
  )
  assert.equal(
    readSessionRoute(
      { agents: { get: () => { throw new Error('session 已释放') } } } as unknown as HostContext,
      'lead-session',
    ),
    undefined,
  )
  assert.equal(canReadSessionRoute({ agents: {} } as unknown as HostContext), false)
  assert.equal(canReadSessionRoute({} as unknown as HostContext), false)
  assert.equal(canReadSessionRoute(ctxWithSessions({})), true)
})

test('readCallerRoute：当前队长会话的真实路由；没有 initiator 时 undefined', () => {
  const ctx = ctxWithSessions({ 'lead-session': { requestHeader: () => ({ config: { provider: 'magpie', model: 'm' } }) } })
  assert.deepEqual(readCallerRoute(ctx), { provider: 'magpie', model: 'm' })
  assert.equal(readCallerRoute({ agents: {} } as unknown as HostContext), undefined)
})

/* ─────────── ② modelRouteOf（经 createSpawnPorts.spawn 观察 agentOptions） ─────────── */

interface SpawnCapture {
  requests: Array<Record<string, unknown>>
  spawn(input: { sessionId: string; route?: RoleModelRoute; name?: string }): Promise<{ ok: boolean }>
}

function spawnCapture(ctx: HostContext): SpawnCapture {
  const requests: Array<Record<string, unknown>> = []
  const withTeams = {
    ...ctx,
    agentTeams: {
      spawnTeammate: async (_caller: unknown, request: unknown) => {
        requests.push(request as Record<string, unknown>)
        return { member: { id: `m-${requests.length}`, name: `dev-${requests.length}` } }
      },
    },
  } as unknown as HostContext
  const ports = createSpawnPorts(withTeams)
  return {
    requests,
    spawn: async (input) =>
      (await ports.spawn({
        prompt: '去做',
        name: input.name ?? 'dev-t1',
        sessionId: input.sessionId,
        taskId: 't1',
        ...(input.route === undefined ? {} : { route: input.route }),
      })) as { ok: boolean },
  }
}

test('modelRouteOf：角色声明优先于会话路由（显式模型不被会话默认覆盖）', async () => {
  const capture = spawnCapture(
    ctxWithSessions({ 'lead-session': { requestHeader: () => ({ config: { provider: 'magpie', model: 'session-model' } }) } }),
  )
  await capture.spawn({ sessionId: 'lead-session', route: { provider: 'deepseek', model: 'declared-model' } })
  assert.deepEqual(capture.requests[0]?.agentOptions, { provider: 'deepseek', model: 'declared-model' })
})

test('modelRouteOf：未声明 + 会话路由可读 → 与会话路由逐字相等（provider/model 成对）', async () => {
  const capture = spawnCapture(
    ctxWithSessions({ 'lead-session': { requestHeader: () => ({ config: { provider: 'magpie', model: 'group/deppseekv4.1-flash', reasoningEffort: 'medium' } }) } }),
  )
  await capture.spawn({ sessionId: 'lead-session' })
  assert.deepEqual(capture.requests[0]?.agentOptions, {
    provider: 'magpie',
    model: 'group/deppseekv4.1-flash',
    reasoningEffort: 'medium',
  })
})

test('modelRouteOf：会话路由读不到 + currentSelection 可读 → 取 currentSelection 的 provider 与 model（不只 provider）', async () => {
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'lead-session' }), get: () => undefined },
    get: (name: string) =>
      name === 'agentDefaultModel'
        ? { currentSelection: () => ({ provider: 'global-p', model: 'global-m', reasoningEffort: 'low' }) }
        : undefined,
  } as unknown as HostContext
  const capture = spawnCapture(ctx)
  await capture.spawn({ sessionId: 'lead-session' })
  assert.deepEqual(capture.requests[0]?.agentOptions, { provider: 'global-p', model: 'global-m', reasoningEffort: 'low' })
})

test('modelRouteOf：caller 无路由时用本次 run 的会话路由兜底（后台派发）', async () => {
  const ctx = ctxWithSessions({ 'run-session': { requestHeader: () => ({ config: { provider: 'magpie', model: 'run-model' } }) } })
  const capture = spawnCapture(ctx)
  await capture.spawn({ sessionId: 'run-session' })
  assert.deepEqual(capture.requests[0]?.agentOptions, { provider: 'magpie', model: 'run-model' })
})

test('modelRouteOf：都读不到 → undefined，spawn 不传 agentOptions 且不凭空造 provider', async () => {
  const capture = spawnCapture({ agents: { currentInitiator: () => ({ id: 'lead-session' }), get: () => undefined } } as unknown as HostContext)
  const result = await capture.spawn({ sessionId: 'lead-session' })
  assert.equal(result.ok, true)
  assert.equal(capture.requests[0]?.agentOptions, undefined)
  assert.equal(capture.requests[0]?.provider, 'spawn', 'provider 仍是 subagent 名（不是 LLM provider），不得凭空造半截路由')
})

test('modelRouteOf：currentSelection 只有 provider → 不产出半截路由（agentOptions undefined）', async () => {
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'lead-session' }), get: () => undefined },
    get: (name: string) => (name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'only-provider' }) } : undefined),
  } as unknown as HostContext
  const capture = spawnCapture(ctx)
  await capture.spawn({ sessionId: 'lead-session' })
  assert.equal(capture.requests[0]?.agentOptions, undefined)
})

/* ─────────── ③ 复用闸门（真实 dispatchReady + 内存 store） ─────────── */

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

function makePlan(tasks: PlanTask[]): Plan {
  return { runId: 'run-1', sessionId: 'session-1', createdAt: NOW, status: 'dispatching', tasks, maxConcurrent: 3 }
}

function makeState(tasks: PlanTask[], overrides: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: makePlan(tasks),
    plannedAt: NOW,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...overrides,
  }
}

function makeRole(model?: RoleModelRoute): Role {
  return { id: 'dev', name: 'dev', duty: '交付', skillIds: [], model, builtin: true, updatedAt: NOW }
}

function roleRepo(role: Role): RoleRepo {
  return {
    list: () => [role],
    get: (id: string) => (id === role.id ? role : undefined),
    save: (value: Role) => ({ ok: true as const, role: value }),
    remove: () => ({ ok: true as const }),
    seed: () => {},
    restoreDefaults: () => ({ restored: [], kept: [] }),
  }
}

function bindingOf(taskId: string, memberId: string, name: string): MemberBinding {
  return { taskId, roleId: 'dev', memberId, name, spawnedAt: NOW }
}

interface ReuseFixture {
  state: RunState
  deps: DispatchDeps
  spawned: SpawnInput[]
  sent: Array<{ memberId: string; text: string }>
  cleanup(): void
}

function reuseFixture(options: {
  role?: Role
  memberRouteFor?: (sessionId: string) => RoleModelRoute | undefined
  callerRoute?: () => RoleModelRoute | undefined
  withGate?: boolean
  audits?: RunState['routeAudits']
}): ReuseFixture {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r27-'))
  const store = new RunsStore(dir)
  const member: HostMember = { id: 'm-dev', name: 'dev-t1-abc123', status: 'inactive' }
  const tasks = [makeTask('t1', { status: 'done' }), makeTask('t2')]
  const state = makeState(tasks, {
    bindings: [bindingOf('t1', member.id, member.name)],
    routeAudits: options.audits ?? [],
  })
  const spawned: SpawnInput[] = []
  const sent: Array<{ memberId: string; text: string }> = []
  const role = options.role ?? makeRole()
  const deps: DispatchDeps = {
    store,
    roles: roleRepo(role),
    buildPrompt: (input) => `任务：${input.task.title}`,
    listMembers: async () => [member],
    spawn: async (input) => {
      spawned.push(input)
      return { ok: true, memberId: `m-new-${spawned.length}` }
    },
    sendMessage: async (memberId, text) => {
      sent.push({ memberId, text })
      return { ok: true }
    },
    hostConcurrency: () => ({ limit: 8, source: 'host' }),
    now: () => NOW,
    ...(options.withGate === false
      ? {}
      : {
          readSessionRoute: options.memberRouteFor ?? (() => undefined),
          readCallerRoute: options.callerRoute ?? (() => undefined),
        }),
  }
  return { state, deps, spawned, sent, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('routeAllowsReuse：一致/不一致/两边缺/单边缺四种组合', () => {
  assert.equal(routeAllowsReuse(ROUTE_A, { ...ROUTE_A, reasoningEffort: 'high' }), true, 'effort 不参与比较')
  assert.equal(routeAllowsReuse(ROUTE_A, ROUTE_B), false)
  assert.equal(routeAllowsReuse(ROUTE_A, { provider: ROUTE_A.provider, model: '另一个模型' }), false)
  assert.equal(routeAllowsReuse(undefined, undefined), true, '两边都读不到 → 老宿主不退化，仍然复用')
  assert.equal(routeAllowsReuse(ROUTE_A, undefined), false, '单边缺失无法确认，宁可新建')
  assert.equal(routeAllowsReuse(undefined, ROUTE_A), false)
})

test('复用闸门：成员会话路由与目标一致 → 复用（sendMessage，不新建）', async () => {
  const fixture = reuseFixture({
    memberRouteFor: (sessionId) => (sessionId === 'm-dev' ? ROUTE_A : ROUTE_A),
    callerRoute: () => ROUTE_A,
  })
  try {
    const result = await dispatchReady(fixture.state, fixture.deps)
    assert.deepEqual(result.started, ['t2'])
    assert.equal(fixture.spawned.length, 0, '路由一致时绝不新建成员')
    assert.equal(fixture.sent.length, 1)
    assert.equal(fixture.sent[0]?.memberId, 'm-dev')
    assert.match(fixture.sent[0]?.text ?? '', /## 新任务（t2）/)
    assert.equal(result.state.bindings.find((item) => item.taskId === 't2')?.memberId, 'm-dev')
  } finally {
    fixture.cleanup()
  }
})

test('复用闸门：provider 不同 → 不复用、走 spawn，activity 里有可读原因', async () => {
  const fixture = reuseFixture({
    memberRouteFor: (sessionId) => (sessionId === 'm-dev' ? ROUTE_B : ROUTE_A),
    callerRoute: () => ROUTE_A,
  })
  try {
    const result = await dispatchReady(fixture.state, fixture.deps)
    assert.equal(fixture.spawned.length, 1, 'provider 不一致必须新建成员（成员会停在创建时的模型上）')
    assert.equal(fixture.sent.length, 0, '不一致时不得把任务卡发给旧成员')
    assert.equal(result.state.bindings.find((item) => item.taskId === 't2')?.memberId, 'm-new-1')
    const activity = result.state.messages.find((item) => item.taskId === 't2' && item.to === 'user')
    assert.ok(activity, '必须留下可读原因，不能静默换人')
    assert.match(activity.body, /模型不一致，改为新建成员/)
    assert.match(activity.body, /deepseek-official\/deepseek-flash/)
    assert.match(activity.body, /magpie\/group\/deppseekv4\.1-flash/)
  } finally {
    fixture.cleanup()
  }
})

test('复用闸门：仅 model 不同 → 同样不复用、走 spawn', async () => {
  const fixture = reuseFixture({
    memberRouteFor: (sessionId) => (sessionId === 'm-dev' ? { provider: ROUTE_A.provider, model: 'old-model' } : ROUTE_A),
    callerRoute: () => ROUTE_A,
  })
  try {
    const result = await dispatchReady(fixture.state, fixture.deps)
    assert.equal(fixture.spawned.length, 1)
    assert.equal(result.state.bindings.find((item) => item.taskId === 't2')?.memberId, 'm-new-1')
  } finally {
    fixture.cleanup()
  }
})

test('复用闸门：两边都读不到 → 仍复用（老宿主不退化）', async () => {
  const fixture = reuseFixture({ memberRouteFor: () => undefined, callerRoute: () => undefined })
  try {
    const result = await dispatchReady(fixture.state, fixture.deps)
    assert.equal(fixture.spawned.length, 0, '读不到路由不等于路由不同：老宿主必须继续复用')
    assert.equal(fixture.sent.length, 1)
    assert.deepEqual(result.started, ['t2'])
  } finally {
    fixture.cleanup()
  }
})

test('复用闸门：目标路由未声明时取会话当前路由再比（provider 相同 model 不同 → 新建）', async () => {
  const fixture = reuseFixture({
    memberRouteFor: (sessionId) => (sessionId === 'm-dev' ? { provider: ROUTE_A.provider, model: 'member-model' } : ROUTE_A),
    callerRoute: () => undefined, // 后台派发：没有 initiator
  })
  try {
    await dispatchReady(fixture.state, fixture.deps)
    assert.equal(fixture.spawned.length, 1, '目标路由回退到 run 会话路由后，model 不同仍须新建')
  } finally {
    fixture.cleanup()
  }
})

test('复用闸门：目标路由未声明且与会话路由一致 → 复用', async () => {
  const fixture = reuseFixture({
    memberRouteFor: (sessionId) => (sessionId === 'm-dev' ? ROUTE_A : ROUTE_A),
    callerRoute: () => undefined,
  })
  try {
    await dispatchReady(fixture.state, fixture.deps)
    assert.equal(fixture.spawned.length, 0)
    assert.equal(fixture.sent.length, 1)
  } finally {
    fixture.cleanup()
  }
})

test('复用闸门：单边缺失（成员可读、目标读不到）→ 不复用，宁可新建', async () => {
  const fixture = reuseFixture({
    memberRouteFor: (sessionId) => (sessionId === 'm-dev' ? ROUTE_A : undefined),
    callerRoute: () => undefined,
  })
  try {
    await dispatchReady(fixture.state, fixture.deps)
    assert.equal(fixture.spawned.length, 1, '无法确认成员跑的就是本次目标路由时不得复用')
    assert.equal(fixture.sent.length, 0)
  } finally {
    fixture.cleanup()
  }
})

test('复用闸门：装配层没接 readSessionRoute（老装配）→ 整体跳过，不因读不到而永远新建', async () => {
  const fixture = reuseFixture({ withGate: false })
  try {
    await dispatchReady(fixture.state, fixture.deps)
    assert.equal(fixture.spawned.length, 0)
    assert.equal(fixture.sent.length, 1)
  } finally {
    fixture.cleanup()
  }
})

/* ─────────── ④ 审计：spawn/复用后的 actual 与 verdict ─────────── */

test('审计：spawn 后 actual 等于成员会话路由，verdict=ok', async () => {
  const role = makeRole(ROUTE_A)
  const fixture = reuseFixture({
    role,
    memberRouteFor: (sessionId) => (sessionId === 'm-new-1' || sessionId === 'm-dev' ? ROUTE_A : undefined),
    callerRoute: () => ROUTE_A,
  })
  try {
    const result = await dispatchReady(fixture.state, fixture.deps)
    assert.equal(fixture.spawned.length, 1)
    const audit = result.state.routeAudits.find((item) => item.taskId === 't2')
    assert.ok(audit, '声明了模型的角色必须审计')
    assert.deepEqual(audit.declared, ROUTE_A)
    assert.deepEqual(audit.actual, ROUTE_A, 'actual 必须取 spawn 后成员会话的真实路由')
    assert.equal(audit.verdict, 'ok')
  } finally {
    fixture.cleanup()
  }
})

test('审计：成员会话路由与声明不同 → verdict=drift，任务标记失败并留可读消息', async () => {
  const role = makeRole(ROUTE_A)
  const fixture = reuseFixture({
    role,
    memberRouteFor: (sessionId) => (sessionId === 'm-new-1' ? ROUTE_B : undefined),
    callerRoute: () => ROUTE_A,
  })
  try {
    const result = await dispatchReady(fixture.state, fixture.deps)
    const audit = result.state.routeAudits.find((item) => item.taskId === 't2')
    assert.equal(audit?.verdict, 'drift')
    assert.deepEqual(audit?.actual, ROUTE_B)
    assert.equal(result.state.plan.tasks.find((item) => item.id === 't2')?.status, 'failed')
    assert.ok(result.state.messages.some((item) => item.body.includes('路由漂移')), '漂移必须有可读证据')
  } finally {
    fixture.cleanup()
  }
})

test('审计：读不到成员会话路由 → 保持 unverified（不拿声明值假装生效）', async () => {
  const role = makeRole(ROUTE_A)
  const fixture = reuseFixture({
    role,
    memberRouteFor: () => undefined,
    callerRoute: () => ROUTE_A,
  })
  try {
    const result = await dispatchReady(fixture.state, fixture.deps)
    const audit = result.state.routeAudits.find((item) => item.taskId === 't2')
    assert.equal(audit?.verdict, 'unverified')
    assert.equal(audit?.actual, null)
    assert.deepEqual(audit?.declared, ROUTE_A)
  } finally {
    fixture.cleanup()
  }
})

test('审计：复用成员同样按会话真实路由审计（verdict=ok）', async () => {
  const role = makeRole(ROUTE_A)
  const fixture = reuseFixture({
    role,
    audits: [{ taskId: 't1', roleId: 'dev', declared: ROUTE_A, actual: ROUTE_A, at: NOW, verdict: 'ok' }],
    memberRouteFor: (sessionId) => (sessionId === 'm-dev' ? ROUTE_A : ROUTE_A),
    callerRoute: () => ROUTE_A,
  })
  try {
    const result = await dispatchReady(fixture.state, fixture.deps)
    assert.equal(fixture.spawned.length, 0, '上一任务声明/实际都一致时允许复用')
    const audit = result.state.routeAudits.find((item) => item.taskId === 't2')
    assert.ok(audit, '复用路径必须留下本任务的审计')
    assert.deepEqual(audit.actual, ROUTE_A)
    assert.equal(audit.verdict, 'ok')
  } finally {
    fixture.cleanup()
  }
})
