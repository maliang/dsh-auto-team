# r18 · t1 右栏任务列表只显示进行中任务

日期：2026-11-05
任务：r18 / t1
状态：已实现，门禁通过

## 1. 需求（用户原话）

> 右侧面板中的任务只显示正在进行中的任务，当所有任务都完成后显示最后一个任务。

与用户确认后的实现口径：

1. 右栏任务页的任务列表只显示「进行中」任务。
2. 没有任何进行中任务、且存在已完成任务时，列表只显示**最近完成的一个** `done` 任务。
3. 进度环仍按**全量**任务算（`done/total` 与 `ratio` 不变），只有列表被过滤。
4. 分组结构不变：`groups.open` 放进行中任务；`groups.done` 仅在没有进行中任务时放那一个最近完成的任务，否则为空数组。
5. 空任务列表不崩：环 `0/0`，两个分组都空。

## 2. 实现位置（单点派生）

| 位置 | 作用 |
|---|---|
| `src/client/viewmodel.ts` · `isOngoingTaskStatus` | 「进行中」口径的唯一判定：状态不是 `done` / `cancelled` / `skipped` |
| `src/client/viewmodel.ts` · `recentCompletedTaskOf` | 「最近完成」的唯一判定点（纯函数，可单测） |
| `src/client/viewmodel.ts` · `taskOverviewOf` | 环与列表的**唯一**派生点；环按全量、列表按新口径过滤 |
| `src/client/views/TaskTable.tsx` · `GROUP_LABEL` | 组头文案改为「进行中 · N」/「最近完成 · N」 |
| `src/client/views/TaskOverview.tsx` | 仅注释更新；逻辑仍是「先调一次 `taskOverviewOf`，再把 `tasks` 交给 `TaskTable grouped`」 |

关键纪律：**过滤只发生在 `taskOverviewOf` 里**。`TaskTable` 是 props 驱动的组件（历史详情页也在用），组件内不做二次过滤，否则列表与环会分叉（r14 AC-11 的同帧一致）。

## 3. 判定规则

### 3.1 「进行中」

```
进行中 = status ∉ { done, cancelled, skipped }
```

即 `pending` / `ready` / `running` / `gate` / `rework` / `waiting` / `blocked` / `failed` / `interrupted` / `paused` 全部算进行中（都仍需用户关注）。

`cancelled` / `skipped` 是用户主动终止的终态：**既不算完成、也不算进行中**，两个分组都不出现。环的分子同样只认 `done`，所以它们只影响分母。

### 3.2 「最近完成」（确定性，可单测）

只在 `status === 'done'` 的任务里挑，排序键按字典序：

1. 带 `evidence.at`（门禁时间，有限正数）的任务优先于不带的；
2. 都带时比 `evidence.at`，**大者胜**；
3. 时间相等，或都不带时，回退到**计划索引**，**靠后者胜**（索引大者胜）。

`evidence.at` 缺失、非数字、非有限或非正数，一律视为「没有门禁时间」，走第 3 条回退。

### 3.3 分组与环

- `groups.open`：全部进行中任务，保持计划顺序；任务行仍可展开详情。
- `groups.done`：仅当 `groups.open` 为空且存在 `done` 任务时，放 `recentCompletedTaskOf` 选出的那 1 行；否则 `[]`。
- 环：`done` = `status === 'done'` 的数量（全量），`total` = 全部任务数，`ratio = done / total`（`total === 0` 时 0），`text = "done/total"`。列表过滤不影响环。
- 空列表：`0/0`、`ratio = 0`、`dashOffset = 圆周长`、`groups.open = groups.done = []`，无 `NaN` / `Infinity`。

## 4. 测试覆盖

新增 `test/r18-task-list.test.ts`（8 个用例）：

| 用例 | 覆盖点 |
|---|---|
| `isOngoingTaskStatus` | 13 态逐一核对「进行中」口径 |
| 混合状态 | 只返回进行中任务、保持计划顺序、`done` 组为空 |
| 全部 done | 只回 1 个，且是 `evidence.at` 最大的 |
| cancelled / skipped | 两个分组都不出现；混入 done 时最近完成组只放 done |
| 环仍按全量 | 2 done + 1 running → `2/3`、`ratio = 2/3`、`dashOffset = C/3`，列表只有 1 行 |
| 空任务列表 | `0/0`、两组都空、无 NaN / Infinity |
| 最近完成排序 | evidence.at 胜过更靠后的索引；无 evidence 时索引大者胜；evidence 优先于缺失；时间相等回退索引；非 done 不参与 |
| 组件契约 | `TaskTable` 组头文案是「进行中」/「最近完成」、分组只消费 `overview.groups[key]`、不再残留旧文案；`TaskOverview` 仍走同一次 `taskOverviewOf` + `grouped` |

既有测试的最小更新：

- `test/task-overview.test.ts`：该文件原先断言「未完成 = 所有非 done 状态」的旧分组行为，与新口径冲突（我的改动导致报红），按新规则做了最小更新（2 done + 1 running 时 `done` 组为空；cancelled/skipped 两组都不出现）。其余断言（环算术、0/0、13 态分子、同帧一致性）保持不变。
- `test/viewmodel.test.ts`、`test/client-ui.test.ts`：未改动，无需更新（其中没有旧分组断言）。

## 5. 门禁

```bash
pnpm typecheck && node --test test/r18-task-list.test.ts test/viewmodel.test.ts test/client-ui.test.ts
```

结果：退出码 `0`；`tests 125 / pass 125 / fail 0`（typecheck 通过）。
补充：`node --test test/task-overview.test.ts` 退出码 `0`；`pnpm test` 全量套件全绿。

## 6. 边界与未做

- 未跑 `pnpm build`（按任务要求），`lib/client.js` 仍是旧产物，需要发布时再构建。
- 未 `git commit`。
- 未改样式（`styles.ts` 中「未完成/已完成」的注释是历史文案，与本改动无关）。
- 历史详情页（`LibraryPage` 的 `TaskOverview` 与 `TaskTable` 非 grouped 形态）不受影响：非 grouped 路径仍渲染全量任务。

## 7. 补丁（真机复验后，2026-11-05 09:12）

真机发现「全部完成」时同时渲染「进行中 · 0」和「最近完成 · 1」两个组头，空组是噪音。

- `src/client/views/TaskTable.tsx`：grouped 分支先
  `['open','done'].map(key => ({key, rows: overview.groups[key]})).filter(g => g.rows.length > 0)`；
  过滤后为空则返回空 Fragment（整块分组列表不渲染，进度环仍在 TaskOverview 中显示 0/N）；
  非 grouped（历史详情）路径不变。
- `test/r18-task-list.test.ts`：新增 3 例（过滤源码契约、两组全空守卫、真实数据侧三态）。
- 门禁：`pnpm typecheck && node --test test/r18-task-list.test.ts test/task-overview.test.ts test/client-ui.test.ts` → exit 0，58/58；全量 874/874（见同目录 ACCEPTANCE.md）。
- 真机：`r18-tasks-all-done.png` 只剩「最近完成 · 1」。
