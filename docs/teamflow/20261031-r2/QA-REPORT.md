# QA 复验报告 · 20261031-r2（R2-1 成员名塌缩缺陷修复）

**结论：可验收。** AC-1~AC-11 全部实测通过，未发现 P0/P1/P2 缺陷；另有 4 条 P3 观察（文档笔误 / 防御性死分支 / 可读性权衡 / 交付说明措辞），均不阻塞。AC-12 的 `ACCEPTANCE.md` 属验收阶段产物，本轮不预写。

- 范围：`feat/auto-team-plugin` 工作树（未提交）相对 `a0d32df` 的 8 处 M + 4 处新增，含 `src/host/team/dispatch.ts`、`src/host/team/member-prompt.ts`、`src/shared/types.ts`、`src/host/index.ts`、`package.json`、`.gitignore`、`lib/`、`test/dispatch.test.ts`、`test/wire.test.ts`、`test/member-prompt.test.ts`。
- 环境：macOS / Node 22（`node --test` 直跑 TS 源）/ pnpm + tsdown；浏览器在 agent 沙箱内不可启动（见 §9），故全部采用脚本化断言（真模块 import + 真实 `dispatchReady`），非人工点检。
- 复验对象：上一轮判定的 P2 缺陷 R2-1（同角色多个中文任务 id 归一后重名 → 第二个就绪任务永久 `pending`）。

## 1. 判定表（AC × 命令 × 实跑输出）

| AC | 判据 | 命令 | 实跑输出（一行） | 判定 |
|---|---|---|---|---|
| AC-1 | 成员名两两唯一（中文 id / 仅大小写·分隔符差异） | `node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-collision-probe.mjs` | `RESULT: PASS (5 checks)`；C2 `登录流程→dev-n5h7g0`、`注册接口→dev-q95q8s` | PASS |
| AC-1 | 同上（单测面） | `node --test test/dispatch.test.ts` | `ℹ tests 27 / ℹ pass 27 / ℹ fail 0`（含 `:449` 中文两 id、`:463` Login_Flow vs login-flow、`:479` N=5） | PASS |
| AC-2 | 先编码身份段再归一、不塌缩成角色名、lower-kebab ≤48 | `node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-review-probe.mjs` | `6/6 PASS`；R5 `latin=dev-t1-x4gvxf` `zh=dev-n5h7g0`（旧实现塌成 `dev`） | PASS |
| AC-3 | 确定性 + 恢复按 `binding.taskId` 绑定（不按名字格式） | 同上 | R3 跨新 node 进程 `child=["dev-n5h7g0","dev-login-flow-2tqz4u"] === inproc`；R4 乱序 bindings/members → `resumed=2`、`bindings=2` | PASS |
| AC-4 | 派发前两两唯一断言：撞名不 spawn、写 `errors`，禁止静默 pending | 同上 | R6 真实 `dispatchReady` 遇未退役 binding 占名 → `spawned=[]`、`status=pending`、`errors=[{taskId:"t9",code:"MEMBER_NAME_COLLISION",...}]` | PASS |
| AC-5 | 多任务/边界单测 ≥4 例，总用例 ≥150，旧 `dev-t1` 断言按新契约更新不放宽 | `pnpm -s test` | `ℹ tests 155 / ℹ pass 155 / ℹ fail 0`；新增 6 例（`test/dispatch.test.ts:449/463/479/490/508/539`）；`:408` 由「合法即过」收紧为 `/^dev-t1-[0-9a-z]{6}$/` + 同输入恒等 | PASS |
| AC-6 | 碰撞探针 5/5 | `node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-collision-probe.mjs` | `RESULT: PASS (5 checks)`；C4 `started=["登录流程","注册接口"]`（两个都真派出去） | PASS |
| AC-7 | 复验探针 9/9 且项数不变 | `node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-reverify-probe.mjs` | `RESULT: PASS (9 checks)`；项集仍为 `A1~A6 + B1 + B2 + E1`，`grep -c "check("` = 9 次执行 | PASS |
| AC-8 | 7 个 `dsh.client.inject` 的 `@deepseek-ai/*` 全在 peer 且 optional，dependencies 为 0 | `node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/check-peer-decls.mjs` | `RESULT: PASS (5 checks)`；`inject 7 项 / peerDependencies 8 项 / dependencies 中 @deepseek-ai = 0` | PASS |
| AC-9 | 勘误上一轮 peer PASS 不实，须贴两轮命令与输出 | 见 §4 | 旧：`inject=7 peer=1 @deepseek-ai in peer=0`；新：`inject=7 peer=8 @deepseek-ai in peer=7 optional=7` | PASS |
| AC-10 | 新增**独立**技能正文运行期探针 2/2（真实链路捕获 spawn prompt） | `node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-skill-prompt-probe.mjs` | `RESULT: PASS (2 checks)`；真实 `createBridge`+`dispatchReady`+`buildMemberPrompt` 捕获 prompt 含「改动最小化」，对照无技能角色不含 | PASS |
| AC-11 | typecheck 0 错 / test 全绿 / build 双产物 mtime 晚于 src / 双产物 import exit 0 / pack 含 3 条目 | `pnpm -s typecheck` | exit 0（0 错误） | PASS |
| AC-11 | 同上 | `pnpm -s build` | exit 0；`lib/index.js` `lib/client.js` mtime `2026-10-31 07:32` > 最新 src `07:26:15`；构建前后 sha256 不变（可重现） | PASS |
| AC-11 | 同上 | `node --input-type=module -e "await import('./lib/index.js')"`；`…'./lib/client.js'` | 均 exit 0 | PASS |
| AC-11 | 同上 | `npm pack --dry-run` | `total files: 5`，含 `cordis.patch.yml 646B` / `lib/client.js 92.2kB` / `lib/index.js 136.3kB` | PASS |
| AC-12 | 产出 QA-REPORT 与 ACCEPTANCE | 本文件 + `docs/teamflow/20261031-r2/ACCEPTANCE.md` | QA-REPORT 已产出；ACCEPTANCE 由验收阶段按本报告判定表产出（r1 同样分工） | 部分（分工说明） |

