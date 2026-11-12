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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GateEvidence, MemberBinding, MessageRecord, PanelAction, Plan, PlanTask, Role } from '../src/shared/types.ts'
import { createBridge, type Bridge, type BridgeDeps, type ReceiptInput } from '../src/host/bridge.ts'
import { buildHttpRoutes } from '../src/host/http.ts'
import { BUILTIN_ROLES } from '../src/host/roles/builtin.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { createSettingsRepo } from '../src/host/settings.ts'
import { createExpander } from '../src/host/memory/expand.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { NOT_ENABLED_MESSAGE, buildToolSpecs, sessionOf } from '../src/host/tools.ts'
import { createDeviationRecorder } from '../src/host/team/deviation.ts'
import { applyReceipt as applyReceiptReal } from '../src/host/team/dispatch.ts'

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

/** 旧证据夹具（r13：done 改验收后必须被本次门禁的新证据替换）。 */
function evidenceOf(command: string, exitCode: number): GateEvidence {
  return { taskId: 't1', command, exitCode, tail: '', artifacts: [], at: NOW }
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

/**
 * r13 AC-11：5 类不可逆动作现在**必须先确认**。
 *
 * 单任务动作的老用例断言的是「执行体」的语义（BAD_REQUEST / 状态迁移 / 释放写域），
 * 那部分没有变：这里先拿 `pendingId` 再确认，把「确认后的结果」交给原断言。
 * 纯拒绝型用例同理 —— 确认后才轮到执行体拒绝，pending 随之清空。
 */
async function actConfirmed(bridge: Bridge, action: PanelAction): Promise<Awaited<ReturnType<Bridge['act']>>> {
  const first = await bridge.act(SESSION, action)
  if (first.pendingId === undefined) return first
  return bridge.act(SESSION, { type: 'confirmPending', pendingId: first.pendingId })
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

test('http：四条路由 + GET /memory 校验 + {data} 包装', async () => {
  const { bridge, store } = setup()
  await enable(bridge)

  const routes = buildHttpRoutes({ bridge, defaultSessionId: () => SESSION })
  // r13 AC-22：路由恰 4 条（新增 `GET /library`，历史详情走它的 `?runId=`，不新开第 5 条）。
  assert.deepEqual(
    routes.map((route) => `${route.method} ${route.path}`),
    [
      'GET /api/auto-team/snapshot',
      'GET /api/auto-team/library',
      'GET /api/auto-team/memory',
      'POST /api/auto-team/act',
    ],
  )

  const get = (url: string): { method: string; pathname: string; url: string; json: () => Promise<unknown> } => ({
    method: 'GET',
    pathname: url.split('?')[0],
    url,
    json: async () => ({}),
  })
  // 按路径取路由而不是按下标：插入 `/library` 后下标会整体后移，按下标写死的用例会
  // 「换一条路由的错误信息去命中另一条断言」，红得莫名其妙。
  const routeOf = (path: string) => {
    const found = routes.find((route) => route.path === path)
    assert.ok(found, `缺少路由 ${path}`)
    return found
  }

  const snapshot = (await routeOf('/api/auto-team/snapshot').handle(
    get(`/api/auto-team/snapshot?sessionId=${SESSION}`),
  )) as {
    data?: { enabled?: boolean; messages?: unknown[] }
  }
  assert.equal(snapshot.data?.enabled, true)
  assert.deepEqual(snapshot.data?.messages, [])

  const badName = (await routeOf('/api/auto-team/memory').handle(
    get('/api/auto-team/memory?track=public&name=..%2Fx'),
  )) as {
    error?: string
  }
  assert.equal(badName.error, '非法文件名')

  const badTrack = (await routeOf('/api/auto-team/memory').handle(get('/api/auto-team/memory?track=nope&name=a'))) as {
    error?: string
  }
  assert.equal(badTrack.error, 'track 必须是 public、project 或 skill')

  const acted = (await routeOf('/api/auto-team/act').handle({
    method: 'POST',
    pathname: '/api/auto-team/act',
    url: '/api/auto-team/act',
    json: async () => ({ sessionId: SESSION, action: { type: 'dispatch' } }),
  })) as { data?: { rejected?: { code?: string }; snapshot?: { enabled?: boolean } } }
  assert.equal(acted.data?.rejected?.code, 'NO_PLAN', '业务拒绝放在 data.rejected，HTTP 仍 200')
  assert.equal(acted.data?.snapshot?.enabled, true)

  const badJson = (await routeOf('/api/auto-team/act').handle({
    method: 'POST',
    pathname: '/api/auto-team/act',
    url: '/api/auto-team/act',
    json: async () => {
      throw new Error('bad json')
    },
  })) as { error?: string }
  assert.equal(badJson.error, '请求体不是合法 JSON')

  // r13 AC-22：第 4 条路由就是把项目库装配交给 bridge（客户端零拼接），返回 `{data: LibraryView}`。
  const library = (await routeOf('/api/auto-team/library').handle(
    get(`/api/auto-team/library?sessionId=${SESSION}`),
  )) as { data?: { projects?: unknown[]; global?: { memories?: unknown[] } } }
  assert.ok(Array.isArray(library.data?.projects), 'GET /library 必须返回 projects 数组')
  assert.ok(Array.isArray(library.data?.global?.memories), 'GET /library 必须返回 global.memories 数组')

  store.save(stateOf())
})

test('tools：8 个工具、未启用统一文案、dispatch 强制 runId（AC-30）', async () => {
  const { bridge, store, roles } = setup()
  const specs = buildToolSpecs({ store, roles, bridge, now: () => NOW })

  assert.equal(specs.length, 8)
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
      'auto_team_add_tasks',
    ],
  )
  assert.equal(sessionOf({ sessionId: SESSION }), SESSION)
  assert.equal(sessionOf(undefined), 'current')

  // r11：宿主真实形状是 exec: ToolRunContext，会话只出现在 `agent.id`（没有 sessionId）。
  // 少了这条，真机上七个工具会一律退回 'current'，而面板把开关记在真实会话 id 上
  // → 用户看到「开了自动团队但它从不干活」。这里连形状带行为一起钉住。
  assert.equal(sessionOf({ agent: { id: SESSION } }), SESSION, '必须认宿主真实的 exec.agent.id')
  assert.equal(
    sessionOf({ agent: { id: SESSION }, callId: 'c1', name: 'auto_team_plan' }),
    SESSION,
    '必须能从完整 ToolRunContext 里取到会话',
  )

  const meta = { sessionId: SESSION }
  for (const spec of specs) {
    const result = (await spec.handler({}, meta)) as { ok?: boolean; error?: string }
    assert.equal(result.ok, false, `${spec.name} 未启用时必须 ok:false`)
    assert.equal(result.error, NOT_ENABLED_MESSAGE, `${spec.name} 未启用文案必须统一`)
  }

  await enable(bridge)
  const tool = (name: string) => specs.find((spec) => spec.name === name)!

  // r11 行为闭环：面板在会话 S 上打开开关，队长侧工具按宿主真实入参
  // `exec = { agent: { id: S } }` 调用，必须认到同一个会话并放行（此前会回未启用）。
  const hostShaped = (await tool('auto_team_status').handler({}, { agent: { id: SESSION }, callId: 'c9' })) as {
    ok?: boolean
    enabled?: boolean
    error?: string
  }
  assert.equal(hostShaped.ok, true, `工具必须认 exec.agent.id：${hostShaped.error ?? ''}`)
  assert.equal(hostShaped.enabled, true, '面板打开的开关必须对工具可见')

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

test('snapshot.runs（r17）：宿主把落盘 usageTotals 派生为历史行六项，无用量给 unavailable 原因', async () => {
  const { bridge, store } = setup()
  // 两个同 session 的 run：旧的用量齐全（含宿主通常不上报的 cacheWrite），新的完全没有用量。
  store.save(
    stateOf({
      plan: planOf({ runId: 'run-old', createdAt: NOW - 60_000, status: 'terminated' }),
      plannedAt: NOW - 60_000,
      finishedAt: NOW,
      usage: {
        attribution: 'aggregate-only',
        byMember: {},
        byTask: {},
        total: { total: 60_421, input: 29_229, cacheRead: 30_848, output: 344, calls: 3 },
        updatedAt: NOW,
      },
    }),
  )
  store.save(stateOf({ plan: planOf({ runId: 'run-new', createdAt: NOW, status: 'dispatching' }) }))

  const runs = bridge.snapshot(SESSION).runs ?? []
  assert.deepEqual(runs.map((run) => run.runId), ['run-new', 'run-old'])

  const withUsage = runs.find((run) => run.runId === 'run-old')
  assert.ok(withUsage)
  const usage = withUsage.usage
  assert.ok(usage, '历史行必须带宿主派生的 usage 单元格')
  assert.equal(usage.source, 'provider')
  assert.equal(usage.text, '60.42K', '合计文本由宿主生成（r19：与六项同一动态单位口径）')
  // 六项顺序固定、文案逐字；缺失分项写「不可得」且 available=false（不补 0）。
  assert.deepEqual(usage.details, [
    { key: 'input', label: '输入未命中', text: '29.23K', available: true },
    { key: 'cacheRead', label: '输入命中', text: '30.85K', available: true },
    { key: 'cacheWrite', label: '写缓存', text: '不可得', available: false },
    { key: 'output', label: '输出', text: '344', available: true },
    { key: 'calls', label: '调用次数', text: '3', available: true },
    { key: 'hitRate', label: '缓存命中率', text: '51.3%', available: true },
  ])
  // 派生只发生在读取时：摘要仍带原始 usageTotals（run 文件里没有 usage 字段）
  assert.equal(withUsage.usageTotals?.total, 60_421)

  const withoutUsage = runs.find((run) => run.runId === 'run-new')
  assert.ok(withoutUsage)
  assert.equal(withoutUsage.usage?.source, 'unavailable')
  assert.equal(withoutUsage.usage?.reason, '宿主未上报本 run 的用量')
  assert.equal(withoutUsage.usage?.details, undefined)
  assert.equal(withoutUsage.usage?.text, undefined)
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

test('r10：GET /memory?track=skill 读技能正文（复用同一条正文通道，不新开技能路由）', async () => {
  const skills = fakeSkills([skillRecordOf({ id: 'review', title: '代码审查', body: '# 审查\n- 看边界' })])
  const { bridge } = setup({ skills: skills.repo })
  await enable(bridge)
  const routes = buildHttpRoutes({ bridge, defaultSessionId: () => SESSION })
  // r13 AC-22 定稿路由恰 4 条；技能正文仍走 /memory 的 `track=skill`，这里断言的是
  // 「没有 /skill 之类的第 5 条路由」，而不是把数字锁回 r10 时期的 3。
  assert.equal(routes.length, 4, '技能正文不许新开路由（路由仍恰 4 条）')
  assert.equal(
    routes.filter((route) => /skill/i.test(route.path)).length,
    0,
    '技能正文不许新开 /skill 路由',
  )

  const get = (url: string): { method: string; pathname: string; url: string; json: () => Promise<unknown> } => ({
    method: 'GET',
    pathname: url.split('?')[0],
    url,
    json: async () => ({}),
  })

  // 按路径取（r13 新增 `GET /library` 后下标整体后移，写死下标会拿错路由）。
  const memoryRoute = routes.find((route) => route.path === '/api/auto-team/memory')
  assert.ok(memoryRoute, '缺少 GET /memory 路由')

  const body = (await memoryRoute.handle(get('/api/auto-team/memory?track=skill&name=review'))) as {
    data?: { id?: string; title?: string; body?: string; chars?: number }
    error?: string
  }
  assert.equal(body.error, undefined)
  assert.equal(body.data?.title, '代码审查')
  assert.equal(body.data?.body, '# 审查\n- 看边界')
  assert.equal(body.data?.chars, '# 审查\n- 看边界'.length)

  const missing = (await memoryRoute.handle(get('/api/auto-team/memory?track=skill&name=ghost'))) as { error?: string }
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

// ---------------------------------------------------------------------------
// r11 F8：单任务三动作（AC-25 / AC-26）+ 快照两字段（AC-19 / AC-24）
// ---------------------------------------------------------------------------

/** 两个任务：t1 是上游，t2 依赖 t1（用于验「下游转 blocked / 解除阻塞」）。 */
function pairState(t1: Partial<PlanTask> = {}, t2: Partial<PlanTask> = {}): RunState {
  return stateOf({
    plan: planOf({
      status: 'dispatching',
      tasks: [taskOf('t1', t1), taskOf('t2', { dependsOn: ['t1'], ...t2 })],
    }),
    bindings: [bindingOf(), bindingOf({ taskId: 't2', memberId: 'member-2', name: '开发-2' })],
  })
}

test('r11：快照必给 scopeLocks 与 deviations（缺省空数组，有内容时原样投影）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-dev-'))
  const recorder = createDeviationRecorder({
    file: join(dir, 'deviations.jsonl'),
    sessionId: SESSION,
    now: () => NOW,
  })
  const { bridge, store } = setup({ deviations: recorder })
  await enable(bridge)

  const bare = bridge.snapshot(SESSION)
  assert.deepEqual(bare.scopeLocks, [], '没有运行中的写域时必须是空数组而不是 undefined')
  assert.deepEqual(bare.deviations, [], '没有留痕时必须是空数组')

  store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [
          taskOf('t1', { status: 'running', writeScopes: ['src/host'] }),
          taskOf('t2', {
            status: 'waiting',
            writeScopes: ['src/host/bridge.ts'],
            waitingOn: ['t1'],
            waitReason: '等待 t1 释放 src/host',
          }),
        ],
      }),
      bindings: [bindingOf(), bindingOf({ taskId: 't2', memberId: 'member-2', name: '开发-2' })],
    }),
  )
  recorder.record({ toolName: 'write', args: { path: 'src/host/bridge.ts', content: 'x'.repeat(200) } })

  const snapshot = bridge.snapshot(SESSION)
  const locks = snapshot.scopeLocks ?? []
  const deviations = snapshot.deviations ?? []
  assert.equal(locks.length, 1)
  assert.equal(locks[0]?.path, 'src/host')
  assert.equal(locks[0]?.holderTaskId, 't1')
  assert.equal(locks[0]?.holderMember, '开发-1')
  assert.equal(locks[0]?.waiters[0]?.taskId, 't2')
  assert.equal(locks[0]?.waiters[0]?.reason, '等待 t1 释放 src/host', '等待原因原样透传')
  assert.equal(deviations.length, 1)
  assert.equal(deviations[0]?.toolName, 'write')
  assert.deepEqual(deviations[0]?.paths, ['src/host/bridge.ts'])
  const reason = deviations[0]?.reason ?? ''
  assert.ok(reason.length > 0 && reason.length <= 120, '留痕理由必须存在且不超过 120 字')
  assert.ok(!reason.includes('xxxx'), '留痕只记路径，绝不带文件正文')
})

