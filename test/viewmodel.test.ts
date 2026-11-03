/**
 * viewmodel 的单测。
 *
 * 存在理由（AC-18 / AC-22 / AC-30 的**可核验性**）：这几个月最容易出的事故是
 * 「界面文案和真实状态不一致」——面板写"运行中"而成员进程早死了（AC-18 反面目标）、
 * 逐角色模型显示得像生效了却没下发（AC-22）、计划还没生成就派发了（AC-30）。
 * 这些都是文本级事实，必须能被 `node --test` 断言，而不是靠 QA 眼看。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  actFeedback,
  capsuleOf,
  captainModelLabelOf,
  feedbackOf,
  formatClock,
  formatModelRoute,
  formatRelative,
  formatStamp,
  hintOf,
  ledgerBodyFoldable,
  memberRouteText,
  parseRouteText,
  peerLabelOf,
  planStatusView,
  progressOf,
  recentTriggersOf,
  routeAuditFor,
  routeTextOf,
  stalledRowOf,
  statusBadge,
  tailLines,
  viewExtras,
  STALL_LEAD,
  STALL_SUFFIX,
  STALL_TAIL,
} from '../src/client/viewmodel.ts'
import type {
  MemberView,
  PanelSnapshot,
  PlanStatus,
  PlanTask,
  RoleModelRoute,
  TaskStatus,
} from '../src/shared/types.ts'

/* ────────────────────────── 夹具 ────────────────────────── */

function taskOf(id: string, status: TaskStatus, extra: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: '能跑通',
    status,
    ...extra,
  }
}

function memberOf(id: string, status: MemberView['status'], extra: Partial<MemberView> = {}): MemberView {
  return {
    memberId: id,
    name: `成员${id}`,
    roleId: 'dev',
    status,
    lastEventAt: 1_760_000_000_000,
    modelRoute: '',
    canResume: true,
    // 停滞三字段（TECHNICAL §4 冻结）：夹具缺省「健康且运行中」，个别用例用 extra 覆盖。
    stalled: false,
    stalledForMs: 0,
    stalledSecondsText: '',
    ...extra,
  }
}

function snapshotOf(patch: Record<string, unknown> = {}): PanelSnapshot {
  return {
    enabled: true,
    tasks: [],
    members: [],
    memory: { injectedChars: 0, budget: 4000, truncated: false, files: [] },
    roles: [],
    activity: [],
    ...patch,
  } as unknown as PanelSnapshot
}

/* ────────────────────────── 胶囊：5 种 tone（DESIGN §2） ────────────────────────── */

test('胶囊：未启用显示"已关闭"，且与任何运行态都不同', () => {
  const off = capsuleOf(false, snapshotOf({ tasks: [taskOf('t1', 'running')] }))
  assert.equal(off.tone, 'idle')
  assert.equal(off.text, '已关闭')
  // 未启用时绝不能被计划/运行态覆盖（开关关着却显示运行中，是最吓人的假象）
  assert.equal(capsuleOf(false, snapshotOf({ tasks: [taskOf('t1', 'done')] })).text, '已关闭')
  assert.equal(capsuleOf(false, null).text, '已关闭')
})

test('胶囊：无计划时是"待派发"', () => {
  assert.deepEqual(capsuleOf(true, null), { tone: 'idle', text: '待派发' })
  assert.deepEqual(capsuleOf(true, snapshotOf()), { tone: 'idle', text: '待派发' })
})

test('胶囊：AC-30 —— 有计划但零成员才是"计划就绪"，且 tone 为 plan', () => {
  const cap = capsuleOf(true, snapshotOf({ tasks: [taskOf('t1', 'pending'), taskOf('t2', 'blocked'), taskOf('t3', 'ready')] }))
  assert.equal(cap.tone, 'plan')
  assert.equal(cap.text, '计划就绪 · 3 任务')
})

test('胶囊：运行中带并发三元组的分子分母', () => {
  const cap = capsuleOf(
    true,
    snapshotOf({
      tasks: [taskOf('t1', 'running'), taskOf('t2', 'gate'), taskOf('t3', 'pending')],
      members: [memberOf('m1', 'running'), memberOf('m2', 'running')],
    }),
  )
  assert.equal(cap.tone, 'run')
  assert.equal(cap.text, '运行中 2/3')
})

test('胶囊：失败与中断优先冒头（坏消息在前）', () => {
  const failed = capsuleOf(
    true,
    snapshotOf({ tasks: [taskOf('t1', 'failed'), taskOf('t2', 'running')], members: [memberOf('m1', 'running')] }),
  )
  assert.equal(failed.tone, 'fail')
  assert.equal(failed.text, '有失败 · 1')

  const interrupted = capsuleOf(true, snapshotOf({ members: [memberOf('m1', 'interrupted')] }))
  assert.equal(interrupted.tone, 'fail')
  assert.equal(interrupted.text, '已中断 · 1')
})

test('胶囊：全部通过是 done', () => {
  const cap = capsuleOf(true, snapshotOf({ tasks: [taskOf('t1', 'done'), taskOf('t2', 'done')], members: [memberOf('m1', 'done')] }))
  assert.equal(cap.tone, 'done')
  assert.equal(cap.text, '已完成 · 2 任务')
})

test('胶囊：取消/终止/暂停都要说出来，不能显示成"运行中"', () => {
  const tasks = [taskOf('t1', 'running')]
  const members = [memberOf('m1', 'running')]
  assert.equal(capsuleOf(true, snapshotOf({ tasks, members, planStatus: 'cancelled' })).text, '已取消')
  assert.equal(capsuleOf(true, snapshotOf({ tasks, members, planStatus: 'terminated' })).text, '已终止')
  assert.equal(capsuleOf(true, snapshotOf({ tasks, members, planStatus: 'paused' })).text, '已暂停')
})

test('胶囊 5 种 tone 全覆盖且文案互不重复（DESIGN 只允许 5 种）', () => {
  const cases = [
    capsuleOf(false, null),
    capsuleOf(true, snapshotOf({ tasks: [taskOf('t1', 'pending')] })),
    capsuleOf(true, snapshotOf({ tasks: [taskOf('t1', 'running')], members: [memberOf('m1', 'running')] })),
    capsuleOf(true, snapshotOf({ tasks: [taskOf('t1', 'failed')], members: [memberOf('m1', 'failed')] })),
    capsuleOf(true, snapshotOf({ tasks: [taskOf('t1', 'done')], members: [memberOf('m1', 'done')] })),
  ]
  assert.equal(new Set(cases.map((c) => c.tone)).size, 5)
  assert.equal(new Set(cases.map((c) => c.text)).size, cases.length)
  for (const cap of cases) assert.ok(cap.text.trim() !== '', '胶囊文案不能为空')
})

/* ────────────────────────── 7 态徽标 ────────────────────────── */

test('徽标：成员 7 态各有独立图标与文案（色弱也要能区分）', () => {
  const statuses = ['running', 'idle', 'blocked', 'rework', 'done', 'failed', 'interrupted'] as const
  const badges = statuses.map((status) => statusBadge(status))
  assert.equal(new Set(badges.map((b) => b.text)).size, 7, '7 态文案必须互不重复')
  assert.equal(new Set(badges.map((b) => b.icon)).size, 7, '7 态图标必须互不重复')
  for (const badge of badges) {
    assert.ok(badge.text.trim() !== '')
    assert.ok(badge.icon.trim() !== '')
  }
  assert.equal(statusBadge('running').text, '运行中')
  assert.equal(statusBadge('interrupted').text, '已中断')
})

test('徽标：任务专属态也有文案，未知状态回显原文而不是空白', () => {
  assert.equal(statusBadge('pending').text, '待派发')
  assert.equal(statusBadge('ready').text, '就绪')
  assert.equal(statusBadge('gate').text, '门禁中')
  // 宿主将来加了新状态：宁可显示原文，也不要空白（空白=用户以为坏了）
  assert.equal(statusBadge('weird_state').text, 'weird_state')
  assert.equal(statusBadge('').text, '未知')
})

/* ────────────────────────── 逐角色模型（AC-22） ────────────────────────── */

