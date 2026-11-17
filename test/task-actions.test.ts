/**
 * 单任务四动作的允许矩阵单测（r11 AC-26/AC-27/AC-28 + r37/r43 的 pause；node --test 直跑 TS 源）。
 *
 * 56 格**逐格写死**（14 态 × 4 动作；r42 新增 review 行）：矩阵是产品口径，任何一格被顺手改动都应在这里变红。
 * r43：第 4 列 `pause` 是任务级暂停（对应面板两个动作 `pauseTask`/`resumeTask`，
 * 共用同一格允许集 —— `paused` 行允许的语义是「继续」）。计数意图保留：39 → 52 是**扩列**，
 * 不是删断言。
 * 同时守三条不变量：
 *  ① 允许 ⟺ 禁用原因为空串（宿主拒绝面与面板 disabled 由同一格派生，不允许一边允许一边不给原因）；
 *  ② 14 条中文标签互不重复、且没有回显英文原文；
 *  ③ `TaskStatus` 恰好 14 值（扩值会立刻让 `Record` 完整性检查报错，这里再显式数一次）。
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

/** 14 态（数组长度本身就是 AC-28 的形状判据；r42 新增 `review`）。 */
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
  'review',
  'done',
  'cancelled',
  'skipped',
]

const ACTIONS: TaskActionName[] = ['cancel', 'skip', 'edit-acceptance', 'pause']

/**
 * 56 格快照：每格 `true` = 允许；`false` 时用字符串写出**逐字**禁用原因（DESIGN §3.4）。
 *
 * 第 4 列 = `pause`（r37/r43 任务级暂停）：除 `done/cancelled/skipped`（已结束）外全允许；
 * `paused` 行也必须允许 —— 客户端把它渲染成「继续此任务」，宿主侧落到 `resumeTask`。
 */
const MATRIX: Record<
  TaskStatus,
  [boolean | string | RegExp, boolean | string | RegExp, boolean | string, boolean | string]
> = {
  pending: [true, true, true, true],
  ready: [true, true, true, true],
  blocked: [true, true, true, true],
  waiting: [true, true, true, true],
  running: [true, '运行中请先取消', true, true],
  rework: [true, '待返工：请重跑或取消', true, true],
  failed: [true, '已失败：请重跑或取消', true, true],
  interrupted: ['已中断：请续聊或改验收后重跑', '已中断：请续聊', true, true],
  gate: ['门禁执行中，等门禁结束', '门禁执行中', true, true],
  // r42：门禁通过、等人工验收 —— 取消/跳过/改验收允许，暂停拒绝（要打回或取消，不是冻结）。
  review: [true, true, true, '任务在验收中，先打回或取消'],
  // t7（缺陷 D1）：两级暂停入口的按钮名分别是页头「继续团队」与行内「继续此任务」，
  // 文案必须两个都点名；用正则而不是逐字快照，改措辞不至于红，但少点一个入口或退回旧名必红。
  paused: [
    /^已暂停：.*团队暂停请点页头『继续团队』.*单卡暂停请点该行『继续此任务』/,
    /^已暂停：跳过前需先恢复任务.*团队暂停请点页头『继续团队』.*单卡暂停请点该行『继续此任务』/,
    true,
    true,
  ],
  // r13 PRD 取代 r11#AC-26：done 允许改验收（宿主确认后落新命令并重跑门禁）
  done: ['已完成，无需取消', '已完成', true, '任务已结束，不能暂停'],
  cancelled: ['已取消', '已取消', '已取消', '任务已结束，不能暂停'],
  skipped: ['已跳过', '已跳过', '已跳过', '任务已结束，不能暂停'],
}

test('TaskStatus 恰好 14 值（扩值必须同步这张矩阵）', () => {
  assert.equal(STATUSES.length, 14)
  assert.deepEqual(Object.keys(MATRIX).sort(), [...STATUSES].sort())
  assert.deepEqual(Object.keys(TASK_STATUS_LABELS).sort(), [...STATUSES].sort())
  assert.deepEqual(Object.keys(TASK_ACTION_ALLOW).sort(), [...STATUSES].sort())
})