test('r11 cancelTask 允许：pending → cancelled，下游转 blocked 且带等待原因', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(pairState({ status: 'pending' }, { status: 'blocked' }))

  // r13 AC-11：cancelTask 不可逆 → 先挂 pending（同一 run 只一条），确认后才执行。
  const requested = await bridge.act(SESSION, { type: 'cancelTask', taskId: 't1', reason: '需求方撤回' })
  assert.equal(requested.rejected?.code, 'CONFIRM_REQUIRED', '未确认前必须被拦')
  assert.ok(requested.pendingId !== undefined, '必须带回 pendingId')
  assert.equal(requested.snapshot.tasks.find((task) => task.id === 't1')?.status, 'pending', '未确认时状态不变')
  assert.equal(requested.snapshot.pendingConfirmation?.action, 'cancelTask', '快照必须暴露未决确认')

  const result = await actConfirmed(bridge, { type: 'cancelTask', taskId: 't1', reason: '需求方撤回' })
  assert.equal(result.rejected, undefined)
  assert.equal(result.snapshot.tasks.find((task) => task.id === 't1')?.status, 'cancelled')
  const downstream = result.snapshot.tasks.find((task) => task.id === 't2')
  assert.equal(downstream?.status, 'blocked', '下游必须转为阻塞')
  assert.equal(downstream?.waitReason, '上游 t1 已取消', '等待原因逐字由宿主生成')
  assert.deepEqual(downstream?.waitingOn, ['t1'])
  assert.ok((result.notices ?? []).some((text) => text.includes('t1') && text.includes('已取消')))
  assert.ok(
    (result.notices ?? []).some((text) => text.includes('需求方撤回')),
    '取消理由必须落进 notice（否则账本里查不到为什么取消）',
  )
})

