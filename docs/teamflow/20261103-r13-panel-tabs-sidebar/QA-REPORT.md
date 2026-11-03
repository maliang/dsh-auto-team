# QA-REPORT — r13 面板三页 + 自动派发 + 确认门禁 + 左栏项目库（复验轮）

- 任务夹：`docs/teamflow/20261103-r13-panel-tabs-sidebar/`（本文件即本轮交付）
- 分支：`feat/auto-team-plugin`；HEAD `0d87357`；r13 全部改动未提交（按 AC-27/AC-40，由 host 验收后单笔提交）
- 环境：macOS；Node 直跑 `.ts`；**沙箱内不能起真实浏览器**（host token 限制 PROCESS_SET_INFORMATION/PROCESS_SUSPEND_RESUME，非交付缺陷）→ 真机项全部进「人工补测清单」
- 结论：**复验通过，可进入验收**。上一轮 4 条缺陷（D1 P1 / D2 P2 / D3 P2 / D4 P3）全部关闭；本轮未发现 P0/P1/P2 缺陷，仅 1 条 P3 观察。

## 1. 复跑：上一轮留下的探针（回归契约，逐条 verbatim）

| 探针 | 结果 |
|---|---|
| `r13-delivery-gate.mjs` | pass=28 fail=0 |
| `qa-r13-ac8-triggers.mjs` | pass=13 fail=0 |
| `qa-r13-view-probe.mjs` | pass=8 fail=0 |
| `qa-r13-library-memory-probe.mjs` | pass=13 fail=0 |
| `qa-r13-restart-flow-probe.mjs` | pass=9 fail=0 |
| `qa-r13-library-cold-probe.mjs` | pass=5 fail=0 |
| `qa-r13-attribution-probe.mjs` | pass=9 fail=0（`ATTRIBUTION=unavailable`） |
| `qa-r13-confirm-matrix-probe.mjs` | pass=18 fail=0 |
| `qa-r13-arch-consistency.mjs` | pass=16 fail=0 |
| `auto-dispatch-probe.mjs` | pass=15 fail=0 |
| `confirm-gate-probe.mjs` | pass=20 fail=0 |
| `token-usage-probe.mjs` | pass=30 fail=0 |
| `library-perf-probe.mjs` | pass=25 fail=0 |
| `shape-probe.mjs` | pass=11 fail=0 |
| `check-t7-wiring.mjs` | PASS 3 |
| `views-render-check.mjs` | PASS 30 |
| `views-bundle-check.mjs` | PASS 17 |
| `r13-t4-confirm-e2e.mjs` | pass=11 fail=0 |

## 2. 上一轮缺陷逐条复验（对比表；严重级列名为 round-1 级，避免被当作新缺陷导入）

| 编号 | round-1 级 | 复跑命令（原样） | 本轮实测 | 判定 |
|---|---|---|---|---|
| D1 `updateAcceptance` 在 done 被拒 | P1 | `node logs/teamflow/tf-mw04prut-jg53di/scripts/qa-r13-confirm-matrix-probe.mjs` | pass=18 fail=0；含「④ done 任务：验收命令改写 + 门禁重跑（done/rework）」 | 关闭 |
| D2 skipTask 文案与 PRD 相反 | P2 | `! grep -q "下游 M 个任务将阻塞" src/host/team/confirm.ts` | exit 0；文案为「下游 N 个任务将在缺产物下继续」 | 关闭 |
| D3 用量探针缺 ATTRIBUTION 结论行 | P2 | `node logs/teamflow/tf-mw04prut-jg53di/scripts/token-usage-probe.mjs \| grep -q "^ATTRIBUTION="` | exit 0 | 关闭 |
| D4 library 冷装配计时假数 | P3 | `node logs/teamflow/tf-mw04prut-jg53di/scripts/qa-r13-library-cold-probe.mjs` | pass=5 fail=0（冷装配确实装配了全部历史 run，无旧 cache 命中） | 关闭 |

