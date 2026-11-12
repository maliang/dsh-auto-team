/**
 * r25 QA 回归：终态 run 不再显示为「进行中」 + 收口时如实终结残留任务。
 *
 * 背景（r25 根因）：`store.list()` 过去只按**任务状态**数 `ongoing`，不看 `plan.status`。
 * r24 的残留计划对账把 run 写成 `terminated`，但残留的 running/pending 任务原样保留，
 * 于是「已终止」的 run 仍然 ongoing>0、`active=true`——能碳任务页永远多一张「进行中」卡。
 *
 * 断言口径（每条都问过「改回错误实现会不会红」）：
 *  - list()：terminated/cancelled 的 run 即使带 running/pending/rework 也 ongoing=0/active=false；
 *    把 `planClosed ? 0 : …` 改回按任务数，这组断言立刻红。非终态 run 的口径必须逐字不变。
 *  - 收口入口（reconcileStalePlans / closeRun / repairClosedRuns）：**同一次落盘**把残留任务
 *    终结为 cancelled + cancelledAt=run.finishedAt + cancelReason='计划已收口：<原因>'
 *    + cancelledBy='stale'；已终态任务逐字不动。用 save 计数证明「一次写盘」。
 *  - 幂等：第二次运行零 save、文件字节不变（既有历史脏数据不得反复改写）。
 *  - 用时：cancelled 缺起止 → unavailable + 可读原因（退回 not-started 会红）。
 *  - 客户端兜底：宿主仍下发「terminated 但 ongoing>0」的旧形状时，activeRunRowsOf 不得把
 *    它当进行中卡；全部终态时回退最新一条且 hasOngoing=false（不是空白）。
 *  - cancelledBy='stale' 在卡片上翻成中文，绝不出现英文枚举。
 *
 * 冻结数据：`test/fixtures/r25-residual-runs/` 下的两份 run 是从真实
 * `~/.dsh/auto-team/runs/` 冻结的**未收口形态**（2026-11-12 15:01 前现场），不随宿主现场变化更新。
 * 复制到隔离目录后再修，fixture 字节前后必须一致；用例不再读取任何 `~/.dsh` 下的运行数据。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBridge, type Bridge } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import {
  RUN_STATE_VERSION,
  RunsStore,
  STALE_PLAN_REASON,
  cancelResidualTasks,
  finishedAtOf,
  lastActivityAtOf,
  reconcileStalePlans,
  repairClosedRuns,
  type RunState,
  type SaveOptions,
} from '../src/host/store.ts'
import type { HostMember } from '../src/host/team/watcher.ts'
import { activeRunRowsOf } from '../src/client/nav.ts'
import { isClosedRun, taskRowOf } from '../src/client/viewmodel.ts'
import { LEGACY_TASK_TIME_REASON, UNAVAILABLE_TEXT } from '../src/shared/duration.ts'
import type {
  DurationCell,
  PanelSnapshot,
  Plan,
  PlanTask,
  RunSummary,
  TaskStatus,
  TaskDetailView,
  UsageCell,
} from '../src/shared/types.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r25'
const RUN = 'run-r25'
const MINUTE = 60_000
const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['done', 'failed', 'cancelled', 'skipped', 'interrupted']

function taskOf(id: string, status: TaskStatus, extra: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: `exit ${id}`,
    status,
    ...extra,
  }
}

function planOf(over: Partial<Plan> = {}): Plan {
  return {
    runId: RUN,
    sessionId: SESSION,
    createdAt: NOW - 60 * MINUTE,
    status: 'draft',
    tasks: [taskOf('t1', 'pending')],
    maxConcurrent: 3,
    ...over,
  }
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: planOf(),
    plannedAt: NOW - 60 * MINUTE,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...over,
  }
}

/** 目录逐字快照（文件名 → 原文）：「零写入 / 字节不变」的唯一判据。 */
function snapshotDir(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {}
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isFile()) out[name] = readFileSync(full, 'utf8')
  }
  return out
}

