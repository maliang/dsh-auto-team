/**
 * r56 / t3：成员自助（status / review）必须锁到「binding 所在的那个 runId」。
 *
 * 现场证据：r54 的自动验收成员 `qa-review-4xln27` 两次读 `t1` 得到互相矛盾的状态
 * （先「已通过」再「运行中」）——它没带 runId 时落到了当时的活动 run（r56 的 `t1` 正在跑）。
 * `taskId`（如 `t1`）在每个 run 里都存在，靠「活动 run」猜必然串，所以这里造两个同会话的
 * run、各有一个 `t1`，成员 A 归 run1、成员 B 归 run2，逐条钉住：
 *  ① status：A 只看到 run1 的 t1、B 只看到 run2 的 t1（状态不同，串了立刻红）；
 *     成员带错 runId / 别人的 taskId 一律明确拒绝，绝不改投活动 run。
 *  ② review：A 的验收只落在 run1 的 t1，B 的只落在 run2 的 t1；A 带 run2 的 runId 被拒，
 *     且 run2 的 t1 状态、review 字段零变化。
 *  ③ 拒绝文案带「本次请求的 taskId + 成员名下任务列表 + 所属 run」，让下一次一眼定位。
 *  ④ 队长路径（开关打开、非成员）仍按传入 runId 正常读取——成员防护不得误伤队长。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridge, type Bridge } from '../src/host/bridge.ts'
import { createRoleRepo, type RoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { applyReceipt } from '../src/host/team/dispatch.ts'
import { buildToolSpecs, type ToolsDeps } from '../src/host/tools.ts'
import type { ToolSpec } from '../src/host/adapters.ts'
import type { MemberBinding, Plan, PlanTask, TaskStatus } from '../src/shared/types.ts'

const NOW = 1_800_200_000_000
const SESSION = 'sess-r56'
/** 两个 run 属于同一个队长会话：只有这样才能证明「不是靠会话/活动 run 猜」。 */
const RUN1 = 'run-r56-1'
const RUN2 = 'run-r56-2'
const MEMBER_A = 'member-r56-a'
const MEMBER_B = 'member-r56-b'
const AUTHOR_A = 'author-r56-a'
const AUTHOR_B = 'author-r56-b'
const LEADER_META = { agent: { id: SESSION }, callId: 'call-r56' }
const META_A = { agent: { id: MEMBER_A }, callId: 'call-r56-a' }
const META_B = { agent: { id: MEMBER_B }, callId: 'call-r56-b' }

interface Harness {
  store: RunsStore
  bridge: Bridge
  deps: ToolsDeps
  specs: ToolSpec[]
  call(name: string, args?: Record<string, unknown>, meta?: unknown): Promise<Record<string, unknown>>
  state(runId: string): RunState
}

function createHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r56-'))
  const store = new RunsStore(join(dir, 'runs'))
  const roles = createRoleRepo({ dir: join(dir, 'roles'), now: () => NOW })
  roles.seed()

  const bridge = createBridge({
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    // 真实状态机：review 的 pass/fail 会真的推进任务状态，mock 掉它等于把被测逻辑一起 mock 掉。
    applyReceipt,
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
    now: () => NOW,
    interruptMember: async () => ({ ok: true }),
  })
  bridge.setEnabled(SESSION, true)
  // createBridge 构造时会做一次 stale-plan 对账；必须在它之后才 seed run（与 r30 harness 同序）。

  const deps: ToolsDeps = { store, roles, bridge, now: () => NOW }
  const specs = buildToolSpecs(deps)
  return {
    store,
    bridge,
    deps,
    specs,
    async call(name, args = {}, meta = LEADER_META) {
      const spec = specs.find((item) => item.name === name)
      assert.ok(spec, `工具 ${name} 必须存在`)
      return (await spec.handler(args, meta)) as Record<string, unknown>
    },
    state(runId) {
      const state = store.load(runId)
      assert.ok(state, `run ${runId} 必须可读`)
      return state
    },
  }
}