## 2. 用例与结果汇总

| 面 | 项 | 结果 |
|---|---|---|
| 编译 | `pnpm -s typecheck` | exit 0 |
| 单测 | `pnpm -s test` | 155/155 pass（基线 146，+9：dispatch 6 + member-prompt 3） |
| 编排单测 | `node --test test/dispatch.test.ts` | 27/27 pass |
| 主链路 E2E | `node --test --test-name-pattern='端到端：派发' test/dispatch.test.ts` | 1/1 pass（派发→回执 done→解锁下游→再派发→plan 收敛 `terminated`） |
| 探针 | collision / reverify / skill / peer | 5/5 · 9/9 · 2/2 · 5/5 |
| 独立复核探针 | `qa-review-probe.mjs`（本轮新增，覆盖三支既有探针未覆盖面） | 6/6 PASS |
| 双产物 | 两端 import | 均 exit 0；`grep -c MEMBER_NAME_COLLISION lib/index.js` = 1（入库产物含新逻辑，非旧树构建物） |

**独立复核探针 `scripts/qa-review-probe.mjs` 的 6 项（本轮新增覆盖面）**：R1 长 id 可读段相同、仅末尾不同仍两两唯一（差异只来自完整 6 位哈希）；R2 38 条敌意语料（中文/emoji/大小写/分隔符/超长/空壳）全部满足 `HOST_MEMBER_NAME` 且 ≤48、同角色两两唯一；R3 跨进程确定性；R4 恢复按 taskId 绑定（bindings/members 乱序仍 `resumed=2`）；R5 可读性（不塌缩成 `dev`）；R6 真实碰名兜底（不 spawn、写 ERROR）。

