<!-- meta: summary="交付 dsh-auto-team 插件：把当前会话变成队长，用可续聊成员+依赖任务图+质量门禁完成目标，并带角色/模型/共享记忆与输入框下开关" -->
基线依赖：无
<!-- 说明：本机 profile 已装的 dsh-plugin-teamflow / dsh-better-sidebar 仅作为「声明怎么写」的宿主版本权威样本，不是本需求的基线依赖。 -->

# PRD · dsh-auto-team（自动多智能体协作插件）

## 1. 背景与目标

当前 DSH 会话是单线程的：一个会话只能自己干，无法把目标拆给彼此协作、各自带模型与技能、还能中途续聊的成员。用户要么手工起多个 subagent，要么把全部上下文堆进一个会话。

本需求交付一个可被宿主安装/加载的插件 `dsh-auto-team`：

- **当前会话即队长**：不需要第二个"总控 agent"，队长就是用户正在聊的会话。
- **成员可续聊**：成员不是一次性 fork，而是可被再次寻址、继续对话的实例。
- **目标 → 有依赖的任务图**：任务是 DAG，依赖未完成的任务不派发；无依赖的任务并行跑。
- **自动选角**：队长分析需求，从角色库里挑相关角色（每角色自带技能）。
- **直达消息协调**：队长与成员之间用消息（含任务上下文）协调，而不是让成员互相猜。
- **实时活动面板 + 质量门禁**：谁在干什么、卡在哪一眼可见；任务必须过验收才允许算完成。
- **角色可自建/可改、每角色可指定模型**：用户能在 UI 里长出自己的团队，并能给便宜活配便宜模型。
- **共享记忆（公共 + 项目，md 管理）**：团队共享、用户可读可改。
- **输入框下方的一键启用/停用**：不启用时零开销。

成功判据（宏观）：用户启用开关 → 打一段目标 → 看到「执行计划（角色/任务/模型）」→ 成员并行开工且面板实时反映 → 任务带证据过门禁 → 中断后能原地续跑 → 全程花费与角色模型配置一致。

## 2. 交付形态（不可协商）

分诊判定：`plugin-full`。必须**可被宿主 profile 真实装入并加载**，不是"代码写完、单测绿"。

本机环境（起跑探测，禁止假设）：

- `DSH_HOME=/Users/maliang/.dsh`
- profile=`desktop`，目录 `/Users/maliang/.dsh/profiles/desktop`
- `dsh` **不在 PATH**（源码运行）→ 安装走等价手动步骤：profile 目录内 `pnpm add file:<repo>` + 把包名写入 `package.json` 的 `dsh.profile.bundles`
- 宿主版本权威样本（字段名以它们为准，禁止凭记忆）：`/Users/maliang/.dsh/profiles/desktop/node_modules/dsh-plugin-teamflow/package.json` + 同目录 `cordis.patch.yml`、`dsh-better-sidebar/package.json`（含 `dsh.client` 完整字段集与 `files` 白名单）
- UI 挂载点实测存在（宿主 `app.asar` 内 slot 契约）：`conversation.composer.dock`（kind=list、scope=session、渲染在输入框下方 dock 容器 `[data-composer-dock]` 内）；相邻候选 `conversation.input.dock`（在输入卡上方）——**本需求取 `conversation.composer.dock`**，因为需求是"输入框下"。

## 3. 用户故事（每条带可测验收）

