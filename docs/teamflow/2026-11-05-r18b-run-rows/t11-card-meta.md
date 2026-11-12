# r18b t11 — 卡内 meta 行改「紧凑全文」：196px 里能看全「任务 d/t」

- 任务夹：`docs/teamflow/2026-11-05-r18b-run-rows/`
- 任务：r18b t11（run 卡 meta 行真机截断修复）
- 写域：`src/client/nav.ts`、`src/client/views/RunSwitcher.tsx`、
  `test/run-switcher.test.ts`、`test/r18-run-cards.test.ts`、本文件
- 未改：`src/client/styles.ts`（卡宽 216 / 内边距 8 / meta 的 nowrap + ellipsis 规则一字未动）、
  `viewmodel.ts`、`tabs/rows.ts`、`TasksTab.tsx`、`shared/types.ts`
  —— 历史列表与左栏继续用完整文案 `metaText`，本次只动**卡内**那一行。
- 上游：t10 已把卡压到 216×107、六项零截断；剩下最后一处截断是 meta 行。

## 1. 真机实测证据（t10 之后，必须修）

真机侧栏实测：卡 216×107，六项（输入/缓存读/写缓存/输出/调用/命中率）已零截断；
但 meta 行仍是历史列表的长文案，在 196px 内容宽里被省略号截断：

```
开始 11-05 13:35:00 · 结束 进行中 · 任务 0/1
```

- 探针量到 `metaClipped = true`；可见部分只剩「开始 11-05 13:35:00 · 结束 进行…」，
  **「任务 0/1」完全看不到** —— 而「还剩几个任务」正是这条卡最该给的信息。
- 根因是**文案长度**不是排布：`[data-active-run-meta]` 本来就是
  `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`（t10 未动），
  长文案必然裁。改 CSS 无用（折行会把卡撑高、破坏 96–108px 预算），只能换文案。
- 该行完整原文已经放在 `title` 上，所以「压制正文不放宽信息量」是安全的：
  悬停/读屏仍能拿到原始「开始/结束/任务」三段。

## 2. 两种文案格式（只在投影里格式化一次）

`nav.ts` 新增 `cardMetaTextOf(run)`（`src/client/nav.ts:293`）：

| 形态 | 判定 | 文案 | 例 |
|---|---|---|---|
| 未结束 | `finishedAt` 缺失 / 非正数 / NaN | `${formatClock(start)} 起 · 进行中 · 任务 ${done}/${tasks}` | `13:35:00 起 · 进行中 · 任务 0/1` |
| 已结束 | `finishedAt` 是正数 | `${formatClock(start)} → ${formatClock(finishedAt)} · 任务 ${done}/${tasks}` | `13:35:00 → 13:58:12 · 任务 1/1` |

- `start = run.plannedAt ?? run.createdAt`（与 `runSummaryRowOf` 同口径）。
- `done` / `tasks` 由 `countOf()` 兜底（`src/client/nav.ts:278`）：缺失 / NaN / 负数 / 非数字 → `0`，
  所以界面上**不会**出现 `NaN`、`undefined`、`0/undefined`。
- `formatClock` 从 `./viewmodel.ts` 导入（`src/client/nav.ts:33`）—— 客户端没有第二套时钟格式化。
- 已结束但 `finishedAt` 是 `0 / NaN / -1` 时按「未结束」处理：否则 `formatClock` 会给出 `—`，
  变成 `13:35:00 → — · 任务 1/2` 这种「有个终点但读不出」的破文案。
- 单一格式化点：组件不拼字符串，`ActiveRunRow.cardMetaText` 是必填字段
  （`src/client/nav.ts:228`），漏传会被 `tsc` 拦下。

## 3. 宽度预算（196px 内容宽 / 11px 字号 / tabular-nums）

内容宽 = `216 - 3（当前 run 左竖条）- 1（右/上边框）- 16（左右内边距 2×8）` = **196px**
（与 t10 的列宽账同源）。

