# FACTS — README 重写取证表（r13 / 2026-11-04）

本表是 `README.md` 里每个数字与命令的**唯一来源**。所有取证命令都在仓库根执行：

```bash
export REPO=/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team && cd "$REPO"
```

- 取证时间：基线数字 2026-11-04 09:15–09:26；`00d2b55` 复测 09:44（见 §9）
- 取证环境：`node v26.11.1`、`pnpm 10.34.7`、macOS 本机
- 代码基线：表内数字一律锚定 **`cd2bb61adc686e8e20bd2d9e39d427f41aadba9a`**（分支 `feat/auto-team-plugin`）；取证时工作区唯一改动就是被校验的 `README.md` 本身。仓库 HEAD 已前进到 **`00d2b55`**（宿主事件订阅改走 root），§9 是该 HEAD 的复测——所以本表的体积/用例数**只对 `cd2bb61` 负责**，要当前数请重跑 §7 / §9 的命令
- `DIRTY=1` 的含义：取证当时 `git status --porcelain | wc -l` = 1，只有被校验的 `M README.md`，**不是**代码未提交；本表落盘后再看会是 2（多出 `?? docs/teamflow/20261103-r13-readme-refresh/`）

## 1. 门禁命令取证（README「开发与验证」节）

| 事实 | 命令 | 实际输出 / 退出码 | 备注 |
| --- | --- | --- | --- |
| 类型检查通过 | `pnpm typecheck` | `tsc --noEmit` 无输出，`TYPECHECK_EXIT=0` | 用 `pnpm typecheck > /tmp/tc.log 2>&1; echo $?` 取真退出码，不能用 `tail` 之后的 `$?`（那是 tail 的） |
| 单测全绿 | `pnpm test` | `ℹ tests 668` / `ℹ pass 668` / `ℹ fail 0`，`TEST_EXIT=0`，`duration_ms 4269.75` | 单测直接跑 TS 源（`node --test test/*.test.ts`） |
| 双产物构建 | `pnpm build` | `BUILD_EXIT=0`；`lib/client.js 353.96 kB │ gzip: 84.99 kB`、`lib/index.js 438.38 kB │ gzip: 147.33 kB` | tsdown 双配置：client CJS 套壳、host ESM |
| 宿主产物可加载 | `node --input-type=module -e "await import('./lib/index.js')"` | `HOST_IMPORT_EXIT=0` | 无输出即通过 |
| client 产物可加载 | `node --input-type=module -e "await import('./lib/client.js')"` | `CLIENT_IMPORT_EXIT=0` | 依赖产物里的 `typeof window !== "undefined"` 守卫 |
| 打包内容正确 | `npm pack --dry-run --cache /tmp/npm-pack-cache` | `PACK_EXIT=0`；`README.md 13.1kB`、`cordis.patch.yml 646B`、`lib/client.js 354.0kB`、`lib/index.js 438.4kB`、`filename: dsh-auto-team-0.1.0.tgz`、`package size: 238.2 kB`、`total files: 5` | **必须带 `--cache`**（默认缓存目录不可写，见下一行）。**233.4 kB 是重写前 README（2089 B = 2.1 kB）的包体积**；重写后 README 13.1 kB 时为 238.2 kB（qa 09:26 实测） |
| 旧包体积对照（只解释 233.4 kB 的来源） | 临时目录只放 `package.json`、`cordis.patch.yml`、`lib/` 与 `git show HEAD:README.md`（2089 B）后 pack | `README.md 2.1kB`、`package size: 233.4 kB`、`total files: 5` | 这是**旧 README** 的包；当前包体积看上一行，不要再引用 233.4 kB |
| 默认 `npm pack` 失败的真实原因 | `npm pack --dry-run`；`find ~/.npm -user root \| wc -l`；`stat -f %Su:%Sg ~/.npm`；`touch ~/.npm/_cacache/probe` | `PACK_EXIT=255`；`npm error code EPERM`、`npm error path /Users/maliang/.npm/_cacache/tmp/***`、提示 root-owned；但 `ROOT_COUNT=0`、属主 `maliang:staff`、`touch` → `Operation not permitted` | 真实原因是**运行环境（沙箱）对默认缓存目录 `~/.npm` 不可写**，不是文件属主。修法：`--cache <可写目录>` 或可写 `HOME`；**不要** `sudo chown`（uid:gid 换机即错，改家目录属主有破坏性）。CI 用 `ubuntu-latest` 全新缓存、`npm pack` 是最后一步（`ci.yml:34`），不受影响 |

