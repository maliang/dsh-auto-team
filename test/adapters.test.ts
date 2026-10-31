/**
 * 宿主契约适配层的回归测试（ARCHITECTURE §7 的实测形状在此固化为断言）。
 *
 * 这些测试的价值：宿主形状一旦被写错，运行期表现是「工具静默不可用 / 面板空白」，
 * 而不是抛错。把形状写成断言，能让错误在 CI 里变成一条红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agentOfToolEvent,
  listHostMembers,
  onMemberProgress,
  registerAgentCreated,
  registerEffect,
  registerHttpRoutes,
  registerPromptSection,
  registerTool,
  resolveConcurrencyLimit,
  spawnMember,
  toHostToolDefinition,
  type HostContext,
  type HttpRoute,
} from '../src/host/adapters.ts'
import { DEFAULT_MAX_CONCURRENT, MAX_CONCURRENT_LIMIT } from '../src/host/config.ts'

test('工具定义必须带 output.render（宿主 ToolDefinition 要求）', () => {
  const def = toHostToolDefinition({
    name: 'auto_team_plan',
    description: '拆解目标',
    parameters: { type: 'object' },
    handler: async () => ({ ok: true }),
  }) as {
    name: string
    execute: unknown
    output: { schema: unknown; render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> }
  }

  assert.equal(def.name, 'auto_team_plan')
  assert.equal(typeof def.execute, 'function')
  assert.deepEqual(def.output.schema, { type: 'object' })
  const rendered = def.output.render({}, { ok: true, runId: 'r1' })
  assert.equal(rendered.length, 1)
  assert.equal(rendered[0]?.type, 'text')
  assert.equal(rendered[0]?.text, '{"ok":true,"runId":"r1"}')
})

test('prompt section 用 text 字段（不是 render/content）', () => {
  const calls: unknown[] = []
  const ctx = { systemPrompt: { section: (s: unknown) => void calls.push(s) } }
  registerPromptSection(ctx, { name: 'auto-team-captain', order: 42, content: () => '队长规则' })

  assert.equal(calls.length, 1)
  const section = calls[0] as { name: string; order: number; text: unknown; render?: unknown; content?: unknown }
  assert.equal(section.name, 'auto-team-captain')
  assert.equal(section.order, 42)
  assert.equal(typeof section.text, 'function')
  assert.equal((section.text as () => string)(), '队长规则')
  assert.equal(section.render, undefined)
  assert.equal(section.content, undefined)
})

test('HTTP 桥注册单条 prefix 路由，并按 method + path 分发、自己写 res', async () => {
  const registered: Array<{ kind: string; path: string; handler: Function }> = []
  const ctx = { webServer: { register: (route: unknown) => void registered.push(route as never) } }
  const routes: HttpRoute[] = [
    {
      method: 'GET',
      path: '/api/auto-team/snapshot',
      handle: async (request) => ({ data: { url: request.url } }),
    },
    {
      method: 'POST',
      path: '/api/auto-team/act',
      handle: async (request) => ({ data: { body: await request.json() } }),
    },
  ]
  registerHttpRoutes(ctx, routes, '/api/auto-team')

  assert.equal(registered.length, 1, '宿主 WebRoute 没有 method 字段，必须合并成一条')
  assert.equal(registered[0]?.kind, 'prefix')
  assert.equal(registered[0]?.path, '/api/auto-team')

  const invoke = async (method: string, url: string, body?: string) => {
    const listeners = new Map<string, Function>()
    const chunks = body === undefined ? [] : [body]
    let sent = ''
    let headers: Record<string, string> = {}
    const req = {
      method,
      url,
      on(event: string, listener: Function) {
        listeners.set(event, listener)
      },
    }
    const res = {
      statusCode: 0,
      setHeader(name: string, value: string) {
        headers[name] = value
      },
      end(chunk?: string) {
        sent = chunk ?? ''
      },
    }
    const done = (registered[0]?.handler as Function)(req, res)
    // 事件是同步排队的（假 req 不会自己发事件），这里按顺序推给监听器
    for (const chunk of chunks) listeners.get('data')?.(chunk)
    listeners.get('end')?.()
    await done
    return { status: res.statusCode, body: JSON.parse(sent) as unknown, headers }
  }

  const get = await invoke('GET', '/api/auto-team/snapshot?sessionId=abc')
  assert.equal(get.status, 200)
  assert.deepEqual(get.body, { data: { url: '/api/auto-team/snapshot?sessionId=abc' } })
  assert.equal(get.headers['content-type'], 'application/json; charset=utf-8')

  const post = await invoke('POST', '/api/auto-team/act', JSON.stringify({ sessionId: 'abc' }))
  assert.equal(post.status, 200)
  assert.deepEqual(post.body, { data: { body: { sessionId: 'abc' } } })

  const unknown = await invoke('GET', '/api/auto-team/nope')
  assert.equal(unknown.status, 404)

  const badJson = await invoke('POST', '/api/auto-team/act', '{oops')
  assert.equal(badJson.status, 500)
  assert.match((badJson.body as { error: string }).error, /请求体不是合法 JSON/)
})

test('tools 服务缺失时注册工具只 warn 不抛（AC-9）', () => {
  const warns: string[] = []
  const ctx = { logger: { warn: (m: string) => void warns.push(m) } }
  registerTool(ctx, { name: 'x', description: '', parameters: {}, handler: async () => null })
  assert.equal(warns.length, 1)
  assert.match(warns[0] ?? '', /宿主未提供 tools 服务/)
})

/* ------------------------------------------------------------------ *
 * T3 增量：成员名单 / 并发上限 / effect / agent-created / spawnMember
 * ------------------------------------------------------------------ */

