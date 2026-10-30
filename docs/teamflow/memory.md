# 产品记忆（跨需求约定，按主题替换同一行，不做变更日志）

## 技术栈
- dsh 插件 `dsh-auto-team`：TypeScript + 双构建（宿主 `lib/index.js` 为 ESM、client `lib/client.js` 为 CJS 且套 `__ModuleLoader__` 壳）；声明用 `dsh.bundle.patch` + `dsh.client`，字段集合照本机已装样本 `~/.dsh/profiles/desktop/node_modules/dsh-plugin-teamflow/package.json`。
- 多智能体编排复用宿主服务：`ctx.agentTeams`（`spawnTeammate`/`listMembers`/`tryMembership`）+ `ctx.tools.register` + `ctx.systemPrompt.section` + `ctx.slots.inject/register`；不重造成员与消息通道。
- per-role 模型/人设：官方 Team 请求不带 `agentOptions`，必须在串行 `agent/created` 事件上安装成员级路由，并用 `llm.resolveCallConfig()` 预校验（否则静默沿用队长模型）。
- UI 挂载点：输入框下方 = `conversation.composer.dock`（kind=list/session，渲染于 `[data-composer-dock]`）；`conversation.input.dock` 在输入卡上方，别混用。

## 安装与运行
- 本机 `dsh` 不在 PATH：装/卸走 `cd ~/.dsh/profiles/desktop && pnpm add file:<repo>` / `pnpm remove <pkg>`，并同步 `package.json` 的 `dsh.profile.bundles`；profile=desktop。
- 安装只能由主 agent 执行（流水线子代理权限固定在工作区内，写不了 profile）。
- 数据落点：运行状态 `~/.dsh/auto-team/runs/`、会话开关 `~/.dsh/auto-team/sessions.json`、角色 `~/.dsh/auto-team/roles/*.md`、公共记忆 `~/.dsh/auto-team/memory/public/`、项目记忆 `<workspace>/.auto-team/memory/`、门禁日志 `<workspace>/.auto-team/artifacts/`。

