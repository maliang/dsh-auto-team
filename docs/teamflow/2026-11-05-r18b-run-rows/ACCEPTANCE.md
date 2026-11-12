# r18b 验收报告 — 顶部 run 行、任务列表全量、token 动态单位

日期：2026-11-05 · 任务夹：`docs/teamflow/2026-11-05-r18b-run-rows/`
验收方式：队长只读复核（未改产品代码、未 build、未 commit），门禁全部**实际复跑**并记录退出码与数字。

任务与角色：

| 任务 | 内容 | 落点摘要 |
|---|---|---|
| t1 | 宿主 `RunSummary.ongoing` | `src/shared/types.ts:704`、`src/host/store.ts:247/262-263` |
| t2 | 顶部 run 行（nav / RunSwitcher / TasksTab） | `src/client/nav.ts:276`、`src/client/views/RunSwitcher.tsx` |
| t3 | run 行样式（历史行视觉、当前/选中正交、删旧选择器） | `src/client/styles.ts`、`test/r18-styles.test.ts` |
| t4 | **本验收文档 + 门禁复核** | 本文件 |
| t5 | 任务列表恢复全量 | `src/client/viewmodel.ts`、`src/client/views/TaskTable.tsx:46-49` |
| t6 | token 动态单位 K/M/B | `src/host/format.ts:61/80`、`usageMetricsOf` |
| t7 | 计划状态徽标中文化（修 `? terminated`） | `src/client/viewmodel.ts:739`、`src/client/tabs/rows.ts` |

## 1. 需求与结论

| # | 用户口径（r18b），共三条 | 实现 | 结论 |
|---|---|---|---|
| 1 | 顶部 run 位置显示成**历史列表同款 run 行**（标题 / 状态徽标 / 元信息 / token 六项），**只显示还有进行中任务**的 run；没有则只显示**最后一个 run**；点击行切换 run；不再保留下拉 / 历史切换 / 回到当前 | `activeRunRowsOf` 复用 `runSummaryRowOf` 逐字段投影；过滤 `ongoing > 0`，为空时取最新一条并 `data-fallback="true"`；整行 `button[data-active-run]` 点击 `onSelect(runId)`；`<select>`、`data-run-cards`、`data-run-back` 全部删除 | 通过（真机基准为单行 fallback；多行态未真机验，见 §6.1） |
| 2 | 角色卡下方任务列表**显示全部任务**：恢复「未完成 / 已完成」分组，组内按计划顺序；空组不渲染；环仍 done/total | `taskOverviewOf` 回滚 r18 过滤（`cancelled`/`skipped` 归入「未完成」）；`GROUP_LABEL` 恢复「未完成 / 已完成」；空组 `filter(rows.length > 0)`；环分母含非 done 任务 | 通过（真机见「已完成 · 1」「未完成 · 0」不渲染、环 1/1；13 态归属与顺序由单测覆盖） |
| 3 | token 六项的 token 数量**带动态单位**（K/M/B）+ 两位小数；calls 仍次数、hitRate 仍百分比 | `formatTokenUnits`：`<1000` 原样整数、`≥1e3` K、`≥1e6` M、`≥1e9` B，两位小数；越界进位（`999,999 → 1.00M`）；`usageMetricsOf` 前四项改走它，calls/hitRate 不变；总量 `UsageCell.text` 保持千分位整数 | 通过（真机六项 `34.93K / 34.30K / 0 / 225 / 不可得 / 49.5%`） |

## 2. 需求 → 任务 → 证据

