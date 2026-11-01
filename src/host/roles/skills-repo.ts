/**
 * 技能 md 仓储（r10 AC-19/AC-20）：`<home>/.dsh/auto-team/skills/<id>.md` 一技能一文件。
 *
 * 为什么技能要**独立于角色**（而不是塞进 roles/repo.ts）：
 *  - 角色的落盘策略是「JSON + 内置铺底 + 缺键补齐」，技能是「md + frontmatter + 四来源 + 覆盖层语义」，
 *    两套写盘策略塞在一个文件里必然互相纠缠；
 *  - 独立后可以用 mkdtemp 单测全部落盘语义（seed 三态 / 撞名 / 拒删 / 恢复出厂），不依赖宿主。
 *
 * 三条硬语义（都有单测）：
 *  1. `seed()` 只在**缺失**时写完整 md、只在**缺 frontmatter** 时前置 frontmatter，正文一个字节不动；
 *  2. `modified` **不落盘**，由 `sha256(正文) ≠ sha256(出厂正文)` 现算 —— 所以用户改过的内置技能
 *     迁移后标记天然正确，也不会因为漏写标记而长出假状态；
 *  3. `builtin` 只由 `BUILTIN_SKILLS` 判定（磁盘写 `source: builtin` 也不算），因此「内置不可删」
 *     不会因为手改 md 被绕过。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_LIST_LIMIT, SKILL_TITLE_MAX } from '../../shared/const.ts'
import type { Result, SkillDraft, SkillInfo, SkillSource } from '../../shared/types.ts'
import { BUILTIN_SKILLS, builtinSkillBody, isBuiltinSkill, type BuiltinSkill } from './builtin.ts'

/** 技能 id 形态（与角色 id 同构：小写字母/数字/连字符，≤32 字）。 */
const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

/** legacy（无 frontmatter）文件派生说明时的截断长度。 */
const LEGACY_DESCRIPTION_MAX = 60

/** 四来源在清单里的排序权重（内置永远在前，用户三源按导入 → 系统 → 手写）。 */
const SOURCE_ORDER: Record<SkillSource, number> = { builtin: 0, imported: 1, system: 2, manual: 3 }

export interface SkillRecord {
  id: string
  title: string
  description: string
  body: string
  source: SkillSource
  /** 内置技能正文被用户改过（现算，不落盘）。 */
  modified: boolean
  /** builtin 出厂为 0；用户保存写 `now()`。 */
  updatedAt: number
}

export interface ParsedSkillFile {
  id: string
  title: string
  description: string
  source: SkillSource
  updatedAt: number
  body: string
  /** 文件是否本来就带 frontmatter —— `seed()` 靠它决定「前置」还是「不碰」。 */
  hasFrontmatter: boolean
}

export interface SkillRepoDeps {
  dir: string
  now: () => number
  warn?: (message: string) => void
}

export interface SkillRepo {
  /** 全量记录（含正文）：内置按出厂序 → 导入 → 系统 → 手写，组内按标题。 */
  list(): SkillRecord[]
  /** 快照投影（不含正文；上限 SKILL_LIST_LIMIT 条）。 */
  projection(): SkillInfo[]
  get(id: string): SkillRecord | undefined
  readBody(id: string): Result<string>
  save(draft: SkillDraft): Result<SkillRecord>
  remove(id: string): Result<{ id: string; title: string }>
  restoreBuiltin(id: string): Result<SkillRecord>
  /** 全部内置技能恢复出厂；**不动用户三源**（返回被复原的 id）。 */
  restoreBuiltins(): { restored: string[] }
  seed(): void
}