### 1.1 门禁执行目录（t1 首次回执假红复盘，2026-11-04 09:22）

| 事实 | 命令 / 证据 | 实际输出 |
| --- | --- | --- |
| 门禁 cwd 来源 | `sed -n '102p;405p' src/host/index.ts` | `102: const workspace = options?.workspace ?? process.cwd()`；`405: gate: { cwd: workspace, artifactsDir }` |
| 真机未传 `options.workspace` | 门禁日志实际落点 `ls -l ~/.dsh/profiles/desktop/.auto-team/artifacts/` | 存在 `t1.log` → cwd 取到了宿主进程启动目录 `~/.dsh/profiles/desktop` |
| 相对路径验收失败（假红） | `cat ~/.dsh/profiles/desktop/.auto-team/artifacts/t1.log` | `# exit: 1`，命令回显后**无任何输出**（`test -s README.md` 静默失败），即 README 不在该 cwd |
| 同断言绝对路径可过 | `cd ~/.dsh/profiles/desktop && R=<repo>; test -s "$R/README.md" && grep -q 'auto_team_dispatch' "$R/README.md" && grep -q 'auto_team_receipt' "$R/README.md" && grep -q 'pnpm typecheck' "$R/README.md" && test -s "$R/docs/teamflow/20261103-r13-readme-refresh/FACTS.md" && test "$(wc -l < "$R/README.md")" -gt 70` | `ABS_EXIT=0`（cwd 仍是 profile 目录） |
| 同一套断言在仓库根 | 原始 acceptance（相对路径），cwd=`<repo>` | `ACCEPTANCE_EXIT=0` |

**结论**：验收命令必须与 cwd 解耦——写绝对路径，或自带 `cd <repo> && …`。门禁日志与项目记忆同样落在宿主启动目录，不在仓库。

## 2. 契约面数量（README「能力与入口」「工具」表的数字）

