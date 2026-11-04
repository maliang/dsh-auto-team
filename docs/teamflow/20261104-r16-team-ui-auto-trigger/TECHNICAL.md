# r16 技术方案：开关即自动组队 + 角色列画布 + 左栏可见结果

**基线**：`docs/teamflow/20261104-r14-infinite-canvas-role-cards/`（706 测试）；三处取代 r14 `AC-5/AC-10/AC-18`。
**一句话判断**：两条 P0 都在现有边界内收口 —— 自动组队只改「提示词规则 + dispatch 已派发分支的返回语义」，画布只改「客户端单点派生 + 视图渲染 + CSS」，左栏只改「一次点击的降级协议」；**零新增路由、零新增依赖、零新增设计 token，数据结构只加 2 个可选字段**。

## 0. 结论与不可破坏的边界

| 约束 | 本方案的做法 |
|---|---|
| 不改宿主 API / 路由 | 全部复用 `GET/POST /api/auto-team`；不新增页签（仍 3 个） |
| 不新增依赖 | 画布继续手写 SVG + pointer 事件，不引 d3 / mermaid / reactflow |
| 不重复造列数据 | 角色列只在客户端 `flowLayoutOf` 派生，`FlowView` 不加顶层字段，`PlanTask` 不加 `stage` |
| 旧快照可读 | `taskRefs?` / `roleId?` 都是可选；缺失时按 `roleName` 回退「角色未记录」单列 |
| 面板与工具语义一致 | `bridge.ts#admissionOf` 原样保留；只在 `tools.ts` 把 `PLAN_ALREADY_DISPATCHED` **翻译成幂等确认**，面板 `act('dispatch')` 不动 |
| 真机证据优先 | 54058 先复现；不可复现时给差异清单 + 步骤 + 「未验证」，不以克隆宿主可点结案 |
| 统计诚实 | 不显示缓存命中率；token / 用时缺失显示「不可得」 |

## 1. 改动文件与所有权

| 文件 | 类型 | 改动 | 任务 |
|---|---|---|---|
| `src/shared/types.ts` | 契约 | `RoleTaskRef`；`RoleUsageView.taskRefs?`；`FlowNodeView.roleId?` | T1 |
| `src/host/library.ts` | 宿主投影 | `rolesOf` 填 `taskRefs`；`flowOf` 填 `roleId` | T1 |
| `src/client/viewmodel.ts` | 客户端派生 | 环常量 80/34/8；`FlowStage*`、`flowLayoutOf` 角色列；`flowNodeViewOf` 新 cell；`roleTaskRefViewOf`；`roleUsageOf` 填 `taskRefs`；`buildFlow` 填 `roleId` | T1 |
| `src/host/prompt.ts` | 提示词 | `captainSection` 改条件式「仅改代码」；长度 ≤2600 | T2 |
| `src/host/tools.ts` | 工具 | 已派发分支返回 `ok:true/alreadyDispatched:true`，零 kick；`dispatch` 描述补幂等 | T2 |
| `src/client/styles.ts` | 样式 | 列头 / tN / 状态胶囊 / refs chip / 80 环 / 内联 bar | T3 |
| `src/client/views/ProgressRing.tsx` | 组件 | 80 / viewBox 80 / 圆心 40 / 40；字号分档 | T4 |
| `src/client/views/TaskOverview.tsx` | 组件 | 显式 `size={PROGRESS_RING_SIZE}` | T4 |
| `src/client/views/RoleCard.tsx` | 组件 | `taskRefs` chip 行（彩点 + tN + title/aria） | T4 |
| `src/client/views/FlowCanvas.tsx` | 组件 | 角色列头 + tN 节点 + 列间箭头 + 双行节点；去 role | T5 |
| `src/client/slots.ts` | 客户端 | `createOpenLibrary` watchdog；`visibleLibrarySurface`；pending 标记 | T6 |
| `src/client/LibraryPage.tsx` | 客户端 | glyph 点击 / `data-last-open-result`；根 `data-library-surface` | T6 |
| `src/client/Panel.tsx` | 客户端 | 单 surface 守卫；逐字 hint | T6 |
| `test/viewmodel.test.ts` 等 5 个 | 测试 | 新几何 / `taskRefs` / `roleId` | T1 |
| `test/client-ui.test.ts` | 测试 | 画布去 role、tN/列头；环 40/80；refs 源码钩子 | T5（环断言随 T4 完成后改） |
| `test/captain.test.ts`、`test/dispatch-nonblocking.test.ts`、`test/tools.test.ts` | 测试 | 新规则 / 幂等返回 | T2 |
| `test/client-contract.test.ts` | 测试 | inject 形状、surface 钩子、计数不变 | T6 |
| `test/r16-*.test.ts`（4 个） | 新测试 | 纯函数 + 源码钩子 | T1/T4/T5/T6 |
| `test/r16-mutation-probes.mjs` | 新探针 | 7 个变异原绿变红 | T7 |

**不动**：`src/host/bridge.ts`、`src/host/team/auto-dispatch.ts`、`src/host/http.ts`、`src/client/index.ts`、`AGENTS.md`、宿主 profile。

## 2. 数据模型与存储

### 2.1 只加三个声明、两个字段

`src/shared/types.ts`（放在 `RoleUsageView` 前）：

```ts
/** r16：角色卡上的任务编号与状态（只读投影，顺序 = 计划顺序）。 */
export interface RoleTaskRef {
  id: string
  status: TaskStatus
}
```

`RoleUsageView` 增加：

```ts
  /** r16 AC-16：本角色任务编号与状态，按计划顺序；旧快照无此字段。 */
  taskRefs?: RoleTaskRef[]
```

`FlowNodeView` 增加：

```ts
  /** r16 AC-12：节点归属角色 id；旧快照可能没有，按 roleName 回退。 */
  roleId?: string
```

**不加**：`PlanTask.stage`、`FlowView.roleColumns`、`RunDetailView` 顶层字段、新路由。`RoleTaskRef` 只携带 `id/status`，不复制标题——标题仍由 `TaskDetailView` 提供，避免双份真相。

### 2.2 两个填充点，零新存储

**宿主** `src/host/library.ts`：

```ts
// rolesOf(tasks) 内，按 roleId 分组后
taskRefs: list.map((task) => ({ id: task.id, status: task.status })),

// flowOf(tasks) 的节点
roleId: task.roleId,
```

