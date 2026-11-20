# r60 CAS 加固 QA 报告（D1/D2 复验 + 丢更新判定）

- 任务夹：`docs/teamflow/2026-11-20-r60-cas-hardening/`
- 被测：t1「修 r59 遗留 D1/D2」（`src/host/bridge.ts`、`src/host/store.ts`、`src/host/team/dispatch.ts`）
- 新增测试：`test/r60-cas-hardening.test.ts`（5 例）
- 结论：**D1 的写盘口径与 D2 的锁内重读成立（绿）；D1 的锁内重试存在「丢更新」缺陷（红）——见 D3。**
  本次任务的门禁因此为红：`pnpm typecheck && pnpm test && pnpm build` 退出码 **1**（停在 test，`fail 1`）。

## 1. 验收判定（逐条）

| # | 判据 | 结果 | 证据 |
|---|---|---|---|
| ① | act 锁内 load 后遭遇外部写盘：动作成功、`StaleWriteError` 至少触发 1 次、最终落盘 | **绿** | `node --test test/r60-cas-hardening.test.ts` → `✔ r60 ①` |
| ② | 同一时序下外部写者写入的账本记录必须存活（丢更新判定） | **红（真缺陷 D3）** | 断言 `messages.some(body===MARKER) === true` 实际 `false`；`test/r60-cas-hardening.test.ts:194` |
| ③ | bridge 每次 `RunState` 写盘都显式带数字 `expectRev` | **绿** | `✔ r60 ③`；运行期观察 `save(state, options)`，`bare.length === 0` |
| ④ | D2：`dispatchReady` 传入过期快照时锁内重读盘上真值，盘上后加字段不被覆盖 | **绿** | `✔ r60 ④`；`started === ['t2']`，标记账本存活 |
| ⑤ | 生产调用方走 `saveWithCas`，`dispatch.ts` 无裸 `deps.store.save(` | **绿** | `✔ r60 ⑤`；`grep -c "saveWithCas(deps.store" src/host/team/dispatch.ts` = 4 |

**这一例是红**：②「CAS 重试不得抹掉外部写者的其它字段」为红，判定 **D3 真缺陷，t1 未完全修好**。
其余四组按原卡不变，均为绿。

### 门禁记录

```
$ pnpm typecheck && pnpm test && pnpm build
GATE_EXIT=1
ℹ tests 1465
ℹ pass 1464
ℹ fail 1
✖ r60 ②：CAS 重试不得抹掉外部写者的其它字段（丢更新判定）
  AssertionError [ERR_ASSERTION]: 外部写者写进盘的那条账本被 CAS 重试覆盖了
  false !== true
  at test/r60-cas-hardening.test.ts:194:12
```

`pnpm build` 单独执行退出码 **0**（`Build complete in 73ms`）。红点唯一来源是 ②，不是构建。
回执门禁同一命令、退出码 1，全量日志：`.auto-team/artifacts/t2.log`。

### grep 级守卫的实际情况（重要）

```bash
$ grep -rn 'expectRev' src --include='*.ts' | grep -v 'store.ts'
src/host/bridge.ts:823:    // r59 遗留 D1：锁内写盘必须带显式 `expectRev`，否则严格 CAS 名存实亡（save() 的重基会
```

命令虽非空，但**只命中一条注释**，对「生产写盘真的传了 expectRev」零断言价值；
因此把该守卫改成行为断言 ③（观察 `save` 的 `options.expectRev` 是否每次都是数字）。

## 2. 缺陷 D3（唯一红点）

**症状**
`saveWithCas` 撞到 `StaleWriteError` 后重试成功，但盘上「外部写者刚写进同一 run 的其它字段」被整份覆盖。
复现：外部写者在桥的锁内 `load` 之后、`save` 之前追加一条账本记录（`messages`），
`bridge.act(SESSION, { type: 'pause' })` 返回成功、`plan.status` 正确落成 `paused`，
但 `store.load(runId).messages` 里那条记录消失。

**根因**
`src/host/store.ts:528-546` 的 `saveWithCas` 只在重试时重基版本号：

```ts
const fresh = store.load(current.plan.runId)
if (fresh === null) throw error
current = { ...current, rev: fresh.rev }   // ← 只换 rev，其余字段仍是我方旧快照
```

