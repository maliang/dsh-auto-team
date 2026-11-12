/**
 * 计划构造、续派与规范化。依赖 graph.ts 的纯校验，自身也不碰宿主服务（只碰 fs 由 store 负责）。
 */
import type { Plan, PlanRevision, PlanTask, TaskStatus } from '../../shared/types.ts'
import { DEFAULT_MAX_CONCURRENT, MAX_CONCURRENT_LIMIT } from '../config.ts'
import { validateGraph } from './graph.ts'

export interface PlanDraftTask {
  id?: string
  title: string
  roleId: string
  dependsOn?: string[]
  acceptance?: string
  /** 写域：本任务预计改动的路径（文件或目录）。冲突判定见 plan/scope.ts。 */
  writeScopes?: string[]
}

export interface PlanDraft {
  sessionId: string
  goal?: string
  maxConcurrent?: number
  tasks: PlanDraftTask[]
}

/** 写域轻量清洗：去空、去重，保持声明顺序（边界归一在 plan/scope.ts，这里保持宽容）。 */
function scopesOf(input: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  const scopes: string[] = []
  for (const raw of input ?? []) {
    const scope = String(raw ?? '').trim()
    if (scope === '' || seen.has(scope)) continue
    seen.add(scope)
    scopes.push(scope)
  }
  return scopes
}

/** 校验草稿并统一成 Plan；失败返回中文原因（面板与工具都直接展示）。 */
export function buildPlan(draft: PlanDraft, runId: string, now: number): { ok: true; plan: Plan } | { ok: false; reason: string } {
  const tasks: PlanTask[] = draft.tasks.map((task, index) => {
    const writeScopes = scopesOf(task.writeScopes)
    const built: PlanTask = {
      id: (task.id ?? '').trim() === '' ? `t${index + 1}` : (task.id as string).trim(),
      title: task.title.trim(),
      roleId: task.roleId.trim(),
      dependsOn: [...new Set(task.dependsOn ?? [])],
      acceptance: (task.acceptance ?? '').trim(),
      status: 'pending' as TaskStatus,
    }
    // 可选字段只在真的声明了写域时才出现：老计划文件里不会平白多一个空数组。
    if (writeScopes.length > 0) built.writeScopes = writeScopes
    return built
  })

  if (tasks.some((task) => task.title === '')) return { ok: false, reason: '存在标题为空的任务' }
  if (tasks.some((task) => task.roleId === '')) return { ok: false, reason: '存在未指定角色的任务' }

  const check = validateGraph(tasks.map((task) => ({ id: task.id, dependsOn: task.dependsOn })))
  if (!check.ok) return { ok: false, reason: check.reason }

  const requested = draft.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
  const maxConcurrent = Math.min(Math.max(1, requested), MAX_CONCURRENT_LIMIT)

  // r14 AC-15：目标原文必须落盘 —— r13 的 PlanDraft 有 goal，但装配时被丢掉了，
  // 于是项目页只能拿 runId 当标题。空串等同于没写（不写可选字段，旧夹具形状不变）。
  const goal = (draft.goal ?? '').trim()

  const plan: Plan = {
    runId,
    sessionId: draft.sessionId,
    createdAt: now,
    status: 'draft',
    tasks,
    maxConcurrent,
  }
  if (goal !== '') plan.goal = goal

  return { ok: true, plan }
}

/** 计划指纹：用于判断「同一条需求的重复拆解」是否等于上一份（面板提示「计划就绪」用）。 */
export function planFingerprint(plan: Pick<Plan, 'tasks'>): string {
  return plan.tasks
    .map((task) => `${task.id}:${task.roleId}:${task.dependsOn.slice().sort().join('|')}`)
    .sort()
    .join(';')
}

/** 进度口径：done / 全部任务。0 任务返回 0，避免除零显示 NaN。 */
export function progressOf(tasks: PlanTask[]): { done: number; total: number; ratio: number } {
  const total = tasks.length
  if (total === 0) return { done: 0, total: 0, ratio: 0 }
  const done = tasks.filter((task) => task.status === 'done').length
  return { done, total, ratio: done / total }
}

