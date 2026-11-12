# r26 计划阶段判定 — QA 报告

- 需求：阶段判定表全表用例 + `draft` 守卫 + 宿主计数/派发推进回归 + 全量门禁
- 任务：t3（QA），前置 t1（宿主侧）、t2（面板侧）已完成并通过 typecheck
- 日期：2026-11-12
- 结论：**通过**。判定表 11 条分支、优先级、四类 `draft` 守卫、宿主计数派生、两条派发推进路径、历史/当前同构均已落测；三项门禁全绿（1115 例 / 0 失败）；`lib/` 双产物为本次构建且可被 node import。
- 证据日志：`.auto-team/artifacts/qa-t3-r26-final.log`（typecheck / test / build 的完整输出与退出码）

## 1. 歧义复现（r26 要修的真实问题）

改造前，客户端把 `planStatus === 'draft'` 直接渲染成「计划就绪」。于是下面四种真实状态都会被说成「计划就绪」：

| 输入 | 改造前（错误表现） | 改造后（r26） |
|---|---|---|
| `draft` + `total:3` + `running:2` | 计划就绪 · 3 任务 | 执行中 · 0/3 |
| `draft` + `total:3` + `done:3` | 计划就绪 · 3 任务 | 待收口（`done===total` 且未收口） |
| `draft` + `total:3` + `failed:1` | 计划就绪 · 3 任务 | 有失败 · 1 |
| `draft` + `total:3` + `members:2` | 计划就绪 · 3 任务 | 派发中 · 0/3 |

歧义根因：`draft` 同时承载「刚建好、零成员、零完成」与「派发过但成员全挂 / 全部跳过」两种语义，只凭 `planStatus` 无法区分。r26 的口径是：**「计划就绪」只能由规则 10 产出**（`total>0 && members===0 && done===0`），任何计数把状态推向别的阶段时，`draft` 都不得压过它们。

同时修复了一个相关误报：旧 `RunSummary` 没有 `running/failed/interrupted/members` 字段时，**不补 0**、按最保守分支回落「待派发」，避免把「未知」当成「零成员」而误报就绪。

## 2. 判定表（11 条，先命中先返回）

实现：`src/client/viewmodel.ts:909-1020` `runStageOf`。全部 11 条在 `test/r26-plan-stage.test.ts:130` 的「11 条分支逐条命中」用例里逐字断言（key / label / tone / detail，11 个 key 去重）。

| # | 条件 | key | label | tone |
|---|---|---|---|---|
| 1 | `planStatus` 缺省 | `disabled` | 未启用 | muted |
| 2 | `cancelled` | `cancelled` | 已取消（detail=终止原因或默认文案） | muted |
| 3 | `terminated` | `terminated` | 已终止（detail=终止原因或默认文案） | muted |
| 4 | `paused` | `paused` | 已暂停 | warn |
| 5 | `failed > 0` | `failed` | 有失败 · N | bad |
| 6 | `interrupted > 0` | `interrupted` | 已中断 · N | bad |
| 7 | `running > 0` | `running` | 执行中 · done/total（无 total 时裸「执行中」） | ok |
| 8 | `total>0 && done===total && !closed` | `closing` | 待收口 | warn |
| 9 | `planStatus==='dispatching' \|\| members>0` | `dispatching` | 派发中 · done/total（无 total 时裸「派发中」） | ok |
| 10 | `total>0 && members===0 && done===0` | `ready` | 计划就绪 · N 任务 | ok |
| 11 | 其余 | `pending` | 待派发 | muted |

优先级用例（`test/r26-plan-stage.test.ts:165`）显式覆盖：`failed>0` 与 `running>0` 同时存在必须返回「有失败」（而不是「执行中」）；`interrupted` 压 `running`；`failed` 压 `interrupted`；`terminated/cancelled/paused` 压过所有计数；`running` 压 `closing`；`closing` 压 `dispatching`；已收口（有 termination 且有 finishedAt）不再进 `closing`。

### 2.1 `draft` 四类守卫（硬要求）

