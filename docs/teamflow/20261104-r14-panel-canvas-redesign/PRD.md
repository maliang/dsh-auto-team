<!-- meta: summary="让派发不再阻塞队长对话，把任务页改成可拖动无限画布 + 角色卡片 + 进度环任务列表，把项目库改成 run 级大任务名 + 抽屉详情，并修掉未知项目与列表宽度。" -->
基线依赖：20261103-r13-panel-tabs-sidebar（三页签、自动派发、共享视图、门禁与形状普查行为不得回归）
取代：20261103-r13-panel-tabs-sidebar#AC-2：任务页的「角色条 + 任务表」改为「角色卡片 + 圆形进度环任务列表」。
取代：20261103-r13-panel-tabs-sidebar#AC-4：流转图由静态自绘改为可拖动的无限画布，节点主标签改为角色名。
取代：20261103-r13-panel-tabs-sidebar#AC-15：项目页任务行改为 run 级大任务名，并在计划落盘时记录 project 以消除未知项目。
取代：20261103-r13-panel-tabs-sidebar#AC-17：项目页 run 详情由内联展开改为抽屉，关闭后回到列表原位。

# 自动团队：派发可用性、无限画布、角色卡片与项目库抽屉

## 1. 背景与目标

r13 已把面板收敛为「任务 / 历史 / 记忆」三页，并实现计划落盘后的自动派发、右栏与左栏共用视图、真实 token 与用时。真机使用暴露出四组问题，其中第一组是可用性 P0。

### 1.1 问题一（P0）：派发后主对话停在运行状态，用户不能继续对话

已核实的候选阻断链（两条都要在技术方案里用对照实验确认主因，不许只改文案）：

- **插件内等待**：`auto_team_dispatch` 工具 handler 执行 `await deps.bridge.act(sessionId, {type:'dispatch', runId})`；`bridge.act` 的 dispatch 分支 `await deps.dispatch(state)`（即 `dispatchReady`）；`dispatchReady` 对每个就绪任务 `await deps.spawn(...)`；`src/host/adapters.ts` 的 spawn 端口最终 `await teams.spawnTeammate(...)`。只要这条链上任何一段要等成员开始整轮，队长这一轮就一直 running。
- **宿主团队策略**：桌面 profile（`~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles`）启用了 `@deepseek-ai/dsh-experimental-agent-team-profile`；该组合包插入 `tool-agent-team`，其模型策略原文包含 **“The Lead must wait for required teammates before giving the final answer.”**。本插件的成员经同一个 `agentTeams.spawnTeammate` 创建，队长会被宿主视为 Team Lead，模型可能因此主动进入等待/轮询而不结束本轮。

目标不是「把界面状态强行改成 idle」，而是：**派发动作立即返回，队长这一轮能结束并继续对话；成员在后台照常启动、失败可见、面板照常更新。**

### 1.2 问题二：任务页的图与角色状态不可读

- `src/client/views/FlowGraph.tsx` 是 300px 高的静态自绘 SVG，注释明确「不做缩放/拖拽平移（面板里手势会和页面滚动打架）」。用户要的是可拖动的无限画布，且要有「重置视图」。
- 节点第一行显示 `node.id`（`t1`、`t2`），不是角色名；下面没有任务简述。
- `src/client/views/RoleStrip.tsx` 只是角色 chip：`角色名 ×任务数 token`，没有状态、当前任务、用时。用户要的是角色卡片。

### 1.3 问题三：缺少整体进度与「已完成/未完成」分区

任务表只有逐行任务，没有「已完成 N / 总数 M」的总体进度。用户要求：左侧圆形进度条（中心是已完成/总数），右侧任务列表，且已完成与未完成在视觉上分开。

### 1.4 问题四：左侧项目库的宽度、未知项目与大任务粒度

- **宽度**：已核实宿主左侧栏固定区间 264–420px、默认 280px、收起 56px rail；`ctx.layout` 只暴露 `selectPanel / toggleSidebar / openRightbar / closeRightbar`，**没有任何设置左栏宽度的接口**。结论：宿主未暴露，外框宽度本期不可行；替代方案是项目库页内「项目列表 / 项目详情」分栏可拖拽。
- **未知项目**：`RunState.project` 字段早已存在（r13），但 `auto_team_plan` 构造 `RunState` 时从不写它，于是所有新 run 都落进 `__unknown__`「未知项目」。`groupProjects` 把 `summary.project` 当路径分桶，当前工作区桶又用 workspace 原串，二者还会产生同工作区重复项目。
- **粒度与命名**：项目页的「最近运行」其实已经是 run 级行，但标题取 `run.runId`（如 `20261103-r13-…`），`ProjectRunSummaryView` 也没有 `goal/title` 字段；点开后又内联展开该 run 的小任务表，用户读到的自然是 `t1/t2` 小任务，而不是「大任务」。
- **详情层级**：项目页点 run 后是整页内联替换（`LibraryPage` 的 `DetailPane`），没有抽屉；用户要求「点击列表抽屉显示大任务的面板信息」，关闭后回到列表。

