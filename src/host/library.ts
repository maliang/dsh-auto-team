/**
 * 左侧栏「项目库」装配（r13 AC-14~AC-18、AC-21、AC-23）。
 *
 * 为什么单独成模块而不是塞进 bridge：
 *  - 左边栏和右边栏看的是**同一份数据**（`RunDetailView`）。装配只允许一处，bridge 只转派，
 *    否则两处拼装迟早漂移（本项目历史 bug 族：同一数据两条链路给不同结论）。
 *  - `snapshot` 轮询期间**不得**装配 library（AC-23：快照路径对 library 的调用数必须为 0）。
 *    独立对象 + 自带 5s 缓存，谁在什么时候调用一目了然。
 *
 * 三条纪律：
 *  1. 文本（token 千分位 / 时长）一律由 `format.ts` / `team/usage.ts` 生成，本模块不拼字符串；
 *  2. 旧 run 缺 `project` 归「历史运行（未记录工作区）」并固定末位，缺 `usage` 显示「不可得」而不是 0；
 *  3. 缓存键只读**目录 mtime + 文件数**，不逐文件 parse；没有目录句柄时退化为 5s TTL 缓存。
 */
import { readdirSync, statSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'

import { HISTORY_PAGE_SIZE, LIBRARY_CACHE_MS, PROJECT_RUN_LIMIT } from '../shared/const.ts'
import type {
  DurationCell,
  FlowEdgeView,
  FlowNodeView,
  FlowView,
  LibraryView,
  MemberView,
  MemoryItemView,
  PlanTask,
  ProjectRunSummaryView,
  ProjectView,
  Role,
  RoleUsageView,
  RunDetailView,
  RunSummary,
  TaskDetailView,
  TokenTotals,
  UsageCell,
} from '../shared/types.ts'
import { roleStateOf, roleUsageCellOf } from '../shared/role-view.ts'
// 只 import **类型**：adapters 是宿主 API 的唯一入口，library 不该在装配层之外碰 ctx。
// host→host 的类型 import 不产生运行期依赖，也不会成环（adapters 不 import library）。
import type { HostWorkspaceEntry } from './adapters.ts'
// r54：成员行的状态映射与模型路由文案**复用 bridge 的同一份实现**（`toMemberStatus` /
// `describeRoute` 都是 bridge 导出的纯函数），否则历史详情与快照会各写一套映射而漂移。
// bridge 不 import library（库是经 `BridgeDeps.libraryView` 端口注入的），不存在运行期回环。
import { describeRoute, toMemberStatus } from './bridge.ts'
import { durationCellOf, taskDurationCellOf, usageCellOf } from './format.ts'
import { defaultSettings } from './settings.ts'
import { finishedAtOf, type RunState } from './store.ts'
import { isTerminalTaskStatus } from './team/dispatch.ts'
import { pendingViewOf } from './team/confirm.ts'
import { secondsText, stallNoteOf, stallOf } from './team/stall.ts'
import { runUsageOf, taskUsageOf } from './team/usage.ts'

/** 历史桶的固定 id：不是真实路径，客户端据此给末位与灰态。 */
export const UNKNOWN_PROJECT_ID = '__unknown__'
/** 历史桶的展示名（r14 AC-14：旧 run 没有 `project` 字段，不猜工作区、不迁移）。 */
export const UNKNOWN_PROJECT_NAME = '历史运行（未记录工作区）'
/** 每个项目最多带多少条记忆索引（AC-17；与项目最近 run 的 20 条同量级）。 */
const MEMORY_INDEX_LIMIT = 50
/** 没有数字时的统一人话（`UsageCell.reason`，会进 tooltip）。 */
const NO_USAGE_REASON = '宿主未上报本 run 的用量'

export interface LibraryQuery {
  sessionId?: string
  runId?: string
}

/**
 * 库能拿到的角色投影（r54）：`id`/`name` 用于任务 `roleName` 与 legacy 成员名，
 * `model` 给成员行的 `modelRoute`（唯一输入是 `bridge.describeRoute`，不另写一份格式）。
 *
 * `model` 类型上可选（旧装配可以不投影），但**装配层必须带上 model**：路由文案只在
 * `membersOfState` 里由 `role.model` 推导，丢了这个字段，角色明明配了 provider/model
 * 也会被渲染成「会话默认」——成员行路由失真且没有任何报错。可选的唯一用途是让
 * 不接角色仓的单测/旧宿主仍能装配出成员行。
 */
type LibraryRole = Pick<Role, 'id' | 'name'> & { model?: Role['model'] }

/** 装配依赖：全部由 `index.ts` 注入，本模块自己不读环境、不碰 ctx（可单测的前提）。 */
export interface LibraryDeps {
  store: RunsStorePort
  /** 当前工作区绝对路径：项目列表里必须始终有它（AC-15「∪ 当前工作区」）。 */
  workspace: string
  now?: () => number
  /** 公共记忆索引（`<home>/.dsh/auto-team/memory/public`）。 */
  publicMemories: () => MemoryItemView[]
  /** 某项目的项目记忆索引（`<workspace>/.auto-team/memory`）。 */
  projectMemories: (workspace: string) => MemoryItemView[]
  /**
   * 角色名表（可选）：历史 run 详情里的 `roleName` 只能从角色仓读，
   * 装配层没接时退化成 roleId（可读但不友好，绝不假装是别的名字）。
   */
  roles?: () => ReadonlyArray<LibraryRole>
  /**
   * runs 目录（可选）：给缓存键提供 mtime + 文件数。
   * 不传也能用（退化为 5s TTL 缓存），但 100 run 时冷/热判据靠它（AC-23）。
   */
  runsDir?: string
  /**
   * 宿主工作区注册表（r19，可选）：项目名的**真源**。
   *
   * 为什么需要：run 落盘时记录的 `project` 在桌面宿主里可能是 profile 目录
   * （`~/.dsh/profiles/desktop`），basename 展示就是 `desktop`；用户自己改名后的
   * 工作区标题（`nengtan` / `tuoluojiang`）只存在宿主的 registry 里。
   * 另外 `sessionIds` 能把老 run（project 写歪）按会话 id 反查回真实工作区。
   *
   * 缺省 = 完全旧行为（路径 basename 展示、project 原样分桶），单测与旧宿主都走这条。
   */
  workspaces?: () => HostWorkspaceEntry[]
  /**
   * 可配参数读取口（可选）：装配层接**真设置**（`settingsRepo.read()`），
   * 历史详情的停滞阈值据此解析，而不是永远读缺省值。
   *
   * 回退规则：缺省 / 抛错 / 非正数（含 0、NaN、Infinity）→ 回落
   * `defaultSettings().stallMs`，**绝不取 0**（0 会把每个在跑成员都判成停滞）。
   * 每次详情装配只读一次，同一个值给该 run 的所有成员用。
   */
  settings?: () => { stallMs?: number }
}

/**
 * `RunsStore` 的最小读口。
 *
 * 只声明本模块真正用到的两个方法：单测可以塞一个内存桩，不必造真实目录；
 * 同时避免 `library.ts` 反向依赖 `store.ts` 的写路径（写入口只允许有一个）。
 */
export interface RunsStorePort {
  list(): RunSummary[]
  load(runId: string): RunState | null
}

/** 项目路径 → 展示名（basename）；空/缺省 = 「历史运行（未记录工作区）」。纯函数，可单测。 */
export function projectNameOf(path: string | undefined): string {
  const text = (path ?? '').trim().replace(/[/\\]+$/, '')
  if (text === '') return UNKNOWN_PROJECT_NAME
  const name = basename(text)
  return name === '' || name === '/' ? text : name
}

/**
 * 工作区白名单（AC-16 的服务端闸）：`/memory?workspace=` 只允许已知项目根及其子目录。
 *
 * 「已知」= 当前工作区 ∪ 现有 run 的 `project`（与项目列表同源，不另建白名单）。
 * `resolve` 后必须**位于**某个已知根内 —— 否则 `../../` 一次就能读到仓库外的记忆。
 */
export function isKnownWorkspace(deps: LibraryDeps, path: string): boolean {
  const text = (path ?? '').trim()
  if (text === '') return false
  const target = resolve(text)
  for (const root of knownWorkspaces(deps)) {
    if (target === root || target.startsWith(`${root}${sep}`)) return true
  }
  return false
}

function knownWorkspaces(deps: LibraryDeps): string[] {
  const out: string[] = []
  const push = (value: string | undefined): void => {
    const text = (value ?? '').trim()
    if (text === '') return
    const abs = resolve(text)
    if (!out.includes(abs)) out.push(abs)
  }
  push(deps.workspace)
  for (const summary of deps.store.list()) push(summary.project)
  // r19：项目桶的 path 现在可能是 registry 的工作区路径（老 run 的 project 写的是 profile 目录，
  // 按 sessionId 映射后桶路径变成真实工作区）——记忆读口必须认它，否则点项目记忆会 403。
  for (const entry of deps.workspaces?.() ?? []) push(entry.path)
  return out
}

/**
 * 装配整页（AC-15/AC-16/AC-21）。
 *
 * 顺序约定：已知项目按 `lastActiveAt` 倒序，「历史运行（未记录工作区）」固定末位；
 * 「全局」不在 `projects` 里，它固定占据列表首行（`global.memories`），否则切换会串轨。
 */
export function buildLibrary(deps: LibraryDeps, query: LibraryQuery = {}): LibraryView {
  const at = nowOf(deps)
  const summaries = deps.store.list()
  const view: LibraryView = {
    projects: groupProjects(deps, summaries, at),
    global: { memories: deps.publicMemories().slice(0, MEMORY_INDEX_LIMIT) },
    currentProject: (deps.workspace ?? '').trim(),
    // r17：历史页在 snapshot 缺席时会退回本列表（`props.snapshot?.runs ?? props.library?.runs`），
    // 所以这里必须与 `bridge.historyOf` 派生同一份 `UsageCell`（`text` + 六项 `details`）；
    // 否则同一条 run 在两条链路上一个有六项、一个只有合计。只派生不落盘。
    runs: summaries
      .slice(0, HISTORY_PAGE_SIZE)
      .map((summary) => ({ ...summary, usage: usageCellOf(summary.usageTotals, NO_USAGE_REASON) })),
  }
  const runId = (query.runId ?? '').trim()
  if (runId !== '') {
    const state = deps.store.load(runId)
    // 非法 / 不存在的 runId 不报错：返回不带 detail 的库，客户端显示「这次运行已不存在」。
    if (state !== null) view.detail = runDetailOf(state, at, roleNameOf(deps), roleListOf(deps), stallMsOf(deps))
  }
  return view
}

export interface LibraryCache {
  view(query?: LibraryQuery): LibraryView
  invalidate(): void
}

/**
 * library 缓存（AC-23）：键 = 目录 mtime : json 文件数 : runId，命中且未过 TTL 直接返回。
 *
 * 没有 `runsDir` 时键恒为 `live`，只能靠 TTL 过期 —— 语义仍正确（最多旧 5 秒），
 * 只是少了「写入后立即失效」的精确性。
 */
export function createLibraryCache(deps: LibraryDeps, ttlMs: number = LIBRARY_CACHE_MS): LibraryCache {
  let hit: { key: string; at: number; view: LibraryView } | null = null
  return {
    view(query: LibraryQuery = {}): LibraryView {
      const key = cacheKeyOf(deps, query)
      const at = nowOf(deps)
      if (hit !== null && hit.key === key && at - hit.at < ttlMs) return hit.view
      const view = buildLibrary(deps, query)
      hit = { key, at, view }
      return view
    },
    invalidate(): void {
      hit = null
    },
  }
}

function cacheKeyOf(deps: LibraryDeps, query: LibraryQuery): string {
  const runId = (query.runId ?? '').trim()
  const dir = (deps.runsDir ?? '').trim()
  if (dir === '') return `live:${runId}`
  try {
    const stat = statSync(dir)
    const count = readdirSync(dir).filter((entry) => entry.endsWith('.json')).length
    return `${stat.mtimeMs}:${count}:${runId}`
  } catch {
    return `missing:${runId}`
  }
}

/**
 * 一个 run 的完整详情（历史详情的宿主唯一装配，AC-18/AC-21）。
 *
 * 当前 run 由客户端 `buildRunDetail` 从快照装配、历史 run 由这里装配 —— 两边字段口径
 * 必须逐字一致（TECHNICAL §2.4）：口算规则只抄一次在这里，客户端不得二次计算。
 *
 * r54：`members` 与快照的 `membersOf` 同口径（见 `membersOfState`），拿不到名单时**省略**该字段。
 *
 * `stallMs` 由 `buildLibrary` 经 `stallMsOf(deps)` 解析后传入（真设置优先），
 * 一次装配只解析一次、所有成员共用；直接调用方不传时退化为缺省阈值。
 */
export function runDetailOf(
  state: RunState,
  at: number,
  roleNames?: ReadonlyMap<string, string>,
  roles: ReadonlyArray<LibraryRole> = [],
  stallMs: number = defaultSettings().stallMs,
): RunDetailView {
  const tasks: TaskDetailView[] = state.plan.tasks.map((task) =>
    taskDetailOf(state, task, at, roleNames),
  )
  const detail: RunDetailView = {
    runId: state.plan.runId,
    sessionId: state.plan.sessionId,
    planStatus: state.plan.status,
    plannedAt: state.plannedAt,
    usage: runUsageOf(state.usage),
    duration: runDurationOf(state, at),
    roles: rolesOf(tasks),
    tasks,
    flow: flowOf(tasks),
  }
  const members = membersOfState(state, at, roles, roleNames, stallMs)
  if (members !== undefined) detail.members = members
  if (state.project !== undefined) detail.project = state.project
  // r21：终止原因与结束时刻同源落盘（旧 run 文件没有该字段 → 字段缺席，客户端显示不可得）。
  if (state.termination !== undefined) detail.terminationReason = state.termination.reason
  const finishedAt = finishedAtOf(state)
  if (finishedAt !== undefined) detail.finishedAt = finishedAt
  const pending = pendingViewOf(state.pendingConfirmation, at)
  if (pending !== undefined) detail.pendingConfirmation = pending
  return detail
}

/**
 * 一个 run 的成员行（r54）：与快照的 `bridge.membersOf` **同一口径**。
 *
 * 为什么在 library 里再装一次：历史详情的唯一装配点是 `runDetailOf`，而 bridge 的
 * `membersOf` 是 `createBridge` 里的闭包、拿不到；但「哪些 binding 算成员 / 状态怎么归并 /
 * taskIds 收全集」的判定必须逐条一致（否则同一个 run 在快照与历史抽屉里显示成两副样子）：
 * 状态映射与路由文案直接复用 bridge 导出的纯函数（`toMemberStatus` / `describeRoute`），
 * 只有停滞/最后活动这两块判定在这里按同样规则重写（bridge 未导出它们的实现）。
 *
 * **拿不到名单**（旧 run 没落 binding，任务也没记 legacy `task.memberId`）→ 返回 `undefined`，
 * 由 `runDetailOf` 省略该字段；绝不返回 `[]` 把「不知道」冒充成「确实没有成员」。
 */
function membersOfState(
  state: RunState,
  at: number,
  roles: ReadonlyArray<LibraryRole>,
  roleNames: ReadonlyMap<string, string> | undefined,
  stallMs: number,
): MemberView[] | undefined {
  const hasLegacy = state.plan.tasks.some((task) => task.memberId !== undefined)
  if (state.bindings.length === 0 && !hasLegacy) return undefined

  const roleById = new Map(roles.map((role) => [role.id, role]))
  const taskById = new Map(state.plan.tasks.map((task) => [task.id, task]))
  const nameOf = (roleId: string): string => {
    const name = (roleById.get(roleId)?.name ?? roleNames?.get(roleId) ?? '').trim()
    return name === '' ? roleId : name
  }
  // `describeRoute` 只读 `.model`：把库侧的窄投影按 Role 形状喂进去，不复制它的格式串。
  const routeOf = (roleId: string): string => {
    const role = roleById.get(roleId)
    return describeRoute(role === undefined ? undefined : ({ model: role.model } as unknown as Role))
  }
  const stallFields = (
    memberId: string,
    status: MemberView['status'],
  ): Pick<MemberView, 'stalled' | 'stalledForMs' | 'stalledSecondsText' | 'stallReason' | 'stallNote'> => {
    // 只有「在跑」的成员才有停滞语义：停下来的成员静默是应该的，不是停滞。
    if (status !== 'running') {
      return { stalled: false, stalledForMs: 0, stalledSecondsText: '', stallReason: 'none', stallNote: '' }
    }
    // r32：只看 `progress`，绝不拿 spawnedAt 当基线（没信号 = `unreported` 证据不足）。
    const judge = stallOf(state.progress?.[memberId]?.at, at, stallMs)
    return {
      stalled: judge.stalled,
      stalledForMs: judge.stalledForMs,
      stalledSecondsText: judge.stalled ? secondsText(judge.stalledForMs) : '',
      stallReason: judge.reason,
      stallNote: stallNoteOf(judge.reason),
    }
  }
  const lastEventAtOf = (memberId: string, fallback: number): number => {
    let last = fallback
    const progressAt = state.progress?.[memberId]?.at
    if (typeof progressAt === 'number' && Number.isFinite(progressAt)) last = Math.max(last, progressAt)
    for (const message of state.messages) {
      if (message.toMemberId === memberId || message.from === memberId) last = Math.max(last, message.at)
    }
    for (const task of state.plan.tasks) {
      if (task.memberId !== memberId || !task.evidence) continue
      last = Math.max(last, task.evidence.at)
    }
    return last
  }

  const priorityOf = (binding: RunState['bindings'][number]): number => {
    if (binding.stopping === true) return 3
    if (binding.stoppedAt !== undefined) return 2
    const task = taskById.get(binding.taskId)
    if (task && (task.status === 'running' || task.status === 'gate' || task.status === 'interrupted')) return 1
    return 0
  }
  // 已退役的历史成员默认不再展示；唯独「确认停止」的成员留一个「已停止」位。
  const chosen = new Map<string, RunState['bindings'][number]>()
  const order: string[] = []
  for (const binding of state.bindings) {
    if (binding.retired === true && binding.stoppedAt === undefined) continue
    const current = chosen.get(binding.memberId)
    if (current === undefined) {
      chosen.set(binding.memberId, binding)
      order.push(binding.memberId)
      continue
    }
    if (priorityOf(binding) >= priorityOf(current)) chosen.set(binding.memberId, binding)
  }
  // 成员复用后「任务 → 成员」是一对多：跳转判定要全集，按 binding 追加序去重、含已退役 binding。
  const taskIdsOf = new Map<string, string[]>()
  for (const binding of state.bindings) {
    const list = taskIdsOf.get(binding.memberId)
    if (list === undefined) taskIdsOf.set(binding.memberId, [binding.taskId])
    else if (!list.includes(binding.taskId)) list.push(binding.taskId)
  }

  const views: MemberView[] = []
  for (const memberId of order) {
    const binding = chosen.get(memberId)
    if (binding === undefined) continue
    const stopped = binding.stoppedAt !== undefined
    const task = taskById.get(binding.taskId)
    const status: MemberView['status'] =
      binding.stopping === true && task?.status !== 'done'
        ? 'stopping'
        : stopped
          ? 'stopped'
          : toMemberStatus(task?.status ?? 'pending')
    views.push({
      memberId: binding.memberId,
      name: binding.name,
      roleId: binding.roleId,
      taskId: binding.taskId,
      taskIds: taskIdsOf.get(memberId) ?? [binding.taskId],
      status,
      ...(binding.stopping === true ? { stopping: true } : {}),
      ...(binding.stoppedAt !== undefined ? { stoppedAt: binding.stoppedAt } : {}),
      spawnedAt: binding.spawnedAt,
      ...stallFields(binding.memberId, status),
      lastEventAt: lastEventAtOf(binding.memberId, binding.spawnedAt),
      modelRoute: routeOf(binding.roleId),
      canResume: status !== 'done',
    })
  }

  // 兼容 v1 落盘的裸 Plan：`task.memberId` 有值但没有 binding（与 bridge 的兜底一致）。
  const seen = new Set(order)
  for (const task of state.plan.tasks) {
    const memberId = task.memberId
    if (memberId === undefined || seen.has(memberId)) continue
    seen.add(memberId)
    const status = toMemberStatus(task.status)
    views.push({
      memberId,
      name: nameOf(task.roleId),
      roleId: task.roleId,
      taskId: task.id,
      taskIds: state.plan.tasks.filter((item) => item.memberId === memberId).map((item) => item.id),
      status,
      ...stallFields(memberId, status),
      lastEventAt: lastEventAtOf(memberId, state.plannedAt),
      modelRoute: routeOf(task.roleId),
      canResume: status !== 'done',
    })
  }
  return views
}

/** run 级用时：`plannedAt → finishedAt`；进行中用 now，终态却缺结束时刻记「不可得」。 */
export function runDurationOf(state: RunState | null, at: number): DurationCell {
  if (state === null) return durationCellOf({ state: 'unavailable', now: at })
  // r20：与 `bridge.runDurationOf` / `store.list()` 同源（落盘值优先，历史 run 走可核实回退）。
  const endedAt = finishedAtOf(state)
  const ended = endedAt !== undefined
  const terminal = state.plan.status === 'cancelled' || state.plan.status === 'terminated'
  if (!ended && terminal) return durationCellOf({ startAt: state.plannedAt, state: 'unavailable', now: at })
  return durationCellOf({
    startAt: state.plannedAt,
    ...(ended ? { endAt: endedAt } : {}),
    state: ended ? 'done' : 'running',
    now: at,
  })
}

/**
 * 任务级用时（r24）：判定与 `bridge.taskDurationsOf` 共用 `taskDurationCellOf`，两处不得漂移。
 *
 * 已结束（done/skipped/cancelled）但缺起止记录 → 不可得 + 原因（旧 run 早于记录上线）；
 * 只有确实没开始的 pending/blocked 才显示「未开始」。
 */
export function taskDurationOf(state: RunState, task: PlanTask, at: number): DurationCell {
  const time = state.taskTimes?.[task.id]
  return taskDurationCellOf({
    status: task.status,
    ...(time?.startedAt === undefined ? {} : { startedAt: time.startedAt }),
    ...(time?.endedAt === undefined ? {} : { endedAt: time.endedAt }),
    terminal: isTerminalTaskStatus(task.status),
    now: at,
  })
}

function taskDetailOf(
  state: RunState,
  task: PlanTask,
  at: number,
  roleNames?: ReadonlyMap<string, string>,
): TaskDetailView {
  const memberId = state.bindings.find((binding) => binding.taskId === task.id)?.memberId ?? task.memberId
  const view: TaskDetailView = {
    id: task.id,
    title: task.title,
    roleId: task.roleId,
    roleName: roleNames?.get(task.roleId) ?? task.roleId,
    status: task.status,
    dependsOn: [...task.dependsOn],
    acceptance: task.acceptance,
    usage: taskUsageOf(state.usage, task.id, memberId),
    duration: taskDurationOf(state, task, at),
    messageCount: state.messages.filter((message) => message.taskId === task.id).length,
  }
  if (task.writeScopes !== undefined) view.writeScopes = [...task.writeScopes]
  if (task.evidence !== undefined) view.evidence = task.evidence
  if (task.attempts !== undefined) view.attempts = task.attempts
  if (task.waitReason !== undefined) view.waitReason = task.waitReason
  // r21 修订/作废事实：发生过才存在。旧 run 文件没有这些键 → 字段缺席，客户端显示「未修订」，
  // 这里不得补 0 / 空串（那会把「没记录」伪装成「没发生」）。
  if (task.revisedAt !== undefined) view.revisedAt = task.revisedAt
  if (task.revisionNote !== undefined && task.revisionNote !== '') view.revisionNote = task.revisionNote
  if (task.cancelledAt !== undefined) view.cancelledAt = task.cancelledAt
  if (task.cancelReason !== undefined && task.cancelReason !== '') view.cancelReason = task.cancelReason
  if (task.cancelledBy !== undefined) view.cancelledBy = task.cancelledBy
  // r33：待回执是宿主现算的展示事实；只有真的有待回执事实时才出现该键。
  if (task.silentFinish !== undefined) view.awaitingReceipt = true
  return view
}

/**
 * 角色条 / 角色卡片：按任务里**首次出现顺序**分组，`usage` = 该角色名下任务的合计。
 *
 * r14 AC-7/AC-8/AC-9：角色态 / 当前任务 / 用时 / 用量口径**都不在这里算**——统一走
 * `shared/role-view.ts` 的 `roleStateOf` + `roleUsageCellOf`，与客户端
 * `viewModel.roleUsageOf` 是同一份实现，两侧文本因此逐字相等（AC-17 的抽屉 vs 右栏
 * 比对靠这条构造保证；r13 的「宿主累加已知项、客户端判不可得」两套口径已由 QA D2 证实
 * 会给出两种结论，故把聚合也一并收进 shared）。
 */
export function rolesOf(tasks: TaskDetailView[]): RoleUsageView[] {
  const order: string[] = []
  const buckets = new Map<string, TaskDetailView[]>()
  for (const task of tasks) {
    const list = buckets.get(task.roleId)
    if (list === undefined) {
      order.push(task.roleId)
      buckets.set(task.roleId, [task])
    } else {
      list.push(task)
    }
  }
  return order.map((roleId) => {
    const list = buckets.get(roleId) ?? []
    const name = list[0]?.roleName ?? roleId
    const state = roleStateOf(list)
    const view: RoleUsageView = {
      roleId,
      name,
      tasks: list.length,
      usage: roleUsageCellOf(list.map((task) => task.usage)),
      // r16 AC-16：任务编号与状态按计划顺序投影；标题仍来自任务详情，不复制第二份真相。
      taskRefs: list.map((task) => ({ id: task.id, status: task.status })),
      done: state.done,
      state: state.state,
      stateText: state.stateText,
      duration: state.duration,
    }
    if (state.activeTaskId !== undefined) view.activeTaskId = state.activeTaskId
    if (state.activeTaskTitle !== undefined) view.activeTaskTitle = state.activeTaskTitle
    return view
  })
}

/**
 * 流转图装配（AC-5）：列 = 依赖深度（0 起），行 = 同列内计划顺序。
 *
 * 只画图不排版：列距/行距/画布尺寸在客户端 CSS 里（`views/FlowCanvas`）。
 * r14 AC-5：节点首行要角色名，`roleName` 由宿主给出（任务详情里是 `name || roleId`，
 * 所以旧 run 也一定会落到角色 id 而不是任务 id 或空白）。
 * 环依赖（坏数据）用过访问集兜住，深度按 0 兜底 —— 画错也比抛错让整页空白好。
 */
export function flowOf(tasks: TaskDetailView[]): FlowView {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (id: string): number => {
    const cached = depth.get(id)
    if (cached !== undefined) return cached
    const task = byId.get(id)
    if (task === undefined) return 0
    if (visiting.has(id)) return 0
    visiting.add(id)
    let value = 0
    for (const dep of task.dependsOn) {
      if (!byId.has(dep)) continue
      value = Math.max(value, depthOf(dep) + 1)
    }
    visiting.delete(id)
    depth.set(id, value)
    return value
  }
  const rowsInColumn = new Map<number, number>()
  const nodes: FlowNodeView[] = tasks.map((task) => {
    const column = depthOf(task.id)
    const row = rowsInColumn.get(column) ?? 0
    rowsInColumn.set(column, row + 1)
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      // r16 AC-12：节点归属角色 id 由宿主投影，客户端 flowLayoutOf 据此分列。
      roleId: task.roleId,
      roleName: task.roleName,
      column,
      row,
      usage: task.usage,
      duration: task.duration,
    }
  })
  const edges: FlowEdgeView[] = []
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!byId.has(dep)) continue
      edges.push({ from: dep, to: task.id, upstreamDone: byId.get(dep)?.status === 'done' })
    }
  }
  let columns = 0
  let rows = 0
  for (const node of nodes) {
    columns = Math.max(columns, node.column + 1)
    rows = Math.max(rows, node.row + 1)
  }
  return { nodes, edges, columns, rows }
}

