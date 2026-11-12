/**
 * r23 记忆条目纯模块：解析 / 渲染 / 主题路由 / 判重 / upsert / supersede / 淘汰。
 *
 * 依赖纪律（DESIGN §15）：本文件只允许 import `node:crypto` 与 shared 类型/常量，
 * **禁止** import repo / bridge / adapters / node:fs —— 它是 t4 能直接 `node --test` 跑的前提。
 */

import { createHash } from 'node:crypto'

import {
  ENTRIES_PER_FILE,
  MEMORY_ENTRY_TEXT_MAX,
  SUPERSEDED_PER_FILE,
} from '../config.ts'
import type {
  MemoryEntryView,
  MemoryLevel,
  MemoryTopicId,
  MemoryTrack,
} from '../../shared/types.ts'

/* ─────────────────────────────── 主题目录（唯一真值） ─────────────────────────────── */

export interface TopicSpec {
  id: MemoryTopicId
  title: string
  /** 自动路由关键词（不区分大小写子串匹配）。 */
  keywords: readonly string[]
  /** 路由优先级：数字小先匹配。 */
  priority: number
}

const PROJECT_TOPICS: readonly TopicSpec[] = [
  { id: 'conventions', title: '团队约定', keywords: [], priority: 99 },
  { id: 'architecture', title: '架构与契约', keywords: ['架构', '模块', '边界', '契约', '依赖方向', '接口', '分层', '共享类型'], priority: 5 },
  { id: 'commands', title: '构建与门禁命令', keywords: ['pnpm', 'npm', 'node', 'typecheck', 'build', '编译', '构建', '依赖', '安装', '命令', '门禁', '退出码'], priority: 2 },
  { id: 'pitfalls', title: '失败与教训', keywords: ['失败', '教训', '坑', '返工', '事故', '超时', '崩溃', '报错', '回归', 'failed', 'error'], priority: 1 },
  { id: 'workflow', title: '流程与协作', keywords: ['流程', '派发', '角色', '评审', '任务', '协作', '计划', '记忆', 'run', '成员'], priority: 6 },
  { id: 'ui', title: '界面与样式', keywords: ['面板', '界面', '样式', '字体', '字号', '页签', '布局', '颜色', 'client', 'css', 'slot', '组件'], priority: 3 },
  { id: 'host', title: '宿主集成', keywords: ['宿主', '适配', 'inject', '事件', 'waterfall', '路由', 'profile', '真机', 'api', 'ctx'], priority: 4 },
  { id: 'domain', title: '业务与项目', keywords: ['业务', '产品', '需求', '用户', '领域', '数据', '表', '字段', '迁移', '工作区'], priority: 7 },
]

const PUBLIC_TOPIC_IDS: readonly MemoryTopicId[] = [
  'conventions',
  'architecture',
  'commands',
  'pitfalls',
  'workflow',
  'host',
]

const ALL_TOPICS: readonly TopicSpec[] = PROJECT_TOPICS

/** 该轨道的主题目录（顺序即 UI 展示顺序）。 */
export function topicCatalogOf(track: MemoryTrack): readonly TopicSpec[] {
  if (track === 'public') {
    return ALL_TOPICS.filter((spec) => PUBLIC_TOPIC_IDS.includes(spec.id))
  }
  return PROJECT_TOPICS
}

/** 按 id 找主题（与轨道无关；公共轨的可用性由 `topicCatalogOf` 判定）。 */
export function topicSpecOf(id: string): TopicSpec | null {
  return ALL_TOPICS.find((spec) => spec.id === id) ?? null
}

/** 公共轨自动路由的降级：ui → workflow、domain → architecture；其余原样。 */
export function downgradeTopic(track: MemoryTrack, topic: MemoryTopicId): MemoryTopicId {
  if (track !== 'public') return topic
  if (topic === 'ui') return 'workflow'
  if (topic === 'domain') return 'architecture'
  return topic
}

