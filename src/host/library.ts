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
import { durationCellOf, taskDurationCellOf, usageCellOf } from './format.ts'
import { finishedAtOf, type RunState } from './store.ts'
import { isTerminalTaskStatus } from './team/dispatch.ts'
import { pendingViewOf } from './team/confirm.ts'
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
  roles?: () => ReadonlyArray<Pick<Role, 'id' | 'name'>>
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
    if (state !== null) view.detail = runDetailOf(state, at, roleNameOf(deps))
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
 */
export function runDetailOf(
  state: RunState,
  at: number,
  roleNames?: ReadonlyMap<string, string>,
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
  if (state.project !== undefined) detail.project = state.project
  // r21：终止原因与结束时刻同源落盘（旧 run 文件没有该字段 → 字段缺席，客户端显示不可得）。
  if (state.termination !== undefined) detail.terminationReason = state.termination.reason
  const finishedAt = finishedAtOf(state)
  if (finishedAt !== undefined) detail.finishedAt = finishedAt
  const pending = pendingViewOf(state.pendingConfirmation, at)
  if (pending !== undefined) detail.pendingConfirmation = pending
  return detail
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
