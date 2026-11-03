# r13 技术方案 · 三页面板 + 自动派发 + 左栏项目库

> 基线依赖：`docs/teamflow/20261103-r11-scope-locks-acceptance/`（写域/等待/门禁语义不回归）
> 取代：`docs/teamflow/20260918-r7-*/#AC-14`（四页签 → 三页签）、`r11#AC-26`（`updateAcceptance` 允许面扩到 `done`）、`r11#AC-28`（形状扩张清单）
> 输入：`PRD.md`（28 条 AC）、`DESIGN.md`（craft 合同/几何/钩子）。本文件只写"怎么实现"，不重复设计稿的视觉规格。
> 工程基线：HEAD `0d87357`，分支 `feat/auto-team-plugin`，不新分支、不 rebase、零新增运行时依赖。

---

## 0 已验证 / 未验证（AC-19 要求的两节）

### 0.1 已验证（静态核验，2026-11-03）

| 事实 | 证据 |
|---|---|
| 路由单点 `src/host/http.ts:buildHttpRoutes`，现 3 条，传输层恒 200 + `{data}\|{error}` | 通读 `src/host/http.ts`（107 行） |
| 动作单点 `src/host/bridge.ts:864 act()`，switch 内 18 个 case，入口先判 NOT_ENABLED、再判 PAUSED | `src/host/bridge.ts:864-1460` |
| 派发单点 `src/host/team/dispatch.ts:337 dispatchReady(state, deps)`，四道闸（并发/依赖/写域/暂停）全在其中 | `src/host/team/dispatch.ts:337` |
| 装配单点 `src/host/index.ts:apply()`；`DEFAULT_SESSION='current'`；watcher 的 `onPoll` 已可插桩 | `src/host/index.ts:1-574` |
| 工具恰 8 个：`auto_team_plan/dispatch/status/message/receipt/memory/role/add_tasks` | `grep -c 'TOOL_PREFIX}' src/host/tools.ts` = 8 |
| `setInterval` 仅 `src/host/team/watcher.ts:296` 一处 | 全仓 grep |
| `sidebar.panellist` 槽位存在（list / root / replaceRisk none / `id*` `order?` `label?`） | `docs/teamflow/architecture/UI-SLOTS.md` |
| 角色管理已在设置页（`header[data-settings-roles-head]` + `RoleEditorList`），面板 RolesTab 可安全删除 | `src/client/SettingsPage.tsx` |
| 存储 v3 字段集与 `wrapLegacy` 兼容策略 | `src/host/store.ts`（489 行） |

### 0.2 未验证（必须由探针/真机补证，未证即按降级实现）

| 未验证项 | 影响 | 兜底 |
|---|---|---|
| **U1 token 归属**：根作用域 `session/event` 的 payload 是否带成员会话 id + assistant `usage` | 决定 `attribution=per-member` 是否成立 | 探针 `token-usage-probe.mjs`；不成立则 `aggregate-only`（仅 run 合计）或 `unavailable`（单元格显示"不可得"），任务/成员级一律"不可得"，**绝不估算** |
| **U2 `main` 槽位**：`UI-SLOTS.md` 无该行，第三方插件是否可注册未知 | 左栏点击能否打开主区页面 | keyed 注册 `{ name:'main', key: PANELLIST_ID }`；注册抛错则吞掉并降级为"面板内 library 视图"（`window` CustomEvent），AC-25 真机判定，失败记"未验证" |
| **U3 工作区路径归属**：run 创建时能否拿到 workspace | 项目分组 | 创建时写 `RunState.project`；缺失的旧 run 归"未知项目"（路径文案"工作区不可得"） |
| **U4 自动派发时延**：真机 3s 内是否完成 spawn | AC-8 | `kick()` 不 await、`setTimeout(0)` 排队；watcher tick 1500ms 兜底 |
| **U5 library 100 run 性能** | AC-23 | 目录 mtime+条目数缓存 + 5s TTL；冷启动实测，超标则只做 `RunSummary` 层聚合 |

> 探针脚本统一落 `logs/teamflow/<runId>/scripts/`，用 `new URL('../../../../', import.meta.url)` 锚定仓库根，支持 `--mutate=<name>` 制造反例。

---

## 1 改动面总表（文件级 ownership）

