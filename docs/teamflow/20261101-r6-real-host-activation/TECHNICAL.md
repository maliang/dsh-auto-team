# TECHNICAL — r6 真机激活：宿主 inject 完备性 + client keyed slot

- 基线依赖：`docs/teamflow/20261101-r6-real-host-activation/PRD.md`；`取代 r5#AC-21` 的「单测全绿即充分」判据
- 分支：`feat/auto-team-plugin`（PRD 工程约束要求）；实际起点 HEAD = `61e03fd`（PRD 写的基线 `e6ae89c` 之后多了 1 笔真机验证文档，本设计以 `61e03fd` 为实际基线，不改历史）
- 技术栈不变：TypeScript ESM（Node ≥ 22.18）+ Cordis 插件（宿主 `lib/index.js`）+ React 17/18 client（`lib/client.js`，`__ModuleLoader__` 套壳）+ pnpm；`node --test test/*.test.ts` 直跑 TS 源
- 本方案**不改**任何业务逻辑、不新增 HTTP 路由/工具动作/预算常量，只修「服务访问契约」与「挂载点注册契约」两处，并加**能变红的守卫**与**可复跑的真机回路**

---

## 1. 根因：为什么 311 条单测全绿而真机全灭

两处缺陷不同族，但共享同一个病根：**判据与被测系统没有共享同一条契约**。

| 缺陷 | 现场报错 | 为什么单测测不出 |
|---|---|---|
| A 宿主半：`src/host/index.ts:69` `export const inject = ['tools', 'systemPrompt']`，但 `adapters.ts` 还裸访问 `agents`/`agentTeams`/`webServer`/`llm`/`agentDefaultModel` | 真机 `dsh: warning: 1 entry did not activate` + `auto-team-host (dsh-auto-team): Error: cannot get property "agentTeams" without inject` | `test/wire.test.ts` 的 fakeCtx 是「所有字段都已存在」的普通对象，**没有 cordis 的 inject 判据**：未声明就访问这件事在 mock 里永不报错 |
| B client 半：`src/client/index.ts:37-54` 对 `sidebar.right.pane.tab` 注册 `{name, id, order}`，无 `key`、无 `inject` | 真机控制台 `Uncaught Error: keyed slot "sidebar.right.pane.tab" requires options.key`，页签永不出现 | `ctx.slots.register` 的类型是本地自写 interface（`src/client/index.ts:23-31`），`register` 是空壳，**不校验 keyed slot 是否必填 `key`** |

因此本设计不是「补两行」，而是把两处契约**显式化 + 收敛到单点 + 用会变红的守卫绑死**：

1. 服务访问面：硬依赖进 `inject`（字面清单），可选服务**只能**经 `optionalService()` 走 `ctx.get`；两者由源码扫描守卫绑死。
2. 挂载点：keyed slot 的 `{name, key, inject}` 三字段成为**唯一允许的形状**，注册代码抽到一个**可被 `node --test` 直接驱动的纯模块**，把「mock 测不到」变成「mock 必须建模」。
3. 真机：一条可复跑脚本 + 结构化断言，主 agent 实跑原文进验收报告。

> 关键判断：**不要把 `webServer`/`llm`/`agentDefaultModel` 塞进 `inject` 换日志干净**。cordis 的 `inject` 数组 = 全部 required，缺一个就整条 entry 不激活——那等于把 r5 的降级语义（HTTP 路由可不注册、模型可退回会话默认）一次性推翻，下次宿主演进时再次全灭（PRD anti-goal 3）。

---

## 2. 模块与文件边界

| 文件 | 责任 | 本次改动 | 归属任务 |
|---|---|---|---|
| `src/host/index.ts` | 宿主入口：声明插件名/`inject`、装配 adapters | `inject` 从 2 项扩到 4 项硬依赖（字面） | T1 |
| `src/host/adapters.ts` | 唯一接触宿主 API 的胶水层 | 新增 `OPTIONAL_SERVICES`/`OptionalServiceName`/`optionalService()`；`HostContext` 增 `get?`；3 处可选服务读取改造；文件头写访问纪律 | T1 |
| `src/client/slots.ts`（新） | 挂载点注册契约：slot 名常量 + `registerSlots()` + **页签类型注册 `registerPanelTab()`** + 打开动作 `createOpenPanel()`（**不 import React/JSX**） | 新建 | T2 |
| `src/client/TabTitle.tsx`（新） | `sidebar.right.pane.tab.title` 的页签文案「自动团队」（文案单点取 `slots.ts: PANEL_TAB_LABEL`，与页签类型 `title` 同源） | 新建 | T2 |
| `src/client/index.ts` | client 入口：只做薄接线（`registerPanelTab(ctx)` → `registerSlots(...)`） | 删掉内联 `register` 调用；`ClientContext.slots.register` 类型加 `key?`/`inject?` | T2 |
| `src/client/Toggle.tsx` / `Panel.tsx` | 开关行 / 面板本体 | `Toggle` 增 `openPanel?`（走宿主 `sidebarRight.openTab`），拿不到服务回退旧窗口事件；`Panel` 零改动 | T2 |
| `test/host-contract.test.ts`（新） | 服务访问面守卫（源码扫描 + 集合断言） | 新建 | T3 |
| `test/client-contract.test.ts`（新） | 挂载点契约守卫（fake slots 驱动真实 `registerSlots`） | 新建 | T3 |
| `test/wire.test.ts` / `test/adapters.test.ts` | 现有集成/单元测试 | fakeCtx 补 `get(name)`（建模 cordis） | T3 |
| `logs/teamflow/tf-mvxcfxze-e9elp3/scripts/real-host-verify.sh`（新） | 真机四步回路（可复跑） | 新建 | T4 |
| `logs/teamflow/tf-mvxcfxze-e9elp3/scripts/real-host-assert.mjs`（新） | 真机取证的**结构化判定**（PASS/FAIL 逐条） | 新建 | T4 |
| `lib/index.js` / `lib/client.js` | 分发产物（profile 安装源，必须入库） | 由 `pnpm build` 重新生成 | T4 |

