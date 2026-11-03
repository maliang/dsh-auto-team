/**
 * 面板桥的领域层：把「面板要看的」与「面板能做的」收敛成一个快照方法 + 一个动作方法，
 * 与传输方式（HTTP / 工具调用）无关 —— 传输由 host/http.ts 与 adapters.ts 负责。
 *
 * 两条入口共用本文件（AC 高频缺陷「工具能用、面板不能用」的唯一防线）：
 *   - HTTP：POST /api/auto-team/act  →  bridge.act
 *   - 工具：auto_team_message / auto_team_receipt / auto_team_memory / auto_team_role → 同一个 bridge.act
 *
 * 18 个动作与拒绝码对照（TECHNICAL §4.2 / §5.x；r7 新增 4 个动作与 PAUSED 码，
 * r11 新增 cancelTask / skipTask / updateAcceptance 三个单任务动作）：
 *   toggle               → 只改开关并落盘，**绝不派发**（反目标 1）
 *   dispatch             → NOT_ENABLED / NO_PLAN / NOT_FOUND(runId) / PLAN_ALREADY_DISPATCHED /
 *                          ROLE_UNAVAILABLE / MODEL_UNRESOLVABLE / CONCURRENCY_FULL（后三者来自编排层 skipped 分类）
 *   cancel               → NO_PLAN
 *   setTaskRole          → NOT_ENABLED / NO_PLAN / NOT_FOUND / BAD_REQUEST（已派发不可换角）
 *   message              → NOT_ENABLED / NO_PLAN / NOT_FOUND / BAD_REQUEST / NO_CALLER（端口透传）
 *   resume               → NOT_ENABLED / NO_PLAN / NOT_FOUND
 *   receipt              → NOT_ENABLED / NO_PLAN / NOT_FOUND / GATE_FAILED（空验收命令）
 *   saveMemory           → NOT_ENABLED / BAD_REQUEST（非法文件名）
 *   deleteMemory         → NOT_ENABLED / BAD_REQUEST / NOT_FOUND
 *   saveRole             → NOT_ENABLED / BAD_REQUEST
 *   deleteRole           → NOT_ENABLED / NOT_FOUND / BAD_REQUEST（内置角色不可删）
 *   pause                → NOT_ENABLED / NO_PLAN / BAD_REQUEST（计划已结束）；重复暂停幂等
 *   resumeTeam           → NOT_ENABLED / NO_PLAN / BAD_REQUEST（计划已结束）；未暂停幂等 no-op
 *   restoreDefaultRoles  → NOT_ENABLED / BAD_REQUEST（角色库不可写）
 *   saveSettings         → NOT_ENABLED / BAD_REQUEST（任一项非法 → 磁盘一字不改）
 *   cancelTask           → NO_PLAN / NOT_FOUND / BAD_REQUEST（允许集只从 shared/task-actions.ts 派生）
 *   skipTask             → NO_PLAN / NOT_FOUND / BAD_REQUEST（下游 blocked → pending）
 *   updateAcceptance     → NO_PLAN / NOT_FOUND / BAD_REQUEST（空串 → 三条模板全文）；
 *                          `done` 允许（r13 取代 r11#AC-26）并当场重跑门禁，结论走 applyReceipt
 *
 * **PAUSED 闸门**（r7 AC-16）：计划处于暂停态时，`dispatch` / `resume` / `receipt` 一律被拒
 * （这三个都会推进状态机），其余动作放行。闸门就在 `act()` 的入口处一处判断，不散落到组件。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type {
  ActResult,
  ActivityEvent,
  AutoTeamSettings,
  CaptainModelView,
  DurationCell,
  ExpandPayload,
  GateEvidence,
  LibraryView,
  MemberStatus,
  MemberView,
  MemoryTrack,
  MessageRecord,
  ModelCatalogView,
  PanelAction,
  PanelSnapshot,
  RejectionCode,
  Result,
  Role,
  RunSummary,
  SkillDraft,
  SkillInfo,
  SkillMutation,
  TaskStatus,
  UsageCell,
} from '../shared/types.ts'
import { HISTORY_PAGE_SIZE, LIBRARY_CACHE_MS } from '../shared/const.ts'
import {
  TASK_STATUS_LABELS,
  taskActionAllowed,
  taskActionDisabledReason,
  type TaskActionName,
} from '../shared/task-actions.ts'
import {
  DEVIATION_SNAPSHOT_LIMIT,
  MAX_CONCURRENT_LIMIT,
  MEMORY_LINES_PER_TASK,
  STALL_MS,
} from './config.ts'
import { runGate } from './gate/gate.ts'
import { durationCellOf, usageCellOf } from './format.ts'
import type { AutoDispatchCause } from './team/auto-dispatch.ts'
import { selectMemory } from './memory/inject.ts'
import { deleteMemory, listMemory, readMemory, safeMemoryName, writeMemory } from './memory/repo.ts'
import type { MemoryRoots } from './memory/repo.ts'
import { normalizeWorkspace, projectMemoryDir } from './paths.ts'
import { emptyAcceptanceError } from './plan/acceptance.ts'
import { blockedTasks, depSatisfied, readyTasks } from './plan/graph.ts'
import { progressOf } from './plan/plan.ts'
import { deriveScopeLocks } from './plan/scope.ts'
import { BUILTIN_SKILLS } from './roles/builtin.ts'
import type { RoleRepo } from './roles/repo.ts'
import type { SkillRecord, SkillRepo } from './roles/skills-repo.ts'
import type { SystemSkillSource } from './roles/system-skills.ts'
import { defaultSettings, type SettingsRepo } from './settings.ts'
import { MESSAGES_LIMIT, type RunState, type RunsStore } from './store.ts'
import type { DeviationRecorder } from './team/deviation.ts'
import { isTerminalTaskStatus } from './team/dispatch.ts'
import { isIrreversibleAction, pendingFor, pendingViewOf } from './team/confirm.ts'
import { runUsageOf, taskUsageOf } from './team/usage.ts'
import { releaseScopes } from './team/scope-locks.ts'
import { secondsText, stallOf } from './team/stall.ts'


/** 门禁串行队列上限（TECHNICAL §5.3：避免一次 receipt 风暴炸出多个 shell）。 */
const GATE_QUEUE_LIMIT = 8

/** 活动流最多保留的条数（面板只显示最近 50 条，避免快照无限膨胀）。 */
const ACTIVITY_LIMIT = 50

/** peer 交接消息的 messageId 前缀（`handoff:<上游>-><下游>`，AC-5 的幂等键，由 team/handoff.ts 生成）。 */
const HANDOFF_MESSAGE_PREFIX = 'handoff:'

/** 回执：门禁判定结果（done 的唯一写点在 team/dispatch.ts 的 applyReceipt）。 */
export interface ReceiptInput {
  verdict: 'done' | 'rework' | 'failed'
  note?: string
  evidence?: GateEvidence
}

/** 编排层（team/dispatch.ts dispatchReady）的结果投影：桥只需要这几项来分类拒绝码。 */
export interface DispatchOutcome {
  started: string[]
  skipped: Array<{ taskId: string; reason: string }>
  errors: Array<{ taskId: string; error: string; code?: RejectionCode }>
  /**
   * 本轮因成员名被占用而改用带序号名字的任务（AC-5）。
   * 结构化内联、不 import team/ 层的类型：bridge 是编排接口层，与 dispatch.ts 保持解耦。
   * 缺省/空数组 = 没有改名（沿用既有 binding 名不重复提示）。
   */
  renamed?: Array<{ taskId: string; base: string; final: string }>
}

export type DispatchPort = (state: RunState) => Promise<DispatchOutcome>

/** 编排层（team/dispatch.ts resumeRun）的结果投影。 */
export interface ResumeOutcome {
  resumed: number
  skipped: number
  unchanged: boolean
}

export type ResumePort = (state: RunState) => Promise<ResumeOutcome>

/** done/rework/failed 的唯一写点（team/dispatch.ts applyReceipt）。 */
export type ApplyReceiptPort = (
  state: RunState,
  taskId: string,
  receipt: ReceiptInput,
  now: number,
  /**
   * 返工上限（r7 AC-13 的 settings 生效点）。**可选**：既有实现在不传时取 `config.MAX_ATTEMPTS`，
   * 与今天的逐字行为一致；装配层传 `settings.maxAttempts` 才让它可配。
   */
  maxAttempts?: number,
) => RunState

/** 直达消息端口（adapters 注入 agentTeams.sendMessage；无 caller 时带 code='NO_CALLER'）。 */
export type SendPort = (
  memberId: string,
  text: string,
) => Promise<{ ok: boolean; error?: string; code?: RejectionCode }>

