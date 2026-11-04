# r14 技术方案 · 派发受理制 / 无限画布 / 角色卡片 / 进度环 / 项目库抽屉

> 基线依赖：`docs/teamflow/20261103-r13-panel-tabs-sidebar/`（PRD r14 编号 AC-1～AC-22）。
> 取代：r13#AC-2（角色条+任务表）、r13#AC-4（静态流转图）、r13#AC-15（项目页 run 标题/归属）、r13#AC-17（内联详情）。
> 实现语言：TypeScript；单包双产物 `lib/index.js`(ESM) / `lib/client.js`(CJS)；零新增依赖；0 新增设计 token。
> 本文件是开发唯一实现依据；几何/视觉细则见 `DESIGN.md`，验收判据见 `PRD.md`。

---

## 0. 判定摘要（先读这 8 行）

1. **P0 的确定性成因是插件工具链在等 spawn**：`auto_team_dispatch` → `bridge.act({type:'dispatch'})` → `dispatchReady()` → `await deps.spawn()`（60s 桩下整条工具调用一起挂住）。修法不是改宿主管辖，而是**工具改「受理制」**：同步预检 + `autoDispatcher.kick()` + 立即返回，spawn 在后台跑。
2. **桥的面板派发路径保持 r13 同步语义**（本次不改）：它不在 AC-1 范围内，改成异步会牵动 bridge/pause/wire/confirm 四组既有测试的断言语义。两侧共用同一个**同步预检**，所以拒绝码与判据只有一份。
3. **失败可见性不走新形状**：`snapshot.activity` 已存在、`kind:'status'` 已在 9 个枚举内。装配层用一个进程内通知环（cap 5）把「本批 spawn 全失败」的文案并进 `activityOf()`，下次快照（idle 档 4s）就能看到；同时 `auto_team_status` 增加 `dispatch` 段。
4. **`project` 的根因是一行漏写**：`RunState.project` 与 `store.list()` 的投影早已存在，只是 `auto_team_plan` 从不赋值。修法：`ToolsDeps.workspace`（装配层注入 `paths` 同源的 workspace）+ plan 落盘时写入。
5. **`goal` 同源**：`PlanDraft.goal` 本来就在，`buildPlan()` 把它丢了；`Plan.goal?` → `RunSummary.goal?` → `ProjectRunSummaryView.goal?` 一条链补上，客户端单点截断 24 字。
6. **角色卡片的 6 个新字段必须有唯一算法**：今天的角色聚合在宿主 `library.ts#rolesOf` 与客户端 `viewmodel.ts#roleUsageOf` **各写一份**（r13 遗留漂移风险）。r14 抽 `src/shared/role-view.ts#roleStateOf`，两侧都调它 —— AC-9/AC-17 的「文本逐字相等」由构造保证，而不是靠对齐。
7. **画布拖动只写 DOM transform**（rAF 合帧），`pointerup` 才回写 React state；否则 60 帧拖动 = 60 次重排，AC-22 的 ≤20ms 帧间隔必崩。
8. **形状普查零扩张**（除 AC-18 允许的 5 类可选字段）：`PanelAction` 21 / HTTP 路由 4 / `RejectionCode` 13 / `ActivityEvent.kind` 9 / `TaskStatus` 13 / 工具 8 / `setInterval(` 1 处。

---

## 1. 勘察结论（既有事实，实现不得再猜）

| 事实 | 位置 | 对方案的影响 |
|---|---|---|
| `RunState.project?: string` 已存在且落盘/投影都支持 | `src/host/store.ts:115`、`save()`、`list()`、`wrapLegacy` | 只补「写入点」，不做迁移 |
| `store.list()` 输出 `RunSummary`（含 `project`，无 `goal`） | `src/host/store.ts:236-262` | 加一个可选 `goal` |
| 项目分桶按 `summary.project` **原始字符串**做 key，当前工作区同时入列 | `src/host/library.ts:380-407` | plan 必须写入**与 `LibraryDeps.workspace` 完全相同的字符串**（绝对路径），否则同一个工作区会裂成两个桶 |
| `ProjectRunSummaryView` 由 `projectRunViewOf()` 装配 | `src/host/library.ts:435` | 加 `goal` |
| 未知项目常量 `UNKNOWN_PROJECT_ID='__unknown__'` / `UNKNOWN_PROJECT_NAME='未知项目'` | `src/host/library.ts:41-44` | 只改名与文案，id 不动（客户端按 `unknown` 标志与末位处理） |
| `Bridge` 是 `createBridge(deps)` 返回的对象，方法面已固定（`snapshot/act/library/readMemoryFile/...`） | `src/host/bridge.ts:280-317,339` | 新增**一个**同步方法 `precheckDispatch`，不改既有方法签名 |
| `act` 入口有 PAUSED 闸门（拦 dispatch/resume/receipt） | `src/host/bridge.ts:~334` | 预检必须复用它，不能只抄 dispatch 分支 |
| `autoDispatcher.kick()` 已是 fire-and-forget（`setTimeout(0)`、按 runId 单飞、连续失败退避） | `src/host/team/auto-dispatch.ts` | 工具只需调它，不需要第二套调度 |
| `onRunChanged`（bridge 每次 save 后）已 `kick` + 失效 library 缓存 | `src/host/index.ts:436-440` | 预检路径若 save，会自动补一次 kick；单飞吸收，不会重复起人 |
| `activityOf()` 已合并 `stallAlerts`、`triggers`（复用 `kind:'status'`） | `src/host/bridge.ts:548-620` | 派发失败文案走同一条合并路径，不新增字段 |
| 客户端快照两档轮询：`PANEL_ACTIVE_MS` / `PANEL_IDLE_MS`（idle = 4s） | `src/client/state.ts:118-119` | 「5s 内可见」由 4s 档满足 |
| 已存在容器查询用法 | `src/client/styles.ts:2981,3048` | 分栏的 `<560px` 降级用 `@container`，不是新技术 |
| `PlanDraft.goal?: string` 已存在，`buildPlan()` 未写回 `Plan` | `src/host/plan/plan.ts:18-23,64-74` | 一行补写 |
| `ToolsDeps` 无 workspace；`auto_team_plan` 构造 `RunState` 时只写 `plan/messages/bindings/routeAudits` | `src/host/tools.ts:31-52,235-270` | 加 `workspace?` 并写 `state.project` |
| 客户端 `buildRunDetail(source)` 三源优先级 `runDetail → library.detail → snapshot` | `src/client/viewmodel.ts` | 抽屉与右栏共用它，无需新装配 |
| `openRun/closeRun` 已在 `PanelStore` 里（带 5s 记忆缓存） | `src/client/state.ts:308-322` | 抽屉复用它，不新增请求 |