const ROUTE: RoleModelRoute = { provider: 'anthropic', model: 'claude-sonnet-4', reasoningEffort: 'high' }

test('模型路由：未配置时说"会话默认模型"，不假装有模型', () => {
  assert.equal(formatModelRoute(null), '会话默认模型')
  assert.equal(formatModelRoute({ provider: '  ', model: '' }), '会话默认模型')
})

test('AC-22：已配置但无审计时必须显式标"未下发"（禁止静默回退）', () => {
  const text = formatModelRoute(ROUTE)
  assert.ok(text.includes('anthropic/claude-sonnet-4 #high'), `路由要逐字展示，实际：${text}`)
  assert.ok(text.includes('未下发'), `缺审计必须标未下发，实际：${text}`)
})

test('AC-22：审计 ok / drift / unverified 三档文案各不相同', () => {
  const ok = formatModelRoute(ROUTE, { taskId: 't1', roleId: 'dev', declared: ROUTE, actual: ROUTE, at: 1, verdict: 'ok' })
  const drift = formatModelRoute(ROUTE, {
    taskId: 't1',
    roleId: 'dev',
    declared: ROUTE,
    actual: { provider: 'openai', model: 'gpt-x' },
    at: 2,
    verdict: 'drift',
  })
  const unverified = formatModelRoute(ROUTE, { taskId: 't1', roleId: 'dev', declared: ROUTE, actual: null, at: 3, verdict: 'unverified' })
  assert.ok(ok.includes('已核对'), ok)
  assert.ok(drift.includes('路由漂移'), drift)
  assert.ok(drift.includes('openai/gpt-x'), `漂移要带上实际路由，实际：${drift}`)
  assert.ok(unverified.includes('未下发'), unverified)
  assert.equal(new Set([ok, drift, unverified]).size, 3)
})

test('模型路由：文本与结构互转一致（老字段 modelRoute 是字符串）', () => {
  assert.equal(routeTextOf(ROUTE), 'anthropic/claude-sonnet-4 #high')
  assert.deepEqual(parseRouteText('anthropic/claude-sonnet-4 #high'), ROUTE)
  assert.deepEqual(parseRouteText('openai/gpt-x'), { provider: 'openai', model: 'gpt-x' })
  assert.equal(parseRouteText(''), null)
  assert.equal(parseRouteText('   '), null)
  assert.equal(routeTextOf(null), '')
})

test('AC-22：成员行路由走审计表，取最近一条', () => {
  const audits = [
    { taskId: 't1', roleId: 'dev', declared: ROUTE, actual: null, at: 10, verdict: 'unverified' as const },
    {
      taskId: 't1',
      roleId: 'dev',
      declared: ROUTE,
      actual: ROUTE,
      at: 20,
      verdict: 'ok' as const,
    },
  ]
  assert.equal(routeAuditFor(audits, { taskId: 't1' })?.at, 20)
  assert.equal(routeAuditFor(audits, { roleId: 'qa' }), undefined)
  const member = memberOf('m1', 'running', { taskId: 't1', modelRoute: 'anthropic/claude-sonnet-4 #high' })
  assert.ok(memberRouteText(member, audits).includes('已核对'), memberRouteText(member, audits))
  assert.ok(memberRouteText(member).includes('未下发'), '没有审计时必须标未下发')
})

/* ────────────────────────── 时间与尾部 ────────────────────────── */

test('时间格式：非法值给"—"，正确值给本地秒级时钟', () => {
  assert.equal(formatClock(undefined), '—')
  assert.equal(formatClock(0), '—')
  assert.equal(formatClock(Number.NaN), '—')
  const at = new Date(2026, 9, 30, 1, 2, 3).getTime()
  assert.equal(formatClock(at), '01:02:03')
  assert.equal(formatStamp(at), '10-30 01:02:03')
  assert.equal(formatStamp(undefined), '—')
})

test('相对时间：按秒/分/时/天分档，未来时间不出现负数', () => {
  const now = 1_760_000_000_000
  assert.equal(formatRelative(now - 1_000, now), '刚刚')
  assert.equal(formatRelative(now - 30_000, now), '30 秒前')
  assert.equal(formatRelative(now - 5 * 60_000, now), '5 分钟前')
  assert.equal(formatRelative(now - 3 * 3_600_000, now), '3 小时前')
  assert.equal(formatRelative(now - 2 * 86_400_000, now), '2 天前')
  assert.equal(formatRelative(now + 60_000, now), '刚刚')
  assert.equal(formatRelative(undefined, now), '—')
})

test('尾部截取：取末 n 行、忽略结尾空行、n 非法给空数组', () => {
  const text = Array.from({ length: 10 }, (_, index) => `line${index + 1}`).join('\n') + '\n\n'
  assert.deepEqual(tailLines(text, 3), ['line8', 'line9', 'line10'])
  assert.deepEqual(tailLines(text, 100).length, 10)
  assert.deepEqual(tailLines(text, 0), [])
  assert.deepEqual(tailLines('', 5), [])
  assert.deepEqual(tailLines(null, 5), [])
  assert.deepEqual(tailLines('a\r\nb\r\n', 2), ['a', 'b'])
})

/* ────────────────────────── 运行时投影（容忍新字段缺席） ────────────────────────── */

test('投影：老快照缺新字段时降级而不是崩（消息空、并发给默认 3、plannedAt 缺省）', () => {
  const extras = viewExtras(snapshotOf({ tasks: [taskOf('t1', 'running'), taskOf('t2', 'gate')] }))
  assert.deepEqual(extras.messages, [])
  assert.deepEqual(extras.routeAudits, [])
  assert.equal(extras.concurrency.limit, 3)
  assert.equal(extras.concurrency.running, 2)
  assert.equal(extras.concurrency.source, 'default')
  assert.equal(extras.plannedAt, undefined)
})

test('投影：新字段齐全时逐字保留（消息账本是 AC-16 的证据）', () => {
  const extras = viewExtras(
    snapshotOf({
      plannedAt: 1_760_000_000_000,
      messages: [{ at: 1_760_000_000_001, from: 'captain', to: 'member:m1', toMemberId: 'm1', taskId: 't1', body: '开始吧' }],
      routeAudits: [{ taskId: 't1', roleId: 'dev', declared: ROUTE, at: 5, verdict: 'ok' }],
      concurrency: { limit: 5, running: 2, source: 'host' },
    }),
  )
  assert.equal(extras.plannedAt, 1_760_000_000_000)
  assert.equal(extras.messages.length, 1)
  assert.equal(extras.messages[0]?.from, 'captain')
  assert.equal(extras.messages[0]?.taskId, 't1')
  assert.equal(extras.routeAudits[0]?.verdict, 'ok')
  assert.deepEqual(extras.concurrency, { limit: 5, running: 2, source: 'host', requested: 5, clamped: false })
})

test('并发：设置大于实际生效时必须标记 clamped 且保留用户填的值（R2 / QA-R7-03）', () => {
  const clamped = viewExtras(
    snapshotOf({ concurrency: { limit: 3, running: 0, source: 'host', requested: 6, clamped: true } }),
  )
  assert.equal(clamped.concurrency.limit, 3)
  assert.equal(clamped.concurrency.requested, 6)
  assert.equal(clamped.concurrency.clamped, true)

  // 老快照（没有 requested/clamped）必须按「没被夹」降级，不能凭空报一句夹取说明。
  const legacy = viewExtras(snapshotOf({ concurrency: { limit: 3, running: 0, source: 'host' } }))
  assert.equal(legacy.concurrency.requested, 3)
  assert.equal(legacy.concurrency.clamped, false)
})

/* ────────────────────────── 动作回执（唯一解包口） ────────────────────────── */

