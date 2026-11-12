/**
 * 队长可用工具（ctx.tools.register），共 8 个（TECHNICAL §5.1）。
 *
 * 纪律：
 *  - 未启用时**不能静默不干活**：必须返回明确中文错误（AC-12），用户才知道是「没打开开关」而不是「插件坏了」；
 *  - 动作型工具（message / receipt / memory 写 / role 写）一律走 `bridge.act`，
 *    与面板 HTTP 入口共用同一套语义与拒绝码 —— 否则就是「工具能用、面板不能用」这个历史高频缺陷；
 *  - `auto_team_dispatch` **强制带 runId**：这是 AC-30「计划条目早于首个成员创建」的机械保证，
 *    不靠提示词自律（提示词只是第二道保险）；
 *  - **空验收与非法写域只在本文件的入口拦截**（plan / add_tasks，AC-6）：
 *    `buildPlan` / `extendPlan` 保持宽容（既有样本直接构造 `acceptance:''`），
 *    因为只有工具入口能在 `store.save` **之前**整批拒绝、做到「一条都不落盘」。
 */
import type {
  ActResult,
  MemberBinding,
  MemoryLevel,
  MemoryTopicId,
  PanelSnapshot,
  Plan,
  PlanTask,
  RejectionCode,
  Result,
} from '../shared/types.ts'
import { MEMORY_LINES_PER_TASK, TOOL_PREFIX } from './config.ts'
import { parseEntryFile, topicCatalogOf, type EntryDraft } from './memory/entries.ts'
import { blockedTasks, readyTasks } from './plan/graph.ts'
import {
  ACCEPTANCE_TEMPLATES,
  emptyAcceptanceError,
  suggestAcceptance,
  type AcceptanceSuggestion,
} from './plan/acceptance.ts'
import { buildPlan, extendPlan, progressOf, type PlanDraftTask } from './plan/plan.ts'
import { normalizeWriteScopes } from './plan/scope.ts'
import { RUN_STATE_VERSION, uniqueRunId, type RunState, type RunsStore } from './store.ts'
import type { Bridge } from './bridge.ts'
import type { AutoDispatchCause, AutoDispatchReport } from './team/auto-dispatch.ts'
import type { RoleRepo } from './roles/repo.ts'
import { registerTool, type HostContext, type ToolSpec } from './adapters.ts'

export interface ToolsDeps {
  store: RunsStore
  roles: RoleRepo
  bridge: Bridge
  now: () => number
  /**
   * 仓库 `package.json` 的 scripts 键名（可选注入）。
   *
   * 只影响「空验收拒绝文案里能不能直接给出一条 `pnpm <script>`」：纯函数 `suggestAcceptance`
   * 不碰文件，装配层（`host/index.ts`）读一次传进来即可；缺省时退化为模板 ③
   * （`test -n "$(git status --porcelain -- <路径>)"`），不会给出跑不起来的命令。
   */
  scripts?: readonly string[]
  /**
   * 计划变更通知（r13 AC-8 的前两个触发点）：`plan` 落盘 / `add_tasks` 追加成功后各调一次。
   *
   * 工具层只报「计划变了」；是否真派发、派给谁、会不会被并发/依赖/写域/暂停拦住，全部由
   * `createAutoDispatcher` 复用 `dispatchReady` 判定 —— 工具里绝不长出第二套调度。
   * 缺省（单测桩）= 不自动派发，行为退回 r12 的手动派发。
   */
  autoDispatch?: (sessionId: string, runId: string | undefined, cause: AutoDispatchCause) => void
  /**
   * 兜底工作区（r14 AC-14/AC-15）：`workspaceOf` 取不到时才写进 `RunState.project`。
   *
   * **必须与 `LibraryDeps.workspace` 是同一个字符串**（装配层注入，`host/index.ts` 一处取值）：
   * 两个字符串只要差一个字符，同一个工作区就会在左栏裂成两个项目桶。
   * 缺省（单测桩）= 不写 project，旧 run 归入「历史运行（未记录工作区）」——不猜、不迁移。
   */
  workspace?: string
  /**
   * 本次 run 的工作区（r19）：按 sessionId 取**会话自己的 cwd**，`auto_team_plan` 落盘时
   * 写进 `RunState.project`。
   *
   * 为什么必须按会话取：`apply()` 只在宿主启动时跑一次，装配时的 `process.cwd()` 在桌面宿主里
   * 是 profile 目录（`~/.dsh/profiles/desktop`），写进 project 就让左栏把 13 次运行都归到 `desktop`
   * 名下。装配层（`host/index.ts`）先读 `agent.session.header.cwd`，再按注册表反查，都取不到
   * 才返回 undefined（工具层回退到 `workspace`）。
   *
   * 缺省（单测桩）= 只用 `workspace`（旧行为，全部保持通过）。
   */
  workspaceOf?: (sessionId: string) => string | undefined
  /**
   * 派发报告（r14 AC-3）：`auto_team_status` 的 `dispatch` 段，来源 `autoDispatcher.reportsOf`。
   *
   * 可选注入：缺省时该段为空数组（不是「没失败」，而是「本进程没有记录」）。
   */
  dispatchReports?: (sessionId: string) => AutoDispatchReport[]
}

const NOT_ENABLED = '自动团队未启用：请在输入框内的「自动团队」选项处启用后再试。'

/**
 * 受理成功文案（r14 AC-1）：**逐字**，被 PRD/TECHNICAL 与测试同时 grep。
 * 它必须同时回答三件事：已经接下、成员还在后台、失败去哪儿看 —— 少一句用户就会去轮询。
 */
const DISPATCH_ACCEPTED_TEXT = '已接受派发：成员在后台创建，失败会显示在活动流'

/**
 * 未装配自动派发时的降级说明（只可能出现在单测桩里：生产装配层 `host/index.ts` 必定接线）。
 *
 * 为什么不是「直接失败」：`test/bridge.test.ts` 的 dispatch 用例构造 `buildToolSpecs` 时
 * 没有 autoDispatch 却要求同步派发成功，那是 r13 的既有契约。这里的处理是**如实降级**：
 * 走回同步 `bridge.act`，返回真实结果并显式 `accepted:false` —— 既不假装受理，也不让旧行为失效。
 */
const DISPATCH_SYNC_NOTE = '派发端口未装配（宿主未接自动派发），本次退回同步派发：返回时成员已创建。'

/**
 * 幂等确认文案（r16 AC-6）：计划已由 `auto_team_plan` 落盘后自动派发时，队长仍可能按旧习惯
 * 显式调一次 dispatch。它不是一个错误（`PLAN_ALREADY_DISPATCHED` 是面板 `act('dispatch')` 的拒绝码，
 * 不属于工具语义）—— 工具层把同一个准入结果翻译成「已受理、本次没重复起人」，零 kick、零 spawn。
 * **逐字**被 PRD/TECHNICAL 与测试 grep，改文案等于改给用户看的契约。
 */
export const DISPATCH_ALREADY_TEXT = '此前已自动派发：成员已在运行，本次未重复起人'

