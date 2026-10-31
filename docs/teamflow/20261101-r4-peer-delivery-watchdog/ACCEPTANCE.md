# ACCEPTANCE — r4 第一期：上游直投 + 成员停滞检测

- 需求夹：`docs/teamflow/20261101-r4-peer-delivery-watchdog/`
- 分支：`feat/auto-team-plugin`（HEAD `5b47746`，工作树 28 项未提交改动 + 4 个新文件；PRD 明确「本轮未下发 commit/tag 指令」，故未提交属**预期状态**）
- 验收范围：本夹 PRD 的 AC-1 ~ AC-16（编号只在本夹内有效）；历史 AC（AC-18 面板可读性、AC-19 门禁回执、AC-20~AC-25 角色与记忆等）以「不回归」口径复验，不重复判定
- 验收人：产品经理（acceptance lead），**所有门禁由本阶段重新实跑**，不采信 QA 报告的转述数值

---

## 1. 门禁总表（本阶段独立实跑）

| # | 判据 | 命令 | 实跑输出（原文） | 结论 |
|---|---|---|---|---|
| G1 | typecheck 0 错 | `pnpm -s typecheck` | 无输出，`exit=0` | PASS |
| G2 | 单测 ≥172 全绿 | `pnpm -s test` | `tests 216 / pass 216 / fail 0 / duration_ms 3061.47` | PASS |
| G3 | build 双产物新鲜 | `pnpm -s build` + `find src -name '*.ts' -newer lib/index.js \| wc -l` | `lib/index.js 160.48 kB`、`lib/client.js 99476 B`（两者 mtime 同刻）、更新文件数 `0` | PASS |
| G4 | 双产物可加载 | `node --input-type=module -e "await import('./lib/index.js')"` / `client.js` | `host import exit=0`、`client import exit=0` | PASS |
| G5 | pack 3 条目 | `npm pack --dry-run \| grep -cE 'lib/(index\|client)\.js\|cordis\.patch\.yml'` | `3` | PASS |
| G6 | reverify 不降项 | `node logs/…/scripts/qa-reverify-probe.mjs` | `9/9 passed`、`exit=0` | PASS |
| G7 | collision 不降项 | `node logs/…/scripts/qa-collision-probe.mjs` | `12/12 passed`、`exit=0` | PASS |
| G8 | 新增 peer 探针 ≥4 | `node logs/…/scripts/qa-peer-probe.mjs` | `7 passed, 0 failed`（P1~P7）、`exit=0` | PASS |
| G9 | 新增 stall 探针 ≥4 | `node logs/…/scripts/qa-stall-probe.mjs` | `11 passed, 0 failed`（S1~S4）、`exit=0` | PASS |
| G10 | 直投真实到达 e2e | `node logs/…/scripts/qa-peer-e2e.mjs` | `6/6 passed`（E1~E6，含 `exitCode=3` 控制组）、`exit=0` | PASS |
| G11 | 装配接线 | `node logs/…/scripts/check-t4-wiring.mjs` | `14 passed, 0 failed`（W1~W14）、`exit=0` | PASS |
| G12 | 客户端 DOM 级 | `node logs/…/scripts/check-t3-client.mjs` | `16 passed, 0 failed`（含 C11 对 HEAD 变红的可分辨性对照）、`exit=0` | PASS |
| G13 | AC-7 宿主事件契约 | `node logs/…/scripts/ac7-event-probe.mjs` | `AC7-PROBE-GREEN (8/8)`、`exit=0` | PASS |
| G14 | 已知缺陷复现器（**预期红**） | `node logs/…/scripts/qa-progress-scope.mjs` | `FAIL [R1-cross-run-progress-leak]`、`exit=1` | 见 §5 QA-1（P3，非阻塞） |

> 纪律说明：本表所有 `exit` 均为**脚本自身退出码**（`node … >/dev/null 2>&1; echo $?`），不是管道尾命令的退出码——后者恒为 0，会把红看成绿。

---

## 2. AC 逐条判定

