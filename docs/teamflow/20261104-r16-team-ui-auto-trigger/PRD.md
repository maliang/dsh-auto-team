<!-- meta: summary="开关打开后只有改代码任务自动走 status→plan→dispatch 且队长不改代码；左栏点击必有可见结果；进度环放大、流程图按角色分列+任务编号、角色卡任务编号染色点。" -->
基线依赖：20261104-r14-panel-canvas-redesign（r14 的 22 条 AC：派发不阻塞队长轮、无限画布拖动/重置、角色卡片、圆形进度环、项目库抽屉、形状普查与双产物门禁行为不得回归）
取代：20261104-r14-panel-canvas-redesign#AC-5：流程图节点主标签由「角色名」改为任务编号 `tN`；角色名改由左侧角色列头与卡内副信息承载（不再是节点主标签）。
取代：20261104-r14-panel-canvas-redesign#AC-10：进度环直径由 56–64px 改为 72–88px（默认 80），环内文字随 SVG 同比放大；圆心 done/total 语义、弧长比例与 0/0 不 NaN 的口径不变。
取代：20261104-r14-panel-canvas-redesign#AC-18：形状清单在 r14 的 5 类可选字段之外再增加 2 类 `RoleUsageView.taskRefs?` 与 `FlowNodeView.roleId?`；页签 3 / PanelAction 21 / 路由 4 / RejectionCode 13 / ActivityEvent.kind 9 / TaskStatus 13 / 工具 8 / setInterval 1 仍不变。

# 自动团队：改代码即自动组队、左栏可达与按角色分列的任务图

## 1. 背景与目标

### 1.1 基线

- 分支 `feat/auto-team-plugin`，基线为 r14（`f6223a1` / `fe4e807` 收口），`pnpm -s test` 706/706、typecheck 0。
- r14 已交付：派发受理制（`auto_team_dispatch` 立即返回）、可拖动无限画布（`src/client/views/FlowCanvas.tsx`）、角色卡片（`src/client/views/RoleCard.tsx`）、64px 进度环（`src/client/views/ProgressRing.tsx`）、项目库抽屉（`src/client/views/RunDrawer.tsx`）、共享角色状态（`src/shared/role-view.ts`）。
- 本轮用户反馈六件事：① 环太小；② 流程图要参考图 1 的泳道式**角色列**；③ 任务节点要恢复 `t1`、`t2` 编号；④ 角色卡片要列出该角色的任务编号且不同状态不同颜色；⑤ 左栏「自动团队」点击又没反应（P0）；⑥ 开关打开后，输入框里不需要特别提示词，队长对**需要改代码的任务**自动使用自动团队（P0）。
- r15（`docs/teamflow/20261104-r15-flow-stages-role-tasks/`）承接同一组 UI 反馈后被取消，只有 `meta.json`、没有 PRD/代码；本轮 r16 重新承接，基线仍指向 r14，r15 不构成基线。

### 1.2 问题一（P0）：开关打开后，改代码任务仍需用户说「用自动团队」

当前常驻提示词段落 `src/host/prompt.ts#captainSection` 无法拿到会话：宿主 `PromptSection.text` 只收 `AssembleContext{scope?, signal?}`，没有 session id。r11 的真机事故因此删掉了「本会话已开启/未开启」的断言，本轮不能写回。结果是：用户打开开关、输入一句需要改代码的普通任务，队长仍可能自己读/改代码，或反复询问「要不要用自动团队」。

范围由用户 2026-11-04 裁决：**只有需要修改代码的任务**才自动组队（命中 `src/**`、`test/**`、`package.json`、构建/CI 脚本等）；改文档（`*.md`/`docs/**`）、跑验证、单纯查证并产出报告都不组队，由队长自己完成。纯问答/闲聊/单轮解释仍不组队。

可行的会话级信号只有 `auto_team_status`：它按 `exec.agent.id` 正确认会话并返回 `enabled`（r11 已修复）。`installMemberRoute` 也证明 agent 作用域 `ctx` 可以挂 `system-prompt/assemble`，但那只对**成员**成立，宿主没有给队长/主 session 提供同等安装面，因此不能靠「按会话装 section」解决。

### 1.3 问题二（P0）：左栏「自动团队」点击又没反应

已知事实（主 agent 2026-11-04 实测）：

- 当前宿主 54058 的 `GET /api/auto-team/snapshot`、`/library` 均 200，插件进程与路由活着。
- 用**同一构建**克隆 profile 起第二宿主 + CDP 点 `[data-auto-team-panellist]` → `[data-auto-team-library]`=1、`[data-library-shell]`=1，点击有效。
- r14 的 `f6223a1` 没有改 `src/client/slots.ts` / `src/client/index.ts`；左栏注册面仍是 `sidebar.panellist`（glyph 由宿主渲染，点击由宿主调 `layout.selectPanel(id)`）+ `main`（keyed，整页项目库）。
- 当前 `PanellistEntry` 只画 SVG，没有自己的点击处理；`createOpenLibrary` 虽已通过 `sessionIdBag` 注入，但宿主行点击不会调用它。因此「宿主 selectPanel/main 槽位任一环失败」都会表现为静默无反应。

