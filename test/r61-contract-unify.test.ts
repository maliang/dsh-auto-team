/**
 * r61 / t3：契约统一回归 —— 三处「同一个值只允许有一个来源」。
 *
 * ① 停滞阈值：`LibraryDeps.settings` 注入的 `stallMs` 必须真的生效（1 秒 + 静默 2 秒 → `quiet`），
 *    同一份数据在缺省 90 秒下不得判停；端口返回 `undefined` / 非正数 / 抛错都必须回落到
 *    `defaultSettings().stallMs`，且**不抛**。
 * ② `RunSummary.duration`：宿主 `bridge.historyOf` 用 `runDurationOf` 生成，实测文本与
 *    中心算法逐字相等；终态但算不出结束时刻时字段**缺席**（不写「不可得」占位）。
 * ③ 客户端 `runSummaryRowOf`：宿主给了 `duration` 就逐字透传，**不得**按时间戳二次派生；
 *    字段缺席时才回落旧派生（且不崩）。
 *
 * 反向验证口径（QA-REPORT.md §5 有实跑记录）：
 *  - 删掉 `src/host/library.ts` 的 `stallMsOf(deps)`、改回 `defaultSettings().stallMs` → ① 的设置用例必红；
 *  - 把 `src/client/tabs/rows.ts` 的 `run.duration ?? historyDurationOf(run, now)` 改成恒派生
 *    → ③ 的「宿主值优先」两条必红；
 *  - 把 `src/host/bridge.ts` 的历史 duration 守卫改回 `typeof plannedAt === 'number'` 且无条件赋值
 *    → ② 的缺席用例必红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DurationCell, MemberView, Plan, PlanTask, RunSummary } from '../src/shared/types.ts'
import type { RunState } from '../src/host/store.ts'
import { RUN_STATE_VERSION, RunsStore } from '../src/host/store.ts'
import { buildLibrary, runDurationOf, type LibraryDeps } from '../src/host/library.ts'
import { createBridge, type Bridge } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { STALL_MS } from '../src/host/config.ts'
import { stallOf } from '../src/host/team/stall.ts'
import { runSummaryRowOf } from '../src/client/tabs/rows.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r61-t3'

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'true',
    status: 'ready',
    ...over,
  }
}

function stateOf(
  over: Partial<Omit<RunState, 'plan'>> & { plan?: Partial<RunState['plan']> } = {},
): RunState {
  const { plan: planOver, ...rest } = over
  return {
    version: RUN_STATE_VERSION,
    plannedAt: 1_000,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...rest,
    plan: {
      runId: 'run-r61-t3',
      sessionId: SESSION,
      createdAt: 1_000,
      status: 'dispatching',
      tasks: [taskOf('t1')],
      maxConcurrent: 3,
      ...(planOver as Partial<Plan> | undefined),
    },
  }
}

function tempRuns(): { dir: string; store: RunsStore } {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r61-t3-'))
  return { dir, store: new RunsStore(dir) }
}

/* ───────────────── ① 停滞阈值：真设置端口（缺省回落 90 秒） ───────────────── */

const SETTINGS_RUN = 'run-r61-settings'

/** 一份「成员正在跑、静默 2 秒」的数据：2 秒 ≥ 1 秒阈值 → 自定义阈值下必须判停。 */
function settingsState(): RunState {
  return stateOf({
    plannedAt: 1_000,
    bindings: [{ taskId: 't1', roleId: 'dev', memberId: 'm1', name: '开发-1', spawnedAt: 6_000 }],
    progress: { m1: { at: 8_000 } },
    plan: {
      runId: SETTINGS_RUN,
      status: 'dispatching',
      tasks: [taskOf('t1', { status: 'running' })],
    },
  })
}

type SettingsPort = NonNullable<LibraryDeps['settings']>