## 3. 缺陷本体回归（R2-1）

- 旧行号 `src/host/team/dispatch.ts:103`：整体归一化把身份信息一起抹掉。
- 新实现：`memberNameFor` = `slugify(roleId)-slugify(taskId)-<6 位身份哈希>`；哈希输入是**原始** `roleId\0taskId`（FNV-1a 32 → base36 末 6，纯 `Math.imul`，无随机/locale）。截断只裁可读段、永不裁哈希，长度上限引用 `src/host/config.ts:81` 的 `HOST_MEMBER_NAME_MAX`（`dispatch.ts` 内不重写 48）。
- 派发入口 `dispatchReady` 在循环前一次算完 `memberNameCollisions(plan.tasks, { reserved: 未退役 binding })`（`src/host/team/dispatch.ts:264-268`），撞名任务在步 d（`:345-355`）`push {taskId, code:'MEMBER_NAME_COLLISION', error}` 后 `continue`：**不 spawn、不写 binding、不改 status**，不再退化为宿主侧静默 `pending`。`RejectionCode` 仅在 `src/shared/types.ts:317` 扩一项，`src/host/bridge.ts:485` 已透传 `errors[0].code`，无第二份码表。

## 4. AC-9 勘误：上一轮 peer 声明 PASS 不实

上一轮 `docs/teamflow/20261030-r1-auto-team-plugin/QA-REPORT.md:97` 第 6 条写「PASS：`@deepseek-ai/*` 全在 `peerDependencies` + `peerDependenciesMeta.optional`」。**该结论在当时不成立**——那一版 `peerDependencies` 只有 `react`，7 个宿主注入包仅列在 `dsh.client.inject`。

命令 A（基线 `a0d32df` 的 package.json）：

```bash
git show HEAD:package.json | node -e 'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));const inj=p.dsh?.client?.inject??[];const peers=Object.keys(p.peerDependencies??{});console.log("inject="+inj.length,"peer="+peers.length,"@deepseek-ai in peer="+peers.filter(k=>k.startsWith("@deepseek-ai/")).length,"deps.hasDeepseek="+Object.keys(p.dependencies??{}).filter(k=>k.startsWith("@deepseek-ai/")).length)'
```
输出：`inject=7 peer=1 @deepseek-ai in peer=0 deps.hasDeepseek=0` → 旧报告第 6 条不实。

命令 B（本轮工作树）：

```bash
node -e 'const p=require("./package.json");const inj=p.dsh?.client?.inject??[];const peers=Object.keys(p.peerDependencies??{});const meta=p.peerDependenciesMeta??{};console.log("inject="+inj.length,"peer="+peers.length,"@deepseek-ai in peer="+peers.filter(k=>k.startsWith("@deepseek-ai/")).length,"@deepseek-ai optional="+peers.filter(k=>k.startsWith("@deepseek-ai/")&&meta[k]?.optional===true).length,"deps.hasDeepseek="+Object.keys(p.dependencies??{}).filter(k=>k.startsWith("@deepseek-ai/")).length)'
```
输出：`inject=7 peer=8 @deepseek-ai in peer=7 @deepseek-ai optional=7 deps.hasDeepseek=0` → 本轮 AC-8 才真正成立。

## 5. 架构校验（蓝图符合性 · 非阻塞）

