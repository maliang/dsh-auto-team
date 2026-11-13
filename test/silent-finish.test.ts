/**
 * r33「待回执」单测：判定 / 幂等落盘 / 两路触发（事件用 recordSilentFinish 直接验，
 * 轮询用 reconcileMembers 验）/ 通知恰一条 / 离开 running 即清除 / 快照布尔投影。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GateEvidence, MemberBinding, Plan, PlanTask } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, cancelResidualTasks, type RunState } from '../src/host/store.ts'
import { applyReceipt } from '../src/host/team/dispatch.ts'
import { revisePlan } from '../src/host/plan/plan.ts'
import {
  awaitingReceiptOf,
  isSilentFinish,
  panelTaskViewOf,
  silentFinishBodyOf,
  withSilentFinish,
  withoutSilentFinish,
} from '../src/host/team/silent-finish.ts'
import { reconcileMembers, recordSilentFinish, type HostMember } from '../src/host/team/watcher.ts'

const NOW = 1_700_000_000_000

function taskOf(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'pnpm typecheck',
    status: 'running',
    memberId: `m-${id}`,
    ...overrides,
  }
}

function bindingOf(taskId: string, name = `dev-${taskId}`, memberId = `m-${taskId}`): MemberBinding {
  return { taskId, roleId: 'dev', memberId, name, spawnedAt: NOW }
}

function planOf(tasks: PlanTask[]): Plan {
  return { runId: 'run-1', sessionId: 'session-1', createdAt: NOW, status: 'dispatching', tasks, maxConcurrent: 3 }
}

function stateOf(tasks: PlanTask[], bindings: MemberBinding[] = []): RunState {
  return { version: RUN_STATE_VERSION, plan: planOf(tasks), plannedAt: NOW, messages: [], bindings, routeAudits: [] }
}

function evidenceOf(): GateEvidence {
  return { taskId: 't1', command: 'exit 0', exitCode: 0, tail: '', artifacts: [], at: NOW }
}

const silentMessages = (state: RunState): number =>
  state.messages.filter((message) => /已结束本轮但未提交回执/.test(message.body)).length

test('isSilentFinish：running + 未退休绑定 + 成员已停 + 无证据 才命中', () => {
  const task = taskOf('t1')
  const binding = bindingOf('t1')

  assert.equal(isSilentFinish({ task, binding, memberStopped: true }), true, '四个条件齐了必须命中')
  assert.equal(isSilentFinish({ task, binding, memberStopped: false }), false, '两路信号都没有 → 不猜')
  assert.equal(isSilentFinish({ task, binding: undefined, memberStopped: true }), false, '没有绑定就不知道是谁停了')
  assert.equal(isSilentFinish({ task, binding: { ...binding, retired: true }, memberStopped: true }), false, '已退休绑定不算')
  assert.equal(isSilentFinish({ task, binding: bindingOf('t2'), memberStopped: true }), false, '绑定必须属于该任务')
  assert.equal(isSilentFinish({ task: withStatus(task, 'gate'), binding, memberStopped: true }), false, '只有 running 才算')
  assert.equal(
    isSilentFinish({ task: { ...task, evidence: evidenceOf() }, binding, memberStopped: true }),
    false,
    '已有门禁证据 → 不是「没交回执」',
  )
})

/** 只换状态、其余保持的小工具（避免测试里重复写 7 个字段）。 */
function withStatus(task: PlanTask, status: PlanTask['status']): PlanTask {
  return { ...task, status }
}

test('withSilentFinish 幂等：不刷新 at / memberId；withoutSilentFinish 彻底删键', () => {
  const task = taskOf('t1')
  assert.equal(awaitingReceiptOf(task), false)

  const marked = withSilentFinish(task, NOW, 'm-t1')
  assert.deepEqual(marked.silentFinish, { at: NOW, memberId: 'm-t1' })
  assert.equal(awaitingReceiptOf(marked), true)

  const again = withSilentFinish(marked, NOW + 60_000, 'other')
  assert.equal(again, marked, '已有标记时必须原样返回（同一引用，不刷新 at）')
  assert.deepEqual(again.silentFinish, { at: NOW, memberId: 'm-t1' })

  const cleared = withoutSilentFinish(marked)
  assert.equal('silentFinish' in cleared, false, '清除必须删键，而不是留一个 undefined')
  assert.equal(awaitingReceiptOf(cleared), false)
  assert.equal(withSilentFinish(cleared, NOW, 'm-t1').silentFinish?.at, NOW)
})

test('silentFinishBodyOf：说清谁停了、哪条任务仍执行中，并给出两条出路', () => {
  const body = silentFinishBodyOf('dev-t1', taskOf('t1'))
  assert.match(body, /成员「dev-t1」已结束本轮但未提交回执/)
  assert.match(body, /任务 t1 仍为执行中/)
  assert.match(body, /auto_team_message/)
  assert.match(body, /auto_team_receipt/)
  // 通知里绝不出现「已完成」这种会误导队长的结论。
  assert.doesNotMatch(body, /已完成/)
})

test('recordSilentFinish：事件路径记事实 + 恰一条 captain→user 消息（带 taskId）', () => {
  const state = stateOf([taskOf('t1')], [bindingOf('t1')])
  const next = recordSilentFinish(state, { taskId: 't1', memberId: 'm-t1', memberName: 'dev-t1', at: NOW })

  assert.notEqual(next, state, '有事实落盘必须换引用（调用方据此 save）')
  assert.deepEqual(next.plan.tasks[0]?.silentFinish, { at: NOW, memberId: 'm-t1' })
  // 只记事实：不写 done、不改任务状态（不自动完成/返工）。
  assert.equal(next.plan.tasks[0]?.status, 'running')
  assert.equal(next.plan.tasks[0]?.evidence, undefined)

  assert.equal(next.messages.length, 1, '通知恰一条')
  const message = next.messages[0]!
  assert.equal(message.from, 'captain')
  assert.equal(message.to, 'user')
  assert.equal(message.taskId, 't1')
  assert.match(message.body, /已结束本轮但未提交回执/)
})