test('r11 cancelTask 允许：running → cancelled 并按成员名尽力中断', async () => {
  const interrupted: string[] = []
  const { bridge, store } = setup({
    interruptMember: async (name) => {
      interrupted.push(name)
      return { ok: true }
    },
  })
  await enable(bridge)
  store.save(pairState({ status: 'running' }, { status: 'blocked' }))

  const result = await actConfirmed(bridge, { type: 'cancelTask', taskId: 't1' })
  assert.equal(result.rejected, undefined)
  assert.deepEqual(interrupted, ['开发-1'], 'running 任务取消必须中断对应成员')
  assert.equal(result.snapshot.tasks.find((task) => task.id === 't1')?.status, 'cancelled')
  assert.ok((result.notices ?? []).some((text) => text.includes('已中断成员')))
})

test('r11 cancelTask 释放写域：等待者收到一条释放消息并回到 pending', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  // 等待者**不依赖** t1（纯写域冲突）：依赖 t1 的任务会按 AC-26 转 blocked，那与释放无关。
  store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [
          taskOf('t1', { status: 'running', writeScopes: ['src/host/bridge.ts'] }),
          taskOf('t2', {
            status: 'waiting',
            writeScopes: ['src/host/bridge.ts'],
            waitingOn: ['t1'],
            waitReason: '等待 t1 释放 src/host/bridge.ts',
          }),
        ],
      }),
      bindings: [bindingOf(), bindingOf({ taskId: 't2', memberId: 'member-2', name: '开发-2' })],
    }),
  )

  const result = await actConfirmed(bridge, { type: 'cancelTask', taskId: 't1' })
  const waiter = result.snapshot.tasks.find((task) => task.id === 't2')
  assert.equal(waiter?.status, 'pending', '持有者取消后等待者必须被放回 pending')
  assert.equal(waiter?.waitReason, undefined)
  const released = result.snapshot.messages.filter((message) => (message.messageId ?? '').startsWith('rel-t1-t2-'))
  assert.equal(released.length, 1, '释放通知必须落账且恰好一条')
})

