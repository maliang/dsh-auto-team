/**
 * 宿主侧常量与上限。集中一处，避免「并发 3 / 记忆 4000 字符 / 门禁 300s」这类数字散落在
 * 多个文件里漂移（改阈值不必搜代码，测试与文档引用同一个名字）。
 *
 * 跨半共享的那几个（`PLUGIN_ID`、`BRIDGE_ROUTE`、面板轮询间隔）定义在 `src/shared/const.ts`：
 * 它们的消费方包括 **client**，而 client 不允许 import host 半的任何模块（AC-1 零直接 import）。
 * 这里只做 re-export，保证「单一定义、两处可见」，不产生第二份字面量。
 */

export { PLUGIN_ID, BRIDGE_ROUTE, PANEL_ACTIVE_MS, PANEL_IDLE_MS } from '../shared/const.ts'

import { PANEL_ACTIVE_MS } from '../shared/const.ts'
import type { AutoTeamSettings, TriggerKind } from '../shared/types.ts'

/**
 * 面板轮询间隔的**兼容别名**（= 活跃档 2000ms）。
 *
 * 旧实现（固定间隔轮询）用这个名字；新的单 timer store 按「有运行中任务 2000 / 空闲 5000」
 * 两档取值，请直接用 `PANEL_ACTIVE_MS` / `PANEL_IDLE_MS`。别名刻意取活跃档（而不是旧的 5000）：
 * 这样即使旧代码还在用，AC-18 的预算（watcher 1500 + 轮询 2000 = 3500 ≤ 5000）依然成立。
 */
export const PANEL_POLL_MS = PANEL_ACTIVE_MS

/** 默认并发上限（PRD：默认 3，可被计划显式覆盖，硬上限 8）。 */
export const DEFAULT_MAX_CONCURRENT = 3

/** 并发硬上限：超过后即使计划写明也不采用（避免把宿主资源打满）。 */
export const MAX_CONCURRENT_LIMIT = 8

/** 记忆注入预算（字符）。AC-25：超出必须截断并在面板显示「已截断」。 */
export const MEMORY_INJECT_BUDGET = 4000

/** 单任务允许成员写入记忆的行数上限（PRD）。 */
export const MEMORY_LINES_PER_TASK = 20

/** 门禁输出尾部保留字符数（AC-19 证据抽屉只展示尾部，全文落盘）。 */
export const GATE_TAIL_CHARS = 4000

/** 门禁命令默认超时（毫秒）。AC-19：超时按「未通过」处理，且不得阻塞事件循环（异步执行）。 */
export const GATE_TIMEOUT_MS = 300_000

/**
 * 门禁日志「落盘 → 返回」的等待上限（毫秒）。
 *
 * 门禁执行完不能立刻 resolve：全量输出是流式写文件的，立刻返回会让调用方读到空/半截产物，
 * 证据抽屉显示「无输出」（并行跑测试时必现的竞态）。这里等写流 close，但给一个上限兜底，
 * 磁盘卡住时门禁也不能一直挂着。
 */
export const GATE_FLUSH_TIMEOUT_MS = 1000

/** 成员存活对账轮询间隔（毫秒）。AC-18：1500 + 前端 2000 = 3500 ≤ 5000 刷新预算。 */
export const WATCHER_INTERVAL_MS = 1500

/**
 * 停滞判定阈值（毫秒）：成员「活着但持续没有实质工具调用」多久算停滞（AC-13）。
 *
 * **全仓唯一定义处**：`team/stall.ts` 的 `stallOf()` 只接收参数、不自读常量，
 * `watcher.tick`（告警出口）与 `bridge.membersOf`（展示出口）都从这里取阈值传入 ——
 * 两处共用同一份判定实现 + 同一个阈值，才不会出现「面板说没停、日志说停了」的分叉。
 * 判据：全仓 `STALL_MS` 的 `export const` 定义只允许出现在本文件（别处必须 import 或收参数）。
 */
export const STALL_MS = 90_000

/** resume 幂等去抖窗口（毫秒）。AC-17：窗口内重复 resume 必须 resumed=0 且 unchanged。 */
export const RESUME_DEBOUNCE_MS = 3000

/** 同一任务允许的最大返工次数（AC-19）：达到后转 failed，不再自动重派。 */
export const MAX_ATTEMPTS = 3

/* ───────────────────────── r5：队长分层 / Inline & Spill / Trigger 总线 ───────────────────────── */

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
export const NOWAIT_THRESHOLD_MS = 5_000

/**
 * Trigger 去重窗口（毫秒）：同一 `dedupeKey` 在窗口内只允许推进一次（AC-15）。
 *
 * **全仓唯一定义处**（AC-15 的 grep 判据）：`team/trigger.ts` 的 `fastOf()` 只接收 `dedupeMs` 参数，
 * 由 `trigger-bus.ts` 从这里取一次传进去——窗口在两处各写一份就会出现「单测窗口内、
 * 运行期窗口外」的分叉，而这种分叉只能靠真实事件才暴露。
 */
export const TRIGGER_DEDUPE_MS = 60_000

