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
export const PLUGIN_ID = 'dsh-auto-team'

/** 面板 HTTP 桥前缀：host/http.ts 与 client/api.ts 的一致契约（改一边必须改另一边）。 */
export const BRIDGE_ROUTE = '/api/auto-team'

/**
 * 面板轮询的「活跃」间隔（毫秒）：快照里存在 running/gate 任务时用这一档。
 *
 * AC-18 的刷新预算（≤5s）就是这两个数加出来的：watcher 1500ms + 前端 2000ms = 最坏 3500ms。
 * 改成 3000ms 会直接超出预算，所以不要把这里当"随便调的体验值"。
 */
export const PANEL_ACTIVE_MS = 2_000

/** 面板轮询的「空闲」间隔（毫秒）：没有运行中任务时降频，避免空转打宿主。 */
export const PANEL_IDLE_MS = 5_000

/**
 * 技能正文长度上限（字符，r10 AC-19）。
 *
 * 放在 shared 而不是 host/config.ts：**客户端编辑弹层要先拦**（否则用户敲到一半才被宿主拒绝），
 * 宿主 `roles/skills-repo.ts` 还要再校验一次（不信任客户端）。两处必须是同一个数，
 * 否则会出现「界面放行、宿主拒绝」的错位——这正是本文件存在的理由（单一定义、两处可见）。
 */
export const SKILL_BODY_MAX = 20_000

/** 技能标题长度上限（字符）：同样是「弹层先拦 + 宿主再校验」的两处共用一个数。 */
export const SKILL_TITLE_MAX = 80

/** 技能说明长度上限（字符）：前端单行展示（line-clamp: 1），写长了也读不出来。 */
export const SKILL_DESCRIPTION_MAX = 200

/**
 * 技能清单下发上限（条）：投影要进快照、快照每 2s 轮询一次，
 * 不能因为用户塞了几千条 md 就把整帧撑爆（宿主按内置序 + 标题序截断）。
 */
export const SKILL_LIST_LIMIT = 200
