<!-- meta: summary="把自动团队从「输入框下方开关行 + 只读面板」升级为可操作形态：输入框内选项、会话头面板按钮、右栏面板（成员任务流转/任务内容/进度/完成状态 + 暂停/继续）、设置页（参数 + 角色描述/提示词/技能/默认模型 + 新增角色 + 一键恢复默认），并保持 plugin-full 交付契约与 r6 真机激活不回归。" -->

基线依赖：docs/teamflow/20261101-r6-real-host-activation（其 18 条 AC 已验收的行为——插件在真机激活、三个 HTTP 接口可用、右栏页签可打开——本期不得回退）

取代：docs/teamflow/20261101-r6-real-host-activation#AC-8：开关行不再注册在 `conversation.composer.dock`，改由 `conversation.input.dock` 的「自动团队选项」承担同一开关语义（母判据从「开关行出现」变为「选项 + 顶栏按钮 + 页签 + 设置页四件套同时出现」）

---

# 自动团队：输入框选项 / 面板 / 暂停继续 / 设置与角色管理

## 1. 背景与目标

**现状（r6 交付后，本仓实测）**

| 事实 | 证据 |
|---|---|
| 插件在真机激活，3 条 HTTP 路由可用 | r6 ACCEPTANCE；`src/host/http.ts` 头注释 3 条路由 |
| 开关是 `conversation.composer.dock` 下一条 32px 整行 | `src/client/slots.ts` 的 `DOCK_SLOT`；`Toggle.tsx` |
| 右栏面板只读，四个页签：计划/成员/记忆/角色 | `Panel.tsx` 的 `TabKey = 'plan'|'members'|'memory'|'roles'` |
| 无「暂停任务/继续任务」动作 | `PanelAction` 11 项里只有 `cancel` / `resume`（后者语义是「续聊被中断的成员」） |
| 无任何设置实现 | `grep -n "settings\|Settings" src/shared/types.ts src/host/config.ts` = 0 命中；`src/client` 中 `settings.section` = 0 命中 |
| `Role` 没有提示词字段 | `src/shared/types.ts:90-102` = `{id,name,duty,skillIds,model?,builtin,updatedAt}` |
| 6 个内置角色已落盘 | `/Users/maliang/.dsh/auto-team/roles/{pm,architect,dev,qa,docs,reviewer}.json` |

**本期目标（每条都能在真机或单测里被判定）**

- G1 开关变成**输入框内的选项**：`conversation.input.dock` 挂载 1 处，`conversation.composer.dock` 挂载 0 处（AC-12）。
- G2 会话头**面板按钮**：`conversation.session.header.actions` 挂载 1 处，点击打开右栏面板（AC-13）。
- G3 面板可读可操作：每个任务一行显示**任务内容、状态流转、进度、完成状态**，页头显示 `完成 x/N` 与计划状态；面板顶部「暂停任务 / 继续任务」按钮往返切换（AC-14、AC-15、AC-20）。
- G4 **设置页**：`settings.section` 挂载 1 处「自动团队」页；参数区覆盖 ≥5 个可写参数；角色区可编辑描述/提示词/技能/默认模型，可新增角色，可「一键恢复默认角色」（AC-16、AC-17）。
- G5 一切改动**落盘且跨重启存活**：`/Users/maliang/.dsh/auto-team/settings.json`、`/Users/maliang/.dsh/auto-team/roles/<id>.json`（AC-6、AC-7、AC-21）。
- G6 **不回归**：r6 真机激活、r5 Inline & Spill、三条历史 P3、预算常量与单一定时器全部原样（AC-11、AC-23）。

## 2. 用户故事

| # | 用户故事 | 验收 |
|---|---|---|
| S1 | 作为会话使用者，我希望「自动团队」开关出现在我打字的地方（输入框内），而不是压在输入框下面一整行占地方，这样我不必滚动就能开关它。 | AC-12、AC-19 |
| S2 | 作为会话使用者，我希望会话标题旁边有个「自动团队」按钮，点一下右栏就打开面板，这样我不用先切到别的地方找入口。 | AC-13、AC-19 |
| S3 | 作为会话使用者，我希望在面板里一眼看到「谁在做什么任务、任务内容是什么、到哪一步了、完成了没有」，而不是只看到一串 id 和状态码。 | AC-14 |
| S4 | 作为会话使用者，我希望面板顶部有「暂停任务」，暂停后它变成「继续任务」，再点就能从断点继续——已完成的不要重跑，正在跑的不要回退。 | AC-9、AC-15、AC-20 |
| S5 | 作为会话使用者，我希望设置里有一页「自动团队」，能把并发、记忆预算、停滞阈值、返工上限、门禁超时、队长模型这些参数改掉，而且重启后还在。 | AC-6、AC-16、AC-21 |
| S6 | 作为会话使用者，我希望能在设置里改每个角色的描述、提示词、技能、默认模型，也能新增自己的角色（比如「前端」），并且改完立刻对下一次派发生效。 | AC-7、AC-16 |
| S7 | 作为会话使用者，我希望「一键恢复默认角色」真的能救回来：改坏的内置角色恢复成出厂定义，而我自建的角色的不被一起删掉。 | AC-8、AC-21 |

## 3. 范围与非目标