### 1.5 本期目标

1. 派发立即返回，队长这一轮可结束并继续对话；失败不吞、后台可见。
2. 任务页：可拖动的无限画布（平移 + 重置，不引第三方库）、节点主标签为角色名 + 任务简述、角色卡片、圆形进度条 + 分区任务列表。
3. 项目库：项目列表与详情分栏可拖拽；新 run 落 `project`，消除新数据的「未知项目」；项目行按 run 级大任务名显示；点行开抽屉看该 run 的角色/任务/流转/用量，关闭回列表。
4. 所有既有纪律（自动派发、门禁、5 类确认、共享视图、形状普查、双产物）不回归。

## 2. 用户故事与验收标准

> AC 编号仅属于本任务夹。每条 AC 都给出可执行/可观察的判定；涉及 DOM 的地方同时约定 `data-*` 锚点，供 CDP 与单测共用。

### US-1（P0）派发后我能继续和队长说话

**作为**用户，我在派发任务后应该立即能继续输入，而不是等所有成员跑完。

- **AC-1（P0）派发工具不阻塞队长轮。**
  - `auto_team_dispatch` 工具 handler 在 `spawn` 桩「60 秒后才 resolve」时仍须 ≤1 秒返回；真机从触发派发到输入框可聚焦、可发送消息 ≤5 秒。`auto_team_plan` 的自动派发路径同样 ≤5 秒。
  - 返回结果必须显式区分「已接受派发」与「派发完成」（例如 `accepted:true` / `dispatching:true`），不得把「已接受」写成 `started` 或 `done`。
  - 改回「await 整条 dispatch/spawn 链后再返回」时，该测试必须变红（超时或断言失败）。
  - 真机判定：成员仍在 running 时，向队长发送一条新消息，10 秒内收到队长回复；仅输入框可点不算通过。
- **AC-2（P0）队长提示词不再指示等待。**
  - 队长常驻提示词里必须有一条可 grep 的中文特征句，语义为「派发后立即结束本轮，不要等待成员完成；成员完成会通知你，进度看面板」。
  - 真机上派发后队长的可见回复是一句简短状态说明，不出现 `wait_agent`/`sleep`/反复 `auto_team_status` 的轮询；若宿主 Team 策略仍让模型等待，技术方案必须给出隔离方案并记录证据。
- **AC-3（P0）派发失败与「已接受」可区分。**
  - 后台 spawn 失败不得被吞：面板/下一次 `auto_team_status`/活动流至少有一处出现可读错误，连续 3 次失败仍触发既有「自动派发连续失败，需人工处理」播报。
  - 禁止用「直接把会话状态改成 idle」或「不真正 spawn 也返回成功」来满足 AC-1；注入必失败的 spawn 后，任务不得进入 running，错误必须在 5 秒内可见。
  - 全部任务进入终态后 5 秒内会话保持空闲，不因成员结束又回到 running。

### US-2（P0）流程图是可以拖着看的无限画布

**作为**用户，我想在任务多、图变宽时拖动查看，而不是被 300px 窗口裁掉。

- **AC-4（P0）画布可平移、可重置、不破坏其他交互。**
  - `[data-flow-canvas]` 内使用 `[data-flow-viewport]` 承载 CSS `transform: translate(x,y)`；指针拖动 100px 后，viewport 的平移量在拖动方向变化 ≥90px，节点 bounding box 同步移动 ≥90px。
  - 拖动阈值 4px：小于阈值视为点击，仍触发任务定位/展开；大于阈值不得触发任务选中。
  - `[data-canvas-reset]` 点击后 viewport 回到 `translate(0px, 0px)`（允许 ≤1px 浮点误差）；重置按钮可用键盘 Enter/Space 触发。
  - 画布内拖动不得改变面板 `scrollTop`、不得选中文本、不得让页面跟着滚；`touch-action:none` 只作用于画布。
  - 不引入任何第三方图形/手势依赖；`package.json` 的 dependencies 不新增。
