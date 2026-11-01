/**
 * 角色编辑列表 + 技能库（**面板角色页与设置页共用同一份**，DESIGN §3.3 / TECHNICAL §4.5）。
 *
 * 为什么必须共用（本项目历史 bug 族）：如果面板页与设置页各写一套保存链，用户会遇到
 * 「面板里改的顺手、设置里改的不生效」，且同一份角色数据出现两处缓存与两条校验路径。
 * 这里只做**编辑与校验**，保存动作由容器（RolesTab / SettingsPage）用同一个
 * `act({type:'saveRole'})` 发出 —— 本组件不 import api、不发请求。
 *
 * r10 的两处结构变化：
 *  1. **技能成为独立实体**（AC-17~AC-21）：技能列表不再只是角色卡里的复选框，编辑区顶部多一个
 *     技能库（`[data-skill-library]`），每行有来源徽标 / 「已修改」徽标 / 编辑 / 恢复出厂 / 删除。
 *     内置技能只给「恢复出厂」（不可删），用户三源只给「删除」——这条分支由 `ui.ts` 的
 *     `skillRowView()` 纯函数决定（AC-19 的可分辨断言落在那里，组件只消费它的结果）。
 *  2. **技能变更随 `saveRole` 上送**（AC-25 形状冻结）：`onSave(undefined, [mutation])` 表示
 *     「只改技能、不动角色」。这样 `PanelAction` 仍是 15 种、路由仍是 3 条。
 *
 * `density` 只控制字号与按钮形态（`panel` 窄、`page` 宽），**不改行为**。
 */
import * as React from 'react'
import {
  SKILL_BODY_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_TITLE_MAX,
} from '../shared/const.ts'
import type {
  ModelCatalogView,
  Result,
  Role,
  SkillDraft,
  SkillInfo,
  SkillMutation,
  SkillSource,
  SystemSkillInfo,
} from '../shared/types.ts'
import type { SkillBodyPayload } from './api.ts'
import { ModelPicker } from './ModelPicker.tsx'
import { SkillEditDialog, SystemSkillPicker } from './SkillDialogs.tsx'
import { restoreConfirmView, skillRowView, skillSourceLabel } from './ui.ts'

/** 与 `src/host/config.ts` 的 `ROLE_PROMPT_MAX` 逐字一致（client 不能 import host）。 */
const ROLE_PROMPT_MAX = 8000

export interface RoleEditorListProps {
  roles: Role[]
  skills: SkillInfo[]
  density: 'panel' | 'page'
  busy: boolean
  modelCatalog?: ModelCatalogView
  systemSkills?: SystemSkillInfo[]
  systemSkillsReason?: string
  readSkill?: (id: string) => Promise<Result<SkillBodyPayload>>
  onSave: (role: Role | undefined, skills?: SkillMutation[]) => void
  onDelete: (roleId: string) => void
  onRestoreDefaults: () => void
}

function asRole(value: Role | undefined, fallbackId: string): Role {
  const base = value ?? ({ id: fallbackId, name: '', duty: '', skillIds: [], builtin: false, updatedAt: 0 } as Role)
  return {
    ...base,
    skillIds: Array.isArray(base.skillIds) ? [...base.skillIds] : [],
    prompt: typeof base.prompt === 'string' ? base.prompt : '',
  }
}

/** 单张卡片的校验：返回空串 = 通过。 */
function checkRole(role: Role): string {
  if (role.id.trim() === '') return '角色 id 不能为空'
  if (role.name.trim() === '') return '角色名不能为空'
  const prompt = (role.prompt ?? '').trim()
  if (prompt.length > ROLE_PROMPT_MAX) return `提示词最多 ${ROLE_PROMPT_MAX} 字符（当前 ${prompt.length}）`
  const provider = (role.model?.provider ?? '').trim()
  const model = (role.model?.model ?? '').trim()
  if ((provider === '') !== (model === '')) return '默认模型的 provider 与 model 必须同时填写或同时留空'
  return ''
}

