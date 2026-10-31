/**
 * 上游交付（peer 直投）的**纯逻辑**模块：正文拼装 + 幂等筛选。
 *
 * 为什么单独成文件：同一份正文有两条消费路径 ——
 *   ① 进账本（`RunState.messages`，`from: 'peer'`，面板可回看）；
 *   ② 进下游成员的首条提示词（`buildMemberPrompt` 的「上游交接」段）。
 * 若两处各拼一份，措辞迟早分叉：面板上写「产物：无落盘产物」、成员上下文里却是另一种说法，
 * 用户与成员看到的事实不一致。所以正文只在这里拼一次，两条路径共用同一字符串（AC-4）。
 *
 * 依赖限制：**只 import `src/shared/types.ts`**（纯类型 + 无 IO），因此可被 `node --test`
 * 直接跑，也不需要起宿主。这里绝不 import `store.ts`（带 fs）或 `messages.ts`
 * （`makeMessage` 会覆盖我们预置的幂等键，见下）。
 */
import type { GateEvidence, MessageRecord, PlanTask } from '../../shared/types.ts'

/**
 * 证据尾部预算（字符）：成员读的是「结论靠不靠谱」，不是门禁日志全文。
 *
 * 取**末** 800 字而不是首 800：命令失败/成功的信息几乎总在输出末尾（断言汇总、退出前的最后几行），
 * 首 800 字通常只是进度条与编译日志。
 */
export const HANDOFF_TAIL_CHARS = 800

/** peer 交接消息的 id 前缀：`handoff:<上游>-><下游>`（AC-5 的幂等键）。 */
const HANDOFF_PREFIX = 'handoff:'

/** 没有落盘产物时的显式文案（AC-2 ⑤：不许静默省略这一段）。 */
const NO_ARTIFACTS = '无落盘产物'

/**
 * 幂等键：`handoff:<上游 taskId>-><下游 taskId>`。
 *
 * 为什么不用 `makeMessage()`：`src/host/team/messages.ts:31` 的 `makeMessage` **无条件**写
 * `messageId: 'msg-<at>-<seq>'`，会盖掉这里预置的幂等键；而 `appendMessage` 是「已有 id 则沿用」。
 * 于是「用 makeMessage 造 peer 消息」的症状是：单跑绿，重复 `applyReceipt` 才多出一条（最难 debug 的一类）。
 * 所以 `handoffMessages()` 直接构造 `MessageRecord`，不经 makeMessage。
 */
export function handoffId(upstreamTaskId: string, downstreamTaskId: string): string {
  return `${HANDOFF_PREFIX}${upstreamTaskId}->${downstreamTaskId}`
}

/**
 * 上游交付正文（AC-2 的五要素，逐字骨架见 TECHNICAL §4.3）：
 * 上游 `id`+`title` / 命令 / 退出码 / ≤800 字证据尾部 / 产物落盘路径（空则「无落盘产物」）。
 *
 * 正文里**不许出现 captain**：这段文字是「成员→成员」的直投，写「队长已转达」就等于
 * 自己承认信息还是过了一遍队长（AC-2 反面目标 3）。
 */
export function handoffBody(upstream: PlanTask, evidence: GateEvidence): string {
  const tail = evidence.tail ?? ''
  const truncated = tail.length > HANDOFF_TAIL_CHARS
  const shown = truncated ? tail.slice(-HANDOFF_TAIL_CHARS) : tail
  const lines = [
    `【上游直投】${upstream.id} ${upstream.title} 已通过门禁`,
    `命令：${evidence.command}`,
    `退出码：${evidence.exitCode ?? 'null'}`,
    `证据尾部（≤${HANDOFF_TAIL_CHARS} 字）：`,
    // 截断必须**显式标注**：否则成员会以为「输出就这么点」，把残缺证据当全部证据。
    truncated ? `（前文已截断，仅保留末 ${HANDOFF_TAIL_CHARS} 字）` : '',
    shown === '' ? '（无输出）' : shown,
    `产物：${evidence.artifacts.length === 0 ? NO_ARTIFACTS : evidence.artifacts.join('\n')}`,
  ]
  return lines.filter((line) => line !== '').join('\n')
}

/**
 * 生成 peer 交接消息（AC-1/AC-2/AC-5）：**纯函数、只算不落账**，落账由调用方 `appendMessage`。
 *
 * 触发口径（AC-1，四种输入各跑一次都必须精确）：
 *   - `upstreamVerdict !== 'done'` → 0 条（rework / failed 都不投）；
 *   - `evidence` 缺失 → 0 条（没跑过门禁就没有「已通过」可言）；
 *   - `evidence.exitCode !== 0` → 0 条（`null` = 超时/被信号杀，**也不是** 0）。
 *
 * 幂等（AC-5）：`existingIds` 里已有的 `handoff:<a>-><b>` 不再产出；同一批 `downstream`
 * 里重复传入同一个 B 也只产出 1 条。
 */
export function handoffMessages(input: {
  upstream: PlanTask
  evidence: GateEvidence | undefined
  upstreamVerdict: 'done' | 'rework' | 'failed'
  downstream: PlanTask[]
  at: number
  existingIds: readonly string[]
  targetOf: (downstreamTaskId: string) => { to: string; toMemberId?: string }
}): MessageRecord[] {
  const { upstream, evidence, upstreamVerdict, downstream, at, targetOf } = input
  if (upstreamVerdict !== 'done') return []
  if (!evidence) return []
  if (evidence.exitCode !== 0) return []

  // 一次投递的 fanout 共用同一个 body 字符串（AC-4a 的「逐字一致」也依赖这一点）。
  const body = handoffBody(upstream, evidence)
  const taken = new Set(input.existingIds)
  const out: MessageRecord[] = []
  for (const target of downstream) {
    const messageId = handoffId(upstream.id, target.id)
    if (taken.has(messageId)) continue
    taken.add(messageId)
    const dest = targetOf(target.id)
    const record: MessageRecord = {
      at,
      from: 'peer',
      to: dest.to,
      taskId: target.id,
      body,
      messageId,
    }
    if (dest.toMemberId !== undefined) record.toMemberId = dest.toMemberId
    out.push(record)
  }
  return out
}

/**
 * 某个下游任务的**全部**上游交接正文（AC-4(b)：注入成员首条提示词）。
 *
 * 过滤口径 = `messageId` 前缀 + `taskId`；按 `at` 正序（多个上游时按完成先后读，依赖链才讲得通）。
 * 只挑「注入用文本」，不做任何再拼装 —— 与账本里的 body 逐字相同。
 */
export function handoffBodiesFor(messages: readonly MessageRecord[], downstreamTaskId: string): string[] {
  return messages
    .filter(
      (message) =>
        typeof message.messageId === 'string' &&
        message.messageId.startsWith(HANDOFF_PREFIX) &&
        message.taskId === downstreamTaskId,
    )
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((message) => message.body)
}
