# r23 记忆策展（Memory Curation）设计冻结

- 任务：`t1`（架构师）
- 日期：2026-11-10
- 状态：**冻结**。`t2`（宿主/纯逻辑）与 `t3`（面板）按本文实现，不再改形状；实现中发现与本文冲突，先回报队长，不在代码里另开一套。
- 任务夹：`docs/teamflow/2026-11-10-r23-memory-curation/`
- 验收命令（t1 实际执行并记录退出码）：

```bash
test -s docs/teamflow/2026-11-10-r23-memory-curation/DESIGN.md \
  && grep -q PROJECT_MAX_FILES docs/teamflow/2026-11-10-r23-memory-curation/DESIGN.md
```

---

## 0. 一句话结论

把「每次 run 写一个 `run-*.md`、整文件注入」改成「**按主题的条目库**」：条目有三级（P0/P1/P2）、有来源与修正次数、按规范化正文 hash 判重；文件数由主题目录硬限制（项目 8、公共 6），单文件 40 条；注入按 **P0 → P1 → P2** 再按相关性挑条目，旧 `run-*.md` 不再进入注入，只能由「整理」命令一次性提炼失败教训进 `pitfalls.md`。

---

## 1. 目标与非目标

### 1.1 目标（t2/t3 必须交付）

1. 新纯模块 `src/host/memory/entries.ts`：条目解析、渲染、路由、判重、upsert、supersede、淘汰，全部为纯函数（无 fs、无宿主 API）。
2. 记忆文件从「自由文件」收敛为**主题目录**：项目 8 个主题、公共 6 个主题，文件名 = `<topic>.md`。
3. `auto_team_memory` 的 `write` 支持 `importance` / `topic` / `supersedes`，`read`/`list` 返回结构化条目视图。
4. 自动沉淀不再新建 `run-*.md`：失败的 run 把失败证据写成 `pitfalls` 的 **P1** 条目，通过的門禁命令去重写成 `commands` 的 **P2** 条目；没有失败就不写 `pitfalls`。
5. 注入改为条目级选择：预算内 **P0 优先，再按相关性**；已作废条目永不注入；旧 `run-*.md` / `lessons-*.md` 永不注入。
6. 「整理旧流水」命令：从旧 `run-*.md` / `lessons-*.md` 提炼失败证据，**只追加**到 `pitfalls.md`，支持 `--dry-run`，可重复执行且第二次 `added=0`。
7. 面板（t3）：显示 `项目记忆 N/8`、总条数、每文件等级分布、可展开条目、已作废条目的删除线、以及「整理旧流水」按钮（dry-run 预览 → 执行）。

### 1.2 非目标

- 不做向量检索/embedding；相关性仍是关键词命中（沿用 `inject.ts:94` 的 `keywords`）。
- 不删除任何旧文件；`run-*.md` 永远保留原样可读。
- 不新增 HTTP 路由（沿用 r13 决定，见 `src/host/http.ts:10-13`）；整理走现有 `POST /act`。
- 不改变自动团队的成员/任务状态机；只改记忆的落盘与读取。
- 不做跨工作区合并；项目记忆仍按 `resolvedMemoryLocation` 解析（`src/host/bridge.ts:1224` 附近），不新增第二套落点解析。

---

## 2. 现状证据（2026-11-10 工作树，行号可直接复核）

| 现状 | 证据 | 对本次的含义 |
|---|---|---|
| 旧文件格式 `- [pm/t2 · 10-30 14:02] 文本` | `src/host/memory/repo.ts:177 formatSourcedLine` | 被 `renderEntry` 取代；旧行按 P1 兼容解析，内容不丢 |
| 每任务最多追加 20 行 | `src/host/memory/repo.ts:201 appendMemoryLines`；`src/host/config.ts:34 MEMORY_LINES_PER_TASK=20` | 新写入改为条目 upsert，不再按「行数」截断 |
| 文件级注入，排序 = 项目轨 → 标题命中 → 正文相关 → 更新时间 → 文件名 | `src/host/memory/inject.ts:309 memoryIndexOf`、`:356 selectMemory` | 改为条目级 `selectMemoryEntries`，P0 优先 |
| 自动沉淀每次终态 run 写 `run-<stem>.md`；公共轨失败才写 `lessons-<stem>.md` | `src/host/memory/auto.ts:113 projectMemoryNameOf`、`:225 projectMemoryOf`、`:298 publicMemoryOf`、`:332 runMemoryOf` | 新终态 run 不再写文件；`runMemoryOf` 仅留给回填/兼容 |
| 失败判定：任务 failed / 返工 >1 次 / 门禁 exitCode 为 null 或非 0 | `src/host/memory/auto.ts:195 failureOf` | 失败教训 P1 的输入不变 |
| 注入预算 4000 字符、单条内联 ≤200、关联 ≤3 | `src/host/config.ts:31/122/125` | 常量保留；条目内联沿用 200 |
| 展开 ID 仅 `mem://<track>/<stem>`，整文件返回 | `src/host/memory/expand.ts:81 parseMemoryId`、`:119 createExpander` | 扩展 `#<12hex>` 条目 ID；无 `#` 行为不变 |
| 快照记忆 `files` 是 `MemoryFileInfo[]`（只有文件名/字符数/时间） | `src/shared/types.ts:812`、`:382` | 改为 `MemoryFileView[]` + `quotas` + `legacyFileCount` |
| 面板动作 18 条，无「整理」 | `src/shared/types.ts:1045` 注释、`:1065` | 新增 `curateMemory`，动作数 19，注释同步 |
| 工具写记忆直接覆盖整文件（`saveMemory`） | `src/host/tools.ts:766` 调 `bridge.act({type:'saveMemory'})`；`src/host/bridge.ts:2338` | 工具写入改走条目 API；面板 `saveMemory` 保留为「手工逃生口」 |
| 项目里已有约 20 个 `run-*.md` | `<repo>/.auto-team/memory` 实测 | 新注入会直接忽略它们，面板用 `legacyFileCount` 明示；需一键整理 |

---

## 3. 数据模型与目录布局

### 3.1 轨道与目录

- 轨道：`MemoryTrack = 'public' | 'project'`（`src/shared/types.ts:377`，不变）。
- 项目目录：`<workspace>/.auto-team/memory/`（由 `resolvedMemoryLocation` 解析，沿用 r22）。
- 公共目录：`roots.publicDir`（宿主 profile 级，跨项目共享）。
- 一个目录内只有三类文件：

| 类别 | 命名 | 可写 | 进注入 | 计入文件配额 | 说明 |
|---|---|---|---|---|---|
| 主题文件（canonical） | `<topic>.md`，topic ∈ 目录（项目 8 / 公共 6） | 是（插件唯一写入口） | 是 | 是 | 唯一真值；headings + 条目 |
| 杂项文件（misc） | 其他合法 `.md`，如 `tuoluojiang-conventions.md` | 否（只读） | 是 | 否 | 兼容手写；每行按 P1 解析 |
| 旧流水（legacy） | `run-*.md` / `lessons-*.md`（两轨都排除） | 否 | **否** | **否** | 只给「整理」读；永不删除 |

> canonical 判定用**精确文件名** `name === `${topic}.md``；`Pitfalls.md` 这类大小写变体按 misc 只读处理，不静默改名。

### 3.2 主题目录（唯一真值）

项目 8 个，**顺序即 UI 展示顺序**：

| id | 标题 | 说明 |
|---|---|---|
| `conventions` | 团队约定 | 默认落点；命名/提交/协作约定 |
| `architecture` | 架构与契约 | 模块边界、依赖方向、共享类型 |
| `commands` | 构建与门禁命令 | 已验证可用的命令 |
| `pitfalls` | 失败与教训 | 自动沉淀的失败证据、返工教训 |
| `workflow` | 流程与协作 | 派发/评审/计划/角色/记忆流程 |
| `ui` | 界面与样式 | 面板、槽位、字体/字号、布局 |
| `host` | 宿主集成 | 宿主 API、inject、事件、profile |
| `domain` | 业务与项目 | 产品需求、领域数据、工作区 |

公共 6 个：`conventions`、`architecture`、`commands`、`pitfalls`、`workflow`、`host`。

公共轨的降级规则（只用于**自动路由**，不用于显式 `topic`）：

- `ui` → `workflow`
- `domain` → `architecture`

理由：公共轨不带项目 UI/业务细节，但「UI 流程」「业务架构」仍可复用；显式传不允许的 topic 直接拒绝，避免静默改写用户意图。

### 3.3 文件内部结构（逐字）

```md
# 失败与教训

- [P1] 门禁 `pnpm test` 失败（退出码 1）：...（来源：系统 · 11-10 17:20 · 修正 1）
- [P2] 已验证命令：`pnpm typecheck`（来源：系统 · 11-10 17:20 · 修正 1）

## 已作废

- ~~[P1] 旧结论（来源：qa/t2 · 11-09 10:00 · 修正 2）~~
```

硬性规则：

1. 第一行必须是 `# <主题标题>`；随后一个空行；然后是活动条目，每条一行。
2. 活动条目全部渲染完后，若有 tombstone，追加一个空行 + `## 已作废`，每条一行。
3. 不写二级标题（`## 已作废` 除外）、不写代码围栏、不写列表续行。
4. 文件末尾保留一个 `\n`。
5. `renderEntryFile(topic, entries)` 是唯一渲染入口；禁止在 repo/bridge/tool 里拼字符串。

### 3.4 文件数量配额是结构性的

主题目录的 size 就是配额（项目 8、公共 6），插件**不会创建目录外的主题文件**。因此：

- `files`（已存在的 canonical 文件数）天然 `<= maxFiles`；
- `overFiles` 只是防御式断言（目录被手工塞了第 9 个 canonical 名时置 true），不用于常规路径；
- 文件满时不是「再开一个文件」，而是**淘汰条目**（§7）。

---

## 4. 条目：逐字格式、解析、渲染

### 4.1 活动条目（唯一合法字面量）