**范围内**：`conversation.input.dock` 选项控件；`conversation.session.header.actions` 按钮；右栏面板的暂停/继续与任务视图增强；`settings.section` 设置页（参数 + 角色管理 + 恢复默认）；`Role.prompt`；`settings.json` 持久化；相应单测、守卫测试、真机验证脚本；主 agent 安装与回滚步骤。

**非目标（本期不做）**

- 不做多团队/多会话的并行编排面板（仍是「一个会话一个团队」）。
- 不做任务的图形化依赖图、拖拽排序、手工改依赖（计划仍由队长生成）。
- 不做技能（skill）本身的增删改（只做角色对既有技能的勾选）。
- 不做设置/角色的云端同步、导入导出。
- 不改 r5 的 Inline & Spill 注入机制，不改三条历史 P3。
- **不新增** HTTP 路由（仍 3 条）、**不新增** `ActivityEvent.kind`（仍 9 种）、不新增 `PlanTask` 字段。

## 4. 反面目标 / anti-goals

以下每一条都是「测试全绿但人用起来会否掉这个版本」的具体情形，验收时逐条对照。

1. **进度数字与状态自相矛盾**：页头写「完成 3/5」，而列表里第 4 行还写着「运行中」、成员区却显示该成员 idle；或者某任务状态显示「完成」但 `evidence.exitCode !== 0`。用户看一眼就不知道该信哪个。
2. **暂停只是改了按钮文案**：点了「暂停任务」之后 60 秒内，活动流仍在增长、仍有新成员被创建、仍在烧 token——而按钮已经变成「继续任务」。用户以为停了，其实没停。
3. **「继续」把已完成的又跑一遍**：继续后 `done` 任务重新派发、`attempts` 增加、或状态从 `done` 退回 `ready`。用户看到重复劳动和重复副作用，从此不敢点继续。
4. **「一键恢复默认」恢复得不彻底或过头**：改坏的内置角色恢复后仍残留上一轮的 duty/提示词（差一个字也算）；或者把用户自建的角色一起删了；或者只改了内存没落盘，重启又变回去。三者任一发生，这个按钮就从「保险」变成「地雷」。
5. **四个入口有一个在真机不出现，而所有自动化门禁全绿**：构建通过、单测通过、宿主无报错，但用户只看到三个入口（历史实锤：挂载点 `name` 写成插件标识 → 静默不挂载）。母判据 AC-19 就是为这一条设的。
6. **面板挤满状态码却没有任务内容**：每行只有 `task-3 / running / dev`，看不到这个任务到底要做什么（`title` + `acceptance`）。用户必须去翻日志才知道任务内容，面板等于没用。

## 5. 交互流程摘要

**A. 启用**：活会话的输入框上方（composer card 之上）出现一行紧凑的「自动团队」选项（`conversation.input.dock`，`data-auto-team-option`）→ 点击 → `POST /api/auto-team/act {sessionId, action:{type:'toggle',enabled:true}}` → 快照 `enabled=true`，控件进入已启用视觉态。

**B. 打开面板**：会话标题行右侧「自动团队」按钮（`conversation.session.header.actions`，`data-auto-team-header-button`）→ `sidebarRight.openTab('dsh-auto-team-panel')`（服务不可用时回退 `window.dispatchEvent(new CustomEvent('dsh-auto-team:open-panel'))`）→ 右栏出现并打开「自动团队」页签。

**C. 浏览**：面板页头显示 `完成 x/N`、计划状态中文（含「已暂停」）；计划页每任务一行显示：标题、任务内容（`title` + `acceptance` 截断）、状态中文标签（10 态全覆盖）、所属角色、最近门禁证据摘要。成员页显示成员状态与绑定任务，记忆/角色页保留现有能力。

**D. 暂停 / 继续**：面板顶部按钮 `data-auto-team-pause`；未暂停时文案「暂停任务」→ 点击 → `action {type:'pause'}` → `planStatus='paused'`、运行中任务转 `paused`（记录 `pausedFrom`）、watcher 停止派发与推进；按钮变「继续任务」→ 点击 → `action {type:'resumeTeam'}` → `planStatus` 与各任务状态按 `pausedFrom` 还原，`done` 任务不动、不重跑、`attempts` 不变。

**E. 设置**：设置 → 「自动团队」页（`settings.section`，`data-auto-team-settings`）→ 参数区（并发上限 / 记忆注入预算 / 停滞阈值 / 返工上限 / 门禁超时 / 队长默认模型）→ 角色区（6 个内置角色 + 自建角色，逐个编辑 名称/描述/提示词/技能多选/默认模型 provider+model）→「新增角色」→ 保存即落盘 `/Users/maliang/.dsh/auto-team/settings.json` 与 `/Users/maliang/.dsh/auto-team/roles/<id>.json`；「一键恢复默认角色」带二次确认，只重置内置角色。

### 5.1 UI 落位表（槽位事实来自 `docs/teamflow/architecture/UI-SLOTS.md` 与同机样本，**不得再调 client inspect**）

