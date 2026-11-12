# t4 · r18 样式收尾（run 卡片行 / 分组标题 / 样式纪律）

- 日期：2026-11-05
- 任务：r18 / t4
- 状态：已实现，门禁通过（未 commit）
- 写域：`src/client/styles.ts`、`test/r18-styles.test.ts`（新建）、本文件；
  因删除 select 死规则，`test/r17-styles.test.ts` 做了**最小必要更新**（见 §6，已向 lead 报备）。

## 1. 背景（r18 t2 之后的样式缺口）

`RunSwitcher.tsx` 已把 `<select>` 换成横向 run 卡，DOM 钩子齐了但样式没跟上：

- 旧的 `[data-region="run-switcher"] [data-run-switcher]`（select 专用，含 `:hover` /
  `:focus-visible` / `:disabled` 三条衍生规则）**已匹配不到任何元素**——留着会让
  「样式看起来写了、其实一条都没生效」，还会在 reduced-motion 块里留一条死选择器；
- 卡片行没有任何规则：`<div data-run-cards>` 是块级容器，卡片按行内流排，
  第二张卡会换行并把状态行/提示挤出面板；
- 卡片本体、`[data-run-card-title]` / `-badge` / `-status` / `-progress` 全裸。

## 2. 320px 下的实际取值（面板宽 320 / 内容宽 296）

| 量 | 值 | 说明 |
|---|---|---|
| 面板 | 320px | 右栏宽度 |
| 切换器 padding | `8px 12px` | 内容宽 = 320 − 24 = **296** |
| 卡片行（`[data-run-cards]`） | border-box **296**，`padding: 4px`，`margin-inline: -4px` | 可视内容宽 = 296 − 8 = **288**；负外边距把首卡左缘拉回 12px（与组头 `padding: 0 12px` 对齐） |
| 卡片宽 | `width: 216px`（`min-width: 200px` / `max-width: 232px` 兜底） | 落在要求的 200–232px 区间 |
| 卡片高 | `min-height: 60px` | 落在 56–64px；两行 16+2+16 = 34 + padding 14 = 48，`align-content: center` 上下均分剩余 12px |
| 卡间距 | `gap: 8px` | |
| 两张卡 | 216 + 8 + 216 = **440 > 288** | 必然溢出 → 只能横滑 |
| 首卡后露出 | 288 − (216 + 8) = **64px** | 露出的下一张卡就是「还能横滑」的可见暗示 |
| 横向滚动策略 | `overflow-x: auto` + `overflow-y: hidden` + `flex-wrap: nowrap` + `min-width: 0` | 不换行、不撑破面板 |
| 滚动细节 | `scroll-snap-type: x proximity` + 卡 `scroll-snap-align: start`；`overscroll-behavior-x: contain`；`scrollbar-width: thin` | 一次吸附一张卡；横滑不会带动外层；滚动条不占 60px 卡片区 |

## 3. 卡片视觉（两行网格）

```
┌──────────────────────────────┐
│ 目标标题（单行省略）      [当前] │  ← row1: title(col1) + badge(col2)
│ 派发中                    已完成 3/5 │  ← row2: status(col1) + progress(col2)
└──────────────────────────────┘
```

- `display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto auto`，
  四个子元素**显式定位**（`grid-area: 1/1`、`1/2`、`2/1`、`2/2`）——不用隐式放置，
  因为「当前 run」才有角标（3 个子元素），隐式放置会把状态挤到第一行右侧。
- 历史卡没有角标 → `[data-current="false"] [data-run-card-title] { grid-column: 1 / -1 }`，
  标题吃满整行。
- 标题 12/16 600 + `text-overflow: ellipsis`；状态/进度 11/16；进度 `tabular-nums`。

### 3.1 三种「身份」互不冒充

| 状态 | 视觉 | 钩子 |
|---|---|---|
| 当前 run | 左侧 **3px business 色条** + 6% business 淡底 + 「当前」角标 | `[data-current="true"]` |
| 正在查看的 run | 上/右/下三边 **business 描边**（55% 混合）+ **12% 淡底** + 1px 内描边 | `[data-selected="true"]`、`aria-pressed` |
| 历史卡（只读） | 左色条退为 `--dsw-alias-border-l3`，标题二级色、进度三级色；**仍是 pointer、仍有 hover/active** | `[data-current="false"]` |
| 忙碌禁用 | 整体 `opacity: .55` + 统一 `border-l1` + `cursor: not-allowed` | `:disabled` |

关键取舍：**hover/active/选中只改上/右/下三边，绝不动 `border-left`**。左色条是「当前 run」
的身份，若被 hover 的 `border-color` 简写抹掉，鼠标一划过就分不清哪张是当前 run。

另一个取舍：`[data-run-card]:disabled` 写在前、`[data-current]` / `[data-selected]` 写在后
（同特异性、后者胜），所以忙碌态仍保留色条/淡底，仅整体压暗——这是「暂时不能点」而不是
「没有身份」。禁用可见性由 `opacity` + `not-allowed` 承担，不依赖颜色。

### 3.2 focus-visible 不被裁

卡片行有 4px 内边距，focus 描边为 `outline: 2px solid business; outline-offset: 1px`
（共 3px 外扩）——3px ≤ 4px，`overflow: hidden` 的纵轴不会裁掉焦点环；
4px 内边距配 `margin-inline: -4px` 后又让首卡左缘回到 12px，与组头对齐。