```text
- [P1] 文本（来源：role/task · MM-DD HH:mm · 修正 N）
```

逐字约束：

| 片段 | 取值 | 备注 |
|---|---|---|
| 前缀 | `- ` | 一个半角连字符 + 一个半角空格 |
| 等级 | `[P0]` / `[P1]` / `[P2]` | 大写 P + 一位数字 |
| 文本 | 单行；去除首尾空白；不得以完整的 `（来源：…）` 结尾 | 内部可有全角括号；长度 ≤ `MEMORY_ENTRY_TEXT_MAX=500` |
| 来源前缀 | `（来源：` | **全角**左括号 + `来源：`（全角冒号） |
| 来源 | `role/task`、`role`、`队长`、`系统`、`手写` | 不能含 ` · `、全角括号、换行；`role/task` 的 task 可省 |
| 分隔 | ` · ` | 空格 + U+00B7 + 空格 |
| 时间 | `MM-DD HH:mm` | 本地时区；月/日/时/分均两位补零 |
| 修正 | ` 修正 N）` | 空格 + `修正` + 空格 + 十进制 N + **全角**右括号；`1 <= N <= 9999999` |

示例（测试夹具必须逐字相等）：

```text
- [P1] 门禁 `pnpm test` 失败（退出码 1）（来源：系统 · 11-10 17:20 · 修正 1）
- [P0] 禁止在 host/client 之间直接 import（来源：队长 · 11-08 09:30 · 修正 3）
- [P2] 已验证命令：`pnpm typecheck`（来源：系统 · 11-10 17:20 · 修正 1）
```

### 4.2 已作废条目（tombstone）

```text
- ~~[P1] 文本（来源：role/task · MM-DD HH:mm · 修正 N）~~
```

- 外层 `- ~~` 与结尾 `~~` 是标记；内部与 §4.1 完全同构。
- tombstone **保留原文与来源**，只用于审计；永不注入、永不计入 40 条上限、可被同一 hash 的 upsert 复活（§6.4）。
- 不允许手工只写 `~~` 不写内部来源；解析失败按 §4.4 兼容为 P1 活动条目（内容不丢）。

### 4.3 旧格式（兼容输入，不是输出）

```text
- [pm/t2 · 10-30 14:02] 旧结论正文
```

- 由 `repo.ts:177 formatSourcedLine` 产生；新代码**不再生成**。
- 解析为：`level=P1`、`source=pm/t2`、`at=<按 §4.5 推断的 10-30 14:02>`、`text=旧结论正文`、`revisions=1`。
- 任何「不是新格式、也不是旧格式」的非空、非结构行（例如 `tuoluojiang-conventions.md` 里的自由 bullet）：
  - `level=P1`
  - `source=手写`
  - `at=fallbackAt`（文件 mtime；取不到用 `now`）
  - `text=去掉行首 \`- \` / \`* \` / \`+ \` 后的整行`
- **不丢内容**是硬约束：一个文件里任何非空正文行，要么成为条目，要么被明确判定为结构行（heading/分隔线/围栏标记）。

### 4.4 解析规则（`parseEntryFile`）

逐行处理，`lineIndex` 从 0 开始：

1. 空行（`trim() === ''`）→ 跳过，`counts.blank++`。
2. 匹配 `/^#{1,6}\s+/` 的 heading → 跳过，`counts.headings++`；`## 已作废` 之后的条目 `superseded=true`。
3. 匹配 `/^(```|~~~)/` 的围栏标记 → 跳过（围栏内部行仍按普通行解析，不做代码语义）。
4. 匹配 `^---+$` / `^\*\*\*+$` 的分隔线 → 跳过。
5. 先尝试 tombstone：`^- ~~\[(P0|P1|P2)\] ...~~$`；成功则解析内部，`superseded=true`。
6. 再尝试新格式活动条目（完整正则见 §4.6）；成功则 `counts.formatted++`。
7. 再尝试旧格式（`acceptLegacy !== false` 时）；成功则 `counts.legacySourced++`、`level=P1`。
8. 其余非空行：`counts.compat++`、`level=P1`、`source=手写`、`at=fallbackAt`，`text=stripListMarker(line)`。
9. 新格式行的时间非法（月份/日期/时分越界）→ **整行按兼容行处理**（P1、`source=手写`、`at=fallbackAt`），不丢弃。
10. `revisions` 非法（0、负、>9999999、非数字）→ 同样整行按兼容行处理。
11. 每条的 `hash = entryHash(text)`；同一文件内重复 hash 全部保留（渲染时由上层决定），但注入与 upsert 按 hash 去重。

### 4.5 时间解析与年份推断

- 格式：`/^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/`。
- 校验：月 1–12，日 1–31，时 0–23，分 0–59；用 `new Date(year, month-1, day, hour, minute)` 回读四个字段必须完全一致（拒绝 2 月 30 日这类）。
- 年份推断：先取 `now` 的本地年份 `Y`，构造 `Y-MM-DD HH:mm`；若结果 `> now + 24h`，改用 `Y-1`（跨年条目不会跑到未来）。
- 同一文件里只有 `MM-DD`，没有年份；推断错误可接受（只影响排序 tie-break，不影响判重与内容）。
- `formatEntryStamp(at)`：本地时区，`MM-DD HH:mm`，全部两位补零。

### 4.6 正则（唯一实现，t2 照抄）

```ts
const LEVEL_RE = /^(P0|P1|P2)$/
const STAMP_RE = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/

