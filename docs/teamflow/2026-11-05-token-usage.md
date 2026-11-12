# token 用量六项指标：口径、链路与验证（t2）

> 日期：2026-11-05 · 任务：t2「打通 token 用量链路并在面板展示六项指标」· 上游：t1（右侧面板「不可得」占位符修复）

## 1. 需求与交付边界

用户要看的六项指标（顺序固定）：

| # | 指标 | 含义 |
|---|---|---|
| 1 | 输入未命中 | 本次/本 run 未被缓存命中的输入 token |
| 2 | 输入命中 | 命中前缀缓存的输入 token |
| 3 | 写缓存 | 写入缓存的 token（宿主当前不上报 → 显示「不可得」） |
| 4 | 输出 | 模型输出的 token |
| 5 | 调用次数 | 模型调用条数（一条 assistant 消息 = 一次） |
| 6 | 缓存命中率 | `输入命中 / (输入未命中 + 输入命中)` |

本次交付：**从宿主事件到面板渲染的完整链路 + 六项指标的展示位**。不做的事：

- 不估算、不补 0：宿主没给的项一律显示「不可得」，缺一侧数据时不算命中率（只用一半数据算出来的比率是假数）。
- 不在客户端新增第二套格式化：六项的文案（千分位、百分号、`不可得`）全部由宿主 `src/host/format.ts` 生成，客户端只渲染。
- 不改 token 归属的既有三态判定（`per-member → aggregate-only → unavailable` 单向降级），只在其上补齐字段。

## 2. 宿主真实用量形状（已在真机会话日志中核实）

证据来自 `~/.dsh/sessions/--<workspace-hash>--/session-*/session.v4.jsonl.zstd`（`zstd -dc` 解压后逐行读取）：

```json
{"type":"assistant/message","seq":17,"time":1793667060702,
 "data":{"turn":1,"step":1,"message":{"role":"assistant"},"stream":[],
         "usage":{"inputTokens":29229,"outputTokens":344,"totalTokens":60421,"cacheReadTokens":30848}}}
```

由此确认的三条口径（本需求全部按它实现）：

1. `inputTokens` = **未命中缓存**的新输入；`cacheReadTokens` = **命中缓存**的输入。
2. `totalTokens` = `inputTokens + cacheReadTokens + outputTokens`（29229 + 30848 + 344 = 60421），即 total 已含命中部分。
3. 同一批会话里**从未出现 `cacheWriteTokens`**（写缓存不上报）；`inputTokens/outputTokens/totalTokens` 全 0 的事件是合法的「0 用量」，必须显示 `0` 而不是「不可得」。

## 3. 字段映射

| 面板指标 | 宿主字段（真实形状） | 兼容别名 | `TokenTotals` | 展示文案 |
|---|---|---|---|---|
| 输入未命中 | `usage.inputTokens` | `input` / `promptTokens` / `prompt` | `input` | 千分位整数 |
| 输入命中 | `usage.cacheReadTokens` | `cacheRead` / `cacheReadInputTokens` / `promptCacheReadTokens` | `cacheRead` | 千分位整数 |
| 写缓存 | `usage.cacheWriteTokens`（当前不出现） | `cacheWrite` / `cacheCreationTokens` | `cacheWrite` | 千分位整数 / 不可得 |
| 输出 | `usage.outputTokens` | `output` / `completionTokens` / `completion` | `output` | 千分位整数 |
| 调用次数 | 无宿主字段（按事件计数） | `calls` / `callCount` / `requestCount` | `calls` | 千分位整数 |
| 缓存命中率 | 由 `cacheRead / (input + cacheRead)` 计算 | — | 不落盘（派生） | 一位小数，去 `.0` |

**调用次数为什么按事件计数**：宿主 usage 里没有计数器；一条 `assistant/message` 就是一次模型调用，因此 `usageOfSessionEvent` 在解析出数字后补 `calls = 1`（`src/host/team/usage.ts:119` `countCall`），`addTotals` 逐次累加。宿主将来若给出 `calls` 字段，字段值优先。

**total 的补法改了**：`totalTokens` 缺失时，旧实现是 `input + output`，会把命中缓存的部分漏掉；现在是 `input + cacheRead + output`（`src/host/team/usage.ts:64`、`src/host/store.ts:546` 同步）。

## 4. 代码改动（按链路顺序）

