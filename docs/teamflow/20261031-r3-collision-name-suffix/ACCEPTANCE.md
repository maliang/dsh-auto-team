# ACCEPTANCE · 成员名撞名改确定性序号消歧（20261031-r3）

- 任务夹：`docs/teamflow/20261031-r3-collision-name-suffix/`
- 基线依赖：`docs/teamflow/20261031-r2`；取代：`20261031-r2#AC-4`（撞名不再停派）
- 分支：`feat/auto-team-plugin`（原地迭代，工作树未提交，10 项改动）
- 验收人：产品经理（验收负责人）· 复验时间 2026-10-31 10:03~10:10（Asia/Shanghai）
- 复验方式：**不采信 QA-REPORT 的结论，独立重跑全部命令**（typecheck / 全量单测 / 5 个探针 / build + 双产物 import + pack / 48 边界实测 / 投影链路 grep）

## 1. 结论摘要

功能面全部达标：撞名不再停派，按 `-2`/`-3`…`-99` 确定性消歧并继续派发（`started` + `running` + `binding`），面板出一条「任务 + 原候选名 + 最终名」的 notice；重试/恢复沿用同一带序号名、不递增不翻倍；不抢他人本名；只有序号空间耗尽才回退 `MEMBER_NAME_COLLISION` 且以 `errors` 可观测、不留静默 pending。11 条 AC 逐条实跑通过，无 P0/P1/P2。

但本轮**不能转正式通过**：蓝图「重复风险」第 3 条点名的一处一致性约束未被满足（`listMembers` 抛错时，命名侧按「没人占名」、liveness 侧按「成员都还活着」，方向相反），且两处源码注释把这件事**写成了与实现相反的话**（注释声称「不假装宿主里没人」）。这是文档级、约 2 行的改动，但它守着一条刻意的取舍——下一个维护者读注释会以为代码是保守的，从而把实现改成「未知即预留」，那会直接破坏 AC-3 的名字恒定与恢复幂等。故判 **⚠️ 有条件通过：只修注释、不改行为，修完重跑 typecheck + test 即可转正式通过**（详见 §5 条件项 C-1）。

## 2. 逐条判定（AC-1 ~ AC-11，本夹 PRD 为唯一口径）

| AC | 判定 | 检测命令 | 实跑输出（本次复验截取） |
|---|---|---|---|
| AC-1 撞名即消歧派发 | PASS | `node logs/teamflow/tf-mvvok3wc-x0sezk/scripts/qa-collision-probe.mjs`；`t2-notice-e2e.mjs` | `PASS [C6]` 恒同名桩两个任务都派出、`errors=[]`；`PASS [C11] spawned=["dev-x-3","dev-x-2"]`；notice e2e `N5 终态：names=["dev-t1-x4gvxf","dev-t2-xeghme-2"] statuses=t1:running,t2:running` |
| AC-2 不越 48、哈希逐字保留 | PASS | 我自建边界实测（46 字 base 直接调 `withNameSuffix`） | `base 46` → `final ...-fh71pz-2` **48** `hashKept=true`；`n99 ...-fh71pz-99` **48** `hashKept=true`；对照朴素拼接会越界（QA C9 对照 `naive=…(50) limit=48`） |
| AC-3 确定性 / 重建不递增 / resume 不翻倍 | PASS | `qa-naming-fuzz.mjs`；`t1-dispatch-e2e.mjs` | `QA NAMING FUZZ RESULT: 1000/1000 passed`，跨进程 `DIGEST ce81be77` 相同；`t1` 终态 `E2 started=0 E3 rebuilt=dev-dup-2 E4 started=2` |
| AC-4 不抢他人本名 | PASS | collision `C11` + fuzz `P3` | `byTask={"a":"dev-x-3","b":"dev-x-2"}`（A 跳过 B 的本名 `dev-x-2`，取 `-3`），两两唯一；fuzz `steal=none starved=none` |
| AC-5 每次消歧恰好一条 notice、重试不重复 | PASS | `t2-notice-e2e.mjs` + 链路 grep | `PASS [N5] 首次真改名恰好一条消歧提示` / `[N5b] 重试两轮不再重复` / `[N5c] binding 保持 2、未出现 -3`；`bridge.ts:469` 生成文本、`index.ts:127 renamed: result.renamed` 显式投影（蓝图点名的唯一静默失效点已补） |
| AC-6 无静默滞留（穷尽性） | PASS | collision `C10` + fuzz `P4` + 单测 | `C10 occupied=1+98 spawned=[] started=[] errors=[{code:"MEMBER_NAME_COLLISION", …}] status=pending`（pending 有对应错误行）；fuzz `P4 lying=none` |
| AC-7 单测改写并加强、总数 ≥155 | PASS | `node --test test/dispatch.test.ts`；`pnpm -s test` | dispatch 文件 `tests 36 / pass 36 / fail 0`；全量 `tests 164 / pass 164 / fail 0`（基线 155，+9）。两条旧用例已改写：`test/dispatch.test.ts:512` 恒同名桩、`:545` 未退役 binding 占名取 `-2`；`MEMBER_NAME_COLLISION` 断言只剩序号穷尽例（`:735`/`:750`），旧「撞名即报错」断言零残留 |
| AC-8 collision 探针保留 C1~C5 + 新增 C6/C7、项数 ≥7 | PASS | `node …/qa-collision-probe.mjs` | `QA COLLISION PROBE RESULT: 12/12 passed`，exit 0；C1~C7 原语义保留，QA 补 C8/C9/C9b/C10/C11 |
| AC-9 全量门禁 | PASS | typecheck / test / build / 双产物 import / pack（均由我重跑） | `TYPECHECK rc=0`；`164/164`；`build_rc=0`，`find src -name '*.ts' -newer lib/index.js` = **0**；`HOST_IMPORT_OK` / `CLIENT_IMPORT_OK`；`npm pack --dry-run` 含 `cordis.patch.yml 646B`、`lib/client.js 92.2kB`、`lib/index.js 139.6kB`（共 5 文件） |
| AC-10 不回归 R2 | PASS | `qa-reverify-probe.mjs`；`qa-review-probe.mjs` | `QA REVERIFY PROBE RESULT: 9/9 passed`（项数与 R2 一致）；`QA REVIEW PROBE RESULT: 6/6 passed`，`R6` 已按新契约翻转（`spawned=["dev-t9-0b9ni3-2"] status=running errors=[] renamed=[…]`，ghost binding 不动） |
| AC-11 交付文档 | PASS | 本文件 + `QA-REPORT.md` | `QA-REPORT.md` 判定表覆盖 AC-1~AC-10 且每行带命令与实跑输出；本文件覆盖 AC-1~AC-10 并含结论，无「待补」占位 |