---

## 2. 数据模型与存储

### 2.1 shared 形状（**只加 AC-18 允许的可选字段**）

| 类型 | 新增 | 语义 |
|---|---|---|
| `Plan` | `goal?: string` | 计划目标原文（trim 后非空才写；旧 run 缺省） |
| `RunSummary` | `goal?: string` | `store.list()` 从 `plan.goal` 投影 |
| `ProjectRunSummaryView` | `goal?: string` | 项目页 run 行标题的来源 |
| `FlowNodeView` | `roleName?: string` | 角色展示名（缺失=F5 场景，客户端回退 roleId） |
| `RoleUsageView` | `done?`、`state?: RoleStateKind`、`stateText?`、`activeTaskId?`、`activeTaskTitle?`、`duration?: DurationCell` | 角色卡片所需的全部派生量，**宿主算一次** |

不新增 `RunState` 字段（`project`/`usage`/`taskTimes` 已在 r13 就位）。`RUN_STATE_VERSION` 仍为 3。

### 2.2 写入点（单点，不许第二处）

```ts
// src/host/tools.ts — auto_team_plan handler（唯一新建 RunState 的地方）
const workspace = (deps.workspace ?? '').trim()
const state: RunState = {
  version: RUN_STATE_VERSION,
  plan: draft.plan,                       // draft.plan 已含 goal
  plannedAt: at,
  messages: [],
  bindings: [],
  routeAudits: [],
  ...(workspace === '' ? {} : { project: workspace }),
}
```

- `ToolsDeps.workspace?: string`：由 `src/host/index.ts` 用**同一个** `workspace`（`options?.workspace ?? process.cwd()`，与 `LibraryDeps.workspace` 同源）注入。可选是为了不打断既有 `test/tools.test.ts` 的构造；**装配层必须传**，由 `test/wire.test.ts` 的端到端用例钉住（plan 落盘后 `store.load(...).project === workspace`）。
- 旧 run：`project` 缺省 → 落「历史运行（未记录工作区）」桶，不猜测、不迁移（AC-14）。
- `wrapLegacy()` 必须透传 `plan.goal`（`typeof raw.plan.goal === 'string'` 才写），保证 v1 裸 Plan 升级不丢字段。

### 2.3 读路径

```
Plan.goal ──► store.list() ──► RunSummary.goal ──► projectRunViewOf() ──► ProjectRunSummaryView.goal
                     └────────► LibraryView.runs（历史页）
```
客户端 `runTitleOf(goal, runId)` 单点截断（见 §4.4），组件不截断。

---

## 3. 宿主接口设计

### 3.1 P0：派发受理制（AC-1 / AC-2 / AC-3）

**工具路径（新语义）：**

```
auto_team_dispatch(runId)
  ├─ runId 非空校验（既有）
  ├─ bridge.precheckDispatch(sessionId, runId)      ← 同步、只读、不 spawn
  │    ├─ !ok → { ok:false, code, error }           ← 与 r13 同码同文案
  │    └─ ok  → 拿到 { runId, ready, unbound }
  ├─ deps.autoDispatch?.(sessionId, runId, 'manual')  ← fire-and-forget（setTimeout 0）
  └─ 立即返回 { accepted:true, dispatching:true, runId, planStatus, ready, tasks, members, notices }
```

- 工具**不再** `await deps.bridge.act(...)`；`autoDispatch` 未装配时**明确失败**（`accepted:false` + `error:'派发端口未装配（宿主未接自动派发），请在面板派发'`），绝不假装受理。
- 返回必须区分两态（AC-1）：`accepted`/`dispatching` = 已受理；成员创建完成由下一次 `auto_team_status`/快照呈现（`members.length>0`、任务 `running`）。文案逐字：`已接受派发：成员在后台创建，失败会显示在活动流`。
- 队长轮不等：handler 是同步逻辑（无 `await`），宿主的工具调用立即结束（实测桩：spawn 60s 下 ≤1s）。

**面板路径（不变）**：`bridge.act('dispatch')` 仍 `await deps.dispatch(state)` 并回 notice「已创建 N 个成员」。理由见 §0.2。两侧共用 `precheckDispatch` 的判据（act 分支改为先调它，再执行），所以「能不能派」永远一个答案。

**预检契约（`src/host/bridge.ts`）：**