/** `save` 计数的 store 包装（reconcile / repair 只依赖 list/load/save）。 */
function countingStore(dir: string): {
  list: () => ReturnType<RunsStore['list']>
  load: (runId: string) => RunState | null
  save: (state: RunState) => void
  saves: () => number
} {
  const store = new RunsStore(dir)
  let saves = 0
  return {
    list: () => store.list(),
    load: (runId: string) => store.load(runId),
    save: (state: RunState) => {
      saves += 1
      store.save(state)
    },
    saves: () => saves,
  }
}

/** 真 RunsStore 子类：桥要完整实例，这里只额外数 closeRun 写了几次盘。 */
class CountingRunsStore extends RunsStore {
  saves = 0
  save(state: RunState, options?: SaveOptions): void {
    this.saves += 1
    super.save(state, options)
  }
}

interface Harness {
  dir: string
  store: CountingRunsStore
  bridge: Bridge
}

function createHarness(options: { listMembers?: () => Promise<HostMember[]> } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r25-'))
  const store = new CountingRunsStore(join(dir, 'runs'))
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
    ...(options.listMembers === undefined ? {} : { listMembers: options.listMembers }),
  })
  bridge.setEnabled(SESSION, true)
  return { dir, store, bridge }
}

// ---------------------------------------------------------------------------
// ① store.list()：终态 run 的 ongoing/active 必须归零
// ---------------------------------------------------------------------------