**依赖方向仍然铁律**：`src/shared`（纯类型/常量）← `src/host` 与 `src/client`；host 与 client 之间零直接 import，只经 `/api/auto-team`。`src/client/slots.ts` 只允许 import `../shared/const.ts`（`PLUGIN_ID`），不得 import `src/host/**`、不得 import 任何 `.tsx`。

---

## 3. 宿主半设计

### 3.1 inject 契约（硬依赖，字面清单）

`src/host/index.ts:69`：

```ts
/**
 * 硬依赖：宿主一定提供、缺一个就整条 entry 不激活，所以必须声明。
 * 可选服务（webServer/llm/agentDefaultModel）**不许**写在这里——数组形式等价于全部 required，
 * 宿主缺任一服务就整插件加载失败，等于推翻 r5 的降级语义。可选服务一律 adapters.optionalService()。
 */
export const inject = ['tools', 'systemPrompt', 'agents', 'agentTeams']
```

依据（裸访问面实测，全在 `src/host/adapters.ts`）：
`ctx.tools`（:107）、`ctx.systemPrompt`（:127）、`ctx.agents`（:250/:256/:1137）、`ctx.agentTeams`（:390/:561/:595/:795）。
`ctx.logger`/`ctx.effect`（:611）/`ctx.on`（:527 等）是 cordis Context 自身成员，**不是服务**，不进 `inject`。

### 3.2 `optionalService()`：可选服务的唯一入口

`src/host/adapters.ts` 新增：

```ts
/** 可选服务白名单：宿主可能不提供，缺失时功能降级而不是整插件加载失败。 */
export const OPTIONAL_SERVICES = ['webServer', 'llm', 'agentDefaultModel'] as const
export type OptionalServiceName = (typeof OPTIONAL_SERVICES)[number]

/**
 * 读取可选服务的唯一入口（cordis 纪律：未写进 inject 的服务只能 ctx.get，裸访问会抛
 * `cannot get property "<name>" without inject`）。
 * - 名字不在白名单：记 warn 并返回 undefined（编译期已挡，运行期兜底防绕过）；
 * - 宿主 ctx 没有 get（极简 mock / 未来宿主形状变化）：记 warn 并返回 undefined，**不**回退裸读
 *   ——回退裸读会让「mock 全绿、真机全灭」的旧病复发；
 * - get 抛错：catch → warn + undefined。
 */
export function optionalService<T>(ctx: HostContext, name: OptionalServiceName): T | undefined
```

改造点（**仅这 3 处**，`ctx.<service>` 裸访问改写为 `optionalService`）：

| 位置 | 原写法 | 新写法 | 缺失时的降级 |
|---|---|---|---|
| `src/host/adapters.ts:181`（`registerHttpRoutes`） | `const sink = ctx.webServer` | `const sink = optionalService<HttpSink>(ctx, 'webServer')` | HTTP 路由不注册，面板显示错误而非服务端 500；工具与内存仍可用 |
| `src/host/adapters.ts:503`（`createRoutePorts`） | `const resolver = ctx.llm?.resolveCallConfig` | `const resolver = optionalService<{ resolveCallConfig... }>(ctx, 'llm')?.resolveCallConfig` | 路由裁决退回内置默认策略 |
| `src/host/adapters.ts:396`（`createSpawnPorts.fallbackProvider`） | `ctx.agentDefaultModel?.currentSelection?.()` | `optionalService<{ currentSelection?: ... }>(ctx, 'agentDefaultModel')?.currentSelection?.()` | 派发不带模型覆盖（沿用成员会话默认） |

`HostContext`（`src/host/adapters.ts:33-74`）增一行动态签名：

