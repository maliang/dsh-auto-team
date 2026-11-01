/**
 * r7 T2：暂停 / 继续的状态机级单测（AC-9 / AC-15 / AC-16 / AC-20）。
 *
 * 为什么单独一个文件而不是塞进 bridge.test.ts：暂停是**一次事务**（计划状态 + 每条任务的原状态
 * 原子落盘同一个 `RunState.pause`），它同时影响 bridge（动作闸门）、store（归一化）、watcher
 * （掐推进不掐对账）三方。放在一起能把「暂停到底动了什么、没动什么」逐条钉住。
 *
 * 断言纪律（沿用本项目教训）：每条断言都要问「把实现改回错误版本，它必然变红吗」——
 *  - 「done 不变」逐字段深比较（status / evidence / attempts / memberId 全都比），
 *    而不是只看 status（只看 status 时把 done 改成 paused 也照样绿）；
 *  - 「暂停期间不派发」断言端口调用次数 0（计数可分），不是断言某个提示文案；
 *  - watcher 的「掐推进」用**对照实验**：同一份状态，未暂停时必然告警 1 条 + 轮询 1 次，
 *    暂停时必然 0 / 0，同时另一个 gate 任务仍被对账成 interrupted（证明对账没被掐）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MemberBinding, Plan, PlanTask, Role } from '../src/shared/types.ts'
import { createBridge, type Bridge, type BridgeDeps } from '../src/host/bridge.ts'
import { applyReceipt, dispatchReady, resumeRun } from '../src/host/team/dispatch.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { createMemberWatcher, type HostMember } from '../src/host/team/watcher.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-pause'
const STALL_MS = 90_000

interface Calls {
  dispatch: number
  resume: number
  receipts: number
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
  return { taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW, ...over }
}

function planOf(over: Partial<Plan> = {}): Plan {
  return {
    runId: 'run-pause',
    sessionId: SESSION,
    createdAt: NOW,
    status: 'dispatching',
    tasks: [taskOf('t1')],
    maxConcurrent: 3,
    ...over,
  }
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: planOf(),
    plannedAt: NOW,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...over,
  }
}

function setup(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-pause-'))
  const store = new RunsStore(join(dir, 'runs'))
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir, now: () => NOW })
  roles.seed()
  roles.save(roleOf('dev', '开发'))
  const artifactsDir = join(dir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })

  const calls: Calls = { dispatch: 0, resume: 0, receipts: 0 }

  const deps: BridgeDeps = {
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    // 端口只计数 + 记录是否被调用：暂停期间这三者必须一次都不动（AC-16 的可分判据）。
    dispatch: async (state) => {
      calls.dispatch += 1
      return { started: [], skipped: [], errors: [] }
    },
    resume: async () => {
      calls.resume += 1
      return { resumed: 0, skipped: 0, unchanged: true }
    },
    applyReceipt: (state) => {
      calls.receipts += 1
      return state
    },
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir },
    now: () => NOW,
    // 停滞阈值固定成 90s（与缺省一致，但显式注入让测试不依赖 config 的取值）。
    stallMs: STALL_MS,
  }

  return { dir, store, roles, bridge: createBridge(deps), deps, calls }
}

async function enable(bridge: Bridge): Promise<void> {
  const result = await bridge.act(SESSION, { type: 'toggle', enabled: true })
  assert.equal(result.rejected, undefined, '启用动作本身不应被拒')
}

/** 一次真实的暂停前状态：一个 done（带证据与 attempts）、一个 running、一个 ready、一个 failed。 */
function mixedState(): RunState {
  const doneTask = taskOf('t-done', {
    status: 'done',
    memberId: 'member-done',
    attempts: 2,
    evidence: { taskId: 't-done', command: 'pnpm -s test', exitCode: 0, tail: 'ok', artifacts: [], at: NOW - 5_000 },
  })
  return stateOf({
    plan: planOf({
      status: 'dispatching',
      tasks: [
        doneTask,
        taskOf('t-run', { status: 'running', memberId: 'member-1' }),
        taskOf('t-ready', { status: 'ready' }),
        taskOf('t-fail', { status: 'failed', attempts: 3 }),
      ],
    }),
    bindings: [bindingOf()],
  })
}

