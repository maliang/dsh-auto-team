<!-- meta: summary="r10 设计：工具条选项（24px 紧凑胶囊、非红琥珀失败点）、面板头部三段+meta 三组+独立进度行、会话头按钮非乐观开合、模型弹层选择器（手填兜底移入弹层内）、技能四来源列表与三入口（导入/系统多选/手动）、技能编辑弹层按需取正文、恢复默认连带内置技能" -->

# DESIGN · r10 工具条选项 / 面板头部分区 / 模型弹层 / 技能四来源

基线：`docs/teamflow/20261101-r7-auto-team-panel-roles`（视觉语言、token 表、非乐观纪律继续有效，本文件只写**新增与修订**）。
取代：`20261102-r9-autoteam-toolbar-tab#AC-16`（技能改四来源、内置可改）、`#AC-18`（内置角色 11 个）。
本文件先说手感（§0），再说信息架构与线框；开发阶段通常只读到文件头，**§0 与 §2 是必须落地的部分，§4/§5 是核对表**。

---

## 0. 视觉与质感规范（先读这一节）

### 0.1 token 与硬规则（不新增任何 token）

半径 `--dsw-radius-xs:4 / -sm:8 / -md:12 / -lg:16`；描边 `--dsw-alias-border-l1..l4`；底色 `--dsw-alias-bg-layer-1/2/3`；文字 `--dsw-alias-label-primary / -secondary / -tertiary`；语义色 `--dsw-alias-state-business-primary`（蓝=可用/进行）、`--dsw-alias-state-success-primary`（绿=就绪）、`--dsw-alias-state-warn-primary`（琥珀=可恢复的异常/等待）、`--dsw-alias-state-error-primary`（红=不可恢复的失败，**本轮工具条选项永不使用**）；交互底 `--dsw-alias-interactive-bg-hover / -active`；阴影 `--dsw-shadow-lv1 / -lv3`；缓动 `var(--ds-ease-in-out)`；等宽 `var(--ds-font-family-code)`。

1. 字号一律 `font: var(--dsw-font-xs-13, 13px/20px sans-serif)`；**禁止** `font-size: var(--dsw-font-*)`（该 token 是 font 简写，写 font-size 是无效声明且静默继承父级）。
2. 颜色一律走上面的 token 或 `color-mix(in srgb, var(--token) N%, transparent)`；不写字面色值。
3. **11px 文字禁用琥珀**（在 `bg-layer-1` 上对比度约 3.2:1）。琥珀只用于圆点、竖条、描边、微底；文字用 `label-secondary`。
4. 可变长文本容器一律 `min-width: 0` + 省略号；**禁止**对可变长文本用 `white-space: nowrap`（撑破 320px 右栏）。

### 0.2 表面处理（数字直接抄；★=本轮新增，△=相对 r7 修订）

| 元素 | 半径 | 描边 | 底色 | 阴影 | 尺寸 |
| --- | --- | --- | --- | --- | --- |
| △ 工具条选项（未启用） | `radius-sm` 8 | 1px `border-l2` | transparent | 无 | 高 **24px**，`padding: 0 8px`，`gap: 6px` |
| △ 工具条选项（已启用） | 8 | 1px `color-mix(business 45%)` | `color-mix(business 12%)` | 无 | 与上一态**逐像素同尺寸** |
| ★ 工具条选项（失败残留 `data-tone="warn"`） | 8 | 1px `color-mix(warn 45%)` | **transparent（不加底色）** | 无 | 同上 |
| 会话头按钮 | 8 | 1px `border-l2` | transparent | 无 | 高 **24px**，`padding: 0 8px`，`gap: 6px` |
| 会话头按钮（`aria-pressed="true"`） | 8 | 1px `color-mix(business 45%)` | `color-mix(business 12%)` | 无 | 同上 |
| ★ 面板头部条 `[data-panel-head]` | 0（贴面板顶） | 底部 1px `border-l2` | transparent | 无 | 高 **28px**，`padding: 4px 12px`，直系子节点 **3 个** |
| ★ 面板 meta 行 `[data-panel-meta]` | 0 | 无 | transparent | 无 | 行高 **18px**，`padding: 0 12px 4px`，`flex-wrap: wrap`，组间 1px `border-l1` 竖分隔（高 10px） |
| 面板进度行（保留） | 0 | 底部 1px `border-l2` | transparent | 无 | 高 **28px**，`padding: 4px 12px` |
| ★ 来源徽标 `[data-skill-badge]` | `radius-xs` 4 | 1px `color-mix(tone 30%)` | `color-mix(tone 10%)` | 无 | 高 **16px**，`padding: 0 4px`，`font-xxxs-11` |
| ★「已修改」徽标 | 4 | 1px `color-mix(warn 45%)` | `color-mix(warn 16%)` | 无 | 高 **16px**，文字 `label-secondary`（**不是**琥珀字） |
| ★ 技能行 `[data-skill-row]` | `radius-sm` 8 | 1px `border-l2`（已勾选 → `business 45%` + `business 8%` 底） | `bg-layer-1` | 无 | `padding: 5px 8px`，行间距 4px，高 **56px** |
| ★ 技能列滚动容器 | 8 | 无 | transparent | 无 | `max-height: 200px`，`overflow-y: auto`，`scrollbar-gutter: stable` |
| ★ 弹层容器（模型/技能选择/编辑/确认） | `radius-md` 12 | 1px `border-l2` | `bg-layer-2`（面板内气泡）/ `bg-layer-3`（模态对话框） | `shadow-lv3` | 模型气泡宽 `min(100%, 300px)`；模态宽 **420px**（系统技能 **480px**），`max-width: calc(100vw - 32px)` |
| ★ 弹层内输入 / 搜索 | 8 | 1px `border-l2`，focus 转 business | `bg-layer-1`（模态内） | 无 | 高 **28px**，`padding: 0 8px` |
| ★ 弹层内列表行 | 8 | 无（hover `border-l2`） | transparent | 无 | 高 **28px**（模型）/ **40px**（系统技能，名称+说明两行） |