```ts
/** cordis 的可选服务读取口；缺失时返回 undefined 不抛错。测试 fake 必须建模它。 */
get?<T = unknown>(name: string): T | undefined
```

文件头（现有「唯一接触宿主 API 的胶水层」注释处）追加访问纪律条款，供后来者照做：

> **服务访问纪律**：硬依赖（tools/systemPrompt/agents/agentTeams）写进 `src/host/index.ts` 的 `inject` 后可直接 `ctx.x`；未写进 `inject` 的一律 `ctx.get("x")`，且**只许**经 `optionalService()`。新增裸访问 = 宿主整插件不激活，`test/host-contract.test.ts` 会红。

### 3.3 mock 必须建模 cordis（根因修复，不只是补字段）

`test/wire.test.ts`（:86/:88/:105/:106）与 `test/adapters.test.ts`（:68/:171/:187/:193/:202/:210-215/:268-269/:330-331）的 fakeCtx 增加：

```ts
const ctx = { /* 现有字段保持不变 */ } as const
const get = (name: string) => (ctx as Record<string, unknown>)[name]
```

即 `ctx.get(name) === ctx[name]`。这样「未声明就访问」在 mock 里仍然可用（保持 311 例语义不变），但**生产路径只能经 `ctx.get`**——由守卫测试保证没人再写裸访问。fakes 只补 `get`，**不改任何既有断言**。

---

## 4. client 半设计

### 4.1 三个挂载点契约（唯一允许的形状）

样本实证（`~/.dsh/profiles/desktop/node_modules/dsh-better-sidebar/src/client/native/index.ts:318-334`、`dsh-plugin-teamflow/lib/client.js:5830-5836`）：keyed slot 用 `{name, key, inject}`，**不带 `id`/`order`**；非 keyed slot 用 `{name, id, order, inject}`。

| 挂载点 | 类型 | 注册形状 | 组件 |
|---|---|---|---|
| `conversation.composer.dock` | 非 keyed | `{ name: DOCK_SLOT, id: 'dsh-auto-team-toggle', order: 10, inject: (sessionId) => ({ sessionId }) }` | `Toggle` |
| `sidebar.right.pane.tab` | **keyed** | `{ name: PANEL_SLOT, key: 'dsh-auto-team-panel', inject: (sessionId) => ({ sessionId }) }` | `Panel` |
| `sidebar.right.pane.tab.title` | **keyed** | `{ name: PANEL_TITLE_SLOT, key: 'dsh-auto-team-panel', inject: (sessionId) => ({ sessionId }) }` | `TabTitle` |

硬约束（AC-6/AC-7）：

- `ctx.slots.inject(A, cb)` 的 `A` 与 `cb` 内 `register({ name })` 的 `name` **逐字相同**（三个挂载点逐一成立）；
- keyed 两个挂载点**必须有** `key`；`dock` **必须没有** `key`（守卫按「keyed 有、非 keyed 无」双向断言）；
- 插件标识（`PLUGIN_ID`）只允许出现在 `id`/`key` 里，**不许**出现在 `name`（写成插件名 = 静默不挂载，历史实锤）；
- 三个挂载点都传 `inject(sessionId)`：开关行与面板必须拿到同一个 `sessionId`（`state.ts:319 sessionIdOf` 会读 `props.sessionId`，缺失兜底 `'current'`）；
- keyed 挂载点**不传 `id`/`order`**：PRD 待澄清 a2（keyed 是否容忍额外字段）未验证，方案选择「不触碰未知形状」——沿用两个真实样本的字段集合。

### 4.1b 第 0 步：页签**类型**必须先注册进 `sidebarRightTabs`（QA-02 补，蓝图缺口）

**本节是 r6 第 2 轮 QA 打回的根因，原蓝图缺这一步。** 只注册 `sidebar.right.pane.tab` 两个 keyed 座位**不会**让页签出现：宿主派发 keyed 座位时，用「在册 tab 类型的 `id`」作为 key（宿主契约原文："dispatched with the `id` of the type in force for `tab.kind`"）；本插件从未往 `sidebarRightTabs` 注册类型，宿主因此没有该 kind 的 tab，座位永不派发 —— 症状是**构建全绿、控制台零报错、页签永不出现**（`grep -rn sidebarRightTabs src/` 当时 = 0 命中）。

三步缺一不可：

| # | 动作 | API | 位置 |
|---|---|---|---|
| ⓪ | 注册页签类型（`id === PANEL_KEY`，`priority: 'extension'`，`title: () => '自动团队'`） | `ctx.inject(['sidebarRightTabs'], cb)` → `cb.effect(() => tabs.register(definition))` | `slots.ts: registerPanelTab()`，由 `index.ts` 的 `apply()` 调用 |
| ① | 注册 body/title 两个 keyed 座位，`key` = ⓪ 的 `id` | `ctx.slots.inject(...)` → `register({ name, key, inject })` | `slots.ts: registerSlots()`（§4.1） |
| ② | **打开**页签（页面型页签不会自己出现） | `ctx.inject(['sidebarRight'], cb)` → `cb.sidebarRight.openTab(kind)` | `slots.ts: createOpenPanel()`，经 `inject` 下发给 `Toggle` 的「面板」按钮 |

