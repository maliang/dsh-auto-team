# r39 QA 报告 — 步数与上下文预算（t1）+ 跨 run 收口（t3）

- 任务夹：`docs/teamflow/2026-11-16-r39-cost-budget/`
- 角色：QA 测试工程师（t2）
- 被测提交：工作树（HEAD `40a8b6f` 之后的 t1/t3 未提交改动）+ 本报告同目录的 `measure-cost.mjs`
- 结论：**条件通过**。三项门禁全绿、17 条新增判据全绿、双产物可 import；但有 3 项真机行为未验证（宿主加载的是旧产物、提醒投递未实测、改后成本曲线还没有可比 cohort），不能把「单测通过」当成「线上生效」。

---

## 1. 验收判定矩阵（AC → 可执行判据）

全部判据都用 `node --test` 直接跑 TS 源码；退出码非 0 即红。新增两个测试文件共 **17 例**：

```bash
node --test test/r39-step-budget.test.ts      # 8 例
node --test test/r39-runid-routing.test.ts    # 9 例
# 合计 17 pass / 0 fail（本轮实测）
```

| # | 验收点 | 判据（用例名） | 结果 |
|---|---|---|---|
| AC-1 | 成员提示词含 `## 步数与上下文预算（硬指标）`，段正文 ≤500 字符 | `r39① 步数预算段：≤500 字符、四条逐字、位于读取纪律之后验收判定之前`（实测正文 **227** 字符） | 绿 |
| AC-2 | 四条关键短语逐字在 | 同上：`单任务目标 ≤60 次工具调用`、`每 30 次工具调用必须 \`compress\` 一次`、`到 40 次先发一条进度消息给队长`、`不许拿全量 \`pnpm test\` 当探针` | 绿 |
| AC-3 | 队长段落含任务卡纪律三条关键词 | `r39② 队长工作方式含任务卡纪律：≤3 文件 / path:line / >40 步拆卡 / >60 步改小` | 绿 |
| AC-4 | 39 次工具调用不提醒 | `r39③ 39 次不提醒 / 40 次恰 1 条 / 41 次不重复（落盘幂等）` | 绿 |
| AC-5 | 40 次恰 1 条，文本含「预算 60」「compress」「5 步」，任务仍 running、账本幂等键 `step-reminder:t1` | 同上 | 绿 |
| AC-6 | 41 次不重复提醒（先落盘再重新 load 仍只有 1 条） | 同上 | 绿 |
| AC-7 | `stepReminderAt=0` 全关：100 次也不提醒、不落账 | `r39③ stepReminderAt=0 全关：100 次也不提醒、不落账` | 绿 |
| AC-8 | 收口（任务 done）后不提醒 | `r39③ 收口后不提醒：任务 done 时 100 次也不发` | 绿 |
| AC-9 | 发送失败（`ok:false`）不落账、下一轮补发 | `r39③ 发送失败不落账、下一轮重试：ok:false 不是「已提醒」` | 绿 |
| AC-10 | `progress.calls` 必须随 run 读回（否则提醒永不到阈值） | `r39 store 往返：progress.calls 必须随 run 读回（丢了它提醒永不到阈值）` | 绿 |
| AC-11 | `stepReminderAt=0` 经面板式保存（表单缺键）仍保住 0；201 被拒且文件逐字节不变 | `r39 设置项：stepReminderAt=0 经面板式保存（缺键）也必须保住关闭态` | 绿 |
| AC-12 | `status` 传非活动 runId 只看那份计划 | `r39 t3 status：传非活动 runId 只看那份计划` | 绿 |
| AC-13 | `status` 不传 runId 与显式传活动 runId 输出逐字段一致 | `r39 t3 status：不传 runId 与显式传活动 runId 输出逐字段一致` | 绿 |
| AC-14 | `status` runId 不存在 → `NOT_FOUND` 且零写入 | `r39 t3 status：runId 不存在 → NOT_FOUND 且零写入（不静默回退）` | 绿 |
| AC-15 | `message` 传 runId 只发给那个 run 的成员，活动 run 逐字节不变 | `r39 t3 message：传 runId 只发给那个 run 的成员，活动 run 一个字节不变` | 绿 |
| AC-16 | `message` 不传 runId 仍走活动 run | `r39 t3 message：不传 runId 仍走活动 run（与改前一致）` | 绿 |
| AC-17 | `message` 传 runId **不跨 run 退避**：目标 run 里没有的成员/任务直接 `NOT_FOUND`，一条都不发 | `r39 t3 message：传 runId 不跨 run 退避（同名任务/别的成员一律 NOT_FOUND）` | 绿 |
| AC-18 | `receipt` 传非活动 runId 跑门禁并只改那个 run（证据 `command: 'exit 0'` / `exitCode: 0`） | `r39 t3 receipt：传非活动 runId 跑门禁并只改那个 run` | 绿 |
| AC-19 | `receipt` runId 不存在 → `NOT_FOUND` 零写入（门禁都不跑） | `r39 t3 receipt：runId 不存在 → NOT_FOUND 且零写入（不静默回退）` | 绿 |
| AC-20 | `receipt` 不传 runId 仍走活动 run；已 done 重复回执回「任务 t1 已完成，不重复跑门禁」且 evidence 不变 | `r39 t3 receipt：不传 runId 仍走活动 run；done 后重复回执不重复跑门禁` | 绿 |
| AC-21 | 度量脚本可跑、支持 runId 前缀、按 run/按任务出数 | 见 §4 的三条命令（`--usage-only --first 28` 精确复现基线） | 绿 |
| AC-22 | 报告含基线 / 改了什么 / 复测口径 / 未验证项 | 本文件 | 绿 |
| AC-23 | `pnpm typecheck && pnpm test && pnpm build` 全绿 + 双产物 import + `lib/index.js` 体积与 sha256 | 见 §7 | 绿 |

