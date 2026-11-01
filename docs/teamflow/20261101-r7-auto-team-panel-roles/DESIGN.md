<!-- meta: summary="r7 增量设计：输入框内 pill 选项（28px 高，取代整宽开关行）+ 会话头紧凑按钮 + 面板页头「完成 x/N · 计划状态 · 暂停/继续」+ 任务行四要素 + 设置页（6 参数 + 角色卡片共用 RoleEditor）+ 暂停=琥珀态；全量复用 --dsw-* token，data-auto-team-* 单一前缀" -->
基线依赖：`docs/teamflow/20261101-r6-real-host-activation`（真机激活契约）、`docs/teamflow/20261030-r1-auto-team-plugin`（§0 视觉规范与 token 来源）、`docs/teamflow/20261101-r4-peer-delivery-watchdog`（§0.4 停滞态视觉身份）
取代：`docs/teamflow/20261030-r1-auto-team-plugin#AC-12` 的「输入框下方整宽 32px 开关行」——由 `conversation.input.dock` 内的紧凑 pill 选项取代（`conversation.composer.dock` 注册数归 0）

# DESIGN · r7 输入框选项 / 页头暂停 / 设置页角色管理

> **读法**：§0 是"craft"合同（数字直接抄，禁止形容词），开发只看到文件头部，所以它排在最前面。§1 之后是 IA / 线框 / 交互 / token 映射 / 无障碍 / AC 对照 / 实现约束。
> **本轮不新建设计系统**：r1 §0 已把宿主 token 来源实测落盘（`--dsw-*`），本轮沿用同一套，只新增"这四处新界面怎么长"。

## 0. 视觉与手感规范（先读这一节）

### 0.0 一个必须先定的事：hook 属性单一前缀

现状是**双前缀并存**（实测 `grep -rhoE 'data-(dsh-)?auto-team[a-z-]*' test/ src/ | sort | uniq -c`）：`data-dsh-auto-team-panel` 38 处、`data-dsh-auto-team-toggle` 23 处，而 `data-auto-team-plan|member|roles|memory|tab-title` 等已有 77 处。PRD 本轮判据（AC-19/AC-12）用的是 `data-auto-team-*`。

**决定**：统一到 `data-auto-team-*` 单一前缀。本轮同批改名的只有两个族：
- `data-dsh-auto-team-panel` → `data-auto-team-panel`
- `data-dsh-auto-team-toggle` → 该行整体删除，改由 `data-auto-team-option` 承担（见 §2.1）

判据（两条都要绿）：`grep -rc 'data-dsh-auto-team' src test | grep -v ':0'` 无输出；`grep -c 'data-auto-team-option' src/client/*.tsx` ≥ 1。
**理由**：双前缀会让 QA 的 `querySelectorAll` 与既有单测各测一半，出现"两边都绿、真机四项里有项为 0"的历史形态（PRD §4 反面目标 5）。改名是机械替换 + 同步单测，比长期维护两套钩子便宜。

### 0.1 token 来源（沿用 r1 §0.1，本轮不新增任何 token）

只用仓库已出现过的 token，**一个新名字都不造**：

- 半径：`--dsw-radius-xs:4 / -sm:8 / -md:12 / -lg:16`
- 描边：`--dsw-alias-border-l1..l4`
- 底色：`--dsw-alias-bg-base / -layer-1 / -layer-2 / -layer-3`
- 文字：`--dsw-alias-label-primary / -secondary / -tertiary`；反色 `--dsw-alias-label-primary-inverse`
- 交互：`--dsw-alias-interactive-bg-hover / -active`
- 状态：`--dsw-alias-state-{business,success,warn,error}-primary`
- 阴影：`--dsw-shadow-lv1 / -lv2 / -lv3`
- 字体：`--dsw-font-xxxs-11`(11/16) / `--dsw-font-xxs-12`(12/18) / `--dsw-font-xs-13`(13/20)；等宽 `--ds-font-family-code`
- 动效：`--ds-ease-in-out: cubic-bezier(.4,0,.2,1)`；时长直接写字面 `120ms / 200ms / 300ms`（仓库既有写法）

**两条铁律**（已踩过，写进 code review checklist）：
1. 字号必须写 `font: var(--dsw-font-xs-13, 13px/20px sans-serif)`。写 `font-size: var(...)` 是**无效声明**——构建不报错、console 不报错，元素静默继承父级字号。
2. 禁止 `#hex` / 写死 `rgba()` 实底色。半透明叠层只用 `color-mix(in srgb, var(--dsw-alias-state-…) 12%, transparent)`，暗色主题自动跟随。

### 0.2 表面处理（数字直接抄）

