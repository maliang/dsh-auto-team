/**
 * r18b · 右栏任务列表「全量」口径的单测。
 *
 * 背景：r18 曾把列表过滤成「只列进行中任务；全部完成时只留最近完成的一个」，
 * 用户 2026-11-05 明确要求「角色卡区域下方的任务列表要显示全部任务」，故回滚过滤。
 * 现在 `taskOverviewOf` 的分组与环都按全量任务派生：
 *  - `groups.open`  = 所有 `status !== 'done'`（cancelled / skipped 也在内，保持计划顺序）
 *  - `groups.done`  = 所有 done 任务（保持计划顺序）
 *  - 环仍是 done/total（cancelled/skipped 计入分母、不计入分子）
 *
 * 空组不渲染的逻辑**保留在 TaskTable 的渲染层**（rows.length === 0 跳过组与组头；
 * 两组都空时整块不渲染），所以「全部完成时没有『未完成 · 0』组头」仍然成立。
 *
 * 判据落在纯函数 + 组件源码契约上：本仓没有 react-dom，DOM 断言抓不住分组归属。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  PROGRESS_RING_CIRCUMFERENCE,
  buildTaskDetail,
  taskOverviewOf,
} from '../src/client/viewmodel.ts'
import type { GateEvidence, PlanTask, TaskDetailView, TaskStatus } from '../src/shared/types.ts'

/* ────────────────────────── 夹具 ────────────────────────── */

function gateAt(at: number): GateEvidence {
  return {
    taskId: 't1',
    command: 'pnpm typecheck',
    exitCode: 0,
    tail: 'ok',
    artifacts: [],
    at,
  }
}

function taskOf(id: string, status: TaskStatus, extra: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'pnpm typecheck',
    status,
    ...extra,
  }
}

function detailOf(id: string, status: TaskStatus, evidenceAt?: number): TaskDetailView {
  const extra: Partial<PlanTask> = {}
  if (evidenceAt !== undefined) extra.evidence = gateAt(evidenceAt)
  return buildTaskDetail(taskOf(id, status, extra), { roleName: 'dev', messageCount: 0 })
}

const ALL_STATUSES: readonly TaskStatus[] = [
  'pending',
  'ready',
  'running',
  'gate',
  'rework',
  'waiting',
  'blocked',
  'failed',
  'interrupted',
  'paused',
  'done',
  'cancelled',
  'skipped',
]

const VIEWS_DIR = new URL('../src/client/views/', import.meta.url)
const VIEWMODEL = readFileSync(new URL('../src/client/viewmodel.ts', import.meta.url), 'utf8')

