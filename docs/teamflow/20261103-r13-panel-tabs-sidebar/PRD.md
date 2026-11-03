<!-- meta: summary="自动团队面板改为任务/历史/记忆三页并展示真实 token 与用时、自绘任务流转图；计划落盘即自动派发，仅五类不可逆动作弹窗确认；左侧栏新增自动团队栏目（全局/项目记忆 + 项目任务），与右栏共用同一数据契约与组件。" -->
基线依赖：docs/teamflow/20261102-r11-team-scope-control（写域互斥、waiting 语义、`auto_team_add_tasks`、门禁与偏差留痕的既成行为不得回归；同时沿用 r7 面板骨架与 r9/r10 的输入框胶囊、右栏页签三步注册链路，均不改动）
取代：docs/teamflow/20261101-r7-auto-team-panel-roles#AC-14：右栏页签由「计划/成员/记忆/角色」四页改为「任务/历史/记忆」三页，角色管理只保留在设置页。
取代：docs/teamflow/20261102-r11-team-scope-control#AC-26：`updateAcceptance` 的允许面扩到 `done`（确认后修改命令并重跑门禁）；`cancelTask`/`skipTask` 的允许面不变，但执行前必须先确认。
取代：docs/teamflow/20261102-r11-team-scope-control#AC-28：形状扩张清单本轮更新（`PanelAction` 18→21、HTTP 路由 3→4、`RunState`/`RunSummary`/`PanelSnapshot`/`MemoryFileInfo` 新增字段、`RejectionCode` 12→13、新增共享视图契约）；`ActivityEvent.kind` 仍 9、`TaskStatus` 仍 13、`PlanStatus` 仍 5、工具仍 8、`setInterval` 仍 1、`sessionOf` 仍 1 处不变。

# r13 · 三页面板、自动派发与左栏「自动团队」栏目

## 1. 背景与目标

**现状（r11 验收终态）**：右栏面板是四页签（计划/成员/记忆/角色），只读展示任务与成员；面板看不到任何 token 用量与用时，也不存在任务流转图；计划落盘后必须由用户点「派发」才开始执行；记忆页只显示当前项目轨且没有建立时间；左栏没有任何自动团队入口，跨项目/全局记忆不可达；历史 run 只能靠 `~/.dsh/auto-team/runs/*.json` 手工翻。

**目标**

| 编号 | 目标 | 用户可见结果 |
|---|---|---|
| G1 | 面板信息架构收敛为三页 | 打开面板只有「任务/历史/记忆」，历史与详情同构，角色管理回到设置 |
| G2 | 成本与耗时可见且可信 | 每个任务、每个流转节点、每次 run 都显示 token 与用时；没有真实来源时显示「不可得」而不是 0 或估算 |
| G3 | 派发自动化 | 计划落盘后无需任何点击即开始派发，仍受并发/依赖/写域/暂停约束 |
| G4 | 只对不可逆动作设闸 | 5 类危险动作先弹确认、确认前零副作用；7 类可逆动作零弹窗直接执行 |
| G5 | 左栏可浏览 | 左栏「自动团队」栏目：左列项目列表（顶部固定「全局」），右列选中项目的任务与项目记忆；全局显示 public 记忆 |
| G6 | 一套契约一套组件 | 右栏与左栏共用同一视图装配与组件，同一 run 在两处数字逐字一致 |

**成功判据（产品语义）**：用户打开面板能在一屏内回答「这次花了多少、慢在哪、卡在谁、下一步谁在跑」；不需要再把计划点一下才动；危险操作有明确的最后一道确认；左栏能按项目回看任何一次运行。

## 2. 用户故事

| 编号 | 用户故事 | 可测验收点（对应 AC） |
|---|---|---|
| US-1 | 我只想看到「这次任务干得怎么样、以前干过什么、记忆里有什么」，不想在四个页签里找 | 面板 `data-tab` 恰 3 项，旧三页签节点 0（AC-1、AC-2） |
| US-2 | 我想知道每个任务花了多少 token、用了多久，且这个数字是真的 | 每行 token/用时单元格；缺数据显式「不可得」；改字符数不改变数字（AC-3、AC-19、AC-20） |
| US-3 | 我想一眼看出任务之间的依赖与当前卡点，而不是读列表脑补 | 流转图节点=任务、边=依赖，节点带 token/用时，拓扑列布局（AC-4） |
| US-4 | 我想回看第二次、第三次运行，而不是永远只看最新那次 | 点第二条 run 后任务 id 集合与第一条不同（AC-5） |
| US-5 | 项目记忆里只应该有本项目的东西，公共约定不该混进来 | 造 public 夹具后断言不出现在项目页；正文与磁盘逐字一致（AC-6） |
| US-6 | 我不想为「开始干活」再点一下按钮 | 零用户动作 3 秒内出现成员创建，dispatch 调用 0（AC-8、AC-9、AC-10） |
| US-7 | 但杀掉正在干活的成员、终止整个 run 这种事，必须先问我 | 5 类危险动作确认前状态 sha 不变（AC-11、AC-13） |
| US-8 | 我想在左栏按项目浏览，并且点开就能看详情 | 左栏入口 + 两栏布局 + 三类列表项详情（AC-14、AC-15、AC-16、AC-17） |
| US-9 | 同一份数据在右栏和左栏不能对不上 | 两边归一化视图 deep equal、组件定义仅 1 处（AC-7、AC-18） |

## 3. 范围

### 3.1 范围内

