# Super-agent 架构 → dsh-auto-team 融入方案

> 来源：《Super-agent 设计探索》（DeepSeek Harness 团队）+ 原型仓库 `deepseek-ai/dsh-superagent-prototype`（MIT，已克隆到 `/tmp/dsh-superagent-prototype`，depth 1）+ 本仓库现状实测。
> 本文只做**映射与取舍**，不含实现。写于 2026-11-01，依据的分支 `feat/auto-team-plugin`（HEAD `f7379a6`）。

## 1. 结论（先看这张表）

| 文章模块 | 原型怎么落 | 我们的现状 | 判定 | 量级 |
|---|---|---|---|---|
| 双层 Router/Worker | `core/engine.ts:24` 领域 Engine + `app/sessions.ts` 两种角色 session | **已有**：队长=当前会话，成员=`agentTeams.spawnTeammate` | 骨架已对，不重做 | — |
| 事件驱动 Trigger + Fast/Slow 双层过滤 | `core/intake.ts:19` 收 Trigger → `:25` `scope.listened`（程序层）→ 未过滤的进 Eval（语义层） | ❌ 只有「人点一下/模型调一次」的命令路径（`bridge.act`） | **可搬，需改造** | 中 |
| Thread 多对多订阅 + 直通 | `core/engine.ts:54` `bindThread`、`intake.ts:38-59` fanout 直投订阅者，不经 Router | 半个：成员间直达消息有了，但**上游产物不会自动流到下游** | **最值钱，建议先做** | 小-中 |
| Inline & Spill + 链式召回 | `app/cache.ts:5` `TextCache`（LRU，按 UTF-16 计量）+ `runtime.ts:118` 4MB 页缓存 | 半个：记忆注入有 4000 字预算，超了直接截断，没有 spill key | 可搬，第二批 | 中 |
| Watchdog（进展/偏航） | `app/effects.ts:46` 每 kind 一条 health、连续失败 3 次报错；`app/retry-health.ts` | **只有第一层**：`team/watcher.ts:53` 只对账「成员死没死」 | **必做**，第二层缺 | 小-中 |
| 队长轻量化 / 不亲自干细活 | `ROUTER_PRESET` / `WORKER_PRESET` + `noWait` 守卫（禁 sleep、shell>30s、wait>5s） | ❌ 队长用同一模型，且深度参与拆解 | 部分可做（模型那半需实测） | 小 / 未知 |
| 异步 ReAct（全双工） | `executor/background.ts` | 结构上已解决（成员是独立 session，队长不被阻塞） | 不需要 | — |
| 投机执行 | 未见独立实现 | 无外部事件源时无意义 | 跳过 | — |
| 存算分离 / 端侧 daemon / 多信道 | `sources/{github,feishu}*` | 插件跑在宿主进程内，无云端容器、无外部信道授权 | **明确不搬** | — |
| SQLite + 迁移器 | `app/store.ts:291`、`app/migration.ts:616`、`SCHEMA_VERSION` 只增 | JSON 文件 store（`host/store.ts`，261 行） | 不搬（见 §5） | — |

一句话：**骨架你早有了，缺的是「动力来源」和「自我照看」。**

## 2. 两个仓库的体量对照（决定「能搬多少」）

| | 原型 | 我们 |
|---|---|---|
| 源码行数 | 32903（src 内 15205） | 8257 |
| 持久化 | SQLite 单文件 9 张表 + 生成列 + 索引 | JSON 文件（`RunState`，`store.ts:37`） |
| 后台驱动 | `Passes`：`setInterval 2000` → `engine.evaluateDue()`（`app/passes.ts:28`） | `setInterval 1500` → 成员存活对账（`config.ts:51`） |
| 副作用 | 持久 Effect 队列 6 kind + per-kind health + 指数退避 | 无队列，同步 await |
| 工具面 | Router 14 个 + Executor 6 个 | `auto_team_*` 7 个 |
| 外部源 | GitHub / 飞书（SourceKind 可扩展） | 无（不接外部） |

**判断**：原型是「平台级产品」，我们是「会话级插件」。全盘照搬会让体量翻 4 倍，还要付 `SCHEMA_VERSION` 迁移税。**只搬机制，不搬规模。**

## 3. 建议落地的四件（按性价比排序）

### 3.1 直通投递：依赖完成 → 下游成员（先做）

**现状问题**：任务 A 完成、写了产物、门禁通过；任务 B 依赖 A。今天 B 拿到的上下文是队长在派发时**转述**的（`bridge.ts` 的 member prompt 拼装），队长成了所有信息的必经之路——这正是文章里「去掉直通后 Router 决策 +30%、读缓存 token +37%」的成本来源。

