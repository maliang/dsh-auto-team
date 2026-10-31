<!-- meta: summary="把成员名撞名的兜底从「报错停派」改成「确定性追加 -2/-3 序号并继续派发」，附一条面板 notice，同步更新单测与 qa-collision-probe，重跑 typecheck/test/build/双产物 import/npm pack 后出新 ACCEPTANCE" -->
基线依赖：docs/teamflow/20261031-r2（R2-1 修复轮的成员名契约、派发唯一性断言与探针基线；其行为不得回归）
取代：docs/teamflow/20261031-r2#AC-4：撞名时不再「不 spawn + 写 `MEMBER_NAME_COLLISION` + 任务留 `pending`」，改为按 `-2`/`-3` 确定性序号消歧并继续派发该任务，另用一条 notice 在面板说明已消歧

# 撞名兜底改确定性序号消歧（R3）

## 1. 背景与目标

**现状（本轮起点）**：R2-1 已经把「成员名塌缩」这个根因修掉——名字 = `可读段(≤41) + 6 位身份短哈希`，总长恰 48，哈希取**原始** `roleId\0taskId`，截断只裁可读段（`src/host/team/dispatch.ts:101`、`:109`、`:157`）。配套在派发循环前算一次全计划冲突集（`dispatch.ts:180` `memberNameCollisions`、`:264-268`），命中就在步 d **停派**：`push { code:'MEMBER_NAME_COLLISION' }` + `continue`，不 spawn、不写 binding、不改 status（`dispatch.ts:342-355`）。单测把这个语义钉死（`test/dispatch.test.ts:508`、`:539`），类型注释也写着「本次不派发」（`src/shared/types.ts:319-327`）。

**为什么还要改**：这条兜底对**用户**来说仍然是「任务不动」。撞名的错误只出现在 `ActResult.notices` 的一行里（`src/host/bridge.ts:460-468`），面板上看到的是「一个成员在跑、另一个任务永远 pending」，与 R2-1 要消除的症状在产品层完全一致——只是原因从「宿主静默拒绝」换成了「我们主动拒绝」。而撞名在真实链路里并非不可能：注入/自定义取名端口、宿主里残留的同名成员、以及多会话并发占名，都会让编码后的名字与既有占用相撞。产品语义应当是「**能派就派，名字被占就换一个名字继续派**」。

**目标**
- G1 撞名不再阻断派发：按确定性序号（`-2`、`-3`…）消歧后继续派发，任务不得停在 `pending`。
- G2 消歧对用户可见且只占用一条提示：面板 notice 说清「哪个任务、原名被占、改成了什么名」。
- G3 消歧不破坏既有契约：名字仍唯一、仍 ≤48 且符合宿主字符集、身份哈希不被裁掉；同一任务无论派发几次都叫同一个名字（恢复不翻倍、消息不错发）。
- G4 证据同步更新：单测与 `qa-collision-probe` 按新契约改写并**加强**，全量门禁重跑后出新 `ACCEPTANCE`。

## 2. 用户故事

| # | 故事 | 可测判据 | AC |
|---|---|---|---|
| US-1 | 作为队长，我同时派两个中文任务给同一个角色；即使它们的编码名撞在一起，两个也都应该真的派出成员，而不是一个跑一个不动 | 两个任务都进 `started`，binding 名字分别是 `base` 与 `base-2`，任务状态都成 `running` | AC-1、AC-2 |
| US-2 | 作为队长，我要在面板上看到一句人话解释这个改名，并且只看到一条，不是每次刷新都来一条 | 一次消歧恰好 1 条 notice，含 taskId、原候选名、最终名；同一任务重试后 notice 数不增 | AC-5 |
| US-3 | 作为队长，我恢复一个跑了一半的计划；已经带序号的任务不该换名字，成员数也不该变多 | 连续两次 dispatch/resume 后名字逐字相同、`bindings.length` 不增 | AC-3、AC-10 |
| US-4 | 作为 QA，我要能证明「新契约生效」而不是「把旧断言删掉」：探针项数不减、单测数不减，且断言能把实现改回旧版后变红 | 探针 ≥7 项全绿且 exit 0；`pnpm test` ≥155 且全绿 | AC-7、AC-8、AC-9 |
| US-5 | 作为验收人，我要一份覆盖 AC-1~AC-10 的新验收报告，每条判定都贴得出命令与实跑输出 | 本夹有 `QA-REPORT.md` 与新 `ACCEPTANCE.md`，无「待补」占位 | AC-11 |

## 3. 范围与非目标

**范围内**：`dispatchReady` 的撞名分支语义（停派 → 消歧派发）；确定性序号分配；消歧 notice；`MEMBER_NAME_COLLISION` 的降级为兜底；相关单测与 `qa-collision-probe` 用例；全量门禁与文档收口。