| 文件 | 动作 | 任务 |
|---|---|---|
| `src/shared/types.ts` | 改：+12 个视图/用量类型、`PanelAction` +3、`RejectionCode` +1、`ActResult.pendingId`、`PanelSnapshot`/`RunSummary`/`MemoryFileInfo` 可选字段 | T1 |
| `src/shared/const.ts` | 改：+`AUTO_DISPATCH_RETRY_LIMIT=3`、`LIBRARY_CACHE_MS=5000`、`HISTORY_PAGE_SIZE=50`、`PROJECT_RUN_LIMIT=20` | T1 |
| `src/host/format.ts` | **新增**：`formatTokens/formatCompactTokens/formatDuration/usageCellOf/durationCellOf/memoryTokenEstimate/waitedTextOf` | T2 |
| `src/host/team/usage.ts` | **新增**：`session/event` 归一 + 去重累加 + 三态判定 | T2 |
| `src/host/store.ts` | 改：`RunState` +6 可选字段、`RunSummary` +5 可选字段、`normalizeUsage/normalizeTaskTimes/normalizePending` | T2 |
| `src/host/team/auto-dispatch.ts` | **新增**：`createAutoDispatcher`（单飞/退避/幂等判定） | T3 |
| `src/host/team/dispatch.ts` | 改：spawn 成功时写 `taskTimes[taskId].startedAt` | T3 |
| `src/host/team/confirm.ts` | **新增**：`isIrreversibleAction/confirmSummaryOf/pendingFor/pendingViewOf` | T4 |
| `src/host/bridge.ts` | 改：`act` 拆 `executeAction` + 确认闸；`snapshot` 注入 usage/duration/pending；`library()`；`readMemoryFile(track,name,workspace?)`；`onRunChanged` 回调 | T4 |
| `src/host/library.ts` | **新增**：`buildLibrary/createLibraryCache/projectNameOf/isKnownWorkspace` | T5 |
| `src/host/http.ts` | 改：+`GET /library`；`/memory` 透传 `workspace` | T5 |
| `src/host/memory/repo.ts` | 改：+`listMemoryItems(dir, track): MemoryItemView[]` | T5 |
| `src/host/adapters.ts` | 改：+`onSessionEvents(ctx, handler)`（根作用域 `session/event`，fail-open） | T8 |
| `src/host/index.ts` | 改：装配 usage recorder / library cache / auto dispatcher / `onRunChanged` / watcher tick / 工具与 bridge 注入 | T8 |
| `src/host/tools.ts` | 改：`ToolsDeps` +`autoDispatch?`；plan/add_tasks/receipt 后 kick | T8 |
| `src/client/viewmodel.ts` | 改：+`buildRunDetail/buildTaskDetail/buildFlow/roleUsageOf`（唯一装配） | T6 |
| `src/client/views/*.tsx` | **新增 8 个**：`RunHeader/RoleStrip/TaskTable/FlowGraph/MemoryList/ConfirmDialog/DetailPane/EmptyState` | T6 |
| `src/client/styles.ts` | 改：追加 `AUTO_TEAM_CSS` 单串（三页/两行任务行/流转图/左栏/弹窗） | T6 |
| `src/client/tabs/*.tsx` | 改：新增 `TasksTab/HistoryTab`，重写 `MemoryTab`；**删除** `PlanTab/MembersTab/RolesTab` | T7 |
| `src/client/Panel.tsx` | 改：`TabKey` 3 值、TABS 3 项、渲染三页 + 弹窗 | T7 |
| `src/client/slots.ts` | 改：+`PANELLIST_SLOT/MAIN_SLOT`、`registerPanellist` | T7 |
| `src/client/api.ts` | 改：+`library(sessionId, runId?)`；`readMemory(..., workspace?)` | T7 |
| `src/client/state.ts` | 改：`PanelView` +`library/detail/detailRunId`；`loadLibrary/openRun/closeRun` | T7 |
| `src/client/index.ts` | 改：注册 `LibraryPage`/`PanellistEntry` | T7 |
| `docs/teamflow/architecture/UI-SLOTS.md` | 改：补 `main` 行（未验证标注） | T8 |
| `.gitignore` | 改：+`.pnpm-store/`、`*.log` | T9 |

---

## 2 数据模型与存储

### 2.1 共享类型（`src/shared/types.ts` 追加，全部可序列化）

```ts
export interface TokenTotals { input?: number; output?: number; total: number }
export type UsageSource = 'provider' | 'unavailable'
export interface UsageCell { tokens?: TokenTotals; source: UsageSource; reason?: string }

export type DurationState = 'done' | 'running' | 'not-started' | 'unavailable'
export interface DurationCell { startAt?: number; endAt?: number; ms?: number; text: string; state: DurationState }

export interface RoleUsageView { roleId: string; name: string; tasks: number; usage: UsageCell }

export interface TaskDetailView {
  id: string; title: string; roleId: string; roleName: string; status: TaskStatus
  dependsOn: string[]; acceptance: string; writeScopes?: string[]
  evidence?: GateEvidence; usage: UsageCell; duration: DurationCell
  attempts?: number; waitReason?: string; messageCount: number
}

export interface FlowNodeView { id: string; title: string; status: TaskStatus; column: number; row: number; usage: UsageCell; duration: DurationCell }
export interface FlowEdgeView { from: string; to: string; upstreamDone: boolean }
export interface FlowView { nodes: FlowNodeView[]; edges: FlowEdgeView[]; columns: number; rows: number }

export interface PendingConfirmationView {
  id: string; action: string; taskId?: string; runId: string
  createdAt: number; summary: string; irreversible: true; waitedText: string
}

export interface RunDetailView {
  runId: string; sessionId: string; project?: string
  planStatus: PlanStatus; plannedAt?: number; finishedAt?: number
  usage: UsageCell; duration: DurationCell
  roles: RoleUsageView[]; tasks: TaskDetailView[]; flow: FlowView
  pendingConfirmation?: PendingConfirmationView
}

export interface MemoryItemView { track: MemoryTrack; name: string; title: string; createdAt?: number; updatedAt: number; tokenEstimate: number; tokenBasis: 'estimate' }
export interface ProjectRunSummaryView { runId: string; planStatus: PlanStatus; plannedAt?: number; finishedAt?: number; tasks: number; done: number; usage: UsageCell; duration: DurationCell }
export interface ProjectView {
  id: string; name: string; path?: string; unknown?: boolean
  runs: number; usage: UsageCell; lastActiveAt?: number
  recentRuns: ProjectRunSummaryView[]; memories: MemoryItemView[]
}
export interface LibraryView { projects: ProjectView[]; global: { memories: MemoryItemView[] }; currentProject?: string; runs?: RunSummary[]; detail?: RunDetailView }
```

`PanelAction` 追加 3 项（18 → 21）：

```ts
| { type: 'confirmPending'; pendingId: string }
| { type: 'rejectPending'; pendingId: string }
| { type: 'forceParallel'; taskId: string }
```

`RejectionCode` 追加 `'CONFIRM_REQUIRED'`（12 → 13）；`ActResult` 追加 `pendingId?: string`。

`PanelSnapshot` 追加可选字段（均在同一"PanelSnapshot 可选字段"扩张项内，不新增形状计数）：
`pendingConfirmation?: PendingConfirmationView; runUsage?: UsageCell; runDuration?: DurationCell; project?: string; taskUsage?: Record<string, UsageCell>; taskDurations?: Record<string, DurationCell>; runs?: RunSummary[]`

`RunSummary` 追加：`project?: string; plannedAt?: number; finishedAt?: number; usageTotals?: TokenTotals; active?: boolean`
`MemoryFileInfo` 追加：`createdAt?: number; tokenEstimate?: number; tokenBasis?: 'estimate'`

### 2.2 `RunState` 扩展（`src/host/store.ts`，`RUN_STATE_VERSION` 保持 3，全字段可选）

