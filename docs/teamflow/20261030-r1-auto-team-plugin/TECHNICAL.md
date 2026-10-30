# 技术方案 · dsh-auto-team 0.2.0

> 基线依赖：`docs/teamflow/20261030-r1-auto-team-plugin/`（PRD.md + DESIGN.md）
> 产品级架构：`docs/teamflow/architecture/ARCHITECTURE.md`（技术栈与宿主契约，本方案只补增量）
> 本次不做版本切换（仍是 0.1.0 包内迭代，PRD 未要求改 semver）；分支 `feat/auto-team-plugin` 不动。

---

## 0. 交付范围：脚手架已有什么、本方案补什么

脚手架 49 个文件已可 `typecheck / test(31 例) / build / import 自检 / npm pack` 全绿，但**功能链路上有 7 处断点**，它们不是"再补点 UI"，而是会让 AC-15/17/18/19/22/24/30 直接不成立。本方案的核心就是把断点接上，并给出可被单测钉住的接口。

| # | 断点（实测位置） | 后果 | 本方案对策 |
|---|---|---|---|
| D1 | `src/host/gate/gate.ts` 的 `runGate` **没有任何调用点**；且用 `spawnSync` | 任务只能自己说"做完了"，AC-19 不成立；同步阻塞最长 300s，面板 5s 不刷新，AC-18 也不成立 | 改异步 `Promise` + 注入 `exec`，由 `receipt` 动作驱动（§5.3） |
| D2 | `src/host/index.ts` 里 `bridge.dispatch` 是 stub（`started: readyTasks(tasks)`） | 派发不创建成员、不落盘 | 接 `dispatchReady`（§5.1） |
| D3 | 无成员存活检测；`MemberView.status` 全部由 `task.status` 推导 | 杀进程后面板永远显示"运行中"，AC-18 反面目标 | 新增 host 侧 `memberWatcher`（§5.4） |
| D4 | `PanelSnapshot` 无 `messages`，`ActivityEvent.kind` 无 `plan` | AC-16 直连消息无账本、AC-30 计划条目无证据 | 扩展 `RunState` 与快照（§2） |
| D5 | 成员无确定性命名、无 binding 表；`resume` 只发固定文本 | AC-17 恢复幂等无判据 | `memberNameFor()` + `bindings` + `resumeRun()`（§5.2） |
| D6 | `src/client/index.ts` 从 `../host/config.ts` import `PLUGIN_ID` | 违反"host/client 零直接 import"，client 产物可能把 host 代码打进去 | 抽 `src/shared/const.ts`（§1） |
| D7 | `MemoryTab` 没有"读正文"动作，编辑已有文件时 `body=''` | 点保存 = 把已有记忆清空（AC-24 反面） | 新增 `GET /api/auto-team/memory` + `api.readMemory`（§4.1/§6） |

另外两处"两个挂载面各自轮询"（`usePanelState` 每实例一个 `setInterval`）会让开关行与面板各打一次快照，本方案改成模块级单例 store（§7）。

### 不做什么

- 不改 `cordis.patch.yml`、`package.json` 的交付字段（AC-1~AC-9 已满足，动了只有回归风险）。
- 不新增路由前缀、不新增宿主挂载面（两个 slot 已够）。
- 不引入 jsdom/vitest/Playwright 到本包依赖（前端纯函数抽 `viewmodel.ts` 单测，界面交 QA 真机）。
- **不假装逐角色 model 已下发**（§14 限制 L1）。

---

## 1. 技术栈与构建（继承 ARCHITECTURE，仅两处增量）

| 项 | 现状 | 本轮 |
|---|---|---|
| TS 5.9 strict / `verbatimModuleSyntax` / `allowImportingTsExtensions` | 已配 | 不变；所有本地 import 继续带 `.ts` |
| tsdown 双产物（`lib/index.js` ESM node22、`lib/client.js` CJS + `__ModuleLoader__`） | 已配 | 不变 |
| `jsx: "react"`（classic） | 已配 | 不变；**禁止**改 `react-jsx` |
| 依赖方向 `shared → (host, client)` | 有一处违规 | 新增 `src/shared/const.ts`：`export const PLUGIN_ID = 'dsh-auto-team'`、`export const BRIDGE_ROUTE = '/api/auto-team'`；`host/config.ts` 改为 re-export 这两个常量，`client/index.ts` 改从 `shared/const.ts` 取 |
| 测试 | `node --test test/*.test.ts` | 同；新增测试文件自动被 glob 收 |

`src/shared/const.ts` 是唯一新增的"纯常量"文件 —— 不可替代的理由：`PLUGIN_ID` 同时被宿主产物（`app` 注册）与 client 产物（`slot register` 的 `id`）使用，AC-2/AC-3 要求两处逐字一致，复制字符串必然漂移。

---

## 2. 运行态数据模型与存储

### 2.1 磁盘布局（`paths.ts` 已实现，不改语义）

```
<home>/.dsh/auto-team/
├── sessions.json                 # { version:1, sessions:{ [sessionId]:{enabled,runId?,updatedAt} } }
├── runs/<runId>.json             # RunState v2（见 2.2）
├── roles/<roleId>.json           # Role（JSON，非 md —— PRD AC-21 允许 json）
├── memory/public/<name>.md       # 公共记忆（AC-23 公共轨）
└── skills/<skillId>.md           # 内置技能正文（只读）
<workspace>/.auto-team/
├── memory/<name>.md              # 项目记忆（AC-23 项目轨）
└── artifacts/<taskId>.log        # 门禁命令全文（AC-19 证据）
```

`roles/` 用 JSON 而非 md：角色是**结构化配置**（`skillIds[]`、`model{provider,model,effort}`），md 无法稳定解析回结构；技能正文才是 md（`skills/`）。这与 AC-21「新建/修改角色落盘、重启保留」不冲突，但 PRD 里写的"md"按此口径实现，验收时以"落盘 + 重启保留 + 生效"为准。

### 2.2 `RunState` v2（替代裸 `Plan` 落盘）

