/**
 * r53 QA 回归：**已结束 run 的成员跳转入口**。
 *
 * 背景（用户可见 bug 族）：历史 run 过去整体把 `onJump` 置空，「子智能体」按钮/角色标记/
 * 流程节点直接消失；r53 改为「入口保留、判定区分『已结束』与『未派发』」。
 *
 * 本文件锁三条承诺，每条都对应一处可回退的实现点：
 *  ① 结束 run + 当前快照无该成员 → 任务/角色/节点三入口 `available=false`，
 *     actionText = `子智能体 · 不可跳转`、reason/title 逐字 = 「该运行已结束，子智能体会话已回收」；
 *  ② 结束 run 但成员仍在快照里（命中 taskId）→ 照常可跳，`memberId` 原样下发；
 *  ③ 没传 `closedRun` 的未派发任务仍说原来的「未派发」；写操作 `onTaskAction` 仍只在当前 run 提供。
 *
 * 断言有效性：把 `memberJumpViewOf` 的 closed 分支删掉 → ① 红；把 `onJump` 改回
 * `historicalRunId === null ? jumpToMember : undefined` → ④ 红；把 `closedRun` 透传删掉 → ④ 红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MemberView } from '../src/shared/types.ts'
import {
  MEMBER_JUMP_CLOSED_RUN_REASON,
  MEMBER_JUMP_CLOSED_RUN_TEXT,
  MEMBER_JUMP_NO_MEMBER_REASON,
  MEMBER_JUMP_NO_MEMBER_ROLE_REASON,
  MEMBER_JUMP_NO_MEMBER_TEXT,
  MEMBER_JUMP_NO_ROLE_REASON,
  memberJumpOf,
} from '../src/client/viewmodel.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 去掉注释再断言源码钩子（注释里出现关键词不算实现）。 */
function codeOf(rel: string): string {
  const source = readFileSync(join(ROOT, rel), 'utf8')
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

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

/* ───────────────── ① 结束 run + 无成员：三入口同源给「已回收」 ───────────────── */

test('r53 ① 结束 run + members=[]：任务/角色/节点三入口都不可跳，文案与原因逐字', () => {
  const base = { closedRun: true } as const
  const cases = [
    { name: 'task', source: { kind: 'task', roleId: 'dev', taskId: 't1' } as const },
    { name: 'role', source: { kind: 'role', roleId: 'dev', taskId: 't1' } as const },
    { name: 'node', source: { kind: 'node', roleId: 'dev', taskId: 't1' } as const },
  ]
  for (const { name, source } of cases) {
    const jump = memberJumpOf(source, [], base)
    assert.equal(jump.available, false, `${name}：结束 run 无成员必须不可跳`)
    assert.equal(jump.memberId, undefined, `${name}：不可跳时不得下发 memberId`)
    assert.equal(jump.actionText, MEMBER_JUMP_CLOSED_RUN_TEXT, `${name}：可见文案必须是「不可跳转」`)
    assert.equal(jump.reason, MEMBER_JUMP_CLOSED_RUN_REASON, `${name}：原因必须逐字为已回收`)
    // 没有入口自有 title/label 时，两者都回退到原因 —— 绝不空串。
    assert.equal(jump.title, MEMBER_JUMP_CLOSED_RUN_REASON, `${name}：title 未给时用原因兜底`)
    assert.equal(jump.label, MEMBER_JUMP_CLOSED_RUN_REASON, `${name}：label 未给时用原因兜底`)
  }
})

test('r53 ① 入口自带 title/label 时，已回收原因仍追加在后面（点击前就能看到）', () => {
  const jump = memberJumpOf(
    { kind: 'task', roleId: 'dev', taskId: 't1' },
    [],
    { closedRun: true, title: '任务一', label: '任务 t1' },
  )
  assert.equal(jump.available, false)
  assert.equal(jump.title, `任务一 · ${MEMBER_JUMP_CLOSED_RUN_REASON}`)
  assert.equal(jump.label, `任务 t1，${MEMBER_JUMP_CLOSED_RUN_REASON}`)
})

/* ───────────────── ② 结束 run 但成员还活着：照常可跳 ───────────────── */

test('r53 ② 结束 run 但成员仍在快照里：三入口照常可跳、memberId 原样', () => {
  const live = memberOf({ memberId: 'm-live', roleId: 'dev', taskId: 't1', taskIds: ['t1'] })
  const cases = [
    { name: 'task', source: { kind: 'task', roleId: 'dev', taskId: 't1' } as const },
    { name: 'role', source: { kind: 'role', roleId: 'dev', taskId: 't1' } as const },
    { name: 'node', source: { kind: 'node', roleId: 'dev', taskId: 't1' } as const },
  ]
  for (const { name, source } of cases) {
    const jump = memberJumpOf(source, [live], { closedRun: true })
    assert.equal(jump.available, true, `${name}：成员还活着就必须可跳（closedRun 不改变可跳性）`)
    assert.equal(jump.memberId, 'm-live', `${name}：memberId 必须是命中的成员，不得改写`)
    assert.equal(jump.reason, undefined, `${name}：可跳时不得带原因`)
  }
})

test('r53 ② 成员已停但仍在快照（非 running）：角色卡仍按唯一成员可跳', () => {
  const stopped = memberOf({ memberId: 'm-stop', status: 'interrupted', taskIds: ['t1'] })
  const jump = memberJumpOf({ kind: 'role', roleId: 'dev', taskId: 't1' }, [stopped], { closedRun: true })
  assert.equal(jump.available, true, '快照里找得到成员 = 会话还在，不能因 run 结束就置空')
  assert.equal(jump.memberId, 'm-stop')
})

test('r53 ② 已结束 run 里该任务确实没有成员：说「已回收」，不误报可跳', () => {
  const other = memberOf({ memberId: 'm-other', roleId: 'dev', taskId: 't2', taskIds: ['t2'] })
  const jump = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, [other], { closedRun: true })
  assert.equal(jump.available, false, '同名角色承接别的任务不算命中（r47 语义）')
  assert.equal(jump.actionText, MEMBER_JUMP_CLOSED_RUN_TEXT)
  assert.equal(jump.reason, MEMBER_JUMP_CLOSED_RUN_REASON)
})