- **AC-5（P0）节点主标签是角色名，下面是任务简述。**
  - 节点主标签 `[data-flow-node-role]` 等于该任务所属角色的显示名（`Role.name`）；角色名缺失时才回退 `roleId`，不得回退任务 id。
  - 造一个 `roleId=qa` 的任务，节点主标签必须出现「测试」（或该角色配置名），不得是 `t1`；`data-flow-node` 仍保留任务 id，供定位/自动化使用。
  - 节点第二行 `[data-flow-node-title]` 显示任务标题的单行截断，完整文本在 `title` 属性里。
  - 节点仍须显示状态点/状态文案与 token/用时；状态、token、用时三者任一裁掉即失败。
- **AC-6（P0）连线方向与状态可读，不只靠颜色。**
  - 每条边始终有箭头；上游已完成 = 实线 + 强调色，上游未完成 = 虚线 + 弱化色，语义属性 `data-upstream-done` 与视觉一致。
  - 图例保留并解释「实线=上游已完成 / 虚线=上游未完成」；节点状态同时有文字，不允许只用颜色区分。

### US-3（P1）角色状态变成角色卡片

**作为**用户，我想一眼看到每个角色在干什么、花了多少 token/时间。

- **AC-7（P1）卡片数量与参与角色数一致。**
  - 任务页渲染 `[data-role-card]` 的数量 = 本 run 任务里出现的不同 `roleId` 数，不是角色库全部角色数。
  - 造 2 个角色、3 个任务（其中 2 个同角色）：卡片数必须是 2；裁掉卡片或渲染 5 个内置角色均判红。
  - 每张卡片有 `data-role-id`，角色名可见。
- **AC-8（P1）卡片内容是四件事：角色名、状态、当前任务、用量。**
  - 状态 `[data-role-status]` 至少有：任一任务 running →「执行中」；任一 gate →「待验收」；任一 rework/failed/interrupted →「需处理」；全部 done →「已完成」；否则「待命」。
  - 当前任务 `[data-role-active-task]`：有 running/gate 任务时显示其标题，否则显示「无进行中任务」。
  - token 文本来自 host 的 `UsageCell`，缺数据显示「不可得」；`[data-role-usage][data-usage-source="unavailable"]` 必须存在，不得显示 0 或按字数估算。
  - 用时来自 host 的 `DurationCell`，缺数据显示「不可得」；`[data-role-duration][data-duration-state]` 与真实状态一致。
- **AC-9（P1）角色卡片与共享视图单源。**
  - 右栏任务页与项目库抽屉的角色卡片来自同一组件与同一 `buildRunDetail` 产物；不得为抽屉另写一套。
  - 同一 fixture 在两处渲染，角色名/状态/当前任务/用量文本逐字相等（深比较或 DOM 文本比较）。

### US-4（P1）任务列表有总体进度，已完成与未完成分开

**作为**用户，我想先看到 2/3 这样的总体进度，再扫任务。

- **AC-10（P1）圆形进度条的分子分母来自真实状态。**
  - 任务页出现 `[data-task-overview]`，左侧 `[data-progress-ring]`（56–64px 的 SVG 圆环或等价 CSS 环），右侧任务列表。
  - 圆心 `[data-progress-text]` 文本严格为 `${done}/${total}`；`aria-label` 为「已完成 X / 共 Y」；环的 `stroke-dashoffset`/`stroke-dasharray` 比例 = done/total（误差 ≤0.01）。
  - 造 2 个 done + 1 个 running：必须显示「2/3」且弧长 2/3；写死 0、只算 running、把 cancelled/skipped 算作 done 均判红。
  - 空计划显示「0/0」与既有空态，不出现 NaN/Infinity。
- **AC-11（P1）已完成与未完成分组显示且同步。**
  - 列表按「未完成」「已完成」两组显示，`[data-task-group="open"]` 在前、`[data-task-group="done"]` 在后；组头显示各自数量。
  - 已完成行有对勾/弱化样式，未完成行保持正常对比度；每行仍保留 token、用时与展开详情。
  - 把任一任务从 running 改成 done 后，分组计数与圆环必须在同一渲染帧更新，不得一个变一个不变。
- **AC-12（P1）计数口径写死并全状态覆盖。**
  - 分子只算 `status === 'done'`；`cancelled / skipped / failed / gate / rework / interrupted` 等一律计入未完成，并在行内保留各自徽标。
  - 表驱动测试覆盖 TaskStatus 13 种状态，断言每种状态落入的分组与是否计入分子。

### US-5（P1）项目库按大任务名列出，点开是抽屉

**作为**用户，我想在项目里看到「一个大任务一行」，点开看它的完整面板，而不是看到一堆 `t1/t2`。

