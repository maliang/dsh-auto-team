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
  captainAgentScopeOf,
  createSpawnPorts,
  installCaptainRoute,
  listHostMembers,
  losslessJson,
  memberIdentityOf,
  onHostTriggerEvents,
  onMemberProgress,
  optionalService,
  registerAgentCreated,
  registerEffect,
  registerHttpRoutes,
  registerPromptSection,
  registerTool,
  registerToolGuard,
  readSessionCallCount,
  readWorkspaces,
  resolveConcurrencyLimit,
  spawnFailureText,
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
  // webServer 是**可选服务**：宿主只经 ctx.get('webServer') 交付，裸字段访问在真机上会被 cordis 拦掉。
  const services: Record<string, unknown> = { webServer: { register: (route: unknown) => void registered.push(route as never) } }
  const ctx = { get: (name: string) => services[name] } as unknown as HostContext
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

  // ① 请求里带上了声明模型（`provider` 是 subagent 名，LLM 路由在 agentOptions 里）
  assert.equal(requests[0]?.provider, 'spawn')
  assert.deepEqual(requests[0]?.agentOptions, { provider: 'deepseek', model: 'deepseek-reasoner' })

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
    // agentDefaultModel 是可选服务：只经 ctx.get 交付（见 optionalService 的白名单纪律）。
    get: (name: string) =>
      name === 'agentDefaultModel'
        ? { currentSelection: () => ({ provider: 'session-default', model: 'session-default-model' }) }
        : undefined,
    agentTeams: {
      spawnTeammate: async (_caller: unknown, request: unknown) => {
        requests.push(request as Record<string, unknown>)
        return { member: { id: 'm-1', name: 'dev-t1' } }
      },
    },
  } as unknown as HostContext
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
  assert.equal(
    requests[0]?.provider,
    'spawn',
    'provider 是 subagent provider 名（不是 LLM provider）——填会话默认模型名会让宿主报 no subagent provider registered',
  )
  assert.deepEqual(
    requests[0]?.agentOptions,
    { provider: 'session-default', model: 'session-default-model' },
    '未声明角色模型时，会话默认的完整路由（provider+model 成对）经 agentOptions 下发',
  )
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

/* ------------------------------------------------------------------ *
 * r5 · T5：四个新宿主触点（守卫 / 四类事件 / 队长作用域 / 队长路由）
 *
 * 这些绑定的错法全是「静默」的：漏调 next() 会把工具执行吞掉、少订阅一路事件让推进
 * 永远不触发、能力位假称生效让面板撒谎。所以每条都钉住可观察行为，而不是「能注册上」。
 * ------------------------------------------------------------------ */

/** 取某事件的唯一监听器（宿主 waterfall 的返回值只有直接调用监听器才拿得到）。 */
function listenerOf(fake: ReturnType<typeof fakeCtx>, event: string): (...args: unknown[]) => unknown {
  const list = fake.listeners.get(event) ?? []
  assert.equal(list.length, 1, `${event} 应当恰好注册了一个监听器`)
  return list[0] as (...args: unknown[]) => unknown
}

const BASH_SLEEP30 = { callId: 'c1', name: 'bash', arguments: { command: 'sleep 30' } }

test('registerToolGuard：放行分支必须调 next()（漏调等于吞掉工具执行）', () => {
  const fake = fakeCtx()
  const seen: Array<{ toolName: string; agentId: string | null }> = []
  registerToolGuard(fake.ctx, (request) => {
    seen.push({ toolName: request.toolName, agentId: request.agentId })
    return { allow: true }
  })

  let nextCalls = 0
  const out = listenerOf(fake, 'tools/execute')({ name: 'bash', arguments: { command: 'git status' } }, () => {
    nextCalls += 1
    return { content: [] }
  })

  assert.equal(nextCalls, 1, '放行必须交回下游')
  assert.deepEqual(seen, [{ toolName: 'bash', agentId: null }], '主 session 没有 exec.agent 时按队长（null）判（U4）')
  assert.deepEqual(out, { content: [] }, '放行时原样返回 next() 的结果，不能包装')
})

test('registerToolGuard：拒绝分支短路——不调 next()，返回可读原因码', () => {
  const fake = fakeCtx()
  registerToolGuard(fake.ctx, () => ({
    allow: false,
    code: 'NOWAIT_FOREGROUND_WAIT',
    message: '前台同步等待被拒绝（NOWAIT_FOREGROUND_WAIT）：下一步改成后台执行（命令末尾加 &）。',
    command: 'sleep 30',
  }))

  let nextCalls = 0
  const out = listenerOf(fake, 'tools/execute')(BASH_SLEEP30, () => {
    nextCalls += 1
  }) as { ok: boolean; code: string; message: string; command: string }

  assert.equal(nextCalls, 0, '拒绝时绝不能调 next()，否则命令照样执行（AC-4 的「命令不真正执行」）')
  assert.equal(out.ok, false)
  assert.equal(out.code, 'NOWAIT_FOREGROUND_WAIT')
  assert.equal(out.command, 'sleep 30')
  assert.match(out.message, /下一步/, '模型要看到「下一步怎么做」，不只是被拒')
})