- **US-1 一键接管**：我在输入框下打开开关，会话就变成队长；关闭后一切恢复原状、不再产生任何额度消耗。→ AC-12、AC-3
- **US-2 看到计划再开工**：我把目标丢给队长，它给出「角色 + 任务 + 依赖 + 模型」的执行计划，我能改角色再让它开工。→ AC-13、AC-14、AC-30
- **US-3 并行且有先后的执行**：没有依赖的任务同时跑，有依赖的等前序完成；并发不会冲破宿主上限。→ AC-15
- **US-4 我能直接给某个成员加话**：队长（或我）给成员 A 补一条要求，A 在**同一个成员身份**上继续，而不是新起一个。→ AC-16、AC-17
- **US-5 中断后原地续跑**：宿主重启或我暂停后，能从落盘记录恢复：不重复成员、不丢已完成任务，连按两次恢复也不会产生两份。→ AC-17
- **US-6 实时看见谁在干什么**：面板显示每个成员的角色、当前任务、状态、最近事件时间；成员被杀掉后面板 5 秒内变 interrupted，不会假装在跑。→ AC-18
- **US-7 完成必须有证据**：成员说"做完了"不算完成，验收不过就打回且下游不派发。→ AC-19
- **US-8 我的团队我做主**：内置角色带技能开箱可用；我能新建/修改角色（名称、职责、技能、模型），改完下次派发生效。→ AC-20、AC-21
- **US-9 每个角色用自己的模型**：给测试角色配便宜模型，它就必须用便宜模型；配错路由要当场拒绝并说明原因，而不是偷偷用队长的模型。→ AC-22
- **US-10 团队记忆可读可改**：公共记忆与项目记忆都是 md，我能看、能改、能保存；成员启动时拿到**有界**的相关记忆，而不是几千行全文。→ AC-23、AC-24、AC-25
- **US-11 作为插件能装能卸**：主 agent 按 PRD 给出的本机命令装进 profile，重启宿主后 GUI 里真的出现开关与面板；装坏了能一条命令回滚。→ AC-1~AC-11

## 4. 范围与非目标

**范围内**：插件双半（宿主 + client）、角色库与角色编辑、任务图与调度、成员创建/续聊/直连消息、活动面板、质量门禁、双轨 md 记忆与编辑 UI、per-role 模型路由、输入框下开关、安装/回滚路径。

**非目标（明确不做）**：

- 不做通用项目管理系统（不做需求评审流、不做迭代看板、不与 TeamFlow 流水线互通）。
- 不做多机/远程成员，不做云端记忆同步。
- 不做自动 `git commit`/自动推送（成员只改工作区文件，提交由用户决定）。
- 不做角色市场/在线分发（内置 + 本地自建即可）。
- 不替换宿主既有 `subagent` / agentTeams 能力，只在其上编排。
- 不做费用预算硬闸（只展示每个角色的模型与实际路由，花费控制交给用户配置模型）。

## 5. 反面目标 / anti-goals

技术全绿但人会拒绝交付的形态。每条都可被人当场观察到：

1. **开关一开就静默批量起人**：用户还没看清"谁、用什么模型、做什么"，5 个成员已经被创建、额度已扣。判定：启用后第一次派发**必须**先在面板/消息流出现一条「执行计划」条目（角色、任务、模型、预计并发），并且它在成员创建**之前**可见、可取消；没有这条即失败。
2. **绿灯来自成员自述**：门禁没真跑验收（或跑了但没留证据），成员一说"完成"任务就变 done，下游继续派发。判定：人为让某任务的验收命令失败，该任务必须停在「待返工」、其下游任务状态必须仍是「阻塞」，且记录里有失败证据（命令/输出尾部/文件路径）。
3. **per-role 模型静默回退**：角色配了便宜模型，实际用队长模型跑完，只有账单能发现。判定：面板与运行记录显示的实际 `provider/model` 与角色配置逐字一致；配置不可用时必须**拒绝派发**并给出具体原因，不允许回退。
4. **面板与事实脱节**：成员进程死了/会话重启了，面板仍显示「运行中」，用户以为还在干活。判定：杀掉成员后 5 秒内该行变 `interrupted`；除真实 resume 外不得自动变回 `running`；状态流里每次变更都有时间戳。
5. **共享记忆变垃圾场**：每个成员把过程日志、全文笔记贴进 md，跑十次后记忆数千行、注入被截断，后来的成员拿到的都是噪音。判定：单次任务写入的记忆条目与行数有上限（≤20 行/任务），每条必须带来源标注（角色/任务/时间）；注入给成员的记忆有字符上限并按标题/相关度选取，超限要在面板上标出来。
6. **装上就起不来且救不回**：插件顶层访问未注入的服务导致宿主启动即崩，或装完发现不对却没有回滚路径，用户只能另开 agent 手术卸载。判定：`node -e` 加载两产物退出码 0；安装步骤必须**先写下**反向命令（从产物 package.json 读包名），装后验证失败立即执行卸载并确认 `dsh.profile.bundles` 已摘除、宿主可启动。

