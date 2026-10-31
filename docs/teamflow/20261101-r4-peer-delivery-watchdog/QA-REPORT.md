# QA 报告 · r4 上游直投 + 成员停滞检测

- 需求夹：`docs/teamflow/20261101-r4-peer-delivery-watchdog/`
- 分支：`feat/auto-team-plugin`（HEAD `5b47746`，未提交工作树 28 项 + 4 个新文件）
- 测试对象：`src/host/team/handoff.ts`、`src/host/team/stall.ts`（新）、`dispatch.ts`、`member-prompt.ts`、`bridge.ts`、`watcher.ts`、`adapters.ts`、`store.ts`、`config.ts`、`shared/types.ts`、`client/{viewmodel,styles,MembersTab}`、`lib/{index,client}.js`
- 结论：**可验收**（0 个 P0/P1/P2；3 条 P3 观察，见 §5）

## 1. 门禁总表（全部实跑，非存在性检查）

| # | 判据 | 命令 | 实跑输出 | 结论 |
|---|---|---|---|---|
| G1 | typecheck 0 错 | `pnpm -s typecheck` | `exit=0`（无输出） | PASS |
| G2 | 单测 ≥172 全绿 | `pnpm -s test` | `tests 216 / pass 216 / fail 0 / duration_ms 3042` | PASS |
| G3 | build 双产物新鲜 | `pnpm -s build && find src -name '*.ts' -newer lib/index.js \| wc -l` | `lib/index.js 160.48 kB`、`lib/client.js 99.5 kB`、更新文件数 `0` | PASS |
| G4 | 双产物可加载 | `node --input-type=module -e "await import('./lib/index.js')"` / `client.js` | `host exit=0`、`client exit=0` | PASS |
| G5 | pack 3 条目 | `npm pack --dry-run 2>&1 \| grep -cE 'lib/(index\|client)\.js\|cordis\.patch\.yml'` | `3` | PASS |
| G6 | 既有 reverify 不降项 | `node logs/…/scripts/qa-reverify-probe.mjs` | `9/9 passed`（A4 真机时序、A6 面板「已核对」、B1/B2 命名、E1 并发计划） | PASS |
| G7 | 既有 collision 不降项 | `node logs/…/scripts/qa-collision-probe.mjs` | `12/12 passed`（C1~C11） | PASS |
| G8 | 新增 peer 探针 ≥4 项 | `node logs/…/scripts/qa-peer-probe.mjs` | `7/7`（P1 触发六态 / P2 五要素+末 800 字方向 / P3 不走队长 / P4 fanout 幂等 / P5 幂等键 / P6 两条去向 / P7 提示词注入） | PASS |
| G9 | 新增 stall 探针 ≥4 项 | `node logs/…/scripts/qa-stall-probe.mjs` | `11/11`（S1 假成员 vs 对照 / S2 一 episode 一条+恢复再告警 / S3 秒数 / S4 常量·预算·旧启发式归零·单出口） | PASS |
| G10 | 直投真实到达（QA 新增独立 e2e） | `node logs/…/scripts/qa-peer-e2e.mjs` | `6/6`（见 §3） | PASS |
| G11 | 装配接线 | `node logs/…/scripts/check-t4-wiring.mjs` | `14/14`（W1~W14） | PASS |
| G12 | 客户端 DOM 级 | `node logs/…/scripts/check-t3-client.mjs` | `16/16`（C1~C11，含 host→DOM 的 C5/C5b 与 C11 对 HEAD 变红） | PASS |
| G13 | 宿主事件契约（AC-7 前置） | `node logs/…/scripts/ac7-event-probe.mjs` | `8/8`（L1 成立：根作用域收得到成员调用） | PASS |
| G14 | 工程约定静态项 | 见 §6 表 | 全部 0 命中/唯一命中 | PASS |

## 2. AC 判定表（AC-1~AC-16）