/** 主题路由：显式 topic 优先（非法即 BAD_TOPIC），否则按关键词优先级，最后 fallback conventions。 */
export function routeTopic(input: {
  track: MemoryTrack
  text: string
  topic?: string
}): { ok: true; topic: MemoryTopicId } | { ok: false; code: 'BAD_TOPIC'; message: string } {
  const catalog = topicCatalogOf(input.track)
  const allowed = catalog.map((spec) => spec.id)
  const explicit = input.topic?.trim().toLowerCase()
  if (explicit !== undefined && explicit !== '') {
    const hit = catalog.find((spec) => spec.id === explicit)
    if (hit) return { ok: true, topic: hit.id }
    return {
      ok: false,
      code: 'BAD_TOPIC',
      message: `主题「${input.topic}」不在${input.track === 'public' ? '公共' : '项目'}轨的允许列表里；允许：${allowed.join('、')}`,
    }
  }
  const haystack = input.text.toLowerCase()
  const ordered = [...ALL_TOPICS]
    .filter((spec) => spec.id !== 'conventions')
    .sort((a, b) => a.priority - b.priority)
  // 先收集全表命中，再让「更具体（更长）的关键词」优先：短词只是另一个命中词的字面子串时
  // 让位（如 commands 的「依赖」在「依赖方向」命中时让位给 architecture）；无包含关系仍按
  // 主题 priority 先命中，DESIGN §5.2 的顺序不变（D1 回归：`模块依赖方向铁律` → architecture）。
  const hits = ordered.flatMap((spec) =>
    spec.keywords
      .map((keyword) => keyword.toLowerCase())
      .filter((keyword) => haystack.includes(keyword))
      .map((keyword) => ({ spec, keyword })),
  )
  const winner = hits.find(
    (hit) =>
      !hits.some(
        (other) => other.keyword.length > hit.keyword.length && other.keyword.includes(hit.keyword),
      ),
  )
  if (winner !== undefined) return { ok: true, topic: downgradeTopic(input.track, winner.spec.id) }
  return { ok: true, topic: 'conventions' }
}

/* ─────────────────────────────── 等级 ─────────────────────────────── */

export const LEVEL_RANK: Record<MemoryLevel, number> = { P0: 2, P1: 1, P2: 0 }

export function levelRankOf(level: MemoryLevel): number {
  return LEVEL_RANK[level] ?? 0
}

/** 取较高等级：P2 可被 P1/P0 升级，P0 永不降级。 */
export function maxLevel(a: MemoryLevel, b: MemoryLevel): MemoryLevel {
  return levelRankOf(a) >= levelRankOf(b) ? a : b
}

/* ─────────────────────────────── 规范化 / hash / ID ─────────────────────────────── */

/** 判重唯一口径：NFKC → 去行首列表标记 → 空白折叠 → 去句末标点 → 小写。 */
export function normalizeEntryText(text: string): string {
  let s = text.normalize('NFKC')
  s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/[。．.!！?？;；,，、]+$/g, '').trim()
  return s.toLowerCase()
}

export function entryHash(text: string): string {
  return createHash('sha256').update(normalizeEntryText(text), 'utf8').digest('hex')
}

/** 文件名去掉 `.md`：`pitfalls.md` → `pitfalls`。 */
export function fileStemOf(file: string): string {
  return file.endsWith('.md') ? file.slice(0, -3) : file
}

/** 展示 ID：`mem://<track>/<stem>#<hash 前 12 位>`。 */
export function entryIdOf(track: MemoryTrack, fileStem: string, text: string): string {
  return `mem://${track}/${fileStem}#${entryHash(text).slice(0, 12)}`
}

/* ─────────────────────────────── 时间 ─────────────────────────────── */

const STAMP_RE = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/

