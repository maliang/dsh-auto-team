# QA 报告 — README 逐条实跑（r13-readme-refresh）

- 报告人：qa（t1）
- 报告时间：2026-11-04 09:35（Asia/Shanghai）
- 被验对象：`/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team/README.md`（162 行，工作区已改、未提交）；同任务夹 `FACTS.md`（130 行）作为数字来源表一并核对
- 代码基线：分支 `feat/auto-team-plugin`，HEAD `cd2bb61adc686e8e20bd2d9e39d427f41aadba9a`
  - **命令类断言实跑时**（2026-11-04 09:24–09:26）：`git status --porcelain` 只有 `M README.md` 与 `?? docs/teamflow/20261103-r13-readme-refresh/`，`src/` 干净
  - 09:30–09:33 有**外部会话/进程**（非本团队）改动 `src/host/adapters.ts`、`test/host-contract.test.ts`；09:34 两文件已回退到 HEAD，09:35 最终复跑恢复 668/0（见 §7）
- 环境：`node v26.11.1`、`pnpm 10.34.7`、npm 默认 cache `/Users/maliang/.npm`、macOS 本机
- 判定口径：`通过`＝实测与 README 逐字/数值一致；`不符`＝实测不同或前提不成立；`无法验证`＝本会话权限/环境拿不到证据（写明缺什么）
- 所有命令都用**绝对路径**在仓库根执行（门禁 cwd 在宿主启动目录，不用相对路径）；证据日志在 `/tmp/qa-*.log`

## 1. 门禁命令断言（README「开发与验证」节）

| # | README 断言原文 | 实跑命令 | 实测输出 / 退出码 | 判定 |
| --- | --- | --- | --- | --- |
| 1.1 | `pnpm typecheck` → exit 0 | `cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team && pnpm typecheck` | `TYPECHECK_EXIT=0`；日志仅 115 字节的 pnpm 头 + `tsc --noEmit`，**无任何 tsc 报错行** | **通过** |
| 1.2 | `pnpm test` → **668 通过 / 0 失败**，exit 0 | `cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team && pnpm test` | `TEST_EXIT=0`；`ℹ tests 668` / `ℹ pass 668` / `ℹ fail 0` / `duration_ms 4288.899917` | **通过** |
| 1.3 | `pnpm build` → exit 0，`lib/index.js` 438.38 kB、`lib/client.js` 353.96 kB | `cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team && pnpm build` | `BUILD_EXIT=0`；`lib/client.js 353.96 kB │ gzip: 84.99 kB`、`lib/index.js 438.38 kB │ gzip: 147.33 kB`；落盘字节 `353964` / `438381`（÷1000 逐字对上） | **通过** |
| 1.4 | 宿主产物可加载 `node --input-type=module -e "await import('./lib/index.js')"` | 同左（在仓库根执行） | `HOST_IMPORT_EXIT=0`，输出 0 字节 | **通过** |
| 1.5 | client 产物可加载 `node --input-type=module -e "await import('./lib/client.js')"` | 同左（在仓库根执行） | `CLIENT_IMPORT_EXIT=0`，输出 0 字节 | **通过** |
| 1.6 | `npm pack --dry-run` → **5 个文件 / 233.4 kB** | `cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team && npm pack --dry-run --cache /tmp/npm-cache-qa` | `PACK_EXIT=0`；`total files: 5` ✅；**`package size: 238.2 kB`**（不是 233.4 kB）❌ | **不符（体积）** |
| 1.7 | （README 未写退出码，只写「233.4 kB / 5 个文件」） | 旧 README 对照：临时目录只放 `package.json`、`cordis.patch.yml`、`lib/` 与 `git show HEAD:README.md`（2089 B），再 `npm pack --dry-run` | `OLD_README_PACK_EXIT=0`；`README.md 2.1kB`、**`package size: 233.4 kB`**、`total files: 5` | 证明 233.4 kB 是**重写前**的旧 README 数字，不是当前文档 |
| 1.8 | 故障表：默认 `npm pack` 报 `EPERM …/.npm/_cacache`，原因是「本机 `~/.npm` 缓存是 root 所有」 | `cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team && npm pack --dry-run` | `DEFAULT_PACK_EXIT=255`；`npm error code EPERM`、`npm error path /Users/maliang/.npm/_cacache/tmp/***`、`Your cache folder contains root-owned files` | 现象可复现，**原因判定不符**（见 1.10、D2） |
| 1.9 | 同上 | `HOME=/tmp/qa-npm-home npm pack --dry-run`（cache 可写） | `PACK_WITH_WRITABLE_HOME_EXIT=0`；`package size: 238.2 kB`、`total files: 5` | 证明 npm 本身正常；EPERM 只取决于 cache 目录**是否可写**，与 root 所有权无关 |
| 1.10 | 同上 | `find ~/.npm -user root`；`stat -f '%Su:%Sg %Sp' ~/.npm ~/.npm/_cacache ~/.npm/_cacache/tmp`；`touch /Users/maliang/.npm/_cacache/qa-sandbox-probe` | `ROOT_COUNT=0`；三处均 `maliang:staff drwxr-xr-x`；touch 返回 `Operation not permitted`（本会话 workspace-write 沙箱拒绝写工作区外目录） | **不符**：无任何 root 所有文件，EPERM 来自运行环境写权限 |

