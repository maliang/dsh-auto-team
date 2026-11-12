# r18b t3 — 顶部 run 行的样式收尾（run row styles）

- 任务夹：`docs/teamflow/2026-11-05-r18b-run-rows/`
- 任务：r18b t3（样式收尾）
- 写域：`src/client/styles.ts`、`test/r17-styles.test.ts`、`test/r18-styles.test.ts`、本文件
- 上游：t2 已把顶部从「下拉 / 横向 run 卡」改成**历史列表同款 run 行**（`src/client/views/RunSwitcher.tsx`），
  DOM 结构以该文件为准；本任务只补样式与样式测试，不动 DOM、不动 `nav.ts` / `viewmodel.ts`。

## 1. 样式挂在哪（新 DOM）

```
section[data-region="run-switcher"][data-active-runs][data-fallback]
└─ button[data-active-run][data-run-id][data-current][data-selected][data-ongoing]
          [aria-pressed][title][disabled]
   ├─ span[data-active-run-title][data-title-source]        ← 第 1 行第 1 列
   ├─ span[data-active-run-status][data-tone]               ← 第 1 行第 2 列（18px 胶囊）
   ├─ span[data-active-run-meta]                            ← 第 2 行（横跨两列）
   └─ span[data-active-run-usage]                           ← 第 3 行（横跨两列，3 列网格）
      └─ span[data-active-run-metric="input|cacheRead|cacheWrite|output|calls|hitRate"]
              [data-available="true|false"]
         ├─ span[data-active-run-metric-label]
         └─ b[data-active-run-metric-value]
```

行是原生 `button`：内部只能有 phrasing content（`span` / `b`），**不能包 `div`**。
所以「标题 + 徽标 // meta // 六项」的分层不用 wrapper，而是让 `button` 自己做三行网格，
子元素用 `grid-row` / `grid-column` 落位。

## 2. 取值表

### 2.1 几何

| 项 | 值 | 说明 |
|---|---|---|
| 面板宽 | 320px | 右栏页签固定宽 |
| 内容宽 | 296px | 面板 320 − 左右各 12 padding |
| 行盒模型 | `width: 100%` + `box-sizing: border-box` | 吃满容器，精确等于 296 |
| 行内边距 | `8px 12px 8px 10px` | 左侧少 2px，抵消常驻的 2px 竖条 → 标题仍与历史行齐在 12px |
| 行内网格 | `minmax(0, 1fr) auto`，`gap: 2px 8px` | 272px（296 − 2 竖条 − 10 − 12） |
| 行间分隔 | `border-bottom: 1px solid --dsw-alias-border-l1` | `:last-child` 去掉，避免容器底边双线 |
| 行高（推算） | ≈127px | 16 padding + 20 标题 + 2 + 16 meta + 2 + 4+1 六项分隔 + 66 六项（2×32 + 2） |
| 六项网格 | `repeat(3, minmax(0, 1fr))`，`gap: 2px 8px` | 6 项 → **3 列 × 2 行**；每列 (272−16)/3 ≈ 85.3px |
| 六项分隔 | `border-top: 1px dashed --dsw-alias-border-l1` + `padding-top: 4px` | 与历史六项同一视觉语言 |
| 徽标几何 | `height: 18px` / `padding: 0 6px` / `radius 999px` / `max-width 108px` | 与任务行 badge 同级；上限防长文案挤掉标题 |

### 2.2 排版与颜色（全部为宿主 token）

| 部位 | 字号 | 颜色 |
|---|---|---|
| 行基础 | `font: var(--dsw-font-xxs-12, 12px/18px sans-serif)` | `label-primary` |
| 标题 | `--dsw-font-xs-13` + `font-weight: 600` | `label-primary`，单行省略 |
| 状态徽标 | `--dsw-font-xxxs-11` | 基础 `label-secondary`；tone 覆盖 |
| meta | `--dsw-font-xxxs-11` + `tabular-nums` | `label-secondary` |
| 六项标签 | `--dsw-font-xxxs-11` | `label-tertiary` |
| 六项数值 | `--dsw-font-xxs-12` + `600` + `tabular-nums` | `label-primary` |
| 不可得数值 | 同上但 `font-weight: 400` | `label-tertiary` + 虚线 `border-l2` 下划线，`cursor: help` |

