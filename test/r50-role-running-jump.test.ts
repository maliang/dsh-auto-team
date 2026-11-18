/**
 * r50 t3 回归：角色卡「有运行中成员就跳最后开启的那个」新语义。
 *
 * 每条断言都先问过「把实现改回错误版本，这条会不会红」：
 *  ① 单运行成员 → 跳它（非运行成员即使 spawnedAt 更晚也不是落点）；
 *  ② 多运行成员 → 三级比较键（t1 定稿）：openedAt desc → lastEventAt desc → memberId asc；
 *     openedAt 由 `openedAtOf` 给出（spawnedAt 优先，缺失/非有限才回退 lastEventAt）；
 *     spawnedAt 有值时 lastEventAt 只在第二级参与，不会被消息前移把落点带去更老的成员；
 *     三级 memberId asc 只为确定性：同一批并列数据每次点都开同一个会话；
 *  ③ stopping / 带 stoppedAt / done 都不算运行中（停止事实位优先于状态字符串）；
 *  ④ 无运行成员时保持 t5 原语义：单成员仍可跳，多成员不可跳且 reason 逐字；
 *  ⑤ 旧快照缺 spawnedAt 时回退 lastEventAt（不能把缺失当 0 / -Infinity 直接判负）；
 *  ⑥ 任务行 / 流程图两个入口仍走 `memberForRole`，不得被角色卡的新规则带跑。
 *
 * ② 的平局契约以 t1 实现为准（src/client/viewmodel.ts:3421 latestOpenedMemberOf）：
 * 一级 spawnedAt 并列 → 二级 lastEventAt 更晚者胜出 → 二级也并列才按 memberId 字典序。
 * 本文件按该三级顺序锁回归，并用两条用例分别钉住二级与三级，避免歧义被静默吞掉。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { MemberView } from '../src/shared/types.ts'
import {
  MEMBER_JUMP_NO_MEMBER_REASON,
  MEMBER_JUMP_NO_ROLE_REASON,
  memberForRole,
  memberJumpOf,
  roleCardJumpOf,
  roleCardMultiMemberReasonOf,
} from '../src/client/viewmodel.ts'

const AT = 1_700_000_000_000

function memberOf(overrides: Partial<MemberView> = {}): MemberView {
  return {
    memberId: 'm1',
    name: '开发-1',
    roleId: 'dev',
    taskId: 't1',
    status: 'running',
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

/* ───────────── ① 单运行成员：跳它，非运行成员再「新」也不抢 ───────────── */

test('t3 ① 单个运行中成员：角色卡直接跳它，非运行成员即使 spawnedAt/lastEventAt 更晚也不抢', () => {
  const idle = memberOf({
    memberId: 'm-idle',
    name: '开发-1',
    taskId: 't1',
    status: 'idle',
    spawnedAt: AT + 9_000,
    lastEventAt: AT + 9_000,
  })
  const running = memberOf({
    memberId: 'm-run',
    name: '开发-2',
    taskId: 't2',
    status: 'running',
    spawnedAt: AT + 2_000,
    lastEventAt: AT + 2_000,
  })

  const jump = roleCardJumpOf(
    { kind: 'role', roleId: 'dev', taskId: 't2' },
    [idle, running],
    { label: '角色：开发', taskTitle: '登录页开发' },
  )
  assert.equal(jump.available, true, '有运行中成员时角色卡必须可跳')
  assert.equal(jump.memberId, 'm-run', '只有运行中的 m-run 是活会话，不能按 spawnedAt 把 idle 顶上')
  assert.equal(jump.member?.memberId, 'm-run', 'member 必须与 memberId 同源，供卡片 chip 复用')
  assert.match(jump.actionText, /正在运行/, '按钮文案必须先说清点开的是正在运行的成员')
  assert.match(jump.actionText, /登录页开发/, '按钮文案要带任务名')
  assert.match(jump.title, /正在运行/)
  assert.match(jump.label, /^角色：开发，.*正在运行$/)

  // role 分支必须继续转调同一个判定，否则组件侧与这里会漂移出第二套规则。
  assert.deepEqual(
    memberJumpOf({ kind: 'role', roleId: 'dev' }, [idle, running]),
    roleCardJumpOf({ kind: 'role', roleId: 'dev' }, [idle, running]),
  )
})

