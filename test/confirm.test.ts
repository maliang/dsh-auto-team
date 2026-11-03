/**
 * r13 T4：确认闸的纯判定与文案（AC-11 / AC-12 / AC-13）。
 *
 * 这里覆盖的是「弹窗里到底写了什么」：摘要模板是逐字的合同（含影响面数字），
 * 一旦漂移，用户就无法在按下不可逆按钮前判断后果。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MemberBinding, PlanTask } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, RunsStore } from '../src/host/store.ts'
import type { RunState } from '../src/host/store.ts'
import {
  IRREVERSIBLE_ACTIONS,
  confirmSummaryOf,
  isIrreversibleAction,
  pendingFor,
  pendingViewOf,
  waitedTextOf,
} from '../src/host/team/confirm.ts'
import { normalizePending } from '../src/host/store.ts'

const NOW = 1_700_000_000_000

function taskOf(id: string, patch: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'exit 0',
    status: 'pending',
    ...patch,
  }
}

function bindingOf(memberId: string, taskId: string, name = memberId): MemberBinding {
  return { taskId, roleId: 'dev', memberId, name, spawnedAt: NOW }
}

function stateOf(patch: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: {
      runId: 'run-1',
      sessionId: 'sess-1',
      createdAt: NOW,
      status: 'dispatching',
      maxConcurrent: 3,
      tasks: [taskOf('t1'), taskOf('t2')],
    },
    plannedAt: NOW,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...patch,
  }
}

test('IRREVERSIBLE_ACTIONS：恰好 5 类危险动作，其余全部可逆', () => {
  assert.deepEqual(
    [...IRREVERSIBLE_ACTIONS].sort(),
    ['cancel', 'cancelTask', 'forceParallel', 'skipTask', 'updateAcceptance'],
    'AC-11 的 5 类，多一个会让可逆动作也弹窗（AC-12 反面）',
  )
  assert.equal(isIrreversibleAction({ type: 'cancel' }), true)
  assert.equal(isIrreversibleAction({ type: 'cancelTask', taskId: 't1' }), true)
  assert.equal(isIrreversibleAction({ type: 'skipTask', taskId: 't1' }), true)
  assert.equal(isIrreversibleAction({ type: 'updateAcceptance', taskId: 't1', acceptance: 'exit 0' }), true)
  assert.equal(isIrreversibleAction({ type: 'forceParallel', taskId: 't1' }), true)

  for (const action of [
    { type: 'toggle' as const, enabled: true },
    { type: 'pause' as const },
    { type: 'resumeTeam' as const },
    { type: 'dispatch' as const },
    { type: 'message' as const, text: '继续' },
    { type: 'resume' as const, taskId: 't1' },
    { type: 'receipt' as const, taskId: 't1', receipt: { status: 'done' as const } },
    { type: 'setTaskRole' as const, taskId: 't1', roleId: 'dev' },
    { type: 'confirmPending' as const, pendingId: 'p1' },
    { type: 'rejectPending' as const, pendingId: 'p1' },
  ]) {
    assert.equal(isIrreversibleAction(action), false, `${action.type} 必须零弹窗（AC-12）`)
  }
})

test('confirmSummaryOf：终止运行 —— 影响面是「运行中成员数」', () => {
  const state = stateOf({
    plan: {
      runId: 'run-7',
      sessionId: 'sess-1',
      createdAt: NOW,
      status: 'dispatching',
      maxConcurrent: 3,
      tasks: [taskOf('t1', { status: 'running' }), taskOf('t2', { status: 'running' }), taskOf('t3')],
    },
  })
  assert.equal(confirmSummaryOf({ type: 'cancel' }, state), '终止运行 run-7（将中断 2 个运行中成员）')
})

test('confirmSummaryOf：中断成员 —— 有绑定用成员名，没有就写「该任务成员」', () => {
  const state = stateOf({ bindings: [bindingOf('m1', 't1', 'dev-1')] })
  assert.equal(
    confirmSummaryOf({ type: 'cancelTask', taskId: 't1' }, state),
    '中断成员 dev-1（任务 t1）',
  )
  assert.equal(
    confirmSummaryOf({ type: 'cancelTask', taskId: 't2' }, state),
    '中断成员 该任务成员（任务 t2）',
  )
})

test('confirmSummaryOf：跳过任务 —— 只数「仍未终态」的下游', () => {
  const state = stateOf({
    plan: {
      runId: 'run-1',
      sessionId: 'sess-1',
      createdAt: NOW,
      status: 'dispatching',
      maxConcurrent: 3,
      tasks: [
        taskOf('t1', { status: 'pending' }),
        taskOf('t2', { status: 'blocked', dependsOn: ['t1'] }),
        taskOf('t3', { status: 'done', dependsOn: ['t1'] }),
        taskOf('t4', { status: 'pending', dependsOn: ['t2'] }),
      ],
    },
  })
  // t3 已完成不再受影响；跳过 = 「依赖视为满足」，t2 与它的下游 t4 都会在缺产物下继续 → 2
  const summary = confirmSummaryOf({ type: 'skipTask', taskId: 't1' }, state)
  assert.equal(summary, '跳过任务 t1（下游 2 个任务将在缺产物下继续）')
  // D2 永久门禁：影响面方向必须是「继续」，不是「阻塞」（PRD §5.4 行 3）
  assert.ok(!summary.includes('将阻塞'), '跳过的影响面不得写成「阻塞」')
  assert.ok(summary.includes('缺产物下继续'), '必须说明下游将在缺产物下继续')
})

test('confirmSummaryOf：改验收 —— 原验收前 40 字 + 省略号，空验收写「（空）」', () => {
  const long = 'pnpm typecheck && pnpm test && git status --porcelain'
  const state = stateOf({
    plan: {
      runId: 'run-1',
      sessionId: 'sess-1',
      createdAt: NOW,
      status: 'dispatching',
      maxConcurrent: 3,
      tasks: [taskOf('t1', { acceptance: long }), taskOf('t2', { acceptance: '   ' })],
    },
  })
  assert.equal(
    confirmSummaryOf({ type: 'updateAcceptance', taskId: 't1', acceptance: 'exit 0' }, state),
    `重跑任务 t1 的门禁（原验收：${long.slice(0, 40)}…）`,
  )
  assert.equal(
    confirmSummaryOf({ type: 'updateAcceptance', taskId: 't2', acceptance: 'exit 0' }, state),
    '重跑任务 t2 的门禁（原验收：（空））',
  )
})

test('confirmSummaryOf：强制并行 —— 指出写域冲突的占用任务', () => {
  const state = stateOf({
    plan: {
      runId: 'run-1',
      sessionId: 'sess-1',
      createdAt: NOW,
      status: 'dispatching',
      maxConcurrent: 3,
      tasks: [
        taskOf('t1', { status: 'running', writeScopes: ['src/host/bridge.ts'] }),
        taskOf('t2', { status: 'blocked', writeScopes: ['src/host'] }),
      ],
    },
  })
  assert.equal(
    confirmSummaryOf({ type: 'forceParallel', taskId: 't2' }, state),
    '强制并行任务 t2（与 t1 写域冲突）',
  )
  assert.equal(
    confirmSummaryOf({ type: 'forceParallel', taskId: 't3' }, state),
    '强制并行任务 t3（与 其他任务 写域冲突）',
    '没有占用者也要能说清后果',
  )
})

test('pendingFor：单条未决记录的字段与 id 唯一性', () => {
  const state = stateOf({ plan: { ...stateOf().plan, runId: 'run-9' } })
  const one = pendingFor(state, { type: 'cancel' }, NOW)
  const two = pendingFor(state, { type: 'cancel' }, NOW + 1)
  assert.notEqual(one.id, two.id, '不同时刻的待确认不能撞 id（AC-13 靠 id 定位）')
  assert.equal(one.id, `pending-${NOW.toString(36)}-cancel`)
  assert.equal(one.runId, 'run-9')
  assert.equal(one.createdAt, NOW)
  assert.equal(one.irreversible, true)
  assert.equal(one.summary, confirmSummaryOf({ type: 'cancel' }, state))
  assert.equal(one.taskId, undefined, 'run 级动作不带 taskId')

  const skip = pendingFor(state, { type: 'skipTask', taskId: 't2' }, NOW)
  assert.equal(skip.taskId, 't2')
  assert.equal(skip.id, `pending-${NOW.toString(36)}-skipTask`, '同一时刻不同类型也不撞')
})

test('pendingFor → normalizePending 往返：落盘再读回语义不变', () => {
  const state = stateOf({ bindings: [bindingOf('m1', 't1', 'dev-1')] })
  const pending = pendingFor(state, { type: 'cancelTask', taskId: 't1', reason: '需求撤回' }, NOW)
  assert.deepEqual(normalizePending(JSON.parse(JSON.stringify(pending))), pending)
})

test('pendingViewOf：缺席返回 undefined，waitedText 每次按 now 重算', () => {
  assert.equal(pendingViewOf(undefined, NOW), undefined)
  const pending = pendingFor(stateOf(), { type: 'skipTask', taskId: 't2' }, NOW)

  const fresh = pendingViewOf(pending, NOW + 30_000)
  assert.ok(fresh)
  assert.equal(fresh.action, 'skipTask', '视图里只放动作类型字符串，面板据此选按钮文案')
  assert.equal(fresh.taskId, 't2')
  assert.equal(fresh.irreversible, true)
  assert.equal(fresh.summary, pending.summary)
  assert.equal(fresh.waitedText, '刚刚')

  const waited = pendingViewOf(pending, NOW + 3 * 60_000)
  assert.equal(waited?.waitedText, '已等待 3 分', 'AC-13：挂久了要能看出等了多久')
  assert.equal(pendingViewOf(pending, NOW + 61 * 60_000)?.waitedText, '已等待 1 小时 1 分')
})

test('waitedTextOf 由 confirm 再导出，调用方不必多 import 一个模块', () => {
  assert.equal(waitedTextOf(NOW, NOW + 120_000), '已等待 2 分')
})

test('pending 不落进 run 文件之外的地方：RunsStore 保留 pending 与其清空', () => {
  const store = new RunsStore(join(mkdtempSync(join(tmpdir(), 'auto-team-r13-confirm-')), 'runs'))
  const state = stateOf()
  const pending = pendingFor(state, { type: 'cancel' }, NOW)
  store.save({ ...state, pendingConfirmation: pending })
  assert.equal(store.load('run-1')?.pendingConfirmation?.id, pending.id)

  // 确认/取消后必须真的清空，否则重启后弹窗又出现
  store.save({ ...state, pendingConfirmation: undefined })
  assert.equal(store.load('run-1')?.pendingConfirmation, undefined)
})
