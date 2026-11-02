# 技术方案 · r11 团队范围控制（team-scope-control）

> 基线：`docs/teamflow/20261102-r11-team-scope-control/PRD.md`（40 AC）+ `DESIGN.md`（13 态 / 三动作 / 两块新区域）。
> 本方案把 PRD 里「留待技术方案定」的九处全部裁决（§7），并把 40 条 AC 落到具体文件与命令。
> 工程约束：分支 `feat/auto-team-plugin` 继续、单笔提交、只改本仓。

## 0. 一页结论

| 层 | 一句话 | 落点 |
|---|---|---|
| 契约 | 扩值不扩结构：`TaskStatus` 10→13、`PanelTask.writeScopes/waitingOn/waitReason`、快照 +`scopeLocks/deviations`、`PanelAction` 15→18、工具 7→8 | `src/shared/types.ts` |
| 纯函数 | 写域归一/冲突、验收模板、13×3 允许表、deviation 合并 —— **全部无 IO、可单测** | `src/host/plan/scope.ts`、`plan/acceptance.ts`、`shared/task-actions.ts`、`team/deviation.ts` |
| 编排 | 不落锁表：每轮按「running/gate 持有写域 × 计划顺序」现算 waiting，终态释放并记一条通知 | `src/host/team/scope-locks.ts` + `dispatch.ts` |
| 入口 | 空验收拦截只在**工具入口**（`tools.ts`），`buildPlan` 保持宽容 —— 否则既有 484 例里手工构造 `acceptance:''` 的样本全红 | `src/host/tools.ts` |
| 面板 | 零新增槽位/路由/动作种类：写域区块与执行痕迹塞进既有计划页，三动作走既有 `POST /act` | `src/client/tabs/PlanTab.tsx`、`viewmodel.ts`、`ui.ts`、`styles.ts` |
| 存储 | RunState 不新增顶层字段（AC-28）；留痕走仓库外 JSONL，fail-open | `<home>/.dsh/auto-team/deviations.jsonl` |

## 1. 影响面与不改的东西

- 改：`shared/types.ts`、`shared/task-actions.ts`（新）、`host/config.ts`、`host/paths.ts`、`host/plan/{plan,graph,scope,acceptance}.ts`、`host/team/{dispatch,watcher,scope-locks,deviation}.ts`、`host/gate/gate.ts`、`host/tools.ts`、`host/bridge.ts`、`host/adapters.ts`、`host/index.ts`、`host/store.ts`、`client/{viewmodel,ui,styles}.ts`、`client/tabs/PlanTab.tsx`。
- **不新增**：HTTP 路由（仍 3 条）、`ActivityEvent.kind`（仍 9）、`setInterval`（仍 1 处）、`sessionOf`（仍 1 处）、槽位注册（仍与 r10 相同）。
- 不动：`src/host/roles/*`、`memory/*`、`model-catalog.ts`、`settings.ts`、`client/{slots,api,state,Panel}.tsx` 的结构。

## 2. 数据模型与存储

### 2.1 `src/shared/types.ts`

```ts
export type TaskStatus =                      // 10 → 13（AC-28 允许的唯一状态扩张）
  | 'pending' | 'blocked' | 'ready' | 'running' | 'paused' | 'gate'
  | 'done' | 'rework' | 'failed' | 'interrupted'
  | 'waiting' | 'cancelled' | 'skipped'

export interface PlanTask {
  /* 既有字段不变 */
  writeScopes?: string[]      // 归一后的仓库相对路径；缺省/空数组 = 不限写域
  waitingOn?: string[]        // waiting 时：冲突的 holder 任务 id（只会在 running/gate 上）
  waitReason?: string         // waiting 或 blocked 时：宿主生成的整句中文，client 逐字渲染
}

export interface ScopeLockView { path: string; holderTaskId: string; holderMember?: string
  waiters: Array<{ taskId: string; member?: string; reason: string }> }
export interface DeviationView { at: number; sessionId: string; toolName: string
  paths: string[]; reason: string; count: number }

export interface PanelSnapshot { /* 既有 */ scopeLocks: ScopeLockView[]; deviations: DeviationView[] }

export type PanelAction =
  | /* 既有 15 个 */
  | { type: 'cancelTask'; taskId: string; reason?: string }
  | { type: 'skipTask'; taskId: string }
  | { type: 'updateAcceptance'; taskId: string; acceptance: string }
```