| 事实 | 命令 | 输出 |
| --- | --- | --- |
| 队长工具 8 个 | `grep -c 'name: `${TOOL_PREFIX}' src/host/tools.ts` | `8`（`plan`/`add_tasks`/`dispatch`/`status`/`message`/`receipt`/`memory`/`role`，行号 205/596/278/327/362/396/437/530） |
| HTTP 路由 4 条 | `grep -c 'path: `${BRIDGE_ROUTE}' src/host/http.ts` | `4`（`GET /snapshot`、`GET /library`、`GET /memory`、`POST /act`，见 `src/host/http.ts:5-8`） |
| 面板页签 3 个 | `grep -c "key: '" src/client/Panel.tsx` | `3`（`tasks`/`history`/`memory`，`TABS` 在 `src/client/Panel.tsx:81`，条目 82-84） |
| `PanelAction` 21 种 | `sed -n '854,918p' src/shared/types.ts \| grep -cE "^\s+\| \{ type: '"` | `21` |
| `PlanStatus` 5 种 | `sed -n '/^export type PlanStatus/,/^$/p' src/shared/types.ts \| grep -oE "'[a-z]+'" \| wc -l` | `5`（`draft/dispatching/paused/terminated/cancelled`） |
| `TaskStatus` 13 种 | `sed -n '/^export type TaskStatus/,/^$/p' src/shared/types.ts \| grep -oE "'[a-z]+'" \| wc -l` | `13`（含 `waiting/cancelled/skipped`） |
| `RejectionCode` 13 种（去重） | `sed -n '/^export type RejectionCode/,/^$/p' src/shared/types.ts \| grep -oE "'[A-Z_]+'" \| sort -u \| wc -l` | `13`（`BAD_REQUEST` 在注释里重复出现一次，去重后 13） |
| 内置角色 11 个 | `node --input-type=module -e "const m=await import('./src/host/roles/builtin.ts');console.log(m.BUILTIN_ROLES.length)"` | `11`：`pm,architect,dev,qa,docs,reviewer,frontend,backend,designer,devops,security` |
| 内置技能 12 个 | 同上 `.BUILTIN_SKILLS.length` | `12`：`prd-writing,architecture,implementation,testing,docs,review,frontend-ui,backend-api,ui-ux-design,devops-release,security-audit,data-modeling` |
| 并发默认 3 / 硬上限 8 | `grep -n "DEFAULT_MAX_CONCURRENT\|MAX_CONCURRENT_LIMIT" src/host/config.ts` | `config.ts:25 DEFAULT_MAX_CONCURRENT = 3`、`config.ts:28 MAX_CONCURRENT_LIMIT = 8` |
| 路由前缀 | `grep -n "BRIDGE_ROUTE =" src/shared/const.ts` | `const.ts:18 BRIDGE_ROUTE = '/api/auto-team'` |
| 门禁超时 / 证据尾部 | `grep -n "GATE_TIMEOUT_MS\|GATE_TAIL_CHARS" src/host/config.ts` | `:37 GATE_TAIL_CHARS = 4000`、`:40 GATE_TIMEOUT_MS = 300_000` |
| 参数合法域与默认值 | `grep -n "SETTINGS_LIMITS\|MEMORY_INJECT_BUDGET =\|STALL_MS =\|MAX_ATTEMPTS =" src/host/config.ts` | `SETTINGS_LIMITS` `:179-185`：并发 `[1,8]`、记忆预算 `[200,4000]`、停滞 `[1000,600000]`、返工 `[1,10]`、门禁超时 `[1000,600000]`；默认值 `:31 MEMORY_INJECT_BUDGET = 4000`、`:62 STALL_MS = 90_000`、`:68 MAX_ATTEMPTS = 3` |
| 运行时约束 | `node -e "const p=require('./package.json');console.log(p.engines)"` | `{ node: '>=22.18', dsh: '>=0.2.1-alpha.2 <0.3.0' }` |
| 轮询预算 3500ms | `grep -n "PANEL_ACTIVE_MS\|WATCHER_INTERVAL_MS" src/shared/const.ts src/host/config.ts` | `const.ts:26 PANEL_ACTIVE_MS = 2_000`、`config.ts:52 WATCHER_INTERVAL_MS = 1500` |

## 3. UI 槽位与入口（README 表格逐行）

| 结论 | 源码出处（唯一口径） |
| --- | --- |
| 开关在输入框左侧 `conversation.input.left`（不是 dock） | `src/client/slots.ts:41 INPUT_LEFT_SLOT`；`src/client/index.ts:9` 注释；`src/client/Option.tsx:2` |
| 会话头按钮 `conversation.session.header.actions` | `src/client/slots.ts:44 HEADER_ACTIONS_SLOT` |
| 右栏页签 `sidebar.right.pane.tab` + `.title`（keyed，两处同 key） | `src/client/slots.ts:47,50` |
| 设置页 `settings.section` | `src/client/slots.ts:53 SETTINGS_SECTION_SLOT` |
| 左栏栏目 `sidebar.panellist`、主区 `main` | `src/client/slots.ts:441,449` |
| 面板三页 = 任务/历史/记忆，角色页已删 | `src/client/Panel.tsx`（`TabKey` 在 :78、`TABS` 在 :81，条目 82-84） |
| 页签类型需注册进 `sidebarRightTabs`，否则永不出现 | `src/client/slots.ts:404-409`（`ctx.inject(['sidebarRightTabs'], …)`） |
| 计划落盘即自动派发（无独立开关） | `src/host/team/auto-dispatch.ts:1-3`；触发点 `src/host/index.ts:438,458`、`src/host/tools.ts:51`（`autoDispatch` 端口） |
| 用户侧只有暂停/继续与任务级可逆动作，没有派发按钮 | `src/client/tabs/TasksTab.tsx:10` |

## 4. 数据落点（README 表格逐行）

路径派生集中在 `src/host/paths.ts`（例外：`sessions.json` 由 `bridge.ts` 基于 `dataRoot` 拼出，见末行）：

