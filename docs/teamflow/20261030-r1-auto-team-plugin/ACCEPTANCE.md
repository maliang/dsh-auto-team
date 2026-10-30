# ACCEPTANCE · dsh-auto-team（20261030-r1 · 验收轮）

> **轮次性质**：本流水线在 QA 返工上限停止，需求已置 `needs-human`（`req-1`/`task-1`），故本报告按「已知缺陷验收」执行：**不重跑 QA 全量套件**，只做三件事——① 逐条核对 PRD 的 26 条 AC；② 亲自复现开放缺陷；③ 记录环境无法覆盖的补测缺口。凡引用 QA 证据处均显式标注，不把 QA 的结论当自己的实跑。
> **交付物**：`dsh-auto-team@0.1.0` 单包双产物（宿主 `lib/index.js` ESM + client `lib/client.js` CJS 套壳）；分支 `feat/auto-team-plugin`，HEAD `150eb5b chore: baseline before teamflow run`（**交付本体未提交**，见 §5.2）。

## 0. 结论摘要

- **26 条 AC：21 条通过 / 4 条不进（1 条字面不成立 + 3 条受开放缺陷或真机未验影响）/ 1 条环境未验**（明细见 §2、§3）。
- **开放阻塞缺陷 1 个**：`R2-1`（P2，成员名唯一性）——我在本机实跑检测命令得 `exit 1`（1/5），影响 AC-15/16/17。
- **交付形态 11 条**：9 条通过、1 条**字面不成立**（AC-6 peer 声明，风险低）、1 条环境未验（AC-9 真机安装）。
- **收口卫生**：交付本体 63 项改动**未提交**（HEAD 仍是脚手架基线），当前状态不可合入、不可作为安装源交付。
- 本轮**没有**发现新的功能缺陷，也**没有**推翻 QA 对上一轮 3 个 P2（N1/N2/A-1）已闭合的结论（我复核了 N1 的旁证：e2e `audits=2`）。

## 1. 证据来源（本轮实跑 vs 引用 QA）

| 命令 | 结果 | 来源 |
|---|---|---|
| `pnpm -s typecheck` | exit 0 | **本轮实跑** |
| `pnpm -s test` | `tests 146 / pass 146 / fail 0` | **本轮实跑** |
| `node --input-type=module -e "await import('./lib/index.js')"` | exit 0 | **本轮实跑** |
| `node --input-type=module -e "await import('./lib/client.js')"` | exit 0 | **本轮实跑** |
| `npm pack --dry-run` | 含 `lib/index.js`(132.1kB)、`lib/client.js`(92.2kB)、`cordis.patch.yml` | **本轮实跑** |
| `grep -c 'workspace:' package.json` | `0` | **本轮实跑** |
| `find src -newer lib/index.js` / `-newer lib/client.js` | 均 `0`（产物晚于全部源码，mtime 04:32） | **本轮实跑** |
| `node logs/…/scripts/check-e2e-mainpath.mjs` | exit 0：`tools=7`、`allDone:true`、`gateExitCodes:[0,0]`、`members=3`、`bindings=3`、`messages=7`、`audits=2`、resume 两次 `bindings 3→3` 且第二次 0 新建 | **本轮实跑** |
| `node logs/…/scripts/qa-collision-probe.mjs` | **exit 1，1/5 PASS**（复现 R2-1） | **本轮实跑** |
| 12 个既有 checker（reverify 9/9、adversarial 51/51、delivery 20/20、client-state 60/0、store 6、t1 8/8、memory 3970/4000、client-bundle、typecheck-v2 等） | 逐条全绿 | **引用 QA-REPORT §2**（未重跑） |
| AC-18 杀成员 5s 内 `interrupted` | 实测 **1446ms**（真实 timer） | **引用 QA-REPORT §2** |
| AC-19 门禁失败 → `rework` + 下游 `blocked` + 证据回发成员 | 通过 | **引用 QA-REPORT §2** |
| AC-16/17/30 的主链路时序（计划 → 派发 → 门禁 → 中断 → 恢复） | e2e `[2 计划] members=0` → `[3 派发]`，`plannedAt` 早于首个成员 | **本轮实跑 e2e** |

