/**
 * 自动团队右栏面板容器（`sidebar.right.pane.tab` + `.title`，DESIGN §1.1 E3）。
 *
 * r13 的三条硬规矩：
 *  1. **三个页签**：任务 / 历史 / 记忆（`TABS` 是唯一来源，DOM 里的 `data-tab` 数量就由它产生）。
 *     角色管理已迁到设置页，所以旧的角色/成员/计划三个页签文件与 DOM 一并删除 —— 不保留隐藏页签。
 *  2. **页头（`[data-panel-head]` 3 个直系子）与元信息（`[data-panel-meta]` 三段）不动**：
 *     这两块是 r7 定稿的几何，挤进去的一切状态都下沉到页签内容里（如 `RunHeader`）。
 *     进度与暂停按钮随任务页的 `RunHeader` 走，所以本文件不再有 `[data-panel-progress-row]`。
 *  3. **快照是唯一数据源**，library/历史详情是**按需**的（AC-23）：本文件只在用户点开历史行时
 *     才调 `openRun`，`refresh()` 永不触发 `/library`。
 *
 * 本文件只做「容器 + 页头 + 三个页签 + 确认弹窗」，可见文案尽量下沉到 `ui.ts` / `viewmodel.ts`。
 */
import * as React from 'react'
import { useAutoTeamStyle } from './styles.ts'
import { sessionIdOf, usePanelState } from './state.ts'
import { panelApi } from './api.ts'
import { capsuleOf, captainModelLabelOf } from './viewmodel.ts'
import type { ClientAction } from './viewmodel.ts'
import { OPEN_PANEL_EVENT, PANEL_CLOSE_EVENT } from './HeaderButton.tsx'
import { TasksTab } from './tabs/TasksTab.tsx'
import { HistoryTab } from './tabs/HistoryTab.tsx'
import { MemoryTab } from './tabs/MemoryTab.tsx'
import { AUTO_TEAM_OPEN_LIBRARY_EVENT, LibraryPage } from './LibraryPage.tsx'
import { consumeLibraryOpenRequest, visibleLibrarySurface } from './slots.ts'
import { ConfirmDialog } from './views/ConfirmDialog.tsx'
import { EmptyState } from './views/EmptyState.tsx'
import type {
  LibraryView,
  MemoryEntryView,
  MemoryFileView,
  MemoryTrack,
  PanelAction,
  PanelSnapshot,
  PendingConfirmationView,
  Result,
  RunDetailView,
} from '../shared/types.ts'

export interface PanelProps {
  sessionId?: string
  session?: unknown
  [key: string]: unknown
}

/** 记忆正文的一次读取结果（宿主侧已截断，客户端不再二次处理）。 */
export interface MemoryBody {
  track: MemoryTrack
  name: string
  body: string
  chars: number
  /** r23：宿主解析后的文件视图与条目视图（旧宿主缺省 → 面板退回整文件正文）。 */
  file?: MemoryFileView
  entries?: MemoryEntryView[]
}

export type ReadMemoryFn = (track: MemoryTrack, name: string, workspace?: string) => Promise<Result<MemoryBody>>

/**
 * 页签 props：右栏三页共用。
 *
 * `library` / `detail` 相关字段是**历史页与左栏共用**的按需数据（AC-23），tasks 页不看它们；
 * 这样三页拿到的都是同一份 store 快照，不会出现「历史页与左栏显示不同的项目列表」。
 */
export interface TabProps {
  sessionId: string
  snapshot: PanelSnapshot | undefined
  act: (action: ClientAction) => Promise<unknown>
  readMemory: ReadMemoryFn
  loadLibrary: (runId?: string) => Promise<void>
  openRun: (runId: string) => Promise<void>
  closeRun: () => void
  library: LibraryView | null
  libraryError: string | null
  detail: RunDetailView | null
  detailRunId: string | null
  /** 暂停态由面板统一派生（暂停影响所有页签，不能只在任务页可见）。 */
  paused: boolean
  pauseBusy: boolean
  onTogglePause: () => void
}

