# dsh-auto-team 工程架构与脚手架说明

> 产品级长期文档（跨需求复用）。需求级产物在 `docs/teamflow/<日期-rN-slug>/`，本文件只讲**工程方案、模块边界、构建与验证**。
> 本文件的每条"已落地"结论都附了实际执行过的命令与返回，未验证的内容单独列在 §8，不得当作事实转抄。
>
> 基线：本需求 PRD 与设计见 `docs/teamflow/20261030-r1-auto-team-plugin/`（PRD.md / DESIGN.md）。

## 1. 一句话结论

插件 = **一个双产物 npm 包**（宿主 ESM + client CJS）：
- 宿主侧（`lib/index.js`）：把「计划 DAG / 角色 / 双轨记忆 / 门禁 / 调度」做成**纯逻辑 + 一层胶水**，通过 `ctx.tools.register`、`ctx.systemPrompt.section`、`ctx.webServer`（面板接口）、`ctx.agentTeams`（派发成员）接进 Harness；
- client 侧（`lib/client.js`）：两个挂载面 —— `conversation.composer.dock`（32px 开关行）与 `sidebar.right.pane.tab`（四页面板）；
- 二者只通过一条 `GET/POST /api/auto-team` 契约通信，开关状态**唯一来源在宿主**（`<dataRoot>/sessions.json`），前端不另存一份。

## 2. 技术栈推荐与权衡

**选定：TypeScript 5.9 + React 18 + Node ≥22.18 + tsdown 0.23（rolldown）+ pnpm 10 + node:test。**

| 决策 | 选择 | 备选与被否原因 |
|---|---|---|
| 语言 | TypeScript（`strict` + `verbatimModuleSyntax` + `isolatedModules`） | 纯 JS：宿主 API 面窄但形状未公开文档化，没有类型无法在编译期挡住"字段名猜错"，而这类错误在运行时表现为**面板空白、无报错** |
| 宿主构建 | tsdown（rolldown），ESM，`target: node22` | tsup/esbuild：tsdown 与宿主同源工具链，配置字段（`deps`/`outputOptions`）与团队既有插件样本一致；纯 tsc：无法做 CJS 套壳，client 产物必须包 `__ModuleLoader__` |
| 前端 | React 18 函数组件 + 手写 CSS（宿主 token） | 不引入 UI 库：宿主已提供全部主题 token 与 `--dsw-*` 变量，引入组件库会带一套自己的设计语言，与宿主暗色主题打架；也不引入状态库，面板状态就是一个 `usePanelState` |
| 前端构建 | tsdown 产出 CJS，banner/footer 手写 `__ModuleLoader__.load(...)` 套壳 | Vite/Next：client 产物契约是宿主 `__ModuleLoader__` 的同步 factory（`require("react")` 外部化），不是浏览器入口，Vite 生成的多 chunk/ESM 产物宿主加载不了 |
| react | **peerDependency（optional）+ 产物里 `require("react")`** | 打进产物会让宿主出现两份 React，hooks 直接崩（典型症状：`Invalid hook call`）；打进 dependencies 会与宿主版本冲突 |
| 测试 | `node --test` 直接跑 `.ts` 源（Node 22.18 原生类型擦除） | vitest/jest：为十几个纯函数引入一套 bundler+transform 不划算；且"直接跑源码"迫使纯逻辑模块**不许 import 宿主或本地非纯模块**，是天然的架构约束 |
| 包管理 | pnpm 10 + 提交 `pnpm-lock.yaml` | npm：团队 profile 安装链路本来就是 pnpm（`pnpm add file:`） |

**为什么 monorepo/分层不是过度设计**：宿主侧与 client 侧**运行环境完全不同**（一个 node、一个浏览器；一个能 `import fs`、一个不能）。同一份代码不可能同时满足两边，所以从第一天就物理隔离 `src/host` / `src/client` / `src/shared`，否则开发中期一定会出现"面板里 import 了 fs"的返工。

**共享层只放类型**：`src/shared/types.ts` 是纯类型文件（`import type` 双向引用），不放任何实现，避免把宿主代码打进 client 产物。

## 3. 目录树（实际落盘，非设想）

