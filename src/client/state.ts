/**
 * 面板状态：**模块级单例 store** + `useSyncExternalStore`。
 *
 * 为什么不再是「每个 hook 一份 useState + setInterval」（缺陷 D7 同族，TECHNICAL §7）：
 *  - 开关行（`conversation.composer.dock`）与面板（`sidebar.right.pane.tab`）各自 hook 一次，
 *    就是**两份状态 + 两个 timer**：请求翻倍，且两处显示可能不一致（"开关是开的、面板说没开"）。
 *    单例 store 让两个挂载面读同一份数据 —— ARCHITECTURE 声称的"唯一数据源"才真的成立；
 *  - 单 timer 才能按活跃度调档：有运行中任务 2s（`PANEL_ACTIVE_MS`），空闲 5s（`PANEL_IDLE_MS`），
 *    页面隐藏时**暂停**（后台不烧请求）。AC-18 的刷新预算 1500(watcher) + 2000(前端) ≤ 5000 就靠这档；
 *  - `act()` 把返回的 `snapshot` **直接写回本地 view**，不额外 refresh 一次：少一次请求，且
 *    "点了没反应"这类问题无处可藏 —— 本地 view 必须立刻变化。
 *
 * 依赖纪律：client 半**不允许** import host 半的任何模块（AC-1 零直接 import），所以轮询间隔
 * 从 `shared/const.ts` 取，不是 `host/config.ts`（旧实现在这里违反了 D6）。
 */
import { useSyncExternalStore } from 'react'
import type { ActResult, PanelAction, PanelSnapshot, Result } from '../shared/types.ts'
import { PANEL_ACTIVE_MS, PANEL_IDLE_MS } from '../shared/const.ts'
import { panelApi, type PanelApi } from './api.ts'

/** store 里存的那份数据（纯值，没有任何 React 依赖 → 可被 node --test 直接驱动）。 */
export interface PanelView {
  sessionId: string
  snapshot: PanelSnapshot | null
  /** 首次取数还没回来（组件据此显示骨架，而不是显示"关"）。 */
  loading: boolean
  error: string | null
}

export interface PanelStore {
  getView(): PanelView
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  act(action: PanelAction): Promise<Result<ActResult>>
  /** 清 timer、注销 visibility 监听、从单例 Map 删除（最后一个订阅者解除时自动调用）。 */
  dispose(): void
}

export interface PanelStoreOptions {
  /** 空闲档间隔（默认 `PANEL_IDLE_MS` = 5000）。 */
  idleMs?: number
  /** 活跃档间隔（默认 `PANEL_ACTIVE_MS` = 2000）。AC-18 预算里就是它。 */
  activeMs?: number
  /** 时间源（测试注入固定时钟用；当前实现只用于比较，缺省 `Date.now`）。 */
  now?: () => number
  /** 绑定的会话 id（缺省 `'current'`，与 host 的默认会话一致）。 */
  sessionId?: string
  /** 内部：单例 Map 的注销钩子（`panelStoreFor` 用，外部不必传）。 */
  onDispose?: () => void
  /** 内部：单例 Map 的重新登记钩子（React StrictMode 双挂载时复活用）。 */
  onRevive?: () => void
}

/** 有任务/成员真的在跑？（决定 2s 还是 5s，以及 AC-18 的刷新预算） */
export function isActiveSnapshot(snapshot: PanelSnapshot | null): boolean {
  if (snapshot === null) return true // 首屏还没数据 → 用活跃档，尽快把第一张快照拿到
  const busyTask = snapshot.tasks.some((task) => task.status === 'running' || task.status === 'gate')
  const busyMember = snapshot.members.some((member) => member.status === 'running')
  return busyTask || busyMember
}

