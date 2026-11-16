/**
 * r39 回归：status / message / receipt 的可选 `runId`（t3）。
 *
 * 背景（真机痛点）：同一会话并发多个 run 后，三个工具只认「最新非终态 run」，
 * 于是对旧 run 任务收口时只能改到最新 run 的同名任务，甚至把消息发到别人 run 的同名成员身上。
 *
 * 判据（每条都问过「改回错误实现会不会红」）：
 *  - 不传 runId = 活动 run，且与显式传活动 runId 的输出**逐字段相等**；
 *  - 传非活动 runId：status 看那份计划、message 只发给那份 run 的成员、receipt 跑那份 run 的门禁；
 *  - 传不存在的 runId：一律 NOT_FOUND，且**一个字节都不写**（不静默回退活动 run）；
 *  - message 传 runId 时不跨 run 退避：目标 run 里没有的任务/成员直接 NOT_FOUND，不误发。
 */
import { test } from 'node:test'
import { rmSync } from 'node:fs'
import assert from 'node:assert/strict'

import type { MemberBinding, PlanTask } from '../src/shared/types.ts'
import { applyReceipt } from '../src/host/team/dispatch.ts'
import { RUN_STATE_VERSION, type RunState } from '../src/host/store.ts'
import {
  bindingOf,
  createHarness,
  planOf,
  SESSION,
  runStateOf,
  taskOf,
  type Harness,
} from './r21-harness.ts'

const NOW = 1_700_000_000_000
const ACTIVE = 'run-r39-active'
const OLDER = 'run-r39-older'
const MISSING = 'run-r39-nope'

function task(id: string, acceptance = 'exit 0'): PlanTask {
  return taskOf(id, 'running', { acceptance })
}

function stateOf(options: {
  runId: string
  createdAt: number
  taskId: string
  memberId: string
  name: string
  extraTasks?: PlanTask[]
  extra?: Partial<RunState>
}): RunState {
  const tasks = [task(options.taskId), ...(options.extraTasks ?? [])]
  const binding: MemberBinding = bindingOf(options.taskId, options.name, { memberId: options.memberId })
  return runStateOf({
    version: RUN_STATE_VERSION,
    plan: planOf({ runId: options.runId, sessionId: SESSION, createdAt: options.createdAt, status: 'dispatching', tasks }),
    bindings: [binding],
    ...options.extra,
  })
}

function withHarness(run: (harness: Harness) => Promise<void>): Promise<void> {
  const harness = createHarness({ applyReceipt })
  const active = stateOf({
    runId: ACTIVE,
    createdAt: NOW, // 最新 → 活动 run
    taskId: 't1',
    memberId: 'member-active',
    name: 'dev-active',
    extraTasks: [taskOf('t2', 'pending', { acceptance: 'exit 0' })],
  })
  const older = stateOf({
    runId: OLDER,
    createdAt: NOW - 100_000,
    taskId: 't1',
    memberId: 'member-older',
    name: 'dev-older',
    extraTasks: [task('t9')],
  })
  harness.store.save(active)
  harness.store.save(older)
  return run(harness).finally(() => rmSync(harness.dir, { recursive: true, force: true }))
}

function fileOf(harness: Harness, runId: string): string {
  const text = harness.snapshotRuns()[`${runId}.json`]
  assert.ok(text !== undefined, `run 文件 ${runId}.json 必须存在`)
  return text
}

/* ------------------------------------------------------------------ status */

test('r39 t3 status：不传 runId 与显式传活动 runId 输出逐字段一致', async () => {
  await withHarness(async (harness) => {
    const byDefault = await harness.call('auto_team_status', {})
    const explicit = await harness.call('auto_team_status', { runId: ACTIVE })
    assert.equal(byDefault.ok, true)
    assert.equal(byDefault.runId, ACTIVE, '不传时必须落在活动 run（最近 createdAt）')
    assert.deepEqual(byDefault, explicit, '不传 = 显式传活动 runId（行为不变的可判定形态）')
  })
})

