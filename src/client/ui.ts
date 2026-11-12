/**
 * client 的**渲染描述层**：无 JSX、无 React、无 IO，只把状态算成「该显示什么」。
 *
 * 存在的理由（TECHNICAL §5 / AC-3 / AC-6 / AC-11 / AC-19 / AC-22）：本仓没有 `react-dom`，
 * `node --test` 也不转 JSX，所以「组件渲染出来是什么文案」无法靠快照测试断言。这里把文案、
 * hook 字面量、状态往返规则全部收敛成纯函数，单测直接驱动；组件只负责把这些字段贴到 DOM 上，
 * **禁止再写第二份文案**（同一状态两处文案必然漂移，是本项目的历史 bug 族）。
 *
 * 纪律：
 *  1. 状态中文标签一律来自 `./viewmodel.ts`（13 态唯一出处），本文件不写任务/计划状态中文。
 *  2. 不 import host（`grep -rn "from '\.\./host/" src/client` 必须 0 命中）：client 与
 *     host 只通过 HTTP 通信。因此设置项的取值范围只能在这里写死一份字面量 —— 见
 *     `settingsKeysView` 的注释（真值在 `src/host/config.ts` 的 SETTINGS_LIMITS）。
 *  3. 缺字段一律给保守默认值，绝不 `!` 强断。
 */
import type {
  AutoTeamSettings,
  DeviationView,
  GateEvidence,
  PlanTask,
  Role,
  RoleModelRoute,
  ScopeLockView,
  SkillInfo,
  SkillSource,
} from '../shared/types.ts'
import {
  deviationRowOf,
  progressOf,
  routeTextOf,
  runStageOf,
  type RunStageInput,
  scopeLockRowOf,
  taskActionsOf,
  waitReasonOf,
  type DeviationRowView,
  type ScopeLockRowView,
  type TaskActionView,
} from './viewmodel.ts'

/* ───────────────────── 输入框内胶囊选项（AC-3 / AC-6） ───────────────────── */

export interface OptionView {
  hook: 'data-auto-team-option'
  /**
   * 可见文案：**逐字「自动团队」**（AC-3 判据，不含状态、不随状态变）。
   * r7 的 `自动团队 · 计划就绪` 把状态塞进可见文案，失败时又追加数字，宽度会跳 —— r10 收敛。
   */
  label: '自动团队'
  /** 无障碍名：含启用态与当前状态；失败态整句换成失败原因（含「操作失败」前缀）。 */
  ariaLabel: string
  /** `role="switch"` 的 aria-checked。 */
  pressed: boolean
  /** 视觉态：off=未启用，on=已启用，paused=计划已暂停，busy=请求在飞（文案不变、只加转圈）。 */
  state: 'off' | 'on' | 'paused' | 'busy'
  /**
   * 状态点色调（AC-6）：失败残留是**琥珀实心**（可恢复的异常），正常一律中性。
   * 失败**不得**用 `--dsw-alias-state-error-primary`（红只留给不可恢复的失败，DESIGN §0.1-3）。
   */
  dotTone: 'neutral' | 'warn'
  /** 失败说明（含「操作失败」前缀）；`undefined` = 无失败，组件据此决定 title 与描边。 */
  failure?: string
}

/** 失败文案的前缀（AC-6 判据逐字，改这里必须同步 PRD/测试）。 */
export const OPTION_FAILURE_PREFIX = '操作失败'

/**
 * 输入框内的「自动团队」胶囊（取代旧的整宽开关行）。
 *
 * 三条硬规矩：
 *  ① `label` 逐字「自动团队」——状态语义全进 `ariaLabel`（AC-3）；
 *  ② 失败不写红字、不加文本节点：只有 `dotTone='warn'` + `failure`（组件把它贴到
 *     `title`/`aria-label`），可见文本逐字不变（AC-5 + AC-6）；
 *  ③ busy 期间**只换 state、不改 label**（乐观切换文案会让「点了没反应」看起来像已生效）。
 */