**快照两字段必给**（空数组而不是缺省），理由与 r7 `paused`/r10 `systemSkills` 同族：client 不做「缺字段=空」的推断，否则「宿主没投影」与「真的没有」在界面上一模一样。

### 2.2 持久化：不扩字段、不升版本

- `RunState` **不新增任何顶层字段**（AC-28 白名单）；写域信息全部挂在 `PlanTask` 上，锁表**不落盘**（AC-16）。重启后 `deriveScopeLocks(tasks)` 现算，顺序天然等于计划顺序。
- `store.ts` 的 `TASK_STATUSES` 白名单必须同步加 `waiting/cancelled/skipped`，否则读盘时新状态被 `normalizeTask` 归回 `pending`（症状：重启后等待中的任务变成待派发，锁被静默丢掉）。`normalizeTask` 同时保留 `writeScopes/waitingOn/waitReason`（数组去空、字符串 trim）。
- `RUN_STATE_VERSION` 保持 `3`：新字段全可选，旧 run 文件可直接读，不需要 `wrapLegacy` 新分支。

### 2.3 留痕文件（F7）

- 路径：`<home>/.dsh/auto-team/deviations.jsonl`，由 `paths.ts` 新增 `deviationsPath(home)` 提供（`globalDataRoot(home)` 已含 `.dsh`，**不要再拼一次**）。
- 行格式（单行 JSON）：`{ at, sessionId, toolName, paths, reason, count }`；`reason` 截断 120 字；`paths` 为归一路径（工作区内绝对路径转相对，工作区外保留绝对）。
- 合并：同 `toolName + 排序后 paths` 且距上一行 < `DEVIATION_MERGE_MS`(60_000) → **改写最后一行**（`count+1`、`at` 更新），不追加新行；否则追加。这样「×N」直接来自文件，面板不需要二次折叠。
- 轮转：行数 > `DEVIATION_LINE_LIMIT`(500) 时重写文件只保留最后 250 行（避免无限增长）。
- fail-open（AC-23）：所有读写包在 `try/catch`，失败仅 `logger.warn` 一次（模块内 `warned` 标记），**绝不改变工具结果、绝不抛**。

## 3. 纯函数层（零 IO、可单测、可变异）

### 3.1 `src/host/plan/scope.ts`

```ts
export function normalizeWriteScopes(input: unknown): { ok: true; scopes: string[] } | { ok: false; error: string }
export function scopesConflict(a: string, b: string): boolean
export function conflictingScopes(holder: readonly string[], target: readonly string[]): string[]
export function deriveScopeLocks(tasks: readonly PlanTask[], bindings?: readonly MemberBinding[]): ScopeLockView[]
export function waitReasonOf(holderTaskId: string, path: string): string   // 「等待 t2 释放 src/host/bridge.ts」
```

- 归一（AC-12）：`\` → `/`、折叠 `//`、去 `./` 前缀、去尾 `/`、去首 `/`；**拒绝**空串元素、绝对路径（`/` 或 `C:`）、含 `..` 段（防止逃出仓库）。元素去重并排序（排序让内容指纹稳定）。
- 冲突（AC-13）：`a === b` 或 `b.startsWith(a + '/')` 或 `a.startsWith(b + '/')`。**禁止**裸 `startsWith`：`src/host` 与 `src/hostile.ts` 必须不冲突（变异点）。
- `deriveScopeLocks`：holder = `status ∈ {running, gate}` 且有非空 `writeScopes`；waiter = `status === 'waiting'` 且与 holder 冲突；同路径多个等待者合并进同一 `waiters` 数组（DESIGN §3.3）。`reason` 取 `task.waitReason`，缺省用 `waitReasonOf` 现算。

