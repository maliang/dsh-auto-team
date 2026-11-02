# ACCEPTANCE · r11 团队写域 / 计划续派 / 单任务干预 / 队长留痕

- 需求：`docs/teamflow/20261102-r11-team-scope-control`（PRD 40 条 AC：P0 33 / P1 7）
- 交付提交：`bdba5f8 feat(r11): 团队写域互斥排队 + 计划续派 + 单任务取消/跳过/改验收 + 队长留痕`（41 files，+11522 / −3552，含 `lib/` 双产物与任务夹四件文档）
- 分支：`feat/auto-team-plugin` ｜ 验收时间：2026-11-02 16:2x
- 环境：macOS，Node 22；沙箱内无第二宿主、无浏览器 → AC-37/38 列人工补测（非交付缺陷）

## 0. 结论摘要

- 门禁全绿：typecheck 0、**562/562**（回归线 ≥484）、build 双产物新鲜、两产物 `import` exit 0、pack 三件、工作树除文档外无改动。
- 40 条 AC 中 **36 条本轮实测通过**；**AC-37 / AC-38 属真机项**（环境限制，已列人工补测清单）；**AC-36 与 AC-40 的字面判据与设计/流水线事实存在出入**，按设计意图判通过并在 §5 逐条说明（非实现缺陷）。
- 架构一致性（M3）：蓝图 22 个模块路径全部存在、导出名与签名逐项命中，单源约束成立，无重复实现、无适配层漂移、无既有结构破坏 → **无架构返工项**。
- 开放缺陷：仅 4 条 P3 观察（D4/D5/D6 + 新增 O1），无 P0/P1/P2。

## 1. 门禁实测（命令 + 返回值）

| 命令 | 实测 |
|---|---|
| `pnpm -s typecheck` | exit 0 |
| `pnpm -s test` | exit 0，**562 passed / 0 failed**，4952ms（≥484 达成） |
| `pnpm -s build`（交付内产物） | `lib/index.js` 364827 B、`lib/client.js` 273697 B，mtime Nov 2 15:44 |
| `find src -name '*.ts*' -newer lib/index.js \| wc -l` / 同 `lib/client.js` | **0 / 0**（产物不旧于源码） |
| `node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')"` | exit 0，`IMPORT_OK` |
| `npm pack --dry-run` | `cordis.patch.yml` 646B、`lib/client.js` 273.7kB、`lib/index.js` 364.8kB，total files 5 |
| `git show --stat bdba5f8` | 41 files，含 `lib/` 两产物、`docs/teamflow/memory.md`、任务夹 PRD/DESIGN/TECHNICAL/QA-REPORT |

## 2. 交付形态契约（8 条，逐条可执行判据）

| # | 判据 | 实测 |
|---|---|---|
| 1 | 宿主入口 `name` = 包根名 | `cordis.patch.yml`：`- insert: - id: auto-team-host / name: 'dsh-auto-team'` ✅ |
| 2 | client 声明字段集与样本一致 + 产物含包 id | `dsh.client = { platform:"web", inject:[7 个 @deepseek-ai/dsh-client-*], immediately:false }`；`grep -c dsh-auto-team lib/client.js` = 15 ✅ |
| 3 | UI 挂载点 `name` 逐字等于 slot 名 | `src/client/slots.ts:350/355/374/379/386` 五处全部 `ctx.slots.inject(X, () => ctx.slots.register({ name: X, … }))`，`X` 与 `name` 同一字符串；`PLUGIN_ID` 只进 `id`/`key`（`conversation.input.left` / `conversation.session.header.actions` / `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title` / `settings.section`）✅ |
| 4 | 入口声明与产物进 files | `files = ["lib","cordis.patch.yml","README.md"]` ✅ |
| 5 | 依赖协议可被 profile 解析 | `grep -c 'workspace:' package.json` = 0 ✅ |
| 6 | 宿主依赖按 peer/可选 peer 声明 | `peerDependencies` 8 项、`peerDependenciesMeta` 8 项全 `optional:true`（7 个 `@deepseek-ai/*` + `react`）✅ |
| 7 | 构建产物与源码同步 | §1 两处 `find -newer` = 0；且 A1–A6 探针直接跑 `lib/` 产物，行为与源码一致 ✅ |
| 8 | 装载安全：两产物顶层不抛 | 双 import exit 0 ✅ |

