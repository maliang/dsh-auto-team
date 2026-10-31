/**
 * 纯函数：Trigger 归一化 + Fast 层判定 + 面板可读文案。
 *
 * 为什么必须是纯模块（AC-12 ~ AC-15）：本文件要能被 `node --test` 直接跑，
 * 「四类构造器字段齐全」「reason 恰 7 码」「dropped 零副作用」这些断言才可能**必然**打红
 * （把 `fastOf` 短路成恒放行，用例立刻红）。因此这里零宿主依赖、零 IO、零定时器：
 * 时间从 `trigger.at` / `ctx.now` 注入，去重窗口从 `ctx.dedupeMs` 注入（唯一定义在 `config.ts`）。
 *
 * 归一化边界：真正读宿主事件 payload 的地方只有 `adapters.onHostTriggerEvents`；
 * 本文件只接收**已归一化**的中间量（runId / taskId / memberId / 退出码），
 * 所以这里不会出现任何宿主字段路径的读取（payload 解析全部在 adapters 层）。
 */

import type {
  FastReason,
  MemberBinding,
  PanelAction,
  Plan,
  PlanTask,
  TriggerKind,
  TriggerSource,
  TaskStatus,
} from '../../shared/types.ts'

/**
 * 一条待判定 / 已判定的 Trigger（归一化后的中间量）。
 *
 * 字段全部来自「构造它的人已经确知」的事实，没有一个需要推理：
 * 因此 Fast 层可以在零语义成本下判定（AC-14 的机械上限）。
 */
export interface Trigger {
  kind: TriggerKind
  /** `event` = 宿主事件即时触发；`poll` = watcher tick 兜底推导。 */
  source: TriggerSource
  runId: string
  at: number
  /** 任务型 Trigger（`gate_failed` / `dep_ready`）指向的任务。 */
  taskId?: string
  /** 成员型 Trigger（`member_exit` / `stall_timeout`）指向的成员。 */
  memberId?: string
  /**
   * `gate_failed` 专用：门禁退出码。`null` = 超时/被信号杀掉（与「命令返回非 0」必须区分，
   * 见 `GateEvidence.exitCode`），两者都算失败。
   */
  exitCode?: number | null
  /**
   * `dep_ready` 专用：这次让它就绪的前置任务 id（文案里写进括号，例如
   * 「任务 task-3，前置 task-2 已过门禁」）。构造器拿不到它时缺省，文案自动降级。
   */
  via?: string
  /** `member_exit` 专用：退出原因短语（`inactive` / `failed` / `interrupted`…），只用于文案。 */
  why?: string
}

/** Fast 层需要的运行视图（只读；`plan` 可选，调用方有就传，判据不依赖它）。 */
export interface TriggerRunView {
  runId: string
  plan?: Plan
  tasks: PlanTask[]
  bindings: MemberBinding[]
}

/** Fast 层输入（全部显式注入，无隐式时钟/无全局状态 → 幂等窗口可被精确断言）。 */
export interface FastContext {
  /** 会话开关：关闭时任何 Trigger 都不推进（AC-14 判据①）。 */
  enabled: boolean
  run: TriggerRunView
  /** 已放行记录（幂等判据）：只关心 `dedupeKey` 与放行时刻。 */
  accepted: ReadonlyArray<{ dedupeKey: string; at: number }>
  now: number
  /** 去重窗口（毫秒）：**由调用方从 `config.TRIGGER_DEDUPE_MS` 传入**，本文件不定义。 */
  dedupeMs: number
}

export interface FastVerdict {
  accepted: boolean
  reason: FastReason
  /** accepted 时要执行的既有 action；dropped 时**恒为 null**（零副作用的第一道机械保证）。 */
  action: PanelAction | null
}

/** Trigger 种类：**恰 4 个**（AC-13）。新增种类必须同时补归一化、Fast 判据与面板文案。 */
export const TRIGGER_KINDS: readonly TriggerKind[] = ['gate_failed', 'member_exit', 'dep_ready', 'stall_timeout']

/**
 * Slow 层（模型语义判定）默认关闭：本期零实现，切换判据见 TECHNICAL §7.8。
 *
 * `fastOf` **不读它** —— 读了就等于存在第二套分支，「最小 Fast 层」这个上限会悄悄失效。
 * 它只作为文档化开关出现在探针里（断言它为 false 时 accepted/dropped 序列与没有它时逐条相同）。
 */
export const TRIGGER_SLOW_LAYER = false

/* ───────────────────────── 构造器（四类归一化） ───────────────────────── */

/** `gate_failed`：门禁失败（退出码非 0，或超时/被信号杀掉）。 */
export function triggerFromGate(runId: string, task: PlanTask, at: number): Trigger {
  const evidence = task.evidence
  return {
    kind: 'gate_failed',
    source: 'event',
    runId,
    at,
    taskId: task.id,
    ...(evidence ? { exitCode: evidence.exitCode } : {}),
  }
}

