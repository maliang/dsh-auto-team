# r59 QA 报告 — 修写盘竞态（rev 版本号 + 按 runId 串行锁）

- 任务：t2（回归测试 + QA 报告），依赖 t1 的实现改动
- 日期：2026-11-20
- 环境：macOS / node v26.11.1（engines `>=22.18`）/ pnpm 10.34.7 / 仓库 `dsh-auto-team`
- 改动范围（本任务）：`test/r59-write-race.test.ts`（新增）、`test/bridge.test.ts`（+1 条串行化断言）

## 1. 门禁（全部实跑，退出码为准）

| 命令 | 结果 | 证据 |
|---|---|---|
| `pnpm typecheck` | exit 0 | `tsc --noEmit` 无输出 |
| `pnpm test` | exit 0 | `ℹ tests 1455 / ℹ pass 1455 / ℹ fail 0` |
| `pnpm build` | exit 0 | `lib/index.js 714.54 kB`，`✔ Build complete` |
| `pnpm typecheck && node --test test/bridge.test.ts`（任务卡指定判定） | exit 0 | `ℹ tests 64 / ℹ pass 64 / ℹ fail 0` |

## 2. 新增回归测试与判据（每条都做过「改回错误实现会红」验证）

文件 `test/r59-write-race.test.ts` 用**真 `RunsStore`（计数壳继承）+ 真 `createBridge`**，只把派发/恢复/消息端口换成无副作用桩，避免给 rev 计数掺入额外写盘。

| # | 场景 | 断言（可执行的判据） | 常态 | 变异后 |
|---|---|---|---|---|
| ① | 同一 run 上 `receipt`（t2，门禁 sleep 0.3）与 `reviewTask pass`（t1）并发；用门禁子进程写的标记文件确保 review 在门禁窗口内发起 | `t1.status==='done'`、`t1.review.verdict==='pass'`、`t2.status==='done'`、`t2.evidence.exitCode===0`；且 `review.snapshot` 里 `t2.status==='done'`（证明 review 的读盘发生在 receipt 写完之后） | ✔ 345ms | ✖ `'review' !== 'done'`（t1 被 receipt 的旧快照覆盖） |
| ② | 20 个并发 `message` 动作（各恰好一次 `saveState`） | `store.saves === seedSaves+20`；`final.rev === store.saves` 且逐次 +1；**`final.messages.length === 20` 且 20 条正文都在**（真正能抓到丢写的判据） | ✔ 23ms | ✖ `20 条消息一条都不能被覆盖`（只剩 1 条） |
| ③ | 直接 `store.save(state, { expectRev: rev-1 })` | 抛 `StaleWriteError`；`code==='STALE_WRITE'`、`runId`、`expectRev`、`actualRev` 字段正确；message 同时含 runId / `期望 rev=N-1` / `盘中 rev=N`；失败不落盘；`expectRev` 匹配时 rev +1 | ✔ | 未变异（直接打 store，与桥无关） |
| ④ | 20 并发动作的硬超时 | `within(5000, Promise.all(...))` 内全部完成；`elapsed < 5000`；若锁不可重入会因死锁被判失败而不是挂住进程 | ✔ 23ms | — |
| ⑤ | 变异实验 | 见 §3：三种判据在「去掉锁」后全部变红 | — | — |

`test/bridge.test.ts` 追加一条更直接的串行化断言：receipt 在门禁里持锁时发 `message`，`message` 完成时门禁结束标记文件必须已存在（未排队就会在 `sleep 0.3` 期间提前完成）。

## 3. 变异实验（「变红」证据，跑完已恢复原文件）

做法：备份 `src/host/bridge.ts` → 把 `withRunLockOf` 改成 `if (true) return fn()`（等价于去掉 act/executeAction 的锁）→ 跑定向测试 → 用备份恢复 → 用 `git diff | shasum` 比对恢复前后一致（三次均为 `RESTORED_OK`）。

| 变异 | 命令 | 结果 |
|---|---|---|
| 去掉锁 | `node --test --test-name-pattern='①' test/r59-write-race.test.ts` | ✖ 1 fail：`验收通过必须落成 done（…）。'review' !== 'done'` |
| 去掉锁 | `node --test --test-name-pattern='②④' test/r59-write-race.test.ts` | ✖ 1 fail：`20 条消息一条都不能被覆盖` |
| 去掉锁 | `node --test --test-name-pattern='同一 run 的其它动作必须等门禁回执释放锁' test/bridge.test.ts` | ✖ 1 fail：`门禁还没结束就执行了 message —— 同一 run 的动作没有串行化` |

> 方法学备注：② 里只断言「rev 单调递增=落盘次数」**不能**发现丢写 —— `save()` 每次都从盘上重读 `rev` 再 +1，即使 20 个动作都基于同一份旧账本覆盖写，rev 仍会单调且等于写盘次数。所以 ② 额外断言消息账本条数/正文，「无丢写」才可证伪。

## 4. 缺陷与偏差（症状 / 根因 / 复验命令）

