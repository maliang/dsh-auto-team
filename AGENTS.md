# AGENTS.md — 团队协作守则与文档索引（dsh-auto-team 产品线）

> 任何新加入本产品的 Agent（团队成员）必须先通读本文件，再按 §2 文档索引读取相关文档与任务卡片，不要自行全量探索项目。
> 维护者：团队本身 + TeamFlow 研发流水线（TeamFlow 仅维护文末 <!-- teamflow --> 托管区，其余内容为团队资产，不得改写）。

## 1. 产品是什么

- 产品：一个让当前 DeepSeek Harness 会话变成"队长"的插件：自动选角、把目标拆成有依赖的任务、并行派发可续聊的子 Agent、直连消息协调、实时活动面板 + 质量门禁；角色/模型/共享记忆均可由用户管理，记忆以 MD 管理（公共 + 项目双轨），并可在输入框下方一键启用/停用。
- 产品根：仓库根 `dsh-auto-team/`（本产品即单个 npm 包，**没有** `products/<product>/` 这一层；本文档中的相对路径都相对仓库根）
- 当前版本：0.1.0 脚手架（2026-10-30）

## 2. 文档索引（按职责）

| 职责 | 位置 | 说明 |
|---|---|---|
| 产品入口 | README.md | 安装/使用/开发命令速览 |
| 任务产物 | docs/teamflow/<yyyyMMdd-rN-slug>/ | 每个需求一个自包含任务夹：PRD/设计/技术方案/QA 报告/验收报告（按日期倒序即迭代史） |
| 架构总览 | docs/teamflow/architecture/ARCHITECTURE.md | 技术栈权衡、模块契约、目录树、构建/测试/CI、**未完成清单** |
| 架构参考 | docs/teamflow/architecture/SUPER-AGENT-MAPPING.md | Super-agent（DeepSeek 原型仓）→ 本插件的映射：能搬 / 需改造 / 不搬 + 分期 + 证据索引 |
| 宿主事实 | docs/teamflow/architecture/HOST-EVENTS.md | 宿主事件目录、emit/waterfall 取舍、`ToolExecution` 形状、inspect 的正确调用姿势（**查事件先读它，别自己调 inspect**） |
| 产品记忆 | docs/teamflow/memory.md | 团队约定/技术栈/已知待办（低频更新） |
| 运行日志 | logs/teamflow/<runId>/ → $DSH_HOME/teamflow/<workspace>/logs/<runId>/ | 只放**要留存**的东西（一次性检查脚本 scripts/、不可重跑的命令载荷 captures.json、结论笔记 .md）——**不制造命令输出 dump**；run 期间在项目内暂存，run 结束由 host 归档到 $DSH_HOME 并从项目删除 |

## 3. 团队角色与标准流程

**角色**：产品经理 / UI/UX 设计师 / 架构师 / 高级全栈工程师 / QA 测试工程师。

**标准流程**：需求 → PRD →（UI 改造时）UI/UX 设计 →（新项目时）架构规划 → 技术方案 → 并行开发 → QA 测试 → 产品验收。

**产出物落盘约定**：每个需求的所有产物写入该需求的任务夹 docs/teamflow/<任务夹>/（夹名与路径由 TeamFlow 指定）；ARCHITECTURE.md 与 memory.md 是产品级长期文档。**除实际产品代码改造与 AGENTS.md 托管区外，TeamFlow 只在 docs/teamflow/ 与 logs/teamflow/ 下写文件，绝不写入宿主 docs/<职责>/ 或项目根**。

**完成度自查**：每个环节交付前对照职责清单自查，未完成不得流转；架构师对新项目必须实际初始化脚手架文件与 AGENTS.md 草稿。

## 4. 工程约定

**代码形态**
- 单包双产物：宿主 `lib/index.js`（ESM, node22）、client `lib/client.js`（CJS + `__ModuleLoader__` 套壳）。**`lib/` 必须入库**（profile 安装源就是它），`.gitignore` 不忽略 `lib/`。
- 目录分层与依赖方向铁律：`src/shared`（纯类型） ← 被 `src/host` 与 `src/client` 引用；**host 与 client 之间零直接 import**，只通过 `GET/POST /api/auto-team` 通信。
- 宿主 API 只允许在 `src/host/adapters.ts` 里出现；其余模块不得直接碰 `ctx.*`。宿主形状变动时只改这一个文件。

**可编译 / 可测的关键约定**
- 所有本地 import 必须带显式 `.ts` 扩展名（为了 `node --test` 直接跑 TS 源 + `allowImportingTsExtensions`）。
- 纯逻辑模块（`plan/graph.ts`、`plan/plan.ts`、`memory/inject.ts`、`roles/builtin.ts`、`memory/repo.ts`）**不许 import 宿主或本地非纯模块** —— 这是它们能被单测的前提。
- `tsconfig` 的 `jsx` 必须是 classic `"react"`：client 产物的 `require` 由宿主提供，只保证解析 `react`，不保证 `react/jsx-runtime`。
- client 产物必须保留 `if (typeof window !== "undefined" && window.__ModuleLoader__)` 守卫（否则 `node --input-type=module -e "await import('./lib/client.js')"` 会因 `window is not defined` 失败）。
- `cordis.patch.yml` 的 `name` 必须是包根名 `dsh-auto-team`；写子路径会让宿主的 clientModules 扫描跳过本插件（症状：工具在、面板永远不出现）。
- 前端样式只用宿主 token；**字号写 `font: var(--dsw-font-xs-13, …)`，不许写 `font-size: var(...)`**（该 token 是 font 简写复合值，写 font-size 是无效声明且静默继承父级字号）。
- 前端读接口必须解构 `{data,error}` 包装（本项目历史高频 bug 族：整包赋值导致界面"点了没反应"）。

