/**
 * 成员存活对账（AC-18 的**反面目标**靠这里才可能成立）。
 *
 * 面板显示的成员状态如果只由 `task.status` 推导，那么「把成员进程杀掉」这件事
 * 在界面上永远不可见：任务还是 running，胶囊还是「运行中」，直到用户点开发现没动静。
 * 浏览器看不见的时候（面板没开）也必须对账，所以轮询在 host 侧，不在 client 侧。
 *
 * 宿主只有 4 个状态（running / provisioning / inactive / failed，或缺席），
 * 本项目有 7 个成员态；**映射只允许写在这一个文件里**（bridge.toMemberStatus 是展示层的映射，
 * 这里是持久层对任务的映射），组件里禁止再写第二张表。
 */
import type { RunState } from '../store.ts'
import type { RunsStore } from '../store.ts'
import { STALL_ALERTS_LIMIT } from '../store.ts'
import type { ActivityEvent, MemberListSource, PlanTask } from '../../shared/types.ts'
import { MAX_ATTEMPTS, STALL_MS, STEP_BUDGET, STEP_REMINDER_AT, WATCHER_INTERVAL_MS } from '../config.ts'
import { appendMessage, makeMessage } from './messages.ts'
import { releaseScopes } from './scope-locks.ts'
import { isSilentFinish, silentFinishBodyOf, withSilentFinish, withoutSilentFinish } from './silent-finish.ts'
import { clearAlerted, stallOf, stallSentence } from './stall.ts'

/** 宿主成员行：只信任这三个字段，其余一律不读（宿主形状可能变，见 adapters）。 */
export interface HostMember {
  id: string
  name: string
  status: string
}

export interface WatcherDeps {
  store: RunsStore
  /**
   * 宿主成员名单。`rootId` = 本次 run 的 `plan.sessionId`（subagent 树的根）：
   * r36 起必须传它 —— 定时器回调不在任何 initiator 边界内，按 caller 求 root 会恒抛 `NO_CALLER`。
   */
  listMembers(rootId?: string): Promise<HostMember[]>
  /**
   * 名单不可得时的告警出口（r36）：不再静默吞错。
   * 同一种错误只在状态变化时报一次（由本文件去重），装配层接到宿主 warn / 面板降级通道。
   */
  onWarn?(message: string): void
  now?(): number
  intervalMs?: number
  /**
   * 停滞阈值（毫秒）。缺省取 `config.STALL_MS`；装配层显式传参便于演练/演练阈值，
   * 判定本身不读常量（AC-13：判定实现只有一个，阈值只做参数）。
   */
  stallMs?: number
  /**
   * 返工上限（r7 AC-13 的 settings 生效点）。缺省取 `config.MAX_ATTEMPTS`；
   * 与 `stallMs` 同一条纪律：判定实现只有一个，上限只做参数。
   */
  maxAttempts?: number
  /** 对账发生变更时的回调（宿主装配层用它刷新快照/打点，不在这里硬编码）。 */
  onReconciled?(state: RunState): void
  /**
   * 每轮对账之后的 Trigger 轮询兜底（AC-18 / r5）。
   *
   * 挂在**既有的 1500ms tick** 上，不新增 `setInterval`（AC-20：定时器仍只有本文件一处）；
   * 判定口径在 `team/trigger-bus.ts`，这里只是「有节奏地叫它一次」，不做任何判定。
   * 抛错必须被吞掉：轮询失败不能打断成员存活对账（那会让「成员死了」永远报不出来）。
   */
  onPoll?(state: RunState): Promise<void>
  /**
   * 每轮 tick **开头无条件**驱动一次自动派发（t4 病因修复）。
   *
   * 为什么不能只挂在 `onPoll` 上：下面的循环对「只剩 pending、没有 running/gate/interrupted/paused
   * 任务」的 run 直接 `continue`（本 tick 对它无事可做），而 `onPoll` 只在 active 分支里调 ——
   * 于是一个「从没派出去过」或「上一拍派发失败」的 run 永远拿不到下一次自动派发，残留 pending
   * 卡片永远挂着。派发判定仍全在 `autoDispatcher.tick()` 里，这里只是「每 1500ms 叫它一次」，
   * 不新增定时器（AC-20：定时器仍只有本文件一处）。
   *
   * 抛错必须被吞掉：派发失败不能打断成员存活对账（那会让「成员死了」永远报不出来）。
   */
  onDispatchTick?(): Promise<void>
  /**
   * r39：步数提醒阈值（成员本次任务累计工具调用数）。缺省 `config.STEP_REMINDER_AT`；
   * **0 = 关闭**。判定实现只有一个，阈值只做参数（与 `stallMs` / `maxAttempts` 同一纪律）。
   */
  stepReminderAt?: number
  /**
   * 给成员发一条直达消息（r39 步数提醒的唯一出口）。
   *
   * 未装配时**静默跳过**：老宿主读不到工具事件 → `progress[memberId].calls` 恒缺席 →
   * 本来就不会产生候选；单测桩不传本端口时同样什么都不发生（与 progress 同一降级口径）。
   * 抛错/`ok:false` 时**不落账**，下一轮 tick 自然重试（提醒不是护栏，失败绝不打断对账）。
   */
  sendMemberMessage?(
    memberId: string,
    text: string,
    /** 队长会话 id（run 的 `plan.sessionId`）：定时器回调没有 initiator，靠它取活 caller。 */
    sessionId?: string,
  ): Promise<{ ok: boolean; error?: string }>
}

