# r32 QA 报告：停滞真实性 / 进度记账 / 复用软提示

- 任务：t3（QA 测试工程师），依赖 t1（真机假停滞修复）、t2（复用路径软提示）
- 日期：2026-11-13
- 判定：**通过**（全量门禁全绿；三条核心承诺均以「变异后变红」自证）
- 被测代码（工作区未提交改动）：`src/host/team/stall.ts`、`src/host/bridge.ts`、`src/host/index.ts`、`src/host/adapters.ts`、`src/host/team/watcher.ts`、`src/host/team/dispatch.ts`、`src/client/nav.ts`、`src/client/views/MemberPage.tsx`、`src/shared/types.ts`
- 本次新增用例：`test/r32-qa-regression.test.ts`（10 例）

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | rc=0 |
| `pnpm test` | 1205 pass / 0 fail（新增 10 例，t2 时 1195） |
| `pnpm build` | rc=0（host + client 双产物） |
| `lib/index.js` | 629545 B，sha256 `265d959d68a0124234dedffe3777d6122b69ca7311299e2c82524c3f156102b2` |
| `lib/client.js` | 587714 B，sha256 `938946812ef579a5c70470eeb270c91910ef76ef78fbda901293e905a7965ef4` |
| 双产物 import | 均无异常（host 导出 4 项，含 `apply`；client 经 `__ModuleLoader__` 套壳，0 命名导出属预期） |
| `npm pack --dry-run` | 8 files，含 `lib/index.js` / `lib/client.js` / `cordis.patch.yml` |
| 变异矩阵 | 3/3 按预期变红（见 §4） |
| 真机复验 | **未执行**（需真机 2 分钟以上观察，见 §6 未验证项） |

## 2. AC 对照

| AC | 要求 | 判定（用例） | 证据 |
|---|---|---|---|
| AC-1 | 停滞判定：有 progress 且久未推进 → stalled 且秒数正确；从未有 progress 但刚派发 → 阈值内不 stalled；宿主完全未上报 → 不得 stalled（「证据不足」态，文案唯一，客户端零阈值）；有 progress 后 done/failed → stalled 恒 false | ①×5 例：`stallOf` 单测（100s→stalled/10000ms/'quiet'/「100 秒」；89 999/90 000 边界；`undefined`→unreported/0ms/唯一文案）；快照 3 例（刚派发 3s 无信号→stalled=false+`stallReason='unreported'`；spawnedAt 1210840ms 前但无 progress→仍 false；同 baseline 有 100s 前 progress→stalled/100000ms/'100 秒'；done/failed→全零+'none' 空 note）；客户端 2 例（`memberPageOf` 证据不足只显示 note 不见黄条；`stalledRowOf` 在 `stalled=false, stalledForMs=999999` 时仍不点亮；`stalled=true, stalledForMs=1` 时文案逐字取宿主） | `node --test test/r32-qa-regression.test.ts` 10/10 |
| AC-2 | 进度记账：一次 `tools/result`（子 agent 身份）→ `state.progress[memberId].at` 推进且落盘；binding 解析不到的调用不得写别人进度 | ②×3 例：真实 `apply()`（真 `RunsStore`、`HOME` 重定向到临时目录）里根作用域投递一次 → `at≥before` 且 run JSON 文件里同值；成员 ctx 上 `tools/result`/`agent/status` 各挂 1 个；成员 ctx 后续调用继续推进（先回填旧 at 再投递 → at 变大且接近 now）；`ghost-member` 的调用 → `member-m1` 的 at 原封不动、无 `ghost-member` 键、warning 含「未登记的 agent」+ id | 同上 |
| AC-3 | 复用路径软提示与 spawn 同断言：恰 1 条、带 taskId、排在派发后、rework 不重复 | ③×2 例：spawn（新建成员）与 reuse（t1 done 复用 idle 成员，`spawned.length===0` 且 `sent.length===1`）各恰 1 条 captain→user、带 taskId、`toMemberId` 为空、索引大于派发消息；两条路径提示正文逐字一致（仅 task id 不同）；rework（`attempts=1` 后重派）仍恰 1 条 | 同上 |
| AC-4 | 门禁 `pnpm typecheck && pnpm test && pnpm build` + lib 双产物 import + 体积与 sha256 | §1 表 + §5 证据 | 三条 rc=0；见 §1 sha256 |
| AC-5 | QA-REPORT.md 含 AC 对照、变异矩阵（3 条各自变红）、真机复验步骤、未验证项 | 本文件 | — |

