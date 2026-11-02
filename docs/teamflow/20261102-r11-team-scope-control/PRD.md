<!-- meta: summary="让自动团队把简单任务也派给成员、支持向进行中的计划追加任务、用写域互斥与释放通知管理文件冲突、面板显示占用与等待、队长亲手写文件留痕，并支持单任务取消/跳过/改验收" -->
基线依赖：docs/teamflow/20261102-r10-autoteam-skills-toolbar（r10 的开关迁移、头部三段分区、模型弹层、11 角色 12 技能全链路必须不回归）
取代：docs/teamflow/20261101-r7-auto-team-panel-roles#AC-10：`PlanTask` 由「不新增字段」改为新增可选 `writeScopes`；`TaskStatus` 由冻结 10 态改为 13 态（新增 `waiting` / `cancelled` / `skipped`）；`ActivityEvent.kind` 仍 9 种、HTTP 路由仍 3 条不变。
取代：docs/teamflow/20261101-r7-auto-team-panel-roles#AC-14：状态标签由「`TaskStatus` 10 态全覆盖」改为 13 态全覆盖，状态→标签与进度仍只在 `progressOf(task)` 一处映射。
取代：docs/teamflow/20261102-r10-autoteam-skills-toolbar#AC-25：`PanelAction` 由冻结 15 改为 18（+`cancelTask` / +`skipTask` / +`updateAcceptance`）；工具由 7 个改为 8 个（+`auto_team_add_tasks`）；`setInterval` 仍 1 处、四常量各 1、路由仍 3 条。
取代：docs/teamflow/20261030-r1-auto-team-plugin#AC-13：计划任务字段在 `{id,title,roleId,dependsOn,acceptance}` 之外追加可选 `writeScopes`，原五字段语义不变。

# 自动团队 r11：简单任务接单、续派、写域互斥与单任务干预

## 1. 背景与目标

自动团队今天能拆任务、并行派成员、跑门禁，但在「日常小活」上有四个断点，全部来自实测源码而不是猜测：

1. **简单任务被队长自己干了**。队长常驻提示词的硬约束只有「不亲自干细活 / 只做三件事 / 不同步等长任务」（`src/host/prompt.ts` 的 `CAPTAIN_CONSTRAINTS`）与 7 条工作方式（「先 plan 再 dispatch」），没有一句说「只有一件事也必须走团队」。机制上单任务计划是合法的（`buildPlan` 不设最少任务数），所以问题纯在提示词与工具描述。
2. **写不出验收命令就必然过不了门禁**。`src/host/gate/gate.ts:49` 空 `acceptance` 直接 `ok:false`，文案只有「该任务没有验收命令，需要人工确认后放行」——它告诉用户"不行"，却没告诉用户"该写什么"。
3. **「继续追加任务」是假支持**。`auto_team_plan` 每次都新建 runId，而 `src/host/bridge.ts:358` 的 `loadState = store.latestForSession(sessionId)` 只取最新一个 run —— 用户中途追加任务，等于把旧 run 从面板上抹掉。
4. **改同一批文件的成员互相踩**。`PlanTask`（`src/shared/types.ts:63`）没有写域声明，任务状态里没有「被资源挡住」，成员之间也没有通道，冲突只能靠人盯。

本期目标（八条一起做完，无一条可裁）：

- **F1** 简单任务也派一个成员去做，队长不自己动手；
- **F2** 写不出验收命令时，自动给出**可直接执行**的轻量验收模板（grep / git diff / 该仓库真实存在的 lint），选不出就明说「选不出」；
- **F3** 任务没跑完时可以往当前计划继续追加任务（同 runId、幂等、可派发）；
- **F4** 任务用写域声明让改同一批文件的成员互斥等待，释放后通知等待者；
- **F5** 释放通知走既有 `messages` 账本，不新开投递通道；
- **F6** 面板显示「谁占着什么、谁在等谁」；
- **F7** 队长亲手改文件时留下可查痕迹（软约束，**不阻断**）；
- **F8** 支持单任务级取消 / 跳过 / 改验收。

产品语义一句话：**团队从此对"一件小事"与"一串任务"是同一套机制——一律派成员、写域可声明、状态可等待、账本可追溯、任何一层都能被单独干预。**

## 2. 用户故事

