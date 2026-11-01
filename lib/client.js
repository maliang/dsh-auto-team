if (typeof window !== "undefined" && window.__ModuleLoader__) window.__ModuleLoader__.load({
	id: "dsh-auto-team",
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		let react = require("react");
		react = __toESM(react, 1);
		// src/shared/const.ts
		/**
		* host 半与 client 半**共享的常量**（纯字符串/数值，零依赖、零宿主调用）。
		*
		* 为什么必须单独成文件（缺陷 D6）：`PLUGIN_ID` 同时被宿主产物（bundle patch / 插件注册）
		* 与 client 产物（slot `register` 的 id）使用，AC-2/AC-3 要求两处**逐字一致**；而 client
		* **不允许** import host 半的任何模块（会把宿主代码拖进浏览器产物）。两边各写一份字面量
		* 必然漂移，唯一可行的共享点就是本文件。
		*
		* 面板轮询间隔也放这里而不是 host/config.ts：消费方是 **client**（单 timer，`useSyncExternalStore`），
		* 定义在 host 侧等于逼客户端复制字面量 —— 正是本文件要消灭的漂移。host/config.ts 会 re-export，
		* 所以「所有魔法数字集中一处」依旧成立（单一定义、两处可见）。
		*/
		/** 插件标识：bundle patch 的 name、client 产物 slot id 前缀都用它（两产物必须逐字相同）。 */
		const PLUGIN_ID = "dsh-auto-team";
		/** 面板 HTTP 桥前缀：host/http.ts 与 client/api.ts 的一致契约（改一边必须改另一边）。 */
		const BRIDGE_ROUTE = "/api/auto-team";
		// src/client/slots.ts
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
		/** 输入框下方的开关行（非 keyed，AC-1 的可见入口）。 */
		const DOCK_SLOT = "conversation.composer.dock";
		/** 右栏「自动团队」面板页签（**keyed**）。 */
		const PANEL_SLOT = "sidebar.right.pane.tab";
		/** 上面那个页签的标题位（**keyed**，与 body 同 key，见文件头第 4 行）。 */
		const PANEL_TITLE_SLOT = "sidebar.right.pane.tab.title";
		/** 页签标识：body 与 title 共用，必须与 PLUGIN_ID 前缀一致且项目内唯一。 */
		const PANEL_KEY = `${PLUGIN_ID}-panel`;
		/**
		* `slots.register` 的 `inject`：宿主把当次 sessionId 传进来，原样交给组件
		* （组件侧 `state.ts:319 sessionIdOf` 读 `props.sessionId`）。
		* 只此一份实现 —— 开关行与面板/页签标题必须拿到同一个 sessionId。
		*/
		function sessionIdBag(sessionId) {
			return { sessionId };
		}
		/**
		* 注册全部挂载点。`deps` 只为让测试注入桩组件；生产由 `index.ts` 传真组件。
		* 挂载点不存在时 `slots.inject` 是 inert 的（回调不会被调），因此注册它零副作用。
		*/
		function registerSlots(ctx, deps) {
			ctx.slots.inject(DOCK_SLOT, () => {
				ctx.slots.register({
					name: DOCK_SLOT,
					id: `${PLUGIN_ID}-toggle`,
					order: 10,
					inject: sessionIdBag
				}, deps.Toggle);
			});
			ctx.slots.inject(PANEL_SLOT, () => {
				ctx.slots.register({
					name: PANEL_SLOT,
					key: PANEL_KEY,
					inject: sessionIdBag
				}, deps.Panel);
			});
			ctx.slots.inject(PANEL_TITLE_SLOT, () => {
				ctx.slots.register({
					name: PANEL_TITLE_SLOT,
					key: PANEL_KEY,
					inject: sessionIdBag
				}, deps.PanelTitle);
			});
		}
		// src/client/styles.ts
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
		const STYLE_ID = "dsh-auto-team-style";
		const AUTO_TEAM_CSS = `
/* ───────────────── 输入框下方开关行（conversation.composer.dock） ───────────────── */
[data-dsh-auto-team-toggle] {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width, min(calc(100% - 16px), 952px));
  min-height: 32px;
  padding: 0 var(--dsh-sidebar-inline-padding, 12px);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-dsh-auto-team-toggle] button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 2px 8px;
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), border-color 120ms var(--ds-ease-in-out, ease);
}
[data-dsh-auto-team-toggle] button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-dsh-auto-team-toggle] button:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, color-mix(in srgb, currentColor 14%, transparent));
}
[data-dsh-auto-team-toggle] button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-dsh-auto-team-toggle] button:disabled { cursor: not-allowed; opacity: 0.55; }
[data-dsh-auto-team-toggle] [data-toggle-switch] { display: inline-flex; align-items: center; gap: 6px; }
[data-dsh-auto-team-toggle] [data-toggle-control] {
  display: inline-flex;
  align-items: center;
  border: 0;
  background: transparent;
  padding: 0;
}
[data-dsh-auto-team-toggle] [data-toggle-track] {
  display: inline-flex;
  align-items: center;
  width: 28px;
  height: 16px;
  padding: 2px;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-lg, 16px);
  background: var(--dsw-alias-bg-layer-3, color-mix(in srgb, currentColor 18%, transparent));
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  transition: background-color 140ms var(--ds-ease-in-out, ease), border-color 140ms var(--ds-ease-in-out, ease);
}
[data-dsh-auto-team-toggle] [data-toggle-knob] {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, currentColor);
  transition: transform 140ms var(--ds-ease-in-out, ease), background-color 140ms var(--ds-ease-in-out, ease);
}
[data-dsh-auto-team-toggle][data-enabled="true"] [data-toggle-track] {
  background: var(--dsw-alias-state-business-primary, #2f6feb);
  border-color: var(--dsw-alias-state-business-primary, #2f6feb);
}
[data-dsh-auto-team-toggle][data-enabled="true"] [data-toggle-knob] {
  transform: translateX(12px);
  background: var(--dsw-alias-bg-base, #fff);
}
[data-dsh-auto-team-toggle] [data-toggle-label] {
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
}
[data-dsh-auto-team-toggle] [data-toggle-capsule] {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-xs, 4px);
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  white-space: nowrap;
}
[data-dsh-auto-team-toggle] [data-toggle-capsule][data-tone="idle"] { color: var(--dsw-alias-label-tertiary, inherit); }
[data-dsh-auto-team-toggle] [data-toggle-capsule][data-tone="plan"] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
  border-color: var(--dsw-alias-state-warn-primary, #b58900);
}
[data-dsh-auto-team-toggle] [data-toggle-capsule][data-tone="run"] {
  color: var(--dsw-alias-state-business-primary, #2f6feb);
  border-color: var(--dsw-alias-state-business-primary, #2f6feb);
}
[data-dsh-auto-team-toggle] [data-toggle-capsule][data-tone="fail"] {
  color: var(--dsw-alias-state-error-primary, #d33);
  border-color: var(--dsw-alias-state-error-primary, #d33);
}
[data-dsh-auto-team-toggle] [data-toggle-capsule][data-tone="done"] {
  color: var(--dsw-alias-state-success-primary, #2f9e44);
  border-color: var(--dsw-alias-state-success-primary, #2f9e44);
}
[data-dsh-auto-team-toggle] [data-error] { color: var(--dsw-alias-state-error-primary, #d33); }
[data-dsh-auto-team-toggle] [data-hint] { color: var(--dsw-alias-label-tertiary, inherit); }
@media (max-width: 360px) {
  [data-dsh-auto-team-toggle] [data-toggle-label] { display: none; }
}

/* ───────────────── 右栏面板外壳（sidebar.right.pane.tab） ───────────────── */
[data-dsh-auto-team-panel] {
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
[data-dsh-auto-team-panel] [data-panel-head] {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  flex-wrap: wrap;
}
[data-dsh-auto-team-panel] [data-head-capsule] {
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
[data-dsh-auto-team-panel] [data-head-capsule][data-tone="plan"] { color: var(--dsw-alias-state-warn-primary, #b58900); }
[data-dsh-auto-team-panel] [data-head-capsule][data-tone="run"] { color: var(--dsw-alias-state-business-primary, #2f6feb); }
[data-dsh-auto-team-panel] [data-head-capsule][data-tone="fail"] { color: var(--dsw-alias-state-error-primary, #d33); }
[data-dsh-auto-team-panel] [data-head-capsule][data-tone="done"] { color: var(--dsw-alias-state-success-primary, #2f9e44); }
[data-dsh-auto-team-panel] [data-head-meta] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-dsh-auto-team-panel] button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 2px 8px;
  cursor: pointer;
  transition: background-color 120ms var(--ds-ease-in-out, ease), border-color 120ms var(--ds-ease-in-out, ease);
}
[data-dsh-auto-team-panel] button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent));
  border-color: var(--dsw-alias-border-l3, currentColor);
}
[data-dsh-auto-team-panel] button:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, color-mix(in srgb, currentColor 14%, transparent));
}
[data-dsh-auto-team-panel] button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-dsh-auto-team-panel] button:disabled { cursor: not-allowed; opacity: 0.5; }
[data-dsh-auto-team-panel] input,
[data-dsh-auto-team-panel] select,
[data-dsh-auto-team-panel] textarea {
  font: inherit;
  color: inherit;
  background: var(--dsw-alias-bg-layer-1, transparent);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 3px 6px;
  box-sizing: border-box;
  min-width: 0;
}
[data-dsh-auto-team-panel] input:focus-visible,
[data-dsh-auto-team-panel] select:focus-visible,
[data-dsh-auto-team-panel] textarea:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2f6feb);
  outline-offset: 1px;
}
[data-dsh-auto-team-panel] [data-panel-tabs] {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, currentColor);
}
[data-dsh-auto-team-panel] [data-panel-tab] {
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 4px 8px;
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-dsh-auto-team-panel] [data-panel-tab][aria-selected="true"] {
  color: var(--dsw-alias-label-primary, inherit);
  border-bottom-color: var(--dsw-alias-state-business-primary, #2f6feb);
}
[data-dsh-auto-team-panel] [data-panel-body] { flex: 1 1 auto; overflow: auto; min-height: 0; }
[data-dsh-auto-team-panel] [data-empty] { color: var(--dsw-alias-label-tertiary, inherit); padding: 8px 0; }
[data-dsh-auto-team-panel] [data-empty] p { margin: 0 0 4px; }
[data-dsh-auto-team-panel] [data-empty-next] {
  color: var(--dsw-alias-label-secondary, inherit);
  border-left: 2px solid var(--dsw-alias-border-l3, currentColor);
  padding-left: 8px;
}
[data-dsh-auto-team-panel] [data-error] { color: var(--dsw-alias-state-error-primary, #d33); padding: 4px 0; }
[data-dsh-auto-team-panel] [data-hint] {
  color: var(--dsw-alias-state-warn-primary, #b58900);
  padding: 2px 0;
}
[data-dsh-auto-team-panel] [data-budget] {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-dsh-auto-team-panel] [data-budget][data-over="true"] { color: var(--dsw-alias-state-warn-primary, #b58900); }
[data-dsh-auto-team-panel] [data-chip] {
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
[data-auto-team-plan] [data-plan-table] { display: flex; flex-direction: column; }
[data-auto-team-plan] [data-plan-row] {
  display: grid;
  grid-template-columns: 48px minmax(80px, 1fr) 96px 64px;
  gap: 6px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-auto-team-plan] [data-plan-row] > [data-task-title] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-auto-team-plan] [data-plan-row] > [data-task-deps],
[data-auto-team-plan] [data-plan-row] > [data-task-acceptance],
[data-auto-team-plan] [data-plan-row] > [data-task-has-evidence] {
  grid-column: 1 / -1;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  overflow-wrap: anywhere;
}
[data-auto-team-plan] [data-task-id-label] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
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
[data-dsh-auto-team-panel] [data-badge-icon] {
  display: inline-block;
  width: 1em;
  text-align: center;
}
[data-dsh-auto-team-panel] [data-tone="business"] { color: var(--dsw-alias-state-business-primary, #2f6feb); }
[data-dsh-auto-team-panel] [data-tone="warn"] { color: var(--dsw-alias-state-warn-primary, #b58900); }
[data-dsh-auto-team-panel] [data-tone="danger"] { color: var(--dsw-alias-state-error-primary, #d33); }
[data-dsh-auto-team-panel] [data-tone="success"] { color: var(--dsw-alias-state-success-primary, #2f9e44); }
[data-dsh-auto-team-panel] [data-tone="neutral"] { color: var(--dsw-alias-label-tertiary, inherit); }
`;
		/** 注入一次样式（可被两个挂载面同时调用，用 id 去重）。 */
		function useAutoTeamStyle() {
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				if (document.getElementById(STYLE_ID) !== null) return;
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = AUTO_TEAM_CSS;
				document.head.appendChild(style);
			}, []);
		}
		// src/client/api.ts
		function createPanelApi(options = {}) {
			const base = (options.baseUrl ?? "").replace(/\/+$/, "");
			const doFetch = options.fetchImpl ?? (typeof fetch === "function" ? fetch.bind(globalThis) : void 0);
			/** 全项目唯一解包点：HTTP 响应 → `{ data }` / `{ error }`。 */
			async function request(path, init) {
				if (!doFetch) return { error: "当前环境没有 fetch，无法读取自动团队面板数据" };
				try {
					const response = await doFetch(`${base}${path}`, {
						...init,
						headers: {
							"content-type": "application/json",
							...init?.headers ?? {}
						}
					});
					if (!response.ok) return { error: `面板接口失败：HTTP ${response.status}` };
					let payload;
					try {
						payload = await response.json();
					} catch {
						return { error: "面板接口返回的不是合法 JSON（宿主版本可能不一致）" };
					}
					if (payload === null || typeof payload !== "object") return { error: "面板接口返回了空数据（契约不一致）" };
					const failure = payload.error;
					if (typeof failure === "string" && failure !== "") return { error: failure };
					const data = payload.data;
					if (data === void 0) return { error: "面板接口返回了空数据（契约不一致）" };
					return { data };
				} catch (error) {
					return { error: `面板接口不可达：${error instanceof Error ? error.message : String(error)}` };
				}
			}
			return {
				snapshot(sessionId) {
					return request(`${BRIDGE_ROUTE}/snapshot?sessionId=${encodeURIComponent(sessionId)}`);
				},
				act(sessionId, action) {
					return request(`${BRIDGE_ROUTE}/act`, {
						method: "POST",
						body: JSON.stringify({
							sessionId,
							action
						})
					});
				},
				readMemory(sessionId, track, name) {
					const query = `track=${encodeURIComponent(track)}&name=${encodeURIComponent(name)}&sessionId=${encodeURIComponent(sessionId)}`;
					return request(`${BRIDGE_ROUTE}/memory?${query}`);
				}
			};
		}
		/** 单例：两个挂载面（开关行与面板）必须共享同一实例，否则开关状态会两处不同步。 */
		const panelApi = createPanelApi();
		// src/client/state.ts
		/**
		* 面板状态：**模块级单例 store** + `useSyncExternalStore`。
		*
		* 为什么不再是「每个 hook 一份 useState + setInterval」（缺陷 D7 同族，TECHNICAL §7）：
		*  - 开关行（`conversation.composer.dock`）与面板（`sidebar.right.pane.tab`）各自 hook 一次，
		*    就是**两份状态 + 两个 timer**：请求翻倍，且两处显示可能不一致（"开关是开的、面板说没开"）。
		*    单例 store 让两个挂载面读同一份数据 —— ARCHITECTURE 声称的"唯一数据源"才真的成立；
		*  - 单 timer 才能按活跃度调档：有运行中任务 2s（`PANEL_ACTIVE_MS`），空闲 5s（`PANEL_IDLE_MS`），
		*    页面隐藏时**暂停**（后台不烧请求）。AC-18 的刷新预算 1500(watcher) + 2000(前端) ≤ 5000 就靠这档；
		*  - `act()` 把返回的 `snapshot` **直接写回本地 view**，不额外 refresh 一次：少一次请求，且
		*    "点了没反应"这类问题无处可藏 —— 本地 view 必须立刻变化。
		*
		* 依赖纪律：client 半**不允许** import host 半的任何模块（AC-1 零直接 import），所以轮询间隔
		* 从 `shared/const.ts` 取，不是 `host/config.ts`（旧实现在这里违反了 D6）。
		*/
		/** 有任务/成员真的在跑？（决定 2s 还是 5s，以及 AC-18 的刷新预算） */
		function isActiveSnapshot(snapshot) {
			if (snapshot === null) return true;
			const busyTask = snapshot.tasks.some((task) => task.status === "running" || task.status === "gate");
			const busyMember = snapshot.members.some((member) => member.status === "running");
			return busyTask || busyMember;
		}
		/** 结构相等（轮询拿到同一份数据时不触发重渲染；20 行不到的 JSON 比较比整面板重渲染便宜）。 */
		function sameSnapshot(a, b) {
			if (a === b) return true;
			if (a === null || b === null) return false;
			try {
				return JSON.stringify(a) === JSON.stringify(b);
			} catch {
				return false;
			}
		}
		function isHidden() {
			return typeof document !== "undefined" && document.visibilityState === "hidden";
		}
		function createPanelStore(api, options = {}) {
			const idleMs = Math.max(200, options.idleMs ?? 5e3);
			const activeMs = Math.max(200, options.activeMs ?? 2e3);
			const listeners = /* @__PURE__ */ new Set();
			let view = {
				sessionId: options.sessionId !== void 0 && options.sessionId !== "" ? options.sessionId : "current",
				snapshot: null,
				loading: true,
				error: null
			};
			const now = options.now ?? Date.now;
			let timer = null;
			let inflight = null;
			let disposed = false;
			let watchingVisibility = false;
			/** 最近一次成功拿到快照的时刻（用于"刚取过就别重复取"，React StrictMode 双挂载时不打双份请求）。 */
			let lastDataAt = Number.NEGATIVE_INFINITY;
			function intervalFor() {
				return isActiveSnapshot(view.snapshot) ? activeMs : idleMs;
			}
			/** 只在"有订阅者 + 未销毁 + 页面可见"时排下一次；三个条件任一不满足就自然暂停。 */
			function schedule(delay = intervalFor()) {
				clearTimer();
				if (disposed || listeners.size === 0 || isHidden()) return;
				timer = setTimeout(() => {
					timer = null;
					refresh();
				}, Math.max(1, delay));
			}
			function clearTimer() {
				if (timer !== null) {
					clearTimeout(timer);
					timer = null;
				}
			}
			/** 写入并在真的变化时通知订阅者（结构相等就跳过 → 轮询不制造无意义重渲染）。 */
			function setView(patch) {
				const next = {
					...view,
					...patch
				};
				if (!(next.sessionId !== view.sessionId || next.loading !== view.loading || next.error !== view.error || !sameSnapshot(next.snapshot, view.snapshot))) return;
				view = next;
				for (const listener of [...listeners]) try {
					listener();
				} catch {}
			}
			function refresh() {
				if (disposed) return Promise.resolve();
				if (inflight !== null) return inflight;
				const sessionId = view.sessionId;
				inflight = api.snapshot(sessionId).then((result) => {
					if (disposed) return;
					if (result.error !== void 0) setView({
						error: result.error,
						loading: false
					});
					else {
						lastDataAt = now();
						setView({
							snapshot: result.data ?? null,
							error: null,
							loading: false
						});
					}
				}).catch((error) => {
					if (disposed) return;
					setView({
						error: error instanceof Error ? error.message : String(error),
						loading: false
					});
				}).finally(() => {
					inflight = null;
					schedule();
				});
				return inflight;
			}
			async function act(action) {
				try {
					const result = await api.act(view.sessionId, action);
					if (disposed) return result;
					if (result.error !== void 0) {
						setView({
							error: result.error,
							loading: false
						});
						return result;
					}
					const next = result.data;
					if (next !== void 0 && next !== null && next.snapshot !== void 0) setView({
						snapshot: next.snapshot,
						error: null,
						loading: false
					});
					else setView({
						error: "面板动作返回了空快照（契约不一致）",
						loading: false
					});
					schedule();
					return result;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (!disposed) setView({
						error: message,
						loading: false
					});
					return { error: message };
				}
			}
			/** 刚取过快照？（StrictMode 双挂载 / 面板页签来回切时不要重复打请求） */
			function freshEnough() {
				if (view.snapshot === null) return false;
				return now() - lastDataAt < Math.min(activeMs, idleMs);
			}
			function onVisibilityChange() {
				if (disposed || listeners.size === 0) return;
				if (isHidden()) {
					clearTimer();
					return;
				}
				refresh();
			}
			function watchVisibility() {
				if (watchingVisibility || typeof document === "undefined" || typeof document.addEventListener !== "function") return;
				document.addEventListener("visibilitychange", onVisibilityChange);
				watchingVisibility = true;
			}
			function unwatchVisibility() {
				if (!watchingVisibility || typeof document === "undefined" || typeof document.removeEventListener !== "function") return;
				document.removeEventListener("visibilitychange", onVisibilityChange);
				watchingVisibility = false;
			}
			function revive() {
				if (!disposed) return;
				disposed = false;
				options.onRevive?.();
				watchVisibility();
				if (freshEnough()) schedule();
				else refresh();
			}
			function subscribe(listener) {
				if (typeof listener !== "function") return () => {};
				revive();
				const wasEmpty = listeners.size === 0;
				listeners.add(listener);
				if (wasEmpty) {
					watchVisibility();
					if (isHidden()) {} else if (freshEnough()) schedule();
					else refresh();
				}
				return () => {
					listeners.delete(listener);
					if (listeners.size === 0) dispose();
				};
			}
			function dispose() {
				if (disposed) return;
				disposed = true;
				clearTimer();
				unwatchVisibility();
				listeners.clear();
				options.onDispose?.();
			}
			return {
				getView() {
					return view;
				},
				subscribe,
				refresh,
				act,
				dispose
			};
		}
		/** `sessionId → store`。两个挂载面必须命中同一个 store，否则等于两份状态。 */
		const stores = /* @__PURE__ */ new Map();
		/**
		* 取（或创建）某会话的 store。
		*
		* `overrideMs` 只在该会话的 store **首次创建**时生效（单例语义：后来者沿用已有档位）；
		* 这是给测试/调试用的兼容入口，正常调用只需要 sessionId。
		*/
		function panelStoreFor(sessionId, overrideMs) {
			const key = sessionId.trim() === "" ? "current" : sessionId;
			const existing = stores.get(key);
			if (existing !== void 0) return existing;
			const store = createPanelStore(panelApi, {
				sessionId: key,
				activeMs: overrideMs?.activeMs,
				idleMs: overrideMs?.idleMs,
				onDispose: () => {
					if (stores.get(key) === store) stores.delete(key);
				},
				onRevive: () => {
					stores.set(key, store);
				}
			});
			stores.set(key, store);
			return store;
		}
		/**
		* 订阅单例 store。
		*
		* 兼容旧签名（`usePanelState(sessionId, pollMs?)`）：旧的 `pollMs` 现在映射成"两档都取这个值"，
		* 只在建店时生效 —— 现有组件（Toggle / Panel）只传一个参数，不需要改 import 或调用点。
		*/
		function usePanelState(sessionId, pollMs) {
			const store = panelStoreFor(sessionId, pollMs === void 0 ? void 0 : {
				activeMs: pollMs,
				idleMs: pollMs
			});
			return {
				...(0, react.useSyncExternalStore)(store.subscribe, store.getView, store.getView),
				refresh: store.refresh,
				act: store.act
			};
		}
		/** 从 slot props 取会话 id；宿主未提供时退回 'current'（与 host 的默认会话一致）。 */
		function sessionIdOf(props) {
			const bag = props ?? {};
			const direct = bag.sessionId;
			if (typeof direct === "string" && direct !== "") return direct;
			const session = bag.session;
			if (typeof session?.id === "string" && session.id !== "") return session.id;
			return "current";
		}
		// src/client/viewmodel.ts
		/** 成员状态（7 态）+ 任务专属态（3 个）的完整映射表 —— **全项目唯一一份**。 */
		const BADGES = {
			running: {
				icon: "●",
				text: "运行中",
				tone: "business"
			},
			idle: {
				icon: "○",
				text: "空闲",
				tone: "neutral"
			},
			blocked: {
				icon: "⛓",
				text: "阻塞",
				tone: "warn"
			},
			rework: {
				icon: "↺",
				text: "待返工",
				tone: "warn"
			},
			done: {
				icon: "✓",
				text: "已通过",
				tone: "success"
			},
			failed: {
				icon: "✕",
				text: "失败",
				tone: "danger"
			},
			interrupted: {
				icon: "⚡",
				text: "已中断",
				tone: "danger"
			},
			pending: {
				icon: "·",
				text: "待派发",
				tone: "neutral"
			},
			ready: {
				icon: "▸",
				text: "就绪",
				tone: "business"
			},
			gate: {
				icon: "⚖",
				text: "门禁中",
				tone: "warn"
			}
		};
		const UNKNOWN_BADGE = {
			icon: "?",
			text: "未知",
			tone: "neutral"
		};
		/**
		* 状态 → 徽标三元组。
		*
		* 入参故意放宽到 string：宿主侧的 4 态（running|inactive|provisioning|failed）在
		* `host/team/watcher.ts` 就被映射成 7 态了，组件拿到的永远是 7 态；放宽只是为了
		* 遇到未预期值时**显示原文而不是空白**（空白正是「界面点了没反应」的同类体验）。
		*/
		function statusBadge(status) {
			return BADGES[status] ?? {
				...UNKNOWN_BADGE,
				text: status === "" ? "未知" : status
			};
		}
		/** 各处展示「最近一次刷新/事件」用的时钟格式（本地时间，秒级 —— 对账要用到秒）。 */
		function formatClock(ts) {
			if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "—";
			const date = new Date(ts);
			const pad = (value) => value < 10 ? `0${value}` : String(value);
			return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
		}
		/** 计划时间戳（AC-30）：要能一眼看出「计划生成于派发之前」，所以带日期。 */
		function formatStamp(ts) {
			if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "—";
			const date = new Date(ts);
			const pad = (value) => value < 10 ? `0${value}` : String(value);
			return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(ts)}`;
		}
		/** 相对时间（成员「最近事件」一列）：`now` 由调用方传入，保证纯函数可测。 */
		function formatRelative(ts, now) {
			if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "—";
			const delta = Math.max(0, (Number.isFinite(now) ? now : ts) - ts);
			if (delta < 5e3) return "刚刚";
			if (delta < 6e4) return `${Math.floor(delta / 1e3)} 秒前`;
			if (delta < 36e5) return `${Math.floor(delta / 6e4)} 分钟前`;
			if (delta < 864e5) return `${Math.floor(delta / 36e5)} 小时前`;
			return `${Math.floor(delta / 864e5)} 天前`;
		}
		/** 取末尾 n 行（门禁证据只给尾部，全量在 artifacts 指向的日志里）。 */
		function tailLines(text, n) {
			if (typeof text !== "string" || text === "") return [];
			const count = Math.floor(n);
			if (!Number.isFinite(count) || count <= 0) return [];
			const lines = text.replace(/\r\n?/g, "\n").split("\n");
			while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
			return lines.slice(-count);
		}
		/** 宿主未给出并发上限时的展示兜底（与 host/config.ts 的默认值同值；client 不得 import host）。 */
		const FALLBACK_CONCURRENCY_LIMIT = 3;
		function num(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : void 0;
		}
		function str(value) {
			return typeof value === "string" ? value : "";
		}
		function routeOf(value) {
			if (value === null || typeof value !== "object") return null;
			const raw = value;
			const provider = str(raw.provider).trim();
			const model = str(raw.model).trim();
			if (provider === "" && model === "") return null;
			const route = {
				provider,
				model
			};
			const effort = raw.reasoningEffort;
			if (effort === "low" || effort === "medium" || effort === "high") route.reasoningEffort = effort;
			return route;
		}
		function messagesOf(value) {
			if (!Array.isArray(value)) return [];
			return value.map((item) => {
				const raw = item ?? {};
				const message = {
					at: num(raw.at) ?? 0,
					from: str(raw.from),
					to: str(raw.to),
					body: str(raw.body)
				};
				const toMemberId = str(raw.toMemberId);
				if (toMemberId !== "") message.toMemberId = toMemberId;
				const taskId = str(raw.taskId);
				if (taskId !== "") message.taskId = taskId;
				const messageId = str(raw.messageId);
				if (messageId !== "") message.messageId = messageId;
				return message;
			});
		}
		function routesOf(value) {
			if (!Array.isArray(value)) return [];
			return value.map((item) => {
				const raw = item ?? {};
				const verdict = raw.verdict === "ok" || raw.verdict === "drift" ? raw.verdict : "unverified";
				return {
					taskId: str(raw.taskId),
					roleId: str(raw.roleId),
					declared: routeOf(raw.declared),
					actual: routeOf(raw.actual),
					at: num(raw.at) ?? 0,
					verdict
				};
			});
		}
		function countRunning(tasks) {
			return tasks.filter((task) => task.status === "running" || task.status === "gate").length;
		}
		function concurrencyOf(value, tasks) {
			const raw = value ?? {};
			const limit = num(raw.limit);
			const running = num(raw.running);
			return {
				limit: limit !== void 0 && limit > 0 ? limit : FALLBACK_CONCURRENCY_LIMIT,
				running: running !== void 0 && running >= 0 ? running : countRunning(tasks),
				source: raw.source === "host" ? "host" : "default"
			};
		}
		/**
		* 面板快照之外的扩展字段（plannedAt / messages / routeAudits / concurrency）。
		*
		* 为什么单独投影而不是直接读字段：这几个字段是本期新增的，宿主与 client 的发布节奏
		* 可以不同步。缺字段时给空数组/兜底值，界面降级成「少一栏」而不是整页白屏。
		*/
		function viewExtras(snapshot) {
			const raw = snapshot ?? {};
			const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
			const extras = {
				messages: messagesOf(raw.messages),
				routeAudits: routesOf(raw.routeAudits),
				concurrency: concurrencyOf(raw.concurrency, tasks)
			};
			const plannedAt = num(raw.plannedAt);
			if (plannedAt !== void 0) extras.plannedAt = plannedAt;
			return extras;
		}
		/** 取某任务/角色最近一次路由审计。 */
		function routeAuditFor(audits, key) {
			let found;
			for (const audit of audits) {
				if (key.taskId !== void 0 && audit.taskId !== key.taskId) continue;
				if (key.roleId !== void 0 && audit.roleId !== key.roleId) continue;
				if (found === void 0 || audit.at >= found.at) found = audit;
			}
			return found;
		}
		/** 把 `provider/model #effort` 这样的文本解析回 structure（宿主老字段 modelRoute 是字符串）。 */
		function parseRouteText(text) {
			const raw = typeof text === "string" ? text.trim() : "";
			if (raw === "") return null;
			const [head, ...rest] = raw.split("#");
			const [provider = "", model = ""] = (head ?? "").split("/");
			const effort = rest.join("#").trim();
			const route = {
				provider: provider.trim(),
				model: model.trim()
			};
			if (effort === "low" || effort === "medium" || effort === "high") route.reasoningEffort = effort;
			if (route.provider === "" && route.model === "") return null;
			return route;
		}
		/** 路由文案：`provider/model #effort`，逐字不省略（AC-22）。 */
		function routeTextOf(route) {
			if (route === null || route === void 0) return "";
			const provider = (route.provider ?? "").trim();
			const model = (route.model ?? "").trim();
			if (provider === "" && model === "") return "";
			return `${provider}/${model}${route.reasoningEffort !== void 0 ? ` #${route.reasoningEffort}` : ""}`;
		}
		function routeVerdictLabel(audit) {
			if (audit === null || audit === void 0) return "未下发";
			if (audit.verdict === "ok") return "已核对";
			if (audit.verdict === "drift") {
				const actual = routeTextOf(audit.actual);
				return actual === "" ? "路由漂移" : `路由漂移（实际 ${actual}）`;
			}
			return "未下发";
		}
		/**
		* 逐角色模型文案（AC-22）。
		*
		* 三档口径（诚实优先于好看）：
		*  - 未配置 → `会话默认模型`；
		*  - 已配置且审计 ok → `provider/model · 已核对`；
		*  - 已配置但宿主没下发（verdict=unverified，或压根没审计过）→ 显式 `· 未下发`。
		*    **绝不静默退回队长模型** —— 用户必须知道这一条没生效。
		*/
		function formatModelRoute(route, audit) {
			const base = routeTextOf(route);
			if (base === "") return "会话默认模型";
			return `${base} · ${routeVerdictLabel(audit)}`;
		}
		/** 成员行上的路由文案：优先用宿主新给的 route 对象，否则解析老的 modelRoute 字符串。 */
		function memberRouteText(member, audits = []) {
			const explicit = member.model;
			const declared = routeOf(explicit) ?? parseRouteText(member.modelRoute);
			const audit = routeAuditFor(audits, {
				taskId: member.taskId,
				roleId: member.roleId
			});
			if (declared === null) {
				const raw = typeof member.modelRoute === "string" ? member.modelRoute.trim() : "";
				if (raw === "") return "会话默认模型";
				return `${raw} · ${routeVerdictLabel(audit)}`;
			}
			return formatModelRoute(declared, audit);
		}
		/**
		* 停滞短标签（TECHNICAL §5.1 冻结的文案，逐字）。
		*
		* 面板正文用的是更好读、且写明「成员还活着」的整句（`STALL_LEAD` + 秒数 + `STALL_TAIL`，
		* 逐字来自 DESIGN §7.5）；这句只作为停滞条的悬停说明，交代判定口径是「无实质工具调用」，
		* 而不是「成员已退出」——`interrupted` 才是那个意思。
		*/
		const STALL_SUFFIX = "无实质工具调用，疑似停滞";
		/** 停滞整句的前半段（不含秒数，秒数由渲染处用宿主下发的文本插入）。 */
		const STALL_LEAD = "疑似停滞 · 成员还活着，但已";
		/** 停滞整句的后半段。 */
		const STALL_TAIL = "没有实质产出";
		/**
		* 成员行停滞条（AC-12 / AC-14）。
		*
		* 判定只用宿主下发的 `stalled`，**不看 `stalledForMs > 0`**——阈值只有一个出口（watcher），
		* 客户端再有第二个比较就等于把判定分叉。`interrupted` / `failed` 永不渲染停滞条：
		* 那两种是「已经出事」，与「活着但没产出」是两回事（PRD 反面目标 4）。
		*/
		function stalledRowOf(member) {
			const stalled = member.stalled === true;
			if (member.status !== "running" || !stalled) return {
				show: false,
				secondsText: "",
				text: ""
			};
			const raw = typeof member.stalledSecondsText === "string" ? member.stalledSecondsText.trim() : "";
			const secondsText = raw === "" ? "—" : raw;
			return {
				show: true,
				secondsText,
				text: `⏳ ${STALL_LEAD} ${secondsText} ${STALL_TAIL}`
			};
		}
		/** 账本 `from` 的显示名：captain→队长、peer→上游直投，其余（成员名）原样。 */
		const PEER_LABELS = {
			captain: "队长",
			peer: "上游直投"
		};
		function peerLabelOf(from) {
			const raw = typeof from === "string" ? from.trim() : "";
			return PEER_LABELS[raw] ?? raw;
		}
		/**
		* 账本正文是否需要折叠（AC-14 的可见侧：直投 body 最长 800 字，整段平铺会把账本撑爆）。
		*
		* 阈值是「字符数 > 120 或 行数 > 3」而不是纯行数：peer body 有 `white-space: pre-wrap`
		* 的多行结构，也可能是一行超长路径。
		*/
		function ledgerBodyFoldable(body) {
			const text = typeof body === "string" ? body : "";
			return text.length > 120 || text.split("\n").length > 3;
		}
		/**
		* dock 胶囊文案（DESIGN §2 的 5 种 tone）。
		*
		* 优先级有意如此：失败 > 中断 > 在跑 > 全绿 > 计划就绪 —— 用户最需要「坏消息」先冒头。
		*/
		function capsuleOf(enabled, snapshot) {
			if (!enabled) return {
				tone: "idle",
				text: "已关闭"
			};
			if (snapshot === null || snapshot === void 0) return {
				tone: "idle",
				text: "待派发"
			};
			const tasks = snapshot.tasks ?? [];
			const members = snapshot.members ?? [];
			const extras = viewExtras(snapshot);
			const failed = tasks.filter((task) => task.status === "failed").length;
			const interrupted = members.filter((member) => member.status === "interrupted").length;
			const running = countRunning(tasks);
			const done = tasks.filter((task) => task.status === "done").length;
			const limit = extras.concurrency.limit;
			if (snapshot.planStatus === "cancelled") return {
				tone: "idle",
				text: "已取消"
			};
			if (snapshot.planStatus === "terminated") return {
				tone: "idle",
				text: "已终止"
			};
			if (snapshot.planStatus === "paused") return {
				tone: "idle",
				text: "已暂停"
			};
			if (failed > 0) return {
				tone: "fail",
				text: `有失败 · ${failed}`
			};
			if (interrupted > 0) return {
				tone: "fail",
				text: `已中断 · ${interrupted}`
			};
			if (running > 0) return {
				tone: "run",
				text: `运行中 ${running}/${limit}`
			};
			if (tasks.length > 0 && done === tasks.length) return {
				tone: "done",
				text: `已完成 · ${tasks.length} 任务`
			};
			if (tasks.length > 0 && members.length === 0) return {
				tone: "plan",
				text: `计划就绪 · ${tasks.length} 任务`
			};
			if (members.length === 0) return {
				tone: "idle",
				text: "待派发"
			};
			if (snapshot.planStatus === "dispatching") return {
				tone: "run",
				text: `派发中 · ${members.length}/${limit}`
			};
			return {
				tone: "idle",
				text: `进行中 · ${done}/${tasks.length}`
			};
		}
		/**
		* 把 act() 的返回**解一次包**（唯一解包口，组件里不许再解）。
		*
		* 兼容三种历史形态：
		*   { error }                                  —— 传输/校验失败
		*   { data: { snapshot, rejected, notices } }   —— 本期 ActResult 包装
		*   { data: PanelSnapshot }                     —— 脚手架期直接返回快照
		*/
		function feedbackOf(result) {
			if (result === null || result === void 0) return {
				ok: true,
				notices: []
			};
			const box = result;
			const transportError = str(box.error);
			if (transportError !== "") return {
				ok: false,
				message: transportError,
				notices: []
			};
			const payload = box.data ?? box;
			if (payload === null || typeof payload !== "object") return {
				ok: true,
				notices: []
			};
			const notices = Array.isArray(payload.notices) ? payload.notices.filter((item) => typeof item === "string") : [];
			const rejected = payload.rejected;
			if (rejected !== void 0 && rejected !== null && typeof rejected === "object") {
				const message = str(rejected.message).trim();
				const code = str(rejected.code).trim();
				return {
					ok: false,
					message: message !== "" ? message : code !== "" ? code : "动作被拒绝",
					notices
				};
			}
			return {
				ok: true,
				notices
			};
		}
		/** 错误的展示文案（空字符串一律换成一句能读懂的话，避免「点了没反应」）。 */
		function hintOf(feedback) {
			if (feedback.ok) return feedback.notices.length > 0 ? feedback.notices.join(" · ") : void 0;
			const message = (feedback.message ?? "").trim();
			return message === "" ? "动作未生效（宿主未说明原因）" : message;
		}
		/**
		* 发一个动作并**保证**拿到一句能给用户看的话。
		*
		* 为什么要包一层：`act` 可能 reject（宿主路由未注册、网络中断、宿主侧抛异常）。
		* 直接 `await act(...)` 而不 try/catch 的后果是按钮永远停在 busy 态且界面毫无反应 ——
		* 这正是本项目历史上「点了没反应」那一族 bug 的成因之一，所以在客户端唯一入口处兜住。
		*/
		async function actFeedback(act, action) {
			try {
				return feedbackOf(await act(action));
			} catch (err) {
				return {
					ok: false,
					message: err instanceof Error ? err.message : String(err),
					notices: []
				};
			}
		}
		/**
		* 快照 → 「最近推进」行（**最新在前**）。
		*
		* 只读 `activity`，不读 `triggers`：`activity` 是面板既有数据源，`triggers` 是排查用的原始账本
		* （含 dropped）。两条都渲染会出现「同一次推进显示两遍」，也会让面板看起来在讲内部实现。
		*
		* 只取**带 `source`** 的事件：缺省 = 历史事件（老数据没有来源，不能倒推成自动，
		* 那会把用户自己点出来的动作说成「系统自动推进」）。
		*/
		function recentTriggersOf(snapshot, limit = 3) {
			const activity = Array.isArray(snapshot?.activity) ? snapshot.activity : [];
			const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3;
			if (count === 0) return [];
			const rows = [];
			for (let index = activity.length - 1; index >= 0 && rows.length < count; index -= 1) {
				const event = activity[index];
				if (event === void 0 || event === null || typeof event !== "object") continue;
				const source = event.source;
				if (source !== "trigger" && source !== "user") continue;
				const text = str(event.text).trim();
				if (text === "") continue;
				rows.push({
					at: typeof event.at === "number" ? event.at : 0,
					clock: formatClock(event.at),
					text,
					sourceLabel: source === "trigger" ? "自动" : "用户",
					kind: str(event.kind) === "" ? "status" : str(event.kind)
				});
			}
			return rows;
		}
		/**
		* 队长模型 → 头部一行标签。
		*
		* 三态语义（与 `CaptainModelView.source` 一一对应，不在这里重新推断）：
		*  - `configured`：宿主已按配置指定了主 session 模型 → 展示具体路由，tone=ok；
		*  - `host-default`：没有队长专用配置，跟随宿主默认 → tone=muted（不是错，但也不是「生效」）；
		*  - `unsupported`：宿主给主 session 指定模型的能力未验证/不可用 → tone=warn，文案必须说「未生效」。
		*/
		function captainModelLabelOf(view) {
			if (view === null || view === void 0 || typeof view !== "object") return {
				label: "队长模型 · 未投影",
				tone: "muted"
			};
			const value = str(view.value).trim();
			if (view.source === "configured") return {
				label: `队长模型 ${value !== "" ? value : "已配置"}`,
				tone: "ok"
			};
			if (view.source === "host-default") return {
				label: "队长模型 跟随宿主默认",
				tone: "muted"
			};
			return {
				label: "队长模型 宿主不支持 · 未生效",
				tone: "warn"
			};
		}
		// src/client/Toggle.tsx
		/**
		* 输入框下方 32px 开关行（conversation.composer.dock）。
		*
		* 设计约束（DESIGN §2 / AC-12）：
		*  - 这是**开关状态的唯一来源**，面板只展示与提供入口，不再各自存一份 enabled；
		*  - 开关只改「启用/停用」，**绝不派发**（反目标 1：点开关不等于把任务扔出去）；
		*  - 文案来自 `viewmodel.capsuleOf`（单向：viewmodel 出文案，本组件只渲染）；
		*  - 最坏文案（`计划就绪 · 5 任务`）306px ≤ 320px；宽度 <360px 时隐藏文字（见 styles.ts）。
		*/
		/** 面板入口事件：右栏面板订阅它并切到「计划」页（TECHNICAL §6）。 */
		const OPEN_PANEL_EVENT = "dsh-auto-team:open-panel";
		function Toggle(props) {
			useAutoTeamStyle();
			const view = usePanelState(sessionIdOf(props));
			const snapshot = view.snapshot ?? void 0;
			const enabled = snapshot?.enabled === true;
			const capsule = capsuleOf(enabled, snapshot);
			const [busy, setBusy] = react.useState(false);
			const [hint, setHint] = react.useState(void 0);
			async function toggle() {
				setBusy(true);
				setHint(void 0);
				try {
					const result = await view.act({
						type: "toggle",
						enabled: !enabled
					});
					setHint(hintOf(feedbackOf(result)));
				} catch (err) {
					setHint(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			}
			function openPanel() {
				if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT));
			}
			const error = view.error ?? void 0;
			const disabled = busy || view.loading && snapshot === void 0;
			return /* @__PURE__ */ react.createElement("div", {
				"data-dsh-auto-team-toggle": true,
				"data-enabled": enabled ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("span", { "data-toggle-switch": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				role: "switch",
				onClick: () => void toggle(),
				disabled,
				"data-toggle-control": true,
				"aria-checked": enabled,
				"aria-label": enabled ? "关闭自动团队" : "启用自动团队",
				title: enabled ? "关闭自动团队（只改开关，不会派发任务）" : "启用自动团队"
			}, /* @__PURE__ */ react.createElement("span", {
				"data-toggle-track": true,
				"aria-hidden": "true"
			}, /* @__PURE__ */ react.createElement("span", { "data-toggle-knob": true }))), /* @__PURE__ */ react.createElement("span", { "data-toggle-label": true }, "自动团队")), /* @__PURE__ */ react.createElement("span", {
				"data-toggle-capsule": true,
				"data-tone": capsule.tone,
				"aria-live": "polite"
			}, capsule.text), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				onClick: openPanel,
				"data-toggle-open-panel": true
			}, "面板"), error !== void 0 ? /* @__PURE__ */ react.createElement("span", {
				"data-error": true,
				role: "alert"
			}, error) : null, hint !== void 0 ? /* @__PURE__ */ react.createElement("span", {
				"data-hint": true,
				role: "status"
			}, hint) : null);
		}
		// src/client/tabs/PlanTab.tsx
		/**
		* 计划页：任务 / 依赖 / 角色（可替换）/ 判定口径 / 预计并发；「开始派发」是唯一的成员创建入口（AC-30）。
		*
		* 三个可核验点都在这里：
		*  - **计划时间戳**：派发前就在，给 AC-30「计划条目早于首个成员创建」留证据；
		*  - **并发三元组**：运行中 / 上限 / 来源（host 或默认），让用户知道并发是宿主给的还是兜底值；
		*  - **角色下拉**：派发前逐任务替换角色（AC-14），一旦任务开跑就禁用（改也改不动）。
		*/
		/** 任务未开跑时才允许换角色（AC-14 的窗口期）。 */
		function roleEditable(task) {
			return task.status === "pending" || task.status === "blocked" || task.status === "ready";
		}
		function PlanTab(props) {
			const { snapshot, act } = props;
			const [busy, setBusy] = react.useState(false);
			const [hint, setHint] = react.useState(void 0);
			const runId = snapshot?.runId;
			const tasks = snapshot?.tasks ?? [];
			const roles = snapshot?.roles ?? [];
			const extras = viewExtras(snapshot);
			async function dispatch() {
				setBusy(true);
				setHint(void 0);
				const feedback = await actFeedback(act, {
					type: "dispatch",
					runId
				});
				setBusy(false);
				setHint(hintOf(feedback));
			}
			async function cancel() {
				setBusy(true);
				setHint(void 0);
				const feedback = await actFeedback(act, { type: "cancel" });
				setBusy(false);
				setHint(hintOf(feedback));
			}
			async function changeRole(taskId, roleId) {
				const feedback = await actFeedback(act, {
					type: "setTaskRole",
					taskId,
					roleId
				});
				setHint(hintOf(feedback));
			}
			if (runId === void 0 || runId === "") return /* @__PURE__ */ react.createElement("div", {
				"data-auto-team-plan": true,
				"data-empty": true
			}, /* @__PURE__ */ react.createElement("p", null, "还没有执行计划。"), /* @__PURE__ */ react.createElement("p", { "data-empty-next": true }, "下一步：让队长在当前会话里说清目标，它会用 ", /* @__PURE__ */ react.createElement("code", null, "auto_team_plan"), " 拆出任务图 —— 计划会先出现在这里，**此时不会创建任何成员**，确认无误后再点「开始派发」。"));
			const dispatching = snapshot?.planStatus === "dispatching";
			const done = tasks.filter((task) => task.status === "done").length;
			const triggers = recentTriggersOf(snapshot);
			return /* @__PURE__ */ react.createElement("div", {
				"data-auto-team-plan": true,
				"data-run-id": runId,
				"data-plan-status": snapshot?.planStatus
			}, triggers.length > 0 ? /* @__PURE__ */ react.createElement("section", {
				"data-plan-triggers": true,
				"data-trigger-count": triggers.length
			}, /* @__PURE__ */ react.createElement("div", { "data-plan-meta-row": true }, /* @__PURE__ */ react.createElement("span", { "data-plan-triggers-label": true }, "最近推进"), /* @__PURE__ */ react.createElement("span", { "data-plan-triggers-hint": true }, "自动 = 系统按事件推进，用户 = 你的动作")), triggers.map((row, index) => /* @__PURE__ */ react.createElement("div", {
				key: `${row.at}-${index}-${row.kind}`,
				"data-plan-meta-row": true,
				"data-auto-team-trigger": row.kind,
				"data-trigger-source": row.sourceLabel === "自动" ? "trigger" : "user"
			}, /* @__PURE__ */ react.createElement("span", {
				"data-trigger-badge": true,
				"data-tone": row.sourceLabel === "自动" ? "business" : "neutral"
			}, row.sourceLabel), /* @__PURE__ */ react.createElement("span", { "data-trigger-clock": true }, row.clock), /* @__PURE__ */ react.createElement("span", { "data-trigger-text": true }, row.text)))) : null, /* @__PURE__ */ react.createElement("div", { "data-plan-meta-row": true }, /* @__PURE__ */ react.createElement("span", {
				"data-plan-planned-at": true,
				title: formatStamp(extras.plannedAt)
			}, "计划时间 ", formatStamp(extras.plannedAt)), /* @__PURE__ */ react.createElement("span", { "data-plan-run-id": true }, "run ", runId), /* @__PURE__ */ react.createElement("span", { "data-plan-status-label": true }, "状态 ", snapshot?.planStatus ?? "—")), /* @__PURE__ */ react.createElement("div", {
				"data-plan-concurrency": true,
				"data-concurrency-source": extras.concurrency.source
			}, /* @__PURE__ */ react.createElement("span", { "data-concurrency-running": true }, "运行中 ", extras.concurrency.running), /* @__PURE__ */ react.createElement("span", { "data-concurrency-sep": true }, "/"), /* @__PURE__ */ react.createElement("span", { "data-concurrency-limit": true }, "上限 ", extras.concurrency.limit), /* @__PURE__ */ react.createElement("span", { "data-concurrency-source-label": true }, "来源 ", extras.concurrency.source === "host" ? "宿主" : "默认值"), /* @__PURE__ */ react.createElement("span", { "data-concurrency-done": true }, "进度 ", done, "/", tasks.length)), /* @__PURE__ */ react.createElement("div", { "data-plan-actions": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				onClick: () => void dispatch(),
				disabled: busy || dispatching,
				"data-plan-dispatch": true,
				title: dispatching ? "已派发，等待成员创建完成" : "按任务图创建成员并并行执行"
			}, dispatching ? "派发中…" : "开始派发"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				onClick: () => void cancel(),
				disabled: busy,
				"data-plan-cancel": true
			}, "取消运行"), /* @__PURE__ */ react.createElement("span", { "data-plan-members": true }, "成员 ", snapshot?.members.length ?? 0)), hint !== void 0 ? /* @__PURE__ */ react.createElement("div", {
				"data-hint": true,
				role: "status"
			}, hint) : null, tasks.length === 0 ? /* @__PURE__ */ react.createElement("div", {
				"data-empty": true,
				"data-empty-next": true
			}, "计划里还没有任务，让队长补充拆解后再派发。") : /* @__PURE__ */ react.createElement("div", { "data-plan-table": true }, tasks.map((task) => {
				const badge = statusBadge(task.status);
				const editable = roleEditable(task);
				return /* @__PURE__ */ react.createElement("div", {
					key: task.id,
					"data-plan-row": true,
					"data-task-id": task.id,
					"data-status": task.status
				}, /* @__PURE__ */ react.createElement("span", { "data-task-id-label": true }, task.id), /* @__PURE__ */ react.createElement("span", {
					"data-task-title": true,
					title: task.title
				}, task.title), /* @__PURE__ */ react.createElement("select", {
					"data-task-role": true,
					"data-role-value": task.roleId,
					value: task.roleId,
					disabled: !editable,
					title: editable ? "派发前可替换执行角色" : "任务已开跑，不能再换角色",
					onChange: (event) => void changeRole(task.id, event.target.value)
				}, roles.every((role) => role.id !== task.roleId) ? /* @__PURE__ */ react.createElement("option", { value: task.roleId }, task.roleId, "（已不在角色库）") : null, roles.map((role) => /* @__PURE__ */ react.createElement("option", {
					key: role.id,
					value: role.id
				}, role.name))), /* @__PURE__ */ react.createElement("span", {
					"data-task-status-badge": true,
					"data-tone": badge.tone,
					"data-status": task.status
				}, /* @__PURE__ */ react.createElement("span", {
					"data-badge-icon": true,
					"aria-hidden": "true"
				}, badge.icon), badge.text), task.dependsOn.length > 0 ? /* @__PURE__ */ react.createElement("span", { "data-task-deps": true }, "依赖 ", task.dependsOn.join("、")) : null, task.acceptance !== "" ? /* @__PURE__ */ react.createElement("span", {
					"data-task-acceptance": true,
					title: task.acceptance
				}, "判定 ", task.acceptance) : null, task.evidence !== void 0 ? /* @__PURE__ */ react.createElement("span", {
					"data-task-has-evidence": true,
					"data-exit-code": task.evidence.exitCode
				}, "证据已就位（退出码 ", task.evidence.exitCode, "）") : null);
			})));
		}
		// src/client/tabs/MembersTab.tsx
		/**
		* 成员页：角色 / 任务 / 状态 / 最近事件 / **实际模型路由**（AC-22 逐字）+ 回执 + 消息账本。
		*
		* 为什么三样东西放在同一页（TECHNICAL §6）：
		*   状态、实际模型、证据、直达消息都属于「某个成员」，分页放会让用户来回跳着对账；
		*   AC-16（消息可核验）、AC-18（成员已死但面板说运行中）、AC-19（回执与门禁证据）
		*   全部要靠这一页的同一行来读。
		*/
		function MembersTab(props) {
			const { snapshot, act } = props;
			const [draft, setDraft] = react.useState({});
			const [note, setNote] = react.useState({});
			const [openEvidence, setOpenEvidence] = react.useState(void 0);
			const [hint, setHint] = react.useState(void 0);
			/**
			* 账本正文展开态：唯一新增的本地 state，键为 `messageId ?? at-index`。
			*
			* 只活在面板内存里——不写宿主、不新增 PanelAction。宿主每 2000ms 推新快照，
			* 存到服务端反而会让「展开」变成一条需要落盘、需要审计的用户动作。
			*/
			const [expanded, setExpanded] = react.useState({});
			const members = snapshot?.members ?? [];
			const tasks = snapshot?.tasks ?? [];
			const extras = viewExtras(snapshot);
			const now = Date.now();
			if (members.length === 0) return /* @__PURE__ */ react.createElement("div", {
				"data-auto-team-members": true,
				"data-empty": true
			}, /* @__PURE__ */ react.createElement("p", null, "还没有成员。"), /* @__PURE__ */ react.createElement("p", { "data-empty-next": true }, "下一步：去「计划」页确认任务图与角色，点「开始派发」后成员会出现在这里 —— 可继续（中断后续聊）、可发直达消息、可通过回执把结果交给门禁。"));
			async function send(memberId) {
				const text = (draft[memberId] ?? "").trim();
				if (text === "") return;
				const feedback = await actFeedback(act, {
					type: "message",
					memberId,
					text
				});
				setHint(hintOf(feedback));
				if (feedback.ok) setDraft((current) => ({
					...current,
					[memberId]: ""
				}));
			}
			async function receipt(taskId, memberId) {
				const text = (note[memberId] ?? "").trim();
				const feedback = await actFeedback(act, text === "" ? {
					type: "receipt",
					taskId
				} : {
					type: "receipt",
					taskId,
					note: text
				});
				setHint(hintOf(feedback));
				if (feedback.ok) setNote((current) => ({
					...current,
					[memberId]: ""
				}));
			}
			return /* @__PURE__ */ react.createElement("div", { "data-auto-team-members": true }, hint !== void 0 ? /* @__PURE__ */ react.createElement("div", {
				"data-hint": true,
				role: "status"
			}, hint) : null, members.map((member) => {
				const evidence = tasks.find((item) => item.id === member.taskId)?.evidence;
				const badge = statusBadge(member.status);
				const route = memberRouteText(member, extras.routeAudits);
				const lastEvent = member.lastEventAt;
				const stall = stalledRowOf(member);
				return /* @__PURE__ */ react.createElement("div", {
					key: member.memberId,
					"data-auto-team-member": true,
					"data-member-id": member.memberId,
					"data-status": member.status,
					"data-stalled": stall.show ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("span", {
					"data-member-name": true,
					title: member.name
				}, member.name), /* @__PURE__ */ react.createElement("span", { "data-member-task": true }, member.taskId ?? "—"), /* @__PURE__ */ react.createElement("span", {
					"data-status": true,
					"data-tone": badge.tone
				}, /* @__PURE__ */ react.createElement("span", {
					"data-badge-icon": true,
					"aria-hidden": "true"
				}, badge.icon), badge.text), /* @__PURE__ */ react.createElement("span", {
					"data-member-last-event": true,
					title: formatClock(lastEvent)
				}, formatRelative(lastEvent, now)), /* @__PURE__ */ react.createElement("span", {
					"data-model-route": true,
					"data-model-route-value": route
				}, route), stall.show ? /* @__PURE__ */ react.createElement("span", {
					"data-member-stall": true,
					role: "status",
					"data-stalled-for": member.stalledForMs,
					title: STALL_SUFFIX
				}, /* @__PURE__ */ react.createElement("span", {
					"data-stall-icon": true,
					"aria-hidden": "true"
				}, "⏳"), /* @__PURE__ */ react.createElement("span", { "data-stall-lead": true }, STALL_LEAD), " ", /* @__PURE__ */ react.createElement("span", { "data-stall-seconds": true }, stall.secondsText), " ", /* @__PURE__ */ react.createElement("span", { "data-stall-tail": true }, STALL_TAIL)) : null, /* @__PURE__ */ react.createElement("span", { "data-member-actions": true }, /* @__PURE__ */ react.createElement("input", {
					"data-member-receipt-note": true,
					value: note[member.memberId] ?? "",
					placeholder: "回执备注（可选）",
					onChange: (event) => setNote((current) => ({
						...current,
						[member.memberId]: event.target.value
					}))
				}), /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-member-receipt": true,
					"data-task-id": member.taskId ?? "",
					disabled: member.taskId === void 0 || member.taskId === "",
					title: "成员报告已完成：宿主据此跑门禁并落证据（AC-19）",
					onClick: () => void receipt(member.taskId ?? "", member.memberId)
				}, "回执"), /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-member-resume": true,
					disabled: !member.canResume,
					title: member.canResume ? "在同一成员上下文里继续，不新建成员" : "该成员当前不需要续聊",
					onClick: () => void act({
						type: "resume",
						memberId: member.memberId
					})
				}, "继续"), evidence !== void 0 ? /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-member-evidence": true,
					"aria-expanded": openEvidence === member.taskId,
					onClick: () => setOpenEvidence((current) => current === member.taskId ? void 0 : member.taskId)
				}, "证据") : null), /* @__PURE__ */ react.createElement("span", { "data-member-message-row": true }, /* @__PURE__ */ react.createElement("input", {
					"data-member-message": true,
					value: draft[member.memberId] ?? "",
					placeholder: "发直达消息…",
					onChange: (event) => setDraft((current) => ({
						...current,
						[member.memberId]: event.target.value
					})),
					onKeyDown: (event) => {
						if (event.key === "Enter") send(member.memberId);
					}
				}), /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-member-send": true,
					onClick: () => void send(member.memberId)
				}, "发送")), evidence !== void 0 && openEvidence === member.taskId ? /* @__PURE__ */ react.createElement("div", {
					"data-evidence-drawer": true,
					"data-task-id": evidence.taskId
				}, /* @__PURE__ */ react.createElement("div", { "data-evidence-line": true }, /* @__PURE__ */ react.createElement("span", { "data-evidence-label": true }, "命令"), /* @__PURE__ */ react.createElement("code", { "data-evidence-command": true }, evidence.command)), /* @__PURE__ */ react.createElement("div", { "data-evidence-line": true }, /* @__PURE__ */ react.createElement("span", { "data-evidence-label": true }, "退出码"), /* @__PURE__ */ react.createElement("code", {
					"data-evidence-exit": true,
					"data-exit-code": evidence.exitCode
				}, evidence.exitCode)), /* @__PURE__ */ react.createElement("div", { "data-evidence-line": true }, /* @__PURE__ */ react.createElement("span", { "data-evidence-label": true }, "产物"), /* @__PURE__ */ react.createElement("code", { "data-evidence-artifacts": true }, evidence.artifacts.length > 0 ? evidence.artifacts.join("、") : "（无）")), /* @__PURE__ */ react.createElement("div", { "data-evidence-line": true }, /* @__PURE__ */ react.createElement("span", { "data-evidence-label": true }, "时间"), /* @__PURE__ */ react.createElement("code", null, formatClock(evidence.at))), /* @__PURE__ */ react.createElement("pre", { "data-evidence-tail": true }, tailLines(evidence.tail, 40).join("\n") || "（无输出）")) : null);
			}), /* @__PURE__ */ react.createElement("div", {
				"data-message-ledger": true,
				"data-count": extras.messages.length
			}, /* @__PURE__ */ react.createElement("div", { "data-ledger-head": true }, /* @__PURE__ */ react.createElement("strong", null, "直达消息"), /* @__PURE__ */ react.createElement("span", { "data-ledger-meta": true }, "共 ", extras.messages.length, " 条（上限 200，超出丢最旧）")), extras.messages.length === 0 ? /* @__PURE__ */ react.createElement("div", { "data-empty": true }, "还没有消息。队长派发、成员回执、上游任务的门禁证据直投都会记在这里。") : /* @__PURE__ */ react.createElement("ol", { "data-ledger-list": true }, extras.messages.map((message, index) => {
				const key = message.messageId ?? `${message.at}-${index}`;
				const foldable = ledgerBodyFoldable(message.body);
				const isOpen = expanded[key] === true;
				return /* @__PURE__ */ react.createElement("li", {
					key,
					"data-message": true,
					"data-from": message.from,
					"data-to": message.to,
					"data-task-id": message.taskId ?? "",
					"data-at": message.at,
					"data-message-expanded": foldable ? isOpen ? "true" : "false" : void 0
				}, /* @__PURE__ */ react.createElement("span", { "data-message-route": true }, peerLabelOf(message.from), " → ", message.to), message.taskId !== void 0 ? /* @__PURE__ */ react.createElement("span", { "data-message-task": true }, message.taskId) : null, /* @__PURE__ */ react.createElement("time", {
					"data-message-at": true,
					dateTime: new Date(message.at).toISOString()
				}, formatClock(message.at)), foldable ? /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-message-toggle": true,
					"aria-expanded": isOpen,
					title: isOpen ? "收起正文" : "展开完整正文",
					onClick: () => setExpanded((current) => ({
						...current,
						[key]: !isOpen
					}))
				}, isOpen ? "收起" : "展开") : null, /* @__PURE__ */ react.createElement("span", { "data-message-body": true }, message.body));
			}))));
		}
		// src/client/tabs/MemoryTab.tsx
		/**
		* 记忆页：公共 / 项目双轨 md，可读、可改、可删（AC-24 / AC-25）。
		*
		* 本页最重要的一条纪律（D7）：**点条目必须先读正文再进编辑器**。
		* 旧实现是「点条目只填文件名」，用户看着空编辑器直接保存 → 把已有记忆整条清空。
		* 所以这里的顺序是：选中 → `readMemory` 拉正文 → 才允许编辑；正文没读到就禁止保存。
		*
		* 预算行「预计注入 N / 4000 字符」是用户唯一能感知「为什么成员没读到某条记忆」的地方，不能省。
		*/
		function MemoryTab(props) {
			const { snapshot, act, readMemory } = props;
			const [track, setTrack] = react.useState("project");
			const [name, setName] = react.useState("");
			const [body, setBody] = react.useState("");
			/** 正在编辑的已有文件；undefined = 新建。 */
			const [opened, setOpened] = react.useState(void 0);
			/** 待确认删除的文件名（两步删除，防误触）。 */
			const [pendingDelete, setPendingDelete] = react.useState(void 0);
			const [busy, setBusy] = react.useState(false);
			const [hint, setHint] = react.useState(void 0);
			const [loaded, setLoaded] = react.useState(false);
			const memory = snapshot?.memory;
			const files = (memory?.files ?? []).filter((file) => file.track === track);
			const budget = memory?.budget ?? 4e3;
			const injected = memory?.injectedChars ?? 0;
			const over = injected > budget;
			function switchTrack(next) {
				setTrack(next);
				setName("");
				setBody("");
				setOpened(void 0);
				setLoaded(false);
				setPendingDelete(void 0);
				setHint(void 0);
			}
			async function open(fileName) {
				setBusy(true);
				setHint(void 0);
				const result = await readMemory(track, fileName);
				setBusy(false);
				if (result.error !== void 0) {
					setLoaded(false);
					setOpened(void 0);
					setHint(result.error);
					return;
				}
				setOpened(result.data.name);
				setName(result.data.name);
				setBody(result.data.body);
				setLoaded(true);
			}
			async function save() {
				const fileName = name.trim();
				if (fileName === "") {
					setHint("文件名不能为空，例如 conventions.md");
					return;
				}
				if (opened !== void 0 && opened === fileName && !loaded) {
					setHint("正文还没读到，先点一次条目再保存（否则会清空已有记忆）");
					return;
				}
				setBusy(true);
				const feedback = await actFeedback(act, {
					type: "saveMemory",
					track,
					name: fileName,
					body
				});
				setBusy(false);
				setHint(hintOf(feedback));
				if (feedback.ok) {
					setOpened(fileName);
					setLoaded(true);
				}
			}
			async function remove(fileName) {
				if (pendingDelete !== fileName) {
					setPendingDelete(fileName);
					return;
				}
				setBusy(true);
				const feedback = await actFeedback(act, {
					type: "deleteMemory",
					track,
					name: fileName
				});
				setBusy(false);
				setPendingDelete(void 0);
				setHint(hintOf(feedback));
				if (feedback.ok && opened === fileName) {
					setOpened(void 0);
					setName("");
					setBody("");
					setLoaded(false);
				}
			}
			return /* @__PURE__ */ react.createElement("div", { "data-auto-team-memory": true }, /* @__PURE__ */ react.createElement("div", {
				"data-budget": true,
				"data-over": over || memory?.truncated === true ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("span", { "data-budget-text": true }, "预计注入 ", injected, " / ", budget, " 字符"), memory?.truncated === true ? /* @__PURE__ */ react.createElement("span", { "data-chip": true }, "已截断") : null, over ? /* @__PURE__ */ react.createElement("span", {
				"data-chip": true,
				"data-chip-kind": "overflow"
			}, "超出预算") : null), /* @__PURE__ */ react.createElement("div", {
				"data-memory-tracks": true,
				role: "tablist"
			}, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				role: "tab",
				"data-memory-track": "project",
				"aria-selected": track === "project",
				onClick: () => switchTrack("project")
			}, "项目记忆"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				role: "tab",
				"data-memory-track": "public",
				"aria-selected": track === "public",
				onClick: () => switchTrack("public")
			}, "公共记忆")), files.length === 0 ? /* @__PURE__ */ react.createElement("div", {
				"data-empty": true,
				"data-empty-next": true
			}, "该轨还没有记忆文件。下一步：在下方填文件名与正文，保存后成员派发时会按相关度挑选注入。") : /* @__PURE__ */ react.createElement("ul", { "data-memory-list": true }, files.map((file) => {
				const active = opened === file.name;
				const confirming = pendingDelete === file.name;
				return /* @__PURE__ */ react.createElement("li", {
					key: file.name,
					"data-memory-file": true,
					"data-file-name": file.name,
					"data-track": file.track,
					"data-active": active ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-memory-open": true,
					"aria-pressed": active,
					title: "读取正文后再编辑（直接写会覆盖整条记忆）",
					onClick: () => void open(file.name)
				}, file.name), /* @__PURE__ */ react.createElement("span", { "data-memory-chars": true }, file.chars, " 字符"), /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-memory-delete": true,
					"data-confirm": confirming ? "true" : "false",
					disabled: busy,
					onClick: () => void remove(file.name)
				}, confirming ? "确认删除" : "删除"), confirming ? /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-memory-delete-cancel": true,
					onClick: () => setPendingDelete(void 0)
				}, "取消") : null);
			})), /* @__PURE__ */ react.createElement("div", { "data-memory-editor": true }, /* @__PURE__ */ react.createElement("div", { "data-editor-head": true }, opened !== void 0 ? /* @__PURE__ */ react.createElement("span", { "data-editor-mode": "edit" }, "编辑 ", opened, "（已读取正文 ", body.length, " 字符）") : /* @__PURE__ */ react.createElement("span", { "data-editor-mode": "create" }, "新建记忆文件")), /* @__PURE__ */ react.createElement("input", {
				"data-memory-name": true,
				placeholder: "文件名，如 conventions.md",
				value: name,
				disabled: opened !== void 0 && opened === name,
				onChange: (event) => setName(event.target.value)
			}), /* @__PURE__ */ react.createElement("textarea", {
				"data-memory-body": true,
				placeholder: opened !== void 0 ? "记忆正文（md）" : "记忆正文（md）—— 先点上面的条目可编辑已有内容",
				rows: 8,
				value: body,
				onChange: (event) => setBody(event.target.value)
			}), /* @__PURE__ */ react.createElement("div", { "data-editor-actions": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-memory-save": true,
				disabled: busy,
				onClick: () => void save()
			}, "保存到", track === "project" ? "项目" : "公共", "记忆"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-memory-reset": true,
				onClick: () => {
					setOpened(void 0);
					setName("");
					setBody("");
					setLoaded(false);
					setHint(void 0);
				}
			}, "清空表单")), hint !== void 0 ? /* @__PURE__ */ react.createElement("div", {
				"data-hint": true,
				role: "status"
			}, hint) : null));
		}
		// src/client/tabs/RolesTab.tsx
		/**
		* 角色页：内置角色 + 自建/修改；每角色可指定模型（provider / model / reasoningEffort）。
		*
		* 展示纪律（AC-22）：
		*  - 模型路由**单独占一行、等宽、不截断**，与宿主回报逐字一致；
		*  - 宿主 `SpawnTeammateRequest` 只有 `provider`、没有 `model`（TECHNICAL §14 限制 L1），
		*    所以「已配置」不等于「已生效」：无审计或审计为 unverified 时**显式标「未下发」**，
		*    绝不假装生效、也绝不静默退回队长模型。
		*  - 内置角色可改不可删；删除一律两步确认（误删角色会连带影响既有任务的重新派发）。
		*/
		const NEW_ROLE = {
			id: "",
			name: "",
			duty: "",
			skillIds: [],
			builtin: false,
			updatedAt: 0
		};
		function RolesTab(props) {
			const { snapshot, act } = props;
			const roles = snapshot?.roles ?? [];
			const extras = viewExtras(snapshot);
			const [editing, setEditing] = react.useState(void 0);
			const [pendingDelete, setPendingDelete] = react.useState(void 0);
			const [hint, setHint] = react.useState(void 0);
			const [busy, setBusy] = react.useState(false);
			function edit(role) {
				setEditing({
					...role,
					skillIds: [...role.skillIds]
				});
				setHint(void 0);
				setPendingDelete(void 0);
			}
			function patch(next) {
				setEditing((current) => current === void 0 ? current : {
					...current,
					...next
				});
			}
			function patchModel(next) {
				setEditing((current) => {
					if (current === void 0) return current;
					const base = current.model ?? {
						provider: "",
						model: ""
					};
					return {
						...current,
						model: {
							...base,
							...next
						}
					};
				});
			}
			async function save() {
				if (editing === void 0) return;
				const provider = (editing.model?.provider ?? "").trim();
				const model = (editing.model?.model ?? "").trim();
				if (provider === "" !== (model === "")) {
					setHint("provider 与 model 要么都填、要么都留空（留空=会话默认模型）");
					return;
				}
				const next = {
					...editing,
					updatedAt: Date.now()
				};
				if (provider === "" && model === "") delete next.model;
				else next.model = {
					provider,
					model,
					...editing.model?.reasoningEffort !== void 0 ? { reasoningEffort: editing.model.reasoningEffort } : {}
				};
				setBusy(true);
				const feedback = await actFeedback(act, {
					type: "saveRole",
					role: next
				});
				setBusy(false);
				setHint(hintOf(feedback));
				if (feedback.ok) setEditing(void 0);
			}
			async function remove(roleId) {
				if (pendingDelete !== roleId) {
					setPendingDelete(roleId);
					return;
				}
				setBusy(true);
				const feedback = await actFeedback(act, {
					type: "deleteRole",
					roleId
				});
				setBusy(false);
				setPendingDelete(void 0);
				setHint(hintOf(feedback));
			}
			return /* @__PURE__ */ react.createElement("div", { "data-auto-team-roles": true }, /* @__PURE__ */ react.createElement("div", { "data-roles-head": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-role-new": true,
				onClick: () => edit({ ...NEW_ROLE })
			}, "新建角色"), /* @__PURE__ */ react.createElement("span", { "data-roles-meta": true }, "共 ", roles.length, " 个角色（内置 ", roles.filter((role) => role.builtin).length, " 个，可改不可删）")), hint !== void 0 ? /* @__PURE__ */ react.createElement("div", {
				"data-hint": true,
				role: "status"
			}, hint) : null, roles.length === 0 ? /* @__PURE__ */ react.createElement("div", {
				"data-empty": true,
				"data-empty-next": true
			}, "角色库为空。下一步：点「新建角色」写清职责，或重启插件让内置 6 角色重新播种。") : /* @__PURE__ */ react.createElement("ul", { "data-role-list": true }, roles.map((role) => {
				const audit = routeAuditFor(extras.routeAudits, { roleId: role.id });
				const label = formatModelRoute(role.model, audit);
				const unverified = role.model !== void 0 && (audit === void 0 || audit.verdict !== "ok");
				const confirming = pendingDelete === role.id;
				return /* @__PURE__ */ react.createElement("li", {
					key: role.id,
					"data-role-id": role.id,
					"data-builtin": role.builtin ? "true" : "false",
					"data-role-row": true
				}, /* @__PURE__ */ react.createElement("span", { "data-role-name": true }, role.name), /* @__PURE__ */ react.createElement("span", {
					"data-role-duty": true,
					title: role.duty
				}, role.duty), /* @__PURE__ */ react.createElement("span", {
					"data-model-route": true,
					"data-model-route-value": routeTextOf(role.model),
					"data-unverified": unverified ? "true" : "false"
				}, label), /* @__PURE__ */ react.createElement("span", { "data-role-actions": true }, /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-role-edit": true,
					onClick: () => edit(role)
				}, "修改"), /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-role-delete": true,
					"data-confirm": confirming ? "true" : "false",
					disabled: role.builtin || busy,
					title: role.builtin ? "内置角色可改不可删" : confirming ? "再点一次确认删除" : "删除该角色",
					onClick: () => void remove(role.id)
				}, confirming ? "确认删除" : "删除"), confirming ? /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-role-delete-cancel": true,
					onClick: () => setPendingDelete(void 0)
				}, "取消") : null), unverified ? /* @__PURE__ */ react.createElement("span", { "data-role-unverified-note": true }, "未下发：还没有观测到该角色成员的实际运行路由（派发后会在成员创建时核对，漂移即失败，不静默回退队长模型）") : null);
			})), editing !== void 0 ? /* @__PURE__ */ react.createElement("div", { "data-role-editor": true }, /* @__PURE__ */ react.createElement("div", { "data-editor-head": true }, editing.id === "" ? "新建角色" : `修改 ${editing.name || editing.id}`), /* @__PURE__ */ react.createElement("input", {
				"data-role-id-input": true,
				placeholder: "id（小写字母数字与 -）",
				value: editing.id,
				onChange: (event) => patch({ id: event.target.value })
			}), /* @__PURE__ */ react.createElement("input", {
				"data-role-name-input": true,
				placeholder: "名称",
				value: editing.name,
				onChange: (event) => patch({ name: event.target.value })
			}), /* @__PURE__ */ react.createElement("input", {
				"data-role-duty-input": true,
				placeholder: "职责",
				value: editing.duty,
				onChange: (event) => patch({ duty: event.target.value })
			}), /* @__PURE__ */ react.createElement("div", { "data-role-model-editor": true }, /* @__PURE__ */ react.createElement("input", {
				"data-role-provider": true,
				placeholder: "provider（留空=会话默认）",
				value: editing.model?.provider ?? "",
				onChange: (event) => patchModel({ provider: event.target.value })
			}), /* @__PURE__ */ react.createElement("input", {
				"data-role-model": true,
				placeholder: "model",
				value: editing.model?.model ?? "",
				onChange: (event) => patchModel({ model: event.target.value })
			}), /* @__PURE__ */ react.createElement("select", {
				"data-role-effort": true,
				value: editing.model?.reasoningEffort ?? "",
				onChange: (event) => patchModel({ reasoningEffort: event.target.value === "" ? void 0 : event.target.value })
			}, /* @__PURE__ */ react.createElement("option", { value: "" }, "默认强度"), /* @__PURE__ */ react.createElement("option", { value: "low" }, "low"), /* @__PURE__ */ react.createElement("option", { value: "medium" }, "medium"), /* @__PURE__ */ react.createElement("option", { value: "high" }, "high")), /* @__PURE__ */ react.createElement("span", {
				"data-role-model-preview": true,
				"data-model-route-value": routeTextOf(editing.model)
			}, formatModelRoute(editing.model, routeAuditFor(extras.routeAudits, { roleId: editing.id })))), /* @__PURE__ */ react.createElement("div", { "data-editor-actions": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-role-save": true,
				disabled: busy,
				onClick: () => void save()
			}, "保存"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-role-cancel": true,
				onClick: () => setEditing(void 0)
			}, "取消")), hint !== void 0 ? /* @__PURE__ */ react.createElement("div", {
				"data-hint": true,
				role: "status"
			}, hint) : null) : null);
		}
		// src/client/Panel.tsx
		/**
		* 右栏「自动团队」面板外壳（sidebar.right.pane.tab）。
		*
		* 四页：计划 / 成员 / 记忆 / 角色（DESIGN §2）。本组件只做三件事：
		*   1. 取数（usePanelState，与开关行共享同一个 store → 单一数据源）；
		*   2. 把动作收窄成 tab 能用的形状（**全项目唯一的 as PanelAction 在 here**）；
		*   3. 切页与空态。
		*
		* AC-30 的入口就在这里：计划生成后胶囊变琥珀「计划就绪 · N 任务」，此时成员数必须仍为 0
		* —— 成员只在用户点「开始派发」后才创建。
		*/
		/**
		* `CaptainModelLabel.tone`（ok/warn/muted）→ styles.ts 既有的 5 色 `data-tone`。
		*
		* 为什么不直接在 viewmodel 里产出 `data-tone` 的值：那是**宿主 token 的取值域**（组件层知识），
		* 放进纯视图模型会把样式词表耦合进可单测的文案层。而这里只做一次机械改名，不是第二份状态映射。
		*/
		const TONE_DATA = {
			ok: "success",
			warn: "warn",
			muted: "neutral"
		};
		const TABS = [
			{
				key: "plan",
				label: "计划"
			},
			{
				key: "members",
				label: "成员"
			},
			{
				key: "memory",
				label: "记忆"
			},
			{
				key: "roles",
				label: "角色"
			}
		];
		function Panel(props) {
			useAutoTeamStyle();
			const sessionId = sessionIdOf(props);
			const view = usePanelState(sessionId);
			const snapshot = view.snapshot ?? void 0;
			const [tab, setTab] = react.useState("plan");
			const rawAct = view.act;
			const act = react.useCallback((action) => rawAct(action), [rawAct]);
			const readMemory = react.useCallback(async (track, name) => {
				const api = panelApi;
				if (typeof api.readMemory !== "function") return { error: "宿主未提供记忆正文读取接口（插件与宿主版本不一致），为免清空已有记忆，已拒绝打开编辑器" };
				return api.readMemory.call(panelApi, sessionId, track, name);
			}, [sessionId]);
			const tasks = snapshot?.tasks ?? [];
			const members = snapshot?.members ?? [];
			const extras = viewExtras(snapshot);
			const capsule = capsuleOf(snapshot?.enabled === true, snapshot);
			const captainView = snapshot?.captainModel;
			const captainLabel = captainModelLabelOf(captainView);
			const captainState = captainView?.source ?? "unsupported";
			const degraded = snapshot?.degraded === true;
			const degradeReason = (snapshot?.degradeReason ?? "").trim();
			const planReady = tasks.length > 0 && members.length === 0;
			react.useEffect(() => {
				if (planReady) setTab("plan");
			}, [planReady, snapshot?.runId]);
			react.useEffect(() => {
				if (typeof window === "undefined") return;
				const handler = () => setTab("plan");
				window.addEventListener(OPEN_PANEL_EVENT, handler);
				return () => window.removeEventListener(OPEN_PANEL_EVENT, handler);
			}, []);
			const error = view.error ?? void 0;
			return /* @__PURE__ */ react.createElement("div", {
				"data-dsh-auto-team-panel": true,
				"data-enabled": snapshot?.enabled === true ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("div", { "data-panel-head": true }, /* @__PURE__ */ react.createElement("strong", null, "自动团队"), /* @__PURE__ */ react.createElement("span", {
				"data-head-capsule": true,
				"data-tone": capsule.tone
			}, capsule.text), /* @__PURE__ */ react.createElement("span", { "data-head-meta": true }, "计划 ", tasks.length, " · 成员 ", members.length, " · 并发 ", extras.concurrency.running, "/", extras.concurrency.limit), /* @__PURE__ */ react.createElement("span", { "data-head-meta": true }, /* @__PURE__ */ react.createElement("span", {
				"data-captain-model": captainState,
				"data-tone": TONE_DATA[captainLabel.tone],
				title: (captainView?.note ?? "").trim()
			}, captainLabel.label), /* @__PURE__ */ react.createElement("span", { "data-head-sep": true }, " · "), /* @__PURE__ */ react.createElement("span", {
				"data-auto-team-degraded": degraded ? "true" : "false",
				"data-tone": degraded ? "warn" : "neutral",
				title: degraded ? degradeReason : "四个宿主事件源都已订阅，Trigger 由事件即时推进"
			}, degraded ? `事件源降级${degradeReason !== "" ? `：${degradeReason}` : ""}` : "事件源正常")), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				onClick: () => void view.refresh(),
				"data-panel-refresh": true
			}, "刷新")), /* @__PURE__ */ react.createElement("div", {
				"data-panel-tabs": true,
				role: "tablist"
			}, TABS.map((item) => /* @__PURE__ */ react.createElement("button", {
				key: item.key,
				type: "button",
				role: "tab",
				"data-panel-tab": item.key,
				"aria-selected": tab === item.key,
				onClick: () => setTab(item.key)
			}, item.label))), error !== void 0 ? /* @__PURE__ */ react.createElement("div", {
				"data-error": true,
				role: "alert"
			}, error) : null, /* @__PURE__ */ react.createElement("div", {
				"data-panel-body": true,
				"data-active-tab": tab
			}, tab === "plan" ? /* @__PURE__ */ react.createElement(PlanTab, {
				sessionId,
				snapshot,
				act,
				readMemory
			}) : null, tab === "members" ? /* @__PURE__ */ react.createElement(MembersTab, {
				sessionId,
				snapshot,
				act,
				readMemory
			}) : null, tab === "memory" ? /* @__PURE__ */ react.createElement(MemoryTab, {
				sessionId,
				snapshot,
				act,
				readMemory
			}) : null, tab === "roles" ? /* @__PURE__ */ react.createElement(RolesTab, {
				sessionId,
				snapshot,
				act,
				readMemory
			}) : null));
		}
		// src/client/TabTitle.tsx
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
		/** 页签文案（AC-8 按文案判定，改字必须同步 PRD）。 */
		const TAB_TITLE_TEXT = "自动团队";
		function TabTitle() {
			return /* @__PURE__ */ react.createElement("span", {
				"data-auto-team-tab-title": true,
				style: {
					font: "var(--dsw-font-xs-13, 13px/20px sans-serif)",
					whiteSpace: "nowrap",
					display: "inline-flex",
					alignItems: "center"
				}
			}, TAB_TITLE_TEXT);
		}
		// src/client/index.ts
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
		const inject = ["slots"];
		function apply(ctx) {
			if (!ctx?.slots?.register) return;
			registerSlots(ctx, {
				Toggle,
				Panel,
				PanelTitle: TabTitle
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
