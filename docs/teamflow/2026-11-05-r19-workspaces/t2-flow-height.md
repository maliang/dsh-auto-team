# t2 · 右侧面板流转图画布高度翻倍（300px → 600px）

- 需求（用户原文）：「右侧面板中的流程图区域高度增加为当前的两倍」
- 任务夹：`docs/teamflow/2026-11-05-r19-workspaces/`
- 写域：`src/client/styles.ts`、`test/r19-flow-height.test.ts`（新建）、本文件（新建）
- 结论：**只改一条 CSS 声明**（外加同步注释与一条静态契约测试）；节点几何、步进、字号、组件逻辑均未动。

## 1. 改动前的现状

`src/client/styles.ts:2676` 的 `[data-region="task-flow"] [data-flow-canvas]` 规则把画布高度写死：

```css
[data-region="task-flow"] [data-flow-canvas] {
  box-sizing: border-box;
  position: relative;   /* r14 D4：viewport 与「重置视图」的定位上下文 */
  height: 300px;        /* ← 本次改动点 */
  overflow: hidden;     /* r14：固定视口 + 可平移层，不能有滚动条 */
  …
}
```

同一选择器块只出现一次；外层 `[data-region="task-flow"]` 只有 `padding: 8px 12px 10px` 与 `border-top`，**没有** height / max-height。r16 画布几何（`src/client/viewmodel.ts:1332-1341`）为：节点 `180×64`、列步进 `208`、行步进 `80`、列头贴顶 `12`（高 32）、节点从 `54` 起、内边距 `12`。

> 注：任务描述里的「节点 148×56、步进 188/72」是 r14 的旧稿数字；r16 源码常量与 `viewmodel.ts:1331` 注释都是 `180×64 / 208 / 80`，本文以源码为准，且这两个任务都不需要改它们。

## 2. 改后

- `src/client/styles.ts:2671` 区块注释：`画布 300px 双层滚动` → `画布 600px 双层滚动`。
- `src/client/styles.ts:2681`：`height: 300px;` → `height: 600px;`。

改后该规则块的完整声明未变，只有高度值翻倍：

```css
[data-region="task-flow"] [data-flow-canvas] {
  box-sizing: border-box;
  /* r14 D4：… 定位上下文注释保留 */
  position: relative;
  height: 600px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-base, transparent);
  cursor: grab;
  touch-action: none;
}
```

全仓 grep：`300px` 在 `src/client/styles.ts` 中已为 0 命中。

## 3. 为什么只改 CSS（组件侧不需要动）

组件的交互**完全不依赖画布的像素高度**：

- **平移**：`src/client/views/FlowCanvas.tsx:156-200` 的 pointer 逻辑用 `event.clientX/Y` 差值叠加到 `panRef`，上限是常量 `FLOW_PAN_LIMIT = 20000`（`FlowCanvas.tsx:38`），与容器尺寸无关；
- **重置视图**：`resetView()`（`FlowCanvas.tsx:112-126`）只把 `panRef` 归零并 `paint(0, 0)`，不读容器尺寸；
- **节点坐标**：全部由 `flowLayoutOf()`（`src/client/viewmodel.ts`）用上述常量算出，画布内部 `data-flow-viewport` 层按内容自然撑开（`FlowCanvas.tsx:241` 的 `width/height` 来自 `layout`），外层视口多高都不会裁剪计算；
- **核实结论**：全仓 `src/client/` 中 `clientHeight` 命中数为 **0**（任务描述里「组件用 clientHeight 做重置居中等计算」与实际源码不符）；但这不改变结论——组件本来就没有任何高度假设，所以改 CSS 是充分且最小的改动。

## 4. 对真机取景的影响（估算，未实测）

宿主面板高度按 ~900px 的常见右栏内容高估算（无真机截图，见 §7）：

| 项 | 改前 300px | 改后 600px |
|---|---|---|
| 画布占右栏可视高度 | ≈ 1/3 | ≈ 2/3 |
| 完整可见任务行数（行步进 80、节点 64、首行 y=54） | 3 行（54 / 134 / 214，底 278 ≤ 288） | 6 行（54…454，第 6 行底 518）+ 第 7 行露出约 54/64 |
| 面板整体 | 一屏基本放得下（画布 + 图例 + 列表） | 画布 600 + 图例 + 任务列表必然超出一屏 → **右栏整体需要滚动** |

- 画布内部仍是 `overflow: hidden`：多出来的高度**只增加可视行数**，不产生画布内滚动条，也不会破坏「拖动画布 ≠ 滚动页面」（`touch-action: none` 只挂在画布上）。
- 平移/重置按钮仍锚在画布右上角（`position: relative` + 子元素 `absolute`），高度变化不影响锚点。
- 画布变高后，鼠标在画布内拖动仍不会带动页面滚动；但**页面级的滚动**需要把指针移到画布外——这是 r14 以来的既有交互，本次不改变。

