# r14 面板/画布/项目库 QA 复验报告（round 2）

- 任务夹：`docs/teamflow/20261104-r14-panel-canvas-redesign/`（PRD 22 条 AC）
- 运行：`tf-mw1hteu6-w8pc10` ｜ 分支 `feat/auto-team-plugin`（HEAD `a138883`）｜ 2026-11-04
- 被测交付：未提交工作树（44 项变更，全部位于 `src/`、`test/`、`lib/`、`docs/teamflow/`）
- 结论：**可进入验收** —— 上轮 D1、D2 两个 P1 已关闭且无可复现回归；未发现开放 P0/P1/P2 缺陷；仅存 D3（P3 观察项）与 2 项环境限制的人工补测（AC-21 真机派发交互、AC-22 50 节点帧率），验收报告不得把这两项记为「通过」。

## 1. 复验范围与方法

本轮是**修复复验**，不是重新全量测试：

1. 先逐条复跑上轮留在 `logs/teamflow/tf-mw1hteu6-w8pc10/scripts/` 的 7 个检查器（本轮回归契约），录得 pass 数见 §2。
2. 再为上一轮未覆盖的表面新增 `qa-r14-r2-surface.mjs`（19 项）：角色用量聚合的边界/异常输入、非常规任务组合、宿主↔客户端逐字段一致、AC-13 同节点双属性与手柄子树、残留重复实现扫描。
3. 按上轮缺陷表的**原始检测命令与通过判据**复跑 D1/D2，不替换成等价命令。
4. 复算每个缺陷类的命中数并与修复摘要对照（§3.2）。
5. 全量门禁（typecheck/test/build/import/pack/提交面）与真机第二宿主 26 项 CDP 断言复跑。

环境：macOS + Node 22 + pnpm；真实浏览器交互由 T7 harness（克隆 profile `dv`、端口 51890、headless Chromium + CDP）驱动，非 mock。当前沙箱不能启动交互式浏览器做人工视觉走查，视觉项列入 §8。

## 2. 上一轮检查器复跑（逐字结果）

| 检查器 | 上轮结果 | 本轮结果 | 结论 |
|---|---|---|---|
| `check-t2-t4.mjs` | exit 1，38 passed / 1 failed | **exit 0，ALL PASS，40 passed / 0 failed** | D1 关闭 |
| `qa-r14-role-parity.mjs` | exit 1，3 项不一致 | **exit 0，PARITY PASS，5/5** | D2 关闭 |
| `check-t5-library-page.mjs` | 20/20 | exit 0，all T5 checks passed（20/20） | 无回归 |
| `qa-r14-perf.mjs` | 4/4（冷 5.6 ms / 热 0.18 ms） | exit 0，PERF PASS 4/4（冷 **5.5 ms** / 热 **0.22 ms**，100 行全进桶，热路径同一对象引用） | 无回归 |
| `check-t8-delivery.mjs --no-probe` | 10/10 | exit 0，T8 交付自检通过 10/10（T8-10 探针项由独立运行覆盖） | 无回归 |
| `test/r14-mutation-probes.mjs` | 6/6 | exit 0，6/6（每条「原样绿 + 变异红」） | 无回归 |
| `real-host-r14.mjs` | PASS 26/26 | **exit 0，PASS 26/26**，`capture/real-host-r14.json` verdict=pass、fail=[] | 无回归 |
| 全量单测 | 703/703 | **706/706 pass / 0 fail**（4.1 s） | 新增 3 例 |
| `qa-r14-r2-surface.mjs`（本轮新增） | — | exit 0，**19 passed / 0 failed / 3 observations** | 新表面覆盖 |

> `explore-dom.mjs` 是 T7 的一次性勘察脚本（需 `--url` 指向运行中宿主，无固定夹具），不承担交付判据，本轮未计入回归契约。

## 3. 缺陷复验

### 3.1 上轮缺陷逐条对照（表头为 round-1 级，不是仍开放的缺陷）

