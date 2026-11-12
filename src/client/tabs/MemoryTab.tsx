/**
 * 「记忆」页（r13 AC-19/20/21；r23 记忆策展）。
 *
 * 只展示**本项目记忆**（`track=project`）：公共记忆属于「跨项目」，放在左栏项目库的「全局」行。
 *
 * r23 四条纪律：
 *  1. **禁止客户端解析 md**：等级/正文/来源/时间/修正次数全部用宿主下发的
 *     `MemoryFileView` / `MemoryEntryView`（`sourceText`、`stamp` 已格式化）；
 *  2. 列表只渲染文件汇总（配额、等级分布、条目数），点开才按需 `GET /memory` 拉条目；
 *  3. 「整理旧流水」先 dry-run 预览，确认后才 `dryRun:false` 写盘；失败保留列表与展开态，
 *     只显示原因，绝不清空成空态；
 *  4. 异步读取三态齐全：加载中 / 失败 + 重试 / 有数据（空正文单独一句）。
 */
import * as React from 'react'
import type {
  MemoryCurateReport,
  MemoryEntryView,
  MemoryFileView,
} from '../../shared/types.ts'
import type { TabProps } from '../Panel.tsx'
import { EmptyState } from '../views/EmptyState.tsx'
import { MemoryList } from '../views/MemoryList.tsx'
import { useTabScroll } from './rows.ts'
import {
  memoryCurationOutcomeOf,
  memoryCurationReportOf,
  memoryQuotaRowOf,
} from '../viewmodel.ts'

interface OpenDetail {
  name: string
  body?: string
  entries?: MemoryEntryView[]
  error?: string
}

