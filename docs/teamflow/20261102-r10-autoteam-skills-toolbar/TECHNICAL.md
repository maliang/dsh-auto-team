# r10 技术方案 · 工具条选项 / 面板头部 / 头部按钮 / 模型弹层 / 11 角色 / 技能四来源

- 任务夹：`docs/teamflow/20261102-r10-autoteam-skills-toolbar/`
- 基线依赖：`docs/teamflow/20261101-r7-auto-team-panel-roles/`（r9 未落地，不构成行为基线）
- 取代：`20261102-r9-autoteam-toolbar-tab#AC-16`（技能从「内置只读」改为四来源、内置可改）、`#AC-18`（内置角色由「≥10」改为明确的 11 个）
- 上游：本夹 `PRD.md`（30 条 AC）、`DESIGN.md`（411 行，界面逐条）
- 分支：`feat/auto-team-plugin`（不新开分支、不 rebase、不 amend；门禁全绿后由 host 单笔提交）

---

## 0. 一页结论

| 决策点 | 裁决 | 依据 |
|---|---|---|
| 系统技能库读取通道 | **扫目录** `~/.agents/skills/*/SKILL.md`（只读），宿主**没有** skills 服务可注入 | 实测 `grep -abo 'provide("skills"' app.asar` → **0 命中**；DSH 技能库约定即该目录（`skill_manage` 默认目录） |
| 技能元数据落点 | **md frontmatter**（`id/title/description/source/updatedAt`），正文即 frontmatter 之后的全部内容；文件 `<skillsDir>/<id>.md` | 覆盖层本来就写 md（r7 已 seed），frontmatter 是唯一能同时表达「来源 + 用户改过的正文」的载体，且不引入新文件格式 |
| 存量 6 个无 frontmatter 的 md 迁移 | seed 时**只在缺 frontmatter 时前置** frontmatter，**正文一个字节不动**；`modified` 由「正文 sha256 ≠ 出厂 sha256」现算 | 改正文就等于把用户版本覆盖掉（AC-20 明令禁止）；`modified` 现算则历史文件天然正确 |
| 技能正文读取通道 | 复用既有 `GET ${BRIDGE_ROUTE}/memory` 路由，`track=skill&name=<id>`（**路由仍 3 条、PanelAction 仍 15**） | AC-25 形状冻结；`readMemoryFile` 已是「按需读正文」的既有范式 |
| 技能写入通道 | 复用 `saveRole` 动作，载荷加可选 `skills?: SkillMutation[]`（**不新增动作**） | AC-25 + DESIGN §8「技能改动复用 saveRole 载荷与既有读取口」 |
| 模型清单来源 | 宿主 `llm.listProviders()` + `llm.listModels(providerId)`（可选服务，缺失降级），带 TTL 缓存进快照 | 实测 asar 内 `buildModelCatalog` 即这两个方法；`llm` 已在 `OPTIONAL_SERVICES` 白名单 |
| 会话头「收起」 | `slots.ts` 侧解析 `sidebarRight` 服务，逐级 `tabDomain.occurrence(...).tabActions.close()` → `closeIn()` → 失败不翻转 | 实测 `ISidebarRight` 无公开 `closeTab`；且**插槽组件拿不到 hookContext**，只能由持有 `ctx` 的模块执行 |
| 内置技能规模 | **12 条**（补 6 条：前端/后端/UI-UX/运维/安全/数据建模） | AC-21 ≥12 且覆盖五类；12 条让快照投影 ≈1.8KB，远低于 8KB |
| 内置角色 | **11 个**（补 frontend/backend/designer/devops/security） | AC-17 |

形状扩张**只**发生在 `src/shared/types.ts`（第 2.2 节逐项登记），无新增 PanelAction、无新增路由、无新增 `setInterval`。

---

## 1. 数据模型与存储

### 1.1 技能记录（磁盘 = 唯一真相）

落点：`skillsDir(home) = <home>/.dsh/auto-team/skills/<id>.md`（`src/host/paths.ts:skillsDir`，**仓库外**，`git status --porcelain src lib` 必干净 → AC-20）。

文件格式（`renderSkillFile` 逐字产出）：

```
---
id: implementation
title: 实现规范
description: 写实现时的顺序与边界
source: builtin
updatedAt: 1767225600000
---
# 实现规范

正文……
```

- frontmatter 只允许这 5 个键；解析用**行扫描**（不引 yaml 依赖），值取首个 `:` 之后的 trim 内容。
- `body` = frontmatter 结束分隔符之后的全部文本（含 `# 标题` 首行），`trimEnd()` 后入库。
- `source ∈ {builtin, imported, system, manual}`；`builtin` 仅由 `BUILTIN_SKILLS` 判定，**磁盘上写什么都不算数**（防用户手改 frontmatter 把自建技能伪装成内置）。
- `modified` **不落盘**：现算 `sha256(normalize(body)) !== sha256(normalize(builtinSkillBody(id)))`；非 builtin 恒 `false`。`normalize = trimEnd + 统一换行`。
- `updatedAt`：builtin 出厂为 `0`，用户保存时写 `now()`。

历史文件（r7 seed 写的 6 个无 frontmatter 的 md）解析规则：

1. 无 frontmatter → `id` = 文件名去 `.md`；`title` = 首个 `# ` 行（无则文件名）；`description` = 首个非空、非标题行截 60 字；
2. `id` 命中 `BUILTIN_SKILLS` → `source='builtin'`，否则 `source='manual'`（r7 时代只可能内置或手放）；
3. 迁移动作只有一条：seed 时若该文件缺 frontmatter，**前置** frontmatter 并写回，正文原样保留。因此「用户改过的内置技能」迁移后 `modified` 仍为 `true`。

### 1.2 角色（11 个内置）

`BUILTIN_ROLES` 扩到 11，新增 5 个（id/name/skillIds 定死，`duty`/`prompt` 由实现填写且**两两逐字互异**，AC-17）：

