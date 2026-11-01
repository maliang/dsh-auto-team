# UI 槽位事实页（client 侧 `Slots` 目录实测）

> **用途**：本插件要在宿主 Web UI 里挂入口（输入框开关、顶部按钮、右栏面板、设置页）时，**先读这一页**，不要临场调 `cordis_inspect_query`。
> **来源**：`cordis_inspect_query(platform="client", provider="Slots", method="listSubTree", input={})` 的完整返回（106 个槽位），主 agent 2026-11-01 实测落盘。
> **为什么单独成页**：这条 inspect 调用在流水线里被误判成「环境不可用」共 **4 次**（r1/r4/r5/r6 + r7 PRD），累计烧掉约 900k 新增 token。本页就是那 106 个槽位里与我们相关的部分的**逐字摘录**，够用，别重查。

## 1. 我们要用的槽位（`kind` / `scope` / `replaceRisk` / 注册字段逐字）

| 槽位 | kind | scope | replaceRisk | 用途（宿主原文） | 注册字段 |
|---|---|---|---|---|---|
| `conversation.input.dock` | list | session | none | Full-width entries **above** the composer card. | `id*` / `order?` / `label?` |
| `conversation.composer.dock` | list | session | none | Ambient entries **below** the composer card. | `id*` / `order?` / `label?` |
| `conversation.composer.bar` | single | session-maybe | shadows-shipped-ui | Resident composer body, including the no-Session inert state. | — |
| `conversation.input.activity` | single | session | **shadows-shipped-ui** | Compact action **after the model selector**; it can expand across the toolbar while retaining the editor and submit action. | — |
| `conversation.session.header.actions` | list | session | none | Title-adjacent Session actions in ascending order. | `id*` / `order?` / `label?` |
| `conversation.session.header.utilities` | list | session | none | Right-aligned Session utilities in ascending order. | `id*` / `order?` / `label?` |
| `conversation.session.header.corner` | single | session | **shadows-shipped-ui** | The header's far-right corner, past the utilities' edge. | — |
| `sidebar.right.pane.tab` | **keyed** | session | none | One tab's body, dispatched with the `id` of the type in force for `tab.kind`. | `key*` |
| `sidebar.right.pane.tab.title` | **keyed** | session | none | A tab's title as its chip (and a floating panel's header), dispatched with the same key. | `key*` |
| `sidebar.right.tab.menu.item` | list | session | none | Extra items at the end of one tab's actions menu. | `id*` / `order?` / `label?` |
| `rightbar` / `rightbar.session` | single | root / session | — | 右栏容器与会话内容座位（由 `layout` 服务控制开合）。 | — |
| `settings.section` | list | root | none | One settings page per list entry. | 见宿主 `SettingsSection` 契约 |
| `settings.general.item` | list | root | none | One preference row inside the General section — the additive seat for a single preference. | 见宿主契约 |
| `settings.action` | list | root | none | Optional actions rendered in the content-column header before Close. | `id*` / `order?` / `label?` |
| `sidebar.panellist` | list | root | none | Global panel icons. | `id*` / `order?` / `label?` |
| `sidebar.footer.action` | list | root | none | Optional actions beside Settings at the sidebar foot. | `id*` / `order?` / `label?` |
| `shell.leading` | single | root | **shadows-shipped-ui** | Window-chrome seat at the frame's top-left, over every main panel. | — |

**选位建议**
- 「开关/选项放进输入框」→ `conversation.input.dock`（在输入卡**上方**、整宽）或 `conversation.composer.dock`（下方）。两者 `replaceRisk: none`，可安全使用。
- 「顶部面板按钮」→ `conversation.session.header.actions`（标题旁，list，安全）。**不要**用 `conversation.input.activity` / `conversation.session.header.corner` / `shell.leading`：它们 `replaceRisk: shadows-shipped-ui`，占了会遮住宿主自带 UI。
- 「右栏面板」→ `sidebar.right.pane.tab` + `.title`（同 key）**加上** tab 类型注册（见 §2）。
- 「设置栏」→ `settings.section`（独立设置页）；单条偏好可以只贡献 `settings.general.item`。

## 2. 右侧栏页签：**必须三步**，少一步就「构建全绿、页签永不出现」

```ts
// ① 注册 tab 类型（服务由 sidebar-right 插件在「有屏幕会话」时才 provide）
ctx.inject(['sidebarRightTabs'], (scope) => {
  scope.sidebarRightTabs.register({
    id: 'dsh-auto-team-panel',      // 与下面 keyed key 复用同一值
    kind: 'dsh-auto-team-panel',
    priority: 'extension',
    title: () => '自动团队',
    // 页面型页签不给 patterns：按 kind 打开
  })
})
// ② 挂载点（keyed，必须带 key）
ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-auto-team-panel', inject: () => ({}) }, Panel)
ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: 'dsh-auto-team-panel', inject: () => ({}) }, Title)
// ③ 打开（页面型页签不会自己出现）
ctx.sidebarRight.openTab('dsh-auto-team-panel')
```

`sidebarRightTabs.register` 的完整选项（宿主 README 原文）：`{ id, kind, patterns?, priority?, canOpen?, title, guide?, keepMounted? }`。

## 3. 三个「只有真机才知道」的坑

1. **`scope: session` 的槽位只在活会话里渲染**：`conversation.composer.dock` / `conversation.input.dock` / 页签都是 session 作用域。在「新建会话落地页」采样会得到「未挂载」的假阴性（r6 QA-03 的真实归因错误）。验证前先造一个活会话。
2. **`sidebarRightTabs` / `sidebarRight` 不在 client Service 目录里**（客户端的 9 个 Service 是 `layout`/`locale`/`sessions`/`slots`/`theme`/`timer`/`uiWorkspace`/`workspaces`）——它们是会话侧 `ctx.reflect.provide` 的，`apply` 时刻取不到属正常。必须用 `ctx.inject(['sidebarRightTabs','sidebarRight'], cb)` 等它。
3. **`replaceRisk: shadows-shipped-ui` = 占位即遮盖宿主 UI**。`single` 槽位尤其危险；只有确认要替换宿主实现时才占。

## 4. 验证配方（真机）

```bash
# 造活会话 → 采样槽位文本（无头浏览器 + CDP，示例脚本见 docs/teamflow/architecture/REAL-HOST-VERIFY.md）
node logs/…/scripts/cdp-send.mjs "http://127.0.0.1:<port>/?token=<t>"
# 断言：document.querySelectorAll('[data-slot="conversation.input.dock"]').length > 0
#       body.innerText 含「自动团队」
#       document.querySelectorAll('[data-slot="sidebar.right.pane.tab"]').length === 1（点开面板后）
```

## 5. 与本页相关的既有实现

- `src/client/slots.ts`：`panelTabDefinition()` / `registerPanelTab()` / `registerSlots()` / `createOpenPanel()` —— r6 已按本页 §2 落地，改动前先读它。
- `src/client/index.ts`：`export const inject = ['slots']`，`apply` 里依次注册。
- `test/client-contract.test.ts`：keyed slot 必须带 `key`、挂载点 `name` 与 `inject` 逐字一致等契约断言都在这里。
