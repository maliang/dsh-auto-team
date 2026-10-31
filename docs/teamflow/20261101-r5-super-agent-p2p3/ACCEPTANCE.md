# 验收报告 · r5 队长分层 + Inline & Spill + 内部 Trigger 总线

- 任务夹：`docs/teamflow/20261101-r5-super-agent-p2p3/`　基线：`docs/teamflow/20261101-r4-peer-delivery-watchdog`
- 被测：分支 `feat/auto-team-plugin`，HEAD `9ca857a`，交付面 = 工作树 33 项未提交改动（16 改 + 17 新增，全部落在 `src/ test/ docs/ lib/`；`logs/teamflow/` 被 `.gitignore` 覆盖，噪声 0）。按 ADR-2026-08-27，提交由宿主在验收后统一执行，**本报告以工作树字节为准**。
- 验收人实跑时间：2026-11-01 07:55–08:20（本机 macOS 沙箱，无 DSH 宿主可加载、无浏览器）
- 结论摘要：三块子系统（队长守卫 / Inline & Spill / Trigger 总线）功能与门禁全部实测通过，0 个 P0/P1/P2；但 **AC-3 与 AC-12 的「结论进 TECHNICAL 两清单（附命令与返回值）」条款未满足**（TECHNICAL §10.2 仍是「dev 阶段必须先跑探针，结论回填本表」的占位表述），另有 1 处运行期白名单双份实现（P3-2）。二者都属于低成本、无行为风险的整改项，故判 **⚠️ 有条件通过**，整改后重新验收这两条即可收口，无需重跑其它 AC。

## 1. 验收人独立实跑（不引用 QA 结论的部分）

| 判据 | 我跑的的命令 | 实测输出 |
|---|---|---|
| 类型检查 | `pnpm -s typecheck` | exit 0，0 错误 |
| 全量单测 | `pnpm -s test` | `tests 311 / pass 311 / fail 0 / skipped 0`（下限 216，不降） |
| 产物新鲜 | `find src -name '*.ts' -newer lib/index.js \| wc -l` | `0`；`lib/index.js` 224842 B、`lib/client.js` 104606 B |
| 双产物可加载 | `node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')"` | `imports ok`，exit 0 |
| 包内容 | `npm pack --dry-run` | `lib/client.js 104.6kB` / `lib/index.js 224.8kB` / `cordis.patch.yml 646B`（+ package.json、README，total 5 = 产品 3 条目） |
| 预算常量 | `grep -nE "export const (MEMORY_INJECT_BUDGET\|WATCHER_INTERVAL_MS\|PANEL_ACTIVE_MS\|STALL_MS\|NOWAIT_THRESHOLD_MS\|TRIGGER_DEDUPE_MS)" -r src` | `config.ts:30 = 4000`、`config.ts:51 = 1500`、`shared/const.ts:26 = 2000`、`config.ts:61 = 90_000`、`config.ts:81 = 5_000`、`config.ts:90 = 60_000`（各 1 处） |
| 轮询唯一 | `grep -rn "setInterval(" src` | 唯一 `src/host/team/watcher.ts:265`（PRD 写的 247 是行号前移，处数仍为 1） |
| 旧截断标记清零 | `grep -rnF "（记忆已截断：" src \| wc -l`；`grep -rnF "…[截断]" src \| wc -l` | `0` / `0` |
| 无准入组合表 | `grep -rn "AdmissionTable" src \| wc -l` | `0` |
| Slow 层只留位 | `grep -rn "TRIGGER_SLOW_LAYER" src`；`grep -rniE "resolveCallConfig\|llm\|complete\(\|model" src/host/team/trigger.ts src/host/team/trigger-bus.ts \| wc -l` | 仅 `trigger.ts:91 = false`；模型调用 `0` |
| 既有语义未扩 | `PanelAction` 成员计数、`ActivityEvent.kind` 并集、`src/host/http.ts:5-7` 路由 | 11 / 9（`plan spawn message tool gate status interrupt route_drift rework`）/ 3（snapshot、memory、act） |
| 新探针 | `node scripts/{captain-guard-probe,inline-spill-probe,trigger-probe,trigger-event-probe,captain-model-probe,check-captain-prompt,check-t8-wire,qa-r5-e2e-probe}.mjs` | 24 / 26 / 33 / 16 / 23 断言全 PASS；`PASS=16 FAIL=0`；`ALL PASS`；`14/14 passed` |
| 变异自检（红段性质） | `node scripts/captain-guard-probe.mjs --mutate=always-allow`；`node scripts/inline-spill-probe.mjs --mutate=no-budget` | `MUTATION-RED [G1] 拒绝 "sleep 30" → allow:true（期望 NOWAIT_FOREGROUND_WAIT）` 等 8 条 → `MUTATION DETECTED`；`MUTATION-RED [I2] chars 6537 = text.length 6537 ≤ 预算 4000` 等 6 条 → `MUTATION DETECTED`。**均为断言文本判红，无一条是 `TypeError`/`undefined`** |
| r4 回归（把 r4 探针从归档目录拷回仓库 `logs/` 后跑，避免归档位置假红） | `qa-peer-probe.mjs`、`qa-reverify-probe.mjs`、`qa-collision-probe.mjs` | `7 passed, 0 failed` / `9/9 passed` / `12/12 passed` |
| 上期 3 条 P3 未被动 | `git diff -U0 src/host/index.ts \| grep -nE "identity\.name"`；`grep -c "for (const summary of store.list())" src/host/index.ts` | 0 处；`3`（上期 2 处未动 + 本期新增 1 处，已由 QA 单列说明，见 §6 P3-3） |
| 文档写回 | `git diff docs/teamflow/memory.md` | +5 行，为三条新工程约定（守卫判据、注入=指针、Fast 层最小），非流水账 |