**客户端** `src/client/viewmodel.ts`：

```ts
// roleUsageOf(...) 内，按 roleId 分组后
taskRefs: list.map((task) => ({ id: task.id, status: task.status })),

// buildFlow(...) 的节点
roleId: task.roleId,
```

两边都按**计划顺序**（分组时原数组顺序）生成，禁止排序。`RoleUsageView.tasks` 仍是数量，`taskRefs.length` 必须等于它；测试同时断言二者。

### 2.3 兼容旧数据

- `taskRefs === undefined` 或 `[]`：RoleCard 整行不渲染；`RoleUsageView.tasks > 0` 但缺 refs 时不伪造 chip。
- `roleId === undefined`：`flowLayoutOf` 先按 `roleName` 分组；`roleName` 也没有 → 单列 `FLOW_ROLE_FALLBACK = '角色未记录'`。
- 旧 `node.column` 是「依赖深度」，**不参与 r16 分列**；只在没有 `roleId/roleName` 的极端快照里作为组内顺序的兜底（保持稳定），绝不作为列号。
- 旧 `FlowView.columns/rows` 不再被 `flowLayoutOf` 读取；字段保留但不删，避免破坏旧快照类型。

## 3. 宿主侧设计

### 3.1 角色卡投影：`rolesOf`

现有签名不变：

```ts
export function rolesOf(tasks: TaskDetailView[]): RoleUsageView[]
```

唯一新增是 `taskRefs`。分组 key 仍是 `task.roleId`（首次出现顺序），`name` 仍是 `list[0].roleName ?? roleId`。不要按角色表补零任务角色——AC-12 要求零任务角色不出列。

### 3.2 画布投影：`flowOf`

现有签名不变：

```ts
export function flowOf(tasks: TaskDetailView[]): FlowView
```

节点增加 `roleId: task.roleId`。`column/row` 仍按依赖深度算（宿主侧语义不变，客户端不再信任），`edges` 的 `upstreamDone` 不变。不要在宿主侧做角色分列——列需要「按首次出现顺序」的展示语义，属于客户端派生。

### 3.3 队长提示词：条件式规则

**文件**：`src/host/prompt.ts`；**入口**：`captainSection(deps: PromptDeps, sessionId: string): string`。

把现有无条件「工作方式」第 1 条（「先 plan，再 dispatch / 用户确认后派发」）替换为下列三段；其余 2–7 条保留（成员续聊、门禁、记忆、面板状态源）。

```text
- **先判性质**：只有「需要修改代码」的任务才组队。算：src/**、test/**、lib/**、package.json、tsconfig*.json、*.config.*、pnpm-lock.yaml、scripts/**、.github/workflows/**、cordis.patch.yml；不算：*.md、docs/**、README*、logs/**、只跑 test/typecheck 验证、只做查证并产出说明。
- **开关打开 + 改代码**：先 auto_team_status 确认 enabled，再 auto_team_plan（计划落盘后自动派发），再 auto_team_dispatch（只做幂等确认）；队长本人不得修改任何文件；受理后本轮立即结束，不等成员。
- **不组队**：纯问答、用户明确叫停、改文档、跑验证、单纯查证；开关关闭时零 auto_team_* 写操作。本段不判断当前会话是否启用，以 auto_team_status 的 enabled 为准。
```

硬性验收：

1. `captainSection(...)` 返回长度 **≤2600**（现有 `test/captain.test.ts` 的 `SECTION_MAX`）。
2. 文本必须同时出现：`auto_team_status`、`auto_team_plan`、`auto_team_dispatch`、`enabled`、`src/**`、`docs/**`、`不得修改任何文件`、`立即结束本轮`、`纯问答`、`明确叫停`。
3. 不出现「当前会话已启用」这类断言；开关状态只由工具读取。
4. 若超长，先压缩旧的「派发前提醒用户」一段（保留语义、删例子），不得删掉三条新规则或把路径清单改成「等」。

### 3.4 幂等派发：只改工具层

**文件**：`src/host/tools.ts`，`auto_team_dispatch` handler。

当前流程：`precheckDispatch` → `!ok` 原样返回 → `autoDispatch(kick)` → 返回 accepted。

r16 只插入一个分支：

```ts
const admission = deps.bridge.precheckDispatch(sessionId, runId)
if (!admission.ok) {
  if (admission.code === 'PLAN_ALREADY_DISPATCHED') {
    const snapshot = deps.bridge.snapshot(sessionId)
    return {
      ok: true,
      accepted: true,
      dispatching: true,
      alreadyDispatched: true,
      runId: snapshot.runId ?? runId,
      planStatus: snapshot.planStatus,
      ready: [],
      tasks: snapshot.tasks.map(taskBrief),
      members: snapshot.members.map(memberBrief),
      notices: [DISPATCH_ALREADY_TEXT],
    }
  }
  return { ok: false, code: admission.code, error: admission.message }
}
```

新增常量：

```ts
export const DISPATCH_ALREADY_TEXT = '此前已自动派发：成员已在运行，本次未重复起人'
```

约束：

- 该分支**不调用** `deps.autoDispatch`、不调用 `bridge.act`、不 spawn；`ready: []`，成员数取真实快照。
- 其他拒绝码（`NOT_ENABLED/NO_PLAN/PAUSED/NOT_FOUND`）返回形状完全不变。
- `bridge.ts#admissionOf` 仍返回 `PLAN_ALREADY_DISPATCHED`（面板 `act('dispatch')` 继续依赖它），本改动只是工具层的语义翻译。
- 工具描述补一句：「若计划已自动派发，本工具返回 `alreadyDispatched:true`，不会重复起人」。
- 面板的 `act('dispatch')` 行为与 r14 一致，不在本需求改。

**AC-6 的返回样例**：

```json
{"ok":true,"accepted":true,"dispatching":true,"alreadyDispatched":true,
 "runId":"run-...","planStatus":"dispatching","ready":[],
 "tasks":[...],"members":[...],
 "notices":["此前已自动派发：成员已在运行，本次未重复起人"]}
```

### 3.5 不改 API

`GET /api/auto-team/snapshot|library|memory|skills|...` 与 `POST /api/auto-team/act` 均不改；新字段随既有 `RunDetailView` JSON 自动带出。

## 4. 客户端派生（单一真相）