## 工程约定（脚手架已落地，详见 docs/teamflow/architecture/ARCHITECTURE.md）
- 分层：`src/shared` 纯类型 ← `src/host`（node）/ `src/client`（浏览器）；**host 与 client 零直接 import**，只走 `GET|POST /api/auto-team`。
- 宿主 API 只许出现在 `src/host/adapters.ts`；宿主形状变动只改这一个文件。
- 本地 import 一律带显式 `.ts` 扩展名（`node --test` 直接跑 TS 源的前提）；纯逻辑模块不许 import 宿主。
- `tsconfig` 的 `jsx` 必须是 classic `"react"`（client 的 `require` 由宿主提供，不保证解析 `react/jsx-runtime`）。
- client 产物必须保留 `typeof window !== "undefined" && window.__ModuleLoader__` 守卫，否则 node 侧 `await import('./lib/client.js')` 自检会失败。
- `cordis.patch.yml` 的 `name` 必须是包根名 `dsh-auto-team`（写子路径会让 clientModules 扫描跳过，症状：工具在、面板不出现）。
- 前端样式只用宿主 token；字号写 `font: var(--dsw-font-xs-13, …)`，**不许写 `font-size: var(...)`**（该 token 是 font 简写复合值，写 font-size 是无效声明且静默继承父级）。
- 前端读接口必须解构 `{data,error}` 包装（历史高频 bug 族：整包赋值 → 界面"点了没反应"）。
- 成员名是身份契约：同一角色多任务时成员名必须**两两唯一**且可辨认任务（`<roleId>-<taskId>` 不够——归一化会把 `登录流程` 折成角色名、把 `Login_Flow` 与 `login-flow` 折成同一串）。身份段必须**先编码再归一**（保序映射或短序号），且 `dispatchReady` 要断言归一后唯一；单任务视角的「符合宿主字符集」测试看不到这类塌缩。
- 验证命令：`pnpm typecheck && pnpm test && pnpm build`，外加两条 `node --input-type=module -e "await import('./lib/…')"` 与 `npm pack --dry-run`（须含 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`）。实测基线（2026-10-31）：typecheck exit 0、**146 tests 全绿**、产物 `lib/index.js` 132.1 kB + `lib/client.js` 92.2 kB、单测跑 TS 源约 3.0s。

## 待办 / 已知约束
- `lib/` 必须入库（`pnpm add file:` 的安装源即产物）；`.gitignore` 不忽略 `lib/`。
- 宿主 API 形状未全部核实（`src/host/adapters.ts` 内 6 处 `[待核]`：工具定义字段、prompt section 形状、route 形状、`spawnTeammate` 返回 `memberId`/`id`、`sendMessage` 入参名、`resolveCallConfig` 返回结构）；**装一次到 profile 并刷新 GUI 即可一次消掉**，见 ARCHITECTURE §8.2。
- 两个挂载面尚未在真实 GUI 渲染验证（目前只有 mock loader 冒烟：注册出 `conversation.composer.dock|dsh-auto-team-toggle|10` 与 `sidebar.right.pane.tab|dsh-auto-team-panel|60`）。
- 开放缺陷 `R2-1`（P2，20261030-r1 验收）：成员名唯一性，检测命令 `node logs/…/scripts/qa-collision-probe.mjs` 当前 1/5；另欠 ① `@deepseek-ai/*` 的 optional peer 声明（样本有 13 条，本包只有 `react`）② 收口提交（HEAD 仍为 `150eb5b` 基线，63 项未提交）③ 5 个已修 bug 在 backlog 镜像里仍 `open`。
- ~~本会话 `cordis_inspect_query` 不可用~~ **已证伪（2026-10-31 主 agent 实测）**：工具可用，报错是调用形态错误 —— 必须传 `input` 且是**对象**（至少 `input: {}`）；省略 `input` 或传非对象时，宿主返回 `Host Cordis inspect Service.listService rejected input: "input" must be an object`，看起来像环境不可用。核对 Service schema 一律先 `cordis_inspect_list` 取 provider/method，再 `cordis_inspect_query({platform, provider, method, input: {}})`。

## 工具与流程坑（踩过就去掉一次重试成本）
- `cordis_inspect_query`：`input` 必须是对象（`{}` 也行）。host 侧 provider：`Service/listService`、`Event/listEvents`、`Config/listConfigs`、`Tool/listTools`；client 侧：`Service/listService`、`Event/listEvents`、`Builtin/listBuiltins`、`Slots/listSubTree`、`Theme/listTokens`。`Service/listService` 返回的 `signature` 是**方法签名目录**（不含 type 字段），能确认方法名与参数个数，不能确认请求对象字段名。
- 实例化的关键签名（`input: {}` 实调结果）：`agentTeams.spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>`、`agentTeams.sendMessage(caller, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>`、`agentTeams.{membership,listMembers,createTask,getTask,listTasks,updateTask,waitForChange,interrupt,tryMembership}`；`tools.{register(definition): ()=>void, guard, get, schemas, execute}`；`systemPrompt.{section(section): ()=>void, context, tools, variable, assemble}`；`webServer.{register(route: WebRoute): ()=>void, registerUpgrade, tapIndex, renderIndex}`；`llm.resolveCallConfig(config: LlmCallConfig, signal?): Promise<LlmCallConfig>`；`subagents.{startActivation,sendMessage,interrupt,listChildren,listDescendants,resolveMaxDepth}`。
- `toolflow` 阶段熔断教训：scaffold 阶段单阶段新增 token 上限 350k，超了直接熔断失败。**续跑时不要重写已落盘文件** —— 先读 `docs/teamflow/architecture/ARCHITECTURE.md`（含 §8.1 已验证清单 / §8.2 未验证清单），只补齐缺口与核实 `[待核]` 项，避免重复劳动再次烧穿预算。
- 验收判据要「同时覆盖合法性与唯一性」：本轮的 R2-1 正是因为两轮 QA 都只断言「单个成员名符合宿主字符集」，把两个不同 id 放在一起才暴露塌缩——凡「身份/命名」类判据，必须构造**成对样本**做可分辨断言。
