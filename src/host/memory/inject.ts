/**
 * 纯函数：条目级有界记忆注入（r23）。
 *
 * 与旧的文件级实现不同：候选是**条目**（`parseEntryFile` 的产物），注入索引只挑条目，
 * 旧流水 `run-*.md` / `lessons-*.md` 不参与（由 `bridge` 在读盘时排除）。
 *
 * 规则（DESIGN §9）：
 *  1. 丢弃已作废条目；同一 `(track, hash)` 只留一条（canonical > misc → revisions 大 →
 *     at 新 → 文件名字典序小）；
 *  2. 排序：`levelRank` 降序（P0 永不因相关性被淹没）→ relevance 降序 → 项目轨优先 →
 *     at 降序 → topic 字典序 → hash 字典序；
 *  3. 每条压成一行（≤ `MEMORY_INLINE_ITEM_MAX`），总长（头 + 行 + 尾）**永不超预算**；
 *  4. 放不下的条目进 `omitted`，尾部给一行「另有 N 条未内联（可按 ID 展开）」。
 *
 * 不 import 本地非纯模块（只 import 类型、常量与 entries 的纯函数），可被 `node --test` 直接跑。
 */

import type { MemoryInlineEntry, MemoryTrack, MemoryTopicId } from '../../shared/types.ts'
import { MEMORY_INLINE_ITEM_MAX, MEMORY_RELATED_MAX } from '../config.ts'
import { entryIdOf, formatEntryStamp, fileStemOf, levelRankOf, topicSpecOf, type ParsedEntry } from './entries.ts'

/** 单条内联项里的标题上限。 */
const TITLE_MAX = 40
/** 单条内联项里的摘要上限。 */
const SUMMARY_MAX = 60
/** 尾行预留（含分隔用两个换行）。 */
const TAIL_RESERVE = 160
/** 尾行最多列几个 ID。 */
const TAIL_MAX_IDS = 3
/** 索引块的说明行（只在有条目时出现）。 */
const ENTRIES_HEADER = '团队记忆索引（按 ID 用 auto_team_memory expand 展开全文）：'

const TRACK_LABEL: Record<MemoryTrack, string> = { project: '项目记忆', public: '公共记忆' }

export interface MemoryIndex {
  text: string
  entries: MemoryInlineEntry[]
  /** 未内联但可按 ID 展开的条目（`truncated` 的判据）。 */
  omitted: MemoryInlineEntry[]
  chars: number
  budget: number
  truncated: boolean
}

/* ---------------------------------------------------------------- 关键词与排序 */

/** 抽关键词：英文按词、中文按 2 字滑窗（够用且不依赖分词库）。 */
export function keywords(goal: string): string[] {
  const source = (goal ?? '').toLowerCase()
  const latin = source.match(/[a-z][a-z0-9_-]{2,}/g) ?? []
  const cjkRuns = source.match(/[\u4e00-\u9fa5]{2,}/g) ?? []
  const cjk: string[] = []
  for (const run of cjkRuns) {
    for (let index = 0; index + 2 <= run.length; index += 1) cjk.push(run.slice(index, index + 2))
  }
  return [...new Set([...latin, ...cjk])]
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  let total = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return total
    total += 1
    from = at + needle.length
  }
}

/** 单行收敛：折叠空白 + 超长截断加省略号。 */
function clip(text: string, max: number): string {
  const one = (text ?? '').replace(/\s+/g, ' ').trim()
  if (max <= 0) return ''
  if (one.length <= max) return one
  return `${one.slice(0, Math.max(0, max - 1))}…`
}

function topicTitleOf(topic: MemoryTopicId | null): string {
  if (topic === null) return ''
  return topicSpecOf(topic)?.title ?? ''
}

/** 相关度：goal 关键词在「主题标题 + 条目正文」里的命中次数。 */
export function entryRelevance(goal: string, entry: Pick<ParsedEntry, 'text' | 'topic'>): number {
  const words = keywords(goal)
  if (words.length === 0) return 0
  const haystack = `${topicTitleOf(entry.topic)}\n${entry.text}`.toLowerCase()
  return words.reduce((sum, word) => sum + countOccurrences(haystack, word), 0)
}

