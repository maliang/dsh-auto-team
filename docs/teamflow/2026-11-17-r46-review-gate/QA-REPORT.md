# QA 报告 · r46 人工验收闸门（review）全链路

- 任务：t4（回归、变异与报告）
- 日期：2026-11-17
- 结论：**PASS**（9/9 回归例、3/3 变异全部变红且逐字节还原、门禁三项见 §7）
- 被测改动：t1（状态机出口 `review`）、t2（`reviewTask` + `auto_team_review` + 自动召集）、t3（面板「待验收」与设置项）

## 1. 逐条需求条款 → 结论与证据

| # | 条款 | 结论 | 证据（用例 / 实现锚点） |
|---|---|---|---|
| ① | `needsReviewOf` 三档策略（code 只看 src/ 写域、all 一律、off 不验）× 有无 writeScopes | **PASS** | `test/r46-review-gate.test.ts:185`（纯函数：code/缺省 × src/文档/无写域，边界 `./src/`、裸 `src`、`srcfoo` 不误判、多写域任一命中）；`:213`（三档策略接真门禁并核对快照与落盘）。实现：`src/host/team/dispatch.ts:1088` |
| ② | 真 apply + 真 RunsStore：门禁 exit 0 → 任务落 `review` 且**不释放写域**、下游仍 blocked | **PASS** | `test/r46-review-gate.test.ts:253`。断言：`status==='review'`、`review.by==='gate'`、证据 exit 0；`scopeHoldersOf` 仍为 `['t1']`（`src/host/team/scope-locks.ts:37` 把 review 计入持锁态）；等待者仍 `waiting`、无 `rel-t1-t2` 释放通知；下游仍 `blocked` 且 `readyTasks` 为空、`depSatisfied('review')===false`（`src/host/plan/graph.ts:117`）。实现：`src/host/bridge.ts:3064`、`src/host/team/dispatch.ts:1130` |
| ③ | pass → done 且 `task.review.verdict==='pass'` | **PASS** | `test/r46-review-gate.test.ts:316`（真 applyReceipt 落盘、判定者 `user`、理由逐条保留、门禁证据不被抹掉、下游解锁 pending）。实现：`src/host/bridge.ts:3146` |
| ④ | fail → rework、attempts+1、返工消息带理由、下游不 ready | **PASS** | `test/r46-review-gate.test.ts:345`（`status==='rework'`、`attempts===1`、`review.verdict==='fail'`、`sendMessage` 恰一条且理由逐条出现、下游仍 blocked 且不进入 `readyTasks`） |
| ⑤ | 原作者验自己的任务 → `BAD_REQUEST`、不写 review、任务仍在 review | **PASS** | `test/r46-review-gate.test.ts:388`（带 `caller.memberId==='member-1'` 自验被拒；`review.by` 仍为 `gate`、被拒理由未写入、**整个落盘状态 deepEqual 不变**）。实现：`src/host/bridge.ts:3182` |
| ⑥ | review 态上再提回执 → 拒绝且不重跑门禁 | **PASS** | `test/r46-review-gate.test.ts:418`（`BAD_REQUEST` + `/验收中/`；验收命令带副作用 `touch <marker>`，断言 marker **不存在**，状态与证据逐字不变）。实现：`src/host/bridge.ts:3012` |
| ⑦ | 矩阵 14 态 × 4 动作 = 56 格与 `TASK_ACTION_ALLOW` 逐格一致 | **PASS** | `test/r46-review-gate.test.ts:443`（14 个唯一状态、每行恰 4 列、56 格逐格比对 `taskActionAllowed` 与 `taskActionDisabledReason` 互补；review 行 cancel/skip/acceptance 允许、pause 拒绝且文案 `/验收中.*先打回或取消/`）。实现：`src/shared/task-actions.ts:78`、`:127` |
| ⑧ | 召集幂等：同一批待验任务只发一条消息 | **PASS** | `test/r46-review-gate.test.ts:484`（首次恰建 1 人、恰发 1 条、批量消息含全部 taskId + 门禁退出码、任务状态一个字不改；同批换顺序仍 `COOLDOWN` 且账本/发送数不增；已有 qa 成员时复用不新建）。实现：`src/host/team/dispatch.ts:1432` |
| M1–M3 | 变异自检 ≥3 条，逐字节还原 | **PASS** | 见 §3：3/3 期望变红、全部还原且 sha256 前后一致 |