| 编号 | round-1 级 | 模块 | 上轮实际 | 本轮复验命令 | 本轮结果 | 状态 |
|---|---|---|---|---|---|---|
| D1 | P1 | 项目库页/分栏 | `[data-project-split]` 仅存在于 `src/client/styles.ts`，DOM 无该属性 | `node logs/teamflow/tf-mw1hteu6-w8pc10/scripts/check-t2-t4.mjs`；`node logs/teamflow/tf-mw1hteu6-w8pc10/scripts/real-host-r14.mjs` | 检查器 exit 0（40/40）；真机 P6e `splitAttr=true、splitIsBody=true`，P6f 220→300（Δ80）、外框 1160 不变、双击 220、键盘 236 | **已关闭** |
| D2 | P1 | 架构（角色用量聚合） | 宿主 `rolesOf` 与客户端 `roleUsageOf` 各自聚合，部分缺失时宿主 80 / 客户端「不可得」 | `node logs/teamflow/tf-mw1hteu6-w8pc10/scripts/qa-r14-role-parity.mjs`；`node logs/teamflow/tf-mw1hteu6-w8pc10/scripts/qa-r14-r2-surface.mjs` | parity exit 0（5/5，dev/qa/ops 三角色逐字段 + 卡片文本逐字相等）；边界探针 19/19（部分缺失/全缺/NaN/Infinity/total=0/空表均同一口径） | **已关闭** |
| D3 | P3 | 项目库/运行行 | `statusBadge` 对 draft/dispatching/terminated 显示 `? 英文` | `node logs/teamflow/tf-mw1hteu6-w8pc10/scripts/qa-r14-r2-surface.mjs` | 仍显示 `? draft` / `? dispatching` / `? terminated`（3 个 OBSERVE 行） | **仍开放（P3）** |

### 3.2 缺陷类命中数复算（与修复摘要对照）

| 缺陷类 | 上轮命中 | 本轮命中 | 对照结论 |
|---|---|---|---|
| D1 分栏锚点 | DOM 渲染点 **0**（仅 styles 死选择器） | DOM 渲染点 **1**（`LibraryPage.tsx:313` 与 `data-library-body` 同节点）；真机 `splitIsBody=true` | 一致，修复真实落在渲染路径上 |
| D2 角色用量聚合实现 | **2 套**（宿主 + 客户端），parity 差异 **3** 项 | **1 套**（`src/shared/role-view.ts#roleUsageCellOf`），两侧仅映射；parity 差异 **0** 项 | 一致 |
| D3 未映射 PlanStatus | **3** 类（draft/dispatching/terminated） | **3** 类（未修） | 与修复摘要「D3 未改」一致 |

> D1 的静态检查器仍是源码文本匹配（不是 AST 门禁）；本轮关闭依据以真机 DOM 断言（`splitIsBody=true`）为准，注释或死选择器无法伪造该结果。

## 4. 执行结果（命令 + 退出码）

| 命令 | 结果 |
|---|---|
| `pnpm -s typecheck` | exit 0，0 诊断 |
| `npx tsc -p logs/teamflow/tf-mw1hteu6-w8pc10/scripts/tsconfig.client.json` | exit 0，client+shared 0 诊断 |
| `pnpm -s test` | exit 0，**706/706 pass / 0 fail**（AC-19 要求 ≥668） |
| `node --test test/dispatch-nonblocking.test.ts` | exit 0，7/7 |
| `node --test test/role-view.test.ts` | exit 0，7/7 |
| `node --test test/task-overview.test.ts test/library-project.test.ts` | exit 0，11/11 |
| `pnpm -s build` | exit 0，`lib/index.js` 451,685 B / `lib/client.js` 411,915 B |
| `find src -name '*.ts*' -newer lib/index.js \| wc -l` | 0（产物新鲜） |
| `node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js'); console.log('IMPORT_OK')"` | exit 0，IMPORT_OK |
| `npm pack --dry-run 2>&1 \| grep -E 'lib/(index\|client)\.js\|cordis\.patch\.yml'` | 3 件齐全 |
| `node logs/.../scripts/check-t2-t4.mjs` | exit 0，40/40 |
| `node logs/.../scripts/check-t5-library-page.mjs` | exit 0，20/20 |
| `node logs/.../scripts/qa-r14-role-parity.mjs` | exit 0，PARITY PASS 5/5 |
| `node logs/.../scripts/qa-r14-perf.mjs` | exit 0，4/4（冷 5.5 ms / 热 0.22 ms） |
| `node logs/.../scripts/check-t8-delivery.mjs --no-probe` | exit 0，10/10 |
| `node test/r14-mutation-probes.mjs` | exit 0，6/6 |
| `node logs/.../scripts/real-host-r14.mjs` | exit 0，PASS 26/26 |
| `node logs/.../scripts/qa-r14-r2-surface.mjs` | exit 0，19/19（3 observations） |
| `git status --porcelain --untracked-files=all` | 44 项，全部位于 src/test/lib/docs/teamflow；无依赖目录、缓存、IDE、密钥；`logs/teamflow/` 已被 `.gitignore` 忽略 |

真机关键数值（本轮复测）：画布拖 100 px → viewport `translate3d` 位移 100 px，重置 0；环内 `2/3`、`strokeDashoffset 58.6431 / 175.929 = 0.6667`；分组「未完成 · 1 / 已完成 · 2」；2 张角色卡；qa 节点「QA 测试工程师」；本项目桶 2 行 goal 标题 + 历史桶 5 行（「历史运行（未记录工作区）」，fallback「未命名任务 · r14qa3」）；抽屉单实例、`scrollTop 200→200`、焦点回原行；分栏 P6e/P6f 见 §3.1；G7 无插件异常、无 4xx/5xx。宿主已停，端口 51890/9341 已释放，夹具 run 已删。

