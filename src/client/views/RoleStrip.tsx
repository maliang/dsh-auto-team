/**
 * 角色条（r13 AC-2）：本轮参与的角色 + 任务数 + 该角色的 token 合计。
 *
 * 为什么只列「有任务的角色」：角色库可以有很多角色，把没用上的也画出来会让 320px 的
 * 面板顶部被一排无关 chip 占满；`roleUsageOf` 已经按「真正派了活」过滤。
 *
 * chip 高度固定 24px、可换行：角色超过一行时向下长高，不横向滚动（横向滚动条在
 * 面板里会吃掉一条任务行的高度）。
 */
import * as React from 'react'
import type { RoleUsageView } from '../../shared/types.ts'
import { roleChipsOf } from '../viewmodel.ts'

export interface RoleStripProps {
  roles: RoleUsageView[]
}

export function RoleStrip(props: RoleStripProps): React.ReactElement {
  const chips = roleChipsOf(props.roles)
  return (
    <div data-region="task-roles" role="list" aria-label="本轮角色与用量">
      {chips.length === 0 ? (
        <span data-role-empty>本轮还没有角色</span>
      ) : (
        chips.map((chip) => (
          <span
            key={chip.roleId}
            role="listitem"
            data-role-chip
            data-role-id={chip.roleId}
            data-usage-source={chip.usageSource}
            title={chip.usageTitle}
          >
            <span data-role-name>{chip.name}</span>
            <span data-role-tasks>×{chip.taskCount}</span>
            <span data-role-token>{chip.usageText}</span>
          </span>
        ))
      )}
    </div>
  )
}

export default RoleStrip
