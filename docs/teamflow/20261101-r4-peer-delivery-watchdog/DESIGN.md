<!-- meta: summary="r4 设计增量：成员行停滞条（琥珀竖条+⏳+含秒数纯文案，跨全宽不与状态胶囊争列）+ 账本 peer 行「上游直投」标签与正文整行折叠；删除 15s 客户端心跳启发式；全量沿用宿主 --dsw-* token 与 r1 视觉规范" -->
基线依赖：docs/teamflow/20261030-r1-auto-team-plugin/DESIGN.md（视觉与手感规范 §0 全文沿用：token 来源、表面处理、状态三元组、几何核算、反模式；本文件只写**增量**与**取代**）
取代：docs/teamflow/20261030-r1-auto-team-plugin/DESIGN.md §2.3「心跳提示：`running` 且距最近事件 >30s → 琥珀静默提示」一条（实现落地为 15s `src/client/tabs/MembersTab.tsx:14` 的 `STALE_MS`）→ **整条删除**，由宿主停滞态取代；DOM 上 `data-stale` / `data-member-stale-hint` 一并删除。
依据：本夹 PRD（AC-2 / AC-3 / AC-8 / AC-11 / AC-12 / AC-13 / AC-14）、docs/teamflow/architecture/SUPER-AGENT-MAPPING.md §3.1 §3.2
实测基线（不是记忆）：`src/client/tabs/MembersTab.tsx` 232 行、`src/client/styles.ts:313-444`（成员行网格 / 账本行）、`src/client/viewmodel.ts:43-96`（BADGES / formatClock / formatRelative）。

# DESIGN · r4 直通投递 + 停滞检测（增量设计）

## 0. 视觉与手感规范（增量；先读这一节）

### 0.1 本轮视觉改动只有三处

| # | 元素 | 类型 | 位置 | 一句话 |
|---|---|---|---|---|
| 1 | 成员行「停滞条」 | **新增** | 成员页每行第 3 条全宽行 | 琥珀 2px 左竖条 + `⏳` + 纯文字 + 秒数；不复用状态胶囊 |
| 2 | 账本「上游直投」行 | **新增标签 + 修订行布局** | 成员页底部「直达消息」 | `peer` → 显示为 `上游直投 → <成员名>`；正文改**整行独占**并默认折叠 3 行 |
| 3 | 15s 心跳提示 | **删除** | 成员行内 `data-member-stale-hint` | 连 `STALE_MS`、`data-stale` 一起删；无替代物，停滞条就是替代物 |

**不做**（明确出界，避免下游自行加戏）：不改面板四页结构、不改 tab 栏、不改 `capsuleOf` 的胶囊文案（改它会动到既有 reverify 探针的断言面，收益不抵风险；如确需「头部显示 N 个停滞」，登记进 docs/teamflow/memory.md 待下一轮）、不新增活动流区域（`snapshot.activity` 目前**零**客户端消费，本期仍不渲染）、不新增按钮/动作/路由/`ActivityEvent.kind`。

### 0.2 表面处理（数字直接抄）

| 元素 | 半径 | 描边 / 强调 | 阴影 | 底色 |
|---|---|---|---|---|
| 成员行（沿用） | 0 | 底边 1px `--dsw-alias-border-l1` | 无 | 透明；hover `--dsw-alias-interactive-bg-hover` |
| 成员行 · 停滞态 `[data-stalled="true"]` | 0 | **左侧 2px 实心** `--dsw-alias-state-warn-primary`，`padding-left: 6px`（与既有 `interrupted` 的 2px 虚线同几何，**只差实/虚与色**） | 无 | 透明（不整行铺琥珀，避免与「失败红底」争抢） |
| 停滞条 `[data-member-stall]` | `--dsw-radius-xs` 4px | 1px `--dsw-alias-state-warn-primary` | 无 | 8% 琥珀底（`color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent)`） |
| 账本行 · peer `[data-from="peer"]` | 0 | 左侧 2px 实心 `--dsw-alias-border-l3`（中性强调，**不用**状态色：peer 是来源类别不是状态） | 无 | 透明 |
| 账本正文块 `[data-message-body]` | `--dsw-radius-xs` 4px | 无 | 无 | `--dsw-alias-bg-layer-2`（与白色面板拉开一档，长文本才看得清边界） |
| 账本「展开/收起」按钮 | `--dsw-radius-xs` 4px | 无（文字按钮） | 无 | 透明；hover `--dsw-alias-interactive-bg-hover` |

