/**
 * r14 AC-1 / AC-3：派发**受理制**（工具不等 spawn）与**失败可见**（后台失败长腿回到活动流）。
 *
 * 为什么必须有这组测试：r13 的阻塞点不在宿主，而在我们自己的工具链 ——
 * `auto_team_dispatch` → `bridge.act('dispatch')` → `await deps.spawn()`，工具调用与成员创建
 * 同生共死。真机症状是「派发完了主对话还在转，用户没法继续说话」。下面的用例把这条链钉住：
 *
 *  - 派发端口**永不 resolve**（模拟宿主 spawn 挂住 60s）时，工具仍必须 ≤1s 返回（AC-1）；
 *  - 返回形状必须是 accepted/dispatching，而不是假装已经建好成员（反目标：假成功）；
 *  - 受理之后真正的执行者是 autoDispatcher（单飞 + 退避），工具自己**不许**再 await spawn；
 *  - 后台全失败时：活动流（既有 activity，kind='status'）与 auto_team_status.dispatch 段都要看得见；
 *  - 面板路径 `bridge.act('dispatch')` 保持 r13 的同步语义（不在 AC-1 范围内，不能被顺手改掉）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Plan, PlanTask, Role } from '../src/shared/types.ts'
import { createBridge, type Bridge, type BridgeDeps } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { buildToolSpecs } from '../src/host/tools.ts'
import { createAutoDispatcher, type AutoDispatchCause } from '../src/host/team/auto-dispatch.ts'
import { createDispatchNotes } from '../src/host/team/dispatch-notices.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r14-p0'
const RUN_ID = 'run-r14-p0'
/** 宿主真实形状：`exec` 上没有 sessionId，会话只在 `agent.id`（r11 真机事故）。 */
const META = { agent: { id: SESSION }, callId: 'call-1', name: 'auto_team_dispatch' }

/** AC-1 的受理文案（逐字；改了就等于改了给用户看的契约）。 */
const ACCEPTED_TEXT = '已接受派发：成员在后台创建，失败会显示在活动流'

interface Calls {
  dispatch: number
  kicks: Array<{ sessionId: string; runId: string | undefined; cause: AutoDispatchCause }>
}

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: 'exit 0', status: 'pending', ...over }
}

function planOf(over: Partial<Plan> = {}): Plan {
  return {
    runId: RUN_ID,
    sessionId: SESSION,
    createdAt: NOW,
    status: 'draft',
    tasks: [taskOf('t1')],
    maxConcurrent: 3,
    ...over,
  }
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return { version: RUN_STATE_VERSION, plan: planOf(), plannedAt: NOW, messages: [], bindings: [], routeAudits: [], ...over }
}

function roleOf(id: string, name: string): Role {
  return { id, name, duty: `${name}的职责`, skillIds: [], builtin: false, updatedAt: NOW }
}

function setup(options: { dispatchImpl?: BridgeDeps['dispatch'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r14-p0-'))
  const store = new RunsStore(join(dir, 'runs'))
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir: join(dir, 'skills'), now: () => NOW })
  roles.seed()
  roles.save(roleOf('dev', '开发'))

  const calls: Calls = { dispatch: 0, kicks: [] }
  // 缺省派发端口：成功建一个成员并把 plan 推到 dispatching（与真实 dispatchReady 的最简等价物）。
  // 计数放在最外层包装里 —— 自定义 dispatchImpl（挂起/抛错）也必须被记为「真被调了一次」。
  const port: BridgeDeps['dispatch'] =
    options.dispatchImpl ??
    (async (state) => {
      store.save({
        ...state,
        plan: {
          ...state.plan,
          status: 'dispatching',
          tasks: state.plan.tasks.map((task) => (task.status === 'pending' ? { ...task, status: 'running', memberId: 'member-1' } : task)),
        },
        bindings:
          state.bindings.length > 0
            ? state.bindings
            : [{ taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW + 1 }],
      })
      return { started: ['t1'], skipped: [], errors: [] }
    })

  const deps: BridgeDeps = {
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch: async (state) => {
      calls.dispatch += 1
      return port(state)
    },
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: false }),
    applyReceipt: (state) => state,
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
    now: () => NOW,
  }
  const bridge = createBridge(deps)
  return { dir, store, roles, bridge, deps, calls }
}