```ts
export type DispatchAdmission =
  | { ok: true; runId: string; ready: string[]; unbound: string[] }
  | { ok: false; code: RejectionCode; message: string }

// Bridge 新增一个方法，不改既有签名
precheckDispatch(sessionId: string, runId?: string): DispatchAdmission
```

判定顺序（与 `case 'dispatch'` 逐条一致，抽成内部 `admissionOf(state, action)` 供两处调用）：
`loadState → NO_PLAN` → `runId 不匹配 → NOT_FOUND` → `status ∉ {draft,dispatching} → NO_PLAN` → **PAUSED 闸门**（复用 act 入口的 `pausedRejectionOf`）→ `status==='dispatching' && unbound.length===0 → PLAN_ALREADY_DISPATCHED`。

### 3.2 后台结果与失败可见（AC-3）

`AutoDispatcher` 增补三个**可选**端口与一个只读方法（既有测试不传即不受影响）：

```ts
interface AutoDispatchDeps {
  // …既有 store / dispatch / now / onStatus
  /** 本批 spawn 全失败（started===0 && errors>0）或 dispatch 抛错时立刻播报（AC-3 的「5s 内可见」）。 */
  onError?: (runId: string, text: string) => void
  /** 有成员真的起来后清掉上一次失败文案（避免面板一直挂着旧红字）。 */
  onClear?: (runId: string) => void
}
interface AutoDispatcher {
  // …既有 kick / tick / inflight / reset / dispose
  /** 本进程内最近 ≤5 条派发报告（`auto_team_status` 的 `dispatch` 段）。 */
  reportsOf(sessionId: string): AutoDispatchReport[]
}
```

`AutoDispatchReport` 增补 `errors: string[]`（本批错误文案；无错为空数组）。`AutoDispatchCause` 增补第 6 个 `'manual'`（工具显式派发；语义与 `'plan-saved'` 不同，报告里要能区分）。

**可见性两条腿，都不改形状：**

1. **面板活动流**：新增 `src/host/team/dispatch-notices.ts`：
   ```ts
   export interface DispatchNoteStore {
     add(runId: string, text: string): void      // cap 5，同 run 覆盖旧的前缀行
     clear(runId: string): void
     recent(runId: string): ActivityEvent[]      // kind:'status', source:'trigger', at=入队时刻
   }
   export function createDispatchNotes(now?: () => number): DispatchNoteStore
   ```
   装配层把 `onError` 接到 `warn(ctx)` + `notes.add(runId, text)`，`onClear` 接 `notes.clear`；同时给 `createBridge` 传 `dispatchNotices?: { recent(runId): ActivityEvent[] }`，`activityOf(state)` 末尾并入并按 `at` 排序。**只存内存**（同 `inflightRuns` 的取舍：进程重启后「这次失败」不再是事实）。
2. **`auto_team_status`**：追加 `dispatch` 段（`cause/attempted/started/failed/skipped/reason/errors`），来源 `deps.dispatchReports(sessionId)`（装配层接 `autoDispatcher.reportsOf`）。AC-3 的「下一次 status 可读」由此满足。

失败时任务**不会**变 `running`：`dispatchReady` 只在 `await deps.spawn()` 成功后写 binding/`task.status='running'`，失败路径不落任何状态。
连续 3 次失败仍走既有 `AUTO_DISPATCH_STALLED_TEXT='自动派发连续失败，需人工处理'`（r13 行为不变，AC-3 后半）。

### 3.3 队长提示词（AC-2）

`src/host/prompt.ts` 的 `CAPTAIN_CONSTRAINTS` 追加一条（逐字，供 grep 断言）：

> `- **派发后立即结束本轮，不要等待成员**：auto_team_dispatch 返回「已接受派发」即表示后台已接手；成员不是宿主队友、不需要你等，也不要在同一轮反复查状态或轮询——用户会带着进展回来。`

同时把第 7 条压缩为一句，控制 `captainSection` 仍在 `test/captain.test.ts` 的 ≤2600 字符预算内（现约 2430，净增 ≤120 字）。
「不等待」只加在**插件提示词**里，不改 `~/.dsh/profiles/desktop`（PRD 非目标）。若真机仍被宿主 native Team 策略拖住，按 PRD 记「未验证 + 限制」，**不得**用界面伪装 idle。

### 3.4 HTTP 路由：仍 4 条

`GET /snapshot`、`GET /library`、`GET /memory`、`POST /act` —— 不变。抽屉详情走既有 `GET /library?runId=`（r13 已这样设计），不新增路由。

---

## 4. 前端组件与页面拆分

### 4.1 文件清单（负责边界）

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/client/views/ProgressRing.tsx` | 新增 | 64×64 SVG 环 + 圆心 `done/total` |
| `src/client/views/RoleCard.tsx` | 新增 | `RoleCard` + `RoleGrid`（`[data-role-grid]`） |
| `src/client/views/TaskOverview.tsx` | 新增 | 环 + 分组任务列表（左环右列） |
| `src/client/views/FlowCanvas.tsx` | 新增 | 可平移画布（替换 `FlowGraph.tsx`） |
| `src/client/views/FlowGraph.tsx` | 删除 | 旧静态图 |
| `src/client/views/TaskTable.tsx` | 改 | 增 `grouped?: boolean`：两组 + 组头、去 sticky 表头 |
| `src/client/views/RunRow.tsx` | 新增 | 项目页 run 行（`[data-run-row]`） |
| `src/client/views/RunDrawer.tsx` | 新增 | 右侧抽屉（dialog 语义/焦点陷阱/Esc） |
| `src/client/views/DetailPane.tsx` | 不动 | 历史页仍用它（AC-17 只要求项目库页换抽屉） |
| `src/client/tabs/TasksTab.tsx` | 改 | `RoleStrip→RoleGrid`、`TaskTable→TaskOverview`、`FlowGraph→FlowCanvas` |
| `src/client/LibraryPage.tsx` | 改 | 分栏拖拽、历史桶、run 行、抽屉宿主、scrollTop/焦点复原 |
| `src/client/viewmodel.ts` | 改 | 环/分组/角色状态/flow 常量/goal 标题裁剪 |
| `src/client/tabs/rows.ts` | 改 | `RunRowView` 带 `titleSource`；`projectRunRowOf` 用 goal |
| `src/client/styles.ts` | 改 | 0 新 token：`--lib-list-w` + 全部 `data-*` 选择器 |

### 4.2 组件契约（下游必须逐字调用这些名字）

```ts
// ProgressRing.tsx
export function ProgressRing(props: { done: number; total: number; size?: number }): React.ReactElement

