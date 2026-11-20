# QA 报告 · r57 任务页跨 run 跳转 + 同会话多 run 并行派发

- 需求：t3（run-mwfuqj8-zoe）
- 日期：2026-11-20
- 范围：**只写测试与本文档，不改 src/**（t4 负责撤销 supersede 实现）
- 本轮新增：
  - `test/r57-run-scoped-jump.test.ts`（8 例）
  - `test/r57-parallel-runs.test.ts`（2 例）
- 需求变更（队长裁决，用户 2026-11-20 指出 t2 的 supersede 方案是错的）：新建计划**不再收口**旧 run，新旧计划并行、任务没完成就都继续跑。故不写 supersede 测试，改钉「tick 对同会话每个非终态 run 都派发」。

## 1. 结论

**QA 通过（本卡范围）**：两处回归均已落地为可执行断言，三条变异全部按预期变红并按字节还原；收尾门禁 `pnpm typecheck && pnpm test && pnpm build` 全绿（退出码 0）。

**遗留缺口（不在本卡范围，见 §6）**：经 `auto_team_plan` 的真实入口目前仍会把同会话旧 run 收口（t2 的 `supersedeOpenRuns`，待 t4 撤销）；本卡只在 store 层证明自动派发 tick 侧已能并行。

## 2. AC → 判定 → 证据

| # | 验收标准 | 判定（测试/断言） | 结果 |
|---|---|---|---|
| AC-1 | 切到「非当前 run」时，角色卡/任务行/流程节点拿到的 members 取自**该 run 自己的** `detail.members`，不是空数组 | `r57-run-scoped-jump` 第 1 例：真实执行 `TasksTab`，断言 RoleGrid / TaskOverview / FlowCanvas 三处 props.members 的 memberId 均为 `['m-old-1']` | ✅ |
| AC-2 | 旧 run 未收口（还在 dispatching）时 `closedRun=false`，不得显示「该运行已结束，子智能体会话已回收」 | 第 2 例：三处 props.closedRun 均 `false`；第 5 例进一步断言无成员时原因逐字是「未派发」而非「已结束」 | ✅ |
| AC-3 | 旧 run 真收口（terminated + finishedAt）后才变 closed 文案 | 第 3 例：三处 closedRun=true；第 6 例：`memberJumpOf` 三入口原因逐字 === `MEMBER_JUMP_CLOSED_RUN_REASON` | ✅ |
| AC-4 | 三处入口按该 run 的真实成员判 available | 第 4 例：真实 `memberJumpOf` 三入口（role/task/node）available=true 且 memberId 指向旧 run 成员 | ✅ |
| AC-5 | 宿主没给 members 时保持「未派发」原因，不伪造成员、不借用当前 run 成员 | 第 5 例：三入口 members=[]（不是快照里别人的 m-cur），原因是 `MEMBER_JUMP_NO_MEMBER_ROLE_REASON` / `MEMBER_JUMP_NO_MEMBER_REASON` | ✅ |
| AC-6 | 同会话两个非终态 run 时，自动派发 tick 对**两个 run 都**尝试派发（不是只派最新），A 不被改成 terminated | `r57-parallel-runs` 第 1 例：真 `RunsStore` + 真 `dispatchReady`；报告 2 条且都 attempted=true；started 分别为 ['t-a']/['t-b']；spawned 含两条任务；重载 run-a：plan.status 仍 dispatching、termination/finishedAt 均 undefined、t-a 为 running 且无 cancelledBy | ✅ |
| AC-7 | 不得为绿放宽成恒真 | 逐条变异验证（§4），三条都能打红 | ✅ |

补充守卫（防改坏当前 run 路径）：

- 第 7 例：`detailRunId=null` 时仍取快照 members（`['m-cur']`）且 closedRun=false。
- 第 8 例：切到旧 run 时 run 行同时列出当前 run + 旧 run，selectedRunId=OLD（切换入口存在且是旧 run 自己的选中态）。
- `r57-parallel-runs` 第 2 例：第二拍 tick 不重复起人（幂等）。

## 3. 门禁证据（实际执行）

| 命令 | 退出码 | 输出尾部 |
|---|---|---|
| `pnpm typecheck` | 0 | `tsc --noEmit` 无输出 |
| `node --test test/r57-run-scoped-jump.test.ts test/r57-parallel-runs.test.ts` | 0 | `ℹ tests 10` / `ℹ pass 10` / `ℹ fail 0` |
| `pnpm test` | 0 | `ℹ tests 1453` / `ℹ pass 1453` / `ℹ fail 0` |
| `pnpm build` | 0 | `lib/index.js 709.55 kB` / `✔ Build complete in 49ms`（client 在前、host 在后） |
| `node --input-type=module -e "await import('./lib/index.js')"` | 0 | `HOST_IMPORT_OK` |
| `node --input-type=module -e "await import('./lib/client.js')"` | 0 | 无输出（`window.__ModuleLoader__` 守卫生效） |

复验命令（逐字）：

```bash
pnpm typecheck && node --test test/r57-run-scoped-jump.test.ts test/r57-parallel-runs.test.ts
pnpm test
pnpm build
```

## 4. 变异记录（断言真的会红）

每条变异都临时改源码 → 跑目标用例 → 按字节备份 `cp` 还原 → `cmp` 校验一致；全程未用 `git checkout`（工作树里有其它 run 的未提交改动）。

| 变异 | 改动 | 期望变红 | 实测 |
|---|---|---|---|
| M1：members 改回空数组 | `TasksTab.tsx`：`historicalRunId === null && snapshot !== undefined ? snapshot.members : []`（旧实现） | 第 1 例 | ✅ 红（pass 7 / fail 1），还原后 `cmp` 一致 |
| M2：closedRun 一律算已结束 | `TasksTab.tsx`：`historicalRunId !== null \|\| (snapshot !== undefined && isClosedRun(...))` | 第 2 例（且第 5 例连带红） | ✅ 红（pass 6 / fail 2），还原后 `cmp` 一致 |
| M3：tick 只派最新 run | `auto-dispatch.ts`：`summaries = summaries.slice(0, 1)` | 两例全红（run-a 缺席报告、spawned 缺 t-a） | ✅ 红（pass 0 / fail 2），还原后 `cmp` 一致 |

结论：三条断言都不是恒真；把实现改回错误版本一定会红。

## 5. 无关注释（并发工作树）

- 本卡执行期间另一 run 正在改角色卡语义（`src/client/viewmodel.ts`、`src/client/views/RoleCard.tsx`、`test/r33/r47/r50/run-switcher`、`test/r58-role-card-latest.test.ts`、`docs/teamflow/2026-11-20-r58-role-card-latest/`）。
- 因此 `r57-run-scoped-jump` 刻意把 RoleGrid/TaskOverview/FlowCanvas 打成**字符串 type 的桩**，只断言 TasksTab 交给它们的 props（接线证据），判定证据用真实 `memberJumpOf`（role/task/node）在**同一份 detail.members** 上算 available——避免依赖另一 run 正在改的子组件内部实现。
- 全量 `pnpm test` 本次跑出 1453/1453 全绿，**没有出现无关红**；若后续并发窗口内出现 roleCardJumpOf 相关红，先 `sleep 20` 重跑并与本卡断言对照（本卡两文件不依赖角色卡多人语义）。

## 6. 未验证项（不得用「构建通过」代替）

1. **真机 UI 点击**：本次验证到「组件 props 接线 + 判定函数」层；真实 Electron 客户端里点击三个入口、`jumpToMemberSession` 调宿主会话服务切页签的端到端行为未做真机验证。
2. **经 `auto_team_plan` 的并行 run 端到端**：`src/host/tools.ts:569-615` 的 `supersedeOpenRuns`（调用点 `tools.ts:785`）在新建计划后仍把同会话其它非终态 run 收口（`plan.status='terminated'`、`termination.kind='superseded'`，`store.ts:302` 还会把残留任务标 `cancelledBy:'stale'`）。本卡测试在 store 层直接放两个 run，证明的是 **tick 侧已支持并行**；工具入口要等 t4 撤销 supersede 后才通。t4 落地后建议补一条「连续两次 auto_team_plan，第一条 run 仍 dispatching」的端到端用例。
3. **宿主 HTTP 投影真机验证**：`GET /api/auto-team` 返回的 `RunDetailView.members` 未在真机 curl 复核（r54 已有宿主投影测试；本卡消费的是同一契约字段）。
4. **异常原因分支**：本卡的并行派发用例走正常路径（角色存在、并发充足，started 非空）；「角色缺失 / 并发满 → attempted=true 但 started 为空 + 明确 reason」的分支未在本卡单独覆盖（`auto-dispatch.test.ts` 已覆盖 skipped 语义）。

## 7. 缺陷

范围内无缺陷（两处修复均以可执行断言钉死，三条变异均红）。缺口见 §6.2/§6.1，均属其它任务卡或真机验证范畴。