## 3. 40 条 AC 逐条核对

证据缩写：**G**=§1 门禁；**P6**=`scripts/qa-r11-artifact-probe.mjs` 6/6；**I3**=`scripts/qa-r11-interface-sweep.mjs` 3/3；**T3/T4/T5**=`scripts/t3-tools-gate.mjs` 6/6、`t4-e2e-deviation-actions.mjs` 6/6、`t5-panel-flow.mjs` 10/10；**U152**=8 个定向单测文件 152/152；**S**=静态核对（grep 命中处）。

| AC | 判据 | 证据 | 结论 |
|---|---|---|---|
| 1 | 提示词两条硬规则可 grep、段落 ≤2600 | `test/captain.test.ts:79` 断言 `SECTION_MAX = 2600`；**T3-2** plan description 命中「单任务/简单任务/不自己动手」 | ✅ |
| 2 | `plan` description 明示单任务合法 | **T3-2**；**U152**「工具面 8 个，plan description 明示单任务合法」 | ✅ |
| 3 | 单任务计划可 dispatch 出 1 成员 | **P6-A1**（8 工具全表）+ 单任务 dispatch 路径由 `test/dispatch.test.ts` 覆盖 | ✅ |
| 4 | 三条验收模板可执行（应过 exit 0 / 应败非 0） | `test/acceptance.test.ts` 真实 `bash -c` 执行；**U152** 152 passed 含该文件 | ✅ |
| 5 | 选不出时 `command:null` + 三条模板原文 | 同上；`ACCEPTANCE_TEMPLATES` 单源于 `src/host/plan/acceptance.ts:21` | ✅ |
| 6 | `plan`/`add_tasks` 空验收整批拒绝不落盘 | **T3-3**（`ok=false`、点名 t2、模板逐字、store 未变）；**U152**「AC-6：plan 空验收整批拒绝，且 store 一处未写」「add_tasks 的三种拒绝都不落盘」 | ✅ |
| 7 | gate 空验收原文保留 + 追加模板 | `src/host/gate/gate.ts:50` `EMPTY_ACCEPTANCE_SENTENCE='该任务没有验收命令，需要人工确认后放行'`；:58 `TAIL` = 该句 + `ACCEPTANCE_TEMPLATE_BLOCK`（模板从 `acceptance.ts:18` 单源引入） | ✅ |
| 8 | 第 8 个工具 `add_tasks`，`sessionOf` 仍 1 处 | **T3-1** 工具名全表含 `auto_team_add_tasks`；**T3-6** `sessionOf` 代码命中 1 处（`src/host/tools.ts:59/63`） | ✅ |
| 9 | add_tasks 幂等 / 原子 / id 规则 / 跨批依赖 | **T3-4**（首次 `added=["t2","t9"]`、二次 `added=[]`、tasks=3、runs=1、store 字节不变）；**U152** AC-9/AC-11 用例 | ✅ |
| 10 | 已终止 run 追加被拒且 store 不变 | **T3-5**（`ok=false`、回显 runId、状态中文、store 未变）；**U152** AC-10 | ✅ |
| 11 | 追加后快照 tasks 增加且 runId 不变 | **T3-4**（tasks 3、runs 1）；**U152** AC-9/AC-11 | ✅ |
| 12 | `writeScopes` 归一与非法拒绝 | **U152**「归一：去 ./、折叠 //、去尾 /、反斜杠」「非法输入三类各给可读原因码（AC-12）」；`src/host/tools.ts:131-149` 只调 `normalizeWriteScopes` | ✅ |
| 13 | 冲突 = 相等或目录边界前缀；`src/hostile.ts` 反例不冲突 | **U152**「冲突真值表：相等 / 目录边界 / 反例（`src/host` 与 `src/hostile.ts` 不冲突）」；**I3** I3 等待文案单源 | ✅ |
| 14 | waiting 不占并发、带 `waitingOn`/`waitReason` | **P6-A4**（无依赖双冲突 → t2 `waiting`、只 spawn 2）；**U152**「AC-14 不 spawn、不占并发位」 | ✅ |
| 15 | 5 种终态均释放写域并唤醒 | **U152**「写域释放：五终态各释放一次，非终态（rework）不释放」；**P6-A5** done 释放后 waiting→pending | ✅ |
| 16 | 无锁表，重启按计划顺序重算 | **U152**「重启：waiting 与写域字段原样存活，按计划顺序重算」「磁盘上残留的不一致等待关系被重算」；`scopeHoldersOf` 纯派生、`RunState` 无锁字段 | ✅ |
| 17 | 等待边只指向 running（无死锁）+ 同批重叠串行 | **U152**「同批写域重叠按计划顺序串行」；`test/scope.test.ts`「只有 running/gate 是持有者」 | ✅ |
| 18 | 每次释放每等待者恰 1 条消息，重放不重复 | **P6-A5** `rel-t1-t2-` 恰 1 条；**U152**「AC-18 各恰一条通知」 | ✅ |
| 19 | 快照 `scopeLocks` + `waitReason`，宿主生成文案 | **P6-A4**（`scopeLocks` 含 t1 行、waiter 原因逐字）；**I3** I3 `waitReasonOf('t1','src/host')==='等待 t1 释放 src/host'` | ✅ |
| 20 | 面板 scope-locks 区块与 wait-reason 逐字 | **T5** AC-20a~e 全 PASS（等待条逐字、不 trim 不拼接、空 → 0 行） | ✅ |
| 21 | 零新增槽位注册，`name` 逐字等于 slot | `git diff bdba5f8^ bdba5f8 -- src/client/slots.ts` **空**；`grep -c "slots.register("` 仍 5 | ✅ |
| 22 | deviation 字段与 jsonl 落点（≤120 字摘要） | **T4-E1**（队长 write 落盘，仓库外临时 `.dsh/auto-team/deviations.jsonl`）；`DEVIATION_REASON_MAX=120` 单源 `config.ts:231`；限见 §5-① | ✅（附观察） |
| 23 | fail-open：记录失败不影响工具结果 | **U152** `test/deviation.test.ts` fail-open 用例；**T4-E2** 成员 write 不落盘且不影响结果 | ✅ |
| 24 | 60s 同键合并计数 + 面板 deviations 可查 | **T5** AC-24a/AC-24b（合并后显示 ×3、Σcount=3）；**T4** 终态 deviations=1 | ✅ |
| 25 | `PanelAction` 15→18 三动作走既有 `/act` | `src/shared/types.ts` `type: '...'` 共 18 条（含 cancelTask/skipTask/updateAcceptance）；`src/host/http.ts:58` `POST ${BRIDGE_ROUTE}/act` 未新增路由 | ✅ |
| 26 | cancel/skip/updateAcceptance 允许与拒绝面 | **T4-E3/E5**（cancel→t2 blocked、skip→t3 skipped、updateAcceptance 生效）；`src/shared/task-actions.ts` 39 格允许表 | ✅ |
| 27 | 面板三按钮 disabled 矩阵 + 改验收弹层 | **T5** AC-27a/AC-27b（终态三动作全禁用且原因齐全、与 `TASK_ACTION_ALLOW` 一致）；**U152** client-contract 空值 0 请求 | ✅ |
| 28 | 形状扩张登记；kind 9 / 路由 3 / setInterval 1 不变 | `TaskStatus` 13（`store.ts:282-299`）、工具 8、`PanelAction` 18；`ActivityEvent.kind` 9（`types.ts:493-505`）；HTTP 仅 1 条 prefix 路由分发 3 个动作面；真实 `setInterval` 仅 `watcher.ts:296`；四常量各 1（`config.ts:222-231`） | ✅ |
| 29 | `pnpm test` ≥484 且 typecheck 0 | §1：562/562、typecheck exit 0 | ✅ |
| 30 | 宿主入口 `cordis.patch.yml` name = 包根名 | 形态① | ✅ |
| 31 | `dsh.client` 字段集逐字段一致 + 产物含标识 | 形态② | ✅ |
| 32 | UI 挂载点 name 逐字等于 slot，标识进 id/key | 形态③（**P6-A6** 产物级复证） | ✅ |
| 33 | files 含 lib 与 cordis.patch.yml，pack 三件 | 形态④ + §1 `npm pack` 三件 | ✅ |
| 34 | package.json 无 `workspace:` | 形态⑤：0 命中 | ✅ |
| 35 | peer/peerMeta 覆盖宿主 7 包 + react 且 optional | 形态⑥：8/8 全 optional | ✅ |
| 36 | 双产物与源码同步 + 顶层不抛（import exit 0） | 同步与装载停滞均达成（§1、形态⑦⑧）；**字面「两产物均含 `add_tasks`/`writeScopes`」不成立，见 §5-②** | ✅（按意图） |
| 37 | 主 agent 安装与回滚步骤可照做 | 步骤已写入两块 README；本沙箱无第二宿主、`dsh` 不在 PATH → 列人工补测 #1 | 待人工 |
| 38 | 真机：占用区块 / 等待文案 / add_tasks 前后快照 | 无浏览器与第二宿主 → 列人工补测 #2/#3 | 待人工 |
| 39 | memory.md 回填四条约定，AGENTS.md 正文不动 | `git diff bdba5f8^ bdba5f8 -- AGENTS.md` **空**；`docs/teamflow/memory.md:37` 七条口径齐全（简单任务也派成员、空验收拒绝+三模板、写域归一与目录边界、13 态/waiting 语义、add_tasks、留痕、PanelAction 15→18） | ✅ |
| 40 | 单笔提交 + 工作树 clean + 报告 hash 与门禁数 | 单笔 `bdba5f8`（41 files）含代码+双产物+四件文档 ✓；**当前工作树非空**：`M QA-REPORT.md`（QA round-2 在提交后重写）+ 本文件（验收产物）→ 见 §5-③ | ✅（附待办） |