test('回执：成功、业务拒绝、传输失败三种都要有话可说', () => {
  const okResult = feedbackOf({ data: { snapshot: snapshotOf(), notices: ['已派发 2 个任务'] } })
  assert.equal(okResult.ok, true)
  assert.deepEqual(okResult.notices, ['已派发 2 个任务'])
  assert.equal(hintOf(okResult), '已派发 2 个任务')

  const rejected = feedbackOf({ data: { snapshot: snapshotOf(), rejected: { code: 'NO_PLAN', message: '还没有计划' } } })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.message, '还没有计划')
  assert.equal(hintOf(rejected), '还没有计划')

  const transport = feedbackOf({ error: '网络断了' })
  assert.equal(transport.ok, false)
  assert.equal(hintOf(transport), '网络断了')

  const empty = feedbackOf({})
  assert.equal(empty.ok, true)
  assert.equal(hintOf(empty), undefined)
})

test('回执：脚手架的裸快照返回也要认（兼容期不出现"点了没反应"）', () => {
  const feedback = feedbackOf({ data: snapshotOf({ tasks: [taskOf('t1', 'pending')] }) })
  assert.equal(feedback.ok, true)
  assert.deepEqual(feedback.notices, [])
})

test('回执：拒绝但宿主没给原因时给一句能读的话', () => {
  const feedback = feedbackOf({ data: { rejected: { code: 'CONCURRENCY_FULL' } } })
  assert.equal(feedback.ok, false)
  assert.equal(hintOf(feedback), 'CONCURRENCY_FULL')
  const blank = feedbackOf({ data: { rejected: {} } })
  assert.equal(hintOf(blank), '动作被拒绝')
})

test('回执：act 抛错也要变成一句能读的话（否则按钮永远停在 busy，表现为"点了没反应"）', async () => {
  const thrown = await actFeedback(async () => {
    throw new Error('宿主动作路由未注册')
  }, { type: 'cancel' })
  assert.equal(thrown.ok, false)
  assert.equal(hintOf(thrown), '宿主动作路由未注册')

  const okFeedback = await actFeedback(async () => ({ data: { snapshot: snapshotOf(), notices: ['已取消'] } }), { type: 'cancel' })
  assert.equal(okFeedback.ok, true)
  assert.equal(hintOf(okFeedback), '已取消')
})

/* ────────────────────────── 端到端：一次完整运行的状态机 ────────────────────────── */

test('端到端：计划→派发→门禁→失败→返工→重跑→全绿，每一态的胶囊/徽标/账本都可核验', () => {
  const t0 = 1_760_000_000_000
  const ledger: Array<Record<string, unknown>> = []
  const push = (patch: Record<string, unknown>) => {
    const snap = snapshotOf({ messages: [...ledger], ...patch })
    return { snap, cap: capsuleOf(true, snap), extras: viewExtras(snap) }
  }

  // ① 计划就绪：有计划、零成员 —— AC-30 的可视证据（此时绝不该显示"运行中"）
  const planned = push({
    plannedAt: t0,
    planStatus: 'draft',
    tasks: [taskOf('t1', 'pending'), taskOf('t2', 'blocked', { dependsOn: ['t1'] })],
  })
  assert.equal(planned.cap.text, '计划就绪 · 2 任务')
  assert.equal(planned.cap.tone, 'plan')
  assert.equal(planned.extras.plannedAt, t0)
  assert.equal(planned.snap.members.length, 0, 'AC-30：计划条目必须早于首个成员创建')

  // ② 派发中：t1 开跑、下游 t2 仍阻塞
  ledger.push({ at: t0 + 1_000, from: 'captain', to: 'member:m1', toMemberId: 'm1', taskId: 't1', body: '执行 t1' })
  const dispatched = push({
    plannedAt: t0,
    planStatus: 'dispatching',
    tasks: [taskOf('t1', 'running', { memberId: 'm1' }), taskOf('t2', 'blocked', { dependsOn: ['t1'] })],
    members: [memberOf('m1', 'running', { taskId: 't1', lastEventAt: t0 + 1_000 })],
    concurrency: { limit: 2, running: 1, source: 'host' },
  })
  assert.equal(dispatched.cap.text, '运行中 1/2')
  assert.equal(dispatched.cap.tone, 'run')
  assert.equal(dispatched.extras.concurrency.source, 'host')
  assert.equal(dispatched.extras.messages.length, 1, 'AC-16：直达消息进账本')

  // ③ 门禁中：任务进 gate，徽标是"门禁中"而不是"运行中"
  assert.equal(statusBadge('gate').text, '门禁中')
  assert.equal(statusBadge('gate').tone, 'warn')

  // ④ 首次失败：胶囊转为 fail，返工消息带 taskId 可追溯
  ledger.push({ at: t0 + 2_000, from: 'captain', to: 'member:m1', toMemberId: 'm1', taskId: 't1', body: '返工：测试未过' })
  const failed = push({
    plannedAt: t0,
    tasks: [taskOf('t1', 'failed', { memberId: 'm1' }), taskOf('t2', 'blocked', { dependsOn: ['t1'] })],
    members: [memberOf('m1', 'failed', { taskId: 't1' })],
    routeAudits: [{ taskId: 't1', roleId: 'dev', declared: ROUTE, actual: ROUTE, at: t0 + 2_000, verdict: 'ok' }],
  })
  assert.equal(failed.cap.text, '有失败 · 1')
  assert.equal(failed.cap.tone, 'fail')
  assert.equal(failed.extras.messages.length, 2)
  assert.equal(failed.extras.messages[1]?.taskId, 't1')
  // AC-19：下游任务保持阻塞，绝不因为上游失败而放行
  assert.equal(failed.snap.tasks[1]?.status, 'blocked', '上游失败时下游必须仍是 blocked')

  // ⑤ 成员进程死掉：面板必须说"已中断"（AC-18 反面目标：不能显示运行中）
  const interrupted = push({
    tasks: [taskOf('t1', 'rework', { memberId: 'm1' }), taskOf('t2', 'blocked', { dependsOn: ['t1'] })],
    members: [memberOf('m1', 'interrupted', { taskId: 't1' })],
  })
  assert.equal(interrupted.cap.text, '已中断 · 1')
  assert.equal(interrupted.cap.tone, 'fail')
  assert.equal(statusBadge('interrupted').text, '已中断')

  // ⑥ 续聊后两条并行跑起来
  const running = push({
    tasks: [taskOf('t1', 'running', { memberId: 'm1' }), taskOf('t2', 'running', { memberId: 'm2' })],
    members: [memberOf('m1', 'running', { taskId: 't1' }), memberOf('m2', 'running', { taskId: 't2' })],
    concurrency: { limit: 3, running: 2, source: 'default' },
  })
  assert.equal(running.cap.text, '运行中 2/3')

  // ⑦ 终态：全部通过
  const done = push({
    tasks: [taskOf('t1', 'done'), taskOf('t2', 'done')],
    members: [memberOf('m1', 'done'), memberOf('m2', 'done')],
  })
  assert.equal(done.cap.text, '已完成 · 2 任务')
  assert.equal(done.cap.tone, 'done')

  // 整个流程的胶囊文案互不相同（没有两态混成一句话）
  const texts = [planned, dispatched, failed, interrupted, running, done].map((step) => step.cap.text)
  assert.equal(new Set(texts).size, texts.length, `不同状态不能共用文案：${texts.join(' | ')}`)
})

/* ──────────────── 停滞条：AC-12 / AC-14 的文本级事实 ──────────────── */

test('停滞条：运行中 + 宿主判 stalled 才渲染，秒数原样用宿主下发的文本', () => {
  const row = stalledRowOf(
    memberOf('m1', 'running', { stalled: true, stalledForMs: 92_000, stalledSecondsText: '92 秒' }),
  )
  assert.equal(row.show, true, 'running 且 stalled=true 必须渲染停滞条')
  assert.equal(row.secondsText, '92 秒', '秒数只放宿主下发的字符串，客户端不做换算')
  // 逐字来自 DESIGN §7.5：必须同时写清「还活着」与「没有实质产出」，否则会被读成「已中断」
  assert.equal(row.text, `⏳ ${STALL_LEAD} 92 秒 ${STALL_TAIL}`)
  assert.ok(row.text.includes('活着'), `文案必须点明成员还活着：${row.text}`)
  assert.ok(row.text.includes('没有实质产出'), `文案必须点明没有实质产出：${row.text}`)
  assert.ok(row.text.includes('92 秒'), `文案必须带距上次产出的秒数：${row.text}`)
})