| AC | 判据 | 实跑证据 | 判定 |
|---|---|---|---|
| AC-1 | 仅 `done` 且 `exitCode===0` 产出 1 条，其余 0 条 | peer-probe `P1`：`done+exit0=1 done+exit1=0 done+无证据=0 done+exit=null=0 rework=0 failed=0`；peer-e2e `E6` 控制组 `exitCode=3 peers=0 toDownstream=0` | PASS |
| AC-2 | body 含上游 id+title、命令、退出码、≤800 字**尾部**摘要、artifacts（空则显式文案） | peer-probe `P2`：`HEADMARK` 置于 tail 首位后实测**不含**（取末不取首）、`x` 长度恰 800 不越界、`artifacts-empty` 命中「无落盘产物」；peer-e2e `E4` 五项全中且正文不含「队长」 | PASS |
| AC-3 | 投递前后 captain 消息条数不变，新增全为 `from='peer'` | peer-probe `P3`：`captain 0→0`；peer-e2e `E3`：`captain 0→0 peers=1` | PASS |
| AC-4 | (a) B 有 binding 实发同一 body；(b) 无 binding 时注入首条提示词 | peer-e2e `E2`：`sent=1 to=member-2 ledgerTo=member-2`，`sent[0].text === ledger.body`（196 字节逐字相等）；peer-probe `P7` + dispatch 单测「下游创建时把上游交接注入首条提示词」 | PASS |
| AC-5 | `(A,B)` 至多一条；重复 applyReceipt/resume 不新增、不重发 | peer-probe `P4`：`1×=2 2×=2 3×=2`；`P5`：`ids=[handoff:t1->t2,handoff:t1->t3]`；peer-e2e `E5`：重放后 `peers 1→1 sent 1→1`；bridge 单测「重放不重发」 | PASS |
| AC-6 | 不回归 blocked→pending 解锁、全终态 terminated、回执文案 | `pnpm test` 216 全绿（含 AC-19 回执三分支、解锁、terminated）；reverify 9/9、collision 12/12 不降项 | PASS |
| AC-7 | 宿主事件最小实验，结论进「已验证/未验证」两清单 | `TECHNICAL.md §2.1 V1~V9` + `§2.2 U1~U4` + `§2.3 L1/L1'/L2/L3`；ac7-probe `C1~C8` 8/8，选定 **L1**（根作用域 `tools/result` 主 + `agent/status` 伴生），不订阅 waterfall | PASS |
| AC-8 | 告警单出口：事件只更新进度，判定只在 `watcher.tick`；一次 episode 恰好一条 `kind:'tool'`，不扩枚举 | wiring `W1/W3/W8`；`grep kind:` 仅 `watcher.ts:174 kind: 'tool'`；`git diff src/shared/types.ts` 只增 `MemberView` 三字段 + `ProgressRecord`，`ActivityEvent.kind` 枚举未动；stall-probe `S2`：5 次 tick `[1,1,1,1,1]` | PASS |
| AC-9 | 假成员必 `stalled=true` 且一条事件；同测试内对照成员 `stalled=false` 无事件 | stall-probe `S1-alert-only-stalled` / `S1-fake-member-stalled` / `S1-control-not-stalled` 全绿；`S1-task-status-untouched` 证明 `plan.tasks` 深相等（AC-13） | PASS |
| AC-10 | 变异自检：禁用 `lastProgressAt` 更新后必红，贴红/绿两段 | 绿：`node …/qa-stall-probe.mjs` → `exit=0 11/11`；红：`node …/qa-stall-probe.mjs --mutate=no-progress` → `exit=1`，`FAIL [S1-control-not-stalled] ctrl={"stalled":true,"stalledForMs":100000}`、`FAIL [S2-one-alert-per-episode] 条数=[2,2,2,2,2]`、`FAIL [S1-alert-only-stalled]`，8 passed / 3 failed | PASS |
| AC-11 | `WATCHER_INTERVAL_MS=1500`、`PANEL_ACTIVE_MS=2000` 不变，不新增 `setInterval`，≤5s 可见 | `config.ts:51 = 1500`、`shared/const.ts:26 = 2_000`；`grep -rn setInterval src` 实调用仅 `watcher.ts:247` 1 处（余 2 处为类型注解与注释）；1500+2000=3.5s < 5s；`S4-interval-budget` 绿 | PASS |
| AC-12 | 不叠加旧 15s 心跳提示；优先级 死亡>停滞>心跳；client 不自算超时 | `grep -rn "STALE_MS\|data-member-stale-hint\|data-stale" src` → **0 命中**（原 6 处已删）；`S4-no-legacy-stale` 绿；`viewmodel.ts:361-362` 只有 `status==='running' && stalled` 才渲染；client 零毫秒格式化、零阈值比较 | PASS |
| AC-13 | `STALL_MS` 只在 `config.ts` 定义一次（默认 90000）；停滞不改 task.status、不触发 resume/rework | `grep -rn "STALL_MS = " src \| wc -l` → `1`，`config.ts:61 export const STALL_MS = 90_000`；`stall.ts:39` 是唯一比较点，其余全部收参数；`S1-task-status-untouched` 绿 | PASS |
| AC-14 | 停滞文案含秒数、与 interrupted 文案不相等、恢复后回正常态 | `viewmodel.ts:50` interrupted=`已中断`；`:332-335` 停滞=`疑似停滞 · 成员还活着，但已 {秒数} 没有实质产出` → 不相等；秒数原样取宿主的 `stalledSecondsText`（`S3-seconds-copy`、DOM `data-stall-seconds`）；恢复由宿主 `stalled=false` 决定（`S2-recover-then-realarm`） | PASS |
| AC-15 | 全量门禁 | 见 §1 G1~G10（typecheck 0 / 216≥172 / 双产物新鲜 / 双 import 0 / pack 3 / reverify 9 + collision 12 / peer 7 + stall 11 各≥4） | PASS |
| AC-16 | 本夹产出 QA-REPORT.md 与 ACCEPTANCE.md | 本文件；ACCEPTANCE.md 由验收阶段产出 | PASS（本环） |

