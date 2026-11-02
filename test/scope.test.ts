/**
 * 写域纯函数单测（r11 AC-12/AC-13/AC-16/AC-19；node --test 直跑 TS 源）。
 *
 * 关键判据是**可分辨性**：AC-13 的变异自检是「把 `scopesConflict` 的目录边界改回裸
 * `startsWith`，`src/host` vs `src/hostile.ts` 这一格必须变红」。所以反例（不冲突）
 * 与正例（冲突）成对出现，缺一半就证明不了边界规则。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  conflictingScopes,
  deriveScopeLocks,
  normalizeWriteScopes,
  scopesConflict,
  waitReasonOf,
} from '../src/host/plan/scope.ts'
import type { MemberBinding, PlanTask, TaskStatus } from '../src/shared/types.ts'

function task(id: string, status: TaskStatus, writeScopes?: string[], extra: Partial<PlanTask> = {}): PlanTask {
  const target: PlanTask = {
    id,
    title: id,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'true',
    status,
  }
  if (writeScopes !== undefined) target.writeScopes = writeScopes
  return Object.assign(target, extra)
}

function binding(taskId: string, name: string, retired?: boolean): MemberBinding {
  const item: MemberBinding = { taskId, roleId: 'dev', memberId: `m-${taskId}`, name, spawnedAt: 1 }
  if (retired === true) item.retired = true
  return item
}

/* ───────────────────────── ① 归一（AC-12） ───────────────────────── */

test('归一：去 ./、折叠 //、去尾 /、反斜杠转斜杠（真值表）', () => {
  const cases: Array<[string, string]> = [
    ['./src/host/bridge.ts', 'src/host/bridge.ts'],
    ['src//host///bridge.ts', 'src/host/bridge.ts'],
    ['src/host/', 'src/host'],
    ['src/host///', 'src/host'],
    ['src\\host\\bridge.ts', 'src/host/bridge.ts'],
    ['  src/host/bridge.ts  ', 'src/host/bridge.ts'],
    ['././src/host', 'src/host'],
  ]
  for (const [input, expected] of cases) {
    const result = normalizeWriteScopes([input])
    assert.equal(result.ok, true, `${input} 应被接受`)
    assert.deepEqual(result.ok === true ? result.scopes : [], [expected], `${input} 归一后应为 ${expected}`)
  }
})

test('归一：去重 + 排序（内容指纹稳定，AC-9 幂等的隐含前提）', () => {
  const result = normalizeWriteScopes(['src/b.ts', 'src/a.ts', './src/b.ts', 'src/c/'])
  assert.equal(result.ok, true)
  assert.deepEqual(result.ok === true ? result.scopes : [], ['src/a.ts', 'src/b.ts', 'src/c'])
  // 同内容不同顺序必须得到同一个数组
  const reordered = normalizeWriteScopes(['src/c', 'src/a.ts', 'src/b.ts'])
  assert.deepEqual(reordered.ok === true ? reordered.scopes : [], ['src/a.ts', 'src/b.ts', 'src/c'])
})

test('归一：缺省即空（= 不限，不参与互斥）', () => {
  for (const input of [undefined, null, []]) {
    const result = normalizeWriteScopes(input)
    assert.equal(result.ok, true)
    assert.deepEqual(result.ok === true ? result.scopes : ['x'], [])
  }
})

test('归一：非法输入三类各给可读原因码（AC-12）', () => {
  const cases: Array<[unknown, RegExp]> = [
    [[''], /WRITE_SCOPE_EMPTY：写域里不能有空串元素/],
    [['   '], /WRITE_SCOPE_EMPTY/],
    [['/etc/passwd'], /WRITE_SCOPE_ABSOLUTE：.*绝对路径/],
    [['C:/tmp/x'], /WRITE_SCOPE_ABSOLUTE/],
    [['C:\\tmp\\x'], /WRITE_SCOPE_ABSOLUTE/],
    [['src/../../etc'], /WRITE_SCOPE_ESCAPE：.*\.\./],
    [['..'], /WRITE_SCOPE_ESCAPE/],
    [['src', '/abs'], /WRITE_SCOPE_ABSOLUTE/],
    [['src', 42], /WRITE_SCOPE_TYPE：写域元素必须是字符串/],
    ['src/host', /WRITE_SCOPE_TYPE：写域必须是字符串数组/],
  ]
  for (const [input, pattern] of cases) {
    const result = normalizeWriteScopes(input)
    assert.equal(result.ok, false, `${JSON.stringify(input)} 应被拒绝`)
    assert.match(result.ok === false ? result.error : '', pattern)
  }
})

/* ───────────────────────── ② 冲突判定（AC-13，变异点） ───────────────────────── */

