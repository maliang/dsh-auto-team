# ACCEPTANCE — r13 面板三页 + 自动派发 + 确认门禁 + 左栏项目库

- 任务夹：`docs/teamflow/20261103-r13-panel-tabs-sidebar/`；分支 `feat/auto-team-plugin`；HEAD `0d87357`
- 验收人：产品经理（验收阶段）；验收时间 2026-11-03 17:10（Asia/Shanghai）
- 验收方法：**不采信 QA 转述**，独立复跑全部门禁与 21 个探针；静态契约（形状计数、槽位、格式化单源）用源码 grep 交叉核对；真机项按 PRD 允许的「未验证」分支记录并交主 agent 收口。
- 基线：r11（写域/等待/门禁语义不回归）；本迭代三条 `取代` 已在 PRD 声明（r7#AC-14、r11#AC-26、r11#AC-28）。

## 0. 架构一致性巡检（M3 硬门禁）

| 检查 | 结果 |
|---|---|
| 蓝图模块落盘 | 宿主 5 个新模块（format/usage/auto-dispatch/confirm/library）+ 客户端 8 个 views + `LibraryPage`/3 页签全部落地；`qa-r13-arch-consistency` 16/16 |
| 装配单点 | `buildRunDetail` 仅 `src/client/viewmodel.ts:1448` 一处；`TasksTab`/`HistoryTab`/`LibraryPage` 三处 import 同一函数（AC-18） |
| 派发单点 | `auto-dispatch.ts` 内无 `act(` 调用，直调注入的 dispatch 闭包；`dispatchReady` 实现唯一（`src/host/team/dispatch.ts`） |
| 格式化单源 | 客户端 `formatDuration`/`toLocaleString`/`Intl` 命中 0；时长/千分位只在 `src/host/format.ts` |
| 样式注入点 | 仅 `AUTO_TEAM_CSS` 一个字符串 + 一个 `useAutoTeamStyle` |
| 结构破坏 | 未发现重复实现、适配漂移或既有语义被改写（`test/dispatch|scope|graph|bridge|store` 全绿） |

结论：**无「偏离蓝图 / 重复实现 / 该抽未抽」项**，不构成有条件通过理由。

## 1. 逐条验收（PRD AC-1~AC-28，P0/P1）