`test/r26-plan-stage.test.ts:196` 逐条断言：只要输入里有任一「非空活动」，结果就不得是 `ready`：

| 输入（均为 `planStatus:'draft'`, `total:3`） | 期望 |
|---|---|
| `running:2` | 非「计划就绪」（执行中） |
| `done:3` | 非「计划就绪」（待收口） |
| `failed:1` | 非「计划就绪」（有失败） |
| `members:1` | 非「计划就绪」（派发中） |
| 显式 `running:0,failed:0,interrupted:0,members:0,done:0` | **计划就绪 · 3 任务**（唯一合法来源） |
| 只给 `planStatus:'draft',total:3`（计数缺席） | 待派发 |

最后一行是关键回归：`members === 0` 用严格比较，`undefined` 不等于 0，所以缺计数时不会误判就绪；这也是 M2 变异（把条件放宽成 `members === undefined || members === 0`）能变红的原因。

## 3. 宿主侧回归

### 3.1 计数派生（`test/r26-plan-stage.test.ts:222`）

构造真实 `RunState`：`t1 running`、`t2 gate`、`t3 failed`、`t4 interrupted`、`t5 done`、`t6 pending`；bindings 三条（`m1` active、`m2` retired、`m3` active）。断言：

- `snapshot.runCounts` 深等于 `{ running: 2, failed: 1, interrupted: 1, members: 2 }`（`gate` 计入 running；retired 不计成员）；
- `snapshot.runs[0]` 同样带四项计数且 `done/tasks` 正确；
- `store.list()` 的 summary 上四个键 `hasOwnProperty === false` 且值为 `undefined`（缺失就是缺失，不补 0）。

### 3.2 `advancePlanToDispatching`（`src/host/store.ts:222`）

纯函数断言：`draft → dispatching` 且 `tasks` 与入参对象都不被修改；`dispatching / paused / terminated / cancelled → null`（只进不退，天然幂等）。

### 3.3 bridge dispatch 接线（`test/r26-plan-stage.test.ts:283`）

用可变 `dispatch` 端口驱动 `createBridge` 真实的 `case 'dispatch'`：

- 成功：`accepted.rejected === undefined`、plan 变 `dispatching`、`store.writeEpoch()` 增加 1（只有推进那一次写盘）；
- 二次派发：仍 `dispatching`、`writeEpoch()` 不再变化（幂等，无重复写盘）；
- 全部失败：`rejected.code === 'BAD_REQUEST'`、plan 保持 `draft`、`writeEpoch()` 不变。

### 3.4 auto-dispatch 接线（`test/r26-plan-stage.test.ts:337`）

`createAutoDispatcher(...).tick()`：

- 成功：`reports[0].started === ['t1']`、plan 变 `dispatching`、二次 tick 仍会尝试但 `writeEpoch()` 不变；
- 全部失败：`reports[0].failed === 1`、`errors[0]` 匹配 `/t1：boom/`、reason 匹配 `/全部失败/`、plan 保持 `draft`、`writeEpoch()` 不变；结束时 `dispose()`。

两处接线都只在 `outcome.started.length > 0` / `started.length > 0` 时推进（`src/host/bridge.ts:2246`、`src/host/team/auto-dispatch.ts:215`），M4/M5 变异各把条件改成 `if (true)` 都会让对应用例变红。

### 3.5 历史 run 与当前 run 同构（`test/r26-plan-stage.test.ts:390`）

同一份输入分别喂给 `runStageOf`（当前 run 快照路径）与 `runSummaryRowOf`（历史列表行路径），断言两边阶段视图**逐字深相等**（含 `key/label/tone/detail`），且 `statusText === label`。覆盖两个场景：`dispatching + running + failed + pending`（key `failed`）与零计数 `draft`（计划就绪 · 2 任务）。

## 4. 客户端展示面与过期断言更新

### 4.1 `test/client-ui.test.ts` 三处过期断言（队长点名）