| 元素 | 半径 | 描边 | 底色 | 阴影 | 尺寸 |
| --- | --- | --- | --- | --- | --- |
| 输入框内 pill 选项（未启用） | 999px | 1px `border-l2` | transparent | 无 | 高 **28px**，`padding: 3px 10px`，`width: fit-content` |
| 输入框内 pill 选项（已启用） | 999px | 1px `color-mix(business 45%, transparent)` | `color-mix(business 12%, transparent)` | 无 | 同上（**尺寸不因状态变化**） |
| 会话头按钮 | `radius-sm` 8px | 1px `border-l2` | transparent | 无 | 高 **24px**，`padding: 0 8px` |
| 面板页头控制条 | 0（贴面板顶） | 底部 1px `border-l2` | transparent | 无 | 高 **40px**，`padding: 8px 12px` |
| 暂停按钮（可暂停态） | `radius-sm` 8px | 1px `border-l2` | `bg-layer-1` | 无 | 高 **28px**，`min-width: 80px`，文字居中 |
| 暂停按钮（已暂停 → 继续） | `radius-sm` 8px | 1px `color-mix(warn 55%, transparent)` | `color-mix(warn 14%, transparent)` | 无 | **尺寸与上一态逐像素相同** |
| 暂停横幅（计划页顶部） | `radius-sm` 8px | 1px `color-mix(warn 40%, transparent)`；左侧 3px `warn` 竖条 | `color-mix(warn 10%, transparent)` | 无 | 高 **32px**，`padding-left: 10px` |
| 任务卡 | `radius-md` 12px | 1px `border-l2` | `bg-layer-1` | `shadow-lv1` | `padding: 10px 12px`，卡间距 8px |
| 任务卡（暂停中） | `radius-md` 12px | 1px `color-mix(warn 40%, transparent)` | `bg-layer-1` | 无（去掉阴影，静态感） | 同上 |
| 状态标签 badge | 999px | 1px `color-mix(tone 30%, transparent)` | `color-mix(tone 12%, transparent)` | 无 | 高 **20px**，`padding: 0 6px` |
| 设置页卡片 | `radius-md` 12px | 1px `border-l2` | `bg-layer-1` | **无阴影**（避免与宿主设置项撞层） | `padding: 16px` |
| 设置页输入/下拉 | `radius-sm` 8px | 1px `border-l2`，focus 转 `business` | `bg-base` | 无 | 高 **28px**，`padding: 0 8px` |
| 二次确认对话框 | `radius-lg` 16px | 1px `border-l2` | `bg-layer-2` | `shadow-lv3` | 宽 **420px**，`padding: 20px` |

### 0.3 状态反馈（每个可交互元素缺一即不合格）

| 态 | 变化 | 时长/缓动 |
| --- | --- | --- |
| hover | 底色 → `--dsw-alias-interactive-bg-hover`；描边 → `border-l3` | `120ms var(--ds-ease-in-out)` |
| active（按下） | 底色 → `--dsw-alias-interactive-bg-active` | `80ms` |
| focus-visible | `outline: 2px solid var(--dsw-alias-state-business-primary)`，`outline-offset: 1px` | 即时（无过渡，键盘用户要立刻看到） |
| disabled | `opacity: .55`；`cursor: not-allowed`；**不改变尺寸** | 即时 |
| busy（请求在飞） | 文案**逐字不变**、`aria-busy="true"`、`cursor: progress`、右侧 12×12 旋转环（1px 描边 + 1/4 弧，`800ms linear infinite`；`prefers-reduced-motion` 时改为静态双点） | — |
| 服务端确认（hit-flash） | 收到快照且值与点击前不同 → 该控件 `data-flash="true"` 300ms：`color-mix(business 20%, transparent)` → transparent | `300ms` |
| error | 描边 `--dsw-alias-state-error-primary` 持续到下一次交互；`[data-error]` 文案 200ms 淡入；**绝不乐观改文案**（AC-15） | `200ms` |

**统一纪律**：所有按钮在请求飞行期间 `disabled`（或 `aria-disabled`）但**文案不动**——"点了没反应"之外最糟的体验是"点了先变绿、失败再变回来"。

### 0.4 暂停态的视觉身份（必须与 失败/中断 一眼可分）

| 语义 | 颜色 | 图标 | 文案 | 附加 |
| --- | --- | --- | --- | --- |
| 已暂停 `paused` | **warn 琥珀** | `⏸` | 已暂停 | 左 3px 琥珀竖条 + 卡片描边琥珀 40% + 去阴影 |
| 已中断 `interrupted` | danger 红 | `⚡` | 已中断 | 无竖条 |
| 失败 `failed` | danger 红 | `✕` | 失败 | 无竖条 |
| 已终止 `terminated` / 已取消 `cancelled` | neutral 灰 | `■` | 已终止 / 已取消 | 无 |
| 运行中 `running` | business 蓝 | `●` | 运行中 | 圆点 200ms 呼吸（`prefers-reduced-motion` 时静止） |

**硬规则**：暂停**永不用红**。红＝不可恢复的失败；琥珀＝"我等你"，可一键继续。两者混色会让用户以为任务坏了。
暂停卡片必须**保留暂停前的门禁证据**（退出码 chip 不清空），否则「继续后逐字段相同」这条对账在界面上无法被用户自己核对（AC-20）。