### 1.1 断言不是恒真：突变反证（实跑后还原）

| 突变 | 预期红 | 实测 |
|---|---|---|
| `src/host/bridge.ts` 的 `stateOf` 改成永远 `loadState(活动 run)`（即 runId 被忽略） | 4 条跨 run 判据 | **红 4 条**：status OLDER / message OLDER / message 不跨 run / receipt OLDER；5 条默认路径仍绿（说明红的正是 runId 分支，不是整文件炸） |
| `src/host/team/watcher.ts` 的闸门 `calls < threshold` 改成 `calls <= threshold` | 39/40/41 与失败重试用例 | **红 2 条**：`39 次不提醒 / 40 次恰 1 条 / 41 次不重复`、`发送失败不落账…` |
| `src/host/store.ts` 的 `normalizeProgress` 恢复旧白名单（丢掉 `calls`） | AC-10 与三条提醒用例 | **红**（这也是 D1 被发现的方式，见 §5） |

还原方式：突变前 `cp` 到 `/tmp/bridge.ts.bak`、`/tmp/watcher.ts.bak`，跑完再 `cp` 回去；`git diff` 与突变前一致。

---

## 2. 基线（改前 28 run，可复跑）

口径：`usage.byMember` 有记账（calls > 0）的 run，按 `plan.createdAt` 升序取前 28 个——这是 t1/t3 改动落地前的历史 cohort。

```bash
node docs/teamflow/2026-11-16-r39-cost-budget/measure-cost.mjs --usage-only --first 28
```

