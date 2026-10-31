# TECHNICAL — r4 第一期：直通投递 + 成员停滞检测

> 基线依赖：`docs/teamflow/20261031-r3-collision-name-suffix/`（撞名消歧，HEAD `2aff075`）。
> 本文件是 PRD（16 条 AC）与 DESIGN（视觉/删除项）在现有仓库上的落地技术方案，**冻结接口签名**；下游开发必须逐字使用本文件 §4 的函数名/参数/返回，不得自行改名。
> 分支沿用 `feat/auto-team-plugin`，不切分支、不打 tag。

---

## 1. 架构判断（三条，决定了后面所有取舍）

1. **直通投递要落在「纯函数 + 一个发送点」，而不是新开一条消息通路。** `applyReceipt`（`src/host/team/dispatch.ts`）是 `done` 的唯一写点且是**同步纯函数**；peer 消息必须在那里生成（可单测、可幂等），而真正的 `sendMessage` 只能在 `bridge.act('receipt')` 里发生（那里才握有 `deps.sendMessage`，`src/host/bridge.ts:116`）。若把 body 拼装放到 bridge，就会和「创建时注入」那条路径各拼一套，出现两份措辞不同的交接文案——这正是本项目历史缺陷族。
2. **停滞是「第二层信号」，不能动 `task.status`。** `task.status` 直接驱动派发/解锁/恢复（`plan/graph.ts` 的 `readyTasks`、`resumeRun` 只挑 `running|gate|interrupted`）。所以停滞只写两个新落盘字段（`progress`、`stallAlerts`），`plan.tasks` 一个字节都不动（AC-13 用深比较机械证明）。
3. **告警单出口是结构保证：事件只 `touchProgress`，判定只在 `watcher.tick()`。** 由于 `PanelSnapshot.activity` 是由 `bridge.activityOf()` 从落盘状态**派生**的（没有活动日志表），「一次 episode 恰好一条事件」必须落盘一个 `stallAlerts` 数组（`kind:'tool'`），否则同一 episode 每 1500ms 就会重算出一条新事件，AC-8 必红。

---

## 2. AC-7 前置实验：已验证 / 未验证两清单

本次（tech 阶段）实际执行的取证命令：`cordis_inspect_query(platform=host, provider=Event, method=listEvents)`（目录级），返回 76 条事件契约。

### 2.1 已验证（有实跑返回原文支撑）

| # | 结论 | 证据（原文） |
|---|---|---|
| V1 | 事件 `tools/execute` 存在，waterfall | `'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>` |
| V2 | 事件 `tools/result` 存在，**emit**（无控制流，监听器写错也毁不了工具执行） | `'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined` |
| V3 | 事件 `agent/status` 存在，emit，**payload 明确带 `agent`** | `'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void` |
| V4 | 事件 `agent/disposed` 存在，emit | `'agent/disposed'(this: Scoped<Agent>, payload: { agent: Agent }): void` |
| V5 | 订阅形态是 `ctx.on(event, listener)`，profile 级插件可用 | `src/host/adapters.ts:70` 声明 `on?: (event: string, listener: (...args: unknown[]) => void) => (() => void) | void`；已在 `:530`（`'agent/created'`）与 `:741` 实际订阅 |
| V6 | 「agent → 成员」的解析函数已存在，无需新写 | `src/host/adapters.ts:699` `export function memberIdentityOf(ctx: HostContext, agent: unknown): { id: string; name: string }`（内部走 `agentTeams.tryMembership`） |

**结论（据此定契约）**：主订阅 `tools/result`（emit，安全）+ 辅助订阅 `agent/status`（emit，带 agent 对象）；**不订阅 `tools/execute`/`tools/pre-execute`/`tools/post-execute`（waterfall）**——瀑布流监听器必须 `return next()`，一旦我们抛错或漏调 `next()` 会把宿主的工具执行熔断，风险与收益完全不对称。

### 2.2 未验证（**不许推断，由 T0 实测后才可写死**）