```ts
// src/shared/types.ts（新增）
export interface MessageRecord {
  at: number;
  from: "captain" | "member";
  to: string;              // 队长侧显示用：成员名 / "captain"
  toMemberId?: string;
  taskId?: string;
  body: string;
  messageId?: string;      // 宿主 sendMessage 返回
}

export interface MemberBinding {
  taskId: string;
  roleId: string;
  memberId: string;
  name: string;            // 确定性名：`${roleId}-${taskId}`（sanitize 后）
  spawnedAt: number;
  retired?: boolean;
}

export interface RouteAudit {
  taskId: string;
  roleId: string;
  declared: RoleModelRoute | null;   // null = 角色未配模型，沿用会话默认
  actual?: RoleModelRoute;           // agent/created 里读到的实际值
  at: number;
  verdict: "ok" | "drift" | "unverified";  // unverified = 宿主未回传实际值
}

// src/host/store.ts（新增）
export interface RunState {
  version: 2;
  plan: Plan;
  plannedAt: number;               // AC-30：计划条目落盘时间，必须 < 首个 spawnedAt
  messages: MessageRecord[];       // 上限 200 条，超出丢最旧
  bindings: MemberBinding[];
  routeAudits: RouteAudit[];
}
```

`PlanTask` 增 3 个可选字段（向后兼容）：`attempts?: number`（rework 次数，AC-19 需要"证据回发"不是无限循环，超过 3 次转 `failed` 并记 activity）、`lastResumeAt?: number` / `lastResumeStatus?: TaskStatus`（AC-17 幂等判据）。

`ActivityEvent.kind` 扩为 `'plan' | 'spawn' | 'message' | 'tool' | 'gate' | 'status' | 'interrupt' | 'route_drift' | 'rework'`。

`PanelSnapshot` 增：`plannedAt?: number`、`messages: MessageRecord[]`、`routeAudits: RouteAudit[]`、`concurrency: { limit: number; running: number; source: 'host' | 'plan' | 'default' }`。

### 2.3 存储接口（`src/host/store.ts`，dev 必须逐字使用）

```ts
export class RunsStore {
  constructor(dir: string);
  load(runId: string): RunState | null;             // 内部走 wrapLegacy，v1 裸 Plan 自动包成 v2
  save(state: RunState): void;                      // tmp + rename 原子写（沿用现实现）
  latestForSession(sessionId: string): RunState | null;
  list(): RunSummary[];
}
export function wrapLegacy(raw: unknown): RunState | null;  // 纯函数，供单测
export function makeRunId(sessionId: string, now: number): string;
```

写入策略：**每次状态变更即整体 `save`**。理由：单 run 的 `RunState` 序列化后 < 20KB，原子写成本 ~1ms，远低于做增量 patch 的复杂度与错序风险；且 `runs/` 天然是审计留痕（AC-19 证据、AC-30 时间戳都在里面）。

---

## 3. 宿主 API 适配契约（`src/host/adapters.ts` 增量）

现有实测契约（tools/prompt/webServer/agentTeams/llm，见 ARCHITECTURE §8）不动，新增 5 个薄封装，宿主形状**只在此文件出现**：

```ts
export interface HostMember { id: string; name: string; status: string }
export function listHostMembers(ctx: unknown): Promise<HostMember[]>;      // agentTeams.listMembers(caller)，无 caller 时 reject(NO_CALLER)
export function resolveConcurrencyLimit(ctx: unknown): { limit: number; source: "host" | "default" };
export function registerEffect(ctx: unknown, dispose: () => void): boolean;  // ctx.effect → 卸载时清 watcher/gate 队列
export function registerAgentCreated(
  ctx: unknown,
  handler: (payload: { member: { id: string; name: string }; model?: RoleModelRoute }) => void,
): boolean;                                                              // 只透传，字段缺失时 handler 收到 {member} 无 model
export function spawnMember(ctx: unknown, input: SpawnInput): Promise<{ ok: true; memberId: string; name: string } | { ok: false; error: string }>;
```

`registerAgentCreated` 在本轮**由"只注册不解析"升级为"解析可用字段、缺失则明说"**：payload 里没有 `model` 就不伪造，交给 §5.5 记 `verdict='unverified'`。

---

## 4. 接口设计

### 4.1 HTTP（`src/host/http.ts`，路径前缀 `/api/auto-team`）

| 方法 | 路径 | 入参 | 返回 | 说明 |
|---|---|---|---|---|
| GET | `/api/auto-team/snapshot?sessionId=` | `sessionId` 缺省用 `defaultSessionId` | `{ data: PanelSnapshot }` / `{ error }` | 面板与开关行的唯一数据源；**始终包 `{data}`** |
| GET | `/api/auto-team/memory?sessionId=&track=&name=` | `track∈{public,project}` | `{ data:{ track,name,body,chars } }` / `{ error }` | 修 D7；`name` 必须过 `safeMemoryName`，失败 → `{error:'非法文件名'}` 且不读盘（AC-24 路径逃逸） |
| POST | `/api/auto-team/act` | `{ sessionId, action: PanelAction }` | `{ data: ActResult }` / `{ error }` | 所有写操作 |

```ts
export interface ActResult {
  snapshot: PanelSnapshot;          // 动作后的最新快照，前端不必再拉一次
  notices?: string[];               // 人话提示，如"并发已满，剩余 2 个任务排队"
  rejected?: { code: RejectionCode; message: string };
}
```

HTTP 状态码一律 200（除路由不存在 404、内部异常 500）；业务拒绝放 `rejected`，这样前端 `{data,error}` 解包逻辑不分叉。

### 4.2 `PanelAction` 全集（扩展后）

