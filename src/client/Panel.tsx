/**
 * 自动团队右栏面板容器（`sidebar.right.pane.tab` + `.title`，DESIGN §1.1 E3）。
 *
 * 页头是这轮改造的门面，四条硬规矩：
 *  1. **`完成 x/N` + 计划状态 chip + 暂停/继续按钮** 一行（高度 40px，DESIGN §0.2）。
 *     数字全部由快照派生，组件里不存第二份计数。
 *  2. **暂停按钮非乐观更新**：点击只发 `act({type:'pause'|'resumeTeam'})` + 本地 busy，
 *     文案切换等宿主快照回来（`pauseButtonView` 的 label 只吃 `snapshot.paused`）。
 *     乐观改文案会让「点了没生效」看起来像生效，是本项目反复踩的坑。
 *  3. **暂停时不清门禁证据、不重排列表**（DESIGN §0.4）：任务行只由 PlanTab 按原顺序渲染。
 *  4. 页头几何在 320px 下限可读：`完成 999/999` 约 79px + badge + 按钮 ≈ 190px < 320px。
 *
 * 本文件只做「容器 + 页头 + 四个页签」，可见文案尽量下沉到 `ui.ts` / `viewmodel.ts`。
 */
import * as React from 'react'
import { useAutoTeamStyle } from './styles.ts'
import { sessionIdOf, usePanelState } from './state.ts'
import { panelApi } from './api.ts'
import { capsuleOf, captainModelLabelOf, planStatusView } from './viewmodel.ts'
import type { ClientAction } from './viewmodel.ts'
import { pauseButtonView } from './ui.ts'
import { OPEN_PANEL_EVENT, PANEL_CLOSE_EVENT } from './HeaderButton.tsx'
import { PlanTab } from './tabs/PlanTab.tsx'
import { MembersTab } from './tabs/MembersTab.tsx'
import { MemoryTab } from './tabs/MemoryTab.tsx'
import { RolesTab } from './tabs/RolesTab.tsx'
import type { MemoryTrack, PanelAction, PanelSnapshot, PlanStatus, Result } from '../shared/types.ts'

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
}

export type ReadMemoryFn = (track: MemoryTrack, name: string) => Promise<Result<MemoryBody>>

export interface TabProps {
  sessionId: string
  snapshot: PanelSnapshot | undefined
  act: (action: ClientAction) => Promise<unknown>
  readMemory: ReadMemoryFn
}