- **AC-13（P1）项目列表/详情分栏可拖拽，外框宽度如实说明不可调。**
  - 项目库页 `[data-project-split]` 内有可拖拽手柄 `[data-split-handle]`；拖动 80px 后 `[data-region="project-list"]` 宽度变化 ≥60px，夹在 160–360px 之间。
  - 外框（宿主侧栏）宽度在拖动前后 `getBoundingClientRect().width` 不变；PRD 与 UI 文案如实写「宿主未暴露调宽接口，外框宽度不可调」，不得声称已改好。
  - 双击手柄恢复到 220px；手柄有 `aria-label` 与键盘 ArrowLeft/ArrowRight 每次 8px 的替代操作。
- **AC-14（P1）新 run 不再产生「未知项目」。**
  - 计划落盘时写入 `project` = 当前工作区标识（与 `library` 的 current workspace 同源）；同一工作区连续 2 个 run 必须归入同一个项目桶，不得出现两个同名/同路径项目。
  - 只有新 run 时，项目列表不得出现「未知项目」；有旧 run 时，旧数据进入固定末位的「历史运行（未记录工作区）」桶，桶头有可读说明「旧版本 run 未记录工作区，无法自动归类」，不得静默并入当前项目。
  - 测试夹具：2 个带 project 的新 run + 1 个无 project 的旧 run → 当前项目 2 行、历史桶 1 行、无字面「未知项目」桶名。
- **AC-15（P1）项目页一行 = 一个 run 级大任务。**
  - 项目详情列表的行数 = 该项目的 run 数，不是 PlanTask 数；`[data-run-row]` 每条带 `data-run-id`。
  - 标题 `[data-run-title]` 优先显示计划 `goal` 的缩写（≤24 字符 + 省略号），完整 goal 在 `title`；无 goal 的旧 run 显示「未命名任务 · <runId 后 6 位>」，并带 `data-title-source="fallback"`。
  - 造 2 个 run、每个 3 个任务：项目页必须只有 2 行；任何一行标题等于 `t1/t2/t3` 或裸 `runId` 均判红。
- **AC-16（P1）点行开抽屉，关闭回列表原位。**
  - 点击 `[data-run-row]` 后出现 `[data-run-drawer]`，`data-drawer-run` 等于该 runId；抽屉内至少含 run 头部/用量、角色卡片、任务列表与进度环、流转画布。
  - 抽屉从右侧覆盖进入（宽屏），窄屏改为全宽/底部进入；背景列表不卸载，抽屉层级高于列表但不跳转路由。
  - 关闭按钮、Esc、点击遮罩三种方式都能关闭；关闭后焦点回到触发的行，列表 `scrollTop` 与打开前一致（测试：先滚到 200px）。
  - 同一时刻最多一个抽屉；重复点不同行只切换内容，不叠加。

### US-6（P1/P2）共用、形状与回归

- **AC-17（P1）两处视图同源。**
  - 抽屉与右栏任务页共用 `buildRunDetail`、角色卡片、任务列表/进度环、流转画布；仓库内这些组件/装配函数各只有一处定义。
  - 同一 fixture 的 run 标题、角色卡片文本、任务行文本、节点文本在两处逐字相等。
- **AC-18（P1）形状普查与旧夹具兼容。**
  - 面板页签仍只有 `tasks/history/memory`；`PanelAction` 21 条、HTTP 路由 4 条、`RejectionCode` 13 条、`ActivityEvent.kind` 9 种、`TaskStatus` 13 种、工具 8 个、`setInterval(` 1 处，均不变。
  - 只允许新增可选字段：`Plan.goal?`、`RunSummary.goal?`、`ProjectRunSummaryView.goal?`、`FlowNodeView.roleName?`、`RoleUsageView.{done?,state?,stateText?,activeTaskId?,activeTaskTitle?,duration?}`；旧 v3 夹具不改字段也能读取与渲染（缺失时按降级文案）。
  - 不新增 HTTP 路由、`PanelAction`、`RejectionCode`、`ActivityEvent.kind`；若技术阶段确需新增，必须在本 PRD 之外单列理由并重新确认。
- **AC-19（P1）全量回归与产物。**
  - `pnpm -s typecheck` 0 错；`pnpm -s test` ≥ 668（只增不减）；双产物新鲜（`find src -newer lib/*.js` 为空）；`await import('./lib/index.js')` 与 `await import('./lib/client.js')` 均 exit 0；`npm pack --dry-run` 仍含 `lib/index.js`、`lib/client.js`、`cordis.patch.yml` 三件。
  - `package.json` 无新增 dependencies；构建产物只增代码体积，不增第三方包。
