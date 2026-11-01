/**
 * client 半入口。
 *
 * 宿主浏览器端的加载契约（照本机已装样本）：
 *   执行 lib/client.js → 它调用 window.__ModuleLoader__.load({ id, factory })
 *   → factory(require) 返回 { inject, apply } → 宿主调 apply(ctx)。
 *
 * 两个挂载面（DESIGN §2）：
 *   conversation.composer.dock  —— 输入框下方 32px 开关行（开关状态的唯一来源）
 *   sidebar.right.pane.tab      —— 右栏「自动团队」面板（计划/成员/记忆/角色四页）
 *   sidebar.right.pane.tab.title —— 上面那个页签的标题文案（keyed，与 body 同 key）
 *
 * 本文件只做**薄接线**：slot 名/注册对象全部下沉到 `src/client/slots.ts`（那里不含 JSX，
 * 可被 node --test 直接驱动）。因此这里不出现任何 slot 字面量、也不出现 `slots.register(`
 * —— 两处漂移是历史实锤的失效形态（改了一处另一处没改，构建全绿、页签不出现）。
 *
 * 插件 id 只从 `src/shared/const.ts` 取（D6）：client 与 host 的产物必须逐字相同（AC-2/AC-3），
 * 而 client **不允许** import host 半的任何模块 —— 从 host/config.ts 取值会把宿主代码拖进
 * 浏览器产物，是本脚手架真实的断点之一。
 */
import { registerSlots } from './slots.ts'
import type { SlotsContext } from './slots.ts'
import { Toggle } from './Toggle.tsx'
import { Panel } from './Panel.tsx'
import { TabTitle } from './TabTitle.tsx'

export const inject = ['slots']

/** 宿主交来的 ctx；形状（含 keyed 的 `key`/`inject`）由 `slots.ts` 单点定义。 */
export type ClientContext = SlotsContext

export function apply(ctx: ClientContext): void {
  // 宿主没提供 slots 服务时安静退出：整插件不激活比抛错好（与 host 半的降级纪律一致）。
  if (!ctx?.slots?.register) return

  registerSlots(ctx, { Toggle, Panel, PanelTitle: TabTitle })
}
