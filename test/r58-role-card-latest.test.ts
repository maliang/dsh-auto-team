/**
 * r58 回归：角色卡「只要名下有成员，就跳最后开启者」新语义。
 *
 * 与 r50 的关系：r50 锁的是「有运行中成员」的三级键与停止事实位；本文件补的是**非运行**场景
 * （任务 done 后成员 status 变 done、会话其实还在）以及三入口一致性，避免 r50 的用例被
 * 「运行中优先」这一条遮住，漏掉无运行多成员的回退。
 *
 * 每条断言都先问过「把实现改回旧版（无运行多成员 → 不可跳 + 多人歧义原因）会不会红」：
 *  ① 两个成员都 done → 仍可跳，落点 = spawnedAt 更大者；
 *  ② spawnedAt 并列 → lastEventAt 更晚者；再并列 → memberId 字典序；乱序输入同结果；
 *  ③ 有运行中成员时仍优先运行中，不被 done 但 spawnedAt 更新的成员抢走；
 *  ④ 零成员 → 不可跳，原因分「未派发 / 已结束」两态逐字；closedRun 但成员还在 → 仍可跳；
 *  ⑤ 任务行 / 流程图仍按成员归属（memberForRole）取，不被角色卡的「最后开启」带跑。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { MemberView } from '../src/shared/types.ts'
import {
  MEMBER_JUMP_CLOSED_RUN_REASON,
  MEMBER_JUMP_CLOSED_RUN_TEXT,
  MEMBER_JUMP_NO_MEMBER_REASON,
  MEMBER_JUMP_NO_MEMBER_ROLE_REASON,
  MEMBER_JUMP_NO_MEMBER_TEXT,
  memberJumpOf,
  roleCardJumpOf,
} from '../src/client/viewmodel.ts'

const AT = 1_700_000_000_000

function memberOf(overrides: Partial<MemberView> = {}): MemberView {
  return {
    memberId: 'm1',
    name: '开发-1',
    roleId: 'dev',
    taskId: 't1',
    status: 'done',
    lastEventAt: AT,
    modelRoute: '会话默认',
    canResume: true,
    stalled: false,
    stalledForMs: 0,
    stalledSecondsText: '',
    ...overrides,
  }
}

function roleJump(members: readonly MemberView[], extra: { taskId?: string } = {}) {
  return roleCardJumpOf({ kind: 'role', roleId: 'dev', ...extra }, members, { label: '角色：开发' })
}

/* ───────── ① 两个成员都 done（无运行中）：仍可跳，落点 = spawnedAt 更大者 ───────── */

test('r58 ① 无运行中、两个 done 成员：可跳，落点是 spawnedAt 更大的那个', () => {
  const older = memberOf({
    memberId: 'm-old',
    name: '开发-旧',
    taskId: 't1',
    status: 'done',
    spawnedAt: AT + 1_000,
    lastEventAt: AT + 9_000, // 活动更晚也不得把落点带走：一级键是 openedAt
  })
  const newer = memberOf({
    memberId: 'm-new',
    name: '开发-新',
    taskId: 't2',
    status: 'done',
    spawnedAt: AT + 5_000,
    lastEventAt: AT + 5_000,
  })

  const jump = roleJump([older, newer])
  assert.equal(jump.available, true, '任务 done 后成员会话其实还在，角色卡必须还能直接打开')
  assert.equal(jump.memberId, 'm-new', '落点按 openedAt（spawnedAt）取最大，不被 lastEventAt 前移带走')
  assert.equal(jump.member?.memberId, 'm-new', '成员态 chip 与落点必须是同一个成员')
  assert.equal(jump.reason, undefined, '可跳时不得再给「N 个子智能体，请从任务行进入」')
  assert.equal(jump.actionText.includes('正在运行'), false, '非运行成员不能复用运行中的文案')
  assert.match(jump.label, /^角色：开发，打开子智能体会话：开发-新$/, 'aria-label 走通用 memberJumpViewOf 口径')
})

/* ───────── ② spawnedAt 并列 → lastEventAt 更晚；再并列 → memberId 升序（乱序同结果） ───────── */

test('r58 ② spawnedAt 并列取 lastEventAt 更晚者，不受输入顺序影响', () => {
  const quiet = memberOf({ memberId: 'm-quiet', name: '开发-静', status: 'done', spawnedAt: AT, lastEventAt: AT })
  const active = memberOf({ memberId: 'm-active', name: '开发-活', status: 'idle', spawnedAt: AT, lastEventAt: AT + 5_000 })

  assert.equal(roleJump([quiet, active]).memberId, 'm-active', '一级并列时二级 lastEventAt 更晚者胜出')
  assert.equal(roleJump([active, quiet]).memberId, 'm-active', '输入顺序不得改变落点')
})

test('r58 ② 前两级都并列取 memberId 字典序最小，乱序输入同结果', () => {
  const b = memberOf({ memberId: 'm-b', name: '开发-B', status: 'done', spawnedAt: AT, lastEventAt: AT })
  const a = memberOf({ memberId: 'm-a', name: '开发-A', status: 'done', spawnedAt: AT, lastEventAt: AT })

  assert.equal(roleJump([b, a]).memberId, 'm-a', '三级兜底：memberId 升序，保证每次点开同一个会话')
  assert.equal(roleJump([a, b]).memberId, 'm-a', '乱序输入必须得到同一落点')
  assert.equal(roleJump([b, a]).member?.name, '开发-A')
})

/* ───────── ③ 有运行中成员：仍优先运行中，不被 done 但 spawnedAt 更新的成员抢走 ───────── */