## 3. QA 新增的独立端到端探针（本轮唯一新增检查资产）

`node logs/teamflow/tf-mvwnm3d9-l8db12/scripts/qa-peer-e2e.mjs` → `exit=0`

它补的是既有检查之间的**缝**：`qa-peer-probe` 只喂纯函数 `applyReceipt`（证账本），`test/bridge.test.ts` 只喂模拟回执状态（证发送），没有一条跑过「真门禁执行 → 真 `applyReceipt` → `bridge.act('receipt')` → 真 `sendMessage`」这条完整链。本探针全用真实模块，只替换宿主端口：

```
PASS [E1-gate-really-ran] status=done exitCode=0 log=true notices=["门禁通过（退出码 0）：t1 已完成","上游交接已直投给 dev-t2（t2）"]
PASS [E2-real-delivery-body-identical] sent=1 to=member-2 ledgerTo=member-2 toField=dev-t2 bytes=196
PASS [E3-no-captain-hop] captain 0→0 peers=1
PASS [E4-body-sections] 缺项=[]
PASS [E5-replay-idempotent] peers 1→1 sent 1→1 ids=[handoff:t1->t2]
PASS [E6-control-nonzero-exit-no-handoff] exitCode=3 peers=0 sentTotal=1 toDownstream=0
QA PEER E2E RESULT: 6/6 passed
```

`E6` 是控制组（门禁 `exit 3`）：`sentTotal=1` 是 AC-19 的**返工证据回发**（发给 member-1，合法），发往下游成员 0 条 —— 证明 E1~E5 不是恒绿。

## 4. 失败/阻塞用例

无失败用例、无阻塞用例。浏览器不可用属**环境限制**（沙箱令牌缺 `PROCESS_SET_ALL_ACCESS` 相关位，Chromium crashpad 必然自终止），已用 DOM 级脚本化断言（`check-t3-client.mjs` 16/16）替代，不算交付缺陷。

## 5. 缺陷表

