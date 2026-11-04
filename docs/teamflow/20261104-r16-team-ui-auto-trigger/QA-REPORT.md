# r16 QA 报告 — 角色列画布 / 角色卡编号 / 自动组队条件化 / 左栏点击兜底

## 1. 范围与环境

- 需求夹：`docs/teamflow/20261104-r16-team-ui-auto-trigger/`；分支 `feat/auto-team-plugin`，HEAD `fe4e807`，交付改动未提交（37 项：27 modified + 10 untracked，含 `lib/` 双产物、5 个新测试、r16 文档）。
- 本机：macOS + node v26.11.1 + pnpm；仓库根 `/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team`。
- 真机：第二宿主 profile `rt16`（clone 自 `desktop`），`dsh plugin add file:<repo>` 安装当前仓库，端口 51890、CDP 9342、chrome-headless-shell 1248；夹具 `run-r16qa1`（3 角色 4 任务）。用户宿主 54058 的 API 需登录 cookie（QA 侧 401），无法自动驱动。
- 判定依据：PRD 24 条 AC + 本文件 §3 的独立探针（不依赖 dev 自测结论）。

## 2. 门禁（全部实跑）

| 命令 | 结果 |
|---|---|
| `pnpm -s typecheck` | exit 0，0 error |
| `pnpm -s test` | 756 tests / 756 pass / 0 fail（≥706） |
| `node test/r16-mutation-probes.mjs` | 7/7：每条原样绿 → 单点变异红 |
| `find src -name '*.ts*' -newer lib/index.js \| wc -l` | 0（产物新鲜） |
| 双 import `lib/index.js` + `lib/client.js` | exit 0，IMPORT_OK |
| `npm pack --dry-run` | lib/index.js 453.9kB、lib/client.js 433.9kB、cordis.patch.yml（3 件齐） |
| `git status --porcelain -uall` | 37 项，仅 src/test/docs/lib；无 node_modules、日志、密钥、缓存 |
| `grep -n "name: 'dsh-auto-team'" cordis.patch.yml` | 命中（= package.json name） |

## 3. 独立探针（QA 自建，非 dev 自测）

| 脚本 | 结果 | 覆盖 |
|---|---|---|
| `logs/teamflow/tf-mw1q6b6x-9nyzj4/scripts/qa-r16-contract.mjs` | 18/18 PASS | 提示词条件式/路径清单/必要句/≤2600、幂等 dispatch 零 act 零 autoDispatch、缺 runId 与未启用拒绝、永不 resolve 的 autoDispatch 下 <500ms、分列无视 node.column、stageLinks 实虚、旧快照回退、空计划 24×24、双端 taskRefs deepEqual、环几何、999/999、roleId 双端填充 |
| `.../qa-r16-counts.mjs` | 14/14 PASS | TaskStatus 13、PanelAction 21、RejectionCode 13、kind 9、路由 4、工具 8、页签 3、setInterval 1、PlanTask 无 stage、RoleTaskRef{id,status}、无运行时依赖/无 workspace:、client 不 import host、AC-9 守卫与逐字提示、AC-18 同 RoleGrid+buildRunDetail |
| `.../qa-r16-imports.mjs` | 726 个本地 named import，0 缺失 | 每个 import 成员真实导出 + 14 模块契约导出 + 仅 2 类可选字段 |
| `.../qa-r16-perf.mjs` | 5/5 PASS | 100 run + 1 detail：冷 1.48ms、热 0.00ms（同一对象，不重算）；3 角色 4 chip |
| `.../real-host-r16.mjs` | 23/23 PASS | 真机 CDP（下节） |

## 4. 真机证据（51890 / CDP，脚本可复跑）

