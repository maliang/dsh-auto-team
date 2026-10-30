<!-- meta: summary="dsh-auto-team UI 设计：输入框下 dock 行开关 + 右栏面板四页（计划/成员/记忆/角色），状态=图标+文字+颜色三元组，全量复用宿主 --dsw-* token" -->
基线依赖：无（本仓尚无 `src/`，不存在既有前端设计系统；视觉规范取自宿主 `--dsw-*` token）

# DESIGN · dsh-auto-team

## 0. 视觉与手感规范（先读这一节；开发只看到文件头部，后面的是细则）

### 0.1 立场与 token 来源（实测，不是记忆）

- 本仓**没有** `src/`、没有历史 `design/DESIGN.md`：`ls` 根目录只有 `docs/`、`logs/`、`.gitignore`。因此**不新造设计系统**，全部视觉取自宿主主题 token。
- 宿主 token 实测自 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`（`grep -aoE '\-\-dsw-…:[^;"]*'`）：
  `--dsw-radius-xs:4px / -sm:8px / -md:12px / -lg:16px / -xl:20px`；`--dsw-alias-border-l1..l4`（亮色 `rgba(0,0,0,.04/.1/.12/.16)`，暗色 `rgba(255,255,255,.06/.12/.16/.2)`）；`--dsw-alias-bg-base/-layer-1/-layer-2/-layer-3`；`--dsw-alias-interactive-bg-hover / -active / -hover-accent`；`--dsw-alias-state-{success,warn,error,business}-primary`；`--dsw-alias-brand-primary`；`--dsw-shadow-lv1/2/3`；`--ds-transition-duration-fast:.1s / -slow:.3s`、`--ds-ease-in-out:cubic-bezier(.4,0,.2,1)`、`--ds-font-family-code`；`--dsh-composer-card-max-width:min(calc(100% - 16px),952px)`、`--dsh-composer-dock-inset:8px`、`--dsh-composer-stack-gap:6px`、`--dsh-sidebar-inline-padding:12px`。
- **字体 token 是 font 简写复合值**（`--dsw-font-xs-13: 13px/20px var(--dsw-font-family)`）。必须写成 `font: var(--dsw-font-xs-13)`；写成 `font-size: var(--dsw-font-xs-13)` 是**无效声明**，构建与 console 都不报错，元素静默继承父级字号——本项目明令禁止。
- **禁止任何硬编码颜色**（`#hex` / `rgba()` 除 0.08 级透明叠层用 `color-mix` 外）。亮/暗主题由宿主 token 自动切换，写死颜色＝暗色主题下必然破。

### 0.2 表面处理（数字直接抄）

| 元素 | 半径 | 描边 | 阴影 | 底色 |
| --- | --- | --- | --- | --- |
| dock 行（容器） | `--dsw-radius-md` 12px | 无 | 无（贴在输入卡下方，不加影） | 透明 |
| 状态胶囊 / chip | 999px | 1px `--dsw-alias-border-l2`（实心态无描边） | 无 | 见 0.4 |
| 按钮（主/次） | `--dsw-radius-sm` 8px | 次按钮 1px `--dsw-alias-border-l2` | 无 | 主 `--dsw-alias-button-primary-fill` + `--dsw-alias-label-primary-inverse` 文字；次 `--dsw-alias-bg-layer-1` |
| 图标按钮 24×24 | 8px | 无 | 无 | hover 时 `--dsw-alias-interactive-bg-hover` |
| 计划卡 / 记忆编辑器卡 | `--dsw-radius-md` 12px | 1px `--dsw-alias-border-l2` | `--dsw-shadow-lv1` | `--dsw-alias-bg-layer-1` |
| 面板抽屉（角色编辑） | 上沿 `--dsw-radius-lg` 16px | 上沿 1px `--dsw-alias-border-l2` | `--dsw-shadow-lv3` | `--dsw-alias-bg-layer-2` |
| 成员行 / 任务行 | 0（分隔线） | 底边 1px `--dsw-alias-border-l1` | 无 | 透明，hover `--dsw-alias-interactive-bg-hover` |
| 证据抽屉内代码块 | `--dsw-radius-sm` 8px | 无 | 无 | `--dsw-alias-bg-layer-3`，`--ds-font-family-code` |

