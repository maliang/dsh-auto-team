/**
 * 面板数据访问层 —— client 半**唯一**的 HTTP 出口。
 *
 * 契约与 host/http.ts 一一对应（改一边必须改另一边）：
 *   GET  {BRIDGE_ROUTE}/snapshot?sessionId=…                    → PanelSnapshot
 *   GET  {BRIDGE_ROUTE}/memory?track=&name=[&sessionId=][&workspace=] → {track,name,body,chars}（新增，修 D7）
 *   GET  {BRIDGE_ROUTE}/library?[sessionId=][&runId=]           → LibraryView（r13：左栏 + 历史详情）
 *   POST {BRIDGE_ROUTE}/act  { sessionId, action }              → ActResult
 *
 * r13 为什么历史详情也走 `/library`：路由条数被 AC-22 冻结为 4，历史详情是
 * `library(runId=…)` 的一个分支（返回 `detail: RunDetailView`），不新开第 5 条路由 ——
 * 每多一条路由就多一个解包点、多一套失败文案。
 *
 * 纪律（本项目历史踩坑）：
 *  1. 返回一定是 `{ data }` 或 `{ error }` 的**包装**，调用方必须解构 —— 整包赋值就是
 *     「点了没反应 / 永远空」那一族 bug 的成因；
 *  2. **解包只允许发生在 `request()` 这一个函数里**（组件、store 都不许再解第二次）。
 *     新增接口也必须复用 `request()`，禁止自己写一套 fetch + json + 判空。
 */
import type {
  ActResult,
  LibraryView,
  MemoryTrack,
  PanelAction,
  PanelSnapshot,
  Result,
} from '../shared/types.ts'
// 前缀是 host/client 两半的共同契约，单一定义在 shared（client 不允许 import host 半，见 D6）。
import { BRIDGE_ROUTE } from '../shared/const.ts'

/** `GET /memory` 的 data 载荷（面板记忆页「先读正文再编辑」，修 D7）。 */
export interface MemoryBodyPayload {
  track: MemoryTrack
  name: string
  body: string
  chars: number
}

/**
 * 技能正文载荷（r10 AC-17）：**复用同一条 `GET /memory` 路由**（`track=skill&name=<id>`）。
 *
 * 为什么不新开 `/skill` 路由：AC-25 把「路由仍 3 条」冻结成判据；更重要的是正文读取
 * 已经有一条通了的 `{data,error}` 通道，再开第二条就多一处解包、多一种失败文案，
 * 这正是本项目历史 bug 族（「两条链路给出不同结论」）的成因。
 */
export interface SkillBodyPayload {
  id: string
  title: string
  body: string
  chars: number
}

export interface PanelApi {
  snapshot(sessionId: string): Promise<Result<PanelSnapshot>>
  /**
   * 发一个面板动作。
   *
   * 注意返回类型是 **Result<ActResult>** 而不是 ActResult：传输层失败（路由未注册 / 宿主没起）
   * 与业务拒绝（`data.rejected`）是两种事，前者必须能被界面说出来，否则按钮看起来「点了没反应」。
   */
  act(sessionId: string, action: PanelAction): Promise<Result<ActResult>>
  /** 读记忆正文：编辑已有文件前必须先读，否则保存会把已有内容清空（D7）。 */
  readMemory(
    sessionId: string,
    track: MemoryTrack,
    name: string,
    /** r13：左栏读的是**别的项目**的记忆，必须带上目标工作区（缺省 = 当前会话的项目）。 */
    workspace?: string,
  ): Promise<Result<MemoryBodyPayload>>
  /**
   * 项目库（r13 AC-23）：左栏项目列表 / 项目详情 / 历史 run 详情共用这一个出口。
   *
   * `runId` 非空 ⇒ 宿主额外装配 `detail: RunDetailView`（历史详情不新开路由，AC-22 冻结 4 条）。
   * 只在**左栏真的被打开**或**用户点开某条历史**时调用；snapshot 轮询期间绝不触发它（AC-23）。
   */
  library(sessionId: string, runId?: string): Promise<Result<LibraryView>>
  /**
   * 读技能正文（r10 AC-17）：编辑弹层打开时才读，读完才把 textarea 从骨架换成正文。
   * 走的是 memory 路由的 `track=skill` 分支（auth 与错误处理完全复用）。
   */
  readSkill(sessionId: string, id: string): Promise<Result<SkillBodyPayload>>
}

export interface ApiOptions {
  /** 缺省同源；测试或非标准部署时可注入。 */
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export function createPanelApi(options: ApiOptions = {}): PanelApi {
  const base = (options.baseUrl ?? '').replace(/\/+$/, '')
  const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)

  /** 全项目唯一解包点：HTTP 响应 → `{ data }` / `{ error }`。 */
  async function request<T>(path: string, init?: RequestInit): Promise<Result<T>> {
    if (!doFetch) return { error: '当前环境没有 fetch，无法读取自动团队面板数据' }
    try {
      const response = await doFetch(`${base}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      })
      if (!response.ok) return { error: `面板接口失败：HTTP ${response.status}` }

      let payload: { data?: T; error?: string } | null
      try {
        payload = (await response.json()) as { data?: T; error?: string } | null
      } catch {
        return { error: '面板接口返回的不是合法 JSON（宿主版本可能不一致）' }
      }
      if (payload === null || typeof payload !== 'object') {
        return { error: '面板接口返回了空数据（契约不一致）' }
      }
      const failure = (payload as { error?: unknown }).error
      if (typeof failure === 'string' && failure !== '') return { error: failure }
      const data = (payload as { data?: unknown }).data
      if (data === undefined) return { error: '面板接口返回了空数据（契约不一致）' }
      return { data: data as T }
    } catch (error) {
      return { error: `面板接口不可达：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  return {
    snapshot(sessionId: string) {
      return request<PanelSnapshot>(`${BRIDGE_ROUTE}/snapshot?sessionId=${encodeURIComponent(sessionId)}`)
    },
    act(sessionId: string, action: PanelAction) {
      return request<ActResult>(`${BRIDGE_ROUTE}/act`, {
        method: 'POST',
        body: JSON.stringify({ sessionId, action }),
      })
    },
    readMemory(sessionId: string, track: MemoryTrack, name: string, workspace?: string) {
      const query = `track=${encodeURIComponent(track)}&name=${encodeURIComponent(name)}&sessionId=${encodeURIComponent(sessionId)}${
        workspace === undefined || workspace === '' ? '' : `&workspace=${encodeURIComponent(workspace)}`
      }`
      return request<MemoryBodyPayload>(`${BRIDGE_ROUTE}/memory?${query}`)
    },
    library(sessionId: string, runId?: string) {
      const query = `sessionId=${encodeURIComponent(sessionId)}${
        runId === undefined || runId === '' ? '' : `&runId=${encodeURIComponent(runId)}`
      }`
      return request<LibraryView>(`${BRIDGE_ROUTE}/library?${query}`)
    },
    readSkill(sessionId: string, id: string) {
      // track=skill 是 host/http.ts 里同一个自述式 body 读取口的分支（路由条数不变）
      const query = `track=skill&name=${encodeURIComponent(id)}&sessionId=${encodeURIComponent(sessionId)}`
      return request<SkillBodyPayload>(`${BRIDGE_ROUTE}/memory?${query}`)
    },
  }
}

/** 单例：两个挂载面（开关行与面板）必须共享同一实例，否则开关状态会两处不同步。 */
export const panelApi: PanelApi = createPanelApi()
