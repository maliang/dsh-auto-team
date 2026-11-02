/**
 * 写域占用（r11 F4/F5）：谁是持有者、谁在等、等待判定、终态释放与释放通知。
 *
 * 核心设计：**没有锁表**（AC-16）。锁只从 `plan.tasks` 的 `status + writeScopes` 现算，
 * 因此重启、换 store 实例、从磁盘读回旧 run 之后，等待关系都按计划顺序自动重建——
 * 一旦落盘一张锁表，就要额外写「锁表与任务状态不一致时怎么修」的逻辑，那是最容易长歪的地方。
 *
 * 持有者口径：`running | gate`（gate 是 running 的门禁子阶段，此刻成员仍可能改文件）。
 */
import type { MemberBinding, MessageRecord, PlanTask } from '../../shared/types.ts'
// `RunState` 是宿主运行账本（落盘形状），定义在 host/store.ts；shared/types.ts 只放跨 host/client 契约。
// 必须是 `import type`（编译后整体擦除），否则会形成 store ↔ team 的运行时环。
import type { RunState } from '../store.ts'
import { conflictingScopes, waitReasonOf } from '../plan/scope.ts'
import { appendMessage } from './messages.ts'

/** 一个持锁任务的最小视图（面板与判定共用同一口径）。 */
export interface ScopeHolder {
  taskId: string
  scopes: string[]
  /** 持锁成员名（未 retired 的绑定）；等待者释放通知按它对账。 */
  member?: string
}

/** 「在等谁、等哪条路径」。 */
export interface ScopeWait {
  holderTaskId: string
  path: string
}

/** 视为持锁的状态：running 与它的门禁子阶段 gate。 */
const HOLDER_STATUSES: ReadonlySet<PlanTask['status']> = new Set<PlanTask['status']>(['running', 'gate'])

function scopesOf(task: PlanTask): string[] {
  const seen = new Set<string>()
  const scopes: string[] = []
  for (const raw of task.writeScopes ?? []) {
    const scope = String(raw ?? '').trim()
    if (scope === '' || seen.has(scope)) continue
    seen.add(scope)
    scopes.push(scope)
  }
  return scopes
}

/** 当前持锁者（按计划顺序，只含 running|gate 且写域非空的任务）。 */
export function scopeHoldersOf(state: RunState): ScopeHolder[] {
  const bindings: MemberBinding[] = state.bindings ?? []
  const holders: ScopeHolder[] = []
  for (const task of state.plan.tasks) {
    if (!HOLDER_STATUSES.has(task.status)) continue
    const scopes = scopesOf(task)
    if (scopes.length === 0) continue
    const binding = bindings.find((entry) => entry.taskId === task.id && !entry.retired)
    const holder: ScopeHolder = { taskId: task.id, scopes }
    if (binding && binding.name.trim() !== '') holder.member = binding.name
    holders.push(holder)
  }
  return holders
}

/** 任务与某个持有者是否冲突；返回冲突路径（已排序，取第一条做文案）。 */
function firstConflict(holders: readonly ScopeHolder[], task: PlanTask): ScopeWait | null {
  const scopes = scopesOf(task)
  if (scopes.length === 0) return null
  for (const holder of holders) {
    if (holder.taskId === task.id) continue
    const hits = conflictingScopes(holder.scopes, scopes)
    if (hits.length === 0) continue
    return { holderTaskId: holder.taskId, path: hits.slice().sort()[0] }
  }
  return null
}

/**
 * 派发前判定：这条任务现在能不能起人。
 *
 * `claimed` 是本轮刚 spawn 的任务 id（状态可能还没在快照里体现，作为兜底口径）；
 * 正常情况下它们已是 running，`scopeHoldersOf` 已经覆盖，所以这里只做二次确认。
 */
export function waitFor(state: RunState, task: PlanTask, claimed: readonly string[] = []): ScopeWait | null {
  const hit = firstConflict(scopeHoldersOf(state), task)
  if (hit) return hit
  const scopes = scopesOf(task)
  if (scopes.length === 0) return null
  for (const id of claimed) {
    if (id === task.id) continue
    const other = state.plan.tasks.find((entry) => entry.id === id)
    if (!other) continue
    const hits = conflictingScopes(scopesOf(other), scopes)
    if (hits.length > 0) return { holderTaskId: other.id, path: hits.slice().sort()[0] }
  }
  return null
}

/**
 * 按当前持锁情况重算等待关系（幂等）：冲突者刷新 waitingOn/waitReason，无人冲突则 waiting → pending。
 *
 * 只在计划可派发（draft/dispatching）时由 dispatch 调用——暂停/终止的计划不允许被改状态。
 * 刻意**不**把 pending/ready 任务转成 waiting：那样依赖没满足的任务也会显示「等待写域」，
 * 面板会把 blocked 误读成 waiting，而且 waitReason 会随每轮重算漂移。
 */
