# r25 已收口 run 不再显示为进行中（任务随计划终结）— QA 报告

- 任务：t3（QA 回归 + 全量门禁 + 真实数据副本验证），前置 t1 宿主侧、t2 面板侧（均已过门禁）
- 日期：2026-11-12
- 工作区：`/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team`
- 结论：**通过**。新增 10 例 r25 回归（全过、0 skip），4 项变异均「改回错误实现必变红」；两个真实残留 run 的 `/tmp` 副本经修正后 `ongoing=0`、`active=false`、残留任务全部 `cancelled` 且原因可读，二次修正零写盘；全量门禁 `pnpm typecheck && pnpm test && pnpm build` 退出码 0（**1107 例全过**），`lib` 双产物为本次构建且 `node import` 均成功。
- 另有 2 项观察（O-1 列表口径与客户端兜底不对称、O-2 历史列表 5s memo 写后不失效）与 6 项真机未验证项，见 §6/§8。

## 1. 根因

`store.list()` 的 `ongoing`/`active` 原来**只看任务状态**，不看计划是否已经收口：

```ts
// src/host/store.ts:504-525
const planClosed = PLAN_TERMINAL_STATUSES.has(plan.status)
const ongoing = planClosed ? 0 : plan.tasks.filter((task) => !SUMMARY_TERMINAL_STATUSES.has(task.status)).length
...
active: planClosed ? false : ongoing > 0,
```

r24 收口只改了 `plan.status/finishedAt/termination`，`plan.tasks` 里还留着 `running`/`rework` 的假活任务。于是「计划已 terminated、任务仍 running」的旧数据被算成 `ongoing>0`，顶部 run 卡与历史列表继续显示为进行中（能碳任务页多出一张不该存在的卡）。

r25 的修法有三层，缺一层旧数据就会复现：

1. **计数层**（`src/host/store.ts:504-525`）：计划终态 → `ongoing=0`、`active=false`，不再看任务状态。
2. **写盘层**（`src/host/store.ts:260` `cancelResidualTasks`）：`reconcileStalePlans`（:292）与 `closeRun`（`src/host/bridge.ts:2259`）在**同一次落盘**里把非终态任务改成 `{status:'cancelled', cancelledAt, cancelReason:'计划已收口：…', cancelledBy:'stale'}`。
3. **存量修正层**（`src/host/store.ts:340` `repairClosedRuns`）：bridge 装配期对已经收口但任务仍假活的 run 做一次性修正，`changed===0` 不写盘，保证幂等。

## 2. 门禁判定

命令（工作区根执行）：`pnpm typecheck && pnpm test && pnpm build`

| 门禁 | 退出码 | 证据（输出尾部，逐字） |
| --- | --- | --- |
| `pnpm typecheck` | **0** | `> tsc --noEmit`（无诊断输出） |
| `pnpm test` | **0** | `ℹ tests 1107` / `ℹ pass 1107` / `ℹ fail 0` / `ℹ skipped 0` / `ℹ cancelled 0` / `ℹ todo 0` |
| `pnpm build` | **0** | `ℹ lib/client.js  579.54 kB │ gzip: 142.97 kB` → `✔ Build complete in 34ms`；`ℹ lib/index.js  594.96 kB │ gzip: 196.93 kB` → `✔ Build complete in 47ms` |

- 全量日志：`.auto-team/artifacts/qa-r25-typecheck.log`、`qa-r25-test.log`、`qa-r25-build.log`
- 测试基线：r24 收尾 1094 例；本任务新增 r25 用例 10 例 → **1107 例**（差额 3 例为同期工作树内其它测试文件的增长，非本任务新增文件）。
- 双产物为本次构建：`lib/client.js` mtime `2026-11-12 14:22:33`、`lib/index.js` mtime `2026-11-12 14:22:34`，均为本次 `pnpm build`；sha256：
  - `5004a218a9e9a8b466c8d5dd55f4b9d563226376cf6c9cbb9733c88e1f0bcb01  lib/index.js`（594956 字节）
  - `9b5e39073c15814f933a4e46ae716022b1cdefec413af7df823080753652674e  lib/client.js`（579542 字节）
- `node --input-type=module -e "await import('./lib/index.js')"` → `HOST_IMPORT_OK`（exit 0）；
  `node --input-type=module -e "await import('./lib/client.js')"` → `CLIENT_IMPORT_OK`（exit 0）。

## 3. 验收判定对照

