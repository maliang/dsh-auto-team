/**
 * 用量事件归一 + 累加 + 三态判定（r13 AC-19）。
 *
 * 为什么独立成模块：宿主 session/event 的 payload 形状**尚未验证**（TECHNICAL §0 U1），
 * 把「哪些字段算 usage、哪个 id 是成员」全部收敛到纯函数里，才能用单测覆盖三态与 fail-open，
 * 而不是把未验证的猜法直接塞进 `index.ts` 的订阅回调里（那里一错就是整条 entry 不激活）。
 *
 * 三态（降级只允许单向 `per-member → aggregate-only → unavailable`，禁止回升）：
 *   - `per-member`：事件带成员身份，token 归到成员（进而归到任务）；
 *   - `aggregate-only`：只拿到无身份的 usage，只能算 run 合计；
 *   - `unavailable`：一次都没有拿到数字（或调用方判定容器根本不发 usage）。
 *
 * `0` 是**合法用量**（provider 明确说这次没花钱），与「不可得」靠 `UsageCell.source` 区分：
 * 估算补 0 会让面板看起来「跑完了但没花钱」，那是造假。
 */

import type { TokenTotals, UsageCell } from '../../shared/types.ts'
import type { MemberBinding } from '../../shared/types.ts'
import { usageCellOf } from '../format.ts'
import type { UsageRecord } from '../store.ts'

/** 三态归属（落盘形态见 `store.UsageRecord.attribution`）。 */
export type UsageAttribution = 'per-member' | 'aggregate-only' | 'unavailable'

const RANK: Record<UsageAttribution, number> = {
  'per-member': 2,
  'aggregate-only': 1,
  unavailable: 0,
}

/** 归一样本：只带数字，不带宿主原始结构。 */
export interface UsageEventInput {
  /** 事件里的会话/成员 id 原文（能否对上成员由调用方用 {@link memberIdOf} 判定）。 */
  sessionId?: string
  /** 已经解析出的成员 id；缺省 = 该事件没有身份（只能进 aggregate-only）。 */
  memberId?: string
  /** 已经解析出的任务 id（可选，用于按任务直接归属）。 */
  taskId?: string
  usage: Partial<TokenTotals>
  /** 去重键（`eventId ?? `${sessionId}:${seq}``），与 payload 一起归一出，上层不必再解析一遍。 */
  eventKey?: string
}

/** 宿主可能发出的事件类型（只认 assistant 消息，其余一律忽略）。 */
const MESSAGE_EVENT_TYPES = new Set(['assistant/message', 'assistant.message', 'message.assistant'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const num = finiteOrUndefined(value)
    if (num !== undefined) return num
  }
  return undefined
}

/** 把任意 `usage` 片段收敛成 `TokenTotals`；一个数字都没有 → null（该事件不计用量）。 */
export function tokenTotalsOf(raw: unknown): TokenTotals | null {
  if (!isRecord(raw)) return null
  const input = firstNumber(raw.inputTokens, raw.input, raw.promptTokens, raw.prompt)
  const output = firstNumber(raw.outputTokens, raw.output, raw.completionTokens, raw.completion)
  const declared = firstNumber(raw.totalTokens, raw.total)
  if (declared === undefined && input === undefined && output === undefined) return null
  const total = declared ?? (input ?? 0) + (output ?? 0)
  const totals: TokenTotals = { total }
  if (input !== undefined) totals.input = input
  if (output !== undefined) totals.output = output
  return totals
}

/** 两条合计相加：缺失分项按 0 参与，结果只带**真的有过**的分项，避免凭空补 0。 */
function addTotals(current: TokenTotals | undefined, add: TokenTotals): TokenTotals {
  const next: TokenTotals = { total: (current?.total ?? 0) + add.total }
  const input = (current?.input ?? 0) + (add.input ?? 0)
  const output = (current?.output ?? 0) + (add.output ?? 0)
  if (current?.input !== undefined || add.input !== undefined) next.input = input
  if (current?.output !== undefined || add.output !== undefined) next.output = output
  return next
}

function sumByMember(record: UsageRecord): TokenTotals | undefined {
  let acc: TokenTotals | undefined
  for (const totals of Object.values(record.byMember ?? {})) acc = addTotals(acc, totals)
  return acc
}

/**
 * 把宿主 payload 归一成 {@link UsageEventInput}；不是「assistant 消息带用量」就返回 null。
 *
 * 真实宿主签名（`cordis_inspect_query(platform=host, provider=Event, method=listEvents,
 * input={"event":"session/event"})` 的原文）：
 *   `'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void`
 * 即监听器收到**两个参数**：会话对象（`session.id` 是 SessionId）与事件对象
 * （`{ type, seq, time, data }`，用量在 `event.data.usage`，类型是 `assistant/message`）。
 *
 * r13 初版只按「单参数对象」解析，真实形状下一条都取不到 → 归属恒为 `unavailable`、
 * 面板整列显示「不可得」。这里**优先**按真实签名解析，旧形状继续兼容（历史单测 +
 * 宿主将来换壳不至于整块失效）。
 */