| 用途 | slot / 服务 | kind | scope | replaceRisk | 注册字段（与同机样本逐字一致） | 本插件注册值 |
|---|---|---|---|---|---|---|
| 输入框内选项 | `conversation.input.dock` | list | session | none | `{name,id,order,inject}`（样本 `dsh-cost-meter`） | `id: dsh-auto-team-option`，`order: 5` |
| 会话头面板按钮 | `conversation.session.header.actions` | list | session | none | `{name,id,order,inject}`（样本 `dsh-cost-meter` / `dsh-llm-fallbacks`） | `id: dsh-auto-team-header-button`，`order: 0` |
| 右栏页签体 | `sidebar.right.pane.tab` | **keyed** | session | none | `{name,key,inject}` | `key: dsh-auto-team-panel` |
| 右栏页签标题 | `sidebar.right.pane.tab.title` | **keyed** | session | none | `{name,key,inject}` | `key: dsh-auto-team-panel` |
| 页签类型（服务） | `sidebarRightTabs.register` | 服务 | 会话侧 | — | `{id,kind,priority:'extension',title}` | `id = kind = dsh-auto-team-panel` |
| 设置页 | `settings.section` | list | root | none | `{name,id,order,label,inject}`（样本 `dsh-cost-meter`） | `id: dsh-auto-team`，`label: 自动团队` |
| 撤除 | `conversation.composer.dock` | list | session | none | — | **0 处注册**（由 `input.dock` 取代） |

**禁用槽位**（占位即遮盖宿主自带 UI，一律不得使用）：`conversation.composer.bar`、`conversation.input.activity`、`conversation.session.header.corner`、`shell.leading`、`settings.header`、`settings.close`、`settings.trigger`、`sidebar.settings`。

**session 作用域前提**：`input.dock` / `pane.tab` / `header.actions` 只在**活会话**里渲染。落地页（无活跃会话）采样恒为 0，**那是假阴性**，不是缺陷。

## 6. 交付形态契约（plugin-full，11 条 → AC 映射）

| # | 契约 | 落成 AC |
|---|---|---|
| 1 | profile 层加载入口声明存在，入口 `name` 用包根名 | AC-1 |
| 2 | client 声明块字段集合与同仓样本一致，产物非空且含包 id | AC-3 |
| 3 | UI 挂载点 `name` = slot 名本身，`inject` 参数与 `register.name` 逐字相同，插件标识进 `id` | AC-4（端到端 AC-19） |
| 4 | 入口声明与构建产物进 `files` 白名单 | AC-22 |
| 5 | 依赖协议可解析（0 处 `workspace:`） | AC-22 |
| 6 | peer/可选 peer 覆盖宿主 `@deepseek-ai/*` | AC-22 |
| 7 | 构建产物与源码同步（重新 build） | AC-22 |
| 8 | 装载安全：两个产物模块顶层不抛错 | AC-22 |
| 9 | 能被 profile 真实装入并被宿主加载 | AC-24（步骤见 §9） |
| 10 | 安装带回滚（先写反向步骤） | AC-24 |
| 11 | 安装由**主 agent** 执行，PRD 给本机可照做步骤 | AC-24 + §9 |

## 7. 验收标准

> 全部 AC 在本夹内从 AC-1 编号。凡写「实跑」的，QA 报告必须贴命令与输出原文。

### A 组 · 宿主与契约（不回归 r6）

**AC-1 加载入口声明**
`cordis.patch.yml` 存在，含 `insert: - id: auto-team-host, name: 'dsh-auto-team'`；该 `name` 逐字等于 `package.json` 的 `name`（子路径会被 clientModules 静默跳过）；`package.json.dsh.bundle.patch === './cordis.patch.yml'` 且 `dsh.manifestVersion === 1`。
判据：`node -e` 读两文件断言相等；`grep -n "name: 'dsh-auto-team'" cordis.patch.yml` 命中 1 次。

**AC-2 inject 完备性与 ctx.get 纪律**
`src/client/index.ts` 的 `inject` 覆盖全部裸访问的 client 服务；本期新增的三个挂载点（input.dock / header.actions / settings.section）与两个会话侧服务（`sidebarRightTabs` / `sidebarRight`）**不得**引入新的 `ctx.<service>` 裸访问——会话侧服务只经 `ctx.inject([...], cb)` / `ctx.get(...)` 读取；宿主侧仍只经 `src/host/adapters.ts`。
判据：`grep -rn "ctx\.[a-zA-Z]*\.[a-zA-Z]*" src/client/*.ts src/client/**/*.ts` 命中集合 ⊆ `{slots, inject, get, effect, reflect}` 且 `src/host` 中 `ctx.<service>` 只出现在 `adapters.ts`；单测里的 fake ctx 必须提供 `get`（否则 `registerHttpRoutes` 静默不注册，探针会假红）。

**AC-3 client 声明块与产物**
`package.json.dsh.client` 字段集合仍为 `{platform, inject, immediately}`（与 r6 逐字一致，新增字段必须说明理由）；`lib/client.js` 非空且含包 id `dsh-auto-team`；产物内出现本期三个新槽位字面量 `conversation.input.dock`、`conversation.session.header.actions`、`settings.section`。
判据：`grep -c` 三个字面量各 ≥1；`grep -c 'dsh-auto-team' lib/client.js` ≥1；`wc -c lib/client.js` > 0。

**AC-4 四个挂载点：`name` 逐字 = slot 名，字段集合与样本一致**
- `conversation.input.dock` → `{name,id,order,inject}`；
- `conversation.session.header.actions` → `{name,id,order,inject}`；
- `sidebar.right.pane.tab` / `.title` → `{name,key,inject}`（keyed，缺 `key` 会抛 `keyed slot "..." requires options.key`）；
- `settings.section` → `{name,id,order,label,inject}`。