test('registerToolGuard：判定抛错必须 fail-open（少拦一次，不能拦住正常工作）', () => {
  const fake = fakeCtx()
  registerToolGuard(fake.ctx, () => {
    throw new Error('guard blew up')
  })

  let nextCalls = 0
  assert.doesNotThrow(() => {
    listenerOf(fake, 'tools/execute')(BASH_SLEEP30, () => {
      nextCalls += 1
    })
  })
  assert.equal(nextCalls, 1, '判定异常时放行')
  assert.match(fake.warnings.at(-1) ?? '', /guard blew up/, '异常要留痕，否则「守卫没生效」无人知晓')
})

test('registerToolGuard：形状不认识的 payload 一律放行（不猜宿主字段）', () => {
  const fake = fakeCtx()
  let decided = 0
  registerToolGuard(fake.ctx, () => {
    decided += 1
    return { allow: false, code: 'NOWAIT_BLOCKING_TTY', message: 'blocked', command: 'wait' }
  })
  let nextCalls = 0
  const next = () => {
    nextCalls += 1
  }
  listenerOf(fake, 'tools/execute')(null, next)
  listenerOf(fake, 'tools/execute')({ arguments: { command: 'sleep 30' } }, next)
  listenerOf(fake, 'tools/execute')({ name: '' }, next)

  assert.equal(nextCalls, 3)
  assert.equal(decided, 0, '没有可判定的 name 就不该进入判定')
})

test('registerToolGuard：下游工具自己抛错不会被当成「判定异常」再调一次 next（命令不能执行两次）', () => {
  const fake = fakeCtx()
  registerToolGuard(fake.ctx, () => ({ allow: true }))

  let nextCalls = 0
  const next = () => {
    nextCalls += 1
    throw new Error('tool exploded')
  }
  assert.throws(() => listenerOf(fake, 'tools/execute')(BASH_SLEEP30, next), /tool exploded/)
  assert.equal(nextCalls, 1, 'next() 必须包在判定 try 之外，否则下游异常会触发第二次执行')
})

test('registerToolGuard：宿主没有 ctx.on → 空 stop + warn（L3，QA 必须记未验证）', () => {
  const warnings: string[] = []
  const stop = registerToolGuard({ logger: { warn: (message: string) => warnings.push(message) } }, () => ({ allow: true }))
  assert.equal(typeof stop, 'function')
  stop()
  stop() // 幂等
  assert.equal(warnings.length, 1)
  assert.match(warnings[0] ?? '', /ctx\.on/)
})

test('registerToolGuard：订阅 tools/execute 本身失败也不抛错（不假装守卫存在）', () => {
  const warnings: string[] = []
  const ctx = {
    logger: {
      warn: (message: string) => {
        warnings.push(message)
      },
    },
    on: () => {
      throw new Error('unknown event tools/execute')
    },
  } as unknown as HostContext
  const stop = registerToolGuard(ctx, () => ({ allow: true }))
  assert.equal(typeof stop, 'function')
  stop()
  assert.match(warnings.at(-1) ?? '', /订阅失败/)
})

test('onHostTriggerEvents：四类事件全订阅，payload 归一化为具名对象', () => {
  const fake = fakeCtx()
  const seen: Array<{ name: string; payload: unknown }> = []
  const sub = onHostTriggerEvents(fake.ctx, (name, payload) => {
    seen.push({ name, payload })
  })

  assert.deepEqual(
    [...fake.listeners.keys()].sort(),
    ['agent/error', 'agent/status', 'subagent/end', 'tools/result'],
    '四类事件缺一不可（少一路就等于少一条推进通路）',
  )
  assert.equal(sub.degraded, false)

  fake.emit('tools/result', { name: 'bash' }, { ok: true })
  assert.deepEqual(seen[0], {
    name: 'tools/result',
    payload: { exec: { name: 'bash' }, result: { ok: true } },
    // tools/result 的签名是 (exec, result)：包成具名对象，消费侧不必再记参数位序
  })

  fake.emit('agent/status', { id: 'member-1', status: 'inactive' })
  assert.deepEqual(seen[1], { name: 'agent/status', payload: { id: 'member-1', status: 'inactive' } })

  sub.stop()
  for (const event of ['agent/error', 'agent/status', 'subagent/end', 'tools/result']) {
    assert.equal(fake.listeners.get(event)?.length, 0, `${event} 的监听器必须被 stop() 收回`)
  }
  sub.stop() // 幂等
})