test('registerTool / registerPromptSection 注册成功时返回 true（装配层靠布尔值决定是否告警）', () => {
  const tools: unknown[] = []
  assert.equal(
    registerTool(
      { tools: { register: (definition: unknown) => void tools.push(definition) } },
      { name: 'auto_team_plan', description: '', parameters: {}, handler: async () => null },
    ),
    true,
  )
  assert.equal(tools.length, 1)

  const sections: Array<{ text: () => string }> = []
  // §3 的签名允许直接给字符串：写死文案的调用方不必包一层函数
  assert.equal(
    registerPromptSection(
      { systemPrompt: { section: (section: unknown) => void sections.push(section as never) } },
      { name: 'auto-team-captain', order: 42, content: '队长规则' },
    ),
    true,
  )
  assert.equal(sections[0]?.text(), '队长规则')
})

test('listHostMembers：归一数组与 { members } 两种返回，缺字段不臆造', async () => {
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    agentTeams: {
      listMembers: async () => [
        { id: 'm1', name: 'dev-t1', status: 'running' },
        { memberId: 'm2', name: 'qa-t1' },
        { name: '' },
      ],
    },
  }
  const members = await listHostMembers(ctx)
  assert.deepEqual(members, [
    { id: 'm1', name: 'dev-t1', status: 'running' },
    { id: 'm2', name: 'qa-t1', status: '' },
  ])

  const wrapped = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    agentTeams: { listMembers: async () => ({ members: [{ id: 'm3', name: 'dev-t2', status: 'inactive' }] }) },
  }
  assert.deepEqual(await listHostMembers(wrapped), [{ id: 'm3', name: 'dev-t2', status: 'inactive' }])
})

test('listHostMembers：没有 caller 时抛 NO_CALLER（而不是返回空数组把成员全判死）', async () => {
  const ctx = { agentTeams: { listMembers: async () => [] } }
  await assert.rejects(listHostMembers(ctx), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'NO_CALLER')
    assert.match(error.message, /没有活跃的队长会话/)
    return true
  })
})

test('listHostMembers：宿主没有 listMembers 时抛 NOT_FOUND（watcher 据此跳过本轮）', async () => {
  const ctx = { agents: { currentInitiator: () => ({ id: 'captain' }) }, agentTeams: {} }
  await assert.rejects(listHostMembers(ctx), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'NOT_FOUND')
    return true
  })
})

