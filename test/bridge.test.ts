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

import type { MemberBinding, MessageRecord, PanelAction, Plan, PlanTask, Role } from '../src/shared/types.ts'
import { createBridge, type Bridge, type BridgeDeps, type ReceiptInput } from '../src/host/bridge.ts'
import { buildHttpRoutes } from '../src/host/http.ts'
import { BUILTIN_ROLES } from '../src/host/roles/builtin.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { createSettingsRepo } from '../src/host/settings.ts'
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
  assert.equal(badTrack.error, 'track 必须是 public、project 或 skill')

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
  // R2：计划上限（3）小于宿主给的（5）→ 实际生效 3，但用户一侧的意图 5 必须保留并可解释。
  assert.deepEqual(snapshot.concurrency, { limit: 3, running: 1, source: 'host', requested: 5, clamped: true })
  assert.deepEqual(snapshot.messages, [])
  assert.deepEqual(snapshot.routeAudits, [])
  assert.equal(snapshot.members.length, 1)
  assert.equal(snapshot.members[0].status, 'running')
  assert.equal(snapshot.members[0].taskId, 't1')
})

/* ─────────────── r4 第一期：停滞三字段 / activity 合并 / peer 交接实发 ─────────────── */

/** peer 交接的账本条目（messageId 是 AC-5 的幂等键：`handoff:<上游>-><下游>`）。 */
function peerMessageOf(over: Partial<MessageRecord> = {}): MessageRecord {
  return {
    at: NOW,
    from: 'peer',
    to: '测试-2',
    toMemberId: 'member-2',
    taskId: 't2',
    body: '【上游直投】t1 任务 t1 已通过门禁\n命令：exit 0\n退出码：0\n无落盘产物',
    messageId: 'handoff:t1->t2',
    ...over,
  }
}

/** 模拟 dispatch.applyReceipt 的 done 分支：落 done + 追加一条 peer 交接（同 id 不重复追加）。 */
function receiptWithPeer(state: RunState, taskId: string, receipt: ReceiptInput): RunState {
  const tasks = state.plan.tasks.map((task) =>
    task.id === taskId ? { ...task, status: 'done' as const, evidence: receipt.evidence } : task,
  )
  const peer = peerMessageOf()
  const exists = state.messages.some((message) => message.messageId === peer.messageId)
  return {
    ...state,
    plan: { ...state.plan, tasks },
    messages: exists ? state.messages : [...state.messages, peer],
  }
}

test('membersOf：running 且进度落后 → stalled 三字段齐；终态成员恒 false（AC-14 数据源）', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [
          taskOf('t1', { status: 'running', memberId: 'member-1' }),
          taskOf('t2', { status: 'done', memberId: 'member-2' }),
        ],
      }),
      bindings: [bindingOf(), bindingOf({ taskId: 't2', memberId: 'member-2', name: '开发-2' })],
      // member-1 最后一次实质调用在 100 秒前（阈值 90 秒）；member-2 早完成，不该被判停滞。
      progress: { 'member-1': { at: NOW - 100_000 }, 'member-2': { at: NOW - 600_000 } },
    }),
  )

  const members = bridge.snapshot(SESSION).members
  const running = members.find((member) => member.memberId === 'member-1')
  assert.equal(running?.stalled, true)
  assert.equal(running?.stalledForMs, 100_000, '毫秒数由宿主算好，客户端零阈值比较')
  assert.match(running?.stalledSecondsText ?? '', /秒/, '秒数文案由宿主下发，客户端零格式化')

  const finished = members.find((member) => member.memberId === 'member-2')
  assert.equal(finished?.stalled, false, 'done 的成员不再产出，不算停滞')
  assert.equal(finished?.stalledForMs, 0)
  assert.equal(finished?.stalledSecondsText, '')
})

test('activityOf：只读合并落盘的 stallAlerts，同一次停滞不得被重算出第二条（AC-8）', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  const alert = {
    at: NOW,
    kind: 'tool' as const,
    memberId: 'member-1',
    taskId: 't1',
    text: '开发-1 已 100 秒无实质工具调用，疑似停滞',
  }
  store.save(
    stateOf({
      plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'running', memberId: 'member-1' })] }),
      bindings: [bindingOf()],
      progress: { 'member-1': { at: NOW - 100_000, alertedAt: NOW } },
      stallAlerts: [alert],
    }),
  )

  const toolEvents = bridge.snapshot(SESSION).activity.filter((event) => event.kind === 'tool')
  assert.equal(toolEvents.length, 1, '快照只读合并，不得按当前进度再算一条')
  assert.equal(toolEvents[0].text, alert.text)
  assert.equal(toolEvents[0].memberId, 'member-1')
})