function dedupe(candidates: readonly ParsedEntry[]): ParsedEntry[] {
  const best = new Map<string, ParsedEntry>()
  for (const entry of candidates) {
    if (entry.superseded) continue
    const key = `${entry.track}\u0000${entry.hash}`
    const current = best.get(key)
    if (current === undefined || preferEntry(entry, current)) best.set(key, entry)
  }
  return [...best.values()]
}

/** 同 (track,hash) 的两条谁留下：canonical > revisions 大 > at 新 > 文件名字典序小。 */
function preferEntry(a: ParsedEntry, b: ParsedEntry): boolean {
  if (a.canonical !== b.canonical) return a.canonical
  if (a.revisions !== b.revisions) return a.revisions > b.revisions
  if (a.at !== b.at) return a.at > b.at
  return a.file.localeCompare(b.file) < 0
}

interface Ranked {
  entry: ParsedEntry
  relevance: number
}

/** 排序（§9.2 硬规则）。 */
function rank(goal: string, candidates: readonly ParsedEntry[]): Ranked[] {
  return dedupe(candidates)
    .map((entry) => ({ entry, relevance: entryRelevance(goal, entry) }))
    .sort(
      (a, b) =>
        levelRankOf(b.entry.level) - levelRankOf(a.entry.level) ||
        b.relevance - a.relevance ||
        trackRank(a.entry.track) - trackRank(b.entry.track) ||
        b.entry.at - a.entry.at ||
        (a.entry.topic ?? '').localeCompare(b.entry.topic ?? '') ||
        a.entry.hash.localeCompare(b.entry.hash),
    )
}

function trackRank(track: MemoryTrack): number {
  return track === 'project' ? 0 : 1
}

/* ---------------------------------------------------------------- 内联索引构造 */

function inlineNameOf(entry: ParsedEntry): string {
  return `${fileStemOf(entry.file)}#${entry.hash.slice(0, 12)}`
}

function idOf(entry: ParsedEntry): string {
  return entryIdOf(entry.track, fileStemOf(entry.file), entry.text)
}

/** 同 track 其他活动条目 ID（按已排序列表顺序，最多 relatedMax 个；不含自己）。 */
function relatedOf(ranked: readonly Ranked[], index: number, relatedMax: number): string[] {
  if (relatedMax <= 0) return []
  const self = ranked[index].entry
  const out: string[] = []
  for (let cursor = 0; cursor < ranked.length && out.length < relatedMax; cursor += 1) {
    if (cursor === index) continue
    const other = ranked[cursor].entry
    if (other.track !== self.track) continue
    out.push(idOf(other))
  }
  return out
}

function summaryOf(entry: ParsedEntry): string {
  return clip(`来源：${entry.source} · ${formatEntryStamp(entry.at)} · 修正 ${entry.revisions}`, SUMMARY_MAX)
}

interface Packed {
  entry: MemoryInlineEntry
  line: string
}

/** 把一条条目压成一行内联索引（保证 `line.length <= itemMax`）。 */
function packOne(ranked: readonly Ranked[], index: number, itemMax: number, relatedMax: number): Packed {
  const entry = ranked[index].entry
  const id = idOf(entry)
  const name = inlineNameOf(entry)
  const title = clip(`${entry.level} ${entry.text}`, TITLE_MAX)
  const summary = summaryOf(entry)
  let related = relatedOf(ranked, index, relatedMax)

  const build = (summaryText: string, relatedIds: string[]): string => {
    const head = summaryText === '' ? `${id} · ${TRACK_LABEL[entry.track]} · ${title}` : `${id} · ${TRACK_LABEL[entry.track]} · ${title} — ${summaryText}`
    return relatedIds.length === 0 ? head : `${head} ⇄ ${relatedIds.join(', ')}`
  }

  let line = build(summary, related)
  // 关联 ID 挤占摘要时先砍关联（只保留 1 个），保住「值不值得展开」的判断信息。
  if (line.length > itemMax && related.length > 1) {
    related = related.slice(0, 1)
    line = build(summary, related)
  }
  // 仍然超长：按剩余空间收敛摘要。
  if (line.length > itemMax) {
    const room = itemMax - build('', related).length - (summary === '' ? 0 : 3)
    const fitted = clip(summary, Math.min(SUMMARY_MAX, Math.max(0, room)))
    line = build(fitted, related)
  }
  // 兜底：极端长 ID 也绝不越界。
  if (line.length > itemMax) line = `${line.slice(0, Math.max(0, itemMax - 1))}…`

  return {
    entry: {
      id,
      track: entry.track,
      name,
      title,
      summary,
      related,
      chars: line.length,
      level: entry.level,
      revisions: entry.revisions,
      source: entry.source,
      at: entry.at,
    },
    line,
  }
}

