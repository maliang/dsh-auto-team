/**
 * 记忆展开（Inline & Spill 的 Spill 半边，AC-9 / AC-10）。
 *
 * 注入侧（`memory/inject.ts`）只放「指针」——`mem://<track>/<stem>` + 标题 + 首句 + 关联 ID；
 * 正文按需从这里取回。所以本模块的两条硬要求：
 *  1. **取回的正文与源文件逐字节相同**（AC-9 用 sha256 比对）：不做 trim、不补换行、不改编码；
 *  2. **失败一律降级成错误码，绝不抛异常**（AC-10）：展开是模型可见工具的入口，抛异常会变成
 *     「工具调用崩了」，而成员任务仍在跑，整个派发链路跟着红。
 *
 * 安全边界只有一个入口：`parseMemoryId`。ID 的**拼装**只允许 `inject.ts` 的 `memoryIdOf` 一处、
 * **解析**只允许这里的 `parseMemoryId` 一处 —— 注入期与展开期各拼一份路径是本项目的历史 bug 族
 * （两份实现一漂移，注入里给得出来的 ID 展开就找不到）。解析通过后还要过 `repo.safeMemoryName`
 * 第二道门（同一个风险只留一道实现，不在这里另写一套路径守门）。
 *
 * 本模块零宿主依赖（不 import `ctx.*`、不读环境变量），`roots` 由调用方注入，故可用临时目录单测。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { ExpandCode, ExpandPayload, MemoryTrack } from '../../shared/types.ts'
import { MEMORY_EXPAND_MAX_CHARS, MEMORY_EXPAND_MAX_DEPTH, MEMORY_RELATED_MAX } from '../config.ts'
import { memoryDirOf, safeMemoryName } from './repo.ts'
import type { MemoryRoots } from './repo.ts'
import { entryIdOf, fileStemOf, parseEntryFile, renderEntry } from './entries.ts'

/** ID 前缀：`mem://<track>/<stem>`（TECHNICAL §6.1，不引入 hash，源文件改动不会失联）。 */
const ID_SCHEME = 'mem://'

/**
 * 记忆名（stem）形态：`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`（**大小写保留**）。
 *
 * 两处与设计稿的**有意偏差**，都由「注入期与展开期必须同源」这条纪律推出来：
 *  1. TECHNICAL §6.1 写的是 `^[p-z0-9]`，但该写法会把设计稿自己举的例子
 *     `mem://project/conventions`（首字母 c）与 `mem://project/testing`（首字母 t）判成非法，
 *     等于展开能力对最常见的名字全失效 —— 按设计意图实现为 `[A-Za-z0-9]`。
 *  2. 设计稿写「小写化后」匹配，但 `inject.ts:189 memoryIdOf` **保留文件名原始大小写**
 *     （其注释说明了理由：`safeMemoryName(stem)` 要能逐字还原磁盘文件名）。若这里小写化，
 *     `mem://project/Conventions` 在区分大小写的文件系统上就变成「注入期给出、展开期找不到」——
 *     正是本项目的历史 bug 族。故此处保留大小写，只做形态校验。
 */
const STEM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** 每个错误码一句可读中文（AC-10「错误码都有可读文案」；面板与工具结果直接显示）。 */
export const EXPAND_MESSAGES: Record<ExpandCode, string> = {
  OK: '已按 ID 展开团队记忆',
  EXPAND_BAD_ID: '记忆 ID 形态不对：应为 mem://public/<名字> 或 mem://project/<名字>（可用 auto_team_memory 的 list 动作查看可用 ID）',
  EXPAND_PATH_ESCAPE: '拒绝展开：ID 里含路径逃逸字符（../、绝对路径、~、冒号或路径分隔符）',
  EXPAND_NOT_FOUND: '记忆不存在或已改名：先用 auto_team_memory（action=list）确认可用 ID',
  EXPAND_DEPTH_EXCEEDED: `展开超过 ${MEMORY_EXPAND_MAX_DEPTH} 跳：请直接展开目标 ID，不要顺着关联链继续`,
}

/** 展开结果的扩展字段（`hash` 供 AC-9 的逐字节比对；`ExpandPayload` 本体保持共享契约不变）。 */
export interface ExpandedMemory extends ExpandPayload {
  /** 返回正文（截断后的那一段）的 sha256；与源文件逐字节一致时等于文件内容的 sha256。 */
  hash: string
}

export interface ExpanderDeps {
  /** 双轨根，由调用方注入（单测用临时目录）。 */
  roots: MemoryRoots
  /** 关联 ID 提供者：生产由 `inject.ts` 的 `memoryIndexOf` 同源逻辑给出，缺省则 related 为空。 */
  relatedOf?: (track: MemoryTrack, name: string) => string[]
  /** 摘要函数，缺省 sha256；注入只为让单测能断言「用的是注入的那个」。 */
  hash?: (text: string) => string
}

export interface Expander {
  /** `depth` 缺省 1；`> MEMORY_EXPAND_MAX_DEPTH` 返回 `EXPAND_DEPTH_EXCEEDED`（不读盘、不递归）。 */
  expand(id: string, depth?: number): ExpandedMemory
}