| id | name | skillIds |
|---|---|---|
| `pm` | 产品经理 | `prd-writing` |
| `architect` | 架构师 | `architecture`, `data-modeling` |
| `dev` | 高级全栈工程师 | `implementation`, `testing` |
| `qa` | QA 测试工程师 | `testing`, `review` |
| `docs` | 技术文档工程师 | `docs`, `prd-writing` |
| `reviewer` | 评审专家 | `review`, `security-audit` |
| `frontend` | 前端工程师 | `frontend-ui`, `ui-ux-design` |
| `backend` | 后端工程师 | `backend-api`, `data-modeling` |
| `designer` | UI/UX 设计师 | `ui-ux-design`, `frontend-ui` |
| `devops` | DevOps 工程师 | `devops-release`, `implementation` |
| `security` | 安全审计师 | `security-audit`, `review` |

内置技能 12 条（id 定死，正文覆盖前端/后端/UI-UX/运维/安全五类，AC-21 用标题+正文关键词断言）：
`prd-writing`、`architecture`、`implementation`、`testing`、`docs`、`review`（沿用 r7 正文）＋ `frontend-ui`、`backend-api`、`ui-ux-design`、`devops-release`、`security-audit`、`data-modeling`（新增，每条正文 ≥15 行、含该领域的具体检查项）。

### 1.3 模型清单视图（宿主缓存，非持久化）

```ts
interface ModelOption { provider: string; providerName: string; model: string; modelName: string }
interface ModelCatalogView { status: 'loading' | 'ready' | 'empty'; options: ModelOption[]; reason?: string }
```

- 来源：`optionalService(ctx,'llm')` 的 `listProviders()` → 逐 provider `await listModels(id)`；单个 provider 抛错只计入 `reason`，不整批失败。
- 上限 `MODEL_CATALOG_MAX = 120` 条，超出写 `reason='仅显示前 120 个模型'`（快照每 2s 轮询一次，不能无限膨胀）。
- 缓存 TTL `MODEL_CATALOG_TTL_MS = 60_000`；`snapshot()` 只读缓存，过期则**后台 fire-and-forget 刷新**，下一次轮询拿到新值（`snapshot` 是同步 API，不能 await）。

### 1.4 系统技能（只读扫描，不入库）

```ts
interface SystemSkillInfo { name: string; description: string }   // 快照投影，无正文
```

扫 `<home>/.agents/skills/*/SKILL.md`：frontmatter `name`/`description` 缺失时回退「目录名 / 首个非空正文行」。目录不存在 → `{skills: [], reason: '本机没有系统技能库（~/.agents/skills 不存在）'}`。单条解析失败跳过并计数，不整批失败。**只读，绝不写该目录。**

---

## 2. 类型契约（`src/shared/types.ts`，形状扩张逐项登记）

### 2.1 新增/修改

```ts
// ① 新：技能来源与草稿
export type SkillSource = 'builtin' | 'imported' | 'system' | 'manual'

export interface SkillDraft {
  id?: string                 // 有 = 改已有；无 = 新建
  title: string
  description: string
  body: string                // source==='system' 时可为空串，由宿主按 systemName 读盘补
  source: SkillSource
  systemName?: string         // source==='system'：系统技能库里的原始名（AC-18「记原始名」）
}

export type SkillMutation =
  | { op: 'save'; skill: SkillDraft }
  | { op: 'delete'; id: string }
  | { op: 'restoreBuiltin'; id: string }

// ② 改：技能投影扩两字段（仍不含正文）
export interface SkillInfo {
  id: string
  title: string
  description: string
  source: SkillSource        // 新增
  modified: boolean          // 新增
}

// ③ 新：模型清单
export interface ModelOption { provider: string; providerName: string; model: string; modelName: string }
export interface ModelCatalogView { status: 'loading' | 'ready' | 'empty'; options: ModelOption[]; reason?: string }

// ④ 改：快照加两个可选字段（客户端不做缺省推断，缺省即「宿主没给」）
export interface PanelSnapshot {
  /* …既有字段不动… */
  skills?: SkillInfo[]               // 既有，语义改为「仓储投影」
  modelCatalog?: ModelCatalogView    // 新增
  systemSkills?: SystemSkillInfo[]   // 新增
}

// ⑤ 改：saveRole 载荷扩张（**PanelAction 成员数仍 15**）
export type PanelAction =
  | /* …其余 14 种不动… */
  | { type: 'saveRole'; role?: Role; skills?: SkillMutation[] }
```

`role` 与 `skills` 至少给一个；两者都给时**先应用技能、再保存角色**（角色可引用刚建的技能）。

### 2.2 形状扩张登记表（AC-25 要求逐项登记）

| # | 位置 | 扩张 | 计数影响 |
|---|---|---|---|
| 1 | `SkillInfo` | +`source` +`modified` | 无（投影仍 3→5 字段，仍不含正文） |
| 2 | `PanelSnapshot` | +`modelCatalog?` +`systemSkills?` | 无 |
| 3 | `PanelAction.saveRole` | +`skills?: SkillMutation[]`，`role` 变可选 | **成员数 15 不变** |
| 4 | 新类型 | `SkillSource`/`SkillDraft`/`SkillMutation`/`ModelOption`/`ModelCatalogView`/`SystemSkillInfo` | 无 |

**不新增**：`PanelAction` 成员、`ActivityEvent.kind`（9）、HTTP 路由（3）、`setInterval(`（1，仅 `src/host/team/watcher.ts`）、四个冻结常量。

### 2.3 共享常量（`src/shared/const.ts`，client/host 共用）

```ts
export const SKILL_BODY_MAX = 20_000        // 正文上限（超限拒绝，AC-19/DESIGN M5）
export const SKILL_TITLE_MAX = 80
export const SKILL_DESCRIPTION_MAX = 200
export const SKILL_LIST_LIMIT = 200         // 技能条数上限（防快照膨胀）
```

---

## 3. 仓储层

### 3.1 新文件 `src/host/roles/skills-repo.ts`