### 3.2 `src/host/plan/acceptance.ts`

```ts
export const ACCEPTANCE_TEMPLATES: readonly [string, string, string]
export const ACCEPTANCE_TEMPLATE_BLOCK: string        // 三条原文按换行拼接，供工具/门禁复用
export interface AcceptanceInput { title: string; description?: string; writeScopes?: readonly string[]
  scripts?: readonly string[] }                        // scripts = 仓库 package.json 的 scripts key
export interface AcceptanceSuggestion { command: string | null; reason: string; template: string }
export function suggestAcceptance(input: AcceptanceInput): AcceptanceSuggestion
export function emptyAcceptanceError(violations: readonly { id: string; title?: string }[],
  suggestions?: ReadonlyMap<string, AcceptanceSuggestion>): string
```

三条模板原文（**逐字**，禁止 `pnpm lint`——本仓无此脚本，PRD 反目标 4）：

1. `pnpm typecheck`（脚本名从 `scripts` 里按 `typecheck → lint → test` 顺序挑第一个真实存在的）
2. `grep -RIn --fixed-strings '<标识符>' <scope> >/dev/null`
3. `test -n "$(git status --porcelain -- <路径>)"`

选择顺序（确定性、无随机）：① 有 `writeScopes` 且 `scripts` 命中 → 命令 1；② 标题/描述里有反引号标识符（`` `name` ``）→ 命令 2（`<scope>` 取写域首元素，无写域取 `.`）；③ 有 `writeScopes` 无标识符 → 命令 3（多个路径空格连接）；④ 都不满足 → `command: null`，`reason` 含「**选不出**」三字 + 三条模板原文 + 需补的参数名（`标识符` / `路径` / `脚本名`）。
每条模板必须在自检样本上真跑：通过样本 `bash -c` exit 0、失败样本非 0（单测里真跑，共 6 次，AC-4）。

### 3.3 `src/shared/task-actions.ts`（13×3 的**唯一**来源）

```ts
export type TaskActionName = 'cancel' | 'skip' | 'edit-acceptance'
export const TASK_ACTION_ALLOW: Record<TaskStatus, { cancel: boolean; skip: boolean; acceptance: boolean }>
export function taskActionAllowed(action: TaskActionName, status: TaskStatus): boolean
export function taskActionDisabledReason(action: TaskActionName, status: TaskStatus): string
export const TASK_STATUS_LABELS: Record<TaskStatus, string>   // 13 条中文
```

- 放 shared 而不是 host/client 各写一份：**宿主的允许集与面板的 disabled 矩阵必须由同一张表派生**，否则 AC-27 的「矩阵与允许集一致」只能靠人眼比对，第一次改允许集就会分叉。
- `viewmodel.ts` 的 `BADGES` 文案改为读 `TASK_STATUS_LABELS`（tone/percent 仍留在 `BADGES`）——文案单点不变，宿主拒绝文案与面板徽标逐字一致。
- 允许集裁决（§7.1）：`cancel` = `{pending, blocked, ready, waiting, running, rework, failed}`；`skip` = `{pending, blocked, ready, waiting}`；`acceptance` = 除 `{done, cancelled, skipped}` 外全部。

### 3.4 `src/host/team/deviation.ts`

```ts
export function isCaptainWriteTool(name: string): boolean          // 只认 write / edit（可带命名空间前缀）
export function deviationPathsOf(toolName: string, args: unknown): string[]   // write: path|file_path / edit: file_path
export function deviationKeyOf(record: Pick<DeviationView, 'toolName' | 'paths'>): string
export function mergeDeviation(prev: DeviationView | null, next: DeviationView, windowMs: number):
  { record: DeviationView; merged: boolean }
export function appendDeviation(file: string, record: DeviationView, windowMs: number, limit: number): boolean
export function readDeviations(file: string, limit: number): DeviationView[]
export function createDeviationRecorder(deps: DeviationRecorderDeps): DeviationRecorder
// DeviationRecorder = { record(input: { toolName: string; args: unknown }): void; recent(limit?: number): DeviationView[] }
```

