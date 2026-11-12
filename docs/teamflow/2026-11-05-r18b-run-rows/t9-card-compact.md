# r18b t9 — run 卡压到 96px：标题第一层、辅助信息一个不丢

- 任务夹：`docs/teamflow/2026-11-05-r18b-run-rows/`
- 任务：r18b t9（run 卡紧凑化）
- 写域：`src/client/views/RunSwitcher.tsx`、`src/client/styles.ts`、
  `test/r18-run-cards.test.ts`、`test/r18-styles.test.ts`、本文件
- 未改：`nav.ts`（`activeRunRowsOf`）、`viewmodel.ts`、`TasksTab.tsx`、`test/r17-styles.test.ts`
  —— 数据投影与卡宽（216px）不变，只换卡内排版。
- 上游：t8 的卡（216×130 真机实测）是「标题 | 徽标 // meta // 六项 3 列 × 2 行」，
  六项每格 label 上、value 下（两行），指标区实测约 60px。用户反馈（原文）：

  > 任务卡高度可以再小一些，以任务名称显示为主其他辅助信息要显示全，你看一下怎么排版好一些

## 1. 目标与结果

| 项 | t8 | t9 |
|---|---|---|
| 卡高（min-height） | 128px（真机 130） | **96px**（真机待验，按高度账应为 96） |
| 标题 | 13px/600，与徽标分列两列 | 13px/600，**L1 header 里 flex:1**，徽标右对齐 |
| meta | 单独一行、无 title | 单独一行、省略、**title 带全文** |
| 六项 | 3 列 × 2 行，每格 **label 上 / value 下** | 3 列 × 2 行，每格 **label + value 同行** |
| 指标区高度 | ≈60px | ≈38px |
| 信息量 | 标题/状态/meta/六项 | 完全不变（六项、`data-available`、所有钩子都在） |

## 2. 新 DOM（只多一层 L1 header）

```
button[data-active-run][data-run-id][data-current][data-selected][data-ongoing]
       [aria-pressed][title][disabled]
 ├─ span[data-active-run-head]                          ← 新增：L1 同一行
 │   ├─ span[data-active-run-title][data-title-source]  ← flex:1、单行省略
 │   └─ span[data-active-run-status][data-tone]         ← flex:0 0 auto、nowrap、18px 胶囊
 ├─ span[data-active-run-meta][title=全文]              ← L2 单行省略
 └─ span[data-active-run-usage]                         ← L3，3 列 × 2 行
     └─ span[data-active-run-metric="…"][data-available]
         ├─ span[data-active-run-metric-label]  ┐
         └─ b[data-active-run-metric-value]     ┘ 同行（flex, align-items: baseline）
```

- 卡内仍然**零 div**（`button` 只允许 phrasing content，tag 集合仍是 `{span, b}`）。
- 原钩子一个不少：`data-active-run`、`data-run-id`、`data-current`、`data-selected`、
  `data-ongoing`、`data-active-run-title`、`data-title-source`、`data-active-run-status`、
  `data-tone`、`data-active-run-meta`、`data-active-run-usage`、`data-active-run-metric`、
  `data-active-run-metric-label`、`data-active-run-metric-value`、`data-available`、
  `aria-pressed`、`title`、`disabled`。新增的只有 `data-active-run-head`。
- 组件的「只贴投影」纪律不变：文案仍全部来自 `RunRowView`（`row.title/metaText/usageMetrics`）。

## 3. 高度账（min-height 96px，不写死 height）

```
上边框                       1
上内边距                     6
L1 header（标题 13px/20px）  20   ← max(标题行 20, 徽标 18)
块间距 gap                   4
L2 meta（11px/16px）         16
块间距 gap                   4
L3 六项                      38   = 上虚线边框 1 + padding-top 3 + 两行 16×2 + 行距 2
下内边距                     6
下边框                       1
─────────────────────────────────
合计                         96
```

- 只写 `min-height: 96px`，不写 `height`：meta 变长或六项内容变长时卡可以自然长高，
  不裁字（用户要求「辅助信息要显示全」，宁可长高也不省略到看不见）。
- 六项区从 t8 的 ≈60px 降到 38px：每格由「label 行 + value 行」32px 变「同行」16px，
  再省掉 `margin-top: 2px`、`padding-top` 从 4 收到 3。

## 4. 排版取舍