test('暂停冻结 running/ready，原状态记进 RunState.pause，done/failed 逐字段不变（AC-9）', async () => {
  const { bridge, store } = setup()
  const before = mixedState()
  store.save(before)
  await enable(bridge)

  const result = await bridge.act(SESSION, { type: 'pause' })
  assert.equal(result.rejected, undefined, '有计划的暂停必须成功')
  assert.equal(result.snapshot.paused, true, '快照必须立刻反映暂停态（客户端只依赖快照）')
  assert.equal(result.snapshot.planStatus, 'paused')
  assert.equal(result.snapshot.pausedAt, NOW, 'pausedAt 来自 pause.at（不是 Date.now() 现算）')

  const after = store.load(before.plan.runId)
  assert.ok(after, '暂停必须落盘（重启后还要认得出）')
  const byId = new Map(after!.plan.tasks.map((task) => [task.id, task]))
  assert.equal(byId.get('t-run')?.status, 'paused', 'running 冻结成 paused')
  assert.equal(byId.get('t-ready')?.status, 'paused', 'ready 也冻结（它马上就要被派发）')
  // done 是终态：整体深比较，任何一处被改写都红（只看 status 的断言抓不到 evidence 被清空）。
  assert.deepEqual(byId.get('t-done'), before.plan.tasks[0], 'done 任务必须逐字段不变（含 evidence/attempts/memberId）')
  assert.deepEqual(byId.get('t-fail'), before.plan.tasks[3], 'failed 任务必须逐字段不变')

  const pause = after!.pause
  assert.ok(pause, '暂停记账必须存在（resumeTeam 的唯一还原依据）')
  assert.equal(pause!.at, NOW)
  assert.equal(pause!.planStatus, 'dispatching', '必须记下「暂停前是什么」，否则继续时还原不出正确状态')
  assert.deepEqual(pause!.tasks, { 't-run': 'running', 't-ready': 'ready' }, '只记被冻结的两个，原状态逐字')
})

test('暂停期间 dispatch/resume/receipt 一律 PAUSED，端口计数全 0、attempts 不变（AC-16）', async () => {
  const { bridge, store, calls } = setup()
  const before = mixedState()
  store.save(before)
  await enable(bridge)
  await bridge.act(SESSION, { type: 'pause' })
  const attemptsBefore = new Map(store.load(before.plan.runId)!.plan.tasks.map((task) => [task.id, task.attempts]))

  const blocked = [
    { type: 'dispatch' as const },
    { type: 'resume' as const },
    { type: 'receipt' as const, taskId: 't-run' },
  ]
  for (const action of blocked) {
    const result = await bridge.act(SESSION, action)
    assert.equal(result.rejected?.code, 'PAUSED', `${action.type} 在暂停期间必须被 PAUSED 拒绝`)
    assert.match(result.rejected!.message, /继续任务/, '拒绝文案必须告诉用户点哪儿（否则只能盲点）')
  }
  assert.equal(calls.dispatch, 0, '暂停期间派发端口一次都不能被调用')
  assert.equal(calls.resume, 0, '暂停期间恢复端口一次都不能被调用')
  assert.equal(calls.receipts, 0, '暂停期间门禁回执一次都不能被调用')

  const after = store.load(before.plan.runId)!
  for (const task of after.plan.tasks) {
    assert.equal(task.attempts, attemptsBefore.get(task.id), `${task.id} 的 attempts 不能因被拒绝的动作变化`)
  }
  assert.equal(after.plan.status, 'paused', '被拒的动作不许顺手改计划状态')

  // 放行的动作：暂停期间仍然能用（否则用户只能先「继续」才能发消息/停用，是反向体验）。
  for (const action of [{ type: 'message' as const, text: '先暂停一下，问个问题' }, { type: 'cancel' as const }]) {
    const result = await bridge.act(SESSION, action)
    assert.notEqual(result.rejected?.code, 'PAUSED', `${action.type} 暂停期间必须放行`)
  }
})