test('receipt：done 后新增 peer 交接 → 按 toMemberId 实发，且不补 captain 转述（AC-4a/AC-3）', async () => {
  const { bridge, store, calls } = setup({ applyReceipt: receiptWithPeer })
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

  const result = await bridge.act(SESSION, { type: 'receipt', taskId: 't1' })
  assert.equal(result.rejected, undefined)

  const peerSent = calls.sent.filter((item) => item.memberId === 'member-2')
  assert.equal(peerSent.length, 1, '下游成员已存在时必须实发（body 与账本同源）')
  assert.match(peerSent[0].text, /【上游直投】/)
  assert.equal(peerSent[0].text, peerMessageOf().body, '实发正文必须与账本条目逐字一致')

  assert.equal(result.snapshot.messages.filter((m) => m.from === 'peer').length, 1)
  assert.equal(result.snapshot.messages.filter((m) => m.from === 'captain').length, 0, '不得补 captain 转述消息')
  assert.ok(result.notices?.some((notice) => notice.includes('上游交接已直投')), '实发结果必须可观测')
})

test('receipt：peer 实发失败只给 notice，不补 captain、不重复落账；重放不重发（AC-3/AC-5 发送侧）', async () => {
  const { bridge, store, calls } = setup({
    applyReceipt: receiptWithPeer,
    sendMessage: async (memberId: string, text: string) => {
      calls.sent.push({ memberId, text })
      return { ok: false, error: '成员不在' }
    },
  })
  await enable(bridge)

  const seeded = stateOf({
    plan: planOf({
      status: 'dispatching',
      tasks: [taskOf('t1', { status: 'running', memberId: 'member-1', acceptance: 'exit 0' })],
    }),
    bindings: [bindingOf()],
  })
  store.save(seeded)

  const result = await bridge.act(SESSION, { type: 'receipt', taskId: 't1' })
  assert.equal(result.rejected, undefined)
  assert.equal(calls.sent.length, 1, '失败也要尝试一次，失败本身不能静默')
  assert.equal(result.snapshot.messages.filter((m) => m.from === 'peer').length, 1, '失败也只留一条账本记录')
  assert.equal(result.snapshot.messages.filter((m) => m.from === 'captain').length, 0, '不得补 captain 转述消息')
  assert.ok(
    result.notices?.some((notice) => notice.includes('失败') && notice.includes('成员不在')),
    '失败原因必须进 notice',
  )

  // 重放：peer 条目已在账本里 → 本次没有「新增」，不得再发一遍（AC-5 的发送侧）。
  const replay = setup({ applyReceipt: receiptWithPeer })
  await enable(replay.bridge)
  replay.store.save({
    ...seeded,
    messages: [peerMessageOf()],
  })
  const replayResult = await replay.bridge.act(SESSION, { type: 'receipt', taskId: 't1' })
  assert.equal(replayResult.rejected, undefined)
  assert.equal(replay.calls.sent.length, 0, '同一 (A,B) 不重复实发')
  assert.equal(replayResult.snapshot.messages.filter((m) => m.from === 'peer').length, 1)
})

// ---------- r7：设置生效与恢复默认角色（T2 新增动作） ----------

test('saveSettings：合法提交落盘并立刻反映在快照（含队长模型），回调被调用一次', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'auto-team-settings-')), 'settings.json')
  const seen: number[] = []
  const { bridge } = setup({
    settingsRepo: createSettingsRepo({ file, now: () => NOW }),
    onSettingsSaved: (settings) => {
      seen.push(settings.concurrencyLimit)
    },
  })
  await enable(bridge)

  const before = bridge.snapshot(SESSION)
  assert.equal(before.settings?.concurrencyLimit, 3, '未保存前快照回落的必须是 config 缺省值（AC-11 冻结）')
  assert.ok((before.skills?.length ?? 0) >= 1, '快照必须带技能只读投影')
  assert.equal(before.skills?.[0]?.id !== undefined, true, '技能项必须有 id（设置页勾选要用）')

  const result = await bridge.act(SESSION, {
    type: 'saveSettings',
    settings: { concurrencyLimit: 2, memoryBudget: 1200, stallMs: 30_000, maxAttempts: 2, gateTimeoutMs: 60_000 },
  })
  assert.equal(result.rejected, undefined, '合法设置必须保存成功')
  assert.equal(result.snapshot.settings?.memoryBudget, 1200, '快照必须立刻用新设置（不需重启）')
  assert.equal(result.snapshot.memory.budget, 1200, '记忆预算的投影与设置同源（不能一处新一处旧）')
  assert.deepEqual(seen, [2], '保存后必须回调一次重生效（队长路由 + watcher 重建）')
  assert.ok(existsSync(file), '设置必须真的落盘')
  assert.ok(
    result.notices?.some((notice) => notice.includes('队长模型')),
    'notice 要说清队长模型当前取自哪里（设置页/迁移回落/跟随默认）',
  )
})

