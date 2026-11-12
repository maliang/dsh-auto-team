/**
 * r21 客户端纯函数：目标分段、成员状态徽标、历史用时。
 *
 * 这三块都不依赖 DOM，是「面板能看出合并与停止」的可执行判据：
 *  - `planGoalOf` 必须把宿主下发的 goal 切成「原始目标 + 逐次需求修订」，且不补时刻；
 *  - `memberStatusBadge` 的 waiting/stopping/stopped 中文属于**成员**语义，
 *    不能回落到任务词表（waiting 显示「等待中」就看不出成员在等写域）；
 *  - 历史用时必须与宿主 `runDurationOf`（同一 `durationCellOf`）逐字相等 ——
 *    两端口径漂移会让同一个 run 在左栏和右栏显示不同文本（r18 遗留项）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  formatStamp,
  memberCardChipOf,
  memberStatusBadge,
  memberStatusTitleOf,
  MEMBER_CARD_STATUSES,
  planGoalOf,
} from '../src/client/viewmodel.ts'
import { runSummaryRowOf } from '../src/client/tabs/rows.ts'
import { runDurationOf } from '../src/host/library.ts'
import { RunsStore, type RunState } from '../src/host/store.ts'
import type { MemberView, PlanRevision, RunSummary } from '../src/shared/types.ts'
import { NOW, planOf, runStateOf, SESSION, taskOf } from './r21-harness.ts'

/* ───────────── planGoalOf：目标 / 追加段切分 ───────────── */

test('planGoalOf：goal 与修订史都空 → null（run 头不占位）', () => {
  assert.equal(planGoalOf(undefined, undefined, 'run-1'), null)
  assert.equal(planGoalOf('   ', [], 'run-1'), null)
})

test('planGoalOf：没有修订标题 → 只有「原始目标」一段，不出并入标记', () => {
  const view = planGoalOf('  原始目标正文  ', [], 'run-1')
  assert.ok(view)
  assert.deepEqual(view.sections, [
    { key: 'goal-origin', revision: false, heading: '原始目标', body: '原始目标正文' },
  ])
  assert.equal(view.mergedText, undefined)
  assert.equal(view.revisionCountText, undefined)
})

test('planGoalOf：两个修订段 → 原目标 + 两段追加需求，正文逐字保留', () => {
  const goal = [
    '第一个需求',
    '',
    '## 需求修订（2026-11-10 10:00）',
    '补充验收 A',
    '',
    '## 需求修订（2026-11-10 11:30）',
    '第二段',
    '带换行',
  ].join('\n')
  const view = planGoalOf(goal, [], 'run-x')
  assert.ok(view)
  assert.deepEqual(view.sections, [
    { key: 'goal-origin', revision: false, heading: '原始目标', body: '第一个需求' },
    { key: 'goal-revision-1', revision: true, heading: '需求修订（2026-11-10 10:00）', body: '补充验收 A' },
    { key: 'goal-revision-2', revision: true, heading: '需求修订（2026-11-10 11:30）', body: '第二段\n带换行' },
  ])
  assert.equal(view.mergedText, '已并入 run-x')
  assert.equal(view.revisionCountText, undefined, '没有修订史时不编「被修订 N 次」')
})

test('planGoalOf：只有修订段（没有原目标）→ 不产空 origin 段', () => {
  const goal = '## 需求修订（2026-11-10 10:00）\n只有新需求'
  const view = planGoalOf(goal, [], 'run-1')
  assert.ok(view)
  assert.deepEqual(view.sections.map((section) => section.key), ['goal-revision-1'])
  assert.equal(view.sections[0].body, '只有新需求')
})

test('planGoalOf：标题行带尾随空格仍识别，段正文不含尾随空白', () => {
  const goal = '旧目标\n\n## 需求修订（2026-11-10 10:00）   \n新目标   '
  const view = planGoalOf(goal, [], 'run-1')
  assert.ok(view)
  assert.equal(view.sections.length, 2)
  assert.equal(view.sections[1].heading, '需求修订（2026-11-10 10:00）')
  assert.equal(view.sections[1].body, '新目标')
})

test('planGoalOf：修订史给出次数与最近一次说明；summary 为空时只回时刻', () => {
  const revisions: PlanRevision[] = [
    { at: NOW - 120_000, text: '第一次', changeSummary: '补验收', updatedTaskIds: [], addedTaskIds: [], cancelledTaskIds: [] },
    { at: NOW - 60_000, text: '第二次', updatedTaskIds: [], addedTaskIds: [], cancelledTaskIds: [] },
  ]
  const view = planGoalOf('原始目标', revisions, 'run-9')
  assert.ok(view)
  assert.equal(view.revisionCountText, '本次运行已被修订 2 次')
  assert.equal(view.latestRevisionText, `最近一次修订于 ${formatStamp(NOW - 60_000)}`)
  assert.equal(view.mergedText, '已并入 run-9')
})

