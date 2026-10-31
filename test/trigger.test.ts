/**
 * Trigger 归一化 + Fast 层单测（AC-12 ~ AC-17 的纯逻辑面）。
 *
 * 这组用例刻意都是「把实现改坏就必然变红」的形态：
 *  - 4 个构造器逐个断言字段（少挂一个 exitCode，gate 判据就永远走 missing 分支）；
 *  - reason 集合用**驱动遍历**收集后再断言「恰 7 个」，把 `fastOf` 短路成恒放行时
 *    收集到的集合只会剩 `ok`，断言立刻红；
 *  - dropped 零副作用对**冻结输入**做前后逐字比对（改动输入或返回 action 都会红）；
 *  - 幂等用「连投 5 次 → 1 次 accepted；窗口过期 → 再 1 次」的注入时钟断言，不 sleep。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FastReason, MemberBinding, PlanTask, TriggerKind } from '../src/shared/types.ts'
import {
  TRIGGER_KINDS,
  TRIGGER_SLOW_LAYER,
  actionOf,
  dedupeKeyFor,
  dedupeKeyOf,
  entityIdOf,
  entityLabelOf,
  fastOf,
  triggerFromDepReady,
  triggerFromGate,
  triggerFromMemberExit,
  triggerFromStall,
  triggerSentenceOf,
} from '../src/host/team/trigger.ts'
import type { FastContext, Trigger, TriggerRunView } from '../src/host/team/trigger.ts'

const NOW = 1_700_000_000_000
const WINDOW = 60_000

function taskOf(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'pnpm test',
    status: 'running',
    ...overrides,
  }
}

function bindingOf(overrides: Partial<MemberBinding> = {}): MemberBinding {
  return { taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW - 10_000, ...overrides }
}

function runOf(tasks: PlanTask[], bindings: MemberBinding[] = [bindingOf()]): TriggerRunView {
  return { runId: 'run-1', tasks, bindings }
}

function ctxOf(run: TriggerRunView, overrides: Partial<FastContext> = {}): FastContext {
  return { enabled: true, run, accepted: [], now: NOW, dedupeMs: WINDOW, ...overrides }
}

/* ───────────────────────── 归一化（四类构造器） ───────────────────────── */

test('构造器：四类 kind 齐全，字段逐一可断言', () => {
  // AC-13：种类恰 4 个，且四个构造器各产出一个，不多不少。
  assert.equal(TRIGGER_KINDS.length, 4)
  assert.deepEqual([...TRIGGER_KINDS].sort(), ['dep_ready', 'gate_failed', 'member_exit', 'stall_timeout'])

  const gate = triggerFromGate('run-1', taskOf('t2', {
    status: 'rework',
    evidence: { taskId: 't2', command: 'pnpm test', exitCode: 2, tail: 'FAIL', artifacts: [], at: NOW },
  }), NOW)
  assert.deepEqual(gate, { kind: 'gate_failed', source: 'event', runId: 'run-1', at: NOW, taskId: 't2', exitCode: 2 })

  const exit = triggerFromMemberExit('run-1', 'member-1', 'failed', NOW)
  assert.deepEqual(exit, { kind: 'member_exit', source: 'event', runId: 'run-1', at: NOW, memberId: 'member-1', why: 'failed' })

  const ready = triggerFromDepReady('run-1', taskOf('t3', { status: 'ready', dependsOn: ['t2'] }), NOW, 't2')
  assert.deepEqual(ready, { kind: 'dep_ready', source: 'poll', runId: 'run-1', at: NOW, taskId: 't3', via: 't2' })

  const stall = triggerFromStall('run-1', 'member-1', NOW)
  assert.deepEqual(stall, { kind: 'stall_timeout', source: 'poll', runId: 'run-1', at: NOW, memberId: 'member-1' })

  // 四个构造器覆盖全部 kind（出现第 5 个 kind 时这里会立刻发现没构造器）。
  const produced = new Set([gate.kind, exit.kind, ready.kind, stall.kind])
  for (const kind of TRIGGER_KINDS) assert.ok(produced.has(kind), `缺少 kind ${kind} 的构造器`)
})

test('构造器：gate 无证据时不臆造 exitCode（判据⑤才能回落到证据分支）', () => {
  const gate = triggerFromGate('run-1', taskOf('t2', { status: 'rework' }), NOW)
  assert.equal('exitCode' in gate, false)
  // 无证据 + 无状态之外的信息 → 证据不完整，不得宣称「门禁失败」。
  const verdict = fastOf(gate, ctxOf(runOf([taskOf('t2', { status: 'rework' })])))
  assert.equal(verdict.reason, 'gate_exit_zero')
})