## 2. 交付形态契约 11 条（plugin-full）

| # | 判据 | 结果 | 证据 |
|---|---|---|---|
| 1 | 宿主加载入口 + `insert.name` 用包根名 | ✅ | `cordis.patch.yml` `insert[0].name: 'dsh-auto-team'` = `package.json#name`（本轮 `cat` 实读） |
| 2 | client bundle 声明字段集合与样本逐字段一致、产物含包 id | ✅ | 字段 = `{platform,inject,immediately}`、dsh 块 = `{manifestVersion,bundle,client}`，与 `~/.dsh/profiles/desktop/node_modules/dsh-plugin-teamflow/package.json` 逐键相同；`lib/client.js` 命中 `dsh-auto-team` 65 处 |
| 3 | slot `inject` 与 `register.name` 逐字相同、插件名进 `id` | ✅（静态＋mock 接管）/ 真机 GUI 见 §6-2 | `src/client/index.ts:34-51`：`inject(DOCK_SLOT)` / `register({name: DOCK_SLOT, id: PLUGIN_ID+'-toggle'})`，同一常量；`PANEL_SLOT` 同理 |
| 4 | 入口声明与产物进 `files` 白名单 | ✅ | `files: ["lib","cordis.patch.yml","README.md"]`；`npm pack --dry-run` 实测列出三条 |
| 5 | 无 `workspace:` 等本地协议 | ✅ | `grep -c` = 0 |
| 6 | 宿主运行期依赖按宿主模块表声明（peer/optional peer） | ⚠️ **字面不成立** | `peerDependencies` 只有 `react`；`@deepseek-ai/*` **未出现在 peer/peerMeta**（对照样本有 13 条 optional peer）。实际风险低：`dependencies` 为空、源码零 `@deepseek-ai` import（`src/host/adapters.ts:639` 注明「本包运行时零 @deepseek-ai 依赖」），profile 安装不会被拉取。**QA-REPORT §6 第 6 行「全在 peerDependencies」与实际不符，须更正或补声明**（§5.1） |
| 7 | 构建产物与源码同步 | ✅ | `find src -newer lib/*.js` = 0；产物含当前源码特征串 |
| 8 | 两产物模块顶层不抛错 | ✅ | 两条 `await import(...)` exit 0（本轮实跑） |
| 9 | 被 profile 真实装入并由宿主加载 | ⛔ **环境未验** | 需主 agent 在 profile 执行 `pnpm add file:` + 登记 `dsh.profile.bundles` + 重启；本会话为深度 1 子代理、权限固定在 workspace → §6-1 |
| 10 | 安装带回滚步骤 | ✅（文档层） | `PRD.md:120-121`、`:174` 给出 `pnpm remove <包名>` + 从 `dsh.profile.bundles` 摘除 + 重启确认；真机执行属 §6-1 |
| 11 | 安装由主 agent 执行、PRD 给出本机可照做三步 | ✅（文档层） | PRD §10.3 命令 / 重启 / GUI 检查三步齐备；执行属 §6-1~2 |

## 3. 功能 AC 15 条