```ts
// src/client/slots.ts（节选）
export const PANEL_TAB_LABEL = '自动团队'
export function panelTabDefinition(): PanelTabDefinition {
  return { id: 'dsh-auto-team-panel', kind: 'dsh-auto-team-panel', priority: 'extension', title: () => PANEL_TAB_LABEL }
}
export const PANEL_KEY = panelTabDefinition().id          // 单点：类型 id 与 keyed key 同源
export const PANEL_TAB_KIND = panelTabDefinition().kind

export function registerPanelTab(ctx: SlotsContext): boolean {
  if (typeof ctx.inject !== 'function') return false        // 拿不到 cordis inject → 降级，不抛
  ctx.inject(['sidebarRightTabs'], (scope) => {
    const tabs = scope.sidebarRightTabs
    if (tabs === undefined || typeof tabs.register !== 'function') return
    const definition = panelTabDefinition()
    const register = () => tabs.register(definition)        // 必须 `tabs.register(...)`：解构丢 receiver 会抛
    if (typeof scope.effect === 'function') scope.effect(register, 'dsh-auto-team: panel tab type')
    else register()
  })
  return true
}
```

四条实现纪律（均来自宿主 asar 官方文档 + 同机样本 `ui-schedule`／`dsh-plugin-teamflow`）：

1. **用 `ctx.inject([...], cb)`，不要 `ctx.get`**：`ctx.get` 全仓只许出现在 `src/host/adapters.ts`（QA 的 I8 判据 + `test/host-contract.test.ts` 的 `ctx.get` 断言）。`ctx.inject` 是 cordis 的「服务就绪才回调」，服务缺失时整插件照常激活，不会拖死 client entry。
2. 注册必须包在 `ctx.effect(...)` 里，宿主卸载时据返回的 disposer 回收。
3. `id` 必须与两个 keyed 座位的 `key` **同一个值**（`PANEL_KEY = panelTabDefinition().id` 单点派生，杜绝两处漂移）。
4. 页面型页签必须 `openTab(kind)` 才会出现；`Toggle` 的「面板」按钮优先走它，拿不到服务才回退旧的 `window.dispatchEvent`（旧实现只有事件、没有监听者时按钮等于无效）。

### 4.2 为什么把注册抽成 `src/client/slots.ts`

`node --test` 只能 strip 类型、**不能转 JSX**，所以任何 import `src/client/index.ts`（它 import `Toggle.tsx`/`Panel.tsx`）的测试**不可能跑起来**。要把 AC-6 的「runtime fake-slots 驱动真实注册代码」变成可执行事实，注册逻辑必须活在一个**不含 React/JSX 的纯模块**里：

```ts
// src/client/slots.ts —— 不含 React/JSX，可被 node --test 直接驱动
export const DOCK_SLOT = 'conversation.composer.dock'
export const PANEL_SLOT = 'sidebar.right.pane.tab'
export const PANEL_TITLE_SLOT = 'sidebar.right.pane.tab.title'

export interface SlotMeta { name: string; id?: string; key?: string; order?: number; inject?: (sessionId: string) => Record<string, unknown> }
export interface SlotsContext {
  slots: {
    inject(name: string, fn: () => unknown): void
    register(meta: SlotMeta, component: unknown): unknown
  }
}
export interface SlotComponents { Toggle: unknown; Panel: unknown; PanelTitle: unknown }

/** 注册全部挂载点。`deps` 只为让测试注入桩组件；生产由 index.ts 传真组件。 */
export function registerSlots(ctx: SlotsContext, deps: SlotComponents): void
```

`src/client/index.ts` 收敛为薄接线（并删掉本地 `DOCK_SLOT`/`PANEL_SLOT` 常量与内联 `register`）：

```ts
import { registerSlots } from './slots.ts'
import { Toggle } from './Toggle.tsx'
import { Panel } from './Panel.tsx'
import { TabTitle } from './TabTitle.tsx'
export const inject = ['slots']
export function apply(ctx: ClientContext): void {
  if (!ctx?.slots?.register) return
  registerSlots(ctx, { Toggle, Panel, PanelTitle: TabTitle })
}
```

这样 `test/client-contract.test.ts` 用一个**只记录调用**的 fake slots 就能断言真实注册值（且不需要 react）。

### 4.3 `TabTitle.tsx`

`sidebar.right.pane.tab.title` 承载页签文案。真机样本里每个页签都注册 `.title`；不注册时宿主可能渲染空标题/占位符，而 AC-8 的判据之一是「页签标题含‘自动团队’」。组件本身极薄：`export function TabTitle(): JSX.Element` 渲染 `<span data-auto-team-tab-title>自动团队</span>`（样式只用宿主 token：`font: var(--dsw-font-xs-13, …)`，**禁止** `font-size: var(--dsw-font-…)`）。挂载点不存在时 `slots.inject` 是 inert 的，注册它零副作用。