test('停滞条：interrupted / failed 永不渲染，哪怕宿主误标 stalled', () => {
  // AC-12 / PRD 反面目标 4：停滞是「活着但没产出」，已中断是「已经出事」——两者不能互相顶替
  for (const status of ['interrupted', 'failed'] as const) {
    const row = stalledRowOf(
      memberOf('m1', status, { stalled: true, stalledForMs: 100_000, stalledSecondsText: '100 秒' }),
    )
    assert.equal(row.show, false, `${status} 不得渲染停滞条`)
    assert.equal(row.text, '', `${status} 不得带停滞文案`)
  }
  // 文案本身不能与「已中断」共用一句话（AC-14 的可区分性）
  assert.notEqual(statusBadge('interrupted').text, STALL_SUFFIX)
  const running = stalledRowOf(
    memberOf('m1', 'running', { stalled: true, stalledForMs: 92_000, stalledSecondsText: '92 秒' }),
  )
  assert.ok(!running.text.includes('中断'), `停滞文案不得含「中断」：${running.text}`)
})

test('停滞条：判定只认 stalled 字段，不看 stalledForMs（阈值只有一个出口）', () => {
  // 若客户端拿 stalledForMs > 0 自己判，watcher 改阈值就会与面板分叉
  const noFlag = stalledRowOf(
    memberOf('m1', 'running', { stalled: false, stalledForMs: 999_000, stalledSecondsText: '999 秒' }),
  )
  assert.equal(noFlag.show, false, 'stalled=false 时哪怕毫秒数很大也不许自己判停滞')
  const flagged = stalledRowOf(
    memberOf('m1', 'running', { stalled: true, stalledForMs: 0, stalledSecondsText: '90 秒' }),
  )
  assert.equal(flagged.show, true, 'stalled=true 时毫秒数再小也照宿主判定渲染')
})

test('停滞条：旧快照缺三字段按未停滞处理，不抛错（向后兼容）', () => {
  const legacy = {
    memberId: 'm1',
    name: '成员m1',
    roleId: 'dev',
    status: 'running',
    lastEventAt: 1_760_000_000_000,
    modelRoute: '',
    canResume: true,
  } as unknown as MemberView
  const row = stalledRowOf(legacy)
  assert.equal(row.show, false, '缺 stalled 字段时不得渲染停滞条')
  assert.equal(row.text, '')
})

test('停滞条：秒数缺失时显示占位符，客户端绝不自己从毫秒格式化', () => {
  const row = stalledRowOf(
    memberOf('m1', 'running', { stalled: true, stalledForMs: 92_000, stalledSecondsText: '   ' }),
  )
  assert.equal(row.show, true)
  assert.equal(row.secondsText, '—', '没有宿主文本就用占位符，不造第二份格式化实现')
  assert.ok(!row.text.includes('92'), `不得由 92000ms 反推秒数：${row.text}`)
})

/* ──────────────── 账本：来源标签与正文折叠（AC-14 可见侧） ──────────────── */

test('账本来源：captain→队长、peer→上游直投，成员名原样保留', () => {
  assert.equal(peerLabelOf('captain'), '队长')
  assert.equal(peerLabelOf('peer'), '上游直投', '直投记录必须与队长转述可区分')
  assert.equal(peerLabelOf('测试-2'), '测试-2', '成员名原样显示，不要套标签')
  assert.equal(peerLabelOf('  peer  '), '上游直投', '宿主值带空白也要认')
  assert.equal(peerLabelOf(undefined), '')
})

test('账本折叠：≤120 字且 ≤3 行不折叠，超出任一阈值就折叠', () => {
  assert.equal(ledgerBodyFoldable('回到主线，先补门禁证据。'), false)
  // 边界：正好 120 字 / 3 行都还在阈值内
  assert.equal(ledgerBodyFoldable('字'.repeat(120)), false)
  assert.equal(ledgerBodyFoldable('第一行\n第二行\n第三行'), false)
  // 超一个字符就折叠
  assert.equal(ledgerBodyFoldable('字'.repeat(121)), true)
  assert.equal(ledgerBodyFoldable('一\n二\n三\n四'), true, '超过 3 行必须折叠')
  // 直投正文（800 字 + 多行）一定折叠
  const handoff = [
    '【上游直投】t1 worker 已完成',
    '命令：pnpm test',
    `证据尾部：${'证'.repeat(800)}`,
    '产物：lib/index.js',
  ].join('\n')
  assert.equal(ledgerBodyFoldable(handoff), true)
})

/* ──────────────── r5：最近推进条与队长模型三态（AC-2 / AC-17） ──────────────── */

test('最近推进：取最后 3 条带 source 的事件，最新在前，缺省来源的历史事件不渲染', () => {
  const activity = [
    { at: 1, kind: 'plan', text: '计划已生成' }, // 无 source = 历史事件
    { at: 2, kind: 'status', text: '因「依赖完成」推进：已派发 1 个任务', source: 'trigger' },
    { at: 3, kind: 'message', text: '你把失败证据发回成员', source: 'user' },
    { at: 4, kind: 'gate', text: '因「门禁失败」推进：任务转 rework', source: 'trigger' },
    { at: 5, kind: 'rework', text: '因「超时无产出」推进：已派发 resume', source: 'trigger' },
  ] as unknown as PanelSnapshot['activity']

  const rows = recentTriggersOf(snapshotOf({ activity }))
  assert.equal(rows.length, 3, '默认最多 3 条')
  // 最新在前：5 → 4 → 3，且第 1 条（无 source）绝不出现
  assert.deepEqual(
    rows.map((row) => row.at),
    [5, 4, 3],
  )
  assert.deepEqual(
    rows.map((row) => row.sourceLabel),
    ['自动', '自动', '用户'],
  )
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['rework', 'gate', 'message'],
  )
  assert.ok(
    rows.every((row) => row.text !== ''),
    '文案由 host 侧写成中文原因，客户端不重写',
  )
  // 客户端不自己算时钟：与既有 formatClock 同源逐字相等
  assert.equal(rows[0]?.clock, formatClock(5))
  assert.equal(recentTriggersOf(snapshotOf({ activity }), 0).length, 0, 'limit=0 → 空')
  assert.equal(recentTriggersOf(null).length, 0)
  assert.equal(recentTriggersOf(undefined).length, 0)
})