/** 指纹入参：PlanTask 与 PlanDraftTask 都能直接传（可选字段缺省按空处理）。 */
export interface FingerprintInput {
  title?: string
  roleId?: string
  dependsOn?: readonly string[]
  acceptance?: string
  writeScopes?: readonly string[]
}

/**
 * 任务内容指纹：判「这条追加任务是不是已经存在」。
 *
 * 归一规则：标题/角色/验收去首尾空白；依赖与写域去重后排序（声明顺序不影响语义）。
 * 刻意**不含** id 与 status —— 同一件事换个 id 写第二遍仍然算重复。
 */
export function taskFingerprint(task: FingerprintInput): string {
  return JSON.stringify({
    title: (task.title ?? '').trim(),
    roleId: (task.roleId ?? '').trim(),
    dependsOn: [...new Set(task.dependsOn ?? [])].sort(),
    acceptance: (task.acceptance ?? '').trim(),
    writeScopes: [...new Set(task.writeScopes ?? [])].sort(),
  })
}

export type ExtendResult =
  | { ok: true; plan: Plan; added: string[]; skipped: string[] }
  | { ok: false; reason: string }

/** 已收口（不可再追加）的计划状态。 */
const CLOSED_PLAN_STATUSES: ReadonlySet<Plan['status']> = new Set<Plan['status']>(['terminated', 'cancelled'])

/**
 * 续派：往已存在的计划里追加一批任务（同一个 runId，AC-11）。
 *
 * 三条硬约束：
 *  1. **原子**：先把整批构造完、用 validateGraph 全量校验（含跨批依赖），任一条不合法则整批不落；
 *  2. **幂等**：内容指纹已存在的条目进 skipped，不重复追加、不改动已有任务；
 *  3. **不重排**：新任务追加在末尾，id 从 `t<next>` 递增（跳过已被占用的编号），中途不重编号。
 *
 * 追加出来的任务一律 status='pending'：写域与依赖由 dispatch 在派发时判定。
 */
export function extendPlan(plan: Plan, inputs: readonly PlanDraftTask[], now: number): ExtendResult {
  if (CLOSED_PLAN_STATUSES.has(plan.status)) {
    const label = plan.status === 'cancelled' ? '已取消' : '已终止'
    return { ok: false, reason: `计划${label}，不能再追加任务（请开新的计划）` }
  }

  const taken = new Set(plan.tasks.map((task) => task.id))
  let nextIndex = 1
  for (const id of taken) {
    const matched = /^t(\d+)$/.exec(id)
    if (matched) nextIndex = Math.max(nextIndex, Number(matched[1]) + 1)
  }

  // 指纹 → 已有任务 id（随着本批被接受而增长，批内重复也算重复）
  const known = new Map<string, string>()
  for (const task of plan.tasks) known.set(taskFingerprint(task), task.id)

  const added: string[] = []
  const skipped: string[] = []
  const candidates: PlanTask[] = []

  const allocate = (): string => {
    let id = `t${nextIndex}`
    nextIndex += 1
    while (taken.has(id)) {
      id = `t${nextIndex}`
      nextIndex += 1
    }
    return id
  }

  for (const [index, input] of inputs.entries()) {
    const title = (input.title ?? '').trim()
    const roleId = (input.roleId ?? '').trim()
    if (title === '') return { ok: false, reason: `第 ${index + 1} 条追加任务没有标题` }
    if (roleId === '') return { ok: false, reason: `第 ${index + 1} 条追加任务（${title}）未指定角色` }

    const fingerprint = taskFingerprint(input)
    if (known.has(fingerprint)) {
      // 跳过项用「调用方给得出的标识」回报：优先显式 id，其次标题。
      skipped.push((input.id ?? '').trim() === '' ? title : (input.id as string).trim())
      continue
    }

    const id = (input.id ?? '').trim() === '' ? allocate() : (input.id as string).trim()
    if (taken.has(id)) return { ok: false, reason: `追加任务的 id 与已有任务重复：${id}` }

    const writeScopes = scopesOf(input.writeScopes)
    const task: PlanTask = {
      id,
      title,
      roleId,
      dependsOn: [...new Set(input.dependsOn ?? [])],
      acceptance: (input.acceptance ?? '').trim(),
      status: 'pending' as TaskStatus,
    }
    if (writeScopes.length > 0) task.writeScopes = writeScopes

    taken.add(id)
    known.set(fingerprint, id)
    candidates.push(task)
    added.push(id)
  }

  if (candidates.length === 0) return { ok: true, plan, added, skipped }

  const merged: PlanTask[] = [...plan.tasks, ...candidates]
  const check = validateGraph(merged.map((task) => ({ id: task.id, dependsOn: task.dependsOn })))
  if (!check.ok) return { ok: false, reason: check.reason }

  // Plan 的字段集保持不变（不加 updatedAt）：面板的「刚追加」由任务自身的 createdAt/状态表达。
  void now
  return { ok: true, plan: { ...plan, tasks: merged }, added, skipped }
}