- **AC-20（P1）变异探针证明「实现错了会红」。**
  - 至少 6 个探针，每个记录「原样绿 / 变异红」：① 改回 await spawn → AC-1 红；② 去掉 pointer 拖动 → AC-4 红；③ 节点主标签改回 task.id → AC-5 红；④ 进度环写死 0 → AC-10 红；⑤ 项目行改为 PlanTask 行 → AC-15 红；⑥ 删掉抽屉 → AC-16 红。
  - 探针放在仓库 `test/`（可重复执行）；CDP 脚本放 `logs/teamflow/<runId>/scripts/`，不制造命令输出 dump。
- **AC-21（P1）真机证据；起不来就如实记未验证。**
  - 第二宿主（克隆 profile + 端口 51890）+ CDP 至少取证：派发后 5 秒内可输入并收到队长回复；画布拖动 100px 前后 transform 变化、重置回 0；进度环 2/3；角色卡片数量；项目页行数 = run 数；抽屉开/关；旧 run 的历史桶说明。
  - 环境无法启动时，QA/验收报告必须写「未验证」+ 具体阻塞（端口、cookie、CDP 连接等），不得用 mock 或截图顶替；其余离线 AC 仍须全绿。
- **AC-22（P2）性能不因新视图退化。**
  - 100 run 的 library 冷启动 ≤1 秒、热读 ≤100ms（沿用 r13 AC-23）；新增 goal 投影不得触发全量重算。
  - 50 节点画布连续拖动 60 帧，平均帧间隔 ≤20ms；拖动只改 transform，不重排节点布局。

## 3. 范围与非目标

### 3.1 本期范围

- 派发非阻塞修复（工具路径 + 队长提示词 + 失败可见）。
- 任务页：角色卡片、圆形进度环 + 分区任务列表、可拖动无限画布（平移 + 重置）、节点角色名/任务简述、连线状态。
- 项目库：内部分栏拖拽、`project` 落盘与旧数据历史桶、run 级 goal 标题、抽屉详情。
- 共享视图/形状契约、单测与变异探针、真机取证、回归与工程收口。

### 3.2 非目标

- **不改宿主左侧栏外框宽度**：`ctx.layout` 无宽度 setter，宿主侧栏 264–420px 固定；本期只做项目库页内分栏。PRD/验收/UI 文案必须如实写「宿主未暴露，本期不可行」。
- 不做画布缩放、小地图、自动布局、节点拖拽改依赖、缩略图、惯性/回弹；不做移动端双指手势。
- 不做新的 HTTP 路由、`PanelAction`、`RejectionCode`、`ActivityEvent.kind`，不改工具数量与 5 类确认/7 类可逆语义。
- 不在右栏 320px 面板里做抽屉；本期抽屉只在项目库页（main），右栏任务页保持内联展开（见 openQuestions 的 taste 项）。
- 不引入第三方图形/手势/动画库；不复制 `NanmiCoder/dsh-agent-teams` 的代码或依赖，只读参考信息架构。
- 不自动迁移/删除旧 run，不为旧 run 编造 workspace；旧数据只做可读归类。
- 不改 `~/.dsh/profiles/desktop` 的安装；装/重启由主 agent 执行。
- 不做角色/模型/记忆管理界面的重构；角色卡片只读展示。

## 4. 反面目标 / anti-goals

> 「技术上都跑通了，但用户仍然会拒绝」的五种具体结果。每条都可由使用者在几分钟内观察/复现。

1. **派发说成功，成员却没起来。** 工具返回绿色「已派发」，实际 spawn 失败被吞掉，用户以为在跑；可检查：注入必失败的 spawn，5 秒内面板/状态必须出现错误或重试，任务不得进入 running；若仍显示「已派发」且无错误，即失败。
2. **画布一拖就误选，或重置回不到原位。** 用户想平移，结果打开了任务详情、面板跟着滚、或点「重置」后节点仍在偏移位置；可检查：拖动 100px 后无任务展开、`scrollTop` 不变、重置后 transform 为 `translate(0px, 0px)`。
3. **进度数字骗人。** 环上写死 0、只算 running、把 cancelled/skipped 算成 done，或环显示 2/3 而列表分组是 1/2；可检查：2 done + 1 running 必须同时显示 2/3 与「未完成 1 / 已完成 2」。
4. **角色和大任务仍然认不出。** 节点主标签还是 `t1`；`qa` 被显示成开发或只显示 token 没有状态；项目页仍是 runId 或 `t1` 当标题；2 个 run 被拆成 6 行小任务。可检查：造 2 run × 3 task + 一个 qa 任务，节点出现「测试」，项目页只有 2 行且都不是 `t1`/裸 runId。
5. **抽屉打断当前工作。** 打开抽屉把列表卸载、滚动归零、同时叠开多个、关闭后焦点回不到触发行；可检查：滚到 200px 后开关抽屉，`scrollTop` 仍为 200，焦点回到该行，页面上只有一个 `[data-run-drawer]`。

