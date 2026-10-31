/**
 * T6 Trigger 总线单测（trigger-bus）。
 *
 * 覆盖点与 PRD/TECHNICAL 的对应关系：
 *  - AC-15 幂等：同 key 连投 5 次 = **1 次推进**（其余 4 条 `duplicate`），窗口过期后可再推进 1 次；
 *  - AC-15 零副作用：dropped 记录**绝不调** `bridge.act`（dispatch/resume/sendMessage 计数不动）；
 *  - AC-13/AC-14：开关关闭 → `not_enabled`；不属于当前 run → `unknown_entity`；状态不接受 → `task_state`；
 *  - AC-18 轮询兜底：`poll` 四类（dep_ready / gate_failed / member_exit / stall_timeout）各推进一次，
 *    第二次轮询不再重复；事件源不可用 → `health().degraded` 且快照带可读降级原因；
 *  - 端到端主路径：启用 → 投 5 次 dep_ready → 快照 `triggers` 谁能看到「推进了 1 次、丢了 4 次」。
 *
 * 判定本身（reason 码 / 动作映射 / 文案）在 `test/trigger.test.ts` 覆盖，这里只验**编排与记账**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ActivityEvent, GateEvidence, MemberBinding, Plan, PlanTask, Role, TriggerRecord } from '../src/shared/types.ts'
import { createBridge, type Bridge, type BridgeDeps } from '../src/host/bridge.ts'
import { TRIGGER_DEDUPE_MS } from '../src/host/config.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { createTriggerBus, type TriggerBus, type TriggerBusHealth } from '../src/host/team/trigger-bus.ts'
import { triggerFromDepReady, type Trigger } from '../src/host/team/trigger.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-t6'
const RUN = 'run-t6'

interface Calls {
  dispatch: number
  resume: number
  sent: string[]
}

interface Harness {
  dir: string
  store: RunsStore
  bridge: Bridge
  bus: TriggerBus
  calls: Calls
  advance: (ms: number) => void
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
  return { runId: RUN, sessionId: SESSION, createdAt: NOW, status: 'draft', tasks: [taskOf('t1')], maxConcurrent: 3, ...over }
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return { version: RUN_STATE_VERSION, plan: planOf(), plannedAt: NOW, messages: [], bindings: [], routeAudits: [], ...over }
}

function evidenceOf(taskId: string, exitCode: number | null, at = NOW): GateEvidence {
  return { taskId, command: 'pnpm test', exitCode, tail: 'tail', artifacts: [], at }
}

/** 真 store + 真 bridge（假端口计数）：`accepted 只走 bridge.act` 才能被真正观测到。 */
async function setup(options: { state?: RunState | null; enabled?: boolean } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-t6-'))
  const store = new RunsStore(join(dir, 'runs'))
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir, now: () => NOW })
  roles.seed()
  roles.save(roleOf('dev', '开发'))
  const artifactsDir = join(dir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })

  let clock = NOW
  const calls: Calls = { dispatch: 0, resume: 0, sent: [] }
  const healthRef: { current: (() => TriggerBusHealth) | null } = { current: null }

  const deps: BridgeDeps = {
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    // 刻意**不改任务状态**：这样「同 key 再投」才会落到 duplicate（去重窗口）而不是 task_state，
    // 否则测出来的是「状态变了所以没推」，不是幂等。
    dispatch: async (state) => {
      calls.dispatch += 1
      const started = state.plan.tasks.filter((task) => task.status === 'pending').map((task) => task.id)
      return { started, skipped: [], errors: [] }
    },
    resume: async () => {
      calls.resume += 1
      return { resumed: 1, skipped: 0, unchanged: false }
    },
    applyReceipt: (state) => state,
    sendMessage: async (memberId, text) => {
      calls.sent.push(`${memberId}:${text}`)
      return { ok: true }
    },
    gate: { cwd: dir, artifactsDir },
    now: () => clock,
    triggerHealth: () => healthRef.current?.() ?? { degraded: false },
  }

  const bridge = createBridge(deps)
  if (options.enabled !== false) {
    const toggled = await bridge.act(SESSION, { type: 'toggle', enabled: true })
    assert.equal(toggled.rejected, undefined, '启用动作本身不应被拒')
  }
  if (options.state !== null && options.state !== undefined) store.save(options.state)

  const bus = createTriggerBus({ store, bridge, now: () => clock, dedupeMs: TRIGGER_DEDUPE_MS })
  healthRef.current = () => bus.health()

  return { dir, store, bridge, bus, calls, advance: (ms: number) => (clock += ms) }
}