## 4. 分组标题（「进行中」/「最近完成」）

现有 `[data-region="task-list"] [data-group-head]`（sticky 24px、11/16、二级色、`padding: 0 12px`）
在 296px 下显示正常，文案来自 `TaskTable.GROUP_LABEL`（`进行中` / `最近完成`），格式
`${label} · ${rows.length}`，单行不折。

唯一最小修正：补 `font-variant-numeric: tabular-nums`。
理由：两组标题的计数出现在**同一水平位置**，非等宽数字会让整行标题在 1↔2 位数字之间左右跳；
这是 1 条声明，不动字号/颜色/高度。

## 5. 测试（`test/r18-styles.test.ts`，7 例）

静态契约（读 `styles.ts` 源码 + 断言关键声明），写法对齐 `test/r17-styles.test.ts`：
自带极简规则扫描器（顶层逗号切选择器，正确处理 `:is(a, b)`），注释先剥离。

| 用例 | 覆盖点 |
|---|---|
| ① 卡片行 | `display:flex` / `flex:1 0 100%` / `flex-wrap:nowrap` / `min-width:0` / `overflow-x:auto` / `overflow-y:hidden` / `gap:8px` / `overscroll-behavior-x` / `scroll-snap-type` |
| ① 320px 算术 | 从 CSS **解析** width/min/max/min-height/gap/padding 再算：单卡 ≤ 288、两卡 > 288、首卡后露出 ≥ 32px、min-width ∈ 200–232、高 ∈ 56–64 |
| ② 卡片本体 | 两行网格 + 固定宽 + 标题单行省略 + `cursor:pointer` + hover/active/focus-visible/disabled 四态 + 角标/状态/进度定位 |
| ② 身份区分 | 当前色条 6%、选中三边 55% + 12% + 内描边、选中态**不得**改写左边框、历史卡无 `pointer-events:none`、4 个 tone → 状态色 |
| ③ 死规则 | 全表不存在 `[data-run-switcher]` 选择器；`RunSwitcher.tsx` 去注释后无 `<select`/`<option`，17 个钩子逐字存在 |
| ④ 分组标题 | 24px/11px/二级色/`padding: 0 12px`/`tabular-nums`；`TaskTable` 文案仍是唯一来源 |
| ⑤ 纪律 | 每个 r18 选择器：无 `font-size:`（只许 `font:` 简写）、无裸 hex、钩子必须在允许清单内（不许发明新前缀）；全表无 `font-size: var(--dsw-font…)`、不定义 `--dsw-*`；花括号配对；每个钩子单点定义（reduced-motion 豁免）；卡片 transition 在 reduced-motion 里被停掉 |

## 6. 对 `test/r17-styles.test.ts` 的最小必要更新（已报备）

删掉 select 规则后 r17 文件必然变红（它 `expectDecl` 了那个已不存在的选择器），故做三处最小改动：

1. `R17_SELECTORS` 移除 `'[data-region="run-switcher"] [data-run-switcher]'`；
2. 原用例里 9 行 select 断言 → 换成 1 行反向断言 `has(...) === false`（并注明卡片行由 r18 测试守护），
   用例名「28px select」改为「状态行 + 只读提示（卡片行归 r18 t4）」；
3. 钩子一致性清单把 `data-run-switcher` 换成 `data-run-cards` / `data-run-card`。

未放宽任何既有断言（label 行、状态行、返回键、只读竖条、reduced-motion 全部原样保留）。

## 7. 门禁证据

```bash
pnpm typecheck && pnpm build && node --test test/r18-styles.test.ts test/r17-styles.test.ts
```

| 步骤 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无输出 |
| `pnpm build` | 0 | `lib/client.js` / `lib/index.js` 产物更新（仅 stderr 两条 tsdown 既有 deprecation WARN） |
| `node --test test/r18-styles.test.ts test/r17-styles.test.ts` | 0 | tests 13 / pass 13 / fail 0（r18 7 + r17 6） |

回归（额外跑）：`pnpm test` → **871 tests / 871 pass / 0 fail**（退出码 0），
包括 `client-ui.test.ts` 的「r13 之后无裸 hex / 无 `font-size: var(--dsw-font…)`」守卫。

构建产物（`wc -c`，build 后实测）：

| 产物 | 字节 | tsdown 报告 |
|---|---|---|
| `lib/client.js` | **502 753 B** | 502.75 kB（gzip 120.82 kB） |
| `lib/index.js` | **469 281 B** | 469.28 kB（gzip 158.40 kB） |

## 8. 边界与未做

- 未 `git commit`；未改 `RunSwitcher.tsx` / `nav.ts`（t2 写域）、未改 `TasksTab.tsx`。
- 没有浏览器/截图：本仓无 react-dom、无 CSS 引擎，**视觉结论来自声明与算术**，
  真机观感仍需一次人工确认（可在 320px 面板里看：两卡横滑、首卡后露 64px、当前卡左色条、
  选中卡描边、Tab 键焦点环不被裁）。
- 未新增滚动阴影/渐变遮罩：横向可滚动性靠「露出下一张卡 64px」表达，避免再引入
  绝对定位遮罩层与 pointer-events 交互。
- `scrollbar-width: thin` 只对 Firefox 生效；WebKit 用系统滚动条（macOS 为 overlay，不占卡片高度）。