### 0.5 排版角色与数字对齐

| 用途 | token | 字重 | 其他 |
| --- | --- | --- | --- |
| 面板页头 `完成 x/N` | `--dsw-font-xs-13` | 600 | `font-variant-numeric: tabular-nums`（x/N 变化不跳动） |
| 计划状态 chip（页头） | `--dsw-font-xxs-12` | 500 | 与页头同基线 |
| 页签文字 | `--dsw-font-xs-13` | 500（选中 600） | 选中：`label-primary` + 底部 2px business；未选 `label-secondary` |
| 任务标题 | `--dsw-font-xs-13` | 600 | 单行 ellipsis |
| 任务内容（`acceptance` 截断） | `--dsw-font-xxs-12` | 400，`label-secondary` | `-webkit-line-clamp: 2`，行高 18 |
| 元信息 / 门禁证据 | `--dsw-font-xxxs-11` | 400，`label-tertiary` | 退出码用 `font-family: var(--ds-font-family-code)` + tabular |
| 状态 badge | `--dsw-font-xxxs-11` | 500 | 与 tone 同色文字 |
| 设置项 label | `--dsw-font-xxs-12` | 500，`label-secondary` | 与控件同一行时右对齐到 200px 列 |
| 设置项数值 | `--dsw-font-xs-13` | 400，`label-primary` | 数字输入 `tabular-nums` |
| 角色卡标题（角色名） | `--dsw-font-xs-13` | 600 | 后接 `label-tertiary` 的「内置 / 自建」 |
| 对话框标题 | `--dsw-font-xs-13` | 600 | — |

**数字一律 `tabular-nums`**：`完成 3/12`、`C-3/12`、退出码、`attempts`、时间戳。等宽数字是"工业感"的唯一免费来源，也是对齐的唯一保证。

### 0.6 动效 / 加载 / 空 / 错误（只列本轮变化项）

- **面板页切换**：不做位移、不做缩放；仅 `opacity 0→1` `100ms`。页签指示条 `120ms` 过渡。
- **首屏加载**：3 条骨架（每条高 **76px**、`radius-md`、`bg-layer-2`、`1200ms` 呼吸），**不用 spinner**。骨架条数与真实任务卡最小高度（76px）一致，避免加载完成时高度跳变。
- **空态**：沿用 r1 `[data-empty]` 三段式（标题 / 一句说明 / `[data-empty-next]` 下一步动作，左侧 2px `border-l3` 竖条）。新增两处空态文案位：计划页「尚未生成计划」、设置页角色区「还没有自建角色」。
- **错误**：`[data-error]` + `role="alert"`，就地显示在出错控件下方 4px；不弹 toast（宿主无统一 toast 契约，自造会在真机上错位）。
- **暂停/继续切换**：页头横幅 120ms 淡入；任务卡描边 120ms 过渡；**列表不重排**（`paused` 任务保持原位置，不浮到顶部——位置稳定才能让用户核对"哪些被打断"）。
- `@media (prefers-reduced-motion: reduce)`：关闭呼吸/旋转，全部改为静态。

### 0.7 几何自洽核算（按**最大取值**算，不是平均值）

1. **pill 选项**：高 28 = 行高 18 + 2×3 padding + 2×1 边框 ✓（AC-12 上限 44px，余 16px）。
   最坏文案 `自动团队 · 计划就绪 5 任务`：圆点 6 + gap 6 + 中文 13 字×12px ≈ 156 + 数字 tabular ≈ 22 → 内容约 **190px**；`max-width: min(100%, 260px)` + ellipsis ✓（260 为容器上限，不是平均）。
   触控目标：视觉高 28 < 44 → 用 `::after { position:absolute; inset:-8px -6px; content:'' }` 把**命中区**扩到 44×40，`pointer-events` 不拦截子元素（子元素无交互）。布局高度不受影响 ✓。
2. **会话头按钮**：高 24 = 18 + 2×3 ✓；宽 = 8 + 14(icon) + 6 + 48(4 中文字) + 8 + 2 = **86px**；在 <480px 视口只留图标（`aria-label` 仍为「自动团队」），宽降到 32px ✓。
3. **面板页头**（面板宽下限按 **320px** 设计，宿主右栏可拖宽）：
   320 − 左右 padding 24 − 暂停按钮 80 − gap 8 − 状态 chip 64 = **144px** 给 `完成 x/N`；
   最坏 `完成 999/999` ≈ 26 + 4 + 7×7 = **79px** ✓（余 65px）。若宿主右栏窄于 300px，降级为 `999/999`（省略「完成」二字），最坏 49px ✓。
