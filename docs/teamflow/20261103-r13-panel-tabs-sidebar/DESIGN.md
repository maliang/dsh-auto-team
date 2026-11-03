<!-- meta: summary="r13 设计：右栏三页（任务/历史/记忆）+ 任务表两行式行（含 token/用时单元格与 data-usage-source）+ 自绘 DAG 流转图（148×56 节点）+ 危险动作确认弹窗（402px，默认焦点在取消）+ 左栏 panellist/main 两栏项目库（220px 列表、<720px 折叠）；全部复用 --dsw-* token，新增钩子只加不换" -->
基线依赖：`docs/teamflow/20261102-r11-team-scope-control`（写域/等待/门禁语义不改）、`docs/teamflow/20261101-r7-auto-team-panel-roles`（§0 craft 合同与 token 映射、面板 320px 宽度基线、页签字形与指示条）、`docs/teamflow/20261102-r10-autoteam-skills-toolbar`（样式单点 `AUTO_TEAM_CSS`、按钮 busy/error 纪律）
取代：`docs/teamflow/20261101-r7-auto-team-panel-roles#DESIGN §2.3`：面板任务区由「任务卡列表」改为「任务表行（两行式，56px/行）」，四页签改为三页签；r7 §0 的 token 表、状态反馈纪律、暂停态视觉身份**逐条继续有效**。

# DESIGN · r13 三页面板 / 自动派发 / 左栏「自动团队」

> **读法**：§0 是 craft 合同（数字直接抄，禁止形容词）；开发只读文件头，所以它必须排在最前。§1 起是 IA / 线框 / 交互 / token 映射 / 无障碍 / AC 对照 / 钩子清单。
> **本轮不新建设计系统**：继续用宿主 `--dsw-*`，**一个新 token 名都不造**；新增的只有钩子属性与组件文件。

## 0. 视觉与手感规范（先读这一节）

### 0.1 口径

- 只复用 r1/r7 已实测的 token（半径 / 描边 / 底色 / 文字 / 交互 / 状态 / 阴影 / 字体 / 缓动），本轮 **0 新增 token**。
- 字号一律 `font: var(--dsw-font-xs-13, 13px/20px sans-serif)` 这类**简写**，禁止 `font-size: var(...)`（无效声明、静默继承、构建与 console 都不报错）。
- 禁止 `#hex` 与写死 `rgba()` 实底色；半透明叠层只用 `color-mix(in srgb, var(--dsw-alias-state-… 12%, transparent)`，暗色主题自动跟随。
- 新增全部 hook 用 `data-*` 语义名（`data-tab` / `data-region` / `data-cell` / `data-usage-source` / `data-flow-node`），自有容器沿用 `data-auto-team-*`；**不重命名任何既有钩子**（r7 §0.0 的单一前缀裁决只覆盖 `data-auto-team-*` 族）。

### 0.2 表面处理（数字直接抄）

