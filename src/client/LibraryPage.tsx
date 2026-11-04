/**
 * 左栏「自动团队」栏目 + 项目库（r13 AC-23 / AC-24 / AC-25）。
 *
 * 结构（DESIGN §5）：`[data-library-shell]` → `[data-library-head]`（44px）+ `[data-library-body]`：
 *  - `[data-region="project-list"]`（220px）：**首行「全局」**、中间各项目（最近活跃倒序）、**末位「未知项目」**；
 *  - `[data-region="project-detail"]`：项目头（名称/路径/运行数/用量）+ 最近 run 任务区 + 项目记忆；
 *    点开某条 run 就在这块里内联展开详情（保留左列与选中态，DESIGN §5.4）。
 *
 * 两条硬约束：
 *  1. **AC-23**：`loadLibrary()` 只在本组件挂载时调用一次（页面打开才装配），与右栏的快照轮询完全分离；
 *  2. **AC-18**：run 详情的任务表/角色条/流转图复用右栏同一套组件与同一个 `buildRunDetail`，
 *     绝不在这里内联第二份任务表（否则两处 token 文本会漂移）。
 *
 * `main` 槽位对第三方插件是否开放**尚未真机验证**（TECHNICAL §0 U2），所以：
 *  - `PanellistEntry` 是被 `registerPanellist` 整段 try/catch 注册的，失败不影响其它槽位；
 *  - 拿不到主区入口时派发 `AUTO_TEAM_OPEN_LIBRARY_EVENT`，由 `Panel` 在面板内联渲染本页（降级路径）。
 */
