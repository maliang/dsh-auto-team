# r36 诊断：真机上 `silentFinish` 为何一次都没触发（run-mwimxs3m-zoe）

> 只读取证。结论先行：**轮询对账路根本没有跑起来**（watcher 每轮 `listMembers()` 都抛 `NO_CALLER`，异常被 watcher 静默吞掉），事件路在本 run 里也没有产生任何可观测效果（`triggers: []`、`silentFinish` 恒 `undefined`）。所以 `isSilentFinish` 唯一的 `memberStopped` 前置条件永远为 `false`。

## 1. 时间线（本 run 实测）

| 时刻 | 事实 | 证据 |
|---|---|---|
| 10:25:21 | t2 派发（成员 `fa87d98f-39f4-4b94-b529-4e4d9873a8e0`） | `bindings[1].spawnedAt=1794795921898` |
| 10:31:36 | t2 最后一次进度；随后成员目录 30 步、`turn/end` 1 次收工 | `progress["fa87…"].at=1794796296497`；`~/.dsh/sessions/--Users-…--/fa87…/session.v4.jsonl.zstd` 244 行、30×step/end、1×turn/end |
| 10:37:57 | `auto_team_status` 仍报 t2 `status:"running"`、`stalled:true`、`stallReason:"quiet"`、`lastEventAt=1794796296497`（381 秒） | 队长会话 `tool/result`（seq≈724x） |
| 10:43:29 | 宿主把 “Background subagent docs-t3-gftuwf finished…” 投进队长 inbox | captain 日志 `agent/inbox/spliced` seq 7255 |
| 11:00:57 / 11:01:45 | 队长**手工**跑 receipt，t3 / t2 才有 `evidence` | `taskTimes[t3/t2].endedAt`；`messages` 里 member 回执 |

**反证**：若 `watcher.tick` 真拿到过宿主名单且 `activity='inactive'`，`reconcileMembers` 会在 1.5 秒内把任务判成 `interrupted`（`src/host/team/watcher.ts:118` 归一 dead 后进 dead 分支），10:37:57 就不可能还是 `running`。→ 轮询对账在这 6 分钟里一次都没执行。

## 2. ① 事件路取证

**订阅代码位置**
- 装配：`src/host/index.ts:729` `const subscription = onHostTriggerEvents(ctx, (eventName, payload) => {…})`。
- 只认两类事件：`src/host/index.ts:734` `if (eventName !== 'agent/error' && eventName !== 'subagent/end') return`。
- 取 id：`src/host/index.ts:736` `const ids = payloadIdsOf(payload)`（递归收集 payload 里所有字符串，`src/host/index.ts:883-899`）。
- 匹配 binding：`src/host/index.ts:743-745`（跳过 `retired`，`ids.has(binding.memberId) || ids.has(binding.name)`）。
- 命中后：`src/host/index.ts:749` `isSilentFinish({ task, binding, memberStopped: true })` → `recordSilentFinish`（:750-756），再 `triggerFromMemberExit` + `bus.push`（:757）。
- 实际注册的 ctx：`src/host/adapters.ts:2243` `TRIGGER_EVENT_NAMES`，逐个走 `subscribeHostEvent`（`src/host/adapters.ts:561-586`）：优先 `ctx.root`（`root !== ctx` 时），`root.on(event, listener, { global: true })`，失败退回两参。

**宿主 0.2.2-rc.2 到底发不发**
- 发：`app.asar` 的 settle 路径直接调用（字节偏移 ≈116352359）：
  `this.host.emitLifecycle("subagent/end", { ...this.runInfo(activation), stopReason: terminal.stopReason, …lastAssistantMessage }, activation.root);`
- 事件目录（asar ≈116479634）：`'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void`，注释原文：*“Scope-filtered dispatch uses the same subagent tree-root carrier as `subagent/start`, so the lifecycle pair reaches the same scoped audience.”*
- 派发实现（asar ≈116267479 `createLifecycleEmitter`）：`ctx.events.dispatch("emit", [carrier(parent), name, info])`，carrier 来自 `scopeTarget(base, key)`（asar ≈111293237）：先跑 subagents 服务自身的 `Context.filter`，再按 listener ctx 的 `scopeOf` 与 parent 链比对。**它不是普通全局 emit，而是带 scope carrier 的定向派发。**
- payload 里 memberId 怎么给：`info` 至少含 `id`（子会话 id）、`parentSessionId`、`provider`、`stopReason`、`lastAssistantMessage`（来自同一段 asar 代码）。`info.id` 与 `binding.memberId` 同域，理论上能命中；是否另带 `name` 未核实。