## 2. AC-1 ~ AC-23 逐条判定

| AC | 判据要点 | 我采信的证据（我的实跑优先，其余引 QA-REPORT §3 并抽验） | 判定 |
|---|---|---|---|
| AC-1 | 队长段落固化三条硬约束、≤2600 字符、0 命中任务 acceptance 原文 | `check-captain-prompt.mjs` → `PASS=16 FAIL=0`（含长度与 acceptance 0 命中） | ✅ |
| AC-2 | `captainModel` 三态可见、未配置不改变行为 | `captain-model-probe.mjs` 23 断言全 PASS；`wire.test.ts` 缺省装配用例「不假装配置过」通过 | ✅ |
| AC-3 | 可行性最小实验判定 + 结论进 TECHNICAL 两清单（**附命令与返回值**）；不可行显式 `unsupported` | 功能侧成立：运行时 fail-closed 为 `unsupported`，面板/提示词有可读说明，测试不假称生效。**文档侧不成立**：`TECHNICAL.md` §10.2 表头仍为「dev 阶段必须先跑探针，结论回填本表」，U1~U5 五行只有探针名与降级路径，无本轮结论、无命令、无返回值（QA 自己记为 P3-1 却仍判 ✅） | ⚠️ 部分满足 |
| AC-4 | 队长前台长等待执行前拒绝、命令不执行、无等待记录 | `qa-r5-e2e-probe.mjs`：`sleep 30` → `NOWAIT_FOREGROUND_WAIT` + 可读文案 + 命中命令；无副作用标记、账本无等待记录；`captain-guard-probe.mjs` 24 断言全 PASS | ✅（真宿主 `tools/execute` 短路见 §4-U1） |
| AC-5 | ≥4 组负样本放行、只作用于队长 session | e2e：`echo sleep` / `grep -r sleep` / `(sleep 30) &` / `git status` / `sleep 2` 全放行；成员 session、非 bash 工具、参数形状不认识一律 0 拒绝；单测 17 例 | ✅ |
| AC-6 | 变异恒放行 → AC-4 断言必红（断言红非异常红） | 我实跑 `--mutate=always-allow`：`MUTATION DETECTED`，红段 8 条均为断言文本 + 期望/实测值 | ✅ |
| AC-7 | 内联 ID + 关联 ID + 一行摘要，单条 ≤200，深处 marker 0 命中 | `inline-spill-probe.mjs` 26 断言全 PASS；e2e 对 40 条真实库逐条断言（含 `mem://` ID、≥1 关联 ID、marker 0 命中） | ✅ |
| AC-8 | 预算 4000 不变、≤4000、0 命中旧截断标注、省略项可展开 | `config.ts:30 = 4000` 逐字未动；旧标记 0/0；e2e：6537 字压到 ≤4000，`entries 22 + omitted 18 = 40` 无丢失且省略项可按 ID 展开 | ✅ |
| AC-9 | 展开 sha256 逐字节一致、≤2 跳、第 3 跳拒绝、单次 ≤4000 带 truncated | `test/expand.test.ts` 16/16；e2e 四项全过（含 2 跳放行 / 3 跳 `EXPAND_DEPTH_EXCEEDED` / 5000 字截断带 `truncated=true`） | ✅ |
| AC-10 | 删文件/改名返回可读码不抛异常、快照仍渲染、拒绝路径逃逸 | `expand.test.ts` 16/16；e2e：`EXPAND_NOT_FOUND`、4 种逃逸 `EXPAND_PATH_ESCAPE`、源文件删除后快照仍渲染 `memory.inline` | ✅ |
| AC-11 | 变异回旧实现 → AC-7 断言必红 | 我实跑 `--mutate=no-budget`：`MUTATION DETECTED`，红段 6 条为结构断言判红（预算、omitted、truncated 语义、尾行、可展开性） | ✅ |
| AC-12 | 四事件 payload 实测前置；结论进 TECHNICAL 两清单；未实测字段不得进代码 | 代码侧成立：`payload.` 仅 3 处（2 处在既有 `agent/created` 通路、1 处注释），四事件经 `payloadIdsOf` 扫描，未实测字段未硬编码；探针 16 断言全 PASS。**文档侧不成立**：TECHNICAL 未逐事件写「字段路径 + 实测返回值」；真实宿主 payload 定位能力属环境不可测（§4-U2） | ⚠️ 部分满足 |
| AC-13 | 四类 Trigger 各可构造、字段齐全、kind 恰 4、来源可区分 | `trigger-probe.mjs` 33 断言全 PASS（T1 四类构造 / T8 `kind=4` 且 action 全落既有 11 个）；`TRIGGER_KINDS` 两个数组各 4 项 | ✅ |
| AC-14 | reason ≤8 且只落五类判据、dropped 零副作用、无 AdmissionTable、零语义调用 | probe T2/T3/T8：7 码全覆盖；dropped `action=null` 且 act 0 次；`AdmissionTable` 0 命中（我复跑）；`trigger*.ts` 模型调用 0（我复跑） | ✅ |
| AC-15 | 5 投=1、窗口过期再 1、常量单点 | `TRIGGER_DEDUPE_MS` 仅 `config.ts:90` 一处 `export const`（我 grep 确认）；probe T4：59999ms 仍 `duplicate`、60000ms 再推进 1 次；e2e 5 投 = accepted 1 / duplicate 4，`bridge.act` 真只调 1 次 | ✅ |
| AC-16 | 只走 `bridge.act` 既有 action、PanelAction 11、路由 0 新增、三路码逐字相同 | `check-t8-wire.mjs` ALL PASS（7 工具 / 11 PanelAction / 9 kind / 3 路由）；我复核计数一致；e2e 三路 `dedupeKey + action + 结果码` 逐字相同 | ✅ |
| AC-17 | 活动事件含中文短语 + 实体 id + 结果，source 区分 trigger/user | e2e 快照级断言四要素齐（「门禁失败」+ `t1` + 结果 kind，`source='user'` 不混入 trigger 文案）；`viewmodel` 3 例单测；锚点 `PlanTab.tsx:81/82`、`Panel.tsx:140/148` | ✅（观感见 §4-U4） |
| AC-18 | 关事件源后退回轮询、结果与事件路径相同、`degraded=true` 可见、日志 warn | e2e：`setEventSource(false)` → `health().degraded=true` + 中文原因 + 快照 `degraded=true`；`poll()` 推进 `dep_ready` 1 次并真调 dispatch，`reason/action.type/次数` 与事件路径逐字段相同；`PASS [E3]` 有 warn 文案 | ✅ |
| AC-19 | 开关默认 off、off 序列等同不存在、切换判据文档化、0 模型调用 | `TRIGGER_SLOW_LAYER = false` 单处（trigger.ts:91）；T8 断言序列不受开关影响；模型调用 0 命中；切换判据见 TECHNICAL §7 | ✅ |
| AC-20 | 1500/2000 不变、`setInterval` 仍 1 处、触发到面板可见 ≤5000ms | 常量逐字未变（我复跑）；`setInterval` 唯一 `watcher.ts:265`；时延实测为**事件入队→账本落盘 0.71ms**（T7），真实渲染可见性本机不可测（§4-U5） | ✅（可见性未验证） |
| AC-21 | 全套门禁 | typecheck 0；311/311；`find src -newer lib` = 0；双 import exit 0；pack 3 条目；r4 `reverify 9/9` + `collision 12/12`；新探针 24 / 26 / 33 项（≥4 / ≥5 / ≥6）——**全部由我独立复跑，非引用 QA** | ✅ |
| AC-22 | r4 peer/停滞不回归、上期 3 条 P3 0 改动 | `qa-peer-probe` 7/7（我复跑）；`test/stall.test.ts` + `test/handoff.test.ts` 24/24（含在 311 中）；`index.ts` 的 `identity.name` 兜底 0 处改动；新增 1 处 `store.list()` 已在 QA 单列并证明无行为变化 | ✅ |
| AC-23 | 本夹产出 QA-REPORT（AC-1~22 判定表 + 红绿两段）与 ACCEPTANCE（结论 + 未验证清单 + 风险） | 两份齐备；本文即 ACCEPTANCE；QA-REPORT 有逐条判定表、变异红绿双段、人工补测清单 | ✅ |

