/**
 * 角色库：`<home>/.dsh/auto-team/roles/<id>.json` 一角色一文件。
 *
 * 规则（AC-15/AC-16）：
 *  - 内置角色首次启动 seed，之后**可改不可删**；
 *  - 用户自建角色可改可删；
 *  - 每角色可指定模型（provider/model/reasoningEffort），未指定时走会话默认路由。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { Role, RoleModelRoute } from '../../shared/types.ts'
import { BUILTIN_ROLES, BUILTIN_SKILLS } from './builtin.ts'

const ROLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

export interface RoleRepoDeps {
  dir: string
  skillsDir: string
  now: () => number
}

export interface RoleRepo {
  list(): Role[]
  get(id: string): Role | undefined
  save(role: Role): { ok: true; role: Role } | { ok: false; error: string }
  remove(id: string): { ok: true } | { ok: false; error: string }
  seed(): void
}

export function createRoleRepo(deps: RoleRepoDeps): RoleRepo {
  const { dir, skillsDir, now } = deps

  const pathOf = (id: string): string => `${dir}/${id}.json`

  function read(id: string): Role | undefined {
    const path = pathOf(id)
    if (!existsSync(path)) return undefined
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Role>
      if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') return undefined
      return {
        id: parsed.id,
        name: parsed.name,
        duty: parsed.duty ?? '',
        skillIds: Array.isArray(parsed.skillIds) ? parsed.skillIds : [],
        // 落盘文件可能被手改：模型字段同样要过归一（脏 provider/model 不许进派发链路，AC-22）。
        model: normalizeModel(parsed.model),
        builtin: parsed.builtin === true,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      }
    } catch {
      // 文件损坏不应让整个角色列表消失：跳过该条，由面板显示「该角色文件损坏」入口缺失。
      return undefined
    }
  }

  function write(role: Role): void {
    mkdirSync(dir, { recursive: true })
    writeFileSync(pathOf(role.id), `${JSON.stringify(role, null, 2)}\n`, 'utf8')
  }

  return {
    /** 内置角色永远出现在列表里（即便文件被删），保证「可改不可删」的语义。 */
    list(): Role[] {
      const seen = new Map<string, Role>()
      for (const role of BUILTIN_ROLES) seen.set(role.id, { ...role })
      if (existsSync(dir)) {
        for (const entry of readdirSync(dir)) {
          if (!entry.endsWith('.json')) continue
          const role = read(entry.slice(0, -'.json'.length))
          if (role) seen.set(role.id, role)
        }
      }
      return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id))
    },

    get(id: string): Role | undefined {
      return read(id) ?? BUILTIN_ROLES.find((role) => role.id === id)
    },

    save(role: Role): { ok: true; role: Role } | { ok: false; error: string } {
      const id = (role.id ?? '').trim().toLowerCase()
      if (!ROLE_ID_PATTERN.test(id)) {
        return { ok: false, error: `角色 id 不合法：只允许小写字母数字与连字符（收到「${role.id}」）` }
      }
      const name = (role.name ?? '').trim()
      if (name === '') return { ok: false, error: '角色名称不能为空' }
      if (id === 'captain') return { ok: false, error: 'captain 是队长保留 id，不能作为角色' }

      const existing = read(id)
      const builtin = existing?.builtin ?? BUILTIN_ROLES.some((item) => item.id === id)
      // 逐角色模型：只填一半时**报错**而不是静默退回会话默认（用户会以为设定已生效，AC-22）。
      const verdict = validateModel(role.model)
      if (!verdict.ok) return { ok: false, error: verdict.error }
      const next: Role = {
        id,
        name,
        duty: (role.duty ?? '').trim(),
        skillIds: [...new Set(role.skillIds ?? [])],
        model: verdict.model,
        builtin,
        updatedAt: now(),
      }
      write(next)
      return { ok: true, role: next }
    },

    remove(id: string): { ok: true } | { ok: false; error: string } {
      if (BUILTIN_ROLES.some((role) => role.id === id) || read(id)?.builtin) {
        return { ok: false, error: `内置角色不可删除：「${id}」（可以修改或清除模型指定）` }
      }
      const path = pathOf(id)
      if (!existsSync(path)) return { ok: false, error: `角色不存在：「${id}」` }
      rmSync(path)
      return { ok: true }
    },

    /** 首次启动把内置角色与技能 md 落盘（已存在的不覆盖，保护用户编辑）。 */
    seed(): void {
      mkdirSync(dir, { recursive: true })
      mkdirSync(skillsDir, { recursive: true })
      for (const role of BUILTIN_ROLES) {
        if (!existsSync(pathOf(role.id))) write({ ...role, updatedAt: now() })
      }
      for (const skill of BUILTIN_SKILLS) {
        const path = `${skillsDir}/${skill.id}.md`
        if (!existsSync(path)) writeFileSync(path, `${skill.body}\n`, 'utf8')
      }
    },
  }
}