## 6. 交互流程摘要

1. 输入框下方出现一行开关：`自动团队 [关/开]`（默认关，按会话持久化）。
2. 打开后，用户照常发一句目标（如"给这个仓库加一个 CSV 导出"）。
3. 队长调用编排工具，产出**执行计划**：`任务图（id/title/roleId/dependsOn/acceptance）+ 选角理由 + 每角色模型 + 预计并发`。计划在面板可见、可编辑（换角色/删任务）、可取消。
4. 派发：就绪任务（依赖全完成）并行创建成员（≤ 宿主并发上限），每个成员带角色技能 + 有界记忆摘要 + 该任务的验收判据。
5. 成员执行 → 汇报 → 门禁跑验收 → 通过则解锁下游；失败进「待返工」，队长用直达消息把失败证据发回该成员（同一成员身份续跑）。
6. 面板实时刷新：角色、任务、状态、最近事件时间、实际模型路由。
7. 用户可随时暂停/继续/终止；关掉开关即停止自动派发与成员创建。
8. 记忆页：公共记忆 / 项目记忆两个 md 清单，可打开、编辑、保存、删除（带确认）。

## 7. 优先级

- **P0**：AC-1~AC-11（可装可加载可回滚）、AC-3/AC-12（开关）、AC-13/AC-14/AC-15（拆解·选角·并行）、AC-16/AC-17（直达消息·中断续聊）、AC-18（面板基础）、AC-19（门禁）。
- **P1**：AC-20/AC-21（角色库·自建改角）、AC-22（per-role 模型）、AC-23/AC-24（记忆双轨·编辑）。
- **P2**：AC-25 的记忆相关度检索与超限可视化、角色模板导入导出、面板耗时/成本聚合。

## 8. 依赖与风险

| 风险 | 说明与对策 |
| --- | --- |
| **per-role 模型在宿主侧会被吞** | `dsh-agent-team-presets` 的 `member-runtime` 明确写着：官方 Team 请求**不携带** `agentOptions/persona/toolFilter`，成员会带着队长的路由出生；唯一公开扩展点是串行的 `agent/created` 事件。对策：在 `agent/created` 上安装成员级路由/人设/工具策略；派发前用 `llm.resolveCallConfig()` 预校验，不可用即拒绝（AC-22 的反向断言）。 |
| **并发/生命周期配额** | 宿主会报 `No subagent slot is free right now`（并发上限）与"成员额度用尽"（lifetime allowance）。对策：捕获并原样呈现，计划中标注"排队中"，不得吞错或谎报成功。 |
| **slot 名 / 字段名随版本漂移** | 已实测 `conversation.composer.dock` 存在；声明字段一律照本机已装插件样本。对策：AC-3 要求 `inject` 参数与 `register.name` 逐字相同，端到端以"GUI 里真的出现"为准。 |
| **安装只能主 agent 做** | 流水线子代理权限固定在工作区，写不了 `~/.dsh/profiles/desktop`。对策：PRD 给出主 agent 可照做的三步命令 + 回滚（§10.3）；验收必须有实跑输出，不得写成"人工补测"。 |
| **记忆污染上下文** | 记忆注入每个成员会吃 token。对策：AC-25 强制有界（默认 ≤4000 字符）并按标题/相关度选取。 |
| **中断恢复的重复成员** | 恢复时不识别已有成员会产生重复实例、双份任务。对策：AC-17 要求幂等（连按两次恢复结果一致）。 |
| **门禁被绕过** | 队长或成员可以"口头完成"。对策：AC-19 规定完成动作只能由门禁结果驱动，且下游派发以门禁通过为前提。 |