要点沿用 r1 §0.2：**不使用渐变、发光、彩色描边、彩色整行底**。琥珀只出现在「形状 + 图标 + 8% 底」这三处非文本位置（原因见 0.4 对比度）。

### 0.3 状态反馈（缺一即不合格）

| 交互态 | 变化 | 时长 / 缓动 |
|---|---|---|
| 账本行 hover | 底色 → `--dsw-alias-interactive-bg-hover`（含 peer 行与队长行） | 100ms `--ds-ease-in-out` |
| 「展开/收起」hover | 同上 | 100ms |
| 「展开/收起」pressed | 底色 → `--dsw-alias-interactive-bg-active`，**不加** scale | 0ms |
| 「展开/收起」focus-visible | `outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px` | 0ms |
| 「展开/收起」disabled | 不使用 disabled（按钮本身按需出现/不出现） | — |
| 停滞条出现 | `opacity 0→1`，**不做位移** | 120ms `--ds-ease-in-out` |
| 停滞条消失（恢复产出） | **直接移除**，不做淡出 | 0ms |
| 秒数自增 | 只换文字，无动画 | 0ms |
| `prefers-reduced-motion: reduce` | 停滞条直接挂载（无 fade），其余无动画 | — |

为什么「恢复时不做淡出」：面板 2000ms 轮询整棵成员列表重渲染，淡出会与重渲染竞争（元素被卸载则动画不执行，偶发看起来像闪了一下）——直接移除在两种时序下都稳定。

### 0.4 停滞态的视觉身份：与「已中断 / 失败 / 运行中」必须一眼可分

| 状态 | 图标 | 文字 | 颜色用途 | 左侧竖条 | 行内提示条 |
|---|---|---|---|---|---|
| 运行中 | ● | 运行中 | 胶囊文字 `--dsw-alias-state-business-primary` | 无 | 无 |
| **疑似停滞（新增）** | `⏳` | 「疑似停滞 · 成员还活着，但已 N 秒没有实质产出」 | 图标与竖条琥珀；**正文用 `--dsw-alias-label-secondary`** | 2px **实心** 琥珀 | 有（琥珀 8% 底 + 1px 描边） |
| 已中断 | ⚡ | 已中断 | 胶囊文字 `--dsw-alias-label-secondary` | 2px **虚线**红 | **无**（保持现状） |
| 失败 | ✕ | 失败 | 胶囊红底白字 | 2px 实心红 | 无 |

三条硬规则：
1. **停滞不替换状态胶囊**：胶囊继续显示宿主真状态（running）。停滞是「叠加维度」，不是新状态——它是「运行中 + 卡住」，把胶囊改成「停滞」会让 `data-status` 与事实不符（AC-13 明令不得改 task.status，面板同理）。
2. **正文不着琥珀**：`--dsw-alias-state-warn-primary`（`#b58900`）在 `bg-layer-1` 上的对比度约 3.2:1，11px 文字不达标。琥珀只承担图标 / 竖条 / 描边 / 8% 底，文字用 `--dsw-alias-label-secondary`。这样暗色主题与色弱用户都不依赖颜色（文字已写明「活着」「没有实质产出」「N 秒」）。
3. **同一条成员行永不出现两条提示**（AC-12）：提示行在 DOM 里只有一个插槽 `[data-member-stall]`，心跳提示已删除 → 结构上不可能叠加，不靠纪律。

### 0.5 排版与数字对齐

