/**
 * 计划构造与规范化。依赖 graph.ts 的纯校验，自身也不碰宿主服务（只碰 fs 由 store 负责）。
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
}

export interface PlanDraft {
  sessionId: string
  goal?: string
  maxConcurrent?: number
  tasks: PlanDraftTask[]
}

/** 校验草稿并统一成 Plan；失败返回中文原因（面板与工具都直接展示）。 */
export function buildPlan(draft: PlanDraft, runId: string, now: number): { ok: true; plan: Plan } | { ok: false; reason: string } {
  const tasks: PlanTask[] = draft.tasks.map((task, index) => ({
    id: (task.id ?? '').trim() === '' ? `t${index + 1}` : (task.id as string).trim(),
    title: task.title.trim(),
    roleId: task.roleId.trim(),
    dependsOn: [...new Set(task.dependsOn ?? [])],
    acceptance: (task.acceptance ?? '').trim(),
    status: 'pending' as TaskStatus,
  }))

  if (tasks.some((task) => task.title === '')) return { ok: false, reason: '存在标题为空的任务' }
  if (tasks.some((task) => task.roleId === '')) return { ok: false, reason: '存在未指定角色的任务' }

  const check = validateGraph(tasks.map((task) => ({ id: task.id, dependsOn: task.dependsOn })))
  if (!check.ok) return { ok: false, reason: check.reason }

  const requested = draft.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
  const maxConcurrent = Math.min(Math.max(1, requested), MAX_CONCURRENT_LIMIT)

  return {
    ok: true,
    plan: {
      runId,
      sessionId: draft.sessionId,
      createdAt: now,
      status: 'draft',
      tasks,
      maxConcurrent,
    },
  }
}

/** 计划指纹：用于判断「同一条需求的重复拆解」是否等于上一份（面板提示「计划就绪」用）。 */
export function planFingerprint(plan: Pick<Plan, 'tasks'>): string {
  return plan.tasks
    .map((task) => `${task.id}:${task.roleId}:${task.dependsOn.slice().sort().join('|')}`)
    .sort()
    .join(';')
}

/** 进度口径：done / (全部非 cancelled)。0 任务返回 0，避免除零显示 NaN。 */
export function progressOf(tasks: PlanTask[]): { done: number; total: number; ratio: number } {
  const total = tasks.length
  if (total === 0) return { done: 0, total: 0, ratio: 0 }
  const done = tasks.filter((task) => task.status === 'done').length
  return { done, total, ratio: done / total }
}