### 4.1 几何常量（`src/client/viewmodel.ts`）

| 常量 | 旧 | 新 |
|---|---|---|
| `PROGRESS_RING_SIZE`（新增） | — | `80` |
| `PROGRESS_RING_VIEWBOX`（新增） | — | `80` |
| `PROGRESS_RING_RADIUS` | 28 | `34` |
| `PROGRESS_RING_STROKE` | 6 | `8` |
| `PROGRESS_RING_CIRCUMFERENCE` | 2π×28 | `2 * Math.PI * 34`（≈213.628） |
| `FLOW_NODE_HEIGHT` | 76 | `64` |
| `FLOW_COLUMN_STEP` | 220 | `208` |
| `FLOW_ROW_STEP` | 92 | `80` |
| `FLOW_PADDING` | 12 | `12`（不变） |
| `FLOW_STAGE_TOP`（新增） | — | `12` |
| `FLOW_STAGE_HEIGHT`（新增） | — | `32` |
| `FLOW_NODE_TOP`（新增） | — | `54` |
| `FLOW_STAGE_LINK_Y`（新增） | — | `28` |
| `FLOW_STAGE_LINK_INSET`（新增） | — | `4` |
| `FLOW_ROLE_FALLBACK` | `'角色未记录'` | 不变 |

`FLOW_NODE_WIDTH` 保持 180，`FLOW_NODE_HEIGHT` 变 64 后节点两行、第二行 meta 仍放得下（144 内容 - 20 内边距 = 124；tN 24 + 间距 6 + 标题 70 + 胶囊 48 = 148 需靠 flex 压缩，见 §5.4：标题 `flex:1;min-width:0`，胶囊 `flex:0 0 auto`，tN `flex:0 0 auto`，总宽 180-20=160，24+6+48=78 留给标题 82，够 8 个汉字 + 省略）。

### 4.2 `flowLayoutOf`：唯一分列点

```ts
export interface FlowStageView {
  key: string
  index: number
  roleId?: string
  name: string
  count: number
  x: number
  y: number
  allDone: boolean
}

export interface FlowStageLinkView {
  key: string
  from: number
  to: number
  d: string
  upstreamDone: boolean
}

export interface FlowLayout {
  width: number
  height: number
  nodes: FlowLayoutNode[]   // 加 column/row（派生）
  edges: FlowLayoutEdge[]
  stages: FlowStageView[]
  stageLinks: FlowStageLinkView[]
}
```

`FlowLayoutNode` 增加：

```ts
  /** 角色列索引（派生，非 FlowNodeView.column）。 */
  column: number
  /** 角色列内序号（派生）。 */
  row: number
```

算法（O(n)，一次遍历）：

1. **分组**：按 `node.roleId ?? node.roleName ?? FLOW_ROLE_FALLBACK` 建 `Map`，首次出现决定组顺序；`name = 组内首节点.roleName ?? 组内首节点.roleId ?? FLOW_ROLE_FALLBACK`。注意 key 与 name 分离：两个不同 `roleId` 恰好同名时**不能合并**。
2. **列**：`index = 组下标`；`x = FLOW_PADDING + index * FLOW_COLUMN_STEP`；`y = FLOW_STAGE_TOP`；`count = 组长度`；`allDone = 组内每个 status === 'done'`。
3. **行**：组内按原数组顺序 `row = 0..count-1`；节点 `x = stage.x`，`y = FLOW_NODE_TOP + row * FLOW_ROW_STEP`。
4. **列头连接**：相邻列 `i-1 → i`，`from = stages[i-1].x + FLOW_NODE_WIDTH + FLOW_STAGE_LINK_INSET`，`to = stages[i].x - FLOW_STAGE_LINK_INSET`，`y = FLOW_STAGE_LINK_Y`，`d = 'M from y L to y'`；`upstreamDone = stages[i-1].allDone`。
5. **画布尺寸**：`width = FLOW_PADDING * 2 + FLOW_NODE_WIDTH + (stages.length - 1) * FLOW_COLUMN_STEP`；`height = FLOW_NODE_TOP + FLOW_NODE_HEIGHT + (maxCount - 1) * FLOW_ROW_STEP + FLOW_PADDING`。空计划 `stages=[]`，`width=FLOW_PADDING*2`，`height=FLOW_PADDING*2`（或保持最小 24×24），不得 NaN。
6. **任务边**：仍用 `flow.edges`，按 `id → 派生 node` 查端点；`from` 右边缘中点到 `to` 左边缘中点，贝塞尔控制点 `dx = max(24, |to.x - from.x| / 2)`；端点缺失或环依赖 → 跳过，不抛。`upstreamDone` 取自 edge，不重算。
7. **不读** `flow.columns/flow.rows` 与 `node.column/node.row` 作为列号。

`stages.length === 1` 时 `stageLinks=[]`，画布宽 204（24+180），右栏 296 内无横向滚动；`stages.length === 2` 时宽 412，初始显示第 1 列完整 + 第 2 列 76px，靠拖动（DESIGN §0）。

### 4.3 `flowNodeViewOf` 与 cell

```ts
export interface FlowNodeCellView {
  tokenText: string
  durationText: string
  roleText: string
  taskTitle: string
  text: string
  title: string
  label: string
  statusText: string
  tone: BadgeTone
}
```

- `roleText = node.roleName || FLOW_ROLE_FALLBACK`（仅用于 title/aria，不再渲染进第一行）。
- `status = statusBadge(node.status)`；`statusText = status.text`；`tone = status.tone`。
- `title = \`${node.id} ${node.title} · 角色 ${roleText} · token ${tokenText} · 用时 ${durationText}\``。
- `label = \`${node.id}：${node.title}，${statusText}，token ${tokenText}，用时 ${durationText}\``。
- `text` 仍为 `${tokenText} · ${durationText}`，供第二行；`taskTitle` 仍为 `node.title`。
- `tN` 不在这里生成，直接使用 `node.id`（计划生成器已保证 `t\d+`）；若未来出现非 tN id，仍原样显示，不做假编号。

### 4.4 `roleTaskRefViewOf`

```ts
export interface RoleTaskRefView {
  id: string
  status: TaskStatus
  tone: BadgeTone
  text: string
  title: string
  label: string
}

export function roleTaskRefViewOf(ref: RoleTaskRef): RoleTaskRefView
```

