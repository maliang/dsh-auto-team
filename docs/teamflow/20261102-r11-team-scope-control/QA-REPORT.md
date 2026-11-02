# QA-REPORT · r11 团队写域 / 续派 / 单任务干预（复验轮 round 2）

- 需求：docs/teamflow/20261102-r11-team-scope-control（PRD 40 条 AC：P0 33 / P1 7）
- 分支：feat/auto-team-plugin ｜ HEAD：`bdba5f8` ｜ 交付提交后工作树 = 0（本轮唯一待入库改动即本报告 `M QA-REPORT.md`，由验收阶段随收口提交）
- 结论：**可进入验收** —— 上轮 3 个 P1（D1/D2/D3）全部关闭，本轮无 P0/P1/P2 开放；3 条 P3 观察保留；真机 7 项进「人工补测清单」（环境限制，非交付缺陷）。
- 环境：macOS，Node 22；沙箱内**无法启动浏览器与第二宿主**（宿主 token 限制）→ UI/安装类改用「产物级 node:vm 装配 + 纯函数视图断言」，真机项如实列清单。

## 1. 门禁实测（2026-11-02 15:3x–16:0x，全部本轮实跑）

| 命令 | 结果 |
|---|---|
| `pnpm -s typecheck` | **exit 0**，`grep -c 'error TS'` = **0** |
| `pnpm -s test` | **exit 0，562 / 562 pass，0 fail**（4126ms，回归线 ≥484） |
| `pnpm -s build` | exit 0，`lib/index.js` 364.83 kB + `lib/client.js` 273.70 kB（构建后 `git status` 仍 0，产物确定） |
| `node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')"` | exit 0，`IMPORT_OK`（两产物顶层不抛） |
| `npm pack --dry-run` | 命中 3 件：`lib/index.js` 364.8kB / `lib/client.js` 273.7kB / `cordis.patch.yml` 646B（total 5） |
| `find src -name '*.ts*' -newer lib/index.js \| wc -l` | **0**（产物与源码同步） |
| `git status --porcelain --untracked-files=all \| wc -l` | **0** |
| `git log --oneline -1` | `bdba5f8 feat(r11): 团队写域互斥排队 + 计划续派 + 单任务取消/跳过/改验收 + 队长留痕` |

## 2. 交付形态契约（8 条，逐条可执行判据）

| # | 判据 | 本轮实测 |
|---|---|---|
| 1 | 宿主半加载入口 `name` = 包根名 | `cordis.patch.yml`：`- insert: - id: auto-team-host / name: 'dsh-auto-team'`（grep 命中 1 处）✅ |
| 2 | client 声明字段集与样本一致 + 产物含包 id | `dsh.client = {platform:"web", inject:[7 包], immediately:false}`；`grep -c 'dsh-auto-team' lib/client.js` = **15** ✅ |
| 3 | UI 挂载点 `name` 逐字等于 slot 名 | 产物级抓取（A6）：5 处 `slots.inject(X, () => register({ name: X, … }))`，`inject` 参数与 `name` 同一字符串；插件标识只进 `id`/`key` ✅ |
| 4 | 入口声明与产物进 files | `files = ["lib","cordis.patch.yml","README.md"]` ✅ |
| 5 | 依赖协议可被 profile 解析 | `grep -c 'workspace:' package.json` = **0** ✅ |
| 6 | 宿主依赖按 peer/可选 peer 声明 | `peerDependencies` 8 项、`peerDependenciesMeta` 8 项（全 optional）✅ |
| 7 | 构建产物与源码同步 | 上表 `find` = 0；且 A1–A5 直接跑 `lib/index.js` 而非 src，行为与源码一致 ✅ |
| 8 | 装载安全：两产物顶层不抛 | 双 import exit 0（见 §1）✅ |

## 3. 回归契约重跑（上轮遗留 4 个探针，逐项原始 pass 数）