const NEW_ENTRY_RE =
  /^-\s+\[(P0|P1|P2)\]\s+(.+?)（来源：([^·（）\n]+?)\s+·\s+(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s+·\s+修正\s+(\d{1,7})）$/

const TOMBSTONE_RE =
  /^-\s+~~\[(P0|P1|P2)\]\s+(.+?)（来源：([^·（）\n]+?)\s+·\s+(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s+·\s+修正\s+(\d{1,7})）~~$/

const LEGACY_SOURCED_RE =
  /^-\s+\[([^\]·\n]+?)\s+·\s+(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\]\s*(.*)$/
```

注意：

- `（来源：` 与结尾 `）` 都是全角；`·` 是 U+00B7，不是 `•`、不是 `・`。
- 文本捕获用非贪婪 `(.+?)`，因为后面锚定了完整来源后缀；正文里出现半截「来源：」不会被误切。
- 来源捕获禁止 `·`、全角括号、换行；解析后还要用 `^[^ ·（）\n]+(?:/[^ ·（）\n]+)?$` 复核，避免 `role/task/extra` 这类歧义。

### 4.7 纯函数签名（`src/host/memory/entries.ts`）

```ts
import type { MemoryLevel, MemoryTrack, MemoryTopicId } from '../../shared/types.ts'

export const LEVEL_RANK: Record<MemoryLevel, number> = { P0: 2, P1: 1, P2: 0 }

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

export function normalizeEntryText(text: string): string
export function entryHash(text: string): string
export function entryIdOf(track: MemoryTrack, fileStem: string, text: string): string
export function parseEntryStamp(stamp: string, now: number): number | null
export function formatEntryStamp(at: number): string
export function renderEntry(entry: Pick<ParsedEntry, 'level' | 'text' | 'source' | 'at' | 'revisions'>, opts?: { superseded?: boolean }): string
export function renderEntryBody(entry: Pick<ParsedEntry, 'level' | 'text' | 'source' | 'at' | 'revisions'>): string
// renderEntryBody = 去掉行首 `- ` 的同一字面量：`[P1] 文本（来源：...）`；tombstone 用 renderEntry(..., {superseded:true})。
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
): ParsedEntry | null
export function parseEntryFile(
  text: string,
  opts: {
    track: MemoryTrack
    file: string
    now: number
    fallbackAt: number
    acceptLegacy?: boolean
  },
): ParsedEntryFile
export function renderEntryFile(topic: MemoryTopicId, entries: readonly ParsedEntry[]): string

// renderEntryFile 只渲染 entry.file === `${topic}.md` 的条目；其他文件的条目由调用方另行渲染。
// 活动条目排序：levelRank 降序 → at 降序 → hash 升序；tombstone 单独 `## 已作废`，at 降序。

export function topicCatalogOf(track: MemoryTrack): readonly TopicSpec[]
export function topicSpecOf(id: string): TopicSpec | null
export function downgradeTopic(track: MemoryTrack, topic: MemoryTopicId): MemoryTopicId
export function routeTopic(input: {
  track: MemoryTrack
  text: string
  topic?: string
}): { ok: true; topic: MemoryTopicId } | { ok: false; code: 'BAD_TOPIC'; message: string }

export function upsertEntry(
  entries: readonly ParsedEntry[],
  incoming: EntryDraft,
  opts: { maxPerFile: number },
): MutationOutcome
export function supersedeEntry(
  entries: readonly ParsedEntry[],
  targetText: string,
  incoming: EntryDraft,
  opts: { maxPerFile: number },
): MutationOutcome
export function evictForInsert(
  entries: readonly ParsedEntry[],
  incoming: EntryDraft,
  maxPerFile: number,
): { ok: true; kept: ParsedEntry[]; evicted: ParsedEntry[] } | { ok: false; code: 'MEMORY_QUOTA_FULL'; message: string }
```

`EntryDraft`：

```ts
export interface EntryDraft {
  track: MemoryTrack
  text: string
  level: MemoryLevel
  topic?: MemoryTopicId
  source: string
  at: number
  supersedes?: string
}
```

`MutationOutcome`：

```ts
export type MutationOutcome =
  | {
      ok: true
      entries: ParsedEntry[]          // 变更后的完整条目集（活动 + tombstone）
      touched: ParsedEntry[]          // 本次新增/更新的条目
      evicted: ParsedEntry[]
      superseded: ParsedEntry[]       // 本次被置为 tombstone 的条目
      changedFiles: string[]          // 需要重写的文件名（如 ['pitfalls.md','commands.md']）
      added: number
      updated: number
      revived: number
    }
  | { ok: false; code: MemoryMutationCode; message: string }
```

`MemoryMutationCode`（纯层）：

```ts
export type MemoryMutationCode =
  | 'BAD_TEXT'
  | 'BAD_TOPIC'
  | 'MEMORY_QUOTA_FULL'
  | 'MEMORY_READONLY_COLLISION'
  | 'SUPERSEDE_NOT_FOUND'
  | 'SUPERSEDE_DUPLICATE'
  | 'SUPERSEDE_LEGACY_READONLY'
```

### 4.8 规范化与 hash（判重唯一口径）

```ts
export function normalizeEntryText(text: string): string {
  let s = text.normalize('NFKC')
  s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')   // 去掉行首列表标记
  s = s.replace(/\s+/g, ' ').trim()                // 所有空白折叠为单个半角空格
  s = s.replace(/[。．.!！?？;；,，、]+$/g, '').trim() // 去掉句末标点
  s = s.toLowerCase()                              // ASCII 大小写不敏感
  return s
}

export function entryHash(text: string): string {
  return createHash('sha256').update(normalizeEntryText(text), 'utf8').digest('hex')
}
```

- 身份 = `(track, entryHash(text))`；**同一轨道内** hash 相同即同一条，跨文件移动不产生新条目。
- 原文不同但规范化后相同（空白/句末标点/大小写/全半角差异）→ 同一条，按 upsert 累加修正次数。
- hash 不包含来源、文件、等级、时间；这些是条目的可变属性。
- 展示 ID = `mem://<track>/<fileStem>#<hash 前 12 位小写十六进制>`；`hash` 变化（正文被改写）→ ID 变化，旧 ID 由展开层返回可读的「已不存在」提示。

---

## 5. 主题路由规则

### 5.1 输入与优先级

```ts
routeTopic({ track, text, topic? })
```

1. 显式 `topic` 非空：规范化小写；必须在**该轨道**的目录里。
   - 不在目录（包括公共轨传 `ui`/`domain`）→ `BAD_TOPIC`，消息给出该轨道允许的 id 列表。
   - 显式 topic **不做降级**，避免「写 UI 却进了 workflow」的静默错位。
2. 未显式给 `topic`：按下面的顺序做**不区分大小写的子串**匹配，第一个命中即返回。
3. 全不命中 → `conventions`。
4. 命中后若是公共轨且 topic 为 `ui`/`domain` → 使用 `downgradeTopic` 映射。

### 5.2 关键词表（顺序即优先级）

| 顺序 | topic | 关键词（任一命中） |
|---|---|---|
| 1 | `pitfalls` | `失败`、`教训`、`坑`、`返工`、`事故`、`超时`、`崩溃`、`报错`、`回归`、`failed`、`error` |
| 2 | `commands` | `pnpm`、`npm`、`node`、`typecheck`、`build`、`编译`、`构建`、`依赖`、`安装`、`命令`、`门禁`、`退出码` |
| 3 | `ui` | `面板`、`界面`、`样式`、`字体`、`字号`、`页签`、`布局`、`颜色`、`client`、`css`、`slot`、`组件` |
| 4 | `host` | `宿主`、`适配`、`inject`、`事件`、`waterfall`、`路由`、`profile`、`真机`、`API`、`ctx` |
| 5 | `architecture` | `架构`、`模块`、`边界`、`契约`、`依赖方向`、`接口`、`分层`、`共享类型` |
| 6 | `workflow` | `流程`、`派发`、`角色`、`评审`、`任务`、`协作`、`计划`、`记忆`、`run`、`成员` |
| 7 | `domain` | `业务`、`产品`、`需求`、`用户`、`领域`、`数据`、`表`、`字段`、`迁移`、`工作区` |

注意顺序是设计的一部分：

- 「门禁 pnpm test 失败」先命中 `pitfalls`，写成教训而不是命令。
- 「面板字号用 token」命中 `ui`，不会因为 `token` 之类词跑到 `commands`。
- 「需求变更并入原任务」同时含 `需求`（domain）与 `任务`（workflow），**workflow 先命中**；这符合「流程约定」语义。
- 「整理旧流水」含 `记忆`，落 `workflow`；整理命令自身永远写 `pitfalls`（显式 topic，不走路由）。

### 5.3 路由用例（t4 直接做成表驱动测试）

| 轨道 | 文本 | 结果 |
|---|---|---|
| project | `门禁 pnpm test 失败，退出码 1` | `pitfalls` |
| project | `pnpm typecheck 通过后的门禁命令` | `commands` |
| project | `面板字号必须用 font token` | `ui` |
| project | `宿主 inject 漏声明导致 entry 不激活` | `host` |
| project | `模块依赖方向铁律` | `architecture`（`依赖方向` 命中；不含 `宿主`/`client`） |
| project | `需求变更并入原任务` | `workflow`（`任务` 先于 `需求`） |
| project | `整理记忆流水` | `workflow`（`记忆` 命中；文本里没有 `记忆` 时 fallback `conventions`） |
| project | `今天天气` | `conventions`（fallback） |
| public | `面板布局` | `workflow`（`ui` 降级） |
| public | `业务字段迁移` | `architecture`（`domain` 降级） |
| public | 显式 `topic='ui'` | `BAD_TOPIC` |
| project | 显式 `topic='pitfalls'` | `pitfalls`（即使文本含 `pnpm`） |

> 路由只按关键词，不做语义理解；上表就是 t4 的表驱动夹具，逐行断言，不要靠「看起来像」猜。

---

## 6. 三级等级语义

| 等级 | 语义 | 谁写 | 淘汰 | 注入 |
|---|---|---|---|---|
| **P0** | 铁律 / 用户或队长明确要求「永远记住」 | **只能**用户/队长显式 `importance:'P0'` 或手工编辑；自动沉淀**永不**产生 P0 | **永不淘汰**、永不自动降级 | 最优先，先于任何 P1/P2 |
| **P1** | 重要教训、失败证据、旧格式兼容行 | 自动失败沉淀；工具显式 `importance:'P1'`；兼容解析 | 所有 P2 淘汰完后才淘汰最旧 P1 | 次优先，按相关性 |
| **P2** | 常规知识、默认工具写入、已验证命令 | 工具默认；自动沉淀的通过命令 | **最先**淘汰（最旧优先） | 最后 |

补充规则：

1. 工具 `write` 的 `importance` 缺省 `P2`。
2. 自动沉淀：失败教训 = `P1`；通过的門禁命令 = `P2`；公共教训 = `P1`。
3. upsert 对已存在条目取 `max(旧等级, 新等级)`，即 **P2 可被 P1/P0 升级，P0 不会被工具降级**；降级只能人工改文件。
4. P0 不是「重要」的同义词：没有用户/队长明确意图，不允许写 P0；t4 需要一条「自动沉淀不产生 P0」的断言。
5. tombstone 不参与等级统计。

---

## 7. 判重、upsert、supersede、淘汰

### 7.1 写入前置校验（所有写路径共用）

```ts
function validateDraft(draft: EntryDraft): { ok: true; text: string } | { ok: false; code: MemoryMutationCode; message: string }
```

- `text.trim()` 为空 → `BAD_TEXT`：`正文不能为空`。
- 单行化：把 `\r\n`/`\r` 归一为 `\n`；含 `\n` 的输入（工具多行）在进入纯层前已拆成多条。
- 文本含 `（来源：` 且以完整来源后缀结尾 → `BAD_TEXT`：`正文不能自带来源后缀（来源由系统追加）`。
- 长度 > `MEMORY_ENTRY_TEXT_MAX=500` → 截到 499 + `…`（在 hash 之前截；截断后仍是写入文本）。
- `source` 必须匹配 `^[^ ·（）\n]+(?:/[^ ·（）\n]+)?$`，否则 `BAD_TEXT`。
- `at` 非有限数或 ≤0 → 用 `now`。

### 7.2 upsert 的精确步骤

输入：同轨道全部条目（canonical + misc + tombstone，`file` 已知），`incoming`，`maxPerFile=40`。

1. 解析 `topic`（显式/路由/降级）。
2. 计算 `hash = entryHash(text)`。
3. 在同轨道找 `hash` 相同的条目：
   - 命中 **misc（只读）** → `MEMORY_READONLY_COLLISION`：`同一正文已存在于只读文件 <file>；请手工编辑该文件或改写正文`。
   - 命中 **canonical**（活动或 tombstone）→ 走「更新」：
     - `revisions = old.revisions + 1`
     - `at = incoming.at`，`source = incoming.source`
     - `level = max(old.level, incoming.level)`
     - `text` 用 incoming 的原文（规范 hash 相同，展示文本以最新为准）
     - `superseded = false`（若原为 tombstone → `revived++`）
     - 文件：显式 `topic` 且与旧 topic 不同 → 移到新 topic 文件；否则留在原文件。
     - 目标文件若因移入超过 40：先淘汰（§7.4），**绝不淘汰正在更新的条目**；无东西可淘汰 → 整个操作拒绝，不落盘。
   - 未命中 → 走「新增」：
     - `revisions = 1`
     - 目标文件若已有 40 条活动条目 → 先淘汰；无东西可淘汰 → `MEMORY_QUOTA_FULL`。
4. 渲染所有变更文件（目标文件 + 旧文件），写盘。
5. 返回 `added/updated/revived/evicted/touched`。

**幂等性**：同一 `(track, text)` 连续 upsert 两次，第二次只把 `revisions` 从 1 变 2，文件仍只有一条，`added=0, updated=1`。

### 7.3 supersede 的精确步骤

语义：用新结论取代旧结论；旧条目保留为删除线 tombstone，新条目继承 `修正 N+1`，注入只看新条目。

1. 校验 new draft，计算 new hash。
2. `targetHash = entryHash(supersedes)`；在同轨道查找：
   - 无 → `SUPERSEDE_NOT_FOUND`：`没有找到要取代的条目：<supersedes 前 50 字>`。
   - 只有 tombstone → `SUPERSEDE_NOT_FOUND`：`目标已作废，无需再次取代`。
   - 目标在 misc → `SUPERSEDE_LEGACY_READONLY`：`只读文件 <file> 的条目不能被 supersede；请手工编辑`。
3. 若 new hash 已存在（活动或 tombstone，且不是 target）→ `SUPERSEDE_DUPLICATE`：`新正文已存在（<file>），请直接 upsert 或改写正文`。
4. 目标置 tombstone（`superseded=true`，保留 `text/source/at/revisions`，原 `lineIndex` 不变）。
5. 新条目插入解析出的 topic 文件：
   - `revisions = target.revisions + 1`
   - `level = max(target.level, incoming.level)`
   - `source/at` 用 incoming
   - 若新文件已满 40 → 淘汰（§7.4），**绝不淘汰新条目**；无东西可淘汰 → 整体拒绝，目标也不置 tombstone（原子）。
6. 渲染目标文件（旧条目变 `~~`）与新文件，写盘。
7. 返回 `superseded`（旧）与 `touched`（新）。

P0 可以被显式 supersede（用户改主意的场景），但不会被自动流程 supersede。

### 7.4 淘汰顺序（硬规则）

只在**单个 canonical 文件**的活动条目数将超过 `ENTRIES_PER_FILE=40` 时触发；`evictForInsert(entries, ...)` 的 `entries` 必须是**目标文件**的活动条目集合，不能传整轨：

```text
1) P2 中 at 最旧的
2) P2 全部淘汰完后，P1 中 at 最旧的
3) P0 永远不动
```

tie-break：`at` 相同 → `lineIndex` 小的先淘汰 → `hash` 字典序小的先淘汰。

额外约束：

- **绝不淘汰本次 incoming / 本次更新的条目**（即使它是 P2 且最旧）。
- 一次插入通常只淘汰 1 条；如果 mover 导致目标文件多出 k 条，淘汰 k 条。
- 淘汰的条目**从文件删除**（不是 tombstone）；返回在 `evicted[]`，tool/bridge 以可读 notice 告知。
- 无可淘汰（40 条全是 P0）→ `MEMORY_QUOTA_FULL`，消息逐字：
  `「<file>」已有 40 条且全部为 P0（P0 不淘汰）：请先手工删除或降级一条 P0 再写入`
- tombstone 不计入 40；但每个文件另有 `SUPERSEDED_PER_FILE=20` 上限，超过时按 `at` 最旧删除 tombstone（tie hash 升序）。tombstone 删除不可恢复，属审计上限。

### 7.5 原子性

- 纯层返回 `ok:false` 时，**一个字节都不写**；桥接层只把 `message` 变成 `BAD_REQUEST` 的可读拒绝。
- 一次写入涉及多个文件（supersede 跨文件、upsert 移动 topic）时，先全部在内存渲染成功，再依次 `writeFileSync`；中途 IO 失败要返回错误并保留已写文件（无法跨文件事务），但纯层不会出现「目标已改、新条目没落」的半截形状。

---

## 8. 配额常量与统计

### 8.1 常量（`src/host/config.ts`）

```ts
export const PROJECT_MAX_FILES = 8     // 项目轨主题文件上限（= 主题目录 size）
export const PUBLIC_MAX_FILES = 6      // 公共轨主题文件上限
export const ENTRIES_PER_FILE = 40     // 每个 canonical 文件的活动条目上限
export const SUPERSEDED_PER_FILE = 20  // 每个文件保留的 tombstone 上限
export const MEMORY_ENTRY_TEXT_MAX = 500
export const MEMORY_NEAR_FILE_GAP = 1  // files >= maxFiles - 1 即「接近上限」
export const MEMORY_NEAR_ENTRY_GAP = 4 // active >= 40 - 4 即「接近满」
```

### 8.2 统计口径（`MemoryQuotaView`）

```ts
export interface MemoryQuotaView {
  track: MemoryTrack
  files: number              // 已存在的 canonical 文件数（不是 misc/legacy）
  maxFiles: number           // 8 或 6
  totalEntries: number       // 所有 canonical 文件的活动条目数之和（不含 tombstone）
  maxEntriesPerFile: number  // 40
  nearFiles: boolean         // files >= maxFiles - 1
  overFiles: boolean         // files > maxFiles（防御式，正常恒 false）
  nearFullFiles: string[]    // active >= 36 且 < 40 的文件名
  fullFiles: string[]        // active >= 40 的文件名
}
```

- 面板文案由客户端拼（宿主只给数字，不拼中文），例如 `项目记忆 5/8 · 63 条`。
- `overFiles` 为 true 时面板必须显示红色告警；t2 不自动删文件。
- `totalEntries` 不含 misc/legacy；面板另有 `legacyFileCount` 单独展示。

---

## 9. 注入（条目级）

### 9.1 候选集

- 读 `<dir>/*.md`，排除 `run-*.md` 与 `lessons-*.md`（两轨都排除）；canonical 与 misc 都参与。
- 每个文件用 `parseEntryFile` 解析；misc 的 `topic=null`，canonical 的 `topic=id`。
- 丢弃 `superseded=true`。
- 去重：`(track, hash)` 只留一条，优先级：
  1. canonical 优先于 misc；
  2. `revisions` 大者；
  3. `at` 新者；
  4. 文件名字典序小者。
- 旧 `run-*.md` / `lessons-*.md` **不解析、不进候选、不计配额**；这是本设计的硬边界（它们只是历史流水，不是策展知识）。

### 9.2 排序（硬规则）

```text
levelRank 降序（P0=2 > P1=1 > P2=0）
→ relevance 降序（关键词命中数：topic 标题 + 条目正文）
→ track（project 先于 public）
→ at 降序
→ topic 字典序
→ hash 字典序
```

- `relevance` 复用 `inject.ts:94` 的 `keywords(goal)`；统计 `countOccurrences(keyword, `${topicTitle}\n${text}`.toLowerCase())` 之和。
- `goal` 为空 → relevance 全 0，退化为「等级 → 项目轨 → 时间」。
- P0 优先**高于**相关性：一条不相关的 P0 也会排在最相关 P2 之前；这是「铁律不能被相关性淹没」的产品取舍。
- 同一等级、同相关性时项目轨优先；公共轨只在预算有余量时进入。

### 9.3 打包与预算

- 头部逐字：`团队记忆索引（按 ID 用 auto_team_memory expand 展开全文）：`
- 每行逐字：

```text
${id} · ${TRACK_LABEL} · ${title} — ${summary} ⇄ ${related.join(', ')}
```

  - `id = mem://<track>/<stem>#<12hex>`
  - `TRACK_LABEL`：`project` → `项目记忆`，`public` → `公共记忆`
  - `title = clip(`${level} ${text}`, 40)`（等级始终可见）
  - `summary = clip(`来源：${source} · ${formatEntryStamp(at)} · 修正 ${revisions}`, 60)`
  - `related` = 已排序列表里同 track 的其他活动条目 ID（最多 `MEMORY_RELATED_MAX=3`），不包含自己
  - `⇄` 段只在 `related.length > 0` 时出现
  - 单行总长 ≤ `MEMORY_INLINE_ITEM_MAX=200`；超出时按现有策略依次：related 缩到 1 个 → summary 缩短 → 硬截断加 `…`
- 预算：`budget = settings.memoryBudget ?? MEMORY_INJECT_BUDGET=4000`；`header + 所有行 + tail` 的总长度**永不超预算**。
- 若还有未放入的条目，预留 `TAIL_RESERVE=160`，尾部逐字：

```text
另有 N 条未内联（可按 ID 展开）：id1, id2, id3
```

  超过 3 个只列 3 个；尾部本身也放不下时退化为 `另有 N 条未内联`。
- `truncated = omitted.length > 0`。
- 一条都放不下时 `text=''`、`inline=[]`、`omitted=全部`；**不能**返回超预算文本。

### 9.4 函数签名

```ts
export interface MemoryIndex {
  text: string
  entries: MemoryInlineEntry[]
  omitted: MemoryInlineEntry[]
  chars: number
  budget: number
  truncated: boolean
}

export function selectMemoryEntries(
  goal: string,
  candidates: readonly ParsedEntry[],
  budget: number,
): MemoryIndex
```

- `selectMemoryEntries` 是纯函数：不读文件、不看 `now`（时间已在 `at` 里）。
- 旧的 `memoryIndexOf` / `selectMemory` / `MemoryCandidate` / `MemorySelection` 删除；`bridge.memoryFor` 与 `snapshot` 改调新函数。t4 需要同步删旧测试断言。

### 9.5 `MemoryInlineEntry` 扩展

```ts
export interface MemoryInlineEntry {
  id: string
  track: MemoryTrack
  name: string            // `${stem}#${12hex}`，用于面板/展开
  title: string
  summary: string
  related: string[]
  chars: number
  level?: MemoryLevel     // 新实现恒有
  revisions?: number      // 新实现恒有
  source?: string         // 新实现恒有
  at?: number             // 新实现恒有
}
```

---

## 10. 展开（expand）

### 10.1 ID 语法

```text
mem://<track>/<stem>[#<hash12>]
```

- `<track>`：`public` | `project`。
- `<stem>`：`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`（与 `expand.ts:81` 的 `STEM_PATTERN` 一致，大小写保留）。
- `<hash12>`：`^[0-9a-f]{12}$`，`entryHash(text)` 的前 12 位。
- 无 `#` → 整文件展开，行为与现在**逐字节相同**（`body` 原样、4000 截断、related 同文件其他文件）。
- 有 `#` → 条目展开：
  - 读文件 → `parseEntryFile` → 找 `hash.slice(0,12) === hash12` 的条目（含 tombstone）。
  - 找到：`body = renderEntry(entry)`（tombstone 带 `~~`），`chars=body.length`，`truncated=false`，`depth` 原样回显，`related` = 同文件其他活动条目的带 hash ID（最多 3 个）。
  - 找不到：`code='EXPAND_NOT_FOUND'`，`message='条目已不存在（可能被整理或淘汰）：<id>；请用 list 查看当前条目'`。