| # | 未知项 | 为什么必须实测 | T0 判据 |
|---|---|---|---|
| U1 | `ToolExecution` / `ToolDispatchExecution` 的字段体（是否含 `agent` / `agentId` / `sessionId`） | `listEvents` 只给类型名不给类型体；本次补查类型体被工具输入校验拒绝（原文：`Error: Host Cordis inspect Event.listEvents rejected input: "input" must be an object`），故按未验证处理 | 探针里 `console.log(Object.keys(exec))` + `JSON.stringify(exec).slice(0,500)` 实跑一行 |
| U2 | 成员（`spawnTeammate` 起的子 Agent）的工具调用是否会到达 profile 级 `tools/result` 监听器 | 签名带 `this: Scoped<ToolRuntime>`，作用域可能在 dispatch 所属 scope 内广播 | 起 1 个真成员让它调 1 次工具，看监听器是否收到且能解析到该成员 |
| U3 | 成员自身是否 emit `agent/status` | 若成员跑在独立 agent 上应当会，但未实测 | 同一探针记录 `agent/status` 次数与 `payload.agent.id` |
| U4 | `ctx.on` 返回的 disposer 是否可用于 `registerEffect` 清理 | 现有代码调用后忽略返回值 | 探针里打印返回值类型；不可用则忽略（宿主退出时随插件卸载） |

### 2.3 三级降级方案（T0 结论决定走哪一级，**接口不变**）

| 级别 | 触发条件 | 主信号 | AC-9 可分辨性为何仍成立 |
|---|---|---|---|
| L1（首选） | U2 成立 | `tools/result` → `touchProgress` | 假成员从不调工具 → 0 次推进；对照成员每轮调工具 → 推进密集 |
| L2 | U2 不成立、U3 成立 | `agent/status`（`running`/`idle` 翻转） | 假成员 `running` 恒定不翻转；对照成员每轮结束都翻转 |
| L3（兜底） | 事件都到不了插件监听器 | 在既有 `watcher.tick()`（1500ms）里复用 `listMembers()`，按成员 `HostMember.status` 变化推进 `lastProgressAt` | 假成员 `status` 恒定 → 0 次变化；对照成员反复 running/idle |

三级共用 `stall.stallOf` 与 `ticks` 单出口，**AC-8/AC-12/AC-13 在三级下都成立**；L3 不新增 `setInterval`（AC-11 预算不破）。T0 必须把选定级别与实跑输出写进 `logs/teamflow/<runId>/notes/ac7-event-probe.md`，并在 T6 自查时把该级别抄进最终交付说明。

---

## 3. 数据模型与落盘

### 3.1 `src/shared/types.ts`（纯类型，host/client 共享）

```ts
/** 成员的「实质推进」记录（停滞检测的唯一事实来源）。key = memberId。 */
export interface ProgressRecord {
  /** 最近一次实质推进的墙钟时间（工具调用完成 / L3 的状态变化）。 */
  at: number
  /** 本次 episode 已告警的时间；undefined = 当前 episode 尚未告警（幂等键）。 */
  alertedAt?: number
}

export interface MemberView {
  // …既有字段不动
  /** 是否处于停滞（仅当成员运行中才可能为 true）。宿主判定，客户端零阈值比较。 */
  stalled: boolean
  /** 已停滞毫秒数（未停滞恒 0）。 */
  stalledForMs: number
  /** 由宿主格式化的秒数文案：<600s 为「N 秒」，≥600s 为「M 分 S 秒」；未停滞为 ''。 */
  stalledSecondsText: string
}
```

> 为什么比 DESIGN 多一个 `stalledSecondsText`：避免「宿主一套格式化 + 客户端再写一套格式化」——两份秒数格式必然分叉（本项目已有同族事故）。客户端只渲染，不再算。

### 3.2 `src/host/store.ts`（`RunState` v2 扩展，**不升版**）

```ts
export const STALL_ALERTS_LIMIT = 50

export interface RunState {
  version: typeof RUN_STATE_VERSION   // 仍为 2：新增字段皆为可选，v2 文件向后兼容
  plan: Plan
  plannedAt: number
  messages: MessageRecord[]
  bindings: MemberBinding[]
  routeAudits: RouteAudit[]
  /** 成员推进记录（key = memberId）。缺省 = 无记录，基线回落到 binding.spawnedAt。 */
  progress?: Record<string, ProgressRecord>
  /** 停滞告警（kind 恒为 'tool'），由 watcher.tick 追加，bridge.activityOf 只读合并。 */
  stallAlerts?: ActivityEvent[]
}
```

