# r18b t8 — 顶部 run 从「纵向整宽行」改成「横向滑动卡」

- 任务夹：`docs/teamflow/2026-11-05-r18b-run-rows/`
- 任务：r18b t8（run 卡）
- 写域：`src/client/views/RunSwitcher.tsx`、`src/client/styles.ts`、
  `test/r18-run-cards.test.ts`、`test/r18-styles.test.ts`、`test/r17-styles.test.ts`、本文件
- 上游：t2 把顶部从「下拉 / 横向 run 卡」改成历史列表同款**纵向整宽行**，t3 补了行的样式。
  用户看过 r18b 真机截图后改口径（2026-11-05）：

  > 每条 run 做成一个卡，多个同时进行的任务通过点卡切换查看详情

  并选定备选方案「**横向滑动卡，六项在卡内两行**」。本任务把 t2/t3 的行改成卡，
  `nav.ts`（`activeRunRowsOf`）、`viewmodel.ts`、`table/rows` 的 `runSummaryRowOf`、
  `TasksTab.tsx` **一行未改**：数据形状不变，只换渲染与样式。

## 1. 新 DOM

```
section[data-region="run-switcher"][data-active-runs][data-fallback]
└─ span[data-active-run-cards]                        ← 横滑轨道（display:flex，不换行）
   └─ button[data-active-run][data-run-id][data-current][data-selected][data-ongoing]
             [aria-pressed][title][disabled]          ← 一张卡
      ├─ span[data-active-run-title][data-title-source]   ← 第 1 行第 1 列，单行省略
      ├─ span[data-active-run-status][data-tone]          ← 第 1 行第 2 列（18px 胶囊）
      ├─ span[data-active-run-meta]                       ← 第 2 行（横跨两列）
      └─ span[data-active-run-usage]                      ← 第 3 行（横跨两列，3 列网格）
         └─ span[data-active-run-metric="input|cacheRead|cacheWrite|output|calls|hitRate"]
                 [data-available="true|false"]
            ├─ span[data-active-run-metric-label]
            └─ b[data-active-run-metric-value]
```

要点：

- **轨道是 `span` 不是 `div`**：卡是 `button`，内容模型只允许 phrasing content；
  轨道在 `section` 里也按 phrasing 画，`display: flex` 由样式给出。
  顺带满足 `test/run-switcher.test.ts` 的「组件源码零 `<div>`」既有断言。
- 一个 run 一张卡，卡本身就是一个 `button`：点卡 = 切到该 run 的详情，
  没有卡内二级点击区（避免「点标题没反应」）。`aria-pressed` 跟 `data-selected` 同源。
- 钩子名 `data-active-run-cards` 刻意避开旧名字 `data-run-card*`：
  t2 已删的旧钩子必须在源码里零残留，`test/run-switcher.test.ts` 会直接按子串判红。

## 2. 卡尺寸与 320px 算术

| 项 | 值 | 说明 |
|---|---|---|
| 面板宽 | 320px | 右栏页签固定宽；`[data-panel-body]` 与 `[data-region="tasks-tab"]` 都没有内边距，内容宽≈面板宽 |
| 卡宽 | `216px` × 三连写（`width` / `min-width` / `max-width`） | flex 项默认会被压扁，只写 `width` 在卡多时会失效 |
| 卡间距 | `8px`（轨道 `gap`） | 216 + 8 = 224 |
| 轨道内边距 | `4px`（四边） | 不用负 margin：负 margin 会让轨道比 `[data-panel-body]` 宽 8px，反而多出整页横向滚动条 |
| 一屏可见 | 第一张整卡 + 第二张 **88px** | 320 − 4×2 − 216 − 8 = 88 ≥ 216/3，一眼能看出右边还有卡 |
| 卡最小高 | `128px` | 内容推算 ≈ 8+20（标题/徽标）+2+16（meta）+2+4+1+66（六项）+8 ≈ 127px |
| 卡内宽 | 216 − 左竖条 3 − 右边框 1 − 左右 padding 16 = **196px** | `box-sizing: border-box` |
| 六项 | `repeat(3, minmax(0, 1fr))`，`gap: 2px 6px` | 每列 (196 − 12)/3 ≈ **61.3px** |
| 标签上限 | 11px × 5 汉字 ≈ 55px < 61.3px | 「缓存读 / 命中率」都能单行放下；超长 `nowrap` + 省略号兜底 |

卡内是**三行网格**（`display: grid`，`grid-template-columns: minmax(0, 1fr) auto`）：
第 1 行「标题 | 徽标」、第 2 行 meta、第 3 行六项（3 列 × 2 行）。没有 wrapper，
三行全靠 `grid-row` / `grid-column` 落位，所以卡内标签仍在 `{span, b}` 之内。