### 4.4 sessionId 注入链路（不改）

`slots.inject(name, fn)` 的回调收到宿主给的 `sessionId`，`fn` 把它放进 `register` 的 `inject(sessionId)` 返回值 → 组件 `props.sessionId` → `sessionIdOf(props)`（`src/client/state.ts:319`：先 `props.sessionId`，再 `props.session?.id`，兜底 `'current'`）。本需求只是把这条链**真的接上**（原实现 `register` 里没有 `inject`，组件永远拿到兜底值）。

---

## 5. 数据模型与存储

**零新增、零迁移**。本需求不碰 `RunsStore`、快照结构、记忆文件、面板 view model。新增的「数据模型」只有两张**代码内常量表**：

| 契约表 | 位置 | 内容 |
|---|---|---|
| 服务访问面 | `src/host/index.ts` 的 `inject` + `adapters.ts` 的 `OPTIONAL_SERVICES` | 硬依赖 4 项 / 可选 3 项；两份名单由守卫测试绑死（并集覆盖全部 `ctx.<x>` 访问） |
| 挂载点契约 | `src/client/slots.ts` 的三个 slot 常量 + 三个注册对象 | name/key/id/order/inject 的**唯一取值处** |

存储侧唯一相关的「持久化」是 `lib/*.js`：它是 profile `pnpm add file:<repo>` 的安装源，必须与源码同步（见 §8 边界 7）。

---

## 6. API 设计

本需求**不新增外部 API**，只把内部契约显式化。

### 6.1 HTTP（不变，仅确认契约）

`src/host/adapters.ts:181 registerHttpRoutes` 仍注册 3 条（前缀 `BRIDGE_ROUTE = '/api/auto-team'`，`src/shared/const.ts:18`）：

| 方法/路径 | 参数 | 返回 |
|---|---|---|
| `GET /api/auto-team/snapshot` | `?sessionId=<id>` | `{ data: PanelSnapshot }` 或 `{ error }` |
| `GET /api/auto-team/memory` | `?track=&name=[&sessionId=]` | `{ data: { track, name, body, chars } }` 或 `{ error }` |
| `POST /api/auto-team/act` | body `{ sessionId, action }` | `{ data: ActResult }` |

`webServer` 缺失时注册函数直接返回（降级），**不改返回结构**、不改路径、不改动作集合。

### 6.2 工具与提示词（不变）

`src/host/tools.ts` 的工具注册面与 `auto_team_*` 字面量逐字不变（门禁 `grep -c 'auto_team_' src/host/tools.ts` 作为不夹带证据）；`ctx.systemPrompt.section` 注入内容不变。

### 6.3 新增内部 API（非外部契约）

| 签名 | 语义 | 谁调用 |
|---|---|---|
| `optionalService<T>(ctx: HostContext, name: OptionalServiceName): T \| undefined` | 可选服务唯一读取口（内部实现只用 `ctx.get`） | `adapters.ts` 的 3 处 |
| `registerSlots(ctx: SlotsContext, deps: SlotComponents): void` | 一次性注册 3 个挂载点 | `src/client/index.ts` 的 `apply()` |
| `OPTIONAL_SERVICES` / `OptionalServiceName` | 可选服务白名单（唯一登记处） | `optionalService` + 守卫测试 |

---

## 7. 前端组件与状态管理

- 组件切分不变：`Toggle`（输入框下方开关行）与 `Panel`（右栏页签，内含 计划/成员/记忆/角色 四个 `data-panel-tab`）+ 新增 `TabTitle`（页签文案）。
- 状态管理不变：`src/client/state.ts` 的**模块级单例 store + `useSyncExternalStore`**，单 timer（活跃 2s / 空闲 5s / 隐藏暂停），`act()` 把 `snapshot` 直接写回本地 view。两个挂载面读同一份数据——这正是「必须给两处都传 `inject(sessionId)`」的原因：拿不到同一 sessionId 就会各查各的会话，出现「开关是开的、面板说没开」。
- 样式不变：只用宿主 token；字号写 `font: var(--dsw-font-xs-13, …)`（写 `font-size: var(--dsw-font-…)` 是无效声明且静默继承）。

---

## 8. 关键实现点与边界情况