## 5. 交互流程摘要

### 5.1 派发

1. 队长拆解目标并调用 `auto_team_plan`；计划落盘后自动派发 kick 启动。
2. 队长（或用户明确要求时）调用 `auto_team_dispatch`：校验 `runId`、验证归属与幂等，然后**立即返回「已接受派发」**；实际 spawn 在后台推进。
3. 队长结束本轮并给用户一句状态说明；用户可以马上继续对话。
4. 后台 spawn 成功 → 任务 running、成员出现、面板与角色卡片更新；失败 → 任务不进入 running，错误在 5 秒内可见并触发有限重试/播报。
5. 成员完成 → 既有门禁/回执/自动派发链路不变。

### 5.2 任务页

1. 顶部 run 头（状态、token、用时）。
2. 角色卡片区：每个参与角色一张卡（名字、状态、当前任务、token/用时）。
3. 任务总览：左侧圆形进度环（`已完成/总数`），右侧「未完成 / 已完成」分组任务列表；每行仍可展开详情。
4. 流转画布：可按住拖动平移；「重置视图」回初始位置；节点第一行角色名、第二行任务简述、状态与 token/用时；边有箭头 + 实线/虚线。

### 5.3 项目库

1. 左栏点击「自动团队」进入项目库页（`main` 槽位）。
2. 左侧项目列表（顶部「全局」、当前工作区、其他项目、末位「历史运行（未记录工作区）」）；左右分栏可拖拽，双击复位。
3. 右侧项目详情：项目头 + run 级大任务行（goal 缩写 + 状态/用时/token）+ 项目记忆。
4. 点某个 run 行 → 右侧抽屉打开该 run 的头部、角色卡片、任务列表/进度环、流转画布；背景列表保留。
5. 关闭按钮/Esc/遮罩关闭 → 回到列表原滚动位置，焦点回该行。
6. 旧 run 无 goal → 「未命名任务 · <runId 后 6 位>」；旧 run 无 project → 历史桶 + 说明，不混入当前项目。

## 6. 优先级

| 优先级 | 内容 | 说明 |
|---|---|---|
| P0 | AC-1 ~ AC-6 | 派发后对话可用是上线阻断；画布拖动/角色名/重置是本次主诉求 |
| P1 | AC-7 ~ AC-21 | 角色卡片、进度环、项目库、抽屉、共享/形状/回归/真机 |
| P2 | AC-22 | 性能与大规模 library 回归；不阻塞交付但须记录 |

## 7. 依赖与风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 宿主 native Team 策略（`tool-agent-team` 的 “Lead must wait…”）与插件提示词冲突 | 即使工具立即返回，模型仍可能不结束本轮 | 技术阶段做对照实验；在队长提示词中明确「成员不是必须等待的 required teammates，派发后立即结束本轮」；若仍无效，评估改用非 Team 的 spawn 路径并记录宿主限制，不许伪造 idle |
| `spawnTeammate` 在 provisioning/active 之间的返回语义未实测 | 异步派发可能拿不到 memberId 或重复 spawn | 以 `listMembers`/roster 对账；幂等按 runId + 成员名；失败可见；技术方案给出时序图与探针 |
| 宿主无左栏宽度 API | 用户「调宽」诉求无法按字面满足 | PRD/UI 如实写不可行；用项目库内分栏替代；不修改 profile |
| 旧 run 缺 `project`/`goal` | 项目页出现无主/无名数据 | 旧数据进「历史运行（未记录工作区）」桶并说明；标题用 fallback；不猜测 workspace |
| 画布 pointer 事件与面板滚动冲突 | 拖动误触、页面滚动、点击失效 | 4px 阈值 + `touch-action:none` + 只在画布内 preventDefault；重置按钮键盘可达；单测/CDP 覆盖 |
| 320px 面板内进度环 + 列表拥挤 | 文本截断、环挤压列表 | 环固定 56–64px，列表 `min-width:0` + 省略；抽屉只在宽 page 使用 |
| 形状扩张破坏旧夹具 | 历史 run 打不开 | 所有新字段可选；客户端缺省降级；v3 夹具回归 |
| 真机 CDP 环境不可用 | 无法证明拖动/输入框行为 | 按仓库既有纪律记「未验证」+ 具体阻塞；离线 AC 仍须全绿 |

## 8. 里程碑建议

