/**
 * 技能层三个模态中的两个（DESIGN §2.5 M5 / M6）：
 *   - `SkillEditDialog`：新建 / 编辑一条技能（正文**按需**读取）；
 *   - `SystemSkillPicker`：从宿主系统技能库（`~/.agents/skills`）多选导入。
 *
 * 为什么这两个合并成一个文件（TECHNICAL §5.4）：它们同属一类模态（Esc + 焦点回归 +
 * 提交中去抖），写两遍焦点陷阱必然有一份漏了 Esc 或漏了焦点归还 —— 本项目历史上
 * 「弹层关掉焦点丢到 body」出现过两次，所以只写一遍 shell，两个弹层共用。
 *
 * 关于 createPortal：技术方案写的是「全部 createPortal 到 body」，但本仓没有 react-dom
 * （node_modules 里只有 react，peerDependencies 只声明 react，tsdown external 只列 'react'），
 * import 它直接 TS2307。这里改用「固定定位覆盖层」：`[data-skill-dialog-backdrop]` 是
 * `position: fixed; inset: 0`，fixed 定位不受祖先 `overflow:hidden` 裁剪，视觉与交互等价，
 * 且不引新依赖。宿主自绘标题栏的 `-webkit-app-region: drag` 风险仍在（真机需人工点一次）。
 *
 * 三条硬约定：
 *  1. **正文绝不给空 textarea**：打开时先骨架（3 行呼吸条），`readSkill` 回来才换成正文；
 *     失败给「正文读取失败：<原因>」+ 重试按钮，**不**降级成空框（空框保存 = 静默清空正文）。
 *  2. **保存非乐观**：`busy` 期间按钮显示「保存中…」并 disabled，弹层**不关**；
 *     失败把原因显示在 `[data-dialog-error]` 里，用户输入一个字都不丢。
 *  3. **长度上限与宿主同一个数**：`SKILL_*_MAX` 来自 `src/shared/const.ts`（不许在这里再写字面量），
 *     否则会出现「界面放行、宿主拒绝」的错位。
 */
import * as React from 'react'
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_TITLE_MAX } from '../shared/const.ts'
import type { Result, SkillDraft, SkillInfo, SkillSource, SystemSkillInfo } from '../shared/types.ts'
import type { SkillBodyPayload } from './api.ts'
import { skillSourceLabel } from './ui.ts'

/* ─────────────────────────────── 模态 shell ─────────────────────────────── */

/**
 * 模态的公共外壳：Esc 关闭、打开时把焦点放进面板、关闭后还给触发元素。
 *
 * 为什么用固定定位覆盖层而不是 portal（本项目踩过）：角色卡在 `overflow:hidden` 的滚动容器里，
 * 内联绝对定位弹层会被裁掉；fixed 元素不受该裁剪影响。本仓没有 react-dom，故不做 portal，
 * 宿主自绘标题栏的 `-webkit-app-region: drag` 风险留在真机清单里（AC-12~AC-15 同批验）。
 */
