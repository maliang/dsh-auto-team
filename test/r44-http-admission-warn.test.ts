/**
 * r44 面板 HTTP 准入的降级路径（QA / t6）——必须单独一个进程跑。
 *
 * `warnNoConnectionOnce` 用的是 `src/host/adapters.ts` 的**模块级** `warnedNoConnection`：
 * 同一个进程里只要前面有任何一次「connection 缺失 / 抛错」，后面的用例就再也收不到告警。
 * 所以「缺失时放行且只 warn 一条」放在本文件（独立进程），主文件
 * `r44-http-admission.test.ts` 全部提供可用 connection。
 *
 * 断言判别力：去掉 `if (warnedNoConnection) return; warnedNoConnection = true` 后，
 * 三次请求会推三条告警 → `warnings.length === 1` 直接红（见 mutation probe M2）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdmissionHarness } from './fixtures/r44-http-admission-harness.ts'

test('r44 准入降级：connection 缺失 → 放行，且整个进程只 warn 一条', async () => {
  const harness = createAdmissionHarness(undefined)

  const first = await harness.invoke({ url: '/api/auto-team/snapshot' })
  assert.equal(first.status, 200, `旧宿主没有 connection 时必须按旧行为放行：${first.status} / ${first.body}`)
  assert.deepEqual(JSON.parse(first.body), { data: { ok: true } })

  assert.equal(harness.warnings.length, 1, `服务缺失只应 warn 一次：${harness.warnings.join(' | ')}`)
  const warning = harness.warnings[0] ?? ''
  assert.match(warning, /\[auto-team\]/, '告警要带插件前缀，便于在宿主日志里过滤')
  assert.match(warning, /connection\.requestRejection/, '告警要点名缺的是哪个服务方法')
  assert.match(warning, /按旧行为放行/, '告警要说清后果，不能只说「缺失」')

  const second = await harness.invoke({ method: 'POST', url: '/api/auto-team/act', body: '{"type":"pause"}' })
  assert.equal(second.status, 200, '降级后写操作同样放行（旧行为），但告警不再重复')
  assert.deepEqual(JSON.parse(second.body), { data: { posted: true } })

  const third = await harness.invoke({ url: '/api/auto-team/nope' })
  assert.equal(third.status, 404, '放行后仍走正常路由分发：未注册路径是 404（不是 403）')
  assert.equal(first.handleCalls, 1, '放行的请求各进一次 route.handle')
  assert.equal(third.handleCalls, 2, '404 不能命中任何 route.handle（计数停在 2）')
  assert.equal(harness.warnings.length, 1, `后续请求不能重复告警：${harness.warnings.join(' | ')}`)
})
