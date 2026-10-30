# QA-REPORT · dsh-auto-team（20261030-r1 · 复验轮 2）

> 轮次性质：**复验轮 2**。上一轮 QA 判 `failed`（3 个 P2：N1/N2/A-1），dev 已修复。本轮先原样重跑 `logs/teamflow/tf-mvv49icd-0axwfe/scripts/` 下**全部**既有 checker（本项目回归契约）与每个缺陷行的检测命令，再只补上一轮**未覆盖**的面。
> 分支 `feat/auto-team-plugin` @ `150eb5b chore: baseline before teamflow run`；工作树 63 项未提交改动 = 本次交付本体（尚未收口提交）。

## 0. 结论（先行）

**不可验收（1 个新 P2 开放）。** 上一轮的 3 个 P2（N1 逐角色模型审计落不下来、N2 成员名违反宿主字符集、A-1 宿主硬契约未集中）**全部修复并复验通过**（N1 的端到端旁证：e2e `audits` 由上轮 0 变 2）。本轮在上一轮未覆盖的**成员名唯一性**面上发现 1 个新 P2：`memberNameFor` 归一后会让「中文任务 id」「仅大小写/分隔符不同的 id」塌缩成同一个成员名（`dev-登录流程` → `dev`），同角色多个此类任务派发时任务身份丢失、第二个任务在宿主重名时会永久 `pending`（AC-15/AC-16/AC-17）。检测命令 `node logs/teamflow/tf-mvv49icd-0axwfe/scripts/qa-collision-probe.mjs` 当前 exit 1（1/5 PASS），修复后需 exit 0（5/5）。

## 1. 范围与环境

| 项 | 值 |
|---|---|
| 被测形态 | 单包双产物 Cordis 插件（宿主 `lib/index.js` ESM + client `lib/client.js` CJS 套壳），`dsh-auto-team@0.1.0` |
| 环境 | macOS / Node v26.11.1（`node --test` 直接跑 TS 源）/ pnpm 10.34.7 |
| 浏览器 | 沙箱内**无法启动真实浏览器**（宿主 token 限制 crashpad，非交付缺陷）→ UI 用宿主桩 + **真实 timer** 驱动，视觉项进 §10 |
| 验证方式 | 静态审计 + 单测（146）+ 既有 12 个 checker 原样重跑 + 1 个本轮新探针（成员名唯一性） |
| 未覆盖（环境） | 真机 profile 安装/重启加载、真机 GUI 观感、真实宿主 per-role 模型落地 → §10 |

## 2. 验证命令与结果（全部实跑）

| 命令 | 结果 |
|---|---|
| `pnpm -s typecheck` | exit 0（全仓 0 错） |
| `pnpm -s test` | exit 0，**146 tests / 146 pass / 0 fail**（上轮 141，+5 为 A-1 守卫用例） |
| `pnpm -s build` | exit 0，`lib/index.js` 132.09kB、`lib/client.js` 92204B，mtime 04:32（晚于全部 `src/`） |
| `node --input-type=module -e "await import('./lib/index.js')"` | exit 0（宿主产物顶层装载安全） |
| `node --input-type=module -e "await import('./lib/client.js')"` | exit 0（client 产物顶层装载安全，`window` 守卫生效） |
| `npm pack --dry-run` | 含 `lib/index.js` / `lib/client.js` / `cordis.patch.yml` |
| `grep -rn "from '\.\./host/" src/client` | 0 命中（exit 1，跨半 import 守卫成立） |
| `grep -rn 'font-size: var(--dsw-font' src/client` | 0 命中（字号一律 `font:` 简写） |
| `grep -c 'workspace:' package.json` | 0（依赖协议可被 profile 解析） |
| `bash logs/.../scripts/typecheck-v2-contract.sh` | exit 0，`T4 文件错误数：0 / 全仓：0` |

既有 checker 原样重跑（**逐条通过数**）：