| 需求 | 任务 | 实现要点 | 证据 |
|---|---|---|---|
| 1 | t1 | `RunSummary.ongoing?`（可选，旧数据按 0/`active` 降级）；`list()` 用 `SUMMARY_TERMINAL_STATUSES` 算 `ongoing`，且 `active = ongoing > 0` —— 同一谓词 | `test/run-ongoing.test.ts` 5 例；`buildLibrary` 透传防回归断言 |
| 1 | t2 | `activeRunRowsOf`：`ongoing` 优先、旧数据 `active && done < tasks` 兜底；候选倒序；空则最新一条；`selected` 与 `current` 两维正交；行内容 100% 来自 `runSummaryRowOf` | `test/run-switcher.test.ts` 12 例（过滤/倒序/fallback/选中/字段逐字一致/接线）；`test/r18-run-cards.test.ts` 8 例（真实元素树：行数、无 select、无旧钩子、点击回调、busy 禁用） |
| 1 | t3 | 行是 `button` 的三行网格；`[data-current]` 2px 竖条、`[data-selected]` 10% 淡底 + inset 描边，二者正交；`[data-fallback]` 零规则；删死选择器 | `test/r18-styles.test.ts` 7 例 + `test/r17-styles.test.ts` 更新；320px 算术（网格 272、六项 3 列 ≥80） |
| 2 | t5 | `groups.open` = 非 `done`（含 `cancelled`/`skipped`）、`groups.done` = `done`，均按计划顺序；空组过滤；环 `done/total` | `test/r18-task-list.test.ts` 重写（全量、13 态、顺序、空组、环）、`test/task-overview.test.ts` |
| 3 | t6 | `formatTokenUnits` + `TOKEN_UNITS` 阶梯；先 `Math.round`，进位跨阈值顺延一级；非法值「不可得」 | `test/format.test.ts` 边界（0/999/1000/1234/34930/69459/999999/1e6/1.5e6/2e6/999999999/1e9/非法）；`test/usage.test.ts`、`test/library.test.ts` 端到端 |
| 3 | t7 | `planStatusBadge` 只取 `planStatusView().label`（中文单一来源），补图标与 tone；`runSummaryRowOf` / `projectRunRowOf` 显式传 badge；未知值显示「未知」绝不回显英文 | `test/client-ui.test.ts` 五态 + 空计划 + 未知值；`test/r18-run-cards.test.ts` 真实元素树断言 `[data-active-run-status]` 文本 `■ 已终止` |

## 3. 自动化门禁（2026-11-05 11:45–11:46，仓库根，本次复跑）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc --noEmit` 无输出、零错误 |
| `pnpm test` | **0** | `tests 881 / pass 881 / fail 0 / cancelled 0 / skipped 0 / todo 0`，耗时 4735.07 ms |
| `node --input-type=module -e "await import('./lib/index.js')"` | **0** | 通过 |
| `node --input-type=module -e "await import('./lib/client.js')"` | **0** | 通过 |
| `npm pack --dry-run` | **0** | **5 文件**、package 288.8 kB、unpacked 995.3 kB、shasum `d2287bce…`；含 `lib/client.js` 499.2 kB / `lib/index.js` 471.3 kB / `cordis.patch.yml` 646 B / README 21.6 kB / package.json 2.6 kB |

构建产物核对（`ls -l lib/`）：

| 文件 | 字节 | 大小 | mtime | 与交付口径 |
|---|---|---|---|---|
| `lib/client.js` | **499,177 B** | 499.2 kB | 2026-11-05 11:43:57 | 一致 |
| `lib/index.js` | **471,289 B** | 471.3 kB | 2026-11-05 11:43:57 | 一致 |

产物内钩子核对（防止「源码改了、产物没跟」）：

- `lib/client.js`：`data-active-run` 31 处、`data-active-run-metric` 8 处；
  `data-run-cards` / `data-run-back` 各 1 处且**仅出现在 RunSwitcher 的说明注释里**（`lib/client.js:350042` / `:350079`，非 DOM 钩子）；`data-run-switcher` 0 处。
- `lib/index.js`：`formatTokenUnits` 6 处、`ongoing` 4 处。

工作树：HEAD 仍为 `608cb24`（**未 commit**）；31 文件 +4630/−629。本任务未改产品代码、未 build、未 commit。

## 4. 真机证据（第二宿主 dv / 51890，2026-11-05 11:44）

会话 `session-dc39ce5c-b532-435d-aa6f-b5a098bc4f9d`，run `run-mw2fn4b6-qlt`（计划已终止，1 个任务已通过）。

| 检查 | 证据（DOM 数据 + 截图） |
|---|---|
| 顶部 run 行（需求 1） | `[data-active-run]` **1 条**，容器 `data-fallback="true"`（无进行中 run → 只显示最后一个）；文案：`用量落盘验证` + `■ 已终止` + `开始 11-05 02:10:50 · 结束 — · 任务 1/1` + 六项 `输入未命中 34.93K / 输入命中 34.30K / 写缓存 0 / 输出 225 / 调用次数 不可得 / 缓存命中率 49.5%`；无 `select`、无旧卡片钩子 — [r18b-tasks.png](r18b-tasks.png) |
| 任务列表全量（需求 2） | 组头**只有**「已完成 · 1」（空组「未完成 · 0」未渲染），1 行「✓ 打印 hello ✓ 已通过」，环 **1/1** — 同上截图 |
| 点角色卡进子智能体页 | `dev-t1-x4gvxf` 成员页；高度 **856** / 视口 900 — [r18b-member.png](r18b-member.png) |
| 项目库（左栏过滤未回归） | 3 个项目（desktop 6 次运行 / tmp 1 次运行 / 历史运行（未记录工作区）4 次运行）、**0 次运行的项目 0 个**、主区 **900 = 900**、最近运行 **6 条 run 行** — [r18b-library.png](r18b-library.png) |
| 抽屉高度（r17 回归） | 抽屉 **900**、内容 **856**、遮罩 **900** — [r18b-drawer.png](r18b-drawer.png) |

