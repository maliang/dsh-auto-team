/**
 * noWait 守卫单测（AC-4 / AC-5 / AC-6 的纯函数侧）。
 *
 * 三条设计取舍决定了本文件的形状：
 * ① **四拒四放成对写**：只断言「该拒的拒了」会把守卫收紧成误杀，所以每条拒绝都有对应的
 *    近似负样本（`sleep 30` vs `echo sleep` / `grep -r sleep src/` / `(sleep 30) &`）。
 * ② **只作用于队长**：同一批命令在 `role:'member'` 下必须 0 拒绝 —— 守卫误伤成员比不守卫更糟。
 * ③ **变异自检放进单测**（AC-6 的低成本版）：把判定短路成恒放行后重跑同一批断言，必须
 *    至少 4 条变红。若断言集对「恒放行」不敏感，说明它测的是别的东西（例如文案、类型）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NOWAIT_THRESHOLD_MS } from '../src/host/config.ts'
import {
  guardOf,
  isCaptainCommand,
  segmentsOf,
  sleepMsOf,
} from '../src/host/team/guard.ts'
import type { GuardRequest, GuardVerdict } from '../src/host/team/guard.ts'

const GUARD_SOURCE = 'src/host/team/guard.ts'

/** 队长上下文里的一次 bash 调用。 */
function captainBash(command: string): GuardRequest {
  return { role: 'captain', toolName: 'bash', args: { command } }
}

/** 成员上下文里的同一条命令。 */
function memberBash(command: string): GuardRequest {
  return { role: 'member', toolName: 'bash', args: { command } }
}

/** 被拒结论（去掉 `allow:true` 分支，测试里不必反复收窄）。 */
type Rejected = Extract<GuardVerdict, { allow: false }>

/** 断言被拒，并返回原因码（拒绝原因码是 AC-4 的可读判据）。 */
function expectReject(command: string, code?: string): Rejected {
  const verdict = guardOf(captainBash(command))
  assert.equal(verdict.allow, false, `ASSERT ${command} 应被拒绝`)
  const rejected = verdict as Rejected
  if (code !== undefined) {
    assert.equal(rejected.code, code, `ASSERT ${command} 的原因码应为 ${code}`)
  }
  return rejected
}

/** 断言放行。 */
function expectAllow(command: string): void {
  const verdict = guardOf(captainBash(command))
  assert.equal(
    verdict.allow,
    true,
    `ASSERT ${command} 应放行（误杀是守卫最大的风险）`,
  )
}

/* ───────────────── AC-4：四类同步长等待被拒 ───────────────── */

test('AC-4 四条拒绝：sleep 30 / sleep 1m / bash -c sleep 30 / tail -f', () => {
  expectReject('sleep 30', 'NOWAIT_FOREGROUND_WAIT')
  expectReject('sleep 1m', 'NOWAIT_FOREGROUND_WAIT')
  expectReject("bash -c 'sleep 30'", 'NOWAIT_FOREGROUND_WAIT')
  expectReject('tail -f app.log', 'NOWAIT_UNBOUNDED_OUTPUT')
})

test('AC-4 拒绝文案可读：带原因码 + 命中命令 + 下一步', () => {
  const verdict = expectReject('sleep 30', 'NOWAIT_FOREGROUND_WAIT')
  assert.match(verdict.message, /NOWAIT_FOREGROUND_WAIT/)
  assert.match(verdict.message, /sleep 30/)
  assert.match(verdict.message, /下一步/)
  assert.equal(verdict.command, 'sleep 30')
})

test('AC-4 另外两类：无界输出与同步阻塞各有独立原因码', () => {
  expectReject('watch -n 1 ls', 'NOWAIT_UNBOUNDED_OUTPUT')
  expectReject('yes', 'NOWAIT_UNBOUNDED_OUTPUT')
  expectReject('top', 'NOWAIT_UNBOUNDED_OUTPUT')
  expectReject('less README.md', 'NOWAIT_UNBOUNDED_OUTPUT')
  expectReject('vim notes.md', 'NOWAIT_UNBOUNDED_OUTPUT')
  expectReject('ssh dev@example.com', 'NOWAIT_UNBOUNDED_OUTPUT')
  expectReject('wait', 'NOWAIT_BLOCKING_TTY')
  expectReject('read answer', 'NOWAIT_BLOCKING_TTY')
})