| checker | 结果 |
|---|---|
| `qa-reverify-probe.mjs` | exit 0，**9/9 PASS**（A1 A2 A3 A4 A5 A6 B1 B2 E1） |
| `qa-adversarial-probe.mjs` | exit 0，**51 PASS / 0 FAIL** |
| `check-e2e-mainpath.mjs` | exit 0，`allDone:true`，members 3 / bindings 3 / messages 7 / gateExitCodes `[0,0]` / tools 7 / routes 1，**`audits=2`**（上轮 0）；resume 两次 binds `3→3` 幂等 |
| `check-delivery.mjs` | **20/20** |
| `client-state-check.mjs` | **60 通过 / 0 失败** |
| `check-store-contract.mjs` | `RESULT: PASS (6 checks)` |
| `check-t1-contract.mjs` | **8/8** |
| `check-memory-subsystem.mjs` | 通过（注入 **3970/4000** 字符、省略 145 行；读·写·删三路径逃逸均拒绝） |
| `check-client-bundle.mjs` | exit 0（manifest id / inject / 两个 slot 注册逐字核对） |
| `qa-collision-probe.mjs`（**本轮新增**） | exit 1，**1/5 PASS**（C2/C3/C4/C5 FAIL） |

主链路实测（e2e + 对抗探针）：`t1:done t2:done`；AC-18 杀成员 → **1446ms** 变 `interrupted`（真实 timer）；AC-18 对照存活两轮仍 `running`（判据非恒红）；AC-19 门禁失败 → `rework` 且下游 `blocked`、证据回发成员。

## 3. 本轮新增探针（上一轮未覆盖的面 + 为什么缺失）

| 探针 | 覆盖的面 | 上轮为何漏 |
|---|---|---|
| `qa-collision-probe.mjs` | 归一后**成员名两两唯一**（同角色多任务） | 上轮 B1 与 `test/dispatch.test.ts` 的 `HOST_MEMBER_NAME` 套件都是**单任务视角**：断言「每个 id 单独生成的名字符合宿主字符集」。合法 ≠ 唯一——把两个不同 id 放在一起才暴露，任何单任务扫描都结构性地看不到。 |

探针判据（5 条，均为可分辨断言，C1 为拉丁对照，防恒红）：C1 `dev-t1≠dev-t2`；C2 中文两个 id 不同名；C3 `Login_Flow` vs `login-flow` 不同名；C4 两个就绪中文 id 任务都派发成功；C5 成员名不得塌缩成角色名。实测：

```
PASS [C1] names=[dev-t1,dev-t2]
FAIL [C2] 任务「登录流程」→ dev；任务「注册接口」→ dev
FAIL [C3] names=[dev-login-flow,dev-login-flow]
FAIL [C4] started=["登录流程"] pending=["注册接口"] spawnNames=["dev","dev"]
          errors=[{"taskId":"注册接口","error":"创建成员失败：TEAM_MEMBER_EXISTS dev"}]
FAIL [C5] 任务「登录流程」→ dev（丢失任务身份）
QA COLLISION PROBE RESULT: 1/5 passed
```

代码位置（根因）：`src/host/team/dispatch.ts:103-120` `memberNameFor` 用 `.replace(/[^a-z0-9]+/g,'-')` 归一，纯中文段整体被折成一个 `-` 再去尾，只剩角色名；`src/host/team/dispatch.ts:245` 直接 `const name = memberNameFor(task)`，`dispatchReady` **无去重**。

## 4. 上一轮缺陷复验对比（仅对比，**非开放项**）

| 编号 | round-1 级 | round-2 级 | 复验命令（原样） | 结果 |
|---|---|---|---|---|
| N1 逐角色模型审计落空 | P2 | 已修复 | `node logs/.../qa-reverify-probe.mjs 2>&1 \| grep -c '^PASS \[A4\]'` | `1`（A6 亦 `1`）；e2e `audits` 0→2 |
| N2 成员名违反宿主字符集 | P2 | 已修复 | `node logs/.../qa-reverify-probe.mjs 2>&1 \| grep -c '^PASS \[B1\]'` | `1`（B2 对照仍 `1`）；`Login_Flow→dev-login-flow hostReject=false` |
| A-1 宿主硬契约未集中 | P2 | 已修复 | `grep -c 'HOST_MEMBER_NAME' src/host/config.ts` | `3`（`config.ts:78` 正则、`:81` MAX=48；`dispatch.ts:111` 使用；`test/dispatch.test.ts:374/393` 两个套件） |

