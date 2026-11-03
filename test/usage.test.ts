/**
 * r13 T2：用量事件归一 / 累加 / 三态 + store 新字段归一（AC-19 / AC-20）。
 *
 * 这里刻意把「宿主 payload 的猜法」也测了：事件形状尚未在真机核实（TECHNICAL §0 U1），
 * 归一函数必须能从几种常见包裹里取出数字，取不到就**返回 null**（宁可少记，不可重复记）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MemberBinding } from '../src/shared/types.ts'
import type { PendingConfirmation, RunState, UsageRecord } from '../src/host/store.ts'
import {
  RUN_STATE_VERSION,
  RunsStore,
  normalizePending,
  normalizeTaskTimes,
  normalizeUsage,
  wrapLegacy,
} from '../src/host/store.ts'
import {
  applyUsage,
  createUsageDeduper,
  memberIdOf,
  runUsageOf,
  taskUsageOf,
  usageOfSessionEvent,
} from '../src/host/team/usage.ts'

const NOW = 1_700_000_000_000

function bindingOf(memberId: string, taskId = 't1'): MemberBinding {
  return { taskId, roleId: 'dev', memberId, name: memberId, spawnedAt: NOW }
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
      tasks: [
        { id: 't1', title: '一', roleId: 'dev', dependsOn: [], acceptance: 'exit 0', status: 'running' },
        { id: 't2', title: '二', roleId: 'dev', dependsOn: ['t1'], acceptance: 'exit 0', status: 'pending' },
      ],
    },
    plannedAt: NOW,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...patch,
  }
}

/* ───────────────────────── usageOfSessionEvent ───────────────────────── */

test('usageOfSessionEvent：只认 assistant 消息，其它类型一律 null', () => {
  assert.equal(usageOfSessionEvent(null), null)
  assert.equal(usageOfSessionEvent('assistant/message'), null)
  assert.equal(usageOfSessionEvent({ type: 'user/message', usage: { totalTokens: 9 } }), null)
  assert.equal(usageOfSessionEvent({ type: 'assistant/message' }), null, '没有用量数字的消息不计')
})

test('usageOfSessionEvent：三种包裹形状都能取到数字与身份', () => {
  const flat = usageOfSessionEvent({
    type: 'assistant/message',
    agentId: 'm1',
    usage: { totalTokens: 120 },
  })
  assert.deepEqual(flat, { usage: { total: 120 }, sessionId: 'm1', eventKey: 'm1:?' })

  const nested = usageOfSessionEvent({
    type: 'assistant/message',
    event: { agent: { id: 'm2' }, seq: 7, taskId: 't1', usage: { inputTokens: 3, outputTokens: 4 } },
  })
  assert.deepEqual(nested, {
    usage: { total: 7, input: 3, output: 4 },
    sessionId: 'm2',
    taskId: 't1',
    eventKey: 'm2:7',
  })

  const withEventId = usageOfSessionEvent({
    type: 'assistant/message',
    message: { id: 'evt-9', sessionId: 's-9', usage: { total: 5 } },
  })
  assert.equal(withEventId?.eventKey, 'evt-9', '有 eventId 就用它，跨重启也稳定')
})

test('memberIdOf：只认绑定里真实存在的 memberId，匹配不到不猜', () => {
  const bindings = [bindingOf('m1'), bindingOf('m2', 't2')]
  assert.equal(memberIdOf(bindings, 'm1'), 'm1')
  assert.equal(memberIdOf(bindings, 'm3'), undefined)
  assert.equal(memberIdOf(bindings, undefined), undefined)
  assert.equal(memberIdOf(undefined, 'm1'), undefined)
})

/* ───────────────────────── applyUsage / 三态 ───────────────────────── */

