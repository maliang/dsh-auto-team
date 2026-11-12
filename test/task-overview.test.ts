/**
 * r14 · 任务总览（进度环 + 未完成/已完成分组）的单测。
 *
 * 为什么单独成文件（TECHNICAL §8 的文件表与 verifyScripts 都点名 `test/task-overview.test.ts`）：
 * 环与分组必须在**同一帧**读到同一份派生结果（AC-11），环内数字的舍入与 0/0 的 NaN 都是
 * DOM 断言抓不住的算术事实 —— 这里把 `taskOverviewOf` 的算术与分组顺序锁死，
 * 组件层（TaskOverview）只负责渲染，不再做第二次除法。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PROGRESS_RING_CIRCUMFERENCE,
  PROGRESS_RING_RADIUS,
  PROGRESS_RING_SIZE,
  PROGRESS_RING_STROKE,
  PROGRESS_RING_VIEWBOX,
  buildTaskDetail,
  taskOverviewOf,
} from '../src/client/viewmodel.ts'
import type { PlanTask, TaskDetailView, TaskStatus } from '../src/shared/types.ts'

/* ────────────────────────── 夹具 ────────────────────────── */

function taskOf(id: string, status: TaskStatus, extra: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: '能跑通',
    status,
    ...extra,
  }
}

function overviewTask(id: string, status: TaskStatus): TaskDetailView {
  return buildTaskDetail(taskOf(id, status), { roleName: 'dev', messageCount: 0 })
}

/* ────────────────────────── 用例 ────────────────────────── */

test('taskOverviewOf：2 done + 1 running → 2/3、弧长 2/3，分组顺序「未完成在前、已完成在后」', () => {
  const overview = taskOverviewOf([
    overviewTask('t1', 'done'),
    overviewTask('t2', 'done'),
    overviewTask('t3', 'running'),
  ])
  assert.equal(overview.done, 2)
  assert.equal(overview.total, 3)
  assert.equal(overview.text, '2/3', '环内文字严格是 done/total')
  assert.equal(overview.ariaLabel, '已完成 2 / 共 3')
  assert.equal(Math.abs(overview.ratio - 2 / 3) < 0.01, true, '比例误差 ≤0.01')
  assert.equal(
    Math.abs(overview.dashOffset - PROGRESS_RING_CIRCUMFERENCE / 3) < 0.01,
    true,
    'dashoffset = C×(1−done/total)，误差 ≤0.01',
  )
  assert.deepEqual(overview.groups.open.map((row) => row.id), ['t3'], '未完成组在前，保持计划顺序')
  assert.deepEqual(overview.groups.done.map((row) => row.id), ['t1', 't2'], '已完成组在后，全量 done')
  // 公差：环几何常量本身也得对（r16 设计 §0：80 环 / viewBox 80 / r34 / 8 描边）
  assert.equal(PROGRESS_RING_SIZE, 80)
  assert.equal(PROGRESS_RING_VIEWBOX, 80)
  assert.equal(PROGRESS_RING_RADIUS, 34)
  assert.equal(PROGRESS_RING_STROKE, 8)
  assert.equal(Math.abs(PROGRESS_RING_CIRCUMFERENCE - 2 * Math.PI * 34) < 1e-9, true)
})

test('taskOverviewOf：同一渲染帧内改状态 → 环与分组一起变（AC-11 不许一个变一个不变）', () => {
  const before = taskOverviewOf([overviewTask('t1', 'running')])
  assert.equal(before.text, '0/1')
  assert.equal(before.groups.open.length, 1)
  assert.equal(before.groups.done.length, 0)

  const after = taskOverviewOf([overviewTask('t1', 'done')])
  assert.equal(after.text, '1/1')
  assert.equal(after.groups.open.length, 0, '分组计数与环必须同源同帧')
  assert.equal(after.groups.done.length, 1)
  assert.equal(after.dashOffset, 0)
})

test('taskOverviewOf：空计划 0/0，不出现 NaN / Infinity', () => {
  const overview = taskOverviewOf([])
  assert.equal(overview.done, 0)
  assert.equal(overview.total, 0)
  assert.equal(overview.text, '0/0')
  assert.equal(overview.ariaLabel, '已完成 0 / 共 0')
  assert.equal(overview.ratio, 0)
  assert.equal(overview.dashOffset, PROGRESS_RING_CIRCUMFERENCE)
  assert.equal(Number.isFinite(overview.ratio), true)
  assert.equal(Number.isFinite(overview.dashOffset), true)
  assert.equal(overview.groups.open.length, 0)
  assert.equal(overview.groups.done.length, 0)
})

test('taskOverviewOf：13 种 TaskStatus 的分子与分组（只有 done 进已完成组，其余全在未完成组）', () => {
  const statuses = [
    'pending',
    'blocked',
    'ready',
    'running',
    'paused',
    'gate',
    'done',
    'rework',
    'failed',
    'interrupted',
    'waiting',
    'cancelled',
    'skipped',
  ] as const
  assert.equal(statuses.length, 13)
  for (const status of statuses) {
    const overview = taskOverviewOf([overviewTask('t1', status)])
    const completed = status === 'done'
    assert.equal(overview.done, completed ? 1 : 0, `${status} 的分子口径错误`)
    assert.equal(overview.groups.done.length, completed ? 1 : 0, `${status} 落错分组`)
    assert.equal(overview.groups.open.length, completed ? 0 : 1, `${status} 落错分组`)
    assert.equal(overview.text, completed ? '1/1' : '0/1')
  }
  // cancelled / skipped 是终态但不是完成：按 r18b 全量口径留在未完成组
  const both = taskOverviewOf([overviewTask('t1', 'cancelled'), overviewTask('t2', 'skipped')])
  assert.equal(both.done, 0)
  assert.equal(both.groups.open.length, 2, '全量口径：cancelled/skipped 仍在未完成组可见')
  assert.equal(both.groups.done.length, 0)
})