为什么单独成文件：技能是**独立于角色的磁盘实体**（四来源、可增删改、有 frontmatter 与覆盖层语义），塞进已有 337 行的 `roles/repo.ts` 会让「角色 JSON 仓储」与「技能 md 仓储」两套写盘策略缠在一起；独立后可用 mkdtemp 单测全部落盘语义，不依赖宿主。

```ts
export interface SkillRecord {
  id: string; title: string; description: string; body: string
  source: SkillSource; modified: boolean; updatedAt: number
}
export interface SkillRepoDeps { dir: string; now: () => number; warn?: (message: string) => void }

export interface SkillRepo {
  list(): SkillRecord[]                                  // 内置(按 BUILTIN_SKILLS 序) → imported → system → manual，组内按 title
  projection(): SkillInfo[]                              // 快照投影：不含 body（AC-19）
  get(id: string): SkillRecord | undefined
  readBody(id: string): Result<string>                   // 按需读正文（编辑弹层）
  save(draft: SkillDraft): Result<SkillRecord>           // 新建/更新；撞名自动加 -2/-3 后缀
  remove(id: string): Result<{ id: string; title: string }>   // builtin 拒删
  restoreBuiltin(id: string): Result<SkillRecord>        // 内置恢复出厂（正文回 BUILTIN_SKILLS，modified 归 false）
  restoreBuiltins(): { restored: string[] }              // 全量恢复出厂；**不动用户三源技能**
  seed(): void                                           // 缺失则写内置 md；缺 frontmatter 则前置（不动正文）
}
export function createSkillRepo(deps: SkillRepoDeps): SkillRepo
export function parseSkillFile(fileName: string, text: string): ParsedSkillFile
export function renderSkillFile(record: SkillRecord): string
export function slugifySkillTitle(title: string): string   // 小写、非 [a-z0-9] 折 -、去重连字符、截 32、空则 'skill'
```

关键规则：
- `save` 校验：`title/description/body` 非空（`body` 上限 `SKILL_BODY_MAX`、`title` ≤ `SKILL_TITLE_MAX`、`description` ≤ `SKILL_DESCRIPTION_MAX`）；`source==='builtin'` 只允许改**已有 builtin id**，不允许新建 builtin。
- 撞名：`id` 已存在且 `draft.id` 未给出 → `id-2`、`id-3`…；`draft.id` 给出则视为更新，**不加后缀**（AC-19「撞名加后缀不静默覆盖」）。
- `remove('builtin-id')` → `{error:'内置技能不可删除：只能「恢复出厂」'}`；不存在 → `{error:'技能不存在：「<id>」'}`（AC-23 可读原因）。
- `readBody` 对不存在 id 返回可读 error（编辑弹层据此显示「正文读取失败：…」+ 重试）。
- `seed()`：`mkdir -p dir`；对每个 `BUILTIN_SKILLS`，文件不存在 → 写完整 md（含 frontmatter）；存在但缺 frontmatter → 前置 frontmatter 后写回（**正文零改动**）；存在且已有 frontmatter → **不碰**（AC-20「重启 seed 不覆盖」）。

### 3.2 新文件 `src/host/roles/system-skills.ts`

```ts
export interface SystemSkillEntry { name: string; description: string; body: string; dir: string }
export interface SystemSkillScan { skills: SystemSkillEntry[]; reason?: string }
export interface SystemSkillSource { scan(): SystemSkillScan }
export function createSystemSkillSource(deps: { dir: string; warn?: (m: string) => void }): SystemSkillSource
```

`scan()` 每次现扫（目录只有个位数条目，无缓存必要）；`readdirSync(dir, {withFileTypes:true})` 过滤目录 → 读 `SKILL.md` → 解析 frontmatter。任何 I/O 异常都收敛成 `reason`，不抛。

### 3.3 改 `src/host/roles/builtin.ts`

- `BUILTIN_SKILLS` 6 → **12**（§1.2）。
- `BUILTIN_ROLES` 6 → **11**（§1.2）。
- 新增 `export function isBuiltinSkill(skillId: string): boolean`。
- `composeSkillPrompt(role, bodyOf = builtinSkillBody)`：**加可选正文解析器**，宿主传盘上正文（否则改过的内置技能永远进不了成员提示词，AC-29 的「重启后读回」就只是界面假象）。

### 3.4 改 `src/host/roles/repo.ts`

- 删除内置技能 md 的 seed 逻辑（迁到 `skills-repo.seed()`），`RoleRepoDeps.skillsDir` **保留**（既有测试与调用面不破）但不再使用 → 标注 `@deprecated 技能落盘已移交 createSkillRepo`，避免一次性改爆 `test/roles.test.ts` 的 `withRepo` 夹具。
- `ROLES_SCHEMA_VERSION` 2 → **3**：触发一次 backfill（补新增 5 个内置角色的磁盘文件），既有内置角色文件只在 migrate 时 backfill 缺键，**不覆盖用户改过的字段**（沿用 r7 的 `backfill` 语义）。
- `restoreDefaults()` 仍只写 `BUILTIN_ROLES`（技能由 `skills-repo.restoreBuiltins()` 负责），返回 `{restored, kept}` 不变。

### 3.5 改 `src/host/paths.ts`

```ts
export function systemSkillsDir(home: string): string   // `${trimSlash(home)}/.agents/skills`
```

纯函数、不读 env（沿用本文件纪律）。

---

## 4. 宿主 API 设计

### 4.1 HTTP 路由（仍 **3 条**，无新增）

| 方法 | 路径 | 参数 | 返回 |
|---|---|---|---|
| GET | `/api/auto-team/snapshot` | `sessionId?` | `Result<PanelSnapshot>` |
| GET | `/api/auto-team/memory` | `track` ∈ `public\|project\|**skill**`、`name`、`sessionId?` | `Result<{track,name,body,chars}>`（`track='skill'` 时 `name` 是技能 id，返回 `{track:'skill',name:id,body,chars}`） |
| POST | `/api/auto-team/act` | `{sessionId, action}` | `Result<ActResult>` |