4. **状态 badge**：高 20 = 行高 16 + 2×2 ✓；最坏 4 字（已暂停/待返工）= 44 + 12 + 2 = **58px**；与标题同行时标题 `flex:1; min-width:0`，320px 下标题可用 320 − 24 − 58 − 8 = **230px** ✓。
5. **任务卡**：20(标题) + 4 + 36(内容 2×18) + 4 + 16(元信息) + 20(padding) = **100px**；`line-clamp:2` 保证 `acceptance` 再长也不增长 ✓（acceptance 最长可达数百字，这是必须 clamp 的唯一理由）。
6. **设置页角色卡**：28(名称行) + 4 + 64(描述 textarea) + 4 + 96(提示词 textarea) + 4 + 28(技能行) + 4 + 28(模型行) + 32(padding) = **264px**。
   **提示词 textarea 固定 `min-height: 96px` + 内滚，绝不 auto-grow**——否则 8000 字符上限会让卡片高到上万像素，同一屏内的"保存"按钮永远够不到 ✓（这是本轮最容易写错的几何点）。
7. **恢复默认对话框**：宽 420，`max-width: calc(100vw - 32px)`；高 = 20 + 18(标题) + 8 + 54(正文最多 3 行) + 16 + 28(按钮) + 20 = **164px** ✓。
8. **面板最小宽度假设**：320px。所有可变长文本行必须 `min-width: 0` + ellipsis；**禁止**对可变长文本用 `white-space: nowrap`（会撑破右栏并产生横向滚动）。

### 0.8 本产品的反模式（本轮追加；r1 §0.8 十条继续有效）

1. **不做整宽开关行**：任何"输入框下方一整行"的容器都不许回来（AC-12 判据是 `composer.dock` 注册数 0，但视觉上也别在原地堆一行 pill）。
2. **不占 `shadows-shipped-ui` 槽位**：`composer.bar` / `input.activity` / `header.corner` / `shell.leading` / `settings.header` 一律不碰（占位=遮住宿主自带 UI）。
3. **不做乐观更新文案**：暂停/继续、保存、恢复默认，全部等服务端快照回来再改文案（AC-15 硬判据）。
4. **不硬编码颜色**、不用未定义的 token 名（写了不存在别名＝静默继承父色，构建与 console 都不报错）。
5. **不给内置角色出删除按钮**：不是禁用态灰按钮，是**不存在**——灰按钮会让人反复尝试并怀疑权限。
6. **不做依赖图 / 甘特图**：任务流转用"列表 + 状态标签"表达（PRD 澄清项 taste 的默认结论）；右栏 320px 宽画不出依赖图。
7. **不做全屏 loading 遮罩**：面板宽度只有 320–420px，遮罩会把"已加载的部分"一起吃掉。
8. **同一份角色数据不设两条保存链**：面板角色页与设置页角色区必须调用**同一个** `saveRole` action 与同一个校验函数（见 §3.3），否则"面板改的顺手、设置改的不生效"必然发生。
9. **不新增路由、不新增 `ActivityEvent.kind`、不新增 `PlanTask` 字段**：任务内容用现有 `title` + `acceptance`（AC-10 形状冻结）。
10. **不在暂停态清空门禁证据**：证据是用户自己核对"继续后没被回退"的唯一依据（§0.4）。

## 1. 页面 / 模块清单与信息架构

### 1.1 入口与容器（四个可见面 + 一个被撤除面）

| # | 界面 | 宿主落位 | 根 hook | 本轮变化 |
| --- | --- | --- | --- | --- |
| E1 | 自动团队选项（pill） | `conversation.input.dock` | `data-auto-team-option` | **新增**（取代 E1'） |
| E1' | ~~输入框下开关行~~ | ~~`conversation.composer.dock`~~ | ~~`data-dsh-auto-team-toggle`~~ | **撤除**（注册数 0，CSS 段整段删） |
| E2 | 会话头按钮 | `conversation.session.header.actions` | `data-auto-team-header-button` | **新增** |
| E3 | 右栏页签（标题 chip + 面板体） | `sidebar.right.pane.tab` / `.title`（同 key）+ `sidebarRightTabs.register` | `data-auto-team-panel` / `data-auto-team-panel-tab` | 页头加「完成 x/N · 计划状态 · 暂停/继续」，任务行补四要素 |
| E4 | 设置页「自动团队」 | `settings.section` | `data-auto-team-settings` | **新增**（参数区 + 角色区） |

### 1.2 信息架构（E3 内部）

```
面板（E3）  data-auto-team-panel
├─ 页头控制条  [完成 3/12] [计划状态 chip] ………………… [暂停任务 / 继续任务]
├─ 暂停横幅（仅 paused 时）
├─ 页签条  [计划][成员][记忆][角色]          ← 既有四页，键盘 ←/→ 可切
└─ 页体（[data-panel-body]，独立内滚）
   ├─ 计划页  ← 本轮重点：任务行四要素（标题 / 任务内容 / 状态流转 / 完成状态）
   │   └─ 任务卡[data-task-id]：标题 + 状态 badge + 内容 2 行 + 角色 + 门禁证据
   ├─ 成员页  既有（成员状态 + 绑定任务）
   ├─ 记忆页  既有
   └─ 角色页  既有编辑能力保留，但**与设置页共用同一个 RoleEditor 组件与同一个 saveRole**
```