**基线项提示**：`AC-24`（记忆 UI 可列/开/编辑/存）与 `AC-30`（先计划后派发）属 r1 基线，本轮未触碰 `src/host/http.ts`、记忆 UI 客户端与 dispatch 门禁（工作树 diff 0 处涉及），回归由 311 例单测覆盖。`AC-25`（r1，记忆注入按预算截断正文）已由本 PRD 显式「取代」，其验收口径改为本期 AC-7/AC-8/AC-9（已判 ✅）。

## 3. 架构一致性核查（0a/0b/0c）

- **遵循蓝图**：四个新模块（`src/host/team/guard.ts`、`team/trigger.ts`、`team/trigger-bus.ts`、`memory/expand.ts`）与既有 `captain.ts` 均**零 `ctx.*`**，宿主 API 只出现在 `src/host/adapters.ts`（新增 5 个符号：`registerToolGuard:968`、`onHostTriggerEvents:1076`、`captainAgentScopeOf:1150`、`installCaptainRoute:1163`、`TRIGGER_EVENT_NAMES:1052`，均被 `index.ts` 实际引用）；装配仍在 `src/host/index.ts`，推进出口仍是 `bridge.act` 一处。
- **无重复实现（除一项 P3）**：Trigger 构造/判定/去重键单点在 `trigger.ts`（`fastOf` + `dedupeKeyOf`），`trigger-bus.ts` 只编排；记忆 ID 拼装 `inject.memoryIdOf` 与解析 `expand.parseMemoryId` 各一处且有 round-trip 断言；`readyTasks` 复用 `plan/graph.ts`；`KIND_STATES` 单表。**唯一「该抽未抽」**：运行期 kind 白名单两份（`trigger.ts:83` 与 `store.ts:328`，各 4 项字面量），新增第 5 类会漏改一处（类型侧仍单一，故不影响本期 AC-13）。
- **未破坏既有结构**：`PanelAction` 11、`ActivityEvent.kind` 9、路由 3、工具 7 全部未扩；`src/client/styles.ts:686-690` 已有面板级 `[data-tone]` 兜底，新锚点配色真实生效；host/client 仍零直接 import。
- **结论**：无「偏离蓝图 / 适配器漂移 / 显著破坏结构」，仅上述 1 项白名单双份（P3 级）。

