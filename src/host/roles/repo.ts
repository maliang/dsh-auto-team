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
import { ROLE_PROMPT_MAX } from '../config.ts'
import { BUILTIN_ROLES } from './builtin.ts'

const ROLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

/**
 * 角色落盘模式版本（只服务于 seed() 的**一次性补齐**）：
 *  - 1 = r6 及以前：角色文件没有 `prompt` 字段；
 *  - 2 = r7：内置角色带 `prompt`；
 *  - 3 = r10：内置角色从 6 个扩到 11 个（多出来的 5 个由 seed 直接落地，老文件不动）。
 *
 * 版本号只升不降：`seed()` 在 `schemaOf() < ROLES_SCHEMA_VERSION` 时才走 backfill，
 * 升到 3 就是为了让既有安装也补一次新字段/新角色，而不是只对全新安装生效。
 */
const ROLES_SCHEMA_VERSION = 3

/** 补齐标记文件名：**不带 .json**，避免被 list()/restoreDefaults() 的 `*.json` 扫描当成角色。 */
const SEED_MARKER = '.seeded'

export interface RoleRepoDeps {
  dir: string
  now: () => number
  /**
   * @deprecated r10 起技能 md 由 `roles/skills-repo.ts` 负责（四来源 + 覆盖层 + frontmatter），
   * 角色库不再写任何技能文件。参数保留只为不打破既有调用方与单测签名。
   */
  skillsDir?: string
}

export interface RoleRepo {
  list(): Role[]
  get(id: string): Role | undefined
  save(role: Role): { ok: true; role: Role } | { ok: false; error: string }
  remove(id: string): { ok: true } | { ok: false; error: string }
  seed(): void
  /**
   * 一键恢复默认角色（r7 AC-8）：**只重写内置 11 个**，自建角色一个字节都不动。
   * 返回 `restored`（被复原的内置 id）与 `kept`（原样保留的自建 id，供界面回执说明）。
   */
  restoreDefaults(): { restored: string[]; kept: string[] }
}