test('冲突真值表：相等 / 目录边界 / 反例（src/host 与 src/hostile.ts 不冲突）', () => {
  const truth: Array<[string, string, boolean]> = [
    ['src/host', 'src/host', true],
    ['src/host', 'src/host/bridge.ts', true],
    ['src/host/bridge.ts', 'src/host', true],
    ['src/host/', 'src/host/bridge.ts', true],
    // 反例：裸 startsWith 会误判成冲突（AC-13 的变异点）
    ['src/host', 'src/hostile.ts', false],
    ['src/host', 'src/hostile/bridge.ts', false],
    ['src/hostile.ts', 'src/hostile.ts', true],
    ['src/a.ts', 'src/b.ts', false],
    ['src/host', 'src/client', false],
    ['', 'src/host', false],
  ]
  for (const [a, b, expected] of truth) {
    assert.equal(scopesConflict(a, b), expected, `${a} vs ${b} 应为 ${expected ? '冲突' : '不冲突'}`)
    assert.equal(scopesConflict(b, a), expected, `冲突判定必须对称：${b} vs ${a}`)
  }
})

test('conflictingScopes：只返回真正冲突的那几条持有路径（按声明顺序、去重）', () => {
  assert.deepEqual(conflictingScopes(['src/host', 'src/client'], ['src/host/bridge.ts']), ['src/host'])
  assert.deepEqual(conflictingScopes(['src/host', 'src/client'], ['src/shared/types.ts']), [])
  assert.deepEqual(
    conflictingScopes(['src/host', 'src/host', 'src/a.ts'], ['src/host/tools.ts']),
    ['src/host'],
    '同一路径只报一次（等待原因里不能出现两遍）',
  )
})

/* ───────────────────────── ③ 等待文案与锁视图（AC-14/AC-19） ───────────────────────── */

test('waitReasonOf：逐字「等待 t2 释放 src/host/bridge.ts」', () => {
  assert.equal(waitReasonOf('t2', 'src/host/bridge.ts'), '等待 t2 释放 src/host/bridge.ts')
})

test('锁视图：同一路径的多个等待者合进一条，reason 取快照原文（零拼装）', () => {
  const tasks = [
    task('t1', 'running', ['src/host']),
    task('t2', 'waiting', ['src/host/bridge.ts'], { waitingOn: ['t1'], waitReason: '等待 t1 释放 src/host' }),
    task('t3', 'waiting', ['src/host/tools.ts']),
  ]
  const locks = deriveScopeLocks(tasks, [binding('t1', 'dev-1'), binding('t2', 'dev-2')])
  assert.equal(locks.length, 1, '一条持有路径 = 一行')
  const lock = locks[0]!
  assert.equal(lock.path, 'src/host')
  assert.equal(lock.holderTaskId, 't1')
  assert.equal(lock.holderMember, 'dev-1')
  assert.deepEqual(
    lock.waiters.map((waiter) => waiter.taskId),
    ['t2', 't3'],
  )
  assert.equal(lock.waiters[0]!.reason, '等待 t1 释放 src/host', '快照里的原因必须原样透传')
  assert.equal(lock.waiters[0]!.member, 'dev-2')
  assert.equal(lock.waiters[1]!.reason, '等待 t1 释放 src/host', '缺省原因由宿主现算（同一文案函数）')
  assert.equal(lock.waiters[1]!.member, undefined, '没有绑定时不编造成员名')
})

test('锁视图：只有 running/gate 是持有者；不冲突的等待者不出现', () => {
  const tasks = [
    task('t1', 'gate', ['src/host']),
    task('t2', 'pending', ['src/host'], {}),
    task('t3', 'waiting', ['src/hostile.ts']),
  ]
  const locks = deriveScopeLocks(tasks)
  assert.equal(locks.length, 1)
  assert.equal(locks[0]!.holderTaskId, 't1', 'gate 也是持有者（门禁期间成员仍可能改文件）')
  assert.deepEqual(locks[0]!.waiters, [], '不冲突（目录边界外）的等待者不能挂进来')

  const none = deriveScopeLocks([task('t9', 'running')])
  assert.deepEqual(none, [], '没写域 = 不限，不产生锁行')
})

test('锁视图：多写域逐条成行；retired 绑定不参与成员名', () => {
  const tasks = [task('t1', 'running', ['src/host', 'src/client']), task('t2', 'waiting', ['src/client/ui.ts'])]
  const locks = deriveScopeLocks(tasks, [binding('t1', 'dev-1', true)])
  assert.deepEqual(
    locks.map((lock) => lock.path),
    ['src/host', 'src/client'],
  )
  assert.equal(locks[0]!.holderMember, undefined)
  assert.deepEqual(
    locks[1]!.waiters.map((waiter) => waiter.taskId),
    ['t2'],
  )
})
