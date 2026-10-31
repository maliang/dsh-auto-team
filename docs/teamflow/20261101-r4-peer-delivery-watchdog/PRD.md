<!-- meta: summary="依赖任务通过门禁时把产物与证据以成员→成员直投给下游（不经队长转述），并给成员加第二层停滞检测：活着但长时间无实质产出时面板给出可区分的告警态" -->
基线依赖：docs/teamflow/20261031-r3-collision-name-suffix（成员名确定性消歧与派发链路；其「ready 任务必落 started/skipped/errors」「名字恒定」等既有行为不得回归）
依据：docs/teamflow/architecture/SUPER-AGENT-MAPPING.md §3.1（直通投递）、§3.2（Watchdog 第二层）、§4（不搬）、§5（分期与风险）

# r4 · 直通投递 + 停滞检测（Super-agent 融入第一期）

## 1. 背景与目标

本产品把「当前会话当队长」的多成员编排做出来了，但信息流仍全部穿过队长：任务 A 完成、门禁通过，A 的产物与证据只写进**给队长看的**回执；任务 B 依赖 A，B 的成员开跑时只知道「前置任务已完成：A」，具体产物在哪、证据是什么，要靠队长在派发时**转述**（`src/host/team/member-prompt.ts:37` 只列了依赖 id）。队长因此成为所有信息的必经之路，这既是 token 成本，也是信息失真的来源。

另一面，`src/host/team/watcher.ts` 只做**存活对账**：成员缺席 / inactive / failed → `interrupted`。一个活着但 20 分钟没有任何实质产出的成员，在面板上永远是绿的，只能靠人发现。门禁只管结果层，没人管过程层。

本期只做这两条（§3.1 + §3.2），不做 Trigger 总线、不做 Inline & Spill、不改队长模型：

- **目标 A（直通投递）**：上游任务判定 `done` 且门禁 `exitCode === 0` 时，按 `plan.dependsOn` 把「上游产物落盘路径 + 门禁证据摘要」以**成员→成员**（`from: 'peer'`，非 captain）来源直接交给每个下游成员，并保证下游成员**实际读到**（进其上下文），而不是只落在账本里。
- **目标 B（停滞检测）**：在既有存活层之上补第二层「有没有在动」。按成员最近一次实质产出（宿主工具执行事件）判定，超过阈值且任务在跑时，面板该行给出与 `interrupted` **可区分**的告警态，并留一条活动事件；复用 `ActivityEvent.kind` 里已有但无人生产的 `'tool'`，不扩类型。

**成功判据（一句话）**：下游成员开跑时上下文里就有上游证据（队长账本没有为这次转述多出一条消息）；一个「活着但从不调工具」的成员必然在阈值后告警，而持续调工具的对照成员不告警。

## 2. 用户故事（各带可测验收口径）

1. **作为队长（当前会话）**，我不希望再手抄上游结论：A 完成后 B 的成员自己拿到 A 的产物路径与门禁证据，我不用为这次转述再发一条消息。
   → 验收：AC-2 / AC-3 / AC-4。
2. **作为下游成员**，我开跑时上下文里就有上游交接（任务 id、命令、退出码、证据尾部、产物路径），不必回头问「上游产物在哪」。
   → 验收：AC-2 / AC-4(b)。
3. **作为用户**，我要能一眼看出「成员活着但卡住了」：面板该行是独立的停滞态与文案，不是「运行中」，也不是「已中断」。
   → 验收：AC-9 / AC-14。
4. **作为用户**，我讨厌重复告警：一次停滞只出现一条提示、一条活动事件；关掉面板再打开仍能看到这条痕迹。
   → 验收：AC-8 / AC-12。
5. **作为维护者**，我要能证明这套检测真的在起作用：删掉时间戳更新逻辑，那条断言必须变红。
   → 验收：AC-10（变异自检，需贴两段相反结论的实跑输出）。