| # | 故事 | 可测验收要点 | 对应 AC |
|---|---|---|---|
| US-1 | 作为用户，我随口让它改一个错别字，它也会派一个成员去做，而不是自己动手 | 提示词含可 grep 的硬规则句；单任务计划可 dispatch 并产生 1 个成员 | AC-1~AC-3 |
| US-2 | 作为队长，我写不出验收命令时，希望它直接给我一条能抄就走、走得通的命令 | 三条模板各自在构造的成功样本上 exit 0、失败样本上非 0；选不出时明确说「选不出」并列出需要补的参数 | AC-4~AC-7 |
| US-3 | 作为用户，任务跑到一半我又想到两件事，能直接追加进同一个计划，面板不会跳回空白 | 连续追加两次同批任务：第二次 `added=0`、`tasks.length` 不变、runId 不变；新任务可被下一次 dispatch 捕获 | AC-8~AC-11 |
| US-4 | 作为成员，我要改的文件正被别人改，我应当排队而不是覆盖，并且能看见我在等谁 | 冲突任务置 `waiting` 且不占并发；`waitReason` 逐字含持锁任务 id 与路径 | AC-12~AC-17 |
| US-5 | 作为等待的成员，对方一释放我就收到一条「你接着改」，且我不会被重复吵 | 同一次释放同一等待者恰 1 条消息，重放/resume 后仍 1 条 | AC-18 |
| US-6 | 作为用户，我在面板上能一眼看出谁占着什么、谁在等谁 | `[data-scope-locks]` 区块 + 任务行 `[data-wait-reason]` 逐字断言；空矩阵不渲染空壳 | AC-19~AC-21 |
| US-7 | 作为用户，我能查到队长什么时候亲手写了哪个文件、为什么 | 留痕字段含时间/会话/工具/路径/原因摘要；面板 `[data-deviation]` 可见；记录失败不阻断 | AC-22~AC-24 |
| US-8 | 作为用户，某个任务跑歪了，我能只处理它——取消、跳过、或改它的验收命令 | 三个新动作各有允许/拒绝两面；面板按钮的 disabled 矩阵与允许集一致 | AC-25~AC-27 |

## 3. 范围与非目标

**范围内**：F1~F8 的行为与对应形状扩张；本需求的 PRD / TECHNICAL / QA-REPORT / ACCEPTANCE；`docs/teamflow/memory.md` 的本轮约定回填；`plugin-full` 交付契约八条。

**非目标（明确不做）**：

- 不做跨 run 的任务搬迁/合并：`add_tasks` 只追加到**当前** run；已终止 run 一律拒绝。
- 不做自动重排与自动改计划：追加/取消/跳过都是用户或队长的显式动作，系统只做合法性校验。
- 不做多写者协同编辑（合并、补丁、CRDT）：冲突只做**互斥排队**，不做共享写入。
- 不给 `bash` 写文件做留痕（`sed -i` / 重定向无法可靠判读），只记 `write` / `edit` 两个工具。
- 不新增第 9 个工具、不新增 HTTP 路由、不新增 `ActivityEvent.kind`、不新增面板槽位注册。
- 不改 `~/.dsh/profiles/desktop` 的安装（安装步骤写给主 agent 执行）。
- 不做跨会话/跨 run 的锁（锁只在一个 run 内成立）。
- 不把等待关系做成持久锁表（重启按计划顺序重算，见 AC-16）。

## 4. anti-goals / 反面目标

即使门禁全绿，下面任意一条发生，这个需求就该被拒收：

1. **追加之后面板上的任务变少或消失**：用户点「追加」，`tasks.length` 没增加，或 runId 变了导致旧任务从面板消失。技术上是"实现了 add_tasks"，产品上是"我的任务丢了"。判据：追加前后的快照 `runId` 与任务集合逐项对比，必须只增不减。
2. **团队卡死且说不出原因**：两个任务互相等待，面板只有「等待中」，既没有「等谁」也没有「等哪条路径」，用户除了取消整队没有别的选择，且 3 分钟无任何推进。判据：任一 `waiting` 任务必须同时给出持锁任务 id 与冲突路径，否则视为卡死。
3. **静默重复**：同一批任务重复追加产出重复任务，或同一次释放给同一个等待者刷出多条通知，把账本和面板灌满。判据：重复调用与重复释放后计数不增长。
4. **给了必然失败的验收模板**：模板里出现本仓不存在的 `pnpm lint`、或方向反了的 `git diff --quiet`（在正确实现上反而 exit 1），成员干完仍被门禁拒，而用户以为"系统给了可用命令"。判据：每条模板必须在"应当通过"的样本上 exit 0、在"应当失败"的样本上非 0。
5. **留痕变成噪音或变成阻断**：队长每写一次文件就记一条把面板淹掉，或记录本身失败把队长这次写入打断（fail-open 破了）。判据：60 秒内同键重复写合并为一条并累加次数；注入写盘失败后工具仍放行。