test('applyUsage：首次带身份 → per-member，合计与分项同时累加', () => {
  const one = applyUsage(undefined, { memberId: 'm1', usage: { total: 10, input: 4, output: 6 } }, NOW)
  assert.equal(one.attribution, 'per-member')
  assert.deepEqual(one.byMember.m1, { total: 10, input: 4, output: 6 })
  assert.deepEqual(one.total, { total: 10, input: 4, output: 6 })

  const two = applyUsage(one, { memberId: 'm1', usage: { total: 5, input: 2, output: 3 } }, NOW + 1)
  assert.deepEqual(two.byMember.m1, { total: 15, input: 6, output: 9 })
  assert.equal(two.total?.total, 15)
  assert.equal(two.updatedAt, NOW + 1, 'updatedAt 跟着最后一次事件走')
  assert.deepEqual(one.byMember.m1, { total: 10, input: 4, output: 6 }, '纯函数：不改入参')
})

test('applyUsage：无身份事件 → aggregate-only；三态只降不升', () => {
  const aggregate = applyUsage(undefined, { usage: { total: 30 } }, NOW)
  assert.equal(aggregate.attribution, 'aggregate-only')
  assert.equal(aggregate.total?.total, 30)
  assert.deepEqual(aggregate.byMember, {})

  // 先 per-member，再来一条无身份 → 掉到 aggregate-only；之后再带身份也不回升
  const perMember = applyUsage(undefined, { memberId: 'm1', usage: { total: 10 } }, NOW)
  assert.equal(perMember.attribution, 'per-member')
  const downgraded = applyUsage(perMember, { usage: { total: 1 } }, NOW + 1)
  assert.equal(downgraded.attribution, 'aggregate-only')
  const again = applyUsage(downgraded, { memberId: 'm1', usage: { total: 1 } }, NOW + 2)
  assert.equal(again.attribution, 'aggregate-only', '禁止回升：否则合计与分项会重复计')
  assert.equal(again.total?.total, 12)
})

test('applyUsage：任务归属单列；0 token 是合法用量', () => {
  const zero = applyUsage(undefined, { memberId: 'm1', taskId: 't1', usage: { total: 0 } }, NOW)
  assert.equal(zero.attribution, 'per-member')
  assert.equal(zero.total?.total, 0)
  assert.deepEqual(zero.byTask.t1, { total: 0 })
  assert.equal(runUsageOf(zero).source, 'provider', '0 与「不可得」必须区分')
  assert.equal(runUsageOf(zero).tokens?.total, 0)
})

test('applyUsage：没有数字的事件不改归属也不改合计', () => {
  const base: UsageRecord = { attribution: 'per-member', byMember: { m1: { total: 5 } }, byTask: {}, total: { total: 5 }, updatedAt: NOW }
  const same = applyUsage(base, { memberId: 'm1', usage: {} }, NOW + 9)
  assert.equal(same.total?.total, 5)
  assert.equal(same.updatedAt, NOW + 9)
})

test('runUsageOf / taskUsageOf：三态下各自的原因文案必须可读', () => {
  assert.deepEqual(runUsageOf(undefined), { source: 'unavailable', reason: '尚无用量事件' })

  const perMember = applyUsage(undefined, { memberId: 'm1', taskId: 't1', usage: { total: 7 } }, NOW)
  assert.equal(runUsageOf(perMember).source, 'provider')
  assert.equal(taskUsageOf(perMember, 't1').tokens?.total, 7, 'byTask 优先')
  assert.equal(taskUsageOf(perMember, 'unknown', 'm1').tokens?.total, 7, '缺 byTask 时回落到成员')
  assert.equal(taskUsageOf(perMember, 'unknown').source, 'unavailable')
  assert.match(taskUsageOf(perMember, 'unknown').reason ?? '', /还没有用量事件/)

  const aggregate = applyUsage(undefined, { usage: { total: 9 } }, NOW)
  assert.equal(taskUsageOf(aggregate, 't1').source, 'unavailable')
  assert.match(taskUsageOf(aggregate, 't1').reason ?? '', /未按成员归属/)
})