test('56 格允许矩阵逐格一致：TASK_ACTION_ALLOW / taskActionAllowed / 禁用原因三处同源', () => {
  let cells = 0
  for (const status of STATUSES) {
    const row = MATRIX[status]
    for (const [index, action] of ACTIONS.entries()) {
      cells += 1
      const expected = row[index]!
      const allowed = typeof expected === 'boolean' ? expected : false
      const actual = taskActionDisabledReason(action, status)

      const key = action === 'edit-acceptance' ? 'acceptance' : action
      assert.equal(TASK_ACTION_ALLOW[status][key], allowed, `${status}/${action}：允许表取值`)
      assert.equal(taskActionAllowed(action, status), allowed, `${status}/${action}：taskActionAllowed`)
      if (typeof expected === 'string') {
        assert.equal(actual, expected, `${status}/${action}：禁用原因必须逐字等于 DESIGN §3.4 的文案`)
      } else if (expected instanceof RegExp) {
        // 只给「正随 t2 改文案」的那一格用（见 MATRIX 里 paused 行的注释）：语义前缀不变即绿，
        // 但文案被静默清空/改成别的说法仍会红。
        assert.match(actual, expected, `${status}/${action}：禁用原因必须保留「先点页头『继续…』」的语义前缀`)
      }
      // ① 允许 ⟺ 原因为空串（不允许出现「允许但给原因」「禁用但没原因」两种半态）
      assert.equal(actual === '', allowed, `${status}/${action}：允许与「无原因」必须等价`)
    }
  }
  assert.equal(cells, 56, 'AC-27 判据：14 态 × 4 动作 = 56 格（r42 由 52 扩行，计数意图保留）')
})

test('pause 列口径（r37/r43）：除 done/cancelled/skipped/review 外全允许，paused 行必须允许（= 继续）', () => {
  // r42：review 是唯一「非终态但不许暂停」的行 —— 验收态要打回或取消，不是冻结。
  const ended: TaskStatus[] = ['done', 'cancelled', 'skipped', 'review']
  for (const status of STATUSES) {
    const expectAllowed = !ended.includes(status)
    assert.equal(taskActionAllowed('pause', status), expectAllowed, `${status}：pause 允许面`)
    if (!expectAllowed) {
      assert.equal(
        taskActionDisabledReason('pause', status),
        status === 'review' ? '任务在验收中，先打回或取消' : '任务已结束，不能暂停',
        `${status}：拒绝原因必须逐字（宿主 BAD_REQUEST 文案与面板 title 同源）`,
      )
    } else {
      assert.equal(taskActionDisabledReason('pause', status), '', `${status}：允许时不许给禁用原因`)
    }
  }
  // paused 行是本次需求的核心格：它语义上是「继续」，被顺手改成 false 会让已暂停任务永远解不开。
  assert.equal(taskActionAllowed('pause', 'paused'), true, 'paused 行必须允许（客户端渲染成「继续此任务」）')
  // 逐行 4 列：14 态 × 4 动作 = 56 格（与上面的计数断言同一条不变量，这里按行再数一次）。
  for (const status of STATUSES) {
    assert.deepEqual(
      Object.keys(TASK_ACTION_ALLOW[status]).sort(),
      ['acceptance', 'cancel', 'pause', 'skip'],
      `${status}：允许表必须恰好 4 列`,
    )
  }
})

test('允许集白名单（AC-26）：cancel 含 running/rework/failed，skip 只到 waiting，done 仅放开改验收', () => {
  for (const status of ['pending', 'blocked', 'ready', 'waiting', 'running', 'rework', 'failed', 'review'] as TaskStatus[]) {
    assert.equal(taskActionAllowed('cancel', status), true, `${status} 应允许取消`)
  }
  for (const status of ['done', 'cancelled', 'skipped', 'paused', 'gate', 'interrupted'] as TaskStatus[]) {
    assert.equal(taskActionAllowed('cancel', status), false, `${status} 不应允许取消`)
  }
  for (const status of ['pending', 'blocked', 'ready', 'waiting', 'review'] as TaskStatus[]) {
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

test('14 条中文标签互不重复、不是英文原文、且徽标用词与状态语义一致', () => {
  const labels = STATUSES.map((status) => TASK_STATUS_LABELS[status])
  assert.equal(new Set(labels).size, 14, '14 个中文标签必须互不重复')
  for (const status of STATUSES) {
    assert.notEqual(TASK_STATUS_LABELS[status], status, `${status} 不得回显英文原文`)
    assert.ok(TASK_STATUS_LABELS[status].trim() !== '', `${status} 标签不能为空`)
  }
  assert.equal(TASK_STATUS_LABELS.waiting, '等待中')
  assert.equal(TASK_STATUS_LABELS.cancelled, '已取消')
  assert.equal(TASK_STATUS_LABELS.skipped, '已跳过')
  assert.equal(TASK_STATUS_LABELS.done, '已通过')
  assert.equal(TASK_STATUS_LABELS.review, '待验收')
})

test('未知状态一律拒绝（旧 run 文件里的脏状态不能放行写操作）', () => {
  const unknown = 'ghost' as TaskStatus
  assert.equal(taskActionAllowed('cancel', unknown), false)
  assert.match(taskActionDisabledReason('cancel', unknown), /未知任务状态/)
})