```ts
export interface UsageRecord {
  attribution: 'per-member' | 'aggregate-only' | 'unavailable'
  byMember: Record<string, TokenTotals>   // key = memberId
  byTask: Record<string, TokenTotals>     // key = taskId
  total?: TokenTotals                     // aggregate-only 时唯一有值
  updatedAt: number
}
export interface TaskTimeRecord { startedAt?: number; endedAt?: number }

export type IrreversiblePanelAction =
  | { type: 'cancel' }
  | { type: 'cancelTask'; taskId: string; reason?: string }
  | { type: 'skipTask'; taskId: string }
  | { type: 'updateAcceptance'; taskId: string; acceptance: string }
  | { type: 'forceParallel'; taskId: string }

export interface PendingConfirmation {
  id: string; action: IrreversiblePanelAction; taskId?: string; runId: string
  createdAt: number; summary: string; irreversible: true
}

// RunState 追加：
project?: string
finishedAt?: number
usage?: UsageRecord
taskTimes?: Record<string, TaskTimeRecord>
pendingConfirmation?: PendingConfirmation
forceParallel?: string[]           // 已获准强制并行的 taskId
```

`save()` 增加归一：`normalizeUsage`（丢弃非有限/负数，`total` 缺失时按 `input+output` 补）、`normalizeTaskTimes`（毫秒整数、`endedAt<startedAt` 丢弃）、`normalizePending`（缺 `id/action/runId` 整条丢弃）。**旧 v3 文件缺字段 → 各读取点按"不可得"处理，`load` 不抛。**

### 2.3 字段写入点（每字段只有一处写）

| 字段 | 写入点 | 时机 |
|---|---|---|
| `project` | `src/host/bridge.ts` plan case | `auto_team_plan` 落盘时写 `deps.workspace`（装配层传入） |
| `plannedAt` | 既有 | plan 创建 |
| `taskTimes[id].startedAt` | `src/host/team/dispatch.ts` spawn 成功后 | 首次绑定成员成功 |
| `taskTimes[id].endedAt` | `bridge.ts` receipt/cancelTask/skipTask 落盘处 + `dispatch.ts applyReceipt` | 任务首次进入终态（已有 `endedAt` 不覆盖） |
| `finishedAt` | `bridge.ts` 每次 `saveState` 前统一计算 | 计划进入 `terminated/cancelled` 或全部任务终态 |
| `usage` | `src/host/index.ts` 的 `onSessionEvents` 回调 → `usage.applyUsage` → `store.save` | 每收到一条带 usage 的 assistant 事件（节流：同 run 500ms 合并写） |
| `pendingConfirmation` | `bridge.ts` 确认闸 | 危险动作被拦下 |
| `forceParallel` | `bridge.ts` `confirmPending` 执行 `forceParallel` | 用户确认后 |

### 2.4 用时口径（毫秒级，写死；AC-20）

- run：`plannedAt → finishedAt`；未结束 `endAt = now`，`state='running'`。
- 任务：`taskTimes[id].startedAt → taskTimes[id].endedAt`；无 `startedAt` → `state='not-started'`、`text='未开始'`；有 `startedAt` 无 `endedAt` → `running`。
- 成员：`binding.spawnedAt → 退出事件 at`（沿用既有 binding 字段，不新增）。
- 记忆：`ceil(chars / 2)`，`tokenBasis='estimate'`，UI 前缀 `≈`。
- 文本一律由宿主 `formatDuration` 生成并随 snapshot/library 下发；**客户端零拼接**。

`formatDuration(ms)` 规范（确定性、无 locale、无相对时间）：

```
非有限或 <0        → '不可得'
< 1_000            → '0 秒'
< 60_000           → `${s} 秒`
< 3_600_000        → `${m} 分 ${ss} 秒`   // ss 两位补零
< 360_000_000      → `${h} 小时 ${mm} 分`  // mm 两位补零
其余               → `${h} 小时`
```

### 2.5 用量三态与去重（AC-3/AC-19）

- 事件归一：`usageOfSessionEvent(payload)` 只认 `assistant/message`（含 `usage.totalTokens` 或 `inputTokens/outputTokens`）。成员身份按 `payload.agentId|sessionId|agent.id` 匹配 `state.bindings[].memberId`；匹配不到 → 记为 `total`（aggregate-only 候选）。
- 去重：进程内 `Map<runId, Set<eventKey>>`，key = `eventId ?? `${sessionId}:${seq}``，上限 2000 条 FIFO；去重集合**不落盘**（重启后可能重复计一次，可接受，注释写明）。
- 三态判定：首次成功按 member 归属 → `per-member`；只有无身份 usage → `aggregate-only`；两者皆无 → `unavailable`。降级只允许 `per-member → aggregate-only → unavailable` 单向。
- `0` 是合法值：`total: 0` + `source:'provider'` 显示 `0`；`source:'unavailable'` 显示 `不可得`（`title` 给 `reason`）。

---

## 3 宿主 API

### 3.1 路由总表（4 条，`src/host/http.ts`）

| 方法 & 路径 | 参数 | 返回 |
|---|---|---|
| `GET /api/auto-team/snapshot` | `sessionId` | `{data: PanelSnapshot}`（新增 `runUsage/runDuration/taskUsage/taskDurations/pendingConfirmation/project/runs`） |
| `GET /api/auto-team/library` | `sessionId`, `runId?` | `{data: LibraryView}`；带 `runId` 时 `detail` 为该 run 的 `RunDetailView` |
| `GET /api/auto-team/memory` | `track`, `name`, `sessionId?`, `workspace?` | `{data:{track,name,body,chars}}` |
| `POST /api/auto-team/act` | `{sessionId, action}` | `{data: ActResult}`（拒绝时 `data.rejected`，可能带 `pendingId`） |

传输层语义不变：HTTP 恒 200，业务错误在 body。

### 3.2 `/library` 契约

```ts
export interface LibraryDeps {
  store: RunsStore
  workspace: string
  now?: () => number
  publicMemories: () => MemoryItemView[]
  projectMemories: (workspace: string) => MemoryItemView[]
}
export function buildLibrary(deps: LibraryDeps, query: { sessionId?: string; runId?: string }): LibraryView
export function createLibraryCache(deps: LibraryDeps, ttlMs?: number): { view(q): LibraryView; invalidate(): void }
export function projectNameOf(path: string | undefined): string   // basename；undefined → '未知项目'
export function isKnownWorkspace(deps: LibraryDeps, path: string): boolean
```