- **F1 面板三页**：任务/历史/记忆；移除面板内的计划、成员、角色页签；角色管理只在设置页。
- **F2 token 与用时**：真实来源采集 + 落盘 + 三处展示（列表行、流转节点、run 头）+ 显式「不可得」。
- **F3 自动派发**：计划落盘与每次状态推进后自动派发，受既有并发/依赖/写域/暂停约束；`runId` 仍贯穿。
- **F4 确认门禁**：5 类危险动作弹窗；7 类可逆动作直通；确认/拒绝走既有 `/act`。
- **F5 左栏栏目**：项目列表（顶部「全局」）+ 选中项目的任务与项目记忆 + 三类详情。
- **F6 数据契约**：`RunDetailView` 等共享视图类型、`GET /api/auto-team/library`、双端复用组件。
- **F7 形状登记与回归**：逐项登记扩张；既有 15 个 `PanelAction` 语义、`ActivityEvent.kind`、`TaskStatus`、工具数、`setInterval` 不变。

### 3.2 非目标

- 不做跨项目聚合分析、成本报表、导出（本轮只到「按项目浏览 + 单 run 详情」）。
- 不做 run 的删除/归档/重命名/对比；历史只读。
- 不改 r11 队长提示词的两条硬规则、不改门禁命令语义、不改写域冲突判定。
- 不引入第三方图表库、状态管理库或依赖。
- 不做成员级消息流视图（消息仍归任务详情与既有消息账本）。
- 不做移动端专门布局（只保证窄栏折叠为单栏）。
- 不安装/改动 `~/.dsh/profiles/desktop` 的插件；不动 r6/r10 定稿的输入框胶囊与右栏三步注册。

### 3.3 anti-goals / 反面目标

即使测试全绿，只要出现以下任一情形，本需求即视为**失败**：

1. **token 造假**：取不到 usage 时显示 0、或按字数/角色数估算一个数字填进「token」列——用户据此以为这次几乎没花钱（真机可用一条无 usage 事件的 run 当场核对）。
2. **历史页永远最新**：点第二条 run 后渲染的仍是当前 run 的任务集合，用户对着「A 的运行」评价 B 的产物（用两条 run 的任务 id 集合即可分辨）。
3. **自动派发名存实亡**：计划落盘后仍需用户点一下，或落盘后界面没有任何「正在自动派发/已派发」的在途提示，用户以为插件坏了（观察：不做任何动作，成员是否出现、界面是否变化）。
4. **危险动作先斩后奏**：取消在跑成员或终止整个 run 在确认前已生效，成员被杀、进行中的工作丢失（观察：弹窗出现时成员是否还活着、run 文件 sha 是否已变）。
5. **记忆串轨**：项目页出现 public 记忆，用户把别的项目的约定当成本项目约束执行（造一条 public 夹具即可分辨）。

## 4. 交互流程摘要

**F-A 计划 → 自动开跑（取代「用户点派发」）**

1. 队长调 `auto_team_plan`，计划原子落盘（空验收整批拒绝等 r11 规则不变），工具返回 `runId` **不等待成员创建**。
2. 落盘成功后内部触发一次自动派发（异步、单飞），就绪任务在并发上限内立即 spawn；面板/左栏出现「正在派发 / 已派发 N 个」在途提示。
3. 触发点共 5 个，缺一即视为未实现：plan 落盘后、任务进入终态后、成员退出/中断后、`add_tasks` 追加后、watcher tick 兜底。
4. 自动派发与手动 `dispatch` 共用同一 `dispatchReady`；自动路径不得越过并发上限、依赖未满足、写域冲突、暂停四道闸。

**F-B 任务终态 → 下游推进**：任务 done/rework/cancelled/skipped 后释放写域、唤醒等待者、依赖满足的下游进入派发队列，仍由 F-A 的触发点接管，不需要用户介入。

**F-C 危险动作 → 确认 → 执行**

1. 危险动作从面板按钮或队长工具发起，均先写一条 `pendingConfirmation`（含动作、对象 id、影响面一句话、是否可逆），**不执行**。
2. 面板/左栏渲染同一个 `ConfirmDialog`：确认 → 经 `POST /api/auto-team/act` 的 `confirmPending` 执行；取消 → `rejectPending` 清除，状态零变化。
3. 同一 run 同时最多 1 条未决确认；第二条请求返回已有 `pendingId`（不产生第二个弹窗、不执行）。
4. 未决确认不自动过期、不自动执行；面板未打开时保持挂起，队长工具拿到 `CONFIRM_REQUIRED` 后提示用户去面板确认。

**F-D 面板三页**：任务页（默认）＝当前 run 的角色条 + 任务表 + 流转图；历史页＝run 列表 → 点开同一套详情（面包屑返回）；记忆页＝当前项目轨索引 → 点开正文（按需读取）。

**F-E 左栏栏目**：点左栏「自动团队」→ 打开 `main` 页面：左列「全局 / 各项目 / 未知项目」，右列随选中项切换（全局=public 记忆；项目=该项目最近一次 run 的任务 + 项目记忆）；项目/任务/记忆行均可点开详情，详情在主区内展开并可返回。

## 5. 详细需求

### 5.1 面板信息架构（F1）

- `TabKey` 收敛为 `'tasks' | 'history' | 'memory'`，页签定义单源（沿用 `Panel.tsx` 的 `TABS`）；旧的 `PlanTab`/`MembersTab`/`RolesTab` 不再被面板挂载（文件可留作设置页复用，但挂载点计数必须为 0）。
- **任务页**
  - 页头：`runId`（短）、计划状态、开始/结束时间、总用时、成员 token 合计（标签必须写「成员合计」，队长用量不计入口径）、暂停/在途提示。
  - 角色条 `[data-region="task-roles"]`：每个参与角色一个 chip（角色名 + 生效模型 + 成员数），集合等于该 run 的成员角色集合。
  - 任务表 `[data-region="task-list"]`：列＝任务/角色/状态/token/用时；行内可展开（验收命令、门禁退出码与证据尾部、依赖、写域、最近消息条数）。
  - 流转图 `[data-region="task-flow"]`：DAG，节点=任务、边=`dependsOn`；节点显示 id+状态色+token+用时，点击节点与任务行联动展开；拓扑列布局，超宽横向滚动，SVG 或 div 自绘，**不引入图形库**。
