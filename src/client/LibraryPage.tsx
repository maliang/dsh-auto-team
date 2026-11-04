/**
 * 左栏「自动团队」栏目 + 项目库（r13 AC-23/24/25，r14 AC-13/15/16/17 改造）。
 *
 * 结构（DESIGN §3）：`[data-library-shell]` → `[data-library-head]`（44px）+
 * `[data-library-body]`（分栏容器，持 `--lib-list-w` 变量）：
 *  - `[data-region="project-list"]`：首行「全局」、已知项目桶、固定末位的
 *    `[data-bucket="history"]` 历史桶（未记录工作区的旧 run），列宽 160–360 可拖；
 *  - `[data-split-handle]`：6px 分隔条，双击复位、键盘 ±8px（仅容器 ≥560px 可见）；
 *  - `[data-region="project-detail"]`：项目头 + run 列表（`[data-run-row]`）+ 项目记忆；
 *    点 run 行在页面右侧打开 `RunDrawer`（**不卸载背景列表**，否则 scrollTop/焦点必丢）。
 *
 * 三条硬约束：
 *  1. **AC-23**：`loadLibrary()` 只在本组件挂载时调用一次（页面打开才装配），不参与快照轮询；
 *  2. **AC-17**：抽屉内容与右栏同一套组件、同一个 `buildRunDetail`，绝不内联第二份任务表；
 *  3. **AC-16**：打开抽屉前记住 `project-detail` 的 scrollTop 与 `document.activeElement`，
 *     关闭动画结束、状态归零后用 rAF 复原——所以抽屉的 `openRunId` 是单值，DOM 内最多一个。
 *
 * 数字/时长文案一律来自宿主下发的 cell（`tokenTextOf` / `durationTextOf`），本页不二次格式化。
 */
import * as React from 'react'
import type { LibraryView, MemoryItemView, MemoryTrack, ProjectView } from '../shared/types.ts'
import { panelApi } from './api.ts'
import { OPEN_LIBRARY_EVENT, visibleLibrarySurface } from './slots.ts'
import type { LibraryOpenResult } from './slots.ts'
import { sessionIdOf, usePanelState } from './state.ts'
import {
  LIB_LIST_DEFAULT,
  LIB_LIST_MAX,
  LIB_LIST_MIN,
  buildRunDetail,
  clampListWidth,
  formatStamp,
  goalTitleOf,
  nextListWidth,
  tokenTextOf,
  tokenTitleOf,
} from './viewmodel.ts'
import { EmptyState } from './views/EmptyState.tsx'
import { FlowCanvas } from './views/FlowCanvas.tsx'
import { MemoryList } from './views/MemoryList.tsx'
import { RoleGrid } from './views/RoleCard.tsx'
import { RunDrawer } from './views/RunDrawer.tsx'
import { RunHeader } from './views/RunHeader.tsx'
import { RunRow } from './views/RunRow.tsx'
import { TaskOverview } from './views/TaskOverview.tsx'
import { projectNavOf, projectRunRowOf, scrollToTaskRow, useExpandedTask } from './tabs/rows.ts'

/**
 * 「打开左栏项目库」的窗口事件名（**单向别名**：真实字面量只写在 `slots.ts`）。
 *
 * 放在 slots.ts 的理由：`slots.ts` 不 import 任何 `.tsx`，组件与测试都能引它，
 * 又不会形成 `slots ↔ LibraryPage` 的运行时环；字面量只此一处，避免两处漂移。
 */
export const AUTO_TEAM_OPEN_LIBRARY_EVENT = OPEN_LIBRARY_EVENT

export interface LibraryPageProps {
  sessionId?: string
  session?: unknown
  inline?: boolean
  [key: string]: unknown
}

interface OpenMemory {
  track: MemoryTrack
  name: string
  workspace?: string
}

/** 分栏容器内联变量：只写 CSS 变量，不写 flex-basis（内联 basis 会盖掉容器查询的降级规则）。 */
type SplitStyle = React.CSSProperties & { '--lib-list-w'?: string }

/** 指针拖动的最小状态（放 ref：pointermove 不触发 React 渲染）。 */
interface SplitDrag {
  pointerId: number
  startX: number
  startWidth: number
}

