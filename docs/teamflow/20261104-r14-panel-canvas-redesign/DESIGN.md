<!-- meta: summary="r14 设计：§0 craft 合同前置（几何自洽验算：角色卡片 144×76、进度环 64px r=28 stroke=6 内文 13/11px 两档、画布节点 180×76 步进 220/92、抽屉 min(520,100%)、项目列 160–360 仅 shell≥560 可拖）；新增组件 4 个（RoleCard、ProgressRing、TaskOverview、RunDrawer）与 3 个改造（FlowCanvas 平移、RunRow goal 标题、SplitHandle）；0 新增 token，只加 --lib-list-w 组件变量与 data-* 钩子" -->
基线依赖：`docs/teamflow/20261103-r13-panel-tabs-sidebar`（三页签、自动派发、共享视图、门禁与形状普查行为不得回归）；craft 合同沿用 `docs/teamflow/20261101-r7-auto-team-panel-roles#DESIGN §0`（token 表、状态反馈纪律、禁用做法）与 r13 §0 的 token 复用规则。
取代：`20261103-r13-panel-tabs-sidebar#DESIGN §2.3`（任务区「角色条 + 任务表」→「角色卡片 + 进度环任务列表」）、`§3.2`（静态流转图 148×56 → 可平移画布 180×76）、`§5.4`（项目页内联展开 → 右侧抽屉）。

# r14 设计：无限画布 · 角色卡片 · 进度环 · 项目库抽屉

> **读法**：§0 是 craft 合同，数字直接抄，禁止形容词；开发只读文件头，所以它排在最前。§1 起是 IA / 线框 / 交互 / token / 无障碍 / AC 对照 / 钩子清单。
> **本轮不新建设计系统**：继续用宿主 `--dsw-*`，**0 新增设计 token**；只新增一个组件局部 CSS 变量 `--lib-list-w`（项目列宽，默认 220px）与若干 `data-*` 钩子。

---

## §0 craft 合同（先读这一节）

### 0.1 几何硬约束（数字必须自洽，改任一数都要重算本表）

| 容器 | 尺寸 | 推导 |
|---|---|---|
| 右栏面板 | 320 外 / **296 内容** | 320 − 12×2（`--dsh-sidebar-inline-padding`） |
| 角色卡片 `[data-role-card]` | **144 × ≥76** | 2 列网格：(296−8)/2 = 144 |
| 卡片内容宽 | **122** | 144 − 2×1 边框 − 2×10 padding |
| 圆形进度环 `[data-progress-ring]` | **64×64**，r=**28**，stroke=**6** | 外径 28+3=31 ≤ 32（余 1px） |
| 任务列表列 | **220** | 296 − 64 − 12 gap |
| 任务行内容宽 | **196** | 220 − 24 padding |
| 画布 `[data-flow-canvas]` | 296 × **300**（`min-height:260`） | 沿用 r13 高 |
| 画布节点 `[data-flow-node]` | **180 × 76** | 内容宽 180−20−2 = **158** |
| 列步进 / 行步进 | **220 / 92** | 180+40 / 76+16 |
| 抽屉 `[data-run-drawer]` | `min(520px, 100%)` × 100% | 520 时内容宽 488 |
| 项目列表列 | **160–360**，默认 **220** | 分栏仅在 shell 内宽 ≥**560** 时启用 |
| 分栏手柄 `[data-split-handle]` | **6×全高**（热区 10） | 两侧各让 2px 伪元素扩热区 |

**自洽验算（必须成立，否则规格作废）**

1. **进度环内文**：内圆直径 = 2×(28−3) = **50**，可用半对角 ≤ 25。
   - `2/3`（3 字符）用 **13px/600** tabular：宽 ≈ 2×7.8+3.8 = 19.4，半对角 √(9.7²+6.5²) = **11.7 < 25** ✓
   - `999/999`（7 字符）降 **11px/600** tabular：宽 ≈ 6×6.6+3.2 = 42.8，半对角 √(21.4²+5.5²) = **22.1 < 25** ✓
   - 规则：文本长度 **≤5 → 13px，≥6 → 11px**；两档都装得下，禁止用 `text-overflow` 裁数字。
