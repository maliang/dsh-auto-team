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
		/** 宿主 `runInject` 对 root 座位不传参，对 session 座位传 `binding.key`；统一成字符串会话 id。 */
		function sessionIdArg(binding) {
			return typeof binding === "string" && binding !== "" ? binding : "current";
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
			const injectOf = (binding) => sessionIdBag(sessionIdArg(binding));
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
					inject: (binding) => {
						const sessionId = sessionIdArg(binding);
						return sessionIdBag(sessionId, {
							openPanel,
							closePanel: () => closePanel(sessionId),
							isPanelOpen: () => isPanelOpen(sessionId)
						});
					}
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
		* 正常路径是 `layout.selectPanel(PANELLIST_ID)`；主区不可用时退化成这个事件，
		* 由 `Panel.tsx` 监听后在右栏内联渲染同一份项目库（同一套组件、同一份 `LibraryView`）。
		* 常量放这里而不是组件文件：`slots.ts` 不 import 任何 `.tsx`，
		* 组件与测试都能引它，且不会形成 `slots ↔ LibraryPage` 的运行时环。
		*/
		const OPEN_LIBRARY_EVENT = "auto-team:open-library";
		/**
		* 项目库的两个可见 surface：主区整页 `main` / 右栏内联 `panel`。
		*
		* `data-library-surface` 是**唯一**判据 —— 组件把根节点标上它，watchdog 与 Panel 只读它，
		* 不各自 querySelector 别的选择器（两处各猜一套选择器 = 主区/面板双开的温床）。
		*/
		const LIBRARY_SURFACE_ATTR = "data-library-surface";
		/**
		* 当前可见的项目库 surface；`null` = 一个都没有（或不在浏览器里）。
		*
		* **main 优先**：同一时刻只允许一个可见 surface，主区一旦可见就不再往右栏塞镜像。
		* `getClientRects().length > 0` 用来排除「节点在 DOM 里但被宿主收起/隐藏」的假可见。
		*/
		function visibleLibrarySurface() {
			if (typeof document === "undefined" || document === null) return null;
			if (typeof document.querySelector !== "function") return null;
			const visible = (surface) => {
				try {
					const node = document.querySelector(`[${LIBRARY_SURFACE_ATTR}="${surface}"]`);
					if (node === null || node === void 0) return false;
					if (typeof node.getClientRects !== "function") return true;
					return node.getClientRects().length > 0;
				} catch {
					return false;
				}
			};
			if (visible("main")) return "main";
			if (visible("panel")) return "panel";
			return null;
		}
		/** 最近一次「请求打开项目库」的时间戳；Panel 挂载时消费它，避免刷新/重挂后丢内联。 */
		let libraryOpenRequestAt = null;
		/** 标记一次打开请求（glyph 点击 / 主区打开前调用）。 */
		function markLibraryOpenRequest(now = Date.now()) {
			libraryOpenRequestAt = now;
		}
		/**
		* 消费一次打开请求：只有 1.5s 内的请求算数（过期请求不能把用户拖进一个他早就放弃的内联库）。
		* 消费即清空 —— 同一次点击最多触发一次降级。
		*/
		function consumeLibraryOpenRequest(now = Date.now()) {
			const at = libraryOpenRequestAt;
			libraryOpenRequestAt = null;
			if (at === null) return false;
			return now - at <= 1500 && now - at >= 0;
		}
		/**
		* 组件侧「打开项目库主区」的 opener：由 `registerPanellist` 在注册时挂上。
		*
		* 组件（角色卡 / 任务行 / 流程图节点）拿不到 ctx，但点击后必须能像左栏 glyph 一样
		* 打开主区并走 500ms watchdog 降级；`navigateToMember` 因此只依赖这个薄入口。
		*/
		let librarySurfaceOpener = null;
		/** 组件侧打开项目库主区；`null` = 还没注册过 opener（单测 / 非浏览器宿主）。 */
		function requestLibrarySurface(sessionId) {
			if (librarySurfaceOpener === null) return null;
			try {
				return librarySurfaceOpener(sessionId);
			} catch {
				return "error";
			}
		}
		/** 派发降级事件；没有 window（node 测试 / 非浏览器宿主）时安全返回 false。 */
		function dispatchOpenLibraryEvent() {
			if (typeof window === "undefined" || window === null) return false;
			if (typeof window.dispatchEvent !== "function" || typeof CustomEvent !== "function") return false;
			window.dispatchEvent(new CustomEvent(OPEN_LIBRARY_EVENT, { detail: { id: PANELLIST_ID } }));
			return true;
		}
		function warnSlot(name, error) {
			const message = error instanceof Error ? error.message : String(error);
			if (typeof console !== "undefined" && typeof console.warn === "function") console.warn(`[dsh-auto-team] 槽位「${name}」注册失败，已降级：${message}`);
		}
		/**
		* 生成「打开左栏项目库」动作（AC-8 / AC-9 的唯一入口）。
		*
		* additive 语义：先试 `layout.selectPanel(PANELLIST_ID)`；布局服务缺失 / 显式拒绝 / 500ms 内
		* 没有出现可见的 `[data-library-surface="main"]` 时，降级到右栏内联（打开面板页签 + 派发
		* `OPEN_LIBRARY_EVENT`）。返回 `'main' | 'event' | 'error'` —— 调用方（glyph）据此显示
		* `data-last-open-result`，**任何分支都不静默**。
		*/
		function createOpenLibrary(ctx) {
			let layout;
			if (typeof ctx.inject === "function") try {
				ctx.inject(["layout"], (scope) => {
					const service = scope.layout;
					if (service !== void 0) layout = service;
				});
			} catch {
				layout = void 0;
			}
			const panel = createPanelCommands(ctx);
			/** 降级到右栏：打开面板页签 + 派发事件；两步缺一都会被用户当成「点了没反应」。 */
			function fallback(sessionId, deferred = false) {
				markLibraryOpenRequest();
				let opened = false;
				try {
					const id = sessionId === void 0 || sessionId === "" ? "current" : sessionId;
					opened = panel.open(id);
				} catch {
					opened = false;
				}
				if (deferred) setTimeout(() => {
					dispatchOpenLibraryEvent();
				}, 0);
				else dispatchOpenLibraryEvent();
				return opened ? "event" : "error";
			}
			return (sessionId) => {
				if (layout !== void 0 && typeof layout.selectPanel === "function") {
					let accepted = true;
					try {
						accepted = layout.selectPanel(PANELLIST_ID) !== false;
					} catch {
						accepted = false;
					}
					if (accepted) {
						markLibraryOpenRequest();
						setTimeout(() => {
							if (visibleLibrarySurface() === "main") return;
							fallback(sessionId, true);
						}, 500);
						return "main";
					}
				}
				return fallback(sessionId);
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
			librarySurfaceOpener = openLibrary;
			const injectOf = (binding) => {
				const sessionId = typeof binding === "string" && binding !== "" && binding !== PANELLIST_ID ? binding : "current";
				return sessionIdBag(sessionId, { openLibrary: () => openLibrary(sessionId) });
			};
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
			let mainFailed = false;
			try {
				ctx.slots.inject(MAIN_SLOT, () => {
					try {
						ctx.slots.register({
							name: MAIN_SLOT,
							key: PANELLIST_ID,
							inject: injectOf
						}, deps.LibraryPage);
					} catch (error) {
						try {
							ctx.slots.register({
								name: MAIN_SLOT,
								inject: injectOf
							}, deps.LibraryPage);
						} catch (inner) {
							mainFailed = true;
							warnSlot(MAIN_SLOT, inner);
						}
					}
				});
				result.main = !mainFailed;
			} catch (error) {
				warnSlot(MAIN_SLOT, error);
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
[data-auto-team-memory] [data-memory-degraded] {
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-state-warning-primary, #b8860b);
  border-radius: 6px;
  color: var(--dsw-alias-state-warning-primary, #b8860b);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
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
/* r17：六项用量指标（2 列 × 3 行，标签与数字同宽容器；不可得项用三级色区分） */
[data-task-detail] [data-usage-metrics] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
[data-task-detail] [data-usage-metric] {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-task-detail] [data-usage-metric-label] {
  flex: none;
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-task-detail] [data-usage-metric-value] {
  overflow: hidden;
  color: var(--dsw-alias-label-primary, inherit);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-task-detail] [data-usage-metric][data-available="false"] [data-usage-metric-value] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font-weight: 400;
}
[data-task-detail] [data-gate-artifacts],
[data-task-detail] [data-gate-at] {
  display: block;
  margin-top: 4px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}

/* ── 流转图：148×56 节点、188/72 步进、画布 600px 双层滚动 ───────────────── */
[data-region="task-flow"] {
  padding: 8px 12px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-region="task-flow"] [data-flow-canvas] {
  box-sizing: border-box;
  /* r14 D4：viewport 与「重置视图」都是 position:absolute，画布本身必须成为它们的定位上下文，
     否则会锚到宿主 pane 上、浮出画布框并遮挡面板标题与页签（真机截图一眼可见的 P1）。 */
  position: relative;
  height: 600px;
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
/* r16 角色列头（180×32）：编号徽标 + 角色名 + ×N；平面表头，不是卡片也不是按钮 */
[data-region="task-flow"] [data-flow-stage] {
  position: absolute;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  width: 180px;
  height: 32px;
  padding: 0 8px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: inherit;
  cursor: inherit;
  user-select: none;
}
[data-region="task-flow"] [data-flow-stage-badge] {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
[data-region="task-flow"] [data-flow-stage-name] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  font-weight: 600;
}
[data-region="task-flow"] [data-flow-stage-count] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-variant-numeric: tabular-nums;
}
/* 列间箭头：颜色/虚实由组件按「左列是否全 done」写在 SVG 属性上，CSS 只管不吃指针 */
[data-region="task-flow"] [data-flow-stage-link] {
  pointer-events: none;
}
/* r16 节点：180×64 两行（tN + 标题 + 状态胶囊 / token · 用时）；角色名只在列头 */
[data-region="task-flow"] [data-flow-node] {
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 4px;
  box-sizing: border-box;
  width: 180px;
  height: 64px;
  margin: 0;
  padding: 8px 10px;
  overflow: hidden;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: inherit;
  text-align: left;
  cursor: pointer;
  user-select: none;
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
/* r16 节点首行：tN 徽标 + 标题 + 状态胶囊（角色名只在列头，节点内不再渲染角色名） */
[data-region="task-flow"] [data-flow-node-id] {
  flex: 0 0 auto;
  box-sizing: border-box;
  min-width: 24px;
  height: 18px;
  padding: 0 4px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  text-align: center;
  white-space: nowrap;
  font: 600 11px/18px var(--ds-font-family-code, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
}
[data-region="task-flow"] [data-flow-node-title] {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
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
/* 状态胶囊：18 高、999、11/500；5 个 tone 统一 10% 底 + 40% 边（文字永远在，颜色只是冗余通道） */
[data-region="task-flow"] [data-flow-status] {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 18px;
  max-width: 48px;
  padding: 0 5px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-weight: 500;
}
[data-region="task-flow"] [data-flow-status][data-tone="business"] {
  color: var(--dsw-alias-state-business-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 10%, transparent);
}
[data-region="task-flow"] [data-flow-status][data-tone="success"] {
  color: var(--dsw-alias-state-success-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, currentColor) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, currentColor) 10%, transparent);
}
[data-region="task-flow"] [data-flow-status][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 10%, transparent);
}
[data-region="task-flow"] [data-flow-status][data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 10%, transparent);
}
[data-region="task-flow"] [data-flow-status][data-tone="neutral"] {
  color: var(--dsw-alias-label-secondary, inherit);
  border-color: var(--dsw-alias-border-l1, currentColor);
  background: var(--dsw-alias-bg-layer-2, transparent);
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
  flex: 0 0 auto;
  white-space: nowrap;
  text-align: left;
}
[data-region="task-flow"] [data-flow-sep] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, inherit);
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
/* r17 ④：main 槽位整页必须撑满宿主主内容区。
 * 宿主给主区的是确定高度，这里不显式 100% 时项目库只有内容高度：详情列不滚动、
 * 绝对定位在 shell 里的抽屉也只能拿到「内容高度」，于是出现「主界面没 100%、抽屉高度不对」。
 * width/box-sizing/min-* 一并写死，避免宿主主区的 padding 或窄宽把内容撑出横向滚动。
 * 注意只认 data-library-surface="main"：右栏内联（panel）与侧栏图标（panellist）不在此列。 */
[data-auto-team-library][data-library-surface="main"] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-head] {
  display: flex;
  flex: 0 0 44px;
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
  flex: 1 1 auto;
  align-items: stretch;
  min-height: 0;
  overflow: hidden;
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
  /* 容器查询折叠成上下两段后，详情列必须能在剩余高度里内滚，不把整页撑高。 */
  min-height: 0;
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

/* ── r23 记忆策展：配额提示 / 文件级等级分布 / 条目视图 / 整理旧流水 ───────── */
[data-region="memory-tab"] [data-memory-stat] {
  flex-wrap: wrap;
  row-gap: 2px;
}
[data-region="memory-tab"] [data-memory-quota][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, inherit);
}
[data-region="memory-tab"] [data-memory-quota][data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary, inherit);
}
[data-region="memory-tab"] [data-memory-warnings] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 6px 12px;
  list-style: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-region="memory-tab"] [data-memory-warning] {
  color: var(--dsw-alias-label-secondary, inherit);
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="memory-tab"] [data-memory-warning][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, inherit);
}
[data-region="memory-tab"] [data-memory-warning][data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary, inherit);
}
[data-region="memory-tab"] [data-memory-warning][data-tone="info"] {
  color: var(--dsw-alias-label-tertiary, inherit);
}

/* 整理旧流水：先预演、再确认写入；失败态留重试入口 */
[data-region="memory-tab"] [data-memory-curation] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-region="memory-tab"] [data-memory-curation-bar] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 8px;
}
[data-region="memory-tab"] [data-memory-legacy] {
  flex: 1 1 180px;
  min-width: 0;
  color: var(--dsw-alias-label-tertiary, inherit);
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="memory-tab"] [data-memory-curate] {
  flex: 0 0 auto;
  min-height: 26px;
  padding: 0 10px;
  white-space: nowrap;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-region="memory-tab"] [data-memory-curate][data-busy="true"] {
  cursor: progress;
}
[data-region="memory-tab"] [data-memory-curation-report] {
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-2, transparent);
}
[data-region="memory-tab"] [data-memory-curation-report][data-phase="preview"] {
  border-color: var(--dsw-alias-state-business-primary, currentColor);
}
[data-region="memory-tab"] [data-memory-curation-headline] {
  margin: 0 0 4px;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-region="memory-tab"] [data-memory-curation-counts] {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="memory-tab"] [data-memory-curation-count] {
  max-width: 100%;
  overflow-wrap: anywhere;
}
[data-region="memory-tab"] [data-memory-curation-warnings] {
  margin: 4px 0 0;
  padding-left: 16px;
  color: var(--dsw-alias-state-warn-primary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="memory-tab"] [data-memory-curation-actions] {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
[data-region="memory-tab"] [data-memory-curation-actions] button {
  min-height: 26px;
  padding: 0 10px;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-region="memory-tab"] [data-memory-curation-error] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
[data-region="memory-tab"] [data-memory-curation-error] [data-error] {
  flex: 1 1 180px;
  margin: 0;
}
[data-region="memory-tab"] [data-memory-curation-error] button {
  min-height: 24px;
  padding: 0 8px;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}

/* 文件行：主题标题 + 条目数；第二行等级分布；第三行文件名/只读标记 */
[data-memory-list][data-memory-mode="files"] [data-auto-team-memory-item] {
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 8px;
  align-items: start;
  min-height: 52px;
  padding: 8px 12px;
}
[data-memory-list][data-memory-mode="files"] [data-memory-title] {
  grid-column: 1;
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  font-weight: 600;
}
[data-memory-list][data-memory-mode="files"] [data-memory-file-count] {
  grid-column: 2;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-variant-numeric: tabular-nums;
}
[data-memory-list][data-memory-mode="files"] [data-memory-distribution],
[data-memory-list][data-memory-mode="files"] [data-memory-file-meta] {
  grid-column: 1 / -1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-memory-list][data-memory-mode="files"] [data-memory-distribution] {
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-memory-list][data-memory-mode="files"] [data-memory-file-meta] {
  color: var(--dsw-alias-label-tertiary, inherit);
}

/* 展开后的条目视图：宿主已格式化来源/时间/修正次数，这里只排版 */
[data-memory-detail] {
  padding-bottom: 8px;
}
[data-memory-entries] {
  max-height: 360px;
  margin: 0 12px 8px;
  padding: 0;
  overflow: auto;
  list-style: none;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-1, transparent);
}
[data-memory-entry] {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 2px 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
}
[data-memory-entry]:last-child {
  border-bottom: 0;
}
[data-memory-entry][data-level="P0"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 8%, transparent);
}
[data-memory-entry-head] {
  grid-column: 1;
  grid-row: 1 / span 2;
  align-self: start;
  display: flex;
  align-items: center;
  gap: 4px;
}
[data-memory-entry-level] {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 5px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-weight: 600;
}
[data-memory-entry-level][data-tone="strong"] {
  border-color: var(--dsw-alias-label-primary, currentColor);
  background: var(--dsw-alias-label-primary, currentColor);
  color: var(--dsw-alias-bg-layer-1, inherit);
}
[data-memory-entry-level][data-tone="muted"] {
  border-color: var(--dsw-alias-border-l1, currentColor);
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-memory-entry-flag] {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 5px;
  box-sizing: border-box;
  border: 1px dashed var(--dsw-alias-border-l3, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-memory-entry-text] {
  grid-column: 2;
  grid-row: 1;
  color: var(--dsw-alias-label-primary, inherit);
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-memory-entry-source] {
  grid-column: 2;
  grid-row: 2;
  color: var(--dsw-alias-label-tertiary, inherit);
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-memory-entry][data-superseded="true"] [data-memory-entry-text] {
  color: var(--dsw-alias-label-tertiary, inherit);
  text-decoration: line-through;
}
[data-memory-superseded] {
  margin: 0 12px 8px;
}
[data-memory-superseded] > summary {
  cursor: pointer;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-memory-superseded] > summary:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: 1px;
}
[data-memory-superseded] [data-memory-entries] {
  margin: 4px 0 0;
}
[data-memory-empty-detail] {
  margin: 0 12px 8px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-region="memory-tab"] [data-memory-retry] {
  min-height: 24px;
  margin: 0 12px 8px;
  padding: 0 10px;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
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

/* ── ① 任务总览：80px 环列 + 8px gap + 208px 列表列（DESIGN §2.1：80+8+208=296） ───────── */
[data-task-overview] {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 8px;
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
  width: 80px;
  height: 80px;
}
[data-task-overview] [data-overview-list] {
  min-width: 0;
}
/* 184px 列表内容放不下 r13 的「1fr 76px 84px」表头（DESIGN §2.1 的取舍）：分组模式没有表头，
   两行式行的 meta 行改成 flex 单行，角色名先 ellipsis、token/用时保持不省略。 */
[data-task-overview] [data-task-line="meta"] {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 16px;
  margin-top: 2px;
  overflow: hidden;
  white-space: nowrap;
}
[data-task-overview] [data-task-role] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
}
[data-task-overview] [data-task-line="meta"] [data-cell="token"],
[data-task-overview] [data-task-line="meta"] [data-cell="duration"] {
  flex: 0 0 auto;
  text-align: left;
}

/* 进度环（r16）：80×80、r=34、stroke=8、C=213.628；rotate(-90) 由组件属性给出，这里只管视觉 */
[data-progress-ring] {
  display: block;
  width: 80px;
  height: 80px;
  overflow: visible;
}
[data-progress-ring] [data-ring-track] {
  fill: none;
  stroke: var(--dsw-alias-border-l2, currentColor);
  stroke-width: 8;
}
[data-progress-ring] [data-ring-arc] {
  fill: none;
  stroke: var(--dsw-alias-state-business-primary, currentColor);
  stroke-width: 8;
  transition: stroke-dashoffset 240ms ease;
}
[data-progress-ring] [data-ring-arc][data-complete="true"] {
  stroke: var(--dsw-alias-state-success-primary, currentColor);
}
/* 圆内文字两档：≤5 字（99/99、3/9）16px、≥6 字（999/999）13px，tabular 保证数字等宽不抖 */
[data-progress-ring] [data-progress-text] {
  fill: var(--dsw-alias-label-primary, currentColor);
  font: var(--dsw-font-xs-13, 13px/16px sans-serif);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
[data-progress-ring] [data-progress-text][data-text-tier="short"] {
  font: var(--dsw-font-h3-16, 16px/20px sans-serif);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
[data-progress-ring] [data-progress-text][data-text-tier="long"] {
  font: var(--dsw-font-xs-13, 13px/16px sans-serif);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
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
  /* r18b：「未完成 · N」/「已完成 · N」的计数是同一位置的两个数字，等宽才不会跳动 */
  font-variant-numeric: tabular-nums;
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
/* r16 refs 行：该角色的任务编号 chip（tN + 状态彩点）；无 taskRefs 的旧快照整行不渲染 */
[data-role-grid] [data-role-line="refs"] {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  min-height: 18px;
}
[data-role-grid] [data-role-task-refs] {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  min-height: 18px;
}
[data-role-grid] [data-role-task-ref] {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  box-sizing: border-box;
  max-width: 100%;
  height: 18px;
  padding: 0 4px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
/* 彩点用 background:currentColor：color 由 tone 决定，computed color 与 dot 颜色天然一致 */
[data-role-grid] [data-task-ref-dot] {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-right: 4px;
  border-radius: 50%;
  background: currentColor;
  color: var(--dsw-alias-label-tertiary, currentColor);
}
[data-role-grid] [data-task-ref-dot][data-tone="business"] {
  color: var(--dsw-alias-state-business-primary, currentColor);
}
[data-role-grid] [data-task-ref-dot][data-tone="success"] {
  color: var(--dsw-alias-state-success-primary, currentColor);
}
[data-role-grid] [data-task-ref-dot][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, currentColor);
}
[data-role-grid] [data-task-ref-dot][data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
}
[data-role-grid] [data-task-ref-dot][data-tone="neutral"] {
  color: var(--dsw-alias-label-tertiary, currentColor);
}
[data-role-grid] [data-task-ref-id] {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 600 11px/16px var(--ds-font-family-code, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
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

/* ── ④ r16：左栏 glyph 反馈 + 右栏内联项目库（AC-8/9 的唯一可见 surface） ───── */
/* 左栏 glyph：只在宿主按钮内部做 press/失败反馈，不改宿主行结构、不抢 selectPanel */
[data-auto-team-panellist][data-panellist-glyph] {
  display: block;
  color: inherit;
  opacity: 0.9;
  transition: opacity 120ms var(--ds-ease-in-out, ease), transform 80ms var(--ds-ease-in-out, ease),
    color 200ms var(--ds-ease-in-out, ease);
}
[data-auto-team-panellist][data-panellist-glyph]:hover {
  opacity: 1;
}
[data-auto-team-panellist][data-panellist-glyph]:active {
  transform: scale(0.92);
}
[data-auto-team-panellist][data-panellist-glyph][data-open-error="true"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
}
[data-auto-team-panel] [data-panel-library-inline] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  animation: auto-team-detail-in 120ms ease-out;
}
[data-auto-team-panel] [data-panel-library-bar] {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  height: 32px;
  padding: 0 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  background: var(--dsw-alias-bg-layer-2, transparent);
}
[data-auto-team-panel] [data-library-inline-back] {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 28px;
  margin: 0;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  cursor: pointer;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  transition: background-color 120ms var(--ds-ease-in-out, ease),
    border-color 120ms var(--ds-ease-in-out, ease), color 120ms var(--ds-ease-in-out, ease);
}
[data-auto-team-panel] [data-library-inline-back]:hover {
  background: var(--dsw-alias-bg-layer-3, transparent);
  color: var(--dsw-alias-label-primary, inherit);
}
[data-auto-team-panel] [data-library-inline-back]:active {
  background: var(--dsw-alias-bg-layer-1, transparent);
}
[data-auto-team-panel] [data-library-inline-back]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: 1px;
}
[data-auto-team-panel] [data-panel-library-hint] {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-weight: 500;
}
[data-auto-team-panel] [data-panel-library-warn] {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary, currentColor);
}
/* DESIGN §9 的另一路命名：只在「空元素」时当圆点（TECH §6.3 定稿用 data-panel-library-warn，
   若后续把它当文案容器用，这条不会误伤排版） */
[data-auto-team-panel] [data-library-notice]:empty {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-warn-primary, currentColor);
}
[data-auto-team-panel] [data-panel-library-inline] [data-auto-team-library] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* ── ③ 项目库：分栏（CSS 变量）、run 行、历史桶、右侧抽屉（T5 复用这些钩子） ── */
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-shell] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 0;
  /* 抽屉（absolute inset）以 shell 为包含块：shell 必须是整块主区高度，
   * 否则抽屉的 top/bottom 只能量到内容高度。overflow 留给子级各自内滚。 */
  overflow: hidden;
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
  /* r17 ④：抽屉铺满 shell 的整条高度；max-height 兜住「宿主没给确定高度」的降级路径，
   * 内部再由 drawer-body 内滚，绝不让内容把抽屉顶出可视区。 */
  width: min(520px, 100%);
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-md, 12px) 0 0 var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  box-shadow: var(--dsw-shadow-lv3, 0 12px 32px rgba(0, 0, 0, 0.18));
  animation: auto-team-drawer-in 160ms cubic-bezier(0.2, 0, 0, 1);
}
[data-run-drawer] [data-drawer-head] {
  display: flex;
  flex: 0 0 44px;
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

/* ══════════════════════════════════════════════════════════════════════════════
 * r17 / r18b：run 行 / 子智能体主界面 / 历史六项 / 可点角色卡
 *
 * 四项都是 r17 新交互的「可见身份」，样式只长在本文件（owner）里：
 *  ① run 卡：r18b t8 起是「横向滑动卡，六项在卡内 3 列 × 2 行」，一 run 一卡、整卡一个 button；
 *     r18b t10 把六项每格改回 label 上 / value 下（同行版在真机被省略号截断）；
 *     当前 run（左侧竖条）与正在查看的 run（淡底 + 内描边）是两个独立状态位；
 *  ② 子智能体主界面：外壳接住剩余高度，页面自己滚；列表固定最大高度内滚；
 *  ③ 历史六项：3 列 × 2 行；标签 11/三级色，数字 12/600 tabular，不可得项虚线；
 *  ④ 可点角色卡：常驻 business 描边 + 右下 chevron —— 只靠 hover 变化等于没暗示。
 * 纪律：字号只用 font 简写；颜色只用宿主 token；选择器都对应组件真实 DOM 钩子。
 * ══════════════════════════════════════════════════════════════════════════════ */

/* ── ① 任务页顶部 run 卡（r18b t10：零截断，六项回到格内上下两行） ──────────
 * 一 run 一卡、卡宽固定 216px；卡多时容器横向滚动并吸附到卡左缘。
 * button 只能装 phrasing content，所以卡内只用 span/b；单列 grid 放三行：
 *   ① header span：标题（flex:1 单行省略）+ 状态徽标（右对齐、nowrap）
 *   ② meta 单行省略（title 保留全文）
 *   ③ 六项 3 列 × 2 行，每格「label 上 / value 下」两行（t9 的同行版在真机被
 *      ellipsis 截成「输入未命中 246.…」「缓存命中率 7」，故 t10 回退为竖排）
 * 两个状态位保持正交：
 *   当前 run = 左侧 3px 业务色竖条；正在查看 = 10% 淡底 + 1px 内描边（可同现）。
 *
 * 高度账（min-height 96px，不写死 height，内容多时自然长高）：
 *   边框 1+1 + 上下内边距 6+6 = 14；L1 18（标题 13px/18px，徽标 18 胶囊同高）；
 *   L2 13（11px/13px）；L3 = 上边框 1 + padding-top 2 + 两行(12+13) + 格子行距 2 = 55；
 *   三块之间的 gap 3×2 = 6 → 14+18+13+55+6 = 106（落在 96–108 的紧凑区间）。
 *
 * 「零截断」是怎么保证的（t9 的真机证据见 t10-card-fit.md）：
 *   每格标签最长 5 个汉字（「输入未命中」= 5×11px = 55px），值最长约 7 字符
 *   （「246.91K」≈ 42px），两行各自 nowrap 且**不写 ellipsis / overflow: hidden**；
 *   列宽 63.3px > 55px，所以标签与值都按原样完整显示。
 *
 * 320px 面板算术：卡 216 + 卡间距 8 = 224，容器 320 内第二张露出约 88px（>1/3 卡宽），
 * 一眼能看出「右边还有卡」；卡内 216 - 左竖条 3 - 右边框 1 - 内边距 16 = 196，
 * 六项 3 列、列间距 3×2 → 每列 (196-6)/3 ≈ 63.3px ≥ 55px（最长标签）。
 * 列距收到 3px：宿主没有 10px 字号 token（标签用 11px），这 3px 是列宽的余量。
 *
 * 容器用 padding: 4px 而不用负 margin 补偿：焦点环是 outline-offset: -2px（画在卡内），
 * 不会被滚动容器裁掉；负 margin 会让容器比 [data-panel-body]（overflow:auto）宽 8px，
 * 反而在 320px 面板里多出一条横向滚动条。 */
[data-region="run-switcher"] {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  background: var(--dsw-alias-bg-layer-1, transparent);
}
/* 横滑容器：卡不换行（flex 默认 nowrap），超出就横向滚动；snap 吸附到卡左缘。 */
[data-region="run-switcher"] [data-active-run-cards] {
  display: flex;
  gap: 8px;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  margin: 0;
  padding: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-border-l1, currentColor) transparent;
}
/* 一张卡 = 单列三行：①header(标题|徽标)  ②meta  ③六项（3 列 × 2 行）。
 * 固定 216px 三连写（width/min/max）—— flex 项默认会被压缩，只写 width 在卡多时会被挤扁。
 * 左内边距与右边一致：3px 竖条用常驻透明边框占位，切换卡时标题不位移。
 * 只给 min-height（96px）：内容（长 meta / 六项换行）多时可自然长高，不裁字。 */
