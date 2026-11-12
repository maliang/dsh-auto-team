# t6 · token 用量改读宿主会话投影（修「面板/历史六项永远不可得」）

- 需求：r17「token 用量数据源修好——改读宿主 sessionProjections 的 tokenUsage 投影（事件订阅在真机从未投递），面板/历史六项真实有数」。
- 范围：只动 t6 写域内文件；`src/client/**`（t2/t3b 并行）与 `src/client/styles.ts` 未改。
- 门禁：`pnpm typecheck && node --test test/usage.test.ts test/usage-projection.test.ts`

## 1. 为什么换数据源（真机证据）

队长排查结论（本卡沿用，未重复真机实验）：

- 真机 `~/.dsh/auto-team/runs/*.json` **全部没有 `usage` 键**，而成员会话日志里明明有 `assistant/message` + `usage`；
- `usageOfSessionEvent`（解析）、`memberIdOf`（归属）、`applyUsage`（累加）、`createUsageDeduper`（去重）、`store.save`（落盘）逐段离线验证都正确；
- ⇒ **`session/event` 订阅在这个宿主里没有把事件投递给插件**。这不是解析 bug，加重试/改解析都不会有数据，所以本次不再碰事件链路（旧链路原样保留，双保险）。

宿主侧可用的权威数据源（读宿主源码核实）：

| 事实 | 位置/形状 |
|---|---|
| 投影注册表服务名 | `ctx.sessionProjections`（包 `@deepseek-ai/dsh-session-projection`） |
| 读取方法 | `stateOf(session, key)`；key 未注册返回 `undefined`；内部 `materializeCells(session)` 从会话日志**回放**，不依赖事件投递 |
| token 投影 key | `tokenUsage`（`@deepseek-ai/dsh-token-meter`，`stateVersion: 2`） |
| state 形状 | `{ totals: { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }, last }`；wire 视图就是 `totals` |
| 兜底 key | 第三方 `dsh-cost-meter` 的 `costUsage`（本机 asar 内没有该包，读法按宽松容错实现） |

注意：`stateOf` 在宿主里标了 deprecated（首读每个 key 打一条 `logger.warn`），但目前是唯一无副作用读法，接受该告警；将来宿主提供「await register 的 handle」再接。

## 2. 做了什么

### 2.1 `src/host/adapters.ts`：唯一宿主读口

- `OPTIONAL_SERVICES` 增加 `sessionProjections`（同步 `OptionalServiceMap` 的 `HostSessionProjections { stateOf?(session, key) }`），保持 `test/host-contract.test.ts` 的「白名单 === 调用点」不变量。
- 新增 `readSessionTokenUsage(ctx, sessionId): TokenTotals | undefined`：
  - `ctx.agents?.get?.(sessionId)?.session` 取**真实 Session**（回放依赖 `header` / `snapshotEvents` / `seq`，不能拿空对象糊弄）；
  - 用 `readServiceQuietly(ctx, 'sessionProjections')` 读服务（每次快照都会读，`optionalService` 的 warn 会刷屏）；
  - 依次试 `tokenUsage` → `costUsage`，异常/缺字段**一律吞成 `undefined`，绝不抛**（fail-open）；
  - buckets → `TokenTotals`：`input = uncachedInputTokens`、`output = outputTokens`、`cacheRead = cacheReadTokens`、`cacheWrite = cacheWriteTokens`，`total = input + cacheRead + output`（与既有口径一致，不含 cacheWrite）；
  - **`calls` 不填**：宿主投影没有调用次数，补 0 就是伪造，界面保持「不可得」；
  - 字段别名宽松：`uncachedInputTokens|inputTokens|input`、`outputTokens|output`、`cacheReadTokens|cacheRead`、`cacheWriteTokens|cacheWrite`，`state.totals ?? state.buckets ?? state`。

### 2.2 `src/host/team/usage.ts`：纯合成（覆盖语义）

- 新增 `ProjectionUsageEntry { memberId, taskId?, totals }` 与 `applyProjectionUsage(record, entries, now)`：
  - `byMember[memberId] = 该成员投影全量`——**覆盖，不是相加**（投影本身是累计值，相加会翻倍）；
  - `byTask[taskId]` 只重算本次触及的任务（同一任务多成员按全量累加），未触及任务保留既有值；
  - `total = 各 byMember 之和`，`attribution = 'per-member'`，`updatedAt = now`；
  - 本帧读不到的成员（会话已卸载/宿主重启）**保留落盘值**，历史不丢；
  - 数值/归属全都没变时**返回同一引用**，调用方据此跳过落盘（避免每帧写盘）。
- 该函数是纯函数（不 import 宿主），沿用既有 `addTotals`/`sumByMember`，没有新造一套累加。

