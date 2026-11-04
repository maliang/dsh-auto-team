/**
 * 派发失败通知环（r14 AC-3）：把「后台 spawn 全失败」变成**既有**活动流里的一条可见记录。
 *
 * 为什么需要它：`auto_team_dispatch` 改成受理制后（TECHNICAL §3.1），工具在 kick 之后立即返回，
 * spawn 才在后台发生。后台失败如果只走 `ctx.logger.warn`，用户与队长在面板上看到的就是
 * 「已接受派发」然后永远没有成员 —— 这正是 AC-3 明确禁止的「把失败吞掉」。
 *
 * 三条纪律：
 *  1. **形状零扩张**：`ActivityEvent` 的 `kind` 只允许既有 9 个枚举值，这里复用 `'status'`，
 *     客户端不需要任何新分支；`source:'trigger'` 让「最近推进」条把它算成自动推进。
 *  2. **只存内存**：与 `auto-dispatch.ts` 的 `inflightRuns` 同一取舍 —— 进程重启后「这一次失败」
 *     不再是事实，写进 RunState 会让一次旧失败永久挂在面板上。
 *  3. **cap 5 + 同文本去重**：失败会随 tick 重放，同一句错误重复五次对用户没有信息量；
 *     重复文案覆盖旧条（刷新时间戳），不同文案最多保留 5 条。
 */
import type { ActivityEvent } from '../../shared/types.ts'

/** 每个 run 最多保留几条失败通知（面板活动流本身也只显示最近 50 条）。 */
export const DISPATCH_NOTICE_LIMIT = 5

export interface DispatchNoteStore {
  /** 追加一条失败通知；同一 run 的相同文案覆盖旧条，总量不超过 `DISPATCH_NOTICE_LIMIT`。 */
  add(runId: string, text: string): void
  /** 有成员真的起来后清空该 run 的失败文案（避免面板一直挂着旧红字）。 */
  clear(runId: string): void
  /** 当前该 run 的失败通知（按入队时刻升序；调用方负责并入活动流并排序）。 */
  recent(runId: string): ActivityEvent[]
}

export function createDispatchNotes(now: () => number = Date.now): DispatchNoteStore {
  const notes = new Map<string, ActivityEvent[]>()

  function add(runId: string, text: string): void {
    const body = text.trim()
    if (body === '') return
    const at = now()
    const kept = (notes.get(runId) ?? []).filter((item) => item.text !== body)
    kept.push({ at, kind: 'status', text: body, source: 'trigger' })
    notes.set(runId, kept.slice(-DISPATCH_NOTICE_LIMIT))
  }

  function clear(runId: string): void {
    notes.delete(runId)
  }

  function recent(runId: string): ActivityEvent[] {
    // 逐条浅拷贝：活动流是消费方，任何一处就地改事件（排序、补字段）都不能反写回环里。
    return (notes.get(runId) ?? []).map((item) => ({ ...item }))
  }

  return { add, clear, recent }
}
