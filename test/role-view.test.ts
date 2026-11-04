/**
 * r14 AC-7 / AC-8 / AC-12 的算法侧证据：`src/shared/role-view.ts#roleStateOf`。
 *
 * 为什么单测锁在这里：宿主 `library.ts#rolesOf` 与客户端 `viewmodel.ts#roleUsageOf`
 * 现在都只是「喂任务列表 + 铺字段」，状态判定只有这一处。表驱动覆盖全部 13 种
 * `TaskStatus` —— 组件/DOM 断言抓不到「cancelled 被算成 done」这类口径错误，
 * 而口径错了会让右栏和抽屉一起撒谎。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ROLE_STATE_TEXT,
  ROLE_STATE_TONE,
  ROLE_USAGE_MISSING,
  ROLE_USAGE_PARTIAL,
  roleStateOf,
  roleUsageCellOf,
  type RoleStateKind,
  type RoleTaskInput,
} from '../src/shared/role-view.ts'
import { rolesOf } from '../src/host/library.ts'
import { roleUsageOf } from '../src/client/viewmodel.ts'
import type { DurationCell, Role, TaskDetailView, TaskStatus, UsageCell } from '../src/shared/types.ts'

/** 全部 13 种任务状态（与 `src/shared/types.ts#TaskStatus` 逐字对齐）。 */
const ALL_STATUSES: readonly TaskStatus[] = [
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
]

const DURATION: DurationCell = { state: 'running', ms: 61_000, text: '1m 1s', startAt: 1 }

function task(id: string, status: TaskStatus, duration?: DurationCell): RoleTaskInput {
  const item: RoleTaskInput = { id, title: `任务 ${id}`, status }
  if (duration !== undefined) item.duration = duration
  return item
}

/** 单任务 → 期望的状态（PRD AC-7 的优先级表）。 */
const EXPECTED: Record<TaskStatus, RoleStateKind> = {
  pending: 'idle',
  blocked: 'idle',
  ready: 'idle',
  running: 'running',
  paused: 'idle',
  gate: 'waiting_gate',
  done: 'done',
  rework: 'needs_attention',
  failed: 'needs_attention',
  interrupted: 'needs_attention',
  waiting: 'idle',
  cancelled: 'idle',
  skipped: 'idle',
}

test('roleStateOf：13 种 TaskStatus 逐一表驱动（状态 / 分子 / 当前任务）', () => {
  assert.equal(ALL_STATUSES.length, 13, 'TaskStatus 必须是 13 种（AC-18 的形状普查）')
  for (const status of ALL_STATUSES) {
    const view = roleStateOf([task('t1', status, DURATION)])
    assert.equal(view.state, EXPECTED[status], `${status} 的角色状态映射错误`)
    assert.equal(view.stateText, ROLE_STATE_TEXT[view.state], `${status} 的 stateText 必须查同一张表`)
    assert.equal(view.done, status === 'done' ? 1 : 0, `${status} 的已完成分子只认 done`)
    const active = status === 'running' || status === 'gate'
    assert.equal(view.activeTaskId, active ? 't1' : undefined, `${status} 的当前任务判定错误`)
    assert.equal(view.activeTaskTitle, active ? '任务 t1' : undefined)
    assert.deepEqual(
      view.duration,
      active ? DURATION : { state: 'unavailable', text: '不可得' },
      `${status} 的用时：有当前任务才取其实时值，否则「不可得」而不是 0`,
    )
  }
})

test('roleStateOf：空任务列表 = 待命 + 0 + 不可得（不画假进度）', () => {
  const view = roleStateOf([])
  assert.equal(view.state, 'idle')
  assert.equal(view.stateText, '待命')
  assert.equal(view.done, 0)
  assert.equal(view.activeTaskId, undefined)
  assert.deepEqual(view.duration, { state: 'unavailable', text: '不可得' })
})