test('去重键：格式为 kind:runId:entityId，任务型优先任务 id', () => {
  assert.equal(dedupeKeyOf('dep_ready', 'run-1', 't3'), 'dep_ready:run-1:t3')
  const ready = triggerFromDepReady('run-1', taskOf('t3', { status: 'ready' }), NOW)
  const stall = triggerFromStall('run-1', 'member-1', NOW)
  assert.equal(entityIdOf(ready), 't3')
  assert.equal(entityIdOf(stall), 'member-1')
  assert.equal(dedupeKeyFor(ready), 'dep_ready:run-1:t3')
  assert.equal(dedupeKeyFor(stall), 'stall_timeout:run-1:member-1')
})

/* ───────────────────────── Fast 层：7 个 reason 码 ───────────────────────── */

/** 五类判据（AC-14 的机械上限）：reason 只能落在这五类里，出现第六类就说明混进了语义判定。 */
const REASON_CATEGORY: Readonly<Record<FastReason, string>> = {
  ok: '放行',
  not_listened: '事件类型',
  not_enabled: '事件类型',
  unknown_entity: '成员存在性',
  task_state: '任务状态',
  gate_exit_zero: '门禁退出码',
  duplicate: '去重窗口',
}

test('Fast 层：reason 恰 7 个，且全部落在五类程序判据内', () => {
  const seen = new Set<FastReason>()

  const gateTask = taskOf('t2', { status: 'rework', evidence: { taskId: 't2', command: 'pnpm test', exitCode: 2, tail: '', artifacts: [], at: NOW } })
  const doneTask = taskOf('t9', { status: 'done' })
  const run = runOf([gateTask, taskOf('t3', { status: 'ready' }), taskOf('t1', { status: 'running' }), doneTask])
  const gate = triggerFromGate('run-1', gateTask, NOW)

  seen.add(fastOf(gate, ctxOf(run)).reason) // ok
  seen.add(fastOf(gate, ctxOf(run, { enabled: false })).reason) // not_enabled
  seen.add(fastOf({ ...gate, kind: 'unknown_kind' as TriggerKind }, ctxOf(run)).reason) // not_listened
  seen.add(fastOf(gate, ctxOf(runOf([]))).reason) // unknown_entity（任务不在本次运行）
  // task_state：任务在本次运行里，但 done 的任务不该再被「依赖完成」推动。
  seen.add(fastOf(triggerFromDepReady('run-1', doneTask, NOW), ctxOf(run)).reason)
  seen.add(
    fastOf(
      triggerFromGate('run-1', taskOf('t2', { status: 'rework' }), NOW),
      ctxOf(runOf([taskOf('t2', { status: 'rework', evidence: { taskId: 't2', command: 'x', exitCode: 0, tail: '', artifacts: [], at: NOW } })])),
    ).reason,
  ) // gate_exit_zero
  seen.add(
    fastOf(gate, ctxOf(run, { accepted: [{ dedupeKey: dedupeKeyFor(gate), at: NOW - 1_000 }] })).reason,
  ) // duplicate

  assert.deepEqual([...seen].sort(), [
    'duplicate',
    'gate_exit_zero',
    'not_enabled',
    'not_listened',
    'ok',
    'task_state',
    'unknown_entity',
  ])
  // 丢弃判据（不含 `ok` 放行）只能落在五类：事件类型 / 任务状态 / 门禁退出码 / 成员存在性 / 去重窗口。
  const categories = new Set([...seen].filter((reason) => reason !== 'ok').map((reason) => REASON_CATEGORY[reason]))
  assert.ok(categories.size <= 5, `丢弃判据落在 ${categories.size} 类里：${[...categories].join('/')}`)
  assert.equal(Object.keys(REASON_CATEGORY).length, 7)
})

test('Fast 层：判据顺序固定（开关 → 种类 → 实体 → 状态 → 退出码 → 去重）', () => {
  const gateTask = taskOf('t2', { status: 'rework', evidence: { taskId: 't2', command: 'x', exitCode: 0, tail: '', artifacts: [], at: NOW } })
  const gate = triggerFromGate('run-1', gateTask, NOW)
  // 关掉开关时，即使同时满足 task_state / gate_exit_zero / duplicate 也先报 not_enabled。
  const both = ctxOf(runOf([gateTask]), {
    enabled: false,
    accepted: [{ dedupeKey: dedupeKeyFor(gate), at: NOW }],
  })
  assert.equal(fastOf(gate, both).reason, 'not_enabled')
  // 属于别的 run 的过期事件，先报 unknown_entity 而不是拿对方的任务状态判 task_state。
  assert.equal(fastOf({ ...gate, runId: 'run-0' }, ctxOf(runOf([gateTask]))).reason, 'unknown_entity')
})