| AC | 判据要点 | 本阶段证据 | 判定 |
|---|---|---|---|
| AC-1 | 仅 `done` 且 `exitCode===0` 产出 1 条，其余 0 条 | 读 `handoff.ts:113-116` 三重早退（`verdict!=='done'` / `!evidence` / `exitCode!==0`，`null` 亦不投）；peer-probe `P1` 六态 `done+exit0=1 / done+exit1=0 / done+无证据=0 / done+exit=null=0 / rework=0 / failed=0`；peer-e2e `E6` 控制组 `exitCode=3 → toDownstream=0` | PASS |
| AC-2 | body 含上游 id+title、命令、退出码、≤800 字**尾部**摘要、artifacts（空则显式文案） | `handoff.ts:49-66`：`【上游直投】${id} ${title} 已通过门禁` / `命令：` / `退出码：` / `tail.slice(-800)`（取末）+ 截断显式标注 / `产物：${artifacts.length===0 ? '无落盘产物' : join}`；peer-probe `P2`（`HEADMARK` 置 tail 首位后实测**不含**→取末不取首；长度恰 800 不越界）；peer-e2e `E4` 缺项 `[]` | PASS |
| AC-3 | 投递前后 captain 消息条数不变，新增全为 `from='peer'` | `handoff.ts` 生成的 `MessageRecord` 只写 `from:'peer'`，不经 `makeMessage`（`messages.ts:31` 会覆盖幂等键）；peer-probe `P3` `captain 0→0`；peer-e2e `E3` `captain 0→0 peers=1` | PASS |
| AC-4 | (a) B 有 binding 则实发同一 body；(b) 无 binding 则在首条提示词注入 | (a) `bridge.ts:267-289 deliverPeerHandoffs` 按 `handoff:` 前缀 + `from=peer` + 有 `toMemberId` + 不在 before 集合逐条 `sendMessage`，正文直接取账本 `body`；peer-e2e `E2` `sent[0].text === ledger.body`（196 字节逐字相等）。(b) `dispatch.ts:503 handoffs: handoffBodiesFor(next.messages, taskId)` → `member-prompt.ts:42-43` 输出 `## 上游交接` 段；peer-probe `P7`；`test/dispatch.test.ts`「下游创建时把上游交接注入首条提示词」 | PASS |
| AC-5 | `(A,B)` 至多一条；重复 applyReceipt/resume 不新增、不重发 | 幂等键 `handoff:<a>-><b>`（`handoff.ts:38`）+ `existingIds`/批次内 `taken` 双去重；peer-probe `P4` `1×=2 2×=2 3×=2`、`P5` `ids=[handoff:t1->t2,handoff:t1->t3]`；peer-e2e `E5` 重放后 `peers 1→1 sent 1→1`；`bridge.ts:272` 以 `before.messages` 的 id 集合过滤，重放不再发 | PASS |
| AC-6 | 不回归 done 解锁 blocked→pending、全终态 terminated、回执文案 | 216 全绿（含既有解锁/terminated/回执三分支用例）；G6 `reverify 9/9`、G7 `collision 12/12` 不降项 | PASS |
| AC-7 | 宿主事件最小实验，结论进「已验证/未验证」两清单 | `TECHNICAL.md §2.1 已验证`（V1~V9）/`§2.2 未验证`（U1~U4）/`§2.3 三级降级`（L1/L1'/L2/L3，接口不变）；G13 `8/8`，选型 **L1**（根作用域 `tools/result` 主 + `agent/status` 伴生），实测停订 `tools/execute`（waterfall 必须 `next()`，漏调即吞工具执行） | PASS |
| AC-8 | 告警单出口：事件只更新进度，判定只在 `watcher.tick`；一 episode 恰一条 `kind:'tool'`，不扩枚举 | `index.ts:186-205` 订阅回调只 `touchProgress(...)`（无判定、无告警）；`stallAlerts` 全仓**唯一写入点** `watcher.ts:182-187`（`grep` 其余命中均为只读/类型/归一化）；`grep -rn "kind: 'tool'" src` 仅 `watcher.ts:174`；`git diff src/shared/types.ts` 未改 `ActivityEvent.kind` 枚举，只增 `ProgressRecord` 与 `MemberView` 三字段；stall-probe `S2` 5 次 tick 恒 `[1,1,1,1,1]` | PASS |
| AC-9 | 假成员必 `stalled=true` 且一条事件；同测试内对照 `stalled=false` 无事件 | stall-probe `S1-alert-only-stalled` / `S1-fake-member-stalled` / `S1-control-not-stalled` 全绿（同一 run 内一假一真对照）；`S1-task-status-untouched` 证明 `plan.tasks` 深相等 | PASS |
| AC-10 | 变异自检：禁用 `lastProgressAt` 更新后必红，贴红/绿两段相反实跑 | 绿：G9 `11 passed / exit=0`。红（本阶段实跑）：`qa-stall-probe.mjs --mutate=no-progress` → `exit=1`，`FAIL [S1-control-not-stalled] ctrl={"stalled":true,"stalledForMs":100000}`、`FAIL [S2-one-alert-per-episode] 条数=[2,2,2,2,2]（期望全 1）`、`FAIL [S1-alert-only-stalled]`，合计 `8 passed, 3 failed` | PASS |
| AC-11 | `WATCHER_INTERVAL_MS=1500`、`PANEL_ACTIVE_MS=2000` 不变，不新增 `setInterval`，≤5s 可见 | `config.ts:51 = 1500`、`shared/const.ts:26 = 2_000`；`grep -rn setInterval src` 实体调用仅 `watcher.ts:247` 1 处（另 2 处是类型注解与注释）→ 无新增定时器；1500+2000=3.5s < 5s；stall-probe `S4-interval-budget` | PASS |
| AC-12 | 不叠加旧 15s 心跳提示；优先级 死亡>停滞>心跳；client 不自算超时 | `grep -rn "STALE_MS\|data-member-stale-hint\|data-stale" src` → **0 命中**（原 6 处整条删除）；`viewmodel.ts:363 stalledRowOf` 首行 `if (member.status !== 'running' \|\| !stalled) return {show:false,…}` → interrupted/failed 永不渲染停滞条（死亡优先）；秒数只取宿主 `stalledSecondsText`，客户端零阈值比较、零毫秒格式化；stall-probe `S4-no-legacy-stale`；t3-client `C9-legacy-heuristic-gone` | PASS |
| AC-13 | `STALL_MS` 只在 `config.ts` 定义一次（默认 90000）；停滞不改 task.status、不触发 resume/rework | `grep -rn "STALL_MS = " src` → 唯一 `config.ts:61 export const STALL_MS = 90_000`（bridge/watcher/index 均 `?? STALL_MS` 或传参）；全仓比较点唯一 `stall.ts:39 if (silentForMs < stallMs)`；`watcher.ts` 内无 resume/rework 调用（tick = `reconcileMembers → stallAlertsOf → 有变更才 save`）；stall-probe `S1-task-status-untouched`、`S4-stall-const-once` | PASS |
| AC-14 | 停滞文案含秒数、与 interrupted 文案不相等、恢复后回正常态 | interrupted = `已中断`（`viewmodel.ts:50`）；停滞 = `疑似停滞 · 成员还活着，但已 {秒数} 没有实质产出`（`STALL_LEAD/STALL_TAIL` + 宿主 `stalledSecondsText`）→ 不相等；秒数分档 `<600s → N 秒 / ≥600s → M 分 S 秒`（`stall.ts:93`）；恢复由宿主 `stalled=false` 决定，`watcher.ts:160-164 clearAlerted` 回正常态；stall-probe `S2-recover-then-realarm`、`S3-seconds-copy`；t3-client DOM `data-stall-seconds` | PASS |
| AC-15 | 全量门禁 | 见 §1 G1~G12：typecheck 0 / 216≥172 / 双产物新鲜 / 双 import exit 0 / pack 3 / reverify 9 / collision 12 / peer 7 / stall 11 | PASS |
| AC-16 | 本夹产出 QA-REPORT.md 与 ACCEPTANCE.md | `QA-REPORT.md`（120 行，含 AC 判定表与红/绿两段原文）、本文件 | PASS |