- `wrapLegacy`：新增 `normalizeProgress()`（只留 `at` 为有限数字的键，`alertedAt` 非法则删）与 `normalizeStallAlerts()`（只留 `kind==='tool'` 且 `at` 有效的条目，截断至 `STALL_ALERTS_LIMIT`）。
- `save()`：落盘前把 `progress` **裁剪到当前 live bindings 的 memberId 集合**（成员死亡后不无限增长），`stallAlerts` 截尾至上限。
- **幂等键**：peer 交接消息用既有 `MessageRecord.messageId` 字段，值恒为 `handoff:<上游 taskId>-><下游 taskId>`；停滞告警不产生 message，只产生一条 `stallAlerts` 条目。

---

## 4. 接口契约（冻结，下游逐字使用）

### 4.1 `src/host/config.ts`

```ts
/** 停滞判定阈值（AC-13：全仓唯一定义处，其它模块只 receive 参数）。 */
export const STALL_MS = 90_000
```

### 4.2 `src/host/team/stall.ts`（**新文件，纯逻辑**：只允许 import `../shared/types.ts`）

```ts
export function stallOf(
  progressAt: number | undefined,
  baseline: number,
  now: number,
  stallMs: number,
): { stalled: boolean; stalledForMs: number }

export function touchProgress(
  progress: Record<string, ProgressRecord> | undefined,
  memberId: string,
  at: number,
): Record<string, ProgressRecord>

/** 恢复（不再停滞）时清掉 episode 标记，使下一次停滞能重新告警一次。 */
export function clearAlerted(
  progress: Record<string, ProgressRecord> | undefined,
  memberId: string,
): Record<string, ProgressRecord>

/** 「92 秒」/「3 分 5 秒」。AC-14 的秒数文案唯一来源。 */
export function secondsText(ms: number): string

/** 落进 stallAlerts 的整句文案（含秒数），例：「t1-worker 已 92 秒无实质工具调用，疑似停滞」。 */
export function stallSentence(name: string, ms: number): string
```

### 4.3 `src/host/team/handoff.ts`（**新文件，纯逻辑**）

```ts
export const HANDOFF_TAIL_CHARS = 800

export function handoffId(upstreamTaskId: string, downstreamTaskId: string): string  // → `handoff:<a>-><b>`

/** 上游交付正文：id+title / 命令 / 退出码 / ≤800 字证据尾部 / 产物路径（空则显式「无落盘产物」）。 */
export function handoffBody(upstream: PlanTask, evidence: GateEvidence): string

/** AC-1/AC-5：只有 (done 且 exitCode===0) 才产出；同 id 已存在则 0 条。 */
export function handoffMessages(input: {
  upstream: PlanTask
  evidence: GateEvidence | undefined
  upstreamVerdict: 'done' | 'rework' | 'failed'
  downstream: PlanTask[]
  at: number
  existingIds: readonly string[]
  targetOf: (downstreamTaskId: string) => { to: string; toMemberId?: string }
}): MessageRecord[]

/** AC-4(b)：给某下游注入的上游交接正文（按 messageId 前缀 + taskId 过滤，保持时间正序）。 */
export function handoffBodiesFor(messages: readonly MessageRecord[], downstreamTaskId: string): string[]
```

`handoffBody` 的逐字骨架（QA 探针按此断言）：

```text
【上游直投】<id> <title> 已通过门禁
命令：<command>
退出码：<exitCode>
证据尾部（≤800 字）：
<tail 末 800 字>
产物：<artifacts 逐行> | 无落盘产物
```

### 4.4 `src/host/team/dispatch.ts`

```ts
export interface PromptInput {
  plan: Plan
  task: PlanTask
  role: Role | undefined
  name: string
  /** AC-4(b)：上游交接正文，未创建的下游成员在首条提示词里读到它。 */
  handoffs?: string[]
}
export interface SpawnInput extends PromptInput { prompt: string }
```

