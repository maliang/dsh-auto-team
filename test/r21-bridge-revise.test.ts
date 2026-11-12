/**
 * r21 宿主桥：`bridge.revise` 的落盘时序与成员侧效果。
 *
 * 这里验的是「顺序」和「副作用」，不是纯计划变换（那是 r21-revise-plan.test.ts）：
 *  - **先落盘再中断**：interrupt 回调里读盘必须已经能看到 `stopping:true` 与任务 `cancelled`；
 *    改回「先中断再落盘」这条断言立刻红 —— 面板会在中断窗口里显示一个「运行中」的已作废任务。
 *  - 中断失败**不得**假报已停止：binding 保持 `stopping:true`、快照状态为 `stopping`。
 *  - 直达消息三种文案（被作废 / 已修订 / 未受影响），且失败的通知只进 notice、不进账本。
 *  - 最后一批任务全作废时收口：`terminated` + `finishedAt` + `termination.reason` 同一次落盘。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import type { Harness } from './r21-harness.ts'
import {
  bindingOf,
  createHarness,
  NOW,
  planOf,
  RUN,
  runStateOf,
  SESSION,
  seed,
  taskOf,
} from './r21-harness.ts'

/** 三个在跑成员，分别覆盖「被作废 / 已修订 / 未受影响」三条通知分支。 */
function seedThreeRunning(h: Harness): void {
  const plan = planOf({
    tasks: [
      taskOf('t1', 'running', { title: '旧目标一' }),
      taskOf('t2', 'running', { title: '旧目标二' }),
      taskOf('t3', 'running', { title: '旧目标三' }),
    ],
  })
  seed(h.store, runStateOf({ plan, bindings: [bindingOf('t1', '开发-1'), bindingOf('t2', '开发-2'), bindingOf('t3', '开发-3')] }))
}

test('revise：stopping 在 interrupt 之前已经落盘；中断成功 → retired + stoppedAt + 快照已停止', async () => {
  let seen: { stopping?: boolean; status?: string } = {}
  // interrupt 换成「读一次盘」的探针：证明落盘发生在中断之前。
  let probing: Harness
  probing = createHarness({
    interrupt: async () => {
      const onDisk = probing.store.load(RUN)
      const binding = onDisk?.bindings.find((item) => item.taskId === 't1')
      const task = onDisk?.plan.tasks.find((item) => item.id === 't1')
      seen = { stopping: binding?.stopping, status: task?.status }
      return { ok: true }
    },
  })
  seed(probing.store, runStateOf())
  const result = await probing.bridge.revise(SESSION, RUN, { goal: '新需求', cancelledTaskIds: ['t1'] })
  assert.equal(result.ok, true)
  assert.deepEqual(seen, { stopping: true, status: 'cancelled' })
  assert.deepEqual(result.stopFailed, [])
  assert.deepEqual(probing.interrupted, ['开发-1'])

  const stored = probing.store.load(RUN)
  assert.ok(stored)
  const binding = stored.bindings.find((item) => item.taskId === 't1')
  assert.equal(binding?.retired, true)
  assert.equal(binding?.stoppedAt, NOW)
  assert.equal('stopping' in (binding ?? {}), false)
  // 只作废 t1：t2 仍 pending，run 不算收口。
  assert.equal(stored.plan.status, 'draft')
  assert.equal(stored.finishedAt, undefined)
  // 已退休成员不再收「修订通知」（发送会把它重新拉起来）。
  assert.deepEqual(result.notified, [])
  assert.deepEqual(probing.sent, [])
  // 快照能看出「已停止」，且不是从前端推断出来的。
  const member = probing.bridge.snapshot(SESSION).members.find((item) => item.taskId === 't1')
  assert.equal(member?.status, 'stopped')
  assert.equal(member?.canResume, true)
  // AC-4 投影：确认停止的时刻透传到 MemberView；没在停止中就不该出现 stopping 键。
  assert.equal(member?.stoppedAt, NOW)
  assert.equal('stopping' in (member ?? {}), false)
  // 仍在 pending 的 t2 两个停止事实位都必须缺席（缺席 = 没发生过，不补 false/0）。
  const pendingMember = probing.bridge.snapshot(SESSION).members.find((item) => item.taskId === 't2')
  assert.equal(pendingMember?.stopping, undefined)
  assert.equal('stoppedAt' in (pendingMember ?? {}), false)
})

