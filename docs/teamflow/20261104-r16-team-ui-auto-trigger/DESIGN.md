<!-- meta: summary="r16 设计：§0 craft 前置（80px 环 r34/stroke8/内文16-13；角色列 180 宽/28 间距、列头01徽标+×N；节点180×64 tN+标题+状态；角色卡tN彩点+title/aria；左栏glyph watchdog+panel内联单一surface）；0 新 token，只加 2 个可选字段" -->
基线依赖：`docs/teamflow/20261104-r14-panel-canvas-redesign`（r14 的无限画布拖动/重置、角色卡片、项目库抽屉、门禁与形状普查行为不得回归）
取代：`20261104-r14-panel-canvas-redesign#DESIGN §0.1`（环 64 → 80）、`#§2.1`（角色卡三行 → 三行 + refs 行）、`#§2.2`（环几何）、`#§2.3`（总览 64+220 → 80+208）、`#§2.4`（节点 180×76 三行、角色名主标签 → 180×64 两行、tN 主标签 + 角色列头）。

# r16 设计：改代码即自动组队 · 角色列任务图 · 80px 进度环

> **读法**：§0 是视觉质量规格，数字直接抄，禁止形容词；开发只读文件头，所以它排在最前。§1 起是 IA / 线框 / 交互 / token / 无障碍 / AC 对照 / 钩子清单。
> **本轮不新建设计系统**：继续用宿主 `--dsw-*`，**0 新增设计 token**，不新增依赖；只改组件局部几何与 `data-*` 钩子。

---

## §0 craft 合同（先读这一节）

### 0.0 视觉意图（先定调，不是形容词）

本产品是**工程工作台**，不是仪表盘营销页。r16 的新界面要读成一块「团队泳道板」：

- **角色列头像表格的列，不像卡片堆**：列头是一条 32px 高的平面表头（`bg-layer-2` + 1px 描边），列内节点垂直对齐；**不做整列填充底色、不做玻璃/渐变/发光**——296px 宽里再加一层表面只会变脏。
- **`tN` 像 commit hash**：11px 等宽字体、`bg-layer-2` 小标签、4px 圆角；它是任务的身份，不是装饰。
- **进度环像仪表**：80px、8px 粗环、16px 大数字；靠粗细和字号建立存在感，**不靠阴影/发光**。
- **状态只做冗余通道**：颜色永远伴随文字（状态胶囊 / `title` / `aria-label`），灰度截图仍可读。
- **密度用 4px 网格**：卡片 gap 8、列内 gap 16、行内 gap 4；1px 描边，除抽屉外无阴影。
- **动效只表达状态**：不加入场动画、不做数字滚动、不做列切换动画；用户直接操控的画布不加过渡。

### 0.1 几何硬约束（数字必须自洽，改任一数都要重算本表）

| 容器 | 尺寸 | 推导 |
|---|---|---|
| 右栏面板 | 320 外 / **296 内容** | 320 − 12×2（`--dsh-sidebar-inline-padding`） |
| 圆形进度环 `[data-progress-ring]` | **80 × 80**，viewBox 80，r=**34**，stroke=**8** | 外径 34+4=38 ≤ 40（余 2px）；内圆直径 2×(34−4)=**60** |
| 任务总览 `[data-task-overview]` | **80 + 8 + 208 = 296** | 环 80、gap 8、任务列 208；列表内容宽 **184** |
| 角色卡片 `[data-role-card]` | **144 × ≥76** | 2 列网格 `(296−8)/2 = 144`；内容宽 **122** |
| 角色卡 refs chip（`t1`） | **约 33 × 18** | dot 6 + gap 4 + 文本 13.2 + padding 8 + 边框 2 |
| 画布 `[data-flow-canvas]` | **296 × 300** | 沿用 r14 视口高；内容可大于视口，靠平移 |
| 角色列头 `[data-flow-stage]` | **180 × 32** | 内容宽 160 = 18 徽标 + 6 + 106 名字 + 6 + 24 计数 |
| 画布节点 `[data-flow-node]` | **180 × 64** | 内容宽 158；两行 20+16 + gap 4 + padding 16 + 边框 2 = 58 ≤ 64 |
| 列步进 / 行步进 | **208 / 80** | 180+28 / 64+16 |
| 节点起始 y | **54** | 12 padding + 32 列头 + 10 gap |
| 画布内容高 | **130 + (rows−1)×80** | 54 + 64 + (rows−1)×80 + 12 |
| 抽屉 `[data-run-drawer]` | `min(520px,100%)` / 内容 **488** | 抽屉 2 列卡宽 **240**，内容 **218** |
| 面板内联项目库条 | **320 × 32** | 返回键 76 + gap 8 + 说明 220（说明文字区约 212） |
| 左栏 glyph | **16 / 18**（随宿主 size） | 不改变宿主行高；press `scale(.92)` 不占布局 |

**自洽验算（必须成立，否则规格作废）**