test('resolveConcurrencyLimit：读宿主上限，超限夹紧；缺失回落默认并如实标注来源', () => {
  assert.deepEqual(resolveConcurrencyLimit({ agentTeams: { maxTeammates: 5 } }), { limit: 5, source: 'host' })
  assert.deepEqual(resolveConcurrencyLimit({ agentTeams: { concurrencyLimit: 99 } }), {
    limit: MAX_CONCURRENT_LIMIT,
    source: 'host',
  })
  assert.deepEqual(resolveConcurrencyLimit({ agentTeams: {} }), {
    limit: DEFAULT_MAX_CONCURRENT,
    source: 'default',
  })
  assert.deepEqual(resolveConcurrencyLimit({}), { limit: DEFAULT_MAX_CONCURRENT, source: 'default' })
})

test('registerEffect：有 effect 时注册成功，没有时返回 false 且不抛', () => {
  const disposers: Array<() => void | Promise<void>> = []
  assert.equal(registerEffect({ effect: (dispose) => void disposers.push(dispose) }, () => {}), true)
  assert.equal(disposers.length, 1)

  const warns: string[] = []
  assert.equal(registerEffect({ logger: { warn: (m: string) => void warns.push(m) } }, () => {}), false)
  assert.match(warns[0] ?? '', /未提供 effect 注册/)
})

test('registerAgentCreated：解析成员与 model；缺 model 不伪造（审计落 unverified）', () => {
  const captured: Array<(payload: unknown) => void> = []
  const ctx = { on: (event: string, listener: (payload: unknown) => void) => void captured.push(listener) }
  const seen: Array<{ member: { id: string; name: string }; model?: unknown }> = []

  assert.equal(registerAgentCreated(ctx, (payload) => void seen.push(payload)), true)
  assert.equal(captured.length, 1)

  captured[0]?.({ member: { id: 'm1', name: 'dev-t1' } })
  assert.deepEqual(seen[0], { member: { id: 'm1', name: 'dev-t1' } })
  assert.equal(seen[0]?.model, undefined, '宿主没给 model 时绝不能拿声明值填进来')

  captured[0]?.({ member: { id: 'm1', name: 'dev-t1' }, model: { provider: 'p', model: 'm' } })
  assert.deepEqual(seen[1]?.model, { provider: 'p', model: 'm' })

  captured[0]?.({ somethingElse: true })
  assert.equal(seen.length, 2, '认不出的 payload 不调用 handler')
})