```ts
export type PanelAction =
  | { type: "toggle"; enabled: boolean }                                        // AC-12
  | { type: "dispatch"; runId?: string }                                        // AC-15/30（不传 runId 用会话最新 draft）
  | { type: "cancel" }                                                          // AC-30 可取消
  | { type: "setTaskRole"; taskId: string; roleId: string }                     // AC-14 替换角色
  | { type: "message"; taskId?: string; memberId?: string; text: string }       // AC-16
  | { type: "resume"; taskId?: string }                                         // AC-17
  | { type: "receipt"; taskId: string; note?: string }                          // AC-19 触发门禁
  | { type: "saveMemory"; track: MemoryTrack; name: string; body: string }      // AC-24
  | { type: "deleteMemory"; track: MemoryTrack; name: string }                  // AC-24
  | { type: "saveRole"; role: Role }                                            // AC-21
  | { type: "deleteRole"; roleId: string };                                     // AC-21（UI 侧有确认）
```

`RejectionCode = 'NOT_ENABLED' | 'NO_PLAN' | 'PLAN_ALREADY_DISPATCHED' | 'ROLE_UNAVAILABLE' | 'MODEL_UNRESOLVABLE' | 'ROUTE_DRIFT' | 'CONCURRENCY_FULL' | 'NOT_FOUND' | 'NO_CALLER' | 'BAD_REQUEST'`。

### 4.3 模型可见工具（`src/host/tools.ts`，前缀 `auto_team_`，共 7 个）

| 工具 | 入参 | 关键行为 |
|---|---|---|
| `auto_team_plan` | `{ goal, tasks:[{title,roleId,dependsOn?,acceptance?}], maxConcurrent? }` | 建 `RunState`（`plannedAt=now`）、push `kind:'plan'` 活动、返回 `{runId, blocked?, ready?}`；**不创建任何成员** |
| `auto_team_dispatch` | `{ runId }`（必填） | **强制队长先出计划**：缺 `runId` 或 run 不存在 → 明确报错。这是 AC-30「计划条目早于首个成员创建」的机械保证 |
| `auto_team_status` | `{}` | 返回 `snapshot` 的文本摘要（任务/成员/门禁证据） |
| `auto_team_message` | `{ taskId?/memberName?, text }` | 直达消息，写 `messages` 账本（AC-16） |
| `auto_team_receipt` | `{ taskId, note? }` | **新增**：跑门禁 → 通过则 done、失败转 rework 并回发证据（AC-19） |
| `auto_team_memory` | `{ track, name?, body? }` | 读/写记忆（写入带来源标注） |
| `auto_team_role` | `{ action:'list'\|'save'\|'remove', role? , roleId? }` | 角色 CRUD |

开关关闭时**所有**工具返回 `NOT_ENABLED_MESSAGE`（已有常量，文案不改）。

---

## 5. 编排核心

### 5.1 派发（`src/host/team/dispatch.ts`）

```ts
export function memberNameFor(task: PlanTask): string;   // `${roleId}-${taskId}` → [a-zA-Z0-9_-]{1,48}
export function runningCount(tasks: PlanTask[]): number;
export async function dispatchReady(state: RunState, deps: DispatchDeps): Promise<DispatchResult>;

export interface DispatchDeps {
  store: RunsStore;
  spawn: SpawnPort;                          // 现签名不变：SpawnInput → {ok,memberId}
  roles: RoleRepo;
  buildPrompt: (input: PromptInput) => string;
  listMembers: () => Promise<HostMember[]>;
  now?: () => number;
}
export interface DispatchResult {
  state: RunState;
  started: string[];                          // taskId
  skipped: { taskId: string; reason: RejectionCode | "ALREADY_RUNNING" }[];
  errors: { taskId: string; error: string }[];
}
```

算法（顺序即实现顺序）：

1. `plan.status` 必须是 `draft`/`dispatching`/`paused`；`cancelled`/`terminated` → `NO_PLAN` 拒绝。
2. `limit = Math.min(plan.maxConcurrent, hostCap, MAX_CONCURRENT_LIMIT)`，`hostCap` 来自 `resolveConcurrencyLimit(ctx)`。
3. `slots = limit - runningCount(tasks)`；`slots <= 0` → 返回 `skipped` 全部 `CONCURRENCY_FULL`，**不报错**（并发满不是失败）。
4. 取 `readyTasks(tasks)`（`graph.ts` 已有，语义：全部依赖 `done`）按任务顺序切前 `slots` 个。
5. 每个 ready 任务：
   a. `role = roles.get(task.roleId)`；缺失 → `ROLE_UNAVAILABLE`，任务保持 `pending` 并 push activity（**不猜角色**，AC-14）。
   b. 已有 binding 且成员仍在 `listMembers()` 里 → 只发续跑消息，状态置 `running`，`started` 不计（幂等，AC-17）。
   c. `preflightRoutes([role], routePort)` 失败 → `MODEL_UNRESOLVABLE`（AC-22 禁止静默回退）。
   d. `purgeBlocked`：把依赖未 done 的任务标 `blocked`（`blockedTasks()` 已有）。
   e. `prompt = buildPrompt({ role, task, plan, memory })`，`spawn(...)`；成功 → `task.status='running'`、`task.memberId`、`task.attempts ??= 0`，写 `bindings`、`messages`（`kind:'spawn'` 活动）。
6. 任一步抛错只记 `errors` 并继续下一个（现有行为保留）。
7. 收尾 `store.save(state)` 一次。

**派发前置断言**：`if (state.plannedAt >= firstSpawnAt) throw` 不写成异常，而是 `console` 不可用 —— 落成 activity 顺序检查：`dispatchReady` 在 spawn 前先 push `kind:'spawn'`（带 `at`），若 `plannedAt > spawn.at` 说明时钟被回拨，则记 `notices:'计划时间戳异常'`。单测直接断言 `plannedAt < bindings[0].spawnedAt`。

### 5.2 恢复（`src/host/team/dispatch.ts`）

```ts
export async function resumeRun(state: RunState, deps: ResumeDeps): Promise<{
  state: RunState; resumed: number; skipped: number; unchanged: boolean;
}>;
```

