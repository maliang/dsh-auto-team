# r30 成员自助（成员自查 + 提交自己任务回执）QA 报告

- 任务夹：`docs/teamflow/2026-11-13-r30-member-self-service/`
- 任务：t2（回归与文档），前置 t1（成员身份解析 + 只读视图 + 只允许提交自己任务的回执，宿主侧）
- 日期：2026-11-13
- 环境：macOS，node v26.11.1，pnpm 10.34.7，仓库 HEAD `cfc9c51`（t1 的 `src/host/tools.ts` 改动未提交，工作区直测）
- 结论：**门禁全绿**（typecheck / 单测 / build，退出码 0）；既定行为均有用例覆盖，关键断言做过突变反证；无阻断缺陷。边界已定：**成员自助也受开关约束**——run 所属队长会话的开关关闭时，`auto_team_status` 与 `auto_team_receipt` 对成员**同态**回 tools.ts 的「未启用」原文案（不再一个放行、一个被桥拦成另一句），并有专门用例守卫。**但真机 profile 仍是 t1 之前的旧构建**，成员自助在真实会话里尚未生效（见 §5.2），需重新安装。

## 1. 验收判定（实际执行）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | `tsc --noEmit` 无输出 |
| `pnpm test` | 0 | `ℹ tests 1179` / `ℹ pass 1179` / `ℹ fail 0`（新增 12 例，基线 1167） |
| `pnpm build` | 0 | client + host 双产物构建成功；`lib/index.js 618.03 kB │ gzip: 204.51 kB` |
| 合并门禁 `pnpm typecheck && pnpm test && pnpm build` | **0** | 本次复验实跑：typecheck 0 / test 1179 全绿 / build 0 |
| `node --input-type=module -e "await import('./lib/index.js')"` | 0 | 宿主产物可加载 |
| `node --input-type=module -e "await import('./lib/client.js')"` | 0 | client 产物可加载 |

产物变化：`test/r30-member-self-service.test.ts`（新增 12 例）、`src/host/tools.ts`（成员自助准入 `memberSelfServiceOf`）、`README.md`、`README.en.md`、`lib/index.js`（重新构建）。

## 2. 用例覆盖（`test/r30-member-self-service.test.ts`）

测试自带 harness：真实 `createBridge` + 真实 `RunsStore` + 真实 `createRoleRepo` + 真实 `applyReceipt`；`sendMessage` 捕获实际投递，`runGate` 用真实 shell 执行 acceptance。所有用例先建 bridge 再 seed run（避开 `createBridge` 构造期的陈旧计划回收）。