test('onHostTriggerEvents：部分事件订阅失败 → degraded:true + warn，其余照常（AC-18）', () => {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  const warnings: string[] = []
  const ctx = {
    logger: {
      warn: (message: string) => {
        warnings.push(message)
      },
    },
    on: (event: string, listener: (...args: unknown[]) => unknown) => {
      if (event === 'subagent/end') throw new Error('unknown event subagent/end')
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
  } as unknown as HostContext

  const sub = onHostTriggerEvents(ctx, () => {})
  assert.equal(sub.degraded, true, '降级必须如实上报（面板 header 靠它显示「事件源降级」）')
  assert.match(warnings.join('\n'), /subagent\/end/)
  assert.equal(listeners.get('tools/result')?.length, 1, '一路失败不影响其余三路')
  sub.stop()
})

test('onHostTriggerEvents：宿主没有 ctx.on → degraded:true（四类推进退回 poll）', () => {
  const warnings: string[] = []
  const sub = onHostTriggerEvents(
    { logger: { warn: (message: string) => warnings.push(message) } },
    () => {},
  )
  assert.equal(sub.degraded, true)
  sub.stop()
  assert.match(warnings[0] ?? '', /ctx\.on/)
})

test('onHostTriggerEvents：handler 抛错不外溢（事件总线不能被我们打断）', () => {
  const fake = fakeCtx()
  onHostTriggerEvents(fake.ctx, () => {
    throw new Error('store write failed')
  })
  assert.doesNotThrow(() => fake.emit('agent/error', { id: 'member-1' }))
  assert.match(fake.warnings.at(-1) ?? '', /store write failed/)
})

test('captainAgentScopeOf：拿不到主 session agent 时返回 null（能力位 fail-closed）', () => {
  assert.equal(captainAgentScopeOf({} as HostContext), null, '宿主不提供 agents 服务')
  assert.equal(
    captainAgentScopeOf({ agents: { currentInitiator: () => undefined } } as unknown as HostContext),
    null,
    'apply 期没有发起者（U3/U4 未实测时的常态）',
  )
  assert.equal(
    captainAgentScopeOf({
      agents: {
        currentInitiator: () => {
          throw new Error('no initiator')
        },
      },
    } as unknown as HostContext),
    null,
    '宿主抛错也必须吞掉：能力位缺失只能让面板显示「未生效」，不能拖垮装配',
  )
  assert.equal(
    captainAgentScopeOf({ agents: { currentInitiator: () => ({ id: 'root' }) } } as unknown as HostContext),
    null,
    'agent 没有 ctx.on 就不是可用作用域',
  )
})

test('captainAgentScopeOf：主 session agent 带 ctx.on 时返回该事件作用域', () => {
  const scope = { on: () => () => {} }
  const ctx = { agents: { currentInitiator: () => ({ id: 'root', ctx: scope }) } } as unknown as HostContext
  assert.equal(captainAgentScopeOf(ctx), scope, '探测与安装必须同源（同一个 captainAgentOf）')
})

test('installCaptainRoute：拿不到作用域 → null（绝不假装生效）', () => {
  assert.equal(installCaptainRoute({} as HostContext, { provider: 'p', model: 'm' }), null)
})

test('installCaptainRoute：装在主 session 作用域上改写 provider/model 并剔除继承的 reasoningEffort', async () => {
  const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  const scope = {
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
  const ctx = { agents: { currentInitiator: () => ({ id: 'root', ctx: scope }) } } as unknown as HostContext

  const undo = installCaptainRoute(ctx, { provider: 'captain-p', model: 'captain-m' })
  assert.notEqual(undo, null, '有作用域时必须装上')
  assert.equal(listeners.get('system-prompt/assemble')?.length, 1)
  assert.equal(listeners.get('agent/request')?.length, 1)

  const assemble = listeners.get('system-prompt/assemble')?.[0] as (...args: unknown[]) => Promise<unknown>
  await assemble(async () => ({ sections: [] }))

  const request = listeners.get('agent/request')?.[0] as (...args: unknown[]) => Promise<unknown>
  const out = (await request(async () => ({
    provider: 'session',
    model: 'default',
    reasoningEffort: 'high',
    temperature: 0.2,
  }))) as Record<string, unknown>

  assert.equal(out.provider, 'captain-p')
  assert.equal(out.model, 'captain-m')
  assert.equal(out.reasoningEffort, undefined, '继承来的 effort 必须剔除（否则队长的档位会漏给主 session）')
  assert.equal(out.temperature, 0.2, '其它字段原样透传')

  undo?.()
  assert.equal(listeners.get('agent/request')?.length, 0, 'disposer 必须能收回安装')
  assert.equal(listeners.get('system-prompt/assemble')?.length, 0)
})

// ---------------------------------------------------------------------------
// r6：可选服务的降级路径（AC-5）
// webServer / llm / agentDefaultModel 是**可选**服务：宿主缺它时必须降级，不能拖垮整条 entry。
// 三条路径各自独立断言——否则「插件能激活」会掩盖「功能静默缺失」。
// ---------------------------------------------------------------------------

test('optionalService：ctx 没有 get 时按缺失降级（warn 且不抛，不回退裸读）', () => {
  const warns: string[] = []
  const ctx = {
    // 旧宿主 / 手搓 fake ctx 的形态：服务字段存在，但没有 get 读取口。
    webServer: { register: () => () => {} },
    logger: { warn: (message: string) => void warns.push(message) },
  } as unknown as HostContext

  assert.equal(optionalService(ctx, 'webServer'), undefined, '没有 get 时必须返回 undefined')
  assert.equal(warns.length, 1, `必须 warn 一次，实际 ${warns.length}`)
  assert.match(warns[0] ?? '', /webServer/, 'warn 文案必须点名是哪个可选服务降级了')
})

test('optionalService：宿主未注册该服务时返回 undefined；get 抛错也被兜住', () => {
  const warns: string[] = []
  const logger = { warn: (message: string) => void warns.push(message) }

  const missing = { get: () => undefined, logger } as unknown as HostContext
  assert.equal(optionalService(missing, 'llm'), undefined, '服务缺失时返回 undefined')

  const throwing = {
    get: () => {
      throw new Error('service load failed')
    },
    logger,
  } as unknown as HostContext
  assert.equal(optionalService(throwing, 'agentDefaultModel'), undefined, 'get 抛错必须兜住，异常不出本函数')
  assert.equal(warns.length, 2, '两条降级路径各 warn 一次')
  assert.match(warns[1] ?? '', /agentDefaultModel/, '异常路径的 warn 也要点名服务')
})

test('registerHttpRoutes：ctx.get 拿不到 webServer 时不注册路由并如实返回 false', () => {
  let registered = 0
  const ctx = {
    // 有的宿主没有 webServer（纯 CLI profile）：此时面板不可用，但工具必须照常可用。
    get: () => undefined,
    logger: { warn: () => {} },
  } as unknown as HostContext
  const ok = registerHttpRoutes(ctx, [
    { method: 'GET', path: '/api/auto-team/snapshot', handle: async () => ({ data: {} }) },
  ])

  assert.equal(ok, false, '没有 webServer 时必须返回 false（装配层据此告警，而不是假装注册成功）')
  assert.equal(registered, 0)

  // 反证：同一个 ctx 补上 webServer 后必须真注册——证明上面的 false 来自「服务缺失」而不是「根本没实现」。
  const withSink = {
    get: (name: string) => (name === 'webServer' ? { register: () => void (registered += 1) } : undefined),
  } as unknown as HostContext
  assert.equal(registerHttpRoutes(withSink, [{ method: 'GET', path: '/api/auto-team/snapshot', handle: async () => ({ data: {} }) }]), true)
  assert.equal(registered, 1, '有 webServer 时必须注册一条 prefix 路由')
})

test('createSpawnPorts：provider 必须是 subagent provider 名，LLM 模型走 agentOptions（r12 真机事故）', async () => {
  const requests: Array<Record<string, unknown>> = []
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: () => undefined, // 宿主没有默认模型选择，也没注册 subagents 表
    logger: { warn: () => {} },
    agentTeams: {
      spawnTeammate: async (_caller: unknown, request: unknown) => {
        requests.push(request as Record<string, unknown>)
        return { member: { id: 'm-1', name: 'dev-t1' } }
      },
    },
  } as unknown as HostContext

  const ports = createSpawnPorts(ctx)
  const result = await ports.spawn({ prompt: '去做 t1', name: 'dev-t1', sessionId: 's1', taskId: 't1' })

  assert.equal(result.ok, true, '定不出 LLM 模型也必须照常派发：模型交给宿主默认，不该因此整个失败')
  assert.equal(requests.length, 1)
  assert.equal(
    requests[0]?.provider,
    'spawn',
    'provider 是 subagent provider 名（宿主注册表里的 spawn），把 LLM provider 塞进来会让宿主报 no subagent provider registered',
  )
  assert.equal(requests[0]?.agentOptions, undefined, '既无角色模型也无会话默认时不该凭空造 agentOptions')

  // 角色声明了模型：provider 仍必须是 spawn，LLM 路由走 agentOptions（宿主官方通道）。
  const withRoute = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: () => undefined,
    logger: { warn: () => {} },
    agentTeams: {
      spawnTeammate: async (_caller: unknown, request: unknown) => {
        requests.push(request as Record<string, unknown>)
        return { member: { id: 'm-2', name: 'dev-t2' } }
      },
    },
  } as unknown as HostContext
  await createSpawnPorts(withRoute).spawn({
    prompt: '去做 t2',
    name: 'dev-t2',
    sessionId: 's1',
    taskId: 't2',
    route: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
  })
  assert.equal(requests[1]?.provider, 'spawn', '角色声明的 LLM provider 绝不能填进 provider 字段')
  assert.deepEqual(
    requests[1]?.agentOptions,
    { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
    '逐角色模型经 agentOptions 下发（SubagentStartRequest 的官方字段）',
  )

  // 只有会话默认模型 **且只有 provider**：r27 起不再下发半截路由（会把宿主拼出混合模型）。
  const withDefault = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: (name: string) => (name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'host-default' }) } : undefined),
    logger: { warn: () => {} },
    agentTeams: {
      spawnTeammate: async (_caller: unknown, request: unknown) => {
        requests.push(request as Record<string, unknown>)
        return { member: { id: 'm-3', name: 'dev-t3' } }
      },
    },
  } as unknown as HostContext
  const ok = await createSpawnPorts(withDefault).spawn({ prompt: '去做 t3', name: 'dev-t3', sessionId: 's1', taskId: 't3' })
  assert.equal(ok.ok, true)
  assert.equal(requests[2]?.provider, 'spawn')
  assert.equal(requests[2]?.agentOptions, undefined, '只有 provider 是半截路由，宁可不传也不让宿主猜 model（r27）')

  // 注册表给了多个名字：优先 spawn；没有 spawn 时取第一个已注册的名字。
  const multi = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: (name: string) =>
      name === 'subagents' ? { list: () => ['custom-provider', 'spawn'] } : undefined,
    logger: { warn: () => {} },
    agentTeams: {
      spawnTeammate: async (_caller: unknown, request: unknown) => {
        requests.push(request as Record<string, unknown>)
        return { member: { id: 'm-4', name: 'dev-t4' } }
      },
    },
  } as unknown as HostContext
  await createSpawnPorts(multi).spawn({ prompt: '去做 t4', name: 'dev-t4', sessionId: 's1', taskId: 't4' })
  assert.equal(requests[3]?.provider, 'spawn', '注册表里有 spawn 就优先用它')

  const onlyCustom = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: (name: string) => (name === 'subagents' ? { list: () => ['custom-provider'] } : undefined),
    logger: { warn: () => {} },
    agentTeams: {
      spawnTeammate: async (_caller: unknown, request: unknown) => {
        requests.push(request as Record<string, unknown>)
        return { member: { id: 'm-5', name: 'dev-t5' } }
      },
    },
  } as unknown as HostContext
  await createSpawnPorts(onlyCustom).spawn({ prompt: '去做 t5', name: 'dev-t5', sessionId: 's1', taskId: 't5' })
  assert.equal(requests[4]?.provider, 'custom-provider', '没有 spawn 时取注册表第一个名字')
})

