/**
 * 文本格式化唯一来源（r13 AC-7 / AC-19 / AC-20）：token 数字、时长、等待时长、记忆估算。
 *
 * 为什么全部放在宿主：AC-7 要求「右栏与左栏显示的文本逐字相等」，并断言客户端不出现
 * 第二套时长拼接。只要客户端也能自己拼「分 / 小时」，两处渲染早晚会漂移；因此这些函数
 * **只导出给宿主**，客户端拿到的永远是已经算好的 `text`（`UsageCell` / `DurationCell`）。
 *
 * 纯函数、无 locale、不读环境：内置的千分位分组会随宿主 locale 变（空格 / `.` / `,`），
 * 快照一旦随 locale 抖动，跨端 deep equal 与「同一操作右栏左栏一样」的断言就不可靠。
 */

import type { DurationCell, DurationState, TokenTotals, UsageCell } from '../shared/types.ts'

/** 取不到时的统一文案：三处（token / 用时 / 记忆）都用它，界面不必再各写一份。 */
export const UNAVAILABLE_TEXT = '不可得'

/** 数字是否可用于格式化（有限、非负）。`0` 合法 —— 「花了 0 token」是真话，不是缺失。 */
function usableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** 千分位分组（纯手写，不依赖宿主 locale，见文件头）。 */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 一位小数、去掉多余的 `.0`（紧凑显示用；确定性优先，不做四舍五入以外的处理）。 */
function oneDecimal(value: number): string {
  const text = value.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

/**
 * token 千分位：`1234` → `1,234`，`0` → `0`，缺失/非法 → `不可得`。
 *
 * 任务行与流转节点的 token 单元都用它；数字被截断等于造假，所以列宽按最长值核算
 * （DESIGN §2：76px 按 `999,999,999` 实测约 67px）。
 */
export function formatTokens(n: number | null | undefined): string {
  if (!usableNumber(n)) return UNAVAILABLE_TEXT
  return groupDigits(String(Math.round(n)))
}

/** 紧凑 token：`999` → `999`，`1234` → `1.2k`，`1234567` → `1.2M`（宽 128px 的节点第二行用）。 */
export function formatCompactTokens(n: number | null | undefined): string {
  if (!usableNumber(n)) return UNAVAILABLE_TEXT
  const value = Math.round(n)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${oneDecimal(value / 1_000)}k`
  return `${oneDecimal(value / 1_000_000)}M`
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

/**
 * 归一后的用量单元格（AC-19）：有可用合计 → `provider`（含 `0`），否则 → `unavailable`。
 *
 * `reason` 是被展示给人看的「为什么拿不到」，调用方必须给一句人话（如「该成员未上报用量」）。
 */
export function usageCellOf(totals: TokenTotals | undefined, reason: string): UsageCell {
  if (!totals || !usableNumber(totals.total)) return { source: 'unavailable', reason }
  const tokens: TokenTotals = { total: Math.round(totals.total) }
  if (usableNumber(totals.input)) tokens.input = Math.round(totals.input)
  if (usableNumber(totals.output)) tokens.output = Math.round(totals.output)
  return { source: 'provider', tokens }
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

/** 记忆 token 估算：`ceil(chars/2)`（AC-20 口径；UI 必须带 `≈` 前缀，本文不负责前缀）。 */
export function memoryTokenEstimate(chars: number): number {
  if (!usableNumber(chars)) return 0
  return Math.ceil(chars / 2)
}

/**
 * 「已等待 N 分」文案（AC-13）：未决确认不设 TTL，每次快照按 `now` 重算。
 *
 * 不落盘保存文本 —— 落盘就会在进程重启后停止走动，看起来像「永远卡在 3 分」。
 */
export function waitedTextOf(createdAt: number, now: number): string {
  const elapsed = now - createdAt
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return '刚刚'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `已等待 ${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `已等待 ${hours} 小时` : `已等待 ${hours} 小时 ${rest} 分`
}
