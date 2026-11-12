/**
 * r14 AC-14 / AC-15 / AC-7 的数据侧回归：项目分桶不再产生「未知项目」、run 级 goal
 * 能一路投影到项目行、角色卡片四要素来自 shared 的单点算法。
 *
 * 为什么用真 store + 真临时目录：`project` 漏写是一次「保存时少一行」的事故，
 * 只有走真实落盘再 list 才能复现；mock 掉 store 就把根因一起 mock 掉了。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import type { DurationCell, PlanTask, RunSummary, TaskDetailView, UsageCell } from '../src/shared/types.ts'
import type { RunState } from '../src/host/store.ts'
import { RUN_STATE_VERSION, RunsStore } from '../src/host/store.ts'
import {
  UNKNOWN_PROJECT_ID,
  UNKNOWN_PROJECT_NAME,
  buildLibrary,
  flowOf,
  projectNameOf,
  rolesOf,
  runDetailOf,
} from '../src/host/library.ts'
import { ROLE_STATE_TEXT } from '../src/shared/role-view.ts'
import { roleUsageOf } from '../src/client/viewmodel.ts'
import { runSummaryRowOf } from '../src/client/tabs/rows.ts'

const WORKSPACE = '/work/current'

/* ───────────────────────────── 夹具 ───────────────────────────── */

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'true',
    status: 'ready',
    ...over,
  }
}

function stateOf(
  over: Partial<Omit<RunState, 'plan'>> & { plan?: Partial<RunState['plan']> } = {},
): RunState {
  const { plan: planOver, ...rest } = over
  return {
    version: RUN_STATE_VERSION,
    plannedAt: 1_100,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...rest,
    plan: {
      runId: 'run-1',
      sessionId: 's1',
      createdAt: 1_000,
      status: 'dispatching',
      tasks: [taskOf('t1')],
      maxConcurrent: 3,
      ...planOver,
    },
  }
}

function tempRuns(): RunsStore {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r14-library-'))
  return new RunsStore(dir)
}

function depsFor(store: RunsStore): Parameters<typeof buildLibrary>[0] {
  return {
    store,
    workspace: WORKSPACE,
    now: () => 10_000,
    publicMemories: () => [],
    projectMemories: () => [],
  }
}

const UNAVAILABLE: UsageCell = { source: 'unavailable', reason: '没有用量来源' }
const RUNNING_DURATION: DurationCell = { state: 'running', ms: 61_000, text: '1m 1s', startAt: 1_200 }
const NO_DURATION: DurationCell = { state: 'not-started', text: '未开始' }
const DONE_DURATION: DurationCell = { state: 'done', ms: 2_000, text: '2 秒', startAt: 1_200, endAt: 3_200 }

function detailOf(id: string, over: Partial<TaskDetailView> = {}): TaskDetailView {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    roleName: '开发',
    status: 'ready',
    dependsOn: [],
    acceptance: 'true',
    usage: UNAVAILABLE,
    duration: NO_DURATION,
    messageCount: 0,
    ...over,
  }
}

/* ─────────────────── AC-14 / AC-15：分桶与 run 级 goal ─────────────────── */

test('AC-14：同工作区的 2 个新 run 落进同一个项目桶，1 个旧 run 进历史桶末位（不裂桶、不猜）', () => {
  const store = tempRuns()
  store.save(
    stateOf({
      project: WORKSPACE,
      plan: { runId: 'r-second', createdAt: 3_000, goal: '第二个大任务：项目库抽屉' },
    }),
  )
  store.save(
    stateOf({
      project: WORKSPACE,
      plan: { runId: 'r-first', createdAt: 2_000, goal: '第一个大任务：无限画布' },
    }),
  )
  store.save(stateOf({ plan: { runId: 'r-legacy', createdAt: 1_000 } })) // 旧 run：没有 project

  const view = buildLibrary(depsFor(store))
  const current = view.projects.find((project) => project.path === WORKSPACE)
  assert.ok(current)
  assert.equal(current.runs, 2, '同一工作区的两个 run 必须归一个桶（project 与 library.workspace 同字符串）')
  assert.equal(current.recentRuns.length, 2)
  assert.deepEqual(
    current.recentRuns.map((run) => run.runId),
    ['r-second', 'r-first'],
    '项目内 run 按 createdAt 倒序',
  )

  const history = view.projects.at(-1)
  assert.equal(history?.id, UNKNOWN_PROJECT_ID)
  assert.equal(history?.unknown, true)
  assert.equal(history?.name, UNKNOWN_PROJECT_NAME, '旧 run 的桶名必须是如实描述，不是「未知项目」')
  assert.equal(history?.runs, 1)
  // 同一工作区不得出现两个同名/同路径桶
  assert.equal(view.projects.filter((project) => project.name === projectNameOf(WORKSPACE)).length, 1)
  assert.equal(view.currentProject, WORKSPACE)
})