2. **画布节点第三行**（token · 用时）：最坏 `999,999,999`(≈67) + `·`(6) + `1h 23m 45s`(≈60) = **133 ≤ 158** ✓；token 用 host `formatTokens` 原串，**不压缩、不省略**。
3. **角色卡片第一行**：名字区 122 − 33（3 字徽标）− 6 gap = **83**，容 6 个中文字（13px）后省略 ✓。
4. **节点第一行**：158 − 33 − 6 = **119**，角色名不省略到不可读（≥4 字）✓。
5. **分栏**：shell 560 时列表 360 → 详情 200 − 28 padding = 172，仍可读；列表 160 → 详情 400−28 = 372 ✓。shell < 560 时**不渲染手柄**（列布局，列表 `max-height:168`），这是有意降级，不是缺陷。

### 0.2 表面处理（半径 / 描边 / 底色 / 阴影）

| 元素 | 半径 | 描边 | 底色 | 阴影 |
|---|---|---|---|---|
| 角色卡片 | `radius-sm` 8 | 1px `border-l1` | `bg-layer-1` | 无（密集卡片禁阴影） |
| 角色卡片 hover | 8 | 1px `border-l2` | `interactive-bg-hover` | 无 |
| 进度环轨道 | — | 6px `border-l2` | — | 无 |
| 进度环弧 | — | 6px `state-business-primary`；`done===total && total>0` 时 `state-success-primary` | — | 无 |
| 画布框 | `radius-sm` 8 | 1px `border-l1` | `bg-base` | 无 |
| 画布节点 | 8 | 1px `color-mix(in srgb, tone 40%, transparent)` | `color-mix(in srgb, tone 10%, transparent)` | 无 |
| 节点选中 | 8 | 1px `color-mix(tone 70%, transparent)` | 同色 14% | 无（**不放大、不改尺寸**） |
| 重置按钮 | `radius-xs` 4 | 1px `border-l2` | `bg-layer-2` | 无 |
| 任务分组头 | 0 | 底部 1px `border-l1` | `bg-layer-1`（sticky） | 无 |
| run 行 | 8 | 无（hover 才显底色） | transparent；hover `interactive-bg-hover`；当前 `bg-layer-2` + 左 2px `business` 内阴影 | 无 |
| 抽屉面板 | `radius-md` 12（仅左侧两角） | 左侧 1px `border-l2` | `bg-layer-2` | `shadow-lv3` |
| 抽屉遮罩 | — | — | `color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent)` | 无，`z-index: 30` |
| 分栏手柄 | 0 | 常态 1px `border-l1`（居中竖线）；hover/拖动 1px `business` | transparent | 无 |
| 历史桶行 | 8 | 无 | transparent，`label-secondary` 文字 | 无 |

### 0.3 状态反馈（hover / active / focus / pressed / disabled）

| 场景 | 变化 | 时长 |
|---|---|---|
| 卡片 / run 行 / 节点 hover | `background: interactive-bg-hover`；文字色不变 | 120ms `--ds-ease-in-out` |
| 卡片 / run 行 active（按下） | `background: interactive-bg-active` | 80ms |
| focus-visible（全部可交互元素） | `outline: 2px solid state-business-primary; outline-offset: 1px`（行内元素用 `-2px` 内描边） | 即时 |
| 画布抓取 | 常态 `cursor: grab`；`[data-dragging="true"]` → `cursor: grabbing`，且 `user-select: none`（**只作用于画布**） | 即时 |
| 重置按钮按下 | `background: interactive-bg-active` | 80ms |
| 分栏手柄拖动 | 竖线转 `business`；`document.body` 加 `cursor: col-resize`，画布/列表 `pointer-events` 不变 | 即时 |
| 抽屉进入 / 退出 | 见 0.4 | 160 / 120ms |
| 禁用 | `opacity: .5; cursor: not-allowed`（重置按钮在 `translate(0,0)` 时**不 disabled**，只是视觉弱化 `label-tertiary`，避免"按不动"的困惑） | — |
| 数据刷新 | 值变化 → `data-flash="true"` 300ms，`color-mix(business 20%, transparent)` → transparent | 300ms |

