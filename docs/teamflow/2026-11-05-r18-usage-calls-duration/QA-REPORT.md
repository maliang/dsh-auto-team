# QA 报告：r20 调用次数 / run 终态用时 / 角色累计用时（t3）

- 任务：t3（QA 与门禁），前置 t1（宿主数据源）、t2（客户端渲染）均已过门禁
- 日期：2026-11-05
- 范围：仅 `test/**`、`lib/**`（构建产物）与本任务夹；未改动 `src/**`
- 结论：**门禁全绿，无阻塞缺陷**；4 条旧口径断言按新契约更新（非回归）；已知契约缺口 1 条 + 1 条历史口径说明（不影响验收，记录在 §5）
- 未验证项：真机重启 / 面板实际渲染 / 真实宿主 session 事件形状（见 §6）

## 1. 验收命令与结果

实际执行（工作区根，一条命令串联）：

```bash
pnpm typecheck && pnpm test && pnpm build
```

| 步骤 | 命令 | 退出码 | 证据尾部 |
|---|---|---|---|
| 类型检查 | `pnpm typecheck` | 0 | `> tsc --noEmit`，无输出 |
| 全量单测 | `pnpm test` | 0 | `ℹ tests 948` / `ℹ pass 948` / `ℹ fail 0` / `ℹ duration_ms 5235.151916` |
| 双产物构建 | `pnpm build` | 0 | `ℹ lib/client.js 516.97 kB │ gzip: 127.03 kB`；`ℹ lib/index.js 497.19 kB │ gzip: 168.03 kB`；两段均 `✔ Build complete` |
| 组合门禁 | 上述串行 | **0** | `GATE_EXIT=0`（`/tmp/r20-t3-gate.log`） |

产物与加载自检（均退出码 0）：

```text
ls -l lib/index.js lib/client.js
-rw-r--r-- 6 maliang staff 516969 Nov  5 23:24 lib/client.js
-rw-r--r-- 4 maliang staff 497191 Nov  5 23:24 lib/index.js
node --input-type=module -e "await import('./lib/index.js')"  → HOST_IMPORT_OK
node --input-type=module -e "await import('./lib/client.js')" → CLIENT_IMPORT_OK
grep -c "__ModuleLoader__" lib/client.js → 2
grep -c "readSessionCallCount" lib/index.js → 3
```

判定：`lib/` 两个产物在门禁当次重建（mtime 23:24，与构建日志一致），`__ModuleLoader__` 守卫仍在，宿主/客户端产物均可被 node 动态 import。

## 2. AC 判定表（逐条 ↔ 可执行断言）

