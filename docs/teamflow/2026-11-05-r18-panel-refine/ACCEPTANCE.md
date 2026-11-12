# r18 验收报告 — 右栏任务收敛、run 卡片、主界面项目过滤

日期：2026-11-05
计划：run-mw2u0037-2nn（本会话 Team roster 已满 8，t1/t2/t3/t4 由队长派 subagent 实施、队长代跑门禁）

## 1. 需求与结论

| # | 用户口径（m00962） | 实现 | 结论 |
|---|---|---|---|
| 1 | 右栏任务只显示进行中；全部完成时显示最后一个任务 | `viewmodel.taskOverviewOf`：groups.open = 非终态任务；无进行中时 groups.done 只放 1 个最近完成（有 evidence.at 优先，其次计划索引靠后）；TaskTable grouped **空组整组不渲染** | 通过 |
| 2 | 多个 run 时最上方 run 位置显示任务卡，点击卡片切换 | `RunSwitcher` 改为 `[data-run-cards]` 横排卡片（216px，当前/选中/历史/忙四态），删除 `<select>`；选中回调按 runId 切换 | 通过（多 run 切换由单测覆盖，见 §4） |
| 3 | 左侧主界面按工作区项目显示，只显示用过自动团队的项目 | `project-filter.visibleProjectsOf`：`runs > 0` 才可见；左栏分桶、计数、选中回落全部基于可见列表 | 通过 |
| 4 | （沿用 r17）主区/抽屉高度 | `[data-auto-team-library][data-library-surface="main"]` 高度链接满，抽屉随壳整高 | 通过 |

## 2. 自动化门禁（2026-11-05 09:12，仓库根）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm typecheck` | 0 | 无输出 |
| `pnpm test` | 0 | **874 / 874 pass** |
| `pnpm build` | 0 | `lib/client.js` 503.09 kB、`lib/index.js` 469.28 kB |
| `node --input-type=module -e "await import('./lib/index.js')"` | 0 | 通过 |
| `node --input-type=module -e "await import('./lib/client.js')"` | 0 | 通过 |
| `npm pack --dry-run` | 0 | 5 文件、288.3 kB，含两产物 + cordis.patch.yml |

工作树：31 文件 +4496/−492，HEAD 仍为 `608cb24`（未 commit）。

## 3. 真机验证（第二宿主 dv，端口 51890）

环境：`~/.dsh/profiles/dv`（克隆 desktop），`node_modules/dsh-auto-team/lib` 覆盖为 503093 B / 469281 B 的本次构建；启动日志无 `did not activate` / `without inject`。
会话：`session-dc39ce5c-b532-435d-aa6f-b5a098bc4f9d`，run `run-mw2fn4b6-qlt`（t1「打印 hello」，acceptance `true`）。

| 检查 | 证据 |
|---|---|
| 任务页 run 卡（无 select） | `[data-run-card]` ×1，216px，文案「用量落盘验证 当前 已终止 已完成 1/1」；`[data-run-switcher]` 不存在 |
| 运行中态 | 组头「进行中 · 1」「最近完成 · 0」，1 行「打印 hello ● 运行中」，环 0/1（HTTP 真实回执前采集） |
| 全部完成态 | 组头**只剩「最近完成 · 1」**（空组「进行中 · 0」已隐藏），1 行「✓ 打印 hello ✓ 已通过」，环 1/1 — 截图 `r18-tasks-all-done.png` |
| 左栏项目过滤 | 3 个项目（desktop 5 次运行、tmp 1 次运行、历史运行（未记录工作区）4 次运行），`data-project-count="3"`，**0 次运行项目行 0 个** — 截图 `r18-library-main.png` |
| 主区高度 | `[data-auto-team-library]` 1160×900 = 视口 900 |
| 抽屉高度 | `[data-run-drawer]` 900、`[data-drawer-body]` 856、遮罩 900 — 截图 `r18-library-drawer.png` |

回执姿势记录：`POST /api/auto-team/act` 的 body 必须是 `{sessionId, action:{type:'receipt', taskId}}`；`{action:'receipt'}` 会返回 `{"error":"缺少 action"}`。

## 4. 已知边界

- dv 会话只有 1 条 run，`data-can-switch="false"`，多 run 的卡片切换与选中态由 `test/r18-run-cards.test.ts`（真实渲染断言）覆盖，未做多 run 真机截图。
- 运行中态未保留截图（只保留采集数字），全部完成态截图见上。
- 空组头修复（09:12 后）在 r18 计划之外补做，改动 `src/client/views/TaskTable.tsx` + `test/r18-task-list.test.ts`，门禁 58/58；已计入 §2 的 874 例。