1. **M1（P0，先做）**：`auto_team_dispatch` 非阻塞 + 队长提示词 + 失败可见；单测（延迟 spawn 桩）+ 真机输入框验证。先证伪/证实两条根因。
2. **M2（契约）**：`Plan.goal`、`project` 落盘、`FlowNodeView.roleName`、`RoleUsageView` 角色卡片字段；`buildRunDetail` 单源装配；形状普查与旧夹具。
3. **M3（任务页 UI）**：角色卡片、进度环 + 分组列表、画布平移/重置/角色名/连线；组件测试与变异探针。
4. **M4（项目库）**：内部分栏、未知项目治理、run 级标题、抽屉；列表/抽屉/键盘/滚动测试。
5. **M5（收口）**：全量回归、双产物、pack、真机 CDP、QA 报告与验收；单笔提交。

## 9. 工程约束

以下按原始需求保留，不得在实现阶段改写或省略：

- 只能改本仓库；**不要动 `~/.dsh/profiles/desktop` 的安装**（装/重启由主 agent 做）。
- UI 只许用 `replaceRisk=none` 的槽位；**禁止再调 `cordis_inspect_query` 查槽位**，一律读 `docs/teamflow/architecture/UI-SLOTS.md`；宿主事件/契约问题先读 `docs/teamflow/architecture/HOST-EVENTS.md`。
- 回归线：`pnpm -s test` 只增不减（当前 668），typecheck 0 错，双产物新鲜（`find src -newer lib/*.js` 为空），双产物 `await import` exit 0，`npm pack --dry-run` 仍含 3 条目。
- 形状扩张逐条列出并给理由（面板页签结构、快照字段、`PanelAction`、HTTP 路由若要动必须单列）；除列出的之外，`ActivityEvent.kind`（9 种）与既有 15 个 `PanelAction` 语义不得随手改。**注：当前代码实际为 21 条 `PanelAction`（r13 已扩张），验收以 21 条为准，本条原话中的 15 为旧基线数字。**
- 画布拖动、抽屉、圆形进度条一律 CSS/SVG 自绘，不引入依赖；若确需依赖，PRD 里单列「替代方案 + 体积代价」再定。
- 真机证据：克隆 profile 起第二宿主 + CDP 取 DOM（拖动前后 transform 变化、进度条分子分母、抽屉开关、角色卡片存在性）；环境起不来如实记「未验证」，不许 mock 顶替。

### 9.1 分支与工作树

- 停留在 `feat/auto-team-plugin`，基线 `a138883`；不新建/不切换分支（除非主 agent 另行指示）。
- 工作树已有未跟踪目录 `docs/teamflow/20261104-r14-panel-canvas-redesign/`（本任务夹）；实现阶段不得 `git clean`/`reset` 清掉它。
- 收口按仓库既有流程由主 agent 单笔提交；实现阶段只改源码、测试与任务夹文档，不改 profile 安装。

### 9.2 `.gitignore` 审计（开发阶段动作）

现有规则已覆盖 `node_modules/`、`dist/`、`coverage/`、`*.tgz`、`*.log`、`.pnpm-store/`、`.env*`、IDE 目录、`logs/teamflow/`、`.auto-team/`、`.dsh-code-index/`；`lib/` 与 `docs/` 明确不忽略。开发阶段须复核新探针/截图/临时文件不落在项目根（CDP 截图放 `logs/teamflow/<runId>/`，该目录已忽略）；若新增 `.tmp/`、`.cache/` 等真实产物再补规则。**不得**把 `lib/`、`docs/teamflow/` 或 `cordis.patch.yml` 加入忽略。

### 9.3 形状扩张清单（逐条理由）

| 类型 | 新增字段 | 理由 | 兼容策略 |
|---|---|---|---|
| `Plan` | `goal?: string` | 持久化 `auto_team_plan` 的大任务名，供项目页/抽屉标题 | 可选；旧 run 无值走 fallback |
| `RunSummary` | `goal?: string` | Snapshot 的 runs 列表使用大任务名 | 可选 |
| `ProjectRunSummaryView` | `goal?: string` | 项目页 run 行标题 | 可选 |
| `FlowNodeView` | `roleName?: string` | 节点主标签=角色名（AC-5） | 可选；缺失回退 roleId |
| `RoleUsageView` | `done?`、`state?`、`stateText?`、`activeTaskId?`、`activeTaskTitle?`、`duration?` | 角色卡片四要素（AC-7/8） | 全可选；旧夹具渲染降级 |

- `RunState.project` 是 r13 已有字段，本期只补「写入」，不算新增形状。
- 不新增 `PanelAction`、HTTP 路由、`RejectionCode`、`ActivityEvent.kind`、`TaskStatus` 或工具。
- 若技术阶段发现必须新增上述任一，先停下来在任务夹里单列「为什么现有形状不够 + 兼容/迁移方案」，不得静默扩张。