1. **环内 `999/999`**：内圆半径 = 34−4 = **30**；`999/999` 用 **13px/600 tabular**，6 位数字约 6×7.8=46.8 + 斜杠 3.9 = **50.7**，文字半对角 √(25.35²+10²) = **27.25 < 30**（余 2.75）。短文本 `99/99` 用 **16px**，宽约 43.2，半对角 √(21.6²+12²)=**24.7 < 30**。禁止 `text-overflow` 裁数字。
2. **节点第一行**：内容 158 = tN 24 + gap 4 + 标题 78 + gap 4 + 状态 48；标题 78px 约 7 个中文字（11px），超长 ellipsis + `title` 全文。`t99` 时 tN 约 30，标题仍有 72px。
3. **节点第二行**：最坏 `999,999,999`(≈67) + `·`(6) + `1h 23m 45s`(≈60) = **133 ≤ 158**；token 用 host 原串，不压缩。
4. **列头**：内容 160 = 徽标 18 + 6 + 名字 106 + 6 + 计数 24；名字 106px 约 8 个中文字（13px），超长 ellipsis。
5. **角色卡 refs**：内容 122；3 个 `t1` chip = 3×33.2 + 2×4 = **107.6 ≤ 122**；`t99` 每行 2 个（2×40+4=84）；换行不横向溢出，卡片按行增高（每行 +22px）。
6. **任务总览**：296 = 80 + 8 + 208；列表内容 184；最坏 meta（token 67 + 分隔 6 + 用时 60 + 角色 45）= **178 ≤ 184**，角色名先 ellipsis。
7. **两列画布**：12 + 180 + 28 + 180 + 12 = **412 > 296**——初始视口完整显示第 1 列、露出第 2 列 76px 的列头（含 01/02 徽标与部分名字），提示可拖；**不做缩放/自适应**（r14 anti-pattern）。
8. **内联条**：320 − 16 padding − 76 返回键 − 8 gap = **220**；「主区不可用，已在右栏打开」13 字 ×11px ≈143，单行不换行。

### 0.2 表面处理（半径 / 描边 / 底色 / 阴影）

| 元素 | 半径 | 描边 | 底色 | 阴影 |
|---|---|---|---|---|
| 进度环轨道 | — | **8px** `border-l2` | — | 无 |
| 进度环弧 | — | **8px** `state-business-primary`；完成时 `state-success-primary` | — | 无 |
| 角色列头 | `radius-sm` 8 | 1px `border-l1` | `bg-layer-2` | 无（表头，不是卡片） |
| 列头编号徽标 | 999（圆形） | 1px `border-l2` | `bg-layer-1` | 无 |
| 画布节点 | 8 | 1px `border-l2` | `bg-layer-1` | 无 |
| 节点 hover | 8 | 1px `border-l3` | `interactive-bg-hover` | 无 |
| `tN` 标签 | `radius-xs` 4 | 1px `border-l1` | `bg-layer-2` | 无 |
| 节点状态胶囊 | 999 | 1px `color-mix(tone 40%, transparent)` | `color-mix(tone 10%, transparent)` | 无 |
| 角色卡 | 8 | 1px `border-l1` | `bg-layer-1` | 无 |
| 角色卡 refs chip | 999 | 1px `border-l1` | `bg-layer-2` | 无 |
| refs 圆点 | 50% | 无 | `currentColor`（颜色来自 tone token） | 无 |
| 内联库条 | 0 | 底部 1px `border-l1` | `bg-layer-2` | 无 |
| 内联说明前的警示点 | 50% | 无 | `state-warn-primary` | 无 |
| glyph error | — | 无 | `color: state-error-primary` | 无 |
| 抽屉 | `radius-md` 12（仅左两角） | 左侧 1px `border-l2` | `bg-layer-2` | `shadow-lv3`（唯一浮层，沿用 r14） |

### 0.3 状态反馈（hover / active / focus / pressed / disabled）

| 场景 | 变化 | 时长 |
|---|---|---|
| 节点 hover | 底色 `interactive-bg-hover`，描边 `border-l3` | 120ms `--ds-ease-in-out` |
| 节点 active | 底色 `interactive-bg-active` | 80ms |
| 节点 focus-visible | `outline: 2px solid state-business-primary; outline-offset: 1px` | 即时 |
| 列头 / 列内空白处拖动 | 光标继承画布 `grab` → 拖动时 `grabbing`；**列头不是按钮，不抢 pointerdown** | 即时 |
| 画布拖动 | 只写 `transform`，无过渡；`data-dragging=true` 时 `user-select:none` | 即时 |
| 重置 | `[data-resetting=true]` 时 transform 过渡 160–180ms | 180ms |
| glyph hover | `opacity: .9 → 1`；不改变宿主行底色 | 120ms |
| glyph active | `transform: scale(.92)`（中心缩放，不占布局） | 80ms |
| glyph error | `color: state-error-primary`，保留 2s；`title` 写失败原因 | 200ms 淡入 |
| refs chip | 无 hover（非交互）；`title` 用原生提示 | — |
| 内联库条进入 | `opacity 0→1` + `translateY(-2px)→0` | 120ms |
| 环弧变化 | `stroke-dashoffset` 过渡 240ms；reduced-motion 关 | 240ms |
| 数据刷新 | 沿用 r14 `data-flash` 300ms，不新增 | 300ms |