- **历史页**：run 列表（runId、项目名、计划状态、任务数、成员合计 token、用时、起止时间），首屏 50 条 + 「加载更多」；点击进入详情，详情与任务页共用组件（传入 `runId`），页头有「返回历史」；列表状态（滚动位置）在返回后保留。
- **记忆页**：只列 **project 轨**（public 轨不在此页）；每行＝标题、建立时间、最近修改时间、`≈N token（估算）`；行内展开正文（按需 `GET /memory`），正文与磁盘逐字一致；空态说明「本项目暂无记忆」。
- 移除「派发」按钮与所有「等待用户确认后派发」文案；计划页原有「编辑计划」能力随计划页移除，计划修改由队长通过 `add_tasks` 完成（本轮不新增计划编辑 UI）。

### 5.2 token 与用时（F2）

**前置探针（必须先做，结论进 TECHNICAL 的「已验证 / 未验证」两节）**：`logs/teamflow/<runId>/scripts/token-usage-probe.mjs` 按序验证三条候选并打印结论：

1. 根级 `ctx.on('session/event')` 能否拿到成员会话 id 与 `assistant/message.usage`；
2. `subagents.listChildren/listDescendants` 返回记录是否含 usage/会话句柄；
3. 宿主 `agents` 服务能否按成员读取会话与用量。

结论三态：`per-member`（可按成员归属）/ `aggregate-only`（只有总量）/ `unavailable`。三种都要能落地：`per-member` 显示到任务；`aggregate-only` 只显示 run 合计且任务列标「不可得（无成员归属）」；`unavailable` 全部「不可得」。

**口径写死（不接受实现时另定）**

| 量 | 定义 | 取不到时 |
|---|---|---|
| 成员 token | 该成员会话所有 `assistant/message.usage` 的累计 `totalTokens`（缺失时 input+output），跨续聊累加；按事件 id/序号去重，重放与重启不得重复累加 | 「不可得」；有汇总但无归属时标「不可得（无成员归属）」 |
| 任务 token | 该任务全部绑定成员（含返工/续聊）的成员 token 之和 | 同上 |
| run token | 该 run 全部成员之和（按成员去重），页头标签「成员合计」 | 「不可得」 |
| run 用时 | `plannedAt` → `finishedAt`（全部任务进入终态那一刻写入一次，单位毫秒）；未结束时 `finishedAt` 缺省、按 now 实时算 | 「不可得」 |
| 任务用时 | 该任务首个成员 `spawnedAt` → 任务首个终态时刻（墙钟，含排队与返工；列头/提示注明「墙钟」） | 「未开始」（pending/waiting/blocked 且无成员）/「不可得」（旧数据缺起止） |
| 成员用时 | `spawnedAt` → 退出时刻 | 「不可得」 |
| 记忆 token | 估算 `ceil(chars / 2)`，界面显示 `≈N token`，`title` 写明「按字符数估算，非模型计费 token」 | 不可估算（0 字符）显示「0」并保留口径说明 |

- 0 是合法值：真实 0 token 显示 `0`，与「不可得」必须在 DOM 上可区分（`data-usage-source="provider" | "unavailable"`）。
- 用时文本由**宿主单点格式化**（`formatDuration(ms)`，沿用 r4「停滞秒数文本由宿主给、客户端零格式化」的先例），快照与 library 都下发 `*Text`；客户端不得自己拼「分/小时」。
- 落盘：`RunState.usage`（按成员累计 + 去重游标）、`RunState.taskTimes`（任务起止）、`RunState.finishedAt`；全部可选，旧 run 缺字段按「不可得」，**不得用 0 或按成员数推算补位**。
- 历史 run 的用时在 run 结束后仍可显示：读 `finishedAt` 与 `taskTimes`，与宿主进程是否重启无关（新建 store 实例重读结果逐毫秒相同）。

### 5.3 自动派发（F3）

- 计划落盘后自动触发；`auto_team_plan` 的返回语义改为「计划已落盘，已排队自动派发」，不再要求用户确认。
- 触发点（5 个，全部实现，缺一即 AC-8 变异红）：plan 落盘成功、任务进入终态、成员退出/中断、`add_tasks` 追加成功、watcher tick 兜底。
- 单飞与幂等：同一 run 的自动派发串行（内存 mutex，跨重启自然归零）；派发前以「任务无未退役 binding 且无 running 成员」为幂等条件；重复触发不得产生第二个成员。
- 失败可见：spawn 失败写活动流（既有 `kind:'status'`）并在下一次 tick 重试，连续失败 ≥3 次退避并提示「需人工处理」，不静默、不无限重试。
- `auto_team_dispatch` 保留：仍强制 `runId`（机械保证不撤），语义降级为「手动补派」，幂等（已派发任务新增成员 0）；工具总数仍 8。
- 自动派发必须复用既有 `dispatchReady` 的四道闸（并发上限、依赖、写域等待、暂停），不得新开旁路。

### 5.4 确认门禁（F4）

**必须确认（逐条给理由）**

| # | 动作 | 理由（为什么不可逆/越权） | 确认后 | 拒绝后 |
|---|---|---|---|---|
| 1 | `cancel`（终止整个 run） | 终止后所有在跑成员被取消、计划不再推进，已产生的中间工作无法自动恢复 | `planStatus=terminated`、取消在跑成员、写 `finishedAt`、释放写域 | 零变化 |
| 2 | `cancelTask`（任务 `running`，杀在跑成员） | 直接杀掉正在写代码/跑命令的成员，未落盘的改动丢失 | 中断成员、任务 `cancelled`、释放写域、唤醒等待者 | 成员继续，状态不变 |
| 3 | `skipTask`（跳过任务） | 下游会在缺少该产物的情况下继续，属越权改变计划 | 任务 `skipped`、依赖视为满足、释放写域 | 零变化 |
| 4 | `updateAcceptance`（任务 `done`） | 已验收任务改验收命令会改变「完成」的含义，默认要重跑门禁 | 落新命令并重跑门禁；失败转 `rework`，成功保持 `done` 并更新证据 | 零变化 |
| 5 | `forceParallel`（写域冲突时强制并行） | 两个任务同时写同一目录，可能互相覆盖，属用户显式越权 | 该任务忽略写域冲突立即派发（仍守并发与依赖），落盘 `forceParallel` 标记，重启后仍生效 | 保持 `waiting` |