| 元素 | 半径 | 描边 | 底色 | 阴影 | 尺寸 / 间距 |
| --- | --- | --- | --- | --- | --- |
| 页签条 `[data-panel-tabs]` | 0 | 底部 1px `border-l2` | transparent | 无 | 高 **36px**，3 项等分；选中项底部 **2px** `business` 指示条（与 r7 逐字相同） |
| 页签按钮 | 0 | 无 | transparent | 无 | 高 36，`padding: 0 4px`；命中区随按钮满高 |
| run 头 `[data-region="run-head"]` | 0（贴内容顶） | 底部 1px `border-l1` | transparent | 无 | 高 **64px** = 8 + 20 + 4 + 20 + 8 + 2×2；`padding: 8px 12px` |
| 角色 chip（`[data-region="task-roles"]` 内） | 999px | 1px `border-l2` | `bg-layer-1` | 无 | 高 **24px**，`padding: 0 8px`，`gap: 6px`，**可换行**（`flex-wrap: wrap`，行距 6） |
| 任务表表头 | 0 | 底部 1px `border-l2` | `bg-base`（吸顶） | 无 | 高 **24px**，`padding: 0 12px`，`position: sticky; top: 0; z-index: 1` |
| 任务行（折叠） | 0 | 行间 1px `border-l1`（仅底边） | transparent | 无 | 高 **56px** = 8 + 20 + 2 + 18 + 8；`padding: 0 12px`；行间 `gap: 0`（靠描边分层，不用卡片阴影——56px 行加阴影会脏） |
| 任务行（展开） | 0 | 同上 | `bg-layer-2`（仅展开后的详情块） | 无 | 详情块 `radius-sm` 8，`padding: 10px`，上外边距 4 |
| 流转节点 `[data-flow-node]` | 8px | 1px `color-mix(tone 40%, transparent)` | `color-mix(tone 10%, transparent)` | 无 | **148×56**，`padding: 8px 10px`；tone = 状态语义色（running=business / done=success / rework·waiting=warn / failed=danger / 其余=neutral） |
| 流转边 | — | 1px `border-l3` | — | — | 三次贝塞尔水平 S 曲线；上游未终态 → `stroke-dasharray: 4 3` |
| 流转箭头 | — | 填充 `border-l3` | — | — | 6×6 三角，贴合目标节点左边缘 -2px |
| 流转画布 | `radius-sm` 8 | 1px `border-l1` | `bg-base` | 无 | `padding: 12px`；`max-height: 300px`，横纵各自滚动；列间距 **40px**，行间距 **16px** |
| 历史 run 行 | 0 | 行间 1px `border-l1` | transparent | 无 | 高 **56px**，`padding: 0 12px`（两行式，与任务行同高，切换页签时不跳动） |
| 记忆行 | 0 | 行间 1px `border-l1` | transparent | 无 | 折叠高 **44px** = 6 + 18 + 4 + 16；展开正文块 `radius-sm` 8 + `bg-layer-2`，`max-height: 240px` 内滚 |
| 记忆 token 估算 `≈N token` | — | 虚线 1px 底边（`border-bottom: 1px dashed border-l2`） | — | — | 纯文本，11px，`title` 写明估算公式 |
| 左栏栏目行 `[data-auto-team-nav]` | `radius-sm` 8 | 无（选中时左侧 2px `business` 竖条） | transparent；选中 `color-mix(business 10%, transparent)` | 无 | 高 **32px**，`padding: 0 8px`，图标 **16×16**（`currentColor`、`stroke-width: 1.5`）+ gap 8 |
| 项目库页面头 | 0 | 底部 1px `border-l2` | transparent | 无 | 高 **44px**，`padding: 0 14px`，标题 14px/600 |
| 项目库左列 `[data-region="project-list"]` | 0 | 右侧 1px `border-l1` | transparent | 无 | 宽 **220px**（`flex: 0 0 220px`），`padding: 6px` |
| 项目行 | `radius-sm` 8 | 无 | transparent；选中 `color-mix(business 10%, transparent)` | 无 | 高 **32px**，`padding: 0 8px`；名称 12px ellipsis + 右侧计数 11px tabular |
| 详情面板 `[data-region="project-detail"]` | 0 | 无 | transparent | 无 | 自适应，`padding: 12px 14px`；`min-width: 0` |
| 确认弹窗卡片 | `radius-lg` 16 | 1px `border-l2` | `bg-layer-2` | `shadow-lv3` | 宽 **402px**（`max-width: calc(100vw - 32px)`），`padding: 20px` |
| 弹窗遮罩 | — | — | `color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent)` + `backdrop-filter: blur(2px)` | 无 | `position: fixed; inset: 0; z-index: 40` |
| 确认按钮（危险） | `radius-sm` 8 | 1px `color-mix(danger 55%, transparent)` | `color-mix(danger 12%, transparent)` | 无 | 高 **28px**，`min-width: 72px`；文字 `danger`，**不做红底实心**（实心红在深色层上像"已发生"，且与状态色冲突） |
| 取消按钮 | `radius-sm` 8 | 1px `border-l2` | `bg-layer-1` | 无 | 高 28，`min-width: 72px` |
| 待确认标记 `[data-pending-badge]` | 999px | 无 | `color-mix(danger 14%, transparent)` | 无 | 高 **16px**，`padding: 0 5px`，11px；文字「待确认」 |

**禁用做法**：行不加 `box-shadow`（56px 高密列表里阴影=噪声）；不用渐变/发光（本产品是工具，不是 HUD）；不在页签或行上用 999px 圆角（只有 chip/badge 用胶囊）。

### 0.3 状态反馈（每个可交互元素缺一即不合格）

| 态 | 变化 | 时长 / 缓动 |
| --- | --- | --- |
| hover（行 / 页签 / 项目行 / 按钮） | `background: var(--dsw-alias-interactive-bg-hover)`；行内不改变文字色 | `120ms var(--ds-ease-in-out)` |
| active（按下） | `background: var(--dsw-alias-interactive-bg-active)` | `80ms` |
| focus-visible | `outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px` | 即时（无过渡） |
| 选中（页签 / 项目行 / 流转节点聚焦） | 页签：`label-primary` + 2px 底部指示条；项目行：business 10% 底 + 2px 左侧竖条 | `120ms` |
| disabled | `opacity: .55; cursor: not-allowed`；**尺寸与文案不变** | 即时 |
| busy（请求在飞） | 文案**逐字不变**，`aria-busy="true"`，`cursor: progress`，行首 12×12 旋转环（1px 描边 + 1/4 弧，`800ms linear infinite`） | — |
| 展开 / 收起（任务行、记忆行） | 详情块 `opacity 0→1` + `max-height` 由 0 到内容高（上限 320px）；**行本身高度过渡 120ms**，避免下方内容瞬移 | `120ms` |
| 流转节点选中 | 描边升到 `color-mix(tone 70%, transparent)`，`outline-offset: 0`；不放大、不改尺寸 | `120ms` |
| 「不可得」 | 文字 `label-secondary` + 虚线底边；`cursor: help`；`title` 给原因 | — |
| 服务端确认（hit-flash） | 收到快照且值已变 → `data-flash="true"` 300ms：`color-mix(business 20%, transparent)` → transparent | 300ms |
| error | 描边 `--dsw-alias-state-error-primary`，`[data-error]` + `role="alert"` 就地显示在控件下方 4px，200ms 淡入；**绝不乐观改文案** | 200ms |