hygiene：`grep -rn '未知项目' src` = 0；`src/client` 对 `../host/` 引用 = 0；`font-size: var(--dsw-font` = 0；`setInterval(` = 1；队长特征句 = 1；`FlowGraph` 全仓 0 引用。

## 5. 用例与结果（逐 AC）

| AC | 结果 | 证据 / 说明 |
|---|---|---|
| AC-1 派发不阻塞 | 部分通过 | 单测以「永不 resolve 的 spawn 桩」验证工具 ≤1 s 返回 `accepted:true/dispatching:true`；变异「改回 await」→ `test timed out after 2000ms`。真机队长模型轮次未驱动（§8-1） |
| AC-2 队长提示词 | 部分通过 | `src/host/prompt.ts` 含逐字特征句「派发后立即结束本轮，不要等待成员」；段落远低于 2600 字符预算；真机无轮询行为未验证（§8-2） |
| AC-3 失败可见 | 通过 | `test/dispatch-nonblocking.test.ts` 7/7：本批全失败 5 s 内进 activity+status、任务不 running；连续失败仍走既有「自动派发连续失败，需人工处理」 |
| AC-4 画布平移 | 通过 | 真机 Δ100 px、复位 0、4 px 阈值；变异「删 pointer handler」红；无第三方依赖。拖动后选词/页面滚动的辅助断言列 §8-6 |
| AC-5 节点角色名 | 通过 | 真机 `[data-flow-node-role]` = 「QA 测试工程师」；变异「节点改 task.id」红；任务简述/token/用时保留 |
| AC-6 边箭头/虚实 | 通过（静态+真机） | 每边 `marker-end` + `data-upstream-done`；实线/虚线样式；图例与状态文字齐全；真机渲染 2 条边 |
| AC-7 卡片数 | 通过 | 2 角色 3 任务 → 2 张卡；`data-role-id` 与名字可见 |
| AC-8 卡片字段/缺数据 | **通过（D2 已修）** | 名称/状态/当前任务/token/用时齐全；部分缺失统一「不可得」+ `ROLE_USAGE_PARTIAL`，全缺 `ROLE_USAGE_MISSING`；r2 探针边界 19/19 |
| AC-9 右栏=抽屉文本 | **通过（D2 已修）** | 两侧共用 `roleStateOf`/`roleUsageCellOf` 与 `buildRunDetail`；parity 5/5 逐字段、逐字相等 |
| AC-10 进度环 | 通过 | 真机 2/3、弧比 0.6667；0/0 无 NaN；分子只算 done；变异「写死 0」红 |
| AC-11 任务分组 | 通过 | 环与两组来自同一次 `taskOverviewOf`；真机组头计数「未完成 · 1 / 已完成 · 2」 |
| AC-12 13 态分子 | 通过 | `test/task-overview.test.ts` 与 `test/role-view.test.ts` 各 13 态表驱动 |
| AC-13 项目库分栏 | **通过（D1 已修）** | DOM `[data-project-split]` 与 `[data-library-body]` 同节点；真机拖 220→300、外框 1160 不变、双击 220、键盘 236；手柄在窄容器隐藏 |
| AC-14 项目归属 | 通过 | `tools.ts` 写 `project=deps.workspace`，与 library 同源；本项目桶 2 run；旧 run 末位「历史运行（未记录工作区）」+ 说明；全仓无「未知项目」 |
| AC-15 run 行 | 通过 | 行数 = run 数（2→2，非 PlanTask）；goal 标题 ≤24 code point；旧 run「未命名任务 · 后 6 位」+ `data-title-source="fallback"`；无 t1/裸 runId |
| AC-16 详情抽屉 | 通过 | 单实例 dialog/aria-modal；含头部/角色/任务+环/画布；Esc/遮罩/按钮三关闭路；背景不卸载；scrollTop 200→200、焦点回原行；变异「删抽屉」红 |
| AC-17 组件单一定义 | **通过（D2 已修）** | `buildRunDetail`、RoleCard、TaskOverview、FlowCanvas、RunDrawer、ProgressRing 各 1 处；角色文本逐字相等 |
| AC-18 形状不变 | 通过 | PanelAction 21 / 路由 4 / RejectionCode 13 / kind 9 / TaskStatus 13 / 工具 8 / setInterval 1；仅 5 类可选字段；旧 v3 夹具可读 |
| AC-19 交付门禁 | 通过 | typecheck 0、test 706、双产物新鲜、双 import 0、pack 3、无新增依赖 |
| AC-20 变异探针 | 通过 | 6/6：await spawn / 去拖动 / 节点 task.id / 环写死 0 / 项目行改小任务 / 删抽屉 |
| AC-21 真机第二宿主 | 部分通过 | CDP 26/26（画布、环 2/3、卡片、项目/历史桶、抽屉、分栏）；AC-21 明确要求的「派发后 5 s 可输入并收到队长回复」未取证 → 记未验证，不判通过 |
| AC-22 性能 | 部分通过 | 100 run library 冷 5.5 ms / 热 0.22 ms、snapshot 不重算；50 节点连续拖 60 帧均值 ≤20 ms 未测（§8-4） |