### 0.4 动效 / 空态 / 加载 / 错误

- **画布拖动**：`transform` 直跟指针，**无 transition**（有过渡 = 拖影）。重置时 `[data-resetting="true"]` 挂 `transition: transform 160ms var(--ds-ease-in-out)`，180ms 后移除。
- **进度环**：`stroke-dashoffset` 过渡 **240ms** `--ds-ease-in-out`；`prefers-reduced-motion: reduce` → `transition: none`。
- **抽屉**：进入 `translateX(16px)→0` + `opacity 0→1`，**160ms** `cubic-bezier(.2,0,0,1)`；退出 `120ms` 反向；遮罩 `opacity` 同步。
- **列表更新**：分组/圆环**同一渲染帧**更新（同一 state 派生），不做逐行入场动画（工具不是营销页）。
- **空态**：无任务 → 环显 `0/0`（不显示 NaN）+ 既有 `EmptyState`；无 run → 项目详情显「该项目还没有运行」；无角色 → 不渲染网格（不渲染空卡片）。
- **加载**：沿用面板既有骨架（`aria-busy`），新组件不另造 spinner。
- **错误**：就地 `role="alert"` + `state-error-primary` 描边，200ms 淡入；**绝不乐观改数字**。

### 0.5 字级角色

| 用途 | token | 字重 | 备注 |
|---|---|---|---|
| 角色卡片角色名 / run 行标题 / 节点角色名 | `--dsw-font-xs-13` | 600 | 单行 ellipsis；节点角色名**禁止回退任务 id** |
| 节点任务简述 / 卡片当前任务 | `--dsw-font-xxxs-11` | 400 | 单行 ellipsis，`title` 带全文 |
| 进度环数字 | `--dsw-font-xs-13`（≤5 字符）/ `--dsw-font-xxxs-11`（≥6） | 600 | **`font-variant-numeric: tabular-nums`** |
| 分组头「未完成 · 2」 | `--dsw-font-xxxs-11` | 500 | `letter-spacing: .02em`，`label-secondary`，计数 tabular |
| 卡片/节点 meta（token · 用时） | `--dsw-font-xxxs-11` | 400 | tabular-nums，`label-secondary`（**不用 tertiary**，11px 对比度不足） |
| 抽屉标题 | `--dsw-font-sm-14` | 600 | 单行 ellipsis |
| 抽屉副行（runId / 状态 / 时间） | `--dsw-font-xxxs-11` | 400 | runId 用 `var(--ds-font-family-code)` |

字号一律写 `font: var(--dsw-font-xs-13, 13px/20px sans-serif)` **简写**；禁止 `font-size: var(--dsw-font-…)`（无效声明、静默继承）。数字一律 `tabular-nums`。

### 0.6 本产品禁用做法（anti-patterns）

1. **不用渐变 / 发光 / 毛玻璃**：本产品是工具，不是 HUD；唯一允许的半透明是 `color-mix(tone N%, transparent)` 状态色叠层。
2. **卡片 / 行不用 999px 圆角**：胶囊只给 chip / badge。
3. **密集列表不加 `box-shadow`**：阴影 = 噪声；抽屉是唯一有 `shadow-lv3` 的浮层。
4. **画布不做缩放 / 小地图 / 惯性**：只做平移 + 重置；`touch-action:none` 只作用于 `[data-flow-canvas]`，绝不挂到 `body`。
5. **不为「好看」截断数字**：token / 用时 / `N/M` 永不 `text-overflow`；宁可缩字号（0.1 的两档）。
6. **不用纯色表达状态**：节点/行/卡片的状态必须有文字；颜色是冗余通道。
7. **不把「不可得」写成 0 或估算值**：缺数据显示「不可得」+ 虚线下划线 + `title` 说明。
8. **不做假 idle**：派发后界面状态必须来自真实 host 状态（AC-1 的反面）。
9. **不在右栏 320px 内做抽屉**：抽屉只在项目库页（main / panellist），右栏保持内联。
10. **不让抽屉把背景列表卸载**：卸载 = 丢 `scrollTop` 与焦点，AC-16 直接红。

