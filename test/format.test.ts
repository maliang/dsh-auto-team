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
  formatCompactTokens,
  formatDuration,
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
  assert.deepEqual(usageCellOf({ total: 0 }, '不该出现'), { source: 'provider', tokens: { total: 0 } })
  assert.deepEqual(usageCellOf({ total: 10, input: 4, output: 6 }, '不该出现'), {
    source: 'provider',
    tokens: { total: 10, input: 4, output: 6 },
  })
  const partial = usageCellOf({ total: 5, input: 3 }, '不该出现')
  assert.equal(partial.tokens?.input, 3)
  assert.equal(partial.tokens?.output, undefined, '没给分项就不凭空补 0')
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
