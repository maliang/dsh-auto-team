# r41 QA 报告：`agent/status: idle` 作为「本轮结束」权威信号

- 任务卡：t3（QA 测试工程师）；前置 t1（宿主侧接入 idle）、t2（名单按 root 分组 + 降级进快照）均已过门禁。
- 判定对象：`agent/status { status: 'idle' }` → 落「待回执」事实；误报护栏；跨 root 名单；名单降级可见。
- 结论：**通过**。新增 `test/r41-idle-silent-finish.test.ts` 6 例全绿（含 3 条反例、1 条跨 root、1 条降级可见），2 条变异均按预期变红且字节还原；全量门禁 `pnpm typecheck && pnpm test && pnpm build` 全绿（1293/1293）。
- 唯一保留项（未验证项 §7）：本机无法直接观测被测宿主投递的 raw `agent/status` payload，需重启到含本改动的 profile 后真机确认一次。

## 1. 真机证据（r41 事故形态，已核实）

事故现场（**修复前**的真机 run，dianlijiaoyi 工作区）：

| 事实 | 证据 |
|---|---|
| run / 会话 | `~/.dsh/auto-team/runs/run-mwjz4flf-11le.json`，`plan.sessionId=session-1b535d77-14e5-4e31-94ac-877f329ca55d`，`plannedAt 2026-11-17 08:48:15` |
| 成员 | `t14r` binding `{ memberId: 8d3d19bb-ac39-42b6-abb7-c866eb07b8f7, name: dev-t14r-h9frd1, spawnedAt 09:09:25 }` |
| 本轮真实结束 | 成员会话 `~/.dsh/sessions/--Users-maliang-Documents-develop-guangdahehui-dianlijiaoyi--/8d3d19bb-ac39-42b6-abb7-c866eb07b8f7/session.v4.jsonl.zstd`，`seq 211 turn/end time 1794877899382` = **2026-11-17 09:11:39 `{kind:"completed"}`** |
| 事故当时任务仍 running | 上游 t1 在 **10:22** 观测：`t14r.status='running'`、`silentFinish` 空、面板显示「停滞 71 分钟」（09:11:39 → 10:22:39 = 71 分钟，与 71 分钟口径一致） |
| 静默结束**从未入账** | run 文件 `messages` 里 `/已结束本轮/` = **0 条**；任务对象**无 `silentFinish` 键**（不是空对象，是键不存在） |
| 人工兜底 | 队长 10:05:56 手动发消息续聊（`captain→dev-t14r-h9frd1`「你上一轮停在 09:11，之后 53 分钟没有事件」），成员 10:06:38 开第二轮（`seq 240 turn/end`），10:43:05 落 `evidence{exitCode:0}`、10:43:13 回执，任务才变 `done` |

即：**「本轮结束」是真机上可核验的事实（09:11:39 turn/end completed），但插件侧 71 分钟里一直显示 running、待回执 0 条**，最终靠队长人工续聊才收口——这正是 r41 要修的缺陷形态。根因（上游已核）：r40 依赖 `listDescendants` 的 `activity`，而宿主对已完成本轮的子 agent 仍报 `activity: running`（该成员快照 status 仍 running），`subagent/end` 真机也没投递；权威信号是 agent 作用域定向派发的 `agent/status`（`docs/teamflow/architecture/HOST-EVENTS.md:35-40`：「idle means no driver remains scheduled or active」）。

复现口径：把「成员会话最后一条 `turn/end{reason.kind:completed}`」当作本轮结束的**客观事实**，然后检查该成员对应任务在同一时刻之后是否出现 `silentFinish`/`captain→user(taskId)` 通知。修复前：09:11:39 之后 71 分钟两者都为空 → 复现。修复后：单测用真实 `apply()` 把 `agent/status idle` 投进成员 `agent.ctx`，`silentFinish.at` 与通知同时出现（§2 AC-01）。

## 2. 覆盖矩阵（每条 AC 一条命令 + 断言位置）

被测文件：`test/r41-idle-silent-finish.test.ts`（241 行起 6 例，全部走真实 `apply()` + 假宿主，断言读**落盘** run 文件）。