---

## §1 信息架构与模块清单

```
右栏面板（320px）[data-auto-team-panel]
└─ 任务页 tasks
   ├─ [data-region="run-head"]        RunHeader（沿用，不改）
   ├─ [data-role-grid]                ★新 RoleCard × N（本 run 参与角色）
   ├─ [data-task-overview]            ★新：左 64 环 + 右 220 列表
   │   ├─ [data-progress-ring]        圆形进度环（done/total）
   │   └─ [data-region="task-list"]   复用 TaskTable，改成「未完成/已完成」两组
   └─ [data-flow-canvas]              ★改：可平移无限画布
       ├─ [data-flow-viewport]        transform 载体
       └─ [data-canvas-reset]         重置视图

左栏 / 主区项目库 [data-auto-team-library | data-auto-team-panellist]
├─ [data-library-head]               44px（沿用）
└─ [data-library-body]
   ├─ [data-region="project-list"]   220（可拖 160–360）
   │   ├─ 全局
   │   ├─ 各项目（按最近活跃倒序）
   │   └─ ★「历史运行（未记录工作区）」固定末位
   ├─ [data-split-handle]            ★新
   └─ [data-region="project-detail"]
       └─ run 列表：★[data-run-row]（goal 标题，一 run 一行）
           └─ 点击 → ★[data-run-drawer]（右侧覆盖，含 RunHeader/角色卡片/进度环+任务列表/画布）
```

**模块新增/改动一览**（文件与职责，供技术阶段对齐）

| 组件 | 状态 | 说明 |
|---|---|---|
| `views/RoleCard.tsx` + `[data-role-grid]` | 新增 | 替代 `RoleStrip.tsx`；抽屉与右栏共用（AC-9/17） |
| `views/ProgressRing.tsx` | 新增 | 纯 SVG 环，`role="img"` |
| `views/TaskOverview.tsx` | 新增 | 环 + 分组列表的容器；内部复用 `TaskTable` |
| `views/TaskTable.tsx` | 改 | 增 `grouped` 模式：去掉 sticky 表头，渲染两组 + 组头 |
| `views/FlowGraph.tsx` → `FlowCanvas.tsx` | 改 | 包一层 viewport + 指针平移 + 重置；节点几何 180×76 |
| `views/RunRow.tsx` | 新增 | 项目页 run 级行（goal 标题 + meta） |
| `views/RunDrawer.tsx` | 新增 | 右侧抽屉容器（焦点陷阱 / Esc / 遮罩） |
| `views/DetailPane.tsx` | 改 | 项目详情不再内联展开 run；改为触发抽屉 |
| `LibraryPage.tsx` | 改 | 分栏拖拽、历史桶、抽屉宿主 |
| `styles.ts` | 改 | 新增 `--lib-list-w` 与下列 `data-*` 选择器 |

---

## §2 任务页线框（296 内容宽）

```
┌ run-head ────────────────────────────┐  沿用：runId · 状态胶囊 · token/用时
├ 角色卡片网格 (2 列 × 8 gap) ─────────┤
│ ┌─────────────┐ ┌─────────────┐      │  144 × 76
│ │ ● 测试  待验收│ │ ● 架构师 执行中│     │  row1: 6px 状态点 + 角色名(13/600) + 徽标
│ │ 写门禁探针    │ │ 拆任务图      │     │  row2: 当前任务(11) 或「无进行中任务」
│ │ 12.3k · 2m 14s│ │ 不可得 · 进行中│    │  row3: token · 用时(11 tabular)
│ └─────────────┘ └─────────────┘      │
├ 进度总览 ────────────────────────────┤
│  ╭───╮   未完成 · 2            (24px) │  环 64 + gap 12 + 列表 220
│  │2/3│   ├ 写门禁探针   测试  ⏳       │
│  ╰───╯   ├ 拆任务图     架构师 ⏳      │
│         已完成 · 1            (24px)  │
│          └ 建夹具      测试  ✓        │  已完成行：对勾 + 弱化（label-secondary）
├ 流转画布 (296 × 300) ────────────────┤
│                        [重置视图]     │  sticky 于画布右上 8,8
│   ┌──────────┐  ──▶  ┌──────────┐    │  节点 180×76，可拖平移
│   │测试  待验收│       │架构师 执行中│   │
│   └──────────┘        └──────────┘    │
└──────────────────────────────────────┘
```

