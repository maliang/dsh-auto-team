/**
 * 记忆页：公共 / 项目双轨 md，可读、可改、可删（AC-24 / AC-25）。
 *
 * 本页最重要的一条纪律（D7）：**点条目必须先读正文再进编辑器**。
 * 旧实现是「点条目只填文件名」，用户看着空编辑器直接保存 → 把已有记忆整条清空。
 * 所以这里的顺序是：选中 → `readMemory` 拉正文 → 才允许编辑；正文没读到就禁止保存。
 *
 * 预算行「预计注入 N / 4000 字符」是用户唯一能感知「为什么成员没读到某条记忆」的地方，不能省。
 */
import * as React from 'react'
import type { TabProps } from '../Panel.tsx'
import type { MemoryTrack } from '../../shared/types.ts'
import { actFeedback, hintOf } from '../viewmodel.ts'

export function MemoryTab(props: TabProps): React.ReactElement {
  const { snapshot, act, readMemory } = props
  const [track, setTrack] = React.useState<MemoryTrack>('project')
  const [name, setName] = React.useState('')
  const [body, setBody] = React.useState('')
  /** 正在编辑的已有文件；undefined = 新建。 */
  const [opened, setOpened] = React.useState<string | undefined>(undefined)
  /** 待确认删除的文件名（两步删除，防误触）。 */
  const [pendingDelete, setPendingDelete] = React.useState<string | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)
  const [hint, setHint] = React.useState<string | undefined>(undefined)
  const [loaded, setLoaded] = React.useState(false)

  const memory = snapshot?.memory
  const files = (memory?.files ?? []).filter((file) => file.track === track)
  const budget = memory?.budget ?? 4000
  const injected = memory?.injectedChars ?? 0
  const over = injected > budget

  function switchTrack(next: MemoryTrack): void {
    setTrack(next)
    setName('')
    setBody('')
    setOpened(undefined)
    setLoaded(false)
    setPendingDelete(undefined)
    setHint(undefined)
  }

  async function open(fileName: string): Promise<void> {
    setBusy(true)
    setHint(undefined)
    const result = await readMemory(track, fileName)
    setBusy(false)
    if (result.error !== undefined) {
      // 读不到正文就**不打开编辑器** —— 否则保存会把这条记忆清空（D7）
      setLoaded(false)
      setOpened(undefined)
      setHint(result.error)
      return
    }
    setOpened(result.data.name)
    setName(result.data.name)
    setBody(result.data.body)
    setLoaded(true)
  }

  async function save(): Promise<void> {
    const fileName = name.trim()
    if (fileName === '') {
      setHint('文件名不能为空，例如 conventions.md')
      return
    }
    if (opened !== undefined && opened === fileName && !loaded) {
      setHint('正文还没读到，先点一次条目再保存（否则会清空已有记忆）')
      return
    }
    setBusy(true)
    const feedback = await actFeedback(act, { type: 'saveMemory', track, name: fileName, body })
    setBusy(false)
    setHint(hintOf(feedback))
    if (feedback.ok) {
      setOpened(fileName)
      setLoaded(true)
    }
  }

  async function remove(fileName: string): Promise<void> {
    if (pendingDelete !== fileName) {
      setPendingDelete(fileName)
      return
    }
    setBusy(true)
    const feedback = await actFeedback(act, { type: 'deleteMemory', track, name: fileName })
    setBusy(false)
    setPendingDelete(undefined)
    setHint(hintOf(feedback))
    if (feedback.ok && opened === fileName) {
      setOpened(undefined)
      setName('')
      setBody('')
      setLoaded(false)
    }
  }

  return (
    <div data-auto-team-memory>
      <div data-budget data-over={over || memory?.truncated === true ? 'true' : 'false'}>
        <span data-budget-text>
          预计注入 {injected} / {budget} 字符
        </span>
        {memory?.truncated === true ? <span data-chip>已截断</span> : null}
        {over ? <span data-chip data-chip-kind="overflow">超出预算</span> : null}
      </div>

      <div data-memory-tracks role="tablist">
        <button
          type="button"
          role="tab"
          data-memory-track="project"
          aria-selected={track === 'project'}
          onClick={() => switchTrack('project')}
        >
          项目记忆
        </button>
        <button
          type="button"
          role="tab"
          data-memory-track="public"
          aria-selected={track === 'public'}
          onClick={() => switchTrack('public')}
        >
          公共记忆
        </button>
      </div>

      {files.length === 0 ? (
        <div data-empty data-empty-next>
          该轨还没有记忆文件。下一步：在下方填文件名与正文，保存后成员派发时会按相关度挑选注入。
        </div>
      ) : (
        <ul data-memory-list>
          {files.map((file) => {
            const active = opened === file.name
            const confirming = pendingDelete === file.name
            return (
              <li
                key={file.name}
                data-memory-file
                data-file-name={file.name}
                data-track={file.track}
                data-active={active ? 'true' : 'false'}
              >
                <button
                  type="button"
                  data-memory-open
                  aria-pressed={active}
                  title="读取正文后再编辑（直接写会覆盖整条记忆）"
                  onClick={() => void open(file.name)}
                >
                  {file.name}
                </button>
                <span data-memory-chars>{file.chars} 字符</span>
                <button
                  type="button"
                  data-memory-delete
                  data-confirm={confirming ? 'true' : 'false'}
                  disabled={busy}
                  onClick={() => void remove(file.name)}
                >
                  {confirming ? '确认删除' : '删除'}
                </button>
                {confirming ? (
                  <button
                    type="button"
                    data-memory-delete-cancel
                    onClick={() => setPendingDelete(undefined)}
                  >
                    取消
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <div data-memory-editor>
        <div data-editor-head>
          {opened !== undefined ? (
            <span data-editor-mode="edit">编辑 {opened}（已读取正文 {body.length} 字符）</span>
          ) : (
            <span data-editor-mode="create">新建记忆文件</span>
          )}
        </div>
        <input
          data-memory-name
          placeholder="文件名，如 conventions.md"
          value={name}
          disabled={opened !== undefined && opened === name}
          onChange={(event) => setName(event.target.value)}
        />
        <textarea
          data-memory-body
          placeholder={
            opened !== undefined ? '记忆正文（md）' : '记忆正文（md）—— 先点上面的条目可编辑已有内容'
          }
          rows={8}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <div data-editor-actions>
          <button type="button" data-memory-save disabled={busy} onClick={() => void save()}>
            保存到{track === 'project' ? '项目' : '公共'}记忆
          </button>
          <button
            type="button"
            data-memory-reset
            onClick={() => {
              setOpened(undefined)
              setName('')
              setBody('')
              setLoaded(false)
              setHint(undefined)
            }}
          >
            清空表单
          </button>
        </div>
        {hint !== undefined ? (
          <div data-hint role="status">
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default MemoryTab