test('r58 ③ 运行中成员优先于 spawnedAt 更新的 done 成员', () => {
  const doneNewer = memberOf({
    memberId: 'm-done-new',
    name: '开发-done',
    taskId: 't2',
    status: 'done',
    spawnedAt: AT + 9_000,
    lastEventAt: AT + 9_000,
  })
  const runningOlder = memberOf({
    memberId: 'm-run',
    name: '开发-跑',
    taskId: 't1',
    status: 'running',
    spawnedAt: AT + 1_000,
    lastEventAt: AT + 1_000,
  })

  const jump = roleJump([doneNewer, runningOlder])
  assert.equal(jump.available, true)
  assert.equal(jump.memberId, 'm-run', '有真运行成员时只看运行中集合，done 成员再新也不抢')
  assert.match(jump.actionText, /正在运行/, '运行中路径的文案必须带「正在运行」')
  assert.match(jump.title ?? '', /正在运行/)
})

/* ───────── ④ 零成员：不可跳，原因分「未派发 / 已结束」两态逐字 ───────── */

test('r58 ④ 该角色零成员：不可跳，原因是「还没有可跳转的成员」而不是多人歧义', () => {
  const jump = roleJump([])
  assert.equal(jump.available, false)
  assert.equal(jump.memberId, undefined, '不可跳时不得下发 memberId')
  assert.equal(jump.reason, MEMBER_JUMP_NO_MEMBER_ROLE_REASON)
  assert.equal(jump.actionText, MEMBER_JUMP_NO_MEMBER_TEXT)
  assert.equal(jump.title, MEMBER_JUMP_NO_MEMBER_ROLE_REASON, '无 base.title 时 title 就是原因')
  assert.equal(jump.label, `角色：开发，${MEMBER_JUMP_NO_MEMBER_ROLE_REASON}`, 'aria-label 与原因合并而不是互相覆盖')
})

test('r58 ④ closedRun 且零成员：原因是「已结束、会话已回收」，文案与未派发区分', () => {
  const jump = roleCardJumpOf({ kind: 'role', roleId: 'dev' }, [], { label: '角色：开发', closedRun: true })
  assert.equal(jump.available, false)
  assert.equal(jump.reason, MEMBER_JUMP_CLOSED_RUN_REASON)
  assert.equal(jump.actionText, MEMBER_JUMP_CLOSED_RUN_TEXT)
  assert.notEqual(jump.reason, MEMBER_JUMP_NO_MEMBER_ROLE_REASON, '已结束 / 未派发必须是两句不同的人话')
})

test('r58 ④ closedRun 但成员仍在名单里：照常可跳，closedRun 只改零成员时的文案', () => {
  const stillThere = memberOf({ memberId: 'm-live', status: 'done', spawnedAt: AT, lastEventAt: AT })
  const jump = roleCardJumpOf({ kind: 'role', roleId: 'dev' }, [stillThere], {
    label: '角色：开发',
    closedRun: true,
  })
  assert.equal(jump.available, true, '成员还在快照里就还能开会话，closedRun 不得一刀切拒绝')
  assert.equal(jump.memberId, 'm-live')
  assert.equal(jump.reason, undefined)
})

/* ───────── ⑤ 三入口一致性：任务行 / 流程图仍按 memberForRole 取，不受角色卡带跑 ───────── */

test('r58 ⑤ 任务行 / 流程图按 taskId 归属取成员，不采用角色卡的「最后开启」', () => {
  // 角色卡会选 m-new（spawnedAt 更大）；但 t1 只属于 m-old，两个 task 入口都不许开 m-new。
  const oldOwner = memberOf({
    memberId: 'm-old',
    name: '开发-旧',
    taskId: 't1',
    taskIds: ['t1'],
    status: 'done',
    spawnedAt: AT + 1_000,
    lastEventAt: AT + 1_000,
  })
  const newOwner = memberOf({
    memberId: 'm-new',
    name: '开发-新',
    taskId: 't2',
    taskIds: ['t2'],
    status: 'done',
    spawnedAt: AT + 9_000,
    lastEventAt: AT + 9_000,
  })
  const members = [newOwner, oldOwner] // 故意把「更新」的放前面

  assert.equal(roleJump(members).memberId, 'm-new', '角色卡：最后开启者')

  const taskJump = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, members)
  assert.equal(taskJump.available, true)
  assert.equal(taskJump.memberId, 'm-old', '任务行：t1 归属 m-old，不得被角色卡的 m-new 带跑')

  const nodeJump = memberJumpOf({ kind: 'node', roleId: 'dev', taskId: 't1' }, members)
  assert.equal(nodeJump.available, true)
  assert.equal(nodeJump.memberId, 'm-old', '流程图节点与任务行同一套归属判定')

  const taskJumpT2 = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't2' }, members)
  assert.equal(taskJumpT2.memberId, 'm-new', '各自任务各归各的成员')

  // 该角色名下没有任何成员承接 t9：两个入口都不得回退到「最后开启」的 m-new。
  const missingTask = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't9' }, members)
  assert.equal(missingTask.available, false, '未派发任务不因同角色有成员就变成可跳')
  assert.equal(missingTask.memberId, undefined)
  assert.equal(missingTask.reason, MEMBER_JUMP_NO_MEMBER_REASON)

  const missingNode = memberJumpOf({ kind: 'node', roleId: 'dev', taskId: 't9' }, members)
  assert.equal(missingNode.available, false)
  assert.equal(missingNode.memberId, undefined)
  assert.equal(missingNode.reason, MEMBER_JUMP_NO_MEMBER_REASON)
})