```
dsh-auto-team/                      # 仓库根 = 产品根（本产品就是单个 npm 包）
├── AGENTS.md                       # 团队守则 + 文档索引 + TeamFlow 托管区
├── README.md                       # 安装/使用/验收速览
├── package.json                    # 双产物声明：main/lib、exports、dsh.bundle.patch、dsh.client
├── cordis.patch.yml                # 插件插入声明（name 必须是包根名）
├── tsconfig.json                   # strict / Bundler / jsx: react / allowImportingTsExtensions
├── tsdown.config.ts                # client 产物：CJS + __ModuleLoader__ 套壳
├── tsdown.host.config.ts           # 宿主产物：ESM node22
├── pnpm-lock.yaml
├── .gitignore                      # 忽略 node_modules/logs，**不忽略 lib/**
├── .github/workflows/ci.yml        # 类型检查→单测→双构建→产物自检→打包自检
├── src/
│   ├── shared/types.ts             # 唯一共享层：全部跨端类型（纯 type，无实现）
│   ├── host/
│   │   ├── index.ts                # 插件入口：name/inject/apply + 依赖装配
│   │   ├── adapters.ts             # ★唯一接触宿主未核实形状的胶水（其他文件不许碰宿主 API）
│   │   ├── config.ts               # 全部常量（预算/并发/超时/路由前缀）
│   │   ├── paths.ts                # 落点解析（全局数据根 / 项目记忆 / 产物目录）
│   │   ├── store.ts                # 运行态持久化（原子写）
│   │   ├── bridge.ts               # 面板/工具与内核之间的唯一门面
│   │   ├── tools.ts                # 6 个模型工具定义与注册
│   │   ├── prompt.ts               # 队长系统提示段
│   │   ├── http.ts                 # GET snapshot / POST act 两条路由
│   │   ├── plan/{graph.ts,plan.ts}# DAG 校验与就绪计算（纯） / 计划构造（纯）
│   │   ├── roles/{builtin.ts,repo.ts} # 6 内置角色+技能（纯） / 角色 CRUD（MD 落盘）
│   │   ├── memory/{repo.ts,inject.ts} # 双轨 MD 读写 / 注入预算（纯）
│   │   ├── gate/gate.ts            # 质量门禁（执行验收命令，产出证据）
│   │   └── team/{dispatch.ts,route.ts} # 并行派发（纯，注入 spawn） / 每角色模型路由预校验
│   └── client/
│       ├── index.ts                # client 入口：注入 slots，注册两个挂载面
│       ├── api.ts                  # 面板接口客户端（强制解 {data,error} 包装）
│       ├── state.ts                # 轮询 + 会话 id 解析
│       ├── styles.ts               # 仅用宿主 token 的样式表 + 注入器
│       ├── Toggle.tsx              # 输入框下方开关行（AC-30 落点）
│       ├── Panel.tsx               # 右栏面板壳（四页 Tabs）
│       └── tabs/{PlanTab,MembersTab,MemoryTab,RolesTab}.tsx
├── test/{graph,memory,plan}.test.ts # 27 例纯逻辑单测
├── test/adapters.test.ts          # 4 例宿主契约测试（工具 output / prompt text / HTTP 单路由分发 / 缺服务只 warn）
├── docs/teamflow/                  # 团队文档（memory.md / architecture/ / 任务夹）
├── logs/teamflow/<runId>/          # run 期间暂存，结束后由 host 归档
└── lib/{index.js,client.js}        # 构建产物，**必须入库**
```

规模：`src` + `test` 共 3506 行（`wc -l` 实测，含 27 个测试用例）。

## 4. 模块契约（谁能 import 谁）

**依赖方向铁律：`shared → (host, client)`，host 与 client 之间零直接 import。**