要点：**不用渐变、不用发光、不用彩色描边**。唯一"强调"手段是 `--dsw-alias-brand-primary` 的 1px 焦点环与 2px 选中下划线。层级靠 `bg-base → layer-1 → layer-2 → layer-3` 四级底色区分，不靠阴影堆叠。

### 0.3 状态反馈（每个可交互元素都必须有，缺一即不合格）

| 交互态 | 变化 | 时长/缓动 |
| --- | --- | --- |
| hover（行/按钮/胶囊） | 底色 → `--dsw-alias-interactive-bg-hover`；文字不变 | 100ms `--ds-ease-in-out` |
| active / pressed | 底色 → `--dsw-alias-interactive-bg-active`，**不加**缩放（避免抖动） | 0ms（即时） |
| focus-visible | `outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px`；`outline` 不进布局 | 0ms |
| 开关（on） | track → `--dsw-alias-state-business-primary`；thumb 右移 14px | 160ms `--ds-ease-in-out` |
| 开关（off） | track → `--dsw-alias-border-l4`；thumb 左移 | 160ms |
| disabled | 透明度 `.45`，`cursor: not-allowed`，**必须**带 `title` + `aria-describedby` 说明原因（如"未启用：先打开开关"） | 0ms |
| 命中反馈（点击行展开/收起） | 左侧 2px 竖条由透明 → `--dsw-alias-border-l4`，120ms | 120ms |
| 状态变更 flash（AC-18 状态列） | 该行底色 8% 状态色 → 透明 | 120ms |

### 0.4 状态色板：状态 = **图标 + 文字 + 颜色** 三元组（禁止只靠颜色）

| 状态 | 文案 | 图标 | 颜色 / 底 | 形状 |
| --- | --- | --- | --- | --- |
| `running` | 运行中 | ● 实心点（1.6s 呼吸，reduced-motion 关） | `--dsw-alias-state-business-primary` | 实心胶囊，底 8% |
| `idle` | 空闲 | ○ 空心圈 | `--dsw-alias-label-tertiary` | 无底 + 1px `border-l2` |
| `blocked` | 阻塞 | ⛓ 链条 | `--dsw-alias-state-warn-primary` | 无底 + 1px **虚线**琥珀 |
| `rework` | 待返工 | ↺ | `--dsw-alias-state-error-primary` | 实心胶囊，底 12% |
| `done` | 已通过 | ✓ | `--dsw-alias-state-success-primary` | 无底 + 1px 绿 |
| `failed` | 失败 | ✕ | `--dsw-alias-state-error-primary` | 实心（红底 + 白字） |
| `interrupted` | 已中断 | ⚡ | 文字 `--dsw-alias-label-secondary` | 1px **虚线红** + 该行左侧 2px 红竖条 |
| 计划 `draft` / `dispatching` / `paused` / `terminated` / `cancelled` | 待派发 / 派发中 / 已暂停 / 已终止 / 已取消 | 中性 | `label-secondary` + `border-l2` | 无底胶囊 |

规则：任何状态在 DOM 里必须同时有 `data-status` 属性、图标、中文文字；**只有颜色差异的两种状态视为设计缺陷**（色弱与暗色主题下不可分）。

### 0.5 排版角色与数字对齐

- 面板标题（tab 文本）：`font: var(--dsw-font-xxs-strong-12)`（12px/18，500）
- 区块标题（"执行计划"）：`font: var(--dsw-font-s-14)`（14px/22）＋ `--dsw-alias-label-primary`
- 正文（任务标题、消息正文、记忆内容）：`font: var(--dsw-font-xs-13)`（13px/20）
- 辅助（时间戳、依赖、字符计数、模型 route）：`font: var(--dsw-font-xxxs-11)`（11px/14）＋ `--dsw-alias-label-tertiary`
- 等宽（模型 `provider/model`、任务 id `T1`、门禁命令、记忆正文）：`--ds-font-family-code`
- **所有数字**（并发 `2/3`、任务数、字符数、耗时、时间戳）加 `font-variant-numeric: tabular-nums`，右对齐列不得因位数变化抖动。
- 中文与等宽混排：模型 route 行单独一行，不与中文同行挤压（见 0.7 几何核算）。

### 0.6 动效、加载、空、错误