| 指标 | 数值 |
|---|---|
| run 数 | 28 |
| usage calls | **12,361** |
| tokens | **1,275,220,490**（1.275B） |
| cacheRead | 1,238,214,528（**97.10%** 命中） |
| 平均每次调用上下文 | **103,165**（103.2K） |
| 平均每 run calls | **441.5** |
| 会话步数 / 工具调用 | 7,247 步 / 8,543 次工具调用（按 run 时间段切分、跨 run 复用会话已去重） |
| compress | 168 次（每 100 calls 仅 1.36 次） |
| assistant 字符 / tool-result 字符 | 6,844,911（554/call）/ 16,531,382（1,337/call） |
| 最贵单任务 | `run-mwd75lhz-1c61` / `t1` = **952 calls / 118,002,542 tokens**（118M） |
| 累计墙钟 | 96.0 小时 |

口径边界（读数前必看）：

- token / calls / cacheRead **只**来自 `$DSH_HOME/auto-team/runs/*.json` 的 `usage.byTask` / `usage.byMember`；宿主不在成员会话里记 usage。
- 工具调用数 / 字符数 / compress 次数 / 墙钟来自 `$DSH_HOME/sessions/<workspace>/<memberId>/session.v4.jsonl.zstd`（`zlib.zstdDecompressSync`）。`memberId` 由 run 的 `bindings[]` 给出，按目录名全局查找（成员会话可能落在任意 workspace 目录）。
- **两组数不能互相推导**：个别并行 run 的 usage 明显漏记（例：`run-mwiqv83v-1c61` 的 usage 只有 140 calls，而按时间段归属到该 run 的成员会话合计 402 步 / 546 次工具调用，其中 `backend-t1-b23i6m-2` 记 1 call 却有 125 步）。这是宿主 usage 记账缺口，不是本次改动引入；逐 run 的 token 仍以 usage 为准，工具数按会话计。
- **成员会话会跨 run 复用**（同一 `memberId` 被多个 run 续聊）：脚本按 `bindings[].spawnedAt` 把每个成员的时间轴切成互不重叠的段，再按记录 `time` 归属到 run，避免同一会话被每个引用它的 run 重复计数。切分前基线曾被放大成 18,598 步 / 20,804 次工具调用，切分后为 7,247 / 8,543。
- **`usage.calls` 与「步数」不可整除**：宿主按 `memberId` 记账，复用的成员在后续 run 里可能把整段会话的累计用量记进该 run（例：`run-mwd75lhz-1c61` 只绑 `backend-t1-b23i6m-2`，41 步会话却记 952 calls / 118M tokens，即任务卡里的“最贵单任务”）。因此逐 run 的 steps/calls 比值不能当效率指标，token 仍以 usage 为准。
- 一个成员会话被同一 run 多张任务卡复用时，字符数只算给最早的任务卡，输出标 `shared`，避免重复计数。

### 2.1 当前全量（30 run，含改后）

| 指标 | 基线 28 | 当前 30 | 变化 |
|---|---|---|---|
| calls | 12,361 | 12,632 | +271 |
| tokens | 1.275B | 1.294B | +18.8M |
| cacheRead | 97.10% | 97.05% | -0.05pp |
| 平均每次上下文 | 103.2K | 102.4K | -0.7K |
| 平均每 run calls | 441.5 | 421.1 | -20.4 |
| 会话步数 / 工具调用 | 7,247 / 8,543 | 7,902 / 9,390 | +9.0% / +9.9% |
| compress（每 100 calls） | 168（1.36） | 180（1.42） | +7.1% |
| 每 call 字符（assistant） | 554 | 584 | +5.4% |
| 每 call 字符（tool-result） | 1,337 | 1,400 | +4.7% |
| 累计墙钟 | 96.0 h | 98.1 h | +2.1 h |

**这不是效果证据**：新增的 2 个 run 里有一个就是本轮的 r39，且 t2 仍在跑、usage 未收口；样本太小，涨跌都在噪声内。改后是否真的省，要等宿主重载新产物后的下一个完整 run 再比。

---

## 3. 本轮改了什么

实现（t1，成员预算）：

