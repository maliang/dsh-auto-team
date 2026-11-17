# r49 QA 报告：召集路径的 parent 身份 + 队长判断性语义

- 任务：t5（回归 t3 的 parent 修复 + t4 的队长语义改写）
- 日期：2026-11-17
- 结论：**PASS**（定向 5 条全绿；变异 `resolveCaller` 后 ①② 变红、源文件字节还原；全量门禁 `pnpm typecheck && pnpm test && pnpm build` 退出码 0）
- 新增用例：`test/r49-convene-parent.test.ts`（337 行，md5 `31cd437d41419844938b996f013cf1da`）
- 被测实现：`src/host/adapters.ts:1415`（`const parent = liveCallerOf(ctx, input.sessionId)`，md5 `095afc065e0dd50d75ae7d0c722cfc0b`）；`src/host/prompt.ts`（md5 `7c881348a0797a3ad7905fceb9fc2e74`）

## 1. 判定方式

三条链路各自独立取证据，不互相「借绿」：

1. **身份判据用引用相等**：宿主 `startActivation` 的身份检查是 `ctx.get('agents').get(spec.parent.id) !== spec.parent` → UNAUTHORIZED。因此夹具里让 `currentInitiator()` 与 `agents.get(SESSION)` 返回**两个同 id 但不同引用**的对象（`{ id: 'sess-r49', kind: 'live' }` vs `{ id: 'sess-r49', kind: 'decoy' }`），断言用 `assert.equal(specs[0].parent, live)`（严格相等）。`deepEqual`/按 id 比较会放过这个 bug，所以不用。
2. **召集时机用「当次调用内」判据**：真 bridge（`createBridge`）+ 真 `applyReceipt` + 真 `dispatchReady` + 真 `createSpawnPorts`，`HOME` 指向临时目录；`act('receipt')` 返回后**立刻**断言 `spawns.length === 1`，无 sleep 无轮询 —— 只靠 tick 轮询的实现在这里 spawn 数为 0（本 harness 没有任何 auto-dispatcher）。
3. **队长语义双口径**：渲染结果（`captainSection(...)`）断言两句关键规则与字符预算；源文件**剥注释后**扫旧白名单字样（注释里的历史说明不进模型上下文，不算回流）。

## 2. AC 逐条判定

| AC | 断言内容 | 用例 | 结果 | 证据 |
|---|---|---|---|---|
| ① | `spawn` 把 `agents.get(sessionId)` 的**活实例**作为 `startActivation` 的 parent；同 id 的 initiator 对象被明确拒绝 | `① spawn 用 agents.get(sessionId) 的活实例作 parent（同 id 的 initiator 不算）` | PASS | `adapters.ts:1415` → `liveCallerOf:1973` → `liveAgentOf:1938`（`ctx.agents.get`） |
| ①b | `agents.get` 缺失时回退 `currentInitiator()`（老宿主不退化） | `①b agents.get 取不到活实例时回退 currentInitiator（旧行为不丢）` | PASS | 夹具 `withAgentsGet: false`；`specs[0].parent === initiator` |
| ①c | 活实例与 initiator 都没有时仍报 NO_CALLER，且**不得**调用 `startActivation` | `①c 活实例与 initiator 都没有时仍报 NO_CALLER（不给假 agent）` | PASS | `result.ok === false`，`error` 匹配 `/当前没有活跃的队长会话/`，`specs.length === 0` |
| ② | 真 bridge：`receipt` 落 review 后**当场**走 `conveneReviewers → spawn`，召集出 `qa-review-*`、发消息带队长 session id、末端 parent 仍是活实例、状态已落盘 | `② 真 bridge：receipt 落 review 后当场走 conveneReviewers→spawn，parent 是活实例` | PASS | `bridge.ts` receipt 分支 `await deps.dispatch(next)`；`dispatch.ts` `conveneReviewers`；`spawns.length === 1`（act 返回即断言） |
| ③ | 常驻段含「拿不准」与「开关打开时队长不得自己改代码」；旧本仓路径白名单（`src/** test/**`、`pnpm-lock.yaml`、`cordis.patch.yml`、`.github/workflows/**`、`scripts/**`）在渲染结果与剥注释源码中均 0 命中；段落 ≤2600 字符 | `③ 队长段落含「拿不准」与「开关打开时不得自己改代码」，旧路径白名单字样为 0` | PASS | 段落实测 **1740** 字符；5 个 token 的 `prose.includes === false` |

定向执行：`node --test test/r49-convene-parent.test.ts` → `tests 5 / pass 5 / fail 0`，退出码 0。

