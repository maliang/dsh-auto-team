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
 *
 * ── 服务访问纪律（r6 T1，铁律，改前先读）────────────────────────────────────
 * 1. 硬依赖（tools / systemPrompt / agents / agentTeams）只能通过 `ctx.<service>` 裸读，
 *    且该服务名**必须**同时出现在 `src/host/index.ts` 的 `inject` 字面清单里。cordis 的
 *    `inject` 语义是「数组 = 全部 required」：漏声明的后果不是功能降级，而是整条 entry
 *    不激活（`dsh: warning: 1 entry did not activate` + `cannot get property "x" without inject`）。
 * 2. 可选服务（名单见下面的 `OPTIONAL_SERVICES`）**只允许**经 `optionalService(ctx, name)`
 *    走 `ctx.get` 读取。任何模块（包括本文件）都不许再写 `ctx.webServer` / `ctx.llm` /
 *    `ctx.agentDefaultModel` 直读，也不许自己调 `ctx.get('<服务名>')` —— 单一登记处原则。
 * 3. 宿主不提供可选服务（或 ctx 没有 `get`）时**降级为 undefined + warn，绝不回退裸读**：
 *    回退就等于把 r6 之前的「真机不激活」缺陷重新种回来（mock 全绿、真机全灭）。
 */
import type { RejectionCode, Role, RoleModelRoute, TokenTotals } from '../shared/types.ts'
import type { ModelCatalogRaw } from './model-catalog.ts'
import type { HostMember } from './team/watcher.ts'
import type { GuardVerdict } from './team/guard.ts'
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

/** `subagents.startActivation()` 的返回值（只声明本插件用到的字段；形状由宿主 0.2.2-rc.2 契约给定）。 */
export interface HostSubagentActivation {
  /** 子会话 id（= 我们记的 memberId；续聊/直发/中断都用它，不再经名字表）。 */
  childId: string
  /** 宿主 catalog 里登记的名字（可能缺失；缺失就不往名字表里补）。 */
  name?: string
  /**
   * 成员的完成结果。**绝不 await**：成员要跑很久，派发必须立刻返回；
   * 但**必须**挂一个 `.catch(() => {})`，否则失败结果会变成未处理 rejection 打崩宿主日志。
   */
  result?: Promise<unknown>
  dispose?(): Promise<void>
}

/**
 * [已核，宿主 0.2.2-rc.2] `subagents` 服务里成员相关的方法。
 *
 * 旧宿主的 `agentTeams.spawnTeammate / sendMessage / listMembers / tryMembership / interrupt`
 * **已全部移除**（宿主注释原文：teammates are subagents, so subagent limits and inbox delivery apply），
 * 成员能力整体搬到这里。`agentTeams` 只剩 isEnabled/setEnabled/createTask/getTask/listTasks/updateTask，
 * 因此本文件对它的成员方法只做**旧宿主兼容回退**（逐个 typeof 判断，不再假设存在）。
 *
 * 调用都可能抛 `SubagentError`，调用点一律 try/catch 转成人话（见 `spawnFailureText` / `hostError`）。
 */
export interface HostSubagents {
  /** 已注册的 subagent provider 名（本机 `spawn`）。旧读口，保留作兼容。 */
  list?(): unknown
  /** 按名字取已注册 provider；新宿主用它确认 `spawn` 是否可用。 */
  getProvider?(name: string): unknown
  /** 创建成员（`provider` 是 subagent provider 名，LLM 路由走 `agentOptions`）。 */
  startActivation?(spec: {
    provider: string
    label: string
    name?: string
    prompt: HostTextBlock[]
    parent: HostAgent
    signal: AbortSignal
    delivery: 'parent' | 'caller'
    agentOptions?: Record<string, unknown>
  }): Promise<HostSubagentActivation | undefined | null>
  /** 给指定子会话直发消息（target 是 SessionId，不是名字）。 */
  sendMessage?(
    sender: unknown,
    targetId: string,
    content: HostTextBlock[],
    options: { signal: AbortSignal },
  ): Promise<unknown>
  /** 中断指定子会话；`authority` 声明调用者是祖先 agent（队长）。 */
  interrupt?(targetSessionId: string, authority: unknown): unknown
  /** 'lead' / 名字路径 / 或原样当 session id 返回。 */
  resolveName?(caller: unknown, name: string, signal: AbortSignal): Promise<unknown>
  /** 模型可见名：从 root 起的斜杠路径（root 是 'lead'）。 */
  namesOf?(agent: unknown): { name?: unknown; creator?: unknown } | undefined
  rootOf?(caller: unknown): unknown
  /** 成员名单：`child` 行 + `diagnostic` 行（后者表示该分支读不出来的原因）。 */
  listDescendants?(rootSessionId: string, signal?: AbortSignal): Promise<unknown>
}