**非目标（本轮不做）**：
- 不改成员名算法的**正常路径**（不撞名时名字与 R2 逐字一致，哈希算法、`NAME_BUDGET` 都不动）。
- 不改用户可见的名字配置能力（不做「名字前缀/模板」设置项）。
- 不在 `spawn` 返回「宿主重名/非法名」时做并发竞态重试：本轮只保证**派发前**基于可见占用集合（本计划任务名 ∪ 未退役 binding 名 ∪ 宿主现存成员名）的消歧；spawn 时刻被外部抢名的竞态留给后续轮次，且必须落 `errors` 而非静默。
- 不重构面板 notice 通道（继续复用 `ActResult.notices`）。

## 4. 反面目标 / anti-goals

1. **「消歧成功，任务还是不动」**：`-2` 直接拼在已经 48 字的名字尾部（或拼出非法字符），宿主以「名字超长/非法」拒绝，任务照样 pending——错误从「重名」换成「名字不合法」，用户观察到的现象一模一样。
2. **「自己占自己也编号」**：对同一任务连点两次派发或恢复，名字一路 `-2 → -3 → -4`；面板上同一任务每轮换名字，恢复后成员翻倍，续跑消息发到旧名字上。
3. **「序号由谁先被调度决定」**：同一计划恢复一次后，`-2` 落到另一个任务头上，两个成员互换身份——谁叫什么取决于调度顺序，恢复越多次越乱。
4. **「面板被消歧提示刷屏」**：每次 watcher tick 都为同一任务追加一条「名字已消歧」，一晚几百条，真正的成员创建/失败信息被埋掉。
5. **「notice 说了等于没说」**：只写「名字已消歧」而不给原名、新名、taskId，用户看到 `dev-4k2m9a-2` 无法判断它对应哪个任务、原来的名字被谁占了。

## 5. 交互流程摘要（一次 dispatch tick）

1. 计算 ready 集合（含依赖已过门禁的 `interrupted` 恢复项），并算空闲并发位。
2. **一次性**完成命名分配：按稳定的计划顺序处理任务，占用集合 = 本计划所有任务的「本名」 ∪ 未退役 binding 名（他人） ∪ 宿主现存成员名；某任务已有未退役 binding 时**沿用**其名字（不改名），否则取 `base`、`base-2`、`base-3`… 中第一个未被占用的候选。
3. 逐任务：角色/模型预校验 → 建 `prompt` → `spawn({ name })` → 写 binding（`name` 为最终名）→ 任务置 `running` → 写派发消息。
4. 本次 tick 里每个「最终名 ≠ 本名」的任务，产出一条 notice：`任务「<title>」(id) 的成员名 <base> 已被占用，已改用 <final> 派发`。没有消歧则一条都不产。
5. 全程不因为撞名 `continue` 掉派发；只有当序号候选穷尽到上限仍未找到可用名时，才写 `MEMBER_NAME_COLLISION`（可观测的兜底，绝不静默 pending）。

## 6. 验收标准（本夹编号，自 AC-1 起）

