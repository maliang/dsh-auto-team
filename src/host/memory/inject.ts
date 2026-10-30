/**
 * 纯函数：有界记忆注入（AC-25）。
 *
 * 规则：
 *  1. 总预算默认 4000 字符（MEMORY_INJECT_BUDGET），**永不超**；
 *  2. 选取顺序 = 项目记忆优先于公共记忆 → 标题/文件名命中关键词数（标题权重独立成一档，
 *     所以「标题里命中 1 次」一定排在「只在正文里命中多次」之前）→ 正文相关度
 *     → 更新时间新者优先 → 名字升序（稳定序，便于测试与复现）；
 *  3. 相关度 = 目标关键词在标题/正文里的命中次数（朴素、可解释、可单测，不引入向量依赖）；
 *  4. 超预算时保留高优先段落，**末尾固定追加一行截断标注**：
 *     `（记忆已截断：注入 3987/4000 字符，省略 12 行）`
 *     —— 这行是 QA 可 grep 的硬证据，不能只体现在 UI chip 上；其中 N 是最终注入文本长度，
 *     所以「N ≤ 预算」与「N 与文本长度一致」两件事都能被单测同时钉住。
 *
 * 不 import 本地文件（除类型），故可被 `node --test` 直接跑。
 */

export interface MemoryCandidate {
  track: 'public' | 'project'
  name: string
  body: string
  /** 可选：文件名 mtime（排序末位 tie-break，新者优先）。 */
  updatedAt?: number
}

export interface MemorySelection {
  text: string
  truncated: boolean
  included: string[]
  chars: number
  /** 因预算被省略的行数（与截断尾行里的数字同一来源）。 */
  omitted: number
}

const TRUNCATION_MARK = '…[截断]'
/** 截断尾行的最大预留（含分隔用的两个换行）；实际尾行更短，故最终 chars 必然 ≤ budget。 */
const TAIL_RESERVE = 64
/** 预算太小连尾行都放不下时，只做截断、不加尾行（不值得为标注牺牲正文）。 */
const MIN_BUDGET_FOR_TAIL = 240
/** 剩余空间连 `…[截断]` 加一小段正文都放不下时，后续候选整体放弃。 */
const MIN_BODY_SLICE = 8

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

function headerOf(candidate: MemoryCandidate): string {
  const label = candidate.track === 'project' ? '项目记忆' : '公共记忆'
  return `## ${label} · ${candidate.name}\n`
}

function lineCount(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}

interface Composition {
  text: string
  included: string[]
  truncated: boolean
  omitted: number
}

/** 在 limit 字符内拼装（不含截断尾行），并算出「省略了多少行」。 */
function compose(ranked: Ranked[], limit: number): Composition {
  const totalLines = ranked.reduce((sum, item) => sum + lineCount(item.body), 0)
  const parts: string[] = []
  const included: string[] = []
  let used = 0
  let includedLines = 0
  let truncated = false

  for (const item of ranked) {
    if (truncated) break
    const header = headerOf(item.candidate)
    const separator = parts.length === 0 ? '' : '\n\n'
    const base = separator.length + header.length
    const room = limit - used - base
    if (room < TRUNCATION_MARK.length + MIN_BODY_SLICE) {
      truncated = true
      break
    }
    if (item.body.length <= room) {
      parts.push(`${header}${item.body}`)
      used += base + item.body.length
      included.push(item.candidate.name)
      includedLines += lineCount(item.body)
      continue
    }
    const cut = item.body.slice(0, room - TRUNCATION_MARK.length)
    parts.push(`${header}${cut}${TRUNCATION_MARK}`)
    used += base + cut.length + TRUNCATION_MARK.length
    included.push(item.candidate.name)
    includedLines += lineCount(cut)
    truncated = true
  }

  return {
    text: parts.join('\n\n'),
    included,
    truncated,
    omitted: Math.max(0, totalLines - includedLines),
  }
}

/** 截断标注行（QA 可 grep 的硬证据）。 */
function tailLine(chars: number, budget: number, omitted: number): string {
  return `（记忆已截断：注入 ${chars}/${budget} 字符，省略 ${omitted} 行）`
}

/**
 * 选取并拼装注入文本。输出形如：
 *   ## 项目记忆 · conventions.md
 *   <正文>
 *   （记忆已截断：注入 3987/4000 字符，省略 12 行）
 * budget<=0 或候选全空时返回空文本且 truncated=false。
 */
export function selectMemory(
  goal: string,
  candidates: MemoryCandidate[],
  budget: number,
): MemorySelection {
  const ranked = rank(goal, candidates)
  if (budget <= 0 || ranked.length === 0) {
    return { text: '', truncated: false, included: [], chars: 0, omitted: 0 }
  }

  const full = compose(ranked, budget)
  if (!full.truncated) {
    return { text: full.text, truncated: false, included: full.included, chars: full.text.length, omitted: 0 }
  }

  // 预算太小：只做正文截断，不为标注牺牲正文。
  if (budget < MIN_BUDGET_FOR_TAIL) {
    return {
      text: full.text,
      truncated: true,
      included: full.included,
      chars: full.text.length,
      omitted: full.omitted,
    }
  }

  // 先给尾行留出空间重排；若留空间后一条都放不下，退回原结果（此时尾部改写为截断标注）。
  const trimmed = compose(ranked, budget - TAIL_RESERVE)
  const chosen = trimmed.included.length > 0 ? trimmed : full

  // 尾行里的 N 必须是「最终注入字符数」：数字位数会反过来影响长度，故迭代到不动点（最多 3 轮）。
  let tail = tailLine(chosen.text.length, budget, chosen.omitted)
  for (let round = 0; round < 3; round += 1) {
    const next = tailLine(chosen.text.length + 2 + tail.length, budget, chosen.omitted)
    if (next === tail) break
    tail = next
  }
  const withTail = `${chosen.text}\n\n${tail}`
  const text = withTail.length <= budget ? withTail : chosen.text

  return { text, truncated: true, included: chosen.included, chars: text.length, omitted: chosen.omitted }
}