test('最近推进：只带 source 的才算「推进」，且空文案不留空行', () => {
  const activity = [
    { at: 1, kind: 'status', text: '自动推进了一次', source: 'trigger' },
    { at: 2, kind: 'status', text: '   ', source: 'trigger' }, // 空文案跳过
    { at: 3, kind: 'tool', text: '', source: 'user' },
  ] as unknown as PanelSnapshot['activity']
  const rows = recentTriggersOf(snapshotOf({ activity }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.text, '自动推进了一次')
  assert.equal(rows[0]?.sourceLabel, '自动')
})

test('队长模型三态：configured 才显路由，host-default 是 muted，unsupported 必须说"未生效"', () => {
  const configured = captainModelLabelOf({
    value: 'anthropic/claude-sonnet-4 #high',
    route: { provider: 'anthropic', model: 'claude-sonnet-4', reasoningEffort: 'high' },
    source: 'configured',
    note: '已生效',
  })
  assert.equal(configured.tone, 'ok')
  assert.match(configured.label, /anthropic\/claude-sonnet-4/)

  const hostDefault = captainModelLabelOf({ value: null, route: null, source: 'host-default', note: '未配置' })
  assert.equal(hostDefault.tone, 'muted')
  assert.doesNotMatch(hostDefault.label, /anthropic/, '跟随宿主默认不得暗示已指定模型')

  const unsupported = captainModelLabelOf({
    value: 'anthropic/claude-sonnet-4 #high',
    route: { provider: 'anthropic', model: 'claude-sonnet-4', reasoningEffort: 'high' },
    source: 'unsupported',
    note: '宿主不支持',
  })
  assert.equal(unsupported.tone, 'warn')
  assert.match(unsupported.label, /未生效/, 'unsupported 不得显示成已生效（anti-goal 5）')
  assert.doesNotMatch(unsupported.label, /anthropic/, '不支持时不要回显一个用不上的路由')

  // 三态文案必须互不相同——否则用户在面板上看不出模型到底有没有生效
  assert.equal(new Set([configured.label, hostDefault.label, unsupported.label]).size, 3)

  // 未投影（旧宿主）→ muted，且不能假装成 configured
  assert.deepEqual(captainModelLabelOf(null), { label: '队长模型 · 未投影', tone: 'muted' })
  assert.deepEqual(captainModelLabelOf(undefined), { label: '队长模型 · 未投影', tone: 'muted' })
})

/* ──────────────────── 任务 10 态进度（AC-14 判据落点） ──────────────────── */

const ALL_TASK_STATUSES: TaskStatus[] = [
  'pending',
  'ready',
  'blocked',
  'rework',
  'running',
  'paused',
  'gate',
  'done',
  'failed',
  'interrupted',
]

test('进度：TaskStatus 10 态逐一有中文标签、颜色与百分比（AC-14）', () => {
  const rows = ALL_TASK_STATUSES.map((status) => progressOf(taskOf(`t-${status}`, status)))
  assert.equal(rows.length, 10)

  for (const [index, status] of ALL_TASK_STATUSES.entries()) {
    const row = rows[index]!
    assert.equal(row.status, status)
    // 标签必须与徽标表逐字一致 —— 单一文案源，防「同一状态两处文案」漂移
    assert.equal(row.label, statusBadge(status).text, `${status} 的标签必须来自 statusBadge`)
    // 回显英文原文 = 根本没映射（本轮最容易漏的正是 paused 那一态）
    assert.notEqual(row.label, status, `${status} 不得把英文原文当标签`)
    assert.ok(row.label.trim() !== '', `${status} 标签不能为空`)
  }

  assert.equal(new Set(rows.map((row) => row.label)).size, 10, '10 态中文标签必须互不重复')
  assert.deepEqual(
    new Set(rows.map((row) => row.tone)),
    new Set(['ok', 'warn', 'bad', 'muted']),
    '四种 tone 都要用上（色弱/暗色主题下靠颜色 + 文案双重区分）',
  )
})

test('进度：百分比边界与单调性（done 满、失败归零、暂停冻结在中途）', () => {
  const percentOf = (status: TaskStatus) => progressOf(taskOf('t', status)).percent
  assert.equal(percentOf('done'), 100)
  assert.equal(percentOf('pending'), 0)
  assert.equal(percentOf('failed'), 0)
  assert.equal(percentOf('interrupted'), 0)
  assert.equal(percentOf('ready'), 10)
  assert.equal(percentOf('blocked'), 20)
  assert.equal(percentOf('rework'), 40)
  assert.equal(percentOf('running'), 50)
  assert.equal(percentOf('paused'), 50, '暂停冻结在中途：既不能假装完成也不能假装没开始')
  assert.equal(percentOf('gate'), 80)

  for (const status of ALL_TASK_STATUSES) {
    const percent = percentOf(status)
    assert.ok(Number.isFinite(percent), `${status} 百分比不能是 NaN`)
    assert.ok(percent >= 0 && percent <= 100, `${status} 百分比越界`)
    assert.equal(Number.isInteger(percent), true, `${status} 百分比必须是整数（进度条不画半像素）`)
  }
})

test('进度：暂停是琥珀不是红（DESIGN §0.4「暂停永不用红」）', () => {
  const paused = progressOf(taskOf('t1', 'paused'))
  assert.equal(paused.label, '已暂停')
  assert.equal(paused.tone, 'warn')
  // 可分辨性：暂停绝不能与「失败 / 已中断」同色，也不能与「运行中」同色
  assert.notEqual(paused.tone, progressOf(taskOf('t1', 'failed')).tone)
  assert.notEqual(paused.tone, progressOf(taskOf('t1', 'interrupted')).tone)
  assert.notEqual(paused.tone, progressOf(taskOf('t1', 'running')).tone)

  const badge = statusBadge('paused')
  assert.equal(badge.icon, '⏸', '暂停图标必须与失败 ✕ / 中断 ⚡ 区分')
  assert.equal(badge.text, '已暂停')
  assert.equal(badge.tone, 'warn')
})

test('进度：状态缺失或未知一律回落 pending，不出现 NaN/空标签', () => {
  const unknown = { ...taskOf('t1', 'pending'), status: 'weird_state' } as unknown as PlanTask
  const row = progressOf(unknown)
  assert.equal(row.status, 'pending')
  assert.equal(row.label, '待派发')
  assert.equal(row.percent, 0)

  const missing = {
    id: 't2',
    title: 'x',
    roleId: 'dev',
    dependsOn: [],
    acceptance: '',
    status: undefined,
  } as unknown as PlanTask
  assert.equal(progressOf(missing).label, '待派发')
  assert.equal(progressOf(missing).percent, 0)
})

/* ──────────────────── 计划状态中文（AC-14 页头 chip） ──────────────────── */

test('计划状态：5 态全映射为中文，无计划走「未启用」', () => {
  const cases: [PlanStatus, string, string][] = [
    ['draft', '计划就绪', 'ok'],
    ['dispatching', '派发中', 'ok'],
    ['paused', '已暂停', 'warn'],
    ['terminated', '已终止', 'muted'],
    ['cancelled', '已取消', 'muted'],
  ]
  for (const [status, label, tone] of cases) {
    assert.deepEqual(planStatusView(status), { label, tone }, `${status} 的中文与 tone`)
  }
  assert.equal(new Set(cases.map((item) => item[1])).size, 5, '5 态中文必须互不重复')
  assert.deepEqual(planStatusView(undefined), { label: '未启用', tone: 'muted' })
  // 计划暂停与任务暂停同词（都叫「已暂停」），但语义分层：一个是整条流水线，一个是单条任务
  assert.equal(planStatusView('paused').label, progressOf(taskOf('t', 'paused')).label)
})

/* ══════════════════════════════════════════════════════════════════════════
 * r13 视图装配层：token / 用时 / 流转图 / run 详情 / 确认弹窗 / 记忆行
 *
 * 这一批断言的共同主题是「不造假」：取不到的用量必须显示「不可得」而不是 0/-、
 * 用时文本必须逐字来自宿主（客户端不许自己拼「分/小时」）、左右栏必须走同一个
 * `buildRunDetail` 才能 deep equal。任何一条红都意味着面板会开始说假话。
 * ══════════════════════════════════════════════════════════════════════════ */

import {
  FLOW_COLUMN_STEP,
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH,
  FLOW_PADDING,
  FLOW_ROW_STEP,
  NOT_STARTED_TEXT,
  TASK_TABLE_HEADER,
  UNAVAILABLE_TEXT,
  buildFlow,
  buildRunDetail,
  buildTaskDetail,
  compactTokenTextOf,
  confirmDialogOf,
  confirmVerbOf,
  durationTextOf,
  durationTitleOf,
  flowLayoutOf,
  flowNodeViewOf,
  inflightOf,
  memoryRowOf,
  roleChipsOf,
  roleUsageOf,
  runHeadOf,
  taskDetailOf,
  taskRowOf,
  tokenTextOf,
  tokenTitleOf,
  usageCellOr,
} from '../src/client/viewmodel.ts'
import type {
  DurationCell,
  FlowView,
  MemoryItemView,
  PendingConfirmationView,
  Role,
  RunDetailView,
  TaskDetailView,
  UsageCell,
} from '../src/shared/types.ts'

const providerCell = (total: number, input?: number, output?: number): UsageCell => ({
  source: 'provider',
  tokens: { total, ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }) },
})
const unavailableCell = (reason = '没有用量来源'): UsageCell => ({ source: 'unavailable', reason })
const durationCell = (text: string, state: DurationCell['state'] = 'done'): DurationCell => ({
  state,
  text,
  startAt: 1_760_000_000_000,
  endAt: 1_760_000_010_000,
  ms: 10_000,
})

/* ──────────────────── token：三态必须一眼可分 ──────────────────── */