test('继续：按原状态还原（running→running、ready→ready），计划状态回退、pause 记账删除、done 不重跑', async () => {
  const { bridge, store } = setup()
  const before = mixedState()
  store.save(before)
  await enable(bridge)
  await bridge.act(SESSION, { type: 'pause' })

  const result = await bridge.act(SESSION, { type: 'resumeTeam' })
  assert.equal(result.rejected, undefined, '继续必须成功')
  assert.equal(result.snapshot.paused, false)
  assert.equal(result.snapshot.pausedAt, undefined, '继续后不许再带 pausedAt（否则按钮会闪回「暂停中」）')
  assert.equal(result.snapshot.planStatus, 'dispatching', '计划状态回到暂停前的值')

  const after = store.load(before.plan.runId)!
  const byId = new Map(after.plan.tasks.map((task) => [task.id, task]))
  assert.equal(byId.get('t-run')?.status, 'running', 'running 原样还原（不是一律 ready）')
  assert.equal(byId.get('t-ready')?.status, 'ready', 'ready 原样还原')
  assert.deepEqual(byId.get('t-done'), before.plan.tasks[0], 'done 绝不被继续动作回退')
  assert.equal(after.pause, undefined, 'pause 记账必须删除（留着会让下一次暂停读到旧账）')

  // 复原到暂停前：除 plan.status/pause 外任务集合逐字相等 —— 这才是「从中断的地方继续」。
  const statuses = after.plan.tasks.map((task) => task.status)
  assert.deepEqual(statuses, before.plan.tasks.map((task) => task.status), '四个任务状态逐一回到暂停前')
})

test('幂等：重复暂停不覆盖 pause.at；未暂停时继续是 no-op（不报错、不写盘）', async () => {
  const { bridge, store } = setup()
  const before = mixedState()
  store.save(before)
  await enable(bridge)

  await bridge.act(SESSION, { type: 'pause' })
  const first = store.load(before.plan.runId)!
  // 判据用「消息条数与 pause 记录都没被重写」，而不是「时间戳相同」——同一个注入时钟下
  // 时间戳本来就相同，那种断言即使实现真的重建了记录也照样绿（恒绿型断言）。
  const messageCount = first.messages.length
  const again = await bridge.act(SESSION, { type: 'pause' })
  assert.equal(again.rejected, undefined, '重复暂停不是错误（用户会多点）')
  const after = store.load(before.plan.runId)!
  assert.equal(after.messages.length, messageCount, '重复暂停不许再写一条消息（也不是错误提示）')
  assert.deepEqual(after.pause, first.pause, '重复暂停不许改动 pause 记账')

  // 未暂停的另一个 run：继续是 no-op。
  const fresh = setup()
  const plain = mixedState()
  plain.plan.status = 'dispatching'
  fresh.store.save(plain)
  await enable(fresh.bridge)
  const noop = await fresh.bridge.act(SESSION, { type: 'resumeTeam' })
  assert.equal(noop.rejected, undefined, '没暂停时点继续不该报错')
  assert.equal(fresh.store.load(plain.plan.runId)!.plan.status, 'dispatching', '不该顺手把计划状态改掉')
})

