# QA 报告 · r34「待回执」（成员结束本轮却没交回执）

- 任务：t3（QA）· 前置 t1（宿主侧）、t2（客户端）均已过各自门禁
- 日期：2026-11-13
- 判定：**通过**。全量门禁 `pnpm typecheck && pnpm test && pnpm build` 退出码 0（1257/1257），双产物 import 成功，4 条变异探针全部「原样绿 + 变异红」。
- 未验证项（不影响本次判定，但不得当成已验证）：真机面板未渲染（见 §7）。

## 1. 动机证据：r33 t7 的 58 分钟静默（真实时间线）

数据源：`~/.dsh/auto-team/runs/run-mwejxrq1-zoe.json`（r33 run，`plan.status=terminated`，8 个任务全 done）。
时间均为 Asia/Shanghai（`toLocaleString('sv-SE', {timeZone:'Asia/Shanghai'})` 直读，未手算）。

| 时刻 | 事实 | 证据字段 |
|---|---|---|
| 15:33:17 | 队长把 t7 派给 `official-flash-t7-ayulqk` | `bindings[t7].spawnedAt=1794555197174`；消息 `captain → member`「任务 t7…已派发」 |
| 15:35:31 | 该成员**最后一次**进度信号（此后无任何进度） | `progress["74e343c3-…"].at=1794555331893` |
| 15:35:31 → 16:33:32 | **58 分 01 秒**无人推进，任务仍 `running` | 上两行 + 下行 |
| 16:33:32 | 门禁证据落盘（`pnpm typecheck`，退出码 0） | `tasks[t7].evidence.at=1794558812118` |
| 16:33:35 | 成员才发出「门禁通过」消息，任务转 done | `taskTimes[t7]={startedAt:1794555197174, endedAt:1794558815153}` |
| 全程 | 停滞告警为空 —— 面板没有任何信号说明「人已经停了」 | `stallAlerts=[]` |

结论：任务卡口径的「57 分钟」是约数，按落盘字段实为 **58 分 01 秒**（15:35:31 → 16:33:32）；同一段到回执消息为 58 分 04 秒。这段时间里 `stallAlerts` 为空，正是「成员已结束本轮、任务还在 running、却没人知道」的事故形态 —— 也是本次 `silentFinish` 观察事实要补的缺口。

## 2. 本次新增的回归资产

| 文件 | 内容 | 用例数 |
|---|---|---|
| `test/r34-silent-finish-wire.test.ts` | 真实 `apply()` + 假宿主：把 `subagent/end` 真的投进订阅器，读**落盘**的 run 文件；重复事件幂等；事件路与轮询路落盘字段/通知正文对齐 | 2 |
| `test/r34-silent-finish-qa.test.ts` | AC 口径补充：终态矩阵（done/failed/cancelled）、回执后 `awaitingReceipt=false`（done+rework）、待回执与停滞同时成立仍可分辨、徽标只在待回执时出现 | 4 |
| `test/r34-silent-finish-mutation-probes.mjs` | 4 条变异探针（M1–M4），临时副本内打补丁，不碰工作区 | — |

关键点：`test/r34-silent-finish-wire.test.ts` 是**唯一**能抓住「函数都对、但事件里没人调用」的用例 —— 只测纯函数时，把 `src/host/index.ts:749` 的接线整段删掉仍然全绿（M4 实测）。

## 3. AC 对照