| 探针（logs/teamflow/tf-mvynaqhi-o4q3jo/scripts/） | 结果 |
|---|---|
| `qa-r11-probe.mjs`（假 ctx 起 apply，8 工具 + 3 路由） | **21/21 PASS** |
| `t3-tools-gate.mjs`（空验收整批拒绝 / add_tasks 幂等） | exit 0，**6 PASS** |
| `t4-e2e-deviation-actions.mjs`（留痕 + 三动作端到端） | exit 0，**6/6 PASS**（终态 t1:cancelled, t2:blocked, t3:skipped） |
| `t5-panel-flow.mjs`（面板写域/等待/痕迹流程） | exit 0，**10 PASS**（`TERMINAL {"tasks":3,"done":1,"cancelled":1,"skipped":1,"locks":0,"deviations":1,"writes":3}`） |

## 4. 本轮新增覆盖面（上轮未覆盖，两脚本已落 scripts/）

**`qa-r11-artifact-probe.mjs` → 6/6 PASS, exit 0**：跑**已交付产物**（`lib/index.js` + `lib/client.js`），并用真实宿主形状 `{ agent: { id: session } }` 调用工具（上轮全走 `{sessionId}` 兜底分支，恰是 r11 真机事故点）。

| 编号 | 断言 |
|---|---|
| A1 | 宿主产物：entry name / inject 4 项 / 8 工具名全表 / 1 条 prefix 路由 `/api/auto-team` / 1 提示词段 / 清理回调 5 份 |
| A2 | 默认 `enabled=false`；未知路径 404（分发真查路由表） |
| A3 | 用真实 `exec.agent.id` 建计划 → 同 sessionId 快照见 3 条、他会话 0 条（会话口径修复生效） |
| A4 | t1/t2 写域冲突（无依赖）→ t2 `waiting`、`waitingOn=['t1']`、`waitReason='等待 t1 释放 src/host'`、只 spawn 2 个；快照 `scopeLocks` 含 t1 行且 waiter 原因逐字 |
| A5 | t1 receipt done → t2 回 `pending`、`messages` 中 `rel-t1-t2-` **恰 1 条**且 body 含「t1 已结束并释放 src/host」、t1 不再占锁、再 dispatch 后 t2 running 且 **runId 不变** |
| A6 | client 产物经 `window.__ModuleLoader__.load` 真装配：id='dsh-auto-team'、inject=['slots']、5 处 inject 逐字（conversation.input.left / conversation.session.header.actions / sidebar.right.pane.tab / sidebar.right.pane.tab.title / settings.section）、panel 与 title 同 key 且 key≠slot 名、sidebarRightTabs 注册 1 个 definition 且包在 scope.effect |

**`qa-r11-interface-sweep.mjs` → 3/3 PASS, exit 0**（QA 要求 0a）：I1 蓝图 15 个模块的 API 名逐个 import 核对 `typeof`（含 scope/acceptance/plan/graph/scope-locks/deviation/dispatch/tools/bridge/adapters/config/paths/gate/viewmodel/ui）；I2 13 态标签与允许表各 13 项、`statusBadge(status).text` 逐态等于 `TASK_STATUS_LABELS`（单源）、`progressOf` 每态 percent 为数字；I3 `waitReasonOf('t1','src/host')` === `'等待 t1 释放 src/host'`，client 只透传。

## 5. AC 覆盖（40 条，按需求分组）