- 行插入（新成员/新任务）：`opacity 0→1` + `translateY(4px)→0`，160ms `--ds-ease-in-out`；**不加**列表整体位移。
- 状态切换：只做 0.3 的 120ms 底色 flash，不做位移、不做 scale。
- 面板/抽屉：宿主右栏自带过场，**不自造**动画；抽屉 `prefers-reduced-motion` 下直接挂载。
- 加载：仅首次拉取用骨架（3 行 40px 灰块，`--dsw-alias-bg-layer-2`）。**"成员在跑"永远不是 loading**——那是真实状态，必须给文字与时间戳。
- 空态（必须带下一步动作，不许留白）：
  - 计划空：`还没有计划` + 说明 `发送一句目标，队长会先给出执行计划，再派发成员`（开关关闭时追加 `开关当前为关闭，派发已禁用`）
  - 成员空：`暂无成员` + `计划开始派发后，成员会出现在这里`
  - 记忆空：`公共记忆还没有条目` + `新建文件`
  - 角色空（不可能，内置 6 个，但兜底）：`角色库为空，请新建角色`
- 错误：**行内**展示，红色 1px 左边框 + 11px 原因文字（例：`模型不可用：unknown model 'deepseek-x'`）；不用 toast 兜住 AC-22 的"拒绝派发"——拒绝原因必须留在计划卡里可回看。

### 0.7 几何自洽核算（按最大取值算，不是平均值）

- **dock 行**：高 32px（`align-items:center`），宽 `max-width: var(--dsh-composer-card-max-width)` 居中。最坏情况：开关 32 + gap 8 + "自动团队" 13px×4≈56 + gap 8 + 胶囊最宽文案 `计划就绪 · 5 任务`（12px，约 10 字≈120 + 左右 padding 16 = 136）+ gap 8 + 按钮（icon 12 + gap 4 + "面板" 26 + padding 16 = 58）= **306px ≤ 320px**（宿主窄窗最小内容宽）。宽度 <360px 时隐藏"自动团队"文字（保留 `aria-label`），仅留开关 + 胶囊 + 按钮（≈210px）。
- **开关几何**：track 32×18、radius 999、padding 2、thumb 14×14 → 行程 14px，与 0.3 的位移数值一致。
- **成员行网格**（面板内容宽最小 336px = 360 − 2×12 padding）：`grid-template-columns: 76px minmax(96px,1fr) 64px 44px; gap: 8px` → 76+8+96+8+64+8+44 = **304 ≤ 336**，剩余 32px 归任务列。第二行（模型 route + 相对时间）跨全宽，route 不参与横向竞争，因此 `deepseek-v4.1-flash`（19 字符 × 6.1px ≈ 116px）**不截断**（AC-22 要求逐字一致）。
- **行高**：成员行 = 8(pad) + 20(第一行) + 2 + 14(第二行) + 8(pad) = **52px**，分隔线 1px 由 `box-shadow: inset 0 -1px` 或 `border-bottom` 承担，不计入 52。
- **状态胶囊**：高 22px（12px 文字 + 上下 2px + 1px 描边），宽度 `max-content`，**不设 max-width**（状态文案是固定 3 字集合，最长"待返工"3 字 ≈ 36 + 16 = 52px < 64px 列宽，因此不会换行、不会撑破 0.7 的网格）。
- **计划卡任务行**：高 28px；`T1` 徽标 28×18（radius 4）；标题 `1 行省略 + title 属性`；依赖 chip 每个 ≤ 64px 且允许换行（换行时行高 → 44px，卡内无固定高度假设）。
- **记忆编辑器**：`min-height: 240px`，`font: 12px/20px var(--ds-font-family-code)`，宽度 100%（面板 336 内容宽 − 2×12 卡 padding = 312），每行最多约 52 个半角字符；**不横向滚动**（`overflow-wrap:anywhere`）。

### 0.8 本产品的反模式（写进 code review checklist）