`src/host/http.ts` 只加一个分支：`track === 'skill'` → `bridge.readSkillBody(name)`，其余原样。三条路由的注册条数不变（`test/host-contract.test.ts` 的「routes.length === 3」继续成立）。

### 4.2 Bridge（`src/host/bridge.ts`）

```ts
export interface Bridge {
  /* …既有 8 个方法不动… */
  /** r10：按需读技能正文（编辑弹层用，正文不进快照）。 */
  readSkillBody(id: string): Promise<Result<{ id: string; title: string; body: string; chars: number }>>
}

export interface BridgeDeps {
  /* …既有必填… */
  skills: SkillRepo                                   // 新增必填
  systemSkills?: SystemSkillSource                    // 新增可选（缺省=系统技能入口给可读说明）
  modelCatalog?: () => ModelCatalogView               // 新增可选（缺省=status:'empty' + reason）
}
```

改动点：

1. `skillsOf()` → `deps.skills.projection()`（不再只读 `BUILTIN_SKILLS` 常量）。
2. `snapshot()` 追加 `modelCatalog: deps.modelCatalog?.() ?? {status:'empty', options:[], reason:'宿主未提供模型清单'}`、`systemSkills: deps.systemSkills?.scan().skills ?? []`（`systemSkills` 为空且带 reason 时也把 reason 塞进 `modelCatalog` 式说明——见 4.3 的 UI 契约：系统技能弹层从 `[data-skill-picker-empty]` 显示原因，原因随 `systemSkillsReason` 一起下发）。
3. `act()` 的 `saveRole` 分支：
   ```
   if (action.skills?.length) { const r = applySkillMutations(action.skills); if (!r.ok) return reject('BAD_REQUEST', r.error, sessionId) }
   if (action.role) { 既有校验 + deps.roles.save(action.role) }
   if (!action.role && !action.skills?.length) return reject('BAD_REQUEST', 'saveRole 需要角色或技能变更', sessionId)
   ```
   `applySkillMutations` 逐条执行并汇总 notices：
   - `save` → `deps.skills.save(draft)`；`source==='system'` 且 `body` 为空 → 先 `deps.systemSkills.scan()` 按 `systemName` 找正文，找不到 → `系统技能已不存在：「<name>」`。
   - `delete` → `deps.skills.remove(id)`，成功后**遍历全部角色**，把该 id 从 `skillIds` 摘除并 `deps.roles.save(...)`，记 `stripped` 计数 → notice `已删除『<title>』，并从 <N> 个角色摘除引用`（N=0 时给「未被任何角色引用」，AC-23 逐字要求含 N）。
   - `restoreBuiltin` → `deps.skills.restoreBuiltin(id)` → notice `已把『<title>』恢复为出厂正文`。
4. `restoreDefaultRoles` 分支：
   ```
   const roleRes = deps.roles.restoreDefaults()
   const skillRes = deps.skills.restoreBuiltins()
   ```
   notices 三条（顺序固定）：`已恢复 <N> 个内置角色（名称/描述/提示词/技能/模型全部回到内置值）`、`已把 <M> 条内置技能恢复为出厂正文（已修改标记清除）`、`你的 <K> 条自建/导入/系统技能与 <J> 个自建角色未受影响`（`K/J` 为 0 时给「没有…」，AC-22 要求数字真实、范围说清）。
5. `readSkillBody(id)`：`deps.skills.readBody(id)` 包成 `Result`，成功附 `title`（弹层标题用）。

### 4.3 装配层（`src/host/index.ts`）

```ts
const skills = createSkillRepo({ dir: skillsDir(home), now, warn })
try { skills.seed() } catch (e) { warn(...) }            // 与 roles.seed() 同级：失败只 warn 不阻断
const systemSkills = createSystemSkillSource({ dir: systemSkillsDir(home), warn })
const catalog = createModelCatalogCache({ read: () => readModelCatalog(ctx), now, ttlMs: MODEL_CATALOG_TTL_MS })
void catalog.refresh(true)                                // 启动即预热一次
bridge = createBridge({ /* … */, skills, systemSkills, modelCatalog: () => catalog.view() })
// 成员提示词必须读到盘上正文：
buildMemberPrompt(input, { memoryFor: (g) => bridge.memoryFor(g), skillBodyOf: (id) => skills.get(id)?.body ?? '' })
```

### 4.4 新文件 `src/host/model-catalog.ts`

为什么单独成文件：`snapshot()` 是同步 API，模型清单是异步的，必须有「同步读缓存 + 后台刷新」这一层；把它写成可注入 `read`/`now` 的纯逻辑模块，才能在 `node --test` 里用假时钟断言 TTL 与降级，不必起宿主。

```ts
export interface ModelCatalogCacheDeps {
  read: () => Promise<{ groups: { id: string; name: string; models: { id: string; name: string }[] }[]; failures: { id: string; name: string; message: string }[]; reason?: string }>
  now: () => number
  ttlMs: number
  limit?: number        // 缺省 MODEL_CATALOG_MAX
}
export interface ModelCatalogCache { view(): ModelCatalogView; refresh(force?: boolean): Promise<void> }
export function createModelCatalogCache(deps: ModelCatalogCacheDeps): ModelCatalogCache
```

`view()`：缓存为空 → `status:'loading'` 且**触发一次**后台刷新；过期 → 触发后台刷新并返回旧值（stale-while-revalidate）；`options` 非空 → `'ready'`，空但有 reason → `'empty'`。刷新失败 → `status:'empty'` + `reason`（文案形如 `宿主未提供模型清单：<原因>`）。

### 4.5 改 `src/host/adapters.ts`

`llm` 服务面扩写（仍只经 `optionalService(ctx,'llm')` 读取，`OPTIONAL_SERVICES` 白名单**不变**）：