export interface ReconcileResult {
  state: RunState
  changed: number
}

export interface MemberWatcher {
  tick(): Promise<number>
  start(): void
  stop(): void
  /**
   * r40 D1：某个 root（= `plan.sessionId`）最近一次取成员名单的结果。
   *
   * 纯内存态，**不落盘**（重启后缺省 = 还没对账过，面板显示不可得而不是假装 ok）。
   * `rootId` 缺省 = 最近一条记录（给「还不知道会话 id」的调用方兜底）。
   */
  memberListHealth(rootId?: string): MemberListSource | undefined
}

/**
 * 把宿主成员名单对账到任务状态：
 *  - 成员缺席 / inactive / failed → 任务 `interrupted`（attempts 用尽则 `failed`）；
 *  - 成员重新出现（running / provisioning）→ 中断态任务恢复 `running`；
 *  - 拿不到成员行（status 未知）→ **不动**：未知不等于死亡，误杀比漏报更伤。
 *
 * 只处理 running / gate / interrupted 三类任务：done / failed 是终态，rework 由回执链路负责。
 *
 * `paused`（团队级冻结 + r37 任务级暂停）天然不在这三类里 —— **这是有意的**：暂停不是死亡，
 * 不能因为「成员静默」就把暂停的卡判成 interrupted/failed；解冻由 `resumeTeam` / `resumeTask` 负责。
 */