队长判定（AC-22）：只认 `exec.agent` **缺省**（主 session 可能不给 `agent`，与 noWait 守卫同一口径 `src/host/team/guard.ts` 的 `agentId === null → captain`）。带 `agent.id` 的一律当成员，**不记**。
`reason` 取「队长直接写入 <paths>」这类一句中文，超 120 字截断；`sessionId` 由装配层注入（`DEFAULT_SESSION`，与工具/路由同一值）。

## 4. 编排层

### 4.1 新增 `src/host/team/scope-locks.ts`（唯一的锁语义实现）

```ts
export function scopeHoldersOf(state: RunState): Array<{ taskId: string; scopes: string[]; member?: string }>
export function waitFor(state: RunState, task: PlanTask, claimed?: readonly string[]):
  { holderTaskId: string; path: string } | null
export function applyScopeWaits(state: RunState, now: number): RunState
export function releaseScopes(state: RunState, holderTaskId: string, at: number): RunState
export function releaseMessageBody(holder: PlanTask, path: string, waiter: PlanTask): string
```

- `scopeHoldersOf`：只算 `running|gate`（AC-17「等待边只指向 running」的结构保证：**没有任何路径能让 waiting 依赖 waiting**）。
- `waitFor`：先比对 `scopeHoldersOf(state)`，再比对 `claimed`（本轮已 spawn 的任务 id）——同批重叠按计划顺序串行（AC-17），不拒绝、不报错。
- `applyScopeWaits`（每轮 dispatch 开头、每次动作后调用，幂等）：① 对有冲突的 `waiting` 任务刷新 `waitingOn/waitReason`；② 无冲突的 `waiting` → `pending`（下一轮自然被 `readyTasks` 取到）。
- `releaseScopes`：5 种终态（`done/failed/cancelled/skipped/interrupted`）各调用一次；对每个真正等待它的任务追加**一条** `MessageRecord`：
  - `messageId = rel-<holder>-<waiter>-<seq>`，`seq = 1 + 已有同前缀消息数`；
  - `from='captain'`、`to=waiter.member ?? 'task:<id>'`、`taskId=waiter 任务 id`；
  - 正文含 holder id + 冲突路径 + 「可以接着改」：`t2 已结束并释放 src/host/bridge.ts，你可以接着改（任务 t3）。`
  - **幂等**：调用点先判「本次调用真的把状态从非终态改成终态」，重放同一次回执不会二次释放（AC-18）。不新增持久字段（AC-28）。

### 4.2 `src/host/team/dispatch.ts` 改造（4 处）

1. 开头 `next = applyScopeWaits(next, now())`（把上一轮释放的等待者放回 pending）。
2. 循环内、`slots` 判定**之前**：`const wait = waitFor(next, task, started)`；命中 → `patchTask(status:'waiting', waitingOn:[holder], waitReason: waitReasonOf(holder, path))`，`continue`，**不消耗 slot、不 spawn**（AC-14）。`slots` 只由 `runningCount()`（`running|gate`）决定，`waiting` 天然不占位。
3. `applyReceipt` 里 3 个终态分支（done/failed/giveUp→failed）各接一次 `releaseScopes`；`rework` 不释放。
4. 任务结算的「全部终止」判定改为 `done|failed|cancelled|skipped`（否则取消/跳过后计划永远停在 `dispatching`）。

### 4.3 依赖语义（AC-26 / AC-17 的公共前提）

- `graph.ts` 新增 `export function depSatisfied(status: TaskStatus): boolean`（`done | skipped`），`readyTasks` 与 `blockedTasks` 改用它；`applyReceipt` 的解锁分支同样改用 `depSatisfied`。
- `cancelTask` 后：下游 `pending/ready/waiting` → `blocked` 且 `waitReason = 上游 t2 已取消`；`skipTask` 后：下游按 `depSatisfied` 自然解锁（`blocked → pending`）。