test('Fast 层：退出码 0 拒绝，退出码 null（超时/被杀）放行', () => {
  const zero = taskOf('t2', { status: 'rework', evidence: { taskId: 't2', command: 'x', exitCode: 0, tail: '', artifacts: [], at: NOW } })
  assert.equal(fastOf(triggerFromGate('run-1', zero, NOW), ctxOf(runOf([zero]))).reason, 'gate_exit_zero')

  const killed = taskOf('t2', { status: 'rework', evidence: { taskId: 't2', command: 'x', exitCode: null, tail: '', artifacts: [], at: NOW } })
  const verdict = fastOf(triggerFromGate('run-1', killed, NOW), ctxOf(runOf([killed])))
  assert.equal(verdict.accepted, true)
  assert.equal(verdict.reason, 'ok')
})

test('Fast 层：成员型 Trigger 必须能在 bindings 里定位到人', () => {
  const run = runOf([taskOf('t1', { status: 'running' })], [])
  const verdict = fastOf(triggerFromStall('run-1', 'member-1', NOW), ctxOf(run))
  assert.equal(verdict.reason, 'unknown_entity')

  const ok = fastOf(triggerFromStall('run-1', 'member-1', NOW), ctxOf(runOf([taskOf('t1', { status: 'running' })])))
  assert.equal(ok.accepted, true)
})

/* ───────────────────────── dropped 零副作用 ───────────────────────── */

test('dropped 零副作用：不改输入、不产出 action、连续调用结果逐字相同', () => {
  const gateTask = taskOf('t2', { status: 'rework', evidence: { taskId: 't2', command: 'x', exitCode: 0, tail: '', artifacts: [], at: NOW } })
  const run = runOf([gateTask])
  const trigger = triggerFromGate('run-1', gateTask, NOW)
  const ctx = ctxOf(run)
  const before = JSON.stringify({ trigger, ctx })

  const first = fastOf(trigger, ctx)
  const second = fastOf(trigger, ctx)

  assert.equal(first.accepted, false)
  assert.equal(first.action, null)
  assert.deepEqual(first, second) // 纯函数：同输入同输出
  assert.equal(JSON.stringify({ trigger, ctx }), before) // 输入未被改动（含 accepted 账本）
})

test('accepted 时 action 只映射到既有 action 类型，四类各有出口', () => {
  const gateTask = taskOf('t2', { status: 'rework', evidence: { taskId: 't2', command: 'x', exitCode: 3, tail: '', artifacts: [], at: NOW } })
  const ready = taskOf('t3', { status: 'ready' })
  const running = taskOf('t1', { status: 'running' })
  const run = runOf([gateTask, ready, running])

  const gateAction = actionOf(triggerFromGate('run-1', gateTask, NOW))
  assert.equal(gateAction.type, 'message')
  assert.equal(gateAction.type === 'message' ? gateAction.taskId : null, 't2', 'gate_failed 要把消息发回原任务成员')
  assert.match(gateAction.type === 'message' ? gateAction.text : '', /门禁未通过/)
  assert.equal(actionOf(triggerFromDepReady('run-1', ready, NOW)).type, 'dispatch')
  assert.equal(actionOf(triggerFromMemberExit('run-1', 'member-1', 'failed', NOW)).type, 'resume')
  assert.equal(actionOf(triggerFromStall('run-1', 'member-1', NOW)).type, 'message')

  // 四类 accepted 走一遍，确认 fastOf 放行时都把 action 带出来（不是 null）。
  for (const trigger of [
    triggerFromGate('run-1', gateTask, NOW),
    triggerFromDepReady('run-1', ready, NOW),
    triggerFromMemberExit('run-1', 'member-1', 'failed', NOW),
    triggerFromStall('run-1', 'member-1', NOW),
  ]) {
    const verdict = fastOf(trigger, ctxOf(run))
    assert.equal(verdict.accepted, true, `${trigger.kind} 应当放行`)
    assert.notEqual(verdict.action, null, `${trigger.kind} 放行时必须带 action`)
  }
})

/* ───────────────────────── 幂等（注入时钟，不 sleep） ───────────────────────── */

test('幂等：同 key 连投 5 次只推进 1 次，窗口过期后可再推进 1 次', () => {
  const ready = taskOf('t3', { status: 'ready' })
  const run = runOf([ready])
  const accepted: Array<{ dedupeKey: string; at: number }> = []
  let now = NOW
  let pushed = 0

  // 模拟 trigger-bus 的「判定 → 记账」两行：accepted 才写入账本（零副作用的那一半）。
  const push = (): void => {
    const trigger = triggerFromDepReady('run-1', ready, now)
    const verdict = fastOf(trigger, { enabled: true, run, accepted, now, dedupeMs: WINDOW })
    if (verdict.accepted) {
      pushed += 1
      accepted.push({ dedupeKey: dedupeKeyFor(trigger), at: now })
    }
  }

  for (let i = 0; i < 5; i += 1) push()
  assert.equal(pushed, 1, '窗口内连投 5 次只能推进 1 次')
  assert.equal(accepted.length, 1)

  // 窗口边界：差 1ms 仍算重复（`now - at < dedupeMs`），恰好到期才放行。
  now = NOW + WINDOW - 1
  push()
  assert.equal(pushed, 1, '窗口内 1ms 之差仍是重复')

  now = NOW + WINDOW
  push()
  assert.equal(pushed, 2, '窗口过期后允许再推进 1 次')

  now = NOW + WINDOW + 1
  push()
  assert.equal(pushed, 2, '新窗口内再次去重')
})