随后 `store.save(current, { expectRev: current.rev })` 把我方**整份内容**写回，
盘上 `fresh` 里外部写者新增/更新的字段（`messages`、`usage`、`progress`、`evidence` 等）全部丢失。
即：严格 CAS 只保证了「版本号不落后」，没有保证「不丢更新」。

**复验命令**

```bash
node --test --test-name-pattern 'r60 ②' test/r60-cas-hardening.test.ts
# 期望（修复后）：pass 1；当前：fail 1
```

**建议修改**（归开发，不在 QA 写域）
`saveWithCas` 的这次动作需要「按盘上新鲜态重放」，而不是「换 rev 硬写旧内容」。三条可行路径：
1. 由调用方传入**基于新鲜态的重算函数** `apply(fresh: RunState): RunState`，重试时 `store.save(apply(fresh), { expectRev: fresh.rev })`；
2. 在 `RunLockFrame`（`src/host/store.ts:548` 起）里记录锁内**首次 load 的基线快照** `bases: Map<runId, RunState>`，
   重试时做 3-way merge：`diff(base → current)` 是我方意图，把它应用到 `fresh` 上再写；
   这样外部写者改的 `usage/progress/evidence` 保留，我方的 `pause`/任务状态变更也保留；
3. 或把 bridge 的写盘改成「锁内先 `load` 新鲜态 → 在新鲜态上重放本动作（如 `withTask`/`pause` 变更）→ 带 `expectRev` 写」，
   `saveState` 只接受重放结果（29 个调用点需逐一改造，成本最高）。

修复后 ② 应转绿；①③④⑤ 必须保持绿（④ 的变异检查见下）。**注意**：t2 由 QA 编写测试 + 报告，
D3 的修复属开发写域；按「不能验自己写的任务」的纪律，若由本 QA 顺手改代码，t2 的验收证据（含变异检查）
将失去独立性，建议拆独立修复任务 + 独立复验任务。

## 3. 变异验证（人工改源码→跑→还原，证明断言有判定力）

| 变异 | 改动 | 期望 | 实测 |
|---|---|---|---|
| M1 | `store.save(current, { expectRev: current.rev })` → `store.save(current)` | ① 红 | **红**（`staleSeen` 为 0） |
| M2 | `saveWithCas(..., maxRetries = 2)` → `maxRetries = 0`（等价去掉重试） | ① 红 | **红**（`StaleWriteError` 直接抛出） |
| M3 | `dispatchReadyLocked` 的 `const snapshot = lockedSnapshot(deps.store, state)` → `const snapshot = state` | ④ 红 | **红**（`started` 为空、标记账本被覆盖） |

还原后文件哈希与变异前一致（`store.ts d79ea39…`、`dispatch.ts 7dd407a…`），工作树未残留变异。

## 4. 未验证项（不得用「全绿」代替）

- **真机并发写者**：② 的外部写盘是测试内用同一 `RunsStore` 直接 `save` 模拟的（同进程、同步窗口）。
  真实宿主里 `refreshUsage` / 端口回调是异步且可能跨进程，时序窗口更大，本测试不能证明真机一定触发 D3；
  但「触发后必丢更新」由代码路径确定。
- **resumeRun 的锁内重读**：t1 同时改了 `resumeRunLocked`（dispatch.ts:1020），本卡只要求覆盖
  `dispatchReady`，未单独构造 resume 的过期快照用例；建议补一条同形用例（或由 ④ 的同一模式覆盖）。
- **usage / progress / evidence 字段**：② 只用 `messages` 做判定位；未逐一验证其它字段的丢失形态
  （根因是同一处整份覆盖，机制相同，但未逐字段实测）。
- 未做真机（第二宿主）验证。

## 5. 评审：建议修改 / 可接受

| 建议修改 | 可接受 |
|---|---|
| `saveWithCas` 必须按盘上新鲜态重放本次动作（`store.ts:528`），否则修 D3 无从谈起 | D2 的 `lockedSnapshot` 采用「盘上 rev 严格更大才用盘」的保守规则，同版本保留入参——对 `applyReceipt`/`revisePlan` 未落盘的纯函数结果是对的，保留 |
| ② 转绿前不应视为 t1 完成；门禁红点是真缺陷，不是 flake | ①③④⑤ 与变异证据齐全，D1 的「显式 expectRev」与 D2 的「锁内重读」方向已验证 |
| 补 resume 的过期快照用例（与 ④ 同形） | `pnpm build` 绿；typecheck 绿；其余 1464 例全绿，无回归 |