### D1（中）严格 CAS 在生产代码里没人用，锁内写盘靠静默重基

- 症状：`save(state, { expectRev })` 的 `STALE_WRITE` 分支只有单测会走到。真实动作（回执/验收/派发/对账）都不传 `expectRev`；锁内 `save()` 在发现「锁外有人写过盘」时**重读盘上 rev 后静默重基**（`src/host/store.ts:612-620`），不会把动作判失败，也不会告诉调用方「你手里的快照过期了」。
- 根因：所有写入口都经 `bridge.saveState` / `deps.store.save(...)`，无一处传 `SaveOptions`。`grep -rn "expectRev" src --include='*.ts'` 只命中 `src/host/store.ts`（定义与注释）。
- 影响：单进程内同 run 写口已全部被同一把锁覆盖，暂无现网丢写；但多实例 / 外部写盘（第二个 profile/进程、工具直接写盘）落在 load 与 save 之间时，仍会静默覆盖视图字段，且错误被吞掉。
- 复验：`grep -rn "expectRev" src --include='*.ts' | grep -v 'src/host/store.ts'`（应无输出）。
- 建议修改：`saveState` 在锁内传 `expectRev: state.rev`（`save()` 会把新 rev 回写 `state.rev`，同一动作多次 save 仍成立）；或在 store 注释里删掉「锁内自动 CAS」的严格承诺，明确它是「静默重基」。

### D2（低）`dispatchReadyLocked` / `resumeRunLocked` 注释承诺「锁内重新 load」，实现没有

- 症状：二者函数体以 `let next = state` 开头直接沿用调用方传入的快照，锁内没有 `deps.store.load(runId)`。`src/host/team/dispatch.ts:571-575` 的注释写着「锁内重新 load 一次状态 —— 调用方传进来的 state 只用于取锁键，绝不作为写盘判据」，与 `dispatchReadyLocked`（`src/host/team/dispatch.ts:581`）实现不符；`resumeRunLocked`（`src/host/team/dispatch.ts:1016`）同样。
- 根因：t1 只把调用包进锁，没有在 Locked 变体内重读。当前两条调用路径（bridge 的 `executeAction` 在锁内 load；`auto-dispatch.ts:212→dispatchOnceLocked` 也在锁内 load）传入的都是新鲜快照，所以**今天没有现网症状**；但任何新的直接调用者（`src/host/index.ts:569/626` 的端口）传入锁外快照就会静默丢写，而且读注释会误以为已经安全。
- 复验：`sed -n '581,586p' src/host/team/dispatch.ts`（`let next = state` 前没有 `load`）；`grep -n "dispatchReadyLocked" -A6 src/host/team/dispatch.ts`。
- 建议修改：两个 Locked 变体开头加 `const fresh = deps.store.load(state.plan.runId); if (fresh !== null) state = fresh`（或删掉注释里的「锁内重新 load」承诺，二选一，不能保持现状）。

### 口径更正（对上游交接）

上游交接称 t1 改动文件含 `src/shared/types.ts`；实测 `git status --porcelain` 中**没有** `src/shared/types.ts`，t1 实际改动为 `src/host/bridge.ts`、`src/host/store.ts`、`src/host/team/auto-dispatch.ts`、`src/host/team/dispatch.ts`、`src/host/team/watcher.ts`（`git diff --stat` 合计 +262/-18 左右，另 `lib/index.js` 由 build 生成）。

## 5. 未验证项（全绿不等于全覆盖）

1. **真机 / 多进程**：全部测试在单进程、单个 `RunsStore` 实例上。两个宿主进程（或 `dsh` 与探针）同时写同一 `runs/*.json` 的跨进程竞态未验证；锁是进程内 `Map`，跨进程不生效，只能靠 CAS（而 D1 说明 CAS 目前没人用）。
2. **跨 run 并发**：锁按 runId 分片，不同 run 设计上互不阻塞；本次未做「两个 run 同时写」的显式并发测试。
3. **`expectRev` 的生产重试链路**：仓库里没有调用方传 `expectRev`，因此「捕获 `STALE_WRITE` → 重读 → 重试」的上层逻辑不存在、也未验。
4. **dispatchReady/resumeRun 的锁内 reload 缺口（D2）**：属 t1 实现范围，本次只记录不改；新测试不覆盖函数级行为（当前调用路径触发不到丢写）。
5. **门禁子进程写标记文件**依赖 POSIX shell（`: > file; sleep`），Windows 未验。

## 6. 结论

t2 交付物（回归测试 3 条 + bridge 串行化断言 1 条 + 本报告）完成，门禁 `pnpm typecheck && pnpm test && pnpm build` 与任务卡判定 `pnpm typecheck && node --test test/bridge.test.ts` 均 exit 0；①~⑤ 五个场景全部有可执行判据，且三种变异实验证明关键断言会红。遗留 D1（严格 CAS 未接入，中）与 D2（Locked 变体未真正锁内 reload，低）不阻塞本轮竞态修复的主路径，但建议在后续轮次收口。
