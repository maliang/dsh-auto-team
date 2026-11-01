/**
 * 挂载点注册契约（三个 slot 的 name/key/id/order/inject + 页签类型的**唯一取值处**）。
 *
 * 页签要出现是**两步**（QA-02 实测，宿主 asar 官方文档 + `ui-schedule`/`dsh-plugin-teamflow` 样本）：
 *   ① `registerPanelTab` 把页签类型（`id === PANEL_KEY`）注册进 `sidebarRightTabs`；
 *   ② `registerSlots` 把 body/title 两个 keyed 座位按同一个 key 注册；
 *   ③ `createOpenPanel` 用 `sidebarRight.openTab(kind)` 打开（页面型页签不会自己出现）。
 * 只做 ② 的症状：构建全绿、控制台零报错、页签永不出现。
 *
 * 为什么单独成模块（TECHNICAL §4.2）：`node --test` 只能 strip 类型、**不能转 JSX**，
 * 所以任何 import `index.ts`（它 import `Toggle.tsx`/`Panel.tsx`）的测试都不可能跑起来。
 * 把注册逻辑放进这里（**零 React / 零 JSX / 只 import `../shared/const.ts`**），
 * `test/client-contract.test.ts` 才能用 fake slots 驱动**真实注册代码**并断言
 * name/key/inject 的逐字关系 —— 这是 AC-6/AC-7 唯一的运行期证据。
 *
 * 字段集合照本机两个真实样本（`dsh-better-sidebar/src/client/native/index.ts:318-345`、
 * `dsh-plugin-teamflow/lib/client.js`）：
 *   - keyed slot（`sidebar.right.pane.tab` 与它的 `.title`）：`{ name, key, inject }`，
 *     **不带 `id`/`order`**，且 body 与 title 用**同一个 key**（样本 `key: id` 两处一致）；
 *   - 非 keyed slot（`conversation.composer.dock`）：`{ name, id, order, inject }`，**没有 `key`**。
 *
 * 硬约束（AC-6/AC-7）：
 *   1. `slots.inject(A, cb)` 的 `A` 与 `cb` 内 `register({ name })` 的 `name` 逐字相同；
 *   2. keyed 两处必须有 `key`；dock 必须没有 `key`（缺 key 的真机症状：
 *      `Uncaught Error: keyed slot "..." requires options.key`，构建全绿、页签永不出现）；
 *   3. `PLUGIN_ID` 只许出现在 `id`/`key` 里，**不许**进 `name`（写成插件名 = 静默不挂载）；
 *   4. 三处都传 `inject`，把宿主的 `sessionId` 交给组件（原实现没有它，组件永远拿到兜底值 `'current'`）。
 */
import { PLUGIN_ID } from '../shared/const.ts'

/** 输入框下方的开关行（非 keyed，AC-1 的可见入口）。 */
export const DOCK_SLOT = 'conversation.composer.dock'

/** 右栏「自动团队」面板页签（**keyed**）。 */
export const PANEL_SLOT = 'sidebar.right.pane.tab'

/** 上面那个页签的标题位（**keyed**，与 body 同 key，见文件头第 4 行）。 */
export const PANEL_TITLE_SLOT = 'sidebar.right.pane.tab.title'

/** 页签文案（AC-8 按文案判定，改字必须同步 PRD）。`TabTitle.tsx` 也取它，防两处漂移。 */
export const PANEL_TAB_LABEL = '自动团队'

/**
 * 宿主侧「页签类型」定义（`sidebarRightTabs.register` 的唯一入参来源）。
 *
 * 为什么要它（QA-02 根因修复）：`sidebar.right.pane.tab` 是 **keyed 座位**，宿主只有在
 * `sidebarRightTabs` 服务里存在 `id === 座位 key` 的页签类型时才派发该座位。只注册座位、
 * 不注册类型 = 构建全绿、控制台零报错、页签永不出现（r6 QA 实测）。
 * `id` 是宿主侧实现身份（全局唯一，重复注册会抛），`kind` 是 `openTab` 的入参；
 * 两者同值，由 `test/client-contract.test.ts` 的「页签类型」组断言逐字相等，防单点漂移。
 */