- 只处理 `running` / `gate` / `interrupted` 任务；`done` 一律跳过（AC-17"已完成不重跑"）。
- 成员按 `bindings` 里的**成员名**在 `listMembers()` 里重新绑定（宿主重启后 adapter 的 `id→name` 内存表丢失，名字是唯一可重建的键）。
- 成员存在 → 发一条续跑消息，`task.lastResumeAt=now`、`lastResumeStatus=当前 status`；成员不存在 → 标 `interrupted`，**不自动新建**（新建就是成员翻倍）。
- 幂等判据（可被单测钉住）：若 `task.lastResumeStatus === task.status` 且 `now - task.lastResumeAt < RESUME_DEBOUNCE_MS(3000)` → 计入 `skipped`；两次连续 `resume` 时第二次必须 `resumed === 0 && unchanged === true`。

### 5.3 门禁与回执闭环（`src/host/gate/gate.ts` 改造 + `bridge.act`）

```ts
export type GateExec = (
  command: string,
  opts: { cwd: string; timeoutMs: number; logPath: string },
) => Promise<{ code: number | null; tail: string }>;

export interface GateDeps {
  cwd: string;
  artifactsDir: string;
  now?: () => number;
  timeoutMs?: number;
  exec?: GateExec;                 // 缺省 defaultGateExec（异步 spawn，超时 SIGKILL）
}
export async function runGate(task: PlanTask, deps: GateDeps): Promise<{ ok: boolean; evidence: GateEvidence }>;
export function defaultGateExec(command: string, opts: {...}): Promise<{ code: number | null; tail: string }>;
export function tailOf(text: string, limit: number): string;
```

- **同步改异步**：`spawnSync` 会把事件循环卡满（最长 300s），面板与工具全部失联 → 直接违反 AC-18。改 `child_process.spawn` + `setTimeout(→kill('SIGKILL'))`，全文流式写 `<artifacts>/<taskId>.log`（保留全量供人查），内存只留尾部 `GATE_TAIL_CHARS=4000`。
- 门禁串行化：`bridge` 内一个 `gateQueue`（`Promise` 链 + 队列上限 8），避免多个 receipt 同时炸出 8 个 shell。
- `receipt` 动作顺序：`task.status='gate'` → 落盘 → `await runGate` → `applyReceipt` → 落盘 → activity `kind:'gate'`。
- `applyReceipt` 现有语义保留并补齐：`done` → 下游 `blocked→pending`（`readyTasks` 下次自然取到）；`rework` → `status='rework'`、`attempts+1`、**把证据文本作为消息发给同一 `memberId`**（AC-19"证据回发成员"）、下游保持 `blocked`；`attempts >= 3` → `failed` 并 `notices` 提示人工。
- 空 `acceptance`：`exitCode=-1`、`ok=false`，`rejected.code='GATE_FAILED'`，消息为"该任务没有验收命令，需要人工确认后放行"（不假装通过）。

### 5.4 成员存活（`src/host/team/watcher.ts` 新增）

```ts
export interface WatcherDeps {
  store: RunsStore;
  listMembers: () => Promise<HostMember[]>;
  now?: () => number;
  intervalMs?: number;             // 缺省 1500
}
export function reconcileMembers(state: RunState, members: HostMember[], now?: number): { state: RunState; changed: number };
export function createMemberWatcher(deps: WatcherDeps): { tick(): Promise<number>; start(): void; stop(): void };
```

映射规则（宿主 4 态 → 本项目 7 态）：

| 宿主成员 | 本项目 | 触发动作 |
|---|---|---|
| 存在且 `running` | `running` | 刷新 `lastEventAt` |
| 存在且 `provisioning` | `provisioning` | — |
| 存在且 `inactive` | `interrupted` | activity `kind:'interrupt'`，task 从 `running`→`interrupted` |
| 不存在 / `failed` | `interrupted`（或 `failed` 若 `attempts>=3`） | 同上 |

- `intervalMs=1500`，仅当存在非终态任务时 `tick`；用 `ctx.effect`（`registerEffect`）注册 `stop`，插件卸载/宿主退出时清掉定时器。
- **刷新链路预算（AC-18 ≤5s）**：watcher 1.5s + 前端轮询 2s（有 running 任务时）= 最坏 3.5s。前端空闲期降到 5s（§7），避免空转。

### 5.5 逐角色模型（`src/host/team/route.ts`，AC-22 的诚实口径）

```ts
export interface RoutePort { resolveRoute(route: RoleModelRoute): Promise<RoleModelRoute | null> }
export async function preflightRoutes(roles: Role[], port: RoutePort): Promise<{ failed: { roleId: string; route: RoleModelRoute; error: string }[] }>;
export function auditRoute(state: RunState, taskId: string, declared: RoleModelRoute | null, actual: RoleModelRoute | null, now?: number): RunState;
export function routeDrift(declared: RoleModelRoute | null, actual: RoleModelRoute | null): boolean;
```

- **派发前**：角色显式配了 `model` → `resolveCallConfig({provider,model})` 必须成功且 provider/model 与声明一致；不一致或抛错 → `failed`，`act` 返回 `rejected.code='MODEL_UNRESOLVABLE'`，**绝不降级用队长模型**。
- **派发后**：`registerAgentCreated` 收到成员事件 → 反查 binding → 若有 `model` 字段则 `auditRoute(verdict='ok'|'drift')`；`drift` → 立刻把 task 置 `failed`、activity `kind:'route_drift'`、`notices` 明说（宁停不静默）。
- **无 `model` 字段**（当前宿主）→ `verdict='unverified'`，面板成员行的模型位显示 `声明 provider/model（未下发）`，`data-model-route` 仍输出声明值（几何与 AC-22"逐字一致"可核验的是**声明值**）。
- 这条限制必须写进交付说明，不得在 QA 报告里被当成"已生效"。

### 5.6 并发上限（AC-15）

`resolveConcurrencyLimit(ctx)`：先读宿主 `agentTeams` 的并发上限（inspect / 配置，可得则 `source='host'`），读不到返回 `{limit: 3, source:'default'}`，最后与 `plan.maxConcurrent`、`MAX_CONCURRENT_LIMIT=8` 取最小值。`snapshot.concurrency` 把三者都暴露给面板，QA 可断言"running 数 ≤ limit"。

---

