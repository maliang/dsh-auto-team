/**
 * 挂载点注册契约（四个可见面的 name/id/key/order/inject + 页签类型的**唯一取值处**）。
 *
 * 页签要出现是**三步**（QA-02 实测，宿主 asar 官方文档 + `ui-schedule`/`dsh-plugin-teamflow` 样本）：
 *   ① `registerPanelTab` 把页签类型（`id === PANEL_KEY`）注册进 `sidebarRightTabs`；
 *   ② `registerSlots` 把 body/title 两个 keyed 座位按同一个 key 注册；
 *   ③ `createPanelCommands(ctx).open(sessionId)` 用 `sidebarRight.openTab(kind)` 打开
 *      （页面型页签不会自己出现）。
 * 只做 ② 的症状：构建全绿、控制台零报错、页签永不出现。
 *
 * 为什么单独成模块（TECHNICAL §5.1）：`node --test` 只能 strip 类型、**不能转 JSX**，
 * 所以任何 import `index.ts`（它 import 各 `.tsx`）的测试都不可能跑起来。
 * 把注册逻辑放进这里（**零 React / 零 JSX / 只 import `../shared/const.ts`**），
 * `test/client-contract.test.ts` 才能用 fake slots 驱动**真实注册代码**并断言
 * name/key/inject 的逐字关系 —— 这是 AC-1/AC-2/AC-11 唯一的运行期证据。
 *
 * r10 的四个可见面（槽名逐字取自 `docs/teamflow/architecture/UI-SLOTS.md`）：
 *   E1 `conversation.input.left`              输入框左侧胶囊选项（**非 keyed**，`{ name, id, order, inject }`）
 *   E2 `conversation.session.header.actions`   会话头按钮（**非 keyed**，同上）
 *   E3 `sidebar.right.pane.tab` / `.title`    右栏面板（**keyed**，`{ name, key, inject }`，两处同 key）
 *   E4 `settings.section`                     设置页「自动团队」（**非 keyed**，`{ name, id, order, label, inject }`）
 *
 * 已撤除：r1~r6 的整宽开关行槽位，以及 r7~r9 用的输入框**下方**那一位（r10 迁到上面的 E1）。
 * r10 把胶囊挪进输入框左侧的操作区 —— 留旧槽位会让同一个开关出现两份状态与两条点击链（AC-1）。
 * **旧槽位名在本文件里一个字都不留**，重复出现就是两处漂移的温床。
 *
 * 禁用槽位（`replaceRisk: shadows-shipped-ui`，占住会遮住宿主自带 UI）：清单见
 * `docs/teamflow/architecture/UI-SLOTS.md` §1 里标了 shadows 的五位。**本文件不复述槽名** ——
 * 复述就是第二份真相，且 AC-2 要求在 `src/` 里零命中这些名字（含注释）。
 *
 * 硬约束（AC-1 / AC-2 / AC-11）：
 *   1. `slots.inject(A, cb)` 的 `A` 与 `cb` 内 `register({ name })` 的 `name` 逐字相同；
 *   2. keyed 两处必须有 `key`；非 keyed 必须没有 `key`（缺 key 的真机症状：
 *      `Uncaught Error: keyed slot "..." requires options.key`，构建全绿、页签永不出现）；
 *   3. `PLUGIN_ID` 只许出现在 `id`/`key` 里，**不许**进 `name`（写成插件名 = 静默不挂载）；
 *   4. 五个座位都传 `inject`，把宿主的 `sessionId` 交给组件（否则组件永远拿到兜底值 `'current'`）。
 */
import { PLUGIN_ID } from '../shared/const.ts'

/** E1 输入框左侧胶囊选项（非 keyed，AC-1）。 */
export const INPUT_LEFT_SLOT = 'conversation.input.left'

/** E2 会话头按钮（非 keyed，AC-11）。 */
export const HEADER_ACTIONS_SLOT = 'conversation.session.header.actions'

/** E3 右栏「自动团队」面板页签（**keyed**）。 */
export const PANEL_SLOT = 'sidebar.right.pane.tab'

/** E3 上面那个页签的标题位（**keyed**，与 body 同 key）。 */
export const PANEL_TITLE_SLOT = 'sidebar.right.pane.tab.title'

/** E4 设置页的「自动团队」分区（非 keyed，root 作用域）。 */
export const SETTINGS_SECTION_SLOT = 'settings.section'