## 3. 架构一致性核验（M3 质量门）

| 蓝图要求 | 核验结果 |
|---|---|
| 消歧抽成「循环前一次性求值」的纯函数 | ✅ `src/host/team/dispatch.ts:216` `withNameSuffix`、`:247` `allocateMemberNames`；`:381-392` 在派发循环之前调用，入参只有 `nameOf`/`reserved`/`hostNames`，不读 `RunState` |
| 结果不进 `RunState`，改名经 `DispatchResult.renamed → DispatchOutcome.renamed → notices` | ✅ `dispatch.ts:82` → `src/host/index.ts:127` → `src/host/bridge.ts:75` 内联可选类型 + `:469` 生成 notice；`bridge.ts` 未 import team 层类型（编排层解耦保持） |
| 旧 `memberNameCollisions` / `NameCollision` 删除 | ✅ `grep -rn "memberNameCollisions\|NameCollision\b" src test` = 0 |
| `memberNameFor` / `NAME_BUDGET` / `HASH_LEN` 不动 | ✅ `git diff -U0` 中该文件对它们的改动只有新增注释与 `HASH_TAIL` 常量，函数体与预算常量零改动 |
| 长度/合法性规则只有一处 | ✅ `withNameSuffix` + `config.ts` 的 `HOST_MEMBER_NAME(_MAX)`；探针复用同一常量，未另写规则 |
| 无重复实现 / 无该抽未抽 | ✅ 命名逻辑只存在于 `dispatch.ts`；无第二套后缀拼接或哈希截断 |
| `DispatchResult` / `DispatchOutcome` 成对同名字段 | ✅ 两侧均为 `renamed`，字段形状一致（`taskId/base/final`） |
| 宿主名来源与 liveness 的保守策略一致（蓝图「重复风险」第 3 条） | ❌ **未满足**：`dispatch.ts:390` `hostNames = members === null ? [] : …`（按「没人占名」）vs `dispatch.ts:345` 注释与实现（`members === null` 时保守当作成员都活着）；且 `:383-385` 与 `allocateMemberNames` 内注释都把这件事写成「与 liveness 同一保守策略、不假装宿主里没人」——与代码相反。→ 本轮唯一条件项 C-1 |

## 4. 交付物与仓库卫生

