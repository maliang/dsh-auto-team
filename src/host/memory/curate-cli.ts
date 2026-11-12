#!/usr/bin/env node
/**
 * 整理命令 CLI（r23）：把旧 `run-*.md` / `lessons-*.md` 的失败证据提炼进 `pitfalls.md`。
 *
 * 用法：
 *   node src/host/memory/curate-cli.ts --track project|public --dir <memoryDir> [--dry-run] [--now <epochMs>]
 *
 * 输出契约：stdout **恰好一个 JSON 对象**（`JSON.stringify(report, null, 2) + "\n"`），
 * stderr 只放人类可读的一行摘要；退出码 0（成功，含 0 条新增）/ 2（用法错误）/ 1（运行错误）。
 */
import { statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { MemoryTrack } from '../../shared/types.ts'
import { curateMemory } from './curate.ts'

interface CliOptions {
  track: MemoryTrack
  dir: string
  dryRun: boolean
  now?: number
}

function parseArgs(argv: readonly string[]): { ok: true; options: CliOptions } | { ok: false; error: string } {
  let track: MemoryTrack = 'project'
  let dir: string | null = null
  let dryRun = false
  let now: number | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--track' || arg === '--dir' || arg === '--now') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) return { ok: false, error: `${arg} 需要一个值` }
      index += 1
      if (arg === '--track') {
        if (value !== 'project' && value !== 'public') return { ok: false, error: `--track 只能是 project 或 public（收到「${value}」）` }
        track = value
      } else if (arg === '--dir') {
        dir = value
      } else {
        const parsed = Number(value)
        if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
          return { ok: false, error: `--now 需要非负整数毫秒时间戳（收到「${value}」）` }
        }
        now = parsed
      }
      continue
    }
    return { ok: false, error: `未知参数：${arg}` }
  }
  if (dir === null || dir.trim() === '') return { ok: false, error: '缺少必填参数 --dir <记忆目录>' }
  let isDir = false
  try {
    isDir = statSync(dir).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) return { ok: false, error: `--dir 不是可读目录：${dir}` }
  return { ok: true, options: { track, dir, dryRun, now } }
}

function main(argv: readonly string[]): number {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    process.stderr.write(`整理失败：${parsed.error}\n`)
    return 2
  }
  const { track, dir, dryRun, now } = parsed.options
  const report = curateMemory({ track, roots: { publicDir: dir, projectDir: dir }, dryRun, now })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  const summary = report.ok
    ? `整理完成（${track}，${dryRun ? 'dry-run' : '已写入'}）：扫描 ${report.scannedFiles} 个旧文件，新增 ${report.added} 条，已存在 ${report.skippedExisting} 条，已满 ${report.skippedFull} 条`
    : `整理失败：${report.warnings[0] ?? '未知错误'}`
  process.stderr.write(`${summary}\n`)
  return report.ok ? 0 : 1
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = main(process.argv.slice(2))
}