test('createUsageDeduper：重复事件只算一次，且不落盘、有上限', () => {
  const dedupe = createUsageDeduper(3)
  assert.equal(dedupe.seen('run-1', 'evt-1'), false)
  assert.equal(dedupe.seen('run-1', 'evt-1'), true, '同一事件第二次必须跳过')
  assert.equal(dedupe.seen('run-2', 'evt-1'), false, '不同 run 的相同 key 互不影响')
  assert.equal(dedupe.size(), 2)
  dedupe.seen('run-1', 'evt-2')
  dedupe.seen('run-1', 'evt-3')
  assert.equal(dedupe.size(), 3, '上限之外 FIFO 淘汰')
  dedupe.seen('run-1', 'evt-4')
  assert.equal(dedupe.seen('run-1', 'evt-1'), false, '最早的 key 已被淘汰')
  dedupe.drop('run-1')
  assert.equal(dedupe.size(), 0, 'drop 清掉该 run 的全部记忆')
})

/* ───────────────────────── store 归一 ───────────────────────── */

test('normalizeUsage：丢坏数字、按 input+output 补 total、全坏则整条丢弃', () => {
  assert.equal(normalizeUsage(null), undefined)
  assert.equal(normalizeUsage({ total: { total: Number.NaN } }), undefined, '一个有效数字都没有 = 没收到用量')

  const usage = normalizeUsage({
    attribution: 'per-member',
    byMember: { m1: { input: 3, output: 4 }, m2: { total: -1 } },
    byTask: { t1: { total: 7 } },
    total: { total: Number.NaN, input: 3, output: 4 },
    updatedAt: NOW,
  })
  assert.equal(usage?.attribution, 'per-member')
  assert.deepEqual(usage?.byMember.m1, { total: 7, input: 3, output: 4 }, 'total 缺失时按分项补')
  assert.equal(usage?.byMember.m2, undefined, '负数条目被丢')
  assert.deepEqual(usage?.total, { total: 7, input: 3, output: 4 })

  const inferred = normalizeUsage({ byMember: { m1: { total: 2 } } })
  assert.equal(inferred?.attribution, 'per-member', 'attribution 缺失时按内容推断')
})

test('normalizeTaskTimes：毫秒整数、时间倒流整条丢弃', () => {
  assert.equal(normalizeTaskTimes([]), undefined)
  const times = normalizeTaskTimes({
    t1: { startedAt: NOW, endedAt: NOW + 1500.6 },
    t2: { startedAt: NOW + 10, endedAt: NOW },
    t3: {},
    t4: { startedAt: 'x' },
  })
  assert.deepEqual(times, { t1: { startedAt: NOW, endedAt: NOW + 1501 } })
})

test('normalizePending：缺 id/action/runId 整条丢弃，合法记录字段齐全', () => {
  const valid: PendingConfirmation = {
    id: 'p1',
    action: { type: 'cancelTask', taskId: 't1' },
    runId: 'run-1',
    createdAt: NOW,
    summary: '中断成员 dev（任务 t1）',
    irreversible: true,
  }
  assert.deepEqual(normalizePending(valid), valid)
  assert.equal(normalizePending({ ...valid, id: '' }), undefined)
  assert.equal(normalizePending({ ...valid, runId: undefined }), undefined)
  assert.equal(normalizePending({ ...valid, action: { type: 'toggle', enabled: true } }), undefined, '可逆动作不能挂 pending')
  assert.equal(normalizePending({ ...valid, action: { type: 'cancelTask' } }), undefined, '缺 taskId 的动作不可执行')
  assert.equal(
    normalizePending({ ...valid, action: { type: 'updateAcceptance', taskId: 't1' } }),
    undefined,
    '缺 acceptance 的动作不可执行',
  )
})

test('wrapLegacy：旧 v3 文件缺 r13 字段时不抛，全部按「不可得」处理', () => {
  const old = {
    version: 3,
    plan: { runId: 'run-old', sessionId: 'sess-1', createdAt: NOW, status: 'done', maxConcurrent: 2, tasks: [] },
    plannedAt: NOW,
    messages: [],
    bindings: [],
    routeAudits: [],
  }
  const state = wrapLegacy(old)
  assert.ok(state)
  assert.equal(state.usage, undefined)
  assert.equal(state.taskTimes, undefined)
  assert.equal(state.pendingConfirmation, undefined)
  assert.equal(state.finishedAt, undefined)
  assert.equal(state.project, undefined)
})

