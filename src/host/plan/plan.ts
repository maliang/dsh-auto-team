/**
 * 计划构造、续派与规范化。依赖 graph.ts 的纯校验，自身也不碰宿主服务（只碰 fs 由 store 负责）。
 */
import type { Plan, PlanTask, TaskStatus } from '../../shared/types.ts'
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
