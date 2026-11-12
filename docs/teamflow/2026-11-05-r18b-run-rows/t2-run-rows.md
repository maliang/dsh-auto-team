# r18b T2 — 顶部 run 行列表（只显示进行中，无进行中则显示最后一个）

日期：2026-11-05 · 任务：r18b t2 · 写域：`src/client/nav.ts`、`src/client/views/RunSwitcher.tsx`、`src/client/tabs/TasksTab.tsx`、`test/run-switcher.test.ts`、`test/r18-run-cards.test.ts`、本文件。
按指令**未** build、未 commit；未触碰 `styles.ts`、`src/shared/types.ts`、`src/host/*`。

## 1. 口径（用户原话）

> 「run位置应该和历史列表显示的内容一致，不同的是run位置只显示正在进行的任务，如果没有正在进行的任务则显示最后一个任务」
>
> 「顶部不要 run 切换器（历史 run 切换不要了），顶部只放这些 run 行」

因此：

- 顶部那一块**不再是** r18 的横向 run 卡、也不再是「当前 run + 下拉切换」；
- 每行内容**逐字段复用历史列表的行投影**（`runSummaryRowOf`）：任务名（run goal）+ 状态徽标、次行 meta、token 六项；
- 过滤：只显示还有进行中任务（`ongoing > 0`）的 run；一条都没有时只显示**最后一个 run**（1 条）；
- 没有 run 数据时整块不渲染（投影返回 `null`）。

## 2. 改动点

| 文件 | 改动 |
|---|---|
| `src/client/nav.ts` | 删除 `RunSwitcherOption` / `RunSwitcherView` / `RunSwitcherSource` / `summaryOfSnapshot` / `summaryOfDetail` / `optionOf` / `runSwitcherOf`；新增 `ongoingCountOf` / `latestRunOf` / `activeRunRowsOf` 与类型 `ActiveRunRow` / `ActiveRunsView` / `ActiveRunsSource`。每行的展示字段来自 `runSummaryRowOf`（`tabs/rows.ts`，与历史列表同一个函数）。 |
| `src/client/views/RunSwitcher.tsx` | 整文件重写为 run 行列表。文件名与导出名（`RunSwitcher` / `export default`）保留以减少接线改动；props 变为 `{ view, onSelect, busy? }`。删除「回到当前 run」按钮、历史态提示行、`data-run-cards` / `data-run-card` / `data-run-back` 钩子。 |
| `src/client/tabs/TasksTab.tsx` | 改用 `activeRunRowsOf({ snapshot, selectedRunId: historicalRunId })`；`<RunSwitcher view={runRows} onSelect={selectRun} busy={detailLoading} />`（去掉 `onBack`）。切历史 run 仍走既有 `props.openRun` 路径（`selectRun` 内部），没有新增路由。 |
| `test/run-switcher.test.ts` | 重写：投影的过滤/回退/排序/选中语义 + 行字段与历史行逐字一致 + 组件/TasksTab 接线（源码层）。12 例。 |
| `test/r18-run-cards.test.ts` | 重写：旧的卡片/下拉断言换成新行的真实元素树断言（详见 §5）。8 例。 |

## 3. 过滤 / 回退 / 排序规则

`activeRunRowsOf({ snapshot, selectedRunId? }): ActiveRunsView | null`

1. `snapshot` 缺失或 `snapshot.runs` 为空 → `null`。
2. 进行中判定 `ongoingCountOf(run)`（宿主 t1 契约）：
   - `run.ongoing` 是数字时**优先采信**（`0` 也是权威值，不会再被 `active` 反推）；
   - 否则（旧数据 / 未合并）兜底：`run.active === true && run.done < run.tasks` → `tasks - done`，再否则 `0`；
   - 不迁移数据、不补猜。
3. 候选 = `ongoing > 0` 的 run，按 `plannedAt ?? createdAt` **倒序**（新的在上）。
4. 候选为空 → 取「最后一个 run」= 按 `plannedAt ?? createdAt` 最新的那一条，`fallback = true`；只显示 1 条。
5. `selected` = `selectedRunId`（store 里选中的 run）；缺省回落到当前 run（`snapshot.runId`，缺失时取 `active === true` 的那条）。
   - `selectedRunId` 指向一条不在这批行里的 run（例如旧历史 run）时，**没有行**被标成选中 —— 不把历史 run 硬塞进「进行中」列表；
   - `current` 永远标在真正的当前 run 上，与 `selected` 是两个维度（选中历史 run 时二者分离）。
6. 空行的 `usageMetrics` 缺失时不渲染 usage 容器（`RunRowView.usageMetrics` 由 rows 投影保证是数组）。

## 4. 钩子清单（给样式 t3 与探针）

容器：

```
section[data-region="run-switcher"]
  data-active-runs={行数}       // 0 不会出现（空 runs 投影为 null，调用方不渲染）
  data-fallback={"true"|"false"} // true = 当前没有进行中的 run，这一条是「最后一个 run」兜底
  aria-label="进行中的 run"
```

每行（整行就是一个 `button`，**内容只能是 phrasing content**，不许塞 `div`）：

```
button[data-active-run]
  data-run-id={runId}
  data-current={"true"|"false"}
  data-selected={"true"|"false"}
  data-ongoing={"true"|"false"}   // 该行是否有进行中任务（兜底行为 false）
  aria-pressed={boolean}          // = selected
  title={titleTitle ?? title}
  disabled={busy}
  onClick → onSelect(runId)
```

行内：