function viewCode(name: string): string {
  return readFileSync(new URL(`${name}.tsx`, VIEWS_DIR), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/* ────────────────────────── 全量分组口径 ────────────────────────── */

test('混合状态：全部任务都出现在列表里（open 保计划顺序、done 保计划顺序）', () => {
  const overview = taskOverviewOf([
    detailOf('t1', 'done', 100),
    detailOf('t2', 'running'),
    detailOf('t3', 'pending'),
    detailOf('t4', 'done', 200),
    detailOf('t5', 'cancelled'),
    detailOf('t6', 'skipped'),
  ])
  assert.deepEqual(
    overview.groups.open.map((row) => row.id),
    ['t2', 't3', 't5', 't6'],
    '所有非 done（含 cancelled/skipped）都进未完成组，且保持计划顺序',
  )
  assert.deepEqual(
    overview.groups.done.map((row) => row.id),
    ['t1', 't4'],
    '所有 done 都进已完成组，且保持计划顺序（不按 evidence.at 重排）',
  )
  // 全量口径下「列表行数 = 任务总数」，这是用户要求的核心
  assert.equal(overview.groups.open.length + overview.groups.done.length, 6)
})

test('13 种 TaskStatus 的归属：只有 done 进已完成组，其余一律进未完成组', () => {
  for (const status of ALL_STATUSES) {
    const overview = taskOverviewOf([detailOf('t1', status)])
    const completed = status === 'done'
    assert.equal(overview.groups.done.length, completed ? 1 : 0, `${status} 落错分组`)
    assert.equal(overview.groups.open.length, completed ? 0 : 1, `${status} 落错分组`)
    assert.equal(overview.done, completed ? 1 : 0, `${status} 的分子口径错误`)
    assert.equal(overview.text, completed ? '1/1' : '0/1')
  }
  // cancelled / skipped 是终态但既不是完成也不需要关注 —— 现在仍留在未完成组里可见
  const both = taskOverviewOf([detailOf('t1', 'cancelled'), detailOf('t2', 'skipped')])
  assert.deepEqual(both.groups.open.map((row) => row.id), ['t1', 't2'])
  assert.equal(both.groups.done.length, 0)
  assert.equal(both.done, 0)
  assert.equal(both.text, '0/2', '环的分母仍是全量任务')
})

test('全部 done：done 组回全部任务（不再只留最近完成的一个）', () => {
  const overview = taskOverviewOf([
    detailOf('t1', 'done', 300),
    detailOf('t2', 'done', 200),
    detailOf('t3', 'done', 500),
  ])
  assert.equal(overview.groups.open.length, 0)
  assert.deepEqual(overview.groups.done.map((row) => row.id), ['t1', 't2', 't3'])
  assert.equal(overview.done, 3, '环的分子仍是全量 done 数')
  assert.equal(overview.total, 3)
  assert.equal(overview.text, '3/3')
})

/* ────────────────────────── 环仍按全量任务算 ────────────────────────── */

test('环仍按全量任务算：2 done + 1 running → 2/3，列表 3 行', () => {
  const overview = taskOverviewOf([
    detailOf('t1', 'done', 100),
    detailOf('t2', 'done', 200),
    detailOf('t3', 'running'),
  ])
  assert.equal(overview.done, 2)
  assert.equal(overview.total, 3)
  assert.equal(overview.text, '2/3')
  assert.equal(overview.ariaLabel, '已完成 2 / 共 3')
  assert.equal(Math.abs(overview.ratio - 2 / 3) < 1e-9, true)
  assert.equal(Math.abs(overview.dashOffset - PROGRESS_RING_CIRCUMFERENCE / 3) < 1e-9, true)
  assert.equal(overview.groups.open.length + overview.groups.done.length, 3)
})

test('空任务列表：0/0、两组都空、不出现 NaN / Infinity', () => {
  const overview = taskOverviewOf([])
  assert.equal(overview.done, 0)
  assert.equal(overview.total, 0)
  assert.equal(overview.text, '0/0')
  assert.equal(overview.ratio, 0)
  assert.equal(Number.isFinite(overview.ratio), true)
  assert.equal(Number.isFinite(overview.dashOffset), true)
  assert.equal(overview.dashOffset, PROGRESS_RING_CIRCUMFERENCE)
  assert.deepEqual(overview.groups.open, [])
  assert.deepEqual(overview.groups.done, [])
})

/* ────────────────────────── 组件契约 ────────────────────────── */

test('TaskTable：组头文案恢复「未完成」/「已完成」，r18 文案不再残留', () => {
  const code = viewCode('TaskTable')
  assert.match(code, /open: '未完成'/)
  assert.match(code, /done: '已完成'/)
  assert.equal(code.includes('进行中'), false, '组件里不能再残留 r18 组头文案')
  assert.equal(code.includes('最近完成'), false, '组件里不能再残留 r18 组头文案')
  // 分组行直接消费 overview.groups（组件不做二次过滤）
  assert.match(code, /overview\.groups\[key\]/)
  assert.match(code, /taskOverviewOf\(/)
  // data-* 钩子不变
  assert.match(code, /data-task-group=\{key\}/)
  assert.match(code, /data-group-head/)
  assert.match(code, /data-task-row/)
})

/**
 * 取 TaskTable 的 grouped 分支源码（`if (grouped === true)` → 历史详情页分支的
 * `data-task-head` 之前），用于钉住「空组不渲染」这层保留的渲染逻辑。
 */
function groupedBranchOf(code: string): string {
  const start = code.indexOf('if (grouped === true)')
  const end = code.indexOf('data-task-head')
  assert.ok(start >= 0, 'TaskTable 必须保留 grouped 分支')
  assert.ok(end > start, 'TaskTable 必须保留非 grouped（历史详情页全量）分支')
  return code.slice(start, end)
}

test('TaskTable grouped：空组整组不渲染（组头一起省掉），渲染入口是过滤后的 groups', () => {
  const branch = groupedBranchOf(viewCode('TaskTable'))
  const filterAt = branch.indexOf('.filter((group) => group.rows.length > 0)')
  assert.ok(filterAt >= 0, '必须按 rows.length === 0 过滤空组，否则空分组仍出组头')
  const renderAt = branch.indexOf('groups.map(')
  assert.ok(renderAt > filterAt, '渲染入口必须是过滤后的 groups，而不是原始 key 元组')
  const sectionAt = branch.indexOf('data-task-group')
  const headAt = branch.indexOf('data-group-head')
  const rowsAt = branch.indexOf('data-task-rows')
  assert.ok(sectionAt > renderAt, 'section 由 groups.map 产出')
  assert.ok(headAt > sectionAt, '组头在 section 内')
  assert.ok(rowsAt > headAt, '行列表在组头之后')
})

test('TaskTable grouped：两组都空时整块分组列表不渲染（环不受影响）', () => {
  const branch = groupedBranchOf(viewCode('TaskTable'))
  const guardAt = branch.indexOf('groups.length === 0')
  const listAt = branch.indexOf('data-region="task-list"')
  assert.ok(guardAt >= 0, '两组都空必须有显式分支')
  assert.ok(listAt > guardAt, '空态必须在渲染分组列表之前直接返回')
  assert.equal(
    /data-progress-ring|ProgressRing/.test(branch),
    false,
    '分组分支不许自己画环：环在 TaskOverview，空列表不影响 0/0',
  )
})

test('真实场景：全部完成只渲染「已完成」组；有未完成任务时两组都渲染', () => {
  const visibleKeys = (overview: ReturnType<typeof taskOverviewOf>): readonly ('open' | 'done')[] =>
    (['open', 'done'] as const).filter((key) => overview.groups[key].length > 0)

  const allDone = taskOverviewOf([detailOf('t1', 'done', 100), detailOf('t2', 'done', 200)])
  assert.deepEqual(visibleKeys(allDone), ['done'], '全部完成时不能出现「未完成 · 0」组头')
  assert.equal(allDone.groups.done.length, 2, '已完成组回全部 done 任务')

  const mixed = taskOverviewOf([detailOf('t1', 'done', 100), detailOf('t2', 'running')])
  assert.deepEqual(visibleKeys(mixed), ['open', 'done'], '有未完成任务时两组都渲染')

  const none = taskOverviewOf([detailOf('t1', 'cancelled'), detailOf('t2', 'skipped')])
  assert.deepEqual(visibleKeys(none), ['open'], 'cancelled/skipped 现在留在未完成组，列表不为空')
})

test('r18 的过滤助手已删除（taskOverviewOf 不再引用）', () => {
  assert.equal(VIEWMODEL.includes('isOngoingTaskStatus'), false, '未使用且无导出的旧助手应删除')
  assert.equal(VIEWMODEL.includes('recentCompletedTaskOf'), false, '未使用且无导出的旧助手应删除')
})

test('TaskOverview：环与列表仍是同一次 taskOverviewOf 派生', () => {
  const code = viewCode('TaskOverview')
  assert.match(code, /taskOverviewOf\(/)
  assert.match(code, /grouped/)
})
