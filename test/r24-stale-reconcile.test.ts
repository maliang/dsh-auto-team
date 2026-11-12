/**
 * r24 QA 回归：残留计划自动收口（`reconcileStalePlans`）、手动终止（`closeRun`）
 * 与任务用时语义（`taskDurationsOf`）。
 *
 * 断言口径（每条都问过「改回错误实现会不会红」）：
 *  - 阈值：29 分钟不收口、31 分钟收口、恰好 30 分钟不收口（实现是严格 `>= now - staleMs` 跳过）；
 *    把 `<` 改成 `<=`、或把阈值从 30 分钟改成 1 小时，这三条里必有一条变红。
 *  - 幂等：用计数 store 直接数 `save` 调用 —— 第二次必须是 0 次，且文件字节不变；
 *    把「已有 termination/终态跳过」删掉，第二次会再写一次，计数断言立刻红。
 *  - 不误伤：`hasLiveMembers` 为 true 的 run 一个字节都不许动（含已有 termination 的 run）。
 *  - closeRun：终态 → `unchanged:true` 且零写入；有存活成员 → `BAD_REQUEST` 且零写入；
 *    残留 run → `terminated` + `finishedAt=now` + 可读 `termination.reason`。
 *  - 用时：done 缺起止 → `unavailable` + 原因（旧实现给 `not-started`，会红）；
 *    pending → `not-started`；完整记录 → 文本逐字不变（显式字面量断言）。
 *
 * 真实残留数据：用例只读 `~/.dsh/auto-team/runs/`，把两个 run 复制到仓库外的隔离临时目录后
 * 再跑收口逻辑，**不碰真实文件**；没有这两个文件的环境（非本开发机）显式 skip 并说明去 QA 报告看证据。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridge, type Bridge } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import {
  RUN_STATE_VERSION,
  RunsStore,
  STALE_PLAN_MS,
  STALE_PLAN_REASON,
  lastActivityAtOf,
  reconcileStalePlans,
  type RunState,
} from '../src/host/store.ts'
import type { HostMember } from '../src/host/team/watcher.ts'
import { LEGACY_TASK_TIME_REASON, UNAVAILABLE_TEXT, durationCellOf } from '../src/shared/duration.ts'
import type { MemberBinding, Plan, PlanTask, TaskStatus } from '../src/shared/types.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r24'
const RUN = 'run-r24'
const MINUTE = 60_000

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

function bindingOf(over: Partial<MemberBinding> = {}): MemberBinding {
  return { taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW - 10_000, ...over }
}

/** 目录逐字快照（文件名 → 原文）：「零写入」判据（直接给存放 run 文件的目录）。 */
function snapshotDir(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {}
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isFile()) out[name] = readFileSync(full, 'utf8')
  }
  return out
}

interface Harness {
  dir: string
  store: RunsStore
  bridge: Bridge
}

