import { homedir } from "node:os";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
// src/shared/const.ts
/** 面板 HTTP 桥前缀：host/http.ts 与 client/api.ts 的一致契约（改一边必须改另一边）。 */
const BRIDGE_ROUTE = "/api/auto-team";
// src/host/config.ts
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
/** 宿主工具名前缀（工具名全局唯一，必须带前缀防撞）。 */
const TOOL_PREFIX = "auto_team_";
/** 无项目上下文时的兜底工作区名（路径解析用，绝不写盘）。 */
const FALLBACK_WORKSPACE = "default";
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
	/** 整体原子写（tmp + rename）；消息账本按上限裁剪后再落盘。 */
	save(state) {
		const path = this.fileFor(state.plan.runId);
		if (path === null) throw new Error(`非法 runId：${state.plan.runId}`);
		mkdirSync(this.dir, { recursive: true });
		const normalized = {
			...state,
			version: 2,
			messages: capMessages(state.messages),
			bindings: state.bindings ?? [],
			routeAudits: state.routeAudits ?? []
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
*/
function wrapLegacy(raw) {
	if (!isRecord(raw)) return null;
	const plan = normalizePlan(isRecord(raw.plan) ? raw.plan : raw);
	if (plan === null) return null;
	return {
		version: 2,
		plan,
		plannedAt: finiteNumber(raw.plannedAt, plan.createdAt),
		messages: capMessages(asArray(raw.messages)),
		bindings: asArray(raw.bindings),
		routeAudits: asArray(raw.routeAudits)
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
*/
const TASK_STATUSES = [
	"pending",
	"blocked",
	"ready",
	"running",
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
	if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") return null;
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
function isRecord(value) {
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
/** 内置角色（id 稳定，内置标记不可删）。 */
const BUILTIN_ROLES = [
	{
		id: "pm",
		name: "产品经理",
		duty: "澄清需求、拆解目标、定义验收标准与范围外事项",
		skillIds: ["prd-writing", "docs"],
		builtin: true,
		updatedAt: 0
	},
	{
		id: "architect",
		name: "架构师",
		duty: "定模块边界与契约、技术选型权衡、脚手架与集成方案",
		skillIds: ["architecture", "review"],
		builtin: true,
		updatedAt: 0
	},
	{
		id: "dev",
		name: "高级全栈工程师",
		duty: "按任务实现代码与配置、自测并给出可复核的回执",
		skillIds: ["implementation", "testing"],
		builtin: true,
		updatedAt: 0
	},
	{
		id: "qa",
		name: "QA 测试工程师",
		duty: "把 AC 转成可执行判定、跑门禁并记录证据与缺陷",
		skillIds: ["testing", "review"],
		builtin: true,
		updatedAt: 0
	},
	{
		id: "docs",
		name: "技术文档工程师",
		duty: "维护 README/使用说明/变更记录，保证命令可复现",
		skillIds: ["docs"],
		builtin: true,
		updatedAt: 0
	},
	{
		id: "reviewer",
		name: "评审专家",
		duty: "独立复核交付物的边界、风险与证据完备性",
		skillIds: ["review", "architecture"],
		builtin: true,
		updatedAt: 0
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
				updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0
			};
		} catch {
			return;
		}
	}
	function write(role) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(pathOf(role.id), `${JSON.stringify(role, null, 2)}\n`, "utf8");
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
			const builtin = read(id)?.builtin ?? BUILTIN_ROLES.some((item) => item.id === id);
			const verdict = validateModel(role.model);
			if (!verdict.ok) return {
				ok: false,
				error: verdict.error
			};
			const next = {
				id,
				name,
				duty: (role.duty ?? "").trim(),
				skillIds: [...new Set(role.skillIds ?? [])],
				model: verdict.model,
				builtin,
				updatedAt: now()
			};
			write(next);
			return {
				ok: true,
				role: next
			};
		},
		remove(id) {
			if (BUILTIN_ROLES.some((role) => role.id === id) || read(id)?.builtin) return {
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
		/** 首次启动把内置角色与技能 md 落盘（已存在的不覆盖，保护用户编辑）。 */
		seed() {
			mkdirSync(dir, { recursive: true });
			mkdirSync(skillsDir, { recursive: true });
			for (const role of BUILTIN_ROLES) if (!existsSync(pathOf(role.id))) write({
				...role,
				updatedAt: now()
			});
			for (const skill of BUILTIN_SKILLS) {
				const path = `${skillsDir}/${skill.id}.md`;
				if (!existsSync(path)) writeFileSync(path, `${skill.body}\n`, "utf8");
			}
		}
	};
}
/** provider/model 的合法形态：非空、且不含任何空白字符（宿主路由按字符串精确匹配）。 */
const MODEL_TOKEN_PATTERN = /^\S+$/;
const EFFORTS = [
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
	if (effort !== void 0 && effort !== null && !EFFORTS.includes(effort)) return {
		ok: false,
		error: `reasoningEffort 只接受 ${EFFORTS.join(" / ")}（收到「${String(effort)}」）`
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
			tail: tailOf(result.tail, GATE_TAIL_CHARS),
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
function tailOf(text, limit) {
	if (text.length <= limit) return text;
	return `…（前 ${text.length - limit} 字符已省略，全文见产物文件）\n${text.slice(-limit)}`;
}
function safeFileName(taskId) {
	const cleaned = taskId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
	return cleaned === "" ? "gate" : cleaned.slice(0, 40);
}
// src/host/memory/inject.ts
const TRUNCATION_MARK = "…[截断]";
/** 截断尾行的最大预留（含分隔用的两个换行）；实际尾行更短，故最终 chars 必然 ≤ budget。 */
const TAIL_RESERVE = 64;
/** 预算太小连尾行都放不下时，只做截断、不加尾行（不值得为标注牺牲正文）。 */
const MIN_BUDGET_FOR_TAIL = 240;
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
function headerOf(candidate) {
	return `## ${candidate.track === "project" ? "项目记忆" : "公共记忆"} · ${candidate.name}\n`;
}
function lineCount(text) {
	return text === "" ? 0 : text.split("\n").length;
}
/** 在 limit 字符内拼装（不含截断尾行），并算出「省略了多少行」。 */
function compose(ranked, limit) {
	const totalLines = ranked.reduce((sum, item) => sum + lineCount(item.body), 0);
	const parts = [];
	const included = [];
	let used = 0;
	let includedLines = 0;
	let truncated = false;
	for (const item of ranked) {
		if (truncated) break;
		const header = headerOf(item.candidate);
		const base = (parts.length === 0 ? "" : "\n\n").length + header.length;
		const room = limit - used - base;
		if (room < 13) {
			truncated = true;
			break;
		}
		if (item.body.length <= room) {
			parts.push(`${header}${item.body}`);
			used += base + item.body.length;
			included.push(item.candidate.name);
			includedLines += lineCount(item.body);
			continue;
		}
		const cut = item.body.slice(0, room - 5);
		parts.push(`${header}${cut}${TRUNCATION_MARK}`);
		used += base + cut.length + 5;
		included.push(item.candidate.name);
		includedLines += lineCount(cut);
		truncated = true;
	}
	return {
		text: parts.join("\n\n"),
		included,
		truncated,
		omitted: Math.max(0, totalLines - includedLines)
	};
}
/** 截断标注行（QA 可 grep 的硬证据）。 */
function tailLine(chars, budget, omitted) {
	return `（记忆已截断：注入 ${chars}/${budget} 字符，省略 ${omitted} 行）`;
}
/**
* 选取并拼装注入文本。输出形如：
*   ## 项目记忆 · conventions.md
*   <正文>
*   （记忆已截断：注入 3987/4000 字符，省略 12 行）
* budget<=0 或候选全空时返回空文本且 truncated=false。
*/
function selectMemory(goal, candidates, budget) {
	const ranked = rank(goal, candidates);
	if (budget <= 0 || ranked.length === 0) return {
		text: "",
		truncated: false,
		included: [],
		chars: 0,
		omitted: 0
	};
	const full = compose(ranked, budget);
	if (!full.truncated) return {
		text: full.text,
		truncated: false,
		included: full.included,
		chars: full.text.length,
		omitted: 0
	};
	if (budget < MIN_BUDGET_FOR_TAIL) return {
		text: full.text,
		truncated: true,
		included: full.included,
		chars: full.text.length,
		omitted: full.omitted
	};
	const trimmed = compose(ranked, budget - TAIL_RESERVE);
	const chosen = trimmed.included.length > 0 ? trimmed : full;
	let tail = tailLine(chosen.text.length, budget, chosen.omitted);
	for (let round = 0; round < 3; round += 1) {
		const next = tailLine(chosen.text.length + 2 + tail.length, budget, chosen.omitted);
		if (next === tail) break;
		tail = next;
	}
	const withTail = `${chosen.text}\n\n${tail}`;
	const text = withTail.length <= budget ? withTail : chosen.text;
	return {
		text,
		truncated: true,
		included: chosen.included,
		chars: text.length,
		omitted: chosen.omitted
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
// src/host/bridge.ts
/**
* 面板桥的领域层：把「面板要看的」与「面板能做的」收敛成一个快照方法 + 一个动作方法，
* 与传输方式（HTTP / 工具调用）无关 —— 传输由 host/http.ts 与 adapters.ts 负责。
*
* 两条入口共用本文件（AC 高频缺陷「工具能用、面板不能用」的唯一防线）：
*   - HTTP：POST /api/auto-team/act  →  bridge.act
*   - 工具：auto_team_message / auto_team_receipt / auto_team_memory / auto_team_role → 同一个 bridge.act
*
* 11 个动作与拒绝码对照（TECHNICAL §4.2 / §5.x）：
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
*/
/** 门禁串行队列上限（TECHNICAL §5.3：避免一次 receipt 风暴炸出多个 shell）。 */
const GATE_QUEUE_LIMIT = 8;
/** 活动流最多保留的条数（面板只显示最近 50 条，避免快照无限膨胀）。 */
const ACTIVITY_LIMIT = 50;
/** 空验收命令的拒绝码：TECHNICAL §5.3 明确要求 GATE_FAILED，但 §4.2 的码表未收录，故窄化断言。 */
const GATE_FAILED = "GATE_FAILED";
const NOT_ENABLED_TEXT = "自动团队未启用：请先在输入框下方的「自动团队」开关处启用";
function createBridge(deps) {
	const now = deps.now ?? (() => Date.now());
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
	function activityOf(state) {
		if (!state) return [];
		const events = [];
		events.push({
			at: state.plannedAt,
			kind: "plan",
			text: `计划就绪：${state.plan.tasks.length} 个任务（尚未创建成员）`
		});
		for (const binding of state.bindings) events.push({
			at: binding.spawnedAt,
			memberId: binding.memberId,
			taskId: binding.taskId,
			kind: "spawn",
			text: `创建成员 ${binding.name}`
		});
		for (const message of state.messages) events.push({
			at: message.at,
			memberId: message.toMemberId,
			taskId: message.taskId,
			kind: "message",
			text: `${message.from} → ${message.to}：${firstLine(message.body)}`
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
		return events.sort((a, b) => b.at - a.at).slice(0, ACTIVITY_LIMIT);
	}
	function membersOf(state, roles) {
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
				lastEventAt: lastEventAtOf(state, task.memberId, state.plannedAt),
				modelRoute: describeRoute(roleById.get(task.roleId)),
				canResume: status !== "done"
			});
		}
		return views;
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
		return {
			limit: state ? Math.min(state.plan.maxConcurrent, host.limit, 8) : Math.min(host.limit, 8),
			running,
			source: host.source
		};
	}
	function snapshot(sessionId) {
		const state = loadState(sessionId);
		const roles = deps.roles.list();
		const { files, candidates } = memoryFiles();
		const selected = selectMemory(state?.plan.tasks.map((task) => task.title).join(" ") ?? "", candidates, MEMORY_INJECT_BUDGET);
		return {
			enabled: flags[sessionId]?.enabled === true,
			runId: state?.plan.runId,
			planStatus: state?.plan.status,
			plannedAt: state?.plannedAt,
			tasks: state?.plan.tasks ?? [],
			members: membersOf(state, roles),
			messages: state?.messages ?? [],
			routeAudits: state?.routeAudits ?? [],
			concurrency: concurrencyOf(state),
			memory: {
				injectedChars: selected.chars,
				budget: MEMORY_INJECT_BUDGET,
				truncated: selected.truncated,
				files
			},
			roles,
			activity: activityOf(state)
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
			switch (action.type) {
				case "toggle":
					flags[sessionId] = {
						enabled: action.enabled,
						updatedAt: now()
					};
					persistFlags();
					return accept(sessionId, [action.enabled ? "自动团队已启用：队长可以拆解目标并派发成员" : "自动团队已停用：不会派发任何成员（已创建的成员不会被中断）"]);
				case "dispatch": {
					const state = loadState(sessionId);
					if (!state) return reject("NO_PLAN", "当前会话还没有执行计划：先让队长拆解目标（auto_team_plan）", sessionId);
					if (action.runId !== void 0 && action.runId !== state.plan.runId) return reject("NOT_FOUND", `找不到运行 ${action.runId}（当前会话最新运行是 ${state.plan.runId}）`, sessionId);
					const status = state.plan.status;
					if (status !== "draft" && status !== "dispatching" && status !== "paused") return reject("NO_PLAN", `计划状态为 ${status}，不能派发（需要 draft/dispatching/paused）`, sessionId);
					const boundIds = new Set(state.bindings.filter((binding) => binding.retired !== true).map((binding) => binding.taskId));
					const unbound = readyTasks(state.plan.tasks).filter((taskId) => !boundIds.has(taskId));
					if (status === "dispatching" && unbound.length === 0) return reject("PLAN_ALREADY_DISPATCHED", "计划已派发：成员已在运行，不会重复起人（中断的成员请用「继续」恢复）", sessionId);
					const outcome = await deps.dispatch(state);
					const notices = [];
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
							timeoutMs: deps.gate.timeoutMs ?? 3e5,
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
					}, now());
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
			const selected = selectMemory(goal, candidates, MEMORY_INJECT_BUDGET);
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
*/
function registerHttpRoutes(ctx, routes, prefix = BRIDGE_ROUTE) {
	const sink = ctx.webServer;
	if (!sink?.register) {
		ctx.logger?.warn?.("[auto-team] 宿主未提供 webServer 服务，面板将只能看到空快照");
		return false;
	}
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
			const selection = ctx.agentDefaultModel?.currentSelection?.();
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
		const resolver = ctx.llm?.resolveCallConfig;
		if (!resolver) {
			ctx.logger?.warn?.("[auto-team] 宿主未提供 llm.resolveCallConfig，跳过模型路由预校验");
			return route;
		}
		try {
			const resolved = await resolver({
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
// src/host/tools.ts
const NOT_ENABLED = "自动团队未启用：请在输入框下方的「自动团队」开关处启用后再试。";
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
					version: 2,
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
			description: "读写团队记忆（双轨 md）：track=public 为跨项目公共记忆，track=project 为当前项目记忆。写入自动限制行数并落来源标注。",
			parameters: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: [
							"list",
							"read",
							"write"
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
					body: { type: "string" }
				},
				required: ["action", "track"]
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
						files: snapshot.memory.files
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
function captainSection(deps, sessionId) {
	const snapshot = deps.bridge.snapshot(sessionId);
	const lines = [
		"## 自动团队（队长视角）",
		`当前会话的自动团队开关：${snapshot.enabled ? "已启用" : "未启用"}${snapshot.enabled ? "" : "——未启用时不得创建成员，先用一句话说明如何启用"}。`,
		"",
		"工作方式（顺序不可颠倒）：",
		"1. **先 plan，再 dispatch**：把目标拆成有依赖的任务图用 `auto_team_plan`（每个任务必须指定 roleId 与可执行的 acceptance），**计划条目先落地**，用户确认（或明确说「开干」）后才用 `auto_team_dispatch` 派发。",
		"2. `auto_team_dispatch` **必须带 plan 返回的 runId**：它同时用于确认「你派的是刚给用户看的那份计划」。缺少 runId 会被直接拒绝——这是「计划早于第一个成员」的机械保证（AC-30），不要试图绕过。",
		"3. 派发前提醒用户：计划可在面板「计划」页改角色、取消；取消后成员数为 0。派发后同一时刻在跑的任务数受 maxConcurrent 限制（默认 3），超出的会排队等前置任务过门禁。",
		"4. 成员是**可续聊**的独立 Agent：用 `auto_team_message` 直达消息，中断后用同一 memberId 继续（面板「继续」或 `resume`），不要重新创建同名成员。",
		"5. **完成必须过门禁**：任务从 running 到 done 唯一入口是 `auto_team_receipt`（host 会执行该任务的 acceptance 并记录命令、退出码、输出尾部）。成员口头说「做完了」、你读代码觉得「应该没问题」都不算完成；门禁失败的任务转 rework，其下游保持 blocked，你必须把失败证据发回原成员再改。",
		"6. 团队记忆分公共与项目两轨，都是 md：相关约定优先 `auto_team_memory` 读取，沉淀时才写入。",
		"7. 面板（输入框下方开关 + 右栏「自动团队」）是用户的可视入口与唯一状态来源；你的结论要与面板显示一致。"
	];
	if (snapshot.memory.truncated) lines.push("", `注意：团队记忆已超出注入预算（${snapshot.memory.injectedChars}/${snapshot.memory.budget} 字符），面板显示「已截断」。`);
	return lines.join("\n");
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
* 全计划任务名的两两唯一性断言（AC-4）。
*
* `reserved` 是「未退役 binding 的名字」：它们已经占着宿主里的成员名，新派发的任务不能撞上去，
* 但**同 taskId 自占不算冲突**（幂等续跑必须继续可用）。已退役 binding 的名字可回收，不参与。
*
* 只在「≥2 个**不同** taskId 共享同一 name」时判冲突：同一任务重复出现不是冲突。
*/
function memberNameCollisions(tasks, options = {}) {
	const nameOf = options.nameOf ?? memberNameFor;
	const byName = /* @__PURE__ */ new Map();
	const remember = (name, taskId) => {
		const taskIds = byName.get(name);
		if (!taskIds) {
			byName.set(name, [taskId]);
			return;
		}
		if (!taskIds.includes(taskId)) taskIds.push(taskId);
	};
	for (const task of tasks) remember(nameOf(task), task.id);
	for (const item of options.reserved ?? []) remember(item.name, item.taskId);
	return [...byName.entries()].filter(([, taskIds]) => taskIds.length > 1).map(([name, taskIds]) => ({
		name,
		taskIds
	}));
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
	let next = state;
	let changed = false;
	const planStatus = next.plan.status;
	if (planStatus !== "draft" && planStatus !== "dispatching" && planStatus !== "paused") {
		for (const task of next.plan.tasks) if (task.status === "pending" || task.status === "ready") skipped.push({
			taskId: task.id,
			reason: "NO_PLAN"
		});
		return {
			state: next,
			started,
			skipped,
			errors
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
			errors
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
			errors
		};
	}
	const nameOf = deps.memberNameFor ?? memberNameFor;
	const reserved = next.bindings.filter((binding) => binding.retired !== true).map((binding) => ({
		taskId: binding.taskId,
		name: binding.name
	}));
	const collisions = memberNameCollisions(next.plan.tasks, {
		nameOf,
		reserved
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
		const name = nameOf(task);
		const collision = collisions.find((item) => item.taskIds.includes(taskId));
		if (collision) {
			errors.push({
				taskId,
				code: "MEMBER_NAME_COLLISION",
				error: `成员名冲突：${collision.name} 同时属于任务 ${collision.taskIds.join("、")}；本次不派发（请修改任务 id 或角色，系统不会自动改名）`
			});
			continue;
		}
		let prompt = "";
		try {
			prompt = deps.buildPrompt({
				plan: next.plan,
				task,
				role,
				name
			});
		} catch (error) {
			errors.push({
				taskId,
				error: `生成提示词失败：${messageOf$1(error)}`
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
			changed = true;
			slots -= 1;
		} catch (error) {
			errors.push({
				taskId,
				error: messageOf$1(error)
			});
		}
	}
	if (changed) deps.store.save(next);
	return {
		state: next,
		started,
		skipped,
		errors
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
function applyReceipt(state, taskId, receipt, now) {
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
		const giveUp = nextAttempts >= 3;
		next = patchTask(next, taskId, {
			status: giveUp ? "failed" : "rework",
			attempts: nextAttempts,
			evidence
		});
		body = giveUp ? `返工已达上限（${nextAttempts}/3 次）：任务「${task.title}」已转人工，下游保持阻塞。${receipt.note ?? ""}`.trim() : `返工第 ${nextAttempts}/3 次：任务「${task.title}」未通过门禁，请按证据修改后再次回报。${receipt.note ?? ""}`.trim();
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
function messageOf$1(error) {
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
function reconcileMembers(state, members, now) {
	const at = now ?? Date.now();
	let next = state;
	let changed = 0;
	for (const task of next.plan.tasks) {
		if (task.status !== "running" && task.status !== "gate" && task.status !== "interrupted") continue;
		const binding = next.bindings.find((item) => item.taskId === task.id && !item.retired);
		const member = binding ? members.find((row) => row.id === binding.memberId || row.name === binding.name) : void 0;
		if (!member) {
			if (task.status === "interrupted") continue;
			const exhausted = (task.attempts ?? 0) >= 3;
			next = patch(next, task.id, { status: exhausted ? "failed" : "interrupted" });
			next = appendMessage(next, makeMessage({
				from: "captain",
				to: "user",
				taskId: task.id,
				at,
				body: exhausted ? `成员「${binding?.name ?? task.roleId}」已失联且重试次数用尽（${task.attempts ?? 0}/3）：任务「${task.title}」转人工。` : `成员「${binding?.name ?? task.roleId}」已失联：任务「${task.title}」标记为中断，可在面板点「恢复」重试。`
			}));
			changed += 1;
			continue;
		}
		const status = normalizeHostStatus(member.status);
		if (status === "dead") {
			if (task.status === "interrupted") continue;
			const exhausted = (task.attempts ?? 0) >= 3;
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
/** 轮询器：一个 run 一次 listMembers（不是一任务一次），只在存在非终态任务时才查。 */
function createMemberWatcher(deps) {
	const now = deps.now ?? Date.now;
	const intervalMs = deps.intervalMs ?? 1500;
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
				if (!state.plan.tasks.some((task) => task.status === "running" || task.status === "gate" || task.status === "interrupted")) continue;
				if (members === null) try {
					members = await deps.listMembers();
				} catch {
					return changed;
				}
				const result = reconcileMembers(state, members, now());
				if (result.changed > 0) {
					deps.store.save(result.state);
					deps.onReconciled?.(result.state);
					changed += result.changed;
				}
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
	return [
		`# 角色：${role?.name ?? input.task.roleId}`,
		role?.duty ? `职责：${role.duty}` : "",
		`模型路由：${describeRoute(role)}`,
		"",
		`## 本次任务（${input.task.id}）`,
		input.task.title,
		input.task.dependsOn.length > 0 ? `前置任务（已完成）：${input.task.dependsOn.join("、")}` : "",
		"",
		"## 验收判定（必须实际执行并回报退出码）",
		input.task.acceptance === "" ? "（未声明；视为需要人工确认，不得自称完成）" : `\`${input.task.acceptance}\``,
		"",
		"## 团队记忆（截断策略：总预算固定，超出部分不进上下文）",
		memory.text === "" ? "（暂无相关记忆）" : memory.text,
		memory.truncated ? "\n（注意：记忆已截断，完整内容请用 auto_team_memory 读取）" : "",
		"",
		"## 技能",
		skills.text === "" ? "（无）" : skills.text,
		skills.missing.length > 0 ? `\n（缺失技能定义：${skills.missing.join("、")}）` : ""
	].filter((line) => line !== "").join("\n");
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
* 只需要两个「一定存在」的服务做必需依赖；其余（agentTeams/llm/webServer）按可选访问，
* 缺失时功能降级而不是整插件加载失败（AC-9）。
*/
const inject = ["tools", "systemPrompt"];
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
	/** 宿主成员名单（做成方法而不是快照：每次对账都取当时的事实，不用缓存的旧名单）。 */
	function listMembers() {
		return listHostMembers(ctx);
	}
	function hostConcurrency() {
		return resolveConcurrencyLimit(ctx);
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
			errors: result.errors
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
	const applyReceiptPort = (state, taskId, receipt, at) => applyReceipt(state, taskId, receipt, at);
	const sendMessage = (memberId, text) => spawnPorts.sendMessage(memberId, text);
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
			artifactsDir,
			timeoutMs: GATE_TIMEOUT_MS
		},
		hostConcurrency,
		now
	});
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
		const watcher = createMemberWatcher({
			store,
			listMembers,
			now
		});
		watcher.start();
		registerEffect(ctx, () => watcher.stop());
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
var host_default = {
	name,
	inject,
	apply
};
export { apply, host_default as default, inject, name };