## 4. 未验证清单（环境限制，非交付缺陷）

| # | 未验证项 | 为什么不可测 | 已被哪条断言部分替代 | 关联 AC |
|---|---|---|---|---|
| U1 | 真宿主下 `tools/execute` waterfall 短路是否真正阻断命令执行 | 沙箱无 DSH 宿主可加载插件，`profiles/desktop` 安装只能由主 agent 执行 | 假 ctx e2e：拒绝形状、无副作用、`next()` 未被调 → 24 断言 | AC-4 / AC-12 |
| U2 | `agent/status` / `subagent/end` / `agent/error` / `tools/result` 的真实 payload 能否定位成员与任务 | 同上；`cordis_inspect_query` 需宿主上下文 | 探针 16 断言验证「形状兼容 + 缺字段降级为 poll」 | AC-12 / AC-18 |
| U3 | 队长（主 session）能否被单独指定模型 | 同上（`installMemberRoute` 只对 member-scoped 生效，主 session 路由未实测） | 运行时 fail-closed：快照 `unsupported` + 可读说明 + 23 断言三态 | AC-2 / AC-3 |
| U4 | 触发到**面板可见**的真实毫秒数（渲染层） | 本机无浏览器（Chromium crashpad 需 PROCESS_ALL_ACCESS） | 入队→账本落盘 0.71ms；DOM 级断言由 `check-t3-client` 16/16 替代 | AC-20 / AC-17 观感 |
| U5 | 面板三态配色、窄面板长文本换行观感 | 同上 | 已有面板级 `[data-tone]` 兜底与锚点断言 | AC-17 工艺 |
| U6 | `subagent/end` 是否在 receipt 落盘前触发多余 resume | 需真宿主时序抓包 | T4 幂等（同 dedupeKey 5 投 1 推进）覆盖重复推进面 | AC-13 / AC-15 |

