<!-- meta: summary="r5 技术方案：新增 guard.ts/expand.ts/trigger.ts/trigger-bus.ts/captain.ts 五个纯逻辑模块 + adapters 两处宿主绑定（tools/execute 守卫、四事件订阅）+ bridge/index/tools/client 四处集成；记忆注入改 mem://<track>/<stem> 内联索引（预算仍 4000），Trigger 走 dedupeKey + Fast 7 码 + bridge.act 既有 action；零新增路由/动作/kind/setInterval" -->
基线依赖：docs/teamflow/20261101-r4-peer-delivery-watchdog
依据：docs/teamflow/20261101-r5-super-agent-p2p3/PRD.md（AC-1~AC-23）、docs/teamflow/architecture/SUPER-AGENT-MAPPING.md §3.3/§3.4/§3.5

# r5 技术方案 · 队长分层 + Inline & Spill + 内部 Trigger 总线

## 1. 架构判断（一句话）

三块能力都不动数据模型主干：**纯逻辑先落地**（`team/guard.ts`、`memory/inject.ts`、`memory/expand.ts`、`team/trigger.ts` 四个可单测模块），**宿主形状只出现在 `adapters.ts`**（新增两个绑定：`tools/execute` 守卫、四类事件订阅），**推进语义只有一个出口**（`bridge.act` 既有 11 个 action）。因此 `PanelAction` 仍 11 个、`ActivityEvent.kind` 仍 9 个、`GET/POST /api/auto-team` 仍 3 条路由、`setInterval` 仍 `src/host/team/watcher.ts:247` 一处。

新增文件 5 个、改动文件 9 个，没有新目录（`src/host/team/` 与 `src/host/memory/` 已存在，符合「一个文件不值得单开一个目录」）。

## 2. 现状事实基线（本会话实跑，可复核）

| 事实 | 命令 | 返回值 |
|---|---|---|
| 测试基线 | `pnpm -s test` | `ℹ tests 216 / ℹ pass 216 / ℹ fail 0`（3246ms） |
| `setInterval` 唯一处 | `grep -rn "setInterval" src` | `src/host/team/watcher.ts:247`（另有 :198 变量声明与 `src/client/state.ts:4` 注释） |
| 记忆预算 | `grep -n MEMORY_INJECT_BUDGET src/host/config.ts` | `30:export const MEMORY_INJECT_BUDGET = 4000` |
| 停滞阈值 | `grep -n "export const STALL_MS" src/host/config.ts` | `61:export const STALL_MS = 90_000` |
| 轮询间隔 | `grep -n "export const WATCHER_INTERVAL_MS" src/host/config.ts` | `51:export const WATCHER_INTERVAL_MS = 1500` |
| 工作树 | `git status --porcelain --untracked-files=all` | 3 行：`M docs/teamflow/memory.md`、`?? …r5-super-agent-p2p3/PRD.md`、`?? …r5-super-agent-p2p3/meta.json`；HEAD `9c461eb` |
| 面板未渲染活动流 | `grep -rn "\.activity" src/client` | 0 命中（AC-17 需要新增渲染位） |
| 记忆名守门已存在 | `grep -n "export function safeMemoryName" src/host/memory/repo.ts` | `35:export function safeMemoryName(raw: string): string \| null` |

关键既有契约（改动必须绕开而不是重写）：

- `src/host/bridge.ts:136` `interface Bridge`（`act` 是唯一语义入口）；`:293` `activityOf`（活动流由 `RunState` 合成）；`:463` 快照里 `selectMemory(...)`；`:833` `memoryFor`（成员提示词注入）。
- `src/host/memory/inject.ts:193` `selectMemory`（纯函数，不许 import 宿主）；`:35` `TRUNCATION_MARK`；`:140` `compose`；`:182` `tailLine`。
- `src/host/store.ts:47` `interface RunState`（`:63` `stallAlerts?`，`:245` `capStallAlerts` 是「落盘数组有上限」的既有范式，新数组照抄）。
- `src/host/tools.ts:281` `${TOOL_PREFIX}memory`（`action: list|read|write`）——**展开入口挂在它上面，不新增工具名**。
- `src/host/http.ts` 三条路由；`src/client/api.ts` 唯一解包点 `request()`。
- `src/host/index.ts` 是唯一装配点；`:186` 起的事件订阅只记录 `lastProgress`，**判定只有一个出口**（`watcher.tick`），本期必须保持这条结构纪律。

## 3. 数据模型与存储

### 3.1 `src/shared/types.ts`（只加可选字段，不新增 kind 枚举值）

```ts
/* 队长模型（AC-2）：value 与来源三态必须同时可见，unsupported 不得伪装成 configured */
export interface CaptainModelView {
  value: string | null                      // `provider/model #effort` 或 null
  route: RoleModelRoute | null
  source: 'configured' | 'host-default' | 'unsupported'
  note: string                              // 一句中文说明（配置生效 / 未配置 / 宿主不支持）
}

/* Trigger（AC-13）：kind 恰 4 个；source 区分「即时信号」与「轮询兜底」 */
export type TriggerKind = 'gate_failed' | 'member_exit' | 'dep_ready' | 'stall_timeout'
export type TriggerSource = 'event' | 'poll'
/* Fast 层原因码（AC-14：≤8 个，只落在五类程序判据） */
export type FastReason =
  | 'ok'              // 放行
  | 'not_enabled'     // 会话开关关闭
  | 'not_listened'    // 不属于四类监听集合
  | 'unknown_entity'  // taskId/memberId 在当前 run 里找不到
  | 'task_state'      // 任务状态不允许该推进（如已 done 又收到 dep_ready）
  | 'gate_exit_zero'  // 门禁退出码为 0，不该报「失败」
  | 'duplicate'       // 去重窗口内已推进过

export interface TriggerRecord {
  at: number
  kind: TriggerKind
  source: TriggerSource
  runId: string
  taskId?: string
  memberId?: string
  dedupeKey: string
  accepted: boolean
  reason: FastReason
  /** 中文可读原因（AC-17）：含短语 + 实体 id + 结果；dropped 时含「未推进：<为什么>」 */
  text: string
  /** accepted 时实际调用的 action 类型（dispatch/resume/message…），dropped 时缺省 */
  action?: PanelAction['type']
  /** bridge.act 的拒绝码（并发满等）；动作执行了但被业务拒绝时记录 */
  rejected?: RejectionCode
}