test('createSpawnPorts：新宿主走 subagents.startActivation（label 截断 / delivery=parent / 不 await result）', async () => {
  const specs: Array<Record<string, unknown>> = []
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: (name: string) =>
      name === 'subagents'
        ? {
            getProvider: (provider: string) => (provider === 'spawn' ? { name: 'spawn' } : undefined),
            startActivation: async (spec: Record<string, unknown>) => {
              specs.push(spec)
              // 宿主真实形状：childId 就是 SessionId；result 是成员完成结果（可能 reject）
              return { childId: 'child-1', name: 'dev-t1', result: Promise.reject(new Error('member crashed')) }
            },
          }
        : undefined,
    logger: { warn: () => {} },
    // 故意不提供 spawnTeammate：0.2.2-rc.2 已移除，若实现回退旧路径这里会直接失败
  } as unknown as HostContext

  const longTitle = '实现'.repeat(40) // 80 字符：超过宿主 label 上限，必须截断而不是报错
  const result = await createSpawnPorts(ctx).spawn({
    prompt: '去做 t1',
    name: 'dev-t1',
    sessionId: 's1',
    taskId: 't1',
    description: longTitle,
    route: { provider: 'deepseek', model: 'deepseek-reasoner' },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result, { ok: true, memberId: 'child-1' }, '观测不到实际路由时不许伪造 actual')
  assert.equal(specs.length, 1)
  assert.equal(specs[0]?.provider, 'spawn', 'provider 是 subagent provider 名（不是 LLM provider）')
  assert.equal(specs[0]?.name, 'dev-t1')
  assert.equal((specs[0]?.label as string).length, 64, 'label 截断到宿主上限 64')
  assert.deepEqual(specs[0]?.prompt, [{ type: 'text', text: '去做 t1' }])
  assert.equal(specs[0]?.delivery, 'parent', '完成时通知父会话模型')
  assert.deepEqual(specs[0]?.parent, { id: 'captain' })
  assert.ok(specs[0]?.signal instanceof AbortSignal)
  assert.deepEqual(specs[0]?.agentOptions, { provider: 'deepseek', model: 'deepseek-reasoner' })
  // 成员的失败结果必须被就地吞掉：等一个 macrotask，未处理 rejection 会让本测试进程直接红
  await new Promise((resolve) => setTimeout(resolve, 20))
})