| # | 验收要求（任务卡 / t1·t2 交接） | 判定 | 证据 |
| --- | --- | --- | --- |
| AC-1 | `store.list()` 对 terminated/cancelled 的 run 返回 `ongoing=0`、`active=false`，残留 running/pending/rework 也不得计入；非终态 run 不受影响 | 通过 | 用例 1：terminated(running+pending)、cancelled(rework) 两种旧形状 `ongoing===0/active===false`；对照 `dispatching` run `ongoing===2/active===true`；变异 M1（`planClosed?0:` 改为恒假）实测红 |
| AC-2 | `reconcileStalePlans` 收口时**同一次 save** 把残留任务改 cancelled，四字段齐全（`cancelledAt=finishedAt`、`cancelReason='计划已收口：'+termination.reason`、`cancelledBy='stale'`）；已终态任务逐字不动 | 通过 | 用例 2：`saves===1`、`cancelledAt===closed.finishedAt`、原因前缀逐字、已 done 任务 `deepEqual` 原样；变异 M2（reconcile 只写 plan 不写 tasks）实测红 |
| AC-3 | `closeRun` 收口同样终结残留任务：`cancelledAt=now`、原因「计划已收口：用户终止残留计划」 | 通过 | 用例 4（CountingRunsStore：`saves` 只 +1、两个残留任务四字段齐全、已 done 任务不动） |
| AC-4 | `cancelResidualTasks` 是纯函数：只终结非终态任务、返回改动数、不改入参数组 | 通过 | 用例 3（原任务数组 `deepEqual` 不变；`changed` 等于残留数；全终态输入 `changed===0`） |
| AC-5 | 已收口历史 run 的一次性修正 `repairClosedRuns` 幂等：第二次零 save、文件字节不变；`finishedAt` 缺失时回退到 `taskTimes.endedAt`/最后消息 | 通过 | 用例 5（`repaired` 含该 run → 第二次 `repaired=[]`、`snapshots` 字节相等；无 `finishedAt` 的 run 用 `endedAt`）；变异 M3（`changed===0` 判断改为恒假，每次都写）实测红 |
| AC-6 | `repairClosedRuns` 单个 run 写失败只 warn、不阻断其余 run | 通过 | 用例 6（一个 store 的 `save` 抛错，另一个 run 仍被修正，`onWarn` 收到含 runId 的消息） |
| AC-7 | `taskDurationsOf`：cancelled 缺起止 → `unavailable`+`reason`（不得退回 `not-started`）；完整记录逐字不变；pending → `not-started` | 通过 | 用例 7（cancelled 无 `taskTimes` → `{state:'unavailable',text:'不可得',reason:LEGACY_TASK_TIME_REASON}`；完整记录 `1 分 00 秒`/`ms=60000`；pending → `not-started` 且无 `reason` 键） |
| AC-8 | 客户端 `activeRunRowsOf` 对「terminated/cancelled 但 `ongoing>0`」旧形状必须过滤；全部终态时回退最新一条且 `hasOngoing=false`、状态文案为「已终止」而非「进行中」 | 通过 | 用例 8（混合列表只出 `run-live`；全终态回退 `plannedAt` 最新一条、`hasOngoing===false`、`statusText==='已终止'`、`active===false`）；变异 M4（`ongoingCountOf` 去掉 `isClosedRun` 短路）实测红 |
| AC-9 | 任务行原因：`cancelledBy='stale'` 且宿主未写 `cancelReason` 时用中文兜底，英文枚举不上屏 | 通过 | 用例 9（`taskRowOf` 返回的说明含「计划已收口，任务随计划一起终结」，不含 `stale`） |
| AC-10 | 用仓库外 `/tmp` 副本验证两个真实残留 run；`run-mwd4ierq-1c61` 不读不碰；禁止改 `~/.dsh/auto-team/runs` 真实文件 | 通过 | 用例 10：见 §5；源文件字节前后一致，真实目录未被本任务写入 |
| AC-11 | 门禁 `pnpm typecheck && pnpm test && pnpm build`；lib 双产物为本次构建且双 import 成功 | 通过 | §2 |
| AC-12 | 报告含根因、AC 对照、真实数据前后对比、真机步骤 | 通过 | 本文 §1–§8 |
| AC-13 | 写域合规：只改 `test/**`、`lib/**`、`docs/teamflow/2026-11-12-r25-closed-run-cards/**` | 通过 | 新增 `test/r25-closed-run-cards.test.ts`、修改 `test/r24-stale-reconcile.test.ts` 的真实数据断言、重建 `lib/index.js`+`lib/client.js`、新增本报告；`src/**` 零净改动（变异测试临时改后已字节还原，见 §4 尾注） |

## 4. 新增用例与变异证据（断言是否真的会红）

`test/r25-closed-run-cards.test.ts`（10 例，`node --test` 单跑 10 pass / 0 fail / 0 skip）：

