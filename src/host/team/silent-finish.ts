/**
 * 「待回执」观察事实（r33 AC：成员结束本轮却没交回执）。
 *
 * 背景：成员跑完 38 步、改动全落盘，然后 `turn/end` 后直接收工，任务卡在 `running`。
 * 停滞检测看不出异常（面板只能报「quiet」），队长也无从得知成员其实已经停了。
 *
 * 本模块只回答一个问题：**「这个 running 任务是不是已经没人干了、且没有门禁证据？」**
 * 命中后由宿主记一条观察事实并通知队长；它**不代表完成、不参与任何完成度计算**，
 * 也不会自动写 done / rework / resume / 替成员执行门禁（那四件事只能由队长显式发起）。
 *
 * 纯函数：零 IO、零宿主 API、零时钟（时间由调用方传入），便于单测。
 */
import type { MemberBinding, PanelTaskView, PlanTask } from '../../shared/types.ts'

/** 判定所需的最小事实集合：任务、它的绑定、以及「该成员已不在跑」。 */
export interface SilentFinishFacts {
  task: PlanTask
  /** 该任务未退休的绑定；没有绑定就不可能判定（不知道是谁停的）。 */
  binding?: MemberBinding | undefined
  /**
   * 成员已不在跑：事件路径直接为 `true`（收到 `subagent/end` / `agent/error`），
   * 轮询路径用宿主状态归一（dead/inactive）得出。两路都没有时传 `false` —— 不猜。
   */
  memberStopped: boolean
}

/**
 * 命中「待回执」：任务仍 `running`、有未退休绑定、成员已停、且还没有门禁证据。
 *
 * `evidence` 缺失是必要条件：有证据说明门禁已经跑过，任务卡在 running 是另一码事。
 */
export function isSilentFinish(facts: SilentFinishFacts): boolean {
  const { task, binding, memberStopped } = facts
  if (memberStopped !== true) return false
  if (binding === undefined) return false
  if (binding.retired === true) return false
  if (binding.taskId !== task.id) return false
  if (task.status !== 'running') return false
  if (task.evidence !== undefined) return false
  return true
}

/**
 * 通知队长的一条消息正文：说清「谁停了、任务仍执行中」，并给出两条出路。
 *
 * 只描述事实与可选动作，不替队长做决定。
 */
export function silentFinishBodyOf(memberName: string, task: PlanTask): string {
  const name = memberName.trim() === '' ? task.roleId : memberName.trim()
  return `成员「${name}」已结束本轮但未提交回执，任务 ${task.id} 仍为执行中。两条出路：用 auto_team_message 让它继续，或用 auto_team_receipt 代跑门禁提交回执。`
}

/**
 * 打上「待回执」标记。幂等：已经有 `silentFinish` 时原样返回，**不刷新 `at`**。
 */
export function withSilentFinish(task: PlanTask, at: number, memberId: string): PlanTask {
  if (task.silentFinish !== undefined) return task
  return { ...task, silentFinish: { at, memberId } }
}

/** 清掉标记（任务离开 running 时用）；没有标记时原样返回。 */
export function withoutSilentFinish(task: PlanTask): PlanTask {
  if (task.silentFinish === undefined) return task
  const { silentFinish: _silentFinish, ...rest } = task
  return rest
}

/** 面板/状态行用的布尔投影：客户端不要自己推，一律读宿主给出的这个值。 */
export function awaitingReceiptOf(task: PlanTask): boolean {
  return task.silentFinish !== undefined
}

/**
 * 快照任务行的**唯一**构造点：落盘任务 + `awaitingReceipt`。
 *
 * 三处展示（HTTP 快照、项目库任务行、`auto_team_status`）都从这里取，避免各写一份口径。
 */
export function panelTaskViewOf(task: PlanTask): PanelTaskView {
  return { ...task, awaitingReceipt: awaitingReceiptOf(task) }
}