**两条统一纪律**：① 一切写入类按钮在飞行期 `disabled` 但**文案不动**；② 危险动作的确认按钮**不许**在点击后立刻变成"已确认"——必须等快照回来。

### 0.4 动效 / 加载 / 空 / 错误（只列本轮新增或变化项）

- **页签切换**：不位移、不缩放，仅页体 `opacity 0→1` `100ms`；指示条 `120ms`。旧页签节点**从 DOM 移除**（不是 `hidden`）——AC-1 要求节点数 0。
- **页签状态保持**：三个页签各自记录滚动位置与展开项，切换回来原样恢复（模块级 `Map<TabKey, {scrollTop, expandedTaskId}>`，不落盘、不跨会话共享）。
- **首屏骨架**：任务表 4 行（每行 56px、`bg-layer-2`、无描边、`1200ms` 呼吸）；历史 3 行（56px）；记忆 3 行（44px）；流转画布 3 个 148×56 骨架节点。骨架条数与真实行高**逐一相等**，加载完成不跳高。**不用 spinner 做列表首屏**。
- **派发在途**：run 头第二行右侧出现 `● 正在派发…`（业务色圆点 6px，200ms 呼吸）+ 12×12 旋转环；完成后换成「自动派发已开启」静态文案，中间态「已派发 N 个」保留 **3000ms** 再淡出（`200ms`）。这是 AC-8 的可见性证据，不能只有 console。
- **空态**：沿用 r7 `[data-empty]` 三段式（标题 / 一句说明 / `[data-empty-next]` 下一步），左侧 2px `border-l3` 竖条。四处文案：
  - 任务页无计划：「尚未生成计划」／「告诉队长要达成的目标，计划落盘后会自动开跑」／下一步「对队长说一句话即可」；
  - 历史空：「还没有历史运行」／「每次计划落盘都会在这里留下一条记录」／下一步「先去任务页看一眼」；
  - 记忆空：「本项目暂无记忆」／「队长会在这里记下本项目的约定」／下一步「无」；
  - 全局空：「全局记忆为空」／「public 轨记忆作用于所有项目」／下一步「无」。
- **错误**：`[data-error]` + `role="alert"`，就地显示，不弹 toast（宿主无统一 toast 契约）；读接口失败时**保留上一次成功内容**并叠加一条错误条，不清空（清空会让用户以为数据没了）。
- **降级提示**：无 usage 来源时 run 头显示「token 不可得（无用量来源）」一行 11px `label-secondary`，**不复用空态**（空态是"没有数据"，降级是"有数据但拿不到该量"，两者混淆会让人以为计划没跑）。
- `@media (prefers-reduced-motion: reduce)`：关闭呼吸/旋转/高度过渡，全部静态；展开收起改为即时。

### 0.5 排版角色与数字对齐

| 用途 | token | 字重 | 其他 |
| --- | --- | --- | --- |
| 项目库页标题 / 弹窗标题 / 项目名 | `--dsw-font-sm-14` | 600 | 单行 ellipsis |
| 页签文字 | `--dsw-font-xs-13` | 500（选中 600） | 选中 `label-primary`，未选 `label-secondary` |
| 任务标题 / 记忆标题 / run 头 runId | `--dsw-font-xs-13` | 600 | 单行 ellipsis；runId 用 `var(--ds-font-family-code)` 11px |
| run 头指标（token 合计 / 用时） | `--dsw-font-xxs-12` | 500 | `font-variant-numeric: tabular-nums`，`label-primary` |
| 任务行第二段（角色 / token / 用时） | `--dsw-font-xxxs-11` | 400 | token、用时用 `label-secondary`（**不用 tertiary**：11px tertiary 在 `bg-layer-1` 上对比度不足，r4 实测同族问题） |
| 状态 badge | `--dsw-font-xxxs-11` | 500 | 与 tone 同色文字 |
| 表头标签 | `--dsw-font-xxxs-11` | 500 | `label-secondary`，字距 `letter-spacing: .02em` |
| 流转节点 id | `--ds-font-family-code` 11px | 500 | 单行 ellipsis |
| 门禁退出码 / 验收命令 | `--ds-font-family-code` 11px | 400 | `white-space: pre-wrap; word-break: break-all` |
| 元信息（起止时间、路径、run 数） | `--dsw-font-xxxs-11` | 400 | `label-secondary`；路径同名行显示 |

**数字一律 `tabular-nums`**：token、用时、run 数、消息条数、等待时长。千分位由宿主 `formatTokens` 单点给（客户端零拼接），时长由宿主 `formatDuration` 单点给（客户端不出现「分」「小时」字面量），这两条是 AC-7/AC-20 的静态断言对象。

### 0.6 几何自洽核算（按**最大取值**算，不是平均值）

