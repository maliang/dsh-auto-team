/**
 * 记忆双轨仓库：公共（`<home>/.dsh/auto-team/memory/public`）与项目（`<workspace>/.auto-team/memory`）。
 *
 * 安全要点（AC-24 的可验证面）：文件名只允许**单段**，拒绝绝对路径、`..`、分隔符与空名。
 * 记忆文件是用户可编辑的 md，但「写到哪个路径」不能由用户输入的名字拼出来后直接落盘——
 * 否则一次 `../../` 就能把内容写到仓库外。守门函数 safeMemoryName 是纯函数，已被单测覆盖；
 * **读 / 写 / 删三条路径都必须先过它**（只守写等于没守：读可以读到仓库外，删可以删到仓库外）。
 *
 * 写入限额（AC-25）：单任务新增记忆 ≤ MEMORY_LINES_PER_TASK 行，且每行带来源标注
 * （角色/任务/时间）——来源标注由纯函数 formatSourcedLine 生成，可被 `node --test` 逐字断言。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { MemoryFileInfo, MemoryTrack } from '../../shared/types.ts'
import { MEMORY_LINES_PER_TASK } from '../config.ts'

/** 双轨根：由调用方注入（便于单测与跨平台，模块内不读环境）。 */
export interface MemoryRoots {
  publicDir: string
  projectDir: string
}

/** 一条记忆的来源标注（AC-25：角色/任务/时间）。 */
export interface MemorySource {
  roleId: string
  taskId: string
  at: number
}

const MAX_NAME_LENGTH = 64
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
/** 队长直写（未经成员任务）时的来源标签。 */
const CAPTAIN_LABEL = '队长'

/** 纯函数：把用户给的记忆文件名收敛成安全单段名；非法返回 null。 */
export function safeMemoryName(raw: string): string | null {
  const name = (raw ?? '').trim()
  if (name === '' || name.length > MAX_NAME_LENGTH) return null
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return null
  if (name === '.' || name === '..') return null
  if (name.startsWith('.')) return null
  if (!NAME_PATTERN.test(name)) return null
  return name.endsWith('.md') ? name : `${name}.md`
}

/** 记忆档 → 目录（由调用方注入两个根，便于单测与跨平台）。 */
export function memoryDirOf(track: MemoryTrack, roots: MemoryRoots): string {
  return track === 'public' ? roots.publicDir : roots.projectDir
}

/** 列出某档下的 md 文件（不存在返回空数组，不抛错——面板首屏不能因目录缺失而红）。 */
export function listMemory(track: MemoryTrack, roots: MemoryRoots): MemoryFileInfo[] {
  const dir = memoryDirOf(track, roots)
  if (!existsSync(dir)) return []
  const out: MemoryFileInfo[] = []
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.md')) continue
    const path = `${dir}/${entry}`
    const stat = statSync(path)
    if (!stat.isFile()) continue
    out.push({
      track,
      name: entry,
      chars: readFileSync(path, 'utf8').length,
      updatedAt: stat.mtimeMs,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** 读一条记忆正文；不存在或非法名返回空串（面板显示「暂无内容」而非报错）。 */
export function readMemory(track: MemoryTrack, name: string, roots: MemoryRoots): string {
  const safe = safeMemoryName(name)
  if (safe === null) return ''
  const path = `${memoryDirOf(track, roots)}/${safe}`
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/** 写一条记忆（自动建目录）。名字非法时返回错误而不是静默丢弃。 */
export function writeMemory(
  track: MemoryTrack,
  name: string,
  body: string,
  roots: MemoryRoots,
): { ok: true; name: string } | { ok: false; error: string } {
  const safe = safeMemoryName(name)
  if (safe === null) {
    return { ok: false, error: `记忆文件名不合法：只允许字母数字与 ._-，且不能含路径分隔符（收到「${name}」）` }
  }
  const dir = memoryDirOf(track, roots)
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/${safe}`, body, 'utf8')
  return { ok: true, name: safe }
}

/** 删一条记忆（同样先过 safeMemoryName，否则 `../x.md` 能删到仓库外）。 */
export function deleteMemory(
  track: MemoryTrack,
  name: string,
  roots: MemoryRoots,
): { ok: true } | { ok: false; error: string } {
  const safe = safeMemoryName(name)
  if (safe === null) return { ok: false, error: `记忆文件名不合法：「${name}」` }
  const path = `${memoryDirOf(track, roots)}/${safe}`
  if (!existsSync(path)) return { ok: false, error: `记忆不存在：${safe}` }
  rmSync(path)
  return { ok: true }
}

/**
 * 纯函数：给一条记忆加上来源标注（AC-25）。输出形如
 *   `- [pm/t2 · 10-30 14:02] 结论正文`
 * 未传 source（队长直写）时用 `- [队长 · 10-30 14:02] 正文`。
 * 第三参 now 只用于测试注入确定性时间，生产走 source.at 或当前时间。
 */
export function formatSourcedLine(text: string, source?: MemorySource | null, now?: number): string {
  const at =
    typeof source?.at === 'number' && Number.isFinite(source.at) ? source.at : (now ?? Date.now())
  const roleId = (source?.roleId ?? '').trim()
  const taskId = (source?.taskId ?? '').trim()
  const origin = roleId === '' ? CAPTAIN_LABEL : taskId === '' ? roleId : `${roleId}/${taskId}`
  const cleaned = (text ?? '').trim().replace(/^[-*]\s+/, '')
  return `- [${origin} · ${formatStamp(at)}] ${cleaned}`
}

/** `MM-DD HH:mm`（本地时区，够阅读且可 grep；不做跨时区承诺）。 */
function formatStamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 成员追加记忆（PRD/AC-25：单任务写入 ≤20 行且每条带来源）。
 *
 * - 行数上限双保险：`limit` 由调用方传入，但**硬上限**是 MEMORY_LINES_PER_TASK（传 100 也只写 20）；
 * - 超过上限时只保留前 N 行并返回 truncated，由调度器在成员消息里回告——不静默截断；
 * - 空行被丢弃（否则会写出只有前缀的空行，用户以为记下来了）。
 */
export function appendMemoryLines(
  track: MemoryTrack,
  name: string,
  lines: string[],
  limit: number,
  roots: MemoryRoots,
  source?: MemorySource,
): { ok: true; written: number; truncated: boolean } | { ok: false; error: string } {
  const safe = safeMemoryName(name)
  if (safe === null) return { ok: false, error: `记忆文件名不合法：「${name}」` }
  const requested = Number.isFinite(limit) ? Math.floor(limit) : MEMORY_LINES_PER_TASK
  const cap = Math.max(0, Math.min(requested, MEMORY_LINES_PER_TASK))
  const cleaned = (lines ?? []).map((line) => (line ?? '').trim()).filter((line) => line !== '')
  const kept = cleaned.slice(0, cap)
  const truncated = cleaned.length > kept.length
  if (kept.length === 0) return { ok: true, written: 0, truncated }
  const dir = memoryDirOf(track, roots)
  mkdirSync(dir, { recursive: true })
  const path = `${dir}/${safe}`
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const block = kept.map((line) => formatSourcedLine(line, source)).join('\n')
  const next = existing === '' ? `${block}\n` : `${existing.replace(/\n+$/, '')}\n${block}\n`
  writeFileSync(path, next, 'utf8')
  return { ok: true, written: kept.length, truncated }
}
