/**
 * r13 T2：宿主格式化纯函数（AC-7 / AC-19 / AC-20 的机械底座）。
 *
 * 这些断言之所以值得逐条写死：面板上**所有** token 与用时文本都来自这里，客户端只渲染
 * `text`。任何一条边界漂移（0 秒 / 0 token / 不可得）都会在右栏与左栏同时出现，
 * 而「不可得」被写成 0 就是本需求最明确的反模式。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  UNAVAILABLE_TEXT,
  durationCellOf,
  formatCacheHitRate,
  formatCompactTokens,
  formatDuration,
  formatTokenUnits,
  formatTokens,
  memoryTokenEstimate,
  usageCellOf,
  waitedTextOf,
} from '../src/host/format.ts'

const NOW = 1_700_000_000_000

test('formatTokens：千分位手写、0 合法、缺失/负数一律「不可得」', () => {
  assert.equal(formatTokens(0), '0', '0 token 是真话，不是缺失')
  assert.equal(formatTokens(7), '7')
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(1000), '1,000')
  assert.equal(formatTokens(1234), '1,234')
  assert.equal(formatTokens(999999999), '999,999,999')
  assert.equal(formatTokens(1234567), '1,234,567')
  assert.equal(formatTokens(null), UNAVAILABLE_TEXT)
  assert.equal(formatTokens(undefined), UNAVAILABLE_TEXT)
  assert.equal(formatTokens(Number.NaN), UNAVAILABLE_TEXT)
  assert.equal(formatTokens(-1), UNAVAILABLE_TEXT, '负数不是用量')
  assert.equal(formatTokens(1.6), '2', '小数四舍五入到整 token')
})

test('formatCompactTokens：节点第二行用，千级/百万级各一位小数', () => {
  assert.equal(formatCompactTokens(0), '0')
  assert.equal(formatCompactTokens(999), '999')
  assert.equal(formatCompactTokens(1000), '1k')
  assert.equal(formatCompactTokens(1234), '1.2k')
  assert.equal(formatCompactTokens(12345), '12.3k')
  assert.equal(formatCompactTokens(999999), '1000k')
  assert.equal(formatCompactTokens(1_000_000), '1M')
  assert.equal(formatCompactTokens(1_234_567), '1.2M')
  assert.equal(formatCompactTokens(undefined), UNAVAILABLE_TEXT)
})

test('formatTokenUnits：六个 token 指标带动态单位、两位小数（r18b t6）', () => {
  // < 1000 原样整数，不补小数
  assert.equal(formatTokenUnits(0), '0')
  assert.equal(formatTokenUnits(7), '7')
  assert.equal(formatTokenUnits(999), '999')
  // 跨过 1000 就上单位，固定两位小数
  assert.equal(formatTokenUnits(1_000), '1.00K')
  assert.equal(formatTokenUnits(1_234), '1.23K')
  assert.equal(formatTokenUnits(34_930), '34.93K')
  assert.equal(formatTokenUnits(69_459), '69.46K', '四舍五入到两位：69.459 → 69.46')
  // 999,999 ≈ 1000.00K：必须进位成 1.00M，界面上不许出现「1000.00K」
  assert.equal(formatTokenUnits(999_999), '1.00M')
  assert.equal(formatTokenUnits(1_000_000), '1.00M')
  assert.equal(formatTokenUnits(1_500_000), '1.50M')
  assert.equal(formatTokenUnits(2_000_000), '2.00M')
  // 十亿级同样两位小数；999,999,999 进位成 1.00B
  assert.equal(formatTokenUnits(1_000_000_000), '1.00B')
  assert.equal(formatTokenUnits(999_999_999), '1.00B')
  // 缺失/非法不伪造数值
  assert.equal(formatTokenUnits(null), UNAVAILABLE_TEXT)
  assert.equal(formatTokenUnits(undefined), UNAVAILABLE_TEXT)
  assert.equal(formatTokenUnits(Number.NaN), UNAVAILABLE_TEXT)
  assert.equal(formatTokenUnits(-1), UNAVAILABLE_TEXT, '负数不是用量')
})

test('formatDuration：六段边界逐字对应 AC-20', () => {
  assert.equal(formatDuration(null), UNAVAILABLE_TEXT)
  assert.equal(formatDuration(undefined), UNAVAILABLE_TEXT)
  assert.equal(formatDuration(Number.NaN), UNAVAILABLE_TEXT)
  assert.equal(formatDuration(-5), UNAVAILABLE_TEXT)
  assert.equal(formatDuration(0), '0 秒')
  assert.equal(formatDuration(999), '0 秒', '不足 1 秒按 0 秒，不虚报')
  assert.equal(formatDuration(1000), '1 秒')
  assert.equal(formatDuration(59_999), '59 秒')
  assert.equal(formatDuration(60_000), '1 分 00 秒')
  assert.equal(formatDuration(1_800_000), '30 分 00 秒')
  assert.equal(formatDuration(3_599_999), '59 分 59 秒')
  assert.equal(formatDuration(3_600_000), '1 小时 00 分')
  assert.equal(formatDuration(5_400_000), '1 小时 30 分')
  assert.equal(formatDuration(359_999_999), '99 小时 59 分')
  assert.equal(formatDuration(360_000_000), '100 小时', '超过 100 小时省掉分钟')
})

test('usageCellOf：有数字就是 provider（含 0），没有就 unavailable + 原因', () => {
  assert.deepEqual(usageCellOf(undefined, '宿主未上报'), { source: 'unavailable', reason: '宿主未上报' })
  assert.deepEqual(usageCellOf({ total: Number.NaN }, '坏数据'), { source: 'unavailable', reason: '坏数据' })
  const zero = usageCellOf({ total: 0 }, '不该出现')
  assert.equal(zero.source, 'provider')
  assert.deepEqual(zero.tokens, { total: 0 }, '0 token 是真话，不是缺失')
  assert.equal(zero.text, '0')

  const full = usageCellOf({ total: 10, input: 4, output: 6 }, '不该出现')
  assert.deepEqual(full.tokens, { total: 10, input: 4, output: 6 })
  assert.equal(full.text, '10')
  assert.deepEqual(
    full.details?.map((metric) => [metric.key, metric.text]),
    [
      ['input', '4'],
      ['cacheRead', UNAVAILABLE_TEXT],
      ['cacheWrite', UNAVAILABLE_TEXT],
      ['output', '6'],
      ['calls', UNAVAILABLE_TEXT],
      ['hitRate', UNAVAILABLE_TEXT],
    ],
    '没给分项就不凭空补 0：缺失项一律「不可得」',
  )

  const partial = usageCellOf({ total: 5, input: 3 }, '不该出现')
  assert.equal(partial.tokens?.input, 3)
  assert.equal(partial.tokens?.output, undefined, '没给分项就不凭空补 0')
})

test('usageCellOf 六项：真实宿主 usage 的命中率与四项 token 分量（r18b t6 带单位）', () => {
  const cell = usageCellOf(
    { total: 60_421, input: 29_229, output: 344, cacheRead: 30_848, cacheWrite: 0, calls: 1 },
    '不该出现',
  )
  assert.deepEqual(cell.tokens, { total: 60_421, input: 29_229, output: 344, cacheRead: 30_848, cacheWrite: 0, calls: 1 })
  assert.equal(cell.text, '60.42K', 'r19：合计与六项同一口径（动态单位），不再给逗号数字')
  assert.deepEqual(
    cell.details?.map((metric) => [metric.key, metric.label, metric.text, metric.available]),
    [
      ['input', '输入未命中', '29.23K', true],
      ['cacheRead', '输入命中', '30.85K', true],
      ['cacheWrite', '写缓存', '0', true],
      ['output', '输出', '344', true],
      ['calls', '调用次数', '1', true],
      ['hitRate', '缓存命中率', '51.3%', true],
    ],
    '四项 token 带单位；calls 仍是次数、hitRate 仍是百分比；命中率 = cacheRead / (input + cacheRead)',
  )
})

test('usageCellOf 合计 text 边界（r19）：动态单位与六项同口径，0 仍显示 0', () => {
  const textOf = (total: number): string => {
    const text = usageCellOf({ total }, '不该出现').text
    assert.equal(typeof text, 'string', `${total} 必须给出宿主文本`)
    return text ?? ''
  }
  // < 1000：原样整数，不补小数点（999 token 就写 999）
  assert.equal(textOf(0), '0', '0 token 是真话，不许变成「不可得」')
  assert.equal(textOf(1), '1')
  assert.equal(textOf(999), '999')
  // 阈值：跨过 1,000 立刻上 K，固定两位小数
  assert.equal(textOf(1_000), '1.00K')
  // 999,999 的 999.999K 四舍五入进位成 1.00M（界面永不出现 1000.00K）
  assert.equal(textOf(999_999), '1.00M')
  assert.equal(textOf(1_000_000), '1.00M')
  assert.equal(textOf(1_234_567), '1.23M')
  // 十亿级：两位小数；999,999,999 同样进位
  assert.equal(textOf(999_999_999), '1.00B')
  assert.equal(textOf(1_000_000_000), '1.00B')
  // 两位小数四舍五入：246.910K → 246.91K；69.459K → 69.46K
  assert.equal(textOf(246_910), '246.91K')
  assert.equal(textOf(69_459), '69.46K')
  assert.equal(textOf(60_421), '60.42K')
  // 不出现科学计数法 / 小数点位数漂移
  assert.equal(textOf(12_345), '12.35K')
  assert.equal(/e[+-]?\d/i.test(textOf(1_000_000_000)), false)
  // 缺失与负数仍是「不可得」，不是 0、不是 NaN
  assert.equal(usageCellOf(undefined, '没有用量来源').source, 'unavailable')
  assert.equal(usageCellOf({ total: Number.NaN }, '坏数据').source, 'unavailable')
  assert.equal(usageCellOf({ total: -1 }, '负数').source, 'unavailable')
})

test('usageCellOf 命中率边界：分母为 0 或缺一侧 → 不可得，不用一半数据算比率', () => {
  assert.equal(formatCacheHitRate({ total: 0, input: 0, cacheRead: 0 }), UNAVAILABLE_TEXT)
  assert.equal(formatCacheHitRate({ total: 10, input: 10 }), UNAVAILABLE_TEXT)
  assert.equal(formatCacheHitRate({ total: 10, cacheRead: 10 }), UNAVAILABLE_TEXT)
  assert.equal(formatCacheHitRate({ total: 20, input: 5, cacheRead: 15 }), '75%', '整数去掉 .0')
  assert.equal(formatCacheHitRate(undefined), UNAVAILABLE_TEXT)
})

test('durationCellOf：四态互斥，未开始/不可得都不伪装成 0 秒', () => {
  assert.deepEqual(durationCellOf({ state: 'not-started', now: NOW }), { state: 'not-started', text: '未开始' })
  assert.deepEqual(durationCellOf({ state: 'unavailable', now: NOW }), {
    state: 'unavailable',
    text: UNAVAILABLE_TEXT,
  })
  assert.deepEqual(durationCellOf({ startAt: NOW, endAt: NOW + 65_000, state: 'done', now: NOW + 99_000 }), {
    startAt: NOW,
    endAt: NOW + 65_000,
    ms: 65_000,
    text: '1 分 05 秒',
    state: 'done',
  })
  assert.deepEqual(durationCellOf({ startAt: NOW, state: 'running', now: NOW + 5_000 }), {
    startAt: NOW,
    endAt: NOW + 5_000,
    ms: 5_000,
    text: '5 秒',
    state: 'running',
  })
  // 期望已结束但拿不到结束时间：不可得，而不是「跑到今天」
  assert.equal(durationCellOf({ startAt: NOW, state: 'done', now: NOW + 5_000 }).state, 'unavailable')
  // 期望运行中但没有起点：不可得
  assert.equal(durationCellOf({ state: 'running', now: NOW }).state, 'unavailable')
  // 时间倒流（endAt < startAt）夹到 0，不产出负时长
  assert.equal(durationCellOf({ startAt: NOW, endAt: NOW - 10_000, state: 'done', now: NOW }).ms, 0)
})

test('memoryTokenEstimate：ceil(chars/2)，非法输入按 0', () => {
  assert.equal(memoryTokenEstimate(0), 0)
  assert.equal(memoryTokenEstimate(1), 1)
  assert.equal(memoryTokenEstimate(2), 1)
  assert.equal(memoryTokenEstimate(101), 51)
  assert.equal(memoryTokenEstimate(Number.NaN), 0)
  assert.equal(memoryTokenEstimate(-3), 0)
})

test('waitedTextOf：未决确认的已等待时长（AC-13），不落盘、每次重算', () => {
  assert.equal(waitedTextOf(NOW, NOW), '刚刚')
  assert.equal(waitedTextOf(NOW, NOW + 59_999), '刚刚')
  assert.equal(waitedTextOf(NOW, NOW + 60_000), '已等待 1 分')
  assert.equal(waitedTextOf(NOW, NOW + 59 * 60_000), '已等待 59 分')
  assert.equal(waitedTextOf(NOW, NOW + 60 * 60_000), '已等待 1 小时')
  assert.equal(waitedTextOf(NOW, NOW + 61 * 60_000), '已等待 1 小时 1 分')
  assert.equal(waitedTextOf(Number.NaN, NOW), '刚刚', '坏时间戳不产出「已等待 NaN 分」')
})