test('createSpawnPorts：新旧宿主能力都没有时给明确文案（不再只报 agentTeams.spawnTeammate）', async () => {
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: () => undefined,
  } as unknown as HostContext
  const result = await createSpawnPorts(ctx).spawn({ prompt: 'x', name: 'dev-t1', sessionId: 's1', taskId: 't1' })
  assert.equal(result.ok, false)
  const error = result.ok ? '' : result.error
  assert.match(error, /subagents\.startActivation/)
  assert.match(error, /agentTeams\.spawnTeammate/)
})

test('sendMessage / interruptMember：新宿主按 SessionId 直发，中断带 ancestor 授权', async () => {
  const sent: Array<Record<string, unknown>> = []
  const interrupted: Array<Record<string, unknown>> = []
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: (name: string) =>
      name === 'subagents'
        ? {
            sendMessage: async (sender: unknown, targetId: string, content: unknown, options: unknown) => {
              sent.push({ sender, targetId, content, options })
              return 'msg-1'
            },
            resolveName: async (_caller: unknown, name: string) => (name === 'dev-t1' ? 'child-1' : name),
            interrupt: (id: string, authority: unknown) => void interrupted.push({ id, authority }),
          }
        : undefined,
  } as unknown as HostContext

  const ports = createSpawnPorts(ctx)
  assert.deepEqual(await ports.sendMessage('child-1', '改一下'), { ok: true })
  assert.equal(sent[0]?.targetId, 'child-1', '新 API 直发 SessionId，不经名字表')
  assert.deepEqual(sent[0]?.content, [{ type: 'text', text: '改一下' }])
  assert.ok((sent[0]?.options as { signal?: unknown })?.signal instanceof AbortSignal)

  assert.deepEqual(await ports.interruptMember!('dev-t1'), { ok: true })
  assert.deepEqual(interrupted[0], {
    id: 'child-1',
    authority: { kind: 'ancestor', agent: { id: 'captain' } },
  })
})