- 停滞条：`font: var(--dsw-font-xxxs-11, 11px/16px inherit)`；秒数片段 `<span data-stall-seconds>` 加 `font-variant-numeric: tabular-nums`。
- 秒数格式（逐字）：`<600` 为 `N 秒`；`≥600` 为 `M 分 S 秒`（**永不省略秒**，秒是「多久没动」的判断依据）。例：`92 秒`、`20 分 34 秒`。
- 账本行头（路线 / 任务 id / 时间）：沿用现状（路线 `--dsw-alias-label-secondary` 13px / 任务 id 与时间 `--dsw-font-xxxs-11` + `--dsw-alias-label-tertiary`）。
- 账本正文：`font: var(--dsw-font-xxs-12, 12px/18px inherit)` + `--ds-font-family-code` 只给路径片段？→ **不混排**：整块沿用宿主正文字体，未加等宽（peer body 是「中文说明 + 命令 + 路径」混排，整块等宽会更难读；命令与路径本身由宿主在 body 文本里自带结构）。正文 `white-space: pre-wrap`（peer body 是多行结构，必须保留换行）。
- 时间戳保留既有 `title` 绝对时间（`formatClock`）。

### 0.6 动效、加载、空、错误（只列变化项）

- 加载：不新增骨架；成员行与账本沿用现状。
- 空态（**文案修订**，账本空态必须提前告知 peer 直投的存在）：
  - 账本空：`还没有消息。队长派发、成员回执、上游任务的门禁证据直投都会记在这里。`（原文案 + 末句）
  - 成员空：文案不变。
- 错误：事实不变（行内红框 + 11px 原因），本期不新增错误形态。
- 收起/展开：无高度动画（`max-height` 从 54→324 做过渡在 2s 重渲染下会被打断，表现为「卡一下」），直接切换。

### 0.7 几何自洽核算（按最大取值算，不是平均值）

**成员行**（沿用 `src/client/styles.ts:314-320` 的 `grid-template-columns: 76px minmax(96px,1fr) 64px 44px; gap: 6px 8px`）：
- 最小内容宽 = 76+96+64+44+3×8 = **304px**；面板内容宽下限 336px（r1 §0.7 实测口径）→ 余量 32px 归任务列，**列宽本轮不变**。
- 停滞条 `grid-column: 1 / -1`，**不参与列宽竞争**，因此 64px 的状态列不需要加宽（若把「疑似停滞」塞进胶囊会需要 ≥110px，直接撑破网格——这是本轮明确避开的设计）。
- 停滞条最长文案（11px/16px，含 4 位秒数）：`⏳ 疑似停滞 · 成员还活着，但已 9000 秒没有实质产出` ≈ 34 字 ≈ 374px > 336px → **换行到 2 行，允许**，行高增量 +32px；不得 `text-overflow: ellipsis`（截断秒数＝丢掉判断依据）。
- 行高不锁死：停滞行 = 第一行 20 + 第二行（route，11px/16px）+ 停滞条 16 或 32 + padding 12。因为不设固定 `height`，2 行文案与 4 位秒数不会撑破、也不会抖动；秒数位数变化只在换行内发生，`tabular-nums` 保证不横向跳动。
- 状态胶囊文案峰值仍是「待返工」3 字（≤52px < 64px），沿用 r1 结论。

**账本行（修订布局，含数字）**：
- 旧布局 `grid-template-columns: auto auto auto minmax(0,1fr)` 把正文挤在最后一列：peer body 最长 = 上游 id/title + 命令 + 退出码 + **800 字证据尾部** + 产物路径，在 336px 面板里正文列只剩约 115px（12px 字 ≈ 9 汉字/行）→ 800 字要 80+ 行，界面直接废掉。
- 新布局：`[data-message]` 改为「行头一行 + 正文整行」：`display: flex; flex-wrap: wrap; gap: 4px 8px;`，行头三项（路线 / 任务 / 时间）`flex: 0 0 auto`，正文 `[data-message-body]{ flex: 1 0 100%; }` → 正文拿到完整 336px ≈ 28 汉字/行。
- 折叠高度：正文 `line-height: 18px`，折叠 `max-height: 54px`（3 行），展开 `max-height: 324px`（18 行）+ `overflow: auto`。800 字 + 5 行表头 ≈ 34 行 ≈ 612px > 324px → 展开后内部滚动，**整页滚动条不被单条消息拖长**。
- 折叠阈值（逐字判定，避免主观）：`body.length > 120 || body.split('\n').length > 3` → 显示「展开」按钮；否则正文不折叠、不显示按钮。
- 按钮几何：高 20px、左侧内缩 0、`font: var(--dsw-font-xxxs-11)`；点击区域含 `padding: 2px 6px`，命中区 20px 高 × ≈52px 宽 ≥ 24×24 触摸目标的一半要求（桌面端可接受，且 r1 全站沿用 20~22px 按钮高度，保持一致）。
- 单人单行最高增量：停滞行 +32px、账本条 +324px —— 二者互不影响（不同容器）。