- `parseMemoryId` 返回值扩展内部字段 `hash?: string`；对外仍 `{ok:true,track,name}`，`name` 对条目 ID 是 `<stem>#<hash12>`。
- 旧的「`#` 一律拒绝」测试要改；`EXPAND_BAD_ID` 仍用于格式错误（hash 非 12 位十六进制、多个 `#`、空 stem）。

### 10.2 过期 ID

- 条目被淘汰/正文改写 → 旧 hash 不存在，展开返回可读的 `EXPAND_NOT_FOUND`，**不抛异常**。
- 模型拿到这个错误后应重新 `list`，不得凭记忆重试同一个 ID；工具描述要写这一句。

---

## 11. 自动沉淀（终态 run）

### 11.1 落点

- 沿用 `recordRunMemory` 现有的目录解析（`src/host/bridge.ts:597`，由 `saveState` 调用），项目落 `resolvedMemoryLocation(...).roots.projectDir`，公共落 `roots.publicDir`；**不新增第二套解析**。
- 终态集合不变：`terminated` / `cancelled`（`auto.ts:332`）。

### 11.2 纯函数

```ts
export interface AutoEntryDraft {
  track: MemoryTrack
  text: string
  topic?: MemoryTopicId
  level: MemoryLevel
  source: string
  at: number
}

export function autoEntryDraftsOf(input: AutoMemoryInput, now?: number): AutoEntryDraft[]
```