| AC | 用例（文件行） | 断言要点 | 命令 | 结果 |
|---|---|---|---|---|
| 1) idle→待回执 + 幂等 | `test/r41-idle-silent-finish.test.ts:241` | 成员 `agent.ctx` 真有 `agent/status` 订阅；先 `tools/result` 后 `idle` → `silentFinish{at≈idle 到达时刻, memberId}`；`captain→user` 恰 1 条且 `taskId='t1'`、`at===silentFinish.at`、正文含「已结束本轮但未提交回执」；`evidence` 不得被伪造、任务仍 running；重复 idle → `at` 不变、消息仍 1 条 | `node --test test/r41-idle-silent-finish.test.ts` | pass 6 / fail 0 |
| 2) 刚 spawn 就 idle 不落标 | `test/r41-idle-silent-finish.test.ts:287` | 无任何 running/tools 信号直接 idle → `silentFinish===undefined`、任务 running、账本 0 条；同时证明该断言不是空转：M1 去掉护栏本条必红 | 同上（+ `node test/r41-mutation-probes.mjs`） | pass；M1 红 |
| 3) evidence / done / retired 反例 | `test/r41-idle-silent-finish.test.ts:313` | 三种状态各跑一遍真实 apply：`silentFinish` 不落、任务状态不被 idle 改写、账本 0 条 | 同上 | pass 6 / fail 0 |
| 4) 跨 root 名单 | `test/r41-idle-silent-finish.test.ts:360` | 两个 run 不同 `plan.sessionId`；`listMembers` 调用**恰好 2 次、各命中 ROOT_A/ROOT_B 一次**；A/B 任务都保持 running、无「已失联」；各自 `memberListHealth().ok===true` | 同上；M2 变异 | pass；M2 红 |
| 5) 名单抛错降级可见 + 恢复 | `test/r41-idle-silent-finish.test.ts:412` | `memberListHealth(SESSION)={ok:false,error:/E_HOST_MEMBERS_OFFLINE/}`；**同一 tick 另一个 root 照常对账**（该 root 的失联成员仍判 interrupted，证明 `continue` 不是 `return`）；有 warn；bridge 快照 `membersSource` 深等于该健康态 → 面板可见；名单恢复后 `ok:true`、`error` 不残留；无记录的会话 `membersSource` 字段**缺席**（不编默认 ok） | 同上 | pass 6 / fail 0 |
| 6) 客户端零改动仍显示待回执 | `test/r41-idle-silent-finish.test.ts:500` | 同一 run 两任务：有 `silentFinish` → 快照 `awaitingReceipt===true`；无 → 不为 true（服务端现算，客户端未改） | 同上 + `node --test test/r34-silent-finish-wire.test.ts test/r34-silent-finish-qa.test.ts test/r34-host-live-members.test.ts` | 6/6；r34 组 11 pass / 0 fail |

断言自检（「改回错误实现会不会红」）：

- 若删掉 `src/host/index.ts` 里 idle 分支 / `recordMemberIdle`，AC-1 红（silentFinish 与通知都消失）。
- 若删掉 `src/host/adapters.ts:1864` 的成员级 `agent/status` 订阅，AC-1/2 在「订阅必须装到成员 agent.ctx」这一行就红。
- 若护栏改成恒真 / 去掉，AC-2 红（M1 实测）。
- 若名单改回单变量，AC-4 在「两次调用」与「B 保持 running」两处都红（M2 实测）。
- 数值/计数类断言均用「恰好 1 条 / 恰好 2 次调用」，不用子串包含代替计数。

## 3. 变异矩阵（实测，非推断）

脚本：`test/r41-mutation-probes.mjs`（从仓库根跑；从归档目录跑会因相对根假红）。脚本流程：基线必须全绿 → 精确替换命中次数必须为 1 → 跑定向用例断言**指定的那条**变红 → 用内存原始字节还原 → sha256 与变异前逐字节一致 → 再跑一次必须回绿（任一步失败非 0 退出）。证据 JSON：`docs/teamflow/2026-11-17-r41-idle-silent-finish/mutation-evidence.json`。

| # | 变异 | 位置 | 预期红 | 实测 | sha256 前后 | 还原 |
|---|---|---|---|---|---|---|
| M1 | 去掉 idle 防误报护栏：`if (!memberSawWork.has(info.memberId)) return` → `{ /* 护栏被移除 */ }` | `src/host/index.ts:377` | 用例 2「刚 spawn 就 idle」 | **RED**（exit 1，失败项就是用例 2） | `f6c6840c…a87ff23` → `14602b48…0f25108` | 字节一致，回绿 |
| M2 | 名单 Map 换回单变量：`membersByRoot.get(rootId)` → `?? (size===0 ? undefined : [...values()][0])`（后续 root 复用第一个 root 的名单） | `src/host/team/watcher.ts:440` | 用例 4「跨 root」 | **RED**（exit 1；用例 4 必红，副作用连带用例 5——同一 root 复用污染降级断言，属预期） | `96e6b3e1…d7ab360` → `12e7dbef…fc079ec` | 字节一致，回绿 |

运行结果尾部：`[matrix] M1@src/host/index.ts:377 red=true restored=true green=true  M2@src/host/team/watcher.ts:440 red=true restored=true green=true`。跑完后工作树无残留变异（脚本每次 restore 后重算 sha256 比对，见 JSON 的 `restoredByteIdentical: true`）。

## 4. 门禁证据（收尾跑一次全量）