function useModalShell(onClose: () => void, busy: boolean): {
  panelRef: React.RefObject<HTMLDivElement>
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
} {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const previousFocus = React.useRef<Element | null>(null)

  React.useEffect(() => {
    const active = typeof document === 'undefined' ? null : document.activeElement
    previousFocus.current = active
    const target = panelRef.current
    if (target !== null && typeof target.focus === 'function') target.focus()
    return () => {
      const previous = previousFocus.current
      if (previous !== null && previous instanceof HTMLElement && typeof previous.focus === 'function') {
        previous.focus()
      }
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // 提交中不响应 Esc：请求已经在飞，关掉弹层会让用户以为没保存
      if (busy) return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  return {
    panelRef,
    onKeyDown: (event) => {
      if (event.key !== 'Escape') return
      if (busy) return
      event.stopPropagation()
      onClose()
    },
  }
}

/* ───────────────────────────── 技能编辑弹层（M5） ───────────────────────────── */

export interface SkillEditDialogProps {
  /** 被编辑的技能；`undefined` = 新建。 */
  skill?: SkillInfo
  /** 新建时的初始来源（导入 md → 'imported'，手动新建 → 'manual'）。 */
  source?: SkillSource
  /** 导入 md 时带进来的初始正文（导入入口已经有正文，不必再读盘）。 */
  initialBody?: string
  /** 新建时的初始标题 / 说明（导入 md 时取文件名与首个标题）。 */
  initialTitle?: string
  initialDescription?: string
  /** 正文读取口（宿主 memory 路由的 `track=skill`）；缺省 = 宿主没接这能力。 */
  readSkill?: (id: string) => Promise<Result<SkillBodyPayload>>
  /** 写盘在飞（由父组件的 act 驱动，非乐观）。 */
  busy: boolean
  /** 父组件传下来的失败原因（保存被宿主拒绝时显示在弹层里，弹层不关）。 */
  error?: string
  onClose: () => void
  onSave: (draft: SkillDraft) => void
  /** 内置技能才给：把正文恢复为出厂（保存之外的另一条路径）。 */
  onRestoreBuiltin?: (id: string) => void
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export function SkillEditDialog(props: SkillEditDialogProps): React.ReactElement {
  const editing = props.skill !== undefined
  const builtin = props.skill?.source === 'builtin'
  const source: SkillSource = props.skill?.source ?? props.source ?? 'manual'

  const [title, setTitle] = React.useState(props.skill?.title ?? props.initialTitle ?? '')
  const [description, setDescription] = React.useState(props.skill?.description ?? props.initialDescription ?? '')
  const [body, setBody] = React.useState(editing ? '' : (props.initialBody ?? ''))
  const [loadState, setLoadState] = React.useState<LoadState>(editing ? 'loading' : 'ready')
  const [loadError, setLoadError] = React.useState<string | undefined>(undefined)
  const [localError, setLocalError] = React.useState<string | undefined>(undefined)
  const shell = useModalShell(props.onClose, props.busy)

  const loadBody = React.useCallback(async () => {
    const skill = props.skill
    if (skill === undefined) return
    if (props.readSkill === undefined) {
      // 宿主没给读取口：如实说明，**不**给一个能保存的空正文框
      setLoadState('error')
      setLoadError('宿主未提供技能正文读取接口')
      return
    }
    setLoadState('loading')
    setLoadError(undefined)
    const result = await props.readSkill(skill.id)
    if (result.error !== undefined) {
      setLoadState('error')
      setLoadError(result.error)
      return
    }
    setBody(result.data.body)
    setLoadState('ready')
  }, [props.skill, props.readSkill])

  // 打开即读正文（按需：列表只下发 id/标题/说明，正文不投影）
  React.useEffect(() => {
    if (!editing) return
    void loadBody()
    // 只在打开/切换技能时读一次；readSkill 用 ref 语义外的依赖会重复触发（父组件每次渲染都换函数）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.skill?.id])

  function submit(): void {
    const trimmedTitle = title.trim()
    const trimmedDescription = description.trim()
    const problem =
      trimmedTitle === ''
        ? '技能名称不能为空'
        : trimmedTitle.length > SKILL_TITLE_MAX
          ? `技能名称最多 ${SKILL_TITLE_MAX} 个字符`
          : trimmedDescription === ''
            ? '技能说明不能为空'
            : trimmedDescription.length > SKILL_DESCRIPTION_MAX
              ? `技能说明最多 ${SKILL_DESCRIPTION_MAX} 个字符`
              : body.trim() === ''
                ? '技能正文不能为空'
                : body.length > SKILL_BODY_MAX
                  ? `技能正文最多 ${SKILL_BODY_MAX} 个字符（当前 ${body.length}）`
                  : undefined
    if (problem !== undefined) {
      setLocalError(problem)
      return
    }
    setLocalError(undefined)
    const draft: SkillDraft = {
      title: trimmedTitle,
      description: trimmedDescription,
      body,
      source,
    }
    if (props.skill !== undefined) draft.id = props.skill.id
    if (source === 'system' && props.skill !== undefined) draft.systemName = props.skill.id
    props.onSave(draft)
  }

  const shownError = localError ?? props.error

  const dialog = (
    <div data-skill-dialog-backdrop data-dialog="skill-edit" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !props.busy) props.onClose()
    }}>
      <div
        ref={shell.panelRef}
        data-skill-dialog
        role="dialog"
        aria-modal="true"
        aria-label={editing ? `编辑技能：${props.skill?.title ?? ''}` : '新建技能'}
        tabIndex={-1}
        onKeyDown={shell.onKeyDown}
      >
        <div data-dialog-head>
          <strong data-dialog-title>{editing ? `编辑技能：${props.skill?.title ?? ''}` : '新建技能'}</strong>
          <span data-dialog-badge data-source={source}>
            {skillSourceLabel(source)}
          </span>
          <button type="button" data-dialog-close aria-label="关闭" disabled={props.busy} onClick={props.onClose}>
            ×
          </button>
        </div>

        {builtin ? (
          <p data-skill-builtin-hint>
            内置技能：保存后写在本机副本，不改插件包内文件。
          </p>
        ) : null}

        <label data-dialog-field>
          <span data-dialog-label>名称</span>
          <input
            data-skill-title-input
            aria-label="技能名称"
            value={title}
            maxLength={SKILL_TITLE_MAX}
            disabled={props.busy}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>

        <label data-dialog-field>
          <span data-dialog-label>说明</span>
          <input
            data-skill-description-input
            aria-label="技能说明"
            value={description}
            maxLength={SKILL_DESCRIPTION_MAX}
            disabled={props.busy}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
        </label>

        <div data-dialog-field data-dialog-field-body>
          <span data-dialog-label>正文</span>
          {loadState === 'loading' ? (
            <div data-skill-body-skeleton aria-busy="true" aria-label="正在读取技能正文">
              <span />
              <span />
              <span />
            </div>
          ) : loadState === 'error' ? (
            <div data-skill-body-error role="alert">
              <p>正文读取失败：{loadError ?? '未知原因'}</p>
              <button type="button" data-skill-body-retry onClick={() => void loadBody()}>
                重试
              </button>
            </div>
          ) : (
            <textarea
              data-skill-body-input
              aria-label="技能正文"
              value={body}
              disabled={props.busy}
              onChange={(event) => setBody(event.currentTarget.value)}
            />
          )}
          {loadState === 'ready' ? (
            <span data-skill-body-count data-over-limit={body.length > SKILL_BODY_MAX ? 'true' : 'false'}>
              {body.length}/{SKILL_BODY_MAX}
            </span>
          ) : null}
        </div>

        {shownError === undefined ? null : (
          <p data-dialog-error role="alert">
            {shownError}
          </p>
        )}

        <div data-dialog-actions>
          {builtin && props.skill !== undefined && props.onRestoreBuiltin !== undefined ? (
            <button
              type="button"
              data-skill-restore-in-dialog
              disabled={props.busy}
              onClick={() => props.onRestoreBuiltin!(props.skill!.id)}
            >
              恢复出厂
            </button>
          ) : null}
          <span data-dialog-actions-spacer />
          <button type="button" data-dialog-cancel disabled={props.busy} onClick={props.onClose}>
            取消
          </button>
          <button
            type="button"
            data-dialog-save
            data-primary="true"
            disabled={props.busy || loadState !== 'ready'}
            aria-busy={props.busy ? 'true' : 'false'}
            onClick={submit}
          >
            {props.busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )

  return <>{dialog}</>
}

/* ───────────────────────── 系统技能多选弹层（M6） ───────────────────────── */

export interface SystemSkillPickerProps {
  /** 宿主系统技能库清单（快照字段）。 */
  skills: SystemSkillInfo[]
  /** 宿主给的降级原因（目录缺失 / 扫描失败），有就原样显示。 */
  reason?: string
  busy: boolean
  error?: string
  onClose: () => void
  /** 导入所选：只传名字，正文由宿主按 `systemName` 现读盘（客户端不搬正文）。 */
  onImport: (picks: SystemSkillInfo[]) => void
}

export function SystemSkillPicker(props: SystemSkillPickerProps): React.ReactElement {
  const [keyword, setKeyword] = React.useState('')
  const [picked, setPicked] = React.useState<string[]>([])
  const shell = useModalShell(props.onClose, props.busy)

  const list = props.skills ?? []
  const visible = list.filter((skill) => {
    if (keyword === '') return true
    const haystack = `${skill.name} ${skill.description}`.toLowerCase()
    return haystack.includes(keyword.toLowerCase())
  })

  const empty = list.length === 0
  const emptyReason = (props.reason ?? '').trim()

  function toggle(name: string): void {
    setPicked((previous) =>
      previous.includes(name) ? previous.filter((item) => item !== name) : [...previous, name],
    )
  }

  function submit(): void {
    if (picked.length === 0) return
    const chosen = list.filter((skill) => picked.includes(skill.name))
    props.onImport(chosen)
  }

  const dialog = (
    <div data-skill-dialog-backdrop data-dialog="system-skills" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !props.busy) props.onClose()
    }}>
      <div
        ref={shell.panelRef}
        data-skill-dialog
        data-dialog-size="wide"
        role="dialog"
        aria-modal="true"
        aria-label="从系统技能库选择"
        tabIndex={-1}
        onKeyDown={shell.onKeyDown}
      >
        <div data-dialog-head>
          <strong data-dialog-title>从系统技能库选择</strong>
          <span data-skill-picker-count>已选 {picked.length} 条</span>
          <button type="button" data-dialog-close aria-label="关闭" disabled={props.busy} onClick={props.onClose}>
            ×
          </button>
        </div>

        <div data-dialog-field>
          <input
            data-skill-picker-search
            type="search"
            aria-label="搜索系统技能"
            placeholder="搜索系统技能"
            value={keyword}
            disabled={props.busy}
            onChange={(event) => setKeyword(event.currentTarget.value)}
          />
        </div>

        {empty ? (
          <div data-skill-picker-empty>
            <p>本机没有可用系统技能。</p>
            <p>
              {emptyReason === '' ? '宿主系统技能库（~/.agents/skills）里没有可读的 SKILL.md。' : emptyReason}
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div data-skill-picker-empty>没有匹配「{keyword}」的系统技能。</div>
        ) : (
          <div data-skill-picker-list role="group" aria-label="系统技能">
            {visible.map((skill) => {
              const checked = picked.includes(skill.name)
              return (
                <label key={skill.name} data-skill-picker-row data-checked={checked ? 'true' : 'false'}>
                  <input
                    type="checkbox"
                    data-skill-picker-input={skill.name}
                    checked={checked}
                    disabled={props.busy}
                    aria-label={`选择系统技能：${skill.name}`}
                    onChange={() => toggle(skill.name)}
                  />
                  <span data-skill-picker-name>{skill.name}</span>
                  <span data-skill-picker-desc>{skill.description}</span>
                </label>
              )
            })}
          </div>
        )}

        {props.error === undefined ? null : (
          <p data-dialog-error role="alert">
            {props.error}
          </p>
        )}

        <div data-dialog-actions>
          <span data-dialog-actions-spacer />
          <button type="button" data-dialog-cancel disabled={props.busy} onClick={props.onClose}>
            取消
          </button>
          <button
            type="button"
            data-dialog-save
            data-primary="true"
            disabled={props.busy || picked.length === 0}
            aria-busy={props.busy ? 'true' : 'false'}
            onClick={submit}
          >
            {props.busy ? '导入中…' : '导入所选'}
          </button>
        </div>
      </div>
    </div>
  )

  return <>{dialog}</>
}

export default SkillEditDialog