```ts
llm?: {
  resolveCallConfig?(input: unknown, signal?: AbortSignal): Promise<unknown>
  listProviders?(): unknown                                   // [{ id, name }]
  listModels?(providerId: string): Promise<unknown>           // [{ id, name, description? }]
}
export async function readModelCatalog(ctx: HostContext): Promise<ModelCatalogRaw>
```

`readModelCatalog` 在 `listProviders`/`listModels` 缺失时返回 `{groups: [], failures: [], reason: '宿主未提供模型清单（llm 服务不可用）'}`，**不抛**。

### 4.6 改 `src/host/team/member-prompt.ts`

`MemberPromptDeps` 加 `skillBodyOf?: (skillId: string) => string`；第 28 行改 `composeSkillPrompt(role, deps.skillBodyOf)`。缺省仍回退 `builtinSkillBody`（`test/member-prompt.test.ts` 的既有断言不破）。

### 4.7 改 `src/host/config.ts`

新增（不触碰四个冻结常量）：

```ts
export const MODEL_CATALOG_MAX = 120
export const MODEL_CATALOG_TTL_MS = 60_000
```

---

## 5. 前端组件与页面拆分

四个挂载面不变（选项 / 会话头按钮 / 右栏页签 body+title / 设置页 section），只换槽位名与内容。

| 文件 | 改动 | 对应 AC |
|---|---|---|
| `client/slots.ts` | `INPUT_DOCK_SLOT` → **`INPUT_LEFT_SLOT = 'conversation.input.left'`**（旧名删除）；`createPanelCommands(ctx)` 提供 open/close/isOpen；`registerSlots` deps 加 `closePanel` | AC-1/2/8/11/24 |
| `client/Option.tsx` | 删 `data-option-error` 与 `role=alert`；`data-option-dot` 加 `data-tone`；失败态只改点/描边 + `title`/`aria-label` | AC-3/5/6/7 |
| `client/HeaderButton.tsx` | 三分支 toggle（open / close / 回退），`aria-pressed` 非乐观 | AC-11/13 |
| `client/Panel.tsx` | `[data-panel-head]` 压到 3 子节点；新增 `[data-panel-meta]` 三组；`[data-error]` 承接工具条失败原因 | AC-9/10/15 |
| `client/ui.ts` | `optionView` label 逐字「自动团队」+ `dotTone`/`failure`；`headerButtonView` 加 `opened`；新增 `skillRowView`/`skillSourceLabel`/`modelPickerLabel`/`restoreConfirmView` | AC-3/6/11/16/19/22 |
| `client/RoleEditor.tsx` | 角色卡：模型字段换弹层；技能区换四来源列表 + 三入口 + 删除/恢复出厂；恢复默认换对话框 | AC-16~23 |
| `client/ModelPicker.tsx`（新） | 模型弹层（搜索 + 列表 + 回填 + 手填折叠区） | AC-16 |
| `client/SkillDialogs.tsx`（新） | 技能编辑弹层 + 系统技能多选弹层（都 `createPortal`） | AC-18/19/20/23 |
| `client/tabs/RolesTab.tsx` | 透传 `modelCatalog`/`systemSkills`/`readSkill`，`onSave(role, skills?)` | AC-18 |
| `client/SettingsPage.tsx` | 同上（`density="page"` 共用同一链） | AC-18 |
| `client/api.ts` | `readSkill(sessionId, id)` 打既有 memory 路由 `track=skill` | AC-19 |
| `client/state.ts` | 无结构性改动（`act` 载荷类型自动变宽） | — |
| `client/styles.ts` | 全部新样式（唯一 owner，见任务拆分） | AC-3/9/10/14/16 |

### 5.1 选项（M1）

`optionView(input)` 返回 `{hook, label:'自动团队', ariaLabel, pressed, state, dotTone:'neutral'|'warn', failure?}`：
- `label` **逐字**「自动团队」（AC-3），状态语义全进 `ariaLabel`（如「自动团队：运行中 2/5 任务」）；
- 失败：`dotTone='warn'`、`failure='操作失败：<原因摘要>'`，渲染时 `title` 与 `aria-label` 同文（AC-6 要求二者都含「操作失败」）；
- `data-error-state` = `failure ? 'true' : 'false'`（**始终输出**，便于断言「非失败时为 false」）。

`Option.tsx` 渲染树：`span[data-auto-team-option][role=switch][data-state][data-enabled][data-error-state]` > `span[data-option-dot][data-tone][aria-hidden]` + `span[data-option-label]` + （busy）`span[data-option-spinner]`。**没有第三块文本节点**（AC-5：`[data-option-error]` 计数 0）。

### 5.2 会话头按钮（M2）

`createPanelCommands(ctx)`：

```ts
export interface PanelCommands {
  open(sessionId: string): boolean
  close(sessionId: string): boolean
  isOpen(sessionId: string): boolean | undefined
}
```

- `open`：既有 `right.openTab(PANEL_TAB_KIND)`（服务缺失 → `false`）。
- `close` 逐级：
  1. `const tabs = right.tabsIn?.(sessionId) ?? []`，找 `kind === PANEL_TAB_KIND` 的 tab → `right.tabDomain.occurrence(sessionId, tab).tabActions.close()` → `true`；
  2. `typeof right.closeIn === 'function'` → `right.closeIn(sessionId, tabId)` → `true`；
  3. 都不可用 → `false`（组件**不翻转** `aria-pressed`，`title` 给「收起失败：宿主未提供关闭入口」，同时 `window.dispatchEvent(new CustomEvent(PANEL_CLOSE_EVENT))` 供面板自己兜底切页）。
- `isOpen`：`right.tabsIn(sessionId)` 里是否存在本插件 kind（同步内存读，成本可忽略）；服务缺失 → `undefined`。

`HeaderButton` 的 `pressed = panelOpen?.(sessionId) ?? localOpened`；`toggle()` 只在命令返回 `true` 后才更新本地态（AC-11 非乐观）。

### 5.3 面板头部（M3）