**搬法**（对照 `intake.ts:38-59` 的 fanout）：

- 数据侧：`PlanTask` 已有 `dependsOn`（`shared/types.ts:57`）；`MessageRecord`（`:159`）已有 `from/to/taskId/at`，够用，**不必新增表**。
- 行为侧：`applyReceipt`（`bridge.ts:90`）判定 `done` 之后，按依赖图找出订阅者（`plan/graph.ts` 已有拓扑），给每个下游成员**直接**发一条结构化消息：`{ 上游任务 id, 产物路径/证据摘要, 门禁退出码 }`，`from: 'peer'` 而非 `'captain'`。
- 边界：只在 `verdict === 'done'` 且门禁 `exitCode === 0` 时投递；`rework`/`failed` 投给**队长**（那是决策，不是信息）。

**验收点**：两个任务 A→B 的 run 里，B 的成员消息账本出现 `peer` 来源且内容含 A 的证据摘要；队长消息账本里**没有**为这次转述产生新消息。

### 3.2 Watchdog 第二层：进展与偏航（必做）

**现状**：`team/watcher.ts:53` 的 `reconcileMembers` 只做存活对账——成员缺席/inactive/failed → 任务标 `interrupted`（`normalizeHostStatus`，`watcher.ts:188`）。副作用是：**一个活着但 20 分钟没产出的成员，在面板上永远是绿的**，只能靠人发现。这就是文章说的「门禁只管结果层」。

**好消息：宿主事件够用（本次用 `cordis_inspect_query` 实测 `Event/listEvents`）**：

| 事件 | 模式 | 用途 |
|---|---|---|
| `tools/execute` / `tools/result` | waterfall / emit | **最可靠的「实质产出」信号**：成员真的调了工具 |
| `agent/status` | emit | `idle ⇄ running` 变化 |
| `agent/error` | emit | 单 step/turn 报错 |
| `subagent/start` / `subagent/end` | emit | 成员内部再开子 agent（原型允许，我们也允许） |
| `session/event` | emit | 提交后的 durable 事件流（兜底：任何会话事件） |
| `agent/disposed` | emit | 成员离开注册表（比轮询快） |

**搬法**（对照 `app/effects.ts:46` 的 health 思路，但**不做持久队列**，我们量级不需要）：

- `MemberBinding` 增 `lastProgressAt`（`shared/types.ts:180` 加一个字段）；由 `tools/execute`（按 memberId 过滤）更新，不落盘也无妨——落盘是为了面板重启后仍能显示。
- `watcher.tick()` 里加一段**进展判定**：`now - lastProgressAt > STALL_MS`（建议 90s，可配）且任务 `running` → 面板该行转黄「疑似停滞」+ 一条 `ActivityEvent{kind:'tool'}` 或新 kind `stall`。
- `ActivityEvent.kind` 里**已经有 `'tool'` 这个枚举值，但 `bridge.ts:243` 的 `activityOf` 从没产出过它**——这是现成的空位，不用扩类型。
- 偏航判定（文章里更贵的部分）：第一版**不做语义判定**，只做两件事——① `routeAudits` 已有 drift 检测（`bridge.ts:243` 附近有 `route_drift` 事件）；② 门禁失败时的 rework 计数（已有）。语义偏航评估留到 3.3 有 Trigger 总线之后再说。

**验收点**：注入一个「活着但从不调工具」的假成员，`STALL_MS` 后任务行变黄且出现一条 stall 活动事件；对照组成员（持续调工具）不告警。**可分辨性自检**：把 `lastProgressAt` 更新逻辑删掉，该断言必须必然变红。

**硬约束**：`config.ts:51` 的 1500ms 轮询 + 面板 2000ms 刷新的预算（AC-18 的 3500 ≤ 5000）不能被打破——事件驱动替代轮询可以，叠加不行。

### 3.3 内部 Trigger 总线（等 3.1/3.2 稳定后再做）

**为什么不接外部源**：原型的 Trigger 来自 GitHub/飞书，因为它要「主动」；我们这个插件的触发源本来就在宿主内，**不需要任何外部平台授权**，而且这些事件我们现在已经在观测、只是没拿来驱动决策：

- 门禁失败 → 自动 rework 或升级给人
- 成员退出/被杀 → `watcher` 已感知，但目前只写消息，不驱动
- 依赖全部完成 → 自动派发下游（现在是等 `dispatchReady` 被调）
- 停滞超时 → 3.2 的产物
- 成员回报阻塞 → 自动派给队长决策