/** 技能清单的内容签名：只有真变了才重建本地副本（否则 2s 轮询会冲掉用户的乐观更新）。 */
function signatureOfSkills(skills: SkillInfo[]): string {
  return skills
    .map((skill) => [skill.id, skill.title, skill.description, skill.source, skill.modified].join('|'))
    .join(';')
}

/** 摘掉 YAML frontmatter（导入的 md 自带一份，重复渲染会出现两段）。 */
function stripFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---')) return { meta: {}, body: text }
  const end = normalized.indexOf('\n---', 3)
  if (end < 0) return { meta: {}, body: text }
  const head = normalized.slice(3, end)
  const meta: Record<string, string> = {}
  for (const line of head.split('\n')) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim())
    if (match === null) continue
    meta[match[1]] = match[2].replace(/^["']|["']$/g, '').trim()
  }
  const body = normalized.slice(end + 4).replace(/^\n+/, '')
  return { meta, body: body === '' ? text : body }
}

/** 从导入的 md 猜标题与说明（宽松兜底：猜不出就用文件名，绝不因格式不符拒绝导入）。 */
function guessTitleAndDescription(fileName: string, text: string): { title: string; description: string } {
  const { meta, body } = stripFrontmatter(text)
  const heading = body.split('\n').find((line) => /^#\s+\S/.test(line.trim()))
  const fallbackTitle = fileName.replace(/\.md$/i, '').trim()
  const title = (meta.title ?? (heading !== undefined ? heading.trim().replace(/^#\s+/, '') : fallbackTitle))
    .slice(0, SKILL_TITLE_MAX)
    .trim()
  const firstLine = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('#') && !line.startsWith('```'))
  const description = (meta.description ?? firstLine ?? title).slice(0, SKILL_DESCRIPTION_MAX).trim()
  return { title: title === '' ? fallbackTitle : title, description: description === '' ? title : description }
}

function readFileText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('当前环境不支持读取本地文件'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file)
  })
}