export function createSkillRepo(deps: SkillRepoDeps): SkillRepo {
  const { dir, now } = deps
  const warn = (message: string): void => deps.warn?.(message)
  const pathOf = (id: string): string => `${dir}/${id}.md`

  const digest = (body: string): string => createHash('sha256').update(normalizeText(body).trimEnd(), 'utf8').digest('hex')

  const factoryRecord = (skill: BuiltinSkill): SkillRecord => ({
    id: skill.id,
    title: skill.title,
    description: skill.description,
    body: skill.body,
    source: 'builtin',
    modified: false,
    updatedAt: 0,
  })

  /** 解析结果 → 仓储记录（`modified` 在这里现算，是全局唯一的计算点）。 */
  const toRecord = (parsed: ParsedSkillFile): SkillRecord => ({
    id: parsed.id,
    title: parsed.title,
    description: parsed.description,
    body: parsed.body,
    source: parsed.source,
    modified: parsed.source === 'builtin' ? digest(parsed.body) !== digest(builtinSkillBody(parsed.id)) : false,
    updatedAt: parsed.updatedAt,
  })

  const readOne = (id: string): SkillRecord | undefined => {
    const path = pathOf(id)
    if (!existsSync(path)) return undefined
    try {
      return toRecord(parseSkillFile(`${id}.md`, readFileSync(path, 'utf8')))
    } catch (error) {
      warn(`技能文件读取失败（${path}）：${messageOf(error)}`)
      return undefined
    }
  }

  const write = (record: SkillRecord): Result<SkillRecord> => {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(pathOf(record.id), renderSkillFile(record), 'utf8')
      return { data: record }
    } catch (error) {
      return { error: `技能保存失败（${record.id}）：${messageOf(error)}` }
    }
  }

  const list = (): SkillRecord[] => {    const onDisk = new Map<string, SkillRecord>()
    if (existsSync(dir)) {
      let entries: string[] = []
      try {
        entries = readdirSync(dir)
      } catch (error) {
        warn(`技能目录读取失败（${dir}）：${messageOf(error)}`)
      }
      for (const name of entries) {
        if (!name.toLowerCase().endsWith('.md')) continue
        try {
          const parsed = parseSkillFile(name, readFileSync(`${dir}/${name}`, 'utf8'))
          onDisk.set(parsed.id, toRecord(parsed))
        } catch (error) {
          // 单条坏文件跳过：一条坏 md 不能把整张快照打成异常（面板会连角色一起读不出来）。
          warn(`技能文件跳过（${name}）：${messageOf(error)}`)
        }
      }
    }
    // 内置技能即便 md 被删掉也要出现在清单里（否则角色引用的技能会在界面上「凭空消失」）。
    const builtins = BUILTIN_SKILLS.map((skill) => onDisk.get(skill.id) ?? factoryRecord(skill))
    const others = [...onDisk.values()]
      .filter((record) => !isBuiltinSkill(record.id))
      .sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.title.localeCompare(b.title, 'zh-Hans-CN'))
    return [...builtins, ...others].slice(0, SKILL_LIST_LIMIT)
  }

  /**
   * 新建技能时按标题派生不撞名的 id：撞了就 `-2`/`-3`…，并避开出厂内置 id。
   *
   * 只在 `draft.id` 缺省（=新建）时用；更新永远走调用方给的 id（改标题不改 id，
   * 否则角色 `skillIds` 里的引用会变成悬空）。
   */
  const uniqueIdFor = (base: string): string => {
    if (!existsSync(pathOf(base)) && !isBuiltinSkill(base)) return base
    const stem = base.slice(0, 28).replace(/-+$/, '') || 'skill'
    for (let seq = 2; seq <= 999; seq += 1) {
      const candidate = `${stem}-${seq}`
      if (!existsSync(pathOf(candidate)) && !isBuiltinSkill(candidate)) return candidate
    }
    return `${stem}-${Math.floor(now() % 1_000_000)}`
  }

  return {
    list,

    projection(): SkillInfo[] {
      return list().map(({ id, title, description, source, modified }) => ({ id, title, description, source, modified }))
    },

    get(id: string): SkillRecord | undefined {
      const record = readOne(id)
      if (record !== undefined) return record
      const factory = BUILTIN_SKILLS.find((skill) => skill.id === id)
      return factory === undefined ? undefined : factoryRecord(factory)
    },

    readBody(id: string): Result<string> {
      const record = readOne(id)
      if (record !== undefined) return { data: record.body }
      const factory = BUILTIN_SKILLS.find((skill) => skill.id === id)
      if (factory !== undefined) return { data: factory.body }
      return { error: `技能不存在：「${id}」` }
    },

    save(draft: SkillDraft): Result<SkillRecord> {
      const title = (draft.title ?? '').trim()
      if (title === '') return { error: '技能标题不能为空' }
      if (title.length > SKILL_TITLE_MAX) return { error: `技能标题最多 ${SKILL_TITLE_MAX} 字（当前 ${title.length} 字）` }

      const body = normalizeText(draft.body ?? '').trimEnd()
      if (body.trim() === '') return { error: '技能正文不能为空' }
      if (body.length > SKILL_BODY_MAX) return { error: `技能正文最多 ${SKILL_BODY_MAX} 字（当前 ${body.length} 字）` }

      // 说明缺省时从正文派生（比直接拒绝宽容），但超长一律拒（界面靠单行截断展示，写长了也读不出来）。
      const given = (draft.description ?? '').trim()
      const description = given !== '' ? given : deriveDescription(body, title)
      if (description.length > SKILL_DESCRIPTION_MAX) {
        return { error: `技能说明最多 ${SKILL_DESCRIPTION_MAX} 字（当前 ${description.length} 字）` }
      }

      const requested = (draft.id ?? '').trim()
      let id: string
      if (requested !== '') {
        if (!SKILL_ID_PATTERN.test(requested)) {
          return { error: `技能 id 不合法：「${requested}」（只能小写字母/数字/连字符，首字符不能是连字符，最长 32 字）` }
        }
        if (draft.source === 'builtin' && !isBuiltinSkill(requested)) {
          return { error: `不能新建内置技能：「${requested}」` }
        }
        id = requested
      } else {
        if (draft.source === 'builtin') return { error: '内置技能必须带 id（不能凭标题新建内置技能）' }
        id = uniqueIdFor(slugifySkillTitle(title))
      }

      // builtin 只能由出厂清单判定：盘上写什么都不算，所以这里是最终裁决点。
      if (!isBuiltinSkill(id) && draft.source === 'builtin') return { error: `不能新建内置技能：「${id}」` }
      const source: SkillSource = isBuiltinSkill(id) ? 'builtin' : draft.source

      return write({
        id,
        title,
        description,
        body,
        source,
        modified: source === 'builtin' ? digest(body) !== digest(builtinSkillBody(id)) : false,
        updatedAt: now(),
      })
    },

    remove(id: string): Result<{ id: string; title: string }> {
      if (isBuiltinSkill(id)) return { error: `内置技能不可删除：只能「恢复出厂」（${id}）` }
      if (!existsSync(pathOf(id))) return { error: `技能不存在：「${id}」` }
      const title = readOne(id)?.title ?? id
      try {
        rmSync(pathOf(id))
      } catch (error) {
        return { error: `技能删除失败（${id}）：${messageOf(error)}` }
      }
      return { data: { id, title } }
    },

    restoreBuiltin(id: string): Result<SkillRecord> {
      const factory = BUILTIN_SKILLS.find((skill) => skill.id === id)
      if (factory === undefined) return { error: `只有内置技能可以恢复出厂：「${id}」` }
      return write(factoryRecord(factory))
    },

    restoreBuiltins(): { restored: string[] } {
      const restored: string[] = []
      for (const skill of BUILTIN_SKILLS) {
        if (write(factoryRecord(skill)).error !== undefined) continue
        restored.push(skill.id)
      }
      return { restored }
    },

    /**
     * 覆盖层 seed（r10 AC-20 的**唯一保证点**），三态：
     *  - 文件缺失 → 写出完整 md（frontmatter + 出厂正文）；
     *  - 存在但缺 frontmatter（r7 落盘的老文件）→ **只前置 frontmatter，正文一个字节不动**；
     *  - 已有 frontmatter → 完全不碰（否则用户改过的正文会在重启时被复活）。
     */
    seed(): void {
      try {
        mkdirSync(dir, { recursive: true })
      } catch (error) {
        warn(`技能目录创建失败（${dir}）：${messageOf(error)}`)
        return
      }
      for (const skill of BUILTIN_SKILLS) {
        const path = pathOf(skill.id)
        if (!existsSync(path)) {
          const result = write(factoryRecord(skill))
          if (result.error !== undefined) warn(result.error)
          continue
        }
        let text: string
        try {
          text = readFileSync(path, 'utf8')
        } catch (error) {
          warn(`技能文件读取失败（${path}）：${messageOf(error)}`)
          continue
        }
        if (hasFrontmatter(text)) continue
        // 只前置 frontmatter：`text` 原样跟在后面，用户改过的正文因此保持逐字不变。
        const parsed = parseSkillFile(`${skill.id}.md`, text)
        const header = renderFrontmatter({
          id: skill.id,
          title: parsed.title,
          description: parsed.description,
          source: 'builtin',
          updatedAt: 0,
        })
        try {
          writeFileSync(path, `${header}${normalizeText(text)}`, 'utf8')
        } catch (error) {
          warn(`技能 frontmatter 补齐失败（${path}）：${messageOf(error)}`)
        }
      }
    },
  }
}