| AC | 判据要点 | 独立证据（实跑） | 结果 |
|---|---|---|---|
| AC-1 | `data-tab` 恰 tasks/history/memory；旧三页签 0 | `shape-probe` 11/11（含「旧页签残留=无」）；`TABS` 单源见 Panel.tsx:81 | ✅ |
| AC-2 | 任务页三区块齐备 | `views-render-check` ALL PASS；`views-bundle-check` 8/8 组件；真机 DOM 见 AC-25 | ✅（结构）/真机待补 |
| AC-3 | 每行 1 token + 1 duration；0≠不可得；反字数估算 | `qa-r13-view-probe`：改标题字符数后 token 仍 `13,023`；无 usage 显「不可得」`source=unavailable` | ✅ |
| AC-4 | 节点=任务、边=依赖、节点带 token/用时、无图形库 | `viewmodel` 单测（列距 188/行距 72、缺端边跳过）；`package.json` dependencies 空；无 d3/mermaid import | ✅ |
| AC-5 | 历史第 2 条 run 任务集合≠第 1 条 | `qa-r13-library-memory-probe` 13/13（专项断言「不是把同一份详情贴两次」） | ✅ |
| AC-6 | 仅 project 轨；public 夹具不出现；正文逐字；非法 workspace 拒绝 | 同探针：`project=true, public=false`；正文与磁盘字节相等；未知 workspace 拒绝 | ✅ |
| AC-7 | 右栏/左栏同 run 文本逐字相等；client 无第二套格式化 | `qa-r13-view-probe`：两侧 token/duration 数组逐字相同；client 格式化命中 0 | ✅ |
| AC-8 | 落盘 0 动作 3s 内 spawn；`dispatch` 调用 0；5 触发点变异 | `qa-r13-ac8-triggers` 13/13（5 cause 生产调用点齐）；`qa-r13-ac8-mutations` 6/6；`auto-dispatch` 不调 `act` | ✅（变异口径见 §3.3） |
| AC-9 | 自动派发守并发/依赖/写域/暂停四闸 | `auto-dispatch-probe` 15/15 + `test/auto-dispatch` 15/15（合体真实 `dispatchReady`） | ✅ |
| AC-10 | dispatch 仍强制 runId、幂等；工具 8 | `test/bridge|tools` 全绿；`shape-probe` 工具数 8/8；`sessionOf` 1 处 | ✅ |
| AC-11 | 5 类危险动作确认前状态不变、确认后生效、拒绝不改 | `qa-r13-confirm-matrix-probe` 18/18（10 例矩阵含 sha/成员数）；`r13-t4-confirm-e2e` 11/11 | ✅ |
| AC-12 | 7 类可逆动作零弹窗 2s 内生效 | `qa-r13-restart-flow-probe` 9/9（7 动作无 pendingId/无 dialog） | ✅ |
| AC-13 | 弹窗内容/Esc/同 run 单条/不自动过期/等待时长 | `confirm-gate-probe` 20/20；Esc 与焦点陷阱为真机项 | ✅（结构）/Esc 待补 |
| AC-14 | 左栏入口 + main 两栏 + 窄屏折叠 | `check-t7-wiring` 3 PASS（main 注册失败降级事件）；`slots` 常量 1 处；真机 DOM 未验证 | ⚠️ 真机待补 |
| AC-15 | 项目列表=全局+path 去重∪当前工作区；未知末位 | `library-perf-probe` 25/25；`qa-r13-library-memory-probe` 专项 | ✅ |
| AC-16 | 全局=public / 项目=project 来源互换 | 同探针（切换后两侧内容不同，正反向断言） | ✅ |
| AC-17 | 项目/任务/记忆三类详情 + 返回 | `qa-r13-detail-nav-probe` 13/13（真 store `openRun→detail→closeRun→切 run`） | ✅ |
| AC-18 | 共享契约 + `buildRunDetail` 单装配 + 两边 deep equal | `qa-r13-view-probe` AC-18 三条全 PASS；源码 grep 单点 | ✅ |
| AC-19 | 探针可复跑 + `ATTRIBUTION=` 结论行 + TECHNICAL 两节 | `token-usage-probe` 30/30，结论 `ATTRIBUTION=unavailable`；TECHNICAL §0.1/§0.2 齐备 | ✅ |
| AC-20 | 口径写死落盘、跨重启逐毫秒一致、formatDuration 单处 | `qa-r13-restart-flow-probe` 9/9；`test/auto-dispatch` 计时用例；client 格式化 0 | ✅ |
| AC-21 | 新字段全可选、旧 v3 夹具可读、load 不抛、version 仍 3 | `qa-r13-legacy-v3-probe` 5/5（真 `RunsStore` 写 v3 无新字段 → load 不抛；坏 JSON 返回 null） | ✅ |
| AC-22 | 形状计数：21/4/13/8/13/9/5/1/1 | `shape-probe` 11/11 逐项 PASS（与 TECHNICAL 登记表一致） | ✅ |
| AC-23 | 100 run 冷≤1s 热≤100ms；snapshot 期间 library 装配 0 | `library-perf-probe` 25/25（热 0.0004ms/次）；`library-cold` 冷 max 18.31ms；`detail-nav` 断言切 run 不触发装配 | ✅ |
| AC-24 | panellist/main 各 1 处、id 同值、UI-SLOTS 增 main 行、无 inspect | `shape`/`arch` 探针；`slots.ts` 常量；UI-SLOTS.md:26 已有 `main ⚠️未验证` 行 | ✅ |
| AC-25 | 第二宿主 51890 + CDP 断言 8 项 DOM 事实 | **未验证**（沙箱 token 不允许起浏览器）；PRD §11 已写「环境失败记未验证、禁 mock」 | ⚠️ 未验证 |
| AC-26 | test≥565/typecheck 0/build/新鲜/双 import/pack 3/deps 空 | 见 §2 门禁表，全部实测通过 | ✅ |
| AC-27 | 留 feat 分支、2 个 docs 目录入库、单笔提交、提交后 clean、.gitignore 补两项 | 分支✅；`.gitignore` diff 已含 `*.log`/`.pnpm-store/`✅；提交由 host 验收后执行（当前 52 项未提交） | ⏳ 待 host |
| AC-28 | memory.md 同主题行替换；AGENTS 正文/胶囊/三步注册不动 | `git diff memory.md` 仅 1 条 r13 合并口径（①②③④⑤）；`git diff AGENTS.md` 空 | ✅ |

## 2. 门禁数字（本轮独立实跑，2026-11-03 17:08~17:10）