## 6. 前端组件与页面拆分

两个挂载面已是最终形态，只做内部增强（`data-*` 属性全部保留，QA 靠它们定位）。

| 文件 | 组件/页 | 本轮改动 |
|---|---|---|
| `src/client/index.ts` | 挂载 | `PLUGIN_ID` 改从 `shared/const.ts` 取（修 D6）；两个 slot 的 `inject`/`register.name` 保持逐字一致（AC-3） |
| `src/client/Toggle.tsx` | `conversation.composer.dock` 开关行 | 文案与胶囊取 `viewmodel.capsuleOf`；「面板」按钮：先试 `window.dispatchEvent(new CustomEvent('dsh-auto-team:open-panel'))`，若 3s 内没有 Panel 订阅（用模块级 `listenerCount()` 判断）则改为 tooltip「在右栏『自动团队』页签查看」——不做无法验证的"编程式激页签"承诺 |
| `src/client/Panel.tsx` | `sidebar.right.pane.tab` 容器 | 订阅 `dsh-auto-team:open-panel` 后切到计划页；四页签不变；`data-dsh-auto-team-panel` 保留 |
| `src/client/tabs/PlanTab.tsx` | 计划页 | 显示 `plannedAt` 时间戳（AC-30 证据）、并发三元组、每任务角色下拉（`setTaskRole`，AC-14）、开始派发/取消 |
| `src/client/tabs/MembersTab.tsx` | 成员页 | 成员行加 `data-status`/`data-model-route`（已有）+ **「回执」按钮**（`receipt`）；证据抽屉展示 `command/exitCode/artifacts/tail`；底部消息账本区展示 `from→to · taskId · 时间 · 正文`（AC-16） |
| `src/client/tabs/MemoryTab.tsx` | 记忆页 | **点条目先 `readMemory` 拉正文再填编辑器**（修 D7）；预算行「预计注入 N/4000」+ 截断 chip 保留；删除二次确认 |
| `src/client/tabs/RolesTab.tsx` | 角色页 | 删除二次确认（AC-21）；provider/model 校验非空；模型列标注「未下发」当 `routeAudits` 为 `unverified` |
| `src/client/styles.ts` | 样式常量 | 只加成员行消息账本与回执按钮样式；**字号只能写 `font: var(--dsw-font-*)`**；颜色只用 `state-*` / `alias-*` token |
| `src/client/viewmodel.ts` | 纯函数（新增） | `capsuleOf(enabled, snapshot)`、`statusBadge(status)`、`formatModelRoute(route, audit?)`、`tailLines(text, n)`、`formatClock(ts)` —— 无 React import，可被 `node --test` 直接测 |

`viewmodel.ts` 不可替代的理由：胶囊文案与 7 态徽标是 AC-18/AC-22 的"可核验文本"，现在长在带 JSX 的 `Toggle.tsx` 里，无法单测，只能靠 QA 眼看。

---

## 7. 客户端状态管理：模块级单例 + `useSyncExternalStore`

现状问题：`usePanelState` 每次调用新建 `useState` + `setInterval`，开关行与面板各轮询一次（双倍请求、且两处可能显示不同步的状态）。

```ts
// src/client/state.ts（重写内部实现，导出签名保持兼容）
export interface PanelView {
  sessionId: string;
  snapshot: PanelSnapshot | null;
  loading: boolean;
  error: string | null;
}
export interface PanelStore {
  getView(): PanelView;
  subscribe(fn: () => void): () => void;
  refresh(): Promise<void>;
  act(action: PanelAction): Promise<ActResult>;
  dispose(): void;
}
export function createPanelStore(api: PanelApi, opts?: { idleMs?: number; activeMs?: number; now?: () => number }): PanelStore;
export function panelStoreFor(sessionId: string): PanelStore;   // 模块级 Map 单例
export function usePanelState(sessionId: string): PanelView & { refresh: () => Promise<void>; act: (a: PanelAction) => Promise<ActResult> };
export function sessionIdOf(props: unknown): string;
```

- 单 timer：`snapshot` 里有 `running|gate|provisioning` 任务 → `activeMs=2000`；否则 `idleMs=5000`。
- `document.visibilityState === 'hidden'` 时暂停（面板在后台不烧请求），可见时立即 `refresh()` 一次。
- 最后一个 `subscribe` 解除 → `dispose()`（清 timer、从 Map 删）。
- `act()` 一律把返回的 `{data}` 里的 `snapshot` **直接写入本地 view**，不再额外 `refresh()`（省一次请求，也让"点了没反应"类问题无处藏身：本地 view 立刻变化）。
- 仍然是"唯一数据源在 dock 处"：面板只渲染 store，不持有独立开关状态。

**前端三条铁律（本项目历史高频 bug，dev 必守）**：① 所有 `panelApi.*` / `store.act` 调用必须在 import 列表里；② HTTP 返回必须解 `{data,error}`，禁止整包赋值；③ 组件模板里必须有真实绑定（`snapshot.tasks.map` 而不是只算了变量）。

---

## 8. 记忆与角色子系统

### 8.1 记忆写入带来源（AC-25"单任务新增≤20 行且带来源"）

```ts
// src/host/memory/repo.ts
export interface MemorySource { roleId: string; taskId: string; at: number }
export function formatSourcedLine(text: string, source: MemorySource): string;
// → `- [pm/t2 · 10-30 14:02] 结论正文`
export function appendMemoryLines(
  track: MemoryTrack, name: string, lines: string[], limit: number,
  roots: MemoryRoots, source?: MemorySource,
): Promise<{ ok: boolean; written: number; truncated: boolean }>;
```

- 未传 `source` 时（队长直写）前缀 `- [队长 · 时间]`。
- 超 `limit=20` 只写前 20 行并 `truncated:true`，`notices` 里明说"已截断为 20 行"。

### 8.2 注入预算与截断标注（AC-25）

```ts
// src/host/memory/inject.ts
export function selectMemory(
  goal: string, candidates: MemoryCandidate[], budget: number,
): { text: string; chars: number; truncated: boolean; omitted: number };
```