/** 结构相等（轮询拿到同一份数据时不触发重渲染；20 行不到的 JSON 比较比整面板重渲染便宜）。 */
function sameSnapshot(a: PanelSnapshot | null, b: PanelSnapshot | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function createPanelStore(api: PanelApi, options: PanelStoreOptions = {}): PanelStore {
  const idleMs = Math.max(200, options.idleMs ?? PANEL_IDLE_MS)
  const activeMs = Math.max(200, options.activeMs ?? PANEL_ACTIVE_MS)
  const listeners = new Set<() => void>()

  let view: PanelView = {
    sessionId: options.sessionId !== undefined && options.sessionId !== '' ? options.sessionId : 'current',
    snapshot: null,
    loading: true,
    error: null,
  }
  const now = options.now ?? Date.now
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<void> | null = null
  let disposed = false
  let watchingVisibility = false
  /** 最近一次成功拿到快照的时刻（用于"刚取过就别重复取"，React StrictMode 双挂载时不打双份请求）。 */
  let lastDataAt = Number.NEGATIVE_INFINITY

  function intervalFor(): number {
    return isActiveSnapshot(view.snapshot) ? activeMs : idleMs
  }

  /** 只在"有订阅者 + 未销毁 + 页面可见"时排下一次；三个条件任一不满足就自然暂停。 */
  function schedule(delay: number = intervalFor()): void {
    clearTimer()
    if (disposed || listeners.size === 0 || isHidden()) return
    timer = setTimeout(() => {
      timer = null
      void refresh()
    }, Math.max(1, delay))
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** 写入并在真的变化时通知订阅者（结构相等就跳过 → 轮询不制造无意义重渲染）。 */
  function setView(patch: Partial<PanelView>): void {
    const next: PanelView = { ...view, ...patch }
    const changed =
      next.sessionId !== view.sessionId ||
      next.loading !== view.loading ||
      next.error !== view.error ||
      !sameSnapshot(next.snapshot, view.snapshot)
    if (!changed) return
    view = next
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // 单个订阅者抛错不能拖垮轮询（否则整块面板一起僵死）
      }
    }
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (inflight !== null) return inflight
    const sessionId = view.sessionId
    inflight = api
      .snapshot(sessionId)
      .then((result) => {
        if (disposed) return
        // 单点解包（api.request 已解过）：这里只用 result.data / result.error 之一。
        if (result.error !== undefined) setView({ error: result.error, loading: false })
        else {
          lastDataAt = now()
          setView({ snapshot: result.data ?? null, error: null, loading: false })
        }
      })
      .catch((error: unknown) => {
        if (disposed) return
        setView({ error: error instanceof Error ? error.message : String(error), loading: false })
      })
      .finally(() => {
        inflight = null
        schedule()
      })
    return inflight
  }

  async function act(action: PanelAction): Promise<Result<ActResult>> {
    try {
      const result = await api.act(view.sessionId, action)
      if (disposed) return result
      if (result.error !== undefined) {
        setView({ error: result.error, loading: false })
        return result
      }
      const next = result.data
      if (next !== undefined && next !== null && next.snapshot !== undefined) {
        // 动作返回的快照直接落地：界面立刻反映结果，不等下一轮轮询。
        setView({ snapshot: next.snapshot, error: null, loading: false })
      } else {
        setView({ error: '面板动作返回了空快照（契约不一致）', loading: false })
      }
      // 刚拿到新数据，下一次轮询重新计时（避免"动作后立刻又打一次"）。
      schedule()
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!disposed) setView({ error: message, loading: false })
      return { error: message }
    }
  }

  /** 刚取过快照？（StrictMode 双挂载 / 面板页签来回切时不要重复打请求） */
  function freshEnough(): boolean {
    if (view.snapshot === null) return false
    return now() - lastDataAt < Math.min(activeMs, idleMs)
  }

  function onVisibilityChange(): void {
    if (disposed || listeners.size === 0) return
    if (isHidden()) {
      clearTimer() // 后台暂停：不烧请求
      return
    }
    void refresh() // 回到前台立刻取一次，而不是等下一档间隔
  }

  function watchVisibility(): void {
    if (watchingVisibility || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
    document.addEventListener('visibilitychange', onVisibilityChange)
    watchingVisibility = true
  }

  function unwatchVisibility(): void {
    if (!watchingVisibility || typeof document === 'undefined' || typeof document.removeEventListener !== 'function') return
    document.removeEventListener('visibilitychange', onVisibilityChange)
    watchingVisibility = false
  }

  function revive(): void {
    if (!disposed) return
    disposed = false
    options.onRevive?.()
    watchVisibility()
    if (freshEnough()) schedule()
    else void refresh()
  }

  function subscribe(listener: () => void): () => void {
    if (typeof listener !== 'function') return () => {}
    revive()
    const wasEmpty = listeners.size === 0
    listeners.add(listener)
    if (wasEmpty) {
      watchVisibility()
      if (isHidden()) {
        // 页面在后台：首屏也不打请求，等可见时 refresh（后台不烧请求）
      } else if (freshEnough()) {
        schedule() // 刚取过快照，等着就行
      } else {
        void refresh()
      }
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) dispose()
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    clearTimer()
    unwatchVisibility()
    listeners.clear()
    options.onDispose?.()
  }

  return {
    getView(): PanelView {
      return view
    },
    subscribe,
    refresh,
    act,
    dispose,
  }
}