test('AC-4 包装命令不改变段首语义：sudo / time / env 前缀照样拒', () => {
  expectReject('sudo sleep 30', 'NOWAIT_FOREGROUND_WAIT')
  expectReject('sudo -u root sleep 30', 'NOWAIT_FOREGROUND_WAIT')
  expectReject('time sleep 30', 'NOWAIT_FOREGROUND_WAIT')
  expectReject('FOO=1 sleep 30', 'NOWAIT_FOREGROUND_WAIT')
  expectReject('/bin/sleep 30', 'NOWAIT_FOREGROUND_WAIT')
})

test('AC-4 段尾等待与复合命令里的等待也能识别', () => {
  expectReject('echo start && sleep 30', 'NOWAIT_FOREGROUND_WAIT')
  expectReject('sleep 30; echo done', 'NOWAIT_FOREGROUND_WAIT')
  expectReject('echo start | sleep 30', 'NOWAIT_FOREGROUND_WAIT')
  expectReject('(sleep 30)', 'NOWAIT_FOREGROUND_WAIT')
  expectReject('for i in 1 2; do sleep 30; done', 'NOWAIT_FOREGROUND_WAIT')
})

test('AC-4 嵌套 bash -c 递归解析（上限 2 层，深了放行而不是误杀）', () => {
  expectReject('bash -lc "sleep 30"', 'NOWAIT_FOREGROUND_WAIT')
  expectReject("bash -c \"bash -c 'sleep 30'\"", 'NOWAIT_FOREGROUND_WAIT')
  // 第 3 层不再解析：宁可少拦一次，也不能因为解析失败把正常工作挡死。
  expectAllow("bash -c \"bash -c \\\"bash -c 'sleep 30'\\\"\"")
})

/* ───────────────── AC-5：四组负样本放行 + 只作用于队长 ───────────────── */

test('AC-5 四组负样本全部放行（判据是段首语义，不是字符串包含 sleep）', () => {
  expectAllow("bash -c 'echo sleep'")
  expectAllow('grep -r sleep src/')
  expectAllow('(sleep 30) &')
  expectAllow('git status')
})

test('AC-5 更多近似命令必须放行（误杀回归集）', () => {
  expectAllow('echo sleep 30')
  expectAllow('rg "sleep 30" docs/')
  expectAllow('sleep 1')
  expectAllow('sleep 0.5 && echo ok')
  expectAllow('sleep 30 &')
  expectAllow('sleep 30 > /dev/null 2>&1 &')
  expectAllow('(sleep 30) > log 2>&1 &')
  expectAllow('for i in 1 2 3; do sleep 1; done')
  expectAllow('tail -n 50 app.log')
  expectAllow('tail --lines=20 app.log')
  expectAllow('ssh -T dev@example.com ls')
  expectAllow("ssh dev@example.com 'ls -l'")
  expectAllow('read -t 5 answer')
  expectAllow('wait 12345')
  expectAllow('timeout 3 tail -f app.log')
  expectAllow('pnpm -s test')
  expectAllow('cat package.json | head -20')
  expectAllow('echo "a;b" && echo "c|d"')
})

test('AC-5 只作用于队长：同一批命令在 member 上下文 0 拒绝', () => {
  const commands = [
    'sleep 30',
    'sleep 1m',
    "bash -c 'sleep 30'",
    'tail -f app.log',
    'watch -n 1 ls',
    'wait',
    'ssh dev@example.com',
  ]
  for (const command of commands) {
    assert.equal(guardOf(memberBash(command)).allow, true, `ASSERT member ${command} 应放行`)
  }
})

test('只对 bash 生效，参数形状不认识时 fail-open', () => {
  assert.equal(guardOf({ role: 'captain', toolName: 'write', args: { command: 'sleep 30' } }).allow, true)
  assert.equal(guardOf({ role: 'captain', toolName: 'bash', args: {} }).allow, true)
  assert.equal(guardOf({ role: 'captain', toolName: 'bash', args: { command: 30 } }).allow, true)
  assert.equal(guardOf({ role: 'captain', toolName: 'bash', args: null }).allow, true)
  assert.equal(guardOf({ role: 'captain', toolName: 'bash', args: undefined }).allow, true)
})

/* ───────────────── 阈值边界与时长解析 ───────────────── */

test('阈值 5000 边界：sleep 5 拒、sleep 4.9 放行（判据是 >= 阈值）', () => {
  assert.equal(NOWAIT_THRESHOLD_MS, 5_000)
  expectReject('sleep 5', 'NOWAIT_FOREGROUND_WAIT')
  expectReject('sleep 5.0', 'NOWAIT_FOREGROUND_WAIT')
  expectAllow('sleep 4.9')
  expectAllow('sleep 4999ms')
  expectReject('sleep 5000ms', 'NOWAIT_FOREGROUND_WAIT')
})