## 5. 交互流程摘要

**简单任务**：队长 `auto_team_plan`（1 个任务，可带写域）→ `auto_team_dispatch`（带 runId）→ 1 个成员干活 → `auto_team_receipt` 过门禁。全流程与多任务计划同构，没有"小活特权路径"。

**续派**：run 进行中，队长 `auto_team_add_tasks`（runId + 新任务）→ 校验（依赖可指向既有或同批、图无环、幂等、run 未终止）→ 原子追加 → 面板任务数增加、runId 不变 → 下一次 `auto_team_dispatch` 自动把新 ready 任务派出去。

**写域互斥**：队长在任务上声明 `writeScopes: ["src/host/plan"]` → 派发时先做冲突检查 → 被占则任务置 `waiting`、记录「等待 t2 释放 src/host/plan/graph.ts」、不占并发名额 → 持锁任务进入终态（done/failed/cancelled/skipped/interrupted）→ 释放写域 → 给等待者写一条 `messages` 记录（一次一条）→ 等待者在下一轮推进中按计划顺序重新评估，可转 `ready`/`running`。

**单任务干预**：面板计划页每任务行三个动作——取消（连带中断成员、释放写域、下游转 `blocked` 并说明「上游已取消」）、跳过（视为不再执行、下游依赖视为满足、释放写域）、改验收（弹层填写，空值不可提交，下次门禁即用新命令）。非法状态按钮 `disabled` 且 `title` 说明原因。

**队长留痕**：队长调用 `write` / `edit` → 记录一条 deviation（时间/会话/工具/路径/原因摘要）→ 面板「执行痕迹」区块可见；同一 (工具, 路径集合) 60 秒内合并计数；记录失败只 warn，绝不改变工具结果。

**验收模板**：`auto_team_plan` / `auto_team_add_tasks` 收到空 `acceptance` → 拒绝整批并给出 ① 违规任务 id ② 三条模板原文 ③ 若可自动选一条，给出带参数的完整命令；`runGate` 空验收分支保留原文案并追加三条模板。

## 6. 验收标准（AC）

> 全部 AC 在本文件夹内独立编号。`A→B` 表示"把实现改回旧逻辑后该断言必须变红"（变异自检，报告需贴红/绿两段相反实跑输出）。

### 6.1 F1 简单任务也走团队

| AC | 判据（可测/可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-1 | `captainSection()` 输出含两条可 grep 的中文硬规则句：① 语义「简单任务/只改一处也必须派一个成员，队长不自己动手」；② 语义「只拆 1 个任务也是合法计划」。`test/captain.test.ts` 新增两条 `assert.match`；段落总长仍 ≤ 2600 字符（r5 AC-1 预算不变）。删掉任一句 → 断言红 | 单测 + 变异自检 | P0 |
| AC-2 | `auto_team_plan` 工具的 `description` 含一句明确「单任务计划合法、简单任务也走团队」的说明；单测读取工具定义断言正则命中 | 单测（读 tools 注册表） | P0 |
| AC-3 | 用假 ctx 起完整装配，构造 1 任务计划 → `auto_team_dispatch` 成功且 `members.length === 1`、`run.plan.tasks.length === 1`；不因任务数 < 2 被拒 | e2e（fake ctx + 真 store） | P0 |

### 6.2 F2 验收模板

| AC | 判据（可测/可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-4 | 新纯函数模块（建议 `src/host/plan/acceptance.ts`）导出 `suggestAcceptance(input)`，对三类输入各返回一条**可直接执行**的命令，且不含「人工检查」「请确认」等非命令字样：① 改代码型（有 `writeScopes` 且仓库 `package.json` scripts 存在 `lint`/`typecheck`/`test` 之一）→ `pnpm <script>`（本仓实际解析为 `pnpm typecheck`，**禁止**臆造 `pnpm lint`）；② 存在性型（任务标题/描述含反引号包裹的标识符）→ `grep -RIn --fixed-strings '<标识符>' <scope> >/dev/null`；③ 范围型（有 `writeScopes` 无标识符）→ `test -n "$(git status --porcelain -- <paths>)"`。每条模板必须在构造的"应当通过"样本上 `bash -c` 真跑 exit 0、在"应当失败"样本上 exit ≠ 0（不许必然失败，也不许必然通过） | 单测 + 真实执行 6 次 | P0 |
| AC-5 | 输入不足以选出一条（无写域、无标识符、仓库无可用 script）→ 返回 `command: null` 且 `reason` 含「选不出」三字 + 三条模板原文 + 需要补的参数名（`标识符` / `路径` / `脚本名`）；**不得**返回任何命令。断言 `command === null` 且 reason 逐字含三条模板 | 单测 | P0 |
| AC-6 | `auto_team_plan` 与 `auto_team_add_tasks` 收到空 `acceptance` 的新任务 → 整批拒绝、不落盘（`store` 内容不变），错误文本含违规任务 id + 三条模板命令原文（+ 可自动选中时的完整命令）。既有 3 处直接构造 `acceptance: ''` 的测试样本（bridge/member-prompt/viewmodel）不受影响 | 单测 + store 未改动断言 | P0 |
| AC-7 | `runGate('')` 的 `EMPTY_ACCEPTANCE_TAIL` 原文「该任务没有验收命令，需要人工确认后放行」逐字保留（向后兼容），其后追加一段含三条模板命令的说明；`ok:false` 与 `exitCode:-1` 语义不变 | 单测（逐字断言） | P0 |