**不确认、直接做（逐条给理由）**：拆解计划（可再改）、派发就绪任务（本轮目标就是去掉这一步）、续聊/恢复中断成员（沿用既有成员）、提交回执（只补充证据）、写/删记忆（可再改）、改角色与模型（可再改）、暂停/继续团队（可逆）。

**机制**

- `RunState.pendingConfirmation?: { id, action, taskId?, runId, createdAt, summary, irreversible: true }`；同 run 至多 1 条；请求被挂起时 `ActResult` 返回新增 `RejectionCode: CONFIRM_REQUIRED` 与 `pendingId`，状态与文件均不改变。
- 新增 3 个 `PanelAction`：`confirmPending`、`rejectPending`、`forceParallel`（18→21），全部走既有 `POST /api/auto-team/act`；既有 15 个动作语义不变。
- 确认执行与直接执行共用同一内部函数，保证「确认后行为 = 原本直接执行的行为」，不允许两套分支（AC-11 用矩阵逐条比对）。
- 弹窗：Web 层 `[role="dialog"]`，含动作名、对象 id、影响面一句话（「将中断成员 X，未提交改动可能丢失」）、「不可逆」徽标、确认/取消；Esc/取消 = 不执行；焦点进入弹窗；确认后 2 秒内状态变化。
- 待确认可见性：右栏页签标题与左栏项目行显示「待确认」标记；不改动胶囊与右栏注册链路（标记在面板/页面内部渲染，不动宿主 tab 注册 API）。

### 5.5 左栏栏目（F5）

- **入口**：`sidebar.panellist` 注册一行 `{ id, order, label:'自动团队' }`，图标由插件提供；点击打开 `main` 槽位页面（keyed，`key` 与 panellist `id` 同值）。不改右栏页签注册、不改胶囊。
- **布局**：左列 200–260px 项目列表，右列自适应详情；容器 <720px 折叠为单栏（列表 ↔ 详情 + 返回）。
- **项目列表**：第一行固定「全局」；其后为 runs 中记录的 `project.path` 去重（当前工作区即使 0 run 也在列）；排序＝最近活跃倒序；无 `project` 的 run 归「未知项目」并固定末位；同一路径只出现一次。
- **右列内容**
  - 选中「全局」：标题「全局记忆（public）」，public 轨记忆列表（建立/修改时间 + 估算 token），点开正文；提示「作用于所有项目」。
  - 选中项目：项目头（名称、路径、run 数、累计成员 token、最近活跃）；「任务」区（该项目**最近一次 run** 的 run 头 + 任务表，组件与右栏任务页同一套；该区标注 runId 与时间，不做 run 切换——历史回看由右栏历史页负责）；「项目记忆」区（project 轨列表 + 正文）。
  - 选中「未知项目」：路径显示「工作区不可得」，任务区给出该 run 的任务，记忆区显示「不可得（无工作区）」。
- **详情**：项目/任务/记忆三类行均可点开，详情在主区内展开（列表仍保留，返回不丢选中项）；任务详情字段同 5.1 行内展开。
- **数据来源**：`GET /api/auto-team/library?sessionId=`（可选 `runId`）返回项目列表、每项目最近 20 个 run 摘要与 50 条记忆索引；正文按需走既有 `GET /memory` 并新增 `workspace` 参数（必须是 library 中已知的工作区，否则拒绝，防路径逃逸）。**不新建数据库/索引文件**，项目归属只写回既有 `runs/*.json`。
- 历史性能：library 结果在宿主侧缓存（按 runs 目录 mtime/条目数失效），snapshot 的 2s 轮询不得触发 library 重算（沿用 memory.md「50/200/500 run ≈ 6.1/22.3/61.5ms」的性能债事实，100 run 冷启动 ≤1s）。

### 5.6 数据契约与组件复用（F6）

- 共享类型放 `src/shared/types.ts`（纯类型，双端可 import）：
  - `UsageCell { tokens?: TokenTotals; source: 'provider'|'unavailable'; reason?: string }`
  - `DurationCell { startAt?: number; endAt?: number; ms?: number; text: string; state: 'done'|'running'|'not-started'|'unavailable' }`
  - `TaskDetailView { id,title,roleId,status,dependsOn,acceptance,writeScopes?,evidence?,usage,duration,attempts?,waitReason? }`
  - `RunDetailView { runId,sessionId,project?,planStatus,plannedAt,finishedAt?,usage,duration,roles:RoleUsageView[],tasks:TaskDetailView[],flow:{nodes,edges},pendingConfirmation? }`
  - `LibraryView { projects: ProjectView[]; global: { memories: MemoryItemView[] }; currentProject? }`；`MemoryItemView { track,name,title,createdAt?,updatedAt,tokenEstimate,tokenBasis:'estimate' }`
- 装配只在一处：`src/client/viewmodel.ts` 的纯函数 `buildRunDetail(source, runId)`；右栏任务/历史详情与左栏项目详情都调用它，同一 run 归一化结果 deep equal。
- 组件单源：`src/client/views/` 下 `RunHeader`/`RoleStrip`/`TaskTable`/`FlowGraph`/`MemoryList`/`ConfirmDialog`/`DetailPane` 各 1 个定义，右栏与左栏只做组合，不复制实现。
- 格式化单源：时长由宿主 `formatDuration` 单点（client 零拼接）；token 千分位 `formatTokens` 单点；两者均被 AC-7/AC-20 静态断言保护。