## 4. 架构一致性检查（M3，必做）

| 检查项 | 结论 |
|---|---|
| 蓝图模块是否按计划抽出 | ✅ 22 个蓝图路径全部存在；**I3-I1** 逐个 import 核对 15 个模块的导出名与 `typeof` 全命中（`plan/scope`、`plan/acceptance`、`plan/plan`、`plan/graph`、`team/scope-locks`、`team/deviation`、`team/dispatch`、`store`、`tools`、`bridge`、`adapters`、`index`、`config`、`paths`、`gate`、`client/viewmodel`、`client/ui`） |
| 装配顺序 | ✅ `src/host/index.ts` 既有八段装配保留，deviation 记录在第四段后以 try/catch + warn 追加（fail-open 只在 recorder 内部） |
| 抽象是否缺失 | ✅ 纯函数与 IO 分离：`scope.ts`（归一/冲突/锁视图/文案）、`acceptance.ts`（模板/建议）、`deviation.ts`（合并/读写/recorder）、`shared/task-actions.ts`（39 格允许表 + 13 态标签）均单点导出 |
| 重复实现 | ✅ 无：`conflictingScopes` 只定义于 `plan/scope.ts`，消费者仅 `team/scope-locks.ts:68/90/176`；`waitReasonOf` 宿主版（`plan/scope.ts:151`）与 client 版（`client/viewmodel.ts:749`，纯透传不 trim 不拼接）语义不同，非第二份实现；`ACCEPTANCE_TEMPLATES` 只在 `acceptance.ts:21`；`TASK_STATUS_LABELS` 只在 `shared/task-actions.ts:121`，宿主拒绝文案（`bridge.ts:852/1083/1156/1182`）与 client 徽标共读 |
| 适配层漂移 | ✅ 宿主 API 仍只在 `adapters.ts`；`agentContextOf` 复用；client → host 直接 import = 0 |
| 既有结构破坏 | ✅ 路由仍 1 条 prefix（3 动作面）、槽位注册仍 5、`setInterval` 仍 1、`RunState` 版本仍 3（新字段全可选） |