### 6.3 F3 续派：add_tasks

| AC | 判据（可测/可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-8 | 新增第 8 个工具 `auto_team_add_tasks`，入参 `{ runId: string, tasks: PlanTaskInput[] }`；会话 id 只经 `src/host/tools.ts` 的 `sessionOf(value)` 获取（`grep -rn "agent?.id" src/host` 命中共 1 处）；工具注册后工具总数 === 8 | 单测 + grep 计数 | P0 |
| AC-9 | 追加语义：① 同批任务连续追加两次 → 第二次 `added === 0`、`tasks.length` 不变、`runId` 不变（幂等键 = 任务内容指纹，见 T8）；② 新任务 id 遵循 `buildPlan` 规则（缺省 `t<next>`，不与既有冲突）；③ `dependsOn` 可指向既有任务或同批新任务；④ 未知依赖 / 自我依赖 / 环 → **整批**拒绝，一条都不落盘（原子） | 单测 4 组 + 变异（去幂等键 → 第二次 added=1 红） | P0 |
| AC-10 | 对已 `cancelled` / 已全部完成（terminated）的 run 追加 → 失败，`reason` 含 runId 与当前状态的中文（例：「该 run 已取消，不能再追加任务」），store 不被修改 | 单测 2 例 | P0 |
| AC-11 | 追加后 `GET /api/auto-team/snapshot` 的 `tasks.length === 追加前 + added`、`runId` 不变、run 数量不变（不新建 run）；新任务可被下一次 dispatch 捕获并产生成员 | e2e（fake ctx 真 HTTP 请求） | P0 |

### 6.4 F4 写域互斥与 waiting

| AC | 判据（可测/可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-12 | `PlanTask` 新增可选 `writeScopes?: string[]`；归一规则写死：去 `./` 前缀、折叠连续 `/`、去尾 `/`、一律相对仓库根；空数组 = 不限（不参与互斥）；非法输入（绝对路径、含 `..` 逃出根、空串元素）→ 拒绝并给可读原因码 | 单测归一真值表 + 非法 3 例 | P0 |
| AC-13 | 冲突判定采用「路径相等或**目录边界**前缀包含」：`a` 与 `b` 完全相同 → 冲突；`src/host` vs `src/host/bridge.ts` → 冲突；`src/host` vs `src/hostile.ts` → **不冲突**（无 `/` 边界）。真值表 ≥ 6 组含反例，逐条断言；改成裸 `startsWith` → 反例必红 | 单测 + 变异自检 | P0 |
| AC-14 | 新增 `TaskStatus.waiting`；任务在**开跑前**发现写域被 running 任务占用 → 置 `waiting`，**不 spawn 成员、不占 `maxConcurrent` 名额、不计入 running 数**；任务上带 `waitingOn: string[]`（持锁任务 id）与 `waitReason`（中文，逐字样例：「等待 t2 释放 src/host/bridge.ts」）。并发上限已满时，等待任务转 ready 仍按既有名额排队 | 单测 + e2e（成员数只 +1） | P0 |
| AC-15 | 持锁任务进入任意终态（`done`/`failed`/`cancelled`/`skipped`/`interrupted`）→ 写域立即释放；`waiting` 任务在下一轮推进中按计划顺序重评估，可转 `ready`（或直接 `running`）；不抢占已 running 任务。5 种终态各断言一次释放；只在 `done` 释放 → failed 用例必红 | 单测 5 例 + 变异 | P0 |
| AC-16 | 等待关系**不落盘为锁表**：`RunState` 载入后按计划顺序重算冲突。进程重启（新 store 实例读同一文件）后同一 A/B 场景的 waiting 关系不变，A 结束后 B 可推进（无锁泄漏） | 单测（写盘 → 新实例读回） | P0 |
| AC-17 | 不变量：任一 `waiting` 任务的 `waitingOn` 必须全部指向 `status === 'running'` 的任务（结构上排除 A 等 B、B 等 A 的死锁）；同批新任务写域彼此重叠时**不拒绝**，按 id 顺序串行（第一个 running、其余 waiting）。断言任意快照下该不变量成立，且不存在「双 waiting 且无 `waitReason`」 | 单测（随机图 + 3 组构造）+ 不变量断言 | P0 |