test('listHostMembers：新宿主读 subagents.listDescendants，跳过 diagnostic，路径取最后一段', async () => {
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: (name: string) =>
      name === 'subagents'
        ? {
            rootOf: () => ({ id: 'root-1' }),
            listDescendants: async (rootId: string) => {
              assert.equal(rootId, 'root-1')
              return [
                { kind: 'child', id: 'c1', activity: 'running', path: 'lead/dev-t1', parentId: 'root-1', depth: 1, hasChildren: false },
                { kind: 'child', id: 'c2', activity: 'inactive', path: 'lead/qa-t1', parentId: 'root-1', depth: 1, hasChildren: false },
                { kind: 'child', id: 'c3', activity: 'running', parentId: 'root-1', depth: 1, hasChildren: false },
                { kind: 'diagnostic', id: 'x1', reason: 'inbox unreadable', parentId: 'root-1', depth: 1 },
              ]
            },
          }
        : undefined,
  } as unknown as HostContext

  assert.deepEqual(await listHostMembers(ctx), [
    { id: 'c1', name: 'dev-t1', status: 'running' },
    { id: 'c2', name: 'qa-t1', status: 'inactive' },
    { id: 'c3', name: '', status: 'running' },
  ])

  // 返回值不是数组 = 契约不符 → 必须抛错（空数组会被 watcher 当成「成员全死」）
  const broken = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: (name: string) => (name === 'subagents' ? { rootOf: () => ({ id: 'root-1' }), listDescendants: async () => undefined } : undefined),
  } as unknown as HostContext
  await assert.rejects(listHostMembers(broken), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'NOT_FOUND')
    return true
  })
})

test('memberIdentityOf：新宿主优先 subagents.namesOf 的路径名，id 取 agent.id', () => {
  const ctx = {
    get: (name: string) =>
      name === 'subagents' ? { namesOf: () => ({ name: 'lead/dev-t1', creator: 'lead' }) } : undefined,
  } as unknown as HostContext
  assert.deepEqual(memberIdentityOf(ctx, { id: 'child-1' }), { id: 'child-1', name: 'dev-t1' })

  // namesOf 抛错 → 退回 agent 自身字段（不臆造）
  const broken = { get: () => ({ namesOf: () => { throw new Error('no such agent') } }) } as unknown as HostContext
  assert.deepEqual(memberIdentityOf(broken, { id: 'child-2', name: 'qa-t1' }), { id: 'child-2', name: 'qa-t1' })
})

test('losslessJson：undefined 键必须被丢掉（宿主拒收 lossy 返回，r12 真机事故）', () => {
  const stripped = losslessJson({
    ok: true,
    runId: undefined,
    planStatus: undefined,
    tasks: [{ id: 't1', memberId: undefined, evidence: undefined, status: 'pending' }],
    members: [],
  })
  assert.deepEqual(stripped, { ok: true, tasks: [{ id: 't1', status: 'pending' }], members: [] })
  assert.equal(JSON.stringify(stripped).includes('undefined'), false, '序列化后不得残留 undefined')
  // 「有键但值是 undefined」与「没有键」在宿主眼里都必须是后者，否则 auto_team_status 在无计划时必挂。
  assert.equal(Object.hasOwn(stripped as object, 'runId'), false)
})

test('losslessJson：数组内 undefined 换 null（保位置）、NaN 换 null、bigint 转字符串、循环引用不炸', () => {
  const circular: Record<string, unknown> = { name: 'loop' }
  circular.self = circular
  const out = losslessJson({
    list: [undefined, 1, null],
    nan: Number.NaN,
    inf: Number.POSITIVE_INFINITY,
    big: 10n,
    fn: () => 1,
    circular,
  }) as Record<string, unknown>
  assert.deepEqual(out.list, [null, 1, null])
  assert.equal(out.nan, null)
  assert.equal(out.inf, null)
  assert.equal(out.big, '10')
  assert.equal(Object.hasOwn(out, 'fn'), false, '函数值也要丢键')
  assert.deepEqual((out.circular as Record<string, unknown>).self, null, '循环引用收敛成 null')
})

