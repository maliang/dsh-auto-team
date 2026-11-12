/**
 * 项目库页的 run 行（r14 AC-15）——项目详情里「一个 run 一行」，点开右侧抽屉。
 *
 * 分两行：第一行 `[data-run-title]` 是 run 级 goal（24 字截断已在 `rows.ts#goalTitleOf`
 * 单点做过，组件不再截），无 goal 的旧 run 打 `data-title-source="fallback"`（诚实标注）；
 * 第二行 `[data-run-meta]` = runId 后 6 位 · 状态 · token · 用时，缺量显示「不可得」。
 *
 * 为什么行是 `<button>`：整行可点、原生键盘可达；`[data-run-row]` 与 `[data-run-id]`
 * 同时挂在 button 上，供样式（`data-open`）与真机取证（`[data-drawer-run]`）使用。
 * token/用时文本只原样渲染宿主下发的 cell 文本（`rows.ts` 已格式化），这里不做第二次格式化。
 */
import * as React from 'react'
import type { RunRowView } from '../tabs/rows.ts'

export interface RunRowProps {
  row: RunRowView
  /** 该 run 的抽屉是否正开着（样式用 `data-open`，并给读屏 `aria-expanded`）。 */
  active: boolean
  onOpen: (runId: string) => void
}

/** runId 后 6 位（meta 行第一段；完整 id 在 `title` 与 `data-run-id` 里）。 */
function shortRunId(runId: string): string {
  return runId.length > 6 ? runId.slice(-6) : runId
}

export function RunRow(props: RunRowProps): React.ReactElement {
  const { row, active, onOpen } = props
  return (
    <li>
      <button
        type="button"
        data-run-row
        data-run-id={row.runId}
        data-open={active ? 'true' : 'false'}
        aria-haspopup="dialog"
        aria-expanded={active}
        title={row.titleTitle ?? row.title}
        onClick={() => onOpen(row.runId)}
      >
        <span data-run-title data-title-source={row.titleSource} title={row.titleTitle ?? row.title}>
          {row.title}
        </span>
        <span data-run-meta title={row.metaText}>
          <span data-run-short>{shortRunId(row.runId)}</span>
          <span data-run-sep aria-hidden="true">
            {' · '}
          </span>
          <span
            data-run-status
            data-tone={row.statusTone}
            title={
              row.statusTitle === undefined
                ? `状态：${row.statusText}`
                : `状态：${row.statusText} · ${row.statusTitle}`
            }
          >
            <span aria-hidden="true">{row.statusIcon}</span> {row.statusText}
          </span>
          <span data-run-sep aria-hidden="true">
            {' · '}
          </span>
          <span data-run-token data-usage-source={row.tokenSource} title={row.tokenTitle}>
            {row.tokenText}
          </span>
          <span data-run-sep aria-hidden="true">
            {' · '}
          </span>
          <span data-run-duration data-duration-state={row.durationState} title={row.durationTitle}>
            {row.durationText}
          </span>
        </span>
      </button>
    </li>
  )
}

export default RunRow