1. 只给颜色不给文字/图标的状态点（0.4 已定义三元组）。
2. 显示"运行中"却不给"最近事件时间"——面板与事实脱节（AC-18 反面目标 4）。
3. 模型 route 截断成 `deepseek-v4…` 或显示"默认模型"（AC-22 要求逐字一致，禁止回退话术）。
4. 打开开关就静默起人（AC-30 反面目标 1）：开关只改变"是否允许派发"，第一个成员必须在计划条目之后。
5. 写了"可编辑"却只给只读列表（计划卡必须真能换角色/删任务）。
6. `font-size: var(--dsw-font-*复合token)` 这类静默无效声明。
7. 空态留白、禁用按钮不给原因、错误用 toast 一闪而过。
8. 记忆编辑器自动保存（必须显式"保存"并回显 mtime）。
9. 用 spinner 表示成员在跑；用 5s 轮询的"假刷新"却不显示时间戳（时间戳是可见性的证据）。
10. 硬编码亮色（白底黑字），暗色主题下直接瞎。

## 1. 页面/模块清单与信息架构

本产品**不新增路由**，只有两个宿主挂载面 + 四个面板页：

```
① 输入框下 dock 行（conversation.composer.dock，常驻，高 32）
   ├ 开关「自动团队」（默认关，按 sessionId 持久化）
   ├ 状态胶囊（已关闭 / 待派发 / 运行中 2/3 / 计划就绪 · N 任务 / 已暂停 / 已中断）
   └ 「面板」按钮（打开右栏面板并定位到当前最相关页）

② 右栏面板 tab「自动团队」（sidebar.right.pane.tab，标题可加状态点）
   ├ 头部运行条：状态 · 并发 n/上限 · [暂停/继续] [终止]（icon-only，带 aria-label）
   ├ Tab「计划」→ 执行计划卡（任务图/依赖/换角色/删任务/开始派发/取消计划）
   ├ Tab「成员」→ 成员行列表 → 展开：消息日志 + 继续对话输入 + 证据抽屉
   ├ Tab「记忆」→ 公共/项目分段 → 文件列表 → 编辑器（保存/删除确认/注入预算）
   └ Tab「角色」→ 角色列表（内置 6 + 自建）→ 编辑抽屉（名称/职责/技能/模型）
```

页间关系：dock 是唯一入口与唯一"开关真相"；面板是只读视图 + 编辑入口，**不承载开关**（避免两处状态源）。

## 2. 关键页面线框（布局 / 组件 / 状态）

### 2.1 dock 行（三态）

```
[●——] 自动团队   已关闭                                    [面板]
[●——] 自动团队   待派发 · 4 任务                            [面板]
[——●] 自动团队   ● 运行中 2/3   ↺ 1 返工                   [面板]
                  ^琥珀"计划就绪 · 4 任务"时整条胶囊为琥珀实心
```
- 结构：`<div data-dsh-auto-team-toggle role="group">` → 开关（`role="switch" aria-checked`）+ 文案 + 胶囊（`aria-live="polite"`，仅在**运行级**状态变化时更新文本）+ 按钮。
- 关闭态：开关 off、胶囊"已关闭"（中性）、面板仍可打开（可看角色/记忆/上次计划，派发按钮 disabled 且带原因）。
- 窄窗（<360）：隐藏"自动团队"文案。
- 点"面板"：若面板未挂载 → 注册并聚焦右栏 tab；已挂载 → 切到最相关页（有待派发计划 → 计划页；有 interrupted 成员 → 成员页；否则计划页）。

### 2.2 计划页

```
自动团队                                        ● 运行中 2/3
────────────────────────────────────────────────────────
[计划] 成员 记忆 角色
┌ 执行计划 ──────────────────────── 待派发 · 23:41:07 ┐
│ 预计并发 2/3 · 角色 3 · 模型 deepseek-chat          │
│ ─────────────────────────────────────────────────  │
│ [T1] 实现 CSV 导出            角色 开发 ▾   ✕       │
│ [T2] 补单元测试    ← T1       角色 测试 ▾   ✕       │
│ [T3] 更新 README   ← T1       角色 文档 ▾   ✕       │
│ ─────────────────────────────────────────────────  │
│                        [取消计划]      [开始派发]    │
└────────────────────────────────────────────────────┘
无计划时：空态文案 + 一句目标示例（灰底提示块）
```
- 任务行：id 徽标（等宽 11px）+ 标题（13px 单行省略，`title` 全量）+ 依赖 chips（`← T1`，11px，琥珀/中性）+ 角色下拉（高 24，替换即写入计划，AC-14）+ 删除 ✕（二次确认：删被依赖的任务时提示"N 个下游任务将一并移除"）。
- 依赖可视化：不画连线图（面板宽度不足），改用 chips + 就绪/阻塞分组：任务列表按「就绪 → 阻塞 → 已完成」三段分组，段标题带计数（tabular-nums）。
- 计划生成时：自动打开面板到计划页，胶囊切"计划就绪 · N 任务"（琥珀），**此刻成员数必须仍为 0**（AC-30）。点"开始派发"后才创建成员；"取消计划"→ 计划态 `cancelled`、成员 0、胶囊回"待派发"或"已关闭"。
- 派发中：按钮区变"派发中 2/3"，禁用重复点击；单个成员创建失败（如 `No subagent slot is free`）→ 该任务行内红字原样显示宿主错误，状态回 `blocked` 并标"排队中"。
- 模型不可用：该任务行红边 + `模型不可用：<原因原文>`，"开始派发"禁用（AC-22，禁止回退队长模型）。

