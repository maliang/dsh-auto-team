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