/** 宿主 ctx 的最小子集。故意只声明我们会用到的成员。 */
export interface HostContext {
  /** [已核] `register(definition: ToolDefinition): () => void`。 */
  tools?: { register(definition: unknown): (() => void) | void }
  /** [已核] `section(section: PromptSection): () => void`，PromptSection 用 `text` 字段。 */
  systemPrompt?: { section(section: unknown): (() => void) | void }
  /** [已核] `register(route: WebRoute)`，WebRoute = { kind: 'exact'|'prefix', path, handler(req,res) }。 */
  /** 可选服务（纪律 §2）：只许经 optionalService(ctx, 'webServer') 读取，不要裸读本字段。 */
  webServer?: { register(route: unknown): (() => void) | void }
  /** [已核] 当前异步链上的发起 Agent。tools 执行期可用（ctx.agents.currentInitiator）。 */
  agents?: {
    currentInitiator?(): HostAgent | undefined
    requireInitiator?(): HostAgent
    /**
     * [已核] 按会话 id 取 Agent（同宿主 `dsh-plugin-teamflow` 的 `runtime.agents.get(sid)` 用法）。
     *
     * 门禁必须跑在**会话工作区**而不是宿主进程的启动目录：`apply()` 在进程启动时只执行一次，
     * 那时拿不到「用户打开了哪个仓库」；真正的事实挂在 `agent.session.header.cwd` 上，
     * 所以在每次跑门禁时用 sessionId 现取。取不到由调用方回退（不是错误）。
     */
    get?(sessionId: string): unknown
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
  /** 可选服务（纪律 §2）：只许经 optionalService(ctx, 'llm') 读取，不要裸读本字段。 */
  llm?: {
    resolveCallConfig?(input: unknown, signal?: AbortSignal): Promise<unknown>
    /**
     * [未核] r10 AC-16：模型清单的两个读口。宿主真实形状未实测，因此**逐层宽松归一**
     * （`readModelCatalog` 接受数组 / `{models}` / `{data}` / `{items}` 多形态），
     * 并在读取失败时降级成 `empty + reason`，绝不因为形状不符让插件抛错。
     */
    listProviders?(): unknown
    listModels?(providerId: string): Promise<unknown>
  }
  /** 会话默认模型选择（provider/model）；用作 spawn 的 provider 兜底。 */
  /** 可选服务（纪律 §2）：只许经 optionalService(ctx, 'agentDefaultModel') 读取，不要裸读本字段。 */
  agentDefaultModel?: { currentSelection?(): unknown }
  /**
   * [已核] subagents 服务：`list(): string[]` 是**已注册的 subagent provider 名**（本机 `spawn`）。
   *
   * r12 真机事故：把 LLM provider 当 subagent provider 传进 spawn 请求 → 宿主
   * `no subagent provider registered for "opencode-go"`，派发全盘失败。两者是两套命名。
   *
   * 0.2.2-rc.2 起成员能力（创建/直发/中断/名单/身份）全部搬到这里，见 {@link HostSubagents}。
   */
  /** 可选服务（纪律 §2）：只许经 optionalService(ctx, 'subagents') 读取，不要裸读本字段。 */
  subagents?: HostSubagents
  /**
   * [已核] Cordis 的可选服务读取口。可选服务**只能**经本文件的 optionalService() 走这里读；
   * 缺 `get`（旧宿主 / 手搓 fake ctx）时一律按服务缺失降级，不回退裸读。
   */
  get?<T = unknown>(name: string): T | undefined
  /**
   * [已核] Cordis 的「依赖就绪才回调」口：`ctx.inject(deps, cb)`，cb 收到带该依赖的 ctx。
   *
   * 为什么需要它（真机实测 2026-11-01，r6）：`webServer` 在插件 `apply` 时刻**尚未激活**
   * （实测 `ctx.get('webServer')` = undefined），于是面板路由一次也没注册、前端全部 404
   * `not found`。硬写进 `inject` 会让非 web 宿主整条 entry 不激活；`ctx.inject` 两者兼顾。
   */
  inject?(deps: readonly string[], fn: (scope: HostContext) => void): unknown
  logger?: { warn?: (message: string) => void; info?: (message: string) => void }
  /**
   * Cordis 事件订阅形态 `ctx.on(event, listener, options?)`。
   *
   * `options.global === true` 会跳过宿主的作用域过滤（cordis `dispatch()` 里
   * `hook.global || !filter || filter.call(thisArg, hook.ctx)`）。我们观测的是跨作用域的
   * 宿主事实（谁在调工具、哪个会话产出了用量），必须带这个开关 —— 见 subscribeHostEvent。
   */
  on?: (
    event: string,
    listener: (...args: unknown[]) => void,
    options?: { global?: boolean },
  ) => (() => void) | void
  /**
   * Cordis 的根上下文（子 ctx 靠原型链继承同一个 root）。
   *
   * r13 真机事故（2026-11-04）：插件 `apply` 时在自己的 ctx 上订阅服务事件，宿主按作用域
   * 过滤后一条都送不到（真机上 `usage`/`routeAudits`/`progress`/`triggers` 全空；单测的
   * fake ctx 从不带过滤，所以一直是绿的）。订阅宿主事件请统一走 `subscribeHostEvent()`。
   */
  root?: HostContext
}

/**
 * 从一个宿主 Agent 上读**会话工作区**（宿主形状的唯一翻译点）。
 *
 * 为什么是 `session.header.cwd` 而不是进程 cwd：插件 `apply()` 只在宿主启动时执行一次，
 * 那时进程 cwd 是宿主 profile 目录（真机 `~/.dsh/profiles/desktop`），与用户当前打开的仓库无关。
 * 会话自己的根目录挂在 `agent.session.header.cwd` 上（同宿主 `dsh-plugin-teamflow` 的
 * `workspaceScopeOf(agent)` 实测用法），门禁每次执行时按 sessionId 现取即可。
 *
 * 宽容读取：形状没核到就返回 undefined，由调用方回退到装配 workspace（旧行为），不抛错。
 */
export function sessionWorkspaceOf(agent: unknown): string | undefined {
  const session = (agent as { session?: { header?: { cwd?: unknown } } } | null | undefined)?.session
  const cwd = session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

/**
 * 可选服务白名单 —— **唯一登记处**（纪律 §2）。
 *
 * 名词定义：可选服务 = 宿主缺它时插件仍要能激活（只是相关功能降级）的服务。
 * 往这里加名字之前先确认两件事：① 宿主真实注册的服务名逐字一致；② `inject` 里**不**出现它
 * （同时出现会让 cordis 把整条 entry 判为 required，可选语义立刻消失）。
 * 测试 `test/host-contract.test.ts` 会断言 inject ∩ OPTIONAL_SERVICES === ∅。
 */
export const OPTIONAL_SERVICES = [
  'webServer',
  'llm',
  'agentDefaultModel',
  'subagents',
  'sessionProjections',
  /**
   * 宿主工作区注册表（r19）：
   * `Service.inject=['storageDomain','sessionPersistence']`，插件侧只读；`list()` **同步**返回
   * 按持久顺序排列的实体数组，实体是带 getter 的对象（`id` / `path` / `title` / `sessionIds`）。
   * 缺它时（headless / 旧宿主）左栏一律退回「路径 basename」的旧展示，不报错、不拦截。
   * 见 `readWorkspaces()`。
   */
  'workspaceRegistry',
] as const

/** 可选服务名（从白名单派生，不许另写一份字面量）。 */
export type OptionalServiceName = (typeof OPTIONAL_SERVICES)[number]

/** 各可选服务的最小形状（[已核] 字段名来自 ARCHITECTURE §7 的实测输出）。 */
export interface HostSessionProjections {
  /**
   * 读某个会话在某个投影 key 下的当前 state。
   *
   * 宿主签名 `stateOf(session: Session, key: string): unknown`：key 未注册 → `undefined`；
   * 否则先 `materializeCells(session)`（**从会话日志回放**，不依赖事件投递）再返回 cell.state。
   * 该方法在宿主里标了 deprecated（每个 key 首读会打一条 warn），但当前是唯一无副作用的同步读法。
   */
  stateOf?(session: unknown, key: string): unknown
}

export interface OptionalServiceMap {
  webServer: { register(route: unknown): (() => void) | void }
  llm: {
    resolveCallConfig?(input: unknown, signal?: AbortSignal): Promise<unknown>
    listProviders?(): unknown
    listModels?(providerId: string): Promise<unknown>
  }
  agentDefaultModel: { currentSelection?(): unknown }
  /**
   * [已核] subagents 服务（r12 真机事故后补；0.2.2-rc.2 起承载全部成员能力，见 {@link HostSubagents}）。
   *
   * `list()` 返回的是**已注册的 subagent provider 名**（本机为 `spawn`），
   * 与 LLM provider（`opencode-go` / `deepseek` 之类）是**两套完全不同的命名**：
   * 把 LLM provider 填进 spawn 请求的 `provider` 字段，宿主会报
   * `no subagent provider registered for "<llm-provider>"` 并直接创建失败。
   */
  subagents: HostSubagents
  /**
   * [已核] 会话投影注册表（宿主包 `@deepseek-ai/dsh-session-projection`，r17 读源码确认）。
   *
   * 为什么需要它：真机 `session/event` 订阅**从未把事件投递给插件**（r13 起的用量账一直是空的，
   * 见 docs/teamflow/2026-11-05-r17-ui-polish/t6-usage-projection.md 的证据），而宿主的
   * `tokenUsage` 投影由核心插件 `@deepseek-ai/dsh-token-meter` 注册 —— `stateOf(session, 'tokenUsage')`
   * 会**从会话日志回放**出累计 token 数，完全不依赖事件投递。
   */
  sessionProjections: HostSessionProjections
  /**
   * [已核，来自 app.asar] 工作区注册表的最小形状。
   *
   * `list()` 同步返回实体数组；实体字段是 **getter**（`get path()` 等），
   * 所以只能逐项读属性，**不要**对实体做 JSON / 展开拷贝 —— 那会丢掉原型上的 getter。
   * 只声明 `list`：本插件只读这一条，写入口不在这里。
   */
  workspaceRegistry: { list?(): unknown }
}

/** 一个宿主工作区的最小投影（`readWorkspaces()` 的唯一输出形状）。 */
export interface HostWorkspaceEntry {
  /** 宿主实体 id（可能缺失；本插件不依赖它，只作透传）。 */
  id?: string
  /** canonical 绝对路径（宿主已归一，不是用户输入的原始串）。 */
  path: string
  /** 用户自己起的**工作区标题**（可改名）；空串按「没有」处理。 */
  title?: string
  /** 该工作区名下的会话 id（宿主已按会话 header 的 canonical cwd 过滤；去重后）。 */
  sessionIds: string[]
}

/**
 * 读宿主**工作区注册表**（r19：左栏项目名真源的唯一入口）。
 *
 * 为什么需要：run 落盘时记录的 `project` 在桌面宿主里可能是 profile 目录
 * （`~/.dsh/profiles/desktop`），按 basename 展示就是 `desktop`；用户自己的命名
 * （`nengtan` / `tuoluojiang`）只存在宿主的 workspaceRegistry 里。`sessionIds` 还能把
 * 老 run（project 写歪的）按会话 id 映射回真实工作区。
 *
 * 纪律（与 `readModelCatalog` 同族）：
 *  1. **绝不抛**：服务缺失 / `list()` 抛错 / 返回非数组 → 返回 `[]`，调用方退回旧行为；
 *  2. 逐项容错：实体可能是 getter 对象，单个字段读抛出只跳过该字段（even getter may throw）；
 *  3. 只保留 `path` 非空字符串的条目 —— 没有路径的实体无法分桶，收进去只会制造假项目。
 *  4. 用 `readServiceQuietly` 而不是 `optionalService`：项目列表（以及记忆白名单）每次装配都会
 *     读一次，宿主要真没有这个服务，`optionalService` 会按 5s 缓存周期反复刷 warn
 *     （同 `readSessionTokenUsage` 的理由；wire 回归里「装配不应有告警」就是这条）。
 */
export function readWorkspaces(ctx: HostContext): HostWorkspaceEntry[] {
  const registry = readServiceQuietly(ctx, 'workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') return []
  let raw: unknown
  try {
    raw = registry.list.call(registry)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: HostWorkspaceEntry[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    let path: unknown
    let title: unknown
    let id: unknown
    let sessionIds: unknown
    // 实体的字段是 getter：读取本身也可能抛（服务加载失败等），逐项兜住后跳过这一条。
    try {
      path = item.path
      title = item.title
      id = item.id
      sessionIds = item.sessionIds
    } catch {
      continue
    }
    if (typeof path !== 'string') continue
    const pathText = path.trim()
    if (pathText === '') continue
    const entry: HostWorkspaceEntry = { path: pathText, sessionIds: [] }
    if (typeof id === 'string' && id.trim() !== '') entry.id = id.trim()
    if (typeof title === 'string' && title.trim() !== '') entry.title = title.trim()
    if (Array.isArray(sessionIds)) {
      const seen = new Set<string>()
      for (const value of sessionIds) {
        if (typeof value !== 'string') continue
        const sessionId = value.trim()
        if (sessionId === '' || seen.has(sessionId)) continue
        seen.add(sessionId)
        entry.sessionIds.push(sessionId)
      }
    }
    out.push(entry)
  }
  return out
}

/**
 * 读一个**可选**服务：唯一入口，只走 `ctx.get`（纪律 §2/§3）。
 *
 * 三种降级路径各自 warn 并返回 undefined，**任何一条都不许回退裸读**：
 *  - ctx 没有 get（旧宿主 / 手搓 fake ctx）→ 按缺失处理；
 *  - 宿主没注册该服务（get 返回 undefined/null）→ 按缺失处理；
 *  - get 抛错（服务加载失败等）→ 按缺失处理，异常不出本函数。
 * 调用方拿到 undefined 后各自降级（不注册路由 / 不带模型覆盖 / 跳过预校验）。
 */
export function optionalService<K extends OptionalServiceName>(
  ctx: HostContext,
  name: K,
): OptionalServiceMap[K] | undefined {
  const getter = ctx.get
  if (typeof getter !== 'function') {
    ctx.logger?.warn?.(`[auto-team] 宿主 ctx 缺少 get()，可选服务 ${name} 按缺失降级`)
    return undefined
  }
  try {
    const service = getter.call(ctx, name) as OptionalServiceMap[K] | undefined | null
    if (service === undefined || service === null) {
      ctx.logger?.warn?.(`[auto-team] 宿主未提供可选服务 ${name}，相关功能降级`)
      return undefined
    }
    return service
  } catch (error) {
    ctx.logger?.warn?.(`[auto-team] 读取可选服务 ${name} 失败（${messageOf(error)}），按缺失降级`)
    return undefined
  }
}

/**
 * 静默读一个服务：与 `optionalService` 同源，但**不 warn**。
 *
 * 用在「此刻缺失是正常时序」的地方（启动早期 webServer 尚未激活、随后由 `ctx.inject`
 * 等它就绪）。用 `optionalService` 会让正常启动刷一条「相关功能降级」的假告警。
 */
function readServiceQuietly<K extends OptionalServiceName>(
  ctx: HostContext,
  name: K,
): OptionalServiceMap[K] | undefined {
  const getter = ctx.get
  if (typeof getter !== 'function') return undefined
  try {
    const service = getter.call(ctx, name) as OptionalServiceMap[K] | undefined | null
    return service ?? undefined
  } catch {
    return undefined
  }
}

/**
 * 读某个成员会话在宿主**会话投影**里的累计 token 用量（r17）。
 *
 * 为什么走投影而不是事件：真机 `session/event` 从未投递到插件（r13 的用量账一直是空的，
 * 而成员会话日志里 assistant/message 明明带 usage）；宿主核心插件 `dsh-token-meter` 注册的
 * `tokenUsage` 投影会从会话日志回放，`stateOf(session,'tokenUsage').totals` 就是权威累计值。
 *
 * 三条纪律（与 `readModelCatalog` 同族）：
 *  1. **绝不抛**：服务缺失、会话已卸载、字段缺失、回放异常一律 `undefined`，由调用方保持
 *     已落盘的历史值；「读不到」不许降级成 0。
 *  2. **`calls` 不填**：宿主投影没有调用次数计数器，伪造次数比显示「不可得」更糟。
 *     调用次数由 `readSessionCallCount` 单独提供（成员会话 `assistant/message` 事件计数，
 *     与 token 用量取自同一批事件；bridge 把两者合成同一个 `TokenTotals`）。
 *  3. 用 `readServiceQuietly` 而不是 `optionalService`：本函数在每次快照前都会被调用，
 *     服务真缺失时 `optionalService` 会每 2 秒刷一条 warn，把日志淹掉。
 */
export function readSessionTokenUsage(ctx: HostContext, sessionId: string): TokenTotals | undefined {
  // 投影要从 `session.snapshotEvents()` 回放，必须拿真 Session（agent.session），不能伪造壳。
  const session = sessionOf(ctx, sessionId)
  if (session === undefined) return undefined
  const projections = readServiceQuietly(ctx, 'sessionProjections')
  if (projections === undefined || typeof projections.stateOf !== 'function') return undefined
  for (const key of USAGE_PROJECTION_KEYS) {
    try {
      const totals = projectionTotalsOf(projections.stateOf.call(projections, session, key))
      if (totals !== undefined) return totals
    } catch {
      // fail-open：投影回放失败只代表「这次读不到」，不动已落盘的值（下一帧会再试）。
    }
  }
  return undefined
}

/**
 * 宿主 `Agent` 上挂的真 `Session`（`agent.session`）；拿不到返回 `undefined`。
 *
 * 为什么必须是真 Session：token 投影与事件计数都从 `session.snapshotEvents()` 回放，伪造壳
 * 只能读出空数据 —— 那比「不可得」更糟（看起来像 0）。
 */
function sessionOf(ctx: HostContext, sessionId: string): Record<string, unknown> | undefined {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  let session: unknown
  try {
    session = (ctx.agents?.get?.(sessionId) as { session?: unknown } | null | undefined)?.session
  } catch {
    return undefined
  }
  return isRecord(session) ? session : undefined
}

/**
 * 读某个成员会话**自己**的模型调用次数（r20）。
 *
 * 口径：一次模型调用 = 一条 `assistant/message` 事件（`docs/teamflow/2026-11-05-token-usage.md`
 * 的既定定义；r17 的 `countCall` 也是同一口径）。真机会话日志里 `assistant/message` 与
 * `step/end` 条数在已完成的轮次上相等，但空回复/被取消的 step 只在 `assistant/message` 上
 * 有落地 —— 面板的「调用次数」与 token 用量必须取自同一批事件，否则两个指标会互相矛盾。
 *
 * 三条纪律：
 *  1. **只数自己的事件**：从 `inheritedEventCount` 之后数，fork/续聊不把父会话的调用算进来；
 *  2. **绝不抛**：会话未加载、日志不可读 → `undefined`（调用方保留已落盘的历史值）；
 *  3. 会话可读但一条都没有 → `0` 是**真实计数**，不是补 0。
 *
 * 走 `snapshotEvents`（宿主公开读口）而不是 `ownEvents()`（同样标 deprecated 但会自建数组）；
 * 旧宿主没有该方法时退化为公开的 `session.log` 数组切片（同 `inheritedEventCount` 语义）。
 */
export function readSessionCallCount(ctx: HostContext, sessionId: string): number | undefined {
  const session = sessionOf(ctx, sessionId)
  if (session === undefined) return undefined
  const from = nonNegativeNumber(session.inheritedEventCount) ?? 0
  let events: unknown
  try {
    if (typeof session.snapshotEvents === 'function') {
      events = session.snapshotEvents.call(session, from)
    } else if (Array.isArray(session.log)) {
      events = session.log.slice(from)
    }
  } catch {
    return undefined
  }
  if (!Array.isArray(events)) return undefined
  let calls = 0
  for (const event of events) {
    if (isRecord(event) && event.type === 'assistant/message') calls += 1
  }
  return calls
}

/** 用量投影的读取顺序：宿主核心口径优先，第三方 `dsh-cost-meter` 兜底。 */
const USAGE_PROJECTION_KEYS = ['tokenUsage', 'costUsage'] as const

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * 把投影 state 的 buckets 收敛成 `TokenTotals`（读法宽松：`totals` / `buckets` / state 本体）。
 *
 * `tokenUsage` 的字段名已核（`uncachedInputTokens` / `outputTokens` / `cacheReadTokens` /
 * `cacheWriteTokens`）；`costUsage` 是第三方插件兜底、真实形状**未核**，所以同时接受短名别名
 * （`inputTokens` / `input` …）。认不出任何数字就返回 `undefined` —— 宁可「不可得」，不可补 0。
 *
 * `total` 口径与 `team/usage.ts` 的 `tokenTotalsOf` 一致：未命中缓存输入 + 命中缓存输入 + 输出。
 */
function projectionTotalsOf(state: unknown): TokenTotals | undefined {
  if (!isRecord(state)) return undefined
  const buckets = isRecord(state.totals) ? state.totals : isRecord(state.buckets) ? state.buckets : state
  const input =
    nonNegativeNumber(buckets.uncachedInputTokens) ??
    nonNegativeNumber(buckets.inputTokens) ??
    nonNegativeNumber(buckets.input)
  const output = nonNegativeNumber(buckets.outputTokens) ?? nonNegativeNumber(buckets.output)
  const cacheRead = nonNegativeNumber(buckets.cacheReadTokens) ?? nonNegativeNumber(buckets.cacheRead)
  const cacheWrite = nonNegativeNumber(buckets.cacheWriteTokens) ?? nonNegativeNumber(buckets.cacheWrite)
  if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) {
    return undefined
  }
  const totals: TokenTotals = { total: (input ?? 0) + (cacheRead ?? 0) + (output ?? 0) }
  if (input !== undefined) totals.input = input
  if (output !== undefined) totals.output = output
  if (cacheRead !== undefined) totals.cacheRead = cacheRead
  if (cacheWrite !== undefined) totals.cacheWrite = cacheWrite
  return totals
}

/**
 * 订阅宿主事件 —— **唯一入口**（r13 真机事故后收口）。
 *
 * 为什么不能直接 `ctx.on(...)`：cordis 派发时按作用域过滤监听器
 * （`hook.global || !filter || filter.call(thisArg, hook.ctx)`），插件自己的 ctx 是 root 的
 * 兄弟分支，会话/工具作用域的事件过滤后**一条都送不到**。2026-11-04 真机实测：成员确实在跑、
 * 会话日志里 assistant/message 带着 usage，而 run JSON 里 `usage`/`routeAudits`/`progress`/
 * `triggers` 全空 —— 单测的 fake ctx 不实现过滤，所以一直绿。
 *
 * 两条路一起走，任一可用即可：
 *  1. 在 `ctx.root` 上注册（root 是所有作用域的公共祖先，过滤必通过）；
 *  2. 注册时置 `{ global: true }`，按 cordis 的语义直接跳过过滤。
 * 拿不到 root 又没有 global 选项时退回普通订阅（至少与旧行为等价，不会更差）。
 */
export function subscribeHostEvent(
  ctx: HostContext,
  event: string,
  listener: (...args: unknown[]) => void,
): (() => void) | void {
  const root = ctx.root
  const target =
    root && typeof root.on === 'function' && root !== ctx ? root : ctx
  const on = target.on
  if (typeof on !== 'function') {
    // 拿不到 on 是宿主不支持事件（不是我们传错），交给调用方降级。
    return undefined
  }
  try {
    return on.call(target, event, listener, { global: true })
  } catch (error) {
    // 有些宿主/老版本不接受第三参：退回两参订阅（至少与旧行为等价）。
    // 两次都失败说明订阅本身有问题，交给调用方 degrade —— 这里不吞异常，否则调用方
    // 分不清「宿主没有事件能力」和「订阅被拒绝」（r5 的三档降级就靠这个区分）。
    try {
      return on.call(target, event, listener)
    } catch {
      throw error
    }
  }
}

/**
 * r10 AC-16：读一次宿主的模型清单（**唯一的 llm 清单读口**，缓存与 TTL 在 model-catalog.ts）。
 *
 * 三条纪律：
 *  1. **绝不抛**：任何缺失/形状不符/调用异常都收敛成 `{ groups: [], failures: [], reason }`。
 *     快照侧是同步 API，一次未捕获的 reject 会让整个面板轮询卡死（比没有清单严重得多）。
 *  2. **逐层宽松归一**：宿主返回 `string[]` / `{ id, name }[]` / `{ models: [...] }` /
 *     `{ data: [...] }` 都接受 —— 真实形状尚未实测（见 HostContext.llm 的 [未核] 注记）。
 *  3. **单 provider 失败不整体失败**：某provider 的 `listModels` 抛错就把它的名字记进
 *     `failures`，其余 provider 照常显示（面板会把这句写进 reason）。
 */
export async function readModelCatalog(ctx: HostContext): Promise<ModelCatalogRaw> {
  const missing: ModelCatalogRaw = {
    groups: [],
    failures: [],
    reason: '宿主未提供模型清单（llm 服务不可用）',
  }
  const llm = optionalService(ctx, 'llm')
  if (llm === undefined || typeof llm.listProviders !== 'function') return missing

  let providersRaw: unknown
  try {
    providersRaw = llm.listProviders()
  } catch (error) {
    return { groups: [], failures: [], reason: `宿主模型清单读取失败：${messageOf(error)}` }
  }
  const providers = normalizeCatalogEntries(providersRaw)
  if (providers.length === 0) {
    return { groups: [], failures: [], reason: '宿主未提供模型清单（llm 服务没有列出任何 provider）' }
  }

  const listModels = llm.listModels
  const settled = await Promise.all(
    providers.map(async (provider) => {
      if (typeof listModels !== 'function') {
        return { provider, models: [], message: '宿主不支持 listModels' }
      }
      try {
        const modelsRaw = await listModels.call(llm, provider.id)
        return { provider, models: normalizeCatalogEntries(modelsRaw), message: undefined }
      } catch (error) {
        return { provider, models: [], message: messageOf(error) }
      }
    }),
  )

  const groups: ModelCatalogRaw['groups'] = []
  const failures: ModelCatalogRaw['failures'] = []
  for (const item of settled) {
    if (item.models.length > 0) {
      groups.push({
        id: item.provider.id,
        name: item.provider.name,
        models: item.models.map((model) => ({ id: model.id, name: model.name })),
      })
      continue
    }
    // 读到了 provider 但一个模型都没有：不静默跳过，否则「宿主里明明配了模型」无从排查
    failures.push({ id: item.provider.id, name: item.provider.name, message: item.message ?? '未列出任何模型' })
  }
  return { groups, failures }
}

/** 把宿主五花八门的清单返回值压成 `{ id, name }[]`（`string[]` 也接受，name 缺省取 id）。 */
function normalizeCatalogEntries(raw: unknown): { id: string; name: string }[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.models)
      ? raw.models
      : isRecord(raw) && Array.isArray(raw.data)
        ? raw.data
        : isRecord(raw) && Array.isArray(raw.items)
          ? raw.items
          : isRecord(raw) && Array.isArray(raw.providers)
            ? raw.providers
            : []
  const entries: { id: string; name: string }[] = []
  for (const item of list) {
    if (typeof item === 'string') {
      if (item !== '') entries.push({ id: item, name: item })
      continue
    }
    if (!isRecord(item)) continue
    const id = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : ''
    if (id === '') continue
    const name = typeof item.name === 'string' && item.name !== '' ? item.name : id
    entries.push({ id, name })
  }
  return entries
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
 * 把工具返回值整理成「lossless JSON」：宿主会拒收含 `undefined` 值的返回
 * （实测原文 `tool "auto_team_status" returned invalid output: value is not lossless JSON`，
 * 因为 `JSON.stringify` 会把 undefined 键丢掉，宿主据此判定有信息损失）。
 *
 * r12 真机事故：`auto_team_status` 在「还没计划」时返回 `runId/planStatus/plannedAt = undefined`，
 * 任务未派发时 `memberId`、无门禁证据时 `evidence` 也是 undefined —— 于是**只要还没有计划，
 * 队长就查不了状态**；单测全绿是因为没人按宿主口径校验「返回值可无损序列化」。
 *
 * 收口放在 `execute` 这一处（8 个工具共用），比逐个工具手改更难漏。语义：
 * 对象里值为 undefined/函数/Symbol 的键**丢掉**；数组里这类元素换 null（保住位置）；
 * NaN/Infinity 换 null；bigint 转字符串；循环引用换 null。
 */
export function losslessJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value as object)) return null
  seen.add(value as object)
  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = losslessJson(item, seen)
      return next === undefined ? null : next
    })
  }
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const next = losslessJson(item, seen)
    if (next !== undefined) out[key] = next
  }
  return out
}