/** 依赖完成型 Trigger（t2 依赖 t1，t1 已 done）——最常用的推进样本。 */
function depReadyState(): RunState {
  return stateOf({
    plan: planOf({
      tasks: [
        taskOf('t1', { status: 'done', evidence: evidenceOf('t1', 0) }),
        taskOf('t2', { status: 'pending', dependsOn: ['t1'] }),
      ],
    }),
  })
}

function depTriggerOf(state: RunState, taskId = 't2'): Trigger {
  const task = state.plan.tasks.find((item) => item.id === taskId)
  assert.ok(task, `样本里必须有任务 ${taskId}`)
  return triggerFromDepReady(state.plan.runId, task, NOW, 't1')
}

async function pushMany(bus: TriggerBus, trigger: Trigger, times: number) {
  const records = []
  for (let index = 0; index < times; index += 1) records.push(await bus.push(trigger))
  return records
}

/** 快照里的推进账本（字段可选：缺省按空账本读，避免断言只因为「没接上」而崩成另一类红）。 */
function triggersOf(snapshot: { triggers?: TriggerRecord[] }): TriggerRecord[] {
  return snapshot.triggers ?? []
}

test('AC-15：同 key 连投 5 次 = 1 次推进，其余 4 条 duplicate 且不再调 act', async () => {
  const state = depReadyState()
  const { store, bus, calls } = await setup({ state })

  const records = await pushMany(bus, depTriggerOf(state), 5)

  assert.deepEqual(
    records.map((record) => record.accepted),
    [true, false, false, false, false],
    '只有第一次放行',
  )
  assert.deepEqual(
    records.map((record) => record.reason),
    ['ok', 'duplicate', 'duplicate', 'duplicate', 'duplicate'],
  )
  assert.equal(records[0].action, 'dispatch', 'accepted 的动作必须是既有 PanelAction')
  assert.equal(calls.dispatch, 1, '同一 key 只允许调一次派发')

  const ledger = store.load(RUN)?.triggers ?? []
  assert.equal(ledger.length, 5, 'accepted 与 dropped 都要记账，否则「为什么没推进」无从排查')
  assert.ok(ledger.every((record) => record.dedupeKey === records[0].dedupeKey), '去重键必须稳定')
  assert.match(records[0].text, /推进/, '放行记录要有可读中文原因')
  assert.match(records[1].text, /未推进/, '丢弃记录同样要能解释自己')
})

test('AC-15：去重窗口过期后可再推进 1 次（判据是 accepted 的时刻，不是时间桶）', async () => {
  const state = depReadyState()
  const { bus, calls, advance } = await setup({ state })
  const trigger = depTriggerOf(state)

  const first = await pushMany(bus, trigger, 5)
  assert.equal(first[0].accepted, true)

  // 窗口内补投：仍然丢弃。
  advance(TRIGGER_DEDUPE_MS - 1)
  assert.equal((await bus.push(trigger)).reason, 'duplicate', '窗口内必须仍然丢弃')
  assert.equal(calls.dispatch, 1)

  // 恰好到窗口边界（`now - at < dedupeMs` 取严格小于）→ 可再推进一次。
  advance(1)
  const again = await bus.push(trigger)
  assert.equal(again.accepted, true, '窗口过期后必须可以再推进一次')
  assert.equal(again.reason, 'ok')
  assert.equal(calls.dispatch, 2)
})

test('AC-15：dropped 记录绝不调 act（任务状态不接受时只记账）', async () => {
  const state = stateOf({ plan: planOf({ tasks: [taskOf('t1', { status: 'done', evidence: evidenceOf('t1', 0) })] }) })
  const { bus, calls, store } = await setup({ state })

  const record = await bus.push(depTriggerOf(state, 't1'))

  assert.equal(record.accepted, false)
  assert.equal(record.reason, 'task_state', '已完成的任务不该再被派发')
  assert.equal(record.action, undefined, '未放行时不得留下动作类型')
  assert.equal(calls.dispatch, 0, 'dropped 绝不能调 dispatch')
  assert.equal(calls.resume, 0)
  assert.equal(calls.sent.length, 0)
  assert.equal((store.load(RUN)?.triggers ?? []).length, 1, '丢弃也要留一条可解释的记录')
})

test('AC-14：会话开关关闭 → not_enabled，零推进零动作', async () => {
  const state = depReadyState()
  const { bus, calls, store } = await setup({ state, enabled: false })

  const record = await bus.push(depTriggerOf(state))

  assert.equal(record.accepted, false)
  assert.equal(record.reason, 'not_enabled')
  assert.equal(calls.dispatch, 0)
  assert.equal((store.load(RUN)?.triggers ?? []).length, 1)
})

