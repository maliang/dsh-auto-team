# QA 报告 — r58 角色卡「最后开启者」回归

- 任务：t2（前置 t1 已完成）
- 日期：2026-11-20
- 角色：QA 测试工程师
- 代码基线：工作区含 t1 对 `src/client/viewmodel.ts` 的未提交改动（`roleCardJumpOf` 三段语义）

## 1. 交付物

| 交付物 | 路径 | 说明 |
|---|---|---|
| 新增回归测试 | `test/r58-role-card-latest.test.ts` | 8 条用例，覆盖任务卡 ①–⑤ |
| 反向校验 | 隔离副本 `/tmp/r58-rev`（临时，已删除） | 把 `roleCardJumpOf` 变回「无运行多成员拒绝」后跑 r33/r50/r58 |
| 门禁 | `pnpm typecheck && pnpm test && pnpm build` | 见 §4 |

## 2. AC → 可执行判定

| AC | 判定用例（`test/r58-role-card-latest.test.ts`） | 断言要点 |
|---|---|---|
| ① 两个成员都 done（无运行中）→ available=true 且落点 spawnedAt 更大 | `r58 ① 无运行中、两个 done 成员：可跳，落点是 spawnedAt 更大的那个` | `available===true`；`memberId==='m-new'`（spawnedAt 5000 > 1000，且不被更晚的 lastEventAt 带走）；`reason===undefined`；actionText 不含「正在运行」 |
| ② spawnedAt 相等 → lastEventAt 再 memberId 字典序，乱序同结果 | `r58 ② spawnedAt 并列取 lastEventAt 更晚者，不受输入顺序影响`；`r58 ② 前两级都并列取 memberId 字典序最小，乱序输入同结果` | 同 spawnedAt 取 lastEventAt 更晚者；前两级并列取 `m-a`（字典序最小）；`[a,b]` 与 `[b,a]` 两种输入落点相同 |
| ③ 有运行中成员时仍优先运行中 | `r58 ③ 运行中成员优先于 spawnedAt 更新的 done 成员` | done 成员 spawnedAt=AT+9000 更新，落点仍是 running 的 `m-run`；文案含「正在运行」 |
| ④ 零成员 → false 且原因分闭 run 两态逐字 | `r58 ④ 该角色零成员…`；`r58 ④ closedRun 且零成员…`；`r58 ④ closedRun 但成员仍在名单里…` | 未派发：`MEMBER_JUMP_NO_MEMBER_ROLE_REASON` + `MEMBER_JUMP_NO_MEMBER_TEXT`；closedRun：`MEMBER_JUMP_CLOSED_RUN_REASON` + `MEMBER_JUMP_CLOSED_RUN_TEXT`，两者互不相等；closedRun 但成员仍在 → 仍可跳 |
| ⑤ 三入口一致性：任务行/流程图仍按 memberForRole 取 | `r58 ⑤ 任务行 / 流程图按 taskId 归属取成员，不采用角色卡的「最后开启」` | 角色卡取 `m-new`，但 task t1 两个入口都取归属的 `m-old`；t2 取 `m-new`；t9 无归属成员 → `available===false` + `MEMBER_JUMP_NO_MEMBER_REASON`，不回退到 `m-new` |

定向执行（新增文件）：

```
$ node --test test/r58-role-card-latest.test.ts
ℹ tests 8 / pass 8 / fail 0
```

## 3. 反向校验（变异测试）

**变异**：只把 `src/client/viewmodel.ts` 的 `roleCardJumpOf` 分支②改回旧语义（无运行多成员 → `available:false` + `roleCardMultiMemberReasonOf(N)`），其余代码不动。

**隔离方式**：复制 `src/`、`test/`、`package.json`、`tsconfig.json` 到 `/tmp/r58-rev` 并软链 `node_modules`，在副本内变异执行；共享工作区文件未被触碰。

```
# 基线（未变异，副本内）
node --test test/r58-role-card-latest.test.ts test/r50-role-running-jump.test.ts test/r33-jump-to-member.test.ts
ℹ tests 46 / pass 46 / fail 0

# 变异后（同一命令）
ℹ tests 46 / pass 37 / fail 9
EXIT=1
```

变红用例（证明 r33/r50 的改写不是恒真，且 r58 新增用例有判别力）：

- `t5 角色卡：没有运行中成员且名下不止一个 → 可跳，落点是同一三级键的「最后开启者」`（r33）
- `t2 角色卡：status=running 但已有 stoppedAt 不算运行中，文案不得冒充「正在运行」`（r33）
- `t3 ③ 无真运行成员时按非运行路径：停止事实位只否决「正在运行」文案，落点仍是最后开启者`（r50）
- `t3 ④ 无运行且多成员：可跳，落点是同一三级键的「最后开启者」，文案不带「正在运行」`（r50）
- `t3 ④ 无运行多成员同样按三级键：同 spawnedAt 取 lastEventAt 更晚，再并列取 memberId 字典序`（r50）
- `r58 ① 无运行中、两个 done 成员：可跳，落点是 spawnedAt 更大的那个`
- `r58 ② spawnedAt 并列取 lastEventAt 更晚者，不受输入顺序影响`
- `r58 ② 前两级都并列取 memberId 字典序最小，乱序输入同结果`
- `r58 ⑤ 任务行 / 流程图按 taskId 归属取成员，不采用角色卡的「最后开启」`（该用例同时断言角色卡落点，故随角色卡语义变红；任务行/流程图断言本身在变异下仍绿）

**恢复确认**：变异只发生在副本；工作区文件哈希核对 `sha256sum -c /tmp/r58-repo-before.sha` → `src/client/viewmodel.ts: OK`，副本已删除。

## 4. 门禁结果

命令：`pnpm typecheck && pnpm test && pnpm build`

```
> tsc --noEmit          # 无错误输出
ℹ tests 1443        # 全量（含 r58 新增 8 条、r33/r50 改写用例）
ℹ pass 1443
ℹ fail 0
✔ Build complete in 56ms   # lib/client.js 709.55 kB
GATE_EXIT=0
```

## 5. 缺陷

本轮未发现新缺陷。反向校验中无「断言不变红」的漏网用例。

## 6. 未验证项 / 风险

- 未做真机 UI 点击验证：本任务只验证纯投影层判定（`node --test`），角色卡在真实宿主中的点击落点与视觉文案未复验；如需真机结论应另开验证。
- 全量 `pnpm test` 跑在共享工作区，其它并发 run 的未提交改动可能影响与本次无关的用例；若全量出现非 r33/r47/r50/r58 文件的失败，按「与本次改动无关」标注并附文件清单。
- 变异副本依赖软链 `node_modules`，仅用于判别力验证，不是交付物。