### 0.4 动效 / 空态 / 加载 / 错误

- **角色列 / 节点不做入场动画**：同一渲染帧按新布局出现；否则拖动 50 节点会掉帧。
- **环**：只过渡 `stroke-dashoffset`；数字直接替换，不做滚动。
- **glyph**：只做 press 缩放；不得用「旋转/弹跳」这类与开关语义不符的动效。
- **内联库**：右栏内容切换用 120ms 透明度，不做横向滑入（320px 里滑动会像抽屉，语义不对）。
- **空态**：无任务 → 既有「计划里还没有任务…」+ 环 `0/0`（空弧、不 NaN）；无角色 → 不渲染空网格；旧快照无 `taskRefs` → 不渲染 refs 行（不写「0 个任务」）；旧快照无 `roleId` → 单列「角色未记录」。
- **加载**：沿用面板既有骨架（`aria-busy`），新组件不另造 spinner；内联库读取中沿用「读取中…」。
- **错误**：就地 `[data-error] role="alert"`；glyph 失败用 error 色 + `title`，**不向控制台抛未捕获错误**；不同时开两个 library surface。

### 0.5 字级角色

| 用途 | token | 字重 | 备注 |
|---|---|---|---|
| 列头角色名 | `--dsw-font-xs-13` | 600 | 单行 ellipsis；`title` 全文 |
| 列头编号 `01` / `×N` | `--dsw-font-xxxs-11` | 600 / 400 | tabular-nums；编号与计数同高 |
| 节点 `tN` | `--dsw-font-xxxs-11` + `--ds-font-family-code` | 600 | tabular-nums；文本严格 task id |
| 节点标题 | `--dsw-font-xxxs-11` | 400 | 单行 ellipsis + `title` 全文 |
| 节点状态胶囊 | `--dsw-font-xxxs-11` | 500 | 文案 = `statusBadge().text` |
| 节点 meta（token · 用时） | `--dsw-font-xxxs-11` | 400 | tabular-nums，`label-secondary` |
| 进度环数字（短） | `--dsw-font-h3-16` | 600 | tabular；`data-text-tier="short"` |
| 进度环数字（长） | `--dsw-font-xs-13` | 600 | tabular；`data-text-tier="long"` |
| 角色卡名字 | `--dsw-font-xs-13` | 600 | 沿用 r14 |
| 角色卡状态 / refs / meta | `--dsw-font-xxxs-11` | 400–500 | refs 的 `tN` 用 code 字体、600 |
| 内联说明 | `--dsw-font-xxxs-11` | 500 | `label-secondary`；不降到 tertiary |
| 图例 | `--dsw-font-xxxs-11` | 400 | `label-secondary` |

字号一律写 `font: var(--dsw-font-…, …)` **简写**；禁止 `font-size: var(--dsw-font-…)`。数字一律 `tabular-nums`。

### 0.6 本产品禁用做法（本轮 anti-patterns）

1. **不按依赖深度分列**：列必须是角色；零任务角色不出列；任务只出现在其 `roleId` 列。
2. **不把角色名放回节点第一行**：第一行必须是 `tN`；角色名只由列头承载（节点内不保留 `[data-flow-node-role]`）。
3. **不让状态只靠颜色**：refs 必须有 `title` 与 `aria-label`；节点状态胶囊必须有文字。
4. **不截断数字**：`999/999`、token、用时都不 `text-overflow`；宁可换字号档。
5. **不在 320px 里同时开 main + panel 两个 library surface**；不同时弹错误对话框。
6. **不让左栏 glyph 点击静默**：点击 1s 内必须有 `main|event|error` 结果；不得只写 `console.log`。
7. **不新增确认弹窗/额外一轮**：自动组队不弹「是否组队」，不锁输入框，不等成员。
8. **不用渐变/发光/毛玻璃/大阴影**；颜色只用宿主 token，不硬编码 hex。
9. **不为「泳道感」给整列铺底色**：列头 + 对齐 + 箭头已经足够；再加填充会让 296px 变挤。
10. **不让环仍是 64px 或文字不随环放大**：80px 是本轮明确契约。

---

## §1 信息架构与模块清单

```
右栏面板（320px）[data-auto-team-panel]
└─ 任务页 tasks
   ├─ [data-region="run-head"]          RunHeader（沿用）
   ├─ [data-role-grid]                  RoleCard × N（新增 refs 行）
   ├─ [data-task-overview]              ★ 80 环 + 208 任务列表
   └─ [data-flow-canvas]                ★ 角色列画布
       ├─ [data-flow-viewport]
       │   ├─ [data-flow-stage] × 角色数   列头（01 + 名字 + ×N）
       │   ├─ [data-flow-stage-link]      列间箭头
       │   └─ [data-flow-node] × 任务数   180×64，tN + 标题 + 状态
       ├─ [data-canvas-reset]
       └─ [data-flow-legend]

左栏 [data-auto-team-panellist]
└─ glyph（16/18）→ 点击 watchdog
   ├─ 主区可用 → [data-library-surface="main"]
   └─ 主区不可用 → [data-library-surface="panel"] + 一行说明

抽屉 [data-run-drawer]（520）
└─ 同一套 RunHeader / RoleGrid / TaskOverview / FlowCanvas
```