## 3. 变异测试（必须变红，之后字节还原）

```bash
md5 -q src/host/adapters.ts            # 095afc065e0dd50d75ae7d0c722cfc0b
cp src/host/adapters.ts /tmp/r49-adapters-mut.ts
perl -pi -e 's/const parent = liveCallerOf\(ctx, input\.sessionId\)/const parent = resolveCaller(ctx)/' src/host/adapters.ts
node --test test/r49-convene-parent.test.ts   # 期望变红
cp /tmp/r49-adapters-mut.ts src/host/adapters.ts
md5 -q src/host/adapters.ts            # 必须回到 095afc06…
```

| 变异 | 预期 | 实际 | 还原 |
|---|---|---|---|
| A：`adapters.ts:1415` 的 `liveCallerOf(ctx, input.sessionId)` 改回 `resolveCaller(ctx)`（t3 之前的老实现） | ① 与 ② 变红 | `✖ ①`：`AssertionError: parent 必须是 agents.get 返回的那个实例，而不是 currentInitiator`，`actual: { id: 'sess-r49', kind: 'decoy' }` / `expected: { id: 'sess-r49', kind: 'live' }`；`✖ ②`：`AssertionError: 召集路径的 parent 必须是 agents.get 的活实例`。`tests 5 / pass 3 / fail 2`，退出码 1 | 还原后 `md5 -q` = `095afc065e0dd50d75ae7d0c722cfc0b`，与变异前一致；复跑 5/5 绿 |

`①b` / `①c` / `③` 在变异下保持绿是**预期**：回退分支与没有 caller 的分支在 `resolveCaller` 老实现下行为本来就相同，它们守的是「修复不得顺手删掉旧行为」。

## 4. 全量门禁

```bash
pnpm typecheck && pnpm test && pnpm build
```

| 命令 | 退出码 | 输出尾部 |
|---|---|---|
| `pnpm typecheck`（tsc --noEmit） | 0 | 无报错 |
| `pnpm test`（node --test test/*.test.ts） | 0 | `tests 1362 / suites 0 / pass 1362 / fail 0 / cancelled 0 / skipped 0`，`duration_ms 9357.99` |
| `pnpm build`（client + host 双产物） | 0 | `lib/client.js 636.80 kB │ gzip: 158.92 kB`、`lib/index.js 695.29 kB │ gzip: 228.17 kB`，均 `✔ Build complete` |

整链一次执行，三项退出码全 0，未见既有用例回归（本次新增 5 例）。门禁跑动前后 `test/r49-convene-parent.test.ts` 的 md5 均为 `31cd437d41419844938b996f013cf1da`（无并发改写）。

## 5. 未验证项（全绿也要报）

1. **未在真宿主里触发 UNAUTHORIZED**：夹具证明「交给 `startActivation` 的 parent 是 `agents.get` 的同一实例」，宿主侧那条 `get(spec.parent.id) !== spec.parent` 检查本身没有在真实 GUI 里跑过（本机没有起第二宿主做真机回放）。因此「宿主不再拒」是从 t3 的直投结论 + 引用相等断言推出的，不是真机观测。
2. **②的 spawn 端口是桩**：`subagents.startActivation` 是夹具（只记录 spec 并返回 `childId`），未验证真实子 agent 创建后的交付/续聊行为；真实装配层把 `input.plan.sessionId` 传给 `spawnPorts.spawn` 这条接线只做了源码比对（`src/host/index.ts:551`）。
3. **队长语义只验证了文本**：断言证明常驻段含两句规则、旧白名单消失、长度 1740 ≤ 2600；未验证模型在多语言仓库（Go/Vue/Python）里**实际**会按「拿不准一律按代码」组队 —— 那需要真会话观测，单测做不到。
4. **门禁全绿 ≠ 端到端可用**：`pnpm build` 通过只说明双产物可产出，`lib/*.js` 的产物行为未在本轮用 `node --input-type=module -e "await import(...)"` 复验（t3/t4 时期验过）。

## 6. 缺陷

本轮未发现缺陷。回归中唯一一次红来自 §3 的人为变异（预期行为），已字节还原。

## 7. 复跑方式

```bash
cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
node --test test/r49-convene-parent.test.ts     # 定向：5/5
pnpm typecheck && pnpm test && pnpm build       # 全量门禁：三项退出码 0
```

用例只用临时目录 + 临时 `HOME`（`mkdtempSync` + `process.env.HOME` 覆写并在 `finally` 里还原），不写真实 profile。