/**
 * `auto_team_status` 的消息投影（r28）：默认精简，别让 200 条历史消息撑爆队长上下文。
 *
 * 账本本身仍然保留全量（`RunState.messages` 上限 200），这里只决定「回给模型看多少」：
 *  - 默认最近 8 条、单条正文截断 400 字，并给 `messagesTotal` 让队长知道「还有多少没看到」；
 *  - 需要全文时显式传 `detail:'full'`（最近 20 条、正文不截断，等价于精简化之前的返回值）。
 */
const STATUS_MESSAGES_COMPACT_LIMIT = 8
const STATUS_MESSAGES_FULL_LIMIT = 20
const STATUS_MESSAGE_BODY_MAX = 400

/** 一条消息的投影：正文超长时截断并标 `truncated`+`bodyChars`，其余字段原样保留。 */
function messageBrief(
  message: PanelSnapshot['messages'][number],
  maxBody: number | null,
): Record<string, unknown> {
  const body = typeof message.body === 'string' ? message.body : ''
  // 按 code point 截断：直接 `slice` 可能把 emoji 劈成孤立代理项，宿主会拒收这种返回值。
  const codePoints = Array.from(body)
  const truncated = maxBody !== null && codePoints.length > maxBody
  return {
    at: message.at,
    from: message.from,
    to: message.to,
    ...(message.taskId === undefined ? {} : { taskId: message.taskId }),
    ...(message.toMemberId === undefined ? {} : { toMemberId: message.toMemberId }),
    ...(message.messageId === undefined ? {} : { messageId: message.messageId }),
    body: truncated ? `${codePoints.slice(0, maxBody).join('')}…` : body,
    ...(truncated ? { truncated: true, bodyChars: codePoints.length } : {}),
  }
}

/** 成员投影（dispatch 与 status 工具共用的那一份，避免两处字段慢慢分叉）。 */
function memberBrief(member: PanelSnapshot['members'][number]): Record<string, unknown> {
  return {
    memberId: member.memberId,
    name: member.name,
    roleId: member.roleId,
    taskId: member.taskId,
    status: member.status,
    modelRoute: member.modelRoute,
  }
}

/**
 * 当前会话 id：面板按会话隔离，工具必须**认到同一个会话**——否则就是「面板里开关打开了，
 * 工具还一律回未启用」，用户看到的是「开了自动团队但它从不干活」。
 *
 * 宿主真实形状是 `ToolDefinition.execute(args, exec: ToolRunContext)`：`exec` 上**没有**
 * `sessionId` / `session` 字段，只有 `agent: Agent { readonly id: SessionId }`
 * （`cordis_inspect_query` 的 `ToolExecutionInput` 声明可在 HOST-EVENTS.md 查到），
 * 所以**必须优先读 `agent.id`**。r11 修复前这里只认 `sessionId` / `session.id`，
 * 真机上一律退回 `'current'`：面板把开关记在真实会话 id 上，工具却查 `'current'`，
 * 于是七个工具全部返回 NOT_ENABLED。`sessionId` / `session.id` 保留为简化形状
 * （面板 HTTP 入口、单测桩）的兜底。
 */
export function sessionOf(meta: unknown): string {
  const value = meta as
    | { sessionId?: string; session?: { id?: string }; agent?: { id?: string } }
    | undefined
  return value?.agent?.id ?? value?.sessionId ?? value?.session?.id ?? 'current'
}

/**
 * 宿主 `exec.agent.id`（成员的 SessionId）；取不到返回 undefined。
 *
 * 与 `sessionOf` 的区别：这里**不做** `'current'` 兜底 —— 成员判定必须拿到真实 id，
 * 否则一个没有 agent 的调用就可能撞上某个 memberId 为 `'current'` 的脏数据。
 */
function agentIdOf(meta: unknown): string | undefined {
  const value = meta as { agent?: { id?: string } } | undefined
  const id = value?.agent?.id
  return typeof id === 'string' && id.trim() !== '' ? id : undefined
}

/** 成员会话的身份：命中的绑定 + 它被派发的那个任务 + 所属 run。 */
export interface MemberIdentityView {
  runId: string
  /** run 的队长会话 id（`bridge.act`/`snapshot` 认的是它，不是成员的 agent id）。 */
  sessionId: string
  binding: MemberBinding
  task: PlanTask
}

/**
 * 反查「本次工具调用是不是某个成员发起的」。
 *
 * 判据只有一条：`exec.agent.id` 与某个 run 的 `bindings[].memberId` 相同且 `!retired`
 * （`apply` 时宿主给成员的 SessionId 就是 binding 里记下的 memberId）。多个 run 命中时
 * 取 `plannedAt` 最大的那份（计划越新越相关），同一时刻再用 `createdAt`、`runId` 兜底，
 * 保证结果确定而不是依赖目录遍历顺序。
 *
 * **只判身份，不判开关**：这里刻意不看 `settings.enabled`——身份解析与准入是两件事。
 * 成员自助（status/receipt）的准入必须再叠一层 `memberSelfServiceOf`：开关关闭时
 * 两个工具都要回 tools.ts 的 `NOT_ENABLED` 原文案，不能一个放行一个被桥拦。
 */
export function memberIdentityOf(deps: ToolsDeps, meta: unknown): MemberIdentityView | null {
  const agentId = agentIdOf(meta)
  if (agentId === undefined) return null
  let best: { state: RunState; binding: MemberBinding; task: PlanTask } | null = null
  for (const summary of deps.store.list()) {
    const state = deps.store.load(summary.runId)
    if (state === null) continue
    const binding = state.bindings.find((item) => item.memberId === agentId && item.retired !== true)
    if (binding === undefined) continue
    const task = state.plan.tasks.find((item) => item.id === binding.taskId)
    if (task === undefined) continue
    if (best === null || newerBinding(state, best.state)) {
      best = { state, binding, task }
    }
  }
  if (best === null) return null
  return {
    runId: best.state.plan.runId,
    sessionId: best.state.plan.sessionId,
    binding: best.binding,
    task: best.task,
  }
}

/**
 * 成员自助的唯一准入谓词（r30 边界修正）：身份命中 **且** run 所属队长会话的开关仍开着。
 *
 * 为什么必须叠这一层：开关是「团队停用」的总闸，成员自助只是同一团队里的受限视图，
 * 不能因为调用者恰好有绑定就绕过闸门。修正前 status 在开关关闭时照样回成员视图，
 * receipt 却被 `bridge.act` 的 `preflightGate` 拦下并回桥层文案（多两个字「先」、无句号）——
 * 「一个放行一个拒绝 + 两处文案」对用户是纯噪音。现在两个工具共用这一个谓词，
 * 关闭时都回本文件的 `NOT_ENABLED` 原文案；开启时都放行，receipt 仍走 `bridge.act` 同一道门禁。
 */
function memberSelfServiceOf(deps: ToolsDeps, meta: unknown): MemberIdentityView | null {
  const member = memberIdentityOf(deps, meta)
  if (member === null) return null
  return deps.bridge.enabled(member.sessionId) ? member : null
}

/** 两条命中的优先级：plannedAt 大的胜；再按 createdAt；最后按 runId 字典序（确定性）。 */
function newerBinding(next: RunState, prev: RunState): boolean {
  if (next.plannedAt !== prev.plannedAt) return next.plannedAt > prev.plannedAt
  if (next.plan.createdAt !== prev.plan.createdAt) return next.plan.createdAt > prev.plan.createdAt
  return next.plan.runId > prev.plan.runId
}

