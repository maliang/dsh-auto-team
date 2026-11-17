/**
 * r43 QA 回归：**任务级暂停**（`pauseTask`/`resumeTask`）与**团队级暂停**（`pause`/`resumeTeam`）
 * 两级互不干扰。r7 只有团队级（把 running/ready 冻进 `RunState.pause`），r37 加了任务级
 * （把单张卡冻住、原状态记在 `RunState.taskPauses`）。两级各自能冻谁、谁能被自动收口、
 * 谁能解开谁，是这次回归的全部内容。
 *
 * 断言纪律（沿用本项目教训）：
 *  - 每条断言先问「把实现改回错误版本，它必然变红吗」——「互不干扰」用**对照实验**：
 *    只暂停 t1 时 t2 的 dispatch/receipt 端口计数必须照常 +1（计数可分，不是看提示文案）；
 *  - 落盘断言读**真实 run 文件**（sha256 / JSON 字段），不信内存里的返回值 ——
 *    「返回体说 paused、磁盘上没变」正是本项目出过的假绿；
 *  - 幂等断言比字节：第二次 `pauseTask` 后文件 sha256 必须逐字节不变（`at` 不变、账本不追加）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MemberBinding, PanelAction, Plan, PlanTask, Role, TaskStatus } from '../src/shared/types.ts'
import { createBridge, type Bridge, type BridgeDeps } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import {
  RUN_STATE_VERSION,
  RunsStore,
  lastActivityAtOf,
  reconcileStalePlans,
  type RunState,
} from '../src/host/store.ts'
import { TASK_STATUS_LABELS, taskActionAllowed, taskActionDisabledReason } from '../src/shared/task-actions.ts'
import { TEAM_PAUSE_TITLE, TEAM_RESUME_TITLE, pauseButtonView } from '../src/client/ui.ts'
import {
  TASK_PAUSE_TITLE,
  taskPauseActionOf,
  taskPauseAriaLabelOf,
  taskPauseCommandOf,
  taskPauseLabelOf,
} from '../src/client/viewmodel.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r43'
const STALE_MS = 90_000
const RUN_ID = 'run-r43'

interface Calls {
  dispatch: number
  resume: number
  receipts: number
}

interface Harness {
  dir: string
  runsDir: string
  store: RunsStore
  bridge: Bridge
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
    runId: RUN_ID,
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
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r43-'))
  const runsDir = join(dir, 'runs')
  const store = new RunsStore(runsDir)
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
    // 端口只计数：两级暂停哪一级在拦，只有「调用次数」能分得清（文案两边都可能出现「暂停」）。
    dispatch: async () => {
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
    stallMs: STALE_MS,
  }

  // 先 createBridge 再 save：构造期会跑 `reconcileStalePlans`，先落盘旧 run 会被立即收口。
  return { dir, runsDir, store, bridge: createBridge(deps), calls }
}

async function enable(bridge: Bridge): Promise<void> {
  const result = await bridge.act(SESSION, { type: 'toggle', enabled: true })
  assert.equal(result.rejected, undefined, '启用动作本身不应被拒')
}

function runFileOf(h: Harness, runId = RUN_ID): string {
  return join(h.runsDir, `${runId}.json`)
}

function rawOf(h: Harness, runId = RUN_ID): string {
  return readFileSync(runFileOf(h, runId), 'utf8')
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function diskOf(h: Harness, runId = RUN_ID): RunState {
  return JSON.parse(rawOf(h, runId)) as RunState
}

function taskOnDisk(h: Harness, taskId: string): PlanTask {
  const task = diskOf(h).plan.tasks.find((item) => item.id === taskId)
  assert.ok(task, `磁盘上必须有任务 ${taskId}`)
  return task
}

function messageBodies(state: RunState): string[] {
  return (state.messages ?? []).map((message) => message.body)
}

/* ───────────────────────── 1) 任务级暂停：落盘 / 幂等 / 还原 ───────────────────────── */