6. **作为维护者**，我不接受为了这条功能破坏刷新预算或另起一套入口。
   → 验收：AC-7（最小实验前置）/ AC-11（1500 + 2000 不变、无新增轮询）/ AC-8（判定只在宿主一处）。

## 3. 范围与非目标

**范围内**

- 直通投递：`applyReceipt` 判 `done` 后的 peer 交接（账本记录 + 下游成员上下文注入 + 成员已存在时实发）。
- 停滞检测：宿主事件订阅更新「最近实质产出时间」；watcher tick 内做停滞判定；快照新增停滞态字段；面板成员行可区分告警 + 一条 `kind: 'tool'` 活动事件。
- 最小实验（事件 payload 实测）+ 单测 + 探针 + 全量门禁 + 本夹的 QA-REPORT / ACCEPTANCE。

**非目标（本期明确不做）**

- Trigger 总线 / Fast-Slow 过滤（§3.3）、Inline & Spill（§3.4）、队长模型改造与 `noWait` 指引（§3.5）。
- 语义偏航判定（「成员在做错的事」）、Effect 持久队列、SQLite、多信道。
- 改变派发时序（例如让下游成员提前常驻等待上游）；改变并发模型。
- 新增 `ActivityEvent.kind` 枚举值、新增 `PanelAction`、新增 HTTP 路由。

## 4. anti-goals / 反面目标

以下是「测试全绿但人一眼就否掉」的形态，每条都可被使用者当场观察到：

1. **同一成员同一轮停滞出现两条提示**：黄色「疑似停滞」和行内旧提示「心跳已超过 15 秒，宿主正在对账（成员进程可能已退出）」同时出现，且每 2 秒重复刷一次 —— 用户从此学会忽略黄条。
2. **证据只在账本里、没进成员上下文**：消息账本能查到 peer 记录，但下游成员开跑后仍在追问「上游产物在哪」，或它看到的是队长复述的二手摘要 —— 直通变成「给用户看的直通」。
3. **队长账本多出一条「我已把 A 的结果转给 B」**：`from` 改成 peer 只是换了字段名，信息实际仍过队长，用户核对账本时发现两次转述。
4. **报警对象错了**：一个埋头连续调工具、只是 3 分钟没发消息的正常成员被判停滞；或一个已经退出（interrupted）的成员被标成「停滞」而不是「已中断」—— 状态语义被拍平。

## 5. 交互流程摘要

**流程 A · 直通投递（事件：成员回报 → 门禁通过）**

1. 成员回报回执 → 既有门禁链路跑 `acceptance` → 得 `GateEvidence{command, exitCode, tail, artifacts, at}`。
2. 判定 `done` 且 `exitCode === 0` → 遍历 `plan.tasks`，找 `dependsOn` 含本任务 B'（下游集合）。
3. 每个下游 B 生成一条 `MessageRecord`：`from: 'peer'`、`to`: B 的成员名（成员尚未创建时 `task:<B.id>`）、`taskId: B.id`、body = 上游 id/title + 命令 + 退出码 + 证据尾部摘要（≤800 字符）+ 产物落盘路径（空则显式「无落盘产物」）。
4. 若 B 已存在未退役 binding → `sendMessage(B.memberId, body)` 实发（失败可观测，不静默）；否则该 body 在该成员创建时作为「上游交接」段注入其首条提示词。
5. 队长侧**不新增**任何转述消息；既有「成员 → 队长」回执照旧。

**流程 B · 停滞检测（事件为主，轮询兜底）**

1. 宿主订阅「成员调用了工具」的事件（首选 `tools/execute`，实测不过关则回退，见 AC-7），按成员更新内存中的 `lastProgressAt`（落盘以便面板重启后仍显示）。
2. `watcher.tick()`（1500ms）只做一边：`now - lastProgressAt > STALL_MS` 且任务在跑 → 标该成员 `stalled = true`，并写**一条** `ActivityEvent{kind:'tool'}`；同一 episode 不重复写，恢复产出后清除标记（再停滞重新计一条）。
3. 面板 2000ms 轮询快照，成员行按 `stalled` 渲染可区分告警（不自行做超时判定）。
4. 事件路径**不**直接产生告警 —— 告警只有 watcher 一个出口，从结构上排除「一次停滞两条告警」。

