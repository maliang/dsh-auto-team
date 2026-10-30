/**
 * T4 接口与动作层单测（bridge / tools / http）。
 *
 * 覆盖点与 PRD/TECHNICAL 的对应关系：
 *  - AC-12 反面：开关关闭时**除 toggle 外所有动作**必须被拒（不能静默不干活），且快照仍可读；
 *  - TECH §4.2 line 503/504：无计划 → NO_PLAN；已派发再派发 → PLAN_ALREADY_DISPATCHED 且**不重复建成员**；
 *  - AC-19：门禁通过/失败/无验收命令三条分支；返工证据回发同一 memberId；门禁串行不交错；
 *  - D7：GET /memory 先读正文（readMemoryFile），非法文件名被拒；
 *  - AC-30 机械保证：auto_team_plan 不建成员，auto_team_dispatch 强制 runId。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MemberBinding, PanelAction, Plan, PlanTask, Role } from '../src/shared/types.ts'
import { createBridge, type Bridge, type BridgeDeps, type ReceiptInput } from '../src/host/bridge.ts'
import { buildHttpRoutes } from '../src/host/http.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { NOT_ENABLED_MESSAGE, buildToolSpecs, sessionOf } from '../src/host/tools.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-t4'

interface Calls {
  dispatch: number
  resume: number
  receipts: Array<{ taskId: string; receipt: ReceiptInput }>
  sent: Array<{ memberId: string; text: string }>
}

interface Harness {
  dir: string
  store: RunsStore
  roles: ReturnType<typeof createRoleRepo>
  bridge: Bridge
  deps: BridgeDeps
  calls: Calls
}

function roleOf(id: string, name: string): Role {
  return { id, name, duty: `${name}的职责`, skillIds: [], builtin: false, updatedAt: NOW }
}

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: 'exit 0', status: 'pending', ...over }
}

function bindingOf(over: Partial<MemberBinding> = {}): MemberBinding {
  return { taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW + 1000, ...over }
}

function planOf(over: Partial<Plan> = {}): Plan {
  return { runId: 'run-t4', sessionId: SESSION, createdAt: NOW, status: 'draft', tasks: [taskOf('t1')], maxConcurrent: 3, ...over }
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return { version: RUN_STATE_VERSION, plan: planOf(), plannedAt: NOW, messages: [], bindings: [], routeAudits: [], ...over }
}

function setup(overrides: Partial<BridgeDeps> = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-t4-'))
  const store = new RunsStore(join(dir, 'runs'))
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir, now: () => NOW })
  roles.seed()
  roles.save(roleOf('dev', '开发'))
  roles.save(roleOf('qa', '测试'))
  const artifactsDir = join(dir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })

  const calls: Calls = { dispatch: 0, resume: 0, receipts: [], sent: [] }

  const deps: BridgeDeps = {
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    // 模拟真实编排层：就绪任务转 running 并落 binding —— 第二次派发才有幂等判据可验。
    dispatch: async (state) => {
      calls.dispatch += 1
      const tasks: PlanTask[] = state.plan.tasks.map((task) =>
        task.status === 'pending' ? { ...task, status: 'running', memberId: 'member-1' } : task,
      )
      const bindings: MemberBinding[] = state.bindings.length > 0 ? state.bindings : [bindingOf()]
      store.save({ ...state, plan: { ...state.plan, status: 'dispatching', tasks }, bindings })
      return { started: ['t1'], skipped: [], errors: [] }
    },
    resume: async () => {
      calls.resume += 1
      return { resumed: 1, skipped: 0, unchanged: false }
    },
    applyReceipt: (state, taskId, receipt) => {
      calls.receipts.push({ taskId, receipt })
      const tasks: PlanTask[] = state.plan.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: receipt.verdict === 'done' ? 'done' : 'rework', evidence: receipt.evidence }
          : task,
      )
      return { ...state, plan: { ...state.plan, tasks } }
    },
    sendMessage: async (memberId, text) => {
      calls.sent.push({ memberId, text })
      return { ok: true }
    },
    gate: { cwd: dir, artifactsDir },
    now: () => NOW,
    ...overrides,
  }

  return { dir, store, roles, bridge: createBridge(deps), deps, calls }
}

async function enable(bridge: Bridge): Promise<void> {
  const result = await bridge.act(SESSION, { type: 'toggle', enabled: true })
  assert.equal(result.rejected, undefined, '启用动作本身不应被拒')
}

test('未启用时除 toggle 外全部动作被拒 NOT_ENABLED，快照仍可读', async () => {
  const { bridge } = setup()
  const actions: PanelAction[] = [
    { type: 'dispatch' },
    { type: 'cancel' },
    { type: 'setTaskRole', taskId: 't1', roleId: 'dev' },
    { type: 'message', text: '在吗' },
    { type: 'resume' },
    { type: 'receipt', taskId: 't1' },
    { type: 'saveMemory', track: 'public', name: 'conv', body: '- a' },
    { type: 'deleteMemory', track: 'public', name: 'conv' },
    { type: 'saveRole', role: roleOf('dev', '开发') },
    { type: 'deleteRole', roleId: 'dev' },
  ]
  for (const action of actions) {
    const result = await bridge.act(SESSION, action)
    assert.equal(result.rejected?.code, 'NOT_ENABLED', `${action.type} 未启用时必须被拒`)
    assert.equal(result.snapshot.enabled, false, '被拒时仍要返回可读快照')
  }
})

test('toggle 只改开关：按会话持久化、绝不派发成员', async () => {
  const { bridge, deps, calls } = setup()
  await enable(bridge)
  assert.equal(bridge.enabled(SESSION), true)
  assert.equal(calls.dispatch, 0, '开关不能触发派发')

  const reopened = createBridge(deps)
  assert.equal(reopened.enabled(SESSION), true, '开关必须落盘（重启后保留）')
  assert.equal(reopened.enabled('other-session'), false, '开关按会话隔离')
})

test('无计划时动作被拒 NO_PLAN', async () => {
  const { bridge } = setup()
  await enable(bridge)
  const actions: PanelAction[] = [
    { type: 'dispatch' },
    { type: 'cancel' },
    { type: 'setTaskRole', taskId: 't1', roleId: 'dev' },
    { type: 'message', text: '在吗' },
    { type: 'resume' },
    { type: 'receipt', taskId: 't1' },
  ]
  for (const action of actions) {
    const result = await bridge.act(SESSION, action)
    assert.equal(result.rejected?.code, 'NO_PLAN', `${action.type} 无计划时必须 NO_PLAN`)
  }
})

test('派发：首次创建成员，二次幂等拒绝且不重复建人', async () => {
  const { bridge, store, calls } = setup()
  await enable(bridge)
  store.save(stateOf())

  const first = await bridge.act(SESSION, { type: 'dispatch' })
  assert.equal(first.rejected, undefined)
  assert.equal(calls.dispatch, 1)
  assert.equal(first.snapshot.planStatus, 'dispatching')
  assert.equal(first.snapshot.members.length, 1)
  assert.equal(first.snapshot.members[0].name, '开发-1')
  assert.ok((first.snapshot.plannedAt ?? 0) <= NOW, '计划时间戳必须存在（AC-30）')

  const second = await bridge.act(SESSION, { type: 'dispatch' })
  assert.equal(second.rejected?.code, 'PLAN_ALREADY_DISPATCHED')
  assert.equal(calls.dispatch, 1, '幂等：不再调用派发端口')
  assert.equal(second.snapshot.members.length, 1, '幂等：不重复建成员')
})

test('派发带错的 runId → NOT_FOUND；未知动作 → BAD_REQUEST', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(stateOf())

  const wrongRun = await bridge.act(SESSION, { type: 'dispatch', runId: 'run-other' })
  assert.equal(wrongRun.rejected?.code, 'NOT_FOUND')

  const unknown = await bridge.act(SESSION, { type: 'explode' } as unknown as PanelAction)
  assert.equal(unknown.rejected?.code, 'BAD_REQUEST')
})

test('setTaskRole：派发前可替换角色，派发后拒 BAD_REQUEST', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(stateOf())

  const ok = await bridge.act(SESSION, { type: 'setTaskRole', taskId: 't1', roleId: 'qa' })
  assert.equal(ok.rejected, undefined)
  assert.equal(ok.snapshot.tasks[0].roleId, 'qa')

  const missingRole = await bridge.act(SESSION, { type: 'setTaskRole', taskId: 't1', roleId: 'nope' })
  assert.equal(missingRole.rejected?.code, 'NOT_FOUND')

  store.save(
    stateOf({
      plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'running', memberId: 'member-1' })] }),
      bindings: [bindingOf()],
    }),
  )
  const late = await bridge.act(SESSION, { type: 'setTaskRole', taskId: 't1', roleId: 'dev' })
  assert.equal(late.rejected?.code, 'BAD_REQUEST')
})

test('message：无成员 NOT_FOUND；有成员则落账本（AC-16 可核验字段）', async () => {
  const { bridge, store, calls } = setup()
  await enable(bridge)
  store.save(stateOf())

  const noMember = await bridge.act(SESSION, { type: 'message', taskId: 't1', text: '在吗' })
  assert.equal(noMember.rejected?.code, 'NOT_FOUND')

  store.save(
    stateOf({
      plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'running', memberId: 'member-1' })] }),
      bindings: [bindingOf()],
    }),
  )
  const sent = await bridge.act(SESSION, { type: 'message', taskId: 't1', text: '请先跑一次测试' })
  assert.equal(sent.rejected, undefined)
  assert.deepEqual(calls.sent, [{ memberId: 'member-1', text: '请先跑一次测试' }])

  const record = sent.snapshot.messages.at(-1)
  assert.equal(record?.from, 'captain')
  assert.equal(record?.to, '开发-1')
  assert.equal(record?.toMemberId, 'member-1')
  assert.equal(record?.taskId, 't1')
  assert.equal(record?.at, NOW)
  assert.equal(record?.body, '请先跑一次测试')
})

test('message：宿主无 caller 时拒绝码透传 NO_CALLER', async () => {
  const { bridge, store } = setup({
    sendMessage: async () => ({ ok: false, error: '没有可用的会话发起者', code: 'NO_CALLER' }),
  })
  await enable(bridge)
  store.save(
    stateOf({
      plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'running', memberId: 'member-1' })] }),
      bindings: [bindingOf()],
    }),
  )
  const result = await bridge.act(SESSION, { type: 'message', taskId: 't1', text: '在吗' })
  assert.equal(result.rejected?.code, 'NO_CALLER')
  assert.equal(result.snapshot.messages.length, 0, '发送失败不记账')
})

test('receipt：门禁通过 → 任务 done 并落全量日志（AC-19 主链路）', async () => {
  const { bridge, store, calls, dir } = setup()
  await enable(bridge)
  store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [taskOf('t1', { status: 'running', memberId: 'member-1', acceptance: 'exit 0' })],
      }),
      bindings: [bindingOf()],
    }),
  )

  const result = await bridge.act(SESSION, { type: 'receipt', taskId: 't1', note: '已完成' })
  assert.equal(result.rejected, undefined)
  const task = result.snapshot.tasks[0]
  assert.equal(task.status, 'done')
  assert.equal(task.evidence?.exitCode, 0)
  assert.equal(task.evidence?.command, 'exit 0')
  assert.equal(calls.receipts.length, 1)
  assert.equal(calls.receipts[0].receipt.verdict, 'done')
  assert.ok(existsSync(join(dir, 'artifacts', 't1.log')), '门禁全量日志必须落盘')
  assert.match(readFileSync(join(dir, 'artifacts', 't1.log'), 'utf8'), /exit 0/)
})

test('receipt：门禁失败 → 转返工并把证据回发给同一成员（AC-19）', async () => {
  const { bridge, store, calls } = setup()
  await enable(bridge)
  store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [
          taskOf('t1', { status: 'running', memberId: 'member-1', acceptance: 'echo 缺少测试 && exit 3' }),
          taskOf('t2', { dependsOn: ['t1'] }),
        ],
      }),
      bindings: [bindingOf()],
    }),
  )

  const result = await bridge.act(SESSION, { type: 'receipt', taskId: 't1' })
  assert.equal(result.rejected, undefined)
  const t1 = result.snapshot.tasks.find((task) => task.id === 't1')
  assert.equal(t1?.status, 'rework')
  assert.equal(t1?.evidence?.exitCode, 3)
  assert.equal(calls.receipts[0].receipt.verdict, 'rework')

  assert.equal(calls.sent.length, 1, '证据必须回发给同一成员')
  assert.equal(calls.sent[0].memberId, 'member-1')
  assert.match(calls.sent[0].text, /门禁未通过/)
  assert.match(calls.sent[0].text, /缺少测试/)

  const t2 = result.snapshot.tasks.find((task) => task.id === 't2')
  assert.ok(t2 !== undefined && t2.status !== 'done' && t2.status !== 'running', '下游任务不得被放行')
})

test('receipt：acceptance 为空 → GATE_FAILED 且任务状态回滚', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [taskOf('t1', { status: 'running', memberId: 'member-1', acceptance: '' })],
      }),
      bindings: [bindingOf()],
    }),
  )

  const result = await bridge.act(SESSION, { type: 'receipt', taskId: 't1' })
  assert.equal(result.rejected?.code, 'GATE_FAILED')
  assert.match(result.rejected?.message ?? '', /没有验收命令/)
  assert.equal(result.snapshot.tasks[0].status, 'running', '不能卡在 gate 状态')
})

test('门禁串行队列：两个回执并发执行不交错', async () => {
  const { bridge, store, dir } = setup()
  await enable(bridge)
  const marker = join(dir, 'gate-order.txt')
  const command = (id: string): string =>
    `echo start-${id} >> '${marker}'; sleep 0.2; echo end-${id} >> '${marker}'`
  store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [
          taskOf('t1', { status: 'running', memberId: 'member-1', acceptance: command('t1') }),
          taskOf('t2', { status: 'running', memberId: 'member-2', acceptance: command('t2') }),
        ],
      }),
      bindings: [bindingOf(), bindingOf({ taskId: 't2', memberId: 'member-2', name: '开发-2' })],
    }),
  )

  const [first, second] = await Promise.all([
    bridge.act(SESSION, { type: 'receipt', taskId: 't1' }),
    bridge.act(SESSION, { type: 'receipt', taskId: 't2' }),
  ])
  assert.equal(first.rejected, undefined)
  assert.equal(second.rejected, undefined)

  const lines = readFileSync(marker, 'utf8').trim().split('\n')
  assert.deepEqual(lines, ['start-t1', 'end-t1', 'start-t2', 'end-t2'], '门禁必须串行，不能交错执行')
})

test('readMemoryFile：非法文件名被拒，正常名读回正文（D7 先读后写）', async () => {
  const { bridge } = setup()
  await enable(bridge)

  const bad = await bridge.readMemoryFile('public', '../etc/passwd')
  assert.equal(bad.error, '非法文件名')

  const saved = await bridge.act(SESSION, {
    type: 'saveMemory',
    track: 'public',
    name: 'conventions',
    body: '- 提交前跑 typecheck',
  })
  assert.equal(saved.rejected, undefined)

  const read = await bridge.readMemoryFile('public', 'conventions')
  assert.equal(read.error, undefined)
  assert.equal(read.data?.name, 'conventions.md')
  assert.match(read.data?.body ?? '', /提交前跑 typecheck/)
  assert.equal(read.data?.chars, (read.data?.body ?? '').length)

  const missing = await bridge.readMemoryFile('public', 'not-exist')
  assert.match(missing.error ?? '', /记忆文件不存在/)
})

test('记忆与角色写入：非法名/未知角色分别被拒，正常路径生效', async () => {
  const { bridge, roles } = setup()
  await enable(bridge)

  const badName = await bridge.act(SESSION, { type: 'saveMemory', track: 'public', name: '../x', body: '- a' })
  assert.equal(badName.rejected?.code, 'BAD_REQUEST')

  const badTrack = await bridge.act(SESSION, {
    type: 'saveMemory',
    track: 'nope' as unknown as 'public',
    name: 'a',
    body: '- a',
  })
  assert.equal(badTrack.rejected?.code, 'BAD_REQUEST')

  const savedRole = await bridge.act(SESSION, {
    type: 'saveRole',
    role: { ...roleOf('custom-checker', '自定义检查'), model: { provider: 'deepseek', model: 'v4' } },
  })
  assert.equal(savedRole.rejected, undefined)
  assert.equal(roles.get('custom-checker')?.model?.model, 'v4')

  const removedRole = await bridge.act(SESSION, { type: 'deleteRole', roleId: 'custom-checker' })
  assert.equal(removedRole.rejected, undefined)
  assert.equal(roles.get('custom-checker'), undefined)

  const missingRole = await bridge.act(SESSION, { type: 'deleteRole', roleId: 'ghost' })
  assert.equal(missingRole.rejected?.code, 'NOT_FOUND')

  // 内置角色可改不可删（否则面板能把团队预置角色删光）
  const builtinDelete = await bridge.act(SESSION, { type: 'deleteRole', roleId: 'reviewer' })
  assert.equal(builtinDelete.rejected?.code, 'BAD_REQUEST')
  assert.match(builtinDelete.rejected?.message ?? '', /内置角色不可删除/)
})

test('http：三条路由 + GET /memory 校验 + {data} 包装', async () => {
  const { bridge, store } = setup()
  await enable(bridge)

  const routes = buildHttpRoutes({ bridge, defaultSessionId: () => SESSION })
  assert.deepEqual(
    routes.map((route) => `${route.method} ${route.path}`),
    ['GET /api/auto-team/snapshot', 'GET /api/auto-team/memory', 'POST /api/auto-team/act'],
  )

  const get = (url: string): { method: string; pathname: string; url: string; json: () => Promise<unknown> } => ({
    method: 'GET',
    pathname: url.split('?')[0],
    url,
    json: async () => ({}),
  })

  const snapshot = (await routes[0].handle(get(`/api/auto-team/snapshot?sessionId=${SESSION}`))) as {
    data?: { enabled?: boolean; messages?: unknown[] }
  }
  assert.equal(snapshot.data?.enabled, true)
  assert.deepEqual(snapshot.data?.messages, [])

  const badName = (await routes[1].handle(get('/api/auto-team/memory?track=public&name=..%2Fx'))) as {
    error?: string
  }
  assert.equal(badName.error, '非法文件名')

  const badTrack = (await routes[1].handle(get('/api/auto-team/memory?track=nope&name=a'))) as { error?: string }
  assert.equal(badTrack.error, 'track 必须是 public 或 project')

  const acted = (await routes[2].handle({
    method: 'POST',
    pathname: '/api/auto-team/act',
    url: '/api/auto-team/act',
    json: async () => ({ sessionId: SESSION, action: { type: 'dispatch' } }),
  })) as { data?: { rejected?: { code?: string }; snapshot?: { enabled?: boolean } } }
  assert.equal(acted.data?.rejected?.code, 'NO_PLAN', '业务拒绝放在 data.rejected，HTTP 仍 200')
  assert.equal(acted.data?.snapshot?.enabled, true)

  const badJson = (await routes[2].handle({
    method: 'POST',
    pathname: '/api/auto-team/act',
    url: '/api/auto-team/act',
    json: async () => {
      throw new Error('bad json')
    },
  })) as { error?: string }
  assert.equal(badJson.error, '请求体不是合法 JSON')

  store.save(stateOf())
})

test('tools：7 个工具、未启用统一文案、dispatch 强制 runId（AC-30）', async () => {
  const { bridge, store, roles } = setup()
  const specs = buildToolSpecs({ store, roles, bridge, now: () => NOW })

  assert.equal(specs.length, 7)
  assert.deepEqual(
    specs.map((spec) => spec.name),
    [
      'auto_team_plan',
      'auto_team_dispatch',
      'auto_team_status',
      'auto_team_message',
      'auto_team_receipt',
      'auto_team_memory',
      'auto_team_role',
    ],
  )
  assert.equal(sessionOf({ sessionId: SESSION }), SESSION)
  assert.equal(sessionOf(undefined), 'current')

  const meta = { sessionId: SESSION }
  for (const spec of specs) {
    const result = (await spec.handler({}, meta)) as { ok?: boolean; error?: string }
    assert.equal(result.ok, false, `${spec.name} 未启用时必须 ok:false`)
    assert.equal(result.error, NOT_ENABLED_MESSAGE, `${spec.name} 未启用文案必须统一`)
  }

  await enable(bridge)
  const tool = (name: string) => specs.find((spec) => spec.name === name)!

  const noRunId = (await tool('auto_team_dispatch').handler({}, meta)) as { ok?: boolean; error?: string }
  assert.equal(noRunId.ok, false)
  assert.match(noRunId.error ?? '', /必须带 runId/)

  const planned = (await tool('auto_team_plan').handler(
    { goal: '做完 T4', tasks: [{ id: 't1', title: '实现', roleId: 'dev', acceptance: 'exit 0' }] },
    meta,
  )) as { ok?: boolean; runId?: string; members?: number; ready?: string[] }
  assert.equal(planned.ok, true)
  assert.equal(planned.members, 0, '计划阶段不得创建成员（AC-30）')
  assert.deepEqual(planned.ready, ['t1'])
  assert.equal(store.load(planned.runId ?? '')?.bindings.length, 0)

  const dispatched = (await tool('auto_team_dispatch').handler({ runId: planned.runId }, meta)) as {
    ok?: boolean
    members?: unknown[]
    planStatus?: string
  }
  assert.equal(dispatched.ok, true)
  assert.equal(dispatched.planStatus, 'dispatching')
  assert.equal(dispatched.members?.length, 1)

  const status = (await tool('auto_team_status').handler({}, meta)) as { ok?: boolean; progress?: { total?: number } }
  assert.equal(status.ok, true)
  assert.equal(status.progress?.total, 1)
})

test('snapshot 契约：plannedAt / concurrency 三元组 / messages / routeAudits', async () => {
  const { bridge, store } = setup({ hostConcurrency: () => ({ limit: 5, source: 'host' }) })
  await enable(bridge)
  store.save(
    stateOf({
      plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'running', memberId: 'member-1' })] }),
      bindings: [bindingOf()],
    }),
  )

  const snapshot = bridge.snapshot(SESSION)
  assert.equal(snapshot.enabled, true)
  assert.equal(snapshot.plannedAt, NOW)
  assert.deepEqual(snapshot.concurrency, { limit: 3, running: 1, source: 'host' })
  assert.deepEqual(snapshot.messages, [])
  assert.deepEqual(snapshot.routeAudits, [])
  assert.equal(snapshot.members.length, 1)
  assert.equal(snapshot.members[0].status, 'running')
  assert.equal(snapshot.members[0].taskId, 't1')
})