| 路径 | 函数与行号 |
| --- | --- |
| `~/.dsh/auto-team` | `globalDataRoot` `paths.ts:8` |
| `runs/` | `runsDir` `paths.ts:13` |
| `roles/<id>.json` | `rolesDir` `paths.ts:18`；文件格式见 `src/host/roles/repo.ts:2`（一角色一 JSON，非 md） |
| `skills/<id>.md` | `skillsDir` `paths.ts:23`；格式见 `src/host/roles/skills-repo.ts:2,78`（md + frontmatter） |
| `settings.json` | `settingsPath` `paths.ts:43` |
| `deviations.jsonl` | `deviationsPath` `paths.ts:53` |
| `memory/public/` | `publicMemoryDir` `paths.ts:58` |
| `<workspace>/.auto-team/memory` | `projectMemoryDir` `paths.ts:63` |
| `<workspace>/.auto-team/artifacts` | `projectArtifactsDir` `paths.ts:68` |
| `sessions.json` | `src/host/bridge.ts:409`（`${deps.dataRoot}/sessions.json`） |

## 5. 安装态取证（README 安装节）

| 事实 | 命令 | 输出 |
| --- | --- | --- |
| 本机 profile 路径存在 | `ls -d ~/.dsh/profiles/desktop` | `/Users/maliang/.dsh/profiles/desktop` |
| 已登记为依赖 | `grep -n '"dsh-auto-team"' ~/.dsh/profiles/desktop/package.json` | `7: "dsh-auto-team": "file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team"` |
| 已登记进 bundles | 同上 | `30: "dsh-auto-team"`（位于 `dsh.profile.bundles`） |
| 预期 2 行 | 同上 | README 写「应看到两行：依赖项一行、bundles 一行」（不死写行数：旧版本残留或 bundles 重复时行数会变），与实测一致 |

## 6. 取证过程中发现的文档漂移（README 重写的理由，均**不在本次改动范围**）

这些是源码注释里的旧数字，与当前实现不符；README 一律以实际可执行计数为准，注释留待对应模块自更新：

| 位置 | 注释写的 | 实际 |
| --- | --- | --- |
| `src/host/index.ts:449` | 「7 个 auto_team_*」 | 8 个（含 r11 新增 `add_tasks`） |
| `src/shared/types.ts:886` | 「只重写内置 6 个」角色 | 内置 11 个 |
| `src/shared/types.ts:915` | 「拒绝码（12 个）」 | 去重后 13 个 |

## 7. 复现整表

```bash
export REPO=/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team && cd "$REPO"
git rev-parse HEAD && git rev-parse --abbrev-ref HEAD
node -v && pnpm -v
pnpm typecheck; echo "TYPECHECK_EXIT=$?"
pnpm test > /tmp/test.log 2>&1; echo "TEST_EXIT=$?"; grep -E '^ℹ (tests|pass|fail) ' /tmp/test.log
pnpm build > /tmp/build.log 2>&1; echo "BUILD_EXIT=$?"; grep -E 'lib/(index|client)\.js' /tmp/build.log
node --input-type=module -e "await import('./lib/index.js')"; echo "HOST_IMPORT_EXIT=$?"
node --input-type=module -e "await import('./lib/client.js')"; echo "CLIENT_IMPORT_EXIT=$?"
npm pack --dry-run --cache /tmp/npm-pack-cache > /tmp/pack.log 2>&1; echo "PACK_EXIT=$?"; grep -E 'total files|package size' /tmp/pack.log
echo "TOOLS=$(grep -c 'name: `${TOOL_PREFIX}' src/host/tools.ts) ROUTES=$(grep -c 'path: `${BRIDGE_ROUTE}' src/host/http.ts) TABS=$(grep -c "key: '" src/client/Panel.tsx)"
node --input-type=module -e "const m=await import('./src/host/roles/builtin.ts');console.log('roles',m.BUILTIN_ROLES.length,'skills',m.BUILTIN_SKILLS.length)"
```

## 8. 未取证 / 不声称的部分

以下是 README 明确标为「未验证 / 已知限制」的内容，本表**不**给它们伪造证据：

- 左栏主区整页项目库的真机表现（代码里是 `try/catch` 降级，未在真机确认 U2）。
- 真机 UI 的视觉最终形态（需重启宿主并刷新 GUI，由主 agent 执行；本子代理权限固定在工作区内，无法写 profile 或重启宿主）。
- 停止/回滚后宿主行为（同上，需要 profile 写权限）。