export type TabKey = 'tasks' | 'history' | 'memory'

/** 页签的唯一来源：AC-1 的 `data-tab` 计数直接由它产生（不在 JSX 里手写第二份）。 */
export const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'tasks', label: '任务' },
  { key: 'history', label: '历史' },
  { key: 'memory', label: '记忆' },
]

/** 计划状态 / 语义色 → 宿主 tone 名（只做映射，文案与音调由 viewmodel 单点给）。 */
const TONE_DATA: Record<string, string> = {
  ok: 'success',
  run: 'success',
  plan: 'success',
  done: 'success',
  warn: 'warn',
  bad: 'danger',
  fail: 'danger',
  muted: 'neutral',
  idle: 'neutral',
  neutral: 'neutral',
}

export function Panel(props: PanelProps): React.ReactElement {
  useAutoTeamStyle()
  const sessionId = sessionIdOf(props)
  const view = usePanelState(sessionId)
  const snapshot: PanelSnapshot | undefined = view.snapshot ?? undefined
  const [tab, setTab] = React.useState<TabKey>('tasks')
  const [pauseBusy, setPauseBusy] = React.useState(false)
  const [confirmBusy, setConfirmBusy] = React.useState(false)
  /** 宿主没提供主区入口（或 `main` 槽位对第三方插件不开放）时的降级：面板内联左栏。 */
  const [inlineLibrary, setInlineLibrary] = React.useState(false)

  const act = view.act as (action: ClientAction) => Promise<unknown>
  const error = view.error

  const readMemory = React.useCallback<ReadMemoryFn>(
    async (track, name, workspace) => {
      const api = panelApi
      if (typeof api.readMemory !== 'function') {
        return { error: '宿主未提供记忆读取接口' } as unknown as Result<MemoryBody>
      }
      const result = (await api.readMemory(sessionId, track, name, workspace)) as unknown as Result<MemoryBody>
      return result
    },
    [sessionId],
  )

  // 计划一就位就切回「任务」页：用户点开面板最想看的是任务流转。
  const planReady = snapshot?.planStatus !== undefined
  React.useEffect(() => {
    if (planReady) setTab('tasks')
  }, [planReady])

  // 会话头按钮点「开面板」但宿主没提供 openTab 时会派发这个事件；收到就切到任务页。
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    const onOpen = (): void => setTab('tasks')
    window.addEventListener(OPEN_PANEL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen)
  }, [])

  // 左栏 glyph 拿不到主区（或主区 500ms 内没挂载）时派发该事件：面板内联渲染项目库。
  // 单一 surface：主区已经可见就**不**再开镜像（AC-9）。
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    const onOpenLibrary = (): void => {
      if (visibleLibrarySurface() === 'main') {
        setInlineLibrary(false)
        return
      }
      setInlineLibrary(true)
    }
    window.addEventListener(AUTO_TEAM_OPEN_LIBRARY_EVENT, onOpenLibrary)
    return () => window.removeEventListener(AUTO_TEAM_OPEN_LIBRARY_EVENT, onOpenLibrary)
  }, [])

  // 刷新 / 重挂后补回内联：glyph 的请求落在 1.5s 内就直接沿用（否则打开面板页签后内联会丢）。
  React.useEffect(() => {
    const pending = consumeLibraryOpenRequest()
    const surface = visibleLibrarySurface()
    if (surface === 'main') {
      setInlineLibrary(false)
      return
    }
    if (pending || surface === 'panel') setInlineLibrary(true)
  }, [])

  // 头部按钮三级回退都关不掉时派发 PANEL_CLOSE_EVENT：这里给一句人能看懂的原因，
  // 而不是让按钮静默什么都不做（AC-11 的「非乐观」配套：状态没变就必须说明为什么）。
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    const onCloseRefused = (): void =>
      setCloseFailure('收起面板失败：宿主未提供关闭入口，请从页签上的 × 关闭')
    window.addEventListener(PANEL_CLOSE_EVENT, onCloseRefused)
    return () => window.removeEventListener(PANEL_CLOSE_EVENT, onCloseRefused)
  }, [])

  const capsule = capsuleOf(snapshot?.enabled === true, snapshot)
  const captain = captainModelLabelOf(snapshot?.captainModel)
  const degraded = snapshot?.degraded === true
  const degradeReason = (snapshot?.degradeReason ?? '').trim()

  const tasks = snapshot?.tasks ?? []
  const total = tasks.length
  const done = tasks.filter((task) => task.status === 'done').length
  const memberCount = snapshot?.members.length ?? 0
  const running = snapshot?.concurrency?.running ?? 0
  const limit = snapshot?.concurrency?.limit ?? 0
  const paused = snapshot?.paused === true
  // 头部按钮「关不掉」时经由窗口事件把原因送到这里 —— 这是它唯一能说话的地方
  // （工具栏上不许出现红字，AC-5；面板的 `[data-error]` 是全插件错误文案的归口）。
  const [closeFailure, setCloseFailure] = React.useState<string | undefined>(undefined)
  const shownError = typeof error === 'string' && error !== '' ? error : closeFailure

  async function togglePause(): Promise<void> {
    if (pauseBusy) return
    setPauseBusy(true)
    try {
      // 非乐观：不发本地翻转，只发动作；文案/几何等 snapshot.paused 回来再变。
      await act({ type: paused ? 'resumeTeam' : 'pause' } as ClientAction)
    } finally {
      setPauseBusy(false)
    }
  }

  /** 确认/取消待确认动作：**非乐观** —— 弹窗只在快照里 pending 消失后才关。 */
  async function resolvePending(action: 'confirmPending' | 'rejectPending', pendingId: string): Promise<void> {
    if (confirmBusy) return
    setConfirmBusy(true)
    try {
      await act({ type: action, pendingId } as PanelAction as ClientAction)
    } finally {
      setConfirmBusy(false)
    }
  }

  const pending: PendingConfirmationView | undefined =
    snapshot?.pendingConfirmation ?? view.detail?.pendingConfirmation

  const tabProps: TabProps = {
    sessionId,
    snapshot,
    act,
    readMemory,
    loadLibrary: view.loadLibrary,
    openRun: view.openRun,
    closeRun: view.closeRun,
    library: view.library,
    libraryError: view.libraryError,
    detail: view.detail,
    detailRunId: view.detailRunId,
    paused,
    pauseBusy,
    onTogglePause: () => void togglePause(),
  }

  return (
    <div
      data-auto-team-panel
      data-enabled={snapshot?.enabled === true ? 'true' : 'false'}
      data-paused={paused ? 'true' : 'false'}
    >
      {/* AC-9：`[data-panel-head]` 的直系子节点**恰好 3 个**（标题 / 状态胶囊 / 刷新）。
          挤进来的一切状态信息都下沉到下面的 `[data-panel-meta]` —— 混排会让 320px 宽度下
          标题被压成省略号、胶囊换行，这是 r7 面板头部被直接吐槽的根因。 */}
      <div data-panel-head>
        <strong data-panel-title>自动团队</strong>
        <span data-head-capsule data-tone={TONE_DATA[capsule.tone] ?? 'neutral'} title={capsule.title ?? capsule.text}>
          {capsule.text}
        </span>
        <button type="button" onClick={() => void view.refresh()} data-panel-refresh title="重新拉取快照">
          刷新
        </button>
      </div>

      {/* AC-10：三组信息各占独立槽位（`data-meta-plan` / `data-captain-model` /
          `data-auto-team-degraded`），组间只有装饰性分隔符（aria-hidden）。空计划时**不隐藏**，
          显示 `计划 0 · 成员 0 · 并发 0/0` —— 空态也是信息。 */}
      <div data-panel-meta>
        <span data-meta-plan data-meta="plan" title={`计划 ${total} · 成员 ${memberCount} · 并发 ${running}/${limit}`}>
          计划 {total} · 成员 {memberCount} · 并发 {running}/{limit}
        </span>
        <span data-meta-sep aria-hidden="true" />
        <span data-captain-model data-meta="captain-model" data-tone={captain.tone} title={captain.label}>
          {captain.label}
        </span>
        <span data-meta-sep aria-hidden="true" />
        <span
          data-auto-team-degraded={degraded ? 'true' : 'false'}
          data-meta="degraded"
          data-tone={degraded ? 'warn' : 'neutral'}
          title={degraded ? degradeReason : '四个宿主事件源都已订阅，Trigger 由事件即时推进'}
        >
          {degraded ? `事件源降级${degradeReason !== '' ? `：${degradeReason}` : ''}` : '事件源正常'}
        </span>
      </div>

      {paused ? (
        <div data-panel-paused-banner role="status">
          <span data-paused-icon aria-hidden="true">
            ⏸
          </span>
          <span data-paused-text>已暂停：派发与推进已停止，在跑成员不被打断</span>
          {typeof snapshot?.pausedAt === 'number' ? (
            <span data-paused-at>{formatClock(snapshot.pausedAt)}</span>
          ) : null}
        </div>
      ) : null}

      {inlineLibrary ? (
        <div data-panel-library-inline>
          <div data-panel-library-bar>
            <button type="button" data-library-inline-back onClick={() => setInlineLibrary(false)}>
              ← 返回面板
            </button>
            <span data-panel-library-hint role="status" aria-live="polite">
              <span data-panel-library-warn aria-hidden="true" />
              主区不可用，已在右栏打开
            </span>
          </div>
          <LibraryPage sessionId={sessionId} inline />
        </div>
      ) : (
        <>
          <div data-panel-tabs data-tab-bar role="tablist" aria-label="自动团队视图">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                id={`auto-team-tab-${item.key}`}
                aria-controls={`auto-team-tabpanel-${item.key}`}
                data-panel-tab={item.key}
                data-tab={item.key}
                data-active={tab === item.key ? 'true' : 'false'}
                aria-selected={tab === item.key}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {shownError === undefined ? null : (
            <div data-error role="alert">
              {shownError}
            </div>
          )}

          <div
            data-panel-body
            data-active-tab={tab}
            role="tabpanel"
            id={`auto-team-tabpanel-${tab}`}
            aria-labelledby={`auto-team-tab-${tab}`}
          >
            {tab === 'tasks' ? <TasksTab {...tabProps} /> : null}
            {tab === 'history' ? <HistoryTab {...tabProps} /> : null}
            {tab === 'memory' ? <MemoryTab {...tabProps} /> : null}
            {snapshot === undefined && view.loading ? (
              <EmptyState title="正在读取面板数据…" hint="宿主首次响应通常不到 1 秒" />
            ) : null}
          </div>
        </>
      )}

      {/* 确认闸（AC-13）：待确认动作在快照里时**必须**挡住界面；关闭只有两条路 ——
          宿主接受（pending 消失）或用户取消（rejectPending）。点击遮罩不关闭：不可逆动作不做手滑关闭。 */}
      {pending === undefined ? null : (
        <ConfirmDialog
          pending={pending}
          busy={confirmBusy}
          onConfirm={() => void resolvePending('confirmPending', pending.id)}
          onReject={() => void resolvePending('rejectPending', pending.id)}
        />
      )}
    </div>
  )
}

function formatClock(at: number): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export default Panel

/** 计划状态文案的唯一出处仍是 `viewmodel.planStatusView`；此处仅做类型再导出。 */
export type { PanelAction }