test('无计划暂停 → NO_PLAN；计划已结束（terminated/cancelled）→ BAD_REQUEST 且状态不变', async () => {
  const { bridge, store } = setup()
  await enable(bridge)
  const none = await bridge.act(SESSION, { type: 'pause' })
  assert.equal(none.rejected?.code, 'NO_PLAN', '没有计划时暂停必须明确拒绝')

  for (const status of ['terminated', 'cancelled'] as const) {
    const state = stateOf({ plan: planOf({ status }) })
    store.save(state)
    for (const action of [{ type: 'pause' as const }, { type: 'resumeTeam' as const }]) {
      const result = await bridge.act(SESSION, action)
      assert.equal(result.rejected?.code, 'BAD_REQUEST', `${status} 时 ${action.type} 必须被拒`)
      assert.match(result.rejected!.message, /已结束/, '文案要说清「计划已结束」而不是笼统失败')
      assert.equal(store.load(state.plan.runId)!.plan.status, status, '被拒的动作不许改计划状态')
    }
  }
})

test('重启后仍认出暂停态：plan.status 是权威判据，pausedAt 来自 pause.at', async () => {
  const { bridge, store, deps } = setup()
  const before = mixedState()
  store.save(before)
  await enable(bridge)
  await bridge.act(SESSION, { type: 'pause' })

  const reopened = createBridge(deps) // 新实例 = 重启后的插件实例（内存态全丢）
  const snapshot = reopened.snapshot(SESSION)
  assert.equal(snapshot.paused, true, '重启后必须仍然显示暂停（不能靠内存变量记暂停）')
  assert.equal(snapshot.pausedAt, NOW)
  assert.equal(snapshot.settings?.stallMs, STALL_MS, '快照要带生效设置（设置页回显的唯一来源）')
  assert.ok((snapshot.skills?.length ?? 0) > 0, '快照要带技能只读投影（设置页勾选技能要用）')

  const resumed = await reopened.act(SESSION, { type: 'resumeTeam' })
  assert.equal(resumed.rejected, undefined, '重启后继续必须照常工作')
  assert.equal(store.load(before.plan.runId)!.plan.status, 'dispatching')
})

test('暂停态下计划里的 running 任务不被判停滞，但仍照常对账（AC-20 对照实验）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-pause-watch-'))
  const store = new RunsStore(join(dir, 'runs'))
  const spawnedAt = NOW - STALL_MS * 10

  // 两个任务：t-run 成员活着但很久没动静（未暂停时必然告警）；t-gate 成员已经没了（必须被对账成中断）。
  const state = stateOf({
    plan: planOf({
      status: 'paused',
      tasks: [
        taskOf('t-run', { status: 'running', memberId: 'member-1' }),
        taskOf('t-gate', { status: 'gate', memberId: 'member-2' }),
      ],
    }),
    bindings: [
      bindingOf({ taskId: 't-run', memberId: 'member-1', name: '开发-1', spawnedAt }),
      bindingOf({ taskId: 't-gate', memberId: 'member-2', name: '测试-1', spawnedAt }),
    ],
    progress: { 'member-1': { at: spawnedAt } },
  })
  store.save(state)

  // 成员名单：只有开发-1 活着（测试-1 已经不在名单里 → 对账判 dead）。
  const members: HostMember[] = [{ id: 'member-1', name: '开发-1', status: 'running' }]
  let polls = 0
  const watcher = createMemberWatcher({
    store,
    listMembers: async () => members,
    now: () => NOW,
    stallMs: STALL_MS,
    onPoll: async () => {
      polls += 1
    },
  })

  const changed = await watcher.tick()
  const pausedState = store.load(state.plan.runId)!
  assert.equal(pausedState.stallAlerts?.length ?? 0, 0, '暂停期间不许产生停滞告警（成员没动静是暂停造成的，不是异常）')
  assert.equal(polls, 0, '暂停期间不许跑 Trigger 轮询兜底（推进被掐住）')
  const gateTask = pausedState.plan.tasks.find((task) => task.id === 't-gate')
  assert.equal(gateTask?.status, 'interrupted', '暂停只掐推进、不掐对账：成员没了必须照样看得见')
  assert.ok(changed > 0, 'tick 必须回报「有变化」（对账改了 gate 任务）')

  // 对照实验（同一份状态改成未暂停）：告警 1 条、轮询 1 次 —— 证明上面两个 0 是「掐掉了」而不是「本来就不会发生」。
  const control = stateOf({
    plan: planOf({
      status: 'dispatching',
      tasks: [taskOf('t-run', { status: 'running', memberId: 'member-1' })],
    }),
    bindings: [bindingOf({ taskId: 't-run', memberId: 'member-1', name: '开发-1', spawnedAt })],
    progress: { 'member-1': { at: spawnedAt } },
  })
  const controlDir = mkdtempSync(join(tmpdir(), 'auto-team-pause-control-'))
  const controlStore = new RunsStore(join(controlDir, 'runs'))
  controlStore.save(control)
  let controlPolls = 0
  const controlWatcher = createMemberWatcher({
    store: controlStore,
    listMembers: async () => [{ id: 'member-1', name: '开发-1', status: 'running' }],
    now: () => NOW,
    stallMs: STALL_MS,
    onPoll: async () => {
      controlPolls += 1
    },
  })
  await controlWatcher.tick()
  const controlAfter = controlStore.load(control.plan.runId)!
  assert.equal(controlAfter.stallAlerts?.length, 1, '未暂停时同一份状态必然告警 1 条（对照可分）')
  assert.equal(controlPolls, 1, '未暂停时必然轮询 1 次（对照可分）')
})

