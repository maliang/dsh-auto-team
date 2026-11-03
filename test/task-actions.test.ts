/**
 * 单任务三动作的允许矩阵单测（r11 AC-26/AC-27/AC-28；node --test 直跑 TS 源）。
 *
 * 39 格**逐格写死**（13 态 × 3 动作）：矩阵是产品口径，任何一格被顺手改动都应在这里变红。
 * 同时守三条不变量：
 *  ① 允许 ⟺ 禁用原因为空串（宿主拒绝面与面板 disabled 由同一格派生，不允许一边允许一边不给原因）；
 *  ② 13 条中文标签互不重复、且没有回显英文原文；
 *  ③ `TaskStatus` 恰好 13 值（扩值会立刻让 `Record` 完整性检查报错，这里再显式数一次）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TASK_ACTION_ALLOW,
  TASK_STATUS_LABELS,
  taskActionAllowed,
  taskActionDisabledReason,
  type TaskActionName,
} from '../src/shared/task-actions.ts'
import type { TaskStatus } from '../src/shared/types.ts'

/** 13 态（数组长度本身就是 AC-28 的形状判据）。 */
const STATUSES: TaskStatus[] = [
  'pending',
  'ready',
  'blocked',
  'waiting',
  'running',
  'rework',
  'failed',
  'interrupted',
  'gate',
  'paused',
  'done',
  'cancelled',
  'skipped',
]

const ACTIONS: TaskActionName[] = ['cancel', 'skip', 'edit-acceptance']

/**
 * 39 格快照：每格 `true` = 允许；`false` 时用字符串写出**逐字**禁用原因（DESIGN §3.4）。
 */
const MATRIX: Record<TaskStatus, [boolean | string, boolean | string, boolean | string]> = {
  pending: [true, true, true],
  ready: [true, true, true],
  blocked: [true, true, true],
  waiting: [true, true, true],
  running: [true, '运行中请先取消', true],
  rework: [true, '待返工：请重跑或取消', true],
  failed: [true, '已失败：请重跑或取消', true],
  interrupted: ['已中断：请续聊或改验收后重跑', '已中断：请续聊', true],
  gate: ['门禁执行中，等门禁结束', '门禁执行中', true],
  paused: ['已暂停：先点页头『继续任务』', '已暂停：先继续任务', true],
  // r13 PRD 取代 r11#AC-26：done 允许改验收（宿主确认后落新命令并重跑门禁）
  done: ['已完成，无需取消', '已完成', true],
  cancelled: ['已取消', '已取消', '已取消'],
  skipped: ['已跳过', '已跳过', '已跳过'],
}

test('TaskStatus 恰好 13 值（扩值必须同步这张矩阵）', () => {
  assert.equal(STATUSES.length, 13)
  assert.deepEqual(Object.keys(MATRIX).sort(), [...STATUSES].sort())
  assert.deepEqual(Object.keys(TASK_STATUS_LABELS).sort(), [...STATUSES].sort())
  assert.deepEqual(Object.keys(TASK_ACTION_ALLOW).sort(), [...STATUSES].sort())
})

test('39 格允许矩阵逐格一致：TASK_ACTION_ALLOW / taskActionAllowed / 禁用原因三处同源', () => {
  let cells = 0
  for (const status of STATUSES) {
    const row = MATRIX[status]
    for (const [index, action] of ACTIONS.entries()) {
      cells += 1
      const expected = row[index]!
      const allowed = typeof expected === 'boolean' ? expected : false
      const reason = typeof expected === 'string' ? expected : ''

      const key = action === 'edit-acceptance' ? 'acceptance' : action
      assert.equal(TASK_ACTION_ALLOW[status][key], allowed, `${status}/${action}：允许表取值`)
      assert.equal(taskActionAllowed(action, status), allowed, `${status}/${action}：taskActionAllowed`)
      assert.equal(
        taskActionDisabledReason(action, status),
        reason,
        `${status}/${action}：禁用原因必须逐字等于 DESIGN §3.4 的文案`,
      )
      // ① 允许 ⟺ 原因为空串（不允许出现「允许但给原因」「禁用但没原因」两种半态）
      assert.equal(reason === '', allowed, `${status}/${action}：允许与「无原因」必须等价`)
    }
  }
  assert.equal(cells, 39, 'AC-27 判据：13 态 × 3 动作 = 39 格')
})

test('允许集白名单（AC-26）：cancel 含 running/rework/failed，skip 只到 waiting，done 仅放开改验收', () => {
  for (const status of ['pending', 'blocked', 'ready', 'waiting', 'running', 'rework', 'failed'] as TaskStatus[]) {
    assert.equal(taskActionAllowed('cancel', status), true, `${status} 应允许取消`)
  }
  for (const status of ['done', 'cancelled', 'skipped', 'paused', 'gate', 'interrupted'] as TaskStatus[]) {
    assert.equal(taskActionAllowed('cancel', status), false, `${status} 不应允许取消`)
  }
  for (const status of ['pending', 'blocked', 'ready', 'waiting'] as TaskStatus[]) {
    assert.equal(taskActionAllowed('skip', status), true, `${status} 应允许跳过`)
  }
  for (const status of ['running', 'rework', 'failed', 'done', 'cancelled', 'skipped'] as TaskStatus[]) {
    assert.equal(taskActionAllowed('skip', status), false, `${status} 不应允许跳过`)
  }
  for (const status of ['cancelled', 'skipped'] as TaskStatus[]) {
    assert.equal(taskActionAllowed('edit-acceptance', status), false, `${status} 不应允许改验收`)
  }
  // 除 cancelled/skipped 外改验收都允许 —— done 也在内（r13 取代 r11#AC-26，确认后重跑门禁）
  for (const status of STATUSES.filter((item) => !['cancelled', 'skipped'].includes(item))) {
    assert.equal(taskActionAllowed('edit-acceptance', status), true, `${status} 应允许改验收`)
  }
  // 单独钉住 done：这一格是 r13 的需求本体，被顺手改回去必须立刻红
  assert.equal(taskActionAllowed('edit-acceptance', 'done'), true, 'done 必须允许改验收（r13 取代 r11#AC-26）')
})

test('13 条中文标签互不重复、不是英文原文、且徽标用词与状态语义一致', () => {
  const labels = STATUSES.map((status) => TASK_STATUS_LABELS[status])
  assert.equal(new Set(labels).size, 13, '13 个中文标签必须互不重复')
  for (const status of STATUSES) {
    assert.notEqual(TASK_STATUS_LABELS[status], status, `${status} 不得回显英文原文`)
    assert.ok(TASK_STATUS_LABELS[status].trim() !== '', `${status} 标签不能为空`)
  }
  assert.equal(TASK_STATUS_LABELS.waiting, '等待中')
  assert.equal(TASK_STATUS_LABELS.cancelled, '已取消')
  assert.equal(TASK_STATUS_LABELS.skipped, '已跳过')
  assert.equal(TASK_STATUS_LABELS.done, '已通过')
})

test('未知状态一律拒绝（旧 run 文件里的脏状态不能放行写操作）', () => {
  const unknown = 'ghost' as TaskStatus
  assert.equal(taskActionAllowed('cancel', unknown), false)
  assert.match(taskActionDisabledReason('cancel', unknown), /未知任务状态/)
})
