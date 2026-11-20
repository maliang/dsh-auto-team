# r61 契约统一 —— QA 报告（t3 回归）

- 任务夹：`docs/teamflow/2026-11-20-r61-contract-unify/`
- 日期：2026-11-20（本地 2026-11-21 00:0x）
- 角色：QA 测试工程师
- 结论：**pass**。三处契约（停滞阈值端口 / `RunSummary.duration` 同源与缺席 / 客户端消费宿主值）均有实测判定力，全量门禁 exit 0。
- 前置：t1（library 设置端口 + `RunSummary.duration`）、t2（client 消费宿主值）、t4（历史行 duration 缺席守卫）门禁均已通过。

## 1. 交付物

| 文件 | 说明 |
|---|---|
| `test/r61-contract-unify.test.ts` | 新建，7 例：设置端口生效/回落、历史行 duration 同源与缺席、客户端透传/回落 |
| `test/store.test.ts:1004-1006` | 把误名为「r60 D3 边界：外部写盘发生在动作 load 之后…」的用例改名为「**r60 D4 早窗口**：…」，只改测试名与上方两行注释，断言零改动 |
| 本报告 | 证据、变异实跑、未验证项 |

> 任务卡写的是「`test/r60-cas-hardening.test.ts` 里名为『r60 D3 边界』的用例」。实测该文件只有 5 条 `r60 ①…⑤`，**没有**该名字；实际错名用例在 `test/store.test.ts:1004`（r60 QA 报告 §7.5 也点名「B5 测试名当前是 D3、实际覆盖 D4 早窗口」）。改名落在真实位置，未动断言。

## 2. 门禁（实跑）

```bash
pnpm typecheck && pnpm test && pnpm build
```

- 退出码：**0**
- 全量测试：`ℹ tests 1487 / pass 1487 / fail 0`
- 构建：`lib/client.js`（build:client）与 `lib/index.js` 724.54 kB（build:host，50ms）均完成
- 定向：`node --test test/r61-contract-unify.test.ts` → 7/7 pass；`node --test test/r61-history-duration-absent.test.ts` → 4/4 pass

## 3. AC → 可执行判定

| AC | 判定（测试名） | 断言要点与判别力 |
|---|---|---|
| ① 设置端口生效 | 「① 设置端口生效：stallMs=1000 + 静默 2 秒 → quiet；缺省 90000 下同数据不判停」 | `deps.settings=()=>({stallMs:1000})`、进度停在 2 秒前且任务 running → `stalled=true`、`stallReason='quiet'`、`stalledForMs=2000`，并与 `stallOf(8000,10000,1000)` 逐字相等；同一份数据不注入端口 → `stalled=false / 'none' / 0`。**同一数据两种阈值给出不同判定**，证明阈值真来自端口。 |
| ① 端口回落 | 「① 设置端口回落：settings 返回 undefined / 缺字段 / 非正数 / 抛错 → 缺省 90 秒且不抛」 | 6 种坏端口（`undefined`、`{}`、`0`、`-5`、`NaN`、抛错）都 `doesNotThrow`，且判定与缺省 90 秒一致（2 秒静默不判停）。判别力来源：若回落成 0，`stallOf(…,0)` 恒判 `quiet`，六条同时红；用例内直接断言 `stallOf(8000,10000,0).stalled===true` 作为反证。`config.STALL_MS===90000` 固定缺省来源。 |
| ② duration 同源 | 「② 历史行 duration：done/running 的 text 与 runDurationOf 逐字相等，终态无结束 → 字段缺席」 | 真 `RunsStore` + 真 `createBridge`；三条 run：`1_000→6_000` 终态 → `deepEqual(row.duration, runDurationOf(state, now))` 且 `text='5 秒'`；`plannedAt=NOW-90_000` 进行中 → `running` / `'1 分 30 秒'`；`cancelled` 且 `finishedAtOf` 无回退（`taskTimes:{}`、`messages:[]`）→ `'duration' in row === false`，并对照断言 `runDurationOf(…).state==='unavailable'`（证明缺席是守卫的结果）。 |
| ③ 客户端透传 | 「③ 宿主给了 duration 时逐字透传：不再按 plannedAt/finishedAt 二次派生」 | 伪造 summary：`plannedAt=1_000 / finishedAt=6_000` 支持「5 秒」，但宿主给 `text='1 小时 2 分'` → 行必须显示宿主值；显式 `notEqual '5 秒'`（出现即二次派生）。 |
| ③ 不改写不可得 | 「③ 终态缺结束时刻但宿主给了值：客户端不得改写为「不可得」」 | `cancelled` + 无 `finishedAt` + 宿主 `duration` 有值 → 行显示宿主值；派生路径会把这条算成 `unavailable`，因此该断言只在「宿主优先」时绿。 |
| ③ reason 透传 | 「③ 宿主给的不可得原因逐字进 title」 | `duration.reason='宿主：该 run 没有开始时刻（旧数据）'` → `durationTitle` 正则命中该串。 |
| ③ 缺席回落不崩 | 「③ duration 缺席：回落旧派生且不崩」 | 无 `duration`：`plannedAt+finishedAt` → `done/'5 秒'`；`cancelled` 无结束 → `unavailable` 且 title 非空。 |