## 9. t3 修补复测（HEAD `00d2b55`，2026-11-04 09:44）

t3 按 REVIEW B1–B5 / N1–N8 修 README 后，为确认「基线已漂移」与新增断言的行号，在**当前 HEAD** 复跑同一组命令（子代理 workspace-write 权限，`/tmp` 可写）：

| 事实 | 命令 | 输出 |
| --- | --- | --- |
| 当前 HEAD | `git rev-parse --short HEAD` | `00d2b55` |
| 类型检查 | `pnpm typecheck` | exit 0 |
| 单测 | `pnpm test` | `tests 668` / `pass 668` / `fail 0`，exit 0（与基线一致） |
| 双产物构建 | `pnpm build` | exit 0；`lib/client.js 353.96 kB`、`lib/index.js 439.69 kB`（index 比基线 438.38 kB 变大，client 未变） |
| 产物可加载 | 两条 `node --input-type=module -e "await import(...)"` | exit 0 |
| 打包 | `npm pack --dry-run --cache /tmp/npm-pack-cache-r13` | exit 0；`README.md 13.1kB`、`lib/index.js 439.7kB`、`package size 238.7 kB`、`total files 5` |
| 构建不污染入库产物 | `git status --porcelain`；`wc -c lib/index.js lib/client.js` | 仅 `M README.md` 与 `?? docs/teamflow/…`（t3 同时改了 AGENTS.md 一行，之后会多一条 `M AGENTS.md`）；`439695` / `353964` 与 `HEAD:lib/*` 字节一致（重建可复现，未改动 `lib/`） |

**结论**：`668 通过` 与 `lib/client.js 353.96 kB` 未变，`lib/index.js`（438.38 → 439.69 kB）与包体积（238.2 → 238.7 kB）已随 HEAD 漂移——这就是 README 基线表必须锚 commit、并给出一行复现命令的原因。旧的 `438.38 kB / 233.4 kB` 只对 `cd2bb61` 与重写前 README 成立，不要再引用。

### 9.1 本轮新增/修正断言的行号复核（均在 `00d2b55` 上 grep）

| README 断言 | 命令 | 命中 |
| --- | --- | --- |
| `Panel.tsx:81`（`TABS`）、`:78`（`TabKey`） | `grep -n 'TabKey\|export const TABS' src/client/Panel.tsx` | `78:export type TabKey …`、`81:export const TABS …` |
| 回执只能队长提交：`tools.ts:408-409` | `sed -n '407,410p' src/host/tools.ts` | `const sessionId = sessionOf(meta)` / `if (!deps.bridge.enabled(sessionId)) return … NOT_ENABLED` |
| `sessionOf` 优先 `exec.agent.id` | `grep -n 'export function sessionOf' src/host/tools.ts` | `68:export function sessionOf(meta: unknown): string`（实现 `agent?.id ?? sessionId ?? session?.id ?? 'current'`） |
| 开关只在 toggle 时写 | `grep -n 'flags\[sessionId\] = ' src/host/bridge.ts` | `1125`（toggle 动作）、`1815`（`setEnabled`，声明 :1814） |
| `sessions.json` 由 bridge 拼 | `grep -n 'sessions.json' src/host/bridge.ts` | `409: return \`${deps.dataRoot}/sessions.json\`` |
| 并发被宿主 clamp：`index.ts:177-192` | `grep -n 'function hostConcurrency' src/host/index.ts` | `177`（返回 requested/clamped） |
| 宿主服务集中在 adapters（`ctx.logger` 例外） | `grep -rn 'ctx\.logger' src/host/index.ts` | 仅 `316 / 654 / 658` 三处 |
| 记忆 token 是估算 | `grep -n 'memoryTokenEstimate' src/host/format.ts`；`grep -n '≈' src/client/viewmodel.ts` | `format.ts:123`；`viewmodel.ts:1222`（`≈N token`）、`:1223`（按字符数估算，非 provider 上报） |
| CI 不受缓存问题影响 | `grep -n 'npm pack' .github/workflows/ci.yml` | `34`（最后一步，`runs-on: ubuntu-latest`） |