修复命中数对比：N2 修复点在 `dispatch.ts` 的 `memberNameFor`，A-1 守卫在 `config.ts` + 单测——与本轮新缺陷同一函数（`memberNameFor`），说明**上轮修复的扫描范围只到「合法性」为止**，唯一性是相邻但未覆盖的类；不是修复回退。

## 5. 缺陷表（仅本轮仍开放项）

| 编号 | 严重级(P0/P1/P2/P3) | 功能模块 | 复现步骤 | 期望行为 | 实际行为 | 关联验收项 | 检测命令 | 通过判据 |
|---|---|---|---|---|---|---|---|---|
| R2-1 | P2 | 编排／成员身份（`src/host/team/dispatch.ts`） | 用 `auto_team_plan` 提交两个同角色、id 为中文（或仅大小写/分隔符不同）的任务，再 `auto_team_dispatch` | 每个任务得到**可区分且唯一**的成员名（如 `dev-登录流程`→`dev-login-flow`／带序号后缀），两个就绪任务都建出成员 | `memberNameFor` 归一后两个任务都得 `dev`（`Login_Flow`/`login-flow` 都得 `dev-login-flow`）；`dispatchReady` 无去重，第二个任务在宿主重名时永久 `pending`，成员名也无法标识任务（AC-16 消息 `to`、AC-17 按名重绑均歧义） | AC-15 AC-16 AC-17 | `node logs/teamflow/tf-mvv49icd-0axwfe/scripts/qa-collision-probe.mjs` | exit 0，输出 `QA COLLISION PROBE RESULT: 5/5 passed`（C2/C3/C4/C5 全 PASS），且 `qa-reverify-probe.mjs` 仍 9/9、`pnpm -s test` 仍 0 fail |

## 6. 交付形态契约（11 条逐条判定，均实跑）

| # | 判据 | 结果 |
|---|---|---|
| 1 | 宿主半 profile 层加载入口 + `cordis.patch.yml` `insert` 用**包根名** | PASS：`cordis.patch.yml` insert.name = `dsh-auto-team` = package name（`check-t1-contract` 断言同值） |
| 2 | client 半 bundle 声明字段集合与同仓样本逐字段一致、产物含包 id | PASS：`check-client-bundle.mjs` exit 0（manifest.id=`dsh-auto-team`） |
| 3 | UI 挂载 `inject('<slot>')` 与 `register.name` **逐字相同**，插件名进 `id` | PASS：`conversation.composer.dock`(id `dsh-auto-team-toggle`) / `sidebar.right.pane.tab`(id `dsh-auto-team-panel`)，反向注入改坏即红（上轮已验） |
| 4 | 入口声明与产物进 `files` 白名单 | PASS：`npm pack --dry-run` 含 `lib/index.js` / `lib/client.js` / `cordis.patch.yml` |
| 5 | 无 `workspace:` 协议 | PASS：`grep -c 'workspace:' package.json` = 0 |
| 6 | 宿主运行期依赖走 peer/可选 peer | PASS：`@deepseek-ai/*` 全在 `peerDependencies` + `peerDependenciesMeta.optional` |
| 7 | 产物与源码同步（mtime / 特征串） | PASS：`lib` 04:32 晚于全部 `src/`；产物含当前源码特征串 |
| 8 | 两产物顶层装载不抛错 | PASS：两条 `node --input-type=module -e "await import(...)"` exit 0 |
| 9 | 能被 profile 真实装入并被宿主加载 | **未验（环境）**：需主 agent 在 profile 执行安装 + 重启宿主 → §10 第 1 项 |
| 10 | 安装带回滚步骤 | PASS（文档层）：PRD 给出 `pnpm add file:` 正向 + `pnpm remove` + 从 `dsh.profile.bundles` 摘除的反向步骤；真机执行属 §10 |
| 11 | 安装由主 agent 执行，PRD 给出本机可照做三步 | PASS（文档层）：命令/重启/GUI 检查三步齐备；执行属 §10 |