根因尚未确定，候选：侧栏窄模式（56px rail）、`main` keyed 注册失败、`layout.selectPanel` 抛错被吞、运行期插件文件被替换导致的旧 scope。**不得以「克隆宿主能点」结案**；必须在受影响宿主（54058）上复现并修复，或在无法复现时交付差异条件清单 + 面向真机的验证步骤并如实标注未验证。

### 1.4 问题三（P1）：进度环太小

现环 64×64（`ProgressRing.tsx` 的 `viewBox 64`、`size` 默认 64；`styles.ts:3513` 的 `[data-progress-ring]{width:64px;height:64px}`；`TaskOverview` 的网格列 64px），在 320px 面板里存在感弱。用户要求「可以大一些」。

### 1.5 问题四（P1）：流程图不像图 1 的泳道式角色列

现 `FlowCanvas` 是纯节点 + 连线：节点 180×76、按**依赖深度**列排布，没有列头、没有角色编号、没有每列任务数，节点首行是角色名。用户 2026-11-04 裁决改为**按角色分列**：每列代表一个参与角色，列头=角色名 + 该角色任务数 `×N`（含圆形编号徽标 01/02…按角色首次出现顺序），列内纵向排该角色的任务卡（主标签 `tN`，副信息任务标题/统计），列间用箭头过渡；同一任务只出现在其 `roleId` 列，零任务角色不出列；不新增 `PlanTask.stage` 字段。

### 1.6 问题五（P1）：角色卡片没有任务编号与状态色

现 `RoleCard` 只有角色名/角色状态/当前任务/token/用时。用户 2026-11-04 裁决：卡片内列出该角色的任务编号 chip，每个 chip 只写 `tN` + 一个按状态着色的圆点（5 个 tone），状态中文放 `title` 与 `aria-label` 兜底；不能只靠颜色。

### 1.7 本期目标

1. **改代码即自动组队**：开关打开时，只有需要修改代码的任务无需提示词，队长先 `auto_team_status` 确认，再 `auto_team_plan` → `auto_team_dispatch`，自己不亲自改代码；派发受理后立即结束本轮。改文档/跑验证/查证不组队。开关关闭时零影响。
2. **左栏点击必有可见结果**：在 54058 上复现并修复，或交付可执行的差异清单与真机验证步骤；无论如何不允许静默。
3. **进度环显著加大**：72–88px（默认 80），两种 surface 都不溢出、不截断。
4. **流程图按角色分列**：角色列头（角色名 + 01/02 徽标 + ×N）、列内 `tN` 任务卡、列间箭头；拖动/重置不得回退。
5. **角色卡列出任务编号**：`tN` + 彩色点，`title`/`aria-label` 写状态中文，右栏与抽屉逐字一致、深浅底可辨。

## 2. 方案选择：自动使用走「条件式提示词 + 工具描述」

三选一的结论：采用 ① 条件式提示词 + ② 强化工具描述，**不采用 ③ 按会话装 section**。

- ① `captainSection` 增加一条条件规则：**只有需要修改代码的任务**（源码 `src/**`、测试 `test/**`、配置 `package.json`/`tsconfig*.json`/`*.config.*`/`pnpm-lock.yaml`、构建/CI 脚本 `scripts/**`/`.github/workflows/**`、`cordis.patch.yml`）开工前先调 `auto_team_status`；`enabled=true` 时必须先 `auto_team_plan` 再 `auto_team_dispatch`，不得自己改代码；`enabled=false` 才按普通方式做。改文档（`*.md`/`docs/**`/`README*`）、跑验证、单纯查证并产出不在此列，队长自己做。段落继续明确「本段不替你断言当前会话是否已开」。
- ② `auto_team_status` / `auto_team_plan` / `auto_team_dispatch` 的 description 写明「这是开关打开时改代码任务的默认路径」「plan 保存后已自动派发，dispatch 是幂等确认」「受理后立即返回，不要等成员」。
- ③ 不采用：宿主没有给队长/主 session 提供可验证的按会话 section 安装面；`installMemberRoute` 只对成员成立。强行尝试的代价是又一次「装了但不确定生效」的静默风险，且省下的只是一次只读 `status` 调用。
- 代价：开关打开时每个**改代码**任务多一次只读 `auto_team_status` 调用（无写入、无 spawn）；可接受。
- 不新增工具：仍为 8 个，`auto_team_status` 只读，`auto_team_plan` / `auto_team_dispatch` 复用既有实现。
- 幂等：`auto_team_plan` 保存后已经自动派发；随后显式 `auto_team_dispatch` 在「已派发且没有新的未绑定 ready 任务」时必须返回**已受理确认**，而不是 `PLAN_ALREADY_DISPATCHED` 错误，否则自动路径会把成功当失败、触发重试或让队长卡住。