tone → 徽标色：`success / warn / danger / business` 分别映射
`--dsw-alias-state-{success,warn,error,business}-primary`（描边用同色 `color-mix(…45%, transparent)`）；
`neutral` 不写额外规则，落回基础 `label-secondary`。
**注意 `danger` 对应 token 是 `state-error-primary`**（宿主命名不是 `danger`）。

字号纪律：只写 `font:` 简写（`--dsw-font-*` 是复合值，写成 `font-size: var(...)` 是无效声明且会静默继承父级字号）。

## 3. 状态矩阵：当前 vs 查看中 vs fallback

| 状态 | 钩子 | 视觉 | 与其它状态的关系 |
|---|---|---|---|
| 当前 run | `[data-current="true"]` | 左侧 **2px 业务色竖条**（宽度常驻、透明占位，只换色） | 竖条只表达「这是当前 run」；切换时不发生 0↔2px 抖动 |
| 正在查看 | `[data-selected="true"]` | **10% 业务色淡底** + **1px 内描边**（`box-shadow: inset`） | 只改 `background` / `box-shadow`，**不碰 `border-left`**，因此两状态正交、可同时出现 |
| 同时（查看的就是当前 run） | 两者 | 竖条 + 淡底 | 两个信号叠加，不互相覆盖 |
| 兜底行 | `[data-fallback="true"]`（在 section 上） | **刻意零规则** | 不是异常：没有进行中的 run 时只有「最后一个 run」，状态由徽标/meta 说明，不加警示色 |
| 悬停 / 按下 | `:hover` / `:active`，均带 `:not(:disabled):not([data-selected="true"])` | `interactive-bg-hover` / `interactive-bg-active` | 排除选中行，否则悬停会抹掉「正在查看」的底色 |
| 键盘焦点 | `:focus-visible` | `outline 2px business` + `outline-offset: -2px` | 内缩，面板右缘无横向余量，外扩会被裁一半 |
| 禁用（读历史详情中） | `:disabled` | `opacity: 0.6` + `cursor: not-allowed` + `label-secondary` | 压暗但仍可读（不用 0.4/0.5） |
| 减少动效 | `prefers-reduced-motion` | 行进入 `transition/animation: none` 列表 | 行有 120ms 背景过渡，必须停 |

为什么区分「当前」与「查看中」：当前 run 可能是 A，用户点历史详情看的是 B。
若两者共用一个信号（例如都用底色），A/B 同时存在时就会看不出来「哪个是当前」；
r18b 的约束是「run 区只显示进行中的任务，没有则显示最后一个」，所以两态必须可独立出现。

## 4. 删除的旧选择器（本次清掉的死规则）

组件侧（`RunSwitcher.tsx`）在 t2 已不再渲染这些钩子，`grep` 确认全仓组件 0 命中，
本次把样式里对应的整块（原 `styles.ts` 8954 字符）删除：

| 旧选择器 | 原用途 |
|---|---|
| `[data-region="run-switcher"] [data-run-cards]` | 横向卡片容器（`overflow-x: auto` / scroll-snap） |
| `[data-run-card]` 及 `:hover` / `:active` / `:focus-visible` / `:disabled` 变体 | 单张 run 卡 |
| `[data-run-card-title]` | 卡片标题 |
| `[data-run-card-badge]` | 卡片上的 run 序号/标识 |
| `[data-run-card-status]` | 卡片状态 |
| `[data-run-card-progress]` | 卡片进度条 |
| `[data-run-back]` 及四态变体 | 「回到当前 run」按钮（新交互不需要） |
| `[data-run-switcher-label]` / `[data-run-switcher-caption]` / `[data-run-switcher-status]` / `[data-run-switcher-hint]` | 旧下拉切换器的行 |
| `[data-region="run-switcher"] [data-run-switcher]`（`select` 专用）及其 `option` 规则 | 旧 `<select>` |
| `[data-region="run-switcher"][data-historical="true"]` + `[data-historical]` 相关 | 历史只读态提示（新交互用 `data-selected`） |