### 4.4 watcher / stall / resume 边界（PRD 待澄清 F3）

- `watcher.tick` 的停滞告警只看 `running`（现有实现已按绑定与进度判），`waiting` 无成员、无 binding，天然不进告警；`resumeRun` 的候选集保持 `running|gate|interrupted`，**不得**把 `waiting` 拉进来（否则每次续跑都给等待者重起人）。
- `cancelTask` 对 `running` 的成员：调用新增可选端口 `interruptMember(name)`（`ctx.agentTeams.interrupt(captain, name)`），失败只 warn、不回滚状态（状态是权威，成员后面由 watcher 对账）。

## 5. API 设计

### 5.1 工具 8 个（`src/host/tools.ts`）

| # | 名称 | 变更 |
|---|---|---|
| 1 | `auto_team_plan` | description 明示「单任务计划也合法」；schema +`writeScopes`；**空 acceptance 整批拒绝**（不落盘） |
| 2 | `auto_team_dispatch` | 不变（notices 增加 waiting 说明） |
| ... | message / receipt / resume / memory | 不变 |
| 8 | **`auto_team_add_tasks`**（新） | `{ runId: string, tasks: PlanTaskInput[] }` |

`auto_team_add_tasks` 返回
`{ ok: true, runId, added: string[], skipped: string[], tasks: number }`；
失败 `{ ok: false, code, error }`（`NO_PLAN` / `NOT_FOUND`（runId 不匹配）/ `BAD_REQUEST`（已终止 run、空验收、图非法））。
判定全在纯函数 `plan/plan.ts` 新增：

```ts
export function taskFingerprint(task: Pick<PlanTask,'title'|'roleId'|'dependsOn'|'acceptance'|'writeScopes'>): string
export function extendPlan(plan: Plan, inputs: readonly PlanDraftTask[], now: number):
  { ok: true; plan: Plan; added: string[]; skipped: string[] } | { ok: false; reason: string }
```

- 幂等（AC-9）：`taskFingerprint` = 归一 JSON 字符串（title/roleId/排序 dependsOn/acceptance/排序 writeScopes）；同指纹任务已存在 → `skipped`，`added` 为空、`plan.tasks.length` 不变、`runId` 不变。
- 原子：先全量构造候选任务 → `validateGraph`（含跨批依赖）→ 全过才写；任一失败整批不落盘，返回 `reason` 含违规任务 id。
- id：`t<next>`，`next = max(现有 /^t(\d+)$/ 的数字) + 1`；若与非 `t\d+` 的自定义 id 冲突则继续递增。

### 5.2 `PanelAction` 三个新动作（走既有 `POST /act`，不新增路由）

| 动作 | 允许 | 拒绝 | 副作用 |
|---|---|---|---|
| `cancelTask{taskId, reason?}` | `pending/blocked/ready/waiting/running/rework/failed` | `done/cancelled/skipped/paused/gate/interrupted` | 状态→`cancelled`；running 先 `interruptMember`；下游未完成者→`blocked`+`waitReason`；`releaseScopes`；notice「任务 t2 已取消，下游 t3 转为阻塞」 |
| `skipTask{taskId}` | `pending/blocked/ready/waiting` | 其余全部（`running` 文案「运行中请先取消」） | 状态→`skipped`；依赖视为满足 → 下游 `blocked→pending`；`releaseScopes` |
| `updateAcceptance{taskId, acceptance}` | 除 `done/cancelled/skipped` 外全部 | 三种终态 | trim 后写 `plan.tasks[i].acceptance`；空串 → `BAD_REQUEST` + `emptyAcceptanceError` 全文；**不改已完成证据** |