export function optionView(input: PlanPillInput & {
  enabled: boolean
  busy: boolean
  /** 上一次动作的失败原因（原始原因，不含前缀）；空串/undefined = 无失败。 */
  failure?: string
}): OptionView {
  const enabled = input.enabled === true
  // 关闭态只说「未启用」：此时计划状态没有意义（关掉的自动团队谈不上「计划就绪」）
  const status = enabled ? planPillText(input) : runStageOf({}).label
  const state: OptionView['state'] =
    input.busy === true ? 'busy' : !enabled ? 'off' : input.planStatus === 'paused' ? 'paused' : 'on'
  const failure = failureTextOf(input.failure)
  // 无障碍名三分支：失败说明 / 已启用+状态 / 未启用（关闭态不再重复拼一遍状态词）
  const ariaLabel =
    failure !== undefined ? failure : enabled ? `自动团队，已启用，${status}` : '自动团队，未启用'
  return {
    hook: 'data-auto-team-option',
    label: '自动团队',
    ariaLabel,
    pressed: enabled,
    state,
    dotTone: failure === undefined ? 'neutral' : 'warn',
    failure,
  }
}

/** 失败原因 → 「操作失败：<原因摘要>」；无原因返回 undefined（不制造空文案）。 */
function failureTextOf(raw: unknown): string | undefined {
  const reason = str(raw).trim()
  if (reason === '') return undefined
  // 摘要：第一行 + 最多 120 字符（title 太长在真机上不可读，且面板 [data-error] 已有全文）
  const line = reason.split('\n')[0] ?? ''
  const summary = line.length > 120 ? `${line.slice(0, 119)}…` : line
  return `${OPTION_FAILURE_PREFIX}：${summary}`
}

/* ───────────────────────── 会话头按钮（AC-11） ───────────────────────── */

export interface HeaderView {
  hook: 'data-auto-team-header-button'
  /** 固定「自动团队」（AC-11 判据：文案含「自动团队」）。 */
  label: '自动团队'
  /** 三分支 aria-label（AC-11）：可收 / 可开 / 宿主未提供收起入口。 */
  ariaLabel: string
  /** 进度角标 `完成数/总数`；无计划时为空串（组件据此不渲染角标）。 */
  badge: string
  /** `aria-pressed` 的取值（**非乐观**：由命令返回值/页签真实存在性驱动）。 */
  opened: boolean
  /** 本次点击的语义。 */
  action: 'open' | 'close'
  /** 宿主未提供开启/收起入口 → 组件回退到窗口事件，且**不翻转** aria-pressed。 */
  fallback: boolean
}

/**
 * 会话头「自动团队」按钮（r10 从「只能开」改成「可开可收」）。
 *
 * `opened` 必须由**真实页签状态**驱动，不能是本地乐观态 —— 否则用户从页签 × 关掉面板后，
 * 按钮仍显示「已打开」，下一次点击又去 close 一个不存在的页签（AC-11）。
 */
export function headerButtonView(input: PlanPillInput & {
  enabled: boolean
  /** 页签是否真的存在（`PanelCommands.isOpen`）；`undefined` = 宿主没给这个能力。 */
  opened?: boolean
  /** 宿主是否有可用的开/收入口（`PanelCommands` 是否拿到 `sidebarRight`）。 */
  available?: boolean
  /** 宿主是否提供了关闭入口；`false` + 已打开 = 点了也关不上（title 要说真话）。 */
  canClose?: boolean
}): HeaderView {
  const done = countOf(input.done)
  const total = countOf(input.total)
  const status = planPillText(input)
  const fallback = input.available === false
  const opened = input.opened === true && !fallback
  const canClose = input.canClose !== false
  const ariaLabel = opened
    ? canClose
      ? '收起自动团队面板'
      : '收起失败：宿主未提供关闭入口'
    : fallback
      ? '打开自动团队面板（宿主未提供页签服务，已回退为窗口事件）'
      : '打开自动团队面板'
  return {
    hook: 'data-auto-team-header-button',
    label: '自动团队',
    ariaLabel: `${ariaLabel}（${input.enabled === true ? '已启用' : '未启用'}，${status}）`,
    badge: total > 0 ? `${done}/${total}` : '',
    opened,
    action: opened ? 'close' : 'open',
    fallback,
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
  /** ③ 状态中文标签，唯一来自 `progressOf(task)`（13 态全覆盖）。 */
  statusLabel: string
  statusTone: 'ok' | 'warn' | 'bad' | 'muted'
  /** ④ 所属角色名；缺失显示「未分配」。 */
  roleLabel: string
  /** 门禁证据摘要；空串 = 无证据，组件整块不渲染（**不写「—」**）。 */
  evidence: string
  /**
   * ⑤ 等待原因（AC-20）：**快照原文**，空串 = 没有等待条（非 waiting 态一律空串）。
   * 组件只在 `status === 'waiting'` 且它非空时渲染 `[data-wait-reason]`。
   */
  waitReason: string
  /** ⑥ 三个单任务动作（含 disabled 与原因，派生自 shared 的允许表，AC-27）。 */
  actions: TaskActionView[]
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
    waitReason: waitReasonOf(task),
    actions: taskActionsOf(task),
  }
}

