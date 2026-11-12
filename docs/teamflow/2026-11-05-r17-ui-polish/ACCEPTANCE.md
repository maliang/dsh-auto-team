# r17 验收报告（QA · t4）

- 任务夹：`docs/teamflow/2026-11-05-r17-ui-polish/`（t1/t2/t3a/t3b 四份实现说明 + t6 用量投影）
- 运行：auto-team `run-mw2e4vdf-2nn` ｜ 仓库根 `dsh-auto-team/` ｜ HEAD `608cb24`（四项需求均为未提交工作树）
- 验收时间：2026-11-05 02:00（最终门禁）｜ 工作树指纹 `07269cb0b46d`（`git diff | shasum`，不含未跟踪文件）
- 被测范围：r17 四项 UI 改造 + t5（`library.runs` 回退六项）+ t6（token 用量改读宿主会话投影）
- 验收方式：独立复跑任务给定门禁；逐条核对四项需求；对关键断言做**变异测试**（改回错误实现必须变红）；对两处无单测覆盖的链路写**独立探针**补证；真机视觉按团队约定留给主 agent（见「未验证项」）

## 总体判断

**通过（门禁级）**。任务给定的完整验收命令退出码 **0**，全量 `pnpm test` **834/834 pass / 0 fail / 0 skipped**；四项需求的宿主装配、客户端投影、入口接线均有可执行证据，关键断言经变异测试确认「回退即红」。发现 3 个 P3（2 个测试质量/覆盖缺口、1 个历史详情错误态标题），不影响本次交付。真机视觉（高度/抽屉/切换器/成员页/六项布局）与 t6 的真实宿主投影数据尚未验证，需主 agent 补做，不得用本报告的「构建通过」代替。

## 验收门禁（任务给定命令，逐字执行）

```bash
pnpm typecheck && pnpm test && pnpm build \
  && node --input-type=module -e "await import('./lib/index.js')" \
  && node --input-type=module -e "await import('./lib/client.js')" \
  && npm pack --dry-run 2>&1 | grep -q 'lib/client.js'
```

| 段 | 结果 | 证据 |
|---|---|---|
| `pnpm typecheck` | exit 0 | `tsc --noEmit` 无输出；分段复测 `typecheck_exit=0` |
| `pnpm test` | exit 0 | `tests 834 / pass 834 / fail 0 / skipped 0`（含 t6 新增 `test/usage-projection.test.ts`） |
| `pnpm build` | exit 0 | `lib/client.js 489.42 kB`（gzip 116.77 kB）、`lib/index.js 469.28 kB`（gzip 158.40 kB），均 `Build complete`；产物 mtime `02:00:03` |
| 双 import | exit 0 | `import_host_exit=0`、`import_client_exit=0`（client 的 `window.__ModuleLoader__` 守卫有效） |
| `npm pack --dry-run` | exit 0 | `grep -q 'lib/client.js'` 命中；单独复跑：`total files: 5`，含 `lib/index.js 469.3kB` / `lib/client.js 489.4kB` / `cordis.patch.yml 646B` |
| **整条链** | **GATE_EXIT=0** | 完整日志 `.auto-team/artifacts/t4-gate-final.log`（890 行） |

环境：node `v26.11.1`、pnpm `10.34.7`。r17 相关测试文件合并复跑（`run-switcher` + `member-page` + `r17-height` + `r17-styles` + `client-ui` + `library`）**104/104 pass**，exit 0。

## 四项需求逐条核对

