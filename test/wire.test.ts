/**
 * 装配层（`src/host/index.ts`）的接线测试。
 *
 * 为什么需要这个文件：`dispatch.ts` / `watcher.ts` / `bridge.ts` 各自都有单测，但**没有人测过
 * 它们在 `apply()` 里是否真的被接上**。历史缺陷形态是「每个模块都绿，插件装进宿主后工具在、
 * 面板不动」——因为装配点漏了一个端口、或者注册段抛错被静默吞掉。所以这里用一个假 ctx 跑一遍
 * 真实 `apply()`，断言：
 *   1. 7 个工具 / 3 条面板接口 / 1 段队长提示词都真的注册上了；
 *   2. 一条完整主链路跑到底：plan → dispatch（起成员）→ receipt（过门禁）→ 下游 ready 再派发；
 *   3. watcher 真的在跑（杀成员后任务转 interrupted）且能被 ctx.effect 清理；
 *   4. `agent/created` 的实际模型与声明不一致时落 drift 审计（AC-22，不静默回退）。
 *
 * 假 ctx 只实现宿主真的会调用的那几个成员（形状取自 adapters 的实测契约），
 * 因此这里同时充当「装配层对宿主契约的消费清单」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, inject, name } from '../src/host/index.ts'
import { RunsStore, type RunState } from '../src/host/store.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { TOOL_PREFIX } from '../src/host/config.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-wire'

interface ToolDef {
  name: string
  execute: (args: unknown, meta: unknown) => Promise<unknown>
}

interface PanelRoute {
  kind: string
  path: string
  handler: (req: FakeReq, res: FakeRes) => Promise<void>
}

interface FakeReq {
  method: string
  url: string
  on(event: string, listener: (chunk?: unknown) => void): void
}

interface FakeRes {
  statusCode: number
  setHeader(name: string, value: string): void
  end(chunk?: string): void
}

interface Harness {
  ctx: Record<string, unknown>
  tools: ToolDef[]
  sections: Array<{ name: string; order: number; text: () => string }>
  routes: PanelRoute[]
  listeners: Array<(payload: unknown) => void>
  disposers: Array<() => void | Promise<void>>
  warnings: string[]
  members: Array<{ id: string; name: string; status: string }>
  spawned: Array<{ id: string; name: string }>
  sent: Array<{ target: string; text: string }>
  /** watcher 每轮都会取一次名单：调用次数增长 = 定时器真的在跑。 */
  memberListCalls(): number
}

function makeHarness(): Harness {
  const tools: ToolDef[] = []
  const sections: Harness['sections'] = []
  const routes: PanelRoute[] = []
  const listeners: Harness['listeners'] = []
  const disposers: Harness['disposers'] = []
  const warnings: string[] = []
  const members: Harness['members'] = []
  const spawned: Harness['spawned'] = []
  const sent: Harness['sent'] = []
  let seq = 0
  let listCalls = 0

  const ctx = {
    tools: { register: (def: unknown) => void tools.push(def as ToolDef) },
    systemPrompt: { section: (section: unknown) => void sections.push(section as Harness['sections'][number]) },
    webServer: { register: (route: unknown) => void routes.push(route as PanelRoute) },
    agents: { currentInitiator: () => ({ id: 'captain', name: 'captain' }) },
    agentTeams: {
      listMembers: async () => {
        listCalls += 1
        return members.map((member) => ({ ...member }))
      },
      spawnTeammate: async (_caller: unknown, request: { name?: string }) => {
        seq += 1
        const id = `m${seq}`
        const member = { id, name: request?.name ?? `member-${seq}`, status: 'running' }
        members.push(member)
        spawned.push({ id, name: member.name })
        return { member }
      },
      sendMessage: async (_caller: unknown, request: { target?: string; content?: Array<{ text?: string }> }) => {
        sent.push({ target: request?.target ?? '', text: request?.content?.[0]?.text ?? '' })
      },
    },
    llm: { resolveCallConfig: (config: unknown) => config },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
    effect: (dispose: () => void | Promise<void>) => void disposers.push(dispose),
    // 只收集 agent/created：它在用例里由测试**手动触发**来制造路由漂移。
    // 其余根作用域订阅（T2 的 tools/result + agent/status 推进信号）不该混进这个数组，
    // 否则 `listeners[0]` 会指错人，把推进信号当路由事件喂进去。
    on: (event: string, listener: (payload: unknown) => void) => {
      if (event === 'agent/created') listeners.push(listener)
    },
    logger: { warn: (text: string) => void warnings.push(text), info: () => {} },
  }

  return { ctx, tools, sections, routes, listeners, disposers, warnings, members, spawned, sent, memberListCalls: () => listCalls }
}