**模块新增/改动一览**

| 模块 | 状态 | 设计职责 |
|---|---|---|
| `views/ProgressRing.tsx` | 改 | 80 viewBox、r34、stroke8、文字 16/13、C=213.628 |
| `views/TaskOverview.tsx` | 改 | 80 + 8 + 208 网格；环列 sticky |
| `views/RoleCard.tsx` | 改 | 在 active task 后插入 refs 行；chip + 彩点 + title/aria |
| `views/FlowCanvas.tsx` | 改 | 角色列头、列间箭头、tN 两行节点、图例；拖动/重置不变 |
| `viewmodel.ts#flowLayoutOf` | 改 | 从 `roleId`（缺省 `roleName`）归一列；内部 `stages` 派生，不新增快照字段 |
| `host/library.ts#flowOf` / `client/viewmodel.ts#buildFlow` | 改 | 列 = 角色首次出现顺序，行 = 角色内计划顺序；填 `roleId` |
| `host/library.ts#rolesOf` / `client/viewmodel.ts#roleUsageOf` | 改 | 填 `taskRefs`（计划顺序、id + status） |
| `LibraryPage.tsx` / `Panel.tsx` | 改 | `data-library-surface`、glyph 点击 watchdog、内联条文案 |
| `styles.ts` | 改 | 下列选择器；0 新 token |
| `shared/types.ts` | 改 | 只加 `RoleUsageView.taskRefs?` 与 `FlowNodeView.roleId?` |

不新增工具、路由、页签、PanelAction、TaskStatus、ActivityEvent；不新增 `PlanTask.stage`；不新增顶层快照字段。

---

## §2 右栏任务页线框（296 内容宽）

```
┌ run-head ────────────────────────────┐ 沿用
├ 角色卡网格（2 列 × 8 gap）───────────┤
│ ┌─────────────┐ ┌─────────────┐      │ 144 × ≥76
│ │ 测试   待验收│ │ 开发   运行中│      │
│ │ 写门禁探针   │ │ 实现角色列   │      │
│ │ (•t1)(•t2)  │ │ (•t3)(•t4)  │      │ refs 可换行
│ │ 12.3k · 2m  │ │ 不可得 · 3m │      │
│ └─────────────┘ └─────────────┘      │
├ 任务总览 ────────────────────────────┤
│  ╭────╮  未完成 · 3                  │ 环 80 + gap 8 + 列表 208
│  │2/5 │  ...                         │
│  ╰────╯                              │
├ 流转画布 296×300 ────────────────────┤
│ [重置视图]                           │
│ ┌01 测试 ×2┐  →  ┌02 开发 ×3┐        │ 列头 180×32，28 gap
│ │ ┌ t1 … ┐ │     │ ┌ t3 … ┐ │        │ 节点 180×64，行步进 80
│ │ └──────┘ │     │ └──────┘ │        │
│ └──────────┘     └──────────┘        │
│ 实线=已完成  虚线=未完成              │
└──────────────────────────────────────┘
```

### 2.1 进度环 `[data-progress-ring]`（80px）

- 几何：`width=80 height=80`、`viewBox="0 0 80 80"`、圆心 `(40,40)`、`r=34`、`stroke-width=8`、`fill:none`；弧 `rotate(-90 40 40)`，`strokeLinecap="round"`。
- 周长 `C = 2π×34 = 213.6283`；`strokeDasharray=C`、`strokeDashoffset=C×(1−done/total)`；`total=0` → `C`（空环），**不出现 NaN/Infinity**；完成且 `total>0` 时弧色 success。
- 文字：严格 `${done}/${total}`；`text.length ≤5` → `data-text-tier="short"`，16px/600；`≥6` → `"long"`，13px/600。两档都 `tabular-nums`、`dominant-baseline:central`、`text-anchor:middle`。
- 容器：`role="img"` + `aria-label="已完成 X / 共 Y"`；`data-done` / `data-total` 保留。CSS 固定 80×80，**不得**再用 64。
- 布局：`[data-task-overview] { display:grid; grid-template-columns:80px minmax(0,1fr); gap:8px; padding:8px 12px 10px }`；`[data-overview-ring] { align-self:flex-start; position:sticky; top:0 }`；`[data-overview-list] { min-width:0 }`。
- 任务行 meta：角色名 `flex:1 1 auto; min-width:0; ellipsis`；token/用时 `flex:0 0 auto`；任何情况下 `[data-task-overview]` 的 `scrollWidth ≤ clientWidth`。
- 变体：`size` prop 缺省 80；右栏与抽屉同一组件、同一 `taskOverviewOf`；不做第二种环。

### 2.2 角色卡 `[data-role-card]` + refs