**验证命令（提交前必须全绿）**
```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # node --test test/*.test.ts（当前 216 例）
pnpm build       # 双产物
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run   # 必须含 lib/index.js / lib/client.js / cordis.patch.yml
```

**探针脚本的可重跑前提**
- `logs/teamflow/<runId>/scripts/*.mjs` 里的探针一律用 `new URL('../../../../', import.meta.url)` 锚定**仓库根**。run 结束后 host 会把 `logs/` 归档到 `$DSH_HOME/teamflow/<workspace>/logs/<runId>/`；从归档位置直接 `node` 跑这些脚本，相对根会解析成 `~/.dsh/teamflow/` → 报 `依赖模块未落盘 / ERR_MODULE_NOT_FOUND`，**看起来像交付坏了，其实只是位置变了**（r4 验收复核时实测：归档位置 9 个探针 6 个红）。要复跑必须先 `cp -r` 回 `<repo>/logs/teamflow/<runId>/scripts/`，跑完删掉（`logs/teamflow/` 已在 `.gitignore`）。报告任何「探针红」之前，先确认脚本是不是从归档位置跑的。

**与宿主联调的常识**
- 本机 `dsh` 不在 PATH：安装走 `cd ~/.dsh/profiles/desktop && pnpm add file:<repo>`，并同步 `dsh.profile.bundles`；安装只能由主 agent 执行。
- 宿主实际 API 形状（工具定义、prompt section、route、`spawnTeammate` 返回值、`resolveCallConfig`）**尚未全部核实**，见 ARCHITECTURE §8.2；任何"已验证"声明必须附命令与返回值，不得凭记忆断言。
- **`cordis_inspect_query` 的 `input` 必须是对象**（主 agent 2026-11-01 实测）：列全部用 `input: {}`；查单个事件/服务用 `input: {"event": "<name>"}` / `input: {"service": "<name>"}`。传字符串、数组或省略成非对象时会返回 `rejected input: "input" must be an object`——**这是调用姿势错误，不是环境不可用**，不要把阶段判成 env-unavailable 然后反复重试（已有**三轮**因此烧穿阶段 token 预算：r1 scaffold、r4 tech、r5 dev-T5，累计约 700k 新增 token）。
- **查宿主事件先去读 `docs/teamflow/architecture/HOST-EVENTS.md`**（已核实的 76 条事件目录、emit/waterfall 取舍、`ToolExecution` 形状、作用域规则）。那里没有你需要的，再按上一节的姿势调 `cordis_inspect_query`；**一次调用取不到就换姿势或读源码 `/tmp/dsh-src/`，不要用同一形状重试**。
- **观测工具调用要订阅 `tools/result`，不要订阅 `tools/execute`**：`tools/result` 是 `emit`（签名 `(exec: Readonly<ToolExecution>, result)`，监听器异常会被隔离），`tools/execute` 是 `waterfall`（必须 `next()`，漏调就吞掉工具执行、改错信号会破坏取消链）。宿主文档原文：`tools/result` 的 scope 过滤 **keyed by `exec.agent`**——在 `agent.ctx` 上注册的监听器**只收到该 agent 的调用**，`src/host/adapters.ts` 的 `agentContextOf(agent)` 可直接复用，不必按 id 过滤、不必装全局监听。
- `exec` 形状（宿主 `ToolExecutionInput` + `rootCallId` + `token`）：`callId` / `rootCallId?` / `name` / `schema?` / `arguments` / `agent?: Agent { readonly id: SessionId }` / `parent?: ToolExecutionToken` / `signal`。嵌套子调用 `parent` 非空、`agent` 仍指向所属成员。

<!-- teamflow:begin -->
## TeamFlow 托管区（本块由 TeamFlow 自动维护，团队请勿手改）

- 团队文档根：docs/teamflow/（每需求一个任务夹 + memory.md + architecture/）
- 运行日志：logs/teamflow/<runId>/（run 期间的项目内暂存；run 结束由 host 归档到 $DSH_HOME/teamflow/<workspace>/logs/<runId>/，项目内不留存）
- 需求/任务/缺陷 backlog：持久化镜像位于 $DSH_HOME/teamflow/<workspace>/（按工作区/项目隔离）
- 规则：TeamFlow 只维护本块、docs/teamflow/ 与 logs/teamflow/；本文件其余内容为团队资产。
<!-- teamflow:end -->

## 5. 变更记录

- 2026-10-30：创建本文件（TeamFlow 脚手架）。