| 需求 | 判定 | 证据（可执行） |
|---|---|---|
| ① 右栏任务页多 run 可切换 | ✅ 通过 | `test/run-switcher.test.ts` 12/12（含「当前 run 排第一」「历史 run 只读提示」「加载中 tone 降级」「快照缺当前 run 时合成」「超长 goal 截断」）；`src/client/tabs/TasksTab.tsx:58-101` 选中非当前 run 走 `props.openRun(runId)`、回当前走 `props.closeRun()`；`src/client/views/RunSwitcher.tsx:29-80` 渲染 `[data-run-switcher]`/`[data-run-switcher-status]`/`[data-run-back]`；历史详情复用 `GET /library?runId=`（`src/client/state.ts:259-320`），未新增路由 |
| ② 角色卡/任务行/流程图节点 → 主界面子智能体详情 | ✅ 通过 | `test/member-page.test.ts` 24/24（`memberForRole` 优先级、`memberPageOf` 空态、`navigateToMember` 打开主界面/回退内嵌）；三入口接线：`RoleCard.tsx:140-142`（`data-role-card-open`）、`TaskTable.tsx:96-113`（`data-task-open-member`）、`FlowCanvas.tsx:347-348`；`TasksTab.tsx:89` 统一调 `navigateToMember(sessionId, memberId, taskId)` → `nav.ts:114-122` 的 `requestLibrarySurface`（`layout.selectPanel`，不可用回退右栏） |
| ③ 历史行顶部任务名 + 底部 token 六项 | ✅ 通过 | 宿主派生 `src/host/bridge.ts:970-987`（`usage: usageCellOf(run.usageTotals, HISTORY_USAGE_REASON)`，不落盘）；客户端 `src/client/tabs/rows.ts:104-120` 三级降级、`:119-141` 标题取 goal；渲染 `HistoryTab.tsx:102-131`（`data-history-line="title|meta|usage"`、`data-history-metric`、`data-available`）；`test/client-ui.test.ts:771-830` 4/4；`test/library.test.ts:459+` 覆盖回退路径（t5 已把 `src/host/library.ts:141-146` 补齐，t1 文档 §5 的已知边界关闭） |
| ④ 自动团队主界面 100% 高度 + 抽屉高度 | ✅ 通过（契约级） | `test/r17-height.test.ts` 5/5（根节点 100%+纵向 flex、shell→body 高度链、抽屉铺满+头 44px+正文内滚、钩子一致性、token 纪律）；`test/r17-styles.test.ts` 6/6；实现 `src/client/styles.ts:3195-3208`（`[data-auto-team-library][data-library-surface="main"]` 100%/flex/min-0/overflow hidden）、`:4039-4054`（shell 为抽屉提供定位上下文）、`:4214-4296`（抽屉 `top/right/bottom:0` + `max-height:100%` + head 44px + body `overflow:auto`） |

## 断言有效性（变异测试，均在 `/tmp` 副本上做，未改仓库源码）

| 变异（改回错误实现） | 结果 |
|---|---|
| 删 `styles.ts` 根规则 `height: 100%` | `✖ r17 ④ 主界面根节点：main 槽位撑满宿主主内容区（100% + 纵向 flex）` 变红（其余 4 条仍绿） |
| `rows.ts:87` `usageMetrics: usageMetricsOf(input.usage)` → `[]` | `✖ 历史行（r17）：底部六项原样透传宿主 details，客户端零重算` 变红 |
| `runSummaryRowOf` 标题改回 `run.runId` | `✖ 历史行（r17）：顶部是任务名（run goal），项目名不再冒充标题` 变红（`+ 'run-r17-t1'`） |
| 删 `nav.ts` `memberForRole` 的 taskId 绑定优先块 | `✖ memberForRole：明确绑定 taskId 的成员优先于同角色的 running 成员` 变红 |
| 删 `nav.ts` `runSwitcherOf` 的 current-first 排序分支 | **目标用例仍绿**（只有「快照自己没有 runId 时…」变红）→ 见缺陷 D1；真实行为由探针补证 |

## 独立探针（补单测未覆盖的链路）

1. **① 当前 run 比历史旧时仍排第一**（`/tmp/r17-probe.ts`，import 真实 `src/client/nav.ts`）：
   构造 `snapshot.runId='old'`（plannedAt T1）、`runs=[old(T1), new(T2)]` →
   `current-first: old,new`；`labels: 当前 · 旧 run | 新 run`；选历史 `new` → `historical=true`、`status=已终止 · 已完成 3/3`、`hint=历史 run 只读；成员页面仅对当前 run 可用。`；`snapshot=null → null`。
2. **③ 宿主 `historyOf` 主链路**（`/tmp/r17-bridge-probe.ts`，真实 `createBridge` + `RunsStore`，两个同 session run）：
   `bridge.snapshot('sess-probe')` → `runs: run-new,run-old`；`run-old.usage.source=provider`、`text=60,421`，`details` 六项固定顺序
   `input 29,229 / cacheRead 30,848 / cacheWrite 不可得(available=false) / output 344 / calls 3 / hitRate 51.3%`；
   `run-new.usage.source=unavailable`、`reason=宿主未上报本 run 的用量`。此前 `test/bridge.test.ts` 对 usage **零断言**（见 D2）。