- 结构顺序（固定）：head（角色名 + 角色状态胶囊）→ `[data-role-active-task]` → **`[data-role-task-refs]`** → meta（token · 用时）。
- head 状态胶囊是**角色态**（执行中/待验收/需处理/已完成/待命）；refs 是**任务态**，两者语义不同，不合并。
- refs 行：`display:flex; flex-wrap:wrap; gap:4px; min-height:18px`；`role.taskRefs` 缺省/空 → **整行不渲染**（旧快照不显示「0」）。
- 每个 chip：

```html
<span data-role-task-ref data-task-id="t3" data-status="done" data-tone="success"
      title="t3 · 已通过" aria-label="t3 · 已通过">
  <span data-task-ref-dot data-tone="success" aria-hidden="true"></span>
  <span data-task-ref-id>t3</span>
</span>
```

- 文本只写 `tN`（`data-role-task-ref` 的 `textContent` 严格等于 task id）；状态中文只放 `title` 与 `aria-label`。**文案唯一来源**：`tN · ${statusBadge(status).text}`；`done` 在规范表里是「已通过」，PRD 的「t3 · 已完成」是口语化示例，测试以 `statusBadge().text` 为准，禁止为凑例句另造第二套状态词。
- chip 样式：18 高、`padding:0 4px`、1px border-l1、`bg-layer-2`、`radius 999`、11px；`tN` 用 `--ds-font-family-code`、600、tabular；dot 6×6、`margin-right:4px`、`border-radius:50%`。
- **dot 必须用 `color` + `background: currentColor`**（这样 `getComputedStyle(dot).color` 在 done/running 之间不相等）：
  - business → `--dsw-alias-state-business-primary`
  - warn → `--dsw-alias-state-warn-primary`
  - danger → `--dsw-alias-state-error-primary`
  - success → `--dsw-alias-state-success-primary`
  - neutral → `--dsw-alias-label-tertiary`
- 顺序 = 计划顺序（`taskRefs` 数组顺序）；数量 = `role.tasks`；不得只显示当前任务，不得跨角色。
- 卡片高度随 refs 行数增长；`[data-role-grid]` 仍 2 列 `repeat(2,minmax(0,1fr))`、gap 8；`min-width:0; overflow:hidden`，任何 chip 不横向溢出。抽屉卡宽 240、内容 218，可容纳更多 chip，但文本/属性与 320px 逐字相同（同一 `RoleCard` + `buildRunDetail`）。

### 2.3 角色列画布 `[data-flow-canvas]`

- **列定义**：列 = 有任务的唯一角色，按角色在计划中首次出现顺序编号 `01/02/…`；零任务角色不出列；`×N` 之和 = 任务总数。列头 DOM：

```html
<div data-flow-stage data-flow-column="0" data-role-id="dev"
     aria-label="角色列 01 开发，3 个任务">
  <span data-flow-stage-badge>01</span>
  <span data-flow-stage-name>开发</span>
  <span data-flow-stage-count>×3</span>
</div>
```

- 列头 180×32、`bg-layer-2`、1px border-l1、radius 8；内容 160：徽标 18（圆形，`bg-layer-1`、1px border-l2、11/600 tabular）+ gap 6 + 名字 `flex:1;min-width:0;ellipsis`（13/600）+ gap 6 + `×N`（11/400 secondary，tabular）。列头**不是按钮**，`pointerdown` 冒泡给画布用于平移；`aria-label` 给读屏。
- 节点 `left = 12 + col×208`、`top = 54 + row×80`；列头 `left = 12 + col×208`、`top=12`；列步进 208、行步进 80、画布 padding 12。
- 画布内容宽 = `24 + 180 + (cols−1)×208`；高 = `130 + (rows−1)×80`。2 列 = 412×…；初始 `translate(0,0)` 显示第 1 列完整 + 第 2 列 76px 列头，提示可拖；**不做缩放/小地图/自动适配**。
- 拖动/重置/键盘沿用 r14：4px 累计阈值、rAF 合帧、`setPointerCapture`、拖后抑制一次 click、±20000 clamp、方向键 24px、Home/r 重置 180ms；列头区域同样可拖，且不选中节点。
- 旧快照：若节点无 `roleId`，按 `roleName` 分组；两者都无 → 单列，列头写「角色未记录」；`taskRefs`/`roleId` 缺省不影响渲染。`flowLayoutOf` 内部派生列，不信任旧 `node.column`，也不新增 `FlowView.roleColumns` 顶层字段。

### 2.4 节点 `[data-flow-node]`（180×64）

```html
<button data-flow-node="t3" data-flow-column="1" data-status="gate"
        data-flow-row="0" title="t3 写门禁探针 · 角色 测试 · token 12.3k · 用时 2m 14s"
        aria-label="t3：写门禁探针，门禁中，token 12.3k，用时 2m 14s">
  <span data-flow-line="title">
    <span data-flow-node-id>t3</span>
    <span data-flow-node-title title="写门禁探针">写门禁探针</span>
    <span data-flow-status data-tone="warn">门禁中</span>
  </span>
  <span data-flow-line="meta">
    <span data-cell="token" data-usage-source="provider">12.3k</span>
    <span data-flow-sep aria-hidden="true">·</span>
    <span data-cell="duration" data-duration-state="running">2m 14s</span>
  </span>
</button>
```

