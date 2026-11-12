/**
 * r30：成员自助（成员身份解析 / 成员只读视图 / 只能提交自己的回执）。
 *
 * 为什么需要这个文件：t1 给 `auto_team_status` / `auto_team_receipt` 加了「成员会话」分支，
 * 但这条分支的判据（`exec.agent.id` 反查 `bindings[].memberId` 且 `!retired`、多 run 取最新）
 * 与安全边界（只回自己的任务、只提交自己的 taskId、绝不泄露 members/roles/plan）全靠代码自律。
 * 一旦有人把判据改回 `sessionOf`（`'current'` 兜底）或让成员能提交别人的 taskId，
 * 就只有这里会红。文档同步要求双语 README 结构对等，也由既有 r29-packaging 用例兜底。
 *
 * 覆盖：
 *  ① 成员身份：命中 / 无 agent id / 无绑定 / retired 不算 / 多 run 取最新（plannedAt→createdAt→runId）
 *  ② status 成员视图：字段白名单逐键断言，不含 members/memory/roles/plan/tasks 与其它任务
 *  ③ receipt：只允许自己的 taskId；他人 taskId → FORBIDDEN 且零写入、零门禁
 *  ④ 门禁失败 → rework，证据（退出码/输出尾部）回发给该成员，并落账本
 *  ⑤ 队长路径与开关关闭时的旧文案逐字不变（8 个工具 + leader status/receipt 仍走原分支）；
 *     开关关闭时成员的 status/receipt 同态回旧文案（不得一个放行、一个被桥拦成另一句）
 *  ⑥ 非成员会话（无绑定）仍回未启用
 *  ⑦ fake ctx 端到端：成员提交 → 宿主执行 acceptance → done
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridge, type Bridge } from '../src/host/bridge.ts'
import { createRoleRepo, type RoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { applyReceipt } from '../src/host/team/dispatch.ts'
import {
  NOT_ENABLED_MESSAGE,
  buildToolSpecs,
  memberIdentityOf,
  registerTools,
  type ToolsDeps,
} from '../src/host/tools.ts'
import type { HostContext, ToolSpec } from '../src/host/adapters.ts'
import type { MemberBinding, Plan, PlanTask, TaskStatus } from '../src/shared/types.ts'

const NOW = 1_800_100_000_000
const SESSION = 'sess-r30'
const RUN = 'run-r30'
const MEMBER = 'member-t1'
/** 宿主真实形状：会话只在 `agent.id`（r11 真机事故）。 */
const LEADER_META = { agent: { id: SESSION }, callId: 'call-r30' }
const MEMBER_META = { agent: { id: MEMBER }, callId: 'call-r30-member' }

interface Harness {
  dir: string
  store: RunsStore
  roles: RoleRepo
  bridge: Bridge
  deps: ToolsDeps
  sent: Array<{ memberId: string; text: string }>
  specs: ToolSpec[]
  call(name: string, args?: Record<string, unknown>, meta?: unknown): Promise<Record<string, unknown>>
  state(runId?: string): RunState
}

function createHarness(options: { enabled?: boolean } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r30-'))
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
    // 真实回执状态机：done/rework/failed 的唯一写点。mock 掉它等于把被测逻辑一起 mock 掉。
    applyReceipt,
    sendMessage: async (memberId, text) => {
      sent.push({ memberId, text })
      return { ok: true }
    },
    gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
    now: () => NOW,
    interruptMember: async () => ({ ok: true }),
  })
  if (options.enabled ?? false) bridge.setEnabled(SESSION, true)
  // 注意：createBridge 构造时会做一次 stale-plan 对账；必须在它之后才 seed run。

  const deps: ToolsDeps = { store, roles, bridge, now: () => NOW }
  const specs = buildToolSpecs(deps)
  return {
    dir,
    store,
    roles,
    bridge,
    deps,
    sent,
    specs,
    async call(name, args = {}, meta = LEADER_META) {
      const spec = specs.find((item) => item.name === name)
      assert.ok(spec, `工具 ${name} 必须存在`)
      return (await spec.handler(args, meta)) as Record<string, unknown>
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
    runId: RUN,
    sessionId: SESSION,
    createdAt: NOW - 60_000,
    status: 'dispatching',
    goal: 'r30 成员自助',
    tasks: [taskOf('t1', 'running', { memberId: MEMBER }), taskOf('t2', 'pending')],
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
    bindings: [bindingOf('t1', '开发-1')],
    routeAudits: [],
    ...over,
  }
}