## 3. 用户故事与验收标准

编号只属于本任务夹，从 AC-1 起。

### 3.1 US-1 开关打开即对改代码自动组队（P0）

作为用户，我在输入框工具条打开「自动团队」后，只要提出一个**需要修改代码**的任务，队长就自动组队，不需要我在提示里写「用自动团队/派发/组队」；改文档、跑验证、查证不组队。

**AC-1（条件式规则，不判定会话）**：`captainSection()` 同时包含 `auto_team_status`、`auto_team_plan`、`auto_team_dispatch` 与 `enabled` 条件，并写明**只有需要修改代码的任务**才进入自动组队；给出可判定清单：算改代码 = 命中 `src/**`、`test/**`、`lib/**`、`package.json`、`tsconfig*.json`、`*.config.*`、`pnpm-lock.yaml`、`scripts/**`、`.github/workflows/**`、`cordis.patch.yml`（或等价的源码/测试/配置/构建脚本）；不算 = `*.md`、`docs/**`、`README*`、`logs/**`、纯 `pnpm test`/`pnpm typecheck` 验证、单纯查证并产出报告。段落必须有「开关打开时不得自己改代码」「派发受理后立即结束本轮」「纯问答/明确叫停不组队」「改文档/跑验证/查证不组队」；不得出现「本会话已开启/已启用」无条件断言；总长 ≤2600 字符。`auto_team_plan` / `auto_team_dispatch` / `auto_team_status` 的 description 分别写明「改代码默认路径」「幂等确认/立即返回」「只读，先查 enabled」。
- 验证：`test/captain.test.ts` 对 `captainSection()` 做子串与长度断言；工具描述从注册 spec 读取。把条件句删掉、把文档任务也算作组队、或改回无条件断言必须红。

**AC-2（ON 真机 3/3）**：全新会话、开关打开，输入一句**完全不含**「自动团队/派发/组队」字样的**改代码**任务（例：把 `test/r16-probe.ts` 里的 `r16Probe = 0` 改成 `r16Probe = true`；该文件由夹具预创建、测试后删除），断言：
1. 会话日志出现 1 次 `auto_team_plan` 和 1 次 `auto_team_dispatch`；
2. 队长没有对 `test/r16-probe.ts` 发起任何变更型调用（`write`/`edit`/带重定向或 `tee`/`sed -i` 的 bash）；
3. `auto_team_dispatch` 受理后 5 秒内本轮结束、会话可再次接收输入，且同轮对 `auto_team_status` 的调用 ≤1 次。
- 3 次连续全新会话 3/3 通过；证据为每轮的 session id、zstd 日志路径、解压后的 tool call 名与时间戳。
- 验证脚本与证据路径写进 QA-REPORT；不许只写「已实现」。

**AC-3（OFF 对照 3/3）**：全新会话、开关关闭，同一句**改代码**任务（`test/r16-probe.ts`），会话日志中不得出现 `auto_team_plan` / `auto_team_dispatch` / `auto_team_add_tasks` / `auto_team_receipt` / `auto_team_message` / `auto_team_memory` / `auto_team_role`；`auto_team_status` 若出现只读允许。3 次连续全新会话 3/3。
- 验证：同一套日志解析；OFF 与 ON 的 session id、时间窗成对记录。

**AC-4（纯问答不组队）**：开关打开，问「`src/client/views/ProgressRing.tsx` 里 `r` 与 `stroke` 是什么关系？」这类纯解释问题；不产生 `auto_team_plan`/`auto_team_dispatch`，队长直接回答（可 read 文件）。
- 验证：真机会话日志断言 + 面板无新 run。

**AC-5（用户明确叫停不组队）**：开关打开，用户说「别组队，直接改 `test/r16-probe.ts`，把 `r16Probe` 改成 `true`」；不产生 `auto_team_plan`/`auto_team_dispatch`，队长直接完成或明确说明改法。
- 验证：真机会话日志断言。

**AC-6（已自动派发时 dispatch 幂等）**：当计划已经由 `auto_team_plan` 自动派发、且没有新的未绑定 ready 任务时，显式 `auto_team_dispatch(runId)` 返回 `ok:true` 且标记「已受理/此前已自动派发」，**不返回** `PLAN_ALREADY_DISPATCHED` 错误；连续调用两次，成员数、binding 数、任务状态均不增加。缺少 `runId` 仍按 r14 AC-30 拒绝。
- 验证：`test/auto-dispatch.test.ts` 的 fake spawn 计数 + 工具返回断言；真机 ON 路径不出现该错误码。

