# r19 t1：右侧面板所有 token 值统一动态单位

> 日期：2026-11-05 · 任务：t1「token 值统一动态单位」 · 用户原话：「右侧面板中所有token值显示都要加动态单位」
>
> 写域：`src/host/format.ts`、`src/client/viewmodel.ts`、`test/format.test.ts`、`test/viewmodel.test.ts`、
> `test/client-ui.test.ts`、`test/usage.test.ts`、`test/library.test.ts`、本文件。
> 未改 styles / 组件 / nav / rows；未 build、未 commit。

## 1. 背景与口径

r18b 已把六项指标 `UsageMetric.text` 改成动态单位（`29.23K` / `1.00M`），但**合计** `UsageCell.text`
仍是逗号数字（`1,234,567`、`60,421`、`69,459`）。合计被面板七处渲染点共用，所以面板上同时存在
「29.23K」与「60,421」两种 token 口径。

本次把口径收到一个格式化点：

| 值 | 口径 |
|---|---|
| `< 1,000` | 原样整数（`999`、`0`、`1`） |
| `≥ 1e3` | `K`，固定两位小数（`60,421` → `60.42K`） |
| `≥ 1e6` | `M`，固定两位小数（`1,234,567` → `1.23M`） |
| `≥ 1e9` | `B`，固定两位小数（`1,500,000,000` → `1.50B`） |
| `999,999` | 进位成 `1.00M`（永不出现 `1000.00K`） |
| 缺失 / `NaN` / 负数 | `不可得`（不补 0、不带单位） |

## 2. 代码改动（两处）

### 2.1 宿主：`src/host/format.ts`

- `usageCellOf()`（`src/host/format.ts:174`）：`text: formatTokens(tokens.total)` →
  `text: formatTokenUnits(tokens.total)`。**不新增第二套格式化实现**，直接复用 r18b 已有的
  `formatTokenUnits`（`src/host/format.ts:85`）。
- `usageMetricsOf()`（`src/host/format.ts:149`）六项保持现状（四项已单位化；`calls` 仍是次数整数、
  `hitRate` 仍是百分比）。
- `formatTokens()`（`src/host/format.ts:47`）保留：仍服务 `calls`（调用次数）等**非 token 量**的整数展示，
  但不再是 `UsageCell.text` / `UsageMetric.text` 的口径；文件内注释已同步。
- 影响面：`usageCellOf` 被 `src/host/bridge.ts:982`、`src/host/team/usage.ts:359/366/369`、
  `src/host/library.ts:146/443/459` 复用，**改这一处即全链路生效**（run 头 / 角色卡 / 任务行 /
  流程图 / 历史行 / 项目库 / 成员页用的是同一份 `UsageCell`）。

### 2.2 客户端：`src/client/viewmodel.ts`

旧数据（没有 `cell.text`）的兜底路径改成同一算法：

- 新增私有 `tokenUnitsText()` + `CLIENT_TOKEN_UNITS`（与宿主 `TOKEN_UNITS` 同表）：跨端不能互相 import，
  靠两侧测试同表锁定（`test/format.test.ts` 与 `test/viewmodel.test.ts` 用同一组边界值）。
- `fullTokenText()` = `tokenUnitsText()`；`compactTokenText()` 也 = `tokenUnitsText()`：
  单位文本最长 7 字符（`999.99K`），仍落在旧的 7 字符宽度预算内，因此**保留「不截断数字」策略**，
  只把文本换成单位口径；原「一位小数小写 k」的 `oneDecimal` 实现已删除。
- `tokenTextOf()`：仍**宿主 `cell.text` 优先**，只有旧数据才走 `fullTokenText()`；
  `compactTokenTextOf()` 保留导出（当前 src 内无调用点，仅测试锁定）。
- `tokenTitleOf()` 的合计/输入/输出也走 `fullTokenText()`，悬停文本与单元格同口径。

## 3. 受影响渲染点清单