export function panelTabDefinition(): PanelTabDefinition {
  return {
    // 宿主侧类型身份：同一值同时是 keyed 座位的 key 与 openTab 的 kind。
    id: 'dsh-auto-team-panel',
    kind: 'dsh-auto-team-panel',
    priority: 'extension',
    title: () => PANEL_TAB_LABEL,
  }
}

/** 页签标识：body/title 两处 keyed 座位共用，必须与页签类型的 `id` 逐字相同。 */
export const PANEL_KEY = panelTabDefinition().id

/** `openTab` 用的 kind（宿主按 kind 找已注册的类型）。 */
export const PANEL_TAB_KIND = panelTabDefinition().kind

/** 注册对象的形状（keyed / 非 keyed 的字段集合靠可选字段区分，不是两套类型）。 */
export interface SlotMeta {
  name: string
  id?: string
  key?: string
  order?: number
  inject?: (sessionId: string) => Record<string, unknown>
}

/** 宿主 `sidebarRightTabs.register` 的定义形状（只声明本插件写入的字段）。 */
export interface PanelTabDefinition {
  id: string
  kind: string
  priority: 'extension'
  title: () => string
}

/** 宿主 `sidebarRightTabs` 服务面（只声明本插件用到的 `register`）。 */
export interface TabsFace {
  register(definition: PanelTabDefinition): unknown
}

/** 宿主 `sidebarRight` 服务面：`openTab(kind)` 是**页面型页签唯一的打开方式**。 */
export interface SidebarRightFace {
  openTab(kind: string, options?: Record<string, unknown>): unknown
}

/** 可选服务作用域（cordis `ctx.inject(deps, cb)` 的回调入参）。 */
export interface ServiceScope {
  sidebarRightTabs?: TabsFace
  sidebarRight?: SidebarRightFace
  effect?(fn: () => unknown, label?: string): unknown
}

/** 宿主交给 `apply` 的 ctx 的最小面（只声明用到的成员，避免 mock 与真机漂移）。 */
export interface SlotsContext {
  slots: {
    inject(name: string, fn: () => unknown): void
    register(meta: SlotMeta, component: unknown): unknown
  }
  /**
   * cordis 的「服务齐备时才回调」写法（宿主样本 `ui-chat`／`dsh-config-manager` 都用它）。
   * 用它而不是 `ctx.get`：服务缺失时回调不执行，插件照常激活（不因可选服务拖死整条 entry）。
   */
  inject?(deps: readonly string[], fn: (scope: ServiceScope) => void): unknown
}

/** 三个挂载点的组件。`unknown` 是有意的：本模块不 import React，测试可传字符串桩。 */
export interface SlotComponents {
  Toggle: unknown
  Panel: unknown
  PanelTitle: unknown
  /**
   * 「打开本插件页签」的宿主原生动作（`ctx.sidebarRight.openTab`，由 `createOpenPanel` 生成）。
   * 拿不到宿主服务时**不传**，组件回退到窗口事件（旧行为）。
   */
  openPanel?: () => boolean
}

/**
 * `slots.register` 的 `inject`：宿主把当次 sessionId 传进来，原样交给组件
 * （组件侧 `state.ts:319 sessionIdOf` 读 `props.sessionId`）。
 * 只此一份实现 —— 开关行与面板/页签标题必须拿到同一个 sessionId。
 * 有 `openPanel` 时一并下发（Toggle 的「面板」按钮走宿主原生 `openTab`，不再靠窗口事件撞运气）。
 */
export function sessionIdBag(
  sessionId: string,
  openPanel?: () => boolean,
): Record<string, unknown> {
  return openPanel === undefined ? { sessionId } : { sessionId, openPanel }
}