### 2.3 成员页

```
[计划] 成员 记忆 角色                        2 运行 · 1 中断
┌────────────────────────────────────────────────────┐
│ 开发        实现 CSV 导出      ●运行中   12s 前      │
│ deepseek-chat · deepseek-v4.1-flash       [证据][▾] │
├────────────────────────────────────────────────────┤
│ 测试        补单元测试         ⚡已中断  3m 前       │
│ deepseek-chat · deepseek-chat             [证据][▾] │
└────────────────────────────────────────────────────┘
展开后：
│ 消息  23:38:02 队长→测试  请补 T2 用例（task T2）    │
│       23:39:10 测试→队长  已补 6 条，门禁失败见证据  │
│ [继续对话…                              ] [发送]     │
```
- 行首列角色名（76px，13px，超长省略 + title）；第二列当前任务；第三列状态胶囊；第四列相对时间（tabular-nums，`title` 给绝对时间）。
- 第二行：`实际 provider/model`（等宽 11px，**逐字**）+ 右对齐「证据」链接 + 展开箭头。
- 状态来源：`data-status` 由宿主成员状态映射；`interrupted` 必须在成员死亡后 ≤5s 出现（前端以成员事件流驱动，另设 5s 一次的轻量兜底刷新；**不写**"若 30s 无事件就自行改状态"这种推断逻辑）。
- 心跳提示：`running` 且距最近事件 >30s → 时间戳转琥珀并追加"静默 32s"（仅提示，不改状态）。
- 证据抽屉（点「证据」）：`任务 T2 · 门禁` + 命令（等宽块）+ 退出码（等宽，红/绿）+ 输出尾部（等宽块，`max-height:180px` 滚动）+ 产物路径 + 时间戳。失败证据同时出现在消息流里（AC-19）。
- 继续对话：提交后该成员**同一实例**续跑，成员总数不变；行状态 → `running`，输入框清空并显示"已发送 · 23:41"（AC-16）。

### 2.4 记忆页

```
[计划] 成员 记忆 角色
[ 公共记忆 | 项目记忆 ]           预计注入 812 / 4000 字符
┌ 文件 ───────────┐┌ conventions.md ─────────── 已截断 ┐
│ conventions.md  ││ # 项目约定                                 │
│ gotchas.md      ││ - 提交前必须…（正文，等宽 12/20）           │
│ + 新建          ││                                            │
└─────────────────┘└──────────────────────── 1,204 字符 [保存] [删除] ┘
```
- 双轨分段控件（高 28，选中项 2px 下划线）；顶部预算行：`预计注入 N / 4000 字符`（超限时 N 转琥珀 + 右侧"已截断"chip，AC-25）。
- 窄栏（<400）：列表与编辑器切换为两态（点文件进编辑器，顶部返回"← 文件"），不做左右分栏。
- 保存：显式按钮，保存后显示 `已保存 · 23:41:07` 与 mtime；未保存离开 → 确认"放弃未保存改动？"。
- 删除：二次确认弹层，写明文件名 + 红色"删除"；非法路径（`..` / 越出两轨根）错误以行内红字展示（AC-24）。
- 只读态：成员追加的条目带来源标注（`— 开发 / T1 / 23:40`），11px 灰；用户全量可编辑。

### 2.5 角色页 + 编辑抽屉