## 6. 优先级

| 项 | 优先级 | 说明 |
|---|---|---|
| AC-7 事件最小实验 | **P0（前置）** | 未证实事件可定位成员之前，停滞检测不得开工写实现 |
| 直通投递 AC-1~AC-6 | **P0** | 本期主收益，纯宿主链路 + 可单测 |
| 停滞检测 AC-8~AC-14 | **P0** | 「必做」的安全网；与直通投递无耦合，可并行 |
| AC-15 全量门禁 / AC-16 文档 | P0 | 收口条件 |

## 7. 验收条件（AC）

> 编号只在本夹内有效。每条都给出判据与可分辨性说明；命令一律实跑并贴输出。

### 直通投递

**AC-1 触发口径精确**：仅当 `verdict === 'done'` **且** `evidence.exitCode === 0` 时产生 peer 交接；`rework` / `failed` / `done` 但 `evidence` 缺失 / `exitCode !== 0` 一律不产生（仍保留既有 member→captain 回执）。
判据：四种输入各跑一次，`messages.filter(m => m.from === 'peer').length` 依次为 `1 / 0 / 0 / 0 / 0`。

**AC-2 去向与内容完整**：对每个 `dependsOn` 含 A 的下游任务 B 各产生一条消息，`from === 'peer'`、`to` = B 的成员名（成员未创建时 `task:<B.id>`）、`taskId === B.id`；body 必须同时含 ① A 的 `id` 与 `title` ② 门禁 `command` ③ 退出码 `0` ④ 证据尾部摘要（≤800 字符，超长截断并标注）⑤ 产物落盘路径（`GateEvidence.artifacts`，为空时显式写「无落盘产物」，不得静默省略）。
判据：单测逐项断言 body 命中这 5 项；断言 body 不含 `captain`；2 个下游任务时恰好 2 条（fanout 不漏不重）。

**AC-3 不经队长**：一次投递前后，同一 run 内 `from === 'captain'` 的消息条数**不变**（`applyReceipt` 既有的 member→captain 回执那条不算队长消息）。
判据：投递前计数 = 投递后计数，且本次新增消息全部 `from === 'peer'`。

**AC-4 真实到达下游成员（两条路径都必须覆盖）**：
(a) B 存在未退役 binding → 立即 `sendMessage(memberId, body)`；发送失败不得静默，须留可观测错误（`errors`/notice），且不阻塞解锁与后续派发。
(b) B 的成员尚未创建（常规路径：依赖未全 done 前 B 为 `blocked`，`src/host/plan/graph.ts` `readyTasks` 只在依赖全 `done` 后派发）→ 交接记录落账本，且 B 成员创建时把**同一 body** 作为「上游交接」段注入其首条提示词（`src/host/team/member-prompt.ts` `buildMemberPrompt`）。
判据：(a) 注入的 `SendPort` 收到与账本 body 逐字相同的文本；(b) `buildMemberPrompt` 输出含 A 的证据摘要，且既有提示词段落断言全绿。

**AC-5 幂等**：`(上游 A, 下游 B)` 至多一条 peer 交接；重复 `applyReceipt`（重放 / resume / 恢复后重跑）不新增；一个 A 对多个 B 时每个 B 各一条。
判据：连续调用两次 → peer 条数仍为 1；打乱恢复顺序后仍是 1。

**AC-6 不回归解锁与门禁链路**：done 后 `blocked → pending` 解锁、全终态 → `terminated`、回执文案与 `gateSummary` 行为不变；既有 dispatch/gate 单测全绿（r3 收口基线 164 例中相关部分不得改动预期）。

