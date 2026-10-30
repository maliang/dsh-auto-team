/**
 * 门禁单测：异步化（不阻塞事件循环）/ 注入 GateExec 的失败与超时分支 /
 * 全量日志落盘 + 只回尾部证据 / 空验收命令必须拒绝而非放行。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PlanTask } from '../src/shared/types.ts'
import { EMPTY_ACCEPTANCE_TAIL, defaultGateExec, runGate, tailOf, type GateExec } from '../src/host/gate/gate.ts'
import { GATE_TAIL_CHARS } from '../src/host/config.ts'

const now = 1_700_000_000_000

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 't1',
    title: '实现',
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'pnpm typecheck',
    status: 'running',
    ...overrides,
  }
}

function makeDirs(): { cwd: string; artifactsDir: string; cleanup(): void } {
  const cwd = mkdtempSync(join(tmpdir(), 'auto-team-gate-cwd-'))
  const artifactsDir = mkdtempSync(join(tmpdir(), 'auto-team-gate-art-'))
  return { cwd, artifactsDir, cleanup: () => {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(artifactsDir, { recursive: true, force: true })
  } }
}

test('runGate：注入 exec 成功 → ok=true，证据带退出码与尾部，日志路径进 artifacts', async () => {
  const dirs = makeDirs()
  try {
    let seen = ''
    const exec: GateExec = async (command, opts) => {
      seen = `${command}|${opts.logPath}`
      return { code: 0, tail: 'all green' }
    }
    const outcome = await runGate(makeTask(), {
      cwd: dirs.cwd,
      artifactsDir: dirs.artifactsDir,
      now,
      exec,
    })

    assert.equal(outcome.ok, true)
    assert.equal(outcome.evidence.exitCode, 0)
    assert.equal(outcome.evidence.tail, 'all green')
    assert.equal(outcome.evidence.at, now)
    assert.equal(outcome.evidence.artifacts.length, 1)
    assert.match(outcome.evidence.artifacts[0]!, /t1\.log$/)
    assert.equal(seen, `pnpm typecheck|${outcome.evidence.artifacts[0]}`)
  } finally {
    dirs.cleanup()
  }
})

test('runGate：exec 返回非 0 → ok=false（失败证据要能定位到退出码）', async () => {
  const dirs = makeDirs()
  try {
    const outcome = await runGate(makeTask(), {
      cwd: dirs.cwd,
      artifactsDir: dirs.artifactsDir,
      now,
      exec: async () => ({ code: 2, tail: 'TS2322: 类型不匹配' }),
    })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.evidence.exitCode, 2)
    assert.match(outcome.evidence.tail, /TS2322/)
  } finally {
    dirs.cleanup()
  }
})

test('runGate：超时（exec 返回 code=null）→ ok=false 且 exitCode=null，绝不误判为通过', async () => {
  const dirs = makeDirs()
  try {
    const outcome = await runGate(makeTask(), {
      cwd: dirs.cwd,
      artifactsDir: dirs.artifactsDir,
      now,
      exec: async () => ({ code: null, tail: '超时（50ms）已被 SIGKILL 终止' }),
    })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.evidence.exitCode, null)
    assert.match(outcome.evidence.tail, /超时/)
  } finally {
    dirs.cleanup()
  }
})

test('runGate：exec 抛错 → 兜底成 code=null / ok=false，不把异常抛给调用方', async () => {
  const dirs = makeDirs()
  try {
    const outcome = await runGate(makeTask(), {
      cwd: dirs.cwd,
      artifactsDir: dirs.artifactsDir,
      now,
      exec: async () => {
        throw new Error('spawn 失败：ENOENT')
      },
    })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.evidence.exitCode, null)
  } finally {
    dirs.cleanup()
  }
})

test('runGate：验收命令为空 → exitCode=-1 且给出人工确认文案（不能当成通过）', async () => {
  const dirs = makeDirs()
  try {
    let called = false
    const outcome = await runGate(makeTask({ acceptance: '   ' }), {
      cwd: dirs.cwd,
      artifactsDir: dirs.artifactsDir,
      now,
      exec: async () => {
        called = true
        return { code: 0, tail: '' }
      },
    })
    assert.equal(called, false, '空验收命令不应执行任何 shell')
    assert.equal(outcome.ok, false)
    assert.equal(outcome.evidence.exitCode, -1)
    assert.equal(outcome.evidence.tail, EMPTY_ACCEPTANCE_TAIL)
    assert.deepEqual(outcome.evidence.artifacts, [])
  } finally {
    dirs.cleanup()
  }
})

test('defaultGateExec：真实跑一条命令，全量输出落日志、内存只留尾部', async () => {
  const dirs = makeDirs()
  try {
    const outcome = await runGate(makeTask({ acceptance: 'printf "hello\\ngate\\n"' }), {
      cwd: dirs.cwd,
      artifactsDir: dirs.artifactsDir,
      now,
    })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.evidence.exitCode, 0)
    assert.match(outcome.evidence.tail, /hello/)
    const log = readFileSync(outcome.evidence.artifacts[0]!, 'utf8')
    assert.match(log, /hello/, '全量日志必须落盘（内存里可能已被裁剪）')
    assert.match(log, /# command:/)
  } finally {
    dirs.cleanup()
  }
})

test('defaultGateExec：超时会被 SIGKILL 终止，且等待期间事件循环没被阻塞（D1 回归）', async () => {
  const dirs = makeDirs()
  try {
    let ticked = false
    const timer = setTimeout(() => {
      ticked = true
    }, 20)
    const started = Date.now()
    const result = await defaultGateExec('sleep 5', {
      cwd: dirs.cwd,
      timeoutMs: 150,
      logPath: join(dirs.artifactsDir, 'timeout.log'),
    })
    const elapsed = Date.now() - started
    clearTimeout(timer)

    assert.equal(result.code, null, '超时必须返回 null（不可能是 0）')
    assert.ok(ticked, '同步 spawnSync 会让定时器在门禁跑完前无法触发 —— 这里必须是异步的')
    assert.ok(elapsed < 3000, `超时应在毫秒级被终止，实际 ${elapsed}ms`)
  } finally {
    dirs.cleanup()
  }
})

test('tailOf：超限只保留尾部并标注省略了多少字符', () => {
  const short = 'abc'
  assert.equal(tailOf(short, 10), short)

  const text = 'x'.repeat(50) + 'TAIL'
  const tail = tailOf(text, 10)
  assert.ok(tail.endsWith('TAIL'))
  assert.match(tail, /前 44 字符已省略/)
  assert.ok(tail.length <= 10 + 40)

  const huge = 'y'.repeat(GATE_TAIL_CHARS * 2)
  assert.ok(tailOf(huge, GATE_TAIL_CHARS).length <= GATE_TAIL_CHARS + 60)
})