**AC-7（不阻塞回归）**：`auto_team_dispatch` 在 60 秒 spawn 桩下 ≤1 秒返回；自动路径不得新增 `await spawn`；r14 的 `dispatch-nonblocking.test.ts` 全部保留；派发后 5 秒内宿主的工具调用结束、会话可继续。
- 验证：既有非阻塞测试 + 新增自动路径用例；源码 `grep` 不得在 dispatch 受理分支出现 `await ...spawn`。

### 3.2 US-2 左栏点击必有可见结果（P0）

作为用户，我点左栏的「自动团队」，必须看到项目库，不能点了没反应。

**AC-8（可见性）**：在受影响宿主 54058、当前构建、硬刷新后的会话里，点击 `[data-auto-team-panellist]` glyph，1 秒内出现且仅出现一个可见的项目库 surface：`[data-library-surface="main"]` 或 `[data-library-surface="panel"]`；glyph 上 `data-last-open-result` ∈ `main|event|error`，不得为 `none` 或缺失。宽态（约 280px）与收起态（56px rail）各点 3 次（每次关闭后再点）均满足。
- 验证：CDP 脚本在 54058 上执行；截图/DOM 快照与 `data-last-open-result` 一起记录。

**AC-9（主区不可用降级）**：当 `main` 槽位未注册或 `mainArea.open` 不可用（用 fake ctx 模拟，并在真机 54058 上验证一次实际路径），点击 glyph 必须：
1. 在右栏内联打开项目库（`[data-library-surface="panel"]`=1）；
2. 顶部显示一行可见说明「主区不可用，已在右栏打开」；
3. 不向控制台抛未捕获错误；
4. 若主区实际可用，不得同时开出两个 library surface（从干净状态点一次，`main` + `panel` 的 library 节点总数 = 1）。
- 验证：客户端组件测试 + CDP；`data-last-open-result` 分别断言 `main` / `event`。

**AC-10（根因或差异清单）**：QA 必须给出「复现条件 → 修复 → 该条件下验证」的证据链，至少包含侧栏宽度、`main` 注册结果、`mainArea` 可用性、构建/旧 scope 四项探针的值；若在 54058 上确实无法复现，则交付 ≥4 项差异条件清单 + 面向真机的逐步验证步骤，并明确标注「未验证」。**不得**仅以克隆宿主可点结案。
- 验证：QA-REPORT 的「侧栏」小节；证据路径可复跑。

### 3.3 US-3 进度环加大（P1）

作为用户，我要一眼看到整体进度，环要明显更大。

**AC-11（尺寸与几何）**：`[data-progress-ring]` 在右栏（320px 面板）与抽屉两种 surface 的 `getBoundingClientRect().width` 均在 **72–88px**（默认 80）；`[data-task-overview]` 的 `scrollWidth ≤ clientWidth`（无横向溢出）；圆心文字仍严格 `done/total`，`999/999` 不截断、不溢出内圆；弧长 = `2πr × done/total`，`0/0` 不出现 `NaN`。把 CSS 改回 64px 或把文字写死不随环缩放必须红。
- 验证：客户端 DOM 测试 + 320px/抽屉截图；数值从 `getBoundingClientRect` 与 `strokeDashoffset` 读取。

### 3.4 US-4 流程图改为角色列 + 任务编号（P1）

作为用户，我要看到类似图 1 的团队工作台：每个参与角色一列、列头角色名 + ×N + 01/02 徽标、列内 `t1`/`t2` 任务卡、列间箭头，并且画布仍可拖动、可重置。

**AC-12（角色列）**：流程图的列数 = **有任务的唯一 `roleId` 数**（零任务角色不出列）；每列顶部有列头，含两位零填充编号徽标（`01`、`02`…，按该角色在计划中首次出现的顺序）、角色名 `[data-flow-stage-name]`、该角色任务数 `×N`；所有 `×N` 之和 = 任务总数；每个节点只出现在其 `roleId` 对应的列（节点 `data-flow-column` = 该角色列索引），跨列错放必须红。把列改为按依赖深度分列、或漏掉零任务角色过滤必须红。
- 验证：`flowLayoutOf` / `FlowCanvas` 的 DOM 测试，2 角色 5 任务夹具（如 dev t1/t2、qa t3/t5、t4 归 dev）；列头与节点归属逐项比对。

**AC-13（节点主标签 tN）**：节点信息结构为：
1. 第一行主标签 `[data-flow-node-id]` 文本匹配 `/^t\d+$/` 且等于 task id，紧随其后的任务标题 `[data-flow-node-title]` 可读（ellipsis + `title` 兜底）；
2. 角色名在左侧角色列头 `[data-flow-stage-name]` 可见且等于 `Role.name`；节点内若保留 `[data-flow-node-role]`，只能作副信息且必须等于 `Role.name`，不得占据第一行主标签；
3. 右上角状态胶囊（文字来自 `statusBadge`）；
4. token/用时仍在卡内可读。
把主标签改回纯角色名、或删掉列头角色名必须红。
- 验证：DOM 测试逐项断言；变异探针 1 条。