## 2. 数字断言（README 正文与「实测基线」）

| # | README 断言 | 实跑命令 | 实测 | 判定 |
| --- | --- | --- | --- | --- |
| 2.1 | 包名/版本 `dsh-auto-team@0.1.0` | `node -e "const p=require('/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team/package.json');console.log(p.name,p.version)"` | `dsh-auto-team 0.1.0` | **通过** |
| 2.2 | Node `>=22.18`；DSH `>=0.2.1-alpha.2 <0.3.0` | 读 `/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team/package.json` 的 `engines` | `{ node: '>=22.18', dsh: '>=0.2.1-alpha.2 <0.3.0' }`；运行环境 `v26.11.1` 满足 | **通过** |
| 2.3 | `pnpm test` **668** 通过 / 0 失败 | 见 1.2 | `tests 668` / `pass 668` / `fail 0` | **通过** |
| 2.4 | `lib/index.js` **438.38 kB**、`lib/client.js` **353.96 kB** | 见 1.3 | `438.38 kB` / `353.96 kB`（字节 438381 / 353964） | **通过** |
| 2.5 | pack **5 个文件** | 见 1.6 | `total files: 5` | **通过** |
| 2.6 | pack **233.4 kB** | 见 1.6 | `package size: 238.2 kB` | **不符**（当前 README 13.1 kB；旧 README 2.1 kB 时才 233.4 kB，见 1.7） |
| 2.7 | 内置角色 **11** 个 | `cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team && node --input-type=module -e "const m=await import('./src/host/roles/builtin.ts');console.log(m.BUILTIN_ROLES.length,m.BUILTIN_ROLES.map(r=>r.id).join(','))"` | `11`：`pm,architect,dev,qa,docs,reviewer,frontend,backend,designer,devops,security` | **通过** |
| 2.8 | 内置技能 **12** 个 | 同上 `.BUILTIN_SKILLS` | `12`：`prd-writing,architecture,implementation,testing,docs,review,frontend-ui,backend-api,ui-ux-design,devops-release,security-audit,data-modeling` | **通过** |
| 2.9 | 队长可用 **8** 个工具 | `grep -c 'name: `${TOOL_PREFIX}' src/host/tools.ts` | `8`（行号 205/278/327/362/396/437/530/596：plan/dispatch/status/message/receipt/memory/role/add_tasks） | **通过** |
| 2.10 | 面板三页（任务/历史/记忆） | `grep -c "key: '" src/client/Panel.tsx`；`grep -n 'export const TABS' src/client/Panel.tsx` | `3`；`TABS` 在 `src/client/Panel.tsx:81`，条目 `tasks/history/memory` 在 82–84 | **通过** |
| 2.11 | 6 个可配参数与合法域/默认值：并发 1..8 默认 3、记忆预算 200..4000、停滞 1s..600s 默认 90s、返工 1..10、门禁超时 1s..600s 默认 300s、队长模型 | `grep -n -A8 'SETTINGS_LIMITS' src/host/config.ts`；`grep -n -A8 'DEFAULT_SETTINGS' src/host/config.ts` | `:25 DEFAULT_MAX_CONCURRENT = 3`、`:28 MAX_CONCURRENT_LIMIT = 8`、`:31 MEMORY_INJECT_BUDGET = 4000`、`:62 STALL_MS = 90_000`、`:68 MAX_ATTEMPTS = 3`、`:40 GATE_TIMEOUT_MS = 300_000`；`SETTINGS_LIMITS`（:179-185）＝`[1,8] [200,4000] [1000,600000] [1,10] [1000,600000]`；`DEFAULT_SETTINGS`（:166-172）另有 `captainModel`，共 6 项 | **通过** |
| 2.12 | 门禁默认超时 **300000ms**、证据保留**末 4000 字符** | `grep -n 'GATE_TIMEOUT_MS\|GATE_TAIL_CHARS' src/host/config.ts` | `:37 GATE_TAIL_CHARS = 4000`、`:40 GATE_TIMEOUT_MS = 300_000`；`gate.ts` 里 `tail = (tail + chunk).slice(-GATE_TAIL_CHARS)` | **通过** |
| 2.13 | **5 类**不可逆动作（`cancel`/`cancelTask`/`skipTask`/`updateAcceptance`/`forceParallel`） | `sed -n '32,40p' /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team/src/host/team/confirm.ts` | `IRREVERSIBLE_ACTIONS` 恰为这 5 个；执行仍回 `bridge.executeAction` | **通过** |
| 2.14 | 安装节 `grep -n '"dsh-auto-team"' package.json` **期望 2 行** | `cd ~/.dsh/profiles/desktop && grep -n '"dsh-auto-team"' package.json` | `7: "dsh-auto-team": "file:/Users/.../dsh-auto-team"`、`30: "dsh-auto-team"`（`dsh.profile.bundles` 内） | **通过** |
| 2.15 | `dsh` 不在 PATH | `command -v dsh` | 无输出，`exit 1` | **通过** |
| 2.16 | （FACTS 引用，README 未复述）HTTP 路由 4 条 / PanelAction 21 种 / PlanStatus 5 / TaskStatus 13 / RejectionCode 13 去重 | `grep -c 'path: `${BRIDGE_ROUTE}' src/host/http.ts`；`sed -n '854,918p' src/shared/types.ts \| grep -cE "^\s+\| \{ type: "`；各状态联合类型计数 | `4`（38/48/60/79）；`21`；`5`；`13`；`13` | **通过**（FACTS 侧） |

