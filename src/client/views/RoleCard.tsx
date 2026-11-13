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
 *
 * r33：整卡点击 = 跳到该角色成员的宿主会话。跳不跳、为什么不能跳，一律由
 * `memberJumpOf` 判定（三入口唯一实现）；卡片内没有折叠/展开控件，故不需要
 * stopPropagation —— 成员态 chip 是不可交互的 span，键盘事件只会落到卡片本身。
 */
import * as React from 'react'
import type { MemberView, RoleUsageView } from '../../shared/types.ts'
import { ROLE_STATE_TEXT, ROLE_STATE_TONE } from '../../shared/role-view.ts'
import type { RoleStateKind } from '../../shared/role-view.ts'
import {
  AWAITING_RECEIPT_MEMBER_TEXT,
  awaitingReceiptOf,
  awaitingReceiptTitleOf,
  memberCardChipOf,
  memberJumpOf,
  memberStatusTitleOf,
  roleJumpLabelOf,
  roleDurationTitleOf,
  roleTaskRefViewOf,
  tokenTextOf,
  tokenTitleOf,
} from '../viewmodel.ts'
import type { MemberJumpView, TaskCardSource } from '../viewmodel.ts'

export interface RoleCardProps {
  role: RoleUsageView
  /** 当前 run 的成员；历史 run 不传（历史无成员会话可跳）。 */
  members?: MemberView[]
  /**
   * r33：当前 run 的任务视图。角色卡据此判断「当前任务是否待回执」——
   * 宿主只把 `awaitingReceipt` 放在任务上，角色聚合视图里没有该事实位。
   */
  tasks?: readonly TaskCardSource[]
  /** 缺省 = 卡片不可点（历史 run / 非任务页用法）。 */
  onJump?: (jump: MemberJumpView) => void
}

export interface RoleGridProps {
  roles: RoleUsageView[]
  /** 当前 run 的成员；历史 run 不传（成员页对历史无意义）。 */
  members?: MemberView[]
  /** r33：当前 run 的任务视图（逐卡片查「当前任务待回执」）。 */
  tasks?: readonly TaskCardSource[]
  onJump?: (jump: MemberJumpView) => void
}

/** 旧快照/旧夹具缺派生字段时的兜底（不改写统计，只保证界面不空）。 */
const FALLBACK_STATE: RoleStateKind = 'idle'

export function RoleCard(props: RoleCardProps): React.ReactElement {
  const { role, members, tasks, onJump } = props
  const state = role.state ?? FALLBACK_STATE
  const stateText = role.stateText ?? ROLE_STATE_TEXT[state]
  const tone = ROLE_STATE_TONE[state] ?? 'neutral'
  const done = role.done ?? 0
  const activeTitle = role.activeTaskId !== undefined ? (role.activeTaskTitle ?? role.activeTaskId) : undefined
  const duration = role.duration
  // r16 AC-16：只渲染、不排序 —— 顺序 = 计划顺序，数量 = role.tasks（空/缺省整行不渲染）。
  const refs = (role.taskRefs ?? []).map((ref) => roleTaskRefViewOf(ref))
  // r33：成员态 chip 与跳转判定看的是同一个成员（同一 taskId 绑定优先规则）。
  const jump = memberJumpOf(
    { kind: 'role', roleId: role.roleId, taskId: role.activeTaskId },
    members,
    { label: roleJumpLabelOf(role.name) },
  )
  const member = jump.member
  // r21：角色的聚合状态看不出成员被中断/作废/等写域 —— 这类实况用一枚成员态 chip 补上。
  const memberChip = memberCardChipOf(member)
  // r33：角色聚合状态看不出「人已经停了、只差回执」——补一枚与停滞黄条不同的标记。
  const activeTask =
    role.activeTaskId === undefined ? undefined : tasks?.find((task) => task.id === role.activeTaskId)
  const awaitingReceiptEl = awaitingReceiptOf(activeTask) ? (
    <span
      data-awaiting-receipt
      data-awaiting-receipt-scope="role"
      title={awaitingReceiptTitleOf(activeTask)}
    >
      {AWAITING_RECEIPT_MEMBER_TEXT}
    </span>
  ) : null
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
      data-role-card-open={onJump === undefined ? undefined : 'true'}
      data-member-jump={onJump === undefined ? undefined : jump.available ? 'available' : 'unavailable'}
      data-member-id={jump.memberId}
      role={onJump === undefined ? undefined : 'button'}
      tabIndex={onJump === undefined ? undefined : 0}
      aria-label={onJump === undefined ? undefined : jump.label}
      title={onJump === undefined ? undefined : jump.title}
      style={onJump === undefined ? undefined : { cursor: 'pointer' }}
      onClick={onJump === undefined ? undefined : () => onJump(jump)}
      onKeyDown={
        onJump === undefined
          ? undefined
          : (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onJump(jump)
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
      {refs.length > 0 || memberChipEl !== null || awaitingReceiptEl !== null ? (
        <div
          data-role-line="refs"
          data-role-task-refs={refs.length > 0 ? '' : undefined}
          data-role-member-line={refs.length === 0 && memberChipEl !== null ? '' : undefined}
        >
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
          {awaitingReceiptEl}
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
        {props.roles.map((role) => (
          <RoleCard
            key={role.roleId}
            role={role}
            members={props.members}
            tasks={props.tasks}
            onJump={props.onJump}
          />
        ))}
      </div>
    </section>
  )
}

export default RoleGrid
