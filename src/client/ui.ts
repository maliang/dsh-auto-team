/**
 * client 的**渲染描述层**：无 JSX、无 React、无 IO，只把状态算成「该显示什么」。
 *
 * 存在的理由（TECHNICAL §4.4 / AC-12~AC-16）：本仓没有 `react-dom`，`node --test`
 * 也不转 JSX，所以「组件渲染出来是什么文案」无法靠快照测试断言。这里把文案、hook
 * 字面量、状态往返规则全部收敛成纯函数，单测直接驱动；组件只负责把这些字段贴到 DOM 上，
 * **禁止再写第二份文案**（同一状态两处文案必然漂移，是本项目的历史 bug 族）。
 *
 * 纪律：
 *  1. 状态中文标签一律来自 `./viewmodel.ts`（10 态唯一出处），本文件不写状态中文。
 *  2. 不 import host（`grep -rn "from '\.\./host/" src/client` 必须 0 命中）：client 与
 *     host 只通过 HTTP 通信。因此设置项的取值范围只能在这里写死一份字面量 —— 见
 *     `settingsKeysView` 的注释（真值在 `src/host/config.ts` 的 SETTINGS_LIMITS）。
 *  3. 缺字段一律给保守默认值，绝不 `!` 强断。
 */
import type {
  AutoTeamSettings,
  GateEvidence,
  PlanStatus,
  PlanTask,
  Role,
} from '../shared/types.ts'
import { planStatusView, progressOf, routeTextOf } from './viewmodel.ts'

/* ───────────────────────── 输入框内胶囊选项（AC-12） ───────────────────────── */

export interface OptionView {
  hook: 'data-auto-team-option'
  /** 可见文案（DESIGN §2.1 三态：未启用 / 随计划状态 / busy 期间逐字不变）。 */
  label: string
  /** 无障碍名：含启用态与当前状态（DESIGN §3.3，例「自动团队，已启用，计划就绪」）。 */
  ariaLabel: string
  /** `role="switch"` 的 aria-checked。 */
  pressed: boolean
  /** 视觉态：off=未启用，on=已启用，paused=计划已暂停，busy=请求在飞（文案不变、只加转圈）。 */
  state: 'off' | 'on' | 'paused' | 'busy'
}

/**
 * 输入框内的「自动团队」胶囊（取代旧的 composer.dock 开关行）。
 *
 * busy 期间**只换 state、不改 label** —— 乐观切换文案会让「点了没反应」看起来像已生效
 * （AC-15 的同一条纪律，pill 与暂停按钮共用）。
 */
export function optionView(input: {
  enabled: boolean
  busy: boolean
  planStatus?: PlanStatus
  done: number
  total: number
}): OptionView {
  const enabled = input.enabled === true
  const done = countOf(input.done)
  const total = countOf(input.total)
  // 关闭态只说「未启用」：此时计划状态没有意义（关掉的自动团队谈不上「计划就绪」）
  const status = enabled ? planPillText(input.planStatus, done, total) : planStatusView(undefined).label
  const state: OptionView['state'] =
    input.busy === true ? 'busy' : !enabled ? 'off' : input.planStatus === 'paused' ? 'paused' : 'on'
  return {
    hook: 'data-auto-team-option',
    label: `自动团队 · ${status}`,
    ariaLabel: `自动团队，${enabled ? '已启用' : '未启用'}，${status}`,
    pressed: enabled,
    state,
  }
}

/* ───────────────────────── 会话头按钮（AC-13） ───────────────────────── */

export interface HeaderView {
  hook: 'data-auto-team-header-button'
  /** 固定「自动团队」（AC-13 判据：文案含「自动团队」）。 */
  label: string
  /** 窄视口只留图标时仍要能读出的完整名字。 */
  ariaLabel: string
  /** 进度角标 `完成数/总数`；无计划时为空串（组件据此不渲染角标）。 */
  badge: string
}