## 3. 源码行号引用（README 逐字引用 + 组长点名的 3 处）

| # | README 引用 | 实跑命令 | 命中行实际内容 | 判定 |
| --- | --- | --- | --- | --- |
| 3.1 | `src/client/slots.ts:41` | `grep -n 'export const INPUT_LEFT_SLOT' src/client/slots.ts` | `41:export const INPUT_LEFT_SLOT = 'conversation.input.left'` | **通过** |
| 3.2 | `src/client/slots.ts:44` | `grep -n 'export const HEADER_ACTIONS_SLOT' src/client/slots.ts` | `44:export const HEADER_ACTIONS_SLOT = 'conversation.session.header.actions'` | **通过** |
| 3.3 | `src/client/slots.ts:441,449` | `grep -n 'export const PANELLIST_SLOT\|export const MAIN_SLOT' src/client/slots.ts` | `441: PANELLIST_SLOT = 'sidebar.panellist'`；`449: MAIN_SLOT = 'main'` | **通过** |
| 3.4 | `src/host/roles/builtin.ts:230`（`BUILTIN_ROLES`） | `grep -n 'export const BUILTIN_ROLES' src/host/roles/builtin.ts` | `230:export const BUILTIN_ROLES: Role[] = [` | **通过** |
| 3.5 | `src/host/roles/builtin.ts:22`（`BUILTIN_SKILLS`） | `grep -n 'export const BUILTIN_SKILLS' src/host/roles/builtin.ts` | `22:export const BUILTIN_SKILLS: BuiltinSkill[] = [` | **通过** |
| 3.6 | `src/host/index.ts:102`（`options?.workspace ?? process.cwd()`） | `grep -n 'const workspace = options?.workspace' src/host/index.ts` | `102:  const workspace = options?.workspace ?? process.cwd()` | **通过** |
| 3.7 | 组长点名 `src/host/index.ts:405`（门禁 cwd） | `grep -n 'gate: { cwd: workspace' src/host/index.ts` | `405:    gate: { cwd: workspace, artifactsDir },` | **通过** |
| 3.8 | 组长点名 `src/host/gate/gate.ts:135` | `grep -n 'spawn(command' src/host/gate/gate.ts` | `135:    const child = spawn(command, { cwd: opts.cwd, shell: true })` | **通过** |
| 3.9 | `src/client/Panel.tsx:78`（「`TABS` 单源」） | `grep -n 'export type TabKey\|export const TABS' src/client/Panel.tsx` | `78:export type TabKey = 'tasks' \| 'history' \| 'memory'`；`TABS` 数组在 **81**，条目 82–84 | **通过（可优化）**：78 是 key 联合类型，`TABS` 本体在 81；建议写 `78-84` 或 `81`，语义不漂 |

