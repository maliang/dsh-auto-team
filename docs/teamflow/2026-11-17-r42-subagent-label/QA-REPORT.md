# r42 QA 报告：spawn label = 任务名（首行 / 截断 / 空标题）+ 门禁

- 任务夹：`docs/teamflow/2026-11-17-r42-subagent-label/`
- 被测变更：t1（`src/host/index.ts`，git diff `1 file changed, 4 insertions(+)`）
- 回归用例：`test/r42-subagent-label.test.ts`（4 例，全部通过）
- 门禁结论：**全绿**（typecheck / 1297 例测试 / 双产物构建，退出码均 0）

## 1. 现象（用户可见）

顶部「N 个子智能体」下拉里，成员显示的是任务 id `t1`、`t2`，而不是任务名。

## 2. 根因链（已用宿主边界捕获复现）

1. 宿主下拉的可见短标签来自成员创建请求的 label：
   - 新宿主路径：`src/host/adapters.ts:1343 label: subagentLabelOf(input)`；
   - 旧宿主回退：`src/host/adapters.ts:1373 description: input.description ?? `任务 ${input.taskId}``。
2. `src/host/adapters.ts:1022 subagentLabelOf(input)` 的优先级是
   `description → taskId → name`（取第一个 `trim() !== ''` 的值），截断上限
   `SUBAGENT_LABEL_MAX = 64`（`src/host/adapters.ts:1018`）。
3. 修复前 `src/host/index.ts` 的 spawn 端口只传了
   `prompt / name / route / sessionId / taskId`，**从未传 `description`** →
   `subagentLabelOf` 的候选列表里没有任务名 → label 恒等于 `taskId`（`t1`）。

变异自检复现了这条链：删掉修复行后，新宿主路径捕获到的 label 是 `t-long`，
旧宿主路径捕获到的 description 是 `任务 t-long`（见 §4）。

## 3. 修复点（t1，逐行）

| 位置 | 内容 |
|---|---|
| `src/host/index.ts:63` | `import { ..., taskLabelOf, ... } from './team/dispatch.ts'` |
| `src/host/index.ts:411-413` | 三行注释：`description = 任务名 = 宿主下拉可见的 label`，缺了就退化成 taskId |
| `src/host/index.ts:414` | `description: taskLabelOf(input.task),` |
| `src/host/team/dispatch.ts:1203-1211` | `taskLabelOf`：取 `title` 第一行、trim、按 code point 截到 `TASK_LABEL_MAX=60`，超出以 `…`（占 1 位）结尾（`src/host/team/dispatch.ts:122/1207/1208`） |
| `src/host/adapters.ts:1018/1022-1028` | `SUBAGENT_LABEL_MAX=64` 与 `description → taskId → name` 优先级（本次未改） |
| `src/host/adapters.ts:1343` | `label: subagentLabelOf(input)`（新宿主 `subagents.startActivation`） |
| `src/host/adapters.ts:1373` | `description: input.description ?? \`任务 ${input.taskId}\``（旧宿主回退） |

`name` 未改：`<roleId>-<taskId>-<suffix>`（幂等与复用匹配依赖它）。

## 4. 验收判据（AC → 可执行判定）

假 ctx 跑**真实 `apply()`**，在宿主边界捕获入参；断言的是「宿主真正收到的字段」，
不是源码里有没有那行字。

| # | 判据 | 用例 | 结果 |
|---|---|---|---|
| 1 | 长多行标题：`startActivation.label` = 第一行、按 code point 截到 60、带 `…` | `r42-1` | ✅ `label` = 期望的 60 位；无换行、无后续行、≠ `t-long` |
| 2 | 标题为空/只有空白：`description` 退化为空串，不抛错、不甩任务卡正文 | `r42-2` | ✅ `description === ''`；无换行、无 `acceptance=`；spawn 成功；成员名形状不变 |
| 3 | `subagentLabelOf` 优先级：description 存在时优先于 taskId | `r42-1` / `r42-4` / `r42-3` | ✅ 新宿主 label=任务名≠`t-long`；旧宿主 description=任务名≠`t-long` |
| 4 | 既有行为不变：`name` 仍是成员名；spawn 成功仍装 progress 订阅 | `r42-2/3` + `test/wire.test.ts` | ✅ name 匹配 `^dev-t-long-[0-9a-z]+$`；`wire.test.ts` 5/5 通过（含 disposers=6：watcher / 进度订阅 / noWait / Trigger / 留痕 / 用量） |