| AC | 判定 | 证据（可复验） | 结论 |
|---|---|---|---|
| ① running + 无证据 + 成员已停 → 命中；done/failed/cancelled、有 evidence、binding retired、成员仍在跑 → 不命中 | `isSilentFinish` 矩阵 + 终态矩阵 | `test/silent-finish.test.ts:55`（矩阵）、`test/r34-silent-finish-qa.test.ts`「AC①」；实现 `src/host/team/silent-finish.ts:32` | 通过 |
| ② 事件路径（`subagent/end`）与轮询路径（`listMembers` 对账）各至少一例，落盘字段一致 | 事件路径用真实 `apply()` 投事件后读盘；轮询路径用 `reconcileMembers`；第三条用例逐字段对齐 | `test/r34-silent-finish-wire.test.ts`（2 例）、`test/silent-finish.test.ts:146`；实现 `src/host/index.ts:749`、`src/host/team/watcher.ts:123` | 通过 |
| ③ 同一成员重复发两次终结事件 → `at` 不变、通知恰 1 条 | 事件连发 3 次（`subagent/end` ×2 + `agent/error` ×1） | `test/r34-silent-finish-wire.test.ts` 第一例断言 `silentFinish.at` 不变、`silentMessagesOf===1` | 通过 |
| ④ `auto_team_receipt` 成功后 `silentFinish` 消失、`awaitingReceipt=false`；rework 同样 | `applyReceipt` done / rework 两条路都断言 | `test/r34-silent-finish-qa.test.ts`「AC④」；实现 `src/host/team/dispatch.ts:1103` | 通过 |
| ⑤ 通知恰 1 条、带 taskId、`to==='user'`、正文含任务号与两条出路 | 逐字段断言 `from/to/taskId/at/body` | `test/r34-silent-finish-wire.test.ts` 第一例；文案 `src/host/team/silent-finish.ts:48` | 通过 |
| ⑥ 徽标只在待回执时出现、title 含原因、与 stall 文案不重叠（同时成立仍可分辨） | 成员页同时 `stalled=true` + `silentFinish`：两条文案都在、互不包含；无 silentFinish 时汇总为 `null` | `test/r34-silent-finish-qa.test.ts`「AC⑥」两例；`test/member-page.test.ts:286`；实现 `src/client/viewmodel.ts:1635`、`src/client/nav.ts:619` | 通过 |
| ⑦ 变异 ≥3 条各自变红 | 4 条探针全过（见 §4） | `node test/r34-silent-finish-mutation-probes.mjs` → exit 0 | 通过 |
| ⑧ 全量门禁 + 双产物 import + sha256 | `pnpm typecheck && pnpm test && pnpm build` 退出码 0；import 两条命令均成功 | 见 §6 | 通过 |
| ⑨ 报告落盘（AC 对照、变异矩阵、r33 t7 时间线、未验证项） | 本文件 | `docs/teamflow/2026-11-13-r34-silent-finish/QA-REPORT.md` | 通过 |

## 4. 变异矩阵（`node test/r34-silent-finish-mutation-probes.mjs`）

| 编号 | 把实现改回的错误版本 | 目标用例 | 原样 | 变异后 | 失败证据（实测） |
|---|---|---|---|---|---|
| M1 | 去掉「无证据」判据：`if (task.evidence !== undefined && false) return false` | `test/silent-finish.test.ts`「isSilentFinish：running…」 | exit 0 | exit 1 | `AssertionError: 已有门禁证据 → 不是「没交回执」` |
| M2 | 轮询路径不写标：`reconcileMembers` 判定前加 `false &&` | `test/silent-finish.test.ts`「reconcileMembers（轮询路）…」 | exit 0 | exit 1 | `AssertionError`（深比较：silentFinish 未落盘） |
| M3 | `recordSilentFinish` 去掉 `task.silentFinish !== undefined` 早退 | `test/r34-silent-finish-wire.test.ts`「r34 事件路径…」 | exit 0 | exit 1 | `AssertionError: 重复事件不得重复通知` |
| M4 | 删掉 `src/host/index.ts:749` 整段事件接线 | 同上 | exit 0 | exit 1 | `AssertionError: 事件路径必须落盘 silentFinish.at` |

判读规则：原样副本必须 exit 0 **且输出里真的出现目标标题**（防止 name-pattern 零命中被算成 pass）；变异副本必须 exit != 0 且命中 `AssertionError`。4/4 通过。

## 5. 缺陷与边界

**缺陷：0 条**（无 P0/P1/P2）。以下三条是设计边界/未验证项，按「症状 / 根因 / 复验命令」记录，不当作缺陷：

1. **成员缺席（`listMembers` 里找不到该成员）时不写待回执**
   - 症状：成员从宿主名单彻底消失时，任务被直接标 `interrupted`，没有 `silentFinish`。
   - 根因：缺席无法区分「成员已停」与「名单暂时读不到」；写入等于猜测，违反「两路信号都拿不到时不写」。
   - 复验：`grep -n "if (!member)" -A 12 src/host/team/watcher.ts`；`test/silent-finish.test.ts:161`（成员活着不写）与既有 interrupted 对账用例。