test('r39 t3 status：传非活动 runId 只看那份计划', async () => {
  await withHarness(async (harness) => {
    const result = await harness.call('auto_team_status', { runId: OLDER })
    assert.equal(result.ok, true)
    assert.equal(result.runId, OLDER, '传了 runId 就不许回落到活动 run')
    const ids = (result.tasks as Array<{ id: string }>).map((item) => item.id)
    assert.deepEqual(ids, ['t1', 't9'], '必须展示 OLDER 的任务表（t9 只在 OLDER 里）')
    assert.equal((result.members as Array<{ memberId: string }>)[0]?.memberId, 'member-older')
  })
})

test('r39 t3 status：runId 不存在 → NOT_FOUND 且零写入（不静默回退）', async () => {
  await withHarness(async (harness) => {
    const before = harness.snapshotRuns()
    const result = await harness.call('auto_team_status', { runId: MISSING })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'NOT_FOUND')
    assert.equal(result.error, `找不到运行 ${MISSING}（会话里没有这个 run）`)
    assert.deepEqual(harness.snapshotRuns(), before, '找不到 run 时不许写任何 run 文件')
  })
})

/* ------------------------------------------------------------------ message */

test('r39 t3 message：传 runId 只发给那个 run 的成员，活动 run 一个字节不变', async () => {
  await withHarness(async (harness) => {
    const activeBefore = fileOf(harness, ACTIVE)
    const olderBefore = fileOf(harness, OLDER)

    const result = await harness.call('auto_team_message', { taskId: 't1', text: '跨 run 收口', runId: OLDER })
    assert.equal(result.ok, true)
    assert.deepEqual(harness.sent, [{ memberId: 'member-older', text: '跨 run 收口' }])

    const olderMessages = harness.store.load(OLDER)?.messages ?? []
    assert.equal(olderMessages.length, 1, '消息必须落进 OLDER 的账本')
    assert.equal(olderMessages[0]?.body, '跨 run 收口')
    assert.equal(olderMessages[0]?.toMemberId, 'member-older', '必须点名 OLDER 的成员，不能发给同名任务的活动成员')
    assert.equal(fileOf(harness, ACTIVE), activeBefore, '活动 run 不许被这次跨 run 消息改动（逐字节）')
    assert.notEqual(fileOf(harness, OLDER), olderBefore, '目标 run 必须真的落盘')
  })
})

test('r39 t3 message：不传 runId 仍走活动 run（与改前一致）', async () => {
  await withHarness(async (harness) => {
    const olderBefore = fileOf(harness, OLDER)
    const result = await harness.call('auto_team_message', { taskId: 't1', text: '默认活动 run' })
    assert.equal(result.ok, true)
    assert.deepEqual(harness.sent, [{ memberId: 'member-active', text: '默认活动 run' }])
    assert.equal(harness.store.load(ACTIVE)?.messages[0]?.body, '默认活动 run')
    assert.equal(fileOf(harness, OLDER), olderBefore, '不传 runId 时绝不许碰非活动 run')
  })
})

test('r39 t3 message：传 runId 不跨 run 退避（同名任务/别的成员一律 NOT_FOUND）', async () => {
  await withHarness(async (harness) => {
    const before = harness.snapshotRuns()

    // 成员名只在 ACTIVE 里存在：传 OLDER 时必须 NOT_FOUND，绝不能退避到别处找。
    const wrongMember = await harness.call('auto_team_message', {
      memberName: 'dev-active',
      text: '发错人',
      runId: OLDER,
    })
    assert.equal(wrongMember.ok, false)
    assert.equal(wrongMember.code, 'NOT_FOUND')
    assert.match(String(wrongMember.error), /找不到成员 dev-active/)

    // 任务 t9 只在 OLDER 里：传 ACTIVE + t9 必须 NOT_FOUND（不许拿活动 run 的同名任务凑数）。
    const wrongTask = await harness.call('auto_team_message', { taskId: 't9', text: '串 run', runId: ACTIVE })
    assert.equal(wrongTask.ok, false)
    assert.equal(wrongTask.code, 'NOT_FOUND')
    assert.match(String(wrongTask.error), /找不到任务 t9/)

    const missing = await harness.call('auto_team_message', { taskId: 't1', text: 'x', runId: MISSING })
    assert.equal(missing.ok, false)
    assert.equal(missing.error, `找不到运行 ${MISSING}（会话里没有这个 run）`)

    assert.deepEqual(harness.sent, [], '被拒的消息一条都不许发出去')
    assert.deepEqual(harness.snapshotRuns(), before, '被拒的消息不许写盘')
  })
})

