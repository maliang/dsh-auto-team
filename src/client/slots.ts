/**
 * 挂载点注册契约（三个 slot 的 name/key/id/order/inject 的**唯一取值处**）。
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

/** 页签标识：body 与 title 共用，必须与 PLUGIN_ID 前缀一致且项目内唯一。 */
export const PANEL_KEY = `${PLUGIN_ID}-panel`

/** 注册对象的形状（keyed / 非 keyed 的字段集合靠可选字段区分，不是两套类型）。 */
export interface SlotMeta {
  name: string
  id?: string
  key?: string
  order?: number
  inject?: (sessionId: string) => Record<string, unknown>
}

/** 宿主交给 `apply` 的 ctx 的最小面（只声明用到的两个方法，避免 mock 与真机漂移）。 */
export interface SlotsContext {
  slots: {
    inject(name: string, fn: () => unknown): void
    register(meta: SlotMeta, component: unknown): unknown
  }
}

/** 三个挂载点的组件。`unknown` 是有意的：本模块不 import React，测试可传字符串桩。 */
export interface SlotComponents {
  Toggle: unknown
  Panel: unknown
  PanelTitle: unknown
}

/**
 * `slots.register` 的 `inject`：宿主把当次 sessionId 传进来，原样交给组件
 * （组件侧 `state.ts:319 sessionIdOf` 读 `props.sessionId`）。
 * 只此一份实现 —— 开关行与面板/页签标题必须拿到同一个 sessionId。
 */
export function sessionIdBag(sessionId: string): Record<string, unknown> {
  return { sessionId }
}

/**
 * 注册全部挂载点。`deps` 只为让测试注入桩组件；生产由 `index.ts` 传真组件。
 * 挂载点不存在时 `slots.inject` 是 inert 的（回调不会被调），因此注册它零副作用。
 */
export function registerSlots(ctx: SlotsContext, deps: SlotComponents): void {
  // 输入框下方开关行：非 keyed → name/id/order/inject，**不带 key**。
  ctx.slots.inject(DOCK_SLOT, () => {
    ctx.slots.register(
      { name: DOCK_SLOT, id: `${PLUGIN_ID}-toggle`, order: 10, inject: sessionIdBag },
      deps.Toggle,
    )
  })

  // 右栏面板 body：keyed → name/key/inject，**不带 id/order**
  // （PRD 待澄清 a2「keyed 是否容忍额外字段」未验证，沿用真实样本的字段集合）。
  ctx.slots.inject(PANEL_SLOT, () => {
    ctx.slots.register({ name: PANEL_SLOT, key: PANEL_KEY, inject: sessionIdBag }, deps.Panel)
  })

  // 页签标题位：与 body 同 key，宿主据此把标题挂到同一个页签上。
  ctx.slots.inject(PANEL_TITLE_SLOT, () => {
    ctx.slots.register(
      { name: PANEL_TITLE_SLOT, key: PANEL_KEY, inject: sessionIdBag },
      deps.PanelTitle,
    )
  })
}