/* Inline 索引（AC-7）：面板/测试都能看到「内联了哪几条、省略了哪几条」 */
export interface MemoryInlineEntry {
  id: string            // `mem://<track>/<stem>`
  track: MemoryTrack
  name: string
  title: string
  summary: string
  related: string[]     // ≥1 个关联 id（同轨相邻条目）
  chars: number         // 该条内联文本长度（≤200）
}

/* 展开结果（AC-9/AC-10） */
export type ExpandCode =
  | 'OK'
  | 'EXPAND_BAD_ID'
  | 'EXPAND_PATH_ESCAPE'
  | 'EXPAND_NOT_FOUND'
  | 'EXPAND_DEPTH_EXCEEDED'

export interface ExpandPayload {
  code: ExpandCode
  id: string
  track: MemoryTrack | null
  name: string | null
  body: string          // code==='OK' 时是正文（超 4000 截断并置 truncated）
  chars: number
  truncated: boolean
  depth: number         // 本次展开的跳数（1 起）
  related: string[]
  message: string       // 每个码一句可读中文
}

/* 既有类型的最小扩展 */
export interface ActivityEvent { /* …原字段不变… */ source?: 'trigger' | 'user' }

export interface PanelSnapshot {
  /* …原字段不变… */
  captainModel: CaptainModelView
  /** AC-18：事件订阅不可用时为 true，面板必须看得见（不得静默降级） */
  degraded: boolean
  degradeReason?: string
  triggers?: TriggerRecord[]   // 最近 N 条（含 dropped），供 QA 与「为什么没推进」排查
  memory: {
    injectedChars: number; budget: number; truncated: boolean; files: MemoryFileInfo[]
    inline: MemoryInlineEntry[]  // 新增
    omitted: MemoryInlineEntry[] // 新增：未内联但可按 ID 展开
  }
}
```

### 3.2 `src/host/store.ts`（落盘）

`RunState` 增一个可选数组，照 `stallAlerts` 的既有范式：

```ts
triggers?: TriggerRecord[]        // 幂等与可解释性的唯一落盘证据
export const TRIGGER_LOG_LIMIT = 100   // 与 MESSAGES_LIMIT=200 / STALL_ALERTS_LIMIT=50 同族
```

`save()` 里 `triggers: capTriggers(state.triggers ?? [])`（保留最近 100 条，`capTriggers` 复制 `capStallAlerts` 的实现形状）。**不改 `RUN_STATE_VERSION`**：新增字段全可选，v2 旧文件读回即缺省，不需要迁移。

### 3.3 配置与常量（全部集中 `src/host/config.ts`）

```ts
export const NOWAIT_THRESHOLD_MS = 5_000      // 前台同步等待阈值（AC-4/AC-5）
export const TRIGGER_DEDUPE_MS = 60_000       // 去重窗口（AC-15：全仓唯一定义处）
export const TRIGGER_LOG_LIMIT = 100          // 见 3.2
export const MEMORY_INLINE_ITEM_MAX = 200     // 单条内联项字符上限（AC-7）
export const MEMORY_RELATED_MAX = 3           // 每条关联 id 上限
export const MEMORY_EXPAND_MAX_CHARS = 4000   // 单次展开上限（AC-9）
export const MEMORY_EXPAND_MAX_DEPTH = 2      // 跳数上限（AC-9）
```

`MEMORY_INJECT_BUDGET = 4000`（`:30`）与 `WATCHER_INTERVAL_MS`/`PANEL_ACTIVE_MS`/`STALL_MS` **逐字不改**（AC-8/AC-20）。去重窗口只在 config.ts 出现一次 `export const`，`trigger.ts` 收参数。

## 4. 接口契约

### 4.1 HTTP（零新增路由，AC-16）

| 路由 | 变化 |
|---|---|
| `GET /api/auto-team/snapshot` | 载荷新增 `captainModel` / `degraded` / `degradeReason` / `triggers` / `memory.inline` / `memory.omitted` / `activity[].source` |
| `GET /api/auto-team/memory` | 不变 |
| `POST /api/auto-team/act` | 不变（Trigger 也走 `bridge.act`，但由宿主侧调用，不经 HTTP） |

### 4.2 工具（不新增工具名，AC-9 的展开入口）

`auto_team_memory` 的 `action` 枚举从 `['list','read','write']` 扩到 `['list','read','write','expand']`，新增两个可选参数：

```jsonc
{ "action": "expand", "id": "mem://project/conventions", "depth": 1 }
// → { ok: true, code: 'OK', id, track, name, body, chars, truncated, depth, related, message }
// 失败 → { ok: false, code: 'EXPAND_DEPTH_EXCEEDED', message: '…' }（不抛异常）
```

`depth` 缺省 1，合法 1..2；>2 直接 `EXPAND_DEPTH_EXCEEDED`（AC-9 的「第 3 跳」）。工具走 `bridge.expandMemory`，与面板纪律一致（动作/查询型能力只有一个实现）。

### 4.3 内部端口（`Bridge` 接口，`src/host/bridge.ts:136`）

```ts
expandMemory(id: string, depth?: number): Result<ExpandPayload>
```
`BridgeDeps` 增三个可选注入（缺省时降级，不改变既有行为）：

```ts
captainModel?: () => CaptainModelView                     // index.ts 注入 captain.captainModelView(...)
triggerHealth?: () => { degraded: boolean; reason?: string }
expander?: (id: string, depth: number) => ExpandPayload    // index.ts 注入 memory/expand.ts 的实例
```

### 4.4 新模块 API（dev 必须逐字调用这些名字）

```ts
/* src/host/team/guard.ts —— 纯函数，零宿主依赖 */
export type GuardCode = 'NOWAIT_FOREGROUND_WAIT' | 'NOWAIT_UNBOUNDED_OUTPUT' | 'NOWAIT_BLOCKING_TTY'
export interface GuardRequest { role: 'captain' | 'member'; toolName: string; args: unknown }
export type GuardVerdict =
  | { allow: true }
  | { allow: false; code: GuardCode; message: string; command: string }