/** 左栏与面板内联两处共用的内容体（只差外面那层 root 钩子）。 */
function LibraryContent(props: LibraryPageProps & { root: 'library' | 'panellist' }): React.ReactElement {
  const sessionId = sessionIdOf(props)
  const view = usePanelState(sessionId)
  const loadLibrary = view.loadLibrary
  const library: LibraryView | null = view.library
  const libraryError = view.libraryError

  // AC-23：只有本页挂载才装配项目库；refresh（快照轮询）永不带它。
  React.useEffect(() => {
    void loadLibrary()
  }, [sessionId, loadLibrary])

  const [picked, setPicked] = React.useState<string>('')
  const [openMemory, setOpenMemory] = React.useState<OpenMemory | undefined>(undefined)
  const [memoryBody, setMemoryBody] = React.useState<string | undefined>(undefined)
  const [memoryError, setMemoryError] = React.useState<string | undefined>(undefined)
  const [memoryLoading, setMemoryLoading] = React.useState(false)
  const [expanded, toggleTask, expandTask] = useExpandedTask('library')

  // r14 AC-13：分栏宽度；handle 拖动只改这个 state 与 CSS 变量。
  const [listWidth, setListWidth] = React.useState<number>(LIB_LIST_DEFAULT)
  const [dragging, setDragging] = React.useState(false)
  const dragRef = React.useRef<SplitDrag | null>(null)

  // r14 AC-16：抽屉的单值状态 + 打开前捕获的滚动位置/焦点。
  const [openRunId, setOpenRunId] = React.useState<string | null>(null)
  const detailRef = React.useRef<HTMLDivElement | null>(null)
  const pendingFocusRef = React.useRef<HTMLElement | null>(null)
  const pendingScrollRef = React.useRef<number>(0)

  const readMemory = React.useCallback(
    (track: MemoryTrack, name: string, workspace?: string) => panelApi.readMemory(sessionId, track, name, workspace),
    [sessionId],
  )

  /** 「全局」固定在最上；已知项目按宿主给的最近活跃顺序；历史桶固定末位（PRD §11 默认值）。 */
  const projects = React.useMemo<ProjectView[]>(() => {
    const list = library?.projects ?? []
    const known = list.filter((project) => project.unknown !== true)
    const unknown = list.filter((project) => project.unknown === true)
    return [...known, ...unknown]
  }, [library])
  const knownProjects = React.useMemo(() => projects.filter((project) => project.unknown !== true), [projects])
  const historyProjects = React.useMemo(() => projects.filter((project) => project.unknown === true), [projects])

  const selectedId = picked !== '' ? picked : (library?.currentProject ?? 'global')
  const selectedProject = projects.find((project) => project.id === selectedId)
  const globalItems = library?.global.memories ?? []
  const projectItems = selectedProject?.memories ?? []

  const openSummary =
    openRunId !== null && selectedProject !== undefined
      ? selectedProject.recentRuns.find((run) => run.runId === openRunId)
      : undefined
  const openGoal = openSummary !== undefined ? goalTitleOf(openSummary.goal, openSummary.runId) : undefined
  const drawerSubtitle =
    openSummary !== undefined
      ? [
          openSummary.runId.slice(-6),
          openSummary.planStatus,
          tokenTextOf(openSummary.usage),
          openSummary.duration.text,
        ].join(' · ')
      : (openRunId ?? '')

  // AC-17：抽屉详情与右栏同一个装配函数（三源优先级由 viewmodel 保证，runId 不匹配就返回 null）。
  const detailView = React.useMemo(
    () =>
      openRunId === null
        ? null
        : buildRunDetail(
            {
              snapshot: view.snapshot,
              library,
              runDetail: view.detail ?? undefined,
            },
            openRunId,
          ),
    [openRunId, view.snapshot, view.detail, library],
  )
  const detailTaskIds = React.useMemo(
    () => (detailView === null ? [] : detailView.tasks.map((task) => task.id)),
    [detailView],
  )

  async function openMemoryItem(track: MemoryTrack, item: MemoryItemView, workspace?: string): Promise<void> {
    if (openMemory !== undefined && openMemory.name === item.name && openMemory.track === track) {
      setOpenMemory(undefined)
      setMemoryBody(undefined)
      setMemoryError(undefined)
      return
    }
    setOpenMemory({ track, name: item.name, workspace })
    setMemoryBody(undefined)
    setMemoryError(undefined)
    setMemoryLoading(true)
    try {
      const result = await readMemory(track, item.name, workspace)
      if (result.error !== undefined) setMemoryError(result.error)
      else setMemoryBody(result.data?.body ?? '')
    } finally {
      setMemoryLoading(false)
    }
  }

  /** 切项目：关掉抽屉、清掉记忆展开态（记忆正文属于上一个项目，不能串台）。 */
  function pickProject(id: string): void {
    if (openRunId !== null) closeDrawer()
    setPicked(id)
    setOpenMemory(undefined)
    setMemoryBody(undefined)
    setMemoryError(undefined)
  }

  /* ───────────── 分栏拖拽：pointer capture + 键盘 + 双击复位（AC-13） ───────────── */

  // 拖拽期间锁 body 光标与选择（否则快速横拖会选中列表文字）；卸载/结束后还原。
  React.useEffect(() => {
    if (!dragging) return undefined
    const body = document.body
    const previousCursor = body.style.cursor
    const previousSelect = body.style.userSelect
    body.style.cursor = 'col-resize'
    body.style.userSelect = 'none'
    return () => {
      body.style.cursor = previousCursor
      body.style.userSelect = previousSelect
    }
  }, [dragging])

  function onHandlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: listWidth }
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // 某些合成事件没有活跃指针；退回普通 pointermove（不阻断拖动）。
    }
    handle.focus()
    setDragging(true)
  }

  function onHandlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    setListWidth(nextListWidth(drag.startWidth, event.clientX - drag.startX))
  }

  function endHandleDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragRef.current === null) return
    dragRef.current = null
    setDragging(false)
    const handle = event.currentTarget
    try {
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
    } catch {
      // capture 已随指针结束释放；这里只是收尾。
    }
  }

  function onHandleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    let next: number | undefined
    if (event.key === 'ArrowLeft') next = nextListWidth(listWidth, -8)
    else if (event.key === 'ArrowRight') next = nextListWidth(listWidth, 8)
    else if (event.key === 'Home') next = LIB_LIST_MIN
    else if (event.key === 'End') next = LIB_LIST_MAX
    if (next === undefined) return
    event.preventDefault()
    setListWidth(next)
  }

  function resetListWidth(): void {
    setListWidth(clampListWidth(LIB_LIST_DEFAULT))
  }

  /* ───────────── 抽屉：打开/关闭与 scrollTop、焦点复原（AC-16） ───────────── */

  function openDrawer(runId: string): void {
    const pane = detailRef.current
    pendingScrollRef.current = pane === null ? 0 : pane.scrollTop
    const active = typeof document === 'undefined' ? null : document.activeElement
    pendingFocusRef.current = active instanceof HTMLElement ? active : null
    setOpenRunId(runId)
    void view.openRun(runId)
  }

  function closeDrawer(): void {
    setOpenRunId(null)
    view.closeRun()
    const focus = pendingFocusRef.current
    pendingFocusRef.current = null
    const scrollTop = pendingScrollRef.current
    const restore = (): void => {
      const pane = detailRef.current
      // 背景列表在整个过程中没有卸载（只有抽屉是条件渲染），所以这两个复原是可靠的。
      if (pane !== null) pane.scrollTop = scrollTop
      if (focus !== null && focus.isConnected) focus.focus()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore)
    else restore()
  }

  function selectDrawerTask(taskId: string): void {
    expandTask(taskId)
    const ids = detailTaskIds
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => scrollToTaskRow(taskId, ids))
    } else {
      scrollToTaskRow(taskId, ids)
    }
  }

  const splitStyle: SplitStyle = { '--lib-list-w': `${listWidth}px` }

  return (
    <div data-library-shell data-library-page={props.root}>
      <div data-library-head>
        <strong data-library-title>自动团队</strong>
        <span data-library-sub data-project-count={projects.length}>
          {library === null ? '读取中…' : `${projects.length} 个项目`}
        </span>
        <button
          type="button"
          data-library-refresh
          disabled={view.loading && library === null}
          onClick={() => void loadLibrary()}
        >
          刷新
        </button>
      </div>

      {/* r14 AC-13：PRD 指定的分栏锚点必须真的渲染出来（QA D1：此前只写在 styles.ts 的死选择器里） */}
      <div data-library-body data-project-split style={splitStyle}>
        <div data-region="project-list" aria-label="项目">
          <button
            type="button"
            data-auto-team-nav
            data-nav-kind="global"
            data-active={selectedId === 'global' ? 'true' : 'false'}
            onClick={() => pickProject('global')}
          >
            <span data-nav-name>全局</span>
            <span data-nav-meta>{globalItems.length} 条公共记忆</span>
          </button>

          {knownProjects.length > 0 ? (
            <div data-bucket="projects">
              <div data-bucket-head>
                <span>项目</span>
                <span data-bucket-count>{knownProjects.length}</span>
              </div>
              <ul data-bucket-list>
                {knownProjects.map((project) => {
                  const nav = projectNavOf(project, project.id === selectedId)
                  return (
                    <li key={project.id}>
                      <button
                        type="button"
                        data-auto-team-nav
                        data-nav-kind="project"
                        data-project-id={nav.id}
                        data-active={nav.active ? 'true' : 'false'}
                        title={nav.path ?? nav.name}
                        onClick={() => pickProject(nav.id)}
                      >
                        <span data-nav-name>{nav.name}</span>
                        <span data-nav-meta>{nav.metaText}</span>
                        <span data-nav-token data-usage-source={project.usage.source} title={nav.tokenTitle}>
                          {nav.tokenText}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          {historyProjects.length > 0 ? (
            <div data-bucket="history">
              <div data-bucket-head title="旧版本 run 未记录工作区，无法自动归类">
                <span>历史运行</span>
                <span data-bucket-count>{historyProjects.length}</span>
              </div>
              <ul data-bucket-list>
                {historyProjects.map((project) => {
                  const nav = projectNavOf(project, project.id === selectedId)
                  return (
                    <li key={project.id}>
                      <button
                        type="button"
                        data-auto-team-nav
                        data-nav-kind="history"
                        data-project-id={nav.id}
                        data-active={nav.active ? 'true' : 'false'}
                        title={nav.path ?? nav.name}
                        onClick={() => pickProject(nav.id)}
                      >
                        <span data-nav-name>{nav.name}</span>
                        <span data-nav-meta>{nav.metaText}</span>
                        <span data-nav-token data-usage-source={project.usage.source} title={nav.tokenTitle}>
                          {nav.tokenText}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整项目列表宽度"
          aria-valuemin={LIB_LIST_MIN}
          aria-valuemax={LIB_LIST_MAX}
          aria-valuenow={listWidth}
          tabIndex={0}
          data-split-handle
          data-dragging={dragging ? 'true' : 'false'}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={endHandleDrag}
          onPointerCancel={endHandleDrag}
          onDoubleClick={resetListWidth}
          onKeyDown={onHandleKeyDown}
        />

        <div data-region="project-detail" ref={detailRef}>
          {library === null && libraryError === null ? (
            <EmptyState title="正在读取项目库…" hint="宿主会扫描运行目录与两轨记忆" />
          ) : library === null ? (
            <EmptyState title="读不到项目库" hint={libraryError ?? '未知原因'} next="点右上角「刷新」重试" />
          ) : selectedProject === undefined ? (
            <GlobalPane
              memories={globalItems}
              expanded={openMemory?.track === 'public' ? openMemory.name : undefined}
              body={memoryLoading ? undefined : memoryBody}
              error={memoryError}
              onOpen={(item) => void openMemoryItem('public', item)}
            />
          ) : (
            <ProjectPane
              project={selectedProject}
              openRunId={openRunId}
              onOpenRun={openDrawer}
              memories={projectItems}
              expandedMemory={openMemory?.track === 'project' ? openMemory.name : undefined}
              memoryBody={memoryLoading ? undefined : memoryBody}
              memoryError={memoryError}
              onOpenMemory={(item) => void openMemoryItem('project', item, selectedProject.path)}
            />
          )}

          {libraryError !== null && library !== null ? (
            <p data-error data-error-scope="library" role="alert">
              {libraryError}
            </p>
          ) : null}

          <p
            data-library-foot
            data-library-project-meta
            style={{ margin: '12px 0 0', color: 'var(--dsw-alias-label-tertiary, inherit)' }}
          >
            宿主未暴露左栏宽度接口，外框宽度固定
          </p>
        </div>
      </div>

      <RunDrawer
        open={openRunId !== null}
        runId={openRunId ?? undefined}
        title={openGoal !== undefined ? openGoal.text : '运行详情'}
        subtitle={drawerSubtitle}
        onClose={closeDrawer}
      >
        {detailView === null ? (
          <EmptyState
            title="正在读取运行详情…"
            hint="宿主会从运行记录里装配任务、角色与流转"
            next={openRunId !== null ? `runId：${openRunId}` : undefined}
          />
        ) : (
          <>
            <RunHeader detail={detailView} inflight="idle" />
            <RoleGrid roles={detailView.roles} />
            <TaskOverview tasks={detailView.tasks} expandedTaskId={expanded} onToggleTask={toggleTask} />
            <FlowCanvas flow={detailView.flow} onSelectTask={selectDrawerTask} />
          </>
        )}
      </RunDrawer>
    </div>
  )
}

/** 全局（公共）记忆面板：跨项目共用，所以只列条目与正文，不挂任何项目字段。 */
function GlobalPane(props: {
  memories: MemoryItemView[]
  expanded?: string
  body?: string
  error?: string
  onOpen: (item: MemoryItemView) => void
}): React.ReactElement {
  return (
    <>
      <div data-library-project-head>
        <span data-library-project-name>全局</span>
        <span data-library-project-meta>跨项目的公共记忆（所有项目共享）</span>
      </div>
      {props.memories.length === 0 ? (
        <EmptyState title="还没有公共记忆" hint="团队级的约定可以写在公共轨，所有项目都会带上" />
      ) : (
        <MemoryList
          items={props.memories}
          track="public"
          expanded={props.expanded}
          body={props.body}
          bodyError={props.error}
          onOpen={props.onOpen}
        />
      )}
    </>
  )
}

/** 单项目面板：项目头（含历史桶说明）+ run 行列表 + 项目记忆。 */
function ProjectPane(props: {
  project: ProjectView
  openRunId: string | null
  onOpenRun: (runId: string) => void
  memories: MemoryItemView[]
  expandedMemory?: string
  memoryBody?: string
  memoryError?: string
  onOpenMemory: (item: MemoryItemView) => void
}): React.ReactElement {
  const { project } = props
  const history = project.unknown === true
  return (
    <>
      <div data-library-project-head>
        <span data-library-project-name>{project.name}</span>
        <span data-library-project-meta data-runs={project.runs}>
          {project.runs} 次运行
          {project.lastActiveAt !== undefined ? ` · 最近 ${formatStamp(project.lastActiveAt)}` : ''}
        </span>
        <span data-library-project-usage data-usage-source={project.usage.source} title={tokenTitleOf(project.usage)}>
          {tokenTextOf(project.usage)}
        </span>
        {project.path !== undefined ? (
          <code data-library-project-path title={project.path}>
            {project.path}
          </code>
        ) : null}
        {history ? (
          <span data-bucket-note data-library-project-meta>
            旧版本 run 未记录工作区，无法自动归类
          </span>
        ) : null}
      </div>

      <section data-library-section="runs">
        <h4 data-library-section-title>最近运行</h4>
        {project.recentRuns.length === 0 ? (
          <EmptyState title="这个项目还没有运行记录" hint="计划落盘后自动派发，运行记录会出现在这里" />
        ) : (
          <ul data-region="history-list" data-scope="project" data-count={project.recentRuns.length}>
            {project.recentRuns.map((run) => {
              const row = projectRunRowOf(run)
              return (
                <RunRow
                  key={row.runId}
                  row={row}
                  active={props.openRunId === row.runId}
                  onOpen={props.onOpenRun}
                />
              )
            })}
          </ul>
        )}
      </section>

      <section data-library-section="memories">
        <h4 data-library-section-title>项目记忆</h4>
        {props.memories.length === 0 ? (
          <EmptyState title="本项目暂无记忆" hint="让队长把约定沉淀下来，下次派发会自动带上" />
        ) : (
          <MemoryList
            items={props.memories}
            track="project"
            expanded={props.expandedMemory}
            body={props.memoryBody}
            bodyError={props.memoryError}
            onOpen={props.onOpenMemory}
          />
        )}
      </section>
    </>
  )
}

/**
 * `sidebar.panellist` 槽位的组件（左栏栏目）。
 *
 * 宿主对这个槽位的用法是**面板行的图标**（2026-11-04 修正两次）：
 * `dsh-client-ui-sidebar` 把本槽位每个 entry 的 `{ id, order, label }` 渲染成自己的面板行，
 * 行内用 `renderSlot('sidebar.panellist', { size, active }, { only: id })` 画图标，
 * 点击由宿主调 `ctx.layout.selectPanel(id)` 完成 —— 所以这里
 *   ① 只能画图标（16/18px，`currentColor`），不能画标题/按钮；
 *   ② 绝不能包 `<button>`：外层已经是按钮，嵌套按钮会让浏览器改写 DOM，
 *      点击就不再落到宿主那一行上（症状：点了主界面没反应）。
 * 真正的两栏项目库在 `main` 槽位（`LibraryPage`，key 同为 `PANELLIST_ID`）里渲染。
 */
export interface PanellistEntryProps {
  size?: number
  /** 由 slots 注入（`registerPanellist` 已绑定 sessionId）；node 环境或旧宿主可能没有。 */
  openLibrary?: () => LibraryOpenResult
}

/** glyph 的点击结果：`none` 只出现在「还没点过」，点过之后必须是 main / event / error。 */
type GlyphOpenState = 'none' | LibraryOpenResult

export function PanellistEntry(props: PanellistEntryProps): React.ReactElement {
  const size = typeof props.size === 'number' ? props.size : 16
  const openLibrary = props.openLibrary
  const [result, setResult] = React.useState<GlyphOpenState>('none')
  const [openError, setOpenError] = React.useState(false)
  const timers = React.useRef<Array<ReturnType<typeof setTimeout>>>([])

  // 卸载时清掉 700ms 校准与 2s 红字定时器：宿主切走侧栏后不再 setState。
  React.useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer)
      timers.current = []
    },
    [],
  )

  /** 以 DOM 里真实可见的 surface 为准：`open()` 说成功但主区没挂载时必须落到降级结果。 */
  function settle(immediate: LibraryOpenResult): void {
    const surface = visibleLibrarySurface()
    setResult(
      surface === 'main' ? 'main' : surface === 'panel' ? 'event' : immediate === 'event' ? 'event' : 'error',
    )
  }

  function onClick(): void {
    if (typeof openLibrary !== 'function') return
    let immediate: LibraryOpenResult = 'error'
    try {
      immediate = openLibrary()
    } catch {
      // 打开链自己抛错也要有可见结果：红 glyph + <title>，绝不静默。
      immediate = 'error'
    }
    const failed = immediate === 'error'
    setResult(immediate)
    setOpenError(failed)
    if (failed) {
      timers.current.push(
        setTimeout(() => {
          setOpenError(false)
        }, 2000),
      )
    }
    // 700ms 校准：晚于 500ms watchdog，1s 预算内把最终结果写回 data-last-open-result（AC-8）。
    timers.current.push(
      setTimeout(() => {
        settle(immediate)
      }, 700),
    )
  }

  // additive：只有真的注入了动作才挂 onClick —— 不包 <button>、不 stopPropagation，
  // 宿主行的 layout.selectPanel 照常执行（AC-8 的「还能切到主区」靠它）。
  const interactive = typeof openLibrary === 'function'
  return (
    <svg
      data-auto-team-panellist
      data-panellist-glyph
      data-last-open-result={result}
      data-open-error={openError ? 'true' : undefined}
      // 兜底：r13 的样式把 glyph 设成 pointer-events:none（当时点击全交给宿主行）。
      // r16 的点击链必须由这里自己发起，否则 onClick 永远收不到事件 = 点了没反应（AC-8）。
      // 内联样式优先于样式表，且不 stopPropagation：宿主行仍能收到冒泡后的 selectPanel。
      style={interactive ? { pointerEvents: 'auto' } : undefined}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="presentation"
      focusable="false"
      fill="none"
      stroke={openError ? 'var(--dsw-alias-state-error-primary)' : 'currentColor'}
      strokeWidth="1.2"
      strokeLinecap="round"
      onClick={interactive ? onClick : undefined}
    >
      <title>{openError ? '项目库暂时打不开，请稍后再试' : '打开项目库'}</title>
      <circle cx="8" cy="3.6" r="1.75" />
      <circle cx="3.6" cy="12.2" r="1.75" />
      <circle cx="12.4" cy="12.2" r="1.75" />
      <path d="M7.2 5.1 4.2 10.7M8.8 5.1l3 5.6" />
    </svg>
  )
}

/** 面板内联降级 / `main` 槽位的整页版本。 */
export function LibraryPage(props: LibraryPageProps): React.ReactElement {
  return (
    <div data-auto-team-library data-library-surface={props.inline === true ? 'panel' : 'main'}>
      <LibraryContent {...props} root="library" />
    </div>
  )
}

export default LibraryPage
