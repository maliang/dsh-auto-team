/**
 * r56 回归：复用成员的自助回执（真实 `RunsStore` + 真实 `createBridge` + 假 ctx 注册的真工具）。
 *
 * 现场（第四次同族咬人）：同一个 `memberId` 被复用到第二张卡后，成员调
 * `auto_team_receipt(taskId=第二张)` 仍被当成首张卡的身份 → FORBIDDEN；不传 taskId 的
 * `auto_team_status` 也永远显示首张卡。根因是身份解析只看「该成员第一条 / 最新一条绑定」，
 * 完全不看本次请求的 taskId。t1 的修法：给了 taskId 就先按
 * `memberId===agentId && retired!==true && binding.taskId===taskId` 精确命中，命中不到再退化
 * 为「最新绑定」；FORBIDDEN 文案同时列出本次 taskId 与名下任务，便于一眼定位。
 *
 * 覆盖：
 *  ① 复用链 t1(done) → t2(running)：以同一 agentId 提交 t2 成功，门禁真跑、证据落在 t2；
 *  ② 不传 taskId：仍解析到最新绑定（t2），status 成员视图显示 t2；
 *  ③ 别人名下的 taskId：仍 FORBIDDEN，零门禁、零写入、零投递；
 *  ④ `retired=true` 的旧绑定不得提供身份（唯一绑定退休 → 未启用；新旧并存 → 也不得命中旧的）；
 *  ⑤ 变异判据（手工验，见 QA.md）：本文件"较早那张仍在跑"用例是「按 taskId 命中」那行的
 *     承重判据——拆掉精确命中它就红。注意 ① 的种子链里 t2 恰好是最新绑定，拆掉精确命中
 *     仍会绿（退化分支就取到 t2），所以 ① 不能单独承担该变异；两起共用才锁住两层。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridge, type Bridge } from '../src/host/bridge.ts'
import { createRoleRepo, type RoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { applyReceipt } from '../src/host/team/dispatch.ts'
import {
  NOT_ENABLED_MESSAGE,
  memberIdentityOf,
  registerTools,
  type ToolsDeps,
} from '../src/host/tools.ts'
import type { HostContext } from '../src/host/adapters.ts'
import type { MemberBinding, Plan, PlanTask, TaskStatus } from '../src/shared/types.ts'

const NOW = 1_800_200_000_000
const SESSION = 'sess-r56'
const RUN = 'run-r56'
const MEMBER = 'member-reuse'
const OTHER = 'member-t3'
/** 宿主真实形状：会话只在 `agent.id`（r11 真机事故）。 */
const LEADER_META = { agent: { id: SESSION }, callId: 'call-r56-leader' }
const MEMBER_META = { agent: { id: MEMBER }, callId: 'call-r56-member' }
const ACCEPT_T1 = 'printf r56-t1-gate'
const ACCEPT_T2 = 'printf r56-t2-gate'

interface Harness {
  dir: string
  store: RunsStore
  roles: RoleRepo
  bridge: Bridge
  deps: ToolsDeps
  sent: Array<{ memberId: string; text: string }>
  call(name: string, args?: Record<string, unknown>, meta?: unknown): Promise<Record<string, unknown>>
  state(runId?: string): RunState
}

/**
 * 假 ctx + 真 store/bridge：工具注册走 `registerTools`（与生产装配同一入口），
 * 回执状态机走真实 `applyReceipt`（mock 掉它等于把被测逻辑一起 mock 掉），
 * 门禁在临时目录里真执行 acceptance。
 */
function createHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r56-'))
  const store = new RunsStore(join(dir, 'runs'))
  const roles = createRoleRepo({ dir: join(dir, 'roles'), now: () => NOW })
  roles.seed()

  const sent: Array<{ memberId: string; text: string }> = []
  const bridge = createBridge({
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    applyReceipt,
    sendMessage: async (memberId, text) => {
      sent.push({ memberId, text })
      return { ok: true }
    },
    gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
    now: () => NOW,
    interruptMember: async () => ({ ok: true }),
  })
  bridge.setEnabled(SESSION, true)
  // createBridge 构造时会做一次 stale-plan 对账；必须在它之后才 seed run。

  const deps: ToolsDeps = { store, roles, bridge, now: () => NOW }
  const definitions = new Map<string, { name: string; execute(args: Record<string, unknown>, meta?: unknown): Promise<unknown> }>()
  const ctx = {
    logger: { warn: () => undefined },
    tools: {
      register: (definition: unknown) => {
        const typed = definition as { name: string; execute: (args: Record<string, unknown>, meta?: unknown) => Promise<unknown> }
        definitions.set(typed.name, typed)
      },
    },
  } as unknown as HostContext

  registerTools(ctx, deps)
  assert.equal(definitions.size, 9, '假 ctx 必须收到全部 9 个工具')

  return {
    dir,
    store,
    roles,
    bridge,
    deps,
    sent,
    async call(name, args = {}, meta = MEMBER_META) {
      const spec = definitions.get(name)
      assert.ok(spec, `工具 ${name} 必须已注册`)
      return (await spec.execute(args, meta)) as Record<string, unknown>
    },
    state(runId = RUN) {
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

function bindingOf(taskId: string, memberId: string, spawnedAt: number, extra: Partial<MemberBinding> = {}): MemberBinding {
  return { taskId, roleId: 'dev', memberId, name: `dev-${taskId}`, spawnedAt, ...extra }
}

function planOf(tasks: PlanTask[], over: Partial<Plan> = {}): Plan {
  return {
    runId: RUN,
    sessionId: SESSION,
    createdAt: NOW - 60_000,
    status: 'dispatching',
    goal: 'r56 复用成员回执',
    tasks,
    maxConcurrent: 2,
    revisions: [],
    ...over,
  }
}

function runStateOf(plan: Plan, bindings: MemberBinding[], over: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan,
    plannedAt: NOW - 60_000,
    messages: [],
    bindings,
    routeAudits: [],
    ...over,
  }
}

function seed(store: RunsStore, state: RunState): void {
  store.save(state)
}

/** 复用链现场：同一成员先接 t1（已 done）再接 t2（running），两条绑定都未退休。 */
function reuseChain(t2Status: TaskStatus = 'running'): RunState {
  return runStateOf(
    planOf([
      taskOf('t1', 'done', { memberId: MEMBER, acceptance: ACCEPT_T1 }),
      taskOf('t2', t2Status, { memberId: MEMBER, acceptance: ACCEPT_T2 }),
    ]),
    [
      bindingOf('t1', MEMBER, NOW - 20_000),
      bindingOf('t2', MEMBER, NOW - 1_000),
    ],
  )
}

/* ─────────────────────── ① 复用成员提交第二张卡 ─────────────────────── */

test('r56 ① 复用成员：receipt(taskId=t2) 成功，门禁真跑、证据落在 t2', async () => {
  const harness = createHarness()
  seed(harness.store, reuseChain())

  // 以该成员 agentId 调回执，identity 只有按绑定归属精确命中才能落到 t2（旧实现认首条 t1 → FORBIDDEN）。
  const submitted = await harness.call('auto_team_receipt', { taskId: 't2', note: '复用成员交第二张卡' }, MEMBER_META)
  assert.equal(submitted.ok, true, JSON.stringify(submitted))
  assert.equal(submitted.status, 'done')
  assert.equal(submitted.taskId, 't2')

  // 工具返回值里的 evidence 白名单不含 taskId（见 tools.ts receipt 分支），落点以盘面为准。
  const evidence = submitted.evidence as Record<string, unknown>
  assert.equal(evidence.command, ACCEPT_T2, '必须真的执行 t2 的 acceptance')
  assert.equal(evidence.exitCode, 0)
  assert.equal(existsSync(join(harness.dir, 'artifacts', 't2.log')), true, '门禁日志必须落盘到 artifacts/t2.log')
  assert.equal(existsSync(join(harness.dir, 'artifacts', 't1.log')), false, '不得替 t1 跑门禁')

  const state = harness.state()
  const t1 = state.plan.tasks.find((item) => item.id === 't1')
  const t2 = state.plan.tasks.find((item) => item.id === 't2')
  assert.equal(t1?.status, 'done', 't1 已是 done，不受影响')
  assert.equal(t2?.status, 'done')
  assert.equal(t2?.evidence?.taskId, 't2', '证据必须落在 t2，不得是 t1')
  assert.equal(t2?.evidence?.command, ACCEPT_T2)
})

/* ─────────────────────── ② 不传 taskId 的退化行为 ─────────────────────── */

test('r56 ② 不传 taskId：仍识别到最新绑定，status 成员视图显示 t2', async () => {
  const harness = createHarness()
  seed(harness.store, reuseChain())

  const identity = memberIdentityOf(harness.deps, MEMBER_META)
  assert.equal(identity?.binding.taskId, 't2', '不给 taskId 时退化取该成员最新一条未退休绑定')
  assert.equal(identity?.binding.memberId, MEMBER)

  const status = await harness.call('auto_team_status', {}, MEMBER_META)
  assert.equal(status.view, 'member')
  assert.equal((status.task as Record<string, unknown>).id, 't2', 'status 不得再显示首张卡 t1')
  assert.equal((status.task as Record<string, unknown>).status, 'running')
})

/* ─────────────────────── ③ 他人任务仍 FORBIDDEN ─────────────────────── */

test('r56 ③ 别人名下的 taskId：仍 FORBIDDEN，零门禁、零写入、零投递', async () => {
  const harness = createHarness()
  seed(
    harness.store,
    runStateOf(
      planOf([
        taskOf('t1', 'done', { memberId: MEMBER, acceptance: ACCEPT_T1 }),
        taskOf('t2', 'running', { memberId: MEMBER, acceptance: ACCEPT_T2 }),
        taskOf('t3', 'running', { memberId: OTHER, acceptance: 'printf r56-t3-gate' }),
      ]),
      [
        bindingOf('t1', MEMBER, NOW - 20_000),
        bindingOf('t2', MEMBER, NOW - 1_000),
        bindingOf('t3', OTHER, NOW - 500),
      ],
    ),
  )

  const before = JSON.stringify(harness.state())
  const forbidden = await harness.call('auto_team_receipt', { taskId: 't3' }, MEMBER_META)
  assert.equal(forbidden.ok, false, '他人 taskId 必须被拒')
  assert.equal(forbidden.code, 'FORBIDDEN')
  const text = String(forbidden.error)
  assert.match(text, /本次请求的 taskId 为「t3」/, `文案必须带本次请求的 taskId：${text}`)
  assert.match(text, /你名下任务为 t1、t2/, `文案必须列出成员名下任务：${text}`)
  assert.match(text, /t3 不是你被派发的任务/, `文案必须指出 t3 不属于自己：${text}`)
  assert.equal(JSON.stringify(harness.state()), before, '拒绝路径必须零写入（状态/证据/绑定/消息都不变）')
  assert.equal(existsSync(join(harness.dir, 'artifacts', 't3.log')), false, '不得为他人任务跑门禁')
  assert.equal(harness.sent.length, 0, '拒绝路径不得投递消息')
})

/* ─────────────────────── ④ 退休绑定不得提供身份 ─────────────────────── */

test('r56 ④ retired 绑定：唯一绑定已退休 → 未启用；新旧并存时请求旧任务也不得命中退休身份', async () => {
  // (a) 该成员唯一的绑定已 retired：身份解析必须回 null，工具层回「未启用」原文案。
  const onlyRetired = createHarness()
  seed(
    onlyRetired.store,
    runStateOf(
      planOf([taskOf('t1', 'running', { memberId: MEMBER, acceptance: ACCEPT_T1 })]),
      [bindingOf('t1', MEMBER, NOW - 20_000, { retired: true })],
    ),
  )
  assert.equal(memberIdentityOf(onlyRetired.deps, MEMBER_META), null, '退休绑定不得提供身份')
  assert.equal(memberIdentityOf(onlyRetired.deps, MEMBER_META, 't1'), null, '带 taskId 也不得凭退休绑定命中')
  const denied = await onlyRetired.call('auto_team_receipt', { taskId: 't1' }, MEMBER_META)
  assert.deepEqual(denied, { ok: false, error: NOT_ENABLED_MESSAGE })
  assert.equal(onlyRetired.state().plan.tasks[0]?.status, 'running')
  assert.equal(existsSync(join(onlyRetired.dir, 'artifacts', 't1.log')), false)

  // (b) 旧绑定 retired、新绑定仍在：请求旧任务只能退化为新绑定（→ FORBIDDEN），不得解析出退休身份。
  const mixed = createHarness()
  seed(
    mixed.store,
    runStateOf(
      planOf([
        taskOf('t1', 'running', { memberId: MEMBER, acceptance: ACCEPT_T1 }),
        taskOf('t2', 'running', { memberId: MEMBER, acceptance: ACCEPT_T2 }),
      ]),
      [
        bindingOf('t1', MEMBER, NOW - 20_000, { retired: true }),
        bindingOf('t2', MEMBER, NOW - 1_000),
      ],
    ),
  )
  const stale = memberIdentityOf(mixed.deps, MEMBER_META, 't1')
  assert.equal(stale?.binding.taskId, 't2', '退休的 t1 绑定不得被命中，只能退化到最新活的 t2')
  const rejected = await mixed.call('auto_team_receipt', { taskId: 't1' }, MEMBER_META)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'FORBIDDEN', '请求退休卡的任务必须被拒，而不是凭旧绑定拿到身份')
  assert.equal(mixed.state().plan.tasks.find((item) => item.id === 't1')?.status, 'running')
  assert.equal(existsSync(join(mixed.dir, 'artifacts', 't1.log')), false)
})