export function MemoryTab(props: TabProps): React.ReactElement {
  const scroll = useTabScroll('memory')
  const [openName, setOpenName] = React.useState<string | undefined>(undefined)
  const [detail, setDetail] = React.useState<OpenDetail | undefined>(undefined)
  const [loading, setLoading] = React.useState(false)
  /** 读取序号：快速连点两个文件时，只认最后一次请求的结果（旧响应不许覆盖新展开项）。 */
  const readSeq = React.useRef(0)

  const memory = props.snapshot?.memory
  const files = (memory?.files ?? []).filter((file) => file.track === 'project' && file.legacy !== true)
  const quotaRow = memoryQuotaRowOf('project', memory?.quotas?.project, memory?.files ?? [], memory?.legacyFileCount)
  const injected = memory?.injectedChars ?? 0
  const budget = memory?.budget ?? 0
  const truncated = memory?.truncated === true
  // r22：记忆落到装配目录（没解析到本项目）时必须显示原因 —— 静默写错位置正是本次修复的缺陷。
  const memoryDegraded = memory?.degraded === true
  const degradeReason = memory?.degradeReason
  const legacyCount = memory?.legacyFileCount
  const legacyKnown = typeof legacyCount === 'number' && Number.isFinite(legacyCount)
  const noLegacy = legacyKnown && legacyCount === 0

  const [curating, setCurating] = React.useState(false)
  const [curationReport, setCurationReport] = React.useState<MemoryCurateReport | undefined>(undefined)
  const [curationError, setCurationError] = React.useState<string | undefined>(undefined)

  const openFile = React.useCallback(
    async (file: MemoryFileView, force = false): Promise<void> => {
      if (!force && openName === file.name) {
        readSeq.current += 1
        setOpenName(undefined)
        setDetail(undefined)
        setLoading(false)
        return
      }
      const seq = (readSeq.current += 1)
      setOpenName(file.name)
      setDetail(undefined)
      setLoading(true)
      try {
        // workspace 不传：右栏看的就是**当前项目**的记忆，宿主按会话归属解析。
        const result = await props.readMemory('project', file.name)
        if (seq !== readSeq.current) return
        if (result.error !== undefined) {
          setDetail({ name: file.name, error: result.error })
          return
        }
        setDetail({ name: file.name, body: result.data?.body, entries: result.data?.entries })
      } catch (err) {
        if (seq !== readSeq.current) return
        setDetail({ name: file.name, error: err instanceof Error ? err.message : String(err) })
      } finally {
        if (seq === readSeq.current) setLoading(false)
      }
    },
    [openName, props.readMemory],
  )

  function retryOpen(): void {
    const file = files.find((item) => item.name === openName)
    if (file === undefined) return
    void openFile(file, true)
  }

  async function runCuration(dryRun: boolean): Promise<void> {
    if (curating) return
    setCurating(true)
    setCurationError(undefined)
    if (dryRun) setCurationReport(undefined)
    try {
      const result = await props.act({ type: 'curateMemory', track: 'project', dryRun })
      const outcome = memoryCurationOutcomeOf(result)
      if (!outcome.ok) {
        setCurationError(outcome.message ?? '整理失败（宿主未说明原因）')
        return
      }
      if (outcome.report === undefined) {
        setCurationError('宿主没有返回整理报告，请稍后重试')
        return
      }
      setCurationReport(outcome.report)
    } catch (err) {
      setCurationError(err instanceof Error ? err.message : String(err))
    } finally {
      setCurating(false)
    }
  }

  const reportView = curationReport === undefined ? undefined : memoryCurationReportOf(curationReport)
  const legacyText = !legacyKnown
    ? '旧流水数量未下发（旧快照）'
    : legacyCount === 0
      ? '旧流水 0 个文件：没有历史教训可整理'
      : `旧流水 ${legacyCount} 个文件（两轨合计）不参与注入；整理只处理本项目的历史流水`

  return (
    <div data-region="memory-tab" data-tab-scroll="memory" ref={scroll.ref} onScroll={scroll.onScroll}>
      <div data-memory-stat>
        <span
          data-memory-track="project"
          data-memory-quota
          data-tone={quotaRow.tone}
          data-memory-files={quotaRow.files}
          data-memory-max-files={quotaRow.maxFiles}
          data-memory-total-entries={quotaRow.totalEntries}
          title={`项目记忆主题文件 ${quotaRow.files}/${quotaRow.maxFiles}，活动条目共 ${quotaRow.totalEntries} 条`}
        >
          {quotaRow.text}
        </span>
        <span data-memory-budget data-truncated={truncated ? 'true' : 'false'}>
          注入 {injected}/{budget} 字符{truncated ? '（已截断）' : ''}
        </span>
      </div>

      {quotaRow.warnings.length === 0 ? null : (
        <ul data-memory-warnings aria-label="记忆配额提示">
          {quotaRow.warnings.map((warning) => (
            <li key={warning.key} data-memory-warning data-tone={warning.tone}>
              {warning.text}
            </li>
          ))}
        </ul>
      )}

      {memoryDegraded ? (
        <p data-memory-degraded>
          {degradeReason ?? '未能解析本项目工作区：项目记忆暂时写进装配目录。'}
        </p>
      ) : null}

      <div data-memory-curation>
        <div data-memory-curation-bar>
          <span data-memory-legacy>{legacyText}</span>
          <button
            type="button"
            data-memory-curate
            data-busy={curating ? 'true' : 'false'}
            disabled={curating || noLegacy}
            title={noLegacy ? '没有旧流水可整理' : '先预演（不写盘），确认后再执行'}
            onClick={() => void runCuration(true)}
          >
            {curating ? '整理中…' : '整理旧流水'}
          </button>
        </div>

        {curationError === undefined ? null : (
          <div data-memory-curation-error>
            <p data-error role="alert">
              {curationError}
            </p>
            <button type="button" data-memory-curate-retry disabled={curating} onClick={() => void runCuration(true)}>
              重试预演
            </button>
          </div>
        )}

        {reportView === undefined ? null : (
          <div
            data-memory-curation-report
            data-phase={reportView.phase}
            role="status"
            aria-live="polite"
          >
            <p data-memory-curation-headline>{reportView.headline}</p>
            <ul data-memory-curation-counts>
              {reportView.counts.map((line) => (
                <li key={line} data-memory-curation-count>
                  {line}
                </li>
              ))}
            </ul>
            {reportView.warnings.length === 0 ? null : (
              <ul data-memory-curation-warnings>
                {reportView.warnings.map((warning) => (
                  <li key={warning} data-memory-curation-warning>
                    {warning}
                  </li>
                ))}
              </ul>
            )}
            <div data-memory-curation-actions>
              {reportView.canApply ? (
                <button
                  type="button"
                  data-memory-curate-apply
                  disabled={curating}
                  onClick={() => void runCuration(false)}
                >
                  {curating ? '写入中…' : reportView.applyLabel}
                </button>
              ) : null}
              <button
                type="button"
                data-memory-curate-close
                disabled={curating}
                onClick={() => {
                  setCurationReport(undefined)
                  setCurationError(undefined)
                }}
              >
                {reportView.closeLabel}
              </button>
            </div>
          </div>
        )}
      </div>

      {files.length === 0 ? (
        <EmptyState
          title="本项目还没有主题记忆"
          hint="队长把约定沉淀成条目后，会按主题出现在这里"
          next="也可以用「整理旧流水」把历史教训提炼进 pitfalls"
        />
      ) : (
        <MemoryList
          files={files}
          track="project"
          expanded={openName}
          body={detail?.body}
          bodyError={detail?.error}
          entries={detail?.entries}
          entriesLoading={loading}
          onRetry={retryOpen}
          onOpen={(target) => void openFile(target)}
        />
      )}

      {files.length > 0 ? (
        <p data-memory-hint>公共记忆见左栏「自动团队 → 全局」；条目等级 P0 铁律 / P1 教训 / P2 常规。</p>
      ) : null}
    </div>
  )
}

export default MemoryTab