interface Composed {
  text: string
  entries: MemoryInlineEntry[]
  omitted: MemoryInlineEntry[]
}

/** 在 limit 字符内拼装索引块（不含尾行）。 */
function compose(ranked: readonly Ranked[], limit: number, itemMax: number, relatedMax: number): Composed {
  const all = ranked.map((_, index) => packOne(ranked, index, itemMax, relatedMax))
  const lines: string[] = []
  const entries: MemoryInlineEntry[] = []
  const omitted: MemoryInlineEntry[] = []
  let used = 0

  for (const item of all) {
    const prefix = entries.length === 0 ? ENTRIES_HEADER.length + 1 : 1
    if (used + prefix + item.line.length <= limit) {
      used += prefix + item.line.length
      lines.push(item.line)
      entries.push(item.entry)
      continue
    }
    // 放不下的不丢弃：进 omitted，仍可按 ID 展开。
    omitted.push(item.entry)
  }

  if (entries.length === 0) return { text: '', entries, omitted }
  return { text: `${ENTRIES_HEADER}\n${lines.join('\n')}`, entries, omitted }
}

/** 尾行：「另有 N 条未内联（可按 ID 展开）：id1, id2, id3」；放不下就只给数量。 */
function tailOf(omitted: readonly MemoryInlineEntry[], used: number, budget: number): string {
  if (omitted.length === 0) return ''
  const count = `另有 ${omitted.length} 条未内联（可按 ID 展开）`
  const ids = omitted.map((entry) => entry.id)
  for (let take = Math.min(TAIL_MAX_IDS, ids.length); take >= 1; take -= 1) {
    const line = `${count}：${ids.slice(0, take).join(', ')}`
    if (used + 2 + line.length <= budget) return line
  }
  return used + 2 + count.length <= budget ? count : ''
}

/**
 * 条目级内联索引主入口。
 *
 * budget<=0 或候选全空时返回空文本且 truncated=false；任何输入下 `chars === text.length ≤ budget`。
 */
export function selectMemoryEntries(
  goal: string,
  candidates: readonly ParsedEntry[],
  budget: number,
): MemoryIndex {
  const itemMax = Math.max(1, MEMORY_INLINE_ITEM_MAX)
  const relatedMax = Math.max(0, MEMORY_RELATED_MAX)
  const safeBudget = Math.max(0, budget)
  const ranked = rank(goal, candidates)

  if (safeBudget <= 0 || ranked.length === 0) {
    return { text: '', entries: [], omitted: [], chars: 0, budget: safeBudget, truncated: false }
  }

  const full = compose(ranked, safeBudget, itemMax, relatedMax)
  if (full.omitted.length === 0) {
    return {
      text: full.text,
      entries: full.entries,
      omitted: [],
      chars: full.text.length,
      budget: safeBudget,
      truncated: false,
    }
  }

  // 先给尾行留出空间重排；留空间后一条都放不下，退回原结果（尾行再按剩余空间裁剪）。
  const trimmed = compose(ranked, Math.max(0, safeBudget - TAIL_RESERVE), itemMax, relatedMax)
  const chosen = trimmed.entries.length > 0 ? trimmed : full
  const tail = tailOf(chosen.omitted, chosen.text.length, safeBudget)
  const text = tail === '' ? chosen.text : chosen.text === '' ? tail : `${chosen.text}\n\n${tail}`

  return {
    text,
    entries: chosen.entries,
    omitted: chosen.omitted,
    chars: text.length,
    budget: safeBudget,
    truncated: chosen.omitted.length > 0,
  }
}