### 1.3 信息架构（E4 内部）

```
设置页（E4）  data-auto-team-settings   标题「自动团队」  内容列 max-width 720px
├─ 参数区（卡片 × 2）
│   ├─ 执行参数：concurrencyLimit / memoryBudget / stallMs / maxAttempts / gateTimeoutMs
│   └─ 模型参数：captainModel（provider + model）
├─ 角色区（卡片 × N，每张 data-role-id）
│   ├─ 名称行：可编辑名 + 「内置 / 自建」+ 删除按钮（仅自建）
│   ├─ 描述 duty（单行 input）
│   ├─ 提示词 prompt（textarea，固定 96px 内滚）
│   ├─ 技能（6 个技能 id 多选，chip 复选）
│   └─ 默认模型（provider + model）
└─ 底部动作条（sticky）：[新增角色] ……… [一键恢复默认角色] [保存]
```

## 2. 关键页面线框（布局 / 组件 / 状态）

### 2.1 E1 输入框内 pill 选项（`conversation.input.dock`，`order: 5`）

```
┌──────────────────────────────────────────────── 输入卡上方，左对齐 ─┐
│  ● 自动团队 · 已启用                                   ← 28px 高     │
└──────────────────────────────────────────────────────────────────┘
```
- 容器：`display:inline-flex; width:fit-content; align-self:flex-start; margin-bottom:6px`（**不占整行**，`data-auto-team-option` 落在 pill 本身）。
- 结构：`6×6` 圆点（enabled → business 实心；disabled → `border-l3` 空心描边）→ 8px → 文案。
- 文案单一来源：`viewmodel.capsuleOf(enabled, snapshot)`（沿用 r1 单向约定，组件不自己拼字）。
- 三态：
  - **未启用**：透明底、`border-l2` 描边、圆点空心、文案 `自动团队 · 未启用`。
  - **已启用**：business 12% 底、45% 描边、圆点实心、文案随计划状态变化（`计划就绪 · 3 任务` / `运行中 · 2 成员` / `已暂停` / `完成 3/3`）。
  - **busy**：文案不变、右侧 12×12 旋转环、`aria-busy`。
- 点击：只发 `act({type:'toggle', enabled:!enabled})`，**绝不隐式派发**（反目标 1）。
- 宽度 <360px：只留圆点 + `自动团队`（去掉 `· 状态` 段），`title` 与 `aria-label` 仍为完整状态。

### 2.2 E2 会话头按钮（`conversation.session.header.actions`，`order: 0`）

```
┌ 会话标题行右侧 ────────────────────────────────┐
│  [◧ 自动团队]         ← 24px 高，图标 14 + 文字 │
└───────────────────────────────────────────────┘
```
- 图标：`◧`（右栏面板的隐喻，纯字符，不引图标库）。
- 点击：`openTab('dsh-auto-team-panel')`；服务不可用 → 回退 `window.dispatchEvent(new CustomEvent('dsh-auto-team:open-panel'))`。
- 活跃态：面板已打开时 `aria-pressed="true"` + business 12% 底（**不改变尺寸**）。
- 窄视口：<480px 只留图标 + `aria-label="自动团队"`。

### 2.3 E3 面板页头 + 计划页任务行（本轮重点）

```
┌─ 自动团队 ─────────────────────────────────── × ┐ ← 宿主页签标题 chip（既有）
│ 完成 3/12   [计划就绪]              [暂停任务]  │ ← 页头控制条 40px，底边 1px
├────────────────────────────────────────────────┤
│ ⏸ 已暂停：派发与推进已停止，在跑成员不被打断    │ ← 暂停横幅 32px（仅 paused）
├────────────────────────────────────────────────┤
│ 计划 │ 成员 │ 记忆 │ 角色                        │ ← 页签条，选中底部 2px business
├────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────┐ │
│ │ 收集宿主事件目录            [✓ 已通过]      │ │ ← 标题 13/600 + badge 右对齐
│ │ 读 adapters.ts 与 HOST-EVENTS.md，产出事件…│ │ ← 内容 2 行 clamp，12/二级
│ │ [后端] [退出码 0] [尝试 1/3]                │ │ ← 元信息 11/三级，tabular
│ └────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────┐ │
│ │ 写面板暂停按钮              [⏸ 已暂停]      │ │ ← 琥珀描边 + 左 3px 竖条 + 无阴影
│ │ …                                          │ │
│ └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```
- 每行 `data-task-id` = `task.id`；内容段 = `title` + `acceptance`（**不新增字段**，`acceptance` 缺失时该行降为 1 行内容并把卡片高降到 82px，不做占位空行）。
- 状态：`progressOf(task)` 纯函数产出 `{ icon, text, tone, percent }`，**组件内不得再有第二份映射表**（AC-14）。10 态全覆盖，含 `paused`。
- 状态流转（progress）写法：badge 右侧 `尝试 n/N` 文本（tabular），不再画进度条——320px 宽下进度条与 badge 抢位置。
- 角色：`[data-tone="neutral"]` chip，取 `task.assignee` 的角色名（缺失显示 `未分配`）。
- 门禁证据：有则显示 `退出码 N`（`--ds-font-family-code`）；无则整个 chip 不渲染（不写 "—"，避免噪音行）。
- 空态：「尚未生成计划」+ 说明「点击输入框上方的『自动团队』启用后，队长会自动拆解」+ `[data-empty-next]`。
- 骨架：3 条 76px（见 §0.6）。

