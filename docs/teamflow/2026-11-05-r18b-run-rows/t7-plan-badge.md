# r18b T7 — run 行/历史行的计划状态徽标说中文（不再 `? terminated`）

日期：2026-11-05 · 任务：r18b t7 · 写域：`src/client/viewmodel.ts`、`src/client/tabs/rows.ts`、
`test/client-ui.test.ts`、`test/r18-run-cards.test.ts`、本文件。
按指令**未 build、未 commit**；未碰 `styles.ts`、未改 `RunRowView` 公开字段形状。

## 1. 真机症状

截图：`docs/teamflow/2026-11-05-r18b-run-rows/r18b-tasks.png`（dv/51890，2026-11-05 11:40）。

- 右栏「任务」页顶部 run 行（`[data-active-run]`）右侧徽标显示 **`? terminated`**：
  图标是未知徽标的 `?`，文案是宿主 `planStatus` 的裸英文；
- 同一时刻页头 chip 显示的却是「已终止」——同一个计划态在页面里出现了两套说法；
- 历史页 `[data-history-row]` 走同一个行投影，同样中招（`? terminated`）。

## 2. 根因

`src/client/tabs/rows.ts` 的行工厂 `rowOf` 原先固定调用 `statusBadge(input.status)`；
而 `runSummaryRowOf` 传的是 `run.status`、`projectRunRowOf` 传的是 `run.planStatus` ——
两者都是**计划状态**（`PlanStatus`），不是任务/成员状态。

`src/client/viewmodel.ts` 的 `BADGES` 只覆盖任务 13 态 + 成员 7 态，没有计划态；
查表落空后走 `UNKNOWN_BADGE`（`?` + 原文），于是界面上出现 `? terminated`。

计划态的中文单一来源其实早就有：`planStatusView()`（`src/client/viewmodel.ts:705`，页头 chip 在用），
只是 run 行没接上它。

## 3. 改动

### 3.1 `src/client/viewmodel.ts`

新增（紧挨 `planStatusView`，`src/client/viewmodel.ts:714-745`）：

```ts
export function planStatusBadge(planStatus?: PlanStatus): Badge
```

- 文案**只**取 `planStatusView(planStatus).label`，本函数不写第二份中文；
- 新增 `PLAN_STATUS_ICON: Record<PlanStatus, string>` 只补图标这一视觉维度；
- 新增 `PLAN_TONE_BADGE_TONE: Record<PlanStatusTone, BadgeTone>`，把计划态 tone 映射到既有 `BadgeTone`
  联合类型（`business | neutral | warn | danger | success`），未新增 tone 取值，`styles.ts` 零改动；
- 未知取值（宿主日后新增、类型里还没有的态）**绝不回显英文**，显示「未知」。

### 3.2 `src/client/tabs/rows.ts`

最小改法（`src/client/tabs/rows.ts:64-78`）：

- `rowOf` 入参新增可选 `badge?: Badge`，内部 `input.badge ?? statusBadge(input.status)`；
- `runSummaryRowOf` 传 `planStatusBadge(run.status)`（`rows.ts:134`）；
- `projectRunRowOf` 传 `planStatusBadge(run.planStatus)`（`rows.ts:154`）；
- 其它调用方不传 `badge`，行为完全不变；`RunRowView` 字段形状未动（仍是
  `statusText/statusTone/statusIcon`），因此 `RunSwitcher.tsx`、`HistoryTab.tsx`、
  `LibraryPage.tsx` 的渲染代码**一行都不用改**，自动显示中文。

## 4. 映射表

`PlanStatus` 以 `src/shared/types.ts:49` 为准，实际只有 **5 态**
（`draft | dispatching | paused | terminated | cancelled`）：

| planStatus | 文案（来自 `planStatusView`） | 图标 | PlanStatusTone | BadgeTone | `data-tone` 效果 |
|---|---|---|---|---|---|
| `draft` | 计划就绪 | `·` | ok | business | 蓝 |
| `dispatching` | 派发中 | `◐` | ok | business | 蓝 |
| `paused` | 已暂停 | `⏸` | warn | warn | 琥珀 |
| `terminated` | 已终止 | `■` | muted | neutral | 中性 |
| `cancelled` | 已取消 | `⊘` | muted | neutral | 中性 |
| （空 / 无计划） | 未启用 | `·` | muted | neutral | 中性 |
| （未知运行时取值） | 未知 | `?` | — | neutral | 中性 |

