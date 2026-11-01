# r7 技术方案：输入框选项 + 会话头按钮 + 右栏面板暂停继续 + 设置页角色管理

> 基线：`docs/teamflow/20261101-r7-auto-team-panel-roles/PRD.md`（25 条 AC）、`DESIGN.md`（§0 手感规范逐字可抄）、`docs/teamflow/architecture/UI-SLOTS.md`。
> 本文件只写「怎么改」，不改 PRD/DESIGN 的判据与几何数字；两者冲突时以 PRD 判据为准并在此登记裁决（见 §2.4）。
> 技术栈不变：TypeScript 单包双产物（host ESM `lib/index.js` + client CJS `lib/client.js`）、React 18 classic JSX、`node --test` 直跑 TS 源、Cordis 插件。

## 0. 一句话方案

在**不动**既有形状契约（3 条 HTTP 路由、9 个 `ActivityEvent.kind`、`PlanTask` 字段集、`setInterval` 唯一性）的前提下，只做四件事：
① 把 toggle 从 `conversation.composer.dock` 迁到 `conversation.input.dock` 并改名 Option；② 新增 `conversation.session.header.actions` 按钮；③ 右栏面板加「暂停/继续 + 完成 x/N + 10 态任务行」；④ 新增 `settings.section` 设置页 + `settings.json` 落盘 + `Role.prompt` + `restoreDefaultRoles`。
冻结常量一律保持单点：所有可配参数只作为**可选入参**穿透到既有消费点，缺省值仍取 `config.ts` 的常量。

## 1. 改动面（文件级）

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/shared/types.ts` | 改 | AC-10 六项形状扩张（§2.1） |
| `src/host/config.ts` | 改 | 新增 `DEFAULT_SETTINGS` / `SETTINGS_LIMITS` / `ROLE_PROMPT_MAX`，**不改任何既有常量值** |
| `src/host/paths.ts` | 改 | 新增 `settingsPath(home)` |
| `src/host/settings.ts` | **新增** | `settings.json` 读写 + 校验（纯逻辑，只碰 fs + 纯校验） |
| `src/host/store.ts` | 改 | `RUN_STATE_VERSION` 2→3、`RunState.pause?`、`normalizePause`、`TASK_STATUSES` + `paused` |
| `src/host/roles/builtin.ts` | 改 | 6 个内置角色补 `prompt`（非空互异） |
| `src/host/roles/repo.ts` | 改 | 新增 `restoreDefaults()`；`builtin` 一律由 `BUILTIN_ROLES` 推导 |
| `src/host/bridge.ts` | 改 | 4 个新 action、`PAUSED` 闸门、`snapshot()` +4 字段 |
| `src/host/team/watcher.ts` | 改 | paused 期间跳过停滞判定与 `onPoll` |
| `src/host/team/dispatch.ts` | 改 | `dispatchReady` 派发状态集合收紧为 `draft|dispatching` |
| `src/host/team/member-prompt.ts` | 改 | 成员提示词拼入 `role.prompt` |
| `src/host/index.ts` | 改 | 装配 settingsRepo、5 个生效点、`onSettingsSaved` |
| `src/client/slots.ts` | 改 | 四个挂载点（含撤除 composer.dock） |
| `src/client/ui.ts` | **新增** | 渲染描述层纯函数（无 JSX，判据与组件共用，§4.4） |
| `src/client/viewmodel.ts` | 改 | `progressOf(task)`、`statusBadge` + `paused` |
| `src/client/Option.tsx` | **新增**（替换 `Toggle.tsx`） | 输入框内胶囊选项 |
| `src/client/HeaderButton.tsx` | **新增** | 会话头按钮 |
| `src/client/SettingsPage.tsx` | **新增** | 设置页（6 参数 + 角色区） |
| `src/client/RoleEditor.tsx` | **新增** | `RoleEditorList`，面板角色页与设置页**共用** |
| `src/client/Panel.tsx` | 改 | 页头完成 x/N + 暂停按钮 + 任务行 10 态 |
| `src/client/tabs/PlanTab.tsx` | 改 | 任务行改用 `progressOf(task)` |
| `src/client/tabs/RolesTab.tsx` | 改 | 改用 `RoleEditorList` |
| `src/client/TabTitle.tsx` | 改 | hook 改名 `data-auto-team-panel-tab` |
| `src/client/styles.ts` | 改 | `data-dsh-auto-team-*` → `data-auto-team-*`（61 处）+ 新增四段样式 |
| `src/client/index.ts` | 改 | 接线四个槽位（仍零 `slots.register(`） |
| `src/client/Toggle.tsx` | **删除** | 由 `Option.tsx` 取代 |
| `test/*.test.ts` | 改/增 | §7.2 |

**不改**：`src/host/http.ts`（仍 3 条路由）、`src/host/adapters.ts`（本轮无新宿主服务）、`src/host/gate/gate.ts` 主体、`src/host/memory/*`、`src/host/team/trigger*.ts` 主体。

## 2. 数据模型与存储

### 2.1 `src/shared/types.ts` 精确扩张（AC-10）

```ts
// ① TaskStatus 9 → 10
export type TaskStatus = 'pending' | 'blocked' | 'ready' | 'running' | 'paused'
  | 'gate' | 'done' | 'rework' | 'failed' | 'interrupted'

// ② PanelAction 11 → 15
| { type: 'pause' }
| { type: 'resumeTeam' }
| { type: 'restoreDefaultRoles' }
| { type: 'saveSettings'; settings: unknown }   // unknown：服务端校验，非法即拒（AC-17）

// ③ RejectionCode 11 → 12
| 'PAUSED'

// ④ Role + prompt
export interface Role { /* 既有 6 字段不变 */ prompt?: string }