- `const badge = statusBadge(ref.status)`；`text = ref.id`；`title = label = \`${ref.id} · ${badge.text}\``；`tone = badge.tone`。
- 状态词只取 `statusBadge().text`，不另造「已完成/未开始」第二套；`done` 统一显示「已通过」（与面板一致）。
- 映射 5 个 tone：`business/warn/danger/success/neutral`，与 `ROLE_STATE_TONE` 同族。

### 4.5 `roleUsageOf` / `buildFlow`

- `roleUsageOf` 内加 `taskRefs`（§2.2），其余 6 个派生量不变。
- `buildFlow` 节点加 `roleId: task.roleId`，`column/row` 仍按依赖深度（宿主兼容）。
- `buildRunDetail` 不改，自动带出新字段。

## 5. 组件与样式

### 5.1 `ProgressRing.tsx`

- 默认 `size = PROGRESS_RING_SIZE`（80）；`viewBox="0 0 80 80"`；`cx/cy = 40`；`transform="rotate(-90 40 40)"`。
- `r = PROGRESS_RING_RADIUS`（34），`strokeWidth = PROGRESS_RING_STROKE`（8），`strokeDasharray = PROGRESS_RING_CIRCUMFERENCE`（213.628）。
- 文本 `text = \`${done}/${total}\``；`textTier = text.length <= 5 ? 'short' : 'long'`；`x/y = 40`。
- `aria-label` 保持 `已完成 X / 共 Y`；`total === 0` 时 `ratio = 0`，不 NaN。
- 保留 `data-progress-ring/data-done/data-total/data-ring-track/data-ring-arc/data-progress-text/data-text-tier`。

CSS（`styles.ts`）：

```css
[data-task-overview]{grid-template-columns:80px minmax(0,1fr);gap:8px}
[data-overview-ring]{width:80px;height:80px}
[data-progress-ring]{width:80px;height:80px}
[data-progress-text]{font: var(--dsw-font-h4-14, 600 14px/1.2 ...)}  /* 实际用 xs-13 600，见下 */
```

DESIGN §0 的硬数字：999/999 用 **13px/600**（半对角 27.25 < 30）；短文本 `99/99` 用 **16px/600**；`data-text-tier="short"` → 16，`long` → 13。CSS 必须同时写 `.short` 与 `.long`，不能只靠默认 13。字族用 tabular numerals。

### 5.2 `TaskOverview.tsx`

- 调 `ProgressRing` 时显式 `size={PROGRESS_RING_SIZE}`（防止未来默认值漂移）。
- 结构不变：`section[data-task-overview] > div[data-overview-ring] + div[data-overview-list]`。
- 列表内容宽 = 296 - 80 - 8 = 208；最坏 meta（token + 用时 + 角色）178 ≤ 208，允许换行。
- 窄容器（<260）时仍保持 80 环，列表 `min-width:0`，不得横向溢出。

### 5.3 `RoleCard.tsx`：refs 行

结构固定为 head → active-task → **refs** → meta：

```tsx
{refs.length > 0 ? (
  <div data-role-line="refs" data-role-task-refs>
    {refs.map((chip) => (
      <span
        key={chip.id}
        data-role-task-ref
        data-task-id={chip.id}
        data-status={chip.status}
        data-tone={chip.tone}
        title={chip.title}
        aria-label={chip.label}
      >
        <span data-task-ref-dot data-tone={chip.tone} aria-hidden="true" />
        <span data-task-ref-id>{chip.text}</span>
      </span>
    ))}
  </div>
) : null}
```

- `const refs = (role.taskRefs ?? []).map(roleTaskRefViewOf)`；空数组整行不渲染。
- chip 的 **textContent 必须严格等于 `tN`**（dot 无文本）；`title/aria-label` 必须含 `${id} · ${状态中文}`。
- dot 用 `color: var(--dsw-alias-state-*-primary)` + `background: currentColor`，保证 computed color 不同；neutral 用 `--dsw-alias-label-tertiary`。
- 顺序 = `taskRefs` 顺序（计划顺序），数量 = `role.tasks`；不得排序、去重、截断。
- 卡片仍 `min-height:76px`，refs 行可换行（`flex-wrap:wrap;gap:4px;min-height:18px`）；两列网格不因 refs 改成单列。
- `RoleGrid` 的空态与 `data-empty` 不变。

### 5.4 `FlowCanvas.tsx`：列 + 节点

**结构**：

```tsx
<section data-region="task-flow">
  <div data-flow-canvas data-dragging={...} data-resetting={...} tabIndex={0} role="group" aria-label="任务流转图，可拖动平移，方向键移动，R 键重置">
    <div data-flow-viewport style={{width:layout.width,height:layout.height}}>
      <svg data-flow-edges>
        <defs>
          <marker id={taskMarkerId} data-flow-arrow refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" /></marker>
          <marker id={solidMarkerId} data-flow-stage-arrow="solid" ...><path ... /></marker>
          <marker id={dashedMarkerId} data-flow-stage-arrow="dashed" ...><path ... /></marker>
        </defs>
        {layout.stageLinks.map((link) => (
          <path key={link.key} data-flow-stage-link data-upstream-done={link.upstreamDone}
            d={link.d} fill="none"
            stroke={link.upstreamDone ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-tertiary)'}
            strokeWidth={1.5} strokeDasharray={link.upstreamDone ? undefined : '4 3'}
            markerEnd={`url(#${link.upstreamDone ? solidMarkerId : dashedMarkerId})`} />
        ))}
        {layout.edges.map((edge) => (/* r14 原样：data-flow-edge/data-upstream-done/marker taskMarkerId */))}
      </svg>

      {layout.stages.map((stage, i) => (
        <div key={stage.key} data-flow-stage data-flow-column={String(i)}
          data-role-id={stage.roleId} aria-label={`角色列 ${badgeOf(stage.index)} ${stage.name}，${stage.count} 个任务`}
          style={{left:stage.x, top:stage.y}}>
          <span data-flow-stage-badge>{badgeOf(stage.index)}</span>
          <span data-flow-stage-name>{stage.name}</span>
          <span data-flow-stage-count>×{stage.count}</span>
        </div>
      ))}

      {layout.nodes.map(({node, cell, x, y, column, row}) => (
        <button key={node.id} type="button" data-flow-node={node.id} data-status={node.status}
          data-flow-column={String(column)} data-flow-row={String(row)}
          style={{left:x, top:y}} title={cell.title} aria-label={cell.label}
          onClick={() => onSelectTask(node.id)}>
          <span data-flow-line="title">
            <span data-flow-node-id>{node.id}</span>
            <span data-flow-node-title title={node.title}>{node.title}</span>
            <span data-flow-status data-tone={cell.tone}>{cell.statusText}</span>
          </span>
          <span data-flow-line="meta">
            <span data-cell="token" data-usage-source={...}>{cell.tokenText}</span>
            <span data-flow-sep>·</span>
            <span data-cell="duration" data-duration-state={...}>{cell.durationText}</span>
          </span>
        </button>
      ))}
    </div>
    <button data-canvas-reset type="button">重置视图</button>
    <p data-flow-legend title="任务边看上游任务；列间箭头看左侧角色列">
      <span data-legend-line="solid" />实线 = 已完成
      <span data-legend-line="dashed" />虚线 = 未完成
    </p>
  </div>
