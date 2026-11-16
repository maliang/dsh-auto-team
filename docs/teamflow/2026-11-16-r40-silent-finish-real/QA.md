# r40 QA：silentFinish 两路信号 + stale 收口不再误杀

- 需求：r36 根因修复（t1，`src/host/{adapters,index,store}.ts` + `team/watcher.ts`）的**回归判定**
- QA 任务：t2；判据来源：`docs/teamflow/2026-11-16-r36-silent-finish-miss/ROOT-CAUSE.md` §6
- 测试文件：`test/r40-silent-finish-real.test.ts`（4 例，新增）
- 结论：**①③④ 通过；② 的「面板/状态能看到降级」未达成（缺陷 D1）**；三项门禁全绿。

## 1. 判据 → 命令 → 结果

| # | 判据 | 命令 | 修复后 | 旧代码（HEAD 8e990b0） |
|---|---|---|---|---|
| ① | 轮询按 `plan.sessionId` 取名单，`silentFinish` 落盘且重读仍在 | `node --test test/r40-silent-finish-real.test.ts` | 绿 | 红：`actual: [undefined]` vs `['sess-r40-real']` |
| ② | 名单不可得经 `onWarn` 报 1 次、同错不刷屏、期间不判死 | 同上 | 绿（面板降级部分见 D1） | 红：`actual: 0, expected: 1`（旧码无 `onWarn`） |
| ③ | 同一宿主形状 payload 两路订阅 → `silentFinish` 只一条、通知只一条 | 同上 | 绿 | 红：队长作用域未补订 `subagent/end` |
| ④ | `silentFinish.at` 计入活动：30 分钟内不判 stale；真死计划仍收口 | 同上 | 绿 | 红：`lastActivityAtOf` 取到 `1759999940000`（plannedAt）而非 `1759999999000`（silentFinish.at） |
| ⑤ | `pnpm typecheck && pnpm test && pnpm build`；双产物 import；`lib/index.js` sha256 | 见 §4 | 绿 | — |

## 2. 用例细节（都断言「落盘」，不读内存）

### ① 轮询路径（ROOT-CAUSE §6 用例 A 的放大版）
真 `RunsStore` 指向 `mkdtemp`；run `plan.sessionId='sess-r40-real'`；任务 `t2 status:'running'`、无 `evidence`；
绑定 `{taskId:'t2', memberId:'M', name:'qa-t2'}`。
`createMemberWatcher({ listMembers: (rootId) => rootId==='sess-r40-real' ? [{id:'M',status:'inactive'}] : throw NO_CALLER })`，手工 `await tick()`。
断言：`roots` 恰为 `['sess-r40-real']`；`silentFinish.at` 为有限数；**换新 `RunsStore(dir)` 重读仍在**（证明落盘）；
通知恰 1 条；`status` 仍 `interrupted`、`evidence` 仍 `undefined`（只记事实，不自动 done/不替成员跑门禁）。

### ② 名单不可得不再静默
连续 3 轮同一错误 → `onWarn` 只 1 次；错误文本变化 → 再报 1 次（第二次故障不静默）；
失败期间任务保持 `running`、`silentFinish` 不伪造；名单恢复后 `silentFinish.at===NOW`。
`onWarn` 是唯一告警出口 — 装配层若摘掉它，这条立刻红。
**未达成**：告警只进 `ctx.logger.warn`，面板快照看不到（D1）。

### ③ 事件路双订阅不双写
真实 `apply()` + 假宿主（`agents.currentInitiator()` 返回带 `ctx.on` 的队长）；根 `events` 与 `captainEvents`
都登记了 `subagent/end` / `agent/error`。一次 `emitBoth('subagent/end', {id:'M', parentSessionId:SID, stopReason:'completed'})`
同时打到两路（handler 跑两次）。断言 `silentFinish` 恰一条、`captain→user` 通知恰 1 条、`at` 不刷新；
再重放 `subagent/end` + `agent/error` 仍不增长（幂等，不靠去重表）。

### ④ stale 收口不误杀
`t2` 已落 `silentFinish.at=NOW-1000`，`t3 pending`。`reconcileStalePlans` 在 `NOW+10min`、`NOW+29min` 均返回 `[]`，
`t3` 保持 `pending`、无 `termination`；`NOW+31min` 仍返回 `[run]` 并 `cancelled` 残留任务（阈值没被改没）。
对照：无 `silentFinish`、只有 60 分钟前 `plannedAt` 的死计划，`NOW+31min` 照样收口。

## 3. 旧代码对照（证明判据会变红）

```bash
git worktree add --detach /tmp/r40-old HEAD   # 8e990b0 = 修复前
cp test/r40-silent-finish-real.test.ts /tmp/r40-old/test/
cd /tmp/r40-old && node --test test/r40-silent-finish-real.test.ts
# ℹ tests 4 / ℹ pass 0 / ℹ fail 4
```