| 要求 | 用例 | 判定点 |
|---|---|---|
| ① 成员解析 | `r30 ① 成员身份：命中绑定 + 任务，返回 run/session/binding/task` | 命中 `bindings[].memberId` 时返回 runId / 队长 sessionId / binding / task |
| ① 无绑定 | `r30 ① 成员身份：无 agent id / 无绑定 / retired 绑定都不算成员` | 只有 `{sessionId}`（无 `agent.id`）→ `null`，证明没有退回按会话 id 猜；空白 id、未知 id、retired 均 `null`；retired 的新 run 不遮住旧 run 的活绑定 |
| ① 多 run | `r30 ① 成员身份：多个 run 取最新（plannedAt → createdAt → runId 兜底）` | plannedAt 大者胜；并列时 `plan.createdAt` 大者胜；再并列 `runId` 字典序大者胜 |
| ② 字段白名单 | `r30 ② status 成员视图：字段白名单，绝不返回 members/memory/roles/plan/tasks` | 开关开着（成员自助也受开关约束）时顶层键**恰好** `{notice,ok,runId,task,view}`；逐键断言无 `members/memory/roles/plan/tasks/messages/routeAudits/dispatch/concurrency/enabled/progress/detail`；task 键**恰好** `{acceptance,dependsOn,id,status,title}`；无 `roleId/memberId/writeScopes/attempts/waitingOn` |
| ③ 他人任务 | `r30 ③ receipt：他人 taskId → FORBIDDEN，零门禁零写入` | `code === 'FORBIDDEN'`、错误含双方 taskId；任务状态不变、无 `artifacts/t2.log`、`sent.length === 0` |
| ③ 自己任务 | `r30 ③ receipt：自己的 taskId → 宿主执行 acceptance 后 done` | `status === 'done'`、`evidence.exitCode === 0`、command 为任务 acceptance |
| ④ 返工回发 | `r30 ④ 门禁失败 → rework，证据（退出码/输出尾部）回发给该成员并落账本` | acceptance `exit 7` → `rework`；证据 `exitCode 7`、`tail` 含 stderr；`attempts` +1、下游仍 pending；**实际投递**给该 `memberId` 的消息含「门禁未通过（退出码 7）」与输出尾部；账本 message 的 `toMemberId` 为该成员；`artifacts/t1.log` 存在且含失败输出 |
| ⑤ 旧文案逐字 | `r30 ⑤ 开关关闭且非成员：8 个工具都逐字返回未启用原文案` | 8 个工具按注册顺序、返回值 deepEqual `{ok:false,error:NOT_ENABLED_MESSAGE}`；断言原文含中文句号：`自动团队未启用：请在输入框内的「自动团队」选项处启用后再试。` |
| ⑤ 队长路径不变 | `r30 ⑤ 队长路径不变：开关打开时 status/receipt 仍走队长分支` | status 有 `enabled`、无 `view`，含 tasks/members/roles/messages/memory；队长可提交任意任务回执 |
| ⑤ 成员自助同态 | `r30 ⑤ 开关关闭时成员自助同态拒绝：status 与 receipt 都回旧文案，零视图零门禁` | 前置 `memberIdentityOf` 仍命中（身份 ≠ 准入）；开关关闭时 status 与 receipt 均 deepEqual `{ok:false,error:NOT_ENABLED_MESSAGE}`（同一句文案，receipt 不得被桥拦成另一句）；任务仍 `running`、无 `artifacts/t1.log`、零投递 |
| ⑥ 非成员会话 | `r30 ⑥ 非成员会话（无绑定）仍回未启用，不因“有 run”就放行` | `session-stranger` 的 status/receipt 均 `NOT_ENABLED_MESSAGE`；队长关时 status 亦然 |
| 端到端 | `r30 ⑦ fake ctx 端到端：成员提交 → 宿主执行 acceptance → done` | 用 fake `ctx.tools.register` 捕获 `registerTools` 注册的 8 个工具定义并真实调用：成员 status（白名单）→ 提交自己的 taskId → 宿主执行 `printf e2e-r30-ok` → `done`、`exitCode 0`；再次 status 可见 `done` 与 evidence |

执行结果：`node --test test/r30-member-self-service.test.ts` → **12 pass / 0 fail**。

## 3. 突变反证（断言有效性）

每个突变先备份原文件、只改一处、跑定向测试、再还原；还原后 `diff` 与备份逐字节一致。

| # | 突变 | 期望变红 | 实测 |
|---|---|---|---|
| M1 | `state.bindings.find(... && item.retired !== true)` 去掉 retired 过滤 | ① retired 用例 | 仅 ① 红（10 pass / 1 fail） |
| M2 | 成员 status 返回里加 `members: []` | ② 白名单用例 | 仅 ② 红 |
| M3 | 把 `taskId !== member.binding.taskId` 改成恒假 | ③ 他人任务用例 | 仅 ③ FORBIDDEN 红 |
| M4 | `bridge.ts` 返工分支把 `await deps.sendMessage(...)` 换成 `{ ok: true }`（不投递） | ④ 返工证据用例 | 仅 ④ 红 |
| M5 | NOT_ENABLED 文案末尾 `。` 改 `！` | ⑤ 旧文案用例 | 仅 ⑤ 红 |
| M6 | `memberIdentityOf` 里 `agentIdOf(meta)` 回退成 `agentIdOf(meta) ?? sessionOf(meta)` | ① 无 agent id 用例 | 仅 ① 红 |
| M7 | `memberSelfServiceOf` 去掉开关校验（恒返回身份命中的 `member`） | ⑤ 成员自助同态用例 | 仅 ⑤ 同态红（11 pass / 1 fail） |

结论：7 个关键判据都能被对应错误实现打红，非「恒真断言」。

## 4. 文档核对（README 双语）

- `README.md:81` 使用步骤第 4 条：回执可由「开着开关的队长会话或该任务的成员自己」提交；说明成员可 `auto_team_status` 自查自己那条任务（字段白名单）、`auto_team_receipt` 只提交自己任务（他人 taskId → `FORBIDDEN`；其它工具仍「未启用」），并明确 **「成员自助也受开关约束」**：run 所属队长会话的开关关闭时，这两个工具对成员同样回「未启用」原文案。
- 开关与入口一节补「成员自助也受开关约束」；工具表 `auto_team_status` 行补「要求 run 所属队长会话的开关开着」，`auto_team_receipt` 行补「成员自助也受开关约束，关闭时与 status 同回『未启用』」。
- 「已知限制」首条改为「成员会话只能看到/提交自己的任务（且成员自助也受开关约束）」，现象/原因/规避三行同步（原因点名 `memberSelfServiceOf` 的「身份命中 + run 所属队长会话 enabled」双重准入）。
- `README.en.md` 对应位置同结构镜像（开关与入口、步骤 4、工具表两行、已知限制首条）。
- 结构对等证据：`pnpm test` 中 `test/r29-packaging.test.ts` 通过（h2 数量一致、图片引用集合一致、engines 表与 `package.json` 一致）。