| 文件 | 职责 | 可依赖 | 测试方式 |
|---|---|---|---|
| `src/shared/types.ts` | 跨端类型（Plan/Role/PanelSnapshot/PanelAction…） | 无 | 编译期 |
| `src/host/config.ts` | 常量：并发 3/上限 8、记忆预算 4000 字符、每任务 20 行、门禁 300s、轮询 5s、`/api/auto-team` | 无 | — |
| `src/host/paths.ts` | `~/.dsh/auto-team/{runs,roles,skills,memory/public}`、`<ws>/.auto-team/{memory,artifacts}`；空工作区归一为 `/default`（防止写进 cwd） | 无 | 单测 |
| `src/host/plan/graph.ts` | `validateGraph`（空/重复/未知依赖/自依赖/成环，各给一条中文原因）、`findCycle`、`readyTasks`、`blockedTasks`、`topoLayers` | 无（纯函数） | 单测 10 例 |
| `src/host/plan/plan.ts` | `buildPlan` 自动补 `t1..tN`、拒空标题/空角色、并发夹到 1..8；`planFingerprint`、`progressOf` | config / graph | 单测 |
| `src/host/roles/builtin.ts` | 6 内置角色（pm/architect/dev/qa/docs/reviewer）+ 6 技能正文；`composeSkillPrompt` | 无（纯） | 间接 |
| `src/host/roles/repo.ts` | 角色 CRUD（`<dataRoot>/roles/*.md`）：内置可改不可删、拒 id `captain`、`provider+model` 缺一即"跟随会话默认" | shared | 手工 |
| `src/host/memory/repo.ts` | 双轨 MD 读写：`safeMemoryName` 拒一切路径逃逸（`/ \ \0 . ..`、点开头、>64 字符）；`appendMemoryLines` 限 20 行并回报 `truncated` | shared | 单测 9 例 |
| `src/host/memory/inject.ts` | `selectMemory(goal, candidates, budget)`：project 优先于 public，再按相关度，超 4000 字符截断并打 `[截断]` | 无（纯） | 单测 |
| `src/host/gate/gate.ts` | `runGate`：执行任务验收命令，全文落 `<artifacts>/<taskId>.log`，产出 `GateEvidence{command,exitCode,tail,artifacts}`；无验收命令 → exitCode -1「需要人工确认后放行」 | shared | 手工 |
| `src/host/team/dispatch.ts` | `dispatchReady`：按 `maxConcurrent - running` 决定本次派发谁；单个 spawn 失败不打断整批；`applyReceipt` 更新状态 | graph / shared / bridge(仅 `describeRoute`) | 手工 |
| `src/host/team/route.ts` | `preflightRoutes`：派发前用 `llm.resolveCallConfig` 校验每角色模型；`routeDrift` 报告"声明的模型与实际不符" | shared | 手工 |
| `src/host/store.ts` | `RunsStore`（`.tmp + rename` 原子写）、`makeRunId` | shared | 手工 |
| `src/host/bridge.ts` | 门面：`enabled/setEnabled/snapshot/act/memoryFor/remember`；未启用时 `act` 统一返回「自动团队未启用：请先在输入框下方的『自动团队』开关处启用」 | 上述全部 | 手工 |
| `src/host/tools.ts` | 6 个工具：`auto_team_plan/dispatch/status/message/memory/role` | bridge | 手工 |
| `src/host/prompt.ts` | 队长系统提示段（name `auto-team`，order 900） | bridge | 手工 |
| `src/host/http.ts` | `GET /api/auto-team/snapshot?sessionId=`（也包 `{data}`）、`POST /api/auto-team/act` | bridge | 手工 |
| `src/host/adapters.ts` | **唯一**碰宿主未核实形状的文件：`toHostToolDefinition`、`registerPromptSection`、`registerHttpRoutes`、`createSpawnPorts`（`spawnTeammate`/`sendMessage`）、`createRoutePorts`（`resolveCallConfig`）、`onAgentCreated` | shared | 无法单测（形状未公开） |
| `src/client/api.ts` | `snapshot/act`，**强制解构 `{data,error}`**，HTTP 失败返回中文原因 | shared | 手工 |
| `src/client/state.ts` | `sessionIdOf`（props.sessionId → props.session.id → `"current"`）+ 首屏拉一次 + 5s 兜底轮询 | api | 手工 |
| `src/client/styles.ts` | 全部样式只用宿主 token；字号一律 `font: var(--dsw-font-xs-13, …)` | 无 | 手工 |
| `src/client/Toggle.tsx` | 开关行：`data-dsh-auto-team-toggle` / `data-toggle-switch` / `data-toggle-capsule` / `data-toggle-open-panel` | state/labels | 手工 |
| `src/client/Panel.tsx` + `tabs/*` | 四页：计划 / 成员 / 记忆 / 角色；携带 PRD 要求的全部 `data-*` 定位属性 | state/api | 手工 |

**为什么 `adapters.ts` 必须单独存在**：宿主 API 的形状（工具定义字段、prompt section 字段、route handler 签名、`spawnTeammate` 返回 `memberId` 还是 `id`）在本机无法完全核实（见 §8）。把全部不确定处收敛到一个 214 行的文件，将来形状对不上时**只改一处**，而不是散落 20 处。

## 5. 数据落点与流转