### 0.3 状态反馈（每个可交互元素缺一即不合格）

| 态 | 变化 | 时长 |
| --- | --- | --- |
| hover | 底 → `interactive-bg-hover`；描边 → `border-l3` | `120ms var(--ds-ease-in-out)` |
| active | 底 → `interactive-bg-active` | `80ms` |
| focus-visible | `outline: 2px solid business`，`offset: 1px` | 即时（键盘用户要立刻看到） |
| disabled | `opacity: .55` + `cursor: not-allowed`，**尺寸不变** | 即时 |
| busy（请求在飞） | 文案**逐字不变**、`aria-busy="true"`、`cursor: progress`、右侧 12×12 旋转环（800ms linear） | — |
| 服务端确认 hit-flash | 值与点击前不同 → `data-flash="true"` 300ms：`business 18%` 底 → transparent | `300ms` |
| △ 工具条失败 | 圆点变琥珀**实心** + 描边琥珀 45%；token 到下次成功点击（或再次点击）才清除 | 描边 `120ms` |
| ★ 删除/恢复出厂结果 | 行内 `[data-skill-notice]` 一句话，`role="status"`，保留到下一条通知 | 淡入 `200ms` |
| ★ 弹层内保存失败 | 弹层**不关闭**，字段下方 4px 处 `[data-dialog-error]` 一句原因，输入保留 | 淡入 `200ms` |

**统一纪律**：不做乐观更新——开关、开合、暂停、技能保存全部等服务端快照回来再改文案/状态（AC-7 / AC-11 / AC-6）。

### 0.4 动效 / 加载 / 空 / 错误（只列本轮）

- **工具条选项**：状态点 6px 颜色 `120ms` 过渡；不在失败时抖动、不位移、不改宽。
- **模型气泡 / 添加技能菜单**：`opacity 0→1` + `translateY(-2px→0)`，`120ms`；关闭不做退出动画（立即消失，避免连点时半透明残影）。
- **模态对话框**：遮罩 `bg-layer-3 40%` 淡入 `120ms`；对话框 `opacity + scale(.98→1)` `140ms`；关闭立即移除。
- **技能正文按需加载**：编辑弹层内 textarea 位置显示 **3 条骨架**（高 14px、`radius-xs`、`bg-layer-2`、1200ms 呼吸），**不用 spinner**；骨架条数与正文首屏行数同量级，避免加载完跳动。
- **技能列表首屏**：`skills` 为空的既有 `[data-role-skill-empty]` 文案；**不**用骨架（快照里没有正文，加载是同步的）。
- **系统技能清单**：加载中 3 条 40px 骨架；空 → `[data-skill-picker-empty]`「本机没有可用系统技能」+ 一句「仍可用『手动新建』或『导入 .md』」（**不得静默空列表**）；失败 → 同行 `[data-dialog-error]`「读取系统技能失败：<原因>」+「重试」。
- **正文读取失败**：弹层内「正文读取失败：<原因>」+「重试」，**绝不显示空 textarea**（否则用户以为技能没有正文 — 反面目标 3）。
- `@media (prefers-reduced-motion: reduce)`：呼吸/旋转/位移全关，只保留颜色变化。

### 0.5 排版角色与数字对齐

| 用途 | token | 字重 | 其他 |
| --- | --- | --- | --- |
| 工具条选项文案 | `font-xs-13` | 500（启用 600） | 单行 ellipsis |
| 面板标题 | `font-xs-13` | 600 | 单行 |
| 面板 meta 三组 | `font-xxxs-11` | 400，`label-tertiary` | 组内数字 `tabular-nums` |
| 进度行 `完成 x/N` | `font-xs-13` | 600 | `tabular-nums`（既定） |
| 技能标题 | `font-xxs-12` | 600，`label-primary` | 单行 ellipsis |
| 技能说明 | `font-xxxs-11` | 400，`label-tertiary` | `-webkit-line-clamp: 1` |
| 徽标 | `font-xxxs-11` | 500 | 与 tone 同色（已修改用 `label-secondary`） |
| 弹层标题 | `font-xs-13` | 600 | — |
| 弹层说明 / 空态 | `font-xxxs-11` | 400，`label-tertiary` | 行高 16 |
| 技能正文编辑 | `font-xxs-12` | 400 | 行高 18，`white-space: pre-wrap` |
| 模型标识（provider） | `font-xxxs-11` | 400，`label-tertiary` | `var(--ds-font-family-code)` |

### 0.6 几何自洽核算（按**最大取值**算）