规则：

- 只处理终态；非终态返回 `[]`。
- 项目轨，按任务顺序：
  1. 每个 `failureOf(task)` 非空 → `pitfalls` / P1：
     - 有命令（`command !== '未记录'`）：
       `门禁 \`<command>\` 失败（退出码 <exitLabel>）` + （有 tail 时）`；输出尾部：<tail≤120>`
     - 无命令且 `task.status === 'failed'`：`任务「<title>」失败（<runId>）`
     - 无命令、仅因返工次数 >1 命中：`任务「<title>」返工 <rework> 次（<runId>）`（不把已完成的返工写成「失败」）
  2. 每个任务 evidence 满足 `exitCode === 0 && command.trim() !== ''` → `commands` / P2：
       `已验证命令：<command>`
     - 同一 run 内按规范化 hash 去重（同一命令只写一条）。
- 没有失败 → **不产生 pitfalls 草稿**（不能写「本轮无失败」这种噪声）。
- 公共轨：仅当项目失败数 > 0，写 1 条 `pitfalls` / P1：
  - 有命令：`门禁 \`<command>\` 失败（退出码 <exitLabel>）——先本地重跑确认，再把证据发回成员返工`
  - 无命令：`有任务失败——返工前先核对门禁证据，确认失败原因再改`
- `at = finishedAt ?? createdAt ?? plannedAt ?? now`（取第一个有限正数）。
- `source = '系统'`。
- 进入条目层前把命令/输出尾部里的 `\r?\n` 折叠为空格，保证一条正文单行；条目层再做一次单行化兜底。
- **永不产生 P0**。

### 11.3 与旧实现的关系

- `recordRunMemory` 改调 `autoEntryDraftsOf` + 条目 upsert，**不再调用** `runMemoryOf`、不再写 `run-*.md` / `lessons-*.md`。
- `projectMemoryNameOf` / `projectMemoryOf` / `publicMemoryOf` / `runMemoryOf` 保留导出，只给 `backfill-cli`（r22 旧流水回填）和测试夹具用；标注 `@deprecated 仅兼容`。
- 空草稿（无失败、无通过命令）→ 不写任何文件，不留空主题文件。
- **幂等键**：`RunState` 增加可选字段 `memorySunkAt?: number`（`src/host/store.ts:86` 的 `RunState`）。`recordRunMemory` 入口先判 `Number.isFinite(state.memorySunkAt)`，有值直接 return；**只有终态才继续**，非终态直接 return 且**不写** `memorySunkAt`（否则真终态会被误判为已沉淀）；一次终态沉淀成功（包括 0 条草稿）后把 `state.memorySunkAt = Date.now()`，随后 `saveState` 落盘。这样 `saveState` 被反复调用（receipt/停滞/暂停恢复等）不会把同一条失败教训的 `修正 N` 一直加；沉淀抛异常时不写该字段，下一次保存重试（fail-open）。旧 run 没有该字段 → 首次保存会补沉淀一次，之后稳定。
- 一次终态 run 的多条草稿要在内存里**顺序**应用（同一批 upsert 可能互相升级/复活），全部成功后再按 `changedFiles` 一次性写盘；任一条返回 `ok:false` 只记录 notice 并跳过该条，不中断其余条目（自动沉淀不允许因一条坏文本整体丢失）。

```ts
// bridge 内部编排（非纯层，示意）
const drafts = autoEntryDraftsOf(input, now)
for (const draft of drafts) {
  const outcome = applyDraft(entriesOf(draft.track), draft) // entries.ts 纯函数
  if (!outcome.ok) { notices.push(outcome.message); continue }
  // 用 outcome.entries 更新内存中的同轨道条目集，并累积 changedFiles
}
writeChangedFiles() // 每个文件只写一次
```

### 11.4 失败文本示例（逐字）

```text
- [P1] 门禁 `pnpm test` 失败（退出码 1）；输出尾部：test/memory.test.ts:111 expected ...（来源：系统 · 11-10 17:20 · 修正 1）
- [P2] 已验证命令：`pnpm typecheck`（来源：系统 · 11-10 17:20 · 修正 1）
```

> 注意：`失败（退出码 1）；输出尾部：` 用半角分号；条目来源前是 `）`，两层括号是合法的，解析按最后一个 `（来源：` 锚定。

---

## 12. 「整理旧流水」（curation）

### 12.1 目标

把旧 `run-*.md` / `lessons-*.md` 里的失败证据**一次性、只追加**地提炼进同轨道 `pitfalls.md`，让新注入能重新利用这些教训，同时不删除、不改写旧文件。

### 12.2 输入

CLI：

```bash
node src/host/memory/curate-cli.ts \
  --track project|public \
  --dir <memoryDir> \
  [--dry-run] \
  [--now <epochMs>]
```

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `--track` | 否 | `project` | `project` 扫 `run-*.md`；`public` 扫 `lessons-*.md` |
| `--dir` | **是** | — | 记忆目录绝对路径；缺失/非目录 → 用法错误，退出码 2 |
| `--dry-run` | 否 | 关 | 只计算报告，零写入 |
| `--now` | 否 | `Date.now()` | 测试/repro 用；非法整数 → 退出码 2 |

宿主动作（面板/工具共用）：

```ts
{ type: 'curateMemory'; track: MemoryTrack; dryRun: boolean }
```

工具：

```ts
{ action: 'curate', track?: MemoryTrack, dryRun?: boolean }   // dryRun 缺省 true
```

### 12.3 扫描与提取（纯函数）

```ts
export function extractLegacyLessons(
  text: string,
  opts: { track: MemoryTrack; file: string },
): string[]
```

只读、只提取，不改原文：

**项目 `run-*.md`：**

1. 找 `## 失败与教训` 标题；取其后到下一个 `## ` 标题（或 EOF）之间所有 `^- ` 行，去掉 `- ` 作为候选。
2. 若没有该标题，或有标题但没有 bullet：扫描 `^- (\S+) \[(failed|failed\?)\] (.+)$` 的行，生成 `任务「$3」失败（$1）`。
3. 其余内容（状态、任务清单、成功命令）**不提取**。

**公共 `lessons-*.md`：**

1. 取所有 `^- 失败模式：` 与 `^- 可复用提示：` 行，去掉前缀（含全角冒号）作为候选。
2. 其他行不提取。

统一处理：

- 每条去首尾空白、折叠空白、clip 到 500；空串丢弃。
- 同一文件内、跨文件间按 `normalizeEntryText` 去重。
- `at = 文件 mtime`（取不到用 `now`）；`source='系统'`；`level='P1'`；`topic='pitfalls'`。
- 不解析、不改写、不删除源文件。

### 12.4 应用（`curateMemory`）

```ts
export interface CurateInput {
  track: MemoryTrack
  roots: MemoryRoots
  dryRun: boolean
  now?: number
}

// 只在 src/shared/types.ts 定义一次（见 §14.1），host 侧用别名，避免同一形状两份定义。
export type CurateReport = MemoryCurateReport

export function curateMemory(input: CurateInput): CurateReport
```

> `CurateReport` 是 host 内部别名；`MemoryCurateReport` 是共享真值。字段形状只允许在 `src/shared/types.ts` 维护一份。

步骤：

1. 解析目录；不存在 → `ok:false` + warning（CLI 退出码 1），不创建目录。
2. 列出匹配文件（按文件名升序，确定性）：
   - project：`/^run-.*\.md$/`
   - public：`/^lessons-.*\.md$/`
   - 明确排除 `pitfalls.md` 自身。
3. 逐文件读文本、`extractLegacyLessons`；unreadable/无证据 → `warnings` 追加一行，`skippedInvalid++`（按**文件**计数）。
4. 汇总候选，按 `(track, hash)` 去重；`extracted = 去重后候选数`。
5. 读目标 `pitfalls.md`（不存在按空文件）→ 解析现有条目（含 tombstone）。
6. 对每个候选：
   - hash 已存在（活动或 tombstone）→ `skippedExisting++`；**不复活 tombstone**。
   - 目标活动条目已 40 → `skippedFull++`；**不淘汰**、不改 revision。
   - 否则加入待追加列表（`revisions=1`、`at=文件 mtime`、`source=系统`、`level=P1`）。
7. `added = 待追加列表长度`；`target.before = 现有活动条目数`；`target.after = before + added`。
8. `dryRun` → 直接返回报告，**零写入**（不 touch mtime）。
9. 非 dryRun 且 `added > 0` → 渲染整个 `pitfalls.md`（保留原有条目与 tombstone）一次写入；`added=0` 时连文件都不写（幂等）。
10. 返回报告；`ok` 只在目录不可用时 false。