### 停滞检测

**AC-7 事件最小实验（前置门禁，未过不得写实现）**：实施第一步产出实测记录，证明至少一条宿主事件能按成员定位「实质产出」。候选：`tools/execute`（`waterfall`，`exec: ToolDispatchExecution`）、`tools/result`（`emit`，`exec: ToolExecution`）、`agent/status`（`emit`，`payload: { agent, status }`）。记录必须含：事件名、mode、订阅 API 形态与作用域、payload 实测打印（脱敏后原样贴）、**能否取到 memberId/agentId/sessionId** 的结论、**成员 session 的工具调用是否被覆盖**的结论。
判据：TECHNICAL 内有「已验证 / 未验证」两张清单且与实测一致；若全部事件都无法定位成员，必须写明降级方案（如 `agent/status` + 成员 session 映射）并保证 AC-9 仍可成立；QA 报告引用该记录。

**AC-8 事件为主、告警单出口**：事件订阅**只**更新 `lastProgressAt`（含落盘），绝不产生告警；停滞判定只在 `watcher.tick()`（1500ms）内发生一次；同一停滞 episode 恰好一条 `ActivityEvent{kind: 'tool'}`（复用既有枚举，**不新增 kind**），连续多个 tick 不重复；恢复产出后标记清除，再停滞重新计一条（累计 2 条）。
判据：驱动 tick ×3 → 该成员 `kind === 'tool'` 事件数 = 1；推进 now 越过阈值后再 tick ×2 → 仍为 1；报告恢复产出后再推进 → 变 2。

**AC-9 可分辨性对（假成员必告警 / 对照不告警，同一次测试内对照）**：
(a) 「宿主报 running、从不产生工具事件」的成员，`now` 越过 `STALL_MS` 后：快照该行 `stalled === true`，活动流出现一条停滞事件；
(b) 同窗口内持续上报工具事件的对照成员：`stalled === false`，无停滞事件；
判据：同一测试里两个成员并存断言（不允许分两次单独跑），失败信息能指出是哪一侧错了。

**AC-10 变异自检（删掉更新逻辑必须变红）**：QA 报告贴两段实跑输出 —— ① 把 `lastProgressAt` 更新逻辑禁用（注释 / 恒不更新）后 AC-9(a) 断言失败的原文；② 还原后通过的原文。
判据：两段同时存在、结论相反；只有②没有①视为未验证（「恒绿」不承载信息）。

**AC-11 刷新预算不破**：`WATCHER_INTERVAL_MS === 1500`、`PANEL_ACTIVE_MS === 2000` 值不变；本期不新增任何定时轮询（`grep -c "setInterval(" src/host` 与基线相同）；停滞态在 ≤5s 内被面板反映。
判据：常量断言 + grep 计数对照基线 + 面板探针计时（阈值同上限）。

**AC-12 不叠加告警 + 判定只在宿主一处**：同一成员行不得同时出现停滞告警与旧的心跳提示（`src/client/tabs/MembersTab.tsx:70` 的 `stale`/`data-member-stale-hint` 文案「心跳已超过 15 秒，宿主正在对账（成员进程可能已退出）」）；优先级固定为 **死亡/`interrupted` > 停滞 > 心跳提示**；client 不得自算停滞（不得出现新的 `now - last*At > X` 判定）。
判据：构造「停滞且超过 15s」的行 → `data-stalled="true"` 且该行无 `data-member-stale-hint`；`grep` 断言 MembersTab 内无新增时间比较判定，只读快照字段。

**AC-13 阈值单一定义 + 无状态副作用**：`STALL_MS` 只在 `src/host/config.ts` 定义一次（默认 `90_000`），watcher 引用该常量；停滞**不修改**任何 `task.status`（不写 `interrupted`/`failed`）、不触发 `resume`/`rework`。
判据：grep 单一定义；tick 前后 `state.plan.tasks` 深比较相等。