### 0.8 本产品的反模式（本轮追加；r1 §0.8 十条继续有效）

11. **把「停滞」写进 `data-status` 或替换状态胶囊**：状态被拍平，`interrupted` 与 `running` 的语义随之丢失（PRD 反面目标 4）。
12. **client 自己算超时**：任何新的 `now - xxx > 阈值` 判定（含把 15s 改成 30s/90s 的「改良版」）。停滞只读宿主字段。
13. **同一条消息既显示「上游直投」又显示「队长转述」**：peer 行只能有一个来源标签（`data-from` 单一来源）。
14. **长正文不折叠**：peer body 把账本拉成 80 行，或反过来 `ellipsis` 截断证据尾部（证据必须可完整读到，只是默认收起）。
15. **用琥珀文字写 11px 提示**：对比度不足（0.4 规则 2）。
16. **在停滞条里塞按钮**（如「重试」）：本期无对应动作，新增入口即新增缺陷面。

## 1. 页面 / 模块清单与信息架构（增量）

页面集合不变（`计划 / 成员 / 记忆 / 角色`），本期只动**成员页**的两块区域，信息层级变化如下：

```
成员页
├─ 页头 hint（既有，动作反馈）                        不改
├─ 成员卡片列表（每成员一张）
│   ├─ 第1行：角色名 / 当前任务 / 状态胶囊 / 相对时间   不改
│   ├─ 第2行：模型 route（等宽，逐字）                 不改
│   ├─ 第3行：★停滞条【新增；仅 status=running && stalled=true】
│   ├─ 操作行：回执备注 / 回执 / 继续 / 证据           不改
│   ├─ 消息行：直达消息输入 + 发送                     不改
│   └─ 证据抽屉（点「证据」展开）                      不改
└─ 直达消息账本（最多 200 条）
    ├─ 行头：来源标签 / 任务 id / 时间  ★peer → 「上游直投」
    └─ 正文：★整行独占、默认折叠 3 行、可展开
```

新增可视元素 2 个（停滞条、账本折叠控件），删除 1 个（心跳提示）。**新增数据字段（设计侧要求，TECHNICAL 冻结）**：
- `MemberView.stalled: boolean`（宿主在 `watcher.tick()` 判定，client 只读）
- `MemberView.stalledForMs: number`（宿主在快照时刻算好的「距上次实质产出毫秒」；未停滞时 `0`）
  - 备选方案：宿主改暴露 `lastProgressAt: number`，client 用**既有** `formatRelative(lastProgressAt, now)` 渲染「92 秒前」。两者取一由 TECHNICAL 定；**client 侧禁止出现任何阈值比较**（AC-12）。本设计对两种取值的渲染均已给出文案（0.5 的秒数格式；若取 `formatRelative` 则停滞条写「最近产出：92 秒前」）。

## 2. 关键页面线框

### 2.1 成员页 · 停滞行（新增态）