**保留**：`[data-region="run-head"] [data-run-id]`（`styles.ts` 中 RunHeader 的 run id 样式）。
`data-run-id` 同时被 run 行与 RunHeader 使用，删除时只删与卡片/切换器绑定的规则，
该规则逐字保留，并由 `test/r18-styles.test.ts ③` 反向断言存在。

同时 `reduced-motion` 块里的 `[data-region="run-switcher"]`、`[data-run-card]`、`[data-run-back]`
三行替换为单行 `[data-region="run-switcher"] [data-active-run]`。

## 5. 测试变更

- `test/r18-styles.test.ts`：整文件重写为 run 行契约（7 个用例）
  1. 行列表纵向堆叠、`width:100%`、无 `overflow-x`、无 `flex-wrap`、全表无 `scroll-snap-type`；
  2. 320px 算术（网格 272、六项 3 列、列宽 ≥80、上下内边距 ≥6）；
  3. 行三行网格 + 标题/徽标/meta/六项逐条声明 + hover 排除选中行 + focus 偏移 + disabled 0.6；
  4. 当前/选中正交（选中体不得出现 `border-left`）、`data-fallback` 零规则（`deepEqual []`）、tone 四色；
  5. 死钩子零残留 + `run-head [data-run-id]` 存在 + RunSwitcher 钩子清单 + 行内无 `div` + `aria-pressed`；
  6. 组头 24px / 11px / `tabular-nums` + `TaskTable` 分组文案「未完成 / 已完成」；
  7. 纪律（font 简写、无裸色值、14 个允许钩子白名单、花括号配对、单点定义、reduced-motion 含行）。
- `test/r17-styles.test.ts`：把 r17 ⑥ 的 run 切换器断言改到新 DOM（不再断言 label/status/back 四行结构，
  改为「一行一条 / 不横滑 / 竖条与淡底各管一维 / fallback 零规则」），`R17_SELECTORS` 换成新选择器，
  钩子一致性清单换成新钩子，减少动效断言换成 `[data-active-run]`。
  **其余断言（子智能体主界面 / 历史六项 / 可点角色卡）逐条保留、未放宽。**

## 6. 门禁结果（2026-11-05）

```
$ pnpm typecheck
> tsc --noEmit
exit 0

$ node --test test/r18-styles.test.ts test/r17-styles.test.ts test/client-ui.test.ts test/r18-run-cards.test.ts
ℹ tests 63
ℹ pass 63
ℹ fail 0
exit 0
```

t2 报告的三条红（r17 ⑥ `data-run-switcher-label`、r18 ③ 缺 `data-run-switcher-label`、
r18 ④ 找不到 `open: '进行中'`）已全部转绿。

## 7. 未做与声明

- **未 build、未 commit**（按任务约束）。
- **未做真机视觉验证**：本仓没有浏览器，以上断言全部是「读 `styles.ts` 源码 + 断言声明/几何」
  的静态契约，只能保证「规则存在且与 DOM 钩子对得上、算术放得进 320px」，
  不能保证真机像素级观感（尤其 `color-mix` 在宿主 WebView 的实际混色、`tabular-nums` 的回退字体）。
  真机验收需在宿主里打开右栏页签目测：当前行竖条、查看行淡底、hover 不覆盖选中、禁用行可读。
- 行高 ≈127px 是按 CSS 行高推算的，不是实测；若真机上六项标签换行，行会变高（标签已 `nowrap` + 省略号兜底）。
- 未改 `styles.ts` 中 run 区之外的规则；唯一的非 run 区改动是 `styles.ts:3727` 的**注释**
  （「进行中 / 最近完成」→「未完成 / 已完成」），规则本身未动。
