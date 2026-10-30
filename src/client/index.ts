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
 *
 * 插件 id 只从 `src/shared/const.ts` 取（D6）：client 与 host 的产物必须逐字相同（AC-2/AC-3），
 * 而 client **不允许** import host 半的任何模块 —— 从 host/config.ts 取值会把宿主代码拖进
 * 浏览器产物，是本脚手架真实的断点之一。
 */
import * as React from 'react'
import { Toggle } from './Toggle.tsx'
import { Panel } from './Panel.tsx'
import { PLUGIN_ID } from '../shared/const.ts'

export const inject = ['slots']

interface ClientContext {
  slots: {
    inject(name: string, fn: () => unknown): void
    register(
      meta: { name: string; id: string; order?: number },
      component: React.ComponentType<Record<string, unknown>>,
    ): unknown
  }
}

/** slot name 两段式，且必须与 inject(name) 逐字一致（AC-3）。 */
const DOCK_SLOT = 'conversation.composer.dock'
const PANEL_SLOT = 'sidebar.right.pane.tab'

export function apply(ctx: ClientContext): void {
  if (!ctx?.slots?.register) return

  // 开关行：常驻在输入框下方（AC-1 的可见入口）
  ctx.slots.inject(DOCK_SLOT, () => {
    ctx.slots.register(
      { name: DOCK_SLOT, id: `${PLUGIN_ID}-toggle`, order: 10 },
      Toggle as React.ComponentType<Record<string, unknown>>,
    )
  })

  // 右栏面板：只在用户点开「自动团队」页签时渲染（immediately:false 的落点）
  ctx.slots.inject(PANEL_SLOT, () => {
    ctx.slots.register(
      { name: PANEL_SLOT, id: `${PLUGIN_ID}-panel`, order: 60 },
      Panel as React.ComponentType<Record<string, unknown>>,
    )
  })
}