### 6.5 F5 释放通知

| AC | 判据（可测/可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-18 | 释放时对每个等待者写**恰好一条** `MessageRecord`（`from` = 队长、`to` = 等待者成员名、`taskId` = 等待者任务 id，语义沿用现有字段），正文含释放者任务 id + 释放的路径 + 「可以接着改」。不新增投递通道（HTTP 路由仍 3、无新 action）；幂等键 = (holderTaskId, waiterTaskId, releaseSeq)，同一释放重放/resume 不重复投递。断言连续两次触发释放后该对消息计数仍 === 1 | 单测 + e2e 快照断言 | P0 |

### 6.6 F6 面板可见性

| AC | 判据（可测/可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-19 | 快照新增 `scopeLocks: Array<{ path, holderTaskId, holderMember?, waiters: Array<{ taskId, member?, reason }> }>` 与任务级 `waitingOn` / `waitReason`；**文案由宿主生成**（client 零拼装）；无占用时为空数组 | 单测（结构 + 文案逐字） | P0 |
| AC-20 | 计划页渲染 `[data-scope-locks]` 区块：每行含 `[data-lock-path]`、`[data-lock-holder]`、`[data-lock-waiter]`；任务行在 waiting 时渲染 `[data-wait-reason]`（文本 = 快照 `waitReason` 原文）；空矩阵时该区块节点数 0（不渲染空壳） | client 渲染单测 + 真机（AC-38） | P1 |
| AC-21 | 面板改动只用既有 replaceRisk=none 槽位：`grep -c "slots.register\|slots.inject"` 与 r10 相同（新增 0 处）；挂载点 `name` 逐字等于 slot 名，插件标识只在 `id`/`key` | 静态计数 + 逐处核对 | P0 |

### 6.7 F7 队长写文件留痕

| AC | 判据（可测/可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-22 | 队长调用 `write` / `edit` 时记录一条 deviation：`{ at, sessionId, toolName, paths: string[], reason: string(≤120 字) }`；落 `<home>/.dsh/auto-team/deviations.jsonl`（追加写、与 runs 同根、仓库外），快照投影最近 50 条为 `deviations`；记录不含文件正文（断言记录中不出现 > 120 字的原文片段）。队长判定复用既有口径：`exec.agent` 缺省 → 队长；有 agent id → 成员不记 | 单测（模拟工具事件）+ 文件断言 | P1 |
| AC-23 | fail-open：记录路径任何异常（目录不可写/写入抛错/序列化失败）都不得改变工具结果、不得抛给调用方、不得让工具失败；只 warn 一次。注入必然抛错的写入后，工具仍被放行（`next()` 被调用）且返回不抛 | 单测（注入坏 writer）+ 变异（去 try/catch → 红） | P0 |
| AC-24 | 去抖与可查：同一 (toolName, 归一路径集合) 在 60 秒内连续 N 次写合并为 1 条并累加 `count`（面板显示 `×N`）；不同路径各自成条；面板 `[data-deviation]` 区块渲染最近记录（时间/工具/路径/原因/次数），0 条时不渲染；既有 484 断言不因留痕变红 | 单测（10 次同键 → 1 条）+ 渲染断言 | P1 |

### 6.8 F8 单任务干预

