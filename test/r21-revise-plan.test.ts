/**
 * r21 纯逻辑：`revisePlan` —— 同一条需求的修改并入既有 run（不新建 run）。
 *
 * 存在理由：r21 的核心承诺是「改需求 = 并入原 run，而不是又开一个 run」。
 * 这里把 `plan/plan.ts` 的三件事实钉死，避免以后有人「顺手」改成新建：
 *  1. 目标**只追加不覆盖**（`## 需求修订（时刻）` 段落，原文保留）；
 *  2. 更新/追加/作废三件事的落盘字段（`revisedAt`/`revisionNote`、`cancelledAt`/`cancelReason`/`cancelledBy`）；
 *  3. 原子性 —— 任一条不合法则整批不落盘、输入 plan 不被就地修改。
 *
 * 纯函数、无 IO：不依赖 DOM / 宿主，断言的是**返回值**而不是「跑起来没报错」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { revisePlan } from '../src/host/plan/plan.ts'
import type { Plan, PlanTask, TaskStatus } from '../src/shared/types.ts'

/** 固定时刻：2023-11-14 22:13 UTC（本地时区由 `revisionStamp` 用 getFullYear 等取值）。 */
const NOW = 1_700_000_000_000

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
    runId: 'run-r21',
    sessionId: 'session-1',
    createdAt: NOW - 60_000,
    status: 'draft',
    goal: '原始目标',
    tasks: [taskOf('t1', 'running'), taskOf('t2', 'pending', { dependsOn: ['t1'] })],
    maxConcurrent: 3,
    revisions: [],
    ...over,
  }
}

/** `## 需求修订（YYYY-MM-DD HH:mm）` 的格式断言（不锁死本机时区，只验格式与正文保留）。 */
const REVISION_HEADING = /\n\n## 需求修订（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）\n/

/* ────────────────────────── 目标留痕 ────────────────────────── */

test('revisePlan：goal 追加「## 需求修订（时刻）」段落，原目标保留且不被覆盖', () => {
  const plan = planOf()
  const result = revisePlan(plan, { goal: '把导出改成 CSV\n第二行细节' }, NOW)
  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.mode, 'revised')
  assert.match(result.plan.goal ?? '', REVISION_HEADING)
  // 原目标在最前面、逐字保留。
  assert.ok((result.plan.goal ?? '').startsWith('原始目标\n\n## 需求修订（'))
  assert.ok((result.plan.goal ?? '').endsWith('把导出改成 CSV\n第二行细节'))
  // 修订前的 plan 不被就地修改（纯函数，落盘前失败也不会污染内存态）。
  assert.equal(plan.goal, '原始目标')
  assert.equal(plan.tasks[0].status, 'running')

  // 结构化留痕：全文保留、changeSummary 空则不写、任务 id 清单为空数组。
  assert.equal(result.revision.at, NOW)
  assert.equal(result.revision.text, '把导出改成 CSV\n第二行细节')
  assert.equal('changeSummary' in result.revision, false)
  assert.deepEqual(result.revision.updatedTaskIds, [])
  assert.deepEqual(result.revision.addedTaskIds, [])
  assert.deepEqual(result.revision.cancelledTaskIds, [])
  assert.equal(result.plan.revisions?.length, 1)
})

test('revisePlan：没有原目标时只写修订段，不留空行或空字符串', () => {
  const result = revisePlan(planOf({ goal: undefined }), { goal: '新需求' }, NOW)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.match(result.plan.goal ?? '', /^## 需求修订（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）\n新需求$/)
})

test('revisePlan：goal 为空串 + 只追加任务 → mode=appended，goal 原样不动', () => {
  const result = revisePlan(planOf(), {
    goal: '   ',
    tasks: [{ title: '补一个用例', roleId: 'qa', acceptance: 'pnpm test' }],
  }, NOW)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.mode, 'appended')
  assert.equal(result.plan.goal, '原始目标')
  assert.equal(result.revision.text, '')
})

/* ────────────────────────── 追加 ────────────────────────── */