// ⑤ PanelSnapshot + 4 字段
export interface PanelSnapshot {
  /* 既有字段不变 */
  paused?: boolean
  pausedAt?: number
  settings?: AutoTeamSettings
  skills?: SkillInfo[]
}

// ⑥ 两个新接口（settings.json 与设置页技能多选的数据源）
export interface AutoTeamSettings {
  concurrencyLimit: number      // 1..8   缺省 3
  memoryBudget: number          // 200..4000 缺省 4000
  stallMs: number               // 1000..600000 缺省 90000
  maxAttempts: number           // 1..10  缺省 3
  gateTimeoutMs: number         // 1000..600000 缺省 300000
  captainModel?: RoleModelRoute // 复用既有 provider+model+reasoningEffort
}
export interface SkillInfo { id: string; title: string; description: string }
```

**不动**：`ActivityEvent.kind` 仍 9 值、HTTP 路由仍 3 条、`PlanTask` 字段集不变（任务内容 = `title` + `acceptance`）、`Plan` 不变、`ConcurrencyView` 不变。

### 2.2 `settings.json` 落点与 schema

- 路径：`settingsPath(home) = globalDataRoot(home) + '/settings.json'`，`home = os.homedir()`。
  真机实测目标：**`/Users/maliang/.dsh/auto-team/settings.json`**（`globalDataRoot` 已含 `.dsh`，绝不能再拼一层 `.dsh`）。
- 内容即 `AutoTeamSettings` 六字段；**每个字段可缺席**，缺席 = 用缺省值（→ AC-11「空设置下行为等于今天」）。
- 写入：`JSON.stringify(settings, null, 2)`，先校验后写，写临时文件 `.settings.json.tmp` 再 `rename`（同名原子替换），保证 AC-17「非法输入磁盘逐字不变」。
- 读失败（文件损坏 / 非 JSON / 非对象）→ 静默回落缺省值并 `warn` 日志，不抛、不影响插件激活。

`src/host/settings.ts` 契约：

```ts
export interface SettingsRepo {
  path(): string
  read(): AutoTeamSettings
  save(raw: unknown): { ok: true; settings: AutoTeamSettings } | { ok: false; reason: string }
}
export function createSettingsRepo(deps: { file: string; now?: () => number }): SettingsRepo
export function validateSettings(raw: unknown): { ok: true; settings: AutoTeamSettings } | { ok: false; reason: string }
export function defaultSettings(): AutoTeamSettings
```

校验规则（全部整数、有界、中文 reason）：

| 字段 | 合法域 | 非法示例 → reason |
|---|---|---|
| `concurrencyLimit` | 1..8 | `0` / `9` → 「并发上限需为 1~8 的整数」 |
| `memoryBudget` | 200..4000 | `0` → 「记忆预算需为 200~4000 的整数」 |
| `stallMs` | 1000..600000 | `999` → 「停滞阈值需为 1000~600000 的整数」 |
| `maxAttempts` | 1..10 | `0` → 「返工上限需为 1~10 的整数」 |
| `gateTimeoutMs` | 1000..600000 | `999` → 「门禁超时需为 1000~600000 的整数」 |
| `captainModel` | 缺席 或 `validateModel`（provider+model 成对） | 只填 provider → 「提供方与模型需同时填写」 |

`captainModel` 的校验**复用** `src/host/roles/repo.ts` 里既有的 `validateModel`（不允许再写一份，见 §8 duplications）。

### 2.3 `RunState.pause`（暂停状态机记账）

```ts
// src/host/store.ts
export interface PauseRecord {
  at: number
  planStatus: PlanStatus                     // 暂停前的计划状态（通常是 dispatching / draft）
  tasks: Record<string, TaskStatus>           // 被暂停的任务 → 暂停前状态
}
export interface RunState { /* 既有字段 */ pause?: PauseRecord }
export const RUN_STATE_VERSION = 3
```

- `pause` 时：遍历任务，`status ∈ {running, ready}` → `paused`，并把原状态写进 `pause.tasks`；`plan.status = 'paused'`；写 `pause = { at, planStatus, tasks }`。
- `resumeTeam` 时：`plan.status = pause.planStatus`（缺失回落 `dispatching`）；`pause.tasks` 里每条还原到记录值（缺失回落 `ready`）；删除 `pause`。
- **`done` 永不回退**：`done` 不在被暂停集合里，`pause.tasks` 也不含它，还原时自然不触碰 → AC-9「done 不回退不重跑、attempts 不变」。
- 重启存活：`RunsStore` 反序列化 + `normalizePause()` 白名单归一（`at` 有限数、`planStatus ∈ PLAN_STATUSES`、`tasks` 只收 `TASK_STATUSES` 内的值），旧 `version:2` 文件按 `wrapLegacy` 兼容（无 `pause` 即视为未暂停）。

### 2.4 与 AC-10「`PlanTask` 不新增字段」的冲突裁决

AC-9 要求「记录 `pausedFrom`（原状态）」，而 AC-10 又写 `PlanTask` 不新增字段。裁决：

- **`PlanTask` 保持零新增**（AC-10 是形状扫描的判据面，`git diff src/shared/types.ts` 必须只出现 §2.1 的六行）；
- 原状态记在 **`RunState.pause.tasks`**（宿主内部持久化状态，不进 `PanelSnapshot`、不进 `PlanTask`）。
- **理由**：暂停/继续是一次事务，`planStatus + 每条任务原状态`必须原子落盘同一个对象；若拆成 `Plan.pausedFrom` + 每任务 `pausedFrom` 就是两处真值、两种归一化、两种回滚路径，正是本项目历史上「同一份数据两条链路给不同结论」的形态。面板只需要 `paused` / `pausedAt` 两个标量，其余是宿主私事。
- QA 可判定：`git diff src/shared/types.ts` 行数不变；`grep -c 'pausedFrom' src/shared/types.ts` = 0；`grep -c 'pause?' src/host/store.ts` ≥ 1。

## 3. API 设计

### 3.1 路由（**不新增，仍 3 条**）

| 方法 | 路径 | 入参 | 返回 |
|---|---|---|---|
| GET | `/api/auto-team/snapshot` | `?sessionId=<id>` | `Result<PanelSnapshot>`（新增 `paused/pausedAt/settings/skills`） |
| GET | `/api/auto-team/memory` | `?sessionId=&track=&file=` | `Result<{ content, truncated }>`（不变） |
| POST | `/api/auto-team/act` | body `{ sessionId, action: PanelAction }` | `Result<ActResult>`（`rejected.code` 可能是 `PAUSED`） |

采样命令（QA/验收用）：

```bash
curl -s -b "$COOKIE" 'http://127.0.0.1:<port>/api/auto-team/snapshot?sessionId=<sid>' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.data.planStatus, j.data.paused, JSON.stringify(j.data.settings), (j.data.skills||[]).length)})'
```

### 3.2 `PanelAction` 全量行为表（15 项）

| type | 载荷 | 暂停态 | 服务端行为 |
|---|---|---|---|
| `toggle` | — | 允许 | 只改启用标志并 `persistFlags`，**绝不派发** |
| `dispatch` | `{runId}` | **拒 `PAUSED`** | 派发未绑定 ready 任务 |
| `cancel` | `{runId}` | 允许 | 计划置 `cancelled` |
| `setTaskRole` | `{taskId, roleId}` | 允许 | 仅 pending/blocked/ready 可改 |
| `message` | `{memberId, text}` | 允许 | 给成员发消息（不推进状态） |
| `resume` | `{taskId?}` | **拒 `PAUSED`** | 续聊中断成员（会推进任务） |
| `receipt` | `{taskId, receipt}` | **拒 `PAUSED`** | 门禁回执（会改状态/触发返工） |
| `saveMemory` / `deleteMemory` | 既有 | 允许 | 记忆文件读写 |
| `saveRole` / `deleteRole` | 既有（+`prompt`） | 允许 | 角色落盘 |
| `pause` | — | 幂等 | 记录 `pause`、`running/ready → paused`、`plan.status='paused'`、追加 `status` 类活动 |
| `resumeTeam` | — | 必须已暂停 | 还原 `plan.status` 与任务原状态、清 `pause`、追加活动 |
| `restoreDefaultRoles` | — | 允许 | 重写 6 个内置角色（含 `prompt`），自建角色不动 |
| `saveSettings` | `{settings}` | 允许 | 校验→原子写 `settings.json`→`onSettingsSaved` 回调 |

拒绝码文案（`reasonText` 必须补齐，否则界面出现空 reason）：
`PAUSED` → 「任务已暂停：请先在面板顶部点「继续任务」再操作」。

### 3.3 `snapshot()` 新增字段语义

| 字段 | 来源 | 语义 |
|---|---|---|
| `paused` | `plan?.status === 'paused'` | 暂停按钮文案的唯一真值 |
| `pausedAt` | `state.pause?.at` | 暂停时刻（横幅显示「已暂停 · HH:mm」） |
| `settings` | `settingsRepo.read()` | 设置页表单初值 |
| `skills` | `BUILTIN_SKILLS` 映射 `{id,title,description}` | 角色技能多选的可选项 |

## 4. 前端组件与页面切分

### 4.1 槽位注册（逐字，AC-3/AC-4/AC-5）

`src/client/slots.ts` 常量（**slot 字面量只许出现在本文件**，AST 守卫）：

```ts
export const INPUT_DOCK_SLOT      = 'conversation.input.dock'
export const HEADER_ACTIONS_SLOT  = 'conversation.session.header.actions'
export const PANEL_SLOT           = 'sidebar.right.pane.tab'          // 既有
export const PANEL_TITLE_SLOT     = 'sidebar.right.pane.tab.title'    // 既有
export const SETTINGS_SECTION_SLOT = 'settings.section'
export const OPTION_ID  = 'dsh-auto-team-option'
export const HEADER_ID  = 'dsh-auto-team-header-button'
export const SECTION_ID = 'dsh-auto-team'
export const SECTION_LABEL = '自动团队'
```

注册对象字段集（与同机样本一致，`order` 数字见 PRD §5.1）：

| 挂载点 | 注册对象 |
|---|---|
| `conversation.input.dock` | `{ name: INPUT_DOCK_SLOT, id: OPTION_ID, order: 5, inject }` |
| `conversation.session.header.actions` | `{ name: HEADER_ACTIONS_SLOT, id: HEADER_ID, order: 0, inject }` |
| `sidebar.right.pane.tab` | `{ name: PANEL_SLOT, key: PANEL_KEY, inject }` |
| `sidebar.right.pane.tab.title` | `{ name: PANEL_TITLE_SLOT, key: PANEL_KEY, inject }` |
| `settings.section` | `{ name: SETTINGS_SECTION_SLOT, id: SECTION_ID, order: 40, label: SECTION_LABEL, inject }` |

- `inject` 一律返回 `{ sessionId }`（面板需要会话作用域；`openPanel` 只给 header 按钮的 bag）。
- 右栏页签三步注册不回退：`sidebarRightTabs.register({ id: PANEL_TAB_KIND, kind: PANEL_TAB_KIND, ... })` + `createOpenPanel`（`openTab` 优先、`CustomEvent` 回退）。
- **撤除**：`conversation.composer.dock` 注册 0 处；`composer.bar` / `input.activity` / `header.corner` / `shell.leading` / `settings.header` 一律不得出现。

### 4.2 组件树

```
src/client/index.ts                 apply(ctx) → registerPanelTab + registerSlots
  ├─ Option.tsx          (input.dock)        胶囊开关：启用/停用 + 计划状态点
  ├─ HeaderButton.tsx    (header.actions)    「自动团队」按钮 → openTab
  ├─ Panel.tsx + TabTitle.tsx (右栏)         页头(完成 x/N + 暂停/继续) + 4 页签
  │    └─ tabs/PlanTab.tsx   任务行 = progressOf(task) + title + 任务内容 + 角色 + 门禁证据
  │    └─ tabs/RolesTab.tsx  → RoleEditor.tsx
  └─ SettingsPage.tsx    (settings.section)  参数区(6 项) + 角色区 → RoleEditor.tsx