| AC | 内容 | 判据 |
|---|---|---|
| AC-1 | **撞名即消歧派发（核心）**：编码名与本计划其他任务名 / 未退役 binding 名 / 宿主现存成员名任一冲突时，用 `-2`、`-3`… 首个可用序号命名并**继续派发**：该 taskId 进 `started`、任务置 `running`、写 binding（`name` 带序号）、`errors` 不含 `MEMBER_NAME_COLLISION`。 | 单测（恒同名桩 + 与未退役 binding 撞名两例）断言 `started`、`bindings[].name`、任务状态；探针 C6、C7 绿 |
| AC-2 | **序号不挤掉身份、不越上限**：消歧后名字总长 ≤48 且满足 `HOST_MEMBER_NAME`（lower-kebab）；6 位身份哈希逐字保留（同一 `(roleId,id)` 哈希段恒等），只允许压缩可读段。 | 单测断言 `length<=48`、字符集正则、消歧前后哈希段相等（`base.endsWith(hash)` 与 `final.includes(hash)`） |
| AC-3 | **确定性与不改自身名**：① 同一 `(计划顺序, 占用集合)` 重复调用 → 名字逐字相同；② 同一任务第二次派发（成员已死、binding 退役后重建）沿用**同一个**带序号名，序号不递增；③ 恢复两次成员数不增、名字恒等。 | 单测：连跑两次 `dispatchReady`/`resumeRun` 后名字数组深度相等、`bindings.length` 不增；断言 `-2` 不变成 `-3` |
| AC-4 | **不抢他人本名**：若任务 A 的 `-2` 候选恰好等于任务 B 的**本名**，必须跳过该候选，取 `-3`（或 B 改号），最终全部任务名两两唯一。 | 单测构造该形态，断言 `new Set(names).size === tasks.length` 且 B 未被迫换名（B 保留本名） |
| AC-5 | **一条 notice 说清消歧**：每次消歧产生且仅产生 1 条 notice，含 taskId、原候选名、最终名；同一任务重试（沿用 binding 名）不再产生新 notice；同一 tick 内多个任务消歧各一条、不合并丢字段。 | 单测断言 `notices.length`、三条信息都在文本里；重复 dispatch 后 `notices.length` 不变 |
| AC-6 | **无静默滞留（穷尽性）**：一次 dispatch 结束后，每个 ready 任务必落在 `started` / `skipped` / `errors` 三集合的并集里；撞名路径不得产生「既不 spawn 也无任何输出」的 `pending`。 | 单测遍历断言并集覆盖全部 ready；只有序号空间耗尽才允许出现 `MEMBER_NAME_COLLISION` |
| AC-7 | **单测按新契约改写并加强**：`test/dispatch.test.ts:508`（恒同名桩）与 `:539`（与未退役 binding 同名）两条旧断言改为「消歧后派发」语义；新增 ≥4 例：同角色两个中文 id、仅大小写/分隔符差异、与未退役 binding 撞名、连续消歧到 `-3`、48 字符边界。`pnpm test` 全绿且用例总数 ≥155。 | `pnpm test` 输出 `# pass` 计数 + 新增用例名 |
| AC-8 | **qa-collision-probe 更新且不弱化**：保留 C1~C5 语义（C1 拉丁对照；C2 中文 id 不同名；C3 大小写/分隔符差异；C4 两个中文任务都真派出；C5 不塌缩成角色名）；新增 C6（恒同名桩 → `base` 与 `base-2` 都派出、`errors` 空、notice 一条）、C7（与未退役 binding 撞名 → 新任务以 `-2` 派发）；项数 ≥7，输出 PASS，exit 0。 | `node logs/teamflow/<runId>/scripts/qa-collision-probe.mjs` 输出与退出码 |
| AC-9 | **全量门禁**：`pnpm typecheck` 0 错；`pnpm test` 全绿；`pnpm build` 生成 `lib/index.js` + `lib/client.js` 且 mtime 晚于 `src` 最新 mtime；两产物 `node --input-type=module -e "await import('./lib/index.js')"` / `./lib/client.js` exit 0；`npm pack --dry-run` 含 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`。 | 5 条命令原文 + 输出尾部贴进 `QA-REPORT.md` 判定表 |
| AC-10 | **不回归 R2 契约**：不同 `(roleId,id)` 名字两两唯一；纯中文 id 不塌缩成角色名（`dev/登录流程 ≠ dev`）；恢复幂等（连续两次 resume 成员数相等）；`qa-reverify-probe.mjs` **9/9 项数不变**。 | reverify 探针输出；单测唯一性断言仍在且绿 |
| AC-11 | **交付文档**：本夹产出 `QA-REPORT.md`（判定表覆盖 AC-1~AC-10，每条命令 + ≥1 行实跑输出）与新 `ACCEPTANCE.md`（明确「可验收 / 不可验收」结论 + 逐条覆盖 AC-1~AC-10），无「待补」占位。 | 两文件存在；AC 覆盖数 = 10 |

## 7. 优先级

- **P0**：AC-1、AC-2、AC-3、AC-4、AC-6、AC-9、AC-10（消歧本体 + 不换名 + 不抢名 + 不滞留 + 门禁 + 不回归）
- **P1**：AC-5、AC-7、AC-8（可解释性 + 证据更新）
- **P2**：AC-11（文档收口，可与 P0/P1 同轮完成）

## 8. 依赖与风险

| 项 | 说明 |
|---|---|
| 依赖 R2 契约 | 名字形态、`NAME_BUDGET=41`、哈希输入、binding 结构、恢复按 `binding.taskId` 绑定——本轮只用不破 |
| 风险：序号破坏 48 上限 | 消歧必须挤占可读段而非尾部硬拼；AC-2 是硬门禁（见反面目标 1） |
| 风险：名字随占用集合漂移 | 分配必须一次性、按稳定顺序算完（与 R2 的「循环前算完」同一理由，`dispatch.ts:258-268`）；AC-3/AC-4 兜底 |
| 风险：notice 与 errors 双报 | 消歧成功后同一任务不得再出现 `MEMBER_NAME_COLLISION`，否则用户看到「成功又失败」；AC-1 的 `errors` 断言 |
| 风险：探针假绿 | 只把旧断言删除/改宽松也能「全绿」；AC-8 要求项数 ≥7 且新旧语义都在 |

## 9. 工程约束

- **raw requirement 中的动作（逐字保留）**：「当编码后仍与已有成员或未退役 binding 撞名时，自动追加 -2、-3 这类序号继续派发该任务，任务不得留在 pending，同时用一条 notice 在面板说明已消歧；同步更新单测与 qa-collision-probe 用例，并重跑 typecheck、test、build、双产物 import、npm pack 自检后出新 ACCEPTANCE。」
- **分支与提交（沿用基线依赖既定做法）**：在 `feat/auto-team-plugin` 上**原地**改，不新建分支、不开 PR；`lib/` 双产物随源码一并入库；收口时**单笔提交**（功能 + 测试 + 探针 + 本夹文档一并在内），提交信息点名本轮主题（撞名改序号消歧）。
- **现有未提交改动**：工作树仅 `?? docs/teamflow/20261031-r3-collision-name-suffix/`（本夹），随收口提交一并纳入；**不得**清理、回滚或提交 `docs/teamflow/20261031-r2/` 与其它历史任务夹的既有内容。
- **`.gitignore` 复核（dev 阶段动作）**：闭合前核对忽略清单覆盖本栈噪声并明确保留 `lib/`——当前已覆盖 `logs/teamflow/`、`node_modules/`、`dist/`、`coverage/`、`*.tsbuildinfo`、`.DS_Store`、`.auto-team/`、`*.tgz`、`pnpm-debug.log*`，且注释明确**不忽略 `lib/`**；只在发现缺项时追加（例如本轮若引入新的临时构建目录），**不改动「`lib/` 必须入库」这条语义**。
- **文档边界**：本轮所有产出只写 `docs/teamflow/20261031-r3-collision-name-suffix/`；临时探针/检查脚本放 `logs/teamflow/<runId>/scripts/`（run 结束由 host 归档），不在项目根散布日志，不改 `AGENTS.md`。

## 10. 假设与待澄清

- **序号位置**：假设序号码追加在名字**末尾**（`dev-4k2m9a-2`），而不是插在可读段与哈希之间（`dev-2-4k2m9a`）。理由：末尾追加最易识别「这是消歧结果」，且不影响按哈希段检索成员名。若用户偏好另一种位置，改的是名字形态与 AC-2 的样例，不影响其余契约。
- **序号上限与耗尽行为**：需求只说「追加 -2、-3 这类序号」，未说上限。假设上限 `-99`，穷尽后仍写 `MEMBER_NAME_COLLISION` 进 `errors`（可观测、非静默）。若用户要求「永远不停派」，则需另外定义名字空间扩展方式（如改哈希长度），代价是名字形态变更。
- **占用集合是否含「无 binding 的宿主成员名」**：需求写的是「已有成员」，而现有实现只查本计划任务名 ∪ 未退役 binding 名（`dispatch.ts:264-268`）。假设**包含**宿主 `listMembers()` 返回的现存成员名（宁可多跳一个序号，也不要 spawn 时被宿主拒），代价是获取成员名单失败时需保守处理。
- **notice 粒度**：假设「每条任务首次消歧各一条、重试不重复」，而不是每次 dispatch 汇总成一条。若用户更想看「本轮共消歧 N 个」的汇总式，改为 tick 级合并即可，字段不变。
- 无其他未决事实项（本仓现状、48 上限、哈希算法、探针路径均已实读确认）。

## 11. 里程碑建议

1. **M1 消歧算法与单测**：一次性命名分配（稳定顺序 + 序号候选 + 占用集合）、`-2/-3` 与 48 上限压缩；改写 `test/dispatch.test.ts:508`/`:539` + 新增 ≥4 例（AC-1/2/3/4/7 的一半）。
2. **M2 notice 与兜底**：`DispatchResult` 带出消歧记录 → bridge 产出一条 notice；`MEMBER_NAME_COLLISION` 降为序号耗尽兜底（AC-1 的 errors 断言、AC-5、AC-6）。
3. **M3 探针更新**：复制归档的 `qa-collision-probe.mjs`，保留 C1~C5、新增 C6/C7（AC-8）；顺带跑 `qa-reverify-probe.mjs` 确认 9/9 项数不变（AC-10）。
4. **M4 全量门禁与构建入库**：typecheck / test / build / 双产物 import / npm pack（AC-9），`lib/` 重新入库。
5. **M5 文档与提交**：`QA-REPORT.md` + 新 `ACCEPTANCE.md`（AC-11），`.gitignore` 复核，单笔提交。
