# t2 · 任务页 run 切换器 + 子智能体主界面 + 角色卡/任务行/流程图节点导航

- 需求：r17「任务页多 run 可切换；点角色卡/任务行/流程图节点在主界面打开子智能体详情」。
- 范围：只动 t2 写域内文件；`src/client/styles.ts` 归 t3a，未改。
- 门禁：`pnpm typecheck && node --test test/client-contract.test.ts test/member-page.test.ts test/run-switcher.test.ts`

## 1. 做了什么

### 1.1 run 切换器（任务页）

- 新增 `src/client/views/RunSwitcher.tsx`：`<section data-region="run-switcher">` + 原生 `<select data-run-switcher>`。
  - 选项来自当前会话全部 run：`当前 · <目标>` 永远排第一，其余按 `plannedAt ?? createdAt` 倒序；
  - 状态行显示 `planStatus · 已完成 done/tasks`；历史 run 显示 `[data-run-back]` 回当前 run；
  - 历史 run 明确提示只读（成员页仅对当前 run 可用）；
  - 只有 1 个 run 时 `disabled`（不制造假交互）。
- 新增投影 `runSwitcherOf()`（`src/client/nav.ts`），数据源优先级：
  1. `snapshot.runs`（宿主给的本会话全部 run，含当前 run）；
  2. 快照缺当前 run 时用快照本身合成（状态/任务数/完成数来自快照）；
  3. 只有历史详情（项目库详情场景）时用 `RunDetailView` 合成单项，并把它标为选中。
- `src/client/tabs/TasksTab.tsx`：
  - `historicalRunId = detailRunId !== null && detailRunId !== snapshot.runId`；
  - 历史模式下 `buildRunDetail({snapshot, runDetail: props.detail}, historicalRunId)`，绝不拿当前快照冒充历史 run；
  - 历史详情读取中显示「正在读取历史 run…」空态，切换器保持可见；
  - 选中当前 run → `props.closeRun()`；选中历史 run → `props.openRun(runId)`（复用右栏共享的 detail 状态与缓存）。

### 1.2 子智能体主界面

- 新增 `src/client/nav.ts` 的纯投影：
  - `memberForRole(members, roleId, taskId?)`：先按任务精确绑定，再取同角色 running，最后取最近 `lastEventAt`（同一时间按 memberId 稳定排序）；
  - `memberPageOf({member, role, roleDefinition, task, messages, audits, now?})`：状态徽标、职责、模型路由、最近活跃、停滞（仅 running+stalled，只读宿主秒数）、可续聊、路由审计（最近一条；同任务精确优先）、任务用量/用时/证据、最近 8 条相关直达消息（按 `taskId` 或 `toMemberId` 过滤）、空态文案。
- 新增 `src/client/views/MemberPage.tsx`：`[data-member-page]`（带 `data-member-id` / `data-member-surface` / `data-member-found`）、返回按钮 `[data-member-back]`、头部（姓名/状态/角色/模型）、事实表、路由审计、任务块（token 与用时直接读宿主 cell）、消息区 `[data-region="member-messages"]`；找不到成员时给「成员已不在当前 run 里」空态。
- `src/client/LibraryPage.tsx`：主界面用 `useSyncExternalStore(subscribeMainNav, mainNavView)` 读导航；`nav.kind === 'member'` 时项目库分栏整体替换为 `MemberPage`（保留 `[data-library-body]` 分栏容器只在项目库视图出现，避免 r14 AC-13 的两义 DOM），返回即 `openLibraryNav()`。
- `src/client/slots.ts`：`registerPanellist` 注册时把 `createOpenLibrary` 存为模块级 opener，导出 `requestLibrarySurface(sessionId?)` / `resetLibrarySurfaceOpener()`，让组件层（无 ctx）也能请求打开主界面（走 `layout.selectPanel`，失败回退右栏页签）。

### 1.3 三处入口导航

- 角色卡（`views/RoleCard.tsx`）：整张卡片可点/可键盘（Enter/Space），`data-role-card-open` + `data-member-id`，点击打开该角色正在执行的成员；无成员时保持纯展示。
- 任务行（`views/TaskTable.tsx`）：展开按钮 `[data-task-toggle]` 不动，旁边新增独立按钮 `[data-task-open-member]`（`子智能体 · <名字> →`），避免嵌套按钮与事件互相吞；
- 流程图节点（`views/FlowCanvas.tsx`）：点节点优先 `onOpenMember(member, node.id)`，找不到成员才退回原来的选中/展开任务行为；
- `TaskOverview` 透传 `members` / `onOpenMember`。

## 2. 关键行为约定

| 场景 | 行为 |
|---|---|
| 当前 run 角色卡/任务行/节点 | 切到成员页并 `layout.selectPanel` 打开主界面；主界面不可用时回退右栏内嵌项目库（`OPEN_LIBRARY_EVENT`） |
| 历史 run 任务页 | 只读详情；不展示当前快照的成员入口（避免把别的 run 的成员当成这个 run 的） |
| run 列表只有当前 run | 切换器 disabled，仍显示状态与完成数 |
| 历史详情读取中 | 切换器保留，状态行 `正在读取历史 run…`，tone 降为 muted |
| 成员已消失/跨会话 | 成员页显示空态与返回入口，不抛错 |
| 无用量数据 | 沿用宿主「不可得」，客户端不补 0、不重算 |

## 3. 验证证据

```text
$ pnpm typecheck
> tsc --noEmit
（无输出，退出码 0）

$ node --test test/client-contract.test.ts test/member-page.test.ts test/run-switcher.test.ts
ℹ tests 68
ℹ pass 68
ℹ fail 0
（退出码 0）
```

拆分：`client-contract` 32/32、`member-page` 24/24、`run-switcher` 12/12。

回归（非门禁要求，额外跑的）：

```text
$ node --test test/*.test.ts
ℹ tests 816
ℹ pass 816
ℹ fail 0
```

## 4. 给下游（t3b / QA）的钩子清单

- 切换器：`[data-region="run-switcher"]`、`[data-run-switcher]`、`[data-run-switcher-status]`、`[data-run-switcher-hint]`、`[data-run-back]`、`option[data-run-option][data-current]`。
- 成员页：`[data-member-page][data-member-id][data-member-surface]`、`[data-member-back]`、`[data-member-head]`、`[data-member-name]`、`[data-member-status]`、`[data-member-model]`、`[data-member-facts]`、`[data-member-route-audit]`、`[data-member-task]`、`[data-region="member-messages"]`、`[data-member-message]`。
- 导航入口：`[data-role-card-open]`、`[data-task-open-member]`、`[data-flow-node]`。
- 主界面外壳：`[data-library-view="library|member"]`。

样式缺口（t3a/t3b 处理）：`MemberPage` 未加样式类，只带一个 `flex:1/min-height:0` 内联占位；成员页的头部/事实表/消息列表、切换器状态行需要补 token 样式与 100% 高度。

## 5. 已知边界

- 成员页只对当前 run 提供成员（历史 run 的成员对象不落盘快照），历史任务页因此不给成员入口；这是显式取舍，不是遗漏。
- 主界面打开依赖宿主 `layout.selectPanel`；不可用时回退为右栏内嵌项目库（既有 r16 行为），成员页同样能在内嵌表面渲染。
- 未改 `styles.ts`；`lib/` 产物留给构建/安装环节，本任务不跑 build。