test('planGoalOf：修订史有 summary 时写「最近修订 <时刻>：<summary>」', () => {
  const revisions: PlanRevision[] = [
    { at: NOW, text: 'x', changeSummary: '  改验收命令  ', updatedTaskIds: [], addedTaskIds: [], cancelledTaskIds: [] },
  ]
  const view = planGoalOf(undefined, revisions, 'run-9')
  assert.ok(view)
  assert.deepEqual(view.sections, [])
  assert.equal(view.latestRevisionText, `最近修订 ${formatStamp(NOW)}：改验收命令`)
  assert.equal(view.mergedText, '已并入 run-9')
})

/* ───────────── memberStatusBadge / chip ───────────── */

function memberOf(over: Partial<MemberView> = {}): MemberView {
  return {
    memberId: 'member-1',
    name: '开发-1',
    roleId: 'dev',
    status: 'running',
    lastEventAt: NOW,
    modelRoute: '会话默认',
    canResume: true,
    stalled: false,
    stalledForMs: 0,
    stalledSecondsText: '',
    ...over,
  }
}

test('memberStatusBadge：waiting 是「等待写域」，stopping/stopped 是中文而非英文原文', () => {
  assert.deepEqual(memberStatusBadge('waiting'), { icon: '⏳', text: '等待写域', tone: 'warn' })
  assert.deepEqual(memberStatusBadge('stopping'), { icon: '◔', text: '停止中', tone: 'warn' })
  assert.deepEqual(memberStatusBadge('stopped'), { icon: '■', text: '已停止', tone: 'neutral' })
  assert.deepEqual(memberStatusBadge('cancelled'), { icon: '⊘', text: '已取消', tone: 'neutral' })
  // 未知值显示原文（不静默变空），空串才回落「未知」。
  assert.deepEqual(memberStatusBadge('weird'), { icon: '?', text: 'weird', tone: 'neutral' })
  assert.deepEqual(memberStatusBadge(''), { icon: '?', text: '未知', tone: 'neutral' })
})

test('memberStatusBadge：11 个成员态全部有中文（不回显英文原文）', () => {
  const statuses = [
    'running',
    'idle',
    'blocked',
    'rework',
    'done',
    'failed',
    'interrupted',
    'cancelled',
    'stopped',
    'stopping',
    'waiting',
  ] as const
  for (const status of statuses) {
    const badge = memberStatusBadge(status)
    assert.notEqual(badge.text, status, `${status} 不得回显英文原文`)
    assert.notEqual(badge.text, '未知', `${status} 必须是已知态`)
    // 唯一例外：running 的中文恰好与英文不同，但 `idle` 等也都有中文；用词表长度保证不遗漏。
  }
  assert.equal(new Set(statuses.map((status) => memberStatusBadge(status).text)).size, 11)
})

test('memberStatusTitleOf：只解释 stopping/stopped 两个新态，其余不编', () => {
  assert.equal(memberStatusTitleOf('stopping'), '已发出中断，尚未确认停止')
  assert.equal(memberStatusTitleOf('stopped'), '中断已确认，成员已停止')
  assert.equal(memberStatusTitleOf('running'), undefined)
  assert.equal(memberStatusTitleOf('waiting'), undefined)
})

test('memberCardChipOf：只在角色卡看不出成员实况时补 chip', () => {
  assert.deepEqual(MEMBER_CARD_STATUSES, ['waiting', 'stopping', 'stopped', 'cancelled'])
  assert.deepEqual(memberCardChipOf(memberOf({ status: 'waiting' })), { icon: '⏳', text: '等待写域', tone: 'warn' })
  assert.deepEqual(memberCardChipOf(memberOf({ status: 'stopping' })), { icon: '◔', text: '停止中', tone: 'warn' })
  assert.deepEqual(memberCardChipOf(memberOf({ status: 'stopped' })), { icon: '■', text: '已停止', tone: 'neutral' })
  // r21 AC-4：已确认停止的时刻透传到 chip（「已停止 <时刻>」），缺席时只显示状态。
  assert.deepEqual(memberCardChipOf(memberOf({ status: 'stopped', stoppedAt: NOW })), {
    icon: '■',
    text: `已停止 ${formatStamp(NOW)}`,
    tone: 'neutral',
  })
  assert.deepEqual(memberCardChipOf(memberOf({ status: 'cancelled' })), { icon: '⊘', text: '已取消', tone: 'neutral' })
  assert.equal(memberCardChipOf(memberOf({ status: 'running' })), undefined)
  assert.equal(memberCardChipOf(undefined), undefined)
})