每条注册的 `register.name` 必须与 `slots.inject('<slot>')` 的第一个参数**逐字相同**；插件标识 `dsh-auto-team` 只能出现在 `id` / `key` / `data-*` 属性，**绝不能**出现在 `name`。
判据：`grep -n "slots.inject(" src/client/slots.ts` 与 `grep -n "name: '" src/client/slots.ts` 逐条配对核对；**变异自检**：把任一 `name` 改成 `'dsh-auto-team'` → `pnpm test` 必红且报错点名该槽位（守卫测试）。

**AC-5 右栏页签三步注册不回退**
① `sidebarRightTabs.register({id, kind, priority:'extension', title})` 存在且 `id === kind === 'dsh-auto-team-panel'`；② 两个 keyed 挂载点带同一 `key`；③ `sidebarRight.openTab('dsh-auto-team-panel')` 存在，服务缺失时有 CustomEvent 回退。
判据：`grep -n "sidebarRightTabs\|openTab\|PANEL_KEY" src/client/slots.ts` 逐条命中；r6 的 `test/client-contract.test.ts` 相关用例保持绿。

**AC-6 设置落盘与跨重启存活**
设置写入由 `globalDataRoot(os.homedir())` 派生（代码内不得写死绝对路径），落点 `/Users/maliang/.dsh/auto-team/settings.json`；保存后 `GET /api/auto-team/snapshot` 立即反映新值；重启宿主后同一 `sessionId` 的快照仍为新值。
判据：`node -e` 打印派生路径断言等于上述字面量；保存后 `cat` 文件贴原文；重启后再 curl 快照比对。

**AC-7 `Role.prompt` 字段与派发生效**
`Role` 增加 `prompt?: string`（其余字段不变）；`src/host/roles/builtin.ts` 的 6 个内置角色各带非空 `prompt`；`saveRole` 落盘 `/Users/maliang/.dsh/auto-team/roles/<id>.json` 含 `prompt`；成员系统提示组装时使用该角色 `prompt`。
判据：单测断言内置 6 个角色 `prompt` 非空且互不相同；保存后 `cat roles/pm.json` 贴原文；单测断言成员提示词里包含该角色 `prompt` 的特征串（证明真的被用上，而不是只存了字段）。

**AC-8 一键恢复默认角色（可分辨）**
新增动作 `restoreDefaultRoles`：① 6 个内置角色的 `name/duty/prompt/skillIds/model` 恢复成 `builtin.ts` 定义，逐字段相等；② 用户自建角色（`builtin:false`）**不被删除**、内容不变；③ 落盘生效（`roles/<id>.json` 与定义一致）；④ 用户直接编辑内置角色后保存，其 `builtin` 仍为 `true`（不能靠改标志绕过恢复）。
判据（**可分辨性**）：先改坏 `pm` 的 `duty` 与 `prompt` → 断言恢复前 ≠ `builtin` 定义 → 执行恢复 → 断言恢复后 `JSON.stringify` 归一后与 `builtin` 定义**逐字相等**，且自建角色文件 sha256 未变；变异自检：把恢复实现改成「只重置 duty」→ 该用例必红。

**AC-9 暂停 / 继续状态机（宿主级）**
新增动作 `pause` / `resumeTeam`：
- `pause`：`planStatus='paused'`；`running`/`ready` 任务转 `paused` 并记录 `pausedFrom`（原状态）；watcher 在 `paused` 期间不派发、不推进门禁、不触发下游 ready；
- `resumeTeam`：`planStatus` 还原为暂停前的值（`dispatching` 或 `draft`）；`paused` 任务按 `pausedFrom` 还原；
- `done` 任务全程保持 `done`，`attempts` 不变，不重新派发；`failed`/`interrupted` 不被暂停改写。

判据（状态机级，不只是文案）：单测走「2 任务计划 → 任务 A done、任务 B running → pause → resumeTeam」，断言 ① 往返后每个任务的 `status` 与暂停前逐字段相同；② `done` 任务的 `attempts`、`evidence`、`memberId` 未变；③ 暂停期间 `dispatch` 调用计数为 0、成员创建数不变；④ 活动流无新增 `spawn`/`tool` 事件。变异自检：让 `resumeTeam` 把 `done` 重置为 `ready` → 用例必红。

**AC-10 形状扩张：显式清单（其余一律不动）**
| 位置 | 变化 |
|---|---|
| `PanelAction` | 11 → 15：新增 `pause`、`resumeTeam`、`restoreDefaultRoles`、`saveSettings{settings}` |
| `RejectionCode` | 11 → 12：新增 `PAUSED`（暂停期间拒绝 dispatch） |
| `TaskStatus` | 9 → 10：新增 `paused` |
| `PanelSnapshot` | 新增 `paused?: boolean`、`pausedAt?: number`、`settings?: AutoTeamSettings`、`skills?: SkillInfo[]` |
| `Role` | 新增 `prompt?: string` |
| 磁盘 | 新增 `/Users/maliang/.dsh/auto-team/settings.json` |
| **不新增** | `ActivityEvent.kind`（仍 9 种，暂停/继续记 `status`）；HTTP 路由（仍 3 条）；`PlanStatus`（`paused` 已存在）；`PlanTask` 字段（任务内容用现有 `title` + `acceptance`） |