export function reconcileMembers(
  state: RunState,
  members: HostMember[],
  now?: number,
  /** 返工上限（r7 AC-13 的 settings 生效点）：缺省 `config.MAX_ATTEMPTS`，常量值不变。 */
  maxAttempts?: number,
): ReconcileResult {
  const limit = maxAttempts ?? MAX_ATTEMPTS
  const at = now ?? Date.now()
  let next = state
  let changed = 0

  for (const task of next.plan.tasks) {
    if (task.status !== 'running' && task.status !== 'gate' && task.status !== 'interrupted') continue

    const binding = next.bindings.find((item) => item.taskId === task.id && !item.retired)
    const member = binding
      ? members.find((row) => row.id === binding.memberId || row.name === binding.name)
      : undefined

    if (!member) {
      if (task.status === 'interrupted') continue
      const exhausted = (task.attempts ?? 0) >= limit
      next = patch(next, task.id, { status: exhausted ? 'failed' : 'interrupted' })
      next = appendMessage(
        next,
        makeMessage({
          from: 'captain',
          to: 'user',
          taskId: task.id,
          at,
          body: exhausted
            ? `成员「${binding?.name ?? task.roleId}」已失联且重试次数用尽（${task.attempts ?? 0}/${limit}）：任务「${task.title}」转人工。`
            : `成员「${binding?.name ?? task.roleId}」已失联：任务「${task.title}」标记为中断，可在面板点「恢复」重试。`,
        }),
      )
      changed += 1
      // r11 AC-15：interrupted/failed 都是终态 → 立刻释放写域并通知等待者。
      // 不释放的话，一个失联成员会让所有改同一批文件的任务永远 waiting（无锁表可查，只能眼看着卡住）。
      next = releaseScopes(next, task.id, at)
      continue
    }

    const status = normalizeHostStatus(member.status)

    // r33「待回执」：成员已停（宿主归一 dead）但任务仍 running、且没有门禁证据。
    // 这是**事件源降级时的第二路信号**：事件收不到也照样判得出来。只记事实 + 通知队长，
    // 不写 done / 不返工 / 不续聊；下面既有的 interrupted 对账照旧执行。
    if (binding !== undefined && isSilentFinish({ task, binding, memberStopped: status === 'dead' })) {
      const recorded = recordSilentFinish(next, {
        taskId: task.id,
        memberId: binding.memberId,
        memberName: member.name,
        at,
      })
      if (recorded !== next) {
        next = recorded
        changed += 1
      }
    }

    if (status === 'dead') {
      if (task.status === 'interrupted') continue
      const exhausted = (task.attempts ?? 0) >= limit
      next = patch(next, task.id, { status: exhausted ? 'failed' : 'interrupted' })
      next = appendMessage(
        next,
        makeMessage({
          from: 'captain',
          to: 'user',
          taskId: task.id,
          at,
          body: exhausted
            ? `成员「${member.name}」已退出（宿主状态 ${member.status}）且重试次数用尽：任务「${task.title}」转人工。`
            : `成员「${member.name}」已退出（宿主状态 ${member.status}）：任务「${task.title}」标记为中断。`,
        }),
      )
      changed += 1
      // 同上：成员已死且次数用尽 → failed（终态），写域必须释放。
      next = releaseScopes(next, task.id, at)
      continue
    }

    if (status === 'alive' && task.status === 'interrupted') {
      // 成员回来了（宿主重启后按名字重绑成功等）：状态跟着事实走。
      // r33：人又在跑了，「待回执」不再成立 —— 不清就会让面板一直提示「没人干了」。
      next = patch(next, task.id, { status: 'running' })
      next = {
        ...next,
        plan: {
          ...next.plan,
          tasks: next.plan.tasks.map((item) => (item.id === task.id ? withoutSilentFinish(item) : item)),
        },
      }
      changed += 1
      continue
    }

    // alive 且任务本来就在跑，或 unknown：都不需要改状态。
  }

  return { state: next, changed }
}

/** 一条「待回执」观察事实的落盘入参（时间由调用方给：事件路径用事件时刻，轮询用 tick 时刻）。 */
export interface SilentFinishNotice {
  taskId: string
  memberId: string
  memberName: string
  at: number
}

/**
 * r33：把「成员已结束本轮但未交回执」写进任务并通知队长（captain → user，带 taskId）。
 *
 * 幂等：任务已有 `silentFinish`、已不是 `running`、或已有门禁证据时**原样返回**
 * （不刷新 `at`、不重复写消息）。返回值换了引用 = 有新事实落盘，调用方据此 save。
 *
 * 只记事实：绝不写 done / rework / resume，也绝不替成员执行门禁。
 */