| 编号 | 严重级 | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| QA-1 | P3 | 停滞检测/推进记录 | 同一 profile 下存在两个 run，其绑定同名但 memberId 不同（成员名是 `shortIdentityHash(roleId+taskId)` 的确定性值，不含 runId，跨会话同 taskId 同名）；对 A run 的成员发一次 `tools/result` | 只推进 A run 的绑定 | B run 的绑定进度也被推进（`index.ts:195` 的 `\|\| binding.name === identity.name` 兜底跨 run 命中）→ B 里真停滞的成员会被别的 run 续命而永不告警（假阴性，窗口窄：需两 run 同时活跃且名字未被 `-2` 消歧） | AC-8 / AC-9 | `node logs/teamflow/tf-mvwnm3d9-l8db12/scripts/qa-progress-scope.mjs` | `exit=0` 且 `PASS [R1-cross-run-progress-leak] B={}`（建议按 runId/会话收敛匹配；name 兜底只在 id 为空时启用，以免破坏 resume 时 id 变化的匹配） |
| QA-2 | P3 | 直通投递 | B 成员已存在但其会话暂时不可写（`sendMessage` 抛错）后 A 完成门禁 | 证据至少可重投，或账本明确标记「未送达」 | 只 push 一条 notice；账本条目仍按已投递存在，后续不会再发（`deliverPeerHandoffs` 只发「本次新增」），B 的提示词注入只在**下次派发**才发生 → 该成员会话永久收不到证据 | AC-4 | `grep -n "失败只 push notice" docs/teamflow/20261101-r4-peer-delivery-watchdog/TECHNICAL.md` | 行为与 TECHNICAL 设计一致（`bridge.ts` 失败分支只 notice），故列观察；建议补「未送达」标记或下一次 tick 重投 |
| QA-3 | P3 | 架构/性能 | 历史 run 累积后，每次工具结果都触发 `index.ts:191` 的 `store.list()` + 逐 run `store.load()`（`list()` 内部已 load 过一遍，等于双解析） | 处理一次工具事件的成本与历史 run 数无关 | 成本随历史线性增长：实测 50 run=6.1ms、200 run=22.3ms、500 run=61.5ms，且同步执行在宿主事件循环里（run 文件永不清理：`runs/` 无 prune） | AC-8（"事件只更新进度"的实现方式） | `node /tmp/bench-store.mjs` 等价基准（见 §6「性能实测」）；同一模式亦存在于既有 `watcher.tick` 与 `latestForSession` | 200 run 下单次事件 < 5ms，或改为按 `memberId` 建索引 / 按会话前缀过滤 |

未发现 P0/P1/P2 缺陷。

## 6. 架构与接口一致性（强制项）

**接口一致性（静态，零运行时）**：跨模块调用的被调成员全部实存、导出、签名匹配，typecheck `exit=0` 为其编译级证明。

| 调用点 | 被调导出 | 实跑 grep |
|---|---|---|
| `dispatch.ts:28,503,729` | `handoffBodiesFor` / `handoffMessages` | `handoff.ts:120`、`:77` |
| `bridge.ts:52` | `stall.ts` 的 `secondsText` / `stallOf` | `stall.ts:83`、`:29` |
| `watcher.ts:18` | `clearAlerted` / `stallOf` / `stallSentence` | `stall.ts:65`、`:29`、`:93` |
| `index.ts:47` | `touchProgress` | `stall.ts:49` |
| `index.ts:30-31` | `onMemberProgress` / `memberIdentityOf` | `adapters.ts:680`、`:790` |
| `store.ts` | `STALL_ALERTS_LIMIT` / `normalizeProgress` / `normalizeStallAlerts` | `:39`、`:270`、`:291` |
| `shared/types.ts` | `MemberView.stalled/stalledForMs/stalledSecondsText`、`ProgressRecord` | `:125`、`:130`、`:132`、`:142` |

