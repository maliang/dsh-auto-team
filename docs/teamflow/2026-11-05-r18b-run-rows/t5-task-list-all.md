# r18b t5 · 任务列表恢复全量

日期：2026-11-05
写域：`src/client/viewmodel.ts`、`src/client/views/TaskTable.tsx`、`src/client/views/TaskOverview.tsx`、`test/r18-task-list.test.ts`、`test/task-overview.test.ts`、本文档。

## 1. 为什么回滚 r18 的过滤

r18 曾把右栏任务列表改成「只列进行中任务；全部完成时只留最近完成的一个」（`isOngoingTaskStatus` + `recentCompletedTaskOf`）。用户 2026-11-05 最新口径：

> 角色卡区域下方的任务列表要显示全部任务。

即取消过滤、恢复全量；r18 的「空组不渲染」修复（真机问题：全部完成时出现「进行中 · 0」组头）保留。

## 2. 实现

### `src/client/viewmodel.ts`
- `taskOverviewOf` 恢复为 r18 之前的全量分组：
  - `groups.open` = 所有 `status !== 'done'` 的任务（**`cancelled` / `skipped` 也进 open**，不再被剔除），保持计划顺序；
  - `groups.done` = 所有 `done` 任务，保持计划顺序（不按 `evidence.at` 重排）；
  - 环不变：`done` = done 数（cancelled/skipped 计入分母、不计入分子），`ratio = done/total`，`dashOffset` 同源。
- 删除 `isOngoingTaskStatus`、`recentCompletedTaskOf` 及其私有助手 `evidenceAtOf`：全仓无其它引用（`src/` 与 `test/` 已 grep 确认；唯一使用者是本任务重写后的 `test/r18-task-list.test.ts`）。`TaskStatus` import 仍被 `statusBadge` 等使用，保留。

### `src/client/views/TaskTable.tsx`
- `GROUP_LABEL` 恢复：`open: '未完成'`、`done: '已完成'`（组头渲染为「未完成 · N」/「已完成 · N」）。
- 保留空组不渲染逻辑：`groups.filter((group) => group.rows.length > 0)`；两组都空时返回空 Fragment（整块列表不渲染）。
- `data-task-group` / `data-group-head` / `data-task-row` 等钩子未变；组件仍不做二次过滤。

### `src/client/views/TaskOverview.tsx`
- 只更新注释：环与列表都按全量任务；r18 过滤已回滚；空组由 TaskTable 隐藏。结构与派生方式（单次 `taskOverviewOf`）未动。

## 3. 测试

- `test/r18-task-list.test.ts`：整体重写为新口径。覆盖：全部任务出现（cancelled/skipped 在 open 组）、done 全量且保计划顺序、13 种状态归属、环仍 done/total、空列表 0/0、组头文案「未完成/已完成」且 r18 文案无残留、空组过滤与两空守卫、旧助手已删除。
- `test/task-overview.test.ts`：恢复/更新旧断言（done 组回全量、cancelled/skipped 留在未完成组）；环几何与 0/0 断言不变。
- `test/viewmodel.test.ts`：经 grep 确认不含 `taskOverviewOf` / `groups` 相关断言，未改。
- `test/client-ui.test.ts`：无组头文案断言（只断言 `taskOverviewOf`/`grouped`），未改。

## 4. 门禁结果

命令：`pnpm typecheck && node --test test/r18-task-list.test.ts test/task-overview.test.ts test/viewmodel.test.ts test/client-ui.test.ts`

- `pnpm typecheck`：**退出码 2（未通过）**，但错误全部落在写域外、由并行任务在改的文件：
  `src/client/tabs/TasksTab.tsx`（`switcher` 未定义、`RunSwitcherProps.onBack`）、`test/r18-run-cards.test.ts`、`test/run-switcher.test.ts`（`nav.ts` 未导出 `RunSwitcherView` / `runSwitcherOf`）。
  对写域做 scoped grep（`viewmodel.ts` / `views/TaskTable` / `views/TaskOverview` / `test/r18-task-list` / `test/task-overview`）**零错误**。
- `node --test` 四文件：**退出码 0，131 pass / 0 fail**。

## 5. 未做事项 / 需要其它任务处理

- **`test/r18-styles.test.ts` 会失败（不在本任务写域，未改）**：
  - ④ `分组标题…（进行中 / 最近完成）` 断言 `TASK_TABLE` 含 `open: '进行中'`、`done: '最近完成'`，需改为 `'未完成'` / `'已完成'`。该文件归 r18 样式任务所有。
  - ③ `select 专用死规则…与 RunSwitcher 的真实 DOM 一致` 的失败与本次文案无关，来自 `RunSwitcher` / `styles.ts` 的并行改动。
- `src/client/styles.ts` 第 3727 行注释仍写「进行中 · N / 最近完成 · N」（仅注释，写域外未碰）；样式规则本身不依赖文案。
- 按要求未 build、未 commit：`lib/client.js` 仍是旧产物，恢复全量后的行为需在下一次统一 build 后才会反映到 profile 安装产物。