test('revise：中断失败保持 stopping（不假报已停止）→ 快照 stopping + 「立即停止」直达消息', async () => {
  const h = createHarness({ interrupt: async () => ({ ok: false, error: '中断超时' }) })
  seed(h.store, runStateOf())
  const result = await h.bridge.revise(SESSION, RUN, {
    goal: '新需求',
    changeSummary: '用户改主意',
    cancelledTaskIds: ['t1'],
    cancelReason: '用户改主意',
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.stopped, [])
  assert.deepEqual(result.stopFailed, [{ name: '开发-1', error: '中断超时' }])

  const stored = h.store.load(RUN)
  assert.ok(stored)
  const binding = stored.bindings.find((item) => item.taskId === 't1')
  assert.equal(binding?.stopping, true)
  assert.equal(binding?.retired, undefined)
  assert.equal(binding?.stoppedAt, undefined)
  assert.equal(h.bridge.snapshot(SESSION).members.find((item) => item.taskId === 't1')?.status, 'stopping')
  // AC-4 投影：中断失败仍在停止中 → stopping:true，但绝不能出现 stoppedAt（那是「已确认停下」的事实）。
  const stoppingMember = h.bridge.snapshot(SESSION).members.find((item) => item.taskId === 't1')
  assert.equal(stoppingMember?.stopping, true)
  assert.equal('stoppedAt' in (stoppingMember ?? {}), false)

  // 停止失败要发「立即停止」，且正文带作废原因（不是空话）。
  assert.equal(h.sent.length, 1)
  const text = h.sent[0].text
  assert.match(text, /【需求修订】run run-r21 于 \d{4}-\d{2}-\d{2} \d{2}:\d{2} 并入新需求。/)
  assert.match(text, /变更要点：用户改主意/)
  assert.match(text, /你所在任务 t1《任务 t1》已被新需求作废（原因：用户改主意）/)
  // 账本：成员消息在前、队长告知在最后；失败/成功都以同一次落盘为准。
  const memberMessages = stored.messages.filter((item) => item.to === '开发-1')
  assert.equal(memberMessages.length, 1)
  assert.equal(memberMessages[0].taskId, 't1')
  assert.equal(memberMessages[0].from, 'captain')
  assert.equal(memberMessages[0].body, text)
  const notice = stored.messages[stored.messages.length - 1]
  assert.equal(notice.to, 'user')
  assert.match(notice.body, /已并入需求修订（run run-r21）：更新 0、追加 0、作废 1/)
  assert.match(notice.body, /成员停止失败：开发-1（中断超时）/)
})

test('revise：三种直达文案 —— 被作废 / 已修订 / 未受影响', async () => {
  const h = createHarness({ interrupt: async () => ({ ok: false, error: '忙' }) })
  seedThreeRunning(h)
  const result = await h.bridge.revise(SESSION, RUN, {
    goal: '统一改需求',
    changeSummary: '改验收',
    cancelledTaskIds: ['t1'],
    tasks: [{ id: 't2', title: '新任务 t2', roleId: 'dev', acceptance: 'exit 22' }],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.notified, ['开发-1', '开发-2', '开发-3'])
  assert.equal(h.sent.length, 3)

  const textOf = (memberId: string): string => h.sent.find((item) => item.memberId === memberId)?.text ?? ''
  assert.match(textOf('member-t1'), /你所在任务 t1《旧目标一》已被新需求作废（原因：需求修订作废：改验收）/)
  assert.match(textOf('member-t2'), /你的任务 t2 已修订：目标=《新任务 t2》，验收命令=exit 22/)
  assert.match(textOf('member-t3'), /你的任务 t3《旧目标三》的目标与验收未变；但整体需求已修订，注意依赖任务可能调整。/)

  // 三条消息都带修订头与变更要点。
  for (const memberId of ['member-t1', 'member-t2', 'member-t3']) {
    assert.match(textOf(memberId), /【需求修订】run run-r21 于 /)
    assert.match(textOf(memberId), /变更要点：改验收/)
  }

  const stored = h.store.load(RUN)
  assert.ok(stored)
  // 修订后的任务卡留痕来自纯逻辑层（revisedAt/revisionNote），这里确认桥没有把它丢掉。
  const t2 = stored.plan.tasks.find((item) => item.id === 't2')
  assert.equal(t2?.revisedAt, NOW)
  assert.equal(t2?.revisionNote, '改验收')
  // 账本 3 条成员消息 + 1 条队长告知。
  assert.equal(stored.messages.length, 4)
  assert.equal(stored.messages[3].to, 'user')
})

test('revise：单个成员通知失败只记 notice，不得留下「已送达」的账本消息', async () => {
  const h = createHarness({
    interrupt: async () => ({ ok: false, error: '忙' }),
    send: async (memberId) =>
      memberId === 'member-t3' ? { ok: false, error: '成员离线' } : { ok: true },
  })
  seedThreeRunning(h)
  const result = await h.bridge.revise(SESSION, RUN, {
    goal: '统一改需求',
    changeSummary: '改验收',
    cancelledTaskIds: ['t1'],
    tasks: [{ id: 't2', title: '新任务 t2', roleId: 'dev', acceptance: 'exit 22' }],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.notified, ['开发-1', '开发-2'])
  assert.deepEqual(result.notifyFailed, [{ name: '开发-3', error: '成员离线' }])

  const stored = h.store.load(RUN)
  assert.ok(stored)
  assert.equal(stored.messages.filter((item) => item.to === '开发-3').length, 0)
  const notice = stored.messages[stored.messages.length - 1]
  assert.equal(notice.to, 'user')
  assert.match(notice.body, /修订通知失败：开发-3（成员离线）/)
})

test('revise：最后一批任务全作废 → terminated + finishedAt + termination.reason 一次落盘', async () => {
  const h = createHarness()
  seed(h.store, runStateOf({ plan: planOf({ tasks: [taskOf('t1', 'running')] }) }))
  const result = await h.bridge.revise(SESSION, RUN, { goal: '全换掉', cancelledTaskIds: ['t1'] })
  assert.equal(result.ok, true)
  assert.equal(result.plan.status, 'terminated')

  const stored = h.store.load(RUN)
  assert.ok(stored)
  assert.equal(stored.plan.status, 'terminated')
  assert.equal(stored.finishedAt, NOW)
  assert.deepEqual(stored.termination, { reason: '需求修订后本次运行已无待执行任务', kind: 'superseded' })
  const notice = stored.messages[stored.messages.length - 1]
  assert.equal(notice.to, 'user')
  assert.match(notice.body, /本次运行已无待执行任务，run 已终止（原因：需求修订）/)

  // 历史列表（store.list）必须能直接回答「为什么停了」：终止原因与结束时刻同一来源。
  const summary = h.store.list().find((item) => item.runId === RUN)
  assert.equal(summary?.status, 'terminated')
  assert.equal(summary?.finishedAt, NOW)
  assert.equal(summary?.terminationReason, '需求修订后本次运行已无待执行任务')
  assert.equal(summary?.ongoing, 0)
  assert.equal(summary?.active, false)
})

test('revise：被作废任务的下游转 blocked 并写明等待上游（只改直接下游）', async () => {
  const h = createHarness()
  const plan = planOf({
    tasks: [
      taskOf('t1', 'running'),
      taskOf('t2', 'pending', { dependsOn: ['t1'] }),
      taskOf('t3', 'pending', { dependsOn: ['t2'] }),
    ],
  })
  seed(h.store, runStateOf({ plan, bindings: [bindingOf('t1', '开发-1')] }))
  await h.bridge.revise(SESSION, RUN, { goal: '砍掉 t1', cancelledTaskIds: ['t1'] })

  const stored = h.store.load(RUN)
  assert.ok(stored)
  const t2 = stored.plan.tasks.find((item) => item.id === 't2')
  assert.equal(t2?.status, 'blocked')
  assert.deepEqual(t2?.waitingOn, ['t1'])
  assert.equal(t2?.waitReason, '上游 t1 已在需求修订中作废')
  // 只转直接下游：t3 挂的是 t2，不是 t1。
  const t3 = stored.plan.tasks.find((item) => item.id === 't3')
  assert.equal(t3?.status, 'pending')
  assert.equal(t3?.waitingOn, undefined)
})

test('revise：已完成/已跳过/已取消的任务不能再作废；拒绝时零写入', async () => {
  for (const status of ['done', 'skipped', 'cancelled'] as const) {
    const h = createHarness()
    seed(h.store, runStateOf({ plan: planOf({ tasks: [taskOf('t1', 'running'), taskOf('t2', status)] }) }))
    const before = h.snapshotRuns()
    const result = await h.bridge.revise(SESSION, RUN, { goal: '都换掉', cancelledTaskIds: ['t2'] })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'BAD_REQUEST')
    assert.deepEqual(h.snapshotRuns(), before)
  }
})

test('revise：终态计划直接拒绝（代码路径与工具层一致），且不中断任何成员', async () => {
  const h = createHarness()
  seed(h.store, runStateOf({ plan: planOf({ status: 'terminated', tasks: [taskOf('t1', 'running')] }) }))
  const before = h.snapshotRuns()
  const result = await h.bridge.revise(SESSION, RUN, { goal: '再来一版' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'BAD_REQUEST')
  assert.match(result.reason, /不能并入需求修订/)
  assert.deepEqual(h.interrupted, [])
  assert.deepEqual(h.snapshotRuns(), before)
})

test('revise：run 不存在 / 不属于当前会话 → NOT_FOUND', async () => {
  const h = createHarness()
  seed(h.store, runStateOf())
  const missing = await h.bridge.revise(SESSION, 'run-nope', { goal: 'x' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'NOT_FOUND')

  const other = await h.bridge.revise('sess-other', RUN, { goal: 'x' })
  assert.equal(other.ok, false)
  assert.equal(other.code, 'NOT_FOUND')
  assert.match(other.reason, /不属于当前会话/)
  assert.deepEqual(h.interrupted, [])
})

test('revise：goal 追加「## 需求修订（时刻）」并保留原目标；revisions 只增不删', async () => {
  const h = createHarness()
  seed(h.store, runStateOf({ plan: planOf({ revisions: [{ at: NOW - 90_000, text: '上一版', updatedTaskIds: [], addedTaskIds: [], cancelledTaskIds: [] }] }) }))
  await h.bridge.revise(SESSION, RUN, { goal: '这一版的新需求', changeSummary: '补一条验收' })
  const stored = h.store.load(RUN)
  assert.ok(stored)
  assert.match(stored.plan.goal ?? '', /^原始目标\n\n## 需求修订（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）\n这一版的新需求$/)
  assert.equal(stored.plan.revisions?.length, 2)
  assert.equal(stored.plan.revisions?.[1].text, '这一版的新需求')
  assert.equal(stored.plan.revisions?.[1].changeSummary, '补一条验收')
  assert.equal(stored.plan.revisions?.[1].at, NOW)
})