## 2. 门禁 vs 验收：分工与成本口径

- **门禁（自动）回答「机器能不能过」**：只跑 `acceptance` 命令、留退出码与日志；exit 0 只说明命令过了，不说明改动对。它挡的是「明显坏的提交」。
- **验收（人工/QA 角色）回答「这一版该不该收」**：只看证据与改动文件，不跑命令、不写代码（`auto_team_review` 的描述即此约束），结论只有 pass / fail。
- **默认策略 `code` 的理由**：只有 `writeScopes` 命中 `src/` 的任务才要人工验收 —— 改产品代码的风险与验收成本都在这里；纯文档/日志/任务夹改动让门禁直接收口，避免人工验收成为瓶颈。`all` 给高保障场景，`off` 保留旧行为（门禁通过即 done）。
- **成本口径**：一次验收 = 一个 qa 成员收到一条批量消息（N 个待验任务合并为一条，不逐个刷屏）+ 每个任务一次结论动作；review 期间写域保持占用、下游保持 blocked，**代价是串行度下降**，换来的是「验收的就是这一版代码」。
- **边界**：review 非终态；出路只有 pass→done、fail→rework、cancel/skip。review 态禁止门禁重入（重跑只刷新证据，改变不了「等验收」）。

## 3. 变异矩阵（3/3 全部变红，逐字节还原）

脚本：`/tmp/r46-mutation.sh`（备份 → 改一处 → `node --test test/r46-review-gate.test.ts` → 还原 → sha256 比对）。

| 变异 | 变异点 | 期望 | 实测变红用例 | 还原 |
|---|---|---|---|---|
| M1 门禁后一律 done（跳过 review） | `src/host/bridge.ts:3064` 改为 `const reviewRequired = false` | ②（及 ①b 的策略接入）红 | ①b、②（7 pass / 2 fail） | ✓ sha256 前后同为 `6e8005f0…3828` |
| M2 去掉作者校验 | `src/host/bridge.ts:3182` 改为 `if (false && callerIsAuthor)` | ⑤ 红 | ⑤（8 pass / 1 fail） | ✓ sha256 前后同为 `6e8005f0…3828` |
| M3 review 也算依赖满足 | `src/host/plan/graph.ts:117` 加 `|| status === 'review'` | ②/④ 红 | ②、④（7 pass / 2 fail） | ✓ sha256 前后同为 `bb685714…6aad` |

> 首轮 M3 **没有红**：原断言只查「下游状态仍 blocked / 不进 `readyTasks`」，而 `readyTasks` 先按自身状态过滤，blocked 的下游本来就不会入选，变异打不到。已就地补强为 `depSatisfied('review')===false` + 「下游被置于 pending 时也不得进入可派发集合」，重跑后 ②/④ 均红。

## 4. t2 自述「未覆盖的三条分支」的现状

| 分支 | 现状 | 覆盖用例 |
|---|---|---|
| 自评拦截（不能验自己写的任务） | **已覆盖（bridge 层）** | ⑤：带 caller 的 `reviewTask` 被 `BAD_REQUEST` 拒、不落 review、落盘不变 |
| 召集幂等（同一批只发一条） | **已覆盖** | ⑧：同批重复/换序 → `COOLDOWN`，发送数、成员数、账本数均不增；复用 qa 成员不新建 |
| 成员路径（成员经 `auto_team_review` 工具下结论） | **未走通（未覆盖）** | 无。`src/host/tools.ts:919` 的工具入口、`memberSelfServiceOf` 身份解析、以及「成员动作落到 run 所属会话」这条链没有端到端用例；本文件 ⑤ 只证明 bridge 的 caller 校验本身正确。已列入 §6 未验证项 |