| AC | 判定内容 | 测试（`node --test` 可直接跑） | 结果 |
|---|---|---|---|
| AC-1 | 调用次数按 `inheritedEventCount` 之后计数 | `test/adapters.test.ts:1071` `readSessionCallCount：从 inheritedEventCount 之后数…` | PASS |
| AC-2 | 可读 0 条 = 真实 0；旧宿主退回 log 切片；噪声事件不计数 | `test/adapters.test.ts:1091` | PASS |
| AC-3 | 不可读（未加载/日志非数组/读口抛错/返回非数组/空 id）→ undefined，绝不补 0 | `test/adapters.test.ts:1110` | PASS |
| AC-4 | calls 并入 TokenTotals，按成员/任务/run 归属，`save→load`（甚至新 store 实例）仍保留 | `test/usage-projection.test.ts:382` | PASS |
| AC-5 | calls = 0 落盘并显示 `0`（available=true，非「不可得」） | `test/usage-projection.test.ts:400` | PASS |
| AC-6 | calls 读口抛错/返回 undefined → 保留已落盘 calls，不覆盖成不可得 | `test/usage-projection.test.ts:412` | PASS |
| AC-7 | token 投影整体读不到时不得单独写 calls（否则抹掉已落盘 token） | `test/usage-projection.test.ts:431` | PASS |
| AC-8 | 最后一个任务收口 → `finishedAt` + `terminated`；重放不刷新 | `test/dispatch.test.ts:1358` | PASS |
| AC-9 | failed 也算收口（全部终态 → finishedAt + terminated） | `test/dispatch.test.ts:1378` | PASS |
| AC-10 | cancel 首次落 finishedAt + cancelled；重复取消幂等且保留首次结束时刻 | `test/bridge.test.ts:1660` | PASS |
| AC-11 | 落盘值优先于历史事实推出的更晚时刻 | `test/store.test.ts:573` | PASS |
| AC-12 | 历史终态缺落盘值：`max(max 任务 endedAt), 最后消息 at)` | `test/store.test.ts:583` | PASS |
| AC-13 | 都拿不到 / 进行中 → undefined，绝不拿 now 冒充 | `test/store.test.ts:605` | PASS |
| AC-14 | 角色用时 = 名下任务用时求和；进行中 cell 已含按 now 的推进 | `test/role-view.test.ts:161` | PASS |
| AC-15 | 全部未开始 → `not-started`「未开始」（不是 0 秒、不是不可得） | `test/role-view.test.ts:171` | PASS |
| AC-16 | 多个缺口只报首个 + 计数，缺口任务不当 0 计入合计 | `test/role-view.test.ts:176` | PASS |
| AC-17 | 宿主 `rolesOf` 与客户端 `roleUsageOf` 逐字相等（求和 / 缺口两形态） | `test/role-view.test.ts:184`、`:301` | PASS |
| AC-18 | 状态表驱动：已开始状态一律输出聚合格（text 由 `formatDuration` 重算、无 startAt/endAt）；未开始 → not-started | `test/role-view.test.ts:80`（13 种 TaskStatus 表驱动） | PASS |
| AC-19 | run 详情：进行中任务按 `at` 计入，角色累计 = 名下任务之和，两侧逐字相等 | `test/library-project.test.ts:235` | PASS |
| AC-20 | 历史行用时：客户端派生与宿主 `durationOfSummary` 同一夹具逐字一致（缺 plannedAt / 终态缺 finishedAt / done / running） | `test/library-project.test.ts:267` | PASS |
| AC-21 | `roleDurationTitleOf` 四态 + 旧快照都有解释，原因原样接在说明后 | `test/viewmodel.test.ts:1539` | PASS |

复跑单文件示例（任一即可复核）：

```bash
node --test test/adapters.test.ts
node --test test/usage-projection.test.ts test/store.test.ts test/dispatch.test.ts test/bridge.test.ts
node --test test/role-view.test.ts test/library-project.test.ts test/viewmodel.test.ts
```

## 3. 本轮测试改动清单

### 3.1 更新旧口径断言（4 处，均为新契约导致的预期变化，不是回归）

| 文件:行 | 旧断言 | 新断言（本项目现行契约） |
|---|---|---|
| `test/role-view.test.ts:78`（现表驱动） | 非当前任务一律裸「不可得」 | 已开始状态给 cell → 聚合格 `{state: done/running, ms, text: formatDuration(...)}`，无 startAt/endAt；未开始 → `{not-started,'未开始'}` |
| `test/role-view.test.ts:128`（现 `:142` 测试） | 无 cell → 裸「不可得」 | `不可得：任务 t1 没有用时数据`（保留首个缺口原因） |
| `test/library-project.test.ts:196`（现 `:184`） | `dev.duration` 等于当前任务用时 `61s` | 名下任务求和 `61s + 2s = 63s` → `1 分 03 秒`，state 取 running |
| `test/library-project.test.ts:223`（现 `:217`） | 全 done 角色 duration 不可得 | `不可得：任务 t1 缺少开始时刻（另有 1 个任务同样不可得）` |

### 3.2 新增测试（8 个文件，共 20 个用例）