**AC-14 面板可读且可区分**：成员行出现停滞文案，措辞明确「活着但无实质产出」并含距上次产出的秒数；文案与 `interrupted` 的文案不相等；恢复后自动回正常态。
判据：结构断言 `data-stalled`、停滞文案含秒数、与 interrupted 文案字符串不相等；恢复后 `data-stalled="false"`。

### 交付

**AC-15 全量门禁 + 探针不回归**：`pnpm typecheck` 0 错；`pnpm test` 全绿且总数 **≥172**（基线 164，新增 ≥8 例）；`pnpm build` 双产物 mtime 晚于 `src/` 下最新文件；`node --input-type=module -e "await import('./lib/index.js')"` 与 `…lib/client.js` 均 exit 0；`npm pack --dry-run` 含 `lib/index.js`/`lib/client.js`/`cordis.patch.yml`；既有 `qa-reverify-probe` 9/9、`qa-collision-probe` 12/12（项数不减）；新增 peer 投递探针 ≥4 项、停滞探针 ≥4 项全 PASS。
判据：每条命令贴退出码与至少一行实跑输出。

**AC-16 文档交付**：本夹产出 `QA-REPORT.md`（AC-1~AC-15 判定表，每行贴实跑输出）与 `ACCEPTANCE.md`（明确结论、覆盖 AC-1~AC-15、已知限制如实写）。
判据：两文件存在且判定表条数 = 15（不含 AC-16 自身）。

## 8. 依赖与风险

| 项 | 说明 | 应对 |
|---|---|---|
| **宿主事件 payload 未实测（最高风险）** | `Event/listEvents` 只证明了名字/mode/签名；`tools/execute` 的 `exec: ToolDispatchExecution` 里有没有成员标识、订阅是否需要 scope、成员 session 的工具调用是否被覆盖，全部未验证（SUPER-AGENT-MAPPING §5.1） | AC-7 设为前置门禁：先做最小实验拿原始输出，失败则按 AC-7 写降级方案，禁止凭印象写死 |
| 刷新预算 | watcher 1500 + 面板 2000 ≤ 5000 是全量硬约束（AC-18 遗留） | AC-11；事件只做状态更新、告警只在 tick 内 |
| 双入口一致性（历史缺陷族） | 「工具能用、面板不能用」的根因是两条路径各写一套 | 停滞态只经既有 `GET /api/auto-team/snapshot` 输出；不新增路由/动作；client 只读字段 |
| 重复告警 | 事件订阅 + 轮询双路径最容易产生两条 | AC-8 结构上保证「告警只有一个出口」；AC-12 处理与旧心跳提示的叠加 |
| 下游成员尚未创建 | A 完成时 B 通常还是 blocked（无成员），「实况投递」不成立 | AC-4 明确双路径；账本记录 + 创建时注入，验收口径按此写 |
| 误报伤信任 | 把「安静」当「停滞」会让人不再看面板 | AC-9 对照对 + AC-13 无副作用；阈值进 openQuestions 由用户定 |

## 9. 里程碑建议

1. **M1 契约冻结（先做）**：AC-7 最小实验 → 事件可用性结论 + `lastProgressAt` 更新点、`MemberView` 新增字段、peer body 格式三处契约写进 TECHNICAL。
2. **M2 直通投递**：AC-1~AC-6（`applyReceipt` 内的交接生成 + 账本去重 + `buildMemberPrompt` 注入 + 单测）。
3. **M3 停滞检测**：AC-8~AC-14（订阅 / 常量 / tick 判定 / 快照字段 / 面板行 / 单测对照对）。
4. **M4 收口**：探针（peer ≥4、stall ≥4）、AC-15 全量门禁、AC-16 文档；命中变异自检 AC-10。

## 10. 工程约束（原文口径，不得改写）

