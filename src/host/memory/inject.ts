/**
 * 纯函数：有界记忆注入 —— **内联索引**（AC-7 / AC-8 / AC-11）。
 *
 * 规则：
 *  1. 总预算默认 4000 字符（MEMORY_INJECT_BUDGET），**永不超**；
 *  2. 选取顺序 = 项目记忆优先于公共记忆 → 标题/文件名命中关键词数（标题权重独立成一档，
 *     所以「标题里命中 1 次」一定排在「只在正文里多次命中」之前）→ 正文相关度
 *     → 更新时间新者优先 → 名字升序（稳定序，便于测试与复现）；
 *  3. **不再整段塞正文**：每条候选压成一行内联索引，形态为
 *     `mem://<track>/<stem> · <轨道> · <标题> — <首句摘要> ⇄ <关联 ID…>`，
 *     单条 ≤ `MEMORY_INLINE_ITEM_MAX`(200) 字符（AC-7）；全文由 `expand.ts` 按 ID 取回；
 *  4. 放不进预算的条目进 `omitted`（**不丢信息**：仍可按 ID 展开），文本尾部给一行
 *     「另有 N 条未内联（可按 ID 展开）：mem://…」——因此 `truncated` 的语义是
 *     「有未内联条目」，旧的整段截断与截断标注（`TRUNCATION_MARK` / `tailLine`）已整体删除（AC-8/AC-11）。
 *
 * 不 import 本地非纯模块（只 import 类型与常量），故可被 `node --test` 直接跑。
 */

import type { MemoryTrack } from '../../shared/types.ts'
import { MEMORY_INLINE_ITEM_MAX, MEMORY_RELATED_MAX } from '../config.ts'

export interface MemoryCandidate {
  track: MemoryTrack
  name: string
  body: string
  /** 可选：文件名 mtime（排序末位 tie-break，新者优先）。 */
  updatedAt?: number
}

/** 一条内联索引（与 `shared/types.ts` 的 `MemoryInlineEntry` 同形，避免 host 侧再写一份）。 */
export interface InlineEntry {
  /** `mem://<track>/<stem>`（由 `memoryIdOf` 单点生成，展开期由 `parseMemoryId` 单点解析）。 */
  id: string
  track: MemoryTrack
  name: string
  title: string
  /** 首句摘要（不是全文；全文走 expand）。 */
  summary: string
  /** ≥1 个关联 id（同轨相邻优先），供模型顺着展开下一层。 */
  related: string[]
  /** 该条内联文本长度（≤ `itemMax`）。 */
  chars: number
}

export interface MemoryIndex {
  text: string
  entries: InlineEntry[]
  /** 未内联但可按 ID 展开的条目（AC-8：`truncated` 的判据）。 */
  omitted: InlineEntry[]
  chars: number
  budget: number
  truncated: boolean
}

/**
 * 兼容壳（既有名字与主要字段保留，`bridge.memoryFor` / `snapshot` 两处调用点不动）。
 *
 * 语义升级：`text` 与 `memoryIndexOf(...).text` **同源**；`omitted` 从「省略的行数」改成
 * 「未内联的条目数」，`included` 仍是内联条目的文件名列表。
 */
export interface MemorySelection {
  text: string
  truncated: boolean
  included: string[]
  chars: number
  /** 未内联的条目数（旧语义是省略行数，已随内联索引改写）。 */
  omitted: number
  /** 内联条目明细（面板 `memory.inline` 与测试直接消费）。 */
  entries: InlineEntry[]
  /** 未内联条目明细（面板 `memory.omitted`）。 */
  notInlined: InlineEntry[]
}

/* ---------------------------------------------------------------- 预算与形态常量 */

/** 单条内联项里的标题上限。 */
const TITLE_MAX = 40
/** 单条内联项里的摘要上限（AC-7 字段预算表：摘要 ≤60）。 */
const SUMMARY_MAX = 60
/** 摘要被关联 ID 挤到低于此长度时，先把关联砍到 1 个（AC-7 只要求 ≥1）。 */
const MIN_SUMMARY = 12
/** 尾行预留（含分隔用两个换行）：先留出它再排正文，避免尾行把预算撑爆。 */
const TAIL_RESERVE = 160
/** 尾行最多列几个 ID（再多就只给数量，不牺牲正文）。 */
const TAIL_MAX_IDS = 3
/** 索引块的说明行（只在有条目时出现，模型才知道 `mem://` ID 怎么用）。 */
const ENTRIES_HEADER = '团队记忆索引（按 ID 用 auto_team_memory expand 展开全文）：'

const TRACK_LABEL: Record<MemoryTrack, string> = { project: '项目记忆', public: '公共记忆' }

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