- 进度环：80×80、`stroke-width 8`、文本 `3/4`、dash `213.628` / offset `53.4071`（= C/4）；`scrollWidth=clientWidth=623`，无横向溢出。
- 角色卡 3 张：architecture `t1,t2`、testing `t3`、implementation `t4`；chip 文本严格 `tN`、顺序=计划顺序；title/aria「t1 · 已通过」；done 点 `rgb(34,197,94)` ≠ running 点 `rgb(65,118,230)`。
- 画布 3 列：`01/02/03` + 角色名 + `×2/×1/×1`（和=4）；节点 x=830/1038/1246，t1/t2 第 0 列、t3 第 1 列、t4 第 2 列；`data-flow-node-role` 0 处；列间 2 条 link（首条实线 + solid marker，次条虚线 4px,3px + dashed marker）、任务边 3 条、图例区分实/虚。
- 交互：拖动 100px → 位移 100；重置 → 0；50 节点 60 帧 avg 16.67ms / p95 16.8ms（≤20）。
- 左栏 glyph 3/3：`data-last-open-result=main`、可见 surface 恰 1、`pointer-events=auto`；控制台无插件相关异常、插件 API 无 4xx/5xx。
- 侧栏点击根因链（AC-10）：`src/client/styles.ts:3148` 的 `pointer-events:none`（r13 遗留）→ 原生 click 被掐断 → `src/client/LibraryPage.tsx` 的 `PanellistEntry` 内联 `pointerEvents:'auto'` + onClick 调 `openLibrary` → `LibraryPage.tsx:625` 按真实 surface 回写 → 真机 3/3 打开主区。

## 5. 验收项逐条

| AC | 结论 | 证据 |
|---|---|---|
| AC-1 | 通过 | 契约探针 A1-A4（三工具 + `enabled`、算/不算清单、必要句、无「本会话已开启」、1556 字符） |
| AC-2/3/4/5 | 未验证 | 需真实队长模型会话；QA 侧无法在不消耗用户凭据的前提下驱动（54058 亦 401）。见 §6 |
| AC-6 | 通过 | B1-B3：已派发返回 `ok/accepted/dispatching/alreadyDispatched`，零 act、零 autoDispatch；缺 runId/未启用仍拒绝 |
| AC-7 | 通过 | B4：autoDispatch 永不 resolve 时 handler <500ms 返回；`test/dispatch-nonblocking.test.ts` 同断言 |
| AC-8 | 部分通过 | 51890 默认宽度点击 3/3 单 surface；54058 与侧栏收起态未执行（见 §6） |
| AC-9 | 逻辑通过 | 单测（watchdog 端到端）+ 静态契约 C13（逐字提示、main 可见守卫、唯一内联容器）；真机降级无法构造（见 §6） |
| AC-10 | 通过（51890） | §4 根因链 4 项；54058 差异清单见 §6 |
| AC-11 | 通过 | 真机 80/8/文本/无溢出；契约 H2：3/4 偏移、0/0 有限、999/999 不截断 |
| AC-12 | 通过 | 真机 3 列、求和 4；单测「零任务角色不出列」；变异探针 AC-12a/12b 红 |
| AC-13 | 通过 | 真机节点首行 `tN`=任务 id、标题/状态可读、角色名仅列头；探针 AC-13 主标签断言在 `test/r16-flow-canvas.test.ts:255` |
| AC-14 | 通过 | 真机 2 条列间箭头（实/虚 + 真 marker）、3 条任务边、图例 |
| AC-15 | 通过 | 真机 100px/重置/50 节点帧耗；4px 阈值单测 |
| AC-16 | 通过 | 真机 chip 集合/顺序；变异探针 AC-16 红 |
| AC-17 | 通过 | 真机 title/aria 中文、done≠running 颜色；5 tone 单源 `statusBadge` |
| AC-18 | 构造性通过 | C14：两 surface 同 `RoleGrid` + `buildRunDetail`；纯函数派生 → 逐字一致；真机抽屉对照见 §6 |
| AC-19 | 通过 | counts 14/14（全部计数不变 + 2 可选字段）；旧 v3 夹具回退用例 D2 |
| AC-20 | 通过 | §2 全部门禁 |
| AC-21 | 通过（有清单差异） | 7/7 探针；与 PRD 列举不完全对应（QA-3 P3），覆盖由同名单测兜底 |
| AC-22 | 部分 | AC-8 有真机证据；AC-2..5 未验证且如实记录，无 mock |
| AC-23 | 通过 | 冷 1.48ms / 热 0.00ms；50 节点 p95 16.8ms |
| AC-24 | 部分 | 文档在任务夹、memory 同主题新增 1 条、AGENTS 0 改动、git 无垃圾；单笔提交待收口 |
| AC-25 | 通过 | 51890 + CDP 23/23（profile 克隆与 `file:` 安装、构建一致已记录） |
| AC-26..29/31-40 | 通过 | 756/756、typecheck 0、双产物新鲜、import 0、pack 3 件、无 workspace:、peer 全 optional |

## 6. 人工补测清单（环境限制，非交付缺陷）