export function recordSilentFinish(state: RunState, notice: SilentFinishNotice): RunState {
  const task = state.plan.tasks.find((item) => item.id === notice.taskId)
  if (
    task === undefined ||
    task.status !== 'running' ||
    task.evidence !== undefined ||
    task.silentFinish !== undefined
  ) {
    return state
  }
  const next: RunState = {
    ...state,
    plan: {
      ...state.plan,
      tasks: state.plan.tasks.map((item) =>
        item.id === notice.taskId ? withSilentFinish(item, notice.at, notice.memberId) : item,
      ),
    },
  }
  return appendMessage(
    next,
    makeMessage({
      from: 'captain',
      to: 'user',
      taskId: notice.taskId,
      at: notice.at,
      body: silentFinishBodyOf(notice.memberName, task),
    }),
  )
}

/**
 * 停滞告警的**唯一判定出口**（AC-8）。
 *
 * 事件订阅（`adapters.onMemberProgress`）只负责 `touchProgress` 推进 `at`，从不产生告警；
 * 告警只在 watcher 的 tick 里、对着落盘状态算一次。这样「事件一条 + 轮询一条」的重复
 * 告警在结构上不可能发生 —— 不是靠纪律，是因为只有这一个地方会 push。
 *
 * 幂等：`progress[memberId].alertedAt` 存在即表示本 episode 已告警过；成员恢复产出后
 * `clearAlerted` 清掉标记，下一轮卡住才允许再响一次。
 *
 * @returns `state` 换了新引用即表示有变更（调用方据此决定是否 save）；未停滞时**不碰** plan，
 *          所以 `plan.tasks` 与入参深相等（AC-13）。
 */
export function stallAlertsOf(
  state: RunState,
  now: number,
  stallMs: number,
): { state: RunState; raised: ActivityEvent[] } {
  const raised: ActivityEvent[] = []
  let progress = state.progress ?? {}
  let mutated = false

  for (const task of state.plan.tasks) {
    // 终态任务不再产出，判它停滞只会制造假告警（成员 done 后本来就该安静）。
    if (task.status !== 'running') continue
    const binding = state.bindings.find((item) => !item.retired && item.taskId === task.id)
    if (!binding) continue
    const memberId = binding.memberId
    const record = progress[memberId]
    // r32：没有推进信号（`record?.at` 缺失）时 `stallOf` 返回 `reason='unreported'`，
    // 也就是**不告警**。旧实现回落 `binding.spawnedAt` 倒计时，会把「宿主没上报进度」
    // 变成一条假的「疑似停滞」告警（真机 r32：成员明明在跑）。
    const judge = stallOf(record?.at, now, stallMs)

    if (!judge.stalled) {
      if (record?.alertedAt !== undefined) {
        progress = clearAlerted(progress, memberId)
        mutated = true
      }
      continue
    }

    if (record?.alertedAt !== undefined) continue // 本 episode 已告警：静默（一次 episode 一条）

    // 能走到这里 ⇒ `judge.reason === 'quiet'` ⇒ `record.at` 一定存在。
    const at = record?.at ?? now
    progress = { ...progress, [memberId]: { at, alertedAt: now } }
    mutated = true
    raised.push({
      at: now,
      kind: 'tool',
      memberId,
      taskId: task.id,
      text: stallSentence(binding.name, judge.stalledForMs),
    })
  }

  if (raised.length === 0) return { state: mutated ? { ...state, progress } : state, raised }
  const stallAlerts = [...(state.stallAlerts ?? []), ...raised]
  return {
    state: {
      ...state,
      progress,
      stallAlerts: stallAlerts.length > STALL_ALERTS_LIMIT ? stallAlerts.slice(-STALL_ALERTS_LIMIT) : stallAlerts,
    },
    raised,
  }
}

/**
 * 步数提醒的幂等键（r39：同一任务只发一条）。
 *
 * 用 `messageId` 而不是正文匹配：正文里带着当时的调用数，拿正文当键会让「40 次发过、
 * 41 次再发」变成必然。`handoff:<上游>-><下游>` 是同一套既有做法（账本即幂等表）。
 */