test('list()：terminated / cancelled 的 run 即使残留 running/pending/rework 也 ongoing=0、active=false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r25-list-'))
  try {
    const store = new RunsStore(dir)
    // r24 现场形状：run 已 terminated，任务却还是 running/pending（旧收口只改计划态）。
    store.save(
      stateOf({
        plan: planOf({
          runId: 'run-term',
          status: 'terminated',
          tasks: [taskOf('t1', 'running'), taskOf('t2', 'pending'), taskOf('t3', 'rework'), taskOf('t4', 'done')],
        }),
        finishedAt: NOW - 30 * MINUTE,
        termination: { kind: 'stale', reason: STALE_PLAN_REASON },
      }),
    )
    store.save(
      stateOf({
        plan: planOf({
          runId: 'run-cancel',
          status: 'cancelled',
          tasks: [taskOf('t1', 'gate'), taskOf('t2', 'blocked'), taskOf('t3', 'done')],
        }),
        finishedAt: NOW - 20 * MINUTE,
        termination: { kind: 'cancelled', reason: '队长取消了本次运行' },
      }),
    )
    // 对照：非终态 run 的算法逐字不变（否则「进行中」会整体失灵，这是另一种红）。
    store.save(
      stateOf({
        plan: planOf({
          runId: 'run-live',
          status: 'dispatching',
          tasks: [taskOf('t1', 'running'), taskOf('t2', 'pending'), taskOf('t3', 'done')],
        }),
      }),
    )

    const byId = new Map(store.list().map((run) => [run.runId, run]))

    for (const runId of ['run-term', 'run-cancel']) {
      const summary = byId.get(runId)
      assert.ok(summary, `${runId} 必须出现在 list()`)
      assert.equal(summary.ongoing, 0, `${runId} 已收口：残留任务不得计入进行中`)
      assert.equal(summary.active, false, `${runId} 已收口：不得标活跃`)
      assert.equal(summary.status === 'terminated' || summary.status === 'cancelled', true)
    }
    // 计数本身没有被抹掉：历史列表仍要显示 1/4、1/3。
    assert.equal(byId.get('run-term')?.tasks, 4)
    assert.equal(byId.get('run-term')?.done, 1)
    assert.equal(byId.get('run-cancel')?.tasks, 3)
    assert.equal(byId.get('run-cancel')?.done, 1)

    // 对照组：非终态 run 仍然按任务状态数。
    assert.equal(byId.get('run-live')?.ongoing, 2)
    assert.equal(byId.get('run-live')?.active, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ② reconcileStalePlans：收口与任务终结必须同一次写盘
// ---------------------------------------------------------------------------

test('reconcile：一次落盘同时写 terminated 与任务终结（四字段齐全），已终态任务逐字不动', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r25-reconcile-'))
  try {
    const lastActivity = NOW - 31 * MINUTE
    const seed = new RunsStore(dir)
    const originalTasks = [
      taskOf('t1', 'running', { memberId: 'member-1' }),
      taskOf('t2', 'gate'),
      taskOf('t3', 'rework', { attempts: 2 }),
      taskOf('t4', 'pending'),
      taskOf('t5', 'blocked'),
      taskOf('t6', 'waiting', { waitReason: '等写域' }),
      taskOf('t7', 'done'),
      taskOf('t8', 'failed'),
    ]
    seed.save(
      stateOf({
        plan: planOf({ tasks: originalTasks, createdAt: lastActivity }),
        plannedAt: lastActivity,
      }),
    )

    const store = countingStore(dir)
    const reconciled = reconcileStalePlans(store, { now: NOW })
    assert.deepEqual(reconciled, [RUN])
    assert.equal(store.saves(), 1, '收口只允许一次 save：中间态（已 terminated 但任务还 running）不得落盘')

    const closed = store.load(RUN)
    assert.ok(closed)
    assert.equal(closed.plan.status, 'terminated')
    assert.equal(closed.finishedAt, lastActivity, 'finishedAt 必须是最后活动时刻，不是 now')
    assert.equal(closed.termination?.kind, 'stale')
    assert.equal(closed.termination?.reason, STALE_PLAN_REASON)

    const expectedReason = `计划已收口：${STALE_PLAN_REASON}`
    const after = new Map(closed.plan.tasks.map((task) => [task.id, task]))
    for (const task of originalTasks) {
      const next = after.get(task.id)
      assert.ok(next, `${task.id} 不得丢失`)
      if (TERMINAL_TASK_STATUSES.includes(task.status)) {
        assert.deepEqual(next, task, `${task.id} 已是终态，必须逐字保留（不许补 cancelledAt）`)
        continue
      }
      assert.equal(next.status, 'cancelled', `${task.id} 残留任务必须终结为 cancelled`)
      assert.equal(next.cancelledAt, closed.finishedAt, `${task.id} cancelledAt = run.finishedAt`)
      assert.equal(next.cancelReason, expectedReason, `${task.id} 原因必须可读且带「计划已收口：」前缀`)
      assert.equal(next.cancelledBy, 'stale', `${task.id} 来源必须是 stale`)
      const { status: _s, cancelledAt: _at, cancelReason: _r, cancelledBy: _b, ...rest } = next
      const { status: _taskStatus, ...taskRest } = task
      assert.deepEqual(rest, taskRest, `${task.id} 除终结字段外的内容必须原样`)
    }

    // 输入 state 不被就地修改（纯函数语义；否则调用方拿到半改的状态会再次写盘）。
    const reloaded = new RunsStore(dir).load(RUN)
    assert.equal(reloaded?.plan.tasks.filter((task) => task.status === 'cancelled').length, 6)

    // 幂等：第二次零写入、字节不变。
    const bytes = snapshotDir(dir)
    assert.deepEqual(reconcileStalePlans(store, { now: NOW + 1_000 }), [])
    assert.equal(store.saves(), 1, '第二次不得再写')
    assert.deepEqual(snapshotDir(dir), bytes)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cancelResidualTasks：纯函数、只终结非终态任务并返回改动数（不改原数组）', () => {
  const state = stateOf({
    plan: planOf({
      tasks: [taskOf('t1', 'running'), taskOf('t2', 'pending'), taskOf('t3', 'done'), taskOf('t4', 'cancelled')],
    }),
  })
  const result = cancelResidualTasks(state, 12_345, '某个原因')
  assert.equal(result.changed, 2)
  assert.deepEqual(
    result.tasks.map((task) => task.status),
    ['cancelled', 'cancelled', 'done', 'cancelled'],
  )
  assert.deepEqual(
    state.plan.tasks.map((task) => task.status),
    ['running', 'pending', 'done', 'cancelled'],
    '输入 state 必须保持原样',
  )
  assert.equal(result.tasks[0]?.cancelReason, '计划已收口：某个原因')
  assert.equal(result.tasks[0]?.cancelledAt, 12_345)
  assert.equal(result.tasks[2]?.cancelReason, undefined)
})

// ---------------------------------------------------------------------------
// ③ closeRun：同一次写盘 + 用户原因
// ---------------------------------------------------------------------------

test('closeRun：一次写盘同时落 terminated 与残留任务终结，cancelledAt=now、原因=用户终止残留计划', async () => {
  const h = createHarness()
  try {
    h.store.save(
      stateOf({
        plan: planOf({
          status: 'dispatching',
          tasks: [taskOf('t1', 'running'), taskOf('t2', 'pending'), taskOf('t3', 'done')],
        }),
        plannedAt: NOW - 5 * MINUTE,
      }),
    )
    const savesBefore = h.store.saves
    const result = await h.bridge.act(SESSION, { type: 'closeRun', runId: RUN })
    assert.equal(result.rejected, undefined)
    assert.equal(h.store.saves, savesBefore + 1, 'closeRun 只许写一次盘（终态与任务终结不能分两次）')

    const stored = h.store.load(RUN)
    assert.equal(stored?.plan.status, 'terminated')
    assert.equal(stored?.finishedAt, NOW)
    assert.deepEqual(stored?.termination, { kind: 'stale', reason: '用户终止残留计划' })

    const tasks = new Map((stored?.plan.tasks ?? []).map((task) => [task.id, task]))
    for (const id of ['t1', 't2']) {
      assert.equal(tasks.get(id)?.status, 'cancelled')
      assert.equal(tasks.get(id)?.cancelledAt, NOW)
      assert.equal(tasks.get(id)?.cancelReason, '计划已收口：用户终止残留计划')
      assert.equal(tasks.get(id)?.cancelledBy, 'stale')
    }
    assert.deepEqual(tasks.get('t3'), taskOf('t3', 'done'), '已 done 的任务逐字不动')
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ④ repairClosedRuns：历史脏数据一次性修正 + 幂等
// ---------------------------------------------------------------------------

test('repairClosedRuns：修正已收口 run 的残留任务（cancelledAt=finishedAt、原因沿用终止原因），二次零改写', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r25-repair-'))
  try {
    const seed = new RunsStore(dir)
    const closedAt = NOW - 40 * MINUTE
    seed.save(
      stateOf({
        plan: planOf({
          runId: 'run-legacy',
          status: 'terminated',
          tasks: [taskOf('t1', 'running'), taskOf('t2', 'pending'), taskOf('t3', 'done')],
        }),
        finishedAt: closedAt,
        termination: { kind: 'stale', reason: STALE_PLAN_REASON },
      }),
    )
    // 没有落盘 finishedAt 的更旧 run：按 finishedAtOf 回退到 taskTimes.endedAt。
    seed.save(
      stateOf({
        plan: planOf({
          runId: 'run-no-finished',
          status: 'cancelled',
          tasks: [taskOf('t1', 'running')],
        }),
        taskTimes: { t1: { startedAt: NOW - 120 * MINUTE, endedAt: NOW - 60 * MINUTE } },
        termination: { kind: 'cancelled', reason: '队长取消了本次运行' },
      }),
    )

    const store = countingStore(dir)
    assert.deepEqual(repairClosedRuns(store).sort(), ['run-legacy', 'run-no-finished'])
    assert.equal(store.saves(), 2, '每个有残留任务的 run 各写一次')

    const legacy = store.load('run-legacy')
    assert.equal(legacy?.plan.status, 'terminated', '修正不得改计划态')
    const legacyTasks = new Map((legacy?.plan.tasks ?? []).map((task) => [task.id, task]))
    for (const id of ['t1', 't2']) {
      assert.equal(legacyTasks.get(id)?.status, 'cancelled')
      assert.equal(legacyTasks.get(id)?.cancelledAt, closedAt, 'cancelledAt 必须 = 既有的 finishedAt')
      assert.equal(legacyTasks.get(id)?.cancelReason, `计划已收口：${STALE_PLAN_REASON}`)
      assert.equal(legacyTasks.get(id)?.cancelledBy, 'stale')
    }
    assert.deepEqual(legacyTasks.get('t3'), taskOf('t3', 'done'))

    const fallback = store.load('run-no-finished')
    assert.equal(finishedAtOf(fallback as RunState), NOW - 60 * MINUTE)
    assert.equal(fallback?.plan.tasks[0]?.cancelledAt, NOW - 60 * MINUTE, '缺 finishedAt 时用可核实的结束时刻')
    assert.equal(fallback?.plan.tasks[0]?.cancelReason, '计划已收口：队长取消了本次运行')

    // 幂等：第二次零 save、字节逐字不变。
    const bytes = snapshotDir(dir)
    assert.deepEqual(repairClosedRuns(store), [])
    assert.equal(store.saves(), 2, '第二次不许再写盘')
    assert.deepEqual(snapshotDir(dir), bytes)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('repairClosedRuns：单个 run 写失败只 warn 并跳过，其余 run 照常修（不阻断面板）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r25-repair-fail-'))
  try {
    const seed = new RunsStore(dir)
    for (const runId of ['run-bad', 'run-good']) {
      seed.save(
        stateOf({
          plan: planOf({ runId, status: 'terminated', tasks: [taskOf('t1', 'running')] }),
          finishedAt: NOW - 30 * MINUTE,
          termination: { kind: 'stale', reason: '历史原因' },
        }),
      )
    }
    const store = new RunsStore(dir)
    const warnings: string[] = []
    const flaky = {
      list: () => store.list(),
      load: (runId: string) => store.load(runId),
      save: (state: RunState) => {
        if (state.plan.runId === 'run-bad') throw new Error('磁盘只读')
        store.save(state)
      },
    }

    let repaired: string[] = []
    assert.doesNotThrow(() => {
      repaired = repairClosedRuns(flaky, { onWarn: (message) => warnings.push(message) })
    })
    assert.deepEqual(repaired, ['run-good'])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? '', /run-bad/, '告警必须点名是哪条 run')
    assert.match(warnings[0] ?? '', /磁盘只读/, '失败原因必须可读，不能吞成「偶发」')
    assert.equal(store.load('run-bad')?.plan.tasks[0]?.status, 'running', '写失败的文件保持原样，下次启动重试')
    assert.equal(store.load('run-good')?.plan.tasks[0]?.status, 'cancelled')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ⑤ taskDurationsOf：cancelled 缺时刻 → unavailable + 原因
// ---------------------------------------------------------------------------

test('taskDurationsOf：cancelled 缺起止 → unavailable+reason（不许退回未开始）；完整记录逐字不变', () => {
  const h = createHarness()
  try {
    const startedAt = NOW - 65_000
    const endedAt = NOW - 5_000
    h.store.save(
      stateOf({
        plan: planOf({
          status: 'dispatching',
          tasks: [
            taskOf('t1', 'cancelled'),
            taskOf('t2', 'cancelled'),
            taskOf('t3', 'cancelled'),
            taskOf('t4', 'pending'),
            taskOf('t5', 'running'),
          ],
        }),
        plannedAt: NOW - 5 * MINUTE,
        taskTimes: {
          t2: { startedAt },
          t3: { startedAt, endedAt },
          t5: { startedAt: NOW - 10_000 },
        },
      }),
    )

    const durations = h.bridge.snapshot(SESSION).taskDurations ?? {}
    // 缺两端：旧实现会判 not-started（「未开始」），在已取消任务上是假话。
    assert.deepEqual(durations.t1, {
      state: 'unavailable',
      text: UNAVAILABLE_TEXT,
      reason: LEGACY_TASK_TIME_REASON,
    })
    // 只有起点：同样是不可得，不是「进行中」。
    assert.deepEqual(durations.t2, {
      state: 'unavailable',
      text: UNAVAILABLE_TEXT,
      reason: LEGACY_TASK_TIME_REASON,
    })
    // 完整记录：沿用旧算法，文本逐字为『1 分 00 秒』。
    assert.equal(durations.t3?.state, 'done')
    assert.equal(durations.t3?.text, '1 分 00 秒')
    assert.equal(durations.t3?.ms, 60_000)
    assert.equal(durations.t3?.startAt, startedAt)
    assert.equal(durations.t3?.endAt, endedAt)
    // 真正没开始的才允许 not-started，且不带 reason。
    assert.deepEqual(durations.t4, { state: 'not-started', text: '未开始' })
    assert.equal('reason' in (durations.t4 ?? {}), false)
    // running 仍按 now 推当前耗时（不能因为本次改动被压成不可得）。
    assert.equal(durations.t5?.state, 'running')
    assert.equal(durations.t5?.endAt, NOW)
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ⑥ 客户端兜底：终态 run 绝不作为「进行中」卡
// ---------------------------------------------------------------------------

function runSummaryOf(over: Partial<RunSummary> & { runId: string }): RunSummary {
  return {
    sessionId: SESSION,
    createdAt: NOW - 60 * MINUTE,
    status: 'draft',
    tasks: 2,
    done: 0,
    plannedAt: NOW - 60 * MINUTE,
    ...over,
  }
}

function snapshotOf(runs: RunSummary[], runId = runs[0]?.runId ?? ''): PanelSnapshot {
  return { sessionId: SESSION, runId, runs } as unknown as PanelSnapshot
}

test('activeRunRowsOf：terminated 但 ongoing>0 的旧形状不得进进行中卡；全部终态时回退最新一条且 hasOngoing=false', () => {
  // 旧宿主/旧数据：计划态已是 terminated/cancelled，ongoing 却还是正数。
  const oldTerminated = runSummaryOf({
    runId: 'run-old-term',
    status: 'terminated',
    tasks: 4,
    done: 1,
    ongoing: 3,
    active: true,
    plannedAt: NOW - 30 * MINUTE,
    finishedAt: NOW - 30 * MINUTE,
    terminationReason: STALE_PLAN_REASON,
  } as Partial<RunSummary> & { runId: string })
  const oldCancelled = runSummaryOf({
    runId: 'run-old-cancel',
    status: 'cancelled',
    tasks: 3,
    done: 1,
    ongoing: 2,
    active: true,
    finishedAt: NOW - 20 * MINUTE,
    terminationReason: '队长取消了本次运行',
  } as Partial<RunSummary> & { runId: string })
  const live = runSummaryOf({
    runId: 'run-live',
    status: 'dispatching',
    tasks: 3,
    done: 1,
    ongoing: 2,
    active: true,
    plannedAt: NOW - 10 * MINUTE,
  } as Partial<RunSummary> & { runId: string })

  const mixed = activeRunRowsOf({ snapshot: snapshotOf([oldCancelled, oldTerminated, live]) })
  assert.ok(mixed)
  assert.equal(mixed.fallback, false)
  assert.deepEqual(mixed.rows.map((row) => row.runId), ['run-live'], '只有真·进行中的 run 能成卡')
  assert.equal(mixed.rows[0]?.hasOngoing, true)

  // 全部终态（含旧形状 ongoing>0）：回退最新一条，状态不能写「进行中」。
  const allClosed = activeRunRowsOf({ snapshot: snapshotOf([oldCancelled, oldTerminated]) })
  assert.ok(allClosed)
  assert.equal(allClosed.fallback, true, '没有进行中 run 时仍要显示最后一条，不得空白')
  assert.equal(allClosed.rows.length, 1)
  assert.equal(allClosed.rows[0]?.runId, 'run-old-term', '取 plannedAt 最新的一条')
  assert.equal(allClosed.rows[0]?.hasOngoing, false)
  assert.equal(allClosed.rows[0]?.cardMetaText.includes('进行中'), false, '终态 run 的 meta 不许写进行中')
  assert.equal(allClosed.rows[0]?.statusText, '已终止', '回退行必须如实显示已终止（不能是进行中）')
  assert.equal(allClosed.rows[0]?.active, false, '终态 run 的 active 必须为 false')

  // 客户端自己的判定：计划态终态，或「终止原因 + finishedAt」双事实，都算已收口。
  assert.equal(isClosedRun(oldTerminated), true)
  assert.equal(isClosedRun(oldCancelled), true)
  assert.equal(isClosedRun(live), false)
  assert.equal(
    isClosedRun({ status: 'draft', finishedAt: NOW - 1_000, terminationReason: '外部终止' }),
    true,
    '旧宿主写成非终态但带了终止事实：客户端必须自己兜底',
  )
})

// ---------------------------------------------------------------------------
// ⑦ 客户端文案：cancelledBy='stale' 必须翻成中文
// ---------------------------------------------------------------------------

function usageOf(): UsageCell {
  return { source: 'unavailable', text: '不可得' }
}

function durationOf(): DurationCell {
  return { state: 'unavailable', text: UNAVAILABLE_TEXT, reason: LEGACY_TASK_TIME_REASON }
}

function taskDetailOf(over: Partial<TaskDetailView> & { id: string; status: TaskStatus }): TaskDetailView {
  return {
    title: `任务 ${over.id}`,
    roleId: 'dev',
    roleName: '开发',
    dependsOn: [],
    acceptance: 'true',
    usage: usageOf(),
    duration: durationOf(),
    messageCount: 0,
    ...over,
  }
}

test('taskRowOf：cancelledBy=stale 且宿主没写原因时用中文兜底，英文枚举绝不上屏', () => {
  const stale = taskDetailOf({
    id: 't1',
    status: 'cancelled',
    cancelledAt: NOW,
    cancelledBy: 'stale',
  })
  const staleRow = taskRowOf(stale, false)
  assert.equal(staleRow.cancelReason, '计划已收口，任务随计划一起终结')
  assert.equal(/stale/i.test(staleRow.cancelReason ?? ''), false, 'cancelledBy 的英文枚举不得出现在界面上')

  // 宿主写了具体原因 → 原样使用（不覆盖成兜底文案）。
  const explicit = taskRowOf(
    taskDetailOf({
      id: 't2',
      status: 'cancelled',
      cancelReason: '计划已收口：用户终止残留计划',
      cancelledBy: 'stale',
    }),
    false,
  )
  assert.equal(explicit.cancelReason, '计划已收口：用户终止残留计划')

  // 非取消任务没有原因（不把原因复制到别的状态上）。
  const done = taskRowOf(taskDetailOf({ id: 't3', status: 'done', cancelReason: '不该显示' }), false)
  assert.equal(done.cancelReason, undefined)
})

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ⑧ 冻结 fixture：未收口残留 run 的收口回归（不读宿主现场）
// ---------------------------------------------------------------------------

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(TEST_DIR, 'fixtures', 'r25-residual-runs')
const FIXTURE_FILES = ['run-mwa9n8xf-1c61.json', 'run-mwa9uuow-1c61.json']
/** 2026-11-10 现场最后活动时刻（r24 已核实的字面量）：finishedAt 必须等于它，不是 now。 */
const REAL_EXPECTED_LAST_ACTIVITY: Record<string, number> = {
  'run-mwa9n8xf-1c61': 1794289508191,
  'run-mwa9uuow-1c61': 1794291394249,
}

test('冻结 fixture：残留 run 收口后任务全 cancelled、ongoing=0、二次 repair 零改写', () => {
  // 防漂移守卫：fixture 必须在仓库 test/ 内，路径里不得出现宿主数据目录（~/.dsh）。
  const repoTestDir = `${resolve(TEST_DIR)}${sep}`
  for (const file of FIXTURE_FILES) {
    const path = resolve(FIXTURE_DIR, file)
    assert.ok(path.startsWith(repoTestDir), `${file} 的 fixture 必须落在仓库 test/ 内：${path}`)
    assert.equal(path.includes(`${sep}.dsh${sep}`), false, `${file} 的 fixture 不得指向 ~/.dsh：${path}`)
    assert.equal(path.includes('~'), false, `${file} 的 fixture 路径不得含 ~：${path}`)
  }
  assert.equal(FIXTURE_DIR.includes(`${sep}.dsh${sep}`), false, 'fixture 目录不得指向 ~/.dsh')

  const missing = FIXTURE_FILES.filter((file) => !existsSync(join(FIXTURE_DIR, file)))
  assert.deepEqual(missing, [], '仓库内 fixture 必须齐全（缺了不是 skip，而是交付缺失）')

  const isolatedRoot = existsSync('/tmp') ? '/tmp' : tmpdir()
  const isoDir = mkdtempSync(join(isolatedRoot, 'auto-team-r25-fixture-'))
  try {
    // fixture 先取字节快照，结束时逐字节比对（证明副本操作没有倒写仓库内 fixture）。
    const sourceBefore = FIXTURE_FILES.map((file) => readFileSync(join(FIXTURE_DIR, file)))
    for (const file of FIXTURE_FILES) copyFileSync(join(FIXTURE_DIR, file), join(isoDir, file))

    const store = new RunsStore(isoDir)
    // 两份 fixture 都是未收口形态（draft、无 termination/finishedAt）：走 reconcileStalePlans 收口，
    // repairClosedRuns 对非终态 run 是 no-op。两条入口都跑，断言同一组终态事实。
    const before = new Map<string, RunState>()
    for (const file of FIXTURE_FILES) {
      const runId = file.slice(0, -'.json'.length)
      const state = store.load(runId)
      assert.ok(state, `${file} 必须能按真实落盘格式读出`)
      assert.equal(lastActivityAtOf(state), REAL_EXPECTED_LAST_ACTIVITY[runId], '最后活动时刻与现场值逐毫秒相等')
      assert.equal(state.plan.status, 'draft', `${runId} fixture 必须是未收口形态（防止 fixture 被改成已收口）`)
      assert.equal(state.finishedAt, undefined, `${runId} fixture 不得带 finishedAt`)
      assert.equal(state.termination, undefined, `${runId} fixture 不得带 termination`)
      before.set(runId, state)
    }

    const reconciled = reconcileStalePlans(store, { now: Date.now() })
    const repaired = repairClosedRuns(store)
    assert.ok(reconciled.length + repaired.length > 0, '两份未收口 fixture 至少有一条被收口入口处理')

    const byId = new Map(store.list().map((run) => [run.runId, run]))
    for (const [runId, source] of before) {
      const closed = store.load(runId)
      assert.ok(closed)
      assert.equal(closed.plan.status, 'terminated', `${runId} 必须收口为 terminated`)
      assert.equal(closed.finishedAt, REAL_EXPECTED_LAST_ACTIVITY[runId], `${runId} finishedAt 必须是最后活动时刻`)
      assert.equal(closed.termination?.kind, 'stale')
      assert.ok((closed.termination?.reason ?? '').length > 0, `${runId} 收口原因必须可读`)

      const expectedReason = `计划已收口：${closed.termination?.reason ?? ''}`
      const after = new Map(closed.plan.tasks.map((task) => [task.id, task]))
      let residual = 0
      for (const task of source.plan.tasks) {
        const next = after.get(task.id)
        assert.ok(next, `${runId}/${task.id} 不得丢失`)
        if (TERMINAL_TASK_STATUSES.includes(task.status)) {
          assert.deepEqual(next, task, `${runId}/${task.id} 已终态任务逐字保留`)
          continue
        }
        residual += 1
        assert.equal(next.status, 'cancelled', `${runId}/${task.id} 残留任务必须终结`)
        assert.equal(next.cancelledAt, closed.finishedAt, `${runId}/${task.id} cancelledAt = finishedAt`)
        assert.equal(next.cancelReason, expectedReason, `${runId}/${task.id} 原因必须可读且带前缀`)
        assert.equal(next.cancelledBy, 'stale', `${runId}/${task.id} 来源必须是 stale`)
      }
      const residualExpected = source.plan.tasks.filter((task) => !TERMINAL_TASK_STATUSES.includes(task.status)).length
      assert.ok(residualExpected > 0, `${runId} fixture 必须含未终结任务（否则收口断言没有验证对象）`)
      assert.equal(residual, residualExpected, `${runId} 被终结的任务数必须等于修复前残留数`)
      // 消息账本原样保留（收口只动计划态与任务终结字段）。
      assert.deepEqual(closed.messages, source.messages)

      // 用户看到的「进行中」：list() 必须归零，不能靠客户端兜底。
      const summary = byId.get(runId)
      assert.ok(summary)
      assert.equal(summary.ongoing, 0, `${runId} list().ongoing 必须为 0`)
      assert.equal(summary.active, false, `${runId} list().active 必须为 false`)
    }

    // 幂等：再跑一遍零改动（字节级）。
    const bytesAfterFirst = snapshotDir(isoDir)
    assert.deepEqual(reconcileStalePlans(store, { now: Date.now() + 1 }), [])
    assert.deepEqual(repairClosedRuns(store), [])
    assert.deepEqual(snapshotDir(isoDir), bytesAfterFirst)

    // 仓库内 fixture 没有被本用例改动。
    FIXTURE_FILES.forEach((file, index) => {
      assert.deepEqual(readFileSync(join(FIXTURE_DIR, file)), sourceBefore[index], `${file} fixture 必须原样`)
    })
  } finally {
    rmSync(isoDir, { recursive: true, force: true })
  }
})