## 6. t4 独立复验（t3 mergeRunState 落盘后，独立复验者 ≠ 修复作者）

本节为追加，**不改变第 1–5 节（t2）的任何结论**；t2 的红点 ② 在此复跑为绿。

### 6.1 复跑：`node --test test/r60-cas-hardening.test.ts`

- 退出码 0，**5/5 全绿**；原红用例 ②「CAS 重试不得抹掉外部写者的其它字段」已转绿
  （`src/host/store.ts` 的 `mergeRunState` 三方合并生效）。

### 6.2 新增三方合并边界用例（test/store.test.ts，5 例）

| # | 用例 | 结果 |
|---|---|---|
| B1 | ours 未动 `messages`、theirs 追加 → 整段取 theirs（旧账一条不少），同时 ours 改的 `plan.status` 存活 | 绿 |
| B2 | 两边各追加**同一身份**账本 + 各自独有 → 合并只留一条、独有都保留、按 `at` 升序 | 绿 |
| B3 | 两边改同一 task 的同一字段到不同值 → 取 ours，且 warn 含 runId 与字段路径、只报一次；该 task 的其它字段取 theirs | 绿 |
| B4 | 三方合并路径重试耗尽 → 仍抛 `StaleWriteError`，尝试次数 = 3，盘上不留半成品 | 绿 |
| B5 | 外部写盘发生在「动作 load 之后、`saveWithCas` 内部 load 之前」→ 标记账本必须存活（base 必须是**动作开始时**的锁内快照） | **红（D4）** |

### 6.3 变异自检（人工改源码 → 跑 → 按备份字节还原）

| 变异 | 改动 | 判定用例 | 结果 | 还原 |
|---|---|---|---|---|
| M1 | `src/host/store.ts:637` `mergeRunState` 直接 `merged = ours`（等价于“只重基版本号”） | r60 ② + 三方合并 8 例 | 48 例中 **11 红 / 37 绿** | `cp` 还原，`shasum -a 256 src/host/store.ts` = `5009b7c4…e37adebc`（与备份一致） |
| M2 | `src/host/store.ts:606` 后插 `if (path === 'messages') return ours`（消息整块覆盖） | r60 ② + messages 2 例 | 48 例中 **4 红 / 44 绿** | 同上，哈希一致 |

两条变异都只打红、不打绿，说明 ②/合并断言有判定力（改回错误实现必红）。

### 6.4 门禁（四项，真实退出码）

| 命令 | 退出码 | 数字 |
|---|---|---|
| `node --test test/r60-cas-hardening.test.ts test/store.test.ts` | **1** | tests 48 / pass 47 / fail 1（仅 B5） |
| `pnpm typecheck` | 0 | — |
| `pnpm test` | **1** | tests 1476 / pass 1475 / fail 1（仅 B5） |
| `pnpm build` | 0 | lib/index.js 722.72 kB |

**结论：门禁未全绿，红点唯一且是真实缺陷 D4，不是 flake、没有放宽断言。**

### 6.5 缺陷 D4（B5 判红；与 D3 同族，t3 只修掉窄窗口）

- **症状**：锁外写者（生产里就是 `src/host/index.ts:304` 的 progress 投影、`src/host/index.ts:1096` 的 usage 投影——两者都 `store.load` 后直接 `store.save`，**不持锁**，可落在动作任意 await 之间）在「动作已 load、写盘 helper 尚未内部 load」这段窗口落盘时，本次动作的 CAS 重试**静默抹掉**对方刚写的 `messages` 账本 / `usage` / `progress` / `task.evidence`，且**没有任何 warn**。
- **根因**：`src/host/store.ts:673` `const base = store.load(runId)` 是**调用 `saveWithCas` 那一刻**才取 base，不是注释与任务卡承诺的「本次动作开始时的锁内快照」（承诺见 `src/host/store.ts:622` 与 `:659`）。此窗口下 base 已含对方内容 → `mergeValue` 命中 `src/host/store.ts:606` 的 `theirs === base → 取 ours` 分支，对方的字段整段被判成「未改」而丢弃；t3 的集成例把外部写盘注入在 `proxy.save` 里（即 base load **之后**），只覆盖了窄窗口。
- **复验命令**：
  ```bash
  node --test test/store.test.ts 2>&1 | grep -E "^(✖|ℹ (tests|pass|fail) )"
  # 期望（修复后）：48 例全绿；当前：fail 1（B5，AssertionError: base 必须取「本次动作开始时」的锁内快照…）
  ```