test('saveSettings：非法提交 → BAD_REQUEST，磁盘一字不改，回调不触发', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-settings-bad-'))
  const file = join(dir, 'settings.json')
  let calls = 0
  const { bridge } = setup({
    settingsRepo: createSettingsRepo({ file, now: () => NOW }),
    onSettingsSaved: () => {
      calls += 1
    },
  })
  await enable(bridge)

  // 先存一份合法的，再提交非法的：判据是「文件字节完全相同」（不是「文件还在」）。
  const ok = await bridge.act(SESSION, { type: 'saveSettings', settings: { concurrencyLimit: 4 } })
  assert.equal(ok.rejected, undefined)
  calls = 0
  const bytes = readFileSync(file, 'utf8')

  const bad = await bridge.act(SESSION, { type: 'saveSettings', settings: { concurrencyLimit: 99 } })
  assert.equal(bad.rejected?.code, 'BAD_REQUEST', '越界设置必须被拒（不是夹到边界值）')
  assert.match(bad.rejected!.message, /并发上限/, '拒绝文案要点名是哪一项')
  assert.equal(readFileSync(file, 'utf8'), bytes, '非法提交时磁盘必须一字不改（AC-17）')
  assert.equal(calls, 0, '没保存成功就不许触发重生效回调')

  assert.equal(bridge.snapshot(SESSION).settings?.concurrencyLimit, 4, '快照仍显示上一次生效的值')
})

test('restoreDefaultRoles：只重写 6 个内置角色，自建角色一字不动（AC-8）', async () => {
  const harness = setup()
  const { bridge, roles } = harness
  // setup 把角色库建在 `<tmp>/roles`（与 test 里 createRoleRepo 的参数一致）。
  const rolesDir = join(harness.dir, 'roles')
  await enable(bridge)

  // 把内置 dev 改坏（duty/prompt/技能全变），再建一个自建角色。
  roles.save({ id: 'dev', name: '被改坏的开发', duty: '随便写写', skillIds: [], builtin: false, updatedAt: NOW, prompt: '坏了' })
  roles.save(roleOf('custom', '自建角色'))
  const customBefore = readFileSync(join(rolesDir, 'custom.json'), 'utf8')

  const result = await bridge.act(SESSION, { type: 'restoreDefaultRoles' })
  assert.equal(result.rejected, undefined, '恢复默认必须成功')
  const builtinDev = result.snapshot.roles.find((role) => role.id === 'dev')
  const pristine = BUILTIN_ROLES.find((role) => role.id === 'dev')!
  assert.equal(builtinDev?.name, pristine.name, '内置角色必须逐字回到内置值')
  assert.equal(builtinDev?.duty, pristine.duty)
  assert.equal(builtinDev?.prompt, pristine.prompt, '提示词也要恢复（AC-7 的字段之一）')
  assert.deepEqual(builtinDev?.skillIds, pristine.skillIds, '技能必须恢复')
  assert.equal(builtinDev?.builtin, true, '恢复后的内置角色必须重新带 builtin 标志')
  assert.ok(
    result.notices?.some((notice) => notice.includes('未受影响')),
    'notice 必须说清自建角色没被动',
  )
  assert.equal(readFileSync(join(rolesDir, 'custom.json'), 'utf8'), customBefore, '自建角色文件字节不变')
})

/* ───────────────── r10：技能四来源 / 模型清单 / 系统技能（T2 装配层的新能力） ───────────────── */

interface FakeSkillRecord {
  id: string
  title: string
  description: string
  body: string
  source: 'builtin' | 'imported' | 'system' | 'manual'
  modified: boolean
  updatedAt: number
}

interface FakeSkills {
  repo: NonNullable<BridgeDeps['skills']>
  records: Map<string, FakeSkillRecord>
  calls: { saved: string[]; removed: string[]; restored: string[]; restoreAll: number }
}

