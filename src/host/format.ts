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

import type { TokenTotals, UsageCell, UsageMetric, UsageMetricKey } from '../shared/types.ts'
// r20：时长文案 / 用时单元格搬到 shared（角色累计用时在 shared/role-view.ts 里生成 text，
// 宿主与客户端必须同一算法）；这里只做 re-export，宿主既有 import 面保持不变。
import { LEGACY_TASK_TIME_REASON, UNAVAILABLE_TEXT } from '../shared/duration.ts'

export { LEGACY_TASK_TIME_REASON, UNAVAILABLE_TEXT }
export { durationCellOf, formatDuration, taskDurationCellOf } from '../shared/duration.ts'
export type { DurationCellInput } from '../shared/duration.ts'

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
 * r19 起**不再是面板 token 量的展示口径**：合计与六项指标统一走 `formatTokenUnits`。
 * 本函数保留给非 token 的计数（`calls` = 调用次数）以及需要精确整数的内部文本；
 * 不要在 `UsageCell.text` / `UsageMetric.text` 上再用它（会退回逗号数字，与单位口径混用）。
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

/** 带单位的 token 阶梯（从大到小，先命中先返回）。 */
const TOKEN_UNITS: ReadonlyArray<{ readonly divisor: number; readonly suffix: string }> = [
  { divisor: 1_000_000_000, suffix: 'B' },
  { divisor: 1_000_000, suffix: 'M' },
  { divisor: 1_000, suffix: 'K' },
]

/**
 * 带单位的 token（r18b t6 引入，r19 扩为**面板 token 量的唯一格式化点**）：
 * `999` → `999`，`34_930` → `34.93K`，`1_500_000` → `1.50M`，`1e9` → `1.00B`。
 *
 * 使用方（r19）：六项指标 `usageMetricsOf` + 合计 `usageCellOf().text`；后者被 run 头成员
 * 合计 / 角色卡 / 任务行 / 流程图节点 / 历史行总量 / 项目库 / 成员页共用，因此改这一处
 * 即整条链路生效。客户端旧数据兜底（`fullTokenText` / `compactTokenText`）按同一算法实现。
 *
 * 规则：
 * - `< 1,000` 原样整数（不补小数）：此时加单位只是噪声；
 * - `≥ 1,000` 升到 K、`≥ 1,000,000` 升到 M、`≥ 1,000,000,000` 升到 B，**固定两位小数**；
 * - 四舍五入进位跨过阈值时顺延到上一级：`999,999` 的 `999.999K` 会 `toFixed(2)` 成
 *   `1000.00K`，这里改判为 `1.00M`——界面上永远不出现 `1000.00K` 这种假单位。
 *
 * 与 `formatCompactTokens` 的区别：那个是「一位小数、小写 k」，服务 128px 节点第二行的
 * 历史口径，本次不动它；两者各自有测试锁定，不要合并。
 */
export function formatTokenUnits(n: number | null | undefined): string {
  if (!usableNumber(n)) return UNAVAILABLE_TEXT
  const value = Math.round(n)
  if (value < 1_000) return String(value)
  for (let index = 0; index < TOKEN_UNITS.length; index += 1) {
    const unit = TOKEN_UNITS[index]
    if (value < unit.divisor) continue
    const text = (value / unit.divisor).toFixed(2)
    if (Number(text) >= 1_000 && index > 0) {
      const next = TOKEN_UNITS[index - 1]
      return `${(value / next.divisor).toFixed(2)}${next.suffix}`
    }
    return `${text}${unit.suffix}`
  }
  return String(value)
}

/**
 * 缓存命中率文案（r17）：`cacheRead / (input + cacheRead)`，一位小数、去掉 `.0`。
 *
 * 分母 0 或任一侧缺失 → `不可得`：只用一半数据算出来的比率是假数，宁可显示不可得。
 */
export function formatCacheHitRate(totals: TokenTotals | undefined): string {
  if (!totals) return UNAVAILABLE_TEXT
  const input = totals.input
  const cacheRead = totals.cacheRead
  if (!usableNumber(input) || !usableNumber(cacheRead)) return UNAVAILABLE_TEXT
  const denominator = input + cacheRead
  if (denominator <= 0) return UNAVAILABLE_TEXT
  return `${oneDecimal((cacheRead / denominator) * 100)}%`
}

/**
 * 六项指标（顺序固定）；分项缺失时该项 `text` 为 `不可得`，不补 0。
 *
 * r18b t6：前四项 token 数量改用 `formatTokenUnits`（带 K/M/B 单位、固定两位小数）；
 * `calls` 仍是次数整数、`hitRate` 仍是百分比——这两项不是 token 量，不许套单位。
 * r19：合计 `UsageCell.text` 也改走 `formatTokenUnits`，面板不再出现逗号 token 数字。
 */
export function usageMetricsOf(totals: TokenTotals | undefined): UsageMetric[] {
  const metric = (key: UsageMetricKey, label: string, value: string): UsageMetric => ({
    key,
    label,
    text: value,
    available: value !== UNAVAILABLE_TEXT,
  })
  return [
    metric('input', '输入未命中', formatTokenUnits(totals?.input)),
    metric('cacheRead', '输入命中', formatTokenUnits(totals?.cacheRead)),
    metric('cacheWrite', '写缓存', formatTokenUnits(totals?.cacheWrite)),
    metric('output', '输出', formatTokenUnits(totals?.output)),
    metric('calls', '调用次数', formatTokens(totals?.calls)),
    metric('hitRate', '缓存命中率', formatCacheHitRate(totals)),
  ]
}

/**
 * 归一后的用量单元格（AC-19）：有可用合计 → `provider`（含 `0`），否则 → `unavailable`。
 *
 * `reason` 是被展示给人看的「为什么拿不到」，调用方必须给一句人话（如「该成员未上报用量」）。
 * r17：provider 时同时给出 `text`（合计，宿主生成）与 `details`（六项指标），客户端零拼接。
 * r19：`text` 与六项同一口径（`formatTokenUnits`）——`60_421` → `60.42K`、`0` → `0`；
 * 本单元格被 run 头成员合计 / 角色卡 / 任务行 / 流程图节点 / 历史行 / 项目库 / 成员页复用。
 */
export function usageCellOf(totals: TokenTotals | undefined, reason: string): UsageCell {
  if (!totals || !usableNumber(totals.total)) return { source: 'unavailable', reason }
  const tokens: TokenTotals = { total: Math.round(totals.total) }
  if (usableNumber(totals.input)) tokens.input = Math.round(totals.input)
  if (usableNumber(totals.output)) tokens.output = Math.round(totals.output)
  if (usableNumber(totals.cacheRead)) tokens.cacheRead = Math.round(totals.cacheRead)
  if (usableNumber(totals.cacheWrite)) tokens.cacheWrite = Math.round(totals.cacheWrite)
  if (usableNumber(totals.calls)) tokens.calls = Math.round(totals.calls)
  return { source: 'provider', tokens, text: formatTokenUnits(tokens.total), details: usageMetricsOf(tokens) }
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