**AC-14（列间连接与边）**：相邻角色列头之间有带箭头（`marker-end` 指向真实 `<marker>`）的连接线；左侧角色列全部任务 `done` 时为实线，否则虚线；任务节点之间仍保留带箭头连线与 `data-upstream-done`；图例仍区分实线/虚线（文案改为「左侧列已完成 / 左侧列未完成」或等价中文）。删掉列间箭头或只保留任务箭头必须红。
- 验证：SVG DOM 测试；夹具切换左侧列一个任务状态，连接线的 `data-upstream-done` 从 `false` 变 `true`。

**AC-15（拖动/重置/性能不回退）**：r14 AC-4 全部保留：100px 拖动位移 ≥90px；累计 4px 阈值内不误选节点；重置回 `translate(0,0)`；不触发页面滚动/文本选中；50 节点拖动 60 帧平均 ≤20ms；在角色列头上拖动也能平移、不选中任务。
- 验证：既有 `FlowCanvas` 测试 + 50 节点性能探针；角色列头加入后重跑。

### 3.5 US-5 角色卡列出任务编号与状态（P1）

作为用户，我要在角色卡上看到「这个角色要做哪些任务」，并且不同状态一眼可分。

**AC-16（编号集合）**：每张 `[data-role-card]` 内 `[data-role-task-ref]` 的数量 = 该角色任务数（`role.tasks`），`data-task-id` 集合 = 计划中 `roleId` 等于该卡的所有任务，顺序 = 计划顺序；每个 chip 的文本 == `tN`（与 task id 一致），并带 `data-status` 与 `data-tone`。qa 卡出现 `t3`，不出现别的角色的任务；把 refs 删掉或只显示当前任务必须红。
- 验证：2 角色 3 任务夹具，`data-role-id` 与 refs 集合逐项比对。

**AC-17（彩色点 + 可访问性兜底）**：每个 chip 内有一个按任务状态着色的圆点（`[data-task-ref-dot]`，复用 `statusBadge` 的 5 个 tone；同一 tone 可同色）；chip 文本只写 `tN`，**状态中文不得只靠颜色**：每个 chip 必须有 `title` 与 `aria-label`，内容含 `t3 · 已完成` 形态的状态中文；done 与 running 两个 chip 的圆点 computed `color` 不相等；圆点只用宿主 `--dsw-*` token（不得硬编码色值），在浅色/深色两种主题下截图可辨。只给颜色、无 `title`/`aria-label` 的版本必须红。
- 验证：`getComputedStyle(dot).color` 取两个不同 tone；断言 `textContent === 't3'`、`title`/`aria-label` 含状态文案；13 种 TaskStatus 表驱动覆盖 tone/文案；浅色/深色截图各一张。

**AC-18（右栏与抽屉一致）**：右栏与项目库抽屉的角色卡使用同一个 `RoleCard` 与同一个 `buildRunDetail`；同一 run 的 `[data-role-card]` 的 chip 文本、`data-task-id` 集合、`data-status`、`data-tone`、`title`/`aria-label` 在 320px 面板与抽屉中逐字相等；卡片数 = 参与角色数；新增 refs 后两种 surface 都不横向溢出。
- 验证：既有 parity 测试扩展；`outerHTML` 或 text+attrs 的深比较。

### 3.6 不变量、门禁与证据（P0/P1 共通）

**AC-19（形状与计数）**：形状只增加 2 类可选字段：`RoleUsageView.taskRefs?: RoleTaskRef[]`（`RoleTaskRef = { id: string; status: TaskStatus }`）与 `FlowNodeView.roleId?: string`（按角色分列所需；旧快照缺省时回退到 `roleName`/单列，不崩）。不新增 `PlanTask.stage`，不新增顶层快照字段。以下计数不变：页签 3、PanelAction 21、HTTP 路由 4、RejectionCode 13、ActivityEvent.kind 9、TaskStatus 13、工具 8、`setInterval(` 1。旧 v3 夹具（无 taskRefs/roleId）仍可读，缺字段时卡片/画布不崩、不空白。
- 验证：`test/client-contract.test.ts` 的计数断言 + 旧夹具渲染测试。

**AC-20（回归门禁）**：`pnpm typecheck` 0；`pnpm -s test` ≥706（只增不减，实际新数写进报告）；`pnpm build` 双产物且 `find src -name '*.ts' -newer lib/index.js` = 0（client 同理）；两条 `node --input-type=module -e "await import('./lib/…')"` exit 0；`npm pack --dry-run` 仍 3 条目（`lib/index.js`、`lib/client.js`、`cordis.patch.yml`）；`package.json` 无新增 `dependencies`、无 `workspace:`；`.gitignore` 审计结论写入报告。
- 验证：逐条命令 + 退出码；产物 mtime。