单测侧复核：`node --test test/task-actions.test.ts test/bridge.test.ts` → 57/57；`test/store.test.ts` → 24/24；`test/task-actions.test.ts:113` 断言 `taskActionAllowed('edit-acceptance','done') === true`；`test/bridge.test.ts:1386/1414/1435` 覆盖 done 重跑门禁「通过保持 done / 失败转 rework / 真实 applyReceipt」。

## 3. 本轮新增覆盖（上一轮未覆盖的表面）

1. **AC-8 的 5 组变异**（上一轮只做静态调用点计数，没做真正的移除变异）→ 新探针 `qa-r13-ac8-mutations.mjs`：复制 `src/` 到临时根，对生产调用点做单点变异，再把 `qa-r13-ac8-triggers.mjs` 原样跑一遍。结果 **pass=6 fail=0**：未变异对照 13/13 绿；`plan-saved` 移除 → T1b 红；`tasks-added` 移除 → T2b 红；`task-terminal` 移除 → T3b 红；`member-exit` 事件处理早退 → T4b 红；`tick` 移除 → T5 红。
   - 口径说明（如实记录，非缺陷）：保留兜底路径时原样移除 `tasks-added`/`task-terminal`/`member-exit kick` **不会**变红 —— 1.5s watcher tick 与 r11 触发器总线的 `dep_ready → bridge.act({type:'dispatch'})` 会兜住。这是设计内的多层兜底；隔离这两条既有自动推进路径后，每个触发点都被证明为 load-bearing。
2. **AC-17 详情导航**（上一轮只做了 viewmodel 层断言）→ 新探针 `qa-r13-detail-nav-probe.mjs`：真 `createPanelStore` 驱动 `openRun → detail → closeRun → 切另一 run`，并断言切换期间 snapshot 不触发 library 装配（AC-23）。**pass=13 fail=0**。
3. **AC-21 旧 v3 夹具可读**（上一轮未落盘级验证）→ 新探针 `qa-r13-legacy-v3-probe.mjs`：真 `RunsStore` 写 `version:3` 无 r13 新字段的文件 → load 不抛；坏形状归一丢弃；save 往返可读；坏 JSON 返回 null。**pass=5 fail=0**。