test('AC-15：项目行是「一个大任务一行」（run 级），标题来自 goal；旧 run 没有 goal 也不裸奔', () => {
  const store = tempRuns()
  store.save(
    stateOf({
      project: WORKSPACE,
      plan: {
        runId: 'r-goal',
        createdAt: 2_000,
        goal: '把任务页改成可拖动的无限画布',
        // 一个 run 里两个 PlanTask：项目行数按 run 算，不按任务算
        tasks: [taskOf('t1', { status: 'done' }), taskOf('t2', { status: 'running' })],
      },
    }),
  )
  store.save(stateOf({ plan: { runId: 'r-legacy', createdAt: 1_000 } }))

  const view = buildLibrary(depsFor(store))
  const current = view.projects.find((project) => project.path === WORKSPACE)
  assert.equal(current?.recentRuns.length, 1, '2 个任务也只能有 1 行（run 级）')
  assert.equal(current?.recentRuns[0]?.tasks, 2, '行上仍然报告这个 run 有几个任务')
  assert.equal(current?.recentRuns[0]?.goal, '把任务页改成可拖动的无限画布', 'goal 必须投影到 ProjectRunSummaryView')

  const legacy = view.projects.at(-1)?.recentRuns[0]
  assert.equal(legacy?.goal, undefined, '旧 run 没有 goal 时保持缺省，客户端走 fallback 标题')
  assert.equal(legacy?.runId, 'r-legacy')
  assert.notEqual(legacy?.runId, 't1', 'run 行的 id 必须是 runId，不是任务 id')
})

test('AC-14：goal 链无破口 —— buildPlan 写 goal → 落盘 → list 投影 → 项目行（同一夹具走真 IO）', () => {
  const store = tempRuns()
  // 直接用手写的 v3 状态（buildPlan 的写入点由 test/plan.test.ts 覆盖，这里验投影链路）
  store.save(stateOf({ project: WORKSPACE, plan: { runId: 'r-chain', createdAt: 5_000, goal: '端到端 goal' } }))
  const summary = store.list()[0]
  assert.equal(summary.goal, '端到端 goal')
  const view = buildLibrary(depsFor(store))
  assert.equal(view.projects.find((item) => item.path === WORKSPACE)?.recentRuns[0]?.goal, '端到端 goal')
})

/* ─────────────────── AC-7：角色卡片四要素来自单点算法 ─────────────────── */

test('AC-7：rolesOf = 不同 roleId 数（2 个角色 3 个任务 → 2 张卡），状态/当前任务/用时全来自 roleStateOf', () => {
  const tokens: UsageCell = { source: 'provider', tokens: { total: 1_200, input: 1_000, output: 200 } }
  const roles = rolesOf([
    detailOf('t1', { roleId: 'dev', roleName: '开发', status: 'running', usage: tokens, duration: RUNNING_DURATION }),
    detailOf('t2', { roleId: 'dev', roleName: '开发', status: 'done', usage: tokens, duration: DONE_DURATION }),
    detailOf('t3', { roleId: 'qa', roleName: '测试', status: 'gate' }),
  ])

  assert.deepEqual(roles.map((role) => role.roleId), ['dev', 'qa'], '按 roleId 首次出现排序，且只列参与角色')
  const dev = roles[0]
  assert.equal(dev.tasks, 2, '同一角色的两个任务合成一张卡')
  assert.equal(dev.done, 1)
  assert.equal(dev.state, 'running')
  assert.equal(dev.stateText, ROLE_STATE_TEXT.running)
  assert.equal(dev.activeTaskId, 't1')
  assert.equal(dev.activeTaskTitle, '任务 t1')
  assert.deepEqual(dev.duration, { state: 'running', ms: 63_000, text: '1 分 03 秒' }, '角色累计 = 名下任务用时之和（61s + 2s），不是当前任务原样透传')
  assert.deepEqual(dev.usage, { source: 'provider', tokens: { total: 2_400, input: 2_000, output: 400 } })
  // r16 AC-16：宿主侧也投影 taskRefs（顺序 = 计划顺序，状态 = 任务真实状态）
  assert.deepEqual(dev.taskRefs, [
    { id: 't1', status: 'running' },
    { id: 't2', status: 'done' },
  ])

  const qa = roles[1]
  assert.equal(qa.done, 0)
  assert.equal(qa.state, 'waiting_gate')
  assert.equal(qa.stateText, ROLE_STATE_TEXT.waiting_gate)
  assert.equal(qa.activeTaskId, 't3')
  assert.deepEqual(qa.taskRefs, [{ id: 't3', status: 'gate' }])
  assert.equal(qa.usage.source, 'unavailable', '没有用量时是「不可得」，不是 0')
})

