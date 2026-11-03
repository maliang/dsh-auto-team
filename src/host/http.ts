/**
 * 面板 HTTP 桥（host → client 的唯一通道）。
 *
 * 四条路由（契约与 src/client/api.ts 一一对应，改动必须两边同步）：
 *   GET  /api/auto-team/snapshot?sessionId=...                  → { data: PanelSnapshot }
 *   GET  /api/auto-team/library?sessionId=&runId=               → { data: LibraryView }
 *   GET  /api/auto-team/memory?track=&name=[&sessionId=][&workspace=] → { data: {track,name,body,chars} } | { error }
 *   POST /api/auto-team/act  { sessionId, action }              → { data: ActResult }
 *
 * 约定：
 *  - 传输层永远是 200 + `{ data }` 或 `{ error }`；**业务拒绝**放在 `data.rejected` 里（code + 中文原因），
 *    这样面板既能显示「为什么没做成」，又不会把业务规则当成 HTTP 故障；
 *  - GET /memory 是新增路由，修「编辑已有记忆点保存会把正文清空」这个缺陷（D7）：先读正文再写。
 *  - r13 把「历史 run 详情」并进 GET /library 的 runId 参数，**不新增第 5 条路由**（AC-22）。
 *
 * 传输层形状（WebRoute 字段、handler 入参与返回值）由 adapters 归一，本文件只关心「输入是什么、输出是什么」。
 */
import type { LibraryView, MemoryTrack, PanelAction, PanelSnapshot } from '../shared/types.ts'
import { BRIDGE_ROUTE } from './config.ts'
import type { Bridge } from './bridge.ts'
import { registerHttpRoutes, type HostContext, type HttpRoute } from './adapters.ts'

export interface HttpDeps {
  bridge: Bridge
  /** 无 sessionId 参数时的默认会话（单会话场景的兜底；多会话必须由 client 显式带）。 */
  defaultSessionId: () => string
  /**
   * r13：项目库装配（带缓存，由 `index.ts` 注入）。
   * 缺省时回落到 `bridge.library()` —— 两者是同一个端口，杜绝「一条通一条不通」。
   */
  library?: (query: { sessionId?: string; runId?: string }) => LibraryView
}

export function buildHttpRoutes(deps: HttpDeps): HttpRoute[] {
  return [
    {
      method: 'GET',
      path: `${BRIDGE_ROUTE}/snapshot`,
      async handle(request) {
        const query = parseQuery(request.url)
        const sessionId = query.get('sessionId') ?? deps.defaultSessionId()
        const snapshot: PanelSnapshot = deps.bridge.snapshot(sessionId)
        return { data: snapshot }
      },
    },
    {
      method: 'GET',
      path: `${BRIDGE_ROUTE}/library`,
      async handle(request) {
        const query = parseQuery(request.url)
        const sessionId = query.get('sessionId') ?? deps.defaultSessionId()
        const runId = query.get('runId')
        const call = { ...(sessionId === '' ? {} : { sessionId }), ...(runId === undefined ? {} : { runId }) }
        const view = deps.library !== undefined ? deps.library(call) : deps.bridge.library(call)
        return { data: view }
      },
    },
    {
      method: 'GET',
      path: `${BRIDGE_ROUTE}/memory`,
      async handle(request) {
        const query = parseQuery(request.url)
        const name = query.get('name') ?? ''
        if (name.trim() === '') return { error: '非法文件名' }
        // r10 AC-17：技能正文复用**同一条**正文读取口（track=skill，name=技能 id），
        // 不新开第二条路由（路由数必须仍是 3，见 test/host-contract.test.ts）。
        const raw = query.get('track')
        if (raw === 'skill') return deps.bridge.readSkillBody(name)
        const track = raw === 'public' ? 'public' : raw === 'project' ? 'project' : null
        if (track === null) return { error: 'track 必须是 public、project 或 skill' }
        // 合法性判定与读写删共用 safeMemoryName（在 bridge.readMemoryFile 内部），这里不重复实现。
        // r13 AC-16：项目记忆要能按项目读，workspace 白名单校验在 bridge 里做（不在路由层重复一份）。
        const workspace = query.get('workspace')
        return deps.bridge.readMemoryFile(track as MemoryTrack, name, workspace)
      },
    },
    {
      method: 'POST',
      path: `${BRIDGE_ROUTE}/act`,
      async handle(request) {
        let payload: unknown
        try {
          payload = await request.json()
        } catch {
          return { error: '请求体不是合法 JSON' }
        }
        const body = payload as { sessionId?: string; action?: PanelAction } | undefined
        const sessionId = body?.sessionId ?? deps.defaultSessionId()
        if (!body?.action || typeof body.action.type !== 'string') {
          return { error: '缺少 action' }
        }
        return { data: await deps.bridge.act(sessionId, body.action) }
      },
    },
  ]
}

function parseQuery(url: string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!url) return out
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  for (const pair of query.split('&')) {
    if (pair === '') continue
    const index = pair.indexOf('=')
    const key = index < 0 ? pair : pair.slice(0, index)
    const value = index < 0 ? '' : pair.slice(index + 1)
    if (key !== '' && value !== '') out.set(key, decodeURIComponent(value))
  }
  return out
}

export function registerHttpBridge(ctx: HostContext, deps: HttpDeps): boolean {
  // 宿主只有一个 WebRoute 概念（kind/path/handler），没有 method：合并成一条 prefix 路由，
  // 由 adapters 里的分发层按 req.method + req.url 选内部路由。
  // 技术方案把 registerHttpRoutes 的签名写成 2 参（不带 prefix），现状是 3 参；这里按「前缀可选」调用，
  // 两种签名都成立：路由自身已带完整路径（`${BRIDGE_ROUTE}/xxx`），prefix 只决定宿主挂载点。
  const register = registerHttpRoutes as unknown as (
    context: HostContext,
    routes: HttpRoute[],
    prefix?: string,
  ) => unknown
  try {
    register(ctx, buildHttpRoutes(deps), BRIDGE_ROUTE)
    return true
  } catch {
    return false
  }
}