async function enable(bridge: Bridge): Promise<void> {
  const result = await bridge.act(SESSION, { type: 'toggle', enabled: true })
  assert.equal(result.rejected, undefined, '启用动作本身不应被拒')
}

function specsOf(
  h: ReturnType<typeof setup>,
  extra: { autoDispatch?: (sessionId: string, runId: string, cause: AutoDispatchCause) => void; dispatchReports?: (sessionId: string) => unknown[] },
) {
  const specs = buildToolSpecs({
    store: h.store,
    roles: h.roles,
    bridge: h.bridge,
    now: () => NOW,
    ...extra,
  } as Parameters<typeof buildToolSpecs>[0])
  const byName = new Map(specs.map((spec) => [spec.name, spec]))
  const spec = byName.get('auto_team_dispatch')
  assert.ok(spec, 'auto_team_dispatch 必须存在')
  return { dispatch: spec, byName }
}

/** 计时调用：AC-1 的判据是「工具返回耗时」，不是「spawn 什么时候完成」。 */
async function timed(fn: () => Promise<unknown>): Promise<{ result: Record<string, unknown>; ms: number }> {
  const start = Date.now()
  const result = (await fn()) as Record<string, unknown>
  return { result, ms: Date.now() - start }
}

test('AC-1：受理制 —— 派发端口永不 resolve 时工具仍 ≤1s 返回，且不再调 act 的长链', async () => {
  const h = setup({ dispatchImpl: () => new Promise(() => {}) })
  h.store.save(stateOf())
  await enable(h.bridge)

  const { dispatch } = specsOf(h, {
    autoDispatch: (sessionId, runId, cause) => h.calls.kicks.push({ sessionId, runId, cause }),
  })

  const { result, ms } = await timed(() => dispatch.handler({ runId: RUN_ID }, META))

  assert.ok(ms < 1000, `受理必须立即返回（实测 ${ms}ms；一旦改回 await spawn 这里立刻红）`)
  assert.equal(result.ok, true)
  assert.equal(result.accepted, true)
  assert.equal(result.dispatching, true, '受理态必须显式声明「成员还在后台」')
  assert.equal(result.runId, RUN_ID)
  assert.equal(result.planStatus, 'draft', '成员还没起来，不得预支 dispatching')
  assert.deepEqual(result.notices, [ACCEPTED_TEXT])
  assert.deepEqual(result.ready, ['t1'])
  assert.deepEqual(h.calls.kicks, [{ sessionId: SESSION, runId: RUN_ID, cause: 'manual' }], '工具只负责受理，执行交给 dispatcher')
  assert.equal(h.calls.dispatch, 0, '工具自己不许再走同步 dispatch 端口（否则 spawn 又会拖住本轮）')
})

test('AC-1：受理后由后台 dispatcher 接管 —— kick 之后仍在派发，但不阻塞本轮', async () => {
  const h = setup({ dispatchImpl: () => new Promise(() => {}) })
  h.store.save(stateOf())
  await enable(h.bridge)

  const dispatcher = createAutoDispatcher({ store: h.store, dispatch: h.deps.dispatch, now: () => NOW })
  const { dispatch } = specsOf(h, {
    autoDispatch: (sessionId, runId, cause) => dispatcher.kick(sessionId, runId, cause),
    dispatchReports: (sessionId) => dispatcher.reportsOf(sessionId),
  })

  const { result, ms } = await timed(() => dispatch.handler({ runId: RUN_ID }, META))
  assert.equal(result.accepted, true)
  assert.ok(ms < 1000, `实测 ${ms}ms`)

  // 等 kick 的 setTimeout(0) 落地：此刻后台卡在永不 resolve 的 dispatch 上 —— 这正是「不该等」的理由。
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(dispatcher.inflight(SESSION), true, '后台仍在派发，工具却早已返回')
  assert.equal(h.calls.dispatch, 1, '真正的 spawn 只由 dispatcher 触发一次')
  dispatcher.dispose()
})

