/**
 * r32 真机假停滞的回归测试：成员级推进订阅 + 身份反查 + 「证据不足」在 UI 上的表达。
 *
 * 背景（真机证据见 docs/teamflow/2026-11-13-r32-stall-truth/ROOT-CAUSE.md）：
 * 成员会话 55 step / 63 次工具调用，`RunState.progress` 在全部历史 run 里恒为 `{}`，
 * 面板按 `binding.spawnedAt` 倒计时报出 `stalledForMs=1210840`。断链点有三处：
 *  1. 进度订阅只挂在**根作用域**，而 `tools/result` 的作用域过滤按 `exec.agent` 做；
 *  2. `memberIdentityOf` 读 `namesOf(agent).name`，宿主实际返回 `{ self, parent }`；
 *  3. 匹配不到 binding 时静默 `continue`，失败没有任何日志。
 * 本文件锁住 1（成员 ctx 订阅）、2（`self` 路径）与 3 的另一半（证据不足必须可见）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  memberIdentityOf,
  watchMemberProgress,
  type HostContext,
} from '../src/host/adapters.ts'
import { memberPageOf } from '../src/client/nav.ts'
import type { MemberView } from '../src/shared/types.ts'

const MEMBER_ID = 'session-member-1'

interface FakeAgentContext {
  on(event: string, listener: (...args: unknown[]) => unknown): () => void
}

/** 假 agent ctx：记录订阅，测试手动 `emit` 投递（作用域语义 = 只投给本 agent）。 */
function fakeAgentContext(): { ctx: FakeAgentContext; emit(event: string, ...args: unknown[]): void; count(event: string): number } {
  const hooks = new Map<string, Array<(...args: unknown[]) => unknown>>()
  return {
    ctx: {
      on(event, listener) {
        const list = hooks.get(event) ?? []
        list.push(listener)
        hooks.set(event, list)
        return () => {
          const index = list.indexOf(listener)
          if (index >= 0) list.splice(index, 1)
        }
      },
    },
    emit(event, ...args) {
      for (const listener of [...(hooks.get(event) ?? [])]) listener(...args)
    },
    count(event) {
      return hooks.get(event)?.length ?? 0
    },
  }
}

function hostWith(agents: Map<string, unknown>): { ctx: HostContext; warnings: string[] } {
  const warnings: string[] = []
  const ctx = {
    agents: { get: (sessionId: string) => agents.get(sessionId) },
    logger: { warn: (message: string) => void warnings.push(message) },
    get: () => undefined,
  } as unknown as HostContext
  return { ctx, warnings }
}

test('watchMemberProgress：订阅装在成员自己的 ctx 上，工具调用以已知 memberId 回调', () => {
  const scope = fakeAgentContext()
  const agents = new Map<string, unknown>([[MEMBER_ID, { id: MEMBER_ID, ctx: scope.ctx }]])
  const { ctx } = hostWith(agents)
  const seen: Array<{ memberId: string; at: number }> = []

  const watch = watchMemberProgress(ctx, MEMBER_ID, (info) => seen.push(info))
  assert.equal(watch.ok, true, '成员 ctx 上必须能装上订阅')
  // 关键断言：订阅落在**成员** ctx（宿主按 exec.agent 过滤的就是这一层），根作用域一条都没有。
  assert.equal(scope.count('tools/result'), 1)
  assert.equal(scope.count('agent/status'), 1)

  scope.emit('tools/result', { callId: 'c1', name: 'bash', agent: { id: MEMBER_ID } }, { ok: true })
  assert.equal(seen.length, 1, '一次实质工具调用必须回调一次')
  assert.equal(seen[0]?.memberId, MEMBER_ID, 'memberId 由 spawn 已知，不再反查 binding')
  assert.equal(typeof seen[0]?.at, 'number')

  scope.emit('agent/status', { agent: { id: MEMBER_ID }, status: 'running' })
  assert.equal(seen.length, 2, 'agent/status 是第二条兜底信号')

  watch.stop()
  scope.emit('tools/result', { callId: 'c2', agent: { id: MEMBER_ID } }, { ok: true })
  assert.equal(seen.length, 2, 'stop 后不再回调')
  assert.equal(scope.count('tools/result'), 0, 'disposer 必须真的摘掉监听器')
})

