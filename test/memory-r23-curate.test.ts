/**
 * r23 整理命令（curate.ts + curate-cli.ts）：旧流水提炼、dry-run 零写入、二次运行幂等、
 * skippedExisting / skippedFull 的边界，以及 CLI 的退出码与 stdout 契约。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { curateMemory, extractLegacyLessons } from '../src/host/memory/curate.ts'
import { parseEntryFile } from '../src/host/memory/entries.ts'
import type { MemoryRoots } from '../src/host/memory/repo.ts'

const NOW = new Date(2026, 10, 10, 17, 20).getTime()

function tempRoots(): { dir: string; roots: MemoryRoots } {
  const dir = mkdtempSync(join(tmpdir(), 'r23-curate-'))
  const roots = { publicDir: join(dir, 'public'), projectDir: join(dir, 'project') }
  mkdirSync(roots.projectDir, { recursive: true })
  mkdirSync(roots.publicDir, { recursive: true })
  return { dir, roots }
}

function snapshotOf(path: string): { bytes: string; mtime: number } | null {
  if (!existsSync(path)) return null
  return { bytes: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs }
}

/* ───────────────────────────── 提取 ───────────────────────────── */

test('r23 curate 提取：project 取 `## 失败与教训` 段内的列表行，遇到下一个 ## 标题停止', () => {
  const text = [
    '# run-1',
    '',
    '- t1 [done] 正常',
    '',
    '## 失败与教训',
    '- 门禁 `pnpm test` 失败（退出码 1）',
    '- 教训二',
    '',
    '## 其他',
    '- 不是教训',
  ].join('\n')
  assert.deepEqual(extractLegacyLessons(text, { track: 'project', file: 'run-1.md' }), [
    '门禁 `pnpm test` 失败（退出码 1）',
    '教训二',
  ])
})

test('r23 curate 提取：无失败段时扫 `- <task> [failed|failed?] <title>` 生成统一文案；public 只认两种前缀', () => {
  assert.deepEqual(extractLegacyLessons('- t1 [failed] 标题\n- t2 [failed?] 标题2\n- t3 [done] 跳过\n', { track: 'project', file: 'run-2.md' }), [
    '任务「标题」失败（t1）',
    '任务「标题2」失败（t2）',
  ])
  assert.deepEqual(extractLegacyLessons('- 失败模式：A\n- 可复用提示：B\n- 其他：C\n', { track: 'public', file: 'lessons-1.md' }), ['A', 'B'])
})

/* ───────────────────────────── dry-run / 幂等 ───────────────────────────── */