function seed(store: RunsStore, state: RunState): void {
  store.save(state)
}

/* ─────────────────────── ① 成员身份解析 ─────────────────────── */

/** 只读身份解析不需要 bridge/roles：`memberIdentityOf` 只碰 `deps.store`。 */
function identityStore(): RunsStore {
  return new RunsStore(mkdtempSync(join(tmpdir(), 'auto-team-r30-identity-')))
}

function identityDeps(store: RunsStore): ToolsDeps {
  return { store, roles: {} as RoleRepo, bridge: {} as Bridge, now: () => NOW }
}

test('r30 ① 成员身份：命中绑定 + 任务，返回 run/session/binding/task', () => {
  const store = identityStore()
  seed(store, runStateOf())
  const view = memberIdentityOf(identityDeps(store), MEMBER_META)
  assert.ok(view, 'member-t1 有一条未退休的绑定，必须命中')
  assert.equal(view.runId, RUN)
  assert.equal(view.sessionId, SESSION)
  assert.equal(view.binding.memberId, MEMBER)
  assert.equal(view.binding.taskId, 't1')
  assert.equal(view.task.id, 't1')
  assert.equal(view.task.status, 'running')
})

test('r30 ① 成员身份：无 agent id / 无绑定 / retired 绑定都不算成员', () => {
  const store = identityStore()
  seed(store, runStateOf())

  // 没有 agent.id 时不做 `sessionOf` 的 'current' 兜底：可能撞上脏数据 memberId='current'。
  assert.equal(memberIdentityOf(identityDeps(store), { sessionId: MEMBER }), null)
  assert.equal(memberIdentityOf(identityDeps(store), {}), null)
  assert.equal(memberIdentityOf(identityDeps(store), { agent: { id: '   ' } }), null)
  // 有 agent id 但没有任何 run 绑定它。
  assert.equal(memberIdentityOf(identityDeps(store), { agent: { id: 'member-unknown' } }), null)

  // retired 的绑定保留用于续聊/审计，但不再是成员身份。
  const retiredStore = identityStore()
  seed(
    retiredStore,
    runStateOf({ bindings: [bindingOf('t1', '开发-1', { retired: true })] }),
  )
  assert.equal(memberIdentityOf(identityDeps(retiredStore), MEMBER_META), null)

  // 最新的 run 里 retired，较旧 run 里仍有效 → 取较旧那条有效绑定（而不是“最新 run 的 retired”）。
  const mixedStore = identityStore()
  seed(mixedStore, runStateOf())
  seed(
    mixedStore,
    runStateOf({
      plan: planOf({ runId: 'run-r30-newer', createdAt: NOW - 30_000 }),
      plannedAt: NOW - 30_000,
      bindings: [bindingOf('t1', '开发-1', { retired: true })],
    }),
  )
  assert.equal(memberIdentityOf(identityDeps(mixedStore), MEMBER_META)?.runId, RUN)
})

