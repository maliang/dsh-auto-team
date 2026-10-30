/**
 * 角色页：内置角色 + 自建/修改；每角色可指定模型（provider / model / reasoningEffort）。
 *
 * 展示纪律（AC-22）：
 *  - 模型路由**单独占一行、等宽、不截断**，与宿主回报逐字一致；
 *  - 宿主 `SpawnTeammateRequest` 只有 `provider`、没有 `model`（TECHNICAL §14 限制 L1），
 *    所以「已配置」不等于「已生效」：无审计或审计为 unverified 时**显式标「未下发」**，
 *    绝不假装生效、也绝不静默退回队长模型。
 *  - 内置角色可改不可删；删除一律两步确认（误删角色会连带影响既有任务的重新派发）。
 */
import * as React from 'react'
import type { TabProps } from '../Panel.tsx'
import type { Role, RoleModelRoute } from '../../shared/types.ts'
import { actFeedback, formatModelRoute, hintOf, routeAuditFor, routeTextOf, viewExtras } from '../viewmodel.ts'

const NEW_ROLE: Role = { id: '', name: '', duty: '', skillIds: [], builtin: false, updatedAt: 0 }

export function RolesTab(props: TabProps): React.ReactElement {
  const { snapshot, act } = props
  const roles = snapshot?.roles ?? []
  const extras = viewExtras(snapshot)
  const [editing, setEditing] = React.useState<Role | undefined>(undefined)
  const [pendingDelete, setPendingDelete] = React.useState<string | undefined>(undefined)
  const [hint, setHint] = React.useState<string | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)

  function edit(role: Role): void {
    setEditing({ ...role, skillIds: [...role.skillIds] })
    setHint(undefined)
    setPendingDelete(undefined)
  }

  function patch(next: Partial<Role>): void {
    setEditing((current) => (current === undefined ? current : { ...current, ...next }))
  }

  function patchModel(next: Partial<RoleModelRoute>): void {
    setEditing((current) => {
      if (current === undefined) return current
      const base: RoleModelRoute = current.model ?? { provider: '', model: '' }
      return { ...current, model: { ...base, ...next } }
    })
  }

  async function save(): Promise<void> {
    if (editing === undefined) return
    const provider = (editing.model?.provider ?? '').trim()
    const model = (editing.model?.model ?? '').trim()
    // 要么都填要么都不填：只填一半无从判断用户想要哪个模型，宁可当场退回
    if ((provider === '') !== (model === '')) {
      setHint('provider 与 model 要么都填、要么都留空（留空=会话默认模型）')
      return
    }
    const next: Role = { ...editing, updatedAt: Date.now() }
    if (provider === '' && model === '') delete next.model
    else next.model = { provider, model, ...(editing.model?.reasoningEffort !== undefined ? { reasoningEffort: editing.model.reasoningEffort } : {}) }
    setBusy(true)
    const feedback = await actFeedback(act, { type: 'saveRole', role: next })
    setBusy(false)
    setHint(hintOf(feedback))
    if (feedback.ok) setEditing(undefined)
  }

  async function remove(roleId: string): Promise<void> {
    if (pendingDelete !== roleId) {
      setPendingDelete(roleId)
      return
    }
    setBusy(true)
    const feedback = await actFeedback(act, { type: 'deleteRole', roleId })
    setBusy(false)
    setPendingDelete(undefined)
    setHint(hintOf(feedback))
  }

  return (
    <div data-auto-team-roles>
      <div data-roles-head>
        <button type="button" data-role-new onClick={() => edit({ ...NEW_ROLE })}>
          新建角色
        </button>
        <span data-roles-meta>
          共 {roles.length} 个角色（内置 {roles.filter((role) => role.builtin).length} 个，可改不可删）
        </span>
      </div>

      {hint !== undefined ? (
        <div data-hint role="status">
          {hint}
        </div>
      ) : null}

      {roles.length === 0 ? (
        <div data-empty data-empty-next>
          角色库为空。下一步：点「新建角色」写清职责，或重启插件让内置 6 角色重新播种。
        </div>
      ) : (
        <ul data-role-list>
          {roles.map((role) => {
            const audit = routeAuditFor(extras.routeAudits, { roleId: role.id })
            const label = formatModelRoute(role.model, audit)
            const unverified = role.model !== undefined && (audit === undefined || audit.verdict !== 'ok')
            const confirming = pendingDelete === role.id
            return (
              <li
                key={role.id}
                data-role-id={role.id}
                data-builtin={role.builtin ? 'true' : 'false'}
                data-role-row
              >
                <span data-role-name>{role.name}</span>
                <span data-role-duty title={role.duty}>
                  {role.duty}
                </span>
                <span data-model-route data-model-route-value={routeTextOf(role.model)} data-unverified={unverified ? 'true' : 'false'}>
                  {label}
                </span>
                <span data-role-actions>
                  <button type="button" data-role-edit onClick={() => edit(role)}>
                    修改
                  </button>
                  <button
                    type="button"
                    data-role-delete
                    data-confirm={confirming ? 'true' : 'false'}
                    disabled={role.builtin || busy}
                    title={role.builtin ? '内置角色可改不可删' : confirming ? '再点一次确认删除' : '删除该角色'}
                    onClick={() => void remove(role.id)}
                  >
                    {confirming ? '确认删除' : '删除'}
                  </button>
                  {confirming ? (
                    <button type="button" data-role-delete-cancel onClick={() => setPendingDelete(undefined)}>
                      取消
                    </button>
                  ) : null}
                </span>
                {unverified ? (
                  <span data-role-unverified-note>
                    未下发：还没有观测到该角色成员的实际运行路由（派发后会在成员创建时核对，漂移即失败，不静默回退队长模型）
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {editing !== undefined ? (
        <div data-role-editor>
          <div data-editor-head>
            {editing.id === '' ? '新建角色' : `修改 ${editing.name || editing.id}`}
          </div>
          <input
            data-role-id-input
            placeholder="id（小写字母数字与 -）"
            value={editing.id}
            onChange={(event) => patch({ id: event.target.value })}
          />
          <input
            data-role-name-input
            placeholder="名称"
            value={editing.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
          <input
            data-role-duty-input
            placeholder="职责"
            value={editing.duty}
            onChange={(event) => patch({ duty: event.target.value })}
          />
          <div data-role-model-editor>
            <input
              data-role-provider
              placeholder="provider（留空=会话默认）"
              value={editing.model?.provider ?? ''}
              onChange={(event) => patchModel({ provider: event.target.value })}
            />
            <input
              data-role-model
              placeholder="model"
              value={editing.model?.model ?? ''}
              onChange={(event) => patchModel({ model: event.target.value })}
            />
            <select
              data-role-effort
              value={editing.model?.reasoningEffort ?? ''}
              onChange={(event) =>
                patchModel({
                  reasoningEffort:
                    event.target.value === ''
                      ? undefined
                      : (event.target.value as 'low' | 'medium' | 'high'),
                })
              }
            >
              <option value="">默认强度</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
            <span data-role-model-preview data-model-route-value={routeTextOf(editing.model)}>
              {formatModelRoute(editing.model, routeAuditFor(extras.routeAudits, { roleId: editing.id }))}
            </span>
          </div>
          <div data-editor-actions>
            <button type="button" data-role-save disabled={busy} onClick={() => void save()}>
              保存
            </button>
            <button type="button" data-role-cancel onClick={() => setEditing(undefined)}>
              取消
            </button>
          </div>
          {hint !== undefined ? (
            <div data-hint role="status">
              {hint}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default RolesTab
