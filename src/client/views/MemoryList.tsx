/**
 * 记忆列表（r13 AC-14 / AC-15）：左栏「项目记忆」与右栏「记忆」页**共用**这一份渲染。
 *
 * 三条纪律：
 *  1. 行高 44px、两行式：上行标题 + `≈token`，下行时间。token 必须带 `≈`，因为它是
 *     `ceil(字符数 / 2)` 的估算值（宿主 `memoryTokenEstimate`），不是 provider 上报值；
 *     不带 `≈` 就是造假。
 *  2. 正文**逐字**渲染（`pre` + `white-space: pre-wrap`）：md 是团队资产，插件不解析、
 *     不美化、不截断 —— 任何「顺手 format 一下」都会让用户复制的命令跑不起来。
 *  3. 展开状态归调用方（`expanded`），组件只报告「点了谁」；这样左栏与右栏各自维护
 *     自己的展开项，不会因为共用组件而互相抢状态。
 */
import * as React from 'react'
import type { MemoryItemView, MemoryTrack } from '../../shared/types.ts'
import { memoryRowOf } from '../viewmodel.ts'
import { EmptyState } from './EmptyState.tsx'

export interface MemoryListProps {
  items: MemoryItemView[]
  track: MemoryTrack
  /** 已展开的条目：文件名或 `track/name` 均可。 */
  expanded?: string
  /** 已加载的正文；`undefined` 表示还没读到（显示读取中，而不是空正文）。 */
  body?: string
  bodyError?: string
  onOpen: (item: MemoryItemView) => void
}

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
  const { items, track, expanded, body, bodyError, onOpen } = props
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

export default MemoryList