- 项目集合：`store.list()` 的 `project` 去重 ∪ `deps.workspace`；无 `project` 的 run 归 `未知项目`（`id='__unknown__'`, `unknown:true`），固定末位；其余按 `lastActiveAt` 倒序。
- 每项目 `recentRuns` ≤ `PROJECT_RUN_LIMIT(20)`（`createdAt` 倒序），`memories` ≤ 50。
- `runs`（历史页用）≤ `HISTORY_PAGE_SIZE(50)`，`createdAt` 倒序。
- 缓存键：`${runsDirMtime}:${runsFileCount}:${runId ?? ''}`，命中且未过 TTL 直接返回；`snapshot` 路径**不调用** `buildLibrary`（AC-23：snapshot 期间 library 装配 0）。
- 100 run 冷启动实测（探针 `library-perf-probe.mjs`）；超标时只保留 `RunSummary` 聚合，不读 `RunState`。

### 3.3 `/memory` 的 workspace 校验

`track='project'` 且带 `workspace` 时，`workspace` 必须满足 `isKnownWorkspace()`（来自 runs 的 project ∪ 当前 workspace）且 `path.resolve` 后位于该 workspace 内；否则 `{error:'工作区不可得'}`，不读盘。`track='public'` 忽略 `workspace`。

### 3.4 `/act`：21 个动作 + 确认门禁（AC-11/12/13）

`src/host/bridge.ts` 重构为两层：

```ts
async function executeAction(sessionId: string, action: PanelAction): Promise<ActResult>  // 原 switch 原样迁入
export async function act(sessionId: string, action: PanelAction): Promise<ActResult> {
  // ① NOT_ENABLED / PAUSED 前置判断（原逻辑，paused 白名单 + confirmPending/rejectPending）
  // ② 危险动作拦截：
  if (isIrreversibleAction(action)) {
    const state = loadState(sessionId)
    if (!state) return reject('NO_PLAN', ...)
    const existing = state.pendingConfirmation
    if (action.type === 'forceParallel' && state.forceParallel?.includes(action.taskId)) return executeAction(...)
    const pending = existing ?? pendingFor(state, action, now())
    if (!existing) saveState({ ...state, pendingConfirmation: pending })
    return reject('CONFIRM_REQUIRED', `该操作不可逆，需确认：${pending.summary}`, sessionId, [], pending.id)
  }
  // ③ confirmPending：校验 id 命中 → 清空 pending → executeAction(pending.action) → 若 forceParallel 记入 state.forceParallel
  // ④ rejectPending：校验 id → 清空 → accept(notices:['已取消'])
  // ⑤ 其余：executeAction
}
```

- 同一 run 只保留 1 条未决：已有 pending 且新动作不同 → 返回**原** `pendingId` + notice「已有待确认操作，请先处理」，不覆盖、不执行（AC-13）。
- `pendingConfirmation` 不设 TTL（AC-13：未决不自动过期），`waitedText` 由 `formatDuration` 每次快照重算。
- `confirmPending` 执行时复用同一 `executeAction`，因此 `cancel/cancelTask/skipTask/updateAcceptance` 的行为与直接调用完全一致（只是多了一道闸）。
- `skipTask`/`updateAcceptance` 在 `confirmPending` 前**必须不产生任何状态变更**（AC-11 的 sha 断言）。
- 确认后 2s 内快照可见变化：`executeAction` 内 `saveState` + `onRunChanged(sessionId, runId, 'task-terminal')`。

`src/host/team/confirm.ts`：

```ts
export const IRREVERSIBLE_ACTIONS: ReadonlySet<PanelAction['type']>  // 5 个
export function isIrreversibleAction(a: PanelAction): a is IrreversiblePanelAction
export function confirmSummaryOf(action: IrreversiblePanelAction, state: RunState): string
export function pendingFor(state: RunState, action: IrreversiblePanelAction, now: number): PendingConfirmation
export function pendingViewOf(p: PendingConfirmation | undefined, now: number): PendingConfirmationView | undefined
export function waitedTextOf(createdAt: number, now: number): string
```

`summary` 文案模板（逐字，供 UI 与断言复用）：`终止运行 <runId>（将中断 N 个运行中成员）` / `中断成员 <name>（任务 <taskId>）` / `跳过任务 <taskId>（下游 M 个任务将在缺产物下继续）` / `重跑任务 <taskId> 的门禁（原验收：<前 40 字>）` / `强制并行任务 <taskId>（与 <占用任务> 写域冲突）`。

> 跳过语义（PRD §5.4 行 3）：跳过 = 「依赖视为满足」，下游**继续推进**（缺该任务的产物）。影响面文案必须说「继续」，写「阻塞」会让用户按错误影响面做不可逆决定。

### 3.5 自动派发（AC-8/9/10）

`src/host/team/auto-dispatch.ts`：

```ts
export type AutoDispatchCause = 'plan-saved' | 'task-terminal' | 'member-exit' | 'tasks-added' | 'tick'
export interface AutoDispatchDeps {
  store: RunsStore
  dispatch: (state: RunState) => Promise<DispatchOutcome>   // 与 bridge 同一条端口，绝不新开旁路
  now?: () => number
  onStatus?: (runId: string, text: string) => void
}
export interface AutoDispatchReport { runId: string; cause: AutoDispatchCause; attempted: boolean; started: string[]; failed: number; skipped: number; reason?: string }
export interface AutoDispatcher {
  kick(sessionId: string, runId: string | undefined, cause: AutoDispatchCause): void   // fire-and-forget
  tick(): Promise<AutoDispatchReport[]>
  inflight(sessionId: string): boolean
  reset(runId: string): void
  dispose(): void
}
export function createAutoDispatcher(deps: AutoDispatchDeps): AutoDispatcher
export function shouldAutoDispatch(state: RunState): { ok: boolean; reason?: string }
```

- `shouldAutoDispatch`：`plan.status ∈ {draft, dispatching}`、未 `pause`、`!paused`、存在 `ready` 且无未退役 binding 的任务、`forceParallel` 无关。
- 单飞：`Map<runId, Promise>`；已在跑 → 直接返回，不排队（下一次 tick 会补）。
- `kick` 用 `setTimeout(0)` 排队后 `void run()`，**调用方从不 await**（工具返回不等派发）。
- 退避：连续失败计数 ≥3 → 写一条 `kind:'status'` 活动「自动派发连续失败，需人工处理」并停止自动重试，直到用户显式动作（`reset`）。
- 幂等：派发前重新 `store.load`；`dispatchReady` 自身按 binding 判重（AC-10）。
- `dispatch` 端口 = `index.ts` 里传给 bridge 的同一个闭包，因此四道闸（并发/依赖/写域/暂停）不重复实现。