/** 标题：优先首个 markdown 标题行，否则退回文件名（去掉 .md）。 */
export function titleOf(candidate: MemoryCandidate): string {
  const heading = (candidate.body ?? '')
    .split('\n')
    .find((line) => /^\s*#{1,6}\s+\S/.test(line))
  if (heading) return heading.replace(/^\s*#{1,6}\s+/, '').trim()
  return (candidate.name ?? '').replace(/\.md$/i, '')
}

/** 标题权重的可核验数值：目标关键词在标题/文件名里命中多少次。 */
export function titleHits(goal: string, candidate: MemoryCandidate): number {
  const words = keywords(goal)
  if (words.length === 0) return 0
  const title = titleOf(candidate).toLowerCase()
  return words.reduce((sum, word) => sum + countOccurrences(title, word), 0)
}

/** 正文相关度（纯函数，供排序与测试）。 */
export function relevance(goal: string, candidate: MemoryCandidate): number {
  const words = keywords(goal)
  if (words.length === 0) return 0
  const haystack = `${candidate.name}\n${candidate.body}`.toLowerCase()
  return words.reduce((sum, word) => sum + countOccurrences(haystack, word), 0)
}

interface Ranked {
  candidate: MemoryCandidate
  body: string
  priority: number
  title: number
  score: number
  updatedAt: number
}

/** 排序：项目轨 → 标题命中 → 正文相关度 → 更新时间 → 名字（稳定）。 */
function rank(goal: string, candidates: MemoryCandidate[]): Ranked[] {
  return candidates
    .map((candidate) => ({ candidate, body: (candidate.body ?? '').trim() }))
    .filter((item) => item.body !== '')
    .map((item) => ({
      ...item,
      priority: item.candidate.track === 'project' ? 1 : 0,
      title: titleHits(goal, item.candidate),
      score: relevance(goal, item.candidate),
      updatedAt: typeof item.candidate.updatedAt === 'number' ? item.candidate.updatedAt : -1,
    }))
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.title - a.title ||
        b.score - a.score ||
        b.updatedAt - a.updatedAt ||
        a.candidate.name.localeCompare(b.candidate.name),
    )
}

/* ---------------------------------------------------------------- 内联索引构造 */

/** 单行收敛：折叠空白 + 超长截断加省略号（摘要/标题共用）。 */
function clip(text: string, max: number): string {
  const one = (text ?? '').replace(/\s+/g, ' ').trim()
  if (max <= 0) return ''
  if (one.length <= max) return one
  return `${one.slice(0, Math.max(0, max - 1))}…`
}

/**
 * `mem://<track>/<stem>`（**ID 拼装的唯一出处**，展开期只允许 `parseMemoryId` 解析）。
 *
 * `stem` 保留文件名原始大小写（去掉 `.md`）：这样 `safeMemoryName(stem)` 能逐字还原成
 * 磁盘上的文件名，不会因小写化而「注入期给出一个展开期找不到的 ID」。
 */
export function memoryIdOf(track: MemoryTrack, name: string): string {
  const stem = (name ?? '').trim().replace(/\.md$/i, '')
  return `mem://${track}/${stem}`
}

/** 首句摘要：首个非标题行 → 去掉列表符号 → 取第一句 → 收敛到 max 字符。 */
export function summaryOf(candidate: MemoryCandidate, max: number = SUMMARY_MAX): string {
  const body = (candidate.body ?? '')
    .split('\n')
    .find((line) => line.trim() !== '' && !/^\s*#{1,6}\s+/.test(line))
  const clean = (body ?? '').replace(/^\s*[-*+]\s+/, '').trim()
  if (clean === '') return ''
  const sentence = /^(.*?[。！？!?.;；])/.exec(clean)?.[1] ?? clean
  return clip(sentence, max)
}

/** 关联 ID：同轨按 rank 相邻优先，不足则跨轨补；不含自身，最多 relatedMax 个。 */
function relatedOf(ranked: Ranked[], index: number, relatedMax: number): string[] {
  if (relatedMax <= 0) return []
  const self = ranked[index].candidate
  const others = [...ranked.slice(0, index), ...ranked.slice(index + 1)].map((item) => item.candidate)
  const ordered = [
    ...others.filter((candidate) => candidate.track === self.track),
    ...others.filter((candidate) => candidate.track !== self.track),
  ]
  return ordered.slice(0, relatedMax).map((candidate) => memoryIdOf(candidate.track, candidate.name))
}

interface Packed {
  entry: InlineEntry
  line: string
}

/** 把一条候选压成一行内联索引（保证 `line.length <= itemMax`）。 */
function packOne(ranked: Ranked[], index: number, itemMax: number, relatedMax: number): Packed {
  const candidate = ranked[index].candidate
  const id = memoryIdOf(candidate.track, candidate.name)
  const title = clip(titleOf(candidate), TITLE_MAX)
  const summary = summaryOf(candidate)
  let related = relatedOf(ranked, index, relatedMax)

  const build = (summaryText: string, relatedIds: string[]): string => {
    const head = summaryText === '' ? `${id} · ${TRACK_LABEL[candidate.track]} · ${title}` : `${id} · ${TRACK_LABEL[candidate.track]} · ${title} — ${summaryText}`
    return relatedIds.length === 0 ? head : `${head} ⇄ ${relatedIds.join(', ')}`
  }

  let line = build(summary, related)
  // 关联 ID 挤占摘要时先砍关联（AC-7 只要求 ≥1 个），保住「值不值得展开」的判断信息。
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
  // 兜底：极端长 ID 也绝不越界（宁可这条被硬截断，也不让总预算被单条撑破）。
  if (line.length > itemMax) line = `${line.slice(0, Math.max(0, itemMax - 1))}…`

  return {
    entry: { id, track: candidate.track, name: candidate.name, title, summary, related, chars: line.length },
    line,
  }
}

interface Composed {
  text: string
  entries: InlineEntry[]
  omitted: InlineEntry[]
}

/** 在 limit 字符内拼装索引块（不含尾行）。 */
function compose(ranked: Ranked[], limit: number, itemMax: number, relatedMax: number): Composed {
  const all = ranked.map((_, index) => packOne(ranked, index, itemMax, relatedMax))
  const lines: string[] = []
  const entries: InlineEntry[] = []
  const omitted: InlineEntry[] = []
  let used = 0

  for (const item of all) {
    const prefix = entries.length === 0 ? ENTRIES_HEADER.length + 1 : 1
    if (used + prefix + item.line.length <= limit) {
      used += prefix + item.line.length
      lines.push(item.line)
      entries.push(item.entry)
      continue
    }
    // 放不下的不丢弃：进 omitted，仍可按 ID 展开（AC-8）。
    omitted.push(item.entry)
  }

  if (entries.length === 0) return { text: '', entries, omitted }
  return { text: `${ENTRIES_HEADER}\n${lines.join('\n')}`, entries, omitted }
}

/** 尾行：「另有 N 条未内联（可按 ID 展开）：id1, id2…」；放不下就逐个减 ID，最后只给数量。 */
function tailOf(omitted: InlineEntry[], used: number, budget: number): string {
  if (omitted.length === 0) return ''
  const count = `另有 ${omitted.length} 条未内联（可按 ID 展开）`
  const ids = omitted.map((entry) => entry.id)
  for (let take = Math.min(TAIL_MAX_IDS, ids.length); take >= 1; take -= 1) {
    const rest = omitted.length > take ? `，等 ${omitted.length} 条` : ''
    const line = `${count}：${ids.slice(0, take).join(', ')}${rest}`
    if (used + 2 + line.length <= budget) return line
  }
  return used + 2 + count.length <= budget ? count : ''
}

/**
 * 内联索引主入口：按 `rank()` 顺序逐条内联，放不下的进 `omitted`，尾部给一行可展开提示。
 *
 * 输出形如：
 *   团队记忆索引（按 ID 用 auto_team_memory expand 展开全文）：
 *   mem://project/conventions · 项目记忆 · 团队约定 — 提交前必须跑 pnpm build ⇄ mem://public/git
 *   另有 3 条未内联（可按 ID 展开）：mem://project/a, mem://project/b
 *
 * budget<=0 或候选全空时返回空文本且 truncated=false；任何输入下 `chars === text.length ≤ budget`。
 */
export function memoryIndexOf(
  goal: string,
  candidates: MemoryCandidate[],
  budget: number,
  opts?: { itemMax?: number; relatedMax?: number },
): MemoryIndex {
  const itemMax = Math.max(1, opts?.itemMax ?? MEMORY_INLINE_ITEM_MAX)
  const relatedMax = Math.max(0, opts?.relatedMax ?? MEMORY_RELATED_MAX)
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

/**
 * 兼容壳：既有调用点（`bridge.snapshot` / `bridge.memoryFor`）零改动。
 * `text` 与 `memoryIndexOf` 同源，绝不各自拼一份（历史 bug 族：两处各拼一份）。
 */
export function selectMemory(
  goal: string,
  candidates: MemoryCandidate[],
  budget: number,
): MemorySelection {
  const index = memoryIndexOf(goal, candidates, budget)
  return {
    text: index.text,
    truncated: index.truncated,
    included: index.entries.map((entry) => entry.name),
    chars: index.chars,
    omitted: index.omitted.length,
    entries: index.entries,
    notInlined: index.omitted,
  }
}