## 4. 变异实跑（证明判定力；逐字节还原）

每条变异：备份源文件 → 改源码 → 只跑 `node --test test/r61-contract-unify.test.ts` → `cp` 还原 → 比对还原前后 sha256。

| # | 变异 | 结果 | 还原校验 |
|---|---|---|---|
| M1 | `src/host/library.ts` 的 `stallMsOf` 改回 `return defaultSettings().stallMs`（删掉设置端口） | `pass 6 / fail 1`：唯一的红是「① 设置端口生效」。回落用例仍绿属预期——它验证的是**缺省路径**，与删端口等价 | sha256 `af7b2f72…39d2d01` 前后一致 |
| M2 | `src/client/tabs/rows.ts` 改成 `const duration = historyDurationOf(run, now)`（客户端优先自己算） | `pass 4 / fail 3`：③ 的「宿主值优先」「不得改写不可得」「reason 透传」全红 | sha256 `6b47c7e5…8b44f012` 前后一致 |
| M3 | `src/host/bridge.ts` 的 duration 守卫改回 `typeof plannedAt === 'number'` + 无条件赋值 | `pass 6 / fail 1`：② 的缺席用例红（终态无结束被写成「不可得」占位） | sha256 `e1ad5583…c79ae694` 前后一致 |

## 5. 缺陷记录：t4 修掉的契约偏差

- **症状**：历史行（`snapshot.runs`）在「run 已终态、`plannedAt` 有值、但 `finishedAtOf` 无回退值」时，`duration` 字段被写成 `{state:'unavailable', text:'不可得'}`。客户端按契约会对缺失字段走既有降级文案，宿主写占位等于把「为什么不可得」这件事的表述权从客户端抢走，且与 `RunSummary.duration` 的 JSDoc（缺任一时刻 → 缺席）直接冲突。
- **根因**：`src/host/bridge.ts:1868` 的守卫只判 `typeof state.plannedAt === 'number'`，拿到 `runDurationOf` 的返回值就无条件赋值；而该函数在「终态 + 无结束时刻」时按设计返回 `unavailable` 占位（快照口径需要它），历史口径不应照抄。
- **修复**（t4）：`src/host/bridge.ts:1868-1875` 改为 `Number.isFinite(state.plannedAt)` 且 `cell.state !== 'unavailable'` 才赋值；`test/r61-history-duration-absent.test.ts` 4 例覆盖。
- **复验命令**：`node --test test/r61-contract-unify.test.ts test/r61-history-duration-absent.test.ts`（本报告 §2 全绿；M3 变异下 ② 必红）。

## 6. 未验证项（全绿不等于全覆盖）

1. **真机（第二宿主）未跑**：本报告只覆盖 store/bridge/library/rows 的真实对象链路，未在第二宿主上验证 `settings.json → settingsRepo.read() → LibraryDeps.settings` 的装配时序；`src/host/index.ts:780` 的接线只有类型与单测层面的证据。
2. **客户端只测纯函数**：`runSummaryRowOf` / `durationTitle` 直测，未渲染 DOM，也未验证历史页在真实载荷下的 tooltip 呈现。
3. **「每次详情装配只读一次设置」未单测**：`stallMsOf` 在 `buildLibrary` 内调用一次、结果传给所有成员是代码审查结论（`src/host/library.ts:196`），未用「第二次调用计数」类探针锁定。
4. **越界值未测**：`stallMs` 超过 `SETTINGS_LIMITS`（1_000–600_000）时，`settings` 仓储层会拒绝写入；直接注入超界值的 `LibraryDeps.settings` 行为（当前仅要求 >0 且有限）未定义，属宿主侧配置校验职责，未在本层加断言。
5. **`duration.reason` 在历史行**：`bridge.historyOf` 只会写可用单元格（`done`/`running`），故「历史行带 reason」目前不可达；该分支只由客户端伪造 summary 覆盖。
6. **r60 改名**：只改测试名与注释；未把该用例挪出 D3 小节（分类小瑕疵，不影响执行）。