**搬法**（对照 `intake.ts:19-60`）：

- 新增 `src/host/team/intake.ts`：`receive(trigger)` 做三件事 —— 去重（key = kind + 实体 id + 时间桶）、**Fast path 纯程序过滤**（对照 `intake.ts:25` 的 `scope.listened`：这是「配置里没开的 kind」直接丢弃并留 disposition）、投递（订阅者直投 / 无人接的进 Slow path）。
- Slow path = **队长语义判定**：这里有个原型已经解决、我们必须正视的问题——**队长就是当前会话，它被占用时没法既当 Router 又当 assessor**。原型用独立 `MasterAssessor`（`app/assessment.ts`，282 行）绕开。我们有两个选项：① 用 `subagents.startActivation` 起一个一次性评估 session（成本一条消息，但可能与用户对话抢上下文）；② 把 Trigger 攒成「待办清单」，等队长下一轮自然处理（零成本，但延迟）。**推荐 ② 起步**，① 留到有实测数据再换。
- 命令入口复用：`bridge.act`（11 个 `PanelAction`）已经是唯一语义入口，事件路径必须复用它，**禁止另写一套分支**——本项目历史高频缺陷就是「工具能用、面板不能用」两条入口各写一套。

**验收点**：同一条 Trigger 从不同来源(事件/面板/工具)进来，产生同一结果码；Fast path 丢弃的 Trigger 在 disposition 里可查、且**不产生**任何成员 spawn。

### 3.4 Inline & Spill（记忆与读页面）

**现状**：`memory/inject.ts`（234 行）按 4000 字预算拼注入（`config.ts:30` `MEMORY_INJECT_BUDGET`），超了**截断**并在注入文本末尾追加一行标注（`inject.ts:35` `TRUNCATION_MARK` = `…[截断]`，见 `inject.ts:10-11` 的格式说明）——信息直接丢失，成员无从「按需展开」。

**搬法**（对照 `cache.ts:5` + `runtime.ts:118`）：

- 超预算的部分落盘到 run 目录（`<dataRoot>/runs/<runId>/spill/`），注入文本里换成 `spill://<id>` + 首行摘要。
- 已有 `readMemoryFile`（`bridge.ts:130`）+ `auto_team_*` 工具面，加一个「按 id 取 spill」的能力即可，**不需要新表**（文件即表）。
- 原型是把整页缓存在内存 LRU（4MB）；我们是落盘 + 有界读，别学内存缓存——重启就失效对成员来说是坏体验（`cache.ts:2` 注释明写「重启即失效」）。

**验收点**：构造 >4000 字记忆，注入文本出现 spill id 且**没有再出现截断标记**；成员按 id 取回的内容与源文件逐字节相同。

### 3.5 队长轻量化：拆成两半

- **能做的（零成本，建议做）**：把「队长不亲自干细活、只分派与验收」写进队长 prompt section（`adapters.ts:36` 的 `systemPrompt.section` 已可用，我们在 `src/host/prompt.ts` 已有拼装）。
- **需要实测的（别承诺）**：给队长单独指定模型。成员的 per-role 路由靠 `adapters.ts:646` `installMemberRoute` 在 `agent/created` 里装 member-scoped 路由（`:530` 订阅 `agent/created`，`:654` 订阅 `system-prompt/assemble`）；**队长是宿主自己的主 session，插件能不能改它的模型，本方案未验证**。要验证就按本项目规矩来：先做最小实验拿证据，不许凭印象写进需求。
- **原型的 `noWait` 守卫**（`ROUTER_PRESET` 禁 sleep / shell>30s / job_output 等待>5s）值得抄：队长一旦同步等长任务，整个编排就僵住。我们已经有「成员异步、队长不等」的结构，但**队长自己调 bash 跑长命令**这条路是敞开的，可考虑在队长可见的工具指引里写死。

## 4. 明确不搬（附理由，避免以后反复讨论）

| 项 | 为什么不搬 |
|---|---|
| SQLite + migration（616 行） | 我们是单 run JSON（`store.ts`），数据量在「十几个任务/几十条消息」级；引入 SQLite 要付 schema 版本迁移税，收益只在「无限历史 + 复杂查询」，而我们的历史本来就该归档进 `$DSH_HOME` |
| 存算分离 / 端侧 daemon | 插件跑在宿主进程内，没有容器、没有 daemon 生命周期，属平台层 |
| 多信道（飞书/GitHub Source） | 需要外部凭证与 webhook 授权；且与「输入框下方开关」的产品定位冲突（我们是会话内工具，不是值班机器人） |
| 投机执行 | 无外部事件源时，投机等于白跑 |
| MasterAssessor 独立 session | 起步用「攒成待办、等队长下一轮」更省；真要独立评估再用 `subagents` 起 |
| Effect 持久队列（6 kind + health） | 我们没有跨进程重启的副作用要重放；`Later`/退避/health 三层是为「长时间无人值守」设计的，会话内插件用不上 |

