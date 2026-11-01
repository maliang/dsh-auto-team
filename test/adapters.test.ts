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
  onHostTriggerEvents,
  onMemberProgress,
  optionalService,
  registerAgentCreated,
  registerEffect,
  registerHttpRoutes,
  registerPromptSection,
  registerTool,
  registerToolGuard,
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
    // agentDefaultModel 是可选服务：只经 ctx.get 交付（见 optionalService 的白名单纪律）。
    get: (name: string) =>
      name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'session-default' }) } : undefined,
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

test('createSpawnPorts：缺 agentDefaultModel 时不带模型覆盖，并给出明确报错（不静默兜底）', async () => {
  const requests: Array<Record<string, unknown>> = []
  const ctx = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: () => undefined, // 宿主没有默认模型选择
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

  assert.equal(result.ok, false, '既没声明模型也没有宿主默认模型时必须失败，不能凭空猜一个 provider')
  assert.match(
    (result as { error?: string }).error ?? '',
    /无法确定成员的 provider/,
    '报错必须说清缺的是什么（角色未声明模型 + 宿主无默认模型）',
  )
  assert.equal(requests.length, 0, '既然定不出 provider，就不该发出 spawn 请求')

  // 反证：补上默认模型后同一条路径必须成功，且请求里带上该 provider（证明降级不是永久坏）。
  const withDefault = {
    agents: { currentInitiator: () => ({ id: 'captain' }) },
    get: (name: string) => (name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'host-default' }) } : undefined),
    logger: { warn: () => {} },
    agentTeams: {
      spawnTeammate: async (_caller: unknown, request: unknown) => {
        requests.push(request as Record<string, unknown>)
        return { member: { id: 'm-2', name: 'dev-t2' } }
      },
    },
  } as unknown as HostContext

  const ok = await createSpawnPorts(withDefault).spawn({ prompt: '去做 t2', name: 'dev-t2', sessionId: 's1', taskId: 't2' })
  assert.equal(ok.ok, true)
  assert.equal(requests[0]?.provider, 'host-default', '有宿主默认模型时 provider 落成它')
})