```
[计划] 成员 记忆 角色                           运行中 2/3
┌────────────────────────────────────────────────────────┐
│ 开发        实现 CSV 导出       ●运行中     12s 前      │
│ deepseek-chat · deepseek-v4.1-flash                    │
│ ⏳ 疑似停滞 · 成员还活着，但已 92 秒没有实质产出         │  ← 新增（琥珀 2px 左竖条贯穿整行）
│ [回执备注（可选）……] [回执] [继续] [证据]               │
│ [发直达消息……]                    [发送]                │
├────────────────────────────────────────────────────────┤
│ 测试        补单元测试          ⚡已中断     3m 前       │  ← 对照：虚线红竖条、无提示条
│ deepseek-chat · deepseek-chat                          │
└────────────────────────────────────────────────────────┘
```

- 竖条贯穿「该成员整张卡片」（`border-left` 落在 `[data-auto-team-member]` 上），不是只挂在停滞条上——这样纵向扫视一眼就能定位是哪一行。
- 停滞条文案逐字（秒数为变量）：`⏳ 疑似停滞 · 成员还活着，但已 {N} 秒没有实质产出`；`{N}≥600` 时 `{M} 分 {S} 秒`。
- 恢复产出后：竖条与停滞条一起消失，行回到「运行中 + 相对时间」，`data-stalled="false"`。
- `interrupted` / `failed` 行**永不**渲染停滞条（即使宿主因 bug 置了 `stalled=true`）：渲染条件固定为 `status === 'running' && stalled === true`（AC-12 的优先级「死亡 > 停滞」在渲染层兜底）。

### 2.2 成员页 · 账本（peer 行，新增标签 + 折叠）

```
直达消息   共 3 条（上限 200，超出丢最旧）
┌────────────────────────────────────────────────────────┐
│ 上游直投 → 测试-2   t2   23:38:02              [收起]   │ ← peer 行（中性 2px 左竖条）
│ ┌────────────────────────────────────────────────────┐ │
│ │ 上游任务 t1 · 实现 CSV 导出                        │ │
│ │ 命令：pnpm test                                    │ │
│ │ 退出码：0                                          │ │
│ │ 证据尾部（末 800 字）：                            │ │ ← 折叠 3 行，超出显示「展开」
│ │ 产物：docs/teamflow/2026…/QA-REPORT.md             │ │
│ └────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────┤
│ 队长 → 开发          t1   23:30:10                      │ ← 队长行（无标签、不折叠，短消息）
│ 执行 t1：实现 CSV 导出                                  │
└────────────────────────────────────────────────────────┘
```

- 来源标签映射（**只改显示，不改数据**）：`captain` → `队长`，`peer` → `上游直投`，其它 → 原样（成员名）。`data-from` 属性保持宿主原值（`"peer"`），供结构化断言。
- peer 行正文默认折叠（3 行 / 54px），有「展开」/「收起」；队长与成员的短消息（≤120 字且 ≤3 行）**不折叠也不显示按钮**——避免给每条短消息都加一个控件。
- 折叠状态是**组件本地 state**（`Record<messageId, boolean>`），不写入宿主、不新增 `PanelAction`、不跨刷新持久化（刷新面板回到默认折叠，与既有证据抽屉的交互一致）。
- 断言锚点：`[data-message][data-from="peer"]`、`[data-message-body]`、`[data-message-toggle][aria-expanded="false|true"]`。

### 2.3 被删除的部分（必须删干净）

- `src/client/tabs/MembersTab.tsx`：`STALE_MS` 常量、`stale` 计算、`data-stale` 属性、`[data-member-stale-hint]` 整段（含文案「心跳已超过 15 秒，宿主正在对账（成员进程可能已退出）」）。
- `src/client/styles.ts`：`[data-auto-team-member] [data-member-stale-hint]` 规则块。
- **保留** `data-member-last-event`（那是「最近事件时间」这一事实的可视证据，不是告警；AC-18 要求它一直在）。

## 3. 交互与动效说明

### 3.1 关键时序（设计只描述「用户看到什么」，判定归宿主）

```
成员沉默 ──> 宿主 tick(1500ms) 发现 now-lastProgressAt > STALL_MS
          ──> 写 stalled=true / 一条 kind:'tool' 活动事件（唯一出口）
          ──> 面板下一次轮询（≤2000ms）拿到快照
          ──> 该行：出现 2px 琥珀竖条 + 停滞条（120ms fade）
          ──> 用户可见延迟上限 ≈ 3.5s（AC-11 要求 ≤5s）
成员恢复调工具 ──> stalled=false ──> 下一次轮询后竖条与提示条消失（0ms）
```