```

`RoleEditor.tsx` 导出 `RoleEditorList`，props：`{ roles, skills, density: 'panel' | 'page', busy, onSave(role), onDelete(id), onRestoreDefaults() }`。两处共用同一组件、同一个 `saveRole` 校验函数（DESIGN §3.3 纪律）。

### 4.3 数据流

```
PanelStore(每 session 一个单例) ──snapshot──▶ 各组件（唯一真值）
        ▲
        └── act(action) ──▶ POST /act ──▶ 返回新 snapshot ──▶ 覆盖 store
```
- 组件**没有**乐观状态：所有可见文案由 `snapshot` 派生（AC-15「失败不改文案」天然成立）。
- 组件局部态只允许：`busy`（请求中，禁点不改文案）、`editing`（编辑中的草稿）、`pendingDelete`（二次确认）、`error`（就地错误行）。
- 前端读接口必须解构 `{data,error}`：解包点唯一，仍在 `src/client/api.ts` 的 `request<T>()`。新增请求一律经 `act`，**不新增 fetch**。

### 4.4 渲染描述层 `src/client/ui.ts`（判据落点）

**为什么必须有这一层**：本仓 `node_modules` 里只有 `react`，**没有 `react-dom`**，`node --test` 只剥类型不转 JSX → PRD 里写的 `renderToStaticMarkup` 在本仓物理上跑不了。替代物是「渲染描述层」：把每个可见面的 **hook / 文案 / 状态 / 文案往返规则** 收进无 JSX 的纯函数，组件只做「把返回值贴到 DOM」的动作。判据因此比快照测试更强：它同时覆盖「逻辑对」与「模板真绑定了这个 hook」（模板没绑 → AST 守卫红，见 §7.1）。

```ts
// src/client/ui.ts
export interface OptionView  { hook: 'data-auto-team-option'; label: string; ariaLabel: string; pressed: boolean; state: 'off' | 'on' | 'paused' | 'busy' }
export interface HeaderView  { hook: 'data-auto-team-header-button'; label: string; ariaLabel: string; badge: string }
export interface PauseView   { hook: 'data-auto-team-pause'; label: '暂停任务' | '继续任务'; action: 'pause' | 'resumeTeam'; tone: 'warn' | 'muted'; disabled: boolean }
export interface TaskRowView { hook: 'data-auto-team-task'; title: string; content: string; statusLabel: string; statusTone: 'ok'|'warn'|'bad'|'muted'; roleLabel: string; evidence: string }

