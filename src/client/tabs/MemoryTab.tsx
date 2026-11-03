/**
 * 「记忆」页（r13 AC-19 / AC-20 / AC-21）。
 *
 * 只展示**本项目记忆**（`track=project`）：全局公共记忆属于「跨项目」，按产品决策放在
 * 左栏项目库的「全局」行里（那里才能同时看到所有项目的记忆），右栏再放一份就是两处同源列表。
 *
 * 三条纪律：
 *  1. 索引来自快照（`snapshot.memory.files`），**不在客户端扫目录**；
 *  2. token 数是估算值，必须带 `≈` 与 `tokenBasis='estimate'`（`MemoryList` 按此渲染），
 *     绝不把估算值伪装成 provider 上报值（AC-20 的反面）；
 *  3. 正文按需读取（点开才读），读失败就地显示原因并保留列表 —— 不清空成空态。
 */
import * as React from 'react'
import type { MemoryFileInfo, MemoryItemView } from '../../shared/types.ts'
import type { TabProps } from '../Panel.tsx'
import { EmptyState } from '../views/EmptyState.tsx'
import { MemoryList } from '../views/MemoryList.tsx'
import { useTabScroll } from './rows.ts'

/**
 * `MemoryFileInfo` → `MemoryItemView`。
 *
 * `tokenEstimate` 由宿主给（r13 起恒有）；老快照缺失时按宿主的估算口径（字符数 / 2）补一个，
 * 仍标记 `tokenBasis: 'estimate'`，界面上照旧显示 `≈`，不会冒充真实用量。
 */
function itemOf(file: MemoryFileInfo): MemoryItemView {
  const estimate =
    typeof file.tokenEstimate === 'number' && Number.isFinite(file.tokenEstimate)
      ? file.tokenEstimate
      : Math.round(charsOf(file) / 2)
  return {
    track: file.track,
    name: file.name,
    title: file.name,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    tokenEstimate: estimate,
    tokenBasis: 'estimate',
  }
}

function charsOf(file: MemoryFileInfo): number {
  return typeof file.chars === 'number' && Number.isFinite(file.chars) ? file.chars : 0
}

export function MemoryTab(props: TabProps): React.ReactElement {
  const scroll = useTabScroll('memory')
  const [openName, setOpenName] = React.useState<string | undefined>(undefined)
  const [body, setBody] = React.useState<string | undefined>(undefined)
  const [bodyError, setBodyError] = React.useState<string | undefined>(undefined)
  const [loading, setLoading] = React.useState(false)

  const files = props.snapshot?.memory.files ?? []
  const items = React.useMemo(
    () => files.filter((file) => file.track === 'project').map((file) => itemOf(file)),
    [files],
  )
  const injected = props.snapshot?.memory.injectedChars ?? 0
  const budget = props.snapshot?.memory.budget ?? 0
  const truncated = props.snapshot?.memory.truncated === true

  async function open(item: MemoryItemView): Promise<void> {
    if (openName === item.name) {
      setOpenName(undefined)
      setBody(undefined)
      setBodyError(undefined)
      return
    }
    setOpenName(item.name)
    setBody(undefined)
    setBodyError(undefined)
    setLoading(true)
    try {
      // workspace 不传：右栏看的就是**当前项目**的记忆，宿主按会话归属解析。
      const result = await props.readMemory('project', item.name)
      if (result.error !== undefined) setBodyError(result.error)
      else setBody(result.data?.body ?? '')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div data-region="memory-tab" data-tab-scroll="memory" ref={scroll.ref} onScroll={scroll.onScroll}>
      <div data-memory-stat>
        <span data-memory-track="project">项目记忆</span>
        <span data-memory-budget data-truncated={truncated ? 'true' : 'false'}>
          注入 {injected}/{budget} 字符{truncated ? '（已截断）' : ''}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="本项目还没有记忆"
          hint="让队长把约定沉淀成记忆，之后的派发会自动带上它"
          next="公共记忆在左栏「全局」行里"
        />
      ) : (
        <MemoryList
          items={items}
          track="project"
          expanded={openName}
          body={loading ? undefined : body}
          bodyError={bodyError}
          onOpen={(item) => void open(item)}
        />
      )}

      {items.length > 0 ? (
        <p data-memory-hint>公共记忆见左栏「自动团队 → 全局」；token 数为估算值（≈ 字符数 / 2）。</p>
      ) : null}
    </div>
  )
}

export default MemoryTab
