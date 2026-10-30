# 验收报告 · 20261031-r2（R2-1 成员名塌缩缺陷修复）

- **验收对象**：`feat/auto-team-plugin` 工作树相对 `a0d32df` 的改动（8 处 M + 6 处 `??`，含 `src/host/team/dispatch.ts`、`src/host/team/member-prompt.ts`、`src/shared/types.ts`、`src/host/index.ts`、`package.json`、`.gitignore`、`lib/`、`test/*`、本夹文档）。
- **基线**：PRD 声明依赖 `docs/teamflow/20261030-r1-auto-team-plugin`，取代其 AC-17 的成员名形态（恢复语义未放松，仍按 `binding.taskId` 绑定）。
- **验收方式**：**全部命令由本阶段亲自重跑**（不复用 QA 的引用数值）；代码级修复，无 UI 改动，故无需人工点检（仅面板可辨认性属人眼项，见 §5）。
- **环境**：macOS / Node 22 / pnpm 10.34.7 / tsdown；工作树 `dirty=14`（8 M + 6 ??，其中 `docs/teamflow/20261031-r2/` 为约定保留项）。

## 1. 判定表（AC × 命令 × 实跑输出）

| AC | 判据 | 本阶段实跑命令 | 实跑输出（一行） | 判定 |
|---|---|---|---|---|
| AC-1 | 成员名两两唯一（中文 id / 仅大小写·分隔符差异 / t1 vs t2） | `node logs/teamflow/tf-mvvjakqn-xhhc7s/scripts/qa-collision-probe.mjs` | `QA COLLISION PROBE RESULT: 5/5 passed`；C2 `登录流程→dev-n5h7g0`、`注册接口→dev-q95q8s`；C3 `names=[dev-login-flow-2tqz4u,dev-login-flow-jlgxus]` | PASS |
| AC-1 | 同上（单测面） | `node --test test/dispatch.test.ts` | `tests 27 / pass 27 / fail 0`（中文两 id `:449`、N=5 `:479`） | PASS |
| AC-2 | 先编码身份段再归一、不塌缩成角色名、`HOST_MEMBER_NAME` 且 ≤48 | `node …/scripts/qa-review-probe.mjs` | `6/6 passed`；R5 `latin=dev-t1-x4gvxf zh=dev-n5h7g0`（旧实现两者都塌成 `dev`） | PASS |
| AC-3 | 同输入恒等（跨进程）+ 恢复按 `binding.taskId` | 同上 | R3 `child=["dev-n5h7g0","dev-login-flow-2tqz4u"] === inproc`；R4 乱序 bindings/members → `resumed=2 bindings=2` | PASS |
| AC-4 | 派发前两两唯一断言：撞名不 spawn、写 `errors`，禁止静默 pending | 同上 | R6 真实 `dispatchReady`：`spawned=[] status=pending errors=[{"taskId":"t9","code":"MEMBER_NAME_COLLISION",…}]` | PASS |
| AC-5 | 新增 ≥4 例、总数 ≥150、旧 `dev-t1` 断言按新契约收紧 | `pnpm -s test` | `ℹ tests 155 / pass 155 / fail 0`；新增 6 例（`test/dispatch.test.ts:449/463/479/490/508/539`），`:408` 处收紧为 `/^dev-t1-[0-9a-z]{6}$/`+同输入恒等 | PASS |
| AC-6 | 碰撞探针 5/5、exit 0 | `node …/scripts/qa-collision-probe.mjs` | `5/5 passed`；C4 `started=["登录流程","注册接口"] errors=[]`（两条都真派出去） | PASS |
| AC-7 | 复验探针 9/9 且项数不变 | `node …/scripts/qa-reverify-probe.mjs` | `QA REVERIFY PROBE RESULT: 9/9 passed`；A1~A6+B1+B2+E1 项集未增删 | PASS |
| AC-8 | 7 个 inject 全在 peer + optional，dependencies 为 0，react 保留 | `node …/scripts/check-peer-decls.mjs` | `RESULT: PASS (5 checks)`；`inject: 7 项；peerDependencies: 8 项；dependencies: 0 项` | PASS |
| AC-9 | 勘误上轮 `QA-REPORT.md:97` PASS 不实，贴两轮命令与输出 | `grep -n "inject=\|peer=" docs/teamflow/20261031-r2/QA-REPORT.md` | §4 含两条实跑：旧 `inject=7 peer=1 @deepseek-ai in peer=0`；新 `inject=7 peer=8 @deepseek-ai in peer=7 optional=7` | PASS |
| AC-10 | **独立**探针 2/2：真实链路的 spawn prompt 含技能正文，对照不含 | `node …/scripts/qa-skill-prompt-probe.mjs` | `2/2 passed`；1a `promptLen=241 含特征句=true`（真实 `createBridge`+`dispatchReady`+`buildMemberPrompt`），1b 有「技能」小节但 `含特征句=false` | PASS |
| AC-11 | typecheck 0 错 / test 全绿 / 双产物 mtime 晚于 src / 两产物 import exit 0 / pack 3 条目 | `pnpm -s typecheck`；`pnpm -s test`；`stat`+`find src -newer lib/index.js`；`node --input-type=module -e "await import('./lib/…')"`；`npm pack --dry-run` | typecheck `exit=0`；test `155/155`；`lib/index.js` `07:32:03`、`src 中比它新的 .ts = 0`；两产物 `exit=0`；`total files: 5` 含 `cordis.patch.yml 646B / lib/client.js 92.2kB / lib/index.js 136.3kB` | PASS |
| AC-12 | 本夹产出 QA-REPORT + ACCEPTANCE，含判定表与明确结论、覆盖 AC-1~AC-11 | `ls docs/teamflow/20261031-r2/`；本文件 | `PRD.md QA-REPORT.md TECHNICAL.md meta.json` + `ACCEPTANCE.md`；覆盖 12 条、无「待补」 | PASS |