test('AC-7：全部完成的角色判「已完成」；用时缺口给出可核对原因（不是裸「不可得」）', () => {
  const roles = rolesOf([
    detailOf('t1', { roleId: 'dev', status: 'done' }),
    detailOf('t2', { roleId: 'dev', status: 'done' }),
  ])
  const dev = roles[0]
  assert.equal(dev.state, 'done')
  assert.equal(dev.stateText, ROLE_STATE_TEXT.done)
  assert.equal(dev.done, 2)
  assert.equal(dev.activeTaskId, undefined)
  assert.deepEqual(dev.duration, {
    state: 'unavailable',
    text: '不可得：任务 t1 缺少开始时刻（另有 1 个任务同样不可得）',
  })
})

/* ─────────────── r20：角色累计用时 / run 用时（宿主与客户端逐字相等） ─────────────── */

test('r20：run 详情用时 —— 进行中任务按 at 计入，角色累计 = 名下任务之和（两侧逐字相等）', () => {
  const at = 10_000
  const state = stateOf({
    plannedAt: 1_000,
    taskTimes: {
      t1: { startedAt: at - 5_000, endedAt: at - 2_000 },
      t2: { startedAt: at - 3_000 },
    },
    plan: {
      tasks: [taskOf('t1', { status: 'done' }), taskOf('t2', { status: 'running' })],
    },
  })
  const detail = runDetailOf(state, at)
  assert.deepEqual(detail.tasks.map((task) => task.duration), [
    { startAt: at - 5_000, endAt: at - 2_000, ms: 3_000, text: '3 秒', state: 'done' },
    { startAt: at - 3_000, endAt: at, ms: 3_000, text: '3 秒', state: 'running' },
  ], '进行中的任务必须用 at 推当前耗时，而不是停在开始时刻')

  // 两个任务同属 dev：角色累计 = 3s + 3s；聚合格不带 startAt/endAt。
  assert.deepEqual(detail.roles.map((role) => role.duration), [
    { state: 'running', ms: 6_000, text: '6 秒' },
  ])

  // run 自己的用时：plannedAt → at（进行中按 at 计入）。
  assert.deepEqual(detail.duration, { startAt: 1_000, endAt: at, ms: 9_000, text: '9 秒', state: 'running' })

  // 客户端同一批任务走同一份 shared 算法：整个角色行（含 duration）逐字段相等。
  const client = roleUsageOf(detail.tasks, [])
  assert.deepEqual(client.map((row) => row.duration), detail.roles.map((role) => role.duration))
  assert.equal(client[0]?.duration?.text, detail.roles[0]?.duration?.text)
})

/* ─────────────── r21：修订 / 作废事实投影到 TaskDetailView（缺席不补） ─────────────── */

test('r21：历史 run 详情透传修订/作废五字段；没发生过的任务保持字段缺席（不补 0/空串）', () => {
  const at = 10_000
  const state = stateOf({
    plan: {
      tasks: [
        taskOf('t1', { status: 'ready', revisedAt: 2_000, revisionNote: '导出改成 CSV' }),
        taskOf('t2', { status: 'cancelled', cancelledAt: 3_000, cancelReason: '被新需求替换', cancelledBy: 'revision' }),
        taskOf('t3', { status: 'done' }),
        // 旧数据：有时刻但没有说明文本 —— 说明文本必须缺席，而不是空串。
        taskOf('t4', { status: 'ready', revisedAt: 4_000, revisionNote: '' }),
        taskOf('t5', { status: 'cancelled', cancelledAt: 5_000, cancelReason: '', cancelledBy: 'user' }),
      ],
    },
  })
  const [revised, cancelled, plain, noteMissing, reasonMissing] = runDetailOf(state, at).tasks

  assert.equal(revised.revisedAt, 2_000)
  assert.equal(revised.revisionNote, '导出改成 CSV')
  assert.equal('cancelledAt' in revised, false, '只修订过的任务不得带作废字段')
  assert.equal(cancelled.cancelledAt, 3_000)
  assert.equal(cancelled.cancelReason, '被新需求替换')
  assert.equal(cancelled.cancelledBy, 'revision')
  assert.equal('revisedAt' in cancelled, false, '只作废的任务不得带修订字段')

  // 没发生过 = 键不存在（客户端已按可选渲染「未修订」；补 0 会把「没记录」装成「发生过」）。
  for (const key of ['revisedAt', 'revisionNote', 'cancelledAt', 'cancelReason', 'cancelledBy']) {
    assert.equal(key in plain, false, `未修订/未作废的任务不应有 ${key}`)
  }
  assert.equal(noteMissing.revisedAt, 4_000)
  assert.equal('revisionNote' in noteMissing, false, '空说明不投影为空串')
  assert.equal(reasonMissing.cancelledAt, 5_000)
  assert.equal('cancelReason' in reasonMissing, false, '空原因不投影为空串')
})