test('roleStateOf：优先级 running > gate > 需处理 > 全 done > idle', () => {
  // ① running 压过 gate 与需处理
  const a = roleStateOf([task('t1', 'gate'), task('t2', 'rework'), task('t3', 'running'), task('t4', 'done')])
  assert.equal(a.state, 'running')
  assert.equal(a.activeTaskId, 't3', '当前任务取第一个 running')
  assert.equal(a.done, 1)

  // ② 没有 running 时 gate 压过需处理
  const b = roleStateOf([task('t1', 'failed'), task('t2', 'gate')])
  assert.equal(b.state, 'waiting_gate')
  assert.equal(b.activeTaskId, 't2', '没有 running 时当前任务取第一个 gate')

  // ③ 没有 running/gate 时需处理压过「全部完成」
  const c = roleStateOf([task('t1', 'done'), task('t2', 'done'), task('t3', 'interrupted')])
  assert.equal(c.state, 'needs_attention')
  assert.equal(c.done, 2)
  assert.equal(c.activeTaskId, undefined, '需处理没有「当前任务」，用时必须是不可得')

  // ④ 全部 done
  const d = roleStateOf([task('t1', 'done'), task('t2', 'done')])
  assert.equal(d.state, 'done')
  assert.equal(d.done, 2)

  // ⑤ done + cancelled：终止但未完成 → 待命，分子仍然是 1（AC-12 口径）
  const e = roleStateOf([task('t1', 'done'), task('t2', 'cancelled')])
  assert.equal(e.state, 'idle')
  assert.equal(e.done, 1)
})

test('roleStateOf：第一个 running 就是当前任务（顺序敏感），用时缺失回落不可得', () => {
  const view = roleStateOf([task('t1', 'running'), task('t2', 'running', DURATION)])
  assert.equal(view.activeTaskId, 't1')
  assert.equal(view.activeTaskTitle, '任务 t1')
  assert.deepEqual(view.duration, { state: 'unavailable', text: '不可得' }, '没有 DurationCell 时不许编 0')

  const second = roleStateOf([task('t1', 'pending'), task('t2', 'running', DURATION), task('t3', 'running')])
  assert.equal(second.activeTaskId, 't2')
  assert.deepEqual(second.duration, DURATION)
})

test('ROLE_STATE_TEXT / ROLE_STATE_TONE：5 态各有文案与 tone，且不含空串', () => {
  const kinds: RoleStateKind[] = ['running', 'waiting_gate', 'needs_attention', 'done', 'idle']
  assert.deepEqual(Object.keys(ROLE_STATE_TEXT).sort(), [...kinds].sort())
  assert.deepEqual(Object.keys(ROLE_STATE_TONE).sort(), [...kinds].sort())
  for (const kind of kinds) {
    assert.equal(ROLE_STATE_TEXT[kind].length > 0, true, `${kind} 缺中文文案`)
    assert.equal(ROLE_STATE_TONE[kind].length > 0, true, `${kind} 缺 tone`)
  }
  // AC-9：宿主与客户端逐字相等的前提是只有这一张表
  assert.equal(ROLE_STATE_TEXT.running, '执行中')
  assert.equal(ROLE_STATE_TEXT.waiting_gate, '待验收')
  assert.equal(ROLE_STATE_TEXT.needs_attention, '需处理')
  assert.equal(ROLE_STATE_TEXT.done, '已完成')
  assert.equal(ROLE_STATE_TEXT.idle, '待命')
})

// ── 角色用量合计：唯一口径（QA D2 / AC-8 / AC-9 / AC-17） ──────────────────────
const provider = (total: number, input?: number, output?: number): UsageCell => {
  const tokens = { total } as { total: number; input?: number; output?: number }
  if (input !== undefined) tokens.input = input
  if (output !== undefined) tokens.output = output
  return { source: 'provider', tokens }
}
const MISSING_EVENT: UsageCell = { source: 'unavailable', reason: '该任务还没有用量事件' }

function detail(
  id: string,
  roleId: string,
  roleName: string,
  status: TaskStatus,
  usage: UsageCell,
): TaskDetailView {
  return {
    id,
    title: `任务 ${id}`,
    roleId,
    roleName,
    status,
    dependsOn: [],
    acceptance: 'true',
    usage,
    duration: { state: 'not-started', text: '未开始' },
    messageCount: 0,
  }
}

