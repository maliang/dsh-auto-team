/**
 * 直通投递（peer handoff）纯逻辑单测：正文五要素 / 触发口径 / 幂等键 / 注入用正文提取。
 *
 * 这里刻意**不 import 任何带 IO 的模块**：handoff.ts 的全部行为都是纯函数，所以本文件的
 * 断言可以精确到「一条消息、一个字段、一个字符边界」，不需要 store、不需要宿主。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GateEvidence, MessageRecord, PlanTask } from '../src/shared/types.ts'
import {
  HANDOFF_TAIL_CHARS,
  handoffBodiesFor,
  handoffBody,
  handoffId,
  handoffMessages,
} from '../src/host/team/handoff.ts'

const now = 1_700_000_000_000

function makeTask(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'pnpm -s test',
    status: 'done',
    ...overrides,
  }
}

function makeEvidence(overrides: Partial<GateEvidence> = {}): GateEvidence {
  return {
    taskId: 't1',
    command: 'pnpm -s test',
    exitCode: 0,
    tail: 'ok 164 tests',
    artifacts: ['lib/index.js'],
    at: now,
    ...overrides,
  }
}

test('handoffId：幂等键就是 handoff:<上游>-><下游>（面板与续跑都按这个键认一条投递）', () => {
  assert.equal(handoffId('t1', 't2'), 'handoff:t1->t2')
  // 方向必须编码进键里：t2→t1 与 t1→t2 是两条不同的投递，不能撞。
  assert.notEqual(handoffId('t1', 't2'), handoffId('t2', 't1'))
})

test('handoffBody：五要素齐全（上游 id+title / 命令 / 退出码 / 证据尾部 / 产物），且不含 captain', () => {
  const body = handoffBody(makeTask('t1', { title: '把面板拆成三列' }), makeEvidence())
  assert.ok(body.startsWith('【上游直投】t1 把面板拆成三列 已通过门禁'), body)
  assert.ok(body.includes('命令：pnpm -s test'), body)
  assert.ok(body.includes('退出码：0'), body)
  assert.ok(body.includes(`证据尾部（≤${HANDOFF_TAIL_CHARS} 字）：`), body)
  assert.ok(body.includes('ok 164 tests'), '证据正文必须进 body')
  assert.ok(body.includes('产物：lib/index.js'), '产物路径必须进 body（下游要能直接读）')
  // 反面目标 3：直投正文里不许出现 captain —— 出现即等于承认信息还是过了队长。
  assert.ok(!body.includes('captain'), 'body 不许出现 captain')
})

test('handoffBody：产物为空时显式写「无落盘产物」，多产物逐行', () => {
  const empty = handoffBody(makeTask('t1'), makeEvidence({ artifacts: [] }))
  assert.ok(empty.includes('产物：无落盘产物'), empty)

  const multi = handoffBody(makeTask('t1'), makeEvidence({ artifacts: ['lib/index.js', 'lib/client.js'] }))
  assert.ok(multi.includes('产物：lib/index.js\nlib/client.js'), '多产物必须逐行，不能拼成一行')
})

test('handoffBody：超长证据只保留**末** 800 字并显式标注截断', () => {
  const head = 'A'.repeat(100)
  const tail = 'B'.repeat(800)
  const body = handoffBody(makeTask('t1'), makeEvidence({ tail: head + tail }))
  assert.ok(body.includes(tail), '末 800 字必须原样保留（失败信息总在末尾）')
  assert.ok(!body.includes(head), '超预算的前文不许混进来')
  assert.ok(body.includes('前文已截断'), '截断必须显式标注，否则成员会把残缺证据当全部')

  const short = handoffBody(makeTask('t1'), makeEvidence({ tail: '只跑了 3 个用例' }))
  assert.ok(!short.includes('前文已截断'), '未超预算时不许出现截断提示')
})

test('handoffMessages：只有 done + exitCode===0 才投递（rework/failed/无证据/非 0/超时全为 0 条）', () => {
  const upstream = makeTask('t1')
  const downstream = [makeTask('t2', { dependsOn: ['t1'], status: 'blocked' })]
  const base = { upstream, downstream, at: now, existingIds: [], targetOf: () => ({ to: 'task:t2' }) }

  assert.equal(handoffMessages({ ...base, upstreamVerdict: 'rework', evidence: makeEvidence() }).length, 0)
  assert.equal(handoffMessages({ ...base, upstreamVerdict: 'failed', evidence: makeEvidence() }).length, 0)
  assert.equal(handoffMessages({ ...base, upstreamVerdict: 'done', evidence: undefined }).length, 0)
  // null = 超时/被信号杀，不是「跑过了且成功」——这一条最容易写成 `!== 1` 而漏掉。
  assert.equal(handoffMessages({ ...base, upstreamVerdict: 'done', evidence: makeEvidence({ exitCode: null }) }).length, 0)
  assert.equal(handoffMessages({ ...base, upstreamVerdict: 'done', evidence: makeEvidence({ exitCode: 1 }) }).length, 0)
})

test('handoffMessages：每个下游各一条 from:peer，body 逐字相同（两条路径同源的依据）', () => {
  const upstream = makeTask('t1')
  const downstream = [
    makeTask('t2', { dependsOn: ['t1'] }),
    makeTask('t3', { dependsOn: ['t1'] }),
  ]
  const evidence = makeEvidence()
  const messages = handoffMessages({
    upstream,
    evidence,
    upstreamVerdict: 'done',
    downstream,
    at: now,
    existingIds: [],
    targetOf: (id) => (id === 't2' ? { to: 'dev-t2', toMemberId: 'm-dev-t2' } : { to: `task:${id}` }),
  })

  assert.equal(messages.length, 2, '2 个下游 → 恰好 2 条，不多不少')
  assert.deepEqual(messages.map((item) => item.messageId), ['handoff:t1->t2', 'handoff:t1->t3'])
  assert.deepEqual(messages.map((item) => item.from), ['peer', 'peer'])
  assert.deepEqual(messages.map((item) => item.to), ['dev-t2', 'task:t3'])
  assert.deepEqual(messages.map((item) => item.taskId), ['t2', 't3'])
  assert.equal(messages[0]?.toMemberId, 'm-dev-t2', '已有成员时必须带 toMemberId（实发靠它定位）')
  assert.equal(messages[1]?.toMemberId, undefined, '未创建成员不许凭空虚造 memberId')
  assert.equal(messages[0]?.body, messages[1]?.body, '同一次投递的 fanout 必须共用同一个 body 字符串')
  assert.equal(messages[0]?.at, now)
  // 关键反例：messageId 必须是幂等键，不能被 messages.ts 的 msg-<at>-<seq> 盖掉。
  assert.ok(messages.every((item) => item.messageId?.startsWith('handoff:') === true))
})

test('handoffMessages：幂等——已存在的 (A,B) 不再产出，重复调用不新增', () => {
  const upstream = makeTask('t1')
  const downstream = [makeTask('t2', { dependsOn: ['t1'] }), makeTask('t3', { dependsOn: ['t1'] })]
  const input = {
    upstream,
    evidence: makeEvidence(),
    upstreamVerdict: 'done' as const,
    downstream,
    at: now,
    targetOf: () => ({ to: 'task:x' }),
  }

  const first = handoffMessages({ ...input, existingIds: ['handoff:t1->t2'] })
  assert.deepEqual(first.map((item) => item.messageId), ['handoff:t1->t3'], '已投递过的不许再来一条')

  // 第二轮：把第一轮全部落进账本的 id 再回灌（等价于重复 applyReceipt 时 existingIds 的来源）。
  const round1 = handoffMessages({ ...input, existingIds: [] })
  assert.equal(round1.length, 2)
  const second = handoffMessages({
    ...input,
    existingIds: round1.map((item) => item.messageId ?? ''),
    at: now + 1,
  })
  assert.equal(second.length, 0, '重复回执必须幂等（AC-5）：(A,B) 至多一条')
})

test('handoffMessages：同一批 downstream 里重复传入同一个 B 也只产 1 条', () => {
  const t2 = makeTask('t2', { dependsOn: ['t1'] })
  const messages = handoffMessages({
    upstream: makeTask('t1'),
    evidence: makeEvidence(),
    upstreamVerdict: 'done',
    downstream: [t2, t2],
    at: now,
    existingIds: [],
    targetOf: () => ({ to: 'task:t2' }),
  })
  assert.equal(messages.length, 1)
})

test('handoffBodiesFor：只取该下游的交接正文，按 at 正序，忽略非 handoff 消息', () => {
  const messages: MessageRecord[] = [
    { at: now + 20, from: 'peer', to: 'dev-t3', taskId: 't3', body: '第二个上游', messageId: 'handoff:t2->t3' },
    { at: now + 10, from: 'peer', to: 'dev-t3', taskId: 't3', body: '第一个上游', messageId: 'handoff:t1->t3' },
    { at: now + 5, from: 'captain', to: 'dev-t3', taskId: 't3', body: '队长转述', messageId: 'msg-1-1' },
    { at: now + 30, from: 'peer', to: 'dev-t2', taskId: 't2', body: '别的下游', messageId: 'handoff:t1->t2' },
  ]
  assert.deepEqual(handoffBodiesFor(messages, 't3'), ['第一个上游', '第二个上游'])
  assert.deepEqual(handoffBodiesFor(messages, 't9'), [], '没有上游时给空数组，绝不返回 undefined')
})