- `test/adapters.test.ts`：`readSessionCallCount` ×3（归属计数、真实 0/旧宿主兜底、不可读 → undefined）
- `test/usage-projection.test.ts`：bridge calls 合并/落盘/回读 ×4（含 0 值、读口失败保留、token 缺失不单写）
- `test/store.test.ts`：`finishedAtOf` ×3（落盘优先、历史事实回退、不冒充 now）
- `test/dispatch.test.ts`：`applyReceipt` 收口 ×2（done 重放幂等、failed 也收口）
- `test/bridge.test.ts`：run cancel ×1（首次落盘 + 幂等保留首次值）
- `test/role-view.test.ts`：求和 / 全未开始 / 多缺口 / 两侧 parity ×4
- `test/library-project.test.ts`：run 详情两侧用时 ×1、历史行 parity ×1
- `test/viewmodel.test.ts`：`roleDurationTitleOf` ×1（多分支）

## 4. 断言有效性（反证检查）

按「改回错误实现，这条会不会变红」自查，关键断言均具备敏感性：

1. **calls**：删掉 `refreshUsage` 中的 `calls` 合并后，`snapshot.runUsage.tokens.calls` 为 undefined、details 显示「不可得」→ `:382/:400` 必红；把 `calls=0` 当成缺失跳过 → `:400` 必红；读口失败时写回 undefined/0 → `:412` 必红。
2. **finishedAt**：移除 `applyReceipt` 尾部的 `finishedAt/terminated` → `:1358/:1378` 必红；取消时用 `Date.now()` 覆盖而非 `??` → `:1660` 的哨兵保留断言必红；`finishedAtOf` 去掉「仅终态」或改用 `now` → `:605` 必红。
3. **角色累计用时**：若仍透传单任务 cell → `:161`（求和 100_000）与 `:184` parity 均必红；若把缺口任务当 0 计入 → `:176` 必红（期望 unavailable 而非偏小合计）。
4. **两侧逐字相等**：`roleStateOf` 的 duration 与 `roleUsageOf` 同源 shared，但测试对 `deepEqual` 与 `text` 双断言；若任一侧自行重算格式（如 `61s` 写成 `1m 1s`）→ 必红。
5. **历史行 parity**：客户端 `historyDurationOf` 与宿主 `durationOfSummary` 分别实现；若任一侧漏掉「终态缺 finishedAt」「缺 plannedAt」分支 → `:267` 的 4 个夹具中对应一条必红。

## 5. 已知契约缺口（本轮不扩宿主范围）

1. **`RunSummary` 没有 `duration` 字段**：历史 run 行的用时由客户端 `historyDurationOf` 用共享的 `formatDuration`/`durationCellOf` 自行派生，宿主不随行下发单元格。风险是两侧规则漂移；已用 `test/library-project.test.ts:267` 的同一夹具 parity 测试兜底（缺 plannedAt / terminated 缺 finishedAt / done / running 四形态逐字一致）。若要消除该缺口，需在后续版本给 `RunSummary`/projection 增加 duration 并由宿主单点计算。
2. 历史终态缺 `finishedAt` 时采用「max(任务 endedAt, 最后消息 at)」的可核实替代口径，属**推导值**而非原始事实；报告与 UI 已按「不可得/说明」分层，不复用为精确耗时依据。

## 6. 未验证项（明确不在 t3 证据内）

- **真机重启与面板实际渲染**：本轮只做单测 + 构建 + 产物 import；未重启宿主、未起第二宿主、未改 profile。面板上三项指标的实际显示需队长按 REAL-HOST-VERIFY 流程复验（已知 UI 层契约见 t2 交付）。
- **真实宿主 session 事件形状**：`readSessionCallCount` 的 `snapshotEvents/log + inheritedEventCount` 依据 adapters 既有契约，单测用手搓 ctx；生产宿主若返回不同形状，会走「不可读 → undefined → 保留已落盘值」的 fail-open 分支（不会伪造 0），但真实计数是否可用需真机确认。
- **跨版本旧数据**：只覆盖了 `finishedAt` 缺失、`plannedAt` 缺失、calls 历史已落盘等构造夹具，未对真实历史 run 目录做迁移验证。

## 7. 缺陷

无。门禁全绿；唯一需要跟踪的是 §5.1 的契约缺口（建议项，不阻塞验收）。