1. **AC-2/3/4/5（真实队长自动组队）**：在 54058 安装本构建后，按「开开关 → 新会话 → 发无提示词的改代码任务」跑 3 轮；关开关同句跑 3 轮；纯问答 1 轮；说「别组队，直接改」1 轮。判据：ON 时日志 1 次 plan + 1 次 dispatch、队长零写文件、5s 内结束；OFF 时零 `auto_team_*` 写。工具：真机会话 + 日志检索。
2. **AC-8（54058 + 侧栏收起态）**：在 54058 及侧栏收起宽度下各点 `[data-auto-team-panellist]` 3 次，CDP 断言 1s 内可见 surface ≤1、`data-last-open-result ∈ main|event|error`。
3. **AC-9（主区不可用降级）**：需宿主无 `main` 槽位或注册失败的环境；点击 glyph 后断言右栏内联 1 个 `[data-library-surface="panel"]` + 逐字「主区不可用，已在右栏打开」。用 CSS 隐藏主区不成立（应用停在项目库路由，面板已卸载），故未伪造。
4. **AC-11/AC-18（抽屉 320px 对照）**：在项目库 run 详情内断言无横向溢出，并与右栏逐字比对 chip 文本/id 集合/status/tone/title/aria。
5. **AC-17（浅/深色可辨）**：切换宿主主题，断言 5 个 tone 圆点在两种底色下对比度均 ≥ 视觉可辨。
6. **AC-10（54058 差异清单）**：① 54058 API 需 cookie（401），QA 无法注入；② rt16 为克隆 profile + `file:` 安装，54058 的安装版本未确认；③ 51890 以 `ELECTRON_RUN_AS_NODE` 启动，窗口/侧栏宽度与桌面启动可能不同；④ 54058 未开调试端口。以上任一项补齐后可在 54058 复跑 AC-8。

## 7. 缺陷表

| 编号 | 严重级(P0/P1/P2/P3) | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| QA-1 | P3 | 架构/样式 | `grep -rn "data-flow-dot" src/client` | 无消费者的选择器应清理 | `src/client/styles.ts:2845-2862` 仍有 5 条 `[data-flow-dot]` 规则，r16 已改用状态胶囊，无任何消费者 | AC-13 | `grep -rn "data-flow-dot" src/client \| grep -v styles.ts \| wc -l` | 输出 0（并删除该组样式） |
| QA-2 | P3 | 架构/几何 | `grep -rn "FLOW_STAGE_HEIGHT" src` | 画布几何常量被样式引用或删除，避免双写漂移 | `FLOW_STAGE_HEIGHT=32` 仅定义未使用；`styles.ts:2733` 硬编码 `height: 32px`（同理 `width: 180px`） | AC-12/AC-15 | `grep -rn "FLOW_STAGE_HEIGHT" src \| grep -v "viewmodel.ts" \| wc -l` | 输出 ≥1（样式引用常量）或删除常量并保留双断言 |
| QA-3 | P3 | 验证资产 | `node test/r16-mutation-probes.mjs` | 探针清单与 PRD AC-21 列举的 7 条一致 | 7/7 通过，但缺 `[AC-7]`（回退 await spawn）与 `[AC-13]`（主标签回角色名）单列探针，环变异改的是 radius 28 而非 CSS 64px；覆盖分别由 `test/dispatch-nonblocking.test.ts:142`、`test/r16-flow-canvas.test.ts:255`、`test/r16-styles.test.ts` 兜底 | AC-21 | `node test/r16-mutation-probes.mjs 2>&1 \| grep -cE '\[AC-(7\|13)\]'` | 输出 ≥2（两条探针各一） |

## 8. 结论

- 功能与门禁**全绿**：756/756、typecheck 0、7/7 变异、双产物新鲜、双 import、pack 3 件、独立探针 18+14+3+5 全过、51890 真机 CDP 23/23。
- 架构核对：蓝图 14 个模块/接口点全部落地（契约字段、宿主投影 `rolesOf/flowOf`、客户端 `flowLayoutOf` 单点派生、环与画布几何、条件式提示词、幂等 dispatch、单 surface 左栏协议、样式集中）；未发现重复实现——角色分列只在 `flowLayoutOf`、surface 判定只在 `visibleLibrarySurface`，双端 taskRefs 由 deepEqual 锁死。偏差仅 3 条 P3（死选择器、未用常量、探针清单）。
- **可进入验收**；AC-2/3/4/5 与 AC-8 收起态、AC-9 真机降级、AC-18 抽屉对照按 §6 由人工补测，未以 mock 冒充。