/**
 * [已核] ToolDefinition = ToolSchema & { output: ToolOutputDefinition, execute(args, exec) }
 *   ToolSchema        = { name, description, parameters }
 *   ToolOutputDefinition = { schema: JsonSchemaNode, render(args, value): ContentBlock[] }
 * 缺 `output` 会让宿主在 register 或首次调用时报错，因此这里必须补齐。
 * `execute` 统一过 `losslessJson`（见上，r12 真机事故）。
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
    execute: async (args: Record<string, unknown>, meta?: unknown): Promise<unknown> =>
      losslessJson(await spec.handler(args, meta)),
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
 *
 * 时序（真机实测 2026-11-01，r6 的 404 根因）：宿主启动早期 `webServer` **尚未激活**，
 * `ctx.get('webServer')` 返回 undefined —— 早先的实现只试这一次就 `return false`，
 * 结果是路由一条也没注册，面板「刷新」永远拿到 404 `not found`，而宿主日志里没有告警
 * （可选服务 warn 走的是 logger，启动早期也可能还没接上）。
 * 现在的顺序：① 先试一次立即注册（服务已就绪的宿主一次性成功）；
 * ② 拿不到就 `ctx.inject(['webServer'], cb)` 等它就绪再注册；③ 都没有（非 web 宿主）才 false。
 */
