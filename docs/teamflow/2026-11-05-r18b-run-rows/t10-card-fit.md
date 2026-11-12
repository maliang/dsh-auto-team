# r18b t10 — 96–108px 卡内做到「辅助信息零截断」：六项回到格内上下两行

- 任务夹：`docs/teamflow/2026-11-05-r18b-run-rows/`
- 任务：r18b t10（run 卡真机截断修复）
- 写域：`src/client/views/RunSwitcher.tsx`、`src/client/styles.ts`、
  `test/r18-run-cards.test.ts`、`test/r18-styles.test.ts`、本文件
- 未改：`nav.ts`（`activeRunRowsOf`）、`viewmodel.ts`、`tabs/rows.ts`、`TasksTab.tsx`、
  `test/r17-styles.test.ts`、`test/client-ui.test.ts` —— 数据投影、卡宽（216px）、
  三行结构、全部钩子与状态位都不变，本次只改六项的**格内排布**与行高/间距。
- 上游：t9 把卡从 130px 压到 96px，做法是「六项每格 label + value 同一行」。
  真机（216×96 卡）实测六项**全部被省略号截断**，用户明确要求「其他辅助信息要显示全」，
  故 t10 回退为「同一格内上下两行」，靠行高/间距/内边距把卡压在 96–108px。

## 1. 真机实测证据（t9，必须修）

真机侧栏 216×96 卡里，六项逐条被截断（原文）：

```
输入未命中 246.…
输入命中 2
写缓存 0
输出 12.3.…
调用次数 不…
缓存命中率 7
```

- 数值与标签**都读不全**：`246.91K` → `246.…`、`12.3K` → `12.3.…`、
  `不可得` → `不…`、`78%` → `7`、5 字标签「输入未命中」也被压。
- 根因：t9 每格是 `display:flex; align-items:baseline` 的**同一行**，
  列宽只有 `(216 - 3 竖条 - 1 边框 - 16 内边距 - 3×2 列距) / 3 ≈ 63.3px`，
  而「5 个 11px 汉字（55px）+ 2px 间距 + 值」远大于 63.3px；
  再叠加 `text-overflow: ellipsis; overflow: hidden`，浏览器就把标签/值都裁了。
- 结论：**同一行**在 63px 列宽里不可能同时完整显示「输入未命中」和「246.91K」，
  不是字号或列距能救的（列距已是宿主 token 允许的最小 3px）。

## 2. 目标与结果

| 项 | t9（真机截断） | t10 |
|---|---|---|
| 卡高 | min-height 96，内容 96 | min-height 96，**自然高度 106**（96–108 区间） |
| 六项每格 | label + value **同一行** | label 上 / value 下 **两行** |
| label | 11px / 16px，ellipsis | 11px / **12px**，nowrap，**无 ellipsis、无 overflow:hidden** |
| value | 11px/600，ellipsis | 11px/600 tabular，**13px 行高**，**无 ellipsis、无 overflow:hidden** |
| 列宽 | 63.3px | 63.3px（不变） |
| 信息量 | 截断 | **零截断**：`输入未命中` / `246.91K` / `不可得` / `78%` 全显示 |
| 结构/钩子 | L1 header + meta + 六项 | 完全不变（三行、6 个 metric、卡内零 div） |

## 3. 新排版（DOM 不变，只换 CSS）

```
button[data-active-run]                        (216px，min-height 96，padding 6px 8px)
 ├─ span[data-active-run-head]                 ← L1：标题 13px/600 + 18px 状态徽标同一行
 ├─ span[data-active-run-meta]                 ← L2：11px/13px，单行省略，title 兜全文
 └─ span[data-active-run-usage]                ← L3：grid 3 列 × 2 行
     └─ span[data-active-run-metric]           ← display:flex; flex-direction:column
         ├─ span[data-active-run-metric-label] ← 上：11px/12px 三级色，nowrap
         └─ b[data-active-run-metric-value]    ← 下：11px/13px 600 tabular，nowrap
```