export function usageOfSessionEvent(payload: unknown): UsageEventInput | null {
  const hostShape = usageOfHostArgs(payload)
  if (hostShape !== undefined) return hostShape
  if (!isRecord(payload)) return null
  // 事件包裹层：宿主可能给 { type, event } / { type, message } / 直接就是事件体。
  const body = isRecord(payload.event) ? payload.event : isRecord(payload.message) ? payload.message : payload
  const type =
    typeof payload.type === 'string' ? payload.type : typeof body.type === 'string' ? body.type : undefined
  if (type !== undefined && !MESSAGE_EVENT_TYPES.has(type)) return null
  const usage = tokenTotalsOf(body.usage ?? payload.usage)
  if (!usage) return null

  const agent = isRecord(body.agent) ? body.agent : isRecord(payload.agent) ? payload.agent : undefined
  const sessionId =
    firstString(body.sessionId, payload.sessionId, body.agentId, payload.agentId, agent?.id) ?? undefined
  const seq = firstNumber(body.seq, payload.seq)
  const eventId = firstString(body.eventId, body.id, payload.eventId, payload.id)
  const eventKey = eventId ?? (sessionId !== undefined ? `${sessionId}:${seq ?? '?'}` : undefined)

  const input: UsageEventInput = { usage }
  if (sessionId !== undefined) input.sessionId = sessionId
  if (taskIdOf(payload, body) !== undefined) input.taskId = taskIdOf(payload, body)
  if (eventKey !== undefined) input.eventKey = eventKey
  return input
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === 'string' && value !== '') return value
  return undefined
}

/**
 * 真实宿主形状解析；`undefined` = 不是这个形状（交给旧逻辑），`null` = 是但没用量。
 *
 * 三种包裹都见过：监听器数组 `[session, event]`、对象 `{ session, event }`、
 * 以及直接给事件本身（`{ type, seq, data }`）。
 */
function usageOfHostArgs(payload: unknown): UsageEventInput | null | undefined {
  const pair = hostPairOf(payload)
  if (pair === undefined) return undefined
  const type = typeof pair.event.type === 'string' ? pair.event.type : undefined
  if (type === undefined || !MESSAGE_EVENT_TYPES.has(type)) return null
  const data = isRecord(pair.event.data) ? pair.event.data : undefined
  const usage = tokenTotalsOf(data?.usage ?? pair.event.usage)
  if (!usage) return null

  const sessionId = firstString(
    isRecord(pair.session) ? firstString(pair.session.id) : undefined,
    data?.sessionId,
    pair.event.sessionId,
    data?.agentId,
  )
  const seq = firstNumber(pair.event.seq, data?.seq)
  const eventId = firstString(pair.event.eventId, pair.event.id)
  const eventKey = eventId ?? (sessionId !== undefined ? `${sessionId}:${seq ?? '?'}` : undefined)
  const taskId = firstString(data?.taskId, pair.event.taskId)

  const input: UsageEventInput = { usage }
  if (sessionId !== undefined) input.sessionId = sessionId
  if (taskId !== undefined) input.taskId = taskId
  if (eventKey !== undefined) input.eventKey = eventKey
  return input
}

function hostPairOf(
  payload: unknown,
): { session?: Record<string, unknown>; event: Record<string, unknown> } | undefined {
  if (Array.isArray(payload)) {
    const [first, second] = payload as unknown[]
    if (isRecord(second) && typeof second.type === 'string') {
      return { session: isRecord(first) ? first : undefined, event: second }
    }
    if (isRecord(first) && typeof first.type === 'string') return { event: first }
    return undefined
  }
  if (!isRecord(payload)) return undefined
  // `{ session, event }`：只有当 event 自己带 type 才认，否则会把旧的 `{ type, event }` 抢走。
  if (isRecord(payload.event) && typeof payload.event.type === 'string') {
    return { session: isRecord(payload.session) ? payload.session : undefined, event: payload.event }
  }
  // 事件本体：`{ type, seq, data: {...} }`
  if (typeof payload.type === 'string' && isRecord(payload.data)) return { event: payload }
  return undefined
}

/** payload 里若已带任务 id 就直接用（宿主将来若补字段，这里一处即可跟上）。 */
function taskIdOf(payload: Record<string, unknown>, body: Record<string, unknown>): string | undefined {
  return firstString(body.taskId, payload.taskId)
}

/**
 * 身份匹配：payload 里的 agent/session id 若等于某个 binding 的 `memberId`，就归到该成员。
 *
 * 匹配不到**不猜**（不按名字、不按时间最近），返回 undefined → 该事件降级为 aggregate-only。
 */