## 5. 变异与回归

**t7 真机缺陷发现 → 修复 → 复验（唯一一次「真机才暴露」的问题）**

1. **发现**：11:40 首轮真机，顶部 run 行徽标显示 **`? terminated`**（未知图标 + 宿主 `planStatus` 裸英文）；同一时刻页头 chip 却是「已终止」——同一计划态出现两套说法，历史页 `[data-history-row]` 同样中招。
2. **根因**：`src/client/tabs/rows.ts` 的 `rowOf` 固定调 `statusBadge(input.status)`，而 run 行传的是**计划状态**；`BADGES` 只覆盖任务 13 态 + 成员 7 态，查表落空走 `UNKNOWN_BADGE`（`?` + 原文）。
3. **修复**：新增 `planStatusBadge`（文案只取 `planStatusView().label`，补 `PLAN_STATUS_ICON` 与 `PLAN_TONE_BADGE_TONE`），`runSummaryRowOf` / `projectRunRowOf` 显式传入；未新增 tone 取值、`styles.ts` 零改动。
4. **复验**：11:44 同一 run 行显示「**■ 已终止**」（`data-tone="neutral"`），无 `?`、无 `terminated` 英文（见 [r18b-tasks.png](r18b-tasks.png)）；单测 `planStatusBadge` 五态、空计划「未启用」、未知值「未知」全覆盖。

**t5 回滚回归**：r18 的「只显示进行中 / 全部完成只留最近完成」被回滚为全量，但 r18 修复的「空组不渲染」**保留**——真机只有「已完成 · 1」而没有「未完成 · 0」，即两条改动各自生效、未互相抵消。

**t3 死规则清理**：旧 `<select>` / `data-run-cards` / `data-run-card*` / `data-run-back` / `data-run-switcher-*` 钩子与样式删除；`[data-region="run-head"] [data-run-id]` 逐字保留（RunHeader 仍在用）。全量 881 例复跑无回归。

**t1 口径唯一**：`ongoing` 与 `active` 在 store 里是同一个谓词（`active = ongoing > 0`），旧快照按 0/`active` 降级、不迁移不补猜。

## 6. 未覆盖与风险

1. **「有进行中 run」的多行态未真机验**：dv 的 run 已终止，只观察到单行 fallback（`data-fallback="true"`）。多行过滤、倒序、无进行中回退、点击切换由 `test/run-switcher.test.ts` 12 例 + `test/r18-run-cards.test.ts` 8 例覆盖，但没有多 run / 进行中态的真机截图。
2. **calls「不可得」是诚实降级**，不是渲染 bug：宿主 usage 投影没有调用次数字段（`src/host/team/usage.ts`），行组件对 `data-available="false"` 只降级显示、不补 0。要显示真实次数需宿主投影新增字段，属后续需求。
3. **「结束 —」**：该 run 由旧版落盘、缺 `finishedAt`，格式化层对缺失值输出「—」；新 run 有值。
4. **320px 六项 3 列是静态契约**：真机截图宽 1440（右栏页签实际渲染宽度大于 320），六项的 320px 算术（网格 272、每列 ≥80）由 `test/r18-styles.test.ts` ② 断言，未在 320px 视口实测。
5. **行高 ≈127px 为 CSS 推算**，非真机实测；六项标签已 `nowrap` + 省略号兜底，真机若换行行会更高。
6. **历史页 / 项目库的 run 行**也走同一投影（t7 顺带修复），本次只截了任务页、成员页、库页与抽屉，未逐页截图证明「历史行也是 ■ 已终止」。

## 7. 结论

三条需求全部落地：顶部 run 行与历史列表同款、无进行中时只显最后一条；任务列表恢复全量分组且空组不渲染；token 六项带 K/M/B 动态单位、calls/hitRate 语义不变。门禁 5 项全绿（typecheck 0、test 881/881、双产物 import 0、pack 0、产物字节与交付口径一致），真机基准与四张截图齐备。唯一未真机覆盖的是「进行中 run 的多行态」，已由 20 条单测锁定并记入 §6.1。