### 2.1 角色卡片 `[data-role-card]`

- 数量 = 本 run 任务里不同 `roleId` 数（**不是角色库全部**）；无任务不渲染网格。
- 结构：`data-role-id` 在根；`[data-role-name]`、`[data-role-status]`（带 `data-tone`）、`[data-role-active-task]`、`[data-role-usage][data-usage-source]`、`[data-role-duration][data-duration-state]`。
- 状态优先级（互斥，先命中先显示）：任一 `running` → 「执行中」(business)；任一 `gate` → 「待验收」(warn)；任一 `rework|failed|interrupted` → 「需处理」(danger)；全部 `done` → 「已完成」(success)；否则「待命」(neutral)。
- 当前任务：取 running/gate 任务标题；无则「无进行中任务」（`label-tertiary`，不加 `title`）。
- 缺用量：「不可得」+ 虚线下划线 + `title="该 run 没有可用量来源"`，**不显示 0**。
- 网格：`grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`，`gap: 8px`。296→2 列(144)，抽屉 488→3 列(157)，均 ≥140 ✓。

### 2.2 进度环 `[data-progress-ring]`

- 64×64 SVG，`viewBox="0 0 64 64"`，圆心 (32,32)，r=28，`stroke-width=6`，`fill:none`，`stroke-linecap="round"`。
- 轨道全圆 `stroke=border-l2`；弧 `stroke-dasharray = C = 2πr = 175.93`，`stroke-dashoffset = C × (1 − done/total)`；`total=0` → `dashoffset = C`（空环），**不出现 NaN/Infinity**。
- 弧起点 `transform="rotate(-90 32 32)"`（12 点起）。
- 圆心文字 `[data-progress-text]` 严格 `${done}/${total}`；字号按 0.1 两档；`dominant-baseline: central`。
- 容器 `role="img"` + `aria-label="已完成 X / 共 Y"`；`data-done` / `data-total` 供测试。
- 圆环列 `align-self: flex-start; position: sticky; top: 0`（列表滚动时环常驻）。

### 2.3 分组任务列表

- 两组：`[data-task-group="open"]` 在前、`[data-task-group="done"]` 在后；各自 `<ul>`，组头 `[data-group-head]` 高 24、sticky top 0、`bg-layer-1`、底 1px。
- 组头文案：`未完成 · N` / `已完成 · N`（N 为该组条数，tabular）。
- 分子只算 `status === 'done'`；`cancelled/skipped` 归未完成并在行内保留原徽标（口径写死，AC-12 表驱动）。
- 行沿用 r13 两行式（56px）：标题行 + meta 行（角色 / token / 用时）。**去掉 sticky 表头**（220 列放不下 76+84 两列，硬塞会截断数字）。
- 已完成行：标题前 14×14 对勾（`aria-hidden`）+ 标题 `label-secondary`；**不降低到 tertiary**（对比度）。
- 展开详情行为不变（`data-expanded`、左侧 2px 内阴影）。

### 2.4 流转画布 `[data-flow-canvas]`

- 结构：`[data-flow-canvas]`（`position:relative; overflow:hidden; height:300px; touch-action:none; cursor:grab; user-select:none`）→ `[data-flow-viewport]`（`position:absolute; top:0; left:0; transform: translate3d(x,y,0); will-change:transform`）→ 原有绝对定位内容层（宽高 = `layout.width/height`）。
- 节点 180×76：row1 状态点(6px) + `[data-flow-node-role]`(13/600) + 状态徽标；row2 `[data-flow-node-title]`(11, ellipsis, `title` 全文)；row3 token · 用时。`data-flow-node` 仍带任务 id。
- 边：始终带箭头（`marker-end`）；上游已完成 = 实线 + `business`；上游未完成 = 虚线 `4 3` + `border-l3`；`data-upstream-done` 与视觉一致。
- 图例固定在画布左下（`bg-layer-2` 胶囊，11px）：「实线 = 上游已完成 / 虚线 = 上游未完成」。
- 重置按钮 `[data-canvas-reset]`：绝对定位 `top:8; right:8; z-index:2`，高 28、`padding:0 8`、文案「重置视图」，`aria-label="重置画布视图"`，`<button>` 原生 Enter/Space 可触发。
- 平移范围限 ±20000px（防 transform 溢出），不做边界回弹。