| 态 | 字符数（最长现实值） | 逐段估算 | 合计 |
|---|---|---|---|
| 未结束 `13:35:00 起 · 进行中 · 任务 0/1` | 8 + 2 + 3 + 3 + 3 + 3 + 3 = 25 | 8 数字(≈6.6) 52.8 + ` 起` 14 + ` · ` 9.8 + `进行中` 33 + ` · ` 9.8 + `任务 ` 25 + `0/1` 19.8 | **≈164px** |
| 已结束 `13:35:00 → 13:58:12 · 任务 1/1` | 8 + 3 + 8 + 3 + 6 = 28 | 52.8 + ` → ` 17 + 52.8 + 9.8 + 25 + 19.8 | **≈177px** |
| 最坏（两位计数）`… · 任务 12/34` | 30 | 上两行各 + ≈12 | **≈176–190px** |

- 两种形态都 < 196px：未结束余 ≈32px，已结束余 ≈19px，两位计数的最坏情况余 ≈6px。
- 长度上限因此写成 **≤28 字符**（两个 8 字符时钟的最短形态），单测按此防回归；
  一旦有人把 `formatStamp`（多 6 字符日期）塞回卡内，测试立刻红。
- 为什么不用「相对时间」（`3 分钟前`）：卡的语义是「这条 run 什么时候开始的」，
  绝对时钟才对账；相对时间还会每分钟变一次文案，制造无谓重排。

## 4. 改动点

| 文件 | 改动 |
|---|---|
| `src/client/nav.ts` | 新增 `countOf`（计数兜底）、`cardMetaTextOf`（唯一格式化点）；`ActiveRunRow` 新增**必填** `cardMetaText: string`；`activeRunRowsOf` 的行对象补 `cardMetaText: cardMetaTextOf(run)`（`src/client/nav.ts:343`）；导入 `formatClock`。`metaText` 继承自 `RunRowView`，一字不改（历史列表/左栏继续用）。 |
| `src/client/views/RunSwitcher.tsx:80` | `<span data-active-run-meta title={row.metaText}>{row.cardMetaText}</span>` —— 正文贴紧凑全文，`title` 仍是完整历史文案；`data-active-run-meta` 钩子、nowrap/ellipsis 规则、三行结构与全部状态位不变。 |

`lib/client.js` 未重新构建（本任务明确不 build）：仓库里的 `lib/` 仍是 t10 的产物，
面板要看到本次改动需由 lead 统一 `pnpm build`。

## 5. 测试同步（改了哪条、为什么不是放宽）

`test/run-switcher.test.ts`（投影层，+4 例）：

- 新增「未结束逐字」：`clockOf(T1)` 由**测试自己**按「本地时间 + 两位补零」独立推导
  （刻意不 import 被测的 `formatClock`，否则等于用被测逻辑证明被测逻辑），
  断言 `13:35:00 起 · 进行中 · 任务 2/3` 全文 + 正则 + `≤28` 字符。
- 新增「已结束逐字」：`09:00:00 → 10:00:00 · 任务 3/3`，并反向断言**不含**「进行中」。
- 新增「缺失字段兜底」：`plannedAt: undefined` 退回 `createdAt`、`done/tasks: undefined` → `0/0`，
  反向断言不含 `NaN` / `undefined`。
- 新增「`finishedAt` 非正数按未结束」：`0 / NaN / -1` 三值循环，断言文案不出现 `→` 与 `—`。
- 组件接线：追加 `title={row.metaText}>{row.cardMetaText}` 源码断言。

`test/r18-run-cards.test.ts`（真实元素树）：

- **改了 1 条既有渲染断言**：`卡内文案全部来自 RunRowView` 里
  `textOf(meta) === base.metaText` → `textOf(meta) === row.cardMetaText`。
  **为什么不是放宽**：可见文本的目标值确实换了（这正是本任务的目的），但同一行
  紧接着新增了更严的约束 —— `meta.props.title === base.metaText` 且 title 必须匹配
  `^开始 .+ · 结束 .+ · 任务 \d+/\d+$`。即「正文变短」由「title 持有完整原文」补偿，
  两者是**一对**断言，信息量不减。
