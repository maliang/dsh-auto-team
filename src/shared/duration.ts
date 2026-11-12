/**
 * 时长文案与「用时单元格」的**唯一实现**（r20 从 `host/format.ts` 搬来）。
 *
 * 为什么搬到 shared：r20 要求角色卡片显示「该角色名下任务的累计用时」，这个派生量由
 * `shared/role-view.ts#roleStateOf` 计算 —— 宿主 `library.rolesOf` 与客户端
 * `viewModel.roleUsageOf` 共用它。宿主与客户端必须给出**逐字相等**的文本，因此格式化
 * 只能有一份；而 shared 不许 import 宿主（依赖方向铁律），所以实现下沉到这里，
 * `host/format.ts` 只做 re-export（既有 import 面不变）。
 *
 * 纯函数：无 locale、不读环境、不读时钟（`now` 由调用方传入）。
 */
import type { DurationCell, DurationState, TaskStatus } from './types.ts'

/** 取不到时的统一文案：token / 用时 / 记忆三处共用，界面不再各写一份。 */
export const UNAVAILABLE_TEXT = '不可得'

/**
 * r24：任务已结束、但起止记录整体缺失时的统一原因（旧 run 早于 `taskTimes` 上线）。
 *
 * 这类任务以前被判成 `not-started`（「未开始」），在已完成的历史 run 里是假话；
 * 现在改判 `unavailable` 并带上这句原因，面板能说清「不是没跑，是当时没记」。
 */
export const LEGACY_TASK_TIME_REASON = '该 run 完成于任务起止记录上线前，未存开始/结束时刻'

/** 数字是否可用于格式化（有限、非负）。`0` 合法 —— 「花了 0 秒」是真话，不是缺失。 */
function usableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * 时长文案（AC-20）：
 * 非有限 / 负数 → `不可得`；<1s → `0 秒`；<1min → `N 秒`；<1h → `M 分 SS 秒`；
 * <100h → `H 小时 MM 分`；更久 → `H 小时`。
 *
 * 秒 / 分一律向下取整：显示值永远不会超过真实耗时（宁可少报一秒，不虚报）。
 */
export function formatDuration(ms: number | null | undefined): string {
  if (!usableNumber(ms)) return UNAVAILABLE_TEXT
  if (ms < 1_000) return '0 秒'
  const totalSeconds = Math.floor(ms / 1_000)
  if (ms < 60_000) return `${totalSeconds} 秒`
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000)
    const seconds = totalSeconds % 60
    return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`
  }
  const hours = Math.floor(ms / 3_600_000)
  if (ms < 360_000_000) {
    const minutes = Math.floor(ms / 60_000) % 60
    return `${hours} 小时 ${String(minutes).padStart(2, '0')} 分`
  }
  return `${hours} 小时`
}

export interface DurationCellInput {
  startAt?: number
  endAt?: number
  /** 期望状态：`done` 必须有结束时间，`running` 用 `now` 推当前耗时。 */
  state: DurationState
  now: number
}

/**
 * 归一后的用时单元格（AC-20）：四态互斥，`text` 已算好。
 *
 * `not-started` / `unavailable` 是**状态**而不是数字 0 —— 界面靠 `state` 区分
 * 「还没开始」与「开始但 0 秒」，混用会让人以为任务已经跑过。
 */
/** r24：任务用时单元格的输入（宿主两处调用方共用同一判定，避免语义漂移）。 */
export interface TaskDurationCellInput {
  status: TaskStatus
  startedAt?: number
  endedAt?: number
  /**
   * 调用方按任务终态集合判定（`isTerminalTaskStatus`）。
   *
   * 不在 shared 里再抄一份终态表：那份表的唯一来源在 `host/team/dispatch.ts`，
   * 抄第二份就会在新增终态时漏改一处 —— 正是本项目反复出现的漂移缺陷。
   */
  terminal: boolean
  now: number
}

/**
 * r24：任务用时语义（`bridge.taskDurationsOf` 与 `library.taskDurationOf` 的唯一实现）。
 *
 * 规则（与 PRD 逐字一致）：
 *  - done / skipped / cancelled 但缺 `startedAt` 或 `endedAt` → `unavailable` +
 *    {@link LEGACY_TASK_TIME_REASON}（旧 run 没有起止记录，不能说「未开始」）；
 *  - 其余无起点 → `not-started`（pending/blocked 等确实还没开始）；
 *  - 有完整起止记录 → 与修复前**逐字相同**（沿用 {@link durationCellOf} 的算法）。
 */
export function taskDurationCellOf(input: TaskDurationCellInput): DurationCell {
  const { status, startedAt, endedAt, terminal, now } = input
  const legacyTimed = status === 'done' || status === 'skipped' || status === 'cancelled'
  if (legacyTimed && (startedAt === undefined || endedAt === undefined)) {
    return { state: 'unavailable', text: UNAVAILABLE_TEXT, reason: LEGACY_TASK_TIME_REASON }
  }
  const finished = endedAt !== undefined || terminal
  const state: DurationState = startedAt === undefined ? 'not-started' : finished ? 'done' : 'running'
  return durationCellOf({
    ...(startedAt === undefined ? {} : { startAt: startedAt }),
    ...(endedAt === undefined ? {} : { endAt: endedAt }),
    state,
    now,
  })
}

export function durationCellOf(input: DurationCellInput): DurationCell {
  if (input.state === 'not-started') return { state: 'not-started', text: '未开始' }
  if (input.state === 'unavailable') return { state: 'unavailable', text: UNAVAILABLE_TEXT }
  const startAt = usableNumber(input.startAt) ? input.startAt : undefined
  if (startAt === undefined) return { state: 'unavailable', text: UNAVAILABLE_TEXT }
  const endAt = usableNumber(input.endAt) ? input.endAt : input.state === 'running' ? input.now : undefined
  if (endAt === undefined) return { startAt, state: 'unavailable', text: UNAVAILABLE_TEXT }
  const ms = Math.max(0, endAt - startAt)
  return {
    startAt,
    endAt,
    ms,
    text: formatDuration(ms),
    state: usableNumber(input.endAt) ? 'done' : 'running',
  }
}