function taskOf(id: string, status: TaskStatus, extra: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'exit 0',
    status,
    ...extra,
  }
}

function bindingOf(taskId: string, name: string, extra: Partial<MemberBinding> = {}): MemberBinding {
  return {
    taskId,
    roleId: 'dev',
    memberId: `member-${taskId}`,
    name,
    spawnedAt: NOW - 10_000,
    ...extra,
  }
}

function planOf(over: Partial<Plan> = {}): Plan {
  return {
    runId: RUN1,
    sessionId: SESSION,
    createdAt: NOW - 60_000,
    status: 'dispatching',
    goal: 'r56 跨 run 同名 taskId',
    tasks: [taskOf('t1', 'review', { memberId: AUTHOR_A })],
    maxConcurrent: 2,
    revisions: [],
    ...over,
  }
}

function runStateOf(over: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: planOf(),
    plannedAt: NOW - 60_000,
    messages: [],
    bindings: [bindingOf('t1', '作者-1', { memberId: AUTHOR_A })],
    routeAudits: [],
    ...over,
  }
}

function seed(store: RunsStore, state: RunState): void {
  store.save(state)
}

/**
 * 两个 run 的 t1 用不同状态：run1 待验收（review），run2 运行中（running）。
 * 成员 A 绑 run1 的 t1、成员 B 绑 run2 的 t1 —— 一旦谁「按活动 run 猜」，看到的状态立刻不同。
 */
function seedStatusCase(harness: Harness): void {
  seed(
    harness.store,
    runStateOf({
      plan: planOf({
        runId: RUN1,
        tasks: [
          taskOf('t1', 'review', {
            memberId: AUTHOR_A,
            evidence: { taskId: 't1', command: 'exit 0', exitCode: 0, tail: 'ok', artifacts: [], at: NOW - 1_000 },
          }),
        ],
      }),
      bindings: [
        bindingOf('t1', '作者-1', { memberId: AUTHOR_A }),
        bindingOf('t1', '验收-A', { memberId: MEMBER_A, spawnedAt: NOW - 5_000 }),
      ],
    }),
  )
  seed(
    harness.store,
    runStateOf({
      plan: planOf({ runId: RUN2, createdAt: NOW - 30_000, tasks: [taskOf('t1', 'running', { memberId: AUTHOR_B })] }),
      plannedAt: NOW - 30_000,
      bindings: [
        bindingOf('t1', '作者-2', { memberId: AUTHOR_B }),
        bindingOf('t1', '验收-B', { memberId: MEMBER_B, spawnedAt: NOW - 5_000 }),
      ],
    }),
  )
}

/** 两个 run 的 t1 都是 review 态（各自不同的作者/验收人）：review 串 run 会真的改写别人的任务。 */
function seedReviewCase(harness: Harness): void {
  seed(
    harness.store,
    runStateOf({
      plan: planOf({ runId: RUN1, tasks: [taskOf('t1', 'review', { memberId: AUTHOR_A })] }),
      bindings: [
        bindingOf('t1', '作者-1', { memberId: AUTHOR_A }),
        bindingOf('t1', '验收-A', { memberId: MEMBER_A, spawnedAt: NOW - 5_000 }),
      ],
    }),
  )
  seed(
    harness.store,
    runStateOf({
      plan: planOf({ runId: RUN2, createdAt: NOW - 30_000, tasks: [taskOf('t1', 'review', { memberId: AUTHOR_B })] }),
      plannedAt: NOW - 30_000,
      bindings: [
        bindingOf('t1', '作者-2', { memberId: AUTHOR_B }),
        bindingOf('t1', '验收-B', { memberId: MEMBER_B, spawnedAt: NOW - 5_000 }),
      ],
    }),
  )
}

/* ─────────────────────── ① status：各自只看自己 run 的 t1 ─────────────────────── */

