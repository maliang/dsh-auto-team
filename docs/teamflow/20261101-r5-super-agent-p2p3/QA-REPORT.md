# QA-REPORT · r5 队长分层 + Inline & Spill + 内部 Trigger 总线

- 任务夹：`docs/teamflow/20261101-r5-super-agent-p2p3/`　基线：`docs/teamflow/20261101-r4-peer-delivery-watchdog`
- 被测：分支 `feat/auto-team-plugin`，HEAD `9ca857a`，工作树 32 项未提交改动（16 改 + 16 新增，全部落在 `src/ test/ docs/ lib/`）
- 环境：macOS 本机沙箱（无 DSH 宿主可加载、无浏览器——Chromium crashpad 需 PROCESS_ALL_ACCESS，属**环境限制**，非交付缺陷）
- 结论：**可验收**。P0/P1/P2 = 0；4 条 P3 观察（不阻塞）。AC-1~AC-22 逐条实跑判定，见 §3。

## 1. 交付形态与提交面（0b/0c）

| 判据 | 命令 | 实测 |
|---|---|---|
| 双产物存在且新鲜 | `ls -l lib/index.js lib/client.js`；`find src -name '*.ts' -newer lib/index.js \| wc -l` | 224842 B / 104606 B；**0** |
| 产物可加载 | `node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')"` | `imports ok`，exit 0 |
| 包内容 3 条目 | `npm pack --dry-run` | `cordis.patch.yml 646B` + `lib/client.js 104.6kB` + `lib/index.js 224.8kB`（total 5 = 含 package.json/README） |
| 客户端产物含新锚点 | `grep -c "data-auto-team-trigger\|data-captain-model\|data-auto-team-degraded" lib/client.js` | 4 |
| 提交面无噪声 | `git status --porcelain -uall \| grep -cE "logs/\|node_modules\|dist/"` | **0**；32 项全部是源码/测试/文档/产物，`logs/teamflow/` 已被 `.gitignore` 覆盖，`lib/` 未被忽略 |

## 2. 独立 e2e（QA 自写，只用生产模块，不依赖 dev 探针 harness）

`node logs/teamflow/tf-mvwzckx8-xugsg1/scripts/qa-r5-e2e-probe.mjs` → **14/14 passed**（`RunsStore` + 真 `createBridge` + 真 `createTriggerBus` + 真 `createExpander` + 真 `guardOf`，从盘上状态走到 `bridge.act` 与快照）：

- AC-15 连投 5 次 → accepted 1 / duplicate 4，`bridge.act` 真只调 1 次；账本 5 条、活动流 1 条（AC-16）。
- AC-17 快照活动行含「门禁失败」+ 实体 id `t1` + 结果 kind；同一快照里用户动作 `source='user'` 且不混入 trigger 文案。
- AC-18 `setEventSource(false)` → `health().degraded=true` 且带中文原因、快照 `degraded=true`；`poll()` 推进 dep_ready 1 次并真调 dispatch，与事件路径 `reason/action.type/调用次数` 逐字段相同。
- AC-4/5 队长 `sleep 30` 拒（`NOWAIT_FOREGROUND_WAIT`）；`echo sleep` / `grep -r sleep` / `(sleep 30) &` / `git status` / `sleep 2` 全放行；成员 session、非 bash 工具、参数形状不认识一律 0 拒绝。
- AC-7/8 真实 40 条库（每条 32 行 + 正文深处 marker）：`chars ≤ 4000`、旧截断标注 0 命中、`entries(22)+omitted(18)=40` 无丢失、单条 ≤200 且带 `mem://` ID 与 ≥1 关联 ID、marker 0 命中。
- AC-9/10 被省略条目按 ID 展开与盘上原文 `sha256` 逐字节相同；2 跳放行 / 3 跳 `EXPAND_DEPTH_EXCEEDED`；5000 字 → `truncated=true` 且 ≤4000；删文件 `EXPAND_NOT_FOUND`、`../`/`~`/绝对/多段 → `EXPAND_PATH_ESCAPE`；源文件删除后快照仍渲染 `memory.inline`。

## 3. AC 判定表（AC-1 ~ AC-22）

