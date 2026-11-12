# r24 残留计划收口（自动对账 + 手动终止 + 用时语义）— QA 报告

- 任务：t3（QA 回归与门禁），前置 t1 宿主侧、t2 面板侧（均已过门禁）
- 日期：2026-11-11
- 工作区：`/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team`
- 结论：**通过**。新增 11 例回归（全过、0 skip），4 项变异均「改回错误实现必变红」；用仓库外 `/tmp` 副本把两个真实残留 run 收口，`finishedAt` 精确等于最后活动时刻且二次运行零改写；三项门禁 `pnpm typecheck && pnpm test && pnpm build` 退出码 0（**1094 例全过**），`lib` 双产物为本次构建且 `node import` 均成功。
- 仍存 2 项观察（O-1 注释与实现不一致、O-2 历史列表 5s memo 由 t4 跟踪）与 5 项真机未验证项，见 §6/§8。

## 1. 门禁判定

命令（工作区根执行）：`pnpm typecheck && pnpm test && pnpm build`

| 门禁 | 退出码 | 证据（输出尾部，逐字） |
| --- | --- | --- |
| `pnpm typecheck` | **0** | `> tsc --noEmit`（无诊断输出） |
| `pnpm test` | **0** | `ℹ tests 1094` / `ℹ pass 1094` / `ℹ fail 0` / `ℹ skipped 0` / `ℹ cancelled 0` / `ℹ todo 0` |
| `pnpm build` | **0** | `ℹ lib/client.js  576.84 kB │ gzip: 142.00 kB` → `✔ Build complete in 33ms`；`ℹ lib/index.js  589.97 kB │ gzip: 195.16 kB` → `✔ Build complete in 75ms` |

- 全量日志：`.auto-team/artifacts/qa-t3-final.log`（含三段退出码与 sha256）
- 测试基线：r23 报告收尾 1083 例；本任务新增 11 例 → **1094 例**（无 skip，真实数据用例实跑）。
- 双产物为本次构建：`lib/index.js`、`lib/client.js` 的 mtime 均为 `2026-11-11 10:48:12`（本次 `pnpm build`），sha256：
  - `f65fa82ea2d43af663e7dcc9a60d13ccb3fee53fbbcb4caa70dddc73b8e615ef  lib/index.js`
  - `6aab8e1f9a3685adca613eea25ae982d1c51fba6b8133b87c8f6baabe07cdbd2  lib/client.js`
- `node --input-type=module -e "await import('./lib/index.js')"` → `HOST_IMPORT_OK`（exit 0）；
  `node --input-type=module -e "await import('./lib/client.js')"` → `CLIENT_IMPORT_OK`（exit 0）。
- 产物含本次新逻辑（`grep -c`）：`lib/index.js` 含 `计划长时间无活动且没有成员在跑，已自动收口` ×1、`用户终止残留计划` ×1、`该 run 完成于任务起止记录上线前` ×1；`lib/client.js` 含 `未收口·可能残留` ×3（run 行徽标文案）。

> 说明：t4（historyOf 缓存写后失效）在计划中另行跟踪，不在本任务写域；见 O-2。

## 2. 验收判定对照

