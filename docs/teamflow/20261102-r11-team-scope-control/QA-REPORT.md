# QA-REPORT · r11 团队写域 / 续派 / 单任务干预

- 需求：docs/teamflow/20261102-r11-team-scope-control（PRD 40 条 AC：P0 33 / P1 7）
- 分支：feat/auto-team-plugin ｜ HEAD：7843d3c ｜ 工作树：26 M + 13 ??（r11 全部改动未提交）
- 结论：**不可进入验收** —— 3 个 P1 阻断（类型门禁红、回归线 2 条旧断言红、产物与提交未收口）；功能面 37/40 条 AC 有实测证据，3 条待真机/收口。
- 环境：macOS，Node 22，沙箱内**无法启动浏览器**（宿主 token 限制，非交付缺陷）→ UI 以「静态契约 + 纯函数视图 + DOM 无关断言」验证，真机项进「人工补测清单」。

## 1. 门禁实测（2026-11-02 14:2x–15:0x）

| 命令 | 结果 |
|---|---|
| `pnpm -s typecheck` | **exit 2，9 条 TS 错**（见 D1） |
| `pnpm -s test` | **exit 1，tests 562 / pass 560 / fail 2**（均在 test/wire.test.ts） |
| `pnpm -s build` | exit 0，lib/index.js 364827B + lib/client.js 273697B（35ms） |
| `node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js'); console.log('IMPORT_OK')"` | exit 0，`IMPORT_OK`（两产物顶层不抛） |
| `npm pack --dry-run \| grep -E 'lib/(index\|client)\.js\|cordis\.patch\.yml'` | 命中 3 件（364.8kB / 273.7kB / 646B） |
| `node logs/teamflow/tf-mvynaqhi-o4q3jo/scripts/qa-r11-probe.mjs` | **21/21 PASS**（独立 apply() 起假 ctx，走 8 工具 + 3 路由） |
| 关键单测子集：scope/acceptance/task-actions/deviation/tools/dispatch/graph/gate/bridge/host-contract | 179/179 pass |
| client 子集：client-contract/client-ui/viewmodel | 91/91 pass |
| 变异：`scopesConflict` 目录边界改回裸 `startsWith` | test/scope.test.ts **2 fail**（`src/host` vs `src/hostile.ts`）；还原后 10/10 pass、`git diff` 空 |

## 2. 交付形态契约（8 条，逐条可执行判据）

| # | 判据 | 实测 |
|---|---|---|
| 1 | 宿主半加载入口 `name` = 包根名 | `cordis.patch.yml`：`- insert: - id: auto-team-host / name: 'dsh-auto-team'` ✅ |
| 2 | client 声明字段集与同仓样本一致 + 产物含包 id | `dsh.client = {platform, inject, immediately}`（与 profile 内 dsh-better-sidebar 等同类字段集一致，无自造字段）；`grep -c "dsh-auto-team" lib/client.js` = 15 ✅ |
| 3 | UI 挂载点 `name` 逐字等于 slot 名 | `src/client/slots.ts:350-387` 五处 `slots.inject(X, () => slots.register({ name: X, … }))`，`inject` 与 `name` 同一常量 ✅ |
| 4 | 入口声明与产物进 files | `files = ["lib","cordis.patch.yml","README.md"]` ✅ |
| 5 | 依赖协议可被 profile 解析 | `grep -c "workspace:" package.json` = 0 ✅ |
| 6 | 宿主运行期依赖按 peer 声明 | peerDependencies 与 peerDependenciesMeta 各 8 项（7 个 @deepseek-ai/dsh-client-* + react）✅ |
| 7 | 产物与源码同步 | QA 起始 **22 个 src 比 lib/index.js 新**（D3）；QA 重跑 build 后 `find src -name '*.ts*' -newer lib/index.js \| wc -l` = 0 |
| 8 | 装载安全（顶层不抛） | 双产物 import exit 0 ✅ |

## 3. 功能用例与结果