</section>
```

硬约束：

- `data-flow-node-id` 的 textContent 严格 `/^t\d+$/`，它就是 `node.id`。
- 第一行只有 tN + 标题 + 状态胶囊；**不再渲染** `data-flow-node-role`；角色名只在列头 + title/aria。
- `data-flow-column` 用 `layout.nodes[i].column`（派生），`data-flow-row` 用派生 row；不要用 `node.column/node.row`。
- 列头不是 button、不 `stopPropagation`：`pointerdown` 冒泡给画布，拖列头也能平移。
- 列头 `left = 12 + i*208`，`top = 12`，`width:180;height:32`；节点 `top = 54 + row*80`。
- 列间箭头从「前列右边缘 + 4」到「后列左边缘 - 4」，`y=28`；左列全 done 才实线。
- 状态胶囊 `max-width:48px`，`data-tone` 5 色；`white-space:nowrap`；status 文本取 `cell.statusText`。
- tN 徽标 `24×18`，`data-flow-node-id` 上写 `font-family: var(--ds-font-family-code)`、tabular。
- 第二行 meta `font-size` 用 `--dsw-font-xs-11`，token 原串（`data-usage-source`）不四舍五入、不省略数字。
- 拖动/4px 阈值/±20000 clamp/方向键 24px/Home·R 重置 180ms 全部沿用 r14；`flowLayoutOf` 只换 layout，不碰事件。
- 空计划仍显示 `data-flow-empty`；`layout.stages=[]` 时不渲染列头，不抛。

### 5.5 样式清单（`src/client/styles.ts`，只 T3 改）

| 选择器 | 关键值 |
|---|---|
| `[data-task-overview]` | `grid-template-columns:80px minmax(0,1fr); gap:8px` |
| `[data-overview-ring]` | `width/height:80px; position:sticky; top:0` |
| `[data-progress-ring]` | `width/height:80px; overflow:visible` |
| `[data-progress-text]` | `font: ...13px/1 600; font-variant-numeric:tabular-nums`；`[data-text-tier="short"]` 16px |
| `[data-flow-stage]` | `position:absolute;width:180px;height:32px;display:flex;align-items:center;gap:6px;padding:0 8px;border:1px solid border-l1;border-radius:8px;background:bg-layer-2;box-sizing:border-box` |
| `[data-flow-stage-badge]` | `18×18;border-radius:999px;border:1px solid border-l2;background:bg-layer-1;font:11px/1 600;tabular` |
| `[data-flow-stage-name]` | `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:13px/1 600` |
| `[data-flow-stage-count]` | `font:11px/1 400;color:label-secondary;tabular;flex:0 0 auto` |
| `[data-flow-stage-link]` | `pointer-events:none` |
| `[data-flow-node]` | `width:180px;height:64px;padding:8px 10px;display:flex;flex-direction:column;gap:2px` |
| `[data-flow-node-id]` | `flex:0 0 auto;min-width:24px;height:18px;padding:0 4px;border-radius:4px;border:1px solid border-l1;background:bg-layer-2;font:11px/18px var(--ds-font-family-code);font-weight:600;text-align:center` |
| `[data-flow-node-title]` | `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px/16px` |
| `[data-flow-status]` | `flex:0 0 auto;max-width:48px;height:18px;padding:0 5px;border-radius:999px;font:11px/18px 500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`；tone 10% 底 + 40% 边 |
| `[data-flow-line="title"]` | `height:20px;display:flex;align-items:center;gap:4px` |
| `[data-flow-line="meta"]` | `height:16px;display:flex;align-items:center;gap:4px;font:11px/16px;tabular` |
| `[data-role-task-refs]` | `display:flex;flex-wrap:wrap;gap:4px;min-height:18px` |
| `[data-role-task-ref]` | `height:18px;padding:0 4px;display:inline-flex;align-items:center;border:1px solid border-l1;border-radius:999px;background:bg-layer-2;font:11px/18px;tabular` |
| `[data-task-ref-dot]` | `width:6px;height:6px;margin-right:4px;border-radius:999px;background:currentColor;flex:0 0 auto` |
| `[data-panel-library-bar]` | `height:32px;display:flex;align-items:center;gap:8px;padding:0 8px;border-bottom:1px solid border-l1` |
| `[data-panel-library-hint]` | `font:11px/16px 500;color:label-secondary` |
| `[data-library-inline-back]` | `height:28px` |

不得写 `font-size: var(--dsw-font-*)`（旧坑）；颜色只用语义 token；不加新的设计 token；抽屉 `shadow-lv3` 是唯一阴影。

## 6. 左栏 / 右栏降级协议

### 6.1 surface 契约

- 主区项目库根：`<div data-auto-team-library data-library-surface="main">`
- 右栏内联根：`<div data-auto-team-library data-library-surface="panel">`
- 判据函数（`slots.ts` 导出，供 Panel/PanellistEntry/测试共用）：

```ts
export function visibleLibrarySurface(): 'main' | 'panel' | null
```

实现：`typeof document === 'undefined'` → `null`；先查 `[data-library-surface="main"]`，`el.getClientRects().length > 0` → `'main'`；再查 panel → `'panel'`；否则 `null`。**main 优先**，同一时刻只允许一个可见 surface。

### 6.2 `createOpenLibrary`：additive + 500ms watchdog

签名改为：

```ts
export function createOpenLibrary(ctx: HostContext): (sessionId?: string) => 'main' | 'event' | 'error'
```

流程：

1. `ctx.inject(['mainArea'])` 拿 face（沿用 r14 的可选注入方式，不硬写 inject）。
2. `face !== undefined` 且 `face.open(PANELLIST_ID)` 返回 true：
   - 先标 `markLibraryOpenRequest()`；
   - 立即返回 `'main'`；
   - 起 **500ms** watchdog：若 `visibleLibrarySurface() !== 'main'`，执行 fallback（`panelCommands.open(sessionId)`，再 `setTimeout(0)` 派发 `OPEN_LIBRARY_EVENT`，返回 `'event'`；面板打不开 → `'error'`）。
3. face 缺失 / `open` 抛错 / 返回 false：
   - 立即 fallback：`panelCommands.open(sessionId)` + 派发 `OPEN_LIBRARY_EVENT`；
   - 面板 open 返回 false → `'error'`；否则 `'event'`。
4. 捕获异常，不抛未捕获；watchdog 用 `setTimeout` 一次性，不 `setInterval`（`src` 内 setInterval 仍为 1 处）。

**去重**：`markLibraryOpenRequest()` 记录 `{at: Date.now()}`（1500ms 内有效）；Panel 在 mount 时 `consumeLibraryOpenRequest()` 一次。重复点击允许再次打开，但同一 1500ms 内不叠加两个 surface。

### 6.3 `PanellistEntry`：可见结果

`LibraryPage.tsx`：

```ts
export interface PanellistEntryProps {
  size?: number
  /** 由 slots 注入；node 环境或旧宿主可能没有。 */
  openLibrary?: () => 'main' | 'event' | 'error'
}
```

- 仍是 16/18px 行内 SVG（`data-auto-team-panellist data-panellist-glyph`，`role="presentation"`，`focusable="false"`，`stroke="currentColor"`），不包 `<button>`。
- 仅当 `typeof openLibrary === 'function'` 时挂 `onClick`：**不 stopPropagation**，保留宿主 `layout.selectPanel`；`onClick` 内 `const result = openLibrary()`。
- state：`result: 'none' | 'main' | 'event' | 'error'`，初始 `none`。点击后立即 set 返回值；`setTimeout(700)` 再按 `visibleLibrarySurface()` 校准为 `main` / `event` / `error`（1s 预算内完成）。
- SVG 加 `data-last-open-result={result}` 与 `title="打开项目库"`；`result === 'error'` 时加 `data-open-error="true"`，2s 后清除，`stroke` 用 `--dsw-alias-state-error-primary`，并加 `<title>项目库暂时打不开，请稍后再试</title>`。
- 无注入时 `result` 保持 `none`，不抛错。

### 6.4 `Panel`：唯一 surface

`Panel.tsx`：

- 现有 `inlineLibrary` state 与 `OPEN_LIBRARY_EVENT` 监听保留，但监听体改为：

```ts
if (visibleLibrarySurface() === 'main') { setInlineLibrary(false); return }
setInlineLibrary(true)
```

- mount 时：`if (consumeLibraryOpenRequest() || visibleLibrarySurface() === 'panel')` 且 `visibleLibrarySurface() !== 'main'` → `setInlineLibrary(true)`；避免刷新/重挂后丢内联。
- 内联分支渲染 `[data-panel-library-inline]`，**最多一个**；hint 逐字：

```tsx
<span data-panel-library-hint role="status" aria-live="polite">
  <span data-panel-library-warn aria-hidden="true" />
  主区不可用，已在右栏打开