**判定小结：AC-1 ~ AC-16 全部 PASS（16/16）。**

---

## 3. 架构一致性核查（强制项）

| 核查点 | 结果 |
|---|---|
| 蓝图对齐（TECHNICAL §4.2/§4.3 冻结的两个新模块是否如实抽出） | ✅ `src/host/team/handoff.ts`(131 行) 与 `src/host/team/stall.ts`(95 行) 均已抽出，均为纯逻辑：**只 import `../../shared/types.ts`**，零 IO、零宿主、零定时器、不读常量（阈值传参）——符合 `src/shared ← host` 依赖铁律 |
| 装配顺序 | ✅ 唯一装配点 `index.ts`：`onMemberProgress(ctx, …)` 订阅 → `registerEffect(ctx, () => progressSub.stop())` 回收；`createBridge`/`createMemberWatcher` 各传一次 `stallMs: STALL_MS`（W9/W10 已覆盖）；`bridge.act('receipt')` 内 `applyReceipt → deliverPeerHandoffs` 顺序正确 |
| 重复实现 | ✅ 三重唯一性实测：停滞**判定**唯一（`stall.ts:39` 全仓唯一比较点，`watcher.tick` 与 `bridge.membersOf` 共用 `stallOf`）；交接**正文**唯一（`handoff.ts:92` 生成一次，账本存、提示词从账本读，故 AC-4 逐字相等是结构保证，非巧合）；peer **实发**唯一（`bridge.deliverPeerHandoffs`，`applyReceipt` 保持零 IO） |
| 适配器漂移 | ✅ 宿主形状仍只在 `adapters.ts`（新增 `agentOfToolEvent`/`onMemberProgress`/`memberIdentityOf`），`grep -n "ctx\.\(on\|effect\|api\|tool\|inject\)" src/host/index.ts` → 0 命中（index 只用项目内 helper + `registerEffect`）；`grep -rn "from '../host/" src/client` → 0 |
| 死导出 / 越界 | ✅ `stallSentence` 被 `watcher.ts:177` 使用、`STALL_SUFFIX` 作悬停说明，无死导出；`git status` 未见越权新增顶层目录/脚本 |
| 观察（不构成缺陷） | 停滞**文案**存在两处字面（宿主活动流 `stallSentence`、客户端行 `STALL_LEAD+TAIL`），措辞按 DESIGN §7.5 与 TECHNICAL §5.1 **有意不同**、判定同源；若日后要求统一措辞需两处同改，已记入 §5 建议 |