| # | 渲染点 | 数据来源（改动后） | 组件渲染处 |
|---|---|---|---|
| 1 | run 头「成员合计」 | `src/client/viewmodel.ts:1089` `runHeadOf().usageText` ← `tokenTextOf(detail.usage)` | `src/client/views/RunHeader.tsx:50` |
| 2 | 角色卡 | `src/client/viewmodel.ts:1115` `roleChipsOf().usageText` | `src/client/views/RoleCard.tsx:111` |
| 3 | 任务行（右栏任务页） | `src/client/viewmodel.ts:1150` `taskRowOf().tokenText` | `src/client/views/TaskTable.tsx`（`data-cell="token"`） |
| 4 | 任务行（左栏 nav） | `src/client/nav.ts:510` `tokenText: tokenTextOf(task.usage)` | `src/client/nav.ts` 任务行 |
| 5 | 流程图节点 | `src/client/viewmodel.ts:1368` `flowNodeViewOf()` ← `tokenTextOf(node.usage)` | `src/client/views/FlowCanvas.tsx` |
| 6 | 历史行总量 | `src/client/tabs/rows.ts:123` `runSummaryRowOf()` → `rowOf()`（`src/client/tabs/rows.ts:87`） | `src/client/tabs/HistoryTab.tsx:113` |
| 7 | 项目库用量 | 宿主 `src/host/library.ts:146/443/459` 产出 `UsageCell`；客户端 `src/client/LibraryPage.tsx:165/593`、`src/client/tabs/rows.ts:179` | `src/client/LibraryPage.tsx` |
| 8 | 成员页任务用量 | 成员页 `view.task.tokenText`（`rowOf` 同一派生链） | `src/client/views/MemberPage.tsx:98-99` |

> 说明：以上全部只渲染 `tokenTextOf()` 的返回值（或宿主 `UsageCell.text`），**没有任何组件再拼数字**；
> 因此改 `usageCellOf().text` 与客户端两个兜底函数即可覆盖全部 token 展示。

## 4. 边界值表（宿主与客户端兜底逐字一致）

| 输入（token） | 输出 | 备注 |
|---|---|---|
| `0` | `0` | 「花了 0 token」是真话，不加单位 |
| `1` | `1` | `< 1000` 原样整数 |
| `999` | `999` | 阈值前最后一位整数 |
| `1,000` | `1.00K` | 跨阈值即上单位、补两位小数 |
| `1,234` | `1.23K` | |
| `12,345` | `12.35K` | 四舍五入到两位 |
| `60,421` | `60.42K` | 真机 usage 的合计（29,229 + 30,848 + 344） |
| `69,459` | `69.46K` | 四舍五入：69.459 → 69.46 |
| `246,910` | `246.91K` | 两位小数四舍五入（任务单点名） |
| `999,999` | `1.00M` | 999.999K 进位到 `1.00M`，不出现 `1000.00K` |
| `1,000,000` | `1.00M` | |
| `1,234,567` | `1.23M` | |
| `999,999,999` | `1.00B` | 同样进位 |
| `1,000,000,000` | `1.00B` | |
| `undefined` / `NaN` / `-1` | `不可得` | 空白 cell 为 `source: 'unavailable'`，同样 `不可得` |
| 任意值 | 无科学计数法（`/e[+-]?\d/` 不命中）、无 `NaN`/`undefined` 字面量 | 测试锁定 |

## 5. 语义保证

- 只有 `source === 'provider'` 且 `tokens.total` 是可用数字时才出单位文本；
  `unavailable` 一律 `不可得`（不带 K/M/B、不带 `0`）。
- `0` 显示 `0`（不是 `0.00K`，也不是 `不可得`）。
- `calls` / `hitRate` 不套 token 单位（次数与百分比）。
- 旧数据（无 `cell.text`）走客户端兜底，口径与宿主逐字一致；有 `text` 时不重算。

## 6. 测试改动