[data-region="run-switcher"] [data-active-run] {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: 3px;
  box-sizing: border-box;
  width: 216px;
  min-width: 216px;
  max-width: 216px;
  min-height: 96px;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-left: 3px solid transparent;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  text-align: left;
  cursor: pointer;
  scroll-snap-align: start;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  transition: background-color 120ms ease, border-color 120ms ease;
}
/* hover/active 只描在「未选中」的卡上：选中卡已有淡底，再叠一层会让两种状态糊在一起。
 * 竖条颜色不参与 hover，所以当前 run 的身份不会被悬停抹掉。 */
[data-region="run-switcher"] [data-active-run]:hover:not(:disabled):not([data-selected="true"]) {
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
[data-region="run-switcher"] [data-active-run]:active:not(:disabled):not([data-selected="true"]) {
  background: var(--dsw-alias-interactive-bg-active, transparent);
}
/* outline 内缩 2px：滚动容器会裁掉外扩描边，且卡在 320px 面板里左右没有余量 */
[data-region="run-switcher"] [data-active-run]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: -2px;
}
/* disabled（历史详情读取中）：压暗但仍保留可读对比（0.6 而非 0.5），并明确 not-allowed */
[data-region="run-switcher"] [data-active-run]:disabled {
  color: var(--dsw-alias-label-secondary, inherit);
  cursor: not-allowed;
  opacity: 0.6;
}
/* data-fallback="true"（没有进行中的 run，这一条是「最后一个 run」兜底）刻意不加任何
 * 警示色/描边：它不是异常，只是列表里恰好只有一张卡；状态仍由卡内徽标与 meta 说明。 */
/* 当前 run：左侧业务色竖条（常驻宽度，切卡时文字不位移） */
[data-region="run-switcher"] [data-active-run][data-current="true"] {
  border-left-color: var(--dsw-alias-state-business-primary, currentColor);
}
/* 正在查看的 run：10% 淡底 + 1px 内描边 —— 与「当前」是两个维度，看历史/其它 run 时
 * 当前卡仍只有竖条、查看卡才有底色，两者可以同时出现，也可以各自单独出现。 */
[data-region="run-switcher"] [data-active-run][data-selected="true"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 32%, transparent);
}
/* L1 header：标题与状态徽标同一行。标题 flex:1 吃掉剩余宽度，徽标不参与压缩
 * （nowrap + flex:0 0 auto），所以「标题先省略、徽标始终完整」。 */
[data-region="run-switcher"] [data-active-run-head] {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}
[data-region="run-switcher"] [data-active-run-title] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  /* token 自带 20px 行高；t10 把标题行收到 18px（与 18px 徽标同高），
     这样卡高才能压进 96–108 而不用省略任何辅助信息。 */
  line-height: 18px;
  font-weight: 600;
}
/* 状态徽标：与任务行 [data-badge] 同一套几何（18px 胶囊），颜色只由 tone 映射；
 * max-width 96px —— 卡只有 216 宽，徽标再宽标题就只剩两三个字。 */
[data-region="run-switcher"] [data-active-run-status] {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  box-sizing: border-box;
  max-width: 96px;
  height: 18px;
  padding: 0 6px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="run-switcher"] [data-active-run-status][data-tone="success"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, currentColor) 45%, transparent);
  color: var(--dsw-alias-state-success-primary, currentColor);
}
[data-region="run-switcher"] [data-active-run-status][data-tone="warn"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 45%, transparent);
  color: var(--dsw-alias-state-warn-primary, currentColor);
}
[data-region="run-switcher"] [data-active-run-status][data-tone="danger"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 45%, transparent);
  color: var(--dsw-alias-state-error-primary, currentColor);
}
[data-region="run-switcher"] [data-active-run-status][data-tone="business"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 45%, transparent);
  color: var(--dsw-alias-state-business-primary, currentColor);
}
/* meta（开始时间 · 任务数）：单行省略，数字等宽（卡宽固定，宁可省略也不换行；
 * 组件把全文放进 title，悬停可看全）。 */
[data-region="run-switcher"] [data-active-run-meta] {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  /* 与六项同档行高（13px），省下的 3px 用于格内第二行 */
  line-height: 13px;
  font-variant-numeric: tabular-nums;
}
/* 六项：3 列 × 2 行（用户口径「六项在卡内两行」），虚线分隔（与历史行同一套视觉语言）。
 * t10：每格回到「label 上 / value 下」两行——同行版在 63px 列宽里必然触发 ellipsis，
 * 用户明确要求「其他辅助信息要显示全」，所以宁可让每格占两个行盒（12+13），
 * 靠行高、padding-top 与块间距（而不是裁字）把整卡控制在 96–108px。 */
[data-region="run-switcher"] [data-active-run-usage] {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px 3px;
  padding-top: 2px;
  border-top: 1px dashed var(--dsw-alias-border-l1, currentColor);
}
[data-region="run-switcher"] [data-active-run-metric] {
  display: flex;
  /* 竖排：label 在上、value 在下（t9 的 row 版在真机被截断，见 t10-card-fit.md） */
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
/* 标签：2–5 个汉字，单行但不省略——最长的「输入未命中」55px < 列宽 63.3px。
 * 刻意不写 overflow: hidden / text-overflow: ellipsis：那正是 t9 真机截断的元凶。 */
[data-region="run-switcher"] [data-active-run-metric-label] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/12px sans-serif);
  line-height: 12px;
}
/* 值：11px/600 tabular，同样整段显示（「246.91K」约 42px < 63.3px）。
 * 全文仍由格子 title 兜底（复制/读屏用），但视觉上不再出现省略号。 */
[data-region="run-switcher"] [data-active-run-metric-value] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-primary, inherit);
  white-space: nowrap;
  /* 注意：font 简写会重置 line-height，所以 13px 行高必须写在 font 之后。 */
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  line-height: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
/* 不可得 ≠ 0：三级色 + 虚线下划线（数字本身一字不改，与历史六项同一套区分） */
[data-region="run-switcher"] [data-active-run-metric][data-available="false"] [data-active-run-metric-value] {
  border-bottom: 1px dashed var(--dsw-alias-border-l2, currentColor);
  color: var(--dsw-alias-label-tertiary, inherit);
  font-weight: 400;
  cursor: help;
}

/* ── r24：残留计划（未收口）徽标 + 「终止计划」入口（历史行 / 顶部 run 卡共用） ──
 * 只在 RunCloseAction 上挂 data-run-close；徽标与按钮成对出现，不占位。
 * 320px 是最坏基准：容器可换行、错误原因可断词，任何一段长文本都不横向撑破面板。 */
[data-run-close] {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
/* 徽标：与历史行状态徽标同一套胶囊几何，但允许换行（「未收口·可能残留」8 个字
 * 在 216px 卡里与按钮同行会挤爆，宁可让它占满一行）。 */
[data-run-close] [data-residual-run][data-badge] {
  flex: 0 1 auto;
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  height: auto;
  min-height: 18px;
  padding: 1px 6px;
  overflow: visible;
  white-space: normal;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-state-warn-primary, currentColor);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 45%, transparent);
  border-radius: 999px;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
/* 终止按钮：破坏性动作用错误色描边（不是填充红底，避免整行看起来已经出事）；
 * 命中区做到 24px（窄面板里也不难点中），hover/active/focus/disabled 四态齐全。 */
[data-run-close] [data-close-run] {
  flex: 0 0 auto;
  box-sizing: border-box;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 45%, transparent);
  border-radius: var(--dsw-radius-sm, 4px);
  background: transparent;
  color: var(--dsw-alias-state-error-primary, currentColor);
  cursor: pointer;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  transition: background-color 150ms ease, border-color 150ms ease;
}
[data-run-close] [data-close-run]:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 10%, transparent);
}
[data-run-close] [data-close-run]:active {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 18%, transparent);
}
[data-run-close] [data-close-run]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-error-primary, currentColor);
  outline-offset: 2px;
}
[data-run-close] [data-close-run][disabled] {
  color: var(--dsw-alias-label-tertiary, inherit);
  border-color: var(--dsw-alias-border-l1, currentColor);
  cursor: progress;
  opacity: 0.7;
}
/* 已终止成功、等宿主快照追上：按钮留在 DOM 里只为焦点回归，不再可点。 */
[data-run-close][data-done="true"] [data-close-run] {
  color: var(--dsw-alias-label-tertiary, inherit);
  border-color: var(--dsw-alias-border-l1, currentColor);
  cursor: default;
  opacity: 0.55;
}
[data-run-close][data-done="true"] [data-close-run]:hover,
[data-run-close][data-done="true"] [data-close-run]:active {
  background: transparent;
}
/* 失败原因/成功提示：各占一整行（flex-basis 100%），长文案断词不截断。 */
[data-run-close] [data-run-close-error] {
  flex: 1 1 100%;
  min-width: 0;
  color: var(--dsw-alias-state-error-primary, currentColor);
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-run-close] [data-run-close-notice] {
  flex: 1 1 100%;
  min-width: 0;
  color: var(--dsw-alias-label-secondary, inherit);
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
/* 历史行：终止入口在打开按钮**外面**（一行不能嵌套两个 button），缩进与行内一致。 */
[data-region="history-list"] [data-history-line="residual"] {
  flex-wrap: wrap;
  padding: 0 12px 8px;
}
/* 顶部 run 卡：残留 run 卡外多一层包装（卡是 button，终止按钮只能是兄弟节点）。
 * 包装保持 216px 卡宽与横滑吸附，卡本身拉满包装宽度。 */
[data-region="run-switcher"] [data-active-run-item] {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  width: 216px;
  min-width: 0;
  scroll-snap-align: start;
}
[data-region="run-switcher"] [data-active-run-item] [data-active-run] {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
[data-region="run-switcher"] [data-active-run-item] [data-run-close] {
  padding: 0 2px;
}
[data-region="run-switcher"] [data-active-run-item] [data-residual-run] {
  flex: 1 1 100%;
}
[data-region="run-switcher"] [data-active-run-item] [data-close-run] {
  flex: 1 1 auto;
}

/* ── ② 子智能体主界面（主区 / 右栏内联共用一套） ────────────────────────── */
:is([data-auto-team-library], [data-auto-team-panellist]) [data-library-shell] [data-member-surface] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
[data-member-page] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
/* 返回条 sticky：页面内滚时「回项目库」始终可点（320px 下也不被内容顶走） */
[data-member-page] [data-member-bar] {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex: 0 0 32px;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  height: 32px;
  padding: 0 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, currentColor);
  background: var(--dsw-alias-bg-layer-2, transparent);
}
[data-member-page] [data-member-back] {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  cursor: pointer;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
[data-member-page] [data-member-back]:hover {
  border-color: var(--dsw-alias-border-l3, currentColor);
  background: var(--dsw-alias-interactive-bg-hover, transparent);
  color: var(--dsw-alias-label-primary, inherit);
}
[data-member-page] [data-member-back]:active {
  background: var(--dsw-alias-interactive-bg-active, transparent);
}
[data-member-page] [data-member-back]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: 1px;
}
[data-member-page] [data-member-crumb] {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-member-page] [data-member-head] {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  padding: 10px 12px 6px;
}
[data-member-page] [data-member-name] {
  flex: 0 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-sm-14, 14px/20px sans-serif);
  font-weight: 600;
}
[data-member-page] [data-member-status] {
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
[data-member-page] [data-member-status][data-tone="business"] {
  color: var(--dsw-alias-state-business-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 40%, transparent);
}
[data-member-page] [data-member-status][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 40%, transparent);
}
[data-member-page] [data-member-status][data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 40%, transparent);
}
[data-member-page] [data-member-status][data-tone="success"] {
  color: var(--dsw-alias-state-success-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, currentColor) 40%, transparent);
}
[data-member-page] [data-member-role] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-member-page] [data-member-model] {
  flex: 1 0 100%;
  min-width: 0;
  color: var(--dsw-alias-label-tertiary, inherit);
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
}
[data-member-page] [data-member-facts],
[data-member-page] [data-member-task-facts] {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 2px 8px;
  margin: 0;
}
[data-member-page] [data-member-facts] {
  padding: 0 12px 8px;
}
[data-member-page] [data-member-task-facts] {
  padding: 0;
}
[data-member-page] [data-member-facts] dt,
[data-member-page] [data-member-task-facts] dt {
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-member-page] [data-member-facts] dd,
[data-member-page] [data-member-task-facts] dd {
  min-width: 0;
  margin: 0;
  color: var(--dsw-alias-label-secondary, inherit);
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
/* 停滞是「有事实的异常」：琥珀只做竖条与 8% 底，文字保持可读的 label-secondary */
[data-member-page] [data-member-stalled][data-stalled="true"] {
  padding-left: 6px;
  border-left: 2px solid var(--dsw-alias-state-warn-primary, currentColor);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 8%, transparent);
}
[data-member-page] [data-member-route-audit] {
  margin: 0 12px 10px;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-left: 2px solid var(--dsw-alias-border-l3, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-member-page] [data-member-route-audit][data-tone="danger"] {
  border-left-color: var(--dsw-alias-state-error-primary, currentColor);
}
[data-member-page] [data-member-route-audit][data-tone="warn"] {
  border-left-color: var(--dsw-alias-state-warn-primary, currentColor);
}
[data-member-page] [data-member-route-audit][data-tone="success"] {
  border-left-color: var(--dsw-alias-state-success-primary, currentColor);
}
[data-member-page] [data-member-task],
[data-member-page] [data-region="member-messages"] {
  margin: 0 12px 10px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-layer-1, transparent);
}
[data-member-page] [data-member-section-title] {
  margin: 0 0 6px;
  color: var(--dsw-alias-label-primary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
  font-weight: 600;
}
[data-member-page] [data-member-task-empty],
[data-member-page] [data-member-messages-empty] {
  margin: 0;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-member-page] [data-member-task-head] {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  min-width: 0;
}
[data-member-page] [data-member-task-id] {
  flex: 0 0 auto;
  box-sizing: border-box;
  min-width: 24px;
  height: 18px;
  padding: 0 4px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  text-align: center;
  font: 600 11px/18px var(--ds-font-family-code, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
}
[data-member-page] [data-member-task-title] {
  flex: 1 1 120px;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xs-13, 13px/20px sans-serif);
  font-weight: 600;
}
[data-member-page] [data-member-task-status] {
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
[data-member-page] [data-member-task-status][data-tone="business"] {
  color: var(--dsw-alias-state-business-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 40%, transparent);
}
[data-member-page] [data-member-task-status][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 40%, transparent);
}
[data-member-page] [data-member-task-status][data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 40%, transparent);
}
[data-member-page] [data-member-task-status][data-tone="success"] {
  color: var(--dsw-alias-state-success-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, currentColor) 40%, transparent);
}
[data-member-page] [data-member-task-cells] {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin: 2px 0 6px;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
  font-variant-numeric: tabular-nums;
}
[data-member-page] [data-member-cell-sep] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-member-page] [data-member-task-cells] [data-cell="token"][data-usage-source="unavailable"],
[data-member-page] [data-member-task-cells] [data-cell="duration"][data-duration-state="unavailable"],
[data-member-page] [data-member-task-cells] [data-cell="duration"][data-duration-state="not-started"] {
  color: var(--dsw-alias-label-tertiary, inherit);
  text-decoration: underline dotted;
  cursor: help;
}
[data-member-page] [data-region="member-messages"] [data-member-message-list] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
[data-member-page] [data-member-message] {
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-bg-layer-2, transparent);
}
[data-member-page] [data-member-message-head] {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  min-width: 0;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-member-page] [data-member-message-from] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-primary, inherit);
  font-weight: 600;
}
[data-member-page] [data-member-message-arrow] {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, inherit);
}
[data-member-page] [data-member-message-to] {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-member-page] [data-member-message-at] {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary, inherit);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
[data-member-page] [data-member-message-body] {
  margin: 4px 0 0;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-member-page] [data-member-message-fold] summary {
  color: var(--dsw-alias-state-business-primary, currentColor);
  cursor: pointer;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-member-page] [data-member-message-fold] summary:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: 1px;
}
[data-member-page] [data-member-message-fold] [data-member-message-body] {
  max-height: 216px;
  overflow: auto;
}

/* ── ③ 历史行底部 token 六项（3 列 × 2 行） ─────────────────────────────── */
[data-region="history-list"] [data-history-line="usage"] {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px 8px;
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px dashed var(--dsw-alias-border-l1, currentColor);
}
[data-region="history-list"] [data-history-usage] [data-history-metric] {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="history-list"] [data-history-usage] [data-usage-metric-label] {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-region="history-list"] [data-history-usage] [data-usage-metric-value] {
  overflow: hidden;
  color: var(--dsw-alias-label-primary, inherit);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxs-12, 12px/16px sans-serif);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
/* 不可得 ≠ 0：三级色 + 虚线，和真 0 在视觉上分得开（数字本身一字不改） */
[data-region="history-list"] [data-history-usage] [data-available="false"] [data-usage-metric-value] {
  color: var(--dsw-alias-label-tertiary, inherit);
  border-bottom: 1px dashed var(--dsw-alias-border-l2, currentColor);
  font-weight: 400;
  cursor: help;
}

/* ── ④ 可点角色卡：常驻描边 + 右下 chevron，hover/active/focus 三态齐全 ─── */
[data-role-grid] [data-role-card][data-role-card-open="true"] {
  position: relative;
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 28%, transparent);
  cursor: pointer;
}
[data-role-grid] [data-role-card][data-role-card-open="true"]:hover {
  background: var(--dsw-alias-bg-layer-2, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 55%, transparent);
}
[data-role-grid] [data-role-card][data-role-card-open="true"]:active {
  background: var(--dsw-alias-interactive-bg-active, transparent);
}
[data-role-grid] [data-role-card][data-role-card-open="true"]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, currentColor);
  outline-offset: 1px;
}
/* chevron 占 10px，meta 行让位，避免盖住用时数字 */
[data-role-grid] [data-role-card][data-role-card-open="true"] [data-role-line="meta"] {
  padding-right: 10px;
}
[data-role-grid] [data-role-card][data-role-card-open="true"]::after {
  content: "›";
  position: absolute;
  right: 6px;
  bottom: 3px;
  color: var(--dsw-alias-state-business-primary, currentColor);
  pointer-events: none;
  font: var(--dsw-font-xs-13, 13px/16px sans-serif);
}

/* ───────────────── r21：需求修订 / 终止原因 / 成员停止态 ───────────────── */

/* run 头的终止原因（只在宿主下发了 terminationReason 时渲染；没有就不占位）。 */
[data-region="run-head"] [data-run-termination] {
  margin: 0;
  padding: 2px 6px;
  border-left: 2px solid var(--dsw-alias-state-warn-primary, currentColor);
  border-radius: var(--dsw-radius-xs, 4px);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 10%, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="run-head"] [data-run-plan] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px dashed var(--dsw-alias-border-l1, currentColor);
}
[data-region="run-head"] [data-plan-block-head] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
[data-region="run-head"] [data-run-revisions],
[data-region="run-head"] [data-run-merged] {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  max-width: 100%;
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: 999px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="run-head"] [data-run-revisions] {
  color: var(--dsw-alias-state-warn-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 55%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 12%, transparent);
}
[data-region="run-head"] [data-run-merged] {
  color: var(--dsw-alias-state-business-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary, currentColor) 45%, transparent);
}
/* 目标全文可能在 320px 里很长：固定最大高度内滚，不把 run 头撑到整屏。 */
[data-region="run-head"] [data-run-goal-sections] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 132px;
  overflow-y: auto;
  min-width: 0;
}
[data-region="run-head"] [data-goal-section] {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding-left: 6px;
  border-left: 2px solid var(--dsw-alias-border-l1, currentColor);
}
[data-region="run-head"] [data-goal-section="revision"] {
  border-left-color: var(--dsw-alias-state-warn-primary, currentColor);
}
[data-region="run-head"] [data-goal-heading] {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="run-head"] [data-goal-tag] {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: 14px;
  padding: 0 4px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 16%, transparent);
  color: var(--dsw-alias-state-warn-primary, currentColor);
  font: var(--dsw-font-xxxs-11, 11px/14px sans-serif);
}
[data-region="run-head"] [data-goal-body] {
  margin: 0;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: var(--dsw-font-xxs-12, 12px/18px sans-serif);
}
[data-region="run-head"] [data-run-latest-revision] {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}

/* 任务卡的「已修订」徽标 + 修订/作废说明（只在宿主字段存在时渲染）。 */
/* 窄于 320px（右栏任务总览约 220px）时，标题与徽标允许换行：宁可多一行，也不让标题被挤成 0 宽。 */
[data-region="task-list"] [data-task-line="title"] {
  flex-wrap: wrap;
}
[data-region="task-list"] [data-task-title] {
  flex: 1 1 96px;
}
[data-region="task-list"] [data-task-wait-scope] {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: 16px;
  padding: 0 5px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 55%, transparent);
  border-radius: 999px;
  color: var(--dsw-alias-state-warn-primary, currentColor);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="task-list"] [data-task-revised] {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: 16px;
  padding: 0 5px;
  border: 1px dashed color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 55%, transparent);
  border-radius: 999px;
  color: var(--dsw-alias-state-warn-primary, currentColor);
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-region="task-list"] [data-task-line="note"] {
  display: block;
  min-width: 0;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}

/* 角色卡上的成员实况 chip（角色聚合状态看不出的停止/等待写域）。 */
[data-role-grid] [data-role-member-status] {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  box-sizing: border-box;
  height: 18px;
  max-width: 100%;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l1, currentColor);
  border-radius: 999px;
  overflow: hidden;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}
[data-role-grid] [data-role-member-status][data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 55%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 12%, transparent);
}
[data-role-grid] [data-role-member-status][data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary, currentColor);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, currentColor) 45%, transparent);
}

/* 历史列表的终止原因行。 */
[data-history-row] [data-history-termination] {
  display: block;
  min-width: 0;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: var(--dsw-font-xxxs-11, 11px/16px sans-serif);
}

