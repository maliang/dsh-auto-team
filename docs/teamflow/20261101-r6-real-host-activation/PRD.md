<!-- meta: summary="修复 dsh-auto-team 在真实宿主中不激活（host inject 缺 6 个服务）与右栏页签不渲染（keyed slot 缺 key、两处都缺 inject）两处加载契约缺陷，并加可判红的一致性守卫与主 agent 可复跑的真机验证步骤" -->
基线依赖：docs/teamflow/20261101-r5-super-agent-p2p3/（其已交付行为不得回归）
取代：docs/teamflow/20261101-r5-super-agent-p2p3#AC-21：门禁判据升级 ——「test 全绿 + 双产物 import 干净 + pack 3 条目」不再充分，必须叠加真实宿主激活与 UI 真渲染判据（见本夹 AC-13/AC-14/AC-17）。

# r6 · 真机激活与渲染修复（PRD）

## 1. 背景与目标

### 1.1 两处致命缺陷（实测原文，非推测）

此前 r1~r5 的全部单测（216→311 例）、全部探针、全部验收 AC 都是对着 **mock ctx** 跑的。主 agent 用「克隆 desktop profile 为 dv + 在 51890 端口真启动第二个宿主 + 无头浏览器抓控制台 + curl 抓页面 HTML」实测，发现真实宿主里插件**从未激活过**：

**缺陷 1（host 半，致命）：插件根本没有激活**

```
dsh: warning: 1 entry did not activate
auto-team-host (dsh-auto-team): Error: cannot get property "agentTeams" without inject
  栈：createSpawnPorts (lib/index.js:2294:20) / new apply (lib/index.js:5816:21)
```

- 根因：`src/host/index.ts:69` 只声明 `export const inject = ['tools', 'systemPrompt']`；而 `apply` 及其下游实际访问 `ctx.agents` / `ctx.agentTeams` / `ctx.webServer` / `ctx.llm` / `ctx.agentDefaultModel`。
- 宿主判据（`@deepseek-ai/cordis/lib/index.js` 的 `ReflectService.handler.get`）：对未注入属性**直接抛错** `cannot get property "<name>" without inject`。
- cordis 的 inject 语义（已实测，禁止臆测）：`inject` 是普通 map（服务名 → 配置），**数组形式 = 全部 required**；对象形式 `{ required, optional }` 是**错的** —— 宿主会把 `required`/`optional` 当成服务名，报 `pending (waiting for services: required, optional)`。**cordis 不支持 optional 分组**：可选服务只能用 `ctx.get("<name>")` 读（缺失返回 undefined、不抛错），硬依赖才写进 inject。
- 已验证的修复方向（在 dv 副本上试过、未动仓库）：`inject` 补成 `["tools","systemPrompt","agents","agentTeams"]` + 三处可选服务改 `ctx.get` → boot 日志**零 warning**。

**缺陷 2（client 半，致命）：右栏页签注册被宿主直接抛错**

```
Uncaught Error: keyed slot "sidebar.right.pane.tab" requires options.key
```

- 位置：`src/client/index.ts:43-58`，两处都是 `ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, id: ..., order: ... }, Comp))` —— `sidebar.right.pane.tab` 是 **keyed slot**，必须带 `key`；且两处都**没传 `inject`**，组件拿不到 `sessionId`。
- 参考实现（同宿主内已装第三方插件 `dsh-better-sidebar` 实测）：`sidebar.right.pane.tab` 的写法是
  `ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name: "sidebar.right.pane.tab", key: id, inject: (sessionId) => ({ ...props, sessionId }) }, Body))`；
  同一处还为每个 tab 注册了 `sidebar.right.pane.tab.title`。而 `conversation.composer.dock` **不是 keyed**，写法是 `{ name, id, order, inject }`。
- 已确认「好的那一半」：首页 HTML 的批量 URL 里**确实含** `dsh-auto-team/client.js`，该批量包（11.96 MB）内 `dsh-auto-team-toggle` ×23、`dsh-auto-team-panel` ×38、「自动团队」×9 —— client 产物被正确服务与加载，故障只在注册调用。

### 1.2 为什么 311 条单测全绿却零拦截

单测全部通过 `apply(fakeCtx)` 走 —— fakeCtx 是「所有字段都在」的普通对象，**不模拟 cordis 的 inject 判据**，所以「没声明就访问」永远不报错；`register` 也没校验 keyed slot 必填 `key`。**判据与被测系统之间没有共享的同一条契约**，这是本轮要补的根本缺口，而不是两个孤立 bug。

### 1.3 目标

1. 修 host 半：inject 清单与实际访问面一致；未在 inject 的服务一律走 `ctx.get`，并把这条纪律写死在 `src/host/adapters.ts` 的唯一入口。
2. 修 client 半：keyed slot 用 `key`、两处注册都传 `inject`（sessionId 可达）；开关行与右栏页签在真实宿主里**真的出现**。
3. 加一致性守卫单测：inject 清单 vs `apply` 期间访问的 ctx 属性集合，漏一个就红，且**删掉 inject 项必然变红**（变异自检）。
4. 交付一条主 agent 可复跑的真机验证步骤，并把实跑结论写进验收报告。

**一句话产品语义**：让插件从「单测里的插件」变成「宿主里能亮、能用、能点的插件」。

## 2. 用户故事（每条带可测判据）

- **US-1（用户，最痛）** 我重启宿主后，插件就被激活，boot 日志里没有 `1 entry did not activate`、没有 `without inject`，不用我另开会话去查为什么面板不出现。→ AC-1、AC-2、AC-3、AC-5
- **US-2（用户）** 输入框下方看得到「自动团队」开关行，右栏出现「自动团队」页签，点开有内容；浏览器控制台干干净净。→ AC-6、AC-7、AC-8、AC-9
- **US-3（下一位开发者）** 我下次再往 `apply` 里加一个宿主服务却忘了登记，单测立刻红，并直接告出是哪个服务名。→ AC-2、AC-4
- **US-4（验证者/主 agent）** 我照一条命令就能复跑真机验证，拿到逐步 PASS/FAIL，不用自己回忆上次是怎么起的第二个宿主。→ AC-12、AC-13、AC-14、AC-15
- **US-5（产品）** 修复没有改动任何已定产品行为、预算常量与降级语义，也没有把主人真正的 desktop 宿主弄坏。→ AC-10、AC-11、AC-16、AC-17、AC-18