## 9. 验收标准

> 编号仅在本需求夹内有效。命令以本机路径为准；每条 AC 在 QA 阶段必须有可复现的判定方式与实跑证据。

### 9.1 交付契约（plugin-full，必须可装可加载）

| ID | 验收标准（可测） |
| --- | --- |
| AC-1 | 宿主半有 profile 层加载入口：`package.json` 含 `dsh.bundle.patch: "./cordis.patch.yml"`，且 `cordis.patch.yml` 为 `insert:` 块内**一行** `- id: auto-team-host` / `name: 'dsh-auto-team'`（**包根名**，不得是 `dsh-auto-team/host` 之类子路径）。判定：读文件 + `grep -c "name: 'dsh-auto-team'"` ≥1；`dsh` 声明块字段集合与 `dsh-plugin-teamflow/package.json` 一致。 |
| AC-2 | client 半有 bundle 声明与被扫描的 id：`dsh.client` 含 `platform: "web"`、非空 `inject: [...]`、`immediately: false`（字段集合与 `dsh-plugin-teamflow` 的 `dsh.client` 逐字段一致，不多不少）。构建产出 `lib/client.js` 非空（≥5KB）且 `grep -c "dsh-auto-team" lib/client.js` ≥1。 |
| AC-3 | UI 挂载点 `name` 必须是 slot 名本身：源码形如 `ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'dsh-auto-team:toggle', order: 30 }, Component))`；`inject` 的第一个参数与 `register` 的 `name` **逐字相同**，插件标识放 `id`/`registrant`。端到端判据：装进宿主并刷新后，输入框下方出现开关元素（`[data-dsh-auto-team-toggle]`，或以 role/aria-label 可定位）。 |
| AC-4 | 分发白名单含入口与产物：`package.json` 的 `files` 数组包含 `lib`（产物目录）与 `cordis.patch.yml`。判定：`npm pack --dry-run --json` 的条目里同时出现 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`。 |
| AC-5 | 依赖协议可被 profile 解析：`package.json` 全文 `grep -c "workspace:"` = 0；`dependencies` 值均为 registry 版本范围（`^`/`~`/精确版本）或 `github:` 引用。 |
| AC-6 | 宿主运行期依赖按 peer 声明：`@deepseek-ai/*` 全部出现在 `peerDependencies` 且 `peerDependenciesMeta[*].optional=true`；同名包**不得**出现在 `dependencies`。判定：脚本比对三个集合，冲突即失败。 |
| AC-7 | 产物与源码同步：安装前重跑构建；`lib/index.js`、`lib/client.js` 均含当前源码特征字符串（例如新加的 `dsh-auto-team` 与任一本次新增的工具名），或两者 mtime 晚于 `src/` 下所有文件的最新 mtime。判定：脚本两条判据至少一条成立并打印实际字符串/mtime。 |
| AC-8 | 装载安全：`node -e "require('./lib/index.js')"`（ESM 产物则 `node --input-type=module -e "await import('./lib/index.js')"`）与 client 产物同样加载，两条命令退出码均 0；产物模块顶层不得访问 `ctx.*` 服务（顶层仅导出 `apply`/`name`/`inject` 等声明），也不得 `throw`。 |
| AC-9 | 被 profile 真实装入并加载（**主 agent 执行**）：按 §10.3 命令在 `/Users/maliang/.dsh/profiles/desktop` 安装并登记 `dsh.profile.bundles`；重启宿主后启动日志出现该插件行（`grep -i "auto-team" <重启后日志>` ≥1）。判定记录必须含实跑命令与输出。 |
| AC-10 | 安装带回滚：安装前把卸载命令写入验收记录（包名从产物 `package.json` 的 `name` 读出，不得写死 profile 名以外的路径）；装后任一条 AC-1~AC-9 验证失败 → 立即执行 `pnpm remove <包名>` + 从 `dsh.profile.bundles` 摘除 + 重启宿主确认正常启动，并把回滚输出记入记录。 |
| AC-11 | 安装由主 agent 执行：PRD §10.3 给出「本机命令 → 重启宿主 → GUI 可见性检查」三步；验收记录需包含这三步的执行结果。以"请用户手动测试"替代即判失败。 |

### 9.2 功能验收

| ID | 验收标准（可测） |
| --- | --- |
| AC-12 | 输入框下的启用/停用：开关位于 `conversation.composer.dock`，默认**关**；状态按 sessionId 持久化（刷新页面后保持）。关闭状态下编排工具**不可用**：调用返回明确的"未启用"错误（非静默成功），且不创建任何成员（面板成员数保持 0）。 |
| AC-13 | 目标拆成有依赖的任务图：一次编排产出 `tasks[]`，每项含 `{id, title, roleId, dependsOn[], acceptance}`；`dependsOn` 中的 id 必须存在且图无环（检测到环→拒绝并报错）；对一段含实现+测试+文档的样例目标，任务数 ≥3 且至少 2 条任务带非空 `dependsOn`。 |
| AC-14 | 自动选角：选角结果每项含 `roleId` 与一句 `reason`，`roleId` 必须存在于角色库；角色库中无匹配时返回"无匹配角色"并停止派发（不得硬塞默认角色）；用户可在计划中替换/删除角色，替换后派发使用的正是替换后的角色。 |
| AC-15 | 并行与依赖调度：就绪集合（`dependsOn` 全部处于"已通过门禁"）中的任务并行创建成员；同时运行的成员数 ≤ 生效并发上限（取宿主 subagent 并发上限，默认 3）；依赖未通过的任务在面板上为 `blocked/阻塞`，且派发日志中不存在该任务的成员创建记录。 |
| AC-16 | 直达消息协调：队长↔成员的消息记录含 `from/to/taskId/timestamp/body`；队长给某成员追加指令后，该成员在**同一成员实例**（同名、同一会话）上继续，成员总数不增加；消息在面板/记录里可读。 |
| AC-17 | 中断可续：任务执行中把宿主杀掉（或面板暂停）→ 重启/恢复后能恢复运行；恢复后成员数不翻倍、已完成任务不重跑、未完成任务从原成员身份继续；**连续两次恢复**的结果与一次恢复一致（幂等）；恢复过程不产生重复任务记录。 |
| AC-18 | 实时活动面板：面板每行含 `{角色, 当前任务, 状态(running/idle/blocked/rework/done/failed/interrupted), 最近事件时间, 实际模型}`；状态变更 ≤5s 内反映；杀掉某成员后 5s 内该行变为 `interrupted`，且不会在无真实恢复的情况下自动变回 `running`。 |
| AC-19 | 质量门禁：任务从 `running` 到 `done` 只能经由门禁通过；门禁执行该任务的 `acceptance` 并把证据（命令、退出码、输出尾部或产物路径）写入记录；门禁失败 → 任务转 `rework`，其下游保持 `blocked`，并把失败证据通过直达消息发回原成员。人为制造失败用例必须停在 `rework`（不得自行重试到成功且不记录）。 |
| AC-20 | 预设角色自带技能：内置 ≥6 个角色（至少覆盖：产品/架构/开发/测试/文档/评审），每个角色附 `skills[]`（md 文件）；创建成员时其系统提示包含该角色技能的正文特征句（在会话/成员提示里 `grep` 得到）。 |
| AC-21 | 自建与修改角色：UI 可新建角色（名称、职责、技能、模型）与修改现有角色；保存后落盘为 md/json（含路径可读）；重启后仍存在；修改在**下一次**派发生效，已存在成员不受影响。删除有确认，删除后该角色不再出现在选角列表。 |
| AC-22 | 每角色可指定模型：角色含 `provider/model/reasoningEffort`；派发后该成员的实际调用路由与角色配置逐字一致（面板显示实际 route，且派发前用 `llm.resolveCallConfig()` 校验通过）；配置不可用时**拒绝派发**并报具体原因，命中该失败路径时不得创建成员、不得回退到队长模型。 |
| AC-23 | 共享记忆双轨（md）：公共记忆存于 `~/.dsh/auto-team/memory/**/*.md`（跨项目），项目记忆存于 `<workspace>/.auto-team/memory/**/*.md`；成员启动时注入与其任务相关的**有界**记忆摘要；成员写记忆时按作用域落到正确轨（项目内事实→项目记忆，跨项目约定→公共记忆），写错轨即失败。 |
| AC-24 | 记忆可查看/修改：UI 列出两轨记忆文件并可打开、编辑、保存；保存后磁盘 md 内容与 UI 内容逐字一致（mtime 变化 + diff 无差异）；删除需二次确认；非法路径（`..`、越出两轨根目录）被拒绝。 |
| AC-25 | 记忆注入有界且可解释：注入给单个成员的记忆 ≤4000 字符（可配置但有上限），超限按标题/相关度选取并在面板标注"已截断"；单次任务新增记忆 ≤20 行且每条带来源（角色/任务/时间）。判定：构造 10KB 记忆库，注入内容长度 ≤ 上限且包含被选中文件的标题行。 |
| AC-30 | 派发前可见计划（对应反面目标 1）：启用后的首次派发前，面板/消息流必须出现一条包含「角色、任务、模型、预计并发」的计划条目，且该条目时间戳早于第一个成员创建记录；计划可取消，取消后成员数保持 0。 |

## 10. 工程约束（原始指令逐字保留 + 本仓补充）

### 10.1 分支与提交

- 当前分支 **`feat/auto-team-plugin`** 即本次实施基线（HEAD `150eb5b chore: baseline before teamflow run`）。**不新建分支、不切分支**，全部实现与文档提交在该分支。
- 工作区已有未提交改动：`?? docs/`（本需求文档夹）。**不 stash、不丢弃**，随本次一起提交。
- 提交时机：功能与文档一次到位后再提交（避免多次提交把门禁证据打散）；提交信息形如 `feat(auto-team): ...`，提交内容含代码与 `docs/teamflow/20261030-r1-auto-team-plugin/`。
- 提交后不再改动文件；交付说明里给出 `git status --porcelain` 与 `git log --oneline -1` 的实跑输出。

### 10.2 `.gitignore`（按本仓真实工具链补齐，提交前完成）

现有仅 `logs/teamflow/`。需追加：`node_modules/`、`.auto-team/`（运行时状态与本地记忆副本）、`*.tsbuildinfo`、`coverage/`、`dist/`、`.DS_Store`。

**明确不得忽略 `lib/`**：`lib/index.js`、`lib/client.js` 是分发与 `pnpm add file:` 安装源（见 AC-4/AC-7），必须入库。

### 10.3 安装步骤（**给主 agent 执行**；子代理写不了 profile，不得写成"请用户自测"）

包名从产物 `package.json` 的 `name` 读取（预期 `dsh-auto-team`），下文用 `<pkg>` 指代。

1. 构建与自检（仓库根）：
   ```bash
   cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
   pnpm build          # 产出 lib/index.js + lib/client.js
   node --input-type=module -e "await import('./lib/index.js')"   # 退出码 0
   node --input-type=module -e "await import('./lib/client.js')"  # 退出码 0
   ```
2. 装入 profile 并登记 bundle（本机无 `dsh` CLI）：
   ```bash
   cd /Users/maliang/.dsh/profiles/desktop
   pnpm add file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
   # 若 pnpm 未自动登记，编辑同目录 package.json：dsh.profile.bundles 末尾追加 "<pkg>"
   grep -c "<pkg>" package.json   # 期望 ≥1（dependencies 与 bundles 各一处）
   ```
3. 重启宿主（DeepSeek Harness.app）→ 看启动日志出现 `auto-team` 行；刷新 `http://127.0.0.1:55527` → 输入框下方出现开关（AC-3/AC-12 端到端判据）。