| AC | 判据 | 结果 | 证据 |
|---|---|---|---|
| AC-1 | 两条硬规则可 grep + 段落 ≤2600 | PASS | probe C9：`CAPTAIN_CONSTRAINTS` 命中「不亲自干细活/只做三件事」；段落 text 长度 ≤2600；无「当前会话已/未启用」断言 |
| AC-2 | plan description 明示单任务合法 | PASS | probe C9 正则 `单任务计划合法` 命中 |
| AC-3 | 单任务计划可 dispatch 出 1 成员 | PASS | probe E4（maxConcurrent=2 只起 2 人，含单任务路径）+ dispatch 用例 |
| AC-4 | 三条模板真跑（应过 0 / 应败非 0） | PASS | probe C6：`pnpm typecheck`(exit 0 基线见 D1 说明)、`grep -RIn -F`、`git status --porcelain` 三类各跑正/负样本 |
| AC-5 | 选不出 → `command:null` + 「选不出」+ 三条原文 | PASS | probe C5 |
| AC-6 | plan/add_tasks 空验收整批拒绝不落盘 | PASS | probe E2/E9：拒绝后 store 目录文件集合与内容字节不变 |
| AC-7 | gate 空验收旧句逐字在前 + 模板随后 | PASS | probe C7 |
| AC-8 | 第 8 个工具 add_tasks；sessionOf 单一口径 | PASS | probe E1（8 工具名逐字）；`grep` sessionOf 定义 1 处、8 个工具各调 1 次；**但类型层有 D1** |
| AC-9 | 幂等/原子/id 规则/跨批依赖 | PASS | probe E8（第二次 added=0、runId 不变、文件字节不变）、E9 |
| AC-10 | 已终止 run 追加被拒且 store 不变 | PASS | probe E11 |
| AC-11 | 追加后快照 tasks 增加且 runId 不变 | PASS | probe E8 |
| AC-12 | writeScopes 归一与非法拒绝 | PASS | probe C3（合法 5 组/非法 5 组） |
| AC-13 | 冲突=相等或目录边界前缀 | PASS | probe C4 真值表 + 变异（裸 `startsWith` → 2 红） |
| AC-14 | waiting 不占并发 + waitingOn/waitReason | PASS | probe E4（maxConcurrent=2 只起 2 人，第三任务 waiting） |
| AC-15 | 5 种终态释放写域并唤醒 | PASS | test/dispatch.test.ts:1231「五终态各释放一次，rework 不释放」 |
| AC-16 | 无锁表，重启按计划顺序重算 | PASS | probe E6（新 store 载入 + `deriveScopeLocks` 重算，t1 仍是持有者） |
| AC-17 | 等待边只指 running（无死锁）+ 同批重叠串行 | PASS | test/dispatch.test.ts:1188 同批串行；probe E4 顺序断言 |
| AC-18 | 每次释放每等待者恰 1 条，重放不重复 | PASS | probe E7（`rel-t1-t2` 恰 1 条、waiting→pending、下一轮派出）+ dispatch 用例 |
| AC-19 | 快照 scopeLocks + waitReason，宿主生成 | PASS | probe E5（文案 `等待 t1 释放 src/host` 与宿主生成逐字一致） |
| AC-20 | 面板区块与 wait-reason 逐字、空矩阵 0 节点 | PASS（静态） | test/client-contract.test.ts 25/25（hook 与顺序、空数组 0 节点、零拼装）；真机见补测 |
| AC-21 | 零新增槽位注册，name 逐字=slot | PASS | `grep -c "slots.register\|slots.inject" src/client/slots.ts` = 13 = HEAD 13 |
| AC-22 | deviation 字段 + jsonl 落点 + 不记正文 | PASS | probe E12（write/edit 各 1 条、bash 不记、paths 逐字、reason ≤120、落 `~/.dsh/auto-team/deviations.jsonl`） |
| AC-23 | fail-open：记录失败不影响工具结果 | PASS | test/deviation.test.ts（注入坏 writer 后 record 不抛）+ index.ts 订阅外层 try/catch |
| AC-24 | 60s 同键合并计数 + 面板可查 | PASS | probe E12（连续两次 write → count=2；被不同键打断 → 新成一条；文件行数与快照条数一致） |
| AC-25 | PanelAction 15→18 走既有 /act | PASS | `PanelAction` 成员 18；probe E10 三动作全走 `POST /api/auto-team/act` |
| AC-26 | cancel/skip/updateAcceptance 允许与拒绝面 | PASS | probe E10（运行中拒绝 skip 且文案含 id+状态中文；空验收拒绝含模板） |
| AC-27 | 39 格 disabled 矩阵 + 改验收弹层 | PASS（静态） | test/client-ui.test.ts:363 `cells === 39`；PlanTab 浮层 `role=dialog aria-modal=false`、Esc/外部点击/焦点归还 |
| AC-28 | 形状扩张登记；kind9/路由3/setInterval1 不变 | PASS | TaskStatus 13、PanelAction 18、工具 8、kind 9、路由 3、`setInterval` 1、DEVIATION_ 常量 4 |
| AC-29 | pnpm test ≥484 且 typecheck 0 | **FAIL** | 见 D1、D2 |
| AC-30 | 入口 name=包根名 | PASS | 见交付形态 #1 |
| AC-31/32 | dsh.client 字段一致 + 挂载点 name=slot、标识进 id/key | PASS | 见 #2、#3（keyed slot 带 `key: PANEL_KEY`） |
| AC-33/34/35/36 | files 含 lib 与 patch、无 workspace:、peer 覆盖、双产物同步且顶层不抛 | PASS | 见 #4–#8 |
| AC-37 | 安装与回滚步骤可照做 | **未完成** | PRD:173 有步骤；ACCEPTANCE.md 尚未生成（验收阶段产出），本轮不计缺陷 |
| AC-38 | 真机：占用区块/等待文案/add_tasks 前后快照 | **未验证** | 沙箱无法起宿主/浏览器 → 人工补测清单 |
| AC-39 | memory.md 回填四条，AGENTS.md 不动正文 | PASS | `git diff AGENTS.md` 空；memory.md:37 含七条 r11 约定 |
| AC-40 | 单笔提交 + 工作树 clean | **FAIL** | 见 D3 |