| 位置 | 旧期望（编码旧行为） | 新期望 / 处理 |
|---|---|---|
| `:166` | `optionView({planStatus:'draft',done:0,total:3})` → 「计划就绪 · 3 任务」 | 补 `running/failed/interrupted/members = 0`，继续期望「计划就绪 · 3 任务」（守住规则 10） |
| `:172-173`（新增） | — | 不传四项计数 → 「待派发」，并带消息「缺计数时绝不能说「计划就绪」」 |
| `:394` | `runSummaryRowOf(dispatching)` → 裸「派发中」 | 「派发中 · 2/3」（规则 9 带进度） |
| `:804` | 端到端「启用后计划就绪」未传计数 | 步骤输入补四项 0，期望「已启用，计划就绪 · 2 任务」 |

改后单文件：**44 pass / 0 fail**。原有「写盘在飞」等条目同样补了四项 0，避免假红。

### 4.2 `planPillText` 已统一走 `runStageOf`

`src/client/ui.ts:481-511`：`planPillText(input)` 先 `runStageOf(input)`，暂停/终止/取消直接取 `stage.label`，全完成取 `完成 done/total`，其余取 `stage.label`。输入类型 `PlanPillInput = Pick<RunStageInput, 'planStatus'|'done'|'total'|'running'|'failed'|'interrupted'|'members'>`。

### 4.3 grep 佐证：客户端没有第二处「计划就绪」字面量

```bash
grep -rn "计划就绪" src/client
```

命中分三类：

- **判定表**：`src/client/viewmodel.ts:1006`（规则 10 的唯一标签）、`src/client/viewmodel.ts:780`（`PLAN_STATUS_LABELS.draft`，legacy 计划状态辅助表，保留）；
- **注释**（不参与渲染）：`src/client/nav.ts:313`；`src/client/viewmodel.ts:55/:505/:519/:544/:836/:905/:907/:1002`；`src/client/ui.ts:47/:84/:497/:499/:500`；
- **无其他代码字面量**：`ui.ts` 的命中全在上述注释行，代码路径只消费 `runStageOf(...).label`。

宿主侧另有文案 `src/host/bridge.ts:1112`（`计划就绪：N 个任务（尚未创建成员）`），属宿主提示语、不在客户端展示面，本次不改。

补充核查（避免 legacy 表被误用）：

- `planStatusBadge`（`src/client/viewmodel.ts:822`）仍以 `planStatusView` 为文案源，但 `grep -rn "planStatusBadge(" src/client` 除定义行外 **0 处调用**（死导出，无展示路径）。
- `runHeadOf`（`src/client/viewmodel.ts:1554`）保留「不传 stage 时回落原始计划状态」的兼容分支；唯一调用方 `src/client/views/RunHeader.tsx:37` 传入 `stage`，而 `src/client/tabs/TasksTab.tsx:78-86` 用 `stageOfDetail(...)`（与卡片/历史行同源）计算该 `stage`，并在 `stage` 为 `undefined` 时（`detail === null`）不渲染 run 头内容。故 run 头不会绕过判定表。

## 5. 变异矩阵（断言有效性证据）

变异脚本：读原文 → 单点改写 → `node --test test/r26-plan-stage.test.ts` → 回写原文 → 校验 `bytes_equal:true`。5/5 全部按预期变红：

| # | 变异 | 红掉的用例 |
|---|---|---|
| M1 | `viewmodel.ts` failed 分支前加 `false &&` | 11 条分支、优先级、draft 四类守卫、历史/当前同构 |
| M2 | ready 条件放宽为 `(members === undefined \|\| members === 0)` | 「旧 RunSummary 缺计数时保守回落，不得把 undefined 当 0 断言「计划就绪」」 |
| M3 | `runStageCountsOf` 去掉 `\|\| task.status === 'gate'` | 「snapshot.runs 与 runCounts 从真实 RunState 派生四项计数」 |
| M4 | bridge 推进条件改 `if (true)` | 「bridge dispatch：成功才 draft→dispatching；失败保持 draft；二次派发不再写盘」 |
| M5 | auto-dispatch 推进条件改 `if (true)` | 「auto-dispatch：仅在 started>0 时推进；全失败保持 draft；幂等不重复写盘」 |