- 第一行主标签 `[data-flow-node-id]` 文本严格等于 task id（夹具 `t1/t2/…`，匹配 `/^t\d+$/`）；紧随 `[data-flow-node-title]`（11px、ellipsis、`title` 全文）；右上角 `[data-flow-status]` 胶囊（文本 = `statusBadge(status).text`，tone 同上）。
- **节点内不渲染 `[data-flow-node-role]`**；角色名只在列头。若技术阶段为兼容旧测试保留，它必须是 11px `label-secondary` 的第二行副信息，且不得占据第一行。
- `tN` 标签：24×18（`t99` 自动到约 30）、radius 4、`bg-layer-2`、1px border-l1、11/600 `--ds-font-family-code`、tabular。
- 状态胶囊：18 高、`padding:0 5px`、radius 999、11/500、`max-width:48`、tone 10% 底 + 40% 边；文字不换行。
- 第二行 meta：token · 用时；token 用 host 原串（含「不可得」），用时用 cell 文本；tabular、`label-secondary`；不省略数字。
- `data-flow-column` 必须等于节点的角色列索引；`data-flow-row` 角色内序号；节点 `title` 含角色名（hover 仍知道归属），`aria-label` 以 `tN：标题，状态，token，用时` 为准。
- hover/active/focus 见 §0.3；节点仍是 `<button>`，键盘 Enter/Space 选中。

### 2.5 列间连接、任务边与图例

- **列间箭头**：相邻列头之间（y=28）画一条 20px 横线，`marker-end` 指向真实 `<marker>`；`data-flow-stage-link`、`data-upstream-done`。
  - 左侧列**全部**任务 `done` → 实线 + `state-business-primary`；
  - 否则 → 虚线 `4 3` + `label-tertiary`；
  - 箭头颜色跟随线；两条 marker（solid/dashed）或 `context-stroke` 均可，但 DOM 必须真的引用 `<marker>`。
- **任务边**：保留 r14 的 `[data-flow-edge]`、贝塞尔、`data-upstream-done`、箭头；上游 done 实线 business，否则虚线 tertiary。跨列/同列/回边沿用同一贝塞尔，边在节点下方（SVG 先渲染），不新增标签与字段。
- **图例**：画布左下角胶囊（`bg-layer-2`、11px）文案：`实线 = 已完成` / `虚线 = 未完成`；`title="任务边看上游任务；列间箭头看左侧角色列"`。AC-14 允许「左侧列已完成/未完成」的等价中文；这里用更短的通用句，避免 320px 换行。
- **重置按钮**：`[data-canvas-reset]` 文案「重置视图」、28 高、右上 8,8，沿用 r14；不因角色列头改变层级。

---

## §3 左栏 glyph 与项目库降级

### 3.1 左栏 glyph `[data-auto-team-panellist]`

- 仍是宿主行里的 16/18px SVG（`data-panellist-glyph`、`role="presentation"`、`focusable="false"`、`currentColor`）；**不包 `<button>`**，不改宿主行结构。
- 初始 `data-last-open-result="none"`；点击后 1s 内必须变成 `main|event|error`。`data-open-error="true"` 只在 error 分支保留 2s。
- 点击策略（**additive，不 stopPropagation**，保留宿主行原有 `layout.selectPanel` 能力）：
  1. 仅当注入的 `openLibrary` 是函数时挂 `onClick`；否则完全不拦截，交给宿主。
  2. 调用 `openLibrary()`（内部先 `mainArea.open(PANELLIST_ID)`；**不立即派发事件**）。
  3. 500ms watchdog：查 `document.querySelector('[data-library-surface="main"]')` 且 `getClientRects().length > 0`；有 → `data-last-open-result="main"`，结束。
  4. 无 → 派发 `OPEN_LIBRARY_EVENT`（`auto-team:open-library`），置 `event`；Panel 收到后若已存在可见 main surface，则忽略，保证单一 surface。
  5. 抛错 → 置 `error`，SVG `color` 转 error 色、`<title>` 写「打开项目库失败：…」，**不抛未捕获异常**。
- 点击结果的可视落点：`main` → 主区项目库出现；`event` → 右栏内联项目库 + 说明；`error` → glyph 红 + hover 文案。**任何分支都不静默**。
- 视觉：默认 `opacity:.9`、hover `1`；`:active { transform:scale(.92) }` 80ms；focus 由宿主行负责（SVG 不抢焦点）。

### 3.2 右栏内联项目库 `[data-library-surface="panel"]`

- 触发：Panel 监听 `OPEN_LIBRARY_EVENT`；若 `[data-library-surface="main"]` 可见则忽略；否则 `setInlineLibrary(true)`。
- 结构：`[data-panel-library-inline]` 替换页签/任务体（不叠加），顶部 `[data-panel-library-bar]` 32 高：
  - 左：`[data-library-inline-back]`「← 返回面板」（28 高、radius-xs、1px border-l2、`bg-layer-2`）；
  - 右：`[data-panel-library-hint]` **逐字**「主区不可用，已在右栏打开」，11/500 `label-secondary`，`role="status"` `aria-live="polite"`；前置 6px `state-warn-primary` 圆点（`aria-hidden`）。