1. **工具条选项**：高 24 = 行高 18 + 2×2 padding + 2×1 描边 ✓（AC-14 上限 28，余 4px）。宽 = 2 + 8 + 6(点) + 6 + 52（「自动团队」4 字×13px）+ 8 + 右 4 margin = **86px**；`max-width: min(100%, 160px)` 下仍单行。命中区用 `::after { inset: -8px -6px }` 扩到 40×40（**不改布局高度**，`getBoundingClientRect().height` 仍是 24）。
2. **面板头三段**（面板宽下限 320，左右 padding 24）：标题 4 字 52 + gap 8 + 胶囊 ≤ 76 + 弹性空隙 + 刷新 46 = **182px ≤ 296** ✓；胶囊文案最坏「已完成 12/12」→ 用 `max-width: 88px` + ellipsis 兜住。
3. **meta 行**：单行 296px 内 `计划 999 · 成员 999 · 并发 99/99` ≈ 176 + `队长模型 xxx` ≤ 120（ellipsis）+ `事件源正常` 60 + 两个竖分隔 2 + gap 16 = **374 > 296 → 折成两行**（允许；`row-gap: 4px`，**三组都仍可见**，AC-10 明确禁止用隐藏冒充分区）。
4. **进度行**：`完成 999/999` 79 + gap 8 + 状态胶囊 64 + 弹性 + 暂停按钮 80 = **231 ≤ 296** ✓。
5. **技能行**（296 可用，`padding: 5px 8px` → 内容宽 280）：第一行 checkbox 14 + gap 6 + 标题（弹性）+ 来源徽标 34 + gap 4 +「已修改」44 → 标题可用 **178px** ✓；第二行说明（弹性）+ 操作 `编辑` 32 + `恢复出厂` 70（`删除` 32）+ gap 4 → 说明可用 **170px**，`line-clamp:1` 保证长说明不撑高。行高 56 = 5 + 20 + 4 + 20 + 5 + 2×1 ✓。
6. **技能列滚动**：`max-height: 200px` = 3 行 56 + 2×4 gap + 16 余（半行提示可滚）；12 条技能时角色卡总高 ≈ 28+4+28+4+96+4+200+4+28+4+28+28 ≈ **456px**（r7 是 264；上限受 200px 滚动封死，**绝不 auto-grow**）。
7. **模型气泡**：面板 320 内宽 296，气泡 `min(100%, 300px)` → **296**；高 = 8 + 28(搜索) + 4 + 10×28(列表最大) + 8 = **328 → 取 `max-height: 320px` 内滚**（9 行可见 + 半行提示）；行内 provider 用 11px 等宽，与模型名共用 `min-width: 0` 两列（`1fr auto`），最长模型名 40 字符时 ellipsis，不撑破。
8. **技能编辑对话框**：宽 420 / `calc(100vw - 32px)`；高 = 20 + 28(标题) + 8 + 28(名称) + 6 + 28(说明) + 6 + **200(正文，固定内滚)** + 8 + 32(底部按钮) + 20 = **382px** ✓（< 568px 视口 70%）；正文 textarea 固定 200、**绝不 auto-grow**（正文可上万字符，同 r7 提示词 96px 的教训）。
9. **系统技能对话框**：宽 480；高 = 20 + 28 + 8 + 28(搜索) + 8 + 240(列表) + 8 + 32 + 20 = **392px** ✓；列表行 40 = 名称 20 + 说明 16 + 间距 4。
10. **恢复默认确认**：宽 420；正文 ≤ 4 行 18px=72，高 ≈ 20+18+8+72+16+32+20 = **186px** ✓。
11. **窄视口**：900px 视口下右栏 320 不变；对话框 `max-width: calc(100vw - 32px)` 兜底。**任何** `position: fixed` 遮罩都不得高于 `z-index` 宿主的分层（用 `z-index: 1000`，不抢设置页弹窗的层级冲突）。

### 0.7 本产品的反模式（本轮追加；r7 §0.8 与 r1 §0.8 继续有效）

1. **工具条选项里不显示任何进度/成员数/长句**：可见文本只有「自动团队」四个字（AC-3）。进度归面板。
2. **失败不写可见红字**：工具条选项零错误文本、零 `role="alert"`、零红描边（AC-5）；原因只在 `title` / `aria-label` / 面板 `[data-error]`。
3. **不用隐藏充数**：头部三段不是把 6 项 `display:none` 掉 3 项（AC-10 会变异自检）。
4. **不做乐观 `aria-pressed`**：收起失败时按钮必须回到「已按下」并提示，不是提前熄灭（AC-11）。
5. **不给内置技能出删除按钮**（是**不存在**，不是灰掉）——灰按钮会让人反复点并怀疑权限（AC-23）。
6. **不让手填兜底出现在卡片里**：`provider` / `model` 两个裸输入框必须**移进模型气泡的「手动填写」折叠区**（新 hook，见 §2.4；AC-16 判据是裸 `data-role-model-provider` / `data-role-model-name` 为 0 处）。
7. **不把技能正文塞进快照/一次渲染全列表**：列表只吃元数据，正文在弹层里按需取（AC-20 ④）。
8. **不新增 token、不新增 `PanelAction`、不新增路由**：技能 CRUD 复用既有保存载荷。
9. **不在窄宽下用视口媒体查询隐藏标签**（AC-14 要求 900px 视口标签完整）；只在自身可用宽 < 96px 时缩为纯圆点（`aria-label` 兜底）。

---

## 1. 页面 / 模块清单与信息架构

### 1.1 六个可见面（M1–M6）+ 一个撤除面

| 面 | 槽位 / 容器 | 状态 | 设计定位 |
| --- | --- | --- | --- |
| M1 工具条选项 | `conversation.input.left`（`order: 5`，与 `input.permission` / `input.plan` 同排） | △ 迁移（原 `conversation.input.dock` 撤除） | 一行里的普通切换钮，不是横幅 |
| M2 会话头按钮 | `conversation.session.header.actions` | △ 改为可开可收（`aria-pressed`） | 开关面板的唯一头部入口 |
| M3 面板头部 | 右栏页签 `dsh-auto-team-panel` 内 `[data-panel-head]` / `[data-panel-meta]` / `[data-panel-progress-row]` | △ 拆三段 | 一眼分清「身份 / 规模 / 进度」 |
| M4 角色卡内技能区 + 模型字段 | 面板「角色」页 / 设置页 `settings.section` 共用 `RoleEditorList` | △ 技能替为带来源行；模型替为按钮+弹层 | 同一份组件两处渲染（density 只差字号） |
| M5 技能编辑弹层 | `RoleEditorList` 内模态 | ★ 新增 | 正文编辑 + 恢复出厂 |
| M6 系统技能多选弹层 / 恢复默认确认 | `RoleEditorList` 内模态 | ★ 新增 | 多选导入 + 破坏性二次确认 |
| — 撤除面 | `conversation.input.dock` | 移除 | 注册数必须为 0（AC-1） |