5 个触发点接线：

| 触发点 | 接线位置 |
|---|---|
| plan 落盘 | `tools.ts` plan 工具 `store.save` 之后 → `deps.autoDispatch?.(sessionId, runId, 'plan-saved')` |
| add_tasks | `tools.ts` add_tasks 保存后 → `'tasks-added'` |
| 任务终态 | `tools.ts` receipt 后 + `bridge.ts` receipt/cancelTask/skipTask 后 → `onRunChanged(...,'task-terminal')` |
| 成员退出 | `index.ts` ⑥ 事件订阅命中 binding 后 → `'member-exit'` |
| watcher tick | `index.ts` watcher `onPoll` 内 `await auto.tick()`（在 `bus.poll` 之前） |

`ToolsDeps` 追加 `autoDispatch?: (sessionId: string, runId: string | undefined, cause: AutoDispatchCause) => void`；`BridgeDeps` 追加 `onRunChanged?: (sessionId: string, runId: string, cause: AutoDispatchCause) => void`。工具仍 8 个，`auto_team_dispatch` 仍强制 `runId`，语义降级为手动补派。

---

## 4 前端

### 4.1 组件树

```
Panel.tsx (右栏)
├─ head / meta（不动）
├─ tablist[data-tab=tasks|history|memory]
├─ tasks   → TasksTab → RunHeader + RoleStrip[data-region=task-roles] + TaskTable[data-region=task-list] + FlowGraph[data-region=task-flow]
├─ history → HistoryTab → HistoryList ⇄ RunDetail（复用 RunHeader+RoleStrip+TaskTable+FlowGraph，面包屑返回）
├─ memory  → MemoryTab → MemoryList（track=project only）
└─ ConfirmDialog（pending 存在时渲染）

PanellistEntry → LibraryPage（main 槽位）
├─ page head（标题 + 当前项目）
├─ [data-region=project-list]（全局首行 + 项目行 + 未知项目末位）
└─ [data-region=project-detail]
   ├─ 项目头（名称/路径/run 数/成员合计/最近活跃）
   ├─ 任务区（最近 1 run 的 RunHeader + TaskTable，只读）
   ├─ 项目记忆（MemoryList track=project）
   └─ DetailPane（项目/任务/记忆三类详情，内联展开 + 面包屑）
```

### 4.2 `src/client/views/` 组件契约（8 文件，均为纯展示、无取数）

```ts
// RunHeader.tsx
export function RunHeader(props: { detail: RunDetailView; paused?: boolean; inflight: 'dispatching'|'dispatched'|'idle'; onTogglePause?: () => void }): React.ReactElement
// RoleStrip.tsx
export function RoleStrip(props: { roles: RoleUsageView[] }): React.ReactElement
// TaskTable.tsx
export function TaskTable(props: { tasks: TaskDetailView[]; expandedTaskId?: string; onToggleTask: (taskId: string) => void }): React.ReactElement
// FlowGraph.tsx
export function FlowGraph(props: { flow: FlowView; onSelectTask: (taskId: string) => void }): React.ReactElement
// MemoryList.tsx
export function MemoryList(props: { items: MemoryItemView[]; track: MemoryTrack; expanded?: string; body?: string; bodyError?: string; onOpen: (item: MemoryItemView) => void }): React.ReactElement
// ConfirmDialog.tsx
export function ConfirmDialog(props: { pending: PendingConfirmationView; busy?: boolean; onConfirm: () => void; onReject: () => void }): React.ReactElement
// DetailPane.tsx
export function DetailPane(props: { breadcrumb: string[]; onBack: () => void; children: React.ReactNode }): React.ReactElement
// EmptyState.tsx
export function EmptyState(props: { title: string; hint?: string }): React.ReactElement
```

钩子（只加不改名）：`data-tab`、`data-region`（`run-head/task-roles/task-list/task-flow/project-list/project-detail`）、`data-cell="token"|"duration"`、`data-usage-source="provider"|"unavailable"`、`data-duration-state`、`data-flow-node=<taskId>`、`data-auto-team-history-row=<runId>`、`data-auto-team-memory-item=<track>/<name>`、`data-auto-team-nav`、`data-confirm-dialog`、`data-pending-badge`、`data-inflight-dispatch`。

### 4.3 唯一装配 `buildRunDetail`（AC-18/AC-7）

```ts
// src/client/viewmodel.ts
export interface RunDetailSource {
  snapshot: PanelSnapshot | null
  runDetail?: RunDetailView            // library 下发的历史 run 详情
  library?: LibraryView | null
}
export function buildRunDetail(source: RunDetailSource, runId?: string): RunDetailView | null
export function buildTaskDetail(task: PlanTask, ctx: { roleName: string; usage?: UsageCell; duration?: DurationCell; messageCount: number }): TaskDetailView
export function buildFlow(tasks: PlanTask[]): FlowView
export function roleUsageOf(tasks: TaskDetailView[], roles: Role[]): RoleUsageView[]
```

- 当前 run：`source.snapshot` 的 `tasks/taskUsage/taskDurations/runUsage/runDuration/pendingConfirmation` → `RunDetailView`。
- 历史 run：`source.runDetail` 原样返回（宿主已装配，客户端不重算）。
- 右栏与左栏都只调 `buildRunDetail`，禁止各自拼装；AC-7 用 deep equal 断言两处文本逐字相同。
- 客户端**不出现**任何时长/千分位格式化（无 `formatDuration`、无"分/小时/秒"字面量），全部用宿主下发的 `text`。

### 4.4 状态管理