## 4. 契约 / 语义断言（README 能力表、门禁、工具表、数据落点）

| # | README 断言 | 证据（命令 / 源码行） | 判定 |
| --- | --- | --- | --- |
| 4.1 | 未启用时 8 个工具返回**同一句**：`自动团队未启用：请在输入框内的「自动团队」选项处启用后再试。` | `grep -n 'NOT_ENABLED' src/host/tools.ts` → `:54` 为该逐字串，8 个 handler 各判一次（227/288/332/375/409/458/561/618）；**运行时**调用 `auto_team_status` 实得同一条（含「后再试。」） | **通过** |
| 4.2 | 开关在输入框**左侧** `conversation.input.left`（不是 dock）；默认关；只改开关不起人 | `src/client/Option.tsx:2`、`src/client/index.ts:9`；`grep -rn 'composer.dock' src` = **0**；`src/host/bridge.ts:11` 注释「toggle → 只改开关并落盘，**绝不派发**」；`:930 enabled: flags[sessionId]?.enabled === true`（缺省 false） | **通过** |
| 4.3 | 计划落盘后自动派发，无独立开关；四道闸都在 `dispatchReady` | `src/host/team/auto-dispatch.ts:1-3`；`src/host/team/dispatch.ts:338 dispatchReady`（并发/依赖/写域/暂停） | **通过** |
| 4.4 | `auto_team_dispatch` **必须带 runId**，缺了直接拒绝 | `src/host/tools.ts:283-285 required:['runId']`；`:295` 拒绝文案 | **通过** |
| 4.5 | 门禁执行目录＝装配 workspace（真机＝宿主启动 cwd）；相对路径会静默 `exit 1`；本轮 t1 就是这样假红 | `src/host/index.ts:102`；真机日志 `~/.dsh/profiles/desktop/.auto-team/artifacts/t1.log` 内容：原始相对路径命令 + `# exit: 1`，命令回显后**无任何输出** | **通过** |
| 4.6 | 门禁日志 `<workspace>/.auto-team/artifacts/<taskId>.log` | `src/host/gate/gate.ts:74 join(deps.artifactsDir, `${safeFileName(task.id)}.log`)`；`src/host/index.ts:155 projectArtifactsDir(workspace)` | **通过** |
| 4.7 | 写域：只有 `running`/`gate` 占用；冲突＝相等或**目录边界前缀**（`src/host` 与 `src/hostile.ts` 不冲突）；等待者有释放通知 | `src/host/team/scope-locks.ts:27 HOLDER_STATUSES`；`src/host/plan/scope.ts` 边界判定；`test/scope.test.ts:96-105` 反例；`scope-locks.ts:138-142 releaseMessageBody`、`:157-192 releaseScopes`（幂等 `rel-<holder>-<waiter>-<seq>`） | **通过** |
| 4.8 | 失败转 rework、下游 blocked、证据回发同一成员 | `src/host/bridge.ts:1617 verdict = outcome.ok ? 'done' : 'rework'`；`:1632-1640` 组装 `门禁未通过（退出码 …）：请按以下证据返工\n…` 并 `sendMessage(binding.memberId, text)`；`src/host/plan/graph.ts:104-125` 未满足依赖留在 blocked | **通过** |
| 4.9 | 数据落点表（runs/sessions/settings/roles/skills/memory/public/artifacts/deviations） | `src/host/paths.ts:8/13/18/23/43/53/58/63/68`；`src/host/bridge.ts:409 sessions.json`；真机 `~/.dsh/auto-team/sessions.json` 存在 | **通过** |
| 4.10 | 面板「记忆」页只列项目记忆，公共记忆在左栏「全局」 | `src/client/tabs/MemoryTab.tsx:4-6,96,110` | **通过** |
| 4.11 | 面板里没有「派发」按钮；角色页已从面板移除 | `src/client/tabs/TasksTab.tsx:9-11`；`TABS` 仅 3 项（tasks/history/memory），设置页才有 `RoleEditorList`（`src/client/SettingsPage.tsx:20`） | **通过** |
| 4.12 | 内置角色可改不可删；技能来源 4 种、可恢复出厂 | `src/host/roles/repo.ts:189-192`「内置角色不可删除」；`src/shared/types.ts:182 SkillSource = 'builtin'\|'imported'\|'system'\|'manual'`；`src/host/roles/skills-repo.ts:69 restoreBuiltin` | **通过** |
| 4.13 | host 与 client 零直接 import；本地 import 必须带 `.ts`；`lib/` 必须入库 | `grep -rn "from '.*host/" src/client` / `"from '.*client/" src/host` 均 0；本地 import 缺 `.ts/.tsx/.json` 的 = **0**；`git ls-files lib` → `lib/client.js`、`lib/index.js` | **通过** |
| 4.14 | 宿主 API 只许出现在 `src/host/adapters.ts` | `grep -rln 'ctx\.\(get\|inject\|effect\|slots\)' src/host` → `adapters.ts`、`index.ts`；`index.ts` 仅 3 处 `ctx.logger`（316/654/658，装配日志），其余宿主访问面在 adapters | **轻微不符（措辞）**：装配入口仍碰 `ctx.logger`，见 D5 |
| 4.15 | token 展示「取不到时显式不可得（`source: unavailable`），**不用字数估算补位**」 | 任务/运行用量确实如此（`src/client/tabs/rows.ts:7,39,86`）；但**记忆页**的 token 恰是 `ceil(字符数/2)` 估算：`src/host/format.ts:123 memoryTokenEstimate`、`src/client/tabs/MemoryTab.tsx:9,110`、`src/client/viewmodel.ts:1217`（`≈` + `tokenBasis:'estimate'`） | **不符（范围未限定）**，见 D4 |
| 4.16 | 安装：profile 已有依赖与 bundles；回滚后 grep 应为 0 | 安装态见 2.14；回滚 `pnpm remove dsh-auto-team` 会改 `~/.dsh/profiles/desktop`，本会话**不执行** | 安装态部分**通过**；回滚**无法验证** |
| 4.17 | 安装生效三步（重启宿主 / GUI 出现 4 个入口 / `auto_team_status` 返回快照） | 无 GUI 控制、无宿主重启权限；`auto_team_status` 在本子会话返回未启用（只验证了错误路径） | **无法验证** |