/* ───────────────────────────── 项目分组 ───────────────────────────── */

interface ProjectBucket {
  /** 已知项目 = `resolve()` 后的绝对路径；历史桶 = undefined。 */
  path: string | undefined
  /** 用户命名的工作区标题（registry 命中时才有）；展示名优先于 basename。 */
  title?: string
  summaries: RunSummary[]
  unknown: boolean
}

/** 分桶键归一：`resolve()` 去掉尾斜杠与 `./`，同一工作区的新旧 run 才落进同一个桶。 */
function bucketKeyOf(path: string | undefined): string {
  const text = (path ?? '').trim()
  return text === '' ? '' : resolve(text)
}

/**
 * 项目分组（r19 修正命名与归属）。
 *
 * 每个 summary 的**有效工作区**按优先级取：
 *   ① `summary.project` 命中 registry 的 path（历史写对了的 run）；
 *   ② registry 按 `sessionId` 反查（project 写成 profile 目录的老 run）；
 *   ③ 都没有 → 沿用 `summary.project`（旧行为：按 basename 展示；空 = 历史桶）。
 *
 * 桶键一律用**解析后的 path**：同一个工作区的「旧 run（project=profile）」与
 * 「新 run（project=workspace）」必须合并成一行，否则用户会看到两个同名项目。
 */