### 排版与颜色（全部宿主 token）

| 部位 | 字号 | 颜色 |
|---|---|---|
| 卡基础 | `--dsw-font-xxs-12` | `label-primary`，底色 `bg-layer-2`，描边 `border-l1` |
| 标题 | `--dsw-font-xs-13` + `600` | `label-primary`，单行省略 |
| 状态徽标 | `--dsw-font-xxxs-11` | 基础 `label-secondary`；tone 覆盖 |
| meta | `--dsw-font-xxxs-11` + `tabular-nums` | `label-secondary`，单行省略 |
| 六项标签 | `--dsw-font-xxxs-11` | `label-tertiary`，单行省略 |
| 六项数值 | `--dsw-font-xxs-12` + `600` + `tabular-nums` | `label-primary`，单行省略 |
| 不可得数值 | 同上但 `400` | `label-tertiary` + `border-l2` 虚线下划线，`cursor: help` |

与历史六项同一套区分：**虚线 + 三级色 = 不可得**，真 0 仍是实线、主色、600。

## 3. 三个状态位互不冒充

| 状态 | 视觉 | 实现 |
|---|---|---|
| 当前 run（`data-current="true"`） | 左侧 **3px 业务色竖条**（只一维） | 基础规则里常驻 `3px solid transparent` 占位，状态规则只改 `border-left-color`；切卡时标题不位移 |
| 正在查看（`data-selected="true"`） | **10% 业务色淡底 + 1px inset 描边** | `background: color-mix(… 10%)` + `box-shadow: inset 0 0 0 1px color-mix(… 32%)`；不碰 `border-left`，所以与「当前」正交、可同现 |
| 无进行中 run（`data-fallback="true"`） | **零规则** | 不另造外观、不用警示色；它是普通卡，状态由卡内徽标与 meta 说明 |

`hover` / `active` 的底色只描在「未选中」的卡上（`:not([data-selected="true"])`），
避免叠在淡底上把两种状态糊在一起；选中态也不复用 `focus-visible` 的 outline。

其他：

- `focus-visible`：`outline: 2px solid business` + `outline-offset: -2px`（画在卡内，
  滚动容器不会裁掉；卡在 320px 面板里左右没有余量）。
- `disabled`（历史详情加载中）：`opacity: .6` + `cursor: not-allowed`，仍保留可读对比。
- 轨道：`overflow-x: auto` / `overflow-y: hidden` / `scroll-snap-type: x proximity` /
  `scrollbar-width: thin`；卡 `scroll-snap-align: start`。
- `prefers-reduced-motion` 块把 `[data-active-run-cards]` 与 `[data-active-run]` 一起列入，
  停掉 `transition`（含 snap 带来的滚动动效由系统设置兜底）。

## 4. 删掉的旧规则

- t2/t3 留下的**纵向整宽行**：`[data-active-run]:last-child`（去末行分隔线）、
  行 `width: 100%`、`section` 的 `display:flex; flex-direction: column`。
- 更早的卡片/下拉/返回键：`data-run-cards`、`data-run-card*`、`data-run-back`、
  `data-run-switcher-*`、`data-historical`（r18b t2 已从组件删除，样式这次一并确认零残留）。
- `data-run-id` 仍归 RunHeader 使用，只删了与顶部卡片绑定的规则。

删完自检：`[data-region="run-switcher"]` 共 21 条选择器规则（另有 2 条在减少动效块里
按同一选择器重复列出、只写 `transition: none`），全部落在新钩子上（无 `:last-child`、
无 `flex-direction: column`），见测试 ③。

## 5. 测试改动

`test/r18-run-cards.test.ts`（重写为卡口径）

- 真实渲染：`typescript.transpileModule`（jsx: React / CommonJS）+ `new Function`，
  数据走真实 `activeRunRowsOf` → `runSummaryRowOf`，断言元素树而不是源码字符串。
- 3 条进行中 run → 3 张卡，全部在唯一 `span[data-active-run-cards]` 轨道里，卡序与投影一致；
  section 直接子元素**只有**轨道，轨道直接子元素**只有** button。
- 每张卡：点击回调各自 runId（含当前卡）；busy 时 `disabled` 且程序化 click 不回调；
  current/selected/`aria-pressed`/title 来自投影（两状态位正交）。
- 标题 / 徽标（`data-tone`，terminated 显示「■ 已终止」）/ meta 逐字等于投影；
  每卡六项 key 顺序固定 `input,cacheRead,cacheWrite,output,calls,hitRate`，
  `data-available` 逐项对齐，每格子元素恰为 `[span, b]`。
- 卡内后代 tag 集合 ⊆ `{span, b}`，整棵树零 `div`；旧钩子 `data-run-cards` /
  `data-run-card` / `data-run-back` 零残留。