/** 用同一份 run 数据装配详情，返回第一个成员（不吞装配错误：noThrow 用例会单独验证端口不抛）。 */
function memberWith(settings?: SettingsPort): MemberView | undefined {
  const { dir, store } = tempRuns()
  try {
    store.save(settingsState())
    const deps: LibraryDeps = {
      store,
      workspace: '/work/current',
      now: () => 10_000,
      roles: () => [{ id: 'dev', name: '开发' }],
      publicMemories: () => [],
      projectMemories: () => [],
      ...(settings === undefined ? {} : { settings }),
    }
    const detail = buildLibrary(deps, { runId: SETTINGS_RUN }).detail
    assert.ok(detail, '详情必须装配出来')
    return detail.members?.[0]
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('① 设置端口生效：stallMs=1000 + 静默 2 秒 → quiet；缺省 90000 下同数据不判停', () => {
  const custom = memberWith(() => ({ stallMs: 1_000 }))
  assert.ok(custom)
  assert.equal(custom.status, 'running', '前置：成员必须处于在跑态，否则停滞字段恒为 none')
  assert.equal(custom.stalled, true)
  assert.equal(custom.stallReason, 'quiet')
  assert.equal(custom.stalledForMs, 2_000)
  // 与唯一判定函数逐字一致（端口只是把阈值传进去，不许在装配层另写一套判定）
  assert.deepEqual(
    { stalled: custom.stalled, stalledForMs: custom.stalledForMs, reason: custom.stallReason },
    stallOf(8_000, 10_000, 1_000),
  )

  const byDefault = memberWith()
  assert.ok(byDefault)
  assert.equal(byDefault.status, 'running')
  assert.equal(byDefault.stalled, false, '缺省阈值 90 秒，静默 2 秒不得判停')
  assert.equal(byDefault.stallReason, 'none')
  assert.equal(byDefault.stalledForMs, 0)
  assert.notEqual(byDefault.stalled, custom.stalled, '同一份数据两种阈值必须给出不同判定（本用例的判别力）')
})

test('① 设置端口回落：settings 返回 undefined / 缺字段 / 非正数 / 抛错 → 缺省 90 秒且不抛', () => {
  const cases: ReadonlyArray<readonly [string, SettingsPort]> = [
    ['settings() 返回 undefined', () => undefined as unknown as { stallMs?: number }],
    ['stallMs 缺字段', () => ({})],
    ['stallMs = 0', () => ({ stallMs: 0 })],
    ['stallMs 为负数', () => ({ stallMs: -5 })],
    ['stallMs 为 NaN', () => ({ stallMs: Number.NaN })],
    ['settings() 抛错', () => {
      throw new Error('settings boom')
    }],
  ]
  for (const [label, settings] of cases) {
    let member: MemberView | undefined
    assert.doesNotThrow(() => {
      member = memberWith(settings)
    }, `${label}：端口异常不得把详情装配打挂`)
    assert.ok(member, label)
    assert.equal(member.stalled, false, `${label}：必须回落 90 秒（静默 2 秒不判停）`)
    assert.equal(member.stallReason, 'none', label)
    assert.equal(member.stalledForMs, 0, label)
  }
  // 判别力来源：若回落成 0，stallOf 对任何静默都判停滞，上面六条会同时变红
  assert.deepEqual(stallOf(8_000, 10_000, 0), { stalled: true, stalledForMs: 2_000, reason: 'quiet' })
  assert.equal(STALL_MS, 90_000, '缺省阈值的唯一来源必须仍是 config.STALL_MS')
})

/* ───────── ② RunSummary.duration：与宿主 runDurationOf 同源、算不出即缺席 ───────── */

interface BridgeHarness {
  dir: string
  store: RunsStore
  bridge: Bridge
  cleanup: () => void
}

function createHarness(): BridgeHarness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r61-t3-bridge-'))
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
    applyReceipt: (state) => state,
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
    now: () => NOW,
  })
  return { dir, store, bridge, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('② 历史行 duration：done/running 的 text 与 runDurationOf 逐字相等，终态无结束 → 字段缺席', () => {
  const h = createHarness()
  try {
    const doneState = stateOf({
      plannedAt: 1_000,
      finishedAt: 6_000,
      plan: { runId: 'r-done', status: 'terminated', tasks: [taskOf('t1', { status: 'done' })] },
    })
    const runningState = stateOf({
      plannedAt: NOW - 90_000,
      plan: { runId: 'r-run', status: 'dispatching', tasks: [taskOf('t1', { status: 'running' })] },
    })
    const absentState = stateOf({
      plannedAt: 1_000,
      taskTimes: {},
      messages: [],
      plan: { runId: 'r-absent', status: 'cancelled', tasks: [taskOf('t1', { status: 'cancelled' })] },
    })
    h.store.save(doneState)
    h.store.save(runningState)
    h.store.save(absentState)

    const rows = h.bridge.snapshot(SESSION).runs ?? []
    assert.equal(rows.length, 3)
    const byId = new Map(rows.map((row) => [row.runId, row]))

    const done = byId.get('r-done')!
    assert.ok(done.duration, '已完成 run 必须有 duration')
    assert.deepEqual(done.duration, runDurationOf(doneState, NOW), '历史行与 runDurationOf 必须是同一个单元格')
    assert.equal(done.duration.state, 'done')
    assert.equal(done.duration.text, '5 秒')

    const running = byId.get('r-run')!
    assert.ok(running.duration)
    assert.deepEqual(running.duration, runDurationOf(runningState, NOW))
    assert.equal(running.duration.state, 'running')
    assert.equal(running.duration.text, '1 分 30 秒')

    const absent = byId.get('r-absent')!
    assert.equal(absent.status, 'cancelled')
    assert.equal('duration' in absent, false, '终态算不出结束时刻：字段必须缺席，不得写「不可得」占位')
    // 对照：同一个 run 的中心算法确实返回 unavailable —— 证明「缺席」是守卫的结果，不是算不出来
    assert.deepEqual(runDurationOf(absentState, NOW).state, 'unavailable')
  } finally {
    h.cleanup()
  }
})

/* ───────────── ③ 客户端：宿主值优先，缺席才回落旧派生 ───────────── */

const HOST_CELL: DurationCell = { state: 'done', text: '1 小时 2 分' }

function summaryOf(over: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'run-r61-client',
    sessionId: SESSION,
    createdAt: 1_000,
    status: 'terminated',
    tasks: 1,
    done: 1,
    ...over,
  }
}

