# r56 QA 报告：复用成员的自助回执回归

- 需求：r56 复用成员自助回执
- 本任务：t2（回归测试 + 本报告）；前置 t1 已验收 pass
- 日期：2026-11-18
- 结论：新增 `test/r56-member-receipt-reuse.test.ts` 5 用例全绿；全量 `pnpm typecheck && pnpm test && pnpm build` 退出码 0（见 §2）。突变反证见 §4：**「拆掉按 taskId 命中那行 → ① 红」这个直觉判据在本次种子链上不成立**（① 仍绿），已换成承重用例 ⑤；回滚到 r30 旧实现时 ①②⑤ 三红。另记 1 个 P3 文案自指矛盾（§6）。

## 1. 本次改了什么

修复在 t1（已验收），本次只加回归与文档，不改 `src/`：

| 位置 | 内容 |
|---|---|
| `src/host/tools.ts:244-259` | `memberIdentityOf(deps, meta, taskId?)`：请求带 taskId 时先精确命中 `memberId===agentId && retired!==true && binding.taskId===taskId`，命中不到才退化到「该成员最新未退休绑定」 |
| `src/host/tools.ts:286-294` | `latestBindingFor` 统一选择规则：同一 run 内取 `spawnedAt` 最大的未退休绑定（含 taskId 过滤） |
| `src/host/tools.ts:317-334` | `memberTaskIdsOf`：FORBIDDEN 文案用的「名下任务列表」（绑定归属 + `task.memberId`，去重保序，排除退休绑定） |
| `src/host/tools.ts:945-955` | FORBIDDEN 文案改为「本次请求的 taskId 为「…」，你名下任务为 …；… 不是你被派发的任务」；比较仍在 `bridge.act` 之前，不跑门禁、不碰账本 |
| `test/r56-member-receipt-reuse.test.ts` | 本次新增：假 ctx（`registerTools`）+ 真 `RunsStore`/真 `createBridge`/真 `applyReceipt`/真门禁执行 |

## 2. 验收命令与证据

```bash
node --test test/r56-member-receipt-reuse.test.ts   # 5/5 绿，exit 0，~215ms
pnpm typecheck && pnpm test && pnpm build           # exit 0：typecheck 0；tests 1430 / pass 1430 / fail 0；build 双产物
node --test test/r30-member-self-service.test.ts    # 14 pass / 0 fail（收口前由 lead 点名复跑）
```

- 目标用例 5/5 绿；全量门禁收口时 **exit 0（1430/1430）**，`pnpm build` 双产物成功。
- 目标用例全部走真实装配：真 `RunsStore` / 真 `createBridge` / 生产同一 `applyReceipt` 状态机；门禁在临时目录真执行 `printf r56-t1-gate` / `printf r56-t2-gate`，`artifacts/*.log` 真落盘。只把 `spawn` 换成固定桩（本用例不测派发）。
- 过程里三次红点都不是本卡交付：本文件一处类型错误（`MemberIdentityView` 无 `memberId`，已修）、r30 ②⑤ 与 r54 用例的类型错误（共享工作树上 t3/r54 的并发编辑，落地后消失）。r30 ② 的白名单按 lead 授权由我如实扩到 6 键，并补 `assert.equal(status.taskId, 't1')`（不只加键名）；r30 ⑤ 的「NOT_ENABLED 优先」保持原样，未改动。

## 3. AC 对照（①–⑤）