export function RoleEditorList(props: RoleEditorListProps): React.ReactElement {
  const { roles, skills, density, busy } = props
  const [drafts, setDrafts] = React.useState<Record<string, Role>>({})
  const [pendingDelete, setPendingDelete] = React.useState<string | undefined>(undefined)
  const [confirmRestore, setConfirmRestore] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [hint, setHint] = React.useState<string | undefined>(undefined)
  const sequence = React.useRef(0)

  /* ── 技能库本地状态 ─────────────────────────────────────────────────────── */
  const [library, setLibrary] = React.useState<SkillInfo[]>(skills)
  const skillsSignature = signatureOfSkills(skills)
  React.useEffect(() => {
    setLibrary(skills.map((skill) => ({ ...skill })))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖是内容签名，不是数组引用（见上）
  }, [skillsSignature])

  const [menuOpen, setMenuOpen] = React.useState(false)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<
    | { mode: 'edit'; skill: SkillInfo }
    | { mode: 'create'; source: SkillSource; body?: string; title?: string; description?: string }
    | undefined
  >(undefined)
  const [dialogError, setDialogError] = React.useState<string | undefined>(undefined)
  const [skillConfirm, setSkillConfirm] = React.useState<{ op: 'delete' | 'restore'; id: string } | undefined>(undefined)
  const [notice, setNotice] = React.useState<string | undefined>(undefined)
  const importRef = React.useRef<HTMLInputElement | null>(null)
  const [importError, setImportError] = React.useState<string | undefined>(undefined)

  // 快照是唯一真值，但**只在内容真的变了**才重建草稿：store 每 ~2s 轮询会产出新的
  // `roles` 数组，用数组引用当依赖会把用户正在输入的内容每 2 秒清一次（静默丢输入，
  // 比报错更难排查）。签名只取参与渲染与保存的字段。
  const signature = roles
    .map((role) =>
      [
        role.id,
        role.updatedAt,
        role.name,
        role.duty,
        role.prompt ?? '',
        (role.skillIds ?? []).join(','),
        role.model?.provider ?? '',
        role.model?.model ?? '',
      ].join('|'),
    )
    .join(';')

  React.useEffect(() => {
    const next: Record<string, Role> = {}
    for (const role of roles) next[role.id] = asRole(role, role.id)
    setDrafts(next)
    setPendingDelete(undefined)
    setConfirmRestore(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖是内容签名，不是数组引用（见上）
  }, [signature])

  function patch(id: string, change: Partial<Role>): void {
    setDrafts((previous) => {
      const base = asRole(previous[id], id)
      return { ...previous, [id]: { ...base, ...change } }
    })
    setErrors((previous) => (previous[id] === undefined ? previous : { ...previous, [id]: '' }))
  }

  function toggleSkill(id: string, skillId: string): void {
    setDrafts((previous) => {
      const base = asRole(previous[id], id)
      const has = base.skillIds.includes(skillId)
      const skillIds = has ? base.skillIds.filter((item) => item !== skillId) : [...base.skillIds, skillId]
      return { ...previous, [id]: { ...base, skillIds } }
    })
  }

  function save(id: string): void {
    const role = asRole(drafts[id], id)
    const problem = checkRole(role)
    if (problem !== '') {
      setErrors((previous) => ({ ...previous, [id]: problem }))
      return
    }
    const model = role.model
    const normalized: Role = {
      ...role,
      updatedAt: Date.now(),
      model:
        model !== undefined && (model.provider.trim() !== '' || model.model.trim() !== '')
          ? { ...model, provider: model.provider.trim(), model: model.model.trim() }
          : undefined,
    }
    props.onSave(normalized)
    setHint(`已提交「${normalized.name}」`)
  }

  function addRole(): void {
    sequence.current += 1
    const id = `custom-${Date.now().toString(36)}-${sequence.current}`
    setDrafts((previous) => ({
      ...previous,
      [id]: { id, name: '', duty: '', skillIds: [], builtin: false, updatedAt: Date.now(), prompt: '' },
    }))
    setHint(undefined)
  }

  /* ── 技能：保存 / 删除 / 恢复出厂 ───────────────────────────────────────── */

  function submitSkill(draft: SkillDraft): void {
    setDialogError(undefined)
    // 新建时若同名（忽略大小写的标题）已存在：**加后缀**而不是静默覆盖别人的技能
    let title = draft.title
    if (draft.id === undefined) {
      const taken = new Set(library.map((skill) => skill.title.trim().toLowerCase()))
      let copy = 1
      while (taken.has(title.trim().toLowerCase())) {
        copy += 1
        title = `${draft.title}（${copy}）`
      }
    }
    const normalized: SkillDraft = { ...draft, title }
    props.onSave(undefined, [{ op: 'save', skill: normalized }])
    if (draft.id !== undefined) {
      const targetId = draft.id
      setLibrary((previous) =>
        previous.map((skill) =>
          skill.id === targetId
            ? { ...skill, title: normalized.title, description: normalized.description, modified: skill.source === 'builtin' }
            : skill,
        ),
      )
      setNotice(`已提交技能「${normalized.title}」`)
    } else {
      setNotice(`已提交新技能「${normalized.title}」，刷新后可在角色里勾选`)
    }
    setEditing(undefined)
  }

  function removeSkill(skill: SkillInfo): void {
    setSkillConfirm(undefined)
    props.onSave(undefined, [{ op: 'delete', id: skill.id }])
    setLibrary((previous) => previous.filter((item) => item.id !== skill.id))
    const affected = Object.values(drafts).filter((role) => role.skillIds.includes(skill.id)).length
    setNotice(`已删除「${skill.title}」，并从 ${affected} 个角色摘除引用`)
  }

  function restoreSkill(skill: SkillInfo): void {
    setSkillConfirm(undefined)
    props.onSave(undefined, [{ op: 'restoreBuiltin', id: skill.id }])
    setLibrary((previous) =>
      previous.map((item) => (item.id === skill.id ? { ...item, modified: false } : item)),
    )
    setNotice(`已把内置技能「${skill.title}」恢复为出厂正文`)
  }

  function openCreate(source: SkillSource): void {
    setMenuOpen(false)
    setDialogError(undefined)
    setEditing({ mode: 'create', source })
  }

  async function onPickFile(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0]
    // 允许连续导入同一个文件：不清空 value 时第二次 change 不会触发
    event.currentTarget.value = ''
    if (file === undefined) return
    setImportError(undefined)
    try {
      const text = await readFileText(file)
      if (text.trim() === '') {
        setImportError('文件是空的，没有可导入的正文')
        return
      }
      const { body } = stripFrontmatter(text)
      const guess = guessTitleAndDescription(file.name, text)
      setMenuOpen(false)
      setEditing({
        mode: 'create',
        source: 'imported',
        body: body.slice(0, SKILL_BODY_MAX),
        title: guess.title,
        description: guess.description,
      })
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '读取文件失败')
    }
  }

  function importSystemSkills(picks: SystemSkillInfo[]): void {
    setPickerOpen(false)
    if (picks.length === 0) return
    const mutations: SkillMutation[] = picks.map((pick) => ({
      op: 'save',
      skill: {
        title: pick.name,
        description: pick.description === '' ? pick.name : pick.description.slice(0, SKILL_DESCRIPTION_MAX),
        // 正文由宿主按 systemName 现读盘（客户端不搬正文，避免把 20k 字符塞进动作载荷）
        body: '',
        source: 'system',
        systemName: pick.name,
      },
    }))
    props.onSave(undefined, mutations)
    const taken = new Set(library.map((skill) => skill.title.trim().toLowerCase()))
    const optimistic: SkillInfo[] = picks
      .filter((pick) => !taken.has(pick.name.trim().toLowerCase()))
      .map((pick) => ({
        id: pick.name,
        title: pick.name,
        description: pick.description,
        source: 'system' as SkillSource,
        modified: false,
      }))
    setLibrary((previous) => [...previous, ...optimistic])
    setNotice(`已从系统技能库导入 ${picks.length} 条`)
  }

  const ordered = Object.keys(drafts)
    .map((id) => drafts[id])
    // 内置在前（与 host BUILTIN_ROLES 顺序一致），自建在后按 id 稳定排序
    .sort((left, right) => {
      if (left.builtin !== right.builtin) return left.builtin ? -1 : 1
      return left.id.localeCompare(right.id)
    })

  // 来源顺序 内置 → 导入 → 系统 → 手动，组内按标题（AC-18 的稳定展示顺序）
  const sourceOrder: Record<SkillSource, number> = { builtin: 0, imported: 1, system: 2, manual: 3 }
  const orderedSkills = [...library].sort((left, right) => {
    const delta = (sourceOrder[left.source] ?? 9) - (sourceOrder[right.source] ?? 9)
    if (delta !== 0) return delta
    return left.title.localeCompare(right.title)
  })

  const builtinCount = ordered.filter((role) => role.builtin).length
  const customCount = ordered.length - builtinCount
  const restoreView = restoreConfirmView({
    builtinRoles: builtinCount,
    customRoles: customCount,
    userSkills: library.filter((skill) => skill.source !== 'builtin').length,
    builtinSkills: library.filter((skill) => skill.source === 'builtin').length,
  })

  return (
    <section data-auto-team-role-editor data-density={density} data-busy={busy ? 'true' : 'false'}>
      {/* ── 技能库（r10 新增；三入口 + 四来源 + 可编辑可恢复出厂） ── */}
      <div data-skill-library>
        <div data-skills-head>
          <span data-skills-count>
            技能库 {library.length} 条（内置 {library.filter((skill) => skill.source === 'builtin').length}）
          </span>
          <button
            type="button"
            data-skill-add
            aria-expanded={menuOpen ? 'true' : 'false'}
            disabled={busy}
            onClick={() => setMenuOpen((previous) => !previous)}
          >
            ＋ 添加技能
          </button>
        </div>

        {menuOpen ? (
          <div data-skill-add-menu role="menu" aria-label="添加技能">
            <button type="button" data-skill-add-import disabled={busy} onClick={() => importRef.current?.click()}>
              导入 .md
            </button>
            <button type="button" data-skill-add-system disabled={busy} onClick={() => {
              setMenuOpen(false)
              setPickerOpen(true)
            }}>
              系统技能
            </button>
            <button type="button" data-skill-add-manual disabled={busy} onClick={() => openCreate('manual')}>
              手动新建
            </button>
          </div>
        ) : null}

        <input
          ref={importRef}
          type="file"
          data-skill-import-input
          accept=".md,text/markdown"
          style={{ display: 'none' }}
          onChange={(event) => void onPickFile(event)}
        />

        {importError === undefined ? null : (
          <p data-skill-import-error role="alert">
            {importError}
          </p>
        )}
        {notice === undefined ? null : (
          <span data-skill-notice role="status">
            {notice}
          </span>
        )}

        {orderedSkills.length === 0 ? (
          <div data-role-skill-empty>
            <p>还没有任何技能。</p>
            <p data-empty-next>
              点「＋ 添加技能」可从本地 md 导入、从宿主系统技能库选择，或手动新建。
            </p>
            <p>内置技能点「一键恢复默认角色」即可写回。</p>
          </div>
        ) : (
          <div data-skill-list>
            {orderedSkills.map((skill) => {
              const view = skillRowView(skill, false)
              const confirming = skillConfirm?.id === skill.id ? skillConfirm.op : undefined
              return (
                <div
                  key={skill.id}
                  data-skill-row
                  data-skill-source={skill.source}
                  data-skill-modified={view.modifiedLabel === null ? 'false' : 'true'}
                >
                  <div data-skill-row-main>
                    <span data-skill-title title={skill.title}>
                      {skill.title}
                    </span>
                    <span data-skill-badge data-source={skill.source} data-tone={view.sourceTone}>
                      {skillSourceLabel(skill.source)}
                    </span>
                    {view.modifiedLabel === null ? null : (
                      <span data-skill-modified title="正文与本机出厂正文不同">
                        {view.modifiedLabel}
                      </span>
                    )}
                  </div>
                  <div data-skill-row-sub>
                    <span data-skill-description title={skill.description}>
                      {skill.description}
                    </span>
                    <button
                      type="button"
                      data-skill-edit
                      disabled={busy}
                      onClick={() => {
                        setDialogError(undefined)
                        setEditing({ mode: 'edit', skill })
                      }}
                    >
                      编辑
                    </button>
                    {view.actions.restore === null ? null : (
                      <button
                        type="button"
                        data-skill-restore
                        disabled={busy}
                        onClick={() => setSkillConfirm(confirming === 'restore' ? undefined : { op: 'restore', id: skill.id })}
                      >
                        {view.actions.restore}
                      </button>
                    )}
                    {view.actions.delete === null ? null : (
                      <button
                        type="button"
                        data-skill-delete
                        disabled={busy}
                        onClick={() => setSkillConfirm(confirming === 'delete' ? undefined : { op: 'delete', id: skill.id })}
                      >
                        {view.actions.delete}
                      </button>
                    )}
                  </div>

                  {confirming === 'delete' ? (
                    <div data-skill-delete-confirm role="alert">
                      删除「{skill.title}」后无法恢复，会同时从引用它的角色里摘除。
                      <button type="button" data-skill-delete-ok disabled={busy} onClick={() => removeSkill(skill)}>
                        确认删除
                      </button>
                      <button type="button" data-skill-delete-cancel disabled={busy} onClick={() => setSkillConfirm(undefined)}>
                        取消
                      </button>
                    </div>
                  ) : null}
                  {confirming === 'restore' ? (
                    <div data-skill-restore-confirm role="alert">
                      恢复为出厂正文？你对该技能的修改会丢失。
                      <button type="button" data-skill-restore-ok disabled={busy} onClick={() => restoreSkill(skill)}>
                        恢复出厂
                      </button>
                      <button type="button" data-skill-restore-cancel disabled={busy} onClick={() => setSkillConfirm(undefined)}>
                        取消
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div data-roles-head>
        <span data-roles-count>
          角色 {ordered.length}（内置 {builtinCount}）
        </span>
        <button type="button" data-role-add onClick={addRole} disabled={busy}>
          新增角色
        </button>
      </div>

      {ordered.length === 0 ? (
        <div data-empty>
          <p>还没有任何角色。</p>
          <p data-empty-next>点「新增角色」建一个，或点「恢复默认」写回内置角色。</p>
        </div>
      ) : null}

      <div data-role-list>
        {ordered.map((role) => {
          const problem = errors[role.id] ?? ''
          const confirming = pendingDelete === role.id
          const selected = role.skillIds.length
          return (
            <article
              key={role.id}
              data-role-card
              data-role-id={role.id}
              data-role-builtin={role.builtin ? 'true' : 'false'}
              data-error-state={problem !== '' ? 'true' : 'false'}
            >
              <header data-role-card-head>
                <span data-role-card-name>{role.name.trim() === '' ? '（未命名角色）' : role.name}</span>
                <span data-role-origin>{role.builtin ? '内置' : '自建'}</span>
                {role.builtin ? null : (
                  <span data-role-actions>
                    <button
                      type="button"
                      data-role-delete
                      disabled={busy}
                      onClick={() => setPendingDelete(confirming ? undefined : role.id)}
                    >
                      {confirming ? '确认删除' : '删除'}
                    </button>
                    {confirming ? (
                      <button
                        type="button"
                        data-role-delete-cancel
                        disabled={busy}
                        onClick={() => setPendingDelete(undefined)}
                      >
                        取消
                      </button>
                    ) : null}
                  </span>
                )}
              </header>

              {confirming ? (
                <div data-role-delete-confirm role="alert">
                  删除「{role.name}」后无法恢复（可重新新建）。
                  <button
                    type="button"
                    data-role-delete-ok
                    disabled={busy}
                    onClick={() => {
                      setPendingDelete(undefined)
                      props.onDelete(role.id)
                    }}
                  >
                    确认
                  </button>
                </div>
              ) : null}

              <label data-role-field data-role-field-name>
                <span data-role-field-label>名称</span>
                <input
                  data-role-name-input
                  value={role.name}
                  disabled={busy}
                  onChange={(event) => patch(role.id, { name: event.target.value })}
                />
              </label>

              <label data-role-field data-role-field-duty>
                <span data-role-field-label>描述</span>
                <input
                  data-role-duty-input
                  value={role.duty}
                  disabled={busy}
                  onChange={(event) => patch(role.id, { duty: event.target.value })}
                />
              </label>

              <label data-role-field data-role-field-prompt>
                <span data-role-field-label>提示词</span>
                <textarea
                  data-role-prompt-input
                  // 固定 96px 内滚（DESIGN §0.2）：8000 字符上限下 auto-grow 会把卡片撑到上万像素
                  rows={4}
                  value={role.prompt ?? ''}
                  disabled={busy}
                  onChange={(event) => patch(role.id, { prompt: event.target.value })}
                />
              </label>

              <div data-role-field data-role-field-skills>
                <span data-role-field-label>
                  技能 已选 {selected}/{library.length}
                </span>
                <span data-role-skill-list>
                  {library.length === 0 ? <span data-role-skill-empty>（技能库为空）</span> : null}
                  {orderedSkills.map((skill) => {
                    const checked = role.skillIds.includes(skill.id)
                    return (
                      <label
                        key={skill.id}
                        data-role-skill
                        data-checked={checked ? 'true' : 'false'}
                        title={skill.description}
                      >
                        <input
                          type="checkbox"
                          data-role-skill-input={skill.id}
                          checked={checked}
                          disabled={busy}
                          aria-label={skillRowView(skill, checked).checkboxLabel}
                          onChange={() => toggleSkill(role.id, skill.id)}
                        />
                        <span data-role-skill-title>{skill.title}</span>
                      </label>
                    )
                  })}
                </span>
              </div>

              <div data-role-field data-role-field-model>
                <span data-role-field-label>默认模型</span>
                <ModelPicker
                  value={role.model}
                  catalog={props.modelCatalog}
                  busy={busy}
                  onChange={(model) => patch(role.id, { model })}
                />
                <span data-role-model-hint>留空 = 跟随会话默认</span>
              </div>

              {problem !== '' ? (
                <div data-role-error role="alert">
                  {problem}
                </div>
              ) : null}

              <div data-role-card-actions>
                <button type="button" data-role-save disabled={busy} onClick={() => save(role.id)}>
                  保存
                </button>
                <button
                  type="button"
                  data-role-reset
                  disabled={busy}
                  onClick={() => {
                    const source = roles.find((item) => item.id === role.id)
                    setDrafts((previous) => ({ ...previous, [role.id]: asRole(source, role.id) }))
                    setErrors((previous) => ({ ...previous, [role.id]: '' }))
                  }}
                >
                  还原
                </button>
              </div>
            </article>
          )
        })}
      </div>

      <div data-roles-foot>
        <button
          type="button"
          data-roles-restore
          disabled={busy}
          onClick={() => setConfirmRestore(true)}
        >
          一键恢复默认角色
        </button>
        {hint === undefined ? null : (
          <span data-hint role="status">
            {hint}
          </span>
        )}
      </div>

      {/* 恢复默认改成对话框（r7 是行内确认）：一次性讲清范围，数字全部来自快照 */}
      {confirmRestore ? (
        <div data-roles-restore-backdrop data-dialog="restore-defaults" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setConfirmRestore(false)
        }}>
          <div data-roles-restore-confirm role="dialog" aria-modal="true" aria-label={restoreView.title}>
            <strong data-restore-title>{restoreView.title}</strong>
            {restoreView.lines.map((line) => (
              <p key={line} data-restore-line>
                {line}
              </p>
            ))}
            <div data-restore-actions>
              <button type="button" data-roles-restore-cancel disabled={busy} onClick={() => setConfirmRestore(false)}>
                取消
              </button>
              <button
                type="button"
                data-roles-restore-ok
                data-confirm-tone="warn"
                disabled={busy}
                aria-busy={busy ? 'true' : 'false'}
                onClick={() => {
                  setConfirmRestore(false)
                  props.onRestoreDefaults()
                }}
              >
                {busy ? '恢复中…' : restoreView.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editing === undefined ? null : editing.mode === 'edit' ? (
        <SkillEditDialog
          skill={editing.skill}
          readSkill={props.readSkill}
          busy={busy}
          error={dialogError}
          onClose={() => setEditing(undefined)}
          onSave={submitSkill}
          onRestoreBuiltin={editing.skill.source === 'builtin' ? (id) => {
            setEditing(undefined)
            props.onSave(undefined, [{ op: 'restoreBuiltin', id }])
            setNotice(`已把内置技能「${editing.skill.title}」恢复为出厂正文`)
          } : undefined}
        />
      ) : (
        <SkillEditDialog
          source={editing.source}
          initialBody={editing.body}
          initialTitle={editing.title}
          initialDescription={editing.description}
          busy={busy}
          error={dialogError}
          onClose={() => setEditing(undefined)}
          onSave={submitSkill}
        />
      )}

      {pickerOpen ? (
        <SystemSkillPicker
          skills={props.systemSkills ?? []}
          reason={props.systemSkillsReason}
          busy={busy}
          onClose={() => setPickerOpen(false)}
          onImport={importSystemSkills}
        />
      ) : null}
    </section>
  )
}

export default RoleEditorList