/**
 * 解析一个技能 md（frontmatter 只认 `id/title/description/source/updatedAt` 五个键）。
 *
 * 不引 yaml 解析器：frontmatter 是我们自己渲染的 5 行 `key: value`，行扫描既够用又不会
 * 因为一个缩进错误把整份技能读没。缺 frontmatter（r7 老文件）时按正文派生：
 * id = 文件名、title = 首个 `# ` 行、description = 首个非空非标题行、source 由出厂清单判定。
 */
export function parseSkillFile(fileName: string, text: string): ParsedSkillFile {
  const stem = fileName.replace(/\.md$/i, '')
  const normalized = normalizeText(text)
  const split = splitFrontmatter(normalized)
  const meta = split.meta
  const id = (meta.get('id') ?? '').trim() === '' ? stem : (meta.get('id') ?? '').trim()
  const factory = isBuiltinSkill(id)
  const heading = firstHeading(split.body)
  const title = field(meta, 'title') ?? heading ?? stem
  const description = field(meta, 'description') ?? truncate(firstParagraph(split.body) ?? title, LEGACY_DESCRIPTION_MAX)
  const rawSource = field(meta, 'source')
  const source: SkillSource = factory
    ? 'builtin'
    : rawSource === 'imported' || rawSource === 'system' || rawSource === 'manual'
      ? rawSource
      : 'manual'
  const rawUpdatedAt = Number(field(meta, 'updatedAt') ?? '')
  return {
    id,
    title,
    description,
    source,
    updatedAt: Number.isFinite(rawUpdatedAt) ? rawUpdatedAt : 0,
    body: split.body,
    hasFrontmatter: split.hasFrontmatter,
  }
}

