# 侧边栏「自动团队」点击后主区域无反应：根因与修复

- 日期：2026-11-05
- 基线：`608cb24`（r16）
- 任务：t1（dev-t1-x4gvxf）
- 验收：`pnpm typecheck && pnpm build && test -s docs/teamflow/2026-11-05-sidebar-click-fix.md`

## 1. 结论

r16 把根因归为 `pointer-events`，只解释了一半。完整的失败链有两条，互相独立：

1. **glyph 自己的点击从不选主区。** `PanellistEntry` 的 `onClick` 调 `createOpenLibrary`，而 r16 的
   `createOpenLibrary` 通过 `ctx.inject(['mainArea'])` 取一个**宿主根本不存在的服务**
   （宿主 asar 全量检索 `mainArea` 0 命中）。注入永不回调，`layout` 永远 `undefined`，点击图标只会
   `panel.open()` + 派发右栏事件。主区之所以平时还能切换，是**点击事件继续冒泡到宿主侧栏行**，
   由宿主行自己调 `layout.selectPanel(id)`。一旦点击目标落在 glyph 上而冒泡没有到达宿主行
   （或被拦、行不可用、右栏收起），主区就不会变化——用户看到的就是「点了没反应」。
2. **`main` 槽位可能永久缺失。** `main` 由 AppFrame 声明；r16 在插件 `apply` 时**直接**
   `slots.register('main', ...)`。宿主声明尚未提交时它会抛
   `slot "main" is not declared (a parent entry's children table must declare it)`；
   r16 用 `try/catch` 吞掉后**永不重试**，`main` 永久缺失。此后宿主侧栏行
   `selectPanel(id)` 会抛 `layout.selectPanel: main panel "dsh-auto-team-panellist" is not registered`，
   宿主不改选中态 → 同样表现为静默无反应。

修复两处：

- `createOpenLibrary` 改用真实宿主服务 `layout.selectPanel(PANELLIST_ID)`（`ctx.inject(['layout'], ...)`），
  不再引用 `mainArea`；图标点击自己就能选主区，不再依赖宿主行冒泡。
- `main` 注册改为 `ctx.slots.inject(MAIN_SLOT, () => register(...))`，等 AppFrame 声明提交后再注册；
  回调内先 keyed、失败再退非 keyed，双失败才降级。

## 2. 宿主契约证据

在 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内核对（非推测）：

- `selectPanel(panelId)`：
  `if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error('layout.selectPanel: main panel "..." is not registered');`
  —— `main` 未注册时点击直接抛错，界面保持原样。
- `slots.register` 对未声明槽位抛：
  `slot "<name>" is not declared (a parent entry's children table must declare it)`。
- `slots.inject(key, cb)` 文档：
  `The callback runs synchronously when the declaration already exists; otherwise it runs inside the declaring register() call after the declaration is committed.`
  —— 正是「等声明提交」的官方入口。
- 宿主侧栏行 `PanelRow` 的 `onClick` 调 `selectPanel(id)`；主区渲染为
  `renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })`，`main` 是 root-scoped keyed slot，
  key 必须等于 panellist 的 id。
- 宿主**没有** `mainArea` 服务：asar 内 0 命中；同机 `dsh-plugin-teamflow` 使用的是
  `ctx.get('layout')` / `layout.selectPanel`。

## 3. 真机前后对照

环境：克隆 profile（`~/.dsh/profiles/dv`）起第二宿主，headless Chrome + CDP；两个构建共用同一个
`$DSH_HOME` 数据与同一份插件配置。旧构建是把 `git show HEAD:lib/client.js` 覆盖进另一个克隆
（`~/.dsh/profiles/dvold`），因此页面、数据、宿主版本完全一致，差异只有插件客户端构建。

操作刻意**绕过宿主侧栏行冒泡**：从 DOM 上取 React props（`Object.keys(svg).find(k => k.startsWith('__reactProps$'))`），
直接调用 glyph 的 `onClick`。这样只执行插件自己的点击处理，模拟「点击落在图标上、宿主行处理没跑到」
的真实条件。

| 构建 | 直接调 glyph onClick 后 `data-last-open-result` | 可见 surface | 宿主选中行 |
|---|---|---|---|
| 旧 `608cb24` | `event` | 仅 `[data-library-surface="panel"]`（右栏） | `null`（主区仍是 conversation） |
| 新（本次修复） | `main` | `[data-library-surface="main"]`，rects=1 | `自动团队` |

旧构建下另一项对照：**点击宿主行按钮**时主区也能打开（因为宿主行自己调了 `selectPanel`）。
这正说明 r16 的「克隆宿主能点」验收漏掉了图标自身的处理路径。

新构建真机截图（800×600，侧栏处于 56px rail 折叠态；「自动团队」glyph 高亮，主区显示项目库）：
[2026-11-05-sidebar-click-fix-main.png](./2026-11-05-sidebar-click-fix-main.png)

## 4. 改动清单

### `src/client/slots.ts`