// RoleCard.tsx
export function RoleCard(props: { role: RoleUsageView }): React.ReactElement
export function RoleGrid(props: { roles: RoleUsageView[] }): React.ReactElement

// TaskOverview.tsx
export function TaskOverview(props: {
  tasks: TaskDetailView[]
  expandedTaskId?: string
  onToggleTask: (taskId: string) => void
}): React.ReactElement

// FlowCanvas.tsx
export function FlowCanvas(props: { flow: FlowView; onSelectTask: (taskId: string) => void }): React.ReactElement

// RunRow.tsx
export function RunRow(props: { row: RunRowView; active: boolean; onOpen: (runId: string) => void }): React.ReactElement

// RunDrawer.tsx —— 只负责壳（dialog/遮罩/Esc/焦点陷阱），内容由调用方给
export function RunDrawer(props: {
  open: boolean
  title: string
  subtitle: string
  onClose: () => void
  children: React.ReactNode
}): React.ReactElement | null
```

`RunDrawer` 的内容由 `LibraryPage` 组装（`RunHeader` + `RoleGrid` + `TaskOverview` + `FlowCanvas`），数据来自 `buildRunDetail({ snapshot, library, runDetail: view.detail }, runId)` —— 与 `TasksTab` 同一个装配函数（AC-17）。

### 4.3 派生量（全部纯函数、可单测）

```ts
// src/client/viewmodel.ts
export const PROGRESS_RING_RADIUS = 28
export const PROGRESS_RING_STROKE = 6
export const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RING_RADIUS   // 175.929…

export interface TaskOverviewView {
  done: number
  total: number
  text: string                 // 严格 `${done}/${total}`
  ariaLabel: string            // `已完成 ${done} / 共 ${total}`
  ratio: number                // total===0 ? 0 : done/total
  dashOffset: number           // C * (1 - ratio)
  groups: { open: TaskRowView[]; done: TaskRowView[] }
}
export function taskOverviewOf(tasks: readonly TaskDetailView[]): TaskOverviewView
// 只算 status==='done'；open 保持计划顺序在前，done 在后；两组从同一次调用产出（AC-11 同帧）

export const LIB_LIST_DEFAULT = 220
export const LIB_LIST_MIN = 160
export const LIB_LIST_MAX = 360
export function clampListWidth(width: number): number      // NaN → 220，再夹 [160,360]
export function nextListWidth(current: number, deltaPx: number): number

export const FLOW_NODE_WIDTH = 180
export const FLOW_NODE_HEIGHT = 76
export const FLOW_COLUMN_STEP = 220
export const FLOW_ROW_STEP = 92
export const FLOW_PADDING = 12

export function goalTitleOf(goal: string | undefined, runId: string): { text: string; title: string; source: 'goal' | 'fallback' }
// goal 非空：Array.from(goal.trim()) 取前 24 字符，超出加 '…'；title = 原文
// goal 空/缺省：text = `未命名任务 · ${runId.slice(-6)}`, source='fallback'
```

`roleStateOf` 在 **`src/shared/role-view.ts`**（宿主 `library.ts#rolesOf` 与客户端 `viewmodel.ts#roleUsageOf` 都调它；这是 AC-9/AC-17 唯一的防漂移手段）。

### 4.4 状态管理

- **不改全局 store 形状**：抽屉开关、分栏宽度、拖动位移都是**页面本地 state**。
  - `LibraryPage`：`openRunId: string | null`（同时最多一个）、`listWidth: number`、`dragRef`（起点/起始宽/是否拖动）、`scrollTopRef`、`rowRef`。
  - `FlowCanvas`：`offset: {x,y}`（仅 pointerup/reset 时 set；拖动中只写 `viewport.style.transform`）。
- 抽屉打开复用 `state.openRun`（已有 5s 记忆缓存），关闭 `closeRun`；背景列表**不卸载**（否则 scrollTop/焦点必丢）。
- `TasksTab` 的 `useInflight` 与 `useExpandedTask` 原样复用；`scrollToTaskRow` 的选择器随 `[data-region="task-list"]` 保留。

### 4.5 data-* 钩子契约（QA/探针的唯一抓手）

新增：`data-role-grid`、`data-role-card`、`data-role-id`、`data-role-name`、`data-role-status`(含 `data-tone`)、`data-role-active-task`、`data-role-usage`(含 `data-usage-source`)、`data-role-duration`(含 `data-duration-state`)、`data-task-overview`、`data-progress-ring`、`data-progress-text`、`data-task-group`(`open`/`done`)、`data-group-head`、`data-flow-canvas`、`data-flow-viewport`、`data-flow-node-role`、`data-flow-node-title`、`data-canvas-reset`、`data-split-handle`、`data-run-row`、`data-run-title`、`data-title-source`、`data-run-meta`、`data-run-drawer`、`data-drawer-run`、`data-bucket="history"`。

