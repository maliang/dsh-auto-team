/**
 * 角色派生量（r14 AC-7 / AC-8 / AC-9）—— **唯一算法**，宿主与客户端共用。
 *
 * 为什么抽到 shared：r13 把「角色状态 / 当前任务 / 用时」在 `host/library.ts#rolesOf`
 * 与 `client/viewmodel.ts#roleUsageOf` 各写了一份，两边漂移过（右栏说「执行中」、抽屉说
 * 「待命」）。r14 的 AC-9/AC-17 要求两侧文本**逐字相等**，靠对齐不可靠 —— 抽出单一实现后
 * 一致性由构造保证：两侧只做「把任务列表喂进来 + 把结果铺到字段上」的映射。
 *
 * 纯逻辑模块：只 import `shared/` 内的纯模块（`types.ts` / `duration.ts`），不碰宿主、不碰客户端、不读时钟。
 */
import { UNAVAILABLE_TEXT, formatDuration } from './duration.ts'
import type { DurationCell, TaskStatus, TokenTotals, UsageCell } from './types.ts'

/** 角色态（5 态，互斥；优先级见 `roleStateOf`）。 */
export type RoleStateKind = 'running' | 'waiting_gate' | 'needs_attention' | 'done' | 'idle'

/** 角色态 → 中文文案（组件与宿主都用这一份，禁止再写第二份映射）。 */
export const ROLE_STATE_TEXT: Record<RoleStateKind, string> = {
  running: '执行中',
  waiting_gate: '待验收',
  needs_attention: '需处理',
  done: '已完成',
  idle: '待命',
}

/** 角色态 → 徽标 tone（与既有 BadgeTone 同名，组件直接透传 `data-tone`）。 */
export const ROLE_STATE_TONE: Record<RoleStateKind, string> = {
  running: 'business',
  waiting_gate: 'warn',
  needs_attention: 'danger',
  done: 'success',
  idle: 'neutral',
}

/** `roleStateOf` 的输入：只要任务的身份、标题、状态与（可选）用时。 */
export interface RoleTaskInput {
  id: string
  title: string
  status: TaskStatus
  duration?: DurationCell
}

/** 角色卡片要渲染的全部派生量（全部由 `roleStateOf` 一次算出）。 */
export interface RoleStateView {
  /** 该角色名下已完成（`status === 'done'`）的任务数。 */
  done: number
  state: RoleStateKind
  /** `ROLE_STATE_TEXT[state]`，随结果一起给出，组件不再查表。 */
  stateText: string
  /** 当前任务：优先第一个 `running`，其次第一个 `gate`；都没有则缺省。 */
  activeTaskId?: string
  activeTaskTitle?: string
  /**
   * 该角色名下任务用时的**累计**（r20 起；此前是「当前任务用时」）。
   * 没有任务 → 不可得；有任务的用时读不出来 → 不可得 + 原因；全部未开始 → 未开始。
   * 聚合区间没有单一「开始/结束时刻」，所以累计格**不带** `startAt` / `endAt`。
   */
  duration?: DurationCell
}

/**
 * 「已开始」的任务状态：这些状态下的任务一定有过执行区间，拿不到用时就是缺口。
 * 其余状态（排队/等写域/暂停/取消/跳过）允许没有用时 —— 贡献 0，不算缺口。
 */
const STARTED_STATUSES: readonly TaskStatus[] = ['running', 'gate', 'done', 'rework', 'failed', 'interrupted']

/** 需要人介入的终态/返工态（AC-7 的 danger）。 */
const ATTENTION_STATUSES: readonly TaskStatus[] = ['rework', 'failed', 'interrupted']

function attentionOf(status: TaskStatus): boolean {
  return ATTENTION_STATUSES.includes(status)
}

/**
 * 任务列表 → 角色态派生量。
 *
 * 优先级（PRD AC-7）：`running` > `gate` > `rework|failed|interrupted` > 全部 `done` > `idle`。
 * `done` 只数 `status === 'done'` —— `cancelled`/`skipped` 是终态但不是完成（AC-10 的分子口径），
 * 所以「1 个 done + 1 个 cancelled」判 `idle` 而不是 `done`。
 *
 * 空数组 = `idle` + `0` + 用时「不可得」（不是 0），界面不画假进度。
 */
export function roleStateOf(tasks: readonly RoleTaskInput[]): RoleStateView {
  let done = 0
  let running: RoleTaskInput | undefined
  let gate: RoleTaskInput | undefined
  let attention = false
  for (const task of tasks) {
    if (task.status === 'done') done += 1
    if (task.status === 'running' && running === undefined) running = task
    if (task.status === 'gate' && gate === undefined) gate = task
    if (attentionOf(task.status)) attention = true
  }

  const active = running ?? gate
  const state: RoleStateKind =
    running !== undefined
      ? 'running'
      : gate !== undefined
        ? 'waiting_gate'
        : attention
          ? 'needs_attention'
          : tasks.length > 0 && done === tasks.length
            ? 'done'
            : 'idle'

  const view: RoleStateView = { done, state, stateText: ROLE_STATE_TEXT[state] }
  if (active !== undefined) {
    view.activeTaskId = active.id
    view.activeTaskTitle = active.title
  }
  view.duration = roleDurationOf(tasks)
  return view
}