## 5. 缺陷清单（症状 / 根因 / 复验命令）

### D1（P1，必须修）pack 体积基线过期：233.4 kB → 238.2 kB
- **症状**：README「实测基线」写 `npm pack --dry-run` → 5 个文件 / 233.4 kB；实跑为 5 个文件 / **238.2 kB**。
- **根因**：233.4 kB 是重写前旧 README（2089 B）的测量值；当前 README 13067 B，tarball 内 `README.md 13.1kB`，净增约 4.8 kB。FACTS.md 第 23 行同样写着 `README.md 2.1kB` / `233.4 kB`，是同一份过期取证。
- **复验命令**：
  - `cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team && npm pack --dry-run --cache /tmp/npm-cache-qa | grep -E 'package size|total files'` → `238.2 kB` / `5`
  - 旧值对照：临时目录放 `git show HEAD:README.md` + 当前 `lib/`、`package.json`、`cordis.patch.yml` 再 pack → `233.4 kB`
- **建议修改**：README `233.4 kB` → `238.2 kB`；FACTS「README.md 2.1kB / 233.4 kB」同步改为「13.1kB / 238.2 kB」。

### D2（P1，必须修）默认 `npm pack` 的 EPERM 归因错误
- **症状**：故障表写「本机 `~/.npm` 缓存是 root 所有」，并建议 `sudo chown -R 501:20 ~/.npm`；实测 `find ~/.npm -user root` = **0 条**，`~/.npm`、`_cacache`、`tmp` 全部 `maliang:staff`。
- **根因**：EPERM 来自**运行环境不可写 `~/.npm`**（本会话的 workspace-write 沙箱；`touch ~/.npm/_cacache/qa-sandbox-probe` 同样 `Operation not permitted`），npm 只是打印了它内置的「root-owned files」提示。把 cache 指到可写目录后默认命令即 `exit 0`。
- **复验命令**：
  - `find ~/.npm -user root | wc -l` → `0`
  - `stat -f '%Su:%Sg %Sp %N' ~/.npm ~/.npm/_cacache ~/.npm/_cacache/tmp` → 均 `maliang:staff`
  - `HOME=/tmp/qa-npm-home npm pack --dry-run`（在仓库根）→ `exit 0`、`238.2 kB`、`5 files`