/**
 * 本次 run 最终写进 `RunState.project` 的工作区（r19）。
 *
 * 顺序：`deps.workspaceOf(sessionId)`（会话 cwd / 注册表反查）→ 装配层兜底 `deps.workspace`。
 * `workspaceOf` 是装配层注入的外部回调：它抛错只代表「这次取不到」，回退到兜底即可，
 * 绝不能让一次计划落盘因为宿主读不到工作区而失败（fail-open 到旧行为）。
 */
function workspaceFor(deps: ToolsDeps, sessionId: string): string | undefined {
  let own: string | undefined
  try {
    const value = deps.workspaceOf?.(sessionId)
    own = typeof value === 'string' ? value.trim() : undefined
  } catch {
    own = undefined
  }
  if (own !== undefined && own !== '') return own
  const fallback = (deps.workspace ?? '').trim()
  return fallback === '' ? undefined : fallback
}

function taskBrief(task: PlanTask): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    roleId: task.roleId,
    dependsOn: task.dependsOn,
    status: task.status,
    memberId: task.memberId,
    acceptance: task.acceptance,
  }
}

function rejectedOf(result: ActResult): Record<string, unknown> | null {
  if (!result.rejected) return null
  return { ok: false, code: result.rejected.code, error: result.rejected.message, notices: result.notices }
}

/**
 * 任务输入的 JSON Schema（`auto_team_plan` 与 `auto_team_add_tasks` **共用一份**）。
 *
 * 两个工具收的是同一种条目：分开写就会在「plan 有 writeScopes、add_tasks 忘了」这类
 * 细枝末节上分叉，而模型看不见的字段等于不存在（它会照旧不声明写域）。
 */
const TASK_ITEM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '任务 id，缺省按 t1/t2… 生成（追加时不得与既有 id 重复）' },
    title: {
      type: 'string',
      description:
        '写清要实现什么 + 关键文件与符号（成员据此定位；不要写「看一下相关代码」）；一行结论在前，细节在后',
    },
    roleId: { type: 'string', description: '执行该任务的角色 id' },
    dependsOn: {
      type: 'array',
      items: { type: 'string' },
      description: '依赖的任务 id（可指向既有任务，也可指向同批新任务）',
    },
    acceptance: {
      type: 'string',
      description:
        '验收命令（门禁据此产出证据）；不能是空白字符串，空验收会整批拒绝。输出会进上下文，长输出请自行收窄（如 | tail -20）',
    },
    writeScopes: {
      type: 'array',
      items: { type: 'string' },
      description: '写域：本任务预计改动的文件或目录（目录边界互斥，冲突的任务排队等待，释放后通知）',
    },
  },
  required: ['title', 'roleId'],
}

/**
 * 草稿任务的「调用方认得出的标识」：显式 id 优先，否则按 `buildPlan` 的规则补 `t<index+1>`。
 *
 * 拒绝文案里必须出现任务 id（AC-6 的判据之一），而此刻 `buildPlan` 可能还没跑，
 * 所以 id 生成规则要跟它一致——不一致就会出现「报 t2、实际落 t3」这种最难查的漂移。
 */
function draftIdOf(task: PlanDraftTask | undefined, index: number): string {
  const id = typeof task?.id === 'string' ? task.id.trim() : ''
  return id === '' ? `t${index + 1}` : id
}

/**
 * 写域归一（工具侧唯一入口，AC-12/AC-13）：任一条非法 → 整批拒绝。
 *
 * 这里**必须**调 `plan/scope.ts`，不许内联 `startsWith` 之类的判据：
 * 目录边界规则（`src/host` 冲突 `src/host/bridge.ts`、不冲突 `src/hostile.ts`）只有一处实现，
 * 工具侧再写一份就会与 dispatch 侧的冲突判定分叉。
 */
function normalizeDraftScopes(
  tasks: readonly PlanDraftTask[],
): { ok: true; tasks: PlanDraftTask[] } | { ok: false; error: string } {
  const out: PlanDraftTask[] = []
  for (const [index, raw] of tasks.entries()) {
    if (raw === null || typeof raw !== 'object') {
      return { ok: false, error: `新增任务的第 ${index + 1} 条不是对象` }
    }
    const normalized = normalizeWriteScopes(raw.writeScopes)
    if (!normalized.ok) {
      return { ok: false, error: `写域不合法（任务 ${draftIdOf(raw, index)}）：${normalized.error}` }
    }
    const next: PlanDraftTask = { ...raw }
    if (normalized.scopes.length > 0) next.writeScopes = normalized.scopes
    else delete next.writeScopes
    out.push(next)
  }
  return { ok: true, tasks: out }
}

/**
 * 空验收整批拒绝文案（AC-6）：没有违规任务时返回 `null`。
 *
 * **所有**违规任务一次列全（不是报第一条就停）：模型下一轮要能一次改对，
 * 否则会陷入「改一条、再被拒一条」的往返。可自动选中的任务顺带给出完整命令。
 */
function emptyAcceptanceOf(
  tasks: readonly Pick<PlanTask, 'id' | 'title' | 'acceptance' | 'writeScopes'>[],
  scripts: readonly string[] | undefined,
): string | null {
  const violations = tasks
    .filter((task) => task.acceptance.trim() === '')
    .map((task) => ({ id: task.id, title: task.title }))
  if (violations.length === 0) return null

  const suggestions = new Map<string, AcceptanceSuggestion>()
  for (const violation of violations) {
    const task = tasks.find((item) => item.id === violation.id)
    suggestions.set(
      violation.id,
      suggestAcceptance({
        title: task?.title ?? '',
        writeScopes: task?.writeScopes,
        scripts,
      }),
    )
  }
  return emptyAcceptanceError(violations, suggestions)
}

/**
 * 已收口 run 的追加拒绝文案（AC-10）：含 runId 与当前状态中文。
 *
 * 判定权归 `extendPlan`（它才知道哪些状态算收口），这里只在它拒绝之后**补齐上下文**：
 * 光有「计划已取消，不能再追加任务」模型不知道该换 runId 还是该开新计划。
 */
function closedRunReason(plan: Plan, runId: string): string | null {
  if (plan.status !== 'cancelled' && plan.status !== 'terminated') return null
  const label = plan.status === 'cancelled' ? '已取消' : '已终止'
  return `该 run ${runId} ${label}，不能再追加任务（请先 auto_team_plan 开新计划）`
}