- 秒数每次轮询更新一次（2s 一跳），属预期：它是「还在卡」的连续证据。
- 同一 episode 不重复出现第二条提示条：DOM 只有一处插槽（AC-8 / AC-12）。

### 3.2 交互清单

| 交互 | 触发 | 结果 | 备注 |
|---|---|---|---|
| 展开 / 收起 peer 正文 | 点 `[data-message-toggle]` | 正文 54px ⇄ 324px（内部滚动） | 纯本地 state；`aria-expanded` 同步 |
| 悬停账本行 | hover | 底色 100ms 变化 | 提示「可展开」 |
| 恢复产出 | 宿主字段变化 | 停滞视觉全部消失 | 无用户操作 |
| 其它 | — | 既有交互不变 | 本期不新增任何动作按钮 |

### 3.3 焦点与键盘

- 折叠按钮是原生 `<button type="button">`：Tab 可达、Enter/Space 触发，焦点环见 0.3。
- 停滞条不是可聚焦元素（无动作），只做视觉 + `role="status"` 占位（见 §5 的取舍）。
- 不新增键盘快捷键；不改既有 tab 切换。

## 4. 视觉规范（token 映射，禁止新造；只用仓库已出现过的 token）

| 用途 | token（全部已在 `src/client/styles.ts` 使用过） |
|---|---|
| 停滞琥珀（图标 / 竖条 / 描边） | `--dsw-alias-state-warn-primary`（兜底 `#b58900`） |
| 停滞条 8% 底 | `color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent)` |
| 停滞正文 | `--dsw-alias-label-secondary` |
| 已中断红（既有，不改） | `--dsw-alias-state-error-primary` |
| 分隔线 / peer 左竖条 | `--dsw-alias-border-l1`（行底边）/ `--dsw-alias-border-l3`（peer 竖条） |
| 正文块底 | `--dsw-alias-bg-layer-2` |
| 文字层次 | `--dsw-alias-label-primary / -secondary / -tertiary` |
| 圆角 | `--dsw-radius-xs` 4px（小控件）/ `--dsw-radius-sm` 8px（沿用既有卡片） |
| 字体 | `--dsw-font-xxxs-11`（提示/元信息）、`--dsw-font-xxs-12`（正文块）、`--dsw-font-xs-13`（路线文本，沿用） |
| 缓动 | `--ds-ease-in-out` |
| 等宽 | `--ds-font-family-code`（仅既有位置，本轮不新增） |

**铁律**：字号必须写 `font: var(--dsw-font-*)`，禁止 `font-size: var(--dsw-font-*)`（复合值 token，写 font-size 是静默无效声明）；禁止硬编码 `#hex`/`rgba()`（仅允许 `color-mix` 做透明叠层）；亮暗主题由 token 自动切换。

## 5. 无障碍要点

1. **状态不靠颜色单独表达**：停滞 = `⏳` 图标 + 明确中文 + 琥珀形状；`interrupted` = `⚡` + 「已中断」+ 虚线红。去掉颜色后两者仍可分（图标形状、实/虚、文字三者都不同）。
2. **对比度**：11px 提示正文用 `label-secondary`（正文级对比度）；琥珀只用于非文本位置（0.4 规则 2）。
3. **秒数可读且可断言**：秒数在独立 `[data-stall-seconds]` 内，`textContent` 与 `innerText` 都包含它（不做 `aria-hidden`、不做 `ellipsis`）。
4. **不做 `aria-live`**：面板 2000ms 轮询会让一个含秒数的 live region 每 2 秒播报一次，实际效果是骚扰（与 PRD 反面目标 1「刷屏」同族）。停滞条给 `role="status"` 但不承诺播报可靠性；**验收只按 `data-stalled` 与可见文案结构断言**，不把 SC 4.1.3 的播报当作交付项（如实写进验收的已知限制）。
5. **折叠控件可访问**：原生 button + `aria-expanded` + 文本标签「展开」/「收起」；不做只有图标的箭头。
6. **触摸/点击目标**：折叠按钮 20px 高 + 6px 横向内边距，桌面右栏场景沿用全站既有尺寸；不引入更小目标。
7. **文档顺序与视觉顺序一致**：停滞条在操作行之前（先读「为什么这行不对劲」，再读「能对它做什么」）。