不变式（t4 必须断言）：

```text
added + skippedExisting + skippedFull === extracted
second run added === 0 && skippedExisting === extracted（同目录、同 mtime 条件）
dryRun 前后：文件字节数与 mtime 完全不变
```

### 12.5 报告示例（逐字 JSON 形状）

```json
{
  "ok": true,
  "track": "project",
  "dryRun": true,
  "at": 1762766400000,
  "scannedFiles": 20,
  "legacyFiles": ["run-mw2fn31l-2nn.md", "run-mw3o8r92-zoe.md"],
  "extracted": 7,
  "added": 5,
  "skippedExisting": 1,
  "skippedFull": 1,
  "skippedInvalid": 0,
  "target": { "name": "pitfalls.md", "before": 12, "after": 17 },
  "warnings": []
}
```

CLI 输出：stdout **恰好一个 JSON 对象**（`JSON.stringify(report, null, 2) + "\n"`），stderr 只放人类可读的一行摘要；退出码 `0`（成功，包括 0 条新增）、`2`（用法错误）、`1`（目录不可读等运行错误）。

### 12.6 不变量

- **只补不改**：不修改源文件、不提高已有条目 revision、不删除、不 supersede、不淘汰。
- **幂等**：连续执行两次，第二次 `added=0`，目标文件内容与 mtime 不变。
- **dry-run 零写入**：连目录都不创建。
- **不越过配额**：目标满 40 时只报 `skippedFull`，不触发 §7.4 淘汰。
- **不读旧流水进注入**：整理是唯一读旧流水的路径；整理后知识以 P1 条目存在 `pitfalls.md`，注入只读条目。
- **已有条目的文本/等级/来源/修正次数不变**；但 canonical 文件是插件资产，写回时会把旧格式/compat 行规范化为标准字面量。这是「渲染归一」，不是「改内容」；t4 断言条目集合，不要断言 `pitfalls.md` 的旧字节。

---

## 13. 工具与宿主契约

### 13.1 `auto_team_memory` 工具（`src/host/tools.ts:681`）

参数（新增字段用 **可选**，保证旧调用可用）：

```ts
{
  action: 'list' | 'read' | 'write' | 'expand' | 'curate'
  track?: 'public' | 'project'          // 缺省 project
  name?: string                          // write 时是可选的 topic/文件名；read 时是文件名
  body?: string                          // 兼容旧写入
  text?: string                          // 新写入；单条或多行（每行一条）
  importance?: 'P0' | 'P1' | 'P2'        // 缺省 P2
  topic?: string                         // 显式主题；缺省按路由
  supersedes?: string                    // 要取代的旧正文
  id?: string                            // expand
  depth?: number                         // expand
  dryRun?: boolean                       // curate，缺省 true
}
```

行为：

- `list`：返回 `snapshot.memory`（含 `files`、`quotas`、`legacyFileCount`、`inline`、`omitted`、`projectDir` 等）。不再返回裸 `MemoryFileInfo`。
- `read`：`{ok:true, track, name, body, chars, file: MemoryFileView, entries: MemoryEntryView[]}`；`file/entries` 由宿主解析，客户端/模型不解析 md。
- `expand`：沿用，新增条目 ID；输出增加 `level/revisions/source/at`（若有）。
- `write`：
  - 取 `text ?? body`；两者都给且不同 → `BAD_REQUEST`：`text 与 body 只能给一个`。
  - 多行文本按 `\n` 拆，逐行 trim；跳过空行、heading（`^#{1,6}\s`）、围栏标记、分隔线；最多 `MEMORY_LINES_PER_TASK=20` 条，超出部分截断并在返回 `truncated=true`（兼容旧上限；单条写入不受 20 影响）。
  - `supersedes` 只能配一条正文；多行 + supersedes → `BAD_REQUEST`：`supersedes 只能配一条正文`。
  - `name` 兼容：若给出且能映射到该轨道主题（`pitfalls` / `pitfalls.md`）→ 作为 topic；若给出但不是合法主题 → `BAD_TOPIC`（可读消息列出允许 id）。`name` 与 `topic` 同时给且冲突 → `BAD_TOPIC`。
  - 每条走 §7 upsert/supersede；成功返回：

```ts
{
  ok: true
  track: MemoryTrack
  written: number
  added: number
  updated: number
  revived: number
  superseded: number
  topics: MemoryTopicId[]
  entries: MemoryEntryView[]     // 本次新增/更新
  evicted: MemoryEntryView[]     // 本次淘汰
  notices: string[]
}
```

- `curate`：`{ok, report: CurateReport}`；`dryRun` 缺省 **true**（工具不能默认改盘），描述里明确「先 dryRun 预览，再 dryRun:false 执行」。

> `name` 旧语义是任意文件名；本设计把它收窄为主题 id。**破坏性变更**：旧调用 `write(name='notes')` 会得到 `BAD_TOPIC`。这是有意的：写入口只允许 canonical 主题；自由文件请用面板手工编辑或直接编辑磁盘。

### 13.2 桥接层（`src/host/bridge.ts`）

新增内部方法（不经过 HTTP 新路由）：

```ts
interface MemoryEntryStore {
  listFiles(track: MemoryTrack, roots: MemoryRoots): Promise<MemoryFileView[]>
  readDetail(track: MemoryTrack, name: string, roots: MemoryRoots): Promise<{ file: MemoryFileView; entries: MemoryEntryView[]; body: string }>
  mutate(track: MemoryTrack, roots: MemoryRoots, input: MemoryWriteInput): Promise<MemoryMutationReceipt>
  curate(track: MemoryTrack, roots: MemoryRoots, dryRun: boolean): Promise<CurateReport>
}
```

- `snapshot()` 的 `memory`：
  - `files: MemoryFileView[]`（canonical + misc，**不含 legacy**）
  - `quotas: { project: MemoryQuotaView; public: MemoryQuotaView }`
  - `legacyFileCount: number`（两轨 `run-*`/`lessons-*` 总数）
  - `inline/omitted` 用新 `MemoryInlineEntry`
  - 其余字段不变（`injectedChars/budget/truncated/projectDir/workspace/degraded/degradeReason`）
- `memoryFor(goal, sessionId?)`：读候选 → `selectMemoryEntries(goal, entries, budget)` → `{text,truncated,chars}`；签名不变。
- `readMemoryFile(track, name, workspace?, sessionId?)`：返回 `{data:{track,name,body,chars,file,entries}}`；legacy 文件允许读，`file.legacy=true`，`entries` 解析用于阅读，但**不参与注入/配额**。
- `recordRunMemory(state)`：见 §11。
- `act` 新增：

```ts
case 'curateMemory': {
  const track = trackOf(action.track) ?? 'project'
  const report = await this.curate(track, roots, action.dryRun)
  if (!report.ok) return reject('BAD_REQUEST', report.warnings[0] ?? '整理失败', sessionId)
  return { ...accept(sessionId, [summaryOf(report)]), curation: report }
}
```

  - `accept` 返回 `{snapshot, notices}`；需要把 `curation` 合并进返回值。
  - 失败时**不清空**面板列表（`snapshot` 仍返回），`rejected` 带原因。

### 13.3 面板动作与结果（`src/shared/types.ts`）

```ts
export type PanelAction =
  // ...既有 18 条...
  | { type: 'curateMemory'; track: MemoryTrack; dryRun: boolean }

export interface ActResult {
  snapshot: PanelSnapshot
  notices?: string[]
  rejected?: { code: RejectionCode; message: string }
  pendingId?: string
  curation?: MemoryCurateReport
}
```

- `PanelAction` 注释的「18 个」改成「19 个」；t4 若有计数断言同步。
- 不新增 `RejectionCode`；整理失败用 `BAD_REQUEST` + 可读 `message`，避免客户端漏配新码。

### 13.4 HTTP

- `GET /api/auto-team/memory?track=&name=`：响应 `data` 增加 `file`、`entries`（`body/chars` 不变）；未新增路由。
- `POST /api/auto-team/act`：`curateMemory` 复用现有通道；响应 `{data: ActResult}` 里带 `curation`。
- 快照轮询不携带条目详情（最多 8×40 条会撑大轮询）；条目详情按需 `GET /memory`。

---

## 14. 面板契约（t3 直接照抄）

### 14.1 共享类型

```ts
export type MemoryLevel = 'P0' | 'P1' | 'P2'

export type MemoryTopicId =
  | 'conventions' | 'architecture' | 'commands' | 'pitfalls'
  | 'workflow' | 'ui' | 'host' | 'domain'

export interface MemoryEntryView {
  id: string
  track: MemoryTrack
  file: string
  topic: MemoryTopicId | null
  level: MemoryLevel
  text: string
  source: string
  at: number
  /** 宿主格式化好的 `MM-DD HH:mm`；客户端不要自己 new Date 拼。 */
  stamp: string
  /** 宿主格式化好的 `来源：<source> · <stamp> · 修正 <n>`；客户端直接展示。 */
  sourceText: string
  revisions: number
  superseded: boolean
}

export interface MemoryFileView extends MemoryFileInfo {
  topic: MemoryTopicId | null
  canonical: boolean
  readOnly: boolean
  legacy: boolean
  entries: number          // 解析出的总条目（含 tombstone）
  active: number           // 活动条目
  superseded: number       // tombstone 数
  levels: { P0: number; P1: number; P2: number }  // active 的等级分布
}

export interface MemoryQuotaView { /* §8.2 */ }

export interface MemoryCurateReport {
  ok: boolean
  track: MemoryTrack
  dryRun: boolean
  at: number
  scannedFiles: number
  legacyFiles: string[]
  extracted: number
  added: number
  skippedExisting: number
  skippedFull: number
  skippedInvalid: number
  target: { name: string; before: number; after: number }
  warnings: string[]
}
```

### 14.2 字段映射（UI 需求 → 数据）