test('token 文本：0 是真数字、缺失是不可得、千分位与宿主逐字一致', () => {
  // 「花了 0 token」是真话，不能和「不可得」混为一谈（AC-6 的反面）
  assert.equal(tokenTextOf(providerCell(0)), '0')
  assert.equal(tokenTextOf(providerCell(999)), '999')
  assert.equal(tokenTextOf(providerCell(1_234_567)), '1,234,567')
  assert.equal(tokenTextOf(providerCell(12_345, 10_000, 2_345)), '12,345')
  assert.equal(tokenTextOf(unavailableCell()), UNAVAILABLE_TEXT)
  assert.equal(tokenTextOf(undefined), UNAVAILABLE_TEXT)
  // 有来源但没有 total：宁可不给数，也不补 0
  assert.equal(tokenTextOf({ source: 'provider' }), UNAVAILABLE_TEXT)
  assert.notEqual(tokenTextOf(providerCell(0)), tokenTextOf(unavailableCell()), '0 与不可得必须不同')
})

test('token title：可得给输入/输出明细，不可得给原因', () => {
  assert.equal(tokenTitleOf(providerCell(1_000, 700, 300)), '合计 1,000 token · 输入 700 · 输出 300')
  assert.equal(tokenTitleOf(providerCell(42)), '合计 42 token')
  assert.equal(tokenTitleOf(unavailableCell('宿主未上报 usage')), '宿主未上报 usage')
  assert.equal(tokenTitleOf(undefined), '该处没有用量来源')
})

test('token 紧凑文本：流转节点 128px 内的量级缩写', () => {
  assert.equal(compactTokenTextOf(providerCell(999)), '999')
  assert.equal(compactTokenTextOf(providerCell(1_234)), '1.2k')
  assert.equal(compactTokenTextOf(providerCell(12_000)), '12k')
  assert.equal(compactTokenTextOf(providerCell(1_500_000)), '1.5M')
  assert.equal(compactTokenTextOf(unavailableCell()), UNAVAILABLE_TEXT)
})

test('usageCellOr：缺单元格时保留原因，绝不冒充 0', () => {
  assert.equal(usageCellOr(undefined, '没有事件').source, 'unavailable')
  assert.equal(usageCellOr(undefined, '没有事件').reason, '没有事件')
  assert.equal(usageCellOr(providerCell(7), '没有事件').tokens?.total, 7)
})

/* ──────────────────── 用时：只读宿主文本 ──────────────────── */

test('用时文本逐字来自宿主：客户端不拼「分/小时」，缺单元格是不可得', () => {
  assert.equal(durationTextOf(durationCell('3 分 12 秒')), '3 分 12 秒')
  assert.equal(durationTextOf(durationCell('1 小时 05 分')), '1 小时 05 分')
  // 未开始是状态而不是时长 —— 直接透传，不被重新计算
  assert.equal(durationTextOf({ state: 'not-started', text: NOT_STARTED_TEXT }), NOT_STARTED_TEXT)
  assert.equal(durationTextOf(undefined), UNAVAILABLE_TEXT)
  // 即便宿主给了怪文本也照抄：客户端一旦「修正」就会与门禁证据里的时间对不上
  assert.equal(durationTextOf({ state: 'done', text: '0 秒' }), '0 秒')
})

test('用时 title：四种状态各说各的前提', () => {
  assert.equal(durationTitleOf({ state: 'not-started', text: NOT_STARTED_TEXT }), '任务尚未开始')
  assert.equal(durationTitleOf({ state: 'running', text: '12 秒' }), '正在计时')
  assert.equal(durationTitleOf({ state: 'unavailable', text: UNAVAILABLE_TEXT }), '没有开始时间，算不出用时')
  assert.equal(durationTitleOf(undefined), '没有用时记录')
  assert.match(durationTitleOf(durationCell('10 秒')), /^开始 .+ · 结束 /)
})

/* ──────────────────── 任务行 / 任务详情 ──────────────────── */

test('任务行：两行式字段齐全，token 与用时同源于同一单元格', () => {
  const detail = buildTaskDetail(taskOf('t1', 'running'), {
    roleName: '全栈工程师',
    usage: providerCell(12_345),
    duration: durationCell('2 分 03 秒', 'running'),
    messageCount: 3,
  })
  assert.equal(detail.roleName, '全栈工程师')
  assert.equal(detail.usage.source, 'provider')
  assert.equal(detail.duration.state, 'running')

  const collapsed = taskRowOf(detail, false)
  assert.equal(collapsed.expanded, false)
  assert.equal(collapsed.tokenText, '12,345')
  assert.equal(collapsed.durationText, '2 分 03 秒')
  assert.deepEqual(collapsed.badge, statusBadge('running'), '行内 badge 与状态词表同源')
  assert.equal(collapsed.tokenSource, 'provider')
  assert.equal(collapsed.durationState, 'running')
  assert.equal(taskRowOf(detail, true).expanded, true)
  // 两行式：标题行与 meta 行的字段集合固定（DESIGN §2.1）
  assert.deepEqual(TASK_TABLE_HEADER, { left: '任务 · 角色 · 状态', token: 'token', duration: '用时' })
})

test('任务详情：没有计时/用量的任务显式说不可得，未开始的任务说未开始', () => {
  const notStarted = buildTaskDetail(taskOf('t1', 'pending'), { roleName: 'dev', messageCount: 0 })
  assert.equal(notStarted.usage.source, 'unavailable')
  assert.equal(notStarted.usage.reason, '该任务没有可用用量事件')
  assert.equal(notStarted.duration.state, 'not-started')
  assert.equal(notStarted.duration.text, NOT_STARTED_TEXT)

  const blocked = buildTaskDetail(taskOf('t2', 'blocked', { waitReason: '等待 t1 完成' }), {
    roleName: 'dev',
    messageCount: 0,
  })
  assert.equal(blocked.duration.state, 'not-started')
  assert.ok(blocked.waitReason, '阻塞任务必须带等待原因')

  // 已结束但没有计时来源 → 不可得（不是「未开始」，也不是 0 秒）
  const done = buildTaskDetail(taskOf('t3', 'done'), { roleName: 'dev', messageCount: 0 })
  assert.equal(done.duration.state, 'unavailable')
  assert.equal(done.duration.text, UNAVAILABLE_TEXT)
})

test('任务详情：门禁证据保留退出码、命令与输出尾部，不美化', () => {
  const detail = buildTaskDetail(
    taskOf('t1', 'done', {
      evidence: {
        taskId: 't1',
        command: 'pnpm -s typecheck',
        exitCode: 0,
        tail: 'ok\n'.repeat(20),
        artifacts: ['logs/a.txt'],
        at: 1_760_000_000_000,
      },
    }),
    { roleName: 'dev', messageCount: 2 },
  )
  const panel = taskDetailOf(detail)
  assert.ok(panel.evidence)
  assert.equal(panel.evidence.command, 'pnpm -s typecheck')
  assert.equal(panel.evidence.exitText, '退出码 0')
  assert.equal(panel.evidence.exitOk, true)
  assert.equal(panel.evidence.tail.length <= 6, true, '输出尾部最多 6 行')
  assert.deepEqual(panel.evidence.artifacts, ['logs/a.txt'])

  const timeout = buildTaskDetail(
    taskOf('t2', 'failed', {
      evidence: { taskId: 't2', command: 'sleep 999', exitCode: null, tail: '', artifacts: [], at: 1 },
    }),
    { roleName: 'dev', messageCount: 0 },
  )
  assert.equal(taskDetailOf(timeout).evidence?.exitText, '超时或被信号终止')
  assert.equal(taskDetailOf(timeout).evidence?.exitOk, false)
})

/* ──────────────────── 流转图：拓扑列 + 几何 ──────────────────── */