/**
 * 注册全部挂载点。`deps` 只为让测试注入桩组件；生产由 `index.ts` 传真组件。
 * 挂载点不存在时 `slots.inject` 是 inert 的（回调不会被调），因此注册它零副作用。
 */
export function registerSlots(ctx: SlotsContext, deps: SlotComponents): void {
  const injectOf = (sessionId: string): Record<string, unknown> =>
    sessionIdBag(sessionId, deps.openPanel)

  // 输入框下方开关行：非 keyed → name/id/order/inject，**不带 key**。
  ctx.slots.inject(DOCK_SLOT, () => {
    ctx.slots.register(
      { name: DOCK_SLOT, id: `${PLUGIN_ID}-toggle`, order: 10, inject: injectOf },
      deps.Toggle,
    )
  })

  // 右栏面板 body：keyed → name/key/inject，**不带 id/order**
  // （PRD 待澄清 a2「keyed 是否容忍额外字段」未验证，沿用真实样本的字段集合）。
  ctx.slots.inject(PANEL_SLOT, () => {
    ctx.slots.register({ name: PANEL_SLOT, key: PANEL_KEY, inject: injectOf }, deps.Panel)
  })

  // 页签标题位：与 body 同 key，宿主据此把标题挂到同一个页签上。
  ctx.slots.inject(PANEL_TITLE_SLOT, () => {
    ctx.slots.register(
      { name: PANEL_TITLE_SLOT, key: PANEL_KEY, inject: injectOf },
      deps.PanelTitle,
    )
  })
}

/**
 * 把本插件的页签类型注册进宿主 `sidebarRightTabs`（QA-02 根因修复，与 `registerSlots` 成对）。
 *
 * 宿主契约（asar 里的官方文档 + 同机样本 `ui-schedule`／`dsh-plugin-teamflow`）：
 *   ① `sidebarRightTabs.register({ id, kind, priority, title })`，返回 disposer，**必须包在 `ctx.effect` 里**；
 *   ② keyed 座位 `sidebar.right.pane.tab`（及 `.title`）的 `key` 必须等于该定义的 `id`；
 *   ③ 页面型页签**只注册不会自己出现**，还要 `ctx.sidebarRight.openTab(kind)` 打开（见 `createOpenPanel`）。
 *
 * 用 `ctx.inject(['sidebarRightTabs'], cb)` 而不是 `ctx.get`：服务缺失时回调不执行，
 * 插件照常激活（client 半 `inject` 列表仍是 `['slots']`，不因可选服务拖死整条 entry）。
 */
export function registerPanelTab(ctx: SlotsContext): boolean {
  if (typeof ctx.inject !== 'function') return false
  ctx.inject(['sidebarRightTabs'], (scope) => {
    const tabs = scope.sidebarRightTabs
    if (tabs === undefined || typeof tabs.register !== 'function') return
    // register 读的是服务对象自身的状态：必须用 `tabs.register(...)`，解构出裸函数会丢 receiver。
    const definition = panelTabDefinition()
    const register = (): unknown => tabs.register(definition)
    if (typeof scope.effect === 'function') scope.effect(register, 'dsh-auto-team: panel tab type')
    else register()
  })
  return true
}

/**
 * 生成「打开面板」动作：宿主 `sidebarRight.openTab(PANEL_TAB_KIND)`。
 *
 * 历史缺陷形态：`Toggle.tsx` 原先断言「宿主未提供激活某页签的对外动作」，只 `window.dispatchEvent`
 * 一个自己定义的事件 —— 页签尚未打开时没有任何监听者，等于按钮无效。返回 `false` 表示宿主服务不可用，
 * 组件据此回退旧行为。
 */
export function createOpenPanel(ctx: SlotsContext): () => boolean {
  let open: (() => void) | undefined
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sidebarRight'], (scope) => {
      const right = scope.sidebarRight
      if (right === undefined || typeof right.openTab !== 'function') return
      open = () => {
        right.openTab(PANEL_TAB_KIND)
      }
    })
  }
  return () => {
    if (open === undefined) return false
    open()
    return true
  }
}