> 所有模态一律 `createPortal(…, document.body)`（宿主页签/输入框子树里可能有 `-webkit-app-region: drag` 或 `overflow:hidden`，就地渲染会被裁切/点不到）。

### 1.2 信息架构

- **M1**：`[data-auto-team-option]` → 圆点 `[data-option-dot]` + 文本 `[data-option-label]`（+ busy 时 `[data-option-spinner]`）。**没有第三块**。
- **M3**：
  - `[data-panel-head]`（直系子节点恰 3）：`[data-panel-title]`「自动团队」 · `[data-head-capsule]` 总体状态 · `[data-panel-refresh]`「刷新」。
  - `[data-panel-meta]`（直系 3 组）：`[data-meta-plan]`「计划 x · 成员 y · 并发 a/b」 · `[data-captain-model]`「队长模型 …」 · `[data-auto-team-degraded]`「事件源正常 / 降级：原因」。
  - `[data-panel-progress-row]`：`[data-panel-progress]`「完成 x/N」 · `[data-panel-plan-status]` · `[data-auto-team-pause]`。
  - 暂停横幅 `[data-panel-paused-banner]`、页签 `[data-panel-tabs]`、错误 `[data-error]`、正文 `[data-panel-body]` 原样保留。
- **M4 技能区**：`[data-role-field-skills]` → 头（「技能 已选 c/N」+ `[data-skill-add]`）→ `[data-skill-add-menu]`（3 个入口）→ `[data-skill-scroll]` → `[data-skill-row]`（1 行 1 技能）→ `[data-skill-notice]`。
- **M4 模型字段**：`[data-role-field-model]` → `[data-role-model-picker]`（按钮，显示 `provider / model` 或「跟随会话默认」）→ `[data-role-model-popover]`（搜索 + 列表 + 手动填写折叠）。

---

## 2. 关键页面线框（布局 / 组件 / 状态）

### 2.1 M1 工具条选项（`conversation.input.left`）

```
[ ● 自动团队 ]  [权限] [计划] …      ← 与相邻控件同一基线，右缘留 4px
  ↑6px 点  ↑13px/500，单行 ellipsis
```

- **结构**：`span[data-auto-team-option][role=switch][tabindex=0]` → `[data-option-dot]`（6×6）+ `[data-option-label]`；busy 时追加 `[data-option-spinner]`（12×12）。**无第三块文案**。
- **根选择器必须同时含**（AC-3）：`white-space: nowrap; text-overflow: ellipsis; max-width: min(100%, 160px); min-width: 0; flex: 0 1 auto; align-self: center; margin-inline-end: 4px`。
- **状态**：
  - 未启用：`label-secondary` 文字、透明底、`border-l2`、圆点空心 `border-l3`。
  - 已启用：`label-primary`、`business 12%` 底、`business 45%` 描边、圆点 business 实心（600 字重）。
  - 暂停（`data-state="paused"`，快照给）：琥珀 12% 底 / 55% 描边 / 圆点琥珀 → 与「已启用」可区分。
  - 失败（`data-error-state="true"` + `[data-option-dot][data-tone="warn"]`）：**圆点琥珀实心 + 描边琥珀 45%，底不加色**；`title` 与 `aria-label` =「操作失败：<原因摘要>」；可见文本**逐字不变**（AC-6）。
  - busy：`aria-busy` + 环，文案不变，点击入口自己拦掉。
- **禁用**：不设 disabled（开关永远可点，失败可重试）；busy 期间 `pointer-events` 可留，逻辑里 return。

### 2.2 M2 会话头按钮（可开可收）

```
[▣ 自动团队]   aria-pressed=false（描边灰）
[▣ 自动团队]   aria-pressed=true （business 12% 底）
```

- 高 24、`padding: 0 8`、图标 14 + gap 6 + 4 字 52 → 86px；<480px 视口只留图标（宽 30px，`aria-label` 仍为「自动团队面板」）。
- `aria-label` 随状态变：未开「打开自动团队面板」/ 已开「收起自动团队面板」；`aria-pressed` 与页签真实存在性一致（**服务端/页签消失后**才改）。
- busy（点开/点收在飞）：`aria-busy="true"`、`cursor: progress`、图标不换、`aria-pressed` 不动。
- 收起失败：`aria-pressed` 保持 `true`，`title` =「收起失败：<原因>」，并保留 1.5s 后可再点。

### 2.3 M3 面板头部三段

```
┌ 自动团队        [已完成 3/3]                             刷新 ┐  28px  head（恰好 3 个子节点）
│ 计划 3 · 成员 2 · 并发 1/3 │ 队长模型 claude-… │ 事件源正常    │  18px  meta（折行允许，三组都在）
│ 完成 3/3   [已完成]                              [暂停]      │  28px  progress-row
└──────────────────────────────────────────────────────────────┘
```

- `[data-panel-head]`：`display:flex; align-items:center; gap:8px; height:28px; padding:4px 12px; border-bottom:1px solid border-l2`；标题 `flex:0 0 auto`、胶囊 `flex:0 1 auto`（`max-width:88px` + ellipsis）、`[data-panel-refresh]` 由 `margin-left:auto` 推到右端。
- `[data-panel-meta]`：`font-xxxs-11`、`label-tertiary`、`display:flex; flex-wrap:wrap; align-items:center; gap:4px 10px; padding:0 12px 4px`；**三组各是一个 `span`**，之间用 `[data-meta-sep]`（1px × 10px，`border-l1`，`aria-hidden`）。分组不是视觉装饰——AC-9 逐类计数要 == 1，所以「计划/成员/并发」只能出现在 `[data-meta-plan]` 一处（进度行与页签里不得再复述）。
- `[data-panel-progress-row]` 保持 r7 结构（完成 x/N + 状态胶囊 + 弹性 + 暂停）。
- **状态**：`enabled=false` 时头部照常显示（含空计划），只把胶囊显示为「未启用」；`degraded` 时 `[data-auto-team-degraded]` 转琥珀描边（文字仍 `label-secondary`），`title` = 原因。
- **空态**：计划为空 —— meta 显示 `计划 0 · 成员 0 · 并发 0/0`，进度行 `完成 0/0`（不隐藏、不换成空态卡）。

