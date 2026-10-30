/**
 * ⚠️ 唯一接触宿主 API 的胶水层。
 *
 * 设计意图：把全部可能与宿主实现不一致的调用集中到这**一个**文件，其余模块只依赖
 * 本文件暴露的窄接口。这样宿主的形状变动（或升级）只需要改这一个文件，
 * 而不是散落在 plan/team/gate 里（那些模块已被单测固定住）。
 *
 * 本版形状于 2026-10-30 用 cordis_inspect_query（provider=Service, method=listService）
 * 对 tools / systemPrompt / webServer / agentTeams / llm / agentDefaultModel 逐个实测确认，
 * 证据与原始签名见 ARCHITECTURE.md §7。凡标 [已核] 的字段名都来自那次实测输出，不是猜测。
 */
import type { RejectionCode, Role, RoleModelRoute } from '../shared/types.ts'
import type { HostMember } from './team/watcher.ts'
import type { SpawnInput } from './team/dispatch.ts'
import { normalizeModel } from './roles/repo.ts'
import { BRIDGE_ROUTE, DEFAULT_MAX_CONCURRENT, MAX_CONCURRENT_LIMIT } from './config.ts'

/** 成员名单契约以 watcher 为准（对账逻辑所有），这里只做透传与再导出。 */
export type { HostMember } from './team/watcher.ts'

/** 宿主 ContentBlock 的最小形状（只用到文本块）。 */
export interface HostTextBlock {
  type: 'text'
  text: string
}

/** 宿主 Agent 的最小形状。 */
export interface HostAgent {
  readonly id: string
}

/** 宿主 ctx 的最小子集。故意只声明我们会用到的成员。 */
export interface HostContext {
  /** [已核] `register(definition: ToolDefinition): () => void`。 */
  tools?: { register(definition: unknown): (() => void) | void }
  /** [已核] `section(section: PromptSection): () => void`，PromptSection 用 `text` 字段。 */
  systemPrompt?: { section(section: unknown): (() => void) | void }
  /** [已核] `register(route: WebRoute)`，WebRoute = { kind: 'exact'|'prefix', path, handler(req,res) }。 */
  webServer?: { register(route: unknown): (() => void) | void }
  /** [已核] 当前异步链上的发起 Agent。tools 执行期可用（ctx.agents.currentInitiator）。 */
  agents?: {
    currentInitiator?(): HostAgent | undefined
    requireInitiator?(): HostAgent
  }
  /** [已核] 全部方法第一参是 `caller: Agent`。 */
  agentTeams?: {
    spawnTeammate?(caller: HostAgent, request: unknown): Promise<unknown>
    sendMessage?(caller: HostAgent, request: unknown): Promise<unknown>
    listMembers?(caller: HostAgent): unknown
    interrupt?(caller: HostAgent, targetName: string): unknown
    /** [已核] `tryMembership(agent)` → `{ role, name, root } | undefined`：成员名只从这里取。 */
    tryMembership?(agent: unknown): unknown
    /** [未核] 并发上限字段名有四种可能，resolveConcurrencyLimit 逐个探测，不臆断。 */
    concurrencyLimit?: number
    maxConcurrent?: number
    maxConcurrency?: number
    maxTeammates?: number
  }
  /**
   * [未核] Cordis 的清理注册（ctx.effect(dispose)）。宿主没有它时插件仍要能用，
   * 只是退出时少一次显式清理，因此这里声明为可选、注册失败只 warn。
   */
  effect?(dispose: () => void | Promise<void>): unknown
  /** [已核] `resolveCallConfig(config: LlmCallConfig, signal?)`，入参/返回值同为 { provider, model, ...controls }。 */
  llm?: { resolveCallConfig?(input: unknown, signal?: AbortSignal): Promise<unknown> }
  /** 会话默认模型选择（provider/model）；用作 spawn 的 provider 兜底。 */
  agentDefaultModel?: { currentSelection?(): unknown }
  logger?: { warn?: (message: string) => void; info?: (message: string) => void }
  /** Cordis 事件订阅形态（ctx.on(event, listener)）；事件名/payload 尚未实测，仅用于兜底。 */
  on?: (event: string, listener: (...args: unknown[]) => void) => (() => void) | void
}

export interface ToolSpec {
  name: string
  description: string
  /** 参数 schema（JSON Schema 子集）。 */
  parameters: Record<string, unknown>
  /** 结果 schema；缺省 `{ type: 'object' }`。宿主用它给模型描述返回值。 */
  outputSchema?: Record<string, unknown>
  handler: (args: Record<string, unknown>, meta?: unknown) => Promise<unknown>
}