/* ─────────────────────── ⑤ 变异判据：较早那张卡 ─────────────────────── */

test('r56 ⑤ 变异判据：请求「较早那张仍在跑」的卡也命中自己（拆掉精确命中则本用例红）', async () => {
  // 同一成员两张都在跑：t0 绑定更早、t1 是复用后追加的最新绑定。
  // 只按「最新绑定」会解析成 t1 → FORBIDDEN；这里唯一承重的判据就是
  // memberIdentityOf 里「按请求 taskId 命中 binding」那行（见 QA.md 突变记录 M-A）。
  const harness = createHarness()
  seed(
    harness.store,
    runStateOf(
      planOf([
        taskOf('t0', 'running', { memberId: MEMBER, acceptance: ACCEPT_T1 }),
        taskOf('t1', 'running', { memberId: MEMBER, acceptance: ACCEPT_T2 }),
      ]),
      [
        bindingOf('t0', MEMBER, NOW - 20_000),
        bindingOf('t1', MEMBER, NOW - 1_000),
      ],
    ),
  )

  const earlier = await harness.call('auto_team_receipt', { taskId: 't0' }, MEMBER_META)
  assert.equal(earlier.ok, true, JSON.stringify(earlier))
  assert.equal(earlier.status, 'done')
  const evidence = earlier.evidence as Record<string, unknown>
  assert.equal(evidence.command, ACCEPT_T1)
  assert.equal(existsSync(join(harness.dir, 'artifacts', 't0.log')), true)
  // 最新那张仍可提交（两条绑定各自精确命中）。
  const latest = await harness.call('auto_team_receipt', { taskId: 't1' }, MEMBER_META)
  assert.equal(latest.ok, true, JSON.stringify(latest))
  assert.equal(latest.status, 'done')
})