export function guardOf(request: GuardRequest): GuardVerdict
export function sleepMsOf(command: string): number | null       // `30` / `1.5` / `2m30s` / `1h`
export function segmentsOf(command: string): Array<{ text: string; background: boolean }>
export function isCaptainCommand(command: string): boolean        // 供探针与测试复用

/* src/host/memory/inject.ts —— 纯函数（保留 selectMemory 名字，语义升级） */
export interface InlineEntry { id: string; track: MemoryTrack; name: string; title: string; summary: string; related: string[]; chars: number }
export interface MemoryIndex { text: string; entries: InlineEntry[]; omitted: InlineEntry[]; chars: number; budget: number; truncated: boolean }
export function memoryIdOf(track: MemoryTrack, name: string): string          // `mem://<track>/<stem>`
export function memoryIndexOf(goal, candidates, budget, opts?: { itemMax?: number; relatedMax?: number }): MemoryIndex
export function selectMemory(goal, candidates, budget): MemorySelection        // 兼容壳：text = memoryIndexOf(...).text

/* src/host/memory/expand.ts —— 收 roots，不碰 ctx.*，可用临时目录单测 */
export function parseMemoryId(raw: string): { ok: true; track: MemoryTrack; name: string } | { ok: false; code: ExpandCode }
export function createExpander(deps: {
  roots: { publicDir: string; projectDir: string }
  relatedOf?: (track: MemoryTrack, name: string) => string[]
  hash?: (text: string) => string
}): { expand(id: string, depth?: number): ExpandPayload }

/* src/host/team/trigger.ts —— 纯函数 */
export const TRIGGER_KINDS: readonly TriggerKind[]   // 恰 4 个
export function dedupeKeyOf(kind: TriggerKind, runId: string, entityId: string): string
export function fastOf(trigger: Trigger, ctx: {
  enabled: boolean
  run: { runId: string; plan: Plan; tasks: PlanTask[]; bindings: MemberBinding[] }
  accepted: Array<{ dedupeKey: string; at: number }>   // 已放行记录（幂等判据）
  now: number; dedupeMs: number
}): { accepted: boolean; reason: FastReason; action: PanelAction | null }
export function triggerFromGate(runId: string, task: PlanTask, at: number): Trigger
export function triggerFromMemberExit(runId: string, memberId: string, why: string, at: number): Trigger
export function triggerFromDepReady(runId: string, task: PlanTask, at: number): Trigger
export function triggerFromStall(runId: string, memberId: string, at: number): Trigger
export function triggerSentenceOf(trigger: Trigger, verdict: { accepted: boolean; reason: FastReason; action?: PanelAction['type'] }): string

/* src/host/team/trigger-bus.ts —— 编排层（store + bridge） */
export interface TriggerBus {
  push(trigger: Trigger): Promise<TriggerRecord>
  poll(state: RunState): Promise<TriggerRecord[]>
  health(): { degraded: boolean; reason?: string }
  setEventSource(available: boolean): void
}
export function createTriggerBus(deps: { store: RunsStore; bridge: Bridge; now: () => number }): TriggerBus

/* src/host/team/captain.ts —— 配置读取 + 快照投影 */
export function readCaptainModel(dataRoot: string): RoleModelRoute | null     // <dataRoot>/captain.json，残缺返回 null
export function captainModelView(route: RoleModelRoute | null, capability: 'ok' | 'unsupported'): CaptainModelView

/* src/host/adapters.ts —— 宿主形状只在这里（新增 4 个导出） */
export function registerToolGuard(ctx: HostContext, decide: (req: { toolName: string; args: unknown; agentId: string | null }) => GuardVerdict): () => void
export function onHostTriggerEvents(ctx: HostContext, handler: (name: 'agent/status' | 'subagent/end' | 'agent/error' | 'tools/result', payload: unknown) => void): { stop(): void; degraded: boolean }
export function captainAgentScopeOf(ctx: HostContext): unknown | null
export function installCaptainRoute(ctx: HostContext, route: RoleModelRoute): (() => void) | null
```

## 5. 子系统一：队长分层（AC-1~AC-6）

### 5.1 提示词硬约束（AC-1）

`src/host/prompt.ts:14` `captainSection()` 重写为三条**可 grep 的中文特征句**（放在「工作方式」之前，独立成段）：

1. `你**不亲自干细活**：读文件、改代码、跑测试、修 bug 一律派给成员。`
2. `你**只做三件事**：拆解目标、分派任务、验收结果。`
3. `**不要同步等长任务**：任何可能超过 5 秒的命令都必须后台执行或派给成员；前台 \`sleep\` 会被守卫直接拒绝。`

段落末尾追加两行（都只在有内容时出现，避免常驻膨胀）：

- 队长模型：`captainModel.source === 'host-default'` 时不写；`configured` 写「队长模型：`provider/model`」；`unsupported` 写「队长模型：宿主暂不支持单独指定（配置已保留，未生效）」。
- 记忆：沿用旧的两行逻辑，但 `truncated` 的语义改为「有未内联条目」，文案改为「团队记忆另有 N 条未内联，按 `mem://` ID 用 `auto_team_memory`（action=expand）展开」——**不再出现「已截断」**（AC-8 断言 0 命中）。

AC-1 的「不把整份计划塞进常驻上下文」由结构保证：`captainSection` 只读 `snapshot.enabled / memory / captainModel`，**不读 `snapshot.tasks`**；`test/captain.test.ts` 构造含 4000 字 `acceptance` 的计划后断言该文本 0 命中，并断言段落 `length ≤ 2600`。

### 5.2 队长模型（AC-2/AC-3）