排序键（依次）：`track==='project'` 优先 → 文件名/首个 `#` 标题命中关键词 → 正文相关度 → 更新时间新者优先。超预算时保留高优先段落，末尾固定追加一行：

```
（记忆已截断：注入 3987/4000 字符，省略 12 行）
```

这行是 QA 可 grep 的硬证据，不能只体现在 UI chip 上。

### 8.3 路径逃逸（AC-24）

`safeMemoryName` 已覆盖 `..`/绝对路径/`\0`/点开头/超长。本轮必须补两处：`readMemory` 与 `deleteMemory` **也要**先过 `safeMemoryName`（现在只有 `writeMemory` 过），并且 `bridge.readMemoryFile` 在名字非法时返回 `{error:'非法文件名'}` 而不是抛异常。三条路径共用同一函数，单测各断言一次。

---

## 9. 关键实现点与边界（dev 逐条自查）

1. **AC-30 机械保证**：`auto_team_plan` 落盘并 push `kind:'plan'` 活动后，成员数必须仍为 0；`auto_team_dispatch` 必须显式带 `runId`。开关 `toggle:true` 只改 `sessions.json`，**绝不派发**（反目标 1）。
2. **AC-14 无匹配不硬塞**：`roles.get()` 返回 null 时任务保持 `pending` + activity 提示，绝不"随便挑一个角色"。
3. **AC-15 依赖未过门禁**：`readyTasks` 只认 `done`，`gate`/`rework` 都算未完成；下游保持 `blocked` 且不产生 binding。
4. **AC-16 同一成员续跑**：`message` 一律按 `task.memberId` → `bindings.name` → 宿主 `sendMessage(target=成员名)`；**成员数不得变化**（单测断言 `bindings.length` 不变）。
5. **AC-18 杀进程**：watcher 是唯一能发现"进程死了"的地方，`lastEventAt` 必须随每次 tick 更新，前端展示"最近事件时间"用它。
6. **AC-19 完成只能经门禁**：`applyReceipt` 是 `done` 的唯一入口；`auto_team_status` 与面板都不得提供"标记完成"。
7. **门禁命令的 cwd**：固定 `workspace`（`<ws>`），不是 `artifactsDir`；命令字符串原样执行（`shell:true`），不做白名单 —— 这是用户自己的验收命令，属于"用户授权执行"范畴，但**必须在 UI 上显示将执行的命令原文**（PlanTab 已有验收列）。
8. **原子写**：`store.save` 的 tmp+rename 保留；`sessions.json` 同理，避免半截 JSON。
9. **`ctx.effect` 清理**：watcher timer、gate 队列的在途子进程都要在卸载时停（`registerEffect`）。
10. **不许 `console.log`**：统一走 `ctx.logger`，只在 `adapters.ts` 里取 logger。
11. **时间戳一律 `number`（ms）**：`plannedAt`、`spawnedAt`、`lastEventAt`、`evidence.at` 同源，前端格式化在 `viewmodel.formatClock`。
12. **7 态与设计稿对齐**：`pending/blocked/ready/running/gate/done/rework/failed` + 成员侧 `interrupted/provisioning`，文案集中在 `viewmodel.statusBadge`，禁止组件内散落字符串。

---

## 10. 测试策略

### 10.1 单测（`node --test test/*.test.ts`，直跑 TS 源）

| 文件 | 覆盖 | 关键可分辨断言 |
|---|---|---|
| `test/graph.test.ts`（已有） | 环/未知依赖/ready/blocked | 保留 |
| `test/plan.test.ts`（已有） | buildPlan/指纹/进度 | 保留 |
| `test/store.test.ts`（新增） | `RunState` v2 写读、`wrapLegacy` 把裸 Plan 升到 v2、原子写不留 tmp | 断言 v1 输入 `wrapLegacy` 后 `version===2 && messages.length===0` |
| `test/dispatch.test.ts`（新增） | 并发切片、`ROLE_UNAVAILABLE` 不创建成员、`blocked` 未过门禁不派发、`resumeRun` 幂等、rework 下游仍 blocked | **幂等可分辨**：连调两次 `resumeRun`，第一次 `resumed>=1`，第二次 `resumed===0 && unchanged===true` 且 `bindings.length` 两次相等 |
| `test/gate.test.ts`（新增） | 假 `exec` 注入：成功/失败/超时/空验收/尾部裁剪/日志落盘 | 空验收 → `evidence.exitCode===-1 && ok===false`（不能反过来也算"通过"） |
| `test/memory.test.ts`（扩展） | 来源标注格式、20 行截断、`readMemory`/`deleteMemory` 逃逸拒绝、注入预算与"已截断"尾巴 | 断言产出文本 `includes('（记忆已截断')`，且 `chars<=4000` |
| `test/route.test.ts`（新增） | 预校验失败清单、`routeDrift` 正反例、`auditRoute` 写 `unverified` | declared≠actual → `verdict==='drift'`；actual 缺失 → `'unverified'`（不是 `'ok'`） |
| `test/adapters.test.ts`（扩展） | 新增 `GET memory` 路由（合法/逃逸 404 化）、`registerEffect`、成员名映射 | 假 req/res 断言 body 是 `{error:'非法文件名'}` 且未调 `readFile` |
| `test/wire.test.ts`（新增集成） | 假 `ctx`（tools/systemPrompt/webServer/agentTeams/llm/effect 全假）跑 `apply()`：7 工具注册、prompt section、3 条路由、假 spawn 走完 dispatch→receipt→下游 ready | 端到端主干单测，不依赖真宿主；断言 `agentTeams.spawnTeammate` 调用次数 = 2（3 任务 1 条依赖） |

`test/viewmodel.test.ts`（新增）：胶囊 5 种 tone 的文案、7 态徽标不重复、`formatModelRoute` 在 `unverified` 时带"未下发"。

### 10.2 手工/真机（交 QA，不写进单测）