| 文件 | 改动 |
|---|---|
| `test/format.test.ts` | `usageCellOf` 真实 usage 的合计断言 `60,421` → `60.42K`；**新增**「usageCellOf 合计 text 边界」用例：`0/1/999/1,000/999,999/1,000,000/1,234,567/999,999,999/1,000,000,000/246,910/69,459/60,421/12,345`、无科学计数法、缺失/NaN/负数 → `unavailable` |
| `test/viewmodel.test.ts` | token 文本断言改单位（`1,234,567` → `1.23M`、`12,345` → `12.35K`）；token title 合计 `1,000` → `1.00K`；六项 title 用例的宿主文案改真实值（`29.23K` / `30.85K` / 合计 `60.42K`）；紧凑文本改 `1.23K / 12.00K / 1.50M`；**新增**「旧数据兜底」用例（边界 + 四舍五入 + `unavailable` 不带单位）；任务行 `12.35K`、流程图 `1.23M`（含 title/label）、角色条 `3.50K`、run 头 `1.23K` |
| `test/client-ui.test.ts` | `SIX_CELL.text` 与历史行 `tokenText` → `60.42K`（宿主文案透传不变）；旧数据兜底 `1,234` → `1.23K`；`不可得` 分支保留；注释从「合计仍是千分位」改为 r19 口径 |
| `test/usage.test.ts` | 端到端落盘再读回的 `cell.text` → `60.42K` |
| `test/library.test.ts` | 项目库历史回退列表 `cell.text` → `1.23K`；`details` 的 `1.00K` 保持 |

> 断言均为**逐字相等**（`assert.equal`/`deepEqual`），没有放宽成「包含 K」。

## 7. 门禁输出

```text
$ pnpm typecheck
> tsc --noEmit
typecheck exit=0

$ node --test test/format.test.ts test/viewmodel.test.ts test/client-ui.test.ts test/usage.test.ts test/library.test.ts
ℹ tests 165
ℹ suites 0
ℹ pass 165
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
gate exit=0
```

## 8. 未真机验证声明

本次**只跑了 typecheck + 上述五个测试文件**：没有构建双产物、没有装进 profile、没有在真机面板里用
肉眼/截图确认新文案的排版（例如 `246.91K` 在任务行 76px 单元格与流程图 128px 节点内是否仍不换行）。
样式相关风险（单位文本长度从 9 字符 `1,234,567` 降到 5 字符 `1.23M`，总体只会更短）未做像素级验证。

## 9. 残留点与超出写域的问题（只报告，未改）

### 9.1 仍有 token 文案不走这两种函数（写域内但按指令不动）

- `src/client/viewmodel.ts:1595` `memoryRowOf()`：`tokenText: \`≈${groupDigits(String(estimate))} token\``
  —— 记忆行的**估算值**仍是逗号数字（`≈1,234 token`）。它不是 provider 上报的 `UsageCell`，
  也不在本次点名的七处渲染点里，故保持原样；若要求「面板所有 token 数字」都单位化，需要单独一轮
  （改成 `≈1.23K token` 只改这一行 + `test/viewmodel.test.ts` 的对应断言）。

### 9.2 注释过期（写域外）

- `src/shared/types.ts:484`：`UsageCell.text` 注释仍写「`1,234` / `不可得`」，实际已是 `1.23K`。
  仅注释，建议随下一次触碰该文件时更新。

### 9.3 写域外的测试会因本次口径变更而变红（需 lead 处理）

全量 `node --test test/*.test.ts`：`893 tests / 891 pass / 2 fail`，两处都在本次写域之外：

| 文件:行 | 现状 | 需要改成 |
|---|---|---|
| `test/bridge.test.ts:661` | `assert.equal(usage.text, '60,421', '合计文本由宿主生成')` | `'60.42K'`（actual 已是 `60.42K`） |
| `test/r16-flow-canvas.test.ts:229` | `assert.match(cell.tokenText, /1,230/, 'token 原串，不四舍五入')` | `/1\.23K/`（actual `1.23K`；fixture `usage` 未给 `text`，走客户端兜底） |
| `test/r16-flow-canvas.test.ts:235` | `assert.match(cell.label, /token 1,230/)` | `/token 1\.23K/` |

其余写域外测试（`test/member-page.test.ts`、`test/run-switcher.test.ts`、`test/r18-run-cards.test.ts` 等）
用的是自带 `text` 的 `UsageCell` fixture 或对同一字段自比较，透传语义不变，未受影响。