| 门禁 | 命令 | 实测 |
|---|---|---|
| 类型 | `pnpm -s typecheck` | exit 0，0 error |
| 单测 | `pnpm -s test` | **666 / 666 pass**，fail 0（≥565） |
| 产物 | `lib/index.js` 435.6kB、`lib/client.js` 351.9kB（16:56） | 双产物存在 |
| 新鲜 | `find src -name '*.ts*' -newer lib/<产物>` | index 0 / client 0 |
| 加载 | 两条 `await import` | `IMPORT_OK` |
| 打包 | `npm pack --dry-run` | 5 文件，含 lib/index.js + lib/client.js + cordis.patch.yml（3/3） |
| 交付闸 | `r13-delivery-gate.mjs` | pass=28 fail=0 |
| 架构 | `qa-r13-arch-consistency.mjs` | pass=16 fail=0 |
| 形状 | `shape-probe.mjs` | pass=11 fail=0 |
| 探针 | 18 个 QA/专题探针原样复跑 | 全绿（ac8 13、变异 6、view 8、library 13、confirm 18、v3 5、detail 13、restart 9、attr 9、cold 5、autodispatch 15、confirm-gate 20、token 30、perf 25、views 渲染/打包、t7 3、t4-e2e 11） |
| 包形态 | deps 空、files=[lib,cordis.patch.yml,README]、dsh.client inject 7 包、peer 7+react 全 optional、无 `workspace:`、cordis name=`dsh-auto-team` | 全通过（AC-30/31/33/34/35） |
| 树噪声 | `git status --porcelain` 52 项 | 全为 src/test/lib/docs/.gitignore，无 node_modules/log/tgz |

## 3. 保留意见与遗留

1. **AC-25 / AC-14 真机未验证**（P0 环境受限）：沙箱内无法启动浏览器（host token 限制 PROCESS_SET_INFORMATION/PROCESS_SUSPEND_RESUME）；PRD §11 允许记「未验证」，但 QA-REPORT 未附**原始错误文本**，仅写了受限项名称 → 建议主 agent 补测时补原文。`main` 槽位（U2）是否真能打开主区，仍属未经验证的事实，降级路径已实现并有 `check-t7-wiring` 证据。
2. **AC-27 / AC-40 待 host 收口**：工作树 52 项（33 src、10 新 src、2 未跟踪 docs 目录、lib/docs/tests）留在 `feat/auto-team-plugin`，等待验收后单笔提交；提交 hash 与门禁数字须回填本报告/交付报告。
3. **AC-8 变异口径（如实记录，判据等效成立）**：原样移除 `tasks-added`/`task-terminal`/`member-exit kick` 单点不会变红（1.5s watcher tick 与 r11 触发器总线兜底）；隔离兜底后每个触发点均被证为 load-bearing（变异探针 6/6）。这是多层兜底的设计结果，不是漏实现。
4. **D5（P3，仍 OPEN）**：流转图节点 token/用时被截断时仅 `title` 悬停可读，触屏/键盘不可达。不影响 AC-4（节点确实带文本），列为后续无障碍改进。
5. **人工补测清单（主 agent 收口）**：AC-25 真机 CDP（AC-1/3/5/6/8/11/13/14/16）、`main` 槽位真机、弹窗 Esc/焦点陷阱、窄屏折叠（100dvh/safe-area）、AC-37 安装与回滚步骤（r13 报告未自包含 install 步骤，需引 r11/ARCHITECTURE）、AC-38 真机占用区块/等待文案/add_tasks 快照。
6. **性能债**：100 run 冷装配 18.31ms、缓存命中 0.0004ms/次，远优于 AC-23 门槛，无遗留风险。

## 4. 结论

交付与 PRD、架构蓝图一致：三页面板、真实 token/用时（`ATTRIBUTION=unavailable` 走显式「不可得」分支、零字数估算）、零点击自动派发（不绕 `bridge.act`、守四道闸）、5 类不可逆动作确认门禁、左栏项目库、右栏/左栏单套视图。全部可机器验证的 P0/P1 判据（AC-1~AC-13、AC-15~AC-24、AC-26）实测通过，666/666 单测 + 28/28 交付闸 + 16/16 架构巡检；无 P0/P1/P2 缺陷。**唯一未取证的是环境受限的真机类项（AC-25、AC-14 真机 DOM、AC-37/38）与 host 负责的单笔提交（AC-27/40）**，均已在 §3 显式登记，不改变代码交付的通过判断。

验收结论：✅ 通过
