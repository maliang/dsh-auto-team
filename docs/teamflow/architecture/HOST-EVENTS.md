# HOST-EVENTS — 宿主事件与工具调用的已核实事实

> 目的：**不要再为了「宿主事件长什么样」去调 `cordis_inspect_query`。**
> 本项目已有三个阶段（r1 scaffold、r4 tech、r5 dev-T5）因该工具的调用姿势错误把阶段判成 `env-unavailable`，累计烧掉约 700k 新增 token。
> 下面每条都标注了取得方式；未标注「实测」的，就是**没有验证过**，落地前必须先写探针。

## 1. 怎么取事实（若本文缺了你需要的）

```text
cordis_inspect_query({ platform: "host", provider: "Event", method: "listEvents", input: {} })
```
- 列全部 76 条事件：`input: {}`。
- 查单条：`input: { "event": "agent/status" }`，会额外返回 `parameters` 与 `referencedTypes`（类型声明的原文）。
- **`input` 必须是对象**。传字符串（哪怕是 `"{}"`）、数组、`null` 或省略，都会得到
  `Host Cordis inspect Event.listEvents rejected input: "input" must be an object` ——
  **这是调用姿势错误，不是环境不可用**。见到这条错误，改姿势重试一次；再失败就去读 `/tmp/dsh-src/` 里的宿主源码，**不要重复同一形状的调用**。
- 其他 provider 同理：`Service` / `Event` / `Config` / `Tool`（host 侧），方法名见 `cordis_inspect_list`。
- **client 侧（`platform: "client"`）规则完全一样**：`Service` / `Event` / `Builtin` / `Slots` / `Theme` 五个 provider，同样必须传对象形式的 `input`。会话里已第四次踩同坑（r1 scaffold、r4 tech、r5 dev-T5、r6 QA 的 `Slots.listSubTree`，累计约 950k 新增 token），四次报错文字只差 provider 名。**只要看到 `rejected input: "input" must be an object`，先改调用姿势，绝不要判阶段 env-unavailable。**

## 2. 事件目录（实测，2026-11-01）

`mode` 决定能不能用来观测：

| mode | 语义 | 能不能用来观测 |
|---|---|---|
| `emit` | 广播，监听器只读、抛错被隔离 | ✅ 首选 |
| `serial` | 串行等待，返回值可影响流程 | ⚠️ 可观测但会串进主流程，慎用 |
| `waterfall` | 环绕，**必须调用 `next()`** | ❌ 观测禁用（漏调 next 会吞掉原操作） |
| `parallel` | 并行等待 | ⚠️ 可观测，会拖慢调用方 |

### 2.1 与本插件相关的事件（实测签名）

```ts
// 成员/队长的运行状态变化。agent-scoped：监听器只收到该 agent 的事件。
'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void
  Agent = { readonly id: SessionId }
  AgentStatus = 'idle' | 'running'
  // 描述原文：A waking delivery enters `running` synchronously after reserving cancellation;
  //          `idle` means no driver remains scheduled or active.
  // 作用域原文：Scope-filtered dispatch (@deepseek-ai/dsh-scope): agent-scoped listeners receive only that agent.

// 工具调用的最终结果（冻结、无损 JSON）。scope 过滤 keyed by `exec.agent`。
'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined

// 工具调用的环绕水管：必须 next()，不能用来观测。
'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>

// 一步或一轮出错。
'agent/error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; error: unknown }): void

// 子代理（published child）起止。
'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void
'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void

// Agent 的进入与离开。created 是 serial（可 await），disposed 是 emit。
'agent/created'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource; signal?: AbortSignal }): undefined | Promise<undefined>
'agent/disposed'(this: Scoped<Agent>, payload: { agent: Agent }): void

// 收件箱进出。
'agent/inbox/inserted'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
'agent/inbox/claimed'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage; turn: number }): void
'agent/inbox/discarded'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

### 2.2 其他可能有用的（签名已实测，payload 细节未展开）

`session/event`(emit, post-commit 追加流) · `session/flush`(parallel) · `session/created|disposed`(emit) ·
`system-prompt/assemble`(waterfall) · `fs/observed`(emit) · `goal/changed`(emit) · `schedule/changed` ·
`api-session/status`(emit) · `workflow/start|end|phase|log|agent-start|agent-end`(emit) ·
`tools/pre-execute|post-execute`(waterfall) · `tools/change`(emit) · `skills/change`(emit)。

## 3. `ToolExecution` 形状（实测）

```ts
ToolExecutionInput = {
  callId: string
  rootCallId?: string
  name: string
  schema?: unknown
  arguments: unknown
  agent?: Agent            // ← 归属成员，scope 过滤就是按它
  parent?: ToolExecutionToken
  signal: AbortSignal
}
ToolExecution = ToolExecutionInput & { rootCallId: string; token: ... }
```

**要点**：`agent` 在**内存中的 payload** 里，只有 Cordis 事件能提供；会话持久化层（`session/event` 的 `tool/call`）
**不含** agent 归属。所以「按成员归属工具调用」只有一条正路：在 `agent.ctx` 上注册 `tools/result`，
或根级注册后读 `exec.agent`。**不要**从持久化事件流里反推归属。

## 4. 已知作用域事实

- `agent.ctx` 上注册的 `agent/*` 监听器**只收到该 agent 的**事件（宿主 `dsh-scope` 的作用域派发）。
- 根级 `ctx` 上注册则收到全部，需要自己按 `payload.agent.id` 过滤。
- 本插件已有的收口点：`src/host/adapters.ts` 的 `agentContextOf(agent)`（返回 `agent.ctx`）与
  `registerMemberRoute(agent, route)`（已在用 `system-prompt/assemble` 与 `agent/request`）。

## 5. 尚未验证（写代码前必须先探）

- `subagent/end` 的 `SubagentRunEndInfo` 具体字段（是否含 parent/child agent id）。
- `agent/error` 的 `error: unknown` 在本宿主上的实际形态（是否总是 Error 实例）。
- 工具调用在**成员 session**里是否同样触发 `tools/result`（真机未接线验证，需要把插件装进 profile 才能测）。
