/**
 * 面板状态：**模块级单例 store** + `useSyncExternalStore`。
 *
 * 为什么不再是「每个 hook 一份 useState + setInterval」（缺陷 D7 同族，TECHNICAL §7）：
 *  - 开关胶囊（工具条左侧）与面板（右栏页签）各自 hook 一次，
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
import type {
  ActResult,
  LibraryView,
  PanelAction,
  PanelSnapshot,
  Result,
  RunDetailView,
} from '../shared/types.ts'
import { LIBRARY_CACHE_MS, PANEL_ACTIVE_MS, PANEL_IDLE_MS } from '../shared/const.ts'
import { panelApi, type PanelApi } from './api.ts'

/** store 里存的那份数据（纯值，没有任何 React 依赖 → 可被 node --test 直接驱动）。 */
export interface PanelView {
  sessionId: string
  snapshot: PanelSnapshot | null
  /** 首次取数还没回来（组件据此显示骨架，而不是显示"关"）。 */
  loading: boolean
  error: string | null
  /**
   * 左栏项目库（r13 AC-23）。
   *
   * **只在左栏真的被打开时才有值**：`refresh()` 永不触发 library 请求，否则一次快照轮询会
   * 多扫一遍所有项目目录 + 记忆文件，把 2s 档的预算烧光（AC-23 的争用要求）。
   */
  library: LibraryView | null
  /** library 取数失败的原因；**保留上一次成功的 `library`**，不把已有内容清空成空态。 */
  libraryError: string | null
  /** 历史详情（由 `openRun` 从 `library.detail` 装配；不在 snapshot 轮询里）。 */
  detail: RunDetailView | null
  /** 当前详情对应的 runId（切换历史时用来判断"detail 是不是这次的"）。 */
  detailRunId: string | null
}

export interface PanelStore {
  getView(): PanelView
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  act(action: PanelAction): Promise<Result<ActResult>>
  /**
   * 按需加载项目库（r13 AC-23）。`runId` 非空 ⇒ 同时装配该 run 的历史详情。
   * `LIBRARY_CACHE_MS` 内同一 key 不重复打请求（页签来回切不烧接口）。
   */
  loadLibrary(runId?: string): Promise<void>
  /** 打开一条历史 run 的详情（内部走 `loadLibrary(runId)`，成功后写 `detail/detailRunId`）。 */
  openRun(runId: string): Promise<void>
  /** 关掉历史详情（回到历史列表，不动 library）。 */
  closeRun(): void
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

/** 结构相等（library / detail 用；引用相同直接短路，避免每次都 JSON 序列化）。 */
function equalValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
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
    library: null,
    libraryError: null,
    detail: null,
    detailRunId: null,
  }
  const now = options.now ?? Date.now
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<void> | null = null
  let disposed = false
  let watchingVisibility = false
  /** 最近一次成功拿到快照的时刻（用于"刚取过就别重复取"，React StrictMode 双挂载时不打双份请求）。 */
  let lastDataAt = Number.NEGATIVE_INFINITY
  /**
   * library 的缓存与单飞（r13 AC-23）。
   *
   * key = runId（空串表示"列表"）。**缓存必须是 store 内部的**：放在组件里就等于每个挂载面
   * 各缓存一份，右栏与左栏会各自打一份请求，还可能显示不同时刻的项目列表。
   */
  const libraryAt = new Map<string, number>()
  const libraryInflight = new Map<string, Promise<void>>()
  /** 已装配过的历史详情（runId → RunDetailView）：同一条历史反复点开不再请求。 */
  const detailCache = new Map<string, RunDetailView>()

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
      next.libraryError !== view.libraryError ||
      next.detailRunId !== view.detailRunId ||
      !sameSnapshot(next.snapshot, view.snapshot) ||
      !equalValue(next.library, view.library) ||
      !equalValue(next.detail, view.detail)
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
      // 动作会改项目库（暂停/取消/确认都会变计划状态），缓存立即作废 —— 但**不主动重取**：
      // 取数只在左栏真的可见时发生（AC-23），否则一次点击会顺带扫一遍所有项目目录。
      libraryAt.clear()
      detailCache.clear()
      // 刚拿到新数据，下一次轮询重新计时（避免"动作后立刻又打一次"）。
      schedule()
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!disposed) setView({ error: message, loading: false })
      return { error: message }
    }
  }

  /**
   * 按需加载项目库（r13 AC-23）。**只有左栏 / 历史详情会调它** —— snapshot 轮询永不触发，
   * 这是 AC-23「snapshot 期间零 library 装配」在客户端这边的保证。
   */
  function loadLibrary(runId?: string): Promise<void> {
    if (disposed) return Promise.resolve()
    const key = runId === undefined ? '' : runId
    const pending = libraryInflight.get(key)
    if (pending !== undefined) return pending
    const at = libraryAt.get(key)
    if (at !== undefined && now() - at < LIBRARY_CACHE_MS) return Promise.resolve()

    const sessionId = view.sessionId
    const request = api
      .library(sessionId, runId === undefined || runId === '' ? undefined : runId)
      .then((result) => {
        if (disposed) return
        if (result.error !== undefined) {
          // 失败保留上一次成功的 library（错误就地显示，不清空成空态）。
          setView({ libraryError: result.error })
          return
        }
        const lib = result.data ?? null
        libraryAt.set(key, now())
        if (key === '') {
          setView({ library: lib, libraryError: null })
          return
        }
        const detail = lib?.detail ?? null
        if (detail === null) {
          setView({
            library: lib ?? view.library,
            libraryError: `没有找到运行 ${key} 的历史详情（可能已被清理）`,
            detail: null,
            detailRunId: key,
          })
          return
        }
        detailCache.set(key, detail)
        setView({
          library: lib ?? view.library,
          libraryError: null,
          detail,
          detailRunId: key,
        })
      })
      .catch((error: unknown) => {
        if (disposed) return
        const message = error instanceof Error ? error.message : String(error)
        setView({ libraryError: `项目库不可达：${message}` })
      })
      .finally(() => {
        libraryInflight.delete(key)
      })
    libraryInflight.set(key, request)
    return request
  }

  /** 打开一条历史 run：先看 memory 缓存（5s 内同一 run 不重复打），未命中才走 loadLibrary。 */
  function openRun(runId: string): Promise<void> {
    if (disposed) return Promise.resolve()
    const cached = detailCache.get(runId)
    if (cached !== undefined) {
      setView({ detail: cached, detailRunId: runId, libraryError: null })
      return Promise.resolve()
    }
    // 先清 detail：切换历史时不能在半秒里显示上一条 run 的任务表（那是最容易被当成"串数据"的观感）。
    if (view.detailRunId !== runId) setView({ detail: null, detailRunId: runId })
    return loadLibrary(runId)
  }

  function closeRun(): void {
    if (disposed) return
    setView({ detail: null, detailRunId: null })
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
    loadLibrary,
    openRun,
    closeRun,
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
  loadLibrary: (runId?: string) => Promise<void>
  openRun: (runId: string) => Promise<void>
  closeRun: () => void
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
  return {
    ...view,
    refresh: store.refresh,
    act: store.act,
    loadLibrary: store.loadLibrary,
    openRun: store.openRun,
    closeRun: store.closeRun,
  }
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
