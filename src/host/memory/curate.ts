/**
 * 「整理旧流水」：把旧 `run-*.md` / `lessons-*.md` 里的失败证据**只追加**地提炼进
 * 同轨 `pitfalls.md`（r23）。
 *
 * 纪律（DESIGN §12.6）：
 *  - 只补不改：不改源文件、不提升已有条目 revision、不删除、不 supersede、不淘汰；
 *  - 幂等：第二次运行 `added=0`，目标文件连字节都不变；
 *  - dry-run 零写入（连目录都不创建）；
 *  - 目标满 40 只报 `skippedFull`，不触发淘汰；
 *  - 旧流水只有这里读，注入链路永远不读。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type { MemoryCurateReport, MemoryTrack } from '../../shared/types.ts'
import { ENTRIES_PER_FILE, MEMORY_ENTRY_TEXT_MAX } from '../config.ts'
import { entryHash, normalizeEntryText, parseEntryFile, type ParsedEntry } from './entries.ts'
import { memoryDirOf, writeMemoryFile, type MemoryRoots } from './repo.ts'

/** host 侧别名：共享真值只在 `src/shared/types.ts` 维护一份。 */
export type CurateReport = MemoryCurateReport

export interface CurateInput {
  track: MemoryTrack
  roots: MemoryRoots
  dryRun: boolean
  now?: number
}

const PROJECT_LEGACY_RE = /^run-.*\.md$/
const PUBLIC_LEGACY_RE = /^lessons-.*\.md$/
const TARGET_NAME = 'pitfalls.md'

function fold(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 1) return text.slice(0, Math.max(0, max))
  return `${text.slice(0, max - 1)}…`
}

/**
 * 从一个旧流水文件里提取失败证据（纯函数，只读不改）。
 *
 * 项目 `run-*.md`：优先 `## 失败与教训` 段里的 `- ` 行；没有该段/没有 bullet 时
 * 退化扫描 `- <task> [failed|failed?] <title>` 行。公共 `lessons-*.md`：取
 * `- 失败模式：` / `- 可复用提示：` 行并去前缀。
 */
export function extractLegacyLessons(text: string, opts: { track: MemoryTrack; file: string }): string[] {
  const source = text ?? ''
  const lines = source.split('\n')
  const out: string[] = []

  if (opts.track === 'project') {
    let start = -1
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].trim() === '## 失败与教训') {
        start = index + 1
        break
      }
    }
    if (start >= 0) {
      for (let index = start; index < lines.length; index += 1) {
        const line = lines[index]
        if (line.trim().startsWith('## ')) break
        const match = /^-\s+(.*)$/.exec(line)
        if (match !== null) out.push(match[1])
      }
    }
    if (out.length === 0) {
      for (const line of lines) {
        const match = /^-\s+(\S+)\s+\[(failed|failed\?)\]\s+(.+)$/.exec(line)
        if (match !== null) out.push(`任务「${match[3]}」失败（${match[1]}）`)
      }
    }
  } else {
    for (const line of lines) {
      const match = /^-\s+(?:失败模式|可复用提示)：(.*)$/.exec(line)
      if (match !== null) out.push(match[1])
    }
  }

  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of out) {
    const candidate = clip(fold(raw), MEMORY_ENTRY_TEXT_MAX)
    if (candidate === '') continue
    const key = normalizeEntryText(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push(candidate)
  }
  return cleaned
}

function emptyReport(track: MemoryTrack, dryRun: boolean, at: number, warning: string): CurateReport {
  return {
    ok: false,
    track,
    dryRun,
    at,
    scannedFiles: 0,
    legacyFiles: [],
    extracted: 0,
    added: 0,
    skippedExisting: 0,
    skippedFull: 0,
    skippedInvalid: 0,
    target: { name: TARGET_NAME, before: 0, after: 0 },
    warnings: [warning],
  }
}

/**
 * 执行整理：读旧流水 → 去重 → 只跳过已存在/已满 → 一次写 `pitfalls.md`。
 *
 * 目录不存在时 `ok:false` 且不创建目录；除此之外 `ok` 恒为 true（单文件读不了只是 warning）。
 */
