/**
 * r61 / t4：历史行 `duration` 的缺席守卫。
 *
 * 契约（`shared/types.ts` 的 `RunSummary.duration` 注释）：缺任一时刻 / 读不到 run 状态 →
 * 字段**缺席**，不补 0、不写「不可得」占位。但 `runDurationOf` 在「终态 + `finishedAtOf`
 * 无回退值」时会返回 `{ state: 'unavailable', text: '不可得' }` —— 历史链路如果照抄进
 * `duration`，就是把占位写给了客户端。
 *
 * 反向验证口径（把 bridge.ts 的守卫改回 `typeof state.plannedAt === 'number'` 且无条件赋值）：
 *  - 第一例（终态 cancelled 无结束时刻）必红：`'duration' in row` 会变成 true；
 *  - 第四例（plannedAt 为 NaN）必红：`typeof NaN === 'number'` 放行后同样写进 unavailable。
 *
 * 用真 `RunsStore` 落盘 + 真 `createBridge()` 链路，不 mock。`historyOf` 是 bridge 内部函数，
 * 唯一对外暴露口是 `snapshot(sessionId).runs`（快照里 `runs: historyOf(sessionId)`），
 * 因此断言取 `snapshot(SESSION).runs`，走的仍是同一个函数。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridge, type Bridge } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { durationCellOf, formatDuration } from '../src/host/format.ts'
import type { Plan, PlanTask } from '../src/shared/types.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r61-t4'
const RUN = 'run-r61-t4'

/** plannedAt 被换成 NaN 的真 store：落盘仍是合法 JSON，读取时模拟「盘上时刻不可用」。 */
class NaPlannedAtStore extends RunsStore {
  override load(runId: string): RunState | null {
    const state = super.load(runId)
    return state === null ? null : { ...state, plannedAt: Number.NaN }
  }
}

function taskOf(id: string, status: PlanTask['status']): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: `exit ${id}`, status }
}

function stateOf(over: Partial<RunState> = {}, plan: Partial<Plan> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: {
      runId: RUN,
      sessionId: SESSION,
      createdAt: NOW - 60 * 60_000,
      status: 'draft',
      tasks: [taskOf('t1', 'pending')],
      maxConcurrent: 3,
      ...plan,
    },
    plannedAt: NOW - 60 * 60_000,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...over,
  }
}

interface Harness {
  dir: string
  store: RunsStore
  bridge: Bridge
  cleanup: () => void
}

function createHarness(makeStore: (dir: string) => RunsStore = (dir) => new RunsStore(join(dir, 'runs'))): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r61-t4-'))
  const store = makeStore(dir)
  const roles = createRoleRepo({ dir: join(dir, 'roles'), now: () => NOW })
  roles.seed()
  const bridge = createBridge({
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    applyReceipt: (state) => state,
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
    now: () => NOW,
  })
  return { dir, store, bridge, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('终态但算不出结束时刻：duration 字段缺席（不写 unavailable 占位）', () => {
  const h = createHarness()
  try {
    h.store.save(
      stateOf(
        { plannedAt: 1_000, taskTimes: {}, messages: [] },
        { status: 'cancelled' },
      ),
    )
    const rows = h.bridge.snapshot(SESSION).runs ?? []
    assert.equal(rows.length, 1)
    const row = rows[0]!
    assert.equal('duration' in row, false)
  } finally {
    h.cleanup()
  }
})

test('进行中（无 finishedAt）：state=running 且 text 与同一算法逐字相等', () => {
  const h = createHarness()
  try {
    const plannedAt = NOW - 90_000
    h.store.save(stateOf({ plannedAt }, { status: 'dispatching' }))
    const rows = h.bridge.snapshot(SESSION).runs ?? []
    const duration = rows[0]!.duration
    assert.notEqual(duration, undefined)
    assert.equal(duration!.state, 'running')
    assert.equal(duration!.text, durationCellOf({ startAt: plannedAt, state: 'running', now: NOW }).text)
    // 独立于 durationCellOf 分支的定值核对：90 秒。
    assert.equal(duration!.text, formatDuration(NOW - plannedAt))
    assert.equal(duration!.text, '1 分 30 秒')
  } finally {
    h.cleanup()
  }
})

test('已完成（plannedAt + finishedAt 都有）：state=done 且 text 逐字相等', () => {
  const h = createHarness()
  try {
    const plannedAt = 1_000
    const finishedAt = 6_000
    h.store.save(stateOf({ plannedAt, finishedAt }, { status: 'terminated' }))
    const rows = h.bridge.snapshot(SESSION).runs ?? []
    const duration = rows[0]!.duration
    assert.notEqual(duration, undefined)
    assert.equal(duration!.state, 'done')
    assert.equal(duration!.text, durationCellOf({ startAt: plannedAt, endAt: finishedAt, state: 'done', now: NOW }).text)
    assert.equal(duration!.text, '5 秒')
  } finally {
    h.cleanup()
  }
})

test('plannedAt 非有限（NaN）：守卫拦下，duration 字段缺席', () => {
  const h = createHarness((dir) => new NaPlannedAtStore(join(dir, 'runs')))
  try {
    h.store.save(stateOf({ plannedAt: NOW - 60_000 }, { status: 'dispatching' }))
    const rows = h.bridge.snapshot(SESSION).runs ?? []
    assert.equal(rows.length, 1)
    assert.equal('duration' in rows[0]!, false)
  } finally {
    h.cleanup()
  }
})