**架构核查结论（0 缺陷）**：
- 蓝图对齐：TECHNICAL §4.2 冻结的两个新模块**已如实抽出** —— `handoff.ts`(131 行) 只 import `shared/types.ts`，`stall.ts`(95 行) 只 import `shared/types.ts`，纯逻辑、可单测，符合 `src/shared ← host` 依赖铁律。
- 无重复实现：停滞**判定**唯一（`stall.ts:39` 全仓唯一比较点，`bridge.membersOf` 与 `watcher.tick` 共用 `stallOf`）；交接**正文**唯一（`handoffBody` 生成、账本存、提示词从账本读，不二次拼装，故 AC-4 逐字相等是结构保证）；peer **实发**唯一（`bridge.deliverPeerHandoffs`，`applyReceipt` 保持零 IO）。
- 无越界：新代码零 `ctx.*`（宿主 API 仍只在 `adapters.ts`）；`grep -rn "from '../host/" src/client` → `0`。
- 无死导出：`stallSentence` 被 `watcher.ts:177` 使用（活动流文案），`STALL_SUFFIX` 作为停滞条 `title`。
- 观察：停滞**文案**存在两处字面（宿主活动流 `stallSentence` / 客户端行 `STALL_LEAD+TAIL`），措辞按 DESIGN §7.5 与 TECHNICAL §5.1 有意不同、判定同源，不构成分叉；若将来要求统一措辞，需两处同改。

**性能实测**（QA-3 依据）：合成 40 条 800 字消息的 run 文件，`store.list()` 与 `list()+逐 run load()` 计时 —— `N=50: 3.4ms/6.1ms`、`N=200: 12.2ms/22.3ms`、`N=500: 29.0ms/61.5ms`。

## 7. 提交面卫生（P1 门禁，本轮通过）

- `git status --porcelain --untracked-files=all`（排除 `logs/`）：`M` 24 项（含 `.gitignore`、TECHNICAL.md、memory.md、`lib/{index,client}.js`）+ `?? src/host/team/{handoff,stall}.ts`、`?? test/{handoff,stall}.test.ts`。**无** `node_modules/`、`dist/`、`.pnpm-store/`、`.idea/`、`.vscode/`、`.env`、`*.tgz`、构建缓存。
- `.gitignore` 逐项 `git check-ignore`：`node_modules/x`、`dist/x`、`.auto-team/x`、`logs/teamflow/x`、`*.tgz`、`.DS_Store`、`.vscode/x`、`.idea/x`、`.env` 均**被忽略**；`lib/index.js`、`lib/client.js`、`cordis.patch.yml`、`docs/teamflow/memory.md`、`.env.example` 均**不被忽略**（`lib/` 必须入库的契约成立）。
- 未提交：本轮未下发 commit 指令，收口提交由 host 执行。

## 8. 人工补测清单（环境限制，非交付缺陷）

| 项 | 验收判据 | 方法/工具 |
|---|---|---|
| 停滞条的真实视觉质感 | 琥珀竖条 + 8% 底 + 120ms 淡入在暗色/亮色主题下不刺眼，折行时秒数不被截断 | macOS 上 Chromium headless（`ms-playwright/chromium_headless_shell`）截 `[data-member-stall]` 区域，或宿主面板实机截图目视 |
| 账本 800 字 peer 正文的折叠手感 | 展开/收起不抖动、`flex:1 0 100%` 整行正文不横向滚动（`scrollWidth <= clientWidth`） | 同上，配合 `data-message-toggle` 点击两态截图 |
| 宿主真实加载 | 安装到 profile（`pnpm add file:<repo>` + `dsh.profile.bundles`）后重启，面板出现停滞条与「上游直投」账本行 | 需主 agent 执行安装与宿主重启（沙箱内不可用），安装前先写下卸载命令 |
| 长工具调用（>90s）是否误报停滞 | 单次 `pnpm test`/构建超过 90s 时是否出现停滞条；若误报，评估是否接入 `agent/status` 的更密信号 | 真实成员跑一次长命令观察面板（本沙箱无真实 spawn，不能作为缺陷判据） |

## 9. 结论

**可验收。** 16 条 AC 全部实测通过，门禁 14 项全绿（typecheck 0、216/216 单测、双产物新鲜可加载、pack 3 条目、既有 reverify 9/9 与 collision 12/12 不降项、新增 peer 7/7 + stall 11/11 + 直投 e2e 6/6），变异自检红/绿两段相反输出齐备，提交面无污染。发现 3 条 P3 观察（跨 run 同名进度泄漏、实发失败无重投、每次工具事件全量扫描历史 run），均不阻塞验收，建议进下一轮待办。