test('D1：角色声明的 model/effort 进 spawn 请求，且 agent/created 内装成 member-scoped 路由', async () => {
  const created: Array<(payload: unknown) => void> = []
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  const requests: Array<Record<string, unknown>> = []
  const agent = {
    id: 'm-1',
    ctx: {
      on(event: string, listener: (...args: unknown[]) => unknown) {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
        return () => void list.splice(list.indexOf(listener), 1)
      },
    },
  }
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'session-default' }) },
    agentTeams: {
      tryMembership: (candidate: unknown) => (candidate === agent ? { id: 'm-1', name: 'dev-t1', role: 'teammate' } : undefined),
      spawnTeammate: async (_caller: unknown, request: unknown) => {
        requests.push(request as Record<string, unknown>)
        // 宿主真实时序：spawnTeammate 内部 await serial agent/created，之后才放行成员首个请求
        for (const listener of created) listener({ agent, source: 'teammate' })
        return { member: { id: 'm-1', name: 'dev-t1' } }
      },
    },
    on: (event: string, listener: (payload: unknown) => void) => {
      if (event === 'agent/created') created.push(listener)
    },
  }
  const seen: Array<{ member: { id: string; name: string }; installed?: unknown; model?: unknown }> = []
  assert.equal(registerAgentCreated(ctx, (payload) => void seen.push(payload)), true)

  const plan = { runId: 'r1', sessionId: 's1', createdAt: 1, status: 'dispatching', tasks: [], maxConcurrent: 3 }
  const task = { id: 't1', title: '实现', roleId: 'dev', dependsOn: [], acceptance: 'x', status: 'pending' }
  const role = {
    id: 'dev',
    name: 'dev',
    duty: '',
    skillIds: [],
    builtin: true,
    updatedAt: 1,
    model: { provider: 'deepseek', model: 'deepseek-reasoner' },
  }
  const result = await spawnMember(ctx as never, { plan, task, role, name: 'dev-t1', prompt: '去做 t1' } as never)
  assert.equal(result.ok, true)

  // ① 请求里带上了声明模型（宿主 rc.2 会忽略，但这是「队长要求什么」的可核证据）
  assert.equal(requests[0]?.provider, 'deepseek')
  assert.equal(requests[0]?.model, 'deepseek-reasoner')

  // ② 真正的生效点：agent/created 里装了路由，事件回报 installed=声明值（不是宿主自报值）
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0]?.installed, { provider: 'deepseek', model: 'deepseek-reasoner' })
  assert.deepEqual(seen[0]?.member, { id: 'm-1', name: 'dev-t1' })

  // ③ 装上的路由在发起请求时真的改写调用配置，并剔除继承来的 reasoningEffort
  const chain = listeners.get('agent/request') ?? []
  let index = -1
  const next = async (): Promise<unknown> => {
    index += 1
    const current = chain[index]
    if (current === undefined) {
      return { provider: 'session-default', model: 'session-default', reasoningEffort: 'low', temperature: 0.2 }
    }
    return current({}, next)
  }
  assert.deepEqual(await next(), { provider: 'deepseek', model: 'deepseek-reasoner', temperature: 0.2 })

  // ④ 路由是「取走即删」：同一名字再来的第二个成员不会被套上前一个任务的路由
  for (const listener of created) listener({ agent: { id: 'm-2', ctx: { on: () => () => {} } }, source: 'teammate' })
  assert.equal(seen[1]?.installed, undefined, '待装路由必须一次性消费，不留串味风险')
})

test('spawnMember：返回 memberId + 我们声明的名字（恢复靠名字重绑）', async () => {
  const requests: Array<Record<string, unknown>> = []
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'session-default' }) },
    agentTeams: {
      spawnTeammate: async (_caller: unknown, request: unknown) => {
        requests.push(request as Record<string, unknown>)
        return { member: { id: 'm-1', name: 'dev-t1' } }
      },
    },
  }
  const plan = { runId: 'r1', sessionId: 's1', createdAt: 1, status: 'dispatching', tasks: [], maxConcurrent: 3 }
  const task = { id: 't1', title: '实现', roleId: 'dev', dependsOn: [], acceptance: 'x', status: 'pending' }
  const result = await spawnMember(ctx, {
    plan,
    task,
    role: { id: 'dev', name: 'dev', duty: '', skillIds: [], builtin: true, updatedAt: 1 },
    name: 'dev-t1',
    prompt: '去做 t1',
  } as never)

  assert.deepEqual(result, { ok: true, memberId: 'm-1', name: 'dev-t1' })
  assert.equal(requests[0]?.name, 'dev-t1')
  assert.equal(requests[0]?.provider, 'session-default', '未声明模型时 provider 回落会话默认')
  assert.deepEqual(requests[0]?.prompt, [{ type: 'text', text: '去做 t1' }])
})

/** 假宿主 ctx：只实现事件订阅与 warn（够测 onMemberProgress 的全部降级分支）。 */
function fakeCtx() {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  const warnings: string[] = []
  const ctx = {
    logger: {
      warn: (message: string) => {
        warnings.push(message)
      },
    },
    on: (event: string, listener: (...args: unknown[]) => unknown) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
  }
  return {
    ctx: ctx as unknown as HostContext,
    listeners,
    warnings,
    emit(event: string, ...args: unknown[]): void {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
    },
  }
}