/** 会话头「自动团队」按钮：点一下开右栏面板。 */
export function headerButtonView(input: {
  enabled: boolean
  planStatus?: PlanStatus
  done: number
  total: number
}): HeaderView {
  const done = countOf(input.done)
  const total = countOf(input.total)
  const status = planPillText(input.planStatus, done, total)
  return {
    hook: 'data-auto-team-header-button',
    label: '自动团队',
    ariaLabel: `自动团队，${input.enabled === true ? '已启用' : '未启用'}，${status}`,
    badge: total > 0 ? `${done}/${total}` : '',
  }
}

/* ─────────────────────── 面板顶部暂停 / 继续（AC-15） ─────────────────────── */

export interface PauseView {
  hook: 'data-auto-team-pause'
  label: '暂停任务' | '继续任务'
  action: 'pause' | 'resumeTeam'
  /** 已暂停态=琥珀（用户主动冻结，不是失败，永不用红）；非暂停态=中性。 */
  tone: 'warn' | 'muted'
  disabled: boolean
}

/**
 * 面板顶部唯一的暂停/继续按钮。
 *
 * 硬规矩（AC-15）：文案、action、tone **只**由 `paused` 决定；`busy` 只置 `disabled`。
 * 请求失败/在飞时保持原状态，等服务端快照回来再切换 —— 绝不乐观改文案。
 */
export function pauseButtonView(input: { paused: boolean; busy: boolean }): PauseView {
  const paused = input.paused === true
  return {
    hook: 'data-auto-team-pause',
    label: paused ? '继续任务' : '暂停任务',
    action: paused ? 'resumeTeam' : 'pause',
    tone: paused ? 'warn' : 'muted',
    disabled: input.busy === true,
  }
}

/* ─────────────────────── 任务行四要素（AC-14） ─────────────────────── */

export interface TaskRowView {
  hook: 'data-auto-team-task'
  /** ① 标题。 */
  title: string
  /** ② 任务内容 = `acceptance`（标题另列；截断交给 CSS 的两行 clamp，不在这里砍字）。 */
  content: string
  /** ③ 状态中文标签，唯一来自 `progressOf(task)`（10 态全覆盖）。 */
  statusLabel: string
  statusTone: 'ok' | 'warn' | 'bad' | 'muted'
  /** ④ 所属角色名；缺失显示「未分配」。 */
  roleLabel: string
  /** 门禁证据摘要；空串 = 无证据，组件整块不渲染（**不写「—」**）。 */
  evidence: string
}

/** 一条任务行的全部可核验文案。 */
export function taskRowView(task: PlanTask, roles: Role[]): TaskRowView {
  const progress = progressOf(task)
  return {
    hook: 'data-auto-team-task',
    title: str((task as { title?: unknown } | null | undefined)?.title),
    content: str((task as { acceptance?: unknown } | null | undefined)?.acceptance),
    statusLabel: progress.label,
    statusTone: progress.tone,
    roleLabel: roleLabelOf(task, roles),
    evidence: evidenceOf(task),
  }
}

const UNASSIGNED_ROLE = '未分配'

function roleLabelOf(task: PlanTask, roles: Role[]): string {
  const roleId = str((task as { roleId?: unknown } | null | undefined)?.roleId)
  if (roleId === '') return UNASSIGNED_ROLE
  const list = Array.isArray(roles) ? roles : []
  const hit = list.find((role) => str(role?.id) === roleId)
  const name = str(hit?.name).trim()
  return name === '' ? UNASSIGNED_ROLE : name
}

/**
 * 门禁证据摘要：有则「退出码 N」。
 * `exitCode === null` = 超时/被信号杀（宿主契约明确区分），必须显式写「门禁超时」，
 * 不能显示成「退出码 0」那种假绿。
 */