| 需求 | AC | 本轮证据 | 结论 |
|---|---|---|---|
| F1 简单任务 | 1–3 | `qa-r11-probe` C9/C10/C11：两条硬规则可 grep、段落 ≤2600、plan description 明示单任务合法、单任务计划 dispatch 出 1 成员 | ✅ |
| F2 验收模板 | 4–7 | `test/acceptance.test.ts` 6 次 `bash -c` 真跑（应过 exit 0 / 应败非 0）；`test/gate.test.ts` 原文案逐字 + 追加模板；`t3-tools-gate` 空验收整批拒绝且 store 字节不变 | ✅ |
| F3 续派 | 8–11 | `t3-tools-gate`：8 工具、二次 `added=0`、runId 不变、已终止 run 拒绝；`test/tools.test.ts` | ✅ |
| F4 写域 | 12–17 | `test/scope.test.ts`（归一/目录边界/`src/hostile.ts` 反例）；A4/A5 产物级 waiting+释放；`test/dispatch.test.ts`（不占并发、5 终态各释放一次、重启重算、无死锁） | ✅ |
| F5 通知 | 18 | A5：每等待者恰 1 条、重放不重复；`t4` 端到端 | ✅ |
| F6 面板 | 19–21 | A4/A6 + `t5-panel-flow` 10 PASS + `test/client-ui.test.ts`（13 态徽标/39 格/等待条原文）；槽位注册数不变（A6 5 处） | ✅ |
| F7 留痕 | 22–24 | `t4` 6/6：落 `~/.dsh/auto-team/deviations.jsonl`（仓库外）、fail-open、60s 同键合并计数、快照 deviations 可查 | ✅（sessionId 口径见 D4） |
| F8 干预 | 25–27 | `t4` 三动作端到端；`test/client-contract.test.ts`（disabled 矩阵与允许表一致、改验收浮层空值 0 请求） | ✅ |
| 形状登记 | 28 | 13 态 / 8 工具 / 18 动作 / kind **9** / 路由 1 条 prefix（3 路由面）/ setInterval 1 处 / sessionOf 1 处 / 四常量各 1 | ✅ |
| 门禁 | 29 | typecheck 0 + 562/562（≥484） | ✅ |
| 分发形态 | 30–36 | §2 八条全绿 | ✅ |
| 安装/回滚 | 37 | 步骤可照做，需主 agent 执行 | 人工补测 |
| 真机面板 | 38 | 需第二宿主 + 浏览器 | 人工补测 |
| 文档回填 | 39 | `docs/teamflow/memory.md:37` 四条约定齐全且随 HEAD 提交 | ✅ |
| 收口 | 40 | 单笔提交 `bdba5f8`、工作树 clean、门禁数字见 §1 | ✅ |

## 6. 缺陷表（仅列本轮复验后仍 OPEN 的项）

| 编号 | 严重级(P0/P1/P2/P3) | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| D4 | P3 | 留痕/面板 | 会话 A 中队长写文件后打开会话 B 的面板 | deviations 按会话隔离或标注会话 | 记录器 sessionId 恒 `'current'`（`src/host/index.ts:86,341`），快照 deviations 不过滤（TECHNICAL:138 已登记取舍） | AC-22 | `grep -n "sessionId: DEFAULT_SESSION" src/host/index.ts` | - |
| D5 | P3 | UI craft | 面板空闲态（无写域占用、无痕迹）观察 | 常驻「0 占用 / 0 痕迹」状态指示 | 空数组整块不渲染（`PlanTab.tsx:250,489`，与 AC-21 的 0 节点一致，但与 craft「持久信息可见」相反） | AC-20/24 | `grep -n "locks.length === 0 ? null" src/client/tabs/PlanTab.tsx` | - |
| D6 | P3 | UI craft | 悬停/聚焦 disabled 的三动作按钮 | 禁用原因可见（非仅悬停） | 原因只在 `title` 与 `aria-label`，无可见文本 | AC-27 | `grep -n "title={title}" src/client/tabs/PlanTab.tsx` | - |

## 7. 上轮缺陷复验对照（round-1 级；非开放缺陷）

| 编号 | round-1 级 | 本轮复验命令 | 实测 | 状态 |
|---|---|---|---|---|
| D1 | P1 | `pnpm -s typecheck 2>&1 \| grep -c 'error TS'` | **0**（exit 0） | 关闭 |
| D2 | P1 | `node --test test/wire.test.ts 2>&1 \| grep -c '^✖'` | **0**（562/562 全绿） | 关闭 |
| D3 | P1 | `git status --porcelain --untracked-files=all \| wc -l` + `find src -name '*.ts*' -newer lib/index.js \| wc -l` | 0 / 0（HEAD `bdba5f8` 含 `lib/` 双产物） | 关闭 |
| D4 | P3 | `grep -n "sessionId: DEFAULT_SESSION" src/host/index.ts` | 仍 341 行命中 | 保持（观察） |