/** `member_exit`：成员退出且工作没做完（`done` 不算退出，走 receipt 路径）。 */
export function triggerFromMemberExit(runId: string, memberId: string, why: string, at: number): Trigger {
  return { kind: 'member_exit', source: 'event', runId, at, memberId, why }
}

/** `dep_ready`：前置任务过门禁后，下游任务由 blocked 转 ready。 */
export function triggerFromDepReady(runId: string, task: PlanTask, at: number, via?: string): Trigger {
  return {
    kind: 'dep_ready',
    source: 'poll',
    runId,
    at,
    taskId: task.id,
    ...(via ? { via } : {}),
  }
}

/** `stall_timeout`：成员在 `STALL_MS` 内没有产出（时间型信号，只有 poll 通路）。 */
export function triggerFromStall(runId: string, memberId: string, at: number): Trigger {
  return { kind: 'stall_timeout', source: 'poll', runId, at, memberId }
}

/* ───────────────────────── 去重键 ───────────────────────── */

/** 去重键：`<kind>:<runId>:<entityId>`（entityId = taskId ?? memberId）。 */
export function dedupeKeyOf(kind: TriggerKind, runId: string, entityId: string): string {
  return `${kind}:${runId}:${entityId}`
}

/** 取一条 Trigger 的去重实体 id（任务型优先任务 id，成员型用成员 id）。 */
export function entityIdOf(trigger: Trigger): string {
  return trigger.taskId ?? trigger.memberId ?? trigger.runId
}

/** 取一条 Trigger 的去重键（`dedupeKeyOf` 的唯一推荐入口，避免两处各拼一份）。 */
export function dedupeKeyFor(trigger: Trigger): string {
  return dedupeKeyOf(trigger.kind, trigger.runId, entityIdOf(trigger))
}

/* ───────────────────────── Fast 层（零语义调用） ───────────────────────── */

/**
 * 各 kind 认可的任务状态（AC-14 判据④「任务状态」）。
 *
 * 判据刻意写成白名单而不是「排除法」：新增状态时默认**不推进**（fail-closed），
 * 而不是默认放行 —— 自动推进做错一次（对着 `done` 的任务再派一次）比少推进一次贵得多。
 *
 * - `gate_failed` 只对 `rework` 成立：失败证据已落盘、等成员返工；
 * - `dep_ready` 只对还没开跑的状态成立：`done` 又收到依赖完成不该再派；
 * - `member_exit` 对「已经起过人、还没收尾」的状态成立（`done` 的成员不需要续聊）；
 * - `stall_timeout` 只对「成员本应在产出」的状态成立。
 */
const KIND_STATES: Readonly<Record<TriggerKind, readonly TaskStatus[]>> = {
  gate_failed: ['rework'],
  dep_ready: ['pending', 'blocked', 'ready'],
  member_exit: ['running', 'gate', 'rework', 'failed', 'interrupted'],
  stall_timeout: ['running', 'gate'],
}

/** 成员型 kind：`memberId` 必须能在 bindings 里定位到人（判据④「成员存在性」）。 */
const MEMBER_KINDS: ReadonlyArray<TriggerKind> = ['member_exit', 'stall_timeout']

const REASON_TEXT: Readonly<Record<FastReason, string>> = {
  ok: '已推进',
  not_enabled: '会话开关已关闭',
  not_listened: '不在监听的 Trigger 种类内',
  unknown_entity: '任务/成员不属于当前这次运行',
  task_state: '任务当前状态不接受这类推进',
  gate_exit_zero: '门禁退出码不是失败（0 或证据缺失）',
  duplicate: '同一事件在去重窗口内已推进过',
}