判据：`grep -c` 断言 `ActivityEvent` 的 kind 成员数 = 9、`src/host/http.ts` 路由注册 = 3；`git diff src/shared/types.ts` 只包含上表列出的字段/成员。

**AC-11 形态冻结（预算与定时器）**
`MEMORY_INJECT_BUDGET = 4000`、`WATCHER_INTERVAL_MS = 1500`、`PANEL_ACTIVE_MS = 2000`、`STALL_MS = 90_000` 各 1 处且值不变；`setInterval` 全仓仍 1 处（`src/host/team/watcher.ts`）；新增的可配参数只作为**默认值来源**，`settings.json` 缺失时行为与今天逐字一致。
判据：`grep -rn "setInterval" src | wc -l` = 1；四个常量 grep 值与值比较；单测断言空设置下并发/预算/停滞阈值等于常量。

### B 组 · client 交互

**AC-12 输入框内选项取代开关行**
`conversation.composer.dock` 注册 **0 处**（`grep -c` = 0）；`conversation.input.dock` 注册 1 处，渲染出 `data-auto-team-option`；控件为紧凑选项形态（渲染高度 ≤ 44px，不占整行 32px 卡片）；点击切换 `enabled` 并只发 `act({type:'toggle'})`（不隐式派发）。
判据：grep 两处计数 + 单测（`renderToStaticMarkup` 断言 `data-auto-team-option` 存在、`data-auto-team-toggle-row` 不存在）。

**AC-13 会话头按钮打开右栏**
`conversation.session.header.actions` 注册 1 处，渲染出 `data-auto-team-header-button`，文案含「自动团队」；点击调用 `openTab('dsh-auto-team-panel')`；`openTab` 不可用时回退派发 `dsh-auto-team:open-panel` 事件。
判据：单测注入 fake slots，断言点击后 `openTab` 被调用且参数 = `dsh-auto-team-panel`；移除 `openTab` 后断言事件被派发（可分辨：两条分支都必须被覆盖）。

**AC-14 面板四要素：任务内容 / 状态流转 / 进度 / 完成状态**
页头：`完成 x/N`（x = `status==='done'` 的任务数，N = 任务总数）+ 计划状态中文（`draft/dispatching/paused/terminated/cancelled` 全映射，含「已暂停」）。
每个任务行（`data-task-id`）显示：① 标题 `title`；② 任务内容 = `title` + `acceptance`（截断显示，不新增字段）；③ 状态中文标签，`TaskStatus` **10 态全覆盖**（含 `paused`），映射收敛在纯函数 `progressOf(task)`（组件内不得再写映射表）；④ 所属角色与门禁证据摘要（有则显示退出码）。
判据：单测对 10 态逐一断言 `progressOf` 返回的标签与进度值；真机断言 `[data-task-id]` 数量 === 快照 `tasks.length`，且每行文本含 `title` 原文与状态标签。

**AC-15 面板顶部暂停 / 继续按钮**
面板顶部一个按钮 `data-auto-team-pause`：`paused=false` 时文案「暂停任务」、`paused=true` 时「继续任务」；点击分别发 `{type:'pause'}` / `{type:'resumeTeam'}`；请求失败时保持原状态并显示错误（不得乐观改文案）。
判据：单测用两份快照 `renderToStaticMarkup` 断言文案与 `data-paused` 属性；构造 `{error}` 响应断言文案未变。

**AC-16 设置页：参数 + 角色管理 + 恢复默认**
`settings.section` 注册 1 处，页面根 `data-auto-team-settings`，标题「自动团队」。内容必须包含：
1. **参数区** ≥5 项，每项 `data-setting-key`：`concurrencyLimit`（默认 `DEFAULT_MAX_CONCURRENT=3`，范围 1..`MAX_CONCURRENT_LIMIT=8`）、`memoryBudget`（默认 4000，范围 200..4000）、`stallMs`（默认 90000）、`maxAttempts`（默认 3，范围 1..10）、`gateTimeoutMs`（默认 300000）；另含队长默认模型 `captainModel`（provider + model 两个输入）。
2. **角色区**：6 个内置角色 + 自建角色，逐角色可编辑 名称 / 描述(`duty`) / 提示词(`prompt`) / 技能（对现有 6 个技能 id 多选）/ 默认模型（provider + model），每行 `data-role-id`。
3. **新增角色**按钮 `data-role-add`（新 id 校验通过 `HOST_MEMBER_NAME` 规则）。
4. **删除**按钮：自建角色可删，内置角色不可删（按钮禁用或不存在）。
5. **一键恢复默认角色**按钮 `data-roles-restore`，带二次确认。

判据：单测断言 `data-setting-key` 集合 = 上述 6 个；`data-role-id` 数量 === 快照 `roles.length`；真机 AC-21。

**AC-17 输入校验：拒绝即不落盘**
非法输入必须被拒绝且**磁盘逐字不变**：并发 0 或 9、记忆预算 199 或 4001、返工上限 0、门禁超时 <1000、角色名为空、提示词 > 8000 字符、技能 id 不在允许集合、模型 provider 为空。
判据：单测「先保存合法值 → 记下文件内容 → 保存非法值 → 断言返回 `ok:false` 且 `rejection.code` 属于既有码（`BAD_REQUEST` / `NOT_FOUND`），文件内容与保存前逐字相等」；可分辨性：紧接着保存另一个合法值，断言文件**必须**变化（否则证明断言恒绿）。