test('r23 curate dry-run：零写入（目标文件不存在、legacy 字节与 mtime 不变、目录不新建）', () => {
  const { dir, roots } = tempRoots()
  try {
    const legacyPath = join(roots.projectDir, 'run-a.md')
    writeFileSync(legacyPath, '# run-a\n\n## 失败与教训\n- 教训 A\n- 教训 B\n')
    const beforeLegacy = snapshotOf(legacyPath)
    const report = curateMemory({ track: 'project', roots, dryRun: true, now: NOW })
    assert.equal(report.ok, true)
    assert.equal(report.dryRun, true)
    assert.equal(report.extracted, 2)
    assert.equal(report.added, 2)
    assert.equal(existsSync(join(roots.projectDir, 'pitfalls.md')), false, 'dry-run 不得创建目标文件')
    assert.deepEqual(snapshotOf(legacyPath), beforeLegacy, 'legacy 文件字节与 mtime 都不得变化')

    const missing = curateMemory({ track: 'project', roots: { publicDir: join(dir, 'none-pub'), projectDir: join(dir, 'none-proj') }, dryRun: true })
    assert.equal(missing.ok, false)
    assert.match(missing.warnings[0], /记忆目录不存在/)
    assert.equal(existsSync(join(dir, 'none-proj')), false, '目录不存在时不得代为创建')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('r23 curate 实跑：写入 pitfalls（P1/系统/修正 1），第二次运行 added=0 且字节与 mtime 不变', () => {
  const { dir, roots } = tempRoots()
  try {
    writeFileSync(join(roots.projectDir, 'run-a.md'), '# run-a\n\n## 失败与教训\n- 教训 A\n- 教训 B\n')
    const first = curateMemory({ track: 'project', roots, dryRun: false, now: NOW })
    assert.equal(first.ok, true)
    assert.equal(first.added, 2)
    assert.equal(first.skippedExisting, 0)
    assert.equal(first.extracted, first.added + first.skippedExisting + first.skippedFull)

    const targetPath = join(roots.projectDir, 'pitfalls.md')
    const parsed = parseEntryFile(readFileSync(targetPath, 'utf8'), { track: 'project', file: 'pitfalls.md', now: NOW, fallbackAt: NOW })
    assert.equal(parsed.entries.length, 2)
    for (const entry of parsed.entries) {
      assert.equal(entry.level, 'P1')
      assert.equal(entry.source, '系统')
      assert.equal(entry.revisions, 1)
    }

    const before = snapshotOf(targetPath)
    const second = curateMemory({ track: 'project', roots, dryRun: false, now: NOW + 60_000 })
    assert.equal(second.added, 0)
    assert.equal(second.skippedExisting, 2)
    assert.equal(second.extracted, second.added + second.skippedExisting + second.skippedFull)
    assert.deepEqual(snapshotOf(targetPath), before, '二次运行必须零写入（含 mtime）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('r23 curate：目标已有同 hash（含 tombstone）→ skippedExisting；活动满 40 → skippedFull 且不淘汰', () => {
  const { dir, roots } = tempRoots()
  try {
    writeFileSync(join(roots.projectDir, 'run-b.md'), '# run-b\n\n## 失败与教训\n- 同一条教训\n')
    const first = curateMemory({ track: 'project', roots, dryRun: false, now: NOW })
    assert.equal(first.added, 1)

    const second = curateMemory({ track: 'project', roots, dryRun: false, now: NOW + 1000 })
    assert.equal(second.skippedExisting, 1)
    assert.equal(second.added, 0)

    // 填满 40 条活动条目，再来一条全新的教训 → skippedFull，且不淘汰已有条目
    rmSync(join(roots.projectDir, 'run-b.md'))
    const lines = Array.from({ length: 40 }, (_, index) => `- [P2] 已有${index}（来源：系统 · 11-01 10:00 · 修正 1）`)
    const body = `# 失败与教训\n\n${lines.join('\n')}\n`
    writeFileSync(join(roots.projectDir, 'pitfalls.md'), body)
    writeFileSync(join(roots.projectDir, 'run-c.md'), '# run-c\n\n## 失败与教训\n- 第 41 条\n')
    const before = readFileSync(join(roots.projectDir, 'pitfalls.md'), 'utf8')
    const full = curateMemory({ track: 'project', roots, dryRun: false, now: NOW + 2000 })
    assert.equal(full.skippedFull, 1)
    assert.equal(full.added, 0)
    assert.equal(readFileSync(join(roots.projectDir, 'pitfalls.md'), 'utf8'), before, '满 40 时不得淘汰已有条目')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ───────────────────────────── CLI ───────────────────────────── */

const CLI = new URL('../src/host/memory/curate-cli.ts', import.meta.url).pathname

test('r23 curate CLI：dry-run 只输出一个 JSON、退出码 0、零写入；缺 --dir / 非法 --now 退出码 2', () => {
  const { dir, roots } = tempRoots()
  try {
    writeFileSync(join(roots.projectDir, 'run-cli.md'), '# run\n\n## 失败与教训\n- CLI 教训\n')
    const result = spawnSync(process.execPath, [CLI, '--track', 'project', '--dir', roots.projectDir, '--dry-run', '--now', String(NOW)], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout) as { ok: boolean; dryRun: boolean; added: number }
    assert.equal(report.ok, true)
    assert.equal(report.dryRun, true)
    assert.equal(report.added, 1)
    assert.equal(existsSync(join(roots.projectDir, 'pitfalls.md')), false, 'CLI dry-run 不得写盘')

    const missingDir = spawnSync(process.execPath, [CLI, '--track', 'project'], { encoding: 'utf8' })
    assert.equal(missingDir.status, 2)
    assert.match(missingDir.stderr, /缺少必填参数 --dir/)

    const badNow = spawnSync(process.execPath, [CLI, '--dir', roots.projectDir, '--now', 'abc'], { encoding: 'utf8' })
    assert.equal(badNow.status, 2)
    assert.match(badNow.stderr, /--now 需要非负整数/)

    const badTrack = spawnSync(process.execPath, [CLI, '--track', 'nope', '--dir', roots.projectDir], { encoding: 'utf8' })
    assert.equal(badTrack.status, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('r23 curate CLI：目录不存在 → 退出码 1 且 stdout 仍是一个 JSON 报告', () => {
  const { dir } = tempRoots()
  try {
    const result = spawnSync(process.execPath, [CLI, '--dir', join(dir, 'missing')], { encoding: 'utf8' })
    assert.equal(result.status, 2, '--dir 不存在属于用法错误（parseArgs 即拒绝）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('r23 curate CLI：实际执行可被独立 node 进程调用（execFileSync 复验产物）', () => {
  const { dir, roots } = tempRoots()
  try {
    writeFileSync(join(roots.projectDir, 'run-cli.md'), '# run\n\n## 失败与教训\n- CLI 实际教训\n')
    execFileSync(process.execPath, [CLI, '--track', 'project', '--dir', roots.projectDir, '--now', String(NOW)], { encoding: 'utf8' })
    const body = readFileSync(join(roots.projectDir, 'pitfalls.md'), 'utf8')
    assert.match(body, /CLI 实际教训/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