/** Fast 层判定（固定顺序，命中即返回；见 TECHNICAL §7.2 的判据表）。 */
export function fastOf(trigger: Trigger, ctx: FastContext): FastVerdict {
  const drop = (reason: FastReason): FastVerdict => ({ accepted: false, reason, action: null })

  // ① 会话开关关闭：任何事件都不推进。
  if (!ctx.enabled) return drop('not_enabled')

  // ② 不在四类监听集合内。
  if (!TRIGGER_KINDS.includes(trigger.kind)) return drop('not_listened')

  // ③ 实体必须属于**当前这次运行**。这里同时覆盖「runId 不匹配」（过期 run 的事件）
  //    与「id 找不到」两种情况 —— 全仓只有这一处做这个判断，别的模块不得各写一份。
  if (trigger.runId !== ctx.run.runId) return drop('unknown_entity')
  const task = trigger.taskId ? (ctx.run.tasks.find((it) => it.id === trigger.taskId) ?? null) : null
  if (trigger.taskId && !task) return drop('unknown_entity')

  const isMemberKind = MEMBER_KINDS.includes(trigger.kind)
  const binding = trigger.memberId ? (ctx.run.bindings.find((it) => it.memberId === trigger.memberId) ?? null) : null
  if (isMemberKind && !binding) return drop('unknown_entity')

  // 成员型 Trigger 用「绑定的任务」判状态；绑定指向的任务不在本次计划里同样算找不到。
  const boundTask = isMemberKind && binding ? (ctx.run.tasks.find((it) => it.id === binding.taskId) ?? null) : task
  if (isMemberKind && binding && !boundTask) return drop('unknown_entity')
  if (!isMemberKind && !task) return drop('unknown_entity')

  // ④ 任务状态是否为该 kind 认可的推进入口。
  const states = KIND_STATES[trigger.kind]
  const status = boundTask?.status
  if (!status || !states.includes(status)) return drop('task_state')

  // ⑤ 门禁退出码：`null` 是「超时 / 被信号杀掉」，属于**失败**必须放行；只有 `0` 与
  //    「退出码缺失（证据不全）」不构成「门禁失败」，不得据此推动决策。
  if (trigger.kind === 'gate_failed') {
    const exitCode = trigger.exitCode !== undefined ? trigger.exitCode : boundTask?.evidence?.exitCode
    if (exitCode === undefined || exitCode === 0) return drop('gate_exit_zero')
  }

  // ⑥ 去重窗口：判据是「最近一次 accepted 的时刻」，不是时间桶 —— 注入时钟即可精确断言。
  const key = dedupeKeyFor(trigger)
  const windowed = ctx.accepted.some((rec) => rec.dedupeKey === key && ctx.now - rec.at < ctx.dedupeMs)
  if (windowed) return drop('duplicate')

  // ⑦ 放行：action 只映射到既有 11 个 PanelAction，不新增动作。
  return { accepted: true, reason: 'ok', action: actionOf(trigger) }
}

/** kind → 既有 action（AC-16：推进只有一个出口，这里是唯一映射表）。 */
export function actionOf(trigger: Trigger): PanelAction {
  switch (trigger.kind) {
    case 'dep_ready':
      return { type: 'dispatch', runId: trigger.runId }
    case 'gate_failed':
      return { type: 'message', taskId: trigger.taskId, text: gateFailedReminderOf(trigger) }
    case 'member_exit':
      return { type: 'resume', memberId: trigger.memberId }
    case 'stall_timeout':
      return { type: 'message', memberId: trigger.memberId, text: stallReminderOf(trigger) }
  }
}

function gateFailedReminderOf(trigger: Trigger): string {
  const code = trigger.exitCode === null ? '超时/被信号中止' : `退出码 ${trigger.exitCode ?? '未知'}`
  return `门禁未通过（${code}）。请按证据修复后重新自述完成：这是自动推进，不需要重述计划。`
}

function stallReminderOf(trigger: Trigger): string {
  return '检测到一段时间没有产出。请回一句当前进展与下一步；若被阻塞，直接说明卡在哪。'
}

/* ───────────────────────── 面板文案（AC-17：三段式） ───────────────────────── */

const KIND_PHRASE: Readonly<Record<TriggerKind, string>> = {
  gate_failed: '门禁失败',
  member_exit: '成员退出',
  dep_ready: '依赖完成',
  stall_timeout: '超时无产出',
}

/** 实体标签：任务型写任务、成员型写成员（文案里的第二段括号内容）。 */
export function entityLabelOf(trigger: Trigger): string {
  if (trigger.taskId) {
    return trigger.via ? `任务 ${trigger.taskId}，前置 ${trigger.via} 已过门禁` : `任务 ${trigger.taskId}`
  }
  if (trigger.memberId) {
    return trigger.why ? `成员 ${trigger.memberId}，原因 ${trigger.why}` : `成员 ${trigger.memberId}`
  }
  return `运行 ${trigger.runId}`
}

/** accepted 时的结果短语（按 kind，动作类型兜底）。 */
function resultTextOf(trigger: Trigger, action: PanelAction['type'] | undefined): string {
  switch (trigger.kind) {
    case 'dep_ready':
      return '已请求派发就绪任务'
    case 'gate_failed':
      return '已把失败证据发回成员，任务转 rework 等返工'
    case 'member_exit':
      return '已按续聊恢复成员（不重派，避免重复副作用）'
    case 'stall_timeout':
      return '已催一次进展（不改任务状态）'
  }
  return action ? `已执行 ${action}` : '已推进'
}

/**
 * 面板可读原因（AC-17）：固定三段式 **因「<中文短语>」（<实体>）推进：<结果>**。
 *
 * dropped 时同一骨架写成 **未推进：「<短语>」（<实体>）：<为什么>** —— 「为什么没推进」
 * 与「为什么推进」必须一样可读，否则面板只能解释成功的那一半。
 */
export function triggerSentenceOf(
  trigger: Trigger,
  verdict: { accepted: boolean; reason: FastReason; action?: PanelAction['type'] },
): string {
  const phrase = KIND_PHRASE[trigger.kind] ?? trigger.kind
  const entity = entityLabelOf(trigger)
  if (!verdict.accepted) return `未推进：「${phrase}」（${entity}）：${REASON_TEXT[verdict.reason] ?? verdict.reason}`
  return `因「${phrase}」（${entity}）推进：${resultTextOf(trigger, verdict.action)}`
}