- `applyReceipt()`：在既有 done 分支（`patchTask(done) + 解锁 blocked→pending + 终态判定`）之后新增一段——`verdict==='done' && evidence?.exitCode === 0` 时调用 `handoffMessages(...)`，`existingIds` 取 `state.messages` 里所有 `messageId`，`targetOf` 用 `liveBinding(state, depId)`（未退役且有 `name` → `{to: binding.name, toMemberId: binding.memberId}`；否则 `{to: 'task:' + depId}`），把返回的 peer 消息 `append` 到 `messages`。**不新增任何 `from:'captain'` 消息**（AC-3）。
- `dispatchReady()`：调用 `deps.buildPrompt()` 时补 `handoffs: handoffBodiesFor(state.messages, task.id)`。

### 4.5 `src/host/team/member-prompt.ts`

```ts
// MemberPromptDeps 不变；内容读取 input.handoffs
// 在「## 本次任务」之后、「## 验收判定」之前插入（仅当 handoffs 非空）：
//   '## 上游交接', '以下内容由上游任务的门禁证据直接投递，不需要再问队长：', ...handoffs, ''
```

### 4.6 `src/host/team/watcher.ts`

```ts
export interface WatcherDeps {
  store: RunsStore
  listMembers: () => Promise<HostMember[]>
  now?: () => number
  intervalMs?: number
  /** 停滞阈值；缺省 STALL_MS。 */
  stallMs?: number
  onReconciled?: (state: RunState) => void
}

/**
 * 一次 episode 恰好一条告警（纯函数，便于单测）：
 * - 只对 task.status==='running' 且存在 live binding 的成员判定；
 * - baseline = progress[memberId]?.at ?? binding.spawnedAt；
 * - stalled 且 alertedAt 缺失 → 追加 1 条 ActivityEvent{kind:'tool', memberId, taskId, at, text: stallSentence(name, stalledForMs)} 并写 alertedAt；
 * - 不再 stalled → 清 alertedAt（clearAlerted），下次可再告警；
 * - 返回的 state 里 plan.tasks 与入参**深相等**（AC-13）。
 */
export function stallAlertsOf(
  state: RunState,
  now: number,
  stallMs: number,
): { state: RunState; raised: ActivityEvent[] }
```

`tick()` 内部顺序固定：`reconcileMembers(...)` → `stallAlertsOf(...)` → 两者任一 `changed` 才 `store.save()`。**整个仓库不新增 `setInterval`**（AC-11）。

### 4.7 `src/host/adapters.ts`（宿主形状唯一的落点，AGENTS §4）

```ts
/** 从工具事件 payload 里尽力取一个 agent 对象；取不到返回 undefined（不猜字段）。 */
export function agentOfToolEvent(payload: unknown): unknown

/**
 * 订阅成员推进信号并回调（V1~V6 的落点）。
 * L1：ctx.on('tools/result', …) ；L2：ctx.on('agent/status', …)；两者都注册，同一 handler，去重交给 touchProgress。
 * 宿主未提供 ctx.on 时 warn 并返回 { stop() {} }（不得抛错）。
 */
export function onMemberProgress(
  ctx: HostContext,
  handler: (info: { agent: unknown; at: number }) => void,
): { stop: () => void }
```

### 4.8 `src/host/bridge.ts`

```ts
export interface BridgeDeps { /* 既有字段不动 */ stallMs?: number }

// membersOf(state, roles): MemberView[]  —— 现存两处构造点（v2 分支 + v1 裸 Plan 兜底分支）都要补：
//   const baseline = state.progress?.[memberId]?.at ?? binding.spawnedAt
//   const judge = member.status === 'running' ? stallOf(state.progress?.[memberId]?.at, baseline, now(), stallMs) : { stalled: false, stalledForMs: 0 }
//   stalled = judge.stalled, stalledForMs = judge.stalledForMs, stalledSecondsText = stalled ? secondsText(judge.stalledForMs) : ''

// activityOf(state): ActivityEvent[]  —— 合并 state.stallAlerts ?? [] 后再 sort+slice(ACTIVITY_LIMIT)

// act() case 'receipt' 末尾（saveState 之后）：从 next.messages 中挑出 messageId 以 'handoff:' 开头、
// 且 toMemberId 有值、且本条是本次新增（用回执前的 messageId 集合做差）的条目，
// for (const m of added) await deps.sendMessage(m.toMemberId!, m.body) —— try/catch，失败只 push notice，
// 绝不为这次发送补一条 captain 账本消息（AC-3）。
```