test('revisePlan：追加任务 id 续排、初始 pending、写入 additions 清单', () => {
  const plan = planOf()
  const result = revisePlan(plan, {
    tasks: [
      { title: '新任务 A', roleId: 'qa', acceptance: 'pnpm typecheck', writeScopes: ['src/host'] },
      { title: '新任务 B', roleId: 'dev', acceptance: 'pnpm test' },
    ],
  }, NOW)
  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.deepEqual(result.added.map((task) => task.id), ['t3', 't4'])
  assert.deepEqual(result.revision.addedTaskIds, ['t3', 't4'])
  const t3 = result.plan.tasks.find((task) => task.id === 't3')
  assert.equal(t3?.status, 'pending')
  assert.deepEqual(t3?.writeScopes, ['src/host'])
  // 空写域不写字段：不落一个「看起来被约束、其实空」的数组。
  const t4 = result.plan.tasks.find((task) => task.id === 't4')
  assert.equal('writeScopes' in (t4 ?? {}), false)
  assert.equal(result.plan.tasks.length, 4)
})

test('revisePlan：内容与既有任务指纹相同 → skipped，不重复追加；同批其它新任务照常追加', () => {
  const result = revisePlan(planOf(), {
    tasks: [
      { title: '任务 t1', roleId: 'dev', acceptance: 'exit t1' },
      { title: '真正的新任务', roleId: 'qa', acceptance: 'pnpm typecheck' },
    ],
  }, NOW)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.added.map((task) => task.id), ['t3'])
  assert.deepEqual(result.skipped, ['任务 t1'])
  assert.equal(result.plan.tasks.length, 3)
})

test('revisePlan：只有指纹重复、没有任何真实变化 → 拒绝（不回报一个空修订）', () => {
  const result = revisePlan(planOf(), {
    tasks: [{ title: '任务 t1', roleId: 'dev', acceptance: 'exit t1' }],
  }, NOW)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /需求修订没有任何变化/)
})

test('revisePlan：显式 id 命中既有任务 → 走更新而非新建（任务总数不变）', () => {
  const plan = planOf()
  const before = JSON.stringify(plan)
  const result = revisePlan(plan, {
    tasks: [{ id: 't1', title: '冒名顶替', roleId: 'dev', acceptance: 'exit 0' }],
  }, NOW)
  // id 命中既有任务时走「更新」分支而不是追加；这里用 title 覆盖来证明它不是新建。
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.updated.map((task) => task.id), ['t1'])
  assert.equal(result.plan.tasks.length, 2)
  // 输入对象不被就地修改。
  assert.equal(JSON.stringify(plan), before)
})

/* ────────────────────────── 更新 ────────────────────────── */

test('revisePlan：更新既有任务写 revisedAt/revisionNote，并保留状态与成员绑定', () => {
  const plan = planOf()
  plan.tasks[0].memberId = 'member-1'
  const result = revisePlan(plan, {
    changeSummary: '导出格式从 JSON 改成 CSV',
    tasks: [{ id: 't1', title: '导出 CSV', roleId: 'dev', acceptance: 'pnpm test -- csv' }],
  }, NOW)
  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.mode, 'revised')
  const t1 = result.plan.tasks.find((task) => task.id === 't1')
  assert.equal(t1?.title, '导出 CSV')
  assert.equal(t1?.acceptance, 'pnpm test -- csv')
  assert.equal(t1?.status, 'running')
  assert.equal(t1?.memberId, 'member-1')
  assert.equal(t1?.revisedAt, NOW)
  assert.equal(t1?.revisionNote, '导出格式从 JSON 改成 CSV')
  // dependsOn / writeScopes 未传 = 保持原值（不会被「覆盖成空」）。
  assert.deepEqual(t1?.dependsOn, [])
})

test('revisePlan：changeSummary 为空时 revisionNote 用新需求首行兜底', () => {
  const result = revisePlan(planOf(), {
    goal: '把导出改成 CSV\n\n细节',
    tasks: [{ id: 't1', title: '导出 CSV', roleId: 'dev', acceptance: 'exit 0' }],
  }, NOW)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.updated[0].revisionNote, '把导出改成 CSV')
  assert.equal(result.revision.changeSummary, undefined)
})

