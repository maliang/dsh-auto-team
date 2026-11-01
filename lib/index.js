import { homedir } from "node:os";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
// src/shared/const.ts
/** 面板 HTTP 桥前缀：host/http.ts 与 client/api.ts 的一致契约（改一边必须改另一边）。 */
const BRIDGE_ROUTE = "/api/auto-team";
/** 记忆注入预算（字符）。AC-25：超出必须截断并在面板显示「已截断」。 */
const MEMORY_INJECT_BUDGET = 4e3;
/** 门禁输出尾部保留字符数（AC-19 证据抽屉只展示尾部，全文落盘）。 */
const GATE_TAIL_CHARS = 4e3;
/** 门禁命令默认超时（毫秒）。AC-19：超时按「未通过」处理，且不得阻塞事件循环（异步执行）。 */
const GATE_TIMEOUT_MS = 3e5;
/**
* 门禁日志「落盘 → 返回」的等待上限（毫秒）。
*
* 门禁执行完不能立刻 resolve：全量输出是流式写文件的，立刻返回会让调用方读到空/半截产物，
* 证据抽屉显示「无输出」（并行跑测试时必现的竞态）。这里等写流 close，但给一个上限兜底，
* 磁盘卡住时门禁也不能一直挂着。
*/
const GATE_FLUSH_TIMEOUT_MS = 1e3;
/**
* 停滞判定阈值（毫秒）：成员「活着但持续没有实质工具调用」多久算停滞（AC-13）。
*
* **全仓唯一定义处**：`team/stall.ts` 的 `stallOf()` 只接收参数、不自读常量，
* `watcher.tick`（告警出口）与 `bridge.membersOf`（展示出口）都从这里取阈值传入 ——
* 两处共用同一份判定实现 + 同一个阈值，才不会出现「面板说没停、日志说停了」的分叉。
* 判据：全仓 `STALL_MS` 的 `export const` 定义只允许出现在本文件（别处必须 import 或收参数）。
*/
const STALL_MS = 9e4;
/**
* noWait 守卫阈值（毫秒）：队长在**前台同步**等待超过这个时长即被拒（AC-4/AC-5）。
*
* 判据是「段首命令语义 + 时长」而不是字符串包含 `sleep` —— 误杀正常命令是这个守卫最大
* 的风险（守卫把队长自己的工作挡死，比不守卫更糟），所以只拦明确的等待语义：
* `sleep N`（N 超阈值）、`wait`、前台 `tail -f`、阻塞式 `read`。轮询式轮询 `for i in 1..10; do sleep 1; done`
* 由每段累计判定，见 `team/guard.ts` 的 `sleepMsOf`。
*
* **全仓唯一定义处**：`guard.ts` 只收参数、不自读常量（与 `STALL_MS` 同一纪律）。
*/
const NOWAIT_THRESHOLD_MS = 5e3;
/**
* Trigger 合法种类白名单：**恰 4 个**（AC-13），定义只允许出现这一处。
*
* 为什么放在配置单点而不是 `team/trigger.ts`：宿主要**跨文件**用它两处——
* `team/trigger.ts:188` 的 `fastOf`（不认识的 kind 直接 drop）与 `store.ts` 的
* `normalizeTriggers`（读盘时丢掉脏值）。原先两处各写一份字面量，新增第 5 类时
* 只改一处就会出现「事件能进来、读盘就被当作脏值丢掉」的半失效（r5 验收 R2）。
* 放在这里后，`trigger.ts` 只 re-export（保持既有 import 面不变），`store.ts` 直接引用。
*
* 新增种类时必须同时补：归一化构造器（`team/trigger.ts`）、Fast 判据、面板文案、
* 以及 `test/trigger.test.ts` 的「四类各有构造器」扫描。
*/
const TRIGGER_KINDS = [
	"gate_failed",
	"member_exit",
	"dep_ready",
	"stall_timeout"
];
/** 单次记忆展开的字符上限（AC-9）：超出截断并置 `truncated`，绝不把 4000 预算一次吃光。 */
const MEMORY_EXPAND_MAX_CHARS = 4e3;
/** 宿主工具名前缀（工具名全局唯一，必须带前缀防撞）。 */
const TOOL_PREFIX = "auto_team_";
/** 无项目上下文时的兜底工作区名（路径解析用，绝不写盘）。 */
const FALLBACK_WORKSPACE = "default";
/**
* 设置页可配参数的**缺省值**（r7 AC-11/AC-13）。
*
* 铁律：每一项都必须引用上面的冻结常量，不许在这里重新写一遍数字 ——
* 否则「默认并发 3」就有两个真值，settings.json 少写一项与不写文件会给出不同结论。
* 上面那些常量本身**一个值都不改**（AC-11 的形态冻结判据就是它们各自只出现一次）。
*/
const DEFAULT_SETTINGS = {
	concurrencyLimit: 3,
	memoryBudget: MEMORY_INJECT_BUDGET,
	stallMs: STALL_MS,
	maxAttempts: 3,
	gateTimeoutMs: GATE_TIMEOUT_MS
};
/**
* 可配参数的合法域（闭区间，均为整数）。写在这里的唯一理由是**校验与设置页提示共用同一份**：
* 校验函数（host/settings.ts）按它拒绝非法值，设置页按同一个数字显示「1~8」，
* 两边各写一份就会出现「页面说 1~8、保存时按 1~6 拒」的错位。
*/
const SETTINGS_LIMITS = {
	concurrencyLimit: [1, 8],
	memoryBudget: [200, MEMORY_INJECT_BUDGET],
	stallMs: [1e3, 6e5],
	maxAttempts: [1, 10],
	gateTimeoutMs: [1e3, 6e5]
};
/**
* 角色提示词字符上限（r7 AC-7）。
*
* 8000 字符是「一整段可读的职责说明」的合理上界：再长成员提示词会挤占任务与记忆的预算，
* 而且设计稿里提示词框是固定 96px 内滚，超长内容在界面上等于不可编辑。
*/
const ROLE_PROMPT_MAX = 8e3;
// src/host/paths.ts
/**
* 纯函数：数据落点解析。不读环境（不 import node:os），由调用方注入 home/workspace，
* 因此可被单测（AC：记忆落点与 `..` 逃逸防护必须可验证）。
*/
/** 全局数据根：`<home>/.dsh/auto-team`（PRD：runs/roles/memory 都在这里）。 */
function globalDataRoot(home) {
	return `${trimSlash(home)}/.dsh/auto-team`;
}
/** 运行状态目录。 */
function runsDir(home) {
	return `${globalDataRoot(home)}/runs`;
}
/** 角色目录。 */
function rolesDir(home) {
	return `${globalDataRoot(home)}/roles`;
}
/** 技能正文目录（内置角色的 skill md 由首次启动 seed 到这里）。 */
function skillsDir(home) {
	return `${globalDataRoot(home)}/skills`;
}
/**
* 可配参数落点：`<home>/.dsh/auto-team/settings.json`（r7 AC-13）。
*
* 真机目标是 `~/.dsh/auto-team/settings.json` —— `globalDataRoot` 里**已经含 `.dsh`**，
* 这里绝不能再拼一层（拼了会落到 `~/.dsh/.dsh/...`，表现为「设置保存成功、重启全部丢失」）。
*/
function settingsPath(home) {
	return `${globalDataRoot(home)}/settings.json`;
}
/** 公共记忆目录（跨项目）。 */
function publicMemoryDir(home) {
	return `${globalDataRoot(home)}/memory/public`;
}
/** 项目记忆目录：`<workspace>/.auto-team/memory`（随工作区走）。 */
function projectMemoryDir(workspace) {
	return `${trimSlash(normalizeWorkspace(workspace))}/.auto-team/memory`;
}
/** 项目门禁产物目录：`<workspace>/.auto-team/artifacts`。 */
function projectArtifactsDir(workspace) {
	return `${trimSlash(normalizeWorkspace(workspace))}/.auto-team/artifacts`;
}
/** 空工作区兜底（只影响解析，不写盘）。 */
function normalizeWorkspace(workspace) {
	const value = (workspace ?? "").trim();
	return value === "" ? `/${FALLBACK_WORKSPACE}` : value;
}
function trimSlash(value) {
	return value.replace(/\/+$/, "");
}
var RunsStore = class {
	/** 显式字段赋值而非构造器参数属性：node --test 的类型剥离（strip-only）不支持参数属性。 */
	dir;
	constructor(dir) {
		this.dir = dir;
	}
	/** 读一个 run；v1 裸 Plan 会被 `wrapLegacy` 升成 v2；文件缺失/损坏返回 null。 */
	load(runId) {
		const path = this.fileFor(runId);
		if (path === null || !existsSync(path)) return null;
		try {
			return wrapLegacy(JSON.parse(readFileSync(path, "utf8")));
		} catch {
			return null;
		}
	}
	/** 整体原子写（tmp + rename）；消息账本 / 停滞记录 / 告警都按上限裁剪后再落盘。 */
	save(state) {
		const path = this.fileFor(state.plan.runId);
		if (path === null) throw new Error(`非法 runId：${state.plan.runId}`);
		mkdirSync(this.dir, { recursive: true });
		const bindings = state.bindings ?? [];
		const normalized = {
			...state,
			version: 3,
			messages: capMessages(state.messages),
			bindings,
			routeAudits: state.routeAudits ?? [],
			progress: capProgress(state.progress, bindings),
			stallAlerts: capStallAlerts(state.stallAlerts ?? []),
			triggers: capTriggers(state.triggers ?? []),
			pause: normalizePause(state.pause)
		};
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
		renameSync(tmp, path);
	}
	/** 按会话取最近一次运行（面板「计划」页与「恢复」的默认数据源）。 */
	latestForSession(sessionId) {
		return this.list().map((summary) => this.load(summary.runId)).filter((state) => state !== null && state.plan.sessionId === sessionId).sort((a, b) => b.plan.createdAt - a.plan.createdAt)[0] ?? null;
	}
	list() {
		if (!existsSync(this.dir)) return [];
		const out = [];
		for (const entry of readdirSync(this.dir)) {
			if (!entry.endsWith(".json")) continue;
			const state = this.load(entry.slice(0, -5));
			if (state === null) continue;
			const { plan } = state;
			out.push({
				runId: plan.runId,
				sessionId: plan.sessionId,
				createdAt: plan.createdAt,
				status: plan.status,
				tasks: plan.tasks.length,
				done: plan.tasks.filter((task) => task.status === "done").length
			});
		}
		return out.sort((a, b) => b.createdAt - a.createdAt);
	}
	/**
	* runId → 文件路径。runId 是文件名主体，必须拒绝路径分隔符与 `..`，
	* 否则一个脏 runId 就能把 `runs/` 之外的文件读写掉。
	*/
	fileFor(runId) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) return null;
		if (runId.includes("..")) return null;
		return `${this.dir}/${runId}.json`;
	}
};
/**
* 把任意落盘内容升成 `RunState` v2（纯函数，无 IO，供单测）。
*
* - v2（`{ version: 2, plan, ... }`）：规范化数组字段，缺失补空；
* - v1（裸 `Plan`）：包成 v2，`plannedAt` 取 `plan.createdAt`，其余三个集合为空；
* - 其它（null / 非对象 / 缺 runId·sessionId·tasks）：返回 null，由调用方当成「没有这次运行」。
*
* `progress` / `stallAlerts` / `triggers` 是 v2 之后**追加的可选字段**：旧 v2 文件没有它们时补空对象/空数组，
* 因此 `version` 不变（不需要迁移脚本，也不会让旧文件被判成坏文件）。
*/
function wrapLegacy(raw) {
	if (!isRecord$1(raw)) return null;
	const plan = normalizePlan(isRecord$1(raw.plan) ? raw.plan : raw);
	if (plan === null) return null;
	return {
		version: 3,
		plan,
		plannedAt: finiteNumber(raw.plannedAt, plan.createdAt),
		messages: capMessages(asArray(raw.messages)),
		bindings: asArray(raw.bindings),
		routeAudits: asArray(raw.routeAudits),
		progress: normalizeProgress(raw.progress),
		stallAlerts: normalizeStallAlerts(raw.stallAlerts),
		triggers: normalizeTriggers(raw.triggers),
		pause: normalizePause(raw.pause)
	};
}
/**
* runId 生成：时间戳 + 会话短 hash（+ 可选 salt）。
*
* 时间戳是**毫秒**级，同一会话同一毫秒连出两份计划本来会得到同一个 id，后一份静默覆盖
* 前一份（QA D2）。因此把去重做成显式 salt：唯一性由 {@link uniqueRunId} 负责，
* 生成器本身保持纯函数（同样的入参给同样的值，便于单测）。
*/
function makeRunId(sessionId, now, salt = "") {
	let hash = 0;
	for (let index = 0; index < sessionId.length; index += 1) hash = (hash * 31 + sessionId.charCodeAt(index)) % 65535;
	const suffix = salt === "" ? "" : `-${salt}`;
	return `run-${now.toString(36)}-${hash.toString(36)}${suffix}`;
}
/**
* 保证在盘上空的 runId：从 `makeRunId(sessionId, now)` 起，撞了就按 -1、-2… 递增 salt。
*
* 这是 D2 的机械修复点：**任何**「同一毫秒内可能连出两份计划」的路径都走这里，
* 而不是各自拼 id。上限 1000 次后加随机后缀兜底（极端情况下也不覆盖别人的计划）。
*/
function uniqueRunId(store, sessionId, now) {
	const first = makeRunId(sessionId, now);
	if (store.load(first) === null) return first;
	for (let attempt = 1; attempt < 1e3; attempt += 1) {
		const candidate = makeRunId(sessionId, now, String(attempt));
		if (store.load(candidate) === null) return candidate;
	}
	return makeRunId(sessionId, now, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
}
const PLAN_STATUSES = [
	"draft",
	"dispatching",
	"paused",
	"terminated",
	"cancelled"
];
/**
* 落盘任务的合法状态白名单（读盘时用来把脏值归回 pending）。
*
* `interrupted` 必须在这里：watcher 把「成员进程已死、上下文仍在」写成 interrupted（AC-18），
* 如果读盘时被当成脏值归回 pending，面板会显示「待办」而不是「已中断」，
* 而 resume 只挑 running|gate|interrupted —— 恢复就会静默跳过这些任务（AC-17 失效）。
*
* `paused` 同理（r7 AC-9）：暂停期间任务被冻结成 paused，读盘若归回 pending，
* 恢复时会把它当「待办」重派一次 —— 已完成的工作被重跑，是暂停功能最坏的事故形态。
*/
const TASK_STATUSES = [
	"pending",
	"blocked",
	"ready",
	"running",
	"paused",
	"gate",
	"done",
	"rework",
	"failed",
	"interrupted"
];
/** 消息账本裁剪：只保留最新 `MESSAGES_LIMIT` 条（顺序不变）。 */
function capMessages(messages) {
	return messages.length <= 200 ? messages : messages.slice(-200);
}
/** 停滞告警裁剪：只保留最新 `STALL_ALERTS_LIMIT` 条（顺序不变）。 */
function capStallAlerts(alerts) {
	return alerts.length <= 50 ? alerts : alerts.slice(-50);
}
/** Trigger 账本裁剪：只保留最新 `TRIGGER_LOG_LIMIT` 条（顺序不变，照 `capStallAlerts` 的形状）。 */
function capTriggers(triggers) {
	return triggers.length <= 100 ? triggers : triggers.slice(-100);
}
/**
* 推进记录裁剪：只保留 live bindings（`!retired`）的 memberId。
*
* 为什么在 `save()` 里做而不是在判定里做：判定需要历史记录（否则成员一退休就把基线丢了），
* 而落盘只需要「对账用得上的那些」——成员死了它的推进记录再也不会被读。
* 传入的 bindings 为空时返回空对象（不是 undefined）：落盘形态稳定，读取端不必判两种空。
*/
function capProgress(progress, bindings) {
	const out = {};
	if (!progress) return out;
	const live = new Set(bindings.filter((binding) => !binding.retired).map((binding) => binding.memberId));
	for (const [memberId, record] of Object.entries(progress)) if (live.has(memberId)) out[memberId] = record;
	return out;
}
/** `progress` 规范化：`at` 必须是有限数字，否则整条丢；`alertedAt` 非法则删（不影响 `at` 的有效性）。 */
function normalizeProgress(raw) {
	const out = {};
	if (!isRecord$1(raw)) return out;
	for (const [memberId, value] of Object.entries(raw)) {
		if (!isRecord$1(value)) continue;
		const at = value.at;
		if (typeof at !== "number" || !Number.isFinite(at)) continue;
		const record = { at };
		const alertedAt = value.alertedAt;
		if (typeof alertedAt === "number" && Number.isFinite(alertedAt)) record.alertedAt = alertedAt;
		out[memberId] = record;
	}
	return out;
}
/**
* 停滞告警规范化：只留 `kind === 'tool'` 且 `at`/`text` 有效的条目（上限截尾）。
*
* 为什么不接受别的 kind：`stallAlerts` 只承载停滞告警，混进其它 kind 会让面板活动流
* 出现两条来源不同、措辞却相似的行——正是 PRD 反面目标 1 要消灭的重复告警。
*/
function normalizeStallAlerts(raw) {
	const kept = [];
	for (const value of asArray(raw)) {
		if (!isRecord$1(value)) continue;
		if (value.kind !== "tool") continue;
		if (typeof value.at !== "number" || !Number.isFinite(value.at)) continue;
		if (typeof value.text !== "string" || value.text === "") continue;
		kept.push(value);
	}
	return capStallAlerts(kept);
}
/**
* Trigger 账本规范化：只留字段形状完整、`kind` 在白名单内的条目（上限截尾）。
*
* 白名单 `TRIGGER_KINDS` 从 `config.ts` 取（跨文件单点，`team/trigger.ts` 的 `fastOf` 用同一份）
* —— 两处各写一份字面量时，新增第 5 类会漏改一处，表现为「事件能进来、读盘被当脏值丢掉」。
*
* 为什么要逐字段校验而不是整体 `as TriggerRecord[]`：`triggers` 是**可解释性证据**，
* 一条缺 `dedupeKey` 的脏记录会让去重永久失效（同一事件反复推进），
* 一条 `at` 非数字的记录会让面板排序出现 `NaN` 行。宁可丢一条，不可留半条。
*/
function normalizeTriggers(raw) {
	const kept = [];
	for (const value of asArray(raw)) {
		if (!isRecord$1(value)) continue;
		if (typeof value.kind !== "string") continue;
		if (!TRIGGER_KINDS.includes(value.kind)) continue;
		if (value.source !== "event" && value.source !== "poll") continue;
		if (typeof value.at !== "number" || !Number.isFinite(value.at)) continue;
		if (typeof value.runId !== "string" || value.runId === "") continue;
		if (typeof value.dedupeKey !== "string" || value.dedupeKey === "") continue;
		if (typeof value.reason !== "string" || value.reason === "") continue;
		if (typeof value.text !== "string" || value.text === "") continue;
		if (typeof value.accepted !== "boolean") continue;
		kept.push(value);
	}
	return capTriggers(kept);
}
/**
* 暂停记账归一化（r7 AC-9）：白名单校验，任何一项不合格就整体视为「未暂停」。
*
* 为什么整体丢弃而不是局部修补：`pause` 是恢复时的**唯一依据**，半份记录会导致
* 「有的任务还原成 running、有的回落 ready」——那比当成未暂停更危险（会派发一个其实在跑的任务）。
* 整体丢弃的后果只有一个：用户需要重新点一次继续（可见、可恢复）。
*/
function normalizePause(raw) {
	if (!isRecord$1(raw)) return void 0;
	if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return void 0;
	if (!PLAN_STATUSES.includes(raw.planStatus)) return void 0;
	if (!isRecord$1(raw.tasks)) return void 0;
	const tasks = {};
	for (const [taskId, status] of Object.entries(raw.tasks)) {
		if (taskId === "") return void 0;
		if (!TASK_STATUSES.includes(status)) return void 0;
		tasks[taskId] = status;
	}
	return {
		at: raw.at,
		planStatus: raw.planStatus,
		tasks
	};
}
function normalizePlan(raw) {
	const { runId, sessionId, tasks } = raw;
	if (typeof runId !== "string" || runId === "") return null;
	if (typeof sessionId !== "string" || !Array.isArray(tasks)) return null;
	return {
		runId,
		sessionId,
		createdAt: finiteNumber(raw.createdAt, 0),
		status: PLAN_STATUSES.includes(raw.status) ? raw.status : "draft",
		tasks: tasks.map(normalizeTask).filter((task) => task !== null),
		maxConcurrent: clampConcurrency(raw.maxConcurrent)
	};
}
/** 单个任务的最小结构校验：旧文件里缺字段时补默认值，坏条目直接丢弃。 */
function normalizeTask(raw) {
	if (!isRecord$1(raw) || typeof raw.id !== "string" || raw.id === "") return null;
	return {
		...raw,
		id: raw.id,
		title: typeof raw.title === "string" ? raw.title : raw.id,
		roleId: typeof raw.roleId === "string" ? raw.roleId : "",
		dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.filter((dep) => typeof dep === "string") : [],
		acceptance: typeof raw.acceptance === "string" ? raw.acceptance : "",
		status: TASK_STATUSES.includes(raw.status) ? raw.status : "pending"
	};
}
/** 并发上限统一夹到 [1, MAX_CONCURRENT_LIMIT]，缺失取默认 3。 */
function clampConcurrency(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return 3;
	return Math.min(8, Math.max(1, Math.trunc(value)));
}
function finiteNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function asArray(value) {
	return Array.isArray(value) ? value : [];
}
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// src/host/roles/builtin.ts
const BUILTIN_SKILLS = [
	{
		id: "prd-writing",
		title: "需求与验收标准",
		body: [
			"# 需求与验收标准",
			"- 先把「用户要什么」写成可验收的条目（AC-n），每条必须可判定：命令、输出、或明确的人工判据。",
			"- 明确不做的事（范围外）与已知风险各写一行，避免下游扩张。",
			"- 每条 AC 都要能在交付物里定位到落点（文件/接口/界面元素）。"
		].join("\n")
	},
	{
		id: "architecture",
		title: "架构与技术方案",
		body: [
			"# 架构与技术方案",
			"- 先定边界与契约（模块 → 输入/输出/错误），再谈实现细节。",
			"- 单点风险集中到一处胶水层，便于验证与替换。",
			"- 外部依赖必须写清版本与是否存在替代方案。"
		].join("\n")
	},
	{
		id: "implementation",
		title: "编码实现",
		body: [
			"# 编码实现",
			"- 改动最小化：只碰任务范围内文件；公共契约变更必须同步更新调用方。",
			"- 不吞异常：错误要能传到 UI 或日志，禁止空 catch。",
			"- 交付前跑一次构建与类型检查，命令与结果写进回执。"
		].join("\n")
	},
	{
		id: "testing",
		title: "测试与质量门禁",
		body: [
			"# 测试与质量门禁",
			"- 断言前先问：把实现改回错误版本，这条断言会不会红？不会红就不是断言。",
			"- 数值/计数类「不包含」断言禁止子串匹配。",
			"- 门禁命令必须留下退出码与输出尾部作为证据。"
		].join("\n")
	},
	{
		id: "docs",
		title: "文档与交付说明",
		body: [
			"# 文档与交付说明",
			"- 文档写「怎么用、怎么验、失败怎么办」，不写实现流水账。",
			"- 命令必须可直接复制执行，并标注在哪个目录执行。",
			"- 未完成项必须显式列出，禁止用「全部完成」掩盖缺口。"
		].join("\n")
	},
	{
		id: "review",
		title: "评审与风险",
		body: [
			"# 评审与风险",
			"- 先看边界与失败路径，再看正常路径。",
			"- 对每条结论标注证据（命令/文件行号），无证据的结论按假设处理。",
			"- 输出必须含「建议修改」与「可接受」两栏，避免只给结论不给依据。"
		].join("\n")
	}
];
/** 内置角色（id 稳定，内置标记不可删）。`prompt` 是恢复默认时的**唯一逐字来源**。 */
const BUILTIN_ROLES = [
	{
		id: "pm",
		name: "产品经理",
		duty: "澄清需求、拆解目标、定义验收标准与范围外事项",
		skillIds: ["prd-writing", "docs"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你负责把一句话需求变成可判定的合同：",
			"- 需求转写必须忠实：保留用户原话的要点与约束，不要替用户发明技术方案。",
			"- 每条验收标准都必须能落到一条命令或一段结构断言上；写不出验证方式的需求，先问清楚再落笔。",
			"- 验收标准必须可判定：禁止「体验良好」「尽量优化」这类给不出红绿的表述。",
			"- 明确写出「不做」与「范围外」清单，防止下游自行扩大范围。"
		].join("\n")
	},
	{
		id: "architect",
		name: "架构师",
		duty: "定模块边界与契约、技术选型权衡、脚手架与集成方案",
		skillIds: ["architecture", "review"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你先定形状、再定实现：",
			"- 新模块只暴露一组成员（函数/接口），形状扩张一律收敛到共享契约文件。",
			"- 任何「同一份数据两条链路」的设计当场否决，改成单点真值 + 单点推导。",
			"- 方案必须给出可执行的门禁命令与变异自检清单，不写「建议进一步优化」。",
			"- 与既有架构冲突时，先给证据（文件与行号），再给取舍理由。"
		].join("\n")
	},
	{
		id: "dev",
		name: "高级全栈工程师",
		duty: "按任务实现代码与配置、自测并给出可复核的回执",
		skillIds: ["implementation", "testing"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你按任务实现，并且自己先验一遍：",
			"- 只改任务里列出的文件；确实需要改别人的文件时，在回执里说明并停下。",
			"- 跨模块调用前先 grep 目标文件确认成员真的存在——猜一个名字等于首次调用就崩。",
			"- 交付前跑任务指定的门禁命令，回执里写「命令 → 退出码 → 通过/失败数」。",
			"- 改动最小化：能复用既有实现就不要新增一层包装。"
		].join("\n")
	},
	{
		id: "qa",
		name: "QA 测试工程师",
		duty: "把 AC 转成可执行判定、跑门禁并记录证据与缺陷",
		skillIds: ["testing", "review"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你把验收标准逐条翻成可执行判定，并保留证据：",
			"- 每条 AC 至少一条命令；断言前先问「改回错误实现后这条会不会变红」，不会变红就换判据。",
			"- 复跑前确认脚本所在位置：从归档目录跑会因相对根解析失败而假红。",
			"- 缺陷按「症状 / 根因 / 复验命令」三段写，不写「偶发」「疑似」。",
			"- 全绿也要报「未验证项」，不要用「构建通过」代替真机行为。"
		].join("\n")
	},
	{
		id: "docs",
		name: "技术文档工程师",
		duty: "维护 README/使用说明/变更记录，保证命令可复现",
		skillIds: ["docs"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你维护可复现的人话文档：",
			"- 每条命令都能被复制执行；示例里写真实落点，不要用占位符糊过去。",
			"- 变更记录只写「改了什么 + 为什么 + 怎么验」，不写进度流水。",
			"- 与实现不一致的文档比没有文档更糟：同批改代码就同批改文档，否则明确标注待更新。",
			"- 文档里的数字（版本、路径、上限）必须来自源码或命令输出，不凭印象。"
		].join("\n")
	},
	{
		id: "reviewer",
		name: "评审专家",
		duty: "独立复核交付物的边界、风险与证据完备性",
		skillIds: ["review", "architecture"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你独立复核，不替实现方辩护：",
			"- 先看边界：改动的文件是否越界、契约是否被偷偷扩大。",
			"- 再看证据：每条判定能否复跑，数字是否与命令输出对得上。",
			"- 最后看形态：是否有「两边都绿、真机为 0」的假绿（模板没绑 hook、字段没进快照）。",
			"- 结论只给「通过」或「打回 + 必改项」，必改项要能直接改成一条命令。"
		].join("\n")
	}
];
function builtinSkillBody(skillId) {
	return BUILTIN_SKILLS.find((skill) => skill.id === skillId)?.body ?? "";
}
/** 角色的完整技能正文（注入成员 prompt 时用；未知 skillId 静默跳过并在返回里报告）。 */
function composeSkillPrompt(role) {
	const parts = [];
	const missing = [];
	for (const skillId of role.skillIds) {
		const body = builtinSkillBody(skillId);
		if (body === "") {
			missing.push(skillId);
			continue;
		}
		parts.push(body);
	}
	return {
		text: parts.join("\n\n"),
		missing
	};
}
// src/host/roles/repo.ts
/**
* 角色库：`<home>/.dsh/auto-team/roles/<id>.json` 一角色一文件。
*
* 规则（AC-15/AC-16）：
*  - 内置角色首次启动 seed，之后**可改不可删**；
*  - 用户自建角色可改可删；
*  - 每角色可指定模型（provider/model/reasoningEffort），未指定时走会话默认路由。
*/
const ROLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
/**
* 角色落盘模式版本（只服务于 seed() 的**一次性补齐**）：
*  - 1 = r6 及以前：角色文件没有 `prompt` 字段；
*  - 2 = r7：内置角色带 `prompt`。
*
* r7 之前 seed 出的文件里没有 prompt，`seed()` 又是「已存在的不写」，于是升级后
* 六个内置角色的提示词全是空的，直到用户手动点一次「一键恢复默认」（QA-R7-01）。
*/
const ROLES_SCHEMA_VERSION = 2;
/** 补齐标记文件名：**不带 .json**，避免被 list()/restoreDefaults() 的 `*.json` 扫描当成角色。 */
const SEED_MARKER = ".seeded";
function createRoleRepo(deps) {
	const { dir, skillsDir, now } = deps;
	const pathOf = (id) => `${dir}/${id}.json`;
	function read(id) {
		const path = pathOf(id);
		if (!existsSync(path)) return void 0;
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8"));
			if (typeof parsed.id !== "string" || typeof parsed.name !== "string") return void 0;
			return {
				id: parsed.id,
				name: parsed.name,
				duty: parsed.duty ?? "",
				skillIds: Array.isArray(parsed.skillIds) ? parsed.skillIds : [],
				model: normalizeModel(parsed.model),
				builtin: parsed.builtin === true,
				updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
				prompt: typeof parsed.prompt === "string" ? parsed.prompt.trim() : void 0
			};
		} catch {
			return;
		}
	}
	function write(role) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(pathOf(role.id), `${JSON.stringify(role, null, 2)}\n`, "utf8");
	}
	const markerPath = () => `${dir}/${SEED_MARKER}`;
	/** 读补齐标记；读不到/损坏一律当 0（= 从未补齐过），宁可多补一次也不漏补。 */
	function schemaOf() {
		if (!existsSync(markerPath())) return 0;
		try {
			const parsed = JSON.parse(readFileSync(markerPath(), "utf8"));
			return typeof parsed.schema === "number" ? parsed.schema : 0;
		} catch {
			return 0;
		}
	}
	function markSchema() {
		writeFileSync(markerPath(), `${JSON.stringify({
			schema: ROLES_SCHEMA_VERSION,
			at: now()
		})}\n`, "utf8");
	}
	/**
	* 给「文件已存在、但缺新字段」的内置角色补字段（r7 升级路径，QA-R7-01）。
	*
	* 只补**磁盘上缺席**的键：已有的键（用户改过的 duty、清空后本就不落盘的 prompt、
	* 单独指定的 model）一个字节都不动 —— 「补齐新字段」与「覆盖用户编辑」是两件事。
	* 返回 false 表示文件损坏读不出来：保留原文件不动，让下一轮启动继续尝试。
	*/
	function backfill(path, role) {
		let raw;
		try {
			raw = JSON.parse(readFileSync(path, "utf8"));
		} catch {
			return false;
		}
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
		const defaults = {
			...role,
			updatedAt: now()
		};
		const merged = { ...raw };
		let added = false;
		for (const [key, value] of Object.entries(defaults)) {
			if (value === void 0) continue;
			if (Object.prototype.hasOwnProperty.call(merged, key)) continue;
			merged[key] = value;
			added = true;
		}
		if (added) writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
		return true;
	}
	return {
		/** 内置角色永远出现在列表里（即便文件被删），保证「可改不可删」的语义。 */
		list() {
			const seen = /* @__PURE__ */ new Map();
			for (const role of BUILTIN_ROLES) seen.set(role.id, { ...role });
			if (existsSync(dir)) for (const entry of readdirSync(dir)) {
				if (!entry.endsWith(".json")) continue;
				const role = read(entry.slice(0, -5));
				if (role) seen.set(role.id, role);
			}
			return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
		},
		get(id) {
			return read(id) ?? BUILTIN_ROLES.find((role) => role.id === id);
		},
		save(role) {
			const id = (role.id ?? "").trim().toLowerCase();
			if (!ROLE_ID_PATTERN.test(id)) return {
				ok: false,
				error: `角色 id 不合法：只允许小写字母数字与连字符（收到「${role.id}」）`
			};
			const name = (role.name ?? "").trim();
			if (name === "") return {
				ok: false,
				error: "角色名称不能为空"
			};
			if (id === "captain") return {
				ok: false,
				error: "captain 是队长保留 id，不能作为角色"
			};
			/**
			* `builtin` **永远由 BUILTIN_ROLES 推导**，绝不从磁盘读（r7 AC-8 的关键判据）。
			*
			* 旧写法 `existing?.builtin ?? …` 允许用户建一个 id 为 `my-role` 的角色、手填
			* `"builtin": true`，于是它既进 `list()` 又被 `remove()` 判成「内置不可删」——
			* 一个自建角色变相获得了删除豁免，而且 `restoreDefaults` 也不会碰它。
			*/
			const builtin = BUILTIN_ROLES.some((item) => item.id === id);
			const verdict = validateModel(role.model);
			if (!verdict.ok) return {
				ok: false,
				error: verdict.error
			};
			const promptVerdict = validatePrompt(role.prompt);
			if (!promptVerdict.ok) return {
				ok: false,
				error: promptVerdict.error
			};
			const next = {
				id,
				name,
				duty: (role.duty ?? "").trim(),
				skillIds: [...new Set(role.skillIds ?? [])],
				model: verdict.model,
				builtin,
				updatedAt: now(),
				prompt: promptVerdict.prompt
			};
			if (next.prompt === void 0) delete next.prompt;
			write(next);
			return {
				ok: true,
				role: next
			};
		},
		remove(id) {
			if (BUILTIN_ROLES.some((role) => role.id === id)) return {
				ok: false,
				error: `内置角色不可删除：「${id}」（可以修改或清除模型指定）`
			};
			const path = pathOf(id);
			if (!existsSync(path)) return {
				ok: false,
				error: `角色不存在：「${id}」`
			};
			rmSync(path);
			return { ok: true };
		},
		/**
		* 一键恢复默认（r7 AC-8）：逐字取 `BUILTIN_ROLES`，只写这 6 个文件。
		*
		* 为什么不「删掉 roles/ 再 seed」：那会把用户自建角色一起清掉。
		* 为什么 `updatedAt` 用 `now()` 而不是内置的 0：`0` 会让面板显示「1970 年更新」，
		* 而且与「这次真的写过盘」这件事矛盾（恢复后要能看出动作发生过）。
		*/
		restoreDefaults() {
			const restored = [];
			for (const role of BUILTIN_ROLES) {
				write({
					...role,
					updatedAt: now()
				});
				restored.push(role.id);
			}
			const builtinIds = new Set(BUILTIN_ROLES.map((role) => role.id));
			const kept = [];
			if (existsSync(dir)) for (const entry of readdirSync(dir)) {
				if (!entry.endsWith(".json")) continue;
				const id = entry.slice(0, -5);
				if (builtinIds.has(id)) continue;
				kept.push(id);
			}
			return {
				restored: restored.sort(),
				kept: kept.sort()
			};
		},
		/**
		* 首次启动把内置角色与技能 md 落盘（已存在的不覆盖，保护用户编辑）。
		*
		* 升级路径（QA-R7-01）：老版本落盘的文件虽然存在，但可能缺本轮新增的字段
		* （r7 的 `prompt`）。这类文件**只补缺席的键**，且补齐只做一次 ——
		* 标记 `.seeded` 落盘后不再补，否则用户「清空提示词」会被下次启动悄悄复活。
		*/
		seed() {
			mkdirSync(dir, { recursive: true });
			mkdirSync(skillsDir, { recursive: true });
			const migrate = schemaOf() < ROLES_SCHEMA_VERSION;
			let migrated = true;
			for (const role of BUILTIN_ROLES) {
				const path = pathOf(role.id);
				if (!existsSync(path)) {
					write({
						...role,
						updatedAt: now()
					});
					continue;
				}
				if (migrate && !backfill(path, role)) migrated = false;
			}
			for (const skill of BUILTIN_SKILLS) {
				const path = `${skillsDir}/${skill.id}.md`;
				if (!existsSync(path)) writeFileSync(path, `${skill.body}\n`, "utf8");
			}
			if (migrate && migrated) markSchema();
		}
	};
}
/** provider/model 的合法形态：非空、且不含任何空白字符（宿主路由按字符串精确匹配）。 */
const MODEL_TOKEN_PATTERN = /^\S+$/;
const EFFORTS$1 = [
	"low",
	"medium",
	"high"
];
function pickToken(raw) {
	if (typeof raw !== "string") return void 0;
	const value = raw.trim();
	return value === "" || !MODEL_TOKEN_PATTERN.test(value) ? void 0 : value;
}
/**
* 模型指定归一（宽松口径，只用于**读盘**）：
* 落盘文件可能被手改，任何不完整/非法的组合都视为「跟随会话默认」，不让角色因此消失。
* 写入判定走 validateModel（要报错给用户，不能静默回退，AC-22）。
*/
function normalizeModel(raw) {
	if (!raw || typeof raw !== "object") return void 0;
	const candidate = raw;
	const provider = pickToken(candidate.provider);
	const name = pickToken(candidate.model);
	if (provider === void 0 || name === void 0) return void 0;
	const effort = candidate.reasoningEffort;
	const route = {
		provider,
		model: name
	};
	if (effort === "low" || effort === "medium" || effort === "high") route.reasoningEffort = effort;
	return route;
}
/**
* 模型指定校验（严格口径，用于**写入**）：
*  - 两者都空 = 跟随会话默认（合法）；
*  - 只填一个 = 报错（否则用户以为指定了模型，实际仍在队长模型上跑，是 AC-22 的静默回退）；
*  - 含空白字符 = 报错（宿主路由解析不了，派发后才发现就晚了）；
*  - reasoningEffort 只接受 low/medium/high。
*/
function validateModel(raw) {
	if (raw === void 0 || raw === null) return { ok: true };
	if (typeof raw !== "object") return {
		ok: false,
		error: "模型指定必须是对象（provider / model）"
	};
	const candidate = raw;
	const provider = typeof candidate.provider === "string" ? candidate.provider.trim() : "";
	const name = typeof candidate.model === "string" ? candidate.model.trim() : "";
	if (provider === "" && name === "") return { ok: true };
	if (provider === "" || name === "") return {
		ok: false,
		error: `模型指定不完整：缺 ${provider === "" ? "provider" : "model"}（当前只填了 ${provider === "" ? `model=${name}` : `provider=${provider}`}）。要跟随会话默认请两个都留空`
	};
	if (!MODEL_TOKEN_PATTERN.test(provider)) return {
		ok: false,
		error: `provider 不能包含空白字符（收到「${provider}」）`
	};
	if (!MODEL_TOKEN_PATTERN.test(name)) return {
		ok: false,
		error: `model 不能包含空白字符（收到「${name}」）`
	};
	const effort = candidate.reasoningEffort;
	if (effort !== void 0 && effort !== null && !EFFORTS$1.includes(effort)) return {
		ok: false,
		error: `reasoningEffort 只接受 ${EFFORTS$1.join(" / ")}（收到「${String(effort)}」）`
	};
	const route = {
		provider,
		model: name
	};
	if (effort === "low" || effort === "medium" || effort === "high") route.reasoningEffort = effort;
	return {
		ok: true,
		model: route
	};
}
/**
* 角色提示词校验（r7 AC-7，写入用）：
*  - 缺席/空白 = 合法（返回 `prompt: undefined`，盘上不写这个键）；
*  - 非字符串 = 报错（面板把整个 role 对象回传，类型错必须被拦住而不是静默塞进 JSON）；
*  - 超长 = 报错而不是截断（截断会让用户以为保存成功，实际丢了后半段）。
*/
function validatePrompt(raw) {
	if (raw === void 0 || raw === null) return { ok: true };
	if (typeof raw !== "string") return {
		ok: false,
		error: "角色提示词必须是文本"
	};
	const prompt = raw.trim();
	if (prompt === "") return { ok: true };
	if (prompt.length > 8e3) return {
		ok: false,
		error: `角色提示词最多 ${ROLE_PROMPT_MAX} 字符（收到 ${prompt.length}）`
	};
	return {
		ok: true,
		prompt
	};
}
// src/host/settings.ts
/**
* 可配参数的读写与校验（r7 AC-13 / AC-17）。
*
* 三条不变量是本模块存在的全部理由：
*   1. **校验与落盘一个入口**：`save()` 先 `validateSettings` 再写盘，非法提交磁盘逐字不变（AC-17）。
*      绕开它直接写文件 = 允许 `{"concurrencyLimit": 999}` 进盘，下次启动并发被打满。
*   2. **缺省值只有一个来源**：每个字段缺席就取 `config.ts` 的 `DEFAULT_SETTINGS`，
*      所以「没有 settings.json」「空文件」「少写一项」三者等价 —— 而不是三套结论。
*   3. **原子写**：先写 `<file>.tmp` 再 `rename`。半截文件会让 `read()` 回落到缺省值，
*      用户看到的是「设置莫名全丢」，比拒绝保存难排查得多。
*
* 落点由调用方注入（`paths.settingsPath(home)`），本模块不读环境、不 import node:os。
*/
/** 缺省参数的一份拷贝（返回新对象：调用方改它不该污染常量）。 */
function defaultSettings() {
	return { ...DEFAULT_SETTINGS };
}
/**
* 校验并补齐参数。
*
* 规则：数字项必须是**整数**且落在 `SETTINGS_LIMITS` 的闭区间内；缺席 = 取缺省；
* `captainModel` 复用 `roles/repo.ts` 的 `validateModel`（禁止在校验上出现第二份实现）。
* 未知键忽略（前向兼容：新版本写下的字段不该让老版本整体拒绝）。
*/
function validateSettings(raw) {
	if (raw === null || raw === void 0) return {
		ok: true,
		settings: defaultSettings()
	};
	if (!isRecord(raw)) return {
		ok: false,
		reason: "设置必须是对象"
	};
	const settings = defaultSettings();
	for (const item of [
		{
			key: "concurrencyLimit",
			label: "并发上限"
		},
		{
			key: "memoryBudget",
			label: "记忆预算"
		},
		{
			key: "stallMs",
			label: "停滞阈值"
		},
		{
			key: "maxAttempts",
			label: "返工上限"
		},
		{
			key: "gateTimeoutMs",
			label: "门禁超时"
		}
	]) {
		const value = raw[item.key];
		if (value === void 0 || value === null) continue;
		const [min, max] = SETTINGS_LIMITS[item.key];
		if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return {
			ok: false,
			reason: `${item.label}需为 ${min}~${max} 的整数`
		};
		settings[item.key] = value;
	}
	const rawModel = raw.captainModel;
	if (rawModel !== void 0 && rawModel !== null) {
		if (isRecord(rawModel)) {
			if (hasText(rawModel.provider) !== hasText(rawModel.model)) return {
				ok: false,
				reason: "队长模型：提供方与模型需同时填写"
			};
		}
		const checked = validateModel(rawModel);
		if (!checked.ok) return {
			ok: false,
			reason: `队长模型不合法：${checked.error}`
		};
		if (checked.model) settings.captainModel = checked.model;
	}
	return {
		ok: true,
		settings
	};
}
/** 创建仓储（一个文件一个实例；宿主侧只在 apply 里建一次）。 */
function createSettingsRepo(deps) {
	const file = deps.file;
	const warn = deps.warn ?? (() => {});
	return {
		path: () => file,
		read() {
			let text;
			try {
				text = readFileSync(file, "utf8");
			} catch {
				return defaultSettings();
			}
			let parsed;
			try {
				parsed = JSON.parse(text);
			} catch (error) {
				warn(`settings.json 解析失败，回落缺省值：${describe(error)}`);
				return defaultSettings();
			}
			const checked = validateSettings(parsed);
			if (!checked.ok) {
				warn(`settings.json 内容非法（${checked.reason}），回落缺省值`);
				return defaultSettings();
			}
			return checked.settings;
		},
		save(raw) {
			const checked = validateSettings(raw);
			if (!checked.ok) return checked;
			const body = `${JSON.stringify(checked.settings, null, 2)}\n`;
			const tmp = `${file}.tmp`;
			try {
				mkdirSync(dirname(file), { recursive: true });
				writeFileSync(tmp, body, "utf8");
				renameSync(tmp, file);
			} catch (error) {
				try {
					rmSync(tmp, { force: true });
				} catch {}
				return {
					ok: false,
					reason: `写入设置失败：${describe(error)}`
				};
			}
			return {
				ok: true,
				settings: checked.settings
			};
		}
	};
}
function hasText(value) {
	return typeof value === "string" && value.trim() !== "";
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function describe(error) {
	return error instanceof Error ? error.message : String(error);
}
// src/host/gate/gate.ts
/**
* 质量门禁：把任务的 `acceptance` 命令真正跑一遍，落全量日志、裁剪尾部证据（AC-19）。
*
* 两个必须守住的点：
*  1. **绝不能同步执行**：旧实现用 `spawnSync`，最长阻塞事件循环 300s —— 面板轮询停摆，
*     前面 AC-18 的 5 秒预算直接不成立。这里改成纯 Promise + 子进程，宿主线程始终可响应。
*  2. **内存只留尾部**：全量输出流式写 `${artifactsDir}/${taskId}.log`，内存里只保留末尾
*     GATE_TAIL_CHARS（4000）字符作为证据；一个跑完整测试套件的门禁能输出几十 MB。
*
* `exec` 是注入点：超时、SIGKILL、非零退出、启动失败这些分支不必真跑 shell 就能单测，
* 否则「超时分支」只能靠等 5 分钟或伪造系统时间。
*/
/** 空验收命令的证据文案（与 bridge 的 GATE_FAILED 提示保持一致口径）。 */
const EMPTY_ACCEPTANCE_TAIL = "该任务没有验收命令，需要人工确认后放行";
/** 跑门禁：全量日志落盘，只把尾部带回内存。 */
async function runGate(task, deps) {
	const now = typeof deps.now === "function" ? deps.now() : deps.now ?? Date.now();
	const command = (task.acceptance ?? "").trim();
	if (command === "") return {
		ok: false,
		evidence: {
			taskId: task.id,
			command,
			exitCode: -1,
			tail: EMPTY_ACCEPTANCE_TAIL,
			artifacts: [],
			at: now
		}
	};
	const timeoutMs = deps.timeoutMs ?? 3e5;
	const exec = deps.exec ?? defaultGateExec;
	const logPath = join(deps.artifactsDir, `${safeFileName(task.id)}.log`);
	try {
		mkdirSync(deps.artifactsDir, { recursive: true });
	} catch {}
	let result;
	try {
		result = await exec(command, {
			cwd: deps.cwd,
			timeoutMs,
			logPath
		});
	} catch (error) {
		result = {
			code: null,
			tail: `验收命令执行失败：${error instanceof Error ? error.message : String(error)}`
		};
	}
	if (!existsSync(logPath)) try {
		writeFileSync(logPath, `# task: ${task.id}\n# command: ${command}\n# exit: ${result.code ?? "unknown"}\n\n${result.tail}\n`, "utf8");
	} catch {}
	return {
		ok: result.code === 0,
		evidence: {
			taskId: task.id,
			command,
			exitCode: result.code,
			tail: tailOf$1(result.tail, GATE_TAIL_CHARS),
			artifacts: [logPath],
			at: now
		}
	};
}
/**
* 缺省执行器：`spawn(command,{shell:true})` + 超时 SIGKILL。
* 全量输出流进 logPath，内存只滚动保留尾部，避免大输出把宿主内存打爆。
*/
function defaultGateExec(command, opts) {
	return new Promise((resolve) => {
		let tail = "";
		let timedOut = false;
		let settled = false;
		let stream = null;
		try {
			stream = createWriteStream(opts.logPath, {
				flags: "w",
				encoding: "utf8"
			});
			stream.on("error", () => {
				stream = null;
			});
			stream.write(`# command: ${command}\n\n`);
		} catch {
			stream = null;
		}
		const child = spawn(command, {
			cwd: opts.cwd,
			shell: true
		});
		const sink = (chunk) => {
			tail = (tail + chunk).slice(-4e3);
			try {
				stream?.write(chunk);
			} catch {}
		};
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk) => sink(chunk));
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk) => sink(chunk));
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, opts.timeoutMs);
		const finish = (code, note) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const suffix = note ? `\n# ${note}` : "";
			const text = note ? `${note}\n${tail}` : tail;
			const target = stream;
			stream = null;
			let done = false;
			const settle = () => {
				if (done) return;
				done = true;
				resolve({
					code,
					tail: text
				});
			};
			if (!target) {
				settle();
				return;
			}
			const guard = setTimeout(settle, GATE_FLUSH_TIMEOUT_MS);
			const flushed = () => {
				clearTimeout(guard);
				settle();
			};
			target.once("close", flushed);
			target.once("error", flushed);
			try {
				target.end(`\n# exit: ${code === null ? "timeout-or-signal" : code}${suffix}\n`);
			} catch {
				flushed();
			}
		};
		child.on("error", (error) => {
			finish(null, `启动失败：${error.message}`);
		});
		child.on("close", (code) => {
			if (timedOut) {
				finish(null, `超时（${opts.timeoutMs}ms）已被 SIGKILL 终止`);
				return;
			}
			finish(code);
		});
	});
}
/** 只保留尾部 limit 字符，并显式标注前面省略了多少（AC-19 要求「不能假装是全量」）。 */
function tailOf$1(text, limit) {
	if (text.length <= limit) return text;
	return `…（前 ${text.length - limit} 字符已省略，全文见产物文件）\n${text.slice(-limit)}`;
}
function safeFileName(taskId) {
	const cleaned = taskId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
	return cleaned === "" ? "gate" : cleaned.slice(0, 40);
}
// src/host/memory/inject.ts
/** 单条内联项里的标题上限。 */
const TITLE_MAX = 40;
/** 单条内联项里的摘要上限（AC-7 字段预算表：摘要 ≤60）。 */
const SUMMARY_MAX = 60;
/** 尾行预留（含分隔用两个换行）：先留出它再排正文，避免尾行把预算撑爆。 */
const TAIL_RESERVE = 160;
/** 尾行最多列几个 ID（再多就只给数量，不牺牲正文）。 */
const TAIL_MAX_IDS = 3;
/** 索引块的说明行（只在有条目时出现，模型才知道 `mem://` ID 怎么用）。 */
const ENTRIES_HEADER = "团队记忆索引（按 ID 用 auto_team_memory expand 展开全文）：";
const TRACK_LABEL = {
	project: "项目记忆",
	public: "公共记忆"
};
/** 抽关键词：英文按词、中文按 2 字滑窗（够用且不依赖分词库）。 */
function keywords(goal) {
	const source = (goal ?? "").toLowerCase();
	const latin = source.match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
	const cjkRuns = source.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
	const cjk = [];
	for (const run of cjkRuns) for (let index = 0; index + 2 <= run.length; index += 1) cjk.push(run.slice(index, index + 2));
	return [.../* @__PURE__ */ new Set([...latin, ...cjk])];
}
function countOccurrences(haystack, needle) {
	if (needle === "") return 0;
	let total = 0;
	let from = 0;
	for (;;) {
		const at = haystack.indexOf(needle, from);
		if (at < 0) return total;
		total += 1;
		from = at + needle.length;
	}
}
/** 标题：优先首个 markdown 标题行，否则退回文件名（去掉 .md）。 */
function titleOf(candidate) {
	const heading = (candidate.body ?? "").split("\n").find((line) => /^\s*#{1,6}\s+\S/.test(line));
	if (heading) return heading.replace(/^\s*#{1,6}\s+/, "").trim();
	return (candidate.name ?? "").replace(/\.md$/i, "");
}
/** 标题权重的可核验数值：目标关键词在标题/文件名里命中多少次。 */
function titleHits(goal, candidate) {
	const words = keywords(goal);
	if (words.length === 0) return 0;
	const title = titleOf(candidate).toLowerCase();
	return words.reduce((sum, word) => sum + countOccurrences(title, word), 0);
}
/** 正文相关度（纯函数，供排序与测试）。 */
function relevance(goal, candidate) {
	const words = keywords(goal);
	if (words.length === 0) return 0;
	const haystack = `${candidate.name}\n${candidate.body}`.toLowerCase();
	return words.reduce((sum, word) => sum + countOccurrences(haystack, word), 0);
}
/** 排序：项目轨 → 标题命中 → 正文相关度 → 更新时间 → 名字（稳定）。 */
function rank(goal, candidates) {
	return candidates.map((candidate) => ({
		candidate,
		body: (candidate.body ?? "").trim()
	})).filter((item) => item.body !== "").map((item) => ({
		...item,
		priority: item.candidate.track === "project" ? 1 : 0,
		title: titleHits(goal, item.candidate),
		score: relevance(goal, item.candidate),
		updatedAt: typeof item.candidate.updatedAt === "number" ? item.candidate.updatedAt : -1
	})).sort((a, b) => b.priority - a.priority || b.title - a.title || b.score - a.score || b.updatedAt - a.updatedAt || a.candidate.name.localeCompare(b.candidate.name));
}
/** 单行收敛：折叠空白 + 超长截断加省略号（摘要/标题共用）。 */
function clip(text, max) {
	const one = (text ?? "").replace(/\s+/g, " ").trim();
	if (max <= 0) return "";
	if (one.length <= max) return one;
	return `${one.slice(0, Math.max(0, max - 1))}…`;
}
/**
* `mem://<track>/<stem>`（**ID 拼装的唯一出处**，展开期只允许 `parseMemoryId` 解析）。
*
* `stem` 保留文件名原始大小写（去掉 `.md`）：这样 `safeMemoryName(stem)` 能逐字还原成
* 磁盘上的文件名，不会因小写化而「注入期给出一个展开期找不到的 ID」。
*/
function memoryIdOf(track, name) {
	return `mem://${track}/${(name ?? "").trim().replace(/\.md$/i, "")}`;
}
/** 首句摘要：首个非标题行 → 去掉列表符号 → 取第一句 → 收敛到 max 字符。 */
function summaryOf(candidate, max = SUMMARY_MAX) {
	const clean = ((candidate.body ?? "").split("\n").find((line) => line.trim() !== "" && !/^\s*#{1,6}\s+/.test(line)) ?? "").replace(/^\s*[-*+]\s+/, "").trim();
	if (clean === "") return "";
	return clip(/^(.*?[。！？!?.;；])/.exec(clean)?.[1] ?? clean, max);
}
/** 关联 ID：同轨按 rank 相邻优先，不足则跨轨补；不含自身，最多 relatedMax 个。 */
function relatedOf$1(ranked, index, relatedMax) {
	if (relatedMax <= 0) return [];
	const self = ranked[index].candidate;
	const others = [...ranked.slice(0, index), ...ranked.slice(index + 1)].map((item) => item.candidate);
	return [...others.filter((candidate) => candidate.track === self.track), ...others.filter((candidate) => candidate.track !== self.track)].slice(0, relatedMax).map((candidate) => memoryIdOf(candidate.track, candidate.name));
}
/** 把一条候选压成一行内联索引（保证 `line.length <= itemMax`）。 */
function packOne(ranked, index, itemMax, relatedMax) {
	const candidate = ranked[index].candidate;
	const id = memoryIdOf(candidate.track, candidate.name);
	const title = clip(titleOf(candidate), TITLE_MAX);
	const summary = summaryOf(candidate);
	let related = relatedOf$1(ranked, index, relatedMax);
	const build = (summaryText, relatedIds) => {
		const head = summaryText === "" ? `${id} · ${TRACK_LABEL[candidate.track]} · ${title}` : `${id} · ${TRACK_LABEL[candidate.track]} · ${title} — ${summaryText}`;
		return relatedIds.length === 0 ? head : `${head} ⇄ ${relatedIds.join(", ")}`;
	};
	let line = build(summary, related);
	if (line.length > itemMax && related.length > 1) {
		related = related.slice(0, 1);
		line = build(summary, related);
	}
	if (line.length > itemMax) {
		const room = itemMax - build("", related).length - (summary === "" ? 0 : 3);
		line = build(clip(summary, Math.min(SUMMARY_MAX, Math.max(0, room))), related);
	}
	if (line.length > itemMax) line = `${line.slice(0, Math.max(0, itemMax - 1))}…`;
	return {
		entry: {
			id,
			track: candidate.track,
			name: candidate.name,
			title,
			summary,
			related,
			chars: line.length
		},
		line
	};
}
/** 在 limit 字符内拼装索引块（不含尾行）。 */
function compose(ranked, limit, itemMax, relatedMax) {
	const all = ranked.map((_, index) => packOne(ranked, index, itemMax, relatedMax));
	const lines = [];
	const entries = [];
	const omitted = [];
	let used = 0;
	for (const item of all) {
		const prefix = entries.length === 0 ? 45 : 1;
		if (used + prefix + item.line.length <= limit) {
			used += prefix + item.line.length;
			lines.push(item.line);
			entries.push(item.entry);
			continue;
		}
		omitted.push(item.entry);
	}
	if (entries.length === 0) return {
		text: "",
		entries,
		omitted
	};
	return {
		text: `${ENTRIES_HEADER}\n${lines.join("\n")}`,
		entries,
		omitted
	};
}
/** 尾行：「另有 N 条未内联（可按 ID 展开）：id1, id2…」；放不下就逐个减 ID，最后只给数量。 */
function tailOf(omitted, used, budget) {
	if (omitted.length === 0) return "";
	const count = `另有 ${omitted.length} 条未内联（可按 ID 展开）`;
	const ids = omitted.map((entry) => entry.id);
	for (let take = Math.min(TAIL_MAX_IDS, ids.length); take >= 1; take -= 1) {
		const rest = omitted.length > take ? `，等 ${omitted.length} 条` : "";
		const line = `${count}：${ids.slice(0, take).join(", ")}${rest}`;
		if (used + 2 + line.length <= budget) return line;
	}
	return used + 2 + count.length <= budget ? count : "";
}
/**
* 内联索引主入口：按 `rank()` 顺序逐条内联，放不下的进 `omitted`，尾部给一行可展开提示。
*
* 输出形如：
*   团队记忆索引（按 ID 用 auto_team_memory expand 展开全文）：
*   mem://project/conventions · 项目记忆 · 团队约定 — 提交前必须跑 pnpm build ⇄ mem://public/git
*   另有 3 条未内联（可按 ID 展开）：mem://project/a, mem://project/b
*
* budget<=0 或候选全空时返回空文本且 truncated=false；任何输入下 `chars === text.length ≤ budget`。
*/
function memoryIndexOf(goal, candidates, budget, opts) {
	const itemMax = Math.max(1, opts?.itemMax ?? 200);
	const relatedMax = Math.max(0, opts?.relatedMax ?? 3);
	const safeBudget = Math.max(0, budget);
	const ranked = rank(goal, candidates);
	if (safeBudget <= 0 || ranked.length === 0) return {
		text: "",
		entries: [],
		omitted: [],
		chars: 0,
		budget: safeBudget,
		truncated: false
	};
	const full = compose(ranked, safeBudget, itemMax, relatedMax);
	if (full.omitted.length === 0) return {
		text: full.text,
		entries: full.entries,
		omitted: [],
		chars: full.text.length,
		budget: safeBudget,
		truncated: false
	};
	const trimmed = compose(ranked, Math.max(0, safeBudget - TAIL_RESERVE), itemMax, relatedMax);
	const chosen = trimmed.entries.length > 0 ? trimmed : full;
	const tail = tailOf(chosen.omitted, chosen.text.length, safeBudget);
	const text = tail === "" ? chosen.text : chosen.text === "" ? tail : `${chosen.text}\n\n${tail}`;
	return {
		text,
		entries: chosen.entries,
		omitted: chosen.omitted,
		chars: text.length,
		budget: safeBudget,
		truncated: chosen.omitted.length > 0
	};
}
/**
* 兼容壳：既有调用点（`bridge.snapshot` / `bridge.memoryFor`）零改动。
* `text` 与 `memoryIndexOf` 同源，绝不各自拼一份（历史 bug 族：两处各拼一份）。
*/
function selectMemory(goal, candidates, budget) {
	const index = memoryIndexOf(goal, candidates, budget);
	return {
		text: index.text,
		truncated: index.truncated,
		included: index.entries.map((entry) => entry.name),
		chars: index.chars,
		omitted: index.omitted.length,
		entries: index.entries,
		notInlined: index.omitted
	};
}
// src/host/memory/repo.ts
/**
* 记忆双轨仓库：公共（`<home>/.dsh/auto-team/memory/public`）与项目（`<workspace>/.auto-team/memory`）。
*
* 安全要点（AC-24 的可验证面）：文件名只允许**单段**，拒绝绝对路径、`..`、分隔符与空名。
* 记忆文件是用户可编辑的 md，但「写到哪个路径」不能由用户输入的名字拼出来后直接落盘——
* 否则一次 `../../` 就能把内容写到仓库外。守门函数 safeMemoryName 是纯函数，已被单测覆盖；
* **读 / 写 / 删三条路径都必须先过它**（只守写等于没守：读可以读到仓库外，删可以删到仓库外）。
*
* 写入限额（AC-25）：单任务新增记忆 ≤ MEMORY_LINES_PER_TASK 行，且每行带来源标注
* （角色/任务/时间）——来源标注由纯函数 formatSourcedLine 生成，可被 `node --test` 逐字断言。
*/
const MAX_NAME_LENGTH = 64;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** 纯函数：把用户给的记忆文件名收敛成安全单段名；非法返回 null。 */
function safeMemoryName(raw) {
	const name = (raw ?? "").trim();
	if (name === "" || name.length > MAX_NAME_LENGTH) return null;
	if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
	if (name === "." || name === "..") return null;
	if (name.startsWith(".")) return null;
	if (!NAME_PATTERN.test(name)) return null;
	return name.endsWith(".md") ? name : `${name}.md`;
}
/** 记忆档 → 目录（由调用方注入两个根，便于单测与跨平台）。 */
function memoryDirOf(track, roots) {
	return track === "public" ? roots.publicDir : roots.projectDir;
}
/** 列出某档下的 md 文件（不存在返回空数组，不抛错——面板首屏不能因目录缺失而红）。 */
function listMemory(track, roots) {
	const dir = memoryDirOf(track, roots);
	if (!existsSync(dir)) return [];
	const out = [];
	for (const entry of readdirSync(dir)) {
		if (!entry.endsWith(".md")) continue;
		const path = `${dir}/${entry}`;
		const stat = statSync(path);
		if (!stat.isFile()) continue;
		out.push({
			track,
			name: entry,
			chars: readFileSync(path, "utf8").length,
			updatedAt: stat.mtimeMs
		});
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}
/** 读一条记忆正文；不存在或非法名返回空串（面板显示「暂无内容」而非报错）。 */
function readMemory(track, name, roots) {
	const safe = safeMemoryName(name);
	if (safe === null) return "";
	const path = `${memoryDirOf(track, roots)}/${safe}`;
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}
/** 写一条记忆（自动建目录）。名字非法时返回错误而不是静默丢弃。 */
function writeMemory(track, name, body, roots) {
	const safe = safeMemoryName(name);
	if (safe === null) return {
		ok: false,
		error: `记忆文件名不合法：只允许字母数字与 ._-，且不能含路径分隔符（收到「${name}」）`
	};
	const dir = memoryDirOf(track, roots);
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}/${safe}`, body, "utf8");
	return {
		ok: true,
		name: safe
	};
}
/** 删一条记忆（同样先过 safeMemoryName，否则 `../x.md` 能删到仓库外）。 */
function deleteMemory(track, name, roots) {
	const safe = safeMemoryName(name);
	if (safe === null) return {
		ok: false,
		error: `记忆文件名不合法：「${name}」`
	};
	const path = `${memoryDirOf(track, roots)}/${safe}`;
	if (!existsSync(path)) return {
		ok: false,
		error: `记忆不存在：${safe}`
	};
	rmSync(path);
	return { ok: true };
}
// src/host/plan/graph.ts
/** 结构校验。返回第一个问题即停（面板只展示一条明确原因，不堆栈）。 */
function validateGraph(nodes) {
	if (nodes.length === 0) return {
		ok: false,
		reason: "计划为空：至少需要一个任务"
	};
	const ids = /* @__PURE__ */ new Set();
	for (const node of nodes) {
		const id = (node.id ?? "").trim();
		if (id === "") return {
			ok: false,
			reason: "存在 id 为空的任务"
		};
		if (ids.has(id)) return {
			ok: false,
			reason: `任务 id 重复：${id}`
		};
		ids.add(id);
	}
	for (const node of nodes) for (const dep of node.dependsOn ?? []) {
		if (dep === node.id) return {
			ok: false,
			reason: `任务 ${node.id} 依赖了自己`
		};
		if (!ids.has(dep)) return {
			ok: false,
			reason: `任务 ${node.id} 依赖了不存在的任务：${dep}`
		};
	}
	const cycle = findCycle(nodes);
	if (cycle) return {
		ok: false,
		reason: `依赖成环：${cycle.join(" → ")}`
	};
	return { ok: true };
}
/**
* 找出一条环（用于报错信息）。Kahn 拓扑排序剥不掉的节点集合即「在环上或依赖环」，
* 再在其中沿依赖走一圈取真实环路，保证提示可定位。
*/
function findCycle(nodes) {
	const indegree = /* @__PURE__ */ new Map();
	const children = /* @__PURE__ */ new Map();
	for (const node of nodes) {
		if (!indegree.has(node.id)) indegree.set(node.id, 0);
		children.set(node.id, children.get(node.id) ?? []);
	}
	for (const node of nodes) for (const dep of node.dependsOn ?? []) {
		if (!indegree.has(node.id) || !indegree.has(dep)) continue;
		indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
		const list = children.get(dep) ?? [];
		list.push(node.id);
		children.set(dep, list);
	}
	const queue = [];
	for (const [id, degree] of indegree) if (degree === 0) queue.push(id);
	const removed = /* @__PURE__ */ new Set();
	while (queue.length > 0) {
		const id = queue.shift();
		removed.add(id);
		for (const child of children.get(id) ?? []) {
			const next = (indegree.get(child) ?? 0) - 1;
			indegree.set(child, next);
			if (next === 0) queue.push(child);
		}
	}
	if (removed.size === nodes.length) return null;
	const remaining = nodes.filter((node) => !removed.has(node.id));
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const path = [];
	const seen = /* @__PURE__ */ new Map();
	let cursor = remaining[0]?.id;
	while (cursor !== void 0) {
		const at = seen.get(cursor);
		if (at !== void 0) return [...path.slice(at), cursor];
		seen.set(cursor, path.length);
		path.push(cursor);
		cursor = (byId.get(cursor)?.dependsOn ?? []).find((dep) => !removed.has(dep));
	}
	return remaining.map((node) => node.id);
}
/** 可派发集合：自身状态为 pending/ready/rework，且所有依赖都是 done。 */
function readyTasks(tasks) {
	const doneIds = new Set(tasks.filter((task) => task.status === "done").map((task) => task.id));
	return tasks.filter((task) => task.status === "pending" || task.status === "ready" || task.status === "rework").filter((task) => (task.dependsOn ?? []).every((dep) => doneIds.has(dep))).map((task) => task.id);
}
/** 被阻塞集合 → 阻挡它的未完成依赖列表。 */
function blockedTasks(tasks) {
	const doneIds = new Set(tasks.filter((task) => task.status === "done").map((task) => task.id));
	return tasks.filter((task) => task.status === "pending" || task.status === "ready" || task.status === "rework").map((task) => ({
		id: task.id,
		waitingOn: (task.dependsOn ?? []).filter((dep) => !doneIds.has(dep))
	})).filter((entry) => entry.waitingOn.length > 0);
}
// src/host/plan/plan.ts
/** 校验草稿并统一成 Plan；失败返回中文原因（面板与工具都直接展示）。 */
function buildPlan(draft, runId, now) {
	const tasks = draft.tasks.map((task, index) => ({
		id: (task.id ?? "").trim() === "" ? `t${index + 1}` : task.id.trim(),
		title: task.title.trim(),
		roleId: task.roleId.trim(),
		dependsOn: [...new Set(task.dependsOn ?? [])],
		acceptance: (task.acceptance ?? "").trim(),
		status: "pending"
	}));
	if (tasks.some((task) => task.title === "")) return {
		ok: false,
		reason: "存在标题为空的任务"
	};
	if (tasks.some((task) => task.roleId === "")) return {
		ok: false,
		reason: "存在未指定角色的任务"
	};
	const check = validateGraph(tasks.map((task) => ({
		id: task.id,
		dependsOn: task.dependsOn
	})));
	if (!check.ok) return {
		ok: false,
		reason: check.reason
	};
	const requested = draft.maxConcurrent ?? 3;
	const maxConcurrent = Math.min(Math.max(1, requested), 8);
	return {
		ok: true,
		plan: {
			runId,
			sessionId: draft.sessionId,
			createdAt: now,
			status: "draft",
			tasks,
			maxConcurrent
		}
	};
}
/** 进度口径：done / (全部非 cancelled)。0 任务返回 0，避免除零显示 NaN。 */
function progressOf(tasks) {
	const total = tasks.length;
	if (total === 0) return {
		done: 0,
		total: 0,
		ratio: 0
	};
	const done = tasks.filter((task) => task.status === "done").length;
	return {
		done,
		total,
		ratio: done / total
	};
}
// src/host/team/stall.ts
/** 一分钟的秒数（秒数文案分档用）。 */
const MINUTE_SECONDS = 60;
/** 「直接写 N 秒」的上限：不足 10 分钟不对人做除法，秒数本身就是判断依据。 */
const PLAIN_SECONDS_LIMIT = 600;
/**
* 停滞判定。
*
* @param progressAt 最近一次实质工具调用时间；缺省（还没有任何推进信号）时回落到 `baseline`
* @param baseline   `binding.spawnedAt`（成员刚创建就是它的第一个基线）
* @param now        判定时刻
* @param stallMs    阈值（来自 `config.STALL_MS`，本模块不自读，便于单测注入不同阈值）
* @returns `stalledForMs` 在**未停滞时恒为 0**（面板文案「已停滞多久」只对停滞行有意义）
*/
function stallOf(progressAt, baseline, now, stallMs) {
	const elapsed = now - (typeof progressAt === "number" && Number.isFinite(progressAt) ? progressAt : baseline);
	const silentForMs = elapsed > 0 ? elapsed : 0;
	if (silentForMs < stallMs) return {
		stalled: false,
		stalledForMs: 0
	};
	return {
		stalled: true,
		stalledForMs: silentForMs
	};
}
/**
* 记一次实质工具调用（返回新对象，不改入参：调用方拿它去 `store.save`）。
*
* 只推进 `at`，**保留** `alertedAt`：episode 的结束由 `watcher.tick` 观察到
* 「不再停滞」后调用 {@link clearAlerted} 统一收口（单一清理点，避免两处都能改状态）。
*/
function touchProgress(progress, memberId, at) {
	const base = progress ?? {};
	const prev = base[memberId];
	const next = prev ? {
		...prev,
		at
	} : { at };
	return {
		...base,
		[memberId]: next
	};
}
/**
* 清掉本 episode 的告警标记（成员恢复产出后下一次 tick 调用）。
*
* 只有清掉它，成员**再次**卡住时才能再告警一次 —— 否则成员整轮生命周期只能响一声。
*/
function clearAlerted(progress, memberId) {
	const base = progress ?? {};
	const record = base[memberId];
	if (!record || record.alertedAt === void 0) return base;
	const next = { at: record.at };
	return {
		...base,
		[memberId]: next
	};
}
/**
* 秒数文案（AC-14 的**唯一**来源，客户端只渲染不再格式化）。
*
* - 不足 10 分钟：`92 秒`
* - 10 分钟及以上：`20 分 34 秒`（**永不省略秒**：秒是「多久没动」的判断依据）
*/
function secondsText(ms) {
	const totalSeconds = Math.max(0, Math.floor((typeof ms === "number" && Number.isFinite(ms) ? ms : 0) / 1e3));
	if (totalSeconds < PLAIN_SECONDS_LIMIT) return `${totalSeconds} 秒`;
	return `${Math.floor(totalSeconds / MINUTE_SECONDS)} 分 ${totalSeconds % MINUTE_SECONDS} 秒`;
}
/** 落进 `stallAlerts` 的整句文案，例：`开发-1 已 100 秒无实质工具调用，疑似停滞`。 */
function stallSentence(name, ms) {
	return `${name} 已 ${secondsText(ms)}无实质工具调用，疑似停滞`;
}
// src/host/bridge.ts
/**
* 面板桥的领域层：把「面板要看的」与「面板能做的」收敛成一个快照方法 + 一个动作方法，
* 与传输方式（HTTP / 工具调用）无关 —— 传输由 host/http.ts 与 adapters.ts 负责。
*
* 两条入口共用本文件（AC 高频缺陷「工具能用、面板不能用」的唯一防线）：
*   - HTTP：POST /api/auto-team/act  →  bridge.act
*   - 工具：auto_team_message / auto_team_receipt / auto_team_memory / auto_team_role → 同一个 bridge.act
*
* 15 个动作与拒绝码对照（TECHNICAL §4.2 / §5.x，r7 新增 4 个动作与 PAUSED 码）：
*   toggle               → 只改开关并落盘，**绝不派发**（反目标 1）
*   dispatch             → NOT_ENABLED / NO_PLAN / NOT_FOUND(runId) / PLAN_ALREADY_DISPATCHED /
*                          ROLE_UNAVAILABLE / MODEL_UNRESOLVABLE / CONCURRENCY_FULL（后三者来自编排层 skipped 分类）
*   cancel               → NO_PLAN
*   setTaskRole          → NOT_ENABLED / NO_PLAN / NOT_FOUND / BAD_REQUEST（已派发不可换角）
*   message              → NOT_ENABLED / NO_PLAN / NOT_FOUND / BAD_REQUEST / NO_CALLER（端口透传）
*   resume               → NOT_ENABLED / NO_PLAN / NOT_FOUND
*   receipt              → NOT_ENABLED / NO_PLAN / NOT_FOUND / GATE_FAILED（空验收命令）
*   saveMemory           → NOT_ENABLED / BAD_REQUEST（非法文件名）
*   deleteMemory         → NOT_ENABLED / BAD_REQUEST / NOT_FOUND
*   saveRole             → NOT_ENABLED / BAD_REQUEST
*   deleteRole           → NOT_ENABLED / NOT_FOUND / BAD_REQUEST（内置角色不可删）
*   pause                → NOT_ENABLED / NO_PLAN / BAD_REQUEST（计划已结束）；重复暂停幂等
*   resumeTeam           → NOT_ENABLED / NO_PLAN / BAD_REQUEST（计划已结束）；未暂停幂等 no-op
*   restoreDefaultRoles  → NOT_ENABLED / BAD_REQUEST（角色库不可写）
*   saveSettings         → NOT_ENABLED / BAD_REQUEST（任一项非法 → 磁盘一字不改）
*
* **PAUSED 闸门**（r7 AC-16）：计划处于暂停态时，`dispatch` / `resume` / `receipt` 一律被拒
* （这三个都会推进状态机），其余动作放行。闸门就在 `act()` 的入口处一处判断，不散落到组件。
*/
/** 门禁串行队列上限（TECHNICAL §5.3：避免一次 receipt 风暴炸出多个 shell）。 */
const GATE_QUEUE_LIMIT = 8;
/** 活动流最多保留的条数（面板只显示最近 50 条，避免快照无限膨胀）。 */
const ACTIVITY_LIMIT = 50;
/** peer 交接消息的 messageId 前缀（`handoff:<上游>-><下游>`，AC-5 的幂等键，由 team/handoff.ts 生成）。 */
const HANDOFF_MESSAGE_PREFIX = "handoff:";
/** 空验收命令的拒绝码：TECHNICAL §5.3 明确要求 GATE_FAILED，但 §4.2 的码表未收录，故窄化断言。 */
const GATE_FAILED = "GATE_FAILED";
const NOT_ENABLED_TEXT = "自动团队未启用：请先在输入框内的「自动团队」选项处启用";
/** PAUSED 文案（AC-16）：必须同时说清「为什么被拒」与「下一步点哪儿」。 */
const PAUSED_TEXT = "任务已暂停：请先在面板顶部点「继续任务」再操作";
/** 暂停期间被闸门拒绝的动作（三个都会推进状态机；其余动作照常放行）。 */
const PAUSED_BLOCKED = /* @__PURE__ */ new Set([
	"dispatch",
	"resume",
	"receipt"
]);
function createBridge(deps) {
	const now = deps.now ?? (() => Date.now());
	/**
	* 生效设置（r7 AC-13）：**每次读盘**而不是装配时读一次 —— 用户在设置页改完立刻生效，
	* 不需要重启宿主。读失败（文件损坏/无权限）由 `settingsRepo.read()` 自己回落缺省，这里不再兜。
	*/
	function settingsOf() {
		return deps.settingsRepo === void 0 ? defaultSettings() : deps.settingsRepo.read();
	}
	/**
	* 停滞阈值：装配层显式注入优先（测试/演练要固定阈值），否则取 settings（缺省 = `STALL_MS`）。
	* 这条优先级刻意与「设置生效点」相反，理由见 AC-11：常量值不变、参数可注入，
	* 单测才能用 2000ms 打出 stalls 而不必等 90 秒。
	*/
	function stallMsOf(settings) {
		return deps.stallMs ?? (settings ?? settingsOf()).stallMs;
	}
	/** 技能只读投影（AC-16 设置页要能勾选，但正文不进快照）。 */
	function skillsOf() {
		return BUILTIN_SKILLS.map((skill) => ({
			id: skill.id,
			title: skill.title,
			description: firstLine(skill.body.replace(/^#+\s*/, ""))
		}));
	}
	const flags = loadFlags();
	let messageSeq = 0;
	let gateQueueDepth = 0;
	let gateChain = Promise.resolve();
	function flagsPath() {
		return `${deps.dataRoot}/sessions.json`;
	}
	function loadFlags() {
		const path = flagsPath();
		if (!existsSync(path)) return {};
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8"));
			return parsed !== null && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	}
	function persistFlags() {
		mkdirSync(deps.dataRoot, { recursive: true });
		const path = flagsPath();
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(flags, null, 2)}\n`, "utf8");
		renameSync(tmp, path);
	}
	function loadState(sessionId) {
		return deps.store.latestForSession(sessionId);
	}
	function saveState(state) {
		deps.store.save(state);
		return state;
	}
	function withTask(state, taskId, patch) {
		return {
			...state,
			plan: {
				...state.plan,
				tasks: state.plan.tasks.map((task) => task.id === taskId ? patch(task) : task)
			}
		};
	}
	function recordOf(input) {
		messageSeq += 1;
		return {
			at: input.at,
			from: input.from,
			to: input.to,
			toMemberId: input.toMemberId,
			taskId: input.taskId,
			body: input.body,
			messageId: `msg-${input.at}-${messageSeq}`
		};
	}
	/** 消息账本追加（上限 MESSAGES_LIMIT，与 store 的落盘约束同源）。 */
	function withMessage(state, message) {
		const messages = [...state.messages, message];
		return {
			...state,
			messages: messages.slice(Math.max(0, messages.length - 200))
		};
	}
	function enqueueGate(run) {
		if (gateQueueDepth >= GATE_QUEUE_LIMIT) return Promise.reject(/* @__PURE__ */ new Error(`门禁队列已满（上限 ${GATE_QUEUE_LIMIT}），请稍后再试`));
		gateQueueDepth += 1;
		const next = gateChain.then(run, run);
		gateChain = next.then(() => void 0, () => void 0);
		return next.finally(() => {
			gateQueueDepth -= 1;
		});
	}
	/**
	* peer 交接的**唯一实发点**（AC-4(a)）。`applyReceipt` 是纯函数、只落账；`deps.sendMessage`
	* 只在这个作用域可用，所以「把 body 真送进成员会话」全仓只有这一处。
	*
	* 只发「本次新增 + `from==='peer'` + `toMemberId` 有值」的条目：
	*   - `toMemberId` 有值 ⇒ 下游成员已经存在，可以实发；
	*   - 缺省 ⇒ B 尚未创建（常规路径），body 留在账本里，等 B 创建时由 `buildMemberPrompt`
	*     经 `handoffBodiesFor` 注入首条提示词（AC-4(b)），此处**不得**硬塞一条消息。
	* 失败只回 notice：绝不补一条 `from:'captain'` 的账本消息（AC-3 反面目标 3）——那会把
	* 「信息其实还是过了一遍队长」写成账本事实。
	*/
	async function deliverPeerHandoffs(before, after) {
		const known = new Set(before.messages.map((message) => message.messageId));
		const notices = [];
		for (const message of after.messages) {
			const id = message.messageId;
			if (id === void 0 || !id.startsWith(HANDOFF_MESSAGE_PREFIX) || known.has(id)) continue;
			if (message.from !== "peer" || message.toMemberId === void 0) continue;
			const target = message.to;
			try {
				const sent = await deps.sendMessage(message.toMemberId, message.body);
				notices.push(sent.ok ? `上游交接已直投给 ${target}${message.taskId === void 0 ? "" : `（${message.taskId}）`}` : `上游交接直投 ${target} 失败：${sent.error ?? "未知原因"}（记录已在账本里，成员创建时仍会注入）`);
			} catch (error) {
				notices.push(`上游交接直投 ${target} 失败：${error instanceof Error ? error.message : String(error)}（记录已在账本里）`);
			}
		}
		return notices;
	}
	function activityOf(state) {
		if (!state) return [];
		const events = [];
		events.push({
			at: state.plannedAt,
			kind: "plan",
			text: `计划就绪：${state.plan.tasks.length} 个任务（尚未创建成员）`,
			source: "user"
		});
		for (const binding of state.bindings) events.push({
			at: binding.spawnedAt,
			memberId: binding.memberId,
			taskId: binding.taskId,
			kind: "spawn",
			text: `创建成员 ${binding.name}`,
			source: "user"
		});
		for (const message of state.messages) events.push({
			at: message.at,
			memberId: message.toMemberId,
			taskId: message.taskId,
			kind: "message",
			text: `${message.from} → ${message.to}：${firstLine(message.body)}`,
			source: "user"
		});
		for (const audit of state.routeAudits) {
			if (audit.verdict !== "drift") continue;
			events.push({
				at: audit.at,
				taskId: audit.taskId,
				kind: "route_drift",
				text: `模型路由漂移：${audit.taskId} 声明 ${routeText(audit.declared)} 实际 ${routeText(audit.actual)}`
			});
		}
		for (const task of state.plan.tasks) {
			if (task.evidence) events.push({
				at: task.evidence.at,
				memberId: task.memberId,
				taskId: task.id,
				kind: "gate",
				text: `${task.id} 门禁退出码 ${task.evidence.exitCode}`
			});
			if (task.status === "rework") events.push({
				at: task.evidence?.at ?? state.plannedAt,
				memberId: task.memberId,
				taskId: task.id,
				kind: "rework",
				text: `${task.id} 返工（第 ${attemptsOf(task)} 次）`
			});
		}
		for (const alert of state.stallAlerts ?? []) events.push(alert);
		for (const record of state.triggers ?? []) {
			if (!record.accepted) continue;
			events.push({
				at: record.at,
				memberId: record.memberId,
				taskId: record.taskId,
				kind: "status",
				text: record.text,
				source: "trigger"
			});
		}
		return events.sort((a, b) => b.at - a.at).slice(0, ACTIVITY_LIMIT);
	}
	function membersOf(state, roles, stallMs) {
		if (!state) return [];
		const roleById = new Map(roles.map((role) => [role.id, role]));
		const taskById = new Map(state.plan.tasks.map((task) => [task.id, task]));
		const views = [];
		const seen = /* @__PURE__ */ new Set();
		for (const binding of state.bindings) {
			if (binding.retired === true || seen.has(binding.memberId)) continue;
			seen.add(binding.memberId);
			const status = toMemberStatus(taskById.get(binding.taskId)?.status ?? "pending");
			views.push({
				memberId: binding.memberId,
				name: binding.name,
				roleId: binding.roleId,
				taskId: binding.taskId,
				status,
				...stallFieldsOf(state, binding.memberId, status, binding.spawnedAt, stallMs),
				lastEventAt: lastEventAtOf(state, binding.memberId, binding.spawnedAt),
				modelRoute: describeRoute(roleById.get(binding.roleId)),
				canResume: status !== "done"
			});
		}
		for (const task of state.plan.tasks) {
			if (task.memberId === void 0 || seen.has(task.memberId)) continue;
			seen.add(task.memberId);
			const status = toMemberStatus(task.status);
			views.push({
				memberId: task.memberId,
				name: roleById.get(task.roleId)?.name ?? task.roleId,
				roleId: task.roleId,
				taskId: task.id,
				status,
				...stallFieldsOf(state, task.memberId, status, state.plannedAt, stallMs),
				lastEventAt: lastEventAtOf(state, task.memberId, state.plannedAt),
				modelRoute: describeRoute(roleById.get(task.roleId)),
				canResume: status !== "done"
			});
		}
		return views;
	}
	/**
	* 停滞三字段（AC-14 的数据源，客户端因此零阈值零格式化）。
	*
	* **只有 `running` 才可能 `stalled`**：done/failed/interrupted 的成员本来就不会再产出，
	* 把它们标成「停滞」等于让面板永远挂一片黄色（PRD 反面目标 4）。判定只调 `stall.stallOf`
	* （与 watcher.tick 同一份实现，阈值只作参数传入），秒数文案只调 `stall.secondsText`。
	*/
	function stallFieldsOf(state, memberId, status, fallbackAt, stallMs) {
		if (status !== "running") return {
			stalled: false,
			stalledForMs: 0,
			stalledSecondsText: ""
		};
		const progressAt = state.progress?.[memberId]?.at;
		const judge = stallOf(progressAt, progressAt ?? fallbackAt, now(), stallMs);
		return {
			stalled: judge.stalled,
			stalledForMs: judge.stalledForMs,
			stalledSecondsText: judge.stalled ? secondsText(judge.stalledForMs) : ""
		};
	}
	function lastEventAtOf(state, memberId, fallback) {
		let at = fallback;
		for (const message of state.messages) if (message.toMemberId === memberId || message.from === memberId) at = Math.max(at, message.at);
		for (const task of state.plan.tasks) {
			if (task.memberId !== memberId || !task.evidence) continue;
			at = Math.max(at, task.evidence.at);
		}
		return at;
	}
	function memoryFiles() {
		const files = [...listMemory("project", deps.memoryRoots), ...listMemory("public", deps.memoryRoots)];
		return {
			files,
			candidates: files.map((file) => ({
				track: file.track,
				name: file.name,
				body: readMemory(file.track, file.name, deps.memoryRoots),
				updatedAt: file.updatedAt
			}))
		};
	}
	function concurrencyOf(state) {
		const host = deps.hostConcurrency?.() ?? {
			limit: 8,
			source: "default"
		};
		const running = state ? state.plan.tasks.filter((task) => task.status === "running" || task.status === "gate").length : 0;
		const limit = state ? Math.min(state.plan.maxConcurrent, host.limit, 8) : Math.min(host.limit, 8);
		const requested = Math.max(host.requested ?? host.limit, 1);
		return {
			limit,
			running,
			source: host.source,
			requested,
			clamped: limit < requested
		};
	}
	function snapshot(sessionId) {
		const state = loadState(sessionId);
		const roles = deps.roles.list();
		const { files, candidates } = memoryFiles();
		const settings = settingsOf();
		const stallMs = stallMsOf(settings);
		const selected = selectMemory(state?.plan.tasks.map((task) => task.title).join(" ") ?? "", candidates, settings.memoryBudget);
		const health = deps.triggerHealth?.();
		const captain = deps.captainModel?.();
		const paused = state?.plan.status === "paused";
		const pausedAt = state?.pause?.at;
		return {
			enabled: flags[sessionId]?.enabled === true,
			runId: state?.plan.runId,
			planStatus: state?.plan.status,
			plannedAt: state?.plannedAt,
			tasks: state?.plan.tasks ?? [],
			members: membersOf(state, roles, stallMs),
			messages: state?.messages ?? [],
			routeAudits: state?.routeAudits ?? [],
			concurrency: concurrencyOf(state),
			memory: {
				injectedChars: selected.chars,
				budget: settings.memoryBudget,
				truncated: selected.truncated,
				files,
				inline: selected.entries,
				omitted: selected.notInlined
			},
			roles,
			activity: activityOf(state),
			paused,
			...paused && pausedAt !== void 0 ? { pausedAt } : {},
			settings,
			skills: skillsOf(),
			...captain === void 0 ? {} : { captainModel: captain },
			degraded: health?.degraded === true,
			...health?.degraded === true ? { degradeReason: health.reason ?? "事件源不可用，推进退回轮询兜底" } : {},
			triggers: state?.triggers ?? []
		};
	}
	function reject(code, message, sessionId, notices) {
		return {
			snapshot: snapshot(sessionId),
			notices,
			rejected: {
				code,
				message
			}
		};
	}
	function accept(sessionId, notices) {
		return {
			snapshot: snapshot(sessionId),
			notices
		};
	}
	function bindingFor(state, taskId) {
		if (taskId === void 0) return void 0;
		return state.bindings.find((binding) => binding.taskId === taskId && binding.retired !== true);
	}
	async function act(sessionId, action) {
		try {
			if (action.type !== "toggle" && flags[sessionId]?.enabled !== true) return reject("NOT_ENABLED", NOT_ENABLED_TEXT, sessionId);
			if (PAUSED_BLOCKED.has(action.type)) {
				if (loadState(sessionId)?.plan.status === "paused") return reject("PAUSED", PAUSED_TEXT, sessionId);
			}
			switch (action.type) {
				case "toggle":
					flags[sessionId] = {
						enabled: action.enabled,
						updatedAt: now()
					};
					persistFlags();
					return accept(sessionId, [action.enabled ? "自动团队已启用：队长可以拆解目标并派发成员" : "自动团队已停用：不会派发任何成员（已创建的成员不会被中断）"]);
				case "pause": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话没有可暂停的运行", sessionId);
					const current = state.plan.status;
					if (current === "terminated" || current === "cancelled") return reject("BAD_REQUEST", `计划已结束（${current}），无法暂停`, sessionId);
					if (current === "paused" && state.pause !== void 0) return accept(sessionId, ["任务已处于暂停状态"]);
					const frozen = {};
					const tasks = state.plan.tasks.map((task) => {
						if (task.status !== "running" && task.status !== "ready") return task;
						frozen[task.id] = task.status;
						return {
							...task,
							status: "paused"
						};
					});
					const preStatus = current === "paused" ? "dispatching" : current;
					const at = now();
					saveState(withMessage({
						...state,
						plan: {
							...state.plan,
							status: "paused",
							tasks
						},
						pause: {
							at,
							planStatus: preStatus,
							tasks: frozen
						}
					}, recordOf({
						from: "captain",
						to: "user",
						at,
						body: `已暂停本次运行：冻结 ${Object.keys(frozen).length} 个任务（在跑的成员不会被中断，门禁/恢复/派发暂停受理）`
					})));
					return accept(sessionId, [`已暂停：${Object.keys(frozen).length} 个任务被冻结，计划状态 ${preStatus} → paused`]);
				}
				case "resumeTeam": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话没有可继续的运行", sessionId);
					const current = state.plan.status;
					if (current === "terminated" || current === "cancelled") return reject("BAD_REQUEST", `计划已结束（${current}），无法继续`, sessionId);
					if (state.pause === void 0 && current !== "paused") return accept(sessionId, ["当前没有暂停的任务：无需继续"]);
					const restore = state.pause?.tasks ?? {};
					let restored = 0;
					const tasks = state.plan.tasks.map((task) => {
						if (task.status !== "paused") return task;
						const target = restore[task.id];
						const status = target === void 0 || target === "paused" || target === "done" ? "ready" : target;
						restored += 1;
						return {
							...task,
							status
						};
					});
					const planStatus = state.pause?.planStatus ?? "dispatching";
					const backTo = planStatus === "draft" || planStatus === "dispatching" ? planStatus : "dispatching";
					const at = now();
					const { pause: _dropped, ...rest } = state;
					saveState(withMessage({
						...rest,
						plan: {
							...state.plan,
							status: backTo,
							tasks
						}
					}, recordOf({
						from: "captain",
						to: "user",
						at,
						body: `已继续：${restored} 个任务按暂停前的原状态还原，计划状态 paused → ${backTo}`
					})));
					return accept(sessionId, [`已继续：${restored} 个任务已还原`, `计划状态 paused → ${backTo}`]);
				}
				case "dispatch": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话还没有执行计划：先让队长拆解目标（auto_team_plan）", sessionId);
					if (action.runId !== void 0 && action.runId !== state.plan.runId) return reject("NOT_FOUND", `找不到运行 ${action.runId}（当前会话最新运行是 ${state.plan.runId}）`, sessionId);
					const status = state.plan.status;
					if (status !== "draft" && status !== "dispatching") return reject("NO_PLAN", `计划状态为 ${status}，不能派发（需要 draft/dispatching）`, sessionId);
					const boundIds = new Set(state.bindings.filter((binding) => binding.retired !== true).map((binding) => binding.taskId));
					const unbound = readyTasks(state.plan.tasks).filter((taskId) => !boundIds.has(taskId));
					if (status === "dispatching" && unbound.length === 0) return reject("PLAN_ALREADY_DISPATCHED", "计划已派发：成员已在运行，不会重复起人（中断的成员请用「继续」恢复）", sessionId);
					const outcome = await deps.dispatch(state);
					const notices = [];
					for (const rename of outcome.renamed ?? []) {
						const title = state.plan.tasks.find((task) => task.id === rename.taskId)?.title;
						notices.push(`任务「${title ?? rename.taskId}」(${rename.taskId}) 的成员名 ${rename.base} 已被占用，已改用 ${rename.final} 派发`);
					}
					for (const skipped of outcome.skipped) notices.push(`${skipped.taskId} 跳过：${skipText(skipped.reason)}`);
					for (const error of outcome.errors) notices.push(`${error.taskId} 失败：${error.error}`);
					if (outcome.started.length > 0) notices.unshift(`已创建 ${outcome.started.length} 个成员：${outcome.started.join("、")}`);
					else if (outcome.skipped.length === 0 && outcome.errors.length === 0) {
						const blocked = blockedTasks(state.plan.tasks);
						notices.push(blocked.length > 0 ? `没有可派发的任务：${blocked.map((item) => `${item.id} 等待 ${item.waitingOn.join("、")}`).join("；")}` : "没有可派发的任务：全部已完成");
					}
					const skipCodes = uniqueCodes(outcome.skipped.map((skipped) => skipped.reason));
					if (outcome.started.length === 0 && outcome.errors.length === 0 && skipCodes.length === 1) {
						const code = skipCodes[0];
						return reject(code, skipText(code), sessionId, notices);
					}
					if (outcome.started.length === 0 && outcome.errors.length > 0 && skipCodes.length === 0) {
						const first = outcome.errors[0];
						return reject(first.code ?? "BAD_REQUEST", first.error, sessionId, notices);
					}
					return accept(sessionId, notices);
				}
				case "cancel": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话没有进行中的运行", sessionId);
					if (state.plan.status === "cancelled") return accept(sessionId, ["本次运行已取消"]);
					saveState({
						...state,
						plan: {
							...state.plan,
							status: "cancelled"
						}
					});
					return accept(sessionId, ["已取消本次运行：不会再有新的派发（已创建的成员仍可对话）"]);
				}
				case "setTaskRole": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话还没有执行计划", sessionId);
					const task = state.plan.tasks.find((item) => item.id === action.taskId);
					if (!task) return reject("NOT_FOUND", `找不到任务 ${action.taskId}`, sessionId);
					const role = deps.roles.get(action.roleId);
					if (!role) return reject("NOT_FOUND", `找不到角色 ${action.roleId}`, sessionId);
					if (bindingFor(state, action.taskId) || task.status === "running" || task.status === "gate") return reject("BAD_REQUEST", `任务 ${action.taskId} 已派发，不能替换角色（先取消本次运行）`, sessionId);
					saveState(withTask(state, action.taskId, (item) => ({
						...item,
						roleId: role.id
					})));
					return accept(sessionId, [`任务 ${action.taskId} 的角色已改为 ${role.name}（${role.id}）`]);
				}
				case "message": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话还没有执行计划：没有可对话的成员", sessionId);
					const text = (action.text ?? "").trim();
					if (text === "") return reject("BAD_REQUEST", "消息内容不能为空", sessionId);
					const binding = bindingFor(state, action.taskId);
					const memberId = action.memberId ?? binding?.memberId;
					if (memberId === void 0) return reject("NOT_FOUND", action.taskId !== void 0 ? `任务 ${action.taskId} 还没有成员` : "缺少 memberId 或 taskId", sessionId);
					const sent = await deps.sendMessage(memberId, text);
					if (!sent.ok) return reject(sent.code ?? "NOT_FOUND", sent.error ?? "直达消息发送失败", sessionId);
					saveState(withMessage(state, recordOf({
						from: "captain",
						to: binding?.name ?? memberId,
						toMemberId: memberId,
						taskId: binding?.taskId ?? action.taskId,
						body: text,
						at: now()
					})));
					return accept(sessionId, [`已发送给 ${binding?.name ?? memberId}`]);
				}
				case "resume": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话没有可恢复的运行", sessionId);
					if (action.taskId !== void 0 && !state.plan.tasks.some((task) => task.id === action.taskId)) return reject("NOT_FOUND", `找不到任务 ${action.taskId}`, sessionId);
					const outcome = await deps.resume(state);
					const notices = [];
					if (outcome.resumed > 0) notices.push(`已恢复 ${outcome.resumed} 个成员`);
					if (outcome.unchanged) notices.push("本次没有恢复任何成员：刚恢复过的 3 秒内不重复发送；成员已不在的任务标为「已中断」（不会自动新建，需重新派发）");
					else if (outcome.resumed === 0) notices.push("没有可恢复的成员（已完成的不重跑；成员已不在的标为「已中断」，不会自动新建）");
					return accept(sessionId, notices);
				}
				case "receipt": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话还没有执行计划", sessionId);
					const task = state.plan.tasks.find((item) => item.id === action.taskId);
					if (!task) return reject("NOT_FOUND", `找不到任务 ${action.taskId}`, sessionId);
					if (task.status === "done") return accept(sessionId, [`任务 ${action.taskId} 已完成，不重复跑门禁`]);
					const empty = task.acceptance.trim() === "";
					const settings = settingsOf();
					const gateState = withTask(state, action.taskId, (item) => ({
						...item,
						status: "gate"
					}));
					saveState(gateState);
					let outcome;
					try {
						outcome = await enqueueGate(() => Promise.resolve(runGate(task, {
							cwd: deps.gate.cwd,
							artifactsDir: deps.gate.artifactsDir,
							timeoutMs: deps.gate.timeoutMs ?? settings.gateTimeoutMs,
							now
						})));
					} catch (error) {
						saveState(withTask(gateState, action.taskId, (item) => ({
							...item,
							status: task.status
						})));
						return reject("BAD_REQUEST", `门禁执行失败：${error instanceof Error ? error.message : String(error)}`, sessionId);
					}
					const evidence = outcome.evidence;
					if (!outcome.ok && empty) {
						saveState(withTask(gateState, action.taskId, (item) => ({
							...item,
							status: task.status
						})));
						return reject(GATE_FAILED, "该任务没有验收命令，需要人工确认后放行", sessionId, [`门禁未执行：${action.taskId} 的 acceptance 为空（退出码 ${evidence.exitCode}）`]);
					}
					const verdict = outcome.ok ? "done" : "rework";
					let next = deps.applyReceipt(gateState, action.taskId, {
						verdict,
						note: action.note,
						evidence
					}, now(), settings.maxAttempts);
					const notices = [outcome.ok ? `门禁通过（退出码 ${evidence.exitCode}）：${action.taskId} 已完成` : `门禁未通过（退出码 ${evidence.exitCode}）：${action.taskId} 转返工`];
					if (verdict === "rework") {
						const binding = bindingFor(next, action.taskId);
						if (binding) {
							const text = `门禁未通过（退出码 ${evidence.exitCode}）：请按以下证据返工\n${evidence.tail}`;
							const sent = await deps.sendMessage(binding.memberId, text);
							if (!sent.ok) notices.push(`证据回发失败：${sent.error ?? "未知原因"}`);
							if (next.messages.length === gateState.messages.length) next = withMessage(next, recordOf({
								from: "captain",
								to: binding.name,
								toMemberId: binding.memberId,
								taskId: action.taskId,
								body: text,
								at: now()
							}));
						} else notices.push("该任务没有成员：证据只落在面板与日志里");
					}
					notices.push(...await deliverPeerHandoffs(gateState, next));
					const updated = next.plan.tasks.find((item) => item.id === action.taskId);
					if (updated?.status === "failed") notices.push(`任务 ${action.taskId} 已返工 ${attemptsOf(updated)} 次仍未通过，转人工处理`);
					saveState(next);
					return accept(sessionId, notices);
				}
				case "saveMemory": {
					const track = trackOf(action.track);
					if (!track) return reject("BAD_REQUEST", "track 必须是 public 或 project", sessionId);
					const name = safeMemoryName(action.name);
					if (name === null) return reject("BAD_REQUEST", "非法文件名：只允许单段名称（字母/数字/._-，自动补 .md）", sessionId);
					const written = writeMemory(track, name, action.body ?? "", deps.memoryRoots);
					if (!written.ok) return reject("BAD_REQUEST", written.error, sessionId);
					return accept(sessionId, [`已保存 ${track}/${written.name}`]);
				}
				case "deleteMemory": {
					const track = trackOf(action.track);
					if (!track) return reject("BAD_REQUEST", "track 必须是 public 或 project", sessionId);
					const name = safeMemoryName(action.name);
					if (name === null) return reject("BAD_REQUEST", "非法文件名：只允许单段名称（字母/数字/._-，自动补 .md）", sessionId);
					const removed = deleteMemory(track, name, deps.memoryRoots);
					if (!removed.ok) return reject("NOT_FOUND", removed.error, sessionId);
					return accept(sessionId, [`已删除 ${track}/${name}`]);
				}
				case "saveRole": {
					const role = action.role;
					if (!role || typeof role.id !== "string" || role.id.trim() === "" || typeof role.name !== "string" || role.name.trim() === "") return reject("BAD_REQUEST", "角色必须有非空的 id 与 name", sessionId);
					const saved = deps.roles.save(role);
					if (!saved.ok) return reject("BAD_REQUEST", saved.error, sessionId);
					return accept(sessionId, [`已保存角色 ${saved.role.name}（${saved.role.id}）`]);
				}
				case "deleteRole": {
					const roleId = typeof action.roleId === "string" ? action.roleId.trim() : "";
					if (roleId === "") return reject("BAD_REQUEST", "roleId 不能为空", sessionId);
					if (!deps.roles.get(roleId)) return reject("NOT_FOUND", `找不到角色 ${roleId}`, sessionId);
					const removed = deps.roles.remove(roleId);
					if (!removed.ok) return reject("BAD_REQUEST", removed.error, sessionId);
					return accept(sessionId, [`已删除角色 ${roleId}`]);
				}
				case "restoreDefaultRoles": {
					let outcome;
					try {
						outcome = deps.roles.restoreDefaults();
					} catch (error) {
						return reject("BAD_REQUEST", `恢复默认角色失败：${error instanceof Error ? error.message : String(error)}`, sessionId);
					}
					const keptCustom = outcome.kept.length === 0 ? "没有自建角色" : `自建角色保持不动（${outcome.kept.join("、")}）`;
					return accept(sessionId, [`已恢复 ${outcome.restored.length} 个内置角色（名称/描述/提示词/技能/模型全部回到内置值）`, keptCustom]);
				}
				case "saveSettings": {
					if (deps.settingsRepo === void 0) return reject("BAD_REQUEST", "设置仓储未装配：本次运行无法保存设置", sessionId);
					const saved = deps.settingsRepo.save(action.settings);
					if (!saved.ok) return reject("BAD_REQUEST", saved.reason, sessionId);
					let callbackError = "";
					try {
						deps.onSettingsSaved?.(saved.settings);
					} catch (error) {
						callbackError = error instanceof Error ? error.message : String(error);
					}
					const notices = [`设置已保存：并发 ${saved.settings.concurrencyLimit}｜记忆预算 ${saved.settings.memoryBudget}｜停滞阈值 ${saved.settings.stallMs}ms｜返工上限 ${saved.settings.maxAttempts}｜门禁超时 ${saved.settings.gateTimeoutMs}ms`, `队长模型：${saved.settings.captainModel === void 0 ? "跟随会话默认" : `${saved.settings.captainModel.provider}/${saved.settings.captainModel.model}`}`];
					if (callbackError !== "") notices.push(`设置已落盘，但生效步骤失败：${callbackError}（重启宿主后生效）`);
					return accept(sessionId, notices);
				}
				default: return reject("BAD_REQUEST", `未知面板动作：${action.type ?? "undefined"}`, sessionId);
			}
		} catch (error) {
			return {
				snapshot: snapshot(sessionId),
				rejected: {
					code: "BAD_REQUEST",
					message: `面板动作失败：${error instanceof Error ? error.message : String(error)}`
				}
			};
		}
	}
	return {
		enabled(sessionId) {
			return flags[sessionId]?.enabled === true;
		},
		setEnabled(sessionId, enabled) {
			flags[sessionId] = {
				enabled,
				updatedAt: now()
			};
			persistFlags();
		},
		snapshot,
		act,
		async readMemoryFile(track, name) {
			const safe = safeMemoryName(name);
			if (safe === null) return { error: "非法文件名" };
			if (!listMemory(track, deps.memoryRoots).some((file) => file.name === safe)) return { error: `记忆文件不存在：${track}/${safe}` };
			const body = readMemory(track, safe, deps.memoryRoots);
			return { data: {
				track,
				name: safe,
				body,
				chars: body.length
			} };
		},
		memoryFor(goal) {
			const { candidates } = memoryFiles();
			const selected = selectMemory(goal, candidates, settingsOf().memoryBudget);
			return {
				text: selected.text,
				truncated: selected.truncated,
				chars: selected.chars
			};
		},
		remember(track, name, body) {
			const written = writeMemory(track, name, (body ?? "").split("\n").slice(0, 20).join("\n"), deps.memoryRoots);
			if (!written.ok) return { error: written.error };
			return { data: { name: written.name } };
		},
		expandMemory(id, depth) {
			const expander = deps.expander;
			if (expander === void 0) return { error: `记忆展开不可用：宿主未装配记忆目录（无法展开 ${id}）` };
			try {
				return { data: expander(id, depth) };
			} catch (error) {
				return { error: `记忆展开失败：${error instanceof Error ? error.message : String(error)}` };
			}
		}
	};
}
function trackOf(raw) {
	return raw === "public" || raw === "project" ? raw : null;
}
function firstLine(text) {
	const line = (text ?? "").split("\n")[0] ?? "";
	return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
function attemptsOf(task) {
	return typeof task.attempts === "number" ? task.attempts : 0;
}
function routeText(route) {
	if (!route) return "未声明";
	const effort = route.reasoningEffort ? ` #${route.reasoningEffort}` : "";
	return `${route.provider}/${route.model}${effort}`;
}
/** 编排层 skipped 的原因串 → 拒绝码（只认码表里的 10 个，其余当提示）。 */
function asRejectionCode(raw) {
	switch (raw) {
		case "NOT_ENABLED":
		case "NO_PLAN":
		case "PLAN_ALREADY_DISPATCHED":
		case "ROLE_UNAVAILABLE":
		case "MODEL_UNRESOLVABLE":
		case "ROUTE_DRIFT":
		case "CONCURRENCY_FULL":
		case "NOT_FOUND":
		case "NO_CALLER":
		case "BAD_REQUEST": return raw;
		default: return null;
	}
}
function uniqueCodes(raws) {
	const codes = [];
	for (const raw of raws) {
		const code = asRejectionCode(raw);
		if (code !== null && !codes.includes(code)) codes.push(code);
	}
	return codes;
}
function skipText(reason) {
	switch (reason) {
		case "CONCURRENCY_FULL": return "并发已满，等运行中的任务结束再派发";
		case "ROLE_UNAVAILABLE": return "角色不存在：先在角色页创建该角色（不会猜一个角色顶上）";
		case "MODEL_UNRESOLVABLE": return "角色指定的模型不可用：先修正 provider/model（不会静默回退到队长模型）";
		case "ROUTE_DRIFT": return "实际模型与角色声明不一致：请核对模型路由";
		case "ALREADY_RUNNING": return "成员已在运行（幂等，不重复起人）";
		default: return reason;
	}
}
/** 角色模型路由的逐字展示（AC-22：不许省略、不许改写成别名）。 */
function describeRoute(role) {
	if (!role?.model) return "会话默认";
	const effort = role.model.reasoningEffort ? ` #${role.model.reasoningEffort}` : "";
	return `${role.model.provider}/${role.model.model}${effort}`;
}
/**
* 任务状态 / 宿主成员状态 → 面板 7 态（**唯一映射表**，watcher 复用，组件里禁止再写一份）。
* 宿主 4 态：running / inactive / provisioning / failed。
*/
function toMemberStatus(status) {
	switch (status) {
		case "running":
		case "gate": return "running";
		case "idle":
		case "provisioning": return "idle";
		case "blocked": return "blocked";
		case "rework": return "rework";
		case "done": return "done";
		case "failed": return "failed";
		case "inactive":
		case "interrupted": return "interrupted";
		default: return "idle";
	}
}
// src/host/adapters.ts
/**
* 读一个**可选**服务：唯一入口，只走 `ctx.get`（纪律 §2/§3）。
*
* 三种降级路径各自 warn 并返回 undefined，**任何一条都不许回退裸读**：
*  - ctx 没有 get（旧宿主 / 手搓 fake ctx）→ 按缺失处理；
*  - 宿主没注册该服务（get 返回 undefined/null）→ 按缺失处理；
*  - get 抛错（服务加载失败等）→ 按缺失处理，异常不出本函数。
* 调用方拿到 undefined 后各自降级（不注册路由 / 不带模型覆盖 / 跳过预校验）。
*/
function optionalService(ctx, name) {
	const getter = ctx.get;
	if (typeof getter !== "function") {
		ctx.logger?.warn?.(`[auto-team] 宿主 ctx 缺少 get()，可选服务 ${name} 按缺失降级`);
		return;
	}
	try {
		const service = getter.call(ctx, name);
		if (service === void 0 || service === null) {
			ctx.logger?.warn?.(`[auto-team] 宿主未提供可选服务 ${name}，相关功能降级`);
			return;
		}
		return service;
	} catch (error) {
		ctx.logger?.warn?.(`[auto-team] 读取可选服务 ${name} 失败（${messageOf$3(error)}），按缺失降级`);
		return;
	}
}
/**
* 静默读一个服务：与 `optionalService` 同源，但**不 warn**。
*
* 用在「此刻缺失是正常时序」的地方（启动早期 webServer 尚未激活、随后由 `ctx.inject`
* 等它就绪）。用 `optionalService` 会让正常启动刷一条「相关功能降级」的假告警。
*/
function readServiceQuietly(ctx, name) {
	const getter = ctx.get;
	if (typeof getter !== "function") return void 0;
	try {
		return getter.call(ctx, name) ?? void 0;
	} catch {
		return;
	}
}
/**
* [已核] ToolDefinition = ToolSchema & { output: ToolOutputDefinition, execute(args, exec) }
*   ToolSchema        = { name, description, parameters }
*   ToolOutputDefinition = { schema: JsonSchemaNode, render(args, value): ContentBlock[] }
* 缺 `output` 会让宿主在 register 或首次调用时报错，因此这里必须补齐。
*/
function toHostToolDefinition(spec) {
	return {
		name: spec.name,
		description: spec.description,
		parameters: spec.parameters,
		output: {
			schema: spec.outputSchema ?? { type: "object" },
			render: (_args, value) => [{
				type: "text",
				text: typeof value === "string" ? value : JSON.stringify(value ?? null)
			}]
		},
		execute: spec.handler
	};
}
/** 注册一个工具；宿主缺 tools 服务时静默跳过并 warn（不得抛错，AC-9）。 */
function registerTool(ctx, spec) {
	const sink = ctx.tools;
	if (!sink?.register) {
		ctx.logger?.warn?.(`[auto-team] 宿主未提供 tools 服务，跳过工具注册：${spec.name}`);
		return false;
	}
	try {
		sink.register(toHostToolDefinition(spec));
		return true;
	} catch (error) {
		ctx.logger?.warn?.(`[auto-team] 工具注册失败：${spec.name}（${messageOf$3(error)}）`);
		return false;
	}
}
/** [已核] PromptSection 用 `text`（string | (context) => string），不是 render/content。 */
function registerPromptSection(ctx, section) {
	const sink = ctx.systemPrompt;
	if (!sink?.section) {
		ctx.logger?.warn?.("[auto-team] 宿主未提供 systemPrompt 服务，跳过队长段落注入");
		return false;
	}
	try {
		sink.section({
			name: section.name,
			order: section.order,
			text: () => typeof section.content === "function" ? section.content() : section.content
		});
		return true;
	} catch (error) {
		ctx.logger?.warn?.(`[auto-team] 队长提示词段落注入失败（${messageOf$3(error)}）`);
		return false;
	}
}
/**
* 把全部内部路由挂到宿主：单条 prefix 路由 + 自己写 res。
* 任一路由抛错都必须转成 500 JSON，绝不能把异常抛回宿主 HTTP 栈。
*
* 时序（真机实测 2026-11-01，r6 的 404 根因）：宿主启动早期 `webServer` **尚未激活**，
* `ctx.get('webServer')` 返回 undefined —— 早先的实现只试这一次就 `return false`，
* 结果是路由一条也没注册，面板「刷新」永远拿到 404 `not found`，而宿主日志里没有告警
* （可选服务 warn 走的是 logger，启动早期也可能还没接上）。
* 现在的顺序：① 先试一次立即注册（服务已就绪的宿主一次性成功）；
* ② 拿不到就 `ctx.inject(['webServer'], cb)` 等它就绪再注册；③ 都没有（非 web 宿主）才 false。
*/
function registerHttpRoutes(ctx, routes, prefix = BRIDGE_ROUTE) {
	const install = (sink) => {
		if (!sink?.register) return false;
		try {
			sink.register({
				kind: "prefix",
				path: prefix,
				handler: async (req, res) => {
					const url = typeof req.url === "string" ? req.url : "";
					const pathname = url.includes("?") ? url.slice(0, url.indexOf("?")) : url;
					const method = (req.method ?? "GET").toUpperCase();
					const route = routes.find((item) => item.method === method && item.path === pathname);
					const reply = (status, payload) => {
						res.statusCode = status;
						res.setHeader("content-type", "application/json; charset=utf-8");
						res.end(JSON.stringify(payload));
					};
					if (!route) {
						reply(404, { error: `未知面板接口：${method} ${pathname}` });
						return;
					}
					try {
						const body = await readJson(req);
						reply(200, await route.handle({
							method,
							pathname,
							url,
							json: async () => body
						}) ?? {});
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						ctx.logger?.warn?.(`[auto-team] 面板接口失败：${method} ${pathname} → ${message}`);
						reply(500, { error: message });
					}
				}
			});
			return true;
		} catch (error) {
			ctx.logger?.warn?.(`[auto-team] 面板路由注册失败（${messageOf$3(error)}）`);
			return false;
		}
	};
	if (install(readServiceQuietly(ctx, "webServer"))) return true;
	if (typeof ctx.inject !== "function") return false;
	try {
		ctx.inject(["webServer"], (scope) => {
			const late = scope?.webServer ?? readServiceQuietly(ctx, "webServer");
			if (!install(late)) ctx.logger?.warn?.("[auto-team] webServer 就绪后仍无法注册面板路由，面板将显示接口不可用");
		});
		return true;
	} catch (error) {
		ctx.logger?.warn?.(`[auto-team] 等待 webServer 就绪失败（${messageOf$3(error)}）`);
		return false;
	}
}
/** 读请求体并解析 JSON；空体返回 undefined（GET 场景）。 */
function readJson(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("error", reject);
		req.on("end", () => {
			const text = chunks.map((chunk) => typeof chunk === "string" ? chunk : String(chunk)).join("");
			if (text.trim() === "") return resolve(void 0);
			try {
				resolve(JSON.parse(text));
			} catch (error) {
				reject(/* @__PURE__ */ new Error(`请求体不是合法 JSON：${error instanceof Error ? error.message : String(error)}`));
			}
		});
	});
}
/**
* [已核] agentTeams 的 caller 参数：必须是「当前活跃 Agent」。工具在 Agent 的异步链里执行，
* 因此 ctx.agents.currentInitiator() 就是队长本身。拿不到时不给假 agent（宿主会拒绝或越权）。
*/
function resolveCaller(ctx) {
	try {
		const initiator = ctx.agents?.currentInitiator?.();
		if (initiator && typeof initiator.id === "string") return initiator;
	} catch {}
	try {
		const required = ctx.agents?.requireInitiator?.();
		if (required && typeof required.id === "string") return required;
	} catch {}
}
const NO_CALLER = "当前没有活跃的队长会话：agentTeams 需要以 Agent 身份调用，请在会话内使用本工具。";
/** 把角色声明的路由摊成请求字段（宿主忽略未知字段，探针/日志可核）。 */
function spawnRouteFields(route) {
	if (!route) return {};
	return {
		model: route.model,
		...route.reasoningEffort === void 0 ? {} : { reasoningEffort: route.reasoningEffort }
	};
}
/**
* 待装路由表：**成员名 → 角色声明路由**。
*
* 为什么必须是预先登记而不是查 binding：`agent/created` 在 `spawnTeammate()` 内部触发
* （宿主流程 = 「await serial agent/created 监听 → 才放行成员首个请求」），此刻 dispatch
* 还没拿到 memberId、也没落盘 binding，用 binding 反查永远查不到。
* 键用**我们请求的成员名**：宿主 `memberName()` 校验后原样返回（lower-kebab、≤64），名不漂。
*/
const pendingRoutes = /* @__PURE__ */ new Map();
function trackPendingRoute(name, route) {
	if (route === void 0) return;
	pendingRoutes.set(name, route);
}
function settlePendingRoute(name) {
	pendingRoutes.delete(name);
}
/** 按候选名（宿主回报名 / 请求名 / agent id）取走待装路由，取到即删。 */
function takePendingRoute(names) {
	for (const name of names) {
		const route = pendingRoutes.get(name);
		if (route !== void 0) {
			pendingRoutes.delete(name);
			return route;
		}
	}
}
/**
* 待回填的**实际路由**表：成员名 → `agent/created` 观测到的实际路由（`null` = 事件来了但拿不到值）。
*
* 与 {@link pendingRoutes} 同源同因：事件在 `spawnTeammate()` 内部触发，那一刻 dispatch 还没
* 落盘 binding，所以审计不能在事件里查 binding，只能在这里先存下「宿主实际用了什么模型」，
* 等 spawn 返回、binding 落盘后由编排层（`dispatch.ts` 步 f）取走写进 `routeAudits`（AC-22）。
* 取走即删；`spawn` 开始前也先清一次，避免上一次同任务的旧观测被后来的 spawn 误认。
*/
const pendingActuals = /* @__PURE__ */ new Map();
/** 待回填表的容量上限：残留项（事件先到、没人在等）不能无限涨。 */
const PENDING_ACTUAL_LIMIT = 100;
function trackPendingActual(names, actual) {
	for (const name of names) {
		if (typeof name !== "string" || name === "") continue;
		pendingActuals.set(name, actual);
	}
	while (pendingActuals.size > PENDING_ACTUAL_LIMIT) {
		const oldest = pendingActuals.keys().next();
		if (oldest.done === true) break;
		pendingActuals.delete(oldest.value);
	}
}
function settlePendingActual(names) {
	for (const name of names) pendingActuals.delete(name);
}
/**
* 按候选名取走实际路由，取到即删。
* 返回 `undefined` = 压根没观测到（宿主没发 `agent/created`），`null` = 观测到但拿不到实际值；
* 两者在审计里都落 `unverified`，但语义不同，不要让调用方把它们混成一个值。
*/
function takePendingActual(names) {
	for (const name of names) {
		if (!pendingActuals.has(name)) continue;
		const actual = pendingActuals.get(name) ?? null;
		pendingActuals.delete(name);
		return actual;
	}
}
function createSpawnPorts(ctx, signal) {
	const teams = ctx.agentTeams;
	/** memberId → 成员名：宿主 sendMessage 的 target 是**名字**，不是 id。 */
	const names = /* @__PURE__ */ new Map();
	function fallbackProvider() {
		try {
			const selection = optionalService(ctx, "agentDefaultModel")?.currentSelection?.();
			if (typeof selection?.provider === "string" && selection.provider !== "") return selection.provider;
		} catch {}
		return "";
	}
	function refreshNames(caller) {
		try {
			const rows = teams?.listMembers?.(caller);
			if (!Array.isArray(rows)) return;
			for (const row of rows) if (typeof row?.id === "string" && typeof row?.name === "string") names.set(row.id, row.name);
		} catch {}
	}
	return {
		async spawn(input) {
			if (!teams?.spawnTeammate) return {
				ok: false,
				error: "宿主未提供 agentTeams.spawnTeammate，无法创建成员（请确认 auto-teams 能力已启用）"
			};
			const caller = resolveCaller(ctx);
			if (!caller) return {
				ok: false,
				error: NO_CALLER
			};
			const provider = input.route?.provider ?? fallbackProvider();
			if (provider === "") return {
				ok: false,
				error: "无法确定成员的 provider：角色未声明模型且宿主未提供默认模型选择"
			};
			trackPendingRoute(input.name, input.route);
			settlePendingActual([input.name]);
			try {
				const member = (await teams.spawnTeammate(caller, {
					name: input.name,
					description: input.description ?? `任务 ${input.taskId}`,
					prompt: [{
						type: "text",
						text: input.prompt
					}],
					context: "fresh",
					provider,
					...spawnRouteFields(input.route),
					signal: signal ?? new AbortController().signal
				}))?.member;
				if (typeof member?.id !== "string" || member.id === "") return {
					ok: false,
					error: "spawnTeammate 未返回 member.id：宿主返回值形状与预期不符"
				};
				if (typeof member.name === "string") names.set(member.id, member.name);
				const actual = takePendingActual([
					input.name,
					member.id,
					typeof member.name === "string" ? member.name : ""
				]);
				return {
					ok: true,
					memberId: member.id,
					...actual === void 0 ? {} : { actual }
				};
			} catch (error) {
				return {
					ok: false,
					error: `创建成员失败：${error instanceof Error ? error.message : String(error)}`
				};
			} finally {
				settlePendingRoute(input.name);
				settlePendingActual([input.name]);
			}
		},
		async sendMessage(memberId, text) {
			if (!teams?.sendMessage) return {
				ok: false,
				error: "宿主未提供 agentTeams.sendMessage"
			};
			const caller = resolveCaller(ctx);
			if (!caller) return {
				ok: false,
				error: NO_CALLER
			};
			if (!names.has(memberId)) refreshNames(caller);
			const target = names.get(memberId) ?? memberId;
			try {
				await teams.sendMessage(caller, {
					target,
					content: [{
						type: "text",
						text
					}],
					signal: signal ?? new AbortController().signal
				});
				return { ok: true };
			} catch (error) {
				return {
					ok: false,
					error: `直达消息失败：${error instanceof Error ? error.message : String(error)}`
				};
			}
		}
	};
}
/**
* [已核] llm.resolveCallConfig(config: LlmCallConfig, signal?) → LlmCallConfig
*
* 三个分支的语义（AC-22 的诚实口径，L1 限制）：
*  - 宿主没有 resolver：返回声明值（放行 + warn）——宁可派出去再失败，也不静默把用户配置判死；
*  - resolver 返回 null/undefined：`null` = 解析不出来，调用方据此拒绝派发并给出 MODEL_UNRESOLVABLE；
*  - resolver 抛错：同样 `null`。
* 注意：宿主 `SpawnTeammateRequest` 只有 provider、没有 model，所以这里只做**可用性预校验**；
* 真正下发在 `agent/created` 里装 member-scoped 路由（见 installMemberRoute），
* 实际路由再经 auditRoute 核对（见 registerAgentCreated）。
*/
function createRoutePorts(ctx) {
	return { async resolveRoute(route) {
		const llm = optionalService(ctx, "llm");
		if (!llm?.resolveCallConfig) return route;
		try {
			const resolved = await llm.resolveCallConfig({
				provider: route.provider,
				model: route.model
			});
			if (resolved === void 0 || resolved === null) return null;
			return route;
		} catch (error) {
			ctx.logger?.warn?.(`[auto-team] 模型路由解析失败：${route.provider}/${route.model}（${messageOf$3(error)}）`);
			return null;
		}
	} };
}
function hostError(message, code) {
	const error = new Error(message);
	error.code = code;
	return error;
}
/**
* 成员名单：`agentTeams.listMembers(caller)`，返回宿主行。
* 拿不到名单时 **抛错**（而不是返回空数组）——空数组在 watcher 眼里等于「成员全死了」，
* 会把所有任务误标 interrupted；抛错则本轮跳过，宁可漏报一轮也不误杀。
*/
async function listHostMembers(ctx) {
	const teams = ctx.agentTeams;
	if (!teams?.listMembers) throw hostError("宿主未提供 agentTeams.listMembers：无法核对成员存活状态。", "NOT_FOUND");
	const caller = resolveCaller(ctx);
	if (!caller) throw hostError(NO_CALLER, "NO_CALLER");
	return normalizeMemberRows(await teams.listMembers(caller));
}
/** 宿主返回可能是数组、也可能是 `{ members: [...] }`；两种都吃，其余一律当空。 */
function normalizeMemberRows(rows) {
	const list = Array.isArray(rows) ? rows : rows && typeof rows === "object" && Array.isArray(rows.members) ? rows.members : [];
	const members = [];
	for (const item of list) {
		if (!item || typeof item !== "object") continue;
		const row = item;
		const id = typeof row.id === "string" ? row.id : typeof row.memberId === "string" ? row.memberId : "";
		const name = typeof row.name === "string" ? row.name : "";
		if (!id && !name) continue;
		members.push({
			id,
			name,
			status: typeof row.status === "string" ? row.status : ""
		});
	}
	return members;
}
/**
* 宿主并发上限：字段名有四种可能（契约未实测），逐个探测；都没有就回落到
* DEFAULT_MAX_CONCURRENT(3)，并把 source 标成 'default' 让面板如实显示来源。
*/
function resolveConcurrencyLimit(ctx) {
	const teams = ctx.agentTeams;
	for (const key of [
		"concurrencyLimit",
		"maxConcurrent",
		"maxConcurrency",
		"maxTeammates"
	]) {
		const value = teams?.[key];
		if (typeof value === "number" && Number.isFinite(value) && value >= 1) return {
			limit: Math.min(Math.floor(value), 8),
			source: "host"
		};
	}
	return {
		limit: 3,
		source: "default"
	};
}
/**
* 注册清理回调（Cordis `ctx.effect(dispose)`）。宿主没有该能力时返回 false：
* 插件仍可用，只是退出时少一次显式清理（watcher/定时器靠 unref 也不会拽住进程）。
*/
function registerEffect(ctx, dispose) {
	if (typeof ctx.effect !== "function") {
		ctx.logger?.warn?.("[auto-team] 宿主未提供 effect 注册，退出时不会显式停止成员轮询");
		return false;
	}
	try {
		ctx.effect(dispose);
		return true;
	} catch (error) {
		ctx.logger?.warn?.(`[auto-team] effect 注册失败（${messageOf$3(error)}）`);
		return false;
	}
}
function agentContextOf(agent) {
	const ctx = agent?.ctx;
	if (!ctx || typeof ctx !== "object") return null;
	const candidate = ctx;
	return typeof candidate.on === "function" ? candidate : null;
}
/** payload 里的对象是否「像个 agent」：有非空 id / name，或挂着 ctx（宿主 Agent 的最小可辨认特征）。 */
function isAgentLike(value) {
	if (!value || typeof value !== "object") return false;
	const candidate = value;
	if (typeof candidate.id === "string" && candidate.id !== "") return true;
	if (typeof candidate.name === "string" && candidate.name !== "") return true;
	return candidate.ctx !== null && typeof candidate.ctx === "object";
}
/**
* 从工具事件 payload 里尽力取一个「发起调用的 agent」；取不到返回 `undefined`。
*
* 只认**已实测**的三种形状（AGENTS §4 / commit 5b47746）：
*  1. `exec` 本身（`exec.agent?: Agent { readonly id }`）；
*  2. `{ exec }` 包装（监听器签名 `(exec, result)` 被我们自己包了一层时）；
*  3. `{ agent }`（宿主别的 emit 事件把 agent 直接挂在根上时）。
*
* **不猜字段名**：宿主形状里没有 `sender` / `owner` 这类同义词，猜错会把推进记到别人头上，
* 表现是「A 的调用救了 B 的停滞」——比漏记一次更糟。
*/
function agentOfToolEvent(payload) {
	if (!payload || typeof payload !== "object") return void 0;
	const root = payload;
	const candidates = [root.agent];
	const exec = root.exec;
	if (exec && typeof exec === "object") candidates.push(exec.agent);
	for (const candidate of candidates) if (isAgentLike(candidate)) return candidate;
}
/**
* 订阅「成员有实质产出」的信号，回调里带 agent 与时刻（AC-9 的第二个数据来源）。
*
* 事件选择：只用 **emit** 类事件，绝不订阅 waterfall（`tools/execute` 必须调 `next()`，
* 漏调会吞掉工具执行、改错信号会破坏取消链 —— AGENTS §4 的硬约定）。
*  - L1 `tools/result`：`(exec, result)`，`exec.agent` 是发起者，宿主在 agent 作用域注册时
*    按 `exec.agent` 过滤；
*  - L2 `agent/status`：兜底。万一宿主把 `tools/result` 过滤在本成员作用域内、根作用域收不到，
*    状态变化仍能给出推进信号（两者都注册，去重交给 `touchProgress`：同一时刻多记一次无副作用）。
*
* 降级：宿主没有 `ctx.on` 时 **warn 并返回空 stop**，绝不抛错 —— 停滞判定会退化成
* 「以 `binding.spawnedAt` 为基线」，仍然会在成员真的不动时告警（L3 的语义）。
*/
function onMemberProgress(ctx, handler) {
	if (typeof ctx.on !== "function") {
		ctx.logger?.warn?.("[auto-team] 宿主未提供 ctx.on：停滞判定降级为「以派发时间为基线」");
		return { stop() {} };
	}
	const on = ctx.on.bind(ctx);
	const disposers = [];
	const subscribe = (event, agentOf) => {
		try {
			const dispose = on(event, (...args) => {
				try {
					const agent = agentOf(args);
					if (agent === void 0) return;
					handler({
						agent,
						at: Date.now()
					});
				} catch (error) {
					ctx.logger?.warn?.(`[auto-team] 推进事件处理失败（${messageOf$3(error)}）`);
				}
			});
			if (typeof dispose === "function") disposers.push(dispose);
		} catch (error) {
			ctx.logger?.warn?.(`[auto-team] 订阅 ${event} 失败（${messageOf$3(error)}）`);
		}
	};
	subscribe("tools/result", (args) => agentOfToolEvent(args.length > 1 ? { exec: args[0] } : args[0]));
	subscribe("agent/status", (args) => agentOfToolEvent(args[0] ?? args));
	return { stop() {
		while (disposers.length > 0) {
			const dispose = disposers.pop();
			try {
				dispose?.();
			} catch {}
		}
	} };
}
/**
* 把角色声明的模型路由装到**该成员自己的** `agent.ctx` 上（AC-22 的真正下发点）。
*
* 语义对齐宿主 `installModelSelection(agentCtx, { current, assembled })`，但不 import
* `@deepseek-ai/dsh-agent`（本包运行时零 @deepseek-ai 依赖，见交付契约第 6 条），只走公开事件：
*  - `system-prompt/assemble`：记录本轮实际生效的路由（宿主在同一事件里也这么做）；
*  - `agent/request`：把已解析的调用配置改写成声明路由，并**剔除继承来的 reasoningEffort**
*    （不清掉的话队长的高/低 effort 会漏给成员，宿主实现同样先剔继承值）。
* 注册挂在 `agent.ctx` 上，Agent 释放时由宿主一并回收；返回 disposer 只给单测用。
* 宿主 ctx 形状不认识时返回 null（调用方据此落 unverified，不假装生效）。
*/
function installMemberRoute(agent, route) {
	const agentCtx = agentContextOf(agent);
	if (agentCtx === null) return null;
	const on = agentCtx.on.bind(agentCtx);
	const selection = { current: route };
	const disposers = [];
	try {
		disposers.push(on("system-prompt/assemble", async (...args) => {
			const next = args[args.length - 1];
			const assembled = typeof next === "function" ? await next() : void 0;
			selection.assembled = selection.current;
			return assembled;
		}));
		disposers.push(on("agent/request", async (...args) => {
			const next = args[args.length - 1];
			const resolved = typeof next === "function" ? await next() : void 0;
			if (!resolved || typeof resolved !== "object") return resolved;
			const selected = selection.assembled ?? selection.current;
			const rest = { ...resolved };
			delete rest.reasoningEffort;
			return {
				...rest,
				provider: selected.provider,
				model: selected.model,
				...selected.reasoningEffort === void 0 ? {} : { reasoningEffort: selected.reasoningEffort }
			};
		}));
	} catch (error) {
		for (const dispose of disposers) try {
			dispose?.();
		} catch {}
		return null;
	}
	return () => {
		for (const dispose of disposers) try {
			dispose?.();
		} catch {}
	};
}
/** 成员身份：名字只认宿主 `agentTeams.tryMembership`（消息/对账都按名字），拿不到再退回 agent 自身字段。 */
function memberIdentityOf(ctx, agent) {
	let id = "";
	let name = "";
	try {
		const membership = ctx.agentTeams?.tryMembership?.(agent);
		if (membership && typeof membership === "object") {
			if (typeof membership.id === "string") id = membership.id;
			if (typeof membership.name === "string") name = membership.name;
		}
	} catch {}
	const own = agent;
	if (id === "" && typeof own?.id === "string") id = own.id;
	if (name === "" && typeof own?.name === "string") name = own.name;
	return {
		id,
		name
	};
}
/**
* `agent/created` 订阅：**装 member-scoped 模型路由**（AC-22 真正生效的地方）+ 拿实际路由做漂移审计。
*
* 两步顺序不能反：先在事件内装路由（宿主 await 本监听结束后才放行成员首个请求），
* 装成功就记 `installed`；装不上（宿主 ctx 形状不认识）才退回宿主自报的 `model`。
*/
function registerAgentCreated(ctx, handler) {
	if (!ctx.on) {
		ctx.logger?.warn?.("[auto-team] 宿主未提供事件订阅，成员将按 provider 默认模型运行");
		return false;
	}
	try {
		ctx.on("agent/created", (payload) => {
			const parsed = parseAgentCreated(payload);
			if (!parsed) return;
			try {
				let identity = parsed.member;
				let installed;
				if (parsed.agent !== void 0) {
					const resolved = memberIdentityOf(ctx, parsed.agent);
					if (resolved.id !== "") identity = {
						...identity,
						id: resolved.id
					};
					if (resolved.name !== "") identity = {
						...identity,
						name: resolved.name
					};
					const route = takePendingRoute([
						identity.name,
						parsed.member.name,
						identity.id,
						parsed.member.id
					]);
					if (route !== void 0 && installMemberRoute(parsed.agent, route) !== null) installed = route;
				}
				const actual = installed ?? parsed.model ?? null;
				trackPendingActual([
					identity.name,
					identity.id,
					parsed.member.name,
					parsed.member.id
				], actual);
				handler({
					member: identity,
					...parsed.model === void 0 ? {} : { model: parsed.model },
					...installed === void 0 ? {} : { installed }
				});
			} catch (error) {
				ctx.logger?.warn?.(`[auto-team] agent/created 处理失败（${messageOf$3(error)}）`);
			}
		});
		return true;
	} catch (error) {
		ctx.logger?.warn?.(`[auto-team] agent/created 订阅失败（${messageOf$3(error)}）`);
		return false;
	}
}
/**
* 解析 `agent/created` payload；认不出的形状返回 null（宁可不审计，也不写错值）。
* 真实形状 `{ agent, source, signal? }`；也接受 `{ member: { id, name }, model }` 这类上报形状。
*/
function parseAgentCreated(payload) {
	if (!payload || typeof payload !== "object") return null;
	const root = payload;
	const memberRaw = root.member ?? root.agent ?? root;
	if (!memberRaw || typeof memberRaw !== "object") return null;
	const id = typeof memberRaw.id === "string" ? memberRaw.id : "";
	const name = typeof memberRaw.name === "string" ? memberRaw.name : "";
	if (!id && !name) return null;
	const model = normalizeModel(root.model ?? memberRaw.model ?? root.route);
	const agent = root.agent;
	return {
		member: {
			id,
			name
		},
		...model ? { model } : {},
		...agent === void 0 ? {} : { agent }
	};
}
function messageOf$3(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* 队长 noWait 守卫的宿主绑定（AC-4 的唯一执行点）。
*
* **放行分支必须 `next()`**：`tools/execute` 是 waterfall，漏调就把这次工具执行吞掉
* （模型看到「什么都没发生」，比被拒绝更难排查）。因此这里只有两条出口：
*   - 放行 → `next()`（原样交回下游）；
*   - 拒绝 → **不调** `next()`，直接返回拒绝对象（waterfall 短路）。
*
* 三级降级写死在这里（U1：短路返回形状未在真实宿主实测）：
*   - L1（本实现）：返回 `ToolGuardRejection`，命令不执行，模型收到 code + message；
*   - L2（L1 形状若被宿主拒收时的退路）：把拒绝分支改成 `throw new Error(verdict.message)`，
*     命令同样不执行，模型看到的是错误而不是结果对象；
*   - L3（`ctx.on` 不存在 / 订阅直接抛错）：不注册守卫，warn 一次，降级为提示词自律
*     —— QA-REPORT 必须记为「未验证」，**不得**算 AC-4 通过。
*
* 失败模式一律 fail-open：判定异常、入参形状不认识、非 bash 工具都**放行**。
* 守卫的误杀代价（拦住队长正常工作）远高于漏拦一次（anti-goal 1）。
*/
function registerToolGuard(ctx, decide) {
	const on = ctx.on;
	if (typeof on !== "function") {
		ctx.logger?.warn?.("[auto-team] 宿主未提供 ctx.on：noWait 守卫未装配，队长仍可能前台同步长等待");
		return () => {};
	}
	const listener = (...args) => {
		const next = args[args.length - 1];
		const nextFn = typeof next === "function" ? next : null;
		const request = guardRequestOf(args[0]);
		if (request === null) return nextFn === null ? void 0 : nextFn();
		let verdict;
		try {
			verdict = decide(request);
		} catch (error) {
			ctx.logger?.warn?.(`[auto-team] noWait 守卫判定异常，本次放行（${messageOf$3(error)}）`);
			return nextFn === null ? void 0 : nextFn();
		}
		if (verdict === void 0 || verdict.allow !== false) return nextFn === null ? void 0 : nextFn();
		return {
			ok: false,
			code: verdict.code,
			message: verdict.message,
			command: verdict.command
		};
	};
	try {
		const dispose = on.call(ctx, "tools/execute", listener);
		return typeof dispose === "function" ? () => {
			try {
				dispose();
			} catch {}
		} : () => {};
	} catch (error) {
		ctx.logger?.warn?.(`[auto-team] noWait 守卫订阅失败，队长仍可能前台同步长等待（${messageOf$3(error)}）`);
		return () => {};
	}
}
/** 从 `tools/execute` 的第一个入参取 `{name, arguments, agent}`；形状不认识返回 `null`（→ 放行）。 */
function guardRequestOf(payload) {
	const exec = toolExecutionOf(payload);
	if (exec === null) return null;
	const name = exec.name;
	if (typeof name !== "string" || name === "") return null;
	const agent = exec.agent;
	const id = agent !== null && typeof agent === "object" ? agent.id : void 0;
	return {
		toolName: name,
		args: exec.arguments,
		agentId: typeof id === "string" && id !== "" ? id : null
	};
}
/** 工具执行对象：`exec` 本身，或被我们自己包成 `{ exec }` 的形态（与 agentOfToolEvent 同一口径）。 */
function toolExecutionOf(payload) {
	if (payload === null || typeof payload !== "object") return null;
	const wrapped = payload.exec;
	if (wrapped !== null && wrapped !== void 0 && typeof wrapped === "object") return wrapped;
	return payload;
}
/** 订阅的四类宿主事件（顺序即订阅顺序，测试按此断言）。 */
const TRIGGER_EVENT_NAMES = [
	"agent/status",
	"subagent/end",
	"agent/error",
	"tools/result"
];
/**
* 订阅四类宿主事件 → Trigger 归一化（AC-12 的唯一 payload 读取点）。
*
* 与 `onMemberProgress` 的分工：那个只管「成员有实质产出」（停滞判定的基线），
* 这个只把**事件原样**交给 handler，判定口径（去重/幂等/该不该推进）在 `team/trigger.ts`。
*
* 语义：`tools/result` 的监听签名是 `(exec, result)`，这里统一包成 `{ exec, result }`
* 具名对象再交出去 —— 消费侧不必再记参数位序；其余三类单参事件原样传 payload。
*
* 降级（U2：四个事件的名字/payload 形状未在真实宿主实测）：
*   - 任一事件订阅抛错 → `degraded: true` + warn，其余事件照常订阅（少一路不等于全废）；
*   - `ctx.on` 完全不存在 → `degraded: true`，四类推进全部退回 `watcher.tick` 的 poll 通路，
*     因此「事件源关闭后四类各有一次推进」仍成立（AC-18）。
*/
function onHostTriggerEvents(ctx, handler) {
	if (typeof ctx.on !== "function") {
		ctx.logger?.warn?.("[auto-team] 宿主未提供 ctx.on：Trigger 事件源不可用，四类推进退回轮询兜底");
		return {
			stop() {},
			degraded: true
		};
	}
	const subscribe = ctx.on.bind(ctx);
	const disposers = [];
	let failed = 0;
	for (const name of TRIGGER_EVENT_NAMES) try {
		const dispose = subscribe(name, (...args) => {
			try {
				handler(name, payloadOfEvent(name, args));
			} catch (error) {
				ctx.logger?.warn?.(`[auto-team] Trigger 事件处理失败（${name}：${messageOf$3(error)}）`);
			}
		});
		if (typeof dispose === "function") disposers.push(dispose);
	} catch (error) {
		failed += 1;
		ctx.logger?.warn?.(`[auto-team] 订阅 ${name} 失败：该类 Trigger 退回轮询兜底（${messageOf$3(error)}）`);
	}
	return {
		degraded: failed > 0,
		stop() {
			while (disposers.length > 0) {
				const dispose = disposers.pop();
				try {
					dispose?.();
				} catch {}
			}
		}
	};
}
/** 事件 payload 归一化：只做「参数位序 → 具名对象」，不解析业务字段（U2 未实测，读字段等于猜）。 */
function payloadOfEvent(name, args) {
	if (name === "tools/result") return {
		exec: args[0],
		result: args[1]
	};
	if (args.length === 1) return args[0];
	if (args.length === 0) return void 0;
	return args;
}
/**
* 主 session（队长）的 agent：只走**已实测**通道 `ctx.agents.currentInitiator()`。
*
* apply 期这个值通常是 `undefined`（它只在工具执行期有值），所以队长模型能力位
* 今天几乎必然是 `unsupported` —— 这正是 U3 未验证时的诚实结果（anti-goal 5：不假称生效）。
* 任何宿主侧异常都吞掉返回 `null`：能力位缺失只能让「模型没生效」显示出来，不能拖垮装配。
*/
function captainAgentOf(ctx) {
	try {
		return ctx.agents?.currentInitiator?.() ?? null;
	} catch {
		return null;
	}
}
/**
* 主 session 的事件作用域（`agent.ctx` 形状）。
*
* 与 `installCaptainRoute` 必须同源（同一个 `captainAgentOf`）：先探测后安装，
* 否则会出现「探测说能装、安装拿不到」的自相矛盾状态。
*/
function captainAgentScopeOf(ctx) {
	return agentContextOf(captainAgentOf(ctx));
}
/**
* 把队长模型路由装到主 session 的 `agent.ctx` 上（AC-2 / AC-3 的唯一生效路径）。
*
* 语义与成员路由**完全一致**（`system-prompt/assemble` 记录本轮生效值 + `agent/request`
* 改写调用配置并剔除继承的 `reasoningEffort`），因此直接复用 `installMemberRoute`，
* 不再写第二套改写实现（同一类风险只留一道实现）。
*
* 返回 `null` = 拿不到主 session 作用域 → 调用方落 `unsupported` 并回显配置，**不假装生效**。
*/
function installCaptainRoute(ctx, route) {
	const agent = captainAgentOf(ctx);
	if (agent === null) return null;
	return installMemberRoute(agent, route);
}
// src/host/tools.ts
const NOT_ENABLED = "自动团队未启用：请在输入框内的「自动团队」选项处启用后再试。";
/** 当前会话 id：由工具调用元信息带入；缺失时退回 'current'（面板按会话隔离，不会串数据）。 */
function sessionOf(meta) {
	const value = meta;
	return value?.sessionId ?? value?.session?.id ?? "current";
}
function taskBrief(task) {
	return {
		id: task.id,
		title: task.title,
		roleId: task.roleId,
		dependsOn: task.dependsOn,
		status: task.status,
		memberId: task.memberId,
		acceptance: task.acceptance
	};
}
function rejectedOf(result) {
	if (!result.rejected) return null;
	return {
		ok: false,
		code: result.rejected.code,
		error: result.rejected.message,
		notices: result.notices
	};
}
function buildToolSpecs(deps) {
	return [
		{
			name: `${TOOL_PREFIX}plan`,
			description: "把一个目标拆成有依赖的任务图并生成执行计划（不创建任何成员）。每个任务需要 roleId 与 acceptance（可执行的验收命令）。返回 runId，派发时必须带上它。",
			parameters: {
				type: "object",
				properties: {
					goal: {
						type: "string",
						description: "要达成的目标"
					},
					maxConcurrent: {
						type: "integer",
						description: "并发上限，默认 3，硬上限 8"
					},
					tasks: {
						type: "array",
						description: "任务列表（依赖必须指向同一列表里的 id）",
						items: {
							type: "object",
							properties: {
								id: {
									type: "string",
									description: "任务 id，缺省按 t1/t2… 生成"
								},
								title: { type: "string" },
								roleId: {
									type: "string",
									description: "执行该任务的角色 id"
								},
								dependsOn: {
									type: "array",
									items: { type: "string" }
								},
								acceptance: {
									type: "string",
									description: "验收命令（门禁据此产出证据）"
								}
							},
							required: ["title", "roleId"]
						}
					}
				},
				required: ["goal", "tasks"]
			},
			async handler(args, meta) {
				const sessionId = sessionOf(meta);
				if (!deps.bridge.enabled(sessionId)) return {
					ok: false,
					error: NOT_ENABLED
				};
				const at = deps.now();
				const draft = buildPlan({
					sessionId,
					goal: typeof args.goal === "string" ? args.goal : "",
					maxConcurrent: typeof args.maxConcurrent === "number" ? args.maxConcurrent : void 0,
					tasks: Array.isArray(args.tasks) ? args.tasks : []
				}, uniqueRunId(deps.store, sessionId, at), at);
				if (!draft.ok) return {
					ok: false,
					error: draft.reason
				};
				const state = {
					version: 3,
					plan: draft.plan,
					plannedAt: at,
					messages: [],
					bindings: [],
					routeAudits: []
				};
				deps.store.save(state);
				return {
					ok: true,
					runId: draft.plan.runId,
					plannedAt: state.plannedAt,
					maxConcurrent: draft.plan.maxConcurrent,
					tasks: draft.plan.tasks.map(taskBrief),
					ready: readyTasks(draft.plan.tasks),
					blocked: blockedTasks(draft.plan.tasks),
					members: 0,
					note: "计划已保存，尚未创建任何成员；用户确认后调用 auto_team_dispatch（必须带 runId）。"
				};
			}
		},
		{
			name: `${TOOL_PREFIX}dispatch`,
			description: "按依赖顺序派发就绪任务并创建成员（并发受 maxConcurrent 与宿主上限限制）。必须带 plan 返回的 runId。",
			parameters: {
				type: "object",
				properties: { runId: {
					type: "string",
					description: "auto_team_plan 返回的 runId（必填）"
				} },
				required: ["runId"]
			},
			async handler(args, meta) {
				const sessionId = sessionOf(meta);
				if (!deps.bridge.enabled(sessionId)) return {
					ok: false,
					error: NOT_ENABLED
				};
				const runId = typeof args.runId === "string" ? args.runId.trim() : "";
				if (runId === "") return {
					ok: false,
					error: "auto_team_dispatch 必须带 runId：先调用 auto_team_plan 生成计划，再用它返回的 runId 派发（计划必须早于成员创建）。"
				};
				const state = deps.store.load(runId);
				if (!state || state.plan.sessionId !== sessionId) return {
					ok: false,
					error: `找不到运行 ${runId}：当前会话没有这个 runId（重新调用 auto_team_plan）`
				};
				const result = await deps.bridge.act(sessionId, {
					type: "dispatch",
					runId
				});
				const rejected = rejectedOf(result);
				if (rejected) return rejected;
				const snapshot = result.snapshot;
				return {
					ok: true,
					runId: snapshot.runId,
					planStatus: snapshot.planStatus,
					concurrency: snapshot.concurrency,
					tasks: snapshot.tasks.map(taskBrief),
					members: snapshot.members.map((member) => ({
						memberId: member.memberId,
						name: member.name,
						roleId: member.roleId,
						taskId: member.taskId,
						status: member.status,
						modelRoute: member.modelRoute
					})),
					notices: result.notices
				};
			}
		},
		{
			name: `${TOOL_PREFIX}status`,
			description: "读取当前会话的执行计划、成员状态、门禁证据、消息账本、记忆注入预算与角色列表。",
			parameters: {
				type: "object",
				properties: {},
				required: []
			},
			async handler(_args, meta) {
				const sessionId = sessionOf(meta);
				if (!deps.bridge.enabled(sessionId)) return {
					ok: false,
					error: NOT_ENABLED
				};
				const snapshot = deps.bridge.snapshot(sessionId);
				return {
					ok: true,
					enabled: snapshot.enabled,
					runId: snapshot.runId,
					planStatus: snapshot.planStatus,
					plannedAt: snapshot.plannedAt,
					progress: progressOf(snapshot.tasks),
					concurrency: snapshot.concurrency,
					tasks: snapshot.tasks.map((task) => ({
						...taskBrief(task),
						evidence: task.evidence ? {
							exitCode: task.evidence.exitCode,
							command: task.evidence.command,
							at: task.evidence.at
						} : void 0
					})),
					members: snapshot.members,
					messages: snapshot.messages.slice(-20),
					routeAudits: snapshot.routeAudits,
					memory: {
						injectedChars: snapshot.memory.injectedChars,
						budget: snapshot.memory.budget,
						truncated: snapshot.memory.truncated,
						files: snapshot.memory.files.map((file) => `${file.track}/${file.name}`)
					},
					roles: snapshot.roles.map((role) => ({
						id: role.id,
						name: role.name,
						model: role.model
					}))
				};
			}
		},
		{
			name: `${TOOL_PREFIX}message`,
			description: "给指定成员发直达消息（按 taskId 或成员名定位）。成员可续聊；中断后用同一成员继续。",
			parameters: {
				type: "object",
				properties: {
					taskId: {
						type: "string",
						description: "按任务定位成员"
					},
					memberName: {
						type: "string",
						description: "按成员名定位（优先于 taskId）"
					},
					text: { type: "string" }
				},
				required: ["text"]
			},
			async handler(args, meta) {
				const sessionId = sessionOf(meta);
				if (!deps.bridge.enabled(sessionId)) return {
					ok: false,
					error: NOT_ENABLED
				};
				const text = typeof args.text === "string" ? args.text : "";
				if (text.trim() === "") return {
					ok: false,
					error: "text 不能为空"
				};
				const taskId = typeof args.taskId === "string" && args.taskId.trim() !== "" ? args.taskId.trim() : void 0;
				const memberName = typeof args.memberName === "string" ? args.memberName.trim() : "";
				const snapshot = deps.bridge.snapshot(sessionId);
				const byName = memberName === "" ? void 0 : snapshot.members.find((member) => member.name === memberName);
				if (memberName !== "" && !byName) return {
					ok: false,
					error: `找不到成员 ${memberName}：可用成员 ${snapshot.members.map((m) => m.name).join("、") || "（无）"}`
				};
				const memberId = byName?.memberId;
				const result = await deps.bridge.act(sessionId, {
					type: "message",
					memberId,
					taskId,
					text
				});
				const rejected = rejectedOf(result);
				if (rejected) return rejected;
				return {
					ok: true,
					notices: result.notices
				};
			}
		},
		{
			name: `${TOOL_PREFIX}receipt`,
			description: "提交任务回执：跑该任务的验收命令（门禁），通过则任务完成、失败则转返工并把证据回发给同一成员。",
			parameters: {
				type: "object",
				properties: {
					taskId: {
						type: "string",
						description: "任务 id"
					},
					note: {
						type: "string",
						description: "成员自述（写入证据说明）"
					}
				},
				required: ["taskId"]
			},
			async handler(args, meta) {
				const sessionId = sessionOf(meta);
				if (!deps.bridge.enabled(sessionId)) return {
					ok: false,
					error: NOT_ENABLED
				};
				const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
				if (taskId === "") return {
					ok: false,
					error: "taskId 不能为空"
				};
				const note = typeof args.note === "string" && args.note.trim() !== "" ? args.note : void 0;
				const result = await deps.bridge.act(sessionId, {
					type: "receipt",
					taskId,
					note
				});
				const rejected = rejectedOf(result);
				if (rejected) return rejected;
				const task = result.snapshot.tasks.find((item) => item.id === taskId);
				return {
					ok: true,
					taskId,
					status: task?.status,
					evidence: task?.evidence ? {
						command: task.evidence.command,
						exitCode: task.evidence.exitCode,
						tail: task.evidence.tail,
						artifacts: task.evidence.artifacts
					} : void 0,
					notices: result.notices
				};
			}
		},
		{
			name: `${TOOL_PREFIX}memory`,
			description: "读写团队记忆（双轨 md）：track=public 为跨项目公共记忆，track=project 为当前项目记忆。写入自动限制行数并落来源标注。action=expand 按内联索引里的 ID（mem://<track>/<stem>）取回原文——上下文里只内联了 ID+标题+首句，要读完整内容必须显式展开，不要凭标题猜正文。",
			parameters: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: [
							"list",
							"read",
							"write",
							"expand"
						]
					},
					track: {
						type: "string",
						enum: ["public", "project"]
					},
					name: {
						type: "string",
						description: "文件名（单段，自动补 .md）"
					},
					body: { type: "string" },
					id: {
						type: "string",
						description: "action=expand 的记忆 ID（mem://<track>/<stem>，来自内联索引）"
					},
					depth: {
						type: "number",
						description: "action=expand 顺着关联 ID 继续展开的跳数（1~2，缺省 1）"
					}
				},
				required: ["action"]
			},
			async handler(args, meta) {
				const sessionId = sessionOf(meta);
				if (!deps.bridge.enabled(sessionId)) return {
					ok: false,
					error: NOT_ENABLED
				};
				const track = args.track === "public" ? "public" : "project";
				const name = typeof args.name === "string" ? args.name.trim() : "";
				if (args.action === "list") {
					const snapshot = deps.bridge.snapshot(sessionId);
					return {
						ok: true,
						budget: snapshot.memory.budget,
						injectedChars: snapshot.memory.injectedChars,
						truncated: snapshot.memory.truncated,
						files: snapshot.memory.files,
						inline: snapshot.memory.inline ?? [],
						omitted: snapshot.memory.omitted ?? []
					};
				}
				if (args.action === "expand") {
					const id = typeof args.id === "string" ? args.id.trim() : "";
					if (id === "") return {
						ok: false,
						code: "EXPAND_BAD_ID",
						error: "expand 需要 id（形如 mem://project/<文件名>）"
					};
					const depth = typeof args.depth === "number" ? args.depth : void 0;
					const expanded = deps.bridge.expandMemory(id, depth);
					if (expanded.error !== void 0) return {
						ok: false,
						error: expanded.error
					};
					const payload = expanded.data;
					return {
						ok: payload.code === "OK",
						code: payload.code,
						message: payload.message,
						id: payload.id,
						track: payload.track,
						name: payload.name,
						body: payload.body,
						chars: payload.chars,
						truncated: payload.truncated,
						depth: payload.depth,
						related: payload.related
					};
				}
				if (name === "") return {
					ok: false,
					error: "name 不能为空"
				};
				if (args.action === "read") {
					const read = await deps.bridge.readMemoryFile(track, name);
					if (read.error !== void 0) return {
						ok: false,
						error: read.error
					};
					return {
						ok: true,
						...read.data
					};
				}
				const body = typeof args.body === "string" ? args.body : "";
				if (body.trim() === "") return {
					ok: false,
					error: "body 不能为空"
				};
				const lines = body.split("\n");
				const clipped = lines.slice(0, 20).join("\n");
				const result = await deps.bridge.act(sessionId, {
					type: "saveMemory",
					track,
					name,
					body: clipped
				});
				const rejected = rejectedOf(result);
				if (rejected) return rejected;
				return {
					ok: true,
					track,
					name,
					lines: Math.min(lines.length, 20),
					truncated: lines.length > 20,
					notices: result.notices
				};
			}
		},
		{
			name: `${TOOL_PREFIX}role`,
			description: "查看或修改角色（含为角色指定 provider/model）。内置角色可改不可删。",
			parameters: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: [
							"list",
							"save",
							"remove"
						]
					},
					role: {
						type: "object",
						description: "角色对象（save 时必填）",
						properties: {
							id: { type: "string" },
							name: { type: "string" },
							duty: { type: "string" },
							skillIds: {
								type: "array",
								items: { type: "string" }
							},
							model: {
								type: "object",
								properties: {
									provider: { type: "string" },
									model: { type: "string" },
									reasoningEffort: {
										type: "string",
										enum: [
											"low",
											"medium",
											"high"
										]
									}
								}
							}
						},
						required: ["id", "name"]
					},
					roleId: { type: "string" }
				},
				required: ["action"]
			},
			async handler(args, meta) {
				const sessionId = sessionOf(meta);
				if (!deps.bridge.enabled(sessionId)) return {
					ok: false,
					error: NOT_ENABLED
				};
				if (args.action === "list") return {
					ok: true,
					roles: deps.roles.list().map((role) => ({
						id: role.id,
						name: role.name,
						duty: role.duty,
						skillIds: role.skillIds,
						model: role.model,
						builtin: role.builtin,
						modelNote: role.model ? void 0 : "未指定模型：按会话默认模型派发"
					}))
				};
				if (args.action === "remove") {
					const roleId = typeof args.roleId === "string" ? args.roleId.trim() : "";
					if (roleId === "") return {
						ok: false,
						error: "roleId 不能为空"
					};
					const result = await deps.bridge.act(sessionId, {
						type: "deleteRole",
						roleId
					});
					const rejected = rejectedOf(result);
					if (rejected) return rejected;
					return {
						ok: true,
						roleId,
						notices: result.notices
					};
				}
				const role = args.role;
				if (!role) return {
					ok: false,
					error: "save 需要 role 对象"
				};
				const result = await deps.bridge.act(sessionId, {
					type: "saveRole",
					role
				});
				const rejected = rejectedOf(result);
				if (rejected) return rejected;
				return {
					ok: true,
					role: deps.roles.get(role.id),
					notices: result.notices
				};
			}
		}
	];
}
/** 注册全部工具（宿主缺 tools 服务时由 adapters 静默跳过）。 */
function registerTools(ctx, deps) {
	for (const spec of buildToolSpecs(deps)) registerTool(ctx, spec);
}
// src/host/prompt.ts
/** 三条硬约束（AC-1 的可 grep 特征句）：独立成段放在「工作方式」之前。 */
const CAPTAIN_CONSTRAINTS = [
	"- 你**不亲自干细活**：读文件、改代码、跑测试、修 bug 一律派给成员。",
	"- 你**只做三件事**：拆解目标、分派任务、验收结果。",
	"- **不要同步等长任务**：任何可能超过 5 秒的命令都必须后台执行（命令末尾加 `&`）或派给成员；前台 `sleep` 会被 noWait 守卫直接拒绝并返回错误码。"
];
function captainSection(deps, sessionId) {
	const snapshot = deps.bridge.snapshot(sessionId);
	const lines = [
		"## 自动团队（队长视角）",
		`当前会话的自动团队开关：${snapshot.enabled ? "已启用" : "未启用"}${snapshot.enabled ? "" : "——未启用时不得创建成员，先用一句话说明如何启用"}。`,
		"",
		"队长定位（硬约束，任何情况下都不得违反）：",
		...CAPTAIN_CONSTRAINTS,
		"",
		"工作方式（顺序不可颠倒）：",
		"1. **先 plan，再 dispatch**：把目标拆成有依赖的任务图用 `auto_team_plan`（每个任务必须指定 roleId 与可执行的 acceptance），**计划条目先落地**，用户确认（或明确说「开干」）后才用 `auto_team_dispatch` 派发。",
		"2. `auto_team_dispatch` **必须带 plan 返回的 runId**：它同时用于确认「你派的是刚给用户看的那份计划」。缺少 runId 会被直接拒绝——这是「计划早于第一个成员」的机械保证（AC-30），不要试图绕过。",
		"3. 派发前提醒用户：计划可在面板「计划」页改角色、取消；取消后成员数为 0。派发后同一时刻在跑的任务数受 maxConcurrent 限制（默认 3），超出的会排队等前置任务过门禁。",
		"4. 成员是**可续聊**的独立 Agent：用 `auto_team_message` 直达消息，中断后用同一 memberId 继续（面板「继续」或 `resume`），不要重新创建同名成员。",
		"5. **完成必须过门禁**：任务从 running 到 done 唯一入口是 `auto_team_receipt`（host 会执行该任务的 acceptance 并记录命令、退出码、输出尾部）。成员口头说「做完了」、你读代码觉得「应该没问题」都不算完成；门禁失败的任务转 rework，其下游保持 blocked，你必须把失败证据发回原成员再改。",
		"6. 团队记忆分公共与项目两轨，都是 md：相关约定优先 `auto_team_memory` 读取，沉淀时才写入。",
		"7. 面板（输入框内「自动团队」选项 + 右栏面板）是用户的可视入口与唯一状态来源；你的结论要与面板显示一致。"
	];
	const notes = [captainModelLineOf(snapshot.captainModel), memoryLineOf(snapshot.memory)].filter((line) => line !== "");
	if (notes.length > 0) lines.push("", ...notes);
	return lines.join("\n");
}
/**
* 队长模型一行（AC-2）：`host-default` 不写（未配置时不改变任何行为，也不占上下文）；
* `configured` 写逐字路由；`unsupported` 明说「未生效」——绝不把保留的配置说成已生效。
*/
function captainModelLineOf(view) {
	if (!view || view.source === "host-default") return "";
	if (view.source === "configured") return `队长模型：${view.value ?? ""}`.trim();
	return "队长模型：宿主暂不支持单独指定（配置已保留，未生效）";
}
/**
* 记忆一行（AC-8）：`truncated` 的语义已改成「有未内联条目」，于是文案不再使用旧的
* 旧标注，而是告诉模型「另外还有几条、怎么按 ID 取回」——超预算的那部分从「丢掉」变成「可按需展开」。
*/
function memoryLineOf(memory) {
	if (!memory) return "";
	const omitted = memory.omitted?.length ?? 0;
	const usage = `已内联 ${memory.injectedChars}/${memory.budget} 字符`;
	if (omitted > 0) return `团队记忆另有 ${omitted} 条未内联（${usage}）：按 \`mem://\` ID 用 \`auto_team_memory\`（action=expand）展开全文。`;
	if (memory.truncated) return `团队记忆超出注入预算（${usage}）：按 \`mem://\` ID 用 \`auto_team_memory\`（action=expand）展开全文。`;
	return "";
}
function registerCaptainPrompt(ctx, deps, sessionId) {
	registerPromptSection(ctx, {
		name: "auto-team",
		order: 900,
		content: () => captainSection(deps, sessionId)
	});
}
// src/host/http.ts
function buildHttpRoutes(deps) {
	return [
		{
			method: "GET",
			path: `${BRIDGE_ROUTE}/snapshot`,
			async handle(request) {
				const sessionId = parseQuery(request.url).get("sessionId") ?? deps.defaultSessionId();
				return { data: deps.bridge.snapshot(sessionId) };
			}
		},
		{
			method: "GET",
			path: `${BRIDGE_ROUTE}/memory`,
			async handle(request) {
				const query = parseQuery(request.url);
				const track = query.get("track") === "public" ? "public" : query.get("track") === "project" ? "project" : null;
				if (track === null) return { error: "track 必须是 public 或 project" };
				const name = query.get("name") ?? "";
				if (name.trim() === "") return { error: "非法文件名" };
				return deps.bridge.readMemoryFile(track, name);
			}
		},
		{
			method: "POST",
			path: `${BRIDGE_ROUTE}/act`,
			async handle(request) {
				let payload;
				try {
					payload = await request.json();
				} catch {
					return { error: "请求体不是合法 JSON" };
				}
				const body = payload;
				const sessionId = body?.sessionId ?? deps.defaultSessionId();
				if (!body?.action || typeof body.action.type !== "string") return { error: "缺少 action" };
				return { data: await deps.bridge.act(sessionId, body.action) };
			}
		}
	];
}
function parseQuery(url) {
	const out = /* @__PURE__ */ new Map();
	if (!url) return out;
	const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
	for (const pair of query.split("&")) {
		if (pair === "") continue;
		const index = pair.indexOf("=");
		const key = index < 0 ? pair : pair.slice(0, index);
		const value = index < 0 ? "" : pair.slice(index + 1);
		if (key !== "" && value !== "") out.set(key, decodeURIComponent(value));
	}
	return out;
}
function registerHttpBridge(ctx, deps) {
	const register = registerHttpRoutes;
	try {
		register(ctx, buildHttpRoutes(deps), BRIDGE_ROUTE);
		return true;
	} catch {
		return false;
	}
}
/** peer 交接消息的 id 前缀：`handoff:<上游>-><下游>`（AC-5 的幂等键）。 */
const HANDOFF_PREFIX = "handoff:";
/** 没有落盘产物时的显式文案（AC-2 ⑤：不许静默省略这一段）。 */
const NO_ARTIFACTS = "无落盘产物";
/**
* 幂等键：`handoff:<上游 taskId>-><下游 taskId>`。
*
* 为什么不用 `makeMessage()`：`src/host/team/messages.ts:31` 的 `makeMessage` **无条件**写
* `messageId: 'msg-<at>-<seq>'`，会盖掉这里预置的幂等键；而 `appendMessage` 是「已有 id 则沿用」。
* 于是「用 makeMessage 造 peer 消息」的症状是：单跑绿，重复 `applyReceipt` 才多出一条（最难 debug 的一类）。
* 所以 `handoffMessages()` 直接构造 `MessageRecord`，不经 makeMessage。
*/
function handoffId(upstreamTaskId, downstreamTaskId) {
	return `${HANDOFF_PREFIX}${upstreamTaskId}->${downstreamTaskId}`;
}
/**
* 上游交付正文（AC-2 的五要素，逐字骨架见 TECHNICAL §4.3）：
* 上游 `id`+`title` / 命令 / 退出码 / ≤800 字证据尾部 / 产物落盘路径（空则「无落盘产物」）。
*
* 正文里**不许出现 captain**：这段文字是「成员→成员」的直投，写「队长已转达」就等于
* 自己承认信息还是过了一遍队长（AC-2 反面目标 3）。
*/
function handoffBody(upstream, evidence) {
	const tail = evidence.tail ?? "";
	const truncated = tail.length > 800;
	const shown = truncated ? tail.slice(-800) : tail;
	return [
		`【上游直投】${upstream.id} ${upstream.title} 已通过门禁`,
		`命令：${evidence.command}`,
		`退出码：${evidence.exitCode ?? "null"}`,
		`证据尾部（≤800 字）：`,
		truncated ? `（前文已截断，仅保留末 800 字）` : "",
		shown === "" ? "（无输出）" : shown,
		`产物：${evidence.artifacts.length === 0 ? NO_ARTIFACTS : evidence.artifacts.join("\n")}`
	].filter((line) => line !== "").join("\n");
}
/**
* 生成 peer 交接消息（AC-1/AC-2/AC-5）：**纯函数、只算不落账**，落账由调用方 `appendMessage`。
*
* 触发口径（AC-1，四种输入各跑一次都必须精确）：
*   - `upstreamVerdict !== 'done'` → 0 条（rework / failed 都不投）；
*   - `evidence` 缺失 → 0 条（没跑过门禁就没有「已通过」可言）；
*   - `evidence.exitCode !== 0` → 0 条（`null` = 超时/被信号杀，**也不是** 0）。
*
* 幂等（AC-5）：`existingIds` 里已有的 `handoff:<a>-><b>` 不再产出；同一批 `downstream`
* 里重复传入同一个 B 也只产出 1 条。
*/
function handoffMessages(input) {
	const { upstream, evidence, upstreamVerdict, downstream, at, targetOf } = input;
	if (upstreamVerdict !== "done") return [];
	if (!evidence) return [];
	if (evidence.exitCode !== 0) return [];
	const body = handoffBody(upstream, evidence);
	const taken = new Set(input.existingIds);
	const out = [];
	for (const target of downstream) {
		const messageId = handoffId(upstream.id, target.id);
		if (taken.has(messageId)) continue;
		taken.add(messageId);
		const dest = targetOf(target.id);
		const record = {
			at,
			from: "peer",
			to: dest.to,
			taskId: target.id,
			body,
			messageId
		};
		if (dest.toMemberId !== void 0) record.toMemberId = dest.toMemberId;
		out.push(record);
	}
	return out;
}
/**
* 某个下游任务的**全部**上游交接正文（AC-4(b)：注入成员首条提示词）。
*
* 过滤口径 = `messageId` 前缀 + `taskId`；按 `at` 正序（多个上游时按完成先后读，依赖链才讲得通）。
* 只挑「注入用文本」，不做任何再拼装 —— 与账本里的 body 逐字相同。
*/
function handoffBodiesFor(messages, downstreamTaskId) {
	return messages.filter((message) => typeof message.messageId === "string" && message.messageId.startsWith(HANDOFF_PREFIX) && message.taskId === downstreamTaskId).slice().sort((a, b) => a.at - b.at).map((message) => message.body);
}
// src/host/team/messages.ts
/** 消息 id 的自增段：同一毫秒内的多条消息也能各自身份唯一。 */
let messageSeq = 0;
/** 构造一条消息记录（**不落账**；落账用 appendMessage）。 */
function makeMessage(input) {
	const at = input.at ?? Date.now();
	messageSeq += 1;
	const record = {
		at,
		from: input.from,
		to: input.to,
		body: input.body,
		messageId: `msg-${at}-${messageSeq}`
	};
	if (input.toMemberId !== void 0) record.toMemberId = input.toMemberId;
	if (input.taskId !== void 0) record.taskId = input.taskId;
	return record;
}
/** 追加一条消息到账本，超过 MESSAGES_LIMIT 丢最旧（与 store 落盘约束同源）。 */
function appendMessage(state, message) {
	const record = message.messageId === void 0 ? {
		...message,
		messageId: nextMessageId(state, message.at)
	} : message;
	const messages = [...state.messages, record];
	return {
		...state,
		messages: messages.slice(Math.max(0, messages.length - 200))
	};
}
/** 账本内唯一 id：`msg-<at>-<序号>`，与已有记录冲突时递增序号（不覆盖别人的审计记录）。 */
function nextMessageId(state, at) {
	const taken = new Set(state.messages.map((message) => message.messageId));
	let seq = state.messages.length + 1;
	let candidate = `msg-${at}-${seq}`;
	while (taken.has(candidate)) {
		seq += 1;
		candidate = `msg-${at}-${seq}`;
	}
	return candidate;
}
// src/host/team/route.ts
/** 派发前批量预校验：只有声明了模型的角色需要校验。 */
async function preflightRoutes(roles, port) {
	const ok = [];
	const failed = [];
	for (const role of roles) {
		const declared = role.model;
		if (!declared) {
			ok.push(role.id);
			continue;
		}
		let resolved = null;
		let error = "";
		try {
			resolved = await port.resolveRoute(declared);
		} catch (thrown) {
			resolved = null;
			error = thrown instanceof Error ? thrown.message : String(thrown);
		}
		if (resolved === null) {
			const label = describeRoute(role);
			failed.push({
				roleId: role.id,
				route: declared,
				label,
				error: error === "" ? `模型路由无法解析：${label}` : `模型路由无法解析：${label}（${error}）`
			});
			continue;
		}
		ok.push(role.id);
	}
	return {
		ok,
		failed
	};
}
/** 两条路由是否不等（null = 跟随会话默认；声明与实际的差异即漂移）。 */
function routeDrift(declared, actual) {
	return routeKey(declared) !== routeKey(actual);
}
/**
* 记录一次路由审计（AC-22 的证据）。
*
* - `actual === null`（宿主没给出实际路由）→ `unverified`，**不写成 ok**；
* - 声明 ≠ 实际 → `drift`，任务当场置 `failed`：派出去的人跑的不是用户配的模型，
*   继续跑只会产出「看起来完成了、其实用错模型」的假结果；
* - 一致 → `ok`。
*
* 同一 taskId 只保留一条最新审计（任务是审计的主体，不是每次事件各一条）；
* 任务状态与审计同时变化，面板读到的两者永远对应。
*/
function auditRoute(state, taskId, declared, actual, now) {
	const at = now ?? Date.now();
	const task = state.plan.tasks.find((item) => item.id === taskId);
	if (!task) return state;
	const verdict = actual === null ? "unverified" : routeDrift(declared, actual) ? "drift" : "ok";
	const audit = {
		taskId,
		roleId: task.roleId,
		declared,
		actual,
		at,
		verdict
	};
	const routeAudits = [...state.routeAudits.filter((item) => item.taskId !== taskId), audit];
	let next = {
		...state,
		routeAudits
	};
	if (verdict === "drift") {
		next = {
			...next,
			plan: {
				...next.plan,
				tasks: next.plan.tasks.map((item) => item.id === taskId ? {
					...item,
					status: "failed"
				} : item)
			}
		};
		next = appendMessage(next, makeMessage({
			from: "captain",
			to: "user",
			taskId,
			at,
			body: `路由漂移：任务「${task.title}」声明 ${describeRouteOf(declared)}，实际 ${describeRouteOf(actual)}。已停止该任务并标记失败，请核对角色模型（不会静默回退到队长模型）。`
		}));
	}
	return next;
}
/** 审计里的路由文本（不依赖 Role 对象，因为 declared/actual 是裸路由）。 */
function describeRouteOf(route) {
	if (!route) return "会话默认";
	const effort = route.reasoningEffort ? ` #${route.reasoningEffort}` : "";
	return `${route.provider}/${route.model}${effort}`;
}
function routeKey(route) {
	if (!route) return "session-default";
	return `${route.provider}/${route.model}${route.reasoningEffort ? `#${route.reasoningEffort}` : ""}`;
}
// src/host/team/dispatch.ts
/** 可读段每段字符上限（只服务可读性，身份由哈希承担）。 */
const READABLE_MAX = 20;
/** 身份短哈希位数（base36 末 6 位）。 */
const HASH_LEN = 6;
/**
* 可读段总预算 = 48(上限) - 6(哈希) - 1(连接符) = 41。
*
* 截断**只裁可读段，永不裁哈希** —— 否则两个 40 字长的 id 截断后会重新撞成同名（缺陷复发）。
* 上限引用 `HOST_MEMBER_NAME_MAX` 字面量，不在本文件重写 48（config.ts 的注释要求同源）。
*/
const NAME_BUDGET = 41;
/**
* 归一化：**只用于可读段**，不承担身份编码。
*
* 宿主 `memberName()` 的硬契约是 lower-kebab（`HOST_MEMBER_NAME`，见 config.ts），而
* `roleId` / `taskId` 是模型自填的（`Login_Flow`、`t 1`、`重构-登录` 都可能出现），
* 所以可读段必须折叠成 `[a-z0-9-]`：大写折小写、非字符连续段折单个 `-`、去掉首尾 `-`。
*/
function slugify(raw) {
	return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, READABLE_MAX).replace(/-+$/g, "");
}
/**
* 身份短哈希：FNV-1a 32 位 → base36 末 `len` 位。
*
* 输入是**原始**（未归一、未截断）字符串，因此两个只差大小写/分隔符、或只差末尾若干字符的
* id 也必然得到不同哈希 —— 这是「两个中文 id 归一后同为空」不再塌缩的全部原因。
* 纯 `charCodeAt` + `Math.imul` 算术：无 locale、无 `Intl`、无 `crypto`、无随机/时间输入，
* 跨进程跨平台确定（AC-3）。
*/
function shortIdentityHash(raw, len = HASH_LEN) {
	let h = 2166136261;
	for (let i = 0; i < raw.length; i += 1) {
		h ^= raw.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h.toString(36).padStart(len, "0").slice(-len);
}
/**
* 成员名 = `<可读 role>-<可读 task>-<身份短哈希>`（可读段为空时用 `member` 兜底）。
*
* 确定性是 AC-17 的地基——同一 `(roleId, taskId)` 无论第几次派发、在哪个进程里都得到同一个名字，
* 宿主重启后能靠它把任务重新绑回成员；签名与原实现一致，调用方零改动。
*
* 为什么**先编码身份段再归一化**（而不是旧实现的「整体归一化」）：`dev/登录流程` 与
* `dev/注册接口` 归一后都是 `dev`，第二个就绪任务被宿主当成重名拒绝、永久 pending。
* 身份段取原始串哈希，与可读段是否被截断无关，故名字两两不等（AC-1/AC-2）。
*
* 代价（如实记录）：纯中文 id 的可读段必然为空，名字形如 `dev-4k2m9a`，肉眼认不出是哪个任务；
* 可读性由面板/消息里始终携带的 `taskId` + 标题承担，不靠名字自解释。
*/
function memberNameFor(task) {
	const hash = shortIdentityHash(`${task.roleId}\u0000${task.id}`);
	const head = [slugify(task.roleId), slugify(task.id)].filter((part) => part !== "").join("-");
	const base = head === "" ? "member" : head;
	const trimmed = base.length > NAME_BUDGET ? base.slice(0, NAME_BUDGET).replace(/-+$/g, "") : base;
	return `${trimmed === "" ? "member" : trimmed}-${hash}`;
}
/**
* 给 base 追加消歧序号，**只压可读段、逐字保留身份哈希**（AC-2）。
*
* 为什么不能简单 `base.slice(0, 48 - tail.length) + tail`：那会把 6 位身份哈希截掉一半，
* 两个长 id 消歧后重新撞成同名 —— 正是 R2-1 缺陷的复发路径。哈希是唯一身份，永远不动。
*/
/** 身份哈希段的样子（`-<HASH_LEN 位 36 进制>`）：长度只在 `HASH_LEN` 一处定义，不许两处各自演化。 */
const HASH_TAIL = new RegExp(`-([a-z0-9]{${HASH_LEN}})$`);
function withNameSuffix(base, suffix) {
	if (!Number.isInteger(suffix) || suffix <= 0) return base;
	const tail = `-${suffix}`;
	if (base.length + tail.length <= 48) return `${base}${tail}`;
	const match = HASH_TAIL.exec(base);
	if (!match) return `${base.slice(0, 48 - tail.length).replace(/-+$/g, "")}${tail}`;
	const hash = match[1];
	const readable = base.slice(0, base.length - hash.length - 1);
	const budget = 48 - hash.length - 1 - tail.length;
	if (budget <= 0) return `${hash}${tail}`;
	const trimmed = readable.slice(0, budget).replace(/-+$/g, "");
	return `${trimmed === "" ? "member".slice(0, budget) : trimmed}-${hash}${tail}`;
}
/**
* 一次性算完全计划任务的名字分配（AC-1/AC-3/AC-4）。
*
* **纯函数**：不读状态、不看 `ready` 顺序、无时间无随机 —— 输入集合相同则输出相同。
* 这是「循环前一次算完」这条性质的落地形式：边派边算会让名字可用性取决于任务顺序，
* 恢复后顺序一变，重绑就会翻倍（R2-1 已确立的反面教材）。
*
* 候选可用 ⇔ 未被占用 **且** 不是别的任务的本名（AC-4 不抢名）：
* 只挑「第一个空号」的实现会把 `dev-2` 抢走，让本名就是 `dev-2` 的任务无处可去。
*/
function allocateMemberNames(tasks, options = {}) {
	const nameOf = options.nameOf ?? memberNameFor;
	const maxSuffix = options.maxSuffix ?? 99;
	const order = [];
	const baseOf = /* @__PURE__ */ new Map();
	for (const task of tasks) {
		if (baseOf.has(task.id)) continue;
		baseOf.set(task.id, nameOf(task));
		order.push(task.id);
	}
	const bindingOfTask = /* @__PURE__ */ new Map();
	const taken = /* @__PURE__ */ new Set();
	for (const item of options.reserved ?? []) {
		bindingOfTask.set(item.taskId, item.name);
		taken.add(item.name);
	}
	for (const name of options.hostNames ?? []) taken.add(name);
	const byBase = /* @__PURE__ */ new Map();
	for (const taskId of order) {
		const base = baseOf.get(taskId);
		const owners = byBase.get(base);
		if (owners) owners.push(taskId);
		else byBase.set(base, [taskId]);
	}
	const result = /* @__PURE__ */ new Map();
	for (const taskId of order) {
		const base = baseOf.get(taskId);
		const reuse = bindingOfTask.get(taskId);
		if (reuse !== void 0) {
			result.set(taskId, {
				taskId,
				base,
				final: reuse,
				suffix: 0,
				reused: true
			});
			continue;
		}
		const usable = (candidate) => {
			if (taken.has(candidate)) return false;
			if (candidate === base) return true;
			const owners = byBase.get(candidate);
			return !owners || owners.every((owner) => owner === taskId);
		};
		let final = usable(base) ? base : null;
		let suffix = 0;
		if (final === null) for (let n = 2; n <= maxSuffix; n += 1) {
			const candidate = withNameSuffix(base, n);
			if (!usable(candidate)) continue;
			final = candidate;
			suffix = n;
			break;
		}
		if (final === null) {
			result.set(taskId, {
				taskId,
				base,
				final: base,
				suffix: null,
				reused: false
			});
			continue;
		}
		taken.add(final);
		result.set(taskId, {
			taskId,
			base,
			final,
			suffix,
			reused: false
		});
	}
	return result;
}
/** 在飞任务数：running + gate（gate 期间成员仍占着一个并发位）。 */
function runningCount(tasks) {
	return tasks.filter((task) => task.status === "running" || task.status === "gate").length;
}
/** 派发：把 ready 的任务按空闲并发位创建成员。 */
async function dispatchReady(state, deps) {
	const now = deps.now ?? Date.now;
	const started = [];
	const skipped = [];
	const errors = [];
	const renamed = [];
	let next = state;
	let changed = false;
	const planStatus = next.plan.status;
	if (planStatus !== "draft" && planStatus !== "dispatching") {
		for (const task of next.plan.tasks) if (task.status === "pending" || task.status === "ready") skipped.push({
			taskId: task.id,
			reason: "NO_PLAN"
		});
		return {
			state: next,
			started,
			skipped,
			errors,
			renamed
		};
	}
	let members = null;
	try {
		members = await deps.listMembers();
	} catch {
		members = null;
	}
	const hostLimit = deps.hostConcurrency ? deps.hostConcurrency().limit : 3;
	const planned = next.plan.maxConcurrent > 0 ? next.plan.maxConcurrent : 3;
	let slots = Math.max(1, Math.min(planned, hostLimit, 8)) - runningCount(next.plan.tasks);
	const depsDone = (task) => task.dependsOn.every((dep) => next.plan.tasks.find((item) => item.id === dep)?.status === "done");
	const recoverable = next.plan.tasks.filter((task) => task.status === "interrupted" && depsDone(task)).map((task) => task.id);
	const ready = [.../* @__PURE__ */ new Set([...readyTasks(next.plan.tasks), ...recoverable])];
	if (ready.length === 0) {
		if (changed) deps.store.save(next);
		return {
			state: next,
			started,
			skipped,
			errors,
			renamed
		};
	}
	if (slots <= 0) {
		for (const taskId of ready) skipped.push({
			taskId,
			reason: "CONCURRENCY_FULL"
		});
		return {
			state: next,
			started,
			skipped,
			errors,
			renamed
		};
	}
	const nameOf = deps.memberNameFor ?? memberNameFor;
	const reserved = next.bindings.filter((binding) => binding.retired !== true).map((binding) => ({
		taskId: binding.taskId,
		name: binding.name
	}));
	const hostNames = members === null ? [] : members.map((member) => member.name);
	const names = allocateMemberNames(next.plan.tasks, {
		nameOf,
		reserved,
		hostNames
	});
	for (const taskId of ready) {
		const task = next.plan.tasks.find((item) => item.id === taskId);
		if (!task) continue;
		if (task.dependsOn.filter((dep) => {
			const upstream = next.plan.tasks.find((item) => item.id === dep);
			return !upstream || upstream.status !== "done";
		}).length > 0) {
			next = patchTask(next, taskId, { status: "blocked" });
			changed = true;
			continue;
		}
		if (slots <= 0) {
			skipped.push({
				taskId,
				reason: "CONCURRENCY_FULL"
			});
			continue;
		}
		const role = deps.roles.get(task.roleId);
		if (!role) {
			skipped.push({
				taskId,
				reason: "ROLE_UNAVAILABLE"
			});
			continue;
		}
		const binding = liveBinding(next, taskId);
		if (binding) {
			if (members === null || members.some((member) => member.id === binding.memberId || member.name === binding.name)) {
				const at = now();
				const text = resumeText(task);
				if (deps.sendMessage) try {
					await deps.sendMessage(binding.memberId, text);
				} catch {}
				next = appendMessage(next, makeMessage({
					from: "captain",
					to: binding.name,
					toMemberId: binding.memberId,
					taskId,
					at,
					body: text
				}));
				next = patchTask(next, taskId, {
					status: task.status === "gate" ? "gate" : "running",
					memberId: binding.memberId,
					lastResumeAt: at,
					lastResumeStatus: task.status
				});
				changed = true;
				skipped.push({
					taskId,
					reason: "ALREADY_RUNNING"
				});
				continue;
			}
			next = {
				...next,
				bindings: next.bindings.map((item) => item.taskId === taskId && !item.retired ? {
					...item,
					retired: true
				} : item)
			};
			changed = true;
		}
		if (role.model && deps.routePort) {
			if ((await preflightRoutes([role], deps.routePort)).failed.length > 0) {
				skipped.push({
					taskId,
					reason: "MODEL_UNRESOLVABLE"
				});
				continue;
			}
		}
		const assignment = names.get(taskId);
		if (!assignment || assignment.suffix === null) {
			errors.push({
				taskId,
				code: "MEMBER_NAME_COLLISION",
				error: `成员名冲突：${assignment?.base ?? nameOf(task)} 的序号候选（-2…-99）全部被占用；本次不派发（请修改任务 id 或角色）`
			});
			continue;
		}
		const name = assignment.final;
		const reusedName = next.bindings.some((item) => item.taskId === taskId && item.name === name);
		let prompt = "";
		try {
			prompt = deps.buildPrompt({
				plan: next.plan,
				task,
				role,
				name,
				handoffs: handoffBodiesFor(next.messages, taskId)
			});
		} catch (error) {
			errors.push({
				taskId,
				error: `生成提示词失败：${messageOf$2(error)}`
			});
			continue;
		}
		try {
			const spawned = await deps.spawn({
				plan: next.plan,
				task,
				role,
				name,
				prompt
			});
			if (!spawned.ok) {
				errors.push({
					taskId,
					error: spawned.error
				});
				continue;
			}
			const at = now();
			next = {
				...next,
				bindings: [...next.bindings, {
					taskId,
					roleId: task.roleId,
					memberId: spawned.memberId,
					name,
					spawnedAt: at
				}]
			};
			next = patchTask(next, taskId, {
				status: "running",
				memberId: spawned.memberId,
				attempts: task.attempts ?? 0
			});
			if (role.model) next = auditRoute(next, taskId, role.model, spawned.actual ?? null, at);
			next = appendMessage(next, makeMessage({
				from: "captain",
				to: name,
				toMemberId: spawned.memberId,
				taskId,
				at,
				body: `任务「${task.title}」已派发给你（角色 ${role.name}）。验收判定：${task.acceptance === "" ? "（未声明，需人工确认）" : task.acceptance}`
			}));
			started.push(taskId);
			if (assignment.suffix > 0 && !reusedName) renamed.push({
				taskId,
				base: assignment.base,
				final: name
			});
			changed = true;
			slots -= 1;
		} catch (error) {
			errors.push({
				taskId,
				error: messageOf$2(error)
			});
		}
	}
	if (changed) deps.store.save(next);
	return {
		state: next,
		started,
		skipped,
		errors,
		renamed
	};
}
/**
* 幂等恢复（AC-17）：只认「成员还在不在」，不猜、不自动建人。
*
* 判据：`lastResumeAt + RESUME_DEBOUNCE_MS` 内的第二次调用必须 `resumed=0 && unchanged=true`，
* 且**不新增 binding**（成员数两次相等）——这样面板「续跑」按钮连点也不会造出一堆重复成员。
*/
async function resumeRun(state, deps) {
	const now = deps.now ?? Date.now;
	let next = state;
	let resumed = 0;
	let skipped = 0;
	let changedCount = 0;
	const candidates = next.plan.tasks.filter((task) => task.status === "running" || task.status === "gate" || task.status === "interrupted");
	if (candidates.length === 0) return {
		state: next,
		resumed,
		skipped,
		unchanged: true
	};
	let members = null;
	try {
		members = await deps.listMembers();
	} catch {
		return {
			state: next,
			resumed,
			skipped: candidates.length,
			unchanged: true
		};
	}
	for (const task of candidates) {
		const binding = liveBinding(next, task.id);
		if (!binding) {
			if (task.status !== "interrupted") {
				next = patchTask(next, task.id, { status: "interrupted" });
				changedCount += 1;
			} else skipped += 1;
			continue;
		}
		if (!members.find((member) => member.id === binding.memberId || member.name === binding.name)) {
			if (task.status !== "interrupted") {
				next = patchTask(next, task.id, { status: "interrupted" });
				next = {
					...next,
					bindings: next.bindings.map((item) => item.taskId === task.id && !item.retired ? {
						...item,
						retired: true
					} : item)
				};
				changedCount += 1;
			} else skipped += 1;
			continue;
		}
		const at = now();
		if (task.lastResumeStatus === task.status && at - (task.lastResumeAt ?? 0) < 3e3) {
			skipped += 1;
			continue;
		}
		const text = resumeText(task);
		if (deps.sendMessage) try {
			await deps.sendMessage(binding.memberId, text);
		} catch {}
		next = patchTask(next, task.id, {
			lastResumeAt: at,
			lastResumeStatus: task.status,
			memberId: binding.memberId
		});
		next = appendMessage(next, makeMessage({
			from: "captain",
			to: binding.name,
			toMemberId: binding.memberId,
			taskId: task.id,
			at,
			body: text
		}));
		resumed += 1;
		changedCount += 1;
	}
	if (changedCount > 0) deps.store.save(next);
	return {
		state: next,
		resumed,
		skipped,
		unchanged: resumed === 0 && changedCount === 0
	};
}
/** 回执应用：`done` 是任务完成的**唯一**写点（AC-19 的机械保证）。 */
function applyReceipt(state, taskId, receipt, now, maxAttempts) {
	const limit = maxAttempts ?? 3;
	const at = now ?? Date.now();
	const task = state.plan.tasks.find((item) => item.id === taskId);
	if (!task) return state;
	const attempts = task.attempts ?? 0;
	const evidence = receipt.evidence ?? task.evidence;
	let next = state;
	let body = "";
	if (receipt.verdict === "done") {
		next = patchTask(next, taskId, {
			status: "done",
			evidence
		});
		body = gateSummary(task, evidence, "门禁通过");
	} else if (receipt.verdict === "failed") {
		next = patchTask(next, taskId, {
			status: "failed",
			attempts: attempts + 1,
			evidence
		});
		body = gateSummary(task, evidence, "已被判定失败");
	} else {
		const nextAttempts = attempts + 1;
		const giveUp = nextAttempts >= limit;
		next = patchTask(next, taskId, {
			status: giveUp ? "failed" : "rework",
			attempts: nextAttempts,
			evidence
		});
		body = giveUp ? `返工已达上限（${nextAttempts}/${limit} 次）：任务「${task.title}」已转人工，下游保持阻塞。${receipt.note ?? ""}`.trim() : `返工第 ${nextAttempts}/${limit} 次：任务「${task.title}」未通过门禁，请按证据修改后再次回报。${receipt.note ?? ""}`.trim();
	}
	next = appendMessage(next, makeMessage({
		from: "member",
		to: "captain",
		toMemberId: task.memberId,
		taskId,
		at,
		body: evidence ? `${body}｜证据：exit=${evidence.exitCode ?? "null"} ${evidence.tail}` : body
	}));
	if (receipt.verdict === "done") next = {
		...next,
		plan: {
			...next.plan,
			tasks: next.plan.tasks.map((item) => {
				if (item.status !== "blocked") return item;
				return item.dependsOn.every((dep) => next.plan.tasks.find((candidate) => candidate.id === dep)?.status === "done") ? {
					...item,
					status: "pending"
				} : item;
			})
		}
	};
	if (receipt.verdict === "done" && evidence && evidence.exitCode === 0) {
		const upstreamTask = next.plan.tasks.find((item) => item.id === taskId) ?? task;
		const existingIds = next.messages.flatMap((message) => message.messageId === void 0 ? [] : [message.messageId]);
		const downstream = next.plan.tasks.filter((item) => item.dependsOn.includes(taskId));
		for (const message of handoffMessages({
			upstream: upstreamTask,
			evidence,
			upstreamVerdict: receipt.verdict,
			downstream,
			at,
			existingIds,
			targetOf: (downstreamTaskId) => {
				const binding = liveBinding(next, downstreamTaskId);
				if (binding) return {
					to: binding.name,
					toMemberId: binding.memberId
				};
				return { to: `task:${downstreamTaskId}` };
			}
		})) next = appendMessage(next, message);
	}
	if (next.plan.tasks.every((item) => item.status === "done" || item.status === "failed") && next.plan.tasks.length > 0) next = {
		...next,
		plan: {
			...next.plan,
			status: "terminated"
		}
	};
	return next;
}
/** 续跑文案：明确「从哪继续」，避免成员当作新任务重头做一遍。 */
function resumeText(task) {
	return `继续执行任务「${task.title}」（${task.id}）：沿用你已有的上下文，补齐未完成部分；完成后按验收判定回报回执。`;
}
function gateSummary(task, evidence, prefix) {
	const exit = evidence ? `退出码 ${evidence.exitCode ?? "null（超时/被杀）"}` : "无门禁证据";
	return `${prefix}：任务「${task.title}」（${exit}）`;
}
function liveBinding(state, taskId) {
	return state.bindings.find((item) => item.taskId === taskId && !item.retired);
}
function patchTask(state, taskId, patch) {
	return {
		...state,
		plan: {
			...state.plan,
			tasks: state.plan.tasks.map((task) => task.id === taskId ? {
				...task,
				...patch
			} : task)
		}
	};
}
function messageOf$2(error) {
	return error instanceof Error ? error.message : String(error);
}
// src/host/team/watcher.ts
/**
* 把宿主成员名单对账到任务状态：
*  - 成员缺席 / inactive / failed → 任务 `interrupted`（attempts 用尽则 `failed`）；
*  - 成员重新出现（running / provisioning）→ 中断态任务恢复 `running`；
*  - 拿不到成员行（status 未知）→ **不动**：未知不等于死亡，误杀比漏报更伤。
*
* 只处理 running / gate / interrupted 三类任务：done / failed 是终态，rework 由回执链路负责。
*/
function reconcileMembers(state, members, now, maxAttempts) {
	const limit = maxAttempts ?? 3;
	const at = now ?? Date.now();
	let next = state;
	let changed = 0;
	for (const task of next.plan.tasks) {
		if (task.status !== "running" && task.status !== "gate" && task.status !== "interrupted") continue;
		const binding = next.bindings.find((item) => item.taskId === task.id && !item.retired);
		const member = binding ? members.find((row) => row.id === binding.memberId || row.name === binding.name) : void 0;
		if (!member) {
			if (task.status === "interrupted") continue;
			const exhausted = (task.attempts ?? 0) >= limit;
			next = patch(next, task.id, { status: exhausted ? "failed" : "interrupted" });
			next = appendMessage(next, makeMessage({
				from: "captain",
				to: "user",
				taskId: task.id,
				at,
				body: exhausted ? `成员「${binding?.name ?? task.roleId}」已失联且重试次数用尽（${task.attempts ?? 0}/${limit}）：任务「${task.title}」转人工。` : `成员「${binding?.name ?? task.roleId}」已失联：任务「${task.title}」标记为中断，可在面板点「恢复」重试。`
			}));
			changed += 1;
			continue;
		}
		const status = normalizeHostStatus(member.status);
		if (status === "dead") {
			if (task.status === "interrupted") continue;
			const exhausted = (task.attempts ?? 0) >= limit;
			next = patch(next, task.id, { status: exhausted ? "failed" : "interrupted" });
			next = appendMessage(next, makeMessage({
				from: "captain",
				to: "user",
				taskId: task.id,
				at,
				body: exhausted ? `成员「${member.name}」已退出（宿主状态 ${member.status}）且重试次数用尽：任务「${task.title}」转人工。` : `成员「${member.name}」已退出（宿主状态 ${member.status}）：任务「${task.title}」标记为中断。`
			}));
			changed += 1;
			continue;
		}
		if (status === "alive" && task.status === "interrupted") {
			next = patch(next, task.id, { status: "running" });
			changed += 1;
			continue;
		}
	}
	return {
		state: next,
		changed
	};
}
/**
* 停滞告警的**唯一判定出口**（AC-8）。
*
* 事件订阅（`adapters.onMemberProgress`）只负责 `touchProgress` 推进 `at`，从不产生告警；
* 告警只在 watcher 的 tick 里、对着落盘状态算一次。这样「事件一条 + 轮询一条」的重复
* 告警在结构上不可能发生 —— 不是靠纪律，是因为只有这一个地方会 push。
*
* 幂等：`progress[memberId].alertedAt` 存在即表示本 episode 已告警过；成员恢复产出后
* `clearAlerted` 清掉标记，下一轮卡住才允许再响一次。
*
* @returns `state` 换了新引用即表示有变更（调用方据此决定是否 save）；未停滞时**不碰** plan，
*          所以 `plan.tasks` 与入参深相等（AC-13）。
*/
function stallAlertsOf(state, now, stallMs) {
	const raised = [];
	let progress = state.progress ?? {};
	let mutated = false;
	for (const task of state.plan.tasks) {
		if (task.status !== "running") continue;
		const binding = state.bindings.find((item) => !item.retired && item.taskId === task.id);
		if (!binding) continue;
		const memberId = binding.memberId;
		const record = progress[memberId];
		const judge = stallOf(record?.at, binding.spawnedAt, now, stallMs);
		if (!judge.stalled) {
			if (record?.alertedAt !== void 0) {
				progress = clearAlerted(progress, memberId);
				mutated = true;
			}
			continue;
		}
		if (record?.alertedAt !== void 0) continue;
		const at = record?.at ?? binding.spawnedAt;
		progress = {
			...progress,
			[memberId]: {
				at,
				alertedAt: now
			}
		};
		mutated = true;
		raised.push({
			at: now,
			kind: "tool",
			memberId,
			taskId: task.id,
			text: stallSentence(binding.name, judge.stalledForMs)
		});
	}
	if (raised.length === 0) return {
		state: mutated ? {
			...state,
			progress
		} : state,
		raised
	};
	const stallAlerts = [...state.stallAlerts ?? [], ...raised];
	return {
		state: {
			...state,
			progress,
			stallAlerts: stallAlerts.length > 50 ? stallAlerts.slice(-50) : stallAlerts
		},
		raised
	};
}
/** 轮询器：一个 run 一次 listMembers（不是一任务一次），只在存在非终态任务时才查。 */
function createMemberWatcher(deps) {
	const now = deps.now ?? Date.now;
	const intervalMs = deps.intervalMs ?? 1500;
	const stallMs = deps.stallMs ?? 9e4;
	const maxAttempts = deps.maxAttempts ?? 3;
	let timer = null;
	let busy = false;
	async function tick() {
		if (busy) return 0;
		busy = true;
		try {
			const runs = deps.store.list();
			let members = null;
			let changed = 0;
			for (const summary of runs) {
				const state = deps.store.load(summary.runId);
				if (!state) continue;
				const paused = state.plan.status === "paused";
				if (!state.plan.tasks.some((task) => task.status === "running" || task.status === "gate" || task.status === "interrupted" || task.status === "paused")) continue;
				if (members === null) try {
					members = await deps.listMembers();
				} catch {
					return changed;
				}
				const at = now();
				const reconciled = reconcileMembers(state, members, at, maxAttempts);
				const judged = paused ? {
					state: reconciled.state,
					raised: []
				} : stallAlertsOf(reconciled.state, at, stallMs);
				if (reconciled.changed > 0 || judged.state !== reconciled.state) {
					deps.store.save(judged.state);
					deps.onReconciled?.(judged.state);
					changed += reconciled.changed + judged.raised.length;
				}
				if (!paused && deps.onPoll !== void 0) try {
					await deps.onPoll(judged.state);
				} catch {}
			}
			return changed;
		} finally {
			busy = false;
		}
	}
	return {
		tick,
		start() {
			if (timer !== null) return;
			timer = setInterval(() => {
				tick().catch(() => {});
			}, intervalMs);
			if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
		},
		stop() {
			if (timer === null) return;
			clearInterval(timer);
			timer = null;
		}
	};
}
/** 宿主 4 态 → 本项目需要的三分法：alive / dead / unknown。 */
function normalizeHostStatus(status) {
	const value = (status ?? "").trim().toLowerCase();
	if (value === "running" || value === "provisioning" || value === "busy" || value === "active") return "alive";
	if (value === "inactive" || value === "failed" || value === "stopped" || value === "terminated") return "dead";
	return "unknown";
}
function patch(state, taskId, changes) {
	return {
		...state,
		plan: {
			...state.plan,
			tasks: state.plan.tasks.map((task) => task.id === taskId ? {
				...task,
				...changes
			} : task)
		}
	};
}
// src/host/team/member-prompt.ts
/** 把角色 / 任务 / 团队记忆 / 技能正文拼成成员 spawn prompt。 */
function buildMemberPrompt(input, deps) {
	const role = input.role;
	const skills = role ? composeSkillPrompt(role) : {
		text: "",
		missing: []
	};
	const memory = deps.memoryFor(input.task.title);
	const handoffs = input.handoffs ?? [];
	const rolePrompt = role?.prompt?.trim() ?? "";
	return [
		`# 角色：${role?.name ?? input.task.roleId}`,
		role?.duty ? `职责：${role.duty}` : "",
		`模型路由：${describeRoute(role)}`,
		"",
		...rolePrompt === "" ? [] : [
			"## 角色要求",
			rolePrompt,
			""
		],
		"## 技能",
		skills.text === "" ? "（无）" : skills.text,
		skills.missing.length > 0 ? `\n（缺失技能定义：${skills.missing.join("、")}）` : "",
		"",
		`## 本次任务（${input.task.id}）`,
		input.task.title,
		input.task.dependsOn.length > 0 ? `前置任务（已完成）：${input.task.dependsOn.join("、")}` : "",
		"",
		...handoffs.length > 0 ? [
			"## 上游交接",
			"以下内容由上游任务的门禁证据直接投递，不需要再问队长：",
			...handoffs,
			""
		] : [],
		"## 验收判定（必须实际执行并回报退出码）",
		input.task.acceptance === "" ? "（未声明；视为需要人工确认，不得自称完成）" : `\`${input.task.acceptance}\``,
		"",
		"## 团队记忆（截断策略：总预算固定，超出部分不进上下文）",
		memory.text === "" ? "（暂无相关记忆）" : memory.text,
		memory.truncated ? "\n（注意：记忆已截断，完整内容请用 auto_team_memory 读取）" : ""
	].filter((line) => line !== "").join("\n");
}
// src/host/team/guard.ts
/**
* noWait 守卫（**纯逻辑**：无 IO、无宿主 API、无定时器、不读任务/运行状态）。
*
* 为什么单独成模块：守卫要在 `tools/execute`（waterfall）里对队长的每一次 `bash` 做判定，
* 而判定本身必须能被 `node --test` 直接跑 —— 这是 AC-6「短路成恒放行后 AC-4 必然变红」
* 能成立的前提（判定与宿主绑定分开，绑定失败不会让判定本身失去覆盖）。
*
* 判据是**段首命令语义 + 时长**，不是字符串包含 `sleep`。理由写在 PRD anti-goal 1：
* 守卫把队长自己的工作挡死，比不守卫更糟。所以 `echo sleep`、`grep -r sleep src/`、
* `(sleep 30) &`、`git status` 一律放行，只有「段首就是 sleep/wait/tail -f 且前台同步」才拒。
*
* 依赖限制：只 import `../config.ts`（纯常量，自身只 import `shared/const.ts`），不 import
* 任何带宿主形状或 IO 的模块。阈值以**参数**形式收进来（与 `stall.ts` 的 `stallMs` 同一纪律：
* 单一定义在 config、可注入不同值做边界单测），缺省即 `NOWAIT_THRESHOLD_MS`。
*
* 失败方向：一律 fail-open —— 解析不出来、参数形状不认识、嵌套太深，全部放行。
* 守卫的失败模式只能是「少拦一次」，不能是「拦住正常工作」。
*/
/** 递归解析 `bash -c '<payload>'` 的层数上限（防 `bash -c "bash -c 'sleep 30'"` 无限套娃）。 */
const MAX_NEST_DEPTH = 2;
/** 文案里回显命令的长度上限：拒绝信息要可读，但不能把整条长命令塞进模型上下文。 */
const ECHO_MAX = 160;
/** 秒/毫秒换算表（`sleep 2m30s` 这类复合时长用）。 */
const UNIT_MS = {
	"": 1e3,
	ms: 1,
	s: 1e3,
	m: 6e4,
	h: 36e5,
	d: 864e5
};
/** 剥离前缀时忽略的「包装命令」：它们不改变段首语义，只挡在前面。 */
const PREFIX_WORDS = /* @__PURE__ */ new Set([
	"sudo",
	"time",
	"nohup",
	"command",
	"exec",
	"builtin",
	"env",
	"do",
	"then",
	"else"
]);
/** 这些包装命令的部分选项要吃一个值（`sudo -u root sleep 30`），剥离时要连着值一起丢。 */
const PREFIX_FLAGS_WITH_VALUE = /* @__PURE__ */ new Set([
	"-u",
	"-g",
	"-p",
	"-C",
	"-U",
	"-r",
	"-t",
	"-D",
	"--user",
	"--group",
	"--chdir",
	"--prompt"
]);
/** 段首是这些命令就是「无界输出」：要么永远不退出，要么持续刷屏。 */
const UNBOUNDED_ALWAYS = /* @__PURE__ */ new Set([
	"watch",
	"yes",
	"top"
]);
/** 交互式分页器/编辑器：进前台就是等人工操作，编排会卡死。 */
const PAGERS_AND_EDITORS = /* @__PURE__ */ new Set([
	"less",
	"more",
	"vi",
	"vim",
	"nano"
]);
/** shell 家族：`-c` 后面的 payload 要递归解析。 */
const SHELL_NAMES = /* @__PURE__ */ new Set([
	"bash",
	"sh",
	"zsh",
	"dash",
	"ksh",
	"fish"
]);
/** `ssh` 的这些选项吃一个值（判断「有没有远程命令」时要跳过）。 */
const SSH_FLAGS_WITH_VALUE = /* @__PURE__ */ new Set([
	"-p",
	"-i",
	"-o",
	"-l",
	"-L",
	"-R",
	"-D",
	"-F",
	"-J",
	"-b",
	"-c",
	"-e",
	"-m",
	"-O",
	"-Q",
	"-S",
	"-W",
	"-w",
	"-E"
]);
/**
* 把一条 shell 命令按**未转义**的 `;` / `&&` / `||` / `|` / 换行切成段。
*
* 后台判定有两条来源，缺一不可：
* ① 段尾单个 `&`（不是 `&&`）—— `sleep 30 &`；
* ② 段被 `( … ) &` 包裹 —— 切段时 `&` 已经消费掉了，所以由「`&` 标记前一段为后台」覆盖。
*
* 引号内的分隔符不算分隔符（`echo "a;b"` 是一段）；`2>&1` / `&>` 这类重定向里的 `&`
* 也不是后台标记 —— 这是最容易误杀正常命令的一处，单独判。
*/
function segmentsOf(command) {
	const out = [];
	let buffer = "";
	let quote = null;
	const push = (text, background) => {
		const trimmed = text.trim();
		if (trimmed.length === 0) return;
		out.push({
			text: trimmed,
			background
		});
	};
	for (let i = 0; i < command.length; i += 1) {
		const char = command.charAt(i);
		if (quote !== null) {
			buffer += char;
			if (char === "\\" && quote === "\"") {
				buffer += command.charAt(i + 1);
				i += 1;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}
		if (char === "\\") {
			buffer += char + command.charAt(i + 1);
			i += 1;
			continue;
		}
		if (char === "\"" || char === "'") {
			quote = char;
			buffer += char;
			continue;
		}
		if (char === "\n" || char === ";") {
			push(buffer, false);
			buffer = "";
			continue;
		}
		if (char === "&") {
			const prev = command.charAt(i - 1);
			const next = command.charAt(i + 1);
			if (prev === ">" || prev === "<" || next === ">") {
				buffer += char;
				continue;
			}
			if (next === "&") {
				push(buffer, false);
				buffer = "";
				i += 1;
				continue;
			}
			push(buffer, true);
			buffer = "";
			continue;
		}
		if (char === "|") {
			if (command.charAt(i + 1) === "|") {
				push(buffer, false);
				buffer = "";
				i += 1;
				continue;
			}
			push(buffer, false);
			buffer = "";
			continue;
		}
		buffer += char;
	}
	push(buffer, false);
	return out;
}
/**
* 守卫主判定。只看 `toolName === 'bash'` 且 `role === 'captain'`，其余一律放行。
*
* @param thresholdMs 前台同步等待阈值（毫秒）。缺省取 `config.NOWAIT_THRESHOLD_MS`；
*                    单测可注入更小的值验边界，不必改常量。
*/
function guardOf(request, thresholdMs = NOWAIT_THRESHOLD_MS) {
	if (request.role !== "captain") return { allow: true };
	if (request.toolName !== "bash") return { allow: true };
	const command = commandOf(request.args);
	if (command === null) return { allow: true };
	const threshold = Number.isFinite(thresholdMs) && thresholdMs > 0 ? thresholdMs : NOWAIT_THRESHOLD_MS;
	for (const segment of segmentsOf(command)) {
		if (segment.background) continue;
		const hit = inspectTokens(tokensOf(segment.text), 0, threshold);
		if (hit !== null) return {
			allow: false,
			code: hit.code,
			message: messageOf$1(hit.code, hit.command),
			command: hit.command
		};
	}
	return { allow: true };
}
/** 从工具参数里取命令字符串；形状不认识（缺字段/非字符串）→ `null`（放行）。 */
function commandOf(args) {
	if (args === null || typeof args !== "object") return null;
	const command = args.command;
	return typeof command === "string" ? command : null;
}
/** 逐段判定：命中即返回，未命中返回 `null`。 */
function inspectTokens(tokens, depth, thresholdMs) {
	const words = stripPrefixes(tokens);
	if (words.length === 0) return null;
	const name = baseNameOf(words[0] ?? "");
	const rest = words.slice(1);
	const text = words.join(" ");
	if (SHELL_NAMES.has(name)) {
		const payload = shellPayloadOf(rest);
		if (payload !== null && depth < MAX_NEST_DEPTH) for (const segment of segmentsOf(payload)) {
			if (segment.background) continue;
			const hit = inspectTokens(tokensOf(segment.text), depth + 1, thresholdMs);
			if (hit !== null) return hit;
		}
		return null;
	}
	if (name === "sleep") {
		const durationMs = durationMsOf(rest);
		if (durationMs !== null && durationMs >= thresholdMs) return {
			code: "NOWAIT_FOREGROUND_WAIT",
			command: text
		};
		return null;
	}
	if (UNBOUNDED_ALWAYS.has(name)) return {
		code: "NOWAIT_UNBOUNDED_OUTPUT",
		command: text
	};
	if (PAGERS_AND_EDITORS.has(name)) return {
		code: "NOWAIT_UNBOUNDED_OUTPUT",
		command: text
	};
	if (name === "tail" && followsTail(rest)) return {
		code: "NOWAIT_UNBOUNDED_OUTPUT",
		command: text
	};
	if (name === "ssh" && isInteractiveSsh(rest)) return {
		code: "NOWAIT_UNBOUNDED_OUTPUT",
		command: text
	};
	if (name === "wait" && rest.every((token) => token.startsWith("-"))) return {
		code: "NOWAIT_BLOCKING_TTY",
		command: text
	};
	if (name === "read" && !hasReadTimeout(rest)) return {
		code: "NOWAIT_BLOCKING_TTY",
		command: text
	};
	return null;
}
/** 剥掉前导 `(`/`{`/`!`、环境变量赋值、包装命令（含它们吃值的选项）。 */
function stripPrefixes(tokens) {
	const words = tokens.map((token, index) => {
		let text = token;
		if (index === 0) text = text.replace(/^[({!]+/, "");
		if (index === tokens.length - 1) text = text.replace(/[)}]+$/, "");
		return text;
	});
	let index = 0;
	for (;;) {
		const token = words[index];
		if (token === void 0) break;
		if (token.length === 0) {
			index += 1;
			continue;
		}
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
			index += 1;
			continue;
		}
		const name = baseNameOf(token);
		if (PREFIX_WORDS.has(name)) {
			index += 1;
			while (words[index] !== void 0 && (words[index] ?? "").startsWith("-")) {
				const flag = words[index] ?? "";
				index += 1;
				if (PREFIX_FLAGS_WITH_VALUE.has(flag)) index += 1;
			}
			continue;
		}
		break;
	}
	return words.slice(index).filter((token) => token.length > 0);
}
/** 词法切分（处理引号与反斜杠），得到「参数级」token。 */
function tokensOf(text) {
	const out = [];
	let current = "";
	let started = false;
	let quote = null;
	for (let i = 0; i < text.length; i += 1) {
		const char = text.charAt(i);
		if (quote !== null) {
			if (char === "\\" && quote === "\"") {
				current += text.charAt(i + 1);
				i += 1;
				started = true;
				continue;
			}
			if (char === quote) {
				quote = null;
				continue;
			}
			current += char;
			started = true;
			continue;
		}
		if (char === "'" || char === "\"") {
			quote = char;
			started = true;
			continue;
		}
		if (char === "\\") {
			current += text.charAt(i + 1);
			i += 1;
			started = true;
			continue;
		}
		if (char === " " || char === "	" || char === "\n" || char === "\r") {
			if (started) {
				out.push(current);
				current = "";
				started = false;
			}
			continue;
		}
		current += char;
		started = true;
	}
	if (started) out.push(current);
	return out;
}
/** 取命令名的 basename（`/bin/sleep` → `sleep`），并小写化。 */
function baseNameOf(token) {
	const trimmed = token.trim();
	if (trimmed.length === 0) return "";
	const slash = trimmed.lastIndexOf("/");
	return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).toLowerCase();
}
/** 从 `sleep` 的参数里算总时长；多个参数按 GNU sleep 语义累加。 */
function durationMsOf(args) {
	let total = 0;
	let parsed = false;
	for (const arg of args) {
		if (arg === "infinity" || arg === "inf") return Number.POSITIVE_INFINITY;
		const part = durationOf(arg);
		if (part === null) continue;
		total += part;
		parsed = true;
	}
	return parsed ? total : null;
}
/** 单个时长 token（`30` / `1.5` / `2m30s` / `100ms`）→ 毫秒；不可解析 → `null`。 */
function durationOf(token) {
	if (token.length === 0) return null;
	const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d)?/gi;
	let total = 0;
	let consumed = 0;
	let matched = false;
	for (;;) {
		const match = pattern.exec(token);
		if (match === null) break;
		const amount = Number(match[1]);
		const unit = (match[2] ?? "").toLowerCase();
		const factor = UNIT_MS[unit];
		if (!Number.isFinite(amount) || factor === void 0) return null;
		total += amount * factor;
		consumed += match[0].length;
		matched = true;
	}
	if (!matched || consumed !== token.length) return null;
	return total;
}
/** `bash -c '<payload>'` / `bash -lc '<payload>'` 里取 payload；没有 `-c` → `null`。 */
function shellPayloadOf(rest) {
	for (let i = 0; i < rest.length; i += 1) {
		const token = rest[i] ?? "";
		if (token === "-c" || token === "--command") return rest[i + 1] ?? null;
		if (token.startsWith("-") && !token.startsWith("--")) {
			const at = token.indexOf("c");
			if (at > 0) {
				const inline = token.slice(at + 1);
				if (inline.length > 0) return inline;
				return rest[i + 1] ?? null;
			}
		}
	}
	return null;
}
/** `tail -f` / `tail -F` / `tail -n5 -f` / `tail --follow=name`。 */
function followsTail(rest) {
	return rest.some((token) => {
		if (token.startsWith("--")) return token.startsWith("--follow");
		if (!token.startsWith("-")) return false;
		return /[fF]/.test(token.slice(1));
	});
}
/**
* 交互式 ssh：没有 `-T`（禁用伪终端）**且**没有远程命令 —— 也就是直接开一个登录 shell。
* 带远程命令的 `ssh host 'ls'` 是有界的，不能拦（AC-5「不误杀」）。
*/
function isInteractiveSsh(rest) {
	if (rest.some((token) => token === "-T" || token.startsWith("-T"))) return false;
	let hostSeen = false;
	for (let i = 0; i < rest.length; i += 1) {
		const token = rest[i] ?? "";
		if (token.startsWith("-")) {
			if (SSH_FLAGS_WITH_VALUE.has(token)) i += 1;
			continue;
		}
		if (!hostSeen) {
			hostSeen = true;
			continue;
		}
		return false;
	}
	return true;
}
/** `read -t 5 var` 有超时就不算阻塞（`-n` 只是长度，不算超时）。 */
function hasReadTimeout(rest) {
	return rest.some((token) => /^-[A-Za-z]*t/.test(token) || token === "--timeout");
}
/** 拒绝文案：原因码 + 命中命令 + 一句「下一步怎么做」（AC-4 要求可读、可执行）。 */
function messageOf$1(code, command) {
	const echoed = command.length > ECHO_MAX ? `${command.slice(0, ECHO_MAX)}…` : command;
	if (code === "NOWAIT_FOREGROUND_WAIT") return `前台同步等待被拒绝（NOWAIT_FOREGROUND_WAIT）：\`${echoed}\` 会阻塞整个编排。下一步：改成后台执行（命令末尾加 &），或用 auto_team_message 把这个等待派给成员。`;
	if (code === "NOWAIT_UNBOUNDED_OUTPUT") return `无界输出/交互式命令被拒绝（NOWAIT_UNBOUNDED_OUTPUT）：\`${echoed}\` 会占住前台并持续输出或等待人工操作。下一步：加超时与输出上限（如 \`timeout 5 … | head -50\`），或后台执行后再读日志。`;
	return `同步阻塞等待被拒绝（NOWAIT_BLOCKING_TTY）：\`${echoed}\` 没有超时，会一直等下去。下一步：加超时（\`read -t 5\` / 指定 pid 的 \`wait\`），或改成后台执行。`;
}
// src/host/team/trigger.ts
/** `gate_failed`：门禁失败（退出码非 0，或超时/被信号杀掉）。 */
function triggerFromGate(runId, task, at) {
	const evidence = task.evidence;
	return {
		kind: "gate_failed",
		source: "event",
		runId,
		at,
		taskId: task.id,
		...evidence ? { exitCode: evidence.exitCode } : {}
	};
}
/** `member_exit`：成员退出且工作没做完（`done` 不算退出，走 receipt 路径）。 */
function triggerFromMemberExit(runId, memberId, why, at) {
	return {
		kind: "member_exit",
		source: "event",
		runId,
		at,
		memberId,
		why
	};
}
/** `dep_ready`：前置任务过门禁后，下游任务由 blocked 转 ready。 */
function triggerFromDepReady(runId, task, at, via) {
	return {
		kind: "dep_ready",
		source: "poll",
		runId,
		at,
		taskId: task.id,
		...via ? { via } : {}
	};
}
/** `stall_timeout`：成员在 `STALL_MS` 内没有产出（时间型信号，只有 poll 通路）。 */
function triggerFromStall(runId, memberId, at) {
	return {
		kind: "stall_timeout",
		source: "poll",
		runId,
		at,
		memberId
	};
}
/** 去重键：`<kind>:<runId>:<entityId>`（entityId = taskId ?? memberId）。 */
function dedupeKeyOf(kind, runId, entityId) {
	return `${kind}:${runId}:${entityId}`;
}
/** 取一条 Trigger 的去重实体 id（任务型优先任务 id，成员型用成员 id）。 */
function entityIdOf(trigger) {
	return trigger.taskId ?? trigger.memberId ?? trigger.runId;
}
/** 取一条 Trigger 的去重键（`dedupeKeyOf` 的唯一推荐入口，避免两处各拼一份）。 */
function dedupeKeyFor(trigger) {
	return dedupeKeyOf(trigger.kind, trigger.runId, entityIdOf(trigger));
}
/**
* 各 kind 认可的任务状态（AC-14 判据④「任务状态」）。
*
* 判据刻意写成白名单而不是「排除法」：新增状态时默认**不推进**（fail-closed），
* 而不是默认放行 —— 自动推进做错一次（对着 `done` 的任务再派一次）比少推进一次贵得多。
*
* - `gate_failed` 只对 `rework` 成立：失败证据已落盘、等成员返工；
* - `dep_ready` 只对还没开跑的状态成立：`done` 又收到依赖完成不该再派；
* - `member_exit` 对「已经起过人、还没收尾」的状态成立（`done` 的成员不需要续聊）；
* - `stall_timeout` 只对「成员本应在产出」的状态成立。
*/
const KIND_STATES = {
	gate_failed: ["rework"],
	dep_ready: [
		"pending",
		"blocked",
		"ready"
	],
	member_exit: [
		"running",
		"gate",
		"rework",
		"failed",
		"interrupted"
	],
	stall_timeout: ["running", "gate"]
};
/** 成员型 kind：`memberId` 必须能在 bindings 里定位到人（判据④「成员存在性」）。 */
const MEMBER_KINDS = ["member_exit", "stall_timeout"];
const REASON_TEXT = {
	ok: "已推进",
	not_enabled: "会话开关已关闭",
	not_listened: "不在监听的 Trigger 种类内",
	unknown_entity: "任务/成员不属于当前这次运行",
	task_state: "任务当前状态不接受这类推进",
	gate_exit_zero: "门禁退出码不是失败（0 或证据缺失）",
	duplicate: "同一事件在去重窗口内已推进过"
};
/** Fast 层判定（固定顺序，命中即返回；见 TECHNICAL §7.2 的判据表）。 */
function fastOf(trigger, ctx) {
	const drop = (reason) => ({
		accepted: false,
		reason,
		action: null
	});
	if (!ctx.enabled) return drop("not_enabled");
	if (!TRIGGER_KINDS.includes(trigger.kind)) return drop("not_listened");
	if (trigger.runId !== ctx.run.runId) return drop("unknown_entity");
	const task = trigger.taskId ? ctx.run.tasks.find((it) => it.id === trigger.taskId) ?? null : null;
	if (trigger.taskId && !task) return drop("unknown_entity");
	const isMemberKind = MEMBER_KINDS.includes(trigger.kind);
	const binding = trigger.memberId ? ctx.run.bindings.find((it) => it.memberId === trigger.memberId) ?? null : null;
	if (isMemberKind && !binding) return drop("unknown_entity");
	const boundTask = isMemberKind && binding ? ctx.run.tasks.find((it) => it.id === binding.taskId) ?? null : task;
	if (isMemberKind && binding && !boundTask) return drop("unknown_entity");
	if (!isMemberKind && !task) return drop("unknown_entity");
	const states = KIND_STATES[trigger.kind];
	const status = boundTask?.status;
	if (!status || !states.includes(status)) return drop("task_state");
	if (trigger.kind === "gate_failed") {
		const exitCode = trigger.exitCode !== void 0 ? trigger.exitCode : boundTask?.evidence?.exitCode;
		if (exitCode === void 0 || exitCode === 0) return drop("gate_exit_zero");
	}
	const key = dedupeKeyFor(trigger);
	if (ctx.accepted.some((rec) => rec.dedupeKey === key && ctx.now - rec.at < ctx.dedupeMs)) return drop("duplicate");
	return {
		accepted: true,
		reason: "ok",
		action: actionOf(trigger)
	};
}
/** kind → 既有 action（AC-16：推进只有一个出口，这里是唯一映射表）。 */
function actionOf(trigger) {
	switch (trigger.kind) {
		case "dep_ready": return {
			type: "dispatch",
			runId: trigger.runId
		};
		case "gate_failed": return {
			type: "message",
			taskId: trigger.taskId,
			text: gateFailedReminderOf(trigger)
		};
		case "member_exit": return {
			type: "resume",
			memberId: trigger.memberId
		};
		case "stall_timeout": return {
			type: "message",
			memberId: trigger.memberId,
			text: stallReminderOf(trigger)
		};
	}
}
function gateFailedReminderOf(trigger) {
	return `门禁未通过（${trigger.exitCode === null ? "超时/被信号中止" : `退出码 ${trigger.exitCode ?? "未知"}`}）。请按证据修复后重新自述完成：这是自动推进，不需要重述计划。`;
}
function stallReminderOf(trigger) {
	return "检测到一段时间没有产出。请回一句当前进展与下一步；若被阻塞，直接说明卡在哪。";
}
const KIND_PHRASE = {
	gate_failed: "门禁失败",
	member_exit: "成员退出",
	dep_ready: "依赖完成",
	stall_timeout: "超时无产出"
};
/** 实体标签：任务型写任务、成员型写成员（文案里的第二段括号内容）。 */
function entityLabelOf(trigger) {
	if (trigger.taskId) return trigger.via ? `任务 ${trigger.taskId}，前置 ${trigger.via} 已过门禁` : `任务 ${trigger.taskId}`;
	if (trigger.memberId) return trigger.why ? `成员 ${trigger.memberId}，原因 ${trigger.why}` : `成员 ${trigger.memberId}`;
	return `运行 ${trigger.runId}`;
}
/** accepted 时的结果短语（按 kind，动作类型兜底）。 */
function resultTextOf(trigger, action) {
	switch (trigger.kind) {
		case "dep_ready": return "已请求派发就绪任务";
		case "gate_failed": return "已把失败证据发回成员，任务转 rework 等返工";
		case "member_exit": return "已按续聊恢复成员（不重派，避免重复副作用）";
		case "stall_timeout": return "已催一次进展（不改任务状态）";
	}
	return action ? `已执行 ${action}` : "已推进";
}
/**
* 面板可读原因（AC-17）：固定三段式 **因「<中文短语>」（<实体>）推进：<结果>**。
*
* dropped 时同一骨架写成 **未推进：「<短语>」（<实体>）：<为什么>** —— 「为什么没推进」
* 与「为什么推进」必须一样可读，否则面板只能解释成功的那一半。
*/
function triggerSentenceOf(trigger, verdict) {
	const phrase = KIND_PHRASE[trigger.kind] ?? trigger.kind;
	const entity = entityLabelOf(trigger);
	if (!verdict.accepted) return `未推进：「${phrase}」（${entity}）：${REASON_TEXT[verdict.reason] ?? verdict.reason}`;
	return `因「${phrase}」（${entity}）推进：${resultTextOf(trigger, verdict.action)}`;
}
// src/host/team/trigger-bus.ts
/** 事件源不可用时的降级说明（面板 `degraded` 提示直接显示这句）。 */
const EVENT_SOURCE_DOWN = "事件源不可用：推进退回 watcher 轮询兜底（最多慢一个 tick）";
/**
* 「状态事实」型 Trigger：一旦**放行过**就不再轮询重推。
*
* 它们是已落盘的状态（门禁失败证据 / 成员已退出），不是会再发生一次的瞬时事件；
* 而 `dep_ready` / `stall_timeout` 是过程型信号，窗口过期后可以再推一次提醒。
*/
const ONCE_KINDS = ["gate_failed", "member_exit"];
/** 构造 Trigger 总线（纯编排，无宿主依赖：动作只经由 `bridge.act`）。 */
function createTriggerBus(deps) {
	const dedupeMs = deps.dedupeMs ?? 6e4;
	let eventSource = true;
	let failure = null;
	/**
	* 串行化：事件通路与轮询通路会并发进来，而两边都是「读账本 → 判定 → 追加记录」。
	* 不排队就会互相覆盖保存（后写的把先写的记录整段盖掉，表现为「推进了但面板没记录」）。
	*/
	let tail = Promise.resolve();
	function serial(run) {
		const next = tail.then(run, run);
		tail = next.then(() => void 0, () => void 0);
		return next;
	}
	function recordOf(trigger, verdict) {
		return {
			at: deps.now(),
			kind: trigger.kind,
			source: trigger.source,
			runId: trigger.runId,
			...trigger.taskId === void 0 ? {} : { taskId: trigger.taskId },
			...trigger.memberId === void 0 ? {} : { memberId: trigger.memberId },
			dedupeKey: dedupeKeyFor(trigger),
			accepted: verdict.accepted,
			reason: verdict.reason,
			text: triggerSentenceOf(trigger, verdict),
			...verdict.action === void 0 ? {} : { action: verdict.action },
			...verdict.rejected === void 0 ? {} : { rejected: verdict.rejected }
		};
	}
	/** 追加一条推进记录（重新读盘再写：`save` 是整份覆盖，用旧 state 会吃掉动作副作用）。 */
	function append(runId, record) {
		const current = deps.store.load(runId);
		if (current === null) return;
		deps.store.save({
			...current,
			triggers: [...current.triggers ?? [], record]
		});
	}
	function fastContextOf(state, enabled) {
		return {
			enabled,
			run: {
				runId: state.plan.runId,
				plan: state.plan,
				tasks: state.plan.tasks,
				bindings: state.bindings
			},
			accepted: (state.triggers ?? []).filter((record) => record.accepted).map((record) => ({
				dedupeKey: record.dedupeKey,
				at: record.at
			})),
			now: deps.now(),
			dedupeMs
		};
	}
	/** 判定一条 Trigger 并记账；accepted 时经由 `bridge.act`（唯一推进出口）执行既有 action。 */
	async function adjudicate(trigger) {
		const loaded = deps.store.load(trigger.runId);
		if (loaded === null) return recordOf(trigger, {
			accepted: false,
			reason: "unknown_entity"
		});
		const verdict = fastOf(trigger, fastContextOf(loaded, deps.bridge.enabled(loaded.plan.sessionId)));
		if (!verdict.accepted || verdict.action === null) {
			const record = recordOf(trigger, {
				accepted: false,
				reason: verdict.reason
			});
			append(trigger.runId, record);
			return record;
		}
		const result = await deps.bridge.act(loaded.plan.sessionId, verdict.action);
		const record = recordOf(trigger, {
			accepted: true,
			reason: "ok",
			action: verdict.action.type,
			...result.rejected === void 0 ? {} : { rejected: result.rejected.code }
		});
		append(trigger.runId, record);
		return record;
	}
	function recentlyAdjudicated(ledger, trigger) {
		const key = dedupeKeyFor(trigger);
		const same = ledger.filter((record) => record.dedupeKey === key);
		if (same.length === 0) return false;
		if (ONCE_KINDS.includes(trigger.kind) && same.some((record) => record.accepted)) return true;
		const now = deps.now();
		return same.some((record) => now - record.at < dedupeMs);
	}
	/** `dep_ready` 的 `via`：让它就绪的前置任务（取证据时刻最晚的那个，文案里点名）。 */
	function lastDoneDepOf(state, task) {
		let best = null;
		for (const depId of task.dependsOn ?? []) {
			const dep = state.plan.tasks.find((item) => item.id === depId);
			if (dep?.status !== "done") continue;
			const at = dep.evidence?.at ?? 0;
			if (best === null || at >= best.at) best = {
				id: depId,
				at
			};
		}
		return best?.id;
	}
	/**
	* 轮询候选：四类各推导一次。
	*
	* 这里只做「从运行状态里能不能看出这类信号存在」，**放不放行仍由 `fastOf` 决定**
	* （状态白名单、退出码、去重窗口都在那边）—— 避免出现第二套判定口径。
	*/
	function candidatesOf(live) {
		const at = deps.now();
		const runId = live.plan.runId;
		const ledger = deps.store.load(runId)?.triggers ?? live.triggers ?? [];
		const out = [];
		const offer = (trigger) => {
			if (recentlyAdjudicated(ledger, trigger)) return;
			out.push({
				...trigger,
				source: "poll"
			});
		};
		const readyIds = new Set(readyTasks(live.plan.tasks));
		for (const task of live.plan.tasks) {
			if (!readyIds.has(task.id)) continue;
			if ((task.dependsOn ?? []).length === 0) continue;
			if (task.status !== "pending" && task.status !== "ready") continue;
			offer(triggerFromDepReady(runId, task, at, lastDoneDepOf(live, task)));
		}
		for (const task of live.plan.tasks) {
			if (task.status !== "rework") continue;
			const evidence = task.evidence;
			if (evidence === void 0 || evidence.exitCode === 0) continue;
			offer(triggerFromGate(runId, task, at));
		}
		for (const task of live.plan.tasks) {
			const memberId = task.memberId;
			if (memberId === void 0) continue;
			if (task.status !== "interrupted" && task.status !== "failed") continue;
			if (!live.bindings.some((binding) => binding.memberId === memberId)) continue;
			offer(triggerFromMemberExit(runId, memberId, task.status, at));
		}
		for (const alert of live.stallAlerts ?? []) {
			if (alert.kind !== "tool" || alert.memberId === void 0) continue;
			if (at - alert.at >= dedupeMs) continue;
			offer(triggerFromStall(runId, alert.memberId, alert.at));
		}
		return out;
	}
	return {
		push(trigger) {
			return serial(async () => {
				try {
					const record = await adjudicate(trigger);
					failure = null;
					return record;
				} catch (error) {
					failure = `推进通道异常：${error instanceof Error ? error.message : String(error)}`;
					throw error;
				}
			});
		},
		poll(state) {
			return serial(async () => {
				const records = [];
				for (const candidate of candidatesOf(state)) try {
					records.push(await adjudicate(candidate));
					failure = null;
				} catch (error) {
					failure = `轮询推进异常：${error instanceof Error ? error.message : String(error)}`;
				}
				return records;
			});
		},
		health() {
			if (!eventSource) return {
				degraded: true,
				reason: EVENT_SOURCE_DOWN
			};
			if (failure !== null) return {
				degraded: true,
				reason: failure
			};
			return { degraded: false };
		},
		setEventSource(available) {
			eventSource = available;
		}
	};
}
// src/host/team/captain.ts
/**
* 队长模型（AC-2 / AC-3）：配置读取 + 快照三态投影。
*
* **为什么把「配置位」与「能力位」拆成两个参数**：宿主能否给主 session（队长）单独指定模型
* 尚未验证（TECHNICAL §5.2 与 §10 的 U3），而「用户写了什么配置」与「这个配置能不能生效」
* 是两件互相独立的事实。把两者压成一个布尔，不可用时只有两条烂路：要么丢掉回显（用户看不到
* 自己写的配置，下次还要再问一遍），要么假装生效（违反 anti-goal 5：不假称）。所以：
*   - `readCaptainModel()` 只从盘上读数，读不到/残缺一律 `null`，**永不抛异常**（装配层不能因为
*     一个手写的 json 写错就整插件崩掉）；
*   - `captainModelView()` 只做投影：`source` 由 `route × capability` 机械决定，没有第三种推断。
*
* 配置源：`<dataRoot>/captain.json`（`{ provider, model, reasoningEffort? }`）。本期**不提供写入口**
* —— 新增写入口只能走新 `PanelAction` 或新路由，两者都被 AC-16 的「复用既有动作/路由」硬约束排除，
* 因此快照与面板只做**只读回显**，文件由用户手写（README 一行说明）。
*/
/** `reasoningEffort` 的合法集合（与 `RoleModelRoute.reasoningEffort` 的联合类型逐字一致）。 */
const EFFORTS = [
	"low",
	"medium",
	"high"
];
/**
* 读 `<dataRoot>/captain.json`；文件不存在、不可读、不是合法 JSON、或缺 provider/model → `null`。
*
* 「残缺」与「没配」在投影上等价（都是 `host-default`），所以这里不区分错误类型：
* 区分只会让调用方多写一份文案，而用户能做的动作是同一个（去看那个文件）。
*/
function readCaptainModel(dataRoot) {
	const root = (dataRoot ?? "").replace(/\/+$/, "");
	if (root === "") return null;
	let raw;
	try {
		raw = readFileSync(`${root}/captain.json`, "utf8");
	} catch {
		return null;
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	return routeOf(parsed);
}
/** 逐字校验配置对象（provider/model 原样透传，只去首尾空白，不做别名归一）。 */
function routeOf(value) {
	if (typeof value !== "object" || value === null) return null;
	const record = value;
	const provider = typeof record.provider === "string" ? record.provider.trim() : "";
	const model = typeof record.model === "string" ? record.model.trim() : "";
	if (provider === "" || model === "") return null;
	const route = {
		provider,
		model
	};
	const effort = record.reasoningEffort;
	if (typeof effort === "string" && EFFORTS.includes(effort)) route.reasoningEffort = effort;
	return route;
}
/**
* 快照投影（AC-2）：三态一一对应 PRD 的 `configured` / `host-default` / `unsupported`。
*
* `value` 在 `unsupported` 下**仍然回显配置值**（用户写了什么就一定看得见），
* 区别只体现在 `source` 与 `note`：`unsupported` 的 note 明说「未生效」，绝不假称。
*/
function captainModelView(route, capability) {
	if (route === null) return {
		value: null,
		route: null,
		source: "host-default",
		note: "未指定队长模型：队长使用宿主会话默认模型（可在 <dataRoot>/captain.json 写入 provider/model）。"
	};
	const value = describeRouteOf(route);
	if (capability === "ok") return {
		value,
		route,
		source: "configured",
		note: `队长模型已生效：${value}`
	};
	return {
		value,
		route,
		source: "unsupported",
		note: "宿主暂不支持单独指定队长模型：配置已保留，未生效。"
	};
}
// src/host/memory/expand.ts
/**
* 记忆展开（Inline & Spill 的 Spill 半边，AC-9 / AC-10）。
*
* 注入侧（`memory/inject.ts`）只放「指针」——`mem://<track>/<stem>` + 标题 + 首句 + 关联 ID；
* 正文按需从这里取回。所以本模块的两条硬要求：
*  1. **取回的正文与源文件逐字节相同**（AC-9 用 sha256 比对）：不做 trim、不补换行、不改编码；
*  2. **失败一律降级成错误码，绝不抛异常**（AC-10）：展开是模型可见工具的入口，抛异常会变成
*     「工具调用崩了」，而成员任务仍在跑，整个派发链路跟着红。
*
* 安全边界只有一个入口：`parseMemoryId`。ID 的**拼装**只允许 `inject.ts` 的 `memoryIdOf` 一处、
* **解析**只允许这里的 `parseMemoryId` 一处 —— 注入期与展开期各拼一份路径是本项目的历史 bug 族
* （两份实现一漂移，注入里给得出来的 ID 展开就找不到）。解析通过后还要过 `repo.safeMemoryName`
* 第二道门（同一个风险只留一道实现，不在这里另写一套路径守门）。
*
* 本模块零宿主依赖（不 import `ctx.*`、不读环境变量），`roots` 由调用方注入，故可用临时目录单测。
*/
/** ID 前缀：`mem://<track>/<stem>`（TECHNICAL §6.1，不引入 hash，源文件改动不会失联）。 */
const ID_SCHEME = "mem://";
/**
* 记忆名（stem）形态：`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`（**大小写保留**）。
*
* 两处与设计稿的**有意偏差**，都由「注入期与展开期必须同源」这条纪律推出来：
*  1. TECHNICAL §6.1 写的是 `^[p-z0-9]`，但该写法会把设计稿自己举的例子
*     `mem://project/conventions`（首字母 c）与 `mem://project/testing`（首字母 t）判成非法，
*     等于展开能力对最常见的名字全失效 —— 按设计意图实现为 `[A-Za-z0-9]`。
*  2. 设计稿写「小写化后」匹配，但 `inject.ts:189 memoryIdOf` **保留文件名原始大小写**
*     （其注释说明了理由：`safeMemoryName(stem)` 要能逐字还原磁盘文件名）。若这里小写化，
*     `mem://project/Conventions` 在区分大小写的文件系统上就变成「注入期给出、展开期找不到」——
*     正是本项目的历史 bug 族。故此处保留大小写，只做形态校验。
*/
const STEM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** 每个错误码一句可读中文（AC-10「错误码都有可读文案」；面板与工具结果直接显示）。 */
const EXPAND_MESSAGES = {
	OK: "已按 ID 展开团队记忆",
	EXPAND_BAD_ID: "记忆 ID 形态不对：应为 mem://public/<名字> 或 mem://project/<名字>（可用 auto_team_memory 的 list 动作查看可用 ID）",
	EXPAND_PATH_ESCAPE: "拒绝展开：ID 里含路径逃逸字符（../、绝对路径、~、冒号或路径分隔符）",
	EXPAND_NOT_FOUND: "记忆不存在或已改名：先用 auto_team_memory（action=list）确认可用 ID",
	EXPAND_DEPTH_EXCEEDED: `展开超过 2 跳：请直接展开目标 ID，不要顺着关联链继续`
};
/**
* 纯函数：把 `mem://<track>/<stem>` 解析成「轨道 + 安全文件名」。
*
* 优先级刻意是「逃逸 > 形态」：`../etc/passwd` 既是逃逸也是形态错，报 `EXPAND_PATH_ESCAPE`
* 才能让调用方与日志一眼看出这是攻击面而不是手滑。
*/
function parseMemoryId(raw) {
	const text = (raw ?? "").trim();
	if (text === "") return {
		ok: false,
		code: "EXPAND_BAD_ID"
	};
	if (!text.startsWith(ID_SCHEME)) return {
		ok: false,
		code: looksLikePath(text) ? "EXPAND_PATH_ESCAPE" : "EXPAND_BAD_ID"
	};
	const rest = text.slice(6);
	if (looksLikePath(rest)) return {
		ok: false,
		code: "EXPAND_PATH_ESCAPE"
	};
	const slash = rest.indexOf("/");
	if (slash <= 0) return {
		ok: false,
		code: "EXPAND_BAD_ID"
	};
	const track = rest.slice(0, slash);
	if (track !== "public" && track !== "project") return {
		ok: false,
		code: "EXPAND_BAD_ID"
	};
	const stem = rest.slice(slash + 1);
	if (stem === "") return {
		ok: false,
		code: "EXPAND_BAD_ID"
	};
	if (looksLikePath(stem) || stem.includes("/") || stem.includes(":")) return {
		ok: false,
		code: "EXPAND_PATH_ESCAPE"
	};
	if (!STEM_PATTERN.test(stem)) return {
		ok: false,
		code: "EXPAND_BAD_ID"
	};
	const name = safeMemoryName(stem);
	if (name === null) return {
		ok: false,
		code: "EXPAND_BAD_ID"
	};
	return {
		ok: true,
		track,
		name
	};
}
/** sha256 十六进制（AC-9 的逐字节比对基准；单独导出便于测试与集成层共用一份实现）。 */
function sha256Hex(text) {
	return createHash("sha256").update(text, "utf8").digest("hex");
}
/**
* 构造一个展开器（读盘但不碰宿主：只吃 `roots`）。
*
* 所有失败路径都返回 `ExpandedMemory`，包括 `relatedOf` 抛错、文件读不了、同名目录等
* 「源文件损坏」形态（AC-10：进程不崩、快照与注入不受影响）。
*/
function createExpander(deps) {
	const hashOf = deps.hash ?? sha256Hex;
	return { expand(raw, depth) {
		const hop = normalizeDepth(depth);
		try {
			const parsed = parseMemoryId(raw);
			if (!parsed.ok) return failure(parsed.code, raw, hop, null);
			const id = typeof raw === "string" ? raw.trim() : "";
			if (hop > 2) return failure("EXPAND_DEPTH_EXCEEDED", id, hop, parsed);
			const path = `${memoryDirOf(parsed.track, deps.roots)}/${parsed.name}`;
			if (!existsSync(path)) return failure("EXPAND_NOT_FOUND", id, hop, parsed);
			let source;
			try {
				source = readFileSync(path, "utf8");
			} catch {
				return failure("EXPAND_NOT_FOUND", id, hop, parsed);
			}
			const truncated = source.length > MEMORY_EXPAND_MAX_CHARS;
			const body = truncated ? source.slice(0, MEMORY_EXPAND_MAX_CHARS) : source;
			return {
				code: "OK",
				id,
				track: parsed.track,
				name: parsed.name,
				body,
				chars: body.length,
				truncated,
				depth: hop,
				related: relatedOf(deps, parsed.track, parsed.name),
				message: truncated ? `${EXPAND_MESSAGES.OK}；正文超过 ${MEMORY_EXPAND_MAX_CHARS} 字符已截断（truncated=true）` : EXPAND_MESSAGES.OK,
				hash: safeHash(hashOf, body)
			};
		} catch {
			return failure("EXPAND_NOT_FOUND", typeof raw === "string" ? raw : "", hop, null);
		}
	} };
}
/**
* 逃逸判据（对「去掉 `mem://` 之后的部分」判，不对 scheme 判）：`..` / `~` / 反斜杠 / NUL /
* 绝对路径前缀。冒号在 stem 上单独判（`mem://` 自身就带冒号，不能混为一谈）。
*/
function looksLikePath(text) {
	if (text.includes("\0")) return true;
	if (text.includes("\\")) return true;
	if (text.includes("..")) return true;
	if (text.includes("~")) return true;
	if (text.startsWith("/")) return true;
	return false;
}
/** `depth` 归一：非数字/NaN/0/负数一律按 1 跳（工具参数是模型填的，不能因为填错就报错）。 */
function normalizeDepth(depth) {
	if (typeof depth !== "number" || !Number.isFinite(depth)) return 1;
	const hop = Math.floor(depth);
	return hop < 1 ? 1 : hop;
}
/**
* 关联 ID 清洗：只留能解析的、去掉自引用与重复、上限 `MEMORY_RELATED_MAX`。
*
* 关联是「下一跳的入口」，给一个解析不了的 ID 等于让模型撞一次 `EXPAND_BAD_ID`。
*/
function relatedOf(deps, track, name) {
	if (typeof deps.relatedOf !== "function") return [];
	let candidates;
	try {
		candidates = deps.relatedOf(track, name) ?? [];
	} catch {
		return [];
	}
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const candidate of candidates) {
		const entry = typeof candidate === "string" ? candidate.trim() : "";
		const parsed = parseMemoryId(entry);
		if (!parsed.ok) continue;
		if (parsed.track === track && parsed.name === name) continue;
		const key = `${parsed.track}/${parsed.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(entry);
		if (out.length >= 3) break;
	}
	return out;
}
function safeHash(hashOf, text) {
	try {
		return hashOf(text);
	} catch {
		return "";
	}
}
function failure(code, id, depth, parsed) {
	return {
		code,
		id,
		track: parsed?.track ?? null,
		name: parsed?.name ?? null,
		body: "",
		chars: 0,
		truncated: false,
		depth,
		related: [],
		message: EXPAND_MESSAGES[code],
		hash: ""
	};
}
// src/host/index.ts
/**
* 宿主插件入口（Cordis）。
*
* 顶层的三条硬纪律（AC-8 / AC-9）：
*   1. 不在模块顶层访问 `ctx.*`、不读文件、不 throw —— 任何失败都必须发生在 apply 之内且被兜住；
*   2. 任一部分装配失败不影响其余部分（面板至少能亮、工具至少能报「未就绪」）；
*   3. `node --input-type=module -e "await import('./lib/index.js')"` 必须干净退出。
*
* 这里是**唯一装配点**：把 bridge 的三个编排端口（dispatch / resume / receipt）接到
* `team/dispatch.ts` 的真实实现上，并启动成员存活对账轮询。工具与 HTTP 面板共用同一个
* `bridge.act`，所以「工具能用、面板不能」这类历史缺陷不会从装配层长出来。
*/
const name = "auto-team";
/**
* 硬依赖声明（cordis 的 `inject` 数组 = 全部 required；写入入口才与宿主加载顺序对齐）。
*
* 铁律：每个名字都必须对应源码里的一处 `ctx.<name>` 裸访问。漏声明的后果**不是功能降级**，
* 而是整条 entry 不激活（`dsh: warning: 1 entry did not activate` +
* `cannot get property "x" without inject`），真机上表现为「工具在、面板永远不出现」。
* 名单的唯一判据是 `test/host-contract.test.ts`（刻意双写：这里实现、那里断言，不许第三处抄写）。
*
* 可选服务 `webServer` / `llm` / `agentDefaultModel` **不许**出现在这里：它们只能经
* `adapters.optionalService()` 走 `ctx.get` 读取（缺失时降级，不能拖垮整条 entry）。
*/
const inject = [
	"tools",
	"systemPrompt",
	"agents",
	"agentTeams"
];
/** 队长提示词里的会话标识：单会话 profile 下用 'current' 与实际工具调用元信息对齐。 */
const DEFAULT_SESSION = "current";
function apply(ctx, options) {
	const home = homedir();
	const workspace = options?.workspace ?? process.cwd();
	const dataRoot = globalDataRoot(home);
	const now = () => Date.now();
	const store = new RunsStore(runsDir(home));
	const roles = createRoleRepo({
		dir: rolesDir(home),
		skillsDir: skillsDir(home),
		now
	});
	/**
	* 设置仓储（r7 AC-13）：`settings.json` 是**唯一**可配参数写入点，路径由
	* `paths.settingsPath(home)` 单点推导（真机 = `~/.dsh/auto-team/settings.json`）。
	*
	* 文件缺失时 `read()` 返回缺省值且**不建文件**（首启不落盘，避免把缺省值冻成用户的设置）；
	* 内容损坏/非法时回落缺省并 warn —— 设置坏了不能拖垮整条 entry。
	*/
	const settingsRepo = createSettingsRepo({
		file: settingsPath(home),
		now,
		warn: (text) => warn(ctx, text)
	});
	try {
		roles.seed();
	} catch (error) {
		warn(ctx, `角色库初始化失败：${messageOf(error)}`);
	}
	const memoryRoots = {
		publicDir: publicMemoryDir(home),
		projectDir: projectMemoryDir(workspace)
	};
	const artifactsDir = projectArtifactsDir(workspace);
	const spawnPorts = createSpawnPorts(ctx);
	const routePorts = createRoutePorts(ctx);
	/**
	* 记忆展开端口（AC-9）：`createExpander` 需要读盘但不需要宿主 API，所以这里只把两个根目录喂进去。
	*
	* 初始化失败（目录不可用等）→ `null`：`bridge.expandMemory` 会明确报「不可用」，
	* 工具调用面不会崩，注入侧的内联索引照常工作（只是展不开）。
	*/
	let expander = null;
	try {
		expander = createExpander({ roots: memoryRoots });
	} catch (error) {
		warn(ctx, `记忆展开端口不可用（内联索引仍会注入，但无法按 ID 展开）：${messageOf(error)}`);
	}
	/** 宿主成员名单（做成方法而不是快照：每次对账都取当时的事实，不用缓存的旧名单）。 */
	function listMembers() {
		return listHostMembers(ctx);
	}
	function hostConcurrency() {
		const host = resolveConcurrencyLimit(ctx);
		const cap = settingsRepo.read().concurrencyLimit;
		return host.limit <= cap ? {
			limit: host.limit,
			source: host.source,
			requested: cap,
			clamped: false
		} : {
			limit: cap,
			source: host.source,
			requested: cap,
			clamped: true
		};
	}
	/**
	* 成员 prompt 的拼装本体已搬到纯模块 `team/member-prompt.ts`（AC-10 的独立探针必须
	* import 到**真实**实现才能证明「技能正文真的进了 spawn prompt」）；装配层只留这一行委托，
	* 旧的拼装片段整段删除，避免同一份文案出现两个来源。
	*/
	function buildPrompt(input) {
		return buildMemberPrompt(input, { memoryFor: (goal) => bridge.memoryFor(goal) });
	}
	const spawn = (input) => spawnPorts.spawn({
		prompt: input.prompt,
		name: input.name,
		route: input.role?.model,
		sessionId: input.plan.sessionId,
		taskId: input.task.id
	});
	/** 派发端口：并发切片、角色缺失拒绝、幂等复用、逐角色模型预校验都在 dispatchReady 里。 */
	const dispatch = async (state) => {
		const result = await dispatchReady(state, {
			store,
			spawn,
			roles,
			buildPrompt,
			listMembers,
			routePort: routePorts,
			sendMessage: spawnPorts.sendMessage,
			hostConcurrency,
			now
		});
		return {
			started: result.started,
			skipped: result.skipped,
			errors: result.errors,
			renamed: result.renamed
		};
	};
	/** 恢复端口：只处理 running/gate/interrupted，重复调用必须幂等（AC-17）。 */
	const resume = async (state) => {
		const result = await resumeRun(state, {
			store,
			listMembers,
			sendMessage: spawnPorts.sendMessage,
			now
		});
		return {
			resumed: result.resumed,
			skipped: result.skipped,
			unchanged: result.unchanged
		};
	};
	/** 回执端口：`done` 的唯一写点（AC-19），门禁证据由 bridge 传入。 */
	const applyReceiptPort = (state, taskId, receipt, at, maxAttempts) => applyReceipt(state, taskId, receipt, at, maxAttempts);
	const sendMessage = (memberId, text) => spawnPorts.sendMessage(memberId, text);
	/**
	* 队长模型投影（AC-2 / AC-3）：**配置位与能力位分开**。
	*
	* - 配置（`<dataRoot>/captain.json`）永远读并回显——用户写了什么就一定看得见；
	* - 能力位只认实测：`captainAgentScopeOf` 拿不到主 session 的作用域、或 `installCaptainRoute`
	*   返回 null，就落 `unsupported`。绝不因为「配置存在」就宣称生效（anti-goal 5）。
	*/
	let captainView = captainModelView(null, "unsupported");
	/** 当前装上的队长路由撤销函数（重装时先撤销，避免改两次设置叠两个路由）。 */
	let captainUndo = null;
	/** 卸载清理钩子只注册一次（`registerEffect` 每多注册一个都会让装配面多一条清理）。 */
	let captainCleanupRegistered = false;
	/**
	* 队长模型装配（r7 改造）：**`settings.json` 是唯一写入点**，既有 `<dataRoot>/captain.json`
	* 降级为迁移期只读回落 —— 否则「设置页改了不生效」或「两边各说一套」必犯其一。
	*
	* - 配置位与能力位仍然分开：配置永远回显，能力位只认实测（`captainAgentScopeOf` /
	*   `installCaptainRoute` 任一拿不到就 `unsupported`），绝不因「配置存在」宣称生效。
	* - 可重入：保存设置后由 `onSettingsSaved` 再调一次，旧路由先撤销。
	*/
	function syncCaptainRoute() {
		try {
			const route = settingsRepo.read().captainModel ?? null ?? readCaptainModel(dataRoot);
			captainUndo?.();
			captainUndo = null;
			let capability = captainAgentScopeOf(ctx) === null ? "unsupported" : "ok";
			if (route !== null && capability === "ok") {
				const undo = installCaptainRoute(ctx, route);
				if (undo === null) {
					capability = "unsupported";
					warn(ctx, `队长模型 ${route.provider}/${route.model} 未生效：宿主未提供可安装的主 session 作用域`);
				} else {
					captainUndo = undo;
					if (!captainCleanupRegistered) {
						captainCleanupRegistered = true;
						registerEffect(ctx, () => {
							captainUndo?.();
							captainUndo = null;
						});
					}
				}
			}
			captainView = captainModelView(route, capability);
			if (route !== null && capability === "ok") ctx.logger?.info?.(`[auto-team] 队长模型已生效：${route.provider}/${route.model}`);
		} catch (error) {
			warn(ctx, `队长模型装配失败（面板显示未生效）：${messageOf(error)}`);
			captainView = captainModelView(null, "unsupported");
		}
	}
	syncCaptainRoute();
	/**
	* Trigger 总线（AC-13~AC-18）：判定与记账在这里，推进仍然只有 `bridge.act` 一个出口。
	*
	* 先声明后赋值是为了打破环：快照要读总线健康度（`triggerHealth`），总线又需要 bridge。
	*/
	let bus = null;
	/**
	* 成员对账 watcher 句柄（r7 起可重建）：停滞阈值与返工上限来自 settings，
	* 用户保存设置后必须按新阈值重建，否则「改了不生效」只能靠重启治。
	* 重建只碰 watcher 自己的表（先 stop 再 start），全仓定时器仍然只有一处。
	*/
	let watcherRef = null;
	function startWatcher() {
		watcherRef?.stop();
		const settings = settingsRepo.read();
		watcherRef = createMemberWatcher({
			store,
			listMembers,
			now,
			stallMs: settings.stallMs,
			maxAttempts: settings.maxAttempts,
			onPoll: async (state) => {
				if (bus === null) return;
				await bus.poll(state);
			}
		});
		watcherRef.start();
	}
	const bridge = createBridge({
		store,
		roles,
		memoryRoots,
		dataRoot,
		dispatch,
		resume,
		applyReceipt: applyReceiptPort,
		sendMessage,
		gate: {
			cwd: workspace,
			artifactsDir
		},
		hostConcurrency,
		now,
		captainModel: () => captainView,
		settingsRepo,
		onSettingsSaved: () => {
			syncCaptainRoute();
			startWatcher();
		},
		triggerHealth: () => bus === null ? {
			degraded: true,
			reason: "Trigger 总线未装配，推进只剩轮询兜底"
		} : bus.health(),
		...expander === null ? {} : { expander: (id, depth) => expander.expand(id, depth) }
	});
	try {
		bus = createTriggerBus({
			store,
			bridge,
			now
		});
	} catch (error) {
		warn(ctx, `Trigger 总线启动失败（四类事件不再自动推进，面板显示降级）：${messageOf(error)}`);
	}
	try {
		registerTools(ctx, {
			store,
			roles,
			bridge,
			now
		});
	} catch (error) {
		warn(ctx, `工具注册失败：${messageOf(error)}`);
	}
	try {
		registerCaptainPrompt(ctx, { bridge }, DEFAULT_SESSION);
	} catch (error) {
		warn(ctx, `提示词注入失败：${messageOf(error)}`);
	}
	try {
		registerHttpBridge(ctx, {
			bridge,
			defaultSessionId: () => DEFAULT_SESSION
		});
	} catch (error) {
		warn(ctx, `面板桥注册失败：${messageOf(error)}`);
	}
	try {
		const progressSub = onMemberProgress(ctx, ({ agent, at }) => {
			try {
				const identity = agent === void 0 ? void 0 : memberIdentityOf(ctx, agent);
				if (!identity) return;
				for (const summary of store.list()) {
					const state = store.load(summary.runId);
					if (!state) continue;
					const hit = state.bindings.find((binding) => binding.retired !== true && (binding.memberId === identity.id || binding.name === identity.name));
					if (!hit) continue;
					store.save({
						...state,
						progress: touchProgress(state.progress, hit.memberId, at)
					});
				}
			} catch (error) {
				warn(ctx, `推进记录失败：${messageOf(error)}`);
			}
		});
		registerEffect(ctx, () => progressSub.stop());
	} catch (error) {
		warn(ctx, `成员推进事件订阅失败：${messageOf(error)}`);
	}
	try {
		registerEffect(ctx, registerToolGuard(ctx, (request) => guardOf({
			role: request.agentId === null ? "captain" : "member",
			toolName: request.toolName,
			args: request.args
		})));
	} catch (error) {
		warn(ctx, `noWait 守卫未装配（队长仍可能前台同步长等待）：${messageOf(error)}`);
	}
	try {
		const subscription = onHostTriggerEvents(ctx, (eventName, payload) => {
			try {
				if (eventName !== "agent/error" && eventName !== "subagent/end") return;
				if (bus === null) return;
				const ids = payloadIdsOf(payload);
				if (ids.size === 0) return;
				const at = now();
				for (const summary of store.list()) {
					const state = store.load(summary.runId);
					if (!state) continue;
					for (const binding of state.bindings) {
						if (binding.retired === true) continue;
						if (!ids.has(binding.memberId) && !ids.has(binding.name)) continue;
						const trigger = triggerFromMemberExit(state.plan.runId, binding.memberId, eventName, at);
						bus.push(trigger).catch((error) => warn(ctx, `成员退出推进失败：${messageOf(error)}`));
					}
				}
			} catch (error) {
				warn(ctx, `Trigger 事件处理失败：${messageOf(error)}`);
			}
		});
		if (subscription.degraded) {
			bus?.setEventSource(false);
			warn(ctx, "Trigger 事件源降级：部分宿主事件订阅失败，四类推进退回轮询兜底");
		} else bus?.setEventSource(true);
		registerEffect(ctx, () => subscription.stop());
	} catch (error) {
		warn(ctx, `Trigger 事件订阅失败（推进只剩轮询兜底）：${messageOf(error)}`);
	}
	try {
		startWatcher();
		registerEffect(ctx, () => {
			watcherRef?.stop();
			watcherRef = null;
		});
		registerAgentCreated(ctx, (payload) => {
			const actual = payload.installed ?? payload.model ?? null;
			for (const summary of store.list()) {
				const state = store.load(summary.runId);
				if (!state) continue;
				const binding = state.bindings.find((item) => item.retired !== true && (item.memberId === payload.member.id || item.name === payload.member.name));
				if (!binding) continue;
				const role = roles.get(binding.roleId);
				const next = auditRoute(state, binding.taskId, role?.model ?? null, actual, now());
				if (next !== state) store.save(next);
			}
		});
	} catch (error) {
		warn(ctx, `运行时对账启动失败：${messageOf(error)}`);
	}
	ctx.logger?.info?.(`[auto-team] 已装配：data=${dataRoot} workspace=${workspace} artifacts=${artifactsDir}`);
}
function warn(ctx, text) {
	ctx.logger?.warn?.(`[auto-team] ${text}`);
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* 事件 payload 里的字符串集合（AC-12 的「不猜字段路径」做法）。
*
* 宿主四个事件的 payload 形状**未实测**（U2），所以这里不按 `payload.agent.id` 这类路径取值，
* 而是把 payload 里浅层出现的字符串收成一堆，再与 store 里**已登记的** memberId / name 求交。
* 命中即有事实依据（那个 id 是我们自己写进 bindings 的），没命中就静默跳过 —— 永不凭猜测造实体。
*/
function payloadIdsOf(payload) {
	const ids = /* @__PURE__ */ new Set();
	const seen = /* @__PURE__ */ new Set();
	const stack = [payload];
	let budget = 64;
	while (stack.length > 0 && budget > 0) {
		budget -= 1;
		const value = stack.pop();
		if (value === null || typeof value !== "object" || seen.has(value)) continue;
		seen.add(value);
		for (const child of Object.values(value)) if (typeof child === "string") ids.add(child);
		else if (child !== null && typeof child === "object") stack.push(child);
	}
	return ids;
}
var host_default = {
	name,
	inject,
	apply
};
export { apply, host_default as default, inject, name };