既有语义不变：`data-task-row` / `data-task-toggle` / `data-expanded` / `data-flow-node` / `data-flow-edge` / `data-upstream-done` / `data-flow-legend` / `data-task-detail`。

---

## 5. 关键实现点与边界

### 5.1 画布平移（AC-4 / AC-5 / AC-6 / AC-22）

- 结构：`[data-flow-canvas]`（`position:relative; overflow:hidden; height:300; touch-action:none; cursor:grab; user-select:none`）→ `[data-flow-viewport]`（`position:absolute; transform:translate3d(x,y,0); will-change:transform`）→ 内层固定尺寸内容（宽高由 `flowLayoutOf` 的 `width/height` 决定）。
- 指针：`onPointerDown` 记 `{x,y,offset,pointerId}` 并 `setPointerCapture`；`onPointerMove` → `if (!dragging && dist < 4) return`；进入拖动后**只**写 `viewport.style.transform`，用 `requestAnimationFrame` 合帧（同一帧多次 move 只写一次）；`onPointerUp` → 若发生过拖动，设置一次性 `suppressClickRef=true`，并 `setOffset(next)` 回写；随后的 `click` 在捕获阶段 `preventDefault+stopPropagation` 并清标志。
- 阈值判定用**累计位移**（`Math.hypot(dx,dy) >= 4`），不是单帧位移 —— 否则慢速拖动永远进不了拖动态。
- 键盘：`tabIndex=0`，`ArrowLeft/Right/Up/Down` 每次 24px，`Home`/`r`/`R` 复位；`aria-label="任务流转图，可拖动平移，方向键移动，R 键重置"`。
- 复位按钮 `[data-canvas-reset]`：`translate3d(0,0,0)`；test 断言 `getComputedStyle(viewport).transform` 归一后与 `translate(0px, 0px)` 距离 ≤1px。
- 平移量夹在 ±20000px（防 NaN/丢失节点）。
- 节点：180×76，第一行 `[data-flow-node-role]` = roleName（缺失回退 roleId）、状态点 6px、状态文字；第二行 `[data-flow-node-title]` 单行 `ellipsis` + `title`；第三行 token · 用时。边永远 `marker-end`，`data-upstream-done` 决定实线/虚线，颜色由 CSS 决定。

### 5.2 进度环与分组（AC-10 / AC-11 / AC-12）

- `ProgressRing`：`viewBox="0 0 64 64"`，`r=28`、`stroke-width=6`、`fill=none`、`stroke-linecap=round`、`transform=rotate(-90 32 32)`；`strokeDasharray = C`、`strokeDashoffset = dashOffset`；`role="img"` + `aria-label`；root 挂 `data-progress-ring data-done data-total`。
- 圆心文字 `[data-progress-text]`：`total>0` 时 `${done}/${total}`；`total===0` 显示 `0/0` 且 `dashOffset=C`（整圈空），**不出现 NaN**。字号两档：文本长度 ≤5 用 13px，≥6 用 11px（`999/999` 才放得进 r=25 的内圆）。
- `TaskOverview`：`display:flex`，环列 `flex:0 0 64px` + `sticky top:0`，列表列 `flex:1 1 auto; min-width:0`。`done/total/ratio/groups` 全部来自**同一次** `taskOverviewOf()` 调用（放在 `useMemo([tasks])`），组头文案 `未完成 · N` / `已完成 · N`。
- 分组容器：`[data-task-group="open"]` 在 DOM 中必须早于 `[data-task-group="done"]`；空组仍渲染组头（计数 0），避免「任务全完成时列表消失」。
- `TaskTable` 的 `grouped` 模式**去掉 sticky 表头**（环占 64 + gap 12 后列表仅 220px，`1fr 76px 84px` 会把 token 截断）；行保持两行式，`data-task-row` 语义与展开块不变。

### 5.3 角色卡片（AC-7 / AC-8 / AC-9）

- 网格：`[data-role-grid] { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:8px }`，卡片 `min-height:76px`。
- 状态算法（**唯一**在 `roleStateOf`）：`running > gate > (rework|failed|interrupted) > 全 done > idle`；文案表 `执行中/待验收/需处理/已完成/待命`。
- 当前任务：取第一个 `running`（其次第一个 `gate`）的标题，否则「无进行中任务」。
- 用量：沿用 `usageCellOf` 的口径；`tasks===0` 或全无 provider 数字 → `source:'unavailable'`，DOM `data-usage-source="unavailable"` 且文本「不可得」，**不得写 0**。
- 用时：有当前任务 → 透传该任务的 `DurationCell`；无 → `{ state:'unavailable', text:'不可得' }`，`title` 说明「没有进行中的任务，无角色用时」。这条规则写死在 `roleStateOf`，宿主与客户端不可能各说一套。
- 两张卡片、三个任务（同角色两任务）→ 仍 2 张：按 `task.roleId` 首次出现顺序分组（既有 `rolesOf` 顺序语义）。

### 5.4 项目库（AC-13 / AC-14 / AC-15 / AC-16 / AC-17）