```
[计划] 成员 记忆 角色                        [ + 新建角色 ]
┌ 开发        实现任务、改代码        技能 2 · deepseek-chat ▾ ┐
│ 测试        写用例、跑门禁          技能 1 · deepseek-chat    │
│ 产品经理 …                                                    │
└──────────────────────────────────────────────────────────────┘
抽屉（上滑 60% 高，radius 16 上沿）：
名称 [开发            ]（必填，失焦校验）
职责 [多行 3 行      ]
技能  · tdd.md  ✕    · code-review.md ✕    [+ 添加技能]
模型 provider [deepseek-chat]  model [deepseek-v4.1-flash]  effort [medium ▾]
⚠ 改动将在下次派发生效，已存在的成员不受影响
                                        [取消]  [保存]
```
- 内置 6 角色带"内置"标记（不可删，可改 → 生成覆盖副本或就地改，按技术方案定；UI 上删除按钮对内置项 disabled 并给原因）。
- 删除确认：弹层写明"角色名 + 该角色在 N 个计划任务中被引用"。
- 模型校验：保存时不强校验（可先存草稿），但**派发前**必须校验；不可用 → 计划卡红字 + 拒绝派发（AC-22）。

## 3. 交互与动效说明

### 3.1 关键流程时序

1. 开开关 → dock 胶囊 `已关闭 → 待派发`（0 个成员，**无任何成员创建**）。开关只写会话级状态。
2. 用户发目标 → 队长产计划 → 面板自动展开到计划页 + 胶囊 `计划就绪 · N 任务`（琥珀）+ 计划卡时间戳（AC-30：此条目时间戳必须早于第一个成员创建）。
3. 用户改角色/删任务 → 立即写回计划（无二次确认，除删除被依赖任务）。
4. 开始派发 → 就绪任务并行创建成员（≤ 并发上限），阻塞任务行显示 `阻塞 · 等 T1`；胶囊 `运行中 n/上限`。
5. 成员跑完 → 门禁 → 通过：任务 `done` + 下游解锁（阻塞→就绪，120ms flash）；失败：`rework` + 证据进消息流 + 队长自动发直达消息给原成员（成员行状态回 `running`）。
6. 暂停：停止派发新成员，运行中成员跑完当前任务后转 `idle`；恢复：仅对 `blocked/interrupted` 成员重建或续跑，**幂等**（连点两次恢复结果一致）。
7. 终止：所有成员 `interrupted`，计划 `terminated`，胶囊 `已终止`。
8. 关开关：不再派发；已存在成员不自动杀（提示"关闭后不再派发新成员，运行中的成员会在当前任务后停下"）。

### 3.2 动效清单（数值见 0.3/0.6）

- 新行插入 160ms；状态 flash 120ms；开关 160ms；tab 切换无动画（即时，避免读屏与焦点错乱）。
- `running` 点 1.6s 呼吸；`prefers-reduced-motion: reduce` 下全部关闭（含 flash，改为 1px 左边框常驻）。

### 3.3 焦点与键盘

- 开关：Space/Enter 切换；`aria-checked` 同步。
- 面板：Tab 顺序 = 头部操作 → tab 条 → 内容；tab 条支持 ←/→。
- 抽屉：打开后焦点进第一个字段，Esc 关闭（有未保存改动时先确认）。
- 成员行展开：Enter/Space 展开，`aria-expanded`。

## 4. 视觉规范（token 映射，禁止新造）

| 用途 | token |
| --- | --- |
| 面板底色 / 卡片 / 代码块 | `--dsw-alias-bg-base` / `--dsw-alias-bg-layer-1` / `--dsw-alias-bg-layer-3` |
| 主文字 / 次文字 / 辅助文字 | `--dsw-alias-label-primary` / `--dsw-alias-label-secondary` / `--dsw-alias-label-tertiary` |
| 描边（1px） | `--dsw-alias-border-l1`（分隔线）/ `-l2`（卡片）/ `-l4`（开关关闭轨道） |
| 品牌/焦点 | `--dsw-alias-brand-primary` |
| 状态 | `--dsw-alias-state-{business,warn,error,success}-primary` |
| 主按钮 | `--dsw-alias-button-primary-fill` + `--dsw-alias-label-primary-inverse` |
| hover / active | `--dsw-alias-interactive-bg-hover` / `--dsw-alias-interactive-bg-active` |
| 圆角 | `--dsw-radius-xs 4 / -sm 8 / -md 12 / -lg 16` |
| 阴影 | `--dsw-shadow-lv1`（卡片）/ `--dsw-shadow-lv3`（抽屉） |
| 字号 | `--dsw-font-xxxs-11 / -xxs-12 / -xxs-strong-12 / -xs-13 / -s-14`（**font 简写**） |
| 等宽 | `--ds-font-family-code` |
| 间距 | 4 / 8 / 12 / 16（12 为面板内边距 `--dsh-sidebar-inline-padding`，8 为 dock inset 与行内 gap） |
| 动效 | 100ms / 120ms / 160ms，`--ds-ease-in-out` |