@media (prefers-reduced-motion: reduce) {
  [data-progress-ring] [data-ring-arc],
  [data-region="task-flow"] [data-flow-canvas][data-resetting="true"] [data-flow-viewport],
  [data-region="project-detail"] [data-run-row],
  [data-run-drawer],
  [data-run-drawer-mask],
  [data-auto-team-panellist][data-panellist-glyph],
  [data-auto-team-panel] [data-panel-library-inline],
  [data-auto-team-panel] [data-library-inline-back],
  [data-role-grid] [data-role-card],
  [data-region="run-switcher"] [data-active-run-cards],
  [data-region="run-switcher"] [data-active-run],
  [data-member-page] [data-member-back] {
    transition: none;
    animation: none;
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
		// src/shared/duration.ts
		/** 取不到时的统一文案：token / 用时 / 记忆三处共用，界面不再各写一份。 */
		const UNAVAILABLE_TEXT$1 = "不可得";
		/** 数字是否可用于格式化（有限、非负）。`0` 合法 —— 「花了 0 秒」是真话，不是缺失。 */
		function usableNumber$1(value) {
			return typeof value === "number" && Number.isFinite(value) && value >= 0;
		}
		/**
		* 时长文案（AC-20）：
		* 非有限 / 负数 → `不可得`；<1s → `0 秒`；<1min → `N 秒`；<1h → `M 分 SS 秒`；
		* <100h → `H 小时 MM 分`；更久 → `H 小时`。
		*
		* 秒 / 分一律向下取整：显示值永远不会超过真实耗时（宁可少报一秒，不虚报）。
		*/
		function formatDuration(ms) {
			if (!usableNumber$1(ms)) return UNAVAILABLE_TEXT$1;
			if (ms < 1e3) return "0 秒";
			const totalSeconds = Math.floor(ms / 1e3);
			if (ms < 6e4) return `${totalSeconds} 秒`;
			if (ms < 36e5) {
				const minutes = Math.floor(ms / 6e4);
				const seconds = totalSeconds % 60;
				return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
			}
			const hours = Math.floor(ms / 36e5);
			if (ms < 36e7) {
				const minutes = Math.floor(ms / 6e4) % 60;
				return `${hours} 小时 ${String(minutes).padStart(2, "0")} 分`;
			}
			return `${hours} 小时`;
		}
		function durationCellOf(input) {
			if (input.state === "not-started") return {
				state: "not-started",
				text: "未开始"
			};
			if (input.state === "unavailable") return {
				state: "unavailable",
				text: UNAVAILABLE_TEXT$1
			};
			const startAt = usableNumber$1(input.startAt) ? input.startAt : void 0;
			if (startAt === void 0) return {
				state: "unavailable",
				text: UNAVAILABLE_TEXT$1
			};
			const endAt = usableNumber$1(input.endAt) ? input.endAt : input.state === "running" ? input.now : void 0;
			if (endAt === void 0) return {
				startAt,
				state: "unavailable",
				text: UNAVAILABLE_TEXT$1
			};
			const ms = Math.max(0, endAt - startAt);
			return {
				startAt,
				endAt,
				ms,
				text: formatDuration(ms),
				state: usableNumber$1(input.endAt) ? "done" : "running"
			};
		}
		// src/shared/role-view.ts
		/**
		* 角色派生量（r14 AC-7 / AC-8 / AC-9）—— **唯一算法**，宿主与客户端共用。
		*
		* 为什么抽到 shared：r13 把「角色状态 / 当前任务 / 用时」在 `host/library.ts#rolesOf`
		* 与 `client/viewmodel.ts#roleUsageOf` 各写了一份，两边漂移过（右栏说「执行中」、抽屉说
		* 「待命」）。r14 的 AC-9/AC-17 要求两侧文本**逐字相等**，靠对齐不可靠 —— 抽出单一实现后
		* 一致性由构造保证：两侧只做「把任务列表喂进来 + 把结果铺到字段上」的映射。
		*
		* 纯逻辑模块：只 import `shared/` 内的纯模块（`types.ts` / `duration.ts`），不碰宿主、不碰客户端、不读时钟。
		*/
		/** 角色态 → 中文文案（组件与宿主都用这一份，禁止再写第二份映射）。 */
		const ROLE_STATE_TEXT = {
			running: "执行中",
			waiting_gate: "待验收",
			needs_attention: "需处理",
			done: "已完成",
			idle: "待命"
		};
		/** 角色态 → 徽标 tone（与既有 BadgeTone 同名，组件直接透传 `data-tone`）。 */
		const ROLE_STATE_TONE = {
			running: "business",
			waiting_gate: "warn",
			needs_attention: "danger",
			done: "success",
			idle: "neutral"
		};
		/**
		* 「已开始」的任务状态：这些状态下的任务一定有过执行区间，拿不到用时就是缺口。
		* 其余状态（排队/等写域/暂停/取消/跳过）允许没有用时 —— 贡献 0，不算缺口。
		*/
		const STARTED_STATUSES = [
			"running",
			"gate",
			"done",
			"rework",
			"failed",
			"interrupted"
		];
		/** 需要人介入的终态/返工态（AC-7 的 danger）。 */
		const ATTENTION_STATUSES = [
			"rework",
			"failed",
			"interrupted"
		];
		function attentionOf(status) {
			return ATTENTION_STATUSES.includes(status);
		}
		/**
		* 任务列表 → 角色态派生量。
		*
		* 优先级（PRD AC-7）：`running` > `gate` > `rework|failed|interrupted` > 全部 `done` > `idle`。
		* `done` 只数 `status === 'done'` —— `cancelled`/`skipped` 是终态但不是完成（AC-10 的分子口径），
		* 所以「1 个 done + 1 个 cancelled」判 `idle` 而不是 `done`。
		*
		* 空数组 = `idle` + `0` + 用时「不可得」（不是 0），界面不画假进度。
		*/
		function roleStateOf(tasks) {
			let done = 0;
			let running;
			let gate;
			let attention = false;
			for (const task of tasks) {
				if (task.status === "done") done += 1;
				if (task.status === "running" && running === void 0) running = task;
				if (task.status === "gate" && gate === void 0) gate = task;
				if (attentionOf(task.status)) attention = true;
			}
			const active = running ?? gate;
			const state = running !== void 0 ? "running" : gate !== void 0 ? "waiting_gate" : attention ? "needs_attention" : tasks.length > 0 && done === tasks.length ? "done" : "idle";
			const view = {
				done,
				state,
				stateText: ROLE_STATE_TEXT[state]
			};
			if (active !== void 0) {
				view.activeTaskId = active.id;
				view.activeTaskTitle = active.title;
			}
			view.duration = roleDurationOf(tasks);
			return view;
		}
		/**
		* 角色累计用时（r20）—— 宿主 `library.rolesOf` 与客户端 `viewModel.roleUsageOf` 共用的唯一算法。
		*
		* 口径（Lead 定稿，四句话）：
		*  1. 每个任务的贡献 = 它自己的用时（`endedAt - startedAt`；进行中由宿主按 now 算好），直接累加；
		*  2. **未开始的任务贡献 0**，不算缺口 —— 否则角色只要还有排队任务就永远「不可得」，等于没修；
		*  3. 真正的缺口才判不可得：状态表示「已开始/已结束」却没有任何用时（缺开始/结束时刻、区间非法）
		*     → `unavailable` + 一句人话原因（不显示被低估的合计，与 `roleUsageCellOf` 同一条纪律）；
		*  4. 全部任务都未开始 → `not-started`（不是 0 秒，也不是不可得）。
		*
		* 文本由 `shared/duration.ts#formatDuration` 生成（与任务/run 用时同一算法，两侧逐字相等）。
		* 累计格刻意不带 `startAt` / `endAt`：聚合区间没有单一「开始/结束时刻」，带上就会出现
		* 「开始 — · 结束 —」这种自相矛盾的 tooltip。
		*/
		function roleDurationOf(tasks) {
			if (tasks.length === 0) return {
				state: "unavailable",
				text: UNAVAILABLE_TEXT$1
			};
			let total = 0;
			let contributing = 0;
			let running = false;
			const gaps = [];
			for (const task of tasks) {
				const cell = task.duration;
				const startedStatus = STARTED_STATUSES.includes(task.status);
				if (cell === void 0) {
					if (startedStatus) gaps.push(`任务 ${task.id} 没有用时数据`);
					continue;
				}
				if (cell.state === "not-started") {
					if (startedStatus) gaps.push(`任务 ${task.id} 缺少开始时刻`);
					continue;
				}
				if (cell.state === "unavailable" || typeof cell.ms !== "number" || !Number.isFinite(cell.ms) || cell.ms < 0) {
					gaps.push(`任务 ${task.id} 缺少开始/结束时刻`);
					continue;
				}
				contributing += 1;
				total += cell.ms;
				if (cell.state === "running") running = true;
			}
			if (gaps.length > 0) {
				const first = gaps[0];
				return {
					state: "unavailable",
					text: gaps.length === 1 ? `不可得：${first}` : `不可得：${first}（另有 ${gaps.length - 1} 个任务同样不可得）`
				};
			}
			if (contributing === 0) return {
				state: "not-started",
				text: "未开始"
			};
			return {
				state: running ? "running" : "done",
				ms: Math.round(total),
				text: formatDuration(total)
			};
		}
		/** 角色用量全部缺失时的原因文案（**唯一一份**，宿主与客户端都从这里取，AC-17 逐字相等）。 */
		const ROLE_USAGE_MISSING = "该角色没有可用用量事件";
		/** 角色用量部分缺失时的原因文案（同上；部分缺失按「不可得」处理，不显示被低估的合计）。 */
		const ROLE_USAGE_PARTIAL = "部分任务没有可用用量事件";
		/** 一条用量单元格是否给出了可用合计（`provider` 且 `total` 是有限数）。 */
		function usableTokensOf(cell) {
			if (cell.source !== "provider") return void 0;
			const tokens = cell.tokens;
			if (tokens === void 0) return void 0;
			if (typeof tokens.total !== "number" || !Number.isFinite(tokens.total)) return void 0;
			return tokens;
		}
		function finiteOf(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : 0;
		}
		/**
		* 角色用量合计（AC-8 / AC-9 / AC-17）—— 与 `roleStateOf` 一样是**唯一算法**。
		*
		* 为什么抽到 shared：r13 的宿主 `library.rolesOf` 把已知项加起来（部分缺失时给出 80），
		* 客户端 `viewmodel.roleUsageOf` 部分缺失即判「不可得」；同一张角色卡在右栏与抽屉里
		* 说两种话（QA D2）。两边各自实现必然再次漂移，所以口径收到这里：
		*
		*   - 全部任务都有可用数字 → `provider` + 各字段合计（`total` / `input` / `output`）；
		*   - 任一任务缺可用数字 → `unavailable` + `ROLE_USAGE_PARTIAL`（把已知项加起来会得出
		*     比真实值**小**的数字，比「不可得」更误导）；
		*   - 一条都没有 → `unavailable` + `ROLE_USAGE_MISSING`。
		*/
		function roleUsageCellOf(cells) {
			let total = 0;
			let input = 0;
			let output = 0;
			let available = 0;
			for (const cell of cells) {
				const tokens = usableTokensOf(cell);
				if (tokens === void 0) continue;
				available += 1;
				total += tokens.total;
				input += finiteOf(tokens.input);
				output += finiteOf(tokens.output);
			}
			if (available === 0) return {
				source: "unavailable",
				reason: ROLE_USAGE_MISSING
			};
			if (available < cells.length) return {
				source: "unavailable",
				reason: ROLE_USAGE_PARTIAL
			};
			const tokens = { total: Math.round(total) };
			if (input > 0) tokens.input = Math.round(input);
			if (output > 0) tokens.output = Math.round(output);
			return {
				source: "provider",
				tokens
			};
		}
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
			},
			stopping: {
				icon: "◔",
				text: "停止中",
				tone: "warn"
			},
			stopped: {
				icon: "■",
				text: "已停止",
				tone: "neutral"
			}
		};
		const UNKNOWN_BADGE = {
			icon: "?",
			text: "未知",
			tone: "neutral"
		};
		/**
		* 成员卡专用徽标表（r21）。
		*
		* 与任务卡共用 `badge.text` 会冲突：任务 `waiting` 的文案是「等待中」（13 态词表，
		* 被 test/viewmodel.test.ts 与 test/client-ui.test.ts 钉死），而成员 `waiting` 的语义
		* 是**等待写域**。任务卡继续用 `statusBadge`，成员卡用本表 —— 两边都只读宿主状态，
		* 各自的中文在唯一一张表里。
		*/
		const MEMBER_BADGES = {
			...BADGES,
			waiting: {
				icon: "⏳",
				text: "等待写域",
				tone: "warn"
			}
		};
		/**
		* 成员状态 → 徽标（r21）：只给成员卡/成员页用。
		*
		* 之前成员卡的 `waiting` 落到任务词表显示「等待中」，看不出成员在等写域；
		* `stopping`/`stopped` 没有词表条目时更会回显英文原文。
		*/
		function memberStatusBadge(status) {
			return MEMBER_BADGES[status] ?? {
				...UNKNOWN_BADGE,
				text: status === "" ? "未知" : status
			};
		}
		/** 成员状态的悬停说明（r21）：只解释宿主已下发的事实，不推断「应该已经停了」。 */
		function memberStatusTitleOf(status) {
			if (status === "stopping") return "已发出中断，尚未确认停止";
			if (status === "stopped") return "中断已确认，成员已停止";
		}
		/** 需要独立徽标提示的成员态（r21）：这些态在角色卡上会被角色聚合状态盖住。 */
		const MEMBER_CARD_STATUSES = [
			"waiting",
			"stopping",
			"stopped",
			"cancelled"
		];
		/**
		* 角色卡上的成员态 chip（r21）：只在「角色状态看不出成员实况」时返回。
		*
		* 角色卡的状态来自 `roleStateOf(tasks)`（按任务聚合）；成员被中断/任务作废/等写域时，
		* 角色卡可能仍显示「待命」。这份 chip 只补成员事实，不替换角色状态。
		*/
		function memberCardChipOf(member) {
			if (member === void 0) return void 0;
			if (!MEMBER_CARD_STATUSES.includes(member.status)) return void 0;
			const badge = memberStatusBadge(member.status);
			if (member.status === "stopped" && typeof member.stoppedAt === "number" && member.stoppedAt > 0) return {
				...badge,
				text: `${badge.text} ${formatStamp(member.stoppedAt)}`
			};
			return badge;
		}
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
			const stage = runStageOf({
				planStatus: snapshot.planStatus ?? (tasks.length > 0 ? "draft" : void 0),
				total: tasks.length,
				done,
				running,
				failed,
				interrupted,
				members: members.length
			});
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
			if (stage.key === "ready") return {
				tone: "plan",
				text: stage.label,
				...stage.detail === void 0 ? {} : { title: stage.detail }
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
				label: "已计划",
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
		/** `PlanStatusTone` → `BadgeTone`：计划态没有 run/success/danger，按语义就近对齐。 */
		const PLAN_TONE_BADGE_TONE = {
			ok: "business",
			warn: "warn",
			bad: "danger",
			muted: "neutral"
		};
		/** 阶段图标：只补「形状」一个视觉维度，文案仍只来自 `runStageOf`。 */
		const RUN_STAGE_ICON = {
			disabled: "·",
			cancelled: "⊘",
			terminated: "■",
			paused: "⏸",
			failed: "✕",
			interrupted: "⚑",
			running: "▶",
			closing: "◔",
			dispatching: "◐",
			ready: "·",
			pending: "○"
		};
		/** 计数规整：只接受有限非负数；缺失 / NaN / 负数一律 `undefined`（不补 0）。 */
		function stageCountOf(value) {
			return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : void 0;
		}
		/**
		* 计划 goal 里的阶段判定表（r26）：**唯一**的阶段判定实现。
		*
		* 优先级从高到低，先命中先返回：
		*  1 无计划 → 未启用；2 已取消；3 已终止（detail 取终止原因）；4 已暂停；
		*  5 有失败；6 已中断；7 执行中；8 任务全部结束但计划未收口 → 待收口；
		*  9 派发中；10 计划就绪（total>0 && 零成员 && done===0）；11 待派发。
		*
		* 「计划就绪」只允许在规则 10 命中时出现 —— 这是 `draft` 不再直接当徽标的机械保证。
		*/
		function runStageOf(input) {
			const planStatus = input.planStatus;
			const total = stageCountOf(input.total);
			const done = stageCountOf(input.done);
			const running = stageCountOf(input.running);
			const failed = stageCountOf(input.failed);
			const interrupted = stageCountOf(input.interrupted);
			const members = stageCountOf(input.members);
			const reason = typeof input.terminationReason === "string" ? input.terminationReason.trim() : "";
			const finishedAt = stageCountOf(input.finishedAt);
			const closed = reason !== "" && finishedAt !== void 0 && finishedAt > 0;
			if (planStatus === void 0) return {
				key: "disabled",
				label: "未启用",
				tone: "muted",
				detail: "还没有计划：给出目标后，宿主会先拆解任务，再派发给成员"
			};
			if (planStatus === "cancelled") return {
				key: "cancelled",
				label: "已取消",
				tone: "muted",
				detail: reason !== "" ? reason : "计划已取消，不再派发新任务"
			};
			if (planStatus === "terminated") return {
				key: "terminated",
				label: "已终止",
				tone: "muted",
				detail: reason !== "" ? reason : "计划已终止，不再派发新任务"
			};
			if (planStatus === "paused") return {
				key: "paused",
				label: "已暂停",
				tone: "warn",
				detail: "计划已暂停，继续后才会派发新任务"
			};
			if (failed !== void 0 && failed > 0) return {
				key: "failed",
				label: `有失败 · ${failed}`,
				tone: "bad",
				detail: `${failed} 个任务失败，需要返工或重跑`
			};
			if (interrupted !== void 0 && interrupted > 0) return {
				key: "interrupted",
				label: `已中断 · ${interrupted}`,
				tone: "bad",
				detail: `${interrupted} 个成员已中断，可续聊恢复`
			};
			if (running !== void 0 && running > 0) return {
				key: "running",
				label: total === void 0 ? "执行中" : `执行中 · ${done ?? 0}/${total}`,
				tone: "ok",
				detail: total === void 0 ? `${running} 个任务正在执行` : `${total} 个任务已完成 ${done ?? 0} 个，${running} 个正在执行`
			};
			if (total !== void 0 && total > 0 && done === total && !closed) return {
				key: "closing",
				label: "待收口",
				tone: "warn",
				detail: "任务已全部结束，计划尚未收口"
			};
			if (planStatus === "dispatching" || members !== void 0 && members > 0) return {
				key: "dispatching",
				label: total === void 0 ? "派发中" : `派发中 · ${done ?? 0}/${total}`,
				tone: "ok",
				detail: total === void 0 ? "计划正在把就绪任务派给成员" : `计划正在派发：${done ?? 0}/${total} 个任务已结束`
			};
			if (total !== void 0 && total > 0 && members === 0 && done === 0) return {
				key: "ready",
				label: `计划就绪 · ${total} 任务`,
				tone: "ok",
				detail: `${total} 个任务已就绪，还没有派发给成员`
			};
			return {
				key: "pending",
				label: "待派发",
				tone: "muted",
				detail: total !== void 0 && total > 0 ? `计划尚未进入派发：${done ?? 0}/${total} 个任务已结束` : "计划还没有可派发的任务"
			};
		}
		/** 阶段 → 徽标三元组（图标本表、文案本函数上游、tone 走计划态映射）。 */
		function runStageBadge(stage) {
			return {
				icon: RUN_STAGE_ICON[stage.key] ?? "?",
				text: stage.label,
				tone: PLAN_TONE_BADGE_TONE[stage.tone]
			};
		}
		/**
		* run 详情（`RunDetailView`，不带计数）→ 阶段。
		*
		* 计数**从真实任务列表派生**（精确值，不是猜）；`members` 这类详情里没有的信息
		* 保持 undefined，让规则 9/10 不被误命中。
		*/
		function stageOfDetail(detail, counts = {}) {
			const tasks = detail.tasks ?? [];
			const done = tasks.filter((task) => task.status === "done").length;
			const running = tasks.filter((task) => task.status === "running" || task.status === "gate").length;
			const failed = tasks.filter((task) => task.status === "failed").length;
			return runStageOf({
				...counts,
				planStatus: detail.planStatus,
				total: counts.total ?? tasks.length,
				done: counts.done ?? done,
				running: counts.running ?? running,
				failed: counts.failed ?? failed,
				...detail.terminationReason !== void 0 ? { terminationReason: detail.terminationReason } : {},
				...detail.finishedAt !== void 0 ? { finishedAt: detail.finishedAt } : {}
			});
		}
		/**
		* 当前 run 的阶段判定输入：宿主投影 `runCounts` 优先；旧快照没有投影时按
		* `tasks` / `members` **精确派生**（不是拿 0 冒充缺失：running/failed 由任务态直接数，
		* interrupted 由成员态直接数，members 就是快照里本 run 的成员数）。
		*
		* `planStatus` 保持原样（缺失即 undefined）—— 阶段函数据此走规则 1「未启用」。
		*/
		function currentRunStageInputOf(snapshot) {
			const tasks = snapshot?.tasks ?? [];
			const members = snapshot?.members ?? [];
			const counts = snapshot?.runCounts ?? {};
			const done = tasks.filter((task) => task.status === "done").length;
			return {
				planStatus: snapshot?.planStatus,
				total: tasks.length,
				done,
				running: counts.running ?? tasks.filter((task) => task.status === "running" || task.status === "gate").length,
				failed: counts.failed ?? tasks.filter((task) => task.status === "failed").length,
				interrupted: counts.interrupted ?? members.filter((member) => member.status === "interrupted").length,
				members: counts.members ?? members.length
			};
		}
		/**
		* 「还没有收口」的计划态 —— 与宿主 `reconcileStalePlans` 用**同一个集合**。
		*
		* 只有这三种态可能出现在「计划还在，进程已经没了」的场景里；终态
		* （`terminated` / `cancelled`）本身已经收口，不会再被认为是残留。
		*/
		const UNCLOSED_PLAN_STATUSES = [
			"draft",
			"dispatching",
			"paused"
		];
		/** 残留计划徽标文案（唯一来源；历史行与 run 卡都读它）。 */
		const RESIDUAL_RUN_BADGE_TEXT = "未收口·可能残留";
		/** 徽标悬停解释：说清「凭什么这么判」以及「能做什么」，不做「系统认为」式推断。 */
		const RESIDUAL_RUN_TITLE = "计划态为草稿/派发中/已暂停，且没有结束时刻：这次运行没有收口，可能残留。确认没有成员在跑后可点「终止计划」";
		/** 终止残留计划的按钮文案（破坏性动作：用结果命名，不用「确定」）。 */
		const CLOSE_RUN_LABEL = "终止计划";
		/** 终止成功后的就地提示（宿主返回的新快照会把这一行刷成终态，提示只在刷不到时可见）。 */
		const CLOSE_RUN_DONE_TEXT = "已终止该残留计划";
		/** 残留计划徽标（warn tone：不是失败，但需要用户处理）。 */
		const RESIDUAL_RUN_BADGE = {
			icon: "⚠",
			text: RESIDUAL_RUN_BADGE_TEXT,
			tone: "warn"
		};
		/**
		* 是否残留计划：**只读宿主事实**，不看任务数、不看 `active`。
		*
		* `active` 在宿主侧等于 `ongoing > 0`（有未终态任务），无法区分「正在跑」与「进程没了」；
		* 因此残留判定严格按 r24 口径：计划态 ∈ {draft,dispatching,paused} 且没有 `finishedAt`。
		* 正在跑的 run 也满足这一条 —— 它同样是「没收口」，徽标文案说的是「可能残留」。
		*/
		function isResidualRun(run) {
			if (!UNCLOSED_PLAN_STATUSES.includes(run.status)) return false;
			return run.finishedAt === void 0 || !(run.finishedAt > 0);
		}
		/**
		* 已收口（终态）的计划态 —— 与宿主 `PLAN_TERMINAL_STATUSES` 用**同一个集合**。
		*
		* 这两个态的 run 里可能还留着旧数据（任务没被终结、宿主下发的 `ongoing > 0`），
		* 客户端必须自己把它们从「进行中」里排除：这是与宿主修正并行的双保险。
		*/
		const TERMINAL_PLAN_STATUSES = ["terminated", "cancelled"];
		/**
		* run 是否已经收口（终态）。
		*
		* 两条判据（与任务卡口径一致）：
		*  - 计划态就是 `terminated` / `cancelled`：宿主已明确收口，**即使还带着旧任务的 ongoing>0**；
		*  - 带了终止原因且落了结束时刻：宿主 r21 起终止时才写 `terminationReason`，
		*    两者同时存在说明这次运行已经结束（防旧宿主把计划态写成非终态）。
		*
		* 只读宿主事实，不按 `active` / 任务数反推。
		*/
		function isClosedRun(run) {
			if (TERMINAL_PLAN_STATUSES.includes(run.status)) return true;
			return (typeof run.terminationReason === "string" ? run.terminationReason.trim() : "") !== "" && typeof run.finishedAt === "number" && run.finishedAt > 0;
		}
		/**
		* 「终止计划」的二次确认内容（`PendingConfirmationView` 的唯一构造点）。
		*
		* 走既有 `confirmDialogOf` 渲染，因此标题/按钮文案来自 `CONFIRM_VERBS.closeRun`，
		* 这里只提供**影响范围**：1 次运行、停止派发新任务；有存活成员时宿主会拒绝。
		*/
		function closeRunPendingOf(runId, now = Date.now()) {
			return {
				id: `close-run-${runId}`,
				action: "closeRun",
				runId,
				createdAt: now,
				summary: "影响 1 次运行：标记为已终止，不再派发新任务、不再等待门禁；若仍有存活成员，宿主会拒绝本次终止并说明原因",
				irreversible: true,
				waitedText: "刚刚"
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
		/** 千分位分组：与宿主 `format.ts` 的 `groupDigits` 逐字一致（客户端唯一的分组实现）。 */
		function groupDigits(digits) {
			return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}
		/** 可用数字（有限、非负）。`0` 合法 —— 「花了 0 token」是真话，不是缺失。 */
		function usableNumber(value) {
			return typeof value === "number" && Number.isFinite(value) && value >= 0;
		}
		/** 带单位的 token 阶梯（从大到小，先命中先返回）：与宿主 `TOKEN_UNITS` 同表。 */
		const CLIENT_TOKEN_UNITS = [
			{
				divisor: 1e9,
				suffix: "B"
			},
			{
				divisor: 1e6,
				suffix: "M"
			},
			{
				divisor: 1e3,
				suffix: "K"
			}
		];
		/**
		* 带单位的 token 文本（r19）：与宿主 `src/host/format.ts` 的 `formatTokenUnits` **逐字一致**
		* （跨端不能互相 import，只能靠两侧测试同表锁定）。
		*
		* 规则：`< 1,000` 原样整数；`≥ 1e3 / 1e6 / 1e9` 升到 K / M / B，固定两位小数；
		* 四舍五入进位跨阈值时顺延上一级（`999,999` → `1.00M`，界面永不出现 `1000.00K`）。
		*
		* 只在宿主没给 `cell.text`（旧快照）时兜底；有 `text` 时一律用宿主的，客户端不重算。
		*/
		function tokenUnitsText(total) {
			if (!usableNumber(total)) return UNAVAILABLE_TEXT;
			const value = Math.round(total);
			if (value < 1e3) return String(value);
			for (let index = 0; index < CLIENT_TOKEN_UNITS.length; index += 1) {
				const unit = CLIENT_TOKEN_UNITS[index];
				if (value < unit.divisor) continue;
				const text = (value / unit.divisor).toFixed(2);
				if (Number(text) >= 1e3 && index > 0) {
					const next = CLIENT_TOKEN_UNITS[index - 1];
					return `${(value / next.divisor).toFixed(2)}${next.suffix}`;
				}
				return `${text}${unit.suffix}`;
			}
			return String(value);
		}
		/** 合计文本兜底（旧数据无 `cell.text`）：动态单位，与宿主同口径。 */
		function fullTokenText(total) {
			return tokenUnitsText(total);
		}
		/**
		* token 单元格文本：`provider` 用宿主文本（带 K/M/B 单位），`unavailable` 一律「不可得」。
		*
		* r19：以为单位是唯一展示口径；旧数据没有 `text` 时按同一算法兜底（`fullTokenText`）。
		* 为什么不显示 `-` 或 `0`：`-` 会被读成「还没跑」，`0` 会被读成「跑了但没花 token」，
		* 两者都是假话；「不可得」是唯一诚实的第三种状态（DESIGN §2.2）。
		*/
		function tokenTextOf(cell) {
			if (!cell || cell.source !== "provider") return UNAVAILABLE_TEXT;
			if (typeof cell.text === "string" && cell.text !== "") return cell.text;
			return fullTokenText(cell.tokens?.total);
		}
		/**
		* 六项指标明细（r17）：只透传宿主 `details`，客户端不重算命中率、不猜缺失分项。
		*
		* 旧数据没有 `details` 时返回空数组，调用方退化为只显示合计。
		*/
		function usageMetricsOf(cell) {
			if (!cell || cell.source !== "provider" || !Array.isArray(cell.details)) return [];
			return cell.details;
		}
		/** token 单元格的 `title`：不可得时给原因；可得时优先展开宿主给的六项明细。 */
		function tokenTitleOf(cell) {
			if (!cell || cell.source !== "provider") return cell?.reason ?? "该处没有用量来源";
			const parts = [`合计 ${fullTokenText(cell.tokens?.total)} token`];
			const details = usageMetricsOf(cell);
			if (details.length > 0) {
				for (const metric of details) parts.push(`${metric.label} ${metric.text}`);
				return parts.join(" · ");
			}
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
				case "unavailable": {
					const reason = (cell.reason ?? "").trim();
					return reason !== "" ? reason : "没有开始时间，算不出用时";
				}
				default: return `开始 ${formatStamp(cell.startAt)} · 结束 ${formatStamp(cell.endAt)}`;
			}
		}
		/**
		* 角色卡「累计用时」的 `title`（r20）—— **不能**走 `durationTitleOf`。
		*
		* 角色用时是**聚合值**（`shared/role-view.ts#roleDurationOf` 把该角色名下任务逐个相加），
		* 聚合区间没有单一「开始/结束时刻」，所以 cell 里刻意不带 `startAt`/`endAt`；
		* 走通用的 `durationTitleOf` 会拼出「开始 — · 结束 —」这种自相矛盾的解释。
		*
		* 四态文案（与卡片上的可见文本分工：卡片只放 `cell.text`，这里解释「这个数怎么来的」）：
		*  - done / running → 「该角色名下任务用时合计：<text>（N 个任务）」；
		*  - not-started → 任务都还没开始，暂无累计用时（**不是 0 秒**）；
		*  - unavailable → 合计不可得 + cell.text 里宿主给的原因（缺开始/结束时刻等）；
		*  - 旧快照没有 duration 字段 → 说明是旧数据，不补 0。
		*
		* 纯函数、零格式化：时长文案一律取自宿主下发的 `cell.text`。
		*/
		function roleDurationTitleOf(duration, tasks) {
			if (duration === void 0) return "旧快照没有该角色的用时数据";
			if (duration.state === "not-started") return "该角色名下的任务都还没开始，暂无累计用时";
			if (duration.state === "unavailable") {
				const reason = duration.text.startsWith("不可得") ? duration.text.slice(3).replace(/^[：:]\s*/, "") : duration.text;
				return reason === "" ? "该角色名下任务用时合计不可得" : `该角色名下任务用时合计不可得：${reason}`;
			}
			const count = typeof tasks === "number" && Number.isFinite(tasks) && tasks > 0 ? `（共 ${Math.round(tasks)} 个任务）` : "";
			const running = duration.state === "running" ? "，进行中的任务按当前时刻计入" : "";
			return `该角色名下任务用时合计：${duration.text}${count}${running}`;
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
		/**
		* r26：第三参可传入阶段视图；不传时保持旧行为（原始计划状态）。
		* 任务页会把 `stageOfDetail` 的结果传进来，所以 run 头的徽标与卡片/历史行同源。
		*/
		function runHeadOf(detail, inflight = "idle", stage) {
			const status = planStatusView(detail.planStatus);
			const inflightView = inflightOf(inflight);
			const head = {
				runId: detail.runId,
				planStatusLabel: stage === void 0 ? status.label : stage.label,
				planStatusTone: stage === void 0 ? status.tone : stage.tone,
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
			if (stage !== void 0 && stage.detail !== void 0) head.planStatusDetail = stage.detail;
			if (head.usageSource !== "provider") head.downgrade = `token ${UNAVAILABLE_TEXT}（无用量来源）`;
			if (detail.terminationReason !== void 0 && detail.terminationReason.trim() !== "") head.terminationReason = detail.terminationReason.trim();
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
		/** 修订徽标文案（r21）：宿主只下发事实位，中文在客户端这一处。 */
		const TASK_REVISED_TEXT = "已修订";
		/**
		* r25：取消原因的中文兜底 —— **只读 `cancelledBy` 的语义，绝不回显英文枚举**。
		*
		* 宿主正常会写 `cancelReason`（如「计划已收口：…」）；旧数据只有 `cancelledBy` 时
		* 卡片仍要能回答「为什么没了」，因此按来源翻成中文。新增来源必须先在这里补文案。
		*/
		const CANCEL_BY_REASON = {
			revision: "被需求修订作废",
			user: "队长取消任务",
			stale: "计划已收口，任务随计划一起终结"
		};
		/** 已取消但宿主既没给原因、也没给来源：如实说明，不伪造理由、不留空白。 */
		const CANCEL_REASON_UNKNOWN_TEXT = "已取消，宿主未记录原因";
		function taskRowOf(task, expanded) {
			const row = {
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
			if (typeof task.revisedAt === "number" && task.revisedAt > 0) {
				row.revisedText = TASK_REVISED_TEXT;
				const note = task.revisionNote?.trim();
				if (note !== void 0 && note !== "") row.revisionNote = note;
			}
			if (task.status === "cancelled") {
				const reason = task.cancelReason?.trim();
				if (reason !== void 0 && reason !== "") row.cancelReason = reason;
				else {
					const by = task.cancelledBy;
					const fallback = by === void 0 ? "" : CANCEL_BY_REASON[by];
					row.cancelReason = fallback !== "" ? fallback : CANCEL_REASON_UNKNOWN_TEXT;
				}
			}
			if (task.status === "waiting") {
				const waitReason = task.waitReason?.trim();
				if (waitReason !== void 0 && waitReason !== "") row.waitScopeText = "等待写域";
			}
			return row;
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
			else {
				const metrics = usageMetricsOf(task.usage);
				if (metrics.length > 0) panel.usageMetrics = metrics;
			}
			if (task.duration.state === "unavailable") {
				const reason = (task.duration.reason ?? "").trim();
				panel.durationReason = reason !== "" ? reason : "没有开始时间，算不出用时";
			}
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
		const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * 34;
		/**
		* 任务总览的**唯一**派生点（r14 AC-10 / AC-11；r18b 恢复全量列表）。
		*
		* 一次调用同时产出环的比例、圆心文本与两个分组 —— 组件不再自己做除法或二次过滤，
		* 所以「改一个任务 running→done」时环与两组必然同一帧一致（AC-11）。
		*
		* 口径（r18b 按用户要求回滚 r18 的过滤）：
		*  - **环**按**全量**任务算：分子只认 `status === 'done'`，分母是全部任务
		*    （`cancelled`/`skipped` 计入分母、不计入分子，AC-10）；
		*  - **列表也是全量**：`groups.open` = 所有非 done 任务（`cancelled`/`skipped` 同样
		*    留在未完成组，不再被剔除），`groups.done` = 所有 done 任务；两组都保持计划顺序。
		*
		* 空组的隐藏不在这里做：由 TaskTable 的 grouped 分支按 `rows.length === 0` 过滤
		* （全部完成或没有任务时 open 组为空，因此「全部完成时没有『未完成 · 0』组头」仍然成立）。
		*/
		function taskOverviewOf(tasks, expandedTaskId) {
			const open = [];
			const done = [];
			for (const task of tasks) {
				const row = taskRowOf(task, task.id === expandedTaskId);
				if (task.status === "done") done.push(row);
				else open.push(row);
			}
			const total = tasks.length;
			const ratio = total === 0 ? 0 : done.length / total;
			return {
				done: done.length,
				total,
				text: `${done.length}/${total}`,
				ariaLabel: `已完成 ${done.length} / 共 ${total}`,
				ratio,
				dashOffset: PROGRESS_RING_CIRCUMFERENCE * (1 - ratio),
				groups: {
					open,
					done
				}
			};
		}
		/**
		* run 级标题的**唯一截断点**（r14 AC-15）：组件只渲染，不再二次截断/补 `…`。
		*
		* 没有 goal 的旧 run 用「未命名任务 · runId 后 6 位」——**不拿任务标题或 runId 冒充目标**，
		* 也不猜（AC-15 明确禁止标题等于 `t1`/裸 runId）。
		*/
		function goalTitleOf(goal, runId) {
			const full = (goal ?? "").trim();
			if (full === "") return {
				text: `未命名任务 · ${runId.slice(-6)}`,
				title: `本轮没有记录目标（run ${runId}）`,
				source: "fallback"
			};
			const chars = Array.from(full);
			if (chars.length <= 24) return {
				text: full,
				title: full,
				source: "goal"
			};
			return {
				text: `${chars.slice(0, 24).join("")}…`,
				title: full,
				source: "goal"
			};
		}
		/**
		* 宿主追加段落的标题格式：`## 需求修订（YYYY-MM-DD HH:mm）`。
		*
		* 与 `src/host/plan/plan.ts#revisePlan` 的落盘格式**逐字对应**；客户端只做切分，
		* 不重写标题、不重排时间 —— 用户原文（含换行）原样保留。
		*/
		const REVISION_HEADING = /^## 需求修订（([^）\n]*)）[ \t]*$/gm;
		/**
		* 目标全文 → 分段视图（r21）。
		*
		* 输入是宿主下发的 `PanelSnapshot.goal`（原目标 + 逐次追加的「## 需求修订（…）」段）
		* 与 `PanelSnapshot.revisions`。函数是纯的：
		*  - 没有目标、也没有修订史 → `null`（run 头整块不渲染，不占位）；
		*  - `goal` 里没有修订标题 → 只有「原始目标」一段；
		*  - 修订段与修订史**同一份用户原文**，只切分、不改写、不补时刻。
		*/
		function planGoalOf(goal, revisions, runId) {
			const text = (goal ?? "").trim();
			const history = Array.isArray(revisions) ? revisions : [];
			if (text === "" && history.length === 0) return null;
			const headings = [...text.matchAll(REVISION_HEADING)];
			const sections = [];
			if (headings.length === 0) {
				if (text !== "") sections.push({
					key: "goal-origin",
					revision: false,
					heading: "原始目标",
					body: text
				});
			} else {
				const firstIndex = headings[0].index ?? 0;
				const origin = text.slice(0, firstIndex).trim();
				if (origin !== "") sections.push({
					key: "goal-origin",
					revision: false,
					heading: "原始目标",
					body: origin
				});
				headings.forEach((heading, index) => {
					const start = (heading.index ?? 0) + heading[0].length;
					const end = index + 1 < headings.length ? headings[index + 1].index ?? text.length : text.length;
					const body = text.slice(start, end).trim();
					sections.push({
						key: `goal-revision-${index + 1}`,
						revision: true,
						heading: `需求修订（${heading[1]}）`,
						body
					});
				});
			}
			const view = { sections };
			const hasRevisionSection = sections.some((section) => section.revision);
			if (history.length > 0) {
				view.revisionCountText = `本次运行已被修订 ${history.length} 次`;
				const latest = history[history.length - 1];
				const summary = (latest.changeSummary ?? "").trim();
				view.latestRevisionText = summary === "" ? `最近一次修订于 ${formatStamp(latest.at)}` : `最近修订 ${formatStamp(latest.at)}：${summary}`;
			}
			if (history.length > 0 || hasRevisionSection) view.mergedText = `已并入 ${runId}`;
			return view;
		}
		/** 任意输入 → 合法列宽；非数字（NaN/Infinity）回默认值，不做 `Math.min(undefined)` 这种 NaN 传染。 */
		function clampListWidth(width) {
			if (!Number.isFinite(width)) return 220;
			return Math.min(360, Math.max(160, Math.round(width)));
		}
		/** 拖动增量 → 新列宽（先归一再夹取，避免从 NaN 起点一路 NaN）。 */
		function nextListWidth(current, deltaPx) {
			return clampListWidth(clampListWidth(current) + (Number.isFinite(deltaPx) ? deltaPx : 0));
		}
		function flowNodeViewOf(node) {
			const full = tokenTextOf(node.usage);
			const durationText = durationTextOf(node.duration);
			const roleText = (node.roleName ?? "").trim() || "角色未记录";
			const status = statusBadge(node.status);
			const tokenNote = node.usage !== void 0 && node.usage.source === "provider" ? "" : `（${tokenTitleOf(node.usage)}）`;
			return {
				tokenText: full,
				durationText,
				roleText,
				taskTitle: node.title,
				text: `${full} · ${durationText}`,
				statusText: status.text,
				tone: status.tone,
				title: `${node.id} ${node.title} · 角色 ${roleText} · token ${full}${tokenNote} · 用时 ${durationText}`,
				label: `${node.id}：${node.title}，${status.text}，token ${full}${tokenNote}，用时 ${durationText}`
			};
		}
		/**
		* 角色任务引用 → chip 视图（唯一派生点，RoleCard 只渲染）。
		*
		* 文案只写 `tN`，状态中文只取 `statusBadge().text`（`done` = 「已通过」），
		* 不另造「已完成/未开始」第二套词；彩点颜色由 `tone` 决定，与角色卡状态点同族。
		*/
		function roleTaskRefViewOf(ref) {
			const badge = statusBadge(ref.status);
			const text = `${ref.id} · ${badge.text}`;
			return {
				id: ref.id,
				status: ref.status,
				tone: badge.tone,
				text: ref.id,
				title: text,
				label: text
			};
		}
		/**
		* 流转图布局（r16 AC-12/AC-13 的唯一派生点）。
		*
		* 列不再等于依赖深度，而是**角色**：按 `roleId → roleName → 「角色未记录」` 建组，
		* 首次出现决定列序；组内按计划顺序排行。旧快照没有 `roleId` 时回退 `roleName`，
		* 两者都没有才落单列。`node.column/node.row` 与 `flow.columns/flow.rows` 一律不读 ——
		* 同一个任务图在两个客户端版本里不能有两种列序。
		*
		* 节点边（依赖）仍是三次贝塞尔，端点缺失或环依赖直接跳过，绝不产生 NaN。
		*/
		function flowLayoutOf(flow) {
			const keys = [];
			const groups = /* @__PURE__ */ new Map();
			for (const node of flow.nodes) {
				const key = node.roleId ?? node.roleName ?? "角色未记录";
				const list = groups.get(key);
				if (list === void 0) {
					keys.push(key);
					groups.set(key, [node]);
				} else list.push(node);
			}
			const stages = keys.map((key, index) => {
				const list = groups.get(key) ?? [];
				const first = list[0];
				const stage = {
					key,
					index,
					name: (first?.roleName ?? "").trim() || first?.roleId || "角色未记录",
					count: list.length,
					x: 12 + index * 208,
					y: 12,
					allDone: list.every((node) => node.status === "done")
				};
				if (first?.roleId !== void 0) stage.roleId = first.roleId;
				return stage;
			});
			let maxCount = 0;
			for (const stage of stages) maxCount = Math.max(maxCount, stage.count);
			const stageIndex = new Map(stages.map((stage) => [stage.key, stage]));
			const cursors = /* @__PURE__ */ new Map();
			const nodes = flow.nodes.map((node) => {
				const key = node.roleId ?? node.roleName ?? "角色未记录";
				const column = stageIndex.get(key)?.index ?? 0;
				const row = cursors.get(key) ?? 0;
				cursors.set(key, row + 1);
				return {
					node,
					cell: flowNodeViewOf(node),
					column,
					row,
					x: 12 + column * 208,
					y: 54 + row * 80
				};
			});
			const byId = new Map(nodes.map((entry) => [entry.node.id, entry]));
			const edges = [];
			for (const edge of flow.edges) {
				const from = byId.get(edge.from);
				const to = byId.get(edge.to);
				if (!from || !to) continue;
				const x1 = from.x + 180;
				const y1 = from.y + 32;
				const x2 = to.x - 2;
				const y2 = to.y + 32;
				const bend = Math.max(24, Math.abs(x2 - x1) / 2);
				edges.push({
					key: `${edge.from}->${edge.to}`,
					d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
					upstreamDone: edge.upstreamDone
				});
			}
			const stageLinks = [];
			for (let i = 1; i < stages.length; i += 1) {
				const prev = stages[i - 1];
				const cur = stages[i];
				if (prev === void 0 || cur === void 0) continue;
				const from = prev.x + 180 + 4;
				const to = cur.x - 4;
				stageLinks.push({
					key: `${prev.key}->${cur.key}`,
					from,
					to,
					d: `M ${from} 28 L ${to} 28`,
					upstreamDone: prev.allDone
				});
			}
			return {
				width: stages.length === 0 ? 24 : 204 + (stages.length - 1) * 208,
				height: stages.length === 0 ? 24 : 118 + (maxCount - 1) * 80 + 12,
				nodes,
				edges,
				stages,
				stageLinks
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
		/**
		* 主题标题：与宿主目录的标题保持一致，仅用于展示。
		*
		* 注意：这里**不解析 md、不拼来源/时间/修正次数** —— 那些一律用宿主下发的
		* `MemoryEntryView.text / sourceText / stamp / revisions`，避免客户端与宿主各写一套格式。
		*/
		const MEMORY_TOPIC_LABELS = {
			conventions: "团队约定",
			architecture: "架构与契约",
			commands: "构建与门禁命令",
			pitfalls: "失败与教训",
			workflow: "流程与协作",
			ui: "界面与样式",
			host: "宿主集成",
			domain: "业务与项目"
		};
		/** 旧快照没有 `quotas` 时的兜底上限：与宿主 `PROJECT_MAX_FILES` / `PUBLIC_MAX_FILES` 同口径。 */
		const MEMORY_DEFAULT_MAX_FILES = {
			project: 8,
			public: 6
		};
		/** 旧快照没有 `maxEntriesPerFile` 时的兜底上限（宿主 `ENTRIES_PER_FILE`）。 */
		const MEMORY_DEFAULT_MAX_ENTRIES = 40;
		/**
		* 配额行：宿主只给数字，中文提示在这里单点拼。
		*
		* `quota` 缺省（旧快照）时用 `files` 的 canonical 计数兜底；**不猜**未下发的上限，
		* 只退回与宿主常量同口径的默认值，并在提示里明确这是「未下发」而不是真实统计。
		*/
		function memoryQuotaRowOf(track, quota, files, legacyFileCount) {
			const canonical = files.filter((file) => file.track === track && file.canonical && !file.legacy);
			const fallbackFiles = canonical.length;
			const fallbackEntries = canonical.reduce((sum, file) => sum + (usableNumber(file.active) ? file.active : 0), 0);
			const maxFiles = usableNumber(quota?.maxFiles) && quota.maxFiles > 0 ? Math.round(quota.maxFiles) : MEMORY_DEFAULT_MAX_FILES[track];
			const count = usableNumber(quota?.files) ? Math.round(quota.files) : fallbackFiles;
			const totalEntries = usableNumber(quota?.totalEntries) ? Math.round(quota.totalEntries) : fallbackEntries;
			const maxEntriesPerFile = usableNumber(quota?.maxEntriesPerFile) && quota.maxEntriesPerFile > 0 ? Math.round(quota.maxEntriesPerFile) : MEMORY_DEFAULT_MAX_ENTRIES;
			const nearFiles = quota === void 0 ? count >= maxFiles - 1 : quota.nearFiles === true;
			const overFiles = quota === void 0 ? count > maxFiles : quota.overFiles === true;
			const nearFullFiles = Array.isArray(quota?.nearFullFiles) ? quota.nearFullFiles.filter((name) => typeof name === "string") : [];
			const fullFiles = Array.isArray(quota?.fullFiles) ? quota.fullFiles.filter((name) => typeof name === "string") : [];
			const legacy = usableNumber(legacyFileCount) ? Math.round(legacyFileCount) : 0;
			const warnings = [];
			if (overFiles) warnings.push({
				key: "over-files",
				tone: "danger",
				text: `主题文件数 ${count}/${maxFiles} 已超出上限：请手工删除多余的主题文件`
			});
			else if (nearFiles) warnings.push({
				key: "near-files",
				tone: "warn",
				text: `主题文件数 ${count}/${maxFiles} 已接近上限：继续沉淀会先淘汰旧条目`
			});
			if (fullFiles.length > 0) warnings.push({
				key: "full-files",
				tone: "warn",
				text: `${fullFiles.join("、")} 已满 ${maxEntriesPerFile} 条：新写入会先淘汰最旧的 P2`
			});
			if (nearFullFiles.length > 0) warnings.push({
				key: "near-full-files",
				tone: "warn",
				text: `${nearFullFiles.join("、")} 接近满（${maxEntriesPerFile} 条上限）：建议清理低优先级条目，或把要保留的升为 P0`
			});
			const tone = overFiles ? "danger" : warnings.some((item) => item.tone === "warn") ? "warn" : "ok";
			return {
				track,
				files: count,
				maxFiles,
				totalEntries,
				maxEntriesPerFile,
				text: `${track === "public" ? "公共记忆" : "项目记忆"} ${count}/${maxFiles} · ${totalEntries} 条`,
				tone,
				warnings,
				legacyFileCount: legacy
			};
		}
		/** 单个记忆文件的行文案：等级分布与条目数全部来自 `file.levels / active / superseded`。 */
		function memoryFileRowOf(file) {
			const label = file.topic === null ? "" : MEMORY_TOPIC_LABELS[file.topic] ?? "";
			const active = usableNumber(file.active) ? Math.max(0, Math.round(file.active)) : 0;
			const superseded = usableNumber(file.superseded) ? Math.max(0, Math.round(file.superseded)) : 0;
			const distributionText = memoryLevelsTextOf(file.levels ?? {
				P0: 0,
				P1: 0,
				P2: 0
			});
			const meta = [file.name];
			if (file.readOnly) meta.push("只读（手工维护）");
			else if (!file.canonical) meta.push("非主题文件");
			return {
				key: `${file.track}/${file.name}`,
				name: file.name,
				title: label !== "" ? label : file.name,
				distributionText,
				distributionTitle: "活动条目的等级分布：P0 铁律 / P1 教训 / P2 常规",
				countText: superseded > 0 ? `活动 ${active} 条 · 已作废 ${superseded}` : `活动 ${active} 条`,
				metaText: meta.join(" · "),
				readOnly: file.readOnly === true,
				active,
				superseded
			};
		}
		function memoryLevelsTextOf(levels) {
			const parts = [];
			for (const level of [
				"P0",
				"P1",
				"P2"
			]) {
				const value = levels[level];
				const count = usableNumber(value) ? Math.max(0, Math.round(value)) : 0;
				if (count > 0) parts.push(`${level} ${count}`);
			}
			return parts.length === 0 ? "暂无活动条目" : parts.join(" · ");
		}
		function memoryEntryRowOf(entry) {
			const level = entry.level === "P0" || entry.level === "P1" ? entry.level : "P2";
			const text = typeof entry.text === "string" ? entry.text : "";
			const sourceText = typeof entry.sourceText === "string" ? entry.sourceText : "";
			return {
				key: typeof entry.id === "string" && entry.id !== "" ? entry.id : `${entry.file}:${entry.at}:${entry.level}`,
				id: typeof entry.id === "string" ? entry.id : "",
				level,
				levelText: level,
				text: text.trim() === "" ? "（空条目）" : text,
				sourceText: sourceText.trim() === "" ? `来源：${entry.source}` : sourceText,
				revisions: usableNumber(entry.revisions) ? Math.max(1, Math.round(entry.revisions)) : 1,
				superseded: entry.superseded === true,
				supersededText: "已作废",
				tone: level === "P0" ? "strong" : level === "P1" ? "normal" : "muted"
			};
		}
		/** 活动/已作废分栏：宿主字段直接过滤，不解析正文。 */
		function memoryEntriesOf(entries) {
			const active = [];
			const superseded = [];
			for (const entry of entries) {
				const row = memoryEntryRowOf(entry);
				if (row.superseded) superseded.push(row);
				else active.push(row);
			}
			return {
				active,
				superseded
			};
		}
		/** 整理报告：dry-run 只报「将新增 / 已存在 / 已满」，执行完才显示已写入。 */
		function memoryCurationReportOf(report) {
			const preview = report.dryRun === true;
			const added = usableNumber(report.added) ? Math.max(0, Math.round(report.added)) : 0;
			const extracted = usableNumber(report.extracted) ? Math.max(0, Math.round(report.extracted)) : 0;
			const scanned = usableNumber(report.scannedFiles) ? Math.max(0, Math.round(report.scannedFiles)) : 0;
			const skippedExisting = usableNumber(report.skippedExisting) ? Math.max(0, Math.round(report.skippedExisting)) : 0;
			const skippedFull = usableNumber(report.skippedFull) ? Math.max(0, Math.round(report.skippedFull)) : 0;
			const skippedInvalid = usableNumber(report.skippedInvalid) ? Math.max(0, Math.round(report.skippedInvalid)) : 0;
			const target = report.target;
			const counts = [
				`扫描旧流水 ${scanned} 个文件`,
				`提取 ${extracted} 条`,
				`已存在 ${skippedExisting} 条`,
				`已满跳过 ${skippedFull} 条`
			];
			if (skippedInvalid > 0) counts.push(`无法解析 ${skippedInvalid} 个文件`);
			if (target !== void 0 && typeof target.name === "string") counts.push(`目标 ${target.name}：${target.before} → ${target.after} 条`);
			const warnings = Array.isArray(report.warnings) ? report.warnings.filter((item) => typeof item === "string" && item.trim() !== "") : [];
			return {
				phase: preview ? "preview" : "done",
				headline: preview ? `预演完成：将新增 ${added} 条 P1 教训` : added > 0 ? `整理完成：新增 ${added} 条 P1 教训` : "整理完成：没有需要新增的条目",
				counts,
				warnings,
				canApply: preview && added > 0,
				applyLabel: `确认写入 ${added} 条`,
				closeLabel: preview ? "取消预览" : "关闭报告"
			};
		}
		/**
		* `act({type:'curateMemory'})` 的解包口（`feedbackOf` 的姊妹函数）。
		*
		* 为什么要单独一个：整理报告在 `ActResult.curation`，而 `feedbackOf` 会把它丢掉；
		* 组件里直接 `result.data.curation` 又会让「整包赋值」那一族 bug 复活。
		*/
		function memoryCurationOutcomeOf(result) {
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
					message: message !== "" ? message : code !== "" ? code : "整理被拒绝",
					notices
				};
			}
			const report = payload.curation;
			if (report === null || report === void 0 || typeof report !== "object") return {
				ok: true,
				notices
			};
			const typed = report;
			if (typed.ok === false) return {
				ok: false,
				message: (Array.isArray(typed.warnings) ? typed.warnings.find((item) => typeof item === "string") : void 0) ?? "整理失败",
				report: typed,
				notices
			};
			return {
				ok: true,
				report: typed,
				notices
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
			},
			closeRun: {
				title: "终止残留计划",
				action: "终止计划",
				confirm: "终止计划",
				object: "run"
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
			if (typeof task.revisedAt === "number") detail.revisedAt = task.revisedAt;
			if (typeof task.revisionNote === "string") detail.revisionNote = task.revisionNote;
			if (typeof task.cancelledAt === "number") detail.cancelledAt = task.cancelledAt;
			if (typeof task.cancelReason === "string") detail.cancelReason = task.cancelReason;
			if (task.cancelledBy !== void 0) detail.cancelledBy = task.cancelledBy;
			return detail;
		}
		/**
		* 依赖拓扑 → 流转图。列 = 最长依赖深度（0 起），行 = 同列内计划顺序。
		*
		* 环（坏计划 / 历史脏数据）不能让渲染死循环：遇到回边按深度 0 处理，图仍然画得出来。
		*/
		function buildFlow(tasks, cells = {}, roleNameOf) {
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
					roleId: task.roleId,
					column,
					row,
					usage: usageCellOr(cells.usage?.[task.id], "该任务没有可用用量事件"),
					duration: cells.durations?.[task.id] ?? fallbackDurationOf(progressOf(task).status)
				};
				if (roleNameOf !== void 0) node.roleName = roleNameOf(task.roleId);
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
		/**
		* 逐角色聚合：只列真正有任务的角色（没任务的角色不占位置）。
		*
		* r14 AC-7/AC-8/AC-9：状态 / 当前任务 / 用时走 `shared/role-view.ts#roleStateOf`，
		* 用量走同文件的 `roleUsageCellOf` —— 与宿主 `library.rolesOf` **同一份实现**，
		* 所以右栏与抽屉里的文案逐字相等（AC-17）。r13 里这里另写了一份「部分缺失即不可得」
		* 的合计，宿主却把已知项加起来（QA D2），两边因此对同一张角色卡说两种话。
		*/
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
				const known = roles.find((role) => role.id === roleId);
				const state = roleStateOf(list);
				const view = {
					roleId,
					name: known?.name ?? list[0]?.roleName ?? roleId,
					tasks: list.length,
					usage: roleUsageCellOf(list.map((task) => task.usage)),
					done: state.done,
					state: state.state,
					stateText: state.stateText,
					duration: state.duration,
					taskRefs: list.map((task) => ({
						id: task.id,
						status: task.status
					}))
				};
				if (state.activeTaskId !== void 0) view.activeTaskId = state.activeTaskId;
				if (state.activeTaskTitle !== void 0) view.activeTaskTitle = state.activeTaskTitle;
				return view;
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
			const taskUsageCells = taskViews.map((task) => task.usage);
			const aggregatedUsage = sumUsage(taskUsageCells, "该 run 没有可用用量事件");
			const hasTaskUsage = taskUsageCells.some((cell) => cell.source === "provider" && cell.tokens !== void 0);
			const usage = snapshot.runUsage?.source === "provider" ? snapshot.runUsage : aggregatedUsage.source === "provider" || hasTaskUsage ? aggregatedUsage : snapshot.runUsage ?? aggregatedUsage;
			const detail = {
				runId: snapshotRunId,
				sessionId: "",
				planStatus: snapshot.planStatus ?? "draft",
				usage,
				duration,
				roles: roleUsageOf(taskViews, roles),
				tasks: taskViews,
				flow: buildFlow(tasks, {
					usage: snapshot.taskUsage,
					durations: snapshot.taskDurations
				}, roleNameOf)
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
			const status = enabled ? planPillText(input) : runStageOf({}).label;
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
			const done = countOf$1(input.done);
			const total = countOf$1(input.total);
			const status = planPillText(input);
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
			const builtinRoles = countOf$1(input.builtinRoles);
			const customRoles = countOf$1(input.customRoles);
			const userSkills = countOf$1(input.userSkills);
			const builtinSkills = countOf$1(input.builtinSkills);
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
		* 胶囊/角标的状态段：文案只由 `runStageOf`（阶段判定表）派生，本函数不写状态中文。
		*  - 无计划 → 待开工（与「未启用」同义的输入框措辞，壳层语义见调用方注释）；
		*  - 暂停/已终止/已取消 → 阶段文案本身（没有进度可言）；
		*  - 全部完成 → `完成 x/N`（进度措辞；任务全绿时先说「完成」，阶段细节仍由面板承载）；
		*  - 其余 → `runStageOf(...).label`（派发中/执行中/待收口/计划就绪/待派发）。
		*
		* 「计划就绪」只可能来自规则 10：`draft + 零成员 + 零完成`。计数缺失时不会命中，
		* 因此不会再把「draft + 部分完成」误写成「计划就绪 · N 任务」（r26 修）。
		*/
		function planPillText(input) {
			if (!input.planStatus) return "待开工";
			const stage = runStageOf(input);
			if (stage.key === "paused" || stage.key === "terminated" || stage.key === "cancelled") return stage.label;
			const done = countOf$1(input.done);
			const total = countOf$1(input.total);
			if (total > 0 && done >= total) return `完成 ${done}/${total}`;
			return stage.label;
		}
		function str(value) {
			return typeof value === "string" ? value : "";
		}
		/** 计数兜底：非数字/负数/NaN 一律 0（宿主字段缺失时不许把界面算成 NaN/undefined）。 */
		function countOf$1(value) {
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
			const enabled = snapshot?.enabled === true;
			const ui = optionView({
				enabled,
				busy,
				...currentRunStageInputOf(snapshot),
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
			const stage = currentRunStageInputOf(snapshot);
			const hasOpen = typeof props.openPanel === "function";
			const hasClose = typeof props.closePanel === "function";
			const opened = (typeof props.isPanelOpen === "function" ? props.isPanelOpen() : void 0) ?? (closeRefused.current ? true : localOpen);
			const ui = headerButtonView({
				enabled: snapshot?.enabled === true,
				...stage,
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
			const badge = input.badge ?? statusBadge(input.status);
			const view = {
				runId: input.runId,
				title: input.title,
				titleSource: input.titleSource ?? "fallback",
				metaText: input.metaText,
				statusText: badge.text,
				statusTone: badge.tone,
				statusIcon: badge.icon,
				tokenText: tokenTextOf(input.usage),
				tokenTitle: tokenTitleOf(input.usage),
				tokenSource: input.usage.source,
				usageMetrics: usageMetricsOf(input.usage),
				durationText: durationTextOf(input.duration),
				durationTitle: input.durationTitle ?? durationTitleOf(input.duration),
				durationState: input.duration.state,
				active: input.active
			};
			if (input.titleTitle !== void 0) view.titleTitle = input.titleTitle;
			if (input.statusTitle !== void 0) view.statusTitle = input.statusTitle;
			if (input.terminationText !== void 0 && input.terminationText.trim() !== "") view.terminationText = input.terminationText.trim();
			if (input.residualBadge !== void 0) view.residualBadge = input.residualBadge;
			return view;
		}
		/**
		* 历史行的用量单元格：宿主派生的 `usage` 优先（含 `text` + 六项 `details`）；
		* 旧快照只有 `usageTotals` 时退回合计，**不**在客户端拆六项（六项文案的单一来源是宿主）。
		*/
		function summaryUsageOf(run) {
			if (run.usage !== void 0) return run.usage;
			if (run.usageTotals !== void 0 && typeof run.usageTotals.total === "number") return {
				source: "provider",
				tokens: run.usageTotals
			};
			return {
				source: "unavailable",
				reason: "该次运行没有用量记录"
			};
		}
		/**
		* 历史列表行的用时（r20）。
		*
		* 这里**没有**宿主下发的 `DurationCell`：`RunSummary`（`shared/types.ts:667`）只有
		* `plannedAt`/`finishedAt`，宿主 `bridge.historyOf` 也只额外派生了 `usage`。
		* 但 r20 t1 已经把 `finishedAt` 补成可核实值（终态落盘优先，历史 run 用
		* `store.finishedAtOf` 回退），所以列表行可以用**宿主给的时间戳 + shared/duration.ts
		* 的唯一实现**算出同一个单元格 —— 不是第二套格式化，也没有 0 或估算补位：
		*  - 没有 `plannedAt`（旧 run）→ 不可得；
		*  - 终态（cancelled/terminated）但没有 `finishedAt` → 不可得（不算到「现在」）；
		*  - 有 `finishedAt` → done；否则 running（按 `now` 计时）。
		*
		* 策略与宿主 `library.durationOfSummary` 逐条对齐（同一份判定，避免两端口径漂移）。
		*/
		function historyDurationOf(run, now) {
			if (run.plannedAt === void 0) return durationCellOf({
				state: "unavailable",
				now
			});
			const ended = run.finishedAt !== void 0;
			const terminal = run.status === "cancelled" || run.status === "terminated";
			if (!ended && terminal) return durationCellOf({
				startAt: run.plannedAt,
				state: "unavailable",
				now
			});
			return durationCellOf({
				startAt: run.plannedAt,
				...ended ? { endAt: run.finishedAt } : {},
				state: ended ? "done" : "running",
				now
			});
		}
		/** 历史行「算不出用时」的具体原因（`durationTitleOf` 的通用文案在这几种情况下不够准）。 */
		function historyDurationTitleOf(cell, run) {
			if (cell.state !== "unavailable") return durationTitleOf(cell);
			if (run.plannedAt === void 0) return "该次运行没有记录开始时刻（旧数据），算不出用时";
			if (run.finishedAt === void 0) return "该次运行没有结束时刻（宿主未落盘），算不出用时";
			return durationTitleOf(cell);
		}
		/**
		* 历史列表行（右栏「历史」页）—— 数据来自 `snapshot.runs` / `library.runs`（`RunSummary`）。
		*
		* r17：顶部是「任务名」（run 级 goal；缺省走 `goalTitleOf` 的诚实 fallback），
		* 底部是 token 六项（`RunSummary.usage.details`，宿主 `format.ts` 单一来源，客户端只透传）。
		* 旧数据没有 `usage` 时退回 `usageTotals`：只显示合计，不自己拆六项。
		* r20：次行补上用时（`historyDurationOf`，宿主时间戳 + shared 唯一实现；缺值即不可得）。
		*/
		function runSummaryRowOf(run, now = Date.now()) {
			const goal = goalTitleOf(run.goal, run.runId);
			const start = formatStamp(run.plannedAt ?? run.createdAt);
			const live = run.active === true && !isClosedRun(run);
			const end = live ? "进行中" : formatStamp(run.finishedAt);
			const duration = historyDurationOf(run, now);
			const stage = runStageOf({
				planStatus: run.status,
				total: run.tasks,
				done: run.done,
				...run.running !== void 0 ? { running: run.running } : {},
				...run.failed !== void 0 ? { failed: run.failed } : {},
				...run.interrupted !== void 0 ? { interrupted: run.interrupted } : {},
				...run.members !== void 0 ? { members: run.members } : {},
				...run.terminationReason !== void 0 ? { terminationReason: run.terminationReason } : {},
				...run.finishedAt !== void 0 ? { finishedAt: run.finishedAt } : {}
			});
			return rowOf({
				runId: run.runId,
				title: goal.text,
				titleSource: goal.source,
				titleTitle: goal.title,
				metaText: `开始 ${start} · 结束 ${end} · 任务 ${run.done}/${run.tasks}`,
				status: run.status,
				badge: runStageBadge(stage),
				...stage.detail !== void 0 ? { statusTitle: stage.detail } : {},
				usage: summaryUsageOf(run),
				duration,
				durationTitle: historyDurationTitleOf(duration, run),
				active: live,
				...run.terminationReason !== void 0 ? { terminationText: run.terminationReason } : {},
				...isResidualRun(run) ? { residualBadge: RESIDUAL_RUN_BADGE } : {}
			});
		}
		/** 项目库里的「最近 run」行（左栏）—— 数据来自 `ProjectRunSummaryView`，用量/用时都是宿主算好的单元格。 */
		function projectRunRowOf(run) {
			const start = formatStamp(run.plannedAt);
			const end = formatStamp(run.finishedAt);
			const goal = goalTitleOf(run.goal, run.runId);
			const stage = runStageOf({
				planStatus: run.planStatus,
				total: run.tasks,
				done: run.done,
				...run.finishedAt !== void 0 ? { finishedAt: run.finishedAt } : {}
			});
			return rowOf({
				runId: run.runId,
				title: goal.text,
				titleSource: goal.source,
				titleTitle: goal.title,
				metaText: `开始 ${start} · 结束 ${end} · 任务 ${run.done}/${run.tasks}`,
				status: run.planStatus,
				badge: runStageBadge(stage),
				...stage.detail !== void 0 ? { statusTitle: stage.detail } : {},
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
		// src/client/nav.ts
		/** 稳定的「项目库」对象：订阅方可用引用相等快速判断。 */
		const LIBRARY_NAV = { kind: "library" };
		let currentNav = LIBRARY_NAV;
		const navListeners = /* @__PURE__ */ new Set();
		/** 当前主界面视图（`useSyncExternalStore` 的 getSnapshot）。 */
		function mainNavView() {
			return currentNav;
		}
		/** 订阅导航变化；返回取消订阅函数。 */
		function subscribeMainNav(listener) {
			navListeners.add(listener);
			return () => {
				navListeners.delete(listener);
			};
		}
		function setNav(next) {
			currentNav = next;
			for (const listener of [...navListeners]) try {
				listener();
			} catch (error) {
				if (typeof console !== "undefined" && typeof console.warn === "function") console.warn("[dsh-auto-team] 导航订阅回调异常", error);
			}
			return currentNav;
		}
		/**
		* 主界面切到某个成员（空 memberId = 回项目库，避免把空页签当成成员页）。
		*
		* `sessionId` 只在**非空**时写进导航状态：缺省 / 空串都不写这个键，
		* 这样 `mainNavView()` 的 deepEqual 不会因为一个空字段而漂移。
		*/
		function openMemberNav(memberId, taskId, sessionId) {
			const id = typeof memberId === "string" ? memberId.trim() : "";
			if (id === "") return openLibraryNav();
			const session = typeof sessionId === "string" ? sessionId.trim() : "";
			if (typeof taskId === "string" && taskId.trim() !== "") return setNav(session === "" ? {
				kind: "member",
				memberId: id,
				taskId: taskId.trim()
			} : {
				kind: "member",
				memberId: id,
				taskId: taskId.trim(),
				sessionId: session
			});
			return setNav(session === "" ? {
				kind: "member",
				memberId: id
			} : {
				kind: "member",
				memberId: id,
				sessionId: session
			});
		}
		/** 主界面切回项目库。 */
		function openLibraryNav() {
			return setNav(LIBRARY_NAV);
		}
		/**
		* 点角色卡 / 任务行 / 流程图节点的唯一入口：先切主界面视图，再请求打开项目库主区。
		*
		* 顺序不能反——`requestLibrarySurface` 可能在 500ms 后降级到右栏内联，
		* 那时主界面必须已经是成员页，否则内联里会闪一下项目库再跳。
		*/
		function navigateToMember(sessionId, memberId, taskId) {
			return {
				nav: openMemberNav(memberId, taskId, sessionId),
				surface: requestLibrarySurface(sessionId)
			};
		}
		/**
		* 成员页该用哪个会话的快照。
		*
		* 优先级：**导航里记下的来源会话** > slot props 的会话。
		* 宿给 `main` 槽位的 props 没有 sessionId，`sessionIdOf(props)` 会退回 `'current'`，
		* 那份快照里通常没有这个成员；导航记住了来源会话时以它为准。
		*/
		function resolveMemberSessionId(propsSessionId, nav) {
			if (nav.kind === "member" && typeof nav.sessionId === "string" && nav.sessionId.trim() !== "") return nav.sessionId;
			return propsSessionId;
		}
		/**
		* 导航是否「陈旧」：props 给的是**真实会话**，而成员页是在**另一个会话**里打开的。
		*
		* `'current'` 是「宿主没告诉我们」的哨兵，不算真实会话 —— 主界面正是靠这个哨兵
		* 落到导航会话上，不能反过来判成陈旧。
		*/
		function isStaleMemberNav(propsSessionId, nav) {
			const propsSession = typeof propsSessionId === "string" ? propsSessionId.trim() : "";
			if (propsSession === "" || propsSession === "current") return false;
			if (nav.kind !== "member") return false;
			if (typeof nav.sessionId !== "string" || nav.sessionId.trim() === "") return false;
			return nav.sessionId.trim() !== propsSession;
		}
		function latestOf(list) {
			let best = list[0];
			for (const member of list) if (member.lastEventAt > best.lastEventAt) best = member;
			else if (member.lastEventAt === best.lastEventAt && member.memberId < best.memberId) best = member;
			return best;
		}
		/**
		* 给一个计划任务找执行它的成员。
		*
		* 优先级：**明确绑定了该 taskId 的成员** > 正在跑的成员 > 最近活跃的成员。
		* 角色可能先后有多个成员（返工/续聊会新建），所以不能按 roleId 取第一个。
		*/
		function memberForRole(members, roleId, taskId) {
			const list = Array.isArray(members) ? members.filter((member) => member.roleId === roleId) : [];
			if (list.length === 0) return void 0;
			if (typeof taskId === "string" && taskId !== "") {
				const bound = list.filter((member) => member.taskId === taskId);
				if (bound.length > 0) return latestOf(bound);
			}
			const running = list.filter((member) => member.status === "running");
			if (running.length > 0) return latestOf(running);
			return latestOf(list);
		}
		/**
		* 一个 run 还剩几个非终态任务（= 用户口径里的「进行中」）。
		*
		* 宿主并行任务 t1 起在 `RunSummary` 上派生 `ongoing`（非终态任务数）。
		* 本文件不依赖 `types.ts` 已合入该字段：显式值优先，缺省时按
		* `active === true && done < tasks` 兜底（与宿主「非终态」同一口径，不重算任务状态）。
		*
		* r25：已收口的 run（terminated/cancelled，或带 terminationReason + finishedAt）
		* **一律返回 0** —— 旧数据/旧宿主可能还下发 `ongoing > 0`，但终态 run 绝不能
		* 显示成「进行中」；这是与宿主 `PLAN_TERMINAL_STATUSES` 修正并行的双保险。
		*/
		function ongoingCountOf(run) {
			if (isClosedRun(run)) return 0;
			const explicit = run.ongoing;
			if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) return explicit;
			if (run.active === true && run.done < run.tasks) return run.tasks - run.done;
			return 0;
		}
		/** 按 `plannedAt ?? createdAt` 取最新的一条（相同时间保留先出现的，排序稳定）。 */
		function latestRunOf(runs) {
			let best = runs[0];
			for (const run of runs) if ((run.plannedAt ?? run.createdAt) > (best.plannedAt ?? best.createdAt)) best = run;
			return best;
		}
		/** 计数兜底：缺失 / NaN / 负数 / 非数字一律 0（卡内不出现 `NaN` / `undefined`）。 */
		function countOf(value) {
			return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
		}
		/**
		* r18b t11：卡内 meta 行的**紧凑全文**（唯一的格式化点）。
		*
		* - 未结束（`finishedAt` 缺失 / 非正数）：`13:35:00 起 · 进行中 · 任务 0/1`
		* - 已结束：`13:35:00 → 13:58:12 · 任务 1/1`
		* - 已收口但没有结束时刻（r25 旧数据）：`13:35:00 起 · 已终止 · 任务 0/1`
		*   —— 绝不能把终态 run 写成「进行中」。
		*
		* 用 `formatClock`（`HH:MM:SS`）而不是 `formatStamp`（`MM-DD HH:MM:SS`）是宽度预算决定的：
		* 196px 内容宽、11px 字号下，最长一条约 26 字符（两个 8 字符时钟 + 4 个 ` 起 · ` 类片段
		* + `任务 12/34`）刚好放得下；带日期则多 6 字符，必然省略号截断（真机证据见
		* `docs/teamflow/2026-11-05-r18b-run-rows/t11-card-meta.md`）。
		*/
		function cardMetaTextOf(run) {
			const start = formatClock$1(run.plannedAt ?? run.createdAt);
			const done = countOf(run.done);
			const tasks = countOf(run.tasks);
			const finishedAt = run.finishedAt;
			if (typeof finishedAt === "number" && Number.isFinite(finishedAt) && finishedAt > 0) return `${start} → ${formatClock$1(finishedAt)} · 任务 ${done}/${tasks}`;
			const stage = runStageOf({
				planStatus: run.status,
				total: run.tasks,
				done: run.done,
				...run.running !== void 0 ? { running: run.running } : {},
				...run.failed !== void 0 ? { failed: run.failed } : {},
				...run.interrupted !== void 0 ? { interrupted: run.interrupted } : {},
				...run.members !== void 0 ? { members: run.members } : {},
				...run.terminationReason !== void 0 ? { terminationReason: run.terminationReason } : {},
				...run.finishedAt !== void 0 ? { finishedAt: run.finishedAt } : {}
			});
			if (stage.key === "running" || stage.key === "dispatching") return `${start} 起 · 进行中 · 任务 ${done}/${tasks}`;
			return `${start} 起 · ${stage.label}`;
		}
		/**
		* 任务页顶部的 run 行投影。
		*
		* 规则（用户 2026-11-05 口径）：
		*  ① 候选 = 本会话 `runs` 里 `ongoing > 0` 的 run，按 `plannedAt ?? createdAt` 倒序；
		*  ② 没有候选时，只显示「最后一个 run」（按同一时间字段取最新的一条）；
		*  ③ `runs` 为空（未启用 / 快照未到）→ 返回 `null`，调用方不渲染这一块。
		*
		* 选中语义：`selected = (source.selectedRunId || currentRunId) === run.runId`。
		* 选中的 run 不在候选里时**不会**被塞进来 —— 这里是「进行中 run 的状态位」，
		* 不是完整切换器；历史 run 仍从历史页进入（见 `HistoryTab`）。
		*/
		function activeRunRowsOf(source) {
			const snapshot = source.snapshot ?? null;
			const runs = Array.isArray(snapshot?.runs) ? snapshot.runs : [];
			if (runs.length === 0) return null;
			const currentRunId = typeof snapshot?.runId === "string" && snapshot.runId !== "" ? snapshot.runId : runs.find((run) => run.active === true)?.runId ?? "";
			const storeSelected = typeof source.selectedRunId === "string" && source.selectedRunId.trim() !== "" ? source.selectedRunId : "";
			const selectedRunId = storeSelected !== "" ? storeSelected : currentRunId;
			const ongoing = runs.filter((run) => ongoingCountOf(run) > 0);
			const fallback = ongoing.length === 0;
			return {
				rows: (fallback ? [latestRunOf(runs)] : [...ongoing].sort((a, b) => (b.plannedAt ?? b.createdAt) - (a.plannedAt ?? a.createdAt))).map((run) => {
					const hasOngoing = ongoingCountOf(run) > 0;
					return {
						...runSummaryRowOf(run),
						cardMetaText: cardMetaTextOf(run),
						current: run.runId === currentRunId,
						selected: run.runId === selectedRunId,
						hasOngoing
					};
				}),
				selectedRunId,
				currentRunId,
				fallback
			};
		}
		/**
		* 任务页空态文案（r17 D3）：历史详情读不到（被清理 / 404 / 网络失败）时，
		* 不能再沿用「正在读取历史 run…」——那会让用户一直等一个永远不会来的响应。
		*
		* `libraryError` 只在**选中历史 run 且详情为空**时有意义；当前 run 的空态是
		* 「尚未生成计划」，与读取失败无关。
		*/
		function tasksEmptyStateOf(input) {
			if (input.historicalRunId === null) return {
				title: "尚未生成计划",
				hint: "告诉队长要达成的目标，计划落盘后会自动开跑",
				next: "对队长说一句话即可"
			};
			if (input.libraryError !== null) return {
				title: "读不到这条历史 run",
				hint: input.libraryError,
				next: "返回当前 run 或换一条历史 run"
			};
			return {
				title: "正在读取历史 run…",
				hint: "历史 run 详情会在加载完成后替换这一屏",
				next: "读取中，不用重复点击"
			};
		}
		function latestAuditOf(audits, member) {
			const exact = member.taskId === void 0 ? [] : audits.filter((audit) => audit.taskId === member.taskId);
			const pool = exact.length > 0 ? exact : audits.filter((audit) => audit.roleId === member.roleId);
			let best;
			for (const audit of pool) if (best === void 0 || audit.at >= best.at) best = audit;
			return best;
		}
		function routeAuditViewOf(member, audits) {
			const audit = latestAuditOf(audits, member);
			if (audit === void 0) return void 0;
			const declared = routeTextOf(audit.declared) || member.modelRoute || "会话默认模型";
			const actual = routeTextOf(audit.actual);
			if (audit.verdict === "ok") return {
				verdict: "ok",
				tone: "success",
				text: `声明 ${declared} · 已核对`
			};
			if (audit.verdict === "drift") return {
				verdict: "drift",
				tone: "danger",
				text: `路由漂移：声明 ${declared}，实际 ${actual === "" ? "未知" : actual}`
			};
			return {
				verdict: "unverified",
				tone: "warn",
				text: `声明 ${declared} · 宿主未回传实际路由`
			};
		}
		function memberTaskOf(task) {
			const badge = statusBadge(task.status);
			const evidence = task.evidence;
			return {
				taskId: task.id,
				title: task.title,
				statusText: badge.text,
				statusTone: badge.tone,
				acceptance: task.acceptance?.trim() || "（未声明验收命令）",
				dependsText: task.dependsOn.length > 0 ? task.dependsOn.join(" / ") : "无前置任务",
				scopeText: task.writeScopes !== void 0 && task.writeScopes.length > 0 ? task.writeScopes.join(" / ") : "未声明写域",
				tokenText: tokenTextOf(task.usage),
				tokenTitle: tokenTitleOf(task.usage),
				usageSource: task.usage.source,
				durationText: durationTextOf(task.duration),
				durationTitle: durationTitleOf(task.duration),
				durationState: task.duration.state,
				evidenceText: evidence === void 0 ? "暂无门禁证据" : `${evidence.command} → ${evidence.exitCode === null ? "超时或被信号终止" : `退出码 ${evidence.exitCode}`}`
			};
		}
		/**
		* 子智能体主界面的纯投影。
		*
		* 所有「格式化」都走宿主下发的文本（`tokenText` / `durationText` / `formatStamp`），
		* 这里不算任何毫秒数——零格式化铁律同样适用于成员页。
		*/
		function memberPageOf(source) {
			const { member } = source;
			const role = source.role ?? null;
			const roleDefinition = source.roleDefinition ?? null;
			const task = source.task ?? null;
			const audits = Array.isArray(source.audits) ? source.audits : [];
			const scoped = (Array.isArray(source.messages) ? source.messages : []).filter((message) => member.taskId !== void 0 && message.taskId === member.taskId || message.toMemberId === member.memberId);
			const views = [...scoped].sort((a, b) => b.at - a.at).slice(0, 8).map((message, index) => ({
				messageId: typeof message.messageId === "string" && message.messageId !== "" ? message.messageId : `${message.at}-${index}`,
				fromText: peerLabelOf(message.from),
				toText: message.to,
				atText: formatStamp(message.at),
				body: message.body,
				foldable: ledgerBodyFoldable(message.body)
			}));
			const stalled = member.status === "running" && member.stalled === true;
			const badge = memberStatusBadge(member.status);
			const stoppedSuffix = member.status === "stopped" && typeof member.stoppedAt === "number" && member.stoppedAt > 0 ? ` ${formatStamp(member.stoppedAt)}` : "";
			const roleName = role?.name ?? roleDefinition?.name ?? member.roleId;
			const taskText = task !== null ? `${task.id} · ${task.title}` : member.taskId !== void 0 && member.taskId !== "" ? `任务 ${member.taskId}（不在当前 run 的任务表里）` : "未绑定任务";
			const view = {
				memberId: member.memberId,
				name: member.name,
				statusText: `${badge.text}${stoppedSuffix}`,
				statusTone: badge.tone,
				roleId: member.roleId,
				roleName,
				duty: roleDefinition?.duty?.trim() ?? "",
				modelRoute: member.modelRoute?.trim() || "会话默认模型",
				lastActiveText: formatStamp(member.lastEventAt) || "无活动记录",
				stalled,
				stalledText: stalled ? `⏳ ${member.stalledSecondsText || "—"} 无实质产出` : "",
				stallNote: stalled ? "" : typeof member.stallNote === "string" ? member.stallNote.trim() : "",
				canResume: member.canResume === true,
				resumeText: member.canResume === true ? "可从面板「继续」恢复该成员" : "不可续聊",
				taskText,
				messages: views,
				messageCount: scoped.length,
				emptyMessagesText: member.taskId === void 0 ? "该成员还没有直接消息。" : "还没有与该成员/任务相关的直接消息。"
			};
			const statusTitle = memberStatusTitleOf(member.status);
			if (statusTitle !== void 0) view.statusTitle = statusTitle;
			if (task !== null) view.task = memberTaskOf(task);
			const routeAudit = routeAuditViewOf(member, audits);
			if (routeAudit !== void 0) view.routeAudit = routeAudit;
			return view;
		}
		// src/client/project-filter.ts
		/** 过滤出至少有过一次 run（`runs > 0`）的项目，保持入参顺序。 */
		function visibleProjectsOf(list) {
			return list.filter((project) => project.runs > 0);
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
		// src/client/views/FlowCanvas.tsx
		/**
		* 可平移的无限流转画布（r14 AC-4 / AC-5 / AC-22 · r16 AC-12 / AC-13 / AC-14）。
		*
		* 结构：`[data-flow-canvas]`（固定视口，overflow:hidden、touch-action:none）
		*      → `[data-flow-viewport]`（可平移层，`transform: translate3d(x, y, 0)`）
		*        → edge SVG（任务边 + 列间箭头）+ 角色列头 + 绝对定位节点（180×64）。
		*
		* r16 起列 = **角色**（`01/02` 徽标 + 角色名 + `×N`），列序/行序一律来自
		* `flowLayoutOf()`；组件不读 `node.column/node.row`，也不自己分组 —— 同一任务图
		* 在任何客户端版本里只能有一种列序。节点第一行是 `tN` + 标题 + 状态胶囊，
		* 角色名只由列头承载（节点内不再渲染 `data-flow-node-role`）。
		*
		* 为什么拖动**不走 React state**：60 帧拖动如果每帧 setState，就是 60 次 re-render +
		* 重排，AC-22 的「平均帧间隔 ≤20ms」直接崩。这里 pointermove 只写
		* `viewport.style.transform`（rAF 合帧：一帧最多一次写），`pointerup` 才落 state/ref。
		*
		* 4px 阈值用**累计位移**（`Math.hypot`），不是单帧位移：单帧位移会让慢速拖动一帧一帧地
		* 触发拖动，尾随的 `click` 就把节点选中了。拖动结束后第一次 `click` 被一次性抑制
		* （`suppressClickRef`，并在 0ms 后自动清空，避免吞掉下一次真实点击）。
		*
		* 键盘（画布可聚焦）：方向键 ±24px、`Home`/`r`/`R` 复位；平移上限 ±20000px（防止把
		* 画布甩到永远找不回来的地方）。
		*/
		/** 平移上限（±）：与 DESIGN §2.4 一致，够远但不会迷失。 */
		const FLOW_PAN_LIMIT = 2e4;
		/** 复位动画时长（ms）—— 与 styles.ts 的 transition 一致。 */
		const RESET_MS = 180;
		function clampPan(value) {
			return Math.max(-2e4, Math.min(FLOW_PAN_LIMIT, value));
		}
		/** 列头编号 `01/02…`（两位零填充；纯展示格式，只要一处实现）。 */
		function stageNumberText(index) {
			return String(index + 1).padStart(2, "0");
		}
		function FlowCanvas(props) {
			const { flow, onSelectTask, members, onOpenMember } = props;
			const layout = react.useMemo(() => flowLayoutOf(flow), [flow]);
			const instanceId = react.useId().replace(/[^a-zA-Z0-9_-]/g, "");
			const markerId = `auto-team-flow-arrow-${instanceId}`;
			const solidMarkerId = `auto-team-flow-stage-solid-${instanceId}`;
			const dashedMarkerId = `auto-team-flow-stage-dashed-${instanceId}`;
			const viewportRef = react.useRef(null);
			const panRef = react.useRef({
				x: 0,
				y: 0
			});
			const frameRef = react.useRef(null);
			const pendingRef = react.useRef(null);
			const dragRef = react.useRef(null);
			const suppressClickRef = react.useRef(false);
			const resetTimerRef = react.useRef(null);
			const [dragging, setDragging] = react.useState(false);
			const [resetting, setResetting] = react.useState(false);
			const paint = react.useCallback((x, y) => {
				const viewport = viewportRef.current;
				if (viewport === null) return;
				viewport.style.transform = `translate3d(${x}px, ${y}px, 0)`;
			}, []);
			/** rAF 合帧：同一帧内的多次 pointermove 只保留最后一次待写值。 */
			const schedulePaint = react.useCallback((x, y) => {
				panRef.current = {
					x,
					y
				};
				if (typeof requestAnimationFrame !== "function") {
					paint(x, y);
					return;
				}
				pendingRef.current = {
					x,
					y
				};
				if (frameRef.current !== null) return;
				frameRef.current = requestAnimationFrame(() => {
					frameRef.current = null;
					const next = pendingRef.current;
					pendingRef.current = null;
					if (next !== null) paint(next.x, next.y);
				});
			}, [paint]);
			const cancelFrame = react.useCallback(() => {
				if (frameRef.current === null) return;
				if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frameRef.current);
				frameRef.current = null;
			}, []);
			const resetView = react.useCallback(() => {
				cancelFrame();
				pendingRef.current = null;
				panRef.current = {
					x: 0,
					y: 0
				};
				setDragging(false);
				setResetting(true);
				paint(0, 0);
				if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
				resetTimerRef.current = setTimeout(() => {
					resetTimerRef.current = null;
					setResetting(false);
				}, RESET_MS);
			}, [cancelFrame, paint]);
			react.useEffect(() => {
				return () => {
					cancelFrame();
					if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
				};
			}, [cancelFrame]);
			const clearSuppressLater = () => {
				setTimeout(() => {
					suppressClickRef.current = false;
				}, 0);
			};
			const onPointerDown = (event) => {
				if (event.button !== 0) return;
				const target = event.target;
				if (target !== null && target.closest("[data-canvas-reset]") !== null) return;
				dragRef.current = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startY: event.clientY,
					baseX: panRef.current.x,
					baseY: panRef.current.y,
					moved: false
				};
				suppressClickRef.current = false;
			};
			const onPointerMove = (event) => {
				const drag = dragRef.current;
				if (drag === null || drag.pointerId !== event.pointerId) return;
				const dx = event.clientX - drag.startX;
				const dy = event.clientY - drag.startY;
				if (!drag.moved) {
					if (Math.hypot(dx, dy) < 4) return;
					drag.moved = true;
					setDragging(true);
					setResetting(false);
					if (resetTimerRef.current !== null) {
						clearTimeout(resetTimerRef.current);
						resetTimerRef.current = null;
					}
					try {
						event.currentTarget.setPointerCapture(event.pointerId);
					} catch {}
				}
				schedulePaint(clampPan(drag.baseX + dx), clampPan(drag.baseY + dy));
			};
			const onPointerEnd = (event) => {
				const drag = dragRef.current;
				if (drag === null || drag.pointerId !== event.pointerId) return;
				dragRef.current = null;
				if (!drag.moved) return;
				suppressClickRef.current = true;
				clearSuppressLater();
				setDragging(false);
				try {
					event.currentTarget.releasePointerCapture(event.pointerId);
				} catch {}
			};
			const onClickCapture = (event) => {
				if (!suppressClickRef.current) return;
				suppressClickRef.current = false;
				event.preventDefault();
				event.stopPropagation();
			};
			const onKeyDown = (event) => {
				const { key } = event;
				if (key === "Home" || key === "r" || key === "R") {
					event.preventDefault();
					resetView();
					return;
				}
				let dx = 0;
				let dy = 0;
				if (key === "ArrowLeft") dx = -24;
				else if (key === "ArrowRight") dx = 24;
				else if (key === "ArrowUp") dy = -24;
				else if (key === "ArrowDown") dy = 24;
				else return;
				event.preventDefault();
				schedulePaint(clampPan(panRef.current.x + dx), clampPan(panRef.current.y + dy));
			};
			return /* @__PURE__ */ react.createElement("section", {
				"data-region": "task-flow",
				"aria-label": "任务流转"
			}, layout.nodes.length === 0 ? /* @__PURE__ */ react.createElement("p", { "data-flow-empty": true }, "计划里还没有任务，落盘后这里会画出依赖关系") : null, /* @__PURE__ */ react.createElement("div", {
				"data-flow-canvas": true,
				"data-dragging": dragging ? "true" : "false",
				"data-resetting": resetting ? "true" : "false",
				tabIndex: 0,
				role: "group",
				"aria-label": "任务流转图，可拖动平移，方向键移动，R 键重置",
				onPointerDown,
				onPointerMove,
				onPointerUp: onPointerEnd,
				onPointerCancel: onPointerEnd,
				onClickCapture,
				onKeyDown
			}, /* @__PURE__ */ react.createElement("div", {
				"data-flow-viewport": true,
				ref: viewportRef,
				style: {
					width: `${layout.width}px`,
					height: `${layout.height}px`
				}
			}, /* @__PURE__ */ react.createElement("svg", {
				"data-flow-edges": true,
				width: layout.width,
				height: layout.height,
				viewBox: `0 0 ${layout.width} ${layout.height}`,
				"aria-hidden": "true"
			}, /* @__PURE__ */ react.createElement("defs", null, /* @__PURE__ */ react.createElement("marker", {
				id: markerId,
				"data-flow-arrow": true,
				viewBox: "0 0 8 8",
				refX: "7",
				refY: "4",
				markerWidth: "7",
				markerHeight: "7",
				orient: "auto-start-reverse"
			}, /* @__PURE__ */ react.createElement("path", { d: "M 0 0 L 8 4 L 0 8 z" })), /* @__PURE__ */ react.createElement("marker", {
				id: solidMarkerId,
				"data-flow-stage-arrow": "solid",
				viewBox: "0 0 8 8",
				refX: "7",
				refY: "4",
				markerWidth: "7",
				markerHeight: "7",
				orient: "auto-start-reverse"
			}, /* @__PURE__ */ react.createElement("path", { d: "M 0 0 L 8 4 L 0 8 z" })), /* @__PURE__ */ react.createElement("marker", {
				id: dashedMarkerId,
				"data-flow-stage-arrow": "dashed",
				viewBox: "0 0 8 8",
				refX: "7",
				refY: "4",
				markerWidth: "7",
				markerHeight: "7",
				orient: "auto-start-reverse"
			}, /* @__PURE__ */ react.createElement("path", { d: "M 0 0 L 8 4 L 0 8 z" }))), layout.stageLinks.map((link) => /* @__PURE__ */ react.createElement("path", {
				key: link.key,
				"data-flow-stage-link": true,
				"data-upstream-done": link.upstreamDone ? "true" : "false",
				d: link.d,
				fill: "none",
				stroke: link.upstreamDone ? "var(--dsw-alias-state-business-primary)" : "var(--dsw-alias-label-tertiary)",
				strokeWidth: 1.5,
				strokeDasharray: link.upstreamDone ? void 0 : "4 3",
				markerEnd: `url(#${link.upstreamDone ? solidMarkerId : dashedMarkerId})`
			})), layout.edges.map((edge) => /* @__PURE__ */ react.createElement("path", {
				key: edge.key,
				"data-flow-edge": edge.key,
				"data-upstream-done": edge.upstreamDone ? "true" : "false",
				d: edge.d,
				fill: "none",
				markerEnd: `url(#${markerId})`
			}))), layout.stages.map((stage) => /* @__PURE__ */ react.createElement("div", {
				key: stage.key,
				"data-flow-stage": true,
				"data-flow-column": String(stage.index),
				"data-role-id": stage.roleId,
				"aria-label": `角色列 ${stageNumberText(stage.index)} ${stage.name}，${stage.count} 个任务`,
				title: `角色列 ${stageNumberText(stage.index)} ${stage.name}，${stage.count} 个任务`,
				style: {
					left: `${stage.x}px`,
					top: `${stage.y}px`
				}
			}, /* @__PURE__ */ react.createElement("span", { "data-flow-stage-badge": true }, stageNumberText(stage.index)), /* @__PURE__ */ react.createElement("span", {
				"data-flow-stage-name": true,
				title: stage.name
			}, stage.name), /* @__PURE__ */ react.createElement("span", { "data-flow-stage-count": true }, "×", stage.count))), layout.nodes.map(({ node, cell, x, y, column, row }) => /* @__PURE__ */ react.createElement("button", {
				key: node.id,
				type: "button",
				"data-flow-node": node.id,
				"data-status": node.status,
				"data-flow-column": String(column),
				"data-flow-row": String(row),
				style: {
					left: `${x}px`,
					top: `${y}px`
				},
				title: cell.title,
				"aria-label": cell.label,
				onClick: () => {
					const member = node.roleId === void 0 ? void 0 : memberForRole(members, node.roleId, node.id);
					if (member !== void 0 && onOpenMember !== void 0) {
						onOpenMember(member, node.id);
						return;
					}
					onSelectTask(node.id);
				}
			}, /* @__PURE__ */ react.createElement("span", { "data-flow-line": "title" }, /* @__PURE__ */ react.createElement("span", { "data-flow-node-id": true }, node.id), /* @__PURE__ */ react.createElement("span", {
				"data-flow-node-title": true,
				title: node.title
			}, cell.taskTitle), /* @__PURE__ */ react.createElement("span", {
				"data-flow-status": true,
				"data-tone": cell.tone
			}, cell.statusText)), /* @__PURE__ */ react.createElement("span", { "data-flow-line": "meta" }, /* @__PURE__ */ react.createElement("span", {
				"data-cell": "token",
				"data-usage-source": node.usage.source
			}, cell.tokenText), /* @__PURE__ */ react.createElement("span", {
				"data-flow-sep": true,
				"aria-hidden": "true"
			}, "·"), /* @__PURE__ */ react.createElement("span", {
				"data-cell": "duration",
				"data-duration-state": node.duration.state
			}, cell.durationText))))), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-canvas-reset": true,
				"aria-label": "重置画布视图",
				onClick: resetView
			}, "重置视图"), /* @__PURE__ */ react.createElement("p", {
				"data-flow-legend": true,
				title: "任务边看上游任务；列间箭头看左侧角色列"
			}, /* @__PURE__ */ react.createElement("span", {
				"data-legend-line": "solid",
				"aria-hidden": "true"
			}), "实线 = 已完成", /* @__PURE__ */ react.createElement("span", {
				"data-legend-line": "dashed",
				"aria-hidden": "true"
			}), "虚线 = 未完成")));
		}
		// src/client/views/MemberPage.tsx
		/**
		* r17：子智能体主界面（主区里点角色卡 / 任务行 / 流程图节点后打开）。
		*
		* 纯展示组件：成员、任务、消息、路由审计的取数与文案都在 `nav.ts#memberPageOf`
		* 里完成，这里只按 `MemberPageView` 铺 DOM（因此不需要 hook，也不会重复格式化）。
		*/
		function MemberPage(props) {
			const { view, memberId, onBack, surface = "main" } = props;
			return /* @__PURE__ */ react.createElement("div", {
				"data-member-page": true,
				"data-member-id": memberId,
				"data-member-surface": surface,
				"data-member-found": view === null ? "false" : "true"
			}, /* @__PURE__ */ react.createElement("div", { "data-member-bar": true }, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-member-back": true,
				onClick: onBack
			}, "← 返回项目库"), /* @__PURE__ */ react.createElement("span", { "data-member-crumb": true }, "子智能体")), view === null ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "成员已不在当前 run 里",
				hint: `快照里找不到 ${memberId}（可能已被清理，或切到了别的会话）。`,
				next: "回到项目库，从角色卡或任务行重新选择成员。"
			}) : /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("header", { "data-member-head": true }, /* @__PURE__ */ react.createElement("h2", { "data-member-name": true }, view.name), /* @__PURE__ */ react.createElement("span", {
				"data-member-status": true,
				"data-tone": view.statusTone,
				title: view.statusTitle
			}, view.statusText), /* @__PURE__ */ react.createElement("span", {
				"data-member-role": true,
				"data-role-id": view.roleId
			}, view.roleName), /* @__PURE__ */ react.createElement("span", {
				"data-member-model": true,
				"data-usage-source": view.routeAudit?.verdict ?? "declared"
			}, view.modelRoute)), /* @__PURE__ */ react.createElement("dl", { "data-member-facts": true }, /* @__PURE__ */ react.createElement("dt", null, "职责"), /* @__PURE__ */ react.createElement("dd", { "data-member-duty": true }, view.duty === "" ? "—" : view.duty), /* @__PURE__ */ react.createElement("dt", null, "最近活动"), /* @__PURE__ */ react.createElement("dd", { "data-member-last-active": true }, view.lastActiveText), /* @__PURE__ */ react.createElement("dt", null, "停滞"), /* @__PURE__ */ react.createElement("dd", {
				"data-member-stalled": true,
				"data-stalled": view.stalled ? "true" : "false"
			}, view.stalled ? view.stalledText : view.stallNote === "" ? "未停滞" : view.stallNote), /* @__PURE__ */ react.createElement("dt", null, "续聊"), /* @__PURE__ */ react.createElement("dd", { "data-member-resume": true }, view.resumeText)), view.routeAudit !== void 0 ? /* @__PURE__ */ react.createElement("p", {
				"data-member-route-audit": true,
				"data-verdict": view.routeAudit.verdict,
				"data-tone": view.routeAudit.tone
			}, view.routeAudit.text) : /* @__PURE__ */ react.createElement("p", {
				"data-member-route-audit": true,
				"data-verdict": "none"
			}, "尚未收到该成员的路由审计。"), /* @__PURE__ */ react.createElement("section", {
				"data-member-task": true,
				"data-task-id": view.task?.taskId ?? ""
			}, /* @__PURE__ */ react.createElement("h3", { "data-member-section-title": true }, "执行任务"), view.task === void 0 ? /* @__PURE__ */ react.createElement("p", { "data-member-task-empty": true }, view.taskText) : /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("div", { "data-member-task-head": true }, /* @__PURE__ */ react.createElement("span", { "data-member-task-id": true }, view.task.taskId), /* @__PURE__ */ react.createElement("strong", { "data-member-task-title": true }, view.task.title), /* @__PURE__ */ react.createElement("span", {
				"data-member-task-status": true,
				"data-tone": view.task.statusTone
			}, view.task.statusText)), /* @__PURE__ */ react.createElement("div", { "data-member-task-cells": true }, /* @__PURE__ */ react.createElement("span", {
				"data-cell": "token",
				"data-usage-source": view.task.usageSource,
				title: view.task.tokenTitle
			}, view.task.tokenText), /* @__PURE__ */ react.createElement("span", { "data-member-cell-sep": true }, "·"), /* @__PURE__ */ react.createElement("span", {
				"data-cell": "duration",
				"data-duration-state": view.task.durationState,
				title: view.task.durationTitle
			}, view.task.durationText)), /* @__PURE__ */ react.createElement("dl", { "data-member-task-facts": true }, /* @__PURE__ */ react.createElement("dt", null, "验收"), /* @__PURE__ */ react.createElement("dd", { "data-member-acceptance": true }, view.task.acceptance), /* @__PURE__ */ react.createElement("dt", null, "前置"), /* @__PURE__ */ react.createElement("dd", { "data-member-depends": true }, view.task.dependsText), /* @__PURE__ */ react.createElement("dt", null, "写域"), /* @__PURE__ */ react.createElement("dd", { "data-member-scope": true }, view.task.scopeText), /* @__PURE__ */ react.createElement("dt", null, "门禁"), /* @__PURE__ */ react.createElement("dd", { "data-member-evidence": true }, view.task.evidenceText)))), /* @__PURE__ */ react.createElement("section", {
				"data-region": "member-messages",
				"data-message-count": view.messageCount
			}, /* @__PURE__ */ react.createElement("h3", { "data-member-section-title": true }, "直接消息 · ", view.messageCount), view.messages.length === 0 ? /* @__PURE__ */ react.createElement("p", { "data-member-messages-empty": true }, view.emptyMessagesText) : /* @__PURE__ */ react.createElement("ol", { "data-member-message-list": true }, view.messages.map((message) => /* @__PURE__ */ react.createElement("li", {
				key: message.messageId,
				"data-member-message": true,
				"data-message-id": message.messageId,
				"data-foldable": message.foldable ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("div", { "data-member-message-head": true }, /* @__PURE__ */ react.createElement("span", { "data-member-message-from": true }, message.fromText), /* @__PURE__ */ react.createElement("span", { "data-member-message-arrow": true }, "→"), /* @__PURE__ */ react.createElement("span", { "data-member-message-to": true }, message.toText), /* @__PURE__ */ react.createElement("span", { "data-member-message-at": true }, message.atText)), message.foldable ? /* @__PURE__ */ react.createElement("details", { "data-member-message-fold": true }, /* @__PURE__ */ react.createElement("summary", null, "展开全文"), /* @__PURE__ */ react.createElement("p", { "data-member-message-body": true }, message.body)) : /* @__PURE__ */ react.createElement("p", { "data-member-message-body": true }, message.body)))))));
		}
		// src/client/views/MemoryList.tsx
		/**
		* 记忆列表（r13 AC-14 / AC-15；r23 扩展文件级条目视图）。
		*
		* 两种模式：
		*  1. `items`（左栏项目库/全局记忆）：行高 44px 两行式，`≈token` + 时间；
		*  2. `files`（右栏「记忆」页）：文件行显示主题标题、等级分布、条目数；展开后渲染宿主
		*     下发的 `MemoryEntryView[]`（等级徽标 / 正文 / 来源与修正次数 / 已作废删除线）。
		*
		* 三条纪律：
		*  1. token 必须带 `≈`，因为它是 `ceil(字符数 / 2)` 的估算值，不是 provider 上报值。
		*  2. 正文**逐字**渲染：md 是团队资产，插件不解析、不美化、不截断。r23 的条目正文同样
		*     直接用宿主下发的 `text` / `sourceText`，客户端不切分「（来源：」、不拼时间。
		*  3. 展开状态归调用方（`expanded`），组件只报告「点了谁」；左栏与右栏各自维护展开项。
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
			if (props.files !== void 0) return /* @__PURE__ */ react.createElement(MemoryFileList, {
				files: props.files,
				track: props.track,
				expanded: props.expanded,
				body: props.body,
				bodyError: props.bodyError,
				entries: props.entries,
				entriesLoading: props.entriesLoading,
				onRetry: props.onRetry,
				onOpen: props.onOpen
			});
			const { track, expanded, body, bodyError, onRetry, onOpen } = props;
			const items = props.items;
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
		function MemoryFileList(props) {
			const { files, track, expanded, body, bodyError, entries, entriesLoading, onRetry, onOpen } = props;
			const empty = EMPTY_COPY[track] ?? EMPTY_COPY.project;
			if (files.length === 0) return /* @__PURE__ */ react.createElement(EmptyState, {
				title: empty.title,
				hint: empty.hint,
				next: empty.next
			});
			return /* @__PURE__ */ react.createElement("ul", {
				"data-memory-list": true,
				"data-memory-mode": "files",
				"aria-label": track === "public" ? "公共记忆文件" : "项目记忆文件"
			}, files.map((file) => {
				const row = memoryFileRowOf(file);
				const open = expanded === row.name || expanded === row.key;
				return /* @__PURE__ */ react.createElement("li", {
					key: row.key,
					"data-memory-row": true,
					"data-memory-file-row": true,
					"data-topic": file.topic ?? "",
					"data-open": open ? "true" : "false"
				}, /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-auto-team-memory-item": row.key,
					"data-memory-track": file.track,
					"aria-expanded": open,
					"aria-label": `${row.title}，${row.countText}`,
					onClick: () => onOpen(file),
					title: `${row.title}（${row.metaText}）`
				}, /* @__PURE__ */ react.createElement("span", { "data-memory-title": true }, row.title), /* @__PURE__ */ react.createElement("span", { "data-memory-file-count": true }, row.countText), /* @__PURE__ */ react.createElement("span", {
					"data-memory-distribution": true,
					title: row.distributionTitle
				}, row.distributionText), /* @__PURE__ */ react.createElement("span", { "data-memory-file-meta": true }, row.metaText)), open ? /* @__PURE__ */ react.createElement(MemoryFileDetail, {
					body,
					bodyError,
					entries,
					entriesLoading,
					onRetry
				}) : null);
			}));
		}
		function MemoryFileDetail(props) {
			const { body, bodyError, entries, entriesLoading, onRetry } = props;
			if (bodyError !== void 0) return /* @__PURE__ */ react.createElement("div", { "data-memory-detail": true }, /* @__PURE__ */ react.createElement("p", {
				"data-error": true,
				role: "alert"
			}, bodyError), onRetry === void 0 ? null : /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-memory-retry": true,
				onClick: onRetry
			}, "重试读取"));
			if (entriesLoading === true) return /* @__PURE__ */ react.createElement("p", {
				"data-memory-loading": true,
				"aria-busy": "true"
			}, "正在读取条目…");
			if (entries !== void 0) return /* @__PURE__ */ react.createElement(MemoryEntryGroups, { entries });
			if (body !== void 0) return /* @__PURE__ */ react.createElement("pre", { "data-memory-body": true }, body);
			return /* @__PURE__ */ react.createElement("p", {
				"data-memory-loading": true,
				"aria-busy": "true"
			}, "正在读取条目…");
		}
		function MemoryEntryGroups(props) {
			const groups = memoryEntriesOf(props.entries);
			if (groups.active.length === 0 && groups.superseded.length === 0) return /* @__PURE__ */ react.createElement("p", { "data-memory-empty-detail": true }, "这个文件还没有条目");
			return /* @__PURE__ */ react.createElement("div", { "data-memory-detail": true }, groups.active.length === 0 ? /* @__PURE__ */ react.createElement("p", { "data-memory-empty-detail": true }, "没有活动条目") : /* @__PURE__ */ react.createElement("ul", {
				"data-memory-entries": true,
				"aria-label": "活动条目"
			}, groups.active.map((entry) => /* @__PURE__ */ react.createElement(MemoryEntryItem, {
				key: entry.key,
				row: entry
			}))), groups.superseded.length === 0 ? null : /* @__PURE__ */ react.createElement("details", { "data-memory-superseded": true }, /* @__PURE__ */ react.createElement("summary", null, "已作废 ", groups.superseded.length, " 条"), /* @__PURE__ */ react.createElement("ul", {
				"data-memory-entries": true,
				"aria-label": "已作废条目"
			}, groups.superseded.map((entry) => /* @__PURE__ */ react.createElement(MemoryEntryItem, {
				key: entry.key,
				row: entry
			})))));
		}
		function MemoryEntryItem(props) {
			const row = props.row;
			return /* @__PURE__ */ react.createElement("li", {
				"data-memory-entry": true,
				"data-level": row.level,
				"data-superseded": row.superseded ? "true" : "false",
				"data-memory-entry-revisions": row.revisions
			}, /* @__PURE__ */ react.createElement("span", { "data-memory-entry-head": true }, /* @__PURE__ */ react.createElement("span", {
				"data-memory-entry-level": true,
				"data-tone": row.tone
			}, row.levelText), row.superseded ? /* @__PURE__ */ react.createElement("span", { "data-memory-entry-flag": true }, row.supersededText) : null), /* @__PURE__ */ react.createElement("span", { "data-memory-entry-text": true }, row.text), /* @__PURE__ */ react.createElement("span", {
				"data-memory-entry-source": true,
				title: row.sourceText
			}, row.sourceText));
		}
		// src/client/views/RoleCard.tsx
		/**
		* 角色卡片 + 2 列网格（r14 AC-7 / AC-8 / AC-9）。
		*
		* 卡片渲染的六个派生量（状态 / 状态文案 / 已完成数 / 当前任务 id / 当前任务标题 / 用时）
		* 全部来自 `shared/role-view.ts#roleStateOf`（宿主 rolesOf 与客户端 roleUsageOf 同一份实现），
		* 组件**只渲染、不聚合** —— 这是 AC-9/AC-17「右栏与抽屉文本逐字相等」的构造保证。
		*
		* 几何（DESIGN §2.2）：296 内容宽 / 2 列 = 144，min-height 76；四行 ——
		*   1. 角色名（13/600，弹性，ellipsis）+ 状态徽标（18px 高）；
		*   2. 当前任务标题（11px，一行 ellipsis）；没有当前任务时写「无进行中任务」；
		*   3. refs 行（r16 AC-16）：该角色的任务编号 chip（`tN` + 状态彩点），
		*      `taskRefs` 缺省/空则整行不渲染 —— 旧快照不显示「0 个任务」；
		*   4. token · 用时 · 已完成 N/总数（11px tabular-nums）。
		* 卡片数 = 不同 roleId 数（分组已在宿主/客户端聚合层完成）。
		*/
		/** 旧快照/旧夹具缺派生字段时的兜底（不改写统计，只保证界面不空）。 */
		const FALLBACK_STATE = "idle";
		function RoleCard(props) {
			const { role, member, onOpen } = props;
			const state = role.state ?? FALLBACK_STATE;
			const stateText = role.stateText ?? ROLE_STATE_TEXT[state];
			const tone = ROLE_STATE_TONE[state] ?? "neutral";
			const done = role.done ?? 0;
			const activeTitle = role.activeTaskId !== void 0 ? role.activeTaskTitle ?? role.activeTaskId : void 0;
			const duration = role.duration;
			const refs = (role.taskRefs ?? []).map((ref) => roleTaskRefViewOf(ref));
			const memberChip = memberCardChipOf(member);
			const memberChipEl = memberChip === void 0 || member === void 0 ? null : /* @__PURE__ */ react.createElement("span", {
				"data-role-member-status": true,
				"data-status": member.status,
				"data-tone": memberChip.tone,
				title: memberStatusTitleOf(member.status) ?? `成员状态：${memberChip.text}`,
				"aria-label": `成员状态：${memberChip.text}`
			}, /* @__PURE__ */ react.createElement("span", { "aria-hidden": "true" }, memberChip.icon), " ", memberChip.text);
			return /* @__PURE__ */ react.createElement("article", {
				"data-role-card": true,
				"data-role-id": role.roleId,
				"data-role-state": state,
				"data-role-done": String(done),
				"data-role-card-open": onOpen === void 0 ? void 0 : "true",
				"data-member-id": member?.memberId,
				role: onOpen === void 0 ? void 0 : "button",
				tabIndex: onOpen === void 0 ? void 0 : 0,
				"aria-label": onOpen === void 0 ? void 0 : `打开子智能体：${member?.name ?? role.name}`,
				style: onOpen === void 0 ? void 0 : { cursor: "pointer" },
				onClick: onOpen,
				onKeyDown: onOpen === void 0 ? void 0 : (event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					onOpen();
				}
			}, /* @__PURE__ */ react.createElement("div", { "data-role-line": "head" }, /* @__PURE__ */ react.createElement("span", {
				"data-role-name": true,
				title: role.name
			}, role.name), /* @__PURE__ */ react.createElement("span", {
				"data-role-status": true,
				"data-tone": tone,
				title: `角色状态：${stateText}`
			}, stateText)), activeTitle !== void 0 ? /* @__PURE__ */ react.createElement("span", {
				"data-role-active-task": true,
				title: activeTitle
			}, activeTitle) : /* @__PURE__ */ react.createElement("span", {
				"data-role-active-task": true,
				"data-empty": "true"
			}, "无进行中任务"), refs.length > 0 ? /* @__PURE__ */ react.createElement("div", {
				"data-role-line": "refs",
				"data-role-task-refs": true
			}, refs.map((chip) => /* @__PURE__ */ react.createElement("span", {
				key: chip.id,
				"data-role-task-ref": true,
				"data-task-id": chip.id,
				"data-status": chip.status,
				"data-tone": chip.tone,
				title: chip.title,
				"aria-label": chip.label
			}, /* @__PURE__ */ react.createElement("span", {
				"data-task-ref-dot": true,
				"data-tone": chip.tone,
				"aria-hidden": "true"
			}), /* @__PURE__ */ react.createElement("span", { "data-task-ref-id": true }, chip.text))), memberChipEl) : memberChipEl !== null ? /* @__PURE__ */ react.createElement("div", {
				"data-role-line": "refs",
				"data-role-member-line": true
			}, memberChipEl) : null, /* @__PURE__ */ react.createElement("div", { "data-role-line": "meta" }, /* @__PURE__ */ react.createElement("span", {
				"data-role-usage": true,
				"data-usage-source": role.usage.source,
				title: tokenTitleOf(role.usage)
			}, tokenTextOf(role.usage)), /* @__PURE__ */ react.createElement("span", {
				"data-role-sep": true,
				"aria-hidden": "true"
			}, "·"), /* @__PURE__ */ react.createElement("span", {
				"data-role-duration": true,
				"data-duration-state": duration?.state ?? "unavailable",
				title: roleDurationTitleOf(duration, role.tasks)
			}, duration !== void 0 ? duration.text : "不可得")));
		}
		function RoleGrid(props) {
			if (props.roles.length === 0) return /* @__PURE__ */ react.createElement("section", {
				"data-region": "task-roles",
				"data-role-grid-view": true,
				"data-empty": "true",
				"aria-label": "本轮角色状态"
			});
			return /* @__PURE__ */ react.createElement("section", {
				"data-region": "task-roles",
				"data-role-grid-view": true,
				"aria-label": "本轮角色状态"
			}, /* @__PURE__ */ react.createElement("div", { "data-role-grid": true }, props.roles.map((role) => {
				const taskId = role.activeTaskId;
				const member = memberForRole(props.members, role.roleId, taskId);
				const open = member === void 0 || props.onOpenMember === void 0 ? void 0 : () => props.onOpenMember?.(member, taskId ?? member.taskId);
				return /* @__PURE__ */ react.createElement(RoleCard, {
					key: role.roleId,
					role,
					member,
					onOpen: open
				});
			})));
		}
		// src/client/views/RunDrawer.tsx
		/**
		* 右侧运行抽屉（r14 AC-16 / AC-17）——**只负责壳**：遮罩、dialog 语义、Esc/遮罩/按钮三条
		* 关闭路径、焦点陷阱与进出场动画；内容由调用方（`LibraryPage`）组装。
		*
		* 为什么把壳单独成件：抽屉必须活在 `[data-library-shell]` 内（absolute 定位），而「同一时刻
		* 最多一个」由调用方的 `openRunId` 单值决定；把焦点逻辑收在壳里，页面层就只剩状态与复原。
		*
		* 焦点：打开时记住入口由调用方做（页面层知道触发行），壳只负责「进入后焦点落在第一个可聚焦
		* 元素」与 Tab 循环；关闭动画结束后才调用 `onClose`，页面层在那一刻做 scrollTop/焦点复原。
		*
		* 动画：进入走 styles.ts 的 `auto-team-drawer-in`（160ms）；退出按要求 120ms——用内联
		* transition 反向位移后卸载，`prefers-reduced-motion` 下直接关闭、不等待。
		*/
		/** 退出动画时长（DESIGN §0.4：进入 160ms / 退出 120ms）。 */
		const EXIT_MS = 120;
		/** 可聚焦元素（与宿主面板的可见性无关；隐藏元素在 querySelectorAll 里会被过滤掉）。 */
		const FOCUSABLE = "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";
		function prefersReducedMotion() {
			if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
			try {
				return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			} catch {
				return false;
			}
		}
		function focusablesOf(root) {
			return Array.from(root.querySelectorAll(FOCUSABLE)).filter((node) => node.offsetParent !== null || node === document.activeElement);
		}
		function RunDrawer(props) {
			const { open, title, subtitle, onClose, children, runId } = props;
			const titleId = react.useId();
			const drawerRef = react.useRef(null);
			const closingRef = react.useRef(false);
			const timerRef = react.useRef(null);
			const onCloseRef = react.useRef(onClose);
			const [closing, setClosing] = react.useState(false);
			onCloseRef.current = onClose;
			react.useEffect(() => {
				if (open) return;
				closingRef.current = false;
				if (timerRef.current !== null) {
					clearTimeout(timerRef.current);
					timerRef.current = null;
				}
				setClosing(false);
			}, [open]);
			const requestClose = react.useCallback(() => {
				if (!open || closingRef.current) return;
				closingRef.current = true;
				if (prefersReducedMotion()) {
					onCloseRef.current();
					return;
				}
				setClosing(true);
				timerRef.current = setTimeout(() => {
					timerRef.current = null;
					onCloseRef.current();
				}, EXIT_MS);
			}, [open]);
			react.useEffect(() => {
				if (!open) return void 0;
				const node = drawerRef.current;
				if (node !== null) {
					const first = focusablesOf(node)[0];
					if (first !== void 0) first.focus();
					else node.focus();
				}
				function onKeyDown(event) {
					if (event.key === "Escape") {
						event.preventDefault();
						requestClose();
						return;
					}
					if (event.key !== "Tab") return;
					const root = drawerRef.current;
					if (root === null) return;
					const list = focusablesOf(root);
					if (list.length === 0) {
						event.preventDefault();
						root.focus();
						return;
					}
					const first = list[0];
					const last = list[list.length - 1];
					const active = document.activeElement;
					if (event.shiftKey) {
						if (active === first || !root.contains(active)) {
							event.preventDefault();
							last.focus();
						}
					} else if (active === last || !root.contains(active)) {
						event.preventDefault();
						first.focus();
					}
				}
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [open, requestClose]);
			react.useEffect(() => {
				return () => {
					if (timerRef.current !== null) {
						clearTimeout(timerRef.current);
						timerRef.current = null;
					}
				};
			}, []);
			if (!open) return null;
			const closingStyle = closing ? {
				opacity: 0,
				transform: "translateX(16px)",
				transition: "opacity 120ms ease, transform 120ms ease"
			} : void 0;
			const maskStyle = closing ? {
				opacity: 0,
				transition: "opacity 120ms ease"
			} : void 0;
			return /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("div", {
				"data-run-drawer-mask": true,
				style: maskStyle,
				onClick: requestClose,
				"aria-hidden": "true"
			}), /* @__PURE__ */ react.createElement("div", {
				ref: drawerRef,
				"data-run-drawer": true,
				"data-drawer-run": runId,
				"data-closing": closing ? "true" : "false",
				style: closingStyle,
				role: "dialog",
				"aria-modal": "true",
				"aria-labelledby": titleId,
				tabIndex: -1
			}, /* @__PURE__ */ react.createElement("header", { "data-drawer-head": true }, /* @__PURE__ */ react.createElement("div", { "data-drawer-titles": true }, /* @__PURE__ */ react.createElement("h2", {
				"data-drawer-title": true,
				id: titleId,
				title
			}, title), /* @__PURE__ */ react.createElement("span", {
				"data-drawer-subtitle": true,
				title: subtitle
			}, subtitle)), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-drawer-close": true,
				"aria-label": "关闭详情",
				title: "关闭详情",
				onClick: requestClose
			}, /* @__PURE__ */ react.createElement("span", { "aria-hidden": "true" }, "×"))), /* @__PURE__ */ react.createElement("div", { "data-drawer-body": true }, children)));
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
			const { detail, paused, inflight, onTogglePause, plan, stage } = props;
			const head = runHeadOf(detail, inflight, stage);
			return /* @__PURE__ */ react.createElement("header", {
				"data-region": "run-head",
				"data-paused": paused === true ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("div", { "data-run-line": "identity" }, /* @__PURE__ */ react.createElement("code", {
				"data-run-id": true,
				title: head.plannedAtText
			}, head.runId), /* @__PURE__ */ react.createElement("span", {
				"data-plan-status": true,
				"data-tone": head.planStatusTone,
				title: head.planStatusDetail
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
			}, head.downgrade) : null, head.terminationReason ? /* @__PURE__ */ react.createElement("p", {
				"data-run-termination": true,
				title: head.terminationReason
			}, "终止原因：", head.terminationReason) : null, plan !== null && plan !== void 0 ? /* @__PURE__ */ react.createElement("section", {
				"data-run-plan": true,
				"aria-label": "本次运行的目标与需求修订"
			}, /* @__PURE__ */ react.createElement("div", { "data-plan-block-head": true }, plan.revisionCountText ? /* @__PURE__ */ react.createElement("span", { "data-run-revisions": true }, plan.revisionCountText) : null, plan.mergedText ? /* @__PURE__ */ react.createElement("span", {
				"data-run-merged": true,
				title: `本次运行已并入 ${head.runId}（复用同一个 runId）`
			}, plan.mergedText) : null), plan.sections.length > 0 ? /* @__PURE__ */ react.createElement("div", { "data-run-goal-sections": true }, plan.sections.map((section) => /* @__PURE__ */ react.createElement("div", {
				key: section.key,
				"data-goal-section": section.revision ? "revision" : "original"
			}, /* @__PURE__ */ react.createElement("span", { "data-goal-heading": true }, section.revision ? /* @__PURE__ */ react.createElement("span", { "data-goal-tag": true }, "追加需求") : null, section.heading), /* @__PURE__ */ react.createElement("p", { "data-goal-body": true }, section.body)))) : null, plan.latestRevisionText ? /* @__PURE__ */ react.createElement("p", {
				"data-run-latest-revision": true,
				title: plan.latestRevisionText
			}, plan.latestRevisionText) : null) : null);
		}
		// src/client/views/RunRow.tsx
		/**
		* 项目库页的 run 行（r14 AC-15）——项目详情里「一个 run 一行」，点开右侧抽屉。
		*
		* 分两行：第一行 `[data-run-title]` 是 run 级 goal（24 字截断已在 `rows.ts#goalTitleOf`
		* 单点做过，组件不再截），无 goal 的旧 run 打 `data-title-source="fallback"`（诚实标注）；
		* 第二行 `[data-run-meta]` = runId 后 6 位 · 状态 · token · 用时，缺量显示「不可得」。
		*
		* 为什么行是 `<button>`：整行可点、原生键盘可达；`[data-run-row]` 与 `[data-run-id]`
		* 同时挂在 button 上，供样式（`data-open`）与真机取证（`[data-drawer-run]`）使用。
		* token/用时文本只原样渲染宿主下发的 cell 文本（`rows.ts` 已格式化），这里不做第二次格式化。
		*/
		/** runId 后 6 位（meta 行第一段；完整 id 在 `title` 与 `data-run-id` 里）。 */
		function shortRunId(runId) {
			return runId.length > 6 ? runId.slice(-6) : runId;
		}
		function RunRow(props) {
			const { row, active, onOpen } = props;
			return /* @__PURE__ */ react.createElement("li", null, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-run-row": true,
				"data-run-id": row.runId,
				"data-open": active ? "true" : "false",
				"aria-haspopup": "dialog",
				"aria-expanded": active,
				title: row.titleTitle ?? row.title,
				onClick: () => onOpen(row.runId)
			}, /* @__PURE__ */ react.createElement("span", {
				"data-run-title": true,
				"data-title-source": row.titleSource,
				title: row.titleTitle ?? row.title
			}, row.title), /* @__PURE__ */ react.createElement("span", {
				"data-run-meta": true,
				title: row.metaText
			}, /* @__PURE__ */ react.createElement("span", { "data-run-short": true }, shortRunId(row.runId)), /* @__PURE__ */ react.createElement("span", {
				"data-run-sep": true,
				"aria-hidden": "true"
			}, " · "), /* @__PURE__ */ react.createElement("span", {
				"data-run-status": true,
				"data-tone": row.statusTone,
				title: row.statusTitle === void 0 ? `状态：${row.statusText}` : `状态：${row.statusText} · ${row.statusTitle}`
			}, /* @__PURE__ */ react.createElement("span", { "aria-hidden": "true" }, row.statusIcon), " ", row.statusText), /* @__PURE__ */ react.createElement("span", {
				"data-run-sep": true,
				"aria-hidden": "true"
			}, " · "), /* @__PURE__ */ react.createElement("span", {
				"data-run-token": true,
				"data-usage-source": row.tokenSource,
				title: row.tokenTitle
			}, row.tokenText), /* @__PURE__ */ react.createElement("span", {
				"data-run-sep": true,
				"aria-hidden": "true"
			}, " · "), /* @__PURE__ */ react.createElement("span", {
				"data-run-duration": true,
				"data-duration-state": row.durationState,
				title: row.durationTitle
			}, row.durationText))));
		}
		// src/client/views/ProgressRing.tsx
		/**
		* 进度环（r16 AC-11；取代 r14 的 64px 环）。
		*
		* 几何（DESIGN §2.1）：80×80 视口、圆心 (40,40)、r=34、stroke=8、`rotate(-90)` 让弧从
		* 12 点方向开始；弧长 `2πr ≈ 213.628`，`dashoffset = C × (1 − done/total)` 由
		* `viewModel.taskOverviewOf` 一次算好（组件**不做除法**，避免两处舍入给出不同进度）。
		*
		* 圆心文字强制 `done/total`（0 任务显示 `0/0`，不写 NaN、不写百分比）：数字是最需要
		* 精确的东西，宁可换字号也不截断。`≤5` 字 16px（`99/99` 半对角 24.7 < 内圆 30）、
		* `≥6` 字 13px（`999/999` 半对角 27.25 < 30），字号档由 `data-text-tier` 交给 CSS。
		*
		* 为什么单列一个组件：右栏任务总览与项目库抽屉复用同一个环 —— 抽屉里再画一个「差不多」的
		* 环，两个数字迟早不一致（r13 的教训）。
		*/
		/** 圆心半径：viewBox 80 → 40；圆心与 viewBox 必须成对变化，否则弧形会偏离圆心。 */
		const CENTER = 40;
		function ProgressRing(props) {
			const { done, total, size = 80 } = props;
			const safeTotal = Number.isFinite(total) ? total : 0;
			const safeDone = Number.isFinite(done) ? done : 0;
			const ratio = safeTotal === 0 ? 0 : Math.min(1, Math.max(0, safeDone / safeTotal));
			const dashOffset = props.dashOffset ?? PROGRESS_RING_CIRCUMFERENCE * (1 - ratio);
			const text = `${safeDone}/${safeTotal}`;
			const textTier = text.length <= 5 ? "short" : "long";
			return /* @__PURE__ */ react.createElement("svg", {
				"data-progress-ring": true,
				"data-done": String(safeDone),
				"data-total": String(safeTotal),
				width: size,
				height: size,
				viewBox: `0 0 80 80`,
				role: "img",
				"aria-label": `已完成 ${safeDone} / 共 ${safeTotal}`
			}, /* @__PURE__ */ react.createElement("circle", {
				"data-ring-track": true,
				cx: CENTER,
				cy: CENTER,
				r: 34,
				fill: "none",
				strokeWidth: 8
			}), /* @__PURE__ */ react.createElement("circle", {
				"data-ring-arc": true,
				"data-complete": safeTotal > 0 && safeDone >= safeTotal ? "true" : "false",
				cx: CENTER,
				cy: CENTER,
				r: 34,
				fill: "none",
				strokeWidth: 8,
				strokeLinecap: "round",
				strokeDasharray: PROGRESS_RING_CIRCUMFERENCE,
				strokeDashoffset: dashOffset,
				transform: `rotate(-90 ${CENTER} ${CENTER})`
			}), /* @__PURE__ */ react.createElement("text", {
				"data-progress-text": true,
				"data-text-tier": textTier,
				x: CENTER,
				y: CENTER,
				textAnchor: "middle",
				dominantBaseline: "central"
			}, text));
		}
		// src/client/views/TaskTable.tsx
		/**
		* 任务表（r13 AC-3 / AC-4 / AC-16 / AC-17；r14 AC-11 / AC-12）。
		*
		* 为什么不是单行表格：320px 面板的内容宽只有 296px 五个字段放不进一行，硬塞会把
		* token 数字截断 —— 截断数字等于造假。所以：
		*   第一行：标题（弹性）+ 状态 badge（最坏 58px）
		*   第二行：角色 / token / 用时（tabular-nums，窄容器里靠 ellipsis 省字，**不省数字**）
		*
		* r14 的两种形态：
		*  - 默认（历史页/抽屉等宽容器）：`[data-task-head]` 表头 + 单一 `ul`；
		*  - `grouped`（右栏任务总览 220px 列表）：**去掉 sticky 表头**（220px 塞不下 r13 的
		*    `1fr 76px 84px` 网格，硬留会把 token 截断），改成两个分组 `未完成 · N` / `已完成 · N`，
		*    组头 sticky 24px。分组与进度环**同源**：都调 `taskOverviewOf`（AC-11 的同帧一致）。
		*    r18b：分组内容是**全量**任务（用户要求；r18 的「只列进行中/只留最近完成一个」已回滚），
		*    本组件不再二次过滤内容 —— 否则列表与环会分叉。但**空组整组不渲染**（含组头，
		*    两组都空时整块列表不渲染）：全部完成时只有「已完成 · N」，不会出现「未完成 · 0」。
		*
		* 交互：整行是一个按钮（点击展开/收起），`aria-expanded` + `aria-controls` 指向详情块；
		* 展开是内联的（DESIGN §3.2），不做抽屉 —— 抽屉会把面板里的其它任务全遮住。
		*
		* 可逆动作（重试、跳过、取消）由 T7 在详情块里挂按钮；本组件只渲染事实，不执行动作，
		* 也不做确认判断（确认闸在宿主，客户端不得自行乐观放行）。
		*/
		/**
		* 组头文案（r18b 恢复）：两组都是全量任务，`open` 含所有非 done 状态。
		* 文案只允许出现在这里（TaskTable 是 props 驱动，历史详情页也用同一个组件）。
		*/
		const GROUP_LABEL = {
			open: "未完成",
			done: "已完成"
		};
		function TaskRow(props) {
			const { row, task, done, onToggleTask, member, onOpenMember } = props;
			const panel = row.expanded ? taskDetailOf(task) : null;
			const detailId = `auto-team-task-detail-${task.id}`;
			return /* @__PURE__ */ react.createElement("li", {
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
			}, /* @__PURE__ */ react.createElement("span", { "data-task-line": "title" }, done ? /* @__PURE__ */ react.createElement("span", {
				"data-done-mark": true,
				"aria-hidden": "true"
			}, "✓") : null, /* @__PURE__ */ react.createElement("span", {
				"data-task-title": true,
				title: row.title,
				"data-done": done ? "true" : "false"
			}, row.title), row.revisedText ? /* @__PURE__ */ react.createElement("span", {
				"data-task-revised": true,
				title: row.revisionNote ?? row.revisedText
			}, row.revisedText) : null, /* @__PURE__ */ react.createElement("span", {
				"data-badge": true,
				"data-tone": row.badge.tone,
				title: `状态：${row.badge.text}`
			}, /* @__PURE__ */ react.createElement("span", { "aria-hidden": "true" }, row.badge.icon), " ", row.badge.text), row.waitScopeText ? /* @__PURE__ */ react.createElement("span", {
				"data-task-wait-scope": true,
				title: task.waitReason ?? row.waitScopeText
			}, row.waitScopeText) : null), /* @__PURE__ */ react.createElement("span", { "data-task-line": "meta" }, /* @__PURE__ */ react.createElement("span", {
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
			}, row.durationText)), row.revisionNote ? /* @__PURE__ */ react.createElement("span", {
				"data-task-line": "note",
				"data-task-note": "revision",
				title: row.revisionNote
			}, "修订：", row.revisionNote) : null, row.cancelReason ? /* @__PURE__ */ react.createElement("span", {
				"data-task-line": "note",
				"data-task-note": "cancelled",
				title: row.cancelReason
			}, "取消原因：", row.cancelReason) : null), member !== void 0 && onOpenMember !== void 0 ? /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-task-open-member": true,
				"data-task-id": task.id,
				"data-member-id": member.memberId,
				title: `在主界面打开子智能体：${member.name}`,
				style: {
					margin: "0 12px 8px",
					padding: 0,
					border: 0,
					background: "transparent",
					color: "inherit",
					cursor: "pointer",
					font: "inherit",
					textAlign: "left"
				},
				onClick: () => onOpenMember(member, task.id)
			}, "子智能体 · ", member.name, " →") : null, panel ? /* @__PURE__ */ react.createElement("div", {
				id: detailId,
				"data-task-detail": true
			}, /* @__PURE__ */ react.createElement("dl", { "data-task-detail-grid": true }, /* @__PURE__ */ react.createElement("dt", null, "验收"), /* @__PURE__ */ react.createElement("dd", null, /* @__PURE__ */ react.createElement("code", { "data-detail-acceptance": true }, panel.acceptance)), /* @__PURE__ */ react.createElement("dt", null, "依赖"), /* @__PURE__ */ react.createElement("dd", { "data-detail-depends": true }, panel.dependsText), /* @__PURE__ */ react.createElement("dt", null, "写域"), /* @__PURE__ */ react.createElement("dd", { "data-detail-scope": true }, panel.scopeText), /* @__PURE__ */ react.createElement("dt", null, "消息"), /* @__PURE__ */ react.createElement("dd", { "data-detail-messages": true }, panel.messageText), panel.attemptsText ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("dt", null, "尝试"), /* @__PURE__ */ react.createElement("dd", { "data-detail-attempts": true }, panel.attemptsText)) : null, panel.waitReason ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("dt", null, "等待"), /* @__PURE__ */ react.createElement("dd", { "data-wait-reason": true }, panel.waitReason)) : null, panel.usageReason ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("dt", null, "用量"), /* @__PURE__ */ react.createElement("dd", { "data-detail-reason": true }, panel.usageReason)) : null, panel.usageMetrics ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("dt", null, "用量"), /* @__PURE__ */ react.createElement("dd", { "data-detail-usage": true }, /* @__PURE__ */ react.createElement("ul", { "data-usage-metrics": true }, panel.usageMetrics.map((metric) => /* @__PURE__ */ react.createElement("li", {
				key: metric.key,
				"data-usage-metric": metric.key,
				"data-available": metric.available ? "true" : "false"
			}, /* @__PURE__ */ react.createElement("span", { "data-usage-metric-label": true }, metric.label), /* @__PURE__ */ react.createElement("b", { "data-usage-metric-value": true }, metric.text)))))) : null, panel.durationReason ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("dt", null, "用时"), /* @__PURE__ */ react.createElement("dd", { "data-detail-reason": true }, panel.durationReason)) : null, panel.evidence ? /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("dt", null, "门禁"), /* @__PURE__ */ react.createElement("dd", { "data-gate-evidence": true }, /* @__PURE__ */ react.createElement("span", {
				"data-gate-exit": true,
				"data-exit-ok": panel.evidence.exitOk ? "true" : "false"
			}, panel.evidence.exitText), /* @__PURE__ */ react.createElement("code", { "data-gate-command": true }, panel.evidence.command), panel.evidence.tail.length > 0 ? /* @__PURE__ */ react.createElement("pre", { "data-gate-tail": true }, panel.evidence.tail.join("\n")) : null, panel.evidence.artifacts.length > 0 ? /* @__PURE__ */ react.createElement("span", { "data-gate-artifacts": true }, panel.evidence.artifacts.join(" · ")) : null, /* @__PURE__ */ react.createElement("span", { "data-gate-at": true }, panel.evidence.atText))) : null)) : null);
		}
		function TaskTable(props) {
			const { tasks, expandedTaskId, onToggleTask, grouped, members, onOpenMember } = props;
			if (tasks.length === 0) return /* @__PURE__ */ react.createElement(EmptyState, {
				title: "尚未生成计划",
				hint: "告诉队长要达成的目标，计划落盘后会自动开跑",
				next: "对队长说一句话即可"
			});
			if (grouped === true) {
				const overview = taskOverviewOf(tasks, expandedTaskId);
				const byId = new Map(tasks.map((task) => [task.id, task]));
				const groups = ["open", "done"].map((key) => ({
					key,
					rows: overview.groups[key]
				})).filter((group) => group.rows.length > 0);
				if (groups.length === 0) return /* @__PURE__ */ react.createElement(react.Fragment, null);
				return /* @__PURE__ */ react.createElement("div", {
					"data-region": "task-list",
					"data-grouped": "true"
				}, groups.map(({ key, rows }) => /* @__PURE__ */ react.createElement("section", {
					key,
					"data-task-group": key
				}, /* @__PURE__ */ react.createElement("div", { "data-group-head": true }, `${GROUP_LABEL[key]} · ${rows.length}`), /* @__PURE__ */ react.createElement("ul", { "data-task-rows": true }, rows.map((row) => {
					const task = byId.get(row.id);
					if (task === void 0) return null;
					return /* @__PURE__ */ react.createElement(TaskRow, {
						key: row.id,
						row,
						task,
						done: key === "done",
						onToggleTask,
						member: memberForRole(members, task.roleId, task.id),
						onOpenMember
					});
				})))));
			}
			return /* @__PURE__ */ react.createElement("div", { "data-region": "task-list" }, /* @__PURE__ */ react.createElement("div", {
				"data-task-head": true,
				"aria-hidden": "true"
			}, /* @__PURE__ */ react.createElement("span", { "data-head-cell": "left" }, TASK_TABLE_HEADER.left), /* @__PURE__ */ react.createElement("span", { "data-head-cell": "token" }, TASK_TABLE_HEADER.token), /* @__PURE__ */ react.createElement("span", { "data-head-cell": "duration" }, TASK_TABLE_HEADER.duration)), /* @__PURE__ */ react.createElement("ul", { "data-task-rows": true }, tasks.map((task) => /* @__PURE__ */ react.createElement(TaskRow, {
				key: task.id,
				row: taskRowOf(task, expandedTaskId === task.id),
				task,
				done: task.status === "done",
				onToggleTask,
				member: memberForRole(members, task.roleId, task.id),
				onOpenMember
			}))));
		}
		// src/client/views/TaskOverview.tsx
		/**
		* 任务总览（r14 AC-10 / AC-11）：左边进度环、右边分组任务列表。
		*
		* 为什么把「环 + 列表」绑成一件：AC-11 要求改一个任务状态后，环与两组计数在**同一帧**
		* 一起更新。如果环和列表各自派生，就可能一帧里环已经是 3/5、列表还是「未完成 · 3」。
		* 本组件先调一次 `taskOverviewOf`（环的 done/total/ratio/dashOffset 与两组行视图），
		* 再把 `tasks` 交给 `TaskTable grouped` —— 后者用的是同一个纯函数，输入相同结果必然相同。
		*
		* 布局（DESIGN §2.3）：`[环 64px][gap 12][列表 220px]`，环列 sticky 顶部（滚列表时环不动）。
		* 列表列必须 `min-width: 0`，否则 220px 的列会被内容撑破（grid 的默认 min-width:auto）。
		*
		* r18b：环与列表都按**全量**任务算（`groups.open` 含所有非 done 状态，
		* `groups.done` 含所有 done），r18 的「只列进行中 / 只留最近完成一个」已按用户要求回滚。
		* 组件不二次筛选；空组由 TaskTable 的 grouped 分支隐藏。
		*/
		function TaskOverview(props) {
			const { tasks, expandedTaskId, onToggleTask, members, onOpenMember } = props;
			const overview = taskOverviewOf(tasks, expandedTaskId);
			return /* @__PURE__ */ react.createElement("section", {
				"data-task-overview": true,
				"aria-label": "任务总览"
			}, /* @__PURE__ */ react.createElement("div", { "data-overview-ring": true }, /* @__PURE__ */ react.createElement(ProgressRing, {
				done: overview.done,
				total: overview.total,
				size: 80,
				dashOffset: overview.dashOffset
			})), /* @__PURE__ */ react.createElement("div", { "data-overview-list": true }, /* @__PURE__ */ react.createElement(TaskTable, {
				tasks,
				expandedTaskId,
				onToggleTask,
				members,
				onOpenMember,
				grouped: true
			})));
		}
		// src/client/LibraryPage.tsx
		/**
		* 左栏「自动团队」栏目 + 项目库（r13 AC-23/24/25，r14 AC-13/15/16/17 改造）。
		*
		* 结构（DESIGN §3）：`[data-library-shell]` → `[data-library-head]`（44px）+
		* `[data-library-body]`（分栏容器，持 `--lib-list-w` 变量）：
		*  - `[data-region="project-list"]`：首行「全局」、已知项目桶、固定末位的
		*    `[data-bucket="history"]` 历史桶（未记录工作区的旧 run），列宽 160–360 可拖；
		*  - `[data-split-handle]`：6px 分隔条，双击复位、键盘 ±8px（仅容器 ≥560px 可见）；
		*  - `[data-region="project-detail"]`：项目头 + run 列表（`[data-run-row]`）+ 项目记忆；
		*    点 run 行在页面右侧打开 `RunDrawer`（**不卸载背景列表**，否则 scrollTop/焦点必丢）。
		*
		* 三条硬约束：
		*  1. **AC-23**：`loadLibrary()` 只在本组件挂载时调用一次（页面打开才装配），不参与快照轮询；
		*  2. **AC-17**：抽屉内容与右栏同一套组件、同一个 `buildRunDetail`，绝不内联第二份任务表；
		*  3. **AC-16**：打开抽屉前记住 `project-detail` 的 scrollTop 与 `document.activeElement`，
		*     关闭动画结束、状态归零后用 rAF 复原——所以抽屉的 `openRunId` 是单值，DOM 内最多一个。
		*
		* 数字/时长文案一律来自宿主下发的 cell（`tokenTextOf` / `durationTextOf`），本页不二次格式化。
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
			const nav = react.useSyncExternalStore(subscribeMainNav, mainNavView, mainNavView);
			const propsSessionId = sessionIdOf(props);
			const staleMemberNav = isStaleMemberNav(propsSessionId, nav);
			const sessionId = staleMemberNav ? propsSessionId : resolveMemberSessionId(propsSessionId, nav);
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
			const [listWidth, setListWidth] = react.useState(220);
			const [dragging, setDragging] = react.useState(false);
			const dragRef = react.useRef(null);
			const [openRunId, setOpenRunId] = react.useState(null);
			const detailRef = react.useRef(null);
			const pendingFocusRef = react.useRef(null);
			const pendingScrollRef = react.useRef(0);
			const readMemory = react.useCallback((track, name, workspace) => panelApi.readMemory(sessionId, track, name, workspace), [sessionId]);
			/**
			* r18 t3：只列「用过自动团队」的项目（runs > 0），0 次运行的整项隐藏。
			* 过滤收在纯函数 `visibleProjectsOf` 里（单一事实源），本页只做既有分桶：
			* 「全局」固定在最上；已知项目按宿主给的最近活跃顺序；历史桶固定末位（PRD §11 默认值）。
			*/
			const projects = react.useMemo(() => {
				const visible = visibleProjectsOf(library?.projects ?? []);
				const known = visible.filter((project) => project.unknown !== true);
				const unknown = visible.filter((project) => project.unknown === true);
				return [...known, ...unknown];
			}, [library]);
			const knownProjects = react.useMemo(() => projects.filter((project) => project.unknown !== true), [projects]);
			const historyProjects = react.useMemo(() => projects.filter((project) => project.unknown === true), [projects]);
			/**
			* r18 t3：选中项可能正好被过滤掉（0 run 项目 / 被隐藏的历史桶）——
			* 不能留一块空白详情：回落到仍可见的第一个项目；一个项目都不剩才回到「全局」。
			* `global` 是固定行，不参与过滤，永远可选。
			*/
			const storedId = picked !== "" ? picked : library?.currentProject ?? "global";
			const selectedId = storedId === "global" || projects.some((project) => project.id === storedId) ? storedId : projects[0]?.id ?? "global";
			const selectedProject = projects.find((project) => project.id === selectedId);
			const globalItems = library?.global.memories ?? [];
			const projectItems = selectedProject?.memories ?? [];
			const openSummary = openRunId !== null && selectedProject !== void 0 ? selectedProject.recentRuns.find((run) => run.runId === openRunId) : void 0;
			const openGoal = openSummary !== void 0 ? goalTitleOf(openSummary.goal, openSummary.runId) : void 0;
			const drawerSubtitle = openSummary !== void 0 ? [
				openSummary.runId.slice(-6),
				openSummary.planStatus,
				tokenTextOf(openSummary.usage),
				openSummary.duration.text
			].join(" · ") : openRunId ?? "";
			const detailView = react.useMemo(() => openRunId === null ? null : buildRunDetail({
				snapshot: view.snapshot,
				library,
				runDetail: view.detail ?? void 0
			}, openRunId), [
				openRunId,
				view.snapshot,
				view.detail,
				library
			]);
			const detailTaskIds = react.useMemo(() => detailView === null ? [] : detailView.tasks.map((task) => task.id), [detailView]);
			const memberId = nav.kind === "member" ? nav.memberId : "";
			const memberTaskId = nav.kind === "member" ? nav.taskId : void 0;
			const currentRunDetail = react.useMemo(() => buildRunDetail({ snapshot: view.snapshot }), [view.snapshot]);
			const memberView = react.useMemo(() => {
				if (memberId === "") return null;
				const member = view.snapshot?.members.find((item) => item.memberId === memberId);
				if (member === void 0) return null;
				const task = (currentRunDetail === null ? [] : currentRunDetail.tasks).find((item) => item.id === (memberTaskId ?? member.taskId)) ?? null;
				return memberPageOf({
					member,
					role: currentRunDetail === null ? null : currentRunDetail.roles.find((role) => role.roleId === member.roleId) ?? null,
					roleDefinition: view.snapshot?.roles.find((role) => role.id === member.roleId) ?? null,
					task,
					messages: view.snapshot?.messages ?? [],
					audits: view.snapshot?.routeAudits ?? []
				});
			}, [
				memberId,
				memberTaskId,
				view.snapshot,
				currentRunDetail
			]);
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
			/** 切项目：关掉抽屉、清掉记忆展开态（记忆正文属于上一个项目，不能串台）。 */
			function pickProject(id) {
				if (openRunId !== null) closeDrawer();
				setPicked(id);
				setOpenMemory(void 0);
				setMemoryBody(void 0);
				setMemoryError(void 0);
			}
			react.useEffect(() => {
				if (!dragging) return void 0;
				const body = document.body;
				const previousCursor = body.style.cursor;
				const previousSelect = body.style.userSelect;
				body.style.cursor = "col-resize";
				body.style.userSelect = "none";
				return () => {
					body.style.cursor = previousCursor;
					body.style.userSelect = previousSelect;
				};
			}, [dragging]);
			function onHandlePointerDown(event) {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				event.preventDefault();
				const handle = event.currentTarget;
				dragRef.current = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startWidth: listWidth
				};
				try {
					handle.setPointerCapture(event.pointerId);
				} catch {}
				handle.focus();
				setDragging(true);
			}
			function onHandlePointerMove(event) {
				const drag = dragRef.current;
				if (drag === null || drag.pointerId !== event.pointerId) return;
				setListWidth(nextListWidth(drag.startWidth, event.clientX - drag.startX));
			}
			function endHandleDrag(event) {
				if (dragRef.current === null) return;
				dragRef.current = null;
				setDragging(false);
				const handle = event.currentTarget;
				try {
					if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
				} catch {}
			}
			function onHandleKeyDown(event) {
				let next;
				if (event.key === "ArrowLeft") next = nextListWidth(listWidth, -8);
				else if (event.key === "ArrowRight") next = nextListWidth(listWidth, 8);
				else if (event.key === "Home") next = 160;
				else if (event.key === "End") next = 360;
				if (next === void 0) return;
				event.preventDefault();
				setListWidth(next);
			}
			function resetListWidth() {
				setListWidth(clampListWidth(220));
			}
			function openDrawer(runId) {
				const pane = detailRef.current;
				pendingScrollRef.current = pane === null ? 0 : pane.scrollTop;
				const active = typeof document === "undefined" ? null : document.activeElement;
				pendingFocusRef.current = active instanceof HTMLElement ? active : null;
				setOpenRunId(runId);
				view.openRun(runId);
			}
			function closeDrawer() {
				setOpenRunId(null);
				view.closeRun();
				const focus = pendingFocusRef.current;
				pendingFocusRef.current = null;
				const scrollTop = pendingScrollRef.current;
				const restore = () => {
					const pane = detailRef.current;
					if (pane !== null) pane.scrollTop = scrollTop;
					if (focus !== null && focus.isConnected) focus.focus();
				};
				if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
				else restore();
			}
			function selectDrawerTask(taskId) {
				expandTask(taskId);
				const ids = detailTaskIds;
				if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => scrollToTaskRow(taskId, ids));
				else scrollToTaskRow(taskId, ids);
			}
			const splitStyle = { "--lib-list-w": `${listWidth}px` };
			return /* @__PURE__ */ react.createElement("div", {
				"data-library-shell": true,
				"data-library-page": props.root,
				"data-library-view": nav.kind,
				"data-member-id": memberId === "" ? void 0 : memberId
			}, /* @__PURE__ */ react.createElement("div", { "data-library-head": true }, /* @__PURE__ */ react.createElement("strong", { "data-library-title": true }, "自动团队"), /* @__PURE__ */ react.createElement("span", {
				"data-library-sub": true,
				"data-project-count": projects.length
			}, library === null ? "读取中…" : `${projects.length} 个项目`), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-library-refresh": true,
				disabled: view.loading && library === null,
				onClick: () => void loadLibrary()
			}, "刷新")), nav.kind === "member" && !staleMemberNav ? /* @__PURE__ */ react.createElement("div", {
				"data-member-surface": true,
				style: {
					flex: 1,
					minWidth: 0,
					minHeight: 0
				}
			}, /* @__PURE__ */ react.createElement(MemberPage, {
				view: memberView,
				memberId,
				onBack: openLibraryNav,
				surface: props.inline === true ? "panel" : "main"
			})) : /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement("div", {
				"data-library-body": true,
				"data-project-split": true,
				style: splitStyle
			}, /* @__PURE__ */ react.createElement("div", {
				"data-region": "project-list",
				"aria-label": "项目"
			}, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-auto-team-nav": true,
				"data-nav-kind": "global",
				"data-active": selectedId === "global" ? "true" : "false",
				onClick: () => pickProject("global")
			}, /* @__PURE__ */ react.createElement("span", { "data-nav-name": true }, "全局"), /* @__PURE__ */ react.createElement("span", { "data-nav-meta": true }, globalItems.length, " 条公共记忆")), knownProjects.length > 0 ? /* @__PURE__ */ react.createElement("div", { "data-bucket": "projects" }, /* @__PURE__ */ react.createElement("div", { "data-bucket-head": true }, /* @__PURE__ */ react.createElement("span", null, "项目"), /* @__PURE__ */ react.createElement("span", { "data-bucket-count": true }, knownProjects.length)), /* @__PURE__ */ react.createElement("ul", { "data-bucket-list": true }, knownProjects.map((project) => {
				const nav = projectNavOf(project, project.id === selectedId);
				return /* @__PURE__ */ react.createElement("li", { key: project.id }, /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-auto-team-nav": true,
					"data-nav-kind": "project",
					"data-project-id": nav.id,
					"data-active": nav.active ? "true" : "false",
					title: nav.path ?? nav.name,
					onClick: () => pickProject(nav.id)
				}, /* @__PURE__ */ react.createElement("span", { "data-nav-name": true }, nav.name), /* @__PURE__ */ react.createElement("span", { "data-nav-meta": true }, nav.metaText), /* @__PURE__ */ react.createElement("span", {
					"data-nav-token": true,
					"data-usage-source": project.usage.source,
					title: nav.tokenTitle
				}, nav.tokenText)));
			}))) : null, historyProjects.length > 0 ? /* @__PURE__ */ react.createElement("div", { "data-bucket": "history" }, /* @__PURE__ */ react.createElement("div", {
				"data-bucket-head": true,
				title: "旧版本 run 未记录工作区，无法自动归类"
			}, /* @__PURE__ */ react.createElement("span", null, "历史运行"), /* @__PURE__ */ react.createElement("span", { "data-bucket-count": true }, historyProjects.length)), /* @__PURE__ */ react.createElement("ul", { "data-bucket-list": true }, historyProjects.map((project) => {
				const nav = projectNavOf(project, project.id === selectedId);
				return /* @__PURE__ */ react.createElement("li", { key: project.id }, /* @__PURE__ */ react.createElement("button", {
					type: "button",
					"data-auto-team-nav": true,
					"data-nav-kind": "history",
					"data-project-id": nav.id,
					"data-active": nav.active ? "true" : "false",
					title: nav.path ?? nav.name,
					onClick: () => pickProject(nav.id)
				}, /* @__PURE__ */ react.createElement("span", { "data-nav-name": true }, nav.name), /* @__PURE__ */ react.createElement("span", { "data-nav-meta": true }, nav.metaText), /* @__PURE__ */ react.createElement("span", {
					"data-nav-token": true,
					"data-usage-source": project.usage.source,
					title: nav.tokenTitle
				}, nav.tokenText)));
			}))) : null), /* @__PURE__ */ react.createElement("div", {
				role: "separator",
				"aria-orientation": "vertical",
				"aria-label": "调整项目列表宽度",
				"aria-valuemin": 160,
				"aria-valuemax": 360,
				"aria-valuenow": listWidth,
				tabIndex: 0,
				"data-split-handle": true,
				"data-dragging": dragging ? "true" : "false",
				onPointerDown: onHandlePointerDown,
				onPointerMove: onHandlePointerMove,
				onPointerUp: endHandleDrag,
				onPointerCancel: endHandleDrag,
				onDoubleClick: resetListWidth,
				onKeyDown: onHandleKeyDown
			}), /* @__PURE__ */ react.createElement("div", {
				"data-region": "project-detail",
				ref: detailRef
			}, library === null && libraryError === null ? /* @__PURE__ */ react.createElement(EmptyState, {
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
				openRunId,
				onOpenRun: openDrawer,
				memories: projectItems,
				expandedMemory: openMemory?.track === "project" ? openMemory.name : void 0,
				memoryBody: memoryLoading ? void 0 : memoryBody,
				memoryError,
				onOpenMemory: (item) => void openMemoryItem("project", item, selectedProject.path)
			}), libraryError !== null && library !== null ? /* @__PURE__ */ react.createElement("p", {
				"data-error": true,
				"data-error-scope": "library",
				role: "alert"
			}, libraryError) : null, /* @__PURE__ */ react.createElement("p", {
				"data-library-foot": true,
				"data-library-project-meta": true,
				style: {
					margin: "12px 0 0",
					color: "var(--dsw-alias-label-tertiary, inherit)"
				}
			}, "宿主未暴露左栏宽度接口，外框宽度固定"))), /* @__PURE__ */ react.createElement(RunDrawer, {
				open: openRunId !== null,
				runId: openRunId ?? void 0,
				title: openGoal !== void 0 ? openGoal.text : "运行详情",
				subtitle: drawerSubtitle,
				onClose: closeDrawer
			}, detailView === null ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "正在读取运行详情…",
				hint: "宿主会从运行记录里装配任务、角色与流转",
				next: openRunId !== null ? `runId：${openRunId}` : void 0
			}) : /* @__PURE__ */ react.createElement(react.Fragment, null, /* @__PURE__ */ react.createElement(RunHeader, {
				detail: detailView,
				inflight: "idle"
			}), /* @__PURE__ */ react.createElement(RoleGrid, { roles: detailView.roles }), /* @__PURE__ */ react.createElement(TaskOverview, {
				tasks: detailView.tasks,
				expandedTaskId: expanded,
				onToggleTask: toggleTask
			}), /* @__PURE__ */ react.createElement(FlowCanvas, {
				flow: detailView.flow,
				onSelectTask: selectDrawerTask
			})))));
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
		/** 单项目面板：项目头（含历史桶说明）+ run 行列表 + 项目记忆。 */
		function ProjectPane(props) {
			const { project } = props;
			const history = project.unknown === true;
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
			}, project.path) : null, history ? /* @__PURE__ */ react.createElement("span", {
				"data-bucket-note": true,
				"data-library-project-meta": true
			}, "旧版本 run 未记录工作区，无法自动归类") : null), /* @__PURE__ */ react.createElement("section", { "data-library-section": "runs" }, /* @__PURE__ */ react.createElement("h4", { "data-library-section-title": true }, "最近运行"), project.recentRuns.length === 0 ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "这个项目还没有运行记录",
				hint: "计划落盘后自动派发，运行记录会出现在这里"
			}) : /* @__PURE__ */ react.createElement("ul", {
				"data-region": "history-list",
				"data-scope": "project",
				"data-count": project.recentRuns.length
			}, project.recentRuns.map((run) => {
				const row = projectRunRowOf(run);
				return /* @__PURE__ */ react.createElement(RunRow, {
					key: row.runId,
					row,
					active: props.openRunId === row.runId,
					onOpen: props.onOpenRun
				});
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
		function PanellistEntry(props) {
			const size = typeof props.size === "number" ? props.size : 16;
			const openLibrary = props.openLibrary;
			const [result, setResult] = react.useState("none");
			const [openError, setOpenError] = react.useState(false);
			const timers = react.useRef([]);
			react.useEffect(() => () => {
				for (const timer of timers.current) clearTimeout(timer);
				timers.current = [];
			}, []);
			/** 以 DOM 里真实可见的 surface 为准：`open()` 说成功但主区没挂载时必须落到降级结果。 */
			function settle(immediate) {
				const surface = visibleLibrarySurface();
				setResult(surface === "main" ? "main" : surface === "panel" ? "event" : immediate === "event" ? "event" : "error");
			}
			function onClick() {
				if (typeof openLibrary !== "function") return;
				let immediate = "error";
				try {
					immediate = openLibrary();
				} catch {
					immediate = "error";
				}
				const failed = immediate === "error";
				setResult(immediate);
				setOpenError(failed);
				if (failed) timers.current.push(setTimeout(() => {
					setOpenError(false);
				}, 2e3));
				timers.current.push(setTimeout(() => {
					settle(immediate);
				}, 700));
			}
			const interactive = typeof openLibrary === "function";
			return /* @__PURE__ */ react.createElement("svg", {
				"data-auto-team-panellist": true,
				"data-panellist-glyph": true,
				"data-last-open-result": result,
				"data-open-error": openError ? "true" : void 0,
				style: interactive ? { pointerEvents: "auto" } : void 0,
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				role: "presentation",
				focusable: "false",
				fill: "none",
				stroke: openError ? "var(--dsw-alias-state-error-primary)" : "currentColor",
				strokeWidth: "1.2",
				strokeLinecap: "round",
				onClick: interactive ? onClick : void 0
			}, /* @__PURE__ */ react.createElement("title", null, openError ? "项目库暂时打不开，请稍后再试" : "打开项目库"), /* @__PURE__ */ react.createElement("circle", {
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
			return /* @__PURE__ */ react.createElement("div", {
				"data-auto-team-library": true,
				"data-library-surface": props.inline === true ? "panel" : "main"
			}, /* @__PURE__ */ react.createElement(LibraryContent, {
				...props,
				root: "library"
			}));
		}
		// src/client/views/RunSwitcher.tsx
		/**
		* r18b t8：任务页顶部的 **run 横向滑动卡**（每个进行中的 run 一张卡）。
		*
		* 用户口径（2026-11-05）：「每条 run 做成一个卡，多个同时进行的任务通过点卡切换查看详情」，
		* 并选定「横向滑动卡，六项在卡内两行」。
		*
		* 结构与语义：
		*  - 外层仍是 `<section data-region="run-switcher" data-active-runs data-fallback>`；
		*  - 里面一层 `span[data-active-run-cards]`（display:flex + overflow-x:auto）负责横滑。
		*    这里刻意用 `span` 而不是 `div`：整块只装 phrasing content，容器本身也是 phrasing；
		*  - 每张卡是一个 `<button data-active-run>`（整卡可点，点哪张就切哪个 run），
		*    卡内只有 `span` / `b`（button 的内容模型限制），三行靠 CSS grid 放置；
		*    r18b t9（用户：「任务卡高度可以再小一些，以任务名称显示为主」）把三行压成
		*    「①标题 + 状态徽标（同一 header span，标题占满剩余宽度）②meta ③六项」；
		*    r18b t10 真机实测发现 t9 的「label + value 同行」在 63px 列宽里全被省略号截断
		*    （「输入未命中 246.…」「缓存命中率 7」），用户要求「其他辅助信息要显示全」，
		*    于是六项回到**同一格内上下两行**（label 上 / value 下），靠行高与间距把卡高
		*    控制在 96–108px；结构、文案与所有钩子与 t9 完全一致，只改 CSS 排布；
		*  - 标题/状态徽标/meta/token 六项全部来自 `RunRowView`（与历史列表同一套投影），
		*    组件不格式化数字、不拼时间。
		*
		* 旧钩子（`data-run-cards` / `data-run-card` / `data-run-back`）保持为零：
		* 选中语义只靠 `data-selected` / `aria-pressed`，「当前 run」只靠 `data-current`。
		*
		* r24：残留计划（`row.residualBadge` 存在）的卡下方注入「终止计划」入口。入口由调用方
		* 通过 `residualAction` 渲染（本组件不 import 弹窗/动作层）：卡本身是 `button`，终止按钮
		* 不能嵌套，只能作为兄弟节点，所以这类卡外面多一层 `span[data-active-run-item]`。
		* 非残留卡（以及调用方没接入口时）输出与 r18 完全一致，不新增任何包装节点。
		*/
		function RunSwitcher(props) {
			const { view, onSelect, busy = false, residualAction } = props;
			const pick = (runId) => {
				if (busy) return;
				onSelect(runId);
			};
			return /* @__PURE__ */ react.createElement("section", {
				"data-region": "run-switcher",
				"data-active-runs": view.rows.length,
				"data-fallback": view.fallback ? "true" : "false",
				"aria-label": "进行中的 run"
			}, /* @__PURE__ */ react.createElement("span", { "data-active-run-cards": true }, view.rows.map((row) => {
				const card = cardOf(row, busy, pick);
				const extra = row.residualBadge === void 0 ? null : residualAction?.(row);
				if (extra === null || extra === void 0 || extra === false) return card;
				return /* @__PURE__ */ react.createElement("span", {
					key: row.runId,
					"data-active-run-item": true,
					"data-residual": "true"
				}, card, extra);
			})));
		}
		/**
		* 单张 run 卡（横滑容器的直接子元素）。
		*
		* 声明放在组件之后：`test/r18-styles.test.ts` 用源码顺序断言「横滑容器先于卡」，
		* 把卡挪进前面的辅助函数会让 `data-active-run-cards` 出现在 `<button` 之后而假红。
		*/
		function cardOf(row, busy, pick) {
			return /* @__PURE__ */ react.createElement("button", {
				key: row.runId,
				type: "button",
				"data-active-run": true,
				"data-run-id": row.runId,
				"data-current": row.current ? "true" : "false",
				"data-selected": row.selected ? "true" : "false",
				"data-ongoing": row.hasOngoing ? "true" : "false",
				"aria-pressed": row.selected,
				title: row.titleTitle ?? row.title,
				disabled: busy,
				onClick: () => pick(row.runId)
			}, /* @__PURE__ */ react.createElement("span", { "data-active-run-head": true }, /* @__PURE__ */ react.createElement("span", {
				"data-active-run-title": true,
				"data-title-source": row.titleSource
			}, row.title), /* @__PURE__ */ react.createElement("span", {
				"data-active-run-status": true,
				"data-tone": row.statusTone,
				title: row.statusTitle === void 0 ? `状态：${row.statusText}` : `状态：${row.statusText} · ${row.statusTitle}`
			}, /* @__PURE__ */ react.createElement("span", { "aria-hidden": "true" }, row.statusIcon), " ", row.statusText)), /* @__PURE__ */ react.createElement("span", {
				"data-active-run-meta": true,
				title: row.metaText
			}, row.cardMetaText), row.usageMetrics.length > 0 ? /* @__PURE__ */ react.createElement("span", { "data-active-run-usage": true }, row.usageMetrics.map((metric) => /* @__PURE__ */ react.createElement("span", {
				key: metric.key,
				"data-active-run-metric": metric.key,
				"data-available": metric.available ? "true" : "false",
				title: `${metric.label}：${metric.text}`
			}, /* @__PURE__ */ react.createElement("span", { "data-active-run-metric-label": true }, metric.label), " ", /* @__PURE__ */ react.createElement("b", { "data-active-run-metric-value": true }, metric.text)))) : null);
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
		// src/client/views/RunCloseAction.tsx
		/**
		* r24 t2：一行「未收口·可能残留」的 run 的**终止入口**（历史列表 / 顶部 run 卡共用）。
		*
		* 为什么单独一个组件：两处都要「徽标 + 终止按钮 + 二次确认 + 失败原因」，
		* 各写一份就会在第一次改文案/改动作名时漂移。这里只做一件事：
		* 把 `PanelAction.closeRun` 包上既有 `ConfirmDialog`（`confirmDialogOf` 的动词表已含 closeRun），
		* 成功靠宿主返回的新快照原地刷新，失败把 `rejected.message` 显示在这一行（**不静默**）。
		*
		* 本仓没有 `react-dom`（见 `src/client/ui.ts` 文件头），所以确认弹窗按既有做法内联渲染，
		* 由 `ConfirmDialog` 的 fixed/inline 双模式兜住窄面板与定位上下文 —— 不做 `createPortal`。
		*/
		function RunCloseAction(props) {
			const { runId, badge, act, variant = "history" } = props;
			const [pending, setPending] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [notice, setNotice] = react.useState(null);
			/**
			* 本行已经终止成功。宿主的 `runs` 列表有 5s memo，动作返回的新快照里这一行可能
			* 还是「派发中」——先按已终止渲染（不再显示「未收口」徽标），等快照追上来。
			*/
			const [done, setDone] = react.useState(false);
			const triggerRef = react.useRef(null);
			/** 只在「弹窗从开到关」时把焦点还给触发按钮，挂载时绝不抢焦点。 */
			const wasOpen = react.useRef(false);
			react.useEffect(() => {
				if (pending) {
					wasOpen.current = true;
					return;
				}
				if (!wasOpen.current) return;
				wasOpen.current = false;
				triggerRef.current?.focus();
			}, [pending]);
			const dialogPending = react.useMemo(() => closeRunPendingOf(runId), [runId]);
			const confirm = async () => {
				if (busy) return;
				setBusy(true);
				setError(null);
				setNotice(null);
				const feedback = await actFeedback(act, {
					type: "closeRun",
					runId
				});
				setBusy(false);
				setPending(false);
				if (feedback.ok) {
					setDone(true);
					setNotice(hintOf(feedback) ?? "已终止该残留计划");
					return;
				}
				setError(hintOf(feedback) ?? "终止失败：宿主未说明原因，请稍后重试");
			};
			return /* @__PURE__ */ react.createElement("span", {
				"data-run-close": true,
				"data-run-close-for": runId,
				"data-variant": variant,
				"data-done": done ? "true" : "false"
			}, done ? null : /* @__PURE__ */ react.createElement("span", {
				"data-badge": true,
				"data-tone": badge.tone,
				"data-residual-run": true,
				title: RESIDUAL_RUN_TITLE
			}, /* @__PURE__ */ react.createElement("span", { "aria-hidden": "true" }, badge.icon), " ", badge.text), notice !== null ? /* @__PURE__ */ react.createElement("span", {
				"data-run-close-notice": true,
				role: "status"
			}, notice) : null, error !== null ? /* @__PURE__ */ react.createElement("span", {
				"data-run-close-error": true,
				role: "alert",
				title: error
			}, error) : null, /* @__PURE__ */ react.createElement("button", {
				ref: triggerRef,
				type: "button",
				"data-close-run": runId,
				title: done ? CLOSE_RUN_DONE_TEXT : `${CLOSE_RUN_LABEL}：${runId}（不可撤销）`,
				disabled: busy,
				"aria-busy": busy,
				"aria-disabled": done,
				onClick: () => {
					if (done || busy) return;
					setError(null);
					setNotice(null);
					setPending(true);
				}
			}, CLOSE_RUN_LABEL), pending ? /* @__PURE__ */ react.createElement(ConfirmDialog, {
				pending: dialogPending,
				busy,
				onConfirm: () => void confirm(),
				onReject: () => {
					if (busy) return;
					setPending(false);
				}
			}) : null);
		}
		// src/client/tabs/TasksTab.tsx
		/**
		* 「任务」页（r14 AC-4 / AC-7 / AC-10 / AC-11；r17 加 run 切换与成员导航）。
		*
		* 组成（DESIGN §1 的自上而下顺序）：
		*   `RunSwitcher`（进行中 run 的行列表；没有进行中的 run 时显示最后一条，r18b t2）
		*   → `RunHeader`（run 头：计划状态、开始时间、合计 token/用时、暂停）
		*   → `RoleGrid`（角色卡片 2 列：状态/当前任务/用量/用时，点卡片打开子智能体）
		*   → `TaskOverview`（左进度环 + 右「未完成/已完成」分组列表，任务行可打开子智能体）
		*   → `FlowCanvas`（可平移流转画布，点节点打开执行该节点的子智能体）
		*
		* 为什么没有「派发」按钮（AC-11）：计划落盘后由宿主自动派发，界面上**不允许**出现一个
		* 「点了也常常失败」的派发按钮。用户能做的只有暂停/继续与任务级可逆动作。
		*
		* 数据全部来自 `buildRunDetail({snapshot})` —— 与左栏历史详情共用同一个装配函数（AC-18），
		* 所以两处的任务表不可能出现不同的 token/用时。历史 run 走显式的 `runDetail` 分支，
		* 且**不提供成员导航**（历史快照没有成员/消息，导过去只会是空页）。
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
			const historicalRunId = props.detailRunId !== null && props.detailRunId !== snapshot?.runId ? props.detailRunId : null;
			const detail = react.useMemo(() => historicalRunId === null ? buildRunDetail({ snapshot: snapshot ?? null }) : buildRunDetail({
				snapshot: snapshot ?? null,
				runDetail: props.detail ?? void 0
			}, historicalRunId), [
				snapshot,
				props.detail,
				historicalRunId
			]);
			const inflight = useInflight(snapshot);
			const stage = react.useMemo(() => {
				if (detail === null) return void 0;
				const current = historicalRunId === null && snapshot !== void 0;
				const counts = current && snapshot.runCounts !== void 0 ? snapshot.runCounts : {};
				const memberCount = current ? (snapshot.members ?? []).length : void 0;
				return stageOfDetail(detail, memberCount === void 0 ? counts : {
					...counts,
					members: memberCount
				});
			}, [
				detail,
				historicalRunId,
				snapshot
			]);
			const planGoal = react.useMemo(() => {
				if (historicalRunId !== null || snapshot === void 0 || detail === null) return null;
				if (detail.runId !== snapshot.runId) return null;
				return planGoalOf(snapshot.goal, snapshot.revisions, snapshot.runId);
			}, [
				historicalRunId,
				snapshot,
				detail
			]);
			const detailLoading = historicalRunId !== null && detail === null && props.libraryError === null;
			const runRows = react.useMemo(() => activeRunRowsOf({
				snapshot,
				selectedRunId: historicalRunId
			}), [snapshot, historicalRunId]);
			const taskIds = react.useMemo(() => detail === null ? [] : detail.tasks.map((task) => task.id), [detail]);
			const members = historicalRunId === null && snapshot !== void 0 ? snapshot.members : [];
			const openMember = (member, taskId) => {
				navigateToMember(props.sessionId, member.memberId, taskId);
			};
			const selectRun = (runId) => {
				if (runId === "") return;
				if (runId === snapshot?.runId) {
					if (props.detailRunId !== null) props.closeRun();
					return;
				}
				if (runId === historicalRunId) return;
				props.openRun(runId);
			};
			const runRowsBar = runRows === null ? null : /* @__PURE__ */ react.createElement(RunSwitcher, {
				view: runRows,
				onSelect: selectRun,
				busy: detailLoading,
				residualAction: (row) => row.residualBadge === void 0 ? null : /* @__PURE__ */ react.createElement(RunCloseAction, {
					runId: row.runId,
					badge: row.residualBadge,
					act: props.act,
					variant: "card"
				})
			});
			if (detail === null) {
				const empty = tasksEmptyStateOf({
					historicalRunId,
					libraryError: props.libraryError
				});
				return /* @__PURE__ */ react.createElement("div", {
					"data-region": "tasks-tab",
					"data-tab-scroll": "tasks",
					ref: scroll.ref,
					onScroll: scroll.onScroll
				}, runRowsBar, /* @__PURE__ */ react.createElement(EmptyState, {
					title: empty.title,
					hint: empty.hint,
					next: empty.next
				}));
			}
			return /* @__PURE__ */ react.createElement("div", {
				"data-region": "tasks-tab",
				"data-tab-scroll": "tasks",
				ref: scroll.ref,
				onScroll: scroll.onScroll
			}, runRowsBar, /* @__PURE__ */ react.createElement(RunHeader, {
				detail,
				paused: props.paused,
				inflight,
				onTogglePause: props.onTogglePause,
				plan: planGoal,
				stage
			}), /* @__PURE__ */ react.createElement(RoleGrid, {
				roles: detail.roles,
				members,
				onOpenMember: openMember
			}), /* @__PURE__ */ react.createElement(TaskOverview, {
				tasks: detail.tasks,
				expandedTaskId: expanded,
				onToggleTask: (taskId) => toggleTask(taskId),
				members,
				onOpenMember: openMember
			}), /* @__PURE__ */ react.createElement(FlowCanvas, {
				flow: detail.flow,
				members,
				onOpenMember: openMember,
				onSelectTask: (taskId) => {
					const task = detail.tasks.find((item) => item.id === taskId);
					const member = task === void 0 ? void 0 : memberForRole(members, task.roleId, task.id);
					if (member !== void 0) {
						openMember(member, taskId);
						return;
					}
					expandTask(taskId);
					if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => scrollToTaskRow(taskId, taskIds));
					else scrollToTaskRow(taskId, taskIds);
				}
			}));
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
			}), /* @__PURE__ */ react.createElement(FlowCanvas, {
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
					"data-title-source": row.titleSource,
					title: row.titleTitle ?? row.title
				}, row.title), /* @__PURE__ */ react.createElement("span", {
					"data-badge": true,
					"data-tone": row.statusTone,
					title: row.statusTitle === void 0 ? `状态：${row.statusText}` : `状态：${row.statusText} · ${row.statusTitle}`
				}, /* @__PURE__ */ react.createElement("span", { "aria-hidden": "true" }, row.statusIcon), " ", row.statusText)), /* @__PURE__ */ react.createElement("span", { "data-history-line": "meta" }, /* @__PURE__ */ react.createElement("span", { "data-history-time": true }, row.metaText), /* @__PURE__ */ react.createElement("span", {
					"data-history-duration": true,
					"data-duration-state": row.durationState,
					title: row.durationTitle
				}, /* @__PURE__ */ react.createElement("span", null, "用时 "), row.durationText), /* @__PURE__ */ react.createElement("span", {
					"data-history-token": true,
					"data-usage-source": row.tokenSource,
					title: row.tokenTitle
				}, row.tokenText)), row.residualBadge !== void 0 ? /* @__PURE__ */ react.createElement("span", { "data-history-line": "residual" }, /* @__PURE__ */ react.createElement(RunCloseAction, {
					runId: row.runId,
					badge: row.residualBadge,
					act: props.act,
					variant: "history"
				})) : null, row.terminationText !== void 0 ? /* @__PURE__ */ react.createElement("span", {
					"data-history-line": "termination",
					"data-history-termination": true,
					title: row.terminationText
				}, "终止原因：", row.terminationText) : null, row.usageMetrics.length > 0 ? /* @__PURE__ */ react.createElement("span", {
					"data-history-line": "usage",
					"data-history-usage": true
				}, row.usageMetrics.map((metric) => /* @__PURE__ */ react.createElement("span", {
					key: metric.key,
					"data-history-metric": metric.key,
					"data-usage-metric": metric.key,
					"data-available": metric.available ? "true" : "false",
					title: `${metric.label}：${metric.text}`
				}, /* @__PURE__ */ react.createElement("span", { "data-usage-metric-label": true }, metric.label), " ", /* @__PURE__ */ react.createElement("b", { "data-usage-metric-value": true }, metric.text)))) : null));
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
		* 「记忆」页（r13 AC-19/20/21；r23 记忆策展）。
		*
		* 只展示**本项目记忆**（`track=project`）：公共记忆属于「跨项目」，放在左栏项目库的「全局」行。
		*
		* r23 四条纪律：
		*  1. **禁止客户端解析 md**：等级/正文/来源/时间/修正次数全部用宿主下发的
		*     `MemoryFileView` / `MemoryEntryView`（`sourceText`、`stamp` 已格式化）；
		*  2. 列表只渲染文件汇总（配额、等级分布、条目数），点开才按需 `GET /memory` 拉条目；
		*  3. 「整理旧流水」先 dry-run 预览，确认后才 `dryRun:false` 写盘；失败保留列表与展开态，
		*     只显示原因，绝不清空成空态；
		*  4. 异步读取三态齐全：加载中 / 失败 + 重试 / 有数据（空正文单独一句）。
		*/
		function MemoryTab(props) {
			const scroll = useTabScroll("memory");
			const [openName, setOpenName] = react.useState(void 0);
			const [detail, setDetail] = react.useState(void 0);
			const [loading, setLoading] = react.useState(false);
			/** 读取序号：快速连点两个文件时，只认最后一次请求的结果（旧响应不许覆盖新展开项）。 */
			const readSeq = react.useRef(0);
			const memory = props.snapshot?.memory;
			const files = (memory?.files ?? []).filter((file) => file.track === "project" && file.legacy !== true);
			const quotaRow = memoryQuotaRowOf("project", memory?.quotas?.project, memory?.files ?? [], memory?.legacyFileCount);
			const injected = memory?.injectedChars ?? 0;
			const budget = memory?.budget ?? 0;
			const truncated = memory?.truncated === true;
			const memoryDegraded = memory?.degraded === true;
			const degradeReason = memory?.degradeReason;
			const legacyCount = memory?.legacyFileCount;
			const legacyKnown = typeof legacyCount === "number" && Number.isFinite(legacyCount);
			const noLegacy = legacyKnown && legacyCount === 0;
			const [curating, setCurating] = react.useState(false);
			const [curationReport, setCurationReport] = react.useState(void 0);
			const [curationError, setCurationError] = react.useState(void 0);
			const openFile = react.useCallback(async (file, force = false) => {
				if (!force && openName === file.name) {
					readSeq.current += 1;
					setOpenName(void 0);
					setDetail(void 0);
					setLoading(false);
					return;
				}
				const seq = readSeq.current += 1;
				setOpenName(file.name);
				setDetail(void 0);
				setLoading(true);
				try {
					const result = await props.readMemory("project", file.name);
					if (seq !== readSeq.current) return;
					if (result.error !== void 0) {
						setDetail({
							name: file.name,
							error: result.error
						});
						return;
					}
					setDetail({
						name: file.name,
						body: result.data?.body,
						entries: result.data?.entries
					});
				} catch (err) {
					if (seq !== readSeq.current) return;
					setDetail({
						name: file.name,
						error: err instanceof Error ? err.message : String(err)
					});
				} finally {
					if (seq === readSeq.current) setLoading(false);
				}
			}, [openName, props.readMemory]);
			function retryOpen() {
				const file = files.find((item) => item.name === openName);
				if (file === void 0) return;
				openFile(file, true);
			}
			async function runCuration(dryRun) {
				if (curating) return;
				setCurating(true);
				setCurationError(void 0);
				if (dryRun) setCurationReport(void 0);
				try {
					const outcome = memoryCurationOutcomeOf(await props.act({
						type: "curateMemory",
						track: "project",
						dryRun
					}));
					if (!outcome.ok) {
						setCurationError(outcome.message ?? "整理失败（宿主未说明原因）");
						return;
					}
					if (outcome.report === void 0) {
						setCurationError("宿主没有返回整理报告，请稍后重试");
						return;
					}
					setCurationReport(outcome.report);
				} catch (err) {
					setCurationError(err instanceof Error ? err.message : String(err));
				} finally {
					setCurating(false);
				}
			}
			const reportView = curationReport === void 0 ? void 0 : memoryCurationReportOf(curationReport);
			const legacyText = !legacyKnown ? "旧流水数量未下发（旧快照）" : legacyCount === 0 ? "旧流水 0 个文件：没有历史教训可整理" : `旧流水 ${legacyCount} 个文件（两轨合计）不参与注入；整理只处理本项目的历史流水`;
			return /* @__PURE__ */ react.createElement("div", {
				"data-region": "memory-tab",
				"data-tab-scroll": "memory",
				ref: scroll.ref,
				onScroll: scroll.onScroll
			}, /* @__PURE__ */ react.createElement("div", { "data-memory-stat": true }, /* @__PURE__ */ react.createElement("span", {
				"data-memory-track": "project",
				"data-memory-quota": true,
				"data-tone": quotaRow.tone,
				"data-memory-files": quotaRow.files,
				"data-memory-max-files": quotaRow.maxFiles,
				"data-memory-total-entries": quotaRow.totalEntries,
				title: `项目记忆主题文件 ${quotaRow.files}/${quotaRow.maxFiles}，活动条目共 ${quotaRow.totalEntries} 条`
			}, quotaRow.text), /* @__PURE__ */ react.createElement("span", {
				"data-memory-budget": true,
				"data-truncated": truncated ? "true" : "false"
			}, "注入 ", injected, "/", budget, " 字符", truncated ? "（已截断）" : "")), quotaRow.warnings.length === 0 ? null : /* @__PURE__ */ react.createElement("ul", {
				"data-memory-warnings": true,
				"aria-label": "记忆配额提示"
			}, quotaRow.warnings.map((warning) => /* @__PURE__ */ react.createElement("li", {
				key: warning.key,
				"data-memory-warning": true,
				"data-tone": warning.tone
			}, warning.text))), memoryDegraded ? /* @__PURE__ */ react.createElement("p", { "data-memory-degraded": true }, degradeReason ?? "未能解析本项目工作区：项目记忆暂时写进装配目录。") : null, /* @__PURE__ */ react.createElement("div", { "data-memory-curation": true }, /* @__PURE__ */ react.createElement("div", { "data-memory-curation-bar": true }, /* @__PURE__ */ react.createElement("span", { "data-memory-legacy": true }, legacyText), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-memory-curate": true,
				"data-busy": curating ? "true" : "false",
				disabled: curating || noLegacy,
				title: noLegacy ? "没有旧流水可整理" : "先预演（不写盘），确认后再执行",
				onClick: () => void runCuration(true)
			}, curating ? "整理中…" : "整理旧流水")), curationError === void 0 ? null : /* @__PURE__ */ react.createElement("div", { "data-memory-curation-error": true }, /* @__PURE__ */ react.createElement("p", {
				"data-error": true,
				role: "alert"
			}, curationError), /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-memory-curate-retry": true,
				disabled: curating,
				onClick: () => void runCuration(true)
			}, "重试预演")), reportView === void 0 ? null : /* @__PURE__ */ react.createElement("div", {
				"data-memory-curation-report": true,
				"data-phase": reportView.phase,
				role: "status",
				"aria-live": "polite"
			}, /* @__PURE__ */ react.createElement("p", { "data-memory-curation-headline": true }, reportView.headline), /* @__PURE__ */ react.createElement("ul", { "data-memory-curation-counts": true }, reportView.counts.map((line) => /* @__PURE__ */ react.createElement("li", {
				key: line,
				"data-memory-curation-count": true
			}, line))), reportView.warnings.length === 0 ? null : /* @__PURE__ */ react.createElement("ul", { "data-memory-curation-warnings": true }, reportView.warnings.map((warning) => /* @__PURE__ */ react.createElement("li", {
				key: warning,
				"data-memory-curation-warning": true
			}, warning))), /* @__PURE__ */ react.createElement("div", { "data-memory-curation-actions": true }, reportView.canApply ? /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-memory-curate-apply": true,
				disabled: curating,
				onClick: () => void runCuration(false)
			}, curating ? "写入中…" : reportView.applyLabel) : null, /* @__PURE__ */ react.createElement("button", {
				type: "button",
				"data-memory-curate-close": true,
				disabled: curating,
				onClick: () => {
					setCurationReport(void 0);
					setCurationError(void 0);
				}
			}, reportView.closeLabel)))), files.length === 0 ? /* @__PURE__ */ react.createElement(EmptyState, {
				title: "本项目还没有主题记忆",
				hint: "队长把约定沉淀成条目后，会按主题出现在这里",
				next: "也可以用「整理旧流水」把历史教训提炼进 pitfalls"
			}) : /* @__PURE__ */ react.createElement(MemoryList, {
				files,
				track: "project",
				expanded: openName,
				body: detail?.body,
				bodyError: detail?.error,
				entries: detail?.entries,
				entriesLoading: loading,
				onRetry: retryOpen,
				onOpen: (target) => void openFile(target)
			}), files.length > 0 ? /* @__PURE__ */ react.createElement("p", { "data-memory-hint": true }, "公共记忆见左栏「自动团队 → 全局」；条目等级 P0 铁律 / P1 教训 / P2 常规。") : null);
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
				const onOpenLibrary = () => {
					if (visibleLibrarySurface() === "main") {
						setInlineLibrary(false);
						return;
					}
					setInlineLibrary(true);
				};
				window.addEventListener(AUTO_TEAM_OPEN_LIBRARY_EVENT, onOpenLibrary);
				return () => window.removeEventListener(AUTO_TEAM_OPEN_LIBRARY_EVENT, onOpenLibrary);
			}, []);
			react.useEffect(() => {
				const pending = consumeLibraryOpenRequest();
				const surface = visibleLibrarySurface();
				if (surface === "main") {
					setInlineLibrary(false);
					return;
				}
				if (pending || surface === "panel") setInlineLibrary(true);
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
				title: capsule.title ?? capsule.text
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
			}, "← 返回面板"), /* @__PURE__ */ react.createElement("span", {
				"data-panel-library-hint": true,
				role: "status",
				"aria-live": "polite"
			}, /* @__PURE__ */ react.createElement("span", {
				"data-panel-library-warn": true,
				"aria-hidden": "true"
			}), "主区不可用，已在右栏打开")), /* @__PURE__ */ react.createElement(LibraryPage, {
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