</span>
```

- 返回按钮 `data-library-inline-back`「← 返回面板」恢复原页签；不改当前页签。
- 不弹错误对话框、不抛未捕获；主区可用时不显示内联条。

### 6.5 `LibraryPage` 根

- `LibraryPage`（非 inline）：根加 `data-library-surface="main"`。
- `inline`：根加 `data-library-surface="panel"`。
- 两者共用 `LibraryContent(props, root)`；抽屉几何/交互不变。
- `AUTO_TEAM_OPEN_LIBRARY_EVENT` 仍导出，值不变。

### 6.6 竞态与边界

| 场景 | 处理 |
|---|---|
| 主区 `open()` 返回 true 但实际没挂载 | 500ms watchdog 降级 → `event`，1s 内可见 |
| 主区与面板同时尝试打开 | `visibleLibrarySurface` + pending 标记；只保留一个可见 surface |
| 连续点击 glyph | 每次 additive；1500ms 内不重复派发；结果取最后一次 |
| 旧宿主没有 `mainArea` | 立即走 panel 内联，`data-last-open-result="event"` |
| 面板本身打不开 | `'error'`，glyph 红 2s + `<title>`；不静默 |
| `document` 不存在（node 测试） | `visibleLibrarySurface()` 返回 null；不抛 |
| `sessionId` 缺失 | watchdog fallback 用 `undefined` 打开面板；面板按现有逻辑处理 |
| 主区恢复可用 | Panel 下一次事件时 `visibleLibrarySurface()==='main'` → 关闭内联 |

## 7. 自动组队端到端行为

```text
用户输入（开关 ON，改代码）
  → 队长 auto_team_status（只读，确认 enabled）
  → 队长 auto_team_plan（落盘计划，返回 runId）
  → 自动派发 kick（plan 之后）
  → 队长 auto_team_dispatch（工具返回 alreadyDispatched:true 或 accepted:true）
  → 队长立即结束本轮；成员后台创建
