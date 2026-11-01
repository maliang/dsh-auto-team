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
		/** E1 输入框内胶囊选项（非 keyed，AC-12）。 */
		const INPUT_DOCK_SLOT = "conversation.input.dock";
		/** E2 会话头按钮（非 keyed，AC-13）。 */
		const HEADER_ACTIONS_SLOT = "conversation.session.header.actions";
		/** E3 右栏「自动团队」面板页签（**keyed**）。 */
		const PANEL_SLOT = "sidebar.right.pane.tab";
		/** E3 上面那个页签的标题位（**keyed**，与 body 同 key，见文件头第 5 行）。 */
		const PANEL_TITLE_SLOT = "sidebar.right.pane.tab.title";
		/** E4 设置页的「自动团队」分区（非 keyed，root 作用域，AC-16）。 */
		const SETTINGS_SECTION_SLOT = "settings.section";
		/** E1 座位 id。 */
		const OPTION_ID = `${PLUGIN_ID}-option`;
		/** E2 座位 id。 */
		const HEADER_ID = `${PLUGIN_ID}-header-button`;
		/** E4 座位 id（宿主按它去重，同一个 id 注册两次会覆盖）。 */
		const SECTION_ID = PLUGIN_ID;
		/** E4 分区标题（宿主设置页左侧导航显示它）。 */
		const SECTION_LABEL = "自动团队";
		/** 页签文案（AC-8 按文案判定，改字必须同步 PRD）。`TabTitle.tsx` 也取它，防两处漂移。 */
		const PANEL_TAB_LABEL = "自动团队";
		/**
		* 宿主侧「页签类型」定义（`sidebarRightTabs.register` 的唯一入参来源）。
		*
		* 为什么要它（QA-02 根因修复）：`sidebar.right.pane.tab` 是 **keyed 座位**，宿主只有在
		* `sidebarRightTabs` 服务里存在 `id === 座位 key` 的页签类型时才派发该座位。只注册座位、
		* 不注册类型 = 构建全绿、控制台零报错、页签永不出现（r6 QA 实测）。
		* `id` 是宿主侧实现身份（全局唯一，重复注册会抛），`kind` 是 `openTab` 的入参；
		* 两者同值，由 `test/client-contract.test.ts` 的「页签类型」组断言逐字相等，防单点漂移。
		*/
		function panelTabDefinition() {
			return {
				id: "dsh-auto-team-panel",
				kind: "dsh-auto-team-panel",
				priority: "extension",
				title: () => PANEL_TAB_LABEL
			};
		}
		const PANEL_KEY = panelTabDefinition().id;
		const PANEL_TAB_KIND = panelTabDefinition().kind;
		/**
		* `slots.register` 的 `inject`：宿主把当次 sessionId 传进来，原样交给组件
		* （组件侧 `state.ts:319 sessionIdOf` 读 `props.sessionId`）。
		* 只此一份实现 —— 四个可见面必须拿到同一个 sessionId（同一个 store、同一份快照）。
		*/
		function sessionIdBag(sessionId, openPanel) {
			return openPanel === void 0 ? { sessionId } : {
				sessionId,
				openPanel
			};
		}
		/**
		* 注册全部挂载点。`deps` 只为让测试注入桩组件；生产由 `index.ts` 传真组件。
		* 挂载点不存在时 `slots.inject` 是 inert 的（回调不会被调），因此注册它零副作用。
		*/
		function registerSlots(ctx, deps) {
			const injectOf = (sessionId) => sessionIdBag(sessionId);
			ctx.slots.inject(INPUT_DOCK_SLOT, () => {
				ctx.slots.register({
					name: INPUT_DOCK_SLOT,
					id: OPTION_ID,
					order: 5,
					inject: injectOf
				}, deps.Option);
			});
			ctx.slots.inject(HEADER_ACTIONS_SLOT, () => {
				ctx.slots.register({
					name: HEADER_ACTIONS_SLOT,
					id: HEADER_ID,
					order: 0,
					inject: (sessionId) => sessionIdBag(sessionId, deps.openPanel)
				}, deps.HeaderButton);
			});
			ctx.slots.inject(PANEL_SLOT, () => {
				ctx.slots.register({
					name: PANEL_SLOT,
					key: PANEL_KEY,
					inject: injectOf
				}, deps.Panel);
			});
			ctx.slots.inject(PANEL_TITLE_SLOT, () => {
				ctx.slots.register({
					name: PANEL_TITLE_SLOT,
					key: PANEL_KEY,
					inject: injectOf
				}, deps.PanelTitle);
			});
			ctx.slots.inject(SETTINGS_SECTION_SLOT, () => {
				ctx.slots.register({
					name: SETTINGS_SECTION_SLOT,
					id: SECTION_ID,
					order: 40,
					label: SECTION_LABEL,
					inject: injectOf
				}, deps.SettingsSection);
			});
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
		function registerPanelTab(ctx) {
			if (typeof ctx.inject !== "function") return false;
			ctx.inject(["sidebarRightTabs"], (scope) => {
				const tabs = scope.sidebarRightTabs;
				if (tabs === void 0 || typeof tabs.register !== "function") return;
				const definition = panelTabDefinition();
				const register = () => tabs.register(definition);
				if (typeof scope.effect === "function") scope.effect(register, "dsh-auto-team: panel tab type");
				else register();
			});
			return true;
		}
		/**
		* 生成「打开面板」动作：宿主 `sidebarRight.openTab(PANEL_TAB_KIND)`。
		*
		* 历史缺陷形态：`Toggle.tsx` 原先断言「宿主未提供激活某页签的对外动作」，只 `window.dispatchEvent`
		* 一个自己定义的事件 —— 页签尚未打开时没有任何监听者，等于按钮无效。返回 `false` 表示宿主服务不可用，
		* 组件据此回退旧行为。
		*/
		function createOpenPanel(ctx) {
			let open;
			if (typeof ctx.inject === "function") ctx.inject(["sidebarRight"], (scope) => {
				const right = scope.sidebarRight;
				if (right === void 0 || typeof right.openTab !== "function") return;
				open = () => {
					right.openTab(PANEL_TAB_KIND);
				};
			});
			return () => {
				if (open === void 0) return false;
				open();
				return true;
			};
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
			},
			paused: {
				icon: "⏸",
				text: "已暂停",
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
		function formatClock$1(ts) {
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
			return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock$1(ts)}`;
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
		function num$1(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : void 0;
		}
		function str$1(value) {
			return typeof value === "string" ? value : "";
		}
		function routeOf(value) {
			if (value === null || typeof value !== "object") return null;
			const raw = value;
			const provider = str$1(raw.provider).trim();
			const model = str$1(raw.model).trim();
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
					at: num$1(raw.at) ?? 0,
					from: str$1(raw.from),
					to: str$1(raw.to),
					body: str$1(raw.body)
				};
				const toMemberId = str$1(raw.toMemberId);
				if (toMemberId !== "") message.toMemberId = toMemberId;
				const taskId = str$1(raw.taskId);
				if (taskId !== "") message.taskId = taskId;
				const messageId = str$1(raw.messageId);
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
					taskId: str$1(raw.taskId),
					roleId: str$1(raw.roleId),
					declared: routeOf(raw.declared),
					actual: routeOf(raw.actual),
					at: num$1(raw.at) ?? 0,
					verdict
				};
			});
		}
		function countRunning(tasks) {
			return tasks.filter((task) => task.status === "running" || task.status === "gate").length;
		}
		function concurrencyOf(value, tasks) {
			const raw = value ?? {};
			const limit = num$1(raw.limit);
			const running = num$1(raw.running);
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
			const plannedAt = num$1(raw.plannedAt);
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
			const transportError = str$1(box.error);
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
				const message = str$1(rejected.message).trim();
				const code = str$1(rejected.code).trim();
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
				const text = str$1(event.text).trim();
				if (text === "") continue;
				rows.push({
					at: typeof event.at === "number" ? event.at : 0,
					clock: formatClock$1(event.at),
					text,
					sourceLabel: source === "trigger" ? "自动" : "用户",
					kind: str$1(event.kind) === "" ? "status" : str$1(event.kind)
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
			const value = str$1(view.value).trim();
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
		/**
		* `TaskStatus` 10 态 → 进度值与颜色（**全项目唯一一份**，AC-14 判据落在 progressOf 上）。
		*
		* label 一律从 `statusBadge` 取，这里**不再写第二遍中文** —— 同一状态两处文案必然漂移。
		* percent 口径：待派发 0 → 就绪 10 → 阻塞 20 → 待返工 40 → 运行中/已暂停 50 →
		* 门禁中 80 → 已通过 100；失败/已中断归 0（要重跑，进度不保留）。
		* 已暂停取 50：暂停冻结在「中途」，既不能假装完成（100），也不能假装没开始（0）。
		*/
		const TASK_PROGRESS = {
			pending: {
				tone: "muted",
				percent: 0
			},
			ready: {
				tone: "muted",
				percent: 10
			},
			blocked: {
				tone: "warn",
				percent: 20
			},
			rework: {
				tone: "warn",
				percent: 40
			},
			running: {
				tone: "ok",
				percent: 50
			},
			paused: {
				tone: "warn",
				percent: 50
			},
			gate: {
				tone: "warn",
				percent: 80
			},
			done: {
				tone: "ok",
				percent: 100
			},
			failed: {
				tone: "bad",
				percent: 0
			},
			interrupted: {
				tone: "bad",
				percent: 0
			}
		};
		/** 单条任务的展示态：状态 / 中文标签 / 颜色 / 进度百分比（缺状态一律按 pending 兜底）。 */
		function progressOf(task) {
			const raw = task?.status;
			const status = typeof raw === "string" && raw in TASK_PROGRESS ? raw : "pending";
			const row = TASK_PROGRESS[status];
			return {
				status,
				label: statusBadge(status).text,
				tone: row.tone,
				percent: row.percent
			};
		}
		/**
		* `PlanStatus` 5 态 → 中文 + 颜色（AC-14 页头「完成 x/N + 计划状态」）。
		*
		* 放在 viewmodel 而不是 ui/组件里的理由：10 态中文标签的守卫判据是「只许出现在
		* viewmodel.ts」，而「已暂停」既是任务态也是计划态 —— 分两处写必然被守卫判红，也必然漂移。
		*/
		const PLAN_STATUS = {
			draft: {
				label: "计划就绪",
				tone: "ok"
			},
			dispatching: {
				label: "派发中",
				tone: "ok"
			},
			paused: {
				label: "已暂停",
				tone: "warn"
			},
			terminated: {
				label: "已终止",
				tone: "muted"
			},
			cancelled: {
				label: "已取消",
				tone: "muted"
			}
		};
		/** 计划状态中文：未启用（无计划）走「未启用」，未知取值同样保守回落。 */
		function planStatusView(planStatus) {
			if (!planStatus) return {
				label: "未启用",
				tone: "muted"
			};
			return PLAN_STATUS[planStatus] ?? {
				label: "未启用",
				tone: "muted"
			};
		}
		// src/client/ui.ts
		/**
		* 输入框内的「自动团队」胶囊（取代旧的 composer.dock 开关行）。
		*
		* busy 期间**只换 state、不改 label** —— 乐观切换文案会让「点了没反应」看起来像已生效
		* （AC-15 的同一条纪律，pill 与暂停按钮共用）。
		*/
		function optionView(input) {
			const enabled = input.enabled === true;
			const done = countOf(input.done);
			const total = countOf(input.total);
			const status = enabled ? planPillText(input.planStatus, done, total) : planStatusView(void 0).label;
			const state = input.busy === true ? "busy" : !enabled ? "off" : input.planStatus === "paused" ? "paused" : "on";
			return {
				hook: "data-auto-team-option",
				label: `自动团队 · ${status}`,
				ariaLabel: `自动团队，${enabled ? "已启用" : "未启用"}，${status}`,
				pressed: enabled,
				state
			};
		}
		/** 会话头「自动团队」按钮：点一下开右栏面板。 */
		function headerButtonView(input) {
			const done = countOf(input.done);
			const total = countOf(input.total);
			const status = planPillText(input.planStatus, done, total);
			return {
				hook: "data-auto-team-header-button",
				label: "自动团队",
				ariaLabel: `自动团队，${input.enabled === true ? "已启用" : "未启用"}，${status}`,
				badge: total > 0 ? `${done}/${total}` : ""
			};
		}
		/**
		* 面板顶部唯一的暂停/继续按钮。
		*
		* 硬规矩（AC-15）：文案、action、tone **只**由 `paused` 决定；`busy` 只置 `disabled`。
		* 请求失败/在飞时保持原状态，等服务端快照回来再切换 —— 绝不乐观改文案。
		*/
		function pauseButtonView(input) {
			const paused = input.paused === true;
			return {
				hook: "data-auto-team-pause",
				label: paused ? "继续任务" : "暂停任务",
				action: paused ? "resumeTeam" : "pause",
				tone: paused ? "warn" : "muted",
				disabled: input.busy === true
			};
		}
		/** 一条任务行的全部可核验文案。 */
		function taskRowView(task, roles) {
			const progress = progressOf(task);
			return {
				hook: "data-auto-team-task",
				title: str(task?.title),
				content: str(task?.acceptance),
				statusLabel: progress.label,
				statusTone: progress.tone,
				roleLabel: roleLabelOf$1(task, roles),
				evidence: evidenceOf(task)
			};
		}
		const UNASSIGNED_ROLE = "未分配";
		function roleLabelOf$1(task, roles) {
			const roleId = str(task?.roleId);
			if (roleId === "") return UNASSIGNED_ROLE;
			const name = str((Array.isArray(roles) ? roles : []).find((role) => str(role?.id) === roleId)?.name).trim();
			return name === "" ? UNASSIGNED_ROLE : name;
		}
		/**
		* 门禁证据摘要：有则「退出码 N」。
		* `exitCode === null` = 超时/被信号杀（宿主契约明确区分），必须显式写「门禁超时」，
		* 不能显示成「退出码 0」那种假绿。
		*/
		function evidenceOf(task) {
			const evidence = task?.evidence;
			if (!evidence || typeof evidence !== "object") return "";
			const exitCode = evidence.exitCode;
			if (exitCode === null) return "门禁超时";
			if (typeof exitCode === "number" && Number.isFinite(exitCode)) return `退出码 ${exitCode}`;
			return "";
		}
		/**
		* 设置项的取值域**在这里写死一份**：client 不能 import `src/host/config.ts`
		* （host/client 零直接 import 铁律），而取值范围是用户可见文案的一部分。
		* 真值仍是 `SETTINGS_LIMITS`；两处漂移由 T5 的守卫脚本比对（grep 两侧数字）。
		*/
		const SETTING_HINTS = {
			concurrencyLimit: "1–8",
			memoryBudget: "200–4000",
			stallMs: "1000–600000",
			maxAttempts: "1–10",
			gateTimeoutMs: "1000–600000",
			captainModel: "缺省 = 跟随会话默认"
		};
		/**
		* 设置页的 6 行参数（顺序即 DESIGN §2.4 的渲染顺序）。
		* `key` 就是 `data-setting-key`，组件与真机断言都用它定位。
		*/
		function settingsKeysView(settings) {
			const s = settings ?? {};
			return [
				{
					key: "concurrencyLimit",
					label: "并发上限",
					hint: SETTING_HINTS.concurrencyLimit,
					value: num(s.concurrencyLimit)
				},
				{
					key: "memoryBudget",
					label: "记忆注入预算",
					hint: SETTING_HINTS.memoryBudget,
					value: num(s.memoryBudget)
				},
				{
					key: "stallMs",
					label: "停滞阈值(ms)",
					hint: SETTING_HINTS.stallMs,
					value: num(s.stallMs)
				},
				{
					key: "maxAttempts",
					label: "返工上限",
					hint: SETTING_HINTS.maxAttempts,
					value: num(s.maxAttempts)
				},
				{
					key: "gateTimeoutMs",
					label: "门禁超时(ms)",
					hint: SETTING_HINTS.gateTimeoutMs,
					value: num(s.gateTimeoutMs)
				},
				{
					key: "captainModel",
					label: "队长默认模型",
					hint: SETTING_HINTS.captainModel,
					value: routeTextOf(s.captainModel) || "会话默认"
				}
			];
		}
		/**
		* 胶囊/角标的状态段：文案只由计划状态派生（**不写状态中文**，一律取 `planStatusView`）。
		*  - 无计划 → 待开工；
		*  - 暂停/已终止/已取消 → 只显示状态本身（没有进度可言）；
		*  - 全部完成 → `完成 x/N`；
		*  - 派发中 → `派发中 · x/N`；
		*  - 其余（计划就绪）→ `计划就绪 · N 任务`。
		*/
		function planPillText(planStatus, done, total) {
			if (!planStatus) return "待开工";
			const base = planStatusView(planStatus).label;
			if (planStatus === "paused" || planStatus === "terminated" || planStatus === "cancelled") return base;
			if (total > 0 && done >= total) return `完成 ${done}/${total}`;
			if (planStatus === "dispatching") return total > 0 ? `${base} · ${done}/${total}` : base;
			return total > 0 ? `${base} · ${total} 任务` : base;
		}
		function str(value) {
			return typeof value === "string" ? value : "";
		}
		/** 计数兜底：非数字/负数/NaN 一律 0（宿主字段缺失时不许把界面算成 NaN/undefined）。 */
		function countOf(value) {
			return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
		}
		/** 数字字段的输入框初值：非法/缺失给空串（让用户看出「没设过」而不是看到 0）。 */
		function num(value) {
			return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
		}
		// src/client/Option.tsx
		/**
		* E1 `conversation.input.dock`：输入框内的「自动团队」胶囊选项（DESIGN §2.1，AC-12）。
		*
		* 职责边界（本文件只做三件事，别加第四件）：
		*   1. 取数：`usePanelState(sessionId)` —— 与右栏面板、会话头按钮**共用同一个 store**（单一数据源）；
		*   2. 贴 DOM：文案/aria **全部**来自 `ui.optionView`（渲染描述层），本组件不写任何中文状态
		*      （根 hook `data-auto-team-option` 与 `optionView().hook` 逐字相同，由
		*      `test/client-contract.test.ts` 的 AST 守卫比对，防两处漂移）；
		*   3. 点击只发 `act({type:'toggle'})`，**绝不隐式派发**（反面目标 1：打开开关不该自动起人）。
		*
		* busy 期间：`ui.state === 'busy'` → 文案逐字不变 + `aria-busy` + 右侧 12×12 旋转环（CSS），
		* 点击入口自己拦掉。**绝不做乐观切换** —— 等服务端快照回来再变态，
		* 否则「点了没反应/失败再变回来」是本项目最难解释的体验（AC-15）。
		*/
		function AutoTeamOption(props) {
			useAutoTeamStyle();
			const view = usePanelState(sessionIdOf(props));
			const snapshot = view.snapshot;
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(void 0);
			const [flash, setFlash] = react.useState(false);
			const tasks = snapshot?.tasks ?? [];
			const done = tasks.filter((task) => task.status === "done").length;
			const enabled = snapshot?.enabled === true;
			const ui = optionView({
				enabled,
				busy,
				planStatus: snapshot?.planStatus,
				done,
				total: tasks.length
			});
			const lastEnabled = react.useRef(void 0);
			react.useEffect(() => {
				const previous = lastEnabled.current;
				lastEnabled.current = enabled;
				if (previous === void 0 || previous === enabled) return;
				setFlash(true);
				const timer = setTimeout(() => setFlash(false), 300);
				return () => clearTimeout(timer);
			}, [enabled]);
			async function toggle() {
				if (busy) return;
				setBusy(true);
				setError(void 0);
				const result = await view.act({
					type: "toggle",
					enabled: !enabled
				});
				setBusy(false);
				setError(hintOf(feedbackOf(result)));
			}
			return /* @__PURE__ */ react.createElement("span", {
				"data-auto-team-option": true,
				"data-state": ui.state,
				"data-enabled": enabled ? "true" : "false",
				"data-flash": flash ? "true" : "false",
				"data-error-state": error !== void 0 ? "true" : "false",
				role: "switch",
				tabIndex: 0,
				"aria-checked": ui.pressed,
				"aria-label": ui.ariaLabel,
				"aria-busy": busy ? "true" : void 0,
				"aria-disabled": busy ? "true" : void 0,
				title: ui.ariaLabel,
				onClick: () => void toggle(),
				onKeyDown: (event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					toggle();
				}
			}, /* @__PURE__ */ react.createElement("span", {
				"data-option-dot": true,
				"aria-hidden": "true"
			}), /* @__PURE__ */ react.createElement("span", { "data-option-label": true }, ui.label), busy ? /* @__PURE__ */ react.createElement("span", {
				"data-option-spinner": true,
				"aria-hidden": "true"
			}) : null, error !== void 0 ? /* @__PURE__ */ react.createElement("span", {
				"data-option-error": true,
				role: "alert"
			}, error) : null);
		}
		// src/client/HeaderButton.tsx
		/**
		* E2 `conversation.session.header.actions`：会话头「自动团队」按钮（DESIGN §2.2，AC-13）。
		*
		* 点击语义只有一条：打开右栏面板。
		*   ① 宿主提供 `sidebarRight.openTab` → 直接开（`openPanel()` 返回 true，由 `createOpenPanel` 生成）；
		*   ② 服务缺失/尚未就绪 → `window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT))`，
		*      由已挂载的面板自己切页（面板没挂载时无人接收，属正常，不报错）。
		* 两个分支都要覆盖：只做 ① 会在服务晚到的真机上「点了没反应」，只做 ② 会在面板未打开时
		* 派发一个没人听的事件 —— r1~r6 的 Toggle 就是后者。
		*
		* 文案/角标/aria 全部来自 `ui.headerButtonView`；本组件不写中文状态。
		*/
		/** 面板未就绪时的回退通道（`Panel.tsx` 订阅它切到「计划」页）。 */
		const OPEN_PANEL_EVENT = "dsh-auto-team:open-panel";
		function AutoTeamHeaderButton(props) {
			useAutoTeamStyle();
			const snapshot = usePanelState(sessionIdOf(props)).snapshot;
			const [opened, setOpened] = react.useState(false);
			const tasks = snapshot?.tasks ?? [];
			const done = tasks.filter((task) => task.status === "done").length;
			const ui = headerButtonView({
				enabled: snapshot?.enabled === true,
				planStatus: snapshot?.planStatus,
				done,
				total: tasks.length
			});
			function open() {
				const native = typeof props.openPanel === "function" ? props.openPanel : void 0;
				if (native !== void 0 && native() === true) {
					setOpened(true);
					return;
				}
				if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT));
				setOpened(true);
			}
			return /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-auto-team-header-button": true,
				"data-pressed": opened ? "true" : "false",
				"aria-pressed": opened,
				"aria-label": ui.ariaLabel,
				title: ui.ariaLabel,
				onClick: open
			}, /* @__PURE__ */ react.createElement("span", {
				"data-header-icon": true,
				"aria-hidden": "true"
			}, "◧"), /* @__PURE__ */ react.createElement("span", { "data-header-label": true }, ui.label), ui.badge === "" ? null : /* @__PURE__ */ react.createElement("span", { "data-header-badge": true }, ui.badge));
		}
		// src/client/tabs/PlanTab.tsx
		/**
		* 计划页签（DESIGN §2.3 / TECHNICAL §4.7）。
		*
		* 任务行是本页的全部内容，三条硬规矩：
		*  1. **10 态文案与色调只来自 `progressOf(task)`**（经 `ui.taskRowView` 打包），
		*     组件里不许再写一个「进行中/已完成」的 switch —— 这是本项目文案漂移的高发点。
		*  2. **暂停不清证据**：`退出码 N` 由 `taskRowView.evidence` 给，暂停时照常渲染；
		*     没有证据时整块不渲染（不写「—」占位，DESIGN §2.3）。
		*  3. **列表顺序即计划顺序**：暂停后不重排，用户才能看出「谁被打断」。
		*/
		/** 哪些状态允许改角色：已开始/已结束的任务换角色没有意义（会误导「改了会重跑」）。 */
		function roleEditable(task) {
			return task.status === "pending" || task.status === "blocked" || task.status === "ready";
		}
		const TASK_TONE_DATA = {
			ok: "success",
			warn: "warn",
			bad: "danger",
			muted: "neutral"
		};
		function PlanTab(props) {
			const { snapshot, act } = props;
			const [busy, setBusy] = react.useState(false);
			const [hint, setHint] = react.useState(void 0);
			const tasks = snapshot?.tasks ?? [];
			const roles = snapshot?.roles ?? [];
			const runId = snapshot?.runId;
			const paused = snapshot?.paused === true;
			const dispatching = snapshot?.planStatus === "dispatching";
			const triggers = recentTriggersOf(snapshot);
			async function send(action, done) {
				setBusy(true);
				try {
					const feedback = await actFeedback(act, action);
					setHint(hintOf(feedback) ?? (feedback.ok ? done : "动作未生效"));
				} finally {
					setBusy(false);
				}
			}
			if (runId === void 0) return /* @__PURE__ */ react.createElement("section", {
				"data-auto-team-plan": true,
				"data-empty": true
			}, /* @__PURE__ */ react.createElement("p", null, "还没有计划。"), /* @__PURE__ */ react.createElement("p", { "data-empty-next": true }, "把目标发进会话并启用自动团队，队长会先产出计划，再任务行出现在这里。"), triggers.length === 0 ? null : /* @__PURE__ */ react.createElement("ul", { "data-plan-triggers": true }, triggers.map((item) => /* @__PURE__ */ react.createElement("li", {
				key: `${item.at}-${item.sourceLabel}`,
				"data-auto-team-trigger": true,
				"data-source": item.sourceLabel
			}, /* @__PURE__ */ react.createElement("span", { "data-trigger-badge": true }, item.sourceLabel), /* @__PURE__ */ react.createElement("span", { "data-trigger-clock": true }, item.clock), /* @__PURE__ */ react.createElement("span", { "data-trigger-text": true }, item.text)))));
			const done = tasks.filter((task) => task.status === "done").length;
			return /* @__PURE__ */ react.createElement("section", {
				"data-auto-team-plan": true,
				"data-paused": paused ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("div", { "data-plan-meta-row": true }, /* @__PURE__ */ react.createElement("span", {
				"data-plan-run-id": true,
				title: runId
			}, "运行 ", runId), typeof snapshot?.plannedAt === "number" ? /* @__PURE__ */ react.createElement("span", { "data-plan-planned-at": true }, formatStamp(snapshot.plannedAt)) : null, /* @__PURE__ */ react.createElement("span", {
				"data-plan-concurrency": true,
				"data-concurrency-source": snapshot?.concurrency?.source ?? "default"
			}, "并发 ", snapshot?.concurrency?.running ?? 0, "/", snapshot?.concurrency?.limit ?? 0, " · 完成 ", done, "/", tasks.length)), triggers.length === 0 ? null : /* @__PURE__ */ react.createElement("ul", { "data-plan-triggers": true }, triggers.map((item) => /* @__PURE__ */ react.createElement("li", {
				key: `${item.at}-${item.sourceLabel}`,
				"data-auto-team-trigger": true,
				"data-source": item.sourceLabel
			}, /* @__PURE__ */ react.createElement("span", { "data-trigger-badge": true }, item.sourceLabel), /* @__PURE__ */ react.createElement("span", { "data-trigger-clock": true }, item.clock), /* @__PURE__ */ react.createElement("span", { "data-trigger-text": true }, item.text)))), /* @__PURE__ */ react.createElement("div", { "data-plan-actions": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-plan-dispatch": true,
				disabled: busy || paused || dispatching,
				title: paused ? "已暂停：先点页头的「继续任务」" : "把就绪任务派发给成员",
				onClick: () => void send({ type: "dispatch" }, "已请求派发")
			}, dispatching ? "派发中…" : "开始派发"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-plan-cancel": true,
				disabled: busy,
				onClick: () => void send({ type: "cancel" }, "已请求取消计划")
			}, "取消计划")), hint === void 0 ? null : /* @__PURE__ */ react.createElement("div", {
				"data-hint": true,
				role: "status"
			}, hint), /* @__PURE__ */ react.createElement("div", { "data-plan-table": true }, tasks.length === 0 ? /* @__PURE__ */ react.createElement("div", { "data-empty": true }, "计划里还没有任务。") : tasks.map((task) => {
				const row = taskRowView(task, roles);
				const progress = progressOf(task);
				return /* @__PURE__ */ react.createElement("article", {
					key: task.id,
					"data-plan-row": true,
					"data-task-id": task.id,
					"data-status": progress.status,
					"data-tone": TASK_TONE_DATA[row.statusTone] ?? "neutral",
					"data-paused": progress.status === "paused" ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("header", { "data-task-head": true }, /* @__PURE__ */ react.createElement("span", { "data-task-id-label": true }, task.id), /* @__PURE__ */ react.createElement("span", {
					"data-task-title": true,
					title: row.title
				}, row.title), /* @__PURE__ */ react.createElement("span", {
					"data-task-status-badge": true,
					"data-tone": TASK_TONE_DATA[row.statusTone] ?? "neutral",
					"data-status": progress.status
				}, row.statusLabel)), row.content === "" ? null : /* @__PURE__ */ react.createElement("p", {
					"data-task-acceptance": true,
					title: row.content
				}, row.content), /* @__PURE__ */ react.createElement("footer", { "data-task-foot": true }, roleEditable(task) ? /* @__PURE__ */ react.createElement("select", {
					"data-task-role": true,
					value: task.roleId,
					disabled: busy,
					onChange: (event) => void send({
						type: "setTaskRole",
						taskId: task.id,
						roleId: event.target.value
					}, `已把 ${task.id} 指派给 ${event.target.value}`)
				}, /* @__PURE__ */ react.createElement("option", { value: "" }, "未分配"), roles.map((role) => /* @__PURE__ */ react.createElement("option", {
					key: role.id,
					value: role.id
				}, role.name))) : /* @__PURE__ */ react.createElement("span", { "data-task-role-readonly": true }, roleLabelOf(task, roles)), row.evidence === "" ? null : /* @__PURE__ */ react.createElement("span", {
					"data-task-has-evidence": true,
					"data-evidence": row.evidence
				}, row.evidence), /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-task-receipt": true,
					disabled: busy,
					title: "人工放行门禁（宿主会记一笔证据）",
					onClick: () => void send({
						type: "receipt",
						taskId: task.id,
						note: "面板手动放行"
					}, `已放行 ${task.id}`)
				}, "放行"), /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-task-resume": true,
					disabled: busy,
					onClick: () => void send({
						type: "resume",
						taskId: task.id
					}, `已请求续聊 ${task.id}`)
				}, "续聊")));
			})));
		}
		/** 只读角色名（不可编辑时显示；文案与 `ui.taskRowView().roleLabel` 同口径）。 */
		function roleLabelOf(task, roles) {
			const id = task.roleId ?? "";
			if (id === "") return "未分配";
			const found = roles.find((role) => role.id === id);
			return found === void 0 ? id : found.name;
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
					title: formatClock$1(lastEvent)
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
				}, evidence.exitCode)), /* @__PURE__ */ react.createElement("div", { "data-evidence-line": true }, /* @__PURE__ */ react.createElement("span", { "data-evidence-label": true }, "产物"), /* @__PURE__ */ react.createElement("code", { "data-evidence-artifacts": true }, evidence.artifacts.length > 0 ? evidence.artifacts.join("、") : "（无）")), /* @__PURE__ */ react.createElement("div", { "data-evidence-line": true }, /* @__PURE__ */ react.createElement("span", { "data-evidence-label": true }, "时间"), /* @__PURE__ */ react.createElement("code", null, formatClock$1(evidence.at))), /* @__PURE__ */ react.createElement("pre", { "data-evidence-tail": true }, tailLines(evidence.tail, 40).join("\n") || "（无输出）")) : null);
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
				}, formatClock$1(message.at)), foldable ? /* @__PURE__ */ react.createElement("button", {
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
		// src/client/RoleEditor.tsx
		/**
		* 角色编辑列表（**面板角色页与设置页共用同一份**，DESIGN §3.3 / TECHNICAL §4.5）。
		*
		* 为什么必须共用（本项目历史 bug 族）：如果面板页与设置页各写一套保存链，用户会遇到
		* 「面板里改的顺手、设置里改的不生效」，且同一份角色数据出现两处缓存与两条校验路径。
		* 这里只做**编辑与校验**，保存动作由容器（RolesTab / SettingsPage）用同一个
		* `act({type:'saveRole'})` 发出 —— 本组件不 import api、不发请求。
		*
		* `density` 只控制字号与按钮形态（`panel` 窄、`page` 宽），**不改行为**。
		* 内置角色**没有删除按钮**（不是禁用：渲染出来就有"可以删"的错觉，DESIGN §0.8-5）。
		*
		* 校验在这里单点做（与 host `roles/repo.ts` 的规则逐条对齐，红字文案由本组件产出）：
		*   - id/name 非空；name 去空白后非空；
		*   - 提示词 ≤ 8000 字符（host `ROLE_PROMPT_MAX`；client 不能 import host，故此处写一份并注释）；
		*   - 模型 provider/model 必须同时给或同时空（半截路由会被 host 拒绝）。
		*/
		/** 与 `src/host/config.ts` 的 `ROLE_PROMPT_MAX` 逐字一致（client 不能 import host）。 */
		const ROLE_PROMPT_MAX = 8e3;
		function asRole(value, fallbackId) {
			const base = value ?? {
				id: fallbackId,
				name: "",
				duty: "",
				skillIds: [],
				builtin: false,
				updatedAt: 0
			};
			return {
				...base,
				skillIds: Array.isArray(base.skillIds) ? [...base.skillIds] : [],
				prompt: typeof base.prompt === "string" ? base.prompt : ""
			};
		}
		/** 单张卡片的校验：返回空串 = 通过。 */
		function checkRole(role) {
			if (role.id.trim() === "") return "角色 id 不能为空";
			if (role.name.trim() === "") return "角色名不能为空";
			const prompt = (role.prompt ?? "").trim();
			if (prompt.length > ROLE_PROMPT_MAX) return `提示词最多 ${ROLE_PROMPT_MAX} 字符（当前 ${prompt.length}）`;
			const provider = (role.model?.provider ?? "").trim();
			const model = (role.model?.model ?? "").trim();
			if (provider === "" !== (model === "")) return "默认模型的 provider 与 model 必须同时填写或同时留空";
			return "";
		}
		function RoleEditorList(props) {
			const { roles, skills, density, busy } = props;
			const [drafts, setDrafts] = react.useState({});
			const [pendingDelete, setPendingDelete] = react.useState(void 0);
			const [confirmRestore, setConfirmRestore] = react.useState(false);
			const [errors, setErrors] = react.useState({});
			const [hint, setHint] = react.useState(void 0);
			const sequence = react.useRef(0);
			const signature = roles.map((role) => [
				role.id,
				role.updatedAt,
				role.name,
				role.duty,
				role.prompt ?? "",
				(role.skillIds ?? []).join(","),
				role.model?.provider ?? "",
				role.model?.model ?? ""
			].join("|")).join(";");
			react.useEffect(() => {
				const next = {};
				for (const role of roles) next[role.id] = asRole(role, role.id);
				setDrafts(next);
				setPendingDelete(void 0);
				setConfirmRestore(false);
			}, [signature]);
			function patch(id, change) {
				setDrafts((previous) => {
					const base = asRole(previous[id], id);
					return {
						...previous,
						[id]: {
							...base,
							...change
						}
					};
				});
				setErrors((previous) => previous[id] === void 0 ? previous : {
					...previous,
					[id]: ""
				});
			}
			function patchModel(id, field, value) {
				setDrafts((previous) => {
					const base = asRole(previous[id], id);
					const model = {
						...base.model ?? {
							provider: "",
							model: ""
						},
						[field]: value
					};
					return {
						...previous,
						[id]: {
							...base,
							model
						}
					};
				});
				setErrors((previous) => previous[id] === void 0 ? previous : {
					...previous,
					[id]: ""
				});
			}
			function toggleSkill(id, skillId) {
				setDrafts((previous) => {
					const base = asRole(previous[id], id);
					const skillIds = base.skillIds.includes(skillId) ? base.skillIds.filter((item) => item !== skillId) : [...base.skillIds, skillId];
					return {
						...previous,
						[id]: {
							...base,
							skillIds
						}
					};
				});
			}
			function save(id) {
				const role = asRole(drafts[id], id);
				const problem = checkRole(role);
				if (problem !== "") {
					setErrors((previous) => ({
						...previous,
						[id]: problem
					}));
					return;
				}
				const model = role.model;
				const normalized = {
					...role,
					updatedAt: Date.now(),
					model: model !== void 0 && (model.provider.trim() !== "" || model.model.trim() !== "") ? {
						...model,
						provider: model.provider.trim(),
						model: model.model.trim()
					} : void 0
				};
				props.onSave(normalized);
				setHint(`已提交「${normalized.name}」`);
			}
			function addRole() {
				sequence.current += 1;
				const id = `custom-${Date.now().toString(36)}-${sequence.current}`;
				setDrafts((previous) => ({
					...previous,
					[id]: {
						id,
						name: "",
						duty: "",
						skillIds: [],
						builtin: false,
						updatedAt: Date.now(),
						prompt: ""
					}
				}));
				setHint(void 0);
			}
			const ordered = Object.keys(drafts).map((id) => drafts[id]).sort((left, right) => {
				if (left.builtin !== right.builtin) return left.builtin ? -1 : 1;
				return left.id.localeCompare(right.id);
			});
			return /* @__PURE__ */ react.createElement("section", {
				"data-auto-team-role-editor": true,
				"data-density": density,
				"data-busy": busy ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("div", { "data-roles-head": true }, /* @__PURE__ */ react.createElement("span", { "data-roles-count": true }, "角色 ", ordered.length, "（内置 ", ordered.filter((role) => role.builtin).length, "）"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-role-add": true,
				onClick: addRole,
				disabled: busy
			}, "新增角色")), ordered.length === 0 ? /* @__PURE__ */ react.createElement("div", { "data-empty": true }, /* @__PURE__ */ react.createElement("p", null, "还没有任何角色。"), /* @__PURE__ */ react.createElement("p", { "data-empty-next": true }, "点「新增角色」建一个，或点「一键恢复默认角色」写回内置 6 个。")) : null, /* @__PURE__ */ react.createElement("div", { "data-role-list": true }, ordered.map((role) => {
				const problem = errors[role.id] ?? "";
				const confirming = pendingDelete === role.id;
				return /* @__PURE__ */ react.createElement("article", {
					key: role.id,
					"data-role-card": true,
					"data-role-id": role.id,
					"data-role-builtin": role.builtin ? "true" : "false",
					"data-error-state": problem !== "" ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("header", { "data-role-card-head": true }, /* @__PURE__ */ react.createElement("span", { "data-role-card-name": true }, role.name.trim() === "" ? "（未命名角色）" : role.name), /* @__PURE__ */ react.createElement("span", { "data-role-origin": true }, role.builtin ? "内置" : "自建"), role.builtin ? null : /* @__PURE__ */ react.createElement("span", { "data-role-actions": true }, /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-role-delete": true,
					disabled: busy,
					onClick: () => setPendingDelete(confirming ? void 0 : role.id)
				}, confirming ? "确认删除" : "删除"), confirming ? /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-role-delete-cancel": true,
					disabled: busy,
					onClick: () => setPendingDelete(void 0)
				}, "取消") : null)), confirming ? /* @__PURE__ */ react.createElement("div", {
					"data-role-delete-confirm": true,
					role: "alert"
				}, "删除「", role.name, "」后无法恢复（可重新新建）。", /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-role-delete-ok": true,
					disabled: busy,
					onClick: () => {
						setPendingDelete(void 0);
						props.onDelete(role.id);
					}
				}, "确认")) : null, /* @__PURE__ */ react.createElement("label", {
					"data-role-field": true,
					"data-role-field-name": true
				}, /* @__PURE__ */ react.createElement("span", { "data-role-field-label": true }, "名称"), /* @__PURE__ */ react.createElement("input", {
					"data-role-name-input": true,
					value: role.name,
					disabled: busy,
					onChange: (event) => patch(role.id, { name: event.target.value })
				})), /* @__PURE__ */ react.createElement("label", {
					"data-role-field": true,
					"data-role-field-duty": true
				}, /* @__PURE__ */ react.createElement("span", { "data-role-field-label": true }, "描述"), /* @__PURE__ */ react.createElement("input", {
					"data-role-duty-input": true,
					value: role.duty,
					disabled: busy,
					onChange: (event) => patch(role.id, { duty: event.target.value })
				})), /* @__PURE__ */ react.createElement("label", {
					"data-role-field": true,
					"data-role-field-prompt": true
				}, /* @__PURE__ */ react.createElement("span", { "data-role-field-label": true }, "提示词"), /* @__PURE__ */ react.createElement("textarea", {
					"data-role-prompt-input": true,
					rows: 4,
					value: role.prompt ?? "",
					disabled: busy,
					onChange: (event) => patch(role.id, { prompt: event.target.value })
				})), /* @__PURE__ */ react.createElement("div", {
					"data-role-field": true,
					"data-role-field-skills": true
				}, /* @__PURE__ */ react.createElement("span", { "data-role-field-label": true }, "技能"), /* @__PURE__ */ react.createElement("span", { "data-role-skill-list": true }, skills.length === 0 ? /* @__PURE__ */ react.createElement("span", { "data-role-skill-empty": true }, "（宿主未提供技能清单）") : null, skills.map((skill) => {
					const checked = role.skillIds.includes(skill.id);
					return /* @__PURE__ */ react.createElement("label", {
						key: skill.id,
						"data-role-skill": true,
						"data-checked": checked ? "true" : "false",
						title: skill.description
					}, /* @__PURE__ */ react.createElement("input", {
						type: "checkbox",
						"data-role-skill-input": skill.id,
						checked,
						disabled: busy,
						onChange: () => toggleSkill(role.id, skill.id)
					}), /* @__PURE__ */ react.createElement("span", { "data-role-skill-title": true }, skill.title));
				}))), /* @__PURE__ */ react.createElement("div", {
					"data-role-field": true,
					"data-role-field-model": true
				}, /* @__PURE__ */ react.createElement("span", { "data-role-field-label": true }, "默认模型"), /* @__PURE__ */ react.createElement("input", {
					"data-role-model-provider": true,
					placeholder: "provider",
					value: role.model?.provider ?? "",
					disabled: busy,
					onChange: (event) => patchModel(role.id, "provider", event.target.value)
				}), /* @__PURE__ */ react.createElement("input", {
					"data-role-model-name": true,
					placeholder: "model",
					value: role.model?.model ?? "",
					disabled: busy,
					onChange: (event) => patchModel(role.id, "model", event.target.value)
				}), /* @__PURE__ */ react.createElement("span", { "data-role-model-hint": true }, "留空 = 跟随会话默认")), problem !== "" ? /* @__PURE__ */ react.createElement("div", {
					"data-role-error": true,
					role: "alert"
				}, problem) : null, /* @__PURE__ */ react.createElement("div", { "data-role-card-actions": true }, /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-role-save": true,
					disabled: busy,
					onClick: () => save(role.id)
				}, "保存"), /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-role-reset": true,
					disabled: busy,
					onClick: () => {
						const source = roles.find((item) => item.id === role.id);
						setDrafts((previous) => ({
							...previous,
							[role.id]: asRole(source, role.id)
						}));
						setErrors((previous) => ({
							...previous,
							[role.id]: ""
						}));
					}
				}, "还原")));
			})), /* @__PURE__ */ react.createElement("div", { "data-roles-foot": true }, confirmRestore ? /* @__PURE__ */ react.createElement("span", {
				"data-roles-restore-confirm": true,
				role: "alert"
			}, "只把 6 个内置角色恢复为出厂定义；你自建的 ", ordered.filter((role) => !role.builtin).length, " 个角色不会被删除。", /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-roles-restore-ok": true,
				disabled: busy,
				onClick: () => {
					setConfirmRestore(false);
					props.onRestoreDefaults();
				}
			}, "恢复默认"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-roles-restore-cancel": true,
				disabled: busy,
				onClick: () => setConfirmRestore(false)
			}, "取消")) : /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-roles-restore": true,
				disabled: busy,
				onClick: () => setConfirmRestore(true)
			}, "一键恢复默认角色"), hint === void 0 ? null : /* @__PURE__ */ react.createElement("span", {
				"data-hint": true,
				role: "status"
			}, hint)));
		}
		// src/client/tabs/RolesTab.tsx
		/**
		* 面板「角色」页签（DESIGN §0.8-9 / TECHNICAL §4.7）。
		*
		* 本页签**只是一个容器**：编辑 UI 与校验全部在 `RoleEditor.tsx` 的 `RoleEditorList` 里，
		* 与设置页共用同一份组件（`density="panel"`）。历史上这里是独立的一套编辑器 ——
		* 那正是「面板改得动、设置里改不动」的来源，本轮把它收成一条链。
		*
		* 保存动作仍走 `act({type:'saveRole'})`：本文件不 import api、不发请求。
		*/
		function RolesTab(props) {
			const { snapshot, act } = props;
			const roles = snapshot?.roles ?? [];
			const skills = snapshot?.skills ?? [];
			const [busy, setBusy] = react.useState(false);
			const [hint, setHint] = react.useState(void 0);
			async function run(action, done) {
				setBusy(true);
				try {
					const feedback = await actFeedback(act, action);
					setHint(hintOf(feedback) ?? (feedback.ok ? done : "动作未生效"));
				} finally {
					setBusy(false);
				}
			}
			return /* @__PURE__ */ react.createElement("section", {
				"data-auto-team-roles": true,
				"data-density": "panel"
			}, hint === void 0 ? null : /* @__PURE__ */ react.createElement("div", {
				"data-hint": true,
				role: "status"
			}, hint), /* @__PURE__ */ react.createElement(RoleEditorList, {
				roles,
				skills,
				density: "panel",
				busy,
				onSave: (role) => void run({
					type: "saveRole",
					role
				}, `已保存角色「${role.name}」`),
				onDelete: (id) => void run({
					type: "deleteRole",
					roleId: id
				}, `已删除角色 ${id}`),
				onRestoreDefaults: () => void run({ type: "restoreDefaultRoles" }, "已把内置角色恢复为出厂定义")
			}));
		}
		// src/client/Panel.tsx
		/**
		* 自动团队右栏面板容器（`sidebar.right.pane.tab` + `.title`，DESIGN §1.1 E3）。
		*
		* 页头是这轮改造的门面，四条硬规矩：
		*  1. **`完成 x/N` + 计划状态 chip + 暂停/继续按钮** 一行（高度 40px，DESIGN §0.2）。
		*     数字全部由快照派生，组件里不存第二份计数。
		*  2. **暂停按钮非乐观更新**：点击只发 `act({type:'pause'|'resumeTeam'})` + 本地 busy，
		*     文案切换等宿主快照回来（`pauseButtonView` 的 label 只吃 `snapshot.paused`）。
		*     乐观改文案会让「点了没生效」看起来像生效，是本项目反复踩的坑。
		*  3. **暂停时不清门禁证据、不重排列表**（DESIGN §0.4）：任务行只由 PlanTab 按原顺序渲染。
		*  4. 页头几何在 320px 下限可读：`完成 999/999` 约 79px + badge + 按钮 ≈ 190px < 320px。
		*
		* 本文件只做「容器 + 页头 + 四个页签」，可见文案尽量下沉到 `ui.ts` / `viewmodel.ts`。
		*/
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
		/** 计划状态 / 语义色 → 宿主 tone 名（只做映射，文案与音调由 viewmodel 单点给）。 */
		const TONE_DATA = {
			ok: "success",
			run: "success",
			plan: "success",
			done: "success",
			warn: "warn",
			bad: "danger",
			fail: "danger",
			muted: "neutral",
			idle: "neutral",
			neutral: "neutral"
		};
		function Panel(props) {
			useAutoTeamStyle();
			const sessionId = sessionIdOf(props);
			const view = usePanelState(sessionId);
			const snapshot = view.snapshot ?? void 0;
			const [tab, setTab] = react.useState("plan");
			const [pauseBusy, setPauseBusy] = react.useState(false);
			const act = view.act;
			const error = view.error;
			const readMemory = react.useCallback(async (track, name) => {
				const api = panelApi;
				if (typeof api.readMemory !== "function") return { error: "宿主未提供记忆读取接口" };
				return await api.readMemory(sessionId, track, name);
			}, [sessionId]);
			const planReady = snapshot?.planStatus !== void 0;
			react.useEffect(() => {
				if (planReady) setTab("plan");
			}, [planReady]);
			react.useEffect(() => {
				if (typeof window === "undefined" || typeof window.addEventListener !== "function") return void 0;
				const onOpen = () => setTab("plan");
				window.addEventListener(OPEN_PANEL_EVENT, onOpen);
				return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen);
			}, []);
			const capsule = capsuleOf(snapshot?.enabled === true, snapshot);
			const captain = captainModelLabelOf(snapshot?.captainModel);
			const degraded = snapshot?.degraded === true;
			const degradeReason = (snapshot?.degradeReason ?? "").trim();
			const tasks = snapshot?.tasks ?? [];
			const total = tasks.length;
			const done = tasks.filter((task) => task.status === "done").length;
			const paused = snapshot?.paused === true;
			const pauseView = pauseButtonView({
				paused,
				busy: pauseBusy
			});
			const effectivePlanStatus = paused ? "paused" : snapshot?.planStatus;
			const planStatus = effectivePlanStatus === void 0 ? void 0 : planStatusView(effectivePlanStatus);
			async function togglePause() {
				if (pauseBusy) return;
				setPauseBusy(true);
				try {
					await act({ type: pauseView.action });
				} finally {
					setPauseBusy(false);
				}
			}
			return /* @__PURE__ */ react.createElement("div", {
				"data-auto-team-panel": true,
				"data-enabled": snapshot?.enabled === true ? "true" : "false",
				"data-paused": paused ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("div", { "data-panel-head": true }, /* @__PURE__ */ react.createElement("strong", { "data-panel-title": true }, "自动团队"), /* @__PURE__ */ react.createElement("span", {
				"data-head-capsule": true,
				"data-tone": TONE_DATA[capsule.tone] ?? "neutral",
				title: capsule.text
			}, capsule.text), /* @__PURE__ */ react.createElement("span", { "data-head-meta": true }, "计划 ", total, " · 成员 ", snapshot?.members.length ?? 0, " · 并发 ", snapshot?.concurrency?.running ?? 0, "/", snapshot?.concurrency?.limit ?? 0), /* @__PURE__ */ react.createElement("span", {
				"data-captain-model": true,
				"data-tone": captain.tone,
				title: captain.label
			}, captain.label), /* @__PURE__ */ react.createElement("span", {
				"data-auto-team-degraded": degraded ? "true" : "false",
				"data-tone": degraded ? "warn" : "neutral",
				title: degraded ? degradeReason : "四个宿主事件源都已订阅，Trigger 由事件即时推进"
			}, degraded ? `事件源降级${degradeReason !== "" ? `：${degradeReason}` : ""}` : "事件源正常"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				onClick: () => void view.refresh(),
				"data-panel-refresh": true
			}, "刷新")), /* @__PURE__ */ react.createElement("div", { "data-panel-progress-row": true }, /* @__PURE__ */ react.createElement("span", {
				"data-panel-progress": true,
				"data-done": done,
				"data-total": total
			}, "完成 ", done, "/", total), planStatus === void 0 ? null : /* @__PURE__ */ react.createElement("span", {
				"data-panel-plan-status": true,
				"data-tone": planStatus.tone
			}, planStatus.label), /* @__PURE__ */ react.createElement("span", { "data-panel-progress-spacer": true }), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-auto-team-pause": true,
				"data-action": pauseView.action,
				"data-tone": pauseView.tone,
				disabled: pauseView.disabled || snapshot === void 0,
				"aria-busy": pauseBusy ? "true" : "false",
				title: paused ? "从中断处继续推进（不重跑已完成任务）" : "暂停派发与推进（在跑成员不被打断）",
				onClick: () => void togglePause()
			}, pauseBusy ? /* @__PURE__ */ react.createElement("span", {
				"data-pause-spinner": true,
				"aria-hidden": "true"
			}) : null, /* @__PURE__ */ react.createElement("span", { "data-pause-label": true }, pauseView.label))), paused ? /* @__PURE__ */ react.createElement("div", {
				"data-panel-paused-banner": true,
				role: "status"
			}, /* @__PURE__ */ react.createElement("span", {
				"data-paused-icon": true,
				"aria-hidden": "true"
			}, "⏸"), /* @__PURE__ */ react.createElement("span", { "data-paused-text": true }, "已暂停：派发与推进已停止，在跑成员不被打断"), typeof snapshot?.pausedAt === "number" ? /* @__PURE__ */ react.createElement("span", { "data-paused-at": true }, formatClock(snapshot.pausedAt)) : null) : null, /* @__PURE__ */ react.createElement("div", {
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
		function formatClock(at) {
			const date = new Date(at);
			if (Number.isNaN(date.getTime())) return "";
			const pad = (value) => String(value).padStart(2, "0");
			return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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
		/**
		* 页签文案（AC-8 按文案判定，改字必须同步 PRD）。
		* 单点在 `slots.ts: PANEL_TAB_LABEL` —— 它同时喂给 `sidebarRightTabs` 类型定义的 `title`，
		* 两处各写一份就会出现「页签标题」与「类型标题」不一致（组件与类型分属两条渲染路径）。
		*/
		const TAB_TITLE_TEXT = PANEL_TAB_LABEL;
		function TabTitle() {
			return /* @__PURE__ */ react.createElement("span", {
				"data-auto-team-panel-tab": true,
				style: {
					font: "var(--dsw-font-xs-13, 13px/20px sans-serif)",
					whiteSpace: "nowrap",
					display: "inline-flex",
					alignItems: "center"
				}
			}, TAB_TITLE_TEXT);
		}
		// src/client/SettingsPage.tsx
		/**
		* 设置页（`settings.section` 挂载点，DESIGN §2.4 / TECHNICAL §4.6）。
		*
		* 两条硬规矩：
		*  1. **参数行（顺序 / 标签 / 范围提示）单点来自 `ui.settingsKeysView`** —— 本组件不再自写
		*     一套中文文案，否则设置页与面板里对同一个参数的叫法迟早分叉。
		*  2. **保存只能走 `act({type:'saveSettings'})`**：不新增 fetch、不新增路由。
		*     宿主 `settingsRepo.save` 是「先校验后原子写」的唯一入口，非法值在磁盘上逐字不变
		*     （AC-17）；客户端这份范围校验只是为了少跑一趟网络（文案与 host SETTINGS_LIMITS 对齐）。
		*
		* 角色区与面板角色页共用 `RoleEditorList`（同一个保存链，DESIGN §0.8-9）：
		* 这里只是换 `density="page"`（宽、大字号），行为完全一致。
		*/
		/** 与 host `src/host/config.ts` 的 `DEFAULT_SETTINGS` 逐字一致：仅在快照未带 settings 时兜底显示。 */
		const FALLBACK_SETTINGS = {
			concurrencyLimit: 3,
			memoryBudget: 4e3,
			stallMs: 9e4,
			maxAttempts: 3,
			gateTimeoutMs: 3e5
		};
		/** 与 host `src/host/config.ts` 的 `SETTINGS_LIMITS` 逐字一致（client 不能 import host）。 */
		const LIMITS = {
			concurrencyLimit: [1, 8],
			memoryBudget: [200, 4e3],
			stallMs: [1e3, 6e5],
			maxAttempts: [1, 10],
			gateTimeoutMs: [1e3, 6e5]
		};
		const NUMBER_KEYS = [
			"concurrencyLimit",
			"memoryBudget",
			"stallMs",
			"maxAttempts",
			"gateTimeoutMs"
		];
		function draftOf(settings) {
			return {
				concurrencyLimit: String(settings.concurrencyLimit),
				memoryBudget: String(settings.memoryBudget),
				stallMs: String(settings.stallMs),
				maxAttempts: String(settings.maxAttempts),
				gateTimeoutMs: String(settings.gateTimeoutMs),
				captainProvider: settings.captainModel?.provider ?? "",
				captainModel: settings.captainModel?.model ?? ""
			};
		}
		/** 返回 `{ key: message }`，空对象 = 全部合法。 */
		function validateDraft(draft) {
			const errors = {};
			for (const key of NUMBER_KEYS) {
				const raw = draft[key].trim();
				const [low, high] = LIMITS[key];
				if (raw === "") {
					errors[key] = "必填";
					continue;
				}
				const value = Number(raw);
				if (!Number.isFinite(value) || !Number.isInteger(value)) {
					errors[key] = "必须是整数";
					continue;
				}
				if (value < low || value > high) errors[key] = `取值范围 ${low}–${high}`;
			}
			const provider = draft.captainProvider.trim();
			const model = draft.captainModel.trim();
			if (provider === "" !== (model === "")) errors.captainModel = "provider 与 model 必须同时填写或同时留空";
			return errors;
		}
		function SettingsSection(props) {
			useAutoTeamStyle();
			const state = usePanelState(sessionIdOf(props));
			const settings = state.snapshot?.settings ?? FALLBACK_SETTINGS;
			const roles = state.snapshot?.roles ?? [];
			const skills = state.snapshot?.skills ?? [];
			const [draft, setDraft] = react.useState(() => draftOf(settings));
			const [errors, setErrors] = react.useState({});
			const [hint, setHint] = react.useState(void 0);
			const [busy, setBusy] = react.useState(false);
			const savedSignature = JSON.stringify(settings);
			const signatureRef = react.useRef(savedSignature);
			react.useEffect(() => {
				if (signatureRef.current === savedSignature) return;
				signatureRef.current = savedSignature;
				setDraft(draftOf(settings));
				setErrors({});
			}, [savedSignature]);
			const act = state.act;
			async function save() {
				const found = validateDraft(draft);
				setErrors(found);
				if (Object.keys(found).length > 0) {
					setHint("有参数不合法，未提交（磁盘上的设置保持原样）");
					return;
				}
				const next = {
					concurrencyLimit: Number(draft.concurrencyLimit.trim()),
					memoryBudget: Number(draft.memoryBudget.trim()),
					stallMs: Number(draft.stallMs.trim()),
					maxAttempts: Number(draft.maxAttempts.trim()),
					gateTimeoutMs: Number(draft.gateTimeoutMs.trim())
				};
				const provider = draft.captainProvider.trim();
				const model = draft.captainModel.trim();
				if (provider !== "" && model !== "") next.captainModel = {
					provider,
					model
				};
				setBusy(true);
				try {
					const feedback = await actFeedback(act, {
						type: "saveSettings",
						settings: next
					});
					setHint(hintOf(feedback) ?? (feedback.ok ? "设置已保存" : "保存失败"));
					if (feedback.ok) signatureRef.current = JSON.stringify(next);
				} finally {
					setBusy(false);
				}
			}
			function patch(key, value) {
				setDraft((previous) => ({
					...previous,
					[key]: value
				}));
				setErrors((previous) => {
					const target = key === "captainProvider" || key === "captainModel" ? "captainModel" : key;
					if (previous[target] === void 0) return previous;
					return {
						...previous,
						[target]: ""
					};
				});
			}
			async function roleAction(action, done) {
				setBusy(true);
				try {
					const feedback = await actFeedback(act, action);
					setHint(hintOf(feedback) ?? (feedback.ok ? done : "动作未生效"));
					if (feedback.ok) await state.refresh();
				} finally {
					setBusy(false);
				}
			}
			const rows = settingsKeysView(settings);
			return /* @__PURE__ */ react.createElement("section", {
				"data-auto-team-settings": true,
				"data-busy": busy ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("header", { "data-settings-head": true }, /* @__PURE__ */ react.createElement("h3", { "data-settings-title": true }, "自动团队"), /* @__PURE__ */ react.createElement("p", { "data-settings-intro": true }, "这些参数对整个 profile 生效；保存后立即应用（无需重启宿主）。")), /* @__PURE__ */ react.createElement("div", { "data-settings-grid": true }, rows.map((row) => {
				const key = row.key;
				const fieldId = `dsh-auto-team-setting-${key}`;
				const hintId = `${fieldId}-hint`;
				if (key === "captainModel") return /* @__PURE__ */ react.createElement("div", {
					key,
					"data-setting-row": true,
					"data-setting-key": key,
					"data-error-state": errors.captainModel ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("span", { "data-setting-label": true }, "队长默认模型"), /* @__PURE__ */ react.createElement("span", { "data-setting-inputs": true }, /* @__PURE__ */ react.createElement("input", {
					id: fieldId,
					"data-setting-input": "captainModel.provider",
					placeholder: "provider（留空 = 会话默认）",
					value: draft.captainProvider,
					disabled: busy,
					"aria-describedby": hintId,
					onChange: (event) => patch("captainProvider", event.target.value)
				}), /* @__PURE__ */ react.createElement("input", {
					"data-setting-input": "captainModel.model",
					placeholder: "model",
					value: draft.captainModel,
					disabled: busy,
					"aria-describedby": hintId,
					onChange: (event) => patch("captainModel", event.target.value)
				})), /* @__PURE__ */ react.createElement("span", {
					"data-setting-hint": true,
					id: hintId
				}, errors.captainModel ?? row.hint));
				const numberKey = key;
				return /* @__PURE__ */ react.createElement("div", {
					key,
					"data-setting-row": true,
					"data-setting-key": key,
					"data-error-state": errors[numberKey] ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("label", {
					"data-setting-label": true,
					htmlFor: fieldId
				}, row.label), /* @__PURE__ */ react.createElement("span", { "data-setting-inputs": true }, /* @__PURE__ */ react.createElement("input", {
					id: fieldId,
					"data-setting-input": key,
					inputMode: "numeric",
					value: draft[numberKey],
					disabled: busy,
					"aria-describedby": hintId,
					onChange: (event) => patch(numberKey, event.target.value)
				})), /* @__PURE__ */ react.createElement("span", {
					"data-setting-hint": true,
					id: hintId
				}, errors[numberKey] ?? row.hint));
			})), /* @__PURE__ */ react.createElement("div", { "data-settings-actions": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-settings-save": true,
				disabled: busy,
				onClick: () => void save()
			}, busy ? "保存中…" : "保存设置"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-settings-reload": true,
				disabled: busy,
				onClick: () => {
					setDraft(draftOf(settings));
					setErrors({});
					setHint("已还原为当前生效的设置");
				}
			}, "还原"), hint === void 0 ? null : /* @__PURE__ */ react.createElement("span", {
				"data-hint": true,
				role: "status"
			}, hint)), /* @__PURE__ */ react.createElement("hr", { "data-settings-divider": true }), /* @__PURE__ */ react.createElement("header", { "data-settings-roles-head": true }, /* @__PURE__ */ react.createElement("h4", { "data-settings-roles-title": true }, "团队角色"), /* @__PURE__ */ react.createElement("p", { "data-settings-roles-intro": true }, "角色的描述、提示词、技能与默认模型都可改；自建角色可删，内置角色可一键恢复出厂定义。")), /* @__PURE__ */ react.createElement(RoleEditorList, {
				roles,
				skills,
				density: "page",
				busy,
				onSave: (role) => void roleAction({
					type: "saveRole",
					role
				}, `已保存角色「${role.name}」`),
				onDelete: (id) => void roleAction({
					type: "deleteRole",
					roleId: id
				}, `已删除角色 ${id}`),
				onRestoreDefaults: () => void roleAction({ type: "restoreDefaultRoles" }, "已把内置角色恢复为出厂定义")
			}));
		}
		// src/client/index.ts
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
		const inject = ["slots"];
		function apply(ctx) {
			if (!ctx?.slots?.register) return;
			registerPanelTab(ctx);
			registerSlots(ctx, {
				Option: AutoTeamOption,
				HeaderButton: AutoTeamHeaderButton,
				Panel,
				PanelTitle: TabTitle,
				SettingsSection,
				openPanel: createOpenPanel(ctx)
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