## 3. 验收标准（AC-1 ~ AC-18）

> 编号在本夹内从 AC-1 起，与 r5 的 AC 编号无关。所有「判定」栏必须贴**实跑输出**（命令原文 + 返回值原文），不得以「看着对」代替。

| AC | 一句话判据 | 优先级 | 覆盖交付契约* |
|---|---|---|---|
| AC-1 | profile 层加载入口声明存在且 `name` 用包根名 | P0 | 契约 1 |
| AC-2 | inject 清单 ⊇ 裸访问面，可选服务走 `ctx.get`，纪律写进 adapters | P0 | 契约 1（+需求 1） |
| AC-3 | 真实宿主 boot 日志零 warning 且 entry 激活 | P0 | 契约 9（+需求 3） |
| AC-4 | 一致性守卫测试存在，删 inject 项必然变红（变异自检） | P0 | 需求 2 |
| AC-5 | 双产物模块顶层不抛错、零服务访问 | P0 | 契约 8 |
| AC-6 | keyed slot 带 `key` + 两处带 `inject(sessionId)` | P0 | 契约 3（+需求 1） |
| AC-7 | 挂载点 `name` 与 `inject` 参数逐字相同，插件标识进 id/key | P0 | 契约 3 |
| AC-8 | 真机 DOM 里开关行与右栏页签真的出现 | P0 | 契约 3（端到端） |
| AC-9 | client 声明块字段集合与样本一致 + 产物非空且含包 id | P1 | 契约 2 |
| AC-10 | 入口声明与双产物都在 `files` 白名单并被 pack 收进 | P1 | 契约 4 |
| AC-11 | 依赖协议可解析（0 处 `workspace:`）+ peer 覆盖宿主包 | P1 | 契约 5、6 |
| AC-12 | 产物与源码同步（含 profile 内那份拷贝） | P0 | 契约 7 |
| AC-13 | 一条可复跑的真机验证脚本 + 三步步骤原文 | P0 | 契约 9、11 |
| AC-14 | 主 agent 实跑结论进验收报告（未跑 = 不通过） | P0 | 契约 9、11 |
| AC-15 | 安装带回滚（反向步骤先写后装，失败立即恢复） | P0 | 契约 10 |
| AC-16 | desktop 真宿主在验证期间零污染 | P1 | 契约 9（边界） |
| AC-17 | 全量门禁 + r4 复核不降 + 上期三条 P3 零改动 | P0 | — |
| AC-18 | 不夹带：预算常量/路由/PanelAction/kind/setInterval 逐字不变 | P1 | — |

\* 「交付契约」= 本条需求分诊为 `plugin-full` 后必须落成 AC 的那 11 条客观契约，映射见附录 C。

### AC-1 加载入口声明（host 半）

- 判据：`package.json` 的 `dsh.bundle.patch` 指向 `./cordis.patch.yml`（该文件存在）；文件内含 `- insert:` 块下 `id: auto-team-host` 与 `name: 'dsh-auto-team'`，其中 `name` **逐字等于** `package.json.name`（包根名）。`dsh` 块的字段集合与同机样本 `dsh-plugin-teamflow` 逐字段对齐：`manifestVersion` / `bundle.patch` / `client{platform,inject,immediately}`，不自行发明字段。
- 判定：
  ```bash
  node -e "const p=require('./package.json');console.log(p.name, p.dsh.bundle.patch, JSON.stringify(Object.keys(p.dsh)))"
  grep -nE "^( {4}- id:| {6}name:)" cordis.patch.yml
  ```
- 证据：两行输出原文 + `name` 值逐字相等的断言。
- 现状：已满足（`cordis.patch.yml` 的 `name: 'dsh-auto-team'`）。本 AC 的作用是**把它纳入判据**，防止后续演进（改名/加子路径）静默失效。

### AC-2 inject 完备性与 `ctx.get` 唯一入口纪律

- 判据：
  1. 「`apply` 期间可达的 `ctx.<service>` 裸访问集合」⊆ `inject` 数组 ∪ 已登记可选白名单；不在 `inject` 的可选服务**必须**经 `ctx.get('<name>')` 读取。
  2. 纪律写进入口：`src/host/adapters.ts` 顶部有明确注释条款（未声明服务一律 `ctx.get`，禁止裸访问），且可选服务读取收敛到该文件的单一入口函数（形如 `optionalService(ctx,'agentTeams')`），其余模块不直接 `ctx.<可选服务>`。
  3. `inject` 只放**硬依赖**（缺失即无法工作的服务）；把 `webServer`/`llm`/`agentDefaultModel` 这类"缺了就降级"的服务塞进 inject 视为**违规**（会让整插件在它们缺失时加载失败，破坏 r5 的降级语义）。
- 判定：
  ```bash
  # ① 实测访问面（当前基线输出见附录 A-1）
  grep -rhoE 'ctx\.(tools|systemPrompt|agents|agentTeams|webServer|llm|agentDefaultModel|slots)' src/host src/client | sort | uniq -c
  # ② 可选服务读取面
  grep -c 'ctx\.get(' src/host/adapters.ts
  # ③ inject 清单
  grep -n "export const inject" src/host/index.ts
  ```
- 证据：①②③ 输出 + 「应覆盖 N 个服务 / 实覆盖 N 个」一行对账。
- 现状（修复前，实测）：裸访问 = {tools, systemPrompt, agents, agentTeams, webServer, llm, agentDefaultModel, slots}；inject 仅 2 项；`ctx.get(` 在 `src/host` **0 处命中** → 本 AC 现在必红。
- 硬约束：最终 `inject` 至少含 `tools`、`systemPrompt`、`agents`、`agentTeams`（前两者是本插件功能主体，后两者是 `apply` 装配期即访问的硬依赖）；`webServer` / `llm` / `agentDefaultModel` 一律 `ctx.get` 且缺失时**功能降级、不抛错**（对 `apply` 返回值与工具可用性各有可读 warn）。

