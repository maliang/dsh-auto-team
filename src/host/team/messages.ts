/**
 * 直达消息账本（AC-16 的可核验证据）。
 *
 * 每一条「队长 → 成员」或「成员 → 队长」的消息都记进 RunState.messages：
 * `from / to / toMemberId / taskId / at / body / messageId` —— 面板「成员」页原样展示，
 * 审计时能回答「这条返工意见是什么时候发给哪个成员的」，而不是靠日志里翻。
 *
 * 为什么单独成文件：账本要被单测直接钉住（上限、去重、按任务检索），
 * 不需要起宿主、也不需要文件系统；同时 dispatch / resume / receipt 三条路径共用同一套构造，
 * 避免三处各写一份 `{ at: Date.now(), ... }` 而字段名漂移。
 */
import type { MessageRecord } from '../../shared/types.ts'
import { MESSAGES_LIMIT, type RunState } from '../store.ts'

/** 构造消息的入参：`at` 缺省取当前时间（测试注入固定时钟，断言才可分）。 */
export interface MessageInput {
  from: string
  to: string
  toMemberId?: string
  taskId?: string
  body: string
  at?: number
}

/** 消息 id 的自增段：同一毫秒内的多条消息也能各自身份唯一。 */
let messageSeq = 0

/** 构造一条消息记录（**不落账**；落账用 appendMessage）。 */
export function makeMessage(input: MessageInput): MessageRecord {
  const at = input.at ?? Date.now()
  messageSeq += 1
  const record: MessageRecord = {
    at,
    from: input.from,
    to: input.to,
    body: input.body,
    messageId: `msg-${at}-${messageSeq}`,
  }
  if (input.toMemberId !== undefined) record.toMemberId = input.toMemberId
  if (input.taskId !== undefined) record.taskId = input.taskId
  return record
}

/** 追加一条消息到账本，超过 MESSAGES_LIMIT 丢最旧（与 store 落盘约束同源）。 */
export function appendMessage(state: RunState, message: MessageRecord): RunState {
  const record = message.messageId === undefined ? { ...message, messageId: nextMessageId(state, message.at) } : message
  const messages = [...state.messages, record]
  return { ...state, messages: messages.slice(Math.max(0, messages.length - MESSAGES_LIMIT)) }
}

/** 按任务检索消息（面板「成员」页证据链：一个任务从派发到返工的全部往返）。 */
export function messageForTask(state: RunState, taskId: string): MessageRecord[] {
  return state.messages.filter((message) => message.taskId === taskId)
}

/** 按成员检索消息（同一成员可能先后承担多个任务）。 */
export function messageForMember(state: RunState, memberId: string): MessageRecord[] {
  return state.messages.filter((message) => message.toMemberId === memberId || message.from === memberId)
}

/** 账本内唯一 id：`msg-<at>-<序号>`，与已有记录冲突时递增序号（不覆盖别人的审计记录）。 */
function nextMessageId(state: RunState, at: number): string {
  const taken = new Set(state.messages.map((message) => message.messageId))
  let seq = state.messages.length + 1
  let candidate = `msg-${at}-${seq}`
  while (taken.has(candidate)) {
    seq += 1
    candidate = `msg-${at}-${seq}`
  }
  return candidate
}
