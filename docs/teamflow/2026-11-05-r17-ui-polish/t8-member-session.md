# t8 · 主界面成员页拿到错误会话（「成员已不在当前 run 里」）修复

- 需求：r17 真机缺陷 —— 右栏任务页点角色卡后主界面切到成员页，但显示「成员已不在当前 run 里 / 快照里找不到 `<memberId>`」。
- 范围：只动 4 个文件：`src/client/nav.ts`、`src/client/LibraryPage.tsx`、`test/member-page.test.ts`、本文件。
- 门禁：`pnpm typecheck && node --test test/member-page.test.ts test/run-switcher.test.ts test/client-contract.test.ts`

## 1. 根因

1. 主界面（host 的 `main` 槽位）渲染的 `LibraryContent` 在 `src/client/LibraryPage.tsx:83` 用 `sessionIdOf(props)` 取会话；
2. 宿主给 `main` 槽位的 props **没有 `sessionId`**，`sessionIdOf`（`src/client/state.ts:471-478`）退回哨兵 `'current'`；
3. 于是 `usePanelState('current')` 拿到的是默认会话快照，其中**没有**这个成员；
4. `MemberPage` 的查找逻辑（未改）在快照里找不到 memberId，只能给出「成员已不在当前 run 里」。

导航侧同样丢会话：`MainNavView` 的 member 分支只有 `{memberId, taskId?}`，`openMemberNav(memberId, taskId?)`（原 `src/client/nav.ts:81`）不保存 sessionId；`navigateToMember(sessionId, memberId, taskId?)` 只把 sessionId 用于 `requestLibrarySurface(sessionId)`，没有随导航状态带走。

真机截图证据（已存在，未重新截图）：`docs/teamflow/2026-11-05-r17-ui-polish/real-03-member.png`。

## 2. 改动点

### 2.1 `src/client/nav.ts`

- `MainNavView` 的 member 分支增加 `sessionId?: string`（注释写明 main 槽位 props 无 sessionId 的原因）。
- `openMemberNav(memberId, taskId?, sessionId?)`：第三参非空（trim 后）时写进导航状态；缺省 / 空串 / 纯空白**不写该键**，避免 `deepEqual` 因空字段漂移。
- `navigateToMember(sessionId, memberId, taskId?)`：调 `openMemberNav` 时透传 `sessionId`。
- 新增导出纯函数：
  - `resolveMemberSessionId(propsSessionId, nav)`：nav 是 member 且 `nav.sessionId` 非空 → 返回 `nav.sessionId`；否则返回 `propsSessionId`。
  - `isStaleMemberNav(propsSessionId, nav)`：`propsSessionId` 是真实会话（非空、非 `'current'`）且 nav 是 member 且 `nav.sessionId` 非空且二者不等 → `true`。

### 2.2 `src/client/LibraryPage.tsx`

- `LibraryContent` 先取 `propsSessionId = sessionIdOf(props)`，再按 `staleMemberNav ? propsSessionId : resolveMemberSessionId(propsSessionId, nav)` 选会话喂 `usePanelState(sessionId)`：正常成员页用导航记下的来源会话，陈旧回落时用当前槽位 props 的真实会话；`readMemory` / `useEffect([sessionId, loadLibrary])` 等全部依赖同一个 `sessionId`，保持一致。
- 陈旧导航保护：`staleMemberNav = isStaleMemberNav(propsSessionId, nav)`；渲染分支改为 `nav.kind === 'member' && !staleMemberNav`，陈旧时回落到项目库视图，且项目库使用 props 的真实会话（右栏在会话 A 打开了会话 B 的成员页时不再永远「找不到」）。
- `MemberPage` 的查找逻辑与空态文案**未改**；`data-library-view={nav.kind}` 契约保持不变。

### 2.3 `test/member-page.test.ts`

- 新增「`openMemberNav` 携带来源会话」：返回值与 `mainNavView()` 都含 `sessionId: 'session-x'`；空串 / 空白不写键。
- 新增 `resolveMemberSessionId` 三分支：导航有 sessionId 优先、props 真实会话次之、都空时原样返回 `'current'`。
- 新增 `isStaleMemberNav` 两个方向：props 为另一个真实会话 → `true`；props 等于导航会话 / `'current'` / 导航无 sessionId / 项目库 → `false`。
- 既有 `navigateToMember` 断言补上必然出现的 `sessionId: 'sess-1'` 字段（透传后的新契约）；`LibraryPage.tsx` 源码契约补接线断言（含「陈旧回落用 props 会话」）。

## 3. 门禁命令与结果

```text
$ pnpm typecheck
> dsh-auto-team@0.1.0 typecheck
> tsc --noEmit
退出码 0（无输出）

$ node --test test/member-page.test.ts test/run-switcher.test.ts test/client-contract.test.ts
ℹ tests 72
ℹ pass 72
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
退出码 0
```

拆分：`member-page` 27/27、`run-switcher` 13/13、`client-contract` 32/32。

## 4. 真机证据

- 缺陷现场：`docs/teamflow/2026-11-05-r17-ui-polish/real-03-member.png`（已有，未重新截图）。
- **已真机复验（2026-11-05 02:48，第二宿主 dv/51890）**：`docs/teamflow/2026-11-05-r17-ui-polish/real-08-member-fixed.png` 显示成员页正确渲染 `dev-t1-x4gvxf`（运行中 · 高级全栈工程师 · 任务 t1 · 69,459 · 37 分 50 秒 · 验收 true · 直接消息 1 条），无「成员已不在当前 run 里」。
- 构建（`pnpm build`）与安装/复验由主 agent 统一执行。

## 5. 未验证 / 已知边界

- 真机复验：**已完成**（见 §4）；点角色卡后成员页能按导航会话取到快照并渲染成员详情。
- **未真机覆盖**：宿主 `main` 槽位 props 在个别宿主版本里若开始提供真实 sessionId 且与导航会话不一致，会走「陈旧回落」分支（回落到项目库、并用 props 的真实会话加载项目库）；该分支未在真机触发过，判定（`isStaleMemberNav`）与回落接线由单测覆盖。
- 未跑 `pnpm build`、未 git commit（按简报约束）。
- 无 CSS 改动；无新增依赖；未触及 host 侧代码。