- `src/client/state.ts`：`PanelView` 追加 `library: LibraryView | null; libraryError: string | null; detail: RunDetailView | null; detailRunId: string | null`；`PanelStore` 追加 `loadLibrary(runId?): Promise<void>`（5s 缓存）、`openRun(runId)`、`closeRun()`。snapshot 轮询逻辑与 `isActiveSnapshot` 不变。
- 页签本地状态放模块级 `Map<TabKey, { scrollTop: number; expandedTaskId?: string }>`，切页签不整页重挂载（AC-23）。
- 历史页首屏 50 条来自 `snapshot.runs`；"加载更多" 每次 +50（上限 `runs` 全量）。
- 左栏打开时才 `loadLibrary()`；`snapshot` 期间不触发 library 请求（AC-23）。

### 4.5 左栏注册（AC-14/AC-24）

`src/client/slots.ts` 追加：

```ts
export const PANELLIST_SLOT = 'sidebar.panellist'
export const MAIN_SLOT = 'main'
export const PANELLIST_ID = `${PLUGIN_ID}-panellist`
export function registerPanellist(ctx: SlotsContext, deps: { PanellistEntry: React.ComponentType<unknown>; LibraryPage: React.ComponentType<unknown> }): void
```

- panellist：`ctx.slots.inject(PANELLIST_SLOT, () => ctx.slots.register({ name: PANELLIST_SLOT, id: PANELLIST_ID, order: 20, label: '自动团队' }, deps.PanellistEntry))`，包 `ctx.effect`。
- main：`ctx.slots.register({ name: MAIN_SLOT, key: PANELLIST_ID, inject }, deps.LibraryPage)`，同样包 `ctx.effect`；**整段 try/catch**，失败只 warn（U2 未验证）。
- 打开主区：优先 `ctx.get('mainArea')?.open?.(PANELLIST_ID)`；不存在则 `window.dispatchEvent(new CustomEvent('auto-team:open-library'))`，由 Panel 监听并切到内联 library 视图（降级，AC-14 真机判定）。
- `docs/teamflow/architecture/UI-SLOTS.md` 补 `main` 行并标"未验证"。

### 4.6 交互与边界

- 任务行整行点击展开（`aria-expanded`/`aria-controls`），点流转节点展开对应任务行并 `scrollIntoView({block:'nearest'})`。
- 弹窗：默认焦点"取消"，`Esc` 取消，Tab 循环，`role="dialog" aria-modal`；打开期间收到快照只更新 `summary/waitedText`，不重置焦点。
- 空态 4 处（任务页无计划 / 历史空 / 记忆空 / 全局空）；错误就地 `[data-error] role="alert"` 并保留上次成功内容；无 usage 时 run 头一行降级说明，**不复用空态**。
- 派发在途 `● 正在派发…` + `data-inflight-dispatch="dispatching"`；完成后 `dispatched` 保留 3000ms 再回 `idle`。

---

## 5 关键实现点与边界

1. **自动派发绝不走 `bridge.act`**：AC-8 断言 `dispatch` 动作调用为 0，必须直调 `dispatch` 端口（`DispatchOutcome`）。
2. **paused 双闸**：`dispatchReady` 内部已有暂停判断；`shouldAutoDispatch` 再判一次 `state.paused`，避免 tick 期间被手动暂停后仍派发。
3. **写域**：自动派发不绕过 `releaseScopes/applyScopeWaits`；`forceParallel` 只把 taskId 写入 `state.forceParallel`，由 `dispatchReady` 的写域闸读取（T3 在 `dispatch.ts` 的写域判断处加 `state.forceParallel?.includes(task.id)` 放行）。
4. **确认闸位置**：在 NOT_ENABLED/PAUSED 之后、`executeAction` 之前；`toggle/pause` 等可逆动作不受影响。
5. **`updateAcceptance` 扩面**：允许面从 r11 的 `{done? 否}` 扩到 `done`（`taskActionAllowed('updateAcceptance', 'done')` 放行），但必须经确认；确认后落新命令并重跑门禁，结论走 `applyReceipt`（通过保持 `done` 并刷新证据，失败转 `rework`）。
6. **旧 run 兼容**：`project/finishedAt/usage/taskTimes` 缺失 → 项目归"未知项目"、用时"不可得"、token"不可得"；`load` 永不抛。
7. **面板未开时**：pending 仍落盘，用户下次打开面板即见弹窗（R7），不做超时/自动执行。
8. **性能**：`snapshot` 只读 1 个 run 文件；`library` 走缓存；`store.list()` 现有实现逐个读文件，100 run 冷启动实测（U5），超标则改为先读目录 mtime + 只解析 `RunSummary` 必要字段。
9. **错误解包**：客户端一律 `const { data, error } = await api.xxx()`；`error` 存在时保留上次成功数据（历史高频 bug 族）。
10. **文案唯一**：所有时长/千分位/等待时长文本由 `src/host/format.ts` 生成；客户端只渲染。

---

## 6 测试策略

### 6.1 新增单测（`node --test test/*.test.ts`，目标 ≥565 例）

| 测试文件 | 覆盖 |
|---|---|
| `test/format.test.ts` | `formatDuration` 边界（0/999/1000/59s/60s/59m59s/1h/99h/≥100h/负数/NaN）、`formatTokens`、`memoryTokenEstimate`、`waitedTextOf` 确定性 |
| `test/usage.test.ts` | 事件归一（per-member/aggregate/unavailable 三态）、去重、跨续聊累加、0 合法、未知 payload fail-open |
| `test/auto-dispatch.test.ts` | 单飞、幂等、退避 ≥3、`shouldAutoDispatch` 各闸、`forceParallel` 放行 |
| `test/confirm.test.ts` | 5 类危险动作识别、summary 文案、单 pending、确认/拒绝、`forceParallel` 幂等 |
| `test/library.test.ts` | 全局首行、path 去重 ∪ workspace、未知项目末位、`recentRuns` 上限、workspace 越权拒绝、缓存命中不重算 |
| `test/viewmodel.test.ts` | `buildRunDetail` deep equal（snapshot 与 library 两路）、`buildFlow` 列/边数、无 usage 时 `source='unavailable'` |
| `test/client-ui.test.ts` | 三页签节点、旧页签 0、任务行 1 token + 1 duration 单元格、`data-usage-source`、弹窗焦点/Esc |
| `test/store.test.ts` | 旧 v3 夹具可读、新字段全可选、`version` 仍 3、坏 usage 被归一 |

### 6.2 探针（`logs/teamflow/<runId>/scripts/`，可复跑 + `--mutate`）