| UI 需求 | 字段 |
|---|---|
| 「项目记忆 5/8」 | `snapshot.memory.quotas.project.files` / `.maxFiles` |
| 「63 条」 | `quotas.project.totalEntries` |
| 接近上限 | `quotas.project.nearFiles`、`.nearFullFiles`、`.fullFiles`、`.overFiles` |
| 每文件 `P0 2 · P1 5 · P2 8` | `file.levels.P0/P1/P2` |
| 每文件条目数 | `file.active` / `file.entries` |
| 条目展开 | `GET /memory?track=&name=` → `data.entries[]` |
| 等级徽标 | `entry.level`（P0 高对比、P1 常规、P2 弱化） |
| 正文 | `entry.text` |
| 来源 + 时间 + 修正次数 | `entry.sourceText`（已格式化） |
| 已作废 | `entry.superseded` → 删除线 + 「已作废」 |
| 旧流水数量 | `snapshot.memory.legacyFileCount` |
| 「整理旧流水」按钮 | `act({type:'curateMemory',track,dryRun:true})` 预览 → `dryRun:false` 执行；报告在 `curation` |

### 14.3 t3 行为约束

- **禁止客户端解析 md**：不按 `（来源：` 切分、不自己拼 `修正`、不自己格式化时间；全部用 `MemoryEntryView`。
- 展开前列表只渲染 `file` 汇总；点击文件/条目再拉 `GET /memory`。
- 已作废条目默认折叠或置灰，不能计入 `active` 文案。
- 整理失败：保留当前列表与展开状态，展示 `rejected.message` 或 `curation.warnings[0]`；**不得清空**。
- dry-run 结果只显示「将新增 N 条 / 已存在 N / 已满 N」，不预先改列表；执行成功后再刷新快照。
- 配额文案由客户端拼中文（宿主只给数字），但条目/来源/时间文案必须用宿主字段。

---

## 15. 模块与依赖（t2 文件清单）

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/shared/types.ts` | 改 | `MemoryTopicId`、`MemoryLevel`、`MemoryEntryView`、`MemoryFileView`、`MemoryQuotaView`、`MemoryCurateReport`、`ActResult.curation`、`PanelAction.curateMemory`、`MemoryInlineEntry` 可选字段、`PanelSnapshot.memory` 三字段 |
| `src/host/config.ts` | 改 | §8.1 六个常量 |
| `src/host/memory/entries.ts` | **新增** | §4/§5/§7 全部纯函数；只 import `node:crypto` 与 `src/shared/types.ts` |
| `src/host/memory/repo.ts` | 改 | 增加 `listMemoryViews`、`readMemoryEntries`、`writeMemoryFile`、`quotaOf`；保留现有 raw 函数 |
| `src/host/memory/inject.ts` | 改 | 新增 `selectMemoryEntries`；删 `memoryIndexOf/selectMemory/MemoryCandidate/MemorySelection`；保留 `keywords/clip` 等内部工具 |
| `src/host/memory/auto.ts` | 改 | 新增 `autoEntryDraftsOf`；旧 builder 标 `@deprecated` 保留 |
| `src/host/memory/curate.ts` | **新增** | `extractLegacyLessons`、`curateMemory`、`CurateReport` |
| `src/host/memory/curate-cli.ts` | **新增** | §12.2 CLI；只做参数解析 + 调 `curateMemory` + 输出 |
| `src/host/memory/expand.ts` | 改 | `parseMemoryId` 支持 `#hash12`；`createExpander` 条目分支 |
| `src/host/store.ts` | 改 | `RunState` 增加可选 `memorySunkAt?: number`（自动沉淀幂等键，缺省兼容旧快照） |
| `src/host/bridge.ts` | 改 | `snapshot`、`memoryFor`、`readMemoryFile`、`recordRunMemory`、`act curateMemory` |
| `src/host/tools.ts` | 改 | `auto_team_memory` schema/handler：write 新参数、read 结构化、curate |
| `src/host/http.ts` | **不改** | 复用 `GET /memory` 与 `POST /act`；只在响应类型上扩展 |
| `src/client/**` | t3 | 记忆页/API 类型/整理按钮 |
| `test/**` | t4 | 见 §16/§17 |

依赖方向：

```text
src/shared/types.ts  ← entries.ts / inject.ts / repo.ts / auto.ts / curate.ts / bridge.ts / tools.ts
entries.ts           ← inject.ts / auto.ts / curate.ts / repo.ts / bridge.ts   （纯，无 fs）
inject.ts            ← bridge.ts                                               （纯）
curate.ts            ← curate-cli.ts / bridge.ts                               （fs，仅此层）
```

- `entries.ts` / `inject.ts` **禁止** import `repo.ts`、`bridge.ts`、`adapters.ts`、`node:fs`；这是它们可被 `node --test` 直接跑的前提。
- 宿主 API 仍只允许出现在 `src/host/adapters.ts`；t2 不新增宿主调用。

### 15.1 t2 实现顺序（每步跑 typecheck）

1. `types.ts` + `config.ts` + `entries.ts`（纯层，先让 t4 能写测试）。
2. `repo.ts` 视图/读取/写入 + `entries.ts` 的 `applyMemoryMutation` 编排（纯层负责判重，repo 只负责加载与落盘）。
3. `inject.ts` 条目级 + `expand.ts` 条目 ID。
4. `auto.ts` 草稿 + `bridge.recordRunMemory`。
5. `tools.ts` write/read/list。
6. `curate.ts` + `curate-cli.ts`。
7. `bridge.act` + `snapshot` + `memoryFor` + `readMemoryFile`。
8. 全量 `pnpm typecheck && pnpm test`，修旧测试。

---

## 16. 兼容与破坏性变更（t4 必读）

### 16.1 兼容承诺

1. **旧手写 md 不丢内容**：misc 文件里任意非空正文行 → P1 条目（`source=手写`，`at=mtime`），注入可见；插件不写回 misc 文件。
2. **旧格式 `- [origin · MM-DD HH:mm] text` 继续可读**：P1、来源/时间保留。
3. **旧 `run-*.md` / `lessons-*.md` 不删除**：仍可 `read`、仍保留在磁盘；只是不注入、不计配额、不被自动改写。
4. **`auto_team_memory read` 的 `{track,name,body,chars}` 保留**：新增字段是附加；旧客户端不解析也不崩。
5. **`expand` 无 `#` 的整文件行为逐字节不变**：body、4000 截断、related 规则保持。
6. **旧快照**：`memory.quotas/legacyFileCount` 可选，客户端缺省按 `0`/空处理，不报错。

### 16.2 有意破坏（必须更新测试/文档）

| 破坏点 | 旧行为 | 新行为 | 影响测试 |
|---|---|---|---|
| 自动沉淀 | 每次终态 run 新建 `run-*.md` / `lessons-*.md` | 不新建；写 `pitfalls.md` / `commands.md` 条目 | `test/memory-auto.test.ts` |
| 旧格式渲染 | `formatSourcedLine` 产出 `- [origin · stamp] text` | `renderEntry` 产出 `- [P1] text（来源：...）` | `test/memory.test.ts:111` |
| 工具 `write(name)` | 任意合法文件名 | 必须是该轨道主题 id，否则 `BAD_TOPIC` | 工具测试 |
| `selectMemory` | 文件级签名 | 删除，改 `selectMemoryEntries` | bridge/inject 测试 |
| 内联 `title/summary` | title=文件标题，summary=正文首句 | title=`level + 条目正文`，summary=`来源 · 时间 · 修正 N` | inject/内联文案测试 |
| 快照 `memory.files` | `MemoryFileInfo[]` | `MemoryFileView[]`（加字段，不改旧字段） | 形状断言 |
| `PanelAction` 数 | 18 | 19（`curateMemory`） | 计数断言（若有） |
| `expand` ID | `mem://track/stem` | 增加 `mem://track/stem#hash12` | `parseMemoryId` 测试 |
| 行数上限 | `appendMemoryLines` 最多 20 行/次 | 单条写入不受 20 限制；多行仍 ≤20 条 | append 测试 |

### 16.3 手工逃生口

- `PanelAction.saveMemory` / `deleteMemory` **保留原样**：直接写/删文件。语义是「手工维护磁盘」，不参与判重、不检查配额、不自动加来源；面板需在编辑器上标注「手工编辑不会自动套用条目格式」。
- 手工编辑 canonical 文件后，非法行按 P1 兼容解析，不会丢内容；但可能被下一次渲染规范化（属于 canonical 的约定）。

### 16.4 迁移

- 不需要一次性迁移：新代码启动后旧 `run-*.md` 自动被注入忽略；面板显示 `legacyFileCount`；用户点「整理旧流水」后再把教训纳入注入。
- 不自动执行整理；整理必须显式触发（dry-run 默认）。
- `backfill-cli` 不变：它仍只为缺失的旧 run 补 `run-*.md`；补出来的文件不参与新注入，只作为整理素材。

---

## 17. 验收、测试与变异自检

### 17.1 分任务门禁（逐字执行并记录退出码）

```bash
# t1
test -s docs/teamflow/2026-11-10-r23-memory-curation/DESIGN.md \
  && grep -q PROJECT_MAX_FILES docs/teamflow/2026-11-10-r23-memory-curation/DESIGN.md

# t2（宿主/纯逻辑）
pnpm typecheck && pnpm test

# t3（面板）
pnpm typecheck

# t4（QA + 产物 + 文档）
pnpm typecheck && pnpm test && pnpm build
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run
```

### 17.2 必测用例（t4 按编号建测试）

**格式/解析**

1. `renderEntry` 对固定 entry 的输出与 §4.1 逐字相等（时间用 `new Date(2026,10,10,17,20).getTime()` 固定）。
2. `parseEntryLine(renderEntry(e))` 回读 `level/text/source/at/revisions` 全部相等；`at` 允许年份差 1（跨年夹具显式给 `now`）。
3. tombstone 渲染/解析：`superseded=true`，正文与来源保留。
4. 旧格式行 → P1 + `source=pm/t2` + 原文；兼容行 → P1 + `source=手写`；空行/heading/分隔线不产条目。
5. 非法时间/非法 revision 的新格式行 → 降级为兼容 P1，内容不丢。
6. `normalizeEntryText`：全半角、连续空白、句末标点、大小写、行首 `- ` 的差异归一后 hash 相同。