/* ───────────────────────────── 会话级单例 Map ───────────────────────────── */

/** `sessionId → store`。两个挂载面必须命中同一个 store，否则等于两份状态。 */
const stores = new Map<string, PanelStore>()

/**
 * 取（或创建）某会话的 store。
 *
 * `overrideMs` 只在该会话的 store **首次创建**时生效（单例语义：后来者沿用已有档位）；
 * 这是给测试/调试用的兼容入口，正常调用只需要 sessionId。
 */
export function panelStoreFor(sessionId: string, overrideMs?: { activeMs?: number; idleMs?: number }): PanelStore {
  const key = sessionId.trim() === '' ? 'current' : sessionId
  const existing = stores.get(key)
  if (existing !== undefined) return existing
  const store = createPanelStore(panelApi, {
    sessionId: key,
    activeMs: overrideMs?.activeMs,
    idleMs: overrideMs?.idleMs,
    onDispose: () => {
      if (stores.get(key) === store) stores.delete(key)
    },
    onRevive: () => {
      stores.set(key, store)
    },
  })
  stores.set(key, store)
  return store
}

/* ───────────────────────────── React 绑定 ───────────────────────────── */

/** `usePanelState` 的返回：`PanelView` + 动作入口（组件只读它，不再自己 useState）。 */
export interface PanelState extends PanelView {
  refresh: () => Promise<void>
  act: (action: PanelAction) => Promise<Result<ActResult>>
}

/**
 * 订阅单例 store。
 *
 * 兼容旧签名（`usePanelState(sessionId, pollMs?)`）：旧的 `pollMs` 现在映射成"两档都取这个值"，
 * 只在建店时生效 —— 现有组件（Toggle / Panel）只传一个参数，不需要改 import 或调用点。
 */
export function usePanelState(sessionId: string, pollMs?: number): PanelState {
  const store = panelStoreFor(
    sessionId,
    pollMs === undefined ? undefined : { activeMs: pollMs, idleMs: pollMs },
  )
  // getView 返回的是缓存对象（只在变化时替换），所以 useSyncExternalStore 不会自激重渲染。
  const view = useSyncExternalStore(store.subscribe, store.getView, store.getView)
  return { ...view, refresh: store.refresh, act: store.act }
}

/** 从 slot props 取会话 id；宿主未提供时退回 'current'（与 host 的默认会话一致）。 */
export function sessionIdOf(props: unknown): string {
  const bag = (props ?? {}) as { sessionId?: unknown; session?: { id?: unknown } | undefined }
  const direct = bag.sessionId
  if (typeof direct === 'string' && direct !== '') return direct
  const session = bag.session
  if (typeof session?.id === 'string' && session.id !== '') return session.id
  return 'current'
}