- 内容：`<LibraryPage inline />`，根 `[data-auto-team-library][data-library-surface="panel"]`；沿用项目库的分栏/抽屉/run 行，不另写第二份。
- 不弹错误对话框；不向控制台抛未捕获错误；`[data-panel-library-inline]` 在 DOM 中最多 1 个。
- 返回：点「← 返回面板」恢复页签（`inlineLibrary=false`）；不改变当前页签状态。

### 3.3 主区项目库 `[data-library-surface="main"]`

- `LibraryPage` 非 `inline` 时根节点加 `data-library-surface="main"`；这是 AC-8/9 判断「主区可见」的唯一钩子。
- 主区可用时，glyph 点击后 500ms 内出现；不得再开 panel 镜像；主区与内联共用 `LibraryContent`。
- 抽屉 [data-run-drawer] 的几何/交互沿用 r14（`min(520,100%)`、遮罩、Esc、焦点陷阱、scrollTop 还原），本轮只改其内部 `RoleCard`/`FlowCanvas` 的尺寸，不改抽屉容器。

---

## §4 自动组队：本轮不新增任何 UI

- **不加确认弹窗、不加 toast、不加额外一轮、不锁输入框、不加 loading**：`auto_team_plan` 落盘 + 既有自动派发 kick；`auto_team_dispatch` 幂等返回「已受理/此前已自动派发」；队长立即结束本轮。
- **不加「计划」页签**（AC-19 页签仍 3）：计划通过 `auto_team_plan` 的返回 + 任务页的 run-head/角色卡/画布即时可见；不改变现有 `tasks/history/memory` 三页签。
- 派发受理后的界面反馈沿用 r14：页头胶囊「已接受派发」（warn），**不用「运行中」冒充已启动**；spawn 失败 5 秒内 `[data-panel-error] role="alert"`，任务保持 queued。
- 不显示缓存命中率；token/用时仍来自既有 cell，缺数据显示「不可得」+ 虚线下划线 + `title`，不估算、不补 0。
- 本节无 DOM 变更；AC-1~AC-7 的验收在提示词/工具/日志层，设计侧只保证「没有阻塞 UI」。

---

## §5 交互与动效细则（实现清单）

1. **画布拖动**：沿用 r14；`pointerdown` 只记录起点，累计位移 <4px 视为点击；≥4px 才 `setPointerCapture` 并写 `data-dragging`；`pointermove` 只写 viewport transform（rAF 合帧）；`pointerup` 落 state。列头/列头空白处同样冒泡到画布，不拦截。
2. **重置**：`translate3d(0,0,0)`；`data-resetting=true` 时 180ms 过渡；DOM 断言按 `translate(0px, 0px)` 归一（允许 ≤1px）。
3. **键盘**：画布 `tabIndex=0`，`aria-label="任务流转图，按角色分列，可拖动平移，方向键移动，R 键重置"`；方向键 24px，Home/r 重置；节点 Enter/Space 选中。
4. **glyph**：见 §3.1；watchdog 500ms；结果写 `data-last-open-result`；不 stopPropagation、不 preventDefault 宿主行。
5. **refs**：纯展示；不改任务、不打开详情；`title` 原生 tooltip；无 hover 位移。
6. **环**：`taskOverviewOf` 一次派生 done/total/dashOffset 与两组列表，同一帧更新；弧过渡 240ms；数字不做动画。
7. **内联库**：进入 120ms opacity；返回立即恢复；不卸载主区 library（如果存在，主区与内联不并存）。
8. **减少动效**：`prefers-reduced-motion: reduce` → 环过渡、glyph press、内联条、flash 全关；拖动跟手不变（用户直接操控）。
9. **不优化假状态**：refs/环/列头都来自快照与 `buildRunDetail`，不做乐观追加；派发后等真实事件。

---

## §6 token 映射（0 新增）