**AC-18 前端解构 `{data,error}`**
`src/client/**` 中所有请求调用都必须解构 `{data, error}` 并判 `error`，不得整包赋值。
判据：`grep -rn "= await " src/client` 命中行里不存在「左侧变量直接等于整个响应」的形态；计数式断言写成「请求调用数 == 解构处数」，不锁死数字。

### C 组 · 真机可见性（母判据）

**AC-19 真机四件套同时出现（母判据）**
**前置：先造活会话**（第二宿主 51890 或本机宿主，新建/打开一个会话并等输入框可用）。在**会话页**（不是落地页）执行采样，期望：

```js
document.querySelectorAll('[data-slot="conversation.input.dock"] [data-auto-team-option]').length            // 期望 1
document.querySelectorAll('[data-slot="conversation.session.header.actions"] [data-auto-team-header-button]').length // 期望 1
document.querySelectorAll('[data-slot="sidebar.right.pane.tab"] [data-auto-team-panel-tab]').length          // 期望 1（点击顶栏按钮后）
document.querySelectorAll('[data-auto-team-panel]').length                                                   // 期望 1（页签打开后）
document.querySelectorAll('[data-slot="settings.section"] [data-auto-team-settings]').length                 // 期望 1（打开设置页后）
```

数据面同时采样：`curl -s -b "$COOKIE" 'http://127.0.0.1:<port>/api/auto-team/snapshot?sessionId=<liveSessionId>'` 返回 200 且含 `settings`/`skills` 字段。
**反证（必须一并记录）**：在落地页（无活跃会话）执行同一组 `querySelectorAll`，四项均为 0——证明判据对 session 作用域敏感，而不是恒绿。
判据：4 个数字（含反证 0）原文进 QA 报告；任一项为 0 即**未交付**，其余全绿也不算过。

**AC-20 真机暂停 / 继续往返（状态机级）**
真机派发一个 ≥2 任务的计划 → 等任务 A 变 `done`、任务 B 在 `running` → 点「暂停任务」→ 断言 60s 内：成员数不变、活动流条数不增、`planStatus='paused'`、任务 A 仍 `done` → 点「继续任务」→ 断言 `planStatus` 回 `dispatching`、任务 A 的 `status/attempts/evidence` 与暂停前逐字段相同、任务 B 继续推进（状态不再是 `paused`）。
判据：暂停前/暂停后/继续后三份 `curl snapshot` 原文比对（贴关键字段 diff），不是只看按钮文案。

**AC-21 真机设置落盘 + 恢复默认可分辨**
真机改一个参数（如 `concurrencyLimit: 5`）+ 改坏内置角色 `pm` 的 `duty`/`prompt` → `cat /Users/maliang/.dsh/auto-team/settings.json` 与 `cat /Users/maliang/.dsh/auto-team/roles/pm.json` 贴原文 → 点「一键恢复默认角色」→ `roles/pm.json` 与 `builtin.ts` 定义逐字相等、自建角色文件仍在 → 重启宿主 → 快照里 `concurrencyLimit` 仍为 5、`pm` 仍为出厂定义。
判据：文件原文 + 重启后快照原文，两段都贴。

### D 组 · 门禁与交付

**AC-22 全量门禁**
- `pnpm typecheck` → 0 错；
- `pnpm test` → `fail 0`，用例数 **≥ 337**（r6 基线 337，只许增不许减），本期新增用例逐条列进 QA 报告；
- `pnpm build` 后 `find src -newer lib/index.js | wc -l` = 0 且 `find src -newer lib/client.js | wc -l` = 0（产物新鲜）；
- `node --input-type=module -e "await import('./lib/index.js')"` 与 `... './lib/client.js'` 均 exit 0（模块顶层不抛错）；
- `npm pack --dry-run` 含 3 条目：`lib/index.js`、`lib/client.js`、`cordis.patch.yml`（`files` 白名单覆盖入口声明与双产物）；
- `grep -rn "workspace:" package.json` = 0；
- `peerDependencies` 覆盖 7 个 `@deepseek-ai/dsh-client-*`，且 `peerDependenciesMeta` 全 optional。

判据：七条命令逐条贴输出。

**AC-23 不回归 + 不夹带**
r6 的 AC-1/2/3（入口声明、真机零 warning、插件激活）仍成立；r5 的 Inline & Spill 与三条历史 P3（`index.ts:195` name 兜底、peer 失败重投、`store.list` 线性）**0 处改动**；改动文件集合 ⊆ 白名单（`src/client/**`、`src/host/{roles,config,http,bridge,adapters}.ts` 相关、`src/shared/types.ts`、`test/**`、`package.json` 仅在有正当理由时、本期文档夹）。
判据：`git diff --stat` 与 `git diff -- <三条 P3 所在文件>` 为空；`setInterval` 仍 1 处。

**AC-24 安装带回滚（主 agent 实跑，步骤见 §9）**
装前必须先把回滚步骤写进 QA 报告（包名从产物 `package.json` 读，不写死），安装后验证失败**立即**执行回滚并贴命令与输出；回滚后 `/Users/maliang/.dsh/profiles/desktop/package.json` 中 `dsh-auto-team` 命中数 = 0、`dsh.profile.bundles` 不含该名、宿主可正常启动且日志无该插件。
判据：安装前后 `package.json` 关键片段 + 宿主启动日志片段（出现插件加载、无 `entry did not activate`）+ 回滚后同一组检查。**子代理跑不了不等于通过**——由主 agent 执行。