test('工具 execute 收口过 losslessJson：含 undefined 的 handler 返回值不再被判 lossy', async () => {
  const def = toHostToolDefinition({
    name: 'auto_team_status',
    description: '读取状态',
    parameters: { type: 'object' },
    // 复刻 r12 事故形状：无计划时 runId/planStatus/plannedAt 全 undefined，任务未派发时 memberId/evidence 也是 undefined。
    handler: async () => ({
      ok: true,
      enabled: true,
      runId: undefined,
      planStatus: undefined,
      plannedAt: undefined,
      tasks: [{ id: 't1', memberId: undefined, evidence: undefined }],
    }),
  }) as { execute: (args: Record<string, unknown>, meta?: unknown) => Promise<unknown> }

  const value = await def.execute({}, { agent: { id: 's1' } })
  assert.deepEqual(value, { ok: true, enabled: true, tasks: [{ id: 't1' }] })
  assert.equal(JSON.stringify(value).includes('undefined'), false)
})

// ---------------------------------------------------------------------------
// r19：workspaceRegistry 是可选服务（宿主 headless / 旧宿主可能没有）。
// 四条降级路径必须各自独立成立：缺失 / list 抛错 / 非数组 / 实体字段读不出。
// ---------------------------------------------------------------------------

function ctxWithRegistry(registry: unknown): HostContext {
  return {
    get: (name: string) => (name === 'workspaceRegistry' ? registry : undefined),
  } as unknown as HostContext
}

test('readWorkspaces：服务缺失 / 实体没有 list 时返回空数组（不抛、不回退裸读）', () => {
  assert.deepEqual(readWorkspaces({} as HostContext), [], '没有 get 的旧 ctx')
  assert.deepEqual(readWorkspaces(ctxWithRegistry(undefined)), [], '宿主未注册 workspaceRegistry')
  assert.deepEqual(readWorkspaces(ctxWithRegistry({})), [], '实体没有 list 方法')
})

test('readWorkspaces：list 抛错 / 返回非数组一律返回空数组（绝不抛）', () => {
  const throwing = {
    list: () => {
      throw new Error('storage domain not ready')
    },
  }
  assert.deepEqual(readWorkspaces(ctxWithRegistry(throwing)), [])

  assert.deepEqual(readWorkspaces(ctxWithRegistry({ list: () => undefined })), [])
  assert.deepEqual(readWorkspaces(ctxWithRegistry({ list: () => ({ items: [] }) })), [], '非数组不猜字段名')
})

test('readWorkspaces：实体用 getter 暴露字段（宿主真实形状），title 空则不带上', () => {
  class Entry {
    private readonly _path: string
    private readonly _title: string
    private readonly _sessions: unknown
    constructor(path: string, title: string, sessions: unknown) {
      this._path = path
      this._title = title
      this._sessions = sessions
    }
    get id(): string {
      return `id:${this._path}`
    }
    get path(): string {
      return this._path
    }
    get title(): string {
      return this._title
    }
    get sessionIds(): unknown {
      return this._sessions
    }
  }

  const list = () => [
    new Entry('/work/nengtan', 'nengtan', ['s1', 's2', 's1', 42, '']),
    new Entry('/work/unnamed', '   ', ['s3']),
  ]
  const entries = readWorkspaces(ctxWithRegistry({ list }))

  assert.deepEqual(entries, [
    { id: 'id:/work/nengtan', path: '/work/nengtan', title: 'nengtan', sessionIds: ['s1', 's2'] },
    { id: 'id:/work/unnamed', path: '/work/unnamed', sessionIds: ['s3'] },
  ])
})

test('readWorkspaces：缺 path / path 非字符串 / 单个实体读字段抛错 → 跳过该条，其余照常', () => {
  class BrokenPath {
    get path(): string {
      throw new Error('entity disposed')
    }
    get sessionIds(): string[] {
      return ['s-x']
    }
  }
  const list = () => [
    new BrokenPath(),
    { path: '', title: 'empty', sessionIds: [] },
    { title: 'no path', sessionIds: [] },
    { path: 42, sessionIds: [] },
    'not-an-entity',
    { path: '  /work/fine  ', sessionIds: 'not-an-array' },
  ]
  const entries = readWorkspaces(ctxWithRegistry({ list }))
  assert.deepEqual(entries, [{ path: '/work/fine', sessionIds: [] }], '只保留 path 非空的实体')
})

/* ─────────────── r20：调用次数 = 成员会话自己的 assistant/message 事件数 ─────────────── */

/** 最小会话桩：`inheritedEventCount` 之前的是父会话事件，`snapshotEvents(from)` 只返回自己的。 */
function callCtx(session: Record<string, unknown> | null): HostContext {
  return {
    agents: { get: (id: string) => (session !== null && id === 'm1' ? { id, session } : undefined) },
  } as unknown as HostContext
}

