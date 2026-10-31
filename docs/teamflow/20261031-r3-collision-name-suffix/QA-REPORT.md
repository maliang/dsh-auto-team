# QA-REPORT · 成员名撞名确定性消歧（20261031-r3）

- 分支：`feat/auto-team-plugin`（工作树未提交，改动 9 项，见 §5）
- 产品根：仓库根 `dsh-auto-team/`（单包，无 `products/` 层）
- 被测范围：`src/host/team/dispatch.ts`（消歧算法）、`src/host/bridge.ts`（renamed → notice）、`src/host/index.ts`（装配投影）、`test/dispatch.test.ts`、`logs/teamflow/tf-mvvok3wc-x0sezk/scripts/`（探针）
- 环境：macOS + Node 26.11.1 + pnpm；**浏览器不可启动**（沙箱受限令牌，host 环境限制，非交付缺陷）。本需求是 node 侧库逻辑，全部验证走「直接跑 TS 源 + 真实 store/bridge 装配 + node --test」，无需浏览器。
- 结论：**可验收**，无 P0/P1/P2；1 条 P3（代码注释与实现方向相反，不影响功能）。

## 1. 判定表（AC-1 ~ AC-11，每行一条实跑命令 + 实跑输出）

| AC | 判定 | 检测命令 | 实跑输出（截取） |
|---|---|---|---|
| AC-1 撞名按 -2/-3 继续派发 | PASS | `node logs/teamflow/tf-mvvok3wc-x0sezk/scripts/qa-collision-probe.mjs` | `C6 spawned=["dev-dup","dev-dup-2"] errors=[]` / `C7 spawned=["dev-t9-…-2"] status=running` / `C8`（宿主无 binding 同名成员也让路）· `12/12 passed` exit 0 |
| AC-1 面板链路（renamed 真的到 notices） | PASS | `node logs/teamflow/tf-mvvok3wc-x0sezk/scripts/t2-notice-e2e.mjs` | `PASS [N4b] …改用 dev-t2-xeghme-2 并给出三要素 notice`；notices=`["已创建 2 个成员：t1、t2","任务「写前端」(t2) 的成员名 dev-t2-xeghme 已被占用，已改用 dev-t2-xeghme-2 派发"]` · `12 passed, 0 failed` |
| AC-2 ≤48 且只压可读段、6 位哈希逐字保留 | PASS | 同上 collision 探针 `C9/C9b` | `base=rrrr…-xxxx…-fh71pz(48) final=rrrr…-xxxx…-fh71pz-2(48) hash=fh71pz kept=true`；对照 `naive=…(50) limit=48`（证明断言可分辨，非恒绿） |
| AC-3 确定性 / 重建不递增 / resume 不翻倍 | PASS | `qa-collision-probe.mjs`(C6) + `t1-dispatch-e2e.mjs` + `qa-naming-fuzz.mjs` | `qa-naming-fuzz` 200 组随机输入断言 P5 顺序无关、P6 重复调用逐字段相同 → `1000/1000 passed`，两次进程 `DIGEST ce81be77` 相同；`t1` 终态 `E2 started=0 E3 rebuilt=dev-dup-2 E4 started=2` |
| AC-4 不抢他人本名 | PASS | 同上 collision `C11` + fuzz `P3` | `C11 spawned=["dev-x-3","dev-x-2"] byTask={"a":"dev-x-3","b":"dev-x-2"} errors=[]`（A 跳过 B 的本名 `dev-x-2`，取 `-3`）；fuzz `steal=none starved=none` 200 轮全绿 |
| AC-5 每次消歧恰好一条 notice、重试不重复 | PASS | `t2-notice-e2e.mjs`（N4/N5 系列） | `PASS [N5] 首次真改名恰好一条消歧提示`；`PASS [N5b] 重试两轮不再重复消歧提示`；`N5c binding 保持 2、未出现 -3`；`N5d 两条任务仍 running` |
| AC-6 穷尽性：无静默 pending，仅序号耗尽才报错 | PASS | collision `C10` + fuzz `P4` | `C10 occupied=1+98 spawned=[] started=[] errors=[{code:"MEMBER_NAME_COLLISION", error:"… 序号候选（-2…-99）全部被占用；本次不派发"}] status=pending`（pending 有对应错误行，非静默）；fuzz `P4 lying=none` |
| AC-7 改写 `test/dispatch.test.ts:508/:539` + 新增 ≥4 例、总数 ≥155 | PASS | `node --test test/dispatch.test.ts`、`pnpm -s test` | dispatch 文件 `ℹ tests 36 / pass 36 / fail 0`；全量 `ℹ tests 164 / pass 164 / fail 0`（基线 155）；两条旧用例已改写为新契约（现 `:512` 恒同名两任务都派出、`:$545` 未退役 binding 占名取 `-2` 且既有 binding 原样保留），旧断言零残留（`grep -n MEMBER_NAME_COLLISION test/dispatch.test.ts` 仅 2 处命中，且都在序号穷尽用例内：`:735` 用例名 + `:750` 断言，旧「撞名即报错」断言已不存在） |
| AC-8 qa-collision-probe 保留 C1~C5 + 新增 C6/C7、项数 ≥7 | PASS | `node logs/teamflow/tf-mvvok3wc-x0sezk/scripts/qa-collision-probe.mjs` | `QA COLLISION PROBE RESULT: 12/12 passed` exit 0；C1~C5 语义未弱化，C6/C7 原样保留，QA 另补 C8（宿主无 binding 同名成员）、C9/C9b（48 边界 + 可分辨对照）、C10（穷尽）、C11（不抢本名） |
| AC-9 全量门禁 | PASS | `pnpm -s typecheck` / `pnpm -s test` / `pnpm -s build` / 双产物 import / `npm pack --dry-run` | typecheck exit 0；test 164/164；build `lib/index.js 139.57 kB`、`lib/client.js 92204 B`；`find src -name '*.ts' -newer lib/index.js` = **0**（产物晚于源码）；`HOST_IMPORT_OK` / `CLIENT_IMPORT_OK`；pack 含 `cordis.patch.yml 646B`、`lib/client.js 92.2kB`、`lib/index.js 139.6kB` |
| AC-10 不回归 R2 | PASS | `qa-reverify-probe.mjs` / `qa-review-probe.mjs` / `t1-dispatch-e2e.mjs` | reverify `9/9 passed`（项数与 R2 一致，A1~A6/B1/B2/E1）、review `6/6 passed`（R1~R5 仍为原用例；R6 已按新契约翻转，`grep -n "'R6'" -A1` 可见其断言「以 -2 继续派发、errors 空、任务 running」而非旧 MEMBER_NAME_COLLISION）、t1 `6 passed` 且中文 id 两任务名字两两唯一、恢复幂等 |
| AC-11 本夹产出 QA-REPORT（判定表贴实跑输出） | PASS | 本文件 | 判定表 11 行，每行带命令与实跑输出；`ACCEPTANCE.md` 属验收阶段产出 |