test('r30 ① 成员身份：多个 run 取最新（plannedAt → createdAt → runId 兜底）', () => {
  // plannedAt 大的胜。
  const byPlanned = identityStore()
  seed(byPlanned, runStateOf())
  seed(
    byPlanned,
    runStateOf({
      plan: planOf({ runId: 'run-r30-newer', createdAt: NOW - 30_000 }),
      plannedAt: NOW - 1_000,
    }),
  )
  assert.equal(memberIdentityOf(identityDeps(byPlanned), MEMBER_META)?.runId, 'run-r30-newer')

  // plannedAt 相同 → createdAt 大的胜。
  const byCreated = identityStore()
  seed(byCreated, runStateOf({ plannedAt: NOW }))
  seed(
    byCreated,
    runStateOf({
      plan: planOf({ runId: 'run-r30-created-later', createdAt: NOW - 1_000 }),
      plannedAt: NOW,
    }),
  )
  assert.equal(memberIdentityOf(identityDeps(byCreated), MEMBER_META)?.runId, 'run-r30-created-later')

  // plannedAt 与 createdAt 都相同 → runId 字典序大的胜（结果必须确定，不能依赖目录遍历顺序）。
  const byRunId = identityStore()
  seed(byRunId, runStateOf({ plannedAt: NOW, plan: planOf({ runId: 'run-r30-a' }) }))
  seed(byRunId, runStateOf({ plannedAt: NOW, plan: planOf({ runId: 'run-r30-z' }) }))
  assert.equal(memberIdentityOf(identityDeps(byRunId), MEMBER_META)?.runId, 'run-r30-z')
})

/* ─────────────────────── ② 成员只读视图 ─────────────────────── */

test('r30 ② status 成员视图：字段白名单，绝不返回 members/memory/roles/plan/tasks', async () => {
  // 成员自助同样受开关约束：run 所属队长会话的开关必须开着，成员才能看到自己的任务。
  const harness = createHarness({ enabled: true })
  seed(
    harness.store,
    runStateOf({
      plan: planOf({
        tasks: [
          taskOf('t1', 'running', { memberId: MEMBER, acceptance: 'test -s README.md' }),
          taskOf('t2', 'pending', { title: '别的任务不该出现' }),
          taskOf('t3', 'done', { memberId: 'member-t3' }),
        ],
      }),
      bindings: [bindingOf('t1', '开发-1'), bindingOf('t3', '开发-3')],
      messages: [
        {
          at: NOW - 1000,
          from: 'captain',
          to: '开发-1',
          toMemberId: MEMBER,
          taskId: 't1',
          body: '开始吧',
          messageId: 'msg-r30-1',
        },
      ],
    }),
  )

  const status = await harness.call('auto_team_status', {}, MEMBER_META)
  assert.equal(status.ok, true)
  assert.equal(status.view, 'member')
  assert.equal(status.runId, RUN)
  assert.deepEqual(
    Object.keys(status).sort(),
    ['notice', 'ok', 'runId', 'task', 'view'],
    '成员视图顶层字段必须恰为白名单（多一个字段就是泄露）',
  )
  for (const forbidden of [
    'members',
    'memory',
    'roles',
    'plan',
    'tasks',
    'messages',
    'routeAudits',
    'dispatch',
    'concurrency',
    'enabled',
    'progress',
    'detail',
  ]) {
    assert.equal(forbidden in status, false, `成员视图不得包含 ${forbidden}`)
  }

  const task = status.task as Record<string, unknown>
  assert.deepEqual(
    Object.keys(task).sort(),
    ['acceptance', 'dependsOn', 'id', 'status', 'title'],
    '任务字段必须恰为白名单（无证据时不加 evidence 键）',
  )
  for (const forbidden of ['roleId', 'memberId', 'writeScopes', 'attempts', 'waitingOn']) {
    assert.equal(forbidden in task, false, `任务视图不得包含 ${forbidden}`)
  }
  assert.equal(task.id, 't1')
  assert.equal(status.runId, RUN, '只能回自己所属的 run')
  assert.equal(task.status, 'running')
  assert.equal(task.acceptance, 'test -s README.md')
  assert.match(String(status.notice), /auto_team_receipt/, 'notice 必须告诉成员如何提交回执')
})

/* ─────────────────────── ③ 只能提交自己的回执 ─────────────────────── */