| # | 边界 | 处置 |
|---|---|---|
| 1 | 宿主缺 `webServer`/`llm`/`agentDefaultModel` | `optionalService` 返回 undefined → 三条降级路径各就各位，插件照常激活（这正是它们不许进 `inject` 的原因） |
| 2 | 宿主 ctx 没有 `get`（极简 mock / 未来形状变化） | 记一次 warn 返回 undefined，**不回退裸读**（回退会让旧病复发） |
| 3 | 宿主缺 `agentTeams` | 整条 entry 不激活（inject 硬依赖的固有语义）。PRD 判定接受：`dv` 已验证该服务存在；若未来宿主移除，症状会重新表现为 warning，属可观测失败而非静默降级 |
| 4 | keyed slot 传不传 `id`/`order` | **不传**。PRD a2 未验证是否容忍；沿用两个真实样本字段集合，绕开未知形状 |
| 5 | 旧宿主没有 `sidebar.right.pane.tab.title` | `slots.inject` 对不存在的 slot 是 inert（回调永不调用），零副作用 |
| 6 | 同一挂载点被重复注册（宿主热重载） | 保持现有行为（不引入 dispose 逻辑），显式 pin 为「不在本期」 |
| 7 | `lib/` 与 profile 里那份的关系 | 两态：**硬链接**（`file:` 安装，同 inode ⇒ 永远同步，sha 恒等属恒绿）／**实体拷贝**（可陈旧）。脚本必须同时打印 `sha256` + `stat -f %i` inode + mtime，报告里写明本次是哪一态；拷贝态下否则「sha 相等」是无效证明 |
| 8 | `--dump-dom` 产出 0 字节 / 进程 hang | 以「控制台零相关报错 + 批量包内含注册代码 + 页签文案可点」三项合并判定，并在报告里注明哪项是间接证据；headless chrome 用 `pkill -f chrome-headless-shell` 兜底防孤儿 |
| 9 | 真机脚本从归档位置跑 | 归档路径下相对根会解析错误（r4 实测 9 个探针 6 红）：脚本用 `SCRIPT_DIR/../../../..` 锚定仓库根，复跑前必须先 `cp -r` 回 `<repo>/logs/teamflow/<runId>/scripts/` |
| 10 | 端口 51890 被占 → 可能对着**别人的**宿主得出假结论 | 脚本先探测端口，占用则 fail-fast 并提示换 `HOST_PORT`；**不** pkill 不明进程 |
| 11 | 脚本里 `set -e` 会让第 1 步失败吞掉后 3 步证据 | 用 `set -u`（不用 `-e`），每步显式判成败并继续，末尾汇总 ✓/✗；禁 `| head`/`| awk '{exit}'` 这类会触发 SIGPIPE 的读端（历史上 `set -Eeuo pipefail` + 提前退出退 141 直接杀脚本） |
| 12 | 本需求**不动**的三条 P3 与 Trigger Slow | `src/host/index.ts:195` 的 name 兜底、peer 失败重投、`store.list` 线性扫描逐字不改；`setInterval` 仍只允许 `watcher.ts:247` 一处 |

---

## 9. 测试策略（五层，前两层是关键）

### 层 1：源码扫描守卫 —— `test/host-contract.test.ts`（AC-4）

