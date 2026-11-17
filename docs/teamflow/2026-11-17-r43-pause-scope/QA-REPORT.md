# r43 QA 报告：两级暂停互不干扰（任务级 `pauseTask`/`resumeTask` × 团队级 `pause`/`resumeTeam`）

- 任务夹：`docs/teamflow/2026-11-17-r43-pause-scope/`
- 前置：t1（宿主侧两个动作 + 矩阵 + 活动时刻，门禁 `pnpm typecheck` exit 0）、t2（面板两个独立按钮，门禁 exit 0）
- 结论：**通过**。门禁三项全 0（`typecheck` / `test` / `build`），1312 例全绿；变异自检 2 条 × 4 步 = 9/9 项通过，bare 字节还原逐字节一致。
- 本轮新增：`test/r43-pause-scope.test.ts`（13 例）、扩展 `test/task-actions.test.ts`（39 → 52 格，保留计数意图）、`docs/teamflow/2026-11-17-r43-pause-scope/`（本报告 + `mutation-check.mjs`）。

## 1. 两级语义差异表（谁能冻谁 / 谁能打断成员 / 谁能被自动收口）

| 维度 | 团队级暂停（`pause` / `resumeTeam`） | 任务级暂停（`pauseTask` / `resumeTask`） |
|---|---|---|
| 冻结对象 | 计划整体（`plan.status='paused'`）+ 只把 `running`/`ready` 冻成 `paused` | 单张任务卡的 `task.status='paused'`，计划状态不变 |
| 原状态记账位置 | `RunState.pause = { at, planStatus, tasks }` | `RunState.taskPauses[taskId] = { at, from }`（**不写 `PlanTask`**，AC-10 冻结字段集） |
| 拦什么 | 派发（dispatch）/ 恢复（resume）/ 回执（receipt）——`PAUSED_BLOCKED` 三件 | 该卡的回执（`BAD_REQUEST`「先对该任务点继续」）；它自己的派发/推进由 `paused` 状态天然挡住 |
| 不拦什么 | 停用、发消息、改角色、继续、确认闸；`pauseTask`/`resumeTask` **在放行名单里** | 其它任务的一切动作（对照实验：只暂停 t1 时 t2 的 dispatch/receipt 端口各 +1） |
| 打断在跑成员？ | 不打断（只掐派发/回执/停滞推进） | 不打断（`bindings` 原样保留，实测 `member-1` 仍在） |
| 幂等 | 已 paused 且 `pause` 记录在 → 拒绝重复冻结但不改 `at` | 已 `paused` → 接受并回「已处于暂停状态」，**不 saveState**（文件 sha256 逐字节不变） |
| 谁解谁 | `resumeTeam` 只还原 `pause.tasks` 里的卡；**遇到「团队没冻过但有任务级记账」的卡保持 paused** | `resumeTask` 只按本卡 `from` 还原；**不碰 `plan.status` 与 `RunState.pause`** |
| 原状态缺失 | 回落 `ready`（不猜 `running`） | 回落 `ready`（记录缺失 / 坏数据 / 原状态为终态或 paused） |
| 能否被自动收口 | 有 `state.pause` 记录的 `paused` **跳过** `reconcileStalePlans`；「paused 无记录」的遗留账仍收口 | `taskPauses[*].at` 计入 `lastActivityAtOf`，因此「暂停着等用户」不会被 30 分钟残留收口误杀 |

## 2. 用户可见行为

1. 页头按钮：「暂停团队」/「继续团队」，`title` 明说作用域（「暂停整个团队：不再派发新任务、不再推进回执与停滞判定，但不会打断正在跑的成员」）；已暂停时琥珀色 `warn`，不是失败红。
2. 任务行第 4 颗按钮：`paused` 行显示「继续此任务」、其余显示「暂停此任务」；可访问名带任务 id（`暂停任务 t1` / `继续任务 t1`）；`title` 写「只冻结这一张任务卡：不派发、不接受回执，不影响其他任务」；`done`/`cancelled`/`skipped` 行禁用且悬停给「任务已结束，不能暂停」。
3. 视觉上「团队已暂停」在顶部横幅（计划态徽标），「单卡已暂停」在行内（`data-paused` + 琥珀状态徽标，`styles.ts:2538` 左侧 2px 琥珀条），两者靠位置而非颜色区分。
4. **团队暂停时单卡按钮仍可点**（t1 已把两个动作放进放行名单）：能冻结/解冻单卡，但页头仍是「继续团队」，文案互不污染。
5. 已暂停任务提交回执会被拒：「任务 t2 已暂停：先对该任务点「继续」再提交回执」，且**不跑门禁**。