- 配置源：`<dataRoot>/captain.json`（`{ provider, model, reasoningEffort? }`）。**本期不提供写入口**——新增写入口只能走新 `PanelAction`（违反 AC-16）或新路由（违反 AC-16），故面板/快照只做**只读回显**，文件由用户手写，README 一行说明。
- 生效路径：`installCaptainRoute(ctx, route)`（`adapters.ts`，语义对齐既有 `installMemberRoute`：`system-prompt/assemble` + `agent/request`），仅在**实测可用**时安装；不可用则 `captainModelView(route, 'unsupported')`，快照 `source:'unsupported'`，提示词与面板均给出可读说明（anti-goal 5：绝不假称生效）。
- **AC-3 是前置实验**：探针 `captain-model-probe.mjs` 用真实宿主验证「主 session agent 能否被 `system-prompt/assemble`/`agent/request` 命中并改变 model」。结论（命令 + 返回值）在 dev 阶段回填到本文 §10 两清单；未测出可行前，`capability` 恒为 `'unsupported'`（fail-closed 到「不假称」这一侧）。

### 5.3 noWait 守卫（AC-4/AC-5/AC-6）

**判定（纯函数 `guardOf`）**，只看 `toolName === 'bash'` 且 `role === 'captain'`：

1. `args.command` 缺失或非字符串 → 放行。
2. `segmentsOf(command)`：按未转义的 `;` / `&&` / `||` / `|` / 换行切段；段尾单个 `&`（非 `&&`）或整段被 `( … ) &` 包裹 → `background: true`。
3. 逐**前台**段归一化：剥离前导 `(`/`{`、环境变量赋值（`FOO=1`）、`sudo`、`time`、`nohup`、`command`。
4. `bash|sh|zsh -c '<payload>'` → 递归解析 payload（深度上限 2，防 `bash -c "bash -c 'sleep 30'"`）。
5. 命中即拒绝：
   - 段首命令是 `sleep` 且 `sleepMsOf` ≥ `NOWAIT_THRESHOLD_MS`(5000) → `NOWAIT_FOREGROUND_WAIT`
   - 段首命令 ∈ `{watch, yes, top}`，或 `tail -f` / `tail -F` / `less` / `more` / `vi` / `vim` / `nano` / `ssh`（无 `-T`）→ `NOWAIT_UNBOUNDED_OUTPUT`
   - 段首命令是 `wait` 且无参数 → `NOWAIT_BLOCKING_TTY`
6. 其余一律放行。

拒绝文案（每条都要给下一步）：`前台同步等待被拒绝（NOWAIT_FOREGROUND_WAIT）：sleep 30 会阻塞整个编排。下一步：改成后台执行（命令末尾加 &），或用 auto_team_message 把这个等待派给成员。`

**不误杀的机制（AC-5 四组负样本）**：`echo sleep`（段首是 `echo`）、`grep -r sleep src/`（段首是 `grep`）、`(sleep 30) &`（background）、`git status`（短命令）全部放行——判据是「段首命令语义 + 时长」，不是字符串包含。

**宿主绑定（`adapters.registerToolGuard`）**：订阅 `tools/execute`（waterfall，`next()` 才会真正执行）。`decide()` 返回 `allow:false` 时**不调用 `next()`**，直接短路返回拒绝。会话作用域：`agentId === null`（根/队长）或 agent id 不在任何 `state.bindings[].memberId` 里 → `role:'captain'`；命中 binding → `role:'member'`。**无法判定时 fail-open（放行）**——守卫的失败模式必须是「少拦一次」，不能是「拦住正常工作」（anti-goal 1）。

**短路返回形状未实测（U1）**，故三级降级写死在 `registerToolGuard` 里：

| 级别 | 做法 | 结果 |
|---|---|---|
| L1 | waterfall 返回拒绝对象（携带 `code`/`message`），不调 `next()` | 命令不执行，模型收到可读原因（首选） |
| L2 | L1 形状不被宿主接受时，中间件 `throw new Error(message)` | 命令不执行，模型收到可读错误 |
| L3 | `tools/execute` 根本不可用 → 不注册守卫、`degraded` 记 warn、提示词第 3 条仍生效 | 降级为「自律」，**必须在 QA-REPORT 记为未验证项**，不得算 AC-4 通过 |

**变异自检（AC-6）**：探针 `captain-guard-probe.mjs` 支持 `--mutate=allow-all`，把 `guardOf` 短路成恒放行后重跑同一断言集——AC-4 的断言行必须变红，且红的原因必须是断言文本（`ASSERT sleep30 被拒绝` 之类），不是 `TypeError`。

## 6. 子系统二：Inline & Spill（AC-7~AC-11）

### 6.1 ID 形态

`mem://<track>/<stem>`，例如 `mem://project/conventions`（`stem` = 文件名去 `.md`）。理由：① 稳定、可读、可在面板与日志里直接出现；② 不引入 hash（hash 要在注入期与展开期各算一次、源文件改动就失联）；③ 天然承载轨道路由，展开时不需要额外查询。