| 环节 | 文件:行 | 改动 |
|---|---|---|
| 类型契约 | `src/shared/types.ts:438` | `TokenTotals` 增 `cacheRead/cacheWrite/calls` |
| 类型契约 | `src/shared/types.ts:459` | 新增 `UsageMetric { key,label,text,available }`；`UsageCell.details?: UsageMetric[]`（`:487`） |
| 事件归一 | `src/host/team/usage.ts:64` | `tokenTotalsOf` 解析 `cacheRead/cacheWrite/calls` 及别名；total 含 cacheRead |
| 事件归一 | `src/host/team/usage.ts:143` | `usageOfSessionEvent` 两种宿主形状都补 `calls = 1` |
| 累加 | `src/host/team/usage.ts:95` | `addTotals` 逐项累加新字段（只在任一侧有时挂字段，不补 0） |
| 单元格 | `src/host/format.ts:124` | `usageCellOf` 保留新字段，并生成 `text`（合计）+ `details`（六项） |
| 单元格 | `src/host/format.ts:90`/`:101` | `formatCacheHitRate`、`usageMetricsOf`（六项唯一来源） |
| 落盘 | `src/host/store.ts:546` | `normalizeTokenTotals` 保留新字段（漏改会在重启重载时丢三项） |
| 客户端只读透传 | `src/client/viewmodel.ts:922` | `usageMetricsOf(cell)` 原样返回宿主 `details` |
| 客户端文案 | `src/client/viewmodel.ts:928` | `tokenTitleOf` 有 `details` 时展开六项；旧数据退回「合计/输入/输出」 |
| 客户端文本 | `src/client/viewmodel.ts:904` | `tokenTextOf` 优先用宿主 `text`（旧数据才自己分组） |
| 任务详情 | `src/client/viewmodel.ts:1115` | `taskDetailOf` 在 provider 时给 `usageMetrics`，unavailable 仍给 `usageReason` |
| 渲染 | `src/client/views/TaskTable.tsx:124` | 展开区渲染六项：`[data-usage-metric="input|cacheRead|cacheWrite|output|calls|hitRate"]` |
| 样式 | `src/client/styles.ts:2631` | 2 列 × 3 行网格；`data-available="false"` 用三级色区分「不可得」 |

### 链路（一处订阅、两处渲染）

```
宿主 session/event(session, event)            ← root + {global:true}（r13 修法，未改）
  → src/host/adapters.ts#onSessionEvents
  → src/host/team/usage.ts#usageOfSessionEvent   （两参 → UsageEventInput，补 calls=1）
  → src/host/index.ts#recordUsage             （bindings[].memberId / plan.sessionId 归属 + 去重）
  → src/host/team/usage.ts#applyUsage         （byMember/byTask/total 累加）
  → src/host/store.ts#save                    （normalize 后原子落盘）
  → src/host/bridge.ts#runUsageOf / taskUsageOf（生成 UsageCell.text + details）
  → GET /api/auto-team/snapshot               （runUsage / taskUsage）
  → viewmodel.tokenTitleOf / taskDetailOf     （只透传，不重算）
  → RunHeader / RoleCard / TaskTable / FlowCanvas
```

六项指标的展示位：

- **任务展开详情**（主要位置）：六行指标，`data-usage-metric` 逐项可断言。
- **title 提示**：run 头「成员合计」、任务行 token 单元格、流转节点 token、任务展开的用量行——只要宿主给了 `details`，title 就是 `合计 X token · 输入未命中 … · 缓存命中率 …`。
- **角色卡**（144px 宽）：只显示合计；其单元格由 `shared/role-view.ts#roleUsageCellOf` 聚合，不含 `details`，title 退化为「合计/输入/输出」。这是尺寸与单一来源的取舍，不是漏做。

## 5. 为什么历史 run 的 `usage` 全是 null（不能据此判链路坏）

已核实的运行态事实：

- 当前宿主进程启动于 2026-11-05 00:48:13；插件安装目录 `~/.dsh/profiles/desktop/node_modules/dsh-auto-team/lib/{index,client}.js` 的 mtime 是 **00:53:20**（晚于宿主启动）。即宿主启动时加载的是**更早的构建**，不是当前 HEAD（`608cb24`）的产物。
- 宿主不会热重载已加载的插件 bundle：覆盖文件后必须重启宿主才生效。
- 因此 11-04 ~ 11-05 的 6 个 run JSON（`~/.dsh/auto-team/runs/*.json`）`usage: null`、`routeAudits: []` 只能说明「旧 bundle 没送达事件」，**不能**证明当前源码的订阅/解析有问题；这两处修复（`0a20a43`、`00d2b55`）在 HEAD 的 `lib/index.js` 里均存在，且本次未被改动。