## 缺陷（均 P3，不阻塞本次交付）

| 编号 | 级别 | 模块 | 症状 | 根因 | 复验命令 |
|---|---|---|---|---|---|
| D1 | P3 | `test/run-switcher.test.ts` | 删掉 `runSwitcherOf` 的 current-first 排序后，「当前 run 排第一」用例仍 pass，不能捕获回退 | 夹具里当前 run `r2` 的 `plannedAt=T2` 恰好最新，按时间倒序与 current-first 结果相同，断言未覆盖「当前 run 比历史旧」 | 复制 `src/` + `test/run-switcher.test.ts` 到 `/tmp`，删除 `src/client/nav.ts:296-301` 的 current-first 分支后 `node --test test/run-switcher.test.ts` → 11 pass / 1 fail，且失败的是「快照自己没有 runId 时…」 |
| D2 | P3 | `test/bridge.test.ts` | `bridge.historyOf` 的 usage 派生（③ 主链路）无单测，只有客户端投影测试与 library 回退测试 | 历史行测试全部落在 `client-ui`/`library`，宿主装配层漏了断言 | `grep -c usage test/bridge.test.ts` → `0`；本次用 `/tmp/r17-bridge-probe.ts` 补证 |
| D3 | P3 | `src/client/tabs/TasksTab.tsx:113-127` | 历史 run 详情读不到（被清理/404）时，标题仍写「正在读取历史 run…」，只有 hint 变成错误文案 | 空态 `title` 只按 `historicalRunId` 分支，未按 `libraryError` 分支；`state.ts:279-287` 在 detail 为 null 时设 `libraryError` 且 `detail=null` | 源码：`grep -n "正在读取历史 run" src/client/tabs/TasksTab.tsx`；场景：对一个已删除的 runId 调 `openRun`（`state.ts:308`） |

建议修改（按性价比）：
1. D1 补一条「当前 run 的 plannedAt 早于另一 run」用例，断言 `options[0].current === true`（一行 fixture + 一条断言）。
2. D2 把探针搬成 `test/bridge.test.ts` 的一条 `snapshot.runs` 用例（六项 key/text/available 与 unavailable reason）。
3. D3 空态 `title` 在 `libraryError !== null` 时改为「读不到这条历史 run」，与 `HistoryTab.tsx:72-74` 的错误态一致。

## 未验证项（不因门禁全绿而消失）

- **U1（P1，需求④/①②③ 的视觉面）**：真机浏览器计算值未取。需要确认：① 主界面根节点计算高度 = 宿主主区高度、详情列内滚且页面不整页滚动；② 抽屉上下贴住主区、正文内滚；③ 320px 下切换器三行不重叠、成员页不横向溢出；④ 历史六项 3 列 × 2 行、不可得项为灰+虚线而非 `0`；⑤ 可点角色卡常驻描边/chevron/hover/active/focus 三态。当前只有源码级契约测试（`r17-height`/`r17-styles`），**样式契约测的是「源码里有这条声明」，不是浏览器计算值**。
- **U2（P1，t6）**：真实宿主 `sessionProjections.stateOf(memberSession,'tokenUsage')` 是否在真机有数、是否按覆盖语义落盘，未验证（t6 文档 §5 明确留给队长）。本报告只验证了「落盘 `usageTotals` → 六项」的派生与渲染。
- **U3（P2，D3）**：历史详情加载失败路径无自动化测试；网络异常分支（`state.ts:295-301`）只验证了源码存在，未驱动。
- **已知行为（非缺陷）**：`historyOf` 有 5 秒 memo（`bridge.ts:969-987`），刚刷新的用量在历史列表最多晚 5 秒出现；`RunDrawer` 仍覆盖项目库头部（r16 既有层叠语义，t3a 文档 §7 已声明）。

## 快照与并发说明