test('r30 ③ receipt：他人 taskId → FORBIDDEN，零门禁零写入', async () => {
  // 开关关闭时会在更早的准入处回 NOT_ENABLED，FORBIDDEN 只可能出现在开关开着时（见 ⑤ 同态用例）。
  const harness = createHarness({ enabled: true })
  seed(harness.store, runStateOf())

  const result = await harness.call('auto_team_receipt', { taskId: 't2' }, MEMBER_META)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'FORBIDDEN')
  assert.match(
    String(result.error),
    /只能提交自己被派发任务（t1）的回执，t2 不是你被派发的任务/,
    '拒绝文案必须同时指出自己的 taskId 与被拒绝的 taskId',
  )

  const state = harness.state()
  assert.equal(state.plan.tasks.find((item) => item.id === 't1')?.status, 'running', '自己任务状态不变')
  assert.equal(state.plan.tasks.find((item) => item.id === 't2')?.status, 'pending', '他人任务状态不变')
  assert.equal(existsSync(join(harness.dir, 'artifacts', 't2.log')), false, '不得为他人任务跑门禁')
  assert.equal(harness.sent.length, 0, '拒绝时不得给任何成员发消息')
})

test('r30 ③ receipt：自己的 taskId → 宿主执行 acceptance 后 done', async () => {
  // 真实前提：成员只会在队长开关打开后创建；开关记在 run 的队长会话上，成员 agent id 没有开关记录。
  const harness = createHarness({ enabled: true })
  seed(
    harness.store,
    runStateOf({
      plan: planOf({
        tasks: [taskOf('t1', 'running', { memberId: MEMBER, acceptance: 'printf r30-own-ok' }), taskOf('t2', 'pending')],
      }),
    }),
  )

  const result = await harness.call('auto_team_receipt', { taskId: 't1', note: '自测通过' }, MEMBER_META)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.taskId, 't1')
  assert.equal(result.status, 'done')
  const evidence = result.evidence as Record<string, unknown>
  assert.equal(evidence.exitCode, 0)
  assert.equal(evidence.command, 'printf r30-own-ok')

  const state = harness.state()
  assert.equal(state.plan.tasks.find((item) => item.id === 't1')?.status, 'done')
  assert.equal(state.plan.tasks.find((item) => item.id === 't2')?.status, 'pending', '无关任务不被打扰')
})

/* ─────────────────────── ④ 门禁失败 → rework + 证据回发 ─────────────────────── */

test('r30 ④ 门禁失败 → rework，证据（退出码/输出尾部）回发给该成员并落账本', async () => {
  const harness = createHarness({ enabled: true })
  const acceptance = "printf 'boom-r30\\n' >&2; exit 7"
  seed(
    harness.store,
    runStateOf({
      plan: planOf({
        tasks: [taskOf('t1', 'running', { memberId: MEMBER, acceptance }), taskOf('t2', 'pending', { dependsOn: ['t1'] })],
      }),
    }),
  )

  const result = await harness.call('auto_team_receipt', { taskId: 't1', note: '按证据返工' }, MEMBER_META)
  assert.equal(result.ok, true, `回执本身被受理（结论看 task.status）：${JSON.stringify(result)}`)
  assert.equal(result.status, 'rework')
  const evidence = result.evidence as Record<string, unknown>
  assert.equal(evidence.exitCode, 7)
  assert.match(String(evidence.tail), /boom-r30/)

  const state = harness.state()
  const task = state.plan.tasks.find((item) => item.id === 't1')
  assert.equal(task?.status, 'rework')
  assert.equal(task?.attempts, 1)
  assert.equal(task?.evidence?.exitCode, 7)
  assert.equal(state.plan.tasks.find((item) => item.id === 't2')?.status, 'pending', '下游保持阻塞')

  assert.equal(harness.sent.length, 1, '证据必须回发给该成员一次')
  assert.equal(harness.sent[0].memberId, MEMBER, '回发对象必须是提交回执的成员')
  assert.match(harness.sent[0].text, /门禁未通过（退出码 7）/)
  assert.match(harness.sent[0].text, /boom-r30/)
  assert.ok(
    state.messages.some(
      (message) => message.toMemberId === MEMBER && message.taskId === 't1' && /boom-r30/.test(message.body),
    ),
    '证据必须进消息账本，成员续聊时还能看到',
  )

  const log = join(harness.dir, 'artifacts', 't1.log')
  assert.equal(existsSync(log), true, '门禁全量日志必须落盘')
  assert.match(readFileSync(log, 'utf8'), /boom-r30/)

  const notices = result.notices as string[]
  assert.ok(notices.some((notice) => /门禁未通过（退出码 7）.*转返工/.test(notice)))
})