## 6. 架构与接口一致性

- 蓝图落地：`roleStateOf`/`roleUsageCellOf` 已抽到 `src/shared/role-view.ts`，宿主 `library.rolesOf` 与客户端 `viewmodel.roleUsageOf` 只做映射；`buildRunDetail` 仍是右栏与抽屉的唯一三源装配点；`precheckDispatch` 与面板 `act` 共用 `admissionOf`；`createAutoDispatcher` 仅 1 处定义/1 处装配；`FlowGraph.tsx` 已删除且全仓 0 引用；`workspace` 在装配层只算一次，tools/library 同源。
- 接口一致性（静态 + 运行）：`pnpm typecheck` 与 client-only `tsc` 均 0 诊断，覆盖所有跨模块 import 的成员存在性与签名；`qa-r14-role-parity.mjs`、`qa-r14-r2-surface.mjs` 实际 import 并调用 `roleStateOf`/`roleUsageCellOf`/`rolesOf`/`roleUsageOf` 和 `buildRunDetail`，非仅存在性检查。
- 重复实现扫描：`roleUsageCellOf` 1 处定义；角色状态/用量/环/分组/画布/抽屉/进度环各 1 处实现；无第二套派发调度或第二套画布。
- 非阻塞观察：run 级用量合计仍由客户端 `sumUsage` 单独实现（与角色级 `roleUsageCellOf` 不同层，当前无可复现文本漂移）；若后续统一口径可收敛，不计缺陷。

## 7. 开放缺陷表

| 编号 | 严重级(P0/P1/P2/P3) | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| D3 | P3 | 项目库/运行行 | 打开项目库，查看状态为 draft/dispatching/terminated 的 run 行状态徽标 | 显示中文状态并配正确图标，不与「未知」混淆 | 未命中 `BADGES` 时显示 `? draft` / `? dispatching` / `? terminated` | AC-15 / 设计还原 | - | -（P3 观察项；建议补 PlanStatus 中文徽标或去掉未知图标） |

未发现 P0/P1/P2 缺陷；D1、D2 已关闭（对照见 §3.1，不重复计入本表）。

## 8. 人工补测清单（环境限制 / 非交付缺陷）

1. **AC-1/AC-21 真机派发 5 s**：第二宿主 + 真实队长模型，开启自动团队→给出目标→计划落盘→记录「派发受理→输入框可聚焦→发出消息→队长回复」时间（输入 ≤5 s、回复 ≤10 s），并观察队长本轮立即结束、无轮询。当前仅有 spawn 桩单测 ≤1 s 与真机装配证据。
2. **AC-2 真机提示词行为**：同一会话观察队长回复后不出现 `wait_agent`/`sleep`/重复 `auto_team_status` 轮询。
3. **AC-4 辅助断言**：拖动画布 100 px 后 `window.getSelection().toString()` 为空、面板 `scrollTop` 不变、整页不滚动（CDP 可补；本轮仅静态确认 pointerdown preventDefault）。
4. **AC-22 画布帧率**：50 节点连续拖动 60 帧平均 ≤20 ms，用 Chrome Performance/CDP Tracing 采样；无头环境未测帧率。
5. **视觉走查**：进度环/角色卡/画布/抽屉在 1280 与 ≤559 px（手柄隐藏）下的布局、遮挡、动效；查看 `logs/teamflow/tf-mw1hteu6-w8pc10/capture/{tasks-page,canvas-dragged,library-page,drawer-open}.png`。
6. **正式 profile 安装/回滚**：按 `AGENTS.md` 安装只由主 agent 执行；T7 仅在克隆 profile `dv` 安装，已停宿主并清理夹具（`~/.dsh/auto-team/runs/` 仅剩 4 个历史 run）。

## 9. 结论

- **可进入验收**：D1（AC-13 分栏锚点）、D2（AC-8/9/17 角色用量漂移）均已用原检测命令复跑关闭，命中数与修复摘要一致；全量门禁与真机 26 项无回归。
- 无开放 P0/P1/P2；D3 为 P3 观察项，不阻塞。
- AC-21 的「真机派发 5 s 交互」与 AC-22 的「50 节点 60 帧」仍为**未验证**，须在验收/人工补测中保持该状态，不得记为通过。
- 修复仍未提交（44 项工作树变更）；提交与验收由后续阶段收口。