/* ───────────── 历史用时：与宿主 runDurationOf 逐字一致 ───────────── */

/** 用真实 store 产出 summary：走的就是宿主 `store.list()` → `durationOfSummary` 那条投影。 */
function summaryOf(state: RunState): RunSummary {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r21-duration-'))
  const store = new RunsStore(join(dir, 'runs'))
  store.save(state)
  const summary = store.list()[0]
  assert.ok(summary, 'store.list() 必须给出 summary')
  return summary
}

function assertDurationParity(state: RunState): { text: string; state: string } {
  const summary = summaryOf(state)
  const host = runDurationOf(state, NOW)
  const row = runSummaryRowOf(summary, NOW)
  // 行视图只暴露 text + state（与面板实际渲染的单元格一致）；两者都必须与宿主逐字相等。
  assert.deepEqual({ text: row.durationText, state: row.durationState }, { text: host.text, state: host.state })
  return { text: row.durationText, state: row.durationState }
}

test('用时一致：进行中 run 按 now 计时', () => {
  assertDurationParity(
    runStateOf({ plannedAt: NOW - 90_000, plan: planOf({ tasks: [taskOf('t1', 'running')] }) }),
  )
})

test('用时一致：终态且有 finishedAt → done，文本逐字相等', () => {
  const state = runStateOf({
    plannedAt: NOW - 3_600_000,
    finishedAt: NOW - 60_000,
    plan: planOf({ status: 'terminated', tasks: [taskOf('t1', 'done')] }),
  })
  assertDurationParity(state)
  const summary = summaryOf(state)
  assert.equal(runSummaryRowOf(summary, NOW).durationText, '59 分 00 秒')
})

test('用时一致：历史终态 run 缺 finishedAt → 宿主按 taskTimes 回退，两边都是 done', () => {
  const state = runStateOf({
    plannedAt: NOW - 10 * 60_000,
    plan: planOf({ status: 'terminated', tasks: [taskOf('t1', 'done')] }),
    taskTimes: { t1: { startedAt: NOW - 9 * 60_000, endedAt: NOW - 60_000 } },
  })
  assertDurationParity(state)
  const summary = summaryOf(state)
  assert.equal(summary.finishedAt, NOW - 60_000)
  assert.equal(runSummaryRowOf(summary, NOW).durationState, 'done')
})

test('用时一致：终态缺 finishedAt 且无 taskTimes/messages → 两边都「不可得」', () => {
  const state = runStateOf({
    plannedAt: NOW - 10 * 60_000,
    plan: planOf({ status: 'terminated', tasks: [taskOf('t1', 'done')] }),
    messages: [],
  })
  assertDurationParity(state)
  assert.equal(runDurationOf(state, NOW).text, '不可得')
})

test('用时一致：缺 plannedAt → 不可得（不拿 createdAt 顶上）', () => {
  // `wrapLegacy` 会给旧文件把 plannedAt 回填成 createdAt，所以「缺 plannedAt」只能直接构造
  // 两个端口的输入来验分支——这里要钉的是**客户端不拿 createdAt 顶上**。
  const state = runStateOf({ plannedAt: undefined as unknown as number })
  const summary: RunSummary = {
    runId: state.plan.runId,
    sessionId: SESSION,
    createdAt: state.plan.createdAt,
    status: 'draft',
    tasks: 1,
    done: 0,
    plannedAt: undefined,
    ongoing: 1,
    active: true,
  }
  const host = runDurationOf(state, NOW)
  assert.deepEqual(host, { state: 'unavailable', text: '不可得' })
  const row = runSummaryRowOf(summary, NOW)
  assert.deepEqual({ text: row.durationText, state: row.durationState }, { text: host.text, state: host.state })
})

test('历史行用宿主终止原因：terminationReason 非空才写 terminationText', () => {
  const withReason = summaryOf(
    runStateOf({
      plan: planOf({ status: 'terminated', tasks: [taskOf('t1', 'cancelled')] }),
      finishedAt: NOW - 1_000,
      termination: { reason: '需求修订后本次运行已无待执行任务', kind: 'superseded' },
    }),
  )
  assert.equal(runSummaryRowOf(withReason, NOW).terminationText, '需求修订后本次运行已无待执行任务')

  const withoutReason = summaryOf(
    runStateOf({ plan: planOf({ status: 'terminated', tasks: [taskOf('t1', 'cancelled')] }), finishedAt: NOW - 1_000 }),
  )
  assert.equal('terminationText' in runSummaryRowOf(withoutReason, NOW), false, '没有原因就不占位')
})
