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
import { GATE_TIMEOUT_MS, STALL_MS } from './config.ts'
import { globalDataRoot, projectArtifactsDir, projectMemoryDir, publicMemoryDir, rolesDir, runsDir, skillsDir } from './paths.ts'
import { RunsStore, type RunState } from './store.ts'
import { createRoleRepo } from './roles/repo.ts'
import {
  createBridge,
  type ApplyReceiptPort,
  type DispatchPort,
  type ResumePort,
  type SendPort,
} from './bridge.ts'
import {
  createRoutePorts,
  createSpawnPorts,
  listHostMembers,
  memberIdentityOf,
  onMemberProgress,
  registerAgentCreated,
  registerEffect,
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

export const name = 'auto-team'

/**
 * 只需要两个「一定存在」的服务做必需依赖；其余（agentTeams/llm/webServer）按可选访问，
 * 缺失时功能降级而不是整插件加载失败（AC-9）。
 */
export const inject = ['tools', 'systemPrompt']

/** 队长提示词里的会话标识：单会话 profile 下用 'current' 与实际工具调用元信息对齐。 */
const DEFAULT_SESSION = 'current'

export function apply(ctx: HostContext, options?: { workspace?: string }): void {
  const home = homedir()
  const workspace = options?.workspace ?? process.cwd()
  const dataRoot = globalDataRoot(home)
  const now = (): number => Date.now()

  const store = new RunsStore(runsDir(home))
  const roles = createRoleRepo({ dir: rolesDir(home), skillsDir: skillsDir(home), now })

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

  /** 宿主成员名单（做成方法而不是快照：每次对账都取当时的事实，不用缓存的旧名单）。 */
  function listMembers(): ReturnType<typeof listHostMembers> {
    return listHostMembers(ctx)
  }

  function hostConcurrency(): { limit: number; source: 'host' | 'default' } {
    return resolveConcurrencyLimit(ctx)
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
  const applyReceiptPort: ApplyReceiptPort = (state, taskId, receipt, at) => applyReceipt(state, taskId, receipt, at)

  const sendMessage: SendPort = (memberId, text) => spawnPorts.sendMessage(memberId, text)

  const bridge = createBridge({
    store,
    roles,
    memoryRoots,
    dataRoot,
    dispatch,
    resume,
    applyReceipt: applyReceiptPort,
    sendMessage,
    gate: { cwd: workspace, artifactsDir, timeoutMs: GATE_TIMEOUT_MS },
    hostConcurrency,
    // 停滞阈值唯一来源是 config.STALL_MS；bridge 只 receive（快照三字段即由此推导）。
    stallMs: STALL_MS,
    now,
  })

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

  // ⑤ 运行时对账：成员存活轮询（AC-18 的反面目标只能由 host 侧发现）+ 实际路由回填（AC-22）
  try {
    // stallMs 只在这里传入（AC-13：阈值常量只在 config.ts 定义，watcher 不自读常量）。
    const watcher = createMemberWatcher({ store, listMembers, now, stallMs: STALL_MS })
    watcher.start()
    // 插件卸载/宿主关闭时必须停表，否则定时器会在 ctx 已经失效后继续摸 store。
    registerEffect(ctx, () => watcher.stop())

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

export default { name, inject, apply }