export function curateMemory(input: CurateInput): CurateReport {
  const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now()
  const track = input.track
  const dir = memoryDirOf(track, input.roots)
  if (!existsSync(dir)) return emptyReport(track, input.dryRun, now, `记忆目录不存在：${dir}`)
  let isDir = false
  try {
    isDir = statSync(dir).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) return emptyReport(track, input.dryRun, now, `不是目录：${dir}`)

  const legacyRe = track === 'project' ? PROJECT_LEGACY_RE : PUBLIC_LEGACY_RE
  let names: string[]
  try {
    names = readdirSync(dir)
      .filter((name) => name !== TARGET_NAME && legacyRe.test(name))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return emptyReport(track, input.dryRun, now, `记忆目录不可读：${dir}`)
  }

  const targetPath = `${dir}/${TARGET_NAME}`
  const targetBody = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : ''
  const targetParsed = parseEntryFile(targetBody, {
    track,
    file: TARGET_NAME,
    now,
    fallbackAt: now,
    acceptLegacy: true,
  })
  const knownHashes = new Set(targetParsed.entries.map((entry) => entry.hash))
  const activeEntries = targetParsed.entries.filter((entry) => !entry.superseded)

  const warnings: string[] = []
  const legacyFiles: string[] = []
  const candidates: Array<{ text: string; at: number; hash: string }> = []
  const seen = new Set<string>()
  let skippedInvalid = 0

  for (const name of names) {
    const path = `${dir}/${name}`
    let body: string
    let mtime = now
    try {
      const stat = statSync(path)
      if (!stat.isFile()) {
        warnings.push(`跳过不可读条目：${name}（不是文件）`)
        skippedInvalid += 1
        continue
      }
      body = readFileSync(path, 'utf8')
      mtime = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : now
    } catch {
      warnings.push(`跳过不可读文件：${name}`)
      skippedInvalid += 1
      continue
    }
    const lessons = extractLegacyLessons(body, { track, file: name })
    if (lessons.length === 0) {
      warnings.push(`没有可提炼的失败证据：${name}`)
      skippedInvalid += 1
      continue
    }
    legacyFiles.push(name)
    for (const lesson of lessons) {
      const key = normalizeEntryText(lesson)
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({ text: lesson, at: mtime, hash: entryHash(lesson) })
    }
  }

  const pending: Array<{ text: string; at: number; hash: string }> = []
  let skippedExisting = 0
  let skippedFull = 0
  for (const candidate of candidates) {
    if (knownHashes.has(candidate.hash)) {
      skippedExisting += 1
      continue
    }
    if (activeEntries.length + pending.length >= ENTRIES_PER_FILE) {
      skippedFull += 1
      continue
    }
    pending.push(candidate)
  }

  const before = activeEntries.length
  const report: CurateReport = {
    ok: true,
    track,
    dryRun: input.dryRun,
    at: now,
    scannedFiles: names.length,
    legacyFiles,
    extracted: candidates.length,
    added: pending.length,
    skippedExisting,
    skippedFull,
    skippedInvalid,
    target: { name: TARGET_NAME, before, after: before + pending.length },
    warnings,
  }

  if (input.dryRun || pending.length === 0) return report

  const created: ParsedEntry[] = pending.map((candidate, index) => ({
    track,
    file: TARGET_NAME,
    topic: 'pitfalls',
    level: 'P1',
    text: candidate.text,
    source: '系统',
    at: candidate.at,
    revisions: 1,
    lineIndex: activeEntries.length + index,
    hash: candidate.hash,
    canonical: true,
    superseded: false,
  }))
  const written = writeMemoryFile(track, TARGET_NAME, [...targetParsed.entries, ...created], input.roots)
  if (!written.ok) {
    return { ...report, ok: false, added: 0, target: { name: TARGET_NAME, before, after: before }, warnings: [...warnings, written.error] }
  }
  return report
}