安全边界全在 `parseMemoryId`：`stem` 必须匹配 `^[p-z0-9][a-z0-9._-]{0,63}$`（小写化后），且**不得**含 `/`、`\`、`..`、`~`、`:`、`\0`、绝对路径前缀；`track` 只接受 `public|project`。命中即 `EXPAND_PATH_ESCAPE`；形态不对即 `EXPAND_BAD_ID`。落盘前再复用既有 `repo.safeMemoryName`（`:35`）做第二道守门——两道都过才读盘。

### 6.2 内联条目形态（AC-7 的机械上限：每条 ≤200 字符）

```
mem://project/conventions · 项目记忆 · 提交前必须跑 pnpm build — 团队约定的门禁纪律 ×3 ⇄ mem://project/testing, mem://public/git
```

字段预算：`id`(≤48) + 标题(≤40) + 摘要(≤60) + 关联(≤3 个 × ≤26) + 固定分隔 ≈ ≤200。摘要取「首个非标题行的第一个句子」，超过 60 字符截断并加 `…`。关联 ID 取**同轨按 rank 相邻**的前 3 条（不足则跨轨补），保证每条 `related.length ≥ 1`（AC-7 断言）。

### 6.3 预算内拼装（AC-8）

`memoryIndexOf(goal, candidates, 4000)`：按既有 `rank()`（项目轨 → 标题命中 → 相关度 → 更新时间 → 名字，顺序不变）逐条内联，直到下一条放不进预算；放不进的进入 `omitted`（**不丢信息**）。文本尾部固定一行（短，≤120 字符）：

```
另有 3 条未内联（可按 ID 展开）：mem://project/a, mem://project/b, mem://public/c
```

超 3 条时只列前 3 个 id + `等 3 条`。**0 处**出现 `（记忆已截断：` 与 `…[截断]`（旧 `TRUNCATION_MARK`/`tailLine` 整段删除，AC-11 的变异就靠这个回退）。

`truncated` 字段保留但语义改为 `omitted.length > 0`（面板 chip 文案跟着改「有 N 条未内联」）。`injectedChars` 仍是最终文本长度，恒 ≤4000（单测钉 `chars === text.length` 且 `≤budget`）。

### 6.4 展开（AC-9/AC-10）

`createExpander`：`depth` 默认 1；`depth > MEMORY_EXPAND_MAX_DEPTH` → `EXPAND_DEPTH_EXCEEDED`（不递归、不抛）。返回 `body` 与源文件**逐字节相同**（≤4000 时），`related` 给出可直接展开的下一跳 id；`body.length > 4000` 时截断并置 `truncated: true`，同时返回 `hash`（在与源文件逐字节比对时需要，字段名 `hash?: string`）。

降级：文件不存在 / 改名 / 不可读 → `EXPAND_NOT_FOUND`（不抛异常，注入与快照都不受影响，因为注入只用 `memoryIndexOf` 的结果）。错误码到中文文案一一对应（`EXPAND_MESSAGES`）。

## 7. 子系统三：内部 Trigger 总线（AC-12~AC-19）

### 7.1 归一化（AC-12 前置）

**先探针、后代码**：`trigger-event-probe.mjs` 分别实测 `agent/status` / `subagent/end` / `agent/error` / `tools/result` 的 payload，产出「能否定位 memberId / taskId」的字段路径表，写进 §10。**未实测的字段不准出现在 `trigger.ts` 的归一化里**（AC-12 的机器判据：`grep -n "payload\." src/host/team/trigger.ts` 的每一行都必须能在 §10 表里找到对应行；`trigger.ts` 本身只接收已归一化的中间量，真正的 payload 读取全部在 `adapters.onHostTriggerEvents` 里）。

四类 Trigger 的信号源：

| kind | 即时信号（source=event） | 轮询兜底（source=poll） | 判定依据 |
|---|---|---|---|
| `gate_failed` | `receipt` 完成且 `evidence.exitCode !== 0` | tick 扫到 `task.status==='rework' && evidence.exitCode!==0` 且未记录 | 门禁退出码（AC-14 判据③） |
| `member_exit` | `agent/status` 变 `inactive/failed`（实测定位到成员时） | `reconcileMembers` 判出 `interrupted` | 成员存在性（判据④） |
| `dep_ready` | `receipt` 通过后，下游任务 `blocked→ready` | tick 内按依赖图推导 `readyTasks` | 任务状态（判据②） |
| `stall_timeout` | ——（时间型，无即时信号） | `watcher.tick` 的 `stallAlertsOf` 产出告警时 | 沿用 `STALL_MS=90_000`，**不新增阈值常量** |

`source` 的定义写死在文档里（避免自相矛盾）：`event` = 有明确触发点的即时信号（宿主 emit 或 receipt 同步完成）；`poll` = `watcher.tick`(1500ms) 内按状态推导。AC-13 只要求两者**可区分**，不要求每类都有两条通路。

### 7.2 Fast 层（AC-14：最小、可解释、零副作用）

`fastOf(trigger, ctx)` 按固定顺序判定，命中即返回：

| # | 判据 | reason |
|---|---|---|
| 1 | 会话开关关闭 | `not_enabled` |
| 2 | `kind` 不在 `TRIGGER_KINDS` | `not_listened` |
| 3 | `taskId`/`memberId` 在当前 run 里找不到 | `unknown_entity` |
| 4 | 任务状态不允许（如 `done` 又收到 `dep_ready`；`gate_failed` 但任务不是 `rework`） | `task_state` |
| 5 | `gate_failed` 但 `evidence.exitCode === 0` | `gate_exit_zero` |
| 6 | 窗口内已有同 `dedupeKey` 的 accepted 记录 | `duplicate` |
| 7 | 以上都不命中 | `ok` |

`reason` 集合恰 7 个（≤8 满足 AC-14），全部落在「事件类型 / 任务状态 / 门禁退出码 / 成员存在性 / 去重窗口」五类判据内；**过滤路径 0 处模型调用**（`grep -n "llm\|llmService\|resolveCallConfig" src/host/team/trigger*.ts` = 0）。没有 `AdmissionTable` 等价结构（全仓 `grep -rn "AdmissionTable" src` = 0）。

**dropped 零副作用**：`push()` 在 fast 层返回 dropped 时只写一条 `TriggerRecord`（`accepted:false`），**不调 `bridge.act`、不 spawn、不发消息、不改任务状态**；探针 `trigger-probe.mjs` 用 dropped 前后的快照三元组（spawn 数 / messages 数 / tasks status 序列）逐字比对。

### 7.3 去重与幂等（AC-15）

`dedupeKey = \`${kind}:${runId}:${taskId ?? memberId}\``，窗口 `TRIGGER_DEDUPE_MS = 60_000`（config 唯一定义）。判据用「最近一次 accepted 记录的 `at`」，不是时间桶——这样「连投 5 次 = 推进 1 次、记录 1 条 accepted」与「窗口过期后可再推进 1 次」都能用注入时钟精确断言。

事件 + 轮询叠加（anti-goal 4）由同一 key 天然吸收：先到者 accepted，后到者 `duplicate`。

### 7.4 推进（AC-16：唯一出口）

accepted 时按 kind 映射到**既有** action：