export function createRoleRepo(deps: RoleRepoDeps): RoleRepo {
  const { dir, now } = deps

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
        // 提示词读盘口径宽松（不截断、不报错）：用户手写的超长内容照样能被读出来再改回去。
        prompt: typeof parsed.prompt === 'string' ? parsed.prompt.trim() : undefined,
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

  const markerPath = (): string => `${dir}/${SEED_MARKER}`

  /** 读补齐标记；读不到/损坏一律当 0（= 从未补齐过），宁可多补一次也不漏补。 */
  function schemaOf(): number {
    if (!existsSync(markerPath())) return 0
    try {
      const parsed = JSON.parse(readFileSync(markerPath(), 'utf8')) as { schema?: unknown }
      return typeof parsed.schema === 'number' ? parsed.schema : 0
    } catch {
      return 0
    }
  }

  function markSchema(): void {
    writeFileSync(markerPath(), `${JSON.stringify({ schema: ROLES_SCHEMA_VERSION, at: now() })}\n`, 'utf8')
  }

  /**
   * 给「文件已存在、但缺新字段」的内置角色补字段（r7 升级路径，QA-R7-01）。
   *
   * 只补**磁盘上缺席**的键：已有的键（用户改过的 duty、清空后本就不落盘的 prompt、
   * 单独指定的 model）一个字节都不动 —— 「补齐新字段」与「覆盖用户编辑」是两件事。
   * 返回 false 表示文件损坏读不出来：保留原文件不动，让下一轮启动继续尝试。
   */
  function backfill(path: string, role: Role): boolean {
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    } catch {
      return false
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false
    const defaults: Role = { ...role, updatedAt: now() }
    const merged: Record<string, unknown> = { ...raw }
    let added = false
    for (const [key, value] of Object.entries(defaults)) {
      if (value === undefined) continue
      if (Object.prototype.hasOwnProperty.call(merged, key)) continue
      merged[key] = value
      added = true
    }
    if (added) writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    return true
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

      /**
       * `builtin` **永远由 BUILTIN_ROLES 推导**，绝不从磁盘读（r7 AC-8 的关键判据）。
       *
       * 旧写法 `existing?.builtin ?? …` 允许用户建一个 id 为 `my-role` 的角色、手填
       * `"builtin": true`，于是它既进 `list()` 又被 `remove()` 判成「内置不可删」——
       * 一个自建角色变相获得了删除豁免，而且 `restoreDefaults` 也不会碰它。
       */
      const builtin = BUILTIN_ROLES.some((item) => item.id === id)
      // 逐角色模型：只填一半时**报错**而不是静默退回会话默认（用户会以为设定已生效，AC-22）。
      const verdict = validateModel(role.model)
      if (!verdict.ok) return { ok: false, error: verdict.error }
      const promptVerdict = validatePrompt(role.prompt)
      if (!promptVerdict.ok) return { ok: false, error: promptVerdict.error }
      const next: Role = {
        id,
        name,
        duty: (role.duty ?? '').trim(),
        skillIds: [...new Set(role.skillIds ?? [])],
        model: verdict.model,
        builtin,
        updatedAt: now(),
        // 空提示词不落盘（写成 undefined = 该角色只有技能正文），避免盘上出现 `"prompt": ""`。
        prompt: promptVerdict.prompt,
      }
      if (next.prompt === undefined) delete next.prompt
      write(next)
      return { ok: true, role: next }
    },

    remove(id: string): { ok: true } | { ok: false; error: string } {
      // 只看 BUILTIN_ROLES：`read(id)?.builtin` 是磁盘可伪造的标志，不能作为删除豁免的依据。
      if (BUILTIN_ROLES.some((role) => role.id === id)) {
        return { ok: false, error: `内置角色不可删除：「${id}」（可以修改或清除模型指定）` }
      }
      const path = pathOf(id)
      if (!existsSync(path)) return { ok: false, error: `角色不存在：「${id}」` }
      rmSync(path)
      return { ok: true }
    },

    /**
     * 一键恢复默认（r7 AC-8）：逐字取 `BUILTIN_ROLES`，只写这 6 个文件。
     *
     * 为什么不「删掉 roles/ 再 seed」：那会把用户自建角色一起清掉。
     * 为什么 `updatedAt` 用 `now()` 而不是内置的 0：`0` 会让面板显示「1970 年更新」，
     * 而且与「这次真的写过盘」这件事矛盾（恢复后要能看出动作发生过）。
     */
    restoreDefaults(): { restored: string[]; kept: string[] } {
      const restored: string[] = []
      for (const role of BUILTIN_ROLES) {
        write({ ...role, updatedAt: now() })
        restored.push(role.id)
      }
      const builtinIds = new Set(BUILTIN_ROLES.map((role) => role.id))
      const kept: string[] = []
      if (existsSync(dir)) {
        for (const entry of readdirSync(dir)) {
          if (!entry.endsWith('.json')) continue
          const id = entry.slice(0, -'.json'.length)
          if (builtinIds.has(id)) continue
          kept.push(id)
        }
      }
      return { restored: restored.sort(), kept: kept.sort() }
    },

    /**
     * 首次启动把内置角色落盘（已存在的不覆盖，保护用户编辑）。
     *
     * 升级路径（QA-R7-01）：老版本落盘的文件虽然存在，但可能缺本轮新增的字段
     * （r7 的 `prompt`）。这类文件**只补缺席的键**，且补齐只做一次 ——
     * 标记 `.seeded` 落盘后不再补，否则用户「清空提示词」会被下次启动悄悄复活。
     *
     * r10：技能 md 的 seed 已迁到 `roles/skills-repo.ts#seed`（那里还要处理
     * 「老文件缺 frontmatter 只前置、正文零改动」），本函数**不再写任何技能文件**。
     */
    seed(): void {
      mkdirSync(dir, { recursive: true })
      const migrate = schemaOf() < ROLES_SCHEMA_VERSION
      let migrated = true
      for (const role of BUILTIN_ROLES) {
        const path = pathOf(role.id)
        if (!existsSync(path)) {
          write({ ...role, updatedAt: now() })
          continue
        }
        if (migrate && !backfill(path, role)) migrated = false
      }
      // 有文件损坏时不落标记：下一轮启动重试，别把「没补上」记成「已补齐」。
      if (migrate && migrated) markSchema()
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

/**
 * 角色提示词校验（r7 AC-7，写入用）：
 *  - 缺席/空白 = 合法（返回 `prompt: undefined`，盘上不写这个键）；
 *  - 非字符串 = 报错（面板把整个 role 对象回传，类型错必须被拦住而不是静默塞进 JSON）；
 *  - 超长 = 报错而不是截断（截断会让用户以为保存成功，实际丢了后半段）。
 */
export function validatePrompt(
  raw: unknown,
): { ok: true; prompt?: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true }
  if (typeof raw !== 'string') return { ok: false, error: '角色提示词必须是文本' }
  const prompt = raw.trim()
  if (prompt === '') return { ok: true }
  if (prompt.length > ROLE_PROMPT_MAX) {
    return { ok: false, error: `角色提示词最多 ${ROLE_PROMPT_MAX} 字符（收到 ${prompt.length}）` }
  }
  return { ok: true, prompt }
}