| # | 验收要求（任务卡 / t1·t2 交接） | 判定 | 证据 |
| --- | --- | --- | --- |
| AC-1 | reconcile 阈值：29 分钟不动、**恰好 30 分钟不动**、31 分钟收口 | 通过 | `test/r24-stale-reconcile.test.ts` 用例 1；变异 M1（`>=`→`>`）实测红 |
| AC-2 | 收口 `finishedAt` = 最后活动时刻（`max(plannedAt, taskTimes 起止, messages[].at, revisions[].at, task.revisedAt)`），不是 `now`/`createdAt` | 通过 | 用例 2（消息 31 分钟前→`finishedAt`=消息时刻；消息 5 分钟前→不收口；`taskTimes.endedAt` 40 分钟前→`finishedAt`=endedAt）；真实数据用例逐毫秒比对 `lastActivityAtOf` |
| AC-3 | 幂等：连跑两次只写一次，第二次零 `save`、文件字节不变 | 通过 | 用例 3（countingStore：`saves===1` → 二次 `saves` 增量 0；目录字节快照相等） |
| AC-4 | 不误伤：有存活成员的 run 跳过；已有 `termination` 跳过；终态/非候选状态跳过 | 通过 | 用例 4（`hasLiveMembers=true` 不写、draft+`termination` 不写、terminated/cancelled 不写；`saves===0` + 字节不变）；变异 M2（删 termination 跳过）实测红 |
| AC-5 | 对账必须早于任何 snapshot/列表读取（装配期完成） | 通过（单测+源码） | 用例 5：`createBridge` 之前落盘残留 run → 装配后盘上即 `terminated`，首次 `bridge.snapshot()` 的 `planStatus==='terminated'`；源码 `src/host/bridge.ts:539-553` 在 `createBridge` 内同步执行，早于 `historyOf`/`snapshot` |
| AC-6 | closeRun：非终态 + 无存活成员 → `terminated` + `termination{kind:'stale', reason:'用户终止残留计划'}` + `finishedAt=now` | 通过 | 用例 6（`finishedAt===NOW`、reason 逐字、notice 含「已终止残留计划」） |
| AC-7 | closeRun 对终态 run 幂等：`unchanged:true`、不报错、不覆盖首次收口时刻、零写入 | 通过 | 用例 7（terminated 与 cancelled 两个 runId；`rejected===undefined`、`unchanged===true`、字节不变）；变异 M3（去掉终态分支）实测红 |
| AC-8 | closeRun 有存活成员 → `BAD_REQUEST` + 可读文案 + 零写入；名单读不到时保守拒绝（未知 ≠ 没有） | 通过 | 用例 8（`status:'running'` → message 含「仍有存活成员」与成员名「开发-1」、plan 仍 draft、字节不变）；用例 9（`listMembers` 抛错 → 含「无法终止运行」「宿主名单超时」、零写入） |
| AC-9 | 用时语义：done/skipped/cancelled 缺起止 → `unavailable`+原因；pending → `not-started`；完整记录逐字不变 | 通过 | 用例 10：t1 done 无 `taskTimes` → `{state:'unavailable',text:'不可得',reason:'该 run 完成于任务起止记录上线前，未存开始/结束时刻'}`；t2 pending → `{state:'not-started',text:'未开始'}` 且**无** `reason` 键；t3 完整记录 → `text:'1 分 00 秒'`、`ms:60000`、起止原样；t4 skipped 无起止 → unavailable+reason；变异 M4（`legacyTimed=false`）实测红 |
| AC-10 | 用仓库外 `/tmp` 副本验证两个真实残留 run；禁止改 `~/.dsh/auto-team/runs` 真实文件 | 通过 | 用例 11：见 §5；源文件字节前后一致，真实文件当前仍 `draft`（只读核查），未被本任务改动 |
| AC-11 | 门禁 `pnpm typecheck && pnpm test && pnpm build`，lib 双产物为本次构建且可 `node import` | 通过 | §1 |
| AC-12 | 写域合规：只改 `test/**`、`lib/**`、`docs/teamflow/2026-11-11-r24-stale-run-reconcile/**` | 通过 | 新增 `test/r24-stale-reconcile.test.ts`（untracked）、重建 `lib/index.js`+`lib/client.js`、新增本报告；未改 `src/**`（变异测试临时改后已字节还原，见 §4 尾注） |
| AC-13 | 报告含 AC 对照、阈值/幂等证据、两类异常真机预期与验证步骤、未验证项 | 通过 | 本文 §2–§8 |

## 3. 新增用例清单（`test/r24-stale-reconcile.test.ts`，11 例）