test('AC-14：不属于当前 run 的事件 → unknown_entity，不写盘也不抛', async () => {
  const { bus, store } = await setup({})
  const trigger: Trigger = { kind: 'dep_ready', source: 'event', runId: 'run-ghost', at: NOW, taskId: 't1' }

  const record = await bus.push(trigger)

  assert.equal(record.accepted, false)
  assert.equal(record.reason, 'unknown_entity')
  assert.equal(store.load('run-ghost'), null, '没有运行账本时不能凭空造一份')
})

test('AC-18：poll 四类各推进一次，第二次轮询不再重复', async () => {
  // 停滞告警由 watcher 的 stallAlertsOf 写入（每个 episode 一条），这里直接造一条新鲜的。
  const stallAlerts: ActivityEvent[] = [{ at: NOW - 1000, kind: 'tool', memberId: 'member-y', text: '成员 90s 无产出' }]
  const state = stateOf({
    plan: planOf({
      tasks: [
        taskOf('t1', { status: 'done', evidence: evidenceOf('t1', 0) }),
        taskOf('t2', { status: 'pending', dependsOn: ['t1'] }),
        taskOf('t3', { status: 'rework', memberId: 'member-z', evidence: evidenceOf('t3', 1, NOW + 10) }),
        taskOf('t4', { status: 'interrupted', memberId: 'member-x' }),
        taskOf('t5', { status: 'running', memberId: 'member-y' }),
      ],
    }),
    bindings: [
      bindingOf({ taskId: 't3', memberId: 'member-z', name: '开发-z' }),
      bindingOf({ taskId: 't4', memberId: 'member-x', name: '开发-x' }),
      bindingOf({ taskId: 't5', memberId: 'member-y', name: '开发-y' }),
    ],
    stallAlerts,
  })
  const { bus, bridge, store, calls } = await setup({ state })

  const records = await bus.poll(state)

  assert.deepEqual(
    records.map((record) => record.kind),
    ['dep_ready', 'gate_failed', 'member_exit', 'stall_timeout'],
    '四类兜底通路必须都能从运行状态推导出来',
  )
  assert.ok(
    records.every((record) => record.accepted),
    `四类都应放行，实际：${records.map((record) => `${record.kind}=${record.reason}`).join(',')}`,
  )
  assert.deepEqual(
    records.map((record) => record.action),
    ['dispatch', 'message', 'resume', 'message'],
    '推进只能用既有的 11 个 PanelAction',
  )
  assert.ok(
    records.every((record) => record.source === 'poll'),
    '轮询产出的记录来源必须标成 poll（面板要能区分事件/兜底）',
  )
  assert.equal(calls.dispatch, 1)
  assert.equal(calls.resume, 1)
  assert.equal(calls.sent.length, 2)

  const snapshot = bridge.snapshot(SESSION)
  assert.equal(triggersOf(snapshot).length, 4, '推进记录必须出现在快照里（面板可读）')
  assert.equal((store.load(RUN)?.triggers ?? []).length, 4)

  const second = await bus.poll(state)
  assert.deepEqual(second, [], '同一份状态再轮询一次不得重复推进')
  assert.equal((store.load(RUN)?.triggers ?? []).length, 4, '被预过滤的候选不写账本（不刷屏）')
})

test('AC-18：事件源不可用 → health 与快照都显示降级且原因可读', async () => {
  const { bus, bridge } = await setup({ state: depReadyState() })

  assert.equal(bus.health().degraded, false, '未报故障时不该假称降级')
  assert.equal(bridge.snapshot(SESSION).degraded, false)

  bus.setEventSource(false)

  const health = bus.health()
  assert.equal(health.degraded, true)
  assert.ok((health.reason ?? '').includes('轮询'), '降级原因要说清「退回轮询兜底」')
  const snapshot = bridge.snapshot(SESSION)
  assert.equal(snapshot.degraded, true)
  assert.ok((snapshot.degradeReason ?? '').length > 0, '快照必须带可读的降级原因')

  bus.setEventSource(true)
  assert.equal(bus.health().degraded, false, '事件源恢复后降级要撤回')
})

test('端到端主路径：启用 → 5 次 dep_ready 事件 → 快照只反映 1 次推进', async () => {
  const state = depReadyState()
  const { bus, bridge, calls } = await setup({ state })
  assert.equal(triggersOf(bridge.snapshot(SESSION)).length, 0, '开始时账本是空的')

  await pushMany(bus, depTriggerOf(state), 5)

  const snapshot = bridge.snapshot(SESSION)
  const triggers = triggersOf(snapshot)
  assert.equal(calls.dispatch, 1, '端到端只能起一次')
  assert.equal(triggers.length, 5)
  assert.equal(triggers.filter((record) => record.accepted).length, 1)
  const last = triggers[triggers.length - 1]
  assert.equal(last.reason, 'duplicate')
  assert.ok(last.at >= NOW, '记录时刻来自注入时钟')
  assert.equal(snapshot.degraded, false)
})