function groupProjects(deps: LibraryDeps, summaries: RunSummary[], at: number): ProjectView[] {
  const buckets = new Map<string, ProjectBucket>()
  const bucketFor = (path: string | undefined, unknown: boolean, title?: string): ProjectBucket => {
    const resolved = bucketKeyOf(path)
    const key = unknown ? UNKNOWN_PROJECT_ID : resolved
    const existing = buckets.get(key)
    if (existing !== undefined) {
      // 先到先得：registry 的持久顺序就是用户的期望顺序，后到的同路径条目不该改名。
      if (existing.title === undefined && title !== undefined) existing.title = title
      return existing
    }
    const created: ProjectBucket = {
      path: unknown ? undefined : (resolved !== '' ? resolved : path),
      ...(unknown || title === undefined ? {} : { title }),
      summaries: [],
      unknown,
    }
    buckets.set(key, created)
    return created
  }

  // registry 索引：path → 实体（canonical path）、sessionId → 实体。服务缺失 = 两张空表。
  const byPath = new Map<string, HostWorkspaceEntry>()
  const bySession = new Map<string, HostWorkspaceEntry>()
  for (const entry of deps.workspaces?.() ?? []) {
    const key = bucketKeyOf(entry.path)
    if (key !== '' && !byPath.has(key)) byPath.set(key, entry)
    for (const sessionId of entry.sessionIds) {
      const id = (sessionId ?? '').trim()
      if (id !== '' && !bySession.has(id)) bySession.set(id, entry)
    }
  }

  // 当前工作区必须始终在列（哪怕它一次都没跑过）：否则「切回项目」找不到入口。
  bucketFor(deps.workspace, false, byPath.get(bucketKeyOf(deps.workspace))?.title)
  for (const summary of summaries) {
    const project = (summary.project ?? '').trim()
    // ① project 命中优先：已记录正确路径的 run 不许被 sessionId 映射拉回旧工作区。
    const entry = (project === '' ? undefined : byPath.get(bucketKeyOf(project))) ?? bySession.get(summary.sessionId)
    const projectless = project === ''
    if (projectless && entry === undefined) {
      // 无 project 且无会话映射 = 历史运行，语义不变。
      bucketFor(undefined, true).summaries.push(summary)
      continue
    }
    bucketFor(entry?.path ?? project, false, entry?.title).summaries.push(summary)
  }

  const known: ProjectView[] = []
  let unknown: ProjectView | null = null
  for (const bucket of buckets.values()) {
    const view = projectViewOf(deps, bucket, at)
    if (bucket.unknown) unknown = view
    else known.push(view)
  }
  known.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) || a.name.localeCompare(b.name))
  return unknown === null ? known : [...known, unknown]
}