**回滚（必须在安装前先写好，失败立即执行）**：
```bash
cd /Users/maliang/.dsh/profiles/desktop
pnpm remove <pkg>
# 并从 package.json 的 dsh.profile.bundles 中删除 "<pkg>"
grep -c "<pkg>" package.json   # 期望 0
# 重启宿主，确认能正常启动
```

### 10.4 技术形态

- TypeScript + 双构建（宿主 `lib/index.js`、client `lib/client.js`，ESM），`package.json` 用 `dsh.bundle.patch` + `dsh.client` 声明（字段集合照 §2 样本）。
- 复用宿主服务：`ctx.agentTeams`（`spawnTeammate` / `listMembers` / `tryMembership`）、`ctx.tools.register`、`ctx.systemPrompt.section`、`ctx.slots.inject/register`；不重造成员与消息通道。
- per-role 路由走 `agent/created` 事件 + `llm.resolveCallConfig()` 预校验（见 §8 风险）。
- 落盘：运行状态 `~/.dsh/auto-team/runs/<runId>.json`（可断点恢复），角色 `~/.dsh/auto-team/roles/*.md`，记忆见 AC-23。

## 11. 假设与待澄清

- **（事实）内置角色清单与数量**：PRD 假设内置 6 个角色（产品经理 / 架构师 / 开发 / 测试 / 技术写作 / 评审），每个 1–2 个内置技能 md。依据：够覆盖"拆解—实现—验证—文档"，再多会稀释自动选角。若用户要按自己的工作流定制（如加"数据分析师""运维"），选角质量与默认计划都会变。
- **（口味）派发前是否需要用户确认**：假设为"自动派发，但派发前先在面板显示一条可取消的执行计划"（不阻塞）。若改成"必须点确认才派发"，自动化价值下降但额度更安全。
- **（口味）开关默认状态与作用域**：假设默认**关**、按会话持久化（关=零开销）。若默认开或全局开，任何会话都会先出现团队开销。
- **（口味）共享记忆写入权限**：假设成员只能**追加**结构化条目（结论/约束，带来源），不能改写他人条目；用户可全量编辑。若允许成员自由改写，记忆会互相覆盖。
- **（口味）记忆文件落点**：假设项目记忆放 `<workspace>/.auto-team/memory/`（可随仓库提交、团队共享），公共记忆放 `~/.dsh/auto-team/memory/`。若用户希望记忆完全不入仓（只在本机），落点与 `.gitignore` 规则都要跟着改。
- **（事实）宿主并发上限与成员配额**：假设并发上限取宿主 subagent 设置（默认 3）、成员额度受宿主 lifetime allowance 约束。若用户的部署调过这些值，计划里的"预计并发"与排队提示需按实际值显示。

## 12. 里程碑建议

- **M1 可装可见**（P0 前置）：双半骨架 + 声明 + 构建 + `conversation.composer.dock` 开关 + 安装/回滚跑通（AC-1~AC-12、AC-30 的空壳）。
- **M2 会拆会派**：任务图、选角、并行调度、直达消息、计划条目（AC-13~AC-16、AC-30）。
- **M3 可续可看**：中断恢复幂等、活动面板、门禁与返工（AC-17~AC-19）。
- **M4 团队可长**：角色库/自建改角、per-role 模型与拒绝回退（AC-20~AC-22）。
- **M5 记忆**：双轨 md、编辑 UI、有界注入与写入限额（AC-23~AC-25）。