**判重/写入**

7. 同文本 upsert 两次：`revisions` 1→2，文件只有一条，`added=0/updated=1`。
8. 同 hash 的 tombstone 被 upsert → 复活（`superseded=false`，`revisions` +1）。
9. supersede：旧条目变 `~~`，新条目 `revisions = 旧+1`，注入不含旧、含新。
10. supersede 目标不存在/已作废/在 misc → 对应可读 code，文件字节不变（原子）。
11. 同轨道 hash 去重；跨轨道同文本互不影响。

**等级/配额/淘汰**

12. `PROJECT_MAX_FILES=8` / `PUBLIC_MAX_FILES=6` / `ENTRIES_PER_FILE=40` 常量等于本文字面量。
13. 40 条 P2 + 插入 → 最旧 P2 被淘汰；`evicted` 带原文。
14. 40 条 P1（无 P2）+ 插入 → 最旧 P1 被淘汰。
15. 40 条 P0 + 插入 → `MEMORY_QUOTA_FULL`，文件不变。
16. 混合 40 条：先淘汰 P2 最旧，P0 全保留。
17. tombstone 不计入 40；超过 20 个 tombstone 时最旧被删。
18. 写入 501 字符 → 截到 500（含 `…`），hash 基于截断后文本。

**路由**

19. §5.3 表驱动（含公共降级、显式 topic 拒绝、fallback）。
20. 显式 `topic` 覆盖关键词（`pnpm` 文本 + `topic='conventions'` → conventions）。

**注入**

21. P0 即使 `at` 更旧、相关性更低，也排在 P1/P2 前。
22. 同等级按相关性；同相关性按 project 优先。
23. `superseded` 条目不出现；`omitted` 与 `truncated` 自洽；总字符 ≤ budget。
24. 旧 `run-*.md` / `lessons-*.md` 不进候选（构造文件内容后断言 inline 无其文本）。
25. misc 文件条目可注入（P1 兼容），但不计入文件配额。

**自动沉淀**

26. 终态 run 不再创建 `run-*.md`（`readdir` 断言）。
27. 有失败 → `pitfalls.md` 出现 P1 条目，文本含命令与退出码；无失败 → 不创建/不追加 `pitfalls.md`。
28. 通过命令 → `commands.md` 出现 P2 `已验证命令：...`；同 run 重复命令只一条。
29. 自动沉淀永不带 P0。
29a. 同一终态 run 连续两次 `saveState`：第二次 `memorySunkAt` 已存在直接跳过，`pitfalls.md` 的 `修正 N` 不增加、文件 mtime 不变。

**整理**

30. dry-run：报告 `added>0`，目标文件字节与 mtime 不变。
31. 执行后旧 run 的失败行进入 `pitfalls.md`，源文件字节不变。
32. 第二次执行 `added=0 && skippedExisting=extracted`，目标文件字节与 mtime 不变。
33. 目标 40 条时 `skippedFull>0`，不淘汰既有条目。
34. 坏行/无失败段 → `warnings` + `skippedInvalid`，不中断。
35. CLI 缺 `--dir` → 退出码 2；`--dry-run` stdout 可 `JSON.parse`。

**契约**

36. `auto_team_memory write` 新参数与返回字段；`importance` 缺省 P2；`topic` 非法 → `BAD_TOPIC`。
37. `read` 返回 `file/entries`，`entry.sourceText` 与 `stamp` 由宿主格式化。
38. 快照 `memory.quotas`、`legacyFileCount`、`files[].levels` 正确。
39. `PanelAction.curateMemory` 走 `POST /act`，`ActResult.curation` 有值；失败 `rejected` + 列表不清空（这条 t4 只测 host 返回，UI 由 t3 自测）。

### 17.3 变异自检清单（必须让至少一条测试变红）

| # | 变异 | 预期变红的用例 |
|---|---|---|
| M1 | `ENTRIES_PER_FILE` 39 | 12/13/14/15/17 |
| M2 | 淘汰顺序改成 P1 先于 P2 | 13/16 |
| M3 | 允许淘汰 P0 | 15/16 |
| M4 | 注入不排除 `superseded` | 9/23 |
| M5 | 注入重新纳入 `run-*.md` | 24 |
| M6 | `entryHash` 直接用原文（不 normalize） | 6/7 |
| M7 | dry-run 仍写文件 | 30 |
| M8 | 整理第二次仍追加 | 32 |
| M9 | `routeTopic` 把 pitfalls 放到 commands 之后 | 19（「失败」用例） |
| M10 | 注入按相关性优先于等级 | 21 |
| M11 | tombstone 计入 40 | 17 |
| M12 | `expand` 拒绝 `#` | 条目展开测试 |

### 17.4 测试夹具

- 时间固定用 `new Date(2026, 10, 10, 17, 20).getTime()`（本地时区），避免 CI 时区漂移；跨年用 `now = new Date(2027, 0, 2, 3, 4).getTime()` + `12-31 23:59`。
- 临时目录用 `fs.mkdtempSync(path.join(os.tmpdir(), 'auto-team-memory-'))`，测试后删除；不写仓库内 `.auto-team/memory`（那是真机数据）。
- 旧 run 夹具直接写最小文本：

```md
# 目标 · run-test

- 状态：已终止 · 2026-11-10 17:00
- t1 [failed] 门禁失败

## 失败与教训

- t1 返工 1 次：门禁 `pnpm test` 退出码 1；输出尾部：expected true
```

---

## 18. 取舍记录（证据 + 可接受/建议修改）

| 议题 | 证据 | 取舍 | 可接受 / 建议修改 |
|---|---|---|---|
| 旧 `run-*.md` 为何不迁移 | 项目目录实测约 20 个；`auto.ts:113` 每次 run 一个 | 不自动读、不自动删；只给整理命令 | **可接受**：历史流水是日志不是知识；**建议**：面板常显 `legacyFileCount`，避免用户以为记忆丢了 |
| 为何不新增 HTTP 路由 | `http.ts:5-8` 四路由；`:10-13` r13 决定 | 整理走 `POST /act`；详情走已有 `GET /memory` | **可接受**：动作语义与工具共用 `bridge.act`；**建议**：t2 不复制分支 |
| 为何快照不带条目详情 | 8×40=320 条，轮询会膨胀 | 快照给 `files/quotas/levels`；点开再 `GET /memory` | **可接受**：面板首屏只渲染汇总；**建议**：t3 做按需加载并缓存 |
| 为何 P0 永不淘汰 | 产品语义「铁律」 | 全 P0 满时拒绝写入，给可读原因 | **可接受**：宁可写失败也不静默丢铁律；**建议**：面板在 `fullFiles` 标红 |
| 为何保留 `saveMemory` 裸写 | 面板编辑器/手工修复需要 | 不作为正式写入口，不判重/不配额 | **可接受**：逃生口必须存在；**建议**：编辑器标注「手工模式」，避免误以为会自动排版 |
| 为何 misc 只读 | 手写文件可能是用户资产 | 只解析注入，不回写 | **可接受**：零丢失；**建议**：面板在 misc 文件上标「只读」 |
| 为何公共轨 ui/domain 降级而显式 topic 报错 | 自动路由需要落点；显式意图不能静默改 | 自动降级、显式拒绝 | **可接受**：两种情况语义不同；**建议**：t4 两条都测 |

### 18.1 已知风险（不阻塞）

1. **本地时区**：`MM-DD HH:mm` 无年份/时区。旧数据跨年排序可能差一年；只影响 tie-break，不影响判重/内容。可接受。
2. **规范化冲突**：两段语义不同但标点/空白相同的文本会被判重。概率低；以「展示最新文本」缓解。可接受。
3. **整理提取是启发式**：只认固定段落/行前缀；旧文件格式漂移会 `skippedInvalid`/无候选。用 `warnings` 暴露，不猜测。可接受。
4. **跨文件事务**：极端 IO 失败可能留下部分文件已写。单机本地盘概率极低；原子性在纯层保证。可接受。
5. **真机验证**：t1 只做文档与命令；UI 真机抓控制台由 t3/t4 按 `REAL-HOST-VERIFY.md` 执行，本文不冒充已验证。

---

## 19. 交接（t2 / t3 / t4）

- **t2 先冻结 `types.ts` + `entries.ts`**，然后通知 t3 可以按 §14 写面板（t3 只依赖类型，不依赖 t2 完成 bridge）。
- **t2 完成前** t3 可用 mock `MemoryFileView/MemoryEntryView` 做 UI；**禁止**在 client 里实现解析/格式化兜底。
- **t4 等 t2/t3 代码就绪**后跑 §17.2 全量；变异自检至少抽 M1/M2/M4/M7/M8 实际执行并记录红/绿。
- **t4 必须更新**：`test/memory.test.ts`、`test/memory-auto.test.ts`、`test/memory-inject.test.ts`（若有）、`test/expand.test.ts`（若有）、工具/快照形状测试；README 记忆章节；本任务夹 `QA-REPORT.md`。
- **t4 必须重建** `lib/index.js` 与 `lib/client.js`，并跑两条 `node --input-type=module -e "await import(...)"`。
- 任何与本文冲突的实现，先回报队长；不要私自改 §3/§4/§7/§8/§9/§12 的硬规则。

---

## 20. t1 验收记录

```text
命令：test -s docs/teamflow/2026-11-10-r23-memory-curation/DESIGN.md && grep -q PROJECT_MAX_FILES docs/teamflow/2026-11-10-r23-memory-curation/DESIGN.md
退出码：见本次回执（0 = 通过）
```

（t1 实际执行结果由队长回执记录；本文不预先填「已验证」。）