### 2.4 E4 设置页（`settings.section`，`id: dsh-auto-team`，`label: 自动团队`）

```
设置 › 自动团队                                       内容列 max-width 720
┌─ 执行参数 ───────────────────────────────────────────────┐
│ 并发上限        [ 3 ] 1–8        记忆注入预算  [ 4000 ]  │ ← 两列栅格，label 200px 列
│ 停滞阈值(ms)    [ 90000 ]        返工上限      [ 3 ]     │
│ 门禁超时(ms)    [ 300000 ]                              │
└──────────────────────────────────────────────────────────┘
┌─ 队长默认模型 ───────────────────────────────────────────┐
│ provider [ deepseek ]              model [ v4 ]          │
└──────────────────────────────────────────────────────────┘
┌─ 角色 ───────────────────────────────────────────────────┐
│ ┌ 产品经理  [内置]                                     ┐ │
│ │ 名称 [产品经理        ]                              │ │
│ │ 描述 [拆解需求、定义验收…                            ]│ │
│ │ 提示词 ┌───────────────────────────────────────────┐ │ │
│ │        │（固定 96px 内滚，不 auto-grow）           │ │ │
│ │        └───────────────────────────────────────────┘ │ │
│ │ 技能 [✓架构] [ 前端] [✓后端] [ 测试] [ 文档] [ 运维]  │ │
│ │ 默认模型 provider [—] model [—]                      │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌ 前端  [自建]                              [删除]     ┐ │
│ └──────────────────────────────────────────────────────┘ │
│ ……（6 内置 + N 自建）                                     │
└──────────────────────────────────────────────────────────┘
┌─ sticky 底部动作条 ──────────────────────────────────────┐
│ [+ 新增角色]              [一键恢复默认角色]  [保存]      │
└──────────────────────────────────────────────────────────┘
```
- 参数区：6 项 `data-setting-key`（`concurrencyLimit` / `memoryBudget` / `stallMs` / `maxAttempts` / `gateTimeoutMs` / `captainModel`）；范围提示写在控件右侧 8px 的 `label-tertiary` 小字（`1–8` / `200–4000`），并进 `aria-describedby`。
- 角色区：每张卡 `data-role-id`；内置角色**没有**删除按钮（§0.8-5）；自建角色删除 → 二次确认。
- 新增角色：`data-role-add` → 追加一张空卡，名称要求 `HOST_MEMBER_NAME` 规则，实时校验（失焦校验，不打断输入）。
- 一键恢复默认：`data-roles-restore` → 对话框：「只把 6 个内置角色恢复为出厂定义；你自建的 N 个角色不会被删除。」主按钮「恢复默认」（danger 描边），次按钮「取消」。
- 保存：整体保存（参数 + 角色一次提交）；失败 → 就地 `[data-error]` + 对应字段描边转 error，**磁盘不变**（AC-17）。
- 校验失败的表现（对齐 AC-17 的每一条）：并发 0/9、预算 199/4001、返工 0、门禁 <1000、角色名空、提示词 >8000、技能 id 非法、provider 空 → 全部"字段级错误文案 + 保存按钮回可点 + 磁盘逐字不变"。不弹全局 modal。

## 3. 交互与动效说明

### 3.1 关键流程（设计只描述"用户看到什么"，判定归宿主）

**A. 启用**：点 pill → busy（文案不变）→ 快照回来 → pill 变已启用态 + 300ms hit-flash → `完成 x/N` 与计划状态同步更新。失败 → 描边 error + 下方 `[data-error]` 一行，pill 保持未启用。
**B. 打开面板**：点头部按钮 → 右栏打开 → 页签出现 → 面板首屏骨架 3 条 → 数据到达替换。
**C. 浏览任务**：滚动页体（页头与页签固定，不随滚动消失——用户随时能看到 `完成 x/N` 与暂停按钮）。
**D. 暂停**：点「暂停任务」→ 按钮 busy（文案仍「暂停任务」）→ 快照 `planStatus='paused'` → 按钮变「继续任务」（琥珀态）+ 横幅淡入 + 在跑任务卡变琥珀 + 徽标变 `⏸ 已暂停`。**列表位置不变**。
**E. 继续**：点「继续任务」→ busy → 快照回 `dispatching` → 横幅淡出、任务卡恢复、`done` 任务逐字不变（用户可用行内证据 chip 自查）。
**F. 设置**：进设置 → 自动团队页 → 改参数 → 失焦不提交 → 点「保存」→ 成功 → 底部 1 行 `已保存`（300ms 淡出，用 `[data-hint]` 而非 toast）；失败 → 字段级错误。