/** 面板接口的真实调用方式（宿主给的是单条 prefix 路由，method + path 由适配层分发）。 */
async function panel(
  routes: PanelRoute[],
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const route = routes[0]
  assert.ok(route, '面板路由必须已注册')
  const listeners = new Map<string, (chunk?: unknown) => void>()
  const chunks = body === undefined ? [] : [JSON.stringify(body)]
  let sent = ''
  const req: FakeReq = {
    method,
    url,
    on(event, listener) {
      listeners.set(event, listener)
    },
  }
  const res: FakeRes = {
    statusCode: 0,
    setHeader() {},
    end(chunk?: string) {
      sent = chunk ?? ''
    },
  }
  const done = route.handler(req, res)
  for (const chunk of chunks) listeners.get('data')?.(chunk)
  listeners.get('end')?.()
  await done
  return { status: res.statusCode, body: JSON.parse(sent) as Record<string, unknown> }
}

/** 面板动作：`{data: ActResult}`（`{data,error}` 包装只允许在 client/api.ts 解，测试按原样读）。 */
async function act(routes: PanelRoute[], action: Record<string, unknown>): Promise<Record<string, unknown>> {
  const reply = await panel(routes, 'POST', '/api/auto-team/act', { sessionId: SESSION, action })
  assert.equal(reply.status, 200, `面板动作 ${String(action.type)} 应返回 200`)
  assert.equal(reply.body.error, undefined, `面板动作 ${String(action.type)} 不应报错：${String(reply.body.error)}`)
  const data = reply.body.data as { snapshot?: Record<string, unknown>; notices?: string[]; rejected?: unknown } | undefined
  assert.ok(data, 'ActResult 必须包在 data 里')
  return data as Record<string, unknown>
}

async function callTool(h: Harness, toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = h.tools.find((item) => item.name === toolName)
  assert.ok(tool, `工具 ${toolName} 必须已注册`)
  const result = (await tool.execute(args, { sessionId: SESSION })) as Record<string, unknown>
  return result
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolve(true)
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        resolve(false)
      }
    }, 50)
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref()
  })
}