→ **无架构返工项**，不构成「有条件通过」的事由。

## 5. 意见与遗留

① **D4（P3·留痕会话口径）**：`src/host/index.ts:86` `const DEFAULT_SESSION = 'current'`，`:341` 以 `sessionId: DEFAULT_SESSION` 注入 deviation recorder；快照 `deviations` 不按会话过滤 → 跨会话可见彼此留痕。与 r11 刚修的真机事故同族（工具侧已改走 `exec.agent.id`），TECHNICAL 已登记取舍，**不阻断**；建议下轮把 recorder 的 sessionId 也接到真实会话。
② **AC-36 字面不成立（AC 文本过宽，非实现缺陷）**：实测 `lib/index.js` 命中 `add_tasks` 5 行、`writeScopes` 21 行；**`lib/client.js` 两者均 0 命中**，且 `grep -rn "writeScopes\|add_tasks" src/client/` = 0——客户端按设计不消费这两个符号（面板写域信息来自快照 `scopeLocks`/`waitReason`，即 AC-19/20 的判据）。产物同步由两条更硬的证据支撑：`find src -newer lib` = 0/0、A1–A6 探针直接跑 `lib/` 产物且行为与源码一致。建议 PRD 把该条改为「宿主产物含本轮特征串、client 产物 mtime 不旧于 `src/client`」。
③ **AC-40 工作树非空（流水线结构性，非交付缺陷）**：代码与双产物确实在单笔 `bdba5f8` 内且当时自洽；此后 QA round-2 重写了 `QA-REPORT.md`，本文件又产生于验收阶段——「四件文档同笔提交 + 树为空」在验收阶段无法自洽。**待主 agent 收口**：把 `QA-REPORT.md` 与本文件同笔补提交，工作树即回到 clean。
④ **D5/D6（P3·UI craft）**：空闲态无「0 占用 / 0 痕迹」常驻指示（与 AC-21 的 0 节点一致）；三动作禁用原因只在 `title`/`aria-label`，无可见文本。
⑤ **O1（P3·新增观察）**：面板只渲染「真占锁」的写域区块，任务**已声明但未占锁**的 `writeScopes` 在 client 侧零引用、不显示；DESIGN:6「UI 只是把它们显示出来」有轻微出入，AC-19/20 未要求，记观察。
⑥ **人工补测清单（环境限制，非缺陷）**：安装/回滚（AC-37）、真机面板与等待文案逐字（AC-38）、三动作真机点击（AC-27）、320px 右栏不溢出、读屏播报、重启等待重算（AC-16 真机段）、空闲态可读性——见 QA-REPORT §10 的 7 项。
⑦ **过程证据保留**：本轮复跑的 5 个探针与定向单测均在 `logs/teamflow/tf-mvynaqhi-o4q3jo/scripts/`，run 结束由 host 归档。

## 6. 验收判定

功能面 36 条 AC 有本轮实测证据，2 条（AC-37/38）属真机项已列补测，2 条（AC-36/40）为字面判据与设计/流水线事实的出入并已说明；架构对齐蓝图、单源成立、无重复实现或结构破坏；开放缺陷仅 4 条 P3 观察，无 P0/P1/P2。

验收结论：✅ 通过