拒绝一律 `rejected.code='BAD_REQUEST'`、`message` 含任务 id 与当前状态中文（取 `TASK_STATUS_LABELS`）。`paused` 不进 `PAUSED_BLOCKED`（这三个动作不改计划状态机，改验收在暂停期间必须可用）。

### 5.3 快照与路由

`snapshot()` 增加：

```ts
scopeLocks: deriveScopeLocks(state.plan.tasks, state.bindings),
deviations: deps.deviations?.recent(DEVIATION_SNAPSHOT_LIMIT) ?? [],
```

路由仍 3 条（`snapshot` / `memory` / `act`），`test/host-contract.test.ts` 的计数断言不变。

## 6. 前端

### 6.1 文件与组件拆分（零新增槽位，AC-21）

| 文件 | 变更 |
|---|---|
| `client/viewmodel.ts` | `BADGES` +3（文案读 `TASK_STATUS_LABELS`）；`TASK_PROGRESS` +3；新增 `scopeLockRowsOf(snapshot)`、`deviationRowsOf(snapshot)`、`taskActionsOf(task)`、`waitReasonOf(task)` |
| `client/ui.ts` | `taskRowView` 增加 `waitReason` / `actions`；新增 `scopeLockRowView`、`deviationRowView` |
| `client/tabs/PlanTab.tsx` | 渲染写域区块（动作行与任务表之间）+ 等待条（`[data-task-acceptance]` 与 `[data-task-foot]` 之间）+ 三动作按钮 + 改验收浮层 + 执行痕迹（页面最末） |
| `client/styles.ts` | 新选择器的 token 化样式（字号一律 `font: var(--dsw-font-*, …)`） |

### 6.2 渲染结构（data-* 逐字，供 QA 断言）

```
[data-scope-locks] > [data-locks-head]「写域占用 · {n} 处」
  > [data-lock-list] > [data-lock-row][data-task-id] > code[data-lock-path] + [data-lock-holder] + [data-lock-waiters] > [data-lock-waiter]
[data-task-row] > p[data-wait-reason][role=note][data-task-id]（仅 waiting 且非空）
[data-task-foot] > span[data-task-actions] > button[data-task-action="cancel|skip|edit-acceptance"]
[data-acceptance-editor][role=dialog][aria-modal=false] > textarea[data-acceptance-input] + 保存/取消
[data-deviation] > [data-deviation-list] > [data-deviation-row] > [data-deviation-at|tool|paths|count|reason]
```

空数组一律**不挂载**（0 节点），不渲染空壳。

### 6.3 状态管理（沿用模块级单例 store，不新增 store）

- 三个动作全部走 `act({type:'cancelTask'|'skipTask'|'updateAcceptance'})`，返回的 `snapshot` 由 store 直接写回（不额外 refresh）。
- **非乐观**：点击后 `busyTask = taskId` → 该任务三个按钮整组 `disabled` + 转环；快照回来才改徽标（DESIGN §0.1）。
- 改验收浮层本地态：`editingTaskId` + `draft`；`draft.trim()===''` → 保存按钮 `disabled` 且**不发请求**（AC-27）；保存失败保留输入与浮层，错误进 `[data-error]`；Esc 关闭。
- 读接口纪律：`snapshot` 字段一律判空（`snapshot?.scopeLocks ?? []`），不解构 `{data,error}` 的那一层在 `api.ts` 已收口。

### 6.4 文案与零拼装

`waitReason`、`scopeLocks[].reason`、`deviations[].reason` **全部渲染快照原文**；client 只允许前置任务 id 与成员名。中文常量集中在 `viewmodel.ts` / `PlanTab.tsx` 顶部（沿既有习惯），不散落在 JSX 里。徽标文案只来自 `BADGES`（其 text 来自 `TASK_STATUS_LABELS`），组件里不许出现第二个 status switch。

## 7. 关键裁决（PRD「待技术方案定」的九处）

