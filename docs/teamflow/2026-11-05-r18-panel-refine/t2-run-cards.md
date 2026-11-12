# t2 · 任务页顶部 run 卡（横向卡片替换下拉）

- 需求（用户原话）：「当有多个任务时最上方 run 的位置显示任务卡，点击任务卡切换查看任务。」
- 实现口径（已与用户确认）：把任务页顶部 `RunSwitcher` 的 `<select>` 下拉换成**横向 run 卡** ——
  一个 run 一张可点卡片，点哪张就切到哪个 run 查看。
- 范围（写域）：`src/client/nav.ts`、`src/client/views/RunSwitcher.tsx`、
  `test/run-switcher.test.ts`、`test/r18-run-cards.test.ts`（新建）、本文件。
  **未改** `src/client/styles.ts`（横向滚动/卡片视觉归 t4）、未改 `TasksTab.tsx`、未 `pnpm build`、未 commit。
- 门禁：`pnpm typecheck && node --test test/run-switcher.test.ts test/r18-run-cards.test.ts test/client-contract.test.ts`

## 1. 做了什么

### 1.1 投影（`src/client/nav.ts`，零格式化纪律的落点）

`RunSwitcherOption` 在原有字段上补充卡片文案，**全部在投影里一次性派生**，组件不再拼数字：

| 字段 | 含义 | 来源 |
|---|---|---|
| `titleText` | 卡片主标题（目标标题，超长按 `GOAL_TITLE_MAX` 截断） | `goalTitleOf(...).text` |
| `currentText` | 当前 run 角标文案 `当前`；历史 run = 空串 | `run.runId === currentRunId` |
| `progressText` | 卡片进度行 `已完成 3/5` | 既有 `doneText`（`run.done/run.tasks`） |
| `label` | 兼容字段：`当前 · <目标标题>`（探针/日志的一行摘要；组件已不读） | 同上 |
| `statusLabel` / `statusTone` | 卡片状态行文案与 tone | `planStatusView(run.status)` |
| `title` | 悬停全文（含 runId / 状态 / 完成数 / `formatStamp` 时间） | 既有派生 |

排序仍是 current-first（`runSwitcherOf` 原逻辑未动）：当前 run 永远第一张卡，历史 run 按
`plannedAt ?? createdAt` 倒序。

### 1.2 组件（`src/client/views/RunSwitcher.tsx`）

- 删掉 `<select>`/`<option>`；改为 `<div data-run-cards role="group" aria-label="选择要查看的 run">`
  里 `view.options.map(...)` 出 `<button type="button" data-run-card>`。
- 卡片可键盘操作（原生 button），选中态用 `aria-pressed={option.selected}` 表达（不靠颜色）。
- `busy`（历史详情读取中）时**所有卡与返回按钮一起 `disabled`**，并在点击处理器里再守一道
  `if (busy) return`，防程序化点击/连点打乱请求顺序。
- 选中当前 run 的卡**不禁点**：点击照常 `onSelect(currentRunId)`，由 `TasksTab.selectRun` 决定
  `closeRun()`（沿用 r17 行为契约）。
- 历史态保留 `[data-run-back]`「回到当前 run」：有 `onBack` 用 `onBack`，缺省 `onSelect(currentRunId)`。
- 状态行 `[data-run-switcher-status]`、提示 `[data-run-switcher-hint]`、根节点
  `[data-region="run-switcher"]` 全部沿用 r17 钩子（既有样式/探针不失效）。

## 2. DOM 钩子清单（给 t4 加样式用）

| 钩子 | 元素 | 说明 |
|---|---|---|
| `[data-region="run-switcher"]` | `section` | 根节点；带 `data-historical` / `data-can-switch` |
| `[data-run-switcher-label]` | `div` | 第一行容器（caption + 状态 + 返回按钮） |
| `[data-run-switcher-caption]` | `span` | 「run」标签 |
| `[data-run-switcher-status]` | `span` | 状态行；`data-tone="ok\|warn\|bad\|muted"` |
| `[data-run-back]` | `button` | 历史态「回到当前 run」（busy 时 disabled） |
| `[data-run-switcher-hint]` | `span` | 一句说明（当前/历史两种文案） |
| `[data-run-cards]` | `div` | **卡片行容器**：横向滚动/`overflow-x` 的样式落点（t4） |
| `[data-run-card]` | `button` | 一张 run 卡；`type="button"`，`disabled={busy}` |
| `[data-run-id]` | 卡片 | `option.runId` |
| `[data-current="true\|false"]` | 卡片 | 是否当前 run |
| `[data-selected="true\|false"]` | 卡片 | 是否正在查看的 run |
| `[data-tone]` | 卡片 | `option.statusTone`（`ok/warn/bad/muted`） |
| `aria-pressed` | 卡片 | 选中态（无障碍表达） |
| `[data-run-card-title]` | `span` | 目标标题（截断文本） |
| `[data-run-card-badge]` | `span` | 「当前」角标（仅当前 run 渲染） |
| `[data-run-card-status]` | `span` | 状态文案 |
| `[data-run-card-progress]` | `span` | `已完成 3/5` |

