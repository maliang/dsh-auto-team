# r48 QA 报告：面板外壳抗压缩与单一滚动容器

- 任务：t2（回归 t1 的修复）
- 日期：2026-11-17
- 结论：**PASS**（新增 5 条断言全绿；全量门禁 `pnpm typecheck && pnpm test && pnpm build` 退出码 0；两条变异均变红后字节还原）
- 新增用例：`test/r48-panel-no-shrink.test.ts`（264 行，sha256 `bd0939a5235162c8921cd5717976fb34e6eb6efce9f8c3451313e1095f4f71ea`）
- 被测样式：`src/client/styles.ts`（测后 sha256 `ccb3091449a3091227fbbfa52a7a22ca3aebd6cec46b41f28097bfeff608d1e6`，与变异前一致）

## 1. 判定方式

沿用 `test/r17-height.test.ts` 的解析式回归：剥掉注释后按 `selector { body }` 扫描规则，
对组件真实渲染的 DOM 钩子（`src/client/Panel.tsx:251/264/284/310/330/336`）断言关键声明。
所有断言都做过「改回错误实现会不会变红」的反向验证（见 §3 变异测试）。

## 2. AC 逐条判定

| AC | 断言内容 | 用例 | 结果 | 证据 |
|---|---|---|---|---|
| ① | `[data-tab-bar]` 含 `flex: 0 0 auto`（或 `flex-shrink: 0`），`height: 36px`、`box-sizing: border-box` 仍在；不得被 `height: auto` 覆盖 | `r48 ① 页签条：固定 36px 且 flex 不 grow / 不 shrink` | PASS | `styles.ts:2224-2236`；`node --test` 5/5 |
| ② | `[data-panel-body]` 为 `flex: 1 1 0` + `min-height: 0` + `overflow: auto`；不得回退 `flex: 1 1 auto` / `flex: auto`；head/meta/横幅/error 不得纵向滚动（单一滚动容器） | `r48 ② 滚动主体：flex: 1 1 0 + min-height: 0 + overflow: auto` | PASS | `styles.ts:338`；`Panel.tsx:335-336` |
| ③ | `[data-panel-head]`/`[data-panel-meta]`/`[data-panel-paused-banner]`/`[data-error]` 均为 `flex: 0 0 auto`（直系子元素组规则 + 各自规则双层校验），且不得 grow | `r48 ③ 固定高度外壳：head / meta / 暂停横幅 / error 一律 flex: 0 0 auto` | PASS | 组规则 `styles.ts:204-208`；各自 `:210/:236/:417/:447` |
| ④ | 反例守卫：面板作用域内任何 `[data-tab-bar]` 规则的 flex 简写不得 grow/shrink 非零；不得出现 `flex-shrink: 1` 或 `flex: 1 1 auto` | `r48 ④ 反例守卫：面板作用域内任何 [data-tab-bar] 规则都不得 grow / shrink` | PASS | 扫描 `[data-auto-team-panel] … [data-tab-bar]` 全部命中规则 |
| ⑤ | 左栏（library/panellist）与右栏（panel）共用同一条 `:is(...)` 规则（tab-bar / tab / 选中态）；不得出现 panel 单侧的 flex/height 分叉；DOM 钩子真实存在 | `r48 ⑤ 左右两侧共用同一条规则，不得分叉` | PASS | `styles.ts:2224/2240/2263`；`Panel.tsx:310` |

定向执行：`node --test test/r48-panel-no-shrink.test.ts` → `tests 5 / pass 5 / fail 0`，退出码 0。

## 3. 变异测试（必须变红后字节还原）

备份与还原均用文件级拷贝，还原后用 sha256 校验字节一致：

```bash
sha256sum src/client/styles.ts   # ccb3091449a3091227fbbfa52a7a22ca3aebd6cec46b41f28097bfeff608d1e6
cp src/client/styles.ts /tmp/r48-styles.backup.ts
# …施加变异 → node --test test/r48-panel-no-shrink.test.ts → cp 还原 → sha256sum -c
```

| # | 变异 | 预期 | 实际 | 还原 |
|---|---|---|---|---|
| A | `[data-panel-body]` 的 `flex: 1 1 0` 改回 `flex: 1 1 auto` | ② 变红 | ✖ `r48 ②`，`AssertionError: [data-auto-team-panel] [data-panel-body] 缺少声明「flex: 1 1 0」；实际为：flex: 1 1 auto; …`，`pass 4 / fail 1`，退出码 1 | `sha256sum -c` → `src/client/styles.ts: OK` |
| B | 删除 `[data-tab-bar]` 的 `flex: 0 0 auto;`（36px 保留） | ① 变红 | ✖ `r48 ①`，`AssertionError: [data-tab-bar] 必须声明 flex: 0 0 auto 或 flex-shrink: 0；…`，`pass 4 / fail 1`，退出码 1 | `sha256sum -c` → `src/client/styles.ts: OK` |

还原后复跑：`tests 5 / pass 5 / fail 0`，样式文件 sha256 与变异前完全相同。

## 4. 全量门禁

```bash
pnpm typecheck && pnpm test && pnpm build
```

| 命令 | 退出码 | 输出尾部 |
|---|---|---|
| `pnpm typecheck`（tsc --noEmit） | 0 | 无报错 |
| `pnpm test`（node --test test/*.test.ts） | 0 | `tests 1356 / suites 0 / pass 1356 / fail 0 / cancelled 0 / skipped 0` |
| `pnpm build`（client + host） | 0 | `lib/client.js 636.80 kB │ gzip: 158.92 kB`、`lib/index.js 693.52 kB │ gzip: 227.65 kB`，均 `✔ Build complete` |

整链一次执行 `GATE_EXIT=0`。用例数 1351 → 1356，正好是本次新增 5 条，未见既有用例回归。

## 5. 未验证项（全绿也要报）

1. **无计算样式验证**：本仓无浏览器，本用例只证明源码声明符合契约，未证明真机上页签条实际渲染高度为 36px、`[data-panel-body]` 是唯一纵向滚动容器。需真机 / DevTools 复核（本次未执行）。
2. **左栏共享规则只做了选择器级证明**：`grep` 显示当前只有 `Panel.tsx` 渲染 `[data-tab-bar]`，左栏 library/panellist 尚未渲染该钩子；⑤ 能证明「规则同时覆盖三侧且无 panel 单侧分叉」，不能证明左栏实际渲染时的视觉一致。
3. **未做压力场景**：320px 窄宽 + 长内容（数千 px）下的真实压缩行为未在浏览器里复现；本回归依赖「修复声明仍在」这一静态不变量。
4. **变异只覆盖 ① / ②**：③ 的组规则、④ 的守卫、⑤ 的分叉守卫未逐条施加变异（④/⑤ 本身是扫描式守卫，删除声明会先被 ①/③ 捕获）。

## 6. 过程异常（非本任务缺陷）

首次执行 `pnpm typecheck` 时（17:15 左右）命中 `src/host/adapters.ts` 的 `TS1127/TS2345` 报错，系并行任务正在编辑该文件（工作树半写状态）；待其落盘后复跑 `pnpm typecheck` 退出码 0，全量门禁随后全绿。该现象与 r48 样式回归无关，不计缺陷。