- 真机 GUI 出现开关行与面板（client slot 渲染）；右栏页签可打开。
- 真成员 spawn → 执行 → `sendMessage` 续跑不新增成员。
- `kill <member pid>` 后 ≤5s 面板变 `interrupted`。
- 逐角色模型：能被 `resolveCallConfig` 拒绝的 provider 必须**拒绝派发**（AC-22 可验的一半）。

原则：**"变异可分辨"**——把实现改回旧逻辑（如 watcher 不跑、门禁不跑），对应断言必须变红；否则该断言不承载信息。

---

## 11. 任务拆分（并行文件边界）

契约层（T1）先落，T2–T5/T7/T8 并行，T6 装配收口，T9 自检收尾。

| ID | 任务 | files（拥有） | reads | 依赖 |
|---|---|---|---|---|
| T1 | 契约与常量：`MessageRecord/MemberBinding/RouteAudit/RunState`、`PanelAction/ActResult/RejectionCode`、`PanelSnapshot` 扩展、`ActivityEvent.kind` 扩展；抽 `shared/const.ts` | `src/shared/types.ts`、`src/shared/const.ts`、`src/host/config.ts` | — | — |
| T2 | 存储层：`RunState` v2 + `wrapLegacy` + `RunsStore` 新签名 | `src/host/store.ts` | T1 类型 | T1 |
| T3 | 编排核心：`dispatchReady/memberNameFor/resumeRun/applyReceipt`、`preflightRoutes/auditRoute`、`watcher.ts`、`messages.ts`、`gate.ts` 异步化、`adapters.ts` 新增 5 封装 | `src/host/team/dispatch.ts`、`src/host/team/route.ts`、`src/host/team/watcher.ts`、`src/host/team/messages.ts`、`src/host/gate/gate.ts`、`src/host/adapters.ts` | T1、T2 | T1,T2 |
| T4 | 接口与动作：`bridge` 接 `act`（11 动作 + 拒绝码）、`receipt` → 门禁队列、`tools` 加 `auto_team_receipt`、`http` 加 `GET memory` | `src/host/bridge.ts`、`src/host/tools.ts`、`src/host/http.ts` | T1、T2、T3 | T1,T2,T3 |
| T5 | 记忆与角色：来源标注、注入排序与截断尾行、`read/delete` 逃逸校验、角色校验 | `src/host/memory/repo.ts`、`src/host/memory/inject.ts`、`src/host/roles/repo.ts` | T1 | T1 |
| T6 | 宿主装配：`index.ts` 接线（bridge.dispatch → dispatchReady、watcher.start、`ctx.effect` 清理）、`prompt.ts` 补计划/门禁工作方式 | `src/host/index.ts`、`src/host/prompt.ts` | T2–T5 | T2–T5 |
| T7 | 前端状态：`state.ts` 单例 store + `useSyncExternalStore`、`api.readMemory` | `src/client/state.ts`、`src/client/api.ts` | T1 | T1 |
| T8 | 前端视图：`viewmodel.ts`、`Toggle/Panel/四页签/styles/index`（`PLUGIN_ID` 换源、回执按钮、消息账本、记忆读正文、角色删除确认） | `src/client/viewmodel.ts`、`src/client/index.ts`、`src/client/Toggle.tsx`、`src/client/Panel.tsx`、`src/client/tabs/*.tsx`、`src/client/styles.ts` | T1、T7 | T1,T7 |
| T9 | 交付自检：跑 §15 全部命令、修发现的问题、`git status` 核 `lib/` 已重建、单一提交 | 全部（收尾可用） | 全部 | T1–T8 |

并行性：T2/T5/T7 文件互不相交；T3 与 T4 有先后（bridge 调 dispatch）；T8 与 T3/T4/T5 文件不相交，可同跑。**T3 独占 `adapters.ts`**（watcher 需要 `listMembers`），T4 只读它——避免两个任务同改宿主适配层。

Git 约束随 T9 一起落（PRD §10.1）：全程在 `feat/auto-team-plugin`，不切分支、不 stash；功能 + 文档一次提交，message `feat(auto-team): ...`；提交后不再改文件。

---

## 12. 边界与异常总表

| 场景 | 行为 |
|---|---|
| 开关关闭时调任何工具/动作 | 工具返回 `NOT_ENABLED_MESSAGE`；`act` 返回 `rejected.code='NOT_ENABLED'`，快照仍可读（面板能显示"去打开开关"） |
| 开关打开但无计划 | `act:dispatch` → `NO_PLAN`，不创建成员 |
| 计划已派发后再点派发 | `PLAN_ALREADY_DISPATCHED`（幂等，不重复起人） |
| 角色被删但任务引用它 | `ROLE_UNAVAILABLE`，任务留 `pending`，面板标红，不派发 |
| 角色模型不可用 | `MODEL_UNRESOLVABLE`，**不降级** |
| 成员在门禁中死了 | watcher 标 `interrupted`，`gate` 任务保留证据，可从 members 页「继续」 |
| 门禁命令超时（>300s） | `exitCode=null`、`ok=false`、证据 tail 记 "timeout after 300000ms" |
| 记忆名含 `..`/`/`/`\0` | `{error:'非法文件名'}`，不读不写不删 |
| 注入超 4000 字符 | 截断 + 尾行标注 + `snapshot.memory.truncated=true` |
| 宿主重启（binding 内存丢失） | 按成员名重绑；找不到 → `interrupted`，不新建 |
| 无 caller（工具被非会话上下文调用） | `NO_CALLER`，绝不伪造 Agent |

---

## 13. AC → 实现落点（26 条）