```
[data-panel-head]              ← 恰好 3 个直接子节点
  [data-panel-title]  [data-head-capsule]  …  button[data-panel-refresh]
[data-panel-meta]              ← 恰好 3 组（+2 个 [data-meta-sep] aria-hidden）
  span[data-meta-plan]  span[data-captain-model]  span[data-auto-team-degraded]
[data-panel-progress-row]      ← 原样（完成 d/t + 计划状态 + 暂停按钮）
```

「计划 N · 成员 M · 并发 r/l」只出现在 `[data-meta-plan]`；`captainModelLabelOf` 只出现在 `[data-captain-model]`；`degraded` 只出现在 `[data-auto-team-degraded]`（AC-9「同类信息 1 处」）。320px 下 `[data-panel-meta]` 允许折两行，三组**都必须可见**（AC-10 禁 `display:none` 冒充）。

### 5.4 角色卡（M4）

`RoleEditorList` props 扩张（面板与设置页共用同一签名）：

```ts
export interface RoleEditorListProps {
  roles: Role[]
  skills: SkillInfo[]
  density: 'panel' | 'page'
  busy: boolean
  modelCatalog?: ModelCatalogView          // 新增
  systemSkills?: SystemSkillInfo[]         // 新增
  systemSkillsReason?: string              // 新增：系统技能库不可用时的可读原因
  readSkill?: (id: string) => Promise<Result<SkillBodyPayload>>   // 新增：按需读正文
  onSave: (role: Role | undefined, skills?: SkillMutation[]) => void   // 签名加宽
  onDelete: (roleId: string) => void
  onRestoreDefaults: () => void
}
```

技能区渲染顺序与徽标严格照 DESIGN §2.5；`skillRowView(skill, selected)` 是**纯函数**（hook/标题/说明/来源标签/动作集合），供 `test/client-ui.test.ts` 断言「builtin 无 delete 只有 restore、用户三源无 restore 只有 delete」（AC-23）。

### 5.5 三个弹层（全部 `createPortal` + Esc + 焦点回归）

1. `ModelPicker`：`button[data-role-model-picker]` + `[data-role-model-popover]`（搜索 → `[data-model-option]` 列表 → 选中回填）。**卡片内不得出现 `[data-role-model-provider]`/`[data-role-model-name]`**（AC-16 计数 0）；手填兜底在 `[data-role-model-manual]` 折叠区，hook 改名 `[data-model-manual-provider]`/`[data-model-manual-model]`。
2. `SkillEditDialog`：打开即 `readSkill(id)`（骨架 → textarea 固定 200px 内滚）；失败 → 「正文读取失败：<原因>」+ 重试按钮，**绝不渲染空 textarea**；`[data-skill-builtin-hint]` 在 builtin 时必显。
3. `SystemSkillPicker`：多选 + 搜索 + `[data-skill-picker-count]`；未选时导入键 disabled；无匹配 / 目录缺失各有可读文案。

导入本地 md 用隐藏 `<input type="file" data-skill-import-input accept=".md,text/markdown">` + `FileReader`，正文随 `SkillMutation.save` 一起上送（≤`SKILL_BODY_MAX`，无需新路由）。

---

## 6. 状态管理

- **单一数据源仍是快照轮询**：`createPanelStore` 不动（单 `setTimeout` 递归、单飞、可见性暂停、`act` 成功后把返回快照写回本地）。新增字段自动随快照到达，客户端不做缺省推断（缺字段 = 宿主没给，渲染「加载中/不可用」而不是假装有值）。
- **技能正文与系统技能正文都不进快照**：编辑弹层打开时按需 `readSkill(id)`；系统技能导入时宿主现读盘。因此快照体积与 r7 同量级（技能投影 12 条 ≈1.8KB < 8KB，AC-20）。
- **非乐观**：选项 toggle、头部开合、技能保存、恢复出厂、恢复默认全部「先发请求 → 成功才更新本地/由快照带回」，busy 期只置 `aria-busy`（AC-7/AC-11/AC-22）。
- **草稿保护**：沿用 r7 的 `signature` 机制（角色内容签名不变就不重置草稿），技能草稿同理用 `id + updatedAt` 作签名。
- **失败提示分工**（AC-6/AC-15）：工具条侧只留 `title`/`aria-label` + 琥珀点；面板 `[data-error]` 显示同因文案；`hintOf(feedback)` 仍是文案唯一出处（不新造词）。

---

## 7. 关键实现点与边界

| AC | 实现点 | 边界/易错 |
|---|---|---|
| AC-1/2 | `slots.ts` 常量改名 + E1 `{name:INPUT_LEFT_SLOT,id:OPTION_ID,order:5,inject}` | 注释里也不许再出现 `conversation.input.dock`（grep 计数含注释） |
| AC-3 | `optionView.label='自动团队'`；根选择器六属性写进 `styles.ts` | 禁用 `font-size: var(--dsw-font…)`，必须 `font: var(...)` 简写 |
| AC-5/6 | 删错误文本节点；失败只改 `data-tone`/描边/`title` | 失败色用琥珀，**不得**用 `--dsw-alias-state-error-primary` |
| AC-9/10 | 头部 3 子节点 + meta 3 组 | 三组不许用 `display:none`；320px 折行 |
| AC-11 | `PanelCommands.close` 三级回退 | 三级都失败时**不翻转** `aria-pressed` |
| AC-16 | 模型弹层；裸 provider/name 输入框计数 0 | 手填字段必须改名，否则 AC-16 计数断言红 |
| AC-17 | 11 角色 name/duty/prompt 两两互异 | `restoreDefaults` 只写内置、自建 sha256 不变 |
| AC-18 | 三入口 + `systemName` 让宿主补正文 | 系统技能 id 冲突时加后缀，title 记原始名 |
| AC-19 | frontmatter + 投影不带正文 | 撞名加后缀；`modified` 不落盘 |
| AC-20 | 覆盖层在 `~/.dsh/auto-team/skills/`；seed 不覆盖 | `git status --porcelain src lib` 必须干净（正文绝不进仓库） |
| AC-21 | 12 条内置技能，正文含五类关键词 | 三字段非空且互异 |
| AC-22 | `restoreDefaultRoles` 连带 `restoreBuiltins()` | 用户三源技能 sha256 不变；二次确认文案含真实数字 |
| AC-23 | `remove` 拒 builtin + bridge 摘引用 | notice 必须含「N 个角色」 |
| AC-24 | `INPUT_DOCK_SLOT` → `INPUT_LEFT_SLOT`；测试总数 ≥426 | 改名要连测试断言值一起改 |
| AC-25 | 形状冻结 | 不新增 PanelAction/路由/`setInterval`/四常量 |