## 10. 假设与待澄清

> 以下每条都同时进入状态块的 `openQuestions`。`fact` = 可靠调研能给出答案但当前未定；`taste` = 两个都对的偏好选择，已给推荐默认值。

### 10.1 未定事实（fact）

- **F1｜P0 的主因尚未用对照实验定论。** 现在有两条候选：插件 `auto_team_dispatch → bridge.act → dispatchReady → await spawn`；宿主 profile 启用的 native Team 策略 “Lead must wait for required teammates”。两者都可能让主会话停在 running。**若最终确认是宿主策略、且插件无法在不改 profile 的前提下覆盖**，本期只能做到「工具立即返回 + 提示词显式不等 + 面板可用」，并在验收报告里记录宿主限制与复现证据；不会伪造 idle。默认方案：先按「工具立即返回 + 队长提示词明确不等」修，再真机复验；仍不达标则技术阶段给出非 Team spawn 路径的评估。
- **F2｜宿主是否还有未穷尽的左栏宽度入口。** 已确认 `ctx.layout` 只有 4 个方法、无宽度 setter，宿主文档写死 264–420px。**若存在未公开的设置项/CSS 变量**，外框宽度可能可调；默认按「不可调」处理，做项目库内分栏。
- **F3｜两张参考图未文本化，视觉细节不可得。** 角色卡片与可拖动画布的截图没有转成文字，外部仓库 `NanmiCoder/dsh-agent-teams` 只作只读信息架构参考，未拿到其具体样式。默认按本 PRD 文字 + 现有宿主 token 实现；参考图与原仓库的像素级还原**不在本期验收范围**。
- **F4｜旧 run 的 workspace 无法恢复。** 旧 `RunState` 没有 `project`，sessionId 也不能反查 workspace；默认把旧 run 归入「历史运行（未记录工作区）」并说明，不猜测、不迁移。
- **F5｜`spawnTeammate` 在 provisioning 阶段的返回语义未实测。** 文档说返回 active roster row，但成员可能仍处于 provisioning；异步派发必须用 roster/`listMembers` 对账，避免重复 spawn 或拿不到 memberId。默认：把返回视为「已接受」，由后续状态轮询补全，不阻塞工具调用。

### 10.2 用户偏好（taste）

- **T1｜进度环的「已完成」怎么算。** 只算 `done`（推荐：cancelled/skipped 是终止但未完成，单独标注）vs 把 cancelled/skipped 也算完成（数字更「好看」但会骗人）。默认只算 `done`；若改口径，AC-10/12 的期望值与文案随之改。
- **T2｜角色卡片的布局密度。** 2 列紧凑网格（推荐：320px 面板也能放下 4 张）vs 单列大卡（信息更大但一屏只能看 1–2 个角色）vs 横向滚动。默认 2 列；若选单列，卡片高度与滚动策略要重做。
- **T3｜抽屉从哪一侧进入。** 右侧覆盖（推荐：与列表的主从方向一致，宽屏可并排看）vs 底部上滑（窄屏更顺手，但宽屏浪费横向空间）。默认右侧覆盖，窄屏自动全宽。
- **T4｜本期是否做画布缩放。** 只做平移 + 重置（推荐：滚轮缩放会和面板滚动打架，先保拖动可用）vs 加 `+/-` 按钮缩放 vs 滚轮缩放。默认只做平移 + 重置；若选缩放，需要额外的交互隔离与验收。
- **T5｜旧数据的桶名。** 「历史运行（未记录工作区）」（推荐：直接说明来源）vs 保留「未知项目」但加说明（改动小，但仍会让用户觉得是 bug）。默认改名；若保留原文，AC-14 的桶名断言相应调整。
- **T6｜抽屉只放项目库，还是右栏也用。** 只在项目库页（推荐：右栏 320px 放抽屉会遮住列表，且用户诉求明确指向项目库）vs 右栏任务页也改成抽屉。默认只改项目库；若两处都改，需要额外的窄屏交互与回归。

### 10.3 其他默认（不需要用户拍板，但实现需知道）

- 项目行标题缩写长度 24 字符；完整 goal 放 `title`。
- 画布初始 transform 为 `translate(0,0)`；重置即回该值，不做「适配内容」自动缩放。
- 角色卡片 token 为角色任务用量之和；用时为角色任务的最早开始至最晚结束/当前（进行中）。
- 旧 run 无 goal 的标题为「未命名任务 · <runId 后 6 位>」；`data-title-source="fallback"`。