- 新增独立一例 `r18b t11`：未结束走进行中视图、已结束走 fallback 视图（只显示最后一个 run），
  对每张卡断言：正文逐字等于 `cardMetaText`、`title` 逐字等于 `metaText` 且含「开始/结束/任务」
  三段、两者不相等、`cardMetaText.length ≤ 28`、DOM 文案不含 `…`。
- 源码正则 `\{row\.metaText\}` → `title={row.metaText}>{row.cardMetaText}`（同上，配对新约束；
  它从「正文用长文案」变成「正文用紧凑文案 + title 用长文案」，也是收紧而非放宽）。

其余断言（卡数/横滑/点击/busy/六项/零 div/JSON 钩子）未动；`test/r18-styles.test.ts`
与样式文件都没改，meta 的 `white-space: nowrap`、`text-overflow: ellipsis`、
`font-variant-numeric: tabular-nums`、`line-height: 13px` 断言照旧通过。

## 6. 门禁输出

```bash
$ pnpm typecheck && node --test test/run-switcher.test.ts test/r18-run-cards.test.ts test/r18-styles.test.ts test/client-ui.test.ts

> dsh-auto-team@0.1.0 typecheck
> tsc --noEmit
（无输出）

✔ cardMetaText：未结束是「<HH:MM:SS> 起 · 进行中 · 任务 d/t」逐字
✔ cardMetaText：已结束是「<start> → <finishedAt> · 任务 d/t」逐字（不再出现「进行中」）
✔ cardMetaText：done/tasks 缺失按 0 兜底、plannedAt 缺失退回 createdAt，不出现 NaN/undefined
✔ cardMetaText：finishedAt 为非正数/NaN 时按「未结束」处理，不渲染一个破折号终点
✔ r18b t11：卡内 meta 是紧凑全文（≤28 字符、两种形态），title 是完整历史文案
…
ℹ tests 82
ℹ pass 82
ℹ fail 0
（exit 0）
```

## 7. 未真机复验声明

本任务**没有**在真实宿主里重新打开面板截图复核（不 build、不跑第二宿主）。

- 证据链是：真机给出的截断原文（§1）+ 段落宽度估算（§3）+ 单测里「≤28 字符、无省略号」。
- §3 的像素是按 `11px 字号、CJK 1em、数字 ≈0.6em` 估的，**不是浏览器实测**；
  真实字体度量决定余量（未结束余 32px、已结束余 19px，最坏两位数计数余约 6px）。
- 需要真机确认（下一轮 `window.measure` 探针应给出 `metaClipped=false`）：
  1. 未结束卡 meta 是否整行显示、右端是否还有可见余量；
  2. 已结束卡（`→` 形态）在 196px 内是否仍不触发省略号（这是最紧的一种）；
  3. 两位任务数（`任务 12/34`）是否仍放得下 —— 这是唯一余量 < 10px 的情况，
     若真机溢出，退路是去掉「 起」或把 `→` 改成 `-`，而不是改回长文案。

## 真机复验（2026-11-05 14:16，dv/51890）

- 构建 `lib/client.js` 505,509 B；4 条临时合成 run（截后已删）。
- 卡 216×107；标题 `600 13px / 18px`；六项 `flex-direction: column`、`11px / 12px`。
- 六项逐项 `scrollWidth <= clientWidth`：**0 项截断**（含最长 `输入未命中 / 246.91K`、`缓存命中率 / 79.8%`）。
- meta 文本 `13:35:00 起 · 进行中 · 任务 0/1`，`metaClipped = false`；完整 `开始 … · 结束 … · 任务 …` 仍在 `title`。
- 截图：`docs/teamflow/2026-11-05-r18b-run-rows/r18f-card-compact.png`。