### 4.9 `src/host/index.ts`（唯一装配点）

```ts
// 1) 事件 → 推进：在 bridge 装配后、watcher.start 前
const progressSub = onMemberProgress(ctx, ({ agent, at }) => {
  const identity = agent === undefined ? undefined : tryMemberIdentity(ctx, agent)  // adapters.memberIdentityOf
  if (!identity) return
  for (const summary of store.list()) {
    const state = store.load(summary.runId)
    if (!state) continue
    const hit = state.bindings.find((b) => !b.retired && (b.memberId === identity.id || b.name === identity.name))
    if (!hit) continue
    store.save({ ...state, progress: touchProgress(state.progress, hit.memberId, at) })
  }
})
registerEffect(ctx, () => progressSub.stop())

// 2) watcher 传阈值（缺省亦可用）
createMemberWatcher({ store, listMembers, now, stallMs: STALL_MS }).start()

// 3) bridge 传阈值
createBridge({ /* … */ stallMs: STALL_MS })
```

### 4.10 HTTP / 动作层：**零新增**

- 读：`GET /api/auto-team`（既有 `PanelSnapshot`）自动带出 `members[].stalled / stalledForMs / stalledSecondsText`。
- 写：`POST /api/auto-team` 的 11 个 `PanelAction` **不新增**；不新增 `ActivityEvent.kind`；不新增 `BADGES` 项。

---

## 5. 前端结构与状态管理

### 5.1 组件划分

| 文件 | 责任 | 本轮改动 |
|---|---|---|
| `src/client/tabs/MembersTab.tsx` | 成员行 + 账本渲染 | 删 15s 启发式；新增停滞条；账本行改「行头 + 整行正文」；peer 来源显示「上游直投」 |
| `src/client/viewmodel.ts` | 纯展示函数 | 新增 `STALL_SUFFIX = '无实质工具调用，疑似停滞'`、`stalledRowOf(member): { show: boolean; secondsText: string; text: string }`、`ledgerBodyFoldable(body): boolean`；新增 `peerLabelOf(from): string`（`peer` → `上游直投`，其余原值） |
| `src/client/styles.ts` | 全部样式 | 删 `[data-member-stale-hint]` 规则块（:349-353）；新增停滞条规则；`[data-message]` 由 4 列 grid 改 flex 换行 |

### 5.2 DOM 锚点（逐字，QA 按此断言）

| 选择器 | 出现条件 | 说明 |
|---|---|---|
| `[data-auto-team-member][data-stalled]` | **每一行都要有**，值 `"true"|"false"` | 替换原 `data-stale` |
| `[data-member-stall]` | `member.status === 'running' && member.stalled === true` | 停滞条本体，`role="status"`，`data-stalled-for={ms}` |
| `[data-stall-seconds]` | 同上 | 只含 `member.stalledSecondsText`（如 `92 秒`） |
| `[data-message][data-from="peer"]` | peer 交接消息 | 来源文本显示「上游直投」，`data-from` 仍为原值 `peer` |
| `[data-message-toggle]` | `body.length > 120` 或 `body` 含 >3 行 | `aria-expanded` + `[data-message-expanded]` 容器 |
| `[data-member-stale-hint]` | **永不出现**（已删） | AC-12 的机械判据 |

停滞条文案：`⏳ <span data-stall-seconds>{stalledSecondsText}</span> {STALL_SUFFIX}`，整行文本含秒数且与 `interrupted` 文案不相等（AC-14）。

### 5.3 状态管理

