# t3a — 需求④：主界面 100% 高度 + 抽屉高度修正

> 任务：r17 UI 四项改造之④（styles.ts）
> 成员：frontend-t3a（前端工程师）
> 日期：2026-11-05
> 验收命令：`pnpm typecheck && node --test test/r17-height.test.ts`

## 1. 问题与根因

用户原话（队长转述，2026-11-05）：

> 点侧边栏自动团队主界面显示的内容没有 100% 高度，抽屉的高度也不对

真机症状：

1. 从侧栏进入「自动团队」主界面（`main` 槽位）后，项目库只占自身内容高度，下方是大片空白；
2. 详情列不会在剩余高度里内滚，页面被内容撑长；
3. 打开运行详情抽屉时，抽屉只有「内容那么高」，而不是整块主区高度。

根因是一条高度链在三处断了，抽屉只是同一根因的第二个症状：

| 层级 | 改动前 | 结果 |
|---|---|---|
| `[data-auto-team-library]`（根） | 没有 `height` / `display:flex` / `min-height` | 根节点高度 = 内容高度，父级给的高度没被接住 |
| `[data-library-shell]` | 只有 `container-type: inline-size` + `position:relative` + `min-height:0` | 仍按内容高度排版 |
| `[data-library-body]` | `display:flex` + `min-height:0`，但**没有 `flex:1`** | 不占据头部之外的剩余高度 |
| `[data-run-drawer]` | `position:absolute; top/right/bottom:0` | 包含块是 shell（受 `contain: layout` 约束），shell 多高抽屉就多高 → 跟着变矮 |

结论：必须从根节点把高度链接满，让 `shell` 成为整块主区高度的包含块；抽屉自身不需要单独「变高」。

## 2. 实现（仅改样式 owner 文件 `src/client/styles.ts`）

### 2.1 主界面根节点（新增规则，只作用于 main 面）

```css
[data-auto-team-library][data-library-surface="main"] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

- 只认 `data-library-surface="main"`：右栏内联降级面是 `"panel"`、侧栏图标是 `[data-auto-team-panellist]`，都不会被这条规则撑高。
- 不用 `100vh/100dvh`：视口高度包含宿主标题栏/工具条，主区会溢出；高度必须相对宿主主内容区。

### 2.2 高度链逐级接住

| 选择器 | 新增/修正声明 | 作用 |
|---|---|---|
| `… [data-library-shell]` | `display:flex; flex:1 1 auto; flex-direction:column; width:100%; min-width:0` | 吃掉根节点剩余高度，成为抽屉的整高包含块 |
| `… [data-library-head]` | `flex: 0 0 44px` | 头部固定 44px，不参与伸缩 |
| `… [data-library-body]` / `… [data-project-split]` | `flex:1 1 auto; overflow:hidden` | 分栏容器占满头部之外的高度 |
| `… [data-region="project-detail"]` | `min-height:0` | 详情列在剩余高度内 `overflow:auto`，不撑高父级 |
| `… [data-region="project-list"]` | 保持 `flex:0 0 220px; max-height:100%; overflow:auto` | 列内自滚（窄宽折叠规则不变） |

### 2.3 抽屉

| 选择器 | 新增/修正声明 | 作用 |
|---|---|---|
| `[data-run-drawer]` | `max-height:100%; min-height:0; overflow:hidden` | 高度上限锁到 shell；`top/right/bottom:0` 不变，shell 撑满后即整高 |
| `[data-run-drawer] [data-drawer-head]` | `flex: 0 0 44px` | 抽屉标题固定 44px |
| `[data-run-drawer] [data-drawer-body]` | 保持 `flex:1 1 auto; min-height:0; overflow:auto` | 正文在抽屉内滚动 |
| `[data-run-drawer-mask]` | 保持 `position:absolute; inset:0` | 遮罩随 shell 覆盖整块主区 |

## 3. 设计取值表（尺寸/间距/字号）

| 元素 | 取值 | 说明 |
|---|---|---|
| 主界面根节点 | `width/height: 100%`，`min-width/min-height: 0` | 相对宿主主内容区，不用视口单位 |
| 项目库头部 | 高 44px，`flex: 0 0 44px`；内边距 `0 14px`；字号 `font: var(--dsw-font-sm-14, 14px/20px …)` | 既有设计，本次只固定不伸缩 |
| 分栏容器 | `flex: 1 1 auto`，`min-height: 0` | 占满头部之外高度 |
| 项目列 | `flex: 0 0 220px`（窄宽折叠 `max-height: 168px`） | 既有设计不变 |
| 详情列 | `flex: 1 1 auto`，`min-height: 0`，`padding: 12px 14px` | 列内 `overflow:auto` |
| 抽屉宽度 | `min(520px, 100%)` | 窄宽 320px 时不溢出 |
| 抽屉标题 | 高 44px，`flex: 0 0 44px` | 与项目库头部同高 |
| 抽屉正文 | `flex: 1 1 auto`，`min-height: 0`，`overflow: auto` | 内滚，不把抽屉顶出可视区 |
| 遮罩 | `inset: 0` | 覆盖 shell 全高 |

字号全部沿用既有 `font:` 简写与宿主 token；本次未新增字号、颜色或魔法色值。

## 4. 改动文件

| 文件 | 改动 |
|---|---|
| `src/client/styles.ts` | 新增 main 面根节点高度规则；shell/head/body/project-detail 高度链；抽屉 max-height/min-height/overflow 与标题固定高度 |
| `test/r17-height.test.ts` | 新增 5 条静态样式契约：根节点 100% / 高度链 / 抽屉整高 / DOM 钩子一致性 / 样式纪律 |
| `docs/teamflow/2026-11-05-r17-ui-polish/t3-height.md` | 本文档 |

未改 `lib/`（构建由后续统一执行），未触碰其他任务在 `styles.ts` 里的改动。

## 5. 验证

实际执行（2026-11-05，仓库根）：

```bash
pnpm typecheck && node --test test/r17-height.test.ts
```

结果：

- `tsc --noEmit`：退出码 0
- `node --test test/r17-height.test.ts`：5/5 通过，退出码 0

额外回归：

```bash
pnpm test
```

- 779 例全部通过（含 `test/r16-styles.test.ts` 等既有样式契约）

## 6. 真机验证状态

**未验证（真机）**。本任务是纯样式契约层交付，按团队约定真机验证只由主 agent 执行；我未启动第二宿主、未截图。主区高度链是否能从宿主槽位父容器接住 `height:100%`，需要在真机确认以下三点：

1. `[data-auto-team-library][data-library-surface="main"]` 的计算高度等于宿主主区高度（不是内容高度）；
2. 项目详情列出现内滚条，页面本身不出现整页滚动；
3. 打开运行抽屉后，抽屉上下边贴住主区上下边（高度 = shell 高度），正文在抽屉内滚动。

若真机上根节点父级不是确定高度（`height:100%` 解析为 auto），需要主 agent 把宿主 main 槽位父容器的类名/高度事实回传，再补一条针对父级的 `flex` 或 `height` 规则；当前实现已用 `flex:1 1 auto` 兼容父级为 flex 容器的情况。

## 7. 剩余风险 / 后续

- t3b 会在同一文件追加新钩子样式，两者改动的选择器不重叠；本任务是 t3b 的前置依赖。
- 抽屉现在仍覆盖项目库头部区域（`top:0` 相对 shell），这是 r16 既有行为；本次只修高度，未改层叠语义。若产品希望抽屉从头部下方开始，应另立需求改 `[data-library-shell]` 内部结构与抽屉定位。