| 蓝图要求 | 实测 | 结论 |
|---|---|---|
| 名字算法与唯一性断言同处 `dispatch.ts`，在派发路径真正生效 | `memberNameFor:157`、`memberNameCollisions:180`、断言 `:264-268` + 拦截 `:345-355` | 符合 |
| `member-prompt.ts` 抽出纯函数，`index.ts` 只留一行委托 | `src/host/team/member-prompt.ts:26` `buildMemberPrompt`；`src/host/index.ts:95` 一行委托；`grep -c "# 角色：\\|## 本次任务\\|## 团队记忆" src/host/index.ts` = **0**，`member-prompt.ts` = 3 | 符合，无第二份文案来源 |
| 拒绝码只在 `src/shared/types.ts` 扩联合类型，bridge 不加分支 | `types.ts:317` 新增 1 项；`bridge.ts:485` 原样透传 | 符合 |
| `HOST_MEMBER_NAME` / `_MAX` 单点引用，不重写 48 | `config.ts:78/81` 为唯一定义；`grep -rn "HOST_MEMBER_NAME_MAX" src/` 除 config 外只命中 `dispatch.ts` | 符合 |
| 无重复实现 | `grep -rn "replace(/\\[\\^a-z0-9\\]" src/` 仅 `dispatch.ts:121` 一处 slug | 符合 |
| 探针项数守恒 | collision 与归档 r1 副本 **字节相同**；reverify 仅 3 处把写死 `dev-t1` 改为 `spawned.at(-1)?.name`（蓝图 T5 指定），项集 9 不变 | 符合（见 §8 第 4 条措辞纠正） |

## 6. 接口一致性 + 可执行证据

- 静态：`pnpm -s typecheck`（`tsc --noEmit`，`allowImportingTsExtensions`）exit 0 —— 覆盖全部跨模块 import 的符号存在性、`obj.method()` 存在性与实参形状；蓝图 `api` 字段列出的符号逐一 grep 命中（`memberNameFor` / `shortIdentityHash` / `memberNameCollisions` / `NameCollision` / `DispatchDeps.memberNameFor?` / `dispatchReady` / `resumeRun` / `runningCount` / `RejectionCode` / `buildMemberPrompt` / `MemberPromptDeps`）。
- 运行期（主链路，非存在性检查）：`qa-collision-probe.mjs` C4 与 `qa-review-probe.mjs` R6 走**真实** `RunsStore` + `createBridge` + `dispatchReady`，断言 `started` 数组与 `errors[].code` 的真实取值；`qa-skill-prompt-probe.mjs` 用真实 `buildMemberPrompt` 捕获宿主将收到的 spawn prompt 文本。
- 端到端终态：`node --test --test-name-pattern='端到端：派发' test/dispatch.test.ts` → 1/1 pass，派发到位、回执解锁下游、收敛 `terminated`、`runningCount=0`。

## 7. 提交面卫生

`git status --porcelain -uall` → 8 项 `M`（`.gitignore`、`lib/index.js`、`package.json`、`src/host/index.ts`、`src/host/team/dispatch.ts`、`src/shared/types.ts`、`test/dispatch.test.ts`、`test/wire.test.ts`）+ 5 项 `??`（`docs/teamflow/20261031-r2/{PRD,TECHNICAL,meta.json}`、`src/host/team/member-prompt.ts`、`test/member-prompt.test.ts`）。**无** `node_modules/`、`*.tgz`、`*.log`、IDE/缓存噪声；`.gitignore` 已补 `*.tgz` 与 `pnpm-debug.log*`，且 `git check-ignore lib/index.js` 未命中（`lib/` 按约定入库）。`logs/teamflow/` 已在忽略列表内，未污染交付面。

## 8. 缺陷表

**未发现 P0/P1/P2 缺陷。** 以下 4 条为 P3 观察（不阻塞验收）：