test('r56 ① status：A 只看到 run1 的 t1，B 只看到 run2 的 t1', async () => {
  const harness = createHarness()
  seedStatusCase(harness)

  const a = await harness.call('auto_team_status', {}, META_A)
  assert.equal(a.ok, true, JSON.stringify(a))
  assert.equal(a.view, 'member')
  assert.equal(a.runId, RUN1, 'A 的绑定在 run1，status 必须锁在 run1')
  assert.equal(a.taskId, 't1', '返回体必须带上本次 taskId')
  assert.equal((a.task as Record<string, unknown>).status, 'review', 'A 看到的必须是 run1 的 t1（等待验收）')

  const b = await harness.call('auto_team_status', {}, META_B)
  assert.equal(b.ok, true, JSON.stringify(b))
  assert.equal(b.view, 'member')
  assert.equal(b.runId, RUN2, 'B 的绑定在 run2，status 必须锁在 run2')
  assert.equal(b.taskId, 't1')
  assert.equal((b.task as Record<string, unknown>).status, 'running', 'B 看到的必须是 run2 的 t1（运行中）')

  // 显式 taskId 也一样：同名 t1 只能解析到自己那张卡所在 run。
  const aByTask = await harness.call('auto_team_status', { taskId: 't1' }, META_A)
  assert.equal(aByTask.runId, RUN1)
  assert.equal((aByTask.task as Record<string, unknown>).status, 'review')
  const bByTask = await harness.call('auto_team_status', { taskId: 't1' }, META_B)
  assert.equal(bByTask.runId, RUN2)
  assert.equal((bByTask.task as Record<string, unknown>).status, 'running')
})

test('r56 ① status：错 runId 与别人的 taskId 都被明确拒绝（不猜活动 run）', async () => {
  const harness = createHarness()
  seedStatusCase(harness)

  // A 带 run2 的 runId：run2 里确实有 t1，但不是 A 的；绝不能改投过去。
  const wrongRun = await harness.call('auto_team_status', { runId: RUN2 }, META_A)
  assert.equal(wrongRun.ok, false, JSON.stringify(wrongRun))
  assert.equal(wrongRun.code, 'FORBIDDEN')
  const wrongRunText = String(wrongRun.error)
  assert.match(wrongRunText, /本次请求的 runId 为「run-r56-2」/, wrongRunText)
  assert.match(wrongRunText, /你的任务绑定在 run「run-r56-1」/, wrongRunText)
  assert.equal('task' in wrongRun, false, '被拒绝时不得夹带任何任务视图')

  // B 带 run1 同理被拒，且 run1 的任务状态不变。
  const bWrongRun = await harness.call('auto_team_status', { runId: RUN1 }, META_B)
  assert.equal(bWrongRun.ok, false)
  assert.equal(bWrongRun.code, 'FORBIDDEN')
  assert.match(String(bWrongRun.error), /run-r56-2/, String(bWrongRun.error))
  assert.equal(
    harness.state(RUN1).plan.tasks.find((task) => task.id === 't1')?.status,
    'review',
    '被拒的请求不得改动任何 run',
  )

  // 别人名下的 taskId：精确命中失败时**不回落**到「最新绑定」去猜，直接回明确原因。
  const foreignTask = await harness.call('auto_team_status', { taskId: 't9' }, META_A)
  assert.equal(foreignTask.ok, false, JSON.stringify(foreignTask))
  assert.equal(foreignTask.code, 'FORBIDDEN')
  const foreignText = String(foreignTask.error)
  assert.match(foreignText, /本次请求的 taskId 为「t9」/, foreignText)
  assert.match(foreignText, /你名下任务为 t1/, foreignText)
  assert.match(foreignText, /t9 不是你被派发的任务/, foreignText)
})