1. **面板宽度基线 320px**，内容宽 = 320 − 2×12 = **296px**。
2. **任务行两行式**（关键：5 个字段塞不进 296 的单行表格，硬塞会把 token 数字截断——截断数字等于造假）：
   - 第一行：标题 `flex:1; min-width:0` + 状态 badge（最坏 4 字 = 44 + 12 padding = **58px**）；标题可用 296 − 58 − 8 = **230px**（12px 中文 ≈ 19 字）✓
   - 第二行：`grid-template-columns: minmax(0, 1fr) 76px 84px`，`gap: 8px`；角色列最窄 296 − 76 − 84 − 16 = **120px**（11px 中文 ≈ 10 字，超出 ellipsis）✓
   - token 列 **76px**：最坏 `999,999,999`（11 字符 tabular ≈ 67px）✓；「不可得」= 33px ✓
   - 用时列 **84px**：最坏 `999 小时 59 分`（≈ 71px）✓；「未开始」「不可得」≈ 33px ✓
   - 行高 56 = 8 + 20 + 2 + 18 + 8 ✓
3. **表头**与第二行同网格（`minmax(0,1fr) 76px 84px`），左格标签写 `任务 · 角色 · 状态`，因此 token / 用时**逐行右对齐**，跨行可比 ✓
4. **流转节点 148×56**：内容宽 = 148 − 20 = 128px；第一行 id（11px 等宽，6.6px/字符 → 最长 9 字符 = 59px）+ 状态点 8 + gap 6 = 73 ≤ 128 ✓；第二行 `token · 用时` 最坏 `999,999,999 · 999 小时 59 分` ≈ 67 + 12 + 71 = **150px > 128** → **降级规则**：第二行只放 `token`，用时放 `title` 与选中后的详情；或数字超 6 位时 token 缩为 `1.2M` 形式**并在 `title` 给全量**（禁止四舍五入后不说明）。
   > 明确写死：**节点第二行 = `formatTokens(tokens)`（超 7 字符时 `formatCompactTokens`）+ `·` + `formatDuration`；两者合计超 128px 时整体 `text-overflow: ellipsis` 并 `title` 给全文**，不允许节点被文字撑宽（会破坏列布局）。
5. **流转画布**：列 x 步进 **188px**（148 + 40），行 y 步进 **72px**（56 + 16）；内层 `width = cols×188 − 40 + 24`，`height = rows×72 − 16 + 24`；容器 `max-height: 300px`，两层滚动；100 任务（10×10）= 1864×784，靠滚动不缩字（缩字会让 token 不可读）。
6. **run 头 64px**：`8 + 20(行1) + 4 + 20(行2) + 8 + 2(边框)` ✓；行1 = runId + 计划状态 + 弹性空隙 + 「成员合计 12,345」；行2 = 起止时间 + 用时 + 弹性空隙 + 在途提示。
7. **左栏项目库**：容器宽 **≥720px** 时两栏（220 固定 + 自适应，右栏最窄 500px）；`<720px` 折叠单栏：列表满宽，进详情后列表 `hidden`、详情占满 + 顶部 32px 返回条。
   判据用**容器查询**：`.auto-team-library { container-type: inline-size }` + `@container (max-width: 719px)`；同时保留 `@media (max-width: 719px)` 兜底（宿主主区宽度与视口不同，二者任一命中即折叠）。
8. **确认弹窗 402px**：高 = 20 + 20(标题) + 8 + 36(两行对象信息) + 8 + 54(影响面最多 3 行) + 8 + 18(等待时长) + 12 + 28(按钮) + 20 = **232px** ✓；`max-height: calc(100vh - 64px)`，正文区 `overflow:auto`。
   若宿主右栏祖先带 `transform`，`position: fixed` 会被降级为相对该祖先定位 → **运行时自检**：`getBoundingClientRect().width < 360` 时给卡片加 `data-dialog-mode="inline"`，改成 `width: 100%` 的内联卡片（面板内滚动），保证任何宿主下都能完整看到按钮。
9. **项目行 32px**：名称 ellipsis + 计数（最坏 `9999` = 26px）+ gap 8；220 − 16 padding − 26 − 8 = **170px** 给名称（12px 中文 ≈ 14 字）✓
10. **记忆行 44px**：`6 + 18(标题行) + 4 + 16(时间行) + 0` ✓；`≈N token` 最坏 `≈12,345 token` ≈ **84px**，标题列 `flex:1; min-width:0` 后仍有 ≥ 296 − 84 − 12 = 200px ✓
11. **触控目标**：所有行高 ≥ 32px；页签 36px 满高命中；行内图标按钮（展开箭头）视觉 12px 但用 `::after { inset: -10px -8px }` 把命中区扩到 ≥ 32×32，不改变布局高度。

### 0.7 本产品的反模式（r1 §0.8 与 r7 §0.8 继续有效，本轮追加）