**上游直投的 t1/t2 门禁**：t1 `pnpm typecheck && pnpm test` rc=0（1194 pass）；t2 `node docs/teamflow/2026-11-13-r31-read-discipline/repro-reuse-hint.mjs && pnpm typecheck && pnpm test` rc=0（1195 pass）。本次 1205 = 1195 + 10。

## 3. 断言有效性（先问「改回错误实现会不会红」）

| 断言 | 改回错误实现 | 会红？ |
|---|---|---|
| `stallOf(undefined).reason==='unreported'` / note 唯一 | 删掉 `stall.ts` 的证据不足分支（回到 `now-progressAt` 倒计时入口） | ✅ 实测 5 例红，见 §4 M1 |
| 快照 `stalled===false` 且 `stalledForMs===0` | 同上（回落 `spawnedAt` 基线） | ✅ 同 M1（bridge 层用例同批红） |
| 复用路径 `userHints.length===1` | 删掉复用分支的 `appendMissingPointerHint` 调用 | ✅ 实测 1 例红，见 §4 M2 |
| `progress[memberId].at` 落盘 | `recordProgress` 只算不 `store.save` | ✅ 实测 2 例红，见 §4 M3 |
| `stalledRowOf(stalled=false, stalledForMs=999999).show===false` | 客户端改成自己比阈值 | ✅ 逻辑上即红（用例断言精确取 `stalled` 标记） |
| spawn/reuse 提示正文逐字一致 | 复用分支另写一份文案 | ✅ 字符串相等断言即红 |
| rework 后仍 1 条 | 去掉 `dispatchedBefore` 判据 | ✅ `length===1` 断言即红（t2 已覆盖同判据） |

## 4. 变异矩阵（实测）

做法：备份 → 单点改源码 → 跑 `node --test test/r32-qa-regression.test.ts test/stall.test.ts test/bridge.test.ts` → 还原 → 复核还原（`grep -c` 三处命中数与改动前一致）。

| # | 变异点 | 变异内容 | 结果 | 变红的用例（节选） |
|---|---|---|---|---|
| M1 | `src/host/team/stall.ts` 证据不足分支 | 删掉 `if (typeof progressAt !== 'number' \|\| !Number.isFinite(progressAt)) return {…reason:'unreported'}` | rc=1，85 pass / **5 fail** | `r32：running 成员一次进度都没上报时输出「证据不足」…`；`① 停滞判定矩阵…`；`① 宿主快照：刚派发但从来没有 progress…`；`① 宿主快照：从未上报（派发已 20 分钟）…`；`stallOf：没有推进记录 = 证据不足（unreported）…` |
| M2 | `src/host/team/dispatch.ts` 复用分支 | 删掉 `next = appendMissingPointerHint(next, state, task, at)` | rc=1，89 pass / **1 fail** | `③ 软提示同形：spawn 与复用两条路径都恰 1 条…` |
| M3 | `src/host/index.ts` `recordProgress` | 删掉 `store.save({ ...state, progress: touchProgress(...) })` | rc=1，88 pass / **2 fail** | `② 进度记账：一次子 agent 的 tools/result 必须推进…且真的落盘`；`② 进度记账：成员 ctx 上的后续调用会继续推进 at` |

> 还原复核：`grep -c "reason: 'unreported'" src/host/team/stall.ts`=1、`grep -c "appendMissingPointerHint(next, state, task, at)" src/host/team/dispatch.ts`=2、`grep -c "store.save({ ...state, progress: touchProgress" src/host/index.ts`=1；随后全量门禁全绿（§5）。

## 5. 门禁证据（本次实跑）

```
$ pnpm typecheck                     # rc=0
$ pnpm test                          # tests 1205 / pass 1205 / fail 0
$ pnpm build                         # rc=0；lib/index.js 629.54 kB(gzip 208.68 kB)、lib/client.js 587714 B
$ ls -l lib/index.js lib/client.js   # 629545 B / 587714 B（门禁重跑后字节与 sha 均不变）
$ shasum -a 256 lib/index.js lib/client.js
265d959d68a0124234dedffe3777d6122b69ca7311299e2c82524c3f156102b2  lib/index.js
938946812ef579a5c70470eeb270c91910ef76ef78fbda901293e905a7965ef4  lib/client.js
$ node --input-type=module -e "await import('./lib/index.js')"   # ok（host exports: 4）
$ node --input-type=module -e "await import('./lib/client.js')"  # ok（不抛 window is not defined）
$ npm pack --dry-run                 # total files 8；含 cordis.patch.yml / lib/client.js / lib/index.js
```