/** E1 座位 id。 */
export const OPTION_ID = `${PLUGIN_ID}-option`

/** E2 座位 id。 */
export const HEADER_ID = `${PLUGIN_ID}-header-button`

/** E4 座位 id（宿主按它去重，同一个 id 注册两次会覆盖）。 */
export const SECTION_ID = PLUGIN_ID

/** E4 分区标题（宿主设置页左侧导航显示它）。 */
export const SECTION_LABEL = '自动团队'

/** 页签文案（AC-11 按文案判定，改字必须同步 PRD）。`TabTitle.tsx` 也取它，防两处漂移。 */
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
  /**
   * 宿主调用形状（asar `runInject` 实核）：
   *  - root 作用域座位（`sidebar.panellist` / `main`）**不传参**；
   *  - session 作用域的 keyed 座位传 `binding.key`。
   * 所以参数不能声明成必填 sessionId —— 这里按 unknown 收，再只认「非本插件 key 的字符串」。
   */
  inject?: (binding?: unknown, actions?: unknown) => Record<string, unknown>
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

/** 页签句柄（只声明本插件用来识别「是不是我这一页」的字段）。 */
export interface SidebarTabLike {
  id?: unknown
  kind?: unknown
  tabId?: unknown
}

/** 单个页签的动作面：`close()` 是宿主给的官方收起入口（第一级回退）。 */
export interface TabActionsFace {
  close?: () => unknown
}

/** `tabDomain` 把「某个页签」映射到它的动作面。 */
export interface TabDomainFace {
  occurrence?(sessionId: string, tab: unknown): { tabActions?: TabActionsFace } | undefined
}

/**
 * 宿主 `sidebarRight` 服务面：
 *  - `openTab(kind)` 是**页面型页签唯一的打开方式**；
 *  - `tabsIn(sessionId)` / `closeIn(sessionId, tabId)` / `tabDomain` 都是可选成员 ——
 *    宿主版本不同，只在真的存在时使用（三级回退见 `createPanelCommands`）。
 */
export interface SidebarRightFace {
  openTab(kind: string, options?: Record<string, unknown>): unknown
  tabsIn?(sessionId: string): readonly unknown[]
  closeIn?(sessionId: string, tabId: string): unknown
  tabDomain?: TabDomainFace
}

/** 可选服务作用域（cordis `ctx.inject(deps, cb)` 的回调入参）。 */
export interface ServiceScope {
  sidebarRightTabs?: TabsFace
  sidebarRight?: SidebarRightFace
  /** 宿主布局服务：`selectPanel(id)` 是选中 main 面板的**唯一**官方入口。 */
  layout?: LayoutFace
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

/* ─────────────────────── 面板开 / 收 / 状态查询（AC-11） ─────────────────────── */

/**
 * 「右栏面板」的三条命令：开、收、查。
 *
 * 为什么要单独成对象（TECHNICAL §5.2）：插槽组件**拿不到 `hookContext`**
 * （宿主实测 `renderEntry` 只在 `slotHookFactories` 存在时才注入），所以
 * `tabActions.close` 只能在**持有 ctx 的这一层**取到，组件只能收到一个 `() => boolean`。
 * 同时保证会话头按钮的 open 与 close 走**同一处**实现 —— 两条链各自摸 window/服务，
 * 必然出现「能开不能收」或「收了还显示已打开」。
 */
export interface PanelCommands {
  /** 打开本插件页签；`false` = 宿主没提供 `sidebarRight`。 */
  open(sessionId: string): boolean
  /**
   * 收起本插件页签。三级回退（每级都有单测）：
   *   ① `tabsIn(sessionId)` 找到本插件页签 → `tabDomain.occurrence(...).tabActions.close()`；
   *   ② `closeIn(sessionId, tabId)`；
   *   ③ `false` —— 组件据此**不翻转** `aria-pressed`（避免「显示已收起、其实还开着」的假象）。
   */
  close(sessionId: string): boolean
  /** 本插件页签当前是否存在；`undefined` = 宿主没提供 `tabsIn`（组件退回本地态）。 */
  isOpen(sessionId: string): boolean | undefined
}

/** 页签句柄里「是不是本插件」的判据：kind / id / tabId 任一等于页签类型。 */
function isMine(tab: unknown): boolean {
  if (tab === null || typeof tab !== 'object') return false
  const handle = tab as SidebarTabLike
  return handle.kind === PANEL_TAB_KIND || handle.id === PANEL_TAB_KIND || handle.tabId === PANEL_TAB_KIND
}

/** 从页签句柄里取 closeIn 需要的 id（三种字段名都试，取不到返回空串）。 */
function tabIdOf(tab: unknown): string {
  if (tab === null || typeof tab !== 'object') return ''
  const handle = tab as SidebarTabLike
  const candidates = [handle.tabId, handle.id, handle.kind]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
  }
  return ''
}