- **建议修改**：原因改为「运行环境（沙箱/容器/CI）无权写 `~/.npm` 时 npm 报 EPERM（其提示文案会误称 root-owned）」；删掉 `sudo chown`，保留 `--cache <可写目录>`。

### D3（P1，必须修）「CI 首步会红」不成立
- **症状**：已知限制写「本机 `npm pack` 的默认缓存权限问题…不影响入库判断，但 **CI 首步会红**」。
- **根因**：`.github/workflows/ci.yml` 里 `npm pack --dry-run` 是**最后一步**，且 runner 是 `ubuntu-latest` 每次全新 cache；「首步」也不是它（首步是 checkout / pnpm install）。本机 root-owned 前提本身已不成立（D2）。
- **复验命令**：`sed -n '1,40p' /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team/.github/workflows/ci.yml`（可见步骤顺序与 `runs-on: ubuntu-latest`）。
- **建议修改**：删除该句，或改成「CI 在干净 runner 上不受本机 cache 权限影响」。

### D4（P2，建议修）token「不用字数估算补位」与记忆页实现冲突
- **症状**：已知限制写「token 展示…取不到时显式不可得（`source: unavailable`），**不用字数估算补位**」；记忆页 token 恰恰是按字符数估算，并显示 `≈`。
- **根因**：该结论只对任务/运行用量成立（`src/client/tabs/rows.ts:7,39,86`）；记忆页是 `ceil(字符数/2)` 估算（`src/host/format.ts:123`、`src/client/tabs/MemoryTab.tsx:9,110`、`src/client/viewmodel.ts:1217`），且明确标 `tokenBasis:'estimate'`。
- **复验命令**：`grep -n 'estim\|≈' /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team/src/client/tabs/MemoryTab.tsx`；`grep -n memoryTokenEstimate /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team/src/host/format.ts`。
- **建议修改**：把主语限定为「任务/运行用量」，或补一句「记忆页 token 为按字符数估算并标 `≈`，不冒充 provider 上报值」。