## 7. 架构检查结论（蓝图符合性）

- **蓝图 29 个文件全部存在**（`src/shared/{types,const}.ts`、`src/host/*` 16 个含 `team/`、`gate/`、`memory/`、`roles/`、`src/client/*` 11 个含 `tabs/` = 共 29），无缺失、无越界新建。
- **依赖方向铁律**：`grep -rn "from '\.\./host/" src/client` = 0；跨半常量统一走 `src/shared/const.ts`（`PLUGIN_ID` 双产物逐字一致）。
- **无重复实现**：三类「只允许一处」的映射/解包均守住——宿主 4 态→本项目 7 态映射只在 watcher 的 `normalizeHostStatus`；`{data,error}` 解包只在 `src/client/api.ts`；记忆读/写/删三路径共用 `safeMemoryName`（`check-memory-subsystem` 三路径逃逸断言均拒绝）。
- **抽象已抽取**：`viewmodel.ts` 纯函数（上轮长在 JSX 里的文案映射已迁出，25 例单测）、`adapters.ts` 是唯一接触宿主 API 的文件、门禁 `runGate` 异步 + 注入 `GateExec`（不再 `spawnSync` 阻塞 300s）。
- **偏差（均为现网约束，非缺陷）**：① 记忆/角色 repo 保持**同步**返回值而非蓝图的 `Promise<Result<T>>`——唯一调用方 `bridge.ts` 与脚手架全部按同步消费，改签名会连带改动并行在写文件；② `GATE_FAILED` 用窄化常量补充（10 码表未收录但技术方案 §5.3 要求）；③ `MessageRecord.from` 取 `string`（`bridge.recordOf` 入参即 string）。三处均不改变契约语义。
- 本轮新增的架构向观察：`memberNameFor` 同时承担「字符集归一」与「任务身份编码」两个职责，后者被前者吃掉（见 §5 R2-1）——建议修复时把身份段改为**先编码再归一**（保序映射或追加短序号），避免继续在同一个正则上叠补丁。

## 8. 接口一致性静态核查（0a，无需运行时）

- 命令：逐个 `grep -rqE "export (async )?(function|const|class) <sym>|export \{[^}]*<sym>|" src/`，符号集取蓝图 `api` 字段 + 技术方案导出表共 **52 个**（`createBridge` `buildToolSpecs` `buildHttpRoutes` `registerHttpBridge` `preflightRoutes` `auditRoute` `routeDrift` `runGate` `defaultGateExec` `tailOf` `resolveConcurrencyLimit` `registerEffect` `registerAgentCreated` `spawnMember` `registerTool` `registerPromptSection` `registerHttpRoutes` `resolveCaller` `memberNameFor` `dispatchReady` `resumeRun` `applyReceipt` `reconcileMembers` `createMemberWatcher` `safeMemoryName` `readMemory` `writeMemory` `deleteMemory` `appendMemoryLines` `formatSourcedLine` `listMemory` `selectMemory` `createRoleRepo` `normalizeModel` `createPanelStore` `panelStoreFor` `usePanelState` `sessionIdOf` `createPanelApi` `capsuleOf` `statusBadge` `formatModelRoute` `tailLines` `formatClock` `captainSection` `registerCaptainPrompt` `wrapLegacy` `makeRunId` `makeMessage` `appendMessage` `messageForTask` `listHostMembers`）。
- 结果：**缺失导出 0**；调用形状（参数/返回值）由 `pnpm -s typecheck` exit 0 全量覆盖——TS 编译器逐调用点校验签名，比人工 grep 更强，故无需另写运行时探针。
- 蓝图 `api` 字段核对：`bridge.act` 11 动作 == `PanelAction` 11 项 == `check-t1-contract` 断言集合（8/8 含「`grep -c 'auto_team_' src/host/tools.ts`=5 行是**行数**不是工具数，工具数 7 由 e2e `tools:7` 证明，非回归）。