> 说明：需求文字里举例提到 `dispatched / running / completed`，但 `src/shared/types.ts` 的
> `PlanStatus` 并没有这三态（完成/进行中由任务的 done/total 与页头进度表达）。本实现按**实际类型**
> 只映射 5 态；若宿主日后下发新态，会落到「未知」而不是透传英文（有测试锁定）。

tone 映射规则：`ok → business`、`warn → warn`、`bad → danger`、`muted → neutral`，
与 `BadgeTone` 联合类型逐值对齐。

## 5. 对任务/成员徽标无影响

- `statusBadge()` 与 `TASK_BADGES`/`BADGES` **未改动**；任务 13 态、成员 7 态徽标仍走原表；
- 只有 `runSummaryRowOf` / `projectRunRowOf` 这两个计划行入口显式传入了计划态 `badge`；
- `test/client-ui.test.ts` 既有的「13 态中文标签互不重复 / waiting·cancelled·skipped 色调」断言原样全绿，
  新增测试也重复断言 `statusBadge('done')`、`statusBadge('paused')` 文案仍读 `TASK_STATUS_LABELS`。

## 6. 测试

`test/client-ui.test.ts`（新增 2 个用例 + 历史页源码断言）：

- `planStatusBadge` 五态逐值 deepEqual（`terminated → {icon:'■',text:'已终止',tone:'neutral'}`、
  `draft → 计划就绪/business`、`dispatching → 派发中/business`、`paused → 已暂停/warn`、
  `cancelled → 已取消/neutral`）；
- 五态文案与 `planStatusView(status).label` 逐一相等，且不含任何英文字母、图标不为 `?`；
- 空计划 → `{icon:'·',text:'未启用',tone:'neutral'}`；运行时未知值 `'dispatched'` → `{? 未知 neutral}`；
- `runSummaryRowOf({status:'terminated'})` → `statusText='已终止'`、`statusIcon='■'`、
  `statusTone='neutral'`，且拼接文本不匹配 `?` / `terminated`；`dispatching → 派发中/business`；
- `projectRunRowOf({planStatus:'terminated',...})` 同样得到「■ 已终止」；
- `HistoryTab.tsx` 源码断言改用 `row.statusIcon` / `row.statusText`（不再自己映射）。

`test/r18-run-cards.test.ts`（新增 1 个真实元素树用例，沿用 `typescript.transpileModule` + `new Function`）：

- `summaryOf('rT', {status:'terminated'})` → `[data-active-run-status]` 的可见文本 `trim() === '■ 已终止'`，
  `data-tone="neutral"`，不匹配 `terminated`、不匹配 `?`；
- `paused` 行 → `⏸ 已暂停` + `data-tone="warn"`。

## 7. 门禁结果（2026-11-05 11:4x）

```
pnpm typecheck
# exit 0（tsc --noEmit，零错误）

node --test test/client-ui.test.ts test/r18-run-cards.test.ts test/run-switcher.test.ts
# exit 0 · tests 65 / pass 65 / fail 0 / cancelled 0
```

补充（不在指定门禁列表，确认无连带回归）：

```
node --test test/*.test.ts
# exit 0 · tests 881 / pass 881 / fail 0
```

## 8. 未做事项

- 未 `pnpm build`、未 `git commit`（按指令）；`lib/client.js` 仍是旧产物，
  真机要看到本修复需先构建并由主 agent 安装/刷新；
- 未做真机复验（构建与安装属主 agent 流程）；
- 未改 `styles.ts`：颜色完全复用既有 `[data-tone]` 选择器；
- 未给 `RunRowView` 增删字段（避免动 `run-switcher` / `r18-run-cards` 等既有测试依赖的形状）；
- 未扩展 `PlanStatus` 类型本身（`dispatched/running/completed` 不是本任务引入的状态）。