**结论：实现忠实遵循架构蓝图，未发现「应抽未抽 / 重复实现 / 破坏既有结构」；TECHNICAL §4.10「零新增路由/动作/枚举」也已核验（`git diff src/shared/types.ts` 只增字段与 `ProgressRecord`，`ActivityEvent.kind` 枚举未动）。**

---

## 4. 与 PRD 反目标的对照（四条都当场可观察）

| 反目标 | 观察结果 |
|---|---|
| 双告警刷屏 | 旧 15s 启发式已整条删除（0 命中），同一行不可能出现两条口径；G14 的 `S4-no-legacy-stale` 已固化为回归 |
| 证据只在账本、没进成员上下文 | `member-prompt.ts:42` 注入 `## 上游交接` 段，正文与账本逐字相同（`handoffBodiesFor` 只读取、不再拼装） |
| 队长账本多出一条转述 | peer-e2e `E3` `captain 0→0`；`handoffMessages` 只产 `from:'peer'` |
| 把「安静」或「已死」误标成停滞 | 判定只对 `status==='running'` 生效（`watcher.ts:151`、`viewmodel.ts:363`），interrupted/failed 终态直接跳过；`stallOf` 对时钟回拨夹到 0 |

---

## 5. 缺陷与遗留（无 P0/P1/P2；3 条 P3 已核实，均不阻塞本期验收）

