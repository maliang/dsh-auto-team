/**
 * 系统技能库（r10 AC-19）：只读扫描 `<home>/.agents/skills/<目录>/SKILL.md`。
 *
 * 为什么是扫目录而不是问宿主：**宿主没有 skills 服务**（`provide("skills")` 实测 0 命中），
 * 没有可注入的读取口；`~/.agents/skills` 就是 DSH 技能库的约定落点（`skill_manage` 默认目录）。
 *
 * 三条自我约束：
 *  - **只读**：这里绝不写任何文件（写进别人的库里等于污染宿主资产）；
 *  - **单条坏文件跳过**：一条坏 SKILL.md 不能把整批扫描打成异常，更不能让面板连角色一起读不出来；
 *  - **目录缺失给可读 reason**：`empty` 与「还没扫」在界面上必须长得不一样。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'

/** 系统技能库的一条：正文随扫描带上（选入时前端拿它做导入副本，不必再来一次请求）。 */
export interface SystemSkillEntry {
  name: string
  description: string
  body: string
  /** 该技能所在的目录（排障用；不参与界面展示）。 */
  dir: string
}

export interface SystemSkillScan {
  skills: SystemSkillEntry[]
  /** 库不可用时的可读原因（目录缺失、目录不可读）；可用时为 undefined。 */
  reason?: string
}

export interface SystemSkillSource {
  scan(): SystemSkillScan
}

export interface SystemSkillSourceDeps {
  /** `<home>/.agents/skills`（由 `host/paths.ts#systemSkillsDir` 派生）。 */
  dir: string
  warn?: (message: string) => void
}

const SKILL_FILE = 'SKILL.md'

export function createSystemSkillSource(deps: SystemSkillSourceDeps): SystemSkillSource {
  const { dir } = deps
  const warn = (message: string): void => deps.warn?.(message)

  return {
    scan(): SystemSkillScan {
      if (!existsSync(dir)) {
        return { skills: [], reason: `本机没有系统技能库（${dir} 不存在）` }
      }
      let entries: string[] = []
      try {
        entries = readdirSync(dir)
      } catch (error) {
        return { skills: [], reason: `系统技能库不可读（${dir}）：${messageOf(error)}` }
      }
      const skills: SystemSkillEntry[] = []
      for (const name of entries) {
        if (name.startsWith('.')) continue
        const skillDir = `${dir}/${name}`
        const file = `${skillDir}/${SKILL_FILE}`
        if (!existsSync(file)) continue
        let text: string
        try {
          text = readFileSync(file, 'utf8')
        } catch (error) {
          // 单条读失败只跳过并记一条 warn，不整批失败（权限/半截文件都不该让面板空掉）。
          warn(`系统技能跳过（${file}）：${messageOf(error)}`)
          continue
        }
        const parsed = parseSystemSkill(text)
        skills.push({
          name: parsed.name ?? name,
          description: parsed.description ?? firstParagraph(parsed.body) ?? name,
          body: parsed.body,
          dir: skillDir,
        })
      }
      skills.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
      return { skills }
    },
  }
}

/** 取 frontmatter 的 `name` / `description`（没有 frontmatter 时都缺省，由调用方回退）。 */
export function parseSystemSkill(text: string): { name?: string; description?: string; body: string } {
  const normalized = (text ?? '').replace(/\r\n?/g, '\n')
  if (!/^---\n/.test(normalized)) return { body: normalized.trimEnd() }
  const lines = normalized.split('\n')
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index
      break
    }
  }
  if (end === -1) return { body: normalized.trimEnd() }
  const meta = new Map<string, string>()
  for (const line of lines.slice(1, end)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    meta.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  const name = (meta.get('name') ?? '').trim()
  const description = (meta.get('description') ?? '').trim()
  return {
    name: name === '' ? undefined : name,
    description: description === '' ? undefined : description,
    body: lines.slice(end + 1).join('\n').trimEnd(),
  }
}

function firstParagraph(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const value = line.trim().replace(/^[-*+]\s+/, '').trim()
    if (value === '' || value.startsWith('#')) continue
    return value.length <= 60 ? value : value.slice(0, 60)
  }
  return undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