- 新增 `LayoutFace`（`selectPanel?(panelId: string | null): boolean | void`），删除虚构的 `MainAreaFace`。
- `createOpenLibrary`（`src/client/slots.ts:592`）：
  - `ctx.inject(['layout'], scope => { layout = scope.layout })`（`:596`）；
  - 调用 `layout.selectPanel(PANELLIST_ID)`（`:635`），保留 receiver；
  - 仅**显式 `false`** 或抛错算拒绝（真实宿主返回 `void`），成功仍走 500ms watchdog，
    500ms 内没有可见 `main` surface 就降级右栏并派发事件；
  - 返回 `'main' | 'event' | 'error'`，写回 glyph 的 `data-last-open-result`，任何分支都不静默。
- `registerPanellist`（`src/client/slots.ts:664`）：
  - `main` 改为 `ctx.slots.inject(MAIN_SLOT, ...)`（`:700`），先 keyed 再退非 keyed；
  - `mainFailed` 只在两次 `register` 都失败时置真，`result.main` 如实反映；
  - panellist 仍走 `slots.inject(PANELLIST_SLOT, ...)`，两者生命周期语义一致。
- `SlotMeta.inject` 参数类型改为 `(binding?: unknown, actions?: unknown)`；新增 `sessionIdArg`
  （`src/client/slots.ts:343`）归一化座位参数：root keyed 座位宿主不传参 → `'current'`，
  session 座位传 key。

### 测试

- `test/client-contract.test.ts:728`：`registerPanellist` 的 injected 期望改为
  `[PANELLIST_SLOT, MAIN_SLOT]`。
- `test/client-contract.test.ts:785`：新增「main 晚于插件声明时，经 `slots.inject` 等声明提交后再注册」，
  先不声明 `main`，断言不会提前注册；声明后再触发，断言 keyed 注册成功且 key 正确。
- `test/client-contract.test.ts:828`：新增「主区打开只认 `layout.selectPanel`」，断言源码不含
  `mainArea`、必须出现 `layout.selectPanel(PANELLIST_ID)`。
- `test/r16-library-open.test.ts`：fake ctx 从 `mainArea.open` 改为 `layout.selectPanel`，
  覆盖成功 / 抛错 / 显式 false / 500ms watchdog / surface 优先级。

## 5. 验证记录

| 命令 | 退出码 | 结果 |
|---|---|---|
| `pnpm test` | 0 | 758 tests / 758 pass / 0 fail |
| `pnpm typecheck` | 0 | `tsc --noEmit` 无输出 |
| `pnpm build` | 0 | `lib/client.js` 434558B、`lib/index.js` 453885B |
| `node --input-type=module -e "await import('./lib/client.js')"` | 0 | 守卫生效，无 `window is not defined` |
| `node --input-type=module -e "await import('./lib/index.js')"` | 0 | 宿主产物可导入 |

真机复核命令（可重跑，端口可换）：

```bash
# 1) 克隆 profile 并安装当前仓库（不要覆盖用户 desktop profile）
cp -R ~/.dsh/profiles/desktop ~/.dsh/profiles/dv
cd ~/.dsh/profiles/dv && pnpm add file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
# 2) 起第二宿主（DSH_HOME 用克隆，端口 51890）
# 3) headless Chrome --remote-debugging-port=9333 打开 http://127.0.0.1:51890
# 4) CDP 直接调 glyph 的 React onClick，读 data-last-open-result / [data-library-surface]
```

实测结果：新构建 `data-last-open-result="main"`、`[data-library-surface="main"]` 可见、
选中行 `自动团队`；旧构建同操作只有 `panel` surface、`data-last-open-result="event"`。

## 6. 残留风险与边界

- **未直接在用户当前宿主进程（54058/56645）上复现**：桌面 App 未开远程调试端口，无法注入 CDP。
  验证使用同一构建、同一 `$DSH_HOME` 数据的克隆宿主；差异只有进程实例。
- **56px 窄侧栏（rail）已顺带验证**：上面的截图即 800×600 rail 折叠态，glyph 高亮且主区可见；
  直接调 glyph onClick 的对照也在该宽度下完成（`selectedRow=自动团队`）。更宽/更窄的宽度未穷举，
  但修复路径只依赖 `layout.selectPanel`，与侧栏宽度无关。
- **`main` 声明永不出现**（宿主后续改契约）：`slots.inject` 回调不会跑，`result.main` 会停在乐观值
  `true`，但 `main` 实际不存在；glyph 点击时 `layout.selectPanel` 抛错 → 右栏降级并返回 `event`，
  用户至少能看到右栏，不再静默。宿主侧栏行自身仍可能抛错，这是宿主行为，插件无法拦截。
- **需要重启/刷新宿主**：`lib/client.js` 已重新构建，但运行中的 App 不会热替换宿主侧 bundle；
  用户需重启桌面 App（或刷新页面）才会加载本次修复。
- 工作树当前只改了 `src/client/slots.ts`、两个测试文件与构建产物 `lib/client.js`（`lib/` 按团队约定入库），
  未改其它模块。