test('readSessionCallCount：从 inheritedEventCount 之后数，一条 assistant/message = 一次调用', () => {
  const events = [
    { type: 'assistant/message' }, // 父会话（fork 继承）
    { type: 'assistant/message' }, // 父会话
    { type: 'assistant/message' }, // 自己的第 1 次
    { type: 'step/end' },
    { type: 'assistant/message' }, // 自己的第 2 次
  ]
  const seen: unknown[] = []
  const session = {
    inheritedEventCount: 2,
    snapshotEvents: (from: number) => {
      seen.push(from)
      return events.slice(from)
    },
  }
  assert.equal(readSessionCallCount(callCtx(session), 'm1'), 2, '父会话的 2 条不许算进来')
  assert.deepEqual(seen, [2], '必须把 inheritedEventCount 交给 snapshotEvents 当起点')
})

test('readSessionCallCount：可读但 0 条 = 真实 0（不是「不可得」）；旧宿主退回 log 切片', () => {
  assert.equal(
    readSessionCallCount(callCtx({ inheritedEventCount: 0, snapshotEvents: () => [] }), 'm1'),
    0,
    '会话可读、没有调用 → 0 是真实计数，不能用 undefined 冒充缺失',
  )

  // 旧宿主没有 snapshotEvents：按同样的继承语义切 session.log。
  const legacy = {
    inheritedEventCount: 1,
    log: [{ type: 'assistant/message' }, { type: 'assistant/message' }, { type: 'step/end' }],
  }
  assert.equal(readSessionCallCount(callCtx(legacy), 'm1'), 1, 'log[0] 是父会话不数；后两条里只有 1 条 assistant/message')

  // 事件条目可以是任意形状：非对象 / 其他类型都不计数。
  const noisy = { inheritedEventCount: 0, snapshotEvents: () => [null, 42, 'x', { type: 'other' }, { type: 'assistant/message' }] }
  assert.equal(readSessionCallCount(callCtx(noisy), 'm1'), 1)
})

test('readSessionCallCount：会话未加载 / 日志不可读 / 空 id → undefined（保留已落盘值，绝不补 0）', () => {
  assert.equal(readSessionCallCount(callCtx(null), 'm1'), undefined, '会话未加载')
  assert.equal(readSessionCallCount(callCtx({}), 'm1'), undefined, '既无 snapshotEvents 也无 log')
  assert.equal(readSessionCallCount(callCtx({ log: 'not-an-array' }), 'm1'), undefined, 'log 不是数组')
  assert.equal(
    readSessionCallCount(
      callCtx({
        snapshotEvents: () => {
          throw new Error('session log unreadable')
        },
      }),
      'm1',
    ),
    undefined,
    '日志读抛错必须降级成不可得',
  )
  assert.equal(
    readSessionCallCount(callCtx({ snapshotEvents: () => undefined }), 'm1'),
    undefined,
    '读口返回非数组同样是不可得',
  )
  assert.equal(readSessionCallCount(callCtx({ inheritedEventCount: 0, snapshotEvents: () => [] }), ''), undefined, '空会话 id')
  assert.equal(readSessionCallCount(callCtx({ inheritedEventCount: 0, snapshotEvents: () => [] }), 'sess-unknown'), undefined)
})

/* ─────────── t5：宿主席位耗尽的失败文案 ─────────── */

test('t5：宿主席位耗尽 → 失败文案保留原文并给出 maxMembers 的调法（不再只透一句 member limit）', async () => {
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: () => undefined,
    logger: { warn: () => {} },
    agentTeams: {
      spawnTeammate: async () => {
        throw new Error('Team member limit 8 reached')
      },
    },
  } as unknown as HostContext

  const result = await createSpawnPorts(ctx).spawn({ prompt: '去做 t1', name: 'dev-t1', sessionId: 's1', taskId: 't1' })

  assert.equal(result.ok, false)
  const error = result.ok ? '' : result.error
  assert.match(error, /Team member limit 8 reached/, '宿主原文必须原样保留：分类错了也不能把真实原因藏掉')
  assert.match(error, /agent-team 的 maxMembers/, '必须点名要调大哪个配置（用户不知道 member limit 去哪改）')
  assert.match(error, /profile/, '要提示配置在 profile 里')
  assert.match(error, /cordis\.patch\.yml/, '最好给到具体文件')
})

test('t5：并发上限（active child limit）与普通失败各自给出不同文案', () => {
  const concurrent = spawnFailureText(new Error('active child limit 3 reached'))
  assert.match(concurrent, /active child limit 3 reached/)
  assert.match(concurrent, /并发|同时运行/, '并发名额要说明「等一会儿就好」')
  assert.doesNotMatch(concurrent, /maxMembers/, '并发上限不是终身名额，别把人引去改 maxMembers')

  const plain = spawnFailureText(new Error('no subagent provider registered for "x"'))
  assert.equal(plain, '创建成员失败：no subagent provider registered for "x"', '非名额错误只加既有前缀，不编造指引')

  const genericLimit = spawnFailureText(new Error('team member quota exceeded'))
  assert.match(genericLimit, /team member quota exceeded/)
  assert.match(genericLimit, /maxMembers/, '兜底正则也要把用户引向 maxMembers，不许静默失败')
})
