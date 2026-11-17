/**
 * 单任务干预（r11 F8）的**唯一允许集与唯一文案源**：14 态 × 4 动作。
 *
 * 为什么放 `src/shared` 而不是 host/client 各写一份：宿主的拒绝文案与面板的 disabled 矩阵
 * 必须是同一张表派生的（AC-27）。两边各写一个 `switch`，第一次改允许集就会分叉，
 * 而分叉后的症状是「按钮能点、点了被宿主拒」——最难被单测发现的那一类。
 *
 * 纪律：
 *  1. 允许集与禁用原因写在同一格（`Cell`）里，避免「布尔表」与「原因表」两张表漂移；
 *     对外的 `TASK_ACTION_ALLOW` 只是从它派生出的形状（蓝图要求的名字）。
 *  2. 14 态**逐格显式**写死，禁止 `default` 兜底：漏一族的状态必须让类型检查报错，
 *     而不是悄悄落到某个「默认允许/默认拒绝」上。
 *  3. 中文标签只此一份，`viewmodel` 的徽标文案也读它（状态中文不得出现第二份）。
 */
import type { TaskStatus } from './types.ts'

/**
 * 四个单任务动作（与 `PanelAction` 的 `cancelTask` / `skipTask` / `updateAcceptance` 一一对应；
 * r37 新增的 `pause` 对应 **两个**动作 `pauseTask` / `resumeTask` —— 暂停与继续共用同一格允许集，
 * 因为「已暂停能否再暂停」的答案是「能」（= 继续），文案由客户端按当前状态切）。
 */
export type TaskActionName = 'cancel' | 'skip' | 'edit-acceptance' | 'pause'

/** 允许表的列名：`edit-acceptance` 在表里叫 `acceptance`（与宿主字段同名）。 */
export type TaskActionKey = 'cancel' | 'skip' | 'acceptance' | 'pause'

/** 一格：是否允许 + 不允许时给用户看的中文原因（允许时为空串）。 */
interface Cell {
  allow: boolean
  reason: string
}

const ALLOW: Cell = { allow: true, reason: '' }

function deny(reason: string): Cell {
  return { allow: false, reason }
}

/**
 * 14 态 × 4 动作的裁决表（DESIGN §3.4 逐格照抄；`pause` 列见 r37，`review` 行见 r42）。
 *
 * 口径来源（PRD AC-26 + 技术方案 §7.1）：
 *  - `cancel`：pending/blocked/ready/waiting/running/rework/failed 允许；
 *  - `skip`：只有还没开跑的 pending/blocked/ready/waiting 允许（running 要先取消）；
 *  - `edit-acceptance`：除 cancelled/skipped 之外都允许；`done` 也允许（r13 PRD 取代
 *    r11#AC-26）—— 宿主对 `done` 走「确认 → 落新命令 → 重跑门禁」，不在允许表里一刀切拒绝。
 *  - `pause`（r37）：除 `done/cancelled/skipped`（已结束）外都允许 —— 暂停是「冻结」而不是终态，
 *    `paused` 行也必须允许（它语义上是「继续」，文案由客户端按状态切）。
 *
 * `paused` / `gate` / `interrupted` 的取消与跳过不改：门禁在跑时有回执写回竞态，
 * 暂停有页头统一还原，中断的出路是续聊或改验收后重派。
 */
