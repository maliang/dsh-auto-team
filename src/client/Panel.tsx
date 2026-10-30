/**
 * 右栏「自动团队」面板外壳（sidebar.right.pane.tab）。
 *
 * 四页：计划 / 成员 / 记忆 / 角色（DESIGN §2）。本组件只做三件事：
 *   1. 取数（usePanelState，与开关行共享同一个 store → 单一数据源）；
 *   2. 把动作收窄成 tab 能用的形状（**全项目唯一的 as PanelAction 在 here**）；
 *   3. 切页与空态。
 *
 * AC-30 的入口就在这里：计划生成后胶囊变琥珀「计划就绪 · N 任务」，此时成员数必须仍为 0
 * —— 成员只在用户点「开始派发」后才创建。
 */
import * as React from 'react'
import { useAutoTeamStyle } from './styles.ts'
import { sessionIdOf, usePanelState } from './state.ts'
import { panelApi } from './api.ts'
import { capsuleOf, viewExtras } from './viewmodel.ts'
import type { ClientAction } from './viewmodel.ts'
import { OPEN_PANEL_EVENT } from './Toggle.tsx'
import { PlanTab } from './tabs/PlanTab.tsx'
import { MembersTab } from './tabs/MembersTab.tsx'
import { MemoryTab } from './tabs/MemoryTab.tsx'
import { RolesTab } from './tabs/RolesTab.tsx'
import type { MemoryTrack, PanelAction, PanelSnapshot, Result } from '../shared/types.ts'

export interface PanelProps {
  sessionId?: string
  session?: { id?: string }
  [key: string]: unknown
}

type TabKey = 'plan' | 'members' | 'memory' | 'roles'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'plan', label: '计划' },
  { key: 'members', label: '成员' },
  { key: 'memory', label: '记忆' },
  { key: 'roles', label: '角色' },
]

/** 记忆正文（GET /memory 的 data，见 TECHNICAL §4.1）。 */
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
  /** 动作结果原样交给 viewmodel.feedbackOf 解包（组件里不许再解一次）。 */
  act: (action: ClientAction) => Promise<unknown>
  /** 点记忆条目时先读正文再进编辑器（D7：不读就写会把已有记忆清空）。 */
  readMemory: ReadMemoryFn
}

export function Panel(props: PanelProps): React.ReactElement {
  useAutoTeamStyle()
  const sessionId = sessionIdOf(props as Record<string, unknown>)
  const view = usePanelState(sessionId)
  const snapshot = view.snapshot ?? undefined
  const [tab, setTab] = React.useState<TabKey>('plan')

  const rawAct = view.act
  const act = React.useCallback(
    (action: ClientAction): Promise<unknown> => rawAct(action as PanelAction) as Promise<unknown>,
    [rawAct],
  )

  const readMemory = React.useCallback(
    async (track: MemoryTrack, name: string): Promise<Result<MemoryBody>> => {
      const api = panelApi as unknown as {
        readMemory?: (id: string, track2: MemoryTrack, name2: string) => Promise<Result<MemoryBody>>
      }
      if (typeof api.readMemory !== 'function') {
        return { error: '宿主未提供记忆正文读取接口（插件与宿主版本不一致），为免清空已有记忆，已拒绝打开编辑器' }
      }
      return api.readMemory.call(panelApi, sessionId, track, name)
    },
    [sessionId],
  )

  const tasks = snapshot?.tasks ?? []
  const members = snapshot?.members ?? []
  const extras = viewExtras(snapshot)
  const capsule = capsuleOf(snapshot?.enabled === true, snapshot)

  // AC-30：计划一出现（还没有任何成员）就停在「计划」页，用户要立刻看见计划与「开始派发」
  const planReady = tasks.length > 0 && members.length === 0
  React.useEffect(() => {
    if (planReady) setTab('plan')
  }, [planReady, snapshot?.runId])

  // 开关行的「面板」按钮：面板已在时可切页（页面没挂载时该事件无人接收，属正常）
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (): void => setTab('plan')
    window.addEventListener(OPEN_PANEL_EVENT, handler)
    return () => window.removeEventListener(OPEN_PANEL_EVENT, handler)
  }, [])

  const error = view.error ?? undefined

  return (
    <div data-dsh-auto-team-panel data-enabled={snapshot?.enabled === true ? 'true' : 'false'}>
      <div data-panel-head>
        <strong>自动团队</strong>
        <span data-head-capsule data-tone={capsule.tone}>
          {capsule.text}
        </span>
        <span data-head-meta>
          计划 {tasks.length} · 成员 {members.length} · 并发 {extras.concurrency.running}/
          {extras.concurrency.limit}
        </span>
        <button type="button" onClick={() => void view.refresh()} data-panel-refresh>
          刷新
        </button>
      </div>

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

      {error !== undefined ? (
        <div data-error role="alert">
          {error}
        </div>
      ) : null}

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

export default Panel