- 无新增客户端状态机：`stalled` 完全由宿主的 2000ms 轮询快照驱动（`PANEL_POLL_MS = PANEL_ACTIVE_MS = 2000`），客户端**零阈值比较**（无 `Date.now() - lastEventAt > X`）。
- 折叠态是唯一本地 UI 状态：`useState<Record<string, boolean>>`，键为 `messageId ?? at-index`，默认折叠。
- `data-stalled` 与停滞条必须同源（同一个 `member.stalled`），不得一处用 `stalledForMs > 0` 判断。

---

## 6. 关键实现点与边界（开发逐条对照）

1. **幂等三处**：`handoffId`（消息级）、`alertedAt`（episode 级）、`progress` 按 memberId 覆盖写。`applyReceipt` 重复调用、`resume` 重复执行都不得新增 peer 消息（AC-5）。
2. **不要在 `applyReceipt` 里做 IO**：它是纯函数，被 `dispatchReady`/`resumeRun`/`bridge.act` 三处调用；任何 `sendMessage` 混进去都会让重放路径发两遍消息。
3. **peer 消息的 `to`**：下游已有未退役 binding 时取 `binding.name`（与既有 captain 消息口径一致），否则 `task:<id>`；`toMemberId` 仅在已存在成员时填。
4. **AC-1 触发口径**：`verdict !== 'done'` 或 `evidence === undefined` 或 `evidence.exitCode !== 0` → 0 条。`exitCode: null`（超时/被信号杀）**不是 0**，必须 0 条。
5. **AC-2 尾部截断**：`evidence.tail` 取**末** `HANDOFF_TAIL_CHARS = 800` 字符（不是首 800），并保持单行前缀 `证据尾部（≤800 字）：`。
6. **AC-4(a) 逐字一致**：实发 body 与账本 body 必须是同一个字符串变量，不得二次拼装（探针用 `===` 断言）。
7. **AC-4(b) 注入时机**：`dispatchReady` 是成员创建的唯一入口，注入只能发生在其 `buildPrompt` 调用上；`resumeRun` 不注入（避免续聊上下文里重复堆叠同一段）。
8. **L3 兜底不加定时器**：需要「成员 status 变化」时，在既有 `tick()` 里比较 `listMembers()` 返回的 `status` 与上一轮快照（放在 `progress` 里，键后缀 `:status` 会污染 memberId 语义——因此改为在 `HOST_MEMBER_STATUS_KEY` 前缀下另存，见 T2 spec），**禁止 `setInterval`**。
9. **停滞不改状态**：`stallAlertsOf` 只允许改 `progress` 与 `stallAlerts`；`plan.tasks`/`bindings`/`messages` 不动（AC-13 深比较）。
10. **恢复即清标记**：成员重新调工具（`touchProgress` 使 `at` 前进）→ 下一 tick `stalled=false` → `clearAlerted`，面板回正常态；同一 episode 内不重复告警。
11. **`member-prompt` 的段落顺序**：交接段在「本次任务」之后、「验收判定」之前；`lines.filter(l => l !== '')` 的既有契约不变。
12. **删除要彻底**：`STALE_MS`、`data-stale`、`[data-member-stale-hint]`、「成员进程可能已退出」文案、`styles.ts:349-353` 规则块，全仓 grep 必须 0 命中（保留 `data-member-last-event`）。
13. **`lib/` 必须入库**：改完 `pnpm build` 后 `git add lib/`；`.gitignore` 复核不得忽略 `lib/`、`cordis.patch.yml`、`docs/`。

---

## 7. 测试策略

### 7.1 单测（`node --test test/*.test.ts`，基线 164 例全绿）

| 文件 | 新增/扩展 | 覆盖 AC | 最少新增 |
|---|---|---|---|
| `test/handoff.test.ts`（新） | 纯函数 | AC-1、AC-2、AC-5（幂等 key）、AC-6（不产出 captain 消息） | 6 |
| `test/stall.test.ts`（新） | 纯函数 + `stallAlertsOf` | AC-8（一次 episode 一条）、AC-9（假/对照）、AC-13（tasks 深相等）、AC-14（秒数文案） | 6 |
| `test/dispatch.test.ts`（扩展） | `applyReceipt` peer 分支、`PromptInput.handoffs` | AC-1、AC-2、AC-3、AC-4(b)、AC-5、AC-6 | 4 |
| `test/member-prompt.test.ts`（扩展） | 交接段渲染 | AC-4(b) | 2 |
| `test/store.test.ts`（扩展） | `progress`/`stallAlerts` 规范化与裁剪 | AC-13、落盘健壮性 | 2 |
| `test/viewmodel.test.ts`（扩展） | `stalledRowOf`、`peerLabelOf` | AC-12、AC-14 | 2 |
| `test/bridge.test.ts`（扩展） | `membersOf` 三字段、`activityOf` 合并、receipt 后实发 | AC-3、AC-4(a)、AC-8 | 3 |

