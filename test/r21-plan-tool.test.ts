/**
 * r21 工具层：`auto_team_plan` 的「新建 / 并入」闸门。
 *
 * 这条闸门是 r21 口径修正的机械保证（也是 AC-30 的延伸）：
 *  - **不传 `revise` 永远新建**——不相关的新需求绝不能被静默塞进上一个 run；
 *  - 新建时必须回 `activeRunId` 提示，让队长知道「另有一个在跑的 run，若这是改它就传 revise」；
 *  - 显式 `revise` 才并入：缺省并入最近非终态 run，显式 runId 必须属于本会话且非终态；
 *  - **拒绝路径零写入**（判据是 runs 目录逐字快照，不是 `ok:false`）。
 *
 * 三类 mode 的判定在纯逻辑 `revisePlan` 里（见 r21-revise-plan.test.ts），这里验的是
 * 「工具层选了哪条路、回给队长什么、盘上有没有多出 run」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createHarness, META, NOW, planOf, RUN, runStateOf, seed, SESSION, taskOf } from './r21-harness.ts'

function advance(clock: { at: number }, by = 60_000): number {
  clock.at += by
  return clock.at
}

/** 每个用例独立的临时目录（harness 内部 mkdtemp），互不污染。 */
function makeClockHarness(): { h: ReturnType<typeof createHarness>; clock: { at: number } } {
  const clock = { at: NOW }
  const h = createHarness({ now: () => clock.at })
  return { h, clock }
}

const tasksOf = (run: Record<string, unknown>): Array<Record<string, unknown>> =>
  (run.tasks ?? []) as Array<Record<string, unknown>>