| # | 用例 | 关键断言 |
| --- | --- | --- |
| 1 | reconcile 阈值边界 | run-29/run-30（恰好 30 分钟）保持 `draft`；run-31 → `terminated`、`finishedAt=NOW-31min`、`termination={kind:'stale',reason:STALE_PLAN_REASON}` |
| 2 | 最后活动语义 | 消息 31 分钟前→收口且 `finishedAt`=消息时刻；消息 5 分钟前→不收口；`taskTimes.endedAt` 40 分钟前→收口且 `finishedAt=endedAt`（不看 `createdAt`/`now`） |
| 3 | 幂等 | 第一次 `save` 1 次；第二次 `save` 增量 0；`snapshotDir` 逐字节相等 |
| 4 | 跳过集 | `hasLiveMembers` true / 已有 `termination` / terminated / cancelled 全部不写；`saves===0`、字节不变 |
| 5 | 装配期对账 | 装配前落盘残留 run → `createBridge` 后盘上 `terminated`；首次 `snapshot().planStatus==='terminated'` |
| 6 | closeRun 残留 run | `finishedAt=NOW`、`termination.reason='用户终止残留计划'`、notice 含「已终止残留计划」 |
| 7 | closeRun 终态幂等 | 两个终态 runId：`rejected===undefined`、`unchanged===true`、字节不变、不覆盖 `finishedAt`/`termination` |
| 8 | closeRun 有存活成员 | `BAD_REQUEST`、文案含「仍有存活成员」+「开发-1」、零写入、plan 仍 draft |
| 9 | closeRun 名单不可读 | `listMembers` 抛错 → `BAD_REQUEST` 含「无法终止运行」「宿主名单超时」、零写入 |
| 10 | taskDurationsOf 三态 | done 缺时刻→unavailable+reason；pending→not-started（无 reason 键）；完整记录逐字不变；skipped 同族 |
| 11 | 真实残留数据 `/tmp` 副本 | 见 §5 |

## 4. 阈值与幂等证据：变异测试（断言是否真的会红）

每次只改一处实现、跑对应用例、确认变红后从**字节备份**还原；4/4 全部按预期变红。

| 变异 | 改动 | 预期变红的用例 | 实测 |
| --- | --- | --- | --- |
| M1 阈值边界 | `src/host/store.ts`：`if (lastActivityAt >= now - staleMs) continue` → `>`（把「恰好 30 分钟」也收口） | 用例 1 | `exit=1`，用例 1 红 |
| M2 termination 跳过 | `src/host/store.ts`：删掉 `if (state.termination !== undefined) continue` | 用例 4（已有 termination 的 draft run 被二次收口） | `exit=1`，用例 4 红 |
| M3 closeRun 终态幂等 | `src/host/bridge.ts`：终态分支条件改 `if (false)`（终态 run 被重写） | 用例 7（`unchanged` 丢失、`finishedAt` 被 now 覆盖） | `exit=1`，用例 7 红 |
| M4 用时语义 | `src/shared/duration.ts`：`legacyTimed` 恒 `false`（回到「done 缺起止 = not-started」旧行为） | 用例 10 | `exit=1`，用例 10 红 |

还原校验：4 次变异后均 `cp` 回原字节，并用 `grep` 确认关键片段各 1 份；随后在还原后的树上重跑全量门禁（§1，1094 例全绿），证明还原未留下变异残留。

## 5. 真实残留数据验证（仓库外隔离副本）

- 数据来源（**只读**）：`~/.dsh/auto-team/runs/run-mwa9n8xf-1c61.json`、`run-mwa9uuow-1c61.json`（nengtan 工作区 2026-11-10 现场残留）。
- 步骤：先读源文件字节 → 复制到 `mkdtemp('/tmp/auto-team-r24-real-*')` → `new RunsStore(isoDir)` → `reconcileStalePlans(store,{now:Date.now()})` → 断言 → 再跑一次 → 删副本。
- 实测结果：