test('未装配 autoDispatch：如实降级为同步派发（accepted:false + 成员已建），绝不假装受理', async () => {
  const h = setup()
  h.store.save(stateOf())
  await enable(h.bridge)

  const { dispatch } = specsOf(h, {})
  const result = (await dispatch.handler({ runId: RUN_ID }, META)) as Record<string, unknown>

  assert.equal(result.ok, true)
  assert.equal(result.accepted, false, '没被后台受理就必须明说，不能标 accepted:true 骗队长结束本轮')
  assert.equal(result.dispatching, false)
  assert.equal(h.calls.dispatch, 1)
  assert.equal((result.members as unknown[]).length, 1)
  assert.ok(
    (result.notices as string[]).some((text) => text.includes('已创建 1 个成员')),
    '同步路径要如实回报真实结果',
  )
  assert.ok((result.notices as string[]).some((text) => text.includes('退回同步派发')))
})

test('准入与面板同源：无计划 / runId 不存在 / 暂停 / 空 runId 拒绝；已派发转幂等确认 —— 一次都不 kick', async () => {
  const h = setup()
  await enable(h.bridge)
  const { dispatch } = specsOf(h, {
    autoDispatch: (sessionId, runId, cause) => h.calls.kicks.push({ sessionId, runId, cause }),
  })

  const noPlan = (await dispatch.handler({ runId: RUN_ID }, META)) as Record<string, unknown>
  assert.equal(noPlan.ok, false)
  assert.equal(noPlan.code, 'NO_PLAN')

  h.store.save(stateOf())
  const missing = (await dispatch.handler({ runId: 'run-typo' }, META)) as Record<string, unknown>
  assert.equal(missing.code, 'NOT_FOUND')
  assert.match(String(missing.error), /run-typo/)

  h.store.save(stateOf({ plan: planOf({ status: 'paused' }), plannedAt: NOW + 1 }))
  const paused = (await dispatch.handler({ runId: RUN_ID }, META)) as Record<string, unknown>
  assert.equal(paused.code, 'PAUSED', '暂停闸门必须在派发前拦下（与面板 act 同一条判据）')

  h.store.save(
    stateOf({
      plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'running', memberId: 'member-1' })] }),
      bindings: [{ taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW + 2 }],
      plannedAt: NOW + 2,
    }),
  )
  const already = (await dispatch.handler({ runId: RUN_ID }, META)) as Record<string, unknown>
  // r16 AC-6：已自动派发不是错误 —— 工具层把它翻译成幂等确认（面板 act 仍拿 PLAN_ALREADY_DISPATCHED）。
  assert.equal(already.ok, true, '已派发必须是幂等确认，不是错误码')
  assert.equal(already.accepted, true)
  assert.equal(already.dispatching, true)
  assert.equal(already.alreadyDispatched, true)
  assert.equal(already.planStatus, 'dispatching')
  assert.deepEqual(already.ready, [], '幂等确认不预支新的就绪任务')
  assert.deepEqual(already.notices, ['此前已自动派发：成员已在运行，本次未重复起人'])
  assert.equal((already.members as unknown[]).length, 1, '成员数取真实快照，不重复起人')

  const empty = (await dispatch.handler({}, META)) as Record<string, unknown>
  assert.equal(empty.ok, false)
  assert.match(String(empty.error), /必须带 runId/)

  assert.deepEqual(h.calls.kicks, [], '任何拒绝都不得先把后台派发 kick 出去')
})