- 源码改动：`src/host/team/dispatch.ts`（消歧算法）、`src/host/bridge.ts`（notice）、`src/host/index.ts`（投影）、`test/dispatch.test.ts`（改写 2 + 新增 9）。
- 产物：`lib/index.js` 已重建（`build_rc=0`，源码零文件新于产物）；`lib/` 未被忽略且已纳管（R2 时复核，`git check-ignore` rc=1）。
- `git status --porcelain -uall` 共 10 项，全部预期：6 项修改（dispatch/bridge/index/test/lib/memory.md）+ 4 项本夹文档（PRD/TECHNICAL/QA-REPORT/meta.json，加本文件为 5 项）。无 `node_modules/`、`logs/`、`dist/`、`.env` 噪声。
- 产品记忆 `docs/teamflow/memory.md`：撞名契约已按同主题替换为新语义；本次验收顺手勘误两处（函数名 `memberNameCollisions` → `allocateMemberNames` 并补「`listMembers` 抛错按空名处理、不做保守预留」的原因；单测基线 155 → 164），未追加 changelog。
- 收口待办（非缺陷）：最终单笔提交由 host 在验收后执行；`logs/teamflow/tf-mvvok3wc-x0sezk/` 为暂存区，由 host 归档后删除，不提交。

## 5. 条件项与遗留

**C-1（唯一条件项，文档级，不改行为）** `src/host/team/dispatch.ts:383-385` 与方法内 `:265` 附近两处注释把 `listMembers` 抛错时的处理写成「与 liveness 同一保守策略、宁可多算一个序号、不假装宿主里没人」，而实现（`:390`）是 `hostNames = []` 即按「无人占名」处理。二选一落地：
①（推荐）把注释改成如实描述：「宿主名单不可得 ⇒ 只依赖 binding 名 + 计划名；**刻意不做保守预留**，因为预留会让重试拿到新序号、破坏 AC-3 的名字恒定与恢复幂等；真撞名由宿主 spawn 失败以 `errors` 可观测」，并同步 `allocateMemberNames` 内同一说法；
② 若坚持与 liveness 同向，则须先证明它不破坏 AC-3（当前判断是不可能），再改实现 + 加用例。
落地后重跑 `pnpm -s typecheck && pnpm -s test`（并顺手确认 `grep -n "不假装宿主里没人" src` 不再与实现矛盾）即可转正式通过，**不需要重跑探针与 build**。

**剩余风险（记录，不作为条件）**：仅在 `listMembers` 抛错的降级窗口内，若宿主存在无 binding 的同名成员，可能以同一名字再 spawn 一个；后果是 `errors`（宿主拒绝）或面板出现同名成员，属可观测，不会造成静默 pending。这与 C-1 是同一件事的两面，C-1 落地时一并说明即可。

**P3 观察项（不阻塞）**：
1. 纯中文任务 id 的成员名形如 `dev-n5h7g0`（R2 已接受的权衡）；本轮无 UI 改动，仍未做人眼可辨认性检查。
2. `TECHNICAL.md` 边界表存在既有算术笔误（R2 遗留，未复验）。
3. `qa-collision-probe` 项数从 5 抬到 12（PRD 只要求 ≥7），覆盖面增强而非弱化，验收认可。

**人工补测清单（继承 QA §4，环境限制非交付缺陷）**：真实宿主对同名成员的拒绝行为、面板 notice 实际渲染、48 字名字的面板视觉截断、多任务并发 notice 的观感；本沙箱浏览器不可启动，以上均未做人眼核验。

**范围声明**：本轮只改成员名消歧与 notice 链路，未触碰 schema/HTTP/工具定义/客户端渲染/角色与记忆模块；产品级 AC-13~AC-30（任务图、选角、并行、恢复、面板、门禁、角色、双轨记忆等）由 R1/R2 交付并经本轮 `qa-reverify-probe 9/9` 与 `164/164` 单测间接回归，本轮不重复判定。

## 6. 结论

- 功能：**达标**。11 条 AC 全部由我在验收阶段独立重跑通过（typecheck exit 0、164/164 单测、collision 12/12、notice 12/12、fuzz 1000/1000、review 6/6、reverify 9/9、t1 e2e 6/6、build 新鲜 + 双产物 import OK + pack 3 条目）。
- 架构：与蓝图一致（纯函数前置分配、双层投影成对、命名规则单一来源、旧语义清零、`memberNameFor` 未动），**唯一偏离**是蓝图点名的 null 保守策略一致性（C-1，文档级）。
- 判定：**⚠️ 有条件通过**——C-1 为约 2 行注释整改，不改行为、不重跑功能门禁；落地后即可转正式通过。

验收结论：⚠️ 有条件通过