/* ─────────────────────── ⑤ 队长路径 / 旧文案不变 ─────────────────────── */

test('r30 ⑤ 开关关闭且非成员：8 个工具都逐字返回未启用原文案', async () => {
  const harness = createHarness({ enabled: false })
  assert.equal(NOT_ENABLED_MESSAGE, '自动团队未启用：请在输入框内的「自动团队」选项处启用后再试。')

  const names = harness.specs.map((spec) => spec.name)
  assert.deepEqual(names, [
    'auto_team_plan',
    'auto_team_dispatch',
    'auto_team_status',
    'auto_team_message',
    'auto_team_receipt',
    'auto_team_memory',
    'auto_team_role',
    'auto_team_add_tasks',
  ])

  for (const name of names) {
    const result = await harness.call(name, {})
    assert.deepEqual(
      result,
      { ok: false, error: NOT_ENABLED_MESSAGE },
      `${name} 在开关关闭且调用者不是成员时必须逐字返回旧文案`,
    )
  }
})

test('r30 ⑤ 队长路径不变：开关打开时 status/receipt 仍走队长分支', async () => {
  const harness = createHarness({ enabled: true })
  seed(
    harness.store,
    runStateOf({
      plan: planOf({
        tasks: [taskOf('t1', 'running', { memberId: MEMBER }), taskOf('t2', 'pending', { acceptance: 'printf leader-ok' })],
      }),
    }),
  )

  const status = await harness.call('auto_team_status', {}, LEADER_META)
  assert.equal(status.ok, true)
  assert.equal(status.enabled, true)
  assert.equal('view' in status, false, '队长分支不得出现成员视图标记')
  assert.ok(Array.isArray(status.tasks), '队长仍拿到全量 tasks')
  assert.ok(Array.isArray(status.members), '队长仍拿到 members')
  assert.ok(Array.isArray(status.roles), '队长仍拿到 roles')
  assert.ok(Array.isArray(status.messages), '队长仍拿到消息账本')
  assert.ok(typeof status.memory === 'object' && status.memory !== null, '队长仍拿到记忆注入预算')

  const receipt = await harness.call('auto_team_receipt', { taskId: 't2' }, LEADER_META)
  assert.equal(receipt.ok, true)
  assert.equal(receipt.status, 'done', '队长提交回执仍由宿主跑 acceptance 并 done')
  assert.equal((receipt.evidence as Record<string, unknown>).exitCode, 0)
})

test('r30 ⑤ 开关关闭时成员自助同态拒绝：status 与 receipt 都回旧文案，零视图零门禁', async () => {
  const harness = createHarness({ enabled: false })
  seed(harness.store, runStateOf())

  // 前置：身份解析本身仍命中（身份 ≠ 准入）——否则就证明不了「是开关关闭才拒绝」。
  assert.equal(memberIdentityOf(harness.deps, MEMBER_META)?.sessionId, SESSION)

  const status = await harness.call('auto_team_status', {}, MEMBER_META)
  const receipt = await harness.call('auto_team_receipt', { taskId: 't1' }, MEMBER_META)
  assert.deepEqual(
    status,
    { ok: false, error: NOT_ENABLED_MESSAGE },
    '开关关闭时 status 必须回 tools.ts 的旧文案，不得放行成员视图',
  )
  assert.deepEqual(
    receipt,
    { ok: false, error: NOT_ENABLED_MESSAGE },
    '开关关闭时 receipt 必须与 status 同态，不得被桥拦成另一句文案',
  )

  const state = harness.state()
  assert.equal(state.plan.tasks.find((item) => item.id === 't1')?.status, 'running', '拒绝时任务状态不变')
  assert.equal(existsSync(join(harness.dir, 'artifacts', 't1.log')), false, '拒绝时不得跑门禁')
  assert.equal(harness.sent.length, 0, '拒绝时不得给任何成员发消息')
})