**人工补测清单沿用 QA-REPORT §6 的 6 项**，装上插件后在真宿主一次性跑完即可关闭上表。

## 5. 有条件通过的整改项（整改后只需复验这两条）

| 编号 | 整改内容 | 为什么必须改 | 验证判据（整改后复验用） |
|---|---|---|---|
| R1（阻塞） | 回填 `TECHNICAL.md` §10.2：U1~U5 每行给出**本轮结论**（已验证 / 环境不可用·未验证）+ **命令** + **返回值**原文；并补 AC-12 要求的四事件「字段路径 + 实测返回值」；删掉「dev 阶段必须先跑探针，结论回填本表」的占位表述 | AC-3 与 AC-12 的验收口径原文含「附命令与返回值」，当前文档仍是待办占位，导致「最小实验到底做了没」无据可查（QA 自记 P3-1 却判 ✅，属判定不一致） | `grep -c "dev 阶段必须先跑" TECHNICAL.md` = 0，且 U1~U5 每行含命令与返回值（或「环境不可用」+ 指向 §4 编号） |
| R2（质量） | 运行期 `TRIGGER_KINDS` 收敛为单一来源（`store.ts` 从 `trigger.ts` 或共享常量导入），保留类型侧单一 | 同一条 4 项白名单两份字面量，新增第 5 类必漏改一处；属「明显重复实现」质量底线 | `grep -rn "TRIGGER_KINDS: readonly" src \| wc -l` = 1；`pnpm -s typecheck` 0；311 例仍全绿 |

> R1 只改文档、R2 只改一处导入，二者均不触碰运行时行为，**其余 21 条 AC 无需重跑**。

## 6. 意见与遗留风险

- **P3-1**（= R1 的成因）：TECHNICAL 未回填，同 R1。
- **P3-2**（= R2）：`TRIGGER_KINDS` 双份，同 R2。
- **P3-3**：新增 1 处 `for (const summary of store.list())`（`src/host/index.ts:312`），每条 `agent/error`/`subagent/end` 全量扫历史 run × bindings；现网 200 run 约 22.3ms，可接受但随历史线性增长。属本期新代码，非上期遗留，不违 AC-22；建议下期换成按 id 反查索引（上期两处同形循环不动）。
- **P3-4**：面板「最近推进」行无长文本截断/hover 策略，窄面板下长标题挤压时间列（观感未验证，见 §4-U5）。建议补 `[data-trigger-text]` 溢出策略。
- **交付面**：33 项改动未提交，`logs/teamflow/tf-mvwzckx8-xugsg1/` 已被 `.gitignore` 覆盖（噪声 0），`lib/` 未被忽略。提交由宿主按 ADR-2026-08-27 执行；提交后请复核 `git log --oneline -1` 与 `git status --porcelain -uall`，勿把「已完成」当成「已入仓」。
- **不值得返工的地方**：单测 311 例（超下限 216 达 95 例）覆盖了守卫/展开/Trigger/队长四块主路径与负样本；三块子系统的变异自检红段都是断言红，可直接作为回归哨兵长期保留。

验收结论：⚠️ 有条件通过
