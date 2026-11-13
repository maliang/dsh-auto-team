/**
 * r34 QA：残留判定收紧的客户端回归（用户 2026-11-13 口径：**确认没有存活成员才提示**）。
 *
 * 背景：r24 的 `isResidualRun` 只凭「计划态 ∈ {draft,dispatching,paused} 且无 finishedAt」判残留，
 * 正在跑的 run 也满足这两条，于是「未收口·可能残留 + 终止计划」会挂在活跃 run 上。t7 加第三条：
 * `liveMembers === 0` 才提示；`undefined`（宿主读不到 / 旧快照）=「无法确认」，同样不提示。
 *
 * 每条断言都问过「把实现改回错误版本会不会变红」（变异矩阵见 §r34 QA-REPORT 与
 * `test/r34-mutation-probes.mjs`）：
 *  - 去掉第三条判据（`return true`）→ ①（liveMembers>0 不显示）与「旧前提」用例红；
 *  - 把未知写成 0（`(liveMembers ?? 0) === 0`）→ ③（undefined 不显示）红；
 *  - 只用快照兜底、不再优先宿主字段 → ①/② 的「宿主优先」用例红；
 *  - 快照兜底把 `done` 算成存活 → ③ 的「只剩终态成员」用例红。
 *
 * 「不显示」= 行投影里**没有** `residualBadge` 字段；徽标与「终止计划」按钮同源，
 * 三个入口（历史行 / 顶部 run 卡 / run 切换器）都只在 `row.residualBadge !== undefined` 时渲染，
 * 由 ⑤ 的静态接线断言钉住（本仓没有 react-dom，组件不能真渲染，见 `src/client/ui.ts` 文件头）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  isResidualRun,
  RESIDUAL_RUN_BADGE,
  RESIDUAL_RUN_BADGE_TEXT,
  RESIDUAL_RUN_TITLE,
} from '../src/client/viewmodel.ts'
import { liveMembersOfSnapshot, runSummaryRowOf } from '../src/client/tabs/rows.ts'
import type { MemberStatus, MemberView, PlanStatus, RunSummary } from '../src/shared/types.ts'

const NOW = 1_760_000_000_000
const REPO = fileURLToPath(new URL('../', import.meta.url))

function summaryOf(extra: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'run-r34',
    sessionId: 'sess-r34',
    createdAt: NOW - 60_000,
    plannedAt: NOW - 60_000,
    status: 'draft',
    tasks: 1,
    done: 0,
    ...extra,
  }
}

function memberOf(memberId: string, status: MemberStatus): MemberView {
  return {
    memberId,
    name: `成员-${memberId}`,
    roleId: 'dev',
    status,
    lastEventAt: NOW,
    modelRoute: '会话默认',
    canResume: false,
    stalled: false,
    stalledForMs: 0,
    stalledSecondsText: '',
  }
}

/** 行投影是否带残留徽标 —— 也就是「终止计划」入口的数据开关。 */
function hasResidualBadge(row: ReturnType<typeof runSummaryRowOf>): boolean {
  return 'residualBadge' in row
}

const UNCLOSED: readonly PlanStatus[] = ['draft', 'dispatching', 'paused']

// ---------------------------------------------------------------------------
// ① liveMembers > 0：正在推进，不提示
// ---------------------------------------------------------------------------

test('r34 ① liveMembers>0：正在推进的 run 不判残留，行上没有徽标（= 没有终止入口）', () => {
  for (const status of UNCLOSED) {
    assert.equal(
      isResidualRun({ status, liveMembers: 1 }),
      false,
      `${status} + liveMembers=1 说明还有人在跑，不是残留`,
    )
    const row = runSummaryRowOf(summaryOf({ status, liveMembers: 1 }), NOW)
    assert.equal(hasResidualBadge(row), false, `${status} + liveMembers=1 不得出现残留徽标`)
  }

  // 宿主字段优先：宿主说 3 个存活，即使快照这一次没带成员列表，也不提示。
  const hostWins = runSummaryRowOf(summaryOf({ status: 'dispatching', liveMembers: 3 }), NOW, [])
  assert.equal(hasResidualBadge(hostWins), false, '宿主 liveMembers>0 优先于快照，不提示')
})

// ---------------------------------------------------------------------------
// ② liveMembers === 0：确认没人，才提示
// ---------------------------------------------------------------------------

test('r34 ② liveMembers===0：确认没有存活成员 → 判残留，行带同一枚徽标（与按钮同源）', () => {
  assert.equal(isResidualRun({ status: 'draft', liveMembers: 0 }), true)
  const row = runSummaryRowOf(summaryOf({ liveMembers: 0 }), NOW)
  assert.deepEqual(row.residualBadge, RESIDUAL_RUN_BADGE, '徽标必须是 viewmodel 里的唯一来源')
  assert.equal(row.residualBadge?.text, RESIDUAL_RUN_BADGE_TEXT)
  assert.equal(row.residualBadge?.tone, 'warn')
  assert.match(RESIDUAL_RUN_TITLE, /确认没有存活成员/, '悬停解释必须写清第三条判据')

  // 宿主字段优先：宿主说 0（确实没人），快照里残留的 running 成员不得把它反向改回「有人」。
  const hostWins = runSummaryRowOf(summaryOf({ liveMembers: 0 }), NOW, [memberOf('m1', 'running')])
  assert.ok(hostWins.residualBadge, '宿主 liveMembers=0 优先于快照兜底')
})

