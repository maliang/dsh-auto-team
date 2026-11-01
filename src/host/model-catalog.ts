/**
 * 模型清单的**同步读缓存**（r10 AC-16：角色模型改成弹层选择器）。
 *
 * 为什么需要它：`PanelSnapshot` 是同步 API（`GET /snapshot` 直接读内存），而宿主的
 * `llm.listProviders()/listModels()` 是异步的。把异步结果缓存在这里，快照侧只读 `view()`；
 * 读缓存的**时机**（TTL / 首次 / 过期）与「怎么读」（`read()` 注入）都留在本文件，
 * 于是 `node --test` 可以用假时钟与假 read 断言 TTL 与降级，不必起宿主。
 *
 * 三态语义（`ModelCatalogView.status`，面板据此显示不同文案）：
 *  - `loading`：还没有任何结果 —— 只出现在第一次调用（同时触发后台刷新，不阻塞）；
 *  - `ready`：拿到 ≥1 个模型；
 *  - `empty`：读完了但一个模型都没有（宿主没 llm 服务 / 没配 provider / 全部读取失败），
 *    **必须带 `reason`**：静默空列表会让用户以为「这个功能坏了」。
 *
 * 本模块是纯逻辑（不 import 宿主、不读盘、不读 snap），符合 AGENTS §4 对纯模块的要求。
 */
import type { ModelCatalogView, ModelOption } from '../shared/types.ts'
import { MODEL_CATALOG_MAX, MODEL_CATALOG_TTL_MS } from './config.ts'

/** 一个 provider 及其可选模型（`readModelCatalog` 的归一化产物，宿主原始形状不越界）。 */
export interface ModelCatalogGroup {
  id: string
  name: string
  models: { id: string; name: string }[]
}

/** 某个 provider 的模型没读出来（不整体失败：能读到几个就显示几个）。 */
export interface ModelCatalogFailure {
  id: string
  name: string
  message: string
}

/** 后台读取的一次结果：分组 + 逐 provider 失败 + 整批失败原因。 */
export interface ModelCatalogRaw {
  groups: ModelCatalogGroup[]
  failures: ModelCatalogFailure[]
  reason?: string
}

export interface ModelCatalogCacheDeps {
  /** 真的去问宿主（`readModelCatalog(ctx)`）；**本函数不捕它之外的东西**，抛错也安全。 */
  read: () => Promise<ModelCatalogRaw>
  now: () => number
  ttlMs: number
  /** 条目上限，缺省 `MODEL_CATALOG_MAX`（测试可注入小值以断言截断）。 */
  limit?: number
}

export interface ModelCatalogCache {
  /** 同步读投影：永不抛错，永不返回 undefined。 */
  view(): ModelCatalogView
  /** 主动刷新（`force=true` 忽略 TTL 与在飞请求之外的一切）；并发调用共享同一次读取。 */
  refresh(force?: boolean): Promise<void>
}

/**
 * 把一次原始读取结果压成面板要的 `ModelCatalogView`。
 *
 * 截断与 `reason` 的组合规则：**只要不是「全部读全了」，就必须给一句可读说明** ——
 * 否则「只剩 120 条」与「本来就只有 120 条」在界面上无法区分。
 */
export function toCatalogView(raw: ModelCatalogRaw, limit: number = MODEL_CATALOG_MAX): ModelCatalogView {
  const options: ModelOption[] = []
  for (const group of raw.groups) {
    for (const model of group.models) {
      options.push({
        provider: group.id,
        providerName: group.name,
        model: model.id,
        modelName: model.name,
      })
      if (options.length >= limit) break
    }
    if (options.length >= limit) break
  }
  const total = raw.groups.reduce((sum, group) => sum + group.models.length, 0)
  const notes: string[] = []
  if (raw.reason !== undefined && raw.reason !== '') notes.push(raw.reason)
  if (raw.failures.length > 0) {
    const names = raw.failures.map((failure) => `${failure.name}（${failure.message}）`).join('、')
    notes.push(`部分来源读取失败：${names}`)
  }
  if (total > options.length) notes.push(`仅显示前 ${options.length} 个模型（共 ${total} 个）`)
  if (options.length === 0) {
    return { status: 'empty', options, reason: notes.join('；') || '宿主未提供任何可选模型' }
  }
  return notes.length > 0 ? { status: 'ready', options, reason: notes.join('；') } : { status: 'ready', options }
}

export function createModelCatalogCache(deps: ModelCatalogCacheDeps): ModelCatalogCache {
  const limit = deps.limit ?? MODEL_CATALOG_MAX
  const ttlMs = deps.ttlMs
  let cached: { at: number; view: ModelCatalogView } | undefined
  /** 在飞的读取（并发 view()/refresh() 必须共用同一次宿主调用，否则轮询会打爆宿主）。 */
  let inFlight: Promise<void> | undefined

  const stale = (at: number): boolean => deps.now() - at >= ttlMs

  function refresh(force = false): Promise<void> {
    if (inFlight !== undefined) return inFlight
    if (!force && cached !== undefined && !stale(cached.at)) return Promise.resolve()
    inFlight = (async () => {
      try {
        const raw = await deps.read()
        cached = { at: deps.now(), view: toCatalogView(raw, limit) }
      } catch (error) {
        // 读取抛错 → 空目录 + 原因（绝不留上一轮的成功结果冒充「当前可用」）
        const message = error instanceof Error ? error.message : String(error)
        cached = { at: deps.now(), view: { status: 'empty', options: [], reason: `宿主模型清单读取失败：${message}` } }
      } finally {
        inFlight = undefined
      }
    })()
    return inFlight
  }

  function view(): ModelCatalogView {
    if (cached === undefined) {
      // 第一次：立刻给 loading（面板显示「正在读取模型…」），同时后台开跑
      void refresh(true)
      return { status: 'loading', options: [] }
    }
    if (stale(cached.at)) void refresh(true) // stale-while-revalidate：先给旧值，再后台换新
    return cached.view
  }

  return { view, refresh }
}