test('revise 闸门：首次 plan → mode=created、无 activeRunId、落盘 1 个 run', async () => {
  const { h, clock } = makeClockHarness()
  const result = await h.call('auto_team_plan', {
    goal: '第一个需求',
    tasks: [{ title: '任务 A', roleId: 'dev', acceptance: 'pnpm typecheck' }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'created')
  assert.equal('activeRunId' in result, false)
  assert.equal(Object.keys(h.snapshotRuns()).length, 1)
  assert.equal(h.dispatched.length, 1)
  assert.equal(h.dispatched[0].cause, 'plan-saved')
  assert.equal(h.dispatched[0].runId, result.runId)
  void clock
})

test('revise 闸门：不传 revise 的第二个 plan 永远新建 —— run 数 2、回 activeRunId 提示、旧 run 字节不变', async () => {
  const { h, clock } = makeClockHarness()
  const first = await h.call('auto_team_plan', {
    goal: '第一个需求',
    tasks: [{ title: '任务 A', roleId: 'dev', acceptance: 'pnpm typecheck' }],
  })
  const firstId = String(first.runId)
  const firstBytes = h.snapshotRuns()[`${firstId}.json`]

  advance(clock)
  const second = await h.call('auto_team_plan', {
    goal: '另一个不相关需求',
    tasks: [{ title: '任务 B', roleId: 'qa', acceptance: 'pnpm test' }],
  })
  assert.equal(second.ok, true)
  assert.equal(second.mode, 'created')
  assert.notEqual(second.runId, firstId)
  assert.equal(second.activeRunId, firstId)
  assert.match(String(second.note), /还有在跑的 run/)
  assert.match(String(second.note), /revise=true/)
  assert.equal(Object.keys(h.snapshotRuns()).length, 2)
  // 关键判据：第一个 run 一个字节都没变（没有被「顺手并入」）。
  assert.equal(h.snapshotRuns()[`${firstId}.json`], firstBytes)
})

test('revise 闸门：revise=true 缺省并入最近非终态 run（不新建，runId 不变）', async () => {
  const { h, clock } = makeClockHarness()
  const first = await h.call('auto_team_plan', {
    goal: '第一个需求',
    tasks: [{ title: '任务 A', roleId: 'dev', acceptance: 'pnpm typecheck' }],
  })
  advance(clock)
  const second = await h.call('auto_team_plan', {
    goal: '第二个需求',
    tasks: [{ title: '任务 B', roleId: 'qa', acceptance: 'pnpm test' }],
  })
  advance(clock)
  const revised = await h.call('auto_team_plan', {
    revise: true,
    goal: '第二个需求改一下',
    changeSummary: '验收命令换成 build',
    tasks: [{ id: 't1', title: '任务 B（改）', roleId: 'qa', acceptance: 'pnpm build' }],
  })
  assert.equal(revised.ok, true)
  assert.equal(revised.mode, 'revised')
  assert.equal(revised.runId, second.runId)
  assert.notEqual(revised.runId, first.runId)
  // 盘上 run 数量不变：并入 ≠ 新建。
  assert.equal(Object.keys(h.snapshotRuns()).length, 2)
  assert.match(String(revised.goal), /## 需求修订（/)
  assert.match(String(revised.goal), /第二个需求\n\n## 需求修订（/)
  // 返回里带齐副作用清单（客户端/队长据此知道谁被停、谁被通知）。
  for (const key of ['added', 'updated', 'cancelled', 'skipped', 'stopped', 'stopFailed', 'notified', 'notifyFailed']) {
    assert.ok(key in revised, `revise 返回必须含 ${key}`)
  }
  const updated = revised.updated as Array<Record<string, unknown>>
  assert.deepEqual(updated.map((task) => task.id), ['t1'])
  assert.equal(updated[0].title, '任务 B（改）')
  assert.equal(updated[0].acceptance, 'pnpm build')
  assert.equal(revised.maxConcurrent, second.maxConcurrent)
  // 自动派发仍针对同一个 run。
  assert.equal(h.dispatched.at(-1)?.runId, second.runId)
  void tasksOf(second)
})

test('revise 闸门：显式 runId 可并入较旧的在跑 run（不强制最新）', async () => {
  const { h, clock } = makeClockHarness()
  const first = await h.call('auto_team_plan', {
    goal: '旧需求',
    tasks: [{ title: '任务 A', roleId: 'dev', acceptance: 'pnpm typecheck' }],
  })
  advance(clock)
  await h.call('auto_team_plan', {
    goal: '新需求',
    tasks: [{ title: '任务 B', roleId: 'qa', acceptance: 'pnpm test' }],
  })
  advance(clock)
  const revised = await h.call('auto_team_plan', {
    revise: true,
    runId: String(first.runId),
    goal: '旧需求再补一点',
    tasks: [{ title: '补到旧 run 的任务', roleId: 'dev', acceptance: 'pnpm build' }],
  })
  assert.equal(revised.ok, true)
  assert.equal(revised.runId, first.runId)
  const stored = h.store.load(String(first.runId))
  assert.match(stored?.plan.goal ?? '', /旧需求\n\n## 需求修订（/)
  assert.equal(stored?.plan.tasks.length, 2)
  // 另一个 run 没被动过。
  assert.equal(Object.keys(h.snapshotRuns()).length, 2)
})

test('revise 闸门：显式 revise 指向终态 run → ok:false + BAD_REQUEST，runs 目录逐字不变', async () => {
  const h = createHarness()
  seed(h.store, runStateOf({ plan: planOf({ status: 'terminated' }) }))
  const before = h.snapshotRuns()

  const result = await h.call('auto_team_plan', { revise: true, runId: RUN, goal: '还想改' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'BAD_REQUEST')
  assert.match(String(result.error), /已终止，不能再并入需求修订/)
  assert.deepEqual(h.snapshotRuns(), before)
  assert.equal(h.dispatched.length, 0)
})

test('revise 闸门：显式 revise 指向别的会话的 run → NOT_FOUND，零写入', async () => {
  const h = createHarness()
  seed(h.store, runStateOf({ plan: planOf({ sessionId: 'other-session' }) }))
  const before = h.snapshotRuns()
  const result = await h.call('auto_team_plan', { revise: true, runId: RUN, goal: '改' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'NOT_FOUND')
  assert.match(String(result.error), /不属于当前会话/)
  assert.deepEqual(h.snapshotRuns(), before)
})

test('revise 闸门：显式 revise 指向不存在的 run → NOT_FOUND，零写入', async () => {
  const h = createHarness()
  const before = h.snapshotRuns()
  const result = await h.call('auto_team_plan', { revise: true, runId: 'run-nope', goal: '改' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'NOT_FOUND')
  assert.match(String(result.error), /找不到要修订的 run：run-nope/)
  assert.deepEqual(h.snapshotRuns(), before)
})

test('revise 闸门：revise=true 但会话从未跑过 → 退化成新建（不报错）', async () => {
  const h = createHarness()
  const result = await h.call('auto_team_plan', {
    revise: true,
    goal: '第一次就带 revise',
    tasks: [{ title: '任务 A', roleId: 'dev', acceptance: 'pnpm typecheck' }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'created')
  assert.equal(Object.keys(h.snapshotRuns()).length, 1)
})

test('revise 闸门：只追加任务 → mode=appended，goal 不新增修订段', async () => {
  const h = createHarness()
  seed(h.store, runStateOf())
  const result = await h.call('auto_team_plan', {
    revise: true,
    runId: RUN,
    tasks: [{ title: '只追加的新任务', roleId: 'dev', acceptance: 'pnpm typecheck' }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'appended')
  const stored = h.store.load(RUN)
  assert.equal(stored?.plan.goal, '原始目标')
  assert.equal(stored?.plan.tasks.length, 3)
  assert.deepEqual(result.added && (result.added as Array<Record<string, unknown>>).map((task) => task.id), ['t3'])
  assert.equal((result.revisions as unknown[]).length, 1)
})

test('revise 闸门：空验收追加任务整批拒绝（save 之前），旧 run 字节不变', async () => {
  const h = createHarness()
  seed(h.store, runStateOf())
  const before = h.snapshotRuns()
  const result = await h.call('auto_team_plan', {
    revise: true,
    runId: RUN,
    tasks: [{ title: '没有验收的新任务', roleId: 'dev', acceptance: '   ' }],
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'BAD_REQUEST')
  assert.deepEqual(h.snapshotRuns(), before)
})

test('revise 闸门：同会话多个终态 run 时，缺省 revise 只挑非终态 run', async () => {
  const { h, clock } = makeClockHarness()
  // 手工落一个更早的终态 run；它的 createdAt 最小，绝不会被选中。
  seed(h.store, runStateOf({ plan: planOf({ runId: 'run-terminated', createdAt: NOW - 600_000, status: 'terminated' }) }))
  advance(clock)
  const live = await h.call('auto_team_plan', {
    goal: '在跑的需求',
    tasks: [{ title: '任务 A', roleId: 'dev', acceptance: 'pnpm typecheck' }],
  })
  advance(clock)
  const revised = await h.call('auto_team_plan', { revise: true, goal: '改在跑的' })
  assert.equal(revised.ok, true)
  assert.equal(revised.runId, live.runId)
  // 终态 run 保持原样。
  const terminated = h.store.load('run-terminated')
  assert.equal(terminated?.plan.status, 'terminated')
  assert.equal(terminated?.plan.goal, '原始目标')
})

test('revise 闸门：新建 run 的工具入口不因「有在跑 run」而并入（任务集不混）', async () => {
  const h = createHarness()
  seed(h.store, runStateOf())
  const created = await h.call('auto_team_plan', {
    goal: '不相关的新需求',
    tasks: [{ title: '任务 X', roleId: 'qa', acceptance: 'pnpm test' }],
  })
  assert.equal(created.ok, true)
  assert.equal(created.mode, 'created')
  const old = h.store.load(RUN)
  assert.equal(old?.plan.tasks.length, 2)
  assert.equal(old?.plan.goal, '原始目标')
  const fresh = h.store.load(String(created.runId))
  assert.equal(fresh?.plan.tasks.length, 1)
  assert.equal(fresh?.plan.tasks[0].title, '任务 X')
  assert.equal(fresh?.plan.sessionId, SESSION)
})

test('revise 闸门：工具面仍只有 8 个工具（不因 r21 新增入口）', async () => {
  const h = createHarness()
  assert.equal(h.specs.length, 8)
  assert.deepEqual(
    h.specs.map((spec) => spec.name).sort(),
    [
      'auto_team_dispatch',
      'auto_team_memory',
      'auto_team_message',
      'auto_team_plan',
      'auto_team_receipt',
      'auto_team_role',
      'auto_team_status',
      'auto_team_add_tasks',
    ].sort(),
  )
  void META
  void taskOf
})