- 首次门禁 01:56:27：822/822（当时 t6 尚未新增 `test/usage-projection.test.ts`）。
- t6 于 01:57:07 新增测试文件后完成（`exitCode=0`）。**最终门禁 02:00 在 t6 完成后的稳定树上重跑**：834/834、GATE_EXIT=0，`lib/` 于 02:00:03 重建，本报告以这次为准。
- 本次未修改任何产品代码；唯一写入为本文件与 `.auto-team/artifacts/t4-gate*.log`。

## 结论

**✅ 通过（门禁级）**。四项需求的实现链路与断言有效性成立，全量门禁、双产物、双 import、pack 全部通过。D1/D2/D3 为测试质量与错误态文案问题，建议随下次改动一并收口；U1/U2 的真机验证需主 agent 在第二宿主完成后再补一条视觉/投影证据，方可宣称「真机通过」。

## 02:47 真机复验（第二宿主）

接上节 U1（视觉面）与 U2（t6 真实宿主投影）：两项已在第二宿主取到真机证据，记录如下（本节数字均为实测，未重跑验证）。

**环境**：第二宿主 `dv` profile，端口 `51890`，加载 02:47 构建的 `lib/index.js`（469,281 B）+ `lib/client.js`（492,133 B），headless Chrome + CDP 驱动。

### 四项需求真机结论

1. **① 右栏任务页多 run 可切换**：面板任务页顶部出现 run 下拉「当前 · 用量落盘验证」，下面一行「计划就绪 / 已完成 0/1」「切换查看本会话的历史 run（只读）」。截图 [real-02-tasks.png](./real-02-tasks.png)。
2. **② 点角色卡 / 任务行 / 流程图节点 → 主界面子智能体页**：
   - 首次复验**失败**：[real-03-member.png](./real-03-member.png) 显示「成员已不在当前 run 里」。
   - 根因：main 槽位的 `LibraryContent` 拿不到 `sessionId`（`sessionIdOf(props)` 回落 `'current'`），且 `src/client/nav.ts` 的成员导航不携带 `sessionId`。
   - 修复（t2/t8）：nav 成员状态带 `sessionId` + `resolveMemberSessionId` / `isStaleMemberNav`，`src/client/LibraryPage.tsx` 改用解析后的会话并防陈旧导航。
   - 修复后**复验通过**：[real-08-member-fixed.png](./real-08-member-fixed.png) 显示 `dev-t1-x4gvxf` / 运行中 / 高级全栈工程师 / 任务 t1 打印 hello / `69,459 · 37 分 50 秒` / 验收 `true` / 直接消息 1 条。
3. **③ 历史列表样式**：每行顶部任务名「用量落盘验证」，底部 3×2 六项：输入未命中 34,930、输入命中 34,304、写缓存 0、输出 225、调用次数 **不可得**、缓存命中率 49.5%。截图 [real-06-history.png](./real-06-history.png)。
4. **④ 主界面 100% 高度 + 抽屉高度**：`[data-auto-team-library]` 高 900 = 视口 900；抽屉 `[data-run-drawer]` 高 900、`[data-drawer-body]` 856。截图 [real-07-drawer.png](./real-07-drawer.png)。

### token 数据链路（U2 关闭）

run `run-mw2fn4b6-qlt` 的 run 文件**首次写入 usage**：total 69,459 / input 34,930 / output 225 / cacheRead 34,304 / cacheWrite 0；快照 `runUsage.source="provider"`、`text="69,459"`、`details` 六项齐全。数据源为宿主 `sessionProjections` 的 `tokenUsage` 投影（事件订阅在真机从未投递，已弃用）。

### 门禁（02:47 之后队长实跑）

| 段 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 840 pass / 0 fail |
| `node --input-type=module -e "await import('./lib/index.js')"` | 成功 |
| `node --input-type=module -e "await import('./lib/client.js')"` | 成功 |
| `npm pack --dry-run` | 5 个文件（含 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`），包 285.1 kB |

### 流程说明（如实记录）

需求 ② 的修复原计划由团队成员 t2 执行，但宿主 Team roster 每会话上限 8 且不可删（`Team member limit 8 reached`），无法再建成员；改用独立 subagent 实施（只改 `src/client/nav.ts` / `src/client/LibraryPage.tsx` / `test/member-page.test.ts` / t8 文档），门禁仍由队长代跑并通过。

真机复验时间 2026-11-05 02:47–02:49