export interface BridgeDeps {
  store: RunsStore
  roles: RoleRepo
  memoryRoots: { publicDir: string; projectDir: string }
  /** `<home>/.dsh/auto-team` —— 会话开关状态的持久化根。 */
  dataRoot: string
  /** 派发端口：并发切片/成员命名/幂等都在 team/dispatch.ts，桥不重复实现。 */
  dispatch: DispatchPort
  /** 恢复端口（幂等去抖也在编排层，桥只转派）。 */
  resume: ResumePort
  /** 回执应用端口（done 的唯一写点）。 */
  applyReceipt: ApplyReceiptPort
  /** 直达消息端口。 */
  sendMessage: SendPort
  /** 门禁执行上下文：cwd 用于跑验收命令，artifactsDir 落全量日志（AC-19）。 */
  gate: { cwd: string; artifactsDir: string; timeoutMs?: number }
  /** 宿主并发上限（adapters.resolveConcurrencyLimit）；缺省按 MAX_CONCURRENT_LIMIT 且标注 default。 */
  hostConcurrency?: () => { limit: number; source: 'host' | 'default'; requested?: number; clamped?: boolean }
  /**
   * 停滞判定阈值（毫秒）。缺省 `STALL_MS`。
   *
   * AC-13：常量只在 `config.ts` 定义一次，这里**只接收参数**——`stallOf` 也因此收参数而不自己读常量，
   * 否则单测无法注入不同阈值，「阈值单一定义」这条 AC 会退化成两处各写一遍。
   */
  stallMs?: number
  now?: () => number
  /**
   * 队长模型投影（AC-2）。**可选注入**：缺省时快照不带 `captainModel`，客户端显示「未投影」
   * —— 这样装配层漏接线时面板说「不知道」，而不是假装「跟随宿主默认」。
   */
  captainModel?: () => CaptainModelView
  /**
   * 事件源健康度（AC-18）。只在装配层把四类事件订阅起来之后注入；缺省 = 未接事件源，
   * 快照 `degraded: false` 且不解释（此时面板无降级可言，因为本来就没有事件通路）。
   */
  triggerHealth?: () => { degraded: boolean; reason?: string }
  /**
   * 记忆展开端口（AC-9/AC-11）：`createExpander({roots})` 的 `expand`。
   *
   * 依赖用可选注入而不是在这里 `import` 文件系统实现：缺省时 `expandMemory` 明确报「不可用」，
   * 单测可以传一个只返回固定 payload 的桩，不必造临时目录。
   */
  expander?: (id: string, depth?: number) => ExpandPayload
  /**
   * settings.json 仓储（r7 AC-13 的**唯一**可配参数来源）。
   *
   * 可选而不是必选：`BridgeDeps` 在 `test/trigger-bus.test.ts` 与 `test/wire.test.ts` 里也被直接构造，
   * 那些用例关心的是 Trigger/HTTP 语义、不该被迫造一个设置文件。缺省时：
   *   - 快照 `settings` 回落到 `defaultSettings()`（与今天逐字一致，AC-11）；
   *   - `saveSettings` 明确拒绝「设置仓储未装配」，而不是假装保存成功。
   */
  settingsRepo?: SettingsRepo
  /**
   * 设置保存成功后的重生效回调（r7）。装配层用它重装队长模型路由（`settings.captainModel`
   * 是 settings.json 唯一写入点），并让 watcher 的停滞阈值取到新值。
   *
   * **同步调用**：调用方负责自己吞错 —— 保存已经落盘成功，回调失败不能让面板显示保存失败。
   */
  onSettingsSaved?: (settings: AutoTeamSettings) => void
  /**
   * 技能 md 仓储（r10 AC-17/AC-20）：四来源技能的唯一写点 + 快照的技能投影来源。
   *
   * 可选装配，理由与 `settingsRepo` 同族：`BridgeDeps` 在多处测试夹具里被直接构造，
   * 那些用例关心的是派发/Trigger/暂停语义，不该被迫造一个技能目录。缺省时：
   *   - `skillsOf()` 回退内置技能的只读投影（与 r7 逐字一致，面板不会空列表）；
   *   - `saveRole` 里带 `skills` 变更 → 明确拒绝「技能仓储未装配」，而不是假装保存成功；
   *   - `readSkillBody` 明确报「无法读取技能正文」。
   */
  skills?: SkillRepo
  /**
   * 宿主系统技能库（只读扫描 `~/.agents/skills`，r10 AC-19）。
   *
   * 缺省 = 没有系统技能可选（面板的多选弹层显示空 + 原因）。装配层一定会传，
   * 因为「宿主系统技能库在哪」是**宿主事实**，不能由 bridge 自己拼路径（AGENTS §4）。
   */
  systemSkills?: SystemSkillSource
  /**
   * 模型清单的同步投影（r10 AC-16）。实现是 `host/model-catalog.ts` 的 TTL 缓存：
   * 快照是同步 API，宿主清单是异步的，两者只能在这里握手。
   *
   * 缺省 = `{ status: 'empty', options: [], reason: '宿主未提供模型清单' }`：
   * 面板据此显示原因，而不是给一个看起来「没有模型」的空下拉（假阴性）。
   */
  modelCatalog?: () => ModelCatalogView
  /**
   * 中断成员端口（r11 AC-26）：`cancelTask` 取消一个 `running` 任务时**尽力**中断它的成员。
   *
   * 缺省 = 只改任务状态：`cancelled` 是权威，成员由 watcher 对账；中断失败只进 notice，
   * 绝不让「取消」这个动作失败（否则用户点一次取消得到红字，状态却没变）。
   */
  interruptMember?: (name: string) => Promise<{ ok: boolean; error?: string }>
  /**
   * 队长亲手写文件的留痕（r11 AC-22/AC-24）：快照 `deviations` 的**唯一**来源。
   *
   * 缺省 = 空数组：`BridgeDeps` 在多处测试夹具里被直接构造，那些用例不该被迫造一个可写目录。
   */
  deviations?: DeviationRecorder
  /**
   * r13 AC-21/AC-23：左栏项目库装配端口（实现在 `host/library.ts`，由 `index.ts` 注入）。
   *
   * 缺省 = 空库（`projects: []` + 空全局记忆）：装配层漏接线时左栏显示「还没有项目」，
   * 而不是在 bridge 里长第二份装配逻辑（PRD 重复风险清单点名禁止）。
   */
  libraryView?: (query: { sessionId?: string; runId?: string }) => LibraryView
  /**
   * r13 AC-23：工作区白名单（`library.isKnownWorkspace`）。
   *
   * `readMemoryFile(..., workspace)` 允许跨项目读记忆，但**目录名来自调用方输入**：
   * 没有白名单时一次 `workspace=/etc` 就能把任意 `.auto-team/memory/*.md` 读出来。
   * 缺省 = 只允许当前工作区（`memoryRoots.projectDir` 对应的那个）。
   */
  isKnownWorkspace?: (path: string) => boolean
  /**
   * r13 AC-8：run 状态变化通知（计划保存 / 任务终态 / 成员退出 …）。
   *
   * bridge 只在**自己改完状态**后调它，真正的派发语义在装配层的 auto dispatcher 里；
   * 桥不直接派发，否则就出现第二条派发路径（绕过四道闸）。
   */
  onRunChanged?: (sessionId: string, runId: string, cause: 'plan-saved' | 'task-terminal' | 'member-exit' | 'tasks-added' | 'tick') => void
}

export interface Bridge {
  enabled(sessionId: string): boolean
  setEnabled(sessionId: string, enabled: boolean): void
  snapshot(sessionId: string): PanelSnapshot
  act(sessionId: string, action: PanelAction): Promise<ActResult>
  /**
   * r13 AC-21/AC-22：左栏项目库（含 `?runId=` 时的历史详情）。
   *
   * 走的是与 `GET /library` 同一条装配（`BridgeDeps.libraryView`），
   * 因此「右栏看到的 run」与「左栏点开的历史 run」是同一份 `RunDetailView`。
   */
  library(query: { sessionId?: string; runId?: string }): LibraryView
  /** 面板记忆页：先读正文再编辑（否则保存会把已有记忆清空，缺陷 D7）。 */
  readMemoryFile(
    track: MemoryTrack,
    name: string,
    workspace?: string,
  ): Promise<Result<{ track: MemoryTrack; name: string; body: string; chars: number }>>
  /**
   * 面板技能编辑弹层：按需读技能正文（r10 AC-17）。
   *
   * 复用 `GET /memory?track=skill` 这条**同一条**正文通道（不新开路由），因此返回形状
   * 与 `readMemoryFile` 同族；`title` 一并带出，弹层标题不必再从 `snapshot.skills` 里反查。
   */
  readSkillBody(id: string): Promise<Result<{ id: string; title: string; body: string; chars: number }>>
  /** 队长侧（工具/提示词）用的记忆注入文本。 */
  memoryFor(goal: string): { text: string; truncated: boolean; chars: number }
  /** 队长侧：写入一条记忆（可带 track），按 MEMORY_LINES_PER_TASK 裁剪。 */
  remember(track: MemoryTrack, name: string, body: string): Result<{ name: string }>
  /**
   * 按 `mem://<track>/<stem>` 展开记忆原文（AC-9/AC-11）。
   *
   * 成功与失败都包成 `Result`：`code !== 'OK'` 的 payload 也走 `data`，因为**码本身是结论**
   * （`EXPAND_NOT_FOUND` / `EXPAND_PATH_ESCAPE` …），压成一句 `error` 字符串工具层就透不出码了。
   * 只有「端口没装配」这一种装配期缺失才用 `error`（那不是展开语义的一部分）。
   */
  expandMemory(id: string, depth?: number): Result<ExpandPayload>
}

interface SessionFlag {
  enabled: boolean
  updatedAt: number
}

/** 空验收命令的拒绝码：TECHNICAL §5.3 明确要求 GATE_FAILED，但 §4.2 的码表未收录，故窄化断言。 */
const GATE_FAILED = 'GATE_FAILED' as unknown as RejectionCode

const NOT_ENABLED_TEXT = '自动团队未启用：请先在输入框内的「自动团队」选项处启用'

/** PAUSED 文案（AC-16）：必须同时说清「为什么被拒」与「下一步点哪儿」。 */
const PAUSED_TEXT = '任务已暂停：请先在面板顶部点「继续任务」再操作'

/** 暂停期间被闸门拒绝的动作（三个都会推进状态机；其余动作照常放行）。 */
const PAUSED_BLOCKED: ReadonlySet<PanelAction['type']> = new Set<PanelAction['type']>([
  'dispatch',
  'resume',
  'receipt',
])