test('AC1 pauseTask：status=paused 且 taskPauses[tid]={at,from} 同一次落盘到真实 run 文件', async () => {
  const h = setup()
  await enable(h.bridge)
  h.store.save(
    stateOf({
      plan: planOf({ tasks: [taskOf('t1', { status: 'running', memberId: 'member-1' })] }),
      bindings: [bindingOf()],
    }),
  )

  const result = await h.bridge.act(SESSION, { type: 'pauseTask', taskId: 't1' })
  assert.equal(result.rejected, undefined, '运行中的任务必须允许暂停')
  assert.match(result.notices?.[0] ?? '', /已暂停任务 t1（运行中 → 已暂停）/, '文案带出来源与目标状态')

  const disk = diskOf(h)
  assert.equal(taskOnDisk(h, 't1').status, 'paused', '任务状态必须落盘为 paused')
  assert.deepEqual(disk.taskPauses?.['t1'], { at: NOW, from: 'running' }, '原状态记录必须与原状态同一次落盘')
  assert.ok(messageBodies(disk).includes('已暂停任务 t1'), '账本必须留一条「已暂停任务 t1」')
  // 成员不被打断：任务级暂停只掐派发/回执/推进，不杀在跑的人（binding 原样保留）。
  assert.equal(disk.bindings?.[0]?.memberId, 'member-1', '暂停不得删成员绑定')
})

test('AC1 幂等：重复 pauseTask 不改 at、不重复写账本（文件 sha256 逐字节不变）', async () => {
  const h = setup()
  await enable(h.bridge)
  h.store.save(stateOf({ plan: planOf({ tasks: [taskOf('t1', { status: 'ready' })] }) }))

  const first = await h.bridge.act(SESSION, { type: 'pauseTask', taskId: 't1' })
  assert.equal(first.rejected, undefined)
  const afterFirst = rawOf(h)
  const paused = diskOf(h).taskPauses?.['t1']
  assert.deepEqual(paused, { at: NOW, from: 'ready' })

  const second = await h.bridge.act(SESSION, { type: 'pauseTask', taskId: 't1' })
  assert.equal(second.rejected, undefined, '重复暂停是幂等成功，不是错误')
  assert.match(second.notices?.[0] ?? '', /已处于暂停状态/, '幂等分支要说清「无需重复暂停」')
  assert.equal(rawOf(h), afterFirst, '幂等分支不许写盘：at 不变、账本不追加')
  assert.equal(
    messageBodies(diskOf(h)).filter((body) => body === '已暂停任务 t1').length,
    1,
    '账本里「已暂停任务 t1」只能有一条',
  )
})

test('AC1 resumeTask：按 from 还原为 running、删掉记账键；记录缺失时回落 ready', async () => {
  const h = setup()
  await enable(h.bridge)
  h.store.save(
    stateOf({
      plan: planOf({ tasks: [taskOf('t1', { status: 'running', memberId: 'member-1' })] }),
      bindings: [bindingOf()],
    }),
  )
  await h.bridge.act(SESSION, { type: 'pauseTask', taskId: 't1' })

  const resumed = await h.bridge.act(SESSION, { type: 'resumeTask', taskId: 't1' })
  assert.equal(resumed.rejected, undefined)
  const disk = diskOf(h)
  assert.equal(taskOnDisk(h, 't1').status, 'running', '按 taskPauses.from 还原为运行中')
  assert.equal(disk.taskPauses, undefined, '唯一的记录被删掉后，taskPauses 必须整个省略（不写空对象）')
  assert.ok(!('taskPauses' in (JSON.parse(rawOf(h)) as Record<string, unknown>)), '落盘 JSON 里不许留空 taskPauses')
  assert.ok(messageBodies(disk).includes('已继续任务 t1'))
  // 成员还在（本用例绑定了 member-1）：本动作不判 failed，也不擅自改 interrupted。
  assert.equal(taskOnDisk(h, 't1').memberId, 'member-1')

  // 记录缺失（旧账 / 坏数据）→ 回落 ready，不猜 running。
  h.store.save(stateOf({ plan: planOf({ tasks: [taskOf('t1', { status: 'paused' })] }) }))
  const fallback = await h.bridge.act(SESSION, { type: 'resumeTask', taskId: 't1' })
  assert.equal(fallback.rejected, undefined)
  assert.equal(taskOnDisk(h, 't1').status, 'ready', 'taskPauses 缺失时必须回落 ready')
})

