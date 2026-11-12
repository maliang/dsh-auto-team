/**
 * 角色卡片 + 2 列网格（r14 AC-7 / AC-8 / AC-9）。
 *
 * 卡片渲染的六个派生量（状态 / 状态文案 / 已完成数 / 当前任务 id / 当前任务标题 / 用时）
 * 全部来自 `shared/role-view.ts#roleStateOf`（宿主 rolesOf 与客户端 roleUsageOf 同一份实现），
 * 组件**只渲染、不聚合** —— 这是 AC-9/AC-17「右栏与抽屉文本逐字相等」的构造保证。
 *
 * 几何（DESIGN §2.2）：296 内容宽 / 2 列 = 144，min-height 76；四行 ——
 *   1. 角色名（13/600，弹性，ellipsis）+ 状态徽标（18px 高）；
 *   2. 当前任务标题（11px，一行 ellipsis）；没有当前任务时写「无进行中任务」；
 *   3. refs 行（r16 AC-16）：该角色的任务编号 chip（`tN` + 状态彩点），
 *      `taskRefs` 缺省/空则整行不渲染 —— 旧快照不显示「0 个任务」；
 *   4. token · 用时 · 已完成 N/总数（11px tabular-nums）。
 * 卡片数 = 不同 roleId 数（分组已在宿主/客户端聚合层完成）。
 */
import * as React from 'react'
import type { MemberView, RoleUsageView } from '../../shared/types.ts'
import { ROLE_STATE_TEXT, ROLE_STATE_TONE } from '../../shared/role-view.ts'
import type { RoleStateKind } from '../../shared/role-view.ts'
import { memberForRole } from '../nav.ts'
import {
  memberCardChipOf,
  memberStatusTitleOf,
  roleDurationTitleOf,
  roleTaskRefViewOf,
  tokenTextOf,
  tokenTitleOf,
} from '../viewmodel.ts'

export interface RoleCardProps {
  role: RoleUsageView
  /** 执行该角色任务的成员（r17：点卡片 = 在主界面打开它）。 */
  member?: MemberView
  /** 缺省 = 卡片不可点（历史 run / 找不到成员）。 */
  onOpen?: () => void
}

export interface RoleGridProps {
  roles: RoleUsageView[]
  /** 当前 run 的成员；历史 run 不传（成员页对历史无意义）。 */
  members?: MemberView[]
  onOpenMember?: (member: MemberView, taskId?: string) => void
}

/** 旧快照/旧夹具缺派生字段时的兜底（不改写统计，只保证界面不空）。 */
const FALLBACK_STATE: RoleStateKind = 'idle'

export function RoleCard(props: RoleCardProps): React.ReactElement {
  const { role, member, onOpen } = props
  const state = role.state ?? FALLBACK_STATE
  const stateText = role.stateText ?? ROLE_STATE_TEXT[state]
  const tone = ROLE_STATE_TONE[state] ?? 'neutral'
  const done = role.done ?? 0
  const activeTitle = role.activeTaskId !== undefined ? (role.activeTaskTitle ?? role.activeTaskId) : undefined
  const duration = role.duration
  // r16 AC-16：只渲染、不排序 —— 顺序 = 计划顺序，数量 = role.tasks（空/缺省整行不渲染）。
  const refs = (role.taskRefs ?? []).map((ref) => roleTaskRefViewOf(ref))
  // r21：角色的聚合状态看不出成员被中断/作废/等写域 —— 这类实况用一枚成员态 chip 补上。
  const memberChip = memberCardChipOf(member)
  const memberChipEl =
    memberChip === undefined || member === undefined ? null : (
      <span
        data-role-member-status
        data-status={member.status}
        data-tone={memberChip.tone}
        title={memberStatusTitleOf(member.status) ?? `成员状态：${memberChip.text}`}
        aria-label={`成员状态：${memberChip.text}`}
      >
        <span aria-hidden="true">{memberChip.icon}</span> {memberChip.text}
      </span>
    )
  return (
    <article
      data-role-card
      data-role-id={role.roleId}
      data-role-state={state}
      data-role-done={String(done)}
      data-role-card-open={onOpen === undefined ? undefined : 'true'}
      data-member-id={member?.memberId}
      role={onOpen === undefined ? undefined : 'button'}
      tabIndex={onOpen === undefined ? undefined : 0}
      aria-label={onOpen === undefined ? undefined : `打开子智能体：${member?.name ?? role.name}`}
      style={onOpen === undefined ? undefined : { cursor: 'pointer' }}
      onClick={onOpen}
      onKeyDown={
        onOpen === undefined
          ? undefined
          : (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onOpen()
            }
      }
    >
      <div data-role-line="head">
        <span data-role-name title={role.name}>
          {role.name}
        </span>
        <span data-role-status data-tone={tone} title={`角色状态：${stateText}`}>
          {stateText}
        </span>
      </div>
      {activeTitle !== undefined ? (
        <span data-role-active-task title={activeTitle}>
          {activeTitle}
        </span>
      ) : (
        <span data-role-active-task data-empty="true">
          无进行中任务
        </span>
      )}
      {refs.length > 0 ? (
        <div data-role-line="refs" data-role-task-refs>
          {refs.map((chip) => (
            <span
              key={chip.id}
              data-role-task-ref
              data-task-id={chip.id}
              data-status={chip.status}
              data-tone={chip.tone}
              title={chip.title}
              aria-label={chip.label}
            >
              <span data-task-ref-dot data-tone={chip.tone} aria-hidden="true" />
              <span data-task-ref-id>{chip.text}</span>
            </span>
          ))}
          {memberChipEl}
        </div>
      ) : memberChipEl !== null ? (
        // 没有任务 chip 时单独一行（旧快照无 taskRefs 也要能看见成员停止/等待写域）。
        <div data-role-line="refs" data-role-member-line>
          {memberChipEl}
        </div>
      ) : null}
      <div data-role-line="meta">
        <span data-role-usage data-usage-source={role.usage.source} title={tokenTitleOf(role.usage)}>
          {tokenTextOf(role.usage)}
        </span>
        <span data-role-sep aria-hidden="true">
          ·
        </span>
        <span
          data-role-duration
          data-duration-state={duration?.state ?? 'unavailable'}
          title={roleDurationTitleOf(duration, role.tasks)}
        >
          {duration !== undefined ? duration.text : '不可得'}
        </span>
      </div>
    </article>
  )
}

export function RoleGrid(props: RoleGridProps): React.ReactElement {
  // 没有角色时不渲染空网格（DESIGN §0.5：空态不留一块空白边框），但保留 section 钩子。
  if (props.roles.length === 0) {
    return <section data-region="task-roles" data-role-grid-view data-empty="true" aria-label="本轮角色状态" />
  }
  return (
    <section data-region="task-roles" data-role-grid-view aria-label="本轮角色状态">
      <div data-role-grid>
        {props.roles.map((role) => {
          const taskId = role.activeTaskId
          const member = memberForRole(props.members, role.roleId, taskId)
          const open =
            member === undefined || props.onOpenMember === undefined
              ? undefined
              : () => props.onOpenMember?.(member, taskId ?? member.taskId)
          return <RoleCard key={role.roleId} role={role} member={member} onOpen={open} />
        })}
      </div>
    </section>
  )
}

export default RoleGrid