---

## §3 项目库页线框（左栏 264–420 / 主区任意）

```
┌ library-head (44) ───────────────────────────────┐
├ project-list 220 ┊▍┊ project-detail ─────────────┤  ▍= [data-split-handle] 6px
│ ▸ 全局          ┊ ┊ 项目名 / 路径 / N 次运行       │
│ ▸ auto-team     ┊ ┊ ── 最近运行 ────────────────  │
│ ▸ 另一个项目     ┊ ┊ ┌ run 行 52px ────────────┐ │
│ ▸ 历史运行       ┊ ┊ │ 实现无限画布与角色卡片     │ │  [data-run-title] goal ≤24 字
│   （未记录工作区）┊ ┊ │ r14 · 完成 · 12.3k · 2m │ │  [data-run-meta]
│                 ┊ ┊ └──────────────────────────┘ │
└─────────────────┴─┴──────────────────────────────┘
                   点击 run 行 ↓
        ┌──────────── 遮罩 ────────────┐
        │        ┌─ 抽屉 min(520,100%) ─┐│
        │        │ 标题 + ×              ││
        │        │ run-head / 角色卡片    ││
        │        │ 进度环 + 任务列表      ││
        │        │ 流转画布              ││
        │        └───────────────────────┘│
        └──────────────────────────────────┘
```

### 3.1 分栏 `[data-split-handle]`

- 仅在 shell 内宽 **≥560px** 渲染（容器查询控制 `display`）；<560 走既有纵向堆叠（列表 `max-height:168` + 底部 1px）。
- 宽度来源：`--lib-list-w`（默认 220px）写在 `[data-library-shell]` 上；`[data-region="project-list"] { flex: 0 0 var(--lib-list-w, 220px) }`。JS 只改变量，不写内联 `flex`（否则覆盖容器查询的降级规则）。
- 拖动：`pointerdown` → `setPointerCapture`；`deltaX` 加到起始宽，clamp **160–360**；`pointerup` 释放。拖动中 `body { cursor: col-resize; user-select: none }`。
- 双击复位 220。键盘：`role="separator"` `aria-orientation="vertical"` `aria-valuemin=160` `aria-valuemax=360` `aria-valuenow=<当前>` `tabIndex=0`；ArrowLeft/Right 每次 **8px**，Home/End 到 160/360。
- 外框（宿主侧栏）宽度**不可调**：UI 不出现任何"调宽"控件；项目库页脚注一行 11px `label-tertiary`：「宿主未暴露左栏宽度接口，外框宽度固定」。

### 3.2 项目列表

- 行沿用 32px、`radius-xs`、`padding 0 8`；选中 `bg-layer-2` + 左 2px `business` 内阴影。
- 「历史运行（未记录工作区）」固定**末位**，`data-bucket="history"`；选中后详情头显示说明「旧版本 run 未记录工作区，无法自动归类」；**不并入当前项目**。
- 项目名仍是路径/工作区标识，12px ellipsis，右侧计数 11px tabular。

### 3.3 run 行 `[data-run-row]`（一 run 一行）

- 高 **52px**（`min-height`），`padding: 8px 12px`，两行：
  - row1 `[data-run-title]`：goal 缩写 **≤24 字符 + 「…」**（截断在 viewmodel 单点做，DOM 侧再加单行 ellipsis 兜底）；`title` = 完整 goal。无 goal 的旧 run → 「未命名任务 · <runId 后 6 位>」+ `data-title-source="fallback"`。
  - row2 `[data-run-meta]`：`<runId 后 6 位> · <状态徽标> · <token> · <用时>`，11px，tabular；缺量显示「不可得」。