| kind | action | 说明 |
|---|---|---|
| `dep_ready` | `{ type:'dispatch', runId }` | 唯一自动推进（PRD 默认口味：其余三类涉及裁量） |
| `gate_failed` | `{ type:'message', taskId, text }` | 把失败证据发回原成员，转 rework 由 receipt 路径已写 |
| `member_exit` | `{ type:'resume', memberId }` | 续聊而非重派（不重复副作用） |
| `stall_timeout` | `{ type:'message', memberId, text }` | 催一次进展，不动状态 |

`bridge.act` 的 `ActResult.rejected`（如 `CONCURRENCY_FULL`）不改变 accepted 判定，但写进 `TriggerRecord.rejected` 且面板文案带出来（「因依赖完成（任务 t2）推进：并发已满，已排队等待」）。

### 7.5 面板原因（AC-17）

`triggerSentenceOf` 固定三段式：**因「<中文短语>」（<实体 id>）推进：<结果>**，例：

- `因「门禁失败」（任务 task-2）推进：已把失败证据发回成员 dev-task-2，任务转 rework`
- `因「依赖完成」（任务 task-3，前置 task-2 已过门禁）推进：已派发 1 个任务`

写入 `TriggerRecord.text`；`activityOf` 合成活动事件时把 accepted 记录也并入（`kind` 复用既有 `'gate'|'status'|'tool'|'rework'`，**不新增枚举值**），并打 `source:'trigger'`；用户点击产生的活动事件同源位置打 `source:'user'`（既有合成位置补这个字段即可）。

### 7.6 降级（AC-18）

`onHostTriggerEvents` 返回 `{ stop, degraded }`：任一事件订阅失败 → `degraded: true` + `ctx.logger.warn` + `bus.setEventSource(false)`。`watcher.tick` 每轮调 `bus.poll(state)`（在既有 `reconcileMembers → stallAlertsOf` 之后，同一次 `store.save` 之内），兜底产出 `dep_ready` 与 `stall_timeout`；`gate_failed`/`member_exit` 也都有 poll 通路，因此「事件源关闭后四类仍各有一次推进」可断言。`bridge.snapshot` 的 `degraded` 由 `deps.triggerHealth?.()` 注入。

### 7.7 预算（AC-20）

不新增 `setInterval`：`poll` 挂在既有 `watcher.tick`（`src/host/team/watcher.ts:201`）里；事件路径是 push 型（零定时器）。最坏可见延迟 = 事件 → `act` → `store.save`（毫秒级）+ 面板 2000ms 轮询 → 实测应 ≤ 3500ms，探针断言 ≤5000ms 并贴实测毫秒数。

### 7.8 Slow 层留位（AC-19）

`trigger.ts` 里只留一个常量与一段注释：

```ts
/** Slow 层（模型语义判定）默认关闭：本期零实现，切换判据见 TECHNICAL §7.8。 */
export const TRIGGER_SLOW_LAYER = false
```

`fastOf` 不读它（读了就等于有第二套分支），它只作为文档化开关出现在探针里：探针断言 `TRIGGER_SLOW_LAYER === false` 时同一批 Trigger 的 accepted/dropped 序列与「没有这个常量」逐条相同。**切换判据**（写进本文与 PRD 对齐）：Fast 层丢弃率 >30% 或每日误弃 ≥3 次 且 人工复核确认属于语义误判 → 才引入 Slow 层；引入方式为 `fastOf` 之后加一个异步 `assess(trigger)`，仍不改变 `bridge.act` 出口。

## 8. 前端：组件与页面拆分、状态管理

客户端**不新增页面、不新增 tab**（`Panel.tsx:33` 的 4 个 tab 不变），三处增量：

| 位置 | 改动 | DOM 断言锚点 |
|---|---|---|
| `src/client/Panel.tsx`（头部状态行） | 新增 `captainModel` 与 `degraded` 两个只读字段 | `data-captain-model="configured\|host-default\|unsupported"`、`data-auto-team-degraded="true\|false"` |
| `src/client/tabs/PlanTab.tsx`（顶部，「最近推进」条） | 渲染 `snapshot.activity` 里最后 3 条带 `source` 的事件：`[自动]`/`[用户]` 徽标 + `text` | 每行 `data-auto-team-trigger="<kind>"`、`data-trigger-source="trigger\|user"`；无数据时不渲染整块 |
| `src/client/viewmodel.ts` | 新增两个纯函数（可单测，已在 `test/viewmodel.test.ts` 覆盖） | — |

```ts
/* viewmodel.ts */
export interface TriggerRowView { at: number; clock: string; text: string; sourceLabel: '自动' | '用户'; kind: string }
export function recentTriggersOf(snapshot: PanelSnapshot | null | undefined, limit?: number): TriggerRowView[]
export function captainModelLabelOf(view: CaptainModelView | null | undefined): { label: string; tone: 'ok' | 'warn' | 'muted' }
```

**状态管理零改动**：新字段随既有 `GET /snapshot` 一起返回，`src/client/state.ts` 的单 timer store（活跃 2000 / 空闲 5000）原样复用——这既是 AC-20「不新增轮询」的实现方式，也是「客户端不比较阈值」的纪律延续（`TriggerRowView` 里的时钟字符串由 host 侧 `formatStamp` 同源逻辑提供，客户端不自己算）。

样式只用宿主 token，字号写 `font: var(--dsw-font-xs-13, …)` 简写（AGENTS §4 硬约定）。

## 9. 关键实现要点与边界

