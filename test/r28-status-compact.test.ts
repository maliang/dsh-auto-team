/**
 * r28：`auto_team_status` 默认精简（消息只留最近 8 条、正文截断 400 字、给总数，`detail:'full'` 看全文）。
 *
 * 为什么钉死这几条：状态工具每次调用都会把返回值塞进队长上下文，200 条历史消息 + 每条全文
 * 会让「查一次状态」吃掉几万 token。默认精简是产品行为而不是实现细节，所以断言到返回字段：
 *  - 默认：`messages.length === 8`、正文 400 字 + 省略号、`messagesTotal`/`messagesShown`/`messagesTruncated`；
 *  - 边界：正好 400 字**不截断**，401 字才截断（把实现改回「一律截断」这条断言会红）；
 *  - `detail:'full'`：最近 20 条 + 正文全文（把实现改回「永远精简」这条断言会红）；
 *  - schema/description 里必须让模型看得见 `detail`，否则模型永远不知道有这个开关。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Bridge } from '../src/host/bridge.ts'
import type { RoleRepo } from '../src/host/roles/repo.ts'
import type { MessageRecord, PanelSnapshot } from '../src/shared/types.ts'
import { buildToolSpecs } from '../src/host/tools.ts'
import type { ToolSpec } from '../src/host/adapters.ts'

const NOW = 1_800_000_000_000
const SESSION = 'sess-r28'
const META = { agent: { id: SESSION }, callId: 'call-r28' }

function snapshotOf(messages: MessageRecord[]): PanelSnapshot {
  return {
    enabled: true,
    runId: 'run-r28',
    planStatus: 'dispatching',
    plannedAt: NOW,
    tasks: [],
    members: [],
    messages,
    routeAudits: [],
    concurrency: { limit: 3, running: 0, source: 'default', requested: 3, clamped: false },
    memory: { injectedChars: 0, budget: 4000, truncated: false, files: [] },
    roles: [],
    activity: [],
  }
}

function messageOf(index: number, body: string): MessageRecord {
  return {
    at: NOW + index,
    from: index % 2 === 0 ? 'captain' : 'dev-t1',
    to: index % 2 === 0 ? 'dev-t1' : 'captain',
    toMemberId: 'member-1',
    taskId: 't1',
    body,
    messageId: `msg-${index}`,
  }
}

function statusSpecFor(snapshot: PanelSnapshot): ToolSpec {
  const bridge = {
    enabled: () => snapshot.enabled,
    snapshot: () => snapshot,
  } as unknown as Bridge
  const spec = buildToolSpecs({ store: {} as never, roles: {} as RoleRepo, bridge, now: () => NOW }).find(
    (item) => item.name === 'auto_team_status',
  )
  assert.ok(spec, 'auto_team_status 必须存在')
  return spec
}

async function callStatus(
  spec: ToolSpec,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return (await spec.handler(args, META)) as Record<string, unknown>
}

test('r28：默认只回最近 8 条，正文截断到 400 字，并给总数', async () => {
  const body = `长消息 ${'x'.repeat(1200)}`
  const messages = Array.from({ length: 20 }, (_, i) => messageOf(i, body))
  const status = await callStatus(statusSpecFor(snapshotOf(messages)))

  assert.equal(status.ok, true)
  assert.equal(status.detail, 'compact', '不传 detail 时默认 compact')
  assert.equal(status.messagesTotal, 20, '总数必须给（模型据此判断还有多少没看到）')
  assert.equal(status.messagesShown, 8)
  assert.equal(status.messagesTruncated, true)

  const shown = status.messages as Array<Record<string, unknown>>
  assert.equal(shown.length, 8, '默认只留最近 8 条')
  assert.equal(shown[0]?.messageId, 'msg-12', '保留的是最近 8 条（不是最早 8 条）')
  assert.equal(shown[7]?.messageId, 'msg-19')
  for (const message of shown) {
    assert.equal((message.body as string).length, 401, '截断后 = 400 字 + 省略号')
    assert.ok((message.body as string).endsWith('…'), '截断必须留省略号，不能假装是全文')
    assert.equal(message.truncated, true)
    assert.equal(message.bodyChars, body.length, 'bodyChars 给原文长度，便于判断要不要 detail:full')
    // 除正文外的账本字段必须原样保留（否则「按任务检索消息」在精简视图里就废了）
    assert.equal(message.taskId, 't1')
    assert.equal(message.toMemberId, 'member-1')
  }
})

test('r28：400 字边界——正好 400 不截断，401 才截断', async () => {
  const exact = 'a'.repeat(400)
  const over = 'b'.repeat(401)
  const short = 'c'.repeat(20)
  const status = await callStatus(statusSpecFor(snapshotOf([
    messageOf(0, exact),
    messageOf(1, over),
    messageOf(2, short),
  ])))

  const shown = status.messages as Array<Record<string, unknown>>
  assert.equal(shown.length, 3)
  assert.equal(shown[0]?.body, exact, '正好 400 字不截断')
  assert.equal(shown[0]?.truncated, undefined)
  assert.equal((shown[1]?.body as string).length, 401)
  assert.equal(shown[1]?.truncated, true)
  assert.equal(shown[2]?.body, short, '短消息原样返回')
})

test('r28：detail:full 回最近 20 条且正文不截断', async () => {
  const body = `长消息 ${'y'.repeat(1200)}`
  const messages = Array.from({ length: 25 }, (_, i) => messageOf(i, body))
  const status = await callStatus(statusSpecFor(snapshotOf(messages)), { detail: 'full' })

  assert.equal(status.detail, 'full')
  assert.equal(status.messagesTotal, 25, '总数与视图无关，永远给')
  assert.equal(status.messagesShown, 20)
  assert.equal(status.messagesTruncated, true)

  const shown = status.messages as Array<Record<string, unknown>>
  assert.equal(shown.length, 20, 'full 视图仍只回最近 20 条（不是把 200 条全倒出来）')
  assert.equal(shown[0]?.messageId, 'msg-5')
  for (const message of shown) {
    assert.equal(message.body, body, 'full 视图正文必须完整')
    assert.equal(message.truncated, undefined)
  }
})

test('r28：按 code point 截断——emoji 不会被劈成孤立代理项', async () => {
  const body = '😀'.repeat(401) // UTF-16 长度 802，按 code point 是 401 字
  const status = await callStatus(statusSpecFor(snapshotOf([messageOf(0, body)])))
  const shown = (status.messages as Array<Record<string, unknown>>)[0]!

  assert.equal(shown.truncated, true)
  assert.equal(shown.bodyChars, 401, 'bodyChars 按 code point 计')
  const truncated = shown.body as string
  assert.equal(Array.from(truncated.slice(0, -1)).length, 400, '截断后留下 400 个完整 emoji')
  assert.equal(Array.from(body).slice(0, 400).join('') + '…', truncated)
  // 孤立代理项（高位后不接低位）会出现在「把一个 emoji 劈两半」的实现里。
  assert.doesNotMatch(truncated, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, '不能出现孤立高位代理项')
})

test('r28：消息不足 8 条时全部返回，messagesTruncated:false', async () => {
  const messages = Array.from({ length: 5 }, (_, i) => messageOf(i, `消息 ${i}`))
  const status = await callStatus(statusSpecFor(snapshotOf(messages)))

  assert.equal(status.messagesShown, 5)
  assert.equal(status.messagesTotal, 5)
  assert.equal(status.messagesTruncated, false)
  assert.equal((status.messages as unknown[]).length, 5)
})

test('r28：不改动原始账本（投影只读）', async () => {
  const body = 'z'.repeat(1000)
  const messages = [messageOf(0, body)]
  const snapshot = snapshotOf(messages)
  await callStatus(statusSpecFor(snapshot))

  assert.equal(snapshot.messages[0]?.body, body, '截断只发生在返回值里，不能改到账本')
  assert.equal(snapshot.messages.length, 1)
})

test('r28：description/schema 必须让模型看得见 detail 与精简默认', () => {
  const spec = statusSpecFor(snapshotOf([]))
  assert.match(spec.description, /8 条/, 'description 必须说明默认只留 8 条')
  assert.match(spec.description, /400/, 'description 必须说明正文截断 400 字')
  assert.match(spec.description, /messagesTotal/, 'description 必须说明给了总数')
  assert.match(spec.description, /detail/, 'description 必须提到 detail 开关')

  const properties = (spec.parameters.properties ?? {}) as Record<string, Record<string, unknown>>
  assert.deepEqual(properties.detail?.enum, ['compact', 'full'], 'detail 只接受 compact/full')
  assert.deepEqual(spec.parameters.required, [], 'detail 可选（默认 compact）')
})