1. **不给 token 造假**：取不到就写「不可得」；`0` 与「不可得」必须一眼可分（0 是 `label-primary` 数字，不可得是 `label-secondary` + 虚线下划线 + `data-usage-source`）。绝不按标题字数、角色数、成员数推算。
2. **不让「不可得」与「未开始」共用样式**：任务是"还没跑"还是"跑了但没数据"是两种语义，颜色同为 secondary 但**文案必须是原文**（「未开始」/「不可得」），且 `data-duration-state` 区分。
3. **不把旧页签留在 DOM**：`PlanTab/MembersTab/RolesTab` 的挂载点必须为 0，不许 `display:none` 藏起来凑页面。
4. **不在 56px 行里塞复合徽标**：状态列最宽 58px（r4 实测「运行中·停滞」需 ≥110px 会撑破网格）；复合提示一律走展开详情或 `title`。
5. **不做乐观确认**：危险动作在快照确认前不改任何可见状态，不显示"已取消"。
6. **不用本插件自造 modal 层级**：弹窗渲染在已挂载的 Panel / library 页面内，`position: fixed` 贴视口；不 `document.body.appendChild` 造第二个 React root（会与宿主 HMR 抢节点）。
7. **不给流转图引第三方库**（`d3/mermaid/cytoscape/dagre` 一律 0），也不做缩放/拖拽平移（滚轮行为会与宿主主区冲突）。
8. **不在左栏页面重复实现任务表**：`TaskTable`/`MemoryList`/`RunHeader` 只有 1 个定义，左栏只做组合（AC-7/AC-18）。
9. **不给未知项目造名字**：路径不可得就是「未知项目 / 工作区不可得」，不许用会话 id 或首条任务标题拼一个假项目名。

## 1. 页面与信息架构

```
右栏面板 Panel（沿用挂载点与三步注册，不改）
├─ head（现有：标题 / 状态胶囊 / 刷新）—— 不动
├─ meta（现有：计划·成员·并发 / 队长模型 / 事件源）—— 不动
├─ progress-row（现有：完成 x/N · 计划状态 · 暂停）—— 不动
└─ tabs = tasks | history | memory        ← 3 项，旧 4 项移除
   ├─ tasks   RunHeader + RoleStrip[task-roles] + TaskTable[task-list] + FlowGraph[task-flow]
   ├─ history HistoryList ⇄ RunDetail（同 RunHeader+TaskTable+FlowGraph，面包屑返回）
   └─ memory  MemoryList(track=project) → 行内展开正文

左栏 sidebar.panellist「自动团队」→ main 页面 LibraryPage
├─ page head（标题 + 待确认标记）
├─ project-list（220px）：全局 / 各项目（最近活跃倒序）/ 未知项目（末位）
└─ project-detail：项目头 → 任务区（最近 1 个 run，复用 RunHeader+TaskTable）→ 项目记忆区（复用 MemoryList）
   └─ 三类详情（项目/任务/记忆）在主区内联展开 + 面包屑返回

确认弹窗 ConfirmDialog：由 Panel 与 LibraryPage 各自渲染同一个组件（未挂载即挂起，不执行）
```

## 2. 关键页面线框

### 2.1 任务页（默认页签）

```
┌ 自动团队 ──────────── [运行中] [刷新] ┐
│ 计划 5 · 成员 3 · 并发 2/3             │  ← 现有 meta，不动
│ 完成 2/5   [进行中]        [⏸ 暂停]    │  ← 现有 progress-row，不动
├─[任务]──[历史]──[记忆]────────────────┤  ← 36px，选中底部 2px
│ r1a2b3c · [运行中]   成员合计 128,430  │  ← run 头行1（runId 等宽 11）
│ 10:21:03 → 进行中 · 用时 12 分 8 秒    │  ← run 头行2；右侧「● 正在派发…」
│ 等效：无 usage 时此行变「token 不可得（无用量来源）」│
├───────────────────────────────────────┤
│ (架构师 3) (工程师 2) (QA 1)          │  ← 角色 chip，可换行
├───────────────────────────────────────┤
│ 任务 · 角色 · 状态        token   用时 │  ← 表头 24px 吸顶
│ ┌ 实现支付回调            [运行中]   │  ← 行1：标题 + badge
│ │ 工程师          1,203   3 分 12 秒 │  ← 行2：角色 / token / 用时
│ ├ 支付单测                [待返工]   │
│ │ QA              0       未开始     │
│ └ …                                   │
├───────────────────────────────────────┤
│ 流转图（画布，横向可滚）              │
│  ┌t1┐──▶┌t3┐──▶┌t5┐                  │
│  │  │    │  │    │  │                 │
│  └──┘    └──┘    └──┘                 │
└───────────────────────────────────────┘
```

- 行点击 = 展开/收起详情（整行可点，命中区满行高）；行内箭头图标仅作视觉提示。
- 展开详情字段：验收命令（代码块）、门禁（退出码 chip + 证据尾 5 行）、依赖（chip 列表）、写域（chip 列表）、最近消息条数、token/用时原因（`不可得` 的 reason 原文）。
- 展开时该行 `aria-expanded="true"`，详情块 `[data-task-detail]` 通过 `aria-controls` 关联。

### 2.2 历史页