/* ───────── r11：写域占用行 / 执行痕迹行（DESIGN §3.5 / §3.6，映射只在 viewmodel） ───────── */

/** 写域占用的一行（`[data-lock-row]`）——委托 viewmodel，组件不自己拼文案。 */
export function scopeLockRowView(lock: ScopeLockView): ScopeLockRowView {
  return scopeLockRowOf(lock)
}

/** 执行痕迹的一行（`[data-deviation-row]`）——委托 viewmodel。 */
export function deviationRowView(record: DeviationView): DeviationRowView {
  return deviationRowOf(record)
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

/* ───────────────── 技能区：四来源 / 行视图 / 徽标（AC-19 / AC-23） ───────────────── */

/** 来源徽标的可见文本（2 字，逐字；测试与真机断言都读它）。 */
const SKILL_SOURCE_LABEL: Record<SkillSource, string> = {
  builtin: '内置',
  imported: '导入',
  system: '系统',
  manual: '手动',
}

/** 来源中文标签；未知来源给「未知」而不是空串（空徽标会被读成「没有来源」）。 */
export function skillSourceLabel(source: SkillSource): string {
  return SKILL_SOURCE_LABEL[source] ?? '未知'
}

export interface SkillRowView {
  hook: 'data-skill-row'
  id: string
  title: string
  /** 说明；空串时组件不渲染第二行文案（不写占位符）。 */
  description: string
  /** 来源（同时是 `data-skill-source` 的取值）。 */
  source: SkillSource
  sourceLabel: string
  /** 来源色调（CSS 只做辅助，文字永远存在 —— 色觉差异用户靠文字区分）。 */
  sourceTone: 'neutral' | 'business' | 'success' | 'plain'
  /** 内置技能正文被改过 → 显示「已修改」徽标。 */
  modified: boolean
  modifiedLabel: string | null
  /** 是否被当前角色勾选。 */
  checked: boolean
  /**
   * 行内动作集合（AC-23 的机械判据）：
   *  - `builtin`：可编辑 + **只**「恢复出厂」（不可删）；
   *  - 用户三源：可编辑 + **只**「删除」（没有出厂可恢复）。
   */
  actions: {
    edit: string
    /** `null` = 不渲染该按钮（不是 disabled）。 */
    restore: string | null
    /** `null` = 不渲染该按钮（不是 disabled）。 */
    delete: string | null
  }
  /** checkbox 的无障碍名（含标题与来源，屏幕阅读器要能区分同名技能）。 */
  checkboxLabel: string
}

/**
 * 技能行的全部可核验文案（纯函数，`test/client-ui.test.ts` 直接驱动）。
 *
 * 为什么动作集合在这里判：内置技能「不可删」是数据约束（宿主也拒），如果只写在 JSX 的
 * `{skill.source === 'builtin' ? null : …}` 里，`node --test` 就断言不到（本仓无 react-dom）。
 */
export function skillRowView(skill: SkillInfo, selected: boolean): SkillRowView {
  const source = (skill?.source ?? 'manual') as SkillSource
  const builtin = source === 'builtin'
  const modified = skill?.modified === true
  const title = str(skill?.title)
  const sourceLabel = skillSourceLabel(source)
  return {
    hook: 'data-skill-row',
    id: str(skill?.id),
    title,
    description: str(skill?.description),
    source,
    sourceLabel,
    sourceTone:
      builtin ? 'neutral' : source === 'imported' ? 'business' : source === 'system' ? 'success' : 'plain',
    modified,
    modifiedLabel: modified ? '已修改' : null,
    checked: selected === true,
    actions: {
      edit: '编辑',
      restore: builtin ? '恢复出厂' : null,
      delete: builtin ? null : '删除',
    },
    checkboxLabel: `选择技能：${title}（${sourceLabel}）`,
  }
}

/* ───────────────────── 模型弹层选择器（AC-16） ───────────────────── */

/**
 * 模型选择器按钮上的文案。
 *  - 空路由 → 「跟随会话默认」（`label-tertiary`，不是空按钮）；
 *  - 有值 → `provider/model`（`#effort` 有则带）。
 */
export function modelPickerLabel(model?: RoleModelRoute): string {
  const text = routeTextOf(model)
  return text === '' ? '跟随会话默认' : text
}

/* ───────────────────── 恢复默认确认对话框（AC-22） ───────────────────── */

export interface RestoreConfirmInput {
  /** 内置角色条数（来自快照，**不许写死** —— 写死会与用户看到的数据不符）。 */
  builtinRoles: number
  /** 自建角色条数（不受影响的那部分）。 */
  customRoles: number
  /** 用户技能（imported/system/manual）条数（不受影响的那部分）。 */
  userSkills: number
  /** 内置技能条数（被恢复出厂的那部分）。 */
  builtinSkills: number
}

export interface RestoreConfirmView {
  title: string
  lines: string[]
  confirmLabel: string
}

/**
 * 「恢复默认角色与内置技能」的二次确认文案。
 *
 * 三个数字全部来自入参（快照）—— 对话框里写死「11 个内置角色」在用户删过/加过之后就是假承诺，
 * 这属于本产品「诚实优先于好看」的硬规矩（AC-22）。
 */
export function restoreConfirmView(input: RestoreConfirmInput): RestoreConfirmView {
  const builtinRoles = countOf(input.builtinRoles)
  const customRoles = countOf(input.customRoles)
  const userSkills = countOf(input.userSkills)
  const builtinSkills = countOf(input.builtinSkills)
  return {
    title: '恢复默认角色与内置技能',
    lines: [
      `这会把 ${builtinRoles} 个内置角色与 ${builtinSkills} 条内置技能恢复为出厂版本：`,
      `· ${builtinRoles} 个内置角色 → 名称 / 描述 / 提示词 / 技能 / 模型全部回到出厂定义`,
      `· ${builtinSkills} 条内置技能 → 正文回到出厂，已修改标记清除`,
      customRoles + userSkills === 0
        ? '你还没有自建角色与自建/导入/系统技能，本次不会删除任何用户数据。'
        : `你的 ${customRoles} 个自建角色、${userSkills} 条自建/导入/系统技能不受影响。`,
    ],
    confirmLabel: '恢复默认',
  }
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
 * 胶囊/角标可拿到的阶段计数（取自 `currentRunStageInputOf`，与 run 卡/历史行同构）。
 * 任一缺失即交给 `runStageOf` 的最保守分支（绝不补 0）。
 */
export type PlanPillInput = Pick<
  RunStageInput,
  'planStatus' | 'done' | 'total' | 'running' | 'failed' | 'interrupted' | 'members'
>

/**
 * 胶囊/角标的状态段：文案只由 `runStageOf`（阶段判定表）派生，本函数不写状态中文。
 *  - 无计划 → 待开工（与「未启用」同义的输入框措辞，壳层语义见调用方注释）；
 *  - 暂停/已终止/已取消 → 阶段文案本身（没有进度可言）；
 *  - 全部完成 → `完成 x/N`（进度措辞；任务全绿时先说「完成」，阶段细节仍由面板承载）；
 *  - 其余 → `runStageOf(...).label`（派发中/执行中/待收口/计划就绪/待派发）。
 *
 * 「计划就绪」只可能来自规则 10：`draft + 零成员 + 零完成`。计数缺失时不会命中，
 * 因此不会再把「draft + 部分完成」误写成「计划就绪 · N 任务」（r26 修）。
 */
function planPillText(input: PlanPillInput): string {
  if (!input.planStatus) return '待开工'
  // 计数原样交给阶段判定（缺失即 undefined，不补 0）；只有「完成 x/N」这一进度措辞需要数字。
  const stage = runStageOf(input)
  if (stage.key === 'paused' || stage.key === 'terminated' || stage.key === 'cancelled') return stage.label
  const done = countOf(input.done)
  const total = countOf(input.total)
  if (total > 0 && done >= total) return `完成 ${done}/${total}`
  return stage.label
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