function createHarness(options: { listMembers?: () => Promise<HostMember[]>; seed?: (store: RunsStore) => void } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r24-'))
  const store = new RunsStore(join(dir, 'runs'))
  // 装配前落盘（用来验证「对账发生在任何 snapshot/list 读取之前」）。
  options.seed?.(store)
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

// ---------------------------------------------------------------------------
// reconcileStalePlans：阈值边界
// ---------------------------------------------------------------------------

test('reconcile：29 分钟不收口；恰好 30 分钟不收口（「早于」是严格）；31 分钟收口', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r24-threshold-'))
  try {
    const store = new RunsStore(dir)
    // 三条 run 的差异只有「最后活动时刻」：计划时刻故意都设成 2 小时前，
    // 证明判定看的是最后活动而不是 createdAt（看 createdAt 的实现会把 29 分钟那条也收掉）。
    store.save(
      stateOf({
        plan: planOf({ runId: 'run-29', createdAt: NOW - 120 * MINUTE }),
        plannedAt: NOW - 29 * MINUTE,
      }),
    )
    store.save(
      stateOf({
        plan: planOf({ runId: 'run-30', createdAt: NOW - 120 * MINUTE }),
        plannedAt: NOW - STALE_PLAN_MS,
      }),
    )
    store.save(
      stateOf({
        plan: planOf({ runId: 'run-31', createdAt: NOW - 120 * MINUTE }),
        plannedAt: NOW - 31 * MINUTE,
      }),
    )

    const reconciled = reconcileStalePlans(store, { now: NOW })
    assert.deepEqual(reconciled, ['run-31'])

    for (const runId of ['run-29', 'run-30']) {
      const state = store.load(runId)
      assert.equal(state?.plan.status, 'draft', `${runId} 不该被收口`)
      assert.equal(state?.finishedAt, undefined)
      assert.equal(state?.termination, undefined)
    }

    const closed = store.load('run-31')
    assert.equal(closed?.plan.status, 'terminated')
    // finishedAt 必须是「最后活动时刻」，不是 now —— 写成 now 这条断言会红。
    assert.equal(closed?.finishedAt, NOW - 31 * MINUTE)
    assert.deepEqual(closed?.termination, { kind: 'stale', reason: STALE_PLAN_REASON })
    assert.equal(typeof closed?.termination?.reason, 'string')
    assert.ok((closed?.termination?.reason ?? '').length > 0, '收口原因必须可读（非空）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reconcile：最后活动取消息/任务结束时刻的最大值（不是 createdAt，也不看 now）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r24-activity-'))
  try {
    const store = new RunsStore(dir)
    // 31 分钟前还有一条消息 → 残留：finishedAt 必须是这条消息的时刻。
    store.save(
      stateOf({
        plan: planOf({ runId: 'run-msg-stale', createdAt: NOW - 180 * MINUTE }),
        plannedAt: NOW - 180 * MINUTE,
        messages: [{ at: NOW - 31 * MINUTE, from: 'captain', to: 'user', body: '最后一条' }],
      }),
    )
    // 5 分钟前刚有消息 → 活跃，不许收口（把 lastActivityAtOf 写成只读 plannedAt 就会误伤）。
    store.save(
      stateOf({
        plan: planOf({ runId: 'run-msg-fresh', createdAt: NOW - 180 * MINUTE }),
        plannedAt: NOW - 180 * MINUTE,
        messages: [{ at: NOW - 5 * MINUTE, from: 'captain', to: 'user', body: '还在跑' }],
      }),
    )
    // 任务结束时刻晚于计划时刻：最后一次活动是 endedAt。
    store.save(
      stateOf({
        plan: planOf({ runId: 'run-times', createdAt: NOW - 180 * MINUTE }),
        plannedAt: NOW - 180 * MINUTE,
        taskTimes: { t1: { startedAt: NOW - 120 * MINUTE, endedAt: NOW - 40 * MINUTE } },
      }),
    )

    const reconciled = reconcileStalePlans(store, { now: NOW })
    assert.deepEqual(reconciled.sort(), ['run-msg-stale', 'run-times'])
    assert.equal(store.load('run-msg-stale')?.finishedAt, NOW - 31 * MINUTE)
    assert.equal(store.load('run-times')?.finishedAt, NOW - 40 * MINUTE)

    const fresh = store.load('run-msg-fresh')
    assert.equal(fresh?.plan.status, 'draft')
    assert.equal(fresh?.finishedAt, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// reconcileStalePlans：幂等与不误伤
// ---------------------------------------------------------------------------

test('reconcile：连跑两次只写一次；第二次零改写（save 次数 0 且文件字节不变）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r24-idem-'))
  try {
    const seedStore = new RunsStore(dir)
    seedStore.save(stateOf({ plan: planOf({ runId: 'run-idem' }), plannedAt: NOW - 31 * MINUTE }))

    const store = countingStore(dir)
    assert.deepEqual(reconcileStalePlans(store, { now: NOW }), ['run-idem'])
    assert.equal(store.saves(), 1, '第一次必须写一次')

    const afterFirst = snapshotDir(dir)
    const second = reconcileStalePlans(store, { now: NOW + 1_000 })
    assert.deepEqual(second, [], '第二次没有可收口的 run')
    assert.equal(store.saves(), 1, '第二次不许再写：幂等判据是「已有 termination/终态直接跳过」')
    assert.deepEqual(snapshotDir(dir), afterFirst, '第二次落盘字节必须与第一次完全一致')

    const closed = store.load('run-idem')
    assert.equal(closed?.plan.status, 'terminated')
    assert.equal(closed?.termination?.kind, 'stale')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reconcile：有存活成员的 run 不误伤；已有 termination / 终态 / 非候选态的 run 一律跳过', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r24-skip-'))
  try {
    const store = new RunsStore(dir)
    store.save(
      stateOf({
        plan: planOf({ runId: 'run-live' }),
        plannedAt: NOW - 120 * MINUTE,
        bindings: [bindingOf()],
      }),
    )
    store.save(
      stateOf({
        plan: planOf({ runId: 'run-has-termination' }),
        plannedAt: NOW - 120 * MINUTE,
        termination: { kind: 'terminated', reason: '历史原因' },
      }),
    )
    store.save(
      stateOf({
        plan: planOf({ runId: 'run-done', status: 'terminated' }),
        plannedAt: NOW - 120 * MINUTE,
      }),
    )
    store.save(
      stateOf({
        plan: planOf({ runId: 'run-cancelled', status: 'cancelled' }),
        plannedAt: NOW - 120 * MINUTE,
      }),
    )
    const before = snapshotDir(dir)

    const asked: string[] = []
    const wrapped = countingStore(dir)
    const reconciled = reconcileStalePlans(wrapped, {
      now: NOW,
      hasLiveMembers: (runId) => {
        asked.push(runId)
        return runId === 'run-live'
      },
    })

    assert.deepEqual(reconciled, [])
    assert.equal(wrapped.saves(), 0, '跳过路径不许写盘')
    assert.ok(asked.includes('run-live'), '有 binding 的 run 必须问一次存活判据')
    assert.deepEqual(snapshotDir(dir), before, '四个文件一个字节都不许变')

    assert.equal(wrapped.load('run-live')?.plan.status, 'draft')
    assert.equal(wrapped.load('run-has-termination')?.plan.status, 'draft')
    assert.equal(wrapped.load('run-has-termination')?.termination?.reason, '历史原因')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 装配时序：对账必须在任何 snapshot/list 读取之前完成
// ---------------------------------------------------------------------------

test('装配期对账：createBridge 前落盘的残留 run，第一次 snapshot 就已显示 terminated（不是读到旧状态）', () => {
  const lastActivity = NOW - 60 * MINUTE
  const h = createHarness({
    seed: (store) => {
      store.save(stateOf({ plannedAt: lastActivity, plan: planOf({ createdAt: lastActivity }) }))
    },
  })
  try {
    // createBridge 已在 createHarness 里跑完：装配后、任何 snapshot 之前盘上就必须是终态。
    const closed = h.store.load(RUN)
    assert.equal(closed?.plan.status, 'terminated', '装配期对账必须早于第一次读取')
    assert.equal(closed?.finishedAt, lastActivity)
    assert.equal(closed?.termination?.reason, STALE_PLAN_REASON)

    const snap = h.bridge.snapshot(SESSION)
    assert.equal(snap.runId, RUN)
    assert.equal(snap.planStatus, 'terminated', '第一次快照看到的必须是收口后的状态')
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// closeRun：手动终止
// ---------------------------------------------------------------------------

test('closeRun：残留 run（无存活成员）→ terminated + finishedAt=now + 可读原因', async () => {
  const h = createHarness()
  try {
    h.store.save(stateOf({ plan: planOf({ runId: RUN }), plannedAt: NOW - 120 * MINUTE }))
    const result = await h.bridge.act(SESSION, { type: 'closeRun', runId: RUN })
    assert.equal(result.rejected, undefined)
    assert.equal(result.unchanged, undefined, '真的收口了就不能报 unchanged')

    const stored = h.store.load(RUN)
    assert.equal(stored?.plan.status, 'terminated')
    assert.equal(stored?.finishedAt, NOW, '用户手动终止：结束时刻 = 动作时刻 now')
    assert.deepEqual(stored?.termination, { kind: 'stale', reason: '用户终止残留计划' })
    assert.equal(h.bridge.snapshot(SESSION).planStatus, 'terminated')
    assert.ok((result.notices ?? []).some((line) => line.includes('已终止残留计划')))
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

test('closeRun：打到已终态 run → unchanged 且零写入（不报错、不覆盖首次收口时刻）', async () => {
  const h = createHarness()
  try {
    for (const [runId, status] of [
      ['run-term', 'terminated'],
      ['run-cancel', 'cancelled'],
    ] as const) {
      h.store.save(
        stateOf({
          plan: planOf({ runId, status }),
          plannedAt: NOW - 120 * MINUTE,
          finishedAt: NOW - 500_000,
          termination: { kind: status === 'cancelled' ? 'cancelled' : 'stale', reason: '首次收口原因' },
        }),
      )
      const before = snapshotDir(join(h.dir, 'runs'))
      const result = await h.bridge.act(SESSION, { type: 'closeRun', runId })
      assert.equal(result.rejected, undefined, `${runId} 重复终止不应报错`)
      assert.equal(result.unchanged, true, `${runId} 必须返回 unchanged 幂等标记`)
      assert.deepEqual(snapshotDir(join(h.dir, 'runs')), before, `${runId} 终态幂等动作零写入`)

      const stored = h.store.load(runId)
      assert.equal(stored?.finishedAt, NOW - 500_000, '不得覆盖首次收口时刻')
      assert.equal(stored?.termination?.reason, '首次收口原因')
    }
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

test('closeRun：有存活成员 → BAD_REQUEST 且零写入（成员名进文案）', async () => {
  const h = createHarness({
    listMembers: async () => [{ id: 'member-1', name: '开发-1', status: 'running' }],
  })
  try {
    h.store.save(
      stateOf({
        plan: planOf({ runId: RUN, tasks: [taskOf('t1', 'running')] }),
        plannedAt: NOW - 5 * MINUTE,
        bindings: [bindingOf()],
      }),
    )
    const before = snapshotDir(join(h.dir, 'runs'))
    const result = await h.bridge.act(SESSION, { type: 'closeRun', runId: RUN })

    assert.equal(result.rejected?.code, 'BAD_REQUEST')
    assert.match(result.rejected?.message ?? '', /仍有存活成员/)
    assert.match(result.rejected?.message ?? '', /开发-1/, '必须告诉用户是哪个成员还在跑')
    assert.deepEqual(snapshotDir(join(h.dir, 'runs')), before, '拒绝路径零写入')

    const stored = h.store.load(RUN)
    assert.equal(stored?.plan.status, 'draft')
    assert.equal(stored?.finishedAt, undefined)
    assert.equal(stored?.termination, undefined)
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

test('closeRun：成员名单读不到 ≠ 没有成员（保守拒绝，不误杀）', async () => {
  const h = createHarness({
    listMembers: async () => {
      throw new Error('宿主名单超时')
    },
  })
  try {
    h.store.save(
      stateOf({
        plan: planOf({ runId: RUN, tasks: [taskOf('t1', 'running')] }),
        plannedAt: NOW - 5 * MINUTE,
        bindings: [bindingOf()],
      }),
    )
    const before = snapshotDir(join(h.dir, 'runs'))
    const result = await h.bridge.act(SESSION, { type: 'closeRun', runId: RUN })

    assert.equal(result.rejected?.code, 'BAD_REQUEST')
    assert.match(result.rejected?.message ?? '', /无法终止运行/)
    assert.match(result.rejected?.message ?? '', /宿主名单超时/, '原因必须透出，不能吞成「偶发失败」')
    assert.deepEqual(snapshotDir(join(h.dir, 'runs')), before, '拒绝路径零写入')
    assert.equal(h.store.load(RUN)?.plan.status, 'draft')
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// taskDurationsOf：任务用时语义
// ---------------------------------------------------------------------------

test('taskDurationsOf：done 缺起止 → unavailable+原因；pending → not-started；完整记录逐字不变', () => {
  const h = createHarness()
  try {
    const startedAt = NOW - 65_000
    const endedAt = NOW - 5_000
    h.store.save(
      stateOf({
        plan: planOf({
          runId: RUN,
          tasks: [
            taskOf('t1', 'done'),
            taskOf('t2', 'pending'),
            taskOf('t3', 'done'),
            taskOf('t4', 'skipped'),
          ],
        }),
        plannedAt: NOW,
        taskTimes: { t3: { startedAt, endedAt } },
      }),
    )

    const durations = h.bridge.snapshot(SESSION).taskDurations ?? {}

    // 旧实现：done 无起止被判成 not-started（「未开始」）—— 在已完成的历史 run 里是假话。
    assert.deepEqual(durations.t1, {
      state: 'unavailable',
      text: UNAVAILABLE_TEXT,
      reason: LEGACY_TASK_TIME_REASON,
    })
    // pending 确实还没开始：not-started，且不带 reason（两态不能混）。
    assert.deepEqual(durations.t2, { state: 'not-started', text: '未开始' })
    assert.equal('reason' in (durations.t2 ?? {}), false, 'not-started 不许带不可得原因')

    // 完整记录沿用旧算法，文本逐字不变（显式字面量，不用被测函数自证）。
    assert.deepEqual(durations.t3, durationCellOf({ startAt: startedAt, endAt: endedAt, state: 'done', now: NOW }))
    assert.equal(durations.t3?.state, 'done')
    assert.equal(durations.t3?.text, '1 分 00 秒')
    assert.equal(durations.t3?.ms, 60_000)
    assert.equal(durations.t3?.startAt, startedAt)
    assert.equal(durations.t3?.endAt, endedAt)

    // skipped 与 done 同族：同样的缺失语义（t1 已 done，t4 覆盖 skipped）。
    assert.deepEqual(durations.t4, {
      state: 'unavailable',
      text: UNAVAILABLE_TEXT,
      reason: LEGACY_TASK_TIME_REASON,
    })
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 真实残留数据（仓库外 /tmp 副本；绝不改 ~/.dsh/auto-team/runs 里的真实文件）
// ---------------------------------------------------------------------------

const REAL_RUNS_DIR = join(homedir(), '.dsh', 'auto-team', 'runs')
const REAL_RUN_FILES = ['run-mwa9n8xf-1c61.json', 'run-mwa9uuow-1c61.json']
/** 真实文件的最后活动时刻（2026-11-10 现场值）：用字面量锁住「finishedAt 不是 now」。 */
const REAL_EXPECTED_LAST_ACTIVITY: Record<string, number> = {
  'run-mwa9n8xf-1c61': 1794289508191,
  'run-mwa9uuow-1c61': 1794291394249,
}

test('真机残留 run 的 /tmp 副本：收口为 terminated、finishedAt=最后活动时刻、原因可读且二次运行零改写', (t) => {
  const missing = REAL_RUN_FILES.filter((file) => !existsSync(join(REAL_RUNS_DIR, file)))
  if (missing.length > 0) {
    // 非本开发机：不伪造成绿，也不让其他环境红。真机证据见 QA-REPORT 的「真实数据验证」一节。
    t.skip(`本机没有真实残留 run（缺 ${missing.join('、')}），真实数据验证见 QA-REPORT`)
    return
  }

  const isolatedRoot = existsSync('/tmp') ? '/tmp' : tmpdir()
  const isoDir = mkdtempSync(join(isolatedRoot, 'auto-team-r24-real-'))
  try {
    mkdirSync(isoDir, { recursive: true })
    // 只读校验：先取源文件字节，再复制；测试结束时必须逐字节一致（证明没有直接改真实文件）。
    const sourceBefore = REAL_RUN_FILES.map((file) => readFileSync(join(REAL_RUNS_DIR, file)))
    for (const file of REAL_RUN_FILES) copyFileSync(join(REAL_RUNS_DIR, file), join(isoDir, file))

    const store = new RunsStore(isoDir)
    const before = new Map<string, RunState>()
    for (const file of REAL_RUN_FILES) {
      const runId = file.slice(0, -'.json'.length)
      const raw = store.load(runId)
      assert.ok(raw, `${file} 必须能按真实落盘格式读出`)
      // 部署时序自愈：本机制上线后，真实宿主启动时会把源文件本身收口（这正是本次修复的
      // 目的）。此时副本已是收口后的形状 —— 先核对它确实等于期望结果，再把副本还原成
      // 「收口前」形状，继续验证收口逻辑本身；否则这条回归会在真机部署后变成时效炸弹。
      if (raw.plan.status !== 'draft' || raw.finishedAt !== undefined || raw.termination !== undefined) {
        assert.equal(raw.plan.status, 'terminated', `${file} 若已被真实宿主收口，状态必须是 terminated`)
        assert.equal(raw.finishedAt, REAL_EXPECTED_LAST_ACTIVITY[runId], `${file} 已收口时 finishedAt 必须是最后活动时刻`)
        assert.equal(raw.termination?.kind, 'stale')
        store.save({ ...raw, plan: { ...raw.plan, status: 'draft' }, finishedAt: undefined, termination: undefined })
      }
      const state = store.load(runId)
      assert.ok(state, `${file} 还原成收口前形状后必须仍能读出`)
      // 三条前置事实：未收口、无终止记录、确实已超过阈值（否则这条用例没有验证意义）。
      assert.equal(state.plan.status, 'draft')
      assert.equal(state.finishedAt, undefined)
      assert.equal(state.termination, undefined)
      assert.equal(lastActivityAtOf(state), REAL_EXPECTED_LAST_ACTIVITY[runId])
      assert.ok(
        lastActivityAtOf(state) < Date.now() - STALE_PLAN_MS,
        `${runId} 的最后活动已超过 30 分钟，现场数据应当被收口`,
      )
      before.set(runId, state)
    }

    const reconciled = reconcileStalePlans(store, { now: Date.now() })
    assert.deepEqual(reconciled.sort(), [...before.keys()].sort())

    for (const [runId, source] of before) {
      const closed = store.load(runId)
      assert.equal(closed?.plan.status, 'terminated', `${runId} 必须收口为 terminated`)
      assert.equal(closed?.finishedAt, REAL_EXPECTED_LAST_ACTIVITY[runId], `${runId} finishedAt 必须是最后活动时刻`)
      assert.equal(closed?.finishedAt, lastActivityAtOf(source), '与源数据的最后活动时刻逐毫秒相等')
      assert.equal(closed?.termination?.kind, 'stale')
      assert.equal(closed?.termination?.reason, STALE_PLAN_REASON)
      assert.equal(typeof closed?.termination?.reason, 'string')
      assert.ok((closed?.termination?.reason ?? '').length > 0, 'termination.reason 必须可读')
      // r25 新语义：收口**同一次落盘**把残留任务一并终结（否则终态 run 里还留着
      // running/pending 的假活任务，面板 ongoing/active 会自相矛盾）。已终态任务必须原样
      // 保留；非终态任务则逐条断言四个字段，消息账本仍原样保留。
      const TERMINAL_TASK_STATUSES = new Set(['done', 'failed', 'cancelled', 'skipped', 'interrupted'])
      const closedTasks = closed?.plan.tasks ?? []
      assert.equal(closedTasks.length, source.plan.tasks.length, `${runId} 任务数量不得增减`)
      const expectedCancelReason = `计划已收口：${closed?.termination?.reason ?? ''}`
      source.plan.tasks.forEach((task, index) => {
        const after = closedTasks[index]
        assert.equal(after?.id, task.id)
        if (TERMINAL_TASK_STATUSES.has(task.status)) {
          assert.deepEqual(after, task, `${runId}/${task.id} 已终态任务必须逐字保留`)
          return
        }
        assert.equal(after?.status, 'cancelled', `${runId}/${task.id} 残留任务必须终结为 cancelled`)
        assert.equal(after?.cancelledAt, closed?.finishedAt, `${runId}/${task.id} cancelledAt 必须等于 run 的 finishedAt`)
        assert.equal(after?.cancelReason, expectedCancelReason, `${runId}/${task.id} 收口原因必须可读且带前缀`)
        assert.equal(after?.cancelledBy, 'stale', `${runId}/${task.id} 来源必须是 stale`)
        // 除这四个字段外的任务事实（标题/依赖/验收/写域…）不得被收口改写。
        const { status: _s, cancelledAt: _a, cancelReason: _r, cancelledBy: _b, ...restAfter } = after ?? {}
        const { status: _taskStatus, ...taskRest } = task
        assert.deepEqual(restAfter, taskRest, `${runId}/${task.id} 除终结字段外的内容必须原样`)
      })
      assert.deepEqual(closed?.messages, source.messages)
    }

    // 幂等：第二次启动不再改写（字节级比较）。
    const bytesAfterFirst = snapshotDir(isoDir)
    assert.deepEqual(reconcileStalePlans(store, { now: Date.now() + 1 }), [])
    assert.deepEqual(snapshotDir(isoDir), bytesAfterFirst)

    // 源文件没有被本用例改动（copyFileSync 是只读源；这里再对一次字节）。
    REAL_RUN_FILES.forEach((file, index) => {
      assert.deepEqual(readFileSync(join(REAL_RUNS_DIR, file)), sourceBefore[index], `${file} 源文件必须原样`)
    })
  } finally {
    rmSync(isoDir, { recursive: true, force: true })
  }
})