合计新增 ≥25，总数 ≥189（AC-15 下限 172，留余量）。

### 7.2 探针（`logs/teamflow/<runId>/scripts/`，与单测互补：走真实落盘 + 真实快照）

- `qa-peer-probe.mjs`（≥4 项）：P1 触发口径四态（done/0 → 1 条；rework、failed、exitCode≠0 → 0 条）；P2 body 五要素逐条 grep + 800 字边界；P3 投递前后 `from==='captain'` 条数不变；P4 双下游 fanout = 2 + 重复 `applyReceipt` 不新增。
- `qa-stall-probe.mjs`（≥4 项）：S1 同一次测试内假成员 `stalled=true` 且 `stallAlerts` 恰好 1 条 vs 对照组 `stalled=false` 且 0 条；S2 连续 5 次 `tick()` 后仍为 1 条；S3 停滞文案含秒数且 ≠ interrupted 文案；S4 `grep -c setInterval` 与基线相同、`WATCHER_INTERVAL_MS===1500`、`PANEL_ACTIVE_MS===2000`、`STALL_MS` 全仓 1 处。
- 若同名探针已存在于 `logs/teamflow/tf-mvwnm3d9-l8db12/scripts/`，**原地扩展**，不重建。

### 7.3 变异自检（AC-10，红/绿两段实跑输出都要贴进 QA-REPORT）

1. 绿：正常运行 `node logs/teamflow/<runId>/scripts/qa-stall-probe.mjs` → `PASS [S1]`。
2. 红：把 `index.ts` 的 `touchProgress(...)` 调用临时删掉（或让 `onMemberProgress` 的 handler 立即 return），重跑同一探针 → **必须** `FAIL [S1]` 且失败原因是「假成员未被判停滞」以外，对照组也不能被误判——两段输出原文贴报告，随后 `git checkout` 恢复。

### 7.4 门禁（AC-15，逐条必须贴实跑输出）

```bash
pnpm typecheck                                   # 0 错
pnpm test                                        # ≥189 例全绿
pnpm build                                       # 双产物
node --input-type=module -e "await import('./lib/index.js')"   # exit 0
node --input-type=module -e "await import('./lib/client.js')"  # exit 0
npm pack --dry-run                               # 含 lib/index.js、lib/client.js、cordis.patch.yml
grep -rn "STALL_MS" src/host/config.ts          # 定义仅此 1 处
grep -rn "STALE_MS\|data-member-stale-hint\|data-stale" src  # 0 命中
grep -rn "setInterval" src                      # 计数与基线相同
node logs/teamflow/tf-mvwnm3d9-l8db12/scripts/qa-peer-probe.mjs
node logs/teamflow/tf-mvwnm3d9-l8db12/scripts/qa-stall-probe.mjs
```

既有探针不得降项：`qa-reverify-probe.mjs` 9/9、`qa-collision-probe.mjs` 12/12（从上一轮归档目录取用，不重写）。

---

## 8. 任务拆分（5 并行 + 1 门禁任务；文件边界互不重叠）