```
~/.dsh/auto-team/
├── runs/<runId>.json      # 计划快照（Plan + 成员 + 证据），原子写
├── sessions.json          # 每个会话的开关状态（唯一来源）
├── roles/<roleId>.md       # 用户自建/修改的角色（内置角色首次使用时 seed）
├── skills/<skillId>.md     # 技能正文
└── memory/public/*.md      # 公共记忆（跨项目）
<workspace>/.auto-team/
├── memory/*.md             # 项目记忆
└── artifacts/<taskId>.log  # 门禁命令全文输出（面板只看尾部 4000 字符）

流转：队长工具 auto_team_plan → buildPlan → validateGraph → RunsStore.save
     → 面板 GET snapshot 显示计划（此时成员数 0，AC-30）
     → auto_team_dispatch → dispatchReady（按并发取 ready 任务）
     → spawnTeammate（带角色技能提示 + 记忆注入 ≤4000 字符）→ 成员跑任务
     → 完成后 runGate 执行验收命令 → GateEvidence 落盘
     → 通过=done / 不通过=rework；中断=interrupted（可 resume）
```

## 6. 依赖清单（全部实测安装成功）

| 类别 | 包 | 版本 | 为什么必须有 |
|---|---|---|---|
| peerDependency（optional） | `react` | `^18.2.0` | 宿主已提供，插件只 `require`，绝不打包（两份 React 会让 hooks 崩） |
| devDependency | `tsdown` | `^0.23.4` | 双产物构建（rolldown） |
| devDependency | `typescript` | `^5.7.2` | `strict` 类型检查（实测装上 5.9.3） |
| devDependency | `@types/node` / `@types/react` | `^22.10.2` / `^18.3.12` | 宿主侧 node API、client 侧 JSX |
| 无 | `@deepseek-ai/*` | — | **故意不依赖**：宿主以服务形式注入（`ctx.tools`/`ctx.agentTeams`/`ctx.slots`），装成依赖会引入第二份实现 |

`peerDependenciesMeta.react.optional = true`：宿主环境里 react 由 client runtime 提供，本地 `pnpm install` 不装也不影响构建。

## 7. 构建 / 测试 / CI 要点

```bash
pnpm install      # 实测 39 包，50.1s
pnpm typecheck    # tsc --noEmit，实测 exit 0
pnpm test         # node --test test/*.test.ts，实测 31 tests / 31 pass / 0 fail，106ms
pnpm build        # client(cjs 33.38 kB) + host(esm 57.76 kB)，实测 exit 0
node --input-type=module -e "await import('./lib/index.js')"   # 实测输出 index ok，exit 0
node --input-type=module -e "await import('./lib/client.js')"  # 实测输出 client ok，exit 0
npm pack --dry-run                                            # 实测 5 个文件、29.8 kB
```

**两条容易踩的构建设定（已写进 CI/配置，别改回去）**：

1. **`jsx` 必须是 classic `"react"`，不能是 `react-jsx`**。client 产物的 `require` 由宿主 `__ModuleLoader__` 提供，只保证能解析 `react`；`react-jsx` 会生成 `require("react/jsx-runtime")`，宿主 factory 里没有这条路径，运行时直接抛 `Cannot find module 'react/jsx-runtime'`。
2. **client 产物必须在 banner 里套 `if (typeof window !== "undefined" && window.__ModuleLoader__)` 守卫**。真实产物顶层直接访问 `window` 时，`node --input-type=module -e "await import('./lib/client.js')"` 会因 `window is not defined` 抛错；PRD 的 AC-8 要求这条命令退出码 0，守卫同时满足"浏览器里正常注册"和"node 里可加载自检"两个约束。

**为什么产物要入库**：profile 安装走 `pnpm add file:<repo>`，安装源就是仓库里的 `lib/`。`.gitignore` 因此**明确不忽略 `lib/`**，而 CI 里 `npm pack --dry-run` 会检查 `lib/index.js`、`lib/client.js`、`cordis.patch.yml` 三个文件确实在包里。

**`cordis.patch.yml` 的 `name` 必须是包根名 `dsh-auto-team`**：写子路径会让宿主的 clientModules 扫描跳过该插件（本机样本 `dsh-plugin-teamflow` 的注释里明确记录了这一条），症状是"宿主侧工具出现了、面板永远不出现"。

## 8. 宿主真实契约（2026-10-30 用 cordis_inspect 实测，不再有 `[待核]`）

查询方式（**`input` 必须是对象**，省略/传非对象会报 `"input" must be an object`，上一轮就是在这里误判成“工具不可用”）：