## 2. 缺陷本体与反常目标核对（拒绝「绿但没用」）

- **单点修复**：`memberNameFor`（`src/host/team/dispatch.ts:157`）= `slugify(roleId)-slugify(taskId)-<6 位身份哈希>`；哈希输入是**原始** `roleId\0taskId`（FNV-1a 32 → base36 末 6，纯 `Math.imul`，无随机/locale）。`NAME_BUDGET = HOST_MEMBER_NAME_MAX - 6 - 1`，截断只裁可读段、永不裁哈希（`dispatch.ts:104-109`），`48` 仅存在于 `src/host/config.ts:81`。
- **派发路径真生效**：`memberNameCollisions`（`:180`）在循环**之前**一次算完（`:264-268`，含未退役 binding 占名），撞名任务在步 d（`:348-355`）`errors.push({code:'MEMBER_NAME_COLLISION'})` 后 `continue` → 不 spawn、不写 binding、不改 status；拒绝码只在 `src/shared/types.ts:298` 扩一项，`bridge.ts:485` 原样透传。
- **反面目标逐条**：① 真实链路塌缩 —— C4/R6/A1 均走真实 `RunsStore`+`createBridge`+`dispatchReady`，不是桩；② 靠序号消歧 —— 无 `-2` 自动改名，撞名显式报错；③ 截断吃掉唯一性 —— 40/40 长 id 用例 `:490` 断言末 6 位等于原始哈希且整名恰 48；④ 名字退化成不可读哈希 —— 拉丁 id 保留 `dev-t1-x4gvxf`（R2 探针 B2）；⑤ QA 只换措辞 —— AC-9 已贴两轮命令原文与输出。

## 3. 架构一致性（M3 质量门 · 蓝图符合性）