export function buildToolSpecs(deps: ToolsDeps): ToolSpec[] {
  return [
    {
      name: `${TOOL_PREFIX}plan`,
      description:
        '把一个目标拆成有依赖的任务图并生成执行计划（不创建任何成员）。每个任务需要 roleId 与 acceptance（可执行的验收命令）。'
        + '**单任务计划合法**：哪怕只有一件小事、只改一处，也必须走这里拆成 1 个任务并派 1 个成员去做——'
        + '简单任务同样属于团队，队长不自己动手。'
        + `验收命令必须真能执行（exit 0 才算过），可直接用：${ACCEPTANCE_TEMPLATES.join(' / ')}（尖括号换成实际值）。`
        + '返回 runId，派发时必须带上它；后续要加任务用 auto_team_add_tasks，不要新开计划。'
        + '**改代码任务的默认路径**：判断为需要修改代码后，先 plan 再 dispatch；计划落盘即自动派发，不必等用户确认。',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: '要达成的目标（revise=true 时是「本次修订的新要求」，会作为「需求修订」段落追加，不覆盖原目标）' },
          maxConcurrent: { type: 'integer', description: '并发上限，默认 3，硬上限 8' },
          tasks: {
            type: 'array',
            description: '任务列表（依赖必须指向同一列表里的 id；1 条也合法）。revise=true 时：id 命中既有任务=更新其目标/验收，无 id 或新 id=追加任务',
            items: TASK_ITEM_SCHEMA,
          },
          revise: {
            type: 'boolean',
            description: '显式声明「这是对在跑需求的修改」。只有队长判断本次输入是同一需求的修订时才传 true；不传时一律新建 run（不相关的新需求不并入旧计划）',
          },
          runId: { type: 'string', description: 'revise=true 时要并入的 runId；缺省取当前会话最近的非终态 run' },
          changeSummary: { type: 'string', description: 'revise=true 时的变更要点（会原样写进给在跑成员的直达消息与任务卡修订说明）' },
          cancelledTaskIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'revise=true 时被新需求作废的任务 id（转 cancelled，面板可见作废原因）',
          },
          cancelReason: { type: 'string', description: 'revise=true 时作废任务的统一原因；缺省由修订说明生成' },
        },
        required: ['goal', 'tasks'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        const rawTasks = Array.isArray(args.tasks) ? (args.tasks as PlanDraftTask[]) : []
        // 写域先归一（非法即整批拒绝）：buildPlan 只做轻量清洗，不管路径合法性。
        const scoped = normalizeDraftScopes(rawTasks)
        if (!scoped.ok) return { ok: false, code: 'BAD_REQUEST', error: scoped.error }

        const at = deps.now()
        const goal = typeof args.goal === 'string' ? args.goal : ''
        const maxConcurrent = typeof args.maxConcurrent === 'number' ? args.maxConcurrent : undefined
        const revise = args.revise === true
        const requestedRunId = typeof args.runId === 'string' ? args.runId.trim() : ''

        // 会话里所有非终态 run（新建提示与 revise 目标解析共用一份，避免两处口径分叉）。
        const openRuns = deps.store
          .list()
          .filter(
            (summary) =>
              summary.sessionId === sessionId &&
              summary.status !== 'cancelled' &&
              summary.status !== 'terminated',
          )
          .sort((left, right) => right.createdAt - left.createdAt)

        // r21：需求修订走**显式**通道。判定权在队长（`revise: true`），这里只解析目标 run，
        // 绝不自动并入 —— 不相关的新需求必须仍然新建 run（这是 r21 口径修正的核心）。
        if (revise) {
          // 不带 runId 时取**最新的非终态 run**（不是 latestForSession：最后一条可能已收口）。
          const target = requestedRunId === ''
            ? (openRuns[0] === undefined ? null : deps.store.load(openRuns[0].runId))
            : deps.store.load(requestedRunId)
          if (target === null) {
            if (requestedRunId !== '') {
              return { ok: false, code: 'NOT_FOUND', error: `找不到要修订的 run：${requestedRunId}` }
            }
            // 没有可并入的 run（会话从未跑过）：退化成新建，并在 note 里说清楚。
          } else if (target.plan.sessionId !== sessionId) {
            return {
              ok: false,
              code: 'NOT_FOUND',
              error: `run ${target.plan.runId} 不属于当前会话，拒绝并入（请确认 runId）`,
            }
          } else if (target.plan.status === 'cancelled' || target.plan.status === 'terminated') {
            // 显式 runId 指向终态：拒绝，绝不复活旧计划（不带 runId 时上面已不会解析到终态 run）。
            const label = target.plan.status === 'cancelled' ? '已取消' : '已终止'
            return {
              ok: false,
              code: 'BAD_REQUEST',
              error: `run ${target.plan.runId} ${label}，不能再并入需求修订；请去掉 revise 或换一个在跑的 runId 开新计划`,
            }
          } else {
            const outcome = await deps.bridge.revise(sessionId, target.plan.runId, {
              goal,
              changeSummary: typeof args.changeSummary === 'string' ? args.changeSummary : undefined,
              cancelledTaskIds: Array.isArray(args.cancelledTaskIds)
                ? (args.cancelledTaskIds as unknown[]).map((id) => String(id ?? ''))
                : undefined,
              cancelReason: typeof args.cancelReason === 'string' ? args.cancelReason : undefined,
              tasks: scoped.tasks,
              maxConcurrent,
            })
            if (!outcome.ok) return { ok: false, code: outcome.code, error: outcome.reason }
            // 追加出来的 pending 任务走同一条自动派发；更新/作废的任务不动它们的成员（停止由桥负责）。
            deps.autoDispatch?.(sessionId, outcome.plan.runId, 'plan-saved')
            return {
              ok: true,
              mode: outcome.mode,
              runId: outcome.plan.runId,
              plannedAt: target.plannedAt,
              maxConcurrent: outcome.plan.maxConcurrent,
              tasks: outcome.plan.tasks.map(taskBrief),
              ready: readyTasks(outcome.plan.tasks),
              blocked: blockedTasks(outcome.plan.tasks),
              members: deps.bridge.snapshot(sessionId).members.length,
              added: outcome.added.map(taskBrief),
              updated: outcome.updated.map(taskBrief),
              cancelled: outcome.cancelled.map(taskBrief),
              skipped: outcome.skipped,
              stopped: outcome.stopped,
              stopFailed: outcome.stopFailed,
              notified: outcome.notified,
              notifyFailed: outcome.notifyFailed,
              goal: outcome.plan.goal,
              revisions: outcome.plan.revisions ?? [],
              note:
                `已并入需求修订（mode=${outcome.mode}）：更新 ${outcome.updated.length}、追加 ${outcome.added.length}、`
                + `作废 ${outcome.cancelled.length}；在跑成员已按新需求通知 ${outcome.notified.length} 人。`,
            }
          }
        }

        // 新建 run 前先看一眼：会话里还有在跑的 run 时给队长提示（不自动并入！）。
        const activeOther = openRuns[0]?.runId

        const draft = buildPlan(
          {
            sessionId,
            goal,
            maxConcurrent,
            tasks: scoped.tasks,
          },
          uniqueRunId(deps.store, sessionId, at),
          at,
        )
        if (!draft.ok) return { ok: false, code: 'BAD_REQUEST', error: draft.reason }

        // 空验收：**在 save 之前**整批拒绝（AC-6）。放到 buildPlan 里做会打红既有 484 例里
        // 手工构造 acceptance:'' 的样本，所以拦截点只在这里。
        const emptyAcceptance = emptyAcceptanceOf(draft.plan.tasks, deps.scripts)
        if (emptyAcceptance !== null) return { ok: false, code: 'BAD_REQUEST', error: emptyAcceptance }

        const workspace = workspaceFor(deps, sessionId)
        const state: RunState = {
          version: RUN_STATE_VERSION,
          plan: draft.plan,
          plannedAt: at,
          messages: [],
          bindings: [],
          routeAudits: [],
          // r14 AC-14：r13 早就有这个字段与投影，只是从没被写过 —— 左栏因此把每次新 run
          // 都归进历史桶（「历史运行（未记录工作区）」）。写入点只在这里。
          // r19：来源改为**会话 cwd**（`workspaceOf`），装配 workspace 只做兜底 ——
          // 宿主 profile 目录（desktop）不再冒充用户工作区。
          ...(workspace === undefined ? {} : { project: workspace }),
        }
        deps.store.save(state)
        // r13 AC-8：计划落盘后**零点击**自动派发（notice 文案同步改成「已自动派发」，不再要求用户手动确认）。
        deps.autoDispatch?.(sessionId, draft.plan.runId, 'plan-saved')

        return {
          ok: true,
          mode: 'created' as const,
          runId: draft.plan.runId,
          plannedAt: state.plannedAt,
          maxConcurrent: draft.plan.maxConcurrent,
          tasks: draft.plan.tasks.map(taskBrief),
          ready: readyTasks(draft.plan.tasks),
          blocked: blockedTasks(draft.plan.tasks),
          members: 0,
          // 不相关的新需求允许新建 run；但必须让队长看见「另有一个在跑的 run」，避免误以为自己改了旧计划。
          ...(activeOther === undefined ? {} : { activeRunId: activeOther }),
          note:
            `计划已保存；符合依赖与并发条件的任务会自动派发，无需再手动调用 dispatch。`
            + (activeOther === undefined
              ? ''
              : `当前会话还有在跑的 run ${activeOther}；若这次是对它的需求修订，请传 revise=true 与 runId=${activeOther}`),
        }
      },
    },
    {
      name: `${TOOL_PREFIX}dispatch`,
      description:
        '按依赖顺序派发就绪任务并创建成员（并发受 maxConcurrent 与宿主上限限制）。必须带 plan 返回的 runId。'
        + '**本工具受理后立即返回**（accepted/dispatching）：成员在后台创建，你不需要、也不应该在同一轮等待成员；'
        + '进度用 auto_team_status 查，失败了会在下一次返回里看到。'
        + '**幂等确认**：若计划已自动派发，本工具返回 `alreadyDispatched:true`，不会重复起人。',
      parameters: {
        type: 'object',
        properties: { runId: { type: 'string', description: 'auto_team_plan 返回的 runId（必填）' } },
        required: ['runId'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        const runId = typeof args.runId === 'string' ? args.runId.trim() : ''
        if (runId === '') {
          return {
            ok: false,
            error:
              'auto_team_dispatch 必须带 runId：先调用 auto_team_plan 生成计划，再用它返回的 runId 派发（计划必须早于成员创建）。',
          }
        }

        // ① 同步预检：判据与面板 act('dispatch') 同源，不通过就原样回码并**不** kick。
        const admission = deps.bridge.precheckDispatch(sessionId, runId)
        if (!admission.ok) {
          // r16 AC-6：已自动派发 → **幂等确认**，不是错误。
          // 面板 act('dispatch') 继续用 `admissionOf` 的 PLAN_ALREADY_DISPATCHED（语义不变）；
          // 工具层只做翻译：不 kick、不调 bridge.act、不 spawn，成员数取真实快照（不预支新成员）。
          if (admission.code === 'PLAN_ALREADY_DISPATCHED') {
            const snapshot = deps.bridge.snapshot(sessionId)
            return {
              ok: true,
              accepted: true,
              dispatching: true,
              alreadyDispatched: true,
              runId: snapshot.runId ?? runId,
              planStatus: snapshot.planStatus,
              ready: [],
              tasks: snapshot.tasks.map(taskBrief),
              members: snapshot.members.map(memberBrief),
              notices: [DISPATCH_ALREADY_TEXT],
            }
          }
          return { ok: false, code: admission.code, error: admission.message }
        }

        // ② 受理：真正的 spawn 交给后台调度器（单飞/退避/四道闸都在它里面）。
        //    ⚠️ 受理分支里**不许 await 任何与 spawn 相关的东西**：一 await，队长轮就被拖住（AC-1）。
        if (deps.autoDispatch === undefined) {
          // 只有未装配的桩环境会走到这里（生产装配层必定接 autoDispatch）：退回 r13 同步语义，
          // 返回真实结果，但显式标 accepted:false —— 绝不把「没被后台受理」说成「已受理」。
          const result = await deps.bridge.act(sessionId, { type: 'dispatch', runId })
          const rejected = rejectedOf(result)
          if (rejected) return rejected
          const snapshot = result.snapshot
          return {
            ok: true,
            accepted: false,
            dispatching: false,
            runId: snapshot.runId,
            planStatus: snapshot.planStatus,
            ready: admission.ready,
            tasks: snapshot.tasks.map(taskBrief),
            members: snapshot.members.map(memberBrief),
            notices: [...(result.notices ?? []), DISPATCH_SYNC_NOTE],
          }
        }
        deps.autoDispatch(sessionId, runId, 'manual')

        // ③ 立即返回「已受理」：成员此刻还没创建，如实回快照里的既有成员，不预支结果。
        const snapshot = deps.bridge.snapshot(sessionId)
        return {
          ok: true,
          accepted: true,
          dispatching: true,
          runId: admission.runId,
          planStatus: snapshot.planStatus,
          ready: admission.ready,
          tasks: snapshot.tasks.map(taskBrief),
          members: snapshot.members.map(memberBrief),
          notices: [DISPATCH_ACCEPTED_TEXT],
        }
      },
    },
    {
      name: `${TOOL_PREFIX}status`,
      description:
        '读取当前会话的执行计划、成员状态、门禁证据、消息账本、记忆注入预算与角色列表。'
        + `默认精简：messages 只留最近 ${STATUS_MESSAGES_COMPACT_LIMIT} 条、单条正文截断 ${STATUS_MESSAGE_BODY_MAX} 字，`
        + '并给 messagesTotal 总数（要看全文就传 detail:\'full\'）。'
        + '**只读**：先查 `enabled`，确认开关打开后才决定是否 plan/dispatch；未启用时不要创建成员或计划。',
      parameters: {
        type: 'object',
        properties: {
          detail: {
            type: 'string',
            enum: ['compact', 'full'],
            description:
              `compact（默认）：消息只留最近 ${STATUS_MESSAGES_COMPACT_LIMIT} 条、正文截断 ${STATUS_MESSAGE_BODY_MAX} 字；`
              + `full：最近 ${STATUS_MESSAGES_FULL_LIMIT} 条、正文不截断`,
          },
        },
        required: [],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        // 队长路径完全不变：开关打开时先走原分支。成员的「查看自己任务」只在 run 所属队长会话
        // 的开关仍开着时成立（memberSelfServiceOf 身份 + 开关一次判定）；关闭时与其它工具同回旧文案。
        if (!deps.bridge.enabled(sessionId)) {
          const member = memberSelfServiceOf(deps, meta)
          if (member === null) return { ok: false, error: NOT_ENABLED }
          // 成员视图**只**回自己的任务：不回 members / memory / roles / 其它任务 / plan 全量。
          const evidence = member.task.evidence
          return {
            ok: true,
            view: 'member',
            runId: member.runId,
            task: {
              id: member.task.id,
              title: member.task.title,
              status: member.task.status,
              acceptance: member.task.acceptance,
              dependsOn: member.task.dependsOn,
              ...(evidence === undefined ? {} : { evidence }),
            },
            notice: '成员视角：只显示你自己被派发的任务；完成后用 auto_team_receipt 提交回执（门禁由宿主执行）。其它工具在成员会话不可用。',
          }
        }
        const snapshot: PanelSnapshot = deps.bridge.snapshot(sessionId)
        // 默认精简：不传即 compact；只有显式 full 才回正文全文（默认值写死在实现里，schema 只是提示）。
        const detail = args?.detail === 'full' ? 'full' : 'compact'
        const limit = detail === 'full' ? STATUS_MESSAGES_FULL_LIMIT : STATUS_MESSAGES_COMPACT_LIMIT
        const messages = snapshot.messages.slice(-limit)
        return {
          ok: true,
          enabled: snapshot.enabled,
          runId: snapshot.runId,
          planStatus: snapshot.planStatus,
          plannedAt: snapshot.plannedAt,
          progress: progressOf(snapshot.tasks),
          concurrency: snapshot.concurrency,
          tasks: snapshot.tasks.map((task) => ({
            ...taskBrief(task),
            evidence: task.evidence
              ? { exitCode: task.evidence.exitCode, command: task.evidence.command, at: task.evidence.at }
              : undefined,
          })),
          members: snapshot.members,
          detail,
          messages: messages.map((message) => messageBrief(message, detail === 'full' ? null : STATUS_MESSAGE_BODY_MAX)),
          messagesTotal: snapshot.messages.length,
          messagesShown: messages.length,
          messagesTruncated: snapshot.messages.length > messages.length,
          routeAudits: snapshot.routeAudits,
          // r14 AC-3：「后台派发到底发生了什么」——受理制之后这是唯一能解释「已接受派发但没人起来」的窗口。
          // 只报最近 ≤5 条（内存态，进程重启即空）：它不是账本，而是「刚才那几次」。
          dispatch: (deps.dispatchReports?.(sessionId) ?? []).map((report) => ({
            cause: report.cause,
            attempted: report.attempted,
            started: report.started,
            failed: report.failed,
            skipped: report.skipped,
            errors: report.errors,
            ...(report.reason === undefined ? {} : { reason: report.reason }),
          })),
          memory: {
            injectedChars: snapshot.memory.injectedChars,
            budget: snapshot.memory.budget,
            truncated: snapshot.memory.truncated,
            files: snapshot.memory.files.map((file) => `${file.track}/${file.name}`),
          },
          roles: snapshot.roles.map((role) => ({ id: role.id, name: role.name, model: role.model })),
        }
      },
    },
    {
      name: `${TOOL_PREFIX}message`,
      description: '给指定成员发直达消息（按 taskId 或成员名定位）。成员可续聊；中断后用同一成员继续。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '按任务定位成员' },
          memberName: { type: 'string', description: '按成员名定位（优先于 taskId）' },
          text: { type: 'string' },
        },
        required: ['text'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        const text = typeof args.text === 'string' ? args.text : ''
        if (text.trim() === '') return { ok: false, error: 'text 不能为空' }
        const taskId = typeof args.taskId === 'string' && args.taskId.trim() !== '' ? args.taskId.trim() : undefined
        const memberName = typeof args.memberName === 'string' ? args.memberName.trim() : ''

        const snapshot = deps.bridge.snapshot(sessionId)
        const byName = memberName === '' ? undefined : snapshot.members.find((member) => member.name === memberName)
        if (memberName !== '' && !byName) {
          return { ok: false, error: `找不到成员 ${memberName}：可用成员 ${snapshot.members.map((m) => m.name).join('、') || '（无）'}` }
        }
        const memberId = byName?.memberId

        const result = await deps.bridge.act(sessionId, { type: 'message', memberId, taskId, text })
        const rejected = rejectedOf(result)
        if (rejected) return rejected
        return { ok: true, notices: result.notices }
      },
    },
    {
      name: `${TOOL_PREFIX}receipt`,
      description:
        '提交任务回执：跑该任务的验收命令（门禁），通过则任务完成、失败则转返工并把证据回发给同一成员。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务 id' },
          note: { type: 'string', description: '成员自述（写入证据说明）' },
        },
        required: ['taskId'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        // 队长路径完全不变；未启用时才尝试成员身份 —— 且开关关闭的 run 里成员也不放行
        // （memberSelfServiceOf 与 status 同一谓词）。放行后仍由 bridge.act 走同一道门禁。
        const leaderMode = deps.bridge.enabled(sessionId)
        const member = leaderMode ? null : memberSelfServiceOf(deps, meta)
        if (!leaderMode && member === null) return { ok: false, error: NOT_ENABLED }

        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        if (taskId === '') return { ok: false, error: 'taskId 不能为空' }
        // 成员只能提交自己被派发任务的回执：传别人的任务一律 FORBIDDEN（不跑门禁、不碰账本）。
        if (member !== null && taskId !== member.binding.taskId) {
          return {
            ok: false,
            code: 'FORBIDDEN',
            error: `只能提交自己被派发任务（${member.binding.taskId}）的回执，${taskId} 不是你被派发的任务`,
          }
        }
        const note = typeof args.note === 'string' && args.note.trim() !== '' ? args.note : undefined

        // 成员的门禁必须落在 run 所属会话上：成员的 agent id 不是任何一份 run 的 sessionId。
        const targetSessionId = member === null ? sessionId : member.sessionId
        const result = await deps.bridge.act(targetSessionId, { type: 'receipt', taskId, note })
        const rejected = rejectedOf(result)
        if (rejected) return rejected

        const task = result.snapshot.tasks.find((item) => item.id === taskId)
        return {
          ok: true,
          taskId,
          status: task?.status,
          evidence: task?.evidence
            ? {
                command: task.evidence.command,
                exitCode: task.evidence.exitCode,
                tail: task.evidence.tail,
                artifacts: task.evidence.artifacts,
              }
            : undefined,
          notices: result.notices,
        }
      },
    },
    {
      name: `${TOOL_PREFIX}memory`,
      description:
        '读写团队记忆（双轨 md）：track=public 为跨项目公共记忆，track=project 为当前项目记忆。'
        + 'write 支持 importance（P0 铁律 / P1 教训 / P2 默认）与 topic；正文按主题文件合并、自动判重并受每文件 40 条配额约束。'
        + 'action=expand 按内联索引里的 ID（mem://<track>/<stem>#<hash12>）取回原文——上下文里只内联了 ID+标题+首句，'
        + '要读完整内容必须显式展开，不要凭标题猜正文。'
        + 'action=curate 把旧 run-*.md / lessons-*.md 的失败证据提炼进 pitfalls.md，dryRun 缺省 true：先预览，再 dryRun:false 执行。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'write', 'expand', 'curate'] },
          track: { type: 'string', enum: ['public', 'project'] },
          name: { type: 'string', description: 'write 时的主题/文件名（如 pitfalls 或 pitfalls.md）；read 时是文件名' },
          body: { type: 'string', description: '兼容旧写入（与 text 二选一）' },
          text: { type: 'string', description: '新写入；单条，或多行（每行一条）' },
          importance: { type: 'string', enum: ['P0', 'P1', 'P2'], description: '缺省 P2' },
          topic: { type: 'string', description: '显式主题 id；缺省按正文路由' },
          supersedes: { type: 'string', description: '要取代的旧正文（只能配一条正文）' },
          id: { type: 'string', description: 'action=expand 的记忆 ID（mem://<track>/<stem>#<hash12>，来自内联索引）' },
          depth: { type: 'number', description: 'action=expand 顺着关联 ID 继续展开的跳数（1~2，缺省 1）' },
          dryRun: { type: 'boolean', description: 'action=curate 的预演开关，缺省 true（不写盘）' },
        },
        // expand 只需要 id（track/name 由 ID 自带）：把它俩设成 required 会逼模型为展开动作编一个 track。
        // read/write 缺 name 的情况下面按业务拒绝，原因文案反而更可读。
        required: ['action'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        const track = args.track === 'public' ? 'public' : 'project'
        const name = typeof args.name === 'string' ? args.name.trim() : ''

        if (args.action === 'list') {
          const snapshot = deps.bridge.snapshot(sessionId)
          return {
            ok: true,
            budget: snapshot.memory.budget,
            injectedChars: snapshot.memory.injectedChars,
            truncated: snapshot.memory.truncated,
            files: snapshot.memory.files,
            quotas: snapshot.memory.quotas,
            legacyFileCount: snapshot.memory.legacyFileCount,
            inline: snapshot.memory.inline ?? [],
            omitted: snapshot.memory.omitted ?? [],
            // r22：落点与退化原因随 list 一起给出（「记忆写在哪个项目」必须可见）。
            projectDir: snapshot.memory.projectDir,
            ...(snapshot.memory.workspace === undefined ? {} : { workspace: snapshot.memory.workspace }),
            ...(snapshot.memory.degraded === true
              ? { degraded: true, degradeReason: snapshot.memory.degradeReason }
              : {}),
          }
        }

        if (args.action === 'expand') {
          const id = typeof args.id === 'string' ? args.id.trim() : ''
          if (id === '') {
            return { ok: false, code: 'EXPAND_BAD_ID', error: 'expand 需要 id（形如 mem://project/<文件名>）' }
          }
          const depth = typeof args.depth === 'number' ? args.depth : undefined
          const expanded = deps.bridge.expandMemory(id, depth, sessionId)
          if (expanded.error !== undefined) return { ok: false, error: expanded.error }
          // 失败码原样透出（AC-11）：模型要能区分「ID 写错 / 越权 / 不存在 / 跳数超限」，
          // 压成一句「展开失败」它只会盲试。
          const payload = expanded.data
          // 条目级 ID：正文就是一条 renderEntry 结果，顺手把它解析成结构化字段给模型看
          // （整文件展开时 body 是多行文件内容，解析不出单条，就不额外加字段）。
          const single =
            payload.code === 'OK' && payload.track !== null && payload.name !== null
              ? parseEntryFile(payload.body, {
                  track: payload.track,
                  file: payload.name,
                  now: deps.now(),
                  fallbackAt: deps.now(),
                }).entries
              : []
          // 行首形态：活动条目 `- [P1] …`；tombstone `- ~~[P1] …~~`。`[P012]` 是字符类，
          // 只能匹配单个字符 P/0/1/2，认不出字面 `[P1]`（D2），必须写成 `P[012]`。
          const entry = single.length === 1 && /^- (?:\[P[012]\]|~~\[P[012]\])/.test(payload.body.trim()) ? single[0] : undefined
          return {
            ok: payload.code === 'OK',
            code: payload.code,
            message: payload.message,
            id: payload.id,
            track: payload.track,
            name: payload.name,
            body: payload.body,
            chars: payload.chars,
            truncated: payload.truncated,
            depth: payload.depth,
            related: payload.related,
            ...(entry === undefined
              ? {}
              : {
                  level: entry.level,
                  revisions: entry.revisions,
                  source: entry.source,
                  at: entry.at,
                }),
          }
        }

        if (args.action === 'curate') {
          // 工具不能默认改盘：dryRun 缺省 true。失败时 act 仍算过快照（面板列表不被清空）。
          const dryRun = args.dryRun !== false
          const acted = await deps.bridge.act(sessionId, { type: 'curateMemory', track, dryRun })
          const rejected = rejectedOf(acted)
          if (rejected) return rejected
          return { ok: true, report: acted.curation, notices: acted.notices }
        }

        if (args.action === 'read') {
          if (name === '') return { ok: false, error: 'name 不能为空' }
          const read = await deps.bridge.readMemoryFile(track, name, undefined, sessionId)
          if (read.error !== undefined) return { ok: false, error: read.error }
          return { ok: true, ...read.data }
        }

        // ---- write：条目级 upsert/supersede ----
        const text = typeof args.text === 'string' ? args.text : undefined
        const body = typeof args.body === 'string' ? args.body : undefined
        if (text !== undefined && body !== undefined && text !== body) {
          return { ok: false, code: 'BAD_REQUEST', error: 'text 与 body 只能给一个' }
        }
        const raw = text ?? body ?? ''

        const topicCatalog = topicCatalogOf(track)
        const allowed = topicCatalog.map((spec) => spec.id)
        let topic: MemoryTopicId | undefined
        if (name !== '') {
          const bare = name.replace(/\.md$/i, '')
          if (!allowed.includes(bare as MemoryTopicId)) {
            return {
              ok: false,
              code: 'BAD_TOPIC',
              error: `主题「${name}」不在${track === 'project' ? '项目' : '公共'}轨的允许列表里；允许：${allowed.join('、')}`,
            }
          }
          topic = bare as MemoryTopicId
        }
        if (args.topic !== undefined) {
          const rawTopic = String(args.topic).trim().replace(/\.md$/i, '')
          if (!allowed.includes(rawTopic as MemoryTopicId)) {
            return {
              ok: false,
              code: 'BAD_TOPIC',
              error: `主题「${rawTopic}」不在${track === 'project' ? '项目' : '公共'}轨的允许列表里；允许：${allowed.join('、')}`,
            }
          }
          if (topic !== undefined && topic !== rawTopic) {
            return {
              ok: false,
              code: 'BAD_TOPIC',
              error: `name 与 topic 指向不同主题：${topic} / ${rawTopic}（只给一个即可）`,
            }
          }
          topic = rawTopic as MemoryTopicId
        }

        const level: MemoryLevel =
          args.importance === 'P0' || args.importance === 'P1' || args.importance === 'P2'
            ? args.importance
            : 'P2'
        if (args.importance !== undefined && args.importance !== 'P0' && args.importance !== 'P1' && args.importance !== 'P2') {
          return { ok: false, code: 'BAD_REQUEST', error: `importance 只能是 P0/P1/P2（收到「${String(args.importance)}」）` }
        }

        // 多行 = 多条；跳过空行/标题/围栏/分隔线，最多 20 条（兼容旧上限）。
        const lines = raw
          .split('\n')
          .map((line) => line.trim())
          .filter(
            (line) =>
              line !== '' &&
              !/^#{1,6}\s/.test(line) &&
              !/^(?:```|~~~)/.test(line) &&
              !/^(?:-{3,}|\*{3,}|_{3,})$/.test(line),
          )
        if (lines.length === 0) return { ok: false, code: 'BAD_TEXT', error: '正文不能为空' }
        const supersedes = typeof args.supersedes === 'string' ? args.supersedes.trim() : ''
        if (supersedes !== '' && lines.length !== 1) {
          return { ok: false, code: 'BAD_REQUEST', error: 'supersedes 只能配一条正文' }
        }
        const at = deps.now()
        const drafts: EntryDraft[] = lines.slice(0, MEMORY_LINES_PER_TASK).map((line) => ({
          track,
          text: line,
          level,
          source: '队长',
          at,
          ...(topic === undefined ? {} : { topic }),
          ...(supersedes === '' ? {} : { supersedes }),
        }))
        const mutated = deps.bridge.mutateMemory(track, drafts, sessionId)
        if (!mutated.ok) return { ok: false, code: mutated.code, error: mutated.message }
        return {
          ok: true,
          track,
          written: drafts.length,
          added: mutated.added,
          updated: mutated.updated,
          revived: mutated.revived,
          superseded: mutated.superseded,
          topics: mutated.topics,
          entries: mutated.entries,
          evicted: mutated.evicted,
          notices: mutated.notices,
          truncated: lines.length > MEMORY_LINES_PER_TASK,
        }
      },
    },
    {
      name: `${TOOL_PREFIX}role`,
      description: '查看或修改角色（含为角色指定 provider/model）。内置角色可改不可删。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'save', 'remove'] },
          role: {
            type: 'object',
            description: '角色对象（save 时必填）',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              duty: { type: 'string' },
              skillIds: { type: 'array', items: { type: 'string' } },
              model: {
                type: 'object',
                properties: {
                  provider: { type: 'string' },
                  model: { type: 'string' },
                  reasoningEffort: { type: 'string', enum: ['low', 'medium', 'high'] },
                },
              },
            },
            required: ['id', 'name'],
          },
          roleId: { type: 'string' },
        },
        required: ['action'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        if (args.action === 'list') {
          return {
            ok: true,
            roles: deps.roles.list().map((role) => ({
              id: role.id,
              name: role.name,
              duty: role.duty,
              skillIds: role.skillIds,
              model: role.model,
              builtin: role.builtin,
              modelNote: role.model ? undefined : '未指定模型：按会话默认模型派发',
            })),
          }
        }

        if (args.action === 'remove') {
          const roleId = typeof args.roleId === 'string' ? args.roleId.trim() : ''
          if (roleId === '') return { ok: false, error: 'roleId 不能为空' }
          const result = await deps.bridge.act(sessionId, { type: 'deleteRole', roleId })
          const rejected = rejectedOf(result)
          if (rejected) return rejected
          return { ok: true, roleId, notices: result.notices }
        }

        const role = args.role as Parameters<RoleRepo['save']>[0] | undefined
        if (!role) return { ok: false, error: 'save 需要 role 对象' }
        const result = await deps.bridge.act(sessionId, { type: 'saveRole', role })
        const rejected = rejectedOf(result)
        if (rejected) return rejected
        return { ok: true, role: deps.roles.get(role.id), notices: result.notices }
      },
    },
    {
      name: `${TOOL_PREFIX}add_tasks`,
      description:
        '往**已存在的**计划里追加任务（同一个 runId：不新建 run、面板不跳回空白）——'
        + '任务跑到一半又想到新活时用它，不要重新 auto_team_plan。'
        + '幂等：内容完全相同的条目进 skipped、added 为空、任务总数不变；'
        + '原子：任一条验收为空 / 写域非法 / 依赖不存在或成环，整批拒绝且一条都不落盘。'
        + '追加出来的任务一律处于待派发，下一次 auto_team_dispatch 会连它们一起捕获。'
        + `验收命令必须真能执行（exit 0 才算过），可直接用：${ACCEPTANCE_TEMPLATES.join(' / ')}（尖括号换成实际值）。`,
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'auto_team_plan 返回的 runId（必填；追加不会新建 run）' },
          tasks: {
            type: 'array',
            description: '要追加的任务（id 缺省按 t<next> 递增；依赖可指向既有任务或同批任务）',
            items: TASK_ITEM_SCHEMA,
          },
        },
        required: ['runId', 'tasks'],
      },
      async handler(args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        const runId = typeof args.runId === 'string' ? args.runId.trim() : ''
        if (runId === '') {
          return {
            ok: false,
            code: 'NO_PLAN',
            error:
              'auto_team_add_tasks 必须带 runId：追加是「改变既有计划」而不是新建 run。先 auto_team_plan 拿 runId（或 auto_team_status 读当前的）。',
          }
        }
        const state = deps.store.load(runId)
        if (!state || state.plan.sessionId !== sessionId) {
          return {
            ok: false,
            code: 'NOT_FOUND',
            error: `找不到运行 ${runId}：当前会话没有这个 runId（本工具不会新建 run，请先 auto_team_plan）`,
          }
        }

        const rawTasks = Array.isArray(args.tasks) ? (args.tasks as PlanDraftTask[]) : []
        if (rawTasks.length === 0) {
          return { ok: false, code: 'BAD_REQUEST', error: 'tasks 不能为空：追加至少要带 1 条任务' }
        }

        const scoped = normalizeDraftScopes(rawTasks)
        if (!scoped.ok) return { ok: false, code: 'BAD_REQUEST', error: scoped.error }

        // 空验收：整批拒绝，且**在 save 之前**返回 —— AC-6 的判据是「store 内容逐字不变」。
        const emptyAcceptance = emptyAcceptanceOf(
          scoped.tasks.map((task, index) => ({
            id: draftIdOf(task, index),
            title: (task.title ?? '').trim(),
            acceptance: (task.acceptance ?? '').trim(),
            writeScopes: task.writeScopes,
          })),
          deps.scripts,
        )
        if (emptyAcceptance !== null) return { ok: false, code: 'BAD_REQUEST', error: emptyAcceptance }

        const extended = extendPlan(state.plan, scoped.tasks, deps.now())
        if (!extended.ok) {
          // 已取消/已终止的计划：extendPlan 的 reason 没有 runId，这里补齐（AC-10）。
          return { ok: false, code: 'BAD_REQUEST', error: closedRunReason(state.plan, runId) ?? extended.reason }
        }
        // 全被跳过时**不动盘**：幂等判据是连文件字节都不变，而不是「写一遍相同内容」。
        if (extended.added.length > 0) deps.store.save({ ...state, plan: extended.plan })
        // r13 AC-8：追加成功后同样零点击自动派发（新任务立刻进入就绪队列）。
        if (extended.added.length > 0) deps.autoDispatch?.(sessionId, extended.plan.runId, 'tasks-added')

        return {
          ok: true,
          runId: extended.plan.runId,
          added: extended.added,
          skipped: extended.skipped,
          tasks: extended.plan.tasks.length,
          ready: readyTasks(extended.plan.tasks),
          note:
            extended.added.length === 0
              ? '所有条目与既有任务内容相同，已跳过（计划未改动，runId 不变）。'
              : '已追加进同一个计划（runId 不变）；下一次 auto_team_dispatch 会连新任务一起捕获。',
        }
      },
    },
  ]
}

/** 注册全部工具（宿主缺 tools 服务时由 adapters 静默跳过）。 */
export function registerTools(ctx: HostContext, deps: ToolsDeps): void {
  for (const spec of buildToolSpecs(deps)) registerTool(ctx, spec)
}

/** 供 QA 与单测使用的「未启用」文案（唯一来源，避免两处措辞漂移）。 */
export const NOT_ENABLED_MESSAGE = NOT_ENABLED

export type { RejectionCode }