export function applyScopeWaits(state: RunState, now: number): RunState {
  const holders = scopeHoldersOf(state)
  let changed = false
  const tasks = state.plan.tasks.map((task) => {
    if (task.status !== 'waiting') return task
    const hit = firstConflict(holders, task)
    if (!hit) {
      // 释放已发生（或写域被清空）：放回待办，下一轮按正常并发名额排队（AC-15）。
      changed = true
      const revived: PlanTask = { ...task, status: 'pending' }
      delete revived.waitingOn
      delete revived.waitReason
      return revived
    }
    const waitingOn = [hit.holderTaskId]
    const waitReason = waitReasonOf(hit.holderTaskId, hit.path)
    const sameOn = (task.waitingOn ?? []).length === 1 && task.waitingOn?.[0] === hit.holderTaskId
    if (sameOn && task.waitReason === waitReason) return task
    changed = true
    return { ...task, waitingOn, waitReason }
  })
  if (!changed) return state
  void now
  return { ...state, plan: { ...state.plan, tasks } }
}

/** 等待者的可寻址名字：优先未 retired 的绑定名，其次任意历史绑定，最后 `task:<id>`。 */
function waiterNameOf(state: RunState, waiter: PlanTask): { name: string; memberId?: string } {
  const bindings = state.bindings ?? []
  const live = bindings.find((entry) => entry.taskId === waiter.id && !entry.retired)
  const any = live ?? bindings.find((entry) => entry.taskId === waiter.id)
  if (any) return { name: any.name, memberId: any.memberId }
  return { name: `task:${waiter.id}` }
}

/** 释放通知正文（AC-18：释放者任务 id + 释放的路径 + 「可以接着改」）。 */
export function releaseMessageBody(holder: PlanTask, path: string, waiter: PlanTask): string {
  return `${holder.id} 已结束并释放 ${path}，你可以接着改（任务 ${waiter.id}）。`
}

/** 同一 (holder, waiter) 的释放序号：用于 `rel-<holder>-<waiter>-<seq>` 幂等键。 */
function nextReleaseSeq(messages: readonly MessageRecord[], holderId: string, waiterId: string): number {
  const prefix = `rel-${holderId}-${waiterId}-`
  let max = 0
  for (const message of messages) {
    const id = message.messageId ?? ''
    if (!id.startsWith(prefix)) continue
    const tail = Number(id.slice(prefix.length))
    if (Number.isFinite(tail) && tail > max) max = tail
  }
  return max + 1
}

/**
 * 释放写域：给每个**真的在等这条任务**的等待者追加恰一条通知（AC-18）。
 *
 * 三个必须守住的点：
 *  1. 只通知「写域与它真的冲突」且（未指定 waitingOn 或 waitingOn 含它）的等待者；
 *  2. 幂等：messageId = `rel-<holder>-<waiter>-<seq>`，重复释放不会写第二条；
 *  3. 只改消息账本，不改任务状态——等待者由 `applyScopeWaits` 放回 pending，
 *     「状态权威、消息是通知」两边各管一件事，避免这里顺手把任务改活。
 */
export function releaseScopes(state: RunState, holderTaskId: string, at: number): RunState {
  const holder = state.plan.tasks.find((task) => task.id === holderTaskId)
  if (!holder) return state
  const holderScopes = scopesOf(holder)
  if (holderScopes.length === 0) return state

  const waiters = state.plan.tasks.filter((task) => task.status === 'waiting' && task.id !== holder.id)
  if (waiters.length === 0) return state

  let next = state
  for (const waiter of waiters) {
    const hits = conflictingScopes(holderScopes, scopesOf(waiter))
    if (hits.length === 0) continue
    const waitingOn = waiter.waitingOn ?? []
    if (waitingOn.length > 0 && !waitingOn.includes(holder.id)) continue

    const path = hits.slice().sort()[0]
    const seq = nextReleaseSeq(next.messages ?? [], holder.id, waiter.id)
    const messageId = `rel-${holder.id}-${waiter.id}-${seq}`
    if ((next.messages ?? []).some((message) => message.messageId === messageId)) continue

    const target = waiterNameOf(next, waiter)
    const record: MessageRecord = {
      at,
      from: 'captain',
      to: target.name,
      taskId: waiter.id,
      body: releaseMessageBody(holder, path, waiter),
      messageId,
    }
    if (target.memberId !== undefined) record.toMemberId = target.memberId
    next = appendMessage(next, record)
  }
  // AC-17 不变量：`waiting` 的 `waitingOn` 必须指向**正在 running** 的持有者。
  // 持有者刚落地时若只发通知不重算，等待者会短暂「等待一个已结束的任务」——
  // 面板上表现为「t1 早就 done 了，这里还写着等 t1」。所以释放后立刻按同一套纯函数重算：
  // 冲突已消失 → 转回 pending（下一轮按并发位排队，不抢占）；仍有别的持有者 → 刷新等待对象。
  return applyScopeWaits(next, at)
}