- **建议修改（任选其一，不改对外返回值形状）**：
  1. 在 `RunLockFrame`（`src/host/store.ts:698` 附近）加 `bases: Map<string, RunState>`，`withRunLock` 后第一次 `load(runId)` 时记下基线（或 `lockedSnapshot` 处记），`saveWithCas` 优先用它当 base，拿不到才退回现在的 save 时刻 load；
  2. 或 `saveState`/`saveWithCas` 增加可选 `base` 入参，由 bridge 把 `act`/`executeAction` 入口 `loadState` 的快照传下来。
  两者都要求「base = 动作开始快照」，B5 才能转绿；不要靠把 B5 改成在 `proxy.save` 注入来回避。

### 6.6 未验证项（不得用「全绿」代替）

- B5 红，D4 未修；因此 t3 的「CAS 重试不丢更新」只覆盖「写盘时撞车」窗口，**不覆盖「动作期间撞车」窗口**。
- `resumeRun` 的过期快照仍未单独构造用例（t2 的未验证项延续）。
- 其余字段（`bindings`、`taskTimes`）的丢失形态未逐字段实测，机制与 messages 同源。
- 未做真机（第二宿主）事件时序复现；B5 用 store 层注入复现，未在真实宿主里跑 usage/progress 事件流。

### 6.7 D4 修复与复验（t4 返工；**修复由 QA 本人实施，B5 绿属自证，需独立复验**）

- **修复**：`src/host/store.ts`
  1. `RunLockFrame` 增 `bases: Map<string, RunState | null>`；`withRunLock` 拿到锁的那一刻 `load` 一次盘上态记入（可重入/嵌套不刷新，最早一次才是公共祖先）；
  2. 新增 `RunsStore.baseline(runId)`：不在锁内/不在锁域 → `undefined`，拿锁时盘上无此 run → `null`；
  3. `saveWithCas` 的 base 改为 `store.baseline(runId) ?? store.load(runId)`——锁内一律用拿锁时的快照，只有拿不到（不在锁内、手工 fake store）才退回写盘前 load。
  bridge / dispatch 的调用姿势不变（未改对外返回值形状，未改用户可见文案）。
- **B5 用例调整（不是放宽断言）**：`saveWithCas` 的文档前提是「必须在 `withRunLock` 内调用」；B5 原先在锁外直接调用，等于替实现选了「写盘前 load」这个 base。现改为在 `store.withRunLock(runId, …)` 内复现：锁内 load 出 rev=1 → **另一个 store 实例（完全不经锁）** 落盘 rev=2 + 账本标记 → 本次动作写盘。断言原样保留：标记必须存活。
- **变异 M3（证明 B5 有判定力）**：把 `saveWithCas` 的 base 改回 `store.load(runId)` → **只 B5 红**（48 例 47 绿 1 红）；按备份还原后 `shasum -a 256 src/host/store.ts` = `478a0d4c9c6b27c8d9cfc927abc1281c38c59772fa16ca9fa0aa74ed6ecb7e34`，与修复版备份逐字节一致。
- **门禁（返工后，四项全绿）**：

| 命令 | 退出码 | 数字 |
|---|---|---|
| `node --test test/r60-cas-hardening.test.ts test/store.test.ts` | 0 | tests 48 / pass 48 / fail 0 |
| `pnpm typecheck` | 0 | — |
| `pnpm test` | 0 | tests 1476 / pass 1476 / fail 0 |
| `pnpm build` | 0 | lib/index.js 723.44 kB |