| AC | 用例 | 断言（会红的点） |
|---|---|---|
| ① 复用链 t1(done) → t2(running)：receipt(taskId=t2) 成功、真跑门禁、证据落在 t2 | `r56 ① 复用成员：receipt(taskId=t2) 成功，门禁真跑、证据落在 t2` | `ok=true`、`status=done`、`evidence.command=printf r56-t2-gate`、`exitCode=0`、`artifactst2.log` 存在、盘面 `t2.evidence.taskId='t2'`；`t1.log` 不存在；t1 仍 done。回滚到 r30 旧实现（首条绑定）即 FORBIDDEN → 红 |
| ② 不传 taskId 时与今天一致（仍取最新绑定） | `r56 ② 不传 taskId：仍识别到最新绑定，status 成员视图显示 t2` | `memberIdentityOf(deps, MEMBER_META)` 命中 `t2`（不是 t1）；`auto_team_status` 回 `view=member` 且 `task.id='t2'` |
| ③ 别人任务 taskId 仍 FORBIDDEN、零门禁、零写入 | `r56 ③ 别人名下的 taskId：仍 FORBIDDEN，零门禁、零写入、零投递` | `ok=false`、`code=FORBIDDEN`；文案含「本次请求的 taskId 为「t3」」「你名下任务为 t1、t2」「t3 不是你被派发的任务」；**整份 RunState JSON 前后逐字相等**；无 `artifacts/t3.log`；零投递 |
| ④ retired 绑定不得提供身份 | `r56 ④ retired 绑定：唯一绑定已退休 → 未启用；新旧并存时请求旧任务也不得命中退休身份` | (a) 唯一绑定 `retired=true`：带/不带 taskId 的 `memberIdentityOf` 均 `null`，receipt 回 `NOT_ENABLED` 原文案，零门禁。(b) 旧绑定退休 + 新绑定活着：请求旧任务只能退化到 t2（`binding.taskId='t2'`，绝不是退休的 t1）→ FORBIDDEN，t1 状态不变、无 `t1.log` |
| ⑤ 变异判据（承重断言） | `r56 ⑤ 变异判据：请求「较早那张仍在跑」的卡也命中自己（拆掉精确命中则本用例红）` | 同一成员两张都在跑、请求较早的 t0：精确命中 → 成功且证据落 t0；再提交最新的 t1 仍成功。拆掉精确命中该用例即红（§4 M-A 实测） |

## 4. 突变反证（手工验，命令与结果）

做法：临时改 `src/host/tools.ts` → 跑 `node --test test/r56-member-receipt-reuse.test.ts` → `cp` 备份恢复。恢复后 `git diff --stat -- src/host/tools.ts` 与突变前一致（80 insertions / 13 deletions），目标用例 5/5。

| 变异 | 改法 | 结果 |
|---|---|---|
| M-A「拆掉按 taskId 命中那行」 | `memberIdentityOf` 里 `const exact = wanted === undefined ? null : memberIdentityAcrossRuns(deps, agentId, wanted)` 改成 `const exact = null` | **① 仍绿**、⑤ 红（pass 4 / fail 1）。原因：① 的种子链里 t2 就是最新绑定，拆掉精确命中后退化分支照样取到 t2 —— **任务卡里「拆掉这行 → ① 红」的判据不成立** |
| M-B「回滚到 r30 旧实现」 | 同上再加 `latestBindingFor` 由「取最新」改回「取首条」（`if (found === undefined) found = binding`） | **① 红、② 红、⑤ 红**（pass 2 / fail 3）：旧实现把身份解析成首条 t1 → receipt(t2) FORBIDDEN，status 也回 t1。这正是现场 bug，① 锁得住 |

结论：锁住现场 bug 的是 ①（对 r30 回滚敏感）；锁住「按请求 taskId 命中」这一行的是 ⑤（M-A 唯一杀手）。两起分工明确，已写进测试文件头注释，避免下一轮再按错误判据自证。

## 5. 四次咬人（同族：复用成员路径的身份/上下文漂移）

| # | 时间/迭代 | 症状 | 证据 |
|---|---|---|---|
| 1 | 2026-11-13 r30 成员自助上线 | 身份反查用 `state.bindings.find(...)` 取**首条**；当时只覆盖「一个成员一条绑定」，复用第二张卡的情况没进用例 | `docs/teamflow/2026-11-13-r30-member-self-service/QA-REPORT.md:28-38`（覆盖清单里没有复用多绑定） |
| 2 | 2026-11-13 r31 D1 | 复用分支与 spawn 分支漂移：复用成员路径不写软提示，`reuseMessages=1 toUser=0` | `docs/teamflow/2026-11-13-r31-read-discipline/QA-REPORT.md:60-67` |
| 3 | 2026-11-17 r47 | 复用成员在面板丢身份：`memberOwnsTask` 只认单值 `taskId`，旧卡跳不动 | `docs/teamflow/2026-11-17-r47-jump-identity/QA-REPORT.md:16-17`（形态②「成员复用」） |
| 4 | 2026-11-18 r56 本次 | receipt/status 仍被当成首张卡：拿第二张卡后回执 FORBIDDEN、状态永远显示 t1 | 本次 t1 修 `src/host/tools.ts:244-259`；本回归 ①④ 锁边界、⑤ 锁精确命中 |

共同根因不是某一处 bug，而是**「一个成员只有一条绑定」的隐含假设**反复从不同入口（回执、提示词、面板跳转、状态）漏出来。本次修法与防护：所有按成员反查身份的入口都必须显式带 taskId 或明确退化规则；FORBIDDEN 文案直接给出「本次 taskId + 名下任务列表」，让下一次误判一眼可见。

## 6. 缺陷与阻塞

### 6.1 阻塞项（历史记录：已在收口前消除，非本卡范围）