**其它边界**：
- `saveRole` 里 `role` 变可选 → 所有既有调用点（RolesTab/SettingsPage/测试）编译期不受影响，但 bridge 必须显式拒绝「两者都空」。
- 删技能摘引用要在**同一请求内**完成（先删技能再写角色），否则下一轮快照会短暂出现悬空 `skillIds`。
- 恢复出厂把 `modified` 归零靠「正文回出厂 + 现算 hash」，不需要额外字段。
- `llm` 服务缺失是**正常降级**（不是错误）：模型弹层给 `[data-model-empty]` + 手填兜底。
- 系统技能目录不存在是**正常降级**：给可读说明，不抛。

---

## 8. 测试策略

### 8.1 单测（`node --test test/*.test.ts`，基线 426 例必须继续全绿）

| 文件 | 新增/改动断言 |
|---|---|
| `test/skills-repo.test.ts`（新） | seed 写 12 条 md；缺 frontmatter 时**正文不变**只前置；用户改过正文 → `modified=true` 且 seed 再跑不覆盖；`save` 撞名加 `-2`；`save` 超长正文拒绝；`remove` 拒 builtin、可删用户技能；`restoreBuiltin` 回出厂且 `modified=false`；`restoreBuiltins` 不动用户三源技能（sha256）；`projection()` 不含 body 且总量 <8KB |
| `test/system-skills.test.ts`（新） | 临时目录造 2 个 `SKILL.md` → 解析 name/description；缺 frontmatter 回退目录名；目录不存在 → `reason` 可读；坏文件跳过不整批失败 |
| `test/model-catalog.test.ts`（新） | 假 `read`+假时钟：首次 `view()` 为 `loading` 且只触发一次刷新；ready 后 TTL 内不重复刷；过期返回旧值并后台刷；`read` 抛错 → `empty` + reason；超过 limit 截断并给 reason |
| `test/roles.test.ts` | 内置角色 ==11、name/duty/prompt 两两互异、skillIds 1–2；`restoreDefaults` 覆盖 11 个且自建 sha256 不变（沿用既有断言风格） |
| `test/bridge.test.ts` | `saveRole` 带 `skills:[save]` 建技能后可被角色引用；`delete` 摘除引用并给含 N 的 notice；`restoreDefaultRoles` 三条 notice 且用户技能 sha256 不变；快照 `skills` 带 `source`/`modified` 且**无 body**；`readSkillBody` 成功/不存在两种返回 |
| `test/host-contract.test.ts` | 路由仍 3 条；`track=skill` 走 `readSkillBody`；`PanelAction` 成员 15、`ActivityEvent.kind` 9、四常量各 1、`setInterval(` 1 处；`OPTIONAL_SERVICES` 不变 |
| `test/member-prompt.test.ts` | 注入 `skillBodyOf` 后，改过的内置正文进 prompt（而非出厂正文） |
| `test/client-contract.test.ts` | `INPUT_LEFT_SLOT === 'conversation.input.left'`、`INPUT_DOCK_SLOT` 已删；注册字段集合；`PanelCommands` 三级回退各一条；`data-option-error` 计数 0 |
| `test/client-ui.test.ts` | `optionView` label 逐字「自动团队」、失败 `dotTone='warn'` + ariaLabel 含「操作失败」；`headerButtonView` 三分支文案；`skillRowView` 的 builtin/user 动作集合；`restoreConfirmView` 数字来自入参；`modelPickerLabel` 空/有值 |

### 8.2 变异必红（AC-6/10/22 明令）

- 把失败态的 `title` 去掉「操作失败」→ AC-6 断言必红；
- 把 `[data-panel-meta]` 三组之一改成 `display:none` → AC-10 断言必红；
- 把 `restoreDefaultRoles` 里的 `restoreBuiltins()` 删掉 → AC-22 断言必红（内置 `modified` 不归零）；
- 把 `skillsOf()` 改回读常量 → 「改过的正文进 prompt / 快照带 modified」必红。

### 8.3 门禁与真机

```bash
pnpm typecheck
pnpm test                       # tests ≥426、fail 0
pnpm build
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis\.patch\.yml'
find src -name '*.ts*' -newer lib/index.js | wc -l    # 必须 0
grep -rn "from '\.\./host/" src/client | wc -l        # 必须 0
grep -rn 'workspace:' package.json | wc -l            # 必须 0
grep -c "conversation.input.dock" src/client/slots.ts # 必须 0
grep -rn 'data-option-error' src | wc -l              # 必须 0
git status --porcelain src lib                        # 必须干净（技能落盘在仓库外）
```

真机 5 项（AC-12~15、AC-29）按 `docs/teamflow/architecture/REAL-HOST-VERIFY.md` 在第二宿主（克隆 profile + 端口 51890）执行，**只许主 agent 跑**；环境起不来如实记「未验证」。探针落 `logs/teamflow/<runId>/scripts/r10-*.mjs`，一律 `new URL('../../../../', import.meta.url)` 锚定仓库根。

---

## 9. 任务拆分（按文件边界，未派发任务清单）

依赖图：`T1 → (T2 ∥ T3) → T4 → T5 → T6`。`styles.ts` 与 `ui.ts` 被 T3/T4 共用 → 二者必须**串行**（T3 在前，T4 在 T3 合并后的基础上追加）。