## 5. 无障碍要点

- 开关 `role="switch"` + `aria-checked` + `aria-label="自动团队"`；关闭态胶囊文案为纯文本（读屏可读），不依赖颜色。
- 状态列：图标 `aria-hidden="true"`，文字保留；`data-status` 供 e2e 断言。运行级状态用 `aria-live="polite"` 单点播报（**不要**给每行都加 live，5s 刷新会刷屏）。
- 所有 icon-only 按钮必须有 `aria-label`（暂停/继续/终止/删除/展开）。
- 对比度：正文用 `label-primary`（≥4.5:1）；11px 辅助文字用 `label-secondary`，**禁止** `label-tertiary` 承载关键信息（时间戳可接受，模型 route 不可）。
- 数字对齐 `tabular-nums`；相对时间必须带 `title` 绝对时间。
- 键盘可达：所有交互元素可 Tab 到、有 focus-visible 环；抽屉 Esc 关闭；计划卡任务行不设 tabindex（改用行内按钮）。
- `prefers-reduced-motion: reduce` 关闭呼吸与位移。

## 6. AC 覆盖对照（设计侧证据）

| AC | 设计落点 |
| --- | --- |
| AC-12 | 2.1 三态 + 关闭态禁用派发并给原因；状态按 sessionId 持久化 |
| AC-13/14/15 | 2.2 计划卡：任务行/依赖 chips/角色下拉/就绪·阻塞分组/并发 n/上限 |
| AC-16/17 | 2.3 展开消息日志 + 继续对话（同一成员，成员数不变）；暂停/恢复/终止在头部 |
| AC-18 | 2.3 行四列 + 实际 route + 最近事件时间；0.4 状态三元组；≤5s 反映，interrupted 不自动回 running |
| AC-19 | 2.3 证据抽屉（命令/退出码/输出尾部/产物路径）+ rework 状态 + 下游 blocked |
| AC-20/21 | 2.5 角色列表（内置标记）+ 编辑抽屉 + 删除确认 + "下次派发生效"提示 |
| AC-22 | 2.2 模型不可用 → 红字 + 拒绝派发；2.3 route 逐字不截断（0.7 几何保证） |
| AC-23/24 | 2.4 双轨分段 + 文件列表 + 编辑器 + 保存回显 mtime + 删除二次确认 + 非法路径行内报错 |
| AC-25 | 2.4 顶部"预计注入 N / 4000"预算行 + 超限"已截断"chip + 条目来源标注 |
| AC-30 | 3.1 步骤 2：计划条目（时间戳）先于成员创建；可取消，取消后成员 0 |

## 7. 给开发阶段的实现约束（照抄，不猜）

- 挂载：开关 `ctx.slots.inject('conversation.composer.dock', …)` + `ctx.slots.register({ name: 'conversation.composer.dock', id: 'dsh-auto-team:toggle', order: 30 }, Toggle)`（AC-3：`inject` 参数与 `register.name` 逐字相同）；面板走 `sidebar.right.pane.tab`（本机实测 50 处使用），标题「自动团队」，状态点可挂 `sidebar.right.pane.tab.title`。
- 必备 data 属性（QA 与 e2e 的锚点）：`data-dsh-auto-team-toggle`、`data-dsh-auto-team-panel`、`data-auto-team-plan`、`data-auto-team-member`、`data-status`、`data-task-id`、`data-role-id`、`data-model-route`。
- 文案全部中文（zh-CN 硬编码可接受，本期不做 i18n 资源）。
- 颜色只用第 4 节 token；字号只用 `font:` 简写复合 token。
- 面板内容宽度按 360–420px 设计；所有多列网格必须按 0.7 的算式复核，不许出现横向滚动条。
- 不得新增全屏页面或路由；不得自造拖拽/动画系统。