test('③ 宿主给了 duration 时逐字透传：不再按 plannedAt/finishedAt 二次派生', () => {
  const run = summaryOf({ plannedAt: 1_000, finishedAt: 6_000, duration: HOST_CELL })
  const row = runSummaryRowOf(run, 10_000)
  assert.equal(row.durationText, '1 小时 2 分')
  assert.equal(row.durationState, 'done')
  // 反证：同一组时间戳若走客户端派生会得到「5 秒」，出现它就说明发生了二次派生
  assert.notEqual(row.durationText, '5 秒')
})

test('③ 终态缺结束时刻但宿主给了值：客户端不得改写为「不可得」', () => {
  const run = summaryOf({ status: 'cancelled', plannedAt: 1_000, duration: HOST_CELL })
  const row = runSummaryRowOf(run, 10_000)
  assert.equal(row.durationText, '1 小时 2 分', '派生路径会把这条算成 unavailable，宿主值必须优先')
  assert.notEqual(row.durationState, 'unavailable')
})

test('③ 宿主给的不可得原因逐字进 title', () => {
  const reason = '宿主：该 run 没有开始时刻（旧数据）'
  const run = summaryOf({ plannedAt: undefined, duration: { state: 'unavailable', text: '不可得', reason } })
  const row = runSummaryRowOf(run, 10_000)
  assert.equal(row.durationState, 'unavailable')
  assert.match(row.durationTitle, new RegExp(reason))
})

test('③ duration 缺席：回落旧派生且不崩', () => {
  const done = runSummaryRowOf(summaryOf({ plannedAt: 1_000, finishedAt: 6_000 }), 10_000)
  assert.equal(done.durationState, 'done')
  assert.equal(done.durationText, '5 秒')

  const noEnd = runSummaryRowOf(summaryOf({ status: 'cancelled', plannedAt: 1_000 }), 10_000)
  assert.equal(noEnd.durationState, 'unavailable')
  assert.ok(noEnd.durationTitle.length > 0, '不可得必须带人话原因，不能空串')
})