- 扫描 `src/host/**/*.ts`，**先剥离注释与字符串字面量**（字符级状态机：`//`、`/* */`、`'`、`"`、`` ` ``），再用 `/\bctx\s*\.\s*([A-Za-z_$][\w$]*)/g` 取 `ctx.<x>` 集合；
- 非服务白名单：`['logger','effect','on','get']`（cordis Context 自身成员）；
- 断言 1（**会红**）：`扫描集 ⊆ inject ∪ OPTIONAL_SERVICES`，失败文案点名服务——`ctx.agentTeams 未在 inject 中登记`；
- 断言 2：`inject ∩ OPTIONAL_SERVICES === ∅`（anti-goal 3：可选服务不许进 inject）；
- 断言 3：`[...inject].sort()` 精确等于 `['agentTeams','agents','systemPrompt','tools']`（strict 档位：新增服务必须同时改测试，不允许悄悄扩容）；
- 断言 4：`optionalService(ctx,'<x>')` 字面量集合 **等于** `OPTIONAL_SERVICES`（既防用了没登记，也防登记了没用）；
- 断言 5：client 侧同样扫描 `src/client/**/*.ts(x)`，`ctx.<x>` 必须落在 client 的 `inject = ['slots']` ∪ 非服务白名单内。

### 层 2：挂载点契约守卫 —— `test/client-contract.test.ts`（AC-6/AC-7）

fake slots：

```ts
const calls: Array<{ kind: 'inject'; name: string; fn: () => unknown }> = []
const metas: SlotMeta[] = []
const ctx = { slots: { inject: (name, fn) => calls.push({ kind: 'inject', name, fn }), register: (m) => metas.push(m) } }
registerSlots(ctx, { Toggle: 'T', Panel: 'P', PanelTitle: 'X' })
calls.forEach((c) => c.fn())   // 回调触发 → metas 被填满
```

断言：3 个挂载点各出现一次；`PANEL_SLOT`/`PANEL_TITLE_SLOT` 的 `key` 非空且互不冲突；`DOCK_SLOT` 的 `key === undefined`；`metas` 里 `inject('sess-1').sessionId === 'sess-1'`（三个都断言）；`inject(name)` 名字与 `register({name})` 逐字相同；`PLUGIN_ID` 不出现在任何 `name` 里；`src/client/index.ts` 源码内**零** `slots.register(`（结构断言：注册只许经 `registerSlots`）。

**QA-02 追加的类门禁（原守卫验不出「宿主没有这个 tab 类型」）**，同样用 fake `ctx.inject` 驱动真实 `registerPanelTab`／`createOpenPanel`：

| 断言 | 打回的缺陷 | 红它的方式 |
|---|---|---|
| `ctx.inject(['sidebarRightTabs'], cb)` 被调用，`cb` 里 `tabs.register(...)` 恰好一次 | 页签类型从未注册 | 删 `registerPanelTab` 调用 / 删 `ctx.inject` 分支 → 红 |
| 类型定义 `id === PANEL_KEY`，`kind` 非空，`priority === 'extension'`，`title() === PANEL_TAB_LABEL` | 类型与 keyed key 漂移 | 改 `id` 字面量 → 红 |
| 两处 keyed 座位的 `key` 逐一等于类型 `id` | 座位指向不存在的 kind | 改任一处 key → 红 |
| 注册包在 `ctx.effect(...)` 里（label=`dsh-auto-team: panel tab type`） | 卸载不回收 | 去掉 effect → 红 |
| 无 `ctx.inject` 时 `registerPanelTab` 返回 `false` 且不抛 | 可选服务拖死 entry | 改成裸访问 → 红 |
| `createOpenPanel()` 走 `sidebarRight.openTab(PANEL_TAB_KIND)`，无服务返回 `false` | 「面板」按钮点了没反应 | 删 openTab 分支 → 红 |
| `inject` 给 dock 的 bag 含 `openPanel` | 动作没送达组件 | 去掉 deps 透传 → 红 |
| client 半源码（剥注释）零 `ctx.get` | 与 host 半纪律一致（I8） | 改用 `ctx.get` → 红 |
| `index.ts` 必须调用 `registerPanelTab(` | 只注册座位 | 删调用 → 红 |

### 层 3：变异自检（AC-4 的「红得对」判据，脚本形式，不新建 checker 体系）

`logs/teamflow/tf-mvxcfxze-e9elp3/scripts/guard-mutation.sh`：

1. 从 `inject` 删 `'agentTeams'` → `node --test test/host-contract.test.ts` **必须失败**，且 stderr 含 `ctx.agentTeams 未在 inject 中登记`（红的是断言文本，不是语法错/异常）→ 按字节还原（sha256 校验）；
2. 从 `PANEL_SLOT` 注册对象删 `key` → `node --test test/client-contract.test.ts` **必须失败**，且文案含 `requires key` → 按字节还原；
3. 从 `src/client/index.ts` 删 `registerPanelTab(ctx)` 调用（= QA-02 原缺陷形态）→ 同测试**必须失败**，且文案含 `index.ts 必须调用 registerPanelTab(` → 按字节还原；
4. 复原后全绿。

判定要求：**分别记录**「变异前绿 / 变异后红 / 复原后绿」三次退出码 + 命中的断言文本。

### 层 4：真机四判据（AC-3/AC-8/AC-13/AC-14/AC-16，主 agent 实跑）

`real-host-verify.sh` 四步（每步环境变量可覆盖 `REPO`/`PROFILE`/`HOST_PORT`/`APP`/`TOKEN`）：

1. **准备 profile**：`cp -a ~/.dsh/profiles/desktop ~/.dsh/profiles/$PROFILE`（存在则先跳过克隆），`plugin add file:$REPO`，`--dump-config` 里必须出现 `dsh-auto-team`；
2. **启动第二宿主**：`--profile $PROFILE --no-open --port $HOST_PORT`，捕获 boot 日志 → 断言零 `warning: N entry did not activate`、零 `cannot get property`；
3. **取页面与批量包**：`curl -c/-L "…?token=$TOKEN"` → `dsh-auto-team/client.js` 进了批量 URL；取 bundle 断言含 `dsh-auto-team-panel`/`自动团队`；打印 `sha256` + inode 一致性（§8 边界 7）；
4. **控制台 + DOM**：headless chrome `--dump-dom`（stderr 抓 `CONSOLE`）→ 断言零 `requires options.key`/零 `without inject`；dom 非空时断言 `[data-toggle-label]` 与 `[data-dsh-auto-team-panel]` 同时存在，否则按边界 8 合并判定。

`real-host-assert.mjs` 读 boot.log/index.html/bundle.js/console.err/dom.html，逐条 `PASS [AC-3a] …`/`FAIL …` 并设退出码，脚本汇总为 ✓/✗ 表。

### 层 5：全量门禁（提交前固定跑）

```bash
pnpm typecheck
node --test test/*.test.ts          # ≥ 311 + 新增守卫用例
pnpm build                          # 双产物新鲜：find src -newer lib/index.js | wc -l == 0
node --input-type=module -e "await import('./lib/index.js')"
node --input-type=module -e "await import('./lib/client.js')"
npm pack --dry-run                  # 含 lib/index.js / lib/client.js / cordis.patch.yml
grep -rn "setInterval" src          # 仍仅 watcher.ts 一处
git status --porcelain -uall        # 提交后干净
```

---

## 10. 任务拆分（并行度 / 文件边界 / 依赖）

| 任务 | 文件（**改动**） | 依赖 | 并行 |
|---|---|---|---|
| **T1 宿主半契约** | `src/host/index.ts`、`src/host/adapters.ts` | — | ∥ 与 T2 |
| **T2 client 半契约** | `src/client/slots.ts`(新)、`src/client/TabTitle.tsx`(新)、`src/client/index.ts` | — | ∥ 与 T1 |
| **T3 守卫与测试** | `test/host-contract.test.ts`(新)、`test/client-contract.test.ts`(新)、`test/wire.test.ts`、`test/adapters.test.ts` | T1、T2 | 串行（需 T1/T2 的符号落地） |
| **T4 构建 + 真机回路** | `lib/index.js`、`lib/client.js`（`pnpm build` 生成）、`logs/teamflow/tf-mvxcfxze-e9elp3/scripts/real-host-verify.sh`、`…/real-host-assert.mjs`、`…/guard-mutation.sh` | T1–T3 | 串行（要跑在真实产物上） |
| **T5 交付自检 + 单笔提交** | 无新增源码（只跑门禁与提交） | T1–T4 | 收尾 |

T5 明确边界：**只做交付自检**（发现问题当场修，只记录结论），**不写** `QA-REPORT.md`/`ACCEPTANCE.md`（属 QA 与验收阶段），不跑跨浏览器/真机全矩阵；真机脚本由主 agent 实跑（子代理装不了 profile）。

### 提交纪律（PRD 工程约束，必须逐条落进任务）

- 分支：`feat/auto-team-plugin`；起点 HEAD 实际为 `61e03fd`（开工前 `git log --oneline -1` 记录实际值，不强行回退到 `e6ae89c`）；
- **一次到底、最后才提交**：所有源码 + 文档 + `lib/` 一次性提交，提交后不再动任何文件（多笔提交会让评审/验收证据失效）；
- 暂存范围（pathspec）精确到：`src/`、`test/`、`lib/`、`docs/teamflow/20261101-r6-real-host-activation/`、`docs/teamflow/memory.md`（若更新约定）；**不含** `logs/teamflow/`；
- 不得触碰的三条 P3（`src/host/index.ts:195` name 兜底 / peer 失败重投 / `store.list` 线性扫描）与 Trigger Slow 相关常量；
- 提交前 `git status --porcelain -uall` 逐条核对「改动文件 ⊆ 本需求范围」；提交后 `git log --oneline -1` + `git status --porcelain -uall`（空）作为收口证据。

---

## 11. 未验证项与降级（必须原样带进 QA/验收）

| 编号 | 未验证事实 | 本方案的处置 | 若证伪的降级 |
|---|---|---|---|
| U1 | keyed slot 是否容忍额外 `id`/`order` | **不传**，沿用样本字段集合 | 无需调整（已经规避） |
| U2 | `.title` slot 是否必须、是否会导致标题重复渲染 | 注册但内容极薄（纯文本），inert 安全 | 真机若出现双标题：删 `src/client/slots.ts` 里的 title 注册（1 处），AC-8 改由宿主默认标题承载，须在 QA-REPORT 记录 |
| U3 | `inject(sessionId)` 的返回值是否必须含 `sessionId` | 三个挂载点都返回 `{ sessionId }` | 不影响（多余字段被忽略） |
| U4 | `file:` 安装是硬链接还是实体拷贝 | 脚本打印 sha256 + inode 双证据并注明态 | 拷贝态下「重装后 sha 相等」才是有效证明 |
| U5 | `--dump-dom` 在本机的稳定性 | 三判据合并 + 注明间接证据 | DOM 恒空时 AC-8 只能判「部分取证」，如实记未验证 |

---

## 12. 与 PRD 的差异（需要验收知情）

1. **AC-12 的 sha256 判据需配对 inode 证据**：硬链接态下 `src→profile` sha 恒等（恒绿、不承载信息），拷贝态下才可能陈旧。本方案要求同时报告 `sha256` 与 `stat -f %i`，并按实际态解释结论——这是判据加固，不改变「产物必须与源码同步」的要求。
2. **AC-4 的变异自检落成脚本**（`guard-mutation.sh`），不进 `test/`：它需要临时改源码再 `git checkout`，不适合留在测试集里被 CI 反复执行。
3. **新增第三挂载点 `.title`**：PRD AC-8 备注已允许；理由是两个真实样本都注册它，不注册则页签可能无文案。
