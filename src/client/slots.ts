/**
 * 挂载点注册契约（r7 四个 slot 的 name/id/key/order/inject + 页签类型的**唯一取值处**）。
 *
 * 页签要出现是**三步**（QA-02 实测，宿主 asar 官方文档 + `ui-schedule`/`dsh-plugin-teamflow` 样本）：
 *   ① `registerPanelTab` 把页签类型（`id === PANEL_KEY`）注册进 `sidebarRightTabs`；
 *   ② `registerSlots` 把 body/title 两个 keyed 座位按同一个 key 注册；
 *   ③ `createOpenPanel` 用 `sidebarRight.openTab(kind)` 打开（页面型页签不会自己出现）。
 * 只做 ② 的症状：构建全绿、控制台零报错、页签永不出现。
 *
 * 为什么单独成模块（TECHNICAL §4.2）：`node --test` 只能 strip 类型、**不能转 JSX**，
 * 所以任何 import `index.ts`（它 import 各 `.tsx`）的测试都不可能跑起来。
 * 把注册逻辑放进这里（**零 React / 零 JSX / 只 import `../shared/const.ts`**），
 * `test/client-contract.test.ts` 才能用 fake slots 驱动**真实注册代码**并断言
 * name/key/inject 的逐字关系 —— 这是 AC-6/AC-7/AC-19 唯一的运行期证据。
 *
 * r7 的四个可见面（DESIGN §1.1，槽名逐字取自 `docs/teamflow/architecture/UI-SLOTS.md`）：
 *   E1 `conversation.input.dock`           输入框内胶囊选项（**非 keyed**，`{ name, id, order, inject }`）
 *   E2 `conversation.session.header.actions` 会话头按钮（**非 keyed**，同上）
 *   E3 `sidebar.right.pane.tab` / `.title`  右栏面板（**keyed**，`{ name, key, inject }`，两处同 key）
 *   E4 `settings.section`                  设置页「自动团队」（**非 keyed**，`{ name, id, order, label, inject }`）
 *
 * 已撤除：r1~r6 的整宽开关行槽位（composer dock）。它的 `replaceRisk` 为 none，
 * 但 r7 把入口搬进输入框后必须整段删掉 —— 留着会让同一个开关出现两份状态与两条点击链。
 *
 * 禁用槽位（`replaceRisk: shadows-shipped-ui`，占住会遮住宿主自带 UI）：
 * `conversation.composer.bar`、`conversation.input.activity`、
 * `conversation.session.header.corner`、`shell.leading`、`settings.header`。
 *
 * 硬约束（AC-6/AC-7）：
 *   1. `slots.inject(A, cb)` 的 `A` 与 `cb` 内 `register({ name })` 的 `name` 逐字相同；
 *   2. keyed 两处必须有 `key`；非 keyed 必须没有 `key`（缺 key 的真机症状：
 *      `Uncaught Error: keyed slot "..." requires options.key`，构建全绿、页签永不出现）；
 *   3. `PLUGIN_ID` 只许出现在 `id`/`key` 里，**不许**进 `name`（写成插件名 = 静默不挂载）；
 *   4. 五个座位都传 `inject`，把宿主的 `sessionId` 交给组件（原实现没有它，组件永远拿到兜底值 `'current'`）。
 */
import { PLUGIN_ID } from '../shared/const.ts'

/** E1 输入框内胶囊选项（非 keyed，AC-12）。 */
export const INPUT_DOCK_SLOT = 'conversation.input.dock'

/** E2 会话头按钮（非 keyed，AC-13）。 */
export const HEADER_ACTIONS_SLOT = 'conversation.session.header.actions'

/** E3 右栏「自动团队」面板页签（**keyed**）。 */
export const PANEL_SLOT = 'sidebar.right.pane.tab'

/** E3 上面那个页签的标题位（**keyed**，与 body 同 key，见文件头第 5 行）。 */
export const PANEL_TITLE_SLOT = 'sidebar.right.pane.tab.title'

/** E4 设置页的「自动团队」分区（非 keyed，root 作用域，AC-16）。 */
export const SETTINGS_SECTION_SLOT = 'settings.section'

/** E1 座位 id。 */
export const OPTION_ID = `${PLUGIN_ID}-option`