| AC | 判据要点 | 结果 | 证据 |
|---|---|---|---|
| AC-12 | 开关默认关、按会话持久化；关闭时工具报未启用、成员数 0 | ✅ | e2e `[1 启用] enabled=true members=0`（开关本身不派发）＋ `client-state-check` 60/0（引用 QA） |
| AC-13 | 任务图 id/title/roleId/dependsOn/acceptance、依赖存在无环、样例 ≥3 任务且 ≥2 条有依赖 | ✅ | `test/graph.test.ts`、`test/plan.test.ts` 通过（146/146 内含）；对抗探针 51/51（引用 QA） |
| AC-14 | 选角带 roleId+reason、取自角色库、无匹配停止、可替换后按替换派发 | ✅ | `dispatch.ts:195` `ROLE_UNAVAILABLE` 拒绝路径 + `bridge.ts:783/809` 动作文案；PlanTab `setTaskRole`；替换派发由 e2e 角色保存 + 派发链路覆盖 |
| AC-15 | 就绪任务并行、并发 ≤ 宿主上限、依赖未过门禁为 blocked 且无成员创建 | ⚠️ **受 R2-1 影响** | 并发切片单测 `test/dispatch.test.ts:115`（maxConcurrent=2 只派前两个）；e2e 依赖门禁顺序成立；但**两个就绪中文 id 任务只派发 1 个**（collision probe C4 实测 `TEAM_MEMBER_EXISTS dev`，另一个永久 pending） |
| AC-16 | 直达消息含 from/to/taskId/timestamp；指令在同一成员实例续跑、成员数不增 | ⚠️ **受 R2-1 影响** | e2e `messages=7`、resume 后成员不再新增；但消息 `to` 用成员名，R2-1 下同角色中文 id 任务消息**不可区分**（AC-16 的「可核验」打折） |
| AC-17 | 中断恢复成员不翻倍、已完成不重跑、连续两次恢复幂等 | ⚠️ **受 R2-1 影响** | e2e：resume ×2 `bindings 3→3`、第二次「没有恢复任何成员」；但按名重绑的幂等地基正是唯一成员名，R2-1 下同角色中文 id 会重绑到错误任务 |
| AC-18 | 面板含角色/任务/状态/最近事件时间/实际模型；≤5s 反映；杀成员 5s 内变 interrupted | ✅ | 杀成员 **1446ms** 变 `interrupted`（QA 真实 timer）；本机 e2e `[6 对账] interrupted=true watcher轮询+1`（我实跑）；面板字段由 `client-state-check` 60/0 覆盖；GUI 观感属 §6-5 |
| AC-19 | 完成只能经门禁；记录命令/退出码/输出尾部；失败转 rework、下游 blocked、证据回发 | ✅ | 本机 e2e `gateExitCodes:[0,0]`、`[4 回执]`/`[9 收尾]` 均经门禁；失败→rework+blocked 由 QA 主链路实测 |
| AC-20 | 内置 ≥6 角色各带 skills、成员提示含技能正文特征句 | ✅（静态＋seed 单测） | 6 个角色 `pm/architect/dev/qa/docs/reviewer`（`src/host/roles/builtin.ts:81-124`，各带 `skillIds`）；`builtinSkillBody/composeSkillPrompt`→`src/host/index.ts:90-119` 的 `## 技能` 段进入成员 prompt；`test/memory.test.ts:274` 断言 seed 落盘+重启可读。**缺**「prompt 含特征句」的运行期断言（§5.4） |
| AC-21 | UI 新建/改角落盘、重启保留、下次派发生效、删除确认 | ✅ | `memory.test.ts` seed→改→新实例读回；RolesTab 两步删除确认；派发生效见 e2e 角色保存后 `[1 角色]` |
| AC-22 | per-role provider/model/effort 生效且可核验；不可用拒绝派发、禁止静默回退 | ⚠️ **配置层通过/真机未验** | `audits=2`（我实跑 e2e）证明审计落盘；`preflightRoutes`+`MODEL_UNRESOLVABLE`→拒绝派发；角色未声明模型不落审计、拿不到实际值落 `unverified`（不假装 ok）。但**宿主无 model 字段**，真机路由落地只能由面板「未下发」+ 人工补测 §6-3 确认 |
| AC-23 | 公共 `~/.dsh/auto-team/memory` 与项目 `<workspace>/.auto-team/memory` 双轨 md、按作用域写入 | ✅ | `src/host/paths.ts:28-35`：`publicMemoryDir`=`<home>/.dsh/auto-team/memory/public`、`projectMemoryDir`=`<workspace>/.auto-team/memory`；`repo.ts:47` 按 track 选目录，读/写/删共用 `safeMemoryName` |
| AC-24 | 记忆 UI 列/开/编辑/存，磁盘逐字一致；删除确认；路径逃逸拒绝 | ✅ | `check-memory-subsystem.mjs`：读·写·删**三路径**逃逸均拒绝、仓外真实文件未被触碰（引用 QA）；MemoryTab 点条目先读正文（修 D7）、删除两步确认 |
| AC-25 | 注入 ≤4000 字符、超限按标题/相关度并标注截断；单任务新增 ≤20 行且带来源 | ✅ | 注入 **3970/4000**、省略 145 行、尾行 N 自洽；`appendMemoryLines` 硬上限 20 行 + `formatSourcedLine` 来源前缀（`memory.test.ts` 21 例，引用 QA） |
| AC-30 | 首次派发前有计划条目（角色/任务/模型/并发）、时间戳早于首个成员创建、可取消 | ✅ | 本机 e2e `[2 计划] plannedAt=… members=0 bindings=0` → `[3 派发] members=1`；`store.test.ts` 断言 `plannedAt < bindings[0].spawnedAt`；`cancel` 动作在 11 动作集内 |