## 4. 缺陷表

| 编号 | 严重级(P0/P1/P2/P3) | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| D1 | P1 | 类型契约（host 编排） | 1) `cd` 仓库根 2) `pnpm -s typecheck` | 0 条类型错误 | exit 2，9 条：`src/host/team/scope-locks.ts(10,55): TS2305 Module '"../../shared/types.ts"' has no exported member 'RunState'` + 同文件 85/103/129/130/163/168/181 TS7006 + `test/dispatch.test.ts(1302,43)` TS7006 | AC-29、AC-8 | `pnpm -s typecheck 2>&1 \| grep -c "error TS"` | 输出 `0`，且 `pnpm -s typecheck` exit 0 |
| D2 | P1 | 回归线（旧断言未随 7→8 更新） | 1) `node --test test/wire.test.ts` | 5/5 pass | 2 fail：`:226` AssertionError「必须注册 7 个工具，实际 8：…auto_team_add_tasks」；`:551`「工具面冻结为 7 个（r7 不加工具）」 | AC-29、AC-28 | `node --test test/wire.test.ts 2>&1 \| grep -c "^✖"` | 输出 `0`（`pnpm -s test` 562/562 pass） |
| D3 | P1 | 交付产物与收口 | 1) `git status --porcelain --untracked-files=all \| wc -l` 2) `find src -name '*.ts*' -newer lib/index.js \| wc -l` | 工作树 0 项、lib 与 src 同步（0 个新于产物） | 交付时 39 项未提交；QA 起始 22 个 src 新于 lib（lib 停在 12:04 的 r10 产物）——QA 为验证构建已重跑 `pnpm build`（现为 0），但源码一旦再改必须重跑 | AC-40、AC-33、AC-36 | `git status --porcelain --untracked-files=all \| wc -l` 与 `find src -name '*.ts*' -newer lib/index.js \| wc -l` | 两者均输出 `0`（含 `lib/` 双产物与任务夹文档的单笔提交） |
| D4 | P3（观察，不阻断） | 留痕会话归因（M4） | 1) 触发队长 `write` 2) 读快照 `deviations[].sessionId` 3) 用另一 sessionId 读快照 | 记录归属真实会话、面板按会话隔离 | `sessionId` 恒为 `DEFAULT_SESSION='current'`；快照 `deviations` 不按会话过滤，多会话下互见（TECHNICAL:138 已明示该口径，属设计取舍） | AC-22、AC-24 | `node logs/teamflow/tf-mvynaqhi-o4q3jo/scripts/qa-r11-probe.mjs 2>&1 \| grep -c "sessionId"`（E12 断言现值 'current' 与跨会话可见） | - |

