/**
 * r44 面板 HTTP 准入测试的共享桩（t6）。
 *
 * 只做两件事，不替实现做判断：
 *  1. 按真实宿主形状给 `registerHttpRoutes` 一个假 ctx：`ctx.get('webServer')` 返回可注册的
 *     sink，`ctx.get('connection')` 返回可替换的假连接服务，`ctx.logger.warn` 收集告警。
 *  2. 提供「像 Node http 一样」的 req/res：`on()` 允许订阅 data/end，`end(chunk)` 记下响应体。
 *
 * 关键点：`connection` 用**可变闭包**而不是每次重建 ctx，才能断言「每请求现读服务」；
 * `throwOnBodyRead` 让 `req.on` 一被调用就抛——用来证明准入发生在 `readJson` 之前。
 */
import { registerHttpRoutes, type HostContext, type HttpRoute } from '../../src/host/adapters.ts'

export interface ExchangeOptions {
  method?: string
  url?: string
  /** 有值时模拟一条 data 分片（随后触发 end）。 */
  body?: string
  /** true：`req.on` 一被调用就抛错，模拟「读 body 本身失败」。 */
  throwOnBodyRead?: boolean
}

export interface ExchangeResult {
  status: number
  body: string
  /** `req.on` 被订阅的次数（readJson 正常会订阅 data/error/end 三次）。 */
  subscriptions: number
  /** 被调用的 route.handle 次数（准入拒绝时必须为 0）。 */
  handleCalls: number
}

export interface AdmissionHarness {
  warnings: string[]
  setConnection(next: unknown): void
  invoke(options?: ExchangeOptions): Promise<ExchangeResult>
}

interface FakeRequest {
  method?: string
  url?: string
  on(event: string, listener: (chunk?: unknown) => void): unknown
}

interface FakeResponse {
  statusCode?: number
  sent: string
  setHeader(name: string, value: string): void
  end(chunk?: string): void
}

type RegisteredRoute = { handler: (req: FakeRequest, res: FakeResponse) => Promise<void> }

export function createAdmissionHarness(initialConnection: unknown): AdmissionHarness {
  let connection = initialConnection
  const warnings: string[] = []
  const registered: RegisteredRoute[] = []
  let handleCalls = 0

  const ctx = {
    get: (name: string) => {
      if (name === 'webServer') {
        return {
          register: (route: unknown) => {
            registered.push(route as RegisteredRoute)
          },
        }
      }
      if (name === 'connection') return connection
      return undefined
    },
    logger: { warn: (text: string) => void warnings.push(text), info: () => {} },
  } as unknown as HostContext

  const routes: HttpRoute[] = [
    {
      method: 'GET',
      path: '/api/auto-team/snapshot',
      handle: async () => {
        handleCalls += 1
        return { data: { ok: true } }
      },
    },
    {
      method: 'POST',
      path: '/api/auto-team/act',
      handle: async () => {
        handleCalls += 1
        return { data: { posted: true } }
      },
    },
  ]

  if (!registerHttpRoutes(ctx, routes, '/api/auto-team') || registered.length !== 1) {
    throw new Error('r44 桩：registerHttpRoutes 未注册唯一 prefix 路由（ctx.get("webServer") 桩失效）')
  }
  const handler = registered[0]!.handler

  async function invoke(options: ExchangeOptions = {}): Promise<ExchangeResult> {
    const listeners = new Map<string, (chunk?: unknown) => void>()
    let subscriptions = 0
    const req: FakeRequest = {
      method: options.method ?? 'GET',
      url: options.url ?? '/api/auto-team/snapshot',
      on(event, listener) {
        subscriptions += 1
        if (options.throwOnBodyRead) throw new Error('r44 桩：准入之前不应订阅 body')
        listeners.set(event, listener)
        return req
      },
    }
    const res: FakeResponse = {
      statusCode: 0,
      sent: '',
      setHeader() {},
      end(chunk?: string) {
        res.sent = chunk ?? ''
      },
    }

    const pending = handler(req, res)
    if (!options.throwOnBodyRead) {
      if (options.body !== undefined) listeners.get('data')?.(options.body)
      listeners.get('end')?.()
    }
    await pending
    return { status: res.statusCode ?? 0, body: res.sent, subscriptions, handleCalls }
  }

  return {
    warnings,
    setConnection(next: unknown) {
      connection = next
    },
    invoke,
  }
}

/** 固定返回某个拒绝码的假连接服务（`403` / `401` / `undefined` 三种语义）。 */
export function refusingConnection(verdict: 401 | 403 | undefined): { requestRejection: () => number | undefined } {
  return { requestRejection: () => verdict }
}