/* ─────────────────────────────── r21：需求修订（同一个 runId 内并入） ─────────────────────────────── */

/** r21：被修订/作废的任务状态限制 —— 已完成/已跳过/已取消的任务不允许被「改一改」复活。 */
const REVISION_FROZEN_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['done', 'skipped', 'cancelled'])

/** 修订输入：目标段落 + 要更新/追加的任务 + 要作废的任务。 */
export interface RevisionInput {
  /** 新需求原文（追加到 goal 末尾，不覆盖原目标；空串 = 只改任务）。 */
  goal?: string
  /** 哪几点变了（写给在跑成员，也落进任务卡的 revisionNote）。 */
  changeSummary?: string
  /** 本次要作废的任务 id（被新需求替换掉的旧任务）。 */
  cancelledTaskIds?: readonly string[]
  /** 作废原因（缺省由宿主按修订正文生成，绝不写空话）。 */
  cancelReason?: string
  /** 要更新的既有任务（带 id 且 id 命中）或要追加的新任务（无 id / id 未占用）。 */
  tasks?: readonly PlanDraftTask[]
  /** 修订顺带调整并发上限（缺省 = 保持原值）。 */
  maxConcurrent?: number
}

/** r21：一次修订的落盘结果。`mode` 三态里的 created 由调用方（没有可并入 run）决定。 */
export interface RevisionResult {
  plan: Plan
  mode: 'revised' | 'appended'
  updated: PlanTask[]
  added: PlanTask[]
  cancelled: PlanTask[]
  /** 被指纹判重跳过的新任务（显式 id 优先，其次标题），与 extendPlan 口径一致。 */
  skipped: string[]
  revision: PlanRevision
}

export type ReviseResult = ({ ok: true } & RevisionResult) | { ok: false; reason: string }

/** 修订时刻的展示文本（宿主本地时区，精确到分钟；只用于 goal 与任务卡留痕）。 */
function revisionStamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 一行摘要（正文首行），作废原因/任务卡说明的兜底，避免把整段需求塞进状态标签。 */
function firstLineOf(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item !== '')
  return line ?? ''
}

/**
 * r21：把「同一条需求的修改」并入既有 run（同一个 runId，不新建、不重派同名成员）。
 *
 * 与 extendPlan 的分工：extendPlan 只追加（内容指纹判重、id 递增）；这里额外支持
 *  - **更新**：带 id 且命中既有任务 → 覆盖 title/roleId/dependsOn/acceptance/writeScopes；
 *  - **作废**：cancelledTaskIds → status='cancelled' + cancelledAt/cancelReason/cancelledBy='revision'；
 *  - **目标留痕**：新需求以 `## 需求修订（时刻）` 段落追加到 goal 末尾，原文不覆盖。
 *
 * 原子性：整批先在内存里构造完，再用 validateGraph 全量校验；任一条不合法则整批不落。
 * 终态任务（done/skipped/cancelled）拒绝被更新；要改已完成的东西请显式作废或新开任务。
 */