1. **守卫只拦 captain**：`role` 判定顺序是「命中 binding → member；`agentId === null` 或 agent 不在 bindings → captain；其余 → fail-open 放行」。成员 session 的 `sleep 30` 必须 0 拒绝（AC-5）。
2. **`tools/execute` 是 waterfall**：任何提前 `return` 都等于吞掉执行链。守卫只在拒绝分支短路，放行分支**必须** `return next()`，且中间件自身异常要 `try/catch` 后放行（守卫崩了不能把工具链带崩）。
3. **注入期与展开期必须同源**：ID 只由 `memoryIdOf` 生成，展开只由 `parseMemoryId` 解析，中间不出现第二套拼法（历史 bug 族：两处各拼一份路径）。
4. **展开不抛异常**：`createExpander` 内部全部 `try/catch` 成错误码；`bridge.expandMemory` 返回 `Result<ExpandPayload>`，工具层再翻译成 `{ ok, code, message }`。
5. **dropped 也不许静默**：落 `TriggerRecord`（`accepted:false` + `reason` + 中文 `text`），`GET /snapshot` 的 `triggers` 里可查——这是「任务没动，为什么没动」的唯一答案来源。
6. **`stall_timeout` 复用 `STALL_MS`**：不新增第二阈值，避免「面板说 90s、Trigger 说 120s」。
7. **`dep_ready` 与 `dispatch` 并发上限**：并发满时 `act` 返回 `CONCURRENCY_FULL`，不得重试风暴——去重窗口天然限制为 60s 一次。
8. **`capTriggers` 上限 100**：`RunState` 逐 run 单文件，不设上限会随事件流无限增长（与 `MESSAGES_LIMIT`/`STALL_ALERTS_LIMIT` 同源教训）。
9. **不碰三条 P3**：`src/host/index.ts:195` 的 name 兜底、peer 失败不重投、`store.list` 线性增长——本期 diff 中 0 处涉及（AC-22）。
10. **路径卫生**：探针全部进 `logs/teamflow/tf-mvwzckx8-xugsg1/scripts/`；Spill 若不落盘则无需 `.gitignore` 变更（本期不落盘，展开直接读记忆文件，故 `.gitignore` **零改动**）。

## 10. 已验证 / 未验证清单（AC-3 / AC-12 的落点）

### 10.1 已验证（本会话实跑，命令 + 返回值）

见 §2 表格六行（测试 216/216、`setInterval` 唯一处、`MEMORY_INJECT_BUDGET=4000`、`STALL_MS=90_000`、`WATCHER_INTERVAL_MS=1500`、工作树 3 行 + HEAD `9c461eb`）。

额外两条与本设计直接相关：

- `grep -rn "\.activity" src/client` → 0 命中 ⇒ AC-17 必须新增渲染位（§8 表第 2 行）。
- `grep -n "export function safeMemoryName" src/host/memory/repo.ts` → `35:` ⇒ 展开路径守门复用既有函数，不新写一套。

### 10.2 未验证（dev 阶段必须先跑探针，结论回填本表）

| 编号 | 待测 | 探针 | 不可行时的降级 |
|---|---|---|---|
| U1 | `tools/execute` waterfall 短路后，命令是否真的不执行、拒绝形状是否可读 | `captain-guard-probe.mjs` | L2 抛错 → L3 仅提示词（QA 记未验证） |
| U2 | `agent/status` / `subagent/end` / `agent/error` / `tools/result` 的 payload 能否定位成员/任务 | `trigger-event-probe.mjs` | 该类 Trigger 降级为 poll 通路（AC-18 已覆盖） |
| U3 | 主 session（队长）能否被指定模型 | `captain-model-probe.mjs` | 快照 `unsupported` + 面板/提示词说明（AC-2/AC-3） |
| U4 | `tools/execute` 里主 session 的 `exec.agent` 是否为 `undefined` | `captain-guard-probe.mjs` | 改按 sessionId 判定，仍 fail-open |
| U5 | 事件 → 面板可见的实际毫秒数 | `trigger-probe.mjs` | ≤5000 才通过；超出则记录并回退为纯 poll |

## 11. 测试与门禁策略

**单元测试（`node --test test/*.test.ts`，当前 216 例，目标 ≥240 且下限 216）**

| 文件 | 新增覆盖 |
|---|---|
| `test/guard.test.ts`（新） | 四条拒绝（sleep 30 / 1m / `bash -c 'sleep 30'` / `tail -f`）+ 四组负样本放行 + 成员 role 0 拒绝 + `sleepMsOf` 时长表 + 阈值 5000 边界 |
| `test/memory.test.ts`（改） | 内联结构（id 形态 / ≤200 / related≥1）+ 10KB 库 → ≤4000 + 0 命中两处截断标记 + omitted 可展开 + 排序不回归 |
| `test/expand.test.ts`（新） | sha256 逐字节一致 + 一跳 related + 第 3 跳 `EXPAND_DEPTH_EXCEEDED` + 删文件 `EXPAND_NOT_FOUND` + `../`/绝对路径/`~` → `EXPAND_PATH_ESCAPE` + >4000 截断 |
| `test/trigger.test.ts`（新） | 四类构造字段齐全 + kind 恰 4 + reason ≤8 且落在五类 + dropped 零副作用 + 5 投 1 推进 + 窗口过期再 1 + `triggerSentenceOf` 三段式 |
| `test/captain.test.ts`（新） | 三条硬约束短语命中 + 段落 ≤2600 + acceptance 0 命中 + `captainModelView` 三态 |
| `test/viewmodel.test.ts`（改） | `recentTriggersOf` / `captainModelLabelOf` |
| `test/wire.test.ts`（改） | 快照新字段可序列化、`activity[].source` 默认 'user' |

**探针（`logs/teamflow/tf-mvwzckx8-xugsg1/scripts/`，一律 `new URL('../../../../', import.meta.url)` 锚定仓库根）**

| 脚本 | 断言数 | 覆盖 |
|---|---|---|
| `captain-guard-probe.mjs` | ≥4（G1~G4） | 拒绝 + 无副作用标记 + 四负样本 + 成员放行 + 变异红 |
| `inline-spill-probe.mjs` | ≥5（I1~I6） | 结构 / 预算 / 深处 marker 0 命中 / sha256 / 深度 / 逃逸 / 变异红 |
| `trigger-probe.mjs` | ≥6（T1~T8） | 四类字段 / Fast 码表 / dropped 零副作用 / 幂等 / 三路一致 / 降级 / 延迟 |
| `trigger-event-probe.mjs` | 4 | 四事件 payload 形状（AC-12） |
| `captain-model-probe.mjs` | ≥1 | 队长模型可行性（AC-3） |

**提交门禁（收口前全绿，逐条进 QA-REPORT）**

