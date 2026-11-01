/**
 * client 半入口。
 *
 * 宿主浏览器端的加载契约（照本机已装样本）：
 *   执行 lib/client.js → 它调用 window.__ModuleLoader__.load({ id, factory })
 *   → factory(require) 返回 { inject, apply } → 宿主调 apply(ctx)。
 *
 * r7 的四个挂载面（DESIGN §1.1，逐个逐字取自 UI-SLOTS.md）：
 *   conversation.input.dock              —— 输入框内「自动团队」胶囊（取代 composer.dock 开关行）
 *   conversation.session.header.actions  —— 会话头「自动团队」按钮（点开右栏面板）
 *   sidebar.right.pane.tab / .title      —— 右栏面板 body + 标题（keyed，同 key）
 *   settings.section                     —— 设置页「自动团队」（6 参数 + 角色管理）
 *
 * 本文件只做**薄接线**：slot 名/注册对象全部下沉到 `src/client/slots.ts`（那里不含 JSX，
 * 可被 node --test 直接驱动）。因此这里不出现任何 slot 字面量、也不出现 `slots.register(`
 * —— 两处漂移是历史实锤的失效形态（改了一处另一处没改，构建全绿、槽位不出现）。
 *
 * 插件 id 只从 `src/shared/const.ts` 取（D6）：client 与 host 的产物必须逐字相同（AC-2/AC-3），
 * 而 client **不允许** import host 半的任何模块 —— 从 host/config.ts 取值会把宿主代码拖进
 * 浏览器产物，是本脚手架真实的断点之一。
 */
import { createOpenPanel, registerPanelTab, registerSlots } from './slots.ts'
import type { SlotsContext } from './slots.ts'
import { AutoTeamOption as Option } from './Option.tsx'
import { AutoTeamHeaderButton as HeaderButton } from './HeaderButton.tsx'
import { Panel } from './Panel.tsx'
import { TabTitle } from './TabTitle.tsx'
import { SettingsSection } from './SettingsPage.tsx'

export const inject = ['slots']

/** 宿主交来的 ctx；形状（含 keyed 的 `key`/`inject`）由 `slots.ts` 单点定义。 */
export type ClientContext = SlotsContext

export function apply(ctx: ClientContext): void {
  // 宿主没提供 slots 服务时安静退出：整插件不激活比抛错好（与 host 半的降级纪律一致）。
  if (!ctx?.slots?.register) return

  // 页签类型必须先于/独立于座位注册存在，否则 keyed 座位永不派发（QA-02 实测）。
  registerPanelTab(ctx)

  registerSlots(ctx, {
    Option,
    HeaderButton,
    Panel,
    PanelTitle: TabTitle,
    SettingsSection,
    // 只有会话头按钮需要「原生打开面板」；其余座位拿到的是 no-op（见 slots.ts 的 bag）。
    openPanel: createOpenPanel(ctx),
  })
}
