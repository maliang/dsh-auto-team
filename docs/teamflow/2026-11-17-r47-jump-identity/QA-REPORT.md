# r47 · t2 QA 报告：跳转身份的四种真实形态回归

- 任务：t2 回归 —— 同角色多任务 / 成员复用 / 成员已退役 / 任务无成员，逐个断言「不串」并给出人话原因。
- 前置：t1（ROOT-CAUSE.md）、t3（宿主 `taskIds` 投影）、t4（`memberForRole` 只认名下任务）、t5（角色卡多人歧义）均过门禁。
- **判定：通过**。全量门禁 `pnpm typecheck && pnpm test` 退出码 0（1351/1351）；新增回归 6 例、变异探针 5/5。
- 交付物：
  - `test/r47-jump-identity-shapes.test.ts`（6 例，含四形态与总回归）
  - `test/r47-jump-identity-probes.mjs`（5 条变异探针，证明断言改回错误实现会红）
  - 本报告（t2 只写测试与报告，未改产品代码）
- 证据来源：断言从**宿主真实投影** `membersOf()` 出发，再交给**客户端唯一判定** `memberJumpOf()`，不手搓成员行绕过投影。

## 1. 四形态 × 断言矩阵

| 形态 | 真实形状（宿主快照构造） | 断言（`test/r47-jump-identity-shapes.test.ts`） | 不串的机械判据 | 人话原因 |
|---|---|---|---|---|
| ① 同角色多任务 | `dev` 名下两个成员：`m1→t1(done)`、`m2→t2(running)`，`m2` 更晚创建 | `:108` 逐任务断言 `t1→m1`、`t2→m2`；角色卡 2 成员时不可跳 | 落点 `member.taskIds` 必须包含该 `taskId`；旧的「running/最近活跃」回退会把 `t1` 拉到 `m2` | `该角色有 2 个子智能体，请从任务行进入`（`roleCardMultiMemberReasonOf`），并要求 `title/label` 都带这句 |
| ② 成员复用 | 同一 `memberId=m1` 挂两条 binding：`t1` 已 `retired`（无 `stoppedAt`，保留审计）、`t2` 在跑 → 面板只一行 | `:145` 断言快照 `taskId='t2'`、`taskIds=['t1','t2']`；`t1` 与 `t2` 都跳 `m1`；该角色仅 1 成员时角色卡可跳 | 旧任务不在单值 `taskId` 上，只能靠 `taskIds` 命中；只认单值即「跳不动」 | 可跳时不编原因；规则出处 `src/client/viewmodel.ts:3297-3301`（`memberOwnsTask` 认全集） |
| ③ 成员已退役（完全回收） | (a) 真实盘面：`retired` 无 `stoppedAt` 且 `task.memberId` 仍在 → legacy 兜底行；(b) 合成退役变体（ROOT-CAUSE §Q4 的 SYNTH_RETIRE）：再清 `task.memberId` | `:179` (a) `t1→m1`，且明确 `!== m2`；(b) 快照只剩 `m2`，`t1` 不可跳 | (a) 旧任务仍可回到**原 memberId**（会话 id 没丢）；(b) 两个身份源都没了 → 不可跳，绝不回退同角色别人 | `该任务还没有可跳转的成员：可能尚未派发，或成员已回收`（含「成员已回收」字样，禁止只说「没有成员」） |
| ③ 成员已退役（确认停止） | `retired + stoppedAt` 的 binding：宿主保留一行 `status='stopped'` | `:233` 断言 `members.length=1`、`status='stopped'`、`taskIds=['t1']`，`t1` 可跳 | 已停止 ≠ 已消失：会话仍可查看，跳转落点仍是本人 | 无新增原因；失败由宿主 `openSession` 抛错走既有 `rejected` 文案 |
| ④ 任务无成员 | `t3(pending, 无 binding)`，同角色 `m2` 正在跑 `t2` | `:253` 断言不可跳、无 `memberId`、`actionText='子智能体 · 未派发'`；`node` 带 `roleId` 也不回退；`node` 无 `roleId` 给另一句原因 | 旧实现会回退到 `m2`，点开即别人的会话 | `该任务还没有可跳转的成员：可能尚未派发，或成员已回收`；无角色节点为 `该节点没有记录角色，无法定位成员` |
| 总回归 | 一张快照同时含 ①②③b④ | `:293` 逐任务断言落点归属、逐角色断言歧义不跳（`dev` 3 成员 → `该角色有 3 个子智能体，请从任务行进入`） | 机械不变量：`available ⇒ member.taskIds ∋ taskId`；`!available ⇒ memberId===undefined 且 reason 非空` | 角色卡原因数字必须与成员数一致 |

## 2. 变异探针（断言是否真拦得住回退）

命令：`node test/r47-jump-identity-probes.mjs`（副本自动建在系统临时目录，不在归档路径跑，不会假红）
结果：**exit 0，5/5 通过**；基线 6/6 用例执行，239ms。