### AC-3 真实宿主 boot 零 warning

- 判据：用真实宿主按附录 B 启动后，boot 日志满足三条：`1 entry did not activate` 命中 0 行、`without inject` 命中 0 行、且出现 `auto-team-host` 已被激活的正面证据（该 entry 不再出现在未激活清单中；或它注册的工具/路由在宿主里可枚举到其一）。
- 判定：`grep -cE '1 entry did not activate|without inject' <boot.log>` = 0，并贴 boot 日志 ≥3 行原文。
- 证据：boot 日志原文（含启动时间与端口）+ 上面那条 grep 的计数。

### AC-4 一致性守卫 + 变异自检（必红）

- 判据：
  1. 新增守卫测试（建议 `test/host-contract.test.ts`，名字可变但必须在 `pnpm test` 的 `test/*.test.ts` glob 内），正确代码下通过。
  2. 变异自检：从 `inject` 数组里**删掉任一项**（推荐删 `'agentTeams'`），重跑该测试**必然变红**，且红的原因必须是**断言失败文本**（含被点名的服务名，例如 `AssertionError: ctx.agentTeams 未在 inject 中登记`），**不是** TypeError / 编译错 / 文件读不到。
  3. 反向自检：把同一项加回去 → 立刻转绿。贴红/绿两段输出。
  4. 断言必须基于**源码扫描的结构化集合**（从 `src/host/*.ts` 提取 `ctx.<name>` 标识符集合，去掉注释与 `ctx.get`），不得用"整文件字符串包含"这种可被注释命中的写法（见反面目标 5）。
- 判定：
  ```bash
  node --test test/host-contract.test.ts        # 绿
  # 手工删掉 inject 里的 'agentTeams' 后重跑            # 必须红，且红文本含 agentTeams
  ```
- 证据：绿/红两段输出 + 恢复后再次全绿的一行。

### AC-5 装载安全：双产物模块顶层不抛错

- 判据：两个产物的模块顶层都不访问任何宿主服务、不读盘、不 throw：
  ```bash
  node --input-type=module -e "await import('./lib/index.js')"; echo exit=$?
  node --input-type=module -e "await import('./lib/client.js')"; echo exit=$?
  ```
  两条均 `exit=0`；并断言 `lib/client.js` 保留 `window.__ModuleLoader__` 守卫（否则纯 Node 下 `window is not defined`）。
- 证据：两条 exit 码 + 守卫字符串 `grep -c '__ModuleLoader__' lib/client.js` ≥1。
- 说明：这是"装上后宿主起不来"的 P0 防线（历史实锤：旧 `lib/index.js` 装进 profile 后宿主启动即炸）。

### AC-6 keyed slot 注册契约

- 判据：`sidebar.right.pane.tab` 的注册 options 必须含 `name: 'sidebar.right.pane.tab'`、**`key`（非空字符串、稳定、本项目内唯一）** 与 `inject: (sessionId) => ({ sessionId, ... })`；`conversation.composer.dock` 保持非 keyed（`name` / `id` / `order` / `inject`）。keyed 那个**不得用 `id`/`order` 冒充 `key`**。
- 判定（单测，驱动真实 `apply(fakeSlots)`，记录 `inject(name, fn)` 与 `register(options, Comp)` 调用）：
  - keyed 那次的 `options.key` 存在、`typeof === 'string'`、长度 > 0；
  - 其 `inject` 是函数，调用 `options.inject('sess-1')` 返回对象且 `sessionId === 'sess-1'`；
  - dock 那次的 `options.id` 存在且 `options.key === undefined`（非 keyed）。
- 证据：测试输出 + 真机控制台 `grep -c 'requires options.key'` = 0。

### AC-7 挂载点 `name` 与 `inject` 参数逐字相同

- 判据：对每个挂载点，`ctx.slots.inject(X, ...)` 的 `X` 与内部 `register({ name: Y })` 的 `Y` **字符串全等**（不是前缀/子串/大小写归一）；插件自身标识只能出现在 `id`（非 keyed）或 `key`（keyed）里，**不得混进 `name`**。
- 判定（单测）：从 fake slots 记录里取「inject 名列表」和「register.name 列表」，逐对全等断言；并加一条**反向断言**：`register.name` 中不得包含 `PLUGIN_ID`（写成插件的名字 → 与 slot 名对不上 → 静默不挂载，历史实锤）。
- 证据：测试输出 + 打印的 (inject 名, register 名) 两列对照。

### AC-8 真机 UI 真渲染（端到端判据）

- 判据：真实宿主 GUI 上，DOM 同时满足：
  1. 输入框下方存在开关行：`[data-toggle-label]` 存在且其文本含「自动团队」（`src/client/Toggle.tsx:78`）；开关可点击并切换 `aria-pressed`/`aria-label`。
  2. 右栏存在可点击的页签，标题含「自动团队」，点击后出现面板根节点 `[data-dsh-auto-team-panel]`（`src/client/Panel.tsx:128`），页签条渲染出 4 个 `[data-panel-tab]`（计划/成员/记忆/角色）。
  3. 全程控制台 **0** 命中 `requires options.key`、0 个 `Uncaught`。
- 判定：无头浏览器 dump `document.body.innerHTML` 后 grep 上述属性与文案，贴命中行；控制台日志文件 grep 计数为 0。
- 说明：**这一条是本次的母判据** —— 前面所有 AC 都可能绿而它仍红；它红 = 需求未交付。
- 若真机发现页签无标题/不可点：允许在同一修复内补注册 `sidebar.right.pane.tab.title`（同 key 语义，不算夹带），并把实测依据写进 TECHNICAL。