- **独立性声明**：D4 是复验中发现的真实缺陷，修复由 QA 在 t4 返工里完成，因此 B5 的绿**不能**当作独立复验证据；建议由非本次修复者（另一成员或队长）按 `node --test test/store.test.ts` 复核一次，并抽查「早窗口」在真实宿主事件流（usage/progress 投影）里的行为。
- **仍未验证**：`resumeRun` 的过期快照未单独构造用例；真实宿主内 usage/progress 事件与 act 的 await 窗口未做真机复现；`bindings`/`taskTimes` 的丢失形态未逐字段实测。

## 7. 独立复验（D4）（t6，复验者 ≠ 修复者；只验证、未改生产代码）

本节为追加，**不改变第 1–6 节任何结论**。复验发生在 2026-11-20 16:09–16:13 CST；所有源码改动只存在于「备份 → 变异 → 按备份还原」窗口内，终态 `src/host/store.ts` 与修复版备份逐字节一致（见 7.2 的 sha256）。

### 7.1 修复形态核对（是否夹带其它副作用）

`git diff src/host/store.ts` 全量 4 个 hunk（+223/−1），逐一核对：

| hunk | 内容 | 归属 |
|---|---|---|
| 1 | `import { isDeepStrictEqual }` | t3 三方合并 |
| 2 | `lockedSnapshot` + `mergeRunState`/`saveWithCas` 三方合并主体 | t3 |
| 3 | `RunLockFrame` 增 `bases: Map<string, RunState \| null>`（`src/host/store.ts:706`）；新增 `RunsStore.baseline(runId)`（`src/host/store.ts:757-761`） | **t4（D4）** |
| 4 | `withRunLock` 在 `await previous` 之后、`lockContext.run` 之前执行 `if (!bases.has(runId)) bases.set(runId, this.load(runId))`（`src/host/store.ts:799-802`）；可重入命中 `frame.held.has` 时直接放行、**不刷新** bases（`src/host/store.ts:787`） | **t4（D4）** |

- `saveWithCas` 的 base 选择（`src/host/store.ts:676-677`）：`recorded = baseline(runId)`，`base = recorded === undefined ? store.load(runId) : recorded`。即「锁内一律取拿锁那一刻的快照」，仅当不在锁内/不在本链锁域（`baseline()` 返回 `undefined`）或手工 fake store 没有该方法时才回退写盘前 load——与 §6.7 声明一致。
- `baseline(` 全仓只有 `saveWithCas` 一处调用（grep 确认），没有第二消费方；`bases` 只被 `baseline()` 与 `withRunLock` 读写。
- `src/host/bridge.ts:825`、`src/host/team/dispatch.ts:672/679/1005/1102` 的 `saveWithCas` 调用均为 t3 的 D1/D2 改动（diff 注释写着 r59 遗留 D1/D2），t4 未改调用姿势、未改对外返回值形状、未改任何用户可见文案。
- 结论：D4 修复就是任务卡声明的三件事，**未发现夹带副作用**；额外的 `load` 只在首次拿锁时发生一次（可重入不重复读）。

### 7.2 B5 改写是否「善意降级」：把 base 改回修复前再实跑

判定方法：独立把 `saveWithCas` 的 base 改回修复前实现（删除 `baseline` 优先分支，`const base = store.load(runId)`），实跑现版 B5；必须变红，否则改写就是放水。

- 变异命令与结果：
  `node --test test/store.test.ts test/r60-cas-hardening.test.ts` → **退出码 1**，`tests 48 / pass 47 / fail 1`，唯一红点 = B5（`test/store.test.ts:1004`），断言消息原文 `AssertionError [ERR_ASSERTION]: base 必须取「动作开始时」的锁内快照；取写盘前一刻的盘上态会让 theirs===base 分支把锁外写者的字段整段丢掉`。