| runId | 收口前 | 最后活动时刻（字面量） | 收口后 `finishedAt` | `termination` | 二次运行 |
| --- | --- | --- | --- | --- | --- |
| `run-mwa9n8xf-1c61` | `status=draft`、无 `finishedAt`/`termination` | `1794289508191` | **相等**（且 `=== lastActivityAtOf(源)`） | `kind='stale'`、`reason=计划长时间无活动且没有成员在跑，已自动收口`（非空可读） | 返回 `[]`，目录字节不变 |
| `run-mwa9uuow-1c61` | 同上 | `1794291394249` | **相等** | 同上 | 同上 |

- 只动三处：`plan.status` / `finishedAt` / `termination`；两个 run 的 `plan.tasks` 与 `messages` 逐字保留（`deepEqual`）。
- **真实文件未被修改**：源文件字节测试前后一致；2026-11-11 10:46 只读核查时两个真实文件仍为 `status=draft`、`finishedAt=null`、`termination=null` —— 真机收口要等宿主安装新版本后启动时发生（安装/重启由队长执行）。
- **部署后不假红**：本用例已做「部署时序自愈」——若源文件已被真实宿主收口（今后必然发生），用例先核对 `terminated` + `finishedAt=最后活动时刻` + `termination.kind='stale'`，再把副本还原成「收口前」形状继续验证。已用 `HOME=<临时目录>` 装入**已收口**的两份数据实跑该用例：`✔ 1 pass / fail 0 / skipped 0`，证明真机部署后这条回归仍会绿，不会变成时效炸弹。

## 6. 观察项（不阻塞本轮判定）

| # | 位置 | 现象 | 建议 |
| --- | --- | --- | --- |
| O-1 | `src/host/store.ts:209` 注释 vs `:210-214` 实现 | 注释写「终态与暂停不算（暂停是用户主动事务）」，但 `STALE_CANDIDATE_STATUSES` **包含 `'paused'`**（与 t1 交接规格一致，实现正确、注释过时） | 改注释或明确「paused 也视为残留」的理由；避免后续维护者按注释删掉 `paused` 造成行为变更 |
| O-2 | `src/host/bridge.ts:1615-1629` `historyMemo`（5s memo） | `closeRun`/自动对账写盘后历史列表 memo 不失效：面板「终止计划」成功后最多 5s 内历史列表仍可能显示旧状态（服务端响应已是新状态）。已由计划任务 **t4** 跟踪，不在 t3 写域 | 由 t4 在落盘路径统一 `historyMemo=null`；真机验收时对「点完立即看列表」这一步补充验证 |

## 7. 两类异常的真机预期表现与验证步骤

前置：队长把本版本装进 `~/.dsh/profiles/desktop` 并重启宿主；本 QA 不执行安装/重启。

### 7.1 异常一：残留计划（`draft` 无 `finishedAt`、早已无成员）

预期表现：
1. 宿主启动后日志出现 `自动团队：已自动收口 2 个残留计划（run-mwa9uuow-1c61、run-mwa9n8xf-1c61）`（`onWarn` 文案，顺序按列表遍历）。
2. 面板历史列表/顶部 run 切换器中，这两行不再显示「未收口·可能残留」徽标，状态为「已终止」。
3. 若某 run 在部署后仍显示残留徽标：点该行「终止计划」→ 二次确认 → 成功后原地刷新为已终止；失败（如成员仍活）在行内显示可读原因（含成员名），不静默。

验证步骤：
1. 只读检查落盘结果（不手工改文件）：
   ```bash
   python3 - <<'PY'
   import json, os
   for n in ('run-mwa9n8xf-1c61','run-mwa9uuow-1c61'):
       d=json.load(open(os.path.expanduser(f'~/.dsh/auto-team/runs/{n}.json')))
       p=d['plan']; print(n, p['status'], d.get('finishedAt'), d.get('termination'))
   PY
   ```
   期望：`terminated 1794289508191 {'kind':'stale','reason':'计划长时间无活动且没有成员在跑，已自动收口'}` / `terminated 1794291394249 ...`。