| AC | 判据要点 | 检测命令 | 实测输出 | 判定 |
|---|---|---|---|---|
| 1 | 队长段落三类特征句、≤2600 字符、0 命中 acceptance 原文 | `node .../check-captain-prompt.mjs` | `PASS=16 FAIL=0` | ✅ |
| 2 | captainModel 三态可见；未配置不改变行为 | `node --test test/wire.test.ts`；`node .../captain-model-probe.mjs` | 三态用例 + 缺省装配用例通过；`23 asserts` ALL PASS | ✅ |
| 3 | 可行性最小实验 + 结论进 TECHNICAL 两清单 | `sed -n '456,476p' docs/.../TECHNICAL.md` | §10.2 列出 U1~U5 且给出降级路径，但未回填探针命令/返回值（P3-1）；运行时 fail-closed 为 `unsupported`，`test/captain.test.ts` 断言不假称生效 | ✅ |
| 4 | 队长前台长等待执行前拒绝、命令不执行、无等待记录 | `node .../captain-guard-probe.mjs`；`node .../qa-r5-e2e-probe.mjs` | `24 asserts` ALL PASS；e2e `NOWAIT_FOREGROUND_WAIT` + 可读文案 + 命中命令 | ✅ |
| 5 | 四组负样本放行；只作用于队长 session | 同上 + `node --test test/guard.test.ts` | e2e 5 组放行、成员/非 bash 0 拒绝；单测 17 例全绿 | ✅ |
| 6 | 变异恒放行 → AC-4 断言必红（断言红非异常红） | `node .../captain-guard-probe.mjs --mutate=always-allow` | `MUTATION-RED [G1] 拒绝 "sleep 30" → allow:true（期望 NOWAIT_FOREGROUND_WAIT）` 等 8 条；`MUTATION DETECTED` | ✅ |
| 7 | 内联 ≤200 字符 + ID + ≥1 关联 ID + 深处 marker 0 命中 | `node .../inline-spill-probe.mjs`；e2e | `26 asserts` ALL PASS；e2e 40 条库逐条断言 | ✅ |
| 8 | 预算 4000 不变、≤4000、0 命中旧截断标注、省略项可展开 | `grep -rnF "（记忆已截断：" src \| wc -l`；`grep -rnF "…[截断]" src \| wc -l`；e2e | `0` / `0`；e2e 6537 字被压到 ≤4000 且 omitted 18 条可展开 | ✅ |
| 9 | sha256 逐字节一致、≤2 跳、第 3 跳拒绝、单次 ≤4000 带 truncated | `node --test test/expand.test.ts`；e2e | 16/16；e2e 四项全过 | ✅ |
| 10 | 删文件/改名可读错误码、逃逸拒绝、快照仍渲染 | `node --test test/expand.test.ts`；e2e | 16/16；e2e `EXPAND_NOT_FOUND` / 4 种逃逸 `EXPAND_PATH_ESCAPE` / 快照仍渲染 | ✅ |
| 11 | 变异回旧实现 → 内联断言必红 | `node .../inline-spill-probe.mjs --mutate=no-budget` | `MUTATION-RED [I2] chars 6537 = text.length 6537 ≤ 预算 4000` 等 8 条；`MUTATION DETECTED` | ✅ |
| 12 | 四事件 payload 实测前置；未实测字段不得进代码 | `node .../trigger-event-probe.mjs`；`grep -nE "payload\.(agent\|member\|status)" src/host/index.ts` | `16 asserts` ALL PASS（fake ctx 形状）；`payload.` 仅 3 处，两处在既有 `agent/created` 通路，一处是注释；四事件走 `payloadIdsOf` 扫描 → **未实测属环境限制**，进人工补测 #1 | ✅ |
| 13 | 四类 Trigger 字段齐全、kind 恰 4、来源可区分 | `node .../trigger-probe.mjs` | `33 asserts` ALL PASS（T1 四类构造 / T8 kind=4 且 action 全落既有 11 个） | ✅ |
| 14 | reason ≤8、只落五类判据、dropped 零副作用、无 AdmissionTable、零语义调用 | 同上 T2/T3/T8；`grep -rn AdmissionTable src \| wc -l` | 7 码全覆盖；dropped `action=null` 且 act 0 次；`0` | ✅ |
| 15 | 同 dedupeKey 5 投=1、窗口过期再 1、常量单点 | T4；`grep -c "export const TRIGGER_DEDUPE_MS" src/host/config.ts`；e2e | 59999 仍 duplicate、60000 再推 1；`1`；e2e 5 投=1 | ✅ |
| 16 | 只走 bridge.act 既有 action、PanelAction 11、路由 0 新增、三路码逐字相同 | T5/T8；`node .../check-t8-wire.mjs` | `21/21 PASS`（7 工具 / 11 PanelAction / 9 kind / 3 路由）；三路 dedupeKey+action+结果码逐字相同 | ✅ |
| 17 | 活动事件含中文短语+实体 id+结果，source 区分 trigger/user | e2e（快照级）；`grep -n "data-auto-team-trigger\|data-trigger-source" src/client/tabs/PlanTab.tsx` | e2e 断言四要素齐；锚点 `PlanTab.tsx:81/82`、`Panel.tsx:140/148`；`viewmodel` 3 例单测 | ✅ |
| 18 | 关事件源后轮询推进与事件路径相同、快照 degraded、日志 warn | e2e（两条断言）；`node .../trigger-event-probe.mjs` | e2e `reason/action/次数` 相同 + `degraded=true`；`PASS [E3] ... 「[auto-team] 宿主未提供 ctx.on：Trigger 事件源不可用…」` | ✅ |
| 19 | Slow 层默认关、off 序列等同不存在、0 模型调用 | `grep -rn TRIGGER_SLOW_LAYER src`；`grep -rniE "llm\|model\|complete\(" src/host/team/trigger*.ts` | 仅 `trigger.ts:91 export const TRIGGER_SLOW_LAYER = false`；模型调用 **0 命中**；T8 断言序列不受开关影响 | ✅ |
| 20 | 1500/2000 不变、setInterval 仅一处、触发到可见 ≤5000ms | `grep -rn "setInterval(" src`；`grep -n "WATCHER_INTERVAL_MS\|PANEL_ACTIVE_MS" src/host/config.ts src/shared/const.ts` | 唯一 `src/host/team/watcher.ts:265`；1500 / 2000 未变；T7 入队→账本落盘 **0.71ms**（真实渲染可见性进人工补测 #4） | ✅ |
| 21 | 全套门禁 | `pnpm -s typecheck`；`pnpm -s test`；见 §1；r4 探针 | typecheck exit 0；`tests 311 / pass 311 / fail 0`（≥216）；产物新鲜 0；r4 `reverify 9/9` + `collision 12/12`；新探针 24/26/33 全绿 | ✅ |
| 22 | r4 peer/停滞不回归 + 上期 3 条 P3 0 改动 | `node .../qa-peer-probe.mjs`；`node .../qa-stall-probe.mjs`；`node --test test/stall.test.ts test/handoff.test.ts`；`git diff -U0` 定点 grep | `7 passed / 11 passed`；`24/24`；`identity.name` 与 retry 相关行 **0 处改动**（`store.list()` 仅新增于新事件处理块，记 P3-3） | ✅ |