/**
 * 端到端主链路（不是逐个函数的断言）：暂停 → 重启（新 bridge 实例）→ 继续 → 真派发 → 真门禁 → 计划收敛。
 *
 * 为什么必须一条跑到底：暂停的价值全在「继续之后还能从头推进到终止」，逐函数断言在
 * 「pause 记账写对、resume 还原写对」全绿的情况下，也可能因为 plan.status 回落错、pause 没删干净、
 * 冻结任务永远不会重新进可派发集合，导致计划**永远停在暂停那一格**。这里跑到 plan.status='terminated'
 * 并把终态计数打出来，才能证明主路径真的收敛。
 */
test('端到端：暂停 → 重启 → 继续 → 派发 → 门禁 done → 计划收敛到 terminated（终态断言）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-pause-e2e-'))
  const store = new RunsStore(join(dir, 'runs'))
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const artifactsDir = join(dir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir, now: () => NOW })
  roles.seed()
  roles.save(roleOf('dev', '开发'))

  // 真派发 / 真门禁：spawn 只记名字（宿主不在场），门禁真的执行 `acceptance`（这里用 `exit 0`）。
  const spawned: string[] = []
  const members: HostMember[] = []
  const deps: BridgeDeps = {
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch: async (state) =>
      dispatchReady(state, {
        store,
        roles,
        buildPrompt: (input) => `任务：${input.task.title}`,
        listMembers: async () => members,
        spawn: async (input) => {
          spawned.push(input.name)
          const memberId = `m-${input.name}`
          members.push({ id: memberId, name: input.name, status: 'running' })
          return { ok: true, memberId }
        },
        hostConcurrency: () => ({ limit: 8, source: 'host' }),
        now: () => NOW,
      }),
    resume: async (state) => resumeRun(state, { store, listMembers: async () => members, now: () => NOW }),
    applyReceipt: (state, taskId, receipt, at, maxAttempts) => applyReceipt(state, taskId, receipt, at, maxAttempts),
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir },
    now: () => NOW,
  }

  // 两条任务串行：t1 ready（暂停时会被冻结），t2 依赖 t1。
  store.save(
    stateOf({
      plan: planOf({
        tasks: [
          taskOf('t1', { status: 'ready', acceptance: 'exit 0' }),
          taskOf('t2', { status: 'pending', dependsOn: ['t1'], acceptance: 'exit 0' }),
        ],
      }),
    }),
  )

  const first = createBridge(deps)
  await enable(first)

  // ① 暂停：ready 冻结、pending 不动（还没开始的任务不需要记录原状态）。
  const paused = await first.act(SESSION, { type: 'pause' })
  assert.equal(paused.rejected, undefined)
  assert.equal(paused.snapshot.paused, true)
  const frozen = store.load('run-pause')!
  assert.equal(frozen.plan.tasks.find((task) => task.id === 't1')?.status, 'paused')
  assert.equal(frozen.plan.tasks.find((task) => task.id === 't2')?.status, 'pending')
  assert.deepEqual(frozen.pause?.tasks, { t1: 'ready' }, '冻结任务的原状态必须落盘（继续的唯一依据）')
  assert.equal(spawned.length, 0, '暂停期间一个人都不许起')

  // ② 重启：新实例只靠磁盘就必须认出暂停，且继续后能真推进。
  const second = createBridge(deps)
  assert.equal(second.snapshot(SESSION).paused, true, '重启后仍须是暂停态')
  const blocked = await second.act(SESSION, { type: 'dispatch' })
  assert.equal(blocked.rejected?.code, 'PAUSED', '暂停期间点派发必须被闸门拒绝（不是静默不动）')
  assert.equal(spawned.length, 0)

  const resumed = await second.act(SESSION, { type: 'resumeTeam' })
  assert.equal(resumed.rejected, undefined)
  assert.equal(resumed.snapshot.paused, false)
  const thawed = store.load('run-pause')!
  assert.equal(thawed.plan.status, 'dispatching', '计划状态必须回退（否则后续 dispatch 会被纯函数层拦下）')
  assert.equal(thawed.pause, undefined, '继续之后 pause 记账必须删除（不许留成第二条真值）')
  assert.equal(thawed.plan.tasks.find((task) => task.id === 't1')?.status, 'ready', '原状态必须还原')

  // ③ 继续之后真派发 → 真门禁通过 → 下游解锁 → 第二条也派出 → 全部 done。
  const dispatch1 = await second.act(SESSION, { type: 'dispatch' })
  assert.equal(dispatch1.rejected, undefined)
  assert.equal(spawned.length, 1, '继续之后必须真的把 t1 派出去')
  const gate1 = await second.act(SESSION, { type: 'receipt', taskId: 't1' })
  assert.equal(gate1.rejected, undefined, `门禁不该失败：${JSON.stringify(gate1.rejected)}`)
  assert.equal(store.load('run-pause')!.plan.tasks.find((task) => task.id === 't1')?.status, 'done')

  const dispatch2 = await second.act(SESSION, { type: 'dispatch' })
  assert.equal(dispatch2.rejected, undefined)
  assert.equal(spawned.length, 2, '依赖解锁后第二条必须被派出')
  const gate2 = await second.act(SESSION, { type: 'receipt', taskId: 't2' })
  assert.equal(gate2.rejected, undefined)

  // ④ 终态：计划 terminated、2/2 done、暂停标记清除、成员数 2。
  const final = store.load('run-pause')!
  const done = final.plan.tasks.filter((task) => task.status === 'done').length
  assert.equal(done, 2, '终态必须是全部任务 done')
  assert.equal(final.plan.status, 'terminated', `终态计划状态必须是 terminated（实际 ${final.plan.status}）`)
  assert.equal(final.pause, undefined)
  const last = second.snapshot(SESSION)
  assert.equal(last.paused, false, '终态快照必须是「未暂停」（恒为布尔值，前端不必判 undefined）')
  assert.equal(last.pausedAt, undefined, '终态不许再带暂停时间')
  assert.equal(last.members.length, 2)
  assert.equal(last.tasks.filter((task) => task.status === 'done').length, 2, '快照里 2/2 完成（面板页头的数字来源）')
  assert.equal(last.planStatus, 'terminated')
})