test('apply() 装配：7 工具 / 3 面板接口 / 队长提示词，且主链路 plan→dispatch→receipt→下游 ready 跑通', async () => {
  const home = mkdtempSync(join(tmpdir(), 'auto-team-wire-'))
  const previousHome = process.env.HOME
  // apply() 用 os.homedir() 解析数据根：把 HOME 指到临时目录，测试不污染真实 ~/.dsh/auto-team。
  process.env.HOME = home

  const h = makeHarness()
  try {
    apply(h.ctx as never, { workspace: home })
  } finally {
    process.env.HOME = previousHome
  }

  // ---- ① 注册面：三样东西都必须真的注册上（任一失败会被 try/catch 吞成 warn）
  assert.equal(name, 'auto-team')
  assert.deepEqual(inject, ['tools', 'systemPrompt'])
  assert.deepEqual(
    h.tools.map((tool) => tool.name).sort(),
    [
      `${TOOL_PREFIX}dispatch`,
      `${TOOL_PREFIX}memory`,
      `${TOOL_PREFIX}message`,
      `${TOOL_PREFIX}plan`,
      `${TOOL_PREFIX}receipt`,
      `${TOOL_PREFIX}role`,
      `${TOOL_PREFIX}status`,
    ],
    `必须注册 7 个工具，实际 ${h.tools.length}：${h.tools.map((tool) => tool.name).join(',')}`,
  )
  assert.equal(h.sections.length, 1, '队长提示词只注册一段')
  const sectionText = h.sections[0]?.text() ?? ''
  assert.match(sectionText, /先 plan，再 dispatch/, '提示词必须写死「先 plan 再 dispatch」（AC-30 的软保证）')
  assert.match(sectionText, /完成必须过门禁/, '提示词必须写死「完成必须过门禁」（AC-19 的软保证）')
  assert.match(sectionText, /runId/, '提示词必须说明 dispatch 要带 runId')
  assert.equal(h.routes.length, 1, '宿主 WebRoute 没有 method 字段，四条能力合并成一条 prefix 路由')
  assert.equal(h.routes[0]?.path, '/api/auto-team')
  assert.equal(h.routes[0]?.kind, 'prefix')
  // 两份清理：watcher 的 setInterval + 成员推进事件订阅（T2 的 onMemberProgress）都必须在卸载时停掉。
  assert.equal(h.disposers.length, 2, 'watcher 与进度订阅都必须挂 ctx.effect 清理')

  // 三条面板接口都在（第 4 条未知路径必须是 404，证明分发真的在路由表里查）
  const snapshotReply = await panel(h.routes, 'GET', `/api/auto-team/snapshot?sessionId=${SESSION}`)
  assert.equal(snapshotReply.status, 200)
  assert.equal((snapshotReply.body.data as Record<string, unknown>).enabled, false, '默认关闭（AC-12）')
  const memoryReply = await panel(h.routes, 'GET', '/api/auto-team/memory?track=public&name=team')
  assert.equal(memoryReply.status, 200, 'GET memory 必须存在（修 D7：编辑前先读正文）')
  assert.ok('data' in memoryReply.body || 'error' in memoryReply.body)
  const unknown = await panel(h.routes, 'GET', '/api/auto-team/nope')
  assert.equal(unknown.status, 404)

  // ---- ② 准备一个带模型的角色：供 dispatch 的模型预校验与成员创建使用
  const roles = createRoleRepo({
    dir: join(home, '.dsh/auto-team/roles'),
    skillsDir: join(home, '.dsh/auto-team/skills'),
    now: () => NOW,
  })
  const saved = roles.save({
    id: 'dev',
    name: '开发',
    duty: '写代码',
    skillIds: [],
    model: { provider: 'deepseek', model: 'deepseek-chat' },
    builtin: false,
    updatedAt: NOW,
  })
  assert.equal(saved.ok, true, `角色必须能落盘：${saved.ok ? '' : saved.error}`)

  // ---- ③ 启用（面板路径：POST /act）
  const toggled = await act(h.routes, { type: 'toggle', enabled: true })
  assert.equal((toggled.snapshot as Record<string, unknown>).enabled, true)

  // ---- ④ plan（工具路径）：计划先落地，此时成员数必须还是 0（AC-30）
  const planned = await callTool(h, `${TOOL_PREFIX}plan`, {
    goal: '做一个登录页',
    tasks: [
      { id: 't1', title: '写登录组件', roleId: 'dev', acceptance: 'true' },
      { id: 't2', title: '写登录测试', roleId: 'dev', dependsOn: ['t1'], acceptance: 'true' },
    ],
  })
  assert.equal(planned.ok, true, `plan 必须成功：${JSON.stringify(planned)}`)
  const runId = planned.runId as string
  assert.equal(typeof runId, 'string')
  assert.equal(h.spawned.length, 0, 'plan 阶段不得创建任何成员（反面目标 1）')

  const store = new RunsStore(join(home, '.dsh/auto-team/runs'))
  const plannedState = store.load(runId) as RunState | null
  assert.ok(plannedState)
  assert.equal(plannedState.bindings.length, 0)
  assert.equal(typeof plannedState.plannedAt, 'number')
  assert.deepEqual(
    plannedState.plan.tasks.map((task) => task.status),
    ['pending', 'pending'],
    '计划条目落地时任务都还没开始',
  )

  // ---- ⑤ dispatch（面板路径）：只派发依赖已满足的 t1，名字由任务决定（确定性，AC-17）
  const dispatched = await act(h.routes, { type: 'dispatch', runId })
  assert.ok(dispatched.snapshot, 'dispatch 必须返回快照')
  assert.equal(h.spawned.length, 1, '只有无依赖的 t1 可以被派发')
  // 名字形态是 `<roleId>-<taskId>-<身份哈希>`（R2-1）：不写死具体哈希，改为从本次 spawn 派生，
  // 再与落盘 binding 交叉核对——这样探针/断言不会因为哈希值变化而假红，也不会因为「派生自同一处」而假绿。
  const t1Name = h.spawned[0]?.name ?? ''
  assert.match(t1Name, /^dev-t1-[0-9a-z]{6}$/, '成员名必须是 <roleId>-<taskId>-<身份哈希>（幂等恢复的判据）')

  const afterDispatch = store.load(runId) as RunState
  const t1 = afterDispatch.plan.tasks.find((task) => task.id === 't1')
  const t2 = afterDispatch.plan.tasks.find((task) => task.id === 't2')
  assert.equal(t1?.status, 'running')
  assert.equal(t2?.status, 'pending', '下游任务在依赖完成前不得进入 running')
  assert.equal(afterDispatch.bindings.length, 1)
  assert.equal(afterDispatch.bindings[0]?.name, t1Name, '落盘 binding 的名字必须就是派发时用的那个名字')
  assert.equal(afterDispatch.bindings[0]?.taskId, 't1', '恢复按 taskId 绑定，不解析名字')
  const dispatchMessage = afterDispatch.messages.find((message) => message.taskId === 't1' && message.from === 'captain')
  assert.ok(dispatchMessage, '派发必须落一条直达消息（AC-16 的证据）')
  assert.equal(dispatchMessage?.toMemberId, h.spawned[0]?.id)

  // ---- ⑥ receipt（工具路径）：门禁真跑 shell（`true` → 退出码 0），t1 才能 done（AC-19）
  const receipt = await callTool(h, `${TOOL_PREFIX}receipt`, { taskId: 't1' })
  assert.equal(receipt.ok, true, `receipt 必须成功：${JSON.stringify(receipt)}`)

  const afterReceipt = store.load(runId) as RunState
  const doneT1 = afterReceipt.plan.tasks.find((task) => task.id === 't1')
  assert.equal(doneT1?.status, 'done', '门禁通过后任务才算完成')
  assert.equal(doneT1?.evidence?.exitCode, 0, '门禁证据必须记录退出码')

  // ---- ⑦ 下游 ready：t1 过门禁后，再 dispatch 才应该起 t2 的成员
  const redispatched = await act(h.routes, { type: 'dispatch', runId })
  assert.ok(redispatched.snapshot)
  assert.equal(h.spawned.length, 2, '下游任务在依赖 done 之后必须可以派发')
  const t2Name = h.spawned[1]?.name ?? ''
  assert.match(t2Name, /^dev-t2-[0-9a-z]{6}$/)
  assert.notEqual(t2Name, t1Name, '同角色的两个任务必须拿到不同名字（R2-1 的缺陷不得回归）')
  const afterSecond = store.load(runId) as RunState
  assert.equal(afterSecond.bindings.find((item) => item.taskId === 't2')?.name, t2Name)
  assert.equal(afterSecond.plan.tasks.find((task) => task.id === 't2')?.status, 'running')

  // ---- ⑧ watcher 真的在对账：成员全死掉后，运行中的任务必须被标记为 interrupted
  // （AC-18 的反面目标「面板显示运行中而成员已死」只能由 host 侧轮询发现）。
  //
  // 断言读的是 `store.load()` 的结果（而不是落盘原文）：面板与 resume 走的都是这条读回路径。
  // T9 修掉了 `src/host/store.ts` 里 `TASK_STATUSES` 漏 `'interrupted'` 的缺陷（它会把 watcher
  // 刚写下的 interrupted 归回 'pending'，导致面板显示「待办」、resume 静默跳过，AC-17/AC-18 双双失效）。
  // 这里改成按读回值断言：把该白名单改回旧版，本条必红 —— 判据是可分辨的。
  const statusOf = (taskId: string): string =>
    store.load(runId)?.plan.tasks.find((task) => task.id === taskId)?.status ?? ''
  h.members.splice(0)
  const listCallsBefore = h.memberListCalls()
  const reconciled = await waitFor(() => statusOf('t2') === 'interrupted', 4000)
  assert.ok(reconciled, 'watcher 必须在轮询周期内发现成员死亡并把任务标记为 interrupted（store.load 读回值）')
  assert.ok(h.memberListCalls() > listCallsBefore, 'watcher 的定时器必须真的在跑（注册完还要 tick）')

  // ---- ⑨ agent/created 的实际模型与声明不一致 → drift 审计（AC-22，绝不静默回退）
  assert.equal(h.listeners.length, 1, '必须订阅 agent/created 才能审计实际下发模型')
  const firstId = h.spawned[0]?.id ?? ''
  h.listeners[0]?.({ member: { id: firstId, name: t1Name }, model: { provider: 'other', model: 'other-model' } })
  const afterAudit = store.load(runId) as RunState
  const audit = afterAudit.routeAudits.find((item) => item.taskId === 't1')
  assert.equal(audit?.verdict, 'drift', '声明与实际不一致必须落 drift')
  assert.equal(audit?.actual?.model, 'other-model')
  assert.ok(
    afterAudit.messages.some((message) => message.body.includes('路由漂移')),
    '漂移必须留下可核验的消息记录',
  )

  // ---- ⑩ 卸载：disposer 必须停掉 watcher（再等也不会改变状态），且不抛错
  await h.disposers[0]?.()
  const beforeStop = JSON.stringify(store.load(runId))
  await new Promise((resolve) => setTimeout(resolve, 1200))
  assert.equal(JSON.stringify(store.load(runId)), beforeStop, 'disposer 之后 watcher 不得再改状态')

  assert.deepEqual(h.warnings, [], `装配过程不应有告警：${h.warnings.join(' | ')}`)
})