test('r16 AC-6：已自动派发时连续两次 dispatch 都是幂等确认 —— 成员/binding/状态都不增', async () => {
  const h = setup()
  h.store.save(
    stateOf({
      plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', { status: 'running', memberId: 'member-1' })] }),
      bindings: [{ taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW + 2 }],
      plannedAt: NOW + 2,
    }),
  )
  await enable(h.bridge)
  const { dispatch } = specsOf(h, {
    autoDispatch: (sessionId, runId, cause) => h.calls.kicks.push({ sessionId, runId, cause }),
  })

  const before = h.store.load(RUN_ID)
  assert.ok(before)
  const first = (await dispatch.handler({ runId: RUN_ID }, META)) as Record<string, unknown>
  // 连续第二次：幂等确认必须可重复（模型可能在同一轮按旧习惯再确认一次）。
  const second = (await dispatch.handler({ runId: RUN_ID }, META)) as Record<string, unknown>
  for (const result of [first, second]) {
    assert.equal(result.ok, true)
    assert.equal(result.alreadyDispatched, true)
    assert.equal((result.members as unknown[]).length, 1, '成员数不得因重复调用而增加')
    assert.deepEqual(result.ready, [])
  }

  const after = h.store.load(RUN_ID)
  assert.ok(after)
  assert.equal(after.bindings.length, before.bindings.length, 'binding 数不得增加')
  assert.deepEqual(
    after.plan.tasks.map((task) => task.status),
    before.plan.tasks.map((task) => task.status),
    '任务状态不得被幂等确认推进',
  )
  assert.deepEqual(h.calls.kicks, [], '幂等确认零 kick（否则后台会重复派发）')
  assert.equal(h.calls.dispatch, 0, '幂等确认不走同步 spawn 端口')
})

test('面板路径不变：bridge.act(dispatch) 仍同步 await 派发端口并回「已创建 N 个成员」', async () => {
  const h = setup()
  h.store.save(stateOf())
  await enable(h.bridge)

  const result = await h.bridge.act(SESSION, { type: 'dispatch', runId: RUN_ID })
  assert.equal(result.rejected, undefined)
  assert.equal(h.calls.dispatch, 1, '面板派发仍走同步端口（与工具受理制有意不同）')
  assert.ok((result.notices ?? []).some((text) => text.includes('已创建 1 个成员')))
  assert.equal(h.store.load(RUN_ID)?.plan.status, 'dispatching')
})

test('t5 复用：跨 run 复用空闲成员时提示「已复用」而不是「已创建」', async () => {
  const h = setup({
    dispatchImpl: async (state) => {
      h.store.save({
        ...state,
        plan: {
          ...state.plan,
          status: 'dispatching',
          tasks: state.plan.tasks.map((task) =>
            task.status === 'pending' ? { ...task, status: 'running' as const, memberId: 'member-1' } : task,
          ),
        },
        bindings: [
          ...state.bindings,
          { taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW + 5 },
        ],
      })
      return { started: ['t1'], skipped: [], errors: [] }
    },
  })
  // 上一轮 run 已收口，它的成员就是本轮的复用来源（正是「跑两轮就把 8 个名额用完」的场景）。
  h.store.save(
    stateOf({
      plan: planOf({ runId: 'run-r14-prev', createdAt: NOW - 1000, status: 'terminated', tasks: [taskOf('t0', { status: 'done' })] }),
      bindings: [{ taskId: 't0', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW - 1000 }],
      plannedAt: NOW - 1,
    }),
  )
  h.store.save(stateOf())
  await enable(h.bridge)

  const result = await h.bridge.act(SESSION, { type: 'dispatch', runId: RUN_ID })
  const notices = (result.notices ?? []).join('\n')
  assert.match(notices, /已复用 1 个空闲成员/, `复用不能报成新建：${notices}`)
  assert.doesNotMatch(notices, /已创建/, '复用没有创建成员，面板成员数必须与宿主真实名额一致')
})