test('r11 cancelTask 拒绝：done 不可取消，文案含任务 id 与状态中文', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(stateOf({ plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'done' })] }) }))

  const result = await actConfirmed(bridge, { type: 'cancelTask', taskId: 't1' })
  assert.equal(result.rejected?.code, 'BAD_REQUEST')
  assert.match(result.rejected?.message ?? '', /t1/)
  assert.match(result.rejected?.message ?? '', /已通过/)
  assert.equal(result.snapshot.tasks[0]?.status, 'done', '被拒时状态不变')
})

test('r11 cancelTask 拒绝：gate 正在跑门禁不可取消（出路是改验收）', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(stateOf({ plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'gate' })] }) }))

  const result = await actConfirmed(bridge, { type: 'cancelTask', taskId: 't1' })
  assert.equal(result.rejected?.code, 'BAD_REQUEST')
  assert.match(result.rejected?.message ?? '', /t1/)
  assert.match(result.rejected?.message ?? '', /门禁中/)
})

test('r11 skipTask 允许：pending → skipped，依赖它的下游解除阻塞', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(pairState({ status: 'pending' }, { status: 'blocked' }))

  const result = await actConfirmed(bridge, { type: 'skipTask', taskId: 't1' })
  assert.equal(result.rejected, undefined)
  assert.equal(result.snapshot.tasks.find((task) => task.id === 't1')?.status, 'skipped')
  assert.equal(result.snapshot.tasks.find((task) => task.id === 't2')?.status, 'pending', '依赖视为满足')
})

test('r11 skipTask 允许：waiting → skipped（等待中可直接跳过）', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(pairState({ status: 'waiting', waitingOn: ['t2'], waitReason: '等待 t2 释放 a.ts' }, { status: 'running' }))

  const result = await actConfirmed(bridge, { type: 'skipTask', taskId: 't1' })
  assert.equal(result.rejected, undefined)
  const skipped = result.snapshot.tasks.find((task) => task.id === 't1')
  assert.equal(skipped?.status, 'skipped')
  assert.equal(skipped?.waitReason, undefined, '跳过必须清掉等待原因')
})

test('r11 skipTask 拒绝：running 请先取消', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(stateOf({ plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'running' })] }) }))

  const result = await actConfirmed(bridge, { type: 'skipTask', taskId: 't1' })
  assert.equal(result.rejected?.code, 'BAD_REQUEST')
  assert.match(result.rejected?.message ?? '', /t1/)
  assert.match(result.rejected?.message ?? '', /运行中/)
})

test('r11 skipTask 拒绝：failed 不可跳过（请重跑或取消）', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(stateOf({ plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'failed' })] }) }))

  const result = await actConfirmed(bridge, { type: 'skipTask', taskId: 't1' })
  assert.equal(result.rejected?.code, 'BAD_REQUEST')
  assert.match(result.rejected?.message ?? '', /t1/)
  assert.match(result.rejected?.message ?? '', /失败/)
})

test('r11 updateAcceptance 允许：pending 改写验收命令并 trim', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(stateOf({ plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'pending' })] }) }))

  const result = await actConfirmed(bridge, { type: 'updateAcceptance', taskId: 't1', acceptance: '  pnpm typecheck  ' })
  assert.equal(result.rejected, undefined)
  assert.equal(result.snapshot.tasks[0]?.acceptance, 'pnpm typecheck')
})