1. **三态允许集**（DESIGN §3.4 备注）：`paused` / `gate` / `interrupted` 的 cancel 与 skip **一律不允许**，`acceptance` 允许。理由：`gate` 正在跑门禁，取消会与回执写回竞态；`paused` 由页头「继续任务」统一还原；`interrupted` 的出路是续聊/改验收后重派。改这张表只改 `TASK_ACTION_ALLOW` 一处，UI 自动跟随。
2. **空验收拦截点**：只在 `tools.ts` 的两个入口（plan / add_tasks）。`buildPlan` 与 `extendPlan` 保持宽容（既有测试直接构造 `acceptance:''`），`runGate('')` 行为不变（仍人工确认 + 追加模板）。
3. **skipped 视为依赖满足**：`depSatisfied(status)` 是唯一判定口，graph/applyReceipt 共用。
4. **waiting 不占并发**：`runningCount()` 只数 `running|gate`；`waiting` 不进 `readyTasks`（靠 `applyScopeWaits` 放回 `pending`），因此不会每轮刷新 `waitingOn` 漂移。
5. **无锁表**：锁由 `scopeHoldersOf` 现算；重启后第一轮 `applyScopeWaits` + plan 顺序重算，结果确定。
6. **通知幂等**：`rel-<holder>-<waiter>-<seq>` + 「只在真的从非终态转终态时释放」双保险；重放/续 histories 不重复。
7. **deviation 只记 write/edit**：`bash` 写文件不记（PRD T6）；记录失败不改变工具结果。
8. **模型判定队长**：`exec.agent` 缺省即队长（与 guard 同口径）；有 `agent.id` 一律成员。
9. **模板命令真跑**：`pnpm typecheck` 之外的两条都是 POSIX 原语（`grep`/`test`），不依赖仓库脚本，也不会像 `git diff --quiet` 那样方向反了必失败。

## 8. 测试策略

新增（4 个文件，均 `node --test` 直跑 TS）：

| 文件 | 覆盖 AC | 关键用例 |
|---|---|---|
| `test/scope.test.ts` | AC-12/13/14/16/17 | 归一 12 组（含 `./a//b/`、绝对、`..`、空串）；冲突真值表 ≥8 组（`src/host` vs `src/hostile.ts` 必不冲突）；`deriveScopeLocks` 合并同路径等待者；`waitReason` 逐字；**改裸 startsWith 必红** |
| `test/acceptance.test.ts` | AC-4/5/6/7 | 三类输入各一条命令；6 次 `bash -c` 真跑（3 通过样本 exit 0、3 失败样本非 0）；`command===null` 且 reason 含「选不出」+ 三条原文；`emptyAcceptanceError` 含违规 id；`runGate('')` 前缀逐字保留 |
| `test/task-actions.test.ts` | AC-26/27 | 39 格矩阵快照（`TASK_ACTION_ALLOW` 展开）；13 条标签齐全；client 与 host 都从本表派生 |
| `test/deviation.test.ts` | AC-22/23/24 | 路径提取（write/edit/相对/绝对）；60s 内合并 count+1、窗口外新行；目录不可写时 `record()` 不抛且返回 false；`recent()` 上限 |

扩展现有：`dispatch.test.ts`（waiting 不占并发、5 终态释放、重启重算、同批串行）、`bridge.test.ts`（3 动作 allow/deny 各 2 例、快照两字段、下游 blocked/pending）、`host-contract.test.ts`（工具数 8、路由 3、`sessionOf` 1 处）、`client-contract.test.ts` / `client-ui.test.ts`（data-* 与 disabled 矩阵、空数组 0 节点、空验收不发请求）。

门禁（提交前全绿，数字进 QA-REPORT）：

```bash
pnpm typecheck && pnpm test && pnpm build
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis\.patch\.yml'
grep -c 'auto_team_' src/host/tools.ts            # 8 个工具
grep -rn "agent?.id" src/host | wc -l             # 1（sessionOf）
grep -rn 'setInterval' src | wc -l                # 1
```

## 9. 任务拆分（文件边界互斥 → 可并行）

