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
import type { ActResult, PanelSnapshot, Plan, PlanTask, RejectionCode, Result } from '../shared/types.ts'
import { MEMORY_LINES_PER_TASK, TOOL_PREFIX } from './config.ts'
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
   * 本 run 的工作区名（r14 AC-14/AC-15）：`auto_team_plan` 落盘时写进 `RunState.project`。
   *
   * **必须与 `LibraryDeps.workspace` 是同一个字符串**（装配层注入，`host/index.ts` 一处取值）：
   * 两个字符串只要差一个字符，同一个工作区就会在左栏裂成两个项目桶。
   * 缺省（单测桩）= 不写 project，旧 run 归入「历史运行（未记录工作区）」——不猜、不迁移。
   */
  workspace?: string
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
    title: { type: 'string' },
    roleId: { type: 'string', description: '执行该任务的角色 id' },
    dependsOn: {
      type: 'array',
      items: { type: 'string' },
      description: '依赖的任务 id（可指向既有任务，也可指向同批新任务）',
    },
    acceptance: {
      type: 'string',
      description: '验收命令（门禁据此产出证据）；不能是空白字符串，空验收会整批拒绝',
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
        + '返回 runId，派发时必须带上它；后续要加任务用 auto_team_add_tasks，不要新开计划。',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: '要达成的目标' },
          maxConcurrent: { type: 'integer', description: '并发上限，默认 3，硬上限 8' },
          tasks: {
            type: 'array',
            description: '任务列表（依赖必须指向同一列表里的 id；1 条也合法）',
            items: TASK_ITEM_SCHEMA,
          },
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
        const draft = buildPlan(
          {
            sessionId,
            goal: typeof args.goal === 'string' ? args.goal : '',
            maxConcurrent: typeof args.maxConcurrent === 'number' ? args.maxConcurrent : undefined,
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

        const state: RunState = {
          version: RUN_STATE_VERSION,
          plan: draft.plan,
          plannedAt: at,
          messages: [],
          bindings: [],
          routeAudits: [],
          // r14 AC-14：r13 早就有这个字段与投影，只是从没被写过 —— 左栏因此把每次新 run
          // 都归进历史桶（「历史运行（未记录工作区）」）。写入点只在这里（读的是装配层那个与 library 完全同源的字符串）。
          ...(deps.workspace === undefined ? {} : { project: deps.workspace }),
        }
        deps.store.save(state)
        // r13 AC-8：计划落盘后**零点击**自动派发（notice 文案同步改成「已自动派发」，不再要求用户手动确认）。
        deps.autoDispatch?.(sessionId, draft.plan.runId, 'plan-saved')

        return {
          ok: true,
          runId: draft.plan.runId,
          plannedAt: state.plannedAt,
          maxConcurrent: draft.plan.maxConcurrent,
          tasks: draft.plan.tasks.map(taskBrief),
          ready: readyTasks(draft.plan.tasks),
          blocked: blockedTasks(draft.plan.tasks),
          members: 0,
          note: '计划已保存；符合依赖与并发条件的任务会自动派发，无需再手动调用 dispatch。',
        }
      },
    },
    {
      name: `${TOOL_PREFIX}dispatch`,
      description:
        '按依赖顺序派发就绪任务并创建成员（并发受 maxConcurrent 与宿主上限限制）。必须带 plan 返回的 runId。'
        + '**本工具受理后立即返回**（accepted/dispatching）：成员在后台创建，你不需要、也不应该在同一轮等待成员；'
        + '进度用 auto_team_status 查，失败了会在下一次返回里看到。',
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
      description: '读取当前会话的执行计划、成员状态、门禁证据、消息账本、记忆注入预算与角色列表。',
      parameters: { type: 'object', properties: {}, required: [] },
      async handler(_args, meta) {
        const sessionId = sessionOf(meta)
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }
        const snapshot: PanelSnapshot = deps.bridge.snapshot(sessionId)
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
          messages: snapshot.messages.slice(-20),
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
        if (!deps.bridge.enabled(sessionId)) return { ok: false, error: NOT_ENABLED }

        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        if (taskId === '') return { ok: false, error: 'taskId 不能为空' }
        const note = typeof args.note === 'string' && args.note.trim() !== '' ? args.note : undefined

        const result = await deps.bridge.act(sessionId, { type: 'receipt', taskId, note })
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
        '读写团队记忆（双轨 md）：track=public 为跨项目公共记忆，track=project 为当前项目记忆。写入自动限制行数并落来源标注。'
        + 'action=expand 按内联索引里的 ID（mem://<track>/<stem>）取回原文——上下文里只内联了 ID+标题+首句，'
        + '要读完整内容必须显式展开，不要凭标题猜正文。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'write', 'expand'] },
          track: { type: 'string', enum: ['public', 'project'] },
          name: { type: 'string', description: '文件名（单段，自动补 .md）' },
          body: { type: 'string' },
          id: { type: 'string', description: 'action=expand 的记忆 ID（mem://<track>/<stem>，来自内联索引）' },
          depth: { type: 'number', description: 'action=expand 顺着关联 ID 继续展开的跳数（1~2，缺省 1）' },
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
            inline: snapshot.memory.inline ?? [],
            omitted: snapshot.memory.omitted ?? [],
          }
        }

        if (args.action === 'expand') {
          const id = typeof args.id === 'string' ? args.id.trim() : ''
          if (id === '') {
            return { ok: false, code: 'EXPAND_BAD_ID', error: 'expand 需要 id（形如 mem://project/<文件名>）' }
          }
          const depth = typeof args.depth === 'number' ? args.depth : undefined
          const expanded = deps.bridge.expandMemory(id, depth)
          if (expanded.error !== undefined) return { ok: false, error: expanded.error }
          // 失败码原样透出（AC-11）：模型要能区分「ID 写错 / 越权 / 不存在 / 跳数超限」，
          // 压成一句「展开失败」它只会盲试。
          const payload = expanded.data
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
          }
        }

        if (name === '') return { ok: false, error: 'name 不能为空' }

        if (args.action === 'read') {
          const read: Result<{ track: string; name: string; body: string; chars: number }> =
            await deps.bridge.readMemoryFile(track, name)
          if (read.error !== undefined) return { ok: false, error: read.error }
          return { ok: true, ...read.data }
        }

        const body = typeof args.body === 'string' ? args.body : ''
        if (body.trim() === '') return { ok: false, error: 'body 不能为空' }
        const lines = body.split('\n')
        const clipped = lines.slice(0, MEMORY_LINES_PER_TASK).join('\n')

        const result = await deps.bridge.act(sessionId, { type: 'saveMemory', track, name, body: clipped })
        const rejected = rejectedOf(result)
        if (rejected) return rejected
        return {
          ok: true,
          track,
          name,
          lines: Math.min(lines.length, MEMORY_LINES_PER_TASK),
          truncated: lines.length > MEMORY_LINES_PER_TASK,
          notices: result.notices,
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
