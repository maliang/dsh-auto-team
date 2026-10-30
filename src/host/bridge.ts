/**
 * 面板桥的领域层：把「面板要看的」与「面板能做的」收敛成一个快照方法 + 一个动作方法，
 * 与传输方式（HTTP / 工具调用）无关 —— 传输由 host/http.ts 与 adapters.ts 负责。
 *
 * 两条入口共用本文件（AC 高频缺陷「工具能用、面板不能用」的唯一防线）：
 *   - HTTP：POST /api/auto-team/act  →  bridge.act
 *   - 工具：auto_team_message / auto_team_receipt / auto_team_memory / auto_team_role → 同一个 bridge.act
 *
 * 11 个动作与拒绝码对照（TECHNICAL §4.2 / §5.x）：
 *   toggle               → 只改开关并落盘，**绝不派发**（反目标 1）
 *   dispatch             → NOT_ENABLED / NO_PLAN / NOT_FOUND(runId) / PLAN_ALREADY_DISPATCHED /
 *                          ROLE_UNAVAILABLE / MODEL_UNRESOLVABLE / CONCURRENCY_FULL（后三者来自编排层 skipped 分类）
 *   cancel               → NO_PLAN
 *   setTaskRole          → NOT_ENABLED / NO_PLAN / NOT_FOUND / BAD_REQUEST（已派发不可换角）
 *   message              → NOT_ENABLED / NO_PLAN / NOT_FOUND / BAD_REQUEST / NO_CALLER（端口透传）
 *   resume               → NOT_ENABLED / NO_PLAN / NOT_FOUND
 *   receipt              → NOT_ENABLED / NO_PLAN / NOT_FOUND / GATE_FAILED（空验收命令）
 *   saveMemory           → NOT_ENABLED / BAD_REQUEST（非法文件名）
 *   deleteMemory         → NOT_ENABLED / BAD_REQUEST / NOT_FOUND
 *   saveRole             → NOT_ENABLED / BAD_REQUEST
 *   deleteRole           → NOT_ENABLED / NOT_FOUND / BAD_REQUEST（内置角色不可删）
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type {
  ActResult,
  ActivityEvent,
  GateEvidence,
  MemberStatus,
  MemberView,
  MemoryTrack,
  MessageRecord,
  PanelAction,
  PanelSnapshot,
  RejectionCode,
  Result,
  Role,
} from '../shared/types.ts'
import {
  GATE_TIMEOUT_MS,
  MAX_CONCURRENT_LIMIT,
  MEMORY_INJECT_BUDGET,
  MEMORY_LINES_PER_TASK,
} from './config.ts'
import { runGate } from './gate/gate.ts'
import { selectMemory } from './memory/inject.ts'
import { deleteMemory, listMemory, readMemory, safeMemoryName, writeMemory } from './memory/repo.ts'
import { blockedTasks, readyTasks } from './plan/graph.ts'
import { progressOf } from './plan/plan.ts'
import type { RoleRepo } from './roles/repo.ts'
import { MESSAGES_LIMIT, type RunState, type RunsStore } from './store.ts'

/** 门禁串行队列上限（TECHNICAL §5.3：避免一次 receipt 风暴炸出多个 shell）。 */
const GATE_QUEUE_LIMIT = 8

/** 活动流最多保留的条数（面板只显示最近 50 条，避免快照无限膨胀）。 */
const ACTIVITY_LIMIT = 50

/** 回执：门禁判定结果（done 的唯一写点在 team/dispatch.ts 的 applyReceipt）。 */
export interface ReceiptInput {
  verdict: 'done' | 'rework' | 'failed'
  note?: string
  evidence?: GateEvidence
}

/** 编排层（team/dispatch.ts dispatchReady）的结果投影：桥只需要这几项来分类拒绝码。 */
export interface DispatchOutcome {
  started: string[]
  skipped: Array<{ taskId: string; reason: string }>
  errors: Array<{ taskId: string; error: string; code?: RejectionCode }>
}

export type DispatchPort = (state: RunState) => Promise<DispatchOutcome>

/** 编排层（team/dispatch.ts resumeRun）的结果投影。 */
export interface ResumeOutcome {
  resumed: number
  skipped: number
  unchanged: boolean
}

export type ResumePort = (state: RunState) => Promise<ResumeOutcome>