| 编号 | 级别 | 现象 | 影响与处置 |
|---|---|---|---|
| QA-1 | P3 | `index.ts:195` 反查 binding 时有 `\|\| binding.name === identity.name` 兜底，跨 run 同名（成员名由 `roleId\0taskId` 派生、不含 runId）时会把别的 run 的进度一起推进。本阶段复跑 `qa-progress-scope.mjs` → `FAIL [R1-cross-run-progress-leak]`、`exit=1` | 后果是**假阴性**：两个会话同时跑相同 role+taskId 时，真停滞的成员可能被另一 run 的活动续命而不告警。窗口窄（需两 run 同时活跃且名字未被 `-2` 消歧）。**建议下期收敛匹配**：优先按 `runId`/会话过滤，`name` 兜底仅在 `identity.id` 为空时启用（避免破坏 resume 时 id 变化的匹配）。该脚本是**已知缺陷复现器，预期红**，不得当成回归失败 |
| QA-2 | P3 | B 成员会话不可写（`sendMessage` 抛错/`ok=false`）后，账本条目仍按「已投递」存在，后续 `deliverPeerHandoffs` 只发「本次新增」→ 该成员本轮永久收不到证据（仅下次派发时靠提示词注入） | 与 TECHNICAL 设计一致（失败只 push notice，不写 captain 消息）。建议补「未送达」标记或下一 tick 重投；当前不影响 AC-4 的两种正常路径 |
| QA-3 | P3 | 每次工具结果都触发 `store.list()` + 逐 run `load()`，成本随历史 run 数线性增长（QA 实测 50/200/500 run = 6.1/22.3/61.5 ms，`runs/` 无 prune） | 建议按 `memberId` 建索引或按会话前缀过滤，并给 `runs/` 加保留策略；同期 `watcher.tick`/`latestForSession` 同模式，宜一并收敛 |
| 建议 | — | 停滞文案两处字面（见 §3 观察） | 若产品要求面板与活动流措辞一致，需 `stallSentence` 与 `STALL_LEAD/TAIL` 同改；本期按 DESIGN 有意区分，不改 |

---

## 6. 人工补测清单（环境限制，非交付缺陷）

1. **真实 GUI 渲染**：本机沙箱缺 `PROCESS_SET_ALL_ACCESS` 相关位，Chromium crashpad 必然自终止，浏览器不可用；QA 已用 DOM 级脚本化断言替代（`check-t3-client.mjs` 16/16，含 host→DOM 的 C5/C5b）。**未做人眼视觉复核**（任务夹内无截图），需在真实宿主 profile 装一次后看：停滞条的换行/遮挡、`grid-column: 1/-1` 跨全宽插槽是否撑破 76/96/64/44 四列、琥珀色仅用于非文本位置。
2. **面板刷新 ≤5s 观感**：1500+2000=3500ms 是静态预算，真实 tick + 渲染的端到端观感需一次真机确认。
3. **成员被杀 5s 内变 interrupted**（历史 AC-18）：由 reverify `A4` 真机时序项覆盖，未在本轮重跑真机。

---

## 7. 提交面与工程约束（PRD §工程约束逐条核对）

| 约束 | 核对结果 |
|---|---|
| 不切分支（沿用 `feat/auto-team-plugin`） | ✅ `git branch` 当前即该分支，HEAD `5b47746` |
| 本轮不下发 commit/tag 指令 | ✅ 未提交，工作树 28 项改动 + 4 个新文件（`handoff.ts`/`stall.ts`/`handoff.test.ts`/`stall.test.ts`）属预期状态；`.gitignore` 已按 S0 复核（补 `.vscode/`、`.idea/`、`.env*`、`!.env.example`） |
| `lib/` 必须入库 | ✅ `git check-ignore lib/index.js lib/client.js` 不被忽略；产物与源码同步（G3 更新文件数 0） |
| 无提交面噪声 | ✅ 无 `node_modules/`、`dist/`、`.pnpm-store/`、`*.tgz`；`logs/teamflow/` 不在提交面（host 生命周期管理） |
| 文档只写 `docs/teamflow/` | ✅ 本夹 + `memory.md`（仅补 r4 约定，主题式替换、非变更日志）；未触碰 AGENTS.md 托管区 |

---

## 8. 验收意见

本期两条主链路（**依赖完成即直投** 与 **成员第二层停滞检测**）在契约、实现、装配、客户端呈现四个层面都落到位，且关键不变量是**结构保证**而非纪律约定：告警只有一个出口（`watcher.stallAlertsOf`）、判定只有一份实现（`stallOf` 传参）、交接正文只拼一次（账本与提示词逐字相同）、peer 实发只有一个入口。AC-1~AC-16 全部通过，门禁 14 项全绿（唯一红项是已知 P3 的复现器，预期红）。

3 条 P3 均为**可观测、可绕开、窗口窄**的遗留，已给出收敛建议，建议作为独立工单（不随本期返工）。唯一需要在真机补的是**视觉复核**，属环境限制。

验收结论：✅ 通过