- 卡内仍**零 div**（`button` 只允许 phrasing content，tag 集合仍是 `{span, b}`）。
- 标签与值仍是两个元素（`span` + `b`）；JSX 里原来的 `{' '}` 保留，
  flex 容器会丢弃纯空白文本节点（不占宽），但复制/可访问文本仍是「标签 值」。
- 每格 `title={`${label}：${text}`}` 保留：视觉零截断之外，悬停/读屏仍有完整原文。

## 4. 高度账（实际 106px，落在 96–108）

```
上边框                                  1
上内边距                                6
L1 header（标题 13px/18px，徽标 18）   18
块间距 gap                              3
L2 meta（11px/13px）                   13
块间距 gap                              3
L3 六项                                55   = 上虚线 1 + padding-top 2
                                              + 两行 (label 12 + value 13) × 2
                                              + 格子行距 2
下内边距                                6
下边框                                  1
──────────────────────────────────────────
合计                                  106
```

- 只写 `min-height: 96px`，不写 `height`：meta 变长或六项内容变长时卡可以自然长高，
  不裁字（用户要求「辅助信息要显示全」，宁可长高也不省略）。
- 与 t9 相比，指标区从 38px 涨到 55px（+17），省下来的是：
  标题行 `20 → 18`（-2）、meta `16 → 13`（-3）、块间距 `4 → 3`（-2）、
  六项 `padding-top 3 → 2`（-1）。净增约 +9px，**总高 96 → 106**，仍在 96–108 内。
- 为什么不是 96：在 11px 字号 + 2px 行距下，两行 12/13 + 格子行距 2 已经是最紧的可读排布；
  再压只能砍行高（12 → 11 会切掉汉字下缘）或砍间距，等于用可读性换 10px，不划算。

## 5. 为什么不能用「同一行」

- 63.3px 列宽要同时装 label（最长 55px）和 value（最长约 42px）+ 间距 2px ≈ 99px，
  超出 36px；任何 `flex-shrink` / `min-width: 0` 都会把超出部分交给 ellipsis。
- 竖排后两行各自独占整列宽：55px ≤ 63.3px、42px ≤ 63.3px，**还各有 8–21px 余量**，
  所以不需要任何省略规则——这也是本次删除 label/value 的 `text-overflow` 与
  `overflow: hidden` 的原因（留着它们等于给未来的长文案埋同一个坑）。
- 保留 `white-space: nowrap`：防止宿主下发更长标签时折行把卡撑高；
  真出现超宽文案时宁可溢出/靠 `title`，也不静默截断（用户口径优先）。

## 6. 选择器与声明：改了什么

`src/client/styles.ts`（`[data-region="run-switcher"]` 块内）：

- 卡：`gap: 4px` → **`3px`**；`min-height` 仍 96。
- 标题：新增 `line-height: 18px`（token `--dsw-font-xs-13` 自带 20px）。
- meta：新增 `line-height: 13px`。
- 六项容器：`padding-top: 3px` → **`2px`**；`gap: 2px 3px` 不变（行距 2 / 列距 3）。
- 每格：`display:flex; align-items:baseline` → **`flex-direction: column`**、
  `align-items: flex-start`，删除 `gap: 2px`。
- label：`flex: 0 0 auto` 保留；**删除** `overflow: hidden` 与 `text-overflow: ellipsis`；
  新增 `line-height: 12px` 与显式 `font: var(--dsw-font-xxxs-11, 11px/12px sans-serif)`。
- value：`flex: 0 1 auto; min-width: 0` → **`flex: 0 0 auto`**；
  **删除** `overflow: hidden` 与 `text-overflow: ellipsis`；新增 `line-height: 13px`。
- 注意声明顺序：`font` 简写会重置 `line-height`，label/value 的 `line-height`
  都写在 `font` **之后**（否则真机上会被 token 的 16px 行高覆盖，卡又长回 110px+）；
  单测里加了「line-height 必须在 font 之后」的顺序断言。