/**
 * 角色累计用时（r20）—— 宿主 `library.rolesOf` 与客户端 `viewModel.roleUsageOf` 共用的唯一算法。
 *
 * 口径（Lead 定稿，四句话）：
 *  1. 每个任务的贡献 = 它自己的用时（`endedAt - startedAt`；进行中由宿主按 now 算好），直接累加；
 *  2. **未开始的任务贡献 0**，不算缺口 —— 否则角色只要还有排队任务就永远「不可得」，等于没修；
 *  3. 真正的缺口才判不可得：状态表示「已开始/已结束」却没有任何用时（缺开始/结束时刻、区间非法）
 *     → `unavailable` + 一句人话原因（不显示被低估的合计，与 `roleUsageCellOf` 同一条纪律）；
 *  4. 全部任务都未开始 → `not-started`（不是 0 秒，也不是不可得）。
 *
 * 文本由 `shared/duration.ts#formatDuration` 生成（与任务/run 用时同一算法，两侧逐字相等）。
 * 累计格刻意不带 `startAt` / `endAt`：聚合区间没有单一「开始/结束时刻」，带上就会出现
 * 「开始 — · 结束 —」这种自相矛盾的 tooltip。
 */
export function roleDurationOf(tasks: readonly RoleTaskInput[]): DurationCell {
  if (tasks.length === 0) return { state: 'unavailable', text: UNAVAILABLE_TEXT }
  let total = 0
  let contributing = 0
  let running = false
  const gaps: string[] = []
  for (const task of tasks) {
    const cell = task.duration
    const startedStatus = STARTED_STATUSES.includes(task.status)
    if (cell === undefined) {
      if (startedStatus) gaps.push(`任务 ${task.id} 没有用时数据`)
      continue
    }
    if (cell.state === 'not-started') {
      // `not-started` 只对「还没开始」的状态合法；已开始/已结束的任务显示未开始 = 缺口。
      if (startedStatus) gaps.push(`任务 ${task.id} 缺少开始时刻`)
      continue
    }
    if (cell.state === 'unavailable' || typeof cell.ms !== 'number' || !Number.isFinite(cell.ms) || cell.ms < 0) {
      gaps.push(`任务 ${task.id} 缺少开始/结束时刻`)
      continue
    }
    contributing += 1
    total += cell.ms
    if (cell.state === 'running') running = true
  }
  if (gaps.length > 0) {
    const first = gaps[0]
    return {
      state: 'unavailable',
      text: gaps.length === 1 ? `不可得：${first}` : `不可得：${first}（另有 ${gaps.length - 1} 个任务同样不可得）`,
    }
  }
  if (contributing === 0) return { state: 'not-started', text: '未开始' }
  return { state: running ? 'running' : 'done', ms: Math.round(total), text: formatDuration(total) }
}

/** 角色用量全部缺失时的原因文案（**唯一一份**，宿主与客户端都从这里取，AC-17 逐字相等）。 */
export const ROLE_USAGE_MISSING = '该角色没有可用用量事件'

/** 角色用量部分缺失时的原因文案（同上；部分缺失按「不可得」处理，不显示被低估的合计）。 */
export const ROLE_USAGE_PARTIAL = '部分任务没有可用用量事件'

/** 一条用量单元格是否给出了可用合计（`provider` 且 `total` 是有限数）。 */
function usableTokensOf(cell: UsageCell): TokenTotals | undefined {
  if (cell.source !== 'provider') return undefined
  const tokens = cell.tokens
  if (tokens === undefined) return undefined
  if (typeof tokens.total !== 'number' || !Number.isFinite(tokens.total)) return undefined
  return tokens
}

function finiteOf(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 角色用量合计（AC-8 / AC-9 / AC-17）—— 与 `roleStateOf` 一样是**唯一算法**。
 *
 * 为什么抽到 shared：r13 的宿主 `library.rolesOf` 把已知项加起来（部分缺失时给出 80），
 * 客户端 `viewmodel.roleUsageOf` 部分缺失即判「不可得」；同一张角色卡在右栏与抽屉里
 * 说两种话（QA D2）。两边各自实现必然再次漂移，所以口径收到这里：
 *
 *   - 全部任务都有可用数字 → `provider` + 各字段合计（`total` / `input` / `output`）；
 *   - 任一任务缺可用数字 → `unavailable` + `ROLE_USAGE_PARTIAL`（把已知项加起来会得出
 *     比真实值**小**的数字，比「不可得」更误导）；
 *   - 一条都没有 → `unavailable` + `ROLE_USAGE_MISSING`。
 */
export function roleUsageCellOf(cells: readonly UsageCell[]): UsageCell {
  let total = 0
  let input = 0
  let output = 0
  let available = 0
  for (const cell of cells) {
    const tokens = usableTokensOf(cell)
    if (tokens === undefined) continue
    available += 1
    total += tokens.total
    input += finiteOf(tokens.input)
    output += finiteOf(tokens.output)
  }
  if (available === 0) return { source: 'unavailable', reason: ROLE_USAGE_MISSING }
  if (available < cells.length) return { source: 'unavailable', reason: ROLE_USAGE_PARTIAL }
  const tokens: TokenTotals = { total: Math.round(total) }
  if (input > 0) tokens.input = Math.round(input)
  if (output > 0) tokens.output = Math.round(output)
  return { source: 'provider', tokens }
}