### D5（P3，建议修）「宿主 API 只许出现在 adapters.ts」与 `index.ts` 的 3 处 `ctx.logger` 冲突
- **症状**：README「不要绕过这几条」写宿主 API 只许出现在 `src/host/adapters.ts`。
- **根因**：`src/host/index.ts` 的装配入口仍直接 `ctx.logger`（316、654、658）；工具/路由/槽位等宿主服务访问确实都收在 adapters。
- **复验命令**：`grep -n 'ctx\.' /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team/src/host/index.ts`。
- **建议修改**：改成「宿主服务访问集中在 adapters.ts；装配入口仅允许 `ctx.logger` 兜底日志」。

### D6（P3，可选）`Panel.tsx:78` 指向 `TabKey` 而非 `TABS`
- **症状**：README 写「`src/client/Panel.tsx:78`，`TABS` 单源」；78 行是 `TabKey` 联合类型，`TABS` 数组在 81–84。
- **根因**：行号只差 3 行、语义仍指向同一单源，但按「行号必须可跳转」的标准不够精确。
- **复验命令**：`grep -n 'export type TabKey\|export const TABS' /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team/src/client/Panel.tsx`。
- **建议修改**：写 `78-84`（或 `81`）。

### D7（同步项）FACTS.md 同源过期
- 第 20 行 `lib/client.js 353.96 kB`、`lib/index.js 438.38 kB` 与实测一致；第 23 行 `README.md 2.1kB` / `233.4 kB` 过期；第 24 行 root-owned 归因错误（同 D2）。本任务不改 FACTS，留给后续 docs 同步。

## 6. 评审结论：可接受 / 建议修改

| 类别 | 可接受 | 建议修改 |
| --- | --- | --- |
| 门禁命令 | typecheck / test / build / 两条 import 全部 exit 0，数字逐字对上 | pack 体积、EPERM 归因、CI 断言 |
| 数字断言 | 668、438.38/353.96、5 files、11 角色、12 技能、8 工具、3 页、6 参数与范围/默认值、300000ms/4000 字符、5 类不可逆、安装 2 行 | 233.4 kB |
| 行号引用 | slots 41/44/441/449、builtin 22/230、index 102/405、gate 135 全部命中 | Panel 78 → 81（可选） |
| 契约语义 | 未启用文案、开关默认关、自动派发、runId 强制、门禁 cwd、artifacts、写域边界/释放通知、rework 回发、数据落点、记忆页范围、无派发按钮、内置角色不可删、零跨半 import、`lib/` 入库 | token 措辞、宿主 API 措辞 |
| 未验证项 | README 已主动标注的 U2/真机视觉 | 安装生效与回滚需真机 |

## 7. 环境说明与风险项：外部并发改动（与 README 无关）

本会话的工作区与其它会话/进程共享，实跑期间发生过一次**外部改动**（不是本团队：本团队只有 qa 一名成员在跑，docs 已结束，lead 未动源码）：

- **09:30–09:33**：外部会话/进程修改 `src/host/adapters.ts`（新增 `subscribeHostEvent` / `HostContext.root` / `{ global: true }` 订阅，mtime 09:33）与 `test/host-contract.test.ts`（mtime 09:33）。
- **09:31 在该窗口复跑** `pnpm test` → `tests 668 / pass 665 / fail 3`，三条失败：
  - `test/adapters.test.ts:408`：`onMemberProgress：宿主没有 ctx.on 时 warn + 返回空 stop`（期望 warn 1 次，实得 0）
  - `test/adapters.test.ts:588`：`registerToolGuard：订阅 tools/execute 本身失败也不抛错`（期望日志含 `/订阅失败/`，实得空串）
  - `test/host-contract.test.ts:160`：`ctx.root 未在 inject 中登记（出现于 src/host/adapters.ts:243,1315,1461）`
