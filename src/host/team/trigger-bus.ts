/**
 * Trigger 总线（AC-13 / AC-15 / AC-18）：把四类事件归一化成**一次**可解释的推进。
 *
 * 三层职责，刻意不合并：
 *  1. {@link fastOf}（`./trigger.ts`）判「要不要推进」——纯函数、零语义调用、恰 7 个原因码；
 *  2. 本文件负责**编排**：读运行账本 → 取判定 → accepted 时调 `bridge.act` 既有 action →
 *     把 accepted / dropped 都记账（否则「为什么没推进」事后无从排查）。
 *     推进只有一个出口（`bridge.act`），这里**不实现任何动作**——否则同一个动作会有两套实现；
 *  3. `watcher.tick` 每轮调 {@link TriggerBus.poll} 兜底（AC-18 的降级通路），
 *     事件通路（宿主 `tools/result` 等订阅）即时调 {@link TriggerBus.push}。
 *
 * 幂等（AC-15）：去重键 = `kind:runId:taskId|memberId`，窗口 = `config.TRIGGER_DEDUPE_MS`，
 * 判据是「最近一次 accepted 的 `at`」而不是时间桶 —— 所以注入时钟就能精确断言
 * 「同 key 连投 5 次 = 1 次推进」「窗口过期后可再投 1 次」，不需要 sleep。
 */
import type { FastReason, PanelAction, RejectionCode, TriggerKind, TriggerRecord } from '../../shared/types.ts'
import type { Bridge } from '../bridge.ts'
import { TRIGGER_DEDUPE_MS } from '../config.ts'
import { readyTasks } from '../plan/graph.ts'
import type { RunState, RunsStore } from '../store.ts'
import {
  dedupeKeyFor,
  fastOf,
  triggerFromDepReady,
  triggerFromGate,
  triggerFromMemberExit,
  triggerFromStall,
  triggerSentenceOf,
  type FastContext,
  type Trigger,
  type TriggerRunView,
} from './trigger.ts'

/** 事件源不可用时的降级说明（面板 `degraded` 提示直接显示这句）。 */
const EVENT_SOURCE_DOWN = '事件源不可用：推进退回 watcher 轮询兜底（最多慢一个 tick）'

/**
 * 「状态事实」型 Trigger：一旦**放行过**就不再轮询重推。
 *
 * 它们是已落盘的状态（门禁失败证据 / 成员已退出），不是会再发生一次的瞬时事件；
 * 而 `dep_ready` / `stall_timeout` 是过程型信号，窗口过期后可以再推一次提醒。
 */
const ONCE_KINDS: readonly TriggerKind[] = ['gate_failed', 'member_exit']

export interface TriggerBusHealth {
  degraded: boolean
  /** 降级的可读原因（`degraded === false` 时缺省）。 */
  reason?: string
}

export interface TriggerBusDeps {
  store: RunsStore
  bridge: Bridge
  /** 注入时钟：幂等窗口的断言不靠 sleep。 */
  now: () => number
  /** 去重窗口；缺省 `TRIGGER_DEDUPE_MS`（测试注入小时才需要显式传）。 */
  dedupeMs?: number
}

export interface TriggerBus {
  /** 事件通路：即时投一条 Trigger（宿主事件 → 判定 → 推进 / 丢弃）。 */
  push(trigger: Trigger): Promise<TriggerRecord>
  /** 轮询通路：从运行状态推导四类候选（`watcher.tick` 每轮调用）。 */
  poll(state: RunState): Promise<TriggerRecord[]>
  /** 面板 `degraded` 提示的数据源。 */
  health(): TriggerBusHealth
  /** 宿主事件订阅是否可用（订阅失败 → watcher 的 poll 兜底成为唯一通路）。 */
  setEventSource(available: boolean): void
}