`test/r18-styles.test.ts`（run 段重写，④ 分组标题与 ⑤ 纪律保留）

- ① 轨道：`display:flex` / `gap:8px` / `overflow-x:auto` / `overflow-y:hidden` /
  `scroll-snap-type:x proximity` / `scrollbar-width:thin` / `padding:4px` / `margin:0`。
- ① 算术：卡 216 三连写、gap 8、320px 下第二张露出 88px（≥ 1/3 卡宽）、
  六项每列 ≥ 60px 且 > 5 个 11px 汉字。
- ② 卡：三行网格、min-height 在 118–132、单行省略、18px 徽标封顶 96px、
  focus 环内缩、disabled .6、hover 不覆盖选中。
- ② 六项：3 列 × 2 行、标签/数值字号与 tabular-nums、不可得虚线 + 三级色 + 400。
- ② 正交：`[data-current]` 只允许 `border-left-color`；`[data-selected]` 不碰 border-left/outline；
  `data-fallback` 零规则。
- ③ 旧纵向行规则与旧钩子删净；横滑容器先于卡渲染、组件零 `div`、原生 `disabled`/`aria-pressed` 仍在。
- ⑤ 选择器清单加入 `[data-active-run-cards]`，减少动效块同时要求轨道与卡。

`test/r17-styles.test.ts` ⑥（只动 run 相关）

- run 区断言改成卡口径（轨道横滑、卡 216、第二张露出、当前 vs 选中、fallback 零规则）；
- `R17_SELECTORS` 加入轨道、钩子一致性清单加入 `data-active-run-cards`、
  减少动效断言加轨道；
- **子智能体主界面 / 历史六项 / 可点角色卡断言逐条保留、未放宽**。

## 6. 门禁结果（2026-11-05）

```
$ pnpm typecheck
> tsc --noEmit
exit 0

$ node --test test/r18-run-cards.test.ts test/r18-styles.test.ts test/r17-styles.test.ts test/client-ui.test.ts
ℹ tests 68
ℹ pass 68
ℹ fail 0
exit 0

$ pnpm test          # 全量回归（额外自查，不在任务门禁内）
ℹ tests 883
ℹ pass 883
ℹ fail 0
exit 0
```

## 7. 未做与声明

- **未 build、未 commit**（按任务约束）；改动只在上述 6 个文件内。
- **未做真机视觉验证**：本仓没有浏览器，以上断言全是「读 `styles.ts` + 真实元素树」的静态契约，
  只能保证规则存在、与 DOM 钩子对得上、算术放得进 320px；不能保证真机像素级观感。
  真机需目测：横滑顺滑度与 snap、`color-mix` 淡底/描边的实际混色、
  `tabular-nums` 回退字体下的六项对齐、触控板/滚轮横向滚动是否顺手。
- 素材：`docs/teamflow/2026-11-05-r18b-run-rows/r18b-tasks.png` 仍是 t2 行形态的截图，
  卡形态尚未截图（真机验收时补）。
- 若宿主给 `[data-panel-body]` 加内边距（当前没有），内容宽会从 320 变成 296，
  第二张卡露出量降为 64px，仍能看到「右边还有卡」，只是提示弱一些。

## 8. 真机验证（2026-11-05 13:46，第二宿主 dv/51890）

- 构建：`pnpm build` → `lib/client.js` 500,494 B / `lib/index.js` 471,289 B，覆入 `~/.dsh/profiles/dv/node_modules/dsh-auto-team/lib/`。
- 数据：为验证多卡横滑，临时在 `~/.dsh/auto-team/runs/` 放了 4 条**合成 run**（planStatus=dispatching、任务 running/blocked/pending），
  截图后**已全部删除**；截图只保存在本目录，不污染真实历史。
- 实测（1440×900、面板宽 618）：
  - 4 张卡全部渲染，`cardSize = 216 × 130`；六项 `gridTemplateColumns = 61.33px × 3`（3 列 × 2 行）。
  - 轨道 `clientWidth = 618`、`scrollWidth = 896`、`overflow-x: auto` → 第三张卡在右缘被裁、可横滑（`r18c-run-cards.png`）。
  - 点第 4 张卡：`[data-region="run-head"]` 切到 `run-mwfixd-004`、任务行切到「样例任务 D（等待）· 待派发」，选中钩子只在该卡
    （`r18c-run-cards-switch.png`）。
- 与 t8 静态算术的差异：本机面板实际宽 618（非设计稿 320），所以一屏能看到约 2.8 张卡；320px 下的「第二张露出 88px」
  仍是 `r18-styles` 里的算术断言，未在真机缩到 320 复测。
- 未 commit。