- **判定：与 README 无关，由外部对 `adapters.ts` 的未完成改动导致。** README 的 668/0 基线对应 09:24–09:26 的 HEAD 源码状态（当时 `src/` 干净）。
- **09:34 复核**：两文件已回退（`git status --porcelain` 只剩 `M README.md`；`git hash-object src/host/adapters.ts` = `HEAD:src/host/adapters.ts` = `955a5d5d…`）。
- **09:35 最终复跑**（回退后）：`pnpm typecheck` exit 0；`pnpm test` → `tests 668 / pass 668 / fail 0`，exit 0。门禁可按基线执行。

风险提示：共享工作区里任何人再改 `src/` 都会让门禁漂移；跑 t1 门前建议先 `git status --porcelain` 确认只有 `M README.md` + 本任务夹。

## 8. 总体判定

**不通过（需修补）**：

- README **需修补 3 处**（D1 pack 体积、D2 EPERM 归因、D3 CI 断言）——**均为文档事实/措辞，不涉及代码**；
- 建议修补 **2 处措辞**（D4 token 估算范围、D5 宿主 API 边界）；
- 可选行号优化 **1 处**（D6）；FACTS 同步 **1 项**（D7）。
- 其余命令、数字、行号与契约断言全部实跑通过；**3 条测试失败属外部并发改动**（§7），回退后最终复跑 668/0。
- 未验证项已在 §6 列明（安装生效、回滚、真机 UI、U2）。

**结论**：README 有 **3 处需修补（不涉及代码）** + 2 处建议措辞；修完 D1–D3 并同步 FACTS 后可复审。

## 9. 复现命令（全部绝对路径，可直接粘贴到宿主任意 cwd）

```bash
R=/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
cd "$R"
pnpm typecheck; echo "TYPECHECK_EXIT=$?"
pnpm test > /tmp/qa-test.log 2>&1; echo "TEST_EXIT=$?"; grep -E '^ℹ (tests|pass|fail)' /tmp/qa-test.log
pnpm build > /tmp/qa-build.log 2>&1; echo "BUILD_EXIT=$?"; grep -E 'lib/(index|client)\.js' /tmp/qa-build.log
node --input-type=module -e "await import('$R/lib/index.js')"; echo "HOST_IMPORT_EXIT=$?"
node --input-type=module -e "await import('$R/lib/client.js')"; echo "CLIENT_IMPORT_EXIT=$?"
npm pack --dry-run --cache /tmp/npm-cache-qa > /tmp/qa-pack.log 2>&1; echo "PACK_EXIT=$?"; grep -E 'package size|total files' /tmp/qa-pack.log
find ~/.npm -user root | wc -l
HOME=/tmp/qa-npm-home npm pack --dry-run > /tmp/qa-pack-home.log 2>&1; echo "PACK_WRITABLE_HOME_EXIT=$?"; grep -E 'package size|total files' /tmp/qa-pack-home.log
node --input-type=module -e "const m=await import('$R/src/host/roles/builtin.ts');console.log('roles',m.BUILTIN_ROLES.length,'skills',m.BUILTIN_SKILLS.length)"
grep -c 'name: `${TOOL_PREFIX}' "$R/src/host/tools.ts"
grep -n 'export const INPUT_LEFT_SLOT\|export const HEADER_ACTIONS_SLOT\|export const PANELLIST_SLOT\|export const MAIN_SLOT' "$R/src/client/slots.ts"
grep -n 'export type TabKey\|export const TABS' "$R/src/client/Panel.tsx"
grep -n 'export const BUILTIN_ROLES\|export const BUILTIN_SKILLS' "$R/src/host/roles/builtin.ts"
grep -n 'const workspace = options?.workspace\|gate: { cwd: workspace' "$R/src/host/index.ts"
grep -n 'spawn(command' "$R/src/host/gate/gate.ts"
cd ~/.dsh/profiles/desktop && grep -n '"dsh-auto-team"' package.json
```