## 4. 门禁与交付形态（全部实测）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `pnpm -s typecheck` | exit 0 |
| 单测 | `pnpm -s test` | 666/666 pass，0 fail |
| 构建 | `pnpm -s build` | exit 0；`lib/index.js` 435.63kB、`lib/client.js` 351.87kB（16:56） |
| 产物新鲜 | `find src -name '*.ts*' -newer lib/index.js \| wc -l` | 0 |
| 加载安全 | `node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')"` | IMPORT_OK |
| 打包 | `npm pack --dry-run \| grep -E 'lib/(index\|client)\.js\|cordis\.patch\.yml'` | 3/3（351.9kB / 435.6kB / 646B） |
| 包形态 | `cordis.patch.yml` name=`dsh-auto-team`；package.json files=[lib,cordis.patch.yml,README.md]、dependencies 空、dsh.client inject 7 包、peer 7 包+react 全 optional、无 `workspace:` | 通过（AC-30/31/33/34/35） |
| 工作树卫生 | `git status --porcelain` | 52 项，全部为 src/test/lib/docs/.gitignore；无 node_modules/.pnpm-store/dist/.env/*.log/*.tgz |
| 文档 | UI-SLOTS.md 含 `main` ⚠️未验证 行；memory.md 含 r13 四条约定；`git diff AGENTS.md` 空 | 通过（AC-24/28/39） |

主路径可执行证据（0a2）：`test/wire.test.ts` 用真 `apply()` 跑通 plan→自动派发→receipt→下游解锁（2734ms）；`qa-r13-ac8-triggers.mjs` 用真 `apply()` + 假 ctx 观察到「成员被真实建出」；`r13-t4-confirm-e2e.mjs` 用真 bridge/store 跑通确认闸 11 项。

## 5. 架构巡检（0 号要求，P1 级门禁）

`qa-r13-arch-consistency.mjs` 16/16：时长/用量格式化单点 `src/host/format.ts`（client 侧 `formatDuration` = 0、`toLocaleString`/`Intl` = 0）；`buildRunDetail` 仅 1 处（`src/client/viewmodel.ts`，被 LibraryPage/HistoryTab/TasksTab 共用）；`dispatchReady` 实现唯一（`src/host/team/dispatch.ts`），auto-dispatch 不调 `bridge.act`；记忆扫描只在 `src/host/memory/repo.ts`；蓝图 16 个模块 16/16 落盘；`PanelAction` 21 全有分支；HTTP 路由恰 4 条（snapshot/library/memory/act）。**未发现重复实现、未发现该抽未抽的抽象、未发现既有结构被破坏。**

## 6. 接口一致性（0a，静态）

跨端形状全部在 `src/shared/types.ts`；`grep -rn "from '\.\./host/" src/client` = 0；`views/` 8 组件被 Panel 与 LibraryPage 共同 import；`slot` 名逐字等于常量（`sidebar.panellist` / `main`）；`ActResult.pendingId`、`RejectionCode.CONFIRM_REQUIRED`、`PanelAction` 21 项均在 bridge 有对应分支。未发现「导入的符号不存在 / 方法不存在 / 参数形状不符」。

## 7. 缺陷表（仅列仍 OPEN 的）

未发现 P0/P1/P2 缺陷。

| 编号 | 严重级(P0/P1/P2/P3) | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| D5 | P3 | 面板/流转图 | 任务页把面板宽度收到 <420px，看流转图节点里的 token/用时文本 | 被截断的文本可点击或键盘聚焦查看全文 | 仅 `title` 悬停可见，触屏与键盘用户不可达 | AC-4 | - | - |

## 8. 人工补测清单（环境限制，非交付缺陷）

| 项 | 方法 | 工具 |
|---|---|---|
| AC-25 真机第二宿主 + CDP 断言（AC-1/3/5/6/8/11/13/14/16） | 克隆 profile、端口 51890 起第二宿主，按 REAL-HOST-VERIFY.md 抓控制台与 DOM | 主 agent + CDP（沙箱内浏览器不可启动） |
| AC-14/AC-24 `main` 槽位（U2 未验证） | 真机点左栏项目，确认主区页面出现；失败则确认降级为面板内联 library | 真机宿主 |
| AC-13 弹窗 Esc/焦点陷阱 | 真机键盘操作确认对话框 | 真机宿主 |
| AC-37 安装与回滚步骤可照做 | 主 agent 按报告步骤在 profile 安装后回滚 | 主 agent |
| AC-38 真机：占用区块 / 等待文案 / add_tasks 前后快照 | 真机面板操作并截图 | 真机宿主 |
| 窄屏折叠（100dvh / safe-area / 折叠观感） | 真机移动端视口 | 人工 |
| AC-40 单笔提交 + 报告 hash 与门禁数 | 验收后由 host 提交并回填 | host |

## 9. 结论

**复验通过，可进入验收。** 上一轮 D1（P1）已关闭：`updateAcceptance` 在 `done` 允许改写并重跑门禁，通过保持 `done`、失败转 `rework`，矩阵探针 18/18；D2/D3/D4 全部关闭。全量门禁绿（typecheck 0、test 666/666、build 双产物且与源码同步、双 import、pack 3 件）；21 个探针全绿，其中新增 3 个覆盖上一轮遗漏的 AC-8 变异、AC-17 详情导航、AC-21 旧夹具。开放项仅 1 条 P3 观察与真机补测清单（AC-25 等 7 项）。
