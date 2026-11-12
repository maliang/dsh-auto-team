# t3b — 新钩子样式收尾：run 切换器 / 子智能体页 / 历史六项 / 可点角色卡

> 任务：r17 UI 四项改造的样式收尾（styles.ts）
> 成员：frontend-t3b-lsbouc（前端工程师）
> 日期：2026-11-05
> 验收命令：`pnpm typecheck && pnpm build && node --test test/r17-styles.test.ts test/client-ui.test.ts`

## 1. 任务与边界

t1（历史行六项）、t2（run 切换器 + 子智能体页 + 角色卡/任务行导航）、t3a（主界面与抽屉高度链）已完成结构、交互与挂载面，本任务只补齐这四块新 DOM 的**可见样式契约**，全部写在样式 owner `src/client/styles.ts`，不碰组件结构。

新增视觉元素在窄宽 320px 下的共同风险：

| 区域 | 最坏情况 | 本任务的约束 |
|---|---|---|
| run 切换器 | caption + 下拉 + 状态 + 提示挤成一行，select 被压到点不到 | 三行折行；select 28px 高、`min-width:0`、可点宽度优先 |
| 子智能体页 | 页面被长任务/长消息撑破，返回条滚走 | 外壳 `min-height:0`，页面自身 `overflow:auto`，bar sticky |
| 历史六项 | 标签十人十色、不可得项看起来像 0 | 3 列 × 2 行 grid；不可得项灰 + 虚线下划线 |
| 可点角色卡 | 只有 hover 暗示，触屏/键盘用户不知道能点 | 常驻业务色描边 + 右下 chevron + `:focus-visible` 外框 |

## 2. 实现（仅 `src/client/styles.ts`，插在文件末尾 reduced-motion 块之前）

### 2.1 run 切换器（`[data-region="run-switcher"]`）

```css
[data-region="run-switcher"] {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  box-sizing: border-box;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
```

| 元素 | 关键声明 | 作用 |
|---|---|---|
| 容器 | `flex-wrap:wrap; gap:4px 8px; padding:8px 12px` | 320px 时按行折，不做横向滚动 |
| `[data-historical="true"]` | `background: var(--dsw-alias-bg-layer-2)`；`box-shadow: inset 2px 0 0 var(--dsw-alias-label-tertiary)` | 历史 run 是**只读**不是异常：中性竖条，不用琥珀/红 |
| `[data-run-switcher-label]` | `flex:1 0 100%; gap:6px; min-width:0` | 整行给「caption + select」 |
| `[data-run-switcher-caption]` | `font: var(--dsw-font-xxxs-11, 11px/16px …)`；`uppercase`；tertiary | 小标签 |
| `select[data-run-switcher]` | `flex:1 1 auto; min-width:0; max-width:100%; height:28px; padding:0 8px; border:1px solid var(--dsw-alias-border-l2)`；hover:not(:disabled) / focus-visible / disabled | 命中高度 ≥24px；单 run 时 disabled 可辨 |
| `[data-run-switcher-status]` | `flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis`；四 tone（ok→success / warn→warn / bad→error / muted→tertiary） | 状态行独占第二行，超长省略 |
| `[data-run-back]` | `height:24px; padding:0 8px`；hover / active / focus-visible / disabled | 「回到当前 run」是历史态唯一出口 |
| `[data-run-switcher-hint]` | `flex:1 0 100%`；`overflow-wrap:anywhere`；11px tertiary | 只读提示整行，长 run 名可断行 |

### 2.2 子智能体主界面（`[data-member-page]`）

外壳由 `LibraryPage` 渲染、页面由 `MemberPage` 渲染，高度链分两层：