**AC-25 交付报告**
本夹产出 `QA-REPORT.md`（AC-1~AC-24 逐条判定表，每条贴实跑输出或明写「未验证 + 原因」）与 `ACCEPTANCE.md`（结论 + 未验证清单 + 真机实录）。
判据：两份文件存在且判定表覆盖全部 24 条，无空条目。

## 8. 优先级

| 优先级 | 内容 |
|---|---|
| **P0** | AC-1~AC-5（挂载与契约正确，错了等于没交付）、AC-9（暂停/继续状态机）、AC-12/AC-13（两个入口）、AC-19（母判据）、AC-22（门禁）、AC-24（安装带回滚） |
| **P1** | AC-6/AC-7/AC-8（落盘与恢复默认）、AC-14/AC-15/AC-16（面板四要素 + 设置页）、AC-20/AC-21（真机往返与恢复） |
| **P2** | AC-17/AC-18（校验与解构纪律）、AC-23（不夹带审计）、AC-25（报告） |

## 9. 给主 agent 的安装步骤（子代理权限写不了 profile，必须由主 agent 执行）

> 本机环境（起跑探测）：`DSH_HOME=/Users/maliang/.dsh`；profile=`desktop`；profile 目录 `/Users/maliang/.dsh/profiles/desktop`；`dsh` **不在 PATH**（源码运行）→ 走等价手动步骤。包名从构建产物 `package.json` 读，本节按 `dsh-auto-team` 书写，实际以读到的为准。

**第 0 步（装前，必须先写回滚基线）**
```bash
PROFILE=/Users/maliang/.dsh/profiles/desktop
cp "$PROFILE/package.json" /tmp/profile-desktop-package.baseline.json
shasum -a 256 "$PROFILE/package.json"
grep -n "dsh-auto-team" "$PROFILE/package.json" || echo "NOT_INSTALLED(ok)"
```

**第 1 步 构建并自检产物**
```bash
cd /Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
pnpm build
node --input-type=module -e "await import('./lib/index.js')"   # 期望 exit 0
node --input-type=module -e "await import('./lib/client.js')"  # 期望 exit 0
npm pack --dry-run | grep -E "lib/(index|client)\.js|cordis\.patch\.yml"
```

**第 2 步 装进 profile**
```bash
cd "$PROFILE"
pnpm add file:/Users/maliang/Documents/develop/maliang/dsh-plugin/dsh-auto-team
```

**第 3 步 登记 bundle**
在 `$PROFILE/package.json` 的 `dsh.profile.bundles` 数组里加入 `"dsh-auto-team"`（字段不存在则创建；条目由该包 `dsh.bundle.patch` 声明推导）。

**第 4 步 重启宿主并看日志**
按本机既有方式重启宿主（退出桌面 App 后重开，或重启当前源码宿主进程），确认启动日志出现该插件加载、**没有** `1 entry did not activate` / `cannot get property ... without inject`。

**第 5 步 GUI 可见性检查（= AC-19）**
在**活会话**里确认四件套：输入框内选项、会话头按钮、右栏「自动团队」页签（点按钮能打开）、设置里的「自动团队」页。四个都出现才算装好。

**第 6 步 回滚（验证失败立即执行，不要留到事后）**
```bash
cd "$PROFILE"
pnpm remove dsh-auto-team
# 从 dsh.profile.bundles 里摘掉 "dsh-auto-team"
grep -c "dsh-auto-team" "$PROFILE/package.json"     # 期望 0
diff <(shasum -a 256 < /tmp/profile-desktop-package.baseline.json) <(shasum -a 256 < "$PROFILE/package.json") \
  || echo "byte-diff: 只允许 dependencies/bundles 的格式差异，逐行核对后记录"
```
回滚后重启宿主，确认宿主正常、日志无该插件。

## 10. 工程约束

1. **分支**：当前已在 `feat/auto-team-plugin`（host 报告工作树干净，HEAD `fa56717`）。本期在该分支上从当前 HEAD 起开发，**不新建分支**、不切到 main。
2. **提交时机与基线**：全部实现 + 本夹文档完成后提交；提交前 `git status --porcelain --untracked-files=all` 必须只剩预期文件。提交信息 `feat(r7): 输入框选项 + 会话头按钮 + 右栏面板暂停继续 + 设置页角色管理`。若期间有他人改动混入，先 `git stash` 再提交本期内容。
3. **工作树若有未提交改动**：本阶段起跑时干净；开发中产生的中间产物（`lib/` 重新构建、临时脚本）必须区分处理——`lib/` 入库，临时脚本放 `logs/teamflow/<runId>/scripts/`（run 结束由 host 归档，不进提交）。
4. **`.gitignore` 审计（本栈实测清单）**：必须包含 `node_modules/`、`*.tgz`、`.DS_Store`、`logs/teamflow/`、`coverage/`、`*.log`、`*.tsbuildinfo`；**不得**包含 `lib/`（profile 安装源就是它，忽略即交付失败）。缺失项补齐并纳入同一笔提交。
5. **文档边界**：TeamFlow 产物只写 `docs/teamflow/20261101-r7-auto-team-panel-roles/`；不写宿主 `docs/<role>/`，不在项目根散落日志。
6. **UI 事实来源**：槽位一律以 `docs/teamflow/architecture/UI-SLOTS.md` + 同机样本为准；**禁止**为 UI 事实调 `cordis_inspect_query`（本项目已四次因 `input` 非对象烧穿阶段预算）。