test('recordSilentFinish：重复呼叫不重复写消息，也不刷新 at', () => {
  const state = stateOf([taskOf('t1')], [bindingOf('t1')])
  const first = recordSilentFinish(state, { taskId: 't1', memberId: 'm-t1', memberName: 'dev-t1', at: NOW })
  const replay = recordSilentFinish(first, { taskId: 't1', memberId: 'm-t1', memberName: 'dev-t1', at: NOW + 5000 })

  assert.equal(replay, first, '幂等：第二次必须原样返回')
  assert.equal(replay.messages.length, 1)
  assert.equal(replay.plan.tasks[0]?.silentFinish?.at, NOW)
})

test('recordSilentFinish：任务不在 running 或已有证据时一律不写（不猜）', () => {
  for (const task of [
    taskOf('t1', { status: 'interrupted' }),
    taskOf('t1', { status: 'done' }),
    taskOf('t1', { evidence: evidenceOf() }),
  ]) {
    const state = stateOf([task], [bindingOf('t1')])
    const next = recordSilentFinish(state, { taskId: 't1', memberId: 'm-t1', memberName: 'dev-t1', at: NOW })
    assert.equal(next, state, `status=${task.status} evidence=${String(task.evidence !== undefined)} 时不得落盘`)
    assert.equal(next.messages.length, 0)
  }
})

test('reconcileMembers（轮询路）：宿主归一 inactive → 记待回执 + 一条通知；第二次对账不重复', () => {
  const state = stateOf([taskOf('t1')], [bindingOf('t1')])
  const dead: HostMember[] = [{ id: 'm-t1', name: 'dev-t1', status: 'inactive' }]

  const once = reconcileMembers(state, dead, NOW)
  assert.deepEqual(once.state.plan.tasks[0]?.silentFinish, { at: NOW, memberId: 'm-t1' })
  assert.equal(silentMessages(once.state), 1, '轮询路必须也能判出来（事件源降级时的兜底）')
  // 既有对账语义不被替换：任务仍按原规则转 interrupted。
  assert.equal(once.state.plan.tasks[0]?.status, 'interrupted')

  const twice = reconcileMembers(once.state, dead, NOW + 60_000)
  assert.equal(silentMessages(twice.state), 1, '已记过就不再写第二条')
  assert.equal(twice.state.plan.tasks[0]?.silentFinish?.at, NOW, 'at 不被轮询刷新')
})

test('reconcileMembers（轮询路）：成员活着 → 不写待回执（不误报）', () => {
  const state = stateOf([taskOf('t1')], [bindingOf('t1')])
  const alive: HostMember[] = [{ id: 'm-t1', name: 'dev-t1', status: 'running' }]

  const result = reconcileMembers(state, alive, NOW)
  assert.equal(result.state.plan.tasks[0]?.silentFinish, undefined)
  assert.equal(result.changed, 0)
  assert.equal(result.state.messages.length, 0)
})

test('applyReceipt：回执落在任务上即清掉 silentFinish（done / rework 两条都验）', () => {
  const base = stateOf([{ ...taskOf('t1'), silentFinish: { at: NOW, memberId: 'm-t1' } }], [bindingOf('t1')])

  const done = applyReceipt(base, 't1', { verdict: 'done', evidence: evidenceOf() }, NOW + 1000)
  assert.equal(done.plan.tasks[0]?.status, 'done')
  assert.equal('silentFinish' in done.plan.tasks[0]!, false, '完成后待回执事实必须消失')

  const rework = applyReceipt(base, 't1', { verdict: 'rework', evidence: evidenceOf() }, NOW + 1000)
  assert.equal(rework.plan.tasks[0]?.status, 'rework')
  assert.equal('silentFinish' in rework.plan.tasks[0]!, false, '返工同样离开 running')
})

test('计划收口 / 需求修订作废：终态任务不残留待回执', () => {
  const state = stateOf([{ ...taskOf('t1'), silentFinish: { at: NOW, memberId: 'm-t1' } }], [bindingOf('t1')])
  const residual = cancelResidualTasks(state, NOW + 1000, '测试收口')
  assert.equal(residual.tasks[0]?.status, 'cancelled')
  assert.equal('silentFinish' in residual.tasks[0]!, false)

  const revised = revisePlan(planOf([{ ...taskOf('t1'), silentFinish: { at: NOW, memberId: 'm-t1' } }]), {
    cancelledTaskIds: ['t1'],
    changeSummary: '换需求',
  }, NOW + 1000)
  assert.equal(revised.ok, true)
  if (!revised.ok) return
  const cancelled = revised.plan.tasks.find((task) => task.id === 't1')!
  assert.equal(cancelled.status, 'cancelled')
  assert.equal('silentFinish' in cancelled, false)
})

test('panelTaskViewOf：awaitingReceipt 由宿主算好（快照/状态行直接用，客户端不推）', () => {
  const waiting = panelTaskViewOf({ ...taskOf('t1'), silentFinish: { at: NOW, memberId: 'm-t1' } })
  assert.equal(waiting.awaitingReceipt, true)
  assert.deepEqual(waiting.silentFinish, { at: NOW, memberId: 'm-t1' }, '原始事实必须原样带出')

  const plain = panelTaskViewOf(taskOf('t2', { status: 'ready' }))
  assert.equal(plain.awaitingReceipt, false)
})