### 2.4 M4 模型弹层选择器

```
默认模型  [ claude / opus-4.1  ⌄ ]        ← 28px 按钮，值或「跟随会话默认」
           ┌───────────────────────────┐
           │搜索 provider 或模型名…    │  28px
           │ ● claude / opus-4.1      ✓ │  28px，选中 business 12%
           │   claude / sonnet-4.6      │
           │   …（max-height 320 内滚） │
           │───────────────────────────│
           │ ▸ 手动填写 provider / 模型 │  折叠区（new hook）
           └───────────────────────────┘
```

- 触发：`button[data-role-model-picker]`（高 28、`radius-sm`、`border-l2`、`bg-layer-1`、`text-align:left`、`min-width:0`、ellipsis），右侧 `⌄` 10px；值 = `provider / model`（等宽 11px）+ 模型名 13px；空 → 「跟随会话默认」（`label-tertiary`）。
- 气泡 `[data-role-model-popover]`：`position:absolute`（锚在 picker 下方 4px，左对齐），宽 `min(100%, 300px)`，`max-height: 320px`，`bg-layer-2` + `shadow-lv3` + `radius-md` + `padding: 8px`，`z-index: 20`。
- 列表项 `[data-model-option]`（28px，`radius-sm`）：左列模型名（13px，ellipsis）+ 右列 provider（11px 等宽，`label-tertiary`）；选中 `business 12%` 底 + 右端 ✓（`aria-selected="true"`，`role="option"`，列表 `role="listbox"`）。
- **无模型清单**（宿主未提供）：列表区换 `[data-model-empty]` 两行说明「宿主未提供可选模型清单」+「可用下方『手动填写』直接填 provider 与模型名，或留空跟随会话默认」，**不静默空白**（AC-16）。
- **手填兜底**：折叠区 `[data-role-model-manual]` → 两个输入 `[data-model-manual-provider]` / `[data-model-manual-model]`（28px，占位 `provider` / `model`）+ 一行提示「provider 与 model 必须同时填或同时空」。**卡片内不得出现 `[data-role-model-provider]` / `[data-role-model-name]`**（AC-16 判据）。
- 保存：沿用角色卡「保存」；保存成功后按钮文案由快照回填（不乐观），`title` = 完整 `provider / model`。
- 关闭：选一项即关闭并回填；`Esc` / 点外部关闭；焦点回到 picker。

### 2.5 M4 技能区（四来源行 + 三入口）

```
技能  已选 2/12                                   [ + 添加技能 ]
  ┌ 导入 .md │ 系统技能 │ 手动新建 ┐            ← 点击后展开，24px 高按钮
  ┌──────────────────────────────────────────┐
  │☑ 前端实现规范       [内置] [已修改]       │  ← 56px
  │  组件与样式约定…          编辑  恢复出厂   │
  │☐ 后端接口约定       [系统]                │
  │  来自宿主技能库…            编辑  删除     │
  └──────────────────────────────────────────┘  max-height 200 内滚
  已删除「旧规范」，并从 1 个角色摘除引用        ← [data-skill-notice]
```

- **头**：`[data-skills-head]`（`font-xxs-12`/500/`label-secondary`「技能 已选 c/N」）+ 右侧 `[data-skill-add]`（「＋ 添加技能」，高 20，文字按钮样式）。
- **三入口**：点 `[data-skill-add]` 展开 `[data-skill-add-menu]`，三个按钮 `[data-skill-add-import]`「导入 .md」/ `[data-skill-add-system]`「系统技能」/ `[data-skill-add-manual]`「手动新建」，高 24、`radius-sm`、`border-l2`；再次点收起。选中任一后自动收起。
- **行**（`[data-skill-row][data-skill-source="builtin|imported|system|manual"][data-skill-modified="true|false"]`）：
  - 第一行：`input[type=checkbox]`（14，`aria-label`=「选择技能：<标题>（<来源>）」）+ 标题 + `[data-skill-badge]`（2 字来源）+（`modified` 时）`[data-skill-modified]`「已修改」。
  - 第二行：说明（11px，`line-clamp:1`，`label-tertiary`）+ 右侧操作 `[data-skill-edit]`「编辑」+ `[data-skill-restore]`「恢复出厂」（builtin 专属）或 `[data-skill-delete]`「删除」（用户三源）。
  - 已勾选：描边 `business 45%` + 底 `business 8%`；**尺寸不变**。
- **来源色**（文字永远存在，颜色只作辅助）：内置 = `label-tertiary` + `border-l2`；导入 = business；系统 = success；手动 = `label-secondary` + **虚线**描边（`border-style: dashed`）。
- **排序**：内置（按内置清单顺序）→ 导入 → 系统 → 手动，组内按标题；**勾选/取消不重排**（行不跳）。
- **删除流程**：点「删除」→ 行内第二行变「确认删除『X』？[确认][取消]」（`[data-skill-delete-confirm]`）；确认后行消失，`[data-skill-notice]`（`role="status"`）显示「已删除『X』，并从 N 个角色摘除引用」（N 来自结果，AC-23）。删除失败 → `[data-role-error]` 显示原因。
- **恢复出厂**：builtin 行点「恢复出厂」→ 同行二次确认「恢复为出厂正文？你对该技能的修改会丢失」→ 成功后 `modified` 徽标消失 + 行内 notice「已恢复『X』为出厂正文」。
- **空态**：`skills.length === 0` → `[data-role-skill-empty]` 三段式：「还没有技能 / 从本地导入、从系统技能库挑选，或手动写一条 / 点上方『添加技能』」。
- **列表滚动**：`max-height: 200px`，`overflow-y: auto`；滚动条出现时行宽不跳（`scrollbar-gutter: stable`）。