const role = (id: string, name: string): Role => ({
  id,
  name,
  duty: `${name}职责`,
  skillIds: [],
  builtin: true,
  updatedAt: 0,
})

const ROLES: Role[] = [
  role('dev', '全栈工程师'),
  role('qa', 'QA 测试工程师'),
  role('ops', '运维'),
]

/** 三种真实混合态：都有数字 / 部分缺失 / 全部缺失。 */
const PARITY_TASKS: TaskDetailView[] = [
  detail('t1', 'dev', '全栈工程师', 'done', provider(1200, 1000, 200)),
  detail('t2', 'dev', '全栈工程师', 'running', provider(300, 250, 50)),
  detail('t3', 'qa', 'QA 测试工程师', 'gate', provider(80)),
  detail('t4', 'qa', 'QA 测试工程师', 'rework', MISSING_EVENT),
  detail('t5', 'ops', '运维', 'failed', MISSING_EVENT),
  detail('t6', 'ops', '运维', 'cancelled', MISSING_EVENT),
]

test('roleUsageCellOf：全有才合计，部分缺失不显示被低估的合计（QA D2 口径）', () => {
  assert.deepEqual(roleUsageCellOf([provider(1200, 1000, 200), provider(300, 250, 50)]), {
    source: 'provider',
    tokens: { total: 1500, input: 1250, output: 250 },
  })
  assert.deepEqual(roleUsageCellOf([provider(80), MISSING_EVENT]), {
    source: 'unavailable',
    reason: ROLE_USAGE_PARTIAL,
  })
  assert.deepEqual(roleUsageCellOf([MISSING_EVENT, MISSING_EVENT]), {
    source: 'unavailable',
    reason: ROLE_USAGE_MISSING,
  })
  // provider 但 tokens 缺失 = 没有可用数字，不能当 0 加进去
  assert.deepEqual(roleUsageCellOf([provider(80), { source: 'provider' }]), {
    source: 'unavailable',
    reason: ROLE_USAGE_PARTIAL,
  })
  assert.deepEqual(roleUsageCellOf([]), { source: 'unavailable', reason: ROLE_USAGE_MISSING })
  assert.equal(ROLE_USAGE_MISSING, '该角色没有可用用量事件')
  assert.equal(ROLE_USAGE_PARTIAL, '部分任务没有可用用量事件')
})

test('宿主 rolesOf 与客户端 roleUsageOf 逐字段相等（AC-9/AC-17 的构造性保证）', () => {
  const host = rolesOf(PARITY_TASKS)
  const client = roleUsageOf(PARITY_TASKS, ROLES)
  assert.deepEqual(client.map((row) => row.roleId), host.map((row) => row.roleId))
  assert.equal(host.length, 3)
  assert.deepEqual(client, host)

  // 可见文本（RoleCard 的 data-role-usage）也必须逐字相等，且部分缺失说的是「不可得」
  const textOf = (row: { usage: UsageCell }): string =>
    row.usage.source === 'provider' && row.usage.tokens ? String(row.usage.tokens.total) : '不可得'
  assert.deepEqual(client.map(textOf), host.map(textOf))
  assert.deepEqual(host.map(textOf), ['1500', '不可得', '不可得'])
  assert.equal(host[1]?.usage.reason, ROLE_USAGE_PARTIAL)
  assert.equal(host[2]?.usage.reason, ROLE_USAGE_MISSING)

  // 六个派生量仍然来自 roleStateOf（宿主侧同名结果必须与纯函数一致）
  for (const row of host) {
    const tasks = PARITY_TASKS.filter((item) => item.roleId === row.roleId)
    const expected = roleStateOf(tasks)
    assert.equal(row.done, expected.done)
    assert.equal(row.state, expected.state)
    assert.equal(row.stateText, expected.stateText)
    assert.deepEqual(row.duration, expected.duration)
  }
})