四条失败原因分别是：`listMembers` 收到 `undefined`；`onWarn` 从未被调（0 次）；队长作用域无 `subagent/end`；
`lastActivityAtOf` 只取 `plannedAt`。**判据不是恒真断言**。复跑完已 `git worktree remove /tmp/r40-old`。

## 4. 门禁证据（2026-11-16，仓库根）

```text
pnpm typecheck → exit 0
pnpm test      → ℹ tests 1287 / ℹ pass 1287 / ℹ fail 0 → exit 0
pnpm build     → exit 0（lib/index.js 654.74 kB）
node --input-type=module -e "await import('./lib/index.js')"  → host_import_ok
node --input-type=module -e "await import('./lib/client.js')" → client_import_ok
sha256(lib/index.js)  = 67cfaa22f9b885e5655beacd948db212fb43dfbf83529c3c03b9a50806127b2d
sha256(lib/client.js) = 55e850838a73876f2784fd78410f4f1d5e4d63d6095b6276bf949f0a1bc9f7c6
```

复跑先确认脚本位置：本文件与 `test/r40-*.test.ts` 若从 `$DSH_HOME/teamflow/.../logs/` 归档位置跑，
相对根会解析错；需先 `cp` 回 `<repo>/test/` 再跑（AGENTS.md「探针脚本的可重跑前提」）。

## 5. 缺陷

### D1（中）名单不可得的降级在面板/状态里看不到

- **症状**：watcher 抛「成员名单不可得」时，插件面板 `snapshot.degraded` 仍为 `false`、`degradeReason` 为空；
  队长只能翻宿主日志。任务卡 ② 的「面板/状态能看到降级」不成立。
- **根因**：`src/host/index.ts:508` 的装配 `onWarn: (text) => warn(ctx, text)` 只写 `ctx.logger.warn`；
  面板的降级字段由 `src/host/bridge.ts:1914` 的 `triggerHealth()`（`src/host/index.ts:612-613`）提供，
  其唯一数据源是 `bus.health()`/`setEventSource`，watcher 的名单失败没有汇入。`src/host/bridge.ts` 里
  `grep -c 成员名单不可得` = 0。
- **建议修改**：给 `createMemberWatcher` 的 `onWarn` 在装配层接一个「降级寄存器」
  （如 `let memberListDegraded: string | null`，watcher 成功一轮时清空），并让 `triggerHealth()`
  把它与 `bus.health()` 合并：`memberListDegraded !== null → { degraded: true, reason: memberListDegraded }`。
  这样面板 header 既有事件源降级、也有名单降级，且 watcher 内已有的「同错只报一次」继续管刷屏。
- **复验命令**（修复后应 ≥1，当前为 0）：
  ```bash
  grep -RIn --fixed-strings "成员名单不可得" src/host/bridge.ts | wc -l   # 期望 ≥1
  node --test test/r40-silent-finish-real.test.ts                          # 保持 4/4 绿
  ```
  可加断言：使 `listMembers` 抛错后读取 `bridge.snapshot()`，`degraded === true` 且 `degradeReason` 含「成员名单不可得」。

## 6. 未验证项（真机仍需确认，不用「单测绿」代替）

1. **宿主真实 `subagents.listDescendants(rootId)` 对 inactive 成员的返回值**：本仓库单测只证明「拿到
   `status:'inactive'` 时会判 dead」。真机字段是否叫 `status`/`activity`、值为 `inactive` 还是别的词，
   ROOT-CAUSE §7 记为**未取得**。验证方式：真实会话里 `auto_team_status` 结束后打一条 debug 日志
   打印 `listDescendants` 原始行（或临时在 `normalizeDescendantRows` 前后各记一行）。
2. **`subagent/end` 是否真的投递给 `ctx.root + {global:true}` 与队长 `agent.ctx`**：本用例只证明
   「两路订阅都接上、重复投递不双写」，不证明宿主会投递。若真机两路都收不到，只能靠 1500ms 轮询兜底
   （本轮 ① 已证明轮询这条腿修好了）。
3. **面板显示降级**：D1 修复后需真机看 header（本机宿主 0.2.2-rc.2 的 `subagents` 形状亦未全核）。
4. **30 分钟 stale 的现场复现**：单测用 `reconcileStalePlans` + 假时钟证明；真机需等真实 30 分钟，
   本次未等。

## 7. 产物

- `test/r40-silent-finish-real.test.ts`（新增，4 例；旧码 4/4 红）
- 本报告
- 门禁日志：`/tmp/r40-gate.log`（临时；退出码已摘录到 §4）