结论：链路代码本次只做「补字段 + 补六项 + 补落盘归一」，事件订阅与归属逻辑保持原样。

## 6. 真机验证（宿主重启后按顺序做）

> 由主 agent 执行（本任务不重启宿主）。

1. 重新装/覆盖 profile 并**重启宿主**，跑任意一个 run。
2. run 落盘文件出现用量（不是 null）：
   ```bash
   python3 -c "import json,glob;d=json.load(open(sorted(glob.glob('$HOME/.dsh/auto-team/runs/*.json'))[-1]));print(d['usage']['total'], d['usage']['attribution'])"
   ```
   期望：`total` 为数字、`attribution` 为 `per-member`（成员事件）或 `aggregate-only`（只有队长会话事件）。
3. 快照带六项明细：
   ```bash
   curl -s -b "<cookie>" 'http://127.0.0.1:<port>/api/auto-team/snapshot?sessionId=<id>' \
     | python3 -c "import json,sys;d=json.load(sys.stdin)['data'];print([(m['key'],m['text']) for m in d['runUsage']['details']])"
   ```
   期望六项：`input / cacheRead / cacheWrite / output / calls / hitRate`（`cacheWrite` 当前必为「不可得」，`hitRate` 在两侧都有数时是百分比）。
4. 面板：右栏「任务」页展开任一有流量的任务 → 用量行 2 列 × 3 行六项；鼠标悬停 run 头「成员合计」→ title 里六项齐全。
5. 回归：没有用量的 run 仍显示「不可得」+ 原因（不是 0）。

若第 2 步仍为 null，先确认宿主确实重启且加载的是新 bundle（对比 `lib/index.js` 的 inode/mtime 与进程启动时间），再查 `session/event` 订阅告警日志，不要先去改 `usageCellOf`。

## 7. 测试与门禁

新增/更新的断言：

- `test/format.test.ts`：六项顺序与文案、真实宿主样例（29,229 / 30,848 / 344 / 1 / 51.3%）、命中率边界（分母 0、缺一侧 → 不可得）、`text` 为合计。
- `test/usage.test.ts`：真实两参事件解析出 `cacheRead` + `calls:1`；`tokenTotalsOf` 别名与「total 缺失时含命中部分」；`normalizeUsage` 落盘保留 `cacheRead/cacheWrite/calls`；**端到端**：真实事件 → `applyUsage` → `store.save` → `store.load` → `runUsageOf` 六项一项不少，且 `taskUsageOf` 与 run 级同源。
- `test/viewmodel.test.ts`：`tokenTextOf` 优先宿主 `text`；title 展开六项；`usageMetricsOf` 只透传；`taskDetailOf` provider 带 `usageMetrics`、旧数据不伪造六项。
- `test/client-ui.test.ts`：展开区存在 `data-detail-usage` / `data-usage-metrics` / `data-usage-metric`（映射 `panel.usageMetrics`）。

门禁（本任务回执执行）：

```
pnpm typecheck    # exit 0
pnpm test         # 770 pass / 0 fail
pnpm build        # lib/index.js 460.74 kB、lib/client.js 437.50 kB
test -s docs/teamflow/2026-11-05-token-usage.md
```

附加自检：`node --input-type=module -e "await import('./lib/index.js')"` 与 `... './lib/client.js'` 均通过（双产物可加载，client 的 `window.__ModuleLoader__` 守卫保留）。

## 8. 已知边界

- **写缓存**：宿主当前不上报，面板恒为「不可得」；字段与渲染已就绪，宿主将来上报即可显示，无需再改客户端。
- **缓存命中率**：只在 `input` 与 `cacheRead` 都有数且分母 > 0 时给值；否则「不可得」。不拿 `total` 反推。
- **角色卡**：只显示合计（144px 放不下六项），聚合实现与宿主 `library.rolesOf` 共用 `role-view.ts`，两边文案不会分叉。
- **旧快照/旧数据**：`UsageCell` 无 `details` 时 title 退回「合计/输入/输出」，任务展开仍显示合计而不是伪造六项。
- **历史 run**：不回溯补数（落盘的 `usage` 为 null 就是没有事件，不估算）。