- `src/host/team/member-prompt.ts:85` 新增 `## 步数与上下文预算（硬指标）`，位于「读取纪律」之后、「验收判定」之前；正文 227 字符，四条逐字（≤60 次 / 每 30 次 compress / 到 40 次发进度 / 不许拿全量 `pnpm test` 当探针）。
- `src/host/prompt.ts:60` 队长工作方式第 10 条「任务卡要小」：≤3 文件、标题带 `path:line`、>40 步拆卡、>60 步派发前改小。
- `src/host/team/watcher.ts:319` 提醒文案、`:341` `stepRemindersOf` 闸门（只 running / binding 未 retired / calls ≥ 阈值 / 已有幂等键则跳过）、`:363` `recordStepReminder`（`messageId = step-reminder:<taskId>`）、`:427` tick 里 `!paused && threshold>0` 才发，`ok` 才落账。
- `src/host/index.ts:271-310` 按 memberId 累计工具调用（内存先 +1，节流只影响刷盘；成员复用换 taskId 归零），`:511` 把 `stepReminderAt` 与 `sendMemberMessage` 装进 watcher。
- `src/host/config.ts:76/84/203/218`：`STEP_BUDGET=60`、`STEP_REMINDER_AT=40`、默认 40、范围 [0,200]。
- `src/host/settings.ts:68/131/162`：设置项标签、面板保存缺键时沿用磁盘旧值（保住 0=关闭）、`readStepReminderAt` 校验整数。

实现（t3，跨 run 收口）：

- `src/host/tools.ts:134` `runIdOf`（trim 空串 = 未传）、`:139` `runTargetError`（`NOT_FOUND: 找不到运行 <runId>（会话里没有这个 run）`）；status / message / receipt 三个 schema 各加可选 `runId`。
- `src/host/bridge.ts:703` `stateOf(sessionId, runId)`：不传走活动 run（原逻辑一行未改）；传了就 `store.load(runId)` 且 `plan.sessionId` 必须匹配，否则 null。message 传 runId 时先校验 taskId 在该 run 的 `plan.tasks`、memberId 在该 run 的 bindings，找不到直接 `NOT_FOUND`，不跨 run 退避。
- receipt 走同一道 `bridge.act` 门禁（preflightGate + acceptance），只把目标 state 换成该 run；已 done 短路（`src/host/bridge.ts:2852`），提示「任务 <id> 已完成，不重复跑门禁」。

QA 本轮新增/修复：

- `test/r39-step-budget.test.ts`（8 例）、`test/r39-runid-routing.test.ts`（9 例）。
- `test/r21-harness.ts` 增加可选 `applyReceipt?: ApplyReceiptPort`（缺省仍是恒等 `(state)=>state`），让 runId 回执用例能证明真的 `done` 而不是只到 gate。
- **修复 D1**：`src/host/store.ts:703-724` 的 `normalizeProgress` 丢掉 `calls`（详见 §5）。
- `docs/teamflow/2026-11-16-r39-cost-budget/measure-cost.mjs`：本目录的度量脚本（只读 `$DSH_HOME`，无仓库依赖）。

---

## 4. 复测口径（命令逐字）

```bash
# ① 单测（17 例）
node --test test/r39-step-budget.test.ts test/r39-runid-routing.test.ts

# ② 基线 28 run（应重现 12,361 calls / 1,275,220,490 tokens / 97.10% / 441.5 calls per run / 最贵 952 calls 118M）
node docs/teamflow/2026-11-16-r39-cost-budget/measure-cost.mjs --usage-only --first 28

# ③ 当前全量
node docs/teamflow/2026-11-16-r39-cost-budget/measure-cost.mjs --usage-only

# ④ 任意 runId 前缀 / 机器可读
node docs/teamflow/2026-11-16-r39-cost-budget/measure-cost.mjs --run run-mwiqveqm --json

# ⑤ 三项门禁 + 双产物 import
pnpm typecheck && pnpm test && pnpm build
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"

# ⑥ 产物指纹
ls -l lib/index.js && shasum -a 256 lib/index.js
```