export function stepReminderKeyOf(taskId: string): string {
  return `step-reminder:${taskId}`
}

/** 步数提醒正文（**唯一**措辞来源；预算数字取自 `config.STEP_BUDGET`，不在文案里写死）。 */
export function stepReminderTextOf(calls: number): string {
  return `已用 ${calls} 次工具调用（预算 ${STEP_BUDGET}）：先 compress 折叠已完成的部分，再继续；剩余计划压到 5 步内，做不到就回报队长拆卡。`
}

/** 一条待发的步数提醒（发送成功后才会落进 `messages`）。 */
export interface StepReminder {
  taskId: string
  memberId: string
  memberName: string
  text: string
}

/**
 * 算出「该发但还没发过」的步数提醒（r39，**纯函数**）。
 *
 * 只对 `running` 任务判定：done/failed 是终态，rework/interrupted 等成员不在跑，发提醒没有意义。
 * 调用数来自 `RunState.progress[memberId].calls` —— 老宿主读不到工具事件时该字段缺席，
 * 于是候选恒为空，**静默跳过**（与停滞判定 `unreported` 同一口径，绝不编一个数字出来）。
 *
 * 幂等：账本里已有 `step-reminder:<taskId>` 即跳过；阈值 ≤ 0 = 关闭。
 * 不改任务状态、不杀成员、不拦工具 —— 这是提醒，不是护栏。
 */
export function stepRemindersOf(state: RunState, threshold: number): StepReminder[] {
  if (!(threshold > 0)) return []
  const reminders: StepReminder[] = []
  for (const task of state.plan.tasks) {
    if (task.status !== 'running') continue
    const binding = state.bindings.find((item) => item.retired !== true && item.taskId === task.id)
    if (!binding) continue
    const calls = state.progress?.[binding.memberId]?.calls
    if (typeof calls !== 'number' || !Number.isFinite(calls) || calls < threshold) continue
    const key = stepReminderKeyOf(task.id)
    if (state.messages.some((message) => message.messageId === key)) continue
    reminders.push({
      taskId: task.id,
      memberId: binding.memberId,
      memberName: binding.name,
      text: stepReminderTextOf(calls),
    })
  }
  return reminders
}

/** 把一条**已发送成功**的步数提醒记进账本（幂等键固定，重复落账不会产生第二条）。 */
export function recordStepReminder(state: RunState, reminder: StepReminder, at: number): RunState {
  const message = makeMessage({
    from: 'captain',
    to: reminder.memberName,
    toMemberId: reminder.memberId,
    taskId: reminder.taskId,
    at,
    body: reminder.text,
  })
  return appendMessage(state, { ...message, messageId: stepReminderKeyOf(reminder.taskId) })
}