## 3. AC → 可执行判定（每条都有会变红的判据）

| AC | 判定（`node --test test/r43-pause-scope.test.ts` 内） | 变异后是否变红 |
|---|---|---|
| 1 落盘 | 读真实 run 文件：`status==='paused'`、`taskPauses.t1==={at:NOW,from:'running'}`、账本含「已暂停任务 t1」、`bindings[0].memberId` 保留 | ① 覆盖 |
| 1 幂等 | 第二次 `pauseTask` 后文件 sha256 与第一次逐字节相同 + 「已暂停任务 t1」账本仅 1 条 | ① 覆盖 |
| 1 还原 | `resumeTask` 后 `status==='running'`、`taskPauses` 整个省略（JSON 里无此键）、账本含「已继续任务 t1」；`taskPauses` 缺失时回落 `ready` | ② 覆盖（记录缺失分支由 store 语义守） |
| 2 不干扰（单卡侧） | 只暂停 t1：`plan.status` 仍 `dispatching`、`pause===undefined`；t2 回执 `rejected===undefined` 且 `calls.receipts===1`；t3 派发 `calls.dispatch===1` | 是（端口计数，改回「一律拦」立刻为 0） |
| 2 不干扰（团队侧） | 只暂停团队：`taskPauses===undefined` 且落盘 JSON 无此键；`pause.tasks==={'t-run':'running','t-ready':'ready'}`；7 张非推进态卡逐字段深比较不变 | 是 |
| 2 两级同存 | 场景 A：`resumeTeam` 后单卡 t1 仍 `paused`、记账保留、t2 还原 `running`；场景 B：`resumeTask` 后 `plan.status` 仍 `paused`、`pause` 记录仍在、t2 仍 `paused` | **变异 ①：红**（实测） |
| 3 拒绝与文案 | `done/cancelled/skipped` → `BAD_REQUEST` + `任务 tX 当前状态为「已通过/已取消/已跳过」，任务已结束，不能暂停`（逐字）；拒绝后文件 sha256 不变；未暂停 `resumeTask` → `该任务没有处于暂停状态（任务 t1 当前为「就绪」）`；`paused` 回执被拒且文案含 `t2`、`calls.receipts` 不增 | 是（文案逐字 + 计数） |
| 4 不被误收口 | `lastActivityAtOf` 计入 `taskPauses.at`（其他时刻均为 1 小时前，期望值 `NOW-1000`）；`reconcileStalePlans`：全部时刻 2 小时前的「paused + pause 记录」run 不被收口且 `termination===undefined`，同批「paused 无记录」的遗留 run 被收口成 `terminated`/`stale` | **变异 ②：红**（实测） |
| 5 矩阵完整性 | `test/task-actions.test.ts`：52 格逐格快照 + `cells===52` + 逐行恰好 4 列 + 专门用例断言 pause 列「除三终态外全允许、`paused` 行必须允许」、拒绝原因逐字 | 是（改一格即红） |
| 6 客户端 | 纯函数：`pauseButtonView` 两态文案/hook/action/tone/title（busy 只置 disabled）；13 态逐态 `label`/`data-task-action='pause'`/`pauseCommand.type`/`ariaLabel`/`disabled` 与矩阵同源；源码断言 `data-task-action="pause"`、`taskPauseCommandOf(task.id, task.status)`、`row.pauseAction.label`、页头无裸「暂停」/「继续」字面量 | 是（改文案/换动作名即红） |