复跑说明：token 类基线（calls / tokens / cacheRead / 最贵单任务）只要 `--usage-only --first 28` 的 run 集不变就稳定；**会话级数字（步数 / 工具数 / 字符）会随新 run 漂移**——某个成员如果在基线队列之后又被新 run 复用，基线最后一个时间段的右边界会从 ∞ 变成新 run 的 `spawnedAt`，区间内的记录被划走。要冻结口径，复跑时加 `--until 2026-11-16T13:22:00Z`（本轮读数截止时刻）。

脚本支持 `--run <前缀>` / `--since` / `--until` / `--usage-only` / `--first N` / `--json` / `--home`；`--help` 有完整说明。从**归档目录**复跑会读不到 `$DSH_HOME` 以外的相对路径——本脚本只读 `$DSH_HOME`（缺省 `~/.dsh`），所以归档后位置变了也能跑；若用 `--home` 指错会显式报错，不会静默出 0。

---

## 5. 缺陷

### D1（已修复，严重：提醒功能从未触发）

- **症状**：`recordProgress` 把 `progress[memberId].calls` 写进 run JSON，但下一次 `store.load` 读回时 `calls` 消失（只剩 `at`/`alertedAt`）。watcher 读到 `calls === undefined`，`stepRemindersOf` 永不满足 `calls >= 40`，**40 次提醒在真机上永远不会发**；39/40/41 三条用例在修复前全红。
- **根因**：`src/host/store.ts:703-724` 的 `normalizeProgress` 是白名单式规范化，r32 只保留 `at`/`alertedAt`，r39 新增的 `calls` 没进白名单，被静默丢弃。
- **修复**：`src/host/store.ts:720-721` 保留有限非负整数并向下取整：
  `const calls = value.calls; if (typeof calls === 'number' && Number.isFinite(calls) && calls >= 0) record.calls = Math.floor(calls)`；非法值（`-1` / `'many'`）丢弃但 `at` 仍在。
- **复验命令**：
  ```bash
  node --test test/r39-step-budget.test.ts
  # 8 pass / 0 fail；其中「r39 store 往返：progress.calls 必须随 run 读回」在旧 normalizeProgress 下必红
  ```
- **影响面**：只影响 r39 新功能，不改旧字段语义；`progress` 里其它非法值的行为与改前一致。

### D2（未修复，非阻塞，记录在案）

- `src/host/team/watcher.ts:380` 两条语句写在同一行（`export function createMemberWatcher(...) {  const now = ...`），不影响编译与行为，属格式瑕疵；建议 dev 顺手拆行。

---

## 6. 未验证项（全绿也必须看）

1. **真机提醒投递**：单测用 stub `sendMemberMessage` 验证「何时发、发几条、失败重试」，但没有在真实宿主看成员收到直达消息。本轮 r39 自己的 t1 用了 91 次工具调用、run 账本 15 条消息里**没有**「已用 N 次工具调用」——因为宿主进程加载的是 11:52 的旧 `lib/index.js`，而新产物 13:19 才 build 出来；`t1` 完成（12:18）早于新产物。要验证必须重启宿主后让一个成员跑过 40 次调用再查 run 的 `messages`。
2. **跨 run 收口的真机行为**：单测用 `test/r21-harness.ts` 夹具 + 真实 `applyReceipt` 证明「只改目标 run」，但没在真实会话里对 r36/r37 两个历史 run 执行 `receipt({taskId,runId})`；也验证不了宿主侧 `bridge.act` 与面板快照的联动。
3. **面板设置项**：`settings.stepReminderAt` 已有类型、校验与标签，但设置页表单没有渲染这一项（`src/host/settings.ts:131` 注释说明「6 行布局被测试钉住」）；目前只能通过设置 API / 文件改，普通用户改不了阈值。按 t1 约定「没这项就先常量 + 注释，别改 UI」，本轮接受，但属于产品缺口。
4. **成本下降效果**：`measure-cost.mjs` 能出基线，但改后 cohort 只有 1 个未收口的 run（t2 还在跑），不能证明「步数下降 / compress 变多 / 每 run token 下降」。需要宿主重载新产物后的下一个完整 run，再用 `--since` 对比。
5. **compress 的实际效果**：脚本只数 `compress` 调用次数，不还原 compress 前后的上下文占用，无法证明「折叠后每次调用上下文真的变小」。
6. **宿主 usage 记账缺口**：并行 run 场景下 `usage.calls` 可能远小于会话步数（见 §2 的 `run-mwiqv83v-1c61`），本轮度量只能标注、不能修；任何「每 run 成本」结论都应同时看 usage 与会话两组数。
7. **真机 UI**：没有启动第二宿主 / 无头浏览器验证面板；本轮未改 UI，风险低但未实测。