/** 解析 `MM-DD HH:mm`；年份按「不超过 now + 24h」推断。非法返回 null。 */
export function parseEntryStamp(stamp: string, now: number): number | null {
  const match = STAMP_RE.exec(stamp.trim())
  if (!match) return null
  const month = Number(match[1])
  const day = Number(match[2])
  const hour = Number(match[3])
  const minute = Number(match[4])
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (hour > 23 || minute > 59) return null
  const base = Number.isFinite(now) && now > 0 ? now : Date.now()
  let year = new Date(base).getFullYear()
  let at = new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
  if (!Number.isFinite(at)) return null
  const check = new Date(at)
  if (
    check.getMonth() !== month - 1 ||
    check.getDate() !== day ||
    check.getHours() !== hour ||
    check.getMinutes() !== minute
  ) {
    return null
  }
  if (at > base + 24 * 60 * 60 * 1000) {
    year -= 1
    at = new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
    const previous = new Date(at)
    if (
      previous.getMonth() !== month - 1 ||
      previous.getDate() !== day ||
      previous.getHours() !== hour ||
      previous.getMinutes() !== minute
    ) {
      return null
    }
  }
  return at
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** 本地时区 `MM-DD HH:mm`（两位补零）。 */
export function formatEntryStamp(at: number): string {
  const date = new Date(Number.isFinite(at) && at > 0 ? at : Date.now())
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/* ─────────────────────────────── 条目类型 ─────────────────────────────── */

export interface ParsedEntry {
  track: MemoryTrack
  file: string
  topic: MemoryTopicId | null
  level: MemoryLevel
  text: string
  source: string
  at: number
  revisions: number
  lineIndex: number
  hash: string
  canonical: boolean
  superseded: boolean
}

export interface ParsedEntryFile {
  entries: ParsedEntry[]
  counts: {
    formatted: number
    legacySourced: number
    compat: number
    headings: number
    blank: number
  }
}

export interface EntryDraft {
  track: MemoryTrack
  text: string
  level: MemoryLevel
  topic?: MemoryTopicId
  source: string
  at: number
  supersedes?: string
}

export type MemoryMutationCode =
  | 'BAD_TEXT'
  | 'BAD_TOPIC'
  | 'MEMORY_QUOTA_FULL'
  | 'MEMORY_READONLY_COLLISION'
  | 'SUPERSEDE_NOT_FOUND'
  | 'SUPERSEDE_DUPLICATE'
  | 'SUPERSEDE_LEGACY_READONLY'

export type MutationOutcome =
  | {
      ok: true
      entries: ParsedEntry[]
      touched: ParsedEntry[]
      evicted: ParsedEntry[]
      superseded: ParsedEntry[]
      changedFiles: string[]
      added: number
      updated: number
      revived: number
    }
  | { ok: false; code: MemoryMutationCode; message: string }

/* ─────────────────────────────── 渲染 ─────────────────────────────── */

export type RenderableEntry = Pick<ParsedEntry, 'level' | 'text' | 'source' | 'at' | 'revisions'>

/** `[P1] 文本（来源：...）`（无行首 `- `）。 */
export function renderEntryBody(entry: RenderableEntry): string {
  return `[${entry.level}] ${entry.text}（来源：${entry.source} · ${formatEntryStamp(entry.at)} · 修正 ${entry.revisions}）`
}

/** 活动条目 `- [P1] ...`；tombstone `- ~~[P1] ...~~`。 */
export function renderEntry(entry: RenderableEntry, opts?: { superseded?: boolean }): string {
  const body = renderEntryBody(entry)
  return opts?.superseded === true ? `- ~~${body}~~` : `- ${body}`
}

/** 宿主格式化的来源文案（条目视图 / 内联 summary 共用）。 */
export function sourceTextOf(entry: Pick<ParsedEntry, 'source' | 'at' | 'revisions'>): string {
  return `来源：${entry.source} · ${formatEntryStamp(entry.at)} · 修正 ${entry.revisions}`
}

/** ParsedEntry → MemoryEntryView（客户端禁止自己解析 md）。 */
export function entryViewOf(entry: ParsedEntry): MemoryEntryView {
  return {
    id: entryIdOf(entry.track, fileStemOf(entry.file), entry.text),
    track: entry.track,
    file: entry.file,
    topic: entry.topic,
    level: entry.level,
    text: entry.text,
    source: entry.source,
    at: entry.at,
    stamp: formatEntryStamp(entry.at),
    sourceText: sourceTextOf(entry),
    revisions: entry.revisions,
    superseded: entry.superseded,
  }
}

/** 唯一渲染入口：只渲染 `entry.file === `${topic}.md`` 的条目。 */
export function renderEntryFile(topic: MemoryTopicId, entries: readonly ParsedEntry[]): string {
  const file = `${topic}.md`
  const mine = entries.filter((entry) => entry.file === file)
  const active = mine
    .filter((entry) => !entry.superseded)
    .sort(
      (a, b) =>
        levelRankOf(b.level) - levelRankOf(a.level) ||
        b.at - a.at ||
        (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0),
    )
  const tombstones = mine
    .filter((entry) => entry.superseded)
    .sort((a, b) => b.at - a.at || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
    .slice(0, SUPERSEDED_PER_FILE)

  const spec = topicSpecOf(topic)
  const lines: string[] = [`# ${spec?.title ?? topic}`, '']
  for (const entry of active) lines.push(renderEntry(entry))
  if (tombstones.length > 0) {
    if (active.length > 0) lines.push('')
    lines.push('## 已作废')
    for (const entry of tombstones) lines.push(renderEntry(entry, { superseded: true }))
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

/* ─────────────────────────────── 解析 ─────────────────────────────── */

const NEW_ENTRY_RE =
  /^-\s+\[(P0|P1|P2)\]\s+(.+?)（来源：([^·（）\n]+?)\s+·\s+(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s+·\s+修正\s+(\d{1,7})）$/

const TOMBSTONE_RE =
  /^-\s+~~\[(P0|P1|P2)\]\s+(.+?)（来源：([^·（）\n]+?)\s+·\s+(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s+·\s+修正\s+(\d{1,7})）~~$/

const LEGACY_SOURCED_RE =
  /^-\s+\[([^\]·\n]+?)\s+·\s+(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\]\s*(.*)$/

const SOURCE_RE = /^[^ ·（）\n]+(?:\/[^ ·（）\n]+)?$/

function stripListMarker(line: string): string {
  return line.replace(/^[-*+]\s+/, '')
}

function canonicalTopicOf(file: string): MemoryTopicId | null {
  const stem = fileStemOf(file)
  const spec = topicSpecOf(stem)
  if (!spec) return null
  return file === `${spec.id}.md` ? spec.id : null
}

type ParsedLine = { entry: ParsedEntry; origin: 'formatted' | 'legacy' | 'compat' }
type StructuralLine = 'blank' | 'heading' | 'fence' | 'divider'

function parseLineDetail(
  line: string,
  opts: {
    track: MemoryTrack
    file: string
    now: number
    lineIndex: number
    fallbackAt: number
    acceptLegacy?: boolean
  },
): ParsedLine | StructuralLine {
  if (line.trim() === '') return 'blank'
  if (/^#{1,6}\s+/.test(line)) return 'heading'
  if (/^(```|~~~)/.test(line)) return 'fence'
  if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) return 'divider'

  const topic = canonicalTopicOf(opts.file)
  const fallbackAt =
    Number.isFinite(opts.fallbackAt) && opts.fallbackAt > 0 ? opts.fallbackAt : opts.now
  const base = {
    track: opts.track,
    file: opts.file,
    topic,
    lineIndex: opts.lineIndex,
    canonical: topic !== null,
  }

  // tombstone 优先：内部与活动条目同构，外层多 `~~`。
  const tomb = TOMBSTONE_RE.exec(line)
  if (tomb) {
    const parsed = parseFormattedMatch(tomb, { ...opts, base })
    if (parsed) return { entry: { ...parsed, superseded: true }, origin: 'formatted' }
  }

  const fresh = NEW_ENTRY_RE.exec(line)
  if (fresh) {
    const parsed = parseFormattedMatch(fresh, { ...opts, base })
    if (parsed) return { entry: { ...parsed, superseded: false }, origin: 'formatted' }
  }

  if (opts.acceptLegacy !== false) {
    const legacy = LEGACY_SOURCED_RE.exec(line)
    if (legacy) {
      const stamp = `${legacy[2]}-${legacy[3]} ${legacy[4]}:${legacy[5]}`
      const at = parseEntryStamp(stamp, opts.now)
      const source = legacy[1].trim()
      const text = legacy[6].trim()
      if (at !== null && text !== '' && SOURCE_RE.test(source)) {
        return {
          entry: {
            ...base,
            level: 'P1',
            text,
            source,
            at,
            revisions: 1,
            hash: entryHash(text),
            superseded: false,
          },
          origin: 'legacy',
        }
      }
    }
  }

  // 兼容行：任何非空非结构行都按 P1 保留，绝不丢内容。
  const text = stripListMarker(line).trim()
  return {
    entry: {
      ...base,
      level: 'P1',
      text,
      source: '手写',
      at: fallbackAt,
      revisions: 1,
      hash: entryHash(text),
      superseded: false,
    },
    origin: 'compat',
  }
}

function parseFormattedMatch(
  match: RegExpExecArray,
  opts: {
    track: MemoryTrack
    file: string
    now: number
    lineIndex: number
    base: Pick<ParsedEntry, 'track' | 'file' | 'topic' | 'lineIndex' | 'canonical'>
  },
): Omit<ParsedEntry, 'superseded'> | null {
  const level = match[1] as MemoryLevel
  const text = match[2].trim()
  const source = match[3].trim()
  const stamp = `${match[4]}-${match[5]} ${match[6]}:${match[7]}`
  const revisions = Number(match[8])
  if (text === '') return null
  if (!SOURCE_RE.test(source)) return null
  if (!Number.isInteger(revisions) || revisions < 1 || revisions > 9_999_999) return null
  const at = parseEntryStamp(stamp, opts.now)
  if (at === null) return null
  return {
    ...opts.base,
    level,
    text,
    source,
    at,
    revisions,
    hash: entryHash(text),
  }
}

/** 解析单行；结构行/空行返回 null。 */
export function parseEntryLine(
  line: string,
  opts: {
    track: MemoryTrack
    file: string
    now: number
    lineIndex: number
    fallbackAt: number
    acceptLegacy?: boolean
  },
): ParsedEntry | null {
  const parsed = parseLineDetail(line, opts)
  return typeof parsed === 'string' ? null : parsed.entry
}

/** 解析整个文件；`## 已作废` 之后的条目一律 `superseded=true`。 */
export function parseEntryFile(
  text: string,
  opts: {
    track: MemoryTrack
    file: string
    now: number
    fallbackAt: number
    acceptLegacy?: boolean
  },
): ParsedEntryFile {
  const entries: ParsedEntry[] = []
  const counts = { formatted: 0, legacySourced: 0, compat: 0, headings: 0, blank: 0 }
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let inSupersededSection = false
  let supersededHeadingSeen = false
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const parsed = parseLineDetail(line, { ...opts, lineIndex })
    if (parsed === 'blank') {
      counts.blank += 1
      continue
    }
    if (parsed === 'heading') {
      counts.headings += 1
      if (!supersededHeadingSeen && line.trim() === '## 已作废') {
        inSupersededSection = true
        supersededHeadingSeen = true
      }
      continue
    }
    if (parsed === 'fence' || parsed === 'divider') continue
    if (parsed.origin === 'formatted') counts.formatted += 1
    else if (parsed.origin === 'legacy') counts.legacySourced += 1
    else counts.compat += 1
    entries.push({ ...parsed.entry, superseded: parsed.entry.superseded || inSupersededSection })
  }
  return { entries, counts }
}

/* ─────────────────────────────── 写入校验 ─────────────────────────────── */

const SOURCE_SUFFIX_RE = /（来源：[^·（）\n]+(?: · \d{2}-\d{2} \d{2}:\d{2} · 修正 \d{1,7})）$/

function validateDraft(
  draft: EntryDraft,
): { ok: true; text: string; source: string; at: number } | { ok: false; code: MemoryMutationCode; message: string } {
  let text = String(draft.text ?? '').replace(/\r\n?/g, '\n')
  if (text.includes('\n')) text = text.replace(/\n+/g, ' ')
  text = text.trim()
  if (text === '') return { ok: false, code: 'BAD_TEXT', message: '正文不能为空' }
  if (text.includes('（来源：') && SOURCE_SUFFIX_RE.test(text)) {
    return { ok: false, code: 'BAD_TEXT', message: '正文不能自带来源后缀（来源由系统追加）' }
  }
  if (text.length > MEMORY_ENTRY_TEXT_MAX) {
    text = `${text.slice(0, MEMORY_ENTRY_TEXT_MAX - 1)}…`
  }
  const source = String(draft.source ?? '').trim() || '手写'
  if (!SOURCE_RE.test(source)) {
    return { ok: false, code: 'BAD_TEXT', message: `来源不合法：${source}（不能含空格/·/全角括号/换行）` }
  }
  const at = Number.isFinite(draft.at) && draft.at > 0 ? draft.at : Date.now()
  return { ok: true, text, source, at }
}

/* ─────────────────────────────── 淘汰 ─────────────────────────────── */

function evictionOrder(a: ParsedEntry, b: ParsedEntry): number {
  return (
    levelRankOf(a.level) - levelRankOf(b.level) ||
    a.at - b.at ||
    a.lineIndex - b.lineIndex ||
    (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)
  )
}

/**
 * 目标文件将超 40 条时先淘汰：P2 最旧 → P1 最旧 → P0 不动。
 * `entries` 必须是**目标文件**的条目集合（含 tombstone，tombstone 不计数）。
 */
export function evictForInsert(
  entries: readonly ParsedEntry[],
  incoming: EntryDraft,
  maxPerFile: number,
): { ok: true; kept: ParsedEntry[]; evicted: ParsedEntry[] } | { ok: false; code: 'MEMORY_QUOTA_FULL'; message: string } {
  const active = entries.filter((entry) => !entry.superseded)
  const need = active.length + 1 - maxPerFile
  if (need <= 0) return { ok: true, kept: [...entries], evicted: [] }
  const incomingHash = entryHash(String(incoming.text ?? ''))
  const evictable = active
    .filter((entry) => entry.level !== 'P0' && entry.hash !== incomingHash)
    .sort(evictionOrder)
  if (evictable.length < need) {
    const file = active[0]?.file ?? (incoming.topic ? `${incoming.topic}.md` : 'pitfalls.md')
    return {
      ok: false,
      code: 'MEMORY_QUOTA_FULL',
      message: `「${file}」已有 ${Math.max(active.length, maxPerFile)} 条且全部为 P0（P0 不淘汰）：请先手工删除或降级一条 P0 再写入`,
    }
  }
  const gone = new Set(evictable.slice(0, need))
  return {
    ok: true,
    kept: entries.filter((entry) => !gone.has(entry)),
    evicted: evictable.slice(0, need),
  }
}

/** tombstone 审计上限：每文件最多保留最新的 20 个（at 最旧先删，tie hash 升序）。 */
function capTombstones(entries: ParsedEntry[]): { entries: ParsedEntry[]; removed: ParsedEntry[] } {
  const byFile = new Map<string, ParsedEntry[]>()
  for (const entry of entries) {
    if (!entry.superseded) continue
    const list = byFile.get(entry.file) ?? []
    list.push(entry)
    byFile.set(entry.file, list)
  }
  const removed: ParsedEntry[] = []
  for (const [file, list] of byFile) {
    if (list.length <= SUPERSEDED_PER_FILE) continue
    const keep = new Set(
      [...list]
        .sort((a, b) => b.at - a.at || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
        .slice(0, SUPERSEDED_PER_FILE),
    )
    for (const entry of list) if (!keep.has(entry)) removed.push(entry)
    void file
  }
  if (removed.length === 0) return { entries, removed }
  const gone = new Set(removed)
  return { entries: entries.filter((entry) => !gone.has(entry)), removed }
}

/* ─────────────────────────────── upsert / supersede ─────────────────────────────── */

function bestMatch(matches: readonly ParsedEntry[]): ParsedEntry | null {
  if (matches.length === 0) return null
  return [...matches].sort(
    (a, b) =>
      Number(b.canonical) - Number(a.canonical) ||
      b.revisions - a.revisions ||
      b.at - a.at ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  )[0]
}

function sortedFileNames(files: Iterable<string>): string[] {
  return [...new Set(files)].sort((a, b) => a.localeCompare(b))
}

export function upsertEntry(
  entries: readonly ParsedEntry[],
  incoming: EntryDraft,
  opts: { maxPerFile: number },
): MutationOutcome {
  const validated = validateDraft(incoming)
  if (!validated.ok) return validated
  const routed = routeTopic({
    track: incoming.track,
    text: validated.text,
    ...(incoming.topic === undefined ? {} : { topic: incoming.topic }),
  })
  if (!routed.ok) return routed
  const topic = routed.topic
  const targetFile = `${topic}.md`
  const hash = entryHash(validated.text)
  const sameHash = entries.filter((entry) => entry.hash === hash)
  const canonicalMatches = sameHash.filter((entry) => entry.canonical)
  const miscMatch = sameHash.find((entry) => !entry.canonical)

  if (canonicalMatches.length === 0) {
    if (miscMatch) {
      return {
        ok: false,
        code: 'MEMORY_READONLY_COLLISION',
        message: `同一正文已存在于只读文件 ${miscMatch.file}；请手工编辑该文件或改写正文`,
      }
    }
    const targetEntries = entries.filter((entry) => entry.file === targetFile)
    const evictedResult = evictForInsert(targetEntries, { ...incoming, text: validated.text }, opts.maxPerFile)
    if (!evictedResult.ok) return evictedResult
    const evictedSet = new Set(evictedResult.evicted)
    const keptAll = entries.filter((entry) => !evictedSet.has(entry))
    const created: ParsedEntry = {
      track: incoming.track,
      file: targetFile,
      topic,
      level: incoming.level,
      text: validated.text,
      source: validated.source,
      at: validated.at,
      revisions: 1,
      lineIndex: targetEntries.length,
      hash,
      canonical: true,
      superseded: false,
    }
    const merged = [...keptAll, created]
    const capped = capTombstones(merged)
    return {
      ok: true,
      entries: capped.entries,
      touched: [created],
      evicted: [...evictedResult.evicted, ...capped.removed],
      superseded: [],
      changedFiles: sortedFileNames([
        targetFile,
        ...capped.removed.map((entry) => entry.file),
      ]),
      added: 1,
      updated: 0,
      revived: 0,
    }
  }

  const old = bestMatch(canonicalMatches)
  if (!old) return { ok: false, code: 'BAD_TEXT', message: '正文不能为空' }
  if (miscMatch && !canonicalMatches.some((entry) => entry.file === miscMatch.file)) {
    // 只读文件里也有同 hash：canonical 优先更新，但必须让调用方知道只读副本仍在。
  }
  const keepOldFile = incoming.topic === undefined || old.file === targetFile
  const newFile = keepOldFile ? old.file : targetFile
  const newTopic = keepOldFile ? old.topic : topic
  const targetEntries = entries.filter((entry) => entry.file === newFile && entry !== old)
  const needEvict = old.superseded || newFile !== old.file
  let evicted: ParsedEntry[] = []
  let kept = [...entries]
  if (needEvict) {
    const activeTargets = targetEntries.filter((entry) => !entry.superseded)
    if (activeTargets.length >= opts.maxPerFile) {
      const evictedResult = evictForInsert(targetEntries, { ...incoming, text: validated.text }, opts.maxPerFile)
      if (!evictedResult.ok) return evictedResult
      evicted = evictedResult.evicted
      const gone = new Set(evicted)
      kept = entries.filter((entry) => !gone.has(entry))
    }
  }
  const updated: ParsedEntry = {
    ...old,
    file: newFile,
    topic: newTopic,
    level: maxLevel(old.level, incoming.level),
    text: validated.text,
    source: validated.source,
    at: validated.at,
    revisions: old.revisions + 1,
    hash,
    canonical: true,
    superseded: false,
  }
  const merged = kept.map((entry) => (entry === old ? updated : entry))
  const capped = capTombstones(merged)
  return {
    ok: true,
    entries: capped.entries,
    touched: [updated],
    evicted: [...evicted, ...capped.removed],
    superseded: [],
    changedFiles: sortedFileNames([old.file, newFile, ...evicted.map((entry) => entry.file)]),
    added: 0,
    updated: 1,
    revived: old.superseded ? 1 : 0,
  }
}

export function supersedeEntry(
  entries: readonly ParsedEntry[],
  targetText: string,
  incoming: EntryDraft,
  opts: { maxPerFile: number },
): MutationOutcome {
  const validated = validateDraft(incoming)
  if (!validated.ok) return validated
  const targetHash = entryHash(String(targetText ?? ''))
  const targetMatches = entries.filter((entry) => entry.hash === targetHash)
  if (targetMatches.length === 0) {
    return {
      ok: false,
      code: 'SUPERSEDE_NOT_FOUND',
      message: `没有找到要取代的条目：${String(targetText ?? '').trim().slice(0, 50)}`,
    }
  }
  const readonly = targetMatches.find((entry) => !entry.canonical)
  if (readonly) {
    return {
      ok: false,
      code: 'SUPERSEDE_LEGACY_READONLY',
      message: `只读文件 ${readonly.file} 的条目不能被 supersede；请手工编辑`,
    }
  }
  const activeTargets = targetMatches.filter((entry) => !entry.superseded)
  if (activeTargets.length === 0) {
    return { ok: false, code: 'SUPERSEDE_NOT_FOUND', message: '目标已作废，无需再次取代' }
  }
  const target = bestMatch(activeTargets)
  if (!target) return { ok: false, code: 'SUPERSEDE_NOT_FOUND', message: '目标不存在' }

  const routed = routeTopic({
    track: incoming.track,
    text: validated.text,
    ...(incoming.topic === undefined ? {} : { topic: incoming.topic }),
  })
  if (!routed.ok) return routed
  const newFile = `${routed.topic}.md`
  const newHash = entryHash(validated.text)
  const duplicate = entries.find((entry) => entry.hash === newHash && entry !== target)
  if (duplicate) {
    return {
      ok: false,
      code: 'SUPERSEDE_DUPLICATE',
      message: `新正文已存在（${duplicate.file}），请直接 upsert 或改写正文`,
    }
  }

  const tombstone: ParsedEntry = { ...target, superseded: true }
  let kept = entries.map((entry) => (entry === target ? tombstone : entry))
  let evicted: ParsedEntry[] = []
  if (newFile !== target.file) {
    const targetEntries = kept.filter((entry) => entry.file === newFile)
    if (targetEntries.filter((entry) => !entry.superseded).length >= opts.maxPerFile) {
      const evictedResult = evictForInsert(targetEntries, { ...incoming, text: validated.text }, opts.maxPerFile)
      if (!evictedResult.ok) return evictedResult
      evicted = evictedResult.evicted
      const gone = new Set(evicted)
      kept = kept.filter((entry) => !gone.has(entry))
    }
  }
  const created: ParsedEntry = {
    track: incoming.track,
    file: newFile,
    topic: routed.topic,
    level: maxLevel(target.level, incoming.level),
    text: validated.text,
    source: validated.source,
    at: validated.at,
    revisions: target.revisions + 1,
    lineIndex: kept.filter((entry) => entry.file === newFile).length,
    hash: newHash,
    canonical: true,
    superseded: false,
  }
  const merged = [...kept, created]
  const capped = capTombstones(merged)
  return {
    ok: true,
    entries: capped.entries,
    touched: [created],
    evicted: [...evicted, ...capped.removed],
    superseded: [tombstone],
    changedFiles: sortedFileNames([target.file, newFile, ...evicted.map((entry) => entry.file)]),
    added: 1,
    updated: 0,
    revived: 0,
  }
}

/** 统一编排入口：有 `supersedes` 走取代，否则按 hash upsert。 */
export function applyMemoryMutation(
  entries: readonly ParsedEntry[],
  draft: EntryDraft,
  opts: { maxPerFile: number },
): MutationOutcome {
  if (draft.supersedes !== undefined && draft.supersedes !== '') {
    return supersedeEntry(entries, draft.supersedes, draft, opts)
  }
  return upsertEntry(entries, draft, opts)
}

export const DEFAULT_MAX_ENTRIES_PER_FILE = ENTRIES_PER_FILE