/**
 * [已核] ToolDefinition = ToolSchema & { output: ToolOutputDefinition, execute(args, exec) }
 *   ToolSchema        = { name, description, parameters }
 *   ToolOutputDefinition = { schema: JsonSchemaNode, render(args, value): ContentBlock[] }
 * 缺 `output` 会让宿主在 register 或首次调用时报错，因此这里必须补齐。
 */
export function toHostToolDefinition(spec: ToolSpec): unknown {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: spec.outputSchema ?? { type: 'object' },
      render: (_args: unknown, value: unknown): HostTextBlock[] => [
        { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null) },
      ],
    },
    execute: spec.handler,
  }
}

/** 注册一个工具；宿主缺 tools 服务时静默跳过并 warn（不得抛错，AC-9）。 */
export function registerTool(ctx: HostContext, spec: ToolSpec): boolean {
  const sink = ctx.tools
  if (!sink?.register) {
    ctx.logger?.warn?.(`[auto-team] 宿主未提供 tools 服务，跳过工具注册：${spec.name}`)
    return false
  }
  try {
    sink.register(toHostToolDefinition(spec))
    return true
  } catch (error) {
    // 单条工具注册失败不能拖垮其它工具（装配层每段独立 try/catch，这里给出可读原因）。
    ctx.logger?.warn?.(`[auto-team] 工具注册失败：${spec.name}（${messageOf(error)}）`)
    return false
  }
}

/** [已核] PromptSection 用 `text`（string | (context) => string），不是 render/content。 */
export function registerPromptSection(
  ctx: HostContext,
  section: { name: string; order: number; content: string | (() => string) },
): boolean {
  const sink = ctx.systemPrompt
  if (!sink?.section) {
    ctx.logger?.warn?.('[auto-team] 宿主未提供 systemPrompt 服务，跳过队长段落注入')
    return false
  }
  try {
    sink.section({
      name: section.name,
      order: section.order,
      text: () => (typeof section.content === 'function' ? section.content() : section.content),
    })
    return true
  } catch (error) {
    ctx.logger?.warn?.(`[auto-team] 队长提示词段落注入失败（${messageOf(error)}）`)
    return false
  }
}

/**
 * 面板 HTTP 桥的「内部」路由。
 *
 * 注意宿主侧只有 `WebRoute { kind, path, handler(req, res) }`：**没有 method 字段**，
 * 也不做 JSON 归一。所以这里保留 (method, path) 作为我们自己的分发信息，
 * 注册时合并成一条 `kind: 'prefix'` 路由，由 normalize 层按 req.method + req.url 分发。
 */
export interface HttpRoute {
  method: 'GET' | 'POST'
  path: string
  handle: (request: { method: string; pathname: string; url: string; json: () => Promise<unknown> }) => Promise<unknown>
}

/** 宿主 Node 风格 req/res 的最小形状（不 import node:http 类型，保持本文件零依赖）。 */
interface NodeLikeRequest {
  method?: string
  url?: string
  on(event: 'data', listener: (chunk: unknown) => void): unknown
  on(event: 'end', listener: () => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}
interface NodeLikeResponse {
  statusCode?: number
  setHeader(name: string, value: string): unknown
  end(chunk?: string): unknown
}

/**
 * 把全部内部路由挂到宿主：单条 prefix 路由 + 自己写 res。
 * 任一路由抛错都必须转成 500 JSON，绝不能把异常抛回宿主 HTTP 栈。
 */
export function registerHttpRoutes(
  ctx: HostContext,
  routes: HttpRoute[],
  prefix: string = BRIDGE_ROUTE,
): boolean {
  const sink = ctx.webServer
  if (!sink?.register) {
    ctx.logger?.warn?.('[auto-team] 宿主未提供 webServer 服务，面板将只能看到空快照')
    return false
  }
  try {
    sink.register({
      kind: 'prefix',
      path: prefix,
      handler: async (req: NodeLikeRequest, res: NodeLikeResponse) => {
        const url = typeof req.url === 'string' ? req.url : ''
        const pathname = url.includes('?') ? url.slice(0, url.indexOf('?')) : url
        const method = (req.method ?? 'GET').toUpperCase()
        const route = routes.find((item) => item.method === method && item.path === pathname)

        const reply = (status: number, payload: unknown): void => {
          res.statusCode = status
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(payload))
        }

        if (!route) {
          reply(404, { error: `未知面板接口：${method} ${pathname}` })
          return
        }
        try {
          const body = await readJson(req)
          const result = await route.handle({ method, pathname, url, json: async () => body })
          reply(200, result ?? {})
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger?.warn?.(`[auto-team] 面板接口失败：${method} ${pathname} → ${message}`)
          reply(500, { error: message })
        }
      },
    })
    return true
  } catch (error) {
    ctx.logger?.warn?.(`[auto-team] 面板路由注册失败（${messageOf(error)}）`)
    return false
  }
}