**为什么 label / value 同行，而不是继续两行？**
两行时每格 `label(16) + value(16) = 32`，3 列 × 2 行就是 64px 上下；
同行后每格只有一行 16px，指标区直接少 22px，这 22px 正是卡高从 130 降到 96 的主要来源。
同行后「输入 1,000」读起来仍是「标签：数值」的自然语序，不需要额外分隔符
（JSX 里保留的 `{' '}` 只影响可访问文本，flex 布局会把纯空白文本节点丢掉，不占宽）。

**为什么 label 用 11px 而不是 10px？**
宿主没有 10px 的字号 token（`--dsw-font-xxxs-11` 是最小档），
而 AGENTS §4 要求字号必须走 `font:` 简写 + 宿主 token，不许裸 `font-size`。
为把 11px 的额外 1–2px 换回来，六项**列距从 6px 收到 3px**：
卡内容宽 `216 - 左竖条 3 - 右边框 1 - 左右 padding 16 = 196`，
每列 `(196 - 3×2)/3 ≈ 63.3px`，正好放得下最长一格「缓存读 12.3k」
（3 个 11px 汉字 ≈33 + 间距 2 + 值 ≈28 = 63）。再宽就会触发省略。

**为什么标题是视觉第一层？**
L1 用 13px/600（与 t8 相同，未缩），徽标压到 11px 且 `flex: 0 0 auto`，
标题 `flex: 1 1 auto` 吃掉剩余宽度：卡变紧凑后标题不跟着变小，
「以任务名称显示为主」靠的是**排版次序与占比**，不是把别的信息删掉。

**辅助信息如何保证「显示全」？**
- 标题：卡本身 `title={row.titleTitle ?? row.title}`（原有）。
- meta：单行省略，但本次补了 `title={row.metaText}`，悬停可看完整「开始时间 · 任务数」。
- 六项：每格保留 `title={`${label}：${text}`}`（原有）；数值本身保留宿主文案，
  不补千分位、不把「不可得」写成 0；`data-available="false"` 的虚线下划线 + 三级色照旧。

**状态徽标**：10–11px（11px token）、右对齐、`nowrap`、`max-width: 96px`、18px 胶囊，
颜色仍只由 `data-tone` 映射（success / warn / danger / business），几何与任务行 `[data-badge]` 一致。

## 5. 选择器与声明：新增 / 删除

新增：

- `[data-region="run-switcher"] [data-active-run-head]`：
  `display:flex; align-items:center; gap:4px; min-width:0; overflow:hidden`。
- `[data-active-run-title]` 增加 `flex: 1 1 auto`（替换旧的 `grid-column: 1; grid-row: 1`）。
- `[data-active-run-status]` 增加 `flex: 0 0 auto`（替换旧的 `grid-column: 2; grid-row: 1`）。
- `[data-active-run-metric]` 增加 `display:flex`（行向）、`align-items: baseline`、`gap: 2px`。
- `[data-active-run-metric-label]` 增加 `flex: 0 0 auto`。
- `[data-active-run-metric-value]` 增加 `flex: 0 1 auto; min-width: 0`（值可省略，全文在格子的 title）。

删除 / 收窄（旧排版规则必须删净，否则会和新排版打架）：

- 卡：`grid-template-columns: minmax(0, 1fr) auto` → `minmax(0, 1fr)`；`gap: 2px 8px` → `gap: 4px`；
  `align-items: center` 删除（单列不需要）；`min-height: 128px` → `96px`；`padding: 8px` → `6px 8px`；
  卡级 `font: 12px/18px` → `11px/16px`。
- 标题 / 徽标 / meta / 六项的 `grid-column` / `grid-row` 全部删除（单列后由 DOM 顺序决定行）。
- 六项：删 `margin-top: 2px`；`padding-top: 4px` → `3px`；`gap: 2px 6px` → `2px 3px`。
- 六项每格：删 `flex-direction: column`（这是「label 上 / value 下」的竖排规则）。
- 六项值：`font: 12px/16px` → `font: 11px/16px`（旧的 12px 只服务于竖排可读性）。

保留不动（正交状态位与可达性）：

- 当前 run = 左侧 3px 业务色竖条（常驻透明左边框占位，切卡不位移）；
- 正在查看 = 10% 淡底 + 1px 内描边；两者可同现、互不覆盖；
- focus-visible 2px 内缩描边、disabled 0.6 压暗 + `not-allowed`、hover/active 不覆盖选中淡底；
- `data-fallback="true"` 仍然零规则（兜底不是异常，不加警示色）；
- reduced-motion 块继续覆盖卡与横滑容器。

