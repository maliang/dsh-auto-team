# r45 自动回执全链路 QA 报告

- 任务：t3 回归、变异与门禁——成员 idle 未交回执时由宿主代跑验收（autoReceipt）
- 版本：`dsh-auto-team@0.2.7`
- 日期：2026-11-17
- 结论：**通过**。门禁三项全绿（1331/1331）；新增 8 例 + 改写 r41 首例并保留关闭分支；3 条定向变异全部按预期变红并逐字节还原；另记录 1 条存活变异（接线缺口，见 §7）；双 import 与产物校验通过。

---

## 1. 动机：r44 t6 的空窗（为什么要有 r45）

r44 的 t6（面板接口准入回归）在跑完全部 1322 例验收后，成员直接停手、没有提交回执，任务停留在 running「待回执」状态近 68 分钟，最后由队长手动代跑门禁才收口。时间线取自 `~/.dsh/auto-team/runs/run-mwk55qf1-zoe.json` 的 messages 与 `.auto-team/artifacts/t6.log`：

| 时间 | 事件 |
|---|---|
| 12:28:48 | t6 派发给成员 `qa-t6-a8kbin`，验收命令 `pnpm typecheck && pnpm test && pnpm build` |
| 12:34:24 | 成员停手（idle），队长账本落一条「成员「qa-t6-a8kbin」已结束本轮但未提交回执，任务 t6 仍为执行中…」 |
| 12:34:24 → 13:42:12 | **空窗 67 分 48 秒**：任务仍在 running、无 evidence、无 autoReceipt（该版本尚无此能力） |
| 13:42:12 | 队长手动提交回执，宿主机跑同一命令：`ℹ tests 1322` / `ℹ pass 1322` / `fail 0`，exit 0，t6 收口 |

`.auto-team/artifacts/t6.log`（13:42 落盘，138555 B）第 1336/1338 行即 `ℹ tests 1322` / `ℹ pass 1322`，证明任务本身早已全绿，损耗完全来自「停手后无人代跑」这一段。r45 把这条路径做成默认：成员 idle 且任务 running 无证据 → 宿主自动走既有 receipt 通路代跑；只有显式 `autoReceipt=false` 才回落到 r41 的「待回执」静默收尾。

---

## 2. 交付物

| 文件 | 类型 | 说明 |
|---|---|---|
| `test/r45-auto-receipt.test.ts` | 新增（8 例） | 纯函数全组合 + 真 `apply()` 全链路 |
| `test/r41-idle-silent-finish.test.ts` | 修改 | 首例改为「默认宿主代跑并 done + autoReceipt」；新增 1b「autoReceipt=false → 仍写 silentFinish」；其余 5 例未动 |

测试形态：真 `apply(ctx, …)` + 假宿主 ctx（tools / webServer / agents / agentTeams / effects）+ 临时 `$HOME` 下真 `RunsStore`，通过伪造 `POST /api/auto-team/act` 路由调用真实 bridge，通过成员 `agent.ctx` 投递 `agent/status: idle` 触发 `recordMemberIdle`。门禁执行次数用临时目录里的计数文件统计（acceptance 为 `node -e "require('fs').appendFileSync('<counter>','x');process.exit(N)"`），不是断言日志文本。

---

## 3. AC → 可执行判定 → 证据

| # | 验收点 | 用例 | 判据（改回错误实现会变红） | 结果 |
|---|---|---|---|---|
| ① | `shouldAutoReceipt` 全组合 | r45 第 1 例 | 缺任一条件（enabled=false / 有证据 / 任务暂停 / 团队暂停 / in-flight / 非 running）都必须 false；全满足才 true。M1 去掉 paused 判定即红 | pass |
| ②a | idle + running 无证据 → 真跑门禁，exit 0 | r45 第 2 例 | 计数文件 ===1；任务 done；`autoReceipt.exitCode===0`；`evidence.exitCode===0`；`silentFinish===undefined`；账本恰一条带 taskId 的「宿主代跑验收：exit 0 → 已通过」 | pass |
| ②b | 门禁 exit 3 → 返工 | r45 第 3 例 | status `rework`；attempts 1；`evidence.exitCode===3`；不写 silentFinish；消息含「exit 3 → 转返工」 | pass |
| ③ | 成员先自己交回执，再 idle | r45 第 4 例 | 回执本身跑 1 次门禁；随后 idle 500ms 内计数仍 1；不写 autoReceipt、无宿主代跑消息 | pass |
| ④ | `autoReceipt=false` 回落 r41 | r45 第 5 例 + r41 1b | silentFinish 落盘（memberId 正确）；status 仍 running；计数 0；无 autoReceipt/evidence；恰一条「已结束本轮但未提交回执」 | pass |
| ⑤ | 同一任务连续两次 idle，只跑一次 | r45 第 6 例 | 慢门禁 300ms + 状态回拨制造窗口；两次 idle 后计数 ===1、autoReceipt 只写一次；M2 去掉 in-flight 去重 → actual 2 / expected 1 红 | pass |
| ⑥ | 返工上限后不无限重跑 | r45 第 7 例 | `maxAttempts=1` + exit 3 → 一次代跑后 status failed、attempts 1、计数 1；再 idle 500ms 计数仍 1 | pass |
| ⑦ | act 失败（空 acceptance → GATE_FAILED）回落 | r45 第 8 例 | 任务回 running 无 evidence；silentFinish 落盘；无 autoReceipt；恰一条待回执消息。M3 删回落块 → 8s 超时红 | pass |
| r41 | 默认行为切换 + 保留关闭分支 | r41 首例与 1b | 默认：done + autoReceipt + 无 silentFinish；关闭：silentFinish + 仍 running + 无宿主代跑消息。整文件 7/7 | pass |