test('buildFlow：列 = 最长依赖深度，行 = 同列顺序，边标记上游是否完成', () => {
  const tasks = [
    taskOf('t1', 'done'),
    taskOf('t2', 'running', { dependsOn: ['t1'] }),
    taskOf('t3', 'pending', { dependsOn: ['t2'] }),
    taskOf('t4', 'pending'),
  ]
  const flow = buildFlow(tasks)
  const byId = new Map(flow.nodes.map((node) => [node.id, node]))
  assert.equal(byId.get('t1')?.column, 0)
  assert.equal(byId.get('t2')?.column, 1)
  assert.equal(byId.get('t3')?.column, 2)
  assert.equal(byId.get('t4')?.column, 0)
  assert.equal(byId.get('t1')?.row, 0)
  assert.equal(byId.get('t4')?.row, 1, '同列第二个任务往下排一行')
  assert.equal(flow.columns, 3)
  assert.equal(flow.rows, 2)
  const edges = new Map(flow.edges.map((edge) => [`${edge.from}->${edge.to}`, edge]))
  assert.equal(edges.get('t1->t2')?.upstreamDone, true)
  assert.equal(edges.get('t2->t3')?.upstreamDone, false)
  // 不存在的依赖不允许画边（脏数据不能让图崩）
  assert.equal(flow.edges.length, 2)
})

test('buildFlow：环形依赖不死循环，仍能产出完整节点', () => {
  const flow = buildFlow([
    taskOf('a', 'pending', { dependsOn: ['b'] }),
    taskOf('b', 'pending', { dependsOn: ['a'] }),
  ])
  assert.equal(flow.nodes.length, 2)
  assert.equal(flow.edges.length, 2)
  for (const node of flow.nodes) assert.equal(Number.isFinite(node.column), true)
})

test('flowLayoutOf：节点 148×56、列距 188、行距 72，边是三次贝塞尔', () => {
  const flow: FlowView = buildFlow([
    taskOf('t1', 'done'),
    taskOf('t2', 'running', { dependsOn: ['t1'] }),
  ])
  const layout = flowLayoutOf(flow)
  assert.equal(FLOW_NODE_WIDTH, 148)
  assert.equal(FLOW_NODE_HEIGHT, 56)
  assert.equal(FLOW_COLUMN_STEP, 188)
  assert.equal(FLOW_ROW_STEP, 72)
  const t1 = layout.nodes.find((entry) => entry.node.id === 't1')!
  const t2 = layout.nodes.find((entry) => entry.node.id === 't2')!
  assert.equal(t1.x, FLOW_PADDING)
  assert.equal(t1.y, FLOW_PADDING)
  assert.equal(t2.x, FLOW_PADDING + FLOW_COLUMN_STEP)
  assert.equal(layout.width, FLOW_PADDING * 2 + FLOW_NODE_WIDTH + FLOW_COLUMN_STEP)
  assert.equal(layout.height, FLOW_PADDING * 2 + FLOW_NODE_HEIGHT)
  assert.equal(layout.edges.length, 1)
  assert.match(layout.edges[0].d, /^M [\d.]+ [\d.]+ C /)
  // 边的终点在目标节点左侧内缩 2px，起点在上游节点右边缘
  assert.equal(layout.edges[0].d.startsWith(`M ${t1.x + FLOW_NODE_WIDTH} ${t1.y + FLOW_NODE_HEIGHT / 2} C `), true)
  assert.equal(layout.edges[0].d.endsWith(` ${t2.x - 2} ${t2.y + FLOW_NODE_HEIGHT / 2}`), true)
})

test('flowLayoutOf：缺端的边被跳过，不产生 NaN 坐标', () => {
  const layout = flowLayoutOf({
    nodes: [],
    edges: [{ from: 'ghost', to: 'ghost2', upstreamDone: false }],
    columns: 0,
    rows: 0,
  })
  assert.equal(layout.edges.length, 0)
  assert.equal(layout.width, FLOW_PADDING * 2 + FLOW_NODE_WIDTH)
  assert.equal(layout.height, FLOW_PADDING * 2 + FLOW_NODE_HEIGHT)
})

test('flowNodeViewOf：长 token 数字降级到紧凑写法，title 保留全文', () => {
  const flow = buildFlow([taskOf('t1', 'done')], {
    usage: { t1: providerCell(1_234_567) },
    durations: { t1: durationCell('1 小时 02 分') },
  })
  const view = flowNodeViewOf(flow.nodes[0])
  assert.equal(view.tokenText, '1.2M', '节点内超 7 字符必须降级，否则撑破 128px')
  assert.equal(view.durationText, '1 小时 02 分')
  assert.equal(view.text, '1.2M · 1 小时 02 分')
  assert.equal(view.title.includes('1,234,567'), true, '全文只放在 title 里')
  assert.equal(view.label.includes('任务 t1'), true)
})

/* ──────────────────── 角色条：部分缺来源不合计 ──────────────────── */

test('roleUsageOf：只列有任务的角色，全有来源才合计', () => {
  const roles: Role[] = [
    { id: 'dev', name: '全栈工程师' },
    { id: 'qa', name: 'QA' },
    { id: 'ops', name: '运维' },
  ] as Role[]
  const tasks: TaskDetailView[] = [
    buildTaskDetail(taskOf('t1', 'done', { roleId: 'dev' }), {
      roleName: '全栈工程师',
      usage: providerCell(1_000),
      duration: durationCell('10 秒'),
      messageCount: 0,
    }),
    buildTaskDetail(taskOf('t2', 'running', { roleId: 'dev' }), {
      roleName: '全栈工程师',
      usage: providerCell(2_500),
      duration: durationCell('20 秒'),
      messageCount: 0,
    }),
    buildTaskDetail(taskOf('t3', 'running', { roleId: 'qa' }), {
      roleName: 'QA',
      usage: providerCell(800),
      duration: durationCell('5 秒'),
      messageCount: 0,
    }),
  ]
  const usage = roleUsageOf(tasks, roles)
  assert.equal(usage.length, 2, '同角色任务合并成一条，没任务的角色不占位置')
  assert.equal(usage[0].roleId, 'dev')
  assert.equal(usage[0].name, '全栈工程师', '角色名以角色表为准')
  assert.equal(usage[0].tasks, 2)
  assert.equal(usage[0].usage.source, 'provider')
  assert.equal(usage[0].usage.tokens?.total, 3_500)
  assert.equal(usage[1].roleId, 'qa')
  assert.equal(usage[1].tasks, 1)
  // ops 在任务里没有出现 → 不占位置
  assert.equal(usage.some((row) => row.roleId === 'ops'), false)
  const chips = roleChipsOf(usage)
  assert.equal(chips[0].usageText, '3,500')
  assert.equal(chips[0].taskCount, 2)
})

test('roleUsageOf：部分任务缺用量时给「不可得」，不给出偏小的合计', () => {
  const tasks: TaskDetailView[] = [
    buildTaskDetail(taskOf('t1', 'done'), { roleName: 'dev', usage: providerCell(1_000), messageCount: 0 }),
    buildTaskDetail(taskOf('t2', 'running'), { roleName: 'dev', usage: unavailableCell(), messageCount: 0 }),
  ]
  const [row] = roleUsageOf(tasks, [])
  assert.equal(row.usage.source, 'unavailable')
  assert.equal(tokenTextOf(row.usage), UNAVAILABLE_TEXT)
  assert.equal(row.usage.tokens, undefined, '不能只把已知的一半加起来冒充合计')
  assert.equal(row.name, 'dev', '角色表查不到时回落到任务上的 roleId')
})

/* ──────────────────── run 详情：三源优先级 ──────────────────── */

/** r13 用的快照：带 runId + 一个任务 + 角色表（不影响文件顶部的通用 snapshotOf）。 */
function runSnapshotOf(extra: Partial<PanelSnapshot> = {}): PanelSnapshot {
  return {
    enabled: true,
    runId: 'run-1',
    planStatus: 'dispatching',
    tasks: [taskOf('t1', 'running')],
    members: [],
    messages: [],
    roles: [{ id: 'dev', name: '全栈工程师' } as Role],
    ...extra,
  } as PanelSnapshot
}