## 6. 测试同步（改了哪条、为什么不是放宽）

`test/r18-run-cards.test.ts`（元素树，不锁像素）：

- 「卡内文案来自 RunRowView」：t8 里 title / status 是卡的**直接子元素**，t9 起它们在
  `data-active-run-head` 里 —— 断言改成「header 存在 + header 里恰好两个 span + 标题/徽标都在这层」，
  这是跟着结构走，不是放宽（反而多断言了 header 的类型与子元素顺序）。
- 「计划状态徽标」两处查 status 从 `childElementsOf(card)` 改成 `elementsOf(card.props.children)`
  （徽标下沉一层），断言内容（`■ 已终止` / tone=neutral）不变。
- 新增「r18b t9 紧凑排版」：卡的直接子元素是 `span/span/span`，钩子顺序是
  `head → meta → usage`，整棵树零 div。
- 源码钩子清单加 `data-active-run-head`；meta 的正则从
  `/data-active-run-meta>\{row\.metaText\}/` 改为
  `/<span data-active-run-meta[^>]*>\{row\.metaText\}/` —— 因为 meta 现在多一个 `title` 属性，
  改的是**属性允许范围**，「meta 正文直接贴 `row.metaText`」这条不变量没动。

`test/r18-styles.test.ts`（静态样式契约）：

- 卡几何：`min-height 118–132` → **96–104**；`padding [8]` → `[6, 8]`；
  `grid-template-columns: minmax(0,1fr) auto` → `minmax(0,1fr)`；新增 `gap: 4px`、
  `align-content: start`、断言不写死 `height`。
- 标题/徽标：删 `grid-column/row` 断言，改断 `flex: 1 1 auto` / `flex: 0 0 auto`；
  新增标题 `font-weight ≥ 600`、徽标 `font: --dsw-font-xxxs-11`。
- 新增对 title/status/meta/usage **残留旧网格定位**的反向断言
  （`grid-row|grid-column` 必须一条不剩）。
- 六项：`gap [2,6]` → `[2,3]`；`flex-direction: column` 从「必须有」改成「必须没有」；
  值 `--dsw-font-xxs-12` 从「必须有」改成「必须没有」；新增 `align-items: baseline`、
  `flex: 0 1 auto`、`padding-top ≤ 4`。
- 320px 算术：卡宽/间距/露出量不变（216 + 8 → 第二张露出 88px）；列宽按新列距重算
  `(196-6)/3 ≈ 63.3px`，并断言它 ≥「3 个 11px 汉字 + 2 + 值 ≈ 28 = 63」。
- `ALLOWED_HOOKS` 与 `RUN_SELECTORS` 增加 `data-active-run-head`（纪律测试同时覆盖它：
  只许 `font:` 简写、不许裸色值、单点定义、reduced-motion 仍需覆盖卡与轨道）。

`test/r17-styles.test.ts`、`test/client-ui.test.ts` **未改**：卡宽 216、`display: grid`、
钩子清单与旧钩子清零断言都仍然成立。

## 7. 门禁输出

```bash
$ pnpm typecheck
> tsc --noEmit
（exit 0）

$ node --test test/r18-run-cards.test.ts test/r18-styles.test.ts test/r17-styles.test.ts test/client-ui.test.ts
ℹ tests 69
ℹ pass 69
ℹ fail 0
（exit 0）
```

## 8. 未真机验证声明

本任务**没有**在真实宿主里打开面板截图核对：96px 是按上面的高度账（1+6+20+4+16+4+38+6+1）
与 t8 相同的 CSS 盒模型推导出来的，不是实测值。
需要真机确认的点：

1. 实际渲染高度是否落在 96–104px（t8 的 `min-height: 128` 实测为 130，多出的 2px 来自浏览器
   对行盒/边框的取整，t9 也可能多 1–2px）；
2. 最长一格「缓存读 12.3k」在 320px 侧栏里是否真的不触发省略（列宽只有 63.3px，
   字体度量与 token 的真实字号若与 fallback 不同，结论可能变化）；
3. 18px 徽标与 13px/20px 标题同一行时的垂直居中观感。