- **禁止**标题等于 `t1/t2/...` 或裸 runId。
- 当前打开的 run：`data-open="true"` → `bg-layer-2` + 左 2px `business`。
- 行是 `<button>`（原生可聚焦）；整行可点。

### 3.4 抽屉 `[data-run-drawer]`

- 宿主：`[data-library-shell] { position: relative }`；抽屉 `position:absolute; top:0; right:0; bottom:0; width: min(520px, 100%); z-index: 31`；遮罩 `absolute; inset:0; z-index:30`。
- 语义：`role="dialog"` `aria-modal="true"` `aria-labelledby=<抽屉标题 id>`。
- 头部 44px：标题（goal 或 fallback）+ 副行 + 关闭按钮（`aria-label="关闭详情"`，28×28，`radius-xs`）。
- 内容：`RunHeader` → 角色卡片网格 → `TaskOverview` → `FlowCanvas`，**与右栏任务页同一批组件、同一 `buildRunDetail` 产物**（AC-9/17）。
- 宽屏从右滑入（`translateX(16px)→0`）；窄屏（`min()` 生效 = 100%）表现即全宽，不另写断点。
- 关闭：关闭按钮 / `Esc` / 点遮罩。打开时焦点移入抽屉（标题容器 `tabIndex=-1` 或首个可聚焦元素），Tab 循环限制在抽屉内；关闭后焦点回触发行，`[data-region="project-detail"]` 的 `scrollTop` 与打开前一致（打开前记录，关闭后回写，双保险）。
- 同时最多一个：状态为 `openRunId: string | null`；点不同行只换内容，**不叠加**（DOM 里 `[data-run-drawer]` 永远 ≤1）。

---

## §4 交互与动效细则（实现清单）

1. **平移手势**：`pointerdown` 记录起点，`pointermove` 累计位移；**位移 < 4px 不进入拖动**（视为点击，节点可正常选中/展开）。一旦 ≥4px → `data-dragging="true"` + `setPointerCapture`，并在 `pointerup` 后的首次 `click` 上 `preventDefault + stopPropagation`（一次性抑制，`pointerup` 后 0ms 清除）。
2. **拖动期间不改布局**：只写 `viewport.style.transform`（直接 DOM 写，不走 React state），`requestAnimationFrame` 合帧；`pointerup` 才把最终值写回 state。
3. **不滚页面**：`touch-action:none` 只在 `[data-flow-canvas]`；`pointerdown` 里 `event.preventDefault()` 仅当已判定为拖动。
4. **重置**：`transform = translate3d(0,0,0)`；DOM 断言按 `translate(0px, 0px)` 归一（允许 ≤1px 误差）。
5. **键盘平移**：画布 `tabIndex=0`，`aria-label="任务流转图，可拖动平移，方向键移动，R 键重置"`；Arrow 每次 24px，`Home`/`r` 重置。
6. **分组同步**：`done` / `total` / 两组数组从**同一个** `useMemo` 派生，禁止分别计算（AC-11 的"同一帧"由此保证）。
7. **抽屉**：`useEffect` 里绑 `keydown`（Esc）与焦点陷阱；卸载时移除。打开瞬间记录 `scrollTop` 与 `document.activeElement`。
8. **派发后可用性（AC-1/2/3）的 UI 侧**：派发返回「已接受」时，页头胶囊文案用「已接受派发」（warn），**不得**用「运行中」冒充已启动；spawn 失败时 5 秒内在 `[data-panel-error]`（`role="alert"`）出现错误行，任务保持 `queued`，不进入 running。

---

## §5 token 映射（0 新增）