> 注意：旧样式里的 `[data-region="run-switcher"] [data-run-switcher]`（select 专用）本任务后
> 不再匹配任何元素，需要 t4 在 `styles.ts` 里换成卡片规则；本任务按要求未碰 styles.ts。

## 3. 行为约定

| 场景 | 行为 |
|---|---|
| 多个 run | 当前 run 第一张卡（带「当前」角标），历史 run 依次在后 |
| 只有 1 个 run | 仍渲染 1 张卡（不再有下拉的「空 option」占位），点击幂等 |
| 点历史卡 | `onSelect(历史 runId)` → `TasksTab` 走 `props.openRun(runId)`，详情只读 |
| 点当前 run 卡 | 照常回调 `onSelect(currentRunId)` → `closeRun()` |
| 历史详情读取中（busy） | 卡片与返回按钮 `disabled`，程序化点击也不回调 |
| 历史态 | 渲染 `[data-run-back]` + 只读 hint「历史 run 只读；成员页面仅对当前 run 可用。」 |
| 横排空间不足 | 结构上由 `[data-run-cards]` 承载，`overflow-x` 等样式归 t4 |
| 卡片文案 | 标题/角标/状态/进度全部来自 `nav.ts` 投影；组件层无 `toLocaleString`/`toFixed`/`padStart`、无「小时/分钟」 |

## 4. 测试

- `test/run-switcher.test.ts`（14 例，最小更新）：
  - 原「有下拉」的源码钩子测试改为「横向 run 卡（无 select）」契约：无 `<select`/`<option`、
    有 `data-run-cards`/`data-run-card`、`onClick` 调 `pick(option.runId)`、`aria-pressed`、`disabled={busy}`；
  - 新增 1 例投影断言：`titleText` 无「当前 ·」前缀、`currentText`/`progressText` 来自投影，历史 run 角标为空。
- `test/r18-run-cards.test.ts`（7 例，新建；**真实渲染**，不是正则猜源码）：
  用 `typescript.transpileModule` 把 `RunSwitcher.tsx` 就地编译成 CJS、`new Function` 加载
  （`require` 由 `createRequire` 提供，react 在 lockfile 依赖里），拿到真实元素树后断言：
  ① 卡片数 = option 数、无 select/option、每张都是 `<button type="button">`、顺序 = 投影顺序；
  ② 只有 1 个 run 时 1 张卡且不禁用；③ 点卡片回调 `onSelect(runId)`，**选中当前 run 的卡也回调**；
  ④ busy 时全部 `disabled` 且点击不回调；⑤ 历史态渲染返回按钮（`onBack` 优先，缺省回当前 run，busy 禁用）；
  ⑥ `aria-pressed` 与 `data-current`/`data-selected`/`data-tone` 和投影逐卡一致，同一时刻只选中一张；
  ⑦ 卡片文案（标题/角标/状态/进度/状态行/hint）全部原样来自投影，组件源码零数字格式化。

## 5. 验证证据

```text
$ pnpm typecheck
> dsh-auto-team@0.1.0 typecheck
> tsc --noEmit
（无输出，退出码 0）

$ node --test test/run-switcher.test.ts test/r18-run-cards.test.ts test/client-contract.test.ts
ℹ tests 53
ℹ pass 53
ℹ fail 0
（退出码 0；分文件：run-switcher 14/14、r18-run-cards 7/7、client-contract 32/32）
```

回归说明（供 lead 参考）：全量 `node --test test/*.test.ts` 在本任务完成时为 864 例 /
863 pass / 1 fail —— 唯一失败是 `test/r18-task-list.test.ts:160`「最近完成排序：evidence.at 优先于
计划索引」（`t1` 的并行写域，`src/client/viewmodel.ts`/`TaskOverview` 相关），与本任务的
`nav.ts` / `RunSwitcher.tsx` 无交集，且不在本任务允许修改的文件清单内，未处理。