/* ───────────── ② 多运行成员：三级键 openedAt desc → lastEventAt desc → memberId asc ───────────── */

test('t3 ② 多个运行中成员：spawnedAt 最大者胜出，不被更晚的 lastEventAt 前移带走', () => {
  const older = memberOf({
    memberId: 'm-old',
    name: '开发-1',
    taskId: 't1',
    status: 'running',
    spawnedAt: AT + 1_000,
    lastEventAt: AT + 9_000, // 消息/证据把「最近活跃」推后：旧实现会选它。
  })
  const newer = memberOf({
    memberId: 'm-new',
    name: '开发-2',
    taskId: 't2',
    status: 'running',
    spawnedAt: AT + 2_000,
    lastEventAt: AT + 2_000,
  })

  assert.equal(roleJump([older, newer]).memberId, 'm-new', '最后开启 = spawnedAt 最大，不能按 lastEventAt 挑')
  assert.equal(roleJump([newer, older]).memberId, 'm-new', '入参顺序不得影响落点')
})

test('t3 ② 三级顺序：spawnedAt 与 lastEventAt 都相同 → memberId 字典序最小，任意乱序同结果', () => {
  const c = memberOf({ memberId: 'm-c', name: '开发-c', taskId: 't3', spawnedAt: AT + 3_000, lastEventAt: AT + 3_000 })
  const b = memberOf({ memberId: 'm-b', name: '开发-b', taskId: 't2', spawnedAt: AT + 3_000, lastEventAt: AT + 3_000 })
  const a = memberOf({ memberId: 'm-a', name: '开发-a', taskId: 't1', spawnedAt: AT + 3_000, lastEventAt: AT + 3_000 })

  // 一级、二级全部并列：落点只能由三级 memberId asc 决定，与谁排在最前无关。
  assert.equal(roleJump([c, b, a]).memberId, 'm-a', '时间完全并列时必须每次打开同一个会话（字典序最小）')
  assert.equal(roleJump([a, c, b]).memberId, 'm-a', '反序 / 交错输入也必须得到同一落点，不能取列表首元素')
})

test('t3 ② 二级键：spawnedAt 相同但 lastEventAt 不同 → 最近活动更晚者胜出（不再按 memberId 兜底）', () => {
  const a = memberOf({ memberId: 'm-a', name: '开发-a', taskId: 't1', spawnedAt: AT, lastEventAt: AT })
  const b = memberOf({ memberId: 'm-b', name: '开发-b', taskId: 't2', spawnedAt: AT, lastEventAt: AT + 8_000 })

  // t1 三级键：一级 spawnedAt 并列 → 二级 lastEventAt desc 生效，m-b 胜出。
  // 断言必须对错误实现敏感：若退回「spawnedAt 并列直接按 memberId」，这里会错误打开 m-a。
  assert.equal(roleJump([a, b]).memberId, 'm-b', '一级并列时比较 lastEventAt，最近还有活动的 m-b 胜出')
  assert.equal(roleJump([b, a]).memberId, 'm-b', '反序输入也必须得到同一落点')
})

/* ───────────── ③ stopping / stoppedAt / done 不算运行中 ───────────── */

test('t3 ③ stopping、带 stoppedAt、done 的成员都不算运行中：只选真正的 running 成员', () => {
  const done = memberOf({ memberId: 'm-done', status: 'done', spawnedAt: AT + 7_000, lastEventAt: AT + 7_000 })
  const stopping = memberOf({ memberId: 'm-stopping', status: 'stopping', spawnedAt: AT + 6_000, lastEventAt: AT + 6_000 })
  const stopped = memberOf({
    memberId: 'm-stopped',
    status: 'stopped',
    spawnedAt: AT + 5_000,
    stoppedAt: AT + 5_500,
    lastEventAt: AT + 5_500,
  })
  // 旧快照残留：状态字符串仍是 running，但宿主已落下停止事实位。
  const ghost = memberOf({
    memberId: 'm-ghost',
    status: 'running',
    spawnedAt: AT + 8_000,
    stoppedAt: AT + 8_500,
    lastEventAt: AT + 8_500,
  })
  const live = memberOf({ memberId: 'm-live', status: 'running', spawnedAt: AT + 1_000, lastEventAt: AT + 1_000 })

  assert.equal(
    roleJump([done, stopping, stopped, ghost, live]).memberId,
    'm-live',
    '三个停止形态的 spawnedAt 都比 live 晚；任何一个被算作运行中都会选错',
  )
})