### 3.2 交互清单

| 元素 | 事件 | 结果 | 失败表现 |
| --- | --- | --- | --- |
| pill | 点击 / Space / Enter | `act({type:'toggle'})` | 保持原态 + error 描边 |
| 头部按钮 | 点击 | `openTab('dsh-auto-team-panel')`；不可用 → 派发 `dsh-auto-team:open-panel` | 无（纯前端动作） |
| 页签 | 点击 / ←→ / Home/End | 切页（roving tabindex） | — |
| 暂停/继续 | 点击 | `act({type:'pause'})` / `act({type:'resumeTeam'})` | 文案**不变** + error |
| 新增角色 | 点击 | 本地追加空卡（不提交） | — |
| 删除角色 | 点击 → 确认 | `act({type:'deleteRole'})` | 卡片保留 + error |
| 恢复默认 | 点击 → 确认 | `act({type:'restoreDefaultRoles'})` | 角色区回滚 + error |
| 保存 | 点击 | `act({type:'saveSettings'})`（参数 + 角色一体） | 字段级错误 + 磁盘不变 |

### 3.3 单一数据源纪律（防"两条保存链"）

- 面板窄、设置页宽，但**角色编辑是同一个组件**：`RoleEditorList`（`density: 'panel' | 'settings'` 只控制字号/按钮形态，不改行为）。
- 保存调用**同一个** `act({type:'saveRole' | 'saveSettings'})` 与同一个前端校验函数 `validateSettings()`；校验文案在同一处产出。
- 面板角色页与设置页角色区共享 `usePanelState` 的同一份快照；任一处保存成功后，另一处下一次渲染即同步（不各自缓存 draft 超过一次渲染）。

### 3.4 焦点与键盘

- Tab 顺序：pill → 头部按钮 → 页签条 → 页头暂停按钮 → 页体内容。
- 页签 `role="tablist"`，`←/→` 循环、`Home/End` 首尾，`aria-selected`；页体 `role="tabpanel"` + `aria-labelledby`。
- 对话框：初始焦点在「取消」，Esc 关闭，Tab 循环限制在框内，关闭后焦点回到触发按钮。
- 恢复默认的确认按钮**不是**默认焦点（防误按回车把角色重置）。

## 4. 视觉规范（token 映射，禁止新造）

| 语义 | token | 备注 |
| --- | --- | --- |
| 面板底色 | `--dsw-alias-bg-base` | 页体透明，卡片用 layer-1 |
| 卡片 / 输入底 | `--dsw-alias-bg-layer-1` / `--dsw-alias-bg-base` | — |
| 分隔线 | `--dsw-alias-border-l2` | 页头条、页签条、卡片描边 |
| 弱分隔 | `--dsw-alias-border-l1` | 设置页栅格行间 |
| 强调描边 | `--dsw-alias-border-l3` | hover 态 |
| 主文字 | `--dsw-alias-label-primary` | 标题、数值 |
| 次文字 | `--dsw-alias-label-secondary` | 内容、label |
| 三文字 | `--dsw-alias-label-tertiary` | 元信息、范围提示、空态说明 |
| 主色（选中/焦点/运行中） | `--dsw-alias-state-business-primary` | 页签指示条、focus ring、running |
| 成功 | `--dsw-alias-state-success-primary` | done |
| 警示（暂停/停滞/门禁） | `--dsw-alias-state-warn-primary` | paused、rework、gate |
| 危险 | `--dsw-alias-state-error-primary` | failed、interrupted、表单错误 |
| hover / active 底 | `--dsw-alias-interactive-bg-hover` / `-active` | 所有可点元素 |
| 卡片阴影 | `--dsw-shadow-lv1` | 仅任务卡；暂停态去掉 |
| 对话框阴影 | `--dsw-shadow-lv3` | — |
| 圆角 | `radius-xs 4` / `-sm 8` / `-md 12` / `-lg 16` | 见 §0.2 |
| 字 | `--dsw-font-xxxs-11` / `-xxs-12` / `-xs-13` | `font:` 简写，**禁止 `font-size:`** |
| 等宽数字 | `--ds-font-family-code` | 退出码、provider/model 串 |
| 过渡 | `--ds-ease-in-out` + 字面时长 | 120/200/300ms |

## 5. 无障碍要点