test('r11 updateAcceptance 允许：interrupted 可改验收后重派', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(stateOf({ plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'interrupted' })] }) }))

  const result = await actConfirmed(bridge, {
    type: 'updateAcceptance',
    taskId: 't1',
    acceptance: "grep -RIn --fixed-strings 'deriveScopeLocks' src/host >/dev/null",
  })
  assert.equal(result.rejected, undefined)
  assert.match(result.snapshot.tasks[0]?.acceptance ?? '', /deriveScopeLocks/)
})

test('r13 updateAcceptance 允许：done 改验收 → 确认后重跑门禁，通过保持 done 并刷新证据', async () => {
  const { bridge, store, calls } = setup()
  await enable(bridge)
  store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [taskOf('t1', { status: 'done', acceptance: 'exit 9', evidence: evidenceOf('exit 9', 9) })],
      }),
    }),
  )

  const first = await bridge.act(SESSION, { type: 'updateAcceptance', taskId: 't1', acceptance: 'exit 0' })
  assert.equal(first.rejected?.code, 'CONFIRM_REQUIRED', 'done 改验收必须先确认（不可逆动作）')
  assert.equal(store.load('run-t4')?.plan.tasks[0]?.acceptance, 'exit 9', '确认前不改验收命令')
  const pendingId = first.pendingId
  assert.ok(pendingId, 'CONFIRM_REQUIRED 必须带 pendingId')

  const result = await bridge.act(SESSION, { type: 'confirmPending', pendingId })
  assert.equal(result.rejected, undefined)
  const task = result.snapshot.tasks[0]
  assert.equal(task?.acceptance, 'exit 0', '确认后落新验收命令')
  assert.equal(task?.status, 'done', '门禁通过 → 保持 done')
  assert.equal(task?.evidence?.command, 'exit 0', '证据必须是本次门禁的')
  assert.equal(task?.evidence?.exitCode, 0)
  assert.equal(calls.receipts[0]?.receipt.verdict, 'done')
})

test('r13 updateAcceptance 允许：done 改验收后门禁失败 → 转 rework（不得静默保留 done）', async () => {
  const { bridge, store, calls } = setup()
  await enable(bridge)
  store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [taskOf('t1', { status: 'done', acceptance: 'exit 0', evidence: evidenceOf('exit 0', 0) })],
      }),
    }),
  )

  const result = await actConfirmed(bridge, { type: 'updateAcceptance', taskId: 't1', acceptance: 'exit 7' })
  assert.equal(result.rejected, undefined)
  const task = result.snapshot.tasks[0]
  assert.equal(task?.acceptance, 'exit 7')
  assert.equal(task?.status, 'rework', '门禁失败必须转返工')
  assert.equal(task?.evidence?.exitCode, 7)
  assert.equal(calls.receipts[0]?.receipt.verdict, 'rework')
})

test('r13 updateAcceptance：done 改验收接真实 applyReceipt —— 门禁结论由状态机落盘，不是 mock 语义', async () => {
  const { bridge, store } = setup({
    applyReceipt: (state, taskId, receipt, now, maxAttempts) =>
      applyReceiptReal(state, taskId, receipt, now, maxAttempts),
  })
  await enable(bridge)
  store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [taskOf('t1', { status: 'done', acceptance: 'exit 0', evidence: evidenceOf('exit 0', 0) })],
      }),
    }),
  )

  const result = await actConfirmed(bridge, { type: 'updateAcceptance', taskId: 't1', acceptance: 'exit 7' })
  assert.equal(result.rejected, undefined)
  const task = result.snapshot.tasks[0]
  assert.equal(task?.status, 'rework', '真实 applyReceipt 必须把门禁失败落成 rework')
  assert.equal(task?.evidence?.command, 'exit 7')
  assert.equal(task?.evidence?.exitCode, 7)
  assert.equal(task?.acceptance, 'exit 7')
  // 落盘也要是同一结论（不能只改内存里的快照）
  assert.equal(store.load('run-t4')?.plan.tasks[0]?.status, 'rework')
})

test('r11 updateAcceptance 拒绝：cancelled 不可改', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(stateOf({ plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'cancelled' })] }) }))

  const result = await actConfirmed(bridge, { type: 'updateAcceptance', taskId: 't1', acceptance: 'exit 0' })
  assert.equal(result.rejected?.code, 'BAD_REQUEST')
  assert.match(result.rejected?.message ?? '', /已取消/)
})

test('r11 updateAcceptance 拒绝：空白验收返回三条模板且不落盘', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(stateOf({ plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'pending' })] }) }))

  const result = await actConfirmed(bridge, { type: 'updateAcceptance', taskId: 't1', acceptance: '   ' })
  assert.equal(result.rejected?.code, 'BAD_REQUEST')
  const message = result.rejected?.message ?? ''
  assert.match(message, /t1/)
  assert.match(message, /pnpm typecheck/)
  assert.match(message, /grep -RIn --fixed-strings/)
  assert.equal(result.snapshot.tasks[0]?.acceptance, 'exit 0', '被拒时原验收命令不变')
})

test('r11 三动作都走既有 POST /act 路由（r13 后路由恰 4 条，不因动作增加）', () => {
  const routes = buildHttpRoutes({ bridge: createBridge(setup().deps), defaultSessionId: () => SESSION })
  // r13 AC-22：r11 的 3 个任务动作 + r13 的 3 个新动作（confirmPending/rejectPending/forceParallel）
  // 都挤在同一条 POST /act 上，路由数仍是 4（snapshot/library/memory/act）。
  assert.equal(routes.length, 4, '路由数必须仍是 4（r13 只新增 GET /library）')
  const paths = routes.map((route) => route.path)
  assert.deepEqual(paths.filter((path) => path.includes('/act')).length, 1)
})

/* ───────────────────────────── r19：run 终态自动沉淀记忆 ───────────────────────────── */