---

## 7. 门禁证据

环境：`/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team`，node v26.11.1。

| 命令 | 退出码 | 证据（尾部） |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc --noEmit` 无输出 |
| `pnpm test` | **0** | `ℹ tests 1278` / `ℹ pass 1278` / `ℹ fail 0` |
| `pnpm build` | **0** | `build:client` + `build:host` 完成（rollup 的 `platform` 提示是既有告警） |
| `node --input-type=module -e "await import('./lib/index.js')"` | **0** | 输出 `HOST_IMPORT_OK` |
| `node --input-type=module -e "await import('./lib/client.js')"` | **0** | 输出 `CLIENT_IMPORT_OK`（`window.__ModuleLoader__` 守卫仍在） |
| `npm pack --dry-run` | **0** | 含 `lib/index.js` 649.7kB、`lib/client.js` 607.2kB、`cordis.patch.yml`；package size 378.2kB |

产物指纹（本次 build 后）：

```text
lib/index.js    649,745 bytes   sha256 a9c60e85d192b22ecb41586f0c3e6f6a6c28a5d08203ac4425ac9d0b2486ac52
lib/client.js   607,171 bytes   sha256 55e850838a73876f2784fd78410f4f1d5e4d63d6095b6276bf949f0a1bc9f7c6
```

（基线时 `lib/index.js` 是 639,664 bytes / sha256 `228a0302…`，增量来自 t1/t3 与 D1 修复。）

---

## 8. 建议修改 / 可接受

**建议修改（不阻塞本轮）**

1. `watcher.ts:380` 拆行（D2）。
2. 给 `stepReminderAt` 补一个面板输入项，或在设置页放一行只读说明「该阈值当前只能经 API 修改」——否则用户无法关闭/调节提醒，`0 = 关闭` 只有开发者知道。
3. run 详情/统计里对「usage 明显小于会话步数」的 run 标注「用量可能不完整」，避免把记账缺口当成成本下降。
4. 真机复验清单：重启宿主 → 派一个 >40 次调用的成员 → 查 `~/.dsh/auto-team/runs/<runId>.json` 的 `messages` 是否恰有 1 条 `step-reminder:<taskId>`；再对两个历史 run 各做一次 `auto_team_receipt({taskId,runId})`，确认另一个 run 文件 mtime/sha 不变。

**可接受（已核实，不作为缺陷）**

- 提醒不阻断工具执行、不改任务状态：`stepRemindersOf` 只读 state，tick 里发送失败也不抛（ok:false / 异常都不落账）。
- 不传 runId 的旧路径：`stateOf` 的 `runId === undefined` 分支原样保留，17 例中 5 例专门钉住默认行为。
- `NOT_FOUND` 时零写入：status/message/receipt 的 MISSING 用例都对整目录做了逐字节快照比较。
- 空串 runId 视为未传（`runIdOf` trim 后空 = undefined），属合理宽松。
- 成员提示词新增段 227 字符，远低于 500 上限；段顺序在「读取纪律」之后、「验收判定」之前。