test('watchMemberProgress：别人的调用不得算到这个成员头上（作用域若失效的二次防线）', () => {
  const scope = fakeAgentContext()
  const agents = new Map<string, unknown>([[MEMBER_ID, { id: MEMBER_ID, ctx: scope.ctx }]])
  const { ctx } = hostWith(agents)
  const seen: string[] = []
  watchMemberProgress(ctx, MEMBER_ID, (info) => seen.push(info.memberId))

  // 旧宿主 / 形状变动时监听器可能收到全局投递：按 exec.agent.id 再核一遍。
  scope.emit('tools/result', { callId: 'c9', agent: { id: 'other-member' } }, { ok: true })
  assert.deepEqual(seen, [], 'A 的调用不能救 B 的停滞')
  // 没有 agent 字段（作用域已保证是本成员）时按放行处理，否则会漏记。
  scope.emit('tools/result', { callId: 'c10' }, { ok: true })
  assert.deepEqual(seen, [MEMBER_ID])
})

test('watchMemberProgress：装不上时必须给出原因（旧实现这里一声不响）', () => {
  const empty = hostWith(new Map())
  const missing = watchMemberProgress(empty.ctx, MEMBER_ID, () => {})
  assert.equal(missing.ok, false)
  assert.match(missing.reason ?? '', /agents\.get/)

  const noCtx = hostWith(new Map<string, unknown>([[MEMBER_ID, { id: MEMBER_ID }]]))
  const noScope = watchMemberProgress(noCtx.ctx, MEMBER_ID, () => {})
  assert.equal(noScope.ok, false, 'agent 上没有 ctx 就不能假装装上了')
  assert.match(noScope.reason ?? '', /ctx/)

  // handler 抛错不得冒泡到宿主工具执行链（AC-9），但要留一条 warn。
  const scope = fakeAgentContext()
  const boom = hostWith(new Map<string, unknown>([[MEMBER_ID, { id: MEMBER_ID, ctx: scope.ctx }]]))
  watchMemberProgress(boom.ctx, MEMBER_ID, () => {
    throw new Error('disk full')
  })
  assert.doesNotThrow(() => scope.emit('tools/result', { agent: { id: MEMBER_ID } }, { ok: true }))
  assert.match(boom.warnings.join('|'), /成员推进处理失败/)
})

test('memberIdentityOf：读宿主真实的 namesOf(self)，不再依赖不存在的 name 字段', () => {
  const ctx = {
    get: (name: string) =>
      name === 'subagents' ? { namesOf: () => ({ self: 'lead/dev-t1-a1b2c3', parent: 'lead' }) } : undefined,
  } as unknown as HostContext
  // 宿主 0.2.2-rc.2 只给 { self, parent }：读 .name 会得到空名字，反查 binding 只能碰运气。
  assert.deepEqual(memberIdentityOf(ctx, { id: 'session-1' }), { id: 'session-1', name: 'dev-t1-a1b2c3' })

  // 旧桩 / 旧宿主给 name 时仍然兼容。
  const legacy = {
    get: (name: string) => (name === 'subagents' ? { namesOf: () => ({ name: 'lead/qa-t2-1' }) } : undefined),
  } as unknown as HostContext
  assert.deepEqual(memberIdentityOf(legacy, { id: 'session-2' }), { id: 'session-2', name: 'qa-t2-1' })
})

test('memberPageOf：证据不足既不说「未停滞」，也不染成停滞黄条（r32 的展示契约）', () => {
  const base: MemberView = {
    memberId: MEMBER_ID,
    taskId: 't1',
    roleId: 'dev',
    name: 'dev-t1-1',
    status: 'running',
    lastEventAt: 1_700_000_000_000,
    modelRoute: '会话默认',
    stalled: false,
    stalledForMs: 0,
    stalledSecondsText: '',
    stallReason: 'unreported',
    stallNote: '宿主未上报推进信号，无法判定是否停滞',
    canResume: true,
  }
  const unreported = memberPageOf({ member: base })
  assert.equal(unreported.stalled, false, '证据不足绝不能染色成停滞')
  assert.equal(unreported.stalledText, '', '没有停滞时不得出现 ⏳ 黄条文案')
  assert.equal(unreported.stallNote, '宿主未上报推进信号，无法判定是否停滞', '宿主下发的唯一措辞原样透出')

  // 有信号且未超阈值：note 为空，页面仍显示「未停滞」（stallNote 不得被空串以外的值污染）。
  const healthy = memberPageOf({ member: { ...base, stallReason: 'none', stallNote: '' } })
  assert.equal(healthy.stallNote, '')

  // 真停滞：黄条只由 `stalled` + 宿主秒数决定，note 必须让位（两者互斥，避免同一行两套说法）。
  const stalled = memberPageOf({
    member: {
      ...base,
      stalled: true,
      stalledForMs: 100_000,
      stalledSecondsText: '100 秒',
      stallReason: 'quiet',
      stallNote: '宿主未上报推进信号，无法判定是否停滞',
    },
  })
  assert.equal(stalled.stalled, true)
  assert.equal(stalled.stallNote, '', '真停滞后不再显示「证据不足」——两句话不能同时出现')
  assert.match(stalled.stalledText, /100 秒/)
})
