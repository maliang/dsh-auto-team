/**
 * r44 面板 HTTP 准入回归（QA / t6）。
 *
 * 被验证的行为（t4 在 `src/host/adapters.ts` 的 `registerHttpRoutes` handler 里实现）：
 *  - 面板前缀路由 `/api/auto-team/*` 每请求先问宿主 `ctx.connection.requestRejection(req)`；
 *  - `403` → `res.statusCode = 403` + body `forbidden`，`401` → `401` + `unauthorized`，
 *    `undefined` → 放行到原路由；
 *  - 准入发生在**查 route 之前**、**读 body（readJson）之前**：拒绝时 `route.handle` 计数必须为 0，
 *    即使 body 读口一被订阅就抛错，也必须是 403 而不是 500。
 *
 * 为什么这些断言能抓住错误实现：
 *  - 把 `refusalOf` 挪到 `route.handle` 之后 → 拒绝用例的 `handleCalls` 变 1；
 *  - 把准入挪到 `readJson` 之后 → `throwOnBodyRead` 场景变 500；
 *  - 401/403 body 写反 → `body` 断言直接红。
 *
 * 注意：`warnedNoConnection` 是**模块级**去重，本文件所有用例都提供可用的 connection，
 * 「connection 缺失 → 只 warn 一次」放在独立进程的 `r44-http-admission-warn.test.ts` 里，
 * 避免前面的用例先把去重标志吃掉（那会让告警断言假绿/假红）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createAdmissionHarness, refusingConnection } from './fixtures/r44-http-admission-harness.ts'

test('r44 准入：403 拒绝 → 403 / forbidden，且 route.handle 计数为 0', async () => {
  const harness = createAdmissionHarness(refusingConnection(403))
  const reply = await harness.invoke({ method: 'GET', url: '/api/auto-team/snapshot', body: '{"x":1}' })

  assert.equal(reply.status, 403, `Host/Origin 不可信必须拒绝：实际 ${reply.status} / ${reply.body}`)
  assert.equal(reply.body, 'forbidden')
  assert.equal(reply.handleCalls, 0, '被拒绝的请求不能进入 route.handle')
  assert.equal(reply.subscriptions, 0, '拒绝发生在 readJson 之前：不应订阅 body')
  assert.deepEqual(harness.warnings, [], '有可用 connection 时不应触发降级告警')
})

test('r44 准入：401 未认证 → 401 / unauthorized，且 route.handle 计数为 0', async () => {
  const harness = createAdmissionHarness(refusingConnection(401))
  const reply = await harness.invoke()

  assert.equal(reply.status, 401, `无认证 Peer 必须拒绝：实际 ${reply.status} / ${reply.body}`)
  assert.equal(reply.body, 'unauthorized', '401 必须回 unauthorized，不能与 403 混用')
  assert.equal(reply.handleCalls, 0)
  assert.equal(reply.subscriptions, 0)
})

test('r44 准入：403 发生在 readJson 之前（body 读口抛错也不变 500）', async () => {
  // throwOnBodyRead：`req.on` 一被调用就抛。准入若晚于 readJson，这里会被 catch 成 500。
  const harness = createAdmissionHarness(refusingConnection(403))
  const reply = await harness.invoke({ throwOnBodyRead: true, body: '{"x":1}' })

  assert.equal(reply.status, 403, `准入必须先于 readJson：实际 ${reply.status} / ${reply.body}`)
  assert.equal(reply.body, 'forbidden')
  assert.equal(reply.subscriptions, 0, '拒绝路径一次都不该碰 body 读口')
  assert.equal(reply.handleCalls, 0)
})

test('r44 准入：undefined 放行 → 200 且返回原路由 JSON', async () => {
  const harness = createAdmissionHarness(refusingConnection(undefined))
  const reply = await harness.invoke()

  assert.equal(reply.status, 200, `宿主放行时应照旧：实际 ${reply.status} / ${reply.body}`)
  assert.deepEqual(JSON.parse(reply.body), { data: { ok: true } }, '返回体必须是原路由 JSON，不能被准入改写')
  assert.equal(reply.handleCalls, 1)
  assert.equal(reply.subscriptions, 3, '放行路径必须真的读 body（data/error/end 三次订阅）')
})

test('r44 准入：POST 与未知路径同等过闸（403 优先于 404）', async () => {
  const post = await createAdmissionHarness(refusingConnection(403)).invoke({
    method: 'POST',
    url: '/api/auto-team/act',
    body: '{"type":"pause"}',
  })
  assert.equal(post.status, 403, `写操作更需要准入：实际 ${post.status} / ${post.body}`)
  assert.equal(post.body, 'forbidden')
  assert.equal(post.handleCalls, 0, 'POST 被拒绝时不能执行面板动作')

  const unknown = await createAdmissionHarness(refusingConnection(403)).invoke({ url: '/api/auto-team/nope' })
  assert.equal(unknown.status, 403, `未注册路径也必须先过准入（不能先回 404）：实际 ${unknown.status} / ${unknown.body}`)
  assert.equal(unknown.body, 'forbidden')
})

test('r44 准入：connection 服务是每请求现读，不是注册期快照', async () => {
  const harness = createAdmissionHarness(refusingConnection(403))
  assert.equal((await harness.invoke()).status, 403, '注册后第一次请求就应按当时服务拒绝')

  // 宿主可能在 apply 之后才激活/替换 connection：注册期快照的实现会继续用旧的 403。
  harness.setConnection(refusingConnection(undefined))
  const after = await harness.invoke()
  assert.equal(after.status, 200, `换成放行实现后必须立刻生效：实际 ${after.status} / ${after.body}`)
  assert.equal(after.handleCalls, 1)
})

test('r44 准入：同一连接的 401 → 403 → undefined 序列逐请求生效', async () => {
  const verdicts: Array<401 | 403 | undefined> = [401, 403, undefined]
  let cursor = 0
  const harness = createAdmissionHarness({ requestRejection: () => verdicts[cursor++] })

  const first = await harness.invoke()
  assert.equal(first.status, 401, `第 1 次必须是 401：${first.status} / ${first.body}`)
  assert.equal(first.body, 'unauthorized')

  const second = await harness.invoke()
  assert.equal(second.status, 403, `第 2 次必须是 403：${second.status} / ${second.body}`)
  assert.equal(second.body, 'forbidden')

  const third = await harness.invoke()
  assert.equal(third.status, 200, `第 3 次放行后必须 200：${third.status} / ${third.body}`)
  assert.deepEqual(JSON.parse(third.body), { data: { ok: true } })

  assert.equal(third.handleCalls, 1, '401 + 403 两次拒绝合计不得进入 route.handle，只有放行那次进')
  assert.equal(cursor, 3, '每次请求必须真正调用一次宿主的 requestRejection（不能缓存判定）')
})

test('r44 邻居：wire.test.ts 的 connection 桩仍在且只声明一次（零告警断言前提）', () => {
  const source = readFileSync(new URL('./wire.test.ts', import.meta.url), 'utf8')
  const connectionKeys = source.match(/^\s*connection:/gm) ?? []

  assert.equal(
    connectionKeys.length,
    1,
    'wire.test.ts 的假 ctx 里 connection 键必须恰好一处——新增第二处会触发 TS 重复属性，且要改就改这一处',
  )
  assert.match(
    source,
    /connection:\s*\{\s*requestRejection:\s*\(\)\s*=>\s*undefined\s*\}/,
    't4 补的 connection 桩（返回 undefined）不能丢：丢了会命中「服务缺失 → warn」，把装配用例的零告警断言染红',
  )
  assert.match(source, /assert\.deepEqual\(h\.warnings, \[\]/, '装配零告警断言必须仍在（真机行为由门禁跑 test/wire.test.ts 覆盖）')
})

// 必须放本文件最后一个：抛错路径会消费模块级的「只 warn 一次」标志。
test('r44 准入：requestRejection 抛错 → 放行并只 warn 一条', async () => {
  const harness = createAdmissionHarness({
    requestRejection: () => {
      throw new Error('宿主判定炸了')
    },
  })

  const first = await harness.invoke()
  assert.equal(first.status, 200, '判定函数抛错只能降级放行，不能让面板整体 500')
  assert.equal(first.handleCalls, 1)
  assert.equal(harness.warnings.length, 1, `抛错路径应 warn 一条：${harness.warnings.join(' | ')}`)
  assert.match(harness.warnings[0] ?? '', /connection\.requestRejection/)
  assert.match(harness.warnings[0] ?? '', /宿主判定炸了/, '告警要点名异常，便于排查')
  assert.match(harness.warnings[0] ?? '', /按旧行为放行/)

  const second = await harness.invoke()
  assert.equal(second.status, 200)
  assert.equal(harness.warnings.length, 1, '同一进程内只 warn 一次，不能每请求刷屏')
})