```
┌ 历史 ────────────────────────────────┐
│ r1a2b3c [已结束]        128,430       │  ← 行1：runId + 计划状态 + 成员合计
│ dsh-auto-team · 5 任务 · 12 分 8 秒   │  ← 行2：项目名 · 任务数 · 用时
├───────────────────────────────────────┤
│ r19f0e1 [已终止]        23,004        │
│ …（首屏 50 条）                       │
│           [加载更多]                  │  ← 28px 次要按钮，居中
└───────────────────────────────────────┘
点开 → 同一页签内换成 RunDetail：
│ ← 返回历史    r1a2b3c · 2026-11-03 10:21 │  ← 面包屑条 32px
│ （以下 = 任务页那套 RunHeader/TaskTable/FlowGraph，数据来自该 run）
```

- 返回后：列表滚动位置与选中项恢复；面包屑是唯一返回入口（外加浏览器 `Esc` 不拦截，避免与弹窗冲突）。
- 历史详情内**只读**：不出现暂停、派发、确认类按钮；任务行不可展开动作，只能看证据（展开仍可）。

### 2.3 记忆页

```
│ 项目记忆（project）                    │  ← 分区小标题 11px secondary
│ 提测约定           ≈1,204 token       │  ← 标题 + 估算（虚线底 + title）
│ 建立 2026-10-30 · 修改 2026-11-02     │
│ ├ 正文（点击展开，pre-wrap 逐字）      │
│ 写域口径           ≈640 token         │
│ …                                      │
│ 空：本项目暂无记忆                     │
```

- **只列 project 轨**；public 一律不出现在此页（AC-6）。分区小标题写明「本项目」，避免用户以为看到的是全局。
- 正文按需 `GET /memory?track=project&name=…`；展开后与磁盘逐字节一致（不做 md 渲染、不 trim、不改行尾）。
- 行内不显示「删除/编辑」按钮（记忆编辑在设置页，本轮不新增写入口）。

### 2.4 左栏「自动团队」栏目

```
侧栏图标行： [◈ 自动团队]   ← panellist 一行，32px

main 页面（容器 ≥720px）
┌ 自动团队 ──────────────── [待确认] ┐  ← 44px 页头
├────────────┬───────────────────────┤
│ ◎ 全局     │ dsh-auto-team          │  ← 项目头 14/600
│ ▸ dsh-auto…│ /Users/…/dsh-auto-team │
│ ▸ teamflow │ 12 次运行 · 1.2M token │  ← 指标行 11px
│ ◌ 未知项目 │ 最近活跃 2026-11-03    │
│            ├───────────────────────┤
│            │ 任务（r1a2b3c · 10:21）│
│            │  （RunHeader 紧凑版）  │
│            │  （TaskTable 同组件）  │
│            ├───────────────────────┤
│            │ 项目记忆               │
│            │  （MemoryList 同组件） │
└────────────┴───────────────────────┘
```

- 左列 220px：`全局` 永远第一行（图标 ◎ + 文案）；项目行名称 = 路径 basename，`title` = 全路径；右端计数 = 该项目 run 数（11px tabular）。
- `未知项目` 固定末位，名称「未知项目」，计数存在但路径不可得；其详情任务区给出该 run 的任务，记忆区显示「不可得（无工作区）」。
- 选中「全局」：右列标题「全局记忆（public）」+ 提示「作用于所有项目」+ public 记忆列表（同一 `MemoryList`，track=public）。
- 详情进入方式：项目行点击只切换右列；任务行 / 记忆行点击 → 右列切换为详情 + 顶部 32px 面包屑（`← 返回` + `项目名 / 任务 t3`）；左列**不卸载**，选中态保持。
- `<720px` 折叠：左列占满；点项目 → 左列 `hidden`、右列占满 + 32px 返回条；返回恢复左列与选中项。

### 2.5 确认弹窗（危险动作）

```
┌ 终止整个运行 ─────────────── [不可逆] ┐  ← 标题 14/600 + 徽标
│ 动作  取消运行（cancel）              │
│ 对象  run r1a2b3c                    │
│ 影响  将取消 3 个在跑成员，未提交的改动可能丢失 │  ← 最多 3 行
│ 已等待 2 分 14 秒                    │  ← 未决不自动过期，显示等待时长
│                        [取消] [确认终止] │  ← 28px；默认焦点在「取消」
└──────────────────────────────────────┘
```

- 默认焦点 **取消**（不可逆动作的安全默认）；`Tab/Shift+Tab` 在两点内循环；`Esc` = 取消。
- 「不可逆」徽标用 danger 12% 底 + danger 文字，16px 高，不放图标。
- 确认按钮文案用**动词短语**（终止运行 / 跳过任务 / 强制并行 / 重新门禁 / 中断成员），不用「确定」。

## 3. 交互与动效要点