定向测试：

```
$ node --test test/r32-qa-regression.test.ts        # 10 pass / 0 fail
```

## 6. 真机复验步骤（**本次未执行**，留在下次真机 run 验收）

前置：已安装到 profile（`cd ~/.dsh/profiles/desktop && pnpm add file:<repo>`），面板「自动团队」已开。

1. **派一个长任务成员**：给一个需要 ≥2 分钟的活（例如「读完 src/host/ 下所有文件并逐个写 1 行摘要到 docs/tmp/summary.md」），确认成员状态 `running`。
2. **跑满 2 分钟不打扰**：期间不 cancel、不发消息。
3. **看进度在动**：
   - `auto_team_status`（或面板）里成员 `lastEventAt` 必须每几秒前进，不得停在派发时刻；
   - `grep -o '"progress":{[^}]*}' ~/.dsh/auto-team/runs/<runId>.json` 非空，`at` 持续增长（≤1 秒合并）；
   - **不得**出现 `stalled=true` / 黄色停滞条 / `stalledForMs≈1200000`。
4. **真停滞对照**：让成员卡住（例如让它等待一个不存在的文件/长命令 sleep 300），静默 ≥90 秒后应出现 `stallReason='quiet'`、`stalledForMs≈now-progressAt`，文案「⏳ N 秒无实质产出」。
5. **证据不足对照**：冷启动一个成员后立刻让宿主不上报（或用一个不接 `agents.get` 的宿主版本），面板只出现「宿主未上报推进信号，无法判定是否停滞」，且无黄条。
6. **复用软提示**：等 t1 完成、成员 idle，再派一个无 `path:line` 指针的任务给它，应恰见 1 条 `captain→user` 提示（带 taskId、在派发消息之后），返工重派不新增。

## 7. 未验证项（明确列出，不用「构建通过」代替）

1. **真机 2 分钟观察**（§6 全部步骤）：本次只做离线回归；宿主真实 `tools/result` 投递时序、`agents.get` 返回值形状仍需真机确认。
2. **宿主版本差异**：无 `agents.get`/`ctx.on` 的旧宿主走「静默降级到根作用域 + 一条 warn」，离线只验证了降级分支的返回原因，**未在旧宿主实机跑过**。
3. **面板视觉**（黄条/灰字样式、暗色主题、窄栏换行）：只验证了 viewmodel 输出的 `stalled`/`stalledText`/`stallNote`，未做真机截图比对。
4. **节流边界**：`PROGRESS_SAVE_MIN_MS=1000` 的合并行为只验证了「第二次调用会推进」，未验证高频调用下的磁盘写入次数（需要宿主侧计数探针）。
5. **并发多成员**：②只覆盖单成员单 run；多成员同时推进时 `recordProgress` 遍历 `store.list()` 的顺序与写放大未压测。
6. **`npm pack` 安装链路**：只做 `--dry-run` 清单核对，未在克隆 profile 里实装后跑面板请求。

## 8. 缺陷 / 风险

- 本轮未发现功能缺陷（3 条变异全部按预期变红、全量门禁全绿）。
- 风险 R-1（低）：`stallNoteOf` 的文案是**唯一**措辞，若未来需要多语言/更细分类，应扩 `StallReason` 而不是在客户端拼字符串——报告与测试都锁了「客户端零阈值」，扩文案不会破坏断言。
- 风险 R-2（低）：②用例里的假 ctx 按宿主 0.2.2-rc.2 形状（`namesOf→{self,parent}`、`agents.get` 返回 `{ctx}`）搭建；宿主形状变动时这两处会先红，属预期的契约哨兵。

## 9. 本次产物

- `test/r32-qa-regression.test.ts`（新增，10 例）
- 本报告 `docs/teamflow/2026-11-13-r32-stall-truth/QA-REPORT.md`
- 重新构建的 `lib/index.js`、`lib/client.js`（sha256 见 §1）