- **分栏**：`[data-library-shell]` 持有 `--lib-list-w`（默认 220px）；`[data-region="project-list"] { flex: 0 0 var(--lib-list-w, 220px) }`。`data-split-handle` 只在容器内宽 ≥560px 渲染/显示（`@container auto-team-library (min-width: 560px) { ... }`，shell 加 `container: auto-team-library / inline-size`）；<560px 退回纵向堆叠。
  - 拖动：`pointerdown` 记录 `startX` 与起始宽，`pointermove` 用 `nextListWidth(startW, clientX - startX)` 夹 [160,360]，**只写 CSS 变量**（不写内联 flex）；`pointerup` 释放捕获并持久化到组件 state。双击复位 220。键盘：`role="separator"`、`aria-orientation="vertical"`、`aria-valuemin/max/now`、`tabIndex=0`，`ArrowLeft/Right` ±8、`Home/End` 到两端。
  - 外框宽度不可调：页脚一行 11px「宿主未暴露左栏宽度接口，外框宽度固定」；`ctx.layout` 只有四个方法这一事实写进注释，不尝试绕过。
- **历史桶**：`library.projects` 里 `unknown===true` 的那一项在列表固定末位，按钮加 `data-bucket="history"`，显示名由宿主改后的「历史运行（未记录工作区）」；选中后详情头说明「旧版本 run 未记录工作区，无法自动归类」。全仓不得再出现字面「未知项目」（注释一并改）。
- **run 行**：行数 = `recentRuns.length`（run 级，不是 PlanTask），`li[data-run-row][data-run-id]`，内部 `button`；标题 `[data-run-title]` 用 `goalTitleOf`，`title` 挂完整 goal，无 goal 时 `data-title-source="fallback"` +「未命名任务 · <后 6 位>」；次行 `[data-run-meta]` = 后 6 位 · 状态徽标 · token · 用时（缺量「不可得」）。
- **抽屉**：`[data-library-shell]{position:relative}`；遮罩 `position:absolute; inset:0; z-index:30`，抽屉 `position:absolute; top:0; right:0; bottom:0; width:min(520px,100%); z-index:31`；`role="dialog" aria-modal="true" aria-labelledby`。关闭三条路：关闭按钮（`aria-label="关闭详情"`）、Esc、点遮罩。打开时记录 `scrollTop` 与 `document.activeElement`，关闭后 `requestAnimationFrame` 复原（列表不卸载）。
  - 焦点：打开后焦点进抽屉第一个可聚焦元素，`Tab/Shift+Tab` 在抽屉内循环；关闭回触发行的 `button`。
  - 同一时刻只有一个：`openRunId` 单值；DOM 里 `[data-run-drawer]` 恒 ≤1。
  - 动画：`translateX(16px)→0` + `opacity` 160ms，退出 120ms；`prefers-reduced-motion` 关闭动画。

### 5.5 格式化与文案纪律（沿用 r13）

- 数字/时长**只由宿主生成**（`format.ts` / `team/usage.ts`）；客户端 `tokenTextOf` / `durationTextOf` 只读 `UsageCell` / `DurationCell`，不写第二套格式化。
- 字号一律 `font: var(--dsw-font-xs-13, 13px/20px sans-serif)` 简写；禁 `font-size: var(--dsw-font-…)`。
- 状态不只靠颜色：每个状态点旁必须有文字；`aria-label` 覆盖环/画布/手柄。
- 缺数据「不可得」，不写 0、不估算。

---

## 6. 测试策略

### 6.1 单测（`node --test test/*.test.ts`，只增不减，目标 ≥668+新增）

| 文件 | 覆盖 |
|---|---|
| `test/dispatch-nonblocking.test.ts`（新） | 工具在 spawn 桩 `await sleep(60_000)` 下 ≤1s 返回；返回含 `accepted/dispatching`；`autoDispatch` 未装配时报错；预检 5 个拒绝码；`bridge.act` 面板路径仍同步返回 outcome（回归） |
| `test/auto-dispatch.test.ts`（改） | `'manual'` 第 6 个 cause；`onError` 在本批全失败时调用一次、部分成功不调；`onClear` 在 started>0 时调用；`reportsOf` 只留本会话 ≤5 条；连续 3 次仍播报既有文案 |
| `test/tools.test.ts`（改） | `auto_team_plan` 落盘带 `project`；status 输出 `dispatch` 段；dispatch 工具返回形状 |
| `test/captain.test.ts`（改） | 特征句 grep + 2600 字符预算 |
| `test/role-view.test.ts`（新） | 13 种 `TaskStatus` 表驱动 → `state/stateText/done/activeTask`；空数组 → idle/0/无当前任务；缺 `duration` → 「不可得」 |
| `test/task-overview.test.ts`（新） | 2 done+1 running → `text==='2/3'`、`ratio≈2/3`、`dashOffset≈C/3`；空计划 0/0 无 NaN；分组顺序与计数；13 状态表驱动只把 `done` 计入分子 |
| `test/library-project.test.ts`（新） | 2 新 run + 1 旧 run → 当前项目 2 行、历史桶 1 行、无「未知项目」字面；两个 run 同桶；`projectRunViewOf` 带 goal |
| `test/viewmodel.test.ts`（改） | `goalTitleOf` 24 字截断（中文/emoji/超长）、fallback 文本；`clampListWidth`/`nextListWidth`；flow 新常量与 `roleName` 回退 |
| `test/client-ui.test.ts`（改） | 组件源码断言：`RoleGrid`/`TaskOverview`/`FlowCanvas`/`RunDrawer` 各只引用一次 `buildRunDetail`；`data-*` 钩子存在；`font-size: var(--dsw-font` 零命中 |
| `test/wire.test.ts`（改） | 端到端：plan → `store.load().project === workspace`；`plan.goal` 进 `RunSummary.goal` |