**AC-21（变异探针）**：7 个探针原样绿、变异红：
1. 删掉提示词里的 `auto_team_status` 门槛 / 把文档任务也算组队 / 改回无条件断言 → AC-1 红；
2. dispatch 受理分支改回 `await spawn` → AC-7 红；
3. 角色列改回按依赖深度分列 → AC-12 红；
4. 节点主标签改回纯角色名 → AC-13 红；
5. 环 CSS 改回 64px → AC-11 红；
6. 删掉 `taskRefs` 填充 → AC-16 红；
7. 删掉左栏 glyph 的点击兜底 → AC-8/AC-9 红。
- 验证：探针脚本逐条跑，记录原样/变异两次结果。

**AC-22（真机证据，不许 mock）**：AC-2/3/4/5 与 AC-8 必须在真机跑：优先 54058（用户当前宿主，安装新构建后）；侧栏 AC-8 必须在 54058 上验证。若第二宿主 51890 用于自动使用对照，须记录 profile 克隆与构建一致性。每条证据给 session id、日志路径、解压命令、时间戳；起不来或不可控时如实写「未验证 + 阻塞原因」，不得用 mock 代替。
- 验证：QA-REPORT 的「真机证据」小节；日志可复跑。

**AC-23（性能不回退）**：100 run library 冷 ≤1s、热 ≤100ms；snapshot 不重算全量；50 节点拖动 60 帧平均 ≤20ms；角色列头与角色 refs 不引入新的全量 layout 抖动。
- 验证：既有性能探针 + 本轮 fixture。

**AC-24（文档、记忆与提交）**：PRD/TECHNICAL/QA-REPORT/ACCEPTANCE 全在 `docs/teamflow/20261104-r16-team-ui-auto-trigger/`；`docs/teamflow/memory.md` 同主题替换「开关即对改代码自动组队」与「左栏 glyph 点击兜底」两条约定；`AGENTS.md` 只允许托管区变化；不写宿主 `docs/<role>/`；收口单笔提交（含 `lib/` 双产物、`src/`、`test/`、本任务夹、r15 的 `meta.json` 以保持工作树 clean），提交后 `git status --porcelain` 为空，报告记录 commit hash 与门禁数。
- 验证：`git status`、`git show --stat`、文档路径清单。

## 4. 范围与非目标

**范围内**：

- `src/host/prompt.ts` 条件式规则（仅改代码；可判定路径清单）；`src/host/tools.ts` 三个工具描述；`auto_team_dispatch` 幂等确认；相关单测。
- 左栏 `PanellistEntry` 的点击兜底、`data-last-open-result`、`data-library-surface`、右栏内联说明；相关组件/真机验证。
- `ProgressRing`/`TaskOverview`/`styles.ts` 的 80px 环与布局。
- `FlowCanvas`/`viewmodel.ts`/宿主 `flowOf` 的角色列头、列间连接、两行节点卡、`tN` 主标签、`FlowNodeView.roleId?`；保留拖动/重置/性能。
- `RoleCard` 的 `taskRefs` 渲染（`tN` + 彩色点 + title/aria-label）；`src/shared/role-view.ts` 的共享聚合；宿主 `library.ts` 与客户端 `viewmodel.ts` 双端填充。
- 单测、变异探针、真机证据、文档、memory、提交。

**非目标**：

- 不改变计划图语义（依赖深度算法、并发/写域/门禁）、不改 `dispatchReady` 的四道闸。
- 不新增 `PlanTask.stage` 字段/业务阶段名；角色列由 `roleId` 派生，零任务角色不出列。
- 不新增缓存命中率指标（宿主 `UsageCell` 无该字段，不估算、不编造）。
- 不新增工具/路由/页签/PanelAction/TaskStatus/ActivityEvent.kind；不新增依赖。
- 不重做抽屉/项目页的信息架构，不改项目分桶与 run 标题规则。
- 不做移动端/窄屏专门布局，不改宿主左栏外框宽度（宿主未暴露）。
- 不改 `~/.dsh/profiles/desktop`；安装/回滚由主 agent 执行。

## anti-goals / 反面目标

1. **开关开着，用户只是问「这个函数做什么」，队长却拉起成员、落计划、烧 token。** 验收时在 AC-4 的问答轮里出现任何 `auto_team_plan`/`auto_team_dispatch` 即视为失败——功能「能自动组队」但产品变成乱组队。
2. **开关开着，队长自己把目标代码改了，或没有落计划就动手。** 用户看到「自动团队」却没有 t1/t2 计划、没有成员、没有门禁证据，改动无法追溯；AC-2 的「队长零变更型调用 + 必有 plan/dispatch」就是为此。
3. **自动组队后队长卡在 running / 反复轮询，5 秒内不能继续输入。** 这是 r14 已修的 P0 回归；测试全绿但人感觉「又卡住了」，比不自动组队更糟。
4. **环放大到 80px 后，320px 面板出现横向滚动、文字被切，或角色列头把画布撑出可视区、拖动/重置手感变差。** 用户要的是「更大更清楚」，不是「更大更挤」；AC-11/AC-15 的 320px 与拖动断言就是为此。
5. **左栏点击只在克隆宿主或刷新后有效，用户那台 54058 仍然点了没反应；或打开右栏却没有任何说明。** AC-8/AC-9/AC-10 要求同条件验证或如实标未验证，不接受「我这边能点」。
6. **角色卡片的任务编号只靠彩色点、没有 title/aria-label 兜底，色弱用户/灰度截图看不出状态；或右栏与抽屉的编号集合不一致。** 颜色必须伴随可访问名称与 title，且两处逐字相等（AC-17/AC-18）。