function projectViewOf(deps: LibraryDeps, bucket: ProjectBucket, at: number): ProjectView {
  const runs = [...bucket.summaries].sort((a, b) => b.createdAt - a.createdAt)
  let lastActiveAt: number | undefined
  for (const summary of runs) {
    const active = Math.max(summary.createdAt, summary.finishedAt ?? 0)
    lastActiveAt = lastActiveAt === undefined ? active : Math.max(lastActiveAt, active)
  }
  let total: TokenTotals | undefined
  for (const summary of runs) {
    if (summary.usageTotals === undefined) continue
    total = addTotals(total, summary.usageTotals)
  }
  const view: ProjectView = {
    id: bucket.unknown ? UNKNOWN_PROJECT_ID : (bucket.path ?? ''),
    // r19：标题（用户命名）优先；没有 registry 时退回 basename（旧行为逐字不变）。
    name: bucket.unknown ? UNKNOWN_PROJECT_NAME : (bucket.title ?? projectNameOf(bucket.path)),
    runs: runs.length,
    usage: usageCellOf(total, NO_USAGE_REASON),
    recentRuns: runs.slice(0, PROJECT_RUN_LIMIT).map((summary) => projectRunViewOf(summary, at)),
    memories: bucket.unknown ? [] : deps.projectMemories(bucket.path ?? '').slice(0, MEMORY_INDEX_LIMIT),
  }
  if (bucket.path !== undefined && !bucket.unknown) view.path = bucket.path
  if (bucket.unknown) view.unknown = true
  if (lastActiveAt !== undefined) view.lastActiveAt = lastActiveAt
  return view
}