### 5.7 UI 槽位选位（只读 `docs/teamflow/architecture/UI-SLOTS.md`，本轮禁调 `cordis_inspect_query`）

| 用途 | 槽位 | kind | scope | replaceRisk | 选位理由 |
|---|---|---|---|---|---|
| 左栏栏目入口 | `sidebar.panellist` | list | root | none | 文档中唯一「Global panel icons」全局图标行槽位，注册 `{id,order,label}`；同机样本 dshmarket 已用它实现左栏全局行 |
| 左栏栏目页面 | `main` | keyed | root | none | dshmarket 注释「Opening the row selects a `main` panel」，是承载整页两栏内容的既有容器；UI-SLOTS.md 缺此行，本轮补录（kind/scope/replaceRisk 以真机注册成功为准） |
| 右栏三页（沿用不动） | `sidebar.right.pane.tab` + `.title` + `sidebarRightTabs.register` | keyed | session | none | r6/r10 已定稿的三步链路，只改页签内容与数量，不改注册方式 |
| 角色管理（沿用） | `settings.section` | list | root | none | 角色编辑已在设置页，本轮只确保面板不再承载 |
| 确认弹窗 | 组件内渲染（不新占槽位） | — | — | — | 宿主无 modal 槽位；弹窗由已挂载的面板/页面渲染，未挂载时保持挂起不执行 |

**禁止**：`conversation.input.activity`、`conversation.session.header.corner`、`shell.leading`（shadows-shipped-ui）；新增挂载点必须 name 逐字等于槽位名、插件标识只进 `id`/`key`。

## 6. 形状扩张登记（逐条 + 理由）

| # | 扩张 | 理由 | 不变项 |
|---|---|---|---|
| 1 | `PanelAction` 18→21：`confirmPending` / `rejectPending` / `forceParallel` | 确认门禁必须有可执行/可拒绝通道；强制并行是用户显式越权，必须单列动作 | 既有 15 个动作语义与载荷不变，仍走 `/act` |
| 2 | HTTP 路由 3→4：新增 `GET /api/auto-team/library`（可选 `runId`） | 跨项目/历史/全局记忆无法从单会话快照取；一个路由同时承担项目列表、run 详情与记忆索引，避免路由爆炸 | 既有 3 条路由路径与参数不变；`/memory` 仅加 `workspace` 参数 |
| 3 | `RejectionCode` 12→13：`CONFIRM_REQUIRED` | 工具侧必须能区分「被规则拒绝」与「等待用户确认」 | 既有 12 个 code 语义不变 |
| 4 | `RunState` + `project?` / `finishedAt?` / `usage?` / `taskTimes?` / `pendingConfirmation?` / `forceParallel?` | 项目归属、历史用时、token 汇总、待确认与强制并行都必须跨重启存活 | `version` 仍 3（新增字段全可选）或升版必须带 v3→v4 迁移；`plan`/`messages`/`bindings` 结构不变 |
| 5 | `RunSummary` + `project?` / `plannedAt?` / `finishedAt?` / `usageTotals?` / `active` | 历史列表与左栏项目列表需要项目、起止与总量，避免逐 run 全量 `load()`（顺带缓解历史性能债） | `list()` 返回仍按时间倒序，摘要字段只增 |
| 6 | `PanelSnapshot` + `pendingConfirmation?` / `runUsage?` / `runDuration?` / `project?` | 面板任务页与确认弹窗需要当前 run 的用量、用时、项目与待确认 | 既有字段一个不改；空数组/缺省语义不变 |
| 7 | `MemoryFileInfo` + `createdAt?` / `tokenEstimate?` / `tokenBasis?` | 记忆页要求建立时间与 token 量，且必须标估算口径 | 既有 `track/name/chars/updatedAt` 不变 |
| 8 | 新增共享视图类型（`UsageCell`/`DurationCell`/`TaskDetailView`/`RunDetailView`/`LibraryView`/`MemoryItemView`） | 右栏与左栏共用一套契约（G6），禁止两套 | 纯类型，无运行时行为 |
| 9 | 新增 client 模块 `src/client/views/*`、宿主 `library` 装配与 `formatDuration` | 组件单源与单点格式化的落点 | 不改 `slots.ts` 既有常量；不改 `http.ts` 既有 handler |

**明确不变**：`ActivityEvent.kind` 仍 9（确认/等待记 `kind:'status'`）、`TaskStatus` 仍 13、`PlanStatus` 仍 5、`TaskStatus` 文案单源不变、工具仍 8、`setInterval(` 仍 1、`sessionOf` 仍 1 处、`PlanTask` 字段集合不变、r6/r10 胶囊与三步注册逐字不变。

## 7. 优先级

- **P0**：AC-1~AC-22、AC-24~AC-28（三页、token/用时、流转图、自动派发、确认门禁、左栏、契约、形状登记、回归与真机）。
- **P1**：AC-23（历史性能缓存与 100 run 探针）。
- **P2**：流转图键盘可达（焦点顺序、`aria-label`）与窄屏折叠动画；不进本轮 AC。

## 8. 依赖与风险

