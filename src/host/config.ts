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