type TabKey = 'plan' | 'members' | 'memory' | 'roles'

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'plan', label: '计划' },
  { key: 'members', label: '成员' },
  { key: 'memory', label: '记忆' },
  { key: 'roles', label: '角色' },
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
  const [tab, setTab] = React.useState<TabKey>('plan')
  const [pauseBusy, setPauseBusy] = React.useState(false)

  const act = view.act as (action: ClientAction) => Promise<unknown>
  const error = view.error

  const readMemory = React.useCallback<ReadMemoryFn>(
    async (track, name) => {
      const api = panelApi
      if (typeof api.readMemory !== 'function') {
        return { error: '宿主未提供记忆读取接口' } as unknown as Result<MemoryBody>
      }
      const result = (await api.readMemory(sessionId, track, name)) as unknown as Result<MemoryBody>
      return result
    },
    [sessionId],
  )

  // 计划一就位就切到「计划」页：用户点开面板最想看的是任务流转，不是空着的上一页。
  const planReady = snapshot?.planStatus !== undefined
  React.useEffect(() => {
    if (planReady) setTab('plan')
  }, [planReady])

  // 会话头按钮点「开面板」但宿主没提供 openTab 时会派发这个事件；收到就切到计划页。
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    const onOpen = (): void => setTab('plan')
    window.addEventListener(OPEN_PANEL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen)
  }, [])

  // 头部按钮三级回退都关不掉时派发 PANEL_CLOSE_EVENT：这里给一句人能看懂的原因，
  // 而不是让按钮静默什么都不做（AC-11 的「非乐观」配套：状态没变就必须说明为什么）。
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    const onCloseRefused = (): void => setCloseFailure('收起面板失败：宿主未提供关闭入口，请从页签上的 × 关闭')
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
  const pauseView = pauseButtonView({ paused, busy: pauseBusy })
  // 头部按钮「关不掉」时经由窗口事件把原因送到这里 —— 这是它唯一能说话的地方
  // （工具栏上不许出现红字，AC-5；面板的 `[data-error]` 是全插件错误文案的归口）。
  const [closeFailure, setCloseFailure] = React.useState<string | undefined>(undefined)
  const shownError = typeof error === 'string' && error !== '' ? error : closeFailure
  // 计划状态一律走 viewmodel 的 5 态表（暂停时按 `paused` 归一，不在这里写第二套中文）
  const effectivePlanStatus: PlanStatus | undefined = paused ? 'paused' : snapshot?.planStatus
  const planStatus = effectivePlanStatus === undefined ? undefined : planStatusView(effectivePlanStatus)

  async function togglePause(): Promise<void> {
    if (pauseBusy) return
    setPauseBusy(true)
    try {
      // 非乐观：不发本地翻转，只发动作；文案/几何等 snapshot.paused 回来再变。
      await act({ type: pauseView.action } as ClientAction)
    } finally {
      setPauseBusy(false)
    }
  }

  return (
    <div data-auto-team-panel data-enabled={snapshot?.enabled === true ? 'true' : 'false'} data-paused={paused ? 'true' : 'false'}>
      {/* AC-9：`[data-panel-head]` 的直系子节点**恰好 3 个**（标题 / 状态胶囊 / 刷新）。
          挤进来的一切状态信息都下沉到下面的 `[data-panel-meta]` —— 混排会让 320px 宽度下
          标题被压成省略号、胶囊换行，这是 r7 面板头部被直接吐槽的根因。 */}
      <div data-panel-head>
        <strong data-panel-title>自动团队</strong>
        <span data-head-capsule data-tone={TONE_DATA[capsule.tone] ?? 'neutral'} title={capsule.text}>
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

      <div data-panel-progress-row>
        <span data-panel-progress data-done={done} data-total={total}>
          完成 {done}/{total}
        </span>
        {planStatus === undefined ? null : (
          <span data-panel-plan-status data-tone={planStatus.tone}>
            {planStatus.label}
          </span>
        )}
        <span data-panel-progress-spacer />
        <button
          type="button"
          data-auto-team-pause
          data-action={pauseView.action}
          data-tone={pauseView.tone}
          disabled={pauseView.disabled || snapshot === undefined}
          aria-busy={pauseBusy ? 'true' : 'false'}
          title={paused ? '从中断处继续推进（不重跑已完成任务）' : '暂停派发与推进（在跑成员不被打断）'}
          onClick={() => void togglePause()}
        >
          {pauseBusy ? <span data-pause-spinner aria-hidden="true" /> : null}
          <span data-pause-label>{pauseView.label}</span>
        </button>
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

      <div data-panel-tabs role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            data-panel-tab={item.key}
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

      <div data-panel-body data-active-tab={tab}>
        {tab === 'plan' ? (
          <PlanTab sessionId={sessionId} snapshot={snapshot} act={act} readMemory={readMemory} />
        ) : null}
        {tab === 'members' ? (
          <MembersTab sessionId={sessionId} snapshot={snapshot} act={act} readMemory={readMemory} />
        ) : null}
        {tab === 'memory' ? (
          <MemoryTab sessionId={sessionId} snapshot={snapshot} act={act} readMemory={readMemory} />
        ) : null}
        {tab === 'roles' ? (
          <RolesTab sessionId={sessionId} snapshot={snapshot} act={act} readMemory={readMemory} />
        ) : null}
      </div>
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

/** 计划状态文案的唯一出处仍是 `viewmodel.planStatusView`；此处仅做音调补强。 */
export type { PanelAction }