| 编号 | 依赖/风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 成员会话 usage 能否按成员归属未验证（候选三条） | 任务级 token 可能只能「不可得」 | 探针先行（AC-19）；三态都能落地；UI 的「不可得」路径独立可交付 |
| R2 | `main` 槽位是否对第三方插件开放（UI-SLOTS.md 未收录，仅有 dshmarket 同机样本） | 左栏栏目页面可能开不出来 | 真机先验（AC-25）；失败降级 `sidebar.footer.action` 打开右栏历史页，并如实记「未验证」 |
| R3 | run 创建时能否拿到工作区绝对路径 | 项目归并退化为「未知项目」 | 探针验证；取不到按未知项目渲染并给出可读原因（AC-15） |
| R4 | 自动派发与并发/写域竞态 | 超并发或重复成员 | 单飞 mutex + 幂等条件 + 复用 `dispatchReady` 四道闸（AC-9、AC-10） |
| R5 | 历史 run 数量增长导致 library 变慢 | 首屏 >1s | 按目录 mtime 缓存 + `RunSummary` 预聚合（AC-23） |
| R6 | 旧 run 无新字段 | 历史详情显示异常 | 全部字段可选，缺失即「不可得/未知项目」（AC-20、AC-21） |
| R7 | 面板未打开时危险动作无人确认 | 任务看似卡住 | 工具返回 `CONFIRM_REQUIRED` 并提示去面板；面板/左栏显示「待确认」标记；未决不自动执行（AC-13） |
| R8 | 改面板页签数量触碰 r6/r10 链路 | 页签不出现 | 只改 `TABS` 与页签渲染，不改 `sidebarRightTabs.register` 与两挂载点（AC-24、AC-26） |

## 9. 里程碑建议

- **M1 契约与探针**：共享视图类型、`RunState/RunSummary` 可选字段、token/用时探针实跑、形状登记落表（AC-19~AC-22）。
- **M2 自动派发**：5 个触发点、单飞幂等、四道闸、失败可见（AC-8~AC-10）。
- **M3 确认门禁**：`pendingConfirmation`、3 个动作、危险/可逆矩阵、`ConfirmDialog`（AC-11~AC-13）。
- **M4 三页与流转图**：页签收敛、任务/历史/记忆页、token/用时单元、自绘 DAG（AC-1~AC-7）。
- **M5 左栏与 library**：panellist + main、项目列表、全局/项目切换、三类详情、缓存（AC-14~AC-18、AC-23）。
- **M6 真机与收口**：第二宿主 CDP 断言、回归五项、单笔提交与文档回填（AC-24~AC-28）。

## 10. 验收标准

