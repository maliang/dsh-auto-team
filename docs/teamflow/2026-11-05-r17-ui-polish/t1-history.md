# t1：历史行顶部任务名 + 底部 token 六项（r17）

> 日期：2026-11-05 · 任务：t1 · 验收：`pnpm typecheck && node --test test/client-ui.test.ts test/format.test.ts`

## 1. 需求与交付边界

用户原话（r17 四项改造之一）：**「历史行顶部任务名 + 底部 token 六项」**。

拆成两条可验收事实：

1. **顶部 = 任务名**：右栏「历史」页每一行第一行标题必须是该 run 的任务名（run 级 `goal`），
   不再用项目名或 runId 冒充。没有 `goal` 的旧 run 走 `goalTitleOf` 的诚实 fallback
   （`未命名任务 · <runId 后 6 位>`）并打 `data-title-source="fallback"`。
2. **底部 = token 六项**：标题下方新增一行六项指标：输入未命中 / 输入命中 / 写缓存 /
   输出 / 调用次数 / 缓存命中率。文案**全部**来自宿主 `UsageCell.details`，客户端只逐项渲染。

不做的事：

- 不在客户端拆六项或重算命中率（六项文案的唯一来源是 `src/host/format.ts#usageMetricsOf`）。
- 不把派生字段落盘：run JSON 里仍然只有原始 `usageTotals`。
- 不新增路由、不改 `store.ts` 的落盘形状。

## 2. 宿主契约（唯一新增字段）

`src/shared/types.ts:667` 的 `RunSummary` 增加**可选**视图字段：

```ts
usage?: UsageCell   // 含 text（合计）+ details（六项，顺序固定）
```

- 为什么加在 `RunSummary` 而不是让客户端拿 `usageTotals` 自己算：六项文案（千分位、
  百分号、`不可得`）必须单点在宿主，否则历史页与任务页/角色卡会出现两套口径。
- 为什么可选：旧快照 / `LibraryView.runs` 没有该字段，客户端退化为只显示合计（见 §4）。
- `usageTotals` 保留不动（项目合计仍用它累加，`library.ts:431`）。

## 3. 宿主装配（派生、不落盘）

`src/host/bridge.ts:963-967` 的 `historyOf()` 在 5s memo 之前把每一条摘要映射一次：

```ts
.map((run) => ({ ...run, usage: usageCellOf(run.usageTotals, HISTORY_USAGE_REASON) }))
```

- `usageCellOf` 已存在（r17 t2 的六项实现）：有 `total` → `provider` + `text` + `details`；
  否则 `unavailable` + reason。新增常量 `HISTORY_USAGE_REASON = '宿主未上报本 run 的用量'`（`bridge.ts:110`，
  与 `library.ts` 的项目 run 行同一口径）。
- 不修改 `store.list()` 的返回对象（spread 生成新对象），落盘文件里仍只有 `usageTotals`。

## 4. 客户端

### 4.1 行视图 `src/client/tabs/rows.ts`

- `RunRowView` 新增 `usageMetrics: UsageMetric[]`（`:57`），由 `rowOf` 统一填
  `usageMetricsOf(input.usage)`（`:87`）—— 历史行与项目 run 行共用同一条取值路径。
- `runSummaryRowOf`（`:120`）：
  - 标题改为 `goalTitleOf(run.goal, run.runId)`，同时带 `titleSource/titleTitle`
    （超长仍 24 字截断 + 省略号，完整文本在 title 属性）。
  - 用量 `summaryUsageOf(run)`（`:104`）：**优先** `run.usage`（宿主派生的六项）；
    旧数据只有 `usageTotals` 时退回 `{source:'provider', tokens}` 只显示合计；
    两者都没有 → `unavailable` + `该次运行没有用量记录`。
- 旧 `now` 参数保留（既有调用方按位置传参），不再被使用。

### 4.2 渲染 `src/client/tabs/HistoryTab.tsx`

行结构从两行变三行（第三行仅在宿主给了六项时渲染）：

```
span[data-history-line="title"]   ← 任务名 + 状态徽标（标题带 data-title-source）
span[data-history-line="meta"]    ← 开始/结束/任务数 + 合计 token（既有 data-history-token 保留）
span[data-history-line="usage"]   ← r17 六项
  └ span[data-history-metric="input|cacheRead|cacheWrite|output|calls|hitRate"]
         data-usage-metric=<同一 key> · data-available="true|false"
         title="<label>：<text>"
         └ span[data-usage-metric-label] + b[data-usage-metric-value]
```