/** 渲染成落盘文本：frontmatter 五键顺序固定（便于人眼 diff 与 grep 断言）。 */
export function renderSkillFile(record: SkillRecord): string {
  return `${renderFrontmatter(record)}${normalizeText(record.body).trimEnd()}\n`
}

/**
 * 标题 → id（小写、非 `[a-z0-9]` 折成连字符、压缩重复、截 32 字）。
 *
 * 中文标题会整段折成连字符，最终落成 `skill`/`skill-2` 这种可读性一般的 id；
 * 这是刻意取舍：id 只用于文件名与引用，可读性由 `title` 承担，且 id 一旦落盘就不能再变
 * （角色 `skillIds` 引用的是它）。
 */
export function slugifySkillTitle(title: string): string {
  const slug = (title ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '')
  return slug === '' ? 'skill' : slug
}

function normalizeText(text: string): string {
  return (text ?? '').replace(/\r\n?/g, '\n')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function truncate(text: string, max: number): string {
  const value = text.trim()
  return value.length <= max ? value : value.slice(0, max)
}

function field(meta: Map<string, string>, key: string): string | undefined {
  const value = (meta.get(key) ?? '').trim()
  return value === '' ? undefined : value
}

/** frontmatter 的值必须单行（多行会破坏 `key: value` 解析）。 */
function oneLine(value: string): string {
  return (value ?? '').replace(/\s*\n\s*/g, ' ').trim()
}

function renderFrontmatter(record: {
  id: string
  title: string
  description: string
  source: SkillSource
  updatedAt: number
}): string {
  return [
    '---',
    `id: ${oneLine(record.id)}`,
    `title: ${oneLine(record.title)}`,
    `description: ${oneLine(record.description)}`,
    `source: ${record.source}`,
    `updatedAt: ${record.updatedAt}`,
    '---',
    '',
  ].join('\n')
}

function hasFrontmatter(text: string): boolean {
  return /^---\r?\n/.test(text) && /^---\r?$/m.test(text.slice(4))
}

function splitFrontmatter(text: string): { meta: Map<string, string>; body: string; hasFrontmatter: boolean } {
  const meta = new Map<string, string>()
  if (!/^---\r?\n/.test(text)) return { meta, body: text.trimEnd(), hasFrontmatter: false }
  const lines = text.split('\n')
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index
      break
    }
  }
  if (end === -1) return { meta, body: text.trimEnd(), hasFrontmatter: false }
  for (const line of lines.slice(1, end)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    meta.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  return { meta, body: lines.slice(end + 1).join('\n').trimEnd(), hasFrontmatter: true }
}

function firstHeading(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const match = /^#{1,6}\s+(.+)$/.exec(line.trim())
    if (match !== null) return match[1].trim()
  }
  return undefined
}

function firstParagraph(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const value = line.trim().replace(/^[-*+]\s+/, '').trim()
    if (value === '' || value.startsWith('#')) continue
    return value
  }
  return undefined
}

function deriveDescription(body: string, fallback: string): string {
  return truncate(firstParagraph(body) ?? fallback, LEGACY_DESCRIPTION_MAX)
}
