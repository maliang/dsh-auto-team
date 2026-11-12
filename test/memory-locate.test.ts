/**
 * r22：记忆落点纯函数 + 历史回填单测。
 *
 * 真实缺陷回归：旧实现把 `apply` 时刻的装配 workspace 当项目根，所有 run 的记忆都写进
 * profile 目录；这里锁住「按本次 workspace 解析 / 缺 workspace 明确退化 / 回填只补缺失」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { memoryLocationOf, usableWorkspaceOf } from '../src/host/memory/locate.ts'
import {
  backfillRunMemories,
  isProfileWorkspace,
  legacyMemoryDirsOf,
  readWorkspaceBindings,
  summarizeBackfill,
} from '../src/host/memory/backfill.ts'

const PUBLIC_DIR = '/home/u/.dsh/auto-team/memory/public'
const ASSEMBLY_DIR = '/home/u/.dsh/profiles/desktop/.auto-team/memory'

test('r22 locate：只有绝对路径才算可用 workspace（历史 basename 不能相对 cwd 落盘）', () => {
  assert.equal(usableWorkspaceOf(undefined), undefined)
  assert.equal(usableWorkspaceOf(null), undefined)
  assert.equal(usableWorkspaceOf(''), undefined)
  assert.equal(usableWorkspaceOf('   '), undefined)
  assert.equal(usableWorkspaceOf('dsh-auto-team'), undefined, 'r13 遗留的 basename 不是可用 workspace')
  assert.equal(usableWorkspaceOf('/work/a/'), '/work/a', '末尾斜杠归一化，同一工作区只应有一个根')
  assert.equal(usableWorkspaceOf('/work/a'), '/work/a')
})

test('r22 locate：有 workspace → <workspace>/.auto-team/memory；无 workspace → 装配目录 + 可读原因', () => {
  const located = memoryLocationOf({
    publicDir: PUBLIC_DIR,
    fallbackProjectDir: ASSEMBLY_DIR,
    workspace: '/work/a',
  })
  assert.equal(located.degraded, false)
  assert.equal(located.projectDir, '/work/a/.auto-team/memory')
  assert.equal(located.roots.projectDir, '/work/a/.auto-team/memory')
  assert.equal(located.roots.publicDir, PUBLIC_DIR, '公共轨与工作区无关，不能跟着漂')
  assert.equal(located.workspace, '/work/a')
  assert.equal(located.degradeReason, undefined)

  const degraded = memoryLocationOf({
    publicDir: PUBLIC_DIR,
    fallbackProjectDir: ASSEMBLY_DIR,
    origin: '会话 sess-1',
  })
  assert.equal(degraded.degraded, true)
  assert.equal(degraded.projectDir, ASSEMBLY_DIR)
  assert.equal(degraded.workspace, undefined)
  assert.match(degraded.degradeReason ?? '', /未能解析会话 sess-1的项目工作区/)
  assert.match(degraded.degradeReason ?? '', /退化到装配目录/)
})

test('r22 backfill：工作区注册表按 sessionId 反查；损坏文件返回空映射而不是抛错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r22-registry-'))
  const registry = join(dir, 'workspace.json')
  writeFileSync(
    registry,
    JSON.stringify({
      tables: { workspaces: { a: { path: '/work/a', sessionIds: ['s1', 's2'] }, b: { path: '/work/b', sessionIds: ['s3'] } } },
    }),
    'utf8',
  )
  assert.deepEqual(readWorkspaceBindings(registry), [
    { path: '/work/a', sessionIds: ['s1', 's2'] },
    { path: '/work/b', sessionIds: ['s3'] },
  ])
  const broken = join(dir, 'broken.json')
  writeFileSync(broken, '{not json', 'utf8')
  assert.deepEqual(readWorkspaceBindings(broken), [])
  assert.deepEqual(readWorkspaceBindings(undefined), [])
})

test('r22 backfill：dry-run 只出计划与计数，不写任何文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-r22-dry-'))
  const runsDir = join(root, 'runs')
  mkdirSync(runsDir, { recursive: true })
  const registry = join(root, 'workspace.json')
  writeFileSync(
    registry,
    JSON.stringify({ tables: { workspaces: { a: { path: join(root, 'ws-a'), sessionIds: ['sess-a'] } } } }),
    'utf8',
  )
  writeFileSync(
    join(runsDir, 'run-a.json'),
    JSON.stringify({
      plan: {
        runId: 'run-a',
        goal: '项目 A',
        status: 'terminated',
        sessionId: 'sess-a',
        tasks: [{ id: 't1', title: '任务一', status: 'done' }],
      },
      project: '/home/u/.dsh/profiles/desktop',
      plannedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_100_000,
    }),
    'utf8',
  )
  writeFileSync(
    join(runsDir, 'run-b.json'),
    JSON.stringify({
      plan: { runId: 'run-b', goal: '项目 B', status: 'cancelled', sessionId: 'sess-b', tasks: [] },
      project: join(root, 'ws-b'),
      plannedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_100_000,
    }),
    'utf8',
  )
  // 非终态：scanned 计入，但既不算 terminal 也不补写。
  writeFileSync(
    join(runsDir, 'run-c.json'),
    JSON.stringify({ plan: { runId: 'run-c', status: 'running', sessionId: 'sess-a', tasks: [] }, project: join(root, 'ws-a') }),
    'utf8',
  )

  const report = backfillRunMemories({ runsDir, registryFile: registry, dryRun: true })
  assert.equal(report.scanned, 3)
  assert.equal(report.terminal, 2)
  assert.equal(report.planned, 2)
  assert.equal(report.written, 0)
  assert.equal(report.copied, 0)
  assert.equal(report.skippedExisting, 0)
  assert.equal(report.skippedNoProject, 0)
  assert.equal(existsSync(join(root, 'ws-a', '.auto-team/memory/run-run-a.md')), false)
  assert.equal(existsSync(join(root, 'ws-b', '.auto-team/memory/run-run-b.md')), false)
  assert.match(summarizeBackfill(report, true), /mode=dry-run .*planned=2 .*written=0/)
})

test('r22 backfill：按真实 project 补写、目录按需创建、重复执行只补缺失且绝不覆盖手改', () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-r22-apply-'))
  const runsDir = join(root, 'runs')
  mkdirSync(runsDir, { recursive: true })
  const wsA = join(root, 'ws-a')
  const wsB = join(root, 'ws-b')
  const registry = join(root, 'workspace.json')
  writeFileSync(
    registry,
    JSON.stringify({ tables: { workspaces: { a: { path: wsA, sessionIds: ['sess-a'] } } } }),
    'utf8',
  )
  writeFileSync(
    join(runsDir, 'run-a.json'),
    JSON.stringify({
      plan: {
        runId: 'run-a',
        goal: '项目 A',
        status: 'terminated',
        sessionId: 'sess-a',
        tasks: [{ id: 't1', title: '任务一', status: 'done' }],
      },
      // 注册表命中优先于 run 里过期的装配路径。
      project: '/home/u/.dsh/profiles/desktop',
      plannedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_100_000,
    }),
    'utf8',
  )
  writeFileSync(
    join(runsDir, 'run-b.json'),
    JSON.stringify({
      plan: { runId: 'run-b', goal: '项目 B', status: 'cancelled', sessionId: 'sess-b', tasks: [] },
      project: wsB,
      plannedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_100_000,
    }),
    'utf8',
  )

  const first = backfillRunMemories({ runsDir, registryFile: registry })
  assert.equal(first.written, 2)
  assert.equal(first.copied, 0)
  const memoryA = join(wsA, '.auto-team', 'memory', 'run-run-a.md')
  const memoryB = join(wsB, '.auto-team', 'memory', 'run-run-b.md')
  assert.ok(existsSync(memoryA), '目标工作区的 .auto-team/memory 必须按需创建')
  assert.ok(existsSync(memoryB))
  assert.ok(readFileSync(memoryA, 'utf8').includes(`- 项目：${wsA}`), '生成正文必须写解析后的真实项目路径')
  assert.equal(readFileSync(memoryA, 'utf8').split('\n')[0], '# 项目 A · run-a')

  // 再跑：目标都在 → 只补缺失，不重复写。
  const second = backfillRunMemories({ runsDir, registryFile: registry })
  assert.equal(second.planned, 0)
  assert.equal(second.skippedExisting, 2)

  // 手改后第三次跑：内容必须原样保留。
  writeFileSync(memoryB, '# 用户手改\n- keep\n', 'utf8')
  const third = backfillRunMemories({ runsDir, registryFile: registry })
  assert.equal(third.skippedExisting, 2)
  assert.equal(readFileSync(memoryB, 'utf8'), '# 用户手改\n- keep\n')
})

test('r22 backfill：旧装配路径没有注册表映射时 skip 并说明原因，不猜项目', () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-r22-skip-'))
  const runsDir = join(root, 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(
    join(runsDir, 'run-x.json'),
    JSON.stringify({
      plan: { runId: 'run-x', status: 'terminated', sessionId: 'sess-x', tasks: [] },
      project: '/home/u/.dsh/profiles/desktop',
      finishedAt: 1,
    }),
    'utf8',
  )
  const report = backfillRunMemories({
    runsDir,
    registryFile: join(root, 'missing-registry.json'),
    dryRun: true,
  })
  assert.equal(report.planned, 0)
  assert.equal(report.skippedNoProject, 1)
  assert.match(report.entries[0]?.reason ?? '', /装配 workspace/)
  assert.equal(isProfileWorkspace('/home/u/.dsh/profiles/desktop'), true)
  assert.equal(isProfileWorkspace('/work/a'), false)
})

test('r22 backfill：旧落点已有同名记忆时复制原文（保留用户手改），不重新生成', () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-r22-legacy-'))
  const runsDir = join(root, 'runs')
  const legacy = join(root, '.dsh/profiles/desktop/.auto-team/memory')
  mkdirSync(runsDir, { recursive: true })
  mkdirSync(legacy, { recursive: true })
  const wsA = join(root, 'ws-a')
  writeFileSync(
    join(runsDir, 'run-a.json'),
    JSON.stringify({
      plan: { runId: 'run-a', goal: '项目 A', status: 'terminated', sessionId: 'sess-a', tasks: [] },
      project: wsA,
      finishedAt: 1,
    }),
    'utf8',
  )
  writeFileSync(join(legacy, 'run-run-a.md'), '# 旧落点里手改过的内容\n- keep\n', 'utf8')

  const report = backfillRunMemories({ runsDir, legacyMemoryDirs: [legacy] })
  assert.equal(report.copied, 1)
  assert.equal(report.written, 0)
  assert.equal(report.entries[0]?.action, 'copy')
  assert.equal(readFileSync(join(wsA, '.auto-team', 'memory', 'run-run-a.md'), 'utf8'), '# 旧落点里手改过的内容\n- keep\n')
  assert.deepEqual(legacyMemoryDirsOf(join(root, 'nobody')), [])
  assert.deepEqual(legacyMemoryDirsOf(root), [legacy])
})
