/**
 * 右栏「自动团队」页签的标题文案（`sidebar.right.pane.tab.title`）。
 *
 * 为什么要单独注册 `.title`（TECHNICAL §4.3）：真机样本里每个页签都同时注册 body 与 title
 * （`dsh-better-sidebar/src/client/native/index.ts:318-345`），不注册时宿主可能渲染空标题/占位符，
 * 而 AC-8 的母判据之一就是「右栏页签标题含『自动团队』」。挂载点不存在时注册是 inert 的，零副作用。
 *
 * 组件刻意极薄：纯文本 + 一个宿主 token 字号，不引入任何交互状态（页签的 hover/active/焦点
 * 由宿主页签条自己画，插件这一层再画一遍会双重高亮）。
 * 字号只能写 `font:` 简写 —— `--dsw-font-*` 是复合值，写成 `font-size: var(...)` 是无效声明
 * 且静默继承父级字号（AGENTS §4 铁律）。
 */
import * as React from 'react'
import { PANEL_TAB_LABEL } from './slots.ts'

/**
 * 页签文案（AC-8 按文案判定，改字必须同步 PRD）。
 * 单点在 `slots.ts: PANEL_TAB_LABEL` —— 它同时喂给 `sidebarRightTabs` 类型定义的 `title`，
 * 两处各写一份就会出现「页签标题」与「类型标题」不一致（组件与类型分属两条渲染路径）。
 */
export const TAB_TITLE_TEXT = PANEL_TAB_LABEL

export function TabTitle(): React.ReactElement {
  return (
    <span
      data-auto-team-tab-title
      style={{
        font: 'var(--dsw-font-xs-13, 13px/20px sans-serif)',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {TAB_TITLE_TEXT}
    </span>
  )
}

export default TabTitle