test('revisePlan：更新后验收为空 → 拒绝（完成必须过门禁）', () => {
  const plan = planOf()
  const result = revisePlan(plan, {
    tasks: [{ id: 't1', title: '任务 t1', roleId: 'dev', acceptance: '  ' }],
  }, NOW)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /验收命令为空/)
})

test('revisePlan：显式 id 未占用 → 按该 id 追加（不再自动分配 tN）', () => {
  const result = revisePlan(planOf(), {
    tasks: [{ id: 't9', title: '任务 t9', roleId: 'dev', acceptance: 'exit 0' }],
  }, NOW)
  // t9 不存在 → 走追加分支，id 未占用 → 允许追加（id 由队长显式指定）。
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.added.map((task) => task.id), ['t9'])
})

test('revisePlan：全部字段未变化 → skipped，不写 revisedAt', () => {
  const result = revisePlan(planOf(), {
    tasks: [{ id: 't1', title: '任务 t1', roleId: 'dev', acceptance: 'exit t1', dependsOn: [] }],
  }, NOW)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /需求修订没有任何变化/)
  assert.equal(result.reason.includes('没有任何变化'), true)
})

/* ────────────────────────── 作废 ────────────────────────── */

test('revisePlan：作废任务写 cancelled 三字段（默认原因取 changeSummary 首行）', () => {
  const result = revisePlan(planOf(), {
    changeSummary: '改用增量导出\n旧的全量导出不需要了',
    cancelledTaskIds: ['t2'],
  }, NOW)
  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.mode, 'revised')
  const t2 = result.plan.tasks.find((task) => task.id === 't2')
  assert.equal(t2?.status, 'cancelled')
  assert.equal(t2?.cancelledAt, NOW)
  assert.equal(t2?.cancelledBy, 'revision')
  assert.equal(t2?.cancelReason, '需求修订作废：改用增量导出')
  assert.deepEqual(result.cancelled.map((task) => task.id), ['t2'])
  assert.deepEqual(result.revision.cancelledTaskIds, ['t2'])
})

test('revisePlan：cancelReason 显式传入时优先于默认生成', () => {
  const result = revisePlan(planOf(), {
    cancelledTaskIds: ['t2'],
    cancelReason: '用户改主意了',
  }, NOW)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.plan.tasks[1].cancelReason, '用户改主意了')
})

test('revisePlan：作废不存在的任务 → 拒绝', () => {
  const result = revisePlan(planOf(), { cancelledTaskIds: ['t99'] }, NOW)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /要作废的任务不存在：t99/)
})

test('revisePlan：同一次修订里既更新又作废同一任务 → 拒绝（不静默二选一）', () => {
  const result = revisePlan(planOf(), {
    cancelledTaskIds: ['t1'],
    tasks: [{ id: 't1', title: '任务 t1', roleId: 'dev', acceptance: 'exit 1' }],
  }, NOW)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /既更新又作废/)
})

test('revisePlan：已完成任务不能再作废（终态唯一出口是保留）', () => {
  const plan = planOf({ tasks: [taskOf('t1', 'done')] })
  const result = revisePlan(plan, { cancelledTaskIds: ['t1'] }, NOW)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /已完成，不能再作废/)
})

/*
 * 缺陷 D1 回归（t3 报告、t4 修复）：`REVISION_FROZEN_STATUSES` 曾经声明后全文件无引用，
 * 注释承诺的「终态任务不允许被更新」并没有接线。现在改 done/skipped/cancelled 一律拒绝；
 * 但「未改动」在冻结判定之前已 skip —— 整份计划原样重交不应被误伤。
 */