```bash
pnpm typecheck && pnpm test && pnpm build
find src -name '*.ts' -newer lib/index.js | wc -l        # 期望 0
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis\.patch\.yml'   # 3 条目
grep -rn "setInterval" src                                # 仅 watcher.ts:247
grep -c "export const TRIGGER_DEDUPE_MS" src/host/config.ts   # 1
grep -rn "AdmissionTable" src                             # 0
grep -rn "（记忆已截断：\|…\[截断\]" src               # 0
```

## 12. 任务拆分（无 [PIPELINE-DISPATCHED TASKS]，按文件边界并行）

**总则（PRD §10 工程约束的 git 部分，逐条进任务书）**：就在 `feat/auto-team-plugin` 上开发，**不新建分支**；不单独 stash/回退本夹文档；功能与文档改动一次到底、**最后统一提交一笔**；提交后不再改文件；`git status --porcelain --untracked-files=all` 收口时不得夹带他人文件、不得出现项目根 `.mjs`/临时载荷。所有任务**不碰**三条 P3 与 `.gitignore`。

| # | 任务 | 改动文件（ownership） | 只读 | 依赖 | 验收要点 |
|---|---|---|---|---|---|
| T0 | 契约先行：类型 + 常量 + 落盘上限 | `src/shared/types.ts`、`src/host/config.ts`、`src/host/store.ts` | — | 无 | §3 全部字段/常量命名逐字一致；`pnpm typecheck` 0；`RunState.triggers` 有 `capTriggers(100)` |
| T1 | noWait 守卫纯逻辑 | `src/host/team/guard.ts`、`test/guard.test.ts` | `config.ts`（T0） | T0 | `guardOf` 四拒四放；成员 role 0 拒绝；零宿主 import |
| T2 | 记忆内联索引 | `src/host/memory/inject.ts`、`test/memory.test.ts` | `types.ts`、`config.ts` | T0 | `mem://` 结构 ≤200、related≥1、10KB→≤4000、0 命中旧截断标记；保留 `selectMemory` 名字 |
| T3 | 记忆展开 | `src/host/memory/expand.ts`、`test/expand.test.ts`、`src/host/memory/repo.ts`（如需导出/复用） | `repo.ts:35` `safeMemoryName` | T0 | sha256 一致、跳数上限 2、四错误码、路径逃逸三例、不抛异常 |
| T4 | Trigger 归一化 + Fast + 文案 | `src/host/team/trigger.ts`、`test/trigger.test.ts` | `types.ts`、`plan/graph.ts`、`config.ts` | T0 | kind 恰 4、reason 恰 7、dropped 零副作用、文案三段式 |
| T5 | 宿主绑定（守卫 + 事件 + 队长路由） | `src/host/adapters.ts`、`test/adapters.test.ts` | `team/guard.ts`、`team/watcher.ts` | T1 | 四个新导出；放行分支必 `next()`；订阅失败 → `degraded:true` + warn；宿主形状只在此文件 |
| T6 | Trigger 总线（幂等/推进/降级） | `src/host/team/trigger-bus.ts`、`test/trigger-bus.test.ts` | `bridge.ts`、`store.ts`、`trigger.ts` | T4 | 5 投 1 推进、窗口过期再 1、accepted 只走 `bridge.act`、`poll` 兜底 |
| T7 | 队长模型与提示词 | `src/host/team/captain.ts`、`src/host/prompt.ts`、`test/captain.test.ts` | `bridge.ts`、`config.ts` | T0 | 三条硬约束短语、段落 ≤2600、acceptance 0 命中、三态 `captainModel` |
| T8 | 集成与面板 | `src/host/index.ts`、`src/host/bridge.ts`、`src/host/tools.ts`、`src/client/Panel.tsx`、`src/client/tabs/PlanTab.tsx`、`src/client/viewmodel.ts`、`test/wire.test.ts`、`test/viewmodel.test.ts` | 全部新模块 | T1~T7 | 快照新字段齐、`expand` 工具动作通、0 新路由/0 新 action/0 新 kind、面板两处锚点可 DOM 断言 |
| T9 | 探针 + 交付自检 + 收口提交 | `logs/teamflow/tf-mvwzckx8-xugsg1/scripts/*.mjs`（+ 发现缺陷时就地修） | 全部 | T1~T8 | 五个探针全绿（变异红/绿两段齐）、§11 门禁全绿、一次到底提交、提交后不再改文件 |

并行度：T0 先做；T1/T2/T3/T4/T7 文件两两不相交 → 最多 5 路并行；T5/T6 依赖 T1/T4 但文件不相交，可与 T2/T3 并行；T8 必须等 T1~T7 全部落地（它独占所有集成点）；T9 最后。

规避的重复与冲突：`adapters.ts` 只由 T5 改（守卫、事件、队长路由三件事同源，拆开会互相踩）；`index.ts`/`bridge.ts` 只由 T8 改（装配点与快照投影是同一个事物）；`test/adapters.test.ts` 只由 T5 改。

## 13. 风险与对策

| 风险 | 触发条件 | 对策 |
|---|---|---|
| 守卫误杀（anti-goal 1） | 段首判定过宽 / 主 session 识别错 | 四组负样本进单测 + 探针；无法识别会话时 fail-open；阈值 5000ms 可配但常量单一定义 |
| 展开比截断更糟（anti-goal 2） | 摘要不含判断价值 / 要展开 3 层 | 摘要取首句 ≤60 字符 + 每条 ≥1 关联；跳数上限 2 且超限有明确码；面板显示「未内联 N 条」而不是「已截断」 |
| 事件与轮询双份（anti-goal 4） | 同一 episode 两条通路 | 同一 `dedupeKey` + 60s 窗口；探针 5 投 1 推进 |
| Fast 层膨胀 | 想把判断改成语义 | reason 恰 7 码 + 零模型调用 grep 判据 + `TRIGGER_SLOW_LAYER=false` |
| 队长模型假生效（anti-goal 5） | 宿主不支持却写 configured | `capability` 只在探针实测通过后为 `'ok'`，否则 `unsupported` |
| `tools/execute` 短路不可行（U1） | 宿主 waterfall 语义不同 | L2 抛错 / L3 仅提示词；L3 必须在 QA-REPORT 记为未验证，不得算通过 |