/**
 * Trigger 账本上限：一次运行里最多保留最近多少条 `triggers`（AC-15/AC-17 的落盘证据）。
 *
 * 与 `store.ts` 的 `MESSAGES_LIMIT=200` / `STALL_ALERTS_LIMIT=50` 同族：落盘文件是幂等与
 * 「为什么没推进」的唯一数据源，必须像消息账本一样有上限，否则事件密集时单 run 文件无限长大。
 * 定义留在本文件（配置单点），`store.ts` 只 import 再转出，避免同一个数字两处 `export const`。
 */
export const TRIGGER_LOG_LIMIT = 100

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
export const TRIGGER_KINDS: readonly TriggerKind[] = [
  'gate_failed',
  'member_exit',
  'dep_ready',
  'stall_timeout',
]

/** 单条内联记忆项字符上限（AC-7）：索引只放标题 + 首句，放不下就截这一条而不是砍整段。 */
export const MEMORY_INLINE_ITEM_MAX = 200

/** 每条内联记忆携带的关联 ID 个数上限（AC-7）：3 个足够提示「还有哪些可以展开」，再多挤占预算。 */
export const MEMORY_RELATED_MAX = 3

/** 单次记忆展开的字符上限（AC-9）：超出截断并置 `truncated`，绝不把 4000 预算一次吃光。 */
export const MEMORY_EXPAND_MAX_CHARS = 4000

/** 记忆展开的跳数上限（AC-9）：2 跳 = 「展开一条 + 顺着它的关联再展开一层」，防环形引用打转。 */
export const MEMORY_EXPAND_MAX_DEPTH = 2

/** 宿主工具名前缀（工具名全局唯一，必须带前缀防撞）。 */
export const TOOL_PREFIX = 'auto_team_'

/** 无项目上下文时的兜底工作区名（路径解析用，绝不写盘）。 */
export const FALLBACK_WORKSPACE = 'default'

/**
 * 宿主对**团队成员名**的硬契约：lower-kebab（`^[a-z0-9]+(-[a-z0-9]+)*$`）。
 *
 * 宿主 `spawnTeammate` 内部用 `memberName()` 校验，不匹配直接抛 `TEAM_INVALID_MEMBER_NAME`，
 * 整个 spawn 被拒、任务停在 pending（面板只看到一条 error notice）。
 * 我们无法改宿主，只能保证**自己生成**的名字一定合法 —— 而名字里掺进了模型自填的任务 id
 * （`Login_Flow` / `t 1` / `重构-登录` 都可能出现），所以归一化是硬要求，不是美化。
 *
 * 集中在这里的唯一理由是：这是**宿主的**契约（不是我们的偏好），实现与测试必须引用同一个
 * 字面量，否则下次改生成规则时会漂成两套（本项目历史 bug 族）：
 *   - 实现：`src/host/team/dispatch.ts` 的 `memberNameFor`
 *   - 守卫：`test/dispatch.test.ts` 的 `HOST_MEMBER_NAME` 套件（含敌意 id 扫描）
 */
export const HOST_MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 宿主成员名长度上限（`memberName()` 同款截断；聚合后再截会留下结尾 `-`，须二次归一）。 */
export const HOST_MEMBER_NAME_MAX = 48

/* ─────────────────────── 可配参数（r7 AC-11：缺省值 = 今天的冻结常量） ─────────────────────── */

/**
 * 设置页可配参数的**缺省值**（r7 AC-11/AC-13）。
 *
 * 铁律：每一项都必须引用上面的冻结常量，不许在这里重新写一遍数字 ——
 * 否则「默认并发 3」就有两个真值，settings.json 少写一项与不写文件会给出不同结论。
 * 上面那些常量本身**一个值都不改**（AC-11 的形态冻结判据就是它们各自只出现一次）。
 */
export const DEFAULT_SETTINGS: AutoTeamSettings = {
  concurrencyLimit: DEFAULT_MAX_CONCURRENT,
  memoryBudget: MEMORY_INJECT_BUDGET,
  stallMs: STALL_MS,
  maxAttempts: MAX_ATTEMPTS,
  gateTimeoutMs: GATE_TIMEOUT_MS,
}

/**
 * 可配参数的合法域（闭区间，均为整数）。写在这里的唯一理由是**校验与设置页提示共用同一份**：
 * 校验函数（host/settings.ts）按它拒绝非法值，设置页按同一个数字显示「1~8」，
 * 两边各写一份就会出现「页面说 1~8、保存时按 1~6 拒」的错位。
 */
export const SETTINGS_LIMITS = {
  concurrencyLimit: [1, MAX_CONCURRENT_LIMIT],
  memoryBudget: [200, MEMORY_INJECT_BUDGET],
  stallMs: [1_000, 600_000],
  maxAttempts: [1, 10],
  gateTimeoutMs: [1_000, 600_000],
} as const

/**
 * 角色提示词字符上限（r7 AC-7）。
 *
 * 8000 字符是「一整段可读的职责说明」的合理上界：再长成员提示词会挤占任务与记忆的预算，
 * 而且设计稿里提示词框是固定 96px 内滚，超长内容在界面上等于不可编辑。
 */
export const ROLE_PROMPT_MAX = 8000