/**
 * 生成面板的三条命令（唯一实现点）。
 *
 * 服务用 `ctx.inject(['sidebarRight'], cb)` 捕获：`ctx.get` 在 client 半是禁用的
 * （`test/client-contract.test.ts` 有计数断言），且服务稍后就绪时 `inject` 回调仍会被调用。
 */
export function createPanelCommands(ctx: SlotsContext): PanelCommands {
  let right: SidebarRightFace | undefined
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sidebarRight'], (scope) => {
      const found = scope.sidebarRight
      if (found === undefined) return
      right = found
    })
  }

  function mineOf(sessionId: string): { tab: unknown; id: string } | undefined {
    if (right === undefined || typeof right.tabsIn !== 'function') return undefined
    let tabs: readonly unknown[]
    try {
      tabs = right.tabsIn(sessionId) ?? []
    } catch {
      return undefined
    }
    for (const tab of tabs) {
      if (isMine(tab)) return { tab, id: tabIdOf(tab) }
    }
    return undefined
  }

  return {
    open(_sessionId: string): boolean {
      const service = right
      if (service === undefined || typeof service.openTab !== 'function') return false
      try {
        // register/openTab 读的是服务对象自身的状态：必须 `service.openTab(...)`，解构裸调会丢 receiver。
        service.openTab(PANEL_TAB_KIND)
        return true
      } catch {
        return false
      }
    },

    close(sessionId: string): boolean {
      const service = right
      if (service === undefined) return false
      const mine = mineOf(sessionId)

      // ① 官方页签动作：tabDomain.occurrence(sessionId, tab).tabActions.close()
      if (mine !== undefined) {
        const domain = service.tabDomain
        if (domain !== undefined && typeof domain.occurrence === 'function') {
          try {
            const occurrence = domain.occurrence(sessionId, mine.tab)
            const closeAction = occurrence?.tabActions?.close
            if (typeof closeAction === 'function') {
              closeAction()
              return true
            }
          } catch {
            // 降级到下一级：宿主版本的 occurrence 形状不一致时不许把异常抛给按钮
          }
        }
      }

      // ② 位置式收起：closeIn(sessionId, tabId)
      if (mine !== undefined && typeof service.closeIn === 'function' && mine.id !== '') {
        try {
          service.closeIn(sessionId, mine.id)
          return true
        } catch {
          return false
        }
      }

      // ③ 没有任何官方入口：明确返回 false，由组件保留原状态（不乐观翻转）
      return false
    },

    isOpen(sessionId: string): boolean | undefined {
      const service = right
      if (service === undefined || typeof service.tabsIn !== 'function') return undefined
      return mineOf(sessionId) !== undefined
    },
  }
}

/** 五个挂载点的组件。`unknown` 是有意的：本模块不 import React，测试可传字符串桩。 */
export interface SlotComponents {
  /** E1 输入框左侧胶囊选项（`Option.tsx`）。 */
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
   * 「打开本插件页签」的宿主原生动作。
   * **三种都没传时** `registerSlots` 会自己用 `createPanelCommands(ctx)` 兜底 ——
   * 这样 `index.ts` 忘记接线也只会降级，不会让头部按钮变成哑键。
   */
  openPanel?: () => boolean
  /** 「收起本插件页签」（`createPanelCommands(ctx).close`）。 */
  closePanel?: (sessionId: string) => boolean
  /** 本插件页签是否开着；`undefined` = 宿主没这个能力（组件退回本地态）。 */
  isPanelOpen?: (sessionId: string) => boolean | undefined
}

/** 蓝图里的别名（`SlotDeps` 与本文件的 `SlotComponents` 是同一个形状）。 */
export type SlotDeps = SlotComponents

/**
 * `slots.register` 的 `inject`：宿主把当次 sessionId 传进来，原样交给组件
 * （组件侧 `state.ts` 的 `sessionIdOf` 读 `props.sessionId`）。
 * 只此一份实现 —— 四个可见面必须拿到同一个 sessionId（同一个 store、同一份快照）。
 */