/**
 * 用 `updateAcceptance` 触发 saveState：它是最轻的一条 saveState 路径（不跑门禁、不改状态机），
 * 因此可以把 store 里预置的 terminated/paused 状态原样再落一次盘，专门观察记忆副作用。
 */
async function triggerSaveState(bridge: Bridge, taskId: string, acceptance = 'exit 0'): Promise<void> {
  await actConfirmed(bridge, { type: 'updateAcceptance', taskId, acceptance })
}

function terminatedStateOf(over: Partial<RunState> = {}, tasks: PlanTask[] = [taskOf('t1', { status: 'done' }), taskOf('t2')]): RunState {
  return stateOf({
    project: 'dsh-auto-team',
    finishedAt: NOW,
    plan: planOf({ goal: '实现自动记忆', status: 'terminated', tasks }),
    ...over,
  })
}

test('r19 自动记忆：terminated 把失败证据写进 pitfalls（P1）、通过命令写进 commands（P2）；同一 state 重复保存幂等', async () => {
  const { bridge, store, dir } = setup()
  await enable(bridge)
  store.save(
    terminatedStateOf(
      {},
      [
        taskOf('t1', {
          status: 'failed',
          attempts: 2,
          evidence: { command: 'pnpm test', exitCode: 1, tail: '2 failing', artifacts: [], at: NOW, taskId: 't1' },
        }),
        taskOf('t2', {
          status: 'done',
          evidence: { command: 'pnpm typecheck', exitCode: 0, tail: '', artifacts: [], at: NOW, taskId: 't2' },
        }),
      ],
    ),
  )
  await triggerSaveState(bridge, 't2')

  const pitfallsPath = join(dir, 'memory-project', 'pitfalls.md')
  const commandsPath = join(dir, 'memory-project', 'commands.md')
  assert.ok(existsSync(pitfallsPath), '失败证据必须写进项目 pitfalls')
  assert.ok(existsSync(commandsPath), '通过的门禁命令必须写进项目 commands')
  const pitfalls = readFileSync(pitfallsPath, 'utf8')
  assert.match(
    pitfalls,
    /^- \[P1\] 门禁 `pnpm test` 失败（退出码 1）；输出尾部：2 failing（来源：系统 · \d{2}-\d{2} \d{2}:\d{2} · 修正 \d{1,7}）$/m,
  )
  assert.match(readFileSync(commandsPath, 'utf8'), /^- \[P2\] 已验证命令：pnpm typecheck（来源：系统 · /m)
  assert.equal(existsSync(join(dir, 'memory-project', 'run-run-t4.md')), false, '不得再写 run-*.md 流水')

  // 同一个 state 已经带 memorySunkAt：再次 saveState 必须一条都不再写（不是靠「文件存在就跳过」）。
  const before = [readFileSync(pitfallsPath, 'utf8'), readFileSync(commandsPath, 'utf8')]
  await triggerSaveState(bridge, 't2')
  assert.deepEqual([readFileSync(pitfallsPath, 'utf8'), readFileSync(commandsPath, 'utf8')], before, '幂等键必须挡住重复沉淀')
})

test('r19 自动记忆：paused / dispatching 状态不写任何记忆', async () => {
  const { bridge, store, dir } = setup()
  await enable(bridge)
  store.save(
    stateOf({
      project: 'dsh-auto-team',
      plan: planOf({ goal: '实现自动记忆', status: 'paused', tasks: [taskOf('t1'), taskOf('t2')] }),
    }),
  )
  await triggerSaveState(bridge, 't2')
  assert.equal(existsSync(join(dir, 'memory-project', 'pitfalls.md')), false, 'paused 不得写项目记忆')
  assert.equal(existsSync(join(dir, 'memory-project', 'commands.md')), false, 'paused 不得写项目记忆')
  assert.equal(existsSync(join(dir, 'memory-public', 'pitfalls.md')), false, 'paused 不得写公共记忆')
  assert.equal(store.load('run-t4')?.memorySunkAt, undefined, '非终态不得写幂等键')
})

test('r19 自动记忆：有失败任务时额外写一条公共教训 pitfalls（P1）', async () => {
  const { bridge, store, dir } = setup()
  await enable(bridge)
  store.save(
    terminatedStateOf(
      {},
      [
        taskOf('t1', {
          status: 'failed',
          attempts: 2,
          evidence: { command: 'pnpm test', exitCode: 1, tail: '2 failing', artifacts: [], at: NOW, taskId: 't1' },
        }),
        taskOf('t2'),
      ],
    ),
  )
  await triggerSaveState(bridge, 't2')

  const body = readFileSync(join(dir, 'memory-public', 'pitfalls.md'), 'utf8')
  assert.match(
    body,
    /^- \[P1\] 门禁 `pnpm test` 失败（退出码 1）——先本地重跑确认，再把证据发回成员返工（来源：系统 · /m,
  )
  assert.equal(existsSync(join(dir, 'memory-public', 'lessons-run-t4.md')), false, '不得再写 lessons-*.md 流水')
})