/** 轮询器：一个 run 一次 listMembers（不是一任务一次），只在存在非终态任务时才查。 */
export function createMemberWatcher(deps: WatcherDeps): MemberWatcher {  const now = deps.now ?? Date.now
  const intervalMs = deps.intervalMs ?? WATCHER_INTERVAL_MS
  const stallMs = deps.stallMs ?? STALL_MS
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS
  const stepReminderAt = deps.stepReminderAt ?? STEP_REMINDER_AT
  let timer: ReturnType<typeof setInterval> | null = null
  let busy = false
  /**
   * r40 D1：每个 root（= `plan.sessionId`）最近一次取名单的结果，面板降级的唯一来源。
   * 只存内存、**不落盘**：它描述的是「这一刻宿主端口通不通」，写进 run 文件只会变成过期假象。
   */
  const healthByRoot = new Map<string, MemberListSource>()
  /**
   * r40：按 root 去重的告警键（r36 的语义保留：同一种错误只报一次，错误换了才再报）。
   * 用单键会被别的 root 的成功抹掉记录，于是同一个错误反复报——键必须跟 root 走。
   */
  const listErrorsByRoot = new Map<string, string>()
  /** 最近一次取名单的 root（`memberListHealth()` 不带参数时的兜底）。 */
  let lastHealthRoot: string | null = null

  async function tick(): Promise<number> {
    if (busy) return 0
    busy = true
    try {
      // t4：自动派发**不受 active 过滤** —— 只剩 pending 的 run 也必须每轮被尝试一次，
      // 否则「新建计划不再收口旧 run」之后，旧 run 会永远停在 pending（没人再 kick 它）。
      // 放在 store.list() 之前：派发会写盘（binding、任务 running），随后的对账读到的才是新状态。
      if (deps.onDispatchTick !== undefined) {
        try {
          await deps.onDispatchTick()
        } catch {
          // 派发失败只影响本轮少一次推进，绝不能连累存活对账（下一轮 tick 会补上）。
        }
      }
      const runs = deps.store.list()
      // r40：名单必须**按 root 分别取**。`deps.store.list()` 返回整个 dataRoot 的 run
      // （跨工作区/跨会话），拿第一个 run 的 root 名单去对账后面的 run，只会把别人的成员
      // 当成「不存在」→ 误判 interrupted 或静默跳过。键 = `state.plan.sessionId`，每个 root 各取一次。
      const membersByRoot = new Map<string, HostMember[]>()
      let changed = 0

      for (const summary of runs) {
        // 对账是「load → await 名单/发提醒 → 改 → save」的读改写：整段在 runId 锁内跑，
        // 锁内重新 load（上面的 `runs` 列表只是待办清单，不是写盘判据）。
        changed += await deps.store.withRunLock(summary.runId, async (): Promise<number> => {
          const state = deps.store.load(summary.runId)
          if (!state) return 0
        // r7 AC-9：暂停只掐「推进」，不掐「看清事实」——本 tick 仍做存活对账（成员死了要看得见），
        // 只跳过停滞判定与 Trigger 轮询兜底。反过来（暂停连对账也停）会让面板在暂停期间
        // 一直显示「运行中」，恢复后才发现成员早就没了。
        const paused = state.plan.status === 'paused'
        const active = state.plan.tasks.some(
          (task) =>
            task.status === 'running' ||
            task.status === 'gate' ||
            task.status === 'interrupted' ||
            task.status === 'paused',
        )
        if (!active) return 0

        const rootId = state.plan.sessionId
        let members = membersByRoot.get(rootId)
        if (members === undefined) {
          try {
            // r36：带 rootId —— 定时器回调没有 initiator 边界，按 caller 求 root 会每轮抛 NO_CALLER。
            members = await deps.listMembers(rootId)
            membersByRoot.set(rootId, members)
            listErrorsByRoot.delete(rootId)
            lastHealthRoot = rootId
            healthByRoot.set(rootId, { ok: true, at: now() })
          } catch (error) {
            // 名单不可得：本 root 本轮什么都不改，等下一轮（宁可漏报一轮，也不误杀全部成员）。
            // 但**不许静默**（r36）：喂给降级通道，同一种错误只在状态变化时报一次；
            // 同时记进内存态（r40 D1），让快照/面板看得见「本轮降级了」而不是一个像样的空名单。
            const reason = errorTextOf(error)
            const text = `成员名单不可得（本轮跳过存活对账，不据此判定任何成员死亡）：${reason}`
            if (text !== listErrorsByRoot.get(rootId)) {
              listErrorsByRoot.set(rootId, text)
              try {
                deps.onWarn?.(text)
              } catch {
                /* 告警出口自身失败不得打断对账循环 */
              }
            }
            lastHealthRoot = rootId
            healthByRoot.set(rootId, { ok: false, error: reason, at: now() })
            // r40 取舍：**跳过本轮而不是中断整个 tick** —— 一次名单失败只让该 root 本轮降级，
            // 其余 root 的对账照常进行（旧实现的 return 会让一个 root 的故障停掉全仓对账）。
            return 0
          }
        }

        // 顺序固定：先对账存活，再判停滞（对账把任务判成 interrupted 后就不该再报停滞）。
        const at = now()
        const reconciled = reconcileMembers(state, members, at, maxAttempts)
        const judged = paused
          ? { state: reconciled.state, raised: [] as ActivityEvent[] }
          : stallAlertsOf(reconciled.state, at, stallMs)
        // r39：步数提醒（幂等、不阻断）。顺序固定在「对账 → 停滞判定」之后：任务刚被判成
        // interrupted 时成员已不在跑，不该再发提醒。发送成功才落账；失败/无端口静默跳过，
        // 下一轮 tick 自然重试（提醒不是护栏，绝不能连累存活对账）。
        let next = judged.state
        /** 本 run 本轮实际推进数（锁内累计，出锁后并入 tick 总数）。 */
        let delta = 0
        if (!paused && stepReminderAt > 0 && deps.sendMemberMessage !== undefined) {
          for (const reminder of stepRemindersOf(next, stepReminderAt)) {
            try {
              const sent = await deps.sendMemberMessage(reminder.memberId, reminder.text, state.plan.sessionId)
              if (!sent.ok) continue
              next = recordStepReminder(next, reminder, at)
            } catch {
              // 单条提醒失败只影响这一条：下一轮重算候选，不打断本轮其它对账。
            }
          }
        }
        if (reconciled.changed > 0 || next !== reconciled.state) {
          deps.store.save(next)
          deps.onReconciled?.(next)
          delta += reconciled.changed + judged.raised.length
        }

        // Trigger 轮询兜底（AC-18）：紧跟在「对账 → 停滞判定」之后，喂的是同一份已落盘状态，
        // 所以 poll 看到的世界与刚写下去的一致（不会基于旧状态重复推导同一条 Trigger）。
        // 暂停时**不 poll**：Trigger 的每个动作都是推进，暂停期间派发会被 PAUSED 闸门拒掉，
        // 但让它白跑一轮并在账本里留「被拒」记录没有意义。
        if (!paused && deps.onPoll !== undefined) {
          try {
            await deps.onPoll(next)
          } catch {
            // 兜底失败只影响本轮少一次推进，绝不能连累存活对账（下一轮 tick 会补上）。
          }
        }
          return delta
        })
      }

      return changed
    } finally {
      busy = false
    }
  }

  return {
    tick,
    memberListHealth(rootId?: string) {
      const key = rootId ?? lastHealthRoot
      return key === null ? undefined : healthByRoot.get(key)
    },
    start() {
      if (timer !== null) return
      timer = setInterval(() => {
        void tick().catch(() => {
          /* 轮询异常不打断插件：下一轮继续 */
        })
      }, intervalMs)
      // 不让 watcher 拦住进程退出（宿主关闭时能立刻回收）。
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref()
    },
    stop() {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
  }
}

/** 错误正文（只给告警文案用：本文件不引入其它模块的错误格式化，避免依赖方向反转）。 */
function errorTextOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 宿主 4 态 → 本项目需要的三分法：alive / dead / unknown。 */
export function normalizeHostStatus(status: string | undefined): 'alive' | 'dead' | 'unknown' {
  const value = (status ?? '').trim().toLowerCase()
  if (value === 'running' || value === 'provisioning' || value === 'busy' || value === 'active') return 'alive'
  if (value === 'inactive' || value === 'failed' || value === 'stopped' || value === 'terminated') return 'dead'
  return 'unknown'
}

function patch(state: RunState, taskId: string, changes: Partial<PlanTask>): RunState {
  return {
    ...state,
    plan: {
      ...state.plan,
      tasks: state.plan.tasks.map((task) => (task.id === taskId ? { ...task, ...changes } : task)),
    },
  }
}