### T1 · 宿主数据层：12 技能 / 11 角色 / 技能仓储 / 系统技能扫描
- 文件（改）：`src/shared/types.ts`、`src/shared/const.ts`、`src/host/roles/builtin.ts`、`src/host/roles/repo.ts`、`src/host/paths.ts`
- 文件（新）：`src/host/roles/skills-repo.ts`、`src/host/roles/system-skills.ts`、`test/skills-repo.test.ts`、`test/system-skills.test.ts`
- 测试（改）：`test/roles.test.ts`
- 契约：§2、§3 全部签名逐字；`ROLES_SCHEMA_VERSION=3`；seed 只前置 frontmatter 不动正文
- 验收：`node --test test/skills-repo.test.ts test/system-skills.test.ts test/roles.test.ts` 全绿；`grep -c 'source: SkillSource' src/shared/types.ts` ≥1；`node -e` 断言 `BUILTIN_ROLES.length===11 && BUILTIN_SKILLS.length===12`

### T2 · 宿主装配层：Bridge / 路由 / 模型清单 / 提示词
- 依赖：T1
- 文件（改）：`src/host/bridge.ts`、`src/host/http.ts`、`src/host/adapters.ts`、`src/host/index.ts`、`src/host/team/member-prompt.ts`、`src/host/config.ts`
- 文件（新）：`src/host/model-catalog.ts`、`test/model-catalog.test.ts`
- 测试（改）：`test/bridge.test.ts`、`test/host-contract.test.ts`、`test/member-prompt.test.ts`
- 契约：§4 全部；路由 3 条不变、PanelAction 15 不变、`setInterval` 不新增
- 验收：`node --test test/bridge.test.ts test/host-contract.test.ts test/member-prompt.test.ts test/model-catalog.test.ts` 全绿；`grep -c "routes.length" test/host-contract.test.ts` ≥1 且断言仍为 3；`grep -rn "setInterval(" src | wc -l` == 1

### T3 · 客户端工具条与面板头部（AC-1~11）
- 依赖：T1（`SkillInfo`/`ModelCatalogView` 类型）
- 文件（改）：`src/client/slots.ts`、`src/client/Option.tsx`、`src/client/HeaderButton.tsx`、`src/client/Panel.tsx`、`src/client/ui.ts`、`src/client/styles.ts`、`test/client-contract.test.ts`
- 契约：`INPUT_LEFT_SLOT`、`PanelCommands`、`optionView`/`headerButtonView` 签名；`data-option-error`/`data-role-model-provider`/`data-role-model-name` 全项目 0 处（后者在 T4 才真正删，但 T3 不许新增）
- 验收：`node --test test/client-contract.test.ts test/client-ui.test.ts` 全绿；`grep -c "conversation.input.dock" src/client/slots.ts` == 0；`grep -rn 'data-option-error' src | wc -l` == 0；`grep -c "data-panel-meta" src/client/Panel.tsx` ≥1

### T4 · 客户端角色与技能 UI（AC-16~23）
- 依赖：T2、T3
- 文件（改）：`src/client/RoleEditor.tsx`、`src/client/tabs/RolesTab.tsx`、`src/client/SettingsPage.tsx`、`src/client/api.ts`、`src/client/ui.ts`、`src/client/styles.ts`
- 文件（新）：`src/client/ModelPicker.tsx`、`src/client/SkillDialogs.tsx`
- 测试（改）：`test/client-ui.test.ts`
- 契约：§5.4/§5.5；`RoleEditorListProps` 逐字；技能变更随 `saveRole` 上送
- 验收：`node --test test/client-ui.test.ts` 全绿；`grep -rn 'data-role-model-provider\|data-role-model-name' src | wc -l` == 0；`grep -c 'data-role-model-picker' src/client/ModelPicker.tsx` ≥1；`grep -c 'createPortal' src/client/SkillDialogs.tsx` ≥2

### T5 · 交付自检（不写 QA-REPORT/ACCEPTANCE）
- 依赖：T4
- 文件：无固定归属（发现即就地修，改动落在所属任务的文件里）
- 内容：跑 §8.3 全部命令 + 4 条变异必红；`pnpm test` 总数 ≥426；修掉发现的问题并记录结论
- 验收：§8.3 命令全绿 + `git status --porcelain --untracked-files=all` 只剩预期文档/日志

### T6 · git 收口（由主 agent 执行，成员不得自行提交）
- 依赖：T5
- 内容：确认门禁全绿后**单笔提交**；不新开分支、不 rebase、不 amend；提交后不再改任何文件；4 处既有未提交改动（memory.md + r8/r9/r10 三个任务夹）随本笔一并入库
- 验收：`git log --oneline -1` 含 r10 描述 + `git status --porcelain --untracked-files=all` 为空

---

## 10. 风险与未验证项

| 风险 | 处置 |
|---|---|
| `sidebarRight.tabsIn`/`closeIn`/`tabDomain` 属「非公开面」（宿主注释：Not part of `ISidebarRight`） | 三级回退 + 失败不翻转；真机 AC-13 连点三态是唯一验收依据；若真机三级全失败，如实记「收起未生效」，不得改判 AC 为通过 |
| `llm.listProviders/listModels` 的实际返回形状未在本机宿主上实测 | 解析按宽松归一（`id`/`name` 缺失跳过），失败降级为 `empty` + reason；真机 AC-16 验一次 |
| `POST /act` 载荷变宽（技能正文 ≤20KB） | 沿用既有 JSON body 解析；`SKILL_BODY_MAX` 在宿主与客户端双重校验 |
| 12 条技能正文与 11 个角色 prompt 需逐字互异 | 由 T1 单测断言（两两互异 + 非空），不靠人眼 |
| 快照体积 | 技能投影 <8KB、模型清单 ≤120 条，均有单测断言 |
| 真机 5 项 | 环境起不来记「未验证」，不得以 mock 结论替代 |