/* ───────────────────────── 2) 互不干扰 ───────────────────────── */

test('AC2 只暂停 t1：t2 仍可派发、仍可提交回执，计划状态不被团队暂停改掉', async () => {
  const h = setup()
  await enable(h.bridge)
  h.store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [
          taskOf('t1', { status: 'running', memberId: 'member-1' }),
          taskOf('t2', { status: 'running', memberId: 'member-2' }),
          taskOf('t3', { status: 'ready' }),
        ],
      }),
      bindings: [bindingOf({ taskId: 't1' }), bindingOf({ taskId: 't2', memberId: 'member-2', name: '开发-2' })],
    }),
  )

  const paused = await h.bridge.act(SESSION, { type: 'pauseTask', taskId: 't1' })
  assert.equal(paused.rejected, undefined)
  assert.equal(diskOf(h).plan.status, 'dispatching', '任务级暂停不改计划状态（没冻结整个团队）')
  assert.equal(diskOf(h).pause, undefined, '任务级暂停不写 RunState.pause')

  // t2 的回执照常（任务级暂停不是回执闸门的全局开关）。
  const receipt = await h.bridge.act(SESSION, { type: 'receipt', taskId: 't2' })
  assert.equal(receipt.rejected, undefined, '只暂停 t1 时 t2 的回执必须放行')
  assert.equal(h.calls.receipts, 1, 't2 的回执必须真的走到门禁执行体')

  // t3（ready 且未绑定）照常可派发。
  const dispatched = await h.bridge.act(SESSION, { type: 'dispatch' })
  assert.equal(dispatched.rejected, undefined, '只暂停 t1 时仍应能派发就绪任务')
  assert.equal(h.calls.dispatch, 1, 'dispatch 必须真的被调用（不是被 PLAN_ALREADY_DISPATCHED 拦掉）')
  assert.equal(taskOnDisk(h, 't1').status, 'paused', '派发不得顺手解冻被暂停的任务')
})

test('AC2 只暂停团队：不写任务级记账、非 running/ready 的任务逐字段不变', async () => {
  const h = setup()
  await enable(h.bridge)
  const untouched = [
    taskOf('t-pending', { status: 'pending' }),
    taskOf('t-blocked', { status: 'blocked', dependsOn: ['t-pending'] }),
    taskOf('t-waiting', { status: 'waiting' }),
    taskOf('t-done', { status: 'done', attempts: 2 }),
    taskOf('t-failed', { status: 'failed', attempts: 3 }),
    taskOf('t-interrupted', { status: 'interrupted' }),
    taskOf('t-gate', { status: 'gate' }),
  ]
  h.store.save(
    stateOf({
      plan: planOf({
        tasks: [
          ...untouched,
          taskOf('t-run', { status: 'running', memberId: 'member-1' }),
          taskOf('t-ready', { status: 'ready' }),
        ],
      }),
      bindings: [bindingOf({ taskId: 't-run' })],
    }),
  )
  const before = diskOf(h).plan.tasks

  const paused = await h.bridge.act(SESSION, { type: 'pause' })
  assert.equal(paused.rejected, undefined)
  const disk = diskOf(h)

  // 团队级仍走 RunState.pause：原状态记在 pause.tasks，而不是任务级 taskPauses。
  assert.equal(disk.plan.status, 'paused')
  assert.deepEqual(disk.pause?.tasks, { 't-run': 'running', 't-ready': 'ready' }, '冻结集合必须记在 RunState.pause')
  assert.equal(disk.taskPauses, undefined, '团队暂停不许写任务级记账（否则两级会互相污染）')
  assert.ok(!('taskPauses' in (JSON.parse(rawOf(h)) as Record<string, unknown>)), '落盘 JSON 里不许出现 taskPauses')

  // 非推进态的任务一个字段都不许动（团队暂停只冻结 running/ready）。
  for (const task of untouched) {
    assert.deepEqual(
      disk.plan.tasks.find((item) => item.id === task.id),
      before.find((item) => item.id === task.id),
      `${task.id}（${task.status}）不在冻结集合里，必须逐字段不变`,
    )
  }
  assert.equal(taskOnDisk(h, 't-run').status, 'paused', 'running 被团队冻结')
  assert.equal(taskOnDisk(h, 't-ready').status, 'paused', 'ready 被团队冻结')
  assert.equal(taskOnDisk(h, 't-run').memberId, 'member-1', '团队暂停同样不中断在跑成员')
})