| 钩子 | 内容 | 数据来源 |
|---|---|---|
| `span[data-active-run-title][data-title-source]` | 任务名（run goal，组内单点截断） | `RunRowView.title` / `titleSource` |
| `span[data-active-run-status][data-tone]` | 状态徽标（图标 + 文案） | `statusIcon` / `statusText` / `statusTone` |
| `span[data-active-run-meta]` | 次行 meta（`开始 … · 结束 … · 任务 done/tasks`） | `metaText` |
| `span[data-active-run-usage]` | token 六项容器（无六项时不渲染） | `usageMetrics` |
| `span[data-active-run-metric={key}][data-available={"true"｜"false"}]` | 一项指标 | 数组顺序即 key 顺序：`input` / `cacheRead` / `cacheWrite` / `output` / `calls` / `hitRate` |
| `span[data-active-run-metric-label]` | 指标名 | `UsageMetric.label` |
| `b[data-active-run-metric-value]` | 指标值（千分位/K/M 等全由宿主格式化） | `UsageMetric.text` |

约定：

- 组件**零格式化**：不 `toLocaleString` / `toFixed` / `padStart`，不拼时间、不算命中率；`data-available="false"` 表示宿主没上报该项（文案通常是「不可得」），样式应降级而不是补 0。
- 点击当前 run 也会回调 `onSelect`，由调用方决定「关掉历史详情 / 无操作」。
- `busy`（历史详情读取中）时整排 `disabled`，组件内 `pick` 还会再挡一次程序化 click。

## 5. 测试

`pnpm typecheck` 退出码 0。

```
node --test test/run-switcher.test.ts test/r18-run-cards.test.ts test/client-ui.test.ts test/client-contract.test.ts
→ tests 94 / pass 94 / fail 0，退出码 0
```

- `test/run-switcher.test.ts`（12 例，源码/投影层）：无快照/无 runs → null；只显示 `ongoing>0` 且倒序；无进行中只显最新 1 条；显式 `ongoing:0` 不被 active 兜底；旧数据 `active && done<tasks` 兜底；selected = store 选中、缺省 current、二者分离；选中不在行里的 run 时无选中；快照无 runId 时用 active run；行字段与 `runSummaryRowOf` 完全一致；六项顺序透传；组件钩子齐全且旧钩子/`onBack`/`historical`/`canSwitch` 全删、无 `<div>`；TasksTab 接线（`activeRunRowsOf` / `selectedRunId: historicalRunId` / `props.openRun` / 无 `onBack` / `busy={detailLoading}`）。
- `test/r18-run-cards.test.ts`（8 例，`typescript.transpileModule` 就地编译 + 真实元素树）：行数 = 投影行数、无 `select`/`option`、无 `data-run-card(s)`/`data-run-back`；无进行中时 1 条兜底行 + `data-fallback`；点击回调 runId（含当前 run）；`busy` 禁用且程序化 click 不回调；`data-current`/`data-selected`/`aria-pressed`/`title`；标题/徽标 `data-tone`/meta 与 `runSummaryRowOf` 逐字一致；六项按 key 顺序、`data-available`、值直接用宿主文案（`1,000` 不补格式、「不可得」保留）。
- `test/client-ui.test.ts` / `test/client-contract.test.ts`：**未改动**，全绿（其中 `data-run-id` 断言属 `RunHeader`，不受影响）。

## 6. 与并行任务的关系

- t1（`RunSummary.ongoing`）：本任务按契约读 `ongoing`，缺席时用 `active && done < tasks` 兜底；`src/shared/types.ts` 未由本任务修改。
- t6（token 动态单位）：六项数值只透传 `UsageMetric.text`，t6 改宿主文案不会影响本任务测试（fixture 自带文案）。

## 7. 给 t3（样式）的接口

样式只需挂在上面的 data 钩子上；注意两点：

1. 行是 `button`，行内是 `span`/`b`（phrasing content）。需要「标题一行、meta 一行、六项一行」时用 `display:block` / `flex` 布局，**不要**要求改成 `div`。
2. `button[data-active-run][data-selected="true"]` 与 `[data-current="true"]` 是两套语义（选中的历史 run vs 真正的当前 run），配色需能区分；`[data-ongoing="false"]` 是「最后一个 run」兜底行，建议弱化处理；`[data-fallback="true"]` 可用于整块降级。
3. 字号仍须写 `font: var(--dsw-font-xs-13, …)` 简写（禁用 `font-size: var(…)`）。

## 8. 已知会在 t3 之前变红的测试（不在本任务门禁内）

`test/r17-styles.test.ts` 与 `test/r18-styles.test.ts` 仍断言旧切换器/卡片钩子与旧分组标题，改完组件后预期红：

```
node --test test/r17-styles.test.ts test/r18-styles.test.ts
→ tests 13 / pass 10 / fail 3，退出码 1
  ✖ r17 ⑥ RunSwitcher 缺少 data-run-switcher-label
  ✖ r18 t4 ③ RunSwitcher 缺钩子 data-run-switcher-label
  ✖ r18 t4 ④ 找不到 open: '进行中'（分组标题文案）
```

这些属于样式域（`styles.ts` + 对应样式测试），本任务按指令不碰，留给 t3 一并更新。

## 9. 未做事项

- 未改 `styles.ts` / 任何样式测试：新行的视觉（行高、分隔线、选中态底色）由 t3 完成；在 t3 落地前这些行会按宿主默认按钮样式渲染。
- 未删除 `RunSwitcher` 的默认导出（`export default`）：宿主 `client.js` 的模块装载按名取用，保留更稳。
- 未做 `pnpm build`、未 commit。
- 未改历史列表本身（`HistoryTab` / `rows.ts` 的 `runSummaryRowOf` 只被复用，未修改）。