export function revisePlan(plan: Plan, input: RevisionInput, now: number): ReviseResult {
  if (CLOSED_PLAN_STATUSES.has(plan.status)) {
    const label = plan.status === 'cancelled' ? '已取消' : '已终止'
    return { ok: false, reason: `计划${label}，不能并入需求修订（请开新的计划）` }
  }

  const goalText = (input.goal ?? '').trim()
  const changeSummary = (input.changeSummary ?? '').trim()
  const cancelIds = [...new Set((input.cancelledTaskIds ?? []).map((id) => String(id ?? '').trim()).filter((id) => id !== ''))]
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]))

  for (const id of cancelIds) {
    if (!taskById.has(id)) return { ok: false, reason: `要作废的任务不存在：${id}` }
  }

  const cancelled: PlanTask[] = []
  const cancelledIdSet = new Set(cancelIds)
  const cancelReason =
    (input.cancelReason ?? '').trim() !== ''
      ? (input.cancelReason as string).trim()
      : `需求修订作废：${firstLineOf(changeSummary) || firstLineOf(goalText) || '被新需求替换'}`

  const inputs = input.tasks ?? []
  for (const item of inputs) {
    const id = (item.id ?? '').trim()
    if (id !== '' && cancelledIdSet.has(id)) {
      return { ok: false, reason: `任务 ${id} 同一次修订里既更新又作废，请只保留一种处理` }
    }
  }

  const taken = new Set(plan.tasks.map((task) => task.id))
  let nextIndex = 1
  for (const id of taken) {
    const matched = /^t(\d+)$/.exec(id)
    if (matched) nextIndex = Math.max(nextIndex, Number(matched[1]) + 1)
  }
  const allocate = (): string => {
    let id = `t${nextIndex}`
    nextIndex += 1
    while (taken.has(id)) {
      id = `t${nextIndex}`
      nextIndex += 1
    }
    return id
  }

  const updated: PlanTask[] = []
  const added: PlanTask[] = []
  const skipped: string[] = []
  const nextTasks: PlanTask[] = plan.tasks.map((task) => ({ ...task }))
  const nextById = new Map(nextTasks.map((task) => [task.id, task]))
  const known = new Map<string, string>()
  for (const task of nextTasks) known.set(taskFingerprint(task), task.id)
  const note = changeSummary || firstLineOf(goalText) || '需求修订'

  for (const [index, item] of inputs.entries()) {
    const id = (item.id ?? '').trim()
    const existing = id === '' ? undefined : nextById.get(id)
    if (existing) {
      if (cancelledIdSet.has(id)) return { ok: false, reason: `任务 ${id} 同一次修订里既更新又作废，请只保留一种处理` }
      const title = (item.title ?? '').trim()
      const roleId = (item.roleId ?? '').trim()
      if (title === '') return { ok: false, reason: `第 ${index + 1} 条修订任务没有标题` }
      if (roleId === '') return { ok: false, reason: `第 ${index + 1} 条修订任务（${title}）未指定角色` }
      const dependsOn = item.dependsOn === undefined ? [...existing.dependsOn] : [...new Set(item.dependsOn)]
      const acceptance = item.acceptance === undefined ? existing.acceptance : (item.acceptance ?? '').trim()
      const writeScopes = item.writeScopes === undefined ? existing.writeScopes : scopesOf(item.writeScopes)
      const unchanged =
        title === existing.title &&
        roleId === existing.roleId &&
        acceptance === existing.acceptance &&
        JSON.stringify(dependsOn) === JSON.stringify(existing.dependsOn) &&
        JSON.stringify(writeScopes ?? []) === JSON.stringify(existing.writeScopes ?? [])
      if (unchanged) {
        skipped.push(id)
        continue
      }
      // D1：终态任务是历史事实，不能被一次「改一改」悄悄复活成可执行任务 ——
      // 与下面「已完成后不能再作废」是同一条规则的另一面（未改动的终态任务上面已 skip，不受影响）。
      if (REVISION_FROZEN_STATUSES.has(existing.status)) {
        const label = existing.status === 'done' ? '已完成' : existing.status === 'skipped' ? '已跳过' : '已取消'
        return { ok: false, reason: `任务 ${id} ${label}，不能再修订（要改请新开任务）` }
      }
      if (acceptance === '') return { ok: false, reason: `修订后的任务 ${id} 验收命令为空（完成必须过门禁）` }
      const patched: PlanTask = {
        ...existing,
        title,
        roleId,
        dependsOn,
        acceptance,
        revisedAt: now,
        revisionNote: note,
      }
      if (writeScopes !== undefined && writeScopes.length > 0) patched.writeScopes = writeScopes
      if (writeScopes !== undefined && writeScopes.length === 0) delete patched.writeScopes
      nextById.set(id, patched)
      const at = nextTasks.findIndex((task) => task.id === id)
      nextTasks[at] = patched
      updated.push(patched)
      continue
    }

    const title = (item.title ?? '').trim()
    const roleId = (item.roleId ?? '').trim()
    if (title === '') return { ok: false, reason: `第 ${index + 1} 条追加任务没有标题` }
    if (roleId === '') return { ok: false, reason: `第 ${index + 1} 条追加任务（${title}）未指定角色` }
    const acceptance = (item.acceptance ?? '').trim()
    if (acceptance === '') return { ok: false, reason: `第 ${index + 1} 条追加任务（${title}）验收命令为空（完成必须过门禁）` }

    const fingerprint = taskFingerprint(item)
    if (known.has(fingerprint)) {
      skipped.push(id === '' ? title : id)
      continue
    }

    const taskId = id === '' ? allocate() : id
    if (nextById.has(taskId)) return { ok: false, reason: `追加任务的 id 与已有任务重复：${taskId}` }

    const writeScopes = scopesOf(item.writeScopes)
    const task: PlanTask = {
      id: taskId,
      title,
      roleId,
      dependsOn: [...new Set(item.dependsOn ?? [])],
      acceptance,
      status: 'pending' as TaskStatus,
    }
    if (writeScopes.length > 0) task.writeScopes = writeScopes
    nextById.set(taskId, task)
    nextTasks.push(task)
    taken.add(taskId)
    known.set(fingerprint, taskId)
    added.push(task)
  }

  for (const id of cancelIds) {
    const task = nextById.get(id)
    if (!task) return { ok: false, reason: `要作废的任务不存在：${id}` }
    if (task.status === 'done' || task.status === 'skipped' || task.status === 'cancelled') {
      const label = task.status === 'done' ? '已完成' : task.status === 'skipped' ? '已跳过' : '已取消'
      return { ok: false, reason: `任务 ${id} ${label}，不能再作废` }
    }
    const patched: PlanTask = {
      ...task,
      status: 'cancelled' as TaskStatus,
      cancelledAt: now,
      cancelReason,
      cancelledBy: 'revision',
    }
    delete patched.waitingOn
    delete patched.waitReason
    nextById.set(id, patched)
    const at = nextTasks.findIndex((item) => item.id === id)
    nextTasks[at] = patched
    cancelled.push(patched)
  }

  if (updated.length === 0 && added.length === 0 && cancelled.length === 0 && goalText === '') {
    return { ok: false, reason: '需求修订没有任何变化：既没有新任务，也没有要更新/作废的任务或新目标' }
  }

  const check = validateGraph(nextTasks.map((task) => ({ id: task.id, dependsOn: task.dependsOn })))
  if (!check.ok) return { ok: false, reason: check.reason }

  const stamp = revisionStamp(now)
  const revision: PlanRevision = {
    at: now,
    text: goalText,
    updatedTaskIds: updated.map((task) => task.id),
    addedTaskIds: added.map((task) => task.id),
    cancelledTaskIds: cancelled.map((task) => task.id),
  }
  if (changeSummary !== '') revision.changeSummary = changeSummary

  const section = goalText === '' ? '' : `\n\n## 需求修订（${stamp}）\n${goalText}`
  const goal = `${(plan.goal ?? '').trim()}${section}`.trim()
  const nextPlan: Plan = {
    ...plan,
    tasks: nextTasks,
    revisions: [...(plan.revisions ?? []), revision],
  }
  if (goal !== '') nextPlan.goal = goal
  if (input.maxConcurrent !== undefined) {
    nextPlan.maxConcurrent = Math.min(Math.max(1, input.maxConcurrent), MAX_CONCURRENT_LIMIT)
  }

  return {
    ok: true,
    plan: nextPlan,
    mode: updated.length > 0 || cancelled.length > 0 || goalText !== '' ? 'revised' : 'appended',
    updated,
    added,
    cancelled,
    skipped,
    revision,
  }
}