test('AC2 两级同时存在：resumeTeam 不解开单卡 paused，resumeTask 不解开团队暂停', async () => {
  // 场景 A：团队暂停冻住 t2，用户又单独暂停 t1（from=pending）→ resumeTeam 只解团队那一层。
  const a = setup()
  await enable(a.bridge)
  a.store.save(
    stateOf({
      plan: planOf({
        tasks: [taskOf('t1', { status: 'pending' }), taskOf('t2', { status: 'running', memberId: 'member-2' })],
      }),
      bindings: [bindingOf({ taskId: 't2', memberId: 'member-2', name: '开发-2' })],
    }),
  )
  await a.bridge.act(SESSION, { type: 'pause' })
  const pausedTask = await a.bridge.act(SESSION, { type: 'pauseTask', taskId: 't1' })
  assert.equal(pausedTask.rejected, undefined, '团队暂停时仍应能冻结单张卡（pauseTask 在放行名单里）')
  assert.deepEqual(diskOf(a).taskPauses?.['t1'], { at: NOW, from: 'pending' })

  const resumedTeam = await a.bridge.act(SESSION, { type: 'resumeTeam' })
  assert.equal(resumedTeam.rejected, undefined)
  const afterTeam = diskOf(a)
  assert.equal(afterTeam.plan.status, 'dispatching', '团队继续：计划回到暂停前的状态')
  assert.equal(taskOnDisk(a, 't1').status, 'paused', '**团队继续不得解开单卡暂停**')
  assert.deepEqual(afterTeam.taskPauses?.['t1'], { at: NOW, from: 'pending' }, '任务级记账必须原样保留')
  assert.equal(taskOnDisk(a, 't2').status, 'running', '团队冻结的 t2 按 pause.tasks 还原')
  assert.equal(afterTeam.pause, undefined, '团队继续清掉团队级 pause 记录')

  // 场景 B：团队暂停期间单独解冻单卡 → 只解那一张，团队暂停与其余卡不动。
  const b = setup()
  await enable(b.bridge)
  b.store.save(
    stateOf({
      plan: planOf({
        tasks: [taskOf('t1', { status: 'ready' }), taskOf('t2', { status: 'running', memberId: 'member-2' })],
      }),
      bindings: [bindingOf({ taskId: 't2', memberId: 'member-2', name: '开发-2' })],
    }),
  )
  await b.bridge.act(SESSION, { type: 'pause' })
  await b.bridge.act(SESSION, { type: 'pauseTask', taskId: 't1' })
  // 团队暂停时 t1 已被团队冻成 paused；任务级记账覆盖记录原状态（ready）。
  const resumedOne = await b.bridge.act(SESSION, { type: 'resumeTask', taskId: 't1' })
  assert.equal(resumedOne.rejected, undefined, '团队暂停时仍应能解冻单张卡（resumeTask 在放行名单里）')
  const afterOne = diskOf(b)
  assert.equal(taskOnDisk(b, 't1').status, 'ready', '单卡继续按任务级记录还原')
  assert.equal(afterOne.plan.status, 'paused', '**单卡继续不得解开团队暂停**')
  assert.ok(afterOne.pause !== undefined, '团队级 pause 记录必须还在')
  assert.equal(taskOnDisk(b, 't2').status, 'paused', '团队冻结的其余卡不受影响')
  assert.equal(afterOne.taskPauses, undefined, '单卡继续只删自己那条记账')
})