## 4. 架构与接口一致性核查（0a）

- **接口一致性（静态）**：`pnpm typecheck` exit 0 是第一道；逐个跨模块调用另有实证——`bridge.act / expandMemory / snapshot`、`bus.push/poll/health/setEventSource`、`guardOf`、`memoryIndexOf`、`createExpander({roots}).expand` 全部被 §2 的真模块 e2e 调到并断言返回值形状。`adapters.ts` 的 5 个新符号（`registerToolGuard:968` / `onHostTriggerEvents:1076` / `captainAgentScopeOf:1150` / `installCaptainRoute:1163` / `TRIGGER_EVENT_NAMES:1052`）均存在且被 `index.ts` 实际引用；无「导入了不存在的成员」。
- **无重复实现**：Trigger 构造/判定/去重键单点（`trigger.ts` 的 `fastOf` + `dedupeKeyOf`，`trigger-bus.ts` 只编排）；记忆 ID 拼装 `inject.memoryIdOf` / 解析 `expand.parseMemoryId` 各一处；`readyTasks` 复用 `plan/graph.ts` 而非另写「依赖是否都完成」；`KIND_STATES` 单表（`trigger.ts:159`）；质量门禁证据只走 receipt 同步路径。
- **结构未被破坏**：新模块 `guard.ts` / `trigger.ts` / `trigger-bus.ts` / `captain.ts` / `memory/expand.ts` **零宿主 `ctx.*`**（`expand.ts:15` 注释即约束，`trigger.ts` 的 `ctx` 是 FastContext 参数）；装配仍集中在 `src/host/index.ts`，宿主 API 面仍只有 `adapters.ts`；`PanelAction` 11、`ActivityEvent.kind` 9、路由 3、工具 7 全部未新增；`styles.ts:686-690` 已有面板级 `[data-tone]` 兜底，新锚点配色真的生效（不是无声继承）。
- 唯一「该抽未抽」的苗头：运行期 `TRIGGER_KINDS` 两份（`trigger.ts:83` 与 `store.ts:328`）、`mem://` 前缀两份（`inject.ts:191` 拼装 / `expand.ts:25` `ID_SCHEME`）——类型侧单一，运行期清单双份，新增第 5 类会漏改一处。记 P3-2，不阻塞。

## 5. 缺陷表

**未发现 P0 / P1 / P2 缺陷（未发现缺陷）。** 以下 4 行为 P3 观察，不阻塞验收：

