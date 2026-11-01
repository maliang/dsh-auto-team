/**
 * 角色编辑列表（**面板角色页与设置页共用同一份**，DESIGN §3.3 / TECHNICAL §4.5）。
 *
 * 为什么必须共用（本项目历史 bug 族）：如果面板页与设置页各写一套保存链，用户会遇到
 * 「面板里改的顺手、设置里改的不生效」，且同一份角色数据出现两处缓存与两条校验路径。
 * 这里只做**编辑与校验**，保存动作由容器（RolesTab / SettingsPage）用同一个
 * `act({type:'saveRole'})` 发出 —— 本组件不 import api、不发请求。
 *
 * `density` 只控制字号与按钮形态（`panel` 窄、`page` 宽），**不改行为**。
 * 内置角色**没有删除按钮**（不是禁用：渲染出来就有"可以删"的错觉，DESIGN §0.8-5）。
 *
 * 校验在这里单点做（与 host `roles/repo.ts` 的规则逐条对齐，红字文案由本组件产出）：
 *   - id/name 非空；name 去空白后非空；
 *   - 提示词 ≤ 8000 字符（host `ROLE_PROMPT_MAX`；client 不能 import host，故此处写一份并注释）；
 *   - 模型 provider/model 必须同时给或同时空（半截路由会被 host 拒绝）。
 */
import * as React from 'react'
import type { Role, SkillInfo } from '../shared/types.ts'

/** 与 `src/host/config.ts` 的 `ROLE_PROMPT_MAX` 逐字一致（client 不能 import host）。 */
const ROLE_PROMPT_MAX = 8000

export interface RoleEditorListProps {
  roles: Role[]
  skills: SkillInfo[]
  density: 'panel' | 'page'
  busy: boolean
  onSave: (role: Role) => void
  onDelete: (id: string) => void
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

export function RoleEditorList(props: RoleEditorListProps): React.ReactElement {
  const { roles, skills, density, busy } = props
  const [drafts, setDrafts] = React.useState<Record<string, Role>>({})
  const [pendingDelete, setPendingDelete] = React.useState<string | undefined>(undefined)
  const [confirmRestore, setConfirmRestore] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [hint, setHint] = React.useState<string | undefined>(undefined)
  const sequence = React.useRef(0)

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

  function patchModel(id: string, field: 'provider' | 'model', value: string): void {
    setDrafts((previous) => {
      const base = asRole(previous[id], id)
      const model = { ...(base.model ?? { provider: '', model: '' }), [field]: value }
      return { ...previous, [id]: { ...base, model } }
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

  const ordered = Object.keys(drafts)
    .map((id) => drafts[id])
    // 内置在前（与 host BUILTIN_ROLES 顺序一致），自建在后按 id 稳定排序
    .sort((left, right) => {
      if (left.builtin !== right.builtin) return left.builtin ? -1 : 1
      return left.id.localeCompare(right.id)
    })

  return (
    <section data-auto-team-role-editor data-density={density} data-busy={busy ? 'true' : 'false'}>
      <div data-roles-head>
        <span data-roles-count>
          角色 {ordered.length}（内置 {ordered.filter((role) => role.builtin).length}）
        </span>
        <button type="button" data-role-add onClick={addRole} disabled={busy}>
          新增角色
        </button>
      </div>

      {ordered.length === 0 ? (
        <div data-empty>
          <p>还没有任何角色。</p>
          <p data-empty-next>点「新增角色」建一个，或点「一键恢复默认角色」写回内置 6 个。</p>
        </div>
      ) : null}

      <div data-role-list>
        {ordered.map((role) => {
          const problem = errors[role.id] ?? ''
          const confirming = pendingDelete === role.id
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
                <span data-role-field-label>技能</span>
                <span data-role-skill-list>
                  {skills.length === 0 ? (
                    <span data-role-skill-empty>（宿主未提供技能清单）</span>
                  ) : null}
                  {skills.map((skill) => {
                    const checked = role.skillIds.includes(skill.id)
                    return (
                      <label key={skill.id} data-role-skill data-checked={checked ? 'true' : 'false'} title={skill.description}>
                        <input
                          type="checkbox"
                          data-role-skill-input={skill.id}
                          checked={checked}
                          disabled={busy}
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
                <input
                  data-role-model-provider
                  placeholder="provider"
                  value={role.model?.provider ?? ''}
                  disabled={busy}
                  onChange={(event) => patchModel(role.id, 'provider', event.target.value)}
                />
                <input
                  data-role-model-name
                  placeholder="model"
                  value={role.model?.model ?? ''}
                  disabled={busy}
                  onChange={(event) => patchModel(role.id, 'model', event.target.value)}
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
        {confirmRestore ? (
          <span data-roles-restore-confirm role="alert">
            只把 6 个内置角色恢复为出厂定义；你自建的 {ordered.filter((role) => !role.builtin).length} 个角色不会被删除。
            <button
              type="button"
              data-roles-restore-ok
              disabled={busy}
              onClick={() => {
                setConfirmRestore(false)
                props.onRestoreDefaults()
              }}
            >
              恢复默认
            </button>
            <button type="button" data-roles-restore-cancel disabled={busy} onClick={() => setConfirmRestore(false)}>
              取消
            </button>
          </span>
        ) : (
          <button
            type="button"
            data-roles-restore
            disabled={busy}
            onClick={() => setConfirmRestore(true)}
          >
            一键恢复默认角色
          </button>
        )}
        {hint === undefined ? null : (
          <span data-hint role="status">
            {hint}
          </span>
        )}
      </div>
    </section>
  )
}

export default RoleEditorList