```
cordis_inspect_query { platform: "host", provider: "Service", method: "listService", input: { service: "<key>" } }
```

| 服务 | 实测签名（关键处逐字） | 对实现的约束 |
|---|---|---|
| `tools` | `register(definition: ToolDefinition)`；`ToolDefinition extends ToolSchema { output: ToolOutputDefinition; execute(args, exec): Promise<unknown> }`；`ToolOutputDefinition { schema: JsonSchemaNode; render(args, value): ContentBlock[] }` | 定义里**必须有 `output`**（含 `schema` 与 `render`）。少 `output` 会在注册或首次调用时报错，不补就是“工具静默不可用”。`toHostToolDefinition` 已补，`test/adapters.test.ts` 断言 `output.render` 返回 `[{type:'text',text:'{"ok":true,…}'}]` |
| `systemPrompt` | `section(section: PromptSection)`；`PromptSection { name; order; text: string \| (ctx) => string; interpolate?; complete? }` | 段落正文的字段名是 **`text`**，不是 `render`/`content`。已改；测试断言 `section.render === undefined && section.content === undefined` |
| `webServer` | `register(route: WebRoute)`；`WebRoute { kind: 'exact' \| 'prefix'; path: string; handler(req: IncomingMessage, res: ServerResponse) }`；重复 `(kind,path)` 会 throw | 宿主路由**没有 `method` 字段**，也不做 JSON 归一。因此注册**一条** `kind:'prefix', path:'/api/auto-team'`，在 handler 内按 `req.method + req.url` 分发、自己 `setHeader/end`、异常转 500、未知路径 404。`test/adapters.test.ts` 用假 req/res 覆盖 GET/POST/404/坏 JSON 四条路径 |
| `agentTeams` | 全部方法第一参是 `caller: Agent`（`Agent = { readonly id: SessionId }`）；`spawnTeammate(caller, SpawnTeammateRequest{ name, description, prompt: ContentBlock[], context:'fresh'\|'fork', provider, signal }) → { member: TeamMemberView }`；`sendMessage(caller, { target: string; content: ContentBlock[]; signal }) → { messageId }`；成员视图 `status: 'running'\|'inactive'\|'provisioning'\|'failed'` | ① caller 必须是**当前活跃 Agent**：用 `ctx.agents.currentInitiator()` 取得（工具在 Agent 异步链里执行），拿不到就返回明确错误，**不伪造 agent**；② prompt 要包成 `[{type:'text',text}]`；③ `sendMessage` 的 `target` 是**成员名**，不是 memberId——适配层维护 `id→name` 映射（`spawn` 时登记，缺时 `listMembers` 刷新）；④ `spawnTeammate` **没有 model 字段**，只有 `provider`（见下方“已知限制”） |
| `llm` | `resolveCallConfig(config: LlmCallConfig, signal?) → LlmCallConfig`，`LlmCallConfig extends LlmCallControls { provider, model }`，controls = `reasoningEffort?/temperature?/maxTokens?/stop?` | 预校验调用形状 `{provider, model}` 是对的，返回同形；不可解析时按「失败」处理而不是静默放行 |
| `agentDefaultModel` | `currentSelection(): ModelSelection`（含 provider/model） | 角色未声明模型时，spawn 的 `provider` 兜底取会话默认 provider；都没有则直接报错（不猜 provider 名） |

**已知限制（必须在 PRD/验收里如实标注，不得当成已实现）**

- **逐角色模型：请求里下发不了，但已通过 `agent/created` 装 member-scoped 路由真正生效**（2026-10-31 修复，QA D1）。`SpawnTeammateRequest` 确实没有 model/effort 字段（宿主 `spawnAdmitted()` 只把 `provider` 交给 `subagents.startActivation`），所以请求里附带的 `model/reasoningEffort` 只作观测证据；实际生效点是「创建事务内 serial、awaited 的 `agent/created`」——在监听里往**该成员自己的** `agent.ctx` 注册 `system-prompt/assemble` + `agent/request` 两个监听，把已解析的调用配置改写成角色声明的 provider/model（并剔除继承来的 reasoningEffort），语义与同机生产实现 `dsh-agent-team-presets` 的 `installModelSelection` 一致，且**不 import `@deepseek-ai/*`**（保持运行时零宿主依赖）。装不上（宿主 ctx 形状不认识）时仍如实落 `unverified`、面板标「未下发」，绝不静默回退队长模型。
- **`agent/created` 的 payload 已实测为 `{ agent, source, signal? }`**（宿主 `AgentRegistry.announce` → `await ctx.serial(entry.carrier, 'agent/created', …)`），成员名只从 `agentTeams.tryMembership(agent).name` 取；监听是 awaited 的，返回后才放行成员首个请求，因此「装路由」必须发生在监听内，不能等 dispatch 落盘 binding（那时还没 memberId）。