- 机制（为什么变红）：现版 B5 在 `withRunLock` 内先 `load` 出 rev=1 的 `actionStart`，再由 `new RunsStore(dir)` 独立实例（完全不经锁）落盘 rev=2 + 账本标记；`saveWithCas` 用 rev=1 写盘触发 `StaleWriteError` 重试。修复版 base = 拿锁时快照（无标记）→ `theirs` 有标记 → 标记存活；修复前 base = 写盘前 load（已含标记）→ `theirs === base` → 取 ours → 标记被整段丢弃 → 红。故当前 B5 仍精确覆盖原窗口，**不是**靠把注入点挪到 base load 之后来回避。
- 还原与一致性：`cp /tmp/store.ts.d4bak src/host/store.ts`；`shasum -a 256` = `478a0d4c9c6b27c8d9cfc927abc1281c38c59772fa16ca9fa0aa74ed6ecb7e34`（与备份一致，且与 §6.7 记录的修复版哈希相同），`cmp` 无字节差异。
- 结论：**改写不具备「善意降级」**；B5 的绿是 `bases` 生效的结果，而非测试构造带来的假绿。

### 7.3 四项门禁（真实退出码，未放宽任何命令）

| 命令 | 退出码 | 数字 |
|---|---|---|
| `node --test test/store.test.ts test/r60-cas-hardening.test.ts` | **0** | tests 48 / pass 48 / fail 0 |
| `pnpm typecheck` | **0** | — |
| `pnpm test` | **0** | tests 1476 / pass 1476 / fail 0 |
| `pnpm build` | **0** | `lib/index.js` 723.44 kB（gzip 237.78 kB） |

四条的合取（`&&`）成立；门禁命令与任务卡验收判定逐字一致。

### 7.4 生产可达路径：持锁 act × 不持锁 progress/usage 投影

不写仓库的临时探针（`/tmp/qa-t6-d4-probe.ts`）用**真 `RunsStore`** 复现生产两路径交错（形状对齐 `src/host/index.ts:304` 的 progress 投影与 `:1096` 的 usage 投影——都是 `store.load` 后直接 `store.save`，不持锁）：

- 种子：v2 RunState，plan 两个任务、plan.status='running'，一条 live binding（`dev-t1`，保证 progress 不会被 `save()` 的 `capProgress` 按「非 live binding」裁掉——这也是生产里 progress 只会写 live 成员的真实前提）。
- A（持锁 act）：`store.withRunLock(runId, async () => { const actionStart = store.load(runId); await sleep(40); return saveWithCas(store, { ...actionStart, plan: { ...actionStart.plan, status: 'paused' } }) })`。
- B（锁外投影）：`await sleep(10)` 后用**另一个 `RunsStore` 实例** `load → save`，追加 `messages` 账本标记、`progress['dev-t1'] = { at, calls: 3 }`、`usage.total = { input: 120, output: 30, total: 150 }`。
- 修复版结果：**退出码 0 / PASS**——`plan.status='paused'`（act 的改存活）、账本标记存活、`usage.total.total=150` 存活、`progress['dev-t1'].calls=3` 存活；`rev` applied=disk=3。
- 反证（同探针、把 base 改回 `store.load`）：**退出码 1 / FAIL**——messages 账本、usage、progress 三项**同时被抹掉**（`rev` 仍为 3，说明是静默丢写而非写失败）。
- 结论：D4 在真实 store 读写形状与真实并发窗口下可复现、修复后可达；该探针具备判定力（同一份代码在错误实现下必红）。

### 7.5 结论与未验证项

- **结论：pass。** 修复形态与声称一致、无夹带副作用；B5 改写仍能抓住原 bug（变异实跑 48/47/1 且唯一红点）；四项门禁真实全绿；真实 `RunsStore` 的生产路径（持锁 act × 锁外 progress/usage 投影）字段不丢。
- 未验证项（不得用「全绿」代替）：
  1. **真机（第二宿主）事件流未跑**：7.4 是 store 层真实实例 + 真实并发窗口，不是宿主 `tools/result`/usage 事件时序；
  2. `resumeRun` 的过期快照仍无单独用例（t2/t4 未验证项延续）；
  3. `bindings` / `taskTimes` 的丢失形态未逐字段实测（机制同源，未单独构造）；
  4. 未单独构造「`baseline()` 在可重入嵌套时被刷新」的变异（代码审查确认 `src/host/store.ts:787` 命中 held 直接放行、`:801` 的 `if (!bases.has(runId))` 保证不刷新，但无专测）。
- 非阻塞建议：B5 测试名当前是「r60 D3 边界：…」，实际覆盖的是 D4 早窗口；建议后续改名为 D4 语境，避免 D3/D4 混淆（不影响本次判定）。