/* ───────────────────────── 3) 拒绝面与文案 ───────────────────────── */

test('AC3 pauseTask：done/cancelled/skipped 一律 BAD_REQUEST + 矩阵原因逐字，且不写盘', async () => {
  const h = setup()
  await enable(h.bridge)
  h.store.save(
    stateOf({
      plan: planOf({
        tasks: [
          taskOf('t-done', { status: 'done' }),
          taskOf('t-cancelled', { status: 'cancelled' }),
          taskOf('t-skipped', { status: 'skipped' }),
        ],
      }),
    }),
  )
  const before = rawOf(h)

  for (const id of ['t-done', 't-cancelled', 't-skipped']) {
    const status = taskOnDisk(h, id).status
    const result = await h.bridge.act(SESSION, { type: 'pauseTask', taskId: id })
    assert.equal(result.rejected?.code, 'BAD_REQUEST', `${id}：终态不能暂停`)
    // 文案逐字来自矩阵与 taskActionDeniedText 的拼装（面板 title 读的是同一张表）。
    assert.equal(
      result.rejected?.message,
      `任务 ${id} 当前状态为「${TASK_STATUS_LABELS[status]}」，任务已结束，不能暂停`,
      `${id}：拒绝文案必须与矩阵原因逐字一致`,
    )
  }
  assert.equal(rawOf(h), before, '拒绝路径不许写盘（状态与账本都不能动）')
})

test('AC3 resumeTask：对未暂停任务拒绝且不改状态；paused 时 receipt 被拒且文案带任务 id', async () => {
  const h = setup()
  await enable(h.bridge)
  h.store.save(
    stateOf({
      plan: planOf({ tasks: [taskOf('t1', { status: 'ready' }), taskOf('t2', { status: 'ready' })] }),
    }),
  )
  const before = rawOf(h)

  const rejected = await h.bridge.act(SESSION, { type: 'resumeTask', taskId: 't1' })
  assert.equal(rejected.rejected?.code, 'BAD_REQUEST', '没暂停就点继续 → 拒绝（不是幂等成功）')
  assert.equal(rejected.rejected?.message, '该任务没有处于暂停状态（任务 t1 当前为「就绪」）')
  assert.equal(rawOf(h), before, '拒绝路径不许写盘')

  // 任务级暂停后的回执：拒绝码复用 BAD_REQUEST，文案必须说清「先对该任务点继续」，且含任务 id。
  await h.bridge.act(SESSION, { type: 'pauseTask', taskId: 't2' })
  const receiptsBefore = h.calls.receipts
  const receipt = await h.bridge.act(SESSION, { type: 'receipt', taskId: 't2' })
  assert.equal(receipt.rejected?.code, 'BAD_REQUEST', '暂停的任务不能提交回执')
  assert.equal(receipt.rejected?.message, '任务 t2 已暂停：先对该任务点「继续」再提交回执')
  assert.ok(receipt.rejected?.message.includes('t2'), '文案必须含任务 id（用户要知道是哪张卡）')
  assert.equal(h.calls.receipts, receiptsBefore, '被拒的回执不许跑门禁')
})

/* ───────────────────────── 4) 不会被误收口 ───────────────────────── */

test('AC4 lastActivityAtOf 计入 taskPauses.at：暂停着等用户也算活动', () => {
  const state = stateOf({
    plannedAt: NOW - 60 * 60 * 1000,
    plan: planOf({ createdAt: NOW - 60 * 60 * 1000, tasks: [taskOf('t1', { status: 'paused' })] }),
    taskPauses: { t1: { at: NOW - 1_000, from: 'running' } },
  })
  assert.equal(lastActivityAtOf(state), NOW - 1_000, 'taskPauses.at 必须被计入最近活动时刻')
})