| 编号 | 严重级 | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| R2-QA-1 | P3 | 文档（架构） | 打开 `docs/teamflow/20261031-r2/TECHNICAL.md:86` 边界表 | 「`dev` / 40 个 `x`」长度应为其公式算出的 31 | 写的是 33（算术笔误） | AC-2 | `sed -n '86p' docs/teamflow/20261031-r2/TECHNICAL.md` | - |
| R2-QA-2 | P3 | 架构（防御性死分支） | 读 `src/host/team/dispatch.ts:109` 的 `NAME_BUDGET` 与 `:157` 的 `slice` | 预算截断在可读段超预算时生效 | 可读段两段各 ≤20，最大 head=41=`NAME_BUDGET`，`base.length > NAME_BUDGET` 恒 false，预算分支当前不可达；唯一性由「分段截 20 + 完整 6 位哈希」承担（R1/R2 已证） | AC-1/AC-2 | `node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-review-probe.mjs` | - |
| R2-QA-3 | P3 | UI 可辨认性 | 纯中文任务 id 派发后看成员名 | 名字能一眼对应任务 | 名字形如 `dev-n5h7g0`（无可读中文）；PRD 已接受该权衡，面板 `MemberView` 带 `taskId`/`roleId`，靠面板与直达消息辨认 | AC-2 | `node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-review-probe.mjs`（R5） | - |
| R2-QA-4 | P3 | 交付说明措辞 | 读 T6 交付说明「reverify 原样复用」 | 与工作树一致 | 实际 A5/A6/B2 三处把写死 `dev-t1` 改为 `spawned.at(-1)?.name` 派生（符合蓝图 T5，项数仍 9） | AC-7 | `diff /Users/maliang/.dsh/teamflow/ws-dsh-auto-team-20702aa5/logs/tf-mvv49icd-0axwfe/scripts/qa-reverify-probe.mjs logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-reverify-probe.mjs` | - |

> 附加事实（非缺陷）：本机 `pnpm-lock.yaml` 的 `autoInstallPeers: true` 使新增 peer 后 `pnpm install --frozen-lockfile` 报 `ERR_PNPM_OUTDATED_LOCKFILE`；AC-11 的门禁不跑 install，不阻塞，已由 T3 在 `scripts/peer-decls-note.md` 记录并给出解（`--lockfile-only --config.auto-install-peers=false`）。

## 9. 人工补测清单（环境限制，非交付缺陷）

| 项 | 验收判据 | 方法 / 工具 |
|---|---|---|
| profile 真实安装并加载 | `dsh.profile.bundles` 加入 `dsh-auto-team` 后重启宿主，插件工具与面板都出现，无启动期崩溃 | 主 agent 执行 `cd ~/.dsh/profiles/desktop && pnpm add file:<repo>` + 同步 bundles，重启后看工具列表与面板；沙箱内不可执行（`dsh` 不在 PATH，安装只能由主 agent 做） |
| 面板肉眼观感 | 成员行能区分同角色的多个任务（名字 + taskId/标题），暗色/亮色下字号与截断正常 | 真实浏览器打开 Web GUI；agent 沙箱内 Chromium crashpad 被宿主 token 限制无法启动（`PROCESS_ALL_ACCESS` 被拒，exit -36863），单列人工 |
| 30+ 任务规模下的并发观感 | 就绪任务并行、面板 ≤5s 反映状态、杀成员 5s 内变 `interrupted` | 真实宿主 + 面板计时；脚本侧仅覆盖到 `runningCount` 与 `errors` 的账本断言 |
| 长 id 的转义/复制粘贴 | 面板中 48 字符长名不撑破布局 | 浏览器 DevTools 断言 `scrollWidth <= clientWidth`（需真实浏览器） |

## 10. 结论

- **可验收。** R2-1 缺陷已在真实派发路径上修复并可复现验证：同角色多个中文 id / 仅大小写分隔符差异的 id 得到不同成员名；真实 `dispatchReady` 遇撞名会明确报 `MEMBER_NAME_COLLISION` 而不再静默 `pending`；恢复仍按 `binding.taskId` 绑定，不依赖名字格式。
- 全量门禁：typecheck exit 0、155/155 单测、build 双产物（可重现、mtime 晚于 src、两端 import exit 0）、`npm pack` 含 3 条目；探针 5/5、9/9（项数不变）、2/2、5/5，外加本轮新增的 6/6 独立复核探针。
- 未发现阻塞缺陷；4 条 P3 观察与 4 项人工补测（§9）已单列，供验收与人审。
