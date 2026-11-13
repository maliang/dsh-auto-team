/**
 * 停滞判定与推进记录（**纯逻辑**：无 IO、无宿主、无定时器、不读常量）。
 *
 * 为什么单独成模块：停滞判定有两条入口 —— `watcher.tick`（负责告警）与
 * `bridge.membersOf`（负责面板展示）。若两处各写一份「now - lastProgressAt > 阈值」，
 * 阈值或边界（>= / >、没有信号时回落到 spawnedAt）迟早会分叉，用户就会看到「面板没提示、
 * 活动流里有告警」。所以判定只有一个实现，阈值只做**参数**传进来（AC-13）。
 *
 * r32（真机假停滞）：判定**不再有 spawnedAt 基线**。没有 `progressAt` 就是「宿主没上报」，
 * 输出 `reason='unreported'`，由展示层说明「证据不足」，绝不计时成停滞。
 *
 * 依赖限制：只允许 import `../shared/types.ts`。`ProgressRecord` 放在 shared 而不是
 * store，正是为了让这个模块保持纯净（store 带 fs IO，纯模块不许 import 它）。
 */
import type { ProgressRecord, StallReason } from '../../shared/types.ts'

/** 一次停滞判定的完整结果：`reason` 是「停滞 / 证据不足 / 没停滞」的唯一区分位（r32）。 */
export interface StallJudge {
  stalled: boolean
  stalledForMs: number
  reason: StallReason
}

/** 一分钟的秒数（秒数文案分档用）。 */
const MINUTE_SECONDS = 60

/** 「直接写 N 秒」的上限：不足 10 分钟不对人做除法，秒数本身就是判断依据。 */
const PLAIN_SECONDS_LIMIT = 600

/**
 * 停滞判定（r32：**没有推进信号就不判停滞**）。
 *
 * 旧实现把「没有任何推进记录」回落到 `binding.spawnedAt` 再倒计时，于是宿主一次进度都没
 * 上报时（r32 真机：成员 434 行会话 / 55 step / 63 次工具调用，`RunState.progress` 仍是空
 * 对象），面板把「派发了 20 分钟」说成「已停滞 20 分钟」——**没有证据的沉默被涂成了黄色**。
 *
 * 现在分三种情况，判定与文案一一对应：
 *  - `unreported`：从来没有收到过推进信号（`progressAt` 缺失）→ **不判停滞**，交给展示层
 *    说「宿主未上报」；这是「证据不足」，不是「停滞」。
 *  - `none`：有信号且静默未达阈值 → 不判停滞。
 *  - `quiet`：有信号且静默达到阈值 → 停滞，`stalledForMs` 是真实静默时长。
 *
 * @param progressAt 最近一次实质工具调用时间；**缺失即无信号**（不再回落到 spawnedAt）
 * @param now        判定时刻
 * @param stallMs    阈值（来自 `config.STALL_MS`，本模块不自读，便于单测注入不同阈值）
 * @returns `stalledForMs` 在**未停滞时恒为 0**（面板文案「已停滞多久」只对停滞行有意义）
 */
export function stallOf(progressAt: number | undefined, now: number, stallMs: number): StallJudge {
  if (typeof progressAt !== 'number' || !Number.isFinite(progressAt)) {
    return { stalled: false, stalledForMs: 0, reason: 'unreported' }
  }
  const elapsed = now - progressAt
  // 时钟回拨 / 未来时间戳：夹到 0，绝不允许「负数停滞」把人骗成「已停滞 -3 秒」。
  const silentForMs = elapsed > 0 ? elapsed : 0
  if (silentForMs < stallMs) return { stalled: false, stalledForMs: 0, reason: 'none' }
  return { stalled: true, stalledForMs: silentForMs, reason: 'quiet' }
}

/**
 * 「证据不足」时的唯一措辞（r32）：只在 `reason === 'unreported'` 时非空。
 *
 * 为什么必须与 `stalledSecondsText` 分开：停滞秒数是「有信号但久未推进」的事实，
 * 而这里说的是「宿主根本没上报过进度」——两者混在同一字段里就又会退回「静默倒计时」。
 * 客户端零判断：拿 `stallNote` 就直接显示，不做任何阈值比较。
 */
export function stallNoteOf(reason: StallReason): string {
  return reason === 'unreported' ? '宿主未上报推进信号，无法判定是否停滞' : ''
}

/**
 * 记一次实质工具调用（返回新对象，不改入参：调用方拿它去 `store.save`）。
 *
 * 只推进 `at`，**保留** `alertedAt`：episode 的结束由 `watcher.tick` 观察到
 * 「不再停滞」后调用 {@link clearAlerted} 统一收口（单一清理点，避免两处都能改状态）。
 */
export function touchProgress(
  progress: Record<string, ProgressRecord> | undefined,
  memberId: string,
  at: number,
): Record<string, ProgressRecord> {
  const base = progress ?? {}
  const prev = base[memberId]
  const next: ProgressRecord = prev ? { ...prev, at } : { at }
  return { ...base, [memberId]: next }
}

/**
 * 清掉本 episode 的告警标记（成员恢复产出后下一次 tick 调用）。
 *
 * 只有清掉它，成员**再次**卡住时才能再告警一次 —— 否则成员整轮生命周期只能响一声。
 */
export function clearAlerted(
  progress: Record<string, ProgressRecord> | undefined,
  memberId: string,
): Record<string, ProgressRecord> {
  const base = progress ?? {}
  const record = base[memberId]
  if (!record || record.alertedAt === undefined) return base
  // 重建记录而不是 delete 字段：`alertedAt` 在类型上可选，显式重建能让落盘 JSON 干净。
  const next: ProgressRecord = { at: record.at }
  return { ...base, [memberId]: next }
}

/**
 * 秒数文案（AC-14 的**唯一**来源，客户端只渲染不再格式化）。
 *
 * - 不足 10 分钟：`92 秒`
 * - 10 分钟及以上：`20 分 34 秒`（**永不省略秒**：秒是「多久没动」的判断依据）
 */
export function secondsText(ms: number): string {
  const safe = typeof ms === 'number' && Number.isFinite(ms) ? ms : 0
  const totalSeconds = Math.max(0, Math.floor(safe / 1000))
  if (totalSeconds < PLAIN_SECONDS_LIMIT) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / MINUTE_SECONDS)
  const seconds = totalSeconds % MINUTE_SECONDS
  return `${minutes} 分 ${seconds} 秒`
}

/** 落进 `stallAlerts` 的整句文案，例：`开发-1 已 100 秒无实质工具调用，疑似停滞`。 */
export function stallSentence(name: string, ms: number): string {
  return `${name} 已 ${secondsText(ms)}无实质工具调用，疑似停滞`
}
