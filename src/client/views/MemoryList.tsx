/**
 * 记忆列表（r13 AC-14 / AC-15；r23 扩展文件级条目视图）。
 *
 * 两种模式：
 *  1. `items`（左栏项目库/全局记忆）：行高 44px 两行式，`≈token` + 时间；
 *  2. `files`（右栏「记忆」页）：文件行显示主题标题、等级分布、条目数；展开后渲染宿主
 *     下发的 `MemoryEntryView[]`（等级徽标 / 正文 / 来源与修正次数 / 已作废删除线）。
 *
 * 三条纪律：
 *  1. token 必须带 `≈`，因为它是 `ceil(字符数 / 2)` 的估算值，不是 provider 上报值。
 *  2. 正文**逐字**渲染：md 是团队资产，插件不解析、不美化、不截断。r23 的条目正文同样
 *     直接用宿主下发的 `text` / `sourceText`，客户端不切分「（来源：」、不拼时间。
 *  3. 展开状态归调用方（`expanded`），组件只报告「点了谁」；左栏与右栏各自维护展开项。
 */
import * as React from 'react'
import type { MemoryEntryView, MemoryFileView, MemoryItemView, MemoryTrack } from '../../shared/types.ts'
import {
  memoryEntriesOf,
  memoryFileRowOf,
  memoryRowOf,
  type MemoryEntryRowView,
} from '../viewmodel.ts'
import { EmptyState } from './EmptyState.tsx'

interface MemoryListBaseProps {
  track: MemoryTrack
  /** 已展开的条目：文件名、`track/name` 或文件视图 key 均可。 */
  expanded?: string
  /** 旧宿主没有 `entries` 时的整文件正文（逐字渲染）。 */
  body?: string
  bodyError?: string
  /** r23：宿主解析后的条目视图（客户端不解析 md）。 */
  entries?: MemoryEntryView[]
  entriesLoading?: boolean
  /** 读取失败后的重试入口（失败态不许只留一块空白）。 */
  onRetry?: () => void
}

/** 左栏模式：文件级 `MemoryItemView[]`（与 `files` 二选一）。 */
export interface MemoryItemsProps extends MemoryListBaseProps {
  items: MemoryItemView[]
  files?: never
  onOpen: (target: MemoryItemView) => void
}

/** 右栏模式：宿主下发的 `MemoryFileView[]`（等级分布/条目数已算好）。 */
export interface MemoryFilesProps extends MemoryListBaseProps {
  files: MemoryFileView[]
  items?: never
  onOpen: (target: MemoryFileView) => void
}

export type MemoryListProps = MemoryItemsProps | MemoryFilesProps

const EMPTY_COPY: Record<MemoryTrack, { title: string; hint: string; next: string }> = {
  project: {
    title: '本项目暂无记忆',
    hint: '队长会在这里记下本项目的约定',
    next: '对队长说「记住这个约定」即可',
  },
  public: {
    title: '全局记忆为空',
    hint: 'public 轨记忆作用于所有项目',
    next: '对队长说「记住这个约定」即可',
  },
}