**本 run 是否收到：没有可观测效果**
- 队长会话 `session-afae7786-db09-474a-8e3f-c07a2d84a4e0/session.v4.jsonl.zstd`（7522 行）的**全部事件类型**里没有 `subagent/end`（有 `subagent/catalog` 48、`agent/inbox/spliced` 292、`team/member` 38、`tools/result` 916 等）。
- `run-mwimxs3m-zoe.json` 的 `triggers` 是 `[]`（0 条）；10:31–11:00 之间 `silentFinish` 一直是 `undefined`。
- 结论：**我们的 handler 没有被有效调用**（否则至少会留下一条 trigger 记录并写入 `silentFinish`）。至于是“宿主没发”还是“发了但没投递给 `ctx.root + {global:true}` 监听器”，只读取证分不出来——这一点只能在真机上用监听打点确认。**就本 run 的事实而言：事件路不可依赖。**

## 3. ② 轮询路取证

**入口与启动**
- `src/host/index.ts:481` `function startWatcher()`；`createMemberWatcher({…})` 在 :484；`watcherRef.start()` 在 :505。
- 真正接线：apply 内 `src/host/index.ts:835` `startWatcher()`（⑦ 运行时对账段）；保存设置后重建在 :578-583。
- 定时器全仓唯一一处：`src/host/team/watcher.ts:370-379` `setInterval(…, intervalMs)`（默认 1500ms，`unref()`）；`stop()` 在 :380。

**tick 与名单读取**
- `tick()`：`src/host/team/watcher.ts:304`；`active` 判定 :318-326（本 run 有 running 任务，不会跳过）。
- 名单：`src/host/team/watcher.ts:329-337`
  ```ts
  if (members === null) {
    try { members = await deps.listMembers() }
    catch { return changed }        // ← 静默吞掉，无 warn、无面板信号
  }
  ```
- `listMembers` 实参：`src/host/index.ts:181` `return listHostMembers(ctx)`。
- `src/host/adapters.ts:1538`：`const caller = resolveCaller(ctx); if (!caller) throw hostError(NO_CALLER, 'NO_CALLER')`（:1548）。`resolveCaller`（`src/host/adapters.ts:914-928`）先 `ctx.agents.currentInitiator()`，再 `requireInitiator()`，两者都拿不到返回 `undefined`。文案 `NO_CALLER` 在 `src/host/adapters.ts:1007`。

**为什么定时器里恒抛**
宿主 asar（≈20221551）对 `currentInitiator()` 的注释：*“returns the inherited Agent, or `undefined` outside an initiator boundary and inside an explicit clearing boundary”*；`requireInitiator()` 在无边界时 **throw**。`setInterval` 回调发生在任何 initiator 边界之外 ⇒ `currentInitiator()` 恒 `undefined` ⇒ `requireInitiator()` 抛 ⇒ `resolveCaller` 返回 `undefined` ⇒ `listHostMembers` 抛 `NO_CALLER` ⇒ watcher 静默 `return changed`。**每一轮都如此，reconcileMembers 一次没跑。**

**该成员拿到的 status 实际是什么**
- `normalizeDescendantRows`（`src/host/adapters.ts:1567`）把 `activity === 'running' ? 'running' : 'inactive'` 写入 `HostMember.status`（:1586）；watcher 再用 `normalizeHostStatus`（`src/host/team/watcher.ts:389-397`）映成 `alive/dead`。
- **本 run 里没有拿到任何行**：抛错发生在 `resolveCaller`，`listDescendants` 根本没被调用。所以既不是 `dead` 也不是 `alive`，而是“名单不可得”。这也是 `stallAlerts` 为空的原因之一： watcher 的 `stallAlertsOf` 同样没机会执行；面板上的 `stalled:true/quiet` 是 bridge 快照现算的（`src/host/bridge.ts:1290` `stallFieldsOf`），与 watcher 无关。

## 4. ③ `isSilentFinish` 逐条对照（10:31:36 之后）