export function createBridge(deps: BridgeDeps): Bridge {
  const now = deps.now ?? (() => Date.now())

  /**
   * 生效设置（r7 AC-13）：**每次读盘**而不是装配时读一次 —— 用户在设置页改完立刻生效，
   * 不需要重启宿主。读失败（文件损坏/无权限）由 `settingsRepo.read()` 自己回落缺省，这里不再兜。
   */
  function settingsOf(): AutoTeamSettings {
    return deps.settingsRepo === undefined ? defaultSettings() : deps.settingsRepo.read()
  }

  /**
   * 停滞阈值：装配层显式注入优先（测试/演练要固定阈值），否则取 settings（缺省 = `STALL_MS`）。
   * 这条优先级刻意与「设置生效点」相反，理由见 AC-11：常量值不变、参数可注入，
   * 单测才能用 2000ms 打出 stalls 而不必等 90 秒。
   */
  function stallMsOf(settings?: AutoTeamSettings): number {
    return deps.stallMs ?? (settings ?? settingsOf()).stallMs
  }

  /**
   * 技能投影（r10 AC-18：四来源 + 「已修改」标记）。
   *
   * 有技能仓储时**只认仓储投影**（磁盘是唯一真相：seed 铺底 + 用户覆盖层）；
   * 没装配仓储时回退内置只读投影，`source:'builtin' / modified:false` —— 与 r7 逐字一致，
   * 保证「装配层漏接线」不会让面板的技能列表凭空消失。
   */
  function skillsOf(): SkillInfo[] {
    const repo = deps.skills
    if (repo !== undefined) return repo.projection()
    return BUILTIN_SKILLS.map((skill) => ({
      id: skill.id,
      title: skill.title,
      description: firstLine(skill.body.replace(/^#+\s*/, '')),
      source: 'builtin' as const,
      modified: false,
    }))
  }

  /**
   * 系统技能扫描（r10 AC-19 / AC-18b）：**只扫一次盘**，投影与不可用原因一起带出去。
   *
   * 为什么连 reason 一起下发：「扫到 0 条」与「本机没有这个库」在界面上必须长得不一样。
   * 只给空数组，用户看到的就是「弹层空着、也不说为什么」——验收 R2 卡的就是这一处。
   */
  function systemSkillScan(): { skills: { name: string; description: string }[]; reason?: string } {
    const source = deps.systemSkills
    if (source === undefined) return { skills: [], reason: '系统技能库未装配（宿主未注入扫描器）' }
    try {
      const scan = source.scan()
      return {
        skills: scan.skills.map((skill: { name: string; description: string }) => ({
          name: skill.name,
          description: skill.description,
        })),
        ...(scan.reason === undefined ? {} : { reason: scan.reason }),
      }
    } catch (error) {
      // 扫描器自身已按「坏文件跳过 + reason」降级（roles/system-skills.ts）；这里只兜最后一道，
      // 绝不让一条坏 SKILL.md 把整个快照打成异常（面板会连角色一起读不出来）。
      return { skills: [], reason: `系统技能库扫描失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const flags = loadFlags()
  let messageSeq = 0
  let gateQueueDepth = 0
  let gateChain: Promise<unknown> = Promise.resolve()

  function flagsPath(): string {
    return `${deps.dataRoot}/sessions.json`
  }

  function loadFlags(): Record<string, SessionFlag> {
    const path = flagsPath()
    if (!existsSync(path)) return {}
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, SessionFlag>
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  function persistFlags(): void {
    mkdirSync(deps.dataRoot, { recursive: true })
    const path = flagsPath()
    const tmp = `${path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(flags, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
  }

  // ---------- 落盘 ----------

  function loadState(sessionId: string): RunState | null {
    return deps.store.latestForSession(sessionId)
  }

  function saveState(state: RunState, cause: AutoDispatchCause = 'plan-saved'): RunState {
    deps.store.save(state)
    // r13 AC-8：状态变了就通知装配层（自动派发的触发点之一）。回调由装配层提供，
    // 这里只负责「说一声」——派发语义不进入 bridge，否则就是第二条派发路径。
    //
    // `cause` 必须由**产生这次变化的动作**给出（任务终态 = `task-terminal`，其余默认
    // `plan-saved`）：dispatcher 的 kick 会带着 cause 出报告与退避统计，统一写成
    // `plan-saved` 会让「任务刚跑完」和「刚保存计划」在诊断里无法区分。
    const notify = deps.onRunChanged
    if (typeof notify === 'function') {
      try {
        notify(state.plan.sessionId, state.plan.runId, cause)
      } catch {
        // 通知失败不能让保存失败：盘上状态才是权威，下一轮 tick 会补上。
      }
    }
    return state
  }

  function withTask(state: RunState, taskId: string, patch: (task: RunState['plan']['tasks'][number]) => RunState['plan']['tasks'][number]): RunState {
    return {
      ...state,
      plan: {
        ...state.plan,
        tasks: state.plan.tasks.map((task) => (task.id === taskId ? patch(task) : task)),
      },
    }
  }

  function recordOf(input: {
    from: string
    to: string
    toMemberId?: string
    taskId?: string
    body: string
    at: number
  }): MessageRecord {
    messageSeq += 1
    return {
      at: input.at,
      from: input.from,
      to: input.to,
      toMemberId: input.toMemberId,
      taskId: input.taskId,
      body: input.body,
      messageId: `msg-${input.at}-${messageSeq}`,
    }
  }

  /** 消息账本追加（上限 MESSAGES_LIMIT，与 store 的落盘约束同源）。 */
  function withMessage(state: RunState, message: MessageRecord): RunState {
    const messages = [...state.messages, message]
    return { ...state, messages: messages.slice(Math.max(0, messages.length - MESSAGES_LIMIT)) }
  }

  // ---------- 门禁串行队列 ----------

  function enqueueGate<T>(run: () => Promise<T>): Promise<T> {
    if (gateQueueDepth >= GATE_QUEUE_LIMIT) {
      return Promise.reject(new Error(`门禁队列已满（上限 ${GATE_QUEUE_LIMIT}），请稍后再试`))
    }
    gateQueueDepth += 1
    const next = gateChain.then(run, run)
    gateChain = next.then(
      () => undefined,
      () => undefined,
    )
    return next.finally(() => {
      gateQueueDepth -= 1
    })
  }

  // ---------- 直通投递的实发 ----------

  /**
   * peer 交接的**唯一实发点**（AC-4(a)）。`applyReceipt` 是纯函数、只落账；`deps.sendMessage`
   * 只在这个作用域可用，所以「把 body 真送进成员会话」全仓只有这一处。
   *
   * 只发「本次新增 + `from==='peer'` + `toMemberId` 有值」的条目：
   *   - `toMemberId` 有值 ⇒ 下游成员已经存在，可以实发；
   *   - 缺省 ⇒ B 尚未创建（常规路径），body 留在账本里，等 B 创建时由 `buildMemberPrompt`
   *     经 `handoffBodiesFor` 注入首条提示词（AC-4(b)），此处**不得**硬塞一条消息。
   * 失败只回 notice：绝不补一条 `from:'captain'` 的账本消息（AC-3 反面目标 3）——那会把
   * 「信息其实还是过了一遍队长」写成账本事实。
   */
  async function deliverPeerHandoffs(before: RunState, after: RunState): Promise<string[]> {
    const known = new Set(before.messages.map((message) => message.messageId))
    const notices: string[] = []
    for (const message of after.messages) {
      const id = message.messageId
      if (id === undefined || !id.startsWith(HANDOFF_MESSAGE_PREFIX) || known.has(id)) continue
      if (message.from !== 'peer' || message.toMemberId === undefined) continue
      const target = message.to
      try {
        const sent = await deps.sendMessage(message.toMemberId, message.body)
        notices.push(
          sent.ok
            ? `上游交接已直投给 ${target}${message.taskId === undefined ? '' : `（${message.taskId}）`}`
            : `上游交接直投 ${target} 失败：${sent.error ?? '未知原因'}（记录已在账本里，成员创建时仍会注入）`,
        )
      } catch (error) {
        notices.push(
          `上游交接直投 ${target} 失败：${error instanceof Error ? error.message : String(error)}（记录已在账本里）`,
        )
      }
    }
    return notices
  }

  // ---------- 快照 ----------

  function activityOf(state: RunState | null): ActivityEvent[] {
    if (!state) return []
    const events: ActivityEvent[] = []
    events.push({
      at: state.plannedAt,
      kind: 'plan',
      text: `计划就绪：${state.plan.tasks.length} 个任务（尚未创建成员）`,
      // AC-17：计划是用户/队长发起的一步，标成 user；客户端「最近推进」条靠 source 分自动/用户。
      source: 'user',
    })
    for (const binding of state.bindings) {
      events.push({
        at: binding.spawnedAt,
        memberId: binding.memberId,
        taskId: binding.taskId,
        kind: 'spawn',
        text: `创建成员 ${binding.name}`,
        source: 'user',
      })
    }
    for (const message of state.messages) {
      events.push({
        at: message.at,
        memberId: message.toMemberId,
        taskId: message.taskId,
        kind: 'message',
        text: `${message.from} → ${message.to}：${firstLine(message.body)}`,
        source: 'user',
      })
    }
    for (const audit of state.routeAudits) {
      if (audit.verdict !== 'drift') continue
      events.push({
        at: audit.at,
        taskId: audit.taskId,
        kind: 'route_drift',
        text: `模型路由漂移：${audit.taskId} 声明 ${routeText(audit.declared)} 实际 ${routeText(audit.actual)}`,
      })
    }
    for (const task of state.plan.tasks) {
      if (task.evidence) {        events.push({
          at: task.evidence.at,
          memberId: task.memberId,
          taskId: task.id,
          kind: 'gate',
          text: `${task.id} 门禁退出码 ${task.evidence.exitCode}`,
        })
      }
      if (task.status === 'rework') {
        events.push({
          at: task.evidence?.at ?? state.plannedAt,
          memberId: task.memberId,
          taskId: task.id,
          kind: 'rework',
          text: `${task.id} 返工（第 ${attemptsOf(task)} 次）`,
        })
      }
    }
    // 停滞告警由 watcher.tick 落盘（一个 episode 恰好一条，AC-8），这里**只读合并**：
    // 绝不在这里比较阈值 —— 判定只剩 watcher.tick 一个出口，否则同一次停滞会被算出两条告警。
    for (const alert of state.stallAlerts ?? []) events.push(alert)
    // r5 Trigger 记录并入活动流（AC-17）：**只并 accepted 的**——活动流回答「发生了什么」，
    // 「为什么没推进」留在 `snapshot.triggers` 的完整账本里，否则「最近推进」条会混进一堆未推进。
    // kind 复用既有 9 个里的 `status`：新增 kind 会破 AC-16，而 Trigger 的类型信息在
    // `snapshot.triggers[].kind` 里已经完整（四类），客户端要分类就读那一份。
    for (const record of state.triggers ?? []) {
      if (!record.accepted) continue
      events.push({
        at: record.at,
        memberId: record.memberId,
        taskId: record.taskId,
        kind: 'status',
        text: record.text,
        source: 'trigger',
      })
    }
    return events.sort((a, b) => b.at - a.at).slice(0, ACTIVITY_LIMIT)
  }

  function membersOf(state: RunState | null, roles: Role[], stallMs: number): MemberView[] {
    if (!state) return []
    const roleById = new Map(roles.map((role) => [role.id, role]))
    const taskById = new Map(state.plan.tasks.map((task) => [task.id, task]))
    const views: MemberView[] = []
    const seen = new Set<string>()

    for (const binding of state.bindings) {
      if (binding.retired === true || seen.has(binding.memberId)) continue
      seen.add(binding.memberId)
      const task = taskById.get(binding.taskId)
      const status = toMemberStatus(task?.status ?? 'pending')
      views.push({
        memberId: binding.memberId,
        name: binding.name,
        roleId: binding.roleId,
        taskId: binding.taskId,
        status,
        ...stallFieldsOf(state, binding.memberId, status, binding.spawnedAt, stallMs),
        lastEventAt: lastEventAtOf(state, binding.memberId, binding.spawnedAt),
        modelRoute: describeRoute(roleById.get(binding.roleId)),
        canResume: status !== 'done',
      })
    }

    // 兼容 v1 落盘的裸 Plan：task.memberId 有值但没有 binding（wrapLegacy 已升级结构，这里只兜底展示）。
    for (const task of state.plan.tasks) {
      if (task.memberId === undefined || seen.has(task.memberId)) continue
      seen.add(task.memberId)
      const status = toMemberStatus(task.status)
      views.push({
        memberId: task.memberId,
        name: roleById.get(task.roleId)?.name ?? task.roleId,
        roleId: task.roleId,
        taskId: task.id,
        status,
        ...stallFieldsOf(state, task.memberId, status, state.plannedAt, stallMs),
        lastEventAt: lastEventAtOf(state, task.memberId, state.plannedAt),
        modelRoute: describeRoute(roleById.get(task.roleId)),
        canResume: status !== 'done',
      })
    }
    return views
  }

  /**
   * 停滞三字段（AC-14 的数据源，客户端因此零阈值零格式化）。
   *
   * **只有 `running` 才可能 `stalled`**：done/failed/interrupted 的成员本来就不会再产出，
   * 把它们标成「停滞」等于让面板永远挂一片黄色（PRD 反面目标 4）。判定只调 `stall.stallOf`
   * （与 watcher.tick 同一份实现，阈值只作参数传入），秒数文案只调 `stall.secondsText`。
   */
  function stallFieldsOf(
    state: RunState,
    memberId: string,
    status: MemberStatus,
    fallbackAt: number,
    stallMs: number,
  ): { stalled: boolean; stalledForMs: number; stalledSecondsText: string } {
    if (status !== 'running') return { stalled: false, stalledForMs: 0, stalledSecondsText: '' }
    const progressAt = state.progress?.[memberId]?.at
    const baseline = progressAt ?? fallbackAt
    const judge = stallOf(progressAt, baseline, now(), stallMs)
    return {
      stalled: judge.stalled,
      stalledForMs: judge.stalledForMs,
      stalledSecondsText: judge.stalled ? secondsText(judge.stalledForMs) : '',
    }
  }

  function lastEventAtOf(state: RunState, memberId: string, fallback: number): number {
    let at = fallback
    for (const message of state.messages) {
      if (message.toMemberId === memberId || message.from === memberId) at = Math.max(at, message.at)
    }
    for (const task of state.plan.tasks) {
      if (task.memberId !== memberId || !task.evidence) continue
      at = Math.max(at, task.evidence.at)
    }
    return at
  }

  /**
   * 记忆根（r13 AC-23）：默认当前工作区；带 `workspace` 时换 projectDir，public 永远全局。
   *
   * 白名单是硬闸：`workspace` 来自 HTTP 查询参数，没有 `isKnownWorkspace` 时只允许当前
   * 工作区 —— 否则一次 `workspace=/etc` 就能把任意目录下 `.auto-team/memory/*.md` 读出来。
   */
  function rootsFor(workspace: string | undefined): MemoryRoots | null {
    if (workspace === undefined || workspace.trim() === '') return deps.memoryRoots
    const requested = normalizeWorkspace(workspace)
    const known = deps.isKnownWorkspace
    if (typeof known !== 'function' || !known(requested)) return null
    return { publicDir: deps.memoryRoots.publicDir, projectDir: projectMemoryDir(requested) }
  }

  function memoryFiles(): MemorySnapshotFiles {
    const files = [...listMemory('project', deps.memoryRoots), ...listMemory('public', deps.memoryRoots)]
    return {
      files,
      candidates: files.map((file) => ({
        track: file.track,
        name: file.name,
        body: readMemory(file.track, file.name, deps.memoryRoots),
        updatedAt: file.updatedAt,
      })),
    }
  }

  function concurrencyOf(state: RunState | null): PanelSnapshot['concurrency'] {
    const host = deps.hostConcurrency?.() ?? { limit: MAX_CONCURRENT_LIMIT, source: 'default' as const }
    const running = state
      ? state.plan.tasks.filter((task) => task.status === 'running' || task.status === 'gate').length
      : 0
    const limit = state
      ? Math.min(state.plan.maxConcurrent, host.limit, MAX_CONCURRENT_LIMIT)
      : Math.min(host.limit, MAX_CONCURRENT_LIMIT)
    // R2：`requested` 是用户/计划想跑的上限，`limit` 是真正生效的那个；两者不等就是被夹了。
    const requested = Math.max(host.requested ?? host.limit, 1)
    return { limit, running, source: host.source, requested, clamped: limit < requested }
  }

  /**
   * 应用一批技能变更（r10 AC-17/AC-20），逐条执行、遇错即停并返回可读原因。
   *
   * 语义要点：
   *  - `save` 的 `source:'system'` 且正文为空 → 现场按 `systemName` 去系统技能库读正文：
   *    系统技能正文不进快照（可能上千字 × N 条），只在用户真的选中并保存时读一次。
   *  - `delete` 成功必须**同时摘除所有角色的引用**，并把「从 N 个角色摘除」报出来 ——
   *    否则用户只看到技能没了，却不知道角色卡上还挂着已删除的 id（成员提示词会出现「缺失技能」）。
   */
  function applySkillMutations(
    mutations: readonly SkillMutation[],
  ): { ok: true; notices: string[] } | { ok: false; error: string } {
    const repo = deps.skills
    if (repo === undefined) return { ok: false, error: '技能仓储未装配：本次运行无法修改技能' }
    const notices: string[] = []
    for (const mutation of mutations) {
      if (mutation.op === 'save') {
        const resolved = withSystemBody(mutation.skill)
        if (!resolved.ok) return { ok: false, error: resolved.error }
        const saved = repo.save(resolved.draft)
        if (saved.error !== undefined) return { ok: false, error: saved.error }
        notices.push(`已保存技能『${saved.data.title}』（${saved.data.id}）`)
        continue
      }
      if (mutation.op === 'delete') {
        const removed = repo.remove(mutation.id)
        if (removed.error !== undefined) return { ok: false, error: removed.error }
        const detached = detachSkill(mutation.id)
        notices.push(
          detached === 0
            ? `已删除『${removed.data.title}』，它未被任何角色引用`
            : `已删除『${removed.data.title}』，并从 ${detached} 个角色摘除引用`,
        )
        continue
      }
      const restored = repo.restoreBuiltin(mutation.id)
      if (restored.error !== undefined) return { ok: false, error: restored.error }
      notices.push(`已把『${restored.data.title}』恢复为出厂正文`)
    }
    return { ok: true, notices }
  }

  /** 系统技能：正文为空时按 `systemName` 现场读盘（找不到即整条变更失败，不写半截技能）。 */
  function withSystemBody(draft: SkillDraft): { ok: true; draft: SkillDraft } | { ok: false; error: string } {
    if (draft.source !== 'system') return { ok: true, draft }
    if (typeof draft.body === 'string' && draft.body.trim() !== '') return { ok: true, draft }
    const source = deps.systemSkills
    const name = typeof draft.systemName === 'string' ? draft.systemName.trim() : ''
    if (source === undefined) return { ok: false, error: '系统技能库未装配：无法导入系统技能' }
    if (name === '') return { ok: false, error: '系统技能缺少名称：无法定位正文' }
    let entry: { name: string; description: string; body: string } | undefined
    try {
      entry = source.scan().skills.find((skill: { name: string; description: string; body: string }) => skill.name === name)
    } catch (error) {
      return { ok: false, error: `系统技能库扫描失败：${error instanceof Error ? error.message : String(error)}` }
    }
    if (entry === undefined) return { ok: false, error: `系统技能已不存在：「${name}」` }
    return {
      ok: true,
      draft: {
        ...draft,
        title: draft.title.trim() === '' ? entry.name : draft.title,
        description: draft.description.trim() === '' ? entry.description : draft.description,
        body: entry.body,
      },
    }
  }

  /** 把某个技能 id 从所有角色的 `skillIds` 里摘掉，返回被改动的角色数（删除技能后的引用清理）。 */
  function detachSkill(skillId: string): number {
    let detached = 0
    for (const role of deps.roles.list()) {
      if (!Array.isArray(role.skillIds) || !role.skillIds.includes(skillId)) continue
      const saved = deps.roles.save({ ...role, skillIds: role.skillIds.filter((item) => item !== skillId) })
      if (saved.ok) detached += 1
    }
    return detached
  }

  /* ───────────── r13：用量/用时/历史 的装配（文本一律在宿主算好） ───────────── */

  /**
   * run 级用时（快照 `runDuration`）：起点取 `plannedAt`（计划落盘时刻，永远是事实）。
   *
   * 终态但旧 run 没有 `finishedAt` → `unavailable`（不拿「现在」冒充结束时刻，否则一条
   * 昨天跑完的 run 会显示成「跑了两天」）。
   */
  function runDurationOf(state: RunState | null, at: number): DurationCell {
    if (!state) return durationCellOf({ state: 'unavailable', now: at })
    const ended = state.finishedAt !== undefined
    if (!ended && (state.plan.status === 'cancelled' || state.plan.status === 'terminated')) {
      return durationCellOf({ startAt: state.plannedAt, state: 'unavailable', now: at })
    }
    return durationCellOf({
      startAt: state.plannedAt,
      ...(ended ? { endAt: state.finishedAt } : {}),
      state: ended ? 'done' : 'running',
      now: at,
    })
  }

  /** 任务级用时（快照 `taskDurations`，key = taskId）：没有起点 = 未开始，不是 0 秒。 */
  function taskDurationsOf(state: RunState | null, at: number): Record<string, DurationCell> {
    const out: Record<string, DurationCell> = {}
    if (!state) return out
    for (const task of state.plan.tasks) {
      const time = state.taskTimes?.[task.id]
      const startAt = time?.startedAt
      const endAt = time?.endedAt
      const finished = endAt !== undefined || isTerminalTaskStatus(task.status)
      const cellState = startAt === undefined ? 'not-started' : finished ? 'done' : 'running'
      out[task.id] = durationCellOf({
        ...(startAt === undefined ? {} : { startAt }),
        ...(endAt === undefined ? {} : { endAt }),
        state: cellState,
        now: at,
      })
    }
    return out
  }

  /** 任务级用量（快照 `taskUsage`，key = taskId）：优先任务归属，其次该任务的成员。 */
  function taskUsageMapOf(state: RunState | null): Record<string, UsageCell> {
    const out: Record<string, UsageCell> = {}
    if (!state) return out
    for (const task of state.plan.tasks) {
      const memberId = bindingFor(state, task.id)?.memberId ?? task.memberId
      out[task.id] = taskUsageOf(state.usage, task.id, memberId)
    }
    return out
  }

  /**
   * 历史列表（AC-21，≤50）：每个会话自己的 run，最近的在前。
   *
   * 5 秒 memo（与 `LIBRARY_CACHE_MS` 同量级、独立对象）：`store.list()` 会读**每一个** run 文件，
   * 面板 2 秒一刷时不该把历史列表变成每刷一次的磁盘风暴；新建的 run 最多晚 5 秒出现，
   * 而当前 run 本身来自 `latestForSession`，不受影响。
   */
  let historyMemo: { sessionId: string; at: number; runs: RunSummary[] } | null = null
  function historyOf(sessionId: string): RunSummary[] {
    const at = now()
    if (historyMemo && historyMemo.sessionId === sessionId && at - historyMemo.at < LIBRARY_CACHE_MS) {
      return historyMemo.runs
    }
    const runs = deps.store
      .list()
      .filter((run) => run.sessionId === sessionId)
      .slice(0, HISTORY_PAGE_SIZE)
    historyMemo = { sessionId, at, runs }
    return runs
  }

  function snapshot(sessionId: string): PanelSnapshot {
    const state = loadState(sessionId)
    const roles = deps.roles.list()
    const { files, candidates } = memoryFiles()
    // 生效设置只取一次：同一份快照里的预算与停滞阈值必须来自同一次读，否则会出现
    // 「预算 4000 但只注入了 200」这种自相矛盾（一次 snapshot 读两次盘就会发生）。
    const settings = settingsOf()
    const stallMs = stallMsOf(settings)
    const goal = state?.plan.tasks.map((task) => task.title).join(' ') ?? ''
    const selected = selectMemory(goal, candidates, settings.memoryBudget)
    // 事件源健康度与队长模型都由装配层注入（见 BridgeDeps 注释）：缺失就是「未投影」，
    // 不能在这里编一个默认值假装正常——面板的职责是把「我不知道」显示出来（anti-goal 5）。
    const health = deps.triggerHealth?.()
    const captain = deps.captainModel?.()
    // 系统技能只扫一次盘：投影与「为什么是空」必须来自同一次扫描，否则会出现
    // 「列表为空、reason 说库可用」这种自相矛盾的快照（同 settings 的理由）。
    const systemSkillView = systemSkillScan()
    // 暂停态（AC-15）：`paused` 是布尔，按钮文案与 `data-paused` 都只看它；
    // `pausedAt` 只在真暂停时给。计划状态是权威判据（重启后 pause 记录可能被
    // store.normalizePause 丢掉，但 plan.status 一定还在）。
    const paused = state?.plan.status === 'paused'
    const pausedAt = state?.pause?.at
    // r13：一次快照只取一次时间，所有「已等待 / 运行中用时」都基于同一个 now ——
    // 否则同一份快照里两条时间文本会差几毫秒，左栏右栏对不上。
    const at = now()
    const pending = pendingViewOf(state?.pendingConfirmation, at)

    return {
      enabled: flags[sessionId]?.enabled === true,
      runId: state?.plan.runId,
      planStatus: state?.plan.status,
      plannedAt: state?.plannedAt,
      tasks: state?.plan.tasks ?? [],
      members: membersOf(state, roles, stallMs),
      messages: state?.messages ?? [],
      routeAudits: state?.routeAudits ?? [],
      concurrency: concurrencyOf(state),
      memory: {
        injectedChars: selected.chars,
        budget: settings.memoryBudget,
        truncated: selected.truncated,
        files,
        // 内联索引明细（AC-7）与未内联条目（AC-8）：面板据此说「哪几条进了上下文 / 哪几条可展开」。
        inline: selected.entries,
        omitted: selected.notInlined,
      },
      roles,
      activity: activityOf(state),
      // r7 四个新字段：暂停态、生效设置、技能只读投影。全部**必给**（客户端不做缺省推断），
      // pausedAt 例外：未暂停时「没有暂停时刻」是事实，给 0 会被读成「1970 年暂停的」。
      paused,
      ...(paused && pausedAt !== undefined ? { pausedAt } : {}),
      settings,
      skills: skillsOf(),
      // r10 AC-16/AC-19：模型清单与系统技能库。两者都是「宿主能力」，缺省时必须把
      // 「为什么是空」一路带到面板（reason），不能只给一个空数组冒充「本来就没有」。
      modelCatalog: deps.modelCatalog?.() ?? { status: 'empty', options: [], reason: '宿主未提供模型清单' },
      systemSkills: systemSkillView.skills,
      // 库不可用/未装配时把原因带下去（AC-18b）：`systemSkills: []` + 无 reason 会被界面
      // 读成「本机就是没有技能」，用户面对空列表却看不到为什么（验收 R2）。
      ...(systemSkillView.reason === undefined ? {} : { systemSkillsReason: systemSkillView.reason }),
      ...(captain === undefined ? {} : { captainModel: captain }),
      degraded: health?.degraded === true,
      ...(health?.degraded === true
        ? { degradeReason: health.reason ?? '事件源不可用，推进退回轮询兜底' }
        : {}),
      triggers: state?.triggers ?? [],
      // r11 AC-16/AC-19：写域占用**不落盘**，每次快照按 `status + writeScopes` 现算 ——
      // 重启/换 store/读回旧 run 之后等待关系自动重建，不存在「锁表与任务状态不一致」。
      scopeLocks: deriveScopeLocks(state?.plan.tasks ?? [], state?.bindings ?? []),
      // r11 AC-22：执行痕迹只读最近 N 条（DEVIATION_SNAPSHOT_LIMIT）；未装配 = 空数组，
      // 面板据此渲染 0 节点（AC-24 的「0 条不渲染」），而不是显示一块空白标题。
      deviations: deps.deviations?.recent(DEVIATION_SNAPSHOT_LIMIT) ?? [],
      // r13：用量/用时/pending/项目/历史。**文本全部在这里算好**（AC-7 要求右栏与左栏逐字相等，
      // 客户端零拼接）；拿不到就是 `unavailable` + 原因，绝不用字数估算补位。
      ...(state?.project === undefined ? {} : { project: state.project }),
      runUsage: runUsageOf(state?.usage),
      runDuration: runDurationOf(state, at),
      taskUsage: taskUsageMapOf(state),
      taskDurations: taskDurationsOf(state, at),
      ...(pending === undefined ? {} : { pendingConfirmation: pending }),
      // AC-21：历史列表来自快照（≤50），详情走 library(runId) —— 不新增第 5 条路由。
      runs: historyOf(sessionId),
    }
  }

  // ---------- 动作 ----------

  function reject(code: RejectionCode, message: string, sessionId: string, notices?: string[]): ActResult {
    return { snapshot: snapshot(sessionId), notices, rejected: { code, message } }
  }

  function accept(sessionId: string, notices?: string[]): ActResult {
    return { snapshot: snapshot(sessionId), notices }
  }

  function bindingFor(state: RunState, taskId: string | undefined): RunState['bindings'][number] | undefined {
    if (taskId === undefined) return undefined
    return state.bindings.find((binding) => binding.taskId === taskId && binding.retired !== true)
  }

  /**
   * 单任务动作的拒绝文案（r11 AC-26）：**必须**含任务 id 与当前状态中文。
   *
   * 原因句取 `shared/task-actions.ts` 的同一张表（`taskActionDisabledReason`）：面板 disabled
   * 按钮的 `title` 与这里的拒绝是同一句，用户先看到「为什么不能点」，再收到拒绝时说法一致。
   */
  function taskActionDeniedText(
    task: RunState['plan']['tasks'][number],
    action: TaskActionName,
  ): string {
    const label = TASK_STATUS_LABELS[task.status] ?? task.status
    const reason = taskActionDisabledReason(action, task.status)
    return `任务 ${task.id} 当前状态为「${label}」，${reason === '' ? '不允许该动作' : reason}`
  }

  /** 依赖本任务、且尚未终态的下游（AC-26 的「下游未完成者」）。 */
  function downstreamOf(state: RunState, taskId: string): RunState['plan']['tasks'] {
    return state.plan.tasks.filter(
      (item) => item.dependsOn.includes(taskId) && !isTerminalTaskStatus(item.status),
    )
  }

  /**
   * 前置闸（r13 提取）：未启用 / 暂停。
   *
   * 提取出来是因为入口 `act` 与执行体 `executeAction` 都要过同一道闸 —— 确认后重放的动作
   * 期间用户可能已经把插件关掉或暂停了，那时**确认也不该放行**（拒绝语义与直接调用完全一致）。
   */
  function preflightGate(sessionId: string, action: PanelAction): ActResult | null {
    // 开关是唯一的例外：它必须在「未启用」时也能把开关打开。
    if (action.type !== 'toggle' && flags[sessionId]?.enabled !== true) {
      return reject('NOT_ENABLED', NOT_ENABLED_TEXT, sessionId)
    }
    // PAUSED 闸门（r7 AC-16）：**只拦推进类动作**，一个判断点，不散落到各个 case 与组件里。
    // 放行的动作（toggle/cancel/message/saveRole/pause/resumeTeam/confirmPending/...）在暂停时仍然可用：
    // 用户暂停后还得能停用、能发消息问成员、能改角色、能继续、能处理已挂起的确认。见 TECHNICAL §2.3。
    if (PAUSED_BLOCKED.has(action.type)) {
      const paused = loadState(sessionId)
      if (paused?.plan.status === 'paused') return reject('PAUSED', PAUSED_TEXT, sessionId)
    }
    return null
  }

  /**
   * 确认/拒绝一条未决动作（AC-13）。
   *
   * 两条纪律：
   *  - **先落状态再执行**：确认后 pending 立刻消失，即使执行体抛错也不会复活 —— 否则用户会
   *    被同一条确认反复拦住（同一件事被做了两次，比失败严重得多）。
   *  - **执行走 `executeAction`**：与直接调用共用同一个执行体，不存在「确认后行为不一样」。
   */
  async function resolvePending(
    sessionId: string,
    action: { type: 'confirmPending' | 'rejectPending'; pendingId: string },
  ): Promise<ActResult> {
    const state = loadState(sessionId)
    if (!state) return reject('NO_PLAN', '当前会话还没有执行计划', sessionId)
    const pending = state.pendingConfirmation
    if (!pending || pending.id !== action.pendingId) {
      return reject('NOT_FOUND', '该确认已失效（可能已被处理或已刷新），请重新操作', sessionId)
    }
    const cleared: RunState = { ...state, pendingConfirmation: undefined }
    if (action.type === 'rejectPending') {
      saveState(cleared)
      return accept(sessionId, ['已取消该操作：状态未做任何改动'])
    }
    if (pending.action.type === 'forceParallel') {
      const ids = cleared.forceParallel ?? []
      saveState({
        ...cleared,
        forceParallel: ids.includes(pending.action.taskId) ? ids : [...ids, pending.action.taskId],
      })
    } else {
      saveState(cleared)
    }
    return executeAction(sessionId, pending.action)
  }

  /**
   * 动作入口（r13 AC-11 / AC-12 / AC-13）：先过确认闸，再走**同一执行体**。
   *
   * 顺序是刻意的：前置闸（未启用/暂停）在挂 pending **之前**跑 —— 用户不该去确认一个
   * 注定被拒绝的动作。可逆动作（AC-12 的 7 类）在这里不产生任何 pending，直接执行。
   */
  async function act(sessionId: string, action: PanelAction): Promise<ActResult> {
    if (action.type === 'confirmPending' || action.type === 'rejectPending') {
      return resolvePending(sessionId, action)
    }
    const blocked = preflightGate(sessionId, action)
    if (blocked) return blocked
    if (!isIrreversibleAction(action)) return executeAction(sessionId, action)

    const state = loadState(sessionId)
    // 没有运行：交给执行体产出原来的 NO_PLAN / NOT_FOUND 语义（不在这里编第二套码）。
    if (!state) return executeAction(sessionId, action)
    // 已授权过的强制并行：同一任务不再弹第二次（`RunState.forceParallel` 是持久授权）。
    if (action.type === 'forceParallel' && (state.forceParallel ?? []).includes(action.taskId)) {
      return executeAction(sessionId, action)
    }
    const existing = state.pendingConfirmation
    if (existing) {
      return {
        ...reject('CONFIRM_REQUIRED', `已有待确认操作，请先处理：${existing.summary}`, sessionId),
        pendingId: existing.id,
      }
    }
    const pending = pendingFor(state, action, now())
    saveState({ ...state, pendingConfirmation: pending })
    return {
      ...reject('CONFIRM_REQUIRED', `该操作不可逆，需确认：${pending.summary}`, sessionId),
      pendingId: pending.id,
    }
  }

  /** 执行体：所有 Action 的唯一实现（确认闸确认后也回到这里）。 */
  async function executeAction(sessionId: string, action: PanelAction): Promise<ActResult> {
    try {
      const blocked = preflightGate(sessionId, action)
      if (blocked) return blocked

      switch (action.type) {
        case 'toggle': {
          flags[sessionId] = { enabled: action.enabled, updatedAt: now() }
          persistFlags()
          return accept(sessionId, [
            action.enabled
              ? '自动团队已启用：队长可以拆解目标并派发成员'
              : '自动团队已停用：不会派发任何成员（已创建的成员不会被中断）',
          ])
        }

        case 'pause': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话没有可暂停的运行', sessionId)
          const current = state.plan.status
          if (current === 'terminated' || current === 'cancelled') {
            return reject('BAD_REQUEST', `计划已结束（${current}），无法暂停`, sessionId)
          }
          // 幂等：重复点「暂停」不改 `pause.at`（否则面板会显示「刚暂停」而实际已冻结很久）。
          if (current === 'paused' && state.pause !== undefined) {
            return accept(sessionId, ['任务已处于暂停状态'])
          }
          // 只冻结「可推进」的两个状态：ready（还没起人）/ running（成员在跑，**不中断成员**，
          // 只把任务状态改成 paused；成员的下一次回执照常会被闸门拒，恢复后由下一 tick 补推进）。
          const frozen: Record<string, TaskStatus> = {}
          const tasks = state.plan.tasks.map((task) => {
            if (task.status !== 'running' && task.status !== 'ready') return task
            frozen[task.id] = task.status
            return { ...task, status: 'paused' as const }
          })
          // `planStatus` 记「暂停前是什么」：terminated/cancelled 已在上方拒绝，所以只会是
          // draft / dispatching；若磁盘上是「status=paused 但没有 pause 记录」的旧账，
          // 回落 dispatching —— 否则 resumeTeam 会把计划还原成 paused，永远出不来。
          const preStatus: RunState['plan']['status'] = current === 'paused' ? 'dispatching' : current
          const at = now()
          const next = withMessage(
            {
              ...state,
              plan: { ...state.plan, status: 'paused', tasks },
              pause: { at, planStatus: preStatus, tasks: frozen },
            },
            recordOf({
              from: 'captain',
              to: 'user',
              at,
              body: `已暂停本次运行：冻结 ${Object.keys(frozen).length} 个任务（在跑的成员不会被中断，门禁/恢复/派发暂停受理）`,
            }),
          )
          saveState(next)
          return accept(sessionId, [
            `已暂停：${Object.keys(frozen).length} 个任务被冻结，计划状态 ${preStatus} → paused`,
          ])
        }

        case 'resumeTeam': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话没有可继续的运行', sessionId)
          const current = state.plan.status
          if (current === 'terminated' || current === 'cancelled') {
            return reject('BAD_REQUEST', `计划已结束（${current}），无法继续`, sessionId)
          }
          // 幂等：没暂停就点「继续」不是错误，但也不该写盘（否则 pause 记录会凭空消失/重建）。
          if (state.pause === undefined && current !== 'paused') {
            return accept(sessionId, ['当前没有暂停的任务：无需继续'])
          }
          const restore = state.pause?.tasks ?? {}
          let restored = 0
          const tasks = state.plan.tasks.map((task) => {
            if (task.status !== 'paused') return task // done/failed/interrupted/gate 一律不动：done 永不回退
            const target = restore[task.id]
            // 原状态缺失（旧账/被 normalizePause 丢掉）→ ready：让下一轮 dispatch 自然重新起人，
            // 而不是猜成 running（猜 running 会让面板永远显示一个不存在的成员在跑）。
            const status: TaskStatus = target === undefined || target === 'paused' || target === 'done' ? 'ready' : target
            restored += 1
            return { ...task, status }
          })
          const planStatus = state.pause?.planStatus ?? 'dispatching'
          const backTo: RunState['plan']['status'] =
            planStatus === 'draft' || planStatus === 'dispatching' ? planStatus : 'dispatching'
          const at = now()
          const { pause: _dropped, ...rest } = state
          const next = withMessage(
            { ...rest, plan: { ...state.plan, status: backTo, tasks } },
            recordOf({
              from: 'captain',
              to: 'user',
              at,
              body: `已继续：${restored} 个任务按暂停前的原状态还原，计划状态 paused → ${backTo}`,
            }),
          )
          saveState(next)
          return accept(sessionId, [`已继续：${restored} 个任务已还原`, `计划状态 paused → ${backTo}`])
        }

        case 'dispatch': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划：先让队长拆解目标（auto_team_plan）', sessionId)
          if (action.runId !== undefined && action.runId !== state.plan.runId) {
            return reject('NOT_FOUND', `找不到运行 ${action.runId}（当前会话最新运行是 ${state.plan.runId}）`, sessionId)
          }
          const status = state.plan.status
          // r7：`paused` 已由入口的 PAUSED 闸门拦掉，这里只留两个可派发状态 ——
          // 两处都收窄是刻意的（bridge 一处、dispatchReady 一处）：任何一条推进路径绕开都不会起人。
          if (status !== 'draft' && status !== 'dispatching') {
            return reject('NO_PLAN', `计划状态为 ${status}，不能派发（需要 draft/dispatching）`, sessionId)
          }

          const boundIds = new Set(
            state.bindings.filter((binding) => binding.retired !== true).map((binding) => binding.taskId),
          )
          const ready = readyTasks(state.plan.tasks)
          const unbound = ready.filter((taskId) => !boundIds.has(taskId))
          if (status === 'dispatching' && unbound.length === 0) {
            return reject(
              'PLAN_ALREADY_DISPATCHED',
              '计划已派发：成员已在运行，不会重复起人（中断的成员请用「继续」恢复）',
              sessionId,
            )
          }

          const outcome = await deps.dispatch(state)
          const notices: string[] = []
          // 消歧提示排在「已创建 N 个成员」之后、跳过/失败之前（TECHNICAL §2.4 的 notice 顺序）：
          // 改名是「这条被创建了、只是名字不同」的补充说明，先读创建再看异常。
          for (const rename of outcome.renamed ?? []) {
            const title = state.plan.tasks.find((task) => task.id === rename.taskId)?.title
            notices.push(
              `任务「${title ?? rename.taskId}」(${rename.taskId}) 的成员名 ${rename.base} 已被占用，已改用 ${rename.final} 派发`,
            )
          }
          for (const skipped of outcome.skipped) {
            notices.push(`${skipped.taskId} 跳过：${skipText(skipped.reason)}`)
          }
          for (const error of outcome.errors) {
            notices.push(`${error.taskId} 失败：${error.error}`)
          }
          if (outcome.started.length > 0) {
            notices.unshift(`已创建 ${outcome.started.length} 个成员：${outcome.started.join('、')}`)
          } else if (outcome.skipped.length === 0 && outcome.errors.length === 0) {
            const blocked = blockedTasks(state.plan.tasks)
            notices.push(
              blocked.length > 0
                ? `没有可派发的任务：${blocked.map((item) => `${item.id} 等待 ${item.waitingOn.join('、')}`).join('；')}`
                : '没有可派发的任务：全部已完成',
            )
          }

          // 业务拒绝码只从编排层的 skipped 分类里取（不猜）：全部跳过且原因唯一时才升格为 rejected。
          const skipCodes = uniqueCodes(outcome.skipped.map((skipped) => skipped.reason))
          if (outcome.started.length === 0 && outcome.errors.length === 0 && skipCodes.length === 1) {
            const code = skipCodes[0]
            return reject(code, skipText(code), sessionId, notices)
          }
          if (outcome.started.length === 0 && outcome.errors.length > 0 && skipCodes.length === 0) {
            const first = outcome.errors[0]
            return reject(first.code ?? 'BAD_REQUEST', first.error, sessionId, notices)
          }
          return accept(sessionId, notices)
        }

        case 'cancel': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话没有进行中的运行', sessionId)
          if (state.plan.status === 'cancelled') return accept(sessionId, ['本次运行已取消'])
          saveState({ ...state, plan: { ...state.plan, status: 'cancelled' } })
          return accept(sessionId, ['已取消本次运行：不会再有新的派发（已创建的成员仍可对话）'])
        }

        /**
         * 强制并行（r13 AC-11，不可逆 → 必过确认闸）。
         *
         * 只做两件事：记下**持久授权**（`forceParallel` 落盘，重启后仍有效）、把在等写域的任务
         * 放回 `ready` 并清掉等待文案。真正的准入仍由下一次 `dispatchReady` 判定 ——
         * 这里绝不能自己起人，否则就出现第二条派发路径（绕过并发/依赖/暂停四道闸）。
         */
        case 'forceParallel': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划', sessionId)
          const task = state.plan.tasks.find((item) => item.id === action.taskId)
          if (!task) return reject('NOT_FOUND', `找不到任务 ${action.taskId}`, sessionId)
          const ids = state.forceParallel ?? []
          const authorized = ids.includes(task.id) ? ids : [...ids, task.id]
          const wasWaiting = (task.waitingOn ?? []).length > 0
          saveState(
            withTask({ ...state, forceParallel: authorized }, task.id, (item) => {
              const { waitingOn: _waiting, waitReason: _reason, ...rest } = item
              return { ...rest, status: 'ready' as const }
            }),
          )
          return accept(sessionId, [
            wasWaiting
              ? `任务 ${task.id} 已强制并行：不再等待写域释放，下一次派发放行`
              : `任务 ${task.id} 已记录强制并行（当前未在等待写域，后续冲突时直接放行）`,
          ])
        }

        case 'setTaskRole': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划', sessionId)
          const task = state.plan.tasks.find((item) => item.id === action.taskId)
          if (!task) return reject('NOT_FOUND', `找不到任务 ${action.taskId}`, sessionId)
          const role = deps.roles.get(action.roleId)
          if (!role) return reject('NOT_FOUND', `找不到角色 ${action.roleId}`, sessionId)
          if (bindingFor(state, action.taskId) || task.status === 'running' || task.status === 'gate') {
            return reject('BAD_REQUEST', `任务 ${action.taskId} 已派发，不能替换角色（先取消本次运行）`, sessionId)
          }
          saveState(withTask(state, action.taskId, (item) => ({ ...item, roleId: role.id })))
          return accept(sessionId, [`任务 ${action.taskId} 的角色已改为 ${role.name}（${role.id}）`])
        }

        /**
         * 单任务取消（r11 AC-26）。
         *
         * 允许集只从 `shared/task-actions.ts` 派生（桥里不写第二份 13×3 表）：面板的 disabled
         * 矩阵与这里的拒绝必须是同一份来源，否则第一次改允许集就会分叉。
         *
         * 副作用顺序是刻意的：**先落状态**（cancelled 是权威），再尽力中断成员，最后
         * `releaseScopes` 唤醒等它写域的成员 —— 中断失败不能让「取消」这个动作失败。
         */
        case 'cancelTask': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划：没有可取消的任务', sessionId)
          const task = state.plan.tasks.find((item) => item.id === action.taskId)
          if (!task) return reject('NOT_FOUND', `找不到任务 ${action.taskId}`, sessionId)
          if (!taskActionAllowed('cancel', task.status)) {
            return reject('BAD_REQUEST', taskActionDeniedText(task, 'cancel'), sessionId)
          }

          const at = now()
          // `reason` 是面板可选的补充说明（AC-25）：折进第一条 notice，账本里就能查到「为什么取消」。
          const reason = typeof action.reason === 'string' ? action.reason.trim() : ''
          const notices: string[] = [
            `任务 ${task.id} 已取消（${TASK_STATUS_LABELS[task.status]} → ${TASK_STATUS_LABELS.cancelled}）${reason === '' ? '' : `：${reason}`}`,
          ]
          if (task.status === 'running') {
            const binding = bindingFor(state, task.id)
            const memberName = binding?.name ?? binding?.memberId
            const interrupt = deps.interruptMember
            if (typeof interrupt === 'function' && memberName !== undefined) {
              const stopped = await interrupt(memberName)
              notices.push(
                stopped.ok
                  ? `已中断成员 ${memberName}`
                  : `成员 ${memberName} 中断失败：${stopped.error ?? '未知原因'}（任务状态已取消，成员由 watcher 对账）`,
              )
            }
          }

          const downstream = downstreamOf(state, task.id)
          let next = withTask(state, task.id, (item) => {
            const { waitingOn: _waiting, waitReason: _reason, ...rest } = item
            return { ...rest, status: 'cancelled' as const }
          })
          for (const child of downstream) {
            next = withTask(next, child.id, (item) => ({
              ...item,
              status: 'blocked' as const,
              waitingOn: [task.id],
              waitReason: `上游 ${task.id} 已取消`,
            }))
          }
          if (downstream.length > 0) {
            notices.push(`下游 ${downstream.map((child) => child.id).join('、')} 转为阻塞（上游 ${task.id} 已取消）`)
          }

          next = releaseScopes(next, task.id, at)
          // 任务进入终态（cancelled）→ cause 用 `task-terminal`：自动派发据此知道「有人腾了位置」。
          saveState(withMessage(next, recordOf({ from: 'captain', to: 'user', at, body: notices.join('；') })), 'task-terminal')
          return accept(sessionId, notices)
        }

        /**
         * 单任务跳过（r11 AC-26）：`skipped` 在依赖语义里**视为满足**（`graph.depSatisfied` 单点），
         * 所以这里只需要把「本任务解锁后全部依赖都满足」的下游 blocked 放回 pending。
         *
         * 仍被别的依赖挡住的子任务**原样不动**：它的 waitingOn/waitReason 由下一次回执的解锁
         * 分支重算，桥里再算一遍就会写出第二份依赖文案。
         */
        case 'skipTask': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划：没有可跳过的任务', sessionId)
          const task = state.plan.tasks.find((item) => item.id === action.taskId)
          if (!task) return reject('NOT_FOUND', `找不到任务 ${action.taskId}`, sessionId)
          if (!taskActionAllowed('skip', task.status)) {
            return reject('BAD_REQUEST', taskActionDeniedText(task, 'skip'), sessionId)
          }

          const at = now()
          let next = withTask(state, task.id, (item) => {
            const { waitingOn: _waiting, waitReason: _reason, ...rest } = item
            return { ...rest, status: 'skipped' as const }
          })
          const released: string[] = []
          for (const child of next.plan.tasks) {
            if (child.status !== 'blocked' || !child.dependsOn.includes(task.id)) continue
            const statusById = new Map(next.plan.tasks.map((item) => [item.id, item.status]))
            const unsatisfied = child.dependsOn.filter((dep) => !depSatisfied(statusById.get(dep) ?? 'pending'))
            if (unsatisfied.length > 0) continue
            released.push(child.id)
            next = withTask(next, child.id, (item) => {
              const { waitingOn: _waiting, waitReason: _reason, ...rest } = item
              return { ...rest, status: 'pending' as const }
            })
          }

          next = releaseScopes(next, task.id, at)
          const notices = [`任务 ${task.id} 已跳过（${TASK_STATUS_LABELS[task.status]} → ${TASK_STATUS_LABELS.skipped}）`]
          if (released.length > 0) notices.push(`下游 ${released.join('、')} 解除阻塞（依赖视为满足）`)
          // skipped 同样是终态（依赖语义里视为满足）→ `task-terminal`。
          saveState(
            withMessage(next, recordOf({ from: 'captain', to: 'user', at, body: notices.join('；') })),
            'task-terminal',
          )
          return accept(sessionId, notices)
        }

        /**
         * 改验收命令（r11 AC-26；r13 取代：允许面扩到 `done`）：空串拒绝并返回三条模板全文
         * （`emptyAcceptanceError` 单点生成，与工具入口 `tools.ts` 的整批拒绝是同一份文案）。
         *
         * 非 `done` 状态只改 `acceptance`：已落盘的 `evidence` 一字不动 —— 那是「上次门禁跑的是什么」
         * 的历史事实。`done` 改验收会改变「完成」的含义，所以**当场重跑门禁**：通过则保持 `done`
         * 并刷新证据，失败转 `rework`。状态写回仍走 `deps.applyReceipt`（done/rework 的唯一写点），
         * 不在这里长出第二条状态机路径。
         */
        case 'updateAcceptance': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划：没有可改验收的任务', sessionId)
          const task = state.plan.tasks.find((item) => item.id === action.taskId)
          if (!task) return reject('NOT_FOUND', `找不到任务 ${action.taskId}`, sessionId)
          if (!taskActionAllowed('edit-acceptance', task.status)) {
            return reject('BAD_REQUEST', taskActionDeniedText(task, 'edit-acceptance'), sessionId)
          }
          const acceptance = action.acceptance.trim()
          if (acceptance === '') {
            return reject('BAD_REQUEST', emptyAcceptanceError([{ id: task.id, title: task.title }]), sessionId)
          }

          const nextState = withTask(state, task.id, (item) => ({ ...item, acceptance }))
          if (task.status !== 'done') {
            saveState(nextState)
            return accept(sessionId, [
              `任务 ${task.id} 的验收命令已更新（当前状态：${TASK_STATUS_LABELS[task.status]}）`,
            ])
          }

          // `done` 的重跑：门禁期间任务保持终态（不写 gate）—— 它没有被「重开」，只是证据需要重新成立，
          // 这样自动派发不会把下游重新排一遍；结论仍由 applyReceipt 一次落定。
          const settings = settingsOf()
          const gateTask = nextState.plan.tasks.find((item) => item.id === task.id) ?? task
          let outcome: { ok: boolean; evidence: GateEvidence }
          try {
            outcome = await enqueueGate(() =>
              Promise.resolve(
                runGate(gateTask, {
                  cwd: deps.gate.cwd,
                  artifactsDir: deps.gate.artifactsDir,
                  timeoutMs: deps.gate.timeoutMs ?? settings.gateTimeoutMs,
                  now,
                }),
              ),
            )
          } catch (error) {
            // 队列满等：nextState 未落盘，任务仍是 done、验收仍是旧值，不产生半截状态。
            return reject(
              'BAD_REQUEST',
              `门禁重跑失败：${error instanceof Error ? error.message : String(error)}`,
              sessionId,
            )
          }

          const passed = outcome.ok
          const next = deps.applyReceipt(
            nextState,
            task.id,
            {
              verdict: passed ? 'done' : 'rework',
              note: '已完成的任务改验收后重跑门禁',
              evidence: outcome.evidence,
            },
            now(),
            settings.maxAttempts,
          )
          saveState(next, 'task-terminal')
          return accept(sessionId, [
            passed
              ? `门禁重跑通过（退出码 ${outcome.evidence.exitCode}）：任务 ${task.id} 保持已完成，证据已更新`
              : `门禁重跑未通过（退出码 ${outcome.evidence.exitCode}）：任务 ${task.id} 转返工`,
            `验收命令：${acceptance}`,
          ])
        }

        case 'message': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划：没有可对话的成员', sessionId)
          const text = (action.text ?? '').trim()
          if (text === '') return reject('BAD_REQUEST', '消息内容不能为空', sessionId)
          const binding = bindingFor(state, action.taskId)
          const memberId = action.memberId ?? binding?.memberId
          if (memberId === undefined) {
            return reject(
              'NOT_FOUND',
              action.taskId !== undefined ? `任务 ${action.taskId} 还没有成员` : '缺少 memberId 或 taskId',
              sessionId,
            )
          }
          const sent = await deps.sendMessage(memberId, text)
          if (!sent.ok) {
            return reject(sent.code ?? 'NOT_FOUND', sent.error ?? '直达消息发送失败', sessionId)
          }
          const next = withMessage(
            state,
            recordOf({
              from: 'captain',
              to: binding?.name ?? memberId,
              toMemberId: memberId,
              taskId: binding?.taskId ?? action.taskId,
              body: text,
              at: now(),
            }),
          )
          saveState(next)
          return accept(sessionId, [`已发送给 ${binding?.name ?? memberId}`])
        }

        case 'resume': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话没有可恢复的运行', sessionId)
          if (action.taskId !== undefined && !state.plan.tasks.some((task) => task.id === action.taskId)) {
            return reject('NOT_FOUND', `找不到任务 ${action.taskId}`, sessionId)
          }
          const outcome = await deps.resume(state)
          const notices: string[] = []
          if (outcome.resumed > 0) notices.push(`已恢复 ${outcome.resumed} 个成员`)
          if (outcome.unchanged) {
            // `unchanged` 同时覆盖两种情况（resumeRun 只回这三个计数，不区分原因）：
            // ① 3 秒去抖窗口内的重复点击；② 成员已不在、任务已被标成「已中断」（不会自动新建）。
            // 文案必须两种都说得通 —— 否则首次点击就会被告知「刚刚恢复过」，而它其实一次都没恢复。
            notices.push(
              '本次没有恢复任何成员：刚恢复过的 3 秒内不重复发送；成员已不在的任务标为「已中断」（不会自动新建，需重新派发）',
            )
          } else if (outcome.resumed === 0) {
            notices.push('没有可恢复的成员（已完成的不重跑；成员已不在的标为「已中断」，不会自动新建）')
          }
          return accept(sessionId, notices)
        }

        case 'receipt': {
          const state = loadState(sessionId)
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划', sessionId)
          const task = state.plan.tasks.find((item) => item.id === action.taskId)
          if (!task) return reject('NOT_FOUND', `找不到任务 ${action.taskId}`, sessionId)
          if (task.status === 'done') return accept(sessionId, [`任务 ${action.taskId} 已完成，不重复跑门禁`])

          const empty = task.acceptance.trim() === ''
          // settings 一次读：门禁超时与返工上限来自同一次读（否则一次回执会用到两个版本的设置）。
          const settings = settingsOf()
          const gateState = withTask(state, action.taskId, (item) => ({ ...item, status: 'gate' }))
          saveState(gateState)

          let outcome: { ok: boolean; evidence: GateEvidence }
          try {
            // `Promise.resolve` 让门禁既接受异步 GateExec（TECH §5.3 的 v2）也接受同步实现：
            // 队列里排的永远是 Promise，同步实现不会阻塞其他回执的排队语义。
            outcome = await enqueueGate(() =>
              Promise.resolve(
                runGate(task, {
                  cwd: deps.gate.cwd,
                  artifactsDir: deps.gate.artifactsDir,
                  // AC-13 生效点：装配层显式注入优先（测试要定值），否则取 settings.gateTimeoutMs。
                  timeoutMs: deps.gate.timeoutMs ?? settings.gateTimeoutMs,
                  now,
                }),
              ),
            )
          } catch (error) {
            // 队列满等：任务回到原状态，避免卡在 gate 上永远不动。
            saveState(withTask(gateState, action.taskId, (item) => ({ ...item, status: task.status })))
            return reject(
              'BAD_REQUEST',
              `门禁执行失败：${error instanceof Error ? error.message : String(error)}`,
              sessionId,
            )
          }

          const evidence = outcome.evidence
          if (!outcome.ok && empty) {
            const reverted = withTask(gateState, action.taskId, (item) => ({ ...item, status: task.status }))
            saveState(reverted)
            return reject(GATE_FAILED, '该任务没有验收命令，需要人工确认后放行', sessionId, [
              `门禁未执行：${action.taskId} 的 acceptance 为空（退出码 ${evidence.exitCode}）`,
            ])
          }

          const verdict: ReceiptInput['verdict'] = outcome.ok ? 'done' : 'rework'
          let next = deps.applyReceipt(
            gateState,
            action.taskId,
            { verdict, note: action.note, evidence },
            now(),
            // AC-13 生效点：返工上限可配（缺省 = config.MAX_ATTEMPTS，值不变）。
            settings.maxAttempts,
          )
          const notices: string[] = [
            outcome.ok
              ? `门禁通过（退出码 ${evidence.exitCode}）：${action.taskId} 已完成`
              : `门禁未通过（退出码 ${evidence.exitCode}）：${action.taskId} 转返工`,
          ]

          if (verdict === 'rework') {
            const binding = bindingFor(next, action.taskId)
            if (binding) {
              const text = `门禁未通过（退出码 ${evidence.exitCode}）：请按以下证据返工\n${evidence.tail}`
              const sent = await deps.sendMessage(binding.memberId, text)
              if (!sent.ok) {
                notices.push(`证据回发失败：${sent.error ?? '未知原因'}`)
              }
              // applyReceipt 若已记账则不重复写（消息账本只允许一条同文记录）。
              if (next.messages.length === gateState.messages.length) {
                next = withMessage(
                  next,
                  recordOf({
                    from: 'captain',
                    to: binding.name,
                    toMemberId: binding.memberId,
                    taskId: action.taskId,
                    body: text,
                    at: now(),
                  }),
                )
              }
            } else {
              notices.push('该任务没有成员：证据只落在面板与日志里')
            }
          }

          // 直通投递实发（AC-4(a)）：放在 applyReceipt 之后、saveState 之前，失败不影响落账。
          notices.push(...(await deliverPeerHandoffs(gateState, next)))

          const updated = next.plan.tasks.find((item) => item.id === action.taskId)
          if (updated?.status === 'failed') {
            notices.push(`任务 ${action.taskId} 已返工 ${attemptsOf(updated)} 次仍未通过，转人工处理`)
          }
          // receipt 是本任务的状态机出口（done / rework / failed）→ `task-terminal`，
          // 下游被解锁后自动派发应立即补位（不必等 3s tick）。
          saveState(next, 'task-terminal')
          return accept(sessionId, notices)
        }

        case 'saveMemory': {
          const track = trackOf(action.track)
          if (!track) return reject('BAD_REQUEST', 'track 必须是 public 或 project', sessionId)
          const name = safeMemoryName(action.name)
          if (name === null) return reject('BAD_REQUEST', '非法文件名：只允许单段名称（字母/数字/._-，自动补 .md）', sessionId)
          const written = writeMemory(track, name, action.body ?? '', deps.memoryRoots)
          if (!written.ok) return reject('BAD_REQUEST', written.error, sessionId)
          return accept(sessionId, [`已保存 ${track}/${written.name}`])
        }

        case 'deleteMemory': {
          const track = trackOf(action.track)
          if (!track) return reject('BAD_REQUEST', 'track 必须是 public 或 project', sessionId)
          const name = safeMemoryName(action.name)
          if (name === null) return reject('BAD_REQUEST', '非法文件名：只允许单段名称（字母/数字/._-，自动补 .md）', sessionId)
          const removed = deleteMemory(track, name, deps.memoryRoots)
          if (!removed.ok) return reject('NOT_FOUND', removed.error, sessionId)
          return accept(sessionId, [`已删除 ${track}/${name}`])
        }

        case 'saveRole': {
          // r10：一次 saveRole 可以同时提交「技能变更 + 角色」（形状零扩张：不新增动作）。
          // 角色形状先做**纯校验**（不落盘），避免「技能写成功、角色因 id 为空被拒」的半截写入。
          const role = action.role
          if (role !== undefined) {
            if (
              typeof role.id !== 'string' ||
              role.id.trim() === '' ||
              typeof role.name !== 'string' ||
              role.name.trim() === ''
            ) {
              return reject('BAD_REQUEST', '角色必须有非空的 id 与 name', sessionId)
            }
          }
          const notices: string[] = []
          if (action.skills !== undefined && action.skills.length > 0) {
            const applied = applySkillMutations(action.skills)
            if (!applied.ok) return reject('BAD_REQUEST', applied.error, sessionId)
            notices.push(...applied.notices)
          }
          if (role !== undefined) {
            const saved = deps.roles.save(role)
            if (!saved.ok) return reject('BAD_REQUEST', saved.error, sessionId)
            notices.push(`已保存角色 ${saved.role.name}（${saved.role.id}）`)
          }
          if (notices.length === 0) return reject('BAD_REQUEST', 'saveRole 需要角色或技能变更', sessionId)
          return accept(sessionId, notices)
        }

        case 'deleteRole': {
          const roleId = typeof action.roleId === 'string' ? action.roleId.trim() : ''
          if (roleId === '') return reject('BAD_REQUEST', 'roleId 不能为空', sessionId)
          if (!deps.roles.get(roleId)) return reject('NOT_FOUND', `找不到角色 ${roleId}`, sessionId)
          const removed = deps.roles.remove(roleId)
          if (!removed.ok) return reject('BAD_REQUEST', removed.error, sessionId)
          return accept(sessionId, [`已删除角色 ${roleId}`])
        }

        case 'restoreDefaultRoles': {
          // AC-8：只重写内置角色（逐字取 BUILTIN_ROLES，含 prompt），自建角色一字不动。
          // `builtin` 标志由 repo 从 BUILTIN_ROLES 推导，不信任磁盘上的 `builtin:true`。
          let outcome: { restored: string[]; kept: string[] }
          try {
            outcome = deps.roles.restoreDefaults()
          } catch (error) {
            return reject(
              'BAD_REQUEST',
              `恢复默认角色失败：${error instanceof Error ? error.message : String(error)}`,
              sessionId,
            )
          }
          // r10 AC-20：一个按钮连带把内置技能恢复出厂（用户改过的内置技能也要回出厂正文），
          // 但**绝不删**用户自建/导入/系统技能，也不动自建角色。
          let restoredSkills: string[] = []
          let skillsNote = ''
          if (deps.skills === undefined) {
            skillsNote = '技能仓储未装配：本次只恢复了角色，内置技能未处理'
          } else {
            try {
              restoredSkills = deps.skills.restoreBuiltins().restored
            } catch (error) {
              skillsNote = `内置技能恢复失败：${error instanceof Error ? error.message : String(error)}`
            }
          }
          const userSkills = (deps.skills?.list() ?? []).filter((skill: { source: string }) => skill.source !== 'builtin').length
          const customRoles = outcome.kept.length
          const userSkillsText = userSkills === 0 ? '没有自建/导入/系统技能' : `你的 ${userSkills} 条自建/导入/系统技能`
          const customRolesText = customRoles === 0 ? '没有自建角色' : `${customRoles} 个自建角色`
          const notices = [
            `已恢复 ${outcome.restored.length} 个内置角色（名称/描述/提示词/技能/模型全部回到内置值）`,
            skillsNote !== ''
              ? skillsNote
              : `已把 ${restoredSkills.length} 条内置技能恢复为出厂正文（已修改标记清除）`,
            `${userSkillsText}与${customRolesText}未受影响`,
          ]
          return accept(sessionId, notices)
        }

        case 'saveSettings': {
          if (deps.settingsRepo === undefined) {
            return reject('BAD_REQUEST', '设置仓储未装配：本次运行无法保存设置', sessionId)
          }
          // 校验与落盘都在 settings.save 一个入口里（先校验后 tmp+rename 原子写）：
          // 非法提交时磁盘一字不改（AC-17），所以这里绝不做「先写再校验」。
          const saved = deps.settingsRepo.save(action.settings)
          if (!saved.ok) return reject('BAD_REQUEST', saved.reason, sessionId)
          // 保存已落盘：回调失败只降级成 notice，不能让面板显示「保存失败」而磁盘其实已经变了。
          let callbackError = ''
          try {
            deps.onSettingsSaved?.(saved.settings)
          } catch (error) {
            callbackError = error instanceof Error ? error.message : String(error)
          }
          const notices = [
            `设置已保存：并发 ${saved.settings.concurrencyLimit}｜记忆预算 ${saved.settings.memoryBudget}｜停滞阈值 ${saved.settings.stallMs}ms｜返工上限 ${saved.settings.maxAttempts}｜门禁超时 ${saved.settings.gateTimeoutMs}ms`,
            `队长模型：${saved.settings.captainModel === undefined ? '跟随会话默认' : `${saved.settings.captainModel.provider}/${saved.settings.captainModel.model}`}`,
          ]
          if (callbackError !== '') notices.push(`设置已落盘，但生效步骤失败：${callbackError}（重启宿主后生效）`)
          return accept(sessionId, notices)
        }

        default: {
          const unknown = action as { type?: string }
          return reject('BAD_REQUEST', `未知面板动作：${unknown.type ?? 'undefined'}`, sessionId)
        }
      }
    } catch (error) {
      return {
        snapshot: snapshot(sessionId),
        rejected: {
          code: 'BAD_REQUEST',
          message: `面板动作失败：${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
  }

  return {
    enabled(sessionId: string): boolean {
      return flags[sessionId]?.enabled === true
    },

    setEnabled(sessionId: string, enabled: boolean): void {
      flags[sessionId] = { enabled, updatedAt: now() }
      persistFlags()
    },

    snapshot,

    act,

    /**
     * r13 AC-21/AC-22：左栏项目库。装配在 `host/library.ts`（带缓存），这里只转派；
     * 未装配时返回空库 —— 空库是「没有数据」，不是「假装没有项目」（PRD 反模式）。
     */
    library(query: { sessionId?: string; runId?: string }) {
      const view = deps.libraryView
      if (typeof view === 'function') return view(query)
      return { projects: [], global: { memories: [] } }
    },

    async readMemoryFile(track: MemoryTrack, name: string, workspace?: string) {
      const safe = safeMemoryName(name)
      if (safe === null) return { error: '非法文件名' }
      const roots = rootsFor(workspace)
      if (roots === null) return { error: `未授权的工作区：${workspace ?? ''}` }
      const exists = listMemory(track, roots).some((file) => file.name === safe)
      if (!exists) return { error: `记忆文件不存在：${track}/${safe}` }
      const body = readMemory(track, safe, roots)
      return { data: { track, name: safe, body, chars: body.length } }
    },

    /**
     * r10 AC-17：技能正文（`GET /memory?track=skill&name=<id>` 的唯一实现）。
     *
     * 正文**按需读**：快照里只放 id/标题/描述，弹层打开时才读一次正文 ——
     * 12 条内置技能正文若全进快照，每次 2s 轮询都会多传几十 KB。
     */
    async readSkillBody(id: string) {
      const repo = deps.skills
      if (repo === undefined) return { error: '技能仓储未装配：无法读取技能正文' }
      const key = typeof id === 'string' ? id.trim() : ''
      if (key === '') return { error: '技能 id 不能为空' }
      const read = repo.readBody(key)
      if (read.error !== undefined) return { error: read.error }
      const record = repo.get(key)
      return { data: { id: key, title: record?.title ?? key, body: read.data, chars: read.data.length } }
    },

    memoryFor(goal: string) {
      const { candidates } = memoryFiles()
      // AC-13 生效点③：队长侧注入预算与面板 `memory.budget` 必须**同源**（都读 settings），
      // 否则面板显示 4000 而成员实际只拿到 200 —— 本项目历史高频 bug 族的形态。
      const selected = selectMemory(goal, candidates, settingsOf().memoryBudget)
      return { text: selected.text, truncated: selected.truncated, chars: selected.chars }
    },

    remember(track: MemoryTrack, name: string, body: string): Result<{ name: string }> {
      const lines = (body ?? '').split('\n').slice(0, MEMORY_LINES_PER_TASK)
      const written = writeMemory(track, name, lines.join('\n'), deps.memoryRoots)
      if (!written.ok) return { error: written.error }
      return { data: { name: written.name } }
    },

    expandMemory(id: string, depth?: number): Result<ExpandPayload> {
      const expander = deps.expander
      // 装配期缺失（宿主没接端口）→ 明确的 error；展开本身的失败（坏 ID / 越权 / 不存在 /
      // 跳数超限）走 data，因为码是结论，工具与模型都要看见（AC-11）。
      if (expander === undefined) {
        return { error: `记忆展开不可用：宿主未装配记忆目录（无法展开 ${id}）` }
      }
      try {
        return { data: expander(id, depth) }
      } catch (error) {
        // createExpander 按契约不抛；真抛了也不能连累工具调用链（AC-9）。
        return { error: `记忆展开失败：${error instanceof Error ? error.message : String(error)}` }
      }
    },
  }
}

interface MemorySnapshotFiles {
  files: PanelSnapshot['memory']['files']
  candidates: Array<{ track: MemoryTrack; name: string; body: string; updatedAt: number }>
}

function trackOf(raw: unknown): MemoryTrack | null {
  return raw === 'public' || raw === 'project' ? raw : null
}

function firstLine(text: string): string {
  const line = (text ?? '').split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

function attemptsOf(task: { attempts?: number }): number {
  return typeof task.attempts === 'number' ? task.attempts : 0
}

function routeText(route: { provider: string; model: string; reasoningEffort?: string } | null | undefined): string {
  if (!route) return '未声明'
  const effort = route.reasoningEffort ? ` #${route.reasoningEffort}` : ''
  return `${route.provider}/${route.model}${effort}`
}

/** 编排层 skipped 的原因串 → 拒绝码（只认码表里的 10 个，其余当提示）。 */
function asRejectionCode(raw: string): RejectionCode | null {
  switch (raw) {
    case 'NOT_ENABLED':
    case 'NO_PLAN':
    case 'PLAN_ALREADY_DISPATCHED':
    case 'ROLE_UNAVAILABLE':
    case 'MODEL_UNRESOLVABLE':
    case 'ROUTE_DRIFT':
    case 'CONCURRENCY_FULL':
    case 'NOT_FOUND':
    case 'NO_CALLER':
    case 'BAD_REQUEST':
      return raw
    default:
      return null
  }
}

function uniqueCodes(raws: string[]): RejectionCode[] {
  const codes: RejectionCode[] = []
  for (const raw of raws) {
    const code = asRejectionCode(raw)
    if (code !== null && !codes.includes(code)) codes.push(code)
  }
  return codes
}

function skipText(reason: string): string {
  switch (reason) {
    case 'CONCURRENCY_FULL':
      return '并发已满，等运行中的任务结束再派发'
    case 'ROLE_UNAVAILABLE':
      return '角色不存在：先在角色页创建该角色（不会猜一个角色顶上）'
    case 'MODEL_UNRESOLVABLE':
      return '角色指定的模型不可用：先修正 provider/model（不会静默回退到队长模型）'
    case 'ROUTE_DRIFT':
      return '实际模型与角色声明不一致：请核对模型路由'
    case 'ALREADY_RUNNING':
      return '成员已在运行（幂等，不重复起人）'
    default:
      return reason
  }
}

/** 角色模型路由的逐字展示（AC-22：不许省略、不许改写成别名）。 */
export function describeRoute(role: Role | undefined): string {
  if (!role?.model) return '会话默认'
  const effort = role.model.reasoningEffort ? ` #${role.model.reasoningEffort}` : ''
  return `${role.model.provider}/${role.model.model}${effort}`
}

/**
 * 任务状态 / 宿主成员状态 → 面板 7 态（**唯一映射表**，watcher 复用，组件里禁止再写一份）。
 * 宿主 4 态：running / inactive / provisioning / failed。
 */
export function toMemberStatus(status: string): MemberStatus {
  switch (status) {
    case 'running':
    case 'gate':
      return 'running'
    case 'idle':
    case 'provisioning':
      return 'idle'
    case 'blocked':
      return 'blocked'
    case 'rework':
      return 'rework'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    case 'inactive':
    case 'interrupted':
      return 'interrupted'
    default:
      return 'idle'
  }
}

export { progressOf }