/**
 * 内存版技能仓储：只实现 bridge 真正用到的 9 个成员。
 * 落盘语义（frontmatter / seed 不覆盖 / modified 现算）由 `test/skills-repo.test.ts` 全量覆盖，
 * 这里测的是「桥有没有正确调用它、失败时有没有如实拒绝」。
 */
function fakeSkills(initial: FakeSkillRecord[] = []): FakeSkills {
  const records = new Map(initial.map((record) => [record.id, { ...record }]))
  const calls: FakeSkills['calls'] = { saved: [], removed: [], restored: [], restoreAll: 0 }
  const repo = {
    list: () => [...records.values()].map((record) => ({ ...record })),
    projection: () =>
      [...records.values()].map(({ id, title, description, source, modified }) => ({
        id,
        title,
        description,
        source,
        modified,
      })),
    get: (id: string) => records.get(id),
    readBody: (id: string) => {
      const record = records.get(id)
      return record === undefined ? { error: `找不到技能 ${id}` } : { data: record.body }
    },
    save: (draft: { id?: string; title: string; description: string; body: string; source: FakeSkillRecord['source'] }) => {
      const id = draft.id !== undefined && draft.id !== '' ? draft.id : 'generated'
      const record: FakeSkillRecord = {
        id,
        title: draft.title,
        description: draft.description,
        body: draft.body,
        source: draft.source,
        modified: draft.source === 'builtin',
        updatedAt: NOW,
      }
      records.set(id, record)
      calls.saved.push(id)
      return { data: record }
    },
    remove: (id: string) => {
      const record = records.get(id)
      if (record === undefined) return { error: `找不到技能 ${id}` }
      if (record.source === 'builtin') return { error: `内置技能不可删除：${id}` }
      records.delete(id)
      calls.removed.push(id)
      return { data: { id, title: record.title } }
    },
    restoreBuiltin: (id: string) => {
      const record = records.get(id)
      if (record === undefined) return { error: `找不到技能 ${id}` }
      calls.restored.push(id)
      const restored: FakeSkillRecord = { ...record, body: `出厂正文 ${id}`, modified: false }
      records.set(id, restored)
      return { data: restored }
    },
    restoreBuiltins: () => {
      calls.restoreAll += 1
      const restored = [...records.values()].filter((record) => record.source === 'builtin').map((record) => record.id)
      return { restored }
    },
    seed: () => undefined,
  }
  return { repo: repo as unknown as NonNullable<BridgeDeps['skills']>, records, calls }
}

function skillRecordOf(over: Partial<FakeSkillRecord> = {}): FakeSkillRecord {
  return { id: 'custom-x', title: '自定义技能', description: '一句话', body: '正文', source: 'manual', modified: false, updatedAt: NOW, ...over }
}

const fakeSystemSkills = {
  scan: () => ({
    skills: [{ name: 'pdf', description: 'PDF 处理', body: '系统技能库里的 PDF 正文', dir: '/tmp/skills/pdf' }],
  }),
} as unknown as NonNullable<BridgeDeps['systemSkills']>

test('r10：saveRole 可只提交技能变更（role 缺省），技能写入与 notice 成对', async () => {
  const skills = fakeSkills()
  const { bridge, roles } = setup({ skills: skills.repo })
  await enable(bridge)
  const before = roles.list().length

  const result = await bridge.act(SESSION, {
    type: 'saveRole',
    skills: [{ op: 'save', skill: { id: 'review', title: '代码审查', description: '审查要点', body: '# 审查', source: 'manual' } }],
  })
  assert.equal(result.rejected, undefined, `只提交技能变更必须被接受：${result.rejected?.message ?? ''}`)
  assert.deepEqual(skills.calls.saved, ['review'])
  assert.ok(result.notices?.some((notice) => notice.includes('已保存技能')), '必须回报技能已保存')
  assert.equal(roles.list().length, before, '只提交技能时不该动角色')
})

test('r10：删除技能同步摘除角色引用，并在 notice 里报出 N 个角色', async () => {
  const skills = fakeSkills([skillRecordOf()])
  const { bridge, roles } = setup({ skills: skills.repo })
  roles.save({ ...roleOf('qa2', '测试二号'), skillIds: ['custom-x', 'implementation'] })
  roles.save({ ...roleOf('qa3', '测试三号'), skillIds: ['custom-x'] })
  await enable(bridge)

  const result = await bridge.act(SESSION, { type: 'saveRole', skills: [{ op: 'delete', id: 'custom-x' }] })
  assert.equal(result.rejected, undefined)
  assert.deepEqual(skills.calls.removed, ['custom-x'])
  assert.ok(
    result.notices?.some((notice) => notice.includes('从 2 个角色摘除引用')),
    `notice 必须报出被摘除引用的角色数，实际 ${JSON.stringify(result.notices)}`,
  )
  assert.deepEqual(roles.get('qa2')?.skillIds, ['implementation'], '只摘掉被删的那个 id')
  assert.deepEqual(roles.get('qa3')?.skillIds, [])
})