function projectRunViewOf(summary: RunSummary, at: number): ProjectRunSummaryView {
  const view: ProjectRunSummaryView = {
    runId: summary.runId,
    planStatus: summary.status,
    tasks: summary.tasks,
    done: summary.done,
    usage: usageCellOf(summary.usageTotals, NO_USAGE_REASON),
    duration: durationOfSummary(summary, at),
  }
  if (summary.plannedAt !== undefined) view.plannedAt = summary.plannedAt
  if (summary.finishedAt !== undefined) view.finishedAt = summary.finishedAt
  // r14 AC-15：项目页行标题的唯一来源（缺省 = 旧 run，客户端走「未命名任务 · 后 6 位」）。
  if (summary.goal !== undefined) view.goal = summary.goal
  return view
}

/** 历史列表只有摘要：缺 `plannedAt` 记「不可得」，不用 `createdAt` 冒充（口径会变）。 */
function durationOfSummary(summary: RunSummary, at: number): DurationCell {
  if (summary.plannedAt === undefined) return durationCellOf({ state: 'unavailable', now: at })
  const ended = summary.finishedAt !== undefined
  const terminal = summary.status === 'cancelled' || summary.status === 'terminated'
  if (!ended && terminal) {
    return durationCellOf({ startAt: summary.plannedAt, state: 'unavailable', now: at })
  }
  return durationCellOf({
    startAt: summary.plannedAt,
    ...(ended ? { endAt: summary.finishedAt } : {}),
    state: ended ? 'done' : 'running',
    now: at,
  })
}

