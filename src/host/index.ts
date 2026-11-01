/**
 * 宿主插件入口（Cordis）。
 *
 * 顶层的三条硬纪律（AC-8 / AC-9）：
 *   1. 不在模块顶层访问 `ctx.*`、不读文件、不 throw —— 任何失败都必须发生在 apply 之内且被兜住；
 *   2. 任一部分装配失败不影响其余部分（面板至少能亮、工具至少能报「未就绪」）；
 *   3. `node --input-type=module -e "await import('./lib/index.js')"` 必须干净退出。
 *
 * 这里是**唯一装配点**：把 bridge 的三个编排端口（dispatch / resume / receipt）接到
 * `team/dispatch.ts` 的真实实现上，并启动成员存活对账轮询。工具与 HTTP 面板共用同一个
 * `bridge.act`，所以「工具能用、面板不能」这类历史缺陷不会从装配层长出来。
 */
import { homedir } from 'node:os'
import { NOWAIT_THRESHOLD_MS } from './config.ts'
import { globalDataRoot, projectArtifactsDir, projectMemoryDir, publicMemoryDir, rolesDir, runsDir, settingsPath, skillsDir } from './paths.ts'
import { RunsStore, type RunState } from './store.ts'
import { createRoleRepo } from './roles/repo.ts'
import { createSettingsRepo } from './settings.ts'
import {
  createBridge,
  type ApplyReceiptPort,
  type Bridge,
  type DispatchPort,
  type ResumePort,
  type SendPort,
} from './bridge.ts'
import {
  captainAgentScopeOf,
  createRoutePorts,
  createSpawnPorts,
  installCaptainRoute,
  listHostMembers,
  memberIdentityOf,
  onHostTriggerEvents,
  onMemberProgress,
  registerAgentCreated,
  registerEffect,
  registerToolGuard,
  resolveConcurrencyLimit,
  type HostContext,
} from './adapters.ts'
import { registerTools, type ToolsDeps } from './tools.ts'
import { registerCaptainPrompt } from './prompt.ts'
import { registerHttpBridge } from './http.ts'
import {
  applyReceipt,
  dispatchReady,
  resumeRun,
  type PromptInput,
  type SpawnPort,
} from './team/dispatch.ts'
import { createMemberWatcher } from './team/watcher.ts'
import { touchProgress } from './team/stall.ts'
import { auditRoute } from './team/route.ts'
import { buildMemberPrompt } from './team/member-prompt.ts'
// r5 四个纯模块（判定都在里面，装配层只接线，不重写规则）
import { guardOf } from './team/guard.ts'
import { createTriggerBus, type TriggerBus } from './team/trigger-bus.ts'
import { readCaptainModel, captainModelView } from './team/captain.ts'
import { triggerFromMemberExit } from './team/trigger.ts'
import { createExpander } from './memory/expand.ts'
import type { CaptainModelView } from '../shared/types.ts'

export const name = 'auto-team'

/**
 * 硬依赖声明（cordis 的 `inject` 数组 = 全部 required；写入入口才与宿主加载顺序对齐）。
 *
 * 铁律：每个名字都必须对应源码里的一处 `ctx.<name>` 裸访问。漏声明的后果**不是功能降级**，
 * 而是整条 entry 不激活（`dsh: warning: 1 entry did not activate` +
 * `cannot get property "x" without inject`），真机上表现为「工具在、面板永远不出现」。
 * 名单的唯一判据是 `test/host-contract.test.ts`（刻意双写：这里实现、那里断言，不许第三处抄写）。
 *
 * 可选服务 `webServer` / `llm` / `agentDefaultModel` **不许**出现在这里：它们只能经
 * `adapters.optionalService()` 走 `ctx.get` 读取（缺失时降级，不能拖垮整条 entry）。
 */
export const inject = ['tools', 'systemPrompt', 'agents', 'agentTeams']