/* ------------------------------------------------------------------ receipt */

test('r39 t3 receipt：传非活动 runId 跑门禁并只改那个 run', async () => {
  await withHarness(async (harness) => {
    const activeBefore = fileOf(harness, ACTIVE)

    const result = await harness.call('auto_team_receipt', { taskId: 't1', note: 'QA 跨 run 收口', runId: OLDER })
    assert.equal(result.ok, true)
    assert.equal(result.taskId, 't1')
    assert.equal(result.status, 'done', '门禁 exit 0 后任务必须真的 done（不是只到 gate）')
    assert.ok(
      (result.notices as string[]).some((notice) => notice.includes('门禁通过（退出码 0）：t1 已完成')),
      '必须回报门禁通过证据',
    )
    assert.equal((result.evidence as { exitCode: number }).exitCode, 0)
    assert.equal((result.evidence as { command: string }).command, 'exit 0')

    const older = harness.store.load(OLDER)
    assert.equal(older?.plan.tasks.find((item) => item.id === 't1')?.status, 'done', '目标 run 的任务必须 done')
    assert.equal((older?.plan.tasks.find((item) => item.id === 't1')?.evidence as { exitCode: number }).exitCode, 0)

    assert.equal(harness.store.load(ACTIVE)?.plan.tasks.find((item) => item.id === 't1')?.status, 'running')
    assert.equal(fileOf(harness, ACTIVE), activeBefore, '活动 run 的同名任务绝不能被跨 run 回执改到（逐字节）')
  })
})

test('r39 t3 receipt：runId 不存在 → NOT_FOUND 且零写入（不静默回退）', async () => {
  await withHarness(async (harness) => {
    const before = harness.snapshotRuns()
    const result = await harness.call('auto_team_receipt', { taskId: 't1', runId: MISSING })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'NOT_FOUND')
    assert.equal(result.error, `找不到运行 ${MISSING}（会话里没有这个 run）`)
    assert.deepEqual(harness.snapshotRuns(), before, '找不到 run 时连门禁都不许跑、更不许写盘')
  })
})

test('r39 t3 receipt：不传 runId 仍走活动 run；done 后重复回执不重复跑门禁', async () => {
  await withHarness(async (harness) => {
    const olderBefore = fileOf(harness, OLDER)
    const first = await harness.call('auto_team_receipt', { taskId: 't1' })
    assert.equal(first.ok, true)
    assert.equal(first.status, 'done', '不传 runId 时命中活动 run 并完成')
    assert.equal(harness.store.load(ACTIVE)?.plan.tasks.find((item) => item.id === 't1')?.status, 'done')
    assert.equal(fileOf(harness, OLDER), olderBefore, '不传 runId 时绝不许碰非活动 run')

    // 已 done：同一道入口必须短路，不再跑门禁（evidence.at 不变）。
    const evidenceAt = (harness.store.load(ACTIVE)?.plan.tasks.find((item) => item.id === 't1')?.evidence as { at: number }).at
    const activeBefore = fileOf(harness, ACTIVE)
    const second = await harness.call('auto_team_receipt', { taskId: 't1' })
    assert.equal(second.ok, true)
    assert.equal(second.status, 'done')
    assert.ok(
      (second.notices as string[]).some((notice) => notice.includes('任务 t1 已完成，不重复跑门禁')),
      '已 done 必须明确回执「不重复跑门禁」',
    )
    assert.equal(fileOf(harness, ACTIVE), activeBefore, '重复回执不许改写已 done 任务（evidence 保持原样）')
    assert.equal(
      (harness.store.load(ACTIVE)?.plan.tasks.find((item) => item.id === 't1')?.evidence as { at: number }).at,
      evidenceAt,
    )
  })
})