### 2.6 M5 技能编辑弹层（含按需取正文）

```
┌ 编辑技能：前端实现规范                        [×] ┐   420 宽
│ 名称   [……………………………………]                     │
│ 说明   [……………………………………]                     │
│ 正文   ┌────────────────────────────────────┐  │
│        │（骨架 ×3 → textarea 200px 固定内滚）│  │
│        └────────────────────────────────────┘  │
│ ⓘ 内置技能：保存后写在本机副本，不改插件包内文件 │
│                    [恢复出厂]      [取消] [保存] │
└──────────────────────────────────────────────────┘
```

- `role="dialog" aria-modal="true" aria-labelledby` + 遮罩，`createPortal`。
- **打开即按需取正文**：`[data-skill-body]` 位置先渲染 3 条骨架；成功换 `textarea`（`rows=10`、`height:200px`、`resize: vertical`、内滚，**不 auto-grow**）；失败换「正文读取失败：<原因>」+「重试」。
- 内置技能的提示条 `[data-skill-builtin-hint]`（11px，`label-tertiary`，左侧 2px `border-l3` 竖条）必须存在——它解释了「改了但仓库没变」，避免用户以为改动丢了（AC-20）。
- 保存：非乐观——点保存后按钮 `aria-busy`、文案变「保存中…」；成功后弹层关闭、行 `modified` 变 true + notice「已保存『X』」；失败弹层不关，`[data-dialog-error]` 显示原因，正文不清空。
- 创建模式（`manual`）：标题「新建技能」，正文区直接可编辑，无「恢复出厂」；保存后新行出现在「手动」组。
- **校验**：名称/说明/正文均非空（去空白）；正文 > 20000 字符拒绝并提示；同名（同来源）自动加后缀 `-2`（由保存结果决定，界面只显示结果），**绝不静默覆盖**（AC-19）。
- 键盘：`Esc` 关闭（有未保存改动时先二次确认「放弃修改？」）；`Tab` 在弹层内循环；关闭后焦点回到触发行。

### 2.7 M6 系统技能多选弹层

```
┌ 从系统技能库选择                         [×] ┐  480 宽
│ [搜索技能名或说明…]                         │  28
│ ☑ 前端实现规范   组件与样式约定…            │  40
│ ☐ 后端接口约定   接口与错误码规范…          │
│ …（240px 内滚）                             │
│ 已选 2 条                    [取消] [导入所选] │
└─────────────────────────────────────────────┘
```

- 每项：checkbox + 名称（12/600）+ 说明（11/400，1 行 clamp）+ 右端来源名（可选，11px 等粗）；`title` 显示完整说明。
- 搜索：输入即过滤（名称 + 说明，大小写不敏感）；无匹配 → 「没有匹配『<关键词>』的技能」。
- 底部 `[data-skill-picker-count]`「已选 N 条」；未选时「导入所选」disabled。
- 导入结果：关闭弹层 → 行列表新增若干 `[data-skill-row][data-skill-source="system"]`，`[data-skill-notice]` =「已从系统技能库导入 N 条」（重名自动加后缀，notification 里点名「其中 M 条重名已加后缀」）。
- 读取失败 / 本机无技能：见 §0.4（说明 + 重试，不静默空列表）。

### 2.8 M6 恢复默认（连带内置技能）

```
┌ 恢复默认角色与内置技能                                ┐  420 宽
│ 这会把 11 个内置角色与内置技能正文恢复为出厂版本：     │
│  · 11 个内置角色 → 出厂定义                          │
│  · 内置技能正文 → 出厂，已修改标记清除                 │
│ 你的自建角色 2 个、自建/导入/系统技能 5 条不受影响。    │
│                              [取消]  [恢复默认]        │
└─────────────────────────────────────────────────────┘
```

- 入口仍是角色区底部「一键恢复默认角色」按钮；点开即此对话框（`[data-roles-restore-confirm]`，替换 r7 的行内文案确认）。
- 「恢复默认」按钮用**琥珀**（`warn 14%` 底 / `warn 55%` 描边 / `label-primary` 字），**不用红**：它覆盖的是内置技能的用户修改，不是删除用户数据；红色留给不可恢复的失败。
- 数字（11 / 自建角色数 / 用户技能数）必须来自快照，**不得写死**（否则用户看到与自身数据不符的承诺）。
- 执行中：按钮 `aria-busy` +「恢复中…」，对话框不关；成功 → 关闭 + `[data-hint]`「已恢复 11 个内置角色与 N 条内置技能，你的 M 条技能未受影响」；失败 → 对话框内 `[data-dialog-error]`。

---

## 3. 交互与动效说明

### 3.1 关键流程（用户视角）

1. **开关**：点「自动团队」→ 文案/圆点不动，只转环 → 快照回来 → 变强调色 + 命中一次 300ms flash。失败 → 圆点琥珀、`title` 出现原因，**面板**里 `[data-error]` 同步可见同一条原因。
2. **开合面板**（三分支必须都成立）：未开 → 点 → `openPanel()` → 页签出现 → `aria-pressed=true`；已开 → 点 → 面板侧 `tab.actions.close()` → 页签消失 → `aria-pressed=false`；宿主服务缺失 → CustomEvent 回退打开，**不抛错**、按钮仍如实反映。
3. **读头部**：标题 → 状态胶囊 → 刷新（一条线）；下一行读规模与来源；再下一行读进度与暂停。三段之间用 4px/1px 分隔（不是把字挤在一起靠颜色分区）。
4. **选模型**：点按钮 → 气泡 → 输入过滤 → 点一项 → 回填 → 保存 → 重开面板仍是新值（AC-16）。
5. **加技能**：三入口任一 → 结果落到列表（带来源徽标）→ 勾上该角色 → 保存角色 → 重启后仍在（AC-29）。
6. **改内置技能**：行「编辑」→ 正文加载 → 改 → 保存 → 行出现「已修改」+「恢复出厂」可点。