test('AC-3：后台全失败 → 活动流（kind=status）+ auto_team_status.dispatch 段都看得见；成功后清掉旧文案', async () => {
  const h = setup({ dispatchImpl: async () => ({ started: [], skipped: [], errors: [{ taskId: 't1', error: 'spawn 失败' }] }) })
  h.store.save(stateOf())
  await enable(h.bridge)

  const notes = createDispatchNotes(() => NOW)
  const dispatcher = createAutoDispatcher({
    store: h.store,
    dispatch: h.deps.dispatch,
    now: () => NOW,
    onError: (runId, text) => notes.add(runId, text),
    onClear: (runId) => notes.clear(runId),
  })
  const bridge = createBridge({ ...h.deps, dispatchNotices: notes })
  const { byName } = specsOf(
    { ...h, bridge },
    { dispatchReports: (sessionId) => dispatcher.reportsOf(sessionId) },
  )
  const statusSpec = byName.get('auto_team_status')
  assert.ok(statusSpec, 'auto_team_status 必须存在')

  const reports = await dispatcher.tick()
  assert.equal(reports.length, 1)
  assert.equal(reports[0].started.length, 0)
  assert.equal(reports[0].failed, 1)
  assert.match(reports[0].errors[0], /spawn 失败/)

  // ① 既有活动流：不新增 ActivityEvent 形状，复用 kind='status' + source='trigger'。
  const snapshot = bridge.snapshot(SESSION)
  const notice = snapshot.activity.find((event) => event.kind === 'status' && event.source === 'trigger' && event.text.includes('派发失败'))
  assert.ok(notice, `活动流里必须有失败通知：${JSON.stringify(snapshot.activity)}`)
  assert.match(notice.text, /spawn 失败/)

  // ② 工具可查：dispatch 段带 errors，不然「已接受派发」之后没有任何解释窗口。
  const status = (await statusSpec.handler({}, META)) as Record<string, unknown>
  const segment = status.dispatch as Array<Record<string, unknown>>
  assert.equal(segment.length, 1)
  assert.equal(segment[0].cause, 'tick')
  assert.deepEqual(segment[0].started, [], 'started 是任务 id 数组（不是条数）')
  assert.equal(segment[0].failed, 1)
  assert.match(String((segment[0].errors as string[])[0]), /spawn 失败/)

  // ③ 成功一批后清掉旧失败（面板不该一直挂着已经过期的红字）。
  const okDispatcher = createAutoDispatcher({
    store: h.store,
    dispatch: async (state) => {
      h.store.save({
        ...state,
        plan: { ...state.plan, status: 'dispatching', tasks: state.plan.tasks.map((task) => ({ ...task, status: 'running' as const })) },
        bindings: [{ taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW + 3 }],
      })
      return { started: ['t1'], skipped: [], errors: [] }
    },
    now: () => NOW,
    onError: (runId, text) => notes.add(runId, text),
    onClear: (runId) => notes.clear(runId),
  })
  await okDispatcher.tick()
  assert.deepEqual(notes.recent(RUN_ID), [], '成功之后旧失败必须被清掉')
  dispatcher.dispose()
  okDispatcher.dispose()
})

test('dispatch-notices：cap 5 + 同文案去重（进程内环，不是账本）', () => {
  const notes = createDispatchNotes(() => NOW)
  for (let i = 0; i < 7; i += 1) notes.add(RUN_ID, `失败 ${i}`)
  assert.equal(notes.recent(RUN_ID).length, 5)
  assert.equal(notes.recent(RUN_ID)[4].text, '失败 6', '只留最近 5 条')

  notes.add(RUN_ID, '失败 6')
  assert.equal(notes.recent(RUN_ID).length, 5, '同一句重复失败不该把环塞满')

  const view = notes.recent(RUN_ID)
  view[0].text = '被外部改动'
  assert.equal(notes.recent(RUN_ID)[0].text, '失败 2', 'recent 必须回副本（调用方改不到内部状态）')

  notes.clear(RUN_ID)
  assert.deepEqual(notes.recent(RUN_ID), [])
})