每次变异后均从原文回写并校验字节相等，工作树里的 `src/**` 未被测试污染。

## 6. 全量门禁证据

命令与日志：`.auto-team/artifacts/qa-t3-r26-final.log`

| 门禁 | 退出码 | 关键输出 |
|---|---|---|
| `pnpm typecheck` | 0 | `tsc --noEmit` 无输出 |
| `pnpm test` | 0 | tests **1115** / pass **1115** / fail **0** / skipped 0 / todo 0（r25 基线 1107，新增 8 例） |
| `pnpm build` | 0 | `lib/client.js 587.58 kB`、`lib/index.js 597.27 kB` |

`lib/` 本次构建产物（mtime 2026-11-12 14:53:08/09）：

| 文件 | 字节 | sha256 |
|---|---|---|
| `lib/index.js` | 597266 | `7780d68ab7e3321bf5b85433569a31853e8f7b2ff4b8743ed48ccb7f612a31ea` |
| `lib/client.js` | 587577 | `3babba61035bd9b1990bd83f737730ce837fa805b23127d4feed5edd60970fa3` |

双产物 import：

```text
node --input-type=module -e "await import('./lib/index.js')"  → INDEX_IMPORT_OK
node --input-type=module -e "await import('./lib/client.js')"  → CLIENT_IMPORT_OK
```

## 7. 真机验证步骤（重启宿主后）

1. 安装/更新 profile：`cd ~/.dsh/profiles/desktop && pnpm add file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team`（仅主 agent 执行）。
2. 重启宿主（或重载插件 entry），打开自动团队面板。
3. 新建一个计划（`draft`、有任务、未派发）→ 顶部胶囊应显示「计划就绪 · N 任务」；鼠标悬停无异常。
4. 点「派发」让至少一个成员成功创建 → 胶囊/历史行应立刻变「派发中 · done/total」，刷新后保持（`draft → dispatching` 已落盘）。
5. 断开或让派发全部失败再点派发 → 计划不得变成「派发中」（保持「计划就绪 / 待派发」，按计数），再次派发仍可尝试。
6. 打开历史列表：任选一条旧 run（`RunSummary` 可能缺四项计数）→ 行徽标应为保守的「待派发/执行中」等，不得误报「计划就绪」；有 `failed` 的旧 run 应显示「有失败 · N」。
7. 320px 宽面板下检查详情页/历史行无横向溢出、文案不换行错位（沿用宿主 token）。

## 8. 未验证项

- **U-1 真机渲染**：上述第 3–7 步未在重启后的宿主 + 浏览器里实际执行（本任务只跑单测/构建；GUI 验证需主 agent 走 `REAL-HOST-VERIFY.md` 的克隆 profile 流程）。
- **U-2 真实 spawn**：dispatch 推进用例用注入口代替真实 `spawnTeammate`；真实宿主的成员创建耗时/失败码未覆盖（t1 的验收范围）。
- **U-3 并发上限**：`maxConcurrent` 排队时的阶段文案（仍应显示「派发中 · done/total」）未单独构造用例。
- **U-4 迁移面**：仅覆盖 `RunSummary` 缺计数（`undefined`），未覆盖 `null`/字符串等脏数据的运行时兜底。
- **U-5 历史列表分页**：`historyOf` 的 `HISTORY_PAGE_SIZE` 截断与计数派生组合未覆盖（沿用 r24/r25 既有用例）。

## 9. 变更文件（写域内）

- 新增 `test/r26-plan-stage.test.ts`（8 例，449 行）
- 修改 `test/client-ui.test.ts`（三处过期断言 + 一条「缺计数→待派发」反面用例）
- 构建产物 `lib/index.js`、`lib/client.js`（本次 build 重写）
- 本报告

未改动 `src/**`（变异已全部回写，`git diff --stat` 与测试前一致）；r24/r25 既有测试全部保持绿色。