| AC | 判据（可测/可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-25 | `PanelAction` 新增 `cancelTask{taskId,reason?}` / `skipTask{taskId}` / `updateAcceptance{taskId,acceptance}`（15 → 18），三者都走既有 `POST /act`（路由仍 3）；会话 id 沿用 bridge 现有入口（不新增解析） | 单测（动作枚举 18 + 每动作一次真调用改 store） | P0 |
| AC-26 | 语义与拒绝面写死：**cancelTask** 允许 `pending/blocked/ready/waiting/running/rework/failed`，`done` 拒绝；running 时同时中断成员；状态 → `cancelled`，下游 → `blocked` 且 waitReason「上游 t2 已取消」，释放写域。**skipTask** 仅允许 `pending/blocked/ready/waiting`（`running`/`done` 拒绝，需先取消）；状态 → `skipped`，其依赖视为满足（下游可推进），释放写域。**updateAcceptance** 仅允许非 `done`/`cancelled`/`skipped`；空串拒绝并返回三条模板；新命令在下次门禁生效，不改已完成任务的证据。每个动作 2 个用例（允许 + 拒绝），拒绝文案含任务 id 与当前状态中文；skipped 不算「依赖满足」→ 下游用例必红 | 单测 6 例 + 变异 | P0 |
| AC-27 | 计划页任务行新增三个操作（`[data-task-action="cancel|skip|edit-acceptance"]`）；非法态 `disabled` 且 `title` 给出原因（如「运行中请先取消」）；改验收走弹层 `[data-acceptance-editor]`，空值不可提交（0 次请求）；失败时行内给可读原因（沿用面板 `data-error` 机制，不新增红字滥用） | 渲染单测（13 态 disabled 矩阵）+ 提交空串断言 | P1 |

### 6.9 形状与回归

| AC | 判据（可测/可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-28 | 形状扩张逐项登记并**只**含这些：工具 7→8（`auto_team_add_tasks`）；`PanelAction` 15→18；`TaskStatus` 10→13（+waiting/+cancelled/+skipped）；`PlanTask` +`writeScopes`；快照 +`scopeLocks`；快照 +`deviations`（投影）与任务 +`waitingOn`/`waitReason`；deviation 落盘文件 `~/.dsh/auto-team/deviations.jsonl`。**未扩张**：`ActivityEvent.kind` 仍 9（等待/释放/干预记 `status` 或 `message`）、HTTP 路由仍 3、`setInterval` 仍 1、四常量各 1、`sessionOf` 仍 1 处；逐项计数探针断言，任一越界红 | 静态计数探针 | P0 |
| AC-29 | 回归线：`pnpm test` ≥ 484 例且 fail 0；`pnpm typecheck` 0 错；r7 / r10 既有 checker 不回归；三条既有 P3 不新增失败。命令实跑数字贴进 QA-REPORT | 命令实跑 | P0 |

### 6.10 交付契约（plugin-full，八条各成一条 AC）

| AC | 判据（可测/可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-30 | 宿主半加载入口声明存在且正确：`cordis.patch.yml` 含 `- insert: [{ id: auto-team-host, name: 'dsh-auto-team' }]`（`name` = **包根名**，非子路径），`package.json` 的 `dsh.bundle.patch` 指向该文件；装进 profile 后宿主日志无 `entry did not activate`。真机起不来则如实记「未验证」 | 读文件 + 真机/未验证 | P0 |
| AC-31 | client 半声明完整：`package.json` 的 `dsh.client` 字段集合与宿主样本逐字段一致（本仓现状 `{ platform: "web", inject: [7 个 @deepseek-ai/dsh-client-*], immediately: false }`）；`lib/client.js` 非空且含包标识 `dsh-auto-team` | 读文件 + grep 产物 | P0 |
| AC-32 | UI 挂载点 `name` 逐字等于 slot 名：`ctx.slots.inject('<slot>', () => ctx.slots.register({ name: '<同一 slot 字符串>', id: '<本插件标识>', order: N }, Component))`；四处挂载点（`sidebar.right.pane.tab`、`sidebar.right.pane.tab.title`、`conversation.session.header.actions`、`conversation.input.left`）逐一核对 `inject` 参数与 `register.name` 逐字相同、插件标识只在 `id`/`key`；端到端判据 = 装进宿主后该 UI 真的出现 | 静态核对 + 真机 | P0 |
| AC-33 | 分发白名单：`package.json` 的 `files` 含 `lib` 与 `cordis.patch.yml`；`npm pack --dry-run` 至少列出 `cordis.patch.yml`、`lib/index.js`、`lib/client.js` 三件 | 命令实跑 | P0 |
| AC-34 | 依赖协议可被 profile 解析：`grep -c "workspace:" package.json` === 0（依赖只用 `file:` / 版本号） | 命令实跑 | P0 |
| AC-35 | 宿主运行期依赖按宿主模块表声明的 peer/可选 peer：`peerDependencies` 覆盖宿主提供的 7 个 `@deepseek-ai/*` 与 `react`，`peerDependenciesMeta` 全部 `optional: true` | 读文件 + 断言 | P0 |
| AC-36 | 构建产物与源码同步 + 装载安全：`pnpm build` 后 `lib/index.js`、`lib/client.js` 均含本轮特征串（`add_tasks`、`writeScopes` 至少各 1 个），且 `find src -newer lib/index.js` 与 `find src -newer lib/client.js` 均 0 命中；`node --input-type=module -e "await import('./lib/index.js')"` 与 client 同形命令均 exit 0（模块顶层不抛） | 命令实跑 | P0 |
| AC-37 | 主 agent 安装与回滚可照做（写进 PRD 与 ACCEPTANCE）：`cd ~/.dsh/profiles/desktop && pnpm add file:<repo>` → 同步 `dsh.profile.bundles` 条目（由包 `dsh.bundle.patch` 自动推导）→ 重启宿主 → 活会话采样验证工具条/面板/新工具；失败回滚 = `pnpm remove dsh-auto-team` + 还原 `dsh.profile.bundles` 备份 + 重启。**流水线子代理写不了工作区外**，此步只能由主 agent 执行；跑不了记「未验证」，不得用 mock 顶替 | 主 agent 执行 + 真机/未验证 | P0 |