| 命令 | 退出码 | 证据尾部 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc --noEmit` 无输出 |
| `pnpm test` | **0** | `ℹ tests 1293 / ℹ pass 1293 / ℹ fail 0`（含本次新增 6 例） |
| `pnpm build` | **0** | `lib/index.js 659.48 kB │ gzip: 218.09 kB`、`Build complete in 54ms` |

产物（构建后实测）：

| 产物 | 字节 | sha256 | 双 import |
|---|---|---|---|
| `lib/index.js` | 659479 | `8c10886e02c9d468152206bace8775f3b7d6b643eeb094b0f89870588548408f` | `node --input-type=module -e "await import('./lib/index.js')"` → exit 0（`host-import ok`） |
| `lib/client.js` | 607171 | `55e850838a73876f2784fd78410f4f1d5e4d63d6095b6276bf949f0a1bc9f7c6` | `node --input-type=module -e "await import('./lib/client.js')"` → exit 0（`client-import ok`） |

客户端产物本轮**零源码改动**（`src/client/**` 无 diff，`git status` 里 `lib/client.js` 无变更——重建后字节一致）；「待回执」显示依赖的是服务端快照字段 `awaitingReceipt`（`src/shared/types.ts:971`），AC-6 未触碰客户端。

## 5. 建议修改 / 可接受

| 建议修改（不阻塞本卡） | 可接受（本轮已满足） |
|---|---|
| 真机 payload 形态目前只有单测覆盖两种容器（`args[0]` 与 `args`）。建议重启后抓一次真机 `agent/status` 事件日志（`ctx.logger.info` 临时打点或宿主 devtools），确认 `agent.id` 与成员 id 同域；**不改代码前先观测**。 | `agentStatusOf` 的宽松解析（取不到 status 当没有、绝不抛）对未知 payload 形态是安全的：最坏结果是漏报一次 idle，而不是误标。 |
| `recordMemberIdle` 每次都 `store.list()` 全量扫 run（与 `recordProgress` 同型）。当前 run 数量级（个位数）无感；若将来单 dataRoot 上百 run，可考虑由 watcher 缓存 run 索引。 | 与既有 `recordProgress` 同一实现风格，不引入新依赖、不新增落盘字段，符合 t1 约束。 |
| 降级提示目前只有快照字段（面板可见），日志侧 `onWarn` 每 root 同错误只报一次。若面板未来要做「点开看原因」，`membersSource.error` 已是现成文案来源。 | 快照字段 `membersSource` 可选、缺省不出现（`src/host/bridge.ts:1925`、`src/shared/types.ts:974`），旧数据不补 0，符合 t2 约束。 |

## 6. 缺陷

本轮**未发现新增缺陷**（t1/t2 的既有缺陷 D1「名单失败只进 logger.warn」已由 t2 修掉，本卡 AC-5 断言其快照投影与恢复）。事故本身的根因（r40 依赖 `activity`）已由 t1 换信号源修复。

## 7. 未验证项（必须真机确认，别拿「构建/单测通过」代替）

1. **raw `agent/status` payload 未经真机观测**：本机（当前运行的宿主版本）插件尚未升级到含 t1/t2 的构建，无法直接观测被测宿主实际投递的 `agent/status` 事件；单测覆盖的是 `(payload)` 与 `(payload,...)` 两种容器下的宽松解析。需：`cd ~/.dsh/profiles/desktop && pnpm add file:<repo>` + 同步 `dsh.profile.bundles`，重启宿主后，对一个真实成员等一次 `turn/end completed`，确认 60s 内 run 文件出现 `silentFinish{at,memberId}` 且账本出现 1 条「已结束本轮但未提交回执」。
2. **spawn 瞬间 idle 的真实存在性**：护栏假设「刚 spawn 可能先到一次 idle」。真机若确认从不出现，护栏仍可保留（幂等、零成本），但「误报」这一事故形态的权重需下调。需与上一条同一次真机观测顺带确认（观察 spawn 后 0-3s 内是否出现 `agent/status idle`）。
3. **两条 root 的 run 同时活跃的真实并发**：AC-4 用同一 dataRoot 下两个 run 文件验证；真机跨工作区并发跑两个会话的情形未实测（本机当前 profile 只有一个活跃会话）。风险低（纯内存 Map 分键），但需在下一轮真机并行派发时补一次观测。
4. **面板视觉**：`membersSource` 与「待回执」徽标在真实面板上的渲染未截图验证（客户端零改动，走既有字段链路；r34 既有 e2e/快照用例未红）。

## 8. 复跑须知

- 定向：`node --test test/r41-idle-silent-finish.test.ts`（约 0.2s）。
- 变异：`node test/r41-mutation-probes.mjs`（会临时改写 `src/host/index.ts` 与 `src/host/team/watcher.ts`，脚本内自动字节还原；**不要在并发改这两个文件时跑**）。
- 全量：`pnpm typecheck && pnpm test && pnpm build`。
- 所有命令在仓库根 `/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team` 执行；从 `logs/` 归档位置复跑探针会因相对根解析假红。