## 2. 用例与结果汇总

| 检查器 | 项数 | 结果 | 说明 |
|---|---|---|---|
| `test/dispatch.test.ts`（含新增 9 例） | 36 | 36/36 PASS | 纯逻辑 + dispatchReady 双层 |
| `pnpm -s test` 全量 | 164 | 164/164 PASS | 基线 155，+9 |
| `qa-collision-probe.mjs` | 12 | 12/12 PASS | C1~C7 保留/翻转 + QA 追加 C8/C9/C9b/C10/C11 |
| `t2-notice-e2e.mjs` | 12 | 12/12 PASS | 含 QA 追加 N5~N5d（重试不重复） |
| `qa-naming-fuzz.mjs`（QA 新增，属性测试） | 1000 断言 / 200 组 | 1000/1000 PASS | 两两唯一、合法 ≤48、不抢名、诚实穷尽、顺序无关、幂等；跨进程 DIGEST 一致 |
| `t1-dispatch-e2e.mjs` | 6 | 6/6 PASS | 三轮恒同名 + 恢复沿用不递增 |
| `qa-review-probe.mjs` | 6 | 6/6 PASS | R6 已按新契约翻转 |
| `qa-reverify-probe.mjs` | 9 | 9/9 PASS | 项数未变（R2 契约无回归） |
| typecheck / build / 双产物 import / pack | 5 | 全部 PASS | AC-9 |

## 3. 架构核验（蓝图一致性 · 非功能附加项）