| 语义 | token |
|---|---|
| 卡片 / 分组头 / 画布外框底 | `--dsw-alias-bg-layer-1` |
| 节点底 / 选中行底 / 抽屉底 | `color-mix(tone 10–14%, transparent)` / `--dsw-alias-bg-layer-2` |
| 描边 L1 / L2 / L3 | `--dsw-alias-border-l1` / `-l2` / `-l3` |
| 文字主 / 次 / 三 | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` |
| 交互底 | `--dsw-alias-interactive-bg-hover` / `-active` |
| 状态色 | `--dsw-alias-state-business-primary` / `-success-primary` / `-warn-primary` / `-error-primary` |
| 半径 | `--dsw-radius-xs` 4 / `-sm` 8 / `-md` 12 / `-lg` 16 |
| 阴影 | `--dsw-shadow-lv3`（仅抽屉） |
| 字号 | `--dsw-font-xxxs-11` / `-xxs-12` / `-xs-13` / `-sm-14` |
| 缓动 | `--ds-ease-in-out` |

**新增局部变量**（非设计 token）：`--lib-list-w`（默认 `220px`）。

---

## §6 无障碍要点

- 环：`role="img"` + `aria-label="已完成 X / 共 Y"`；数字本身可被读屏读到（文字节点）。
- 画布：可聚焦、方向键平移、`r`/`Home` 重置；节点是 `<button>`，`aria-label` = 「角色名：任务标题，状态」。
- 分栏：`role="separator"` + `aria-valuenow`；键盘可调；双击复位。
- 抽屉：`role="dialog" aria-modal="true"`，焦点陷阱 + Esc + 焦点归还。
- 状态不只靠色：每个徽标有文字；已完成行有对勾（`aria-hidden`，语义由 `aria-label` 给）。
- 对比度：11px 文字只用 `label-secondary` 以上，禁止 `tertiary`。
- `prefers-reduced-motion`：环过渡、抽屉位移动画、flash 全关；平移手势不受影响（用户直接操控）。

---

## §7 AC 对照

| AC | 设计落点 |
|---|---|
| AC-1/2/3 | §4.8：胶囊文案「已接受派发」；`[data-panel-error]` 5 秒内可见；任务不进 running |
| AC-4 | §2.4 + §4.1–4.5：`[data-flow-viewport]` transform、4px 阈值、`[data-canvas-reset]`、`touch-action:none` 限域 |
| AC-5 | §2.4 节点三行：`[data-flow-node-role]` = 角色名（缺失回退 roleId）、`[data-flow-node-title]`、状态徽标 + token·用时 |
| AC-6 | §2.4 边：恒有箭头、实/虚 + `data-upstream-done`、图例 |
| AC-7/8 | §2.1 卡片：数量按 roleId 去重、四要素、不可得文案 |
| AC-9 | §3.4 抽屉复用同一组件与 `buildRunDetail` |
| AC-10 | §2.2 环：`${done}/${total}`、C=175.93、`dashoffset`、0/0 不 NaN |
| AC-11 | §2.3 两组 + 组头计数；§4.6 同源派生 |
| AC-12 | §2.3 口径：只算 `done` |
| AC-13 | §3.1 手柄 160–360、双击 220、键盘 8px、外框如实说明 |
| AC-14 | §3.2 历史桶末位 + 说明；不并入当前项目 |
| AC-15 | §3.3 一 run 一行、goal ≤24 字、fallback 文案 |
| AC-16 | §3.4 抽屉：覆盖式、不卸载、Esc/遮罩/按钮、焦点与 scrollTop 还原、≤1 |
| AC-17 | §3.4 同源 |
| AC-18 | §0/§5：0 新增 token；仅新增 `data-*` 与组件文件 |
| AC-22 | §4.2 拖动只写 transform、rAF 合帧、不重排 |

---

## §8 新增/变更 `data-*` 钩子清单

`data-role-grid`、`data-role-card`、`data-role-id`、`data-role-name`、`data-role-status`、`data-role-active-task`、`data-role-usage`、`data-role-duration`、`data-task-overview`、`data-progress-ring`、`data-progress-text`、`data-task-group`（open/done）、`data-group-head`、`data-flow-canvas`、`data-flow-viewport`、`data-flow-node-role`、`data-flow-node-title`、`data-canvas-reset`、`data-dragging`、`data-resetting`、`data-split-handle`、`data-run-row`、`data-run-title`、`data-title-source`、`data-run-meta`、`data-run-drawer`、`data-drawer-run`、`data-bucket="history"`、`data-panel-error`。

> 既有钩子（`data-task-row`、`data-flow-node`、`data-upstream-done`、`data-task-toggle`、`data-expanded`）语义不变，只换外层容器与尺寸。