| 语义 | token |
|---|---|
| 列头底 / `tN` 底 / refs chip 底 / 图例底 | `--dsw-alias-bg-layer-2` |
| 节点底 / 徽标底 / 卡片底 | `--dsw-alias-bg-layer-1` |
| 描边 L1 / L2 / L3 | `--dsw-alias-border-l1` / `-l2` / `-l3` |
| 文字主 / 次 / 三 | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` |
| 交互底 | `--dsw-alias-interactive-bg-hover` / `-active` |
| 状态色 | `--dsw-alias-state-business-primary` / `-success-primary` / `-warn-primary` / `-error-primary` |
| 半径 | `--dsw-radius-xs` 4 / `-sm` 8 / `-md` 12 |
| 阴影 | `--dsw-shadow-lv3`（仅抽屉） |
| 字号 | `--dsw-font-h3-16`（环短）、`--dsw-font-xs-13`、`--dsw-font-xxxs-11` |
| 等宽 | `--ds-font-family-code`（tN / refs id） |
| 缓动 | `--ds-ease-in-out` |

**0 新增设计 token**；不新增局部 CSS 变量（列宽/步进用 TS 常量 + CSS 字面量，避免又一套 token）。不硬编码颜色。

---

## §7 无障碍要点

- 环：`role="img"` + `aria-label="已完成 X / 共 Y"`；数字是文本节点，读屏可读。
- 列头：`role="group"` + `aria-label="角色列 01 开发，3 个任务"`；编号/计数是文本，不靠颜色。
- 节点：`<button>`，`aria-label` 含 `tN`、标题、状态、token、用时；`title` 额外含角色名；状态胶囊有文字。
- refs：每个 chip `title` 与 `aria-label` 含 `tN · 状态中文`；圆点 `aria-hidden`；颜色不是唯一通道。
- glyph：宿主行是按钮；SVG `focusable="false"`、`role="presentation"`；`<title>` 给「自动团队 / 打开失败…」；不抢焦点。
- 内联说明：`role="status"` `aria-live="polite"`；返回键是原生 `<button>`。
- 对比度：11px 只用 `label-secondary` 及以上；`label-tertiary` 只用于分隔符/占位，不承载唯一信息。
- 触摸/键盘：画布方向键、Home/r；节点 Enter/Space；不引入仅 hover 可用的操作。
- `prefers-reduced-motion`：见 §5.8。

---

## §8 AC 对照

| AC | 设计落点 |
|---|---|
| AC-1/2/3/4/5/6/7 | §4：无确认弹窗/无额外轮/不锁输入；plan 返回 + 任务页即时可见；dispatch 幂等文案；无等待 UI。非 UI 部分交给提示词/工具/日志验收 |
| AC-8 | §3.1：glyph `data-last-open-result`、500ms watchdog、main/event/error、不静默、1s 内可见 |
| AC-9 | §3.2/3.3：`data-library-surface=panel|main`、逐字说明、单 surface、无未捕获错误、不弹对话框 |
| AC-10 | §3.1 的探针钩子（result + surface）供 QA 记侧栏宽度/main 注册/mainArea/构建四项；设计不替代真机证据 |
| AC-11 | §2.1：80px、r34/stroke8、文字 16/13、999/999 半对角 27.25<30、C=213.628、0/0 不 NaN、scrollWidth 约束 |
| AC-12 | §2.3：列=角色、零任务不出列、01/02 徽标、`×N` 求和=总数、`data-flow-column` 归属、旧数据回退 |
| AC-13 | §2.4：`data-flow-node-id`=tN、`data-flow-node-title`、状态胶囊、token/用时、角色名只在列头 |
| AC-14 | §2.5：列间箭头 `marker-end`、左列全 done 实线否则虚线、`data-upstream-done`、图例、任务边保留 |
| AC-15 | §2.3/§5：拖动 4px 阈值、列头可拖、重置、键盘、50 节点性能由既有测试覆盖；节点 180×64 不引入布局重算 |
| AC-16 | §2.2：refs 数量/集合/顺序/`data-task-id`/文本 tN；不显示别的角色任务 |
| AC-17 | §2.2：dot `color` + background、5 tone、`title`/`aria-label`、11px 对比度、浅深主题 token |
| AC-18 | §2.2：同一 `RoleCard` + `buildRunDetail`；320/抽屉 chip 文本与属性逐字相等；`min-width:0` 不横向溢出 |
| AC-19 | §1/§2.3：只加 `taskRefs?`、`roleId?`；不新增 `PlanTask.stage`/顶层字段；旧夹具单列/无 refs 回退；页签 3 等计数不变 |
| AC-20/21/22/23/24 | 不新增依赖/token；7 个变异探针中的环/角色列/节点主标签/refs/左栏兜底均有对应设计点；真机证据与文档由 QA/收口执行 |

---

## §9 新增/变更 `data-*` 钩子清单

**新增**：`data-flow-stage`、`data-flow-stage-badge`、`data-flow-stage-name`、`data-flow-stage-count`、`data-flow-stage-link`、`data-flow-node-id`、`data-role-task-refs`、`data-role-task-ref`、`data-role-task-id`（可选，等价 `data-task-id`）、`data-task-ref-dot`、`data-role-task-refs`、`data-library-surface`、`data-library-notice`、`data-last-open-result`、`data-open-error`、`data-panel-library-hint`（既有，文案更新）。

**语义变更**：`data-flow-column`（依赖深度 → 角色列索引）、`data-flow-node` 内部首行（角色名 → `tN`）、`data-flow-status`（纯文字 → 胶囊）、`data-flow-legend` 文案（上游 → 完成/未完成）。

**保留不变**：`data-flow-canvas`、`data-flow-viewport`、`data-flow-edge`、`data-upstream-done`、`data-canvas-reset`、`data-dragging`、`data-resetting`、`data-progress-ring`、`data-progress-text`、`data-role-card`、`data-role-name`、`data-role-status`、`data-role-active-task`、`data-role-usage`、`data-role-duration`、`data-task-overview`、`data-run-drawer`、`data-auto-team-panel`、`data-auto-team-library`、`data-auto-team-panellist`、`data-panellist-glyph`。
