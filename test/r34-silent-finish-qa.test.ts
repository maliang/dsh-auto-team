/**
 * r34 QA 补充回归：AC① 的终态矩阵（done/failed/cancelled）+ AC④ 清除后的布尔投影
 * + AC⑥「待回执」与「停滞」同时成立时仍可分辨、徽标只在待回执时出现。
 *
 * 与 `test/silent-finish.test.ts`（t1 自测）分工：那边验实现细节，这边只验**验收口径**，
 * 每条断言都对应任务卡 AC 的一条；删掉实现里对应判据必须变红（见 mutation probes）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { GateEvidence, MemberBinding, MemberView, Plan, PlanTask, TaskDetailView } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, type RunState } from '../src/host/store.ts'
import { applyReceipt } from '../src/host/team/dispatch.ts'
import { isSilentFinish, panelTaskViewOf } from '../src/host/team/silent-finish.ts'
import { memberPageOf } from '../src/client/nav.ts'
import {
  AWAITING_RECEIPT_MEMBER_TEXT,
  AWAITING_RECEIPT_TEXT,
  awaitingReceiptOf,
  awaitingReceiptSummaryOf,
  awaitingReceiptTitleOf,
} from '../src/client/viewmodel.ts'

const NOW = 1_760_000_000_000

function taskOf(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 't1',
    title: '实现待回执',
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'pnpm typecheck',
    status: 'running',
    memberId: 'm-t1',
    ...overrides,
  }
}

function bindingOf(overrides: Partial<MemberBinding> = {}): MemberBinding {
  return { taskId: 't1', roleId: 'dev', memberId: 'm-t1', name: 'dev-t1', spawnedAt: NOW, ...overrides }
}

function evidenceOf(): GateEvidence {
  return { taskId: 't1', command: 'pnpm typecheck', exitCode: 0, tail: 'ok', artifacts: [], at: NOW }
}

function stateOf(tasks: PlanTask[], bindings: MemberBinding[]): RunState {
  const plan: Plan = {
    runId: 'run-r34-qa',
    sessionId: 'sess-r34-qa',
    createdAt: NOW,
    status: 'dispatching',
    tasks,
    maxConcurrent: 3,
  }
  return { version: RUN_STATE_VERSION, plan, plannedAt: NOW, messages: [], bindings, routeAudits: [] }
}

/* ───────────────────────── AC① 终态矩阵 ───────────────────────── */

test('AC① isSilentFinish：任务已 done / failed / cancelled 一律不命中（只有 running 才记观察事实）', () => {
  const binding = bindingOf()
  for (const status of ['done', 'failed', 'cancelled'] as const) {
    assert.equal(
      isSilentFinish({ task: taskOf({ status }), binding, memberStopped: true }),
      false,
      `${status} 不得再写待回执（否则历史任务会凭空长出一条「等回执」）`,
    )
  }
  // 对照：同一份绑定在 running 上必须命中，否则上面的 false 可能只是函数恒 false。
  assert.equal(isSilentFinish({ task: taskOf(), binding, memberStopped: true }), true)
})

/* ───────────────────────── AC④ 清除后的投影 ───────────────────────── */

test('AC④ 回执成功后 silentFinish 消失且 awaitingReceipt 变 false（done 与 rework 两条路）', () => {
  const withFlag = taskOf({ silentFinish: { at: NOW, memberId: 'm-t1' } })
  const base = stateOf([withFlag], [bindingOf()])
  assert.equal(panelTaskViewOf(withFlag).awaitingReceipt, true, '前置：清除前快照布尔必须是 true')

  for (const verdict of ['done', 'rework'] as const) {
    const next = applyReceipt(base, 't1', { verdict, evidence: evidenceOf() }, NOW + 1000)
    const task = next.plan.tasks.find((item) => item.id === 't1')!
    assert.equal(task.silentFinish, undefined, `${verdict} 后不得残留 silentFinish`)
    assert.equal(panelTaskViewOf(task).awaitingReceipt, false, `${verdict} 后快照布尔必须变 false`)
  }
})

/* ───────────────────────── AC⑥ 客户端可分辨性 ───────────────────────── */

function memberOf(overrides: Partial<MemberView> = {}): MemberView {
  return {
    memberId: 'm-t1',
    name: '成员甲',
    roleId: 'dev',
    taskId: 't1',
    status: 'running',
    lastEventAt: NOW,
    modelRoute: 'deepseek-v4.1',
    canResume: true,
    stalled: false,
    stalledForMs: 0,
    stalledSecondsText: '',
    ...overrides,
  }
}

function taskDetailOf(overrides: Partial<TaskDetailView> = {}): TaskDetailView {
  return {
    id: 't1',
    title: '实现待回执',
    roleId: 'dev',
    roleName: '高级全栈工程师',
    status: 'running',
    dependsOn: [],
    acceptance: 'pnpm typecheck',
    writeScopes: ['src/host/team/silent-finish.ts'],
    usage: { source: 'unavailable', reason: '无用量' },
    duration: { text: '不可得', state: 'unavailable' },
    messageCount: 0,
    ...overrides,
  }
}

test('AC⑥ 待回执与停滞同时成立：两条文案都在、但互不包含，用户能分辨「停了」和「慢了」', () => {
  const view = memberPageOf({
    member: memberOf({ stalled: true, stalledSecondsText: '3 分 20 秒' }),
    task: { ...taskDetailOf(), silentFinish: { at: NOW, memberId: 'm-t1' } },
  })
  assert.equal(view.stalled, true, '停滞黄条仍在（成员还活着但没产出）')
  assert.match(view.stalledText, /3 分 20 秒/)
  assert.ok(view.awaitingReceipt, '待回执标记也必须出现（本轮已结束）')
  assert.equal(view.awaitingReceipt?.text, AWAITING_RECEIPT_MEMBER_TEXT, '成员页用「本轮已结束 · 待回执」，与任务行短标区分')
  // 两者是不同事实：文案不得互相包含，否则用户只看到一句话、分不清到底哪个是真的。
  assert.equal(view.stalledText.includes(AWAITING_RECEIPT_TEXT), false)
  assert.equal(view.awaitingReceipt!.text.includes('停滞'), false)
  // title 必须说原因，且不借用停滞措辞。
  assert.match(view.awaitingReceipt!.title, /未提交回执/)
  assert.match(view.awaitingReceipt!.title, /auto_team_receipt/)
  assert.equal(view.awaitingReceipt!.title.includes('疑似停滞'), false)
  assert.equal(view.awaitingReceipt!.title.includes('无实质工具调用'), false)
})

test('AC⑥ 徽标只在待回执时出现：没有 silentFinish 的任务行/汇总一律不出现', () => {
  // 任务行与详情面板的附加标记（不在组件里拼文案，统一走 viewmodel）。
  assert.equal(awaitingReceiptOf(taskDetailOf()), false)
  assert.equal(awaitingReceiptSummaryOf([taskDetailOf(), taskDetailOf({ id: 't2' })]), null, '没有命中就不渲染汇总')
  const hit = awaitingReceiptSummaryOf([{ ...taskDetailOf(), silentFinish: { at: NOW, memberId: 'm-t1' } }])
  assert.ok(hit)
  assert.equal(hit.count, 1)
  assert.match(hit.title, /共 1 个任务/)
  // title 带原因与两条出路（时间来自宿主 at，客户端不现算）。
  assert.match(awaitingReceiptTitleOf({ silentFinish: { at: NOW, memberId: 'm-t1' } }), /未提交回执/)
  assert.match(awaitingReceiptTitleOf({ silentFinish: { at: NOW, memberId: 'm-t1' } }), /auto_team_message/)
})