| 蓝图要求 | 核验结果 |
|---|---|
| 消歧做成「循环前一次性求值」的纯函数 `allocateMemberNames` / `withNameSuffix` | ✅ `src/host/team/dispatch.ts:216` `withNameSuffix`、`:247` `allocateMemberNames`；`:381-392` 在派发循环之前一次算完（`nameOf`/`reserved`/`hostNames` 三处输入，不读 RunState） |
| 结果不进 RunState，改名经 `DispatchResult.renamed` → `DispatchOutcome.renamed` → notices | ✅ `DispatchResult.renamed`（dispatch.ts:79）→ `src/host/index.ts:127` `renamed: result.renamed` → `src/host/bridge.ts:75` 内联可选类型 + `:469` notice 循环；bridge 不 import team 层类型（`grep -c "from './team/" src/host/bridge.ts` = 0） |
| 旧 `memberNameCollisions`/`NameCollision` 删除 | ✅ `grep -rn "memberNameCollisions\|NameCollision\b" src test` = 0 |
| `memberNameFor` 保持原样不动 | ✅ `git diff -U2` 中 `memberNameFor` 函数体无改动（唯一相关改动是 `DispatchDeps.memberNameFor` 的注释文案） |
| 长度/合法性规则只有一处（`withNameSuffix` + `HOST_MEMBER_NAME`） | ✅ `grep -rn "withNameSuffix\|NAME_SUFFIX_MAX" src` 除 `team/dispatch.ts` 外 0 命中；探针刻意复用 `config.ts` 的 `HOST_MEMBER_NAME(_MAX)` 而非另写规则 |
| 无重复实现 / 无该抽未抽 | ✅ 命名逻辑仅存在于 `dispatch.ts`；未发现第二套后缀拼接或第二处哈希截断（`shortIdentityHash` 全仓 2 处命中 = 定义 + `memberNameFor` 调用） |
| 接口一致性（跨模块调用真存在、参数形状匹配） | ✅ `pnpm -s typecheck` exit 0（覆盖 `index.ts` 端口装配、`bridge` 的 `renamed` 投影、测试与探针的 import）；蓝图点名的「唯一静默失效点」`index.ts` 显式投影已补，静态守卫 `PASS [N1]` |

## 4. 人工补测清单（环境限制，非交付缺陷）

| 项 | 验收标准 | 方法 / 工具 |
|---|---|---|
| 真实宿主的重名成员拒绝行为 | 宿主 `spawnTeammate` 遇同名成员时返回可读错误，任务落 `errors` 而非静默 pending | 在真实 DSH 会话里手动触发两次同会话派发；本沙箱无法起真实宿主会话 |
| 面板上 notice 的实际渲染 | 消歧提示出现在活动面板的 notices 区、可读、与任务卡片可对照 | 打开 Web 面板点「派发」；浏览器在本沙箱不可启动（受限令牌），已用 `src/client/viewmodel.ts:398` 的 notices 解析做静态等价核验 |
| 48 字成员名在面板/消息头部的视觉截断 | 不出现破版或关键字（哈希段）被截断 | 人眼检查面板成员名显示，必要时配合 DevTools 量 `scrollWidth <= clientWidth` |
| notice 多条并发时的滚动/分组观感 | 多任务各一条时不互相覆盖 | 人眼检查连续派发 3+ 任务的提示条 |

## 5. 缺陷表

| 编号 | 严重级 | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| D-1 | P3 | 架构 / 文档措辞 | 读 `src/host/team/dispatch.ts:384-385` 注释，再读 `:390` 实现与 `:345` 的 liveness 注释 | 注释、实现、蓝图三处对「`listMembers` 抛错（`members === null`）」的方向一致 | 注释称「宁可多算一个序号，也不假装『宿主里没人』」，实现 `const hostNames = members === null ? [] : members.map(m => m.name)` 恰是「按无人占名处理」；而 `:345` 对同一 `null` 是「保守当作成员都还活着」——同一份未知数据在两处取了相反方向的保守值。功能后果可观测（真撞名会以 spawn `errors` 暴露、不留静默 pending），故不阻塞 | AC-1 / AC-6 | `sed -n '343,347p;383,391p' src/host/team/dispatch.ts` | 二选一后二者一致：① 注释改为如实描述「未知即按无人占名，撞名由 spawn 失败以 errors 暴露」；② 实现改为未知时保守预留（例如把 `hostNames` 置为 `null` 并在分配时对每个任务多跳一个序号）。任一种落地后，`sed` 输出的注释与实现方向一致 |

未发现 P0 / P1 / P2 缺陷。

## 6. 结论

- 功能：撞名不再停派，按 `-2/-3…-99` 确定性消歧并继续派发；面板给出「任务 + 原候选名 + 最终名」一条 notice；重试/恢复不重复、不翻倍；序号耗尽才以 `MEMBER_NAME_COLLISION` 可观测报错。
- 门禁：typecheck 0 错、164/164 单测、build 双产物新鲜、双产物 import OK、`npm pack` 3 条目齐、探针 12/12 + 12/12 + 1000/1000 + 9/9 + 6/6 + 6/6 全绿。
- 版本控制：`git status --porcelain -uall` 仅 9 项预期改动（6 改 + 3 新增文档），无 `node_modules/`、`logs/`、`dist/`、`.env` 等噪声；`lib/` 未被忽略且已纳管（`git check-ignore lib/index.js lib/client.js` → rc=1）。
- 判定：**可验收**（D-1 为 P3 观察项，随下一轮文档/实现微调收口即可，不阻塞验收）。
