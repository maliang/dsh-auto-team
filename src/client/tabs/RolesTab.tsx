/**
 * 面板「角色」页签（DESIGN §0.8-9 / TECHNICAL §4.7）。
 *
 * 本页签**只是一个容器**：编辑 UI 与校验全部在 `RoleEditor.tsx` 的 `RoleEditorList` 里，
 * 与设置页共用同一份组件（`density="panel"`）。历史上这里是独立的一套编辑器 ——
 * 那正是「面板改得动、设置里改不动」的来源，本轮把它收成一条链。
 *
 * 保存动作仍走 `act({type:'saveRole'})`：本文件不 import api、不发请求。
 */
import * as React from 'react'
import type { Role, SkillInfo } from '../../shared/types.ts'
import type { TabProps } from '../Panel.tsx'
import { actFeedback, hintOf } from '../viewmodel.ts'
import type { ClientAction } from '../viewmodel.ts'
import { RoleEditorList } from '../RoleEditor.tsx'

export function RolesTab(props: TabProps): React.ReactElement {
  const { snapshot, act } = props
  const roles: Role[] = snapshot?.roles ?? []
  const skills: SkillInfo[] = snapshot?.skills ?? []
  const [busy, setBusy] = React.useState(false)
  const [hint, setHint] = React.useState<string | undefined>(undefined)

  async function run(action: ClientAction, done: string): Promise<void> {
    setBusy(true)
    try {
      const feedback = await actFeedback(act, action)
      setHint(hintOf(feedback) ?? (feedback.ok ? done : '动作未生效'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-auto-team-roles data-density="panel">
      {hint === undefined ? null : (
        <div data-hint role="status">
          {hint}
        </div>
      )}
      <RoleEditorList
        roles={roles}
        skills={skills}
        density="panel"
        busy={busy}
        onSave={(role) => void run({ type: 'saveRole', role }, `已保存角色「${role.name}」`)}
        onDelete={(id) => void run({ type: 'deleteRole', roleId: id }, `已删除角色 ${id}`)}
        onRestoreDefaults={() => void run({ type: 'restoreDefaultRoles' }, '已把内置角色恢复为出厂定义')}
      />
    </section>
  )
}

export default RolesTab