2. **真机面板未渲染**
   - 症状：本次只做了 viewmodel/组件源码级断言，没有在真实 DSH 面板里看到蓝 pill 与黄条的视觉差异。
   - 根因：QA 子会话不能操作宿主 GUI（权限固定，且真机验证按约定由主 agent 统一执行）。
   - 复验：主 agent 打开面板，找一条 `awaitingReceipt=true` 的任务行，确认 `[data-awaiting-receipt]` 存在、title 含「未提交回执」，且与停滞黄条同时出现时仍能分辨。
3. **宿主真实事件 payload 形状未在真机核对**
   - 症状：事件路径的成员匹配依赖「payload 里出现 memberId 或 name」（`payloadIdsOf` 递归收集字符串）。
   - 根因：本次用假宿主投递 `{memberId, name}`；真实 `subagent/end` 的 payload 形状尚未在真机抓包确认。
   - 复验：真机触发一次成员正常结束，确认 run 文件出现 `silentFinish`；若没有，先查 `payloadIdsOf` 是否覆盖真实字段。

## 6. 门禁证据（2026-11-13 17:23 实跑）

```
$ pnpm typecheck && pnpm test && pnpm build
EXIT:0
ℹ tests 1257
ℹ pass 1257
ℹ fail 0

$ node --input-type=module -e "await import('./lib/index.js')"   # exit 0（无输出）
$ node --input-type=module -e "await import('./lib/client.js')"  # exit 0（无输出）

$ shasum -a 256 lib/index.js lib/client.js
9e2e1886cc91b4578bbe32789d5763d3bbda91472ffb4397ba1e730113095a66  lib/index.js
32c5d5fc932f1abbdffe02d8c403512356eae9328bab5c7cf1526a5f57289f3c  lib/client.js
```

完整日志：`/tmp/r34-gate.log`（临时文件，不作为交付物）。

## 7. 未验证项（全绿也要说）

- 真机面板未渲染：`[data-awaiting-receipt]` 的视觉与 title 只在源码/单测层验证（§5.2）。
- 真实宿主 `subagent/end` / `agent/error` 的 payload 形状未核对（§5.3）。
- 客户端变异未做：M1–M4 覆盖宿主侧判据与接线；客户端「删掉 pill 会不会红」由 `test/r34-silent-finish-qa.test.ts` 直接锁死，但没有对应的变异探针（AC⑦ 只要求 3 条，已有 4 条宿主侧）。
- 事件源真降级（`subscription.degraded=true`）下的端到端对账未在真机演练；轮询路径本身已用 `reconcileMembers` 直测。

## 8. 建议修改 / 可接受

| 建议修改（不阻塞本次） | 可接受（明确不改） |
|---|---|
| 把 `recordSilentFinish` 的入口条件（`running` + 无 evidence）与 `isSilentFinish` 收敛到一处：当前 `src/host/team/watcher.ts:195` 与 `src/host/team/silent-finish.ts:32` 各写一遍，将来改判据容易漂移；可在 `recordSilentFinish` 内复用判定，或补一条「两处判据一致」的契约用例。 | 成员缺席不写待回执（§5.1）：无法区分「停了」与「名单读不到」，宁可不写。 |
| 真机核对后，若 payload 只带 `name` 不带 `memberId`，把 `payloadIdsOf` 的匹配面写进注释并补一条夹具（当前靠递归字符串兜底，够用但脆弱）。 | 通知文案固定含两条出路、不带「偶发/疑似」等模糊词；本次按字面断言，不改。 |
| 面板验证时顺带确认「待回执」蓝 pill 与停滞琥珀条在同一行不重叠渲染（源码层已用不同 token，真机未看）。 | 待回执不改任务状态徽标（仍是「执行中」）：这是 AC 的硬要求，不是缺陷。 |

## 9. 复验命令清单

```bash
# 定向回归
node --test test/silent-finish.test.ts test/r34-silent-finish-wire.test.ts test/r34-silent-finish-qa.test.ts

# 变异矩阵（4 条，必须 exit 0）
node test/r34-silent-finish-mutation-probes.mjs

# 全量门禁
pnpm typecheck && pnpm test && pnpm build
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
shasum -a 256 lib/index.js lib/client.js
```