## 5. 交互流程摘要

**自动使用（开关打开）**：

1. 用户在输入框工具条打开「自动团队」；输入一句**需要改代码**的任务（无需提示词）。改文档/跑验证/查证不进入本流程。
2. 队长调 `auto_team_status`（只读）→ `enabled=true`。
3. 队长调 `auto_team_plan`（任务带 roleId + 可执行 acceptance）→ 计划落盘，既有自动派发 kick。
4. 队长调 `auto_team_dispatch(runId)` → 幂等返回「已受理/此前已自动派发」，不重复 spawn。
5. 队长立即结束本轮；成员在后台跑，面板/左栏照常更新。用户 5 秒内可继续输入。
6. `enabled=false`、改文档/跑验证/查证、纯问答、用户明确说「别组队/直接改」时，不进入上述路径。

**左栏点击**：

1. 用户点 glyph。
2. 插件点击路径调用既有 `createOpenLibrary`；若主区在 500ms 内出现 `[data-library-surface="main"]`，结束。
3. 否则派发 `auto-team:open-library` → 右栏内联 library + 一行说明；glyph 的 `data-last-open-result` 记录 `main|event|error`。
4. 任何分支都不静默、不同时开两个 surface。

**视觉**：环在任务总览左侧 sticky，80px；流程图角色列头在画布顶部，节点两行卡；角色卡 refs 行在 meta 之后、可换行；320px 无横向溢出。

## 6. 优先级

| 优先级 | 内容 | 理由 |
|---|---|---|
| P0 | 改代码自动使用（AC-1~AC-7）、左栏点击（AC-8~AC-10） | 前者是产品承诺，后者是入口不可用 |
| P1 | 环（AC-11）、角色列流程图（AC-12~AC-15）、角色卡编号（AC-16~AC-18） | 体验与信息可读性 |
| P1 | 不变量/门禁/真机/性能/文档（AC-19~AC-24） | 交付底线，不可裁剪 |

## 7. 依赖与风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `PromptSection` 无 session，模型可能跳过 `auto_team_status` | 开关打开仍不组队 | 提示词 + 三个工具描述 + AC-2 真机 3/3；status 只读、成本低 |
| 自动组队边界（只改代码）被模型误判 | 文档任务被组队或代码任务漏组队 | AC-1 的可判定路径清单 + AC-2/3/4 真机对照；工具描述同步 |
| `auto_team_plan` 已自动派发，显式 dispatch 返回旧错误码 | 自动路径把成功当失败、重试/卡住 | AC-6 幂等确认；复用 `dispatchReady`，不新开派发路径 |
| 左栏 `main` 槽位对第三方插件未验证 | 点击仍无反应 | 插件自有点击兜底 + 右栏内联；AC-8/9/10 真机同条件验证 |
| 角色列按 `roleId` 分组，旧快照缺 `roleId` | 旧 run 画布空白/错列 | `FlowNodeView.roleId?` 可选 + `roleName` 回退；AC-19 旧夹具 |
| 320px 面板 + 80px 环 + 角色列头 | 横向溢出/文字截断 | `minmax(0,1fr)`、`overflow:hidden`、AC-11/15 断言 |
| 角色聚合在 host/client 两份 | refs 漂移 | 聚合收进 `shared/role-view.ts` 单源，双端只调用；AC-18 深比较 |
| 54058 不可控/无法复现侧栏 | 无法给根因 | AC-10 允许差异清单 + 真机步骤 + 未验证；不以克隆宿主结案 |
| 真机安装需主 agent | QA 子代理无法装 profile | 主 agent 安装/回滚；QA 只跑证据；AC-22 写清边界 |

## 8. 里程碑建议

- **M1（P0）**：提示词条件规则（仅改代码）+ 工具描述 + dispatch 幂等 + 非阻塞回归单测。
- **M2（P0）**：左栏点击兜底 + `data-last-open-result` + 右栏内联说明 + 54058 复现/差异清单。
- **M3（P1）**：80px 环 + 角色列/列间箭头 + 两行节点 `tN` + 角色卡 `tN`+彩色点 + 共享聚合。
- **M4**：全量门禁 + 7 变异探针 + 真机 3/3 + 性能 + 文档/memory + 单笔提交。