/** 解析结果：成功给出归一化后的 `track` + 文件名（已带 `.md`）；失败给出错误码。 */
export type ParsedMemoryId =
  | { ok: true; track: MemoryTrack; name: string; file: string; hash?: string }
  | { ok: false; code: ExpandCode }

/**
 * 纯函数：把 `mem://<track>/<stem>` 解析成「轨道 + 安全文件名」。
 *
 * 优先级刻意是「逃逸 > 形态」：`../etc/passwd` 既是逃逸也是形态错，报 `EXPAND_PATH_ESCAPE`
 * 才能让调用方与日志一眼看出这是攻击面而不是手滑。
 */
export function parseMemoryId(raw: string): ParsedMemoryId {
  const text = (raw ?? '').trim()
  if (text === '') return { ok: false, code: 'EXPAND_BAD_ID' }
  // 前缀里的 `:` 是 scheme 自身的一部分，不能拿整串判逃逸（否则每个合法 ID 都被拒）。
  if (!text.startsWith(ID_SCHEME)) {
    return { ok: false, code: looksLikePath(text) ? 'EXPAND_PATH_ESCAPE' : 'EXPAND_BAD_ID' }
  }
  const rest = text.slice(ID_SCHEME.length)
  if (looksLikePath(rest)) return { ok: false, code: 'EXPAND_PATH_ESCAPE' }
  const slash = rest.indexOf('/')
  if (slash <= 0) return { ok: false, code: 'EXPAND_BAD_ID' }
  const track = rest.slice(0, slash)
  if (track !== 'public' && track !== 'project') return { ok: false, code: 'EXPAND_BAD_ID' }
  const rawStem = rest.slice(slash + 1)
  if (rawStem === '') return { ok: false, code: 'EXPAND_BAD_ID' }
  // 条目 ID：`mem://<track>/<stem>#<hash12>`；多个 `#`、空 stem、非 12 位十六进制都算形态错。
  const hashAt = rawStem.indexOf('#')
  const stem = hashAt < 0 ? rawStem : rawStem.slice(0, hashAt)
  const hash = hashAt < 0 ? undefined : rawStem.slice(hashAt + 1)
  if (stem === '') return { ok: false, code: 'EXPAND_BAD_ID' }
  if (hash !== undefined && (!/^[0-9a-f]{12}$/.test(hash) || hash.includes('#'))) {
    return { ok: false, code: 'EXPAND_BAD_ID' }
  }
  // stem 只允许单段：再出现分隔符就是多段路径（`mem://project/a/b`），按逃逸处理。
  if (looksLikePath(stem) || stem.includes('/') || stem.includes(':')) {
    return { ok: false, code: 'EXPAND_PATH_ESCAPE' }
  }
  // 大小写原样保留（与注入期 ID 同源），否则区分大小写的文件系统上会找不到文件。
  if (!STEM_PATTERN.test(stem)) return { ok: false, code: 'EXPAND_BAD_ID' }
  // 第二道门：复用仓库层既有的 safeMemoryName（不在这里另写一套路径守门）。
  const file = safeMemoryName(stem)
  if (file === null) return { ok: false, code: 'EXPAND_BAD_ID' }
  const displayName = hash === undefined ? file : `${fileStemOf(file)}#${hash}`
  return hash === undefined ? { ok: true, track, name: displayName, file } : { ok: true, track, name: displayName, file, hash }
}

/** sha256 十六进制（AC-9 的逐字节比对基准；单独导出便于测试与集成层共用一份实现）。 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 构造一个展开器（读盘但不碰宿主：只吃 `roots`）。
 *
 * 所有失败路径都返回 `ExpandedMemory`，包括 `relatedOf` 抛错、文件读不了、同名目录等
 * 「源文件损坏」形态（AC-10：进程不崩、快照与注入不受影响）。
 */
export function createExpander(deps: ExpanderDeps): Expander {
  const hashOf = deps.hash ?? sha256Hex
  return {
    expand(raw: string, depth?: number): ExpandedMemory {
      const hop = normalizeDepth(depth)
      try {
        const parsed = parseMemoryId(raw)
        if (!parsed.ok) return failure(parsed.code, raw, hop, null)
        const id = typeof raw === 'string' ? raw.trim() : ''
        if (hop > MEMORY_EXPAND_MAX_DEPTH) {
          return failure('EXPAND_DEPTH_EXCEEDED', id, hop, parsed)
        }
        const path = `${memoryDirOf(parsed.track, deps.roots)}/${parsed.file}`
        if (!existsSync(path)) return failure('EXPAND_NOT_FOUND', id, hop, parsed)
        let source: string
        try {
          source = readFileSync(path, 'utf8')
        } catch {
          // 不可读 / 同名目录 / 权限：一律降级成「不存在」，绝不把 EISDIR 抛给工具层。
          return failure('EXPAND_NOT_FOUND', id, hop, parsed)
        }
        if (parsed.hash !== undefined) {
          const detail = entryExpansion(deps, parsed.track, parsed.file, parsed.hash, id, hop, hashOf)
          return detail
        }
        const truncated = source.length > MEMORY_EXPAND_MAX_CHARS
        const body = truncated ? source.slice(0, MEMORY_EXPAND_MAX_CHARS) : source
        return {
          code: 'OK',
          id,
          track: parsed.track,
          name: parsed.file,
          body,
          chars: body.length,
          truncated,
          depth: hop,
          related: relatedOf(deps, parsed.track, parsed.name),
          message: truncated
            ? `${EXPAND_MESSAGES.OK}；正文超过 ${MEMORY_EXPAND_MAX_CHARS} 字符已截断（truncated=true）`
            : EXPAND_MESSAGES.OK,
          hash: safeHash(hashOf, body),
        }
      } catch {
        // 最后兜底：展开入口永不抛（AC-10 的「不抛未捕获异常」）。
        return failure('EXPAND_NOT_FOUND', typeof raw === 'string' ? raw : '', hop, null)
      }
    },
  }
}