export function memberIdOf(bindings: ReadonlyArray<MemberBinding> | undefined, candidate: string | undefined): string | undefined {
  if (!candidate || !bindings) return undefined
  return bindings.some((binding) => binding?.memberId === candidate) ? candidate : undefined
}

/**
 * 累加一次用量事件（纯函数，返回新记录，不改入参）。
 *
 * 归属只能降级：一次「无身份」事件会让 run 从 `per-member` 掉到 `aggregate-only`，此后
 * 即使再收到带身份的事件也不回升 —— 否则合计会与分项对不上（同一段时间被记两次）。
 */
export function applyUsage(record: UsageRecord | undefined, event: UsageEventInput, now: number): UsageRecord {
  const base: UsageRecord = record ?? { attribution: 'unavailable', byMember: {}, byTask: {}, updatedAt: now }
  const next: UsageRecord = {
    ...base,
    attribution: base.attribution,
    byMember: { ...(base.byMember ?? {}) },
    byTask: { ...(base.byTask ?? {}) },
    updatedAt: now,
  }
  const totals = tokenTotalsOf(event.usage)
  if (!totals) return next

  const hasData = base.total !== undefined || Object.keys(next.byMember).length > 0
  const candidate: UsageAttribution = event.memberId ? 'per-member' : 'aggregate-only'
  next.attribution = hasData ? (RANK[candidate] < RANK[base.attribution] ? candidate : base.attribution) : candidate
  if (event.memberId) next.byMember[event.memberId] = addTotals(next.byMember[event.memberId], totals)
  if (event.taskId) next.byTask[event.taskId] = addTotals(next.byTask[event.taskId], totals)
  next.total = addTotals(next.total, totals)
  return next
}

const NO_EVENT_REASON = '尚无用量事件'
const NO_PROVIDER_REASON = '宿主未上报本 run 的用量'

/** run 级用量单元格：`record` 存在且有数字才 `provider`（含 0），否则 `unavailable` + 原因。 */
export function runUsageOf(record: UsageRecord | undefined): UsageCell {
  if (!record) return { source: 'unavailable', reason: NO_EVENT_REASON }
  if (record.attribution === 'unavailable' && record.total === undefined) {
    return { source: 'unavailable', reason: NO_PROVIDER_REASON }
  }
  const totals = record.total ?? sumByMember(record)
  return usageCellOf(totals, NO_PROVIDER_REASON)
}

/** 任务级用量单元格：优先 byTask，其次 byMember（该任务的成员），最后按归属状态给原因。 */
export function taskUsageOf(record: UsageRecord | undefined, taskId: string, memberId?: string): UsageCell {
  if (!record) return { source: 'unavailable', reason: NO_EVENT_REASON }
  const byTask = record.byTask?.[taskId]
  if (byTask) return usageCellOf(byTask, NO_PROVIDER_REASON)
  if (memberId) {
    const byMember = record.byMember?.[memberId]
    if (byMember) return usageCellOf(byMember, NO_PROVIDER_REASON)
  }
  if (record.attribution === 'aggregate-only') {
    return { source: 'unavailable', reason: '宿主只上报了 run 合计，未按成员归属' }
  }
  if (record.attribution === 'per-member') {
    return { source: 'unavailable', reason: '该任务还没有用量事件' }
  }
  return { source: 'unavailable', reason: NO_PROVIDER_REASON }
}

/**
 * 进程内事件去重（不落盘）：同一事件被重复投递时不能重复累加。
 *
 * 上限 FIFO 淘汰（默认 2000）：一个长 run 的消息量可能上万，无界 Set 会把内存吃掉；
 * 只保留最近 2000 个 key 足以覆盖宿主重投窗口（事件按序投递，重复一定相邻）。
 */
export interface UsageDeduper {
  /** true = 这个 key 已经处理过（本次应跳过）。首次出现返回 false 并记住。 */
  seen(runId: string, key: string): boolean
  /** 丢掉某个 run 的记录（run 结束/重置时调用）。 */
  drop(runId: string): void
  size(): number
}

export function createUsageDeduper(limit = 2_000): UsageDeduper {
  const keys = new Map<string, true>()
  return {
    seen(runId: string, key: string): boolean {
      const full = `${runId}\u0000${key}`
      if (keys.has(full)) return true
      keys.set(full, true)
      while (keys.size > limit) {
        const oldest = keys.keys().next().value
        if (oldest === undefined) break
        keys.delete(oldest)
      }
      return false
    },
    drop(runId: string): void {
      const prefix = `${runId}\u0000`
      for (const key of [...keys.keys()]) if (key.startsWith(prefix)) keys.delete(key)
    },
    size(): number {
      return keys.size
    },
  }
}