## 4. 开放阻塞缺陷（BLOCKER）

| 编号 | 严重级 | 模块 | 破坏什么 | 检测命令 | 当前结果 | 通过判据 |
|---|---|---|---|---|---|---|
| **R2-1** | **P2** | 编排／成员身份 `src/host/team/dispatch.ts`（`memberNameFor` :103-120，使用点 :245） | 中文任务 id 或仅大小写/分隔符不同的 id，归一后**塌缩成同一成员名**（`登录流程`→`dev`；`Login_Flow`/`login-flow`→`dev-login-flow`）；`dispatchReady` 无去重 → 第二个就绪任务在宿主重名时**永久 pending**（实测 `创建成员失败：TEAM_MEMBER_EXISTS dev`）。任务身份在成员名里丢失，连带 AC-16 消息 `to`、AC-17 按名重绑均歧义 | `node logs/teamflow/tf-mvv49icd-0axwfe/scripts/qa-collision-probe.mjs` | **exit 1，1/5 PASS**（C2/C3/C4/C5 FAIL，C1 拉丁对照 PASS） | exit 0，`QA COLLISION PROBE RESULT: 5/5 passed`；同时 `qa-reverify-probe.mjs` 仍 9/9、`pnpm -s test` 仍 0 fail |

**根因与建议修法**（不要在同一正则上叠补丁）：`memberNameFor` 现在同时承担「字符集归一」与「任务身份编码」，后者被前者吃掉。建议 **先编码身份段再归一**（保序映射或带短序号后缀，如 `dev-t1` / `dev-t1-2`），并把「归一后成员名两两唯一」做成 `dispatchReady` 的硬断言 + 单测（多任务视角，而不是现在的单任务合法性视角）。修完必须回归：`qa-collision-probe` 5/5、`qa-reverify-probe` 9/9、`pnpm test` 0 fail。

## 5. 非阻塞缺口（不改变 verdict，但收口前应处理）

1. **AC-6 声明缺失**：`@deepseek-ai/*` 未进 `peerDependencies`（样本有 13 条 optional peer）。建议按样本补齐（纯声明、无副作用），同时更正 QA-REPORT §6 第 6 行「全在 peerDependencies」的不实证据。
2. **交付未提交**：`git log --oneline -1` 仍是 `150eb5b chore: baseline before teamflow run`，`git status --porcelain --untracked-files=all` = **63 项**。T9「交付自检与单一提交」标 done，但提交未发生——当前 HEAD 装不进 profile（产物在未提交的工作树里）。收口必须补一笔提交并复跑产物自检。
3. **backlog 镜像与事实不一致**：`bugs.json` 中 `bug-1..bug-5` 仍为 `open`，而这 5 个（D1/D2/N1/N2/A-1）已由 dev 修复、QA 复验通过；应改终态，否则看板长期恒红、失去信号（与项目记忆里「状态与证据分离」的定例一致）。
4. **AC-20 缺运行期断言**：技能正文进 prompt 的链路是静态可读的（`index.ts:90-119`），但没有一条断言「成员 prompt 含某个技能正文的特征句」。建议补一条纯函数断言，避免日后被「有 skills 文件但没进 prompt」这类静默回归咬到。
5. **P3 工艺项**（沿用 QA 观察，不阻塞）：`RolesTab.tsx` 的 `aria-*` = 0（其他页签 2~7 处），键盘/读屏语义弱；面板失败态无「重试」入口。