test('buildRunDetail：snapshot → 详情，任务用量/用时逐条对齐', () => {
  const detail = buildRunDetail({
    snapshot: runSnapshotOf({
      taskUsage: { t1: providerCell(321) },
      taskDurations: { t1: durationCell('4 分 05 秒', 'running') },
      runUsage: providerCell(321),
      runDuration: durationCell('4 分 05 秒', 'running'),
      plannedAt: 1_760_000_000_000,
      project: 'dsh-auto-team',
    }),
  })
  assert.ok(detail)
  assert.equal(detail.runId, 'run-1')
  assert.equal(detail.tasks.length, 1)
  assert.equal(tokenTextOf(detail.tasks[0].usage), '321')
  assert.equal(detail.tasks[0].duration.text, '4 分 05 秒')
  assert.equal(detail.tasks[0].roleName, '全栈工程师')
  assert.equal(detail.roles.length, 1)
  assert.equal(detail.flow.nodes.length, 1)
  assert.equal(detail.project, 'dsh-auto-team')
  assert.equal(detail.plannedAt, 1_760_000_000_000)
})

test('buildRunDetail：显式 runDetail > library.detail > snapshot', () => {
  const direct = { runId: 'run-9', sessionId: 's', planStatus: 'draft' } as unknown as RunDetailView
  const fromLibrary = { runId: 'run-8', sessionId: 's', planStatus: 'draft' } as unknown as RunDetailView
  const library = { projects: [], global: { memories: [] }, detail: fromLibrary }

  assert.equal(buildRunDetail({ snapshot: runSnapshotOf(), runDetail: direct })?.runId, 'run-9')
  assert.equal(buildRunDetail({ snapshot: runSnapshotOf(), library })?.runId, 'run-8')
  assert.equal(buildRunDetail({ snapshot: runSnapshotOf() })?.runId, 'run-1')
})

test('buildRunDetail：runId 不匹配时返回 null，绝不把 A 的详情贴到 B 的标题下', () => {
  const direct = { runId: 'run-9', sessionId: 's', planStatus: 'draft' } as unknown as RunDetailView
  // 显式详情指向别的 run、快照也对不上 → null（宁可不显示，也不贴错内容）
  assert.equal(buildRunDetail({ snapshot: runSnapshotOf({ runId: 'run-7' }), runDetail: direct }, 'run-1'), null)
  // 快照本身是 run-1 时可用快照兜底，但绝不借用 direct 的内容
  assert.equal(buildRunDetail({ snapshot: runSnapshotOf(), runDetail: direct }, 'run-1')?.runId, 'run-1')
  assert.equal(buildRunDetail({ snapshot: runSnapshotOf() }, 'run-2'), null)
  assert.equal(buildRunDetail({ snapshot: runSnapshotOf() }, 'run-1')?.runId, 'run-1')
  // 没有 run 的快照（未启用）不伪造详情
  assert.equal(buildRunDetail({ snapshot: runSnapshotOf({ runId: undefined }) }), null)
  assert.equal(buildRunDetail({ snapshot: null }), null)
})

test('buildRunDetail：run 用量缺失时聚合任务用量，全部缺失才说不可得', () => {
  const partial = buildRunDetail({
    snapshot: runSnapshotOf({
      taskUsage: { t1: providerCell(100) },
      tasks: [taskOf('t1', 'done'), taskOf('t2', 'done')],
    }),
  })!
  assert.equal(partial.usage.source, 'unavailable')
  assert.equal(partial.usage.reason, '部分任务没有可用用量事件')

  const merged = buildRunDetail({
    snapshot: runSnapshotOf({ taskUsage: { t1: providerCell(100) } }),
  })!
  assert.equal(merged.usage.source, 'provider')
  assert.equal(merged.usage.tokens?.total, 100)

  const missing = buildRunDetail({ snapshot: runSnapshotOf() })!
  assert.equal(missing.usage.source, 'unavailable')
  assert.equal(missing.duration.state, 'unavailable')
  assert.equal(runHeadOf(missing).downgrade, `token ${UNAVAILABLE_TEXT}（无用量来源）`)
})

/* ──────────────────── run 头 / 在途派发 ──────────────────── */

test('runHeadOf：无用量来源时给一行降级说明，可得时不显示', () => {
  const detail = buildRunDetail({ snapshot: runSnapshotOf() })!
  const head = runHeadOf(detail, 'dispatching')
  assert.equal(head.inflightState, 'dispatching')
  assert.equal(head.inflightText, '正在派发…')
  assert.equal(head.usageSource, 'unavailable')
  assert.equal(head.usageText, UNAVAILABLE_TEXT)
  assert.equal(head.downgrade, 'token 不可得（无用量来源）')
  assert.equal(head.windowText.endsWith('进行中'), true)

  const withUsage = buildRunDetail({
    snapshot: runSnapshotOf({ runUsage: providerCell(1_234), runDuration: durationCell('2 分 00 秒') }),
  })!
  const head2 = runHeadOf(withUsage)
  assert.equal(head2.usageText, '1,234')
  assert.equal(head2.downgrade, undefined)
  assert.equal(head2.durationText, '2 分 00 秒')
  assert.equal(head2.inflightText, '自动派发已开启')
})

test('inflightOf：三态文案与圆点，未知值回落 idle', () => {
  assert.deepEqual(inflightOf('dispatching'), { state: 'dispatching', text: '正在派发…', dot: true })
  assert.deepEqual(inflightOf('dispatched'), { state: 'dispatched', text: '已派发', dot: true })
  assert.deepEqual(inflightOf('idle'), { state: 'idle', text: '自动派发已开启', dot: false })
  assert.equal(inflightOf('bogus' as never).state, 'idle')
})

/* ──────────────────── 确认弹窗 ──────────────────── */

test('confirmDialogOf：五类不可逆动作各自有动词短语，绝不用「确定」', () => {
  const base = (action: string, taskId?: string): PendingConfirmationView => ({
    id: `pending-${action}`,
    action,
    taskId,
    runId: 'run-1',
    createdAt: 1_760_000_000_000,
    summary: '将中断 2 个运行中成员',
    irreversible: true,
    waitedText: '已等待 2 分',
  })

  const cancel = confirmDialogOf(base('cancel'))
  assert.equal(cancel.title, '确认终止运行？')
  assert.equal(cancel.confirmLabel, '终止运行')
  assert.equal(cancel.objectText, '运行 run-1')
  assert.equal(cancel.rejectLabel, '取消')
  assert.equal(cancel.waitedText, '已等待 2 分')
  assert.equal(cancel.summary, '将中断 2 个运行中成员')

  for (const [action, title] of [
    ['cancelTask', '确认中断成员？'],
    ['skipTask', '确认跳过任务？'],
    ['updateAcceptance', '确认重新门禁？'],
    ['forceParallel', '确认强制并行？'],
  ] as const) {
    const view = confirmDialogOf(base(action, 't2'))
    assert.equal(view.title, title)
    assert.equal(view.objectText, '任务 t2')
    assert.notEqual(view.confirmLabel, '确定', `${action} 的确认按钮必须是动词短语`)
    assert.equal(view.irreversibleText, '此操作不可撤销')
    assert.equal(confirmVerbOf(action).object, 'task')
  }

  // 未知动作不崩，也不冒充成某个具体动作
  assert.equal(confirmVerbOf('whatever').title, '不可逆操作')
  assert.equal(confirmDialogOf({ ...base('whatever'), waitedText: '' }).waitedText, '刚刚')
})

/* ──────────────────── 记忆行 ──────────────────── */

test('memoryRowOf：token 一律带 ≈ 且说明是估算，不是 provider 上报', () => {
  const item: MemoryItemView = {
    track: 'project',
    name: 'conventions.md',
    title: '项目约定',
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_500_000,
    tokenEstimate: 1_234,
    tokenBasis: 'estimate',
  }
  const row = memoryRowOf(item)
  assert.equal(row.key, 'project/conventions.md')
  assert.equal(row.title, '项目约定')
  assert.equal(row.tokenText, '≈1,234 token')
  assert.equal(row.tokenTitle.includes('估算'), true)
  assert.equal(row.timeText.startsWith('建立 '), true)

  // 标题缺失时用文件名（不能让列表出现空白行）
  assert.equal(memoryRowOf({ ...item, title: '' }).title, 'conventions.md')
  // 没有建立时间时只显示修改时间
  const noCreated = memoryRowOf({ ...item, createdAt: undefined })
  assert.equal(noCreated.timeText.startsWith('修改 '), true)
})