2. 面板打开「自动团队 → 历史」：两行无残留徽标、状态已终止；点「终止计划」对终态行应无副作用（幂等，不报错）。
3. 反向用例（有存活成员）：对一个正在跑的 run 点「终止计划」→ 应弹可读拒绝文案且成员继续跑。

### 7.2 异常二：老 run 已完成但任务用时显示「未开始」

现场样本：`run-mwab43mm-1c61`（5/5 done、terminated，早于任务起止记录能力）。

预期表现：
1. 任务卡/任务表的用时列不再把已完成任务写成「未开始」，而是「不可得」。
2. 悬停「不可得」时 `title` 显示 `该 run 完成于任务起止记录上线前，未存开始/结束时刻`。
3. `pending`/未开始任务仍显示「未开始」，且不挂上述原因。
4. 面板宽度 320px 时无横向滚动、按钮/徽标不溢出。

验证步骤：
1. 打开该 run 的任务页 → 逐个完成任务单元格断言文本为「不可得」，`pending` 任务为「未开始」。
2. 悬停单元格读 `title`，应含「未存开始/结束时刻」原因原文（不是笼统的「不可得」）。
3. DevTools 把面板宽度设 320px：`document.scrollingElement.scrollWidth <= clientWidth`（右栏容器同法），无横向滚动条。
4. 新建一个跑完整任务的 run（记录起止）→ 用时显示具体时长（如「1 分 00 秒」），证明新数据路径未被改坏。

## 8. 未验证项（全绿不等于真机全部成立）

| # | 未验证项 | 原因 / 后续 |
| --- | --- | --- |
| U-1 | 面板交互：残留徽标、`终止计划` 按钮、二次确认、失败文案原地展示 | 需真机安装后人工验证（§7.1）；单测只覆盖 `closeRun` 的桥层语义与文案，不覆盖真实点击链 |
| U-2 | 真实宿主启动时对账的时序（是否早于首个 HTTP 请求/首次面板读取） | 源码核查 + 单测证明 `createBridge` 内同步执行；真实 host 的 bridge 装配时机需按 §7.1 第 1 步日志确认 |
| U-3 | 真实 `~/.dsh/auto-team/runs` 文件被收口的最终结果 | 本任务禁止修改真实文件，只验证隔离副本；真实收口在部署后由宿主完成（§7.1） |
| U-4 | 平台/宽度差异（320px 面板、深色主题下 warn tone 徽标对比度） | 需真机截图确认 |
| U-5 | 多 bridge / 多 profile 共用同一 `dataRoot` 的进程级去重（`reconciledDataRoots`） | 单测只覆盖单进程单盘；跨 profile 场景为设计推断，未实测 |
| U-6 | t4 缓存失效：`closeRun` 后历史列表 5s 内是否陈旧 | 由 t4 修复并单独验收（O-2）；本轮门禁不覆盖 |

## 9. 改动清单与写域合规

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `test/r24-stale-reconcile.test.ts` | 新增（untracked） | 11 例回归：阈值/最后活动/幂等/跳过集/装配时序/closeRun 四态/用时三态/真实数据副本 |
| `lib/index.js`、`lib/client.js` | 重建 | 本次 `pnpm build` 产物（mtime 2026-11-11 10:48:12，sha256 见 §1） |
| `docs/teamflow/2026-11-11-r24-stale-run-reconcile/QA-REPORT.md` | 新增 | 本报告 |

- 未改动 `src/**`（变异测试的临时修改已按字节还原并重跑全量门禁验证）。
- 未改动 `~/.dsh/auto-team/runs/**`（只读复制；源文件字节前后一致）。
- 执行证据：`.auto-team/artifacts/qa-t3-final.log`（门禁三连 + 双产物 import + sha256）。