| ID | 任务 | 改（ownership） | 读 | 验收 |
|---|---|---|---|---|
| T1 | 契约与纯函数 | `shared/types.ts`、`shared/task-actions.ts`、`host/plan/scope.ts`、`host/plan/acceptance.ts`、`host/paths.ts`、`host/config.ts`、`test/scope.test.ts`、`test/acceptance.test.ts`、`test/task-actions.test.ts` | PRD §AC-4~7/12~14/26 | `pnpm typecheck` + 3 个新 test 绿（含 6 次真跑模板） |
| T2 | 编排：等待/释放/依赖 | `host/team/scope-locks.ts`、`host/team/dispatch.ts`、`host/plan/graph.ts`、`host/plan/plan.ts`、`host/team/watcher.ts`、`host/gate/gate.ts`、`host/store.ts`、`test/dispatch.test.ts`、`test/graph.test.ts` | T1 types | `node --test test/dispatch.test.ts test/graph.test.ts` 绿；waiting 不占并发用例 + 5 终态释放用例 |
| T3 | 工具层 | `host/tools.ts`、`test/tools.test.ts` | T1 acceptance/scope、T2 extendPlan | 工具数 8；空验收整批拒绝且 store 不变；add_tasks 幂等/原子/跨批依赖 |
| T4 | 面板动作与留痕 | `host/bridge.ts`、`host/adapters.ts`、`host/team/deviation.ts`、`host/index.ts`、`test/bridge.test.ts`、`test/deviation.test.ts` | T1/T2/T3 契约 | 3 动作 allow/deny 各 2 例；快照 `scopeLocks/deviations`；`tools/result` 订阅 fail-open |
| T5 | 前端 | `client/viewmodel.ts`、`client/ui.ts`、`client/tabs/PlanTab.tsx`、`client/styles.ts`、`test/client-contract.test.ts`、`test/client-ui.test.ts` | T1 `TASK_ACTION_ALLOW`、DESIGN §3.2~3.6 | 13 态全有徽标行；39 格 disabled；空数组 0 节点；空验收 0 请求；`: 320px` 不横向溢出 |
| T6 | 收口（主 agent） | `docs/teamflow/memory.md`（四条约定，替换同主题行）、`lib/`（build 产物） | 全部 | 单笔提交 + `git status --porcelain --untracked-files=all` 为空 + 报告 commit hash 与门禁数字；**不得**新开分支、**不得**改 AGENTS.md 正文 |

依赖：T1 → （T2 ∥ T3 ∥ T4 ∥ T5）→ T6。T2/T3/T4 共享 `plan.ts`/`graph.ts` 的风险已切开：`plan.ts`/`graph.ts` 归 T2，T3 只调 `extendPlan` 不改它。
git 约束（PRD 工程约束）必须原样带进 T6 的 spec：分支 `feat/auto-team-plugin` 继续、单笔提交、`lib/` 双产物入库、只改本仓、不碰 `~/.dsh/profiles/desktop`。

## 10. 风险与未验证

- **真机（AC-38，P1）**：`tools/result` 上队长调用的 `exec.agent` 是否真缺省，只在 r11 事故复盘里确认过 guard 的口径；若真机给了主 session 的 agent，deviation 会一条不记 —— 判据：跑一次队长 write，看 `deviations.jsonl` 是否有行；没有则把判定放宽为「agent.id === captain 会话 id」并记录证据。
- **320px 容纳**：写域区块若挤，唯一降级是把整块移到成员页末尾（结构与文案不变），不改 data-*。
- **`interrupt` 未实测**：`agentTeams.interrupt(caller, name)` 的返回形状未知，`interruptMember` 端口按 `{ok, error?}` 宽松归一，失败只 warn；不影响 `cancelled` 状态落盘。
- **模板命令依赖环境**：`grep`/`test` 在 Windows 原生 shell 不可用；本项目探针与门禁都在 macOS/Linux shell 下跑，PRD 未要求跨平台，若后续要支持需在模板层加平台分支（本期不做，记入 memory）。