## 9. 已完成（grounded）与未完成（未验证）清单

### 9.1 已实际落地并验证（每条都有执行记录）

| 项 | 证据 |
|---|---|
| 目录结构 + 根配置文件 | 文件系统实际存在（受版本控制 49 个文件 + 本轮新增 `test/adapters.test.ts`） |
| 宿主 API 六处形状 | cordis_inspect_query 逐服务实测，见 §8 表；`adapters.ts` 按实测重写，全文无 `[待核]` |
| `pnpm typecheck` | `tsc --noEmit` exit 0（strict 全绿，adapters 重写后仍为 0） |
| `pnpm test` | 31 tests / 31 pass / 0 fail / 106ms（新增 4 例契约测试：工具 output、prompt `text`、HTTP 单路由四分支、缺 tools 只 warn） |
| `pnpm build` | client 33.38 kB + host 57.76 kB，exit 0 |
| 双产物可被 node 加载 | `index ok` / `client ok`，均 exit 0 |
| 打包内容 | 5 个文件 / 29.8 kB，含 `cordis.patch.yml`、`lib/client.js`、`lib/index.js` |
| 两个挂载面 key 真实存在 | `dsh-cost-meter`（`lib/client.js`）里实测使用 `conversation.composer.dock`；`dsh-better-sidebar` 源码里使用 `sidebar.right.pane.tab`；注册调用形态为 `slots.inject(name, () => slots.register({ name, id, order, … }, Component))`，与 `src/client/index.ts` 一致 |
| CI 配置 | `.github/workflows/ci.yml` 已写（未在 GitHub Actions 服务端跑过，仅本地等价命令全绿） |

### 9.2 未完成 / 未验证（**不得当作已达成**）

1. **未在真实 DSH Web GUI 里渲染过**：两个挂载面的 key 与注册形态已用真实插件源码 + mock loader 双向验证，但“组件真的出现在输入框下方 / 右栏页签真的出现 / 宿主 token 真的生效”必须装机后刷新页面确认。**这是本阶段最大的未验证面**。本轮试过 `cordis_inspect_query(platform:'client', provider:'Slots')`，返回 `Client inspect query Slots.listSubTree timed out after 10000ms`（页面侧无响应），按环境不可用处理，已停止重试，不编造 slot 树结果。
2. **`client` 侧 `register` 的 meta 是否需要 `inject` 字段未验证**：真实插件（dsh-cost-meter）在 meta 里带 `inject: () => ({...})`，本项目当前不带。缺它是否导致组件拿不到注入依赖尚未确认——装机第一件事就是验这个。
3. **逐角色模型的真机效果未验证**（见 §8 已知限制）：下发方式是 `agent/created` 里给成员 `agent.ctx` 装路由（已单测钉住「改写 agent/request 的 provider/model 并剔除继承 effort」），但「宿主真实成员是否确实按该模型跑」必须在真机看一次成员请求的路由；沙箱内只能用桩验证。
4. **`ctx.effect` / 卸载清理未接**：`setInterval` 由组件卸载清理，宿主侧副作用的注册形态未核实。
5. **未压测**：并发 3、单任务记忆 20 行是设计值。
6. **未在 CI 服务端跑过**；**未做 git commit**（提交由流水线统一处理）。
7. **真实 `agentTeams` 端到端未跑**：spawn → 成员执行 → sendMessage 续聊 → 门禁回执全链路需要真实成员，本轮只做了形状级适配与单元级断言。

## 10. 下一步（交给技术方案/开发阶段的顺序建议）

1. **装一次、看一眼**（由主 agent 执行）：`cd ~/.dsh/profiles/desktop && pnpm add file:<repo>`，刷新 GUI，确认开关行与右栏面板出现；同时验 §9.2 第 2 条（meta 是否需要 `inject`）。
2. 用真实成员跑一遍 `auto_team_plan → 派发 → sendMessage 续聊 → 门禁`，把 §8 的 `spawnTeammate`/`sendMessage` 从“形状正确”升级为“链路正确”。
3. 补 §9.2 第 4、5 条（卸载清理、并发压测），再收口验收。