| # | 用例 | 关键断言 |
| --- | --- | --- |
| 1 | list() 终态不计 ongoing | terminated(running+pending)/cancelled(rework) → `ongoing=0/active=false`；dispatching 对照 `ongoing=2/active=true` |
| 2 | reconcile 一次落盘 | `saves===1`；terminated + 四字段 + 已终态任务逐字保留 |
| 3 | cancelResidualTasks 纯函数 | 只终结非终态任务；`changed` 正确；不改原数组 |
| 4 | closeRun 终结残留任务 | `saves+1`、`cancelledAt=now`、原因「计划已收口：用户终止残留计划」 |
| 5 | repairClosedRuns 修正 + 幂等 | 首次修正、二次 `[]` 且字节不变；无 `finishedAt` 回退 `endedAt` |
| 6 | repair 单 run 失败 | 只 `onWarn`，其余 run 照常修 |
| 7 | taskDurationsOf | cancelled 缺起止 unavailable+reason；完整记录逐字不变；pending not-started |
| 8 | activeRunRowsOf 旧形状 | 旧 ongoing>0 不进卡；全终态回退最新且 `hasOngoing=false`、`statusText='已终止'` |
| 9 | taskRowOf 中文兜底 | `cancelledBy='stale'` 无原因 → 中文文案，英文枚举不上屏 |
| 10 | 真实数据 `/tmp` 副本 | 见 §5；两次运行零改写、源文件字节不变 |

变异矩阵（每次只改一处，跑对应用例，随后从 `.qa-bak/` 字节还原并用 `diff` 校验）：

| 变异 | 改法 | 结果 |
| --- | --- | --- |
| M1 计数层失效 | `store.ts` `const ongoing = planClosed ? 0 :` → `planClosed` 恒假 | 用例 1 红（`exit 1`，fail 1） |
| M2 写盘层漏任务 | `reconcileStalePlans` 的 `plan` 去掉 `tasks: cancelled.tasks` | 用例 2 红（`exit 1`，fail 1） |
| M3 存量修正不幂等 | `repairClosedRuns` 的 `if (cancelled.changed === 0) continue` → `=== -1` | 用例 5 红（`exit 1`，fail 1） |
| M4 客户端不过滤 | `nav.ts` `if (isClosedRun(run)) return 0` → `if (false)` | 用例 8 红（`exit 1`，fail 1） |

> 还原校验：四个变异跑完 `src/host/store.ts` 与 `.qa-bak/store.ts`、`src/client/nav.ts` 与 `.qa-bak/nav.ts` 字节相等；`git diff --stat -- src` 只有 t1/t2 的既有改动，无 QA 净改动。

### r24 回归的语义更新（不是回归）

`test/r24-stale-reconcile.test.ts` 的真实数据用例原断言「收口只动 `status/finishedAt/termination`，`plan.tasks` 原样」与新语义直接冲突，按队长裁决（m00356）改为：

- 已终态任务（done/failed/cancelled/skipped/interrupted）`deepEqual` 逐字保留；
- 残留任务 `status='cancelled'`、`cancelledAt=closed.finishedAt`、`cancelReason='计划已收口：'+termination.reason`、`cancelledBy='stale'`；
- 去掉四个终结字段后与源任务逐字一致；`messages` 仍 `deepEqual`。

其余 r24 用例（`test/r24-history-cache.test.ts` 及 r24-stale 的另外 10 例）**未改**，本次全量跑仍全绿。

## 5. 真实残留数据验证（仓库外隔离副本）

源目录：`~/.dsh/auto-team/runs/`（只读复制，未写入）；隔离目录：`mkdtempSync(join(tmpdir(),'r25-evidence-'))`。
正在跑的 `run-mwd4ierq-1c61.json` **未读取、未复制、未断言**（本任务不把它当待修对象）。

| run | 修正前 plan / 任务 | 修正后 plan / 任务 | list() |
| --- | --- | --- | --- |
| `run-mwa9n8xf-1c61` | `terminated`、`finishedAt=1794289508191`、termination.kind=`stale`；t1 `running`、t2 `pending` | 同 plan；t1/t2 `cancelled`、`cancelledAt=1794289508191`、`cancelReason='计划已收口：计划长时间无活动且没有成员在跑，已自动收口'`、`cancelledBy='stale'` | `ongoing=0`、`active=false`、`done=0/2` |
| `run-mwa9uuow-1c61` | `terminated`、`finishedAt=1794291394249`、termination.kind=`stale`；t1 `done`、t2 `rework` | 同 plan；t1 `done` 原样、t2 `cancelled`、`cancelledAt=1794291394249`、原因同上 | `ongoing=0`、`active=false`、`done=1/2` |