test('AC4 reconcileStalePlans：有 pause 记录的 paused 计划跳过，paused 无记录的遗留账仍收口', () => {
  const h = setup()
  const old = NOW - 2 * 60 * 60 * 1000

  // ① 用户显式暂停（plan.status=paused + state.pause 存在）—— 即使全部时刻都超过 30 分钟残留阈值，
  //    也不许被自动收口（用户的显式意图不能被自动收口推翻）。
  h.store.save(
    stateOf({
      plan: planOf({
        runId: 'run-user-paused',
        createdAt: old,
        status: 'paused',
        tasks: [taskOf('t1', { status: 'paused' })],
      }),
      plannedAt: old,
      pause: { at: old, planStatus: 'dispatching', tasks: { t1: 'running' } },
      taskPauses: { t1: { at: old, from: 'running' } },
    }),
  )
  // ② 遗留账：状态是 paused 但**没有** pause 记录（旧文件）—— 仍应被收口成 terminated。
  h.store.save(
    stateOf({
      plan: planOf({
        runId: 'run-legacy-paused',
        createdAt: old,
        status: 'paused',
        tasks: [taskOf('t1', { status: 'paused' })],
      }),
      plannedAt: old,
    }),
  )

  const reconciled = reconcileStalePlans(h.store, { now: NOW, staleMs: 30 * 60 * 1000 })
  assert.deepEqual(reconciled, ['run-legacy-paused'], '只有「paused 无记录」的遗留账可以被收口')

  const userPaused = h.store.load('run-user-paused')
  assert.equal(userPaused?.plan.status, 'paused', '用户显式暂停的计划必须保持 paused')
  assert.equal(userPaused?.termination, undefined, '不许给用户显式暂停的计划打 stale 收口标记')

  const legacy = h.store.load('run-legacy-paused')
  assert.equal(legacy?.plan.status, 'terminated', '无 pause 记录的 paused 遗留账仍要被收口')
  assert.equal(legacy?.termination?.kind, 'stale')
})

/* ───────────────────────── 6) 客户端：两级按钮文案与动作分派 ───────────────────────── */

test('AC6 页头：文案「暂停团队」/「继续团队」，钩子与 title 表明作用域是团队', () => {
  const idle = pauseButtonView({ paused: false, busy: false })
  assert.equal(idle.label, '暂停团队', '页头文案必须是团队级，不许再写「暂停任务」')
  assert.equal(idle.hook, 'data-auto-team-pause')
  assert.equal(idle.action, 'pause')
  assert.equal(idle.title, TEAM_PAUSE_TITLE)
  assert.match(TEAM_PAUSE_TITLE, /不会打断正在跑的成员/, 'title 必须写清在跑成员不被打断')

  const paused = pauseButtonView({ paused: true, busy: false })
  assert.equal(paused.label, '继续团队')
  assert.equal(paused.action, 'resumeTeam')
  assert.equal(paused.title, TEAM_RESUME_TITLE)
  assert.equal(paused.tone, 'warn', '已暂停是琥珀（主动冻结），不是失败红')

  // busy 只置 disabled，不许改文案/动作（AC-15：绝不乐观改文案）。
  const busy = pauseButtonView({ paused: true, busy: true })
  assert.equal(busy.disabled, true)
  assert.equal(busy.label, '继续团队')
  assert.equal(busy.action, 'resumeTeam')
})

