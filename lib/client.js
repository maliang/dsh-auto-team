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
		/**
		* 技能正文长度上限（字符，r10 AC-19）。
		*
		* 放在 shared 而不是 host/config.ts：**客户端编辑弹层要先拦**（否则用户敲到一半才被宿主拒绝），
		* 宿主 `roles/skills-repo.ts` 还要再校验一次（不信任客户端）。两处必须是同一个数，
		* 否则会出现「界面放行、宿主拒绝」的错位——这正是本文件存在的理由（单一定义、两处可见）。
		*/
		const SKILL_BODY_MAX = 2e4;
		// src/client/slots.ts
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
		/** E1 输入框左侧胶囊选项（非 keyed，AC-1）。 */
		const INPUT_LEFT_SLOT = "conversation.input.left";
		/** E2 会话头按钮（非 keyed，AC-11）。 */
		const HEADER_ACTIONS_SLOT = "conversation.session.header.actions";
		/** E3 右栏「自动团队」面板页签（**keyed**）。 */
		const PANEL_SLOT = "sidebar.right.pane.tab";
		/** E3 上面那个页签的标题位（**keyed**，与 body 同 key）。 */
		const PANEL_TITLE_SLOT = "sidebar.right.pane.tab.title";
		/** E4 设置页的「自动团队」分区（非 keyed，root 作用域）。 */
		const SETTINGS_SECTION_SLOT = "settings.section";
		/** E1 座位 id。 */
		const OPTION_ID = `${PLUGIN_ID}-option`;
		/** E2 座位 id。 */
		const HEADER_ID = `${PLUGIN_ID}-header-button`;
		/** E4 座位 id（宿主按它去重，同一个 id 注册两次会覆盖）。 */
		const SECTION_ID = PLUGIN_ID;
		/** E4 分区标题（宿主设置页左侧导航显示它）。 */
		const SECTION_LABEL = "自动团队";
		/** 页签文案（AC-11 按文案判定，改字必须同步 PRD）。`TabTitle.tsx` 也取它，防两处漂移。 */
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
		/** 页签句柄里「是不是本插件」的判据：kind / id / tabId 任一等于页签类型。 */
		function isMine(tab) {
			if (tab === null || typeof tab !== "object") return false;
			const handle = tab;
			return handle.kind === PANEL_TAB_KIND || handle.id === PANEL_TAB_KIND || handle.tabId === PANEL_TAB_KIND;
		}
		/** 从页签句柄里取 closeIn 需要的 id（三种字段名都试，取不到返回空串）。 */
		function tabIdOf(tab) {
			if (tab === null || typeof tab !== "object") return "";
			const handle = tab;
			const candidates = [
				handle.tabId,
				handle.id,
				handle.kind
			];
			for (const candidate of candidates) if (typeof candidate === "string" && candidate !== "") return candidate;
			return "";
		}
		/**
		* 生成面板的三条命令（唯一实现点）。
		*
		* 服务用 `ctx.inject(['sidebarRight'], cb)` 捕获：`ctx.get` 在 client 半是禁用的
		* （`test/client-contract.test.ts` 有计数断言），且服务稍后就绪时 `inject` 回调仍会被调用。
		*/
		function createPanelCommands(ctx) {
			let right;
			if (typeof ctx.inject === "function") ctx.inject(["sidebarRight"], (scope) => {
				const found = scope.sidebarRight;
				if (found === void 0) return;
				right = found;
			});
			function mineOf(sessionId) {
				if (right === void 0 || typeof right.tabsIn !== "function") return void 0;
				let tabs;
				try {
					tabs = right.tabsIn(sessionId) ?? [];
				} catch {
					return;
				}
				for (const tab of tabs) if (isMine(tab)) return {
					tab,
					id: tabIdOf(tab)
				};
			}
			return {
				open(_sessionId) {
					const service = right;
					if (service === void 0 || typeof service.openTab !== "function") return false;
					try {
						service.openTab(PANEL_TAB_KIND);
						return true;
					} catch {
						return false;
					}
				},
				close(sessionId) {
					const service = right;
					if (service === void 0) return false;
					const mine = mineOf(sessionId);
					if (mine !== void 0) {
						const domain = service.tabDomain;
						if (domain !== void 0 && typeof domain.occurrence === "function") try {
							const closeAction = domain.occurrence(sessionId, mine.tab)?.tabActions?.close;
							if (typeof closeAction === "function") {
								closeAction();
								return true;
							}
						} catch {}
					}
					if (mine !== void 0 && typeof service.closeIn === "function" && mine.id !== "") try {
						service.closeIn(sessionId, mine.id);
						return true;
					} catch {
						return false;
					}
					return false;
				},
				isOpen(sessionId) {
					const service = right;
					if (service === void 0 || typeof service.tabsIn !== "function") return void 0;
					return mineOf(sessionId) !== void 0;
				}
			};
		}
		/**
		* `slots.register` 的 `inject`：宿主把当次 sessionId 传进来，原样交给组件
		* （组件侧 `state.ts` 的 `sessionIdOf` 读 `props.sessionId`）。
		* 只此一份实现 —— 四个可见面必须拿到同一个 sessionId（同一个 store、同一份快照）。
		*/
		function sessionIdBag(sessionId, extras = {}) {
			return {
				sessionId,
				...extras
			};
		}
		/**
		* 注册全部挂载点。`deps` 只为让测试注入桩组件；生产由 `index.ts` 传真组件。
		* 挂载点不存在时 `slots.inject` 是 inert 的（回调不会被调），因此注册它零副作用。
		*/
		function registerSlots(ctx, deps) {
			const commands = createPanelCommands(ctx);
			const openPanel = deps.openPanel ?? (() => commands.open("current"));
			const closePanel = deps.closePanel ?? ((sessionId) => commands.close(sessionId));
			const isPanelOpen = deps.isPanelOpen ?? ((sessionId) => commands.isOpen(sessionId));
			const injectOf = (sessionId) => sessionIdBag(sessionId);
			ctx.slots.inject(INPUT_LEFT_SLOT, () => {
				ctx.slots.register({
					name: INPUT_LEFT_SLOT,
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
					inject: (sessionId) => sessionIdBag(sessionId, {
						openPanel,
						closePanel: () => closePanel(sessionId),
						isPanelOpen: () => isPanelOpen(sessionId)
					})
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
		*   ③ 页面型页签**只注册不会自己出现**，还要 `sidebarRight.openTab(kind)` 打开（见 `createPanelCommands`）。
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
		* 生成「打开面板」动作（r7 兼容入口）：`createPanelCommands(ctx).open` 的薄封装。
		*
		* 历史缺陷形态：`Toggle.tsx` 原先断言「宿主未提供激活某页签的对外动作」，只 `window.dispatchEvent`
		* 一个自己定义的事件 —— 页签尚未打开时没有任何监听者，等于按钮无效。返回 `false` 表示宿主服务不可用，
		* 组件据此回退旧行为。
		*/
		function createOpenPanel(ctx) {
			const commands = createPanelCommands(ctx);
			return () => commands.open("current");
		}
		/**
		* 左栏栏目槽位（非 keyed）：宿主侧栏里的一个可折叠条目。
		*
		* 判定依据是 `docs/teamflow/architecture/UI-SLOTS.md`（106 个槽位里唯一一个侧栏「列表」座位），
		* 字段集合沿用同机样本 `dsh-better-sidebar`（非 keyed → `{ name, id, order, label, inject }`）。
		*/
		const PANELLIST_SLOT = "sidebar.panellist";
		/**
		* 主区页面槽位（**keyed**，key 与栏目 id 同值）：点左栏条目后在主区展开整页项目库。
		*
		* **未验证**（TECHNICAL §0 U2）：`main` 对第三方插件是否开放只有真机才知道。
		* 因此注册整段 try/catch，失败只 warn 并降级为「面板内联项目库」，绝不连累其它槽位。
		*/
		const MAIN_SLOT = "main";
		/** 左栏栏目的 id，同时用作 `main` 槽位的 key（同一个值，两处不复述）。 */
		const PANELLIST_ID = `${PLUGIN_ID}-panellist`;
		/** 左栏栏目文案（宿主侧栏里那一行显示它）。 */
		const PANELLIST_LABEL = "自动团队";
		/**
		* 「左栏项目库」的窗口事件名（降级通道）。
		*
		* 正常路径是 `mainArea.open(PANELLIST_ID)`；拿不到主区服务时退化成这个事件，
		* 由 `Panel.tsx` 监听后在右栏内联渲染同一份项目库（同一套组件、同一份 `LibraryView`）。
		* 常量放这里而不是组件文件：`slots.ts` 不 import 任何 `.tsx`，
		* 组件与测试都能引它，且不会形成 `slots ↔ LibraryPage` 的运行时环。
		*/
		const OPEN_LIBRARY_EVENT = "auto-team:open-library";
		function warnSlot(name, error) {
			const message = error instanceof Error ? error.message : String(error);
			if (typeof console !== "undefined" && typeof console.warn === "function") console.warn(`[dsh-auto-team] 槽位「${name}」注册失败，已降级：${message}`);
		}
		/**
		* 生成「打开左栏项目库」动作。
		*
		* 两级：先 `mainArea.open(PANELLIST_ID)`；没有该服务（或它抛错）时派发 `OPEN_LIBRARY_EVENT`。
		* 返回 `false` 表示走了事件降级 —— 调用方可据此提示「在右栏打开」而不是假装成功。
		*/
		function createOpenLibrary(ctx) {
			let face;
			if (typeof ctx.inject === "function") try {
				ctx.inject(["mainArea"], (scope) => {
					const service = scope.mainArea;
					if (service !== void 0) face = service;
				});
			} catch {
				face = void 0;
			}
			return () => {
				if (face !== void 0 && typeof face.open === "function") try {
					face.open(PANELLIST_ID);
					return true;
				} catch {}
				if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent(OPEN_LIBRARY_EVENT, { detail: { id: PANELLIST_ID } }));
				return false;
			};
		}
		/**
		* 注册左栏栏目（`sidebar.panellist`）与主区页面（`main`，keyed）。
		*
		* 返回两个布尔值而不是 void：`index.ts` 与 QA 探针都要能判断「这次是不是真的挂上了」，
		* 也能在真机日志里区分「槽位缺失」与「组件没渲染」。
		*/
		function registerPanellist(ctx, deps) {
			const result = {
				panellist: false,
				main: false
			};
			if (ctx === void 0 || ctx === null || ctx.slots === void 0) return result;
			const openLibrary = createOpenLibrary(ctx);
			const injectOf = (sessionId) => sessionIdBag(sessionId, { openLibrary });
			try {
				ctx.slots.inject(PANELLIST_SLOT, () => {
					ctx.slots.register({
						name: PANELLIST_SLOT,
						id: PANELLIST_ID,
						order: 20,
						label: PANELLIST_LABEL,
						inject: injectOf
					}, deps.PanellistEntry);
				});
				result.panellist = true;
			} catch (error) {
				warnSlot(PANELLIST_SLOT, error);
			}
			try {
				ctx.slots.register({
					name: MAIN_SLOT,
					key: PANELLIST_ID,
					inject: injectOf
				}, deps.LibraryPage);
				result.main = true;
			} catch (error) {
				try {
					ctx.slots.register({
						name: MAIN_SLOT,
						inject: injectOf
					}, deps.LibraryPage);
					result.main = true;
				} catch (inner) {
					warnSlot(MAIN_SLOT, inner);
				}
			}
			return result;
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
  max-height: 300px;
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-1, transparent);
}
[data-region="task-flow"] [data-flow-inner] {
  position: relative;
  min-width: 100%;
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
[data-region="task-flow"] [data-flow-arrow] {
  fill: var(--dsw-alias-border-l3, currentColor);
}
[data-region="task-flow"] [data-flow-node] {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  width: 148px;
  height: 56px;
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
[data-region="task-flow"] [data-flow-id] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11px;
  line-height: 16px;
}
[data-region="task-flow"] [data-flow-dot] {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-left: auto;
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
[data-region="task-flow"] [data-flow-legend] {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 6px 0 0;
  color: var(--dsw-alias-label-tertiary, inherit);
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
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-body] {
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
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-library-body] {
    flex-direction: column;
  }
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-region="project-list"] {
    flex: 0 0 auto;
    max-height: 168px;
    border-right: 0;
    border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  }
}
@media (max-width: 719px) {
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-library-body] {
    flex-direction: column;
  }
  :is([data-auto-team-library], [data-auto-team-panellist]) [data-region="project-list"] {
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
				readMemory(sessionId, track, name, workspace) {
					const query = `track=${encodeURIComponent(track)}&name=${encodeURIComponent(name)}&sessionId=${encodeURIComponent(sessionId)}${workspace === void 0 || workspace === "" ? "" : `&workspace=${encodeURIComponent(workspace)}`}`;
					return request(`${BRIDGE_ROUTE}/memory?${query}`);
				},
				library(sessionId, runId) {
					const query = `sessionId=${encodeURIComponent(sessionId)}${runId === void 0 || runId === "" ? "" : `&runId=${encodeURIComponent(runId)}`}`;
					return request(`${BRIDGE_ROUTE}/library?${query}`);
				},
				readSkill(sessionId, id) {
					const query = `track=skill&name=${encodeURIComponent(id)}&sessionId=${encodeURIComponent(sessionId)}`;
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
		*  - 开关胶囊（工具条左侧）与面板（右栏页签）各自 hook 一次，
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
		/** 结构相等（library / detail 用；引用相同直接短路，避免每次都 JSON 序列化）。 */
		function equalValue(a, b) {
			if (a === b) return true;
			if (a === null || b === null || a === void 0 || b === void 0) return false;
			try {
				return JSON.stringify(a) === JSON.stringify(b);
			} catch {
				return false;
			}
		}
		function createPanelStore(api, options = {}) {
			const idleMs = Math.max(200, options.idleMs ?? 5e3);
			const activeMs = Math.max(200, options.activeMs ?? 2e3);
			const listeners = /* @__PURE__ */ new Set();
			let view = {
				sessionId: options.sessionId !== void 0 && options.sessionId !== "" ? options.sessionId : "current",
				snapshot: null,
				loading: true,
				error: null,
				library: null,
				libraryError: null,
				detail: null,
				detailRunId: null
			};
			const now = options.now ?? Date.now;
			let timer = null;
			let inflight = null;
			let disposed = false;
			let watchingVisibility = false;
			/** 最近一次成功拿到快照的时刻（用于"刚取过就别重复取"，React StrictMode 双挂载时不打双份请求）。 */
			let lastDataAt = Number.NEGATIVE_INFINITY;
			/**
			* library 的缓存与单飞（r13 AC-23）。
			*
			* key = runId（空串表示"列表"）。**缓存必须是 store 内部的**：放在组件里就等于每个挂载面
			* 各缓存一份，右栏与左栏会各自打一份请求，还可能显示不同时刻的项目列表。
			*/
			const libraryAt = /* @__PURE__ */ new Map();
			const libraryInflight = /* @__PURE__ */ new Map();
			/** 已装配过的历史详情（runId → RunDetailView）：同一条历史反复点开不再请求。 */
			const detailCache = /* @__PURE__ */ new Map();
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
				if (!(next.sessionId !== view.sessionId || next.loading !== view.loading || next.error !== view.error || next.libraryError !== view.libraryError || next.detailRunId !== view.detailRunId || !sameSnapshot(next.snapshot, view.snapshot) || !equalValue(next.library, view.library) || !equalValue(next.detail, view.detail))) return;
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
					libraryAt.clear();
					detailCache.clear();
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
			/**
			* 按需加载项目库（r13 AC-23）。**只有左栏 / 历史详情会调它** —— snapshot 轮询永不触发，
			* 这是 AC-23「snapshot 期间零 library 装配」在客户端这边的保证。
			*/
			function loadLibrary(runId) {
				if (disposed) return Promise.resolve();
				const key = runId === void 0 ? "" : runId;
				const pending = libraryInflight.get(key);
				if (pending !== void 0) return pending;
				const at = libraryAt.get(key);
				if (at !== void 0 && now() - at < 5e3) return Promise.resolve();
				const sessionId = view.sessionId;
				const request = api.library(sessionId, runId === void 0 || runId === "" ? void 0 : runId).then((result) => {
					if (disposed) return;
					if (result.error !== void 0) {
						setView({ libraryError: result.error });
						return;
					}
					const lib = result.data ?? null;
					libraryAt.set(key, now());
					if (key === "") {
						setView({
							library: lib,
							libraryError: null
						});
						return;
					}
					const detail = lib?.detail ?? null;
					if (detail === null) {
						setView({
							library: lib ?? view.library,
							libraryError: `没有找到运行 ${key} 的历史详情（可能已被清理）`,
							detail: null,
							detailRunId: key
						});
						return;
					}
					detailCache.set(key, detail);
					setView({
						library: lib ?? view.library,
						libraryError: null,
						detail,
						detailRunId: key
					});
				}).catch((error) => {
					if (disposed) return;
					setView({ libraryError: `项目库不可达：${error instanceof Error ? error.message : String(error)}` });
				}).finally(() => {
					libraryInflight.delete(key);
				});
				libraryInflight.set(key, request);
				return request;
			}
			/** 打开一条历史 run：先看 memory 缓存（5s 内同一 run 不重复打），未命中才走 loadLibrary。 */
			function openRun(runId) {
				if (disposed) return Promise.resolve();
				const cached = detailCache.get(runId);
				if (cached !== void 0) {
					setView({
						detail: cached,
						detailRunId: runId,
						libraryError: null
					});
					return Promise.resolve();
				}
				if (view.detailRunId !== runId) setView({
					detail: null,
					detailRunId: runId
				});
				return loadLibrary(runId);
			}
			function closeRun() {
				if (disposed) return;
				setView({
					detail: null,
					detailRunId: null
				});
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
				loadLibrary,
				openRun,
				closeRun,
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
				act: store.act,
				loadLibrary: store.loadLibrary,
				openRun: store.openRun,
				closeRun: store.closeRun
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
		// src/shared/task-actions.ts
		const ALLOW = {
			allow: true,
			reason: ""
		};
		function deny(reason) {
			return {
				allow: false,
				reason
			};
		}
		/**
		* 13 态 × 3 动作的裁决表（DESIGN §3.4 逐格照抄）。
		*
		* 口径来源（PRD AC-26 + 技术方案 §7.1）：
		*  - `cancel`：pending/blocked/ready/waiting/running/rework/failed 允许；
		*  - `skip`：只有还没开跑的 pending/blocked/ready/waiting 允许（running 要先取消）；
		*  - `edit-acceptance`：除 cancelled/skipped 之外都允许；`done` 也允许（r13 PRD 取代
		*    r11#AC-26）—— 宿主对 `done` 走「确认 → 落新命令 → 重跑门禁」，不在允许表里一刀切拒绝。
		* `paused` / `gate` / `interrupted` 的取消与跳过不改：门禁在跑时有回执写回竞态，
		* 暂停有页头统一还原，中断的出路是续聊或改验收后重派。
		*/
		const MATRIX = {
			pending: {
				cancel: ALLOW,
				skip: ALLOW,
				acceptance: ALLOW
			},
			ready: {
				cancel: ALLOW,
				skip: ALLOW,
				acceptance: ALLOW
			},
			blocked: {
				cancel: ALLOW,
				skip: ALLOW,
				acceptance: ALLOW
			},
			waiting: {
				cancel: ALLOW,
				skip: ALLOW,
				acceptance: ALLOW
			},
			running: {
				cancel: ALLOW,
				skip: deny("运行中请先取消"),
				acceptance: ALLOW
			},
			rework: {
				cancel: ALLOW,
				skip: deny("待返工：请重跑或取消"),
				acceptance: ALLOW
			},
			failed: {
				cancel: ALLOW,
				skip: deny("已失败：请重跑或取消"),
				acceptance: ALLOW
			},
			interrupted: {
				cancel: deny("已中断：请续聊或改验收后重跑"),
				skip: deny("已中断：请续聊"),
				acceptance: ALLOW
			},
			gate: {
				cancel: deny("门禁执行中，等门禁结束"),
				skip: deny("门禁执行中"),
				acceptance: ALLOW
			},
			paused: {
				cancel: deny("已暂停：先点页头『继续任务』"),
				skip: deny("已暂停：先继续任务"),
				acceptance: ALLOW
			},
			done: {
				cancel: deny("已完成，无需取消"),
				skip: deny("已完成"),
				acceptance: ALLOW
			},
			cancelled: {
				cancel: deny("已取消"),
				skip: deny("已取消"),
				acceptance: deny("已取消")
			},
			skipped: {
				cancel: deny("已跳过"),
				skip: deny("已跳过"),
				acceptance: deny("已跳过")
			}
		};
		Object.fromEntries(Object.keys(MATRIX).map((status) => {
			const row = MATRIX[status];
			return [status, {
				cancel: row.cancel.allow,
				skip: row.skip.allow,
				acceptance: row.acceptance.allow
			}];
		}));
		/**
		* 13 条状态中文标签（互不重复）。徽标、任务行、宿主的拒绝文案都读这一张表。
		*
		* 红只给 `failed` / `interrupted`（tone 在 viewmodel 里）；取消与跳过是用户主动行为，用中性色。
		*/
		const TASK_STATUS_LABELS = {
			pending: "待派发",
			ready: "就绪",
			blocked: "阻塞",
			waiting: "等待中",
			running: "运行中",
			rework: "待返工",
			failed: "失败",
			interrupted: "已中断",
			gate: "门禁中",
			paused: "已暂停",
			done: "已通过",
			cancelled: "已取消",
			skipped: "已跳过"
		};
		// src/client/viewmodel.ts
		/**
		* 面板的**纯视图模型**：没有 JSX、没有 React、没有 IO。
		*
		* 存在的理由（TECHNICAL §6 / DESIGN §0.4）：AC-18 的「成员已死但面板还显示运行中」、
		* AC-22 的「逐角色模型逐字展示 + 未下发标注」这些**可核验文本**原先长在带 JSX 的组件里，
		* 只能靠 QA 眼看。抽到这里之后 `node --test` 就能直接断言文案与状态映射。
		*
		* 纪律：
		*  1. 单向流动 —— viewmodel 出文案，组件只渲染。组件里**禁止**再写一份状态→文案的映射表
		*     （同一状态两处文案必然漂移，是本项目的历史 bug 族）。
		*  2. 数据只读不造 —— 缺字段一律给保守默认值（见 viewExtras），绝不用 `!` 强断。
		*  3. 纯函数 —— 同样的输入永远同样的输出，时间由调用方传入（便于单测固定）。
		*/
		/** 成员状态（7 态）∪ 任务状态（13 态）的完整映射表 —— **全项目唯一一份**。 */
		const BADGES = {
			running: {
				icon: "●",
				text: TASK_STATUS_LABELS.running,
				tone: "business"
			},
			blocked: {
				icon: "⛓",
				text: TASK_STATUS_LABELS.blocked,
				tone: "warn"
			},
			rework: {
				icon: "↺",
				text: TASK_STATUS_LABELS.rework,
				tone: "warn"
			},
			done: {
				icon: "✓",
				text: TASK_STATUS_LABELS.done,
				tone: "success"
			},
			failed: {
				icon: "✕",
				text: TASK_STATUS_LABELS.failed,
				tone: "danger"
			},
			interrupted: {
				icon: "⚡",
				text: TASK_STATUS_LABELS.interrupted,
				tone: "danger"
			},
			pending: {
				icon: "·",
				text: TASK_STATUS_LABELS.pending,
				tone: "neutral"
			},
			ready: {
				icon: "▸",
				text: TASK_STATUS_LABELS.ready,
				tone: "business"
			},
			gate: {
				icon: "⚖",
				text: TASK_STATUS_LABELS.gate,
				tone: "warn"
			},
			paused: {
				icon: "⏸",
				text: TASK_STATUS_LABELS.paused,
				tone: "warn"
			},
			waiting: {
				icon: "⏳",
				text: TASK_STATUS_LABELS.waiting,
				tone: "warn"
			},
			cancelled: {
				icon: "⊘",
				text: TASK_STATUS_LABELS.cancelled,
				tone: "neutral"
			},
			skipped: {
				icon: "↷",
				text: TASK_STATUS_LABELS.skipped,
				tone: "neutral"
			},
			idle: {
				icon: "○",
				text: "空闲",
				tone: "neutral"
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
			const effective = limit !== void 0 && limit > 0 ? limit : FALLBACK_CONCURRENCY_LIMIT;
			const requested = num$1(raw.requested);
			return {
				limit: effective,
				running: running !== void 0 && running >= 0 ? running : countRunning(tasks),
				source: raw.source === "host" ? "host" : "default",
				requested: requested !== void 0 && requested > 0 ? requested : effective,
				clamped: requested !== void 0 && requested > effective
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
		/** 路由文案：`provider/model #effort`，逐字不省略（AC-22）。 */
		function routeTextOf(route) {
			if (route === null || route === void 0) return "";
			const provider = (route.provider ?? "").trim();
			const model = (route.model ?? "").trim();
			if (provider === "" && model === "") return "";
			return `${provider}/${model}${route.reasoningEffort !== void 0 ? ` #${route.reasoningEffort}` : ""}`;
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
		* `TaskStatus` 13 态 → 进度值与颜色（**全项目唯一一份**，AC-14 判据落在 progressOf 上）。
		*
		* label 一律从 `statusBadge` 取，这里**不再写第二遍中文** —— 同一状态两处文案必然漂移。
		* percent 口径：待派发 0 → 就绪 10 → 阻塞/等待 20 → 待返工 40 → 运行中/已暂停 50 →
		* 门禁中 80 → 已通过 100；失败/已中断/已取消/已跳过归 0（要重跑，进度不保留）。
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
			waiting: {
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
			cancelled: {
				tone: "muted",
				percent: 0
			},
			skipped: {
				tone: "muted",
				percent: 0
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
		* 放在 viewmodel 而不是 ui/组件里的理由：13 态中文标签的守卫判据是「只许出现在
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
		/**
		* 等待条文案（AC-20）：**原样返回快照里的 `waitReason`**，不 trim、不拼接、不截断。
		*
		* 宿主已经写明「等待 t2 释放 src/host/bridge.ts」；客户端只要在它前面凑一个字，
		* 逐字断言就会在无害重构后失效（DESIGN §0.1「零拼装」）。
		*/
		function waitReasonOf(task) {
			const raw = task.waitReason;
			return typeof raw === "string" ? raw : "";
		}
		/**
		* 状态词常量（**不是格式化**）：宿主 `format.ts` 负责算文本，这里只负责在宿主没给文本时
		* 不发明、不补 0 —— 「不可得」与「未开始」是两种不同的事实，混用会让人以为计划没跑。
		*/
		const UNAVAILABLE_TEXT = "不可得";
		const NOT_STARTED_TEXT = "未开始";
		/** 千分位分组：与宿主 `format.ts` 的 `groupDigits` 逐字一致（客户端唯一的数字分组实现）。 */
		function groupDigits(digits) {
			return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}
		/** 可用数字（有限、非负）。`0` 合法 —— 「花了 0 token」是真话，不是缺失。 */
		function usableNumber(value) {
			return typeof value === "number" && Number.isFinite(value) && value >= 0;
		}
		function fullTokenText(total) {
			if (!usableNumber(total)) return UNAVAILABLE_TEXT;
			return groupDigits(String(Math.round(total)));
		}
		function oneDecimal(value) {
			const text = value.toFixed(1);
			return text.endsWith(".0") ? text.slice(0, -2) : text;
		}
		function compactTokenText(total) {
			if (!usableNumber(total)) return UNAVAILABLE_TEXT;
			const value = Math.round(total);
			if (value < 1e3) return String(value);
			if (value < 1e6) return `${oneDecimal(value / 1e3)}k`;
			return `${oneDecimal(value / 1e6)}M`;
		}
		/**
		* token 单元格文本：`provider` 走千分位，`unavailable` 一律「不可得」。
		*
		* 为什么不显示 `-` 或 `0`：`-` 会被读成「还没跑」，`0` 会被读成「跑了但没花 token」，
		* 两者都是假话；「不可得」是唯一诚实的第三种状态（DESIGN §2.2）。
		*/
		function tokenTextOf(cell) {
			if (!cell || cell.source !== "provider") return UNAVAILABLE_TEXT;
			return fullTokenText(cell.tokens?.total);
		}
		/** 流转节点第二行用的紧凑 token（宽 128px）；超过 7 字符时由调用方降级到它。 */
		function compactTokenTextOf(cell) {
			if (!cell || cell.source !== "provider") return UNAVAILABLE_TEXT;
			return compactTokenText(cell.tokens?.total);
		}
		/** token 单元格的 `title`：不可得时给原因，可得时给输入/输出明细。 */
		function tokenTitleOf(cell) {
			if (!cell || cell.source !== "provider") return cell?.reason ?? "该处没有用量来源";
			const parts = [`合计 ${fullTokenText(cell.tokens?.total)} token`];
			if (usableNumber(cell.tokens?.input)) parts.push(`输入 ${fullTokenText(cell.tokens?.input)}`);
			if (usableNumber(cell.tokens?.output)) parts.push(`输出 ${fullTokenText(cell.tokens?.output)}`);
			return parts.join(" · ");
		}
		/** 用时文本：**只读**宿主下发的 `text`，客户端不拼「分 / 小时」（AC-7 的 grep 断言靠这条成立）。 */
		function durationTextOf(cell) {
			return cell?.text ?? "不可得";
		}
		/** 用时单元格的 `title`。 */
		function durationTitleOf(cell) {
			if (!cell) return "没有用时记录";
			switch (cell.state) {
				case "not-started": return "任务尚未开始";
				case "running": return "正在计时";
				case "unavailable": return "没有开始时间，算不出用时";
				default: return `开始 ${formatStamp(cell.startAt)} · 结束 ${formatStamp(cell.endAt)}`;
			}
		}
		/** 缺单元格时的兜底：保留原因，不冒充 0。 */
		function usageCellOr(cell, reason) {
			return cell ?? {
				source: "unavailable",
				reason
			};
		}
		const INFLIGHT_TEXT = {
			dispatching: "正在派发…",
			dispatched: "已派发",
			idle: "自动派发已开启"
		};
		function inflightOf(state) {
			const normalized = state in INFLIGHT_TEXT ? state : "idle";
			return {
				state: normalized,
				text: INFLIGHT_TEXT[normalized],
				dot: normalized !== "idle"
			};
		}
		function runHeadOf(detail, inflight = "idle") {
			const status = planStatusView(detail.planStatus);
			const inflightView = inflightOf(inflight);
			const head = {
				runId: detail.runId,
				planStatusLabel: status.label,
				planStatusTone: status.tone,
				plannedAtText: detail.plannedAt ? `计划于 ${formatStamp(detail.plannedAt)}` : "计划时间未记录",
				windowText: `${detail.plannedAt ? formatClock$1(detail.plannedAt) : "--:--:--"} → ${detail.finishedAt ? formatClock$1(detail.finishedAt) : "进行中"}`,
				durationText: durationTextOf(detail.duration),
				durationState: detail.duration?.state ?? "unavailable",
				usageText: tokenTextOf(detail.usage),
				usageSource: detail.usage?.source ?? "unavailable",
				usageTitle: tokenTitleOf(detail.usage),
				inflightText: inflightView.text,
				inflightState: inflightView.state
			};
			if (head.usageSource !== "provider") head.downgrade = `token ${UNAVAILABLE_TEXT}（无用量来源）`;
			return head;
		}
		function roleChipsOf(roles) {
			return roles.map((role) => ({
				roleId: role.roleId,
				name: role.name,
				taskCount: role.tasks,
				usageText: tokenTextOf(role.usage),
				usageSource: role.usage?.source ?? "unavailable",
				usageTitle: `${role.name} · ${role.tasks} 个任务 · ${tokenTitleOf(role.usage)}`
			}));
		}
		/** 任务表表头文案（表头与第二行共用同一网格，见 DESIGN §2.1）。 */
		const TASK_TABLE_HEADER = {
			left: "任务 · 角色 · 状态",
			token: "token",
			duration: "用时"
		};
		function taskRowOf(task, expanded) {
			return {
				id: task.id,
				title: task.title,
				badge: statusBadge(task.status),
				roleName: task.roleName || task.roleId,
				tokenText: tokenTextOf(task.usage),
				tokenSource: task.usage.source,
				tokenTitle: tokenTitleOf(task.usage),
				durationText: durationTextOf(task.duration),
				durationState: task.duration.state,
				durationTitle: durationTitleOf(task.duration),
				expanded
			};
		}
		/** 展开区的内容（键值行）。没有的东西给「未声明 / 无」，不留空行。 */
		function taskDetailOf(task) {
			const panel = {
				acceptance: task.acceptance?.trim() || "（未声明验收命令）",
				dependsText: task.dependsOn.length > 0 ? task.dependsOn.join(" / ") : "无前置任务",
				scopeText: task.writeScopes && task.writeScopes.length > 0 ? task.writeScopes.join(" / ") : "未声明写域",
				messageText: `${task.messageCount} 条直接消息`
			};
			if (typeof task.attempts === "number" && task.attempts > 1) panel.attemptsText = `第 ${task.attempts} 次尝试`;
			if (task.waitReason) panel.waitReason = task.waitReason;
			if (task.usage.source !== "provider") panel.usageReason = task.usage.reason ?? "该任务没有可用用量事件";
			if (task.duration.state === "unavailable") panel.durationReason = "没有开始时间，算不出用时";
			const evidence = task.evidence;
			if (evidence) panel.evidence = {
				command: evidence.command,
				exitText: evidence.exitCode === null ? "超时或被信号终止" : `退出码 ${evidence.exitCode}`,
				exitOk: evidence.exitCode === 0,
				tail: tailLines(evidence.tail, 6),
				artifacts: evidence.artifacts ?? [],
				atText: formatStamp(evidence.at)
			};
			return panel;
		}
		function flowNodeViewOf(node) {
			const full = tokenTextOf(node.usage);
			const tokenText = full.length > 7 ? compactTokenTextOf(node.usage) : full;
			const durationText = durationTextOf(node.duration);
			return {
				tokenText,
				durationText,
				text: `${tokenText} · ${durationText}`,
				title: `${node.id} ${node.title}\ntoken ${full} · 用时 ${durationText}`,
				label: `任务 ${node.id} ${node.title}，${statusBadge(node.status).text}，token ${full}，用时 ${durationText}`
			};
		}
		/** 节点左上角坐标 → 三次贝塞尔（水平出入，避免折线穿过节点）。 */
		function flowLayoutOf(flow) {
			const columns = Math.max(1, flow.columns);
			const rows = Math.max(1, flow.rows);
			const nodes = flow.nodes.map((node) => ({
				node,
				cell: flowNodeViewOf(node),
				x: 12 + node.column * 188,
				y: 12 + node.row * 72
			}));
			const byId = new Map(nodes.map((entry) => [entry.node.id, entry]));
			const edges = [];
			for (const edge of flow.edges) {
				const from = byId.get(edge.from);
				const to = byId.get(edge.to);
				if (!from || !to) continue;
				const x1 = from.x + 148;
				const y1 = from.y + 28;
				const x2 = to.x - 2;
				const y2 = to.y + 28;
				const bend = Math.max(24, Math.abs(x2 - x1) / 2);
				edges.push({
					key: `${edge.from}->${edge.to}`,
					d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
					upstreamDone: edge.upstreamDone
				});
			}
			return {
				width: 172 + (columns - 1) * 188,
				height: 80 + (rows - 1) * 72,
				nodes,
				edges
			};
		}
		/** 记忆行：token 一律带 `≈`（估算口径），并解释它是按字符数推的、不是 provider 上报值。 */
		function memoryRowOf(item) {
			const estimate = usableNumber(item.tokenEstimate) ? Math.round(item.tokenEstimate) : 0;
			return {
				key: `${item.track}/${item.name}`,
				name: item.name,
				title: item.title || item.name,
				tokenText: `≈${groupDigits(String(estimate))} token`,
				tokenTitle: "按字符数估算（≈ 字符数 / 2），不是 provider 上报值",
				timeText: item.createdAt ? `建立 ${formatStamp(item.createdAt)} · 修改 ${formatStamp(item.updatedAt)}` : `修改 ${formatStamp(item.updatedAt)}`
			};
		}
		const CONFIRM_VERBS = {
			cancel: {
				title: "终止运行",
				action: "取消运行",
				confirm: "终止运行",
				object: "run"
			},
			cancelTask: {
				title: "中断成员",
				action: "中断成员",
				confirm: "中断成员",
				object: "task"
			},
			skipTask: {
				title: "跳过任务",
				action: "跳过任务",
				confirm: "跳过任务",
				object: "task"
			},
			updateAcceptance: {
				title: "重新门禁",
				action: "重跑门禁",
				confirm: "重新门禁",
				object: "task"
			},
			forceParallel: {
				title: "强制并行",
				action: "强制并行",
				confirm: "强制并行",
				object: "task"
			}
		};
		const FALLBACK_VERB = {
			title: "不可逆操作",
			action: "执行动作",
			confirm: "确认执行",
			object: "task"
		};
		/** 弹窗标题/按钮文案：动词短语，绝不用「确定」（DESIGN §2.6）。 */
		function confirmVerbOf(action) {
			return CONFIRM_VERBS[action] ?? FALLBACK_VERB;
		}
		function confirmDialogOf(pending) {
			const verb = confirmVerbOf(pending.action);
			return {
				title: `确认${verb.title}？`,
				actionLabel: `${verb.action}（${pending.action}）`,
				objectText: verb.object === "task" ? `任务 ${pending.taskId ?? "（未知）"}` : `运行 ${pending.runId}`,
				summary: pending.summary,
				waitedText: pending.waitedText || "刚刚",
				confirmLabel: verb.confirm,
				rejectLabel: "取消",
				irreversibleText: "此操作不可撤销"
			};
		}
		/** 没有计时来源时的兜底：未开始的状态词 = 未开始，其余 = 不可得。 */
		function fallbackDurationOf(status) {
			switch (status) {
				case "pending":
				case "blocked":
				case "ready":
				case "waiting": return {
					state: "not-started",
					text: NOT_STARTED_TEXT
				};
				default: return {
					state: "unavailable",
					text: UNAVAILABLE_TEXT
				};
			}
		}
		/**
		* 逐任务详情装配。
		*
		* 第二参故意**不叫 `ctx`**：宿主的 `ctx` 是服务定位器，client 侧有守卫断言
		* 「client 里出现的 `ctx.<x>` 必须是 inject 过的服务」（test/host-contract.test.ts），
		* 这里只是普通的装配入参，用 `ctx` 会被静态守卫误判成服务访问。
		*/
		function buildTaskDetail(task, parts) {
			const detail = {
				id: task.id,
				title: task.title,
				roleId: task.roleId,
				roleName: parts.roleName || task.roleId,
				status: progressOf(task).status,
				dependsOn: [...task.dependsOn ?? []],
				acceptance: task.acceptance ?? "",
				usage: usageCellOr(parts.usage, "该任务没有可用用量事件"),
				duration: parts.duration ?? fallbackDurationOf(progressOf(task).status),
				messageCount: parts.messageCount
			};
			if (task.writeScopes) detail.writeScopes = [...task.writeScopes];
			if (task.evidence) detail.evidence = task.evidence;
			if (typeof task.attempts === "number") detail.attempts = task.attempts;
			const waitReason = waitReasonOf(task);
			if (waitReason) detail.waitReason = waitReason;
			return detail;
		}
		/**
		* 依赖拓扑 → 流转图。列 = 最长依赖深度（0 起），行 = 同列内计划顺序。
		*
		* 环（坏计划 / 历史脏数据）不能让渲染死循环：遇到回边按深度 0 处理，图仍然画得出来。
		*/
		function buildFlow(tasks, cells = {}) {
			const byId = new Map(tasks.map((task) => [task.id, task]));
			const depth = /* @__PURE__ */ new Map();
			const visiting = /* @__PURE__ */ new Set();
			const depthOf = (id) => {
				const cached = depth.get(id);
				if (cached !== void 0) return cached;
				if (visiting.has(id)) return 0;
				const task = byId.get(id);
				if (!task) return 0;
				visiting.add(id);
				let value = 0;
				for (const dep of task.dependsOn ?? []) {
					if (!byId.has(dep)) continue;
					value = Math.max(value, depthOf(dep) + 1);
				}
				visiting.delete(id);
				depth.set(id, value);
				return value;
			};
			const rowCursor = /* @__PURE__ */ new Map();
			const nodes = [];
			for (const task of tasks) {
				const column = depthOf(task.id);
				const row = rowCursor.get(column) ?? 0;
				rowCursor.set(column, row + 1);
				const node = {
					id: task.id,
					title: task.title,
					status: progressOf(task).status,
					column,
					row,
					usage: usageCellOr(cells.usage?.[task.id], "该任务没有可用用量事件"),
					duration: cells.durations?.[task.id] ?? fallbackDurationOf(progressOf(task).status)
				};
				nodes.push(node);
			}
			const edges = [];
			for (const task of tasks) for (const dep of task.dependsOn ?? []) {
				const upstream = byId.get(dep);
				if (!upstream) continue;
				edges.push({
					from: dep,
					to: task.id,
					upstreamDone: progressOf(upstream).status === "done"
				});
			}
			return {
				nodes,
				edges,
				columns: nodes.reduce((max, node) => Math.max(max, node.column + 1), 0),
				rows: nodes.reduce((max, node) => Math.max(max, node.row + 1), 0)
			};
		}
		/**
		* 用量合计：全部任务都有来源才敢给一个数。
		*
		* 部分缺失时**不**把已知项加起来 —— 那会得出一个比真实值小的数字，比「不可得」更误导。
		*/
		function sumUsage(cells, missingReason) {
			let total = 0;
			let available = 0;
			for (const cell of cells) if (cell.source === "provider" && cell.tokens) {
				total += cell.tokens.total;
				available += 1;
			}
			if (available === 0) return {
				source: "unavailable",
				reason: missingReason
			};
			if (available < cells.length) return {
				source: "unavailable",
				reason: "部分任务没有可用用量事件"
			};
			return {
				source: "provider",
				tokens: { total }
			};
		}
		/** 逐角色聚合：只列真正有任务的角色（没任务的角色不占位置）。 */
		function roleUsageOf(tasks, roles) {
			const order = [];
			const groups = /* @__PURE__ */ new Map();
			for (const task of tasks) {
				const list = groups.get(task.roleId);
				if (list) list.push(task);
				else {
					groups.set(task.roleId, [task]);
					order.push(task.roleId);
				}
			}
			return order.map((roleId) => {
				const list = groups.get(roleId) ?? [];
				return {
					roleId,
					name: roles.find((role) => role.id === roleId)?.name ?? list[0]?.roleName ?? roleId,
					tasks: list.length,
					usage: sumUsage(list.map((task) => task.usage), "该角色没有可用用量事件")
				};
			});
		}
		/**
		* **唯一**的 run 详情装配入口（AC-18）：右栏传 snapshot，左栏传 library / 历史详情。
		*
		* 三源优先级：显式 `runDetail` → `library.detail` → `snapshot`。带 `runId` 时只有明确
		* 指向该 run 的来源才可用，否则返回 `null`（渲染空态），绝不把 A 的详情贴到 B 的标题下。
		*/
		function buildRunDetail(source, runId) {
			const direct = source.runDetail ?? source.library?.detail;
			if (direct && (runId === void 0 || direct.runId === runId)) return direct;
			const snapshot = source.snapshot;
			const snapshotRunId = snapshot?.runId;
			if (!snapshot || typeof snapshotRunId !== "string" || snapshotRunId === "") return null;
			if (runId !== void 0 && snapshotRunId !== runId) return null;
			const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
			const roles = Array.isArray(snapshot.roles) ? snapshot.roles : [];
			const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
			const roleNameOf = (roleId) => roles.find((role) => role.id === roleId)?.name ?? roleId;
			const taskViews = tasks.map((task) => buildTaskDetail(task, {
				roleName: roleNameOf(task.roleId),
				usage: snapshot.taskUsage?.[task.id],
				duration: snapshot.taskDurations?.[task.id],
				messageCount: messages.filter((message) => message.taskId === task.id).length
			}));
			const duration = snapshot.runDuration ?? {
				state: "unavailable",
				text: "不可得"
			};
			const detail = {
				runId: snapshotRunId,
				sessionId: "",
				planStatus: snapshot.planStatus ?? "draft",
				usage: snapshot.runUsage ?? sumUsage(taskViews.map((task) => task.usage), "该 run 没有可用用量事件"),
				duration,
				roles: roleUsageOf(taskViews, roles),
				tasks: taskViews,
				flow: buildFlow(tasks, {
					usage: snapshot.taskUsage,
					durations: snapshot.taskDurations
				})
			};
			if (snapshot.project) detail.project = snapshot.project;
			if (snapshot.plannedAt) detail.plannedAt = snapshot.plannedAt;
			if (duration.endAt) detail.finishedAt = duration.endAt;
			if (snapshot.pendingConfirmation) detail.pendingConfirmation = snapshot.pendingConfirmation;
			return detail;
		}
		// src/client/ui.ts
		/** 失败文案的前缀（AC-6 判据逐字，改这里必须同步 PRD/测试）。 */
		const OPTION_FAILURE_PREFIX = "操作失败";
		/**
		* 输入框内的「自动团队」胶囊（取代旧的整宽开关行）。
		*
		* 三条硬规矩：
		*  ① `label` 逐字「自动团队」——状态语义全进 `ariaLabel`（AC-3）；
		*  ② 失败不写红字、不加文本节点：只有 `dotTone='warn'` + `failure`（组件把它贴到
		*     `title`/`aria-label`），可见文本逐字不变（AC-5 + AC-6）；
		*  ③ busy 期间**只换 state、不改 label**（乐观切换文案会让「点了没反应」看起来像已生效）。
		*/
		function optionView(input) {
			const enabled = input.enabled === true;
			const done = countOf(input.done);
			const total = countOf(input.total);
			const status = enabled ? planPillText(input.planStatus, done, total) : planStatusView(void 0).label;
			const state = input.busy === true ? "busy" : !enabled ? "off" : input.planStatus === "paused" ? "paused" : "on";
			const failure = failureTextOf(input.failure);
			return {
				hook: "data-auto-team-option",
				label: "自动团队",
				ariaLabel: failure !== void 0 ? failure : enabled ? `自动团队，已启用，${status}` : "自动团队，未启用",
				pressed: enabled,
				state,
				dotTone: failure === void 0 ? "neutral" : "warn",
				failure
			};
		}
		/** 失败原因 → 「操作失败：<原因摘要>」；无原因返回 undefined（不制造空文案）。 */
		function failureTextOf(raw) {
			const reason = str(raw).trim();
			if (reason === "") return void 0;
			const line = reason.split("\n")[0] ?? "";
			const summary = line.length > 120 ? `${line.slice(0, 119)}…` : line;
			return `${OPTION_FAILURE_PREFIX}：${summary}`;
		}
		/**
		* 会话头「自动团队」按钮（r10 从「只能开」改成「可开可收」）。
		*
		* `opened` 必须由**真实页签状态**驱动，不能是本地乐观态 —— 否则用户从页签 × 关掉面板后，
		* 按钮仍显示「已打开」，下一次点击又去 close 一个不存在的页签（AC-11）。
		*/
		function headerButtonView(input) {
			const done = countOf(input.done);
			const total = countOf(input.total);
			const status = planPillText(input.planStatus, done, total);
			const fallback = input.available === false;
			const opened = input.opened === true && !fallback;
			const canClose = input.canClose !== false;
			return {
				hook: "data-auto-team-header-button",
				label: "自动团队",
				ariaLabel: `${opened ? canClose ? "收起自动团队面板" : "收起失败：宿主未提供关闭入口" : fallback ? "打开自动团队面板（宿主未提供页签服务，已回退为窗口事件）" : "打开自动团队面板"}（${input.enabled === true ? "已启用" : "未启用"}，${status}）`,
				badge: total > 0 ? `${done}/${total}` : "",
				opened,
				action: opened ? "close" : "open",
				fallback
			};
		}
		/** 来源徽标的可见文本（2 字，逐字；测试与真机断言都读它）。 */
		const SKILL_SOURCE_LABEL = {
			builtin: "内置",
			imported: "导入",
			system: "系统",
			manual: "手动"
		};
		/** 来源中文标签；未知来源给「未知」而不是空串（空徽标会被读成「没有来源」）。 */
		function skillSourceLabel(source) {
			return SKILL_SOURCE_LABEL[source] ?? "未知";
		}
		/**
		* 技能行的全部可核验文案（纯函数，`test/client-ui.test.ts` 直接驱动）。
		*
		* 为什么动作集合在这里判：内置技能「不可删」是数据约束（宿主也拒），如果只写在 JSX 的
		* `{skill.source === 'builtin' ? null : …}` 里，`node --test` 就断言不到（本仓无 react-dom）。
		*/
		function skillRowView(skill, selected) {
			const source = skill?.source ?? "manual";
			const builtin = source === "builtin";
			const modified = skill?.modified === true;
			const title = str(skill?.title);
			const sourceLabel = skillSourceLabel(source);
			return {
				hook: "data-skill-row",
				id: str(skill?.id),
				title,
				description: str(skill?.description),
				source,
				sourceLabel,
				sourceTone: builtin ? "neutral" : source === "imported" ? "business" : source === "system" ? "success" : "plain",
				modified,
				modifiedLabel: modified ? "已修改" : null,
				checked: selected === true,
				actions: {
					edit: "编辑",
					restore: builtin ? "恢复出厂" : null,
					delete: builtin ? null : "删除"
				},
				checkboxLabel: `选择技能：${title}（${sourceLabel}）`
			};
		}
		/**
		* 模型选择器按钮上的文案。
		*  - 空路由 → 「跟随会话默认」（`label-tertiary`，不是空按钮）；
		*  - 有值 → `provider/model`（`#effort` 有则带）。
		*/
		function modelPickerLabel(model) {
			const text = routeTextOf(model);
			return text === "" ? "跟随会话默认" : text;
		}
		/**
		* 「恢复默认角色与内置技能」的二次确认文案。
		*
		* 三个数字全部来自入参（快照）—— 对话框里写死「11 个内置角色」在用户删过/加过之后就是假承诺，
		* 这属于本产品「诚实优先于好看」的硬规矩（AC-22）。
		*/
		function restoreConfirmView(input) {
			const builtinRoles = countOf(input.builtinRoles);
			const customRoles = countOf(input.customRoles);
			const userSkills = countOf(input.userSkills);
			const builtinSkills = countOf(input.builtinSkills);
			return {
				title: "恢复默认角色与内置技能",
				lines: [
					`这会把 ${builtinRoles} 个内置角色与 ${builtinSkills} 条内置技能恢复为出厂版本：`,
					`· ${builtinRoles} 个内置角色 → 名称 / 描述 / 提示词 / 技能 / 模型全部回到出厂定义`,
					`· ${builtinSkills} 条内置技能 → 正文回到出厂，已修改标记清除`,
					customRoles + userSkills === 0 ? "你还没有自建角色与自建/导入/系统技能，本次不会删除任何用户数据。" : `你的 ${customRoles} 个自建角色、${userSkills} 条自建/导入/系统技能不受影响。`
				],
				confirmLabel: "恢复默认"
			};
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
		*  - 全部完成 → `完成 x/N`（优先于「派发中」：任务都绿了还写派发中会让人以为没跑完）；
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
		* E1 `conversation.input.left`：输入框**左侧**的「自动团队」胶囊选项（DESIGN §2.1，AC-1~AC-7）。
		*
		* 职责边界（本文件只做三件事，别加第四件）：
		*   1. 取数：`usePanelState(sessionId)` —— 与右栏面板、会话头按钮**共用同一个 store**（单一数据源）；
		*   2. 贴 DOM：文案/aria **全部**来自 `ui.optionView`（渲染描述层），本组件不写任何中文状态
		*      （根 hook `data-auto-team-option` 与 `optionView().hook` 逐字相同，由
		*      `test/client-contract.test.ts` 的 AST 守卫比对，防两处漂移）；
		*   3. 点击只发 `act({type:'toggle'})`，**绝不隐式派发**（反面目标 1：打开开关不该自动起人）。
		*
		* r10 的两条修订（AC-5 / AC-6）：
		*   - **零红字**：失败不渲染任何文本节点（旧版右侧那段红字节点已整段删除，
		*     `role="alert"` 也一并去掉 —— 红字会让输入框工具条抖宽，且「操作失败」这种可恢复
		*     异常用红违反 DESIGN §0.1-3）。失败只体现在**琥珀实心状态点 + 琥珀描边**，
		*     原因进 `title` / `aria-label`，全文留在面板的 `[data-error]` 里。
		*   - **可见文案逐字「自动团队」**：状态语义全部进 `aria-label`，界面不再随状态变宽。
		*
		* busy 期间：`ui.state === 'busy'` → 文案逐字不变 + `aria-busy` + 12×12 旋转环（CSS），
		* 点击入口自己拦掉。**绝不做乐观切换** —— 等服务端快照回来再变态，
		* 否则「点了没反应/失败再变回来」是本项目最难解释的体验。
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
				total: tasks.length,
				failure: error
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
				const feedback = feedbackOf(result);
				setError(feedback.ok ? void 0 : hintOf(feedback));
			}
			return /* @__PURE__ */ react.createElement("span", {
				"data-auto-team-option": true,
				"data-state": ui.state,
				"data-enabled": enabled ? "true" : "false",
				"data-flash": flash ? "true" : "false",
				"data-error-state": ui.failure === void 0 ? "false" : "true",
				"data-dot-tone": ui.dotTone,
				role: "switch",
				tabIndex: 0,
				"aria-checked": ui.pressed,
				"aria-label": ui.ariaLabel,
				"aria-busy": busy ? "true" : void 0,
				"aria-disabled": busy ? "true" : void 0,
				title: ui.failure ?? ui.ariaLabel,
				onClick: () => void toggle(),
				onKeyDown: (event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					toggle();
				}
			}, /* @__PURE__ */ react.createElement("span", {
				"data-option-dot": true,
				"data-tone": ui.dotTone,
				"aria-hidden": "true"
			}), /* @__PURE__ */ react.createElement("span", { "data-option-label": true }, ui.label), busy ? /* @__PURE__ */ react.createElement("span", {
				"data-option-spinner": true,
				"aria-hidden": "true"
			}) : null);
		}
		// src/client/HeaderButton.tsx
		/**
		* E2 `conversation.session.header.actions`：会话头「自动团队」按钮（DESIGN §2.2，AC-11 / AC-13）。
		*
		* r10 的语义变化：从「只能打开」变成「**可开可收**」。
		*   ① 已开 → 调 `closePanel()`（宿主三级回退，见 `slots.createPanelCommands`）；
		*      返回 false = 宿主没提供任何关闭入口 → **不翻转** `aria-pressed`，按钮保持「已打开」，
		*      title 说明原因（AC-11：状态必须是真的，宁可停在「没关上」也不能假装关上）；
		*   ② 未开 → 调 `openPanel()`；返回 false → 回退到 `window.dispatchEvent(OPEN_PANEL_EVENT)`
		*      （面板已挂载时自己切页；未挂载时事件无人接收，属正常）。
		*
		* 为什么两个分支都要有：只做 ① 会在服务晚到的真机上「点了没反应」，只做 ② 会在面板未打开时
		* 派发一个没人听的事件 —— r1~r6 的 Toggle 就是后者。
		*
		* `aria-pressed` 的值来自 `isPanelOpen()`（真实页签状态）优先，缺失时才用本地态：
		* 用户从页签 × 关掉面板后，按钮不会继续显示「已打开」（AC-11 的非乐观判据）。
		*
		* 文案/角标/aria 全部来自 `ui.headerButtonView`；本组件不写中文状态。
		*/
		/** 面板未就绪时的回退通道（`Panel.tsx` 订阅它切到「计划」页）。 */
		const OPEN_PANEL_EVENT = "dsh-auto-team:open-panel";
		/** 关不掉的回退通道：`Panel.tsx` 订阅它，把「收起失败」的原因显示在面板错误区。 */
		const PANEL_CLOSE_EVENT = "dsh-auto-team:close-panel";
		function AutoTeamHeaderButton(props) {
			useAutoTeamStyle();
			const snapshot = usePanelState(sessionIdOf(props)).snapshot;
			const [localOpen, setLocalOpen] = react.useState(false);
			const closeRefused = react.useRef(false);
			const tasks = snapshot?.tasks ?? [];
			const done = tasks.filter((task) => task.status === "done").length;
			const hasOpen = typeof props.openPanel === "function";
			const hasClose = typeof props.closePanel === "function";
			const opened = (typeof props.isPanelOpen === "function" ? props.isPanelOpen() : void 0) ?? (closeRefused.current ? true : localOpen);
			const ui = headerButtonView({
				enabled: snapshot?.enabled === true,
				planStatus: snapshot?.planStatus,
				done,
				total: tasks.length,
				opened,
				available: hasOpen,
				canClose: hasClose
			});
			function dispatch(eventName) {
				if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
				window.dispatchEvent(new CustomEvent(eventName));
			}
			function onClick() {
				if (ui.action === "open") {
					if (hasOpen && props.openPanel() === true) {
						setLocalOpen(true);
						closeRefused.current = false;
						return;
					}
					dispatch(OPEN_PANEL_EVENT);
					setLocalOpen(true);
					return;
				}
				if (hasClose && props.closePanel() === true) {
					setLocalOpen(false);
					closeRefused.current = false;
					return;
				}
				closeRefused.current = true;
				dispatch(PANEL_CLOSE_EVENT);
			}
			return /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-auto-team-header-button": true,
				"data-pressed": opened ? "true" : "false",
				"data-action": ui.action,
				"aria-pressed": opened,
				"aria-label": ui.ariaLabel,
				title: ui.ariaLabel,
				onClick
			}, /* @__PURE__ */ react.createElement("span", {
				"data-header-icon": true,
				"aria-hidden": "true"
			}, "◧"), /* @__PURE__ */ react.createElement("span", { "data-header-label": true }, ui.label), ui.badge === "" ? null : /* @__PURE__ */ react.createElement("span", { "data-header-badge": true }, ui.badge));
		}
		// src/client/views/DetailPane.tsx
		/**
		* 详情容器（r13 DESIGN §3.3）：面包屑 + 返回 + 内容，**内联展开**而不是抽屉。
		*
		* 为什么内联：左栏是两栏布局，抽屉会盖住项目列表，用户失去「我在哪个项目里」的定位；
		* 内联展开保留左列与选中态，深度靠面包屑表达（全局 / 项目 / 记忆 / 运行）。
		* 返回按钮是唯一出口 —— 组件不自己改路由，`onBack` 由页面决定退到哪一层。
		*/
		function DetailPane(props) {
			const { breadcrumb, onBack, children } = props;
			const last = breadcrumb.length - 1;
			return /* @__PURE__ */ react.createElement("section", {
				"data-region": "detail-pane",
				"aria-label": "详情"
			}, /* @__PURE__ */ react.createElement("div", { "data-detail-bar": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-detail-back": true,
				onClick: onBack
			}, /* @__PURE__ */ react.createElement("span", { "aria-hidden": "true" }, "←"), " 返回"), /* @__PURE__ */ react.createElement("nav", {
				"data-detail-crumbs": true,
				"aria-label": "位置"
			}, breadcrumb.map((part, index) => /* @__PURE__ */ react.createElement("span", {
				key: `${index}:${part}`,
				"data-crumb": index === last ? "current" : "up",
				"aria-current": index === last ? "page" : void 0
			}, index > 0 ? /* @__PURE__ */ react.createElement("span", {
				"data-crumb-sep": true,
				"aria-hidden": "true"
			}, "/") : null, part)))), /* @__PURE__ */ react.createElement("div", { "data-detail-body": true }, children));
		}
		// src/client/views/EmptyState.tsx
		/**
		* 空态（r13 DESIGN §2.7）：**三段式** —— 标题 / 一句说明 / 下一步。
		*
		* 为什么不是一句「暂无数据」：空态是用户唯一能知道「接下来该做什么」的地方，
		* 只说「没有」等于把人留在原地。三段文案全部由调用方给（页签自己知道下一步），
		* 组件不做任何状态判断，右栏与左栏因此可以共用同一个空态。
		*
		* 与「降级说明」的区别（DESIGN §2.2）：空态 = **没有数据**；降级 = 有数据但拿不到某个量
		* （如 token 无来源）。两者混用会让人以为计划根本没跑，所以降级用 `[data-run-downgrade]`
		* 画在 run 头里，不经过本组件。
		*/
		function EmptyState(props) {
			return /* @__PURE__ */ react.createElement("div", {
				"data-empty": true,
				role: "status"
			}, /* @__PURE__ */ react.createElement("p", { "data-empty-title": true }, props.title), props.hint ? /* @__PURE__ */ react.createElement("p", { "data-empty-hint": true }, props.hint) : null, props.next ? /* @__PURE__ */ react.createElement("p", { "data-empty-next": true }, props.next) : null);
		}
		// src/client/views/FlowGraph.tsx
		/**
		* 任务流转图（r13 AC-6）：纯 SVG + div 自绘，零图形库。
		*
		* 布局：列 = 最长依赖深度，行 = 同列内计划顺序；节点 148×56，列步进 188、行步进 72。
		* 画布 300px 高、外层滚动 —— 图只回答「谁卡在谁后面」，不做缩放/拖拽平移（面板里
		* 的手势会和页面滚动打架）。
		*
		* 静态可判读（不是只靠颜色）：上游未完成的连线是**虚线**，节点第一行有状态点 + 状态文案，
		* 第二行是 token 与用时；第二行超过 128px 时整体 `ellipsis` 并在 `title` 里给全文 ——
		* 绝不让节点被内容撑宽而破坏列布局。
		*/
		function FlowGraph(props) {
			const { flow, onSelectTask } = props;
			const layout = flowLayoutOf(flow);
			const markerId = `auto-team-flow-arrow-${react.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
			return /* @__PURE__ */ react.createElement("section", {
				"data-region": "task-flow",
				"aria-label": `任务流转图：${flow.nodes.length} 个任务、${flow.columns} 列`
			}, flow.nodes.length === 0 ? /* @__PURE__ */ react.createElement("p", { "data-flow-empty": true }, "还没有任务可以画流转图") : /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("div", { "data-flow-canvas": true }, /* @__PURE__ */ react.createElement("div", {
				"data-flow-inner": true,
				style: {
					width: `${layout.width}px`,
					height: `${layout.height}px`
				}
			}, /* @__PURE__ */ react.createElement("svg", {
				"data-flow-edges": true,
				width: layout.width,
				height: layout.height,
				viewBox: `0 0 ${layout.width} ${layout.height}`,
				"aria-hidden": "true",
				focusable: "false"
			}, /* @__PURE__ */ react.createElement("defs", null, /* @__PURE__ */ react.createElement("marker", {
				id: markerId,
				viewBox: "0 0 8 8",
				refX: "7",
				refY: "4",
				markerWidth: "6",
				markerHeight: "6",
				orient: "auto"
			}, /* @__PURE__ */ react.createElement("path", {
				"data-flow-arrow": true,
				d: "M 0 0 L 8 4 L 0 8 z"
			}))), layout.edges.map((edge) => /* @__PURE__ */ react.createElement("path", {
				key: edge.key,
				"data-flow-edge": true,
				"data-upstream-done": edge.upstreamDone ? "true" : "false",
				d: edge.d,
				fill: "none",
				markerEnd: `url(#${markerId})`
			}))), layout.nodes.map(({ node, cell, x, y }) => {
				const badge = statusBadge(node.status);
				return /* @__PURE__ */ react.createElement("button", {
					key: node.id,
					type: "button",
					"data-flow-node": node.id,
					"data-status": node.status,
					"data-flow-column": node.column,
					"data-flow-row": node.row,
					style: {
						left: `${x}px`,
						top: `${y}px`
					},
					"aria-label": cell.label,
					title: cell.title,
					onClick: () => onSelectTask(node.id)
				}, /* @__PURE__ */ react.createElement("span", { "data-flow-line": "title" }, /* @__PURE__ */ react.createElement("span", { "data-flow-id": true }, node.id), /* @__PURE__ */ react.createElement("span", {
					"data-flow-dot": true,
					"data-tone": badge.tone,
					"aria-hidden": "true"
				}), /* @__PURE__ */ react.createElement("span", { "data-flow-status": true }, badge.text)), /* @__PURE__ */ react.createElement("span", { "data-flow-line": "meta" }, /* @__PURE__ */ react.createElement("span", {
					"data-cell": "token",
					"data-usage-source": node.usage.source,
					title: tokenTitleOf(node.usage)
				}, cell.tokenText), /* @__PURE__ */ react.createElement("span", {
					"data-flow-sep": true,
					"aria-hidden": "true"
				}, "·"), /* @__PURE__ */ react.createElement("span", {
					"data-cell": "duration",
					"data-duration-state": node.duration.state
				}, cell.durationText)));
			}))), /* @__PURE__ */ react.createElement("p", { "data-flow-legend": true }, /* @__PURE__ */ react.createElement("span", {
				"data-legend-line": "solid",
				"aria-hidden": "true"
			}), " 上游已完成", /* @__PURE__ */ react.createElement("span", {
				"data-legend-line": "dashed",
				"aria-hidden": "true"
			}), " 上游未完成")));
		}
		// src/client/views/MemoryList.tsx
		/**
		* 记忆列表（r13 AC-14 / AC-15）：左栏「项目记忆」与右栏「记忆」页**共用**这一份渲染。
		*
		* 三条纪律：
		*  1. 行高 44px、两行式：上行标题 + `≈token`，下行时间。token 必须带 `≈`，因为它是
		*     `ceil(字符数 / 2)` 的估算值（宿主 `memoryTokenEstimate`），不是 provider 上报值；
		*     不带 `≈` 就是造假。
		*  2. 正文**逐字**渲染（`pre` + `white-space: pre-wrap`）：md 是团队资产，插件不解析、
		*     不美化、不截断 —— 任何「顺手 format 一下」都会让用户复制的命令跑不起来。
		*  3. 展开状态归调用方（`expanded`），组件只报告「点了谁」；这样左栏与右栏各自维护
		*     自己的展开项，不会因为共用组件而互相抢状态。
		*/
		const EMPTY_COPY = {
			project: {
				title: "本项目暂无记忆",
				hint: "队长会在这里记下本项目的约定",
				next: "对队长说「记住这个约定」即可"
			},
			public: {
				title: "全局记忆为空",
				hint: "public 轨记忆作用于所有项目",
				next: "对队长说「记住这个约定」即可"
			}
		};
		function MemoryList(props) {
			const { items, track, expanded, body, bodyError, onOpen } = props;
			const empty = EMPTY_COPY[track] ?? EMPTY_COPY.project;
			if (items.length === 0) return /* @__PURE__ */ react.createElement(EmptyState, {
				title: empty.title,
				hint: empty.hint,
				next: empty.next
			});
			return /* @__PURE__ */ react.createElement("ul", {
				"data-memory-list": true,
				"aria-label": track === "public" ? "全局记忆" : "项目记忆"
			}, items.map((item) => {
				const row = memoryRowOf(item);
				const open = expanded === row.name || expanded === row.key;
				return /* @__PURE__ */ react.createElement("li", {
					key: row.key,
					"data-memory-row": true,
					"data-open": open ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-auto-team-memory-item": row.key,
					"data-memory-track": item.track,
					"aria-expanded": open,
					onClick: () => onOpen(item),
					title: item.name
				}, /* @__PURE__ */ react.createElement("span", { "data-memory-title": true }, row.title), /* @__PURE__ */ react.createElement("span", {
					"data-memory-token": true,
					title: row.tokenTitle
				}, row.tokenText), /* @__PURE__ */ react.createElement("span", { "data-memory-time": true }, row.timeText)), open ? bodyError ? /* @__PURE__ */ react.createElement("p", {
					"data-error": true,
					role: "alert"
				}, bodyError) : body === void 0 ? /* @__PURE__ */ react.createElement("p", {
					"data-memory-loading": true,
					"aria-busy": "true"
				}, "读取中…") : /* @__PURE__ */ react.createElement("pre", { "data-memory-body": true }, body) : null);
			}));
		}
		// src/client/views/RoleStrip.tsx
		/**
		* 角色条（r13 AC-2）：本轮参与的角色 + 任务数 + 该角色的 token 合计。
		*
		* 为什么只列「有任务的角色」：角色库可以有很多角色，把没用上的也画出来会让 320px 的
		* 面板顶部被一排无关 chip 占满；`roleUsageOf` 已经按「真正派了活」过滤。
		*
		* chip 高度固定 24px、可换行：角色超过一行时向下长高，不横向滚动（横向滚动条在
		* 面板里会吃掉一条任务行的高度）。
		*/
		function RoleStrip(props) {
			const chips = roleChipsOf(props.roles);
			return /* @__PURE__ */ react.createElement("div", {
				"data-region": "task-roles",
				role: "list",
				"aria-label": "本轮角色与用量"
			}, chips.length === 0 ? /* @__PURE__ */ react.createElement("span", { "data-role-empty": true }, "本轮还没有角色") : chips.map((chip) => /* @__PURE__ */ react.createElement("span", {
				key: chip.roleId,
				role: "listitem",
				"data-role-chip": true,
				"data-role-id": chip.roleId,
				"data-usage-source": chip.usageSource,
				title: chip.usageTitle
			}, /* @__PURE__ */ react.createElement("span", { "data-role-name": true }, chip.name), /* @__PURE__ */ react.createElement("span", { "data-role-tasks": true }, "×", chip.taskCount), /* @__PURE__ */ react.createElement("span", { "data-role-token": true }, chip.usageText))));
		}
		// src/client/views/RunHeader.tsx
		/**
		* run 头（r13 AC-5 / AC-8 / AC-20）：两行 64px + 可选降级行。
		*
		* 上行：runId（等宽）+ 计划状态 + 暂停开关 + 弹性空隙 + 「成员合计 N」；
		* 下行：起止时钟 + 用时 + 弹性空隙 + 派发在途状态。
		*
		* 为什么在 320px 面板里坚持两行：三行会超过 64px 的头部预算，把任务表挤到首屏之外；
		* 一行塞不下（runId 与时间都是不可压缩的），只能截断数字 —— 截断数字等于造假。
		*
		* 文本全部来自 `runHeadOf`（viewmodel）：组件里不出现第二份状态→文案映射，
		* 也不拼「分 / 小时」（AC-7 的 grep 断言盯的正是这个）。
		*/
		function RunHeader(props) {
			const { detail, paused, inflight, onTogglePause } = props;
			const head = runHeadOf(detail, inflight);
			return /* @__PURE__ */ react.createElement("header", {
				"data-region": "run-head",
				"data-paused": paused === true ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("div", { "data-run-line": "identity" }, /* @__PURE__ */ react.createElement("code", {
				"data-run-id": true,
				title: head.plannedAtText
			}, head.runId), /* @__PURE__ */ react.createElement("span", {
				"data-plan-status": true,
				"data-tone": head.planStatusTone
			}, head.planStatusLabel), onTogglePause ? /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-auto-team-pause": true,
				"data-paused": paused === true ? "true" : "false",
				"aria-pressed": paused === true,
				onClick: onTogglePause
			}, paused === true ? "继续" : "暂停") : null, /* @__PURE__ */ react.createElement("span", {
				"data-run-spacer": true,
				"aria-hidden": "true"
			}), /* @__PURE__ */ react.createElement("span", {
				"data-run-usage": true,
				"data-usage-source": head.usageSource,
				title: head.usageTitle
			}, "成员合计 ", /* @__PURE__ */ react.createElement("b", { "data-run-usage-value": true }, head.usageText))), /* @__PURE__ */ react.createElement("div", { "data-run-line": "timing" }, /* @__PURE__ */ react.createElement("span", { "data-run-window": true }, head.windowText), /* @__PURE__ */ react.createElement("span", {
				"data-run-duration": true,
				"data-duration-state": head.durationState,
				title: head.durationState === "unavailable" ? "没有开始时间，算不出 run 用时" : "run 用时"
			}, head.durationText), /* @__PURE__ */ react.createElement("span", {
				"data-run-spacer": true,
				"aria-hidden": "true"
			}), /* @__PURE__ */ react.createElement("span", {
				"data-inflight-dispatch": head.inflightState,
				title: head.inflightState === "idle" ? "计划落盘后自动派发就绪任务" : "正在把就绪任务派给成员"
			}, head.inflightState === "idle" ? null : /* @__PURE__ */ react.createElement("span", {
				"data-inflight-dot": true,
				"aria-hidden": "true"
			}), head.inflightText)), head.downgrade ? /* @__PURE__ */ react.createElement("p", {
				"data-run-downgrade": true,
				title: head.usageTitle
			}, head.downgrade) : null);
		}
		// src/client/views/TaskTable.tsx
		/**
		* 任务表（r13 AC-3 / AC-4 / AC-16 / AC-17）：两行式任务行 + 展开详情。
		*
		* 为什么不是单行表格：320px 面板的内容宽只有 296px，五个字段放不进一行，硬塞会把
		* token 数字截断 —— 截断数字等于造假。所以：
		*   第一行：标题（弹性）+ 状态 badge（最坏 58px）
		*   第二行：`minmax(0,1fr) 76px 84px` —— 角色 / token / 用时，与表头同一套网格
		* 76px 按 `999,999,999` 的 tabular-nums 实测（约 67px）核算，84px 按 `999 小时 59 分` 核算。
		*
		* 交互：整行是一个按钮（点击展开/收起），`aria-expanded` + `aria-controls` 指向详情块；
		* 展开是内联的（DESIGN §3.2），不做抽屉 —— 抽屉会把面板里的其它任务全遮住。
		*
		* 可逆动作（重试、跳过、取消）由 T7 在详情块里挂按钮；本组件只渲染事实，不执行动作，
		* 也不做确认判断（确认闸在宿主，客户端不得自行乐观放行）。
		*/
		function TaskTable(props) {
			const { tasks, expandedTaskId, onToggleTask } = props;
			if (tasks.length === 0) return /* @__PURE__ */ react.createElement(EmptyState, {
				title: "尚未生成计划",
				hint: "告诉队长要达成的目标，计划落盘后会自动开跑",
				next: "对队长说一句话即可"
			});
			return /* @__PURE__ */ react.createElement("div", { "data-region": "task-list" }, /* @__PURE__ */ react.createElement("div", {
				"data-task-head": true,
				"aria-hidden": "true"
			}, /* @__PURE__ */ react.createElement("span", { "data-head-cell": "left" }, TASK_TABLE_HEADER.left), /* @__PURE__ */ react.createElement("span", { "data-head-cell": "token" }, TASK_TABLE_HEADER.token), /* @__PURE__ */ react.createElement("span", { "data-head-cell": "duration" }, TASK_TABLE_HEADER.duration)), /* @__PURE__ */ react.createElement("ul", { "data-task-rows": true }, tasks.map((task) => {
				const row = taskRowOf(task, expandedTaskId === task.id);
				const panel = row.expanded ? taskDetailOf(task) : null;
				const detailId = `auto-team-task-detail-${task.id}`;
				return /* @__PURE__ */ react.createElement("li", {
					key: task.id,
					"data-task-row": true,
					"data-task-id": task.id,
					"data-status": task.status,
					"data-expanded": row.expanded ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-task-toggle": true,
					"aria-expanded": row.expanded,
					"aria-controls": detailId,
					onClick: () => onToggleTask(task.id)
				}, /* @__PURE__ */ react.createElement("span", { "data-task-line": "title" }, /* @__PURE__ */ react.createElement("span", {
					"data-task-title": true,
					title: row.title
				}, row.title), /* @__PURE__ */ react.createElement("span", {
					"data-badge": true,
					"data-tone": row.badge.tone,
					title: `状态：${row.badge.text}`
				}, /* @__PURE__ */ react.createElement("span", { "aria-hidden": "true" }, row.badge.icon), " ", row.badge.text)), /* @__PURE__ */ react.createElement("span", { "data-task-line": "meta" }, /* @__PURE__ */ react.createElement("span", {
					"data-task-role": true,
					title: `角色：${row.roleName}`
				}, row.roleName), /* @__PURE__ */ react.createElement("span", {
					"data-cell": "token",
					"data-usage-source": row.tokenSource,
					title: row.tokenTitle
				}, row.tokenText), /* @__PURE__ */ react.createElement("span", {
					"data-cell": "duration",
					"data-duration-state": row.durationState,
					title: row.durationTitle
				}, row.durationText))), panel ? /* @__PURE__ */ react.createElement("div", {
					id: detailId,
					"data-task-detail": true
				}, /* @__PURE__ */ react.createElement("dl", { "data-task-detail-grid": true }, /* @__PURE__ */ react.createElement("dt", null, "验收"), /* @__PURE__ */ react.createElement("dd", null, /* @__PURE__ */ react.createElement("code", { "data-detail-acceptance": true }, panel.acceptance)), /* @__PURE__ */ react.createElement("dt", null, "依赖"), /* @__PURE__ */ react.createElement("dd", { "data-detail-depends": true }, panel.dependsText), /* @__PURE__ */ react.createElement("dt", null, "写域"), /* @__PURE__ */ react.createElement("dd", { "data-detail-scope": true }, panel.scopeText), /* @__PURE__ */ react.createElement("dt", null, "消息"), /* @__PURE__ */ react.createElement("dd", { "data-detail-messages": true }, panel.messageText), panel.attemptsText ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("dt", null, "尝试"), /* @__PURE__ */ react.createElement("dd", { "data-detail-attempts": true }, panel.attemptsText)) : null, panel.waitReason ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("dt", null, "等待"), /* @__PURE__ */ react.createElement("dd", { "data-wait-reason": true }, panel.waitReason)) : null, panel.usageReason ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("dt", null, "用量"), /* @__PURE__ */ react.createElement("dd", { "data-detail-reason": true }, panel.usageReason)) : null, panel.durationReason ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("dt", null, "用时"), /* @__PURE__ */ react.createElement("dd", { "data-detail-reason": true }, panel.durationReason)) : null, panel.evidence ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("dt", null, "门禁"), /* @__PURE__ */ react.createElement("dd", { "data-gate-evidence": true }, /* @__PURE__ */ react.createElement("span", {
					"data-gate-exit": true,
					"data-exit-ok": panel.evidence.exitOk ? "true" : "false"
				}, panel.evidence.exitText), /* @__PURE__ */ react.createElement("code", { "data-gate-command": true }, panel.evidence.command), panel.evidence.tail.length > 0 ? /* @__PURE__ */ react.createElement("pre", { "data-gate-tail": true }, panel.evidence.tail.join("\n")) : null, panel.evidence.artifacts.length > 0 ? /* @__PURE__ */ react.createElement("span", { "data-gate-artifacts": true }, panel.evidence.artifacts.join(" · ")) : null, /* @__PURE__ */ react.createElement("span", { "data-gate-at": true }, panel.evidence.atText))) : null)) : null);
			})));
		}
		// src/client/tabs/rows.ts
		/**
		* 页签共享的行视图 + 页签本地状态（r13 T7）。
		*
		* 为什么单独一个模块：**历史页与左栏用同一套行**（AC-18「右栏与左栏 deep equal」的延伸）。
		* 如果各写一份，一处改了另一处不改，就会出现「同一个 run 在历史里显示 12.3k、在左栏显示
		* 不可得」这种自相矛盾。行视图只引用 `viewmodel.ts` 的文案函数，**绝不自己拼数字**：
		* token 文本来自宿主下发的 `UsageCell`（`source==='unavailable'` 时显式「不可得」，不估算），
		* 用时文本来自宿主下发的 `DurationCell.text`（客户端没有第二套时长格式化，AC-7）。
		*
		* 页签本地状态（滚动位置、展开的任务、历史已加载条数）放模块级 Map：页签组件切换是被卸载的，
		* 放 useState 会在每次切页签时丢掉「我刚才展开的是哪个任务」。模块级 Map 让这三个小状态
		* 跨卸载存活，又不会触发额外渲染。
		*/
		function rowOf(input) {
			const badge = statusBadge(input.status);
			return {
				runId: input.runId,
				title: input.title,
				metaText: input.metaText,
				statusText: badge.text,
				statusTone: badge.tone,
				statusIcon: badge.icon,
				tokenText: tokenTextOf(input.usage),
				tokenTitle: tokenTitleOf(input.usage),
				tokenSource: input.usage.source,
				durationText: durationTextOf(input.duration),
				durationTitle: durationTitleOf(input.duration),
				durationState: input.duration.state,
				active: input.active
			};
		}
		/** 无 DurationCell 时的降级：只给时间戳，**不给时长**（客户端没有第二套时长格式化）。 */
		const NO_DURATION = {
			text: "—",
			state: "unavailable"
		};
		/**
		* 历史列表行（右栏「历史」页）—— 数据来自 `snapshot.runs` / `library.runs`（`RunSummary`）。
		*
		* `RunSummary` 只有 `usageTotals`（没有用法单元格），所以这里把总量包成 `UsageCell`；
		* 文本仍由 `tokenTextOf` 生成，不存在第二套格式化。用时则退化为时间戳（同上）。
		*/
		function runSummaryRowOf(run, now = Date.now()) {
			const usage = run.usageTotals !== void 0 && typeof run.usageTotals.total === "number" ? {
				source: "provider",
				tokens: run.usageTotals
			} : {
				source: "unavailable",
				reason: "该次运行没有用量记录"
			};
			const start = formatStamp(run.plannedAt ?? run.createdAt);
			const end = run.active === true ? "进行中" : formatStamp(run.finishedAt);
			return rowOf({
				runId: run.runId,
				title: run.project !== void 0 && run.project !== "" ? run.project : run.runId,
				metaText: `开始 ${start} · 结束 ${end} · 任务 ${run.done}/${run.tasks}`,
				status: run.status,
				usage,
				duration: NO_DURATION,
				active: run.active === true
			});
		}
		/** 项目库里的「最近 run」行（左栏）—— 数据来自 `ProjectRunSummaryView`，用量/用时都是宿主算好的单元格。 */
		function projectRunRowOf(run) {
			const start = formatStamp(run.plannedAt);
			const end = formatStamp(run.finishedAt);
			return rowOf({
				runId: run.runId,
				title: run.runId,
				metaText: `开始 ${start} · 结束 ${end} · 任务 ${run.done}/${run.tasks}`,
				status: run.planStatus,
				usage: run.usage,
				duration: run.duration,
				active: false
			});
		}
		/** 左栏项目导航行；`usage` 是宿主算好的 `UsageCell`（项目总量）。 */
		function projectNavOf(project, active) {
			return {
				id: project.id,
				name: project.name,
				path: project.path,
				metaText: `${project.runs} 次运行 · ${project.lastActiveAt !== void 0 ? formatStamp(project.lastActiveAt) : "无记录"}`,
				tokenText: tokenTextOf(project.usage),
				tokenTitle: tokenTitleOf(project.usage),
				active,
				unknown: project.unknown === true
			};
		}
		const tabMemory = /* @__PURE__ */ new Map();
		function tabMemoryOf(key) {
			const existing = tabMemory.get(key);
			if (existing !== void 0) return existing;
			const created = {
				scrollTop: 0,
				historyLimit: 0
			};
			tabMemory.set(key, created);
			return created;
		}
		/** 滚动位置跨页签切换保持（页签组件会被卸载，useState 存不住）。 */
		function useTabScroll(key) {
			const ref = react.useRef(null);
			react.useEffect(() => {
				const node = ref.current;
				if (node !== null) node.scrollTop = tabMemoryOf(key).scrollTop;
			}, [key]);
			return {
				ref,
				onScroll: react.useCallback(() => {
					const node = ref.current;
					if (node !== null) tabMemoryOf(key).scrollTop = node.scrollTop;
				}, [key])
			};
		}
		/**
		* 展开的任务 id（跨页签切换保持；同一时刻只展开一行，避免 320px 面板被详情挤爆）。
		*
		* 返回三元组：`[当前展开的 id, 切换（同一 id 再点收起）, 强制展开（流转图点节点用）]`。
		* 分开是因为「点节点」的语义是定位到该任务，不该因为目标已展开又把它收起来。
		*/
		function useExpandedTask(key) {
			const [expanded, setExpanded] = react.useState(() => tabMemoryOf(key).expandedTaskId);
			return [
				expanded,
				react.useCallback((taskId) => {
					setExpanded((current) => {
						const next = current === taskId ? void 0 : taskId;
						tabMemoryOf(key).expandedTaskId = next;
						return next;
					});
				}, [key]),
				react.useCallback((taskId) => {
					tabMemoryOf(key).expandedTaskId = taskId;
					setExpanded(taskId);
				}, [key])
			];
		}
		/**
		* 点流转节点 → 展开对应任务并滚到它。
		*
		* 为什么用序号定位而不是 `[data-task-id]`：`TaskTable`（T6 产物，只读）的行上没有 id 属性，
		* 但行顺序与 `tasks` 数组严格一致（同一个 `map`）。序号定位是这里唯一不越界改别人文件的解法；
		* 若 T6 以后给行加了 `data-task-id`，这里应换成属性选择器（见 [OUT-OF-SCOPE]）。
		*/
		function scrollToTaskRow(taskId, taskIds) {
			if (typeof document === "undefined") return;
			const index = taskIds.indexOf(taskId);
			if (index < 0) return;
			const node = document.querySelectorAll("[data-region=\"task-list\"] [data-task-row]")[index];
			if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" });
		}
		// src/client/LibraryPage.tsx
		/**
		* 左栏「自动团队」栏目 + 项目库（r13 AC-23 / AC-24 / AC-25）。
		*
		* 结构（DESIGN §5）：`[data-library-shell]` → `[data-library-head]`（44px）+ `[data-library-body]`：
		*  - `[data-region="project-list"]`（220px）：**首行「全局」**、中间各项目（最近活跃倒序）、**末位「未知项目」**；
		*  - `[data-region="project-detail"]`：项目头（名称/路径/运行数/用量）+ 最近 run 任务区 + 项目记忆；
		*    点开某条 run 就在这块里内联展开详情（保留左列与选中态，DESIGN §5.4）。
		*
		* 两条硬约束：
		*  1. **AC-23**：`loadLibrary()` 只在本组件挂载时调用一次（页面打开才装配），与右栏的快照轮询完全分离；
		*  2. **AC-18**：run 详情的任务表/角色条/流转图复用右栏同一套组件与同一个 `buildRunDetail`，
		*     绝不在这里内联第二份任务表（否则两处 token 文本会漂移）。
		*
		* `main` 槽位对第三方插件是否开放**尚未真机验证**（TECHNICAL §0 U2），所以：
		*  - `PanellistEntry` 是被 `registerPanellist` 整段 try/catch 注册的，失败不影响其它槽位；
		*  - 拿不到主区入口时派发 `AUTO_TEAM_OPEN_LIBRARY_EVENT`，由 `Panel` 在面板内联渲染本页（降级路径）。
		*/
		/**
		* 「打开左栏项目库」的窗口事件名（**单向别名**：真实字面量只写在 `slots.ts`）。
		*
		* 放在 slots.ts 的理由：`slots.ts` 不 import 任何 `.tsx`，组件与测试都能引它，
		* 又不会形成 `slots ↔ LibraryPage` 的运行时环；字面量只此一处，避免两处漂移。
		*/
		const AUTO_TEAM_OPEN_LIBRARY_EVENT = OPEN_LIBRARY_EVENT;
		/** 左栏与面板内联两处共用的内容体（只差外面那层 root 钩子）。 */
		function LibraryContent(props) {
			const sessionId = sessionIdOf(props);
			const view = usePanelState(sessionId);
			const loadLibrary = view.loadLibrary;
			const library = view.library;
			const libraryError = view.libraryError;
			react.useEffect(() => {
				loadLibrary();
			}, [sessionId, loadLibrary]);
			const [picked, setPicked] = react.useState("");
			const [openMemory, setOpenMemory] = react.useState(void 0);
			const [memoryBody, setMemoryBody] = react.useState(void 0);
			const [memoryError, setMemoryError] = react.useState(void 0);
			const [memoryLoading, setMemoryLoading] = react.useState(false);
			const [expanded, toggleTask, expandTask] = useExpandedTask("library");
			const readMemory = react.useCallback((track, name, workspace) => panelApi.readMemory(sessionId, track, name, workspace), [sessionId]);
			/** 「全局」固定在最上；其余按最近活跃倒序；`unknown` 项目固定末位（PRD §11 默认值）。 */
			const projects = react.useMemo(() => {
				const list = library?.projects ?? [];
				const known = list.filter((project) => project.unknown !== true);
				const unknown = list.filter((project) => project.unknown === true);
				return [...known, ...unknown];
			}, [library]);
			const selectedId = picked !== "" ? picked : library?.currentProject ?? "global";
			const selectedProject = projects.find((project) => project.id === selectedId);
			const detail = view.detail !== null && view.detailRunId !== null && view.detail.runId === view.detailRunId ? view.detail : null;
			const detailView = react.useMemo(() => detail === null ? null : buildRunDetail({
				snapshot: null,
				runDetail: detail
			}), [detail]);
			const detailTaskIds = react.useMemo(() => detailView === null ? [] : detailView.tasks.map((task) => task.id), [detailView]);
			async function openMemoryItem(track, item, workspace) {
				if (openMemory !== void 0 && openMemory.name === item.name && openMemory.track === track) {
					setOpenMemory(void 0);
					setMemoryBody(void 0);
					setMemoryError(void 0);
					return;
				}
				setOpenMemory({
					track,
					name: item.name,
					workspace
				});
				setMemoryBody(void 0);
				setMemoryError(void 0);
				setMemoryLoading(true);
				try {
					const result = await readMemory(track, item.name, workspace);
					if (result.error !== void 0) setMemoryError(result.error);
					else setMemoryBody(result.data?.body ?? "");
				} finally {
					setMemoryLoading(false);
				}
			}
			const globalItems = library?.global.memories ?? [];
			const projectItems = selectedProject?.memories ?? [];
			return /* @__PURE__ */ react.createElement("div", {
				"data-library-shell": true,
				"data-library-page": props.root
			}, /* @__PURE__ */ react.createElement("div", { "data-library-head": true }, /* @__PURE__ */ react.createElement("strong", { "data-library-title": true }, "自动团队"), /* @__PURE__ */ react.createElement("span", {
				"data-library-sub": true,
				"data-project-count": projects.length
			}, library === null ? "读取中…" : `${projects.length} 个项目`), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-library-refresh": true,
				disabled: view.loading && library === null,
				onClick: () => void loadLibrary()
			}, "刷新")), /* @__PURE__ */ react.createElement("div", { "data-library-body": true }, /* @__PURE__ */ react.createElement("div", {
				"data-region": "project-list",
				role: "list",
				"aria-label": "项目"
			}, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				role: "listitem",
				"data-auto-team-nav": true,
				"data-nav-kind": "global",
				"data-active": selectedId === "global" ? "true" : "false",
				onClick: () => {
					setPicked("global");
					setOpenMemory(void 0);
				}
			}, /* @__PURE__ */ react.createElement("span", { "data-nav-name": true }, "全局"), /* @__PURE__ */ react.createElement("span", { "data-nav-meta": true }, globalItems.length, " 条公共记忆")), projects.map((project) => {
				const nav = projectNavOf(project, project.id === selectedId);
				return /* @__PURE__ */ react.createElement("button", {
					key: project.id,
					type: "button",
					role: "listitem",
					"data-auto-team-nav": true,
					"data-nav-kind": nav.unknown ? "unknown" : "project",
					"data-project-id": nav.id,
					"data-active": nav.active ? "true" : "false",
					title: nav.path ?? nav.name,
					onClick: () => {
						setPicked(nav.id);
						setOpenMemory(void 0);
					}
				}, /* @__PURE__ */ react.createElement("span", { "data-nav-name": true }, nav.name), /* @__PURE__ */ react.createElement("span", { "data-nav-meta": true }, nav.metaText), /* @__PURE__ */ react.createElement("span", {
					"data-nav-token": true,
					"data-usage-source": project.usage.source,
					title: nav.tokenTitle
				}, nav.tokenText));
			})), /* @__PURE__ */ react.createElement("div", { "data-region": "project-detail" }, library === null && libraryError === null ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "正在读取项目库…",
				hint: "宿主会扫描运行目录与两轨记忆"
			}) : library === null ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "读不到项目库",
				hint: libraryError ?? "未知原因",
				next: "点右上角「刷新」重试"
			}) : selectedProject === void 0 ? /* @__PURE__ */ react.createElement(GlobalPane, {
				memories: globalItems,
				expanded: openMemory?.track === "public" ? openMemory.name : void 0,
				body: memoryLoading ? void 0 : memoryBody,
				error: memoryError,
				onOpen: (item) => void openMemoryItem("public", item)
			}) : /* @__PURE__ */ react.createElement(ProjectPane, {
				project: selectedProject,
				detailView,
				detailRunId: view.detailRunId,
				detailTaskIds,
				expandedTaskId: expanded,
				onToggleTask: toggleTask,
				onExpandTask: expandTask,
				onOpenRun: (runId) => void view.openRun(runId),
				onCloseRun: view.closeRun,
				memories: projectItems,
				expandedMemory: openMemory?.track === "project" ? openMemory.name : void 0,
				memoryBody: memoryLoading ? void 0 : memoryBody,
				memoryError,
				onOpenMemory: (item) => void openMemoryItem("project", item, selectedProject.path)
			}), libraryError !== null && library !== null ? /* @__PURE__ */ react.createElement("p", {
				"data-error": true,
				"data-error-scope": "library",
				role: "alert"
			}, libraryError) : null)));
		}
		/** 全局（公共）记忆面板：跨项目共用，所以只列条目与正文，不挂任何项目字段。 */
		function GlobalPane(props) {
			return /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("div", { "data-library-project-head": true }, /* @__PURE__ */ react.createElement("span", { "data-library-project-name": true }, "全局"), /* @__PURE__ */ react.createElement("span", { "data-library-project-meta": true }, "跨项目的公共记忆（所有项目共享）")), props.memories.length === 0 ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "还没有公共记忆",
				hint: "团队级的约定可以写在公共轨，所有项目都会带上"
			}) : /* @__PURE__ */ react.createElement(MemoryList, {
				items: props.memories,
				track: "public",
				expanded: props.expanded,
				body: props.body,
				bodyError: props.error,
				onOpen: props.onOpen
			}));
		}
		/** 单项目面板：项目头 + 最近 run（可展开详情）+ 项目记忆。 */
		function ProjectPane(props) {
			const { project } = props;
			return /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("div", { "data-library-project-head": true }, /* @__PURE__ */ react.createElement("span", { "data-library-project-name": true }, project.name), /* @__PURE__ */ react.createElement("span", {
				"data-library-project-meta": true,
				"data-runs": project.runs
			}, project.runs, " 次运行", project.lastActiveAt !== void 0 ? ` · 最近 ${formatStamp(project.lastActiveAt)}` : ""), /* @__PURE__ */ react.createElement("span", {
				"data-library-project-usage": true,
				"data-usage-source": project.usage.source,
				title: tokenTitleOf(project.usage)
			}, tokenTextOf(project.usage)), project.path !== void 0 ? /* @__PURE__ */ react.createElement("code", {
				"data-library-project-path": true,
				title: project.path
			}, project.path) : null), /* @__PURE__ */ react.createElement("section", { "data-library-section": "runs" }, /* @__PURE__ */ react.createElement("h4", { "data-library-section-title": true }, "最近运行"), props.detailView !== null && props.detailRunId !== null ? /* @__PURE__ */ react.createElement(DetailPane, {
				breadcrumb: ["历史", props.detailRunId],
				onBack: props.onCloseRun
			}, /* @__PURE__ */ react.createElement(RunHeader, {
				detail: props.detailView,
				inflight: "idle"
			}), /* @__PURE__ */ react.createElement(RoleStrip, { roles: props.detailView.roles }), /* @__PURE__ */ react.createElement(TaskTable, {
				tasks: props.detailView.tasks,
				expandedTaskId: props.expandedTaskId,
				onToggleTask: props.onToggleTask
			}), /* @__PURE__ */ react.createElement(FlowGraph, {
				flow: props.detailView.flow,
				onSelectTask: (taskId) => {
					props.onExpandTask(taskId);
					if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => scrollToTaskRow(taskId, props.detailTaskIds));
					else scrollToTaskRow(taskId, props.detailTaskIds);
				}
			})) : project.recentRuns.length === 0 ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "这个项目还没有运行记录",
				hint: "计划落盘后自动派发，运行记录会出现在这里"
			}) : /* @__PURE__ */ react.createElement("ul", {
				"data-region": "history-list",
				"data-scope": "project"
			}, project.recentRuns.map((run) => {
				const row = projectRunRowOf(run);
				const active = props.detailRunId === row.runId;
				return /* @__PURE__ */ react.createElement("li", {
					key: row.runId,
					"data-history-row": true,
					"data-active": active ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-history-open": row.runId,
					onClick: () => props.onOpenRun(row.runId)
				}, /* @__PURE__ */ react.createElement("span", { "data-history-line": "title" }, /* @__PURE__ */ react.createElement("span", {
					"data-history-title": true,
					title: row.title
				}, row.title), /* @__PURE__ */ react.createElement("span", {
					"data-badge": true,
					"data-tone": row.statusTone,
					title: `状态：${row.statusText}`
				}, /* @__PURE__ */ react.createElement("span", { "aria-hidden": "true" }, row.statusIcon), " ", row.statusText)), /* @__PURE__ */ react.createElement("span", { "data-history-line": "meta" }, /* @__PURE__ */ react.createElement("span", { "data-history-time": true }, row.metaText), /* @__PURE__ */ react.createElement("span", {
					"data-history-token": true,
					"data-usage-source": row.tokenSource,
					title: row.tokenTitle
				}, row.tokenText), /* @__PURE__ */ react.createElement("span", {
					"data-history-duration": true,
					"data-duration-state": row.durationState,
					title: row.durationTitle
				}, row.durationText))));
			}))), /* @__PURE__ */ react.createElement("section", { "data-library-section": "memories" }, /* @__PURE__ */ react.createElement("h4", { "data-library-section-title": true }, "项目记忆"), props.memories.length === 0 ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "本项目暂无记忆",
				hint: "让队长把约定沉淀下来，下次派发会自动带上"
			}) : /* @__PURE__ */ react.createElement(MemoryList, {
				items: props.memories,
				track: "project",
				expanded: props.expandedMemory,
				body: props.memoryBody,
				bodyError: props.memoryError,
				onOpen: props.onOpenMemory
			})));
		}
		/**
		* `sidebar.panellist` 槽位的组件（左栏栏目）。
		*
		* 宿主对这个槽位的用法是**面板行的图标**（2026-11-04 修正两次）：
		* `dsh-client-ui-sidebar` 把本槽位每个 entry 的 `{ id, order, label }` 渲染成自己的面板行，
		* 行内用 `renderSlot('sidebar.panellist', { size, active }, { only: id })` 画图标，
		* 点击由宿主调 `ctx.layout.selectPanel(id)` 完成 —— 所以这里
		*   ① 只能画图标（16/18px，`currentColor`），不能画标题/按钮；
		*   ② 绝不能包 `<button>`：外层已经是按钮，嵌套按钮会让浏览器改写 DOM，
		*      点击就不再落到宿主那一行上（症状：点了主界面没反应）。
		* 真正的两栏项目库在 `main` 槽位（`LibraryPage`，key 同为 `PANELLIST_ID`）里渲染。
		*/
		function PanellistEntry(props) {
			const size = typeof props.size === "number" ? props.size : 16;
			return /* @__PURE__ */ react.createElement("svg", {
				"data-auto-team-panellist": true,
				"data-panellist-glyph": true,
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				role: "presentation",
				focusable: "false",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.2",
				strokeLinecap: "round"
			}, /* @__PURE__ */ react.createElement("circle", {
				cx: "8",
				cy: "3.6",
				r: "1.75"
			}), /* @__PURE__ */ react.createElement("circle", {
				cx: "3.6",
				cy: "12.2",
				r: "1.75"
			}), /* @__PURE__ */ react.createElement("circle", {
				cx: "12.4",
				cy: "12.2",
				r: "1.75"
			}), /* @__PURE__ */ react.createElement("path", { d: "M7.2 5.1 4.2 10.7M8.8 5.1l3 5.6" }));
		}
		/** 面板内联降级 / `main` 槽位的整页版本。 */
		function LibraryPage(props) {
			return /* @__PURE__ */ react.createElement("div", { "data-auto-team-library": true }, /* @__PURE__ */ react.createElement(LibraryContent, {
				...props,
				root: "library"
			}));
		}
		// src/client/tabs/TasksTab.tsx
		/**
		* 「任务」页（r13 AC-2 / AC-3 / AC-11）。
		*
		* 组成：`RunHeader`（run 头：计划状态、开始时间、合计 token/用时、暂停）
		*      + `RoleStrip`（逐角色任务数 + token）
		*      + `TaskTable`（两行式任务行，整行点击展开详情）
		*      + `FlowGraph`（流转图，点节点定位任务行）
		*
		* 为什么没有「派发」按钮（AC-11）：计划落盘后由宿主自动派发，界面上**不允许**出现一个
		* 「点了也常常失败」的派发按钮。用户能做的只有暂停/继续与任务级可逆动作。
		*
		* 数据全部来自 `buildRunDetail({snapshot})` —— 与左栏历史详情共用同一个装配函数（AC-18），
		* 所以两处的任务表不可能出现不同的 token/用时。
		*/
		/** 派发在途指示：`dispatching` 由快照状态给出，`dispatched` 是离开派发态后的 3 秒成功提示。 */
		const DISPATCHED_FLASH_MS = 3e3;
		function useInflight(snapshot) {
			const [flashed, setFlashed] = react.useState(false);
			const previous = react.useRef(void 0);
			const status = snapshot?.planStatus;
			const absent = snapshot === void 0;
			react.useEffect(() => {
				const before = previous.current;
				previous.current = status;
				if (before !== "dispatching" || status === "dispatching" || absent) return void 0;
				setFlashed(true);
				const timer = setTimeout(() => setFlashed(false), DISPATCHED_FLASH_MS);
				return () => clearTimeout(timer);
			}, [status, absent]);
			if (status === "dispatching") return "dispatching";
			return flashed ? "dispatched" : "idle";
		}
		function TasksTab(props) {
			const scroll = useTabScroll("tasks");
			const [expanded, toggleTask, expandTask] = useExpandedTask("tasks");
			const snapshot = props.snapshot;
			const detail = react.useMemo(() => buildRunDetail({ snapshot: snapshot ?? null }), [snapshot]);
			const inflight = useInflight(snapshot);
			const taskIds = react.useMemo(() => detail === null ? [] : detail.tasks.map((task) => task.id), [detail]);
			if (detail === null) return /* @__PURE__ */ react.createElement("div", {
				"data-region": "tasks-tab",
				"data-tab-scroll": "tasks",
				ref: scroll.ref,
				onScroll: scroll.onScroll
			}, /* @__PURE__ */ react.createElement(EmptyState, {
				title: "尚未生成计划",
				hint: "告诉队长要达成的目标，计划落盘后会自动开跑",
				next: "对队长说一句话即可"
			}));
			return /* @__PURE__ */ react.createElement("div", {
				"data-region": "tasks-tab",
				"data-tab-scroll": "tasks",
				ref: scroll.ref,
				onScroll: scroll.onScroll
			}, /* @__PURE__ */ react.createElement(RunHeader, {
				detail,
				paused: props.paused,
				inflight,
				onTogglePause: props.onTogglePause
			}), /* @__PURE__ */ react.createElement(RoleStrip, { roles: detail.roles }), /* @__PURE__ */ react.createElement(TaskTable, {
				tasks: detail.tasks,
				expandedTaskId: expanded,
				onToggleTask: (taskId) => toggleTask(taskId)
			}), /* @__PURE__ */ react.createElement(FlowGraph, {
				flow: detail.flow,
				onSelectTask: (taskId) => {
					expandTask(taskId);
					if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => scrollToTaskRow(taskId, taskIds));
					else scrollToTaskRow(taskId, taskIds);
				}
			}));
		}
		// src/client/tabs/HistoryTab.tsx
		/**
		* 「历史」页（r13 AC-5 / AC-6 / AC-22 / AC-23）。
		*
		* 两态：**列表** ⇄ **详情**（内联展开，不做抽屉；320px 面板里抽屉会把列表全遮住）。
		*  - 列表来自 `snapshot.runs`（宿主每张快照带 ≤50 条），没有时退回 `library.runs`；
		*  - 详情走 `openRun(runId)` → `GET /library?runId=` → `library.detail`，**不新增第 5 条路由**（AC-22）；
		*  - 详情里的任务表、角色条、流转图复用与任务页**完全相同的组件**（AC-18），
		*    装配也走同一个 `buildRunDetail`（这里直接用宿主给好的 `RunDetailView`，不再二次拼装）。
		*
		* 分页：首屏 `HISTORY_PAGE_SIZE`（50）条，每次「加载更多」+50；已加载条数存模块级页签记忆，
		* 切走再回来不用重新翻。
		*/
		/** 历史详情的任务展开同样跨页签保持（key 与任务页分开，避免两边互相抢展开行）。 */
		const HISTORY_TAB_KEY = "history";
		function HistoryTab(props) {
			const scroll = useTabScroll(HISTORY_TAB_KEY);
			const [expanded, toggleTask, expandTask] = useExpandedTask(HISTORY_TAB_KEY);
			const [, bumpLimit] = react.useReducer((value) => value + 1, 0);
			const memory = tabMemoryOf(HISTORY_TAB_KEY);
			const openRunId = props.detailRunId;
			const detail = props.detail !== null && openRunId !== null && props.detail.runId === openRunId ? props.detail : null;
			const detailView = react.useMemo(() => detail === null ? null : buildRunDetail({
				snapshot: null,
				runDetail: detail
			}), [detail]);
			const detailTaskIds = react.useMemo(() => detailView === null ? [] : detailView.tasks.map((task) => task.id), [detailView]);
			if (openRunId !== null) return /* @__PURE__ */ react.createElement("div", {
				"data-region": "history-detail",
				"data-tab-scroll": "history-detail",
				ref: scroll.ref,
				onScroll: scroll.onScroll
			}, /* @__PURE__ */ react.createElement(DetailPane, {
				breadcrumb: ["历史", openRunId],
				onBack: props.closeRun
			}, detailView !== null ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement(RunHeader, {
				detail: detailView,
				paused: props.paused,
				inflight: "idle"
			}), /* @__PURE__ */ react.createElement(RoleStrip, { roles: detailView.roles }), /* @__PURE__ */ react.createElement(TaskTable, {
				tasks: detailView.tasks,
				expandedTaskId: expanded,
				onToggleTask: (taskId) => toggleTask(taskId)
			}), /* @__PURE__ */ react.createElement(FlowGraph, {
				flow: detailView.flow,
				onSelectTask: (taskId) => {
					expandTask(taskId);
					if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => scrollToTaskRow(taskId, detailTaskIds));
					else scrollToTaskRow(taskId, detailTaskIds);
				}
			})) : props.libraryError !== null ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "读不到这条历史",
				hint: props.libraryError,
				next: "返回列表换一条试试"
			}) : /* @__PURE__ */ react.createElement(EmptyState, {
				title: "正在读取历史详情…",
				hint: `运行 ${openRunId} 的任务、用量与用时正在从磁盘装配`
			})));
			const runs = props.snapshot?.runs ?? props.library?.runs ?? [];
			const limit = memory.historyLimit > 0 ? memory.historyLimit : 50;
			const visible = runs.slice(0, limit);
			const hasMore = runs.length > visible.length;
			return /* @__PURE__ */ react.createElement("div", {
				"data-region": "history-list-region",
				"data-tab-scroll": "history",
				ref: scroll.ref,
				onScroll: scroll.onScroll
			}, runs.length === 0 ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "还没有历史运行",
				hint: "计划落盘并开跑后，每次运行都会留在这里（含 token 与用时）",
				next: "对队长说一句话即可开始"
			}) : /* @__PURE__ */ react.createElement("ul", { "data-region": "history-list" }, visible.map((run) => {
				const row = runSummaryRowOf(run);
				return /* @__PURE__ */ react.createElement("li", {
					key: row.runId,
					"data-history-row": true,
					"data-active": row.active ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-history-open": row.runId,
					onClick: () => void props.openRun(row.runId)
				}, /* @__PURE__ */ react.createElement("span", { "data-history-line": "title" }, /* @__PURE__ */ react.createElement("span", {
					"data-history-title": true,
					title: row.title
				}, row.title), /* @__PURE__ */ react.createElement("span", {
					"data-badge": true,
					"data-tone": row.statusTone,
					title: `状态：${row.statusText}`
				}, /* @__PURE__ */ react.createElement("span", { "aria-hidden": "true" }, row.statusIcon), " ", row.statusText)), /* @__PURE__ */ react.createElement("span", { "data-history-line": "meta" }, /* @__PURE__ */ react.createElement("span", { "data-history-time": true }, row.metaText), /* @__PURE__ */ react.createElement("span", {
					"data-history-token": true,
					"data-usage-source": row.tokenSource,
					title: row.tokenTitle
				}, row.tokenText))));
			})), hasMore ? /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-history-more": true,
				onClick: () => {
					memory.historyLimit = limit + 50;
					bumpLimit();
				}
			}, "加载更多（已显示 ", visible.length, "/", runs.length, "）") : null, props.libraryError !== null && runs.length > 0 ? /* @__PURE__ */ react.createElement("p", {
				"data-error": true,
				"data-error-scope": "library",
				role: "alert"
			}, props.libraryError) : null);
		}
		// src/client/tabs/MemoryTab.tsx
		/**
		* 「记忆」页（r13 AC-19 / AC-20 / AC-21）。
		*
		* 只展示**本项目记忆**（`track=project`）：全局公共记忆属于「跨项目」，按产品决策放在
		* 左栏项目库的「全局」行里（那里才能同时看到所有项目的记忆），右栏再放一份就是两处同源列表。
		*
		* 三条纪律：
		*  1. 索引来自快照（`snapshot.memory.files`），**不在客户端扫目录**；
		*  2. token 数是估算值，必须带 `≈` 与 `tokenBasis='estimate'`（`MemoryList` 按此渲染），
		*     绝不把估算值伪装成 provider 上报值（AC-20 的反面）；
		*  3. 正文按需读取（点开才读），读失败就地显示原因并保留列表 —— 不清空成空态。
		*/
		/**
		* `MemoryFileInfo` → `MemoryItemView`。
		*
		* `tokenEstimate` 由宿主给（r13 起恒有）；老快照缺失时按宿主的估算口径（字符数 / 2）补一个，
		* 仍标记 `tokenBasis: 'estimate'`，界面上照旧显示 `≈`，不会冒充真实用量。
		*/
		function itemOf(file) {
			const estimate = typeof file.tokenEstimate === "number" && Number.isFinite(file.tokenEstimate) ? file.tokenEstimate : Math.round(charsOf(file) / 2);
			return {
				track: file.track,
				name: file.name,
				title: file.name,
				createdAt: file.createdAt,
				updatedAt: file.updatedAt,
				tokenEstimate: estimate,
				tokenBasis: "estimate"
			};
		}
		function charsOf(file) {
			return typeof file.chars === "number" && Number.isFinite(file.chars) ? file.chars : 0;
		}
		function MemoryTab(props) {
			const scroll = useTabScroll("memory");
			const [openName, setOpenName] = react.useState(void 0);
			const [body, setBody] = react.useState(void 0);
			const [bodyError, setBodyError] = react.useState(void 0);
			const [loading, setLoading] = react.useState(false);
			const files = props.snapshot?.memory.files ?? [];
			const items = react.useMemo(() => files.filter((file) => file.track === "project").map((file) => itemOf(file)), [files]);
			const injected = props.snapshot?.memory.injectedChars ?? 0;
			const budget = props.snapshot?.memory.budget ?? 0;
			const truncated = props.snapshot?.memory.truncated === true;
			async function open(item) {
				if (openName === item.name) {
					setOpenName(void 0);
					setBody(void 0);
					setBodyError(void 0);
					return;
				}
				setOpenName(item.name);
				setBody(void 0);
				setBodyError(void 0);
				setLoading(true);
				try {
					const result = await props.readMemory("project", item.name);
					if (result.error !== void 0) setBodyError(result.error);
					else setBody(result.data?.body ?? "");
				} finally {
					setLoading(false);
				}
			}
			return /* @__PURE__ */ react.createElement("div", {
				"data-region": "memory-tab",
				"data-tab-scroll": "memory",
				ref: scroll.ref,
				onScroll: scroll.onScroll
			}, /* @__PURE__ */ react.createElement("div", { "data-memory-stat": true }, /* @__PURE__ */ react.createElement("span", { "data-memory-track": "project" }, "项目记忆"), /* @__PURE__ */ react.createElement("span", {
				"data-memory-budget": true,
				"data-truncated": truncated ? "true" : "false"
			}, "注入 ", injected, "/", budget, " 字符", truncated ? "（已截断）" : "")), items.length === 0 ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "本项目还没有记忆",
				hint: "让队长把约定沉淀成记忆，之后的派发会自动带上它",
				next: "公共记忆在左栏「全局」行里"
			}) : /* @__PURE__ */ react.createElement(MemoryList, {
				items,
				track: "project",
				expanded: openName,
				body: loading ? void 0 : body,
				bodyError,
				onOpen: (item) => void open(item)
			}), items.length > 0 ? /* @__PURE__ */ react.createElement("p", { "data-memory-hint": true }, "公共记忆见左栏「自动团队 → 全局」；token 数为估算值（≈ 字符数 / 2）。") : null);
		}
		// src/client/views/ConfirmDialog.tsx
		/**
		* 不可逆动作确认弹窗（r13 AC-11 / AC-12 / AC-13）。
		*
		* 五条硬约束（每一条都是真机上会出事的地方）：
		*  1. **默认焦点在「取消」**：不可逆动作的安全默认值是「不做」，回车不能直接造成破坏。
		*  2. `Esc` = 取消；`Tab` 只在两个按钮间循环（焦点不逃到面板背后）。
		*  3. 标题是**动词短语**（终止运行 / 中断成员 / 跳过任务 / 重新门禁 / 强制并行），
		*     按钮不得写「确定」——用户必须能在按下前读出「会发生什么」。
		*  4. 影响面文案 `summary` 来自宿主（含下游数量、写域冲突对象），客户端不改写、不截断。
		*  5. 不乐观确认：`busy` 时两个按钮都禁用并 `aria-busy`，等宿主快照把 pending 清掉。
		*
		* `fixed` 在带 `transform` 的祖先里会退化成相对定位（真机右栏就有这种祖先），
		* 所以运行时量一次宽度/定位，不可靠时切 `data-dialog-mode="inline"` 用内联兜底。
		*/
		function ConfirmDialog(props) {
			const { pending, busy, onConfirm, onReject } = props;
			const view = confirmDialogOf(pending);
			const dialogRef = react.useRef(null);
			const rejectRef = react.useRef(null);
			const [mode, setMode] = react.useState("fixed");
			const titleId = react.useId();
			const summaryId = react.useId();
			react.useEffect(() => {
				rejectRef.current?.focus();
			}, [pending.id]);
			react.useEffect(() => {
				const check = () => {
					const dialog = dialogRef.current;
					if (!dialog) return;
					const rect = dialog.getBoundingClientRect();
					const overlay = dialog.parentElement;
					const positioned = overlay ? window.getComputedStyle(overlay).position === "fixed" : false;
					if (rect.width < 360 || !positioned) setMode("inline");
				};
				check();
				window.addEventListener("resize", check);
				return () => window.removeEventListener("resize", check);
			}, []);
			react.useEffect(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						if (busy !== true) onReject();
						return;
					}
					if (event.key !== "Tab") return;
					const actions = dialogRef.current?.querySelectorAll("[data-dialog-action]");
					if (!actions || actions.length === 0) return;
					const first = actions[0];
					const last = actions[actions.length - 1];
					const active = document.activeElement;
					if (event.shiftKey && active === first) {
						event.preventDefault();
						last.focus();
					} else if (!event.shiftKey && active === last) {
						event.preventDefault();
						first.focus();
					}
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [busy, onReject]);
			return /* @__PURE__ */ react.createElement("div", {
				"data-confirm-overlay": true,
				"data-dialog-mode": mode
			}, /* @__PURE__ */ react.createElement("div", {
				ref: dialogRef,
				"data-confirm-dialog": true,
				"data-dialog-mode": mode,
				role: "dialog",
				"aria-modal": "true",
				"aria-labelledby": titleId,
				"aria-describedby": summaryId
			}, /* @__PURE__ */ react.createElement("div", { "data-dialog-head": true }, /* @__PURE__ */ react.createElement("h2", {
				id: titleId,
				"data-dialog-title": true
			}, view.title), /* @__PURE__ */ react.createElement("span", { "data-dialog-irreversible": true }, view.irreversibleText)), /* @__PURE__ */ react.createElement("dl", { "data-dialog-fields": true }, /* @__PURE__ */ react.createElement("dt", null, "动作"), /* @__PURE__ */ react.createElement("dd", { "data-dialog-action-name": true }, view.actionLabel), /* @__PURE__ */ react.createElement("dt", null, "对象"), /* @__PURE__ */ react.createElement("dd", { "data-dialog-object": true }, view.objectText), /* @__PURE__ */ react.createElement("dt", null, "影响"), /* @__PURE__ */ react.createElement("dd", {
				id: summaryId,
				"data-dialog-summary": true
			}, view.summary), /* @__PURE__ */ react.createElement("dt", null, "已等待"), /* @__PURE__ */ react.createElement("dd", { "data-dialog-waited": true }, view.waitedText)), /* @__PURE__ */ react.createElement("div", { "data-dialog-actions": true }, /* @__PURE__ */ react.createElement("button", {
				ref: rejectRef,
				type: "button",
				"data-dialog-action": "reject",
				"data-variant": "ghost",
				disabled: busy === true,
				onClick: onReject
			}, view.rejectLabel), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-dialog-action": "confirm",
				"data-variant": "danger",
				"aria-busy": busy === true,
				disabled: busy === true,
				onClick: onConfirm
			}, busy === true ? /* @__PURE__ */ react.createElement("span", {
				"data-dialog-spinner": true,
				"aria-hidden": "true"
			}) : null, view.confirmLabel))));
		}
		// src/client/Panel.tsx
		/**
		* 自动团队右栏面板容器（`sidebar.right.pane.tab` + `.title`，DESIGN §1.1 E3）。
		*
		* r13 的三条硬规矩：
		*  1. **三个页签**：任务 / 历史 / 记忆（`TABS` 是唯一来源，DOM 里的 `data-tab` 数量就由它产生）。
		*     角色管理已迁到设置页，所以旧的角色/成员/计划三个页签文件与 DOM 一并删除 —— 不保留隐藏页签。
		*  2. **页头（`[data-panel-head]` 3 个直系子）与元信息（`[data-panel-meta]` 三段）不动**：
		*     这两块是 r7 定稿的几何，挤进去的一切状态都下沉到页签内容里（如 `RunHeader`）。
		*     进度与暂停按钮随任务页的 `RunHeader` 走，所以本文件不再有 `[data-panel-progress-row]`。
		*  3. **快照是唯一数据源**，library/历史详情是**按需**的（AC-23）：本文件只在用户点开历史行时
		*     才调 `openRun`，`refresh()` 永不触发 `/library`。
		*
		* 本文件只做「容器 + 页头 + 三个页签 + 确认弹窗」，可见文案尽量下沉到 `ui.ts` / `viewmodel.ts`。
		*/
		/** 页签的唯一来源：AC-1 的 `data-tab` 计数直接由它产生（不在 JSX 里手写第二份）。 */
		const TABS = [
			{
				key: "tasks",
				label: "任务"
			},
			{
				key: "history",
				label: "历史"
			},
			{
				key: "memory",
				label: "记忆"
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
			const [tab, setTab] = react.useState("tasks");
			const [pauseBusy, setPauseBusy] = react.useState(false);
			const [confirmBusy, setConfirmBusy] = react.useState(false);
			/** 宿主没提供主区入口（或 `main` 槽位对第三方插件不开放）时的降级：面板内联左栏。 */
			const [inlineLibrary, setInlineLibrary] = react.useState(false);
			const act = view.act;
			const error = view.error;
			const readMemory = react.useCallback(async (track, name, workspace) => {
				const api = panelApi;
				if (typeof api.readMemory !== "function") return { error: "宿主未提供记忆读取接口" };
				return await api.readMemory(sessionId, track, name, workspace);
			}, [sessionId]);
			const planReady = snapshot?.planStatus !== void 0;
			react.useEffect(() => {
				if (planReady) setTab("tasks");
			}, [planReady]);
			react.useEffect(() => {
				if (typeof window === "undefined" || typeof window.addEventListener !== "function") return void 0;
				const onOpen = () => setTab("tasks");
				window.addEventListener(OPEN_PANEL_EVENT, onOpen);
				return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen);
			}, []);
			react.useEffect(() => {
				if (typeof window === "undefined" || typeof window.addEventListener !== "function") return void 0;
				const onOpenLibrary = () => setInlineLibrary(true);
				window.addEventListener(AUTO_TEAM_OPEN_LIBRARY_EVENT, onOpenLibrary);
				return () => window.removeEventListener(AUTO_TEAM_OPEN_LIBRARY_EVENT, onOpenLibrary);
			}, []);
			react.useEffect(() => {
				if (typeof window === "undefined" || typeof window.addEventListener !== "function") return void 0;
				const onCloseRefused = () => setCloseFailure("收起面板失败：宿主未提供关闭入口，请从页签上的 × 关闭");
				window.addEventListener(PANEL_CLOSE_EVENT, onCloseRefused);
				return () => window.removeEventListener(PANEL_CLOSE_EVENT, onCloseRefused);
			}, []);
			const capsule = capsuleOf(snapshot?.enabled === true, snapshot);
			const captain = captainModelLabelOf(snapshot?.captainModel);
			const degraded = snapshot?.degraded === true;
			const degradeReason = (snapshot?.degradeReason ?? "").trim();
			const tasks = snapshot?.tasks ?? [];
			const total = tasks.length;
			tasks.filter((task) => task.status === "done").length;
			const memberCount = snapshot?.members.length ?? 0;
			const running = snapshot?.concurrency?.running ?? 0;
			const limit = snapshot?.concurrency?.limit ?? 0;
			const paused = snapshot?.paused === true;
			const [closeFailure, setCloseFailure] = react.useState(void 0);
			const shownError = typeof error === "string" && error !== "" ? error : closeFailure;
			async function togglePause() {
				if (pauseBusy) return;
				setPauseBusy(true);
				try {
					await act({ type: paused ? "resumeTeam" : "pause" });
				} finally {
					setPauseBusy(false);
				}
			}
			/** 确认/取消待确认动作：**非乐观** —— 弹窗只在快照里 pending 消失后才关。 */
			async function resolvePending(action, pendingId) {
				if (confirmBusy) return;
				setConfirmBusy(true);
				try {
					await act({
						type: action,
						pendingId
					});
				} finally {
					setConfirmBusy(false);
				}
			}
			const pending = snapshot?.pendingConfirmation ?? view.detail?.pendingConfirmation;
			const tabProps = {
				sessionId,
				snapshot,
				act,
				readMemory,
				loadLibrary: view.loadLibrary,
				openRun: view.openRun,
				closeRun: view.closeRun,
				library: view.library,
				libraryError: view.libraryError,
				detail: view.detail,
				detailRunId: view.detailRunId,
				paused,
				pauseBusy,
				onTogglePause: () => void togglePause()
			};
			return /* @__PURE__ */ react.createElement("div", {
				"data-auto-team-panel": true,
				"data-enabled": snapshot?.enabled === true ? "true" : "false",
				"data-paused": paused ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("div", { "data-panel-head": true }, /* @__PURE__ */ react.createElement("strong", { "data-panel-title": true }, "自动团队"), /* @__PURE__ */ react.createElement("span", {
				"data-head-capsule": true,
				"data-tone": TONE_DATA[capsule.tone] ?? "neutral",
				title: capsule.text
			}, capsule.text), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				onClick: () => void view.refresh(),
				"data-panel-refresh": true,
				title: "重新拉取快照"
			}, "刷新")), /* @__PURE__ */ react.createElement("div", { "data-panel-meta": true }, /* @__PURE__ */ react.createElement("span", {
				"data-meta-plan": true,
				"data-meta": "plan",
				title: `计划 ${total} · 成员 ${memberCount} · 并发 ${running}/${limit}`
			}, "计划 ", total, " · 成员 ", memberCount, " · 并发 ", running, "/", limit), /* @__PURE__ */ react.createElement("span", {
				"data-meta-sep": true,
				"aria-hidden": "true"
			}), /* @__PURE__ */ react.createElement("span", {
				"data-captain-model": true,
				"data-meta": "captain-model",
				"data-tone": captain.tone,
				title: captain.label
			}, captain.label), /* @__PURE__ */ react.createElement("span", {
				"data-meta-sep": true,
				"aria-hidden": "true"
			}), /* @__PURE__ */ react.createElement("span", {
				"data-auto-team-degraded": degraded ? "true" : "false",
				"data-meta": "degraded",
				"data-tone": degraded ? "warn" : "neutral",
				title: degraded ? degradeReason : "四个宿主事件源都已订阅，Trigger 由事件即时推进"
			}, degraded ? `事件源降级${degradeReason !== "" ? `：${degradeReason}` : ""}` : "事件源正常")), paused ? /* @__PURE__ */ react.createElement("div", {
				"data-panel-paused-banner": true,
				role: "status"
			}, /* @__PURE__ */ react.createElement("span", {
				"data-paused-icon": true,
				"aria-hidden": "true"
			}, "⏸"), /* @__PURE__ */ react.createElement("span", { "data-paused-text": true }, "已暂停：派发与推进已停止，在跑成员不被打断"), typeof snapshot?.pausedAt === "number" ? /* @__PURE__ */ react.createElement("span", { "data-paused-at": true }, formatClock(snapshot.pausedAt)) : null) : null, inlineLibrary ? /* @__PURE__ */ react.createElement("div", { "data-panel-library-inline": true }, /* @__PURE__ */ react.createElement("div", { "data-panel-library-bar": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-library-inline-back": true,
				onClick: () => setInlineLibrary(false)
			}, "← 返回面板"), /* @__PURE__ */ react.createElement("span", { "data-panel-library-hint": true }, "主区未开放，项目库在面板内展开")), /* @__PURE__ */ react.createElement(LibraryPage, {
				sessionId,
				inline: true
			})) : /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("div", {
				"data-panel-tabs": true,
				"data-tab-bar": true,
				role: "tablist",
				"aria-label": "自动团队视图"
			}, TABS.map((item) => /* @__PURE__ */ react.createElement("button", {
				key: item.key,
				type: "button",
				role: "tab",
				id: `auto-team-tab-${item.key}`,
				"aria-controls": `auto-team-tabpanel-${item.key}`,
				"data-panel-tab": item.key,
				"data-tab": item.key,
				"data-active": tab === item.key ? "true" : "false",
				"aria-selected": tab === item.key,
				onClick: () => setTab(item.key)
			}, item.label))), shownError === void 0 ? null : /* @__PURE__ */ react.createElement("div", {
				"data-error": true,
				role: "alert"
			}, shownError), /* @__PURE__ */ react.createElement("div", {
				"data-panel-body": true,
				"data-active-tab": tab,
				role: "tabpanel",
				id: `auto-team-tabpanel-${tab}`,
				"aria-labelledby": `auto-team-tab-${tab}`
			}, tab === "tasks" ? /* @__PURE__ */ react.createElement(TasksTab, tabProps) : null, tab === "history" ? /* @__PURE__ */ react.createElement(HistoryTab, tabProps) : null, tab === "memory" ? /* @__PURE__ */ react.createElement(MemoryTab, tabProps) : null, snapshot === void 0 && view.loading ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "正在读取面板数据…",
				hint: "宿主首次响应通常不到 1 秒"
			}) : null)), pending === void 0 ? null : /* @__PURE__ */ react.createElement(ConfirmDialog, {
				pending,
				busy: confirmBusy,
				onConfirm: () => void resolvePending("confirmPending", pending.id),
				onReject: () => void resolvePending("rejectPending", pending.id)
			}));
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
		// src/client/ModelPicker.tsx
		/**
		* 角色模型弹层选择器（r10 AC-16，DESIGN §2.4 M4）。
		*
		* 为什么不再用两个裸输入框：r7 的 `provider` / `model` 文本框要求用户手打「宿主侧的服务名 +
		* 模型 id」，绝大多数人打不出、打错也不报错（直到派发时才炸）；而裸输入框还让卡片多出两行
		* 高度（AC-16 判据：角色卡里裸 provider / model 输入框必须 0 处，手填入口挪进气泡并改钩子）。
		*
		* 本组件的四条硬规则：
		*  1. **按钮 + 气泡**：按钮上只显示当前值（`provider/model`，空则「跟随会话默认」），
		*     点开才是搜索 + 列表；选中即回填并关闭。
		*  2. **手填兜底仍在，但换 hook 并折叠**：`data-model-manual-provider` / `data-model-manual-model`
		*     —— 宿主模型清单取不到时（`status === 'empty'`）用户仍有出路，同时不污染 AC-16 的计数。
		*  3. **空清单要说人话**：`[data-model-empty]` 两行（原因 + 出路），绝不静默空列表。
		*  4. **非乐观**：选中只上抛 `onChange`（父组件改草稿），值由 props 回流；本组件不存第二份值。
		*
		* 气泡用 `position: fixed` + 按按钮矩形算出坐标（top/left 走内联样式）：角色卡在右栏/设置页
		* 都有滚动容器，`position: absolute` 的气泡会被 `overflow:hidden` 裁掉；fixed 脱离该裁剪
		* 上下文，滚动/缩放时重算坐标即可。**不用 createPortal**：本仓没有 react-dom（node_modules 里
		* 只有 react，peerDependencies 也只声明 react，tsdown external 只列 'react'），import 它
		* 直接 TS2307；改成固定定位覆盖层后行为等价、且不引新依赖。
		*/
		/** 一行候选项的搜索键（provider 名、模型名都参与匹配，用户记哪个都能搜到）。 */
		function matches(option, keyword) {
			if (keyword === "") return true;
			return `${option.provider} ${option.providerName} ${option.model} ${option.modelName}`.toLowerCase().includes(keyword.toLowerCase());
		}
		/** 「当前选中」比较：provider + model 相同即算选中（effort 不属于清单维度）。 */
		function isSelected(option, value) {
			if (value === void 0) return false;
			return option.provider === value.provider && option.model === value.model;
		}
		function ModelPicker(props) {
			const [open, setOpen] = react.useState(false);
			const [keyword, setKeyword] = react.useState("");
			const [manualOpen, setManualOpen] = react.useState(false);
			const buttonRef = react.useRef(null);
			const popoverRef = react.useRef(null);
			const [anchor, setAnchor] = react.useState({
				top: 0,
				left: 0
			});
			const options = props.catalog?.options ?? [];
			const visible = options.filter((option) => matches(option, keyword));
			const label = modelPickerLabel(props.value);
			const close = react.useCallback(() => {
				setOpen(false);
				setManualOpen(false);
				setKeyword("");
				const button = buttonRef.current;
				if (button !== null && typeof button.focus === "function") button.focus();
			}, []);
			react.useEffect(() => {
				if (!open) return void 0;
				const place = () => {
					const button = buttonRef.current;
					if (button === null || typeof button.getBoundingClientRect !== "function") return;
					const rect = button.getBoundingClientRect();
					const width = 296;
					const margin = 8;
					const viewport = typeof window === "undefined" ? 312 : window.innerWidth;
					const left = Math.max(margin, Math.min(rect.left, viewport - width - margin));
					setAnchor({
						top: rect.bottom + 4,
						left
					});
				};
				place();
				const onKey = (event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						close();
					}
				};
				const onDown = (event) => {
					const target = event.target;
					if (target === null) return;
					if (popoverRef.current?.contains(target) === true) return;
					if (buttonRef.current?.contains(target) === true) return;
					close();
				};
				document.addEventListener("keydown", onKey);
				document.addEventListener("mousedown", onDown);
				window.addEventListener("resize", place);
				window.addEventListener("scroll", place, true);
				return () => {
					document.removeEventListener("keydown", onKey);
					document.removeEventListener("mousedown", onDown);
					window.removeEventListener("resize", place);
					window.removeEventListener("scroll", place, true);
				};
			}, [open, close]);
			function pick(option) {
				props.onChange({
					provider: option.provider,
					model: option.model
				});
				close();
			}
			function patchManual(field, raw) {
				const provider = field === "provider" ? raw : props.value?.provider ?? "";
				const model = field === "model" ? raw : props.value?.model ?? "";
				if (provider.trim() === "" && model.trim() === "") {
					props.onChange(void 0);
					return;
				}
				const next = {
					provider,
					model
				};
				if (props.value?.reasoningEffort !== void 0) next.reasoningEffort = props.value.reasoningEffort;
				props.onChange(next);
			}
			const popover = open ? /* @__PURE__ */ react.createElement("div", {
				ref: popoverRef,
				"data-role-model-popover": true,
				role: "dialog",
				"aria-label": "选择角色模型",
				"data-catalog-status": props.catalog?.status ?? "loading",
				style: {
					top: anchor.top,
					left: anchor.left
				}
			}, /* @__PURE__ */ react.createElement("div", { "data-model-search-row": true }, /* @__PURE__ */ react.createElement("input", {
				"data-model-search": true,
				type: "search",
				value: keyword,
				placeholder: "搜索服务或模型",
				"aria-label": "搜索服务或模型",
				onChange: (event) => setKeyword(event.currentTarget.value)
			})), props.catalog === void 0 || props.catalog.status === "loading" ? /* @__PURE__ */ react.createElement("div", { "data-model-loading": true }, "正在读取宿主模型清单…") : props.catalog.status === "empty" || options.length === 0 ? /* @__PURE__ */ react.createElement("div", { "data-model-empty": true }, /* @__PURE__ */ react.createElement("p", { "data-model-empty-reason": true }, "宿主没有提供模型清单", (props.catalog?.reason ?? "").trim() === "" ? "" : `：${props.catalog.reason}`), /* @__PURE__ */ react.createElement("p", { "data-model-empty-hint": true }, "仍可在下面的「手动填写」里直接输入服务名与模型 id。")) : visible.length === 0 ? /* @__PURE__ */ react.createElement("div", {
				"data-model-empty": true,
				"data-model-no-match": true
			}, "没有匹配「", keyword, "」的模型，换个关键词或手动填写。") : /* @__PURE__ */ react.createElement("div", {
				"data-model-list": true,
				role: "listbox",
				"aria-label": "可选模型"
			}, visible.map((option) => {
				const selected = isSelected(option, props.value);
				return /* @__PURE__ */ react.createElement("button", {
					key: `${option.provider}/${option.model}`,
					type: "button",
					role: "option",
					"data-model-option": true,
					"data-provider": option.provider,
					"data-model": option.model,
					"aria-selected": selected,
					onClick: () => pick(option)
				}, /* @__PURE__ */ react.createElement("span", { "data-model-option-name": true }, option.modelName || option.model), /* @__PURE__ */ react.createElement("span", { "data-model-option-provider": true }, option.providerName || option.provider));
			})), /* @__PURE__ */ react.createElement("div", {
				"data-role-model-manual": true,
				"data-open": manualOpen ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-model-manual-toggle": true,
				onClick: () => setManualOpen((previous) => !previous)
			}, manualOpen ? "收起手动填写" : "手动填写"), manualOpen ? /* @__PURE__ */ react.createElement("div", { "data-model-manual-fields": true }, /* @__PURE__ */ react.createElement("label", { "data-model-manual-field": true }, /* @__PURE__ */ react.createElement("span", null, "服务名"), /* @__PURE__ */ react.createElement("input", {
				"data-model-manual-provider": true,
				"aria-label": "服务名",
				value: props.value?.provider ?? "",
				placeholder: "例如 dsh-primary",
				onChange: (event) => patchManual("provider", event.currentTarget.value)
			})), /* @__PURE__ */ react.createElement("label", { "data-model-manual-field": true }, /* @__PURE__ */ react.createElement("span", null, "模型 id"), /* @__PURE__ */ react.createElement("input", {
				"data-model-manual-model": true,
				"aria-label": "模型 id",
				value: props.value?.model ?? "",
				placeholder: "例如 deepseek-v4.1-flash",
				onChange: (event) => patchManual("model", event.currentTarget.value)
			}))) : null), /* @__PURE__ */ react.createElement("div", { "data-model-popover-foot": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-model-clear": true,
				onClick: () => {
					props.onChange(void 0);
					close();
				}
			}, "清空（跟随会话默认）"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-model-close": true,
				onClick: close
			}, "关闭"))) : null;
			return /* @__PURE__ */ react.createElement("div", {
				"data-role-model-picker": true,
				"data-open": open ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("button", {
				ref: buttonRef,
				type: "button",
				"data-role-model-picker-button": true,
				"aria-haspopup": "dialog",
				"aria-expanded": open,
				disabled: props.busy || props.disabled === true,
				title: label,
				onClick: () => setOpen((previous) => !previous)
			}, /* @__PURE__ */ react.createElement("span", { "data-model-value": true }, label), /* @__PURE__ */ react.createElement("span", {
				"data-model-caret": true,
				"aria-hidden": "true"
			}, "▾")), popover);
		}
		// src/client/SkillDialogs.tsx
		/**
		* 技能层三个模态中的两个（DESIGN §2.5 M5 / M6）：
		*   - `SkillEditDialog`：新建 / 编辑一条技能（正文**按需**读取）；
		*   - `SystemSkillPicker`：从宿主系统技能库（`~/.agents/skills`）多选导入。
		*
		* 为什么这两个合并成一个文件（TECHNICAL §5.4）：它们同属一类模态（Esc + 焦点回归 +
		* 提交中去抖），写两遍焦点陷阱必然有一份漏了 Esc 或漏了焦点归还 —— 本项目历史上
		* 「弹层关掉焦点丢到 body」出现过两次，所以只写一遍 shell，两个弹层共用。
		*
		* 关于 createPortal：技术方案写的是「全部 createPortal 到 body」，但本仓没有 react-dom
		* （node_modules 里只有 react，peerDependencies 只声明 react，tsdown external 只列 'react'），
		* import 它直接 TS2307。这里改用「固定定位覆盖层」：`[data-skill-dialog-backdrop]` 是
		* `position: fixed; inset: 0`，fixed 定位不受祖先 `overflow:hidden` 裁剪，视觉与交互等价，
		* 且不引新依赖。宿主自绘标题栏的 `-webkit-app-region: drag` 风险仍在（真机需人工点一次）。
		*
		* 三条硬约定：
		*  1. **正文绝不给空 textarea**：打开时先骨架（3 行呼吸条），`readSkill` 回来才换成正文；
		*     失败给「正文读取失败：<原因>」+ 重试按钮，**不**降级成空框（空框保存 = 静默清空正文）。
		*  2. **保存非乐观**：`busy` 期间按钮显示「保存中…」并 disabled，弹层**不关**；
		*     失败把原因显示在 `[data-dialog-error]` 里，用户输入一个字都不丢。
		*  3. **长度上限与宿主同一个数**：`SKILL_*_MAX` 来自 `src/shared/const.ts`（不许在这里再写字面量），
		*     否则会出现「界面放行、宿主拒绝」的错位。
		*/
		/**
		* 模态的公共外壳：Esc 关闭、打开时把焦点放进面板、关闭后还给触发元素。
		*
		* 为什么用固定定位覆盖层而不是 portal（本项目踩过）：角色卡在 `overflow:hidden` 的滚动容器里，
		* 内联绝对定位弹层会被裁掉；fixed 元素不受该裁剪影响。本仓没有 react-dom，故不做 portal，
		* 宿主自绘标题栏的 `-webkit-app-region: drag` 风险留在真机清单里（AC-12~AC-15 同批验）。
		*/
		function useModalShell(onClose, busy) {
			const panelRef = react.useRef(null);
			const previousFocus = react.useRef(null);
			react.useEffect(() => {
				const active = typeof document === "undefined" ? null : document.activeElement;
				previousFocus.current = active;
				const target = panelRef.current;
				if (target !== null && typeof target.focus === "function") target.focus();
				return () => {
					const previous = previousFocus.current;
					if (previous !== null && previous instanceof HTMLElement && typeof previous.focus === "function") previous.focus();
				};
			}, []);
			react.useEffect(() => {
				if (typeof window === "undefined") return void 0;
				const onKey = (event) => {
					if (event.key !== "Escape") return;
					if (busy) return;
					event.stopPropagation();
					onClose();
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose, busy]);
			return {
				panelRef,
				onKeyDown: (event) => {
					if (event.key !== "Escape") return;
					if (busy) return;
					event.stopPropagation();
					onClose();
				}
			};
		}
		function SkillEditDialog(props) {
			const editing = props.skill !== void 0;
			const builtin = props.skill?.source === "builtin";
			const source = props.skill?.source ?? props.source ?? "manual";
			const [title, setTitle] = react.useState(props.skill?.title ?? props.initialTitle ?? "");
			const [description, setDescription] = react.useState(props.skill?.description ?? props.initialDescription ?? "");
			const [body, setBody] = react.useState(editing ? "" : props.initialBody ?? "");
			const [loadState, setLoadState] = react.useState(editing ? "loading" : "ready");
			const [loadError, setLoadError] = react.useState(void 0);
			const [localError, setLocalError] = react.useState(void 0);
			const shell = useModalShell(props.onClose, props.busy);
			const loadBody = react.useCallback(async () => {
				const skill = props.skill;
				if (skill === void 0) return;
				if (props.readSkill === void 0) {
					setLoadState("error");
					setLoadError("宿主未提供技能正文读取接口");
					return;
				}
				setLoadState("loading");
				setLoadError(void 0);
				const result = await props.readSkill(skill.id);
				if (result.error !== void 0) {
					setLoadState("error");
					setLoadError(result.error);
					return;
				}
				setBody(result.data.body);
				setLoadState("ready");
			}, [props.skill, props.readSkill]);
			react.useEffect(() => {
				if (!editing) return;
				loadBody();
			}, [props.skill?.id]);
			function submit() {
				const trimmedTitle = title.trim();
				const trimmedDescription = description.trim();
				const problem = trimmedTitle === "" ? "技能名称不能为空" : trimmedTitle.length > 80 ? `技能名称最多 80 个字符` : trimmedDescription === "" ? "技能说明不能为空" : trimmedDescription.length > 200 ? `技能说明最多 200 个字符` : body.trim() === "" ? "技能正文不能为空" : body.length > 2e4 ? `技能正文最多 ${SKILL_BODY_MAX} 个字符（当前 ${body.length}）` : void 0;
				if (problem !== void 0) {
					setLocalError(problem);
					return;
				}
				setLocalError(void 0);
				const draft = {
					title: trimmedTitle,
					description: trimmedDescription,
					body,
					source
				};
				if (props.skill !== void 0) draft.id = props.skill.id;
				if (source === "system" && props.skill !== void 0) draft.systemName = props.skill.id;
				props.onSave(draft);
			}
			const shownError = localError ?? props.error;
			const dialog = /* @__PURE__ */ react.createElement("div", {
				"data-skill-dialog-backdrop": true,
				"data-dialog": "skill-edit",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget && !props.busy) props.onClose();
				}
			}, /* @__PURE__ */ react.createElement("div", {
				ref: shell.panelRef,
				"data-skill-dialog": true,
				role: "dialog",
				"aria-modal": "true",
				"aria-label": editing ? `编辑技能：${props.skill?.title ?? ""}` : "新建技能",
				tabIndex: -1,
				onKeyDown: shell.onKeyDown
			}, /* @__PURE__ */ react.createElement("div", { "data-dialog-head": true }, /* @__PURE__ */ react.createElement("strong", { "data-dialog-title": true }, editing ? `编辑技能：${props.skill?.title ?? ""}` : "新建技能"), /* @__PURE__ */ react.createElement("span", {
				"data-dialog-badge": true,
				"data-source": source
			}, skillSourceLabel(source)), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-dialog-close": true,
				"aria-label": "关闭",
				disabled: props.busy,
				onClick: props.onClose
			}, "×")), builtin ? /* @__PURE__ */ react.createElement("p", { "data-skill-builtin-hint": true }, "内置技能：保存后写在本机副本，不改插件包内文件。") : null, /* @__PURE__ */ react.createElement("label", { "data-dialog-field": true }, /* @__PURE__ */ react.createElement("span", { "data-dialog-label": true }, "名称"), /* @__PURE__ */ react.createElement("input", {
				"data-skill-title-input": true,
				"aria-label": "技能名称",
				value: title,
				maxLength: 80,
				disabled: props.busy,
				onChange: (event) => setTitle(event.currentTarget.value)
			})), /* @__PURE__ */ react.createElement("label", { "data-dialog-field": true }, /* @__PURE__ */ react.createElement("span", { "data-dialog-label": true }, "说明"), /* @__PURE__ */ react.createElement("input", {
				"data-skill-description-input": true,
				"aria-label": "技能说明",
				value: description,
				maxLength: 200,
				disabled: props.busy,
				onChange: (event) => setDescription(event.currentTarget.value)
			})), /* @__PURE__ */ react.createElement("div", {
				"data-dialog-field": true,
				"data-dialog-field-body": true
			}, /* @__PURE__ */ react.createElement("span", { "data-dialog-label": true }, "正文"), loadState === "loading" ? /* @__PURE__ */ react.createElement("div", {
				"data-skill-body-skeleton": true,
				"aria-busy": "true",
				"aria-label": "正在读取技能正文"
			}, /* @__PURE__ */ react.createElement("span", null), /* @__PURE__ */ react.createElement("span", null), /* @__PURE__ */ react.createElement("span", null)) : loadState === "error" ? /* @__PURE__ */ react.createElement("div", {
				"data-skill-body-error": true,
				role: "alert"
			}, /* @__PURE__ */ react.createElement("p", null, "正文读取失败：", loadError ?? "未知原因"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-skill-body-retry": true,
				onClick: () => void loadBody()
			}, "重试")) : /* @__PURE__ */ react.createElement("textarea", {
				"data-skill-body-input": true,
				"aria-label": "技能正文",
				value: body,
				disabled: props.busy,
				onChange: (event) => setBody(event.currentTarget.value)
			}), loadState === "ready" ? /* @__PURE__ */ react.createElement("span", {
				"data-skill-body-count": true,
				"data-over-limit": body.length > 2e4 ? "true" : "false"
			}, body.length, "/", SKILL_BODY_MAX) : null), shownError === void 0 ? null : /* @__PURE__ */ react.createElement("p", {
				"data-dialog-error": true,
				role: "alert"
			}, shownError), /* @__PURE__ */ react.createElement("div", { "data-dialog-actions": true }, builtin && props.skill !== void 0 && props.onRestoreBuiltin !== void 0 ? /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-skill-restore-in-dialog": true,
				disabled: props.busy,
				onClick: () => props.onRestoreBuiltin(props.skill.id)
			}, "恢复出厂") : null, /* @__PURE__ */ react.createElement("span", { "data-dialog-actions-spacer": true }), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-dialog-cancel": true,
				disabled: props.busy,
				onClick: props.onClose
			}, "取消"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-dialog-save": true,
				"data-primary": "true",
				disabled: props.busy || loadState !== "ready",
				"aria-busy": props.busy ? "true" : "false",
				onClick: submit
			}, props.busy ? "保存中…" : "保存"))));
			return /* @__PURE__ */ react.createElement(react.Fragment, null, dialog);
		}
		function SystemSkillPicker(props) {
			const [keyword, setKeyword] = react.useState("");
			const [picked, setPicked] = react.useState([]);
			const shell = useModalShell(props.onClose, props.busy);
			const list = props.skills ?? [];
			const visible = list.filter((skill) => {
				if (keyword === "") return true;
				return `${skill.name} ${skill.description}`.toLowerCase().includes(keyword.toLowerCase());
			});
			const empty = list.length === 0;
			const emptyReason = (props.reason ?? "").trim();
			function toggle(name) {
				setPicked((previous) => previous.includes(name) ? previous.filter((item) => item !== name) : [...previous, name]);
			}
			function submit() {
				if (picked.length === 0) return;
				const chosen = list.filter((skill) => picked.includes(skill.name));
				props.onImport(chosen);
			}
			const dialog = /* @__PURE__ */ react.createElement("div", {
				"data-skill-dialog-backdrop": true,
				"data-dialog": "system-skills",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget && !props.busy) props.onClose();
				}
			}, /* @__PURE__ */ react.createElement("div", {
				ref: shell.panelRef,
				"data-skill-dialog": true,
				"data-dialog-size": "wide",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": "从系统技能库选择",
				tabIndex: -1,
				onKeyDown: shell.onKeyDown
			}, /* @__PURE__ */ react.createElement("div", { "data-dialog-head": true }, /* @__PURE__ */ react.createElement("strong", { "data-dialog-title": true }, "从系统技能库选择"), /* @__PURE__ */ react.createElement("span", { "data-skill-picker-count": true }, "已选 ", picked.length, " 条"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-dialog-close": true,
				"aria-label": "关闭",
				disabled: props.busy,
				onClick: props.onClose
			}, "×")), /* @__PURE__ */ react.createElement("div", { "data-dialog-field": true }, /* @__PURE__ */ react.createElement("input", {
				"data-skill-picker-search": true,
				type: "search",
				"aria-label": "搜索系统技能",
				placeholder: "搜索系统技能",
				value: keyword,
				disabled: props.busy,
				onChange: (event) => setKeyword(event.currentTarget.value)
			})), empty ? /* @__PURE__ */ react.createElement("div", { "data-skill-picker-empty": true }, /* @__PURE__ */ react.createElement("p", null, "本机没有可用系统技能。"), /* @__PURE__ */ react.createElement("p", null, emptyReason === "" ? "宿主系统技能库（~/.agents/skills）里没有可读的 SKILL.md。" : emptyReason)) : visible.length === 0 ? /* @__PURE__ */ react.createElement("div", { "data-skill-picker-empty": true }, "没有匹配「", keyword, "」的系统技能。") : /* @__PURE__ */ react.createElement("div", {
				"data-skill-picker-list": true,
				role: "group",
				"aria-label": "系统技能"
			}, visible.map((skill) => {
				const checked = picked.includes(skill.name);
				return /* @__PURE__ */ react.createElement("label", {
					key: skill.name,
					"data-skill-picker-row": true,
					"data-checked": checked ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("input", {
					type: "checkbox",
					"data-skill-picker-input": skill.name,
					checked,
					disabled: props.busy,
					"aria-label": `选择系统技能：${skill.name}`,
					onChange: () => toggle(skill.name)
				}), /* @__PURE__ */ react.createElement("span", { "data-skill-picker-name": true }, skill.name), /* @__PURE__ */ react.createElement("span", { "data-skill-picker-desc": true }, skill.description));
			})), props.error === void 0 ? null : /* @__PURE__ */ react.createElement("p", {
				"data-dialog-error": true,
				role: "alert"
			}, props.error), /* @__PURE__ */ react.createElement("div", { "data-dialog-actions": true }, /* @__PURE__ */ react.createElement("span", { "data-dialog-actions-spacer": true }), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-dialog-cancel": true,
				disabled: props.busy,
				onClick: props.onClose
			}, "取消"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-dialog-save": true,
				"data-primary": "true",
				disabled: props.busy || picked.length === 0,
				"aria-busy": props.busy ? "true" : "false",
				onClick: submit
			}, props.busy ? "导入中…" : "导入所选"))));
			return /* @__PURE__ */ react.createElement(react.Fragment, null, dialog);
		}
		// src/client/RoleEditor.tsx
		/**
		* 角色编辑列表 + 技能库（**面板角色页与设置页共用同一份**，DESIGN §3.3 / TECHNICAL §4.5）。
		*
		* 为什么必须共用（本项目历史 bug 族）：如果面板页与设置页各写一套保存链，用户会遇到
		* 「面板里改的顺手、设置里改的不生效」，且同一份角色数据出现两处缓存与两条校验路径。
		* 这里只做**编辑与校验**，保存动作由容器（r13 后仅剩 SettingsPage；面板「角色」页已删除，
		* 角色管理统一留在设置页）用同一个 `act({type:'saveRole'})` 发出 —— 本组件不 import api、不发请求。
		*
		* r10 的两处结构变化：
		*  1. **技能成为独立实体**（AC-17~AC-21）：技能列表不再只是角色卡里的复选框，编辑区顶部多一个
		*     技能库（`[data-skill-library]`），每行有来源徽标 / 「已修改」徽标 / 编辑 / 恢复出厂 / 删除。
		*     内置技能只给「恢复出厂」（不可删），用户三源只给「删除」——这条分支由 `ui.ts` 的
		*     `skillRowView()` 纯函数决定（AC-19 的可分辨断言落在那里，组件只消费它的结果）。
		*  2. **技能变更随 `saveRole` 上送**（AC-25 形状冻结）：`onSave(undefined, [mutation])` 表示
		*     「只改技能、不动角色」。这样 `PanelAction` 仍是 15 种、路由仍是 3 条。
		*
		* `density` 只控制字号与按钮形态（`panel` 窄、`page` 宽），**不改行为**。
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
		/** 技能清单的内容签名：只有真变了才重建本地副本（否则 2s 轮询会冲掉用户的乐观更新）。 */
		function signatureOfSkills(skills) {
			return skills.map((skill) => [
				skill.id,
				skill.title,
				skill.description,
				skill.source,
				skill.modified
			].join("|")).join(";");
		}
		/** 摘掉 YAML frontmatter（导入的 md 自带一份，重复渲染会出现两段）。 */
		function stripFrontmatter(text) {
			const normalized = text.replace(/\r\n/g, "\n");
			if (!normalized.startsWith("---")) return {
				meta: {},
				body: text
			};
			const end = normalized.indexOf("\n---", 3);
			if (end < 0) return {
				meta: {},
				body: text
			};
			const head = normalized.slice(3, end);
			const meta = {};
			for (const line of head.split("\n")) {
				const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
				if (match === null) continue;
				meta[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
			}
			const body = normalized.slice(end + 4).replace(/^\n+/, "");
			return {
				meta,
				body: body === "" ? text : body
			};
		}
		/** 从导入的 md 猜标题与说明（宽松兜底：猜不出就用文件名，绝不因格式不符拒绝导入）。 */
		function guessTitleAndDescription(fileName, text) {
			const { meta, body } = stripFrontmatter(text);
			const heading = body.split("\n").find((line) => /^#\s+\S/.test(line.trim()));
			const fallbackTitle = fileName.replace(/\.md$/i, "").trim();
			const title = (meta.title ?? (heading !== void 0 ? heading.trim().replace(/^#\s+/, "") : fallbackTitle)).slice(0, 80).trim();
			const firstLine = body.split("\n").map((line) => line.trim()).find((line) => line !== "" && !line.startsWith("#") && !line.startsWith("```"));
			const description = (meta.description ?? firstLine ?? title).slice(0, 200).trim();
			return {
				title: title === "" ? fallbackTitle : title,
				description: description === "" ? title : description
			};
		}
		function readFileText(file) {
			return new Promise((resolve, reject) => {
				if (typeof FileReader === "undefined") {
					reject(/* @__PURE__ */ new Error("当前环境不支持读取本地文件"));
					return;
				}
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result ?? ""));
				reader.onerror = () => reject(/* @__PURE__ */ new Error("读取文件失败"));
				reader.readAsText(file);
			});
		}
		function RoleEditorList(props) {
			const { roles, skills, density, busy } = props;
			const [drafts, setDrafts] = react.useState({});
			const [pendingDelete, setPendingDelete] = react.useState(void 0);
			const [confirmRestore, setConfirmRestore] = react.useState(false);
			const [errors, setErrors] = react.useState({});
			const [hint, setHint] = react.useState(void 0);
			const sequence = react.useRef(0);
			const [library, setLibrary] = react.useState(skills);
			const skillsSignature = signatureOfSkills(skills);
			react.useEffect(() => {
				setLibrary(skills.map((skill) => ({ ...skill })));
			}, [skillsSignature]);
			const [menuOpen, setMenuOpen] = react.useState(false);
			const [pickerOpen, setPickerOpen] = react.useState(false);
			const [editing, setEditing] = react.useState(void 0);
			const [dialogError, setDialogError] = react.useState(void 0);
			const [skillConfirm, setSkillConfirm] = react.useState(void 0);
			const [notice, setNotice] = react.useState(void 0);
			const importRef = react.useRef(null);
			const [importError, setImportError] = react.useState(void 0);
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
			function submitSkill(draft) {
				setDialogError(void 0);
				let title = draft.title;
				if (draft.id === void 0) {
					const taken = new Set(library.map((skill) => skill.title.trim().toLowerCase()));
					let copy = 1;
					while (taken.has(title.trim().toLowerCase())) {
						copy += 1;
						title = `${draft.title}（${copy}）`;
					}
				}
				const normalized = {
					...draft,
					title
				};
				props.onSave(void 0, [{
					op: "save",
					skill: normalized
				}]);
				if (draft.id !== void 0) {
					const targetId = draft.id;
					setLibrary((previous) => previous.map((skill) => skill.id === targetId ? {
						...skill,
						title: normalized.title,
						description: normalized.description,
						modified: skill.source === "builtin"
					} : skill));
					setNotice(`已提交技能「${normalized.title}」`);
				} else setNotice(`已提交新技能「${normalized.title}」，刷新后可在角色里勾选`);
				setEditing(void 0);
			}
			function removeSkill(skill) {
				setSkillConfirm(void 0);
				props.onSave(void 0, [{
					op: "delete",
					id: skill.id
				}]);
				setLibrary((previous) => previous.filter((item) => item.id !== skill.id));
				const affected = Object.values(drafts).filter((role) => role.skillIds.includes(skill.id)).length;
				setNotice(`已删除「${skill.title}」，并从 ${affected} 个角色摘除引用`);
			}
			function restoreSkill(skill) {
				setSkillConfirm(void 0);
				props.onSave(void 0, [{
					op: "restoreBuiltin",
					id: skill.id
				}]);
				setLibrary((previous) => previous.map((item) => item.id === skill.id ? {
					...item,
					modified: false
				} : item));
				setNotice(`已把内置技能「${skill.title}」恢复为出厂正文`);
			}
			function openCreate(source) {
				setMenuOpen(false);
				setDialogError(void 0);
				setEditing({
					mode: "create",
					source
				});
			}
			async function onPickFile(event) {
				const file = event.currentTarget.files?.[0];
				event.currentTarget.value = "";
				if (file === void 0) return;
				setImportError(void 0);
				try {
					const text = await readFileText(file);
					if (text.trim() === "") {
						setImportError("文件是空的，没有可导入的正文");
						return;
					}
					const { body } = stripFrontmatter(text);
					const guess = guessTitleAndDescription(file.name, text);
					setMenuOpen(false);
					setEditing({
						mode: "create",
						source: "imported",
						body: body.slice(0, SKILL_BODY_MAX),
						title: guess.title,
						description: guess.description
					});
				} catch (error) {
					setImportError(error instanceof Error ? error.message : "读取文件失败");
				}
			}
			function importSystemSkills(picks) {
				setPickerOpen(false);
				if (picks.length === 0) return;
				const mutations = picks.map((pick) => ({
					op: "save",
					skill: {
						title: pick.name,
						description: pick.description === "" ? pick.name : pick.description.slice(0, 200),
						body: "",
						source: "system",
						systemName: pick.name
					}
				}));
				props.onSave(void 0, mutations);
				const taken = new Set(library.map((skill) => skill.title.trim().toLowerCase()));
				const optimistic = picks.filter((pick) => !taken.has(pick.name.trim().toLowerCase())).map((pick) => ({
					id: pick.name,
					title: pick.name,
					description: pick.description,
					source: "system",
					modified: false
				}));
				setLibrary((previous) => [...previous, ...optimistic]);
				setNotice(`已从系统技能库导入 ${picks.length} 条`);
			}
			const ordered = Object.keys(drafts).map((id) => drafts[id]).sort((left, right) => {
				if (left.builtin !== right.builtin) return left.builtin ? -1 : 1;
				return left.id.localeCompare(right.id);
			});
			const sourceOrder = {
				builtin: 0,
				imported: 1,
				system: 2,
				manual: 3
			};
			const orderedSkills = [...library].sort((left, right) => {
				const delta = (sourceOrder[left.source] ?? 9) - (sourceOrder[right.source] ?? 9);
				if (delta !== 0) return delta;
				return left.title.localeCompare(right.title);
			});
			const builtinCount = ordered.filter((role) => role.builtin).length;
			const restoreView = restoreConfirmView({
				builtinRoles: builtinCount,
				customRoles: ordered.length - builtinCount,
				userSkills: library.filter((skill) => skill.source !== "builtin").length,
				builtinSkills: library.filter((skill) => skill.source === "builtin").length
			});
			return /* @__PURE__ */ react.createElement("section", {
				"data-auto-team-role-editor": true,
				"data-density": density,
				"data-busy": busy ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("div", { "data-skill-library": true }, /* @__PURE__ */ react.createElement("div", { "data-skills-head": true }, /* @__PURE__ */ react.createElement("span", { "data-skills-count": true }, "技能库 ", library.length, " 条（内置 ", library.filter((skill) => skill.source === "builtin").length, "）"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-skill-add": true,
				"aria-expanded": menuOpen ? "true" : "false",
				disabled: busy,
				onClick: () => setMenuOpen((previous) => !previous)
			}, "＋ 添加技能")), menuOpen ? /* @__PURE__ */ react.createElement("div", {
				"data-skill-add-menu": true,
				role: "menu",
				"aria-label": "添加技能"
			}, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-skill-add-import": true,
				disabled: busy,
				onClick: () => importRef.current?.click()
			}, "导入 .md"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-skill-add-system": true,
				disabled: busy,
				onClick: () => {
					setMenuOpen(false);
					setPickerOpen(true);
				}
			}, "系统技能"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-skill-add-manual": true,
				disabled: busy,
				onClick: () => openCreate("manual")
			}, "手动新建")) : null, /* @__PURE__ */ react.createElement("input", {
				ref: importRef,
				type: "file",
				"data-skill-import-input": true,
				accept: ".md,text/markdown",
				style: { display: "none" },
				onChange: (event) => void onPickFile(event)
			}), importError === void 0 ? null : /* @__PURE__ */ react.createElement("p", {
				"data-skill-import-error": true,
				role: "alert"
			}, importError), notice === void 0 ? null : /* @__PURE__ */ react.createElement("span", {
				"data-skill-notice": true,
				role: "status"
			}, notice), orderedSkills.length === 0 ? /* @__PURE__ */ react.createElement("div", { "data-role-skill-empty": true }, /* @__PURE__ */ react.createElement("p", null, "还没有任何技能。"), /* @__PURE__ */ react.createElement("p", { "data-empty-next": true }, "点「＋ 添加技能」可从本地 md 导入、从宿主系统技能库选择，或手动新建。"), /* @__PURE__ */ react.createElement("p", null, "内置技能点「一键恢复默认角色」即可写回。")) : /* @__PURE__ */ react.createElement("div", { "data-skill-list": true }, orderedSkills.map((skill) => {
				const view = skillRowView(skill, false);
				const confirming = skillConfirm?.id === skill.id ? skillConfirm.op : void 0;
				return /* @__PURE__ */ react.createElement("div", {
					key: skill.id,
					"data-skill-row": true,
					"data-skill-source": skill.source,
					"data-skill-modified": view.modifiedLabel === null ? "false" : "true"
				}, /* @__PURE__ */ react.createElement("div", { "data-skill-row-main": true }, /* @__PURE__ */ react.createElement("span", {
					"data-skill-title": true,
					title: skill.title
				}, skill.title), /* @__PURE__ */ react.createElement("span", {
					"data-skill-badge": true,
					"data-source": skill.source,
					"data-tone": view.sourceTone
				}, skillSourceLabel(skill.source)), view.modifiedLabel === null ? null : /* @__PURE__ */ react.createElement("span", {
					"data-skill-modified": true,
					title: "正文与本机出厂正文不同"
				}, view.modifiedLabel)), /* @__PURE__ */ react.createElement("div", { "data-skill-row-sub": true }, /* @__PURE__ */ react.createElement("span", {
					"data-skill-description": true,
					title: skill.description
				}, skill.description), /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-skill-edit": true,
					disabled: busy,
					onClick: () => {
						setDialogError(void 0);
						setEditing({
							mode: "edit",
							skill
						});
					}
				}, "编辑"), view.actions.restore === null ? null : /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-skill-restore": true,
					disabled: busy,
					onClick: () => setSkillConfirm(confirming === "restore" ? void 0 : {
						op: "restore",
						id: skill.id
					})
				}, view.actions.restore), view.actions.delete === null ? null : /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-skill-delete": true,
					disabled: busy,
					onClick: () => setSkillConfirm(confirming === "delete" ? void 0 : {
						op: "delete",
						id: skill.id
					})
				}, view.actions.delete)), confirming === "delete" ? /* @__PURE__ */ react.createElement("div", {
					"data-skill-delete-confirm": true,
					role: "alert"
				}, "删除「", skill.title, "」后无法恢复，会同时从引用它的角色里摘除。", /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-skill-delete-ok": true,
					disabled: busy,
					onClick: () => removeSkill(skill)
				}, "确认删除"), /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-skill-delete-cancel": true,
					disabled: busy,
					onClick: () => setSkillConfirm(void 0)
				}, "取消")) : null, confirming === "restore" ? /* @__PURE__ */ react.createElement("div", {
					"data-skill-restore-confirm": true,
					role: "alert"
				}, "恢复为出厂正文？你对该技能的修改会丢失。", /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-skill-restore-ok": true,
					disabled: busy,
					onClick: () => restoreSkill(skill)
				}, "恢复出厂"), /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-skill-restore-cancel": true,
					disabled: busy,
					onClick: () => setSkillConfirm(void 0)
				}, "取消")) : null);
			}))), /* @__PURE__ */ react.createElement("div", { "data-roles-head": true }, /* @__PURE__ */ react.createElement("span", { "data-roles-count": true }, "角色 ", ordered.length, "（内置 ", builtinCount, "）"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-role-add": true,
				onClick: addRole,
				disabled: busy
			}, "新增角色")), ordered.length === 0 ? /* @__PURE__ */ react.createElement("div", { "data-empty": true }, /* @__PURE__ */ react.createElement("p", null, "还没有任何角色。"), /* @__PURE__ */ react.createElement("p", { "data-empty-next": true }, "点「新增角色」建一个，或点「恢复默认」写回内置角色。")) : null, /* @__PURE__ */ react.createElement("div", { "data-role-list": true }, ordered.map((role) => {
				const problem = errors[role.id] ?? "";
				const confirming = pendingDelete === role.id;
				const selected = role.skillIds.length;
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
				}, /* @__PURE__ */ react.createElement("span", { "data-role-field-label": true }, "技能 已选 ", selected, "/", library.length), /* @__PURE__ */ react.createElement("span", { "data-role-skill-list": true }, library.length === 0 ? /* @__PURE__ */ react.createElement("span", { "data-role-skill-empty": true }, "（技能库为空）") : null, orderedSkills.map((skill) => {
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
						"aria-label": skillRowView(skill, checked).checkboxLabel,
						onChange: () => toggleSkill(role.id, skill.id)
					}), /* @__PURE__ */ react.createElement("span", { "data-role-skill-title": true }, skill.title));
				}))), /* @__PURE__ */ react.createElement("div", {
					"data-role-field": true,
					"data-role-field-model": true
				}, /* @__PURE__ */ react.createElement("span", { "data-role-field-label": true }, "默认模型"), /* @__PURE__ */ react.createElement(ModelPicker, {
					value: role.model,
					catalog: props.modelCatalog,
					busy,
					onChange: (model) => patch(role.id, { model })
				})), problem !== "" ? /* @__PURE__ */ react.createElement("div", {
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
			})), /* @__PURE__ */ react.createElement("div", { "data-roles-foot": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-roles-restore": true,
				disabled: busy,
				onClick: () => setConfirmRestore(true)
			}, "一键恢复默认角色"), hint === void 0 ? null : /* @__PURE__ */ react.createElement("span", {
				"data-hint": true,
				role: "status"
			}, hint)), confirmRestore ? /* @__PURE__ */ react.createElement("div", {
				"data-roles-restore-backdrop": true,
				"data-dialog": "restore-defaults",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget && !busy) setConfirmRestore(false);
				}
			}, /* @__PURE__ */ react.createElement("div", {
				"data-roles-restore-confirm": true,
				role: "dialog",
				"aria-modal": "true",
				"aria-label": restoreView.title
			}, /* @__PURE__ */ react.createElement("strong", { "data-restore-title": true }, restoreView.title), restoreView.lines.map((line) => /* @__PURE__ */ react.createElement("p", {
				key: line,
				"data-restore-line": true
			}, line)), /* @__PURE__ */ react.createElement("div", { "data-restore-actions": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-roles-restore-cancel": true,
				disabled: busy,
				onClick: () => setConfirmRestore(false)
			}, "取消"), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-roles-restore-ok": true,
				"data-confirm-tone": "warn",
				disabled: busy,
				"aria-busy": busy ? "true" : "false",
				onClick: () => {
					setConfirmRestore(false);
					props.onRestoreDefaults();
				}
			}, busy ? "恢复中…" : restoreView.confirmLabel)))) : null, editing === void 0 ? null : editing.mode === "edit" ? /* @__PURE__ */ react.createElement(SkillEditDialog, {
				skill: editing.skill,
				readSkill: props.readSkill,
				busy,
				error: dialogError,
				onClose: () => setEditing(void 0),
				onSave: submitSkill,
				onRestoreBuiltin: editing.skill.source === "builtin" ? (id) => {
					setEditing(void 0);
					props.onSave(void 0, [{
						op: "restoreBuiltin",
						id
					}]);
					setNotice(`已把内置技能「${editing.skill.title}」恢复为出厂正文`);
				} : void 0
			}) : /* @__PURE__ */ react.createElement(SkillEditDialog, {
				source: editing.source,
				initialBody: editing.body,
				initialTitle: editing.title,
				initialDescription: editing.description,
				busy,
				error: dialogError,
				onClose: () => setEditing(void 0),
				onSave: submitSkill
			}), pickerOpen ? /* @__PURE__ */ react.createElement(SystemSkillPicker, {
				skills: props.systemSkills ?? [],
				reason: props.systemSkillsReason,
				busy,
				onClose: () => setPickerOpen(false),
				onImport: importSystemSkills
			}) : null);
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
			const sessionId = sessionIdOf(props);
			const state = usePanelState(sessionId);
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
			const concurrency = state.snapshot?.concurrency;
			const clampNote = concurrency && concurrency.clamped ? `受更小的上限约束，实际生效 ${String(concurrency.limit)}（设置 ${String(concurrency.requested)}）` : void 0;
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
					id: hintId,
					"data-setting-clamped": numberKey === "concurrencyLimit" && clampNote ? "true" : "false"
				}, errors[numberKey] ?? (numberKey === "concurrencyLimit" ? clampNote : void 0) ?? row.hint));
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
				modelCatalog: state.snapshot?.modelCatalog,
				systemSkills: state.snapshot?.systemSkills,
				systemSkillsReason: state.snapshot?.systemSkillsReason,
				readSkill: (id) => panelApi.readSkill(sessionId ?? "", id),
				onSave: (role, mutations) => void roleAction(mutations === void 0 ? {
					type: "saveRole",
					role
				} : {
					type: "saveRole",
					role,
					skills: mutations
				}, role === void 0 ? "已保存技能变更" : `已保存角色「${role.name}」`),
				onDelete: (id) => void roleAction({
					type: "deleteRole",
					roleId: id
				}, `已删除角色 ${id}`),
				onRestoreDefaults: () => void roleAction({ type: "restoreDefaultRoles" }, "已把内置角色与内置技能恢复为出厂定义")
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
		* r10 的四个挂载面（DESIGN §1.1，逐个逐字取自 UI-SLOTS.md）：
		*   conversation.input.left              —— 输入框左侧「自动团队」胶囊（r10 从下方 dock 迁来）
		*   conversation.session.header.actions  —— 会话头「自动团队」按钮（点开右栏面板）
		*   sidebar.right.pane.tab / .title      —— 右栏面板 body + 标题（keyed，同 key）
		*   settings.section                     —— 设置页「自动团队」（6 参数 + 角色与技能管理）
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
			registerPanellist(ctx, {
				PanellistEntry,
				LibraryPage
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