// ---------------------------------------------------------------------------
// ③ liveMembers === undefined：无法确认，不提示
// ---------------------------------------------------------------------------

test('r34 ③ liveMembers===undefined（宿主读不到）：无法确认 ≠ 确认没有 → 不提示', () => {
  for (const status of UNCLOSED) {
    assert.equal(
      isResidualRun({ status }),
      false,
      `${status} 缺 liveMembers 时必须按「无法确认」处理，不得写成 0`,
    )
  }

  // 行数据：宿主没给、也没传快照成员 → 两路都读不到，不出徽标（旧前提单独不再触发）。
  const unknown = runSummaryRowOf(summaryOf({ status: 'dispatching' }), NOW)
  assert.equal(hasResidualBadge(unknown), false, '读不到存活成员数时不得提示残留')
  assert.equal(liveMembersOfSnapshot(undefined), undefined, '快照没到时返回 undefined，不补 0')

  // 快照兜底是另一条路：成员列表**明确只剩终态**（done/failed/interrupted/cancelled/stopped）
  // → 这就是「确认没有存活成员」= 0，应当提示；把 done 算成存活会让旧残留永远显示不出来。
  const doneOnly = [memberOf('m1', 'done'), memberOf('m2', 'failed'), memberOf('m3', 'stopped')]
  assert.equal(liveMembersOfSnapshot(doneOnly), 0, '终态成员不算存活')
  const viaSnapshot = runSummaryRowOf(summaryOf({ status: 'draft' }), NOW, doneOnly)
  assert.ok(viaSnapshot.residualBadge, '快照明确没人时，兜底值 0 应当触发残留提示')

  // 反向：快照里还有 running 成员 → 兜底值 >0 → 不提示。
  const liveSnapshot = [memberOf('m1', 'running'), memberOf('m2', 'done')]
  assert.equal(liveMembersOfSnapshot(liveSnapshot), 1)
  const liveRow = runSummaryRowOf(summaryOf({ status: 'draft' }), NOW, liveSnapshot)
  assert.equal(hasResidualBadge(liveRow), false, '快照里还有人跑时不得提示残留')
})

// ---------------------------------------------------------------------------
// ④ 已结束 / 已终态：一律不提示
// ---------------------------------------------------------------------------

test('r34 ④ run 已有 finishedAt 或已终态：即使 liveMembers=0 也不判残留', () => {
  assert.equal(
    isResidualRun({ status: 'dispatching', finishedAt: NOW - 1_000, liveMembers: 0 }),
    false,
    '有结束时刻 = 已收口',
  )
  for (const status of ['terminated', 'cancelled'] as const) {
    assert.equal(isResidualRun({ status, liveMembers: 0 }), false, `${status} 是终态，不判残留`)
    const row = runSummaryRowOf(summaryOf({ status, liveMembers: 0, finishedAt: NOW - 1_000 }), NOW)
    assert.equal(hasResidualBadge(row), false, `${status} 行不得出现残留徽标`)
  }
})

// ---------------------------------------------------------------------------
// ⑤ 徽标与「终止计划」按钮同源（三处入口只认 row.residualBadge）
// ---------------------------------------------------------------------------

test('r34 ⑤ 徽标与终止按钮同源：三个入口都只按 row.residualBadge 决定是否渲染 RunCloseAction', () => {
  const entrySources = {
    '历史行': readFileSync(`${REPO}src/client/tabs/HistoryTab.tsx`, 'utf8'),
    '顶部 run 卡': readFileSync(`${REPO}src/client/tabs/TasksTab.tsx`, 'utf8'),
    'run 切换器': readFileSync(`${REPO}src/client/views/RunSwitcher.tsx`, 'utf8'),
  } as const

  for (const [name, source] of Object.entries(entrySources)) {
    assert.ok(source.includes('row.residualBadge'), `${name}必须按 row.residualBadge 分支`)
  }

  // 历史行 / 顶部 run 卡：两处都直接渲染 RunCloseAction，且都包在 residualBadge 判定里。
  const history = entrySources['历史行']
  const tasks = entrySources['顶部 run 卡']
  const switcher = entrySources['run 切换器']
  assert.equal(history.split('<RunCloseAction').length - 1, 1, '历史行只应有一个终止入口')
  assert.equal(tasks.split('<RunCloseAction').length - 1, 1, '顶部 run 卡只应有一个终止入口')
  assert.ok(history.includes('row.residualBadge !== undefined ?'), '历史行徽标/按钮必须同源条件渲染')
  assert.ok(tasks.includes('row.residualBadge === undefined ? null :'), 'run 卡的终止入口必须由残留判定关闭')
  assert.ok(switcher.includes('row.residualBadge === undefined ? null :'), '切换器不得无条件渲染终止入口')
  assert.equal(switcher.split('<RunCloseAction').length - 1, 0, '切换器只接收调用方注入的入口，不自己判定')
})