const MATRIX: Record<TaskStatus, Record<TaskActionKey, Cell>> = {
  pending: { cancel: ALLOW, skip: ALLOW, acceptance: ALLOW, pause: ALLOW },
  ready: { cancel: ALLOW, skip: ALLOW, acceptance: ALLOW, pause: ALLOW },
  blocked: { cancel: ALLOW, skip: ALLOW, acceptance: ALLOW, pause: ALLOW },
  waiting: { cancel: ALLOW, skip: ALLOW, acceptance: ALLOW, pause: ALLOW },
  running: { cancel: ALLOW, skip: deny('运行中请先取消'), acceptance: ALLOW, pause: ALLOW },
  rework: { cancel: ALLOW, skip: deny('待返工：请重跑或取消'), acceptance: ALLOW, pause: ALLOW },
  failed: { cancel: ALLOW, skip: deny('已失败：请重跑或取消'), acceptance: ALLOW, pause: ALLOW },
  interrupted: {
    cancel: deny('已中断：请续聊或改验收后重跑'),
    skip: deny('已中断：请续聊'),
    acceptance: ALLOW,
    pause: ALLOW,
  },
  gate: {
    cancel: deny('门禁执行中，等门禁结束'),
    skip: deny('门禁执行中'),
    acceptance: ALLOW,
    pause: ALLOW,
  },
  /**
   * r42：门禁已通过、等人工验收。取消/跳过（终态，释放写域）与改验收都允许；
   * **暂停拒绝** —— 验收态不是可冻结的执行态，挡住它只会让写域被无意义地占着。
   * 出路是「打回」或「取消」，文案必须点名，别让用户去找一个不存在的按钮。
   */
  review: {
    cancel: ALLOW,
    skip: ALLOW,
    acceptance: ALLOW,
    pause: deny('任务在验收中，先打回或取消'),
  },
  paused: {
    // D1：两级暂停入口的按钮名不同（页头「继续团队」/ 行内「继续此任务」），文案必须分别点名，
    // 否则用户按旧名找按钮找不到。
    cancel: deny('已暂停：团队暂停请点页头『继续团队』。单卡暂停请点该行『继续此任务』'),
    skip: deny('已暂停：跳过前需先恢复任务——团队暂停请点页头『继续团队』。单卡暂停请点该行『继续此任务』'),
    acceptance: ALLOW,
    // r37：`paused` 行必须允许 —— 对已暂停的任务点「暂停」语义上是「继续」（客户端按状态切文案）。
    pause: ALLOW,
  },
  done: {
    cancel: deny('已完成，无需取消'),
    skip: deny('已完成'),
    // r13：done 允许改验收，但执行体必须重跑门禁（否则「完成」的含义可被静默改写）。
    acceptance: ALLOW,
    pause: deny('任务已结束，不能暂停'),
  },
  cancelled: {
    cancel: deny('已取消'),
    skip: deny('已取消'),
    acceptance: deny('已取消'),
    pause: deny('任务已结束，不能暂停'),
  },
  skipped: {
    cancel: deny('已跳过'),
    skip: deny('已跳过'),
    acceptance: deny('已跳过'),
    pause: deny('任务已结束，不能暂停'),
  },
}

/** 动作名 → 允许表列名。 */
const KEY_OF: Record<TaskActionName, TaskActionKey> = {
  cancel: 'cancel',
  skip: 'skip',
  'edit-acceptance': 'acceptance',
  pause: 'pause',
}

/**
 * 14 态 × 4 动作的允许集（蓝图声明的形状）：面板的 `disabled` 与宿主的拒绝面都读它。
 *
 * 从 `MATRIX` 派生而不是手写第二份布尔表——两份表是 AC-27「矩阵与允许集一致」的唯一风险点。
 */
export const TASK_ACTION_ALLOW: Record<TaskStatus, Record<TaskActionKey, boolean>> = Object.fromEntries(
  (Object.keys(MATRIX) as TaskStatus[]).map((status) => {
    const row = MATRIX[status]
    return [
      status,
      {
        cancel: row.cancel.allow,
        skip: row.skip.allow,
        acceptance: row.acceptance.allow,
        pause: row.pause.allow,
      },
    ]
  }),
) as Record<TaskStatus, Record<TaskActionKey, boolean>>

function cellOf(action: TaskActionName, status: TaskStatus): Cell | null {
  const row = MATRIX[status]
  if (row === undefined) return null
  return row[KEY_OF[action]] ?? null
}

/**
 * 该状态下这个动作允许吗。
 *
 * 未知状态一律不允许（旧 run 文件里出现没见过的状态时，宁可拒绝也不放行一个会改状态的写操作）。
 */
export function taskActionAllowed(action: TaskActionName, status: TaskStatus): boolean {
  return cellOf(action, status)?.allow === true
}

/**
 * 禁用原因（中文，逐字来自 DESIGN §3.4）。允许时返回空串——调用方据此决定要不要挂 `title`。
 */
export function taskActionDisabledReason(action: TaskActionName, status: TaskStatus): string {
  const cell = cellOf(action, status)
  if (cell === null) return `未知任务状态「${String(status)}」不允许该动作`
  return cell.allow ? '' : cell.reason
}

/**
 * 14 条状态中文标签（互不重复）。徽标、任务行、宿主的拒绝文案都读这一张表。
 *
 * 红只给 `failed` / `interrupted`（tone 在 viewmodel 里）；取消与跳过是用户主动行为，用中性色。
 */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待派发',
  ready: '就绪',
  blocked: '阻塞',
  waiting: '等待中',
  running: '运行中',
  rework: '待返工',
  failed: '失败',
  interrupted: '已中断',
  gate: '门禁中',
  review: '待验收',
  paused: '已暂停',
  done: '已通过',
  cancelled: '已取消',
  skipped: '已跳过',
}