### 2.3 `src/host/bridge.ts`：快照前刷新一次

- `BridgeDeps` 新增两个可选端口：
  - `readSessionUsage?: (sessionId) => TokenTotals | undefined`——读口由装配层接 `adapters.readSessionTokenUsage`，bridge 不直接碰 `ctx`（守住「宿主 API 只在 adapters」的分层，单测也能直接注入 stub）；
  - `onUsagePersistError?: (message) => void`——落盘失败的错误出口（进日志，不吞）。
- 新增 `refreshUsage(state)`，`snapshot()` 首行变成 `const state = refreshUsage(loadState(sessionId))`：
  - 遍历 `state.bindings`，跳过 `retired === true` 与空 `memberId`（会话已退出，不再采样）；
  - 每个读口调用独立 try/catch，读不到就跳过；
  - 内容没变不 `store.save`；变了 save 一次——**落盘后成员会话被卸载/宿主重启，历史仍能从 `runs/*.json` 显示**；
  - save 抛错时用 `onUsagePersistError` 上报，并**仍然返回内存新值**（本帧面板有数，不因写盘失败回退成「不可得」）。
- 之后完全沿用既有 `usageOf` / `taskUsageOf` / `usageCellOf` 链路，六项 details 仍由宿主 `format.ts` 统一生成，客户端只读透传。

### 2.4 `src/host/index.ts`：装配接线

`createBridge({ ... })` 增加：

```ts
readSessionUsage: (sessionId) => readSessionTokenUsage(ctx, sessionId),
onUsagePersistError: (text) => warn(ctx, text),
```

## 3. 关键行为约定

| 场景 | 行为 |
|---|---|
| 投影有数（`tokenUsage` 命中） | 面板 run/任务/历史六项全部 `provider`；`calls` 仍为「不可得」（来源没有） |
| `tokenUsage` 未注册 | 试 `costUsage`；再没有就是 `undefined` |
| 投影服务缺失 / 会话已卸载 / 回放抛错 / 字段缺失 | 保持已落盘 usage；从未有过就 `unavailable + 原因`，**绝不补 0** |
| 同一帧重复刷新、数值未变 | 不写盘（`updatedAt` 不变），引用相等 |
| 投影数值增长 | 覆盖写一次，**不累加**（190 → 260 而不是 450） |
| `retired` 绑定 | 不读投影（成员会话已退出） |
| 落盘失败 | 面板显示内存新值，错误进 `onUsagePersistError` |
| 历史 run（会话已结束） | 读落盘 usage，行为与之前一致 |

## 4. 验证证据

```text
$ pnpm typecheck
> dsh-auto-team@0.1.0 typecheck
> tsc --noEmit
（无输出，退出码 0）

$ node --test test/usage.test.ts test/usage-projection.test.ts
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
（退出码 0）
```

另有并行回归（实现期间跑过一次）：`node --test test/usage.test.ts test/host-contract.test.ts test/wire.test.ts` → 37/37 pass。

`test/usage-projection.test.ts` 的 12 例覆盖：tokenUsage→TokenTotals 映射与 `calls` 不伪造、costUsage 兜底与字段别名、服务缺失/抛错/未注册 key/字段缺失/会话已卸载/空 id 的 fail-open、覆盖语义与重复刷新不翻倍、本帧读不到成员保留历史、空 entries 原样、六项 key 顺序与 25% 命中率、bridge 的面板+历史有数 / 同值不落盘 / 值变化才落盘 / retired 跳过 / 读口抛错保持历史 / 落盘失败仍显示内存值。

## 5. 真机复验（留给队长）

- 宿主进程**需要重启**才会加载新的 host 产物（`lib/index.js` 是安装时打包的；本卡按边界未跑 `pnpm build`）。
- 复验步骤建议：
  1. 重启宿主后跑一个 member 有输出的 run；
  2. 看 `~/.dsh/auto-team/runs/<runId>.json` 是否出现 `usage.byMember` / `usage.byTask` / `usage.total`；
  3. 面板「计划」页 run 行、任务行、历史列表六项是否为真数（`calls` 应为「不可得」，这是数据源事实，不是 bug）；
  4. 宿主日志里每个投影 key 会有一条 `sessionProjections.stateOf(session, "tokenUsage") is deprecated; ...` 的 warn，属预期。
- 已知限制：`byTask` 只按「本次能读到的绑定」重算，若同一任务曾有已 `retired` 的成员且本帧仍有其他成员在该任务上，任务级数字不含 retired 那位（run 合计仍含，因 `byMember` 保留历史）。这是「投影没有 per-member 任务归属」的必然结果，不伪造。
