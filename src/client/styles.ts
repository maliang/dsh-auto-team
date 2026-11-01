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
/* ───────────────── 输入框内胶囊（conversation.input.dock，DESIGN §0.2 / §2.1） ─────────────────
 * r7 起 composer.dock 的 32px 开关行**整段撤除**（AC-12）：入口改为输入框内的 28px 胶囊。
 * 命中区用 ::after 外扩到 44×40（视觉高度仍是 28 —— 不改布局高度，只改可点面积）。 */
[data-auto-team-option] {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: fit-content;
  max-width: min(100%, 260px);
  height: 28px;
  padding: 3px 10px;
  border-radius: 999px;
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
[data-auto-team-option] [data-option-error] {
  color: var(--dsw-alias-state-error-primary, #d33);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  min-height: 28px;
  flex-wrap: wrap;
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
[data-auto-team-role-editor] [data-role-model-hint] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
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

/* 右栏页签标题（keyed pane.tab.title）：宿主画 hover/active，这里只保证不换行不撑高 */
[data-auto-team-panel-tab] { white-space: nowrap; }
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