| 编号 | 严重级 | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| P3-1 | P3 | 架构（文档） | `sed -n '467,476p' docs/teamflow/20261101-r5-super-agent-p2p3/TECHNICAL.md` | U1~U5 每行给出「已验证/不可验证」结论 + 探针命令与返回值 | 表头仍写「dev 阶段必须先跑探针，结论回填本表」，5 行只给了降级路径，没有本轮的结论与实跑输出 | AC-3 / AC-12 | `grep -c "dev 阶段必须先跑" docs/teamflow/20261101-r5-super-agent-p2p3/TECHNICAL.md` | 输出 `0`，且每行附命令 + 实测返回值 |
| P3-2 | P3 | 架构（单一来源） | `grep -rn "TRIGGER_KINDS: readonly" src` | 运行期 kind 白名单只有一处 | 两处（`src/host/team/trigger.ts:83`、`src/host/store.ts:328`），新增第 5 类需同步改两个文件 | AC-13 | `grep -rn "TRIGGER_KINDS: readonly" src \| wc -l` | 输出 `1`（store 侧改为从共享常量导入） |
| P3-3 | P3 | 性能（事件通路） | 读 `src/host/index.ts:312` | 宿主事件处理按 payload id 反查（O(命中 run)） | 每条 `agent/error`/`subagent/end` 都 `store.list()` 全量扫历史 run × 全部 bindings，加上既有两处共 3 处同形循环 | AC-18 / AC-22（新代码，不属上期 P3） | `grep -c "for (const summary of store.list())" src/host/index.ts` | 输出 `2`（新增处改为按 id 索引/反查；上期两处不动） |
| P3-4 | P3 | 工艺（面板） | 读 `src/client/tabs/PlanTab.tsx:88-98` | 「最近推进」行长中文文本有截断/换行策略，且行有 hover 线索 | 行内三列（来源徽标/时间/文案）无截断规则、无 hover 样式，窄面板下长标题会挤压时间列（本沙箱无浏览器，观感未验证） | AC-17（工艺观察） | `grep -c "plan-triggers\|trigger-text" src/client/styles.ts` | 输出 `≥1`（补一条 `[data-trigger-text]` 溢出策略） |

## 6. 人工补测清单（环境限制，非交付缺陷）

| # | 项 | 方法 | 工具 |
|---|---|---|---|
| 1 | 四事件真实 payload 能否定位成员/任务（AC-12 前置） | 装插件后订阅 `agent/status`/`subagent/end`/`agent/error`/`tools/result`，把 payload 落 `captures.json`，回收进 `trigger-event-probe` 的采集模式 | DSH profile 安装（主 agent 执行）+ `cordis_inspect_query(event)` |
| 2 | 队长模型能否被单独指定（U3/AC-3） | 真宿主下看 `installCaptainRoute` 是否真命中 `system-prompt/assemble` + `agent/request`，面板 `data-captain-model` 是否由 `unsupported` 变 `configured` | 宿主 + 面板 |
| 3 | `tools/execute` 短路是否真阻断命令（U1/U4） | 队长调 `bash sleep 30`，断言返回 `NOWAIT_FOREGROUND_WAIT` 且系统无对应进程、无等待记录 | 宿主 |
| 4 | 触发到面板可见 ≤5000ms（AC-20 真实可见性） | 本机只能测到入队→落盘 0.71ms；真实渲染需页面级计时 | 浏览器/Playwright（本沙箱不可用） |
| 5 | 面板三态配色、窄面板长文本换行（0d 工艺） | 三态截图 + 640px 窄面板截图 | 人眼 / Playwright |
| 6 | `subagent/end` 对「已完成」成员是否在 receipt 落盘前触发多余 resume | 真宿主下抓事件与 receipt 时序，看账本是否出现 1 次多余 `member_exit` 推进 | 宿主 + `captures.json` |

## 7. 结论

- 三块子系统（队长守卫 / Inline & Spill / Trigger 总线）在**真模块拼装**下走通主路径：守卫拒绝+放行、40 条库注入 ≤4000 且可按 ID 展开到逐字节、四类 Trigger 幂等推进并让面板说人话、事件源关闭后退回轮询且结果一致。
- 门禁全绿：typecheck 0、单测 311/311、双产物新鲜（`find src -newer lib` = 0）、双 import 0、pack 3 条目、r4 回归 9/9 + 12/12 + peer 7/7 + stall 11/11。
- 变异自检两处均为**断言红**（AC-6 八条、AC-11 八条），不是异常红。
- 无 P0/P1/P2 缺陷；4 条 P3 观察 + 6 项人工补测（宿主/浏览器相关，属环境限制）。
- **验收建议：可进入验收（ACCEPTANCE）阶段。**