test('revisePlan：终态任务（done/skipped/cancelled）不允许被更新（D1 回归）', () => {
  for (const status of ['done', 'skipped', 'cancelled'] as const) {
    const plan = planOf({ tasks: [taskOf('t1', status)] })
    const result = revisePlan(plan, {
      tasks: [{ id: 't1', title: '改过的终态任务', roleId: 'dev', acceptance: 'exit 新' }],
    }, NOW)
    assert.equal(result.ok, false, status)
    if (result.ok) return
    assert.match(result.reason, /不能再修订/)
  }
  const unchanged = revisePlan(planOf({ tasks: [taskOf('t1', 'done')] }), {
    goal: '补一条新需求',
    tasks: [{ id: 't1', title: '任务 t1', roleId: 'dev', acceptance: 'exit t1' }],
  }, NOW)
  assert.equal(unchanged.ok, true)
  if (!unchanged.ok) return
  assert.deepEqual(unchanged.skipped, ['t1'])
  assert.deepEqual(unchanged.updated, [])
  assert.equal(unchanged.plan.tasks[0]?.revisedAt, undefined, '未改动的终态任务不得被打上修订痕迹')
})

/* ────────────────────────── 原子性 / 图校验 / 并发 / 终态计划 ────────────────────────── */

test('revisePlan：图校验失败（成环）→ 整批拒绝，输入 plan 与任务状态零改动', () => {
  const plan = planOf({ tasks: [taskOf('t1', 'pending'), taskOf('t2', 'pending', { dependsOn: ['t1'] })] })
  const before = JSON.stringify(plan)
  const result = revisePlan(plan, {
    goal: '会失败的修订',
    tasks: [{ id: 't1', title: '任务 t1', roleId: 'dev', acceptance: 'exit 1', dependsOn: ['t2'] }],
  }, NOW)
  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(plan), before)
})

test('revisePlan：maxConcurrent 被夹在 1..8 且缺省时保持原值', () => {
  const low = revisePlan(planOf(), { goal: 'a', maxConcurrent: 0 }, NOW)
  assert.equal(low.ok, true)
  if (low.ok) assert.equal(low.plan.maxConcurrent, 1)

  const high = revisePlan(planOf(), { goal: 'a', maxConcurrent: 99 }, NOW)
  assert.equal(high.ok, true)
  if (high.ok) assert.equal(high.plan.maxConcurrent, 8)

  const keep = revisePlan(planOf(), { goal: 'a' }, NOW)
  assert.equal(keep.ok, true)
  if (keep.ok) assert.equal(keep.plan.maxConcurrent, 3)
})

test('revisePlan：已终止/已取消的计划拒绝并入（要开新计划）', () => {
  for (const status of ['terminated', 'cancelled'] as const) {
    const result = revisePlan(planOf({ status }), { goal: '还想改' }, NOW)
    assert.equal(result.ok, false)
    if (result.ok) continue
    assert.match(result.reason, /不能并入需求修订（请开新的计划）/)
  }
})

test('revisePlan：revisions 只增不删，历次修订顺序保留', () => {
  const first = revisePlan(planOf(), { goal: '第一次修订' }, NOW)
  assert.equal(first.ok, true)
  if (!first.ok) return
  const second = revisePlan(first.plan, { goal: '第二次修订' }, NOW + 3_600_000)
  assert.equal(second.ok, true)
  if (!second.ok) return
  assert.equal(second.plan.revisions?.length, 2)
  assert.equal(second.plan.revisions?.[0].text, '第一次修订')
  assert.equal(second.plan.revisions?.[1].text, '第二次修订')
  // 两段标题都在，且原文仍在最前（追加而非覆盖）。
  assert.equal((second.plan.goal ?? '').match(/## 需求修订（/g)?.length, 2)
  assert.ok((second.plan.goal ?? '').startsWith('原始目标\n\n## 需求修订（'))
})

test('revisePlan：不修改输入对象（深拷贝语义）', () => {
  const plan = planOf()
  const before = JSON.stringify(plan)
  revisePlan(plan, {
    goal: '新需求',
    changeSummary: '改验收',
    cancelledTaskIds: ['t2'],
    tasks: [{ title: '追加', roleId: 'qa', acceptance: 'exit 0' }],
  }, NOW)
  assert.equal(JSON.stringify(plan), before)
})