/** done/rework/failed 的唯一写点（team/dispatch.ts applyReceipt）。 */
export type ApplyReceiptPort = (
  state: RunState,
  taskId: string,
  receipt: ReceiptInput,
  now: number,
) => RunState

/** 直达消息端口（adapters 注入 agentTeams.sendMessage；无 caller 时带 code='NO_CALLER'）。 */
export type SendPort = (
  memberId: string,
  text: string,
) => Promise<{ ok: boolean; error?: string; code?: RejectionCode }>

export interface BridgeDeps {
  store: RunsStore
  roles: RoleRepo
  memoryRoots: { publicDir: string; projectDir: string }
  /** `<home>/.dsh/auto-team` —— 会话开关状态的持久化根。 */
  dataRoot: string
  /** 派发端口：并发切片/成员命名/幂等都在 team/dispatch.ts，桥不重复实现。 */
  dispatch: DispatchPort
  /** 恢复端口（幂等去抖也在编排层，桥只转派）。 */
  resume: ResumePort
  /** 回执应用端口（done 的唯一写点）。 */
  applyReceipt: ApplyReceiptPort
  /** 直达消息端口。 */
  sendMessage: SendPort
  /** 门禁执行上下文：cwd 用于跑验收命令，artifactsDir 落全量日志（AC-19）。 */
  gate: { cwd: string; artifactsDir: string; timeoutMs?: number }
  /** 宿主并发上限（adapters.resolveConcurrencyLimit）；缺省按 MAX_CONCURRENT_LIMIT 且标注 default。 */
  hostConcurrency?: () => { limit: number; source: 'host' | 'default' }
  now?: () => number
}

export interface Bridge {
  enabled(sessionId: string): boolean
  setEnabled(sessionId: string, enabled: boolean): void
  snapshot(sessionId: string): PanelSnapshot
  act(sessionId: string, action: PanelAction): Promise<ActResult>
  /** 面板记忆页：先读正文再编辑（否则保存会把已有记忆清空，缺陷 D7）。 */
  readMemoryFile(track: MemoryTrack, name: string): Promise<Result<{ track: MemoryTrack; name: string; body: string; chars: number }>>
  /** 队长侧（工具/提示词）用的记忆注入文本。 */
  memoryFor(goal: string): { text: string; truncated: boolean; chars: number }
  /** 队长侧：写入一条记忆（可带 track），按 MEMORY_LINES_PER_TASK 裁剪。 */
  remember(track: MemoryTrack, name: string, body: string): Result<{ name: string }>
}

interface SessionFlag {
  enabled: boolean
  updatedAt: number
}

/** 空验收命令的拒绝码：TECHNICAL §5.3 明确要求 GATE_FAILED，但 §4.2 的码表未收录，故窄化断言。 */
const GATE_FAILED = 'GATE_FAILED' as unknown as RejectionCode

const NOT_ENABLED_TEXT = '自动团队未启用：请先在输入框下方的「自动团队」开关处启用'