| 前置条件 | 代码 | 本轮实际 | 判定 |
|---|---|---|---|
| `memberStopped === true` | `src/host/team/silent-finish.ts:34` | 事件路无信号；轮询路每轮抛错 → 恒 `false` | ❌ **就是这条挡住** |
| `binding !== undefined` | :35 | t2 有绑定 `fa87…` | ✅ |
| `binding.retired !== true` | :36 | 绑定无 `retired` 字段 | ✅ |
| `binding.taskId === task.id` | :37 | t2 ↔ fa87 | ✅ |
| `task.status === 'running'` | :38 | 10:37:57 快照仍是 `running` | ✅ |
| `task.evidence === undefined` | :39 | 当时确实没有（evidence 来自 11:01:45 手工 receipt） | ✅ |

结论：任务侧、绑定侧全部满足，唯一不成立的是 `memberStopped`——而它不成立不是因为成员还活着，是因为**两路信号都没送达**。

## 5. ④ 最小修复建议

1. **主修（轮询路，改动最小）**：让对账不依赖 initiator 边界。
   - `src/host/adapters.ts:1538` `listHostMembers(ctx, rootId?)`：有 `rootId` 时直接 `subagents.listDescendants(rootId)`，跳过 `resolveCaller`；没有 `rootId` 才回退现有逻辑。
   - `src/host/index.ts:181` `listMembers(rootId?)` 透传。
   - `src/host/team/watcher.ts:330` 调用处改为 `deps.listMembers(state.plan.sessionId)`（本 run 的 `plan.sessionId = session-afae7786-db09-474a-8e3f-c07a2d84a4e0`，正是 subagent 树的 root）。
2. **必须配套（否则同类故障永远静默）**：给 `createMemberWatcher` 增加 `onWarn` 依赖（`src/host/index.ts:484` 传 `warn(ctx, …)`），`src/host/team/watcher.ts:331-336` 的空 `catch` 改为调用它，并把“名单不可得”喂给 `triggerHealth`，让面板能显示降级。
3. **事件路加固（可选，不单靠它）**：除 `ctx.root + {global:true}` 外，在队长 `agent.ctx`（`agentContextOf(captainAgent)`）上也订阅一份 `subagent/end`；或在 apply 后第一次工具调用时缓存 captain agent 再补订阅。即便事件仍收不到，第 1 条已能兜底。

## 6. 复现（会在旧代码上红的自验方案）

**用例 A（根因复现，不依赖真宿主）**
- 用真 `RunsStore` 指向临时目录，写一条 run：`plan.sessionId = SID`；任务 `t2` `status:'running'`、无 `evidence`；绑定 `{taskId:'t2', memberId:'M', name:'qa-t2'}`。
- 调 `createMemberWatcher({ store, listMembers: async (rootId) => { if (rootId !== SID) throw new Error(NO_CALLER); return [{ id:'M', name:'qa-t2', status:'inactive' }] }, … })`，手工 `await watcher.tick()`。
- **旧代码**：watcher 调 `listMembers()` 不带参 → 抛错 → 返回 0，任务仍 `running`、`silentFinish` 仍 `undefined` ⇒ 断言红。
- **修复后**：watcher 传 `state.plan.sessionId` → 拿到 `inactive` → `normalizeHostStatus` 得 `dead` → `silentFinish` 落盘 ⇒ 断言绿。
- 断言：`store.load(runId).plan.tasks.find(t => t.id === 't2').silentFinish?.at` 为有限数，且重新 `load` 后仍在（证明落盘不是内存态）。

**用例 B（事件路，补证）**
- 假 ctx（`root.on` 收集监听器）投 `{ id:'M', parentSessionId:SID, stopReason:'completed' }` 到 `subagent/end`，断言 `silentFinish` 被写入。
- 旧代码在无 bus 的单测环境里未必红，因此**以用例 A 为主判据**。

## 7. 未取得 / 不确定（不猜）

- 宿主 `subagents.listDescendants` 对本 run 成员给出的真实 `activity` 值：**未取得**（watcher 没走到那一步）。
- `subagent/end` 是否真的投递给 `ctx.root + {global:true}`：只证明了“handler 未被有效调用”，无法区分“未发/未投递”。
- `SubagentRunEndInfo` 是否带 `name` 字段（本次只从 asar 看到 `id/parentSessionId/provider/stopReason/lastAssistantMessage`）。