| 蓝图要求 | 实测 | 结论 |
|---|---|---|
| 名字算法与唯一性断言同处 `dispatch.ts`，并在派发入口生效 | `memberNameFor:157`、`memberNameCollisions:180`、断言 `:264-268` + 拦截 `:348-355` | 符合，无「只改算法不加断言」 |
| 技能正文抽成纯模块，`index.ts` 只留一行委托，不留双份文案 | `src/host/team/member-prompt.ts` 存在；`src/host/index.ts:95` 一行委托；文案特征串命中数 `index.ts=0 / member-prompt.ts=3` | 符合，无重复实现 |
| 拒绝码单点扩展，bridge 不加第二份码表 | `types.ts:298` 联合类型 +1 项；`bridge.ts:485` 原样透传 `errors[0].code` | 符合 |
| 归一化与宿主契约同源 | `grep -rn "replace(/\[\^a-z0-9\]" src/` 仅 `dispatch.ts:121` 一处；`HOST_MEMBER_NAME(_MAX)` 只定义于 `config.ts:78/81` | 符合，无适配漂移 |
| 探针项数守恒 | 三支探针 5/5、9/9、2/2 独立成文件，项数未变 | 符合 |

**未发现**重复实现、抽象缺失或破坏既有结构的问题。唯一可疑处是 `NAME_BUDGET` 截断分支当前不可达（两段各 ≤20，最大 head=41=预算）——属防御性预留，QA 已列 P3，不作整改要求。

## 4. 条件整改项（P2-1，收口前必需）

**仓库 `pnpm install` 在本单后不可解析（CI 首步必红）**——由 AC-8 新增 peer 声明 + 本仓 `pnpm-lock.yaml` 的 `settings.autoInstallPeers: true` 共同导致：

```bash
pnpm install --frozen-lockfile --lockfile-only
# ERR_PNPM_OUTDATED_LOCKFILE … * 7 dependencies were added: @deepseek-ai/dsh-client-*@*
# 在空目录用工作树 package.json 重生成：
pnpm install --lockfile-only
# ERR_PNPM_FETCH_404 GET https://registry.npmjs.org/@deepseek-ai%2Fdsh-compact: Not Found - 404
# 关闭自动安装 peer 后成功（已验证可行解）：
pnpm install --lockfile-only --config.auto-install-peers=false
# Done in 361ms using pnpm v10.34.7（exit 0）
```

- 影响面：`.github/workflows/ci.yml:21` 的 `pnpm install --frozen-lockfile=false` 会在此步失败（peer 由宿主 profile 提供、registry 上不存在）；本仓当前 `git remote -v` 为空，CI 暂不会实际触发，所以不阻塞产品运行（`pnpm add file:<repo>` 的交付路径与 `lib/` 产物不受影响），但干净克隆/接 CI 时必红。
- 建议整改（一行 + 一次重生成）：新增 `.npmrc` 写 `auto-install-peers=false`（peer 依赖本就由宿主提供），重生成 `pnpm-lock.yaml`，再重跑 AC-11 五项门禁确认全绿后复审。

## 5. 其余遗留（P3，不阻塞，已在 QA-REPORT §8 记录）

1. `TECHNICAL.md:86` 边界表算术笔误（33 vs 31）——文档瑕疵。
2. `NAME_BUDGET` 分支当前不可达（防御性代码，见 §3）。
3. 纯中文任务 id 的成员名形如 `dev-n5h7g0`，肉眼不可读 —— PRD 已接受该权衡；面板 `MemberView` 携带 `taskId`/标题，**建议发布前人工看一眼面板可辨认性**（本轮无 UI 改动，未截图）。
4. T6 交付说明称「reverify 原样复用」，实际 3 处按蓝图 T5 改为派生名（项数仍 9）——措辞问题。

## 6. 结论

- 功能面：R2-1 缺陷本体已在唯一取值点修复并加了兜底断言，AC-1~AC-11 全部按「命令 + 实跑输出」复核通过，无 P0/P1 缺陷，架构与蓝图一致。
- 交付面：1 项 P2 卫生整改（§4）需在收口提交前处理，否则新克隆/启用 CI 时 `pnpm install` 失败。基于「验证全绿 ≠ 无需返工」，本轮判**有条件通过**：整改项修完并重跑门禁后即可转正式通过，其余 P3 随手记录、不必单独开轮。

验收结论：⚠️ 有条件通过