export function createBridge(deps: BridgeDeps): Bridge {
  const now = deps.now ?? (() => Date.now())
  const flags = loadFlags()
  let messageSeq = 0
  let gateQueueDepth = 0
  let gateChain: Promise<unknown> = Promise.resolve()

  function flagsPath(): string {
    return `${deps.dataRoot}/sessions.json`
  }

  function loadFlags(): Record<string, SessionFlag> {
    const path = flagsPath()
    if (!existsSync(path)) return {}
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, SessionFlag>
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  function persistFlags(): void {
    mkdirSync(deps.dataRoot, { recursive: true })
    const path = flagsPath()
    const tmp = `${path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(flags, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
  }

  // ---------- 落盘 ----------

  function loadState(sessionId: string): RunState | null {
    return deps.store.latestForSession(sessionId)
  }

  function saveState(state: RunState): RunState {
    deps.store.save(state)
    return state
  }

  function withTask(state: RunState, taskId: string, patch: (task: RunState['plan']['tasks'][number]) => RunState['plan']['tasks'][number]): RunState {
    return {
      ...state,
      plan: {
        ...state.plan,
        tasks: state.plan.tasks.map((task) => (task.id === taskId ? patch(task) : task)),
      },
    }
  }

  function recordOf(input: {
    from: string
    to: string
    toMemberId?: string
    taskId?: string
    body: string
    at: number
  }): MessageRecord {
    messageSeq += 1
    return {
      at: input.at,
      from: input.from,
      to: input.to,
      toMemberId: input.toMemberId,
      taskId: input.taskId,
      body: input.body,
      messageId: `msg-${input.at}-${messageSeq}`,
    }
  }

  /** 消息账本追加（上限 MESSAGES_LIMIT，与 store 的落盘约束同源）。 */
  function withMessage(state: RunState, message: MessageRecord): RunState {
    const messages = [...state.messages, message]
    return { ...state, messages: messages.slice(Math.max(0, messages.length - MESSAGES_LIMIT)) }
  }

  // ---------- 门禁串行队列 ----------

  function enqueueGate<T>(run: () => Promise<T>): Promise<T> {
    if (gateQueueDepth >= GATE_QUEUE_LIMIT) {
      return Promise.reject(new Error(`门禁队列已满（上限 ${GATE_QUEUE_LIMIT}），请稍后再试`))
    }
    gateQueueDepth += 1
    const next = gateChain.then(run, run)
    gateChain = next.then(
      () => undefined,
      () => undefined,
    )
    return next.finally(() => {
      gateQueueDepth -= 1
    })
  }

  // ---------- 快照 ----------

  function activityOf(state: RunState | null): ActivityEvent[] {
    if (!state) return []
    const events: ActivityEvent[] = []
    events.push({
      at: state.plannedAt,
      kind: 'plan',
      text: `计划就绪：${state.plan.tasks.length} 个任务（尚未创建成员）`,
    })
    for (const binding of state.bindings) {
      events.push({
        at: binding.spawnedAt,
        memberId: binding.memberId,
        taskId: binding.taskId,
        kind: 'spawn',
        text: `创建成员 ${binding.name}`,
      })
    }
    for (const message of state.messages) {
      events.push({
        at: message.at,
        memberId: message.toMemberId,
        taskId: message.taskId,
        kind: 'message',
        text: `${message.from} → ${message.to}：${firstLine(message.body)}`,
      })
    }
    for (const audit of state.routeAudits) {
      if (audit.verdict !== 'drift') continue
      events.push({
        at: audit.at,
        taskId: audit.taskId,
        kind: 'route_drift',
        text: `模型路由漂移：${audit.taskId} 声明 ${routeText(audit.declared)} 实际 ${routeText(audit.actual)}`,
      })
    }
    for (const task of state.plan.tasks) {
      if (task.evidence) {
        events.push({
          at: task.evidence.at,
          memberId: task.memberId,
          taskId: task.id,
          kind: 'gate',
          text: `${task.id} 门禁退出码 ${task.evidence.exitCode}`,
        })
      }
      if (task.status === 'rework') {
        events.push({
          at: task.evidence?.at ?? state.plannedAt,
          memberId: task.memberId,
          taskId: task.id,
          kind: 'rework',
          text: `${task.id} 返工（第 ${attemptsOf(task)} 次）`,
        })
      }
    }
    return events.sort((a, b) => b.at - a.at).slice(0, ACTIVITY_LIMIT)
  }

  function membersOf(state: RunState | null, roles: Role[]): MemberView[] {
    if (!state) return []
    const roleById = new Map(roles.map((role) => [role.id, role]))
    const taskById = new Map(state.plan.tasks.map((task) => [task.id, task]))
    const views: MemberView[] = []
    const seen = new Set<string>()

    for (const binding of state.bindings) {
      if (binding.retired === true || seen.has(binding.memberId)) continue
      seen.add(binding.memberId)
      const task = taskById.get(binding.taskId)
      const status = toMemberStatus(task?.status ?? 'pending')
      views.push({
        memberId: binding.memberId,
        name: binding.name,
        roleId: binding.roleId,
        taskId: binding.taskId,
        status,
        lastEventAt: lastEventAtOf(state, binding.memberId, binding.spawnedAt),
        modelRoute: describeRoute(roleById.get(binding.roleId)),
        canResume: status !== 'done',
      })
    }

    // 兼容 v1 落盘的裸 Plan：task.memberId 有值但没有 binding（wrapLegacy 已升级结构，这里只兜底展示）。
    for (const task of state.plan.tasks) {
      if (task.memberId === undefined || seen.has(task.memberId)) continue
      seen.add(task.memberId)
      const status = toMemberStatus(task.status)
      views.push({
        memberId: task.memberId,
        name: roleById.get(task.roleId)?.name ?? task.roleId,
        roleId: task.roleId,
        taskId: task.id,
        status,
        lastEventAt: lastEventAtOf(state, task.memberId, state.plannedAt),
        modelRoute: describeRoute(roleById.get(task.roleId)),
        canResume: status !== 'done',
      })
    }
    return views
  }

  function lastEventAtOf(state: RunState, memberId: string, fallback: number): number {
    let at = fallback
    for (const message of state.messages) {
      if (message.toMemberId === memberId || message.from === memberId) at = Math.max(at, message.at)
    }
    for (const task of state.plan.tasks) {
      if (task.memberId !== memberId || !task.evidence) continue
      at = Math.max(at, task.evidence.at)
    }
    return at
  }

  function memoryFiles(): MemorySnapshotFiles {
    const files = [...listMemory('project', deps.memoryRoots), ...listMemory('public', deps.memoryRoots)]
    return {
      files,
      candidates: files.map((file) => ({
        track: file.track,
        name: file.name,
        body: readMemory(file.track, file.name, deps.memoryRoots),
        updatedAt: file.updatedAt,
      })),
    }
  }

  function concurrencyOf(state: RunState | null): PanelSnapshot['concurrency'] {
    const host = deps.hostConcurrency?.() ?? { limit: MAX_CONCURRENT_LIMIT, source: 'default' as const }
    const running = state
      ? state.plan.tasks.filter((task) => task.status === 'running' || task.status === 'gate').length
      : 0
    const limit = state
      ? Math.min(state.plan.maxConcurrent, host.limit, MAX_CONCURRENT_LIMIT)
      : Math.min(host.limit, MAX_CONCURRENT_LIMIT)
    return { limit, running, source: host.source }
  }

  function snapshot(sessionId: string): PanelSnapshot {
    const state = loadState(sessionId)
    const roles = deps.roles.list()
    const { files, candidates } = memoryFiles()
    const goal = state?.plan.tasks.map((task) => task.title).join(' ') ?? ''
    const selected = selectMemory(goal, candidates, MEMORY_INJECT_BUDGET)

    return {
      enabled: flags[sessionId]?.enabled === true,
      runId: state?.plan.runId,
      planStatus: state?.plan.status,
      plannedAt: state?.plannedAt,
      tasks: state?.plan.tasks ?? [],
      members: membersOf(state, roles),
      messages: state?.messages ?? [],
      routeAudits: state?.routeAudits ?? [],
      concurrency: concurrencyOf(state),
      memory: {
        injectedChars: selected.chars,
        budget: MEMORY_INJECT_BUDGET,
        truncated: selected.truncated,
        files,
      },
      roles,
      activity: activityOf(state),
    }
  }

  // ---------- 动作 ----------

  function reject(code: RejectionCode, message: string, sessionId: string, notices?: string[]): ActResult {
    return { snapshot: snapshot(sessionId), notices, rejected: { code, message } }
  }

  function accept(sessionId: string, notices?: string[]): ActResult {
    return { snapshot: snapshot(sessionId), notices }
  }

  function bindingFor(state: RunState, taskId: string | undefined): RunState['bindings'][number] | undefined {
    if (taskId === undefined) return undefined
    return state.bindings.find((binding) => binding.taskId === taskId && binding.retired !== true)
  }

  async function act(sessionId: string, action: PanelAction): Promise<ActResult> {
    try {
      // 开关是唯一的例外：它必须在「未启用」时也能把开关打开。
      if (action.type !== 'toggle' && flags[sessionId]?.enabled !== true) {
        return reject('NOT_ENABLED', NOT_ENABLED_TEXT, sessionId)
      }

      switch (action.type) {
        case 'toggle': {
          flags[sessionId] = { enabled: action.enabled, updatedAt: now() }
          persistFlags()
          return accept(sessionId, [
            action.enabled
              ? '自动团队已启用：队长可以拆解目标并派发成员'
              : '自动团队已停用：不会派发任何成员（已创建的成员不会被中断）',
          ])
        }

        case 'dispatch': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划：先让队长拆解目标（auto_team_plan）', sessionId)
          if (action.runId !== undefined && action.runId !== state.plan.runId) {
            return reject('NOT_FOUND', `找不到运行 ${action.runId}（当前会话最新运行是 ${state.plan.runId}）`, sessionId)
          }
          const status = state.plan.status
          if (status !== 'draft' && status !== 'dispatching' && status !== 'paused') {
            return reject('NO_PLAN', `计划状态为 ${status}，不能派发（需要 draft/dispatching/paused）`, sessionId)
          }

          const boundIds = new Set(
            state.bindings.filter((binding) => binding.retired !== true).map((binding) => binding.taskId),
          )
          const ready = readyTasks(state.plan.tasks)
          const unbound = ready.filter((taskId) => !boundIds.has(taskId))
          if (status === 'dispatching' && unbound.length === 0) {
            return reject(
              'PLAN_ALREADY_DISPATCHED',
              '计划已派发：成员已在运行，不会重复起人（中断的成员请用「继续」恢复）',
              sessionId,
            )
          }

          const outcome = await deps.dispatch(state)
          const notices: string[] = []
          for (const skipped of outcome.skipped) {
            notices.push(`${skipped.taskId} 跳过：${skipText(skipped.reason)}`)
          }
          for (const error of outcome.errors) {
            notices.push(`${error.taskId} 失败：${error.error}`)
          }
          if (outcome.started.length > 0) {
            notices.unshift(`已创建 ${outcome.started.length} 个成员：${outcome.started.join('、')}`)
          } else if (outcome.skipped.length === 0 && outcome.errors.length === 0) {
            const blocked = blockedTasks(state.plan.tasks)
            notices.push(
              blocked.length > 0
                ? `没有可派发的任务：${blocked.map((item) => `${item.id} 等待 ${item.waitingOn.join('、')}`).join('；')}`
                : '没有可派发的任务：全部已完成',
            )
          }

          // 业务拒绝码只从编排层的 skipped 分类里取（不猜）：全部跳过且原因唯一时才升格为 rejected。
          const skipCodes = uniqueCodes(outcome.skipped.map((skipped) => skipped.reason))
          if (outcome.started.length === 0 && outcome.errors.length === 0 && skipCodes.length === 1) {
            const code = skipCodes[0]
            return reject(code, skipText(code), sessionId, notices)
          }
          if (outcome.started.length === 0 && outcome.errors.length > 0 && skipCodes.length === 0) {
            const first = outcome.errors[0]
            return reject(first.code ?? 'BAD_REQUEST', first.error, sessionId, notices)
          }
          return accept(sessionId, notices)
        }

        case 'cancel': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话没有进行中的运行', sessionId)
          if (state.plan.status === 'cancelled') return accept(sessionId, ['本次运行已取消'])
          saveState({ ...state, plan: { ...state.plan, status: 'cancelled' } })
          return accept(sessionId, ['已取消本次运行：不会再有新的派发（已创建的成员仍可对话）'])
        }

        case 'setTaskRole': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划', sessionId)
          const task = state.plan.tasks.find((item) => item.id === action.taskId)
          if (!task) return reject('NOT_FOUND', `找不到任务 ${action.taskId}`, sessionId)
          const role = deps.roles.get(action.roleId)
          if (!role) return reject('NOT_FOUND', `找不到角色 ${action.roleId}`, sessionId)
          if (bindingFor(state, action.taskId) || task.status === 'running' || task.status === 'gate') {
            return reject('BAD_REQUEST', `任务 ${action.taskId} 已派发，不能替换角色（先取消本次运行）`, sessionId)
          }
          saveState(withTask(state, action.taskId, (item) => ({ ...item, roleId: role.id })))
          return accept(sessionId, [`任务 ${action.taskId} 的角色已改为 ${role.name}（${role.id}）`])
        }

        case 'message': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划：没有可对话的成员', sessionId)
          const text = (action.text ?? '').trim()
          if (text === '') return reject('BAD_REQUEST', '消息内容不能为空', sessionId)
          const binding = bindingFor(state, action.taskId)
          const memberId = action.memberId ?? binding?.memberId
          if (memberId === undefined) {
            return reject(
              'NOT_FOUND',
              action.taskId !== undefined ? `任务 ${action.taskId} 还没有成员` : '缺少 memberId 或 taskId',
              sessionId,
            )
          }
          const sent = await deps.sendMessage(memberId, text)
          if (!sent.ok) {
            return reject(sent.code ?? 'NOT_FOUND', sent.error ?? '直达消息发送失败', sessionId)
          }
          const next = withMessage(
            state,
            recordOf({
              from: 'captain',
              to: binding?.name ?? memberId,
              toMemberId: memberId,
              taskId: binding?.taskId ?? action.taskId,
              body: text,
              at: now(),
            }),
          )
          saveState(next)
          return accept(sessionId, [`已发送给 ${binding?.name ?? memberId}`])
        }

        case 'resume': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话没有可恢复的运行', sessionId)
          if (action.taskId !== undefined && !state.plan.tasks.some((task) => task.id === action.taskId)) {
            return reject('NOT_FOUND', `找不到任务 ${action.taskId}`, sessionId)
          }
          const outcome = await deps.resume(state)
          const notices: string[] = []
          if (outcome.resumed > 0) notices.push(`已恢复 ${outcome.resumed} 个成员`)
          if (outcome.unchanged) {
            // `unchanged` 同时覆盖两种情况（resumeRun 只回这三个计数，不区分原因）：
            // ① 3 秒去抖窗口内的重复点击；② 成员已不在、任务已被标成「已中断」（不会自动新建）。
            // 文案必须两种都说得通 —— 否则首次点击就会被告知「刚刚恢复过」，而它其实一次都没恢复。
            notices.push(
              '本次没有恢复任何成员：刚恢复过的 3 秒内不重复发送；成员已不在的任务标为「已中断」（不会自动新建，需重新派发）',
            )
          } else if (outcome.resumed === 0) {
            notices.push('没有可恢复的成员（已完成的不重跑；成员已不在的标为「已中断」，不会自动新建）')
          }
          return accept(sessionId, notices)
        }

        case 'receipt': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划', sessionId)
          const task = state.plan.tasks.find((item) => item.id === action.taskId)
          if (!task) return reject('NOT_FOUND', `找不到任务 ${action.taskId}`, sessionId)
          if (task.status === 'done') return accept(sessionId, [`任务 ${action.taskId} 已完成，不重复跑门禁`])

          const empty = task.acceptance.trim() === ''
          const gateState = withTask(state, action.taskId, (item) => ({ ...item, status: 'gate' }))
          saveState(gateState)

          let outcome: { ok: boolean; evidence: GateEvidence }
          try {
            // `Promise.resolve` 让门禁既接受异步 GateExec（TECH §5.3 的 v2）也接受同步实现：
            // 队列里排的永远是 Promise，同步实现不会阻塞其他回执的排队语义。
            outcome = await enqueueGate(() =>
              Promise.resolve(
                runGate(task, {
                  cwd: deps.gate.cwd,
                  artifactsDir: deps.gate.artifactsDir,
                  timeoutMs: deps.gate.timeoutMs ?? GATE_TIMEOUT_MS,
                  now,
                }),
              ),
            )
          } catch (error) {
            // 队列满等：任务回到原状态，避免卡在 gate 上永远不动。
            saveState(withTask(gateState, action.taskId, (item) => ({ ...item, status: task.status })))
            return reject(
              'BAD_REQUEST',
              `门禁执行失败：${error instanceof Error ? error.message : String(error)}`,
              sessionId,
            )
          }

          const evidence = outcome.evidence
          if (!outcome.ok && empty) {
            const reverted = withTask(gateState, action.taskId, (item) => ({ ...item, status: task.status }))
            saveState(reverted)
            return reject(GATE_FAILED, '该任务没有验收命令，需要人工确认后放行', sessionId, [
              `门禁未执行：${action.taskId} 的 acceptance 为空（退出码 ${evidence.exitCode}）`,
            ])
          }

          const verdict: ReceiptInput['verdict'] = outcome.ok ? 'done' : 'rework'
          let next = deps.applyReceipt(
            gateState,
            action.taskId,
            { verdict, note: action.note, evidence },
            now(),
          )
          const notices: string[] = [
            outcome.ok
              ? `门禁通过（退出码 ${evidence.exitCode}）：${action.taskId} 已完成`
              : `门禁未通过（退出码 ${evidence.exitCode}）：${action.taskId} 转返工`,
          ]

          if (verdict === 'rework') {
            const binding = bindingFor(next, action.taskId)
            if (binding) {
              const text = `门禁未通过（退出码 ${evidence.exitCode}）：请按以下证据返工\n${evidence.tail}`
              const sent = await deps.sendMessage(binding.memberId, text)
              if (!sent.ok) {
                notices.push(`证据回发失败：${sent.error ?? '未知原因'}`)
              }
              // applyReceipt 若已记账则不重复写（消息账本只允许一条同文记录）。
              if (next.messages.length === gateState.messages.length) {
                next = withMessage(
                  next,
                  recordOf({
                    from: 'captain',
                    to: binding.name,
                    toMemberId: binding.memberId,
                    taskId: action.taskId,
                    body: text,
                    at: now(),
                  }),
                )
              }
            } else {
              notices.push('该任务没有成员：证据只落在面板与日志里')
            }
          }

          const updated = next.plan.tasks.find((item) => item.id === action.taskId)
          if (updated?.status === 'failed') {
            notices.push(`任务 ${action.taskId} 已返工 ${attemptsOf(updated)} 次仍未通过，转人工处理`)
          }
          saveState(next)
          return accept(sessionId, notices)
        }

        case 'saveMemory': {
          const track = trackOf(action.track)
          if (!track) return reject('BAD_REQUEST', 'track 必须是 public 或 project', sessionId)
          const name = safeMemoryName(action.name)
          if (name === null) return reject('BAD_REQUEST', '非法文件名：只允许单段名称（字母/数字/._-，自动补 .md）', sessionId)
          const written = writeMemory(track, name, action.body ?? '', deps.memoryRoots)
          if (!written.ok) return reject('BAD_REQUEST', written.error, sessionId)
          return accept(sessionId, [`已保存 ${track}/${written.name}`])
        }

        case 'deleteMemory': {
          const track = trackOf(action.track)
          if (!track) return reject('BAD_REQUEST', 'track 必须是 public 或 project', sessionId)
          const name = safeMemoryName(action.name)
          if (name === null) return reject('BAD_REQUEST', '非法文件名：只允许单段名称（字母/数字/._-，自动补 .md）', sessionId)
          const removed = deleteMemory(track, name, deps.memoryRoots)
          if (!removed.ok) return reject('NOT_FOUND', removed.error, sessionId)
          return accept(sessionId, [`已删除 ${track}/${name}`])
        }

        case 'saveRole': {
          const role = action.role
          if (!role || typeof role.id !== 'string' || role.id.trim() === '' || typeof role.name !== 'string' || role.name.trim() === '') {
            return reject('BAD_REQUEST', '角色必须有非空的 id 与 name', sessionId)
          }
          const saved = deps.roles.save(role)
          if (!saved.ok) return reject('BAD_REQUEST', saved.error, sessionId)
          return accept(sessionId, [`已保存角色 ${saved.role.name}（${saved.role.id}）`])
        }

        case 'deleteRole': {
          const roleId = typeof action.roleId === 'string' ? action.roleId.trim() : ''
          if (roleId === '') return reject('BAD_REQUEST', 'roleId 不能为空', sessionId)
          if (!deps.roles.get(roleId)) return reject('NOT_FOUND', `找不到角色 ${roleId}`, sessionId)
          const removed = deps.roles.remove(roleId)
          if (!removed.ok) return reject('BAD_REQUEST', removed.error, sessionId)
          return accept(sessionId, [`已删除角色 ${roleId}`])
        }

        default: {
          const unknown = action as { type?: string }
          return reject('BAD_REQUEST', `未知面板动作：${unknown.type ?? 'undefined'}`, sessionId)
        }
      }
    } catch (error) {
      return {
        snapshot: snapshot(sessionId),
        rejected: {
          code: 'BAD_REQUEST',
          message: `面板动作失败：${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
  }

  return {
    enabled(sessionId: string): boolean {
      return flags[sessionId]?.enabled === true
    },

    setEnabled(sessionId: string, enabled: boolean): void {
      flags[sessionId] = { enabled, updatedAt: now() }
      persistFlags()
    },

    snapshot,

    act,

    async readMemoryFile(track: MemoryTrack, name: string) {
      const safe = safeMemoryName(name)
      if (safe === null) return { error: '非法文件名' }
      const exists = listMemory(track, deps.memoryRoots).some((file) => file.name === safe)
      if (!exists) return { error: `记忆文件不存在：${track}/${safe}` }
      const body = readMemory(track, safe, deps.memoryRoots)
      return { data: { track, name: safe, body, chars: body.length } }
    },

    memoryFor(goal: string) {
      const { candidates } = memoryFiles()
      const selected = selectMemory(goal, candidates, MEMORY_INJECT_BUDGET)
      return { text: selected.text, truncated: selected.truncated, chars: selected.chars }
    },

    remember(track: MemoryTrack, name: string, body: string): Result<{ name: string }> {
      const lines = (body ?? '').split('\n').slice(0, MEMORY_LINES_PER_TASK)
      const written = writeMemory(track, name, lines.join('\n'), deps.memoryRoots)
      if (!written.ok) return { error: written.error }
      return { data: { name: written.name } }
    },
  }
}

interface MemorySnapshotFiles {
  files: PanelSnapshot['memory']['files']
  candidates: Array<{ track: MemoryTrack; name: string; body: string; updatedAt: number }>
}

function trackOf(raw: unknown): MemoryTrack | null {
  return raw === 'public' || raw === 'project' ? raw : null
}

function firstLine(text: string): string {
  const line = (text ?? '').split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

function attemptsOf(task: { attempts?: number }): number {
  return typeof task.attempts === 'number' ? task.attempts : 0
}

function routeText(route: { provider: string; model: string; reasoningEffort?: string } | null | undefined): string {
  if (!route) return '未声明'
  const effort = route.reasoningEffort ? ` #${route.reasoningEffort}` : ''
  return `${route.provider}/${route.model}${effort}`
}

/** 编排层 skipped 的原因串 → 拒绝码（只认码表里的 10 个，其余当提示）。 */
function asRejectionCode(raw: string): RejectionCode | null {
  switch (raw) {
    case 'NOT_ENABLED':
    case 'NO_PLAN':
    case 'PLAN_ALREADY_DISPATCHED':
    case 'ROLE_UNAVAILABLE':
    case 'MODEL_UNRESOLVABLE':
    case 'ROUTE_DRIFT':
    case 'CONCURRENCY_FULL':
    case 'NOT_FOUND':
    case 'NO_CALLER':
    case 'BAD_REQUEST':
      return raw
    default:
      return null
  }
}

function uniqueCodes(raws: string[]): RejectionCode[] {
  const codes: RejectionCode[] = []
  for (const raw of raws) {
    const code = asRejectionCode(raw)
    if (code !== null && !codes.includes(code)) codes.push(code)
  }
  return codes
}

function skipText(reason: string): string {
  switch (reason) {
    case 'CONCURRENCY_FULL':
      return '并发已满，等运行中的任务结束再派发'
    case 'ROLE_UNAVAILABLE':
      return '角色不存在：先在角色页创建该角色（不会猜一个角色顶上）'
    case 'MODEL_UNRESOLVABLE':
      return '角色指定的模型不可用：先修正 provider/model（不会静默回退到队长模型）'
    case 'ROUTE_DRIFT':
      return '实际模型与角色声明不一致：请核对模型路由'
    case 'ALREADY_RUNNING':
      return '成员已在运行（幂等，不重复起人）'
    default:
      return reason
  }
}

/** 角色模型路由的逐字展示（AC-22：不许省略、不许改写成别名）。 */
export function describeRoute(role: Role | undefined): string {
  if (!role?.model) return '会话默认'
  const effort = role.model.reasoningEffort ? ` #${role.model.reasoningEffort}` : ''
  return `${role.model.provider}/${role.model.model}${effort}`
}

/**
 * 任务状态 / 宿主成员状态 → 面板 7 态（**唯一映射表**，watcher 复用，组件里禁止再写一份）。
 * 宿主 4 态：running / inactive / provisioning / failed。
 */
export function toMemberStatus(status: string): MemberStatus {
  switch (status) {
    case 'running':
    case 'gate':
      return 'running'
    case 'idle':
    case 'provisioning':
      return 'idle'
    case 'blocked':
      return 'blocked'
    case 'rework':
      return 'rework'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    case 'inactive':
    case 'interrupted':
      return 'interrupted'
    default:
      return 'idle'
  }
}

export { progressOf }