test('t3 ③ 无真运行成员时按非运行路径：一个 running+stoppedAt + 一个 idle → 多人歧义不跳', () => {
  const ghost = memberOf({ memberId: 'm-ghost', status: 'running', spawnedAt: AT + 8_000, stoppedAt: AT + 9_000 })
  const idle = memberOf({ memberId: 'm-idle', status: 'idle', spawnedAt: AT + 1_000 })
  const jump = roleJump([ghost, idle])

  assert.equal(jump.available, false, '停止事实位优先于状态字符串，不能把已停成员当活人')
  assert.equal(jump.memberId, undefined)
  assert.equal(jump.reason, '该角色有 2 个子智能体，请从任务行进入')
})

/* ───────────── ④ 无运行成员：单成员仍跳，多成员不可跳且 reason 逐字 ───────────── */

test('t3 ④ 无运行且单成员：仍可跳（t5 原语义），文案不得冒充「正在运行」', () => {
  const only = memberOf({ memberId: 'm-only', status: 'idle', taskId: 't1' })
  const jump = roleJump([only], { taskId: 't1' })

  assert.equal(jump.available, true, '单成员即使没在跑也要能打开会话')
  assert.equal(jump.memberId, 'm-only')
  assert.equal(jump.actionText.includes('正在运行'), false, '非运行成员不能复用运行中的文案')
  assert.equal(jump.title.includes('正在运行'), false)
})

test('t3 ④ 无运行且多成员：不可跳，reason 逐字为「该角色有 N 个子智能体，请从任务行进入」', () => {
  const a = memberOf({ memberId: 'm-a', status: 'done', spawnedAt: AT })
  const b = memberOf({ memberId: 'm-b', status: 'idle', spawnedAt: AT + 1_000 })
  const jump = roleJump([a, b])

  assert.equal(jump.available, false, '没有活人可开时仍不得按 roleId 猜一个')
  assert.equal(jump.memberId, undefined)
  assert.equal(jump.reason, '该角色有 2 个子智能体，请从任务行进入', 'reason 必须逐字，不能只断言与函数相等')
  assert.equal(jump.reason, roleCardMultiMemberReasonOf(2))
  assert.equal(jump.actionText, '子智能体 · 2 个')
  assert.equal(jump.title, '该角色有 2 个子智能体，请从任务行进入', '无 base.title 时 title 就是原因')
  assert.equal(jump.label, '角色：开发，该角色有 2 个子智能体，请从任务行进入', 'base.label 与原因合并，不是互相覆盖')
})

/* ───────────── ⑤ 缺 spawnedAt 的旧快照回退 lastEventAt ───────────── */

test('t3 ⑤ 缺 spawnedAt 的旧快照回退 lastEventAt：活动更晚的老成员胜出', () => {
  const legacy = memberOf({ memberId: 'm-legacy', status: 'running', lastEventAt: AT + 5_000 }) // 无 spawnedAt 键
  const spawned = memberOf({
    memberId: 'm-spawned',
    status: 'running',
    spawnedAt: AT + 1_000,
    lastEventAt: AT + 1_000,
  })

  assert.equal('spawnedAt' in legacy, false, '夹具前提：旧快照没有 spawnedAt 这个事实')
  assert.equal(
    roleJump([spawned, legacy]).memberId,
    'm-legacy',
    '缺 spawnedAt 时用 lastEventAt 当「最后开启」的近似，不能把缺失当 -Infinity 直接判负',
  )
})

test('t3 ⑤ spawnedAt 不是有限数时按缺失处理，回退 lastEventAt（NaN / Infinity）', () => {
  const nan = memberOf({ memberId: 'm-nan', status: 'running', spawnedAt: Number.NaN, lastEventAt: AT + 7_000 })
  const finite = memberOf({ memberId: 'm-finite', status: 'running', spawnedAt: AT + 1_000, lastEventAt: AT + 1_000 })
  assert.equal(roleJump([finite, nan]).memberId, 'm-nan', 'NaN 不是有效任命时刻，必须回退 lastEventAt')

  const infinite = memberOf({
    memberId: 'm-inf',
    status: 'running',
    spawnedAt: Number.POSITIVE_INFINITY,
    lastEventAt: AT + 7_000,
  })
  assert.equal(roleJump([finite, infinite]).memberId, 'm-inf', 'Infinity 同样不是有效时刻，回退 lastEventAt')
})