## 5. 分期与风险

**第一期（独立可验，收益立现）**：3.1 直通投递 + 3.2 Watchdog 第二层。
- 两者都不改数据模型主干（各加 1 个字段/1 个 kind），都能单独写测试。
- 风险：`watcher` 现有 1500ms 轮询与新增事件订阅**可能重复触发**——必须先定「事件为主、轮询兜底」的优先级，否则会出现「一次停滞两条告警」。

**第二期**：3.5 队长 prompt + `noWait` 指引（零成本）+ 3.4 Inline & Spill（记忆层）。

**第三期**：3.3 Trigger 总线。这是骨架性改造，等前两期的经验，尤其是「Fast/Slow 的 Fast 到底能过滤掉多少」有了真实数据再动——原型的 Filter 建立在「GitHub/飞书的噪声量」上，我们的噪声分布**完全不同**（我们的事件本来就少而准），照抄 `AdmissionTable`（`policy.ts:75`，9 种准入组合）大概率是过度设计。

**全局风险**：
1. **事件订阅尚未实测**。本次只拿到 `Event/listEvents` 的**目录**（名字、mode、签名），每个事件的 payload 实际形状、订阅是否需要 scope、`tools/execute` 是否覆盖成员 session 的工具调用，**都还没验证**。落地前必须先做最小实验（照本项目教训：先实验再断言）。
2. **AC-18 的刷新预算**（watcher 1500 + 面板 2000 ≤ 5000）是全量硬约束，任何新增轮询/订阅都必须先算这笔账。
3. **两条入口一致性**：事件路径必须复用 `bridge.act` 语义，否则重演「工具能用、面板不能用」。

## 6. 证据索引（本方案的每个断言都能落回文件）

**原型**（`/tmp/dsh-superagent-prototype`）
- `src/core/engine.ts:24` Engine 类、`:48` `receive(trigger)`、`:54` `bindThread`、`:75` `evaluateDue()`
- `src/core/intake.ts:19` `receive`、`:25` `scope.listened`（Fast path）、`:38-59` 订阅 fanout 与 disposition
- `src/policy.ts:30` `Assessment`、`:40` `assessmentOutcome`、`:75` `AdmissionTableSchema`
- `src/app/effects.ts:5` `Later`、`:7` `FAILURES_BEFORE_ERROR = 3`、`:46` `Effects`、`:61` `enqueue`
- `src/app/cache.ts:2` 注释「重启即失效」、`:5` `TextCache`
- `src/app/passes.ts:28` `setInterval(…, 2000)`
- `src/app/runtime.ts:77` `sourceLinks = new TextCache(200_000)`、`:118` `pages: new TextCache(4_000_000)`
- `docs/007-architecture.md`：Trigger→Eval→Decision→Ticket→Assignment→Subscription→Report、14/6 个工具、`noWait` 守卫

**本仓库**
- `src/host/team/watcher.ts:53` `reconcileMembers`、`:124` `createMemberWatcher`、`:188` `normalizeHostStatus`
- `src/host/config.ts:30` 记忆预算 4000、`:51` `WATCHER_INTERVAL_MS = 1500`、`:57` `MAX_ATTEMPTS = 3`
- `src/host/bridge.ts:90` `ApplyReceiptPort`、`:130` `readMemoryFile`、`:243` `activityOf`
- `src/host/store.ts:37` `RunState`（plan / plannedAt / messages / bindings / routeAudits）
- `src/host/adapters.ts:530` 订阅 `agent/created`、`:646` `installMemberRoute`、`:654` 订阅 `system-prompt/assemble`
- `src/shared/types.ts:57` `PlanTask`（含 dependsOn）、`:159` `MessageRecord`、`:180` `MemberBinding`、`:246` `ActivityEvent`（kind 含 `'tool'` 但当前无生产者）、`:269` `PanelAction`（11 个）
- 宿主事件目录：本会话 `cordis_inspect_query(platform="host", provider="Event", method="listEvents", input={})` 实测返回完整事件目录，含 `tools/execute`、`agent/status`、`agent/disposed`、`agent/error`、`subagent/start|end`、`session/event` 等（每条都带 mode 与签名）