| 探针 | 把实现改回错误版本（补丁） | 变异后 | 变红的用例 |
|---|---|---|---|
| P1 | `viewmodel.ts` 恢复旧回退：`owners.length > 0 ? latestMemberOf(owners) : latestMemberOf(list)` | exit 1 | ③ 成员已退役（完全回收） |
| P2 | `memberOwnsTask` 只认单值：`return member.taskId === taskId` | exit 1 | ② 成员复用 |
| P3 | `bridge.ts:1309` 改为 `taskIds: [binding.taskId]`（不收集全集） | exit 1 | ② 成员复用 |
| P4 | 删掉 `bridge.ts:1323` legacy 兜底（`task.memberId` 第二身份源） | exit 1 | ③ 成员已退役（完全回收） |
| P5 | `roleCardJumpOf` 取消多成员歧义（`count <= 1` → `count >= 0`） | exit 1 | ① 同角色多任务 |

每条探针都要求：原样副本必须绿且 6 条用例真的执行过；补丁锚点恰好命中 1 次（漂移即报错，不误判）；变异后必须 exit≠0 且失败输出命中预期用例标题。

## 3. 门禁证据

| 命令 | 退出码 | 输出尾部 |
|---|---|---|
| `pnpm typecheck` | 0 | `> tsc --noEmit`（无输出） |
| `pnpm test` | 0 | `ℹ tests 1351` / `ℹ pass 1351` / `ℹ fail 0` |
| `node --test test/r47-jump-identity-shapes.test.ts` | 0 | 6/6 通过 |
| `node test/r47-jump-identity-probes.mjs` | 0 | `全部 5/5 条变异探针通过` |

用例数对账：t4/t5 前置新增 2 例（`test/r33-jump-to-member.test.ts`、`test/member-page.test.ts`）+ 本任务 6 例 = 1351（原 1343 + 8）。

## 4. 建议修改 / 可接受

| 建议修改（不阻塞本次验收） | 可接受（附依据） |
|---|---|
| **S1（展示失真）**：`src/host/bridge.ts:1322-1333` 的 legacy 兜底行用 `roleById.get(task.roleId)?.name` 充当成员名、`status` 取任务状态。身份（`memberId/taskIds`）正确，但「已退役」形态跳过去看到的是角色名「开发」而不是「开发-1」。建议 legacy 行优先取该 `memberId` 最近一条 binding 的 `name`/停止事实位。 | **A1**：已退役（完全回收）且无第二身份源时**不可跳**是正确取舍——打开已死会话比不跳更糟，且原因说清「已回收」。 |
| **S2（可见性依赖第二身份源）**：形态 ③b 之所以 LOST，是成员行被 `retired && stoppedAt===undefined` 过滤后，只剩 `task.memberId` 兜底；一旦清掉就无行。t3 已在 binding 层备好 `taskIds`（`bridge.ts:1282-1290`），但投影层不渲染该行时数据用不上。建议后续让「历史任务→成员」解析直接落在 binding 上（或为已退役成员渲染只读历史行），减少对 `task.memberId` 的依赖。当前行为是「不可跳 + 人话原因」，不是串台，故不阻塞。 | **A2**：角色卡名下多成员一律不跳，把人导到任务行（t5 规则，`viewmodel.ts:3399-3417`）——开错会话比不跳更糟。 |
| — | **A3**：legacy 兜底行的 name/status 失真目前不影响身份判定（`memberId` 与 binding 同源，跳转落点正确），可留作后续打磨。 |
| — | **A4**：真实三份 run 里 `retired` 多为 `undefined`（ROOT-CAUSE §Q4），形态 ③ 的 (b) 证据来自合成退役变体；真实触发路径是 resume 时成员已死（`src/host/team/dispatch.ts:769`、`:1038` 置 `retired`，且不清 `task.memberId`，所以 (a) 才是真实盘面主形态）。 |

## 5. 未验证项（全绿也不代替真机）

1. **真机点击未验证**：`TaskTable` 角色标记、角色卡、流程节点在浏览器里的实际点击/Enter/Space、`stopPropagation` 是否吞掉展开、`openSession` 是否真的切到成员会话——本任务只验证「宿主投影 + 唯一判定」两层，组件源码钩子由 t5/r33 ③ 守。按 AGENTS.md，真机验证只允许主 agent 按 `REAL-HOST-VERIFY.md` 跑。
2. **真实宿主 spawn 出的快照未复跑**：四形态用合成 `RunState` 覆盖（形状取自 t1 的真实 run 与 ROOT-CAUSE 的 SYNTH_RETIRE），未在第二宿主里实跑一次完整派发→复用→退役链路。
3. **多 run / 多会话并存时的身份隔离**未在本任务覆盖（`memberForRole` 只看当前快照成员列表，跨 run 由 t1 真实 run 证据与既有用例守）。
4. **浏览器端视觉态**（不可跳时按钮是否为非可点样式、`aria-label` 朗读效果）未做截图/无障碍验证。

## 6. 复现

```bash
cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
node --test test/r47-jump-identity-shapes.test.ts   # 6/6
node test/r47-jump-identity-probes.mjs              # 5/5，exit 0
pnpm typecheck && pnpm test                         # exit 0，1351/1351
```

> 归档注意：探针脚本复制 `src/ test/ package.json` 到系统临时目录再跑，不依赖相对仓库根，因此即使本报告/脚本被归档也不会出现「从归档目录跑假红」。