## 11. 依赖与风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| session 作用域槽位在落地页采样为 0 | 误判「没挂上」 | AC-19 强制「先造活会话」并记录反证 |
| keyed slot 漏 `key` 或 `name` 写成插件标识 | 构建全绿、入口永不出现 | AC-4 守卫 + 变异自检（改坏必红） |
| 暂停只改状态不拦派发 | 用户以为停了仍在烧 token | AC-9 断言「暂停期间 dispatch 计数 0」+ AC-20 真机 60s 观察 |
| 恢复默认只重置部分字段 | 用户不敢点，信任崩塌 | AC-8 可分辨断言（改坏→恢复→逐字相等） |
| 设置落盘失败被吞 | 重启后白配 | AC-6 派生路径断言 + AC-17 拒绝不落盘 + AC-21 重启复核 |
| 新增设置项改动了预算常量/定时器 | 违反 r5/r6 冻结项 | AC-11 常量与 `setInterval` 计数断言 |
| 子代理装不了 profile | AC-24 被写成「人工补测」后无人真跑 | §9 明写由主 agent 执行；跑不了必须记为「未验证」，不得默认通过 |

## 12. 里程碑建议

| 阶段 | 内容 | 出口 |
|---|---|---|
| T1 | 契约与纯逻辑：`types.ts` 形状（AC-10）、`config.ts` 可配参数、`settings.ts` 读写、`progressOf`、`roles` 的 `prompt` 与 `restoreDefaultRoles` | 单测绿；AC-7/8/9/10/11 单测过 |
| T2 | 宿主动作与投影：`pause`/`resumeTeam`/`saveSettings`/`restoreDefaultRoles` 进 bridge，快照新增字段 | 单测绿；AC-9 状态机往返过 |
| T3 | client：`input.dock` 选项、`header.actions` 按钮、面板顶部按钮与任务四要素、`settings.section` 设置页 | 单测绿；AC-12~AC-18 过 |
| T4 | 守卫与真机：`name`/字段集合守卫 + 变异自检、真机脚本（AC-19~AC-21） | 守卫删项必红；真机四项数字齐 |
| T5 | 门禁与交付：AC-22 全绿、AC-23 不夹带、AC-24 主 agent 安装回滚、AC-25 报告 | 全部判定表有证据 |

## 13. 假设与待澄清

**(a) 未定事实（需求没定，我也无法从仓库判定）**

- **技能字段的语义**：需求只说角色可配「技能」。仓库现有 6 个技能 id（`prd-writing/architecture/implementation/testing/docs/review`）+ `skillsDir` 落盘能力，但没说是否要支持用户自定义技能条目。**我的默认**：角色对现有技能多选，**不做**技能的增删改（已列非目标）。若你要求可自定义技能，工作量和 AC 都要加（技能 CRUD + 校验 + 落盘）。
- **设置项的边界**：需求说「设置各个参数」，我把范围限定为 `src/host/config.ts` 里**用户可调**的 6 项（并发上限、记忆注入预算、停滞阈值、返工上限、门禁超时、队长默认模型），并把 `WATCHER_INTERVAL_MS`、`PANEL_ACTIVE_MS`、`RESUME_DEBOUNCE_MS`、`TRIGGER_DEDUPE_MS` 列为**不可配**（动它们会改变定时器节奏与预算，违反 AC-11 冻结）。**我的默认**：就这 6 项；若你还想暴露门禁尾部字符数、触发去抖等，需要明说，因为它们是 r5 冻结项的一部分。

**(b) 用户口味决策（几个选项都成立，取决于你想要什么）**

- **「暂停」的语义**：只停「派发与推进」（正在跑的成员把当前轮跑完，不半途打断），还是同时中断运行中的成员进程（`interrupt_agent`，立刻停但可能留下半截副作用）。**我的默认**：只停派发与推进（更安全，避免副作用半途中断）；若你要「立刻硬停」，AC-9/AC-20 的断言要改成「暂停后 5s 内无任何工具调用」。
- **输入框内「选项」的形态**：需求原文是「开关改成选项」。**我的默认**：紧凑胶囊开关（点击即开/关，文案「自动团队」，语义与今天等价）；另一种是档位下拉（关闭 / 仅计划 / 自动执行），表达力更强但要重新定义三档行为。选胶囊则本期零语义迁移风险。
- **「一键恢复默认角色」的范围**：只重置 6 个内置角色（自建角色保留），还是连自建角色一起清空回出厂？**我的默认**：只重置内置、自建保留（误删用户资产是不可逆伤害）；若你要「完全回出厂」，AC-8 会改为「自建角色也删除 + 二次确认文案明确说明」。
- **「任务流转」的呈现方式**：列表 + 每行状态标签与门禁证据（轻、可读），还是画依赖图/时间线（直观但要新增图形渲染与布局代码）。**我的默认**：列表 + 状态标签 + 页头 `完成 x/N`（不引入图形库，符合「最小化结构」）；若你要图，需要单独一轮设计。

> 无其他待澄清项。若上述任一默认不符合你的预期，告诉我改哪条，我按你的选择重写对应 AC。