/* ───────────────── ③ 未传 closedRun：未派发不得被误报为「已结束」 ───────────────── */

test('r53 ③ 未派发（不带 closedRun）仍是原「未派发」文案与原因', () => {
  const task = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, [])
  assert.equal(task.available, false)
  assert.equal(task.actionText, MEMBER_JUMP_NO_MEMBER_TEXT)
  assert.equal(task.reason, MEMBER_JUMP_NO_MEMBER_REASON)

  const role = memberJumpOf({ kind: 'role', roleId: 'dev', taskId: 't1' }, [])
  assert.equal(role.actionText, MEMBER_JUMP_NO_MEMBER_TEXT)
  assert.equal(role.reason, MEMBER_JUMP_NO_MEMBER_ROLE_REASON)
})

test('r53 ③ 节点连角色都没记录：数据缺失优先于「已结束」，原因照旧', () => {
  const jump = memberJumpOf({ kind: 'node', taskId: 't1' }, [], { closedRun: true })
  assert.equal(jump.available, false)
  assert.equal(jump.reason, MEMBER_JUMP_NO_ROLE_REASON, '没角色是数据问题，与 run 是否结束无关')
  assert.equal(jump.actionText, MEMBER_JUMP_NO_MEMBER_TEXT, '不得套用「已回收」文案')
})

/* ───────────────── ④ 接线：历史 run 仍传 onJump，closedRun 透传三入口 ───────────────── */

test('r53 ④ 历史 run 也传 jumpToMember，判定交给 closedRun（不再整体置空）', () => {
  const source = codeOf('src/client/tabs/TasksTab.tsx')
  assert.match(source, /const onJump = jumpToMember/, 'onJump 必须恒为 jumpToMember（含历史 run）')
  assert.equal(
    source.includes('historicalRunId === null ? jumpToMember : undefined'),
    false,
    '不得回退成「历史 run 不传 onJump」',
  )
  assert.match(source, /const closedRun =/, '必须有 closedRun 判定')
  assert.match(source, /isClosedRun\(\{ status: snapshot\.planStatus \?\? 'draft' \}\)/, '当前 run 按宿主收口口径判定')
  assert.equal(
    (source.match(/closedRun=\{closedRun\}/g) ?? []).length,
    3,
    'closedRun 必须透传给角色卡 / 任务行 / 流程图三个入口',
  )
})

test('r53 ④ 写操作仍只在当前 run：历史 run 不渲染暂停/取消', () => {
  const source = codeOf('src/client/tabs/TasksTab.tsx')
  assert.match(source, /const onTaskAction = historicalRunId === null \? runTaskAction : undefined/)
  const table = codeOf('src/client/views/TaskTable.tsx')
  assert.match(table, /onJump !== undefined \? \([\s\S]*?data-task-open-member/, '任务行入口只由 onJump 决定是否渲染')
  assert.match(table, /onTaskAction !== undefined \? \([\s\S]*?data-task-actions/, '动作区只由 onTaskAction 决定是否渲染')
})

test('r53 ④ 任务行 / 角色标记入口仍在：data-task-open-member + data-task-role(role=button)', () => {
  const table = codeOf('src/client/views/TaskTable.tsx')
  assert.match(table, /data-task-open-member/, '「子智能体」按钮必须保留')
  assert.match(table, /data-task-role/, '角色标记必须保留')
  assert.match(table, /role=\{onJump === undefined \? undefined : 'button'\}/, '可跳时角色标记是按钮语义')
  const card = codeOf('src/client/views/RoleCard.tsx')
  assert.match(card, /role=\{onJump === undefined \? undefined : 'button'\}/, '角色卡可跳时是按钮语义')
  assert.match(card, /closedRun=\{props\.closedRun\}/, 'RoleGrid 必须把 closedRun 传给每张角色卡')
})