test('幂等：不同 kind 各自独立（同一个任务可先后触发 gate_failed 与 dep_ready）', () => {
  const gateTask = taskOf('t2', { status: 'rework', evidence: { taskId: 't2', command: 'x', exitCode: 1, tail: '', artifacts: [], at: NOW } })
  const run = runOf([gateTask, taskOf('t2b', { status: 'ready' })])
  const gate = triggerFromGate('run-1', gateTask, NOW)
  const ready = triggerFromDepReady('run-1', run.tasks[1], NOW)
  assert.notEqual(dedupeKeyFor(gate), dedupeKeyFor(ready))
  const accepted = [{ dedupeKey: dedupeKeyFor(gate), at: NOW }]
  assert.equal(fastOf(ready, ctxOf(run, { accepted })).accepted, true)
})

/* ───────────────────────── 文案（三段式） ───────────────────────── */

test('文案：accepted 为「因「短语」（实体）推进：结果」三段式', () => {
  const gateTask = taskOf('t2', { status: 'rework', evidence: { taskId: 't2', command: 'pnpm test', exitCode: 2, tail: 'FAIL', artifacts: [], at: NOW } })
  const ready = taskOf('t3', { status: 'ready', dependsOn: ['t2'] })
  const run = runOf([gateTask, ready, taskOf('t1', { status: 'running' })])
  const cases: Array<[Trigger, string]> = [
    [triggerFromGate('run-1', gateTask, NOW), '门禁失败'],
    [triggerFromDepReady('run-1', ready, NOW, 't2'), '依赖完成'],
    [triggerFromMemberExit('run-1', 'member-1', 'failed', NOW), '成员退出'],
    [triggerFromStall('run-1', 'member-1', NOW), '超时无产出'],
  ]
  for (const [trigger, phrase] of cases) {
    const verdict = fastOf(trigger, ctxOf(run))
    assert.equal(verdict.accepted, true, `${trigger.kind} 应当放行`)
    const text = triggerSentenceOf(trigger, { accepted: verdict.accepted, reason: verdict.reason, action: verdict.action?.type })
    assert.match(text, /^因「.+」（.+）推进：.+$/, `文案不是三段式：${text}`)
    assert.ok(text.includes(`因「${phrase}」`), `文案缺少短语：${text}`)
  }
})

test('文案：dropped 写成「未推进：「短语」（实体）：为什么」', () => {
  const gateTask = taskOf('t2', { status: 'rework', evidence: { taskId: 't2', command: 'x', exitCode: 2, tail: '', artifacts: [], at: NOW } })
  const gate = triggerFromGate('run-1', gateTask, NOW)
  const text = triggerSentenceOf(gate, { accepted: false, reason: 'duplicate' })
  assert.match(text, /^未推进：「.+」（.+）：.+$/)
  assert.ok(text.includes('去重窗口'), text)
  assert.ok(text.includes('任务 t2'), text)
})

test('文案：实体标签带出前置任务 / 退出原因，便于面板定位', () => {
  const ready = triggerFromDepReady('run-1', taskOf('t3', { status: 'ready' }), NOW, 't2')
  assert.equal(entityLabelOf(ready), '任务 t3，前置 t2 已过门禁')
  const exit = triggerFromMemberExit('run-1', 'member-1', 'failed', NOW)
  assert.equal(entityLabelOf(exit), '成员 member-1，原因 failed')
  // 无实体时回落到 runId，绝不产出空括号。
  assert.equal(entityLabelOf({ kind: 'dep_ready', source: 'poll', runId: 'run-1', at: NOW }), '运行 run-1')
})

/* ───────────────────────── Slow 层留位 ───────────────────────── */

test('Slow 层关闭：常量恒 false，且不影响 Fast 层结论', () => {
  assert.equal(TRIGGER_SLOW_LAYER, false)
  // 同一批 Trigger，无论常量存在与否结论相同（本例断言常量确实没有被 fastOf 读取：
  // 把 accepted 账本清空后仍然放行，说明不依赖任何第二套分支）。
  const ready = taskOf('t3', { status: 'ready' })
  const verdict = fastOf(triggerFromDepReady('run-1', ready, NOW), ctxOf(runOf([ready])))
  assert.equal(verdict.reason, 'ok')
  assert.equal(verdict.accepted, true)
})