| 任务 | 文件（改） | 只读 | 依赖 | 验收 |
|---|---|---|---|---|
| **T0 AC-7 前置实验** | `logs/teamflow/tf-mvwnm3d9-l8db12/scripts/ac7-event-probe.mjs`、`logs/teamflow/tf-mvwnm3d9-l8db12/notes/ac7-event-probe.md` | `src/host/adapters.ts` | 无（最先跑） | U1~U4 各有实跑输出；给出 L1/L2/L3 选定级别 |
| **T1 直通投递核心** | `src/host/team/handoff.ts`(新)、`src/host/team/dispatch.ts`、`src/host/team/member-prompt.ts`、`test/handoff.test.ts`(新)、`test/dispatch.test.ts`、`test/member-prompt.test.ts` | `src/shared/types.ts`、`src/host/store.ts`、`src/host/config.ts` | 无 | AC-1/2/3/4b/5/6 单测绿 |
| **T2 停滞核心** | `src/host/config.ts`、`src/shared/types.ts`、`src/host/store.ts`、`src/host/team/stall.ts`(新)、`src/host/team/watcher.ts`、`src/host/adapters.ts`、`test/stall.test.ts`(新)、`test/store.test.ts`、`test/adapters.test.ts` | `src/host/bridge.ts`、`src/host/index.ts`、T0 笔记 | 读 T0 结论（决定 L1/L2/L3，接口不变） | AC-8/9/11/13/14 单测绿 |
| **T3 客户端** | `src/client/tabs/MembersTab.tsx`、`src/client/viewmodel.ts`、`src/client/styles.ts`、`test/viewmodel.test.ts` | `src/shared/types.ts` | 无（字段缺失按 false，天然兼容） | AC-12/14 视觉与 DOM 锚点；`data-member-stale-hint` 0 命中 |
| **T4 装配与实发** | `src/host/bridge.ts`、`src/host/index.ts`、`test/bridge.test.ts` | T1/T2 全部产出 | **串行**：T1、T2 之后 | AC-3/4a/8：快照三字段、activity 合并、receipt 后实发且无 captain 消息 |
| **T5 交付自查与门禁** | `.gitignore`、`lib/index.js`、`lib/client.js`、`docs/teamflow/memory.md` | 全部 | T0~T4 全绿后 | §7.4 全部命令实跑贴输出；`.gitignore` 复核；AC-7 结论抄进交付说明 |

**并行度**：T1 ∥ T2 ∥ T3（文件集两两不相交）→ T4 → T5；T0 在 T2 前完成（阻塞 T2 的信号选型，不阻塞 T1/T3）。

### 8.1 Git 约束（PRD「工程约束」，随任务下发，不得遗漏）

- 沿用 `feat/auto-team-plugin`，**不切分支、不打 tag**；开工前 `git status --porcelain --untracked-files=all` 复核（当前仅本夹 3 个未跟踪产物）。
- 本轮未下发 commit 指令；若最终提交，则**功能 + 单测 + `lib/` 双产物 + 本夹文档同一笔**，commit message 说明「r4 第一期：直通投递 + 停滞检测」。
- `lib/` 必须入库（S0 动作：复核 `.gitignore` 继续忽略 `node_modules/ *.tsbuildinfo coverage/ dist/ .auto-team/ logs/teamflow/ *.tgz pnpm-debug.log .DS_Store`，补 `.vscode/ .idea/ .env*`，**不得**忽略 `lib/`、`cordis.patch.yml`、`docs/`）。

---

## 9. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| T0 结论为 L3（事件不可见） | 停滞信号粒度降为「成员 status 变化」 | 接口不变（`stallOf` 不变、tick 单出口不变）；AC-9 仍可判；在交付说明中如实标注级别 |
| peer body 撑破账本布局 | 面板废掉 | `[data-message]` 改整行正文 + 折叠（DESIGN §3），探针断言折叠阈值 |
| `applyReceipt` 变慢 | 回执路径卡顿 | 仍是纯函数，无 IO；发送在 bridge 侧异步、失败仅 notice |
| 停滞条与 interrupted 混淆 | 误判「已死」 | 实线 vs 虚线 + 琥珀 vs 红 + 文案不同；AC-14 断言两段文案不相等 |
| `progress` 无限增长 | 落盘膨胀 | `save()` 按 live bindings 裁剪 |

**回滚**：本需求不新增路由/动作/枚举，回滚 = revert 单一笔提交；`RunState.progress/stallAlerts` 为可选字段，旧代码读到会忽略（`wrapLegacy` 已按未知字段透传兼容）。