实现细节：

- 空标题用例刻意**直接落 run 状态**再走面板派发，而不是走 `plan` 工具：
  `src/host/plan/plan.ts:44/55` 会 `title.trim()` 并拒绝空标题；
  现实中空标题来自旧 run / 手改状态文件，派发层仍必须安全降级。
- 新宿主、旧宿主两条路径都覆盖：`subagents.startActivation` 与
  `agentTeams.spawnTeammate`。

### 变异矩阵（≥1 条，已字节还原）

变异：删除 `src/host/index.ts:414 description: taskLabelOf(input.task),`
（回到只传 taskId）。

| 用例 | 变异前 | 变异后 | 实际捕获值（变异后） |
|---|---|---|---|
| r42-1 新宿主长标题 | ✅ | ❌ | label=`t-long`（期望 60 位任务名） |
| r42-2 空白标题 description | ✅ | ❌ | description=`任务 t-long`（期望 `''`） |
| r42-3 旧宿主 description | ✅ | ❌ | description=`任务 t-long`（期望 `修复登录跳转`） |
| r42-4 description 优先 | ✅ | ❌ | label=`t-long`（期望 `把任务名当 label`） |

- 变异后：`tests 4 / pass 0 / fail 4`。
- 还原：`shasum -a 256 src/host/index.ts` → `9a445ab6521df5c8045e89dc780bac59c66dc6d526cd3c34f26b86d8c82e45d4`，
  与备份 `cmp` 字节一致；还原后 4/4 复绿。

## 5. 门禁证据

命令：`pnpm typecheck && pnpm test && pnpm build`

| 阶段 | 退出码 | 证据尾部 |
|---|---|---|
| `pnpm typecheck` | 0 | `> tsc --noEmit`（无输出） |
| `pnpm test` | 0 | `ℹ tests 1297` / `ℹ pass 1297` / `ℹ fail 0` |
| `pnpm build` | 0 | `ℹ lib/index.js 659.52 kB │ gzip: 218.11 kB`、`✔ Build complete in 49ms` |

产物（构建后实测）：

| 产物 | 字节 | sha256 |
|---|---|---|
| `lib/index.js` | 659520 | `ad25309ab0e5c9fe774cde636a29887f40a8b5b83949ea3e6a6af97455184954` |
| `lib/client.js` | 607171 | `55e850838a73876f2784fd78410f4f1d5e4d63d6095b6276bf949f0a1bc9f7c6` |

双 import（均 exit 0）：

```
node --input-type=module -e "await import('./lib/index.js')"   → index-import: OK
node --input-type=module -e "await import('./lib/client.js')"  → client-import: OK
```

产物包含修复（非源码假绿）：`grep -c taskLabelOf lib/index.js` = 6，
且可见 `description: taskLabelOf(input.task)` 字面量。

定向复跑：

- `node --test test/r42-subagent-label.test.ts` → `tests 4 / pass 4 / fail 0`
- `node --test test/wire.test.ts` → `tests 5 / pass 5 / fail 0`（装配层无回归）

## 6. 未验证项（不得用「构建通过」代替真机行为）

1. **宿主下拉真实渲染未验证**：需要在宿主重启后**新建**成员才能在「N 个子智能体」
   下拉里看到任务名。本报告只验证到宿主边界入参（`startActivation.label` /
   `spawnTeammate.description`），catalog 侧渲染未实测。
2. **旧成员 label 已固化**：修复只对新派发成员生效；已存在的成员不会回写，
   下拉里仍显示 `t1`。用户可见预期见 §7。
3. 宿主对 `label` 的展示策略未实测：空标题时 label 会回退成 `taskId`（既有回退，
   适配层 64 上限兜底），宿主导航如何显示这个回退值未验证。
4. 宿主 0.2.2-rc.2 对 `label` 的空串容忍度/真实上限未实测（注释称约 64）。

## 7. 用户可见预期

- 重启宿主后**新派发**的成员，顶部下拉显示任务名（标题第一行，超长以 `…` 结尾）。
- **已有成员需要重新派发才改观**：成员 label 在创建时固化，升级本插件不会改写旧成员；
  对旧成员不要期待下拉文字变化（成员名 `name` 未变，幂等/复用不受影响）。