test('r10：restoreBuiltin 只把正文恢复出厂并给 notice；角色引用不受影响', async () => {
  const skills = fakeSkills([skillRecordOf({ id: 'implementation', title: '实现', source: 'builtin', modified: true })])
  const { bridge, roles } = setup({ skills: skills.repo })
  roles.save({ ...roleOf('dev2', '开发二号'), skillIds: ['implementation'] })
  await enable(bridge)

  const result = await bridge.act(SESSION, { type: 'saveRole', skills: [{ op: 'restoreBuiltin', id: 'implementation' }] })
  assert.equal(result.rejected, undefined)
  assert.deepEqual(skills.calls.restored, ['implementation'])
  assert.ok(result.notices?.some((notice) => notice.includes('恢复为出厂正文')))
  assert.deepEqual(roles.get('dev2')?.skillIds, ['implementation'], '恢复出厂不是删除，引用必须保留')
})

test('r10：saveRole 既无角色也无技能 → BAD_REQUEST（不许静默 no-op）', async () => {
  const { bridge } = setup()
  await enable(bridge)
  const result = await bridge.act(SESSION, { type: 'saveRole' })
  assert.equal(result.rejected?.code, 'BAD_REQUEST')
  assert.match(result.rejected?.message ?? '', /角色或技能/)
})

test('r10：restoreDefaultRoles 连带把内置技能恢复出厂，三条 notice 顺序固定', async () => {
  const skills = fakeSkills([
    skillRecordOf({ id: 'implementation', title: '实现', source: 'builtin', modified: true }),
    skillRecordOf({ id: 'my-own', title: '自建技能', source: 'manual' }),
  ])
  const { bridge, roles } = setup({ skills: skills.repo })
  roles.save(roleOf('custom', '自建角色'))
  await enable(bridge)

  const result = await bridge.act(SESSION, { type: 'restoreDefaultRoles' })
  assert.equal(result.rejected, undefined)
  assert.equal(skills.calls.restoreAll, 1, '必须真的调用 restoreBuiltins（连带恢复）')
  const notices = result.notices ?? []
  assert.equal(notices.length, 3, `恢复默认必须恰好 3 条 notice，实际 ${JSON.stringify(notices)}`)
  assert.match(notices[0] ?? '', /已恢复 \d+ 个内置角色/)
  assert.match(notices[1] ?? '', /已把 1 条内置技能恢复为出厂正文/)
  assert.match(notices[2] ?? '', /你的 1 条自建\/导入\/系统技能/)
  assert.match(notices[2] ?? '', /1 个自建角色未受影响/)
})

test('r10：GET /memory?track=skill 读技能正文（复用同一条正文通道，路由仍是 3 条）', async () => {
  const skills = fakeSkills([skillRecordOf({ id: 'review', title: '代码审查', body: '# 审查\n- 看边界' })])
  const { bridge } = setup({ skills: skills.repo })
  await enable(bridge)
  const routes = buildHttpRoutes({ bridge, defaultSessionId: () => SESSION })
  assert.equal(routes.length, 3, '技能正文不许新开路由')

  const get = (url: string): { method: string; pathname: string; url: string; json: () => Promise<unknown> } => ({
    method: 'GET',
    pathname: url.split('?')[0],
    url,
    json: async () => ({}),
  })

  const body = (await routes[1].handle(get('/api/auto-team/memory?track=skill&name=review'))) as {
    data?: { id?: string; title?: string; body?: string; chars?: number }
    error?: string
  }
  assert.equal(body.error, undefined)
  assert.equal(body.data?.title, '代码审查')
  assert.equal(body.data?.body, '# 审查\n- 看边界')
  assert.equal(body.data?.chars, '# 审查\n- 看边界'.length)

  const missing = (await routes[1].handle(get('/api/auto-team/memory?track=skill&name=ghost'))) as { error?: string }
  assert.match(missing.error ?? '', /找不到技能/)
})

