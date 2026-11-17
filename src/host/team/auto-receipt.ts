/**
 * 宿主侧「自动回执」判定（成员 idle 而任务仍 running、还没有门禁证据）。
 *
 * 背景：r41 只在成员静默收工后记一条「待回执」观察事实，仍然要队长手动
 * `auto_team_receipt` 代跑门禁。本模块回答两个纯逻辑问题：
 *   1. **该不该由宿主代跑**（`shouldAutoReceipt`）—— 状态、暂停、证据、并发、开关，缺一不可；
 *   2. **代跑之后写什么**（`autoReceiptNoteOf` / `withAutoReceipt`）—— 一句人话 + 一个事实标记。
 *
 * 铁律：本模块**不执行任何动作**。真正跑门禁只经 `bridge.act('receipt')`（preflightGate /
 * enqueueGate / runGate / applyReceipt 的 attempts 上限全部复用），这里若自己调 gate 就会出现
 * 第二套回执语义。因此它是纯函数：零 IO、零时钟（时间由调用方传入）、零宿主 API。
 */
import type { PlanTask, TaskStatus } from '../../shared/types.ts'

/** 判定所需的全部事实（每一项都能从落盘 RunState 里直接取到，不猜）。 */
export interface AutoReceiptFacts {
  /** 任务当前状态：只有 `running` 才是候选（done/rework/paused 等一律不代跑）。 */
  status: TaskStatus
  /** 任务级暂停（`RunState.taskPauses[taskId]` 有键 = 用户显式暂停过该任务）。 */
  paused: boolean
  /** 计划级暂停（`plan.status === 'paused'`）。 */
  planPaused: boolean
  /** 已有门禁证据 = 门禁跑过了，再跑一次是重复执行用户命令。 */
  hasEvidence: boolean
  /** 同一任务已经有一次门禁在跑（内存 in-flight 集合，防两个信号并发各推一次）。 */
  inflight: boolean
  /** 设置项 `autoReceipt`（缺省 = 开启；只有显式 `false` 才关闭）。 */
  enabled: boolean
}

/**
 * 是否由宿主代跑门禁。
 *
 * `enabled` 只认**显式 false**：字段缺席（老 settings.json / 单测桩）等于开启，
 * 与 `settings.autoReceipt !== false` 同一口径（缺省值不写进 DEFAULT_SETTINGS，
 * 避免把「没配置」与「配成 true」变成两份可读结论）。
 */
export function shouldAutoReceipt(facts: AutoReceiptFacts): boolean {
  if (facts.enabled !== true) return false
  if (facts.status !== 'running') return false
  if (facts.paused) return false
  if (facts.planPaused) return false
  if (facts.hasEvidence) return false
  if (facts.inflight) return false
  return true
}

/**
 * 代跑结果的投影（只取落盘需要的两件事：被拒原因、门禁退出码）。
 *
 * `rejected` 有值 = 门禁**没跑**（任务已暂停 / 已完成 / NOT_FOUND / 计划暂停…），
 * 此时不写 `autoReceipt`，回落 r41 的「待回执」。
 */
export interface AutoReceiptResult {
  rejected?: { code: string; message: string } | undefined
  /** 门禁退出码（act 成功后从落盘 evidence 读；拿不到时按 `undefined` 处理，不伪造 0）。 */
  exitCode?: number | undefined
}

/** 一句人话：给面板活动流与 captain→user 账本用，用户读得懂「谁跑的、结果如何」。 */
export function autoReceiptNoteOf(result: AutoReceiptResult): string {
  if (result.rejected !== undefined) {
    return `宿主代跑门禁未执行（${result.rejected.code}）：${result.rejected.message}`
  }
  if (result.exitCode === 0) return '宿主代跑门禁：exit 0 → 已通过'
  const code = typeof result.exitCode === 'number' ? String(result.exitCode) : '未知'
  return `宿主代跑门禁：exit ${code} → 转返工`
}

/**
 * 给任务打上「门禁是宿主代跑的」事实。
 *
 * **只加字段，不碰 `evidence`**：证据链仍由 `applyReceipt` / `runGate` 写，面板区分
 * 「成员自己交的回执」与「宿主代跑」只看这一个标记（`silentFinish` 与它互斥）。
 */
export function withAutoReceipt(task: PlanTask, mark: { at: number; exitCode: number }): PlanTask {
  return { ...task, autoReceipt: { at: mark.at, exitCode: mark.exitCode } }
}