| AC | 判据（可执行 / 可观察） | 证据 | 优先级 |
|---|---|---|---|
| AC-1 | 面板 `data-tab` 恰为 `tasks`/`history`/`memory` 三项且顺序如此；`[data-tab="plan"]`/`"members"`/`"roles"` 节点数 0；`PlanTab`/`MembersTab`/`RolesTab` 在面板挂载点 grep 0；角色管理仍能从设置页打开 | 组件单测 + 真机 DOM | P0 |
| AC-2 | 任务页三区块齐备：`[data-region="task-roles"]`（角色名+模型+成员数，集合等于该 run 成员角色集合）、`[data-region="task-list"]`、`[data-region="task-flow"]` 均非空 | 夹具单测 + 真机 | P0 |
| AC-3 | 任务列表每行恰 1 个 `[data-cell="token"]` 与 1 个 `[data-cell="duration"]`；token ∈ {千分位数字, 「不可得」}，duration ∈ {时长文本, 「未开始」, 「不可得」}；无 usage 夹具渲染「不可得」且 `data-usage-source="unavailable"`；有 usage 夹具数字逐项等于注入值；**同一夹具只改任务标题字符数，token 数字必须不变**（反字数估算） | 夹具单测 + 真机 | P0 |
| AC-4 | 流转图节点数 = 任务数、边数 = Σ`dependsOn`；每节点 `[data-flow-node="<taskId>"]` 且含 token/用时文本；上游所在列严格小于下游列；无第三方图形库（`package.json` 无新增 dependency，源码无 `d3/mermaid/cytoscape/dagre` import） | 结构断言单测 + 真机截图 | P0 |
| AC-5 | 历史页首屏条数 = min(50, run 文件数)，可「加载更多」；点第 2 条 run 后任务 id 集合 = 该 run 文件内容且 ≠ 第 1 条；页头 runId = 第 2 条；返回后列表滚动位置保持 | 2 run 夹具单测 + 真机 | P0 |
| AC-6 | 记忆页只列 project 轨：夹具含 public `PUBLIC-ONLY` 与项目 `PROJECT-ONLY`，DOM 含后者、不含前者；每行含建立时间、最近修改时间、`≈N token` 且 `title` 含估算公式；点开正文与磁盘文件字节相等（含换行）；用未知/非法 `workspace` 请求项目记忆被拒，读不到任意目录 | 夹具单测 + 真机 + 文件字节比对 | P0 |
| AC-7 | 同一 run 在右栏任务页与左栏项目页的 token/用时文本逐字相等（归一化后 deep equal）；`RunDetail` 类组件定义仅 1 处、两处各 1 处 import；client 内无第二套时长格式化（`分`/`小时` 拼接 grep 0） | 静态 grep + 单测 | P0 |
| AC-8 | 计划落盘后零用户动作：fake host 上写 plan 后 3 秒内 spawn 调用 ≥1，期间 `dispatch` action 调用数 0；移除 5 个触发点中任一个（plan 落盘/任务终态/成员退出/add_tasks/watcher tick）该用例必红（5 组变异） | 集成测试 + 变异 | P0 |
| AC-9 | 自动派发受四道闸约束：maxConcurrent=1 且 3 个就绪任务 → 同时仅 1 个 running；上游未终态 → 下游 spawn 0；写域冲突 → 任务 `waiting` 且 spawn 0；`paused` → spawn 0；解除后自动补齐 | 集成测试 4 例 | P0 |
| AC-10 | 缺 `runId` 或未知 `runId` 的 `auto_team_dispatch` 被拒；对已完成自动派发的 run 再调 dispatch → 新增成员 0；工具总数 8；`sessionOf` 1 处 | 单测 + 计数探针 | P0 |
| AC-11 | 5 类危险动作未确认时：`pendingConfirmation` 出现、run 文件 sha 与成员数不变、任务状态不变；确认后行为矩阵逐条生效；拒绝后清除待确认且状态仍不变（每类确认/拒绝各 1 例，共 10） | 集成测试 + 文件 sha | P0 |
| AC-12 | 7 类可逆动作（dispatch/resume/resumeTeam/receipt/saveMemory/saveRole/saveSettings）无 `pendingConfirmation`、无 `[role="dialog"]`，2 秒内状态改变 | 集成测试 + 真机 | P0 |
| AC-13 | 弹窗含动作名、对象 id、影响面一句话、「不可逆」徽标；Esc/取消不执行；确认 2 秒内生效；同 run 已有未决时再次请求返回同一 `pendingId` 且弹窗仍只 1 个；未决不自动过期/不自动执行，界面显示已等待时长 | 单测 + 真机 | P0 |
| AC-14 | 左栏出现 `[data-auto-team-nav]`（label「自动团队」），点击打开 `main` 页面；页面含 `[data-region="project-list"]` 与 `[data-region="project-detail"]`；容器 <720px 折叠单栏且有返回 | 真机 DOM | P0 |
| AC-15 | 项目列表首行固定「全局」；其余 = runs 的 `project.path` 去重 ∪ 当前工作区；无 project 的 run 归「未知项目」且末位；同路径仅 1 行；活动前后 `~/.dsh/auto-team/` 与项目 `.auto-team/` 无新增非 runs/非记忆文件（不新建数据库） | 夹具 + 文件清单 diff | P0 |
| AC-16 | 切「全局」→ 右列出现 public `PUBLIC-ONLY`、不出现 `PROJECT-ONLY`；切回项目 → 反向断言成立（两边内容不同即可分辨） | 夹具单测 + 真机 | P0 |
| AC-17 | 项目/任务/记忆三类行均可点开详情：项目含路径、run 数、累计 token、最近活跃；任务含标题/状态/角色/验收命令/证据/依赖/写域/token/用时；记忆显示全文；详情有返回且返回后列表与选中项仍在 | 单测 + 真机 | P0 |
| AC-18 | 共享契约定义在 `src/shared/types.ts`；client 侧仅 `buildRunDetail` 一个装配函数，右栏与左栏均 import 它；同一 run 夹具两边归一化视图 deep equal | 静态 grep + 单测 | P0 |
| AC-19 | 探针可复跑并打印三条候选 PASS/FAIL 与结论行 `ATTRIBUTION=per-member|aggregate-only|unavailable`；TECHNICAL 含「已验证」「未验证」两节，每条附命令与返回尾部；结论为 unavailable 时快照 `usage.source='unavailable'` 且 UI「不可得」不回退估算 | 探针实跑 + 文档 | P0 |
| AC-20 | 用时口径写死并落盘（run=plannedAt→finishedAt、任务=首成员 spawnedAt→首个终态、成员=spawnedAt→退出）；新建 store 实例重读同一 run，历史详情时长逐毫秒相同；旧 run 缺字段显示「不可得」而非 0；`formatDuration` 仅宿主 1 处定义 | 重启等价单测 + 静态 grep | P0 |
| AC-21 | 新增 `RunState`/`RunSummary` 字段全可选：旧 v3 夹具加载成功并渲染「未知项目/不可得」，保存后不得伪造 0；`version` 仍 3，或升版必须带 v3→v4 迁移且旧夹具读回逐字段等价；截断/缺字段 `load()` 不抛错 | 单测 | P0 |
| AC-22 | 形状计数探针：`PanelAction` 21、HTTP 路由 4、`RejectionCode` 13、工具 8、`TaskStatus` 13、`ActivityEvent.kind` 9、`PlanStatus` 5、`setInterval(` 1、`sessionOf` 1；任一不符红；TECHNICAL 登记表与代码逐项一致 | 静态计数探针 | P0 |
| AC-23 | 100 个 run 文件下 `GET /library` 冷 ≤1s、同参热 ≤100ms；2s snapshot 轮询期间 library 装配调用 0、snapshot 延迟增幅 <20%；切页签不触发整页重挂载 | 性能探针 | P1 |
| AC-24 | 源码 `sidebar.panellist` 与 `main` 各 1 处注册且 id 同值；未使用三个 shadows-shipped-ui 禁用槽位（grep 0）；UI-SLOTS.md 增 `main` 行并写明 kind/scope/replaceRisk/理由；本轮无 `cordis_inspect_query` 调用记录 | 静态 grep + 文档 diff | P0 |
| AC-25 | 克隆 profile 起第二宿主（端口 51890）+ CDP 脚本断言 AC-1/3/5/6/8/11/13/14/16 的 DOM 事实；环境失败时 QA-REPORT 记「未验证」并附原始错误，禁止 mock 顶替 | 真机脚本输出 | P0 |
| AC-26 | 回归：`pnpm -s test` ≥565 且 fail 0；`pnpm typecheck` exit 0；`pnpm build` 成功；`find src -newer lib/index.js` 与 `-newer lib/client.js` 均为空；两条 `await import` exit 0；`npm pack --dry-run` 含 3 条目；`dependencies` 仍为空、无新增运行时依赖 | 命令实跑 | P0 |
| AC-27 | 留在 `feat/auto-team-plugin`；工作树原有 2 个未跟踪 docs 目录随本轮入库；单笔提交；提交后 `git status --porcelain` 空；`.gitignore` 补 `.pnpm-store/`、`*.log` 且无噪声；提交 hash 与门禁数字写入报告 | 命令实跑 | P0 |
| AC-28 | memory.md 在「调度与写域口径」段内以同主题行替换（自动派发/确认门禁/三页面板与左栏/token 与用时口径），无变更日志式追加；AGENTS.md 正文与 r6/r10 胶囊、右栏三步注册链路逐字不动（`git diff` 证明） | git diff | P0 |