补充纯函数断言：`autoReceiptNoteOf` 三种文案（exit 0 / exit N / rejected 带 code+message）、`withAutoReceipt` 不修改入参、不触碰 evidence。

---

## 4. 门禁结果（一次全量，命令原样执行）

```bash
pnpm typecheck && pnpm test && pnpm build
```

| 项 | 退出码 | 证据 |
|---|---|---|
| typecheck | 0 | `tsc --noEmit` 无输出 |
| test | 0 | `ℹ tests 1331` / `ℹ pass 1331` / `ℹ fail 0`（1322 基线 + 8 条 r45 + 1 条 r41 新增） |
| build | 0 | `lib/index.js 675.62 kB │ gzip: 222.73 kB`；`✔ Build complete in 50ms` |

定向复跑（还原后）：`node --test test/r45-auto-receipt.test.ts test/r41-idle-silent-finish.test.ts` → `tests 15 / pass 15 / fail 0`，退出码 0。

---

## 5. 产物与双 import

```text
IMPORT_HOST_EXIT=0        node --input-type=module -e "await import('./lib/index.js')"
IMPORT_CLIENT_EXIT=0      node --input-type=module -e "await import('./lib/client.js')"
```

| 产物 | 字节 | sha256 |
|---|---|---|
| `lib/index.js` | 675623 | `c8b25980d7b0d1e51442c0945144f38a937d9df5f4c6d9339a7b65b93ad10b9b` |
| `lib/client.js` | 622187 | `a468f9c21f38fa73798cc6ead117eb6c6034c22d3a554e1abe446f23f5e6983a` |

`git status --porcelain` 显示 `lib/client.js`、`lib/index.js` 已随本次 build 重建，测试文件与 t1/t2 源码改动均在预期写域内。

---

## 6. 变异自检（3 条定向 + 1 条存活）

备份与基线：`/tmp/r45-mut/`，`shasum -a 256 -c /tmp/r45-mut/baseline.sha256` 每次还原后均 `OK`。

- `src/host/team/auto-receipt.ts` 基线 `5ef4c01e0089d123717e2fb52c3b0c52c168eba838b0a9068816c00b37efda77`
- `src/host/index.ts` 基线 `8f812eb64eff20c214fd887f5bcccd9082b2cdfd0e680cf4b0f2e4af8f6ceafe`

| ID | 变异 | 变异后 sha256 | 结果 |
|---|---|---|---|
| M1 | `auto-receipt.ts` 删 `if (facts.paused) return false` | `fb27c08d…a9eb4` | r45 第 1 例红，EXIT=1，其余绿 |
| M2 | `index.ts:463` `inflight: autoReceiptInflight.has(key) \|\| autoReceiptRan.has(key)` → `inflight: false` | `f477a8e2…a90bb` | r45 第 6 例红：`actual: 2, expected: 1`；EXIT=1 |
| M3 | `index.ts:406-414` 失败回落 silentFinish 整块删除（替换为注释） | `38716d5b…35179e` | r45 第 8 例红：`Error: 等待超时：回落 silentFinish`（耗时 8016ms，状态 running/无证据/无消息），EXIT=1 |
| M4 | `index.ts:460` `paused: …` → `paused: false`（存活变异，非门禁项） | `9d9af4b2…2f1fa` | r45+r41 15/15 全绿 → 覆盖缺口，见 §7 |

