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
import { MODEL_CATALOG_TTL_MS, NOWAIT_THRESHOLD_MS } from './config.ts'
import { globalDataRoot, deviationsPath, projectArtifactsDir, projectMemoryDir, publicMemoryDir, rolesDir, runsDir, settingsPath, skillsDir, systemSkillsDir } from './paths.ts'
import { RunsStore, type RunState } from './store.ts'
import { createRoleRepo } from './roles/repo.ts'
import { createSkillRepo } from './roles/skills-repo.ts'
import { createSystemSkillSource } from './roles/system-skills.ts'
import { createModelCatalogCache } from './model-catalog.ts'
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
  onCaptainToolResult,
  onMemberProgress,
  onSessionEvents,
  readModelCatalog,
  canReadSessionRoute,
  readCallerRoute,
  readSessionCallCount,
  readSessionRoute,
  readSessionTokenUsage,
  readWorkspaces,
  registerAgentCreated,
  registerEffect,
  registerToolGuard,
  resolveConcurrencyLimit,
  sessionWorkspaceOf,
  watchMemberProgress,
  type HostContext,
  type HostWorkspaceEntry,
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
import { createDeviationRecorder } from './team/deviation.ts'
import { touchProgress } from './team/stall.ts'
import { auditRoute } from './team/route.ts'
import { buildMemberPrompt } from './team/member-prompt.ts'
// r5 四个纯模块（判定都在里面，装配层只接线，不重写规则）
import { guardOf } from './team/guard.ts'
import { createTriggerBus, type TriggerBus } from './team/trigger-bus.ts'
import { readCaptainModel, captainModelView } from './team/captain.ts'
import { triggerFromMemberExit } from './team/trigger.ts'
import { createExpander } from './memory/expand.ts'
import { listMemoryItems } from './memory/repo.ts'
import type { MemoryRoots } from './memory/repo.ts'
// r13 五个新模块里的三个装配点：自动派发 / 项目库缓存 / 用量记录（判定都在纯模块，这里只接线）。
import { createAutoDispatcher } from './team/auto-dispatch.ts'
import { createDispatchNotes } from './team/dispatch-notices.ts'
import { createLibraryCache, isKnownWorkspace, type LibraryDeps } from './library.ts'
import {
  applyUsage,
  createUsageDeduper,
  memberIdOf,
  usageOfSessionEvent,
  type UsageEventInput,
} from './team/usage.ts'
import type { CaptainModelView, ExpandPayload } from '../shared/types.ts'

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

  /**
   * 技能 md 仓储（r10 AC-17/AC-20）：`<home>/.dsh/auto-team/skills/<id>.md`。
   *
   * 与角色库**同一个 home 根**但独立目录、独立仓储：技能是四来源（内置/导入/系统/自建）
   * 的可编辑实体，角色是 JSON。seed 只做「缺失的内置技能铺底 / 老 md 缺 frontmatter 只前置」，
   * 因此重启永远不会覆盖用户改过的正文（AC-20 的唯一保证点）。失败只 warn，不阻断装配 ——
   * 一条坏 md 不该让整个插件不激活。
   */
  const skills = createSkillRepo({ dir: skillsDir(home), now, warn: (text: string) => warn(ctx, text) })
  try {
    skills.seed()
  } catch (error) {
    warn(ctx, `技能库初始化失败（面板技能列表可能为空）：${messageOf(error)}`)
  }

  /** 宿主系统技能库（只读 `~/.agents/skills`，r10 AC-19）：只扫不写。 */
  const systemSkills = createSystemSkillSource({ dir: systemSkillsDir(home), warn: (text: string) => warn(ctx, text) })

  /**
   * 模型清单缓存（r10 AC-16）：`PanelSnapshot` 是同步 API，宿主清单是异步的，这里握手。
   * 立即预热一次（不 await：装配期不许等宿主），失败降级成 `empty + reason`。
   */
  const modelCatalog = createModelCatalogCache({
    read: () => readModelCatalog(ctx),
    now,
    ttlMs: MODEL_CATALOG_TTL_MS,
  })
  void modelCatalog.refresh(true)

  const memoryRoots = { publicDir: publicMemoryDir(home), projectDir: projectMemoryDir(workspace) }
  const artifactsDir = projectArtifactsDir(workspace)
  const spawnPorts = createSpawnPorts(ctx)
  const routePorts = createRoutePorts(ctx)

  /**
   * 记忆展开端口（AC-9 / r22）：`createExpander` 需要读盘但不需要宿主 API。
   *
   * **不能**在 apply 时刻用 `memoryRoots` 建一次就固定 —— 那正是「记忆写错项目」的同源缺陷：
   * 展开会永远读装配目录。这里改成工厂：bridge 每次按会话/run 解析出本次的根，再传进来。
   */
  const expander = (id: string, depth: number | undefined, roots: MemoryRoots): ExpandPayload =>
    createExpander({ roots }).expand(id, depth)

  /** 宿主成员名单（做成方法而不是快照：每次对账都取当时的事实，不用缓存的旧名单）。 */
  function listMembers(): ReturnType<typeof listHostMembers> {
    return listHostMembers(ctx)
  }

  function hostConcurrency(): {
    limit: number
    source: 'host' | 'default'
    requested: number
    clamped: boolean
  } {
    const host = resolveConcurrencyLimit(ctx)
    // AC-13 生效点①：设置是**天花板**，不替代宿主约束 —— 宿主给的更小就以宿主为准，
    // 否则「设置 8」会让面板宣称能跑 8 个而宿主只肯给 3 个（并发越权 + 面板说谎）。
    const cap = settingsRepo.read().concurrencyLimit
    // R2（QA-R7-03）：夹取必须可解释 —— 把「用户填的值」与「是否被夹」一起下发，
    // 界面就能显示「设置 6 · 实际生效 3（宿主上限更小）」，而不是让数字无声地不一样。
    return host.limit <= cap
      ? { limit: host.limit, source: host.source, requested: cap, clamped: false }
      : { limit: cap, source: host.source, requested: cap, clamped: true }
  }

  /**
   * 会话工作区（门禁 cwd 的唯一解析点）。
   *
   * `apply()` 在宿主启动时只跑一次，`options.workspace ?? process.cwd()` 拿到的是宿主 profile
   * 目录而不是用户打开的仓库；会话根目录只有宿主知道 —— `agents.get(sessionId)` →
   * `agent.session.header.cwd`（同宿主 `dsh-plugin-teamflow` 的实测用法）。
   * 任何一步取不到都返回 undefined，由 bridge 回退到装配 workspace（不改变旧行为）。
   */
  function sessionWorkspace(sessionId: string): string | undefined {
    try {
      return sessionWorkspaceOf(ctx.agents?.get?.(sessionId))
    } catch {
      return undefined
    }
  }

  /**
   * 宿主工作区注册表（r19）：**每次现读**，不在 apply 时快照。
   *
   * 服务可能比本插件晚激活（apply 早期 `ctx.get` 拿不到），也可能根本不存在
   * （headless / 旧宿主）。惰性读取让「晚激活」自动变正确，「不存在」自然退回旧行为
   * （`readWorkspaces` 返回 `[]`，左栏按路径 basename 展示）。
   */
  const workspaces = (): HostWorkspaceEntry[] => readWorkspaces(ctx)

  /**
   * r22：记忆落点的会话 → 工作区解析（与 r19 的 run.project 同源）。
   *
   * 先取会话 cwd（正常会话），再按 sessionId 反查工作区注册表（agent 已卸载/旧会话）。
   * 取不到返回 undefined，由 `memoryLocationOf` 明确退化并在快照里给出原因。
   */
  function memoryWorkspaceOf(sessionId: string): string | undefined {
    const own = sessionWorkspace(sessionId)
    if (own !== undefined) return own
    try {
      return workspaces().find((entry) => entry.sessionIds.includes(sessionId))?.path
    } catch {
      return undefined
    }
  }

  /**
   * 成员 prompt 的拼装本体已搬到纯模块 `team/member-prompt.ts`（AC-10 的独立探针必须
   * import 到**真实**实现才能证明「技能正文真的进了 spawn prompt」）；装配层只留这一行委托，
   * 旧的拼装片段整段删除，避免同一份文案出现两个来源。
   */
  function buildPrompt(input: PromptInput): string {
    return buildMemberPrompt(input, {
      memoryFor: (goal: string) => bridge.memoryFor(goal, input.plan.sessionId),
      // r10 AC-29：技能正文**读盘**（不是出厂常量）—— 用户改过的内置技能必须真的进成员提示词，
      // 否则「界面上改了、成员还是老一套」是必然结果，而 AC-29 的「重启后读回」也会变成假象。
      skillBodyOf: (skillId: string) => skills.get(skillId)?.body ?? '',
    })
  }

  /**
   * 推进落盘（r32）：`progress[memberId].at` 的**唯一写点**。
   *
   * 三条纪律：
   *  1. **按 memberId 直写**，不再从 agent 反查 binding —— 旧链路靠 `namesOf(agent).name` 反查，
   *     而宿主返回的是 `self`（详见 adapters.memberIdentityOf 的注释），那条路一直是死的。
   *  2. **节流**：`PROGRESS_SAVE_MIN_MS` 内的重复信号合并成一次 `store.save`（一次 save 是
   *     整份 run JSON 的 tmp+rename），既不丢「成员在推进」的事实，也不把磁盘刷爆。
   *  3. **绝不静默**：匹配不到 binding 时按 memberId 记一次 warn（真机上这正是「事件来了但
   *     面板还是说停滞」的唯一可见证据）。
   */
  const PROGRESS_SAVE_MIN_MS = 1_000
  const progressMissLogged = new Set<string>()
  function recordProgress(memberId: string, at: number): void {
    if (typeof memberId !== 'string' || memberId === '') return
    try {
      for (const summary of store.list()) {
        const state = store.load(summary.runId)
        if (!state) continue
        const binding = state.bindings.find((item) => item.retired !== true && item.memberId === memberId)
        if (!binding) continue
        const prev = state.progress?.[memberId]?.at
        if (typeof prev === 'number' && at - prev < PROGRESS_SAVE_MIN_MS) continue
        store.save({ ...state, progress: touchProgress(state.progress, memberId, at) })
      }
    } catch (error) {
      // 事件处理异常绝不能冒泡到宿主工具执行链（AC-9）：记一条 warn 就够。
      warn(ctx, `推进记录失败：${messageOf(error)}`)
    }
  }

  /**
   * 成员级推进订阅（r32 真机假停滞的修复点）：spawn 一返回就按已知 memberId 装到
   * **成员自己的 `agent.ctx`** 上，不再依赖根作用域投递，也不依赖名字反查。
   */
  const memberWatches = new Map<string, () => void>()
  const memberWatchWarned = new Set<string>()
  function watchMember(memberId: string): void {
    if (typeof memberId !== 'string' || memberId === '' || memberWatches.has(memberId)) return
    const watch = watchMemberProgress(ctx, memberId, (info) => recordProgress(info.memberId, info.at))
    if (watch.ok) {
      memberWatches.set(memberId, watch.stop)
      return
    }
    // 老宿主没有 agents.get 是能力缺口（不是异常）：静默降级到根作用域兜底，
    // 面板侧届时会显示「证据不足」而不是假停滞。其余失败必须可见。
    if ((watch.reason ?? '').includes('旧宿主')) return
    if (!memberWatchWarned.has(memberId)) {
      memberWatchWarned.add(memberId)
      warn(ctx, `成员 ${memberId} 装不上成员级推进订阅（${watch.reason ?? '未知原因'}）：本轮进度可能不推进`)
    }
  }
  /** 停止全部成员级订阅（由下面**同一个** effect 一起清理，别再多挂一份 disposer）。 */
  function stopMemberWatches(): void {
    for (const stop of memberWatches.values()) {
      try {
        stop()
      } catch {
        /* 单个订阅释放失败不影响其余清理 */
      }
    }
    memberWatches.clear()
  }

  // 成员名由 dispatch 决定（`<roleId>-<taskId>`，确定性，AC-17 的幂等地基）；
  // 这里只把「计划里的任务」翻译成宿主的 spawn 请求，不再自己起名。
  const spawn: SpawnPort = async (input) => {
    const result = await spawnPorts.spawn({
      prompt: input.prompt,
      name: input.name,
      route: input.role?.model,
      sessionId: input.plan.sessionId,
      taskId: input.task.id,
    })
    // spawn 成功即拿到 memberId：**此刻**就装上订阅，早于成员的第一次工具调用。
    if (result.ok) watchMember(result.memberId)
    return result
  }

  /** 派发端口：并发切片、角色缺失拒绝、幂等复用、逐角色模型预校验都在 dispatchReady 里。 */
  const dispatch: DispatchPort = async (state: RunState) => {
    const result = await dispatchReady(state, {
      store,
      spawn,
      roles,
      buildPrompt,
      listMembers,
      routePort: routePorts,
      // r27：复用闸门 + 审计都读会话真实路由；宿主 API 只在这里接线。
      // 老宿主没有 agents.get（读不到任何会话路由）时不接端口：闸门整体视为不可用，保留复用。
      ...(canReadSessionRoute(ctx)
        ? {
            readSessionRoute: (sessionId: string) => readSessionRoute(ctx, sessionId),
            readCallerRoute: () => readCallerRoute(ctx),
          }
        : {}),
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

  /**
   * 自动派发（r13 AC-8）：计划落盘即派发，**直调上面的 `dispatch` 端口**，绝不再走
   * `bridge.act({type:'dispatch'})` —— AC-8 断言 dispatch 动作调用为 0，而四道闸（并发/依赖/
   * 写域/暂停）全部已收口在 `dispatchReady`，从这条闭包进去与手动派发行为完全一致。
   *
   * 单飞状态放在 dispatcher 自己的 Map 里（不落 RunState）：跨进程重启后不能残留「正在派发」。
   * 失败在 `onStatus` 里只记 warn：`stallAlerts` 的归一化只接受 kind='tool'，写进去会被丢弃。
   */
  /**
   * 派发失败通知环（r14 AC-3）：受理制之后工具不再 await spawn，「后台没起来」必须自己长腿回来。
   * 内存态（cap 5、不落盘）：进程重启后旧失败不该再算「刚发生的事实」，与单飞状态同一取舍。
   * createBridge 把它并入既有 activityOf（kind='status'），所以快照形状零扩张。
   */
  const dispatchNotes = createDispatchNotes(now)

  const autoDispatcher = createAutoDispatcher({
    store,
    dispatch,
    now,
    onStatus: (_runId, text) => warn(ctx, text),
    onError: (runId, text) => {
      warn(ctx, text)
      dispatchNotes.add(runId, text)
    },
    onClear: (runId) => dispatchNotes.clear(runId),
  })

  /** 恢复端口：只处理 running/gate/interrupted，重复调用必须幂等（AC-17）。 */
  const resume: ResumePort = async (state: RunState) => {
    const result = await resumeRun(state, { store, listMembers, sendMessage: spawnPorts.sendMessage, now })
    // r32：续聊恢复出来的成员同样要装订阅（新 spawn 之外的第二条来路）。
    for (const binding of state.bindings) {
      if (binding.retired !== true) watchMember(binding.memberId)
    }
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
      // r13 AC-8 第五个触发点：每轮 tick 先驱动一次自动派发（补成员退出/漏 kick 的窗口），
      // 派发语义仍在 dispatcher 里，这里只是「顺手推一下」。
      onPoll: async (state) => {
        try {
          await autoDispatcher.tick()
        } catch (error) {
          warn(ctx, `自动派发 tick 失败（下一轮重试）：${messageOf(error)}`)
        }
        if (bus === null) return
        await bus.poll(state)
      },
    })
    watcherRef.start()
  }

  /**
   * 队长留痕记录器（r11 F7）：落 `<home>/.dsh/auto-team/deviations.jsonl`，与 runs 同根、仓库外。
   *
   * 构造不做 IO（读写在 `record()` 里且已 fail-open），所以这里不需要 try/catch；
   * 真正必须被兜住的是**订阅**——见下面的 ④½。
   */
  const deviations = createDeviationRecorder({
    file: deviationsPath(home),
    sessionId: DEFAULT_SESSION,
    warn: (text) => warn(ctx, text),
  })

  /**
   * 左栏项目库（r13 AC-15/AC-23）：装配放在**独立缓存对象**里 —— snapshot 期间零 library 装配，
   * 所以右栏轮询再密也不会把项目表拖慢。记忆索引只经 `listMemoryItems` 一个来源（两轨同实现）。
   */
  const libraryDeps: LibraryDeps = {
    store,
    workspace,
    now,
    publicMemories: () => listMemoryItems(memoryRoots.publicDir, 'public'),
    projectMemories: (target) => listMemoryItems(projectMemoryDir(target), 'project'),
    roles: () => roles.list().map((role) => ({ id: role.id, name: role.name })),
    runsDir: runsDir(home),
    // r19：项目名真源（用户命名的工作区标题）+ 老 run 的 sessionId → 工作区反查。
    // 惰性函数：注册表可能晚于 apply 激活，读的时刻才决定看到什么。
    workspaces,
  }
  const libraryCache = createLibraryCache(libraryDeps)

  const bridge = createBridge({
    store,
    roles,
    memoryRoots,
    // r22：每次读写记忆都按会话现解析项目工作区，不在 apply 时刻定格（旧缺陷的根因）。
    workspaceOf: memoryWorkspaceOf,
    dataRoot,
    dispatch,
    resume,
    applyReceipt: applyReceiptPort,
    sendMessage,
    // r14 AC-3：后台派发失败 → 并入既有 activity（kind='status'），受理制不再是「静默失败」。
    dispatchNotices: dispatchNotes,
    // 门禁超时（AC-13 生效点②）**不在这里传**：缺省时 bridge 取 `settings.gateTimeoutMs`
    // （其缺省正是 GATE_TIMEOUT_MS），设置才能立刻生效；这里硬塞常量会把可配点做废。
    gate: { cwd: workspace, artifactsDir, workspaceOf: sessionWorkspace },
    hostConcurrency,
    // r11 F7：快照里 `deviations` 的读取口（最近 50 条）；装配层给不出时面板空数组、不报错。
    deviations,
    // r11 AC-26：取消 running 任务时尽力中断成员（宿主没有 interrupt 时该端口缺省）。
    ...(spawnPorts.interruptMember === undefined ? {} : { interruptMember: spawnPorts.interruptMember }),
    // 停滞阈值同理**不传**：bridge 每次快照按 settings 现算，面板与 watcher 同源同值。
    now,
    /**
     * r17：用量改读宿主**会话投影**（`session/event` 在真机从未投递到插件）。
     * 读口留在 adapters（宿主 API 唯一入口），bridge 每次快照前用它把成员累计用量覆盖进落盘 usage。
     */
    readSessionUsage: (sessionId) => readSessionTokenUsage(ctx, sessionId),
    // r20：调用次数 = 成员会话自己的 assistant/message 事件数（宿主投影没有这个计数器）。
    readSessionCalls: (sessionId) => readSessionCallCount(ctx, sessionId),
    onUsagePersistError: (text) => warn(ctx, text),
    // r24：closeRun 的成员存活判据（宿主名单是唯一事实源）+ 残留计划对账的非致命告警出口。
    listMembers,
    onWarn: (text) => warn(ctx, text),
    captainModel: () => captainView,
    settingsRepo,
    // r10：技能仓储 / 系统技能库 / 模型清单缓存（三者都是「宿主能力」投影，缺省各有明确降级）。
    skills,
    systemSkills,
    modelCatalog: () => modelCatalog.view(),
    // 保存设置后的两个重生效动作：队长路由重装 + watcher 按新阈值重建。
    // 回调在 bridge 里被 try/catch 包住 —— 保存已落盘，这里出错只降级成 notice。
    onSettingsSaved: () => {
      syncCaptainRoute()
      startWatcher()
    },
    // 未装配总线 = 没有任何事件源可用：如实报降级，面板可见（AC-18）。
    triggerHealth: () =>
      bus === null ? { degraded: true, reason: 'Trigger 总线未装配，推进只剩轮询兜底' } : bus.health(),
    // r13：左栏项目库的读口（缓存对象在装配层持有，bridge 只转发查询参数）+ workspace 白名单。
    libraryView: (query) => libraryCache.view(query),
    isKnownWorkspace: (path) => isKnownWorkspace(libraryDeps, path),
    /**
     * 落盘后的统一通知点（AC-8 的「任务终态」触发点）：bridge 每次 save 都会经过这里，
     * 因此 receipt / cancelTask / skipTask / 门禁回写全都自动补派发，不需要每个动作各接一次。
     * 同时清掉 library 缓存：项目列表里的 run 状态必须与刚落盘的真值一致。
     */
    onRunChanged: (sessionId, runId, cause) => {
      libraryCache.invalidate()
      autoDispatcher.kick(sessionId, runId, cause)
    },
    expander,
  })

  try {
    bus = createTriggerBus({ store, bridge, now })
  } catch (error) {
    warn(ctx, `Trigger 总线启动失败（四类事件不再自动推进，面板显示降级）：${messageOf(error)}`)
  }

  // ① 工具：队长用它拆解/派发/查状态/发消息/读写记忆与角色（7 个 auto_team_*）
  try {
    const toolsDeps: ToolsDeps = {
      store,
      roles,
      bridge,
      now,
      // r14 AC-14：与 libraryDeps.workspace 同一个变量（装配层是唯一能保证同源的地方）——
      // 换成两次 process.cwd() 或任一处拼尾斜杠，同一个工作区就会裂成两个项目桶。
      // 它只是**兜底**：新的 run 优先写会话自己的 cwd（见下面的 workspaceOf）。
      workspace,
      /**
       * r19：run 的 `project` 真源 = 会话 cwd（用户打开的仓库），不是宿主 profile 目录。
       *
       * 顺序：会话 header 的 canonical cwd → 注册表按 sessionId 反查 → undefined（工具层再
       * 退回装配 workspace）。第一条覆盖正常会话；第二条兜住「agent 已卸载但注册表还认识它」。
       */
      workspaceOf: (sessionId) => memoryWorkspaceOf(sessionId),
      // r13 AC-8 的前两个触发点（plan 落盘 / add_tasks 追加）直接由工具层通知；
      // 工具只知道「计划变了」，派发语义留在 dispatcher 里（不在工具里长出第二套调度）。
      autoDispatch: (sessionId, runId, cause) => autoDispatcher.kick(sessionId, runId, cause),
      // r14 AC-3：auto_team_status 的 dispatch 段（最近 ≤5 条报告，内存态）。
      dispatchReports: (sessionId) => autoDispatcher.reportsOf(sessionId),
    }
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
        // 兜底路径也顺手补装成员级订阅：冷恢复出来的成员在 spawn 时刻还不存在，
        // 等它第一次冒泡事件时再挂上（幂等，已挂过就直接返回）。
        if (typeof identity.id === 'string' && identity.id !== '') watchMember(identity.id)
        const memberId = typeof identity.id === 'string' ? identity.id : ''
        let matched = false
        for (const summary of store.list()) {
          const state = store.load(summary.runId)
          if (!state) continue
          const hit = state.bindings.find(
            (binding) =>
              binding.retired !== true &&
              ((memberId !== '' && binding.memberId === memberId) || (identity.name !== '' && binding.name === identity.name)),
          )
          if (!hit) continue
          matched = true
          recordProgress(hit.memberId, at)
        }
        // 事件确实到了、却对不上任何 binding：**必须留痕**。旧实现这里是一条静默的
        // `continue`，于是真机上「工具调用一直在来、进度一直是空」没有任何证据可查（r32）。
        if (!matched && memberId !== '' && !progressMissLogged.has(memberId)) {
          progressMissLogged.add(memberId)
          warn(ctx, `推进信号来自未登记的 agent（id=${memberId} name=${identity.name || '?'}）：本轮进度不会推进`)
        }
      } catch (error) {
        // 事件处理异常绝不能冒泡到宿主工具执行链（AC-9）：记一条 warn 就够。
        warn(ctx, `推进记录失败：${messageOf(error)}`)
      }
    })
    // 一份 disposer 同时收掉「根作用域兜底订阅」与「成员级订阅」：两者是同一件事的两条来路，
    // 分开挂会多出一份 effect（装配契约测试把它当清单数，见 test/wire.test.ts）。
    registerEffect(ctx, () => {
      progressSub.stop()
      stopMemberWatches()
    })
  } catch (error) {
    warn(ctx, `成员推进事件订阅失败：${messageOf(error)}`)
  }

  // ④½ 队长留痕（r11 F7）：只观察、不拦截。
  //     订阅根作用域的 `tools/result`，监听器里按 `exec.agent` 缺省判队长（与 ⑤ 的 guard 同口径）；
  //     记录器自己 fail-open，这里再兜一层 —— 留痕失败绝不能影响工具结果（AC-23）。
  try {
    const deviationSub = onCaptainToolResult(ctx, ({ toolName, args }) => {
      deviations.record({ toolName, args })
    })
    registerEffect(ctx, deviationSub.stop)
  } catch (error) {
    warn(ctx, `队长留痕未装配（面板不显示执行痕迹）：${messageOf(error)}`)
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
            // r13 AC-8 第四个触发点：成员退出会空出一个并发位，立刻让下一条就绪任务补上。
            // 与总线推进并存：这里只「叫一次 dispatcher」，能不能派仍由 dispatchReady 的四道闸决定。
            autoDispatcher.kick(state.plan.sessionId, state.plan.runId, 'member-exit')
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

  /**
   * 用量记录（r13 AC-3/AC-19，U1 fail-open）：根作用域 `session/event` → 累加进所属 run。
   *
   * 归属判定只用**已落盘事实**（不猜宿主字段路径）：
   *   ① 事件里的会话 id 命中某 run 的 `bindings[].memberId` → 成员级（per-member）；
   *   ② 命中某 run 的 `plan.sessionId` → run 级合计（aggregate-only，成员级显示「不可得」）；
   *   ③ 都不命中 → 丢弃，绝不往无关 run 上记账。
   * 事件可能重复投递：去重键由纯模块给出（`eventKey`），去重表在装配层持有、不落盘。
   */
  const usageDeduper = createUsageDeduper()
  function recordUsage(event: UsageEventInput): void {
    const at = now()
    for (const summary of store.list()) {
      const state = store.load(summary.runId)
      if (!state) continue
      const memberId = memberIdOf(state.bindings, event.sessionId)
      const sessionHit = event.sessionId !== undefined && event.sessionId === state.plan.sessionId
      if (memberId === undefined && !sessionHit) continue
      const key =
        event.eventKey ??
        `${state.plan.runId}:${event.sessionId ?? ''}:${at}:${event.usage.input ?? ''}:${event.usage.output ?? ''}:${event.usage.total ?? ''}`
      if (usageDeduper.seen(state.plan.runId, key)) continue
      const attributed = memberId === undefined ? event : { ...event, memberId }
      store.save({ ...state, usage: applyUsage(state.usage, attributed, at) })
    }
  }

  // ⑥½ 用量事件源（AC-3）：订阅失败只降级成「不可得」，绝不让整条 entry 不激活（U1 fail-open）。
  try {
    const sessionSub = onSessionEvents(ctx, (payload) => {
      try {
        const event = usageOfSessionEvent(payload)
        if (event === null) return
        recordUsage(event)
      } catch (error) {
        warn(ctx, `用量记录失败（面板显示不可得）：${messageOf(error)}`)
      }
    })
    if (sessionSub.degraded) warn(ctx, '用量事件源降级：token 用量显示「不可得」')
    registerEffect(ctx, () => sessionSub.stop())
  } catch (error) {
    warn(ctx, `用量事件订阅失败（token 用量显示不可得）：${messageOf(error)}`)
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