同类残留扫描（复算命中数，与修复摘要一致）：`RunState` 从非 store 模块导入 = **0**；`test/src` 中「7 个工具」字样 = **0**；未提交改动 = **0**。

## 8. 架构核查（蓝图对齐，非缺陷）

- 模块与 API：15 个蓝图模块的导出名与类型逐项命中（I1），无「文件在、符号不在」。
- 单源约束成立：写域归一与冲突只在 `src/host/plan/scope.ts`（`startsWith` 仅用于归一与 `${left}/` 目录边界）；等待文案只在 `waitReasonOf`；验收模板只在 `acceptance.ts`（`gate.ts` 追加同一常量）；允许表与中文标签只在 `src/shared/task-actions.ts`（client 经 `statusBadge/progressOf` 派生）。
- 零重复实现：无第二份状态中文表（I2）；`src/client` 对 `src/host` 直接 import = 0；`setInterval` 仍仅 `src/host/team/watcher.ts:296` 一处真实定时器。
- 与蓝图的两处可见性偏差（**非缺陷**）：① 蓝图列出的 `BADGES`/`TASK_PROGRESS` 实为 `viewmodel.ts` 模块私有 const（:55/:72/:637），对外只经 `statusBadge()`/`progressOf()`，功能单源成立；② deviation 记录器用 `DEFAULT_SESSION`（见 D4）。

## 9. Craft 观察（P3，仅记录不阻断）

交互反馈齐备：三动作 `:hover/:active/:focus-visible/:disabled` 四态（`styles.ts:703-722`）、busy 整组 disabled + spinner、改验收浮层非模态/Esc 关闭/空值 0 请求、错误 `role=alert`、等待条 `role=note`。缺口即 D5（空闲无常驻指示）与 D6（禁用原因仅悬停可见）。

## 10. 人工补测清单（环境限制，非交付缺陷）

| # | 项 | 判据 | 方法/工具 |
|---|---|---|---|
| 1 | 安装与回滚（AC-37） | 装后宿主启动无 unresolved peer 告警、面板出现、8 工具可见；`pnpm remove` 后无残留 | 主 agent：`cd ~/.dsh/profiles/desktop && pnpm add file:<repo>` + `dsh.profile.bundles` 同步，回滚反之 |
| 2 | 真机面板（AC-38） | 占用区块/等待文案/痕迹计数与 `/snapshot` 逐字一致；`add_tasks` 前后 tasks 增加且 runId 不变 | 第二宿主 51890（REAL-HOST-VERIFY.md）+ 浏览器 |
| 3 | 三动作真机点击（AC-27） | cancel/skip/updateAcceptance 各点一次：状态迁移、消息、disabled 矩阵与允许表一致 | 同上 |
| 4 | 320px 右栏视觉 | 写域区块/等待条/浮层不溢出（`scrollWidth ≤ clientWidth`） | 浏览器 DevTools 或截图 |
| 5 | 无障碍播报 | 等待条/错误/三动作禁用原因可被读屏读出 | VoiceOver |
| 6 | 重启等待重算（AC-16） | 重启后 waiting 按计划顺序重算，无锁表残留 | 第二宿主重启 |
| 7 | 空闲态可读性（D5） | 无锁/无痕迹时面板仍有可理解的状态 | 人眼 |

## 11. 结论

**可进入验收。** 门禁：typecheck 0、562/562、build exit 0、双产物 import exit 0、pack 3 件、源码/产物同步 0、工作树 clean（HEAD `bdba5f8`）。功能面 38/40 条 AC 有本轮实测证据（A1–A6、I1–I3 + 4 个回归探针 + 全量单测），AC-37/38 属真机项已列人工补测；开放缺陷仅 3 条 P3 观察（D4/D5/D6），无 P0/P1/P2。