| 选择器 | 关键声明 | 作用 |
|---|---|---|
| `(:is(库,右栏)) [data-library-shell] [data-member-surface]` | `display:flex; flex:1 1 auto; flex-direction:column; min-width:0; min-height:0; overflow:hidden` | 成员面吃掉 shell 剩余高度（t3a 的高度链之后） |
| `[data-member-page]` | `flex:1 1 auto; flex-direction:column; width/height:100%; min-*:0; overflow:auto` | 页面自身滚动，不撑高父级 |
| `[data-member-bar]` | `position:sticky; top:0; z-index:2; height/flex 0 0 32px; padding:0 12px`；bottom border | 长页滚动时返回入口常驻 |
| `[data-member-back]` | `height:24px; padding:0 8px`；hover / active / focus-visible | ≥24px 命中区 |
| `[data-member-head]` | `display:flex; flex-wrap:wrap; gap:4px 8px; padding:10px 12px 6px` | 320px 折行 |
| `[data-member-name]` | `sm-14 / 600`；`min-width:0` + ellipsis | 超长成员名不挤走状态 |
| `[data-member-status]` | `height:18px; border-radius:999px`；business / warn / danger / success 四 tone（40% 边框 + 10% 底） | 与任务状态同一套语义色 |
| `[data-member-model]` | `flex:1 0 100%`；等宽字体；`overflow-wrap:anywhere` | provider/model 长串可断行 |
| `[data-member-facts]` / `[data-member-task-facts]` | `display:grid; grid-template-columns:max-content minmax(0,1fr); gap:2px 8px` | 中文标签不折，值列可换行 |
| `[data-stalled="true"]` | 左 2px 琥珀 + `color-mix(… 8%, transparent)` 底；正文不用琥珀 | 停滞只做竖条与淡底（11px 琥珀对比度不达标） |
| `[data-member-route-audit]` | 左 2px `border-l3`；`[data-tone=danger|warn|success]` 只改左竖条色 | verdict 用竖条，正文保持可读 |
| `[data-member-task]` / `[data-region="member-messages"]` | 卡片 `margin:0 12px 10px; padding:8px 10px; border-l1; radius-sm; bg-layer-1` | 两块信息各回答一个问题 |
| `[data-member-task-id]` | `min-width:24px; height:18px`；等宽 + tabular | tN 徽标不被压扁 |
| `[data-member-task-title]` | `flex:1 1 120px; min-width:0` + ellipsis | 长标题省略，不推歪状态 |
| `[data-cell=…][data-usage-source="unavailable"]` 等 | tertiary + `text-decoration: underline dotted` | 不可得 ≠ 0 |
| `[data-member-message-list]` | `max-height:240px; overflow:auto; list-style:none` | 消息再多也不把整页撑到几千像素 |
| `[data-member-message-body]` | `white-space:pre-wrap; overflow-wrap:anywhere`；展开后 `max-height:216px; overflow:auto` | 代码/长串不横向溢出 |

### 2.3 历史行六项（`[data-region="history-list"] [data-history-line="usage"]`）

```css
[data-region="history-list"] [data-history-line="usage"] {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px 8px;
  padding-top: 4px;
  border-top: 1px dashed var(--dsw-alias-border-l1, currentColor);
}
```

| 元素 | 关键声明 | 作用 |
|---|---|---|
| metric | `display:flex; flex-direction:column; min-width:0`；`font: var(--dsw-font-xxxs-11)` | 3 列 × 2 行，列宽可缩 |
| label | tertiary + `white-space:nowrap` + ellipsis | 六项标签唯一来自 `usageMetricsOf`，不换行 |
| value | `font: var(--dsw-font-xxs-12)` + 600 + `tabular-nums` + ellipsis | 数字列对齐 |
| `[data-available="false"] value` | tertiary + 400 + `border-bottom:1px dashed border-l2` + `cursor:help` | 唯一区分「宿主没上报」与真 0 的视觉 |

和既有历史行 `button[data-history-open]`（整行可点、hover/active/focus-visible）组合：六项是行内静态文本，不拦截点击。

### 2.4 可点角色卡（`[data-role-card][data-role-card-open="true"]`）

| 状态 | 声明 |
|---|---|
| 常驻 | `position:relative`；`cursor:pointer`；`border-color: color-mix(in srgb, business 28%, transparent)` |
| `:hover` | `background: bg-layer-2`；边框提到 55% |
| `:active` | `background: interactive-bg-active` |
| `:focus-visible` | `outline:2px solid business; outline-offset:1px` |
| 常驻暗示 | `::after` content `"›"`，绝对定位 `right:6px; bottom:3px`，business 13px，`pointer-events:none`；`[data-role-line="meta"]` 让出 `padding-right:10px` |

- 点不动的卡（`data-role-card-open` 不存在）不匹配任何新规则，仍是普通 `article`，无 pointer/描边。
- 键盘可达性由 RoleCard 组件提供（`role="button"`、`tabIndex=0`、aria-label），本任务只保证焦点可见。

### 2.5 减少动效

`@media (prefers-reduced-motion: reduce)` 追加：`[data-region="run-switcher"]`、其 select、`[data-run-back]`、`[data-member-page] [data-member-back]` 的 transition 关闭。

## 3. 设计取值表（尺寸/间距/字号）