1. **pill = 开关语义**：`role="switch"` + `aria-checked` + `aria-label` 含当前状态（「自动团队，已启用，计划就绪」）；Space/Enter 均可切换；命中区扩到 44px（§0.7-1）。
2. **状态不只靠颜色**：图标 + 文字 + 颜色三元组（沿用 r1 §0.4，AC-14 的 10 态同样适用）。`paused` 的琥珀不能是唯一线索（必须有 `⏸ 已暂停` 文字）。
3. **页头数字有可读名**：`完成 3/12` 加 `aria-label="已完成 3 个，共 12 个任务"`，屏幕阅读器不读「斜杠」。
4. **暂停按钮状态可播报**：切换后用 `aria-live="polite"` 的区域播报「已暂停，派发与推进已停止」；按钮本身 `aria-pressed`。
5. **表单**：每个 `data-setting-key` 控件有 `<label for>`；范围与错误用 `aria-describedby` 关联；错误容器 `role="alert"`；数字输入 `inputmode="numeric"`。
6. **技能多选**：`role="group"` + `aria-label="技能"`，每个 chip 是 `checkbox` 语义（`aria-checked`），不用纯 div。
7. **对话框**：`role="dialog"` + `aria-modal="true"` + `aria-labelledby`；焦点陷阱与 Esc（§3.4）。
8. **降低动效**：`prefers-reduced-motion` 下关闭呼吸、旋转、淡入。
9. **对比度**：状态文字用对应 tone 的 `-primary` 而非 30% 混色（混色只用于底色/描边）；`label-tertiary` 不承载唯一关键信息。

## 6. AC 覆盖对照（设计侧证据）

| AC | 设计承载点 |
| --- | --- |
| AC-12 输入框选项取代开关行 | §0.0 去双前缀、§0.2 pill 28px、§0.7-1 几何、§2.1 三态、§0.8-1 反模式 |
| AC-13 会话头按钮打开右栏 | §2.2（含 `aria-pressed` 与回退事件两分支的可见差异） |
| AC-14 任务行四要素 + 10 态 | §1.2 IA、§2.3 线框、§0.5 排版、§0.4 状态身份表、`progressOf` 唯一映射 |
| AC-15 暂停/继续按钮 | §0.3 busy 铁律（文案不动）、§0.2 两态同尺寸、§2.3 页头、§3.1-D/E |
| AC-16 设置页（6 参数 + 角色区 + 新增/删除/恢复） | §1.3 IA、§2.4 线框、§0.7-6 角色卡几何、§3.3 单一保存链 |
| AC-17 校验失败不落盘 | §2.4 校验表现段（字段级错误 + 磁盘不变）、§0.3 error 态 |
| AC-18 解构 `{data,error}` | §3.3（错误只在 `[data-error]` 一处落地，禁止整包赋值） |
| AC-19 真机四件套 | §1.1 四个根 hook 逐字列出（`data-auto-team-option` / `-header-button` / `-panel-tab` + `-panel` / `-settings`） |
| AC-20 暂停/继续往返 | §0.4（暂停不清证据、列表不重排）、§3.1-D/E |
| AC-21 设置落盘 + 恢复默认可分辨 | §2.4 对话框文案（明确"只重置内置"）、§2.4 保存成功提示 |

## 7. 给开发阶段的实现约束（照抄，不猜）

1. **组件落点**（与 §1.1 一一对应）：`src/client/InputOption.tsx`（新，取代 `Toggle.tsx` 的挂载角色；`Toggle.tsx` 若保留则只作为 pill 的实现体，`OPEN_PANEL_EVENT` 常量继续从它导出以免破坏引用）、`HeaderButton.tsx`（新）、`settings/SettingsSection.tsx`（新）、`Panel.tsx` 加页头控制条与暂停横幅、`tabs/PlanTab.tsx` 补四要素。
2. **hook 属性**：只用 `data-auto-team-*`；`data-dsh-auto-team-*` 全数改净（§0.0 判据）。
3. **CSS**：全部静态字符串挂在 `styles.ts` 的 `AUTO_TEAM_CSS`（沿用 `useAutoTeamStyle` 注入，`STYLE_ID` 单例）；删除旧 dock 行对应 CSS 段（`[data-dsh-auto-team-toggle]…` 约 60 行），不留死代码。
4. **字号**：`font: var(--dsw-font-*)`；**禁止** `font-size: var(...)`。
5. **颜色**：只用 §4 表里的 token；半透明一律 `color-mix`。
6. **文本溢出**：所有可变长文本容器 `min-width:0` + ellipsis 或 `-webkit-line-clamp:2`。
7. **不新增**：HTTP 路由（仍 3 条）、`ActivityEvent.kind`（仍 9）、`PlanTask` 字段；设置项严格 6 项（AC-11 形态冻结，`WATCHER_INTERVAL_MS` / `PANEL_ACTIVE_MS` 不可配）。
8. **请求纪律**：每个 `await` 解构 `{data, error}` 并判 `error`；错误文案只经 `viewmodel.feedbackOf` 解包（组件不得再解一次）。
9. **状态映射唯一**：任务 10 态 → `progressOf(task)`；成员 7 态 → `statusBadge()`。组件内不得出现第二份 `Record<string,string>`。
10. **面板最小宽度 320px** 是本设计的既定假设；若实测宿主右栏更窄，先按 §0.7-3 的降级规则走（省略「完成」二字、头部按钮只留图标），**不要**改几何数字。