## 9. commit 卫生探针

- `git status --porcelain --untracked-files=all` 共 **63** 项，逐项扫依赖/构建/缓存/密钥类关键字（`node_modules|\.pnpm|__pycache__|\.cache|\.idea|\.DS_Store|\.env$|\.log$|/dist/`）→ **0 命中**。
- `.gitignore` 覆盖 `node_modules/ *.tsbuildinfo coverage/ dist/ .DS_Store .auto-team/ logs/teamflow/`；`lib/` **故意不忽略**（profile 安装源，AC-4/AC-7），与 `AGENTS.md §4` 一致——不是漏忽略。
- 结论：无 P1 版本控制缺陷；63 项即本次交付本体，待收口提交。

## 10. 工艺观察（P3，**只观察不阻塞**）

| 编号 | 位置 | 观察 |
|---|---|---|
| P3-1 | `src/client/tabs/RolesTab.tsx` | 角色表单与行操作仍无 `aria-*`（该文件 `aria-` 0 处，仅 2 处 `role="status"`；对照 Toggle 7 / MemoryTab 7 / Panel 4 / MembersTab 4 / PlanTab 2），键盘与读屏语义弱于其他页签 |
| P3-2 | dock 开关行（`Toggle.tsx`） | 空闲态 5 档 tone 文案齐全，但关闭/未配置态仅靠配色区分，缺图标冗余 |
| P3-3 | 面板四页签 | 空态/加载/失败文案齐备（`Toggle.tsx:89`、`Panel.tsx:137` 有 `role="alert"`），`styles.ts` 11 处 hover/focus-visible/disabled 反馈；失败态仅一行文字，无「重试」入口 |

## 11. 人工补测清单（环境限制，**非交付缺陷**）

| # | 项 | 方法 | 工具 |
|---|---|---|---|
| 1 | 真机 profile 安装 + 重启后插件加载（形态契约 9/10/11） | `cd ~/.dsh/profiles/desktop && pnpm add file:<repo>` → 登记 `dsh.profile.bundles` → 重启宿主 → 启动日志出现 `[auto-team] 已装配`；失败先 `pnpm remove dsh-auto-team` 并从 bundles 摘除 | 主 agent 终端（子代理权限被钉死在workspace，装不了） |
| 2 | GUI 可见性：输入框下方开关行、右栏面板四页签 | 开关默认关 → 打开 → 面板出现；两挂载面状态同步（同一 store） | 人在 GUI 目视 |
| 3 | AC-22 真机 per-role 模型落地 | 给角色指定 provider/model → 派发 → 面板成员行显示「已核对」且实际模型与声明一致；漂移时显示「未下发」并拒绝派发 | 真机 + 宿主日志 |
| 4 | 宿主真实**重名成员**行为（R2-1 后果面） | 用两个中文 id 任务派发，观察宿主是拒绝建人还是自动改名 | 真机 |
| 5 | 视觉观感（遮挡/动画/字号层级） | 人工目视 | 人眼 / 截图 |

## 12. 最终结论

- 上一轮 3 个 P2 **全部闭合**（复验命令逐条转绿，e2e 旁证 `audits` 0→2）。
- 本轮新增 **1 个 P2 开放**（R2-1 成员名唯一性，命令当前红），按 §5 的检测命令修复后复跑即可回归；修复时须同时保持 `qa-reverify-probe.mjs` 9/9、`pnpm -s test` 0 fail（B1/B2 与新用例不得互相打断）。
- 判定：**不可验收**（待 R2-1 修复 + §11 第 1~3 项真机补测完成）。