## 5. 边界与未验证项

1. **边界已定（修正）：成员自助也受开关约束。** 修正前工具层成员分支不看开关，`auto_team_status` 在队长开关关闭时照样回成员视图，而 `auto_team_receipt` 被 `bridge.act` 的 `preflightGate` 拦下并回桥层文案（`自动团队未启用：请先在输入框内的「自动团队」选项处启用`，`code: NOT_ENABLED`）——「一个放行、一个拒绝 + 两处文案」对用户是纯噪音。现在 `src/host/tools.ts` 新增唯一准入谓词 `memberSelfServiceOf`（`memberIdentityOf` 命中 + `deps.bridge.enabled(member.sessionId)`，即 run 所属队长会话的开关），status 与 receipt 共用：关闭时两者都回 tools.ts 的 `NOT_ENABLED` 原文案（逐字一致），开启时都放行且 receipt 仍走 `bridge.act` 同一道门禁（无旁路标志、未改 `preflightGate`）。用例 `r30 ⑤ 开关关闭时成员自助同态拒绝` 固化该边界，②/③ 的 harness 因此改用 `enabled: true`（与「成员只在队长开启后创建」的真实前提一致）。
2. **阻塞部署项：真机进程仍在跑 t1 之前的旧产物。** 成员会话实测 `auto_team_status` / `auto_team_receipt` 均返回 `自动团队未启用：请在输入框内的「自动团队」选项处启用后再试。`；核对：
   - `grep -c "成员视角" ~/.dsh/profiles/desktop/node_modules/dsh-auto-team/lib/index.js` → **0**（profile 里是 Nov 13 00:27 的旧构建，是真实目录不是指向仓库的软链）；
   - 仓库重建后的 `lib/index.js` 同样 grep → **1**；
   - 用真实 run 库直调 t1 的 `memberIdentityOf`（`new RunsStore(~/.dsh/auto-team/runs)`，`agent.id = e6c78aab-dd22-4bbd-b884-1ff3a42f042f`，即本成员会话目录名）→ 正确解析出 `runId=run-mwe4anm9-zoe`、`taskId=t2`、`taskStatus=running`、`acceptance="pnpm typecheck && pnpm test && pnpm build"`。
   结论：**t1 逻辑对真实数据成立**；真机不生效是「profile 安装副本仍是旧 lib」导致，与代码无关。需要主 agent 在收尾时 rebuilt 后重新安装 profile 包并重启宿主，成员自助才会真正上线。此项不阻塞本任务的门禁（门禁在仓库源码上跑），但阻塞「成员在自己会话里自查/交回执」的真机体验。
3. **未验证：面板呈现。** 成员视角在右栏面板的展示（是否只显示自己的任务）不在 t2 范围，未做真机 UI 核对。
4. **未覆盖：** 同一成员绑定多条任务、`retired` 与开关切换的并发时序、空 acceptance 的成员回执路径（t1 已有通用门禁用例，但未从成员入口走）。

## 6. 建议修改 / 可接受

| 建议修改 | 可接受 |
|---|---|
| 无（原「开关关闭时成员能否交回执」的待决策已按「成员自助也受开关约束」落定：两工具同态回旧文案，文案统一在 tools.ts 的 `NOT_ENABLED`）。 | 本次 t1/t2 的既定验收全部满足，门禁全绿；开关关闭 = 团队停用（成员也不收活），两工具同态且文案逐字一致。 |
| 桥层 `NOT_ENABLED_TEXT`（`src/host/bridge.ts:520`）与 tools.ts 文案仍不同，但成员分支已在工具层提前同态拒绝，用户不会再在成员路径上看到桥层文案。 | 现状不影响成员自助；⑤ 要求队长/非成员旧文案逐字不变，桥层文案改动不属于本任务范围。 |

## 7. 复验命令

```bash
cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
node --test test/r30-member-self-service.test.ts   # 期望 12 pass / 0 fail
pnpm typecheck && pnpm test && pnpm build          # 期望退出码 0，全量全绿
```