test('RunsStore：新字段落盘后可读回，历史摘要带 project/active/usageTotals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r13-'))
  const store = new RunsStore(join(dir, 'runs'))
  const state = stateOf({
    project: 'dsh-auto-team',
    finishedAt: NOW + 60_000,
    usage: applyUsage(undefined, { memberId: 'm1', usage: { total: 42 } }, NOW),
    taskTimes: { t1: { startedAt: NOW, endedAt: NOW + 60_000 } },
    pendingConfirmation: {
      id: 'p1',
      action: { type: 'skipTask', taskId: 't2' },
      runId: 'run-1',
      createdAt: NOW,
      summary: '跳过任务 t2（下游 0 个任务将在缺产物下继续）',
      irreversible: true,
      taskId: 't2',
    },
    forceParallel: ['t2'],
  })
  store.save(state)

  const loaded = store.load('run-1')
  assert.ok(loaded)
  assert.equal(loaded.project, 'dsh-auto-team')
  assert.equal(loaded.finishedAt, NOW + 60_000)
  assert.equal(loaded.usage?.total?.total, 42)
  assert.deepEqual(loaded.taskTimes, { t1: { startedAt: NOW, endedAt: NOW + 60_000 } })
  assert.equal(loaded.pendingConfirmation?.action.type, 'skipTask')
  assert.deepEqual(loaded.forceParallel, ['t2'])

  const summary = store.list().find((run) => run.runId === 'run-1')
  assert.equal(summary?.project, 'dsh-auto-team')
  assert.equal(summary?.usageTotals?.total, 42)
  assert.equal(summary?.active, true, 't2 仍是 pending → 活跃')
})

test('RunsStore.load：坏 JSON 与坏字段都不会让读取抛错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r13-bad-'))
  const runs = join(dir, 'runs')
  const store = new RunsStore(runs)
  store.save(stateOf({ usage: applyUsage(undefined, { usage: { total: 1 } }, NOW) }))

  // 直接把坏字段写进文件：load 必须归一掉，而不是抛错
  const path = join(runs, 'run-1.json')
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  raw.usage = { attribution: 'weird', byMember: { m: { total: 'x' } } }
  raw.taskTimes = { t1: { startedAt: NOW + 10, endedAt: NOW } }
  raw.pendingConfirmation = { id: 'p1' }
  writeFileSync(path, JSON.stringify(raw), 'utf8')

  const loaded = store.load('run-1')
  assert.ok(loaded)
  assert.equal(loaded.usage, undefined)
  assert.equal(loaded.taskTimes, undefined)
  assert.equal(loaded.pendingConfirmation, undefined)
})

/* ─────────── 真实宿主签名：'session/event'(session, event) ─────────── */

test('usageOfSessionEvent：真实宿主两参形状（session, event）能取到用量与成员会话 id', () => {
  // 形状逐字取自 cordis_inspect_query(host, Event, listEvents, {"event":"session/event"})
  const session = { id: '3f1c2b0a-member', header: { id: '3f1c2b0a-member' } }
  const event = {
    type: 'assistant/message',
    seq: 12,
    time: 1793667060702,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' } },
      stream: [],
      usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500, cacheReadTokens: 900 },
    },
  }
  // ① 监听器收到的参数数组
  const tuple = usageOfSessionEvent([session, event])
  assert.deepEqual(tuple, {
    usage: { total: 1500, input: 1200, output: 300 },
    sessionId: '3f1c2b0a-member',
    eventKey: '3f1c2b0a-member:12',
  })
  // ② 包成对象 { session, event } 也要认
  assert.deepEqual(usageOfSessionEvent({ session, event }), tuple)
  // ③ 只给事件本身（拿不到身份 → 只能进 aggregate-only）
  assert.deepEqual(usageOfSessionEvent(event), {
    usage: { total: 1500, input: 1200, output: 300 },
  }, '无 session 时不给身份，但用量要取到')
})

test('usageOfSessionEvent：真实宿主形状下，非 assistant 消息或无 usage 一律 null', () => {
  const session = { id: 's-1' }
  assert.equal(usageOfSessionEvent([session, { type: 'tool/result', seq: 3, data: {} }]), null)
  assert.equal(usageOfSessionEvent([session, { type: 'assistant/message', seq: 4, data: { stream: [] } }]), null)
})