/** E2 座位 id。 */
export const HEADER_ID = `${PLUGIN_ID}-header-button`

/** E4 座位 id（宿主按它去重，同一个 id 注册两次会覆盖）。 */
export const SECTION_ID = PLUGIN_ID

/** E4 分区标题（宿主设置页左侧导航显示它）。 */
export const SECTION_LABEL = '自动团队'

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

export const PANEL_KEY = panelTabDefinition().id

export const PANEL_TAB_KIND = panelTabDefinition().kind

export interface SlotMeta {
  name: string
  id?: string
  key?: string
  order?: number
  label?: string
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

/** 五个挂载点的组件。`unknown` 是有意的：本模块不 import React，测试可传字符串桩。 */
export interface SlotComponents {
  /** E1 输入框内胶囊选项（`Option.tsx`）。 */
  Option: unknown
  /** E2 会话头按钮（`HeaderButton.tsx`）。 */
  HeaderButton: unknown
  /** E3 面板体（`Panel.tsx`）。 */
  Panel: unknown
  /** E3 页签标题（`TabTitle.tsx`）。 */
  PanelTitle: unknown
  /** E4 设置页分区（`SettingsPage.tsx`）。 */
  SettingsSection: unknown
  /**
   * 「打开本插件页签」的宿主原生动作（`ctx.sidebarRight.openTab`，由 `createOpenPanel` 生成）。
   * 拿不到宿主服务时**不传**，组件回退到窗口事件（`OPEN_PANEL_EVENT`）。
   * 只下发给 E2（唯一需要它的可见面），**不再给 E1** —— 胶囊选项的点击语义只有「开关」。
   */
  openPanel?: () => boolean
}

/**
 * `slots.register` 的 `inject`：宿主把当次 sessionId 传进来，原样交给组件
 * （组件侧 `state.ts:319 sessionIdOf` 读 `props.sessionId`）。
 * 只此一份实现 —— 四个可见面必须拿到同一个 sessionId（同一个 store、同一份快照）。
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
  const injectOf = (sessionId: string): Record<string, unknown> => sessionIdBag(sessionId)

  // E1 输入框内胶囊选项：非 keyed → name/id/order/inject，**不带 key**。
  ctx.slots.inject(INPUT_DOCK_SLOT, () => {
    ctx.slots.register({ name: INPUT_DOCK_SLOT, id: OPTION_ID, order: 5, inject: injectOf }, deps.Option)
  })

  // E2 会话头按钮：非 keyed；`openPanel` 只下发给它（点一下开右栏）。
  ctx.slots.inject(HEADER_ACTIONS_SLOT, () => {
    ctx.slots.register(
      {
        name: HEADER_ACTIONS_SLOT,
        id: HEADER_ID,
        order: 0,
        inject: (sessionId: string) => sessionIdBag(sessionId, deps.openPanel),
      },
      deps.HeaderButton,
    )
  })

  // E3 右栏面板 body：keyed → name/key/inject，**不带 id/order**
  // （PRD 待澄清 a2「keyed 是否容忍额外字段」未验证，沿用真实样本的字段集合）。
  ctx.slots.inject(PANEL_SLOT, () => {
    ctx.slots.register({ name: PANEL_SLOT, key: PANEL_KEY, inject: injectOf }, deps.Panel)
  })

  // E3 页签标题位：与 body 同 key，宿主据此把标题挂到同一个页签上。
  ctx.slots.inject(PANEL_TITLE_SLOT, () => {
    ctx.slots.register(
      { name: PANEL_TITLE_SLOT, key: PANEL_KEY, inject: injectOf },
      deps.PanelTitle,
    )
  })

  // E4 设置页分区：非 keyed，带 `label`（宿主渲染分区标题）。
  // 作用域是 **root**（不是 session）：`inject` 拿不到 sessionId 时组件侧 `sessionIdOf` 兜底
  // `'current'`，保存设置仍然可用 —— 但绝不能让整个分区因为这个字段缺失而不挂载。
  ctx.slots.inject(SETTINGS_SECTION_SLOT, () => {
    ctx.slots.register(
      { name: SETTINGS_SECTION_SLOT, id: SECTION_ID, order: 40, label: SECTION_LABEL, inject: injectOf },
      deps.SettingsSection,
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