### 3.2 交互清单（每个控件都要有 hover/active/focus/disabled/busy）

| 控件 | hover | active | focus-visible | disabled | busy |
| --- | --- | --- | --- | --- | --- |
| 工具条选项 | 底 hover 底 + `border-l3` | active 底 | 2px business outline | — | `aria-busy` + 环，文案不变 |
| 会话头按钮 | 同上 | 同上 | 同上 | — | 图标不换、`aria-pressed` 不动 |
| 刷新 / 暂停 | 同上 | 同上 | 同上 | `opacity .55` | 环 + 文案不变 |
| 模型 picker / 气泡行 | 底 hover | 底 active | outline | 无模型时 picker 仍可点（开气泡看说明） | — |
| 技能行 checkbox | 行底 `bg-layer-2` | — | 2px outline | 保存中禁用 | — |
| 技能行文字按钮 | 底 hover | 底 active | outline | 保存中禁用 | — |
| 弹层按钮 | 底 hover | 底 active | outline | 条件禁用（未选/无改动） | 「保存中…」 |

### 3.3 焦点与键盘

- 工具条选项：`Enter` / `Space` 切换（已有）；`Tab` 顺序与相邻控件一致。
- 模型气泡：打开时焦点进搜索框；`↑/↓` 移动、`Enter` 选中、`Esc` 关闭并回到 picker。
- 模态：打开时焦点到第一个可编辑字段（编辑弹层 → 名称；系统技能 → 搜索框）；`Esc` 关闭（编辑弹层有改动时先二次确认）；`Tab` 在弹层内循环（首尾互跳）；关闭后焦点回到触发元素。
- 破坏性动作（删除技能、恢复出厂、恢复默认）：焦点默认落**取消**，不是确认键。

### 3.4 单一数据源纪律（沿用 r7 §3.3）

- 面板角色页与设置页共用 `RoleEditorList`，技能/模型的新 UI 只在这一处实现；保存仍走 `act({type:'saveRole'})`。
- 技能列表数据只来自 `snapshot.skills`（元数据），正文只在编辑弹层里按需读取；**组件内不留第二份技能缓存**，避免「列表显示已改、弹层回到旧正文」。

---

## 4. 视觉规范（token 映射，禁止新造）