保留不动：`data-active-run`、`data-run-id/-current/-selected/-ongoing`、
`data-active-run-title/-status/-meta/-usage`、`data-active-run-metric/-metric-label/-metric-value`、
`data-available`、`data-available="false"` 的虚线 + 三级色 + 400、
当前 run 左侧竖条、选中淡底 + 内描边、focus/disabled、fallback 零规则、reduced-motion。

## 7. 测试同步（改了哪条、为什么不是放宽）

`test/r18-styles.test.ts`：

- 卡几何：`min-height 96–104` → **96–108**；`gap [4]` → **[3]**；
  新增标题 `line-height 18`、meta `line-height 13`。
- 320px 算术：卡宽/间距/露出量断言不变（216 + 8 → 露出 88px）；
  列宽仍按 `(196 - 6)/3 ≈ 63.3px` 计算，但判据从「放得下 3 字标签 + 值同行」
  改成 **`≥ 60px`、`≥ 55px`（最长 5 字标签）、`≥ 42px`（最长值）**，
  并补一条任务书口径 `(216 - 16 - 2×3)/3 ≥ 60`。这是判据跟着「零截断」目标走，不是放宽。
- 六项：`flex-direction: column` 从「必须没有」改回「**必须有**」；
  删除 `align-items: baseline` 断言，改断 `flex-start`；
  label/value **反向断言**不得含 `text-overflow`、不得含 `overflow: hidden`；
  label 行高 12、value 行高 13；两者都必须有 11px 字号 token。
- 新增「高度账」测试：从声明值求和（边框 + padding + 标题行 + meta 行 + 2×块间距 +
  六项 = 虚线 1 + padding-top 2 + 2×(12+13) + 行距 2），断言自然高度 = **106** 且落在 96–108。

`test/r18-run-cards.test.ts`：

- 六项结构断言不变（仍是 6 个 `span[data-active-run-metric]`、顺序固定、
  每格 `[span, b]`），追加「第一个是 label、第二个是 value」与「文案里不许出现 `…`」。
- 新增「真机最长文案原样进 DOM」：用 t9 被截断的六项原文做夹具
  （`输入未命中/246.91K`、`输入命中/2`、`写缓存/0`、`输出/12.3K`、
  `调用次数/不可得`、`缓存命中率/78%`），断言 label、value、整格文本与 `title`
  逐一等于宿原文，DOM 文本里不出现省略号。
- 其余（当前/选中正交、320px 露第二张、零 div、旧钩子清零、投影纪律）未改。

## 8. 门禁输出

```bash
$ pnpm typecheck
> dsh-auto-team@0.1.0 typecheck
> tsc --noEmit
（exit 0）

$ node --test test/r18-run-cards.test.ts test/r18-styles.test.ts test/r17-styles.test.ts test/client-ui.test.ts
ℹ tests 71
ℹ pass 71
ℹ fail 0
（exit 0）
```

## 9. 未真机复验声明

本任务**没有**在真实宿主里打开面板截图复核。106px 是按 CSS 盒模型逐项相加推导出来的，
不是实测值；`246.91K` / `输入未命中` 是否真的零截断，依据是字符宽度估算
（11px × 5 汉字 = 55px < 列宽 63.3px）与「已删除全部省略规则」这两点。

需要真机确认：

1. 实际卡高是否落在 96–108px（浏览器对行盒/边框的取整可能 +1–2px）；
2. 5 字标签「输入未命中」与 7 字符值「246.91K」在真实字体度量下是否仍小于 63.3px
   （若宿主 UI 字体不是全角 1em，结论只会更宽裕）；
3. 竖排后相邻两行（上格 value 13px、下一格 label 12px）在 2px 格子行距下是否显得粘连；
4. 18px 标题行与 18px 状态徽标同行的垂直居中观感。