- `token-usage-probe.mjs`：打印 `ATTRIBUTION=per-member|aggregate-only|unavailable` + 证据行；`--mutate=no-usage` 必须输出 `unavailable`。
- `auto-dispatch-probe.mjs`：假 store + 假 dispatch 端口，5 个触发点各跑一遍；`--mutate=<cause>` 去掉该触发点必须变红。
- `confirm-gate-probe.mjs`：10 例矩阵（5 危险 × 确认/拒绝），确认前比对 run 文件 sha 与成员数。
- `library-perf-probe.mjs`：生成 100 run 夹具，冷/热计时（≤1000ms / ≤100ms），并断言 `snapshot` 期间 `buildLibrary` 调用 0。
- `shape-probe.mjs`：PanelAction 21 / 路由 4 / RejectionCode 13 / 工具 8 / TaskStatus 13 / kind 9 / PlanStatus 5 / `setInterval` 1 / `sessionOf` 1。

### 6.3 回归与真机

- `pnpm -s typecheck` 0 错；`pnpm -s build`；两条 `import` 探针；`npm pack --dry-run` 含 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`。
- 真机（AC-25）：第二宿主 51890 + CDP，断言 AC-1/3/5/6/8/11/13/14/16；未通过项在 ACCEPTANCE 记"未验证"，不得写成通过。

---

## 7 任务拆分（与流水线派发对齐；文件边界互斥）

> 依赖图：`T1 → (T2 ∥ T3 ∥ T4 ∥ T5 ∥ T6) → T7 → T8 → T9`。T2–T6 文件集两两不相交，可并行。

### T1 契约层（shared）
- 文件：`src/shared/types.ts`、`src/shared/const.ts`
- 读：`src/host/store.ts`、`src/host/bridge.ts`（只读不改）
- spec：按 §2.1 落全部类型；`PanelAction` +3、`RejectionCode` +1、`ActResult.pendingId`；`PanelSnapshot/RunSummary/MemoryFileInfo` 可选字段；常量 4 个。禁止改既有字段名/枚举值。
- 验收：`pnpm -s typecheck && grep -q "confirmPending" src/shared/types.ts && grep -q "CONFIRM_REQUIRED" src/shared/types.ts`

### T2 用量与时长（宿主纯逻辑）
- 文件：`src/host/format.ts`(新)、`src/host/team/usage.ts`(新)、`src/host/store.ts`、`test/format.test.ts`、`test/usage.test.ts`
- 读：`src/shared/types.ts`、`src/host/paths.ts`
- spec：§2.4 全部格式化函数；§2.5 事件归一/去重/三态；`RunState/RunSummary` 扩展 + `normalize*`；`load` 对旧数据不抛。
- 验收：`pnpm -s typecheck && node --test test/format.test.ts test/usage.test.ts test/store.test.ts`

### T3 自动派发
- 文件：`src/host/team/auto-dispatch.ts`(新)、`src/host/team/dispatch.ts`、`test/auto-dispatch.test.ts`
- 读：`src/shared/types.ts`、`src/host/store.ts`、`src/host/team/scope-locks.ts`、`src/host/plan/scope.ts`
- spec：§3.5 全部；`dispatch.ts` 在 spawn 成功后写 `taskTimes[id].startedAt`；写域闸读 `state.forceParallel`。
- 验收：`pnpm -s typecheck && node --test test/auto-dispatch.test.ts test/dispatch.test.ts test/scope.test.ts`

### T4 确认门禁
- 文件：`src/host/team/confirm.ts`(新)、`src/host/bridge.ts`、`test/confirm.test.ts`
- 读：`src/shared/types.ts`、`src/host/store.ts`、`src/host/plan/acceptance.ts`
- spec：§3.4；`act` 拆两层；`snapshot` 注入 `pendingConfirmation/runUsage/runDuration/taskUsage/taskDurations/project/runs`；`library()` 与 `readMemoryFile(...,workspace?)` 的签名先落（实现可先返回空/直读，T5/T8 补齐）。
- 验收：`pnpm -s typecheck && node --test test/confirm.test.ts test/bridge.test.ts test/pause.test.ts`

### T5 项目库
- 文件：`src/host/library.ts`(新)、`src/host/http.ts`、`src/host/memory/repo.ts`、`test/library.test.ts`
- 读：`src/host/store.ts`、`src/shared/types.ts`、`src/host/paths.ts`
- spec：§3.2/§3.3；`GET /library`；`/memory` 透传 workspace 并校验；`listMemoryItems`。
- 验收：`pnpm -s typecheck && node --test test/library.test.ts test/memory.test.ts`

### T6 前端视图与样式
- 文件：`src/client/viewmodel.ts`、`src/client/views/*.tsx`(8 新)、`src/client/styles.ts`、`test/viewmodel.test.ts`、`test/client-ui.test.ts`
- 读：`src/shared/types.ts`、`DESIGN.md`、`src/client/ui.ts`
- spec：§4.2/§4.3；`buildRunDetail` 唯一装配；全部钩子；CSS 追加到 `AUTO_TEAM_CSS` 单串；字号用 `font:` 简写；无 `#hex`、无新 token。
- 验收：`pnpm -s typecheck && node --test test/viewmodel.test.ts && ! grep -rn "font-size: var(--dsw-font" src/client`

### T7 面板与左栏页面
- 文件：`src/client/Panel.tsx`、`src/client/tabs/{TasksTab,HistoryTab,MemoryTab}.tsx`、`src/client/tabs/{PlanTab,MembersTab,RolesTab}.tsx`(删)、`src/client/slots.ts`、`src/client/api.ts`、`src/client/state.ts`、`src/client/index.ts`、`test/client-contract.test.ts`
- 读：`src/client/views/*`、`src/shared/types.ts`、`UI-SLOTS.md`
- spec：§4.1/§4.4/§4.5/§4.6；旧页签文件删除且 DOM 无旧钩子；`registerPanellist` 容错；`api.library`；`state` 扩展。
- 验收：`pnpm -s typecheck && node --test test/client-contract.test.ts test/client-ui.test.ts && ! grep -rn "data-tab=\"plan\"\|data-tab=\"members\"\|data-tab=\"roles\"" src/client`

### T8 装配接线 + 文档补录
- 文件：`src/host/index.ts`、`src/host/adapters.ts`、`src/host/tools.ts`、`docs/teamflow/architecture/UI-SLOTS.md`、`test/wire.test.ts`、`test/host-contract.test.ts`
- 读：全部宿主模块
- spec：§3.5 五个触发点接线；`onSessionEvents`（`session/event`，fail-open，订阅失败 warn 不抛）；`createLibraryCache` 注入 bridge；`autoDispatch` 注入 tools/bridge；watcher `onPoll` 先 `auto.tick()`；UI-SLOTS 补 `main` 行（标未验证）。
- 验收：`pnpm -s typecheck && node --test test/wire.test.ts test/host-contract.test.ts test/tools.test.ts`

### T9 交付自检 + 回归 + 提交（含 PRD 工程约束）
- 文件：`.gitignore`
- 读：无
- spec：
  1. 全量 `pnpm -s test`（≥565）、`pnpm -s typecheck`、`pnpm -s build`、两条 import、`npm pack --dry-run` 三件；
  2. 跑 §6.2 探针，`--mutate` 必须变红；把结论（含 `ATTRIBUTION=`）写进 `docs/teamflow/20261103-r13-panel-tabs-sidebar/QA-REPORT.md` 的输入清单**之外**的自检结论段（自检只记录结论，不写 QA 报告/验收报告）；
  3. `.gitignore` 追加 `.pnpm-store/`、`*.log`；
  4. **git 动作（PRD §12 必须落实）**：留在 `feat/auto-team-plugin`，把两个未跟踪目录 `docs/teamflow/20261103-r12-panel-three-tabs/`、`docs/teamflow/20261103-r13-panel-tabs-sidebar/` 一并入库，P0 全绿后**单笔提交** `feat(panel): 三页面板 + 自动派发 + 左栏栏目（r13）`，提交后 `git status --porcelain` 必须为空；不改分支、不 rebase、不 amend 历史。
- 验收：`pnpm -s typecheck && pnpm -s test 2>&1 | grep -E 'ℹ (tests|pass|fail)' && npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis.patch\.yml' && test -z "$(git status --porcelain)"`

---

## 8 风险与降级

| 风险 | 触发条件 | 降级（必须实现） |
|---|---|---|
| R1 token 归属不可得 | 探针 `ATTRIBUTION=unavailable` | 单元格"不可得" + `data-usage-source="unavailable"` + title 原因；run 头一行说明；**不估算** |
| R2 `main` 槽位不可用 | 注册抛错/页面不出现 | 吞错 + `auto-team:open-library` 事件 → 面板内联 library 视图；记"未验证" |
| R3 workspace 缺失 | 旧 run 无 `project` | "未知项目"末位，路径文案"工作区不可得" |
| R4 自动派发竞态 | 多触发点同时到 | 单飞 + 幂等 + 每次重新 `store.load`；失败退避 3 次 |
| R5 library 性能 | 100 run 冷启动 >1s | 只聚合 `RunSummary`；必要时按目录 mtime 缓存 |
| R6 旧 run 缺字段 | v3 老文件 | 全可选 + 读取点判空；`load` 不抛 |
| R7 面板未开时无人确认 | 危险动作 pending | 挂起不超时、不自动执行；打开面板即见 |
| R8 页签数量 | 三页签注册链路 | 沿用 r6/r7 已验证的三步注册，不改 key/kind |

---

## 9 AC → 实现 / 证据映射（摘）

| AC | 实现落点 | 证据 |
|---|---|---|
| AC-1 | `Panel.tsx` TABS 3 项 + 删旧 tabs | `data-tab` 计数 3；旧钩子 grep 0 |
| AC-2 | TasksTab 三 `data-region` | DOM 断言 |
| AC-3 | `TaskTable` 单元格 + `data-usage-source` | 改标题字符数 token 不变 |
| AC-4 | `buildFlow` + `FlowGraph`（纯 SVG/div） | 节点/边计数；依赖库 grep 0 |
| AC-5 | `snapshot.runs` + `HistoryTab` | 第 2 条 run 任务集合不同 |
| AC-6 | `MemoryTab` 只 project + `/memory` | PUBLIC-ONLY 不出现、正文逐字 |
| AC-7 | `buildRunDetail` 单源 | 两处文本 deep equal；客户端无时长格式化 |
| AC-8 | `auto-dispatch.ts` 5 触发点 | 零动作 3s 内 spawn；`dispatch` action 0；变异红 |
| AC-9 | 复用 `dispatchReady` 四道闸 | 4 例 |
| AC-10 | `tools.ts` runId 强校验不变 | 工具 8；重复 dispatch 新增 0 |
| AC-11/12/13 | `confirm.ts` + `bridge.act` | 10 例矩阵 + sha 不变 + 单 pending |
| AC-14/15/16/17 | `library.ts` + `LibraryPage` | DOM + 文件清单 diff |
| AC-18 | shared 类型 + `buildRunDetail` | deep equal |
| AC-19 | §0 两节 + 探针 | `ATTRIBUTION=` 行 |
| AC-20 | `taskTimes/finishedAt` + `formatDuration` | 重读逐毫秒相同 |
| AC-21 | `store.ts` 全可选 | 旧 v3 夹具可读 |
| AC-22 | 形状探针 | 9 个计数 |
| AC-23 | 缓存 + 按需 | 冷/热计时 |
| AC-24 | `registerPanellist` | panellist/main 各 1 处；UI-SLOTS 补行 |
| AC-25 | 第二宿主 51890 | CDP 断言或"未验证" |
| AC-26/27/28 | T9 | 回归 + 单笔提交 + memory.md 回填（验收阶段） |

---

## 10 验证命令（提交前全绿）

```bash
pnpm -s typecheck
pnpm -s test
pnpm -s build
node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js'); console.log('IMPORT_OK')"
npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis.patch\.yml'
node logs/teamflow/<runId>/scripts/shape-probe.mjs
node logs/teamflow/<runId>/scripts/token-usage-probe.mjs
node logs/teamflow/<runId>/scripts/auto-dispatch-probe.mjs
node logs/teamflow/<runId>/scripts/confirm-gate-probe.mjs
node logs/teamflow/<runId>/scripts/library-perf-probe.mjs
git status --porcelain
```