### 6.11 证据与收口

| AC | 判据（可测/可量化） | 验证方式 | 优先级 |
|---|---|---|---|
| AC-38 | 真机证据（能给 CDP/HTTP 实证的必须给）：① 面板 `[data-scope-locks]` 区块与 `[data-wait-reason]` 文案真机可见；② `add_tasks` 之后 `GET /api/auto-team/snapshot` 的任务数变化实拍（前后两次响应 JSON 片段）；③ 单任务派发产生 1 个成员。克隆 profile 起不来的项如实记「未验证」，不许 mock 顶替 | 真机 / 未验证 | P1 |
| AC-39 | 文档回填：`docs/teamflow/memory.md` 增补本轮四条约定（写域冲突判定与 waiting 语义 / add_tasks 幂等与原子 / deviation 落点与 fail-open / 三条验收模板与「选不出」口径），**替换同主题行、不追加变更日志**；`git diff HEAD -- AGENTS.md` 只允许命中 `<!-- teamflow:begin/end -->` 托管区（或全无改动）；本轮不新增产品级架构文档，故 AGENTS.md §2 索引无需新增行 | 文件断言 + git diff | P1 |
| AC-40 | 收口：单笔提交（含 `lib/` 双产物与任务夹四件文档），commit message 点明 r11 范围；`git status --porcelain --untracked-files=all` 为空；交付回复贴出 commit hash 与门禁数字 | 命令实跑 | P0 |

## 7. 假设与待澄清

**事实类（需要一次实测/取证才能定，PRD 先取推荐口径）**

- **F1 队长与成员的区分口径**：`tools/execute` 的 `exec.agent` 在主 session 可能缺省（现有 noWait 守卫已按 `agentId === null ⇒ 队长` 翻译，见 `src/host/index.ts:423` 附近）。若该口径在真机上不成立（例如主 session 也带 agent id），deviation 会把成员写入误记成队长写入。→ 若改为"只记 agentId 非空"：留痕将只剩成员，需求失效；若改为"全部记录"：面板被淹（anti-goal 5）。
- **F2 窄面板能否容纳新增区域**：右栏约 320px，计划页现有列已满（成员行网格列宽冻结）。新增「写域/等待」内容若按列排会撑破。→ 若真机测量确实不足，改为整行副行呈现（不加列），AC-20 的属性名与文案不变。
- **F3 `waiting` 与既有 resume/stall 的交互**：`stallAlerts` / `resume` 是否会把 waiting 任务误判成"卡住"并触发自动 resume（重复派发）。默认：waiting 不计入 stall；若实测会触发，则在 stall 判定里显式排除 waiting。

**口味类（等价可选，取推荐口径先做）**

- **T1 写域冲突判定用「完全相同」还是「目录前缀包含」**：推荐**目录边界前缀包含**（`src/host` 与 `src/host/bridge.ts` 冲突），因为按目录声明更自然；若选「完全相同」，用户必须逐文件列举，写域会退化成噪音。
- **T2 `waiting` 是否占并签名额**：推荐**不占**；若占用，等待者会把真正能跑的任务堵在门外。
- **T3 cancelTask 后下游怎么办**：推荐下游转 `blocked` 并写明「上游已取消」，等用户处理；若自动连带取消，一次误点会雪崩整条链。
- **T4 skipTask 后下游是否继续**：推荐**视为依赖满足、下游继续**（skip 的语义就是"这条不做，后面照走"）；若下游也停，skip 与 cancel 就没有区别。
- **T5 释放通知的收件人范围**：推荐**只发等待者本人**；若同时给队长再发一条，同一次释放会刷两条账本记录。
- **T6 deviation 是否也记 `bash` 写文件**：推荐**只记 `write`/`edit`**；`bash` 里的 `sed -i`、重定向无法可靠判读，记了会产生大量假阳性。
- **T7 单任务干预控件的呈现**：推荐任务行内三个紧凑文字按钮（取消/跳过/改验收），320px 下不另开操作区；若换成图标或右侧操作面板，需重做布局与 disabled 矩阵。
- **T8 add_tasks 幂等键口径**：推荐**内容指纹**（`title + roleId + acceptance + 归一 writeScopes` 的 hash）判重；若按"任务 id 相同"判重，缺省 id 每次自动生成 `t<next>`，同一批任务重复 append 仍会插入重复任务（anti-goal 3）。