/** 队长提示词里的会话标识：单会话 profile 下用 'current' 与实际工具调用元信息对齐。 */
const DEFAULT_SESSION = 'current'

export function apply(ctx: HostContext, options?: { workspace?: string }): void {
  const home = homedir()
  const workspace = options?.workspace ?? process.cwd()
  const dataRoot = globalDataRoot(home)
  const now = (): number => Date.now()

  const store = new RunsStore(runsDir(home))
  const roles = createRoleRepo({ dir: rolesDir(home), skillsDir: skillsDir(home), now })

  /**
   * 设置仓储（r7 AC-13）：`settings.json` 是**唯一**可配参数写入点，路径由
   * `paths.settingsPath(home)` 单点推导（真机 = `~/.dsh/auto-team/settings.json`）。
   *
   * 文件缺失时 `read()` 返回缺省值且**不建文件**（首启不落盘，避免把缺省值冻成用户的设置）；
   * 内容损坏/非法时回落缺省并 warn —— 设置坏了不能拖垮整条 entry。
   */
  const settingsRepo = createSettingsRepo({ file: settingsPath(home), now, warn: (text) => warn(ctx, text) })

  // seed 失败不阻断装配（例如只读 home）：面板会显示「无角色」而工具仍可报错说明原因。
  try {
    roles.seed()
  } catch (error) {
    warn(ctx, `角色库初始化失败：${messageOf(error)}`)
  }

  const memoryRoots = { publicDir: publicMemoryDir(home), projectDir: projectMemoryDir(workspace) }
  const artifactsDir = projectArtifactsDir(workspace)
  const spawnPorts = createSpawnPorts(ctx)
  const routePorts = createRoutePorts(ctx)

  /**
   * 记忆展开端口（AC-9）：`createExpander` 需要读盘但不需要宿主 API，所以这里只把两个根目录喂进去。
   *
   * 初始化失败（目录不可用等）→ `null`：`bridge.expandMemory` 会明确报「不可用」，
   * 工具调用面不会崩，注入侧的内联索引照常工作（只是展不开）。
   */
  let expander: ReturnType<typeof createExpander> | null = null
  try {
    expander = createExpander({ roots: memoryRoots })
  } catch (error) {
    warn(ctx, `记忆展开端口不可用（内联索引仍会注入，但无法按 ID 展开）：${messageOf(error)}`)
  }

  /** 宿主成员名单（做成方法而不是快照：每次对账都取当时的事实，不用缓存的旧名单）。 */
  function listMembers(): ReturnType<typeof listHostMembers> {
    return listHostMembers(ctx)
  }

  function hostConcurrency(): { limit: number; source: 'host' | 'default' } {
    const host = resolveConcurrencyLimit(ctx)
    // AC-13 生效点①：设置是**天花板**，不替代宿主约束 —— 宿主给的更小就以宿主为准，
    // 否则「设置 8」会让面板宣称能跑 8 个而宿主只肯给 3 个（并发越权 + 面板说谎）。
    const cap = settingsRepo.read().concurrencyLimit
    return host.limit <= cap ? host : { limit: cap, source: host.source }
  }

  /**
   * 成员 prompt 的拼装本体已搬到纯模块 `team/member-prompt.ts`（AC-10 的独立探针必须
   * import 到**真实**实现才能证明「技能正文真的进了 spawn prompt」）；装配层只留这一行委托，
   * 旧的拼装片段整段删除，避免同一份文案出现两个来源。
   */
  function buildPrompt(input: PromptInput): string {
    return buildMemberPrompt(input, { memoryFor: (goal: string) => bridge.memoryFor(goal) })
  }

  // 成员名由 dispatch 决定（`<roleId>-<taskId>`，确定性，AC-17 的幂等地基）；
  // 这里只把「计划里的任务」翻译成宿主的 spawn 请求，不再自己起名。
  const spawn: SpawnPort = (input) =>
    spawnPorts.spawn({
      prompt: input.prompt,
      name: input.name,
      route: input.role?.model,
      sessionId: input.plan.sessionId,
      taskId: input.task.id,
    })

  /** 派发端口：并发切片、角色缺失拒绝、幂等复用、逐角色模型预校验都在 dispatchReady 里。 */
  const dispatch: DispatchPort = async (state: RunState) => {
    const result = await dispatchReady(state, {
      store,
      spawn,
      roles,
      buildPrompt,
      listMembers,
      routePort: routePorts,
      sendMessage: spawnPorts.sendMessage,
      hostConcurrency,
      now,
    })
    // renamed 必须显式投影：bridge 是编排接口层，漏了这一行会「编译通过但面板永远不提示改名」（TECHNICAL §2.5）。
    return {
      started: result.started,
      skipped: result.skipped,
      errors: result.errors,
      renamed: result.renamed,
    }
  }

  /** 恢复端口：只处理 running/gate/interrupted，重复调用必须幂等（AC-17）。 */
  const resume: ResumePort = async (state: RunState) => {
    const result = await resumeRun(state, { store, listMembers, sendMessage: spawnPorts.sendMessage, now })
    return { resumed: result.resumed, skipped: result.skipped, unchanged: result.unchanged }
  }

  /** 回执端口：`done` 的唯一写点（AC-19），门禁证据由 bridge 传入。 */
  const applyReceiptPort: ApplyReceiptPort = (state, taskId, receipt, at, maxAttempts) =>
    applyReceipt(state, taskId, receipt, at, maxAttempts)

  const sendMessage: SendPort = (memberId, text) => spawnPorts.sendMessage(memberId, text)

  /**
   * 队长模型投影（AC-2 / AC-3）：**配置位与能力位分开**。
   *
   * - 配置（`<dataRoot>/captain.json`）永远读并回显——用户写了什么就一定看得见；
   * - 能力位只认实测：`captainAgentScopeOf` 拿不到主 session 的作用域、或 `installCaptainRoute`
   *   返回 null，就落 `unsupported`。绝不因为「配置存在」就宣称生效（anti-goal 5）。
   */
  let captainView: CaptainModelView = captainModelView(null, 'unsupported')
  /** 当前装上的队长路由撤销函数（重装时先撤销，避免改两次设置叠两个路由）。 */
  let captainUndo: (() => void) | null = null
  /** 卸载清理钩子只注册一次（`registerEffect` 每多注册一个都会让装配面多一条清理）。 */
  let captainCleanupRegistered = false

  /**
   * 队长模型装配（r7 改造）：**`settings.json` 是唯一写入点**，既有 `<dataRoot>/captain.json`
   * 降级为迁移期只读回落 —— 否则「设置页改了不生效」或「两边各说一套」必犯其一。
   *
   * - 配置位与能力位仍然分开：配置永远回显，能力位只认实测（`captainAgentScopeOf` /
   *   `installCaptainRoute` 任一拿不到就 `unsupported`），绝不因「配置存在」宣称生效。
   * - 可重入：保存设置后由 `onSettingsSaved` 再调一次，旧路由先撤销。
   */
  function syncCaptainRoute(): void {
    try {
      const fromSettings = settingsRepo.read().captainModel ?? null
      const route = fromSettings ?? readCaptainModel(dataRoot)
      captainUndo?.()
      captainUndo = null
      let capability: 'ok' | 'unsupported' = captainAgentScopeOf(ctx) === null ? 'unsupported' : 'ok'
      if (route !== null && capability === 'ok') {
        const undo = installCaptainRoute(ctx, route)
        if (undo === null) {
          capability = 'unsupported'
          warn(ctx, `队长模型 ${route.provider}/${route.model} 未生效：宿主未提供可安装的主 session 作用域`)
        } else {
          captainUndo = undo
          // 清理钩子**只在真有路由装上时**注册一次：没装路由的宿主不该多一条空清理
          // （`test/wire.test.ts` 断言装配面 effect 条数，也顺带把「无配置不多挂」钉住）。
          if (!captainCleanupRegistered) {
            captainCleanupRegistered = true
            registerEffect(ctx, () => {
              captainUndo?.()
              captainUndo = null
            })
          }
        }
      }
      captainView = captainModelView(route, capability)
      if (route !== null && capability === 'ok') {
        ctx.logger?.info?.(`[auto-team] 队长模型已生效：${route.provider}/${route.model}`)
      }
    } catch (error) {
      warn(ctx, `队长模型装配失败（面板显示未生效）：${messageOf(error)}`)
      captainView = captainModelView(null, 'unsupported')
    }
  }

  syncCaptainRoute()

  /**
   * Trigger 总线（AC-13~AC-18）：判定与记账在这里，推进仍然只有 `bridge.act` 一个出口。
   *
   * 先声明后赋值是为了打破环：快照要读总线健康度（`triggerHealth`），总线又需要 bridge。
   */
  let bus: TriggerBus | null = null

  /**
   * 成员对账 watcher 句柄（r7 起可重建）：停滞阈值与返工上限来自 settings，
   * 用户保存设置后必须按新阈值重建，否则「改了不生效」只能靠重启治。
   * 重建只碰 watcher 自己的表（先 stop 再 start），全仓定时器仍然只有一处。
   */
  let watcherRef: ReturnType<typeof createMemberWatcher> | null = null

  function startWatcher(): void {
    watcherRef?.stop()
    const settings = settingsRepo.read()
    watcherRef = createMemberWatcher({
      store,
      listMembers,
      now,
      // AC-13 生效点④：停滞阈值从设置读（缺省 = config.STALL_MS，值不变）。
      stallMs: settings.stallMs,
      // AC-13 生效点⑤：返工上限同样可配（缺省 = config.MAX_ATTEMPTS）。
      maxAttempts: settings.maxAttempts,
      // Trigger 轮询兜底（AC-18/AC-20）：挂在既有 1500ms tick 上，不新增 setInterval。
      onPoll: async (state) => {
        if (bus === null) return
        await bus.poll(state)
      },
    })
    watcherRef.start()
  }

  const bridge = createBridge({
    store,
    roles,
    memoryRoots,
    dataRoot,
    dispatch,
    resume,
    applyReceipt: applyReceiptPort,
    sendMessage,
    // 门禁超时（AC-13 生效点②）**不在这里传**：缺省时 bridge 取 `settings.gateTimeoutMs`
    // （其缺省正是 GATE_TIMEOUT_MS），设置才能立刻生效；这里硬塞常量会把可配点做废。
    gate: { cwd: workspace, artifactsDir },
    hostConcurrency,
    // 停滞阈值同理**不传**：bridge 每次快照按 settings 现算，面板与 watcher 同源同值。
    now,
    captainModel: () => captainView,
    settingsRepo,
    // 保存设置后的两个重生效动作：队长路由重装 + watcher 按新阈值重建。
    // 回调在 bridge 里被 try/catch 包住 —— 保存已落盘，这里出错只降级成 notice。
    onSettingsSaved: () => {
      syncCaptainRoute()
      startWatcher()
    },
    // 未装配总线 = 没有任何事件源可用：如实报降级，面板可见（AC-18）。
    triggerHealth: () =>
      bus === null ? { degraded: true, reason: 'Trigger 总线未装配，推进只剩轮询兜底' } : bus.health(),
    ...(expander === null ? {} : { expander: (id: string, depth?: number) => expander!.expand(id, depth) }),
  })

  try {
    bus = createTriggerBus({ store, bridge, now })
  } catch (error) {
    warn(ctx, `Trigger 总线启动失败（四类事件不再自动推进，面板显示降级）：${messageOf(error)}`)
  }

  // ① 工具：队长用它拆解/派发/查状态/发消息/读写记忆与角色（7 个 auto_team_*）
  try {
    const toolsDeps: ToolsDeps = { store, roles, bridge, now }
    registerTools(ctx, toolsDeps)
  } catch (error) {
    warn(ctx, `工具注册失败：${messageOf(error)}`)
  }

  // ② 队长常驻提示词：没有它队长不会主动「先出计划再派发」
  try {
    registerCaptainPrompt(ctx, { bridge }, DEFAULT_SESSION)
  } catch (error) {
    warn(ctx, `提示词注入失败：${messageOf(error)}`)
  }

  // ③ 面板数据桥（GET snapshot / GET memory / POST act）
  try {
    registerHttpBridge(ctx, { bridge, defaultSessionId: () => DEFAULT_SESSION })
  } catch (error) {
    warn(ctx, `面板桥注册失败：${messageOf(error)}`)
  }

  // ④ 事件 → 推进时间：宿主事件**只记录** lastProgress，不做任何判定。
  //    判定只剩 watcher.tick 一个出口（AC-8 的结构保证：事件一条 + 轮询一条这种叠加从结构上不可能发生）。
  try {
    const progressSub = onMemberProgress(ctx, ({ agent, at }) => {
      try {
        // 宿主形状解析只在 adapters 里（AGENTS §4）：这里只拿 id/name，不摸 exec/status 字段。
        const identity = agent === undefined ? undefined : memberIdentityOf(ctx, agent)
        if (!identity) return
        for (const summary of store.list()) {
          const state = store.load(summary.runId)
          if (!state) continue
          const hit = state.bindings.find(
            (binding) => binding.retired !== true && (binding.memberId === identity.id || binding.name === identity.name),
          )
          if (!hit) continue
          store.save({ ...state, progress: touchProgress(state.progress, hit.memberId, at) })
        }
      } catch (error) {
        // 事件处理异常绝不能冒泡到宿主工具执行链（AC-9）：记一条 warn 就够。
        warn(ctx, `推进记录失败：${messageOf(error)}`)
      }
    })
    registerEffect(ctx, () => progressSub.stop())
  } catch (error) {
    warn(ctx, `成员推进事件订阅失败：${messageOf(error)}`)
  }

  // ⑤ noWait 守卫（AC-4）：只看队长的 bash 调用，拒绝前台同步长等待。
  //    判定在纯模块 team/guard.ts（可单测、可变异自检），这里只把宿主的 agentId 翻译成角色：
  //    `null` = 根/队长（宿主在主 session 可能不给 exec.agent，见 U4），其余一律按成员放行。
  try {
    const stopGuard = registerToolGuard(ctx, (request) =>
      guardOf({
        role: request.agentId === null ? 'captain' : 'member',
        toolName: request.toolName,
        args: request.args,
      }),
    )
    registerEffect(ctx, stopGuard)
  } catch (error) {
    // 守卫缺失的失败模式必须是「少拦一次」：记 warn，队长的提示词约束仍然在。
    warn(ctx, `noWait 守卫未装配（队长仍可能前台同步长等待）：${messageOf(error)}`)
  }

  // ⑥ 四类宿主事件 → Trigger（AC-13/AC-18）：事件是 push 型，零定时器、零模型调用。
  //    推进语义仍然只走 bridge.act（在总线里），这里只把「谁退出了」交给总线判定。
  try {
    const subscription = onHostTriggerEvents(ctx, (eventName, payload) => {
      try {
        // 只认「成员终结」两类事件：`agent/status` 里混着 running 心跳（④ 用它记 lastProgress），
        // 拿它当退出会产出大量假 resume；`tools/result` 是工具结果，门禁证据走 receipt 同步路径。
        // U2 未实测字段路径 —— 少认一种事件就少一份假信号，其余三类由总线 poll 兜底（AC-18）。
        if (eventName !== 'agent/error' && eventName !== 'subagent/end') return
        if (bus === null) return
        const ids = payloadIdsOf(payload)
        if (ids.size === 0) return
        const at = now()
        for (const summary of store.list()) {
          const state = store.load(summary.runId)
          if (!state) continue
          for (const binding of state.bindings) {
            if (binding.retired === true) continue
            if (!ids.has(binding.memberId) && !ids.has(binding.name)) continue
            const trigger = triggerFromMemberExit(state.plan.runId, binding.memberId, eventName, at)
            void bus.push(trigger).catch((error: unknown) => warn(ctx, `成员退出推进失败：${messageOf(error)}`))
          }
        }
      } catch (error) {
        // 事件处理异常绝不能冒泡到宿主事件总线（AC-9）。
        warn(ctx, `Trigger 事件处理失败：${messageOf(error)}`)
      }
    })
    if (subscription.degraded) {
      // 部分事件订阅失败：如实降级，面板 header 会亮「事件源降级」，四类推进靠 poll。
      bus?.setEventSource(false)
      warn(ctx, 'Trigger 事件源降级：部分宿主事件订阅失败，四类推进退回轮询兜底')
    } else {
      bus?.setEventSource(true)
    }
    registerEffect(ctx, () => subscription.stop())
  } catch (error) {
    warn(ctx, `Trigger 事件订阅失败（推进只剩轮询兜底）：${messageOf(error)}`)
  }

  // ⑦ 运行时对账：成员存活轮询（AC-18 的反面目标只能由 host 侧发现）+ 实际路由回填（AC-22）
  try {
    startWatcher()
    // 插件卸载/宿主关闭时必须停表，否则定时器会在 ctx 已经失效后继续摸 store。
    // 经过 watcherRef 间接停：保存设置会重建 watcher，这里必须停「当前那个」而不是装配时那个。
    registerEffect(ctx, () => {
      watcherRef?.stop()
      watcherRef = null
    })

    registerAgentCreated(ctx, (payload) => {
      // 实际路由的来源有两档：
      //  ① installed —— 我们刚在该成员 agent.ctx 上装好声明路由，实际必然等于声明（AC-22 真正生效）；
      //  ② 否则用宿主自报的 model；两档都没有 ⇒ auditRoute 落 unverified（面板标「未下发」），
      //     绝不退回声明值假装生效。
      const actual = payload.installed ?? payload.model ?? null
      for (const summary of store.list()) {
        const state = store.load(summary.runId)
        if (!state) continue
        const binding = state.bindings.find(
          (item) => item.retired !== true && (item.memberId === payload.member.id || item.name === payload.member.name),
        )
        if (!binding) continue
        const role = roles.get(binding.roleId)
        const next = auditRoute(state, binding.taskId, role?.model ?? null, actual, now())
        if (next !== state) store.save(next)
      }
    })
  } catch (error) {
    warn(ctx, `运行时对账启动失败：${messageOf(error)}`)
  }

  ctx.logger?.info?.(`[auto-team] 已装配：data=${dataRoot} workspace=${workspace} artifacts=${artifactsDir}`)
}

function warn(ctx: HostContext, text: string): void {
  ctx.logger?.warn?.(`[auto-team] ${text}`)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 事件 payload 里的字符串集合（AC-12 的「不猜字段路径」做法）。
 *
 * 宿主四个事件的 payload 形状**未实测**（U2），所以这里不按 `payload.agent.id` 这类路径取值，
 * 而是把 payload 里浅层出现的字符串收成一堆，再与 store 里**已登记的** memberId / name 求交。
 * 命中即有事实依据（那个 id 是我们自己写进 bindings 的），没命中就静默跳过 —— 永不凭猜测造实体。
 */
function payloadIdsOf(payload: unknown): Set<string> {
  const ids = new Set<string>()
  const seen = new Set<object>()
  const stack: unknown[] = [payload]
  let budget = 64
  while (stack.length > 0 && budget > 0) {
    budget -= 1
    const value = stack.pop()
    if (value === null || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value as object)
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (typeof child === 'string') ids.add(child)
      else if (child !== null && typeof child === 'object') stack.push(child)
    }
  }
  return ids
}

export default { name, inject, apply }