### 6.2 变异探针（AC-20，仓库内可重复）

`test/r14-mutation-probes.mjs`：把仓库复制到临时目录，按探针打补丁，跑对应测试，断言「原样绿 / 变异红」。6 条：

1. 把 `auto_team_dispatch` 改回 `await deps.bridge.act(...)` → `dispatch-nonblocking` 红；
2. 删掉画布的 `onPointerDown/Move`（拖动失效）→ 画布源码/行为断言红（CDP 或 `client-ui` 源码断言）；
3. 节点标签改回 `task.id` → `client-ui`/`viewmodel` 红；
4. 环写死 `dashOffset=0` → `task-overview` 红；
5. 项目行改回渲染 `detail.tasks` → `library-project` 红；
6. 删掉 `RunDrawer` → `client-ui` 红。

进 `verifyScripts` 的命令必须是 `node test/r14-mutation-probes.mjs`（自校验：先跑绿、再跑变异、最后验红，退出码 0 仅在两种结果都符合预期时）。

### 6.3 真机（AC-21，主 agent 执行）

第二宿主（克隆 profile + 端口 51890 + `REAL-HOST-VERIFY.md` 的 cookie/无头浏览器流程）+ CDP 取七项：画布拖动位移、重置 transform、节点角色名（qa 任务出现「测试」）、2/3 与弧比例、2 张角色卡片、2 个 run 行 + 1 个历史桶、抽屉开关与 scrollTop/焦点。起不来 → 记「未验证」+ 阻塞原因，**不许 mock**。

### 6.4 交付前门禁（每个任务自检都要跑）

```bash
pnpm -s typecheck
pnpm -s test
pnpm -s build
node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js'); console.log('IMPORT_OK')"
npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis\.patch\.yml'
find src -name '*.ts*' -newer lib/index.js | wc -l        # 必须 0（双产物新鲜）
git status --porcelain                                     # 只允许本任务夹与源码
```

---

## 7. 任务拆分（文件边界互斥，可并行处已标注）

> 依赖图：`T1 ∥ T2 → T3 → (T4 ∥ T5) → T6 → T7 → T8`。`T1` 与 `T2` 可并行（文件不重叠）。
> **git 约束（PRD §9.1，逐字进任务）**：全程停留在 `feat/auto-team-plugin`（基线 `a138883`），**不得新建/切换分支、不得 `git clean`/`git reset` 清掉未跟踪的任务夹**；开发任务**不自行 commit/push**，收口由主 agent 单笔提交。

| ID | 任务 | 文件（写域） | 依赖 | 验收 |
|---|---|---|---|---|
| T1 | P0 派发受理制 + 失败可见 + 提示词 | `src/host/bridge.ts`、`src/host/tools.ts`、`src/host/index.ts`、`src/host/prompt.ts`、`src/host/team/auto-dispatch.ts`、`src/host/team/dispatch-notices.ts`（新）、`test/dispatch-nonblocking.test.ts`（新）、`test/auto-dispatch.test.ts`、`test/tools.test.ts`、`test/captain.test.ts` | — | 60s spawn 桩下工具 ≤1s；预检 5 码；`onError/onClear/reportsOf`；提示词特征句；`pnpm -s test` 相关文件全绿 |
| T2 | 数据模型（goal/project/role-view/历史桶） | `src/shared/types.ts`、`src/shared/role-view.ts`（新）、`src/shared/const.ts`（如需要）、`src/host/plan/plan.ts`、`src/host/store.ts`、`src/host/library.ts`、`test/role-view.test.ts`（新）、`test/library-project.test.ts`（新）、`test/store.test.ts` | — | 2 新 + 1 旧 → 当前项目 2 行/历史桶 1 行；`Plan.goal` 落盘；`roleStateOf` 13 状态表驱动 |
| T3 | 客户端派生层 | `src/client/viewmodel.ts`、`src/client/tabs/rows.ts`、`test/viewmodel.test.ts`、`test/client-ui.test.ts`（源码断言部分） | T2 | 环/分组/goal 截断/分栏夹取/flow 常量纯函数全绿 |
| T4 | 组件与样式 | `src/client/views/ProgressRing.tsx`、`RoleCard.tsx`、`TaskOverview.tsx`、`FlowCanvas.tsx`（均新）、`FlowGraph.tsx`（删）、`TaskTable.tsx`、`src/client/styles.ts`、`src/client/tabs/TasksTab.tsx` | T3 | 画布拖动/重置/键盘；2 卡 3 任务；2/3 环；分组计数；`font-size: var(--dsw-font` 零命中 |
| T5 | 项目库页与抽屉 | `src/client/LibraryPage.tsx`、`src/client/views/RunRow.tsx`（新）、`src/client/views/RunDrawer.tsx`（新） | T3（读 T4 的样式契约） | 分栏拖动夹取/双击复位/键盘；历史桶；run 行 goal 标题；抽屉三关闭 + scrollTop/焦点复原 |
| T6 | 变异探针 | `test/r14-mutation-probes.mjs`（新） | T1–T5 | 6 条原样绿/变异红，退出码 0 |
| T7 | 真机验证 | `logs/teamflow/tf-mw1hteu6-w8pc10/scripts/*.mjs`（新）、`logs/teamflow/tf-mw1hteu6-w8pc10/capture/` | T4,T5（+ `pnpm -s build`） | CDP 七项证据落盘；起不来记「未验证 + 阻塞」 |
| T8 | 交付自检（**不写 QA/ACCEPTANCE 报告**） | 无新增源文件；发现问题就地修（回到对应文件所有者任务） | T1–T7 | typecheck 0 / test 全绿且 ≥668+新增 / 双产物新鲜 / 双 import 0 / pack 3 件 / 无新增 dependencies / 计数普查 / `git status` 干净 |