## 8. 工程约束

- **分支与基线**：当前分支 `feat/auto-team-plugin`，HEAD `7843d3c`。**从当前 HEAD 继续，不新建分支**；实现开始前工作树仅有 1 项未跟踪（本任务夹 `docs/teamflow/20261102-r11-team-scope-control/`），按现状继续，无需 stash。
- **提交**：由本流水线在收口阶段完成**单笔**提交（含 `lib/` 双产物与任务夹四件文档）；提交后必须向用户报告 commit hash 与门禁数字；`git status --porcelain --untracked-files=all` 必须为空。
- **仓库边界**：只改本仓库，**不动 `~/.dsh/profiles/desktop` 的安装**；安装/回滚步骤按 AC-37 写给主 agent 执行（子代理写不了工作区外）。
- **探针锚定**：`logs/teamflow/<runId>/scripts/*.mjs` 一律用 `new URL('../../../../', import.meta.url)` 锚定仓库根；报告"探针红"前先确认不是从归档位置跑的。
- **`.gitignore` 审计（dev 阶段动作）**：现有忽略项覆盖 `node_modules/`、`dist/`、`coverage/`、`*.tsbuildinfo`、`logs/teamflow/`、`.auto-team/`、`.env*`、`*.tgz`、`pnpm-debug.log*`、`.vscode/`、`.idea/`、`.DS_Store`，且**显式不忽略 `lib/`**（profile 安装源）。本期新增留痕文件落在 `~/.dsh/auto-team/`（仓库外），不需新忽略项；收口前用 `git status --porcelain --untracked-files=all` 确认没有新增任何构建/缓存噪音文件进入提交。
- **交付契约**：按 AC-30~AC-37 八条逐条验收（入口声明 / client bundle 声明 / 挂载点 name / files 白名单 / 无 `workspace:` / peer 声明 / 产物同步与装载安全 / 主 agent 安装回滚）。

## 9. 优先级、依赖与风险

**优先级**：P0 = AC-1~AC-19、AC-21~AC-23、AC-25~AC-26、AC-28~AC-37、AC-40；P1 = AC-20、AC-24、AC-27、AC-38、AC-39。

**依赖**：

- r10 基线（开关/面板/角色/技能）必须不回归；`PanelAction` 与工具数量是本轮唯一的动作面扩张点。
- 宿主 `tools/execute`（waterfall）与 `tools/result`（emit）形状；`exec.agent.id` 只在有值时才是成员。
- 本仓无 lint 脚本 —— 模板第 ③ 类只能落到 `pnpm typecheck`，不得写 `pnpm lint`。

**风险**：

1. 队长提示词段落已被 2600 字符预算压满（r5 AC-1），新增两条规则可能需要压缩既有句子；压缩不当会同时打红 AC-1 与既有 captain 断言。
2. `TaskStatus` 从 10 扩到 13 会牵动 `progressOf`、面板 13 态矩阵、`blockedTasks`/`readyTasks` 的过滤条件，漏一处就会出现"任务永远不 ready"。
3. 等待语义与并发名额、stall 判定、resume 三处交互，任一处理不当会表现为"任务卡住不动"。
4. deviation 依赖"队长 = 无 agent id"的口径，真机若不成立需退回更保守的记录面（见 F1）。
5. 面板 320px 宽可能容不下新增写域区块，已备好副行方案（见 F2）。

## 10. 里程碑建议

- **M1（提示词与模板）**：AC-1~AC-7 —— 队长硬规则 + 三条验收模板 + plan/gate 文案。
- **M2（续派与写域）**：AC-8~AC-18 —— add_tasks、writeScopes、waiting、释放通知。
- **M3（面板）**：AC-19~AC-21、AC-25~AC-27 —— 占用矩阵、等待原因、单任务干预控件。
- **M4（留痕）**：AC-22~AC-24 —— deviation 落盘、fail-open、去抖与面板区块。
- **M5（门禁与收口）**：AC-28~AC-40 —— 形状计数、回归线、交付契约、真机证据、文档回填、单笔提交。