| 元素 | 取值 | 说明 |
|---|---|---|
| 切换器容器 | 内边距 8×12；行/列间距 4×8 | 320px 下三行内容 |
| 切换器 select | 高 28；水平内边距 8；字号 12/18 | 命中区 ≥24 |
| 「回到当前 run」 | 高 24；水平内边距 8；字号 11/16 | 与状态行同高 |
| caption / status / 标签 | 11/16 | 最小可读字号 |
| 成员页返回条 | 高 32（`flex: 0 0 32px`），内边距 0×12 | sticky |
| 返回键 | 高 24；水平内边距 8 | ≥24 |
| 成员名 | 14/20、600 | 头部主信息 |
| 状态徽标 | 高 18，圆角 999 | 与任务/角色状态同规格 |
| 事实表 | 行/列间距 2×8；标签 11，值 12 | 中文标签 `max-content` |
| 任务/消息卡片 | 外边距 0 12 10；内边距 8×10 | 两卡片统一 |
| 任务徽标 | 最小宽 24，高 18 | tN 不被压扁 |
| 消息列表 | 最大高 240；展开正文最大高 216 | 内滚 |
| 历史六项 | 3 等列，间距 2×8；顶边距 4；标签 11，数字 12/600 | 2 行 |
| 角色卡 chevron | 右下 6/3；13px | 常驻可点暗示 |

所有颜色走宿主 `--dsw-*` token（含 `color-mix` 的百分比），字号一律 `font:` 简写，无裸 16 进制、无 `--dsw-*` 自定义、无视口高度单位。

## 4. 改动文件

| 文件 | 改动 |
|---|---|
| `src/client/styles.ts` | 新增 r17 四段样式（run 切换器 / 子智能体页 / 历史六项 / 可点角色卡）+ reduced-motion 覆盖 |
| `test/r17-styles.test.ts` | 新建 6 条静态契约：切换器折行与三态、成员页高度链与内滚、历史六项可分辨、角色卡四态、DOM 钩子一致性、样式纪律 |
| `docs/teamflow/2026-11-05-r17-ui-polish/t3b-styles.md` | 本文档 |

未改组件 TSX（挂载面与 DOM 钩子沿用 t1/t2），未手改 `lib/`（由 `pnpm build` 重新生成）。

## 5. 验证

实际执行（2026-11-05，仓库根，一条命令串联）：

```bash
pnpm typecheck && pnpm build && node --test test/r17-styles.test.ts test/client-ui.test.ts
```

结果：

- `tsc --noEmit`：退出码 0
- `pnpm build`：client 489.42 kB / host 465.40 kB，退出码 0（仅 tsdown 既有 deprecation warning）
- `node --test test/r17-styles.test.ts test/client-ui.test.ts`：**47/47 通过**（其中本任务新增 6 条），退出码 0

补充回归：`node --test test/r16-styles.test.ts test/r17-height.test.ts` 14/14 通过（t3a 的高度契约未被新块破坏）。

## 6. 真机验证状态

**未验证（真机）**。本任务未启动第二宿主、未截图，按团队约定真机验证由主 agent 执行。需要在真机确认：

1. 右侧面板宽 320px 时，切换器三行不重叠、select 可点开，历史态「回到当前 run」可点；
2. 子智能体页上下滚动时返回条贴在面板顶部，消息列表出现内滚而不是整页滚动；
3. 历史行六项为 3 列 × 2 行，不可得项显示为灰色 + 虚线下划线而非 `0`；
4. 可点角色卡在未 hover 时就有描边与右下 `›`，Tab 聚焦时出现 2px 外框。

若真机上出现横向滚动条，优先检查 `[data-member-model]` 与消息正文是否被宿主容器 `min-width:auto` 顶开——本实现已给这两处 `min-width:0` / `overflow-wrap:anywhere`。

## 7. 剩余风险 / 后续

- 样式契约测的是「源码里有这条声明」，不是浏览器计算值；真机若被宿主更高优先级选择器覆盖，需要在真机回传计算样式再补 `:where()` 降权或提高特异性。
- 历史六项在 320px 下每列约 90px，`输入未命中` 四个字可完整显示，但若宿主字体被放大到 16px 以上，标签会省略为 `输入未…`；省略是预期行为，完整值在 `title`（由 t1 组件提供）。
- 角色卡 chevron 用 `::after` 文本，若后续给卡片加 `overflow:hidden` 会被裁掉，届时改用独立 span。
