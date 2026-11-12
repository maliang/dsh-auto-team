# 右侧面板「不可得」修复（r17 / t1）

- 日期：2026-11-05
- 任务：run `run-mw2bmrdj-p3j` / t1「定位并修复右侧面板多处『不可得』占位符」
- 写域：`src/client/`、`src/shared/`、`docs/teamflow/`（**未触碰 `src/host/`**）

## 1. 现象

真机会话 `session-619ca381-3a27-44fb-b1f2-507a8539e3ce` 的右栏面板有四处「不可得」：

1. RunHeader「成员合计」后面的 token
2. 角色卡片元信息行「token · 用时」里的 token
3. 任务列表行的「角色 · token · 用时」里的 token
4. 流程图卡片第二行「token · 用时」里的 token

## 2. 定位结论：四处是同一个单元格

四处并不是四个 bug，而是**同一个 token 单元格**在四个组件里的渲染；「用时」本身是正常的：

- `src/client/views/RunHeader.tsx:50`：`成员合计 <b>{head.usageText}</b>`
- `src/client/views/RoleCard.tsx`：`data-role-usage`（token）· `data-role-duration`（用时）
- `src/client/views/TaskTable.tsx`：`data-cell="token"` · `data-cell="duration"`
- `src/client/views/FlowCanvas.tsx` + `viewmodel.ts#flowNodeViewOf`：第二行 `tokenText · durationText`

真机快照（`GET /api/auto-team/snapshot?sessionId=session-619ca381-…`，2026-11-05 00:18 左右）证据：

```json
"runUsage": { "source": "unavailable", "reason": "尚无用量事件" },
"runDuration": { "text": "2 分 51 秒", "state": "running" },
"taskUsage": { "t1": { "source": "unavailable", "reason": "尚无用量事件" },
               "t2": { "source": "unavailable", "reason": "尚无用量事件" } },
"taskDurations": { "t1": { "text": "2 分 51 秒", "state": "running" },
                   "t2": { "state": "not-started", "text": "未开始" } }
```

即：**时长全部算得出来，只有用量缺失**。本地探针（直接 import `src/client/viewmodel.ts`）复现一致：run head `usageText=不可得`，角色 dev `usage unavailable / duration running 2 分 51 秒`，任务 t1 token unavailable / duration running，流程图文本 `不可得 · 2 分 51 秒`。

## 3. 根因与修复（t1 范围内的两处真实缺陷）

### 3.1 成员合计的聚合回退是死代码

`src/client/viewmodel.ts#buildRunDetail` 旧实现：

```ts
usage: snapshot.runUsage ?? sumUsage(taskViews.map((t) => t.usage), '该 run 没有可用用量事件'),
```

宿主快照**永远**带 `runUsage`（没有用量事件时是一个 `{source:'unavailable',reason:'尚无用量事件'}` 的单元格，不是缺字段），所以 `??` 永远不触发回退——`sumUsage` 聚合分支只在单测里走过。后果：即使 t2 把任务级用量打通（`taskUsage.t1` 变成 provider），「成员合计」仍会恒显示「不可得」。

修复后的优先级：

1. 宿主 run 合计是 provider → 直接采用（权威值）；
2. 否则若有任务级用量 → 用客户端聚合值：**全部任务都有数才给数字**，部分缺失仍返回「不可得 + 部分任务没有可用用量事件」，不低估；
3. 再否则保留宿主给的 unavailable 原因（如「尚无用量事件」），没有才用兜底文案。

### 3.2 流程图卡片只说「不可得」，说不出原因

`flowNodeViewOf` 生成的 `title`（悬停/无障碍）与 `label` 原本只有 `token 不可得`，而 RunHeader / RoleCard / TaskTable 的 title 早已带 reason。用户原话就是「这些不可得是怎么回事儿」，现在不可得时 title/label 追加原因：

```
t1 任务t1 · 角色 全栈工程师 · token 不可得（尚无用量事件） · 用时 4 分 05 秒
```

节点正文第二行保持 `不可得 · 4 分 05 秒` 不变（不挤占 158px 内宽）；token 可得到数字时输出与旧版逐字一致，不加任何后缀。对旧快照里缺 `usage` 字段的节点做了 undefined 保护（避免 `Cannot read properties of undefined (reading 'source')`）。

### 3.3 改动文件

| 文件 | 改动 |
|---|---|
| `src/client/viewmodel.ts` | `buildRunDetail` 用量回退改为 provider→任务聚合→宿主原因的显式优先级；`flowNodeViewOf` 在 token 不可得时把 reason 写进 title/label |
| `test/viewmodel.test.ts` | 新增「快照恒带 unavailable runUsage 时仍聚合任务用量」「flowNodeViewOf 不可得时 title/label 带原因」两例；覆盖完整聚合=300、部分缺失不可得、空用量保留宿主原因、provider 路径原串不变 |

`src/shared/` 无需改动（`UsageCell` / `FlowNodeView` 形状不变）。

## 4. 验证

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node --test test/viewmodel.test.ts test/r16-flow-canvas.test.ts test/client-contract.test.ts` | 0 | 118 pass / 0 fail |
| `pnpm test` | 0 | **760 pass / 0 fail**（含侧边栏工作流新增用例） |
| `pnpm typecheck` | 0 | 通过 |
| `pnpm build` | 0 | `lib/index.js` + `lib/client.js` 双产物重建 |
| `test -s docs/teamflow/2026-11-05-panel-na-fix.md` | 0 | 本文非空 |

## 5. 与 t2 的边界（重要）

t1 **只修渲染层的两个缺陷**，没有、也不应该碰 `src/host/`。面板上 token 显示「不可得」的**数据源**问题仍在：

- 所有历史 run 的持久化记录里 `usage: undefined`；
- 宿主侧 `src/host/index.ts#recordUsage` 与 `src/host/team/usage.ts#usageOfSessionEvent` 的订阅链路没有真正记录用量（`runUsage`/`taskUsage` 始终是 `尚无用量事件`）。

因此 t1 交付后，真机面板可能仍显示「不可得」，但：

- 原因现在能在流程卡片悬停里看到；
- 一旦 t2 把 `taskUsage` 打通，即使宿主仍只给任务级数据，「成员合计」也会自动聚合出数字（本文 3.1 的修复）。

用户问的六项指标（输入未命中 / 输入命中 / 写缓存 / 输出 / 调用次数 / 缓存命中率）属于 t2 的范围：

- 当前 `UsageCell.tokens` 只有 `total/input/output`，没有 cache 命中/写入与调用次数字段；
- 建议 t2 在 `TokenTotals` 扩展字段并同时更新 `src/host/team/usage.ts#tokenTotalsOf`（解析宿主 `cacheReadTokens`/`cacheWriteTokens` 等实际字段名），再在 `src/client/viewmodel.ts#tokenTitleOf` 与 RunHeader/RoleCard/TaskTable 的详情行展示；**不要**在总数缺失时用六项里的一部分拼出数字，保持「不低估、不伪造」。

已知取舍：`runUsage` 为 provider 时以宿主 run 合计为准，即使它与任务级聚合不一致（宿主是权威口径，客户端不重算）。