- 六项用 `<span>` 而不是 `<ul>/<li>`：整行是 `<button>`，button 内只能放 phrasing content。
- `data-available="false"` 是「宿主没上报」的唯一钩子，样式据此与真 `0` 区分
  （t3b 负责样式；本任务只保证钩子存在且可断言）。
- 合计 token 仍在 meta 行：`RunSummary` 没有总用时，合计与时间戳放一起读起来更顺；
  六项是明细，两者不冲突。

## 5. 降级与已知边界

| 数据形态 | 表现 |
|---|---|
| 新宿主：`RunSummary.usage` 有 `details` | 三行：任务名 / 时间·合计 / 六项 |
| 旧 run：只有 `usageTotals` | 两行：任务名 / 时间·合计；**不**自己拆六项 |
| 完全无用量 | 两行 + 合计显示「不可得」（`data-usage-source="unavailable"`），不是 0 |
| `library.runs` 回退路径（快照尚未到达） | 只有合计、无六项 |

最后一条是**已知边界**：`src/host/library.ts#buildLibrary` 的 `runs` 直接来自 `store.list()`，
不在本任务写域内（任务 writeScopes 未包含 `library.ts`），因此该回退路径未派生 `usage`。
真实面板常态走 `snapshot.runs`（`bridge.ts#historyOf`），不受影响；若要补齐，需在
`buildLibrary` 里做同样的 `.map(... usageCellOf ...)`（一行改动，留给后续任务/队长决定）。

## 6. 改动清单

| 文件 | 位置 | 改动 |
|---|---|---|
| `src/shared/types.ts` | `:685-691` | `RunSummary.usage?: UsageCell`（视图字段，不落盘） |
| `src/host/bridge.ts` | `:110` / `:963-967` | 新增 `HISTORY_USAGE_REASON`；`historyOf` 派生 `usage` |
| `src/client/tabs/rows.ts` | `:29-64` / `:87` / `:104-140` | `usageMetrics` 字段 + 标题改 goal + 用量三级降级 |
| `src/client/tabs/HistoryTab.tsx` | `:102-140` | 第三行渲染六项；标题带 `data-title-source` |
| `test/client-ui.test.ts` | `:739-830` | 4 条 r17 历史行断言（见 §7） |

## 7. 验收证据

命令与退出码：

```
pnpm typecheck                                        → exit 0
node --test test/client-ui.test.ts test/format.test.ts → exit 0，50 pass / 0 fail
node --test test/bridge.test.ts test/library.test.ts \
        test/client-contract.test.ts test/r16-library-open.test.ts → exit 0，110 pass / 0 fail
```

新增 4 条断言分别会在「实现回退」时变红：

1. `历史行（r17）：顶部是任务名（run goal），项目名不再冒充标题` —— 若把 `title` 改回
   `run.project ?? run.runId` 立即红（断言标题等于 goal）。
2. `底部六项原样透传宿主 details，客户端零重算` —— `deepEqual(row.usageMetrics, SIX_METRICS)`
   锁死六项的顺序与逐字文案（含「不可得」「51.3%」），客户端任何重算/裁剪都会红。
3. `旧数据只有 usageTotals → 只显示合计，不自己拆六项` —— 若有人用 `tokens` 在客户端拼六项，
   `usageMetrics.length === 0` 会红。
4. `HistoryTab 真的把六项渲染在标题下方` —— 源码级断言 `data-history-line="usage"` /
   `row.usageMetrics.map(` / 每项 `data-available`，把六项从视图里拿掉即红。

## 8. 给 t3b（样式收尾）的钩子清单

- 容器：`[data-region="history-list"] [data-history-line="usage"]` → `data-history-usage`
- 项：`[data-history-usage] [data-usage-metric]` → `data-history-metric="<key>"`
- 状态：`[data-history-usage] [data-available="false"]` → 与真 0 区分的三级色
- 标题来源：`[data-history-title][data-title-source="fallback"]`（可选，与左栏 run 行同语言）

注意：字号仍必须用 `font: var(--dsw-font-…, …)` 简写（AGENTS §4 铁律）。
