/**
 * 队长留痕单测（r11 F7 / AC-22 / AC-23 / AC-24）。
 *
 * 为什么这些用例必须存在：
 *  - AC-22 的判据是「队长亲手 write/edit 有痕迹、成员没有」——判定错一位，真机上就是「一条都不记」；
 *  - AC-23 的判据是「去掉 try/catch 必须变红」——所以这里注入**必然失败**的落盘路径，断言
 *    `record()` 不抛、`appendDeviation()` 返回 false、`recent()` 空数组；
 *  - AC-24 的判据是「60 秒内 N 次写只留 1 行且 count=N」——必须用注入时钟测，真等 60 秒不现实。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DeviationView } from '../src/shared/types.ts'
import {
  appendDeviation,
  createDeviationRecorder,
  deviationKeyOf,
  deviationPathsOf,
  isCaptainWriteTool,
  mergeDeviation,
  readDeviations,
} from '../src/host/team/deviation.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-t4'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'auto-team-deviation-'))
}

function recordOf(over: Partial<DeviationView> = {}): DeviationView {
  return {
    at: NOW,
    sessionId: SESSION,
    toolName: 'write',
    paths: ['src/host/bridge.ts'],
    reason: '队长直接写入 src/host/bridge.ts',
    count: 1,
    ...over,
  }
}

function linesOf(file: string): DeviationView[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as DeviationView)
}

// ---------------------------------------------------------------------------
// 判定：哪些工具、哪些路径
// ---------------------------------------------------------------------------

test('AC-22：只认 write/edit（含命名空间前缀），bash 写文件不记', () => {
  for (const name of ['write', 'edit', 'fs.write', 'mcp__fs__write', 'files.edit']) {
    assert.equal(isCaptainWriteTool(name), true, `${name} 必须被认作队长写文件`)
  }
  for (const name of ['bash', 'read', 'grep', 'glob', 'multiedit', '']) {
    assert.equal(isCaptainWriteTool(name), false, `${name} 不是 write/edit，不记`)
  }
})

test('AC-22：write 认 path / file_path，edit 认 file_path，取不到返回空数组', () => {
  assert.deepEqual(deviationPathsOf('write', { path: 'src/a.ts', content: 'x' }), ['src/a.ts'])
  assert.deepEqual(deviationPathsOf('write', { file_path: 'src/b.ts' }), ['src/b.ts'])
  assert.deepEqual(deviationPathsOf('edit', { file_path: 'src/c.ts', old_string: 'a' }), ['src/c.ts'])
  // 反斜杠与 `./` 归一（同一文件不因书写差异变成两条）
  assert.deepEqual(deviationPathsOf('write', { path: '.\\src\\host\\bridge.ts' }), ['src/host/bridge.ts'])
  assert.deepEqual(deviationPathsOf('write', { content: '只有正文没有路径' }), [])
  assert.deepEqual(deviationPathsOf('bash', { path: 'src/a.ts' }), [], '非 write/edit 一律不取路径')
  assert.deepEqual(deviationPathsOf('write', undefined), [])
})

test('AC-24：合并键与路径书写顺序无关，与命名空间无关', () => {
  const a = deviationKeyOf({ toolName: 'write', paths: ['a.ts', 'b.ts'] })
  const b = deviationKeyOf({ toolName: 'fs.write', paths: ['b.ts', 'a.ts'] })
  assert.equal(a, b)
  assert.notEqual(a, deviationKeyOf({ toolName: 'write', paths: ['a.ts'] }))
  assert.notEqual(a, deviationKeyOf({ toolName: 'edit', paths: ['a.ts', 'b.ts'] }))
})

// ---------------------------------------------------------------------------
// 合并：60 秒窗口
// ---------------------------------------------------------------------------

test('AC-24：60 秒内同键连续写合并为一条并累加 count', () => {
  const prev = recordOf({ at: NOW, count: 1 })
  const next = recordOf({ at: NOW + 30_000 })
  const outcome = mergeDeviation(prev, next, 60_000)
  assert.equal(outcome.merged, true)
  assert.equal(outcome.record.count, 2)
  assert.equal(outcome.record.at, NOW + 30_000, '时刻取最后一次写（面板显示「几秒前」才有意义）')

  const third = mergeDeviation(outcome.record, recordOf({ at: NOW + 59_999 }), 60_000)
  assert.equal(third.record.count, 3)
})

test('AC-24：窗口外 / 不同路径 / 时钟回拨都不合并', () => {
  const prev = recordOf({ at: NOW })
  assert.equal(mergeDeviation(prev, recordOf({ at: NOW + 60_000 }), 60_000).merged, false)
  assert.equal(mergeDeviation(prev, recordOf({ at: NOW + 1, paths: ['src/other.ts'] }), 60_000).merged, false)
  assert.equal(mergeDeviation(prev, recordOf({ at: NOW - 1 }), 60_000).merged, false, '时钟回拨不合并')
  assert.equal(mergeDeviation(null, recordOf(), 60_000).merged, false)
})

test('AC-24：落盘时窗口内只改写最后一行（文件行数不增长）', () => {
  const file = join(tempDir(), 'deviations.jsonl')
  assert.equal(appendDeviation(file, recordOf({ at: NOW }), 60_000, 500), true)
  assert.equal(appendDeviation(file, recordOf({ at: NOW + 10_000 }), 60_000, 500), true)
  assert.equal(appendDeviation(file, recordOf({ at: NOW + 20_000 }), 60_000, 500), true)

  const rows = linesOf(file)
  assert.equal(rows.length, 1, '三次写只留一行')
  assert.equal(rows[0]?.count, 3, '次数必须累加')
  assert.equal(rows[0]?.at, NOW + 20_000)

  // 窗口外再来一条：必须是新行，且旧行原样保留
  assert.equal(appendDeviation(file, recordOf({ at: NOW + 90_000 }), 60_000, 500), true)
  const after = linesOf(file)
  assert.equal(after.length, 2)
  assert.equal(after[0]?.count, 3)
  assert.equal(after[1]?.count, 1)

  // 不同路径各自成条
  assert.equal(appendDeviation(file, recordOf({ at: NOW + 90_001, paths: ['src/other.ts'] }), 60_000, 500), true)
  assert.equal(linesOf(file).length, 3)
})

test('AC-24：行数超过上限时轮转，只保留最后一半', () => {
  const file = join(tempDir(), 'deviations.jsonl')
  const limit = 4
  for (let index = 0; index < 6; index += 1) {
    // 每条路径不同 ⇒ 不合并，行数线性增长
    appendDeviation(file, recordOf({ at: NOW + index, paths: [`src/f${index}.ts`] }), 60_000, limit)
  }
  const rows = linesOf(file)
  assert.ok(rows.length <= limit, `轮转后行数不得超过上限（实际 ${rows.length}）`)
  assert.equal(rows[rows.length - 1]?.paths[0], 'src/f5.ts', '最新一条必须还在')
  assert.equal(rows[0]?.paths[0], 'src/f3.ts', '溢出时保留的是最后一半（f0/f1 被丢弃）')
  assert.ok(
    rows.every((row) => row.paths[0] !== 'src/f0.ts'),
    '最旧的一批必须在轮转时丢掉',
  )
})

test('readDeviations：返回尾部 limit 条，坏行被丢弃', () => {
  const file = join(tempDir(), 'deviations.jsonl')
  const rows = [0, 1, 2].map((index) => recordOf({ at: NOW + index, paths: [`src/f${index}.ts`] }))
  writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n{坏行}\n`, 'utf8')

  assert.equal(readDeviations(file, 10).length, 3)
  const tail = readDeviations(file, 2)
  assert.equal(tail.length, 2)
  assert.equal(tail[1]?.paths[0], 'src/f2.ts')
  assert.deepEqual(readDeviations(join(tempDir(), 'missing.jsonl'), 10), [], '文件不存在 = 空数组')
})

// ---------------------------------------------------------------------------
// fail-open（AC-23）
// ---------------------------------------------------------------------------

test('AC-23：落盘路径必然失败时 record() 不抛、不改变调用方，且只 warn 一次', () => {
  const dir = tempDir()
  // 把「目录」做成普通文件：mkdirSync(dirname) 必然 ENOTDIR —— 与权限无关，跨机器稳定。
  const blocker = join(dir, 'blocker')
  writeFileSync(blocker, 'not a directory', 'utf8')
  const file = join(blocker, 'deviations.jsonl')

  const warnings: string[] = []
  const recorder = createDeviationRecorder({
    file,
    sessionId: SESSION,
    now: () => NOW,
    warn: (text) => warnings.push(text),
  })

  assert.doesNotThrow(() => recorder.record({ toolName: 'write', args: { path: 'src/a.ts' } }))
  assert.doesNotThrow(() => recorder.record({ toolName: 'write', args: { path: 'src/b.ts' } }))
  assert.equal(existsSync(file), false)
  assert.deepEqual(recorder.recent(), [], '写失败时快照读到空数组，而不是抛错')
  assert.equal(warnings.length, 1, '同一次失败只 warn 一次（不刷日志）')
  assert.match(warnings[0] ?? '', /留痕写入失败/)

  // 直接调 appendDeviation 也必须只返回 false
  assert.equal(appendDeviation(file, recordOf(), 60_000, 500), false)
})

// ---------------------------------------------------------------------------
// 记录器（装配层的真实用法）
// ---------------------------------------------------------------------------

test('AC-22：记录器只记 write/edit，其他工具一条不写', () => {
  const file = join(tempDir(), 'deviations.jsonl')
  const recorder = createDeviationRecorder({ file, sessionId: SESSION, now: () => NOW })

  recorder.record({ toolName: 'bash', args: { command: 'echo x > src/a.ts' } })
  recorder.record({ toolName: 'read', args: { file_path: 'src/a.ts' } })
  assert.equal(existsSync(file), false, '非 write/edit 不该创建文件')

  recorder.record({ toolName: 'write', args: { path: 'src/a.ts', content: '正文' } })
  const rows = recorder.recent()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.sessionId, SESSION)
  assert.equal(rows[0]?.toolName, 'write')
  assert.deepEqual(rows[0]?.paths, ['src/a.ts'])
})

test('AC-22：理由不超过 120 字，且绝不携带文件正文', () => {
  const file = join(tempDir(), 'deviations.jsonl')
  const recorder = createDeviationRecorder({ file, sessionId: SESSION, now: () => NOW })
  const content = `正文标记-${'x'.repeat(500)}`
  const longPath = `src/${'d'.repeat(40)}/${'f'.repeat(40)}/${'g'.repeat(40)}.ts`

  recorder.record({ toolName: 'write', args: { path: longPath, content } })
  const rows = recorder.recent()
  assert.equal(rows.length, 1)
  const reason = rows[0]?.reason ?? ''
  assert.ok(reason.length > 0 && reason.length <= 120, `理由必须 ≤120 字，实际 ${reason.length}`)
  assert.ok(!reason.includes('正文标记'), '留痕里不许出现文件正文')
  assert.ok(!JSON.stringify(rows[0]).includes('正文标记'), '落盘内容里也不许出现正文')
  assert.match(reason, /队长直接写入/)
})

test('AC-24：记录器 recent(limit) 取尾部并受快照上限约束', () => {
  const file = join(tempDir(), 'deviations.jsonl')
  let clock = NOW
  const recorder = createDeviationRecorder({ file, sessionId: SESSION, now: () => clock })
  for (let index = 0; index < 5; index += 1) {
    clock = NOW + index * 120_000
    recorder.record({ toolName: 'write', args: { path: `src/f${index}.ts` } })
  }
  assert.equal(recorder.recent().length, 5)
  const tail = recorder.recent(2)
  assert.equal(tail.length, 2)
  assert.equal(tail[1]?.paths[0], 'src/f4.ts')
})