test('r10：系统技能只下发 name/description，正文在保存时按 systemName 现读', async () => {
  const skills = fakeSkills()
  const { bridge } = setup({ skills: skills.repo, systemSkills: fakeSystemSkills })
  await enable(bridge)

  assert.deepEqual(bridge.snapshot(SESSION).systemSkills, [{ name: 'pdf', description: 'PDF 处理' }])

  const result = await bridge.act(SESSION, {
    type: 'saveRole',
    skills: [{ op: 'save', skill: { title: 'PDF 处理', description: '', body: '', source: 'system', systemName: 'pdf' } }],
  })
  assert.equal(result.rejected, undefined, result.rejected?.message)
  assert.equal(skills.records.get('generated')?.body, '系统技能库里的 PDF 正文', '正文必须由宿主现场读盘补上')
  assert.equal(skills.records.get('generated')?.description, 'PDF 处理', 'description 为空时取系统技能描述')

  const ghost = await bridge.act(SESSION, {
    type: 'saveRole',
    skills: [{ op: 'save', skill: { title: '幽灵', description: '', body: '', source: 'system', systemName: 'ghost' } }],
  })
  assert.equal(ghost.rejected?.code, 'BAD_REQUEST')
  assert.match(ghost.rejected?.message ?? '', /系统技能已不存在/)
})

test('r10：未装配技能仓储时明确拒绝（不假装保存成功），模型清单降级带原因', async () => {
  const { bridge } = setup()
  await enable(bridge)

  const read = await bridge.readSkillBody('implementation')
  assert.match(read.error ?? '', /技能仓储未装配/)

  const save = await bridge.act(SESSION, {
    type: 'saveRole',
    skills: [{ op: 'save', skill: { title: 'x', description: '', body: 'y', source: 'manual' } }],
  })
  assert.equal(save.rejected?.code, 'BAD_REQUEST')
  assert.match(save.rejected?.message ?? '', /技能仓储未装配/)

  const snapshot = bridge.snapshot(SESSION)
  assert.equal(snapshot.modelCatalog?.status, 'empty')
  assert.ok((snapshot.modelCatalog?.reason ?? '').length > 0, '没有模型清单必须给原因')
  assert.deepEqual(snapshot.systemSkills, [])
  assert.match(snapshot.systemSkillsReason ?? '', /未装配/, '系统技能库不可用时必须把原因带下去（r10 验收 R2）')
  assert.ok((snapshot.skills ?? []).length > 0, '没装配仓储时回退内置技能投影，列表不能凭空空掉')
  assert.ok((snapshot.skills ?? []).every((skill) => skill.source === 'builtin' && skill.modified === false))
})

test('r10：系统技能库「扫了但没有」与「库不存在」在快照上可分（reason 只在不可用时出现）', async () => {
  const ok = setup({ skills: fakeSkills().repo, systemSkills: fakeSystemSkills })
  await enable(ok.bridge)
  assert.equal(ok.bridge.snapshot(SESSION).systemSkillsReason, undefined, '库可用时不许编造原因')

  const broken = {
    scan: () => ({ skills: [], reason: '本机没有系统技能库（/tmp/none 不存在）' }),
  } as unknown as NonNullable<BridgeDeps['systemSkills']>
  const missing = setup({ skills: fakeSkills().repo, systemSkills: broken })
  await enable(missing.bridge)
  const snapshot = missing.bridge.snapshot(SESSION)
  assert.deepEqual(snapshot.systemSkills, [])
  assert.match(snapshot.systemSkillsReason ?? '', /本机没有系统技能库/, '库不存在时必须给出可读原因')
})

test('r10：装配后快照的技能投影与模型清单来自注入的仓储/缓存（不自行编造）', async () => {
  const skills = fakeSkills([skillRecordOf({ id: 'review', title: '代码审查', source: 'imported', modified: false })])
  const catalog: NonNullable<BridgeDeps['modelCatalog']> = () => ({
    status: 'ready',
    options: [{ provider: 'deepseek', providerName: 'DeepSeek', model: 'v4', modelName: 'v4' }],
  })
  const { bridge } = setup({ skills: skills.repo, modelCatalog: catalog })

  const snapshot = bridge.snapshot(SESSION)
  assert.deepEqual(snapshot.skills, [{ id: 'review', title: '代码审查', description: '一句话', source: 'imported', modified: false }])
  assert.equal(snapshot.modelCatalog?.status, 'ready')
  assert.equal(snapshot.modelCatalog?.options[0]?.model, 'v4')
})