/** 角色投影表（r54）：装配层没接时给空表（成员名回退 roleId、路由回「会话默认」）。 */
function roleListOf(deps: LibraryDeps): ReadonlyArray<LibraryRole> {
  return deps.roles?.() ?? []
}

function roleNameOf(deps: LibraryDeps): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const role of deps.roles?.() ?? []) {
    const id = (role.id ?? '').trim()
    if (id === '') continue
    const name = (role.name ?? '').trim()
    map.set(id, name === '' ? id : name)
  }
  return map
}

/**
 * 停滞阈值：优先走装配层注入的真设置（`deps.settings`）。
 *
 * 缺省 / 抛错 / 非正数一律回落 `defaultSettings().stallMs`，**绝不返回 0**
 * （0 会让 `stallOf` 把每个在跑成员都判成停滞）。一次详情装配只调用一次，
 * 由 `runDetailOf` 的 `stallMs` 参数带给所有成员。
 */
function stallMsOf(deps: LibraryDeps): number {
  const fallback = defaultSettings().stallMs
  try {
    const value = deps.settings?.().stallMs
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

function addTotals(base: TokenTotals | undefined, next: TokenTotals): TokenTotals {
  const out: TokenTotals = { total: (base?.total ?? 0) + next.total }
  const input = (base?.input ?? 0) + (next.input ?? 0)
  const output = (base?.output ?? 0) + (next.output ?? 0)
  if (input > 0) out.input = input
  if (output > 0) out.output = output
  return out
}

function nowOf(deps: LibraryDeps): number {
  const at = deps.now?.()
  return typeof at === 'number' && Number.isFinite(at) ? at : Date.now()
}