- `repairClosedRuns` 第一次返回 `['run-mwa9uuow-1c61','run-mwa9n8xf-1c61']`，第二次返回 `[]`；随后 `reconcileStalePlans` 也返回 `[]`（已终态直接跳过）。
- 两次修正后目录字节快照相等（用例 10 断言）；源文件字节前后一致。
- 真实源文件当前仍是「terminated + 残留 running/rework」状态（本任务只读）：**宿主下次启动时**由装配期 `repairClosedRuns` 修正，这正是 t1 设计的存量自愈路径。

## 6. 真机预期表现与验证步骤（未执行，交由主 agent/用户）

1. 在 profile 里更新插件后**重启宿主**（装配期 `repairClosedRuns` 在首次 snapshot 之前执行）。
2. 打开能碳任务的自动团队面板 → 任务/run 页。
   - 预期：顶部 run 卡**只剩当前活跃的 `run-mwd4ierq-1c61` 一张**；`run-mwa9n8xf-1c61`、`run-mwa9uuow-1c61` 不再出现在进行中卡。
   - 历史列表里两条仍可见，状态「已终止」，任务行显示「已取消」+「计划已收口：…」原因；不再出现「进行中」徽标。
3. 刷新页面并再等 >5 秒，重复第 2 步：卡片不得回弹（幂等）。
4. 若历史列表 5 秒内仍显示旧 ongoing：属 O-2（`historyMemo` 写后不失效，r24 已转 t4），不是本次修正失败；以刷新后为准。

## 7. 观察项（不阻塞本轮判定）

- **O-1 口径不对称**：`store.list()` 只按 `plan.status` 判终态，而客户端 `isClosedRun` 还认「`terminationReason` + `finishedAt`」双事实。极少见的 `draft`+`termination`+`finishedAt` 旧数据会在列表里 `ongoing>0`，但客户端卡仍会过滤掉。当前真实数据均为 `status='terminated'`，不触发；建议后续统一到 `isClosedRun` 口径。
- **O-2 历史列表 5s memo**：`src/host/bridge.ts:1615-1629` 的 `historyMemo` 写后不失效，`closeRun`/repair 写盘后 5 秒内历史列表可能仍显示旧 `ongoing`。r24 已登记由 t4 跟踪，本任务不扩写域。
- **O-3 `cancelled` 不计入 `done`**：`run-mwa9n8xf` 修正后 `done=0/2`（两个任务都是 cancelled）。这是「cancelled 不是 done」的既有口径，不是回归；若产品希望显示「已终结 2/2」需另立需求。

## 8. 未验证项（全绿不等于真机全部成立）

- **U-1** 真机重启后的装配期自愈未执行：QA 只能在单测里复现 `repairClosedRuns`，真实宿主重启影响需主 agent 按 §6 验证。
- **U-2** 「终止计划」按钮端到端未真机点击：单测覆盖到 bridge 的 `closeRun` 响应，HTTP 路由 + 面板按钮 + confirm 对话框的真实链路未点。
- **U-3** 真实 `~/.dsh/auto-team/runs` 两个文件**仍未被修正**（只读验证）；若宿主不重启，它们会继续以「terminated + 残留任务」存在于磁盘（列表/卡片因计数层已修而正确）。
- **U-4** 320px 面板宽度下的横向溢出未复测（t2 的视觉验收项，QA 只断言数据/文案层）。
- **U-5** 旧 run 卡片在真实面板里的徽标/原因文案未截图比对；仅 `viewmodel` 单测断言。
- **U-6** `run-mwd4ierq-1c61` 未做任何读取/校验（按任务卡要求回避），其正常显示回归不在本报告范围。

## 9. 改动清单与写域合规

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `test/r25-closed-run-cards.test.ts` | 新增（755 行） | 10 例 r25 回归 + 变异靶点 |
| `test/r24-stale-reconcile.test.ts` | 修改 | 仅真实数据用例的任务断言改为 r25 新语义；其余 10 例未动 |
| `lib/index.js`、`lib/client.js` | 重建 | 本次 `pnpm build` 双产物，sha256/体积见 §2 |
| `docs/teamflow/2026-11-12-r25-closed-run-cards/QA-REPORT.md` | 新增 | 本报告 |

- 未改 `src/**`（变异测试临时改后已字节还原）；未改 `~/.dsh/auto-team/runs/**`；未读 `run-mwd4ierq-1c61.json`。
- 变异临时备份目录 `.qa-bak/` 仅存在于工作树，未入库（可删）。