T4 与 T5 并行时，`styles.ts` **只归 T4**：T5 需要的选择器（`--lib-list-w`、`[data-split-handle]`、`[data-run-row]`、`[data-run-drawer]`、`[data-bucket="history"]`）由 T4 依 DESIGN §4/§6 一次写全；T5 只加组件与行为，若发现缺样式，回报 T4 补，不得自行改 `styles.ts`（否则写域冲突）。

---

## 8. AC → 实现落点 → 验证方式

| AC | 落点 | 验证 |
|---|---|---|
| 1 | `tools.ts` dispatch handler（预检+kick+立即返回） | `dispatch-nonblocking.test.ts`：60s 桩 ≤1s、`accepted/dispatching`、真机 5s 内可输入（T7） |
| 2 | `prompt.ts#CAPTAIN_CONSTRAINTS` 特征句 | `captain.test.ts` grep + 真机不轮询 |
| 3 | `auto-dispatch.ts#onError` → `dispatch-notices` → `snapshot.activity`；`tools.status` 的 `dispatch` 段；任务不 running | `auto-dispatch.test.ts` + 探针（注入必败 spawn，5s 内 activity 有文案） |
| 4 | `FlowCanvas.tsx`（viewport/阈值/复位/键盘/触摸） | `client-ui` 源码断言 + CDP 拖动 100px≥90px、transform≈0 |
| 5 | 节点 role/title 两行 | `viewmodel.test.ts` + CDP（qa 任务出现「测试」） |
| 6 | 边 marker/线型/图例 | 源码断言 + CDP `data-upstream-done` |
| 7 | `RoleGrid` 按 roleId 分组 | `role-view.test.ts` + 组件测试（2 卡） |
| 8 | `roleStateOf`（status/active/usage/duration） | `role-view.test.ts` 表驱动 + CDP `data-usage-source` |
| 9 | 两侧都调 `roleStateOf` + 同一 `buildRunDetail` | 源码断言 + CDP 文本逐字对比 |
| 10 | `ProgressRing` + `taskOverviewOf` | `task-overview.test.ts`（2/3、弧比、0/0） |
| 11 | `TaskOverview` 单次派生 + 分组顺序 | `task-overview.test.ts` + CDP 同帧 |
| 12 | 分子只认 `done`，13 状态表驱动 | `task-overview.test.ts` |
| 13 | 分栏（`clampListWidth`/手柄/键盘/双击） | `viewmodel.test.ts` + CDP 80px≥60px、外框宽不变 |
| 14 | `tools` 写 `project` + `library` 历史桶改名 | `wire.test.ts`（端到端）+ `library-project.test.ts` |
| 15 | `Plan.goal`→`RunSummary.goal`→`ProjectRunSummaryView.goal`→`goalTitleOf` | `library-project.test.ts` + `viewmodel.test.ts` + CDP 2 行 |
| 16 | `RunDrawer` + `LibraryPage`（scrollTop/焦点/单例） | `client-ui` 源码断言 + CDP |
| 17 | 同一 `buildRunDetail` + 同一组件集 | `client-contract.test.ts`（既有）+ 源码计数断言 |
| 18 | 形状只加 5 类可选字段；计数不变 | grep 普查（见 verifyScripts） |
| 19 | 门禁 | T8 |
| 20 | `test/r14-mutation-probes.mjs` | 探针自身 |
| 21 | T7 | CDP 七项 |
| 22 | 画布 rAF 直写 + library 缓存键不变 | CDP 帧间隔 / library 冷热时间 |

---

## 9. 风险、降级与不做

| 风险 | 处理 |
|---|---|
| 宿主 native Team 策略仍让队长等待（F1 未定论） | 提示词是插件侧唯一可控面；真机若仍等，记「未验证 + 宿主策略限制」，**不伪造 idle**，不修改 profile |
| `spawnTeammate` 返回时仍处 provisioning（F5） | 受理制下 `accepted` 不承诺成员已就绪；失败由 `onError` 兜住；`dispatchReady` 的 ALREADY_RUNNING 分支保证不重复起人 |
| 抽屉与右栏文本漂移（AC-9/17） | 唯一算法在 `roleStateOf` + 唯一装配在 `buildRunDetail`；源码断言「各一处定义」 |
| `styles.ts` 单文件写域冲突 | 只归 T4；T5 缺样式回报，不自行改 |
| 画布拖动 vs 节点点击 | 4px 累计阈值 + 一次性 `click` 抑制；阈值以下不进入拖动 |
| 容器查询不被宿主 shadow 环境支持 | 已有 `@container` 先例（`styles.ts:3048`）；降级为纵向堆叠（`<560px`），仍可用 |

**不做**（PRD 非目标）：外框宽度调整、画布缩放/小地图/惯性、右栏 320px 内抽屉、旧 run 的 workspace 猜测迁移、参考图像素级还原、新增路由/动作/拒绝码/事件种类/工具、第三方图形库。

## 10. 交付物与状态

- 本文件：`docs/teamflow/20261104-r14-panel-canvas-redesign/TECHNICAL.md`（一次写定，后续只在实现偏离时同步）。
- `docs/teamflow/memory.md`：本期只在实现完成后回填「派发受理制」「角色派生量单一算法」两条约定（低频；不写日更）。