```

- 开关 OFF：`auto_team_*` 工具仍返回「未启用」；队长零写操作（AC-3）。
- 纯问答 / 明确叫停 / 只改文档 / 只跑验证 / 查证：不 plan、不 dispatch（AC-4/5）。
- 自动派发已发生时再显式 dispatch：`ok:true, alreadyDispatched:true`，零 spawn（AC-6）。
- 派发不阻塞：工具 handler 不 `await spawn`；`autoDispatch` 只 kick（AC-7）。
- 不弹确认、不加轮、不锁输入；计划在 `auto_team_plan` 返回与任务页可见（§DESIGN 6）。

## 8. 测试策略

### 8.1 既有测试的必改点

| 文件 | 现状 | r16 |
|---|---|---|
| `test/task-overview.test.ts` | radius 28 / stroke 6 / C=2π×28 | 34 / 8 / 2π×34；新增 `PROGRESS_RING_SIZE=80` |
| `test/client-ui.test.ts` | 断言 `data-flow-node-role`；环 `rotate(-90 32 32)`；标题 64×64/r28 | 删 role；改 40 40；标题 80/r34/8；加 tN/列头/refs 源码钩子 |
| `test/captain.test.ts` | `SECTION_MAX=2600`；旧特征句 | 保留 2600；断言新三条与路径清单；删「用户确认后才 dispatch」 |
| `test/dispatch-nonblocking.test.ts` | `already.code==='PLAN_ALREADY_DISPATCHED'`，零 kick | `already.ok===true`、`alreadyDispatched===true`、零 kick |
| `test/role-view.test.ts` | `rolesOf` 与 `roleUsageOf` deepEqual | 两边都带 `taskRefs`，仍逐字段相等 |
| `test/viewmodel.test.ts` | flowOf 带 roleName；flowLayoutOf 旧几何 | flowOf 也带 roleId；flowLayoutOf 新几何 + 多角色用例 |
| `test/library-project.test.ts` | flowOf 节点带角色名 | 加 `roleId` 断言 |
| `test/client-contract.test.ts` | 页签 3/PanelAction 21/路由 4/RejectionCode 13/kind 9/TaskStatus 13/工具 8/setInterval 1 | 全部不变；`bag.openLibrary` 仍是函数；新增 `data-library-surface` 源码断言 |

### 8.2 新增测试

| 文件 | 覆盖 |
|---|---|
| `test/r16-role-refs.test.ts` | `roleTaskRefViewOf` 13 状态 → text 严格 id、title/aria 含中文、5 tone；`roleUsageOf` 的 `taskRefs` 顺序/数量；空/缺省 |
| `test/r16-flow-canvas.test.ts` | 多角色分列、首次出现顺序、零任务角色不出列、同 roleName 不同 roleId 不合并、旧快照 roleName 回退、单列「角色未记录」、列间箭头、任务边、宽高/节点坐标、空计划；`FlowCanvas.tsx` 源码钩子（无 `data-flow-node-role`、有 `data-flow-stage`/`data-flow-node-id`/`data-flow-stage-link`） |
| `test/r16-library-open.test.ts` | `visibleLibrarySurface` 优先级（main > panel）、`consumeLibraryOpenRequest` 时效、`createOpenLibrary` 三种返回值（stub `mainArea`/`panelCommands`/`window`）、PanellistEntry/Panel/LibraryPage 源码钩子（`data-last-open-result`、逐字 hint、`data-library-surface`） |
| `test/r16-styles.test.ts` | 80px 环 / 80+8+208 网格 / 列头 / 节点 64 / tN / 胶囊 / refs / inline bar 的选择器与值；`font-size: var(--dsw-font` 零命中 |

测试环境没有 jsdom / `react-dom/server`，**不要**新增依赖做渲染；DOM 断言用「纯 view helper + 源码正则 + 真机 computed style」三层，真实颜色/几何由 QA 在 54058 抓。

### 8.3 变异探针（AC-21，7 个）

`test/r16-mutation-probes.mjs` 按 r14 模式：复制源文件 → 字符串替换 → 跑对应测试 → 断言变红 → 还原。7 个：

1. `flowLayoutOf` 按 `roleName` 分组而非 `roleId` → 同 roleName 不同 roleId 用例红。
2. `flowLayoutOf` 用 `node.column` 当列号 → 多角色列顺序用例红。
3. `roleUsageOf` 的 `taskRefs` 反序 → refs 顺序用例红。
4. `tools.ts` 把 `PLAN_ALREADY_DISPATCHED` 还原成 `ok:false` → 幂等派发用例红。
5. `createOpenLibrary` 去掉 watchdog → 主区未挂载降级用例红。
6. `PROGRESS_RING_RADIUS` 改回 28 → `task-overview` 红。
7. `captainSection` 删掉「只有需要修改代码」条件 → captain 用例红。

### 8.4 性能（AC-23）

- 100 runs 冷/热：`flowLayoutOf` 只 O(nodes) 一次 Map + 一次排序无关遍历；`buildRunDetail` 不重复调 `flowLayoutOf`。
- 50 节点 × 3 角色：节点坐标只算一次，拖动只改 `transform`，不触发 React 重渲染。
- 新增监听器仅 Panel 一个 `OPEN_LIBRARY_EVENT`（已有）+ glyph onClick；不新增 `setInterval`。
- 50 节点首帧目标 ≤ r14 基线 +10%；若超，优先减少 `useMemo` 依赖变化，不引入虚拟化。

### 8.5 真机（AC-22）

- 第一宿主 54058：先复现侧栏点击；修复后同条件 3/3；主区可用/收起两种形态。
- 第二宿主 51890：开关 ON/OFF、自动组队、内联降级、画布几何、computed color。
- 不 mock；无法复现/环境不可用时如实记「未验证 + 阻塞原因」，不以克隆宿主可点替代。

### 8.6 门禁与 Git

```bash
pnpm -s typecheck
pnpm -s test                 # ≥706
pnpm -s build
node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')"
npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis\.patch\.yml'
find src -name '*.ts*' -newer lib/index.js | wc -l   # 0
node test/r16-mutation-probes.mjs
git branch --show-current    # feat/auto-team-plugin
git status --porcelain --untracked-files=all
```

- 中间阶段**不提交**；T1–T7 完成后工作树应只剩预期改动（`src/`、`test/`、`lib/`、`docs/teamflow/20261104-r16-.../`、`docs/teamflow/20261104-r15-.../meta.json`、`docs/teamflow/memory.md`）。
- 收口在验收阶段执行**单笔提交**：`feat(r16): 开关即自动组队 + 角色列画布 + 左栏可见结果`；提交后 `git status` clean。
- 不提交 `logs/teamflow/`；不改 `AGENTS.md` 正文；不新增依赖；不动 `~/.dsh/profiles/desktop`。

## 9. 任务拆分（按文件边界，可并行）

### T1 契约与派生（`dev`）

- **依赖**：无。
- **文件**：`src/shared/types.ts`、`src/host/library.ts`、`src/client/viewmodel.ts`、`test/viewmodel.test.ts`、`test/role-view.test.ts`、`test/library-project.test.ts`、`test/library.test.ts`、`test/task-overview.test.ts`。
- **读**：`docs/teamflow/.../PRD.md`、`DESIGN.md`、`src/shared/role-view.ts`、`src/shared/task-actions.ts`。
- **spec**：加 `RoleTaskRef`、两个可选字段；host/client 两处填 `taskRefs`/`roleId`；环常量 80/34/8/213.628；几何常量 64/208/80/12/54/28；`flowLayoutOf` 返回 `stages/stageLinks` 并按 `roleId→roleName→fallback` 分列；`FlowNodeCellView` 加 `statusText/tone`；`roleTaskRefViewOf`；更新 5 个既有测试。
- **验收**：`pnpm -s typecheck && node --test test/viewmodel.test.ts test/role-view.test.ts test/library-project.test.ts test/library.test.ts test/task-overview.test.ts`

### T2 提示词与幂等派发（`dev`）

- **依赖**：无。
- **文件**：`src/host/prompt.ts`、`src/host/tools.ts`、`test/captain.test.ts`、`test/dispatch-nonblocking.test.ts`、`test/tools.test.ts`。
- **spec**：`captainSection` 改条件式（§3.3），≤2600；dispatch 已派发分支返回 `ok:true/alreadyDispatched:true`，零 kick（§3.4）；工具描述补幂等；更新 3 个既有测试。
- **验收**：`pnpm -s typecheck && node --test test/captain.test.ts test/dispatch-nonblocking.test.ts test/tools.test.ts`

### T3 全部样式（`dev`）

- **依赖**：无（与 T1/T2/T6 并行）。
- **文件**：`src/client/styles.ts`、`test/r16-styles.test.ts`。
- **spec**：§5.5 全表；80 环、80+8+208、列头、节点 64、tN、状态胶囊 5 tone、refs chip/dot、内联 bar/hint；不新增 token；`font-size: var(--dsw-font` 零命中。
- **验收**：`node --test test/r16-styles.test.ts`

### T4 环 / 总览 / 角色卡（`dev`）

- **依赖**：T1。
- **文件**：`src/client/views/ProgressRing.tsx`、`src/client/views/TaskOverview.tsx`、`src/client/views/RoleCard.tsx`、`test/r16-role-refs.test.ts`。
- **读**：`src/client/viewmodel.ts`（T1 后）、`src/shared/role-view.ts`。
- **spec**：80/viewBox 80/40/rotate 40；文本 16 短、13 长；TaskOverview 显式 size；RoleCard refs 行（§5.3），空不渲染；13 状态 chip。
- **验收**：`node --test test/r16-role-refs.test.ts test/task-overview.test.ts`

### T5 角色列画布（`dev`）

- **依赖**：T1、T4（T4 改完环断言后再改 `client-ui.test.ts`）。
- **文件**：`src/client/views/FlowCanvas.tsx`、`test/client-ui.test.ts`、`test/r16-flow-canvas.test.ts`。
- **spec**：§5.4；列头 + tN + 状态胶囊 + 第二行 meta + 列间箭头 + 图例；去 `data-flow-node-role`；拖动/重置/键盘沿用；更新 client-ui 的 FlowCanvas/ProgressRing/RoleCard 断言。
- **验收**：`node --test test/client-ui.test.ts test/r16-flow-canvas.test.ts`

### T6 左栏 / 面板 / 库（`dev`）

- **依赖**：无。
- **文件**：`src/client/slots.ts`、`src/client/LibraryPage.tsx`、`src/client/Panel.tsx`、`test/r16-library-open.test.ts`、`test/client-contract.test.ts`。
- **spec**：§6 全部；`visibleLibrarySurface`/pending/500ms watchdog/700ms 校准；单一 surface；逐字 hint；`data-library-surface`；不改 slot 注册数量与 inject 形状。
- **验收**：`node --test test/r16-library-open.test.ts test/client-contract.test.ts`

### T7 交付自检（`dev`）

- **依赖**：T1–T6 全部。
- **文件**：`test/r16-mutation-probes.mjs`；必要时做集成修补（`writeScopes: ["src","test"]`，依赖已完成，冲突自然释放）。
- **spec**：7 个变异探针；跑全门禁；确认工作树清单；**只修不扩**：不写 `QA-REPORT.md`/`ACCEPTANCE.md`，不做跨浏览器/真机全矩阵（QA 负责）；不提交。
- **验收**：`pnpm -s typecheck && pnpm -s test && pnpm -s build && node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')" && npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis\.patch\.yml' && node test/r16-mutation-probes.mjs`

**并行度**：T1 ∥ T2 ∥ T3 ∥ T6（4 条，maxConcurrent=3 时第 4 条排队）；T4 等 T1；T5 等 T4；T7 等全部。文件所有权互斥，见 §1。

## 10. 风险与待验证

| 风险 | 应对 |
|---|---|
| 54058 侧栏不可复现 | AC-10 预设：≥4 项差异清单 + 真机步骤 + 「未验证」；不以 51890 可点替代 |
| `open()` 成功但主区未挂载 | 500ms watchdog + `getClientRects` + 700ms 校准；QA 在真机看 `data-last-open-result` |
| 主区/面板双开 | 单一 `visibleLibrarySurface()` + pending 标记 + Panel 监听守卫 |
| 两列宽 412 > 296 | 设计已限：初始第 1 列完整 + 第 2 列 76px，拖动画布；不缩放、不换列 |
| CSS 与 TS 几何漂移 | 几何常量只在 viewmodel；CSS 只写尺寸，测试同时断言两处 |
| `client-ui.test.ts` 旧断言 | T5 统一更新；T4 完成后才跑 T5，避免同文件冲突 |
| prompt 超 2600 | T2 先改再测；超长先压缩旧「派发前提醒」段，不删新规则 |
| 旧快照缺 `roleId` | `roleName → 单列「角色未记录」` 回退；旧 `column` 不参与分列 |
| 缓存命中率被要求 | 非目标；只保留 token/用时，缺失「不可得」 |
| 大改 `bridge.ts` 诱发回归 | 明确不改；幂等翻译只在 tools 层 |

## 11. 验证命令（交付时按序）

```bash
pnpm -s typecheck
pnpm -s test
pnpm -s build
node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')"
npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis\.patch\.yml'
find src -name '*.ts*' -newer lib/index.js | wc -l
node test/r16-mutation-probes.mjs
git branch --show-current
git status --porcelain --untracked-files=all
```