| 场景 | 行为 | 备注 |
| --- | --- | --- |
| 打开面板 | 默认 tasks 页签；快照未到时骨架 | 页签不记忆跨会话 |
| 计划落盘（外部） | run 头出现「● 正在派发…」，成员逐个出现在角色 chip 计数里 | 用户零点击即可见变化 |
| 任务进入终态 | 该行 badge 变色 + 300ms flash；流转节点描边变色 | 不重排列表（位置稳定才能核对） |
| 点流转节点 | 展开对应任务行并 `scrollIntoView({block:'nearest'})`（**instant**，不做 smooth） | 双向联动：展开任务行时对应节点描边高亮 |
| 点历史第二条 run | 页签内容换为 `buildRunDetail(source, runIdB)`，runId 逐字来自该条 | 防假绿：id 集合必须变 |
| 返回历史 | 恢复滚动位置（入详情前存 `scrollTop`，`useLayoutEffect` 还原） | 不做位移动画 |
| 危险动作发起 | 弹窗出现，`role="dialog" aria-modal="true"`，焦点进弹窗 | 未点确认**零副作用** |
| 确认 / 取消 | 走 `/act` → 等快照 → 弹窗关闭 + flash | 关闭动画 `100ms` 淡出，不做缩放 |
| 弹窗打开期间收到快照 | 影响面文案随之更新（成员数变化） | 不重置焦点、不重排在途内容 |
| 同一 run 第二条请求 | 返回已有 `pendingId`，弹窗**仍只 1 个** | 不叠加、不排队 |
| 在途提示消失 | 3000ms 后换静态「自动派发已开启」 | 不做 tooltip 心跳 |
| 页签切换 | 100ms 淡入；各页签滚动/展开状态保留 | 不整页重挂载（AC-23） |

## 4. 视觉规范（token 映射，禁止新造）

| 语义 | token | 用在哪 |
| --- | --- | --- |
| 面板/页面底色 | `--dsw-alias-bg-base` | 页体透明；画布用 base |
| 卡片/次级块 | `--dsw-alias-bg-layer-1` / `-layer-2` | chip 底 / 展开详情与弹窗 |
| 分隔线 | `--dsw-alias-border-l2` | 页头、页签条、表头、弹窗描边 |
| 弱分隔 | `--dsw-alias-border-l1` | 行间、左列分隔、记忆行间 |
| 强描边/边与箭头 | `--dsw-alias-border-l3` | hover 态、流转边、空态竖条 |
| 主文字 | `--dsw-alias-label-primary` | 标题、token 数字、用时数字 |
| 次文字 | `--dsw-alias-label-secondary` | 角色、表头、状态 badge 文字、不可得、元信息 |
| 主色 | `--dsw-alias-state-business-primary` | 选中指示条、focus ring、running、派发在途 |
| 成功 | `--dsw-alias-state-success-primary` | done / 已结束 |
| 警示 | `--dsw-alias-state-warn-primary` | rework / waiting / paused（**只做竖条、描边、微底，不做 11px 文字色**） |
| 危险 | `--dsw-alias-state-error-primary` | failed / interrupted / 不可逆徽标 / 确认按钮 |
| 中性 | `--dsw-alias-label-secondary` | cancelled / skipped / 未开始（不用纯灰新色） |
| hover / active | `--dsw-alias-interactive-bg-hover` / `-active` | 全部可点元素 |
| 阴影 | `--dsw-shadow-lv3` | 仅弹窗卡片（列表行零阴影） |
| 圆角 | `--dsw-radius-xs/sm/md/lg` | 4 / 8 / 12 / 16 |
| 字体 | `--dsw-font-xxxs-11` / `-xxs-12` / `-xs-13` / `-sm-14`；`--ds-font-family-code` | 见 §0.5 |

**主题适配**：所有语义色配 `color-mix`，不写死透明度常量；暗色主题下 `bg-layer-2` 上的 12% 底仍可见（r7 已验）。

## 5. 无障碍要点

- 页签：`role="tablist"` / 按钮 `role="tab"` + `aria-selected` + `aria-controls`；`←/→` 循环、`Home/End` 首尾；页体 `role="tabpanel"` + `aria-labelledby`（沿用 r7）。
- 任务表：语义化 `role="table"`（或 `table/thead/tbody` + `role="row"`），行 `aria-expanded`，详情块 `id` 由 `aria-controls` 关联；状态不要只靠颜色——badge 永远带文字。
- token/用时单元格：`<span data-cell="token" data-usage-source="unavailable" title="该 run 没有可用用量事件">不可得</span>`，屏幕阅读器读到的是「不可得」而不是「0」。
- 流转图：容器 `role="group" aria-label="任务流转图：5 个任务，6 条依赖"`；节点 `role="button" tabindex="0"` + `aria-label="任务 t3 运行中，token 1,203，用时 3 分 12 秒"`；`Enter/Space` 触发展开（P2 完善，但 `aria-label` 本轮就要有）。
- 弹窗：`role="dialog" aria-modal="true"` + `aria-labelledby`（标题）+ `aria-describedby`（影响面）；打开时焦点进弹窗，`Esc` 取消，关闭后焦点回到触发按钮。
- 左栏页面：`[data-region="project-list"]` 用 `role="listbox"` + `aria-activedescendant`，或退化为 `role="navigation"` + `aria-current="true"`（二者皆可，**必须有一个**，否则键盘用户不知道选中了什么）。
- 触控目标 ≥32px（见 §0.6.11）；`prefers-reduced-motion` 全静态。
- 对比度：11px 文本一律 `label-secondary` 及以上；warn 只用于非文本位置（与 memory.md 的既有结论一致）。

## 6. AC 对照（设计侧自检）