## 5. 架构核查（M3，非功能项）

- 蓝图模块**全部落地且职责未漂移**：`src/host/plan/scope.ts`（纯函数零 IO）、`src/host/plan/acceptance.ts`、`src/shared/task-actions.ts`（13×3 单表）、`src/host/team/scope-locks.ts`、`src/host/team/deviation.ts`；`dispatch/graph/plan/store/watcher/gate/bridge/tools/adapters/index/paths/config/viewmodel/ui/PlanTab/styles` 均按蓝图接线。
- **单一来源成立**（抽查均只有一处定义）：13 态中文只在 `task-actions.ts`（bridge:852/1083/1156/1182 与 viewmodel:56-59 均引用同一表）；模板原文只在 `acceptance.ts:21`；等待文案只在 `scope.ts:151`；冲突判定只经 `conflictingScopes`（`scope-locks.ts:11` 导入，无第二份 `startsWith` 语义）；`DEVIATION_*` 四常量各 1 处；`interruptMember` 归一只在 `adapters.ts:747`。
- **未发现重复实现/该抽未抽**：无 host→client 越界（`grep -rn "from '\.\./host/" src/client` = 0）、无 client 侧第二份状态 switch、无自造 slot 文案拼装（`viewmodel.waitReasonOf` 为纯透传）。
- 一处**结构边界例外**（非缺陷）：`scopeLocks[].waiters[].label` 由 client 用宿主 `reason` 原文加 `{taskId} · {member}（…）` 包装，同时保留 `reason` 原字段；逐字断言应取 `reason`。

## 6. 人工补测清单（环境限制，非交付缺陷）

1. **AC-38 真机**：主 agent 用克隆 profile 起第二宿主（REAL-HOST-VERIFY.md），`GET /api/auto-team/snapshot?sessionId=<真实>` 前后两次对比 `tasks` 数（add_tasks）；面板 `[data-scope-locks]` 与 `[data-wait-reason]` 截图；单任务派发后成员数 1。方法：curl + 浏览器；工具：宿主 + 浏览器。
2. **AC-37 安装/回滚**：`cd ~/.dsh/profiles/desktop && pnpm add file:<repo>` → 重启 → 采样；回滚 `pnpm remove dsh-auto-team` + 还原 `dsh.profile.bundles`。仅主 agent 可执行（子代理写不了工作区外）。
3. **三动作真机点击**：改验收浮层 Esc / 外部点击 / 焦点归还、失败不关闭（沙箱无 react-dom，只能静态断言）。
4. **右栏 320px 视觉**：写域区块与等待条在窄栏是否挤压（DESIGN §1 备有副行方案），截图比对。
5. **无障碍播报**：`[data-deviation]` 头部计数变化、`[data-error]` 已用 `role=alert`，deviation 计数无 live 区（P3 观察）。

## 7. 结论

- 功能实现与蓝图一致，37/40 条 AC 有实测证据（probe 21/21、关键单测 270 例、变异可红可绿）。
- **不可进入验收**：D1（typecheck 9 错，导入符号不存在于目标模块——正是「存在性检查能过、编译不过」的那类）、D2（两条 r7 旧断言与 8 工具面冲突）、D3（产物与提交未收口）。三项修完重跑 `pnpm -s typecheck && pnpm -s test && pnpm -s build` + 双产物 import + pack + 工作树 clean 后，可直接进验收；D4 为设计取舍的 P3 观察。