## 6. 人工补测清单（环境限制，非交付缺陷）

| # | 项 | 方法 | 由谁做 |
|---|---|---|---|
| 1 | AC-9/10/11 真机 profile 安装 + 重启加载（含回滚演练） | `cd ~/.dsh/profiles/desktop && pnpm add file:<repo>` → 登记 `dsh.profile.bundles` → 重启 → 启动日志出现 `[auto-team]` 行；失败即 `pnpm remove dsh-auto-team` + 摘 bundles | **主 agent**（子代理权限固定在工作区，装不了） |
| 2 | GUI 可见性：输入框下开关行、右栏四页签、两挂载面同一 store | 开关默认关 → 打开 → 面板出现；两个挂载面状态同步 | 人眼 / 截图 |
| 3 | AC-22 真机 per-role 模型落地 | 给角色指定 provider/model → 派发 → 成员行「已核对」且实际模型一致；漂移显示「未下发」并拒绝派发 | 真机 + 宿主日志 |
| 4 | 宿主真实重名成员行为（R2-1 后果面） | 两个中文 id 任务派发，观察宿主是拒绝建人还是自动改名 | 真机 |
| 5 | 视觉观感（遮挡/动画/字号层级） | 人工目视 | 人眼 |

## 7. 架构一致性判定（M3 门禁）

- **蓝图符合性**：蓝图 29 个文件全部存在、无越界新建；`src/shared` 只放纯类型，`host`↔`client` 零直接 import（`grep -rn "from '\.\./host/" src/client` = 0）；三处「只允许一处」的映射都守住（宿主 4 态→7 态只在 watcher、`{data,error}` 解包只在 `client/api.ts`、记忆读/写/删共用 `safeMemoryName`）；门禁已从 `spawnSync` 改异步 + 注入 `GateExec`；`viewmodel.ts` 把可核验文案从 JSX 里抽成纯函数（25 例单测）。
- **已记录偏差**（QA §7，不改变契约语义）：记忆/角色 repo 保持同步返回值而非蓝图 `Promise<Result<T>>`；`GATE_FAILED` 为窄化补充常量；`MessageRecord.from` 取 `string`。**接受**，但三条应写进技术方案修订，否则下一位会照着蓝图改回异步而连带打断 bridge。
- **结构缺陷**：`memberNameFor` 一函数承担两职责（§4 根因），属**设计层缺陷**，修复时应重构而非补丁。
- **判定**：架构层未构成「严重偏离/结构破坏」，但功能未全绿（1 个 P2 开放）+ 交付未提交 → 不满足通过条件。

## 8. 产品经理决策请求（按 host 规则，终局由人定）

本报告的判定是「当前交付状态不可通过」。三个选项请主人选一：

1. **返工后复验（推荐）**：修 R2-1（含多任务唯一性单测）+ 补 AC-6 声明 + 更正 QA §6 + 补收口提交 → 重跑 `qa-collision-probe`（须 5/5）与 `pnpm test/typecheck/build/两产物 import` → 再走一次验收。
2. **带已知缺陷接受**：需你明确接受「同角色多个中文 id 任务时第二个不派发、消息与重绑歧义」，并把它写进 README 已知限制；**不建议**——中文任务名是本产品的主要使用场景，不是边角。
3. **降级交付**：只交付脚手架能力（单任务派发 + 面板 + 记忆），把多任务并行标注为实验特性，待 R2-1 修复后再放开。

验收结论：❌ 不通过