/** 构造 Trigger 总线（纯编排，无宿主依赖：动作只经由 `bridge.act`）。 */
export function createTriggerBus(deps: TriggerBusDeps): TriggerBus {
  const dedupeMs = deps.dedupeMs ?? TRIGGER_DEDUPE_MS
  let eventSource = true
  let failure: string | null = null

  /**
   * 串行化：事件通路与轮询通路会并发进来，而两边都是「读账本 → 判定 → 追加记录」。
   * 不排队就会互相覆盖保存（后写的把先写的记录整段盖掉，表现为「推进了但面板没记录」）。
   */
  let tail: Promise<unknown> = Promise.resolve()
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = tail.then(run, run)
    tail = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  function recordOf(
    trigger: Trigger,
    verdict: {
      accepted: boolean
      reason: FastReason
      action?: PanelAction['type']
      rejected?: RejectionCode
    },
  ): TriggerRecord {
    return {
      at: deps.now(),
      kind: trigger.kind,
      source: trigger.source,
      runId: trigger.runId,
      ...(trigger.taskId === undefined ? {} : { taskId: trigger.taskId }),
      ...(trigger.memberId === undefined ? {} : { memberId: trigger.memberId }),
      dedupeKey: dedupeKeyFor(trigger),
      accepted: verdict.accepted,
      reason: verdict.reason,
      text: triggerSentenceOf(trigger, verdict),
      ...(verdict.action === undefined ? {} : { action: verdict.action }),
      ...(verdict.rejected === undefined ? {} : { rejected: verdict.rejected }),
    }
  }

  /** 追加一条推进记录（重新读盘再写：`save` 是整份覆盖，用旧 state 会吃掉动作副作用）。 */
  function append(runId: string, record: TriggerRecord): void {
    const current = deps.store.load(runId)
    if (current === null) return
    deps.store.save({ ...current, triggers: [...(current.triggers ?? []), record] })
  }

  function fastContextOf(state: RunState, enabled: boolean): FastContext {
    const run: TriggerRunView = {
      runId: state.plan.runId,
      plan: state.plan,
      tasks: state.plan.tasks,
      bindings: state.bindings,
    }
    return {
      enabled,
      run,
      // 只喂**已放行**记录：`fastOf` 的幂等判据是「最近一次 accepted 的时刻」，
      // 喂进 dropped 记录会让「先被状态拒过一次」永久挡住后面合法的推进。
      accepted: (state.triggers ?? [])
        .filter((record) => record.accepted)
        .map((record) => ({ dedupeKey: record.dedupeKey, at: record.at })),
      now: deps.now(),
      dedupeMs,
    }
  }

  /** 判定一条 Trigger 并记账；accepted 时经由 `bridge.act`（唯一推进出口）执行既有 action。 */
  async function adjudicate(trigger: Trigger): Promise<TriggerRecord> {
    const loaded = deps.store.load(trigger.runId)
    if (loaded === null) {
      // 盘上没有这个 run（过期事件 / 手搓 runId）：没有账本可落，只返回可解释的丢弃记录。
      return recordOf(trigger, { accepted: false, reason: 'unknown_entity' })
    }

    const verdict = fastOf(trigger, fastContextOf(loaded, deps.bridge.enabled(loaded.plan.sessionId)))
    if (!verdict.accepted || verdict.action === null) {
      const record = recordOf(trigger, { accepted: false, reason: verdict.reason })
      append(trigger.runId, record)
      return record
    }

    const result = await deps.bridge.act(loaded.plan.sessionId, verdict.action)
    const record = recordOf(trigger, {
      accepted: true,
      reason: 'ok',
      action: verdict.action.type,
      // 动作发出但被业务拒绝（并发已满等）不改「放行」判定，只留痕（AC-15）。
      ...(result.rejected === undefined ? {} : { rejected: result.rejected.code }),
    })
    append(trigger.runId, record)
    return record
  }

  function recentlyAdjudicated(ledger: readonly TriggerRecord[], trigger: Trigger): boolean {
    const key = dedupeKeyFor(trigger)
    const same = ledger.filter((record) => record.dedupeKey === key)
    if (same.length === 0) return false
    // ① 状态事实型：放行过就不再重推（否则同一份失败证据每 60s 提醒一次）。
    if (ONCE_KINDS.includes(trigger.kind) && same.some((record) => record.accepted)) return true
    // ② 刚判定过（含被丢弃）：窗口内不再判定 —— 否则每个 tick 都会往账本写一条 dropped，
    //    100 条上限几轮就被刷掉，真正要看的推进记录反而没了。
    const now = deps.now()
    return same.some((record) => now - record.at < dedupeMs)
  }

  /** `dep_ready` 的 `via`：让它就绪的前置任务（取证据时刻最晚的那个，文案里点名）。 */
  function lastDoneDepOf(state: RunState, task: RunState['plan']['tasks'][number]): string | undefined {
    let best: { id: string; at: number } | null = null
    for (const depId of task.dependsOn ?? []) {
      const dep = state.plan.tasks.find((item) => item.id === depId)
      if (dep?.status !== 'done') continue
      const at = dep.evidence?.at ?? 0
      if (best === null || at >= best.at) best = { id: depId, at }
    }
    return best?.id
  }

  /**
   * 轮询候选：四类各推导一次。
   *
   * 这里只做「从运行状态里能不能看出这类信号存在」，**放不放行仍由 `fastOf` 决定**
   * （状态白名单、退出码、去重窗口都在那边）—— 避免出现第二套判定口径。
   */
  function candidatesOf(live: RunState): Trigger[] {
    const at = deps.now()
    const runId = live.plan.runId
    const ledger = deps.store.load(runId)?.triggers ?? live.triggers ?? []
    const out: Trigger[] = []
    const offer = (trigger: Trigger): void => {
      if (recentlyAdjudicated(ledger, trigger)) return
      // 轮询通路一律标 `poll`：构造器里 gate/member 的缺省来源是 `event`（事件通路语义），
      // 面板「最近推进」要能分清「因事件即时推进」还是「兜底轮询推进」。
      out.push({ ...trigger, source: 'poll' })
    }

    // ① dep_ready：依赖图推导复用 `plan/graph.readyTasks`（不另写一遍「依赖是否都完成」）。
    const readyIds = new Set(readyTasks(live.plan.tasks))
    for (const task of live.plan.tasks) {
      if (!readyIds.has(task.id)) continue
      // 无依赖的任务不是「依赖完成」事件（那是派发时机，不是本题的推进信号）。
      if ((task.dependsOn ?? []).length === 0) continue
      // 镜像 `fastOf` 的 dep_ready 白名单（rework 由门禁失败通路负责，避免两路重复推）。
      if (task.status !== 'pending' && task.status !== 'ready') continue
      offer(triggerFromDepReady(runId, task, at, lastDoneDepOf(live, task)))
    }

    // ② gate_failed：失败证据已落盘、等成员返工。
    for (const task of live.plan.tasks) {
      if (task.status !== 'rework') continue
      const evidence = task.evidence
      if (evidence === undefined || evidence.exitCode === 0) continue
      offer(triggerFromGate(runId, task, at))
    }

    // ③ member_exit：watcher 对账判出的失联（必须真有绑定，否则 fastOf 会判 unknown_entity）。
    for (const task of live.plan.tasks) {
      const memberId = task.memberId
      if (memberId === undefined) continue
      if (task.status !== 'interrupted' && task.status !== 'failed') continue
      if (!live.bindings.some((binding) => binding.memberId === memberId)) continue
      offer(triggerFromMemberExit(runId, memberId, task.status, at))
    }

    // ④ stall_timeout：只认**本次窗口内**新产生的停滞告警（`stallAlertsOf` 每个 episode 一条），
    //    过期告警重推没有意义 —— 成员要么已经恢复，要么已有下一次告警覆盖。
    for (const alert of live.stallAlerts ?? []) {
      if (alert.kind !== 'tool' || alert.memberId === undefined) continue
      if (at - alert.at >= dedupeMs) continue
      offer(triggerFromStall(runId, alert.memberId, alert.at))
    }

    return out
  }

  return {
    push(trigger: Trigger): Promise<TriggerRecord> {
      return serial(async () => {
        try {
          const record = await adjudicate(trigger)
          failure = null
          return record
        } catch (error) {
          // 记账/动作通道异常不是「7 个原因码」之一，也不该被伪装成某条业务拒绝：
          // 记进健康状态后原样抛给调用方（事件订阅侧会记日志，下一轮 poll 仍会兜底）。
          failure = `推进通道异常：${error instanceof Error ? error.message : String(error)}`
          throw error
        }
      })
    },

    poll(state: RunState): Promise<TriggerRecord[]> {
      return serial(async () => {
        const records: TriggerRecord[] = []
        for (const candidate of candidatesOf(state)) {
          try {
            records.push(await adjudicate(candidate))
            failure = null
          } catch (error) {
            // 轮询是兜底通路：一条候选出错不能连累其余三类（否则一个坏实体让兜底整体失效）。
            failure = `轮询推进异常：${error instanceof Error ? error.message : String(error)}`
          }
        }
        return records
      })
    },

    health(): TriggerBusHealth {
      if (!eventSource) return { degraded: true, reason: EVENT_SOURCE_DOWN }
      if (failure !== null) return { degraded: true, reason: failure }
      return { degraded: false }
    },

    setEventSource(available: boolean): void {
      eventSource = available
    },
  }
}