/* ───────────── ⑥ 任务行 / 流程图入口不变（memberForRole 语义未被改动） ───────────── */

test('t3 ⑥ 任务行与流程图仍按 taskId 定位，不采用角色卡的「最后开启」', () => {
  const t1Owner = memberOf({
    memberId: 'm-old',
    name: '开发-1',
    taskId: 't1',
    taskIds: ['t1'],
    status: 'running',
    spawnedAt: AT + 1_000,
    lastEventAt: AT + 1_000,
  })
  const t2Owner = memberOf({
    memberId: 'm-new',
    name: '开发-2',
    taskId: 't2',
    taskIds: ['t2'],
    status: 'running',
    spawnedAt: AT + 9_000,
    lastEventAt: AT + 9_000,
  })
  const members = [t1Owner, t2Owner]

  // 前提：角色卡确实会选 spawnedAt 最大的 m-new —— 这条只是把两个入口的差异摆出来。
  assert.equal(roleJump(members).memberId, 'm-new')

  const taskJump = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, members, { label: '任务 t1' })
  assert.equal(taskJump.available, true)
  assert.equal(taskJump.memberId, 'm-old', '任务行必须跳到承接 t1 的成员，不能被角色卡的最新成员规则带跑')

  const nodeJump = memberJumpOf({ kind: 'node', roleId: 'dev', taskId: 't1' }, members)
  assert.equal(nodeJump.available, true)
  assert.equal(nodeJump.memberId, 'm-old', '流程图节点与任务行同一判定，行为不变')

  // 任务没有承接成员时，两个入口都不得回退到同角色其它任务的运行成员。
  const missing = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't9' }, members)
  assert.equal(missing.available, false)
  assert.equal(missing.memberId, undefined)
  assert.equal(missing.reason, MEMBER_JUMP_NO_MEMBER_REASON)

  const nodeMissing = memberJumpOf({ kind: 'node', roleId: 'dev', taskId: 't9' }, members)
  assert.equal(nodeMissing.available, false)
  assert.equal(nodeMissing.memberId, undefined)

  // 流程图节点连角色都没记录：给「没有记录角色」的原因，与「无成员」区分开。
  const orphan = memberJumpOf({ kind: 'node', taskId: 't1' }, members)
  assert.equal(orphan.available, false)
  assert.equal(orphan.reason, MEMBER_JUMP_NO_ROLE_REASON)
})

test('t3 ⑥ memberForRole 既有语义未被改动：taskId 归属优先 > running 优先 > 最近活跃 > memberId 字典序', () => {
  const bound = memberOf({ memberId: 'm-bound', taskId: 't1', taskIds: ['t1'], status: 'idle', lastEventAt: AT })
  const running = memberOf({ memberId: 'm-run', taskId: 't2', status: 'running', lastEventAt: AT + 9_000 })
  assert.equal(memberForRole([running, bound], 'dev', 't1')?.memberId, 'm-bound', '明确承接 taskId 的成员优先于 running')
  assert.equal(memberForRole([bound, running], 'dev')?.memberId, 'm-run', '没有 taskId 时 running 优先')
  assert.equal(memberForRole([], 'dev'), undefined, '空列表返回 undefined')
  assert.equal(memberForRole([bound], 'qa'), undefined, '不得跨角色取人')

  const idleOld = memberOf({ memberId: 'm-idle-old', status: 'idle', lastEventAt: AT + 1_000 })
  const idleNew = memberOf({ memberId: 'm-idle-new', status: 'idle', lastEventAt: AT + 2_000 })
  assert.equal(memberForRole([idleOld, idleNew], 'dev')?.memberId, 'm-idle-new', '全非运行时取最近活跃')

  const tieB = memberOf({ memberId: 'm-b', status: 'idle', lastEventAt: AT })
  const tieA = memberOf({ memberId: 'm-a', status: 'idle', lastEventAt: AT })
  assert.equal(memberForRole([tieB, tieA], 'dev')?.memberId, 'm-a', '最近活跃并列时按 memberId 升序稳定取第一个')
})