/** provider/model 的合法形态：非空、且不含任何空白字符（宿主路由按字符串精确匹配）。 */
const MODEL_TOKEN_PATTERN = /^\S+$/
const EFFORTS: ReadonlyArray<NonNullable<RoleModelRoute['reasoningEffort']>> = ['low', 'medium', 'high']

function pickToken(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  return value === '' || !MODEL_TOKEN_PATTERN.test(value) ? undefined : value
}

/**
 * 模型指定归一（宽松口径，只用于**读盘**）：
 * 落盘文件可能被手改，任何不完整/非法的组合都视为「跟随会话默认」，不让角色因此消失。
 * 写入判定走 validateModel（要报错给用户，不能静默回退，AC-22）。
 */
export function normalizeModel(raw: unknown): RoleModelRoute | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const candidate = raw as Partial<RoleModelRoute>
  const provider = pickToken(candidate.provider)
  const name = pickToken(candidate.model)
  if (provider === undefined || name === undefined) return undefined
  const effort = candidate.reasoningEffort
  const route: RoleModelRoute = { provider, model: name }
  if (effort === 'low' || effort === 'medium' || effort === 'high') route.reasoningEffort = effort
  return route
}

/**
 * 模型指定校验（严格口径，用于**写入**）：
 *  - 两者都空 = 跟随会话默认（合法）；
 *  - 只填一个 = 报错（否则用户以为指定了模型，实际仍在队长模型上跑，是 AC-22 的静默回退）；
 *  - 含空白字符 = 报错（宿主路由解析不了，派发后才发现就晚了）；
 *  - reasoningEffort 只接受 low/medium/high。
 */
export function validateModel(
  raw: unknown,
): { ok: true; model?: RoleModelRoute } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true }
  if (typeof raw !== 'object') return { ok: false, error: '模型指定必须是对象（provider / model）' }
  const candidate = raw as Partial<RoleModelRoute>
  const provider = typeof candidate.provider === 'string' ? candidate.provider.trim() : ''
  const name = typeof candidate.model === 'string' ? candidate.model.trim() : ''
  if (provider === '' && name === '') return { ok: true }
  if (provider === '' || name === '') {
    const missing = provider === '' ? 'provider' : 'model'
    const filled = provider === '' ? `model=${name}` : `provider=${provider}`
    return {
      ok: false,
      error: `模型指定不完整：缺 ${missing}（当前只填了 ${filled}）。要跟随会话默认请两个都留空`,
    }
  }
  if (!MODEL_TOKEN_PATTERN.test(provider)) {
    return { ok: false, error: `provider 不能包含空白字符（收到「${provider}」）` }
  }
  if (!MODEL_TOKEN_PATTERN.test(name)) {
    return { ok: false, error: `model 不能包含空白字符（收到「${name}」）` }
  }
  const effort = candidate.reasoningEffort
  if (effort !== undefined && effort !== null && !EFFORTS.includes(effort)) {
    return {
      ok: false,
      error: `reasoningEffort 只接受 ${EFFORTS.join(' / ')}（收到「${String(effort)}」）`,
    }
  }
  const route: RoleModelRoute = { provider, model: name }
  if (effort === 'low' || effort === 'medium' || effort === 'high') route.reasoningEffort = effort
  return { ok: true, model: route }
}