test('r19 自动记忆 fail-open：记忆目录不可写也不影响 store.save 与动作结果', async () => {
  // publicDir 指向一个**文件**路径：mkdirSync 会失败，正好模拟「记忆写盘炸了」。
  // 把 publicDir 挂在**文件**下面：`existsSync` 为 false（快照读记忆不会红），
  // 但 `mkdirSync(publicDir, { recursive: true })` 会 ENOTDIR —— 正好只炸写盘路径。
  const brokenRoot = mkdtempSync(join(tmpdir(), 'auto-team-r19-broken-'))
  const publicAsFile = join(brokenRoot, 'public-as-file')
  writeFileSync(publicAsFile, 'not a directory', 'utf8')

  const { bridge, store } = setup({
    memoryRoots: { publicDir: join(publicAsFile, 'memory-public'), projectDir: join(brokenRoot, 'memory-project') },
  })
  await enable(bridge)
  store.save(
    terminatedStateOf(
      {},
      [
        taskOf('t1', {
          status: 'failed',
          attempts: 2,
          evidence: { command: 'pnpm test', exitCode: 1, tail: 'boom', artifacts: [], at: NOW, taskId: 't1' },
        }),
        taskOf('t2'),
      ],
    ),
  )

  const result = await triggerSaveStateResult(bridge, 't2')
  assert.equal(result.rejected, undefined, '记忆写失败不能把动作变成拒绝')
  const saved = store.latestForSession(SESSION)
  assert.equal(saved?.plan.status, 'terminated', 'store.save 必须照常完成')
  assert.equal(saved?.plan.tasks.find((task) => task.id === 't2')?.acceptance, 'exit 0')
})

/** 同 `triggerSaveState`，但把确认后的 act 结果返回给 fail-open 用例断言。 */
async function triggerSaveStateResult(bridge: Bridge, taskId: string, acceptance = 'exit 0') {
  return actConfirmed(bridge, { type: 'updateAcceptance', taskId, acceptance })
}

/* ─────────── r20：run 取消 = 终态，落 finishedAt；重复取消不覆盖首次时刻 ─────────── */

test('cancel：首次取消落 finishedAt + cancelled，重复取消幂等且保留首次结束时刻', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  store.save(stateOf())

  // r13：取消不可逆 → 必过确认闸；这里走确认后的执行结果。
  const first = await actConfirmed(bridge, { type: 'cancel' })
  assert.equal(first.rejected, undefined, '有计划时取消不应被拒')
  const cancelled = store.load('run-t4')
  assert.equal(cancelled?.plan.status, 'cancelled')
  const firstFinishedAt = cancelled?.finishedAt
  assert.equal(typeof firstFinishedAt, 'number', '取消是终态，必须与状态同一次落盘结束时刻')
  assert.ok(Number.isFinite(firstFinishedAt ?? Number.NaN) && (firstFinishedAt ?? 0) > 0, '结束时刻必须是真实时间戳')
  assert.ok(
    (first.notices ?? []).some((text) => text.includes('已取消本次运行')),
    '首次取消要有可读回执',
  )

  // 把落盘时刻改成哨兵：第二次取消若重新取 now，哨兵就被刷新 —— 这正是要防的。
  assert.ok(cancelled)
  store.save({ ...cancelled, finishedAt: NOW + 12_345 })
  const again = await actConfirmed(bridge, { type: 'cancel' })
  assert.equal(again.rejected, undefined, '重复取消是幂等成功（不是错误）')
  assert.deepEqual(again.notices, ['本次运行已取消'])
  assert.equal(store.load('run-t4')?.finishedAt, NOW + 12_345, '幂等分支不得覆盖首次结束时刻')
  assert.equal(store.load('run-t4')?.plan.status, 'cancelled')
})

/* ───────────── r22：项目记忆按会话/run 的真实 workspace 落盘 ───────────── */

test('r22 记忆落点：同一进程两个会话的终态 run 各自落到 <workspace>/.auto-team/memory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-r22-two-'))
  const wsA = join(root, 'ws-a')
  const wsB = join(root, 'ws-b')
  const { bridge, store, dir } = setup({
    workspaceOf: (sessionId) => (sessionId === 'sess-a' ? wsA : sessionId === 'sess-b' ? wsB : undefined),
  })
  await bridge.act('sess-a', { type: 'toggle', enabled: true })
  await bridge.act('sess-b', { type: 'toggle', enabled: true })
  store.save(
    terminatedStateOf({
      plan: planOf({
        runId: 'run-a',
        sessionId: 'sess-a',
        goal: '项目 A',
        status: 'terminated',
        tasks: [
          taskOf('t1', {
            status: 'failed',
            attempts: 2,
            evidence: { command: 'pnpm test --ws-a', exitCode: 1, tail: 'A-fail', artifacts: [], at: NOW, taskId: 't1' },
          }),
          taskOf('t2', { status: 'done' }),
        ],
      }),
    }),
  )
  store.save(
    terminatedStateOf({
      plan: planOf({
        runId: 'run-b',
        sessionId: 'sess-b',
        goal: '项目 B',
        status: 'terminated',
        tasks: [
          taskOf('t1', {
            status: 'failed',
            attempts: 2,
            evidence: { command: 'pnpm test --ws-b', exitCode: 1, tail: 'B-fail', artifacts: [], at: NOW, taskId: 't1' },
          }),
          taskOf('t2', { status: 'done' }),
        ],
      }),
    }),
  )

  for (const sessionId of ['sess-a', 'sess-b']) {
    // updateAcceptance 不可逆 → 先拿 pendingId 再确认（与 actConfirmed 同一姿势，只是换成各自的会话）。
    const first = await bridge.act(sessionId, { type: 'updateAcceptance', taskId: 't2', acceptance: 'exit 0' })
    assert.equal(typeof first.pendingId, 'string', `${sessionId} 的不可逆动作必须进入确认闸`)
    const confirmed = await bridge.act(sessionId, { type: 'confirmPending', pendingId: first.pendingId! })
    assert.equal(confirmed.rejected, undefined, `${sessionId} 的确认不应被拒`)
  }

  const pitfallsA = readFileSync(join(wsA, '.auto-team/memory/pitfalls.md'), 'utf8')
  const pitfallsB = readFileSync(join(wsB, '.auto-team/memory/pitfalls.md'), 'utf8')
  assert.match(pitfallsA, /pnpm test --ws-a/, 'sess-a 的证据必须落到 ws-a')
  assert.match(pitfallsB, /pnpm test --ws-b/, 'sess-b 的证据必须落到 ws-b')
  assert.equal(pitfallsA.includes('--ws-b'), false, '不得把 B 的证据写进 A')
  assert.equal(pitfallsB.includes('--ws-a'), false, '不得把 A 的证据写进 B')
  assert.equal(existsSync(join(dir, 'memory-project', 'pitfalls.md')), false, '不得再写装配目录')
})