> 「面板动作数 20」类计数断言：本仓**不存在**以 20 为界的动作数断言。实际存在的是 `test/task-actions.test.ts` 的 39 格快照与 `test/client-ui.test.ts` 的四动作 52 格循环——前者由我按 r43 扩成 52 格并保留计数意图（`cells===52` 注释写明「39 → 52 是扩列，不是删断言」），后者 t2 已改成 52 格。`src/shared/task-actions.ts` 顶部注释已是「13 态 × 4 动作」，测试里没有反向写死「×3 动作」或旧页头文案的断言（唯一一处引用页头按钮名的矩阵文案用前缀正则 `^已暂停：先点页头『继续` 守住语义，见缺陷 D1）。

## 4. 变异矩阵（`node docs/teamflow/2026-11-17-r43-pause-scope/mutation-check.mjs`，exit 0，9/9）

| 变异 | 改动 | 期望 | 实测 |
|---|---|---|---|
| M1 | 删 `src/host/bridge.ts:2343` 的守卫 `if (restore[task.id] === undefined && state.taskPauses?.[task.id] !== undefined) return task` | 场景 A 必红 | exit 1，红：**AC2 两级同时存在…**，绿 12/13 |
| M1 还原 | 写回原字节 | sha256 与变异前一致 | `087550bd1bfa4f49…` 一致，复跑 13/13 绿 |
| M2 | 删 `src/host/store.ts:281` 的 `for (const record of Object.values(state.taskPauses ?? {})) bump(record?.at)` | 用例 4 必红 | exit 1，红：**AC4 lastActivityAtOf 计入 taskPauses.at…**，绿 12/13 |
| M2 还原 | 写回原字节 | sha256 与变异前一致 | `53e78845476b755a…` 一致，复跑 13/13 绿 |

还原后全文 `grep -rn MUTATION src/` = 0 命中；两条目标行在 `src/host/bridge.ts:2343` / `src/host/store.ts:281` 原位。

## 5. 缺陷 / 偏差清单（症状 / 根因 / 复验命令）

### D1（缺陷，建议修改，不在 QA 写域）「已暂停」两处禁用文案指向已改名的按钮
- **症状**：`paused` 行点「取消」时提示「已暂停：先点页头『继续任务』」，而 t2 已把页头改成「继续团队」——用户按文案找不到按钮。
- **根因**：文案在 `src/shared/task-actions.ts` 的 MATRIX 里（`paused: ['已暂停：先点页头『继续任务』', …]`），t1 加矩阵列时未随 t2 的改名同步；`src/shared/` 不在本任务写域，我无法修。
- **复验**：`grep -n "先点页头『继续任务』" src/shared/task-actions.ts`（当前 1 命中）+ `grep -n "暂停团队\|继续团队" src/client/ui.ts`（已是团队文案）。测试侧已用前缀正则避免把过期文案反向写死，修文案不会让 r43 变红。

### D2（可接受偏差）DOM 钩子名与 AC 字面不一致
- **症状**：AC 写 `data-team-pause`，实际是 `data-auto-team-pause`（r7 起既有钩子，`src/client/views/RunHeader.tsx:55`）。
- **根因**：沿用既有命名，改名会破坏历史样式/探针选择器。
- **判定**：**可接受**——语义（区分团队级 vs 任务级）由「页头 `data-auto-team-pause` / 行内 `data-task-action="pause"`」保证，测试断言的是真实钩子。

### D3（可接受偏差）AC2 字面「只暂停团队时不改变任何 `task.status`」按 r7 语义收窄
- **症状**：团队 `pause` 确实会把 `running`/`ready` 写成 `paused`（`src/host/bridge.ts:2297-2305`）。
- **根因**：r7 团队暂停的既有契约就是「冻结可推进任务 + 计划置 paused，原状态记 `RunState.pause.tasks`」；改成完全不动 `task.status` 会推翻 r7 的恢复路径与回执闸门。
- **判定**：**可接受**——r43 要守的是「团队暂停**不写任务级账本**、不动非推进态任务」；测试按此收窄为：`taskPauses` 必须缺省 + 7 张非 `running/ready` 卡逐字段深比较不变 + 冻结集合只记在 `pause.tasks`。若产品坚持字面语义，需另开需求重做 r7 的冻结模型。