## 6. AC 覆盖对照（设计侧证据）

| AC | 设计如何满足 | 可断言锚点 |
|---|---|---|
| AC-2（交接内容完整） | 账本 peer 行原样展示 body（含 5 要素），不做任何截断/重排，长正文可展开完整读 | `[data-message][data-from="peer"] [data-message-body]` 全文可读（展开态） |
| AC-3（不经队长） | 账本来源标签只有「上游直投」一种，不出现「队长转述」行；队长行保持既有形态 | 账本内 `data-from="captain"` 条数投放前后不变 |
| AC-8（单出口） | 停滞只有一处提示插槽；恢复即整体消失；同一 episode 不追加第二条 | 单行内 `[data-member-stall]` 数量 ≤1 |
| AC-11（预算） | 不新增定时器、不新增请求；秒数只随既有 2000ms 快照刷新 | 无 `setInterval` 变更（宿主侧） |
| AC-12（不叠加 / 不自算） | 心跳提示整条删除；提示插槽唯一；client 无阈值比较 | `data-stalled="true"` 且**无** `data-member-stale-hint` |
| AC-13（无副作用） | UI 只读字段；不改胶囊、不改 `data-status` | 停滞前后 `data-status` 恒为 `running` |
| AC-14（可读可区分 / 恢复） | 停滞条含秒数、文案含「活着」「没有实质产出」；与「已中断」字符串不相等；恢复后消失 | `data-stalled="false"` + `[data-stall-seconds]` 存在时文案含秒数 |

## 7. 给开发阶段的实现约束（照抄，不猜）

1. **删除清单**（必须 grep 到 0 命中，除本文件引用）：
   `grep -n "STALE_MS\|data-member-stale-hint\|data-stale\b" src/client/tabs/MembersTab.tsx src/client/styles.ts` → 0 行。
2. **新增属性名逐字固定**：行 `data-stalled="true|false"`（**每行都要有**，不只是停滞行）、提示条 `[data-member-stall]`、秒数 `[data-stall-seconds]`、折叠按钮 `[data-message-toggle]` + `aria-expanded`、展开态标记 `[data-message-expanded="true|false"]`。
3. **渲染条件逐字**：停滞条仅在 `member.status === 'running' && member.stalled === true` 时出现；`stalled` 缺失（旧快照）时按 `false` 处理，不得让整行报错。
4. **禁止**：在 client 新增任何 `now - x > 阈值` 判定；把停滞写进 `data-status` / `statusBadge`；在 `BADGES` 里加 `stalled`（那是状态表，停滞不是状态）；新增 `PanelAction` / HTTP 路由 / `ActivityEvent.kind`。
5. **文案逐字**：停滞条 `⏳ 疑似停滞 · 成员还活着，但已 {N} 秒没有实质产出`（`{N}` 见 0.5 格式）；账本来源标签 `队长` / `上游直投`；折叠按钮 `展开` / `收起`；账本空态追加句 `上游任务的门禁证据直投都会记在这里。`
6. **样式落地位置**：全部写进 `src/client/styles.ts` 既有分节（成员页区块、账本区块），选择器前缀保持 `[data-dsh-auto-team-panel]` / `[data-auto-team-member]` / `[data-message-ledger]` 既有前缀，不新建样式文件。
7. **回归自查（本轮新增）**：现有探针若断言过 `data-stale` 或心跳提示文案，必须同步更新并在报告里写明（PRD AC-12 已把该提示列为删除对象）；`reverify 9/9`、`collision 12/12` 项数不得减少。