test('r22 记忆落点：没有 workspace 时退化到装配目录，并在快照给出可读原因', async () => {
  const { bridge, store, dir } = setup()
  await enable(bridge)
  store.save(
    terminatedStateOf(
      {},
      [
        taskOf('t1', {
          status: 'failed',
          attempts: 2,
          evidence: { command: 'pnpm test', exitCode: 1, tail: 'boom', artifacts: [], at: NOW, taskId: 't1' },
        }),
        taskOf('t2'),
      ],
    ),
  )
  await triggerSaveState(bridge, 't2')

  // 无 workspaceOf、run.project 又是 basename → 只能退化，但必须写明为什么。
  assert.ok(existsSync(join(dir, 'memory-project', 'pitfalls.md')), '退化路径仍要沉淀，不能静默不写')
  const snapshot = bridge.snapshot(SESSION)
  assert.equal(snapshot.memory.projectDir, join(dir, 'memory-project'))
  assert.equal(snapshot.memory.degraded, true)
  assert.match(snapshot.memory.degradeReason ?? '', /未能解析会话 sess-t4的项目工作区/)
})

test('r22 记忆落点：列表/注入/展开/读写删同源 —— 面板按 sessionId 读到的就是项目根里的正文', async () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-r22-ports-'))
  const wsA = join(root, 'ws-a')
  const { bridge } = setup({
    workspaceOf: (sessionId) => (sessionId === 'sess-a' ? wsA : undefined),
    expander: (id, depth, roots) => createExpander({ roots }).expand(id, depth),
  })
  await bridge.act('sess-a', { type: 'toggle', enabled: true })

  const saved = await bridge.act('sess-a', {
    type: 'saveMemory',
    track: 'project',
    name: 'notes.md',
    body: '# 项目 A 约定\n- 用 pnpm',
  })
  assert.equal(saved.rejected, undefined)
  assert.ok(existsSync(join(wsA, '.auto-team/memory/notes.md')), '写口必须落到会话项目根')

  const read = await bridge.readMemoryFile('project', 'notes.md', undefined, 'sess-a')
  assert.equal(read.data?.body, '# 项目 A 约定\n- 用 pnpm')

  const otherSession = await bridge.readMemoryFile('project', 'notes.md', undefined, 'sess-b')
  assert.match(otherSession.error ?? '', /记忆文件不存在/, '别的会话不得读到 A 的项目记忆')

  const expanded = await bridge.expandMemory('mem://project/notes.md', 0, 'sess-a')
  assert.equal(expanded.data?.code, 'OK')
  assert.equal(expanded.data?.body, '# 项目 A 约定\n- 用 pnpm')

  const inline = bridge.snapshot('sess-a').memory.files.find((file) => file.name === 'notes.md')
  assert.ok(inline, '列表口必须读同一个项目根')
  assert.match(bridge.memoryFor('项目 A 约定', 'sess-a').text, /用 pnpm/)
  assert.equal(bridge.memoryFor('项目 A 约定', 'sess-b').chars, 0, '别的会话的注入不得混入 A 的记忆')

  const forbidden = await bridge.readMemoryFile('project', 'notes.md', '/not/known', 'sess-a')
  assert.match(forbidden.error ?? '', /未授权的工作区/, '显式 workspace 仍走白名单，不能被 sessionId 绕过')

  const deleted = await bridge.act('sess-a', { type: 'deleteMemory', track: 'project', name: 'notes.md' })
  assert.equal(deleted.rejected, undefined)
  assert.equal(existsSync(join(wsA, '.auto-team/memory/notes.md')), false, '删口必须删同一个项目根')
})

test('t5 面板：复用成员挂两条 binding 时只显示一行，且显示的是「当前任务」', () => {
  const h = setup()
  h.store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [taskOf('t1', { status: 'done', memberId: 'member-1' }), taskOf('t2', { status: 'running', memberId: 'member-1' })],
      }),
      bindings: [bindingOf({ taskId: 't1', spawnedAt: NOW + 1000 }), bindingOf({ taskId: 't2', spawnedAt: NOW + 2000 })],
    }),
  )

  const snapshot = h.bridge.snapshot(SESSION)
  assert.equal(snapshot.members.length, 1, '一个 memberId 只占面板一行（复用不是新成员）')
  assert.equal(snapshot.members[0]?.taskId, 't2', '面板必须显示成员当前承接的任务，而不是已收口的旧任务')
  assert.equal(snapshot.members[0]?.status, 'running')

  const spawns = snapshot.activity.filter((event) => event.kind === 'spawn')
  assert.equal(spawns.length, 2, '两条 binding 都该有活动记录（历史不能丢）')
  assert.equal(
    spawns.filter((event) => event.text === '创建成员 开发-1').length,
    1,
    '只有第一次是真的创建成员',
  )
  assert.ok(
    spawns.some((event) => event.text.includes('复用成员 开发-1')),
    `第二条必须是复用，不能谎报新建：${JSON.stringify(spawns.map((event) => event.text))}`,
  )
})
