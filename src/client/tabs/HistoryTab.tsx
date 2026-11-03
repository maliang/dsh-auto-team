/**
 * 「历史」页（r13 AC-5 / AC-6 / AC-22 / AC-23）。
 *
 * 两态：**列表** ⇄ **详情**（内联展开，不做抽屉；320px 面板里抽屉会把列表全遮住）。
 *  - 列表来自 `snapshot.runs`（宿主每张快照带 ≤50 条），没有时退回 `library.runs`；
 *  - 详情走 `openRun(runId)` → `GET /library?runId=` → `library.detail`，**不新增第 5 条路由**（AC-22）；
 *  - 详情里的任务表、角色条、流转图复用与任务页**完全相同的组件**（AC-18），
 *    装配也走同一个 `buildRunDetail`（这里直接用宿主给好的 `RunDetailView`，不再二次拼装）。
 *
 * 分页：首屏 `HISTORY_PAGE_SIZE`（50）条，每次「加载更多」+50；已加载条数存模块级页签记忆，
 * 切走再回来不用重新翻。
 */
import * as React from 'react'
import type { RunSummary } from '../../shared/types.ts'
import { HISTORY_PAGE_SIZE } from '../../shared/const.ts'
import type { TabProps } from '../Panel.tsx'
import { buildRunDetail } from '../viewmodel.ts'
import { DetailPane } from '../views/DetailPane.tsx'
import { EmptyState } from '../views/EmptyState.tsx'
import { FlowGraph } from '../views/FlowGraph.tsx'
import { RoleStrip } from '../views/RoleStrip.tsx'
import { RunHeader } from '../views/RunHeader.tsx'
import { TaskTable } from '../views/TaskTable.tsx'
import { runSummaryRowOf, scrollToTaskRow, tabMemoryOf, useExpandedTask, useTabScroll } from './rows.ts'

/** 历史详情的任务展开同样跨页签保持（key 与任务页分开，避免两边互相抢展开行）。 */
const HISTORY_TAB_KEY = 'history'

export function HistoryTab(props: TabProps): React.ReactElement {
  const scroll = useTabScroll(HISTORY_TAB_KEY)
  const [expanded, toggleTask, expandTask] = useExpandedTask(HISTORY_TAB_KEY)
  const [, bumpLimit] = React.useReducer((value: number) => value + 1, 0)
  const memory = tabMemoryOf(HISTORY_TAB_KEY)

  const openRunId = props.detailRunId
  const detail =
    props.detail !== null && openRunId !== null && props.detail.runId === openRunId ? props.detail : null
  const detailView = React.useMemo(
    () => (detail === null ? null : buildRunDetail({ snapshot: null, runDetail: detail })),
    [detail],
  )
  const detailTaskIds = React.useMemo(
    () => (detailView === null ? [] : detailView.tasks.map((task) => task.id)),
    [detailView],
  )

  if (openRunId !== null) {
    return (
      <div data-region="history-detail" data-tab-scroll="history-detail" ref={scroll.ref} onScroll={scroll.onScroll}>
        <DetailPane breadcrumb={['历史', openRunId]} onBack={props.closeRun}>
          {detailView !== null ? (
            <>
              <RunHeader detail={detailView} paused={props.paused} inflight="idle" />
              <RoleStrip roles={detailView.roles} />
              <TaskTable
                tasks={detailView.tasks}
                expandedTaskId={expanded}
                onToggleTask={(taskId) => toggleTask(taskId)}
              />
              <FlowGraph
                flow={detailView.flow}
                onSelectTask={(taskId) => {
                  expandTask(taskId)
                  if (typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(() => scrollToTaskRow(taskId, detailTaskIds))
                  } else {
                    scrollToTaskRow(taskId, detailTaskIds)
                  }
                }}
              />
            </>
          ) : props.libraryError !== null ? (
            <EmptyState title="读不到这条历史" hint={props.libraryError} next="返回列表换一条试试" />
          ) : (
            <EmptyState title="正在读取历史详情…" hint={`运行 ${openRunId} 的任务、用量与用时正在从磁盘装配`} />
          )}
        </DetailPane>
      </div>
    )
  }

  const runs: RunSummary[] = props.snapshot?.runs ?? props.library?.runs ?? []
  const limit = memory.historyLimit > 0 ? memory.historyLimit : HISTORY_PAGE_SIZE
  const visible = runs.slice(0, limit)
  const hasMore = runs.length > visible.length

  return (
    <div data-region="history-list-region" data-tab-scroll="history" ref={scroll.ref} onScroll={scroll.onScroll}>
      {runs.length === 0 ? (
        <EmptyState
          title="还没有历史运行"
          hint="计划落盘并开跑后，每次运行都会留在这里（含 token 与用时）"
          next="对队长说一句话即可开始"
        />
      ) : (
        <ul data-region="history-list">
          {visible.map((run) => {
            const row = runSummaryRowOf(run)
            return (
              <li key={row.runId} data-history-row data-active={row.active ? 'true' : 'false'}>
                <button type="button" data-history-open={row.runId} onClick={() => void props.openRun(row.runId)}>
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
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {hasMore ? (
        <button
          type="button"
          data-history-more
          onClick={() => {
            memory.historyLimit = limit + HISTORY_PAGE_SIZE
            bumpLimit()
          }}
        >
          加载更多（已显示 {visible.length}/{runs.length}）
        </button>
      ) : null}

      {props.libraryError !== null && runs.length > 0 ? (
        <p data-error data-error-scope="library" role="alert">
          {props.libraryError}
        </p>
      ) : null}
    </div>
  )
}

export default HistoryTab