test('r56 ① status：队长路径不受影响，仍按传入 runId 读取', async () => {
  const harness = createHarness()
  seedStatusCase(harness)

  const leader = await harness.call('auto_team_status', { runId: RUN2 }, LEADER_META)
  assert.equal(leader.ok, true, JSON.stringify(leader))
  assert.equal(leader.runId, RUN2, '队长显式 runId 必须原样生效')
  assert.equal('view' in leader, false, '队长不得落进成员视图')
  assert.equal(Array.isArray(leader.tasks), true, '队长视图仍是全量任务')
})

/* ─────────────────────── ② review：验收只落在自己那份 run ─────────────────────── */

test('r56 ② review：A 的 pass 只改 run1 的 t1，run2 的 t1 原样', async () => {
  const harness = createHarness()
  seedReviewCase(harness)

  const passed = await harness.call('auto_team_review', { taskId: 't1', verdict: 'pass' }, META_A)
  assert.equal(passed.ok, true, JSON.stringify(passed))
  assert.equal(passed.runId, RUN1, '返回体必须带上真正落点的 runId')
  assert.equal(passed.taskId, 't1')
  assert.equal(passed.status, 'done')
  assert.equal((passed.review as Record<string, unknown>).by, '验收-A')

  const run1Task = harness.state(RUN1).plan.tasks.find((task) => task.id === 't1')
  assert.equal(run1Task?.status, 'done', 'run1 的 t1 才是 A 能验收的那张卡')

  const run2Task = harness.state(RUN2).plan.tasks.find((task) => task.id === 't1')
  assert.equal(run2Task?.status, 'review', 'run2 的同名 t1 不得被 A 的验收改写')
  assert.equal(run2Task?.review, undefined, 'run2 的 t1 不得落下任何验收记录')
})

test('r56 ② review：错 runId 的验收被拒，零写入', async () => {
  const harness = createHarness()
  seedReviewCase(harness)

  // A 带 run2 的 runId 去验收：run2 的 t1 确实是 review 态，不拦就会真的写成 done。
  const wrongRun = await harness.call('auto_team_review', { taskId: 't1', verdict: 'pass', runId: RUN2 }, META_A)
  assert.equal(wrongRun.ok, false, JSON.stringify(wrongRun))
  assert.equal(wrongRun.code, 'FORBIDDEN')
  const text = String(wrongRun.error)
  assert.match(text, /本次请求的 runId 为「run-r56-2」/, text)
  assert.match(text, /你的任务绑定在 run「run-r56-1」/, text)

  const run1Task = harness.state(RUN1).plan.tasks.find((task) => task.id === 't1')
  const run2Task = harness.state(RUN2).plan.tasks.find((task) => task.id === 't1')
  assert.equal(run1Task?.status, 'review', '被拒的验收不得改动 run1')
  assert.equal(run2Task?.status, 'review', '被拒的验收不得改动 run2')
  assert.equal(run2Task?.review, undefined, '被拒的验收不得给 run2 落 review 记录')

  // B 不带 runId：锁在 run2（不是 A 刚碰过的 run1 / 也不是「活动 run 猜」）。
  const bPassed = await harness.call('auto_team_review', { taskId: 't1', verdict: 'pass' }, META_B)
  assert.equal(bPassed.ok, true, JSON.stringify(bPassed))
  assert.equal(bPassed.runId, RUN2)
  assert.equal((bPassed.review as Record<string, unknown>).by, '验收-B')
  assert.equal(harness.state(RUN2).plan.tasks.find((task) => task.id === 't1')?.status, 'done')
  assert.equal(harness.state(RUN1).plan.tasks.find((task) => task.id === 't1')?.status, 'review', 'B 不得改到 run1')

  // 找错归属（不是自己名下的 taskId）：明确拒绝，不猜。
  const foreign = await harness.call('auto_team_review', { taskId: 't9', verdict: 'pass' }, META_A)
  assert.equal(foreign.ok, false, JSON.stringify(foreign))
  assert.equal(foreign.code, 'FORBIDDEN')
  assert.match(String(foreign.error), /你名下任务为 t1/, String(foreign.error))
})