## 5. 已知取舍（必须记录）

**召集幂等记录是进程内 Map（`reviewConveneRecord`），不落盘**（`src/host/team/dispatch.ts:1432` 附近）。后果：宿主重启后，同一批待验任务**最多再重发一次**召集消息（账本里会多一条队长→QA 记录）；任务状态与结论不受影响（召集只发言、不改状态）。这是与 auto-dispatch「状态刻意不落盘」一致的取舍，不是缺陷；若要跨重启严格幂等，需要把签名写进 `RunState`（store.ts 不在 t4 写域）。

## 6. 未验证项（全绿也不等于真机行为）

1. **真机面板渲染**：review 徽标「待验收」、设置页 `reviewPolicy` 三选一、任务展开区「验收：pass/fail · 理由摘要」只在源码层验证，未在宿主真机点开确认。
2. **真实宿主会话里的成员路径**：qa 成员收到召集消息后，经 `auto_team_review` 工具（而非面板动作）给出结论的端到端未跑；身份解析（`memberSelfServiceOf`）与「成员会话 ≠ run sessionId」的映射未在真宿主验证。
3. **跨 run 并发**：同一会话多 run 时 `reviewTask` 的 `runId` 收口、召集记录按 `runId` 隔离，仅按代码口径审查，无用例。
4. **长时门禁与超时**：review 分支本身不跑门禁，但 `gateTimeoutMs` 对 review 路径的影响未测。
5. **自动召集的真实 spawn**：单测注入假 `spawn`，未验证真实宿主 `spawnTeammate` 的命名冲突/路由审计与 qa 角色提示词。

## 7. 门禁证据

命令：`pnpm typecheck && pnpm test && pnpm build`（末三行 tests/pass/fail 与 lib 体积）

```
```
> tsc --noEmit            # exit 0
ℹ tests 1343
ℹ pass 1343
ℹ fail 0
ℹ lib/client.js  630.13 kB │ gzip: 156.84 kB
ℹ lib/index.js   692.19 kB │ gzip: 227.23 kB
✔ Build complete
```
```

- 双 import（exit 0，均输出 `OK`）：`node --input-type=module -e "await import('./lib/index.js')"` / `...('./lib/client.js')`。
- lib 体积与 sha256（本次构建字节）：
  - `lib/index.js` 692193 B · `c042299b88e0189c020cb626b32c5ae78a61314be2aa5a2c1697e280af89342c`
  - `lib/client.js` 630135 B · `c13fbbf92ba61a5bee6e3c087ca15ec2f8ebd5f73e8743ab18fa746a7f5d0eee`
- 产物冒烟：`grep -c reviewTask lib/index.js` = 3、`grep -c 待验收 lib/client.js` = 9（review 分支与徽标文案确实进了构建产物）。

## 8. 缺陷与建议

- **缺陷（已在本轮修掉，属测试断言缺陷而非产品缺陷）**：M3 首轮未变红（见 §3 说明）—— 已补强。
- **建议修改**：
  1. 把召集签名落进 `RunState`（或至少 `reviewConvene` 字段），消除重启后重复召集；否则请在 PRD 里把它写成显式取舍。
  2. 给 `auto_team_review` 增加成员路径单测（复用 `tools.ts` 的 `buildToolSpecs` + 假 `memberSelfServiceOf` 上下文），否则「成员能自助验收」只有类型与代码审查背书。
- **可接受**：
  1. `needsReviewOf` 只按 `src/` 前缀判定，`scripts/`、`test/`、`package.json` 等改动默认不验收 —— 与默认策略的成本口径一致，写进文档即可。
  2. review 期间写域占用导致下游等待时间变长 —— 这是「验收的就是这一版代码」的必要代价。

## 9. 复验命令

```bash
cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
node --test test/r46-review-gate.test.ts        # 9/9
bash /tmp/r46-mutation.sh                        # M1/M2/M3 均应红，且 sha256 还原一致
pnpm typecheck && pnpm test && pnpm build
```