## 假设与待澄清

本轮 7 项待定已由用户 2026-11-04 逐条裁决，**没有待澄清项**：

1. 角色列（否决依赖深度）：列头角色名 + `×N` + 按角色首次出现顺序的 01/02 徽标；同一任务只在其 `roleId` 列；零任务角色不出列；不新增 `PlanTask.stage`。
2. 自动组队只对改代码：`src/**`、`test/**`、`package.json`、构建/CI 脚本等；`*.md`/`docs/**`、跑验证、单纯查证并产出不组队。
3. 主区不可用 → 右栏内联项目库 + 顶部一行「主区不可用，已在右栏打开」；不弹错误对话框。
4. 自动组队不弹确认、不加额外一轮；`auto_team_plan` 返回与面板「计划」页即告知。
5. 角色卡 chip = `tN` + 彩色点；`title`/`aria-label` 写状态中文；dot 用宿主 token，深浅底可辨。
6. 54058 先复现；不能复现则 ≥4 项差异清单 + 真机步骤 + 未验证，不以克隆宿主结案。
7. 不显示缓存命中率、不估算；token 取不到显示「不可得」。

54058 能否复现是待实测事实，不是待用户裁决项；两条交付路径已在 AC-10 定死。

## 工程约束

> 硬约束（原文保留）：只改本仓库、不动 `~/.dsh/profiles/desktop`；回归线 `pnpm -s test` 只增不减（706）；typecheck 0；双产物新鲜；双 import OK；`npm pack --dry-run` 3 条目；不新增 dependencies；槽位只用 `replaceRisk=none` 且**禁止再调 `cordis_inspect_query` 查槽位**（读 `docs/teamflow/architecture/UI-SLOTS.md`）；形状扩张逐条列理由。

- **分支与时点**：留在 `feat/auto-team-plugin`，从当前 HEAD `fe4e807` 继续；不新建分支、不切 `main`、不合并、不 push、不打 tag。中间阶段不单独提交；收口由主 agent 单笔提交。
- **未提交改动**：开工前工作树只应有 `?? docs/teamflow/20261104-r15-flow-stages-role-tasks/`（cancelled，仅 meta）与 `?? docs/teamflow/20261104-r16-team-ui-auto-trigger/`（本需求）。不得 `git stash`/`checkout`/删除它们；收口时把 r15 的 `meta.json` 与本轮全部产物一并提交，保证 `git status --porcelain` 为空。`test/r16-probe.ts` 是 AC-2/3/5 的临时夹具，测试后删除，不入库。
- **`.gitignore` 审计（dev 阶段动作）**：本仓为 TS/pnpm 单包，现有 `.gitignore` 已覆盖 `logs/teamflow/`、`node_modules/`、`.pnpm-store/`、`*.tsbuildinfo`、`coverage/`、`dist/`、`.DS_Store`、`.auto-team/`、`*.tgz`、`*.log`、`.vscode/`、`.idea/`、`.env*`、`.dsh-code-index/`；`lib/` 必须入库、不得加入忽略。dev 阶段逐项 `git check-ignore` 验证，若本轮新增截图/临时产物目录（如 `logs/teamflow/…` 之外的 `artifacts/`）按实际栈补规则；不得把命令输出 dump 落进仓库。
- **文档边界**：只写 `docs/teamflow/20261104-r16-team-ui-auto-trigger/` 与 `docs/teamflow/memory.md`；不写宿主 `docs/<role>/`，不在项目根散落日志；`logs/teamflow/tf-mw1q6b6x-9nyzj4/` 只放需留存的检查脚本/捕获/笔记，run 结束由 host 归档。
- **profile 与安装**：不改 `~/.dsh/profiles/desktop`；真机验证需要的 `pnpm add file:<repo>` / `dsh.profile.bundles` 同步 / 重启 / 回滚由主 agent 执行；QA 子代理只读证据，不装 profile。
- **槽位**：只用 `replaceRisk=none`；`sidebar.panellist` / `main` 各 1 处注册不变；不新增槽位；不调 `cordis_inspect_query` 查槽位（读 UI-SLOTS.md）。
- **形状**：只加 2 类可选字段 `RoleUsageView.taskRefs?`、`FlowNodeView.roleId?`；不新增 `PlanTask.stage` 与顶层快照字段；7 项计数不变；旧 v3 夹具可读；扩张理由写在 TECHNICAL。
- **自动使用**：只对改代码任务；不新增工具；不改 `dispatchReady` 四道闸；不在 dispatch 受理分支 `await spawn`；`auto_team_status` 保持只读。
- **验证命令**：`pnpm typecheck && pnpm -s test && pnpm build`，两条 `node --input-type=module -e "await import('./lib/…')"`，`npm pack --dry-run`；真机证据按 AC-22；报告记录每条退出码与 test 数。