test('r20：历史行用时 —— 客户端派生与宿主 durationOfSummary 同一夹具逐字一致（含旧数据降级）', () => {
  const at = 10_000
  const summaries: RunSummary[] = [
    // 缺 plannedAt 的旧摘要（只有 fake store 能造出来：load 会把 plannedAt 补成 plan.createdAt）
    { runId: 'r-no-planned', sessionId: 's1', createdAt: 900, status: 'terminated', tasks: 1, done: 1, project: WORKSPACE },
    // 终态但缺 finishedAt（历史宿主未落盘）→ 不可得
    { runId: 'r-no-end', sessionId: 's1', createdAt: 950, status: 'terminated', tasks: 1, done: 1, project: WORKSPACE, plannedAt: 1_000 },
    // done：plannedAt → finishedAt
    { runId: 'r-done', sessionId: 's1', createdAt: 960, status: 'terminated', tasks: 1, done: 1, project: WORKSPACE, plannedAt: 1_000, finishedAt: 4_000 },
    // running：plannedAt → at
    { runId: 'r-running', sessionId: 's1', createdAt: 970, status: 'dispatching', tasks: 1, done: 0, project: WORKSPACE, plannedAt: 1_000 },
  ]
  const view = buildLibrary({
    store: { list: () => summaries, load: () => null },
    workspace: WORKSPACE,
    now: () => at,
    publicMemories: () => [],
    projectMemories: () => [],
  })
  const hostRows = new Map(view.projects.flatMap((project) => project.recentRuns).map((row) => [row.runId, row]))
  assert.equal(hostRows.size, 4)

  for (const summary of summaries) {
    const hostRow = hostRows.get(summary.runId)
    assert.ok(hostRow, `${summary.runId} 必须出现在项目行里`)
    const clientRow = runSummaryRowOf(summary, at)
    // 行视图把单元格摊平为 durationText / durationState（客户端不重算，只搬运）。
    assert.equal(clientRow.durationText, hostRow.duration?.text, `${summary.runId}：可见文本逐字相等`)
    assert.equal(clientRow.durationState, hostRow.duration?.state, `${summary.runId}：状态与宿主同值`)
    assert.ok(clientRow.durationTitle.length > 0, `${summary.runId}：title 必须解释口径`)
  }

  assert.deepEqual(hostRows.get('r-no-planned')?.duration, { state: 'unavailable', text: '不可得' })
  assert.deepEqual(hostRows.get('r-no-end')?.duration, { state: 'unavailable', text: '不可得' })
  assert.deepEqual(hostRows.get('r-done')?.duration, { startAt: 1_000, endAt: 4_000, ms: 3_000, text: '3 秒', state: 'done' })
  assert.deepEqual(hostRows.get('r-running')?.duration, { startAt: 1_000, endAt: at, ms: 9_000, text: '9 秒', state: 'running' })
})

test('AC-5：flowOf 节点带上角色名与 roleId（客户端按角色分列的唯一依据）', () => {
  const flow = flowOf([
    detailOf('t1', { roleId: 'dev', roleName: '开发', status: 'done' }),
    detailOf('t2', { roleId: 'qa', roleName: '测试', dependsOn: ['t1'] }),
  ])
  assert.deepEqual(flow.nodes.map((node) => node.roleName), ['开发', '测试'])
  assert.deepEqual(flow.nodes.map((node) => node.roleId), ['dev', 'qa'])
  assert.equal(flow.nodes[0]?.column, 0)
  assert.equal(flow.nodes[1]?.column, 1)
})

/* ─────────────────── AC-14：旧文案不许在源码里复活 ─────────────────── */

test('AC-14：src 里不再出现「未知项目」字面（唯一说法是「历史运行（未记录工作区）」）', () => {
  const root = new URL('../src/', import.meta.url)
  // 全量扫描、无豁免：库页已按 r14 重写，旧注释一并清理；任何文件再写回旧词都算回归。
  const offenders: string[] = []
  const walk = (dir: URL): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name, dir)
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, dir))
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      const rel = relative(new URL('../', import.meta.url).pathname, child.pathname)
      const code = readFileSync(child, 'utf8')
      if (code.includes('未知项目')) offenders.push(rel)
    }
  }
  walk(root)
  assert.deepEqual(offenders, [], '历史桶的文案只有一个说法，注释也不许留旧词')
})