/**
 * 条目级展开：找到 hash 前缀匹配的条目（含 tombstone），返回单条渲染结果；
 * related 同文件其他活动条目的带 hash ID（最多 `MEMORY_RELATED_MAX`）。
 */
function entryExpansion(
  deps: ExpanderDeps,
  track: MemoryTrack,
  file: string,
  hash12: string,
  id: string,
  hop: number,
  hashOf: (text: string) => string,
): ExpandedMemory {
  let source: string
  try {
    source = readFileSync(`${memoryDirOf(track, deps.roots)}/${file}`, 'utf8')
  } catch {
    return failure('EXPAND_NOT_FOUND', id, hop, { track, name: file })
  }
  const parsedFile = parseEntryFile(source, {
    track,
    file,
    now: Date.now(),
    fallbackAt: Date.now(),
    acceptLegacy: true,
  })
  const target = parsedFile.entries.find((entry) => entry.hash.slice(0, 12) === hash12)
  if (target === undefined) {
    return {
      ...failure('EXPAND_NOT_FOUND', id, hop, { track, name: file }),
      message: `条目已不存在（可能被整理或淘汰）：${id}；请用 list 查看当前条目`,
    }
  }
  const body = renderEntry(target, { superseded: target.superseded })
  const stem = fileStemOf(file)
  const related = parsedFile.entries
    .filter((entry) => entry !== target && !entry.superseded && entry.track === track)
    .slice(0, MEMORY_RELATED_MAX)
    .map((entry) => entryIdOf(track, stem, entry.text))
  return {
    code: 'OK',
    id,
    track,
    name: `${stem}#${hash12}`,
    body,
    chars: body.length,
    truncated: false,
    depth: hop,
    related,
    message: EXPAND_MESSAGES.OK,
    hash: safeHash(hashOf, body),
  }
}

/**
 * 逃逸判据（对「去掉 `mem://` 之后的部分」判，不对 scheme 判）：`..` / `~` / 反斜杠 / NUL /
 * 绝对路径前缀。冒号在 stem 上单独判（`mem://` 自身就带冒号，不能混为一谈）。
 */
function looksLikePath(text: string): boolean {
  if (text.includes('\0')) return true
  if (text.includes('\\')) return true
  if (text.includes('..')) return true
  if (text.includes('~')) return true
  if (text.startsWith('/')) return true
  return false
}

/** `depth` 归一：非数字/NaN/0/负数一律按 1 跳（工具参数是模型填的，不能因为填错就报错）。 */
function normalizeDepth(depth?: number): number {
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return 1
  const hop = Math.floor(depth)
  return hop < 1 ? 1 : hop
}

/**
 * 关联 ID 清洗：只留能解析的、去掉自引用与重复、上限 `MEMORY_RELATED_MAX`。
 *
 * 关联是「下一跳的入口」，给一个解析不了的 ID 等于让模型撞一次 `EXPAND_BAD_ID`。
 */
function relatedOf(deps: ExpanderDeps, track: MemoryTrack, name: string): string[] {
  if (typeof deps.relatedOf !== 'function') return []
  let candidates: string[]
  try {
    candidates = deps.relatedOf(track, name) ?? []
  } catch {
    return []
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const entry = typeof candidate === 'string' ? candidate.trim() : ''
    const parsed = parseMemoryId(entry)
    if (!parsed.ok) continue
    if (parsed.track === track && parsed.name === name) continue
    const key = `${parsed.track}/${parsed.name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
    if (out.length >= MEMORY_RELATED_MAX) break
  }
  return out
}

function safeHash(hashOf: (text: string) => string, text: string): string {
  try {
    return hashOf(text)
  } catch {
    return ''
  }
}

function failure(
  code: ExpandCode,
  id: string,
  depth: number,
  parsed: { track: MemoryTrack; name: string } | null,
): ExpandedMemory {
  return {
    code,
    id,
    track: parsed?.track ?? null,
    name: parsed?.name ?? null,
    body: '',
    chars: 0,
    truncated: false,
    depth,
    related: [],
    message: EXPAND_MESSAGES[code],
    hash: '',
  }
}