- **分支与状态（原文）**：「沿用当前分支 feat/auto-team-plugin，仓库在 HEAD 2aff075，工作区干净。」→ 不切分支、不新建分支，在当前分支原地实现。开工前先 `git status --porcelain --untracked-files=all` 复核工作区仍干净（本项目有过「上报已提交、实测未提交」的记录，以命令输出为准）。
- **提交口径**：本轮**未**下发 commit / tag 指令。若收口需要提交，按团队既有惯例一次做到位：功能 + 单测 + `lib/` 双产物 + 本夹文档同一笔，`lib/` 必须入库（`.gitignore` 不忽略 `lib/`）。
- **硬约束（原文口径）**：
  - 「面板 1500ms 轮询 + 2000ms 刷新的既有预算不能被打破；事件订阅与轮询必须定『事件为主、轮询兜底』，禁止叠加导致一次停滞两条告警。」
  - 「事件路径必须复用既有 `bridge.act` / `PanelAction` 语义，禁止另写一套分支。」
  - 「宿主事件的名字、mode、签名已用 `cordis_inspect_query` 实测取得；但每个事件的 payload 实际形状与订阅方式尚未实测，落地前必须先做最小实验，不许凭印象写死。」
- **.gitignore 复核（发阶段动作为 dev 阶段 S0 任务）**：提交会 stage 整棵树，先审一遍本项目栈的忽略面 —— 必须继续忽略 `node_modules/`、`*.tsbuildinfo`、`coverage/`、`dist/`、`.auto-team/`（运行时状态与门禁产物）、`logs/teamflow/`、`*.tgz`、`pnpm-debug.log*`、`.DS_Store`；补齐可能出现的 IDE 目录（`.vscode/`、`.idea/`）与本地 env（`.env`、`.env.*`，若后续引入）；**明确不得**连带忽略 `lib/`、`cordis.patch.yml`、`docs/`。
- **边界**：只写 `docs/teamflow/` 与 `logs/teamflow/`；不改 `AGENTS.md` 托管区以外的内容；不新增根目录日志文件。

## 11. 假设与待澄清

- **A1（事实待确认）下游成员此刻通常还不存在**：依据 `src/host/plan/graph.ts` 的 `readyTasks`（依赖全部 `done` 才派发）与 `applyReceipt` 的 `blocked → pending`，A 完成时 B 无成员。故本 PRD 把「直投」定义为「账本 peer 记录 + B 创建时注入其上下文」，并在 B 已存在时实发。若你要的是「B 常驻等待、实况接收」，需改派发时序（本期非目标）。→ 若你选后者，AC-4 与范围都要重写。
- **A2（事实/前置）事件可定位成员与否未定**：`tools/execute` 的 payload 形状与订阅作用域未实测，决定 AC-7 走直连还是映射成员 session；阈值与验收口径不变。
- **A3（口味）停滞阈值**：90s / 60s / 120s 都能自洽；影响误报率与发现速度，默认 90s。
- **A4（口味）旧的 15s 心跳提示去留**：默认删除该客户端启发式（它会为任何 15s 没发消息的正常成员误报），由宿主停滞态统一表达；备选是保留但改由 `lastProgressAt` 驱动且不与停滞叠加。
- **A5（口味）交接摘要长度**：默认 800 字符尾部摘要 + 产物路径；备选是只给路径不给正文（更省 token，但成员要多一次读盘）。

## 12. 术语

- **peer 交接**：`from: 'peer'` 的 `MessageRecord`，内容为上游任务的门禁证据与产物路径，不经队长。
- **实质产出**：成员发起的工具执行（宿主事件），是「在动」的唯一可信信号；消息、心跳、状态翻转都不算。
- **停滞（stalled）**：成员存活（宿主报 running/provisioning）且任务在跑，但距上次实质产出超过 `STALL_MS`。与 `interrupted`（已死/失联）是两回事，面板文案必须能区分。