test('阈值可注入：同一条命令在不同阈值下结论相反（单一定义 + 可测）', () => {
  const command = captainBash('sleep 3')
  assert.equal(guardOf(command, 2_000).allow, false)
  assert.equal(guardOf(command, 10_000).allow, true)
})

test('sleepMsOf 时长表', () => {
  const table: Array<[string, number | null]> = [
    ['sleep 30', 30_000],
    ['sleep 1.5', 1_500],
    ['sleep 2m30s', 150_000],
    ['sleep 1h', 3_600_000],
    ['sleep 100ms', 100],
    ['sleep 1d', 86_400_000],
    ['sleep 1m 30', 90_000],
    ['sleep 0', 0],
    ['sleep infinity', Number.POSITIVE_INFINITY],
    ['sudo sleep 2m', 120_000],
    ['echo sleep', null],
    ['grep -r sleep src/', null],
    ['sleep', null],
    ['sleep abc', null],
  ]
  for (const [command, expected] of table) {
    assert.equal(sleepMsOf(command), expected, `ASSERT sleepMsOf(${command})`)
  }
})

test('segmentsOf：切段与后台标记（含引号、重定向、&& 不误判为后台）', () => {
  assert.deepEqual(segmentsOf('echo a; echo b'), [
    { text: 'echo a', background: false },
    { text: 'echo b', background: false },
  ])
  assert.deepEqual(segmentsOf('echo a && sleep 30'), [
    { text: 'echo a', background: false },
    { text: 'sleep 30', background: false },
  ])
  assert.deepEqual(segmentsOf('a || b'), [
    { text: 'a', background: false },
    { text: 'b', background: false },
  ])
  assert.deepEqual(segmentsOf('cat x | head -1'), [
    { text: 'cat x', background: false },
    { text: 'head -1', background: false },
  ])
  assert.deepEqual(segmentsOf('sleep 30 &'), [{ text: 'sleep 30', background: true }])
  assert.deepEqual(segmentsOf('(sleep 30) &'), [{ text: '(sleep 30)', background: true }])
  assert.deepEqual(segmentsOf('sleep 30 > log 2>&1 &'), [
    { text: 'sleep 30 > log 2>&1', background: true },
  ])
  // 引号里的分隔符不是分隔符
  assert.deepEqual(segmentsOf('echo "a;b|c"'), [{ text: 'echo "a;b|c"', background: false }])
  assert.deepEqual(segmentsOf(''), [])
})

test('isCaptainCommand 复用同一套判据（不另写一份包含匹配）', () => {
  assert.equal(isCaptainCommand('sleep 30'), true)
  assert.equal(isCaptainCommand('echo sleep'), false)
  assert.equal(isCaptainCommand('(sleep 30) &'), false)
})

/* ───────────────── AC-6：变异自检（恒放行必然变红） ───────────────── */

test('AC-6 变异自检：把 guardOf 短路成恒放行后，本文件的拒绝断言必然变红', () => {
  const rejected = [
    'sleep 30',
    'sleep 1m',
    "bash -c 'sleep 30'",
    'tail -f app.log',
    'watch -n 1 ls',
    'wait',
    'read answer',
  ]
  // 正确实现：全部拒绝。
  for (const command of rejected) {
    assert.equal(guardOf(captainBash(command)).allow, false, `ASSERT ${command} 被拒绝`)
  }
  // 变异实现（恒放行）：同一批断言必须全部变红 —— 红的数量就是断言的敏感度。
  const mutated = (_request: GuardRequest): GuardVerdict => ({ allow: true })
  const red = rejected.filter((command) => mutated(captainBash(command)).allow !== false)
  assert.equal(red.length, rejected.length, 'ASSERT 断言集对「恒放行」不敏感')
})

/* ───────────────── 纯净性：零宿主依赖（结构判据） ───────────────── */

test('guard.ts 零宿主依赖：不 import 宿主模块、不出现 ctx.', () => {
  const source = readFileSync(GUARD_SOURCE, 'utf8')
  const imports = [...source.matchAll(/^import[^\n]*from '([^']+)'/gm)].map((match) => match[1] ?? '')
  assert.deepEqual(imports, ['../config.ts'], 'ASSERT guard.ts 只允许 import 纯常量 config.ts')
  assert.equal(/ctx\./.test(source), false, 'ASSERT guard.ts 不得出现 ctx.')
  assert.equal(/from '\.\.\/(adapters|bridge|store|tools|index)\.ts'/.test(source), false)
})