**(a) `test/r30-member-self-service.test.ts` ②「status 成员视图字段白名单」红**
- 症状：`deepStrictEqual` 实际键 `['notice','ok','runId','task','taskId','view']`，期望无 `taskId`（`test/r30-member-self-service.test.ts:265-275` 附近）。
- 根因：`src/host/tools.ts:863-866` 的成员视图新增了顶层 `taskId: member.task.id`（t3「成员自助锁 runId」的改动，HEAD 无此字段）。
- 复验：`node --test test/r30-member-self-service.test.ts`（12 pass / 2 fail）。
- 建议修改（t3 作者）：在 r30 ② 的白名单里显式加入 `taskId` 并断言 `=== 't1'`；白名单的意义是「不泄露 members/plan」，加字段本身是有意的，测试该跟着改。

**(b) 同一文件 ⑤「开关关闭且非成员：9 个工具都逐字返回未启用原文案」红**
- 症状：`auto_team_review({})` 实际回 `{ok:false,error:'taskId 不能为空'}`，期望 NOT_ENABLED 原文案。
- 根因：`src/host/tools.ts:1069-1071` 把 `taskId === ''` 校验提到了开关/成员准入之前（HEAD 的顺序是先 944-946 判 NOT_ENABLED 再校验 taskId）。
- 复验：`node --test --test-name-pattern='开关关闭且非成员' test/r30-member-self-service.test.ts`。
- 建议修改（t3 作者）：把空 taskId 校验挪回准入之后（与 receipt 一致），或 r30 ⑤ 对 review 改成断言「未启用优先」。前者更能保持「开关关闭一律旧文案」的不变量。

**(c) `test/r54-library-drawer-jump.test.ts` 两处类型错误（r54 并发新增）**
- 症状：`(429,31)` / `(436,20)` TS2345 `{ runDetail: RunDetailView }` 不能赋给 `RunDetailSource`。
- 根因：r54 新增用例与 `src/client` 的 `RunDetailSource` 形状未对齐（进行中的编辑）。
- 复验：`pnpm typecheck`。

**处置结果**：(a) 由我在 lead 授权下把 r30 ② 白名单扩到 6 键并断言 `status.taskId === 't1'`（注释写明「r56 为跨 run 同名 taskId 归属确认而加，不是泄露面」），⑤ 未动；(b) t3 把空 taskId 校验挪回准入之后（`src/host/tools.ts:1068-1072` 先 `NOT_ENABLED`）；(c) r54 落地后类型错误消失。收口门禁全绿，以上三条保留为过程记录。

### 6.2 非阻断缺陷（P3，本次不修）

**症状**：成员有「旧卡已退休、新卡在跑」时，请求旧卡的 taskId，FORBIDDEN 文案自指矛盾：`本次请求的 taskId 为「t1」，你名下任务为 t2、t1；t1 不是你被派发的任务`。

**根因**：`memberTaskIdsOf`（`src/host/tools.ts:317-334`）排除的是 `binding.retired === true` 的绑定，但补扫 `plan.tasks` 的 `task.memberId === memberId` 时没有同样的退休过滤；任务卡在「绑定已退休、任务尚未重派」的窗口里时会被列进「名下任务」。

**复验命令**：`node --test test/r56-member-receipt-reuse.test.ts` 的 ④(b) 现场（seed：t1 绑定 `retired=true`、t2 绑定活着，调 `auto_team_receipt(taskId='t1')`），观察 `code=FORBIDDEN` 的 `error` 文本。

**建议修改**：`memberTaskIdsOf` 的任务补扫只在存在对应未退休绑定时列入，或对列入项标注「（已退休）」；不影响授权判定（拒绝仍然正确），只影响可读性。

## 7. 未验证项

1. **真机第二宿主全链路未跑**：本文件用真 store/bridge/applyReceipt/真门禁，但 `spawn` 是固定桩，没有在真实宿主里跑「派发 → t1 done → 复用同一成员 → t2 回执」的成员会话链路；建议按 `docs/teamflow/architecture/REAL-HOST-VERIFY.md` 在第二宿主复验一次。
2. **面板 UI 未截图**：② 只断言工具层 `auto_team_status` 回 t2；右栏任务卡/成员行是否同步显示最新绑定未做真机截图验证（r47 已覆盖跳转侧，但本轮的成员自助视图未覆盖）。
3. **突变未进 CI**：M-A/M-B 是手工改源→跑→恢复，没有自动化变异门禁；若后续要防「判据又写错」，可考虑把 ⑤ 的承重场景固化为常规用例（已做）而不是自动变异。
