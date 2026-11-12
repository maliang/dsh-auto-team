# r18b T1 — `RunSummary.ongoing`（进行中任务数）

日期：2026-11-05 · 任务：r18b t1（宿主侧小改动）· 写域：`src/shared/types.ts`、`src/host/store.ts`（+ 本文件与新测试）

## 目标

面板顶部只需要展示**还有进行中任务**的 run。此前客户端只有 `active: boolean`，无法显示「还剩几个」，
也不能按数量排序，于是要么自己重算（会与宿主出现两套终态口径），要么只显示一个圆点。
本任务让宿主把计数直接投影到 `RunSummary.ongoing`。

## 改动

### 1. 契约：`src/shared/types.ts`

`RunSummary` 新增可选字段：

```ts
/**
 * r18b：进行中任务数 = 非终态任务个数（`active` 的计数版）。
 * 终态沿用 `host/store.ts` 的 `SUMMARY_TERMINAL_STATUSES`
 * （done / failed / cancelled / skipped / interrupted）。
 */
ongoing?: number
```

可选的同一条理由：旧快照 / 旧 run 文件没有它，客户端按 `active` 或 0 降级，**不补猜、不迁移**。

### 2. 统计：`src/host/store.ts#list()`

```ts
const ongoing = plan.tasks.filter((task) => !SUMMARY_TERMINAL_STATUSES.has(task.status)).length
...
ongoing,
active: ongoing > 0,
```

关键点：

- **终态沿用既有判定，没有另造一套**。仓库里有两处同一语义的集合：
  `src/host/team/dispatch.ts:901` 的 `TERMINAL_TASK_STATUSES`（私有，经 `isTerminalTaskStatus` 暴露）
  与 `src/host/store.ts:509` 的 `SUMMARY_TERMINAL_STATUSES`。后者是落盘层刻意保留的**本地副本**
  （`store.ts` 保持零运行时依赖，不 import `team/dispatch.ts`），语义为
  `done / failed / cancelled / skipped / interrupted`。本次直接复用后者，并把 `active` 改成
  `ongoing > 0`，让「是否还有进行中任务」在 store 里只有**一个**谓词。
- 兼容：`tasks` 缺失/非数组的文件被 `normalizePlan` 判成非法 run（`load` → `null`），
  `list()` 跳过它而不是给一个 `ongoing: 0` 的假 run，也不会抛错。
- `interrupted` 记为终态：成员进程已死、不再产出，与 `isTerminalTaskStatus` 一致；
  但它**不**让计划收口（`SETTLED_PLAN_STATUSES` 不含它）—— 该差异只影响 `planStatus`，不影响本计数。

### 3. 透传：`bridge.historyOf` / `library.buildLibrary`

两处都是 `{ ...run, usage: usageCellOf(...) }` 的 spread 重建，**已自动带上 `ongoing`**，
无需改动（本次未改这两个文件）。`test/run-ongoing.test.ts` 用 `buildLibrary` 的真实输出加了
一条防回归断言：将来若有人改成手工挑字段，这条测试会红。

## 测试

新增 `test/run-ongoing.test.ts`（真 `RunsStore` + 临时目录，5 例）：

| 用例 | 断言 |
|---|---|
| 混合 `done + running + pending` | `ongoing = 2`，`active = true` |
| 全部终态 `done/failed/cancelled/skipped/interrupted` | `ongoing = 0`，`active = false` |
| 旧文件缺 `tasks` | `list()` 不抛，该 run 被跳过（`[]`） |
| 多 run（2/0/3） | 各自统计，不串台 |
| `buildLibrary` | 历史行 `ongoing` 透传为 2 |

## 门禁

```
pnpm typecheck && node --test test/run-ongoing.test.ts test/library.test.ts test/bridge.test.ts
```

- `pnpm typecheck`：退出码 0
- `node --test`：`tests 74 / pass 74 / fail 0`（含新增 5 例），退出码 0
- 按任务要求**未执行** `pnpm build`、未 commit
