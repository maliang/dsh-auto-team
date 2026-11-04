import { homedir } from "node:os";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
// src/shared/const.ts
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
/**
* 左栏项目库的装配缓存 TTL（毫秒，r13 AC-23）。
*
* 左栏与右栏会各自按需请求 `/library`；不缓存时每次请求都要把 runs/ 全量读一遍。
* 5s 是「用户切换项目能看到新状态」与「不重复扫盘」的折中，且 snapshot 路径**不走**它。
*/
const LIBRARY_CACHE_MS = 5e3;
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
/**
* 模型清单缓存有效期（毫秒，stale-while-revalidate）。
*
* 60s 是「用户刚在宿主里加了模型，下一分钟面板就能看到」与「不因每次快照轮询都打宿主」
* 之间的折中：面板每 2s 取一次快照，没有缓存就是每 2s 一次 `listProviders/listModels`。
*/
const MODEL_CATALOG_TTL_MS = 6e4;
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
/** 技能正文目录（r10 起是真正的 md 仓储：内置覆盖层 + 导入/系统/手写四来源都在这里）。 */
function skillsDir(home) {
	return `${globalDataRoot(home)}/skills`;
}
/**
* 宿主系统技能库（r10 AC-19）：`<home>/.agents/skills`。
*
* 为什么**不**在 `globalDataRoot` 下面：那是 DSH 自己的技能库约定（`skill_manage` 的默认目录），
* 我们只读不写——写进别人的库里等于污染宿主资产。放在这里只是为了集中派生、避免各处手拼。
*/
function systemSkillsDir(home) {
	return `${trimSlash(home)}/.agents/skills`;
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
/**
* 队长留痕落点：`<home>/.dsh/auto-team/deviations.jsonl`（r11 F7）。
*
* 同样**不再拼 `.dsh`** —— `globalDataRoot` 已含；多拼一层会落到
* `~/.dsh/.dsh/auto-team/`，症状是「真有记录、面板永远是 0 条」。
*/
function deviationsPath(home) {
	return `${globalDataRoot(home)}/deviations.jsonl`;
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
			pause: normalizePause(state.pause),
			project: normalizeLabel(state.project),
			finishedAt: finiteOptional(state.finishedAt),
			usage: normalizeUsage(state.usage),
			taskTimes: normalizeTaskTimes(state.taskTimes),
			pendingConfirmation: normalizePending(state.pendingConfirmation),
			forceParallel: normalizeIdList(state.forceParallel)
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
				done: plan.tasks.filter((task) => task.status === "done").length,
				...normalizeLabel(state.project) !== void 0 ? { project: normalizeLabel(state.project) } : {},
				...normalizeLabel(plan.goal) !== void 0 ? { goal: normalizeLabel(plan.goal) } : {},
				plannedAt: state.plannedAt,
				...state.finishedAt !== void 0 ? { finishedAt: state.finishedAt } : {},
				...state.usage?.total !== void 0 ? { usageTotals: state.usage.total } : {},
				active: plan.tasks.some((task) => !SUMMARY_TERMINAL_STATUSES.has(task.status))
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
	if (!isRecord$3(raw)) return null;
	const plan = normalizePlan(isRecord$3(raw.plan) ? raw.plan : raw);
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
		pause: normalizePause(raw.pause),
		project: normalizeLabel(raw.project),
		finishedAt: finiteOptional(raw.finishedAt),
		usage: normalizeUsage(raw.usage),
		taskTimes: normalizeTaskTimes(raw.taskTimes),
		pendingConfirmation: normalizePending(raw.pendingConfirmation),
		forceParallel: normalizeIdList(raw.forceParallel)
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
*
* `waiting`（r11 AC-16）**必须**在白名单里：它的等待关系不落盘（无锁表），但状态本身要落盘，
* 否则重启后等待中的任务被归回 pending，下一轮把它当普通待办派发出去 —— 写域互斥静默失效。
* `cancelled` / `skipped`（r11 AC-15/AC-26）是终态：归回 pending 会让「已跳过」的任务复活，
* 而 skipped 同时是「依赖已满足」的判据（graph.depSatisfied），必须原样存活。
*/
const TASK_STATUSES = [
	"pending",
	"blocked",
	"ready",
	"running",
	"waiting",
	"paused",
	"gate",
	"done",
	"rework",
	"failed",
	"interrupted",
	"cancelled",
	"skipped"
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
	if (!isRecord$3(raw)) return out;
	for (const [memberId, value] of Object.entries(raw)) {
		if (!isRecord$3(value)) continue;
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
		if (!isRecord$3(value)) continue;
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
		if (!isRecord$3(value)) continue;
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
	if (!isRecord$3(raw)) return void 0;
	if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return void 0;
	if (!PLAN_STATUSES.includes(raw.planStatus)) return void 0;
	if (!isRecord$3(raw.tasks)) return void 0;
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
/**
* 列表摘要用的终态集合：必须与 `team/dispatch.ts` 的 `TERMINAL_TASK_STATUSES` 一致。
*
* 不直接 import 那个模块是为了让 `store.ts`（落盘层）保持零运行时依赖 ——
* 这里只服务「左栏是否标活跃」这一件事，语义偏差的后果只是多一个圆点，不是派发错误。
*/
const SUMMARY_TERMINAL_STATUSES = /* @__PURE__ */ new Set([
	"done",
	"failed",
	"cancelled",
	"skipped",
	"interrupted"
]);
/** 可选毫秒值：有限、非负、取整；其余（含 `NaN` / `-1` / 字符串）一律视为缺失。 */
function finiteOptional(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : void 0;
}
/** 可选标签（项目名 / id / reason）：非空字符串才留，去首尾空白。 */
function normalizeLabel(value) {
	if (typeof value !== "string") return void 0;
	const text = value.trim();
	return text === "" ? void 0 : text;
}
/** id 列表（`forceParallel`）：去空、去重、保序；空数组归一成 `undefined`（= 没有授权）。 */
function normalizeIdList(value) {
	if (!Array.isArray(value)) return void 0;
	const out = [];
	for (const entry of value) {
		const text = normalizeLabel(entry);
		if (text !== void 0 && !out.includes(text)) out.push(text);
	}
	return out.length > 0 ? out : void 0;
}
/** 一组 token 数字：丢非有限/负数；`total` 缺失时按 `input + output` 补（tech §2.5）。 */
function normalizeTokenTotals(raw) {
	if (!isRecord$3(raw)) return void 0;
	const input = finiteOptional(raw.input);
	const output = finiteOptional(raw.output);
	const declared = finiteOptional(raw.total);
	if (declared === void 0 && input === void 0 && output === void 0) return void 0;
	const totals = { total: declared ?? (input ?? 0) + (output ?? 0) };
	if (input !== void 0) totals.input = input;
	if (output !== void 0) totals.output = output;
	return totals;
}
function normalizeTotalsMap(raw) {
	const out = {};
	if (!isRecord$3(raw)) return out;
	for (const [key, value] of Object.entries(raw)) {
		const totals = normalizeTokenTotals(value);
		if (totals !== void 0) out[key] = totals;
	}
	return out;
}
/**
* 用量记录归一（AC-19）：分项逐条校验，`attribution` 非法时按「有什么推什么」重推。
*
* 一个数字都没有的记录归成 `undefined`（= 没收到用量），而不是 `total: 0` ——
* 后者会让面板诚实地显示「0 token」，而事实是从没拿到过数据。
*/
function normalizeUsage(raw) {
	if (!isRecord$3(raw)) return void 0;
	const byMember = normalizeTotalsMap(raw.byMember);
	const byTask = normalizeTotalsMap(raw.byTask);
	const total = normalizeTokenTotals(raw.total);
	if (total === void 0 && Object.keys(byMember).length === 0 && Object.keys(byTask).length === 0) return void 0;
	const declared = raw.attribution;
	const record = {
		attribution: declared === "per-member" || declared === "aggregate-only" || declared === "unavailable" ? declared : Object.keys(byMember).length > 0 ? "per-member" : "aggregate-only",
		byMember,
		byTask,
		updatedAt: finiteOptional(raw.updatedAt) ?? 0
	};
	if (total !== void 0) record.total = total;
	return record;
}
/** 任务计时归一（AC-20）：只留毫秒整数；`endedAt < startedAt` 的整条丢弃（时间倒流是坏数据）。 */
function normalizeTaskTimes(raw) {
	if (!isRecord$3(raw)) return void 0;
	const out = {};
	for (const [taskId, value] of Object.entries(raw)) {
		if (!isRecord$3(value)) continue;
		const startedAt = finiteOptional(value.startedAt);
		const endedAt = finiteOptional(value.endedAt);
		if (startedAt === void 0 && endedAt === void 0) continue;
		if (startedAt !== void 0 && endedAt !== void 0 && endedAt < startedAt) continue;
		const record = {};
		if (startedAt !== void 0) record.startedAt = startedAt;
		if (endedAt !== void 0) record.endedAt = endedAt;
		out[taskId] = record;
	}
	return Object.keys(out).length > 0 ? out : void 0;
}
/** 待确认动作归一：只认 5 类不可逆动作，且必须补齐该动作执行所需的最小字段。 */
function normalizeIrreversibleAction(raw) {
	if (!isRecord$3(raw) || typeof raw.type !== "string") return void 0;
	switch (raw.type) {
		case "cancel": return { type: "cancel" };
		case "cancelTask": {
			const taskId = normalizeLabel(raw.taskId);
			if (taskId === void 0) return void 0;
			const reason = normalizeLabel(raw.reason);
			return reason === void 0 ? {
				type: "cancelTask",
				taskId
			} : {
				type: "cancelTask",
				taskId,
				reason
			};
		}
		case "skipTask": {
			const taskId = normalizeLabel(raw.taskId);
			return taskId === void 0 ? void 0 : {
				type: "skipTask",
				taskId
			};
		}
		case "updateAcceptance": {
			const taskId = normalizeLabel(raw.taskId);
			if (taskId === void 0 || typeof raw.acceptance !== "string") return void 0;
			return {
				type: "updateAcceptance",
				taskId,
				acceptance: raw.acceptance
			};
		}
		case "forceParallel": {
			const taskId = normalizeLabel(raw.taskId);
			return taskId === void 0 ? void 0 : {
				type: "forceParallel",
				taskId
			};
		}
		default: return;
	}
}
/** 未决确认归一（AC-13）：缺 `id` / `action` / `runId` 整条丢弃（残缺记录无法被确认或拒绝）。 */
function normalizePending(raw) {
	if (!isRecord$3(raw)) return void 0;
	const id = normalizeLabel(raw.id);
	const runId = normalizeLabel(raw.runId);
	const action = normalizeIrreversibleAction(raw.action);
	const createdAt = finiteOptional(raw.createdAt);
	if (id === void 0 || runId === void 0 || action === void 0 || createdAt === void 0) return void 0;
	const pending = {
		id,
		action,
		runId,
		createdAt,
		summary: typeof raw.summary === "string" ? raw.summary : "",
		irreversible: true
	};
	const taskId = normalizeLabel(raw.taskId);
	if (taskId !== void 0) pending.taskId = taskId;
	return pending;
}
function normalizePlan(raw) {
	const { runId, sessionId, tasks } = raw;
	if (typeof runId !== "string" || runId === "") return null;
	if (typeof sessionId !== "string" || !Array.isArray(tasks)) return null;
	const plan = {
		runId,
		sessionId,
		createdAt: finiteNumber(raw.createdAt, 0),
		status: PLAN_STATUSES.includes(raw.status) ? raw.status : "draft",
		tasks: tasks.map(normalizeTask).filter((task) => task !== null),
		maxConcurrent: clampConcurrency(raw.maxConcurrent)
	};
	const goal = normalizeLabel(raw.goal);
	if (goal !== void 0) plan.goal = goal;
	return plan;
}
/** 单个任务的最小结构校验：旧文件里缺字段时补默认值，坏条目直接丢弃。 */
function normalizeTask(raw) {
	if (!isRecord$3(raw) || typeof raw.id !== "string" || raw.id === "") return null;
	const task = {
		...raw,
		id: raw.id,
		title: typeof raw.title === "string" ? raw.title : raw.id,
		roleId: typeof raw.roleId === "string" ? raw.roleId : "",
		dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.filter((dep) => typeof dep === "string") : [],
		acceptance: typeof raw.acceptance === "string" ? raw.acceptance : "",
		status: TASK_STATUSES.includes(raw.status) ? raw.status : "pending"
	};
	const writeScopes = stringList(raw.writeScopes);
	if (writeScopes.length > 0) task.writeScopes = writeScopes;
	else delete task.writeScopes;
	const waitingOn = stringList(raw.waitingOn);
	if (waitingOn.length > 0) task.waitingOn = waitingOn;
	else delete task.waitingOn;
	const waitReason = typeof raw.waitReason === "string" ? raw.waitReason.trim() : "";
	if (waitReason !== "") task.waitReason = waitReason;
	else delete task.waitReason;
	return task;
}
/** 字符串数组清洗：丢非字符串、去首尾空白、丢空串（保持声明顺序）。 */
function stringList(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter((item) => item !== "");
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
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// src/host/roles/builtin.ts
const BUILTIN_SKILLS = [
	{
		id: "prd-writing",
		title: "需求与验收标准",
		description: "把一句话需求写成可判定、可追溯的验收标准",
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
		description: "定模块边界与契约、收敛技术选型与改造范围",
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
		description: "最小改动落地代码，并留下可复核的验证证据",
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
		description: "把 AC 翻译成会变红的断言，并保留退出码证据",
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
		description: "写怎么用、怎么验、失败怎么办，命令可直接复制",
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
		description: "先看边界与失败路径，结论必须带可复跑的证据",
		body: [
			"# 评审与风险",
			"- 先看边界与失败路径，再看正常路径。",
			"- 对每条结论标注证据（命令/文件行号），无证据的结论按假设处理。",
			"- 输出必须含「建议修改」与「可接受」两栏，避免只给结论不给依据。"
		].join("\n")
	},
	{
		id: "frontend-ui",
		title: "前端界面实现",
		description: "组件拆分、状态反馈与无障碍落地，样式不散落组件内",
		body: [
			"# 前端界面实现",
			"- 先定组件边界与状态归属：谁持有数据、谁只做渲染，一个状态只能有一个 owner。",
			"- 每个交互态都要有可见反馈：hover / pressed / focus / disabled 缺一个就会被用户当成「点了没反应」。",
			"- 异步读取必须解构 `{ data, error }` 包装；整包赋值给界面是本项目的历史高频缺陷族。",
			"- 失败态给可读文案与重试入口，禁止只留一个空白区块或静默降级。",
			"- 样式集中在一个 owner 文件里，只用既有设计 token；字号用 `font:` 简写，不用 `font-size: var(...)`。",
			"- 布局按最坏取值算：窄宽下先保证内容不重叠、不裁切，再谈留白。",
			"- 列表容器给固定最大高度内滚，不要让它随条目数把整页撑到几千像素。",
			"- 可交互元素必须能被键盘到达，图标按钮补 `aria-label`，开合类按钮给 `aria-pressed`。",
			"- 语义化标签优先（button/a/ul），不要用 div 绑 onClick 冒充按钮。",
			"- 文案与状态映射全部走纯函数，方便单测；不要在多处各写一套 tone/label 映射。",
			"- 模态必须 `createPortal` 到 `document.body`，并处理 Esc 关闭与焦点回归。",
			"- 数字与单位分开呈现，避免在数字里混进单位字符串导致断言与筛选失效。",
			"- 改动后跑一次类型检查：`{data,error}` 未解构、字段名写错只有类型检查会点出来。",
			"- 交付回执写清「改了哪个挂载面 + 真机看到什么」，构建通过不等于界面正确。",
			"- 真机不可用时如实写「未验证」，不要用截图以外的推断替代。"
		].join("\n")
	},
	{
		id: "backend-api",
		title: "后端接口与数据",
		description: "接口契约、幂等与事务边界、分页与错误码",
		body: [
			"# 后端接口与数据",
			"- 接口先定契约：入参校验、返回形状、错误码，三者写在同一处，调用方不用猜。",
			"- 写操作必须考虑幂等：同一请求重放不得产生第二条记录（唯一键或显式去重）。",
			"- 事务边界要覆盖一整条业务不变量，不要把一条不变量拆到两次提交里。",
			"- 先校验后落盘：非法入参必须在写任何文件/表之前被拒，并给出可读原因。",
			"- 返回统一包装（`{ data, error }` 或等价物），禁止一半接口抛异常一半返回错误对象。",
			"- 列表接口一律分页/限长：无上限的 list 会随数据增长变成慢查询与内存事故。",
			"- 外部调用超时与重试必须显式给，不依赖默认值；重试要有次数上限。",
			"- 失败日志带可定位的键（id/路径/参数摘要），但不得打印密钥与完整凭据。",
			"- 文件落盘用临时文件 + 原子替换，避免半截文件被下游当成有效数据读取。",
			"- 路径拼接集中在一个纯函数里，调用方不得自己拼，否则逃逸防护会漏一处。",
			"- 并发写入要考虑竞争：读改写之间用锁或版本号，禁止「读了再默默覆盖」。",
			"- 向后兼容：新增字段可缺省，删除字段必须先让消费方不再依赖。",
			"- 迁移脚本要可重复执行（已存在则跳过），并保留回滚路径。",
			"- 单测覆盖「正常 + 非法 + 冲突」三类入参，不要只测快乐路径。",
			"- 交付回执附一条真实调用证据（命令与返回值尾部），不写「应该可以」。"
		].join("\n")
	},
	{
		id: "ui-ux-design",
		title: "交互与视觉设计",
		description: "信息层级、状态矩阵与可达性，先定结构再定样式",
		body: [
			"# 交互与视觉设计",
			"- 先定信息层级：一块区域只回答一个问题，同一条信息不得在两处各显示一遍。",
			"- 每个界面列出状态矩阵：空 / 加载 / 有数据 / 失败 / 禁用，缺一态就会在真机上露馅。",
			"- 主次靠字号/字重/颜色三层区分，不要靠多写一行说明文字来解释重点。",
			"- 颜色语义固定：正常、警示、错误各一色，同一含义不得在不同位置换色。",
			"- 可点击元素给明确的可点击暗示（描边/底色/箭头），只靠 hover 变化等于没暗示。",
			"- 命中区不小于 24px，紧凑控件用伪元素扩大命中区，不靠撑大视觉尺寸。",
			"- 文案用动词开头的短句，按钮文案说明结果而不是动作（「恢复出厂」而不是「确定」）。",
			"- 破坏性操作用二次确认，并列出影响范围与数量，不要用「确定要继续吗」。",
			"- 长文本单行截断给 title 兜底，不要让它把布局推歪。",
			"- 窄宽（320px）是最坏基准：按它排版，宽屏只会更好看。",
			"- 动效只用于说明状态变化（出现/收起），时长控制在 150–200ms。",
			"- 禁用态与失败态要在视觉上可分，不能只靠一处颜色差异。",
			"- 颜色对比度按 WCAG AA（正文 4.5:1）自查，浅灰说明文字最容易不达标。",
			"- 所有可见文案写进渲染描述层，纯函数化，方便一眼看全并做断言。",
			"- 交付时给出一份「尺寸/间距/字号」取值表，实现方按表落地，避免各写各的。"
		].join("\n")
	},
	{
		id: "devops-release",
		title: "构建发布与运维",
		description: "构建产物、环境差异、灰度与回滚预案",
		body: [
			"# 构建发布与运维",
			"- 先确认构建命令与产物落点：产物没进包，前面做得再对用户也看不到。",
			"- 打包清单必须核对：入口文件、配置文件、静态资源一个都不能少。",
			"- 本地能跑不等于线上能跑：环境变量、端口、权限三项逐条对照。",
			"- 每次发布前留一版可回滚的产物，回滚步骤写成可复制命令。",
			"- 灰度先小流量：验证失败率与关键路径，再全量。",
			"- 启动后立刻做健康检查，有可读的失败原因，不要只看进程在不在。",
			"- 日志分级并带请求/任务标识；排障时能按一条标识串起全链路。",
			"- 依赖锁版本，禁止在生产构建里解析浮动版本。",
			"- 发布脚本每一步都要有超时与失败退出码，禁止 `|| true` 掩盖失败。",
			"- 长耗时命令后台跑并打印阶段进度，静默几十秒会被当成卡死。",
			"- 迁移与发布解耦：先兼容双写/双读，再切换，最后清理旧路径。",
			"- 破坏性操作（删库、清缓存、覆盖配置）默认关闭，需要显式开关开启。",
			"- 验证完清理自己起的进程与临时目录，孤儿进程会让后来者验到旧版本。",
			"- 发布记录写清版本、变更点、验证命令与结果，不写「已上线」。",
			"- 出现异常先止损再定位：回滚优先于现场调试。"
		].join("\n")
	},
	{
		id: "security-audit",
		title: "安全审计",
		description: "越权、注入、密钥与最小权限的检查清单",
		body: [
			"# 安全审计",
			"- 先画权限边界：谁能读、谁能写、谁能删，逐条对应到代码里的判定点。",
			"- 越权是最高频问题：每个写接口都要校验「操作者是否有权动这条数据」，不能只校验登录。",
			"- 身份判断集中一处，禁止在不同分支里用不同字段推断「是不是管理员」。",
			"- 所有外部输入（路径、命令、SQL、模板、URL）都当不可信，按白名单校验而不是黑名单过滤。",
			"- 路径拼接必须归一化后再判前缀，`..` 与软链两种逃逸都要测。",
			"- 命令与查询一律参数化，禁止拼接字符串；确实要执行外部命令就先确认没有插值。",
			"- 密钥与凭据不得进日志、不得进快照、不得进前端产物；只在内存里用。",
			"- 最小权限：进程、令牌、文件权限只给必需范围，默认拒绝。",
			"- 外部下载与远程内容必须限制大小与协议，并当不可信数据处理。",
			"- 反序列化与配置解析要限制形状，禁止把外部 JSON 直接当内部对象用。",
			"- 会话与令牌设置过期与撤销路径，退出后服务端必须失效。",
			"- 审计日志记录谁在何时对什么做了什么，且不可被普通业务路径修改。",
			"- 安全断言要能证伪：写一条「删掉校验就变红」的测试，否则等于没有防护。",
			"- 依赖漏洞按 CVSS 与可利用性排序，先修外部可触达的。",
			"- 结论分「已确认可利用 / 需人工确认 / 已覆盖」三栏，不写「感觉有风险」。"
		].join("\n")
	},
	{
		id: "data-modeling",
		title: "数据建模",
		description: "实体关系、约束与索引，迁移可重复可回滚",
		body: [
			"# 数据建模",
			"- 先列实体与关系（1:1 / 1:N / N:N），再定字段；关系没定清就写表必然返工。",
			"- 每条业务不变量都要落到约束上（唯一键、非空、外键或显式校验），只靠应用层判断迟早漏。",
			"- 状态字段用枚举而不是自由文本，取值集合写在一处并被校验引用。",
			"- 时间用统一时区与统一类型存，展示层再做本地化。",
			"- 「没有值」与「值为 0/空串」是两种状态，字段设计必须能区分。",
			"- 索引按查询建：先写出真实查询，再决定索引顺序，不要凭直觉加。",
			"- 大字段（正文、JSON）与热点小字段分表或分列，避免全表扫描被大字段拖慢。",
			"- 软删除要能被查询与唯一约束感知，否则删掉的行会继续占着唯一键。",
			"- 迁移脚本可重复执行：已存在则跳过，字段重命名要保留数据。",
			"- 迁移必须可回滚，或者明确写清「不可回滚 + 备份步骤」。",
			"- 聚合与派生数据标明真值来源：一份数据只有一个写入点，其余是投影。",
			"- 历史数据要有回填脚本，并能在小样本上先验一遍再全量。",
			"- 统计口径写进字段注释：分母是什么、是否去重，否则两个页面必然给出两个数。",
			"- 数据校验失败要给出可定位的行标识，不要只报「格式错误」。",
			"- 建模结论附一条真实查询或样例数据，证明约束真的生效。"
		].join("\n")
	}
];
/** 内置角色（id 稳定，内置标记不可删）。`prompt` 是恢复默认时的**唯一逐字来源**。 */
const BUILTIN_ROLES = [
	{
		id: "pm",
		name: "产品经理",
		duty: "澄清需求、拆解目标、定义验收标准与范围外事项",
		skillIds: ["prd-writing"],
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
		skillIds: ["architecture", "data-modeling"],
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
		skillIds: ["docs", "prd-writing"],
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
		skillIds: ["review", "security-audit"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你独立复核，不替实现方辩护：",
			"- 先看边界：改动的文件是否越界、契约是否被偷偷扩大。",
			"- 再看证据：每条判定能否复跑，数字是否与命令输出对得上。",
			"- 最后看形态：是否有「两边都绿、真机为 0」的假绿（模板没绑 hook、字段没进快照）。",
			"- 结论只给「通过」或「打回 + 必改项」，必改项要能直接改成一条命令。"
		].join("\n")
	},
	{
		id: "frontend",
		name: "前端工程师",
		duty: "实现界面与交互、按设计稿落地视觉、状态与无障碍",
		skillIds: ["frontend-ui", "ui-ux-design"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你把设计稿变成可用的界面，而不是一堆能渲染的元素：",
			"- 先确认挂载面与既有 slot 契约，再动手写组件；不要新造挂载点。",
			"- 每个异步分支都要有加载/失败/重试三态，失败不许静默。",
			"- 样式只加在样式 owner 文件里，只用既有 token，不写散落的魔法数字。",
			"- 交付前自己按窄宽（320px）看一遍：内容重叠、按钮点不到，都算不合格。"
		].join("\n")
	},
	{
		id: "backend",
		name: "后端工程师",
		duty: "实现接口与数据层、保证一致性与幂等、守住错误边界",
		skillIds: ["backend-api", "data-modeling"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你写接口先想失败：",
			"- 入参校验放在最前面，非法输入必须在任何写入之前被拒。",
			"- 写操作默认考虑重放：同一请求到两次，结果必须一致。",
			"- 列表接口一律限长，返回值统一包装，调用方不该猜形状。",
			"- 报错给可定位原因（字段名/路径/id），不打印密钥，不写空 catch。"
		].join("\n")
	},
	{
		id: "designer",
		name: "UI/UX 设计师",
		duty: "视觉与交互设计、信息层级与可达性评审、状态矩阵",
		skillIds: ["ui-ux-design", "frontend-ui"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你的产出是实现方可以照着写代码的规格：",
			"- 每块区域只回答一个问题，同一条信息不在两处重复显示。",
			"- 每个控件给出状态矩阵（空/加载/有数据/失败/禁用）与对应文案。",
			"- 尺寸、间距、字号写成取值表，并说明窄宽下的取舍。",
			"- 颜色语义固定，对比度按 WCAG AA 自查；破坏性动作用二次确认。"
		].join("\n")
	},
	{
		id: "devops",
		name: "DevOps 工程师",
		duty: "构建与发布链路、环境差异、灰度与回滚预案",
		skillIds: ["devops-release", "implementation"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你负责「改动能真的到用户手上，并且能退回来」：",
			"- 先核对产物清单与入口，再谈发布流程；打包少一个文件等于没做。",
			"- 每条发布步骤都给可复制命令、超时与失败退出码。",
			"- 灰度与回滚预案要写在发布记录里，回滚优先于现场调试。",
			"- 验证完清理自己起的进程与临时目录，避免后来者验到旧版本。"
		].join("\n")
	},
	{
		id: "security",
		name: "安全审计员",
		duty: "越权与注入面审计、密钥管理、最小权限与可证伪的安全断言",
		skillIds: ["security-audit", "review"],
		builtin: true,
		updatedAt: 0,
		prompt: [
			"你按「能被利用吗」来排序风险，而不是按清单打勾：",
			"- 每个写入口先问一句：操作者凭什么能动这条数据？只校验登录不算校验权限。",
			"- 所有外部输入按白名单校验；路径、命令、查询一律参数化。",
			"- 密钥与凭据只在内存里，日志与快照里出现一次就算缺陷。",
			"- 每条安全结论配一条「删掉防护就变红」的测试，否则按假设处理。"
		].join("\n")
	}
];
/** 该 id 是否出厂内置（`source` 判定与「不可删」都由它派生，不看磁盘写了什么）。 */
function isBuiltinSkill(skillId) {
	return BUILTIN_SKILLS.some((skill) => skill.id === skillId);
}
function builtinSkillBody(skillId) {
	return BUILTIN_SKILLS.find((skill) => skill.id === skillId)?.body ?? "";
}
/**
* 角色的完整技能正文（注入成员 prompt 时用；未知 skillId 静默跳过并在返回里报告）。
*
* `bodyOf` 是 r10 加的**可选解析器**：宿主传 `skills.get(id).body`，让提示词读盘上正文。
* 不传时退回出厂常量（纯函数单测用）。这一层不是为了好看——用户改过的内置技能
* 如果不进提示词，界面显示「已修改」而成员行为没变，AC-29 的「重启后读回」就成了假象。
*/
function composeSkillPrompt(role, bodyOf) {
	const parts = [];
	const missing = [];
	for (const skillId of role.skillIds) {
		const resolved = bodyOf === void 0 ? void 0 : bodyOf(skillId);
		const body = resolved !== void 0 && resolved.trim() !== "" ? resolved : builtinSkillBody(skillId);
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
*  - 2 = r7：内置角色带 `prompt`；
*  - 3 = r10：内置角色从 6 个扩到 11 个（多出来的 5 个由 seed 直接落地，老文件不动）。
*
* 版本号只升不降：`seed()` 在 `schemaOf() < ROLES_SCHEMA_VERSION` 时才走 backfill，
* 升到 3 就是为了让既有安装也补一次新字段/新角色，而不是只对全新安装生效。
*/
const ROLES_SCHEMA_VERSION = 3;
/** 补齐标记文件名：**不带 .json**，避免被 list()/restoreDefaults() 的 `*.json` 扫描当成角色。 */
const SEED_MARKER = ".seeded";
function createRoleRepo(deps) {
	const { dir, now } = deps;
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
		* 首次启动把内置角色落盘（已存在的不覆盖，保护用户编辑）。
		*
		* 升级路径（QA-R7-01）：老版本落盘的文件虽然存在，但可能缺本轮新增的字段
		* （r7 的 `prompt`）。这类文件**只补缺席的键**，且补齐只做一次 ——
		* 标记 `.seeded` 落盘后不再补，否则用户「清空提示词」会被下次启动悄悄复活。
		*
		* r10：技能 md 的 seed 已迁到 `roles/skills-repo.ts#seed`（那里还要处理
		* 「老文件缺 frontmatter 只前置、正文零改动」），本函数**不再写任何技能文件**。
		*/
		seed() {
			mkdirSync(dir, { recursive: true });
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
// src/host/roles/skills-repo.ts
/**
* 技能 md 仓储（r10 AC-19/AC-20）：`<home>/.dsh/auto-team/skills/<id>.md` 一技能一文件。
*
* 为什么技能要**独立于角色**（而不是塞进 roles/repo.ts）：
*  - 角色的落盘策略是「JSON + 内置铺底 + 缺键补齐」，技能是「md + frontmatter + 四来源 + 覆盖层语义」，
*    两套写盘策略塞在一个文件里必然互相纠缠；
*  - 独立后可以用 mkdtemp 单测全部落盘语义（seed 三态 / 撞名 / 拒删 / 恢复出厂），不依赖宿主。
*
* 三条硬语义（都有单测）：
*  1. `seed()` 只在**缺失**时写完整 md、只在**缺 frontmatter** 时前置 frontmatter，正文一个字节不动；
*  2. `modified` **不落盘**，由 `sha256(正文) ≠ sha256(出厂正文)` 现算 —— 所以用户改过的内置技能
*     迁移后标记天然正确，也不会因为漏写标记而长出假状态；
*  3. `builtin` 只由 `BUILTIN_SKILLS` 判定（磁盘写 `source: builtin` 也不算），因此「内置不可删」
*     不会因为手改 md 被绕过。
*/
/** 技能 id 形态（与角色 id 同构：小写字母/数字/连字符，≤32 字）。 */
const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** legacy（无 frontmatter）文件派生说明时的截断长度。 */
const LEGACY_DESCRIPTION_MAX = 60;
/** 四来源在清单里的排序权重（内置永远在前，用户三源按导入 → 系统 → 手写）。 */
const SOURCE_ORDER = {
	builtin: 0,
	imported: 1,
	system: 2,
	manual: 3
};
function createSkillRepo(deps) {
	const { dir, now } = deps;
	const warn = (message) => deps.warn?.(message);
	const pathOf = (id) => `${dir}/${id}.md`;
	const digest = (body) => createHash("sha256").update(normalizeText(body).trimEnd(), "utf8").digest("hex");
	const factoryRecord = (skill) => ({
		id: skill.id,
		title: skill.title,
		description: skill.description,
		body: skill.body,
		source: "builtin",
		modified: false,
		updatedAt: 0
	});
	/** 解析结果 → 仓储记录（`modified` 在这里现算，是全局唯一的计算点）。 */
	const toRecord = (parsed) => ({
		id: parsed.id,
		title: parsed.title,
		description: parsed.description,
		body: parsed.body,
		source: parsed.source,
		modified: parsed.source === "builtin" ? digest(parsed.body) !== digest(builtinSkillBody(parsed.id)) : false,
		updatedAt: parsed.updatedAt
	});
	const readOne = (id) => {
		const path = pathOf(id);
		if (!existsSync(path)) return void 0;
		try {
			return toRecord(parseSkillFile(`${id}.md`, readFileSync(path, "utf8")));
		} catch (error) {
			warn(`技能文件读取失败（${path}）：${messageOf$5(error)}`);
			return;
		}
	};
	const write = (record) => {
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(pathOf(record.id), renderSkillFile(record), "utf8");
			return { data: record };
		} catch (error) {
			return { error: `技能保存失败（${record.id}）：${messageOf$5(error)}` };
		}
	};
	const list = () => {
		const onDisk = /* @__PURE__ */ new Map();
		if (existsSync(dir)) {
			let entries = [];
			try {
				entries = readdirSync(dir);
			} catch (error) {
				warn(`技能目录读取失败（${dir}）：${messageOf$5(error)}`);
			}
			for (const name of entries) {
				if (!name.toLowerCase().endsWith(".md")) continue;
				try {
					const parsed = parseSkillFile(name, readFileSync(`${dir}/${name}`, "utf8"));
					onDisk.set(parsed.id, toRecord(parsed));
				} catch (error) {
					warn(`技能文件跳过（${name}）：${messageOf$5(error)}`);
				}
			}
		}
		const builtins = BUILTIN_SKILLS.map((skill) => onDisk.get(skill.id) ?? factoryRecord(skill));
		const others = [...onDisk.values()].filter((record) => !isBuiltinSkill(record.id)).sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.title.localeCompare(b.title, "zh-Hans-CN"));
		return [...builtins, ...others].slice(0, 200);
	};
	/**
	* 新建技能时按标题派生不撞名的 id：撞了就 `-2`/`-3`…，并避开出厂内置 id。
	*
	* 只在 `draft.id` 缺省（=新建）时用；更新永远走调用方给的 id（改标题不改 id，
	* 否则角色 `skillIds` 里的引用会变成悬空）。
	*/
	const uniqueIdFor = (base) => {
		if (!existsSync(pathOf(base)) && !isBuiltinSkill(base)) return base;
		const stem = base.slice(0, 28).replace(/-+$/, "") || "skill";
		for (let seq = 2; seq <= 999; seq += 1) {
			const candidate = `${stem}-${seq}`;
			if (!existsSync(pathOf(candidate)) && !isBuiltinSkill(candidate)) return candidate;
		}
		return `${stem}-${Math.floor(now() % 1e6)}`;
	};
	return {
		list,
		projection() {
			return list().map(({ id, title, description, source, modified }) => ({
				id,
				title,
				description,
				source,
				modified
			}));
		},
		get(id) {
			const record = readOne(id);
			if (record !== void 0) return record;
			const factory = BUILTIN_SKILLS.find((skill) => skill.id === id);
			return factory === void 0 ? void 0 : factoryRecord(factory);
		},
		readBody(id) {
			const record = readOne(id);
			if (record !== void 0) return { data: record.body };
			const factory = BUILTIN_SKILLS.find((skill) => skill.id === id);
			if (factory !== void 0) return { data: factory.body };
			return { error: `技能不存在：「${id}」` };
		},
		save(draft) {
			const title = (draft.title ?? "").trim();
			if (title === "") return { error: "技能标题不能为空" };
			if (title.length > 80) return { error: `技能标题最多 80 字（当前 ${title.length} 字）` };
			const body = normalizeText(draft.body ?? "").trimEnd();
			if (body.trim() === "") return { error: "技能正文不能为空" };
			if (body.length > 2e4) return { error: `技能正文最多 ${SKILL_BODY_MAX} 字（当前 ${body.length} 字）` };
			const given = (draft.description ?? "").trim();
			const description = given !== "" ? given : deriveDescription(body, title);
			if (description.length > 200) return { error: `技能说明最多 200 字（当前 ${description.length} 字）` };
			const requested = (draft.id ?? "").trim();
			let id;
			if (requested !== "") {
				if (!SKILL_ID_PATTERN.test(requested)) return { error: `技能 id 不合法：「${requested}」（只能小写字母/数字/连字符，首字符不能是连字符，最长 32 字）` };
				if (draft.source === "builtin" && !isBuiltinSkill(requested)) return { error: `不能新建内置技能：「${requested}」` };
				id = requested;
			} else {
				if (draft.source === "builtin") return { error: "内置技能必须带 id（不能凭标题新建内置技能）" };
				id = uniqueIdFor(slugifySkillTitle(title));
			}
			if (!isBuiltinSkill(id) && draft.source === "builtin") return { error: `不能新建内置技能：「${id}」` };
			const source = isBuiltinSkill(id) ? "builtin" : draft.source;
			return write({
				id,
				title,
				description,
				body,
				source,
				modified: source === "builtin" ? digest(body) !== digest(builtinSkillBody(id)) : false,
				updatedAt: now()
			});
		},
		remove(id) {
			if (isBuiltinSkill(id)) return { error: `内置技能不可删除：只能「恢复出厂」（${id}）` };
			if (!existsSync(pathOf(id))) return { error: `技能不存在：「${id}」` };
			const title = readOne(id)?.title ?? id;
			try {
				rmSync(pathOf(id));
			} catch (error) {
				return { error: `技能删除失败（${id}）：${messageOf$5(error)}` };
			}
			return { data: {
				id,
				title
			} };
		},
		restoreBuiltin(id) {
			const factory = BUILTIN_SKILLS.find((skill) => skill.id === id);
			if (factory === void 0) return { error: `只有内置技能可以恢复出厂：「${id}」` };
			return write(factoryRecord(factory));
		},
		restoreBuiltins() {
			const restored = [];
			for (const skill of BUILTIN_SKILLS) {
				if (write(factoryRecord(skill)).error !== void 0) continue;
				restored.push(skill.id);
			}
			return { restored };
		},
		/**
		* 覆盖层 seed（r10 AC-20 的**唯一保证点**），三态：
		*  - 文件缺失 → 写出完整 md（frontmatter + 出厂正文）；
		*  - 存在但缺 frontmatter（r7 落盘的老文件）→ **只前置 frontmatter，正文一个字节不动**；
		*  - 已有 frontmatter → 完全不碰（否则用户改过的正文会在重启时被复活）。
		*/
		seed() {
			try {
				mkdirSync(dir, { recursive: true });
			} catch (error) {
				warn(`技能目录创建失败（${dir}）：${messageOf$5(error)}`);
				return;
			}
			for (const skill of BUILTIN_SKILLS) {
				const path = pathOf(skill.id);
				if (!existsSync(path)) {
					const result = write(factoryRecord(skill));
					if (result.error !== void 0) warn(result.error);
					continue;
				}
				let text;
				try {
					text = readFileSync(path, "utf8");
				} catch (error) {
					warn(`技能文件读取失败（${path}）：${messageOf$5(error)}`);
					continue;
				}
				if (hasFrontmatter(text)) continue;
				const parsed = parseSkillFile(`${skill.id}.md`, text);
				const header = renderFrontmatter({
					id: skill.id,
					title: parsed.title,
					description: parsed.description,
					source: "builtin",
					updatedAt: 0
				});
				try {
					writeFileSync(path, `${header}${normalizeText(text)}`, "utf8");
				} catch (error) {
					warn(`技能 frontmatter 补齐失败（${path}）：${messageOf$5(error)}`);
				}
			}
		}
	};
}
/**
* 解析一个技能 md（frontmatter 只认 `id/title/description/source/updatedAt` 五个键）。
*
* 不引 yaml 解析器：frontmatter 是我们自己渲染的 5 行 `key: value`，行扫描既够用又不会
* 因为一个缩进错误把整份技能读没。缺 frontmatter（r7 老文件）时按正文派生：
* id = 文件名、title = 首个 `# ` 行、description = 首个非空非标题行、source 由出厂清单判定。
*/
function parseSkillFile(fileName, text) {
	const stem = fileName.replace(/\.md$/i, "");
	const split = splitFrontmatter(normalizeText(text));
	const meta = split.meta;
	const id = (meta.get("id") ?? "").trim() === "" ? stem : (meta.get("id") ?? "").trim();
	const factory = isBuiltinSkill(id);
	const heading = firstHeading(split.body);
	const title = field(meta, "title") ?? heading ?? stem;
	const description = field(meta, "description") ?? truncate(firstParagraph$1(split.body) ?? title, LEGACY_DESCRIPTION_MAX);
	const rawSource = field(meta, "source");
	const source = factory ? "builtin" : rawSource === "imported" || rawSource === "system" || rawSource === "manual" ? rawSource : "manual";
	const rawUpdatedAt = Number(field(meta, "updatedAt") ?? "");
	return {
		id,
		title,
		description,
		source,
		updatedAt: Number.isFinite(rawUpdatedAt) ? rawUpdatedAt : 0,
		body: split.body,
		hasFrontmatter: split.hasFrontmatter
	};
}
/** 渲染成落盘文本：frontmatter 五键顺序固定（便于人眼 diff 与 grep 断言）。 */
function renderSkillFile(record) {
	return `${renderFrontmatter(record)}${normalizeText(record.body).trimEnd()}\n`;
}
/**
* 标题 → id（小写、非 `[a-z0-9]` 折成连字符、压缩重复、截 32 字）。
*
* 中文标题会整段折成连字符，最终落成 `skill`/`skill-2` 这种可读性一般的 id；
* 这是刻意取舍：id 只用于文件名与引用，可读性由 `title` 承担，且 id 一旦落盘就不能再变
* （角色 `skillIds` 引用的是它）。
*/
function slugifySkillTitle(title) {
	const slug = (title ?? "").toLowerCase().normalize("NFKC").replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/g, "");
	return slug === "" ? "skill" : slug;
}
function normalizeText(text) {
	return (text ?? "").replace(/\r\n?/g, "\n");
}
function messageOf$5(error) {
	return error instanceof Error ? error.message : String(error);
}
function truncate(text, max) {
	const value = text.trim();
	return value.length <= max ? value : value.slice(0, max);
}
function field(meta, key) {
	const value = (meta.get(key) ?? "").trim();
	return value === "" ? void 0 : value;
}
/** frontmatter 的值必须单行（多行会破坏 `key: value` 解析）。 */
function oneLine(value) {
	return (value ?? "").replace(/\s*\n\s*/g, " ").trim();
}
function renderFrontmatter(record) {
	return [
		"---",
		`id: ${oneLine(record.id)}`,
		`title: ${oneLine(record.title)}`,
		`description: ${oneLine(record.description)}`,
		`source: ${record.source}`,
		`updatedAt: ${record.updatedAt}`,
		"---",
		""
	].join("\n");
}
function hasFrontmatter(text) {
	return /^---\r?\n/.test(text) && /^---\r?$/m.test(text.slice(4));
}
function splitFrontmatter(text) {
	const meta = /* @__PURE__ */ new Map();
	if (!/^---\r?\n/.test(text)) return {
		meta,
		body: text.trimEnd(),
		hasFrontmatter: false
	};
	const lines = text.split("\n");
	let end = -1;
	for (let index = 1; index < lines.length; index += 1) if (lines[index].trim() === "---") {
		end = index;
		break;
	}
	if (end === -1) return {
		meta,
		body: text.trimEnd(),
		hasFrontmatter: false
	};
	for (const line of lines.slice(1, end)) {
		const at = line.indexOf(":");
		if (at <= 0) continue;
		meta.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	return {
		meta,
		body: lines.slice(end + 1).join("\n").trimEnd(),
		hasFrontmatter: true
	};
}
function firstHeading(body) {
	for (const line of body.split("\n")) {
		const match = /^#{1,6}\s+(.+)$/.exec(line.trim());
		if (match !== null) return match[1].trim();
	}
}
function firstParagraph$1(body) {
	for (const line of body.split("\n")) {
		const value = line.trim().replace(/^[-*+]\s+/, "").trim();
		if (value === "" || value.startsWith("#")) continue;
		return value;
	}
}
function deriveDescription(body, fallback) {
	return truncate(firstParagraph$1(body) ?? fallback, LEGACY_DESCRIPTION_MAX);
}
// src/host/roles/system-skills.ts
/**
* 系统技能库（r10 AC-19）：只读扫描 `<home>/.agents/skills/<目录>/SKILL.md`。
*
* 为什么是扫目录而不是问宿主：**宿主没有 skills 服务**（`provide("skills")` 实测 0 命中），
* 没有可注入的读取口；`~/.agents/skills` 就是 DSH 技能库的约定落点（`skill_manage` 默认目录）。
*
* 三条自我约束：
*  - **只读**：这里绝不写任何文件（写进别人的库里等于污染宿主资产）；
*  - **单条坏文件跳过**：一条坏 SKILL.md 不能把整批扫描打成异常，更不能让面板连角色一起读不出来；
*  - **目录缺失给可读 reason**：`empty` 与「还没扫」在界面上必须长得不一样。
*/
const SKILL_FILE = "SKILL.md";
function createSystemSkillSource(deps) {
	const { dir } = deps;
	const warn = (message) => deps.warn?.(message);
	return { scan() {
		if (!existsSync(dir)) return {
			skills: [],
			reason: `本机没有系统技能库（${dir} 不存在）`
		};
		let entries = [];
		try {
			entries = readdirSync(dir);
		} catch (error) {
			return {
				skills: [],
				reason: `系统技能库不可读（${dir}）：${messageOf$4(error)}`
			};
		}
		const skills = [];
		for (const name of entries) {
			if (name.startsWith(".")) continue;
			const skillDir = `${dir}/${name}`;
			const file = `${skillDir}/${SKILL_FILE}`;
			if (!existsSync(file)) continue;
			let text;
			try {
				text = readFileSync(file, "utf8");
			} catch (error) {
				warn(`系统技能跳过（${file}）：${messageOf$4(error)}`);
				continue;
			}
			const parsed = parseSystemSkill(text);
			skills.push({
				name: parsed.name ?? name,
				description: parsed.description ?? firstParagraph(parsed.body) ?? name,
				body: parsed.body,
				dir: skillDir
			});
		}
		skills.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
		return { skills };
	} };
}
/** 取 frontmatter 的 `name` / `description`（没有 frontmatter 时都缺省，由调用方回退）。 */
function parseSystemSkill(text) {
	const normalized = (text ?? "").replace(/\r\n?/g, "\n");
	if (!/^---\n/.test(normalized)) return { body: normalized.trimEnd() };
	const lines = normalized.split("\n");
	let end = -1;
	for (let index = 1; index < lines.length; index += 1) if (lines[index].trim() === "---") {
		end = index;
		break;
	}
	if (end === -1) return { body: normalized.trimEnd() };
	const meta = /* @__PURE__ */ new Map();
	for (const line of lines.slice(1, end)) {
		const at = line.indexOf(":");
		if (at <= 0) continue;
		meta.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	const name = (meta.get("name") ?? "").trim();
	const description = (meta.get("description") ?? "").trim();
	return {
		name: name === "" ? void 0 : name,
		description: description === "" ? void 0 : description,
		body: lines.slice(end + 1).join("\n").trimEnd()
	};
}
function firstParagraph(body) {
	for (const line of body.split("\n")) {
		const value = line.trim().replace(/^[-*+]\s+/, "").trim();
		if (value === "" || value.startsWith("#")) continue;
		return value.length <= 60 ? value : value.slice(0, 60);
	}
}
function messageOf$4(error) {
	return error instanceof Error ? error.message : String(error);
}
// src/host/model-catalog.ts
/**
* 把一次原始读取结果压成面板要的 `ModelCatalogView`。
*
* 截断与 `reason` 的组合规则：**只要不是「全部读全了」，就必须给一句可读说明** ——
* 否则「只剩 120 条」与「本来就只有 120 条」在界面上无法区分。
*/
function toCatalogView(raw, limit = 120) {
	const options = [];
	for (const group of raw.groups) {
		for (const model of group.models) {
			options.push({
				provider: group.id,
				providerName: group.name,
				model: model.id,
				modelName: model.name
			});
			if (options.length >= limit) break;
		}
		if (options.length >= limit) break;
	}
	const total = raw.groups.reduce((sum, group) => sum + group.models.length, 0);
	const notes = [];
	if (raw.reason !== void 0 && raw.reason !== "") notes.push(raw.reason);
	if (raw.failures.length > 0) {
		const names = raw.failures.map((failure) => `${failure.name}（${failure.message}）`).join("、");
		notes.push(`部分来源读取失败：${names}`);
	}
	if (total > options.length) notes.push(`仅显示前 ${options.length} 个模型（共 ${total} 个）`);
	if (options.length === 0) return {
		status: "empty",
		options,
		reason: notes.join("；") || "宿主未提供任何可选模型"
	};
	return notes.length > 0 ? {
		status: "ready",
		options,
		reason: notes.join("；")
	} : {
		status: "ready",
		options
	};
}
function createModelCatalogCache(deps) {
	const limit = deps.limit ?? 120;
	const ttlMs = deps.ttlMs;
	let cached;
	/** 在飞的读取（并发 view()/refresh() 必须共用同一次宿主调用，否则轮询会打爆宿主）。 */
	let inFlight;
	const stale = (at) => deps.now() - at >= ttlMs;
	function refresh(force = false) {
		if (inFlight !== void 0) return inFlight;
		if (!force && cached !== void 0 && !stale(cached.at)) return Promise.resolve();
		inFlight = (async () => {
			try {
				const raw = await deps.read();
				cached = {
					at: deps.now(),
					view: toCatalogView(raw, limit)
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				cached = {
					at: deps.now(),
					view: {
						status: "empty",
						options: [],
						reason: `宿主模型清单读取失败：${message}`
					}
				};
			} finally {
				inFlight = void 0;
			}
		})();
		return inFlight;
	}
	function view() {
		if (cached === void 0) {
			refresh(true);
			return {
				status: "loading",
				options: []
			};
		}
		if (stale(cached.at)) refresh(true);
		return cached.view;
	}
	return {
		view,
		refresh
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
	if (!isRecord$2(raw)) return {
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
		if (isRecord$2(rawModel)) {
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
				warn(`settings.json 解析失败，回落缺省值：${describe$1(error)}`);
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
					reason: `写入设置失败：${describe$1(error)}`
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
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function describe$1(error) {
	return error instanceof Error ? error.message : String(error);
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
/** 动作名 → 允许表列名。 */
const KEY_OF = {
	cancel: "cancel",
	skip: "skip",
	"edit-acceptance": "acceptance"
};
Object.fromEntries(Object.keys(MATRIX).map((status) => {
	const row = MATRIX[status];
	return [status, {
		cancel: row.cancel.allow,
		skip: row.skip.allow,
		acceptance: row.acceptance.allow
	}];
}));
function cellOf(action, status) {
	const row = MATRIX[status];
	if (row === void 0) return null;
	return row[KEY_OF[action]] ?? null;
}
/**
* 该状态下这个动作允许吗。
*
* 未知状态一律不允许（旧 run 文件里出现没见过的状态时，宁可拒绝也不放行一个会改状态的写操作）。
*/
function taskActionAllowed(action, status) {
	return cellOf(action, status)?.allow === true;
}
/**
* 禁用原因（中文，逐字来自 DESIGN §3.4）。允许时返回空串——调用方据此决定要不要挂 `title`。
*/
function taskActionDisabledReason(action, status) {
	const cell = cellOf(action, status);
	if (cell === null) return `未知任务状态「${String(status)}」不允许该动作`;
	return cell.allow ? "" : cell.reason;
}
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
// src/host/plan/scope.ts
/** 视为「正占着写域」的状态：running 与它的门禁子阶段 gate。 */
const HOLDER_STATUSES$2 = /* @__PURE__ */ new Set(["running", "gate"]);
function fail(code, detail) {
	return {
		ok: false,
		error: `${code}：${detail}`
	};
}
/** `describe` 只用于错误文案：把任意值渲染成短小的可读形式。 */
function describe(value) {
	if (typeof value === "string") return `「${value}」`;
	if (value === null) return "null";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return "数组";
	return typeof value;
}
/**
* 单条写域归一（TECHNICAL §3.1）：`\` → `/`、折叠 `//`、去 `./` 前缀、去尾 `/`。
*
* 拒绝三类非法输入（AC-12）：空串元素 / 绝对路径（`/x` 或 `C:`）/ 含 `..` 段（会逃出仓库根）。
* 归一后必须是「相对仓库根」的路径——所以 `去首 /` 与「拒绝绝对路径」不并存，
* 以 AC-12 的显式列举为准：绝对路径一律拒绝，而不是悄悄剁掉前导斜杠。
*/
function normalizeOne(raw) {
	if (typeof raw !== "string") return fail("WRITE_SCOPE_TYPE", `写域元素必须是字符串（收到 ${describe(raw)}）`);
	const trimmed = raw.trim();
	if (trimmed === "") return fail("WRITE_SCOPE_EMPTY", "写域里不能有空串元素");
	let path = trimmed.replace(/\\/g, "/");
	if (path.startsWith("/")) return fail("WRITE_SCOPE_ABSOLUTE", `写域必须是相对仓库根的路径，不能是绝对路径（收到 ${describe(raw)}）`);
	if (/^[A-Za-z]:(\/|$)/.test(path)) return fail("WRITE_SCOPE_ABSOLUTE", `写域不能是盘符路径（收到 ${describe(raw)}）`);
	path = path.replace(/\/{2,}/g, "/");
	while (path.startsWith("./")) path = path.slice(2);
	path = path.replace(/\/+$/, "");
	if (path === "" || path === ".") return fail("WRITE_SCOPE_EMPTY", `写域不能是仓库根本身（收到 ${describe(raw)}）`);
	const segments = path.split("/");
	if (segments.some((segment) => segment === "..")) return fail("WRITE_SCOPE_ESCAPE", `写域不能含 ".." 逃出仓库根（收到 ${describe(raw)}）`);
	if (segments.some((segment) => segment === "")) return fail("WRITE_SCOPE_EMPTY", `写域里有空的路径段（收到 ${describe(raw)}）`);
	return {
		ok: true,
		scope: path
	};
}
/**
* 归一一批写域：`undefined`/`null` → 空数组（= 不限，不参与互斥）。
*
* 结果**去重并按字典序排序**——排序让「同内容不同顺序」得到同一个数组，
* 追加任务的内容指纹（AC-9 幂等）才稳定。
*/
function normalizeWriteScopes(input) {
	if (input === void 0 || input === null) return {
		ok: true,
		scopes: []
	};
	if (!Array.isArray(input)) return fail("WRITE_SCOPE_TYPE", `写域必须是字符串数组（收到 ${describe(input)}）`);
	const seen = /* @__PURE__ */ new Set();
	for (const raw of input) {
		const one = normalizeOne(raw);
		if (!one.ok) return one;
		seen.add(one.scope);
	}
	return {
		ok: true,
		scopes: [...seen].sort()
	};
}
/**
* 两条写域是否冲突（AC-13）：相等，或一方是另一方的**目录边界**前缀。
*
* 反例（必测）：`src/host` 与 `src/hostile.ts` 不冲突 —— 裸 `startsWith` 会误判成冲突，
* 于是两个毫不相干的任务被串行化，症状是「并发莫名其妙变成 1」。
*/
function scopesConflict(a, b) {
	const left = String(a ?? "").trim().replace(/\/+$/, "");
	const right = String(b ?? "").trim().replace(/\/+$/, "");
	if (left === "" || right === "") return false;
	if (left === right) return true;
	return right.startsWith(`${left}/`) || left.startsWith(`${right}/`);
}
/**
* 持有者的哪些路径挡住了目标写域（按 holder 的声明顺序返回，去重）。
*
* 返回值用于两件事：判定要不要等（非空即冲突），以及把**冲突的那条路径**写进等待原因
* （「等待 t2 释放 src/host/bridge.ts」——面板据此逐字显示）。
*/
function conflictingScopes(holder, target) {
	const conflicts = [];
	const seen = /* @__PURE__ */ new Set();
	for (const held of holder) {
		const path = String(held ?? "").trim();
		if (path === "" || seen.has(path)) continue;
		if (target.some((candidate) => scopesConflict(path, candidate))) {
			seen.add(path);
			conflicts.push(path);
		}
	}
	return conflicts;
}
/** 任务写域（容错：脏数据里的非字符串直接丢弃，不抛异常）。 */
function scopesOf$3(task) {
	const scopes = [];
	const seen = /* @__PURE__ */ new Set();
	for (const raw of task.writeScopes ?? []) {
		if (typeof raw !== "string") continue;
		const scope = raw.trim();
		if (scope === "" || seen.has(scope)) continue;
		seen.add(scope);
		scopes.push(scope);
	}
	return scopes;
}
/**
* 等待原因（AC-14 逐字样例）：「等待 t2 释放 src/host/bridge.ts」。
*
* 这是**宿主生成**的中文，客户端必须原样渲染（零拼装）；改这里就等于改面板文案，
* 所以只写一句话、不带标点之外的修饰。
*/
function waitReasonOf(holderTaskId, path) {
	return `等待 ${holderTaskId} 释放 ${path}`;
}
/** 任务 → 成员名（优先取未 retired 的绑定；绑定缺失时不猜 memberId，留给调用方显示「未派成员」）。 */
function memberNamesOf(bindings) {
	const names = /* @__PURE__ */ new Map();
	for (const binding of bindings ?? []) {
		if (binding.retired === true) continue;
		const name = typeof binding.name === "string" ? binding.name.trim() : "";
		if (name === "") continue;
		if (!names.has(binding.taskId)) names.set(binding.taskId, name);
	}
	return names;
}
/**
* 由计划现算锁视图（AC-16/AC-19）：**没有锁表**，每次从 `status + writeScopes` 派生。
*
* 持有者 = `running`/`gate` 且写了非空写域；等待者 = `waiting` 且与持有路径冲突。
* 同一路径上的多个等待者合进同一条（`waiters` 数组），面板不重复渲染路径行。
*/
function deriveScopeLocks(tasks, bindings) {
	const members = memberNamesOf(bindings);
	const holders = tasks.filter((task) => HOLDER_STATUSES$2.has(task.status) && scopesOf$3(task).length > 0);
	if (holders.length === 0) return [];
	const waiters = tasks.filter((task) => task.status === "waiting");
	const views = [];
	for (const holder of holders) {
		const holderMember = members.get(holder.id);
		for (const path of scopesOf$3(holder)) {
			const row = {
				path,
				holderTaskId: holder.id,
				waiters: []
			};
			if (holderMember !== void 0) row.holderMember = holderMember;
			for (const waiter of waiters) {
				if (waiter.id === holder.id) continue;
				if (!scopesOf$3(waiter).some((scope) => scopesConflict(scope, path))) continue;
				const reason = typeof waiter.waitReason === "string" ? waiter.waitReason : "";
				const waiterRow = {
					taskId: waiter.id,
					reason: reason.trim() !== "" ? reason : waitReasonOf(holder.id, path)
				};
				const waiterMember = members.get(waiter.id);
				if (waiterMember !== void 0) waiterRow.member = waiterMember;
				row.waiters.push(waiterRow);
			}
			views.push(row);
		}
	}
	return views;
}
// src/host/plan/acceptance.ts
/**
* 验收命令模板（r11 F2）：三条可执行模板 + 建议命令选择 + 空验收的错误文案。
*
* 三条模板的**原文只此一份**（`ACCEPTANCE_TEMPLATES`），工具提示、空验收拒绝文案、
* `runGate` 的空命令证据尾部三处都从这里取（`ACCEPTANCE_TEMPLATE_BLOCK`）。
* 复制第二份的后果：AC-4「模板可直接执行」与 AC-7「旧句逐字在前、模板随后」会互相打架。
*
* 反目标 4：模板里**禁止** `pnpm lint` —— 本仓没有 lint 脚本，给出必然失败的命令
* 等于把「验收永远红」写进产品。脚本名一律按 `typecheck → lint → test` 的顺序
* 从仓库真实的 `package.json` scripts 里挑第一个存在的。
*/
/**
* 三条模板原文（逐字，不可改写；尖括号是占位符，不是 Markdown）。
*
* 1. 改代码型：跑仓库已有的脚本（本仓解析为 `pnpm typecheck`）。
* 2. 存在性型：某个标识符必须真的出现在范围内（命中 exit 0）。
* 3. 范围型：这些路径必须有未提交改动（`test -n` 判别空输出）。
*/
const ACCEPTANCE_TEMPLATES = [
	"pnpm typecheck",
	"grep -RIn --fixed-strings '<标识符>' <scope> >/dev/null",
	"test -n \"$(git status --porcelain -- <路径>)\""
];
/**
* 三条模板的展示块（工具提示 / 拒绝文案 / 门禁证据尾部共用）。
*
* 开头一句人话解释「exit 0 才算过」，因为工具调用者（模型）最容易在这里犯的错
* 是把「我检查过了」写进 acceptance —— 那不是命令。
*/
const ACCEPTANCE_TEMPLATE_BLOCK = ["可直接抄的验收模板（把尖括号换成实际值，命令 exit 0 才算过）：", ...ACCEPTANCE_TEMPLATES.map((template, index) => `${index + 1}. ${template}`)].join("\n");
/** 选脚本的固定顺序：先类型检查，再 lint（本仓没有），最后才是测试。 */
const SCRIPT_PREFERENCE = [
	"typecheck",
	"lint",
	"test"
];
/** 写域（容错：拒绝/脏输入时退化成「只保留非空字符串」，建议阶段不该因为写域脏而崩）。 */
function scopesOf$2(input) {
	const normalized = normalizeWriteScopes(input.writeScopes ?? []);
	if (normalized.ok) return normalized.scopes;
	const scopes = [];
	for (const raw of input.writeScopes ?? []) {
		if (typeof raw !== "string") continue;
		const scope = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
		if (scope !== "" && scope !== ".") scopes.push(scope);
	}
	return scopes;
}
/** 仓库真实存在的第一个偏好脚本名（缺省 null = 一个都没有）。 */
function scriptOf(input) {
	const scripts = new Set((input.scripts ?? []).filter((name) => typeof name === "string"));
	for (const name of SCRIPT_PREFERENCE) if (scripts.has(name)) return name;
	return null;
}
/**
* 从标题/描述里取一个反引号标识符（AC-4 第 ② 类）。
*
* 只接受能安全放进单引号里的标识符：含 `'` 的会破坏 shell 引号，直接跳过这条路
* （选不出就退回模板 ③ / `command: null`，绝不给出跑不起来的命令）。
*/
function identifierOf(input) {
	const text = `${input.title ?? ""}\n${input.description ?? ""}`;
	const pattern = /`([^`\n]+)`/g;
	let match = pattern.exec(text);
	while (match !== null) {
		const identifier = (match[1] ?? "").trim();
		if (identifier !== "" && !identifier.includes("'")) return identifier;
		match = pattern.exec(text);
	}
	return null;
}
/** 选不出时的原因：含「选不出」三字 + 三条模板原文 + 该补的参数名（AC-5 逐字判据）。 */
function noCommandReason() {
	return [
		"选不出可直接执行的验收命令（不要写「人工检查」「请确认」这类非命令）。",
		"三条模板原文：",
		ACCEPTANCE_TEMPLATE_BLOCK,
		"需要补的参数（任选一条即可）：标识符（用反引号包起来）、路径（writeScopes）、脚本名（package.json 的 scripts）。"
	].join("\n");
}
/**
* 给任务建议一条**可直接执行**的验收命令（AC-4）。
*
* 选择顺序固定（确定性、无随机）：
*  ① 有写域且仓库有 typecheck/lint/test 脚本 → `pnpm <script>`；
*  ② 标题/描述里有反引号标识符 → `grep -RIn --fixed-strings '<标识符>' <scope> >/dev/null`；
*  ③ 有写域但没有标识符 → `test -n "$(git status --porcelain -- <路径>)"`；
*  ④ 都不满足 → `command: null` + 「选不出」原因。
*/
function suggestAcceptance(input) {
	const scopes = scopesOf$2(input);
	const script = scriptOf(input);
	if (scopes.length > 0 && script !== null) return {
		command: `pnpm ${script}`,
		reason: `改代码型：用仓库已有的 ${script} 脚本当门禁（本仓解析为 pnpm ${script}）。`,
		template: ACCEPTANCE_TEMPLATES[0]
	};
	const identifier = identifierOf(input);
	if (identifier !== null) {
		const scope = scopes[0] ?? ".";
		return {
			command: `grep -RIn --fixed-strings '${identifier}' ${scope} >/dev/null`,
			reason: `存在性型：要求「${identifier}」在 ${scope} 下真的存在（grep 命中才 exit 0）。`,
			template: ACCEPTANCE_TEMPLATES[1]
		};
	}
	if (scopes.length > 0) return {
		command: `test -n "$(git status --porcelain -- ${scopes.join(" ")})"`,
		reason: `范围型：要求 ${scopes.join("、")} 有未提交改动（空输出时 test 失败）。`,
		template: ACCEPTANCE_TEMPLATES[2]
	};
	return {
		command: null,
		reason: noCommandReason(),
		template: ACCEPTANCE_TEMPLATE_BLOCK
	};
}
/**
* 空验收（`acceptance` 为空白字符串）时的整批拒绝文案（AC-6）。
*
* 结构固定：**结论一句**（列出违规任务 id + 标题）→ 每个任务的可抄命令（能自动选中时）→
* 三条模板原文。任务入口在 `save` 之前用它拦截，所以这段文案是模型唯一能看到的东西，
* 必须自带「抄什么、还缺什么」。
*/
function emptyAcceptanceError(violations, suggestions) {
	const lines = [`拒绝：以下任务的验收命令为空（acceptance 不能是空白字符串）：${violations.map((violation) => violation.id).join("、")}`];
	for (const violation of violations) {
		const title = typeof violation.title === "string" ? violation.title.trim() : "";
		const label = title === "" ? violation.id : `${violation.id}（${title}）`;
		const suggestion = suggestions?.get(violation.id);
		if (suggestion !== void 0 && suggestion.command !== null && suggestion.command !== "") lines.push(`  - ${label}：可直接抄 ${suggestion.command}`);
		else lines.push(`  - ${label}：补上写域或反引号标识符后可以自动生成命令`);
	}
	lines.push(ACCEPTANCE_TEMPLATE_BLOCK);
	return lines.join("\n");
}
/**
* 空验收时的完整证据尾部：旧句**逐字在最前**，随后追加三条可执行模板（AC-4/AC-7）。
*
* 模板原文只有 `ACCEPTANCE_TEMPLATE_BLOCK` 一份来源（工具提示、拒绝文案、门禁三处共用），
* 这里只做拼接 —— 复制第二份就会让「逐字断言」在第一次改模板时互相打架。
*/
const EMPTY_ACCEPTANCE_TAIL = `该任务没有验收命令，需要人工确认后放行\n${ACCEPTANCE_TEMPLATE_BLOCK}`;
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
// src/host/format.ts
/** 取不到时的统一文案：三处（token / 用时 / 记忆）都用它，界面不必再各写一份。 */
const UNAVAILABLE_TEXT = "不可得";
/** 数字是否可用于格式化（有限、非负）。`0` 合法 —— 「花了 0 token」是真话，不是缺失。 */
function usableNumber(value) {
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
	if (!usableNumber(ms)) return UNAVAILABLE_TEXT;
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
/**
* 归一后的用量单元格（AC-19）：有可用合计 → `provider`（含 `0`），否则 → `unavailable`。
*
* `reason` 是被展示给人看的「为什么拿不到」，调用方必须给一句人话（如「该成员未上报用量」）。
*/
function usageCellOf(totals, reason) {
	if (!totals || !usableNumber(totals.total)) return {
		source: "unavailable",
		reason
	};
	const tokens = { total: Math.round(totals.total) };
	if (usableNumber(totals.input)) tokens.input = Math.round(totals.input);
	if (usableNumber(totals.output)) tokens.output = Math.round(totals.output);
	return {
		source: "provider",
		tokens
	};
}
/**
* 归一后的用时单元格（AC-20）：四态互斥，`text` 已算好。
*
* `not-started` / `unavailable` 是**状态**而不是数字 0 —— 界面靠 `state` 区分
* 「还没开始」与「开始但 0 秒」，混用会让人以为任务已经跑过。
*/
function durationCellOf(input) {
	if (input.state === "not-started") return {
		state: "not-started",
		text: "未开始"
	};
	if (input.state === "unavailable") return {
		state: "unavailable",
		text: UNAVAILABLE_TEXT
	};
	const startAt = usableNumber(input.startAt) ? input.startAt : void 0;
	if (startAt === void 0) return {
		state: "unavailable",
		text: UNAVAILABLE_TEXT
	};
	const endAt = usableNumber(input.endAt) ? input.endAt : input.state === "running" ? input.now : void 0;
	if (endAt === void 0) return {
		startAt,
		state: "unavailable",
		text: UNAVAILABLE_TEXT
	};
	const ms = Math.max(0, endAt - startAt);
	return {
		startAt,
		endAt,
		ms,
		text: formatDuration(ms),
		state: usableNumber(input.endAt) ? "done" : "running"
	};
}
/** 记忆 token 估算：`ceil(chars/2)`（AC-20 口径；UI 必须带 `≈` 前缀，本文不负责前缀）。 */
function memoryTokenEstimate(chars) {
	if (!usableNumber(chars)) return 0;
	return Math.ceil(chars / 2);
}
/**
* 「已等待 N 分」文案（AC-13）：未决确认不设 TTL，每次快照按 `now` 重算。
*
* 不落盘保存文本 —— 落盘就会在进程重启后停止走动，看起来像「永远卡在 3 分」。
*/
function waitedTextOf(createdAt, now) {
	const elapsed = now - createdAt;
	if (!Number.isFinite(elapsed) || elapsed < 6e4) return "刚刚";
	const minutes = Math.floor(elapsed / 6e4);
	if (minutes < 60) return `已等待 ${minutes} 分`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `已等待 ${hours} 小时` : `已等待 ${hours} 小时 ${rest} 分`;
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
/**
* 目录 → 记忆索引（r13 AC-17：左栏项目页与右栏记忆页**共用**这一份，禁止各写一份扫描）。
*
* token 只能是**估算**：记忆是用户手写的 md，宿主没有 provider 的 tokenizer，
* 因此按 `ceil(chars/2)`（`format.memoryTokenEstimate` 单点）并强制带 `tokenBasis:'estimate'`，
* 界面必须显示 `≈`。这里不返回正文 —— 索引进快照，正文点开时再读（否则每次轮询拖几十 KB）。
*
* 排序：`updatedAt` 倒序（最近改过的在前），同毫秒按文件名稳序，保证快照可复现。
*/
function listMemoryItems(dir, track) {
	if (!existsSync(dir)) return [];
	const out = [];
	for (const entry of readdirSync(dir)) {
		const name = safeMemoryName(entry);
		if (name === null || name !== entry) continue;
		const path = `${dir}/${entry}`;
		let stat;
		let body;
		try {
			stat = statSync(path);
			if (!stat.isFile()) continue;
			body = readFileSync(path, "utf8");
		} catch {
			continue;
		}
		const item = {
			track,
			name,
			title: memoryTitleOf(body, name),
			updatedAt: stat.mtimeMs,
			tokenEstimate: memoryTokenEstimate(body.length),
			tokenBasis: "estimate"
		};
		if (Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0) item.createdAt = stat.birthtimeMs;
		out.push(item);
	}
	return out.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}
/**
* 记忆标题：优先正文里的第一个 `# 标题`，否则退化成文件名（去 `.md`）。
*
* 不取正文首行：本项目的记忆首行通常是 `- [pm/t2 · 10-30 14:02] …` 来源标注，
* 拿它当标题会出现一列以「- [」开头的条目，等于没标题。
*/
function memoryTitleOf(body, fileName) {
	for (const line of body.split("\n").slice(0, 20)) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) {
			const heading = trimmed.replace(/^#+\s*/, "").trim();
			if (heading !== "") return heading;
		}
	}
	return fileName.replace(/\.md$/i, "");
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
/**
* 依赖是否已满足 —— 全仓唯一判定口（AC-26「skipped 视为依赖满足」）。
*
* - skipped 满足：用户显式跳过一条任务，语义就是「不再执行它、下游照常推进」；
* - cancelled 不满足：取消的语义是「这条做不了了」，下游留在 blocked 由人决定；
* - done 满足；其余（pending/running/...）都不满足。
*
* 为什么必须是函数：dispatch 的下游解锁、readyTasks、blockedTasks 三处都要判，
* 各写一遍 `status === 'done'` 的话，第一次改语义（加 skipped）就会分叉。
*/
function depSatisfied(status) {
	return status === "done" || status === "skipped";
}
/** 可派发集合：自身状态为 pending/ready/rework，且所有依赖都已满足。 */
function readyTasks(tasks) {
	const satisfiedIds = new Set(tasks.filter((task) => depSatisfied(task.status)).map((task) => task.id));
	return tasks.filter((task) => task.status === "pending" || task.status === "ready" || task.status === "rework").filter((task) => (task.dependsOn ?? []).every((dep) => satisfiedIds.has(dep))).map((task) => task.id);
}
/** 被阻塞集合 → 阻挡它的未满足依赖列表。 */
function blockedTasks(tasks) {
	const satisfiedIds = new Set(tasks.filter((task) => depSatisfied(task.status)).map((task) => task.id));
	return tasks.filter((task) => task.status === "pending" || task.status === "ready" || task.status === "rework").map((task) => ({
		id: task.id,
		waitingOn: (task.dependsOn ?? []).filter((dep) => !satisfiedIds.has(dep))
	})).filter((entry) => entry.waitingOn.length > 0);
}
// src/host/plan/plan.ts
/** 写域轻量清洗：去空、去重，保持声明顺序（边界归一在 plan/scope.ts，这里保持宽容）。 */
function scopesOf$1(input) {
	const seen = /* @__PURE__ */ new Set();
	const scopes = [];
	for (const raw of input ?? []) {
		const scope = String(raw ?? "").trim();
		if (scope === "" || seen.has(scope)) continue;
		seen.add(scope);
		scopes.push(scope);
	}
	return scopes;
}
/** 校验草稿并统一成 Plan；失败返回中文原因（面板与工具都直接展示）。 */
function buildPlan(draft, runId, now) {
	const tasks = draft.tasks.map((task, index) => {
		const writeScopes = scopesOf$1(task.writeScopes);
		const built = {
			id: (task.id ?? "").trim() === "" ? `t${index + 1}` : task.id.trim(),
			title: task.title.trim(),
			roleId: task.roleId.trim(),
			dependsOn: [...new Set(task.dependsOn ?? [])],
			acceptance: (task.acceptance ?? "").trim(),
			status: "pending"
		};
		if (writeScopes.length > 0) built.writeScopes = writeScopes;
		return built;
	});
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
	const goal = (draft.goal ?? "").trim();
	const plan = {
		runId,
		sessionId: draft.sessionId,
		createdAt: now,
		status: "draft",
		tasks,
		maxConcurrent
	};
	if (goal !== "") plan.goal = goal;
	return {
		ok: true,
		plan
	};
}
/** 进度口径：done / 全部任务。0 任务返回 0，避免除零显示 NaN。 */
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
/**
* 任务内容指纹：判「这条追加任务是不是已经存在」。
*
* 归一规则：标题/角色/验收去首尾空白；依赖与写域去重后排序（声明顺序不影响语义）。
* 刻意**不含** id 与 status —— 同一件事换个 id 写第二遍仍然算重复。
*/
function taskFingerprint(task) {
	return JSON.stringify({
		title: (task.title ?? "").trim(),
		roleId: (task.roleId ?? "").trim(),
		dependsOn: [...new Set(task.dependsOn ?? [])].sort(),
		acceptance: (task.acceptance ?? "").trim(),
		writeScopes: [...new Set(task.writeScopes ?? [])].sort()
	});
}
/** 已收口（不可再追加）的计划状态。 */
const CLOSED_PLAN_STATUSES = /* @__PURE__ */ new Set(["terminated", "cancelled"]);
/**
* 续派：往已存在的计划里追加一批任务（同一个 runId，AC-11）。
*
* 三条硬约束：
*  1. **原子**：先把整批构造完、用 validateGraph 全量校验（含跨批依赖），任一条不合法则整批不落；
*  2. **幂等**：内容指纹已存在的条目进 skipped，不重复追加、不改动已有任务；
*  3. **不重排**：新任务追加在末尾，id 从 `t<next>` 递增（跳过已被占用的编号），中途不重编号。
*
* 追加出来的任务一律 status='pending'：写域与依赖由 dispatch 在派发时判定。
*/
function extendPlan(plan, inputs, now) {
	if (CLOSED_PLAN_STATUSES.has(plan.status)) return {
		ok: false,
		reason: `计划${plan.status === "cancelled" ? "已取消" : "已终止"}，不能再追加任务（请开新的计划）`
	};
	const taken = new Set(plan.tasks.map((task) => task.id));
	let nextIndex = 1;
	for (const id of taken) {
		const matched = /^t(\d+)$/.exec(id);
		if (matched) nextIndex = Math.max(nextIndex, Number(matched[1]) + 1);
	}
	const known = /* @__PURE__ */ new Map();
	for (const task of plan.tasks) known.set(taskFingerprint(task), task.id);
	const added = [];
	const skipped = [];
	const candidates = [];
	const allocate = () => {
		let id = `t${nextIndex}`;
		nextIndex += 1;
		while (taken.has(id)) {
			id = `t${nextIndex}`;
			nextIndex += 1;
		}
		return id;
	};
	for (const [index, input] of inputs.entries()) {
		const title = (input.title ?? "").trim();
		const roleId = (input.roleId ?? "").trim();
		if (title === "") return {
			ok: false,
			reason: `第 ${index + 1} 条追加任务没有标题`
		};
		if (roleId === "") return {
			ok: false,
			reason: `第 ${index + 1} 条追加任务（${title}）未指定角色`
		};
		const fingerprint = taskFingerprint(input);
		if (known.has(fingerprint)) {
			skipped.push((input.id ?? "").trim() === "" ? title : input.id.trim());
			continue;
		}
		const id = (input.id ?? "").trim() === "" ? allocate() : input.id.trim();
		if (taken.has(id)) return {
			ok: false,
			reason: `追加任务的 id 与已有任务重复：${id}`
		};
		const writeScopes = scopesOf$1(input.writeScopes);
		const task = {
			id,
			title,
			roleId,
			dependsOn: [...new Set(input.dependsOn ?? [])],
			acceptance: (input.acceptance ?? "").trim(),
			status: "pending"
		};
		if (writeScopes.length > 0) task.writeScopes = writeScopes;
		taken.add(id);
		known.set(fingerprint, id);
		candidates.push(task);
		added.push(id);
	}
	if (candidates.length === 0) return {
		ok: true,
		plan,
		added,
		skipped
	};
	const merged = [...plan.tasks, ...candidates];
	const check = validateGraph(merged.map((task) => ({
		id: task.id,
		dependsOn: task.dependsOn
	})));
	if (!check.ok) return {
		ok: false,
		reason: check.reason
	};
	return {
		ok: true,
		plan: {
			...plan,
			tasks: merged
		},
		added,
		skipped
	};
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
// src/host/team/scope-locks.ts
/** 视为持锁的状态：running 与它的门禁子阶段 gate。 */
const HOLDER_STATUSES$1 = /* @__PURE__ */ new Set(["running", "gate"]);
function scopesOf(task) {
	const seen = /* @__PURE__ */ new Set();
	const scopes = [];
	for (const raw of task.writeScopes ?? []) {
		const scope = String(raw ?? "").trim();
		if (scope === "" || seen.has(scope)) continue;
		seen.add(scope);
		scopes.push(scope);
	}
	return scopes;
}
/** 当前持锁者（按计划顺序，只含 running|gate 且写域非空的任务）。 */
function scopeHoldersOf(state) {
	const bindings = state.bindings ?? [];
	const holders = [];
	for (const task of state.plan.tasks) {
		if (!HOLDER_STATUSES$1.has(task.status)) continue;
		const scopes = scopesOf(task);
		if (scopes.length === 0) continue;
		const binding = bindings.find((entry) => entry.taskId === task.id && !entry.retired);
		const holder = {
			taskId: task.id,
			scopes
		};
		if (binding && binding.name.trim() !== "") holder.member = binding.name;
		holders.push(holder);
	}
	return holders;
}
/** 任务与某个持有者是否冲突；返回冲突路径（已排序，取第一条做文案）。 */
function firstConflict(holders, task) {
	const scopes = scopesOf(task);
	if (scopes.length === 0) return null;
	for (const holder of holders) {
		if (holder.taskId === task.id) continue;
		const hits = conflictingScopes(holder.scopes, scopes);
		if (hits.length === 0) continue;
		return {
			holderTaskId: holder.taskId,
			path: hits.slice().sort()[0]
		};
	}
	return null;
}
/**
* 派发前判定：这条任务现在能不能起人。
*
* `claimed` 是本轮刚 spawn 的任务 id（状态可能还没在快照里体现，作为兜底口径）；
* 正常情况下它们已是 running，`scopeHoldersOf` 已经覆盖，所以这里只做二次确认。
*/
function waitFor(state, task, claimed = []) {
	const hit = firstConflict(scopeHoldersOf(state), task);
	if (hit) return hit;
	const scopes = scopesOf(task);
	if (scopes.length === 0) return null;
	for (const id of claimed) {
		if (id === task.id) continue;
		const other = state.plan.tasks.find((entry) => entry.id === id);
		if (!other) continue;
		const hits = conflictingScopes(scopesOf(other), scopes);
		if (hits.length > 0) return {
			holderTaskId: other.id,
			path: hits.slice().sort()[0]
		};
	}
	return null;
}
/**
* 按当前持锁情况重算等待关系（幂等）：冲突者刷新 waitingOn/waitReason，无人冲突则 waiting → pending。
*
* 只在计划可派发（draft/dispatching）时由 dispatch 调用——暂停/终止的计划不允许被改状态。
* 刻意**不**把 pending/ready 任务转成 waiting：那样依赖没满足的任务也会显示「等待写域」，
* 面板会把 blocked 误读成 waiting，而且 waitReason 会随每轮重算漂移。
*/
function applyScopeWaits(state, now) {
	const holders = scopeHoldersOf(state);
	let changed = false;
	const tasks = state.plan.tasks.map((task) => {
		if (task.status !== "waiting") return task;
		const hit = firstConflict(holders, task);
		if (!hit) {
			changed = true;
			const revived = {
				...task,
				status: "pending"
			};
			delete revived.waitingOn;
			delete revived.waitReason;
			return revived;
		}
		const waitingOn = [hit.holderTaskId];
		const waitReason = waitReasonOf(hit.holderTaskId, hit.path);
		if ((task.waitingOn ?? []).length === 1 && task.waitingOn?.[0] === hit.holderTaskId && task.waitReason === waitReason) return task;
		changed = true;
		return {
			...task,
			waitingOn,
			waitReason
		};
	});
	if (!changed) return state;
	return {
		...state,
		plan: {
			...state.plan,
			tasks
		}
	};
}
/** 等待者的可寻址名字：优先未 retired 的绑定名，其次任意历史绑定，最后 `task:<id>`。 */
function waiterNameOf(state, waiter) {
	const bindings = state.bindings ?? [];
	const any = bindings.find((entry) => entry.taskId === waiter.id && !entry.retired) ?? bindings.find((entry) => entry.taskId === waiter.id);
	if (any) return {
		name: any.name,
		memberId: any.memberId
	};
	return { name: `task:${waiter.id}` };
}
/** 释放通知正文（AC-18：释放者任务 id + 释放的路径 + 「可以接着改」）。 */
function releaseMessageBody(holder, path, waiter) {
	return `${holder.id} 已结束并释放 ${path}，你可以接着改（任务 ${waiter.id}）。`;
}
/** 同一 (holder, waiter) 的释放序号：用于 `rel-<holder>-<waiter>-<seq>` 幂等键。 */
function nextReleaseSeq(messages, holderId, waiterId) {
	const prefix = `rel-${holderId}-${waiterId}-`;
	let max = 0;
	for (const message of messages) {
		const id = message.messageId ?? "";
		if (!id.startsWith(prefix)) continue;
		const tail = Number(id.slice(prefix.length));
		if (Number.isFinite(tail) && tail > max) max = tail;
	}
	return max + 1;
}
/**
* 释放写域：给每个**真的在等这条任务**的等待者追加恰一条通知（AC-18）。
*
* 三个必须守住的点：
*  1. 只通知「写域与它真的冲突」且（未指定 waitingOn 或 waitingOn 含它）的等待者；
*  2. 幂等：messageId = `rel-<holder>-<waiter>-<seq>`，重复释放不会写第二条；
*  3. 只改消息账本，不改任务状态——等待者由 `applyScopeWaits` 放回 pending，
*     「状态权威、消息是通知」两边各管一件事，避免这里顺手把任务改活。
*/
function releaseScopes(state, holderTaskId, at) {
	const holder = state.plan.tasks.find((task) => task.id === holderTaskId);
	if (!holder) return state;
	const holderScopes = scopesOf(holder);
	if (holderScopes.length === 0) return state;
	const waiters = state.plan.tasks.filter((task) => task.status === "waiting" && task.id !== holder.id);
	if (waiters.length === 0) return state;
	let next = state;
	for (const waiter of waiters) {
		const hits = conflictingScopes(holderScopes, scopesOf(waiter));
		if (hits.length === 0) continue;
		const waitingOn = waiter.waitingOn ?? [];
		if (waitingOn.length > 0 && !waitingOn.includes(holder.id)) continue;
		const path = hits.slice().sort()[0];
		const seq = nextReleaseSeq(next.messages ?? [], holder.id, waiter.id);
		const messageId = `rel-${holder.id}-${waiter.id}-${seq}`;
		if ((next.messages ?? []).some((message) => message.messageId === messageId)) continue;
		const target = waiterNameOf(next, waiter);
		const record = {
			at,
			from: "captain",
			to: target.name,
			taskId: waiter.id,
			body: releaseMessageBody(holder, path, waiter),
			messageId
		};
		if (target.memberId !== void 0) record.toMemberId = target.memberId;
		next = appendMessage(next, record);
	}
	return applyScopeWaits(next, at);
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
	const forced = new Set(next.forceParallel ?? []);
	const revived = reviveForcedWaits(next, forced);
	if (revived !== next) {
		next = revived;
		changed = true;
	}
	const settledWaits = applyScopeWaits(next, now());
	if (settledWaits !== next) {
		next = settledWaits;
		changed = true;
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
	const depsDone = (task) => task.dependsOn.every((dep) => {
		const upstream = next.plan.tasks.find((item) => item.id === dep);
		return upstream !== void 0 && depSatisfied(upstream.status);
	});
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
		if (changed) deps.store.save(next);
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
			return !upstream || !depSatisfied(upstream.status);
		}).length > 0) {
			next = patchTask(next, taskId, { status: "blocked" });
			changed = true;
			continue;
		}
		const conflict = forced.has(taskId) ? null : waitFor(next, task, started);
		if (conflict) {
			next = patchTask(next, taskId, {
				status: "waiting",
				waitingOn: [conflict.holderTaskId],
				waitReason: waitReasonOf(conflict.holderTaskId, conflict.path)
			});
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
				error: `生成提示词失败：${messageOf$3(error)}`
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
			next = stampTaskTime(next, taskId, { startedAt: at });
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
				error: messageOf$3(error)
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
				next = releaseScopes(next, task.id, now());
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
				next = releaseScopes(next, task.id, now());
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
	const wasTerminal = isTerminalTaskStatus(task.status);
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
	const settledTask = next.plan.tasks.find((item) => item.id === taskId);
	if (!wasTerminal && settledTask && isTerminalTaskStatus(settledTask.status)) {
		next = releaseScopes(next, taskId, at);
		next = stampTaskTime(next, taskId, { endedAt: at });
	}
	if (receipt.verdict === "done") next = {
		...next,
		plan: {
			...next.plan,
			tasks: next.plan.tasks.map((item) => {
				if (item.status !== "blocked") return item;
				return item.dependsOn.every((dep) => {
					const upstream = next.plan.tasks.find((candidate) => candidate.id === dep);
					return upstream !== void 0 && depSatisfied(upstream.status);
				}) ? {
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
	if (next.plan.tasks.every((item) => SETTLED_PLAN_STATUSES.has(item.status)) && next.plan.tasks.length > 0) next = {
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
/**
* r13 AC-11：把「已获准强制并行」的 waiting 任务放回待办。
*
* 只动 `waiting`：pending/ready 本来就能进派发循环；running/gate 不能被强行并行改写状态。
* 清掉 `waitingOn` / `waitReason`（与 `applyScopeWaits` 的 waiting → pending 同口径），
* 否则面板会显示「在等 t1」可任务已经在跑了 —— 等待文案与事实不一致比没有文案更糟。
*/
function reviveForcedWaits(state, forced) {
	if (forced.size === 0) return state;
	let changed = false;
	const tasks = state.plan.tasks.map((task) => {
		if (task.status !== "waiting" || !forced.has(task.id)) return task;
		changed = true;
		const revived = {
			...task,
			status: "pending"
		};
		delete revived.waitingOn;
		delete revived.waitReason;
		return revived;
	});
	if (!changed) return state;
	return {
		...state,
		plan: {
			...state.plan,
			tasks
		}
	};
}
/**
* r13 AC-20：任务计时的**唯一**写入 helper（起点由 dispatch 写、终点由 applyReceipt 写）。
*
* 两条不变量：
*  - `startedAt` / `endedAt` 都是「首次写入生效」——重派、重放回执、续跑都不得让用时漂移；
*  - 没有 `startedAt` 就不写 `endedAt`（任务从未开始就被跳过时，用时口径是「未开始」而不是 0）。
*/
function stampTaskTime(state, taskId, patch) {
	const current = state.taskTimes?.[taskId] ?? {};
	const next = { ...current };
	if (patch.startedAt !== void 0 && next.startedAt === void 0) next.startedAt = patch.startedAt;
	if (patch.endedAt !== void 0 && next.endedAt === void 0 && next.startedAt !== void 0) next.endedAt = Math.max(patch.endedAt, next.startedAt);
	if (next.startedAt === void 0 && next.endedAt === void 0) return state;
	if (next.startedAt === current.startedAt && next.endedAt === current.endedAt) return state;
	return {
		...state,
		taskTimes: {
			...state.taskTimes ?? {},
			[taskId]: next
		}
	};
}
/**
* 终态集合（r11 AC-15）：进入即释放写域。
*
* `interrupted` 也在里面：成员进程已死，它不会再改文件，占着写域只会让等待者永远等下去。
* 但它**不**让计划收口（见 SETTLED_PLAN_STATUSES）——中断的任务还能被续聊救回来。
*/
const TERMINAL_TASK_STATUSES = /* @__PURE__ */ new Set([
	"done",
	"failed",
	"cancelled",
	"skipped",
	"interrupted"
]);
/** 计划可以收口的任务状态（done/failed/cancelled/skipped）：interrupted 不算。 */
const SETTLED_PLAN_STATUSES = /* @__PURE__ */ new Set([
	"done",
	"failed",
	"cancelled",
	"skipped"
]);
/** 任务是否已进入终态（写域该释放了）。 */
function isTerminalTaskStatus(status) {
	return TERMINAL_TASK_STATUSES.has(status);
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
function messageOf$3(error) {
	return error instanceof Error ? error.message : String(error);
}
// src/host/team/confirm.ts
/** 重跑门禁时摘要里保留的原验收命令前缀长度（再长面板也读不出来）。 */
const ACCEPTANCE_SNIPPET = 40;
/** 5 类不可逆动作（AC-11）。可逆动作**绝不**进这个集合（AC-12 靠它做反向断言）。 */
const IRREVERSIBLE_ACTIONS = /* @__PURE__ */ new Set([
	"cancel",
	"cancelTask",
	"skipTask",
	"updateAcceptance",
	"forceParallel"
]);
/** 终态判定（跳过任务后，终态下游即便缺产物也不会再被派发 —— 只有未终态的才算影响面）。 */
const TERMINAL_STATUSES = /* @__PURE__ */ new Set([
	"done",
	"failed",
	"cancelled",
	"skipped",
	"interrupted"
]);
/** 写域占用方：正在跑 / 在门禁 / 在等写域的任务都可能与目标冲突。 */
const HOLDER_STATUSES = /* @__PURE__ */ new Set([
	"running",
	"gate",
	"waiting"
]);
/** 类型收窄（AC-11 的机械入口）：只有这五种动作需要确认，其余一律直接执行。 */
function isIrreversibleAction(action) {
	return IRREVERSIBLE_ACTIONS.has(action.type);
}
function tasksOf(state) {
	return state.plan?.tasks ?? [];
}
function taskOf(state, taskId) {
	return tasksOf(state).find((task) => task.id === taskId);
}
/** 传递闭包：`taskId` 的下游里**尚未终态**的任务数（跳过它后会在缺产物下继续的数量）。 */
function downstreamCount(tasks, taskId) {
	const blocked = /* @__PURE__ */ new Set();
	const queue = [taskId];
	while (queue.length > 0) {
		const current = queue.shift();
		for (const task of tasks) {
			if (task.id === taskId || blocked.has(task.id)) continue;
			if (!task.dependsOn.includes(current)) continue;
			blocked.add(task.id);
			if (!TERMINAL_STATUSES.has(task.status)) queue.push(task.id);
		}
	}
	let count = 0;
	for (const task of tasks) if (blocked.has(task.id) && !TERMINAL_STATUSES.has(task.status)) count += 1;
	return count;
}
/** 正在跑的成员数（`cancel` 的影响面）：只有 `running` 任务才有活着的成员可中断。 */
function runningMemberCount(state) {
	return tasksOf(state).filter((task) => task.status === "running").length;
}
/** 与目标任务写域冲突的占用任务（`forceParallel` 的影响面）。 */
function scopeHolderOf(state, target) {
	const scopes = target.writeScopes ?? [];
	return tasksOf(state).find((task) => {
		if (task.id === target.id || !HOLDER_STATUSES.has(task.status)) return false;
		return conflictingScopes(task.writeScopes ?? [], scopes).length > 0;
	});
}
function acceptanceSnippet(value) {
	const text = (value ?? "").trim().replace(/\s+/g, " ");
	if (text === "") return "（空）";
	return text.length > ACCEPTANCE_SNIPPET ? `${text.slice(0, ACCEPTANCE_SNIPPET)}…` : text;
}
/**
* 影响面文案（AC-13 要求逐字可见）：模板固定，只替换事实。
*
* 不含「确定 / 取消」这类按钮措辞——动词短语（终止运行 / 跳过任务…）由面板按钮负责，
* 摘要只回答「会发生什么」。
*/
function confirmSummaryOf(action, state) {
	const runId = state.plan?.runId ?? "未知运行";
	switch (action.type) {
		case "cancel": return `终止运行 ${runId}（将中断 ${runningMemberCount(state)} 个运行中成员）`;
		case "cancelTask": {
			const task = taskOf(state, action.taskId);
			return `中断成员 ${state.bindings?.find((binding) => binding.taskId === action.taskId && binding.retired !== true)?.name ?? "该任务成员"}（任务 ${task?.id ?? action.taskId}）`;
		}
		case "skipTask": return `跳过任务 ${action.taskId}（下游 ${downstreamCount(tasksOf(state), action.taskId)} 个任务将在缺产物下继续）`;
		case "updateAcceptance": {
			const task = taskOf(state, action.taskId);
			return `重跑任务 ${action.taskId} 的门禁（原验收：${acceptanceSnippet(task?.acceptance ?? "")}）`;
		}
		case "forceParallel": {
			const task = taskOf(state, action.taskId);
			const holder = task ? scopeHolderOf(state, task) : void 0;
			return `强制并行任务 ${action.taskId}（与 ${holder?.id ?? "其他任务"} 写域冲突）`;
		}
		default: return `执行 ${action.type}（不可逆）`;
	}
}
/**
* 构造一条待确认记录。
*
* `id` 里带时间戳与动作名：同一 run 只允许一条未决记录，因此不需要更强的唯一性；
* 但 `confirmPending` 必须能区分「确认的是刚看到的那条」与「陈旧 id」，所以 id 不能是常量。
*/
function pendingFor(state, action, now) {
	const pending = {
		id: `pending-${now.toString(36)}-${action.type}`,
		action,
		runId: state.plan.runId,
		createdAt: now,
		summary: confirmSummaryOf(action, state),
		irreversible: true
	};
	if ("taskId" in action && typeof action.taskId === "string") pending.taskId = action.taskId;
	return pending;
}
/** 落盘记录 → 视图（`waitedText` 每次按 now 重算，绝不落盘，见 `waitedTextOf`）。 */
function pendingViewOf(pending, now) {
	if (!pending) return void 0;
	const view = {
		id: pending.id,
		action: pending.action.type,
		runId: pending.runId,
		createdAt: pending.createdAt,
		summary: pending.summary,
		irreversible: true,
		waitedText: waitedTextOf(pending.createdAt, now)
	};
	if (pending.taskId !== void 0) view.taskId = pending.taskId;
	return view;
}
// src/host/team/usage.ts
const RANK = {
	"per-member": 2,
	"aggregate-only": 1,
	unavailable: 0
};
/** 宿主可能发出的事件类型（只认 assistant 消息，其余一律忽略）。 */
const MESSAGE_EVENT_TYPES = /* @__PURE__ */ new Set([
	"assistant/message",
	"assistant.message",
	"message.assistant"
]);
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteOrUndefined(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function firstNumber(...values) {
	for (const value of values) {
		const num = finiteOrUndefined(value);
		if (num !== void 0) return num;
	}
}
/** 把任意 `usage` 片段收敛成 `TokenTotals`；一个数字都没有 → null（该事件不计用量）。 */
function tokenTotalsOf(raw) {
	if (!isRecord$1(raw)) return null;
	const input = firstNumber(raw.inputTokens, raw.input, raw.promptTokens, raw.prompt);
	const output = firstNumber(raw.outputTokens, raw.output, raw.completionTokens, raw.completion);
	const declared = firstNumber(raw.totalTokens, raw.total);
	if (declared === void 0 && input === void 0 && output === void 0) return null;
	const totals = { total: declared ?? (input ?? 0) + (output ?? 0) };
	if (input !== void 0) totals.input = input;
	if (output !== void 0) totals.output = output;
	return totals;
}
/** 两条合计相加：缺失分项按 0 参与，结果只带**真的有过**的分项，避免凭空补 0。 */
function addTotals$1(current, add) {
	const next = { total: (current?.total ?? 0) + add.total };
	const input = (current?.input ?? 0) + (add.input ?? 0);
	const output = (current?.output ?? 0) + (add.output ?? 0);
	if (current?.input !== void 0 || add.input !== void 0) next.input = input;
	if (current?.output !== void 0 || add.output !== void 0) next.output = output;
	return next;
}
function sumByMember(record) {
	let acc;
	for (const totals of Object.values(record.byMember ?? {})) acc = addTotals$1(acc, totals);
	return acc;
}
/**
* 把宿主 payload 归一成 {@link UsageEventInput}；不是「assistant 消息带用量」就返回 null。
*
* 真实宿主签名（`cordis_inspect_query(platform=host, provider=Event, method=listEvents,
* input={"event":"session/event"})` 的原文）：
*   `'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void`
* 即监听器收到**两个参数**：会话对象（`session.id` 是 SessionId）与事件对象
* （`{ type, seq, time, data }`，用量在 `event.data.usage`，类型是 `assistant/message`）。
*
* r13 初版只按「单参数对象」解析，真实形状下一条都取不到 → 归属恒为 `unavailable`、
* 面板整列显示「不可得」。这里**优先**按真实签名解析，旧形状继续兼容（历史单测 +
* 宿主将来换壳不至于整块失效）。
*/
function usageOfSessionEvent(payload) {
	const hostShape = usageOfHostArgs(payload);
	if (hostShape !== void 0) return hostShape;
	if (!isRecord$1(payload)) return null;
	const body = isRecord$1(payload.event) ? payload.event : isRecord$1(payload.message) ? payload.message : payload;
	const type = typeof payload.type === "string" ? payload.type : typeof body.type === "string" ? body.type : void 0;
	if (type !== void 0 && !MESSAGE_EVENT_TYPES.has(type)) return null;
	const usage = tokenTotalsOf(body.usage ?? payload.usage);
	if (!usage) return null;
	const agent = isRecord$1(body.agent) ? body.agent : isRecord$1(payload.agent) ? payload.agent : void 0;
	const sessionId = firstString(body.sessionId, payload.sessionId, body.agentId, payload.agentId, agent?.id) ?? void 0;
	const seq = firstNumber(body.seq, payload.seq);
	const eventKey = firstString(body.eventId, body.id, payload.eventId, payload.id) ?? (sessionId !== void 0 ? `${sessionId}:${seq ?? "?"}` : void 0);
	const input = { usage };
	if (sessionId !== void 0) input.sessionId = sessionId;
	if (taskIdOf(payload, body) !== void 0) input.taskId = taskIdOf(payload, body);
	if (eventKey !== void 0) input.eventKey = eventKey;
	return input;
}
function firstString(...values) {
	for (const value of values) if (typeof value === "string" && value !== "") return value;
}
/**
* 真实宿主形状解析；`undefined` = 不是这个形状（交给旧逻辑），`null` = 是但没用量。
*
* 三种包裹都见过：监听器数组 `[session, event]`、对象 `{ session, event }`、
* 以及直接给事件本身（`{ type, seq, data }`）。
*/
function usageOfHostArgs(payload) {
	const pair = hostPairOf(payload);
	if (pair === void 0) return void 0;
	const type = typeof pair.event.type === "string" ? pair.event.type : void 0;
	if (type === void 0 || !MESSAGE_EVENT_TYPES.has(type)) return null;
	const data = isRecord$1(pair.event.data) ? pair.event.data : void 0;
	const usage = tokenTotalsOf(data?.usage ?? pair.event.usage);
	if (!usage) return null;
	const sessionId = firstString(isRecord$1(pair.session) ? firstString(pair.session.id) : void 0, data?.sessionId, pair.event.sessionId, data?.agentId);
	const seq = firstNumber(pair.event.seq, data?.seq);
	const eventKey = firstString(pair.event.eventId, pair.event.id) ?? (sessionId !== void 0 ? `${sessionId}:${seq ?? "?"}` : void 0);
	const taskId = firstString(data?.taskId, pair.event.taskId);
	const input = { usage };
	if (sessionId !== void 0) input.sessionId = sessionId;
	if (taskId !== void 0) input.taskId = taskId;
	if (eventKey !== void 0) input.eventKey = eventKey;
	return input;
}
function hostPairOf(payload) {
	if (Array.isArray(payload)) {
		const [first, second] = payload;
		if (isRecord$1(second) && typeof second.type === "string") return {
			session: isRecord$1(first) ? first : void 0,
			event: second
		};
		if (isRecord$1(first) && typeof first.type === "string") return { event: first };
		return;
	}
	if (!isRecord$1(payload)) return void 0;
	if (isRecord$1(payload.event) && typeof payload.event.type === "string") return {
		session: isRecord$1(payload.session) ? payload.session : void 0,
		event: payload.event
	};
	if (typeof payload.type === "string" && isRecord$1(payload.data)) return { event: payload };
}
/** payload 里若已带任务 id 就直接用（宿主将来若补字段，这里一处即可跟上）。 */
function taskIdOf(payload, body) {
	return firstString(body.taskId, payload.taskId);
}
/**
* 身份匹配：payload 里的 agent/session id 若等于某个 binding 的 `memberId`，就归到该成员。
*
* 匹配不到**不猜**（不按名字、不按时间最近），返回 undefined → 该事件降级为 aggregate-only。
*/
function memberIdOf(bindings, candidate) {
	if (!candidate || !bindings) return void 0;
	return bindings.some((binding) => binding?.memberId === candidate) ? candidate : void 0;
}
/**
* 累加一次用量事件（纯函数，返回新记录，不改入参）。
*
* 归属只能降级：一次「无身份」事件会让 run 从 `per-member` 掉到 `aggregate-only`，此后
* 即使再收到带身份的事件也不回升 —— 否则合计会与分项对不上（同一段时间被记两次）。
*/
function applyUsage(record, event, now) {
	const base = record ?? {
		attribution: "unavailable",
		byMember: {},
		byTask: {},
		updatedAt: now
	};
	const next = {
		...base,
		attribution: base.attribution,
		byMember: { ...base.byMember ?? {} },
		byTask: { ...base.byTask ?? {} },
		updatedAt: now
	};
	const totals = tokenTotalsOf(event.usage);
	if (!totals) return next;
	const hasData = base.total !== void 0 || Object.keys(next.byMember).length > 0;
	const candidate = event.memberId ? "per-member" : "aggregate-only";
	next.attribution = hasData ? RANK[candidate] < RANK[base.attribution] ? candidate : base.attribution : candidate;
	if (event.memberId) next.byMember[event.memberId] = addTotals$1(next.byMember[event.memberId], totals);
	if (event.taskId) next.byTask[event.taskId] = addTotals$1(next.byTask[event.taskId], totals);
	next.total = addTotals$1(next.total, totals);
	return next;
}
const NO_EVENT_REASON = "尚无用量事件";
const NO_PROVIDER_REASON = "宿主未上报本 run 的用量";
/** run 级用量单元格：`record` 存在且有数字才 `provider`（含 0），否则 `unavailable` + 原因。 */
function runUsageOf(record) {
	if (!record) return {
		source: "unavailable",
		reason: NO_EVENT_REASON
	};
	if (record.attribution === "unavailable" && record.total === void 0) return {
		source: "unavailable",
		reason: NO_PROVIDER_REASON
	};
	return usageCellOf(record.total ?? sumByMember(record), NO_PROVIDER_REASON);
}
/** 任务级用量单元格：优先 byTask，其次 byMember（该任务的成员），最后按归属状态给原因。 */
function taskUsageOf(record, taskId, memberId) {
	if (!record) return {
		source: "unavailable",
		reason: NO_EVENT_REASON
	};
	const byTask = record.byTask?.[taskId];
	if (byTask) return usageCellOf(byTask, NO_PROVIDER_REASON);
	if (memberId) {
		const byMember = record.byMember?.[memberId];
		if (byMember) return usageCellOf(byMember, NO_PROVIDER_REASON);
	}
	if (record.attribution === "aggregate-only") return {
		source: "unavailable",
		reason: "宿主只上报了 run 合计，未按成员归属"
	};
	if (record.attribution === "per-member") return {
		source: "unavailable",
		reason: "该任务还没有用量事件"
	};
	return {
		source: "unavailable",
		reason: NO_PROVIDER_REASON
	};
}
function createUsageDeduper(limit = 2e3) {
	const keys = /* @__PURE__ */ new Map();
	return {
		seen(runId, key) {
			const full = `${runId}\u0000${key}`;
			if (keys.has(full)) return true;
			keys.set(full, true);
			while (keys.size > limit) {
				const oldest = keys.keys().next().value;
				if (oldest === void 0) break;
				keys.delete(oldest);
			}
			return false;
		},
		drop(runId) {
			const prefix = `${runId}\u0000`;
			for (const key of [...keys.keys()]) if (key.startsWith(prefix)) keys.delete(key);
		},
		size() {
			return keys.size;
		}
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
* 18 个动作与拒绝码对照（TECHNICAL §4.2 / §5.x；r7 新增 4 个动作与 PAUSED 码，
* r11 新增 cancelTask / skipTask / updateAcceptance 三个单任务动作）：
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
*   cancelTask           → NO_PLAN / NOT_FOUND / BAD_REQUEST（允许集只从 shared/task-actions.ts 派生）
*   skipTask             → NO_PLAN / NOT_FOUND / BAD_REQUEST（下游 blocked → pending）
*   updateAcceptance     → NO_PLAN / NOT_FOUND / BAD_REQUEST（空串 → 三条模板全文）；
*                          `done` 允许（r13 取代 r11#AC-26）并当场重跑门禁，结论走 applyReceipt
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
	/**
	* 技能投影（r10 AC-18：四来源 + 「已修改」标记）。
	*
	* 有技能仓储时**只认仓储投影**（磁盘是唯一真相：seed 铺底 + 用户覆盖层）；
	* 没装配仓储时回退内置只读投影，`source:'builtin' / modified:false` —— 与 r7 逐字一致，
	* 保证「装配层漏接线」不会让面板的技能列表凭空消失。
	*/
	function skillsOf() {
		const repo = deps.skills;
		if (repo !== void 0) return repo.projection();
		return BUILTIN_SKILLS.map((skill) => ({
			id: skill.id,
			title: skill.title,
			description: firstLine(skill.body.replace(/^#+\s*/, "")),
			source: "builtin",
			modified: false
		}));
	}
	/**
	* 系统技能扫描（r10 AC-19 / AC-18b）：**只扫一次盘**，投影与不可用原因一起带出去。
	*
	* 为什么连 reason 一起下发：「扫到 0 条」与「本机没有这个库」在界面上必须长得不一样。
	* 只给空数组，用户看到的就是「弹层空着、也不说为什么」——验收 R2 卡的就是这一处。
	*/
	function systemSkillScan() {
		const source = deps.systemSkills;
		if (source === void 0) return {
			skills: [],
			reason: "系统技能库未装配（宿主未注入扫描器）"
		};
		try {
			const scan = source.scan();
			return {
				skills: scan.skills.map((skill) => ({
					name: skill.name,
					description: skill.description
				})),
				...scan.reason === void 0 ? {} : { reason: scan.reason }
			};
		} catch (error) {
			return {
				skills: [],
				reason: `系统技能库扫描失败：${error instanceof Error ? error.message : String(error)}`
			};
		}
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
	function saveState(state, cause = "plan-saved") {
		deps.store.save(state);
		const notify = deps.onRunChanged;
		if (typeof notify === "function") try {
			notify(state.plan.sessionId, state.plan.runId, cause);
		} catch {}
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
		for (const note of deps.dispatchNotices?.recent(state.plan.runId) ?? []) events.push(note);
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
	/**
	* 记忆根（r13 AC-23）：默认当前工作区；带 `workspace` 时换 projectDir，public 永远全局。
	*
	* 白名单是硬闸：`workspace` 来自 HTTP 查询参数，没有 `isKnownWorkspace` 时只允许当前
	* 工作区 —— 否则一次 `workspace=/etc` 就能把任意目录下 `.auto-team/memory/*.md` 读出来。
	*/
	function rootsFor(workspace) {
		if (workspace === void 0 || workspace.trim() === "") return deps.memoryRoots;
		const requested = normalizeWorkspace(workspace);
		const known = deps.isKnownWorkspace;
		if (typeof known !== "function" || !known(requested)) return null;
		return {
			publicDir: deps.memoryRoots.publicDir,
			projectDir: projectMemoryDir(requested)
		};
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
	/**
	* 应用一批技能变更（r10 AC-17/AC-20），逐条执行、遇错即停并返回可读原因。
	*
	* 语义要点：
	*  - `save` 的 `source:'system'` 且正文为空 → 现场按 `systemName` 去系统技能库读正文：
	*    系统技能正文不进快照（可能上千字 × N 条），只在用户真的选中并保存时读一次。
	*  - `delete` 成功必须**同时摘除所有角色的引用**，并把「从 N 个角色摘除」报出来 ——
	*    否则用户只看到技能没了，却不知道角色卡上还挂着已删除的 id（成员提示词会出现「缺失技能」）。
	*/
	function applySkillMutations(mutations) {
		const repo = deps.skills;
		if (repo === void 0) return {
			ok: false,
			error: "技能仓储未装配：本次运行无法修改技能"
		};
		const notices = [];
		for (const mutation of mutations) {
			if (mutation.op === "save") {
				const resolved = withSystemBody(mutation.skill);
				if (!resolved.ok) return {
					ok: false,
					error: resolved.error
				};
				const saved = repo.save(resolved.draft);
				if (saved.error !== void 0) return {
					ok: false,
					error: saved.error
				};
				notices.push(`已保存技能『${saved.data.title}』（${saved.data.id}）`);
				continue;
			}
			if (mutation.op === "delete") {
				const removed = repo.remove(mutation.id);
				if (removed.error !== void 0) return {
					ok: false,
					error: removed.error
				};
				const detached = detachSkill(mutation.id);
				notices.push(detached === 0 ? `已删除『${removed.data.title}』，它未被任何角色引用` : `已删除『${removed.data.title}』，并从 ${detached} 个角色摘除引用`);
				continue;
			}
			const restored = repo.restoreBuiltin(mutation.id);
			if (restored.error !== void 0) return {
				ok: false,
				error: restored.error
			};
			notices.push(`已把『${restored.data.title}』恢复为出厂正文`);
		}
		return {
			ok: true,
			notices
		};
	}
	/** 系统技能：正文为空时按 `systemName` 现场读盘（找不到即整条变更失败，不写半截技能）。 */
	function withSystemBody(draft) {
		if (draft.source !== "system") return {
			ok: true,
			draft
		};
		if (typeof draft.body === "string" && draft.body.trim() !== "") return {
			ok: true,
			draft
		};
		const source = deps.systemSkills;
		const name = typeof draft.systemName === "string" ? draft.systemName.trim() : "";
		if (source === void 0) return {
			ok: false,
			error: "系统技能库未装配：无法导入系统技能"
		};
		if (name === "") return {
			ok: false,
			error: "系统技能缺少名称：无法定位正文"
		};
		let entry;
		try {
			entry = source.scan().skills.find((skill) => skill.name === name);
		} catch (error) {
			return {
				ok: false,
				error: `系统技能库扫描失败：${error instanceof Error ? error.message : String(error)}`
			};
		}
		if (entry === void 0) return {
			ok: false,
			error: `系统技能已不存在：「${name}」`
		};
		return {
			ok: true,
			draft: {
				...draft,
				title: draft.title.trim() === "" ? entry.name : draft.title,
				description: draft.description.trim() === "" ? entry.description : draft.description,
				body: entry.body
			}
		};
	}
	/** 把某个技能 id 从所有角色的 `skillIds` 里摘掉，返回被改动的角色数（删除技能后的引用清理）。 */
	function detachSkill(skillId) {
		let detached = 0;
		for (const role of deps.roles.list()) {
			if (!Array.isArray(role.skillIds) || !role.skillIds.includes(skillId)) continue;
			if (deps.roles.save({
				...role,
				skillIds: role.skillIds.filter((item) => item !== skillId)
			}).ok) detached += 1;
		}
		return detached;
	}
	/**
	* run 级用时（快照 `runDuration`）：起点取 `plannedAt`（计划落盘时刻，永远是事实）。
	*
	* 终态但旧 run 没有 `finishedAt` → `unavailable`（不拿「现在」冒充结束时刻，否则一条
	* 昨天跑完的 run 会显示成「跑了两天」）。
	*/
	function runDurationOf(state, at) {
		if (!state) return durationCellOf({
			state: "unavailable",
			now: at
		});
		const ended = state.finishedAt !== void 0;
		if (!ended && (state.plan.status === "cancelled" || state.plan.status === "terminated")) return durationCellOf({
			startAt: state.plannedAt,
			state: "unavailable",
			now: at
		});
		return durationCellOf({
			startAt: state.plannedAt,
			...ended ? { endAt: state.finishedAt } : {},
			state: ended ? "done" : "running",
			now: at
		});
	}
	/** 任务级用时（快照 `taskDurations`，key = taskId）：没有起点 = 未开始，不是 0 秒。 */
	function taskDurationsOf(state, at) {
		const out = {};
		if (!state) return out;
		for (const task of state.plan.tasks) {
			const time = state.taskTimes?.[task.id];
			const startAt = time?.startedAt;
			const endAt = time?.endedAt;
			const finished = endAt !== void 0 || isTerminalTaskStatus(task.status);
			const cellState = startAt === void 0 ? "not-started" : finished ? "done" : "running";
			out[task.id] = durationCellOf({
				...startAt === void 0 ? {} : { startAt },
				...endAt === void 0 ? {} : { endAt },
				state: cellState,
				now: at
			});
		}
		return out;
	}
	/** 任务级用量（快照 `taskUsage`，key = taskId）：优先任务归属，其次该任务的成员。 */
	function taskUsageMapOf(state) {
		const out = {};
		if (!state) return out;
		for (const task of state.plan.tasks) {
			const memberId = bindingFor(state, task.id)?.memberId ?? task.memberId;
			out[task.id] = taskUsageOf(state.usage, task.id, memberId);
		}
		return out;
	}
	/**
	* 历史列表（AC-21，≤50）：每个会话自己的 run，最近的在前。
	*
	* 5 秒 memo（与 `LIBRARY_CACHE_MS` 同量级、独立对象）：`store.list()` 会读**每一个** run 文件，
	* 面板 2 秒一刷时不该把历史列表变成每刷一次的磁盘风暴；新建的 run 最多晚 5 秒出现，
	* 而当前 run 本身来自 `latestForSession`，不受影响。
	*/
	let historyMemo = null;
	function historyOf(sessionId) {
		const at = now();
		if (historyMemo && historyMemo.sessionId === sessionId && at - historyMemo.at < 5e3) return historyMemo.runs;
		const runs = deps.store.list().filter((run) => run.sessionId === sessionId).slice(0, 50);
		historyMemo = {
			sessionId,
			at,
			runs
		};
		return runs;
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
		const systemSkillView = systemSkillScan();
		const paused = state?.plan.status === "paused";
		const pausedAt = state?.pause?.at;
		const at = now();
		const pending = pendingViewOf(state?.pendingConfirmation, at);
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
			modelCatalog: deps.modelCatalog?.() ?? {
				status: "empty",
				options: [],
				reason: "宿主未提供模型清单"
			},
			systemSkills: systemSkillView.skills,
			...systemSkillView.reason === void 0 ? {} : { systemSkillsReason: systemSkillView.reason },
			...captain === void 0 ? {} : { captainModel: captain },
			degraded: health?.degraded === true,
			...health?.degraded === true ? { degradeReason: health.reason ?? "事件源不可用，推进退回轮询兜底" } : {},
			triggers: state?.triggers ?? [],
			scopeLocks: deriveScopeLocks(state?.plan.tasks ?? [], state?.bindings ?? []),
			deviations: deps.deviations?.recent(50) ?? [],
			...state?.project === void 0 ? {} : { project: state.project },
			runUsage: runUsageOf(state?.usage),
			runDuration: runDurationOf(state, at),
			taskUsage: taskUsageMapOf(state),
			taskDurations: taskDurationsOf(state, at),
			...pending === void 0 ? {} : { pendingConfirmation: pending },
			runs: historyOf(sessionId)
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
	/**
	* 单任务动作的拒绝文案（r11 AC-26）：**必须**含任务 id 与当前状态中文。
	*
	* 原因句取 `shared/task-actions.ts` 的同一张表（`taskActionDisabledReason`）：面板 disabled
	* 按钮的 `title` 与这里的拒绝是同一句，用户先看到「为什么不能点」，再收到拒绝时说法一致。
	*/
	function taskActionDeniedText(task, action) {
		const label = TASK_STATUS_LABELS[task.status] ?? task.status;
		const reason = taskActionDisabledReason(action, task.status);
		return `任务 ${task.id} 当前状态为「${label}」，${reason === "" ? "不允许该动作" : reason}`;
	}
	/** 依赖本任务、且尚未终态的下游（AC-26 的「下游未完成者」）。 */
	function downstreamOf(state, taskId) {
		return state.plan.tasks.filter((item) => item.dependsOn.includes(taskId) && !isTerminalTaskStatus(item.status));
	}
	/**
	* 前置闸（r13 提取）：未启用 / 暂停。
	*
	* 提取出来是因为入口 `act` 与执行体 `executeAction` 都要过同一道闸 —— 确认后重放的动作
	* 期间用户可能已经把插件关掉或暂停了，那时**确认也不该放行**（拒绝语义与直接调用完全一致）。
	*/
	function preflightGate(sessionId, action) {
		if (action.type !== "toggle" && flags[sessionId]?.enabled !== true) return reject("NOT_ENABLED", NOT_ENABLED_TEXT, sessionId);
		if (PAUSED_BLOCKED.has(action.type)) {
			if (loadState(sessionId)?.plan.status === "paused") return reject("PAUSED", PAUSED_TEXT, sessionId);
		}
		return null;
	}
	/**
	* 确认/拒绝一条未决动作（AC-13）。
	*
	* 两条纪律：
	*  - **先落状态再执行**：确认后 pending 立刻消失，即使执行体抛错也不会复活 —— 否则用户会
	*    被同一条确认反复拦住（同一件事被做了两次，比失败严重得多）。
	*  - **执行走 `executeAction`**：与直接调用共用同一个执行体，不存在「确认后行为不一样」。
	*/
	async function resolvePending(sessionId, action) {
		const state = loadState(sessionId);
		if (!state) return reject("NO_PLAN", "当前会话还没有执行计划", sessionId);
		const pending = state.pendingConfirmation;
		if (!pending || pending.id !== action.pendingId) return reject("NOT_FOUND", "该确认已失效（可能已被处理或已刷新），请重新操作", sessionId);
		const cleared = {
			...state,
			pendingConfirmation: void 0
		};
		if (action.type === "rejectPending") {
			saveState(cleared);
			return accept(sessionId, ["已取消该操作：状态未做任何改动"]);
		}
		if (pending.action.type === "forceParallel") {
			const ids = cleared.forceParallel ?? [];
			saveState({
				...cleared,
				forceParallel: ids.includes(pending.action.taskId) ? ids : [...ids, pending.action.taskId]
			});
		} else saveState(cleared);
		return executeAction(sessionId, pending.action);
	}
	/**
	* 动作入口（r13 AC-11 / AC-12 / AC-13）：先过确认闸，再走**同一执行体**。
	*
	* 顺序是刻意的：前置闸（未启用/暂停）在挂 pending **之前**跑 —— 用户不该去确认一个
	* 注定被拒绝的动作。可逆动作（AC-12 的 7 类）在这里不产生任何 pending，直接执行。
	*/
	async function act(sessionId, action) {
		if (action.type === "confirmPending" || action.type === "rejectPending") return resolvePending(sessionId, action);
		const blocked = preflightGate(sessionId, action);
		if (blocked) return blocked;
		if (!isIrreversibleAction(action)) return executeAction(sessionId, action);
		const state = loadState(sessionId);
		if (!state) return executeAction(sessionId, action);
		if (action.type === "forceParallel" && (state.forceParallel ?? []).includes(action.taskId)) return executeAction(sessionId, action);
		const existing = state.pendingConfirmation;
		if (existing) return {
			...reject("CONFIRM_REQUIRED", `已有待确认操作，请先处理：${existing.summary}`, sessionId),
			pendingId: existing.id
		};
		const pending = pendingFor(state, action, now());
		saveState({
			...state,
			pendingConfirmation: pending
		});
		return {
			...reject("CONFIRM_REQUIRED", `该操作不可逆，需确认：${pending.summary}`, sessionId),
			pendingId: pending.id
		};
	}
	/**
	* 派发准入判定（r14 AC-1）：`precheckDispatch` 与 `case 'dispatch'` 的唯一判据。
	*
	* 顺序刻意与 `act` 对齐 —— `act` 的 `preflightGate` 在进 case **之前**就先拦「未启用/暂停」，
	* 所以这里也必须先拦这两道，否则同一状态下工具与面板会得到不同拒绝码
	*（TECHNICAL §3.2 的判定次序把 PAUSED 写在 status 之后，与既有 act 行为矛盾，按行为为准）。
	*/
	function admissionOf(sessionId, runId) {
		if (flags[sessionId]?.enabled !== true) return {
			ok: false,
			code: "NOT_ENABLED",
			message: NOT_ENABLED_TEXT
		};
		const state = loadState(sessionId);
		if (!state) return {
			ok: false,
			code: "NO_PLAN",
			message: "当前会话还没有执行计划：先让队长拆解目标（auto_team_plan）"
		};
		if (state.plan.status === "paused") return {
			ok: false,
			code: "PAUSED",
			message: PAUSED_TEXT
		};
		if (runId !== void 0 && runId !== state.plan.runId) return {
			ok: false,
			code: "NOT_FOUND",
			message: `找不到运行 ${runId}（当前会话最新运行是 ${state.plan.runId}）`
		};
		const status = state.plan.status;
		if (status !== "draft" && status !== "dispatching") return {
			ok: false,
			code: "NO_PLAN",
			message: `计划状态为 ${status}，不能派发（需要 draft/dispatching）`
		};
		const boundIds = new Set(state.bindings.filter((binding) => binding.retired !== true).map((binding) => binding.taskId));
		const ready = readyTasks(state.plan.tasks);
		const unbound = ready.filter((taskId) => !boundIds.has(taskId));
		if (status === "dispatching" && unbound.length === 0) return {
			ok: false,
			code: "PLAN_ALREADY_DISPATCHED",
			message: "计划已派发：成员已在运行，不会重复起人（中断的成员请用「继续」恢复）"
		};
		return {
			ok: true,
			runId: state.plan.runId,
			ready,
			unbound
		};
	}
	/** 执行体：所有 Action 的唯一实现（确认闸确认后也回到这里）。 */
	async function executeAction(sessionId, action) {
		try {
			const blocked = preflightGate(sessionId, action);
			if (blocked) return blocked;
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
					const admission = admissionOf(sessionId, action.runId);
					if (!admission.ok) return reject(admission.code, admission.message, sessionId);
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话还没有执行计划", sessionId);
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
				/**
				* 强制并行（r13 AC-11，不可逆 → 必过确认闸）。
				*
				* 只做两件事：记下**持久授权**（`forceParallel` 落盘，重启后仍有效）、把在等写域的任务
				* 放回 `ready` 并清掉等待文案。真正的准入仍由下一次 `dispatchReady` 判定 ——
				* 这里绝不能自己起人，否则就出现第二条派发路径（绕过并发/依赖/暂停四道闸）。
				*/
				case "forceParallel": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话还没有执行计划", sessionId);
					const task = state.plan.tasks.find((item) => item.id === action.taskId);
					if (!task) return reject("NOT_FOUND", `找不到任务 ${action.taskId}`, sessionId);
					const ids = state.forceParallel ?? [];
					const authorized = ids.includes(task.id) ? ids : [...ids, task.id];
					const wasWaiting = (task.waitingOn ?? []).length > 0;
					saveState(withTask({
						...state,
						forceParallel: authorized
					}, task.id, (item) => {
						const { waitingOn: _waiting, waitReason: _reason, ...rest } = item;
						return {
							...rest,
							status: "ready"
						};
					}));
					return accept(sessionId, [wasWaiting ? `任务 ${task.id} 已强制并行：不再等待写域释放，下一次派发放行` : `任务 ${task.id} 已记录强制并行（当前未在等待写域，后续冲突时直接放行）`]);
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
				/**
				* 单任务取消（r11 AC-26）。
				*
				* 允许集只从 `shared/task-actions.ts` 派生（桥里不写第二份 13×3 表）：面板的 disabled
				* 矩阵与这里的拒绝必须是同一份来源，否则第一次改允许集就会分叉。
				*
				* 副作用顺序是刻意的：**先落状态**（cancelled 是权威），再尽力中断成员，最后
				* `releaseScopes` 唤醒等它写域的成员 —— 中断失败不能让「取消」这个动作失败。
				*/
				case "cancelTask": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话还没有执行计划：没有可取消的任务", sessionId);
					const task = state.plan.tasks.find((item) => item.id === action.taskId);
					if (!task) return reject("NOT_FOUND", `找不到任务 ${action.taskId}`, sessionId);
					if (!taskActionAllowed("cancel", task.status)) return reject("BAD_REQUEST", taskActionDeniedText(task, "cancel"), sessionId);
					const at = now();
					const reason = typeof action.reason === "string" ? action.reason.trim() : "";
					const notices = [`任务 ${task.id} 已取消（${TASK_STATUS_LABELS[task.status]} → ${TASK_STATUS_LABELS.cancelled}）${reason === "" ? "" : `：${reason}`}`];
					if (task.status === "running") {
						const binding = bindingFor(state, task.id);
						const memberName = binding?.name ?? binding?.memberId;
						const interrupt = deps.interruptMember;
						if (typeof interrupt === "function" && memberName !== void 0) {
							const stopped = await interrupt(memberName);
							notices.push(stopped.ok ? `已中断成员 ${memberName}` : `成员 ${memberName} 中断失败：${stopped.error ?? "未知原因"}（任务状态已取消，成员由 watcher 对账）`);
						}
					}
					const downstream = downstreamOf(state, task.id);
					let next = withTask(state, task.id, (item) => {
						const { waitingOn: _waiting, waitReason: _reason, ...rest } = item;
						return {
							...rest,
							status: "cancelled"
						};
					});
					for (const child of downstream) next = withTask(next, child.id, (item) => ({
						...item,
						status: "blocked",
						waitingOn: [task.id],
						waitReason: `上游 ${task.id} 已取消`
					}));
					if (downstream.length > 0) notices.push(`下游 ${downstream.map((child) => child.id).join("、")} 转为阻塞（上游 ${task.id} 已取消）`);
					next = releaseScopes(next, task.id, at);
					saveState(withMessage(next, recordOf({
						from: "captain",
						to: "user",
						at,
						body: notices.join("；")
					})), "task-terminal");
					return accept(sessionId, notices);
				}
				/**
				* 单任务跳过（r11 AC-26）：`skipped` 在依赖语义里**视为满足**（`graph.depSatisfied` 单点），
				* 所以这里只需要把「本任务解锁后全部依赖都满足」的下游 blocked 放回 pending。
				*
				* 仍被别的依赖挡住的子任务**原样不动**：它的 waitingOn/waitReason 由下一次回执的解锁
				* 分支重算，桥里再算一遍就会写出第二份依赖文案。
				*/
				case "skipTask": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话还没有执行计划：没有可跳过的任务", sessionId);
					const task = state.plan.tasks.find((item) => item.id === action.taskId);
					if (!task) return reject("NOT_FOUND", `找不到任务 ${action.taskId}`, sessionId);
					if (!taskActionAllowed("skip", task.status)) return reject("BAD_REQUEST", taskActionDeniedText(task, "skip"), sessionId);
					const at = now();
					let next = withTask(state, task.id, (item) => {
						const { waitingOn: _waiting, waitReason: _reason, ...rest } = item;
						return {
							...rest,
							status: "skipped"
						};
					});
					const released = [];
					for (const child of next.plan.tasks) {
						if (child.status !== "blocked" || !child.dependsOn.includes(task.id)) continue;
						const statusById = new Map(next.plan.tasks.map((item) => [item.id, item.status]));
						if (child.dependsOn.filter((dep) => !depSatisfied(statusById.get(dep) ?? "pending")).length > 0) continue;
						released.push(child.id);
						next = withTask(next, child.id, (item) => {
							const { waitingOn: _waiting, waitReason: _reason, ...rest } = item;
							return {
								...rest,
								status: "pending"
							};
						});
					}
					next = releaseScopes(next, task.id, at);
					const notices = [`任务 ${task.id} 已跳过（${TASK_STATUS_LABELS[task.status]} → ${TASK_STATUS_LABELS.skipped}）`];
					if (released.length > 0) notices.push(`下游 ${released.join("、")} 解除阻塞（依赖视为满足）`);
					saveState(withMessage(next, recordOf({
						from: "captain",
						to: "user",
						at,
						body: notices.join("；")
					})), "task-terminal");
					return accept(sessionId, notices);
				}
				/**
				* 改验收命令（r11 AC-26；r13 取代：允许面扩到 `done`）：空串拒绝并返回三条模板全文
				* （`emptyAcceptanceError` 单点生成，与工具入口 `tools.ts` 的整批拒绝是同一份文案）。
				*
				* 非 `done` 状态只改 `acceptance`：已落盘的 `evidence` 一字不动 —— 那是「上次门禁跑的是什么」
				* 的历史事实。`done` 改验收会改变「完成」的含义，所以**当场重跑门禁**：通过则保持 `done`
				* 并刷新证据，失败转 `rework`。状态写回仍走 `deps.applyReceipt`（done/rework 的唯一写点），
				* 不在这里长出第二条状态机路径。
				*/
				case "updateAcceptance": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话还没有执行计划：没有可改验收的任务", sessionId);
					const task = state.plan.tasks.find((item) => item.id === action.taskId);
					if (!task) return reject("NOT_FOUND", `找不到任务 ${action.taskId}`, sessionId);
					if (!taskActionAllowed("edit-acceptance", task.status)) return reject("BAD_REQUEST", taskActionDeniedText(task, "edit-acceptance"), sessionId);
					const acceptance = action.acceptance.trim();
					if (acceptance === "") return reject("BAD_REQUEST", emptyAcceptanceError([{
						id: task.id,
						title: task.title
					}]), sessionId);
					const nextState = withTask(state, task.id, (item) => ({
						...item,
						acceptance
					}));
					if (task.status !== "done") {
						saveState(nextState);
						return accept(sessionId, [`任务 ${task.id} 的验收命令已更新（当前状态：${TASK_STATUS_LABELS[task.status]}）`]);
					}
					const settings = settingsOf();
					const gateTask = nextState.plan.tasks.find((item) => item.id === task.id) ?? task;
					let outcome;
					try {
						outcome = await enqueueGate(() => Promise.resolve(runGate(gateTask, {
							cwd: deps.gate.cwd,
							artifactsDir: deps.gate.artifactsDir,
							timeoutMs: deps.gate.timeoutMs ?? settings.gateTimeoutMs,
							now
						})));
					} catch (error) {
						return reject("BAD_REQUEST", `门禁重跑失败：${error instanceof Error ? error.message : String(error)}`, sessionId);
					}
					const passed = outcome.ok;
					saveState(deps.applyReceipt(nextState, task.id, {
						verdict: passed ? "done" : "rework",
						note: "已完成的任务改验收后重跑门禁",
						evidence: outcome.evidence
					}, now(), settings.maxAttempts), "task-terminal");
					return accept(sessionId, [passed ? `门禁重跑通过（退出码 ${outcome.evidence.exitCode}）：任务 ${task.id} 保持已完成，证据已更新` : `门禁重跑未通过（退出码 ${outcome.evidence.exitCode}）：任务 ${task.id} 转返工`, `验收命令：${acceptance}`]);
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
					saveState(next, "task-terminal");
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
					if (role !== void 0) {
						if (typeof role.id !== "string" || role.id.trim() === "" || typeof role.name !== "string" || role.name.trim() === "") return reject("BAD_REQUEST", "角色必须有非空的 id 与 name", sessionId);
					}
					const notices = [];
					if (action.skills !== void 0 && action.skills.length > 0) {
						const applied = applySkillMutations(action.skills);
						if (!applied.ok) return reject("BAD_REQUEST", applied.error, sessionId);
						notices.push(...applied.notices);
					}
					if (role !== void 0) {
						const saved = deps.roles.save(role);
						if (!saved.ok) return reject("BAD_REQUEST", saved.error, sessionId);
						notices.push(`已保存角色 ${saved.role.name}（${saved.role.id}）`);
					}
					if (notices.length === 0) return reject("BAD_REQUEST", "saveRole 需要角色或技能变更", sessionId);
					return accept(sessionId, notices);
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
					let restoredSkills = [];
					let skillsNote = "";
					if (deps.skills === void 0) skillsNote = "技能仓储未装配：本次只恢复了角色，内置技能未处理";
					else try {
						restoredSkills = deps.skills.restoreBuiltins().restored;
					} catch (error) {
						skillsNote = `内置技能恢复失败：${error instanceof Error ? error.message : String(error)}`;
					}
					const userSkills = (deps.skills?.list() ?? []).filter((skill) => skill.source !== "builtin").length;
					const customRoles = outcome.kept.length;
					const userSkillsText = userSkills === 0 ? "没有自建/导入/系统技能" : `你的 ${userSkills} 条自建/导入/系统技能`;
					const customRolesText = customRoles === 0 ? "没有自建角色" : `${customRoles} 个自建角色`;
					return accept(sessionId, [
						`已恢复 ${outcome.restored.length} 个内置角色（名称/描述/提示词/技能/模型全部回到内置值）`,
						skillsNote !== "" ? skillsNote : `已把 ${restoredSkills.length} 条内置技能恢复为出厂正文（已修改标记清除）`,
						`${userSkillsText}与${customRolesText}未受影响`
					]);
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
		/**
		* r14 AC-1：同步预检（工具受理制的「先问能不能派」）。
		*
		* 纯函数式读一次状态，不产生任何副作用：既可以把回答原样写进工具返回值，
		* 也可以被面板在点按钮前拿来禁用 —— 两处结论必须一致，因为判据同源。
		*/
		precheckDispatch(sessionId, runId) {
			return admissionOf(sessionId, runId);
		},
		/**
		* r13 AC-21/AC-22：左栏项目库。装配在 `host/library.ts`（带缓存），这里只转派；
		* 未装配时返回空库 —— 空库是「没有数据」，不是「假装没有项目」（PRD 反模式）。
		*/
		library(query) {
			const view = deps.libraryView;
			if (typeof view === "function") return view(query);
			return {
				projects: [],
				global: { memories: [] }
			};
		},
		async readMemoryFile(track, name, workspace) {
			const safe = safeMemoryName(name);
			if (safe === null) return { error: "非法文件名" };
			const roots = rootsFor(workspace);
			if (roots === null) return { error: `未授权的工作区：${workspace ?? ""}` };
			if (!listMemory(track, roots).some((file) => file.name === safe)) return { error: `记忆文件不存在：${track}/${safe}` };
			const body = readMemory(track, safe, roots);
			return { data: {
				track,
				name: safe,
				body,
				chars: body.length
			} };
		},
		/**
		* r10 AC-17：技能正文（`GET /memory?track=skill&name=<id>` 的唯一实现）。
		*
		* 正文**按需读**：快照里只放 id/标题/描述，弹层打开时才读一次正文 ——
		* 12 条内置技能正文若全进快照，每次 2s 轮询都会多传几十 KB。
		*/
		async readSkillBody(id) {
			const repo = deps.skills;
			if (repo === void 0) return { error: "技能仓储未装配：无法读取技能正文" };
			const key = typeof id === "string" ? id.trim() : "";
			if (key === "") return { error: "技能 id 不能为空" };
			const read = repo.readBody(key);
			if (read.error !== void 0) return { error: read.error };
			return { data: {
				id: key,
				title: repo.get(key)?.title ?? key,
				body: read.data,
				chars: read.data.length
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
		ctx.logger?.warn?.(`[auto-team] 读取可选服务 ${name} 失败（${messageOf$2(error)}），按缺失降级`);
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
* 订阅宿主事件 —— **唯一入口**（r13 真机事故后收口）。
*
* 为什么不能直接 `ctx.on(...)`：cordis 派发时按作用域过滤监听器
* （`hook.global || !filter || filter.call(thisArg, hook.ctx)`），插件自己的 ctx 是 root 的
* 兄弟分支，会话/工具作用域的事件过滤后**一条都送不到**。2026-11-04 真机实测：成员确实在跑、
* 会话日志里 assistant/message 带着 usage，而 run JSON 里 `usage`/`routeAudits`/`progress`/
* `triggers` 全空 —— 单测的 fake ctx 不实现过滤，所以一直绿。
*
* 两条路一起走，任一可用即可：
*  1. 在 `ctx.root` 上注册（root 是所有作用域的公共祖先，过滤必通过）；
*  2. 注册时置 `{ global: true }`，按 cordis 的语义直接跳过过滤。
* 拿不到 root 又没有 global 选项时退回普通订阅（至少与旧行为等价，不会更差）。
*/
function subscribeHostEvent(ctx, event, listener) {
	const root = ctx.root;
	const target = root && typeof root.on === "function" && root !== ctx ? root : ctx;
	const on = target.on;
	if (typeof on !== "function") return;
	try {
		return on.call(target, event, listener, { global: true });
	} catch (error) {
		try {
			return on.call(target, event, listener);
		} catch {
			throw error;
		}
	}
}
/**
* r10 AC-16：读一次宿主的模型清单（**唯一的 llm 清单读口**，缓存与 TTL 在 model-catalog.ts）。
*
* 三条纪律：
*  1. **绝不抛**：任何缺失/形状不符/调用异常都收敛成 `{ groups: [], failures: [], reason }`。
*     快照侧是同步 API，一次未捕获的 reject 会让整个面板轮询卡死（比没有清单严重得多）。
*  2. **逐层宽松归一**：宿主返回 `string[]` / `{ id, name }[]` / `{ models: [...] }` /
*     `{ data: [...] }` 都接受 —— 真实形状尚未实测（见 HostContext.llm 的 [未核] 注记）。
*  3. **单 provider 失败不整体失败**：某provider 的 `listModels` 抛错就把它的名字记进
*     `failures`，其余 provider 照常显示（面板会把这句写进 reason）。
*/
async function readModelCatalog(ctx) {
	const missing = {
		groups: [],
		failures: [],
		reason: "宿主未提供模型清单（llm 服务不可用）"
	};
	const llm = optionalService(ctx, "llm");
	if (llm === void 0 || typeof llm.listProviders !== "function") return missing;
	let providersRaw;
	try {
		providersRaw = llm.listProviders();
	} catch (error) {
		return {
			groups: [],
			failures: [],
			reason: `宿主模型清单读取失败：${messageOf$2(error)}`
		};
	}
	const providers = normalizeCatalogEntries(providersRaw);
	if (providers.length === 0) return {
		groups: [],
		failures: [],
		reason: "宿主未提供模型清单（llm 服务没有列出任何 provider）"
	};
	const listModels = llm.listModels;
	const settled = await Promise.all(providers.map(async (provider) => {
		if (typeof listModels !== "function") return {
			provider,
			models: [],
			message: "宿主不支持 listModels"
		};
		try {
			return {
				provider,
				models: normalizeCatalogEntries(await listModels.call(llm, provider.id)),
				message: void 0
			};
		} catch (error) {
			return {
				provider,
				models: [],
				message: messageOf$2(error)
			};
		}
	}));
	const groups = [];
	const failures = [];
	for (const item of settled) {
		if (item.models.length > 0) {
			groups.push({
				id: item.provider.id,
				name: item.provider.name,
				models: item.models.map((model) => ({
					id: model.id,
					name: model.name
				}))
			});
			continue;
		}
		failures.push({
			id: item.provider.id,
			name: item.provider.name,
			message: item.message ?? "未列出任何模型"
		});
	}
	return {
		groups,
		failures
	};
}
/** 把宿主五花八门的清单返回值压成 `{ id, name }[]`（`string[]` 也接受，name 缺省取 id）。 */
function normalizeCatalogEntries(raw) {
	const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.models) ? raw.models : isRecord(raw) && Array.isArray(raw.data) ? raw.data : isRecord(raw) && Array.isArray(raw.items) ? raw.items : isRecord(raw) && Array.isArray(raw.providers) ? raw.providers : [];
	const entries = [];
	for (const item of list) {
		if (typeof item === "string") {
			if (item !== "") entries.push({
				id: item,
				name: item
			});
			continue;
		}
		if (!isRecord(item)) continue;
		const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
		if (id === "") continue;
		const name = typeof item.name === "string" && item.name !== "" ? item.name : id;
		entries.push({
			id,
			name
		});
	}
	return entries;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* 把工具返回值整理成「lossless JSON」：宿主会拒收含 `undefined` 值的返回
* （实测原文 `tool "auto_team_status" returned invalid output: value is not lossless JSON`，
* 因为 `JSON.stringify` 会把 undefined 键丢掉，宿主据此判定有信息损失）。
*
* r12 真机事故：`auto_team_status` 在「还没计划」时返回 `runId/planStatus/plannedAt = undefined`，
* 任务未派发时 `memberId`、无门禁证据时 `evidence` 也是 undefined —— 于是**只要还没有计划，
* 队长就查不了状态**；单测全绿是因为没人按宿主口径校验「返回值可无损序列化」。
*
* 收口放在 `execute` 这一处（8 个工具共用），比逐个工具手改更难漏。语义：
* 对象里值为 undefined/函数/Symbol 的键**丢掉**；数组里这类元素换 null（保住位置）；
* NaN/Infinity 换 null；bigint 转字符串；循环引用换 null。
*/
function losslessJson(value, seen = /* @__PURE__ */ new WeakSet()) {
	if (value === void 0 || typeof value === "function" || typeof value === "symbol") return void 0;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "bigint") return value.toString();
	if (value === null || typeof value !== "object") return value;
	if (seen.has(value)) return null;
	seen.add(value);
	if (Array.isArray(value)) return value.map((item) => {
		const next = losslessJson(item, seen);
		return next === void 0 ? null : next;
	});
	const out = {};
	for (const [key, item] of Object.entries(value)) {
		const next = losslessJson(item, seen);
		if (next !== void 0) out[key] = next;
	}
	return out;
}
/**
* [已核] ToolDefinition = ToolSchema & { output: ToolOutputDefinition, execute(args, exec) }
*   ToolSchema        = { name, description, parameters }
*   ToolOutputDefinition = { schema: JsonSchemaNode, render(args, value): ContentBlock[] }
* 缺 `output` 会让宿主在 register 或首次调用时报错，因此这里必须补齐。
* `execute` 统一过 `losslessJson`（见上，r12 真机事故）。
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
		execute: async (args, meta) => losslessJson(await spec.handler(args, meta))
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
		ctx.logger?.warn?.(`[auto-team] 工具注册失败：${spec.name}（${messageOf$2(error)}）`);
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
		ctx.logger?.warn?.(`[auto-team] 队长提示词段落注入失败（${messageOf$2(error)}）`);
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
			ctx.logger?.warn?.(`[auto-team] 面板路由注册失败（${messageOf$2(error)}）`);
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
		ctx.logger?.warn?.(`[auto-team] 等待 webServer 就绪失败（${messageOf$2(error)}）`);
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
/**
* spawn 请求里 `provider` 的默认值：**subagent provider 名**（不是 LLM provider）。
*
* 本机 `subagents.list()` 实测只有 `spawn`（宿主内置的 fresh-context 子会话实现），
* `spawn_teammate` 工具自己统计到的成员 `provider` 也是它。读不到注册表时退回它，
* 由宿主给出明确报错（r12 事故：这里曾填 LLM provider，派发 100% 失败）。
*/
const DEFAULT_SUBAGENT_PROVIDER = "spawn";
/**
* `interrupt(caller, name)` 的返回形状**未核实**（只核实了宿主有这个方法），所以宽松归一
* 只能放在宿主边界这一处 —— bridge/dispatch 只消费 `{ ok, error? }`，端口不漂移。
*
* 口径：`void`/`undefined` 视为已受理（命令式 API 多数不返回值）；显式 `ok` 布尔优先；
* 只带 `error`/`message` 字符串视为失败；其余一律按已受理 —— `cancelled` 状态是权威，
* 成员是否真停由 watcher 对账，所以这里猜错也不会让状态机错。
*/
function normalizeInterruptResult(value) {
	if (value === void 0 || value === null) return { ok: true };
	if (typeof value === "boolean") return { ok: value };
	if (typeof value === "object") {
		const row = value;
		const error = typeof row.error === "string" && row.error !== "" ? row.error : typeof row.message === "string" && row.message !== "" ? row.message : void 0;
		if (typeof row.ok === "boolean") return error === void 0 ? { ok: row.ok } : {
			ok: row.ok,
			error
		};
		if (error !== void 0) return {
			ok: false,
			error
		};
	}
	return { ok: true };
}
/**
* [已核] SpawnTeammateRequest = { name, description, prompt: ContentBlock[], context: 'fresh'|'fork', provider, signal }
*   SpawnTeammateResult  = { member: TeamMemberView }，member.id + member.name 是我们要的两件事。
*
* **`provider` 是 subagent provider 名，不是 LLM provider 名**（r12 真机事故定案）：
* 宿主拿它去 `subagents.getProvider(name)` 查已注册实现（本机只有 `spawn`，见
* `subagents.list(): string[]`），查不到就报
* `no subagent provider registered for "<name>"` 并让整个 spawn 失败。
* 过去这里塞的是角色的 LLM provider（`opencode-go`），于是**任何一次派发都必然失败**；
* 单元测试与探针都没发现，因为探针会话先被「只有 Lead 能建成员」拦住了。
*
* 逐角色模型的正确通道是 `SubagentStartRequest.agentOptions?: AgentOptions =
* { provider?, model?, reasoningEffort?, maxTokens? }`（宿主 `subagents` 服务契约原文），
* 由 spawn 请求的 `agentOptions` 字段带下去。`installMemberRoute`（`agent/created` 里装
* member-scoped 路由）保留为第二道保险：宿主版本忽略 `agentOptions` 时它仍能改写模型。
*/
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
	/**
	* 组 spawn 请求时要填的 **subagent provider 名**（≠ LLM provider）。
	*
	* 宿主 `subagents.list()` 给出已注册名字（本机只有 `spawn`）。优先选 `spawn`
	* （宿主内置的 fresh-context 子会话实现），否则取第一个已注册的；读不到就退回
	* `DEFAULT_SUBAGENT_PROVIDER`（与 `spawn_teammate` 工具自身用的默认一致）。
	*/
	function subagentProviderName() {
		try {
			const rows = readServiceQuietly(ctx, "subagents")?.list?.();
			const registered = Array.isArray(rows) ? rows.filter((row) => typeof row === "string" && row !== "") : [];
			if (registered.includes(DEFAULT_SUBAGENT_PROVIDER)) return DEFAULT_SUBAGENT_PROVIDER;
			if (registered.length > 0) return registered[0];
		} catch {}
		return DEFAULT_SUBAGENT_PROVIDER;
	}
	/** 角色声明 / 会话默认的 **LLM** 路由；`agentOptions` 与成员路由都用它。 */
	function modelRouteOf(input) {
		const route = input.route;
		const provider = route?.provider ?? fallbackProvider();
		if (provider === "" && route?.model === void 0) return void 0;
		return {
			provider,
			model: route?.model ?? "",
			...route?.reasoningEffort === void 0 ? {} : { reasoningEffort: route.reasoningEffort }
		};
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
			const provider = subagentProviderName();
			const modelRoute = modelRouteOf(input);
			const agentOptions = modelRoute === void 0 ? void 0 : {
				...modelRoute.provider === "" ? {} : { provider: modelRoute.provider },
				...modelRoute.model === "" ? {} : { model: modelRoute.model },
				...modelRoute.reasoningEffort === void 0 ? {} : { reasoningEffort: modelRoute.reasoningEffort }
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
					...agentOptions === void 0 ? {} : { agentOptions },
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
		},
		/**
		* 尽力中断（r11 AC-26）：只被「取消一个 running 任务」调用。
		*
		* 失败**不是**动作失败：bridge 把 `error` 折进一条 notice，任务状态照常落 `cancelled`
		* —— 否则用户点一次「取消」会得到红字而状态没变，比不中断更糟。
		*/
		async interruptMember(name) {
			const interrupt = teams?.interrupt;
			if (typeof interrupt !== "function") return {
				ok: false,
				error: "宿主未提供 interrupt 能力（成员不会被中断，任务状态照常取消）"
			};
			const caller = resolveCaller(ctx);
			if (!caller) return {
				ok: false,
				error: NO_CALLER
			};
			try {
				return normalizeInterruptResult(await interrupt.call(teams, caller, name));
			} catch (error) {
				return {
					ok: false,
					error: `中断成员失败：${error instanceof Error ? error.message : String(error)}`
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
			ctx.logger?.warn?.(`[auto-team] 模型路由解析失败：${route.provider}/${route.model}（${messageOf$2(error)}）`);
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
		ctx.logger?.warn?.(`[auto-team] effect 注册失败（${messageOf$2(error)}）`);
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
* 订阅「队长自己调用了工具」的结果（r11 F7 的唯一观察点）。
*
* 为什么订阅**根作用域**而不是 `captainAgentScopeOf(ctx)`：`ctx.agents.currentInitiator()`
* 在 `apply` 时刻往往还是空（那是工具执行期的异步链上下文），按队长作用域注册会得到
* 「注册时拿不到 → 一条都不记」——真机上的症状正是「面板永远没有执行痕迹」。
* 根作用域的 `tools/result` 会收到所有 agent 的调用，所以**在监听器里按 `exec.agent`
* 缺省过滤**：缺省即队长（与 `team/guard.ts` 的 `agentId===null → captain` 同口径），
* 有 `agent.id` 一律按成员跳过。这样判定只有一处，也不依赖装配时机。
*
* 只观察、不拦截：本函数不调用 `next()`、不改任何结果；监听器异常自己吞掉并 warn。
*/
function onCaptainToolResult(ctx, handler) {
	let dispose = void 0;
	try {
		dispose = subscribeHostEvent(ctx, "tools/result", (...args) => {
			try {
				const exec = args[0];
				if (!exec || typeof exec !== "object") return;
				if (agentOfToolEvent(exec) !== void 0) return;
				const row = exec;
				if (typeof row.name !== "string" || row.name === "") return;
				handler({
					toolName: row.name,
					args: row.arguments
				});
			} catch (error) {
				ctx.logger?.warn?.(`[auto-team] 队长留痕处理失败（已忽略，不影响工具结果）：${messageOf$2(error)}`);
			}
		});
	} catch (error) {
		ctx.logger?.warn?.(`[auto-team] 订阅 tools/result 失败（队长留痕不生效）：${messageOf$2(error)}`);
	}
	return { stop() {
		try {
			dispose?.();
		} catch {}
	} };
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
	if (typeof ctx.on !== "function" && typeof ctx.root?.on !== "function") {
		ctx.logger?.warn?.("[auto-team] 宿主未提供 ctx.on：停滞判定降级为「以派发时间为基线」");
		return { stop() {} };
	}
	const disposers = [];
	const subscribe = (event, agentOf) => {
		try {
			const dispose = subscribeHostEvent(ctx, event, (...args) => {
				try {
					const agent = agentOf(args);
					if (agent === void 0) return;
					handler({
						agent,
						at: Date.now()
					});
				} catch (error) {
					ctx.logger?.warn?.(`[auto-team] 推进事件处理失败（${messageOf$2(error)}）`);
				}
			});
			if (typeof dispose === "function") disposers.push(dispose);
		} catch (error) {
			ctx.logger?.warn?.(`[auto-team] 订阅 ${event} 失败（${messageOf$2(error)}）`);
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
	if (!ctx.on && !ctx.root?.on) {
		ctx.logger?.warn?.("[auto-team] 宿主未提供事件订阅，成员将按 provider 默认模型运行");
		return false;
	}
	try {
		subscribeHostEvent(ctx, "agent/created", (payload) => {
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
				ctx.logger?.warn?.(`[auto-team] agent/created 处理失败（${messageOf$2(error)}）`);
			}
		});
		return true;
	} catch (error) {
		ctx.logger?.warn?.(`[auto-team] agent/created 订阅失败（${messageOf$2(error)}）`);
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
function messageOf$2(error) {
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
	if (!(typeof ctx.on === "function" || typeof ctx.root?.on === "function")) {
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
			ctx.logger?.warn?.(`[auto-team] noWait 守卫判定异常，本次放行（${messageOf$2(error)}）`);
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
		const dispose = subscribeHostEvent(ctx, "tools/execute", listener);
		return typeof dispose === "function" ? () => {
			try {
				dispose();
			} catch {}
		} : () => {};
	} catch (error) {
		ctx.logger?.warn?.(`[auto-team] noWait 守卫订阅失败，队长仍可能前台同步长等待（${messageOf$2(error)}）`);
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
	if (typeof ctx.on !== "function" && typeof ctx.root?.on !== "function") {
		ctx.logger?.warn?.("[auto-team] 宿主未提供 ctx.on：Trigger 事件源不可用，四类推进退回轮询兜底");
		return {
			stop() {},
			degraded: true
		};
	}
	const disposers = [];
	let failed = 0;
	for (const name of TRIGGER_EVENT_NAMES) try {
		const dispose = subscribeHostEvent(ctx, name, (...args) => {
			try {
				handler(name, payloadOfEvent(name, args));
			} catch (error) {
				ctx.logger?.warn?.(`[auto-team] Trigger 事件处理失败（${name}：${messageOf$2(error)}）`);
			}
		});
		if (typeof dispose === "function") disposers.push(dispose);
	} catch (error) {
		failed += 1;
		ctx.logger?.warn?.(`[auto-team] 订阅 ${name} 失败：该类 Trigger 退回轮询兜底（${messageOf$2(error)}）`);
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
/**
* 订阅根作用域 `session/event`（后提交追加流，r13 AC-3 的用量事件源）。
*
* 为什么不在这里解析字段：payload 形状**未实测**（U1），归一化全部交给纯函数
* `team/usage.ts` 的 `usageOfSessionEvent`（可单测、可 fail-open）；本文件只负责订阅本身。
*
* fail-open 语义（与 `onHostTriggerEvents` 同一纪律）：
*   - `ctx.on` 不存在 → warn + `degraded: true`，用量显示「不可得」，装配继续；
*   - 订阅抛错 → warn + `degraded: true`，绝不冒泡到 entry（否则整条插件不激活）；
*   - 监听器内 handler 抛错 → warn，不影响宿主事件链（宿主虽隔离，自己兜一层才看得到原因）。
*/
function onSessionEvents(ctx, handler) {
	if (typeof ctx.on !== "function" && typeof ctx.root?.on !== "function") {
		ctx.logger?.warn?.("[auto-team] 宿主未提供 ctx.on：session/event 不可用，token 用量显示「不可得」");
		return {
			stop() {},
			degraded: true
		};
	}
	let dispose;
	try {
		dispose = subscribeHostEvent(ctx, "session/event", (...args) => {
			try {
				handler(args.length <= 1 ? args[0] : args);
			} catch (error) {
				ctx.logger?.warn?.(`[auto-team] 用量事件处理失败（session/event：${messageOf$2(error)}）`);
			}
		});
	} catch (error) {
		ctx.logger?.warn?.(`[auto-team] 订阅 session/event 失败：token 用量显示「不可得」（${messageOf$2(error)}）`);
		return {
			stop() {},
			degraded: true
		};
	}
	return {
		degraded: false,
		stop() {
			if (typeof dispose !== "function") return;
			try {
				dispose();
			} catch {}
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
/**
* 受理成功文案（r14 AC-1）：**逐字**，被 PRD/TECHNICAL 与测试同时 grep。
* 它必须同时回答三件事：已经接下、成员还在后台、失败去哪儿看 —— 少一句用户就会去轮询。
*/
const DISPATCH_ACCEPTED_TEXT = "已接受派发：成员在后台创建，失败会显示在活动流";
/**
* 未装配自动派发时的降级说明（只可能出现在单测桩里：生产装配层 `host/index.ts` 必定接线）。
*
* 为什么不是「直接失败」：`test/bridge.test.ts` 的 dispatch 用例构造 `buildToolSpecs` 时
* 没有 autoDispatch 却要求同步派发成功，那是 r13 的既有契约。这里的处理是**如实降级**：
* 走回同步 `bridge.act`，返回真实结果并显式 `accepted:false` —— 既不假装受理，也不让旧行为失效。
*/
const DISPATCH_SYNC_NOTE = "派发端口未装配（宿主未接自动派发），本次退回同步派发：返回时成员已创建。";
/** 成员投影（dispatch 与 status 工具共用的那一份，避免两处字段慢慢分叉）。 */
function memberBrief(member) {
	return {
		memberId: member.memberId,
		name: member.name,
		roleId: member.roleId,
		taskId: member.taskId,
		status: member.status,
		modelRoute: member.modelRoute
	};
}
/**
* 当前会话 id：面板按会话隔离，工具必须**认到同一个会话**——否则就是「面板里开关打开了，
* 工具还一律回未启用」，用户看到的是「开了自动团队但它从不干活」。
*
* 宿主真实形状是 `ToolDefinition.execute(args, exec: ToolRunContext)`：`exec` 上**没有**
* `sessionId` / `session` 字段，只有 `agent: Agent { readonly id: SessionId }`
* （`cordis_inspect_query` 的 `ToolExecutionInput` 声明可在 HOST-EVENTS.md 查到），
* 所以**必须优先读 `agent.id`**。r11 修复前这里只认 `sessionId` / `session.id`，
* 真机上一律退回 `'current'`：面板把开关记在真实会话 id 上，工具却查 `'current'`，
* 于是七个工具全部返回 NOT_ENABLED。`sessionId` / `session.id` 保留为简化形状
* （面板 HTTP 入口、单测桩）的兜底。
*/
function sessionOf(meta) {
	const value = meta;
	return value?.agent?.id ?? value?.sessionId ?? value?.session?.id ?? "current";
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
/**
* 任务输入的 JSON Schema（`auto_team_plan` 与 `auto_team_add_tasks` **共用一份**）。
*
* 两个工具收的是同一种条目：分开写就会在「plan 有 writeScopes、add_tasks 忘了」这类
* 细枝末节上分叉，而模型看不见的字段等于不存在（它会照旧不声明写域）。
*/
const TASK_ITEM_SCHEMA = {
	type: "object",
	properties: {
		id: {
			type: "string",
			description: "任务 id，缺省按 t1/t2… 生成（追加时不得与既有 id 重复）"
		},
		title: { type: "string" },
		roleId: {
			type: "string",
			description: "执行该任务的角色 id"
		},
		dependsOn: {
			type: "array",
			items: { type: "string" },
			description: "依赖的任务 id（可指向既有任务，也可指向同批新任务）"
		},
		acceptance: {
			type: "string",
			description: "验收命令（门禁据此产出证据）；不能是空白字符串，空验收会整批拒绝"
		},
		writeScopes: {
			type: "array",
			items: { type: "string" },
			description: "写域：本任务预计改动的文件或目录（目录边界互斥，冲突的任务排队等待，释放后通知）"
		}
	},
	required: ["title", "roleId"]
};
/**
* 草稿任务的「调用方认得出的标识」：显式 id 优先，否则按 `buildPlan` 的规则补 `t<index+1>`。
*
* 拒绝文案里必须出现任务 id（AC-6 的判据之一），而此刻 `buildPlan` 可能还没跑，
* 所以 id 生成规则要跟它一致——不一致就会出现「报 t2、实际落 t3」这种最难查的漂移。
*/
function draftIdOf(task, index) {
	const id = typeof task?.id === "string" ? task.id.trim() : "";
	return id === "" ? `t${index + 1}` : id;
}
/**
* 写域归一（工具侧唯一入口，AC-12/AC-13）：任一条非法 → 整批拒绝。
*
* 这里**必须**调 `plan/scope.ts`，不许内联 `startsWith` 之类的判据：
* 目录边界规则（`src/host` 冲突 `src/host/bridge.ts`、不冲突 `src/hostile.ts`）只有一处实现，
* 工具侧再写一份就会与 dispatch 侧的冲突判定分叉。
*/
function normalizeDraftScopes(tasks) {
	const out = [];
	for (const [index, raw] of tasks.entries()) {
		if (raw === null || typeof raw !== "object") return {
			ok: false,
			error: `新增任务的第 ${index + 1} 条不是对象`
		};
		const normalized = normalizeWriteScopes(raw.writeScopes);
		if (!normalized.ok) return {
			ok: false,
			error: `写域不合法（任务 ${draftIdOf(raw, index)}）：${normalized.error}`
		};
		const next = { ...raw };
		if (normalized.scopes.length > 0) next.writeScopes = normalized.scopes;
		else delete next.writeScopes;
		out.push(next);
	}
	return {
		ok: true,
		tasks: out
	};
}
/**
* 空验收整批拒绝文案（AC-6）：没有违规任务时返回 `null`。
*
* **所有**违规任务一次列全（不是报第一条就停）：模型下一轮要能一次改对，
* 否则会陷入「改一条、再被拒一条」的往返。可自动选中的任务顺带给出完整命令。
*/
function emptyAcceptanceOf(tasks, scripts) {
	const violations = tasks.filter((task) => task.acceptance.trim() === "").map((task) => ({
		id: task.id,
		title: task.title
	}));
	if (violations.length === 0) return null;
	const suggestions = /* @__PURE__ */ new Map();
	for (const violation of violations) {
		const task = tasks.find((item) => item.id === violation.id);
		suggestions.set(violation.id, suggestAcceptance({
			title: task?.title ?? "",
			writeScopes: task?.writeScopes,
			scripts
		}));
	}
	return emptyAcceptanceError(violations, suggestions);
}
/**
* 已收口 run 的追加拒绝文案（AC-10）：含 runId 与当前状态中文。
*
* 判定权归 `extendPlan`（它才知道哪些状态算收口），这里只在它拒绝之后**补齐上下文**：
* 光有「计划已取消，不能再追加任务」模型不知道该换 runId 还是该开新计划。
*/
function closedRunReason(plan, runId) {
	if (plan.status !== "cancelled" && plan.status !== "terminated") return null;
	return `该 run ${runId} ${plan.status === "cancelled" ? "已取消" : "已终止"}，不能再追加任务（请先 auto_team_plan 开新计划）`;
}
function buildToolSpecs(deps) {
	return [
		{
			name: `${TOOL_PREFIX}plan`,
			description: `把一个目标拆成有依赖的任务图并生成执行计划（不创建任何成员）。每个任务需要 roleId 与 acceptance（可执行的验收命令）。**单任务计划合法**：哪怕只有一件小事、只改一处，也必须走这里拆成 1 个任务并派 1 个成员去做——简单任务同样属于团队，队长不自己动手。验收命令必须真能执行（exit 0 才算过），可直接用：${ACCEPTANCE_TEMPLATES.join(" / ")}（尖括号换成实际值）。返回 runId，派发时必须带上它；后续要加任务用 auto_team_add_tasks，不要新开计划。`,
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
						description: "任务列表（依赖必须指向同一列表里的 id；1 条也合法）",
						items: TASK_ITEM_SCHEMA
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
				const scoped = normalizeDraftScopes(Array.isArray(args.tasks) ? args.tasks : []);
				if (!scoped.ok) return {
					ok: false,
					code: "BAD_REQUEST",
					error: scoped.error
				};
				const at = deps.now();
				const draft = buildPlan({
					sessionId,
					goal: typeof args.goal === "string" ? args.goal : "",
					maxConcurrent: typeof args.maxConcurrent === "number" ? args.maxConcurrent : void 0,
					tasks: scoped.tasks
				}, uniqueRunId(deps.store, sessionId, at), at);
				if (!draft.ok) return {
					ok: false,
					code: "BAD_REQUEST",
					error: draft.reason
				};
				const emptyAcceptance = emptyAcceptanceOf(draft.plan.tasks, deps.scripts);
				if (emptyAcceptance !== null) return {
					ok: false,
					code: "BAD_REQUEST",
					error: emptyAcceptance
				};
				const state = {
					version: 3,
					plan: draft.plan,
					plannedAt: at,
					messages: [],
					bindings: [],
					routeAudits: [],
					...deps.workspace === void 0 ? {} : { project: deps.workspace }
				};
				deps.store.save(state);
				deps.autoDispatch?.(sessionId, draft.plan.runId, "plan-saved");
				return {
					ok: true,
					runId: draft.plan.runId,
					plannedAt: state.plannedAt,
					maxConcurrent: draft.plan.maxConcurrent,
					tasks: draft.plan.tasks.map(taskBrief),
					ready: readyTasks(draft.plan.tasks),
					blocked: blockedTasks(draft.plan.tasks),
					members: 0,
					note: "计划已保存；符合依赖与并发条件的任务会自动派发，无需再手动调用 dispatch。"
				};
			}
		},
		{
			name: `${TOOL_PREFIX}dispatch`,
			description: "按依赖顺序派发就绪任务并创建成员（并发受 maxConcurrent 与宿主上限限制）。必须带 plan 返回的 runId。**本工具受理后立即返回**（accepted/dispatching）：成员在后台创建，你不需要、也不应该在同一轮等待成员；进度用 auto_team_status 查，失败了会在下一次返回里看到。",
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
				const admission = deps.bridge.precheckDispatch(sessionId, runId);
				if (!admission.ok) return {
					ok: false,
					code: admission.code,
					error: admission.message
				};
				if (deps.autoDispatch === void 0) {
					const result = await deps.bridge.act(sessionId, {
						type: "dispatch",
						runId
					});
					const rejected = rejectedOf(result);
					if (rejected) return rejected;
					const snapshot = result.snapshot;
					return {
						ok: true,
						accepted: false,
						dispatching: false,
						runId: snapshot.runId,
						planStatus: snapshot.planStatus,
						ready: admission.ready,
						tasks: snapshot.tasks.map(taskBrief),
						members: snapshot.members.map(memberBrief),
						notices: [...result.notices ?? [], DISPATCH_SYNC_NOTE]
					};
				}
				deps.autoDispatch(sessionId, runId, "manual");
				const snapshot = deps.bridge.snapshot(sessionId);
				return {
					ok: true,
					accepted: true,
					dispatching: true,
					runId: admission.runId,
					planStatus: snapshot.planStatus,
					ready: admission.ready,
					tasks: snapshot.tasks.map(taskBrief),
					members: snapshot.members.map(memberBrief),
					notices: [DISPATCH_ACCEPTED_TEXT]
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
					dispatch: (deps.dispatchReports?.(sessionId) ?? []).map((report) => ({
						cause: report.cause,
						attempted: report.attempted,
						started: report.started,
						failed: report.failed,
						skipped: report.skipped,
						errors: report.errors,
						...report.reason === void 0 ? {} : { reason: report.reason }
					})),
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
		},
		{
			name: `${TOOL_PREFIX}add_tasks`,
			description: `往**已存在的**计划里追加任务（同一个 runId：不新建 run、面板不跳回空白）——任务跑到一半又想到新活时用它，不要重新 auto_team_plan。幂等：内容完全相同的条目进 skipped、added 为空、任务总数不变；原子：任一条验收为空 / 写域非法 / 依赖不存在或成环，整批拒绝且一条都不落盘。追加出来的任务一律处于待派发，下一次 auto_team_dispatch 会连它们一起捕获。验收命令必须真能执行（exit 0 才算过），可直接用：${ACCEPTANCE_TEMPLATES.join(" / ")}（尖括号换成实际值）。`,
			parameters: {
				type: "object",
				properties: {
					runId: {
						type: "string",
						description: "auto_team_plan 返回的 runId（必填；追加不会新建 run）"
					},
					tasks: {
						type: "array",
						description: "要追加的任务（id 缺省按 t<next> 递增；依赖可指向既有任务或同批任务）",
						items: TASK_ITEM_SCHEMA
					}
				},
				required: ["runId", "tasks"]
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
					code: "NO_PLAN",
					error: "auto_team_add_tasks 必须带 runId：追加是「改变既有计划」而不是新建 run。先 auto_team_plan 拿 runId（或 auto_team_status 读当前的）。"
				};
				const state = deps.store.load(runId);
				if (!state || state.plan.sessionId !== sessionId) return {
					ok: false,
					code: "NOT_FOUND",
					error: `找不到运行 ${runId}：当前会话没有这个 runId（本工具不会新建 run，请先 auto_team_plan）`
				};
				const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
				if (rawTasks.length === 0) return {
					ok: false,
					code: "BAD_REQUEST",
					error: "tasks 不能为空：追加至少要带 1 条任务"
				};
				const scoped = normalizeDraftScopes(rawTasks);
				if (!scoped.ok) return {
					ok: false,
					code: "BAD_REQUEST",
					error: scoped.error
				};
				const emptyAcceptance = emptyAcceptanceOf(scoped.tasks.map((task, index) => ({
					id: draftIdOf(task, index),
					title: (task.title ?? "").trim(),
					acceptance: (task.acceptance ?? "").trim(),
					writeScopes: task.writeScopes
				})), deps.scripts);
				if (emptyAcceptance !== null) return {
					ok: false,
					code: "BAD_REQUEST",
					error: emptyAcceptance
				};
				const extended = extendPlan(state.plan, scoped.tasks, deps.now());
				if (!extended.ok) return {
					ok: false,
					code: "BAD_REQUEST",
					error: closedRunReason(state.plan, runId) ?? extended.reason
				};
				if (extended.added.length > 0) deps.store.save({
					...state,
					plan: extended.plan
				});
				if (extended.added.length > 0) deps.autoDispatch?.(sessionId, extended.plan.runId, "tasks-added");
				return {
					ok: true,
					runId: extended.plan.runId,
					added: extended.added,
					skipped: extended.skipped,
					tasks: extended.plan.tasks.length,
					ready: readyTasks(extended.plan.tasks),
					note: extended.added.length === 0 ? "所有条目与既有任务内容相同，已跳过（计划未改动，runId 不变）。" : "已追加进同一个计划（runId 不变）；下一次 auto_team_dispatch 会连新任务一起捕获。"
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
/** 硬约束（AC-1 的可 grep 特征句；r14 追加「受理后立即结束本轮」一条）：独立成段放在「工作方式」之前。 */
const CAPTAIN_CONSTRAINTS = [
	"- 你**不亲自干细活**：读文件、改代码、跑测试、修 bug 一律派给成员。",
	"- 你**只做三件事**：拆解目标、分派任务、验收结果。",
	"- **不要同步等长任务**：任何可能超过 5 秒的命令都必须后台执行（命令末尾加 `&`）或派给成员；前台 `sleep` 会被 noWait 守卫直接拒绝并返回错误码。",
	"- **派发后立即结束本轮，不要等待成员**：`auto_team_dispatch` 返回「已接受派发」即表示后台已接手；成员不是宿主队友、不需要你等，也不要在同一轮反复查状态或轮询——用户会带着进展回来。"
];
function captainSection(deps, sessionId) {
	const snapshot = deps.bridge.snapshot(sessionId);
	const lines = [
		"## 自动团队（队长视角）",
		"本插件按会话启用：开关是输入框工具条里的「自动团队」选项，状态以它和面板为准（本段不替你断言当前会话是否已开）。",
		"开关没开时 `auto_team_*` 工具会直接返回「未启用」：那时用一句话告诉用户在哪里打开，不要假设已开启、也不要自行创建成员。",
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
			path: `${BRIDGE_ROUTE}/library`,
			async handle(request) {
				const query = parseQuery(request.url);
				const sessionId = query.get("sessionId") ?? deps.defaultSessionId();
				const runId = query.get("runId");
				const call = {
					...sessionId === "" ? {} : { sessionId },
					...runId === void 0 ? {} : { runId }
				};
				return { data: deps.library !== void 0 ? deps.library(call) : deps.bridge.library(call) };
			}
		},
		{
			method: "GET",
			path: `${BRIDGE_ROUTE}/memory`,
			async handle(request) {
				const query = parseQuery(request.url);
				const name = query.get("name") ?? "";
				if (name.trim() === "") return { error: "非法文件名" };
				const raw = query.get("track");
				if (raw === "skill") return deps.bridge.readSkillBody(name);
				const track = raw === "public" ? "public" : raw === "project" ? "project" : null;
				if (track === null) return { error: "track 必须是 public、project 或 skill" };
				const workspace = query.get("workspace");
				return deps.bridge.readMemoryFile(track, name, workspace);
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
			next = releaseScopes(next, task.id, at);
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
			next = releaseScopes(next, task.id, at);
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
// src/host/team/deviation.ts
/**
* 队长亲手写文件的留痕（r11 F7 / AC-22~AC-24）。
*
* 为什么单独成模块：这里同时有「纯语义」（哪些工具算写文件、路径怎么归一、60 秒窗口怎么合并）
* 与「唯一的文件读写点」。合并语义一旦散到 bridge 里，就会出现「bridge 合一次、append 又合一次」
* 的双重计数，面板的 `×N` 与文件行数对不上 —— AC-24 的判据正是这两者必须一致。
*
* 三条硬约束（AC-23）：**fail-open**。任何异常（目录不可写、JSON 坏行、序列化失败）都只
* `warn` 一次并返回 false / 空数组，绝不抛给调用方 —— 留痕是审计旁路，不能让工具结果变红。
*
* 只记 `write` / `edit`：`bash` 里重定向写文件不记（PRD 的显式排除）。理由是 bash 命令里
* 的路径不可靠（可能写临时文件、可能是只读命令），误记比漏记更伤审计可信度。
*/
/** 视为「队长亲手写文件」的工具（基名，命名空间前缀由 {@link baseToolName} 剥掉）。 */
const CAPTAIN_WRITE_TOOLS = ["write", "edit"];
/**
* 取工具名的基名：`write` / `mcp__fs__write` / `fs.write` / `fs:write` 都归一成 `write`。
*
* 只按分隔符取**最后一段**，不做模糊匹配 —— 把 `rewrite` 认成 `write` 会让一次只读操作
* 凭空出现在留痕里，比漏记更难解释。
*/
function baseToolName(name) {
	const trimmed = typeof name === "string" ? name.trim() : "";
	if (trimmed === "") return "";
	const parts = trimmed.split(/__|[.:/]/);
	return (parts[parts.length - 1] ?? "").toLowerCase();
}
/** 该工具是否算「队长亲手写文件」（AC-22）。 */
function isCaptainWriteTool(name) {
	return CAPTAIN_WRITE_TOOLS.includes(baseToolName(name));
}
/** 路径归一：`\` → `/`、折叠 `//`、去 `./` 前缀、去首尾空白（绝对路径保留原样）。 */
function normalizePath(raw) {
	let path = raw.trim().replace(/\\/g, "/");
	while (path.startsWith("./")) path = path.slice(2);
	return path.replace(/\/{2,}/g, "/");
}
/**
* 从工具参数里取被写的路径（AC-22）。
*
* `write` 的宿主参数是 `{ path, content }`，`edit` 是 `{ file_path, old_string, new_string }`；
* 两个都读（互为兜底）是因为不同宿主版本的字段名在这两者之间摇摆，而**读错的代价是漏记**。
* 只取路径，绝不读 `content` —— 留痕里不许出现文件正文（AC-22 的隐私边界）。
*/
function deviationPathsOf(toolName, args) {
	if (!isCaptainWriteTool(toolName)) return [];
	const record = args !== null && typeof args === "object" ? args : {};
	const candidates = baseToolName(toolName) === "write" ? [record.path, record.file_path] : [record.file_path, record.path];
	const paths = [];
	for (const value of candidates) {
		if (typeof value !== "string") continue;
		const path = normalizePath(value);
		if (path === "" || paths.includes(path)) continue;
		paths.push(path);
	}
	return paths;
}
/**
* 合并键：基名 + **排序后**的路径集合（AC-24）。
*
* 排序让 `['a','b']` 与 `['b','a']` 落成同一条 —— 否则同一批文件换个书写顺序就会多出一行，
* 面板上看起来像「队长又改了一次」。
*/
function deviationKeyOf(record) {
	const paths = record.paths.map((path) => normalizePath(path)).sort();
	return `${baseToolName(record.toolName)}|${paths.join(",")}`;
}
/**
* 60 秒窗口内的同键合并（AC-24）：返回 `count + 1` 的那一条，并标记 `merged`。
*
* `at` 取**新**记录的时刻（而不是保留旧时刻）：面板上「最后一次写是几秒前」比「第一次」有用；
* 计数仍然累加，所以合并不会吞掉次数。
*/
function mergeDeviation(prev, next, windowMs) {
	if (prev === null) return {
		record: next,
		merged: false
	};
	if (deviationKeyOf(prev) !== deviationKeyOf(next)) return {
		record: next,
		merged: false
	};
	const gap = next.at - prev.at;
	if (gap < 0 || gap >= windowMs) return {
		record: next,
		merged: false
	};
	return {
		record: {
			...next,
			count: Math.max(1, prev.count ?? 1) + 1
		},
		merged: true
	};
}
/** 读原始行（坏行直接丢弃，不抛）。文件不存在 = 空列表。 */
function readRows(file) {
	if (!existsSync(file)) return [];
	const text = readFileSync(file, "utf8");
	const rows = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		try {
			const parsed = JSON.parse(trimmed);
			if (typeof parsed?.at !== "number" || typeof parsed?.sessionId !== "string" || typeof parsed?.toolName !== "string" || !Array.isArray(parsed?.paths) || typeof parsed?.reason !== "string") continue;
			rows.push({
				at: parsed.at,
				sessionId: parsed.sessionId,
				toolName: parsed.toolName,
				paths: parsed.paths.filter((path) => typeof path === "string"),
				reason: parsed.reason,
				count: typeof parsed.count === "number" && parsed.count > 0 ? parsed.count : 1
			});
		} catch {}
	}
	return rows;
}
/** 整份重写（临时文件 + rename，避免半行写坏让下次读整份失败）。 */
function writeRows(file, rows) {
	mkdirSync(dirname(file), { recursive: true });
	const body = rows.map((row) => JSON.stringify(row)).join("\n");
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, body === "" ? "" : `${body}\n`, "utf8");
	renameSync(tmp, file);
}
/**
* 追加一条（或改写最后一行），返回是否写成功（AC-23：失败只返回 false，不抛）。
*
* 轮转：行数超过 `limit` 时**重写只保留最后 `limit/2` 行**（500 → 250）。留一半余量是为了
* 让轮转不是每写一条就发生一次 —— 每次轮转都是整份重写，O(1) 分摊才成立。
*/
function appendDeviation(file, record, windowMs, limit) {
	try {
		const rows = readRows(file);
		const outcome = mergeDeviation(rows.length > 0 ? rows[rows.length - 1] ?? null : null, record, windowMs);
		const next = outcome.merged ? [...rows.slice(0, -1), outcome.record] : [...rows, outcome.record];
		const keep = limit > 0 ? Math.max(1, Math.floor(limit / 2)) : 0;
		writeRows(file, limit > 0 && next.length > limit ? next.slice(next.length - keep) : next);
		return true;
	} catch {
		return false;
	}
}
/** 读最近 `limit` 条（文件顺序 = 时间顺序，返回尾部）。读失败 = 空数组（fail-open）。 */
function readDeviations(file, limit) {
	try {
		const rows = readRows(file);
		if (limit <= 0 || rows.length <= limit) return rows;
		return rows.slice(rows.length - limit);
	} catch {
		return [];
	}
}
/** 原因文案（宿主生成，面板原样渲染）：超长截断到 `reasonMax`。 */
function deviationReasonOf(paths, reasonMax) {
	const body = `队长直接写入 ${paths.join("、")}`;
	if (body.length <= reasonMax) return body;
	return `${body.slice(0, Math.max(0, reasonMax - 1))}…`;
}
/**
* 记录器：`bridge` 只调 `recent()`，装配层只调 `record()`。
*
* 合并与落盘全部收敛在 `appendDeviation` 一处（见文件头），这里只负责「该不该记」与
* 「记什么」。`record()` 返回 void：调用方（事件订阅）没有可用的失败处理，**也不该有**。
*/
function createDeviationRecorder(deps) {
	const now = deps.now ?? (() => Date.now());
	const mergeMs = deps.mergeMs ?? 6e4;
	const lineLimit = deps.lineLimit ?? 500;
	const reasonMax = deps.reasonMax ?? 120;
	const snapshotLimit = 50;
	let warned = false;
	/** AC-23：只 warn 一次（同一个进程里反复写失败会把日志刷成噪音）。 */
	const failOpen = (error) => {
		if (warned) return;
		warned = true;
		try {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn?.(`[auto-team] 队长留痕写入失败（已忽略，不影响工具结果）：${message}`);
		} catch {}
	};
	return {
		record(input) {
			try {
				if (!isCaptainWriteTool(input.toolName)) return;
				const paths = deviationPathsOf(input.toolName, input.args);
				if (paths.length === 0) return;
				const record = {
					at: now(),
					sessionId: deps.sessionId,
					toolName: input.toolName,
					paths,
					reason: deviationReasonOf(paths, reasonMax),
					count: 1
				};
				if (!appendDeviation(deps.file, record, mergeMs, lineLimit)) failOpen(/* @__PURE__ */ new Error(`无法写入 ${deps.file}`));
			} catch (error) {
				failOpen(error);
			}
		},
		recent(limit) {
			try {
				return readDeviations(deps.file, limit ?? snapshotLimit);
			} catch {
				return [];
			}
		}
	};
}
// src/host/team/member-prompt.ts
/** 把角色 / 任务 / 团队记忆 / 技能正文拼成成员 spawn prompt。 */
function buildMemberPrompt(input, deps) {
	const role = input.role;
	const skills = role ? composeSkillPrompt(role, deps.skillBodyOf) : {
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
// src/host/team/auto-dispatch.ts
/**
* 自动派发（r13 AC-8/9/10）：计划落盘后**零用户动作**起人。
*
* 这个模块只做「什么时候值得调一次派发」的判断与串行化，**不实现任何派发规则**：
* 并发上限、依赖门禁、写域等待、暂停四道闸全在 `team/dispatch.ts` 的 `dispatchReady` 里，
* 这里通过注入的 `dispatch` 端口调用那个**同一个**闭包。任何在自动路径上重写一遍闸门的做法
* 都会立刻和手动 `auto_team_dispatch` 分叉（AC-9 的四道闸就会有一侧失效）。
*
* 三件事必须由本模块（而不是调用方）保证：
*  1. **单飞**：同一个 run 同时只允许一次在跑的派发。`dispatchReady` 是 async 的
*     （`listMembers` / `spawn` 都 await），两次并发调用会用同一份旧状态各算一遍 ready 集合，
*     于是同一任务被建出两个成员 —— 这是并发路径上唯一真正危险的竞态。
*  2. **幂等**：派发前重新 `store.load`，并以「就绪任务还没有未退役 binding」为最低判据；
*     真正的判重仍由 `dispatchReady` 完成（它已有 binding→ALREADY_RUNNING 的既有逻辑）。
*  3. **退避**：连续失败到 `AUTO_DISPATCH_RETRY_LIMIT` 就停手并留下可见状态，
*     否则 watcher 每 1.5s 的 tick 会把同一失败重放到宿主日志/配额被烧穿。
*
* 状态**刻意不落盘**：失败计数与单飞表都是「本进程此刻」的事实，写进 RunState 会跨重启残留，
* 让一次旧失败永久掐死新进程里的自动派发（用户看不到任何原因）。
*/
/** 连续失败到达上限时的可见文案（逐字，供面板/探针断言复用）。 */
const AUTO_DISPATCH_STALLED_TEXT = "自动派发连续失败，需人工处理";
/**
* 「现在值得调一次派发吗」的纯判定（AC-9 的前置闸，不替代 dispatchReady 的四道闸）。
*
* 刻意**不判并发上限**：那是 `dispatchReady` 的职责，在这里再算一遍就会出现第二套并发口径，
* 两边一旦漂移，面板/自动派发/手动派发就会对「该不该起人」给出不同答案。
*/
function shouldAutoDispatch(state) {
	const status = state.plan.status;
	if (status !== "draft" && status !== "dispatching") return {
		ok: false,
		reason: `计划状态为 ${status}，不自动派发`
	};
	if (state.pause !== void 0 || state.plan.tasks.some((task) => task.status === "paused")) return {
		ok: false,
		reason: "已暂停，恢复后再自动补齐"
	};
	const forced = new Set(state.forceParallel ?? []);
	const ready = readyTasks(forced.size === 0 ? state.plan.tasks : state.plan.tasks.map((task) => task.status === "waiting" && forced.has(task.id) ? {
		...task,
		status: "pending"
	} : task));
	if (ready.length === 0) return {
		ok: false,
		reason: "没有就绪任务"
	};
	const liveBound = new Set(state.bindings.filter((binding) => binding.retired !== true).map((binding) => binding.taskId));
	if (ready.filter((taskId) => !liveBound.has(taskId)).length === 0) return {
		ok: false,
		reason: "就绪任务均已派出成员，无需重复派发"
	};
	return { ok: true };
}
/** 一条错误的可读文案（`auto_team_status.dispatch.errors` 与活动流共用同一种句法）。 */
function errorLineOf(item) {
	return `${item.taskId}：${item.error}`;
}
/** 本批全失败时的播报文案（AC-3 的「可读错误」，必须包含具体错误而不是只有计数）。 */
function failureTextOf(errors) {
	return `派发失败：后台未能创建成员（${errors.slice(0, 3).join("；")}${errors.length > 3 ? `；等共 ${errors.length} 条` : ""}）`;
}
function createAutoDispatcher(deps) {
	deps.now ?? Date.now;
	/** key = runId：单飞粒度按 run，不按 session（一个会话可能留有多份历史 run）。 */
	const inflightRuns = /* @__PURE__ */ new Map();
	/** 连续失败计数；有进展（started 非空）即清零。 */
	const failures = /* @__PURE__ */ new Map();
	/** key = sessionId：最近几条报告（只读给 `auto_team_status`，不参与任何判定）。 */
	const reports = /* @__PURE__ */ new Map();
	const timers = /* @__PURE__ */ new Set();
	let disposed = false;
	function record(sessionId, report) {
		const list = reports.get(sessionId) ?? [];
		list.push(report);
		reports.set(sessionId, list.slice(-5));
	}
	function stalled(runId) {
		return (failures.get(runId) ?? 0) >= 3;
	}
	function bumpFailure(runId) {
		const count = (failures.get(runId) ?? 0) + 1;
		failures.set(runId, count);
		if (count >= 3) deps.onStatus?.(runId, `${AUTO_DISPATCH_STALLED_TEXT}（连续 ${count} 次）`);
	}
	function reportOf(runId, cause, patch = {}) {
		return {
			runId,
			cause,
			attempted: false,
			started: [],
			failed: 0,
			skipped: 0,
			errors: [],
			...patch
		};
	}
	async function dispatchOnce(sessionId, runId, cause) {
		const state = deps.store.load(runId);
		if (state === null) return reportOf(runId, cause, { reason: "run 不存在或无法读取" });
		if (state.plan.sessionId !== sessionId) return reportOf(runId, cause, { reason: `run 属于会话 ${state.plan.sessionId}，与请求会话不一致` });
		const verdict = shouldAutoDispatch(state);
		if (!verdict.ok) return reportOf(runId, cause, { reason: verdict.reason });
		try {
			const result = await deps.dispatch(state);
			const started = result.started ?? [];
			const errors = (result.errors ?? []).map(errorLineOf);
			const failed = result.errors?.length ?? 0;
			if (started.length === 0 && failed > 0) {
				bumpFailure(runId);
				deps.onError?.(runId, failureTextOf(errors));
			} else {
				failures.delete(runId);
				if (started.length > 0) deps.onClear?.(runId);
			}
			return reportOf(runId, cause, {
				attempted: true,
				started,
				failed,
				skipped: result.skipped?.length ?? 0,
				errors,
				...started.length === 0 && failed > 0 ? { reason: `本批 spawn 全部失败（${failed} 条错误）` } : {}
			});
		} catch (error) {
			bumpFailure(runId);
			const message = error instanceof Error ? error.message : String(error);
			deps.onError?.(runId, `派发失败：${message}`);
			return reportOf(runId, cause, {
				attempted: true,
				failed: 1,
				errors: [message],
				reason: message
			});
		}
	}
	async function run(sessionId, requestedRunId, cause) {
		if (disposed) return null;
		const runId = requestedRunId ?? deps.store.latestForSession(sessionId)?.plan.runId;
		if (runId === void 0) return null;
		if (inflightRuns.has(runId)) return null;
		if (stalled(runId)) return null;
		const promise = dispatchOnce(sessionId, runId, cause);
		inflightRuns.set(runId, {
			sessionId,
			promise
		});
		try {
			const report = await promise;
			record(sessionId, report);
			return report;
		} finally {
			inflightRuns.delete(runId);
		}
	}
	function kick(sessionId, runId, cause) {
		if (disposed) return;
		const handle = setTimeout(() => {
			timers.delete(handle);
			run(sessionId, runId, cause).catch(() => {});
		}, 0);
		timers.add(handle);
	}
	async function tick() {
		if (disposed) return [];
		let summaries;
		try {
			summaries = deps.store.list();
		} catch {
			return [];
		}
		const reports = [];
		for (const summary of summaries) {
			if (summary.active === false) continue;
			if (summary.status !== "draft" && summary.status !== "dispatching") continue;
			if (inflightRuns.has(summary.runId)) continue;
			const report = await run(summary.sessionId, summary.runId, "tick");
			if (report !== null) reports.push(report);
		}
		return reports;
	}
	function inflight(sessionId) {
		for (const entry of inflightRuns.values()) if (entry.sessionId === sessionId) return true;
		return false;
	}
	function reset(runId) {
		failures.delete(runId);
	}
	function reportsOf(sessionId) {
		return [...reports.get(sessionId) ?? []];
	}
	function dispose() {
		disposed = true;
		for (const handle of timers) clearTimeout(handle);
		timers.clear();
		inflightRuns.clear();
		failures.clear();
		reports.clear();
	}
	return {
		kick,
		tick,
		inflight,
		reset,
		dispose,
		reportsOf
	};
}
// src/host/team/dispatch-notices.ts
function createDispatchNotes(now = Date.now) {
	const notes = /* @__PURE__ */ new Map();
	function add(runId, text) {
		const body = text.trim();
		if (body === "") return;
		const at = now();
		const kept = (notes.get(runId) ?? []).filter((item) => item.text !== body);
		kept.push({
			at,
			kind: "status",
			text: body,
			source: "trigger"
		});
		notes.set(runId, kept.slice(-5));
	}
	function clear(runId) {
		notes.delete(runId);
	}
	function recent(runId) {
		return (notes.get(runId) ?? []).map((item) => ({ ...item }));
	}
	return {
		add,
		clear,
		recent
	};
}
// src/shared/role-view.ts
/** 角色态 → 中文文案（组件与宿主都用这一份，禁止再写第二份映射）。 */
const ROLE_STATE_TEXT = {
	running: "执行中",
	waiting_gate: "待验收",
	needs_attention: "需处理",
	done: "已完成",
	idle: "待命"
};
const UNAVAILABLE_DURATION = {
	state: "unavailable",
	text: "不可得"
};
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
		view.duration = active.duration ?? UNAVAILABLE_DURATION;
	} else view.duration = UNAVAILABLE_DURATION;
	return view;
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
// src/host/library.ts
/**
* 左侧栏「项目库」装配（r13 AC-14~AC-18、AC-21、AC-23）。
*
* 为什么单独成模块而不是塞进 bridge：
*  - 左边栏和右边栏看的是**同一份数据**（`RunDetailView`）。装配只允许一处，bridge 只转派，
*    否则两处拼装迟早漂移（本项目历史 bug 族：同一数据两条链路给不同结论）。
*  - `snapshot` 轮询期间**不得**装配 library（AC-23：快照路径对 library 的调用数必须为 0）。
*    独立对象 + 自带 5s 缓存，谁在什么时候调用一目了然。
*
* 三条纪律：
*  1. 文本（token 千分位 / 时长）一律由 `format.ts` / `team/usage.ts` 生成，本模块不拼字符串；
*  2. 旧 run 缺 `project` 归「历史运行（未记录工作区）」并固定末位，缺 `usage` 显示「不可得」而不是 0；
*  3. 缓存键只读**目录 mtime + 文件数**，不逐文件 parse；没有目录句柄时退化为 5s TTL 缓存。
*/
/** 历史桶的固定 id：不是真实路径，客户端据此给末位与灰态。 */
const UNKNOWN_PROJECT_ID = "__unknown__";
/** 历史桶的展示名（r14 AC-14：旧 run 没有 `project` 字段，不猜工作区、不迁移）。 */
const UNKNOWN_PROJECT_NAME = "历史运行（未记录工作区）";
/** 每个项目最多带多少条记忆索引（AC-17；与项目最近 run 的 20 条同量级）。 */
const MEMORY_INDEX_LIMIT = 50;
/** 没有数字时的统一人话（`UsageCell.reason`，会进 tooltip）。 */
const NO_USAGE_REASON = "宿主未上报本 run 的用量";
/** 项目路径 → 展示名（basename）；空/缺省 = 「历史运行（未记录工作区）」。纯函数，可单测。 */
function projectNameOf(path) {
	const text = (path ?? "").trim().replace(/[/\\]+$/, "");
	if (text === "") return UNKNOWN_PROJECT_NAME;
	const name = basename(text);
	return name === "" || name === "/" ? text : name;
}
/**
* 工作区白名单（AC-16 的服务端闸）：`/memory?workspace=` 只允许已知项目根及其子目录。
*
* 「已知」= 当前工作区 ∪ 现有 run 的 `project`（与项目列表同源，不另建白名单）。
* `resolve` 后必须**位于**某个已知根内 —— 否则 `../../` 一次就能读到仓库外的记忆。
*/
function isKnownWorkspace(deps, path) {
	const text = (path ?? "").trim();
	if (text === "") return false;
	const target = resolve(text);
	for (const root of knownWorkspaces(deps)) if (target === root || target.startsWith(`${root}${sep}`)) return true;
	return false;
}
function knownWorkspaces(deps) {
	const out = [];
	const push = (value) => {
		const text = (value ?? "").trim();
		if (text === "") return;
		const abs = resolve(text);
		if (!out.includes(abs)) out.push(abs);
	};
	push(deps.workspace);
	for (const summary of deps.store.list()) push(summary.project);
	return out;
}
/**
* 装配整页（AC-15/AC-16/AC-21）。
*
* 顺序约定：已知项目按 `lastActiveAt` 倒序，「历史运行（未记录工作区）」固定末位；
* 「全局」不在 `projects` 里，它固定占据列表首行（`global.memories`），否则切换会串轨。
*/
function buildLibrary(deps, query = {}) {
	const at = nowOf(deps);
	const summaries = deps.store.list();
	const view = {
		projects: groupProjects(deps, summaries, at),
		global: { memories: deps.publicMemories().slice(0, MEMORY_INDEX_LIMIT) },
		currentProject: (deps.workspace ?? "").trim(),
		runs: summaries.slice(0, 50)
	};
	const runId = (query.runId ?? "").trim();
	if (runId !== "") {
		const state = deps.store.load(runId);
		if (state !== null) view.detail = runDetailOf(state, at, roleNameOf(deps));
	}
	return view;
}
/**
* library 缓存（AC-23）：键 = 目录 mtime : json 文件数 : runId，命中且未过 TTL 直接返回。
*
* 没有 `runsDir` 时键恒为 `live`，只能靠 TTL 过期 —— 语义仍正确（最多旧 5 秒），
* 只是少了「写入后立即失效」的精确性。
*/
function createLibraryCache(deps, ttlMs = LIBRARY_CACHE_MS) {
	let hit = null;
	return {
		view(query = {}) {
			const key = cacheKeyOf(deps, query);
			const at = nowOf(deps);
			if (hit !== null && hit.key === key && at - hit.at < ttlMs) return hit.view;
			const view = buildLibrary(deps, query);
			hit = {
				key,
				at,
				view
			};
			return view;
		},
		invalidate() {
			hit = null;
		}
	};
}
function cacheKeyOf(deps, query) {
	const runId = (query.runId ?? "").trim();
	const dir = (deps.runsDir ?? "").trim();
	if (dir === "") return `live:${runId}`;
	try {
		const stat = statSync(dir);
		const count = readdirSync(dir).filter((entry) => entry.endsWith(".json")).length;
		return `${stat.mtimeMs}:${count}:${runId}`;
	} catch {
		return `missing:${runId}`;
	}
}
/**
* 一个 run 的完整详情（历史详情的宿主唯一装配，AC-18/AC-21）。
*
* 当前 run 由客户端 `buildRunDetail` 从快照装配、历史 run 由这里装配 —— 两边字段口径
* 必须逐字一致（TECHNICAL §2.4）：口算规则只抄一次在这里，客户端不得二次计算。
*/
function runDetailOf(state, at, roleNames) {
	const tasks = state.plan.tasks.map((task) => taskDetailOf(state, task, at, roleNames));
	const detail = {
		runId: state.plan.runId,
		sessionId: state.plan.sessionId,
		planStatus: state.plan.status,
		plannedAt: state.plannedAt,
		usage: runUsageOf(state.usage),
		duration: runDurationOf(state, at),
		roles: rolesOf(tasks),
		tasks,
		flow: flowOf(tasks)
	};
	if (state.project !== void 0) detail.project = state.project;
	if (state.finishedAt !== void 0) detail.finishedAt = state.finishedAt;
	const pending = pendingViewOf(state.pendingConfirmation, at);
	if (pending !== void 0) detail.pendingConfirmation = pending;
	return detail;
}
/** run 级用时：`plannedAt → finishedAt`；进行中用 now，终态却缺结束时刻记「不可得」。 */
function runDurationOf(state, at) {
	if (state === null) return durationCellOf({
		state: "unavailable",
		now: at
	});
	const ended = state.finishedAt !== void 0;
	const terminal = state.plan.status === "cancelled" || state.plan.status === "terminated";
	if (!ended && terminal) return durationCellOf({
		startAt: state.plannedAt,
		state: "unavailable",
		now: at
	});
	return durationCellOf({
		startAt: state.plannedAt,
		...ended ? { endAt: state.finishedAt } : {},
		state: ended ? "done" : "running",
		now: at
	});
}
/** 任务级用时：无起点 = 「未开始」（不是 0 秒）；有起点无终点且未终态 = 进行中。 */
function taskDurationOf(state, task, at) {
	const time = state.taskTimes?.[task.id];
	const startAt = time?.startedAt;
	const endAt = time?.endedAt;
	const finished = endAt !== void 0 || isTerminalTaskStatus(task.status);
	const cellState = startAt === void 0 ? "not-started" : finished ? "done" : "running";
	return durationCellOf({
		...startAt === void 0 ? {} : { startAt },
		...endAt === void 0 ? {} : { endAt },
		state: cellState,
		now: at
	});
}
function taskDetailOf(state, task, at, roleNames) {
	const memberId = state.bindings.find((binding) => binding.taskId === task.id)?.memberId ?? task.memberId;
	const view = {
		id: task.id,
		title: task.title,
		roleId: task.roleId,
		roleName: roleNames?.get(task.roleId) ?? task.roleId,
		status: task.status,
		dependsOn: [...task.dependsOn],
		acceptance: task.acceptance,
		usage: taskUsageOf(state.usage, task.id, memberId),
		duration: taskDurationOf(state, task, at),
		messageCount: state.messages.filter((message) => message.taskId === task.id).length
	};
	if (task.writeScopes !== void 0) view.writeScopes = [...task.writeScopes];
	if (task.evidence !== void 0) view.evidence = task.evidence;
	if (task.attempts !== void 0) view.attempts = task.attempts;
	if (task.waitReason !== void 0) view.waitReason = task.waitReason;
	return view;
}
/**
* 角色条 / 角色卡片：按任务里**首次出现顺序**分组，`usage` = 该角色名下任务的合计。
*
* r14 AC-7/AC-8/AC-9：角色态 / 当前任务 / 用时 / 用量口径**都不在这里算**——统一走
* `shared/role-view.ts` 的 `roleStateOf` + `roleUsageCellOf`，与客户端
* `viewModel.roleUsageOf` 是同一份实现，两侧文本因此逐字相等（AC-17 的抽屉 vs 右栏
* 比对靠这条构造保证；r13 的「宿主累加已知项、客户端判不可得」两套口径已由 QA D2 证实
* 会给出两种结论，故把聚合也一并收进 shared）。
*/
function rolesOf(tasks) {
	const order = [];
	const buckets = /* @__PURE__ */ new Map();
	for (const task of tasks) {
		const list = buckets.get(task.roleId);
		if (list === void 0) {
			order.push(task.roleId);
			buckets.set(task.roleId, [task]);
		} else list.push(task);
	}
	return order.map((roleId) => {
		const list = buckets.get(roleId) ?? [];
		const name = list[0]?.roleName ?? roleId;
		const state = roleStateOf(list);
		const view = {
			roleId,
			name,
			tasks: list.length,
			usage: roleUsageCellOf(list.map((task) => task.usage)),
			done: state.done,
			state: state.state,
			stateText: state.stateText,
			duration: state.duration
		};
		if (state.activeTaskId !== void 0) view.activeTaskId = state.activeTaskId;
		if (state.activeTaskTitle !== void 0) view.activeTaskTitle = state.activeTaskTitle;
		return view;
	});
}
/**
* 流转图装配（AC-5）：列 = 依赖深度（0 起），行 = 同列内计划顺序。
*
* 只画图不排版：列距/行距/画布尺寸在客户端 CSS 里（`views/FlowCanvas`）。
* r14 AC-5：节点首行要角色名，`roleName` 由宿主给出（任务详情里是 `name || roleId`，
* 所以旧 run 也一定会落到角色 id 而不是任务 id 或空白）。
* 环依赖（坏数据）用过访问集兜住，深度按 0 兜底 —— 画错也比抛错让整页空白好。
*/
function flowOf(tasks) {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const depth = /* @__PURE__ */ new Map();
	const visiting = /* @__PURE__ */ new Set();
	const depthOf = (id) => {
		const cached = depth.get(id);
		if (cached !== void 0) return cached;
		const task = byId.get(id);
		if (task === void 0) return 0;
		if (visiting.has(id)) return 0;
		visiting.add(id);
		let value = 0;
		for (const dep of task.dependsOn) {
			if (!byId.has(dep)) continue;
			value = Math.max(value, depthOf(dep) + 1);
		}
		visiting.delete(id);
		depth.set(id, value);
		return value;
	};
	const rowsInColumn = /* @__PURE__ */ new Map();
	const nodes = tasks.map((task) => {
		const column = depthOf(task.id);
		const row = rowsInColumn.get(column) ?? 0;
		rowsInColumn.set(column, row + 1);
		return {
			id: task.id,
			title: task.title,
			status: task.status,
			roleName: task.roleName,
			column,
			row,
			usage: task.usage,
			duration: task.duration
		};
	});
	const edges = [];
	for (const task of tasks) for (const dep of task.dependsOn) {
		if (!byId.has(dep)) continue;
		edges.push({
			from: dep,
			to: task.id,
			upstreamDone: byId.get(dep)?.status === "done"
		});
	}
	let columns = 0;
	let rows = 0;
	for (const node of nodes) {
		columns = Math.max(columns, node.column + 1);
		rows = Math.max(rows, node.row + 1);
	}
	return {
		nodes,
		edges,
		columns,
		rows
	};
}
function groupProjects(deps, summaries, at) {
	const buckets = /* @__PURE__ */ new Map();
	const bucketFor = (path, unknown) => {
		const key = unknown ? UNKNOWN_PROJECT_ID : (path ?? "").trim();
		const existing = buckets.get(key);
		if (existing !== void 0) return existing;
		const created = {
			path: unknown ? void 0 : path,
			summaries: [],
			unknown
		};
		buckets.set(key, created);
		return created;
	};
	bucketFor(deps.workspace, false);
	for (const summary of summaries) {
		const project = (summary.project ?? "").trim();
		bucketFor(project === "" ? void 0 : project, project === "").summaries.push(summary);
	}
	const known = [];
	let unknown = null;
	for (const bucket of buckets.values()) {
		const view = projectViewOf(deps, bucket, at);
		if (bucket.unknown) unknown = view;
		else known.push(view);
	}
	known.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) || a.name.localeCompare(b.name));
	return unknown === null ? known : [...known, unknown];
}
function projectViewOf(deps, bucket, at) {
	const runs = [...bucket.summaries].sort((a, b) => b.createdAt - a.createdAt);
	let lastActiveAt;
	for (const summary of runs) {
		const active = Math.max(summary.createdAt, summary.finishedAt ?? 0);
		lastActiveAt = lastActiveAt === void 0 ? active : Math.max(lastActiveAt, active);
	}
	let total;
	for (const summary of runs) {
		if (summary.usageTotals === void 0) continue;
		total = addTotals(total, summary.usageTotals);
	}
	const view = {
		id: bucket.unknown ? UNKNOWN_PROJECT_ID : bucket.path ?? "",
		name: bucket.unknown ? UNKNOWN_PROJECT_NAME : projectNameOf(bucket.path),
		runs: runs.length,
		usage: usageCellOf(total, NO_USAGE_REASON),
		recentRuns: runs.slice(0, 20).map((summary) => projectRunViewOf(summary, at)),
		memories: bucket.unknown ? [] : deps.projectMemories(bucket.path ?? "").slice(0, MEMORY_INDEX_LIMIT)
	};
	if (bucket.path !== void 0 && !bucket.unknown) view.path = bucket.path;
	if (bucket.unknown) view.unknown = true;
	if (lastActiveAt !== void 0) view.lastActiveAt = lastActiveAt;
	return view;
}
function projectRunViewOf(summary, at) {
	const view = {
		runId: summary.runId,
		planStatus: summary.status,
		tasks: summary.tasks,
		done: summary.done,
		usage: usageCellOf(summary.usageTotals, NO_USAGE_REASON),
		duration: durationOfSummary(summary, at)
	};
	if (summary.plannedAt !== void 0) view.plannedAt = summary.plannedAt;
	if (summary.finishedAt !== void 0) view.finishedAt = summary.finishedAt;
	if (summary.goal !== void 0) view.goal = summary.goal;
	return view;
}
/** 历史列表只有摘要：缺 `plannedAt` 记「不可得」，不用 `createdAt` 冒充（口径会变）。 */
function durationOfSummary(summary, at) {
	if (summary.plannedAt === void 0) return durationCellOf({
		state: "unavailable",
		now: at
	});
	const ended = summary.finishedAt !== void 0;
	const terminal = summary.status === "cancelled" || summary.status === "terminated";
	if (!ended && terminal) return durationCellOf({
		startAt: summary.plannedAt,
		state: "unavailable",
		now: at
	});
	return durationCellOf({
		startAt: summary.plannedAt,
		...ended ? { endAt: summary.finishedAt } : {},
		state: ended ? "done" : "running",
		now: at
	});
}
function roleNameOf(deps) {
	const map = /* @__PURE__ */ new Map();
	for (const role of deps.roles?.() ?? []) {
		const id = (role.id ?? "").trim();
		if (id === "") continue;
		const name = (role.name ?? "").trim();
		map.set(id, name === "" ? id : name);
	}
	return map;
}
function addTotals(base, next) {
	const out = { total: (base?.total ?? 0) + next.total };
	const input = (base?.input ?? 0) + (next.input ?? 0);
	const output = (base?.output ?? 0) + (next.output ?? 0);
	if (input > 0) out.input = input;
	if (output > 0) out.output = output;
	return out;
}
function nowOf(deps) {
	const at = deps.now?.();
	return typeof at === "number" && Number.isFinite(at) ? at : Date.now();
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
	/**
	* 技能 md 仓储（r10 AC-17/AC-20）：`<home>/.dsh/auto-team/skills/<id>.md`。
	*
	* 与角色库**同一个 home 根**但独立目录、独立仓储：技能是四来源（内置/导入/系统/自建）
	* 的可编辑实体，角色是 JSON。seed 只做「缺失的内置技能铺底 / 老 md 缺 frontmatter 只前置」，
	* 因此重启永远不会覆盖用户改过的正文（AC-20 的唯一保证点）。失败只 warn，不阻断装配 ——
	* 一条坏 md 不该让整个插件不激活。
	*/
	const skills = createSkillRepo({
		dir: skillsDir(home),
		now,
		warn: (text) => warn(ctx, text)
	});
	try {
		skills.seed();
	} catch (error) {
		warn(ctx, `技能库初始化失败（面板技能列表可能为空）：${messageOf(error)}`);
	}
	/** 宿主系统技能库（只读 `~/.agents/skills`，r10 AC-19）：只扫不写。 */
	const systemSkills = createSystemSkillSource({
		dir: systemSkillsDir(home),
		warn: (text) => warn(ctx, text)
	});
	/**
	* 模型清单缓存（r10 AC-16）：`PanelSnapshot` 是同步 API，宿主清单是异步的，这里握手。
	* 立即预热一次（不 await：装配期不许等宿主），失败降级成 `empty + reason`。
	*/
	const modelCatalog = createModelCatalogCache({
		read: () => readModelCatalog(ctx),
		now,
		ttlMs: MODEL_CATALOG_TTL_MS
	});
	modelCatalog.refresh(true);
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
		return buildMemberPrompt(input, {
			memoryFor: (goal) => bridge.memoryFor(goal),
			skillBodyOf: (skillId) => skills.get(skillId)?.body ?? ""
		});
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
	/**
	* 自动派发（r13 AC-8）：计划落盘即派发，**直调上面的 `dispatch` 端口**，绝不再走
	* `bridge.act({type:'dispatch'})` —— AC-8 断言 dispatch 动作调用为 0，而四道闸（并发/依赖/
	* 写域/暂停）全部已收口在 `dispatchReady`，从这条闭包进去与手动派发行为完全一致。
	*
	* 单飞状态放在 dispatcher 自己的 Map 里（不落 RunState）：跨进程重启后不能残留「正在派发」。
	* 失败在 `onStatus` 里只记 warn：`stallAlerts` 的归一化只接受 kind='tool'，写进去会被丢弃。
	*/
	/**
	* 派发失败通知环（r14 AC-3）：受理制之后工具不再 await spawn，「后台没起来」必须自己长腿回来。
	* 内存态（cap 5、不落盘）：进程重启后旧失败不该再算「刚发生的事实」，与单飞状态同一取舍。
	* createBridge 把它并入既有 activityOf（kind='status'），所以快照形状零扩张。
	*/
	const dispatchNotes = createDispatchNotes(now);
	const autoDispatcher = createAutoDispatcher({
		store,
		dispatch,
		now,
		onStatus: (_runId, text) => warn(ctx, text),
		onError: (runId, text) => {
			warn(ctx, text);
			dispatchNotes.add(runId, text);
		},
		onClear: (runId) => dispatchNotes.clear(runId)
	});
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
				try {
					await autoDispatcher.tick();
				} catch (error) {
					warn(ctx, `自动派发 tick 失败（下一轮重试）：${messageOf(error)}`);
				}
				if (bus === null) return;
				await bus.poll(state);
			}
		});
		watcherRef.start();
	}
	/**
	* 队长留痕记录器（r11 F7）：落 `<home>/.dsh/auto-team/deviations.jsonl`，与 runs 同根、仓库外。
	*
	* 构造不做 IO（读写在 `record()` 里且已 fail-open），所以这里不需要 try/catch；
	* 真正必须被兜住的是**订阅**——见下面的 ④½。
	*/
	const deviations = createDeviationRecorder({
		file: deviationsPath(home),
		sessionId: DEFAULT_SESSION,
		warn: (text) => warn(ctx, text)
	});
	/**
	* 左栏项目库（r13 AC-15/AC-23）：装配放在**独立缓存对象**里 —— snapshot 期间零 library 装配，
	* 所以右栏轮询再密也不会把项目表拖慢。记忆索引只经 `listMemoryItems` 一个来源（两轨同实现）。
	*/
	const libraryDeps = {
		store,
		workspace,
		now,
		publicMemories: () => listMemoryItems(memoryRoots.publicDir, "public"),
		projectMemories: (target) => listMemoryItems(projectMemoryDir(target), "project"),
		roles: () => roles.list().map((role) => ({
			id: role.id,
			name: role.name
		})),
		runsDir: runsDir(home)
	};
	const libraryCache = createLibraryCache(libraryDeps);
	const bridge = createBridge({
		store,
		roles,
		memoryRoots,
		dataRoot,
		dispatch,
		resume,
		applyReceipt: applyReceiptPort,
		sendMessage,
		dispatchNotices: dispatchNotes,
		gate: {
			cwd: workspace,
			artifactsDir
		},
		hostConcurrency,
		deviations,
		...spawnPorts.interruptMember === void 0 ? {} : { interruptMember: spawnPorts.interruptMember },
		now,
		captainModel: () => captainView,
		settingsRepo,
		skills,
		systemSkills,
		modelCatalog: () => modelCatalog.view(),
		onSettingsSaved: () => {
			syncCaptainRoute();
			startWatcher();
		},
		triggerHealth: () => bus === null ? {
			degraded: true,
			reason: "Trigger 总线未装配，推进只剩轮询兜底"
		} : bus.health(),
		libraryView: (query) => libraryCache.view(query),
		isKnownWorkspace: (path) => isKnownWorkspace(libraryDeps, path),
		/**
		* 落盘后的统一通知点（AC-8 的「任务终态」触发点）：bridge 每次 save 都会经过这里，
		* 因此 receipt / cancelTask / skipTask / 门禁回写全都自动补派发，不需要每个动作各接一次。
		* 同时清掉 library 缓存：项目列表里的 run 状态必须与刚落盘的真值一致。
		*/
		onRunChanged: (sessionId, runId, cause) => {
			libraryCache.invalidate();
			autoDispatcher.kick(sessionId, runId, cause);
		},
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
			now,
			workspace,
			autoDispatch: (sessionId, runId, cause) => autoDispatcher.kick(sessionId, runId, cause),
			dispatchReports: (sessionId) => autoDispatcher.reportsOf(sessionId)
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
		registerEffect(ctx, onCaptainToolResult(ctx, ({ toolName, args }) => {
			deviations.record({
				toolName,
				args
			});
		}).stop);
	} catch (error) {
		warn(ctx, `队长留痕未装配（面板不显示执行痕迹）：${messageOf(error)}`);
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
						autoDispatcher.kick(state.plan.sessionId, state.plan.runId, "member-exit");
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
	/**
	* 用量记录（r13 AC-3/AC-19，U1 fail-open）：根作用域 `session/event` → 累加进所属 run。
	*
	* 归属判定只用**已落盘事实**（不猜宿主字段路径）：
	*   ① 事件里的会话 id 命中某 run 的 `bindings[].memberId` → 成员级（per-member）；
	*   ② 命中某 run 的 `plan.sessionId` → run 级合计（aggregate-only，成员级显示「不可得」）；
	*   ③ 都不命中 → 丢弃，绝不往无关 run 上记账。
	* 事件可能重复投递：去重键由纯模块给出（`eventKey`），去重表在装配层持有、不落盘。
	*/
	const usageDeduper = createUsageDeduper();
	function recordUsage(event) {
		const at = now();
		for (const summary of store.list()) {
			const state = store.load(summary.runId);
			if (!state) continue;
			const memberId = memberIdOf(state.bindings, event.sessionId);
			const sessionHit = event.sessionId !== void 0 && event.sessionId === state.plan.sessionId;
			if (memberId === void 0 && !sessionHit) continue;
			const key = event.eventKey ?? `${state.plan.runId}:${event.sessionId ?? ""}:${at}:${event.usage.input ?? ""}:${event.usage.output ?? ""}:${event.usage.total ?? ""}`;
			if (usageDeduper.seen(state.plan.runId, key)) continue;
			const attributed = memberId === void 0 ? event : {
				...event,
				memberId
			};
			store.save({
				...state,
				usage: applyUsage(state.usage, attributed, at)
			});
		}
	}
	try {
		const sessionSub = onSessionEvents(ctx, (payload) => {
			try {
				const event = usageOfSessionEvent(payload);
				if (event === null) return;
				recordUsage(event);
			} catch (error) {
				warn(ctx, `用量记录失败（面板显示不可得）：${messageOf(error)}`);
			}
		});
		if (sessionSub.degraded) warn(ctx, "用量事件源降级：token 用量显示「不可得」");
		registerEffect(ctx, () => sessionSub.stop());
	} catch (error) {
		warn(ctx, `用量事件订阅失败（token 用量显示不可得）：${messageOf(error)}`);
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