export function optionView(input: { enabled: boolean; busy: boolean; planStatus?: PlanStatus; done: number; total: number }): OptionView
export function headerButtonView(input: { enabled: boolean; planStatus?: PlanStatus; done: number; total: number }): HeaderView
export function pauseButtonView(input: { paused: boolean; busy: boolean }): PauseView
export function taskRowView(task: PlanTask, roles: Role[]): TaskRowView
export function settingsKeysView(settings: AutoTeamSettings): { key: string; label: string; hint: string; value: string }[]
```

`pauseButtonView` 的硬规矩（AC-15）：
- `paused === false` → 文案「暂停任务」/ `action: 'pause'`；`paused === true` → 「继续任务」/ `resumeTeam`；
- `busy === true` **只置 `disabled`，文案与 action 逐字不变**（禁止乐观切换）；
- `min-width: 80px`（DESIGN §0.2），两态同尺寸、页头不重排。

### 4.5 样式改名与新增

- 全量改名：`data-dsh-auto-team-toggle` → `data-auto-team-option`；`data-dsh-auto-team-panel` → `data-auto-team-panel`；`data-toggle-*` → `data-option-*`。判据：`grep -rn 'data-dsh-auto-team' src test | wc -l` = 0。
- 新增四段（数值逐字取自 DESIGN §0.2）：`[data-auto-team-option]`（高 28 + `::after{inset:-8px -6px}` 扩命中区 44×40）、`[data-auto-team-header-button]`（高 24）、`[data-auto-team-pause]`（高 28 / min-width 80）、`[data-auto-team-settings]`（角色卡 `padding:16px`、提示词 `textarea` 固定 `height:96px` 内滚，**绝不 auto-grow**）。
- 字号只写 `font: var(--dsw-font-xs-13, …)` 复合写法，禁止 `font-size: var(--dsw-…)`（既有守卫命令保留）。
- 暂停视觉：琥珀色 + `⏸` + 左 3px 竖条、去阴影（红色留给中断/失败）。

## 5. 状态管理

| 状态 | 存放 | 说明 |
|---|---|---|
| 启用/停用 | `RunFlags`（宿主落盘） | toggle 只改它 |
| 计划暂停 | `RunState.pause` + `Plan.status` | 宿主唯一真值，重启存活 |
| 任务状态 | `PlanTask.status` | 含新 `paused` |
| 设置参数 | `settings.json` | 面板/设置页都经 `saveSettings` 写它 |
| 角色 | `roles/*.json` | 面板与设置页共用 `saveRole` |
| 客户端局部态 | React `useState` | 仅 `busy` / `editing` / `pendingDelete` / `error` |

暂停/继续时序（面板视角）：

```
点「暂停任务」→ act({type:'pause'}) → busy(文案仍「暂停任务」)
  → 服务端: plan.status='paused', running/ready→paused, 写 pause
  → 返回新 snapshot(paused=true) → 文案变「继续任务」+ 琥珀横幅「已暂停 · HH:mm」
点「继续任务」→ act({type:'resumeTeam'}) → busy → 服务端还原 → snapshot(paused=false)
```

## 6. 关键实现点与边界

### 6.1 暂停只停「派发与推进」，不打断在跑成员

- `bridge.dispatch`：`plan.status === 'paused'` → `reject('PAUSED')`（去掉既有「paused 允许派发」分支）。
- `dispatchReady`（`team/dispatch.ts:344-345`）：允许派发的 `planStatus` 集合收紧为 `draft | dispatching`（双保险，单测直接驱动纯函数）。
- `watcher.tick`：`state.plan?.status === 'paused'` 时 **跳过** `stallAlertsOf` 与 `onPoll`（trigger 轮询），**仍执行** `reconcileMembers`——被暂停的任务已不在 reconcile 的扫描集合（`running/gate/interrupted`）里，天然不会被改写；跳过 `onPoll` 就掐断了「定时推进下游」这条路。
- **不杀在跑成员**：暂停不调用任何 abort/interrupt 端口。
- 暂停期间成员完成：`receipt` 被 `PAUSED` 拦下，成员完成事实保留在成员侧（成员不会被中断）；面板在暂停期间照常展示 `members`，用户能看到谁刚好跑完；`resumeTeam` 后由下一 tick 的 reconcile 与后续 `receipt` 推进。这条写进边界表，避免 QA 把它当缺陷。

### 6.2 恢复默认角色可分辨（AC-8）

```ts
// src/host/roles/repo.ts
restoreDefaults(): { restored: string[]; kept: string[] }
```
- 只重写 `BUILTIN_ROLES` 的 6 个 `roles/<id>.json`，内容 = `BUILTIN_ROLES` 逐字（`updatedAt` 取 `now()`）；自建角色文件**不读不写**。
- `save()` 的 `builtin` 改为**永远推导**：`const builtin = BUILTIN_ROLES.some(r => r.id === id)`（当前实现 `existing?.builtin ?? …` 允许对自建 id 写 `builtin:true` 造成不可删，属本 AC 要堵的绕道）。
- 变异自检：把 `builtin` 改回 `existing?.builtin ?? …`，`test/roles.test.ts` 的「非内置 id 写 builtin:true 后仍可删除」必红；把 `restoreDefaults` 改成「覆盖全部角色」，「自建角色 sha256 不变」必红。

### 6.3 内置角色 prompt 与成员提示词

- `BUILTIN_ROLES` 6 条各补 `prompt`（非空、互异、中文、≤8000 字符），语义 = 该角色的职责边界与输出要求（`pm` 出 PRD/AC、`architect` 出架构、`dev` 出实现、`qa` 出证据、`docs` 出文档、`reviewer` 出裁定）。
- `member-prompt.ts`：拼接顺序 角色名 → `duty` → `prompt`（若有）→ 技能正文（`composeSkillPrompt`）→ 任务与验收 → 记忆。单测断言提示词含 `role.prompt` 的**特征串**（如 `pm` 的「验收标准必须可判定」），防止「存了但没用上」。
- 校验：`saveRole` 对 `prompt` 做 8000 字符上限 + 类型校验，非法 → `BAD_REQUEST` + 磁盘不变。

### 6.4 设置生效点（5 处，全部可选入参，缺省=今天）

| 设置 | 生效点 | 规则 |
|---|---|---|
| `concurrencyLimit` | `index.ts` 的 `hostConcurrency()` | settings 未配置该项 → 完全走 `resolveConcurrencyLimit(ctx)`（今天行为）；配置了 → `limit = settings.concurrencyLimit`，`source` 仍如实反映宿主是否给过上限（`host`/`default`，`ConcurrencyView` 形状不变） |
| `memoryBudget` | `bridge` 组装 `memory` 投影 | 传入 `budget`（缺省 `MEMORY_INJECT_BUDGET`） |
| `stallMs` | `createMemberWatcher({ stallMs })` + `stallAlertsOf` | 缺省 `STALL_MS`（`WATCHER_INTERVAL_MS` 仍不可配） |
| `maxAttempts` | `dispatch/reconcile/applyReceipt` 的可选参数 | 缺省 `MAX_ATTEMPTS` |
| `gateTimeoutMs` | 门禁执行端口参数 | 缺省 `GATE_TIMEOUT_MS` |
| `captainModel` | `settings.json` 为**唯一写入点** | 读取优先级：`settings.captainModel` → 回落 `<dataRoot>/captain.json`（迁移期只读，不再写）；`onSettingsSaved` 回调里重新 `installCaptainRoute` |

**AC-11 自守**：`MEMORY_INJECT_BUDGET` / `WATCHER_INTERVAL_MS` / `PANEL_ACTIVE_MS` / `STALL_MS` 仍各 1 处定义，值不变；`setInterval` 仍 1 处（watcher）；空 `settings.json` 下所有消费点取到的值与今天逐字相同。

### 6.5 边界与异常

| 场景 | 处理 |
|---|---|
| `settings.json` 不存在 | `read()` 返回缺省值，不创建文件（保存时才创建目录+文件） |
| `settings.json` 损坏 | 静默回落缺省 + warn，不抛 |
| 非法设置提交 | `reject('BAD_REQUEST')` + 中文 reason + 磁盘逐字不变（先校验、后原子写） |
| 并发上限调低到低于当前 running | 不杀在跑成员，下次派发才按新值判 `CONCURRENCY_FULL` |
| 无计划时 `pause` | `reject('NO_PLAN')` |
| 已暂停再 `pause` | 幂等成功，不重复记账、不覆盖 `pause.at` |
| 未暂停 `resumeTeam` | 幂等成功（no-op），不报错 |
| 计划已 `terminated`/`cancelled` | `pause`/`resumeTeam` → `BAD_REQUEST`「计划已结束」 |
| 重启后仍在暂停 | `plan.status='paused'` 是权威判据，`pausedAt` 来自 `pause.at` |
| 暂停期间成员完成 | 见 §6.1：`receipt` 被拦、成员不被中断，面板照常展示 |
| 角色 prompt 超长 | 8000 字符上限拒绝；`textarea` 固定 96px 内滚 |
| 用户删掉自定义技能文件 | 角色 `skillIds` 缺失项在设置页显示为「缺失（不会注入）」，不自动删除 |

## 7. 测试策略

### 7.1 判据形态说明（AC-12/13/15/16 的落地方式）

PRD 写的 `renderToStaticMarkup` 在本仓不可用（无 `react-dom`，`node --test` 不转 JSX）。替代方案 = **双层判据**，强度不低于快照测试：

1. **渲染描述层单测**：直接 import `src/client/ui.ts`（纯 TS），断言 hook 字面量、文案往返、10 态标签、参数行 key 集合。这是 `test/client-ui.test.ts`。
2. **AST 守卫**：用 `typescript` 包解析 `.tsx`（沿用 `test/client-contract.test.ts` 既有手法），断言 ① 每个组件文件**调用了**对应的 `xxxView(`；② hook 字面量在组件里真实出现（防「逻辑有、模板没绑」这一本项目头号 bug 族）；③ slot 字面量只许在 `slots.ts`；④ 10 态中文标签字面量只许在 `viewmodel.ts`。
3. **不新增依赖**：不为测试安装 `react-dom`（最小结构原则）。

### 7.2 用例清单

| 文件 | 动作 | 覆盖 |
|---|---|---|
| `test/settings.test.ts` | 新增 | 缺省值、六字段边界（合法/非法各 ≥2）、往返读写、非法提交后磁盘逐字不变、损坏文件回落、`path()` 落在 `<home>/.dsh/auto-team/settings.json` |
| `test/pause.test.ts` | 新增 | AC-9：pause/resumeTeam 往返还原、`done` 三字段不变、`attempts` 不变、暂停期间 dispatch 计数 0、无新 spawn/tool 活动、幂等、无计划/已结束拒绝、重启后读回仍暂停 |
| `test/roles.test.ts` | 新增 | AC-7/AC-8：6 个 `prompt` 非空互异、落盘含 prompt、`restoreDefaults` 逐字复原、自建角色 sha256 不变、`builtin:true` 绕道被堵、prompt 进成员提示词（特征串） |
| `test/client-ui.test.ts` | 新增 | AC-12/13/14/15/16：`optionView`/`headerButtonView`/`pauseButtonView`/`taskRowView`/`settingsKeysView` 逐条断言 + busy 文案不变 + 10 态标签 + 6 个 `data-setting-key` |
| `test/client-contract.test.ts` | 扩展 | AC-3/AC-4/AC-5：四个挂载点字段集与字面值、`composer.dock` 0 处、`index.ts` 零 `slots.register(`、AST hook 守卫、页签三步注册 |
| `test/viewmodel.test.ts` | 扩展 | `statusBadge('paused')`、`progressOf(task)` 10 态与百分比 |
| `test/bridge.test.ts` | 扩展 | 4 个新 action 的行为与拒绝码、`snapshot` 四字段、`PAUSED` 闸门表 |
| `test/store.test.ts` | 扩展 | `normalizePause` 白名单、`version:2 → 3` 兼容、`TASK_STATUSES` + `paused` |
| `test/dispatch.test.ts` | 扩展 | `dispatchReady` 在 `paused` 下 started 为 0 |
| `test/member-prompt.test.ts` | 扩展 | `role.prompt` 拼入提示词 |
| `test/host-contract.test.ts` / `test/wire.test.ts` | 扩展 | 路由仍 3 条、`inject` 仍 4 项、`setInterval` 仍 1 处 |

新增用例目标 ≥ 60，总用例数 ≥ 397（基线 337 只增不减，AC-22）。

### 7.3 变异自检清单（每条都要「改回错误实现必红」）

| 变异 | 必红断言 |
|---|---|
| `pauseButtonView` 忽略 `busy`、直接按「点击后取反」出文案 | 「busy 期间文案逐字不变」 |
| `pause` 把 `done` 也改 `paused` | 「done 三字段不变」 |
| `resumeTeam` 把 `attempts` 清零 | 「attempts 不变」 |
| 去掉 dispatch 的 `PAUSED` 闸门 | 「暂停期间 dispatch 计数 0」 |
| `restoreDefaults` 覆盖自建角色 | 「自建角色 sha256 不变」 |
| `builtin` 改回信任磁盘标志 | 「非内置 id 写 builtin:true 仍可删」 |
| `saveSettings` 先写盘后校验 | 「非法提交后磁盘逐字不变」 |
| `optionView` 的 label 换成旧前缀 hook | AST hook 守卫 + `client-ui` hook 断言 |
| 10 态标签改回 9 态（`paused` 落到默认分支） | 「`paused` 标签 = 已暂停」 |
| `input.dock` 注册缺 `order` 或改回 `composer.dock` | 挂载点字段集 + 「composer.dock 0 处」 |

### 7.4 门禁命令（提交前全绿）

```bash
pnpm typecheck
pnpm test                                   # 期望 ≥ 397 pass / 0 fail
pnpm build
node --input-type=module -e "await import('./lib/index.js'); await import('./lib/client.js')"
npm pack --dry-run 2>&1 | grep -E 'lib/(index|client)\.js|cordis.patch\.yml'   # 3 条目
grep -rn 'data-dsh-auto-team' src test | wc -l          # 0
grep -c "conversation.composer.dock" src/client/slots.ts # 0
grep -rn "from '\.\./host/" src/client | wc -l           # 0
grep -rn 'setInterval' src | wc -l                       # 1
grep -c 'pausedFrom' src/shared/types.ts                # 0
git status --porcelain --untracked-files=all             # 只剩预期文件
```

## 8. 并行任务拆分

依赖：`T1 → (T2 ∥ T3) → T4 → T5 → T6`。T2 与 T3 文件集不相交，可并行；T5 的用例文件与 T4 的组件文件不相交，可与 T4 并行推进（但断言以 T1 契约为准）。

### T1 契约与纯逻辑（先做，其余都依赖它）

- files：`src/shared/types.ts`、`src/host/config.ts`、`src/host/paths.ts`、`src/host/settings.ts`、`src/host/store.ts`、`src/host/roles/builtin.ts`、`src/host/roles/repo.ts`
- 交付：§2 全部形状 + `settings.ts` 读写校验 + `PauseRecord` 归一 + 6 个内置 `prompt` + `restoreDefaults`
- 验收：`pnpm typecheck` 0；`test/settings.test.ts`、`test/roles.test.ts`、`test/store.test.ts` 绿；`git diff src/shared/types.ts` 只含 §2.1 六项

### T2 宿主动作与投影

- files：`src/host/bridge.ts`、`src/host/team/watcher.ts`、`src/host/team/dispatch.ts`、`src/host/team/member-prompt.ts`、`src/host/index.ts`
- reads：T1 的 types/settings/store/roles 契约
- 交付：4 个新 action、`PAUSED` 闸门表、`snapshot` 四字段、paused 下的 watcher/dispatch 行为、5 个设置生效点、`onSettingsSaved`
- 验收：`test/bridge.test.ts`、`test/pause.test.ts`、`test/dispatch.test.ts`、`test/member-prompt.test.ts` 绿；`grep -rn 'setInterval' src | wc -l` = 1

### T3 客户端渲染描述层与视图模型

- files：`src/client/ui.ts`、`src/client/viewmodel.ts`
- reads：`src/shared/types.ts`
- 交付：§4.4 五个 `*View` 函数 + `progressOf(task)` + `statusBadge` 补 `paused`
- 验收：`test/client-ui.test.ts`、`test/viewmodel.test.ts` 绿（此时组件尚未改，测试只驱动纯函数）

### T4 客户端组件与槽位

- files：`src/client/slots.ts`、`src/client/Option.tsx`、`src/client/HeaderButton.tsx`、`src/client/SettingsPage.tsx`、`src/client/RoleEditor.tsx`、`src/client/Panel.tsx`、`src/client/tabs/PlanTab.tsx`、`src/client/tabs/RolesTab.tsx`、`src/client/TabTitle.tsx`、`src/client/styles.ts`、`src/client/index.ts`、删除 `src/client/Toggle.tsx`
- reads：T3 的 `ui.ts` 签名、`src/client/api.ts`、`src/client/state.ts`
- 交付：四挂载点 + 三处可见面 + 样式改名（61 处）+ 面板页头/任务行
- 验收：`test/client-contract.test.ts` 绿；改名判据 0 命中；`pnpm build` 双产物

### T5 守卫与真机脚本

- files：`test/client-contract.test.ts`（扩展）、`test/host-contract.test.ts`、`test/wire.test.ts`、`logs/teamflow/tf-mvxo8o98-3vdnl3/scripts/*.mjs`（探针，按需扩展既有文件，不重建）
- 交付：AST hook 守卫、路由/inject/setInterval 不变式、AC-19 活会话四件套采样脚本、AC-20 暂停往返采样脚本、AC-21 设置→重启存活脚本
- 验收：脚本在仓库根可跑（`new URL('../../../../', import.meta.url)` 锚定仓库根）

### T6 门禁与交付自检

- files：无源码改动（只跑命令 + 提交）
- 交付：§7.4 全部命令 + `git diff --stat` 白名单核对 + 单笔提交
- 验收：全绿；提交信息见 §9

## 9. git 与交付纪律（PRD §10 落到任务里）

1. **不新建分支、不切 main**：全程在 `feat/auto-team-plugin`。
2. 提交前 `git status --porcelain --untracked-files=all` 只剩：本任务夹文档、`src/**` 改动、`test/**` 改动、`lib/index.js` + `lib/client.js`（构建产物入库）。
3. `lib/` 必须入库；`.gitignore` 不得忽略 `lib/`（已满足，勿改动）。
4. 临时脚本只放 `logs/teamflow/tf-mvxo8o98-3vdnl3/scripts/`（已 gitignore）。
5. 全部实现 + 本夹文档完成后**单笔**提交：
   `feat(r7): 输入框选项 + 会话头按钮 + 右栏面板暂停继续 + 设置页角色管理`
6. 提交后不再改任何文件（避免「已完成复核覆盖的版本已不存在」）。
7. 真机安装只由主 agent 按 PRD §9 六步执行（子代理写不了 `~/.dsh/profiles/desktop`）。

## 10. 风险与回退

| 风险 | 缓解 |
|---|---|
| `conversation.session.header.actions` / `settings.section` 在旧宿主不存在 | `slots.inject` 只在挂载点存在时回调：缺失则该面不出现，其它三面不受影响（构建与激活均不失败） |
| 客户端 hook 改名波及既有单测 | 改名与单测同批改；判据一次性给到 0 命中 |
| `RUN_STATE_VERSION` 升到 3 导致旧 run 读不回 | `wrapLegacy` 兼容：无 `pause` 视为未暂停，其余字段归一不变 |
| 设置项改动触发 AC-11 形态冻结失效 | 冻结常量值一个不改，只加可选入参；`grep` 计数式守卫保留 |
| 暂停期间成员完成造成「状态看起来倒退」 | §6.1 明确定义并写进报告；面板文案「已暂停 · 成员仍可上报，继续后入账」 |
| 回退 | 单笔提交，`git revert <sha>` 一次还原；`settings.json` 为新增文件，删除即恢复缺省行为 |