## 5. 测试清单

新增 `test/r19-flow-height.test.ts`（静态契约，仿 `test/r17-height.test.ts` 的「读源码 + 解析规则块」风格，3 条）：

1. `r19 画布高度翻倍`：基础规则含 `height: 600px`；所有 `[data-region="task-flow"] … [data-flow-canvas]` 规则里 `height:` 声明唯一且为 600px；流转图区块注释与画布规则都不再出现 `300px`（实测全文件 grep 也为 0）。
2. `r19 高度只有一处`：外层 `[data-region="task-flow"]` 无 `height/max-height/min-height`；画布各规则无 `max-height`；画布高度不得用 `100vh/100dvh`。
3. `r19 视口契约`：`overflow: hidden` 保留且未改成 `auto/scroll`；`position: relative` 保留；`FlowCanvas.tsx` 不含写死的 `300`、不读 `clientHeight`（防止未来把高度假设塞回组件）。

回归面（本次实跑）：

| 命令 | 结果 |
|---|---|
| `node --test test/r19-flow-height.test.ts` | 3/3 pass |
| `node --test test/r19-flow-height.test.ts test/r16-flow-canvas.test.ts test/client-ui.test.ts` | 61 例：61 pass / 0 fail（见 §6） |
| `pnpm typecheck` | **红**：并发任务的 `test/workspace-names.test.ts` 类型错误，见 §6 |

## 6. 门禁输出（2026-11-05，实跑）

测试命令（本任务相关三文件）**全绿**：

```text
$ node --test test/r19-flow-height.test.ts test/r16-flow-canvas.test.ts test/client-ui.test.ts
ℹ tests 61 / pass 61 / fail 0
（r19 新增 3 例全过；r16 画布契约全过；client-ui 的 r14 关键尺寸断言已由并发任务同步为 `height: 600px`）
```

`pnpm typecheck` 仍**红**，报错在**并发任务**的文件里，不属于本任务写域（本任务未改任何 TS/TSX）：

```text
$ pnpm typecheck
> tsc --noEmit
test/workspace-names.test.ts(29,5): error TS2322: Type '"done"' is not assignable to type 'PlanStatus'.
 ELIFECYCLE  Command failed with exit code 2
```

排查过程（避免误判成本任务引入）：

- 第一次跑：`src/host/adapters.ts:243…` `OptionalServiceMap[K]` 索引错误（r19 工作区任务给 `OPTIONAL_SERVICES` 加了 `workspaceRegistry`、但 `OptionalServiceMap` 还没补 key）；
- 第二次跑：`src/host/index.ts:435` `'workspaces' does not exist in type 'LibraryDeps'`；
- 最新一次：`test/workspace-names.test.ts:29` 的 `"done"` 不是 `PlanStatus`（同批并发新增的测试文件）。

三次报错都落在当时正在被并发改动的文件上，逐次变化，本任务的 `src/client/styles.ts` 与新测试文件从未出现在报错里。lead 可待并发任务收敛后复跑 `pnpm typecheck` 确认；本次提交不把这条红算作 t2 的产物问题。

退出码：按 `pnpm typecheck && node --test …` 串联执行 → **2**（typecheck 先失败，`&&` 短路）；测试子命令单独执行 → **0**（61/61）。

## 7. 未真机验证声明

**本次改动未做真机验证**：没有启动第二宿主（51890 克隆 profile），没有截图，也没有在真实右栏里拖动/重置画布。原因：本次是可逆的单值样式改动，且工作区正被多个 r19 任务并发修改，起宿主会与并发改动互相干扰。

因此以下事实仍属**推断**，需真机确认：

- 900px 高宿主下画布实际占位是否为 2/3、右栏是否如预期出现整体滚动；
- 600px 画布下第 7 行节点的实际露出比例、以及图例/列表在滚动中的位置；
- 重置按钮与列头在 600px 下的视觉留白是否协调。

回滚方式：把 `src/client/styles.ts:2681` 的 `600px` 改回 `300px` 即恢复原状（无 JS/数据迁移）。

## 8. 改动文件与行号

| 文件 | 位置 | 改动 |
|---|---|---|
| `src/client/styles.ts` | 2671 | 注释 300px → 600px |
| `src/client/styles.ts` | 2681 | `height: 300px` → `height: 600px` |
| `test/r19-flow-height.test.ts` | 新建 | 3 条静态契约 |
| `docs/teamflow/2026-11-05-r19-workspaces/t2-flow-height.md` | 新建 | 本文件 |