test('AC6 任务行：13 态文案/动作/可访问名逐态正确，paused → resumeTask、其余 → pauseTask', () => {
  const statuses: TaskStatus[] = [
    'pending',
    'ready',
    'blocked',
    'waiting',
    'running',
    'rework',
    'failed',
    'interrupted',
    'gate',
    'paused',
    'done',
    'cancelled',
    'skipped',
  ]
  for (const status of statuses) {
    const view = taskPauseActionOf({ id: 't1', status })
    assert.equal(view.action, 'pause', `${status}：数据属性固定为 pause（渲染 data-task-action="pause"）`)
    assert.equal(view.label, taskPauseLabelOf(status), `${status}：文案必须来自同一个纯函数`)
    assert.equal(view.label, status === 'paused' ? '继续此任务' : '暂停此任务', `${status}：两级文案不许混用`)
    assert.equal(view.ariaLabel, taskPauseAriaLabelOf('t1', status))
    // r9vi3s/t1：可访问名 = 可见文案 + 任务 id（读屏名与按钮文字同前缀，且精确到卡）。
    assert.equal(view.ariaLabel, status === 'paused' ? '继续此任务 t1' : '暂停此任务 t1')
    assert.equal(view.ariaLabel, `${view.label} t1`, `${status}：读屏名必须以可见文案为前缀`)

    const command: Extract<PanelAction, { taskId: string }> = taskPauseCommandOf('t1', status)
    const expectType = status === 'paused' ? 'resumeTask' : 'pauseTask'
    assert.equal(command.type, expectType, `${status}：点击必须发出 ${expectType}`)
    assert.equal(command.taskId, 't1')

    const allowed = taskActionAllowed('pause', status)
    assert.equal(view.disabled, !allowed, `${status}：disabled 必须与矩阵同源`)
    if (allowed) {
      assert.equal(view.title, TASK_PAUSE_TITLE, `${status}：可用时 title 写清「只冻结这一张卡」`)
      assert.equal(view.reason, undefined)
    } else {
      assert.equal(view.reason, taskActionDisabledReason('pause', status), `${status}：禁用原因逐字来自矩阵`)
      assert.equal(view.title, undefined, '禁用时 title 位让给 reason，不许两份文案争同一个位置')
    }
  }
})

test('AC6 组件源码：任务行的 pause 按钮带 data-task-action="pause" 且按状态分派；页头不写字面量', () => {
  const table = readFileSync(join(import.meta.dirname, '../src/client/views/TaskTable.tsx'), 'utf8')
  assert.match(table, /data-task-action="pause"/, '任务行按钮必须带 data-task-action="pause"')
  assert.match(table, /taskPauseCommandOf\(task\.id, task\.status\)/, '点击必须按状态分派 resumeTask/pauseTask')
  assert.match(table, /row\.pauseAction\.label/, '文案必须来自 viewmodel，组件里不许写第二份')
  assert.match(
    table,
    /data-paused=\{task\.status === 'paused' \? 'true' : 'false'\}/,
    'paused 态要有可区分的 DOM 状态位（行内「单卡已暂停」与顶部团队横幅分开）',
  )
  // 状态徽标仍在标题行（badge 来自 viewmodel 的 TASK_BADGES）：单卡「已暂停」是行内琥珀，
  // 与顶部团队横幅靠位置区分 —— 按钮独占一行不许把徽标挤掉。
  assert.match(table, /data-badge data-tone=\{row\.badge\.tone\}/, '标题行的状态徽标不许被动作按钮挤掉')
  const viewmodel = readFileSync(join(import.meta.dirname, '../src/client/viewmodel.ts'), 'utf8')
  assert.match(
    viewmodel,
    /paused: \{ icon: '⏸', text: TASK_STATUS_LABELS\.paused, tone: 'warn' \}/,
    '单卡已暂停必须是行内琥珀徽标（不是失败红、不是中性灰）',
  )

  const header = readFileSync(join(import.meta.dirname, '../src/client/views/RunHeader.tsx'), 'utf8')
  assert.match(header, /data-auto-team-pause/, '页头按钮的钩子必须保留')
  assert.match(header, /pause\.label/, '页头文案来自 viewmodel')
  assert.doesNotMatch(header, /['"`]暂停['"`]/, '页头不许再写裸「暂停」字面量')
  assert.doesNotMatch(header, /['"`]继续['"`]/, '页头不许再写裸「继续」字面量（文案只在 ui.ts 一处）')
})