/** 读请求体并解析 JSON；空体返回 undefined（GET 场景）。 */
function readJson(req: NodeLikeRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: unknown[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('error', reject)
    req.on('end', () => {
      const text = chunks
        .map((chunk) => (typeof chunk === 'string' ? chunk : String(chunk)))
        .join('')
      if (text.trim() === '') return resolve(undefined)
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${error instanceof Error ? error.message : String(error)}`))
      }
    })
  })
}

/**
 * [已核] agentTeams 的 caller 参数：必须是「当前活跃 Agent」。工具在 Agent 的异步链里执行，
 * 因此 ctx.agents.currentInitiator() 就是队长本身。拿不到时不给假 agent（宿主会拒绝或越权）。
 */
export function resolveCaller(ctx: HostContext): HostAgent | undefined {
  try {
    const initiator = ctx.agents?.currentInitiator?.()
    if (initiator && typeof initiator.id === 'string') return initiator
  } catch {
    /* 某些宿主上下文里 currentInitiator 会抛，视为不可用 */
  }
  try {
    const required = ctx.agents?.requireInitiator?.()
    if (required && typeof required.id === 'string') return required
  } catch {
    /* 同上 */
  }
  return undefined
}

const NO_CALLER = '当前没有活跃的队长会话：agentTeams 需要以 Agent 身份调用，请在会话内使用本工具。'

export interface SpawnPorts {
  spawn: (input: {
    prompt: string
    name: string
    description?: string
    route?: RoleModelRoute
    sessionId: string
    taskId: string
  }) => Promise<
    | {
        ok: true
        memberId: string
        /**
         * 该成员创建时宿主**实际**用上的路由（`agent/created` 观测值）。
         * `undefined` = 没观测到事件；`null` = 事件到了但拿不到实际值。审计据此判 ok/unverified。
         */
        actual?: RoleModelRoute | null
      }
    | { ok: false; error: string }
  >
  sendMessage: (memberId: string, text: string) => Promise<{ ok: boolean; error?: string }>
}

/**
 * [已核] SpawnTeammateRequest = { name, description, prompt: ContentBlock[], context: 'fresh'|'fork', provider, signal }
 *   SpawnTeammateResult  = { member: TeamMemberView }，member.id + member.name 是我们要的两件事。
 *
 * 逐角色模型（AC-22）怎么才真的生效：宿主 rc.2 的 `spawnAdmitted()` 只把 `request.provider`
 * 交给 `subagents.startActivation({ provider })`，**请求里没有 model/effort 的下发通道**
 * （实测宿主源码 spawnAdmitted → startActivation 只读 provider）。官方扩展点是「创建事务内
 * serial、awaited 的 `agent/created`」：在该事件里往 `agent.ctx` 装一套 member-scoped 路由
 * （同机生产实现 dsh-agent-team-presets 的 installModelSelection 就是这么做的）。
 * 因此这里请求里仍附带 model/reasoningEffort（宿主忽略、仅作观测与前向兼容），
 * 真正生效靠 {@link installMemberRoute}。
 */
export interface SpawnRouteFields {
  model?: string
  reasoningEffort?: RoleModelRoute['reasoningEffort']
}

/** 把角色声明的路由摊成请求字段（宿主忽略未知字段，探针/日志可核）。 */
export function spawnRouteFields(route: RoleModelRoute | undefined): SpawnRouteFields {
  if (!route) return {}
  return {
    model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
  }
}

/**
 * 待装路由表：**成员名 → 角色声明路由**。
 *
 * 为什么必须是预先登记而不是查 binding：`agent/created` 在 `spawnTeammate()` 内部触发
 * （宿主流程 = 「await serial agent/created 监听 → 才放行成员首个请求」），此刻 dispatch
 * 还没拿到 memberId、也没落盘 binding，用 binding 反查永远查不到。
 * 键用**我们请求的成员名**：宿主 `memberName()` 校验后原样返回（lower-kebab、≤64），名不漂。
 */
const pendingRoutes = new Map<string, RoleModelRoute>()

export function trackPendingRoute(name: string, route: RoleModelRoute | undefined): void {
  if (route === undefined) return
  pendingRoutes.set(name, route)
}

export function settlePendingRoute(name: string): void {
  pendingRoutes.delete(name)
}

/** 按候选名（宿主回报名 / 请求名 / agent id）取走待装路由，取到即删。 */
export function takePendingRoute(names: readonly string[]): RoleModelRoute | undefined {
  for (const name of names) {
    const route = pendingRoutes.get(name)
    if (route !== undefined) {
      pendingRoutes.delete(name)
      return route
    }
  }
  return undefined
}

/**
 * 待回填的**实际路由**表：成员名 → `agent/created` 观测到的实际路由（`null` = 事件来了但拿不到值）。
 *
 * 与 {@link pendingRoutes} 同源同因：事件在 `spawnTeammate()` 内部触发，那一刻 dispatch 还没
 * 落盘 binding，所以审计不能在事件里查 binding，只能在这里先存下「宿主实际用了什么模型」，
 * 等 spawn 返回、binding 落盘后由编排层（`dispatch.ts` 步 f）取走写进 `routeAudits`（AC-22）。
 * 取走即删；`spawn` 开始前也先清一次，避免上一次同任务的旧观测被后来的 spawn 误认。
 */
const pendingActuals = new Map<string, RoleModelRoute | null>()

/** 待回填表的容量上限：残留项（事件先到、没人在等）不能无限涨。 */
const PENDING_ACTUAL_LIMIT = 100

export function trackPendingActual(names: readonly string[], actual: RoleModelRoute | null): void {
  for (const name of names) {
    if (typeof name !== 'string' || name === '') continue
    pendingActuals.set(name, actual)
  }
  while (pendingActuals.size > PENDING_ACTUAL_LIMIT) {
    const oldest = pendingActuals.keys().next()
    if (oldest.done === true) break
    pendingActuals.delete(oldest.value)
  }
}

export function settlePendingActual(names: readonly string[]): void {
  for (const name of names) pendingActuals.delete(name)
}

/**
 * 按候选名取走实际路由，取到即删。
 * 返回 `undefined` = 压根没观测到（宿主没发 `agent/created`），`null` = 观测到但拿不到实际值；
 * 两者在审计里都落 `unverified`，但语义不同，不要让调用方把它们混成一个值。
 */
export function takePendingActual(names: readonly string[]): RoleModelRoute | null | undefined {
  for (const name of names) {
    if (!pendingActuals.has(name)) continue
    const actual = pendingActuals.get(name) ?? null
    pendingActuals.delete(name)
    return actual
  }
  return undefined
}
export function createSpawnPorts(ctx: HostContext, signal?: AbortSignal): SpawnPorts {
  const teams = ctx.agentTeams
  /** memberId → 成员名：宿主 sendMessage 的 target 是**名字**，不是 id。 */
  const names = new Map<string, string>()

  function fallbackProvider(): string {
    try {
      const selection = ctx.agentDefaultModel?.currentSelection?.() as { provider?: unknown } | undefined
      if (typeof selection?.provider === 'string' && selection.provider !== '') return selection.provider
    } catch {
      /* 读不到就用空串，由宿主给出明确报错 */
    }
    return ''
  }

  function refreshNames(caller: HostAgent): void {
    try {
      const rows = teams?.listMembers?.(caller)
      if (!Array.isArray(rows)) return
      for (const row of rows as Array<{ id?: unknown; name?: unknown }>) {
        if (typeof row?.id === 'string' && typeof row?.name === 'string') names.set(row.id, row.name)
      }
    } catch {
      /* 名单刷新失败不影响本次发送，退回 memberId 直传 */
    }
  }

  return {
    async spawn(input) {
      if (!teams?.spawnTeammate) {
        return { ok: false, error: '宿主未提供 agentTeams.spawnTeammate，无法创建成员（请确认 auto-teams 能力已启用）' }
      }
      const caller = resolveCaller(ctx)
      if (!caller) return { ok: false, error: NO_CALLER }
      const provider = input.route?.provider ?? fallbackProvider()
      if (provider === '') {
        return { ok: false, error: '无法确定成员的 provider：角色未声明模型且宿主未提供默认模型选择' }
      }
      // 必须先登记再 spawn：agent/created 在 spawnTeammate 内部同步触发（见 pendingRoutes 说明）。
      trackPendingRoute(input.name, input.route)
      // 同上：清掉可能残留的旧观测，保证 take 到的只可能是**本次**创建观测到的路由。
      settlePendingActual([input.name])
      try {
        const created = (await teams.spawnTeammate(caller, {
          name: input.name,
          description: input.description ?? `任务 ${input.taskId}`,
          prompt: [{ type: 'text', text: input.prompt }] satisfies HostTextBlock[],
          context: 'fresh',
          provider,
          // 角色声明的模型：宿主当前忽略这两项（实际下发靠 agent/created 装路由），
          // 但探针/日志与未来宿主版本要能看见「队长要求的是哪个模型」。
          ...spawnRouteFields(input.route),
          signal: signal ?? new AbortController().signal,
        })) as { member?: { id?: unknown; name?: unknown } } | undefined
        const member = created?.member
        if (typeof member?.id !== 'string' || member.id === '') {
          return { ok: false, error: 'spawnTeammate 未返回 member.id：宿主返回值形状与预期不符' }
        }
        if (typeof member.name === 'string') names.set(member.id, member.name)
        // 事件在 spawnTeammate 内部就触发完了，此刻观测值已经在表里；取到即删。
        const actual = takePendingActual([input.name, member.id, typeof member.name === 'string' ? member.name : ''])
        return { ok: true, memberId: member.id, ...(actual === undefined ? {} : { actual }) }
      } catch (error) {
        return { ok: false, error: `创建成员失败：${error instanceof Error ? error.message : String(error)}` }
      } finally {
        // 装路由是「取走即删」，这里只清理没被取走的（失败/宿主未触发 agent/created）。
        settlePendingRoute(input.name)
        settlePendingActual([input.name])
      }
    },

    async sendMessage(memberId, text) {
      if (!teams?.sendMessage) return { ok: false, error: '宿主未提供 agentTeams.sendMessage' }
      const caller = resolveCaller(ctx)
      if (!caller) return { ok: false, error: NO_CALLER }
      if (!names.has(memberId)) refreshNames(caller)
      const target = names.get(memberId) ?? memberId
      try {
        await teams.sendMessage(caller, {
          target,
          content: [{ type: 'text', text }] satisfies HostTextBlock[],
          signal: signal ?? new AbortController().signal,
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, error: `直达消息失败：${error instanceof Error ? error.message : String(error)}` }
      }
    },
  }
}

export interface RoutePorts {
  /**
   * 声明路由 → 实际可下发路由；`null` 表示宿主解析不出来。
   * 与 §5.5 一致：**不返回 bool + error**，因为调用方（preflightRoutes）只关心
   * 「能不能解析出这条路由」，文案由 route.ts 统一生成，避免两处措辞漂移。
   */
  resolveRoute: (route: RoleModelRoute) => Promise<RoleModelRoute | null>
}

/**
 * [已核] llm.resolveCallConfig(config: LlmCallConfig, signal?) → LlmCallConfig
 *
 * 三个分支的语义（AC-22 的诚实口径，L1 限制）：
 *  - 宿主没有 resolver：返回声明值（放行 + warn）——宁可派出去再失败，也不静默把用户配置判死；
 *  - resolver 返回 null/undefined：`null` = 解析不出来，调用方据此拒绝派发并给出 MODEL_UNRESOLVABLE；
 *  - resolver 抛错：同样 `null`。
 * 注意：宿主 `SpawnTeammateRequest` 只有 provider、没有 model，所以这里只做**可用性预校验**；
 * 真正下发在 `agent/created` 里装 member-scoped 路由（见 installMemberRoute），
 * 实际路由再经 auditRoute 核对（见 registerAgentCreated）。
 */
export function createRoutePorts(ctx: HostContext): RoutePorts {
  return {
    async resolveRoute(route) {
      const resolver = ctx.llm?.resolveCallConfig
      if (!resolver) {
        ctx.logger?.warn?.('[auto-team] 宿主未提供 llm.resolveCallConfig，跳过模型路由预校验')
        return route
      }
      try {
        const resolved = await resolver({ provider: route.provider, model: route.model })
        if (resolved === undefined || resolved === null) return null
        return route
      } catch (error) {
        ctx.logger?.warn?.(`[auto-team] 模型路由解析失败：${route.provider}/${route.model}（${messageOf(error)}）`)
        return null
      }
    },
  }
}

/**
 * 事件订阅兜底：把成员实际模型路由回填到面板。
 * 注意：`agent/created` 的**事件名与 payload 尚未实测**（cordis_inspect 只列 Service，
 * 不列事件契约）。因此这里注册但不解析 payload，任何字段猜测都只会把错值写进面板；
 * 面板的实际路由按「角色声明值」展示，并在 UI 标注来源，见 ARCHITECTURE §7 已知限制。
 */
export function onAgentCreated(ctx: HostContext, handler: (payload: unknown) => void): void {
  if (!ctx.on) {
    ctx.logger?.warn?.('[auto-team] 宿主未提供事件订阅，成员实际模型路由将退回声明值')
    return
  }
  ctx.on('agent/created', handler)
}

/** 角色路由 → 展示用 route（避免上层直接摸 Role.model）。 */
export function routeOf(role: Role): RoleModelRoute | undefined {
  return role.model
}

/* ------------------------------------------------------------------ *
 * T3 增量：成员名单 / 并发上限 / effect / agent-created / spawn 薄封装
 * 全部形状知识只允许出现在这个文件里（AGENTS §4 铁律）。
 * ------------------------------------------------------------------ */

/** 带 code 的宿主侧错误：调用方（watcher/dispatch）靠 code 区分「拿不到」与「真死」。 */
export interface HostError extends Error {
  code?: RejectionCode
}

function hostError(message: string, code: RejectionCode): HostError {
  const error = new Error(message) as HostError
  error.code = code
  return error
}

/**
 * 成员名单：`agentTeams.listMembers(caller)`，返回宿主行。
 * 拿不到名单时 **抛错**（而不是返回空数组）——空数组在 watcher 眼里等于「成员全死了」，
 * 会把所有任务误标 interrupted；抛错则本轮跳过，宁可漏报一轮也不误杀。
 */
export async function listHostMembers(ctx: HostContext): Promise<HostMember[]> {
  const teams = ctx.agentTeams
  if (!teams?.listMembers) {
    throw hostError('宿主未提供 agentTeams.listMembers：无法核对成员存活状态。', 'NOT_FOUND')
  }
  const caller = resolveCaller(ctx)
  if (!caller) throw hostError(NO_CALLER, 'NO_CALLER')
  const rows = await teams.listMembers(caller)
  return normalizeMemberRows(rows)
}

/** 宿主返回可能是数组、也可能是 `{ members: [...] }`；两种都吃，其余一律当空。 */
export function normalizeMemberRows(rows: unknown): HostMember[] {
  const list = Array.isArray(rows)
    ? rows
    : rows && typeof rows === 'object' && Array.isArray((rows as { members?: unknown }).members)
      ? ((rows as { members: unknown[] }).members)
      : []
  const members: HostMember[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as { id?: unknown; name?: unknown; status?: unknown; memberId?: unknown }
    const id = typeof row.id === 'string' ? row.id : typeof row.memberId === 'string' ? row.memberId : ''
    const name = typeof row.name === 'string' ? row.name : ''
    if (!id && !name) continue
    members.push({ id, name, status: typeof row.status === 'string' ? row.status : '' })
  }
  return members
}

/**
 * 宿主并发上限：字段名有四种可能（契约未实测），逐个探测；都没有就回落到
 * DEFAULT_MAX_CONCURRENT(3)，并把 source 标成 'default' 让面板如实显示来源。
 */
export function resolveConcurrencyLimit(ctx: HostContext): { limit: number; source: 'host' | 'default' } {
  const teams = ctx.agentTeams as Record<string, unknown> | undefined
  const keys = ['concurrencyLimit', 'maxConcurrent', 'maxConcurrency', 'maxTeammates'] as const
  for (const key of keys) {
    const value = teams?.[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return { limit: Math.min(Math.floor(value), MAX_CONCURRENT_LIMIT), source: 'host' }
    }
  }
  return { limit: DEFAULT_MAX_CONCURRENT, source: 'default' }
}

/**
 * 注册清理回调（Cordis `ctx.effect(dispose)`）。宿主没有该能力时返回 false：
 * 插件仍可用，只是退出时少一次显式清理（watcher/定时器靠 unref 也不会拽住进程）。
 */
export function registerEffect(ctx: HostContext, dispose: () => void | Promise<void>): boolean {
  if (typeof ctx.effect !== 'function') {
    ctx.logger?.warn?.('[auto-team] 宿主未提供 effect 注册，退出时不会显式停止成员轮询')
    return false
  }
  try {
    ctx.effect(dispose)
    return true
  } catch (error) {
    ctx.logger?.warn?.(`[auto-team] effect 注册失败（${messageOf(error)}）`)
    return false
  }
}

/** agent.ctx 的最小形状：只用到事件订阅（与宿主 installModelSelection 注册的是同一批事件）。 */
interface AgentEventContext {
  on(event: string, listener: (...args: unknown[]) => unknown): (() => void) | void
}

export function agentContextOf(agent: unknown): AgentEventContext | null {
  const ctx = (agent as { ctx?: unknown } | null | undefined)?.ctx
  if (!ctx || typeof ctx !== 'object') return null
  const candidate = ctx as Partial<AgentEventContext>
  return typeof candidate.on === 'function' ? (candidate as AgentEventContext) : null
}

/**
 * 把角色声明的模型路由装到**该成员自己的** `agent.ctx` 上（AC-22 的真正下发点）。
 *
 * 语义对齐宿主 `installModelSelection(agentCtx, { current, assembled })`，但不 import
 * `@deepseek-ai/dsh-agent`（本包运行时零 @deepseek-ai 依赖，见交付契约第 6 条），只走公开事件：
 *  - `system-prompt/assemble`：记录本轮实际生效的路由（宿主在同一事件里也这么做）；
 *  - `agent/request`：把已解析的调用配置改写成声明路由，并**剔除继承来的 reasoningEffort**
 *    （不清掉的话队长的高/低 effort 会漏给成员，宿主实现同样先剔继承值）。
 * 注册挂在 `agent.ctx` 上，Agent 释放时由宿主一并回收；返回 disposer 只给单测用。
 * 宿主 ctx 形状不认识时返回 null（调用方据此落 unverified，不假装生效）。
 */
export function installMemberRoute(agent: unknown, route: RoleModelRoute): (() => void) | null {
  const agentCtx = agentContextOf(agent)
  if (agentCtx === null) return null
  const on = agentCtx.on.bind(agentCtx)
  const selection: { current: RoleModelRoute; assembled?: RoleModelRoute } = { current: route }
  const disposers: Array<(() => void) | void> = []
  try {
    disposers.push(
      on('system-prompt/assemble', async (...args: unknown[]) => {
        const next = args[args.length - 1]
        const assembled = typeof next === 'function' ? await (next as () => Promise<unknown>)() : undefined
        selection.assembled = selection.current
        return assembled
      }),
    )
    disposers.push(
      on('agent/request', async (...args: unknown[]) => {
        const next = args[args.length - 1]
        const resolved = typeof next === 'function' ? await (next as () => Promise<unknown>)() : undefined
        if (!resolved || typeof resolved !== 'object') return resolved
        const selected = selection.assembled ?? selection.current
        const rest: Record<string, unknown> = { ...(resolved as Record<string, unknown>) }
        delete rest.reasoningEffort
        return {
          ...rest,
          provider: selected.provider,
          model: selected.model,
          ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
        }
      }),
    )
  } catch (error) {
    for (const dispose of disposers) {
      try {
        dispose?.()
      } catch {
        /* 回滚失败不改变「装不上」的结论 */
      }
    }
    return null
  }
  return () => {
    for (const dispose of disposers) {
      try {
        dispose?.()
      } catch {
        /* 已释放 */
      }
    }
  }
}

/** 成员身份：名字只认宿主 `agentTeams.tryMembership`（消息/对账都按名字），拿不到再退回 agent 自身字段。 */
export function memberIdentityOf(ctx: HostContext, agent: unknown): { id: string; name: string } {
  let id = ''
  let name = ''
  try {
    const membership = ctx.agentTeams?.tryMembership?.(agent) as { id?: unknown; name?: unknown } | undefined
    if (membership && typeof membership === 'object') {
      if (typeof membership.id === 'string') id = membership.id
      if (typeof membership.name === 'string') name = membership.name
    }
  } catch {
    /* 非 Team 子 agent 会返回 undefined；抛错同样视为拿不到 */
  }
  const own = agent as { id?: unknown; name?: unknown } | null | undefined
  if (id === '' && typeof own?.id === 'string') id = own.id
  if (name === '' && typeof own?.name === 'string') name = own.name
  return { id, name }
}

/** `agent/created` 交给我们做审计的内容（形状与宿主 payload 解耦，见 parseAgentCreated）。 */
export interface AgentCreatedEvent {
  member: { id: string; name: string }
  /** 宿主自报的实际路由；缺失即「拿不到实际值」，审计落 unverified（绝不退回声明值假装生效）。 */
  model?: RoleModelRoute
  /** 已在该成员 `agent.ctx` 上装好声明路由 ⇒ 实际路由确定等于声明值。 */
  installed?: RoleModelRoute
}

/**
 * `agent/created` 订阅：**装 member-scoped 模型路由**（AC-22 真正生效的地方）+ 拿实际路由做漂移审计。
 *
 * 两步顺序不能反：先在事件内装路由（宿主 await 本监听结束后才放行成员首个请求），
 * 装成功就记 `installed`；装不上（宿主 ctx 形状不认识）才退回宿主自报的 `model`。
 */
export function registerAgentCreated(
  ctx: HostContext,
  handler: (payload: AgentCreatedEvent) => void,
): boolean {
  if (!ctx.on) {
    ctx.logger?.warn?.('[auto-team] 宿主未提供事件订阅，成员将按 provider 默认模型运行')
    return false
  }
  try {
    ctx.on('agent/created', (payload: unknown) => {
      const parsed = parseAgentCreated(payload)
      if (!parsed) return
      try {
        let identity = parsed.member
        let installed: RoleModelRoute | undefined
        if (parsed.agent !== undefined) {
          const resolved = memberIdentityOf(ctx, parsed.agent)
          if (resolved.id !== '') identity = { ...identity, id: resolved.id }
          if (resolved.name !== '') identity = { ...identity, name: resolved.name }
          const route = takePendingRoute([identity.name, parsed.member.name, identity.id, parsed.member.id])
          if (route !== undefined && installMemberRoute(parsed.agent, route) !== null) installed = route
        }
        const actual = installed ?? parsed.model ?? null
        // 先登记「宿主实际用了什么模型」：此刻 dispatch 还没拿到 member、binding 也没落盘，
        // 审计只能等 spawn 返回后由编制层补（见 pendingActuals 说明 / AC-22）。
        trackPendingActual([identity.name, identity.id, parsed.member.name, parsed.member.id], actual)
        handler({
          member: identity,
          ...(parsed.model === undefined ? {} : { model: parsed.model }),
          ...(installed === undefined ? {} : { installed }),
        })
      } catch (error) {
        ctx.logger?.warn?.(`[auto-team] agent/created 处理失败（${messageOf(error)}）`)
      }
    })
    return true
  } catch (error) {
    ctx.logger?.warn?.(`[auto-team] agent/created 订阅失败（${messageOf(error)}）`)
    return false
  }
}

/**
 * 解析 `agent/created` payload；认不出的形状返回 null（宁可不审计，也不写错值）。
 * 真实形状 `{ agent, source, signal? }`；也接受 `{ member: { id, name }, model }` 这类上报形状。
 */
export function parseAgentCreated(
  payload: unknown,
): { member: { id: string; name: string }; model?: RoleModelRoute; agent?: unknown } | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const memberRaw = (root.member ?? root.agent ?? root) as Record<string, unknown> | undefined
  if (!memberRaw || typeof memberRaw !== 'object') return null
  const id = typeof memberRaw.id === 'string' ? memberRaw.id : ''
  const name = typeof memberRaw.name === 'string' ? memberRaw.name : ''
  if (!id && !name) return null
  const model = normalizeModel(root.model ?? memberRaw.model ?? root.route)
  const agent = root.agent
  return {
    member: { id, name },
    ...(model ? { model } : {}),
    ...(agent === undefined ? {} : { agent }),
  }
}

/**
 * 派一个成员（dispatch/resume 用的薄封装）。
 * 与 createSpawnPorts 共用同一份实现：provider 取角色声明、缺省回落会话默认。
 */
export async function spawnMember(
  ctx: HostContext,
  input: SpawnInput,
  signal?: AbortSignal,
): Promise<{ ok: true; memberId: string; name: string } | { ok: false; error: string }> {
  const ports = createSpawnPorts(ctx, signal)
  const result = await ports.spawn({
    name: input.name,
    description: input.task.title,
    prompt: input.prompt,
    route: input.role?.model,
    sessionId: input.plan.sessionId,
    taskId: input.task.id,
  })
  if (!result.ok) return { ok: false, error: result.error }
  // 名字以我们声明的为准：宿主是「按名字」续聊/对账的，名字漂了就恢复不了（AC-17 判据）。
  return { ok: true, memberId: result.memberId, name: input.name }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