export function MemoryList(props: MemoryListProps): React.ReactElement {
  if (props.files !== undefined) {
    return (
      <MemoryFileList
        files={props.files}
        track={props.track}
        expanded={props.expanded}
        body={props.body}
        bodyError={props.bodyError}
        entries={props.entries}
        entriesLoading={props.entriesLoading}
        onRetry={props.onRetry}
        onOpen={props.onOpen}
      />
    )
  }

  const { track, expanded, body, bodyError, onRetry, onOpen } = props
  const items = props.items
  const empty = EMPTY_COPY[track] ?? EMPTY_COPY.project
  if (items.length === 0) {
    return <EmptyState title={empty.title} hint={empty.hint} next={empty.next} />
  }
  return (
    <ul data-memory-list aria-label={track === 'public' ? '全局记忆' : '项目记忆'}>
      {items.map((item) => {
        const row = memoryRowOf(item)
        const open = expanded === row.name || expanded === row.key
        return (
          <li key={row.key} data-memory-row data-open={open ? 'true' : 'false'}>
            <button
              type="button"
              data-auto-team-memory-item={row.key}
              data-memory-track={item.track}
              aria-expanded={open}
              onClick={() => onOpen(item)}
              title={item.name}
            >
              <span data-memory-title>{row.title}</span>
              <span data-memory-token title={row.tokenTitle}>
                {row.tokenText}
              </span>
              <span data-memory-time>{row.timeText}</span>
            </button>
            {open ? (
              bodyError ? (
                <p data-error role="alert">
                  {bodyError}
                </p>
              ) : body === undefined ? (
                <p data-memory-loading aria-busy="true">
                  读取中…
                </p>
              ) : (
                <pre data-memory-body>{body}</pre>
              )
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/* ───────────────────────── r23：文件级列表 ───────────────────────── */

interface MemoryFileListProps {
  files: MemoryFileView[]
  track: MemoryTrack
  expanded?: string
  body?: string
  bodyError?: string
  entries?: MemoryEntryView[]
  entriesLoading?: boolean
  onRetry?: () => void
  onOpen: (target: MemoryFileView) => void
}

function MemoryFileList(props: MemoryFileListProps): React.ReactElement {
  const { files, track, expanded, body, bodyError, entries, entriesLoading, onRetry, onOpen } = props
  const empty = EMPTY_COPY[track] ?? EMPTY_COPY.project
  if (files.length === 0) {
    return <EmptyState title={empty.title} hint={empty.hint} next={empty.next} />
  }
  return (
    <ul data-memory-list data-memory-mode="files" aria-label={track === 'public' ? '公共记忆文件' : '项目记忆文件'}>
      {files.map((file) => {
        const row = memoryFileRowOf(file)
        const open = expanded === row.name || expanded === row.key
        return (
          <li
            key={row.key}
            data-memory-row
            data-memory-file-row
            data-topic={file.topic ?? ''}
            data-open={open ? 'true' : 'false'}
          >
            <button
              type="button"
              data-auto-team-memory-item={row.key}
              data-memory-track={file.track}
              aria-expanded={open}
              aria-label={`${row.title}，${row.countText}`}
              onClick={() => onOpen(file)}
              title={`${row.title}（${row.metaText}）`}
            >
              <span data-memory-title>{row.title}</span>
              <span data-memory-file-count>{row.countText}</span>
              <span data-memory-distribution title={row.distributionTitle}>
                {row.distributionText}
              </span>
              <span data-memory-file-meta>{row.metaText}</span>
            </button>
            {open ? (
              <MemoryFileDetail
                body={body}
                bodyError={bodyError}
                entries={entries}
                entriesLoading={entriesLoading}
                onRetry={onRetry}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

interface MemoryFileDetailProps {
  body?: string
  bodyError?: string
  entries?: MemoryEntryView[]
  entriesLoading?: boolean
  onRetry?: () => void
}

function MemoryFileDetail(props: MemoryFileDetailProps): React.ReactElement {
  const { body, bodyError, entries, entriesLoading, onRetry } = props
  if (bodyError !== undefined) {
    return (
      <div data-memory-detail>
        <p data-error role="alert">
          {bodyError}
        </p>
        {onRetry === undefined ? null : (
          <button type="button" data-memory-retry onClick={onRetry}>
            重试读取
          </button>
        )}
      </div>
    )
  }
  if (entriesLoading === true) {
    return (
      <p data-memory-loading aria-busy="true">
        正在读取条目…
      </p>
    )
  }
  if (entries !== undefined) {
    return <MemoryEntryGroups entries={entries} />
  }
  // 兼容旧宿主（没有 entries）：正文逐字渲染，不做任何解析。
  if (body !== undefined) return <pre data-memory-body>{body}</pre>
  return (
    <p data-memory-loading aria-busy="true">
      正在读取条目…
    </p>
  )
}

function MemoryEntryGroups(props: { entries: MemoryEntryView[] }): React.ReactElement {
  const groups = memoryEntriesOf(props.entries)
  if (groups.active.length === 0 && groups.superseded.length === 0) {
    return <p data-memory-empty-detail>这个文件还没有条目</p>
  }
  return (
    <div data-memory-detail>
      {groups.active.length === 0 ? (
        <p data-memory-empty-detail>没有活动条目</p>
      ) : (
        <ul data-memory-entries aria-label="活动条目">
          {groups.active.map((entry) => (
            <MemoryEntryItem key={entry.key} row={entry} />
          ))}
        </ul>
      )}
      {groups.superseded.length === 0 ? null : (
        <details data-memory-superseded>
          <summary>已作废 {groups.superseded.length} 条</summary>
          <ul data-memory-entries aria-label="已作废条目">
            {groups.superseded.map((entry) => (
              <MemoryEntryItem key={entry.key} row={entry} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function MemoryEntryItem(props: { row: MemoryEntryRowView }): React.ReactElement {
  const row = props.row
  return (
    <li
      data-memory-entry
      data-level={row.level}
      data-superseded={row.superseded ? 'true' : 'false'}
      data-memory-entry-revisions={row.revisions}
    >
      <span data-memory-entry-head>
        <span data-memory-entry-level data-tone={row.tone}>
          {row.levelText}
        </span>
        {row.superseded ? <span data-memory-entry-flag>{row.supersededText}</span> : null}
      </span>
      <span data-memory-entry-text>{row.text}</span>
      <span data-memory-entry-source title={row.sourceText}>
        {row.sourceText}
      </span>
    </li>
  )
}

export default MemoryList
