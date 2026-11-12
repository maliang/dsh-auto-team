# r18b T6 — 六项指标里的 token 数量带动态单位（K/M/B，两位小数）

日期：2026-11-05 · 任务：r18b t6（宿主格式化）· 写域：`src/host/format.ts`、相关测试、本文件。
按指令**未** build、未 commit；未触碰 `src/client/**`、`styles.ts`、`nav.ts`、`RunSwitcher.tsx`、`viewmodel.ts`。

## 1. 需求

右栏 token 六项（input / cacheRead / cacheWrite / output / calls / hitRate）里的**四个 token 数量**
带上动态单位、固定两位小数；calls 仍是次数、hitRate 仍是百分比；总量 `UsageCell.text` 保持现状。

## 2. 规则表

`formatTokenUnits(n)`（`src/host/format.ts`，纯函数、已导出）：

| 输入区间 | 单位 | 小数位 | 样例 |
|---|---|---|---|
| `0 – 999` | 无（原样整数） | 0 | `0` / `999` |
| `1,000 – 999,999` | K | 2 | `1,000 → 1.00K`、`1,234 → 1.23K`、`34,930 → 34.93K`、`69,459 → 69.46K` |
| `1,000,000 – 999,999,999` | M | 2 | `1,500,000 → 1.50M`、`2,000,000 → 2.00M` |
| `≥ 1,000,000,000` | B | 2 | `1,000,000,000 → 1.00B` |

边界与取整：

- 先 `Math.round` 到整 token，再套单位；
- 四舍五入进位跨阈值时**顺延到上一级**，界面上不会出现 `1000.00K`：
  `999,999 → 999.999K → toFixed(2) = "1000.00" → 改判 1.00M`；同理 `999,999,999 → 1.00B`；
- 非法/缺失（`null` / `undefined` / `NaN` / 负数）→ `不可得`，不伪造数值；
- 与既有 `formatCompactTokens`（一位小数、小写 `k`，服务 128px 节点第二行）**并存不合并**：
  后者是 r13 的历史口径，本次不动，两者各有测试锁定。

## 3. 改动点

| 文件:位置 | 改动 |
|---|---|
| `src/host/format.ts:61` | 新增 `TOKEN_UNITS` 阶梯 + `formatTokenUnits`（导出供单测） |
| `src/host/format.ts` `usageMetricsOf` | 前四项 `input/cacheRead/cacheWrite/output` 改走 `formatTokenUnits`；`calls` 仍 `formatTokens`、`hitRate` 仍 `formatCacheHitRate` |
| `src/host/format.ts` `usageCellOf` | **未改**：`text: formatTokens(tokens.total)` 仍是千分位整数（`60,421`） |
| `test/format.test.ts` | 新增 `formatTokenUnits` 边界用例（0/999/1000/1234/34930/69459/999999/1e6/1.5e6/2e6/1e9/999999999/非法）；六项真实样例期望改为 `29.23K / 30.85K / 0 / 344 / 1 / 51.3%`，并加断言 `cell.text === '60,421'` 锁住范围 |
| `test/library.test.ts` | details 的 input 期望 `1,000` → `1.00K`；`cell.text` 仍断言 `1,234`（总量不动） |
| `test/usage.test.ts` | 端到端六项期望 `29,229/30,848` → `29.23K/30.85K`（calls `1`、hitRate `51.3%` 不变） |
| `test/client-ui.test.ts` | `SIX_METRICS` 夹具同步成宿主新输出（`29.23K/30.85K`），tokenTitle 正则同步；客户端逻辑零改动 |
| `test/bridge.test.ts` | 同一份宿主 `usageCellOf` 输出的 deepEqual 期望同步（不在指定门禁列表，但不改必红，属同一改动的必要连带） |

`available` 语义未变：仍由 `text !== UNAVAILABLE_TEXT` 判定，`cacheWrite: 0` 显示 `0` 且 `available:true`。

## 4. 门禁结果

```
node --test test/format.test.ts test/library.test.ts test/client-ui.test.ts test/usage.test.ts
# exit 0 · tests 87 / pass 87 / fail 0（2026-11-05 11:2x）
```

```
pnpm typecheck
# exit 2 —— 全部 5 条错误在 test/r18-run-cards.test.ts：
#   TS2305 nav.ts 无 RunSwitcherView / runSwitcherOf；TS7006 ×2；TS2353 'onBack'
# 属并行任务（RunSwitcher/nav）尚未落盘，与 t6 改动无关；
# 本任务涉及的 src/host/format.ts 与四个门禁测试 **零 TS 错误**（过滤上述文件后 grep 结果为空）。
```

连带回归（非门禁、但受本次改动影响）：`node --test test/bridge.test.ts test/usage-projection.test.ts test/viewmodel.test.ts`
→ exit 0 · 139 pass / 0 fail。

## 5. 未做事项（有意）

- **总量 `UsageCell.text` 不加单位**：按指令保持千分位整数（`60,421`），tasks/run 头等所有用它的地方行为不变。
- **每项 title（精确值 + 单位）未落**：`UsageMetric` 无 `title` 字段，客户端（`HistoryTab.tsx` / `TaskTable.tsx`）
  只渲染 `metric.text`；要显示「输入未命中：34,930（34.93K）」必须改 `src/shared/types.ts` 与 `src/client/**`，
  均在本次写域之外。精确值本身仍在 `UsageCell.tokens` 里未丢失；现有悬停文本由
  `viewmodel.tokenTitleOf` 用六项 text 拼出（自动变成带单位版本），属于客户端域的后续任务。
- 未 build、未 commit（按指令）。