export function registerHttpRoutes(
  ctx: HostContext,
  routes: HttpRoute[],
  prefix: string = BRIDGE_ROUTE,
): boolean {
  const install = (sink: OptionalServiceMap['webServer'] | undefined): boolean => {
    if (!sink?.register) return false
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

  if (install(readServiceQuietly(ctx, 'webServer'))) return true

  if (typeof ctx.inject !== 'function') return false
  try {
    ctx.inject(['webServer'], (scope) => {
      const late = scope?.webServer ?? readServiceQuietly(ctx, 'webServer')
      if (!install(late)) {
        ctx.logger?.warn?.('[auto-team] webServer 就绪后仍无法注册面板路由，面板将显示接口不可用')
      }
    })
    return true
  } catch (error) {
    ctx.logger?.warn?.(`[auto-team] 等待 webServer 就绪失败（${messageOf(error)}）`)
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

const REASONING_EFFORTS: ReadonlySet<string> = new Set(['low', 'medium', 'high'])

/** 非空字符串才视为有效值：空串/非字符串一律当「没填」，绝不补猜。 */
function nonEmptyStringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function reasoningEffortOf(value: unknown): 'low' | 'medium' | 'high' | undefined {
  return typeof value === 'string' && REASONING_EFFORTS.has(value)
    ? (value as 'low' | 'medium' | 'high')
    : undefined
}

/**
 * 读某个会话**当前真实**的模型路由（r27）。
 *
 * 会话默认是 per-session 的：队长会话把它写在 `requestHeader.config`
 * （`agentDefaultModel.currentSelection()` 只是「新建 agent 的全局默认」，不是这个会话的选择）。
 * 因此路由必须从会话本身读，且只认完整的一对 provider/model：
 *
 *  - 读不到（无 session / 无 requestHeader / 非对象 config）→ `undefined`；
 *  - provider 或 model 任一缺失/为空 → `undefined`（**禁止半截路由**：只带 provider 会让宿主
 *    拼出「全局 provider + 父会话 model」的混合路由，正是 r27 要修的事故）；
 *  - `reasoningEffort` 只接受宿主的三个合法枚举值，其余忽略；
 *  - 全程不抛：任何异常都退化成「这次读不到」，由调用方回退或保持 unverified。
 */
/**
 * 宿主是否具备「按会话读路由」的能力（r27）。
 *
 * 老宿主没有 `ctx.agents.get`：此时任何会话都读不到 `requestHeader.config`，复用闸门必须整体
 * 视为不可用（继续按旧行为复用），而不是把每个成员都判成「路由不一致」后无限新建成员。
 */
export function canReadSessionRoute(ctx: HostContext): boolean {
  return typeof ctx.agents?.get === 'function'
}

export function readSessionRoute(ctx: HostContext, sessionId: string): RoleModelRoute | undefined {
  const session = sessionOf(ctx, sessionId)
  if (session === undefined) return undefined

  let header: unknown
  try {
    header =
      typeof session.requestHeader === 'function'
        ? (session.requestHeader as () => unknown).call(session)
        : undefined
  } catch {
    return undefined
  }
  const config = isRecord(header) && isRecord(header.config) ? header.config : undefined
  if (config === undefined) return undefined

  const provider = nonEmptyStringOf(config.provider)
  const model = nonEmptyStringOf(config.model)
  if (provider === undefined || model === undefined) return undefined

  const reasoningEffort = reasoningEffortOf(config.reasoningEffort)
  return {
    provider,
    model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}

/** 当前活跃队长会话的真实路由（`resolveCaller` → {@link readSessionRoute}）；读不到 undefined。 */
export function readCallerRoute(ctx: HostContext): RoleModelRoute | undefined {
  const caller = resolveCaller(ctx)
  if (caller === undefined) return undefined
  return readSessionRoute(ctx, caller.id)
}

const NO_CALLER = '当前没有活跃的队长会话：agentTeams 需要以 Agent 身份调用，请在会话内使用本工具。'

/**
 * spawn 请求里 `provider` 的默认值：**subagent provider 名**（不是 LLM provider）。
 *
 * 本机 `subagents.list()` 实测只有 `spawn`（宿主内置的 fresh-context 子会话实现），
 * `spawn_teammate` 工具自己统计到的成员 `provider` 也是它。读不到注册表时退回它，
 * 由宿主给出明确报错（r12 事故：这里曾填 LLM provider，派发 100% 失败）。
 */
const DEFAULT_SUBAGENT_PROVIDER = 'spawn'

/** `subagents.startActivation` 的 `label` 上限（宿主 catalog 短标签，约 64 字符）；超长截断不报错。 */
const SUBAGENT_LABEL_MAX = 64

/** 组 `label`：优先任务标题描述，其次任务 id，最后成员名；空串跳过，截断到宿主上限。 */
function subagentLabelOf(input: SpawnPortInput): string {
  const raw =
    [input.description, input.taskId, input.name].find(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    ) ?? ''
  return raw.length > SUBAGENT_LABEL_MAX ? raw.slice(0, SUBAGENT_LABEL_MAX) : raw
}

/**
 * `interrupt(caller, name)` 的返回形状**未核实**（只核实了宿主有这个方法），所以宽松归一
 * 只能放在宿主边界这一处 —— bridge/dispatch 只消费 `{ ok, error? }`，端口不漂移。
 *
 * 口径：`void`/`undefined` 视为已受理（命令式 API 多数不返回值）；显式 `ok` 布尔优先；
 * 只带 `error`/`message` 字符串视为失败；其余一律按已受理 —— `cancelled` 状态是权威，
 * 成员是否真停由 watcher 对账，所以这里猜错也不会让状态机错。
 */
export function normalizeInterruptResult(value: unknown): { ok: boolean; error?: string } {
  if (value === undefined || value === null) return { ok: true }
  if (typeof value === 'boolean') return { ok: value }
  if (typeof value === 'object') {
    const row = value as { ok?: unknown; error?: unknown; message?: unknown }
    const error =
      typeof row.error === 'string' && row.error !== ''
        ? row.error
        : typeof row.message === 'string' && row.message !== ''
          ? row.message
          : undefined
    if (typeof row.ok === 'boolean') return error === undefined ? { ok: row.ok } : { ok: row.ok, error }
    if (error !== undefined) return { ok: false, error }
  }
  return { ok: true }
}

/**
 * 宿主名额耗尽的失败文案（t5）。
 *
 * 两种配额要分开说，因为处置完全不同：
 * - `Team member limit N reached`：**终身**名额（含已结束/已退休成员），只能调大
 *   `agent-team` 的 `maxMembers`（或换一个 profile）。旧实现只把宿主原文透出去，
 *   用户看到「member limit」完全不知道去哪改。
 * - `active child limit`：并发名额，等正在跑的任务结束就会释放。
 *
 * 宿主原文始终保留在前缀里：分类错了也不会把真实原因藏掉。
 */
export function spawnFailureText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/team member limit/i.test(raw)) {
    return `创建成员失败：${raw}。宿主 Team 的成员名额（maxMembers）是终身配额（含已结束成员），当前已用完；请在 profile 配置调大 agent-team 的 maxMembers（cordis.patch.yml 里 agent-team 条目的 config.maxMembers），或换一个 profile 后再派发。`
  }
  if (/active child limit/i.test(raw)) {
    return `创建成员失败：${raw}。宿主同时运行的子成员已达上限（active child limit）；等正在跑的任务结束后重试，或调大宿主的并发上限。`
  }
  if (/member.*(limit|quota|capacity)|(limit|quota|capacity).*member|名额|成员.*上限/i.test(raw)) {
    return `创建成员失败：${raw}。这看起来是宿主成员名额/并发上限；名额是终身配额时请在 profile 配置调大 agent-team 的 maxMembers。`
  }
  return `创建成员失败：${raw}`
}

/** `spawn` 端口的入参（与 dispatch 的 `SpawnInput` 分开：这层只关心宿主调用所需字段）。 */
export interface SpawnPortInput {
  prompt: string
  name: string
  description?: string
  route?: RoleModelRoute
  sessionId: string
  taskId: string
}

export interface SpawnPorts {
  spawn: (input: SpawnPortInput) => Promise<
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
  /**
   * 尽力中断一个成员（r11 AC-26）：面板「取消任务」在任务 `running` 时调用。
   *
   * **可选**：宿主没有 `ctx.interrupt` 时不提供，调用方按「未装配」处理（只改任务状态）。
   * 返回形状归一在这一层（见 `normalizeInterruptResult`），bridge 只消费 `{ ok, error? }`。
   */
  interruptMember?: (name: string) => Promise<{ ok: boolean; error?: string }>
}

/**
 * [已核] SpawnTeammateRequest = { name, description, prompt: ContentBlock[], context: 'fresh'|'fork', provider, signal }
 *   SpawnTeammateResult  = { member: TeamMemberView }，member.id + member.name 是我们要的两件事。
 *
 * **`provider` 是 subagent provider 名，不是 LLM provider 名**（r12 真机事故定案）：
 * 宿主拿它去 `subagents.getProvider(name)` 查已注册实现（本机只有 `spawn`，见
 * `subagents.list(): string[]`），查不到就报
 * `no subagent provider registered for "<name>"` 并让整个 spawn 失败。
 * 过去这里塞的是角色的 LLM provider（`opencode-go`），于是**任何一次派发都必然失败**；
 * 单元测试与探针都没发现，因为探针会话先被「只有 Lead 能建成员」拦住了。
 *
 * 逐角色模型的正确通道是 `SubagentStartRequest.agentOptions?: AgentOptions =
 * { provider?, model?, reasoningEffort?, maxTokens? }`（宿主 `subagents` 服务契约原文），
 * 由 spawn 请求的 `agentOptions` 字段带下去。`installMemberRoute`（`agent/created` 里装
 * member-scoped 路由）保留为第二道保险：宿主版本忽略 `agentOptions` 时它仍能改写模型。
 */
/*
 * 关于 `provider` 与 `agentOptions`（r12 真机事故定案，改这里之前先读）：
 *
 *  - spawn 请求的 `provider` 是**已注册的 subagent provider 名**（宿主 `subagents.list()`，
 *    本机只有 `spawn`），不是 LLM provider。填 LLM provider 会让宿主报
 *    `no subagent provider registered for "<name>"`，**每一次派发都失败**；
 *    单测与探针都发现不了，因为探针会话先被「只有 Lead 能建成员」拦住了。
 *  - 逐角色模型的官方通道是 `SubagentStartRequest.agentOptions?: AgentOptions =
 *    { provider?, model?, reasoningEffort?, maxTokens? }`，由 spawn 请求的 `agentOptions` 带下去。
 *  - `installMemberRoute`（`agent/created` 里装 member-scoped 路由）保留为第二道保险：
 *    宿主版本忽略 `agentOptions` 时它仍能改写模型。
 */

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
  /**
   * 成员能力读口：**每次调用现读**，不在构造期快照。
   *
   * 走 `ctx.get`（`readServiceQuietly`）而不是裸读 `ctx.subagents`：本服务只在
   * `OPTIONAL_SERVICES` 登记（漏在 `inject` 里也照样能读到），裸读会踩 cordis
   * 「cannot get property without inject」。
   */
  const subagentsOf = (): HostSubagents | undefined => readServiceQuietly(ctx, 'subagents')
  /** memberId → 成员名：**仅旧宿主**的 sendMessage target 是名字；新宿主按 SessionId 直发。 */
  const names = new Map<string, string>()

  /**
   * 最后一级兜底：宿主「新建 agent 的全局默认」选择。
   *
   * 只在会话路由读不到时使用（r27）。与 {@link readSessionRoute} 同一口径：provider 与 model
   * **成对**才算有效，缺一个就返回 `undefined`，绝不产出半截路由。
   */
  function fallbackRoute(): RoleModelRoute | undefined {
    try {
      const selection = optionalService(ctx, 'agentDefaultModel')?.currentSelection?.() as
        | Record<string, unknown>
        | undefined
      const provider = nonEmptyStringOf(selection?.provider)
      const model = nonEmptyStringOf(selection?.model)
      if (provider === undefined || model === undefined) return undefined
      const reasoningEffort = reasoningEffortOf(selection?.reasoningEffort)
      return {
        provider,
        model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      }
    } catch {
      /* 读不到就视为没有默认路由，由宿主给出明确报错 */
    }
    return undefined
  }

  /** 旧宿主专用：把名单刷进名字表（新宿主按 SessionId 直发，不需要名字）。 */
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

  /**
   * 组 spawn 请求时要填的 **subagent provider 名**（≠ LLM provider）。
   *
   * 新宿主 `getProvider('spawn')` 能查到就用 `spawn`（宿主内置的 fresh-context 子会话实现）；
   * 读不到 `getProvider` 的旧宿主 / 测试桩仍沿用 `list()` 的注册表顺序（优先 `spawn`）；
   * 两者都读不到就退回 `DEFAULT_SUBAGENT_PROVIDER`，由宿主给出明确报错。
   */
  function subagentProviderName(): string {
    const subagents = subagentsOf()
    try {
      if (typeof subagents?.getProvider === 'function' && subagents.getProvider(DEFAULT_SUBAGENT_PROVIDER)) {
        return DEFAULT_SUBAGENT_PROVIDER
      }
    } catch {
      /* getProvider 抛错 → 退回注册表顺序 / 默认常量 */
    }
    try {
      const rows = subagents?.list?.()
      const registered = Array.isArray(rows) ? rows.filter((row): row is string => typeof row === 'string' && row !== '') : []
      if (registered.includes(DEFAULT_SUBAGENT_PROVIDER)) return DEFAULT_SUBAGENT_PROVIDER
      if (registered.length > 0) return registered[0] as string
    } catch {
      /* 读不到就退回默认名，由宿主给出明确报错 */
    }
    return DEFAULT_SUBAGENT_PROVIDER
  }

  /**
   * 角色声明 / 会话默认的 **LLM** 路由；`agentOptions` 与成员路由都用它。
   *
   * 优先级（r27）：角色显式声明 > 当前队长会话路由 > 宿主全局默认选择。三者都必须是
   * 完整的 provider+model 对；读不到就返回 `undefined`（spawn 侧会明确报错），绝不只取 provider。
   */
  function modelRouteOf(input: SpawnPortInput): RoleModelRoute | undefined {
    if (input.route !== undefined) return input.route
    // 先走 caller（工具执行期可用）；后台派发没有 initiator 时用本次 run 的会话 id 兜底。
    return readCallerRoute(ctx) ?? readSessionRoute(ctx, input.sessionId) ?? fallbackRoute()
  }

  return {
    async spawn(input) {
      const subagents = subagentsOf()
      const canStartActivation = typeof subagents?.startActivation === 'function'
      // 旧宿主兼容分支：新宿主已移除 spawnTeammate，只在方法仍存在时使用。
      const canSpawnTeammate = typeof teams?.spawnTeammate === 'function'
      if (!canStartActivation && !canSpawnTeammate) {
        return {
          ok: false,
          error: '宿主未提供 subagents.startActivation（旧宿主也没有 agentTeams.spawnTeammate），无法创建成员',
        }
      }
      const caller = resolveCaller(ctx)
      if (!caller) return { ok: false, error: NO_CALLER }
      // provider 必须是**已注册的 subagent provider 名**；LLM 模型走 agentOptions 带下去。
      const provider = subagentProviderName()
      const modelRoute = modelRouteOf(input)
      const agentOptions =
        modelRoute === undefined
          ? undefined
          : {
              ...(modelRoute.provider === '' ? {} : { provider: modelRoute.provider }),
              ...(modelRoute.model === '' ? {} : { model: modelRoute.model }),
              ...(modelRoute.reasoningEffort === undefined ? {} : { reasoningEffort: modelRoute.reasoningEffort }),
            }
      const prompt = [{ type: 'text', text: input.prompt }] satisfies HostTextBlock[]
      const abort = signal ?? new AbortController().signal
      // 必须先登记再 spawn：`agent/created` 在创建事务内同步触发（见 pendingRoutes 说明）。
      trackPendingRoute(input.name, input.route)
      // 同上：清掉可能残留的旧观测，保证 take 到的只可能是**本次**创建观测到的路由。
      settlePendingActual([input.name])
      try {
        if (canStartActivation && subagents?.startActivation) {
          const activation = await subagents.startActivation({
            provider,
            // label 只是 catalog 里的短标签（宿主限制 ~64 字符），不是任务正文。
            label: subagentLabelOf(input),
            name: input.name,
            prompt,
            parent: caller,
            signal: abort,
            // 完成时通知父会话模型（队长）；成员不是宿主队友，通知靠这条投递。
            delivery: 'parent',
            // 角色声明的 LLM 模型：`agentOptions` 是宿主官方下发通道。
            ...(agentOptions === undefined ? {} : { agentOptions }),
          })
          if (activation === undefined || activation === null) {
            return { ok: false, error: 'subagents.startActivation 未返回 activation：宿主返回值形状与预期不符' }
          }
          if (typeof activation.childId !== 'string' || activation.childId === '') {
            return { ok: false, error: 'subagents.startActivation 未返回 childId：宿主返回值形状与预期不符' }
          }
          // 成员在后台跑很久：**绝不 await** 结果（派发必须立刻返回）；但必须就地吞掉失败，
          // 否则未处理的 rejection 会打崩宿主日志。
          const result = activation.result
          if (result !== undefined && typeof (result as { catch?: unknown }).catch === 'function') {
            void (result as Promise<unknown>).catch(() => {})
          }
          // 事件在 startActivation 内部就触发完了，此刻观测值已经在表里；取到即删。
          const actualName = typeof activation.name === 'string' ? activation.name : ''
          const actual = takePendingActual([input.name, activation.childId, actualName])
          return { ok: true, memberId: activation.childId, ...(actual === undefined ? {} : { actual }) }
        }
        // ── 旧宿主回退路径（agentTeams.spawnTeammate）────────────────────────────
        const created = (await teams!.spawnTeammate!(caller, {
          name: input.name,
          description: input.description ?? `任务 ${input.taskId}`,
          prompt,
          context: 'fresh',
          provider,
          // 角色声明的 LLM 模型：宿主 `SubagentStartRequest.agentOptions` 是官方下发通道。
          ...(agentOptions === undefined ? {} : { agentOptions }),
          signal: abort,
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
        return { ok: false, error: spawnFailureText(error) }
      } finally {
        // 装路由是「取走即删」，这里只清理没被取走的（失败/宿主未触发 agent/created）。
        settlePendingRoute(input.name)
        settlePendingActual([input.name])
      }
    },

    async sendMessage(memberId, text) {
      const subagents = subagentsOf()
      const canNewSend = typeof subagents?.sendMessage === 'function'
      // 旧宿主兼容分支：新宿主已移除 agentTeams.sendMessage。
      const canOldSend = typeof teams?.sendMessage === 'function'
      if (!canNewSend && !canOldSend) {
        return { ok: false, error: '宿主未提供 subagents.sendMessage（旧宿主也没有 agentTeams.sendMessage）' }
      }
      const caller = resolveCaller(ctx)
      if (!caller) return { ok: false, error: NO_CALLER }
      const content = [{ type: 'text', text }] satisfies HostTextBlock[]
      const abort = signal ?? new AbortController().signal
      try {
        if (canNewSend && subagents?.sendMessage) {
          // 新 API 用 SessionId 直发，不需要名字表（refreshNames 只在旧分支用）。
          await subagents.sendMessage(caller, memberId, content, { signal: abort })
          return { ok: true }
        }
        if (!names.has(memberId)) refreshNames(caller)
        const target = names.get(memberId) ?? memberId
        await teams!.sendMessage!(caller, { target, content, signal: abort })
        return { ok: true }
      } catch (error) {
        return { ok: false, error: `直达消息失败：${error instanceof Error ? error.message : String(error)}` }
      }
    },

    /**
     * 尽力中断（r11 AC-26）：只被「取消一个 running 任务」调用。
     *
     * 新宿主：名字 → SessionId（`resolveName`）→ `interrupt(id, { kind: 'ancestor', agent })`。
     * 旧宿主：仍走 `agentTeams.interrupt(caller, name)`。
     *
     * 失败**不是**动作失败：bridge 把 `error` 折进一条 notice，任务状态照常落 `cancelled`
     * —— 否则用户点一次「取消」会得到红字而状态没变，比不中断更糟。
     */
    async interruptMember(name) {
      const subagents = subagentsOf()
      const canNewInterrupt = typeof subagents?.interrupt === 'function' && typeof subagents?.resolveName === 'function'
      const oldInterrupt = teams?.interrupt
      if (!canNewInterrupt && typeof oldInterrupt !== 'function') {
        return { ok: false, error: '宿主未提供 interrupt 能力（成员不会被中断，任务状态照常取消）' }
      }
      const caller = resolveCaller(ctx)
      if (!caller) return { ok: false, error: NO_CALLER }
      try {
        if (canNewInterrupt && subagents?.interrupt && subagents.resolveName) {
          const id = await subagents.resolveName(caller, name, signal ?? new AbortController().signal)
          if (typeof id !== 'string' || id === '') {
            return { ok: false, error: `中断成员失败：无法把成员 ${name} 解析成会话 id` }
          }
          return normalizeInterruptResult(subagents.interrupt(id, { kind: 'ancestor', agent: caller }))
        }
        return normalizeInterruptResult(await oldInterrupt!.call(teams, caller, name))
      } catch (error) {
        return { ok: false, error: `中断成员失败：${error instanceof Error ? error.message : String(error)}` }
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
      // 可选服务：只经 optionalService 走 ctx.get（缺失时它已 warn：跳过模型路由预校验，放行声明值）。
      const llm = optionalService(ctx, 'llm')
      if (!llm?.resolveCallConfig) {
        return route
      }
      try {
        const resolved = await llm.resolveCallConfig({ provider: route.provider, model: route.model })
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
  const dispose = subscribeHostEvent(ctx, 'agent/created', handler)
  if (dispose === undefined) {
    ctx.logger?.warn?.('[auto-team] 宿主未提供事件订阅，成员实际模型路由将退回声明值')
  }
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
 * 成员名单（双通道）。
 *
 * 新宿主（0.2.2-rc.2）：`subagents.listDescendants(rootOf(caller).id)`——成员就是 subagent，
 * 名单是 root 会话的子树；`activity` 只有 running/inactive 两态，`diagnostic` 行表示
 * 该分支读不出来的原因，跳过（它不是成员）。
 * 旧宿主：`agentTeams.listMembers(caller)`，方法已移除的宿主上只作兼容回退。
 *
 * 拿不到名单时 **抛错**（而不是返回空数组）——空数组在 watcher 眼里等于「成员全死了」，
 * 会把所有任务误标 interrupted；抛错则本轮跳过，宁可漏报一轮也不误杀。
 */
export async function listHostMembers(ctx: HostContext): Promise<HostMember[]> {
  const subagents = readServiceQuietly(ctx, 'subagents')
  const teams = ctx.agentTeams
  const caller = resolveCaller(ctx)
  if (!caller) throw hostError(NO_CALLER, 'NO_CALLER')
  if (typeof subagents?.listDescendants === 'function') {
    const root = subagents.rootOf?.(caller) as { id?: unknown } | string | undefined
    const rootId = typeof root === 'string' ? root : root?.id
    if (typeof rootId !== 'string' || rootId === '') {
      throw hostError('宿主 subagents.rootOf 未返回 root 会话 id：无法核对成员存活状态。', 'NOT_FOUND')
    }
    return normalizeDescendantRows(await subagents.listDescendants(rootId))
  }
  if (typeof teams?.listMembers === 'function') {
    return normalizeMemberRows(await teams.listMembers(caller))
  }
  throw hostError(
    '宿主未提供 subagents.listDescendants（旧宿主也没有 agentTeams.listMembers）：无法核对成员存活状态。',
    'NOT_FOUND',
  )
}

/**
 * 归一 `subagents.listDescendants` 的行。
 *
 * 只认 `kind === 'child'` 的成员行；`diagnostic` 是「这条分支为什么读不出来」的说明，不是成员。
 * `status` 原样透传宿主 activity（running/inactive），由 watcher 的 `normalizeHostStatus` 判定死活。
 * 返回值不是数组 = 宿主契约不符 → 抛错（绝不能拿空数组冒充「没有成员」）。
 */
export function normalizeDescendantRows(rows: unknown): HostMember[] {
  if (!Array.isArray(rows)) {
    throw hostError('subagents.listDescendants 返回值不是数组：无法核对成员存活状态。', 'NOT_FOUND')
  }
  const members: HostMember[] = []
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue
    const row = item as { kind?: unknown; id?: unknown; activity?: unknown; path?: unknown }
    if (row.kind !== undefined && row.kind !== 'child') continue
    if (typeof row.id !== 'string' || row.id === '') continue
    // 模型可见名是斜杠路径（root='lead'）；面板/消息里只展示最后一段。
    const path = typeof row.path === 'string' ? row.path : ''
    const name = path === '' ? '' : (path.split('/').pop() ?? '')
    members.push({ id: row.id, name, status: row.activity === 'running' ? 'running' : 'inactive' })
  }
  return members
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

/** payload 里的对象是否「像个 agent」：有非空 id / name，或挂着 ctx（宿主 Agent 的最小可辨认特征）。 */
function isAgentLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { id?: unknown; name?: unknown; ctx?: unknown }
  if (typeof candidate.id === 'string' && candidate.id !== '') return true
  if (typeof candidate.name === 'string' && candidate.name !== '') return true
  return candidate.ctx !== null && typeof candidate.ctx === 'object'
}

/**
 * 从工具事件 payload 里尽力取一个「发起调用的 agent」；取不到返回 `undefined`。
 *
 * 只认**已实测**的三种形状（AGENTS §4 / commit 5b47746）：
 *  1. `exec` 本身（`exec.agent?: Agent { readonly id }`）；
 *  2. `{ exec }` 包装（监听器签名 `(exec, result)` 被我们自己包了一层时）；
 *  3. `{ agent }`（宿主别的 emit 事件把 agent 直接挂在根上时）。
 *
 * **不猜字段名**：宿主形状里没有 `sender` / `owner` 这类同义词，猜错会把推进记到别人头上，
 * 表现是「A 的调用救了 B 的停滞」——比漏记一次更糟。
 */
export function agentOfToolEvent(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return undefined
  const root = payload as Record<string, unknown>
  const candidates: unknown[] = [root.agent]
  const exec = root.exec
  if (exec && typeof exec === 'object') candidates.push((exec as Record<string, unknown>).agent)
  for (const candidate of candidates) {
    if (isAgentLike(candidate)) return candidate
  }
  return undefined
}

/**
 * 订阅「队长自己调用了工具」的结果（r11 F7 的唯一观察点）。
 *
 * 为什么订阅**根作用域**而不是 `captainAgentScopeOf(ctx)`：`ctx.agents.currentInitiator()`
 * 在 `apply` 时刻往往还是空（那是工具执行期的异步链上下文），按队长作用域注册会得到
 * 「注册时拿不到 → 一条都不记」——真机上的症状正是「面板永远没有执行痕迹」。
 * 根作用域的 `tools/result` 会收到所有 agent 的调用，所以**在监听器里按 `exec.agent`
 * 缺省过滤**：缺省即队长（与 `team/guard.ts` 的 `agentId===null → captain` 同口径），
 * 有 `agent.id` 一律按成员跳过。这样判定只有一处，也不依赖装配时机。
 *
 * 只观察、不拦截：本函数不调用 `next()`、不改任何结果；监听器异常自己吞掉并 warn。
 */
export function onCaptainToolResult(
  ctx: HostContext,
  handler: (call: { toolName: string; args: unknown }) => void,
): { stop: () => void } {
  let dispose: (() => void) | void = undefined
  try {
    dispose = subscribeHostEvent(ctx, 'tools/result', (...args: unknown[]) => {
      try {
        const exec = args[0]
        if (!exec || typeof exec !== 'object') return
        // `exec.agent` 有值 ⇒ 成员调用，不是队长亲手写。
        if (agentOfToolEvent(exec) !== undefined) return
        const row = exec as { name?: unknown; arguments?: unknown }
        if (typeof row.name !== 'string' || row.name === '') return
        handler({ toolName: row.name, args: row.arguments })
      } catch (error) {
        // AC-23：留痕链上的任何异常都不得改变工具结果，也不得抛回宿主事件总线。
        ctx.logger?.warn?.(`[auto-team] 队长留痕处理失败（已忽略，不影响工具结果）：${messageOf(error)}`)
      }
    })
  } catch (error) {
    ctx.logger?.warn?.(`[auto-team] 订阅 tools/result 失败（队长留痕不生效）：${messageOf(error)}`)
  }
  return {
    stop() {
      try {
        dispose?.()
      } catch {
        /* disposer 失败不影响其余清理 */
      }
    },
  }
}

/**
 * 订阅「成员有实质产出」的信号，回调里带 agent 与时刻（AC-9 的第二个数据来源）。
 *
 * 事件选择：只用 **emit** 类事件，绝不订阅 waterfall（`tools/execute` 必须调 `next()`，
 * 漏调会吞掉工具执行、改错信号会破坏取消链 —— AGENTS §4 的硬约定）。
 *  - L1 `tools/result`：`(exec, result)`，`exec.agent` 是发起者，宿主在 agent 作用域注册时
 *    按 `exec.agent` 过滤；
 *  - L2 `agent/status`：兜底。万一宿主把 `tools/result` 过滤在本成员作用域内、根作用域收不到，
 *    状态变化仍能给出推进信号（两者都注册，去重交给 `touchProgress`：同一时刻多记一次无副作用）。
 *
 * 降级：宿主没有 `ctx.on` 时 **warn 并返回空 stop**，绝不抛错 —— 停滞判定会退化成
 * 「以 `binding.spawnedAt` 为基线」，仍然会在成员真的不动时告警（L3 的语义）。
 */
export function onMemberProgress(
  ctx: HostContext,
  handler: (info: { agent: unknown; at: number }) => void,
): { stop: () => void } {
  if (typeof ctx.on !== 'function' && typeof ctx.root?.on !== 'function') {
    ctx.logger?.warn?.('[auto-team] 宿主未提供 ctx.on：停滞判定降级为「以派发时间为基线」')
    return { stop() {} }
  }
  const disposers: Array<() => void> = []

  const subscribe = (event: string, agentOf: (args: unknown[]) => unknown): void => {
    try {
      const dispose = subscribeHostEvent(ctx, event, (...args: unknown[]) => {
        try {
          const agent = agentOf(args)
          if (agent === undefined) return
          handler({ agent, at: Date.now() })
        } catch (error) {
          // 监听器异常会被宿主隔离，但我们的 handler 里还有 store 写入，自己兜一层更清楚。
          ctx.logger?.warn?.(`[auto-team] 推进事件处理失败（${messageOf(error)}）`)
        }
      })
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      ctx.logger?.warn?.(`[auto-team] 订阅 ${event} 失败（${messageOf(error)}）`)
    }
  }

  subscribe('tools/result', (args) => agentOfToolEvent(args.length > 1 ? { exec: args[0] } : args[0]))
  subscribe('agent/status', (args) => agentOfToolEvent(args[0] ?? args))

  return {
    stop() {
      while (disposers.length > 0) {
        const dispose = disposers.pop()
        try {
          dispose?.()
        } catch {
          /* 单个 disposer 失败不影响其余清理 */
        }
      }
    },
  }
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

/**
 * 成员身份（双通道）：名字用于消息展示与对账，id 用于续聊/中断。
 *
 * 新宿主（0.2.2-rc.2）：`subagents.namesOf(agent)` 给出模型可见名（从 root 起的斜杠路径，
 * root 是 `'lead'`），取最后一段当名字；id 直接用 `agent.id`（就是 SessionId）。
 * 旧宿主：`agentTeams.tryMembership(agent)` 已移除，仅在方法仍在时作兜底。
 * 两者都拿不到 → 退回 agent 自身字段；绝不臆造名字（名字是消息路由与恢复重绑的键）。
 */
export function memberIdentityOf(ctx: HostContext, agent: unknown): { id: string; name: string } {
  let id = ''
  let name = ''
  const own = agent as { id?: unknown; name?: unknown } | null | undefined
  try {
    const named = readServiceQuietly(ctx, 'subagents')?.namesOf?.(agent)
    const path = typeof named?.name === 'string' ? named.name : ''
    if (path !== '') name = path.split('/').pop() ?? ''
    if (typeof own?.id === 'string') id = own.id
  } catch {
    /* namesOf 抛错 → 继续走旧通道 / 自身字段 */
  }
  if (id === '' || name === '') {
    try {
      const membership = ctx.agentTeams?.tryMembership?.(agent) as { id?: unknown; name?: unknown } | undefined
      if (membership && typeof membership === 'object') {
        if (id === '' && typeof membership.id === 'string') id = membership.id
        if (name === '' && typeof membership.name === 'string') name = membership.name
      }
    } catch {
      /* 非 Team 子 agent 会返回 undefined；抛错同样视为拿不到 */
    }
  }
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
  if (!ctx.on && !ctx.root?.on) {
    ctx.logger?.warn?.('[auto-team] 宿主未提供事件订阅，成员将按 provider 默认模型运行')
    return false
  }
  try {
    // 事件订阅统一走 subscribeHostEvent（root + global），详见该函数注释里的 r13 真机事故。
    // 这里不再保存 disposer：宿主随 entry 卸载一起回收，单测里用 fake ctx 也不做清理断言。
    subscribeHostEvent(ctx, 'agent/created', (payload: unknown) => {
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

/* ------------------------------------------------------------------ *
 * r5 增量：四个新宿主触点（AGENTS §4：宿主形状只允许出现在本文件）
 *
 *   registerToolGuard    `tools/execute`（**waterfall**）—— 队长 noWait 守卫的唯一绑定点
 *   onHostTriggerEvents  `agent/status` / `subagent/end` / `agent/error` / `tools/result`（emit）
 *                        —— Trigger 侧**唯一**读取宿主 payload 的地方（team/trigger.ts 只收归一化量）
 *   captainAgentScopeOf  主 session 的事件作用域（拿不到就 fail-closed，绝不假称可用）
 *   installCaptainRoute  队长模型路由下发（复用 installMemberRoute 的两条事件，不写第二套）
 *
 * 判定全部在纯模块（`team/guard.ts`）里；这里只做「宿主形状 → 纯函数入参」的翻译，
 * 因此本文件的新增部分没有任何可被 AC-4/AC-6 误判的业务规则。
 * ------------------------------------------------------------------ */

/** 守卫判定入参：宿主 `exec` 里只取这三样（`ToolExecutionInput` 形状见 AGENTS §4 实测）。 */
export interface ToolGuardRequest {
  toolName: string
  args: unknown
  /** `exec.agent?.id`；主 session **可能不给**（U4）→ `null`，调用方据此按「队长」判。 */
  agentId: string | null
}

/**
 * 守卫短路返回（U1 的 L1 形状）。
 *
 * 只保证两件可读的事：`code`（机器可判）与 `message`（模型可读的下一步）。
 * 不臆造宿主的 tool-result 结构 —— 那正是 U1 未实测的部分。
 */
export interface ToolGuardRejection {
  ok: false
  code: string
  message: string
  command?: string
}

/**
 * 队长 noWait 守卫的宿主绑定（AC-4 的唯一执行点）。
 *
 * **放行分支必须 `next()`**：`tools/execute` 是 waterfall，漏调就把这次工具执行吞掉
 * （模型看到「什么都没发生」，比被拒绝更难排查）。因此这里只有两条出口：
 *   - 放行 → `next()`（原样交回下游）；
 *   - 拒绝 → **不调** `next()`，直接返回拒绝对象（waterfall 短路）。
 *
 * 三级降级写死在这里（U1：短路返回形状未在真实宿主实测）：
 *   - L1（本实现）：返回 `ToolGuardRejection`，命令不执行，模型收到 code + message；
 *   - L2（L1 形状若被宿主拒收时的退路）：把拒绝分支改成 `throw new Error(verdict.message)`，
 *     命令同样不执行，模型看到的是错误而不是结果对象；
 *   - L3（`ctx.on` 不存在 / 订阅直接抛错）：不注册守卫，warn 一次，降级为提示词自律
 *     —— QA-REPORT 必须记为「未验证」，**不得**算 AC-4 通过。
 *
 * 失败模式一律 fail-open：判定异常、入参形状不认识、非 bash 工具都**放行**。
 * 守卫的误杀代价（拦住队长正常工作）远高于漏拦一次（anti-goal 1）。
 */
export function registerToolGuard(
  ctx: HostContext,
  decide: (request: ToolGuardRequest) => GuardVerdict,
): () => void {
  const hasEvents = typeof ctx.on === 'function' || typeof ctx.root?.on === 'function'
  if (!hasEvents) {
    // L3：宿主没有事件订阅能力 → 守卫装不上，只剩提示词里的硬约束。
    ctx.logger?.warn?.('[auto-team] 宿主未提供 ctx.on：noWait 守卫未装配，队长仍可能前台同步长等待')
    return () => {}
  }

  const listener = (...args: unknown[]): unknown => {
    const next = args[args.length - 1]
    const nextFn = typeof next === 'function' ? (next as (...rest: unknown[]) => unknown) : null
    const request = guardRequestOf(args[0])

    // ⚠️ 形状不认识 → 放行。注意 `next()` **不能**包在下面那个 try 里：
    // 下游工具自身的异常会被当成「判定异常」再调一次 next，于是同一条命令执行两次。
    if (request === null) return nextFn === null ? undefined : nextFn()

    let verdict: GuardVerdict | undefined
    try {
      verdict = decide(request)
    } catch (error) {
      ctx.logger?.warn?.(`[auto-team] noWait 守卫判定异常，本次放行（${messageOf(error)}）`)
      return nextFn === null ? undefined : nextFn()
    }
    if (verdict === undefined || verdict.allow !== false) {
      return nextFn === null ? undefined : nextFn()
    }

    // L1 短路：不调 next()。命令不执行，模型拿到可读原因码 + 下一步建议。
    const rejection: ToolGuardRejection = {
      ok: false,
      code: verdict.code,
      message: verdict.message,
      command: verdict.command,
    }
    return rejection
  }

  try {
    // 统一走 subscribeHostEvent（root + global）：作用域过滤会让我们收不到队长的工具执行
    // （r13 真机事故：守卫在真机上一次都没触发）。global 后成员调用也会进来，
    // 但 listener 里的 agentId 非空即放行，不会影响成员。
    const dispose = subscribeHostEvent(ctx, 'tools/execute', listener)
    return typeof dispose === 'function'
      ? () => {
          try {
            dispose()
          } catch {
            /* 已释放 */
          }
        }
      : () => {}
  } catch (error) {
    // L3：订阅本身失败（宿主不认这个事件）→ 不假装守卫存在。
    ctx.logger?.warn?.(`[auto-team] noWait 守卫订阅失败，队长仍可能前台同步长等待（${messageOf(error)}）`)
    return () => {}
  }
}

/** 从 `tools/execute` 的第一个入参取 `{name, arguments, agent}`；形状不认识返回 `null`（→ 放行）。 */
function guardRequestOf(payload: unknown): ToolGuardRequest | null {
  const exec = toolExecutionOf(payload)
  if (exec === null) return null
  const name = (exec as { name?: unknown }).name
  if (typeof name !== 'string' || name === '') return null
  const agent = (exec as { agent?: unknown }).agent
  const id = agent !== null && typeof agent === 'object' ? (agent as { id?: unknown }).id : undefined
  return {
    toolName: name,
    args: (exec as { arguments?: unknown }).arguments,
    // U4：主 session 的 `exec.agent` 是否为 undefined 未实测 —— 拿不到就当 `null`（= 队长）。
    agentId: typeof id === 'string' && id !== '' ? id : null,
  }
}

/** 工具执行对象：`exec` 本身，或被我们自己包成 `{ exec }` 的形态（与 agentOfToolEvent 同一口径）。 */
function toolExecutionOf(payload: unknown): unknown | null {
  if (payload === null || typeof payload !== 'object') return null
  const wrapped = (payload as { exec?: unknown }).exec
  if (wrapped !== null && wrapped !== undefined && typeof wrapped === 'object') return wrapped
  return payload
}

/** 订阅的四类宿主事件（顺序即订阅顺序，测试按此断言）。 */
export const TRIGGER_EVENT_NAMES = ['agent/status', 'subagent/end', 'agent/error', 'tools/result'] as const

export type TriggerEventName = (typeof TRIGGER_EVENT_NAMES)[number]

/** 事件订阅结果：`degraded` 供装配层调 `bus.setEventSource(false)`（AC-18 的可读降级）。 */
export interface TriggerEventSubscription {
  stop(): void
  degraded: boolean
}

/**
 * 订阅四类宿主事件 → Trigger 归一化（AC-12 的唯一 payload 读取点）。
 *
 * 与 `onMemberProgress` 的分工：那个只管「成员有实质产出」（停滞判定的基线），
 * 这个只把**事件原样**交给 handler，判定口径（去重/幂等/该不该推进）在 `team/trigger.ts`。
 *
 * 语义：`tools/result` 的监听签名是 `(exec, result)`，这里统一包成 `{ exec, result }`
 * 具名对象再交出去 —— 消费侧不必再记参数位序；其余三类单参事件原样传 payload。
 *
 * 降级（U2：四个事件的名字/payload 形状未在真实宿主实测）：
 *   - 任一事件订阅抛错 → `degraded: true` + warn，其余事件照常订阅（少一路不等于全废）；
 *   - `ctx.on` 完全不存在 → `degraded: true`，四类推进全部退回 `watcher.tick` 的 poll 通路，
 *     因此「事件源关闭后四类各有一次推进」仍成立（AC-18）。
 */
export function onHostTriggerEvents(
  ctx: HostContext,
  handler: (name: TriggerEventName, payload: unknown) => void,
): TriggerEventSubscription {
  if (typeof ctx.on !== 'function' && typeof ctx.root?.on !== 'function') {
    ctx.logger?.warn?.('[auto-team] 宿主未提供 ctx.on：Trigger 事件源不可用，四类推进退回轮询兜底')
    return { stop() {}, degraded: true }
  }
  const disposers: Array<() => void> = []
  let failed = 0

  for (const name of TRIGGER_EVENT_NAMES) {
    try {
      // 统一走 subscribeHostEvent（root + global）：见 r13 真机事故注释。
      const dispose = subscribeHostEvent(ctx, name, (...args: unknown[]) => {
        try {
          handler(name, payloadOfEvent(name, args))
        } catch (error) {
          // handler 里还有 store/bridge 写入；宿主虽会隔离监听器异常，自己兜一层才看得到原因。
          ctx.logger?.warn?.(`[auto-team] Trigger 事件处理失败（${name}：${messageOf(error)}）`)
        }
      })
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      failed += 1
      ctx.logger?.warn?.(`[auto-team] 订阅 ${name} 失败：该类 Trigger 退回轮询兜底（${messageOf(error)}）`)
    }
  }

  return {
    degraded: failed > 0,
    stop() {
      while (disposers.length > 0) {
        const dispose = disposers.pop()
        try {
          dispose?.()
        } catch {
          /* 单个 disposer 失败不影响其余清理 */
        }
      }
    },
  }
}

/** 根作用域 `session/event` 订阅结果；`degraded` 供装配层如实标注「用量不可得」。 */
export interface SessionEventSubscription {
  stop(): void
  degraded: boolean
}

/**
 * 订阅根作用域 `session/event`（后提交追加流，r13 AC-3 的用量事件源）。
 *
 * 为什么不在这里解析字段：payload 形状**未实测**（U1），归一化全部交给纯函数
 * `team/usage.ts` 的 `usageOfSessionEvent`（可单测、可 fail-open）；本文件只负责订阅本身。
 *
 * fail-open 语义（与 `onHostTriggerEvents` 同一纪律）：
 *   - `ctx.on` 不存在 → warn + `degraded: true`，用量显示「不可得」，装配继续；
 *   - 订阅抛错 → warn + `degraded: true`，绝不冒泡到 entry（否则整条插件不激活）；
 *   - 监听器内 handler 抛错 → warn，不影响宿主事件链（宿主虽隔离，自己兜一层才看得到原因）。
 */
export function onSessionEvents(
  ctx: HostContext,
  handler: (payload: unknown) => void,
): SessionEventSubscription {
  if (typeof ctx.on !== 'function' && typeof ctx.root?.on !== 'function') {
    ctx.logger?.warn?.('[auto-team] 宿主未提供 ctx.on：session/event 不可用，token 用量显示「不可得」')
    return { stop() {}, degraded: true }
  }
  let dispose: (() => void) | void
  try {
    // 统一走 subscribeHostEvent（root + global）：r13 真机事故的正面修复。
    dispose = subscribeHostEvent(ctx, 'session/event', (...args: unknown[]) => {
      try {
        handler(args.length <= 1 ? args[0] : args)
      } catch (error) {
        ctx.logger?.warn?.(`[auto-team] 用量事件处理失败（session/event：${messageOf(error)}）`)
      }
    })
  } catch (error) {
    ctx.logger?.warn?.(`[auto-team] 订阅 session/event 失败：token 用量显示「不可得」（${messageOf(error)}）`)
    return { stop() {}, degraded: true }
  }
  return {
    degraded: false,
    stop() {
      if (typeof dispose !== 'function') return
      try {
        dispose()
      } catch {
        /* 单个 disposer 失败不影响清理 */
      }
    },
  }
}

/** 事件 payload 归一化：只做「参数位序 → 具名对象」，不解析业务字段（U2 未实测，读字段等于猜）。 */
function payloadOfEvent(name: TriggerEventName, args: unknown[]): unknown {
  if (name === 'tools/result') return { exec: args[0], result: args[1] }
  if (args.length === 1) return args[0]
  if (args.length === 0) return undefined
  return args
}

/**
 * 主 session（队长）的 agent：只走**已实测**通道 `ctx.agents.currentInitiator()`。
 *
 * apply 期这个值通常是 `undefined`（它只在工具执行期有值），所以队长模型能力位
 * 今天几乎必然是 `unsupported` —— 这正是 U3 未验证时的诚实结果（anti-goal 5：不假称生效）。
 * 任何宿主侧异常都吞掉返回 `null`：能力位缺失只能让「模型没生效」显示出来，不能拖垮装配。
 */
function captainAgentOf(ctx: HostContext): unknown | null {
  try {
    const agent = ctx.agents?.currentInitiator?.()
    return agent ?? null
  } catch {
    return null
  }
}

/**
 * 主 session 的事件作用域（`agent.ctx` 形状）。
 *
 * 与 `installCaptainRoute` 必须同源（同一个 `captainAgentOf`）：先探测后安装，
 * 否则会出现「探测说能装、安装拿不到」的自相矛盾状态。
 */
export function captainAgentScopeOf(ctx: HostContext): unknown | null {
  return agentContextOf(captainAgentOf(ctx))
}

/**
 * 把队长模型路由装到主 session 的 `agent.ctx` 上（AC-2 / AC-3 的唯一生效路径）。
 *
 * 语义与成员路由**完全一致**（`system-prompt/assemble` 记录本轮生效值 + `agent/request`
 * 改写调用配置并剔除继承的 `reasoningEffort`），因此直接复用 `installMemberRoute`，
 * 不再写第二套改写实现（同一类风险只留一道实现）。
 *
 * 返回 `null` = 拿不到主 session 作用域 → 调用方落 `unsupported` 并回显配置，**不假装生效**。
 */
export function installCaptainRoute(ctx: HostContext, route: RoleModelRoute): (() => void) | null {
  const agent = captainAgentOf(ctx)
  if (agent === null) return null
  return installMemberRoute(agent, route)
}
