/**
 * 视觉规范：**只用宿主 design token**（DESIGN §0.5，实测自 app.asar）。
 *
 * 三条必须遵守的坑（都实测过，不是"经验"）：
 *  1. 字号 token 是 font **简写**复合值（`--dsw-font-xs-13: 13px/20px …`），
 *     必须写 `font: var(--dsw-font-xs-13)`；写成 `font-size: var(...)` 是无效声明，
 *     构建不报错、console 不报错，只会静默继承父级字号（本产品已踩过同类）。
 *  2. 颜色只用语义 token，不写死 #hex —— 否则暗色主题下必然出现看不清的硬编码色块。
 *     实测存在的名字：`--dsw-alias-label-primary/secondary/tertiary`、`--dsw-alias-border-l1..l4`、
 *     `--dsw-alias-state-{business,warn,error,success}-primary`、`--dsw-radius-xs/sm/md/lg`。
 *     （写不存在的别名/状态 token 是**错名**，会静默继承父级颜色，构建与 console 都不报错。）
 *  3. 图标不在这里画：7 态图标由 `viewmodel.statusBadge` 出（一处文案，一套图标），
 *     CSS 只负责颜色。用 `::before` 再画一遍就会出现两个图标。
 */

import { useEffect } from 'react'

const STYLE_ID = 'dsh-auto-team-style'