| AC | 落点 | 验证 |
|---|---|---|
| AC-1 | `cordis.patch.yml`（`insert` + `name: dsh-auto-team`，不改） | `npm pack` 含该文件；grep `name: 'dsh-auto-team'` |
| AC-2 | `package.json` `dsh.client`（不改） | 与样本逐字段比对（QA 脚本） |
| AC-3 | `src/client/index.ts` 两处 `slots.inject/register` | grep 两个 slot 名一致；真机出现 |
| AC-4 | `package.json` `files`（不改） | `npm pack --dry-run` |
| AC-5 | `package.json` 无 `workspace:` | grep |
| AC-6 | `@deepseek-ai/*` 仅 peer | grep `peerDependencies` |
| AC-7 | `pnpm build` 产物晚于源码 | `ls -l lib/` mtime |
| AC-8 | 两产物顶层 import 退出码 0 | `node -e "await import(...)"` |
| AC-9 | `README.md` 安装段 + 主 agent 装入 desktop profile 并登记 `dsh.profile.bundles` | 重启后宿主日志出现插件行 |
| AC-10 | `README.md` 回滚段（装前先给 `pnpm remove` + 摘 bundles） | 失败即回滚并 `npm ls` 确认摘除 |
| AC-11 | 本节 §15 三步命令（构建自检 → 装入 → 重启看 GUI） | 不得以人工补测替代 |
| AC-12 | `bridge.enabled/setEnabled` + `sessions.json`；`tools` 的 `NOT_ENABLED_MESSAGE` | 单测：关开关后 7 工具全返回该文案；`act:toggle` 落盘 |
| AC-13 | `plan/graph.ts` `validateGraph` + `buildPlan` | 已有单测（成环/未知依赖/≥3 任务） |
| AC-14 | `dispatchReady` 步 a + `act:setTaskRole` + `PlanTab` 角色下拉 | 单测：角色缺失 → 无 binding；替换后按新 roleId 派发 |
| AC-15 | `dispatchReady` 步 3/4 + `graph.readyTasks` | 单测：并发 ≤ limit；未过门禁的下游 `blocked` 且无 binding |
| AC-16 | `messages.ts` + `sendMessage(target=名字)` + MembersTab 账本 | 单测：`bindings.length` 不变、`messages` 含 from/to/taskId/at |
| AC-17 | `resumeRun` 幂等规则 + `bindings` 重绑 | 单测：两次 resume 第二次 `resumed=0/unchanged` |
| AC-18 | `watcher.ts` + 快照 `lastEventAt` + 前端 2s/5s 轮询 | 真机：kill 成员 ≤5s → `interrupted`；单测：`reconcileMembers` 四态映射 |
| AC-19 | `gate.ts`（异步）+ `act:receipt` + `applyReceipt` + `auto_team_receipt` | 单测：门禁失败 → `rework` + 下游 `blocked` + 证据进 `messages` |
| AC-20 | `roles/builtin.ts` `composeSkillPrompt`（已有 6 角色） | 单测：成员 prompt 含技能正文特征句；`missing` 为空 |
| AC-21 | `roles/repo.ts` + `act:saveRole/deleteRole` + RolesTab 确认 | 单测：落盘后重启（新 repo 实例）可读；UI 删除有确认 |
| AC-22 | `preflightRoutes` + `auditRoute` + 面板模型位 | 单测：不可用 → 拒绝派发；`routeDrift` → `failed`。**限制 L1** |
| AC-23 | `paths.ts` 双轨 + `memory/repo.write` | 单测：两轨落点分别为 `~/.dsh/auto-team/memory/public` 与 `<ws>/.auto-team/memory` |
| AC-24 | `GET memory` + `act:saveMemory/deleteMemory` + MemoryTab 读正文 | 单测逃逸拒绝；UI 删除确认；磁盘逐字比对 |
| AC-25 | `selectMemory` 预算 + 截断尾行 + `appendMemoryLines` 来源与 20 行 | 单测：`chars<=4000`、尾行存在、单任务 ≤20 行且带 `[role/task · 时间]` |
| AC-30 | `plannedAt` + `kind:'plan'` 活动 + `auto_team_dispatch` 必带 `runId` | 单测：`plannedAt < bindings[0].spawnedAt`；派发前 `members.length===0` |

---

## 14. 已知限制与风险

| ID | 限制 | 影响 | 处理 |
|---|---|---|---|
| L1 | 宿主 `SpawnTeammateRequest` 只有 `provider`，**没有 `model`** | AC-22"逐角色模型生效且可核验"只能做到：预校验拒绝 + 声明值展示 + 漂移检出；真正下发需宿主补字段 | 面板明确标"未下发"；交付说明如实写；不静默回退队长模型 |
| L2 | `agent/created` 事件 payload 未在本机实测到 `model` 字段 | `auditRoute` 大概率落 `unverified` | 适配层只透传不伪造；有字段才比对 |
| L3 | 门禁命令以 `shell:true` 在宿主进程内执行 | 用户命令拥有宿主权限 | UI 显示命令原文；只执行用户自己写的 `acceptance`；不提供默认命令 |
| L4 | `spawn` 串行等待 `draw`（每个成员一次异步） | 并发上限实际受宿主响应速度影响 | 派发循环用 `for..of await`；`errors` 不中断其余任务 |
| L5 | 真机 GUI 渲染未验证（`Slots.listSubTree` inspect 曾 `timed out after 10000ms`） | 面板是否出现需装机确认 | 列入 QA 手工项；不写成"已验证" |
| L6 | 无前端 DOM 测试栈 | 交互回归靠 QA 真机 | 抽 `viewmodel.ts` 覆盖文案与状态映射 |

---

## 15. 验证脚本（提交前必须全绿）

```bash
pnpm typecheck
node --test test/*.test.ts
pnpm build
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis\.patch\.yml'
# 结构守卫
! grep -rn "from '\.\./host/" src/client          # host/client 零直接 import（修 D6）
! grep -rn 'font-size: var(--dsw-font' src/client  # 字号必须 font 简写
grep -c "auto_team_" src/host/tools.ts             # 7 个工具名
```

真机三步（AC-9~AC-11，由主 agent 执行）：

```bash
# 1) 重建并自检
cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team && pnpm build
# 2) 装入 desktop profile
cd ~/.dsh/profiles/desktop && pnpm add file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
# 3) 登记 bundles 后重启宿主，刷新 GUI 检查输入框下方开关行
# 回滚：cd ~/.dsh/profiles/desktop && pnpm remove dsh-auto-team  （并从 dsh.profile.bundles 摘除）
```