export function sessionIdBag(
  sessionId: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return { sessionId, ...extras }
}

/** 宿主 `runInject` 对 root 座位不传参，对 session 座位传 `binding.key`；统一成字符串会话 id。 */
function sessionIdArg(binding: unknown): string {
  return typeof binding === 'string' && binding !== '' ? binding : 'current'
}

/**
 * 注册全部挂载点。`deps` 只为让测试注入桩组件；生产由 `index.ts` 传真组件。
 * 挂载点不存在时 `slots.inject` 是 inert 的（回调不会被调），因此注册它零副作用。
 */
export function registerSlots(ctx: SlotsContext, deps: SlotComponents): void {
  // 头部按钮需要的三条命令：优先用 `index.ts` 接进来的，缺省时自己从 ctx 生成
  // （插槽组件拿不到 ctx，所以这一层是唯一的兜底点）。
  const commands = createPanelCommands(ctx)
  const openPanel = deps.openPanel ?? (() => commands.open('current'))
  const closePanel = deps.closePanel ?? ((sessionId: string) => commands.close(sessionId))
  const isPanelOpen = deps.isPanelOpen ?? ((sessionId: string) => commands.isOpen(sessionId))

  // root 座位宿主不传参（asar `runInject`），session 座位传 binding.key；统一兜底 'current'。
  const injectOf = (binding?: unknown): Record<string, unknown> => sessionIdBag(sessionIdArg(binding))

  // E1 输入框左侧胶囊选项：非 keyed → name/id/order/inject，**不带 key**。
  // 点击语义只有「开关」，所以不把面板命令下发给它。
  ctx.slots.inject(INPUT_LEFT_SLOT, () => {
    ctx.slots.register({ name: INPUT_LEFT_SLOT, id: OPTION_ID, order: 5, inject: injectOf }, deps.Option)
  })

  // E2 会话头按钮：非 keyed；三条面板命令只下发给它（点开 / 收回右栏）。
  ctx.slots.inject(HEADER_ACTIONS_SLOT, () => {
    ctx.slots.register(
      {
        name: HEADER_ACTIONS_SLOT,
        id: HEADER_ID,
        order: 0,
        inject: (binding?: unknown) => {
          const sessionId = sessionIdArg(binding)
          return sessionIdBag(sessionId, {
            openPanel,
            closePanel: () => closePanel(sessionId),
            isPanelOpen: () => isPanelOpen(sessionId),
          })
        },
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
    ctx.slots.register({ name: PANEL_TITLE_SLOT, key: PANEL_KEY, inject: injectOf }, deps.PanelTitle)
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
 *   ③ 页面型页签**只注册不会自己出现**，还要 `sidebarRight.openTab(kind)` 打开（见 `createPanelCommands`）。
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
 * 生成「打开面板」动作（r7 兼容入口）：`createPanelCommands(ctx).open` 的薄封装。
 *
 * 历史缺陷形态：`Toggle.tsx` 原先断言「宿主未提供激活某页签的对外动作」，只 `window.dispatchEvent`
 * 一个自己定义的事件 —— 页签尚未打开时没有任何监听者，等于按钮无效。返回 `false` 表示宿主服务不可用，
 * 组件据此回退旧行为。
 */
export function createOpenPanel(ctx: SlotsContext): () => boolean {
  const commands = createPanelCommands(ctx)
  return () => commands.open('current')
}

/* ─────────────────── r13 左栏「自动团队」栏目 + 主区页面（AC-24） ─────────────────── */

/**
 * 左栏栏目槽位（非 keyed）：宿主侧栏里的一个可折叠条目。
 *
 * 判定依据是 `docs/teamflow/architecture/UI-SLOTS.md`（106 个槽位里唯一一个侧栏「列表」座位），
 * 字段集合沿用同机样本 `dsh-better-sidebar`（非 keyed → `{ name, id, order, label, inject }`）。
 */
export const PANELLIST_SLOT = 'sidebar.panellist'

/**
 * 主区页面槽位（**keyed**，key 与栏目 id 同值）：点左栏条目后在主区展开整页项目库。
 *
 * **未验证**（TECHNICAL §0 U2）：`main` 对第三方插件是否开放只有真机才知道。
 * 因此注册整段 try/catch，失败只 warn 并降级为「面板内联项目库」，绝不连累其它槽位。
 */
export const MAIN_SLOT = 'main'

/** 左栏栏目的 id，同时用作 `main` 槽位的 key（同一个值，两处不复述）。 */
export const PANELLIST_ID = `${PLUGIN_ID}-panellist`

/** 左栏栏目文案（宿主侧栏里那一行显示它）。 */
export const PANELLIST_LABEL = '自动团队'

/**
 * 「左栏项目库」的窗口事件名（降级通道）。
 *
 * 正常路径是 `layout.selectPanel(PANELLIST_ID)`；主区不可用时退化成这个事件，
 * 由 `Panel.tsx` 监听后在右栏内联渲染同一份项目库（同一套组件、同一份 `LibraryView`）。
 * 常量放这里而不是组件文件：`slots.ts` 不 import 任何 `.tsx`，
 * 组件与测试都能引它，且不会形成 `slots ↔ LibraryPage` 的运行时环。
 */
export const OPEN_LIBRARY_EVENT = 'auto-team:open-library'

/* ─────────────── r16 项目库 surface 协议（AC-8 / AC-9） ─────────────── */

/**
 * 项目库的两个可见 surface：主区整页 `main` / 右栏内联 `panel`。
 *
 * `data-library-surface` 是**唯一**判据 —— 组件把根节点标上它，watchdog 与 Panel 只读它，
 * 不各自 querySelector 别的选择器（两处各猜一套选择器 = 主区/面板双开的温床）。
 */
export const LIBRARY_SURFACE_ATTR = 'data-library-surface'

/** watchdog 等待主区真正挂载的预算（AC-8：点击后 1s 内必须出现可见结果）。 */
export const LIBRARY_OPEN_WATCHDOG_MS = 500

/** pending 标记的有效期：同一次点击的「主区正在打开」不要在 1.5s 内被当成新的请求。 */
export const LIBRARY_OPEN_PENDING_MS = 1500

export type LibrarySurface = 'main' | 'panel'

/** `createOpenLibrary` 的三种结局（`data-last-open-result` 的取值集合）。 */
export type LibraryOpenResult = 'main' | 'event' | 'error'

/**
 * 当前可见的项目库 surface；`null` = 一个都没有（或不在浏览器里）。
 *
 * **main 优先**：同一时刻只允许一个可见 surface，主区一旦可见就不再往右栏塞镜像。
 * `getClientRects().length > 0` 用来排除「节点在 DOM 里但被宿主收起/隐藏」的假可见。
 */
export function visibleLibrarySurface(): LibrarySurface | null {
  if (typeof document === 'undefined' || document === null) return null
  if (typeof document.querySelector !== 'function') return null
  const visible = (surface: LibrarySurface): boolean => {
    try {
      const node = document.querySelector(`[${LIBRARY_SURFACE_ATTR}="${surface}"]`)
      if (node === null || node === undefined) return false
      if (typeof node.getClientRects !== 'function') return true
      return node.getClientRects().length > 0
    } catch {
      // 宿主 DOM 桩不完整（node 测试 / 旧宿主）时按「不可见」处理，不许把异常抛给点击链。
      return false
    }
  }
  if (visible('main')) return 'main'
  if (visible('panel')) return 'panel'
  return null
}

/** 最近一次「请求打开项目库」的时间戳；Panel 挂载时消费它，避免刷新/重挂后丢内联。 */
let libraryOpenRequestAt: number | null = null

/** 标记一次打开请求（glyph 点击 / 主区打开前调用）。 */
export function markLibraryOpenRequest(now: number = Date.now()): void {
  libraryOpenRequestAt = now
}

/**
 * 消费一次打开请求：只有 1.5s 内的请求算数（过期请求不能把用户拖进一个他早就放弃的内联库）。
 * 消费即清空 —— 同一次点击最多触发一次降级。
 */
export function consumeLibraryOpenRequest(now: number = Date.now()): boolean {
  const at = libraryOpenRequestAt
  libraryOpenRequestAt = null
  if (at === null) return false
  return now - at <= LIBRARY_OPEN_PENDING_MS && now - at >= 0
}

/** 测试隔离用：清掉 pending 标记（不在生产过程调用）。 */
export function resetLibraryOpenRequest(): void {
  libraryOpenRequestAt = null
}

/**
 * 组件侧「打开项目库主区」的 opener：由 `registerPanellist` 在注册时挂上。
 *
 * 组件（角色卡 / 任务行 / 流程图节点）拿不到 ctx，但点击后必须能像左栏 glyph 一样
 * 打开主区并走 500ms watchdog 降级；`navigateToMember` 因此只依赖这个薄入口。
 */
let librarySurfaceOpener: ((sessionId?: string) => LibraryOpenResult) | null = null

/** 组件侧打开项目库主区；`null` = 还没注册过 opener（单测 / 非浏览器宿主）。 */
export function requestLibrarySurface(sessionId?: string): LibraryOpenResult | null {
  if (librarySurfaceOpener === null) return null
  try {
    return librarySurfaceOpener(sessionId)
  } catch {
    // opener 内部已经各自兜底；真漏出来的异常也不许打断点击链。
    return 'error'
  }
}

/** 测试隔离用：清掉 opener（不在生产过程调用）。 */
export function resetLibrarySurfaceOpener(): void {
  librarySurfaceOpener = null
}

/** 派发降级事件；没有 window（node 测试 / 非浏览器宿主）时安全返回 false。 */
function dispatchOpenLibraryEvent(): boolean {
  if (typeof window === 'undefined' || window === null) return false
  if (typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return false
  window.dispatchEvent(new CustomEvent(OPEN_LIBRARY_EVENT, { detail: { id: PANELLIST_ID } }))
  return true
}

/**
 * 宿主 `layout` 服务的只声明用到的成员。
 *
 * 2026-11-05 对照 asar 核实：宿主全量检索 **没有 `mainArea` 服务**；全局面板由
 * `ctx.layout.selectPanel(id)` 选中（`main` keyed slot 的 key 即面板 id，`null` 回会话）。
 * `selectPanel` 在目标 main 未注册时会抛错且不改当前选中态 —— 必须 catch 后降级。
 */
export interface LayoutFace {
  selectPanel?(panelId: string | null): unknown
}

export interface PanellistComponents {
  /** 左栏栏目（`LibraryPage.tsx` 的 `PanellistEntry`）。 */
  PanellistEntry: unknown
  /** `main` 槽位的整页版本（`LibraryPage.tsx` 的 `LibraryPage`）。 */
  LibraryPage: unknown
}

function warnSlot(name: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[dsh-auto-team] 槽位「${name}」注册失败，已降级：${message}`)
  }
}

/**
 * 生成「打开左栏项目库」动作（AC-8 / AC-9 的唯一入口）。
 *
 * additive 语义：先试 `layout.selectPanel(PANELLIST_ID)`；布局服务缺失 / 显式拒绝 / 500ms 内
 * 没有出现可见的 `[data-library-surface="main"]` 时，降级到右栏内联（打开面板页签 + 派发
 * `OPEN_LIBRARY_EVENT`）。返回 `'main' | 'event' | 'error'` —— 调用方（glyph）据此显示
 * `data-last-open-result`，**任何分支都不静默**。
 */
export function createOpenLibrary(ctx: SlotsContext): (sessionId?: string) => LibraryOpenResult {
  let layout: LayoutFace | undefined
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['layout'], (scope) => {
        const service = scope.layout
        if (service !== undefined) layout = service
      })
    } catch {
      // 服务不存在时 cordis 会一直 pending；这里只是少一条快路径，事件降级仍然可用。
      layout = undefined
    }
  }
  const panel = createPanelCommands(ctx)

  /** 降级到右栏：打开面板页签 + 派发事件；两步缺一都会被用户当成「点了没反应」。 */
  function fallback(sessionId?: string, deferred = false): LibraryOpenResult {
    markLibraryOpenRequest()
    let opened = false
    try {
      const id = sessionId === undefined || sessionId === '' ? 'current' : sessionId
      opened = panel.open(id)
    } catch {
      opened = false
    }
    if (deferred) {
      // 让 openTab 先把 Panel 挂起来（mount 时消费 pending 标记），再派发事件。
      setTimeout(() => {
        dispatchOpenLibraryEvent()
      }, 0)
    } else {
      dispatchOpenLibraryEvent()
    }
    return opened ? 'event' : 'error'
  }

  return (sessionId?: string): LibraryOpenResult => {
    if (layout !== undefined && typeof layout.selectPanel === 'function') {
      let accepted = true
      try {
        // 只有**显式 false** 才算主区拒绝：真实宿主多半返回 void，
        // 那种情况交给 watchdog 用 DOM 事实判定，否则会误判成失败并双开。
        // main 未注册时宿主 selectPanel 会抛错（且不改选中态）→ 这里 catch 后走降级。
        accepted = layout.selectPanel(PANELLIST_ID) !== false
      } catch {
        accepted = false
      }
      if (accepted) {
        markLibraryOpenRequest()
        // 一次性 watchdog（不是 setInterval）：主区说打开了、实际没挂载时 500ms 内降级。
        setTimeout(() => {
          if (visibleLibrarySurface() === 'main') return
          fallback(sessionId, true)
        }, LIBRARY_OPEN_WATCHDOG_MS)
        return 'main'
      }
    }
    return fallback(sessionId)
  }
}

/**
 * 注册左栏栏目（`sidebar.panellist`）与主区页面（`main`，keyed）。
 *
 * 返回两个布尔值而不是 void：`index.ts` 与 QA 探针都要能判断「这次是不是真的挂上了」，
 * 也能在真机日志里区分「槽位缺失」与「组件没渲染」。
 */
export function registerPanellist(
  ctx: SlotsContext,
  deps: PanellistComponents,
): { panellist: boolean; main: boolean } {
  const result = { panellist: false, main: false }
  if (ctx === undefined || ctx === null || ctx.slots === undefined) return result

  const openLibrary = createOpenLibrary(ctx)
  // 组件侧（角色卡 / 任务行 / 流程图节点）没有 ctx，通过这个模块级入口打开主区。
  librarySurfaceOpener = openLibrary
  // 组件侧零参（`PanellistEntryProps.openLibrary`）；sessionId 在这一层绑定，
  // 免得每个组件各自记住「点左栏时要带会话 id」。
  const injectOf = (binding?: unknown): Record<string, unknown> => {
    // root 座位没有 binding → 'current'（宿主默认会话，与 host DEFAULT_SESSION 同值）；
    // session 座位拿到的是 key，只有不是本插件面板 id 的字符串才当会话 id。
    const sessionId =
      typeof binding === 'string' && binding !== '' && binding !== PANELLIST_ID ? binding : 'current'
    return sessionIdBag(sessionId, { openLibrary: () => openLibrary(sessionId) })
  }

  // 左栏栏目：非 keyed → name/id/order/label/inject（不带 key）。
  try {
    ctx.slots.inject(PANELLIST_SLOT, () => {
      ctx.slots.register(
        { name: PANELLIST_SLOT, id: PANELLIST_ID, order: 20, label: PANELLIST_LABEL, inject: injectOf },
        deps.PanellistEntry,
      )
    })
    result.panellist = true
  } catch (error) {
    warnSlot(PANELLIST_SLOT, error)
  }

  // 主区页面：先按 keyed 注册（宿主契约 { name, key, inject }）；宿主若说「这不是 keyed 槽位」，
  // 就退一步按非 keyed 再试一次。两条都失败 = 能力不存在，降级为面板内联项目库。
  //
  // **必须走 slots.inject，不能直接 register**：`main` 由 AppFrame 在下拉布局里声明，
  // 插件 apply 时它可能还没提交；此时直接 register 会抛
  // `slot "main" is not declared`，被 catch 后永不重试 → main 永久缺失 →
  // 宿主侧栏行 onClick 的 `layout.selectPanel(id)` 抛错、界面保持原样（用户报的「点了没反应」）。
  // slots.inject 的语义是「声明存在就同步跑，不存在就等声明提交后再跑」，且随声明生命周期重建。
  let mainFailed = false
  try {
    ctx.slots.inject(MAIN_SLOT, () => {
      try {
        ctx.slots.register({ name: MAIN_SLOT, key: PANELLIST_ID, inject: injectOf }, deps.LibraryPage)
      } catch (error) {
        // 极旧/不同实现的宿主若把 main 声明成非 keyed，再退一步；再失败就只降级。
        try {
          ctx.slots.register({ name: MAIN_SLOT, inject: injectOf }, deps.LibraryPage)
        } catch (inner) {
          mainFailed = true
          warnSlot(MAIN_SLOT, inner)
        }
      }
    })
    // 同步声明已提交时这里能如实反映成败；声明尚未提交时表示「已接管，等声明」。
    result.main = !mainFailed
  } catch (error) {
    warnSlot(MAIN_SLOT, error)
  }

  return result
}
