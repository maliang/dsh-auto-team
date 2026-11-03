/**
 * 确认闸（r13 AC-11 / AC-12 / AC-13）：识别不可逆动作、生成影响面文案、挂起 `pending`。
 *
 * 为什么是独立纯模块：这五个动作一旦漏掉确认就是**真实破坏**（中断成员、跳过任务、
 * 重跑门禁、强制并行、终止整轮），所以判定矩阵必须能被单测逐条覆盖，而不是埋在
 * `bridge.act` 的 21 个 case 之间靠人工核对。这里只做「判定 + 文案 + 构造」，
 * 执行仍然回到 `bridge.executeAction` —— 两套执行体是这个项目历史上最贵的 bug 族。
 */

import type { PanelAction, PendingConfirmationView, PlanTask } from '../../shared/types.ts'
import type { IrreversiblePanelAction, PendingConfirmation, RunState } from '../store.ts'
import { conflictingScopes } from '../plan/scope.ts'
import { waitedTextOf } from '../format.ts'

/** 重跑门禁时摘要里保留的原验收命令前缀长度（再长面板也读不出来）。 */
const ACCEPTANCE_SNIPPET = 40

/** 5 类不可逆动作（AC-11）。可逆动作**绝不**进这个集合（AC-12 靠它做反向断言）。 */
export const IRREVERSIBLE_ACTIONS: ReadonlySet<string> = new Set<string>([
  'cancel',
  'cancelTask',
  'skipTask',
  'updateAcceptance',
  'forceParallel',
])

/** 终态判定（跳过任务后，终态下游即便缺产物也不会再被派发 —— 只有未终态的才算影响面）。 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  'done',
  'failed',
  'cancelled',
  'skipped',
  'interrupted',
])

/** 写域占用方：正在跑 / 在门禁 / 在等写域的任务都可能与目标冲突。 */
const HOLDER_STATUSES: ReadonlySet<string> = new Set<string>(['running', 'gate', 'waiting'])

/** 类型收窄（AC-11 的机械入口）：只有这五种动作需要确认，其余一律直接执行。 */
export function isIrreversibleAction(action: PanelAction): action is IrreversiblePanelAction {
  return IRREVERSIBLE_ACTIONS.has(action.type)
}

function tasksOf(state: RunState): readonly PlanTask[] {
  return state.plan?.tasks ?? []
}

function taskOf(state: RunState, taskId: string): PlanTask | undefined {
  return tasksOf(state).find((task) => task.id === taskId)
}

/** 传递闭包：`taskId` 的下游里**尚未终态**的任务数（跳过它后会在缺产物下继续的数量）。 */
function downstreamCount(tasks: readonly PlanTask[], taskId: string): number {
  const blocked = new Set<string>()
  const queue: string[] = [taskId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const task of tasks) {
      if (task.id === taskId || blocked.has(task.id)) continue
      if (!task.dependsOn.includes(current)) continue
      blocked.add(task.id)
      if (!TERMINAL_STATUSES.has(task.status)) queue.push(task.id)
    }
  }
  let count = 0
  for (const task of tasks) {
    if (blocked.has(task.id) && !TERMINAL_STATUSES.has(task.status)) count += 1
  }
  return count
}

/** 正在跑的成员数（`cancel` 的影响面）：只有 `running` 任务才有活着的成员可中断。 */
function runningMemberCount(state: RunState): number {
  return tasksOf(state).filter((task) => task.status === 'running').length
}

/** 与目标任务写域冲突的占用任务（`forceParallel` 的影响面）。 */
function scopeHolderOf(state: RunState, target: PlanTask): PlanTask | undefined {
  const scopes = target.writeScopes ?? []
  return tasksOf(state).find((task) => {
    if (task.id === target.id || !HOLDER_STATUSES.has(task.status)) return false
    const holder = task.writeScopes ?? []
    return conflictingScopes(holder, scopes).length > 0
  })
}

function acceptanceSnippet(value: string): string {
  const text = (value ?? '').trim().replace(/\s+/g, ' ')
  if (text === '') return '（空）'
  return text.length > ACCEPTANCE_SNIPPET ? `${text.slice(0, ACCEPTANCE_SNIPPET)}…` : text
}

/**
 * 影响面文案（AC-13 要求逐字可见）：模板固定，只替换事实。
 *
 * 不含「确定 / 取消」这类按钮措辞——动词短语（终止运行 / 跳过任务…）由面板按钮负责，
 * 摘要只回答「会发生什么」。
 */
export function confirmSummaryOf(action: IrreversiblePanelAction, state: RunState): string {
  const runId = state.plan?.runId ?? '未知运行'
  switch (action.type) {
    case 'cancel':
      return `终止运行 ${runId}（将中断 ${runningMemberCount(state)} 个运行中成员）`
    case 'cancelTask': {
      const task = taskOf(state, action.taskId)
      const name =
        state.bindings?.find((binding) => binding.taskId === action.taskId && binding.retired !== true)?.name ??
        '该任务成员'
      return `中断成员 ${name}（任务 ${task?.id ?? action.taskId}）`
    }
    case 'skipTask':
      // PRD §5.4 行 3：跳过 = 「依赖视为满足」，下游**继续推进**（缺该任务的产物）。
      // 文案必须说清这个方向，否则用户会据「下游阻塞」的错误影响面做不可逆决定。
      return `跳过任务 ${action.taskId}（下游 ${downstreamCount(tasksOf(state), action.taskId)} 个任务将在缺产物下继续）`
    case 'updateAcceptance': {
      const task = taskOf(state, action.taskId)
      return `重跑任务 ${action.taskId} 的门禁（原验收：${acceptanceSnippet(task?.acceptance ?? '')}）`
    }
    case 'forceParallel': {
      const task = taskOf(state, action.taskId)
      const holder = task ? scopeHolderOf(state, task) : undefined
      return `强制并行任务 ${action.taskId}（与 ${holder?.id ?? '其他任务'} 写域冲突）`
    }
    default:
      return `执行 ${(action as PanelAction).type}（不可逆）`
  }
}

/**
 * 构造一条待确认记录。
 *
 * `id` 里带时间戳与动作名：同一 run 只允许一条未决记录，因此不需要更强的唯一性；
 * 但 `confirmPending` 必须能区分「确认的是刚看到的那条」与「陈旧 id」，所以 id 不能是常量。
 */
export function pendingFor(state: RunState, action: IrreversiblePanelAction, now: number): PendingConfirmation {
  const pending: PendingConfirmation = {
    id: `pending-${now.toString(36)}-${action.type}`,
    action,
    runId: state.plan.runId,
    createdAt: now,
    summary: confirmSummaryOf(action, state),
    irreversible: true,
  }
  if ('taskId' in action && typeof action.taskId === 'string') pending.taskId = action.taskId
  return pending
}

/** 落盘记录 → 视图（`waitedText` 每次按 now 重算，绝不落盘，见 `waitedTextOf`）。 */
export function pendingViewOf(
  pending: PendingConfirmation | undefined,
  now: number,
): PendingConfirmationView | undefined {
  if (!pending) return undefined
  const view: PendingConfirmationView = {
    id: pending.id,
    action: pending.action.type,
    runId: pending.runId,
    createdAt: pending.createdAt,
    summary: pending.summary,
    irreversible: true,
    waitedText: waitedTextOf(pending.createdAt, now),
  }
  if (pending.taskId !== undefined) view.taskId = pending.taskId
  return view
}

/** 等待文案：再导出一次，避免调用方（bridge）为了一个字符串多 import 一个模块。 */
export { waitedTextOf }