## 6. 未验证项（不能用「构建通过」代替）

1. **真机面板需重启**：本报告只做纯函数 + 源码断言，未在 DeepSeek Harness 真机点过按钮；页头/行内按钮的实际渲染、`ascii` 断行与 320px 宽度下状态徽标是否被挤掉，需要重启宿主后目视（`docs/teamflow/architecture/REAL-HOST-VERIFY.md`）。
2. **暂停期间成员仍在跑**：任务级/团队级暂停都**不打断**在跑成员，成员在暂停期间仍可能继续消耗 token 并写文件——该风险由既有 PAUSED 闸门（派发/回执/推进被拦）兼顾，本轮未做「暂停杀成员」的验证，也不是本需求目标。
3. **watcher 的 `interrupted` 判定**：`resumeTask` 还原成 `running` 但成员已不在时，交由 watcher 下一 tick 判 `interrupted`；本轮只断言「本动作不判 failed」，未跑 watcher 的实时 tick（t1 边界明确不在本需求动 watcher）。
4. **跨 run 目标**：`pauseTask`/`resumeTask` 走 `stateOf(sessionId)` 取活动 run，未验证「团队暂停在 run A、单卡动作被指到 run B」的边界组合。

## 7. 门禁证据（全部实跑）

| 命令 | 退出码 | 输出尾部 |
|---|---|---|
| `pnpm typecheck` | 0 | `> tsc --noEmit`（无输出） |
| `pnpm test` | 0 | `ℹ tests 1312` / `ℹ pass 1312` / `ℹ fail 0` / `ℹ duration_ms 11660` |
| `pnpm build` | 0 | `ℹ lib/index.js 665.84 kB │ gzip: 219.50 kB` / `ℹ lib/client.js 616.28 kB │ gzip: 153.00 kB` / `✔ Build complete` |
| `node --test test/r43-pause-scope.test.ts` | 0 | 13/13 pass |
| `node --test test/task-actions.test.ts` | 0 | 6/6 pass（含 52 格与 pause 列口径） |
| `node docs/…/mutation-check.mjs` | 0 | `变异自检全部通过：9/9 项` |
| `node --input-type=module -e "await import('./lib/index.js')"` | 0 | 无输出（HOST_IMPORT_OK） |
| `node --input-type=module -e "await import('./lib/client.js')"` | 0 | 无输出（CLIENT_IMPORT_OK） |

### lib 双产物（构建后实测）

| 产物 | 字节 | sha256 |
|---|---|---|
| `lib/index.js` | 665840 | `fca1227da5ea50fe41a84c6fc1515002369ae54677150d0bd40144110eec440b` |
| `lib/client.js` | 616276 | `af5ed44665b641549b6d63f8695205cb157ea920456a19277c148039e9d1ef3b` |

## 8. 建议修改 / 可接受（两栏对照）

| 建议修改（有证据的问题） | 可接受（偏差/风险说明） |
|---|---|
| D1：把 `src/shared/task-actions.ts` 中 `paused: ['已暂停：先点页头『继续任务』', …]` 改成「继续团队」；同时清掉矩阵里对页头按钮名的过期引用（改文案只需改这一处，测试用前缀正则不会红） | D2：`data-auto-team-pause` 与 AC 字面 `data-team-pause` 不一致——沿用 r7 既有钩子，避免破坏历史选择器与样式 |
| —（无其它功能缺陷；`taskPauses` 空对象被规范化为 `undefined` 已在落盘 JSON 上断言） | D3：团队暂停仍会冻结 `running/ready` 的 `task.status`——按 r7 既有契约收窄 AC2 的字面表述，并用「不写 taskPauses + 非推进态逐字段不变」守住互不干扰 |
| — | 未验证项 1/2/3/4 见 §6；其中「真机面板」需重启宿主后目视，本轮**不**声称已验证真机行为 |