M3 第一次误删 10 行（连带 `} catch (error) {`）导致语法错误，已还原后按正确 9 行重做，表中结果为重做后的证据。

---

## 7. 缺陷与风险（按「症状 / 根因 / 复验命令」）

### D1（低，覆盖缺口）任务级暂停的接线改动无法被现有用例区分

- 症状：把 `src/host/index.ts:460` 的 `paused: state.taskPauses?.[task.id] !== undefined || task.status === 'paused'` 改成 `paused: false`，r45+r41 仍 15/15 全绿（M4）。
- 根因：任务暂停时 `bridge.act({type:'receipt'})` 在 preflight 直接 `BAD_REQUEST`，`runAutoReceipt` 走失败回落写 silentFinish；这与「正确判定 paused 后不进入代跑、直接写 silentFinish」的外部终态完全一致（同一任务同一时刻、同一条待回执消息），用例观测不到差异。
- 风险边界：宿主 receipt 通路的暂停检查是第二道闸，当前不会真的对暂停任务跑门禁命令（计数仍为 0），因此不是功能漏洞，而是**测试判据缺口**——若未来 bridge 对暂停任务改为放行，这类接线错误会变成误跑门禁。
- 建议修改：在 `recordMemberIdle` 的单测里注入 fake `shouldAutoReceipt`（或用 `mock` 捕获其入参）断言 `paused` 参数按 `taskPauses`/`status==='paused'` 透传；或导出 `autoReceiptFactsOf(state, task, binding, …)` 纯函数直接断言。
- 复验命令：应用 M4 变异后 `node --test test/r45-auto-receipt.test.ts test/r41-idle-silent-finish.test.ts`（当前全绿），补用例后应变红。

### D2（低，已知设计界限）进程重启后内存去重集合清空

- 症状：`autoReceiptInflight` / `autoReceiptRan` 是 `apply()` 内存中的 `Set`（`src/host/index.ts:336-342`）。宿主重启后集合为空，同一成员若再次 idle、任务仍 running 且无证据，会再代跑一次门禁。
- 根因：幂等键只存在于进程内存，未落盘；这不是重试循环（`maxAttempts` 仍封顶，且每次代跑都走真实 receipt），最多多跑一次命令。
- 复验命令：`grep -n "autoReceiptInflight\|autoReceiptRan" src/host/index.ts`（确认无持久化）；重启场景需真机，未验证。

### D3（信息，非缺陷）rework 后不会二次自动代跑

`applyReceipt` 在 rework 时保留 evidence 且 status 变为 `rework`，`isSilentFinish` 要求 `status==='running' && evidence===undefined`，因此同一成员再次 idle 不会触发第二次代跑——这是预期行为（返工交给成员处理），不是缺陷，但意味着「exit 3 后无人跟进」仍需队长/成员介入，r45 不改变这一点。

---

## 8. 未验证项（全绿≠真机通过）

1. **真机 idle 时序**：本报告全部基于假宿主 ctx 直投 `agent/status idle` 事件；未在克隆 profile 的真宿主里验证成员真实 idle → 插件 `recordMemberIdle` 的订阅时序、以及代跑门禁期间面板的「执行中/门禁中」状态切换。需真机：起第二宿主（端口 51890）跑一次自动团队任务，观察成员停手后 autoReceipt 是否在真实事件链上触发。
2. **跨 run 并发**：`recordMemberIdle` 遍历 `store.list()`（全部 run），幂等键含 `runId`，代码审查安全；但未构造「两个 run 同一时刻各有成员 idle」的并发用例，未验证 `store.save` 跨 run 写入交错。
3. **跨进程重启**：见 D2，重启后去重集合清空的行为未实测。
4. **客户端呈现**：t2 的「设置页开关 + 证据上标『宿主代跑验收 · exit N』」只有 `pnpm typecheck` 证据，未在真机面板点击/目视确认；旧快照缺字段不显示的行也未目视。
5. **空 acceptance 的 UX**：仅验证了 GATE_FAILED 回落 silentFinish 的技术路径（r45 第 8 例），未评估队长收到「待回执」时能否从文案判断是「没写验收命令」而非「门禁失败」。

---

## 9. 复跑指引

```bash
cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
pnpm typecheck && pnpm test && pnpm build          # 全量门禁（1331 例）
node --test test/r45-auto-receipt.test.ts test/r41-idle-silent-finish.test.ts   # 定向 15 例
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
```

注意：临时 HOME 由用例自建自清理，不要从 `logs/teamflow/` 归档目录直接跑（相对根会解析错，假红）。