| AC | 设计落点 |
| --- | --- |
| AC-1 | §1：`data-tab` 恰三项；旧三页签从 DOM 移除（§0.4） |
| AC-2 | §2.1 三区块 `data-region` 齐备；角色 chip 集合 = 成员角色集合 |
| AC-3 | §0.6.2 行内恰 1 个 token / 1 个 duration 单元格；§0.7.1 的 0 与不可得可分；宽度按最大数字核算不截断 |
| AC-4 | §0.2 节点 148×56；§0.6.5 列步进 188 / 行步进 72；零第三方库 |
| AC-5 | §2.2 列表 50 条 + 加载更多；详情 runId 逐字来自该条；返回恢复滚动 |
| AC-6 | §2.3 只列 project 轨；正文 pre-wrap 逐字；token 标估算 |
| AC-7 | §7 组件单源清单：`RunDetail` 类组件 1 处定义 |
| AC-13 | §2.5 弹窗四要素 + 等待时长 + 默认焦点取消 + 单例 |
| AC-14 | §2.4 panellist 行 32px、两栏 220px、`<720px` 折叠 + 返回条 |
| AC-16 | §2.4 全局=public / 项目=project，两套内容不同 |
| AC-17 | §2.4 三类详情字段逐项列出 |
| AC-19/20 | §0.7.1/§0.7.2：不可得 vs 0 vs 未开始 三种语义视觉可分 |

## 7. 实现约束与钩子清单

**组件单源**（`src/client/views/`，每项 1 个文件、1 个定义；右栏与左栏只做组合）：

| 组件 | 职责 | 复用方 |
| --- | --- | --- |
| `RunHeader.tsx` | runId / 计划状态 / 起止 / 用时 / 成员合计 / 在途提示 | tasks 页、history 详情、library 项目详情 |
| `RoleStrip.tsx` | 角色 chip（名 + 模型 + 成员数） | tasks 页、history 详情 |
| `TaskTable.tsx` | 表头 + 行 + 展开详情（含 token/用时单元格） | tasks 页、history 详情、library 项目详情 |
| `FlowGraph.tsx` | 自绘 DAG（SVG 边 + div 节点） | tasks 页、history 详情 |
| `MemoryList.tsx` | 记忆行 + 正文展开（track 参数化） | memory 页、library 全局/项目记忆 |
| `ConfirmDialog.tsx` | 危险动作确认 | Panel、LibraryPage |
| `DetailPane.tsx` | 面包屑 + 详情容器 | history 详情、library 三类详情 |
| `EmptyState.tsx` | 三段式空态 | 全部列表 |

**钩子清单**（新增，逐字实现；旧钩子不改名）：

| 钩子 | 位置 | 值 |
| --- | --- | --- |
| `data-tab` | 页签按钮 | `tasks` / `history` / `memory` |
| `data-region` | 区域容器 | `task-roles` / `task-list` / `task-flow` / `run-head` / `project-list` / `project-detail` |
| `data-cell` | 任务行单元格 | `token` / `duration` |
| `data-usage-source` | token 单元格 | `provider` / `unavailable` |
| `data-duration-state` | 用时单元格 | `done` / `running` / `not-started` / `unavailable` |
| `data-flow-node` | 流转节点 | 任务 id |
| `data-auto-team-history-row` | 历史行 | runId |
| `data-auto-team-memory-item` | 记忆行 | `<track>/<name>` |
| `data-auto-team-nav` | 左栏 panellist 行 | 固定 `""`（属性存在即可） |
| `data-confirm-dialog` + `role="dialog"` | 弹窗 | — |
| `data-pending-badge` | 待确认标记 | — |
| `data-inflight-dispatch` | 在途提示 | `dispatching` / `dispatched` / `idle` |

**CSS 落点**：全部样式追加到 `src/client/styles.ts` 的 `AUTO_TEAM_CSS` 单串（仍是 1 个 `<style>`），不新增 `<style>` 注入点；选择器统一前缀 `.auto-team-*` 或属性选择器。

**不动的部分**：`Panel` 页头三段（head / meta / progress-row）、胶囊 `Option`、右栏三步注册、`RoleEditor`、`SettingsPage`。页签数量变化只影响 `TABS` 与页体分支。

## 8. 设计侧取舍（PRD §11 的 taste 项，设计给默认值）

| 项 | 设计默认 | 理由 |
| --- | --- | --- |
| 详情呈现 | 主区内联展开 + 面包屑返回（不用抽屉） | 返回天然保留滚动与选中；窄栏折叠时同一套逻辑可用 |
| 项目排序 | 最近活跃倒序，未知项目末位 | 与「我最近在看哪个项目」一致；全局恒首行 |
| 历史上限 | 全量 + 50/页「加载更多」 | 简单且不丢老 run；行高固定 56，加载不跳版 |
| 未决确认 | 挂起，不超时、不自动执行；弹窗显示已等待时长 | 危险动作静默作废比积压更糟 |
| 改已完成验收 | 确认后重跑门禁；按钮文案「重新门禁」 | 按钮说的就是将要发生的事 |
| token 不可得 | 单元格「不可得」+ title 原因；run 头一行降级说明 | 与 0 严格可分，不制造"几乎没花钱"的错觉 |