function evidenceOf(task: PlanTask): string {
  const evidence = (task as { evidence?: unknown } | null | undefined)?.evidence as
    | GateEvidence
    | null
    | undefined
  if (!evidence || typeof evidence !== 'object') return ''
  const exitCode = (evidence as { exitCode?: unknown }).exitCode
  if (exitCode === null) return '门禁超时'
  if (typeof exitCode === 'number' && Number.isFinite(exitCode)) return `退出码 ${exitCode}`
  return ''
}

/* ─────────────────────── 设置页 6 参数（AC-16） ─────────────────────── */

/**
 * 设置项的取值域**在这里写死一份**：client 不能 import `src/host/config.ts`
 * （host/client 零直接 import 铁律），而取值范围是用户可见文案的一部分。
 * 真值仍是 `SETTINGS_LIMITS`；两处漂移由 T5 的守卫脚本比对（grep 两侧数字）。
 */
const SETTING_HINTS = {
  concurrencyLimit: '1–8',
  memoryBudget: '200–4000',
  stallMs: '1000–600000',
  maxAttempts: '1–10',
  gateTimeoutMs: '1000–600000',
  captainModel: '缺省 = 跟随会话默认',
} as const

/**
 * 设置页的 6 行参数（顺序即 DESIGN §2.4 的渲染顺序）。
 * `key` 就是 `data-setting-key`，组件与真机断言都用它定位。
 */
export function settingsKeysView(settings: AutoTeamSettings): {
  key: string
  label: string
  hint: string
  value: string
}[] {
  const s = (settings ?? {}) as Partial<AutoTeamSettings>
  return [
    {
      key: 'concurrencyLimit',
      label: '并发上限',
      hint: SETTING_HINTS.concurrencyLimit,
      value: num(s.concurrencyLimit),
    },
    {
      key: 'memoryBudget',
      label: '记忆注入预算',
      hint: SETTING_HINTS.memoryBudget,
      value: num(s.memoryBudget),
    },
    {
      key: 'stallMs',
      label: '停滞阈值(ms)',
      hint: SETTING_HINTS.stallMs,
      value: num(s.stallMs),
    },
    {
      key: 'maxAttempts',
      label: '返工上限',
      hint: SETTING_HINTS.maxAttempts,
      value: num(s.maxAttempts),
    },
    {
      key: 'gateTimeoutMs',
      label: '门禁超时(ms)',
      hint: SETTING_HINTS.gateTimeoutMs,
      value: num(s.gateTimeoutMs),
    },
    {
      key: 'captainModel',
      label: '队长默认模型',
      hint: SETTING_HINTS.captainModel,
      value: routeTextOf(s.captainModel) || '会话默认',
    },
  ]
}

/* ─────────────────────────────── 内部小工具 ─────────────────────────────── */

/**
 * 胶囊/角标的状态段：文案只由计划状态派生（**不写状态中文**，一律取 `planStatusView`）。
 *  - 无计划 → 待开工；
 *  - 暂停/已终止/已取消 → 只显示状态本身（没有进度可言）；
 *  - 全部完成 → `完成 x/N`；
 *  - 派发中 → `派发中 · x/N`；
 *  - 其余（计划就绪）→ `计划就绪 · N 任务`。
 */
function planPillText(planStatus: PlanStatus | undefined, done: number, total: number): string {
  if (!planStatus) return '待开工'
  const base = planStatusView(planStatus).label
  if (planStatus === 'paused' || planStatus === 'terminated' || planStatus === 'cancelled') return base
  // 全部完成优先于「派发中」：任务都绿了还写派发中会让人以为没跑完
  if (total > 0 && done >= total) return `完成 ${done}/${total}`
  if (planStatus === 'dispatching') return total > 0 ? `${base} · ${done}/${total}` : base
  return total > 0 ? `${base} · ${total} 任务` : base
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 计数兜底：非数字/负数/NaN 一律 0（宿主字段缺失时不许把界面算成 NaN/undefined）。 */
function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** 数字字段的输入框初值：非法/缺失给空串（让用户看出「没设过」而不是看到 0）。 */
function num(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}