**可分辨性判据（防假绿，最低要求）**

1. `data-tab` 只有任务/历史/记忆三项，旧三页签节点数 0（AC-1）。
2. 任务列表每行都有 token 与用时单元格，数值或明确「不可得」（AC-3）。
3. 历史页点第二条 run 后任务 id 集合与第一条不同（AC-5）。
4. 记忆页只出现 project 轨，public 夹具不出现；正文与磁盘逐字一致（AC-6）。
5. 计划落盘后零用户动作，任务在断言窗口内从 pending 变 running/dispatching（AC-8）。
6. 「取消在跑成员」未点确认时不得执行（成员仍在、run 文件 sha 不变）（AC-11、AC-13）。
7. 左栏切「全局」→ 列表来源变成 public，切回项目 → 变回该项目 project 轨（AC-16）。

## 11. 假设与待澄清

- **（fact）成员 token 归属**：假设根级 `session/event` 或 `subagents`/`agents` 服务能按成员归属 usage；若三条候选全部证否，则按「聚合不可得」落地——只显示 run 合计或全部「不可得」，绝不以字数或成员数估算补位。变化：任务行 token 列全部「不可得」，AC-3/AC-19 走不可得路径，G2 只剩用时与 run 合计。
- **（fact）run 的工作区路径**：假设 run 创建时能从宿主拿到会话工作区绝对路径（宿主 workspace 服务或会话字段）；取不到则按「未知项目」归并，左栏项目维度退化但页面仍可用。变化：项目列表趋于「全局 + 未知项目」，AC-15 的「当前工作区在列」仅在有路径时成立。
- **（fact）`main` 槽位可用性**：UI-SLOTS.md 未收录该槽位，唯一证据是同机 dshmarket 样本；假设对第三方插件开放。若真机注册失败，降级为 `sidebar.footer.action` 打开右栏「历史」页，并在 QA-REPORT 记「左栏栏目未验证」。
- **（taste）详情呈现方式**：列表行点开用「主区内联展开 + 返回」，还是「浮层抽屉覆盖列表」？推荐内联展开：返回后选中项与滚动位置天然保留，且窄栏折叠时同一套逻辑可用。
- **（taste）项目排序**：推荐最近活跃倒序、未知项目置底；另一种是名称字母序（稳定但与「最近在看哪个项目」无关）。
- **（taste）历史列表上限**：推荐全量 + 50/页加载更多；另一种是固定只保留最近 50 条（简单但可能看不到老 run）。
- **（taste）未决确认的可见性**：面板未打开时推荐挂起等待（不自动执行、不自动丢弃，打开即见）；另一种是超时后自动丢弃（不会积压，但危险动作请求会被静默作废）。默认同 run 至多 1 条未决。
- **（taste）改已完成任务验收命令后的处理**：推荐确认后重跑门禁（失败转 `rework`，成功保持 `done` 并更新证据）；另一种是只改记录不重跑（不影响在跑工作，但「已验收」与命令脱节）。

## 12. 工程约束

- **分支**：留在 `feat/auto-team-plugin`（基线 HEAD `0d87357`），不新开分支、不 rebase、不 force push。
- **未提交改动**：工作树现有 `docs/teamflow/20261103-r12-panel-three-tabs/`（已取消需求的留档）与 `docs/teamflow/20261103-r13-panel-tabs-sidebar/`（本需求产物）两个未跟踪目录，随本轮收口提交一并入库；不删除、不改写 r12 内容、不为 r12 补产物。
- **提交时机**：P0 AC 全绿后**单笔提交**，信息形如 `feat(panel): 三页面板 + 自动派发 + 左栏栏目（r13）`；提交前跑 AC-26 五项门禁 + AC-19 探针，提交后 `git status --porcelain` 必须为空。
- **`.gitignore` 审计（dev 阶段动作）**：现有已覆盖 `logs/teamflow/`、`node_modules/`、`*.tsbuildinfo`、`coverage/`、`dist/`、`.DS_Store`、`.auto-team/`、`*.tgz`、`pnpm-debug.log*`、`.vscode/`、`.idea/`、`.env*`、`.dsh-code-index/`；本轮补 `.pnpm-store/`、`*.log`（根目录探针/构建日志），并确认 `lib/` 与 `docs/` 不被忽略（分发源与任务夹都入库）。判据：提交前 `git status --porcelain` 只出现预期文件。
- **只改本仓库**：不动 `~/.dsh/profiles/desktop` 的安装；真机验证只把 profile 克隆到临时目录起第二宿主（端口 51890）。
- **不改既有定稿链路**：输入框胶囊（`conversation.input.left`，r6 定稿）与右栏页签三步注册（`sidebar.right.pane.tab` + `.title` + `sidebarRightTabs.register`，r6/r10）逐字保留；面板只改页签集合与内容。
- **UI 槽位纪律**：只许用 `replaceRisk=none` 的槽位，**禁止再调 `cordis_inspect_query` 查槽位**（一律读 `docs/teamflow/architecture/UI-SLOTS.md`）；左侧栏栏目同样先在该文档挑槽位并写明选中理由与 kind/scope。
- **零新增运行时依赖**：流转图 SVG/div 自绘；`package.json` 的 `dependencies` 保持为空。
- **探针纪律**：探针与检查脚本只放 `logs/teamflow/<runId>/scripts/`，用 `new URL('../../../../', import.meta.url)` 锚定仓库根，支持 `--mutate` 变异；不得在项目根散落脚本或日志。
- **文档边界**：本需求所有产物只写 `docs/teamflow/20261103-r13-panel-tabs-sidebar/`；跨需求只回填 `docs/teamflow/memory.md`（同主题行替换）与 `architecture/UI-SLOTS.md`（补 `main` 行）；AGENTS.md 除托管区外不改一字。