export const AUTO_TEAM_CSS = `
/* ───────────────── 输入框左侧选项（conversation.input.left，DESIGN §0.2 / §2.1） ─────────────────
 * r7 起输入框下方的 32px 开关行**整段撤除**（AC-12）；r10 再把它压成输入框左侧的 24px 紧凑胶囊。
 * 命中区用 ::after 外扩到 40×40（视觉高度仍是 24 —— 不改布局高度，只改可点面积）。 */
[data-auto-team-option] {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  /* AC-3 的六条属性：可变长文本只许省略，不许把工具条撑破 */
  width: fit-content;
  min-width: 0;
  max-width: min(100%, 160px);
  flex: 0 1 auto;
  align-self: center;
  white-space: nowrap;
  text-overflow: ellipsis;
  margin-inline-end: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), border-color 120ms var(--ds-ease-in-out, ease);
}
[data-auto-team-option]::after {
  content: '';
  position: absolute;
  inset: -8px -6px;
}
[data-auto-team-option] [data-option-label] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-auto-team-option] [data-option-dot] {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l3, currentColor);
  background: transparent;
}
[data-auto-team-option][data-enabled="true"] {
  color: var(--dsw-alias-label-primary, inherit);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 12%, transparent);
}
[data-auto-team-option][data-enabled="true"] [data-option-dot] {
  border-color: var(--dsw-alias-state-business-primary, #2f6feb);
  background: var(--dsw-alias-state-business-primary, #2f6feb);
}
[data-auto-team-option][data-state="paused"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 55%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 12%, transparent);
}
[data-auto-team-option][data-state="paused"] [data-option-dot] {
  border-color: var(--dsw-alias-state-warn-primary, #b58900);
  background: var(--dsw-alias-state-warn-primary, #b58900);
}
[data-auto-team-option]:hover:not([data-state="busy"]) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-auto-team-option]:active:not([data-state="busy"]) {
  background: var(--dsw-alias-interactive-bg-active, color-mix(in srgb, currentColor 14%, transparent));
}
[data-auto-team-option]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-auto-team-option][data-state="busy"] { cursor: progress; opacity: 0.75; }
[data-auto-team-option][data-flash="true"] {
  border-color: var(--dsw-alias-state-business-primary, #2f6feb);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 18%, transparent);
}
[data-auto-team-option] [data-option-spinner] {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-sizing: border-box;
  border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  animation: dsh-auto-team-spin 800ms linear infinite;
}
[data-auto-team-option][data-enabled="true"] [data-option-label] {
  font-weight: 600;
}
/* 失败态（AC-6）：只改点与描边，**底不加色、可见文本逐字不变、零红字**。
 * 原因只进 title / aria-label 与面板的 [data-error]，工具条里不出现任何错误文本节点。 */
[data-auto-team-option][data-error-state="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 45%, transparent);
  background: transparent;
}
[data-auto-team-option][data-error-state="true"] [data-option-dot] {
  border-color: var(--dsw-alias-state-warn-primary, #b58900);
  background: var(--dsw-alias-state-warn-primary, #b58900);
}
[data-auto-team-option] [data-option-dot][data-tone="warn"] {
  border-color: var(--dsw-alias-state-warn-primary, #b58900);
  background: var(--dsw-alias-state-warn-primary, #b58900);
}
[data-auto-team-option] [data-option-dot][data-tone="run"] {
  border-color: var(--dsw-alias-state-business-primary, #2f6feb);
  background: var(--dsw-alias-state-business-primary, #2f6feb);
}
@keyframes dsh-auto-team-spin {
  to { transform: rotate(360deg); }
}
@media (max-width: 360px) {
  [data-auto-team-option] [data-option-label] { display: none; }
}

/* ───────────────── 会话头按钮（conversation.session.header.actions，DESIGN §2.2） ─────────────────
 * 高 24px、半径 8px；活跃态只加 12% 底色，**不改尺寸**（否则点一下标题栏就跳一下）。 */
[data-auto-team-header-button] {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  height: 24px;
  padding: 0 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), border-color 120ms var(--ds-ease-in-out, ease);
}
[data-auto-team-header-button]:hover {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-auto-team-header-button]:active {
  background: var(--dsw-alias-interactive-bg-active, color-mix(in srgb, currentColor 14%, transparent));
}
[data-auto-team-header-button]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-auto-team-header-button][data-pressed="true"] {
  color: var(--dsw-alias-label-primary, inherit);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 12%, transparent);
}
[data-auto-team-header-button] [data-header-icon] { font-size: 13px; line-height: 1; }
[data-auto-team-header-button] [data-header-badge] {
  box-sizing: border-box;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-3, color-mix(in srgb, currentColor 14%, transparent));
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xs-11, 11px/16px sans-serif);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 480px) {
  [data-auto-team-header-button] [data-header-label] { display: none; }
  [data-auto-team-header-button] { padding: 0 6px; }
}

/* ───────────────── 右栏面板外壳（sidebar.right.pane.tab） ───────────────── */
[data-auto-team-panel] {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: var(--dsh-sidebar-inline-padding, 12px);
  gap: 8px;
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  color: var(--dsw-alias-label-primary, inherit);
}
[data-auto-team-panel] [data-panel-head] {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  min-height: 28px;
  padding: 4px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2, currentColor);
  /* AC-9：直系子节点恰好 3 个（标题 / 状态胶囊 / 刷新），所以这里**不许折行**——
   * 折行会让「3 个子节点」在视觉上变成两行，与人眼看到的「三段」不符。 */
  flex-wrap: nowrap;
  min-width: 0;
}
[data-auto-team-panel] [data-panel-title] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-sm-14, 14px/20px sans-serif);
}
/* 头部状态信息（r10 起从 [data-panel-head] 里搬出来单独成段，AC-9/AC-10）：
 * 三组各自独立、组间一条 1px 分隔符；窄宽（320）允许折两行，但三组都在 ——
 * 禁止用 display:none 冒充分区（那是变异测试里必红的作弊）。 */
[data-auto-team-panel] [data-panel-meta] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
  padding: 0 0 4px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-panel] [data-panel-meta] > [data-meta] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-auto-team-panel] [data-panel-meta] [data-meta-sep] {
  flex: 0 0 auto;
  width: 1px;
  height: 10px;
  background: var(--dsw-alias-border-l1, currentColor);
}
[data-auto-team-panel] [data-panel-meta] [data-auto-team-degraded] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
}
[data-auto-team-panel] [data-head-capsule] {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  color: var(--dsw-alias-label-tertiary, inherit);
  white-space: nowrap;
}
[data-auto-team-panel] [data-head-capsule][data-tone="plan"] { color: var(--dsw-alias-state-warn-primary, #b58900); }
[data-auto-team-panel] [data-head-capsule][data-tone="run"] { color: var(--dsw-alias-state-business-primary, #2f6feb); }
[data-auto-team-panel] [data-head-capsule][data-tone="fail"] { color: var(--dsw-alias-state-error-primary, #d33); }
[data-auto-team-panel] [data-head-capsule][data-tone="done"] { color: var(--dsw-alias-state-success-primary, #2f9e44); }
[data-auto-team-panel] [data-head-meta] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-panel] button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 2px 8px;
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), border-color 120ms var(--ds-ease-in-out, ease);
}
[data-auto-team-panel] button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-auto-team-panel] button:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, color-mix(in srgb, currentColor 14%, transparent));
}
[data-auto-team-panel] button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-auto-team-panel] button:disabled { cursor: not-allowed; opacity: 0.5; }
[data-auto-team-panel] input,
[data-auto-team-panel] select,
[data-auto-team-panel] textarea {
  font: inherit;
  color: inherit;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 3px 6px;
  box-sizing: border-box;
  min-width: 0;
}
[data-auto-team-panel] input:focus-visible,
[data-auto-team-panel] select:focus-visible,
[data-auto-team-panel] textarea:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-auto-team-panel] [data-panel-tabs] {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, currentColor);
}
[data-auto-team-panel] [data-panel-tab] {
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 4px 8px;
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-auto-team-panel] [data-panel-tab][aria-selected="true"] {
  color: var(--dsw-alias-label-primary, inherit);
  border-bottom-color: var(--dsw-alias-state-business-primary, #2f6feb);
}
[data-auto-team-panel] [data-panel-body] { flex: 1 1 auto; overflow: auto; min-height: 0; }
/*
 * 页头控制条（DESIGN §0.2 / §2.3）：高 40、padding 8-12、底部 1px 分隔。
 * 「完成 x/N」用 tabular-nums（数字位宽固定，计数跳动时其它元素不抖）；320px 下限时
 * 「完成 999/999」≈79px + 状态 chip + 暂停按钮 80px，仍在可用宽度内。
 */
[data-auto-team-panel] [data-panel-progress-row] {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  height: 40px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, currentColor);
  min-width: 0;
}
[data-auto-team-panel] [data-panel-progress] {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
}
[data-auto-team-panel] [data-panel-progress-spacer] { flex: 1 1 auto; }
[data-auto-team-panel] [data-panel-plan-status] {
  box-sizing: border-box;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/18px sans-serif);
}
[data-auto-team-panel] [data-panel-plan-status][data-tone="ok"] {
  color: var(--dsw-alias-state-success-primary, #2f9e44);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 45%, transparent);
}
[data-auto-team-panel] [data-panel-plan-status][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 45%, transparent);
}
/*
 * 暂停/继续按钮：两态**逐像素同尺寸**（min-width 80 / 高 28），文案切换时页头不重排。
 * busy 时文案逐字不变、只置 disabled + 转环（非乐观更新，DESIGN §0.3）。
 */
[data-auto-team-panel] [data-auto-team-pause] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-sizing: border-box;
  height: 28px;
  min-width: 80px;
  padding: 0 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  cursor: pointer;
}
[data-auto-team-panel] [data-auto-team-pause][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 55%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 14%, transparent);
}
[data-auto-team-panel] [data-auto-team-pause][aria-busy="true"] { cursor: progress; }
[data-auto-team-panel] [data-pause-label] { white-space: nowrap; }
[data-auto-team-panel] [data-pause-spinner] {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-sizing: border-box;
  border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  animation: dsh-auto-team-spin 800ms linear infinite;
}
/* 暂停横幅（DESIGN §0.2 / §0.4）：高 32、左 3px 琥珀竖条、无阴影 —— 琥珀不是红。 */
[data-auto-team-panel] [data-panel-paused-banner] {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  min-height: 32px;
  padding: 4px 8px 4px 10px;
  border-left: 3px solid var(--dsw-alias-state-warn-primary, #b58900);
  border-radius: var(--dsw-radius-sm, 8px);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 8%, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  overflow-wrap: anywhere;
}
[data-auto-team-panel] [data-paused-icon] { color: var(--dsw-alias-state-warn-primary, #b58900); }
[data-auto-team-panel] [data-paused-at] {
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
[data-auto-team-panel] [data-empty] { color: var(--dsw-alias-label-tertiary, inherit); padding: 8px 0; }
[data-auto-team-panel] [data-empty] p { margin: 0 0 4px; }
[data-auto-team-panel] [data-empty-next] {
  color: var(--dsw-alias-label-secondary, inherit);
  border-left: 2px solid var(--dsw-alias-border-l3, currentColor);
  padding-left: 8px;
}
[data-auto-team-panel] [data-error] { color: var(--dsw-alias-state-error-primary, #d33); padding: 4px 0; }
[data-auto-team-panel] [data-hint] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
  padding: 2px 0;
}
[data-auto-team-panel] [data-budget] {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-auto-team-panel] [data-budget][data-over="true"] { color: var(--dsw-alias-state-warn-primary, #b58900); }
[data-auto-team-panel] [data-chip] {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid currentColor;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}

/* ───────────────── 计划页 ───────────────── */
[data-auto-team-plan] { display: flex; flex-direction: column; gap: 6px; }
[data-auto-team-plan] [data-plan-meta-row] {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-plan] [data-plan-planned-at] { color: var(--dsw-alias-label-secondary, inherit); }
[data-auto-team-plan] [data-plan-concurrency] {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-plan] [data-plan-concurrency][data-concurrency-source="default"] [data-concurrency-source-label] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
}
[data-auto-team-plan] [data-plan-actions] {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 2px 0;
}
[data-auto-team-plan] [data-plan-members] { color: var(--dsw-alias-label-tertiary, inherit); }
[data-auto-team-plan] [data-plan-table] { display: flex; flex-direction: column; gap: 8px; }
/*
 * 任务卡（DESIGN §0.2 / §2.3）：radius 12 / padding 10-12 / 卡间距 8 / bg-layer-1 + border-l2 + lv1 阴影。
 * paused 卡**去阴影 + 琥珀 40% 描边 + 左 3px 竖条**：琥珀不是红（红留给 interrupted/failed），
 * 且暂停时列表不重排 —— 位置稳定才看得出谁被打断。
 */
[data-auto-team-plan] [data-plan-row] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-1, transparent);
  box-shadow: var(--dsw-shadow-lv1, 0 1px 2px color-mix(in srgb, currentColor 10%, transparent));
}
[data-auto-team-plan] [data-plan-row][data-paused="true"] {
  box-shadow: none;
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 40%, transparent);
  border-left: 3px solid var(--dsw-alias-state-warn-primary, #b58900);
  padding-left: 10px;
}
[data-auto-team-plan] [data-task-head] {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
[data-auto-team-plan] [data-task-title] {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-auto-team-plan] [data-task-status-badge] {
  flex: 0 0 auto;
  box-sizing: border-box;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/18px sans-serif);
}
[data-auto-team-plan] [data-task-status-badge][data-tone="success"] {
  color: var(--dsw-alias-state-success-primary, #2f9e44);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 45%, transparent);
}
[data-auto-team-plan] [data-task-status-badge][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 45%, transparent);
}
[data-auto-team-plan] [data-task-status-badge][data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary, #d33);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d33) 45%, transparent);
}
[data-auto-team-plan] [data-task-acceptance] {
  margin: 0;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  overflow-wrap: anywhere;
  /* 内容最多两行：卡高 100px 的上界靠这条守住（DESIGN §0.2） */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
[data-auto-team-plan] [data-task-foot] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
[data-auto-team-plan] [data-task-foot] select { max-width: 140px; }
[data-auto-team-plan] [data-task-role-readonly] {
  color: var(--dsw-alias-label-secondary, inherit);
  box-sizing: border-box;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-3, color-mix(in srgb, currentColor 10%, transparent));
}
[data-auto-team-plan] [data-task-has-evidence] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  overflow-wrap: anywhere;
}
[data-auto-team-plan] [data-task-id-label] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  flex: 0 0 auto;
}

/* ═════════ r11：写域占用 / 等待条 / 三动作 / 改验收浮层 / 执行痕迹 ═════════
 * 三条纪律（DESIGN §0）：
 *  1. 字号一律 font 简写（--dsw-font-* 是复合值，写 font-size 是无效声明）；
 *  2. 颜色只用语义 token；等待/取消/跳过是琥珀或中性，**不用红**；
 *  3. 等待原因、占用原因、留痕原因不 clamp 关键信息（留痕原因按设计单行省略 120 字）。 */

/* 任务卡是浮层的定位上下文（改验收浮层绝对定位在卡内）。 */
[data-auto-team-plan] [data-plan-row] { position: relative; }
/* 等待写域：左 3px 琥珀竖条，阴影保留（它不是异常，只是被挡住了）。 */
[data-auto-team-plan] [data-plan-row][data-status="waiting"] {
  border-left: 3px solid var(--dsw-alias-state-warn-primary, #b58900);
  padding-left: 10px;
}
[data-auto-team-plan] [data-task-status-badge][data-status="waiting"] {
  color: var(--dsw-alias-label-secondary, inherit);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 45%, transparent);
}
/* 动作成功后的 300ms 闪烁：只改描边，尺寸不动（否则整页会跳）。 */
[data-auto-team-plan] [data-plan-row][data-flash="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 60%, transparent);
  transition: border-color 120ms var(--ds-ease-in-out, ease);
}
[data-auto-team-plan] [data-plan-row][data-editing="true"] {
  z-index: 2;
  box-shadow: var(--dsw-shadow-lv3, 0 8px 24px color-mix(in srgb, currentColor 18%, transparent));
}

/* 等待条（acceptance 与 foot 之间）：快照原文，不截断。 */
[data-auto-team-plan] [data-wait-reason] {
  margin: 0;
  box-sizing: border-box;
  padding: 4px 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-2, color-mix(in srgb, currentColor 6%, transparent));
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  overflow-wrap: anywhere;
}

/* 写域占用区块（动作行与任务表之间；空数组时组件根本不渲染）。 */
[data-auto-team-plan] [data-scope-locks] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-2, transparent);
}
[data-auto-team-plan] [data-locks-head] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  letter-spacing: 0.02em;
}
[data-auto-team-plan] [data-lock-list] {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
}
[data-auto-team-plan] [data-lock-row] {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 6px;
  min-width: 0;
}
[data-auto-team-plan] [data-lock-path] {
  min-width: 0;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  overflow-wrap: anywhere;
}
[data-auto-team-plan] [data-lock-holder] {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  white-space: nowrap;
}
[data-auto-team-plan] [data-lock-waiters] {
  flex: 1 1 100%;
  list-style: none;
  margin: 0;
  padding: 0 0 0 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 1px dashed var(--dsw-alias-border-l2, currentColor);
}
[data-auto-team-plan] [data-lock-waiter] {
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  overflow-wrap: anywhere;
}

/* 三动作（foot 末尾整组）：取消 → 跳过 → 验收。 */
[data-auto-team-plan] [data-task-actions] {
  margin-left: auto;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
[data-auto-team-plan] [data-task-action] {
  box-sizing: border-box;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/20px sans-serif);
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), border-color 120ms var(--ds-ease-in-out, ease);
}
[data-auto-team-plan] [data-task-action]:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-auto-team-plan] [data-task-action]:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, color-mix(in srgb, currentColor 14%, transparent));
}
[data-auto-team-plan] [data-task-action]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-auto-team-plan] [data-task-action="cancel"]:hover:not(:disabled) {
  color: var(--dsw-alias-state-error-primary, #d33);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d33) 45%, transparent);
}
[data-auto-team-plan] [data-task-action="edit-acceptance"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 40%, transparent);
  color: var(--dsw-alias-state-business-primary, #2f6feb);
}
[data-auto-team-plan] [data-task-action]:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
[data-auto-team-plan] [data-task-action-spinner] {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-left: 4px;
  vertical-align: -2px;
  border-radius: 50%;
  box-sizing: border-box;
  border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  animation: dsh-auto-team-spin 800ms linear infinite;
}

/* 改验收浮层（卡内绝对浮层，不是模态）：宽 272 / 最小高 196。 */
[data-auto-team-plan] [data-acceptance-editor] {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 6;
  width: 272px;
  max-width: calc(100% - 16px);
  min-height: 196px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l3, currentColor);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: var(--dsw-shadow-lv3, 0 8px 24px color-mix(in srgb, currentColor 18%, transparent));
}
[data-auto-team-plan] [data-acceptance-editor-head] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
[data-auto-team-plan] [data-acceptance-editor-title] {
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  font-weight: 600;
}
[data-auto-team-plan] [data-acceptance-input] {
  width: 100%;
  height: 96px;
  box-sizing: border-box;
  resize: none;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
}
[data-auto-team-plan] [data-acceptance-input]:focus {
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 40%, transparent);
  outline-offset: 1px;
  border-color: var(--dsw-alias-state-business-primary, #2f6feb);
}
[data-auto-team-plan] [data-acceptance-hint] {
  margin: 0;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-auto-team-plan] [data-acceptance-actions] {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: auto;
}
[data-auto-team-plan] [data-acceptance-actions] button {
  box-sizing: border-box;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xs-13, 13px/22px sans-serif);
  cursor: pointer;
}
[data-auto-team-plan] [data-acceptance-actions] button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-auto-team-plan] [data-acceptance-actions] button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-auto-team-plan] [data-acceptance-save] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 55%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 14%, transparent);
  color: var(--dsw-alias-state-business-primary, #2f6feb);
  font-weight: 600;
}
[data-auto-team-plan] [data-acceptance-actions] button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

/* 执行痕迹（页面最末；审计不是告警，不用红/琥珀、不加 badge）。 */
[data-auto-team-plan] [data-deviation] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-auto-team-plan] [data-deviation-head] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-auto-team-plan] [data-deviation-list] {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
}
[data-auto-team-plan] [data-deviation-row] {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 2px 6px;
  padding: 1px 2px;
  border-radius: var(--dsw-radius-xs, 4px);
  transition: background-color 100ms var(--ds-ease-in-out, ease);
}
[data-auto-team-plan] [data-deviation-row]:hover {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
}
[data-auto-team-plan] [data-deviation-at] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-variant-numeric: tabular-nums;
}
[data-auto-team-plan] [data-deviation-tool] {
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
}
[data-auto-team-plan] [data-deviation-paths] {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  overflow-wrap: anywhere;
}
[data-auto-team-plan] [data-deviation-count] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-variant-numeric: tabular-nums;
}
[data-auto-team-plan] [data-deviation-reason] {
  flex: 1 1 100%;
  min-width: 0;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 360px) {
  [data-auto-team-plan] [data-acceptance-editor] {
    left: 4px;
    right: 4px;
    width: auto;
    max-width: none;
  }
}


/* ───────────────── 成员页 ───────────────── */
[data-auto-team-members] { display: flex; flex-direction: column; gap: 8px; }
[data-auto-team-member] {
  display: grid;
  grid-template-columns: 76px minmax(96px, 1fr) 64px 44px;
  gap: 6px 8px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-auto-team-member][data-status="interrupted"] {
  border-left: 2px dashed var(--dsw-alias-state-error-primary, #d33);
  padding-left: 6px;
}
[data-auto-team-member][data-status="failed"] {
  border-left: 2px solid var(--dsw-alias-state-error-primary, #d33);
  padding-left: 6px;
}
[data-auto-team-member] [data-member-name] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-auto-team-member] [data-member-task] { color: var(--dsw-alias-label-tertiary, inherit); }
[data-auto-team-member] [data-member-last-event] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  white-space: nowrap;
}
[data-auto-team-member] [data-model-route] {
  grid-column: 1 / -1;
  font: var(--dsw-font-xxxs-11, 11px/16px inherit);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  color: var(--dsw-alias-label-tertiary, inherit);
  white-space: pre-wrap;
  word-break: break-all;
}
/*
 * 停滞条：跨全宽插槽（grid-column 1/-1），不参与 76/96/64/44 四列的宽度竞争。
 *
 * 颜色分工是被对比度逼出来的：琥珀 #b58900 落在 bg-layer-1 上约 3.2:1，11px 正文不达标，
 * 所以琥珀只承担「非文本」部分（左竖条 / 图标 / 描边 / 8% 底），正文一律 label-secondary。
 * 与 interrupted 的差别是**实线 vs 虚线 + 琥珀 vs 红 + 文案完全不同**，去掉颜色仍可分辨。
 */
[data-auto-team-member] [data-member-stall] {
  grid-column: 1 / -1;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 2px;
  margin: 2px 0;
  padding: 2px 6px 2px 6px;
  border-left: 2px solid var(--dsw-alias-state-warn-primary, #b58900);
  border: 1px solid var(--dsw-alias-state-warn-primary, #b58900);
  border-left-width: 2px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 8%, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px inherit);
  /* 秒数是判断依据，绝不 ellipsis，允许折到第二行 */
  white-space: normal;
  animation: auto-team-stall-in 120ms var(--ds-ease-in-out, ease-out) both;
}
[data-auto-team-member] [data-member-stall] [data-stall-icon] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
}
[data-auto-team-member] [data-member-stall] [data-stall-seconds] {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
@keyframes auto-team-stall-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  [data-auto-team-member] [data-member-stall] { animation: none; }
}
[data-auto-team-member] [data-member-actions],
[data-auto-team-member] [data-member-message-row] {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
[data-auto-team-member] [data-member-actions] input { flex: 1 1 120px; }
[data-auto-team-member] [data-member-message-row] input { flex: 1 1 140px; }
[data-auto-team-member] [data-evidence-drawer] {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 2px 0 6px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-member] [data-evidence-line] {
  display: flex;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
}
[data-auto-team-member] [data-evidence-label] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-auto-team-member] [data-evidence-line] code {
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  word-break: break-all;
}
[data-auto-team-member] [data-evidence-tail] {
  margin: 4px 0 0;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font: var(--dsw-font-xxxs-11, 11px/16px inherit);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-message-ledger] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px dashed var(--dsw-alias-border-l2, currentColor);
}
[data-message-ledger] [data-ledger-head] {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
[data-message-ledger] [data-ledger-meta] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-message-ledger] [data-ledger-list] {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow: auto;
}
/*
 * 账本行：行头一行 + 正文整行独占。
 *
 * 旧布局是「auto auto auto minmax(0,1fr)」四列，正文只捞到约 115px（12px 字 ≈ 9 汉字/行），
 * 而直投正文最长是「上游 id/title + 命令 + 退出码 + 800 字证据尾部 + 产物路径」，
 * 照旧布局要 80+ 行，账本直接废掉。改 flex 后正文拿到整行 ≈ 28 汉字/行。
 */
[data-message-ledger] [data-message] {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
  padding: 4px 4px 4px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  transition: background-color 100ms var(--ds-ease-in-out, ease-out);
}
[data-message-ledger] [data-message]:hover {
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
[data-message-ledger] [data-message-route] { color: var(--dsw-alias-label-secondary, inherit); white-space: nowrap; }
[data-message-ledger] [data-message-task],
[data-message-ledger] [data-message-at] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  white-space: nowrap;
}
/*
 * peer 行（上游直投）：左侧中性竖条。用 border-l3 而不是琥珀——
 * 来源不是状态，给它上状态色会让「谁发的」和「有没有问题」混成一件事。
 */
[data-message-ledger] [data-message][data-from="peer"] {
  border-left: 2px solid var(--dsw-alias-border-l3, currentColor);
  padding-left: 6px;
}
[data-message-ledger] [data-message-body] {
  flex: 1 0 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 4px 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  font: var(--dsw-font-xxs-12, 12px/18px inherit);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* 折叠：54px = 3 行；展开 324px = 18 行 + 内部滚动。用 max-height 不用 line-clamp——
 * body 是 pre-wrap 多行结构且含无空格长路径，line-clamp 的 -webkit-box 会把换行算坏。 */
[data-message-ledger] [data-message][data-message-expanded="false"] [data-message-body] {
  max-height: 54px;
  overflow: hidden;
}
[data-message-ledger] [data-message][data-message-expanded="true"] [data-message-body] {
  max-height: 324px;
  overflow: auto;
}
[data-message-ledger] [data-message-toggle] {
  flex: 0 0 auto;
  margin-left: auto;
  border: 0;
  background: transparent;
  padding: 2px 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  cursor: pointer;
  color: var(--dsw-alias-state-business-primary, #2f6feb);
  font: var(--dsw-font-xxxs-11, 11px/16px inherit);
  transition: background-color 100ms var(--ds-ease-in-out, ease-out);
}
[data-message-ledger] [data-message-toggle]:hover {
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
[data-message-ledger] [data-message-toggle]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}

/* ───────────────── 记忆页 ───────────────── */
[data-auto-team-memory] { display: flex; flex-direction: column; gap: 8px; }
[data-auto-team-memory] [data-memory-tracks] { display: flex; gap: 6px; }
[data-auto-team-memory] [data-memory-track][aria-selected="true"] {
  border-color: var(--dsw-alias-state-business-primary, #2f6feb);
  color: var(--dsw-alias-state-business-primary, #2f6feb);
}
[data-auto-team-memory] [data-memory-list] {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
[data-auto-team-memory] [data-memory-file] {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-auto-team-memory] [data-memory-file][data-active="true"] [data-memory-open] {
  color: var(--dsw-alias-state-business-primary, #2f6feb);
}
[data-auto-team-memory] [data-memory-open] {
  flex: 1 1 auto;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 2px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-auto-team-memory] [data-memory-chars] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-auto-team-memory] [data-memory-delete][data-confirm="true"] {
  color: var(--dsw-alias-state-error-primary, #d33);
  border-color: var(--dsw-alias-state-error-primary, #d33);
}
[data-auto-team-memory] [data-memory-editor] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px dashed var(--dsw-alias-border-l2, currentColor);
}
[data-auto-team-memory] [data-editor-head] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-auto-team-memory] [data-memory-body] { resize: vertical; min-height: 96px; }
[data-auto-team-memory] [data-editor-actions],
[data-auto-team-roles] [data-editor-actions] { display: flex; gap: 8px; }

/* ───────────────── 角色页 ───────────────── */
[data-auto-team-roles] { display: flex; flex-direction: column; gap: 8px; }
[data-auto-team-roles] [data-roles-head] {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
[data-auto-team-roles] [data-roles-meta] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-auto-team-roles] [data-role-list] {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
[data-auto-team-roles] [data-role-row] {
  display: grid;
  grid-template-columns: minmax(64px, auto) minmax(0, 1fr) auto;
  gap: 4px 8px;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-auto-team-roles] [data-role-name] { white-space: nowrap; }
[data-auto-team-roles] [data-role-duty] {
  color: var(--dsw-alias-label-tertiary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-auto-team-roles] [data-role-actions] { display: flex; gap: 6px; flex-wrap: wrap; }
[data-auto-team-roles] [data-role-list] [data-model-route] {
  grid-column: 1 / -1;
  font: var(--dsw-font-xxxs-11, 11px/16px inherit);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  color: var(--dsw-alias-label-tertiary, inherit);
  white-space: pre-wrap;
  word-break: break-all;
}
[data-auto-team-roles] [data-model-route][data-unverified="true"] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
}
[data-auto-team-roles] [data-role-unverified-note] {
  grid-column: 1 / -1;
  color: var(--dsw-alias-state-warn-primary, #b58900);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-auto-team-roles] [data-role-delete][data-confirm="true"] {
  color: var(--dsw-alias-state-error-primary, #d33);
  border-color: var(--dsw-alias-state-error-primary, #d33);
}
[data-auto-team-roles] [data-role-editor] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--dsw-alias-border-l2, currentColor);
}
[data-auto-team-roles] [data-role-model-editor] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 96px;
  gap: 6px;
  align-items: center;
}
[data-auto-team-roles] [data-role-model-preview] {
  grid-column: 1 / -1;
  font: var(--dsw-font-xxxs-11, 11px/16px inherit);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  color: var(--dsw-alias-label-tertiary, inherit);
  white-space: pre-wrap;
  word-break: break-all;
}
[data-auto-team-roles] [data-role-editor] [data-editor-head] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}

/* ───────────────── 状态徽标（图标由 viewmodel 出，这里只上色） ───────────────── */
[data-auto-team-panel] [data-badge-icon] {
  display: inline-block;
  width: 1em;
  text-align: center;
}
[data-auto-team-panel] [data-tone="business"] { color: var(--dsw-alias-state-business-primary, #2f6feb); }
[data-auto-team-panel] [data-tone="warn"] { color: var(--dsw-alias-state-warn-primary, #b58900); }
[data-auto-team-panel] [data-tone="danger"] { color: var(--dsw-alias-state-error-primary, #d33); }
[data-auto-team-panel] [data-tone="success"] { color: var(--dsw-alias-state-success-primary, #2f9e44); }
[data-auto-team-panel] [data-tone="neutral"] { color: var(--dsw-alias-label-tertiary, inherit); }

/* ───────────────── 设置页（settings.section，DESIGN §2.4） ─────────────────
 * 卡片 radius-md + padding 16 + **无阴影**（设置页是阅读面，不是浮层）。
 * 输入/下拉一律高 28 / padding 0-8 / radius-sm；内容列 max-width 720 防超宽行长。
 * 角色卡与面板角色页共用「data-role-card」一套样式，density 只差字号与按钮形态。 */
[data-auto-team-settings] {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 720px;
  box-sizing: border-box;
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  color: var(--dsw-alias-label-primary, inherit);
}
[data-auto-team-settings] [data-settings-head] { display: flex; flex-direction: column; gap: 2px; }
[data-auto-team-settings] [data-settings-title] { margin: 0; font: var(--dsw-font-h3-16, 16px/24px sans-serif); }
[data-auto-team-settings] [data-settings-intro],
[data-auto-team-settings] [data-settings-roles-intro] {
  margin: 0;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-settings] [data-settings-grid] { display: flex; flex-direction: column; gap: 8px; }
[data-auto-team-settings] [data-setting-row] {
  display: grid;
  grid-template-columns: minmax(96px, 148px) minmax(0, 1fr) minmax(88px, 132px);
  gap: 8px;
  align-items: center;
}
[data-auto-team-settings] [data-setting-label] { color: var(--dsw-alias-label-secondary, inherit); }
[data-auto-team-settings] [data-setting-inputs] { display: flex; align-items: center; gap: 6px; min-width: 0; }
[data-auto-team-settings] [data-setting-inputs] input { flex: 1 1 auto; }
[data-auto-team-settings] input,
[data-auto-team-settings] select,
[data-auto-team-settings] textarea {
  box-sizing: border-box;
  height: 28px;
  padding: 0 8px;
  font: inherit;
  color: inherit;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  min-width: 0;
}
[data-auto-team-settings] textarea { height: 96px; padding: 6px 8px; resize: vertical; }
[data-auto-team-settings] input:focus-visible,
[data-auto-team-settings] select:focus-visible,
[data-auto-team-settings] textarea:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
/* 非法值：字段描边转 error，磁盘上的设置逐字不变（AC-17） */
[data-auto-team-settings] [data-setting-row][data-error-state="true"] input {
  border-color: var(--dsw-alias-state-error-primary, #d33);
}
[data-auto-team-settings] [data-setting-row][data-error-state="true"] [data-setting-hint] {
  color: var(--dsw-alias-state-error-primary, #d33);
}
[data-auto-team-settings] [data-setting-hint] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  text-align: right;
  overflow-wrap: anywhere;
}
[data-auto-team-settings] [data-settings-actions] { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
[data-auto-team-settings] button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  height: 28px;
  padding: 0 10px;
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), border-color 120ms var(--ds-ease-in-out, ease);
}
[data-auto-team-settings] button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-auto-team-settings] button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-auto-team-settings] button:disabled { cursor: not-allowed; opacity: 0.55; }
[data-auto-team-settings] [data-settings-save] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 12%, transparent);
}
[data-auto-team-settings] [data-hint] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-settings] [data-error] { color: var(--dsw-alias-state-error-primary, #d33); }
[data-auto-team-settings] [data-settings-divider] {
  width: 100%;
  margin: 4px 0;
  border: 0;
  border-top: 1px solid var(--dsw-alias-border-l2, currentColor);
}
[data-auto-team-settings] [data-settings-roles-head] { display: flex; flex-direction: column; gap: 2px; }
[data-auto-team-settings] [data-settings-roles-title] { margin: 0; font: var(--dsw-font-h4-14, 14px/22px sans-serif); }

/* ───────────────── 角色编辑（RoleEditorList，面板与设置页共用） ─────────────────
 * 卡片 radius-md + padding 16 + 无阴影；提示词 textarea **固定 96px 内滚、绝不 auto-grow**：
 * 8000 字符上限下 auto-grow 会把卡片撑到上万像素，保存按钮永远够不到（DESIGN §0.2）。 */
[data-auto-team-role-editor] { display: flex; flex-direction: column; gap: 8px; }
[data-auto-team-role-editor] [data-roles-head] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
[data-auto-team-role-editor] [data-roles-count] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-role-editor] [data-role-list] { display: flex; flex-direction: column; gap: 8px; }
[data-auto-team-role-editor] [data-role-card] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-1, transparent);
}
[data-auto-team-role-editor] [data-role-card][data-error-state="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d33) 55%, transparent);
}
[data-auto-team-role-editor] [data-role-card-head] {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
[data-auto-team-role-editor] [data-role-card-name] {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-auto-team-role-editor] [data-role-origin] {
  flex: 0 0 auto;
  box-sizing: border-box;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-3, color-mix(in srgb, currentColor 10%, transparent));
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/18px sans-serif);
}
[data-auto-team-role-editor] [data-role-actions] { display: inline-flex; align-items: center; gap: 4px; }
[data-auto-team-role-editor] [data-role-field] {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
[data-auto-team-role-editor] [data-role-field-label] {
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-role-editor] input,
[data-auto-team-role-editor] select,
[data-auto-team-role-editor] textarea {
  box-sizing: border-box;
  height: 28px;
  padding: 0 8px;
  font: inherit;
  color: inherit;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  min-width: 0;
}
[data-auto-team-role-editor] textarea {
  /* 固定内滚：不 auto-grow（见上） */
  height: 96px;
  padding: 6px 8px;
  resize: vertical;
}
[data-auto-team-role-editor] input:focus-visible,
[data-auto-team-role-editor] textarea:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-auto-team-role-editor] [data-role-skill-list] {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  min-width: 0;
}
[data-auto-team-role-editor] [data-role-skill] {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  height: 22px;
  padding: 0 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/18px sans-serif);
  cursor: pointer;
}
[data-auto-team-role-editor] [data-role-skill][data-checked="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 12%, transparent);
  color: var(--dsw-alias-label-primary, inherit);
}
[data-auto-team-role-editor] [data-role-skill] input { height: auto; margin: 0; }
[data-auto-team-role-editor] [data-role-skill-empty] { color: var(--dsw-alias-label-tertiary, inherit); }
[data-auto-team-role-editor] [data-role-error] {
  color: var(--dsw-alias-state-error-primary, #d33);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-role-editor] [data-role-card-actions] { display: flex; align-items: center; gap: 6px; }
[data-auto-team-role-editor] [data-role-delete-confirm],
[data-auto-team-role-editor] [data-roles-restore-confirm] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px 8px;
  border-left: 3px solid var(--dsw-alias-state-warn-primary, #b58900);
  border-radius: var(--dsw-radius-xs, 4px);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 8%, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-role-editor] [data-roles-foot] {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
[data-auto-team-role-editor] button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  height: 24px;
  padding: 0 8px;
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), border-color 120ms var(--ds-ease-in-out, ease);
}
[data-auto-team-role-editor] button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-auto-team-role-editor] button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-auto-team-role-editor] button:disabled { cursor: not-allowed; opacity: 0.55; }
[data-auto-team-role-editor] [data-role-save] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 12%, transparent);
}
/* density=page：设置页里字号与按钮放大一档；面板窄栏保持紧凑（行为完全一致） */
[data-auto-team-role-editor][data-density="page"] [data-role-card] { padding: 16px; }
[data-auto-team-role-editor][data-density="page"] button { height: 28px; padding: 0 10px; }
[data-auto-team-role-editor][data-density="panel"] [data-role-card] { padding: 12px; }
[data-auto-team-role-editor][data-density="panel"] [data-role-field] { grid-template-columns: 56px minmax(0, 1fr); }

/* ───────────────── r10 技能库（四来源 / 已修改 / 三入口，DESIGN §2.4 M4） ─────────────────
 * 行高 56、列表 max-height:200 内滚 —— **绝不 auto-grow**：12 条内置技能若按内容撑开，
 * 单张角色卡会长到上千像素，用户要滚三屏才能看到「保存」。 */
[data-auto-team-role-editor] [data-skill-library] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  padding: 8px 8px 6px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-1, transparent);
  min-width: 0;
}
[data-auto-team-role-editor] [data-skills-head] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
[data-auto-team-role-editor] [data-skills-count] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-auto-team-role-editor] [data-skill-add-menu] {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
[data-auto-team-role-editor] [data-skill-add-menu] button { height: 24px; }
[data-auto-team-role-editor] [data-skill-list] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  min-width: 0;
}
[data-auto-team-role-editor] [data-skill-row] {
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  min-height: 56px;
  padding: 5px 8px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  min-width: 0;
  transition: border-color 120ms var(--ds-ease-in-out, ease), background-color 120ms var(--ds-ease-in-out, ease);
}
[data-auto-team-role-editor] [data-skill-row]:hover {
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-auto-team-role-editor] [data-skill-row-main] {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
[data-auto-team-role-editor] [data-skill-title] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
}
[data-auto-team-role-editor] [data-skill-badge] {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  white-space: nowrap;
}
[data-auto-team-role-editor] [data-skill-badge][data-source="imported"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 45%, transparent);
  color: var(--dsw-alias-state-business-primary, #2f6feb);
}
[data-auto-team-role-editor] [data-skill-badge][data-source="system"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 45%, transparent);
  color: var(--dsw-alias-state-success-primary, #2f9e44);
}
[data-auto-team-role-editor] [data-skill-badge][data-source="manual"] {
  border-style: dashed;
  color: var(--dsw-alias-label-secondary, inherit);
}
/* 「已修改」徽标：描边与底用琥珀 45%/16%，**文字不用琥珀**（11px 琥珀在浅底上不可读） */
[data-auto-team-role-editor] [data-skill-modified] {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 16%, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  white-space: nowrap;
}
[data-auto-team-role-editor] [data-skill-row-sub] {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
[data-auto-team-role-editor] [data-skill-description] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-auto-team-role-editor] [data-skill-row] button { height: 20px; padding: 0 6px; font: var(--dsw-font-xxs-12, 12px/18px sans-serif); }
[data-auto-team-role-editor] [data-skill-delete-confirm],
[data-auto-team-role-editor] [data-skill-restore-confirm] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
  padding: 4px 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: var(--dsw-alias-bg-layer-2, transparent);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-auto-team-role-editor] [data-skill-delete-ok],
[data-auto-team-role-editor] [data-skill-restore-ok] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 55%, transparent);
}
[data-auto-team-role-editor] [data-skill-notice] {
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
[data-auto-team-role-editor] [data-skill-import-error] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  margin: 0;
}
/* 勾选中的技能条目（角色卡里的技能选择） */
[data-auto-team-role-editor] [data-role-field-skills] [data-role-skill-list] { max-height: 160px; overflow-y: auto; scrollbar-gutter: stable; }

/* ───────────────── r10 三个弹层（模型气泡 / 技能编辑 / 系统技能，DESIGN §2.5） ─────────────────
 * 全部 createPortal 到 body：宿主自绘标题栏的 -webkit-app-region: drag 会让落在里面的
 * 点击在真机上失效（Playwright 合成点击绕过该判定，所以 e2e 永远绿）——portal 移出该子树，
 * 顺带避免被角色卡的 overflow:hidden 裁掉。 */
[data-role-model-popover],
[data-skill-dialog-backdrop],
[data-dialog-backdrop] {
  position: fixed;
  z-index: 1000;
}
[data-skill-dialog-backdrop] {
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #000 32%, transparent);
}
[data-skill-dialog] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  width: 420px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  padding: 12px;
  border-radius: var(--dsw-radius-md, 12px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: var(--dsw-alias-bg-layer-3, #fff);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0, 0, 0, 0.24));
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
}
[data-skill-dialog][data-dialog-size="wide"] { width: 480px; }
[data-skill-dialog] [data-dialog-head] {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
[data-skill-dialog] [data-dialog-title] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-sm-14, 14px/20px sans-serif);
}
[data-skill-dialog] [data-dialog-badge],
[data-skill-dialog] [data-skill-picker-count] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-skill-dialog] [data-dialog-field] {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
[data-skill-dialog] [data-dialog-label] {
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-skill-dialog] input,
[data-skill-dialog] textarea,
[data-role-model-popover] input {
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  color: inherit;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  height: 28px;
  padding: 3px 8px;
  box-sizing: border-box;
  min-width: 0;
}
[data-skill-dialog] textarea,
[data-skill-dialog] [data-skill-body-input] {
  /* 正文固定 200px 内滚（DESIGN §0.2）：20k 字符下 auto-grow 会把弹层顶出屏幕 */
  height: 200px;
  padding: 6px 8px;
  resize: vertical;
  font-family: var(--ds-font-family-code, monospace);
  line-height: 18px;
}
[data-skill-dialog] button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  height: 24px;
  padding: 0 8px;
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), border-color 120ms var(--ds-ease-in-out, ease);
}
[data-skill-dialog] button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-skill-dialog] button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-skill-dialog] button:disabled { cursor: not-allowed; opacity: 0.55; }
[data-skill-dialog] [data-dialog-actions] {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
  min-width: 0;
}
[data-skill-dialog] [data-dialog-actions-spacer] { flex: 1 1 auto; }
[data-skill-dialog] [data-dialog-save][data-primary="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 12%, transparent);
}
[data-skill-dialog] [data-skill-builtin-hint] {
  margin: 0;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-skill-dialog] [data-skill-body-count] {
  align-self: flex-end;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-skill-dialog] [data-skill-body-count][data-over-limit="true"] {
  color: var(--dsw-alias-state-error-primary, #d33);
}
[data-skill-dialog] [data-dialog-error],
[data-skill-dialog] [data-skill-body-error] {
  margin: 0;
  color: var(--dsw-alias-state-error-primary, #d33);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-skill-dialog] [data-skill-body-error] { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 正文骨架：3 条 14px 呼吸条（不用 spinner —— 骨架能表达"要出现的是文字"） */
[data-skill-dialog] [data-skill-body-skeleton] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  height: 200px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-1, transparent);
}
[data-skill-dialog] [data-skill-body-skeleton] > span {
  display: block;
  height: 14px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-2, color-mix(in srgb, currentColor 10%, transparent));
  animation: dsh-auto-team-breathe 1200ms var(--ds-ease-in-out, ease) infinite alternate;
}
[data-skill-dialog] [data-skill-body-skeleton] > span:nth-child(2) { width: 82%; }
[data-skill-dialog] [data-skill-body-skeleton] > span:nth-child(3) { width: 64%; }
@keyframes dsh-auto-team-breathe {
  from { opacity: 0.4; }
  to { opacity: 0.9; }
}
/* 系统技能列表：40px 行 + 名称/说明两列 */
[data-skill-dialog] [data-skill-picker-list] {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  min-width: 0;
}
[data-skill-dialog] [data-skill-picker-row] {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 8px;
  box-sizing: border-box;
  min-height: 40px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-sm, 8px);
  cursor: pointer;
  min-width: 0;
}
[data-skill-dialog] [data-skill-picker-row]:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent)); }
[data-skill-dialog] [data-skill-picker-row][data-checked="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 8%, transparent);
}
[data-skill-dialog] [data-skill-picker-row] input { grid-row: 1 / span 2; align-self: center; height: auto; margin: 0; }
[data-skill-dialog] [data-skill-picker-name] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
}
[data-skill-dialog] [data-skill-picker-desc] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-skill-dialog] [data-skill-picker-empty] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px dashed var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-skill-dialog] [data-skill-picker-empty] p { margin: 0; }

/* 模型弹层（角色卡上的 button + 气泡） */
[data-role-model-picker] {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  position: relative;
}
[data-role-model-picker-button] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  height: 24px;
  max-width: 100%;
  padding: 0 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), border-color 120ms var(--ds-ease-in-out, ease);
}
[data-role-model-picker-button]:hover {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-role-model-picker-button]:focus-visible,
[data-role-model-popover] [data-model-option]:focus-visible,
[data-role-model-popover] [data-model-manual-toggle]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-role-model-picker] [data-model-value] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ds-font-family-code, monospace);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-role-model-picker] [data-model-caret] { flex: 0 0 auto; opacity: 0.7; }
[data-role-model-popover] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  width: 296px;
  max-width: calc(100vw - 32px);
  max-height: 320px;
  padding: 8px;
  border-radius: var(--dsw-radius-md, 12px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: var(--dsw-alias-bg-layer-3, #fff);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0, 0, 0, 0.24));
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
}
[data-role-model-popover] [data-model-search-row] { display: flex; min-width: 0; }
[data-role-model-popover] [data-model-search] { flex: 1 1 auto; height: 28px; }
[data-role-model-popover] [data-model-list] {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
[data-role-model-popover] [data-model-option] {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  box-sizing: border-box;
  min-height: 36px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
[data-role-model-popover] [data-model-option]:hover {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
}
[data-role-model-popover] [data-model-option][aria-selected="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6feb) 8%, transparent);
}
[data-role-model-popover] [data-model-option-name] {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ds-font-family-code, monospace);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-role-model-popover] [data-model-option-provider] {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-role-model-popover] [data-model-empty],
[data-role-model-popover] [data-model-loading] {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border: 1px dashed var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-role-model-popover] [data-role-model-manual] { display: flex; flex-direction: column; gap: 4px; }
[data-role-model-popover] [data-model-manual-toggle] {
  align-self: flex-start;
  height: 22px;
  padding: 0 6px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  cursor: pointer;
}
[data-role-model-popover] [data-model-manual-fields] { display: flex; gap: 4px; }
[data-role-model-popover] [data-model-manual-field] { flex: 1 1 0; min-width: 0; }
[data-role-model-popover] [data-model-popover-foot] {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
[data-role-model-popover] [data-model-popover-foot] button {
  height: 22px;
  padding: 0 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: transparent;
  color: inherit;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  cursor: pointer;
}

/* 恢复默认对话框（替换 r7 的行内确认）：确认键用**琥珀**不用红 —— 红只留给不可恢复的失败 */
[data-roles-restore-backdrop] {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #000 32%, transparent);
}
[data-roles-restore-confirm] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  width: 400px;
  max-width: calc(100vw - 32px);
  padding: 14px;
  border-radius: var(--dsw-radius-md, 12px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: var(--dsw-alias-bg-layer-3, #fff);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0, 0, 0, 0.24));
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
}
[data-roles-restore-confirm] [data-restore-title] { font: var(--dsw-font-sm-14, 14px/20px sans-serif); }
[data-roles-restore-confirm] [data-restore-line] {
  margin: 0;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-roles-restore-confirm] [data-restore-actions] {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 4px;
}
[data-roles-restore-confirm] button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  height: 24px;
  padding: 0 10px;
  cursor: pointer;
}
[data-roles-restore-confirm] button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
}
[data-roles-restore-confirm] button:disabled { cursor: not-allowed; opacity: 0.55; }
[data-roles-restore-confirm] [data-roles-restore-ok][data-confirm-tone="warn"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 55%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b58900) 14%, transparent);
}
/* 无障碍：系统要求减少动效时，骨架/呼吸/旋转全部停下（尺寸与文案不变） */
@media (prefers-reduced-motion: reduce) {
  [data-skill-dialog] [data-skill-body-skeleton] > span,
  [data-auto-team-option] [data-option-spinner],
  [data-auto-team-plan] [data-task-action-spinner] {
    animation: none;
  }
  [data-auto-team-plan] [data-plan-row][data-flash="true"] { transition: none; }
}

/* 右栏页签标题（keyed pane.tab.title）：宿主画 hover/active，这里只保证不换行不撑高 */
[data-auto-team-panel-tab] { white-space: nowrap; }

/* ══════════════════════════════════════════════════════════════════════════════
 * r13：三页面板 / 两行任务行 / 流转图 / 左栏项目库 / 确认弹窗
 *
 * 纪律（AGENTS §4）：
 *  - 只用宿主 token，新块不写 16 进制色值（旧块的 16 进制是兜底默认值，不复制过来）；
 *  - 字号一律用 font 简写 —— --dsw-font-* 是复合值，写 font-size: 会静默失效；
 *  - 所有选择器都收在本插件自己的 data 属性作用域内，不碰宿主其它面板；
 *  - 数字全部来自 DESIGN §2/§3：任务行 56、表头 24、run 头 64、节点 148×56、
 *    列距 188、行距 72、画布 300、确认弹窗 402、左列 220。
 * 右栏（[data-auto-team-panel]）与左栏（[data-auto-team-library]/[data-auto-team-panellist]）
 * 共用同一批规则 —— 组件只有一份，样式也只能有一份，否则同一任务行两处会长得不一样。
 * ══════════════════════════════════════════════════════════════════════════════ */

/* ── 页签条：36px，选中项 2px business 底条 ───────────────────────────────── */
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-tab-bar] {
  display: flex;
  align-items: stretch;
  gap: 2px;
  box-sizing: border-box;
  height: 36px;
  padding: 0 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  overflow-x: auto;
  scrollbar-width: none;
}
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-tab-bar]::-webkit-scrollbar {
  display: none;
}
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-tab] {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  height: 100%;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  cursor: pointer;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  transition: color 120ms ease, background-color 120ms ease;
}
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-tab]:hover {
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-tab]:active {
  background: var(--dsw-alias-interactive-bg-active, transparent);
}
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-tab][data-active="true"] {
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
}
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-tab][data-active="true"]::after {
  content: "";
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 2px;
  border-radius: 1px 1px 0 0;
  background: var(--dsw-alias-state-business-primary, currentColor);
}
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-tab]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: -2px;
}

/* ── run 头：64px 两行 + 可选降级行 ──────────────────────────────────────── */
[data-region="run-head"] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  min-height: 64px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
/* 暂停态视觉身份：左侧 2px 警示条（inset shadow，不占布局宽度） */
[data-region="run-head"][data-paused="true"] {
  box-shadow: inset 2px 0 0 var(--dsw-alias-state-warn-primary, currentColor);
}
[data-region="run-head"] [data-run-line] {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 20px;
}
[data-region="run-head"] [data-run-spacer] {
  flex: 1 1 auto;
  min-width: 0;
}
[data-region="run-head"] [data-run-id] {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
}
[data-region="run-head"] [data-plan-status] {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="run-head"] [data-plan-status][data-tone="ok"] {
  color: var(--dsw-alias-state-success-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, currentColor) 45%, transparent);
}
[data-region="run-head"] [data-plan-status][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 55%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 12%, transparent);
}
[data-region="run-head"] [data-plan-status][data-tone="bad"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 45%, transparent);
}
[data-region="run-head"] [data-auto-team-pause] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 20px;
  min-width: 44px;
  padding: 0 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  cursor: pointer;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  transition: background-color 120ms ease, color 120ms ease;
}
[data-region="run-head"] [data-auto-team-pause]:hover {
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
[data-region="run-head"] [data-auto-team-pause][data-paused="true"] {
  color: var(--dsw-alias-state-warn-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 55%, transparent);
}
[data-region="run-head"] [data-auto-team-pause]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: 1px;
}
[data-region="run-head"] [data-run-usage] {
  color: var(--dsw-alias-label-tertiary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="run-head"] [data-run-usage] b {
  color: var(--dsw-alias-label-primary, inherit);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
[data-region="run-head"] [data-run-usage][data-usage-source="unavailable"] b,
[data-region="run-head"] [data-run-window][data-duration-state="unavailable"],
[data-region="run-head"] [data-run-duration][data-duration-state="unavailable"],
[data-region="run-head"] [data-run-duration][data-duration-state="not-started"] {
  color: var(--dsw-alias-label-secondary, inherit);
  border-bottom: 1px dashed var(--dsw-alias-border-l2, currentColor);
  cursor: help;
}
[data-region="run-head"] [data-run-window],
[data-region="run-head"] [data-run-duration] {
  color: var(--dsw-alias-label-tertiary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-variant-numeric: tabular-nums;
}
[data-region="run-head"] [data-inflight-dispatch] {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--dsw-alias-label-tertiary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="run-head"] [data-inflight-dispatch="dispatching"] {
  color: var(--dsw-alias-state-business-primary, currentColor);
}
[data-region="run-head"] [data-inflight-dispatch="dispatched"] {
  color: var(--dsw-alias-state-success-primary, currentColor);
}
[data-region="run-head"] [data-inflight-dot] {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: auto-team-inflight-pulse 1.2s ease-in-out infinite;
}
[data-region="run-head"] [data-run-downgrade] {
  margin: 0;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}

/* ── 角色条：24px chip，可换行 ───────────────────────────────────────────── */
[data-region="task-roles"] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 6px;
}
[data-region="task-roles"] [data-role-chip] {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  height: 24px;
  max-width: 100%;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="task-roles"] [data-role-name] {
  overflow: hidden;
  text-overflow: ellipsis;
}
[data-region="task-roles"] [data-role-tasks] {
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-region="task-roles"] [data-role-token] {
  color: var(--dsw-alias-label-secondary, inherit);
  font-variant-numeric: tabular-nums;
}
[data-region="task-roles"] [data-usage-source="unavailable"] [data-role-token] {
  border-bottom: 1px dashed var(--dsw-alias-border-l2, currentColor);
  cursor: help;
}
[data-region="task-roles"] [data-role-empty] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}

/* ── 任务表：24px sticky 表头 + 56px 两行任务行 ──────────────────────────── */
[data-region="task-list"] [data-task-head] {
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 76px 84px;
  gap: 8px;
  align-items: center;
  box-sizing: border-box;
  height: 24px;
  padding: 0 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="task-list"] [data-head-cell="token"],
[data-region="task-list"] [data-head-cell="duration"] {
  text-align: right;
  white-space: nowrap;
}
[data-region="task-list"] [data-task-rows] {
  list-style: none;
  margin: 0;
  padding: 0;
}
[data-region="task-list"] [data-task-row] {
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  transition: background-color 120ms ease;
}
[data-region="task-list"] [data-task-row]:last-child {
  border-bottom: 0;
}
[data-region="task-list"] [data-task-toggle] {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 56px;
  margin: 0;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
[data-region="task-list"] [data-task-row]:hover {
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
[data-region="task-list"] [data-task-row][data-expanded="true"] {
  background: var(--dsw-alias-bg-layer-2, transparent);
  box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary, currentColor);
}
[data-region="task-list"] [data-task-toggle]:active {
  background: var(--dsw-alias-interactive-bg-active, transparent);
}
[data-region="task-list"] [data-task-toggle]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: -2px;
}
[data-region="task-list"] [data-task-line="title"] {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
}
[data-region="task-list"] [data-task-title] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-region="task-list"] [data-badge] {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  box-sizing: border-box;
  height: 18px;
  max-width: 58px;
  padding: 0 6px;
  overflow: hidden;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="task-list"] [data-badge][data-tone="success"] {
  color: var(--dsw-alias-state-success-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, currentColor) 45%, transparent);
}
[data-region="task-list"] [data-badge][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 45%, transparent);
}
[data-region="task-list"] [data-badge][data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 45%, transparent);
}
[data-region="task-list"] [data-badge][data-tone="business"] {
  color: var(--dsw-alias-state-business-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 45%, transparent);
}
[data-region="task-list"] [data-task-line="meta"] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 76px 84px;
  gap: 8px;
  align-items: center;
  min-height: 18px;
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="task-list"] [data-task-role] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-region="task-list"] [data-cell="token"],
[data-region="task-list"] [data-cell="duration"] {
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
  font-variant-numeric: tabular-nums;
}
/* 「0」是真数字（label-primary）；「不可得 / 未开始」是状态（secondary + 虚线下划线 + help），
   三者必须一眼可分（DESIGN §2.2）。 */
[data-region="task-list"] [data-cell="token"][data-usage-source="provider"] {
  color: var(--dsw-alias-label-primary, inherit);
}
[data-region="task-list"] [data-cell="token"][data-usage-source="unavailable"],
[data-region="task-list"] [data-cell="duration"][data-duration-state="unavailable"],
[data-region="task-list"] [data-cell="duration"][data-duration-state="not-started"] {
  color: var(--dsw-alias-label-secondary, inherit);
  border-bottom: 1px dashed var(--dsw-alias-border-l2, currentColor);
  cursor: help;
}
[data-region="task-list"] [data-cell="duration"][data-duration-state="running"] {
  color: var(--dsw-alias-state-business-primary, currentColor);
}

/* ── 任务展开详情：内联块（不遮面板） ────────────────────────────────────── */
[data-region="task-list"] [data-task-detail] {
  margin: 0 12px 8px;
  padding: 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  animation: auto-team-detail-in 120ms ease-out;
}
[data-task-detail] [data-task-detail-grid] {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 4px 8px;
  margin: 0;
}
[data-task-detail] dt {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-task-detail] dd {
  min-width: 0;
  margin: 0;
  color: var(--dsw-alias-label-secondary, inherit);
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-task-detail] [data-detail-acceptance],
[data-task-detail] [data-gate-command] {
  display: block;
  margin: 0;
  padding: 4px 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
}
[data-task-detail] [data-gate-tail] {
  max-height: 96px;
  margin: 4px 0 0;
  padding: 4px 6px;
  overflow: auto;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
}
[data-task-detail] [data-gate-exit] {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: 18px;
  margin-bottom: 4px;
  padding: 0 6px;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-task-detail] [data-gate-exit][data-exit-ok="true"] {
  color: var(--dsw-alias-state-success-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, currentColor) 45%, transparent);
}
[data-task-detail] [data-gate-exit][data-exit-ok="false"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 45%, transparent);
}
[data-task-detail] [data-gate-artifacts],
[data-task-detail] [data-gate-at] {
  display: block;
  margin-top: 4px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}

/* ── 流转图：148×56 节点、188/72 步进、画布 300px 双层滚动 ───────────────── */
[data-region="task-flow"] {
  padding: 8px 12px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-region="task-flow"] [data-flow-canvas] {
  box-sizing: border-box;
  /* r14 D4：viewport 与「重置视图」都是 position:absolute，画布本身必须成为它们的定位上下文，
     否则会锚到宿主 pane 上、浮出画布框并遮挡面板标题与页签（真机截图一眼可见的 P1）。 */
  position: relative;
  height: 300px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-base, transparent);
  cursor: grab;
  touch-action: none;
}
/* r14：画布从「滚动容器」变成「固定视口 + 可平移层」——overflow 必须 hidden（平移层会移出
   可视区，滚动条没有意义）；touch-action:none 只挂在这里，页面其余部分照常滚动。 */
[data-region="task-flow"] [data-flow-canvas]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: -2px;
}
[data-region="task-flow"] [data-flow-canvas][data-dragging="true"] {
  cursor: grabbing;
  user-select: none;
}
[data-region="task-flow"] [data-flow-viewport] {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
  transform: translate3d(0, 0, 0);
}
[data-region="task-flow"] [data-flow-canvas][data-resetting="true"] [data-flow-viewport] {
  transition: transform 180ms ease;
}
[data-region="task-flow"] [data-canvas-reset] {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  box-sizing: border-box;
  height: 28px;
  margin: 0;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  cursor: pointer;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  transition: background-color 120ms ease, color 120ms ease;
}
[data-region="task-flow"] [data-canvas-reset]:hover {
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
[data-region="task-flow"] [data-canvas-reset]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: -2px;
}
[data-region="task-flow"] [data-flow-edges] {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  pointer-events: none;
}
[data-region="task-flow"] [data-flow-edge] {
  stroke: var(--dsw-alias-border-l3, currentColor);
  stroke-width: 1;
}
[data-region="task-flow"] [data-flow-edge][data-upstream-done="false"] {
  stroke: var(--dsw-alias-label-tertiary, currentColor);
  stroke-dasharray: 4 3;
}
[data-region="task-flow"] [data-flow-edge][data-upstream-done="true"] {
  stroke: var(--dsw-alias-state-business-primary, currentColor);
}
[data-region="task-flow"] [data-flow-arrow] {
  fill: var(--dsw-alias-border-l3, currentColor);
}
[data-region="task-flow"] [data-flow-node] {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  width: 180px;
  height: 76px;
  margin: 0;
  padding: 8px 10px;
  overflow: hidden;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
[data-region="task-flow"] [data-flow-node]:hover {
  background: var(--dsw-alias-interactive-bg-hover, transparent);
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-region="task-flow"] [data-flow-node]:active {
  background: var(--dsw-alias-interactive-bg-active, transparent);
}
[data-region="task-flow"] [data-flow-node]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: 1px;
}
[data-region="task-flow"] [data-flow-line="title"] {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  min-width: 0;
}
/* r14 节点首行：状态点 + 角色名（r13 这里是任务 id） */
[data-region="task-flow"] [data-flow-node-role] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  font-weight: 600;
}
[data-region="task-flow"] [data-flow-line="task"] {
  display: block;
  min-width: 0;
  height: 16px;
}
[data-region="task-flow"] [data-flow-node-title] {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="task-flow"] [data-flow-dot] {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin: 0;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, currentColor);
}
[data-region="task-flow"] [data-flow-dot][data-tone="business"] {
  background: var(--dsw-alias-state-business-primary, currentColor);
}
[data-region="task-flow"] [data-flow-dot][data-tone="success"] {
  background: var(--dsw-alias-state-success-primary, currentColor);
}
[data-region="task-flow"] [data-flow-dot][data-tone="warn"] {
  background: var(--dsw-alias-state-warn-primary, currentColor);
}
[data-region="task-flow"] [data-flow-dot][data-tone="danger"] {
  background: var(--dsw-alias-state-error-primary, currentColor);
}
[data-region="task-flow"] [data-flow-status] {
  flex: 0 0 auto;
  overflow: hidden;
  max-width: 56px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="task-flow"] [data-flow-line="meta"] {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 16px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
  text-overflow: ellipsis;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-variant-numeric: tabular-nums;
}
[data-region="task-flow"] [data-flow-line="meta"] [data-cell="token"],
[data-region="task-flow"] [data-flow-line="meta"] [data-cell="duration"] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
[data-region="task-flow"] [data-flow-line="meta"] [data-cell="token"][data-usage-source="unavailable"],
[data-region="task-flow"] [data-flow-line="meta"] [data-cell="duration"][data-duration-state="unavailable"],
[data-region="task-flow"] [data-flow-line="meta"] [data-cell="duration"][data-duration-state="not-started"] {
  color: var(--dsw-alias-label-tertiary, inherit);
}
/* 图例是画布左下角的浮层胶囊（r14）——不占布局高度，画布高度固定 300 */
[data-region="task-flow"] [data-flow-legend] {
  position: absolute;
  left: 8px;
  bottom: 8px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  pointer-events: none;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="task-flow"] [data-flow-legend] [data-legend-line] {
  display: inline-block;
  width: 14px;
  height: 0;
  margin-right: 4px;
  border-top: 1px solid var(--dsw-alias-border-l3, currentColor);
  vertical-align: middle;
}
[data-region="task-flow"] [data-flow-legend] [data-legend-line="dashed"] {
  border-top-style: dashed;
}
[data-region="task-flow"] [data-flow-empty] {
  margin: 0;
  padding: 12px 0;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}

/* ── 记忆列表：44px 两行 + 展开正文 ──────────────────────────────────────── */
[data-memory-list] {
  list-style: none;
  margin: 0;
  padding: 0;
}
[data-memory-list] [data-memory-row] {
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-memory-list] [data-memory-row]:last-child {
  border-bottom: 0;
}
[data-memory-list] [data-auto-team-memory-item] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 8px;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  margin: 0;
  padding: 6px 12px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}
[data-memory-list] [data-auto-team-memory-item]:hover {
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
[data-memory-list] [data-auto-team-memory-item]:active {
  background: var(--dsw-alias-interactive-bg-active, transparent);
}
[data-memory-list] [data-auto-team-memory-item]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: -2px;
}
[data-memory-list] [data-memory-row][data-open="true"] {
  background: var(--dsw-alias-bg-layer-2, transparent);
  box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary, currentColor);
}
[data-memory-list] [data-memory-title] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-memory-list] [data-memory-token] {
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-variant-numeric: tabular-nums;
}
[data-memory-list] [data-memory-time] {
  grid-column: 1 / -1;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-memory-list] [data-memory-body] {
  max-height: 240px;
  margin: 0 12px 8px;
  padding: 8px 10px;
  overflow: auto;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
}
[data-memory-list] [data-memory-loading] {
  margin: 0 12px 8px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
}
[data-memory-list] [data-error],
:is([data-auto-team-library], [data-auto-team-panellist]) [data-error] {
  margin: 0 12px 8px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 12%, transparent);
  color: var(--dsw-alias-state-error-primary, currentColor);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}

/* ── 空态三段式（标题 / 说明 / 下一步） ──────────────────────────────────── */
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-empty] {
  padding: 16px 12px;
  color: var(--dsw-alias-label-secondary, inherit);
}
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-empty-title] {
  margin: 0 0 4px;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-empty-hint],
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-empty-next] {
  margin: 0 0 4px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
:is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-empty-next] {
  color: var(--dsw-alias-label-secondary, inherit);
}

/* ── 详情容器：32px 面包屑条 + 内容 ──────────────────────────────────────── */
[data-region="detail-pane"] [data-detail-bar] {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  height: 32px;
  padding: 0 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-region="detail-pane"] [data-detail-back] {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  box-sizing: border-box;
  height: 24px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-xs, 4px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  cursor: pointer;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-region="detail-pane"] [data-detail-back]:hover {
  color: var(--dsw-alias-label-primary, inherit);
  border-color: var(--dsw-alias-border-l1, currentColor);
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
[data-region="detail-pane"] [data-detail-back]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: 1px;
}
[data-region="detail-pane"] [data-detail-crumbs] {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="detail-pane"] [data-crumb][data-crumb="current"] {
  color: var(--dsw-alias-label-primary, inherit);
}
[data-region="detail-pane"] [data-crumb-sep] {
  margin: 0 4px;
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-region="detail-pane"] [data-detail-body] {
  padding: 12px 14px;
}

/* ── 左栏栏目图标：宿主面板行里的 glyph，只画 16/18px 图标 ─────────────────
 * 两次事故的最终形态（2026-11-04）：
 *  ① 早先这里渲染整块两栏项目库 → 把宿主侧栏撑变形；
 *  ② 随后改成一行 <button> 也错了 —— 宿主面板行本身就是按钮，嵌套按钮会被浏览器
 *     改写 DOM，点击不再落到宿主那行（症状：点了主界面没变化），且槽位语义本就是「图标」。
 * 现在只输出一个 svg：尺寸由宿主经 props.size 传入，颜色跟 currentColor 走。 */
[data-auto-team-panellist] {
  display: block;
  flex: 0 0 auto;
  color: inherit;
  pointer-events: none;
}

/* ── 左栏项目库：220px 项目列 + 详情列（容器查询折叠，@media 兜底） ───────── */
:is([data-auto-team-library], [data-auto-team-panellist]),
[data-auto-team-library] [data-library-shell],
[data-auto-team-panellist] [data-library-shell] {
  container-type: inline-size;
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-head] {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  height: 44px;
  padding: 0 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-sm-14, 14px/20px sans-serif);
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-body],
/* r14 AC-13：PRD 的分栏容器钩子是 [data-project-split]；两种写法共用同一套布局，
   避免 T5 的页面与既有左栏各写一份 flex 规则。 */
:is([data-auto-team-library], [data-auto-team-panellist]) [data-project-split] {
  display: flex;
  align-items: stretch;
  min-height: 0;
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-region="project-list"] {
  flex: 0 0 220px;
  box-sizing: border-box;
  max-height: 100%;
  padding: 6px;
  overflow: auto;
  border-right: 1px solid var(--dsw-alias-border-l1, currentColor);
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-auto-team-nav] {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  margin: 0 0 2px;
  padding: 0 8px;
  overflow: hidden;
  border: 0;
  border-radius: var(--dsw-radius-xs, 4px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  transition: background-color 120ms ease, color 120ms ease;
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-auto-team-nav]:hover {
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-auto-team-nav][data-active="true"] {
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-bg-layer-2, transparent);
  box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary, currentColor);
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-auto-team-nav]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: -2px;
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-region="project-detail"] {
  flex: 1 1 auto;
  min-width: 0;
  padding: 12px 14px;
  overflow: auto;
}
/* 主区宽度 ≠ 视口宽度，所以容器查询优先；@media 只是没有 container 支持时的兜底 */
@container (max-width: 719px) {
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-library-body],
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-project-split] {
    flex-direction: column;
  }
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-region="project-list"],
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-project-split] [data-region="project-list"] {
    flex: 0 0 auto;
    max-height: 168px;
    border-right: 0;
    border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  }
}
@media (max-width: 719px) {
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-library-body],
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-project-split] {
    flex-direction: column;
  }
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-region="project-list"],
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-project-split] [data-region="project-list"] {
    flex: 0 0 auto;
    max-height: 168px;
    border-right: 0;
    border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  }
}

/* ── 历史列表：右栏「历史」页与左栏项目详情共用同一套两行行 ───────────────── */
[data-region="history-list"] {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-region="history-list"] [data-history-row] {
  margin: 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-region="history-list"] [data-history-row]:last-child {
  border-bottom: 0;
}
[data-region="history-list"] [data-history-open] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  text-align: left;
  cursor: pointer;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  transition: background-color 120ms ease;
}
[data-region="history-list"] [data-history-open]:hover {
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
[data-region="history-list"] [data-history-open]:active {
  background: var(--dsw-alias-interactive-bg-active, transparent);
}
[data-region="history-list"] [data-history-open]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: -2px;
}
/* 当前详情就是这一行：左侧竖条 + 底色（与左栏项目行的选中态同一套语言） */
[data-region="history-list"] [data-history-row][data-active="true"] [data-history-open] {
  background: var(--dsw-alias-bg-layer-2, transparent);
  box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary, currentColor);
}
[data-history-line] {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
[data-history-line="title"] [data-history-title] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
}
[data-history-line="meta"] {
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-history-time] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-history-token],
[data-history-duration] {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}
/* 取不到的 token / 用时：靠虚线下划线 + secondary 与真 0 区分（数字本身一字不改） */
[data-history-token][data-usage-source="unavailable"],
[data-history-duration][data-duration-state="unavailable"],
[data-history-duration][data-duration-state="not-started"] {
  color: var(--dsw-alias-label-secondary, inherit);
  text-decoration: underline dotted;
}

/* ── 左栏项目头与记忆统计条 ─────────────────────────────────────────────── */
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-project-head] {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin: 0 0 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-project-name] {
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-sm-14, 14px/20px sans-serif);
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-project-meta],
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-project-usage] {
  color: var(--dsw-alias-label-secondary, inherit);
  /* font 简写会重置 font-variant-numeric，顺序必须是 font 在前 */
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-variant-numeric: tabular-nums;
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-project-usage] {
  margin-left: auto;
}
:is([data-auto-team-library], [data-auto-team-panellist])
  [data-library-project-usage][data-usage-source="unavailable"] {
  color: var(--dsw-alias-label-secondary, inherit);
  text-decoration: underline dotted;
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-project-path] {
  flex: 1 1 100%;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
}
[data-region="memory-tab"] [data-memory-stat] {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="memory-tab"] [data-memory-track="project"] {
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-region="memory-tab"] [data-memory-budget] {
  font-variant-numeric: tabular-nums;
}
[data-region="memory-tab"] [data-memory-budget][data-truncated="true"] {
  color: var(--dsw-alias-state-warn-primary, inherit);
}

/* ── 确认弹窗：402px、默认焦点在「取消」、按钮用动词短语 ────────────────── */
[data-confirm-overlay] {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 16px;
  background: rgb(0 0 0 / 0.32);
  backdrop-filter: blur(2px);
}
[data-confirm-overlay][data-dialog-mode="inline"] {
  position: absolute;
  inset: 0;
}
[data-confirm-dialog] {
  box-sizing: border-box;
  width: 402px;
  max-width: calc(100vw - 32px);
  padding: 20px;
  border-radius: 16px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: var(--dsw-alias-bg-layer-2, transparent);
  box-shadow: var(--dsw-shadow-lv3, none);
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-confirm-dialog][data-dialog-mode="inline"] {
  width: 100%;
  max-width: 402px;
  border-radius: var(--dsw-radius-md, 12px);
}
[data-confirm-dialog] [data-dialog-head] {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
[data-confirm-dialog] [data-dialog-title] {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-sm-14, 14px/20px sans-serif);
  font-weight: 600;
}
[data-confirm-dialog] [data-dialog-irreversible] {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 14%, transparent);
  color: var(--dsw-alias-state-error-primary, currentColor);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-confirm-dialog] [data-dialog-fields] {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 4px 8px;
  margin: 0 0 16px;
}
[data-confirm-dialog] [data-dialog-fields] dt {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-confirm-dialog] [data-dialog-fields] dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-confirm-dialog] [data-dialog-summary] {
  color: var(--dsw-alias-label-primary, inherit);
}
[data-confirm-dialog] [data-dialog-waited] {
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-confirm-dialog] [data-dialog-actions] {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
[data-confirm-dialog] [data-dialog-action] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-sizing: border-box;
  height: 28px;
  min-width: 72px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  white-space: nowrap;
  cursor: pointer;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  transition: background-color 120ms ease, border-color 120ms ease;
}
[data-confirm-dialog] [data-dialog-action]:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
[data-confirm-dialog] [data-dialog-action]:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, transparent);
}
[data-confirm-dialog] [data-dialog-action]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: 1px;
}
[data-confirm-dialog] [data-dialog-action]:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
[data-confirm-dialog] [data-dialog-action="confirm"][data-variant="danger"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 55%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 12%, transparent);
}
[data-confirm-dialog] [data-dialog-spinner] {
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-top-color: transparent;
  animation: auto-team-spin 800ms linear infinite;
}

/* ── 动效（尺寸与文案不变，只有过渡；减少动效时全部停下） ────────────────── */
@keyframes auto-team-inflight-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.8); }
}
@keyframes auto-team-detail-in {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes auto-team-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  [data-region="run-head"] [data-inflight-dot],
  [data-region="task-list"] [data-task-detail],
  [data-confirm-dialog] [data-dialog-spinner] {
    animation: none;
  }
  :is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-tab],
  :is([data-auto-team-panel], [data-auto-team-library], [data-auto-team-panellist]) [data-auto-team-nav],
  [data-region="task-list"] [data-task-row],
  [data-region="task-list"] [data-task-toggle],
  [data-region="task-flow"] [data-flow-node],
  [data-confirm-dialog] [data-dialog-action],
  [data-memory-list] [data-auto-team-memory-item] {
    transition: none;
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * r14：任务总览（进度环 + 分组列表）/ 角色卡片 / 可平移画布 / 项目库分栏与抽屉
 *
 * 位置说明：① 环与两组的数字由 viewmodel.ts 的 taskOverviewOf 单次算出（AC-11 同帧），
 * 这里只管几何；② 字号一律 font 简写（宿主 token 是复合值，写 font-size 是无效声明）；
 * ③ 颜色只用宿主 token，混合色一律 color-mix 且带 currentColor 兜底。
 * ════════════════════════════════════════════════════════════════════════════ */

/* ── ① 任务总览：64px 环列 + 12px gap + 220px 列表列（DESIGN §2.3） ───────── */
[data-task-overview] {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  box-sizing: border-box;
  padding: 8px 12px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, currentColor);
}
/* 环列 sticky：列表滚很长时环不跟着滚走，但列表列仍是普通流（不产生第二个滚动容器） */
[data-task-overview] [data-overview-ring] {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
}
[data-task-overview] [data-overview-list] {
  min-width: 0;
}
/* 220px 塞不下 r13 的「1fr 76px 84px」表头（DESIGN §2.3 的取舍）：分组模式没有表头，
   两行式行的 meta 行改成 flex 单行，token/用时靠右、角色名先让位。 */
[data-task-overview] [data-task-line="meta"] {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 16px;
  margin-top: 2px;
  overflow: hidden;
  white-space: nowrap;
}
[data-task-overview] [data-task-role] {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-task-overview] [data-task-line="meta"] [data-cell="token"],
[data-task-overview] [data-task-line="meta"] [data-cell="duration"] {
  flex: 0 0 auto;
  text-align: left;
}

/* 进度环：64×64、r=28、stroke=6、rotate(-90) 由组件属性给出，这里只管视觉 */
[data-progress-ring] {
  display: block;
  width: 64px;
  height: 64px;
  overflow: visible;
}
[data-progress-ring] [data-ring-track] {
  fill: none;
  stroke: var(--dsw-alias-border-l2, currentColor);
  stroke-width: 6;
}
[data-progress-ring] [data-ring-arc] {
  fill: none;
  stroke: var(--dsw-alias-state-business-primary, currentColor);
  stroke-width: 6;
  transition: stroke-dashoffset 240ms ease;
}
[data-progress-ring] [data-ring-arc][data-complete="true"] {
  stroke: var(--dsw-alias-state-success-primary, currentColor);
}
/* 圆内文字两档：≤5 字 13px、≥6 字 11px（999/999 必须还有 6px 余量，绝不截断数字） */
[data-progress-ring] [data-progress-text] {
  fill: var(--dsw-alias-label-primary, currentColor);
  font: var(--dsw-font-xs-13, 13px/16px sans-serif);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
[data-progress-ring] [data-progress-text][data-text-tier="long"] {
  font: var(--dsw-font-xxxs-11, 11px/14px sans-serif);
  font-weight: 600;
}

/* 分组：未完成在前、已完成在后，组头 sticky 24px（计数由 taskOverviewOf 给） */
[data-region="task-list"] [data-task-group] {
  display: block;
}
[data-region="task-list"] [data-group-head] {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 24px;
  padding: 0 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  letter-spacing: 0.02em;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="task-list"] [data-task-group="done"] [data-group-head] {
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-region="task-list"] [data-done-mark] {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  margin-right: 4px;
  color: var(--dsw-alias-state-success-primary, currentColor);
  line-height: 14px;
  text-align: center;
  font: var(--dsw-font-xxxs-11, 11px/14px sans-serif);
}
[data-region="task-list"] [data-task-group="done"] [data-task-title] {
  color: var(--dsw-alias-label-secondary, inherit);
}

/* ── ② 角色卡片：296px 内容宽 → 2 列 144px，min-height 76px（DESIGN §2.1） ── */
[data-region="task-roles"][data-role-grid-view] {
  display: block;
  padding: 8px 12px 6px;
}
/* 无角色时整块不占位（否则空网格会留一条 8px 的空白，滚动画布时像断层） */
[data-region="task-roles"][data-role-grid-view][data-empty="true"] {
  display: none;
}
[data-role-grid] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
}
/* 注意：设置页的角色编辑器也用 data-role-card，这里必须挂在 [data-role-grid] 下，
   否则会把编辑器的卡片改成只读卡的外观（r14 之前踩过串样式的坑）。 */
[data-role-grid] [data-role-card] {
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  min-width: 0;
  min-height: 76px;
  padding: 8px 10px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-1, transparent);
  transition: background-color 120ms ease, border-color 120ms ease;
}
[data-role-grid] [data-role-line="head"] {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 20px;
}
[data-role-grid] [data-role-name] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  font-weight: 600;
}
[data-role-grid] [data-role-status] {
  flex: 0 0 auto;
  box-sizing: border-box;
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-role-grid] [data-role-status][data-tone="business"] {
  color: var(--dsw-alias-state-business-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 40%, transparent);
}
[data-role-grid] [data-role-status][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 40%, transparent);
}
[data-role-grid] [data-role-status][data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 40%, transparent);
}
[data-role-grid] [data-role-status][data-tone="success"] {
  color: var(--dsw-alias-state-success-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, currentColor) 40%, transparent);
}
[data-role-grid] [data-role-active-task] {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-role-grid] [data-role-active-task][data-empty="true"] {
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-role-grid] [data-role-line="meta"] {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 16px;
  margin-top: auto;
  overflow: hidden;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
  font-variant-numeric: tabular-nums;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-role-grid] [data-role-sep] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-role-grid] [data-role-usage],
[data-role-grid] [data-role-duration] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-role-grid] [data-role-duration] {
  flex: 0 0 auto;
}
[data-role-grid] [data-role-usage][data-usage-source="unavailable"],
[data-role-grid] [data-role-duration][data-duration-state="unavailable"],
[data-role-grid] [data-role-duration][data-duration-state="not-started"] {
  color: var(--dsw-alias-label-tertiary, inherit);
  border-bottom: 1px dashed var(--dsw-alias-border-l2, currentColor);
  cursor: help;
}
[data-role-grid] [data-role-empty] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}

/* ── ③ 项目库：分栏（CSS 变量）、run 行、历史桶、右侧抽屉（T5 复用这些钩子） ── */
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-shell] {
  position: relative;
  box-sizing: border-box;
  min-height: 0;
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-body],
:is([data-auto-team-library], [data-auto-team-panellist]) [data-project-split] {
  --lib-list-w: 220px;
  position: relative;
  min-height: 0;
}
/* 左列宽度只由 --lib-list-w 决定（不用内联 flex-basis：内联会盖掉容器查询的降级规则） */
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-body] [data-region="project-list"],
:is([data-auto-team-library], [data-auto-team-panellist]) [data-project-split] [data-region="project-list"] {
  flex: 0 0 var(--lib-list-w, 220px);
  min-width: 0;
}
[data-split-handle] {
  position: relative;
  flex: 0 0 6px;
  box-sizing: border-box;
  width: 6px;
  margin: 0 -3px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: col-resize;
  touch-action: none;
}
[data-split-handle]::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: var(--dsw-alias-border-l1, currentColor);
}
[data-split-handle]:hover::before,
[data-split-handle][data-dragging="true"]::before {
  left: 1px;
  width: 2px;
  background: var(--dsw-alias-state-business-primary, currentColor);
}
[data-split-handle]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: -2px;
}
/* 容器 <560px 时左右堆叠（宿主外框宽度不可调），手柄必须消失而不是留一条拖不动的线 */
@container (max-width: 559px) {
  [data-split-handle] {
    display: none;
  }
}
[data-region="project-list"] [data-bucket] {
  margin: 0 0 4px;
}
[data-region="project-list"] [data-bucket-head] {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  height: 24px;
  padding: 0 8px;
  color: var(--dsw-alias-label-secondary, inherit);
  letter-spacing: 0.02em;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="project-list"] [data-bucket="history"] [data-bucket-head] {
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-region="project-list"] [data-bucket-list] {
  list-style: none;
  margin: 0;
  padding: 0;
}
/* 项目页 run 行：52px 两行（标题 ≤24 字 + meta），整行是 button（DESIGN §3） */
[data-region="project-detail"] [data-run-row] {
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  width: 100%;
  min-height: 52px;
  margin: 0 0 2px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}
[data-region="project-detail"] [data-run-row]:hover {
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
[data-region="project-detail"] [data-run-row][data-open="true"] {
  background: var(--dsw-alias-bg-layer-2, transparent);
  box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary, currentColor);
}
[data-region="project-detail"] [data-run-row]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: -2px;
}
[data-region="project-detail"] [data-run-title] {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  font-weight: 600;
}
[data-region="project-detail"] [data-run-title][data-title-source="fallback"] {
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-region="project-detail"] [data-run-meta] {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
  font-variant-numeric: tabular-nums;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
/* run 行第二段的状态是「状态徽标」（DESIGN §3.3），钩子由 RunRow 渲染为 [data-run-status]
   （内含图标 + 文字，状态不只靠色）。这里只补胶囊外观：16px 高、inline-flex，
   正好塞进既有 16px 的 meta 行，不撑高 52px 的 run 行；tone 只换颜色，不改字号/行高。 */
[data-region="project-detail"] [data-run-status] {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  box-sizing: border-box;
  height: 16px;
  max-width: 96px;
  padding: 0 6px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
}
[data-region="project-detail"] [data-run-status][data-tone="success"] {
  color: var(--dsw-alias-state-success-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, currentColor) 45%, transparent);
}
[data-region="project-detail"] [data-run-status][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 45%, transparent);
}
[data-region="project-detail"] [data-run-status][data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 45%, transparent);
}
[data-region="project-detail"] [data-run-status][data-tone="business"] {
  color: var(--dsw-alias-state-business-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 45%, transparent);
}
/* 抽屉：活在项目库 shell 内（absolute），背景列表不卸载（AC-16 的 scrollTop/焦点前提） */
[data-run-drawer-mask] {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: color-mix(in srgb, var(--dsw-alias-bg-base, currentColor) 55%, transparent);
  animation: auto-team-mask-in 160ms ease-out;
}
[data-run-drawer] {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 31;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(520px, 100%);
  border-left: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-md, 12px) 0 0 var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0, 0, 0, 0.18));
  animation: auto-team-drawer-in 160ms cubic-bezier(0.2, 0, 0, 1);
}
[data-run-drawer] [data-drawer-head] {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  height: 44px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-run-drawer] [data-drawer-titles] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}
[data-run-drawer] [data-drawer-title] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-sm-14, 14px/20px sans-serif);
  font-weight: 600;
}
[data-run-drawer] [data-drawer-subtitle] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-run-drawer] [data-drawer-close] {
  flex: 0 0 auto;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-xs, 4px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  cursor: pointer;
  font: var(--dsw-font-xs-13, 13px/28px sans-serif);
}
[data-run-drawer] [data-drawer-close]:hover {
  background: var(--dsw-alias-interactive-bg-hover, transparent);
  color: var(--dsw-alias-label-primary, inherit);
}
[data-run-drawer] [data-drawer-close]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: -2px;
}
[data-run-drawer] [data-drawer-body] {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 0 12px;
  overflow: auto;
}
@keyframes auto-team-drawer-in {
  from { opacity: 0; transform: translateX(16px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes auto-team-mask-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  [data-progress-ring] [data-ring-arc],
  [data-region="task-flow"] [data-flow-canvas][data-resetting="true"] [data-flow-viewport],
  [data-region="project-detail"] [data-run-row],
  [data-run-drawer],
  [data-run-drawer-mask],
  [data-role-grid] [data-role-card] {
    transition: none;
    animation: none;
  }
}
`

/** 注入一次样式（可被两个挂载面同时调用，用 id 去重）。 */
export function useAutoTeamStyle(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = AUTO_TEAM_CSS
    document.head.appendChild(style)
  }, [])
}