| 用途 | token |
| --- | --- |
| 主文字 / 次文字 / 弱文字 | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` |
| 描边（常规 / hover / 强调） | `--dsw-alias-border-l1` / `-l2` / `-l3` |
| 卡片底 / 弹层底 / 遮罩底 | `--dsw-alias-bg-layer-1` / `-2` / `-3` |
| 强调（启用、选中、focus） | `--dsw-alias-state-business-primary` |
| 成功（系统技能来源、「已就绪」） | `--dsw-alias-state-success-primary` |
| 警告（暂停、失败残留点、恢复默认确认按钮） | `--dsw-alias-state-warn-primary` |
| 错误（仅角色/技能校验错误文案） | `--dsw-alias-state-error-primary` |
| 交互底 | `--dsw-alias-interactive-bg-hover` / `-active` |
| 阴影 | `--dsw-shadow-lv1`（卡片）/ `-lv3`（弹层） |
| 圆角 | `radius-xs 4` / `-sm 8` / `-md 12` / `-lg 16` |
| 字 | `font-xxxs-11` / `-xxs-12` / `-xs-13`（**`font:` 简写**） |

---

## 5. 无障碍要点

1. 工具条选项：`role="switch"` + `aria-checked` + 完整 `aria-label`（含系统/暂停语义，可见文本只有四个字）；失败时 `aria-label` 与 `title` 同时带「操作失败：<原因>」，**不能只靠颜色**（AC-6）。
2. 会话头按钮：`aria-pressed` 必须与「页签是否真的在」一致；另有 `aria-label` 说明当前动作（打开/收起）。
3. 面板头部：`[data-panel-title]` 用 `h2`（页签名已有标题时降为 `strong` + `aria-label`）；meta 三组各有 `aria-label` 全句（「计划 3 个任务，成员 2 个，并发 1/3」），分隔符 `aria-hidden`。
4. 进度行：`完成 3/12` 文本本身可读，不需要 `progressbar` 角色（比例语义由文案承载）；暂停按钮 `aria-pressed` 表达暂停态、`title` 说明后果。
5. 技能行：checkbox 的 `aria-label` =「选择技能：<标题>（<来源>，已修改）」；来源与已修改**同时有文字**，颜色不单独承载信息；`[data-skill-badge]` 不设 `aria-hidden`。
6. 弹层：`role="dialog"` / `aria-modal="true"` / `aria-labelledby` / 焦点陷阱 / `Esc` / 焦点回归；遮罩不出现在 tab 序里。
7. 通知：`[data-skill-notice]` 与 `[data-hint]` 用 `role="status"`（polite）；错误 `role="alert"`。**工具条选项内禁止 `role="alert"`**（AC-5）。
8. 对比度：11px 文本不用琥珀（§0.1-3）；`label-tertiary` 只用于辅助信息，不承载唯一的关键状态。
9. 动效：`prefers-reduced-motion` 下关呼吸/旋转/位移；闪烁（flash）仍保留颜色变化（信息性）。
10. 命中区：工具条选项 24px 视觉高，用 `::after` 扩到 40×40；技能行文字按钮 20px 高，`::after` 外扩 6px 纵向（不影响行高）。

---

## 6. 设计侧定案（对应 PRD §7 九条）

| # | 问题 | 本轮定案 | 视觉后果 |
| --- | --- | --- | --- |
| 1 | 系统技能读取通道 | **技术方案定**（宿主能力优先、目录扫描兜底）；设计只固定三态：加载 / 空（说明+两个替代入口）/ 失败（原因+重试） | §2.7、§0.4 |
| 2 | 技能元数据落点与存量迁移 | **技术方案定**；界面只消费 `source` / `modified`，不关心存储形态 | 徽标与筛选逻辑不变 |
| 3 | 正文读取通道 | **技术方案定**；界面固定「按需读取 + 骨架 + 失败重试 + 绝不空 textarea」 | §2.6 |
| 4 | 内置被改的展示 | **单条 + 「已修改」徽标 + 「恢复出厂」**（不拆两条） | §2.5 |
| 5 | 删被引用技能 | **允许删除 + 自动摘除 + 结果写「已从 N 个角色摘除」** | §2.5 删除流程 |
| 6 | 系统技能选择形态 | **多选 + 搜索**的模态（一次导入多条） | §2.7 |
| 7 | 内置技能规模 | **≥12 条**（11 角色各 1–2 条 + 跨角色通用），列表用 200px 内滚承载 | §2.5 |
| 8 | 恢复默认形态 | **一个按钮连带**（角色 + 内置技能），二次确认列清范围与数字 | §2.8 |
| 9 | 导入 md 宽松度 | **宽松**：缺 frontmatter → 文件名作标题、首段截 60 字作说明，并就地提示可再编辑；只拒非 `.md` / 空文件 / > 1MB | §2.5、§2.6 |

---

## 7. AC 覆盖对照（设计侧证据）

| AC | 设计落点 |
| --- | --- |
| AC-1 / AC-2 | §1.1 表（只列 `conversation.input.left`；撤除面 = `conversation.input.dock` 0 处） |
| AC-3 | §2.1 根选择器六条属性 + 24px 高 + 四字标签 |
| AC-4 | §2.1「点击只发 toggle」与 §3.1-1 无隐式派发 |
| AC-5 / AC-6 / AC-7 | §0.3 失败行 + §2.1 失败态（琥珀实心点、底不加色、文案不变、title/aria-label 承载原因）；§0.7-2 |
| AC-8 | §1.1 两处既有入口保留（头部按钮 + 右栏页签） |
| AC-9 / AC-10 | §2.3（head 恰 3 子节点、meta 恰 3 组、progress-row 独立；折行不隐藏） |
| AC-11 | §2.2 三态（开 / 收 / 服务缺失回退）+ 非乐观 |
| AC-14 | §0.6-1（24px、右缘 4px、900px 视口标签完整；不按视口隐藏） |
| AC-16 | §2.4（按钮 + 气泡；裸 provider/model 输入 0 处，手填进折叠区） |
| AC-18 / AC-19 / AC-20 | §2.5 三入口 + 四来源徽标 + modified；§2.6 按需取正文 + 内置提示条 |
| AC-21 | §6-#7（≥12 条由列表承载，不再加宽卡片） |
| AC-23 | §2.5 删除流程（builtin 无删除入口、结果含「从 N 个角色摘除」） |
| AC-29 | §3.1-5/6 与 §2.6/§2.7 的完整链路（导入 / 系统 / 手动 / 改内置） |

---

## 8. 给开发阶段的实现约束（照抄，不猜）

1. **样式只写进 `src/client/styles.ts`**，不新增 CSS 文件、不新增 token；字号一律 `font: var(--dsw-font-*)`。
2. **hook 名字面量**（单测按这些抓）：`data-auto-team-option` / `data-option-dot` / `data-option-label` / `data-option-spinner`（**删除** `data-option-error`）、`data-auto-team-header-button`、`data-panel-head` / `data-panel-meta` / `data-panel-progress-row` / `data-meta-plan` / `data-captain-model` / `data-auto-team-degraded` / `data-panel-title` / `data-panel-refresh`、`data-role-model-picker` / `data-role-model-popover` / `data-model-option` / `data-model-empty` / `data-role-model-manual` / `data-model-manual-provider` / `data-model-manual-model`（**删除** `data-role-model-provider` / `data-role-model-name`）、`data-skill-row` / `data-skill-source` / `data-skill-modified` / `data-skill-badge` / `data-skill-edit` / `data-skill-restore` / `data-skill-delete` / `data-skill-delete-confirm` / `data-skill-add` / `data-skill-add-menu` / `data-skill-add-import` / `data-skill-add-system` / `data-skill-add-manual` / `data-skill-scroll` / `data-skill-notice` / `data-skill-editor` / `data-skill-body` / `data-skill-builtin-hint` / `data-skill-picker` / `data-skill-picker-empty` / `data-skill-picker-count` / `data-dialog-error`。
3. 面板头部**同一类信息只渲染 1 处**：`计划/成员/并发` 只在 `[data-meta-plan]`；`队长模型` 只在 `[data-captain-model]`；`事件源` 只在 `[data-auto-team-degraded]`。
4. 会话头按钮的开合必须走三条分支（开 / 收 / 服务缺失），`aria-pressed` 只在状态真实变化后改。
5. 技能相关改动**复用** `saveRole` 载荷与既有读取口，不新增 `PanelAction`、不新增 HTTP 路由；正文按需读取走既有接口。
6. 模态一律 `createPortal(…, document.body)`，并处理 `Esc`、焦点陷阱与焦点回归。
7. 文本长度一律 `min-width:0` + ellipsis / `line-clamp`；textarea 固定高度内滚，**禁止 auto-grow**。
8. 三条硬禁令：工具条选项内不出现红字/`role="alert"`/错误色；不把正文放进快照；不给 builtin 技能渲染删除按钮。