/* ─────────────────────── ⑥ 非成员会话 ─────────────────────── */

test('r30 ⑥ 非成员会话（无绑定）仍回未启用，不因“有 run”就放行', async () => {
  const harness = createHarness({ enabled: false })
  seed(harness.store, runStateOf())
  const stranger = { agent: { id: 'session-stranger' } }

  assert.equal(memberIdentityOf(harness.deps, MEMBER_META)?.runId, RUN, '前置：成员本身是可解析的')
  for (const name of ['auto_team_status', 'auto_team_receipt']) {
    const result = await harness.call(name, name === 'auto_team_receipt' ? { taskId: 't1' } : {}, stranger)
    assert.deepEqual(result, { ok: false, error: NOT_ENABLED_MESSAGE }, `${name} 对非成员必须回未启用原文案`)
  }
  // 队长会话开关关闭、但也不是成员：同一份 run 存在不等于放行。
  const captainOff = await harness.call('auto_team_status', {}, LEADER_META)
  assert.deepEqual(captainOff, { ok: false, error: NOT_ENABLED_MESSAGE })
  assert.equal(harness.state().plan.tasks.find((item) => item.id === 't1')?.status, 'running')
})

/* ─────────────────────── ⑦ fake ctx 端到端 ─────────────────────── */

test('r30 ⑦ fake ctx 端到端：成员提交 → 宿主执行 acceptance → done', async () => {
  const harness = createHarness({ enabled: true })
  seed(
    harness.store,
    runStateOf({
      plan: planOf({
        tasks: [taskOf('t1', 'running', { memberId: MEMBER, acceptance: 'printf e2e-r30-ok' })],
      }),
    }),
  )

  const definitions = new Map<string, { execute(args: Record<string, unknown>, meta?: unknown): Promise<unknown> }>()
  const ctx = {
    logger: { warn: () => undefined },
    tools: {
      register: (definition: unknown) => {
        const typed = definition as { name: string; execute: (args: Record<string, unknown>, meta?: unknown) => Promise<unknown> }
        definitions.set(typed.name, typed)
      },
    },
  } as unknown as HostContext

  registerTools(ctx, harness.deps)
  assert.equal(definitions.size, 8, 'fake ctx 必须收到全部 8 个工具')

  const status = definitions.get('auto_team_status')
  assert.ok(status, 'auto_team_status 必须已注册')
  const before = (await status.execute({}, MEMBER_META)) as Record<string, unknown>
  assert.equal(before.view, 'member', '成员在 fake ctx 里也走成员分支')
  assert.equal((before.task as Record<string, unknown>).status, 'running')

  const receipt = definitions.get('auto_team_receipt')
  assert.ok(receipt, 'auto_team_receipt 必须已注册')
  const submitted = (await receipt.execute({ taskId: 't1', note: 'e2e' }, MEMBER_META)) as Record<string, unknown>
  assert.equal(submitted.ok, true, JSON.stringify(submitted))
  assert.equal(submitted.status, 'done')
  const evidence = submitted.evidence as Record<string, unknown>
  assert.equal(evidence.exitCode, 0)
  assert.equal(evidence.command, 'printf e2e-r30-ok')

  const after = (await status.execute({}, MEMBER_META)) as Record<string, unknown>
  assert.equal((after.task as Record<string, unknown>).status, 'done', '状态工具读到的就是刚落定的 done')
  assert.equal(((after.task as Record<string, unknown>).evidence as Record<string, unknown>).exitCode, 0)
  assert.equal(harness.state().plan.tasks[0]?.status, 'done')
})