import * as React from 'react'
import type { LibraryView, MemoryItemView, MemoryTrack, ProjectView } from '../shared/types.ts'
import { sessionIdOf, usePanelState } from './state.ts'
import { panelApi } from './api.ts'
import { OPEN_LIBRARY_EVENT } from './slots.ts'
import { buildRunDetail, formatStamp, tokenTextOf, tokenTitleOf } from './viewmodel.ts'
import { DetailPane } from './views/DetailPane.tsx'
import { EmptyState } from './views/EmptyState.tsx'
import { FlowGraph } from './views/FlowGraph.tsx'
import { MemoryList } from './views/MemoryList.tsx'
import { RoleStrip } from './views/RoleStrip.tsx'
import { RunHeader } from './views/RunHeader.tsx'
import { TaskTable } from './views/TaskTable.tsx'
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

  const readMemory = React.useCallback(
    (track: MemoryTrack, name: string, workspace?: string) => panelApi.readMemory(sessionId, track, name, workspace),
    [sessionId],
  )

  /** 「全局」固定在最上；其余按最近活跃倒序；`unknown` 项目固定末位（PRD §11 默认值）。 */
  const projects = React.useMemo<ProjectView[]>(() => {
    const list = library?.projects ?? []
    const known = list.filter((project) => project.unknown !== true)
    const unknown = list.filter((project) => project.unknown === true)
    return [...known, ...unknown]
  }, [library])

  const selectedId = picked !== '' ? picked : (library?.currentProject ?? 'global')
  const selectedProject = projects.find((project) => project.id === selectedId)

  const detail = view.detail !== null && view.detailRunId !== null && view.detail.runId === view.detailRunId ? view.detail : null
  const detailView = React.useMemo(
    () => (detail === null ? null : buildRunDetail({ snapshot: null, runDetail: detail })),
    [detail],
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

  const globalItems = library?.global.memories ?? []
  const projectItems = selectedProject?.memories ?? []

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

      <div data-library-body>
        <div data-region="project-list" role="list" aria-label="项目">
          <button
            type="button"
            role="listitem"
            data-auto-team-nav
            data-nav-kind="global"
            data-active={selectedId === 'global' ? 'true' : 'false'}
            onClick={() => {
              setPicked('global')
              setOpenMemory(undefined)
            }}
          >
            <span data-nav-name>全局</span>
            <span data-nav-meta>{globalItems.length} 条公共记忆</span>
          </button>

          {projects.map((project) => {
            const nav = projectNavOf(project, project.id === selectedId)
            return (
              <button
                key={project.id}
                type="button"
                role="listitem"
                data-auto-team-nav
                data-nav-kind={nav.unknown ? 'unknown' : 'project'}
                data-project-id={nav.id}
                data-active={nav.active ? 'true' : 'false'}
                title={nav.path ?? nav.name}
                onClick={() => {
                  setPicked(nav.id)
                  setOpenMemory(undefined)
                }}
              >
                <span data-nav-name>{nav.name}</span>
                <span data-nav-meta>{nav.metaText}</span>
                <span data-nav-token data-usage-source={project.usage.source} title={nav.tokenTitle}>
                  {nav.tokenText}
                </span>
              </button>
            )
          })}
        </div>

        <div data-region="project-detail">
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
              detailView={detailView}
              detailRunId={view.detailRunId}
              detailTaskIds={detailTaskIds}
              expandedTaskId={expanded}
              onToggleTask={toggleTask}
              onExpandTask={expandTask}
              onOpenRun={(runId) => void view.openRun(runId)}
              onCloseRun={view.closeRun}
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
        </div>
      </div>
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

/** 单项目面板：项目头 + 最近 run（可展开详情）+ 项目记忆。 */
function ProjectPane(props: {
  project: ProjectView
  detailView: ReturnType<typeof buildRunDetail>
  detailRunId: string | null
  detailTaskIds: string[]
  expandedTaskId?: string
  onToggleTask: (taskId: string) => void
  onExpandTask: (taskId: string) => void
  onOpenRun: (runId: string) => void
  onCloseRun: () => void
  memories: MemoryItemView[]
  expandedMemory?: string
  memoryBody?: string
  memoryError?: string
  onOpenMemory: (item: MemoryItemView) => void
}): React.ReactElement {
  const { project } = props
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
      </div>

      <section data-library-section="runs">
        <h4 data-library-section-title>最近运行</h4>
        {props.detailView !== null && props.detailRunId !== null ? (
          <DetailPane breadcrumb={['历史', props.detailRunId]} onBack={props.onCloseRun}>
            <RunHeader detail={props.detailView} inflight="idle" />
            <RoleStrip roles={props.detailView.roles} />
            <TaskTable
              tasks={props.detailView.tasks}
              expandedTaskId={props.expandedTaskId}
              onToggleTask={props.onToggleTask}
            />
            <FlowGraph
              flow={props.detailView.flow}
              onSelectTask={(taskId) => {
                props.onExpandTask(taskId)
                if (typeof requestAnimationFrame === 'function') {
                  requestAnimationFrame(() => scrollToTaskRow(taskId, props.detailTaskIds))
                } else {
                  scrollToTaskRow(taskId, props.detailTaskIds)
                }
              }}
            />
          </DetailPane>
        ) : project.recentRuns.length === 0 ? (
          <EmptyState title="这个项目还没有运行记录" hint="计划落盘后自动派发，运行记录会出现在这里" />
        ) : (
          <ul data-region="history-list" data-scope="project">
            {project.recentRuns.map((run) => {
              const row = projectRunRowOf(run)
              const active = props.detailRunId === row.runId
              return (
                <li key={row.runId} data-history-row data-active={active ? 'true' : 'false'}>
                  <button type="button" data-history-open={row.runId} onClick={() => props.onOpenRun(row.runId)}>
                    <span data-history-line="title">
                      <span data-history-title title={row.title}>
                        {row.title}
                      </span>
                      <span data-badge data-tone={row.statusTone} title={`状态：${row.statusText}`}>
                        <span aria-hidden="true">{row.statusIcon}</span> {row.statusText}
                      </span>
                    </span>
                    <span data-history-line="meta">
                      <span data-history-time>{row.metaText}</span>
                      <span data-history-token data-usage-source={row.tokenSource} title={row.tokenTitle}>
                        {row.tokenText}
                      </span>
                      <span data-history-duration data-duration-state={row.durationState} title={row.durationTitle}>
                        {row.durationText}
                      </span>
                    </span>
                  </button>
                </li>
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
export function PanellistEntry(props: LibraryPageProps): React.ReactElement {
  const size = typeof props.size === 'number' ? props.size : 16
  return (
    <svg
      data-auto-team-panellist
      data-panellist-glyph
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="presentation"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    >
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
    <div data-auto-team-library>
      <LibraryContent {...props} root="library" />
    </div>
  )
}

export default LibraryPage