test('agentOfToolEvent：只认已实测的三种形状（exec / {exec} / {agent}），不猜同义字段', () => {
  const agent = { id: 'session-agent-1' }
  assert.equal(agentOfToolEvent({ callId: 'c1', agent }), agent, 'exec 本身（tools/result 的第一个入参）')
  assert.equal(agentOfToolEvent({ exec: { agent }, result: {} }), agent, '被我们包成 { exec } 的形态')
  assert.equal(agentOfToolEvent({ agent }), agent, 'agent 直接挂在根上（其它 emit 事件）')
  assert.equal(agentOfToolEvent({ callId: 'c1' }), undefined, '没有 agent 字段 → undefined')
  assert.equal(agentOfToolEvent({ sender: agent }), undefined, '不猜 sender 这类同义词')
  assert.equal(agentOfToolEvent({ agent: { id: '' } }), undefined, '空 id 不是 agent')
  assert.equal(agentOfToolEvent(null), undefined)
  assert.equal(agentOfToolEvent('exec'), undefined)
})

test('onMemberProgress：宿主没有 ctx.on 时 warn + 返回空 stop，绝不抛错', () => {
  const warnings: string[] = []
  const sub = onMemberProgress({ logger: { warn: (message: string) => warnings.push(message) } }, () => {})
  assert.equal(typeof sub.stop, 'function')
  sub.stop() // 空 stop 可重复调用
  assert.equal(warnings.length, 1)
  assert.match(warnings[0] ?? '', /ctx\.on/)
})

test('onMemberProgress：tools/result 的 (exec,result) 能取出成员 agent 并回调', () => {
  const fake = fakeCtx()
  const seen: Array<{ agent: unknown; at: number }> = []
  const sub = onMemberProgress(fake.ctx, (info) => seen.push(info))

  fake.emit('tools/result', { callId: 'c1', agent: { id: 'member-1' } }, { ok: true })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0]?.agent, { id: 'member-1' })
  assert.equal(typeof seen[0]?.at, 'number')

  fake.emit('tools/result', { callId: 'c2' }, { ok: true }) // 无 agent：不回调（不猜是哪个成员）
  assert.equal(seen.length, 1)
  sub.stop()
})

test('onMemberProgress：agent/status 兜底事件同样能给出推进信号（两条都注册）', () => {
  const fake = fakeCtx()
  const seen: unknown[] = []
  const sub = onMemberProgress(fake.ctx, (info) => seen.push(info.agent))
  assert.deepEqual([...fake.listeners.keys()].sort(), ['agent/status', 'tools/result'])

  fake.emit('agent/status', { agent: { id: 'member-2' } })
  assert.deepEqual(seen, [{ id: 'member-2' }])
  sub.stop()
})

test('onMemberProgress：只用 emit 类事件（不订阅 waterfall 的 tools/execute）', () => {
  const fake = fakeCtx()
  onMemberProgress(fake.ctx, () => {}).stop()
  assert.equal(fake.listeners.has('tools/execute'), false, 'tools/execute 是 waterfall，漏调 next() 会吞掉工具执行')
})

test('onMemberProgress：handler 抛错不外溢（store 写盘异常不能打断宿主工具执行链）', () => {
  const fake = fakeCtx()
  const sub = onMemberProgress(fake.ctx, () => {
    throw new Error('disk full')
  })
  assert.doesNotThrow(() => fake.emit('tools/result', { agent: { id: 'member-1' } }))
  assert.match(fake.warnings.at(-1) ?? '', /disk full/)
  sub.stop()
})

test('onMemberProgress：stop 后不再回调，且 disposer 全部被调用', () => {
  const fake = fakeCtx()
  let calls = 0
  const sub = onMemberProgress(fake.ctx, () => {
    calls += 1
  })
  fake.emit('tools/result', { agent: { id: 'member-1' } })
  sub.stop()
  assert.equal(fake.listeners.get('tools/result')?.length, 0)
  assert.equal(fake.listeners.get('agent/status')?.length, 0)
  fake.emit('tools/result', { agent: { id: 'member-1' } })
  sub.stop() // 幂等
  assert.equal(calls, 1)
})