### AC-9 client 声明与产物

- 判据：`package.json` 的 `dsh.client` 字段集合与同机样本逐字段一致（`platform: "web"` / `inject: [7 个 @deepseek-ai/dsh-client-*]` / `immediately: false`）；`lib/client.js` 非空、含包 id `dsh-auto-team`、含 `__ModuleLoader__` 守卫。
- 判定：
  ```bash
  node -e "const c=require('./package.json').dsh.client;console.log(c.platform, c.immediately, c.inject.length)"
  ls -l lib/client.js; grep -c 'dsh-auto-team' lib/client.js; grep -c '__ModuleLoader__' lib/client.js
  ```
- 证据：输出原文（inject 计数 7、文件大小、两处计数 ≥1）。

### AC-10 分发白名单

- 判据：`package.json.files` ⊇ {`lib`, `cordis.patch.yml`, `README.md`}；`npm pack --dry-run` 的条目列表同时含 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`，且**不含** `src/`、`test/`、`logs/`、`docs/`。
- 判定：`npm pack --dry-run 2>&1 | grep -cE 'lib/index.js|lib/client.js|cordis.patch.yml'` = 3；并贴 pack 的条目清单。
- 说明：漏进白名单 = 装进 profile 后不加载（契约 4 原话）。

### AC-11 依赖协议与宿主模块声明

- 判据：`package.json` 全文 **0** 命中 `workspace:`；`peerDependencies` 覆盖宿主提供的 `@deepseek-ai/*` 包（7 个 client 包 + `react`），`peerDependenciesMeta` 把它们全部标 `optional: true`；`engines` 声明 `node`/`dsh` 范围。
- 判定：`grep -c 'workspace:' package.json` = 0；`node -e` 打印 peer 键集合与 optional 计数，与 `dsh.client.inject` 的 7 个包名逐项对齐。
- 证据：0 计数 + 两集合对账（缺一个即红）。

### AC-12 产物与源码同步（含 profile 内那份拷贝）

- 判据：
  1. `pnpm build` 后 `find src -newer lib/index.js -o -newer lib/client.js | wc -l` = 0；
  2. 双产物含本次修复的特征串（例如 `ctx.get(` 出现在 `lib/index.js`、keyed 注册的 `key:` 出现在 `lib/client.js`）；
  3. **profile 内那份拷贝同步**：`~/.dsh/profiles/<profile>/node_modules/dsh-auto-team` 是**实体拷贝**（实测 `ls -ld` → `drwxr-xr-x@ ... Nov 1 10:39`，不是 symlink，`file:` 协议装的是副本），因此真机验证前必须重新 `pnpm add file:<repo>`；断言 `shasum -a 256` 的 repo 侧与 profile 侧 `lib/index.js` **相等**，`lib/client.js` 同样相等。
- 判定：上面三条命令输出；第 3 条贴两个 sha256 值。
- 说明：历史实锤「旧 lib 装进 profile 后宿主启动即炸」就是这条没被验。

### AC-13 可复跑的真机验证（脚本 + 三步）

- 判据：交付一份 `real-host-verify.sh`（放 `logs/teamflow/<runId>/scripts/`，用 `REPO` / `PROFILE` / `HOST_PORT` 环境变量覆盖，默认探测，**不得写死 profile 名与路径**），一次跑完输出逐步 `✓/✗` 摘要，覆盖三步：
  1. **准备 profile**：`pnpm add file:$REPO`（幂等重装，取最新 `lib/`）+ 确认 profile `package.json` 的 `dsh.profile.bundles` 含 `dsh-auto-team`（缺失则补，补法从包的 `dsh.bundle.patch` 声明推导）。
  2. **启动宿主**：以 web 模式启动第二个宿主，端口 `HOST_PORT`（默认 51890），stdout/stderr 重定向到 `logs/teamflow/<runId>/`（或 /tmp，**不得写到仓库根**）。
  3. **断言四件事**：boot 日志无 warning（AC-3）、首页 HTML 的批量 URL 含 `dsh-auto-team/client.js`、无头浏览器控制台无 `Uncaught`/`requires options.key`、DOM 出现 `[data-toggle-label]` 与 `[data-dsh-auto-team-panel]`（AC-8）。
- 判定：脚本可被主 agent 一条命令跑完（`bash real-host-verify.sh`），并打印 PASS/FAIL；步骤原文同时抄进 `ACCEPTANCE.md` 附录（含上一轮实测确认的启动命令原文）。
- 说明：本机 `dsh` **不在 PATH**，走等价手动步骤；启动命令的准确形式**以主 agent 上一轮实测为准**，仓库内无留档 → 见待澄清 Q1。

### AC-14 主 agent 实跑结论进验收报告

- 判据：`ACCEPTANCE.md` 必须包含：① boot 日志原文 ≥3 行（含 `auto-team-host` 与端口/时间）；② 控制台输出原文（含 0 报错的证据）；③ DOM 断言输出原文（属性与文案命中行）；④ 一行明确「由主 agent 于 YYYY-MM-DD 在 `<profile>`（端口 NNNN）实跑」。
- 判定：验收报告缺任一项 → **本 AC 不通过 → 整体不得验收**；把结论写成「人工补测」「环境限制未验」一律判不通过（历史实锤：AC-7 被列为"人工补测"后无人真跑，用户装完才发现问题）。
- 说明：子代理权限被钉死在工作区（会话原文 `permission scope was fixed ... cannot be widened`）→ 装不了 profile；因此这一步**只能由主 agent 执行**，PRD 不因"子代理跑不了"而放行。

### AC-15 安装带回滚

- 判据：
  1. 安装**前**，安装步骤旁写明反向操作并可直接复制执行：`cd "$PROFILE" && pnpm remove <包名>`，并从 profile `package.json` 的 `dsh.profile.bundles` 摘除 `<包名>`；包名从产物 `package.json` 读（`node -p "require('./package.json').name"`），**不写死**。
  2. 装后验证失败 → **立即**执行卸载（不等下一轮），并贴恢复后的 boot 日志（本项目相关报错 0 行、宿主仍能起）。
  3. 回滚后 `dsh.profile.bundles` 与安装前逐字一致（diff 为空）。
- 说明：历史实锤「装上后宿主起不来，只能另开 agent 手术卸载才能救回宿主」——所以回滚步骤必须先写后装。

### AC-16 desktop 真宿主零污染

- 判据：真机验证全程在**克隆 profile**（现成 `dv`，克隆自 `desktop`）内进行；验证前后对 desktop 取两次指纹，逐字相等：
  ```bash
  shasum -a 256 ~/.dsh/profiles/desktop/package.json
  shasum -a 256 ~/.dsh/profiles/desktop/node_modules/dsh-auto-team/lib/index.js
  ```
- 证据：两组 sha256（前/后）+ 一句「本需求未在 desktop 上做任何装/卸」。
- 说明：desktop 是主人日常在用的宿主，**不允许**拿它做实验。

### AC-17 全量门禁与不回归

- 判据（逐条贴输出）：
  ```bash
  pnpm typecheck                                   # 0 错误
  pnpm test                                        # 全绿，通过数 ≥311（新增守卫测试计入，打印实际数）
  pnpm build                                       # 双产物新鲜
  find src -newer lib/index.js -o -newer lib/client.js | wc -l   # 0
  node --input-type=module -e "await import('./lib/index.js')"   # exit 0
  node --input-type=module -e "await import('./lib/client.js')"  # exit 0
  npm pack --dry-run 2>&1 | grep -cE 'lib/index.js|lib/client.js|cordis.patch.yml'  # 3
  ```
- r4 复核不降：reverify 9/9 + collision 12/12（脚本从归档位置复跑前须先 `cp -r` 回 `<repo>/logs/teamflow/<runId>/scripts/`，AGENTS.md 已载明"归档位置跑相对根会解析错"）。
- 上期三条 P3 零改动：`src/host/index.ts:195` name 兜底 / peer 失败重投 / `store.list` 线性 —— `git diff --stat` 对这三处的改动行数 = 0。
- 证据：每条命令 + 输出；测试通过数与 ≥311 的对比。

### AC-18 不夹带：已定行为逐字不变

- 判据（grep 断言，逐条计数）：
  - 预算/时序常量逐字不变：`MEMORY_INJECT_BUDGET = 4000`（`src/host/config.ts:31`）、`WATCHER_INTERVAL_MS = 1500`（:52）、`STALL_MS = 90_000`（:62）、`NOWAIT_THRESHOLD_MS = 5_000`（:82）、`TRIGGER_DEDUPE_MS = 60_000`（:91）、`PANEL_ACTIVE_MS`/`PANEL_IDLE_MS` 来自 `src/shared/const.ts` 且值不变。
  - `setInterval` 全仓仍**只在** `src/host/team/watcher.ts` 出现（**不按行号断**：r5 报告写 :247，实测现为 :265 —— 行号会漂，判据写成"仅该文件 1 处"）。
  - `PanelAction` 仍 11 个成员、HTTP 路由 0 新增（`registerHttpBridge` 的 path 集合不变）、`TRIGGER_KINDS` 恰 4 个、Trigger Slow 默认关闭（off 时行为与"不存在"一致）。
  - 产品行为零变化：不改 PRD/DESIGN 里已定的行为；本夹改动只允许落在「加载/注册契约 + 守卫测试 + 验证脚本」范围。
- 证据：每条 grep 输出；`git diff --stat` 全量列出（供人一眼看有没有夹带）。

## 4. 范围与非目标

**范围内**
- `src/host/index.ts` 的 `inject` 清单与 `apply` 装配期可选服务读取方式；`src/host/adapters.ts` 的唯一入口纪律（`ctx.get` 收敛 + 注释条款）。
- `src/client/index.ts` 两处 slot 注册（keyed 用 `key`、两处 `inject(sessionId)`）。
- 新增一致性守卫单测（含变异自检）。
- 真机验证脚本 + 验收报告里的实跑结论。
- `lib/` 双产物重建（必须入库，`pnpm add file:` 的安装源）。

**非目标（本期不做）**
- Trigger Slow 语义层（保持默认关闭的"只留位"现状）。
- 上期遗留三条 P3（`index.ts:195` name 兜底 / peer 失败重投 / `store.list` 线性扫描）。
- 产品行为与交互设计变更（面板四页、开关语义、AC-1~AC-26 的 r5 已定行为）。
- 更换 UI 挂载点、改 slot 名、改插件 id/包名。
- 发布到插件市场 / 桌面 App 安装器、CI 接入、多 profile 管理。
- 性能与包体积优化（11.96 MB 的批量包不在本期优化范围）。

## 5. 反面目标（anti-goals）

> 「技术上跑通了，人还是会拒绝」的形态。每条都能被人当场看出来。

1. **宿主激活了，但界面还是什么都没有**：只把 `inject` 补齐、boot 日志干净了，可输入框下方仍然没有开关行、右栏仍然没有页签 —— 用户视角与修复前零差别。（这正是「只修一半」最容易出现的结局，因为两处缺陷不同族。）
2. **报告写"已修复"，但没人真的在宿主里点过**：单测全绿、boot 有日志、验收报告把真机验证写成"人工补测/环境限制"，最后用户装完自己发现面板不出现 —— 上一轮的真实失败就是这一条。
3. **为了日志干净把可选服务塞进 inject**：`webServer`/`llm`/`agentDefaultModel` 全进 inject，日志是干净了，但宿主缺任一服务时**整个插件加载失败**（把 r5 的降级语义整体推翻），而且下次宿主版本删掉某个服务，插件再次全灭。
4. **守卫测试不承载信息**：删掉 `inject` 项它还是绿（断言只看"数组非空"），或者它红是因为注释里出现了 `ctx.agents`（字符串包含），或者它是 TypeError 而不是断言失败 —— 三种都等于没有守卫。
5. **把主人的 desktop 宿主搞坏**：在 desktop profile 上反复装/卸做实验，导致主 GUI 起不来、`dsh.profile.bundles` 被改乱，用户不得不另开会话手术恢复。
6. **验证步骤写死本机细节**：脚本里硬编码 `desktop`/`dv`、用户目录、端口、启动命令，换台机器或 profile 改名后照抄即失败，而报告仍写"可复跑"。

## 6. 交互与验证流程摘要

**用户视角（修复后的期望体验）**
1. 启动宿主 → boot 日志无 `1 entry did not activate`；插件 entry 激活。
2. 打开会话 → 输入框下方出现「自动团队」开关行（可开可关，只改开关不派发）。
3. 右栏出现「自动团队」页签 → 点开有 计划/成员/记忆/角色 四页，数据来自 `/api/auto-team`。
4. 浏览器控制台无 uncaught error（尤其无 `requires options.key`）。

**验证流程（主 agent 执行，子代理无法执行）**
1. 构建并同步：`pnpm build`（双产物）→ 在**克隆 profile** 内 `pnpm add file:<repo>`（幂等重装，覆盖旧副本）→ 校验 `shasum` 两侧相等（AC-12）。
2. 启动第二个宿主（web 模式，端口 51890），日志落到 `logs/teamflow/<runId>/`。
3. 断言四件事：boot 无 warning / 页面 HTML 含 `client.js` / 控制台无 uncaught / DOM 有开关行与面板根节点（AC-3 + AC-8）。
4. 失败即回滚（AC-15），成功则把三份原文写进 `ACCEPTANCE.md`（AC-14）。

**开发视角的顺序（建议）**
宿主半（AC-2 → 供电 AC-1/AC-5）→ client 半（AC-6 → AC-7 → AC-9）→ 守卫（AC-2/AC-4）→ 产物与白名单（AC-10/AC-12）→ 真机脚本（AC-13）→ 收口门禁（AC-17/AC-18）。

## 7. 优先级

- **P0（不修等于没交付）**：AC-1、AC-2、AC-3、AC-4、AC-5、AC-6、AC-7、AC-8、AC-12、AC-13、AC-14、AC-15、AC-17。
- **P1（同批必须完成，但失败不阻塞验收口径讨论）**：AC-9、AC-10、AC-11、AC-16、AC-18。

判定口径：P0 任一红 → 不可验收；P1 红 → 可验收但必须写入 `ACCEPTANCE.md` 的未验证清单并给原因。

## 8. 依赖与风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 真机验证只能主 agent 做（子代理权限固定在工作区） | 若主 agent 不跑，AC-14 无法满足 → 不可验收 | PRD 把三步写成可照做命令 + 脚本；验收报告缺实跑原文即判不通过（不放行为"人工补测"） |
| 启动命令无留档（`dsh` 不在 PATH） | 复跑退化为临场探测 | 待澄清 Q1：由主 agent 补录命令原文进验收报告与脚本默认值 |
| `file:` 装的是**实体拷贝**，不是 symlink | 重建后 profile 里仍是旧 `lib` → 宿主加载旧代码，症状与"没修"完全一样（历史实锤） | AC-12 第 3 条断言两侧 sha256 相等；验证脚本第一步就做重装 |
| keyed slot 的 `key` 是否需要额外约束（唯一性/命名空间） | 与宿主既有 tab 冲突可能覆盖他人页签 | `key` 用 `${PLUGIN_ID}-panel`（本项目内唯一）；真机确认右栏同时存在其他插件页签且互不覆盖 |
| 页签标题可能需要单独注册 `sidebar.right.pane.tab.title` | 页签出现但无标题/不可识别 → 用户找不到入口 | 待澄清 Q3；AC-8 要求标题含「自动团队」，真机发现缺标题即补注册 |
| 宿主版本演进导致服务表变化 | 下次再漏 → 复发 | AC-2 的纪律 + AC-4 的守卫是**结构性**防线（扫源码集合，不依赖记忆） |
| 本机 desktop 是真宿主 | 实验污染会直接影响主人日常使用 | AC-16：全程只在 `dv` 克隆内做，前后取 desktop 指纹比对 |

## 9. 里程碑建议

- **M1 宿主半**：inject 清单 + `ctx.get` 收敛 + adapters 纪律注释（AC-2、AC-5），本地 `import` 干净。
- **M2 client 半**：keyed `key` + 两处 `inject(sessionId)` + `name` 逐字一致（AC-6、AC-7、AC-9）。
- **M3 守卫与变异自检**：一致性单测 + 删项必红（AC-4）；顺带锁死 AC-1/AC-10/AC-11。
- **M4 真机验证**：build → profile 重装 → 启动 → 四断言 → 断言脚本化（AC-3、AC-8、AC-12、AC-13、AC-15、AC-16）。
- **M5 收口**：ACCEPTANCE 贴主 agent 实跑原文（AC-14）+ 全量门禁（AC-17）+ 不夹带核对（AC-18）+ 一次到底提交。

## 10. 工程约束

- **分支与基线（原文保留）**：沿用当前分支 `feat/auto-team-plugin`，基线 HEAD `e6ae89c`、工作区干净。当前唯一未跟踪项是任务夹 `docs/teamflow/20261101-r6-real-host-activation/`（本 PRD 所在夹，属本期产物，正常纳入提交）。
- **边界（原文保留）**：不改 PRD/DESIGN 里已定的产品行为，只修加载与渲染契约；三条 P3 与 Trigger Slow 语义层不在本期。
- **真机复验归属（原文保留）**：真机复验必须由**主 agent** 做（子代理权限固定在工作区，装不了 profile）。
- **需求 1 原文**：两处都修，且把「宿主未声明的服务一律走 `ctx.get`、不裸访问」写进 `src/host/adapters.ts` 的唯一入口纪律，避免下次再漏。
- **需求 2 原文**：单测层面要能拦住这类回归：为 inject 清单与「apply 期间访问的 ctx 属性集合」之间的一致性加断言（例如扫描源码里 `ctx.<service>` 的使用面，断言每个都被 inject 或走 ctx.get），并证明该断言删掉 inject 项会变红。
- **需求 3 原文**：交付时提供一条可复跑的真机验证步骤（克隆 profile → 启动 → 查 boot 日志无 warning → 抓页面与控制台无 keyed slot 报错 → DOM 里出现开关行与右栏页签），并把结论写进验收报告。
- **构建与产物**：`pnpm build` 后**重新**在 profile 内 `pnpm add file:<repo>`；`lib/` 必须入库（`.gitignore` 已明确不忽略 `lib/`）；提交前跑完 AC-17 全部命令。
- **`.gitignore` 审计（开发阶段动作）**：现文件已覆盖本栈现实产物（`node_modules/`、`*.tsbuildinfo`、`coverage/`、`dist/`、`.DS_Store`、`.auto-team/`、`*.tgz`、`pnpm-debug.log*`、`.vscode/`、`.idea/`、`.env*`、`logs/teamflow/`），且显式保留 `lib/` 与 `docs/`。本期需**复核并只在出现新产物时补**：真机验证的 boot/控制台日志一律写 `logs/teamflow/<runId>/` 或 `/tmp`（**不得落到仓库根**）；若在仓库内创建临时 profile 克隆目录，必须同时把该目录名加入 `.gitignore`。禁止把 `lib/` 加入忽略。
- **提交纪律**：功能 + 文档一次到底、最后提交；提交后不再改文件（避免"任务完成但产物没进仓"）。
- **文件边界**：产物只写 `docs/teamflow/20261101-r6-real-host-activation/`；脚本与日志只写 `logs/teamflow/<runId>/`；不写宿主 `docs/<role>/`、不散落项目根。

## 11. 假设与待澄清

- **(a1/fact) 真机启动第二个宿主的准确命令未在仓库留档** —— 上一轮由主 agent 现场试出（克隆 `desktop` 为 `dv`、51890 端口），仓库里没有记录。假设：主 agent 能在验收阶段复跑并补录。**若不符**：AC-13 只能算"步骤骨架可复跑"，具体启动命令需临场探测，`real-host-verify.sh` 的默认值可能一次跑不通。
- **(a2/fact) keyed slot 是否允许额外携带 `id`/`order` 字段未实测** —— 同机样本（`dsh-better-sidebar/lib/client-registry.js:31050-31056`）只给 `name`/`key`/`inject`。假设：严格照样本三字段。**若宿主拒绝额外字段**：现在的 `id`/`order` 必须去掉，AC-6 收窄为三字段断言；**若宿主容忍**：保留 `order` 也不违规，但 `key` 不得省。
- **(a3/fact) 右栏页签标题是否必须单独注册 `sidebar.right.pane.tab.title`** —— 同机样本对每个 tab 同时注册 body 与 title，我方目前只注册 body。假设：宿主会提供默认标题。**若真机页签无标题或不可点**：本期须补注册 `.title`（同 `key` 语义），承载「自动团队」文案，并把实测依据记入 TECHNICAL；这不视为夹带（属渲染契约）。
- **(b1/taste) 本期是否在真实 `desktop` profile 上也应用修复** —— 用户的诉求本质是"桌面里能用"，但动 `desktop` 有把日常宿主搞坏的风险，且子代理无权限。**推荐（default）**：本期只验 `dv` 克隆（AC-16 保底），收口后由主 agent 经用户批准在 `desktop` 执行一次 `pnpm add file:<repo>` 并请用户重启确认；若用户希望"本期就装进桌面"，则把该步骤提前到 M4，并先写回滚（AC-15）。
- **(b2/taste) 一致性守卫的严格档位** —— strict（任何 `ctx.<未登记服务>` 裸访问即失败，含未来新增）vs 宽松（只比对当前 inject 清单）。**推荐（default）**：strict + 明确登记入口，因为本次事故的本质就是"漏登记"，宽松档拦不住下一次；代价是后续新增服务的 PR 需要同步登记（可接受）。
- **(b3/taste) 真机验证的 profile 生命周期** —— 复用现有 `dv`（已含旧包，先 `pnpm remove` 再 `pnpm add`，走 clean-install 路径）vs 每次从 `desktop` 全新克隆。**推荐（default）**：复用 `dv` 且先卸后装（既能证明"从零装得上"，又不用每次拉一份 11.96 MB 的批量包依赖），验证结束删除 `dv` 内本项目安装并在报告中注明。

## 附录 A 本机事实（探测命令 + 返回值，2026-11-01 实测）

- **A-1 访问面扫描**（`grep -rhoE 'ctx\.(tools|systemPrompt|agents|agentTeams|webServer|llm|agentDefaultModel|slots)' src/host src/client | sort | uniq -c`）：
  ```
  1 ctx.agentDefaultModel
  4 ctx.agentTeams
  6 ctx.agents
  1 ctx.llm
  4 ctx.slots
  2 ctx.systemPrompt
  2 ctx.tools
  1 ctx.webServer
  ```
  分布文件：`src/host/adapters.ts`（15 处）、`src/client/index.ts`（4 处，均为 `ctx.slots`）、`src/host/prompt.ts`（1）、`src/host/tools.ts`（1）。
- **A-2** `grep -rn 'ctx\.get(' src/host` → **0 命中**（可选服务读取机制目前完全不存在）。
- **A-3** `src/host/index.ts:69` → `export const inject = ['tools', 'systemPrompt']`。
- **A-4** `src/client/index.ts:43-58` 两处注册：`{ name: DOCK_SLOT, id: PLUGIN_ID+'-toggle', order: 10 }` / `{ name: PANEL_SLOT, id: PLUGIN_ID+'-panel', order: 60 }` —— 无 `key`、无 `inject`。
- **A-5 package.json**：`files: ["lib","cordis.patch.yml","README.md"]`；`dsh.bundle.patch: "./cordis.patch.yml"`；`dsh.client: {platform:"web", immediately:false, inject:[7 个 @deepseek-ai/dsh-client-*]}`；**0 处 `workspace:`**；`peerDependencies` 7 个 client 包 + `react`，`peerDependenciesMeta` 全部 `optional: true`。
- **A-6 profile 现状**：本机存在 `desktop` / `dv` / `verify-at` 三个 profile；`desktop/package.json` 已含 `"dsh-auto-team": "file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team"` 且 `dsh.profile.bundles` 末尾含 `dsh-auto-team`；`ls -ld desktop/node_modules/dsh-auto-team` → `drwxr-xr-x@ 6 maliang staff 192 Nov 1 10:39`（**实体拷贝，非 symlink**）。
- **A-7 keyed slot 样本**：`dsh-better-sidebar/lib/client-registry.js:31050-31056` → `ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name: "sidebar.right.pane.tab", key: id, inject: (sessionId) => ({ ...injected, ...params, sessionId }) }, NativeTabBody))`；`:31060` 另有 `sidebar.right.pane.tab.title` 同型注册。
- **A-8 环境**：`dsh` 不在 PATH；`lsof -nP -iTCP:51890 -sTCP:LISTEN` → 无输出（端口空闲）。
- **A-9 常量基线**：`MEMORY_INJECT_BUDGET = 4000`（`src/host/config.ts:31`）、`WATCHER_INTERVAL_MS = 1500`（:52）、`STALL_MS = 90_000`（:62）、`NOWAIT_THRESHOLD_MS = 5_000`（:82）、`TRIGGER_DEDUPE_MS = 60_000`（:91）；`setInterval` 全仓出现在 `src/host/team/watcher.ts:265`（**注：r5 报告写 :247，行号已漂，判据不得写死行号**）。
- **A-10 DOM 标记**：`src/client/Toggle.tsx:78` → `<span data-toggle-label>自动团队</span>`；`src/client/Panel.tsx:128` → `data-dsh-auto-team-panel`；`:168` → `data-panel-tab`。

## 附录 B 真机验证可复跑步骤（给主 agent）

> 本机 `dsh` 不在 PATH，走等价手动步骤。**profile 名/路径/端口一律先探测再取值，禁止写死**。

```bash
# 0) 探测（不要假设）
DSH_HOME="/Users/maliang/.dsh"           # 由运行环境给出，可用 echo $DSH_HOME 复核
ls "$DSH_HOME/profiles"                  # 期望：desktop / dv / verify-at
REPO="/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team"
PROFILE="$DSH_HOME/profiles/dv"          # 克隆自 desktop，专用于真机验证
PKG=$(node -p "require('$REPO/package.json').name")   # dsh-auto-team，不写死

# 1) 构建 + 同步到 profile（file: 装的是实体拷贝，必须重装，否则宿主加载旧 lib）
cd "$REPO" && pnpm build
cd "$PROFILE" && pnpm add "file:$REPO"
node -e "const p=require('$PROFILE/package.json');console.log(p.dsh.profile.bundles.includes('$PKG'))"   # 需 true
shasum -a 256 "$REPO/lib/index.js" "$PROFILE/node_modules/$PKG/lib/index.js"    # 两个值必须相等
shasum -a 256 "$REPO/lib/client.js" "$PROFILE/node_modules/$PKG/lib/client.js"  # 两个值必须相等

# 2) 启动第二个宿主（web 模式，端口 51890），日志落到 logs/teamflow/<runId>/
#    命令形态以上一轮主 agent 实测为准（仓库无留档 → 待澄清 Q1），日志示例：
#    <启动命令> > logs/teamflow/<runId>/boot.log 2>&1 &
#    探测端口就绪：until curl -sf http://127.0.0.1:51890/ >/dev/null; do sleep 1; done

# 3) 四断言
grep -cE '1 entry did not activate|without inject' logs/teamflow/<runId>/boot.log   # 需 0
curl -s http://127.0.0.1:51890/ | grep -c 'dsh-auto-team/client.js'                  # 需 ≥1
#    无头浏览器加载页面，抓控制台：uncaught / requires options.key 计数需 0
#    DOM 断言：document.querySelector('[data-toggle-label]') 文本含「自动团队」
#              document.querySelector('[data-dsh-auto-team-panel]') 非空；[data-panel-tab] ×4
```

**失败即回滚（AC-15）**

```bash
cd "$PROFILE" && pnpm remove "$PKG"
node -e "const fs=require('fs');const f='$PROFILE/package.json';const p=JSON.parse(fs.readFileSync(f,'utf8'));p.dsh.profile.bundles=p.dsh.profile.bundles.filter(b=>b!=='$PKG');fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
# 重启宿主，确认 boot 无本项目相关报错、宿主仍可用
```

## 附录 C `plugin-full` 11 条交付契约 → AC 映射

| 契约条目 | 覆盖 AC |
|---|---|
| 1 宿主半 profile 层加载入口声明（`name` = 包根名） | AC-1（+ AC-2 的 inject 面） |
| 2 client 半 bundle 声明与被扫描的 id/name | AC-9 |
| 3 UI 挂载点 `name` = slot 名本身（两段式逐字一致） | AC-6、AC-7、AC-8 |
| 4 入口声明与构建产物进 `files` 白名单 | AC-10 |
| 5 依赖协议可被 profile 解析（无 `workspace:`） | AC-11 |
| 6 宿主运行期依赖按宿主模块表声明（peer/可选 peer） | AC-11 |
| 7 构建产物与源码同步 | AC-12 |
| 8 装载安全（双产物顶层不抛错） | AC-5 |
| 9 能被 profile 真实装入且被宿主加载（本机探测入口） | AC-13、AC-14（+ AC-3 的正面证据） |
| 10 安装必须带回滚 | AC-15 |
| 11 安装由主 agent 执行（PRD 给出本机可照做步骤） | AC-13、AC-14、附录 B |

【本次任务产物夹】docs/teamflow/20261101-r6-real-host-activation/
