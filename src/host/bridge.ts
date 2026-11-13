/**
 * 面板桥的领域层：把「面板要看的」与「面板能做的」收敛成一个快照方法 + 一个动作方法，
 * 与传输方式（HTTP / 工具调用）无关 —— 传输由 host/http.ts 与 adapters.ts 负责。
 *
 * 两条入口共用本文件（AC 高频缺陷「工具能用、面板不能用」的唯一防线）：
 *   - HTTP：POST /api/auto-team/act  →  bridge.act
 *   - 工具：auto_team_message / auto_team_receipt / auto_team_memory / auto_team_role → 同一个 bridge.act
 *
 * 20 个动作与拒绝码对照（TECHNICAL §4.2 / §5.x；r7 新增 4 个动作与 PAUSED 码，
 * r11 新增 cancelTask / skipTask / updateAcceptance 三个单任务动作，
 * r24 新增 closeRun 与「残留计划自动对账」）：
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
 *   closeRun             → NOT_FOUND（不存在/不属于当前会话）/ BAD_REQUEST（仍有存活成员或名单不可读）；
 *                          目标已是终态 → `unchanged`（幂等，不报错）
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
  MemoryEntryView,
  MemoryFileView,
  MemoryQuotaView,
  MemoryTopicId,
  MemoryTrack,
  MessageRecord,
  ModelCatalogView,
  PanelAction,
  PanelSnapshot,
  PanelTaskView,
  Plan,
  PlanTask,
  RejectionCode,
  Result,
  Role,
  RunStageCounts,
  RunSummary,
  SkillDraft,
  SkillInfo,
  SkillMutation,
  StallReason,
  TaskStatus,
  TokenTotals,
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
  ENTRIES_PER_FILE,
  MAX_CONCURRENT_LIMIT,
  MEMORY_LINES_PER_TASK,
  STALL_MS,
} from './config.ts'
import { runGate } from './gate/gate.ts'
import { durationCellOf, taskDurationCellOf, usageCellOf } from './format.ts'
import type { AutoDispatchCause } from './team/auto-dispatch.ts'
import { autoEntryDraftsOf } from './memory/auto.ts'
import { curateMemory } from './memory/curate.ts'
import {
  applyMemoryMutation,
  entryViewOf,
  parseEntryFile,
  type EntryDraft,
  type MemoryMutationCode,
  type ParsedEntry,
} from './memory/entries.ts'
import { selectMemoryEntries } from './memory/inject.ts'
import { memoryLocationOf, usableWorkspaceOf } from './memory/locate.ts'
import type { MemoryLocation } from './memory/locate.ts'
import {
  deleteMemory,
  isLegacyMemoryFile,
  listMemory,
  listMemoryViews,
  quotaOf,
  readMemory,
  readMemoryEntries,
  safeMemoryName,
  writeMemory,
  writeMemoryFile,
} from './memory/repo.ts'
import type { MemoryRoots } from './memory/repo.ts'
import { normalizeWorkspace, projectArtifactsDir, projectMemoryDir } from './paths.ts'
import { emptyAcceptanceError } from './plan/acceptance.ts'
import { blockedTasks, depSatisfied, readyTasks } from './plan/graph.ts'
import { progressOf, revisePlan, type RevisionInput, type RevisionResult } from './plan/plan.ts'
import { deriveScopeLocks } from './plan/scope.ts'
import { BUILTIN_SKILLS } from './roles/builtin.ts'
import type { RoleRepo } from './roles/repo.ts'
import type { SkillRecord, SkillRepo } from './roles/skills-repo.ts'
import type { SystemSkillSource } from './roles/system-skills.ts'
import { defaultSettings, type SettingsRepo } from './settings.ts'
import {
  advancePlanToDispatching,
  cancelResidualTasks,
  finishedAtOf,
  MESSAGES_LIMIT,
  reconcileStalePlans,
  repairClosedRuns,
  type RunState,
  type RunsStore,
} from './store.ts'
import type { DeviationRecorder } from './team/deviation.ts'
import { isTerminalTaskStatus } from './team/dispatch.ts'
import { normalizeHostStatus, type HostMember } from './team/watcher.ts'
import { panelTaskViewOf } from './team/silent-finish.ts'
import { isIrreversibleAction, pendingFor, pendingViewOf } from './team/confirm.ts'
import { applyProjectionUsage, runUsageOf, taskUsageOf, type ProjectionUsageEntry } from './team/usage.ts'
import { releaseScopes } from './team/scope-locks.ts'
import { secondsText, stallNoteOf, stallOf } from './team/stall.ts'


/** 门禁串行队列上限（TECHNICAL §5.3：避免一次 receipt 风暴炸出多个 shell）。 */
const GATE_QUEUE_LIMIT = 8

/** 活动流最多保留的条数（面板只显示最近 50 条，避免快照无限膨胀）。 */
const ACTIVITY_LIMIT = 50

/** peer 交接消息的 messageId 前缀（`handoff:<上游>-><下游>`，AC-5 的幂等键，由 team/handoff.ts 生成）。 */
const HANDOFF_MESSAGE_PREFIX = 'handoff:'

/** 历史行没有用量记录时 `UsageCell.reason` 的统一文案（与 library 的项目 run 行同一口径）。 */
const HISTORY_USAGE_REASON = '宿主未上报本 run 的用量'

/** 回执：门禁判定结果（done 的唯一写点在 team/dispatch.ts 的 applyReceipt）。 */
export interface ReceiptInput {
  verdict: 'done' | 'rework' | 'failed'
  note?: string
  evidence?: GateEvidence
}

/**
 * r21：需求修订的成员副作用结果。
 *
 * 四个列表分开而不是合成一句：`stopped`/`notified` 是「已经发生的事实」，
 * `stopFailed`/`notifyFailed` 是「没做到、面板要如实显示」的部分 —— 合并就分不清了。
 */
export interface RevisionMemberOutcome {
  /** 已确认停止的成员名（作废任务上的 running 成员）。 */
  stopped: string[]
  /** 停止失败的成员名 → 原因；对应 binding 保持 `stopping: true`（显示「停止中」，绝不显示已停止）。 */
  stopFailed: Array<{ name: string; error: string }>
  /** 已成功收到需求修订直达消息的成员名。 */
  notified: string[]
  /** 直达消息发送失败的成员名 → 原因。 */
  notifyFailed: Array<{ name: string; error: string }>
}

/** `Bridge.revise` 的返回：成功时是修订结果 + 成员副作用，失败时带拒绝码与可读原因。 */
export type ReviseRunResult =
  | ({ ok: true } & RevisionResult & RevisionMemberOutcome)
  | { ok: false; reason: string; code: RejectionCode }

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

/**
 * 派发预检结果（r14 AC-1）。
 *
 * 受理制之后 `auto_team_dispatch` 不再 `await` 整条派发链：它先同步问这里「能不能派」，
 * 得到 `ok` 才把执行交给后台调度器并立刻返回。**判据只有 `admissionOf` 一处**，
 * 面板 `act('dispatch')` 走的是同一个函数，因此工具与面板永远不会给出不同答案
 * （两套判据轮换改漏一个，就是 AC-1 前后两次同源事故的根因）。
 */
export type DispatchAdmission =
  | { ok: true; runId: string; ready: string[]; unbound: string[] }
  | { ok: false; code: RejectionCode; message: string }

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

/** 直达消息端口（adapters 注入：新宿主 subagents.sendMessage 按 SessionId 直发；无 caller 时带 code='NO_CALLER'）。 */
export type SendPort = (
  memberId: string,
  text: string,
) => Promise<{ ok: boolean; error?: string; code?: RejectionCode }>

export interface BridgeDeps {
  store: RunsStore
  roles: RoleRepo
  /**
   * 装配期算出的记忆根（r22 起只作为**兜底**）。
   *
   * `projectDir` 是 apply 时刻的 workspace 派生目录（真实宿主里是 profile 目录），
   * 只在解析不到项目工作区时退化使用，并在快照里带 `degraded/degradeReason`，不得静默。
   */
  memoryRoots: { publicDir: string; projectDir: string }
  /**
   * 会话 → 真实项目工作区（r22 记忆落点的动态解析口）。
   *
   * 装配层注入「会话 cwd（`agents.get(sessionId)`）+ workspace 注册表反查」的组合，
   * **每次读写现算**，不缓存 apply 时刻的 workspace。缺省（单测桩）时项目记忆回退
   * `memoryRoots.projectDir` —— 旧行为不变，但快照会如实标记退化。
   */
  workspaceOf?: (sessionId: string) => string | undefined
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
  /**
   * 门禁执行上下文：cwd 用于跑验收命令，artifactsDir 落全量日志（AC-19）。
   *
   * `workspaceOf` 是本次修复的注入点：装配层用 `agents.get(sessionId)` 拿到**会话工作区**
   * （`agent.session.header.cwd`），门禁按会话取真实仓库根，而不是宿主进程启动目录。
   * 缺省（单测桩 / 旧宿主取不到 session）时保持旧行为：`cwd` + `artifactsDir` 原样使用。
   */
  gate: {
    cwd: string
    artifactsDir: string
    workspaceOf?: (sessionId: string) => string | undefined
    timeoutMs?: number
  }
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
   * 记忆展开端口（AC-9/AC-11）：`createExpander({roots}).expand`。
   *
   * r22：第三参是**本次解析出的记忆根**。装配层必须按它构造 expander
   * （`(id, depth, roots) => createExpander({ roots: roots ?? memoryRoots }).expand(id, depth)`），
   * 否则展开仍读 apply 时刻的目录；旧两参实现仍可注入（单测兼容，忽略第三参）。
   *
   * 依赖用可选注入而不是在这里 `import` 文件系统实现：缺省时 `expandMemory` 明确报「不可用」，
   * 单测可以传一个只返回固定 payload 的桩，不必造临时目录。
   */
  expander?: (id: string, depth: number | undefined, roots: MemoryRoots) => ExpandPayload
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
  onRunChanged?: (sessionId: string, runId: string, cause: AutoDispatchCause) => void
  /**
   * r14 AC-3：后台派发失败通知（内存环，`team/dispatch-notices.ts`）。
   *
   * 可选注入：缺省时活动流里没有这一类条目（不假装有），单测也不必造装配层。
   * 之所以只收 `recent` 而不收整个 store，是因为桥只需要「读」——写入点只有装配层的 onError/onClear。
   */
  dispatchNotices?: { recent(runId: string): ActivityEvent[] }
  /**
   * r17：读某个**成员会话**此刻在宿主会话投影里的累计 token 用量
   * （装配层接 `adapters.readSessionTokenUsage`，宿主 API 不许在 bridge 里出现）。
   *
   * 为什么是可选注入：单测夹具与旧宿主都没有这个读口，缺省时快照照旧只显示已落盘的用量，
   * 没有就「不可得 + 原因」，绝不补 0。
   */
  readSessionUsage?: (sessionId: string) => TokenTotals | undefined
  /**
   * r20：读某个成员会话**自己的**模型调用次数（装配层接 `adapters.readSessionCallCount`）。
   *
   * 为什么与 token 分两个读口：调用次数不在宿主用量投影里（投影只有 token），只能数成员会话
   * 日志里的 `assistant/message`；两者都是「会话可读才有值」，在 `refreshUsage` 里合成同一个
   * `TokenTotals`，落盘后 `byMember` / `byTask` / run `total` 自然都带上次数。
   * 可选注入：旧宿主/单测夹具没有这个读口时，行为与 r19 完全一致。
   */
  readSessionCalls?: (sessionId: string) => number | undefined
  /**
   * r17：用量刷新落盘失败时的告警出口（装配层接 `warn(ctx, …)`）。
   *
   * 落盘失败不能让面板整轮快照失败（fail-open）：这一帧用内存里的新值，盘上保留旧值，
   * 下一帧再试。吞掉异常是禁止的，所以错误从这里出去、进宿主日志。
   */
  onUsagePersistError?: (message: string) => void
  /**
   * r24：宿主成员名单读口（`adapters.listHostMembers`）。`closeRun` 用它确认「没有存活成员」；
   * 缺省 = 只能按落盘 `bindings` + 任务状态保守判断，属于降级路径（单测夹具用）。
   */
  listMembers?: () => Promise<HostMember[]>
  /** r24：非致命告警出口（残留计划对账失败等）。装配层接 `warn(ctx, …)`；缺省即静默。 */
  onWarn?: (message: string) => void
}

export interface Bridge {
  enabled(sessionId: string): boolean
  setEnabled(sessionId: string, enabled: boolean): void
  snapshot(sessionId: string): PanelSnapshot
  act(sessionId: string, action: PanelAction): Promise<ActResult>
  /**
   * r21：把「同一条需求的修改」并入既有 run（显式通道，队长判定后由 auto_team_plan 调用）。
   *
   * 与 `act()` 分开的原因：修订要**先落盘再中断成员**（停止中必须可见），还会发直达消息、
   * 记消息账本；这些是异步副作用，不是一次面板动作。判据（runId 归属、计划终态）在桥里，
   * 纯计划变换在 `plan/plan.ts` 的 `revisePlan`。
   */
  revise(sessionId: string, runId: string, input: RevisionInput): Promise<ReviseRunResult>
  /**
   * r14 AC-1：**同步**派发预检（不碰 spawn、不读门禁、不落盘）。
   *
   * 与 `act('dispatch')` 共用 `admissionOf` 一处判据：未启用 → 无计划 → runId 不匹配 →
   * 暂停 → 计划状态 → 已派发无新人。`ok:false` 的 `code` 就是面板同一动作会拿到的拒绝码。
   */
  precheckDispatch(sessionId: string, runId?: string): DispatchAdmission
  /**
   * r13 AC-21/AC-22：左栏项目库（含 `?runId=` 时的历史详情）。
   *
   * 走的是与 `GET /library` 同一条装配（`BridgeDeps.libraryView`），
   * 因此「右栏看到的 run」与「左栏点开的历史 run」是同一份 `RunDetailView`。
   */
  library(query: { sessionId?: string; runId?: string }): LibraryView
  /**
   * 面板记忆页：先读正文再编辑（否则保存会把已有记忆清空，缺陷 D7）。
   *
   * r22：`workspace` 是 HTTP 显式指定的项目（仍走白名单）；缺省时按 `sessionId`
   * 解析当前会话的项目工作区 —— 面板不带 workspace，读到的必须是**本项目**
   * `<workspace>/.auto-team/memory` 里的正文，而不是装配目录里的同名文件。
   */
  readMemoryFile(
    track: MemoryTrack,
    name: string,
    workspace?: string,
    sessionId?: string,
  ): Promise<
    Result<{
      track: MemoryTrack
      name: string
      body: string
      chars: number
      file: MemoryFileView
      entries: MemoryEntryView[]
    }>
  >
  /**
   * 面板技能编辑弹层：按需读技能正文（r10 AC-17）。
   *
   * 复用 `GET /memory?track=skill` 这条**同一条**正文通道（不新开路由），因此返回形状
   * 与 `readMemoryFile` 同族；`title` 一并带出，弹层标题不必再从 `snapshot.skills` 里反查。
   */
  readSkillBody(id: string): Promise<Result<{ id: string; title: string; body: string; chars: number }>>
  /** 队长侧（工具/提示词）用的记忆注入文本；r22 起按会话解析项目工作区。 */
  memoryFor(goal: string, sessionId?: string): { text: string; truncated: boolean; chars: number }
  /** 队长侧：写入一条记忆（可带 track），按 MEMORY_LINES_PER_TASK 裁剪。 */
  remember(track: MemoryTrack, name: string, body: string, sessionId?: string): Result<{ name: string }>
  /**
   * r23：条目级写入（`auto_team_memory` 的 write 动作唯一入口）。
   *
   * 与 `remember` 的裸行追加不同，这里走 §7 的 upsert/supersede/淘汰/配额整套语义；
   * 全内存完成后才落盘，任一条失败则一条都不写（原子）。
   */
  mutateMemory(
    track: MemoryTrack,
    drafts: readonly EntryDraft[],
    sessionId?: string,
  ): MemoryMutationResult
  /**
   * 按 `mem://<track>/<stem>` 展开记忆原文（AC-9/AC-11）。
   *
   * 成功与失败都包成 `Result`：`code !== 'OK'` 的 payload 也走 `data`，因为**码本身是结论**
   * （`EXPAND_NOT_FOUND` / `EXPAND_PATH_ESCAPE` …），压成一句 `error` 字符串工具层就透不出码了。
   * 只有「端口没装配」这一种装配期缺失才用 `error`（那不是展开语义的一部分）。
   *
   * r22：`sessionId` 决定展开时读哪个项目的记忆根（与列表/注入/读写删同一解析）。
   */
  expandMemory(id: string, depth?: number, sessionId?: string): Result<ExpandPayload>
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

/**
 * r24：已做过残留计划对账的 `dataRoot`（进程级、每个盘只跑一次）。
 *
 * 放在模块级而不是 bridge 实例上：同一进程可能装配多个 bridge（测试夹具 / 多 profile），
 * 但对同一份 runs 目录重复对账没有意义；第二次进来时状态已是 `terminated`，结果也必须一致。
 */
const reconciledDataRoots = new Set<string>()

/** r24：用户手动终止残留计划时落的收口文案（逐字由需求给定）。 */
const CLOSE_RUN_REASON = '用户终止残留计划'

export function createBridge(deps: BridgeDeps): Bridge {
  const now = deps.now ?? (() => Date.now())

  // r24：残留计划自动对账 —— **必须在任何 snapshot/list 读取之前**完成，否则面板会先
  // 看见「还活着」的残留 run。装配期还没有任何成员（createBridge 早于所有 spawn），
  // 所以「本进程无存活成员」这个条件是天然成立的，不需要也不应该去问宿主名单。
  //
  // r25：同一启动窗口里先修历史脏数据（终态 run 里残留的非终态任务），再对账剩余计划；
  // 两步各自 try/catch —— 历史文件坏了不能连带跳过自动收口，更不能让面板读不到数据。
  if (!reconciledDataRoots.has(deps.dataRoot)) {
    reconciledDataRoots.add(deps.dataRoot)
    try {
      const repairedRuns = repairClosedRuns(deps.store, { onWarn: deps.onWarn })
      if (repairedRuns.length > 0) {
        deps.onWarn?.(`自动团队：已修正 ${repairedRuns.length} 个已收口运行的残留任务（${repairedRuns.join('、')}）`)
      }
    } catch (error) {
      deps.onWarn?.(`自动团队：修正已收口运行失败：${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      const reconciledRuns = reconcileStalePlans(deps.store, { now: now() })
      if (reconciledRuns.length > 0) {
        deps.onWarn?.(`自动团队：已自动收口 ${reconciledRuns.length} 个残留计划（${reconciledRuns.join('、')}）`)
      }
    } catch (error) {
      deps.onWarn?.(`自动团队：残留计划对账失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 生效设置（r7 AC-13）：**每次读盘**而不是装配时读一次 —— 用户在设置页改完立刻生效，
   * 不需要重启宿主。读失败（文件损坏/无权限）由 `settingsRepo.read()` 自己回落缺省，这里不再兜。
   */
  function settingsOf(): AutoTeamSettings {
    return deps.settingsRepo === undefined ? defaultSettings() : deps.settingsRepo.read()
  }

  /**
   * 本次门禁要用的执行目录与产物目录（按会话解析）。
   *
   * 判定顺序刻意如此：
   *  1. `workspaceOf(sessionId)` 给得出**非空白**路径 → 它就是会话工作区；产物跟着会话走
   *     （`<workspace>/.auto-team/artifacts`，与项目记忆同根）。
   *  2. 取不到（旧宿主 / 该会话尚无 Agent / 解析抛错）→ 回退装配时的 `cwd`/`artifactsDir`。
   *
   * 解析异常绝不冒泡：门禁失败的原因必须是验收命令本身，而不是「找目录时崩了」。
   */
  function gateContextOf(sessionId: string): { cwd: string; artifactsDir: string } {
    let workspace: string | undefined
    try {
      workspace = deps.gate.workspaceOf?.(sessionId)
    } catch {
      workspace = undefined
    }
    const value = (workspace ?? '').trim()
    if (value === '') return { cwd: deps.gate.cwd, artifactsDir: deps.gate.artifactsDir }
    return { cwd: value, artifactsDir: projectArtifactsDir(value) }
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

  /**
   * 自动记忆沉淀（r23）：run 到终态时把失败证据提炼成**条目**写进 pitfalls/commands。
   *
   * 与 r19 的文件级流水（`run-<id>.md`）相比：
   *  - 不再生成 run 流水文件：失败教训直接成为可注入的 P1 条目，通过的门禁命令成为 P2 条目；
   *  - `state.memorySunkAt` 是幂等键：`saveState` 会被反复调用，没有它同一条教训会被反复
   *    upsert、`修正 N` 一路涨。只有**终态且成功（含 0 条草稿）**才写它；
   *  - 逐条 apply，坏条目跳过；每个文件只在最后写一次（多次 upsert 不产生中间文件）；
   *  - fail-open：记忆失败不得影响 run 落盘与派发；异常不写幂等键，下一次保存重试。
   */
  function recordRunMemory(state: RunState): void {
    if (Number.isFinite(state.memorySunkAt)) return
    const status = state.plan.status
    if (status !== 'terminated' && status !== 'cancelled') return
    try {
      // r22：落点按**这个 run 的真实工作区**现解析（run.project 优先，其次会话 cwd/注册表），
      // 不再用 apply 时刻捕获的装配目录 —— 否则同一进程里两个项目的 run 会把记忆写进同一个
      // profile 目录，项目自己的 `.auto-team/memory` 永远为空。
      const location = memoryLocationFor({
        sessionId: state.plan.sessionId,
        runProject: state.project,
        origin: `run ${state.plan.runId}`,
      })
      if (location === null) return
      const drafts = autoEntryDraftsOf({
        runId: state.plan.runId,
        goal: state.plan.goal,
        status: state.plan.status,
        createdAt: state.plan.createdAt,
        plannedAt: state.plannedAt,
        finishedAt: state.finishedAt,
        project: state.project,
        sessionId: state.plan.sessionId,
        tasks: state.plan.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          attempts: task.attempts,
          evidence:
            task.evidence === undefined
              ? undefined
              : {
                  command: task.evidence.command,
                  exitCode: task.evidence.exitCode,
                  tail: task.evidence.tail,
                },
        })),
      })
      const entriesByTrack: Record<MemoryTrack, ParsedEntry[]> = {
        project: readTrackEntries('project', location.roots),
        public: readTrackEntries('public', location.roots),
      }
      const changed: Record<MemoryTrack, Set<string>> = { project: new Set(), public: new Set() }
      for (const draft of drafts) {
        const outcome = applyMemoryMutation(entriesByTrack[draft.track], draft, { maxPerFile: ENTRIES_PER_FILE })
        if (!outcome.ok) continue
        entriesByTrack[draft.track] = outcome.entries
        for (const file of outcome.changedFiles) changed[draft.track].add(file)
      }
      for (const track of ['project', 'public'] as const) {
        for (const file of changed[track]) {
          const written = writeMemoryFile(track, file, entriesByTrack[track], location.roots)
          // 写失败必须抛出去：吞掉的话幂等键会被写上，这一轮教训就永久丢了。
          if (!written.ok) throw new Error(written.error)
        }
      }
      state.memorySunkAt = Date.now()
    } catch {
      // 刻意空 catch：记忆失败不回传、不落日志噪音，更不能挡住 store.save 与变更通知。
      // 幂等键未写 → 下一次 saveState 会重试（fail-open 的另一半）。
    }
  }

  function saveState(state: RunState, cause: AutoDispatchCause = 'plan-saved'): RunState {
    recordRunMemory(state)
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

  // ---------- r21：需求修订（显式并入） ----------

  /** 一次修订的展示时刻文本（与 plan.ts 的 goal 段落同一时区口径）。 */
  function revisionStampOf(at: number): string {
    const date = new Date(at)
    const pad = (value: number): string => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  /** 修订直达消息正文（模板固定在这里，t2/t3 的断言直接对这段文案）。 */
  function revisionMessageOf(input: {
    runId: string
    at: number
    changeSummary: string
    task: PlanTask
    changed: boolean
    cancelled: boolean
  }): string {
    const { task } = input
    const lines = [
      `【需求修订】run ${input.runId} 于 ${revisionStampOf(input.at)} 并入新需求。`,
      `变更要点：${input.changeSummary}`,
    ]
    if (input.cancelled) {
      lines.push(
        `你所在任务 ${task.id}《${task.title}》已被新需求作废（原因：${task.cancelReason ?? '需求修订'}）。`,
        '请立即停止当前实现，不要再按旧理解提交回执；如需继续，等队长派发新的任务卡。',
      )
    } else if (input.changed) {
      lines.push(
        `你的任务 ${task.id} 已修订：目标=《${task.title}》，验收命令=${task.acceptance}。`,
        '请按修订后的目标与验收继续，完成照常走 auto_team_receipt。',
      )
    } else {
      lines.push(
        `你的任务 ${task.id}《${task.title}》的目标与验收未变；但整体需求已修订，注意依赖任务可能调整。`,
        '完成照常走 auto_team_receipt。',
      )
    }
    return lines.join('\n')
  }

  /**
   * r21：并入需求修订的宿主侧编排。
   *
   * 顺序是刻意的：
   *  1. `revisePlan` 纯校验（失败零写入）；
   *  2. 先把「停止中」与作废任务的下游阻塞落盘 —— 中断是异步的，界面在等待期间必须看到真相；
   *  3. 依次中断作废任务上的 running 成员，失败**保持 stopping=true**（显示停止中）；
   *  4. 给仍在跑的成员发直达消息（修订点 + 自己的任务是否变化），逐条记消息账本；
   *  5. 最后一次性落盘（退役已停止的 binding、消息账本、队长告知）。
   */
  async function reviseRun(sessionId: string, runId: string, input: RevisionInput): Promise<ReviseRunResult> {
    const state = deps.store.load(runId)
    if (state === null) return { ok: false, code: 'NOT_FOUND', reason: `找不到 run ${runId}` }
    if (state.plan.sessionId !== sessionId) {
      return { ok: false, code: 'NOT_FOUND', reason: `run ${runId} 不属于当前会话，拒绝并入` }
    }

    const at = now()
    const revised = revisePlan(state.plan, input, at)
    if (!revised.ok) return { ok: false, code: 'BAD_REQUEST', reason: revised.reason }

    const beforeStatus = new Map(state.plan.tasks.map((task) => [task.id, task.status]))
    const changedIds = new Set(revised.updated.map((task) => task.id))
    const cancelledIds = new Set(revised.cancelled.map((task) => task.id))
    const liveBindings = state.bindings.filter((binding) => binding.retired !== true)
    const toStop = liveBindings.filter((binding) => {
      const before = beforeStatus.get(binding.taskId)
      return cancelledIds.has(binding.taskId) && (before === 'running' || before === 'gate')
    })
    const stopIds = new Set(toStop.map((binding) => binding.taskId))

    // 2) 先把「停止中」落盘；并把作废任务的下游转阻塞（理由写在任务卡上）。
    let next: RunState = {
      ...state,
      plan: revised.plan,
      bindings: state.bindings.map((binding) =>
        binding.retired !== true && stopIds.has(binding.taskId) ? { ...binding, stopping: true } : binding,
      ),
    }
    for (const task of revised.cancelled) {
      for (const child of downstreamOf(state, task.id)) {
        if (child.status === 'running' || child.status === 'gate') continue
        if (child.status === 'done' || child.status === 'cancelled' || child.status === 'skipped') continue
        next = withTask(next, child.id, (item) => ({
          ...item,
          status: 'blocked' as const,
          waitingOn: [task.id],
          waitReason: `上游 ${task.id} 已在需求修订中作废`,
        }))
      }
    }
    saveState(next, 'plan-saved')

    // 3) 尽力停止被作废任务的成员；失败保持 stopping=true，绝不标成已停止。
    const stopped: string[] = []
    const stopFailed: Array<{ name: string; error: string }> = []
    const retired = new Set<string>()
    for (const binding of toStop) {
      const interrupt = deps.interruptMember
      if (typeof interrupt !== 'function') {
        stopFailed.push({ name: binding.name, error: '宿主未装配成员中断端口' })
        continue
      }
      const result = await interrupt(binding.name)
      if (result.ok) {
        stopped.push(binding.name)
        retired.add(binding.memberId)
      } else {
        stopFailed.push({ name: binding.name, error: result.error ?? '未知原因' })
      }
    }

    const changeSummary =
      (input.changeSummary ?? '').trim() ||
      (input.goal ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line !== '') ||
      (revised.revision.cancelledTaskIds.length > 0 ? '部分任务作废' : '任务目标/验收已更新')

    // 4) 直达消息：仍在跑的成员全部通知（修订点 + 自己的任务是否变化）。
    //    已经停止的成员不再发（发送会把它重新拉起来），停止失败的成员发「立即停止」。
    const notified: string[] = []
    const notifyFailed: Array<{ name: string; error: string }> = []
    const messages: MessageRecord[] = []
    const taskById = new Map(revised.plan.tasks.map((task) => [task.id, task]))

    const sendTo = async (binding: (typeof state.bindings)[number], task: PlanTask): Promise<void> => {
      const text = revisionMessageOf({
        runId,
        at,
        changeSummary,
        task,
        changed: changedIds.has(task.id),
        cancelled: cancelledIds.has(task.id),
      })
      const sent = await deps.sendMessage(binding.memberId, text)
      if (sent.ok) {
        notified.push(binding.name)
        messages.push(
          recordOf({
            from: 'captain',
            to: binding.name,
            toMemberId: binding.memberId,
            taskId: task.id,
            body: text,
            at,
          }),
        )
        return
      }
      notifyFailed.push({ name: binding.name, error: sent.error ?? sent.code ?? '直达消息发送失败' })
    }

    for (const binding of next.bindings) {
      if (binding.retired === true || retired.has(binding.memberId)) continue
      const task = taskById.get(binding.taskId)
      if (task === undefined) continue
      const before = beforeStatus.get(task.id) ?? 'pending'
      const stillRunning = before === 'running' || before === 'gate'
      if (cancelledIds.has(task.id)) {
        if (binding.stopping !== true) continue
        await sendTo(binding, task)
        continue
      }
      if (stillRunning) await sendTo(binding, task)
    }

    // 5) 退役已停止的 binding（清掉 stopping），记录队长告知，最后落盘一次。
    let finalState: RunState = {
      ...next,
      bindings: next.bindings.map((binding) => {
        if (!retired.has(binding.memberId)) return binding
        const { stopping: _stopping, ...rest } = binding
        return { ...rest, retired: true, stoppedAt: rest.stoppedAt ?? at }
      }),
    }
    const notices = [
      `已并入需求修订（run ${runId}）：更新 ${revised.updated.length}、追加 ${revised.added.length}、作废 ${revised.cancelled.length}`,
    ]
    if (stopped.length > 0) notices.push(`已停止成员 ${stopped.join('、')}`)
    if (stopFailed.length > 0) {
      notices.push(
        `成员停止失败：${stopFailed.map((item) => `${item.name}（${item.error}）`).join('、')}（面板标记为停止中，待 watcher 对账）`,
      )
    }
    if (notified.length > 0) notices.push(`已直达通知 ${notified.join('、')}`)
    if (notifyFailed.length > 0) {
      notices.push(`修订通知失败：${notifyFailed.map((item) => `${item.name}（${item.error}）`).join('、')}`)
    }

    // 修订把最后一批任务也作废时，run 必须收口：否则面板会永远显示一个「在跑」的空 plan。
    // 结束时刻与终止原因同一次落盘（r20 口径：finishedAt 是唯一结束时刻，终态不允许缺）。
    const settled = new Set(['done', 'failed', 'cancelled', 'skipped'])
    const allSettled =
      finalState.plan.tasks.length > 0 && finalState.plan.tasks.every((task) => settled.has(task.status))
    if (allSettled && finalState.plan.status !== 'terminated' && finalState.plan.status !== 'cancelled') {
      finalState = {
        ...finalState,
        finishedAt: finalState.finishedAt ?? at,
        termination:
          finalState.termination ?? { reason: '需求修订后本次运行已无待执行任务', kind: 'superseded' },
        plan: { ...finalState.plan, status: 'terminated' },
      }
      notices.push('本次运行已无待执行任务，run 已终止（原因：需求修订）')
    }

    for (const message of messages) finalState = withMessage(finalState, message)
    finalState = withMessage(
      finalState,
      recordOf({ from: 'captain', to: 'user', at, body: notices.join('；') }),
    )
    saveState(finalState, 'plan-saved')

    return {
      ok: true,
      plan: finalState.plan,
      mode: revised.mode,
      updated: revised.updated,
      added: revised.added,
      cancelled: revised.cancelled,
      skipped: revised.skipped,
      revision: revised.revision,
      stopped,
      stopFailed,
      notified,
      notifyFailed,
    }
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
    // t5：复用成员不会新建成员 —— 同一个 memberId 在本次 run 的第二条 binding 起就是复用，
    // 活动流里再写「创建成员」会对不上宿主的真实名额（用户看到的是「怎么又建了一个」）。
    const spawnedMembers = new Set<string>()
    for (const binding of state.bindings) {
      const reused = spawnedMembers.has(binding.memberId)
      spawnedMembers.add(binding.memberId)
      events.push({
        at: binding.spawnedAt,
        memberId: binding.memberId,
        taskId: binding.taskId,
        kind: 'spawn',
        text: reused ? `复用成员 ${binding.name} 承接 ${binding.taskId}` : `创建成员 ${binding.name}`,
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
    // r14 AC-3：受理制之后「后台 spawn 全失败」发生在工具返回之后，只进宿主日志就没人看得见。
    // 通知环由装配层注入（内存态、cap 5），事件形状复用既有 kind:'status' —— 快照零扩张。
    for (const note of deps.dispatchNotices?.recent(state.plan.runId) ?? []) events.push(note)
    return events.sort((a, b) => b.at - a.at).slice(0, ACTIVITY_LIMIT)
  }

  function membersOf(state: RunState | null, roles: Role[], stallMs: number): MemberView[] {
    if (!state) return []
    const roleById = new Map(roles.map((role) => [role.id, role]))
    const taskById = new Map(state.plan.tasks.map((task) => [task.id, task]))
    const views: MemberView[] = []

    /**
     * t5：复用成员后，同一个 memberId 会挂多条 binding（旧任务已收口 + 新任务在跑）。
     * 面板一行 = 一个成员，必须回答「它现在在干什么」：
     * 停止中的事实位 > 已确认停止 > 有在飞任务 > 最近一条（bindings 是追加序）。
     */
    const priorityOf = (binding: RunState['bindings'][number]): number => {
      if (binding.stopping === true) return 3
      if (binding.stoppedAt !== undefined) return 2
      const task = taskById.get(binding.taskId)
      if (task && (task.status === 'running' || task.status === 'gate' || task.status === 'interrupted')) return 1
      return 0
    }
    // 已退役的历史成员默认不再展示；唯独「确认停止」的成员要留一个「已停止」位（AC-4：
    // 停了就该看得见，而不是从列表里悄悄消失）。
    const chosen = new Map<string, RunState['bindings'][number]>()
    const order: string[] = []
    for (const binding of state.bindings) {
      if (binding.retired === true && binding.stoppedAt === undefined) continue
      const current = chosen.get(binding.memberId)
      if (current === undefined) {
        chosen.set(binding.memberId, binding)
        order.push(binding.memberId)
        continue
      }
      if (priorityOf(binding) >= priorityOf(current)) chosen.set(binding.memberId, binding)
    }

    for (const memberId of order) {
      const binding = chosen.get(memberId)
      if (binding === undefined) continue
      const stopped = binding.stoppedAt !== undefined
      const task = taskById.get(binding.taskId)
      // r21 AC-4：中断已发出、尚未确认停止 → 「停止中」。这是 binding 上的事实位，不靠任务状态猜。
      const status: MemberStatus =
        binding.stopping === true && task?.status !== 'done'
          ? 'stopping'
          : stopped
            ? 'stopped'
            : toMemberStatus(task?.status ?? 'pending')
      views.push({
        memberId: binding.memberId,
        name: binding.name,
        roleId: binding.roleId,
        taskId: binding.taskId,
        status,
        // r21 AC-4：两个停止事实位只在 binding 上真的存在时才出现（缺席 = 没发生过，客户端不补 0）。
        ...(binding.stopping === true ? { stopping: true } : {}),
        ...(binding.stoppedAt !== undefined ? { stoppedAt: binding.stoppedAt } : {}),
        ...stallFieldsOf(state, binding.memberId, status, stallMs),
        lastEventAt: lastEventAtOf(state, binding.memberId, binding.spawnedAt),
        modelRoute: describeRoute(roleById.get(binding.roleId)),
        canResume: status !== 'done',
      })
    }

    // 兼容 v1 落盘的裸 Plan：task.memberId 有值但没有 binding（wrapLegacy 已升级结构，这里只兜底展示）。
    const seen = new Set(order)
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
        ...stallFieldsOf(state, task.memberId, status, stallMs),
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
    stallMs: number,
  ): { stalled: boolean; stalledForMs: number; stalledSecondsText: string; stallReason: StallReason; stallNote: string } {
    if (status !== 'running') {
      return { stalled: false, stalledForMs: 0, stalledSecondsText: '', stallReason: 'none', stallNote: '' }
    }
    // r32：判定只看 `progress`。**绝不**拿 spawnedAt 当基线 —— 没有信号就是「证据不足」，
    // 那是 `stallReason='unreported'`，不是停滞（旧实现正是在这里把 20 分钟的活说成停滞）。
    const judge = stallOf(state.progress?.[memberId]?.at, now(), stallMs)
    return {
      stalled: judge.stalled,
      stalledForMs: judge.stalledForMs,
      stalledSecondsText: judge.stalled ? secondsText(judge.stalledForMs) : '',
      stallReason: judge.reason,
      stallNote: stallNoteOf(judge.reason),
    }
  }

  function lastEventAtOf(state: RunState, memberId: string, fallback: number): number {
    let at = fallback
    // r32：实质推进也是活动 —— 旧实现只叠加消息与证据，于是「成员在跑」的快照里
    // `lastEventAt` 永远停在派发时刻，看起来像 20 分钟没有任何动静。
    const progressAt = state.progress?.[memberId]?.at
    if (typeof progressAt === 'number' && Number.isFinite(progressAt)) at = Math.max(at, progressAt)
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

  /**
   * r22：项目记忆落点的**唯一**解析入口（列表/注入/expand/read/write/delete 全部走这里）。
   *
   * 优先级：
   *  1. 显式 `workspace`（HTTP 参数）→ 仍走 `isKnownWorkspace` 白名单，未知返回 `null`（未授权）；
   *  2. `runProject`（run 落盘时的真实项目）→ 绝对路径且**不等于装配目录**时优先；
   *  3. `workspaceOf(sessionId)`（会话 cwd + workspace 注册表反查，装配层每次现查）；
   *  4. 都没有 → `memoryLocationOf` 明确退化到装配目录并给出可读原因（不静默）。
   */
  function memoryLocationFor(input: {
    sessionId?: string
    workspace?: string
    runProject?: string
    origin?: string
  }): MemoryLocation | null {
    if (input.workspace !== undefined && input.workspace.trim() !== '') {
      const roots = rootsFor(input.workspace)
      if (roots === null) return null
      const workspace = normalizeWorkspace(input.workspace)
      return { roots, projectDir: roots.projectDir, workspace, degraded: false }
    }
    return resolvedMemoryLocation(input.sessionId, input.runProject, input.origin)
  }

  /** 无显式 workspace 时的解析（不会返回 null）：run.project → 会话 cwd → 明确退化。 */
  function resolvedMemoryLocation(
    sessionId: string | undefined,
    runProject?: string,
    origin?: string,
  ): MemoryLocation {
    const runWorkspace = usableWorkspaceOf(runProject)
    // 旧 run 的 project 是 apply 时刻的装配 workspace（真实宿主 = profile 目录）：
    // 它派生出的目录与 memoryRoots.projectDir 相同，说明这不是「项目」，继续用会话/注册表解析。
    const runIsAssembly =
      runWorkspace !== undefined && projectMemoryDir(runWorkspace) === deps.memoryRoots.projectDir
    const fromRun = runWorkspace !== undefined && !runIsAssembly ? runWorkspace : undefined
    const fromSession =
      fromRun ?? (sessionId === undefined ? undefined : deps.workspaceOf?.(sessionId))
    return memoryLocationOf({
      publicDir: deps.memoryRoots.publicDir,
      fallbackProjectDir: deps.memoryRoots.projectDir,
      workspace: fromSession,
      origin: origin ?? (sessionId === undefined ? undefined : `会话 ${sessionId}`),
    })
  }

  /**
   * 读一批轨道的主题文件 → 条目（含 tombstone）。注入、快照、写入口共用这一份解析，
   * 保证「面板看到的条目」与「注入拿到的条目」来自同一次读。
   */
  function readTrackEntries(track: MemoryTrack, roots: MemoryRoots, at: number = now()): ParsedEntry[] {
    const out: ParsedEntry[] = []
    for (const view of listMemoryViews(track, roots, { now: at })) {
      const body = readMemory(track, view.name, roots)
      const parsed = parseEntryFile(body, {
        track,
        file: view.name,
        now: at,
        fallbackAt: view.updatedAt,
        acceptLegacy: true,
      })
      out.push(...parsed.entries)
    }
    return out
  }

  /**
   * 快照用的记忆投影：canonical/misc 文件视图 + 两轨配额 + 旧流水文件数 + 可注入条目。
   *
   * 旧 `run-*.md` / `lessons-*.md` **不参与**注入与配额，只计入 `legacyFileCount`；
   * 它们的内容由「整理」命令一次性提炼进 `pitfalls.md`。
   */
  function memoryOverview(roots: MemoryRoots, at: number = now()): MemoryOverview {
    const projectFiles = listMemoryViews('project', roots, { now: at })
    const publicFiles = listMemoryViews('public', roots, { now: at })
    const files = [...projectFiles, ...publicFiles]
    const entries: ParsedEntry[] = []
    for (const view of files) {
      const body = readMemory(view.track, view.name, roots)
      const parsed = parseEntryFile(body, {
        track: view.track,
        file: view.name,
        now: at,
        fallbackAt: view.updatedAt,
        acceptLegacy: true,
      })
      entries.push(...parsed.entries)
    }
    const legacyFileCount = [...listMemory('project', roots), ...listMemory('public', roots)].filter((file) =>
      isLegacyMemoryFile(file.name),
    ).length
    return {
      files,
      entries,
      quotas: {
        project: quotaOf('project', projectFiles),
        public: quotaOf('public', publicFiles),
      },
      legacyFileCount,
    }
  }

  /**
   * 条目级写入：在**内存里**逐条 apply，全部成功后才按文件各写一次。
   *
   * 原子性：任一条失败（BAD_TEXT / BAD_TOPIC / 配额满 / supersede 冲突）直接返回错误，
   * 此时盘上零改动；成功后 `changedFiles` 里的每个文件只渲染一次。
   */
  function mutateMemoryEntries(
    track: MemoryTrack,
    roots: MemoryRoots,
    drafts: readonly EntryDraft[],
  ): MemoryMutationResult {
    let entries = readTrackEntries(track, roots)
    const changed = new Set<string>()
    const touched: ParsedEntry[] = []
    const evicted: ParsedEntry[] = []
    let added = 0
    let updated = 0
    let revived = 0
    let superseded = 0
    for (const draft of drafts) {
      const outcome = applyMemoryMutation(entries, draft, { maxPerFile: ENTRIES_PER_FILE })
      if (!outcome.ok) return { ok: false, code: outcome.code, message: outcome.message }
      entries = outcome.entries
      touched.push(...outcome.touched)
      evicted.push(...outcome.evicted)
      added += outcome.added
      updated += outcome.updated
      revived += outcome.revived
      superseded += outcome.superseded.length
      for (const file of outcome.changedFiles) changed.add(file)
    }
    const changedFiles = [...changed].sort((a, b) => a.localeCompare(b))
    for (const file of changedFiles) {
      const written = writeMemoryFile(track, file, entries, roots)
      if (!written.ok) return { ok: false, code: 'BAD_REQUEST', message: written.error }
    }
    const topics: MemoryTopicId[] = []
    for (const entry of touched) {
      if (entry.topic !== null && !topics.includes(entry.topic)) topics.push(entry.topic)
    }
    return {
      ok: true,
      entries: touched.map(entryViewOf),
      added,
      updated,
      revived,
      superseded,
      topics,
      evicted: evicted.map(entryViewOf),
      notices: [],
      changedFiles,
    }
  }

  /**
   * r26：run 阶段判定的唯一派生点（历史行 `RunSummary` 与当前 run 快照共用）。
   *
   * - `running` = running + gate 任务数（与并发视图同一口径，见 `concurrencyOf`）；
   * - `failed` / `interrupted` = 对应终态任务数（每个 interrupted 任务对应一个可续聊成员）；
   * - `members` = 非 retired 的绑定数（成员已退出但绑定保留，不算在跑）。
   *
   * 返回 `undefined` 只表示「还没有 run」，不表示这些数字不可得；有 state 时四个数
   * 都是从真实任务/绑定数出来的（0 是合法事实）。不落盘，每次读取现算。
   */
  function runStageCountsOf(state: RunState | null): RunStageCounts | undefined {
    if (state === null) return undefined
    let running = 0
    let failed = 0
    let interrupted = 0
    for (const task of state.plan.tasks) {
      if (task.status === 'running' || task.status === 'gate') running += 1
      else if (task.status === 'failed') failed += 1
      else if (task.status === 'interrupted') interrupted += 1
    }
    const members = state.bindings.filter((binding) => binding.retired !== true).length
    return { running, failed, interrupted, members }
  }

  function concurrencyOf(state: RunState | null): PanelSnapshot['concurrency'] {
    const host = deps.hostConcurrency?.() ?? { limit: MAX_CONCURRENT_LIMIT, source: 'default' as const }
    // 与 `RunStageCounts.running` 共用同一派生点，禁止在这里再写一份过滤条件。
    const running = runStageCountsOf(state)?.running ?? 0
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
    // r20：落盘值优先，历史 run 用 `finishedAtOf` 的可核实回退（任务结束时刻/最后消息时间）。
    const endedAt = finishedAtOf(state)
    const ended = endedAt !== undefined
    if (!ended && (state.plan.status === 'cancelled' || state.plan.status === 'terminated')) {
      return durationCellOf({ startAt: state.plannedAt, state: 'unavailable', now: at })
    }
    return durationCellOf({
      startAt: state.plannedAt,
      ...(ended ? { endAt: endedAt } : {}),
      state: ended ? 'done' : 'running',
      now: at,
    })
  }

  /**
   * 任务级用时（快照 `taskDurations`，key = taskId）；r24 起与 `library.taskDurationOf`
   * 共用 `taskDurationCellOf`：已结束但缺起止记录 → 不可得 + 原因，不再误报「未开始」。
   */
  function taskDurationsOf(state: RunState | null, at: number): Record<string, DurationCell> {
    const out: Record<string, DurationCell> = {}
    if (!state) return out
    for (const task of state.plan.tasks) {
      const time = state.taskTimes?.[task.id]
      out[task.id] = taskDurationCellOf({
        status: task.status,
        ...(time?.startedAt === undefined ? {} : { startedAt: time.startedAt }),
        ...(time?.endedAt === undefined ? {} : { endedAt: time.endedAt }),
        terminal: isTerminalTaskStatus(task.status),
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
   * 面板 2 秒一刷时不该把历史列表变成每刷一次的磁盘风暴。
   *
   * t4：memo 额外以 `store.writeEpoch()` 为失效判据 —— 任何一次落盘（saveState / applyReceipt
   * 落账 / closeRun / cancel / 自动对账 / dispatch / watcher / tools，全部收敛到 `RunsStore.save`）
   * 之后，下一次 `historyOf` 必须重新读盘，否则「终止成功」后历史行还会最多 5 秒显示旧状态。
   * 反向约束（AC：不得退化）保留：**没有写盘**时仍按 5 秒合并读；只改 usage 的投影写盘
   * 走 `historyNeutral`，不推进 epoch（见 `store.SaveOptions`），避免轮询帧把 memo 打穿。
   *
   * r34：memo 里除了 `RunSummary` 还要带上每个 run 的 `bindings` —— 存活成员数依赖宿主名单，
   * 而名单（`deps.listMembers`）会随成员退出变化；不把 bindings 一起缓存的话，为了算这一格
   * 就得每帧重读 ≤50 个 run 文件。bindings 是只读快照，和这一行的其它派生值一样**不落盘**。
   */
  interface HistoryRow {
    run: RunSummary
    /** 该 run 的 bindings；`null` = run 文件读不出来（与四项计数同样按「不可得」处理）。 */
    bindings: RunState['bindings'] | null
  }
  let historyMemo: { sessionId: string; at: number; epoch: number; rows: HistoryRow[] } | null = null

  /**
   * r34：宿主成员名单的**一次读盘**缓存（异步读口 + 同步快照之间的适配层）。
   *
   * 为什么需要缓存：`snapshot()` 是同步契约（tools / prompt / 单测都同步取用），
   * 而成员名单读口 `deps.listMembers` 是异步的。于是把「读」收敛到这里：同一时刻最多一个
   * 在飞请求，结果按 `MEMBER_ROSTER_TTL_MS` 复用；`historyOf` 每次只触发**一次**，
   * 再用同一份 rows 给**整批** run 逐条算存活数（绝不 per-run 读盘）。
   * 代价是最多滞后一个轮询帧（面板 2 秒一刷），换来同步契约不被打破。
   *
   * 三态语义（客户端据此区分「确实没人」与「不知道」）：
   *   - `null` = 还没读到过 → 历史行**不填** `liveMembers`；
   *   - `{ unknown }` = 没有读口 / 读失败 → 同样不填（0 会被读成「确实没有存活成员」）；
   *   - `{ rows }` = 读到名单 → 按 `normalizeHostStatus === 'alive'` 计数（与 `closeRun` 同源）。
   */
  let memberRoster: { rows: HostMember[] } | { unknown: string } | null = null
  let memberRosterAt = 0
  let memberRosterInFlight = false
  const MEMBER_ROSTER_TTL_MS = 1500

  function refreshMemberRoster(): void {
    if (memberRosterInFlight) return
    const at = now()
    if (memberRoster !== null && at - memberRosterAt < MEMBER_ROSTER_TTL_MS) return
    const read = deps.listMembers
    if (read === undefined) {
      memberRoster = { unknown: '装配层未提供宿主成员名单读口' }
      memberRosterAt = at
      return
    }
    memberRosterInFlight = true
    let pending: Promise<HostMember[]>
    try {
      pending = read()
    } catch (error) {
      // 同步抛（非 async 读口）也要落成 unknown，绝不让它把这一帧快照整个炸掉。
      memberRoster = { unknown: error instanceof Error ? error.message : String(error) }
      memberRosterAt = now()
      memberRosterInFlight = false
      return
    }
    // 读失败 ≠ 没有成员：整体退成 unknown（历史行不填），绝不沿用上一轮名单冒充「此刻」。
    void pending.then(
      (rows) => {
        memberRoster = { rows }
        memberRosterAt = now()
        memberRosterInFlight = false
      },
      (error: unknown) => {
        memberRoster = { unknown: error instanceof Error ? error.message : String(error) }
        memberRosterAt = now()
        memberRosterInFlight = false
      },
    )
  }

  /**
   * 历史行可填的存活成员数；`undefined` = 不知道（无读口 / 读失败 / 该 run 读不出来）。
   *
   * 没有未退休 binding 时直接给 0 —— 这与 `liveMemberNamesOf` 的第 1 步同源：
   * 「一个绑定都没有」本身就是「确实没有存活成员」的事实，不需要读名单。
   */
  function liveMemberCountOf(bindings: RunState['bindings'] | null): number | undefined {
    if (bindings === null) return undefined
    const live = bindings.filter((binding) => binding.retired !== true)
    if (live.length === 0) return 0
    if (memberRoster === null || !('rows' in memberRoster)) return undefined
    return aliveMemberNamesOf(live, memberRoster.rows).length
  }

  function historyOf(sessionId: string): RunSummary[] {
    const at = now()
    const epoch = deps.store.writeEpoch()
    let rows: HistoryRow[]
    if (
      historyMemo &&
      historyMemo.sessionId === sessionId &&
      historyMemo.epoch === epoch &&
      at - historyMemo.at < LIBRARY_CACHE_MS
    ) {
      rows = historyMemo.rows
    } else {
      // r17：历史行要显示 token 六项。六项文案的唯一来源是宿主 `format.ts`，客户端不许自己拆，
      // 所以在这里把落盘的 `usageTotals` 派生为 `UsageCell`（含 `text` + `details`）。
      // 只派生不落盘：`usage` 是视图字段，run 文件里仍只有原始 `usageTotals`。
      rows = deps.store
        .list()
        .filter((run) => run.sessionId === sessionId)
        .slice(0, HISTORY_PAGE_SIZE)
        .map((run) => {
          // r26：阶段判定计数从 RunState 现算（落盘只保留原始事实，不新增字段）。
          // 读盘失败时四项计数与 bindings 一起缺席 —— 宁可显示「不可得」，
          // 也不拿 0 冒充「没有失败/没有成员」。
          let counts: RunStageCounts | undefined
          let bindings: RunState['bindings'] | null = null
          try {
            const state = deps.store.load(run.runId)
            counts = runStageCountsOf(state)
            bindings = state === null ? null : state.bindings
          } catch {
            counts = undefined
            bindings = null
          }
          return {
            bindings,
            run: {
              ...run,
              ...(counts === undefined ? {} : counts),
              usage: usageCellOf(run.usageTotals, HISTORY_USAGE_REASON),
            },
          }
        })
      historyMemo = { sessionId, at, epoch, rows }
    }
    if (rows.length === 0) return []
    // 一个没有 run 的会话不该为历史行去读宿主名单：先看有没有行，再决定要不要「一次读盘」。
    refreshMemberRoster()
    return rows.map((row) => {
      const liveMembers = liveMemberCountOf(row.bindings)
      // 读不到就**不填**（不要填 0）：客户端把缺省读成「不知道」，把 0 读成「确实没人」。
      return liveMembers === undefined ? row.run : { ...row.run, liveMembers }
    })
  }

  /**
   * r17：用宿主会话投影刷新落盘 usage（**覆盖**语义），返回可继续用于本帧快照的 state。
   *
   * 为什么在这里刷：真机 `session/event` 从未投递到插件（r13 的用量账一直空着），
   * 而 `sessionProjections.stateOf(memberSession,'tokenUsage')` 从会话日志回放、不依赖事件。
   * 快照是面板 2 秒轮询的唯一入口，也是工具拿状态的入口 —— 在入口刷一次就够。
   *
   * 只有**数值真的变了**才落盘：`applyProjectionUsage` 在内容不变时返回同一引用，
   * 2 秒一刷都写盘会把 run 文件变成磁盘风暴（mtime 也没有信息量了）。
   * 这里只写盘、不触发派发：用量变化不代表计划/任务变了，走 `saveState` 会让
   * autoDispatcher 每 2 秒收到一次 `plan-saved`，把退避统计污染成噪声。
   */
  function refreshUsage(state: RunState | null): RunState | null {
    const read = deps.readSessionUsage
    if (state === null || typeof read !== 'function') return state
    const readCalls = deps.readSessionCalls
    /** 读次数：未注入/抛错都当「这次读不到」（保留已落盘值），绝不让它打断快照。 */
    const readCallsOf = (memberId: string): number | undefined => {
      if (typeof readCalls !== 'function') return undefined
      try {
        return readCalls(memberId)
      } catch {
        return undefined
      }
    }
    const entries: ProjectionUsageEntry[] = []
    for (const binding of state.bindings ?? []) {
      // 已退出的成员不再刷新（会话多半已卸载）；它的累计值留在落盘 usage 里。
      if (binding.retired === true) continue
      const memberId = binding.memberId
      if (typeof memberId !== 'string' || memberId === '') continue
      let totals: TokenTotals | undefined
      try {
        totals = read(memberId)
      } catch {
        // fail-open：读不到就保持已落盘的值，绝不让一次投影异常打断整轮快照。
        totals = undefined
      }
      // token 投影整个读不到时**连 calls 也不单独写**：`applyProjectionUsage` 是覆盖语义，
      // 只带 calls 的 totals 会把已落盘的 token 数字抹掉（上一帧读到了、这一帧读不到很常见）。
      if (totals === undefined) continue
      /**
       * r20：调用次数来自成员会话事件计数，与 token 是两次读、同一份会话。
       *  - 读到数字（含真实的 0）→ 合并进 totals，跟着 byMember/byTask/total 一起落盘；
       *  - 读不到（日志异常）→ **保留上一帧已落盘的 calls**，不能把历史数字覆盖成「不可得」。
       */
      const calls = readCallsOf(memberId)
      const previousCalls = state.usage?.byMember?.[memberId]?.calls
      const mergedCalls = calls ?? previousCalls
      if (mergedCalls !== undefined) totals = { ...totals, calls: mergedCalls }
      entries.push({ memberId, taskId: binding.taskId, totals })
    }
    if (entries.length === 0) return state
    const next = applyProjectionUsage(state.usage, entries, now())
    if (next === undefined || next === state.usage) return state
    const updated: RunState = { ...state, usage: next }
    try {
      // t4：`historyNeutral` —— 这一笔只改 usage（`RunState` 的视图字段），不改变 run 的状态、
      // 终止原因或任务状态。若它也推进 `writeEpoch`，正在跑的 run 每个 2 秒轮询帧都会因
      // token 增长写一次盘，历史 memo 就退化成「每刷全量读盘」；所以这里刻意不失效历史缓存
      // （历史行的 token 数字最多晚 5 秒，与 t4 之前的行为一致，不是新的陈旧点）。
      deps.store.save(updated, { historyNeutral: true })
    } catch (error) {
      // 落盘失败：本帧仍用内存新值，盘上保留旧值（下一帧再试）；错误交给装配层进日志。
      deps.onUsagePersistError?.(`用量落盘失败（${error instanceof Error ? error.message : String(error)}）`)
    }
    return updated
  }

  function snapshot(sessionId: string): PanelSnapshot {
    const state = refreshUsage(loadState(sessionId))
    const roles = deps.roles.list()
    // 一次快照只取一次时间：记忆视图的「相对时刻」与页脚时间必须来自同一个 now。
    const at = now()
    // r22：每次快照现解析项目记忆根（run.project 不在快照路径里，按会话工作区）。
    const memoryLocation = resolvedMemoryLocation(sessionId)
    const overview = memoryOverview(memoryLocation.roots, at)
    // 生效设置只取一次：同一份快照里的预算与停滞阈值必须来自同一次读，否则会出现
    // 「预算 4000 但只注入了 200」这种自相矛盾（一次 snapshot 读两次盘就会发生）。
    const settings = settingsOf()
    const stallMs = stallMsOf(settings)
    const goal = state?.plan.tasks.map((task) => task.title).join(' ') ?? ''
    const selected = selectMemoryEntries(goal, overview.entries, settings.memoryBudget)
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
    // r13：所有「已等待 / 运行中用时」都基于上面同一个 at —— 否则同一份快照里两条时间文本
    // 会差几毫秒，左栏右栏对不上。
    const pending = pendingViewOf(state?.pendingConfirmation, at)
    // r26：当前 run 与历史行共用同一组阶段计数（与 `RunSummary` 的四个字段同构）。
    const runCounts = runStageCountsOf(state)

    return {
      enabled: flags[sessionId]?.enabled === true,
      runId: state?.plan.runId,
      planStatus: state?.plan.status,
      plannedAt: state?.plannedAt,
      // r21：目标全文与修订史（含「需求修订」段落）。缺省时字段缺席，客户端显示「不可得」而不是空串。
      ...(state?.plan.goal === undefined ? {} : { goal: state.plan.goal }),
      ...(state?.plan.revisions === undefined ? {} : { revisions: state.plan.revisions }),
      tasks: panelTasksOf(state),
      members: membersOf(state, roles, stallMs),
      ...(runCounts === undefined ? {} : { runCounts }),
      messages: state?.messages ?? [],
      routeAudits: state?.routeAudits ?? [],
      concurrency: concurrencyOf(state),
      memory: {
        injectedChars: selected.chars,
        budget: settings.memoryBudget,
        truncated: selected.truncated,
        files: overview.files,
        // r23：两轨配额与旧流水计数。旧 `run-*.md` 不参与注入，只在这里让人看见「还有谁没整理」。
        quotas: overview.quotas,
        legacyFileCount: overview.legacyFileCount,
        // 内联索引明细（AC-7）与未内联条目（AC-8）：面板据此说「哪几条进了上下文 / 哪几条可展开」。
        inline: selected.entries,
        omitted: selected.omitted,
        // r22：让「记忆写到哪儿 / 为什么没写进项目」在面板与工具返回值里可见，不静默。
        projectDir: memoryLocation.projectDir,
        ...(memoryLocation.workspace === undefined ? {} : { workspace: memoryLocation.workspace }),
        ...(memoryLocation.degraded
          ? { degraded: true, degradeReason: memoryLocation.degradeReason ?? '项目记忆退化到装配目录' }
          : {}),
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
   * r24：一个 run 此刻是否还有**存活成员**（`closeRun` 的唯一判据）。
   *
   * 判定顺序刻意保守：
   *  1. 没有未退休的 binding → 没有成员，直接放行；
   *  2. 有 binding 但装配层没给名单读口 → 视为「可能还活着」，拒绝终止（宁可让用户多一步，
   *     也不把正在跑的工作判死）；
   *  3. 有读口但读失败 → 同上（未知 ≠ 没有）；
   *  4. 读到了就按宿主的 4 态归一：`alive` 才算存活（`normalizeHostStatus` 与 watcher 同源）。
   */
  async function liveMemberNamesOf(state: RunState): Promise<{ names: string[]; unknown?: string }> {
    const bindings = state.bindings.filter((binding) => binding.retired !== true)
    if (bindings.length === 0) return { names: [] }
    const namesOf = (): string[] =>
      bindings.map((binding) => binding.name || binding.memberId || binding.taskId)
    if (deps.listMembers === undefined) {
      return { names: namesOf(), unknown: '装配层未提供宿主成员名单读口，无法确认成员是否已退出' }
    }
    let rows: HostMember[]
    try {
      rows = await deps.listMembers()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { names: namesOf(), unknown: `宿主成员名单读取失败（${reason}）` }
    }
    // 读到了就按宿主 4 态归一，判定实现与历史行存活数共用同一处。
    return { names: aliveMemberNamesOf(bindings, rows) }
  }

  /**
   * r34：一组 binding 里宿主仍判 `alive` 的成员名 —— `liveMemberNamesOf`（`closeRun` 的判据）
   * 与历史行 `liveMembers` 计数的**唯一**判定实现，两处不许各写一份。
   *
   * 只认 `normalizeHostStatus === 'alive'`（与 watcher 同源的四态归一），
   * `unknown` / `dead` 一律不算存活：宁可显示「没人」让用户多看一眼，也不把已退出的成员算成在跑。
   */
  function aliveMemberNamesOf(bindings: RunState['bindings'], rows: HostMember[]): string[] {
    const names: string[] = []
    for (const binding of bindings) {
      const row = rows.find(
        (item) =>
          (binding.memberId !== undefined && item.id === binding.memberId) ||
          (binding.name !== '' && item.name === binding.name),
      )
      if (row !== undefined && normalizeHostStatus(row.status) === 'alive') {
        names.push(binding.name || row.name || binding.memberId || binding.taskId)
      }
    }
    return names
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

  /**
   * 派发准入判定（r14 AC-1）：`precheckDispatch` 与 `case 'dispatch'` 的唯一判据。
   *
   * 顺序刻意与 `act` 对齐 —— `act` 的 `preflightGate` 在进 case **之前**就先拦「未启用/暂停」，
   * 所以这里也必须先拦这两道，否则同一状态下工具与面板会得到不同拒绝码
   *（TECHNICAL §3.2 的判定次序把 PAUSED 写在 status 之后，与既有 act 行为矛盾，按行为为准）。
   */
  function admissionOf(sessionId: string, runId?: string): DispatchAdmission {
    if (flags[sessionId]?.enabled !== true) {
      return { ok: false, code: 'NOT_ENABLED', message: NOT_ENABLED_TEXT }
    }
    const state = loadState(sessionId)
    if (!state) {
      return {
        ok: false,
        code: 'NO_PLAN',
        message: '当前会话还没有执行计划：先让队长拆解目标（auto_team_plan）',
      }
    }
    // PAUSED（r7 AC-16）：dispatch 属于 PAUSED_BLOCKED，暂停时一律不放行。
    if (state.plan.status === 'paused') {
      return { ok: false, code: 'PAUSED', message: PAUSED_TEXT }
    }
    if (runId !== undefined && runId !== state.plan.runId) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `找不到运行 ${runId}（当前会话最新运行是 ${state.plan.runId}）`,
      }
    }
    const status = state.plan.status
    // r7：`paused` 已由上一道闸门拦掉，这里只留两个可派发状态 ——
    // 两处都收窄是刻意的（bridge 一处、dispatchReady 一处）：任何一条推进路径绕开都不会起人。
    if (status !== 'draft' && status !== 'dispatching') {
      return {
        ok: false,
        code: 'NO_PLAN',
        message: `计划状态为 ${status}，不能派发（需要 draft/dispatching）`,
      }
    }
    const boundIds = new Set(
      state.bindings.filter((binding) => binding.retired !== true).map((binding) => binding.taskId),
    )
    const ready = readyTasks(state.plan.tasks)
    const unbound = ready.filter((taskId) => !boundIds.has(taskId))
    if (status === 'dispatching' && unbound.length === 0) {
      return {
        ok: false,
        code: 'PLAN_ALREADY_DISPATCHED',
        message: '计划已派发：成员已在运行，不会重复起人（中断的成员请用「继续」恢复）',
      }
    }
    return { ok: true, runId: state.plan.runId, ready, unbound }
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
          // 判据在 `admissionOf`（与 precheckDispatch 同一处），这里只做「过闸→执行→组 notices」。
          const admission = admissionOf(sessionId, action.runId)
          if (!admission.ok) return reject(admission.code, admission.message, sessionId)
          const state = loadState(sessionId)
          // admissionOf 刚刚读过同一份状态且中间没有 await：这个分支只为让类型收敛，不可达。
          if (!state) return reject('NO_PLAN', '当前会话还没有执行计划', sessionId)

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
          // t5：复用成员不新建成员，「已创建 N 个成员」里必须剔掉复用的那几个，否则面板会
          // 报出一个不存在的成员数。dispatch 的对外形状是固定的（装配层只投影
          // started/skipped/errors/renamed），这里按落盘后的 binding 反查：同一 memberId
          // 在派发前已被别的任务占用 → 这次是复用了它。
          //
          // 跨 run 复用（修名额泄漏的主场景）要看**同会话历史 run** 的 binding：成员是在上一个
          // run 里建的，当前 run 派发前的 bindings 里没有它。因此先把派发前所有已知 binding 的
          // memberId 收进集合，再对照派发后新任务的 binding。
          const beforeMemberIds = new Set<string>()
          for (const item of state.bindings) beforeMemberIds.add(item.memberId)
          try {
            for (const summary of deps.store.list()) {
              if (summary.runId === state.plan.runId || summary.sessionId !== state.plan.sessionId) continue
              const prior = deps.store.load(summary.runId)
              if (!prior) continue
              for (const item of prior.bindings) beforeMemberIds.add(item.memberId)
            }
          } catch {
            /* 历史不可读时只按当前 run 判定（提示可能把复用说成新建，不影响派发） */
          }
          const after = deps.store.load(state.plan.runId) ?? state
          // r26 ①：本批真的建起/复用了成员才算「派发成功」→ 计划态 draft → dispatching。
          // 全部失败/全部跳过时保持 draft（失败后用户还能再点派发，不被误标成「已派发」）。
          // `advancePlanToDispatching` 幂等且只进不退：已是 dispatching/暂停/终态时返回 null。
          if (outcome.started.length > 0) {
            const advanced = advancePlanToDispatching(after)
            if (advanced !== null) saveState(advanced)
          }
          const reusedTasks = outcome.started.filter((taskId) => {
            const binding = after.bindings.find((item) => item.taskId === taskId && !item.retired)
            return binding !== undefined && beforeMemberIds.has(binding.memberId)
          })
          const createdTasks = outcome.started.filter((taskId) => !reusedTasks.includes(taskId))
          if (outcome.started.length > 0) {
            const parts: string[] = []
            if (createdTasks.length > 0) parts.push(`已创建 ${createdTasks.length} 个成员：${createdTasks.join('、')}`)
            if (reusedTasks.length > 0) parts.push(`已复用 ${reusedTasks.length} 个空闲成员：${reusedTasks.join('、')}`)
            notices.unshift(parts.join('；'))
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
          if (state.plan.status === 'terminated') {
            return reject('BAD_REQUEST', '本次运行已终止，取消不会改变它的终态', sessionId)
          }
          // r20/r21：取消是终态，结束时刻与状态、终止原因同一次落盘
          // （重复取消走上面的幂等分支，不覆盖首次时刻；finishedAt 仍是唯一结束时刻）。
          const at = now()
          saveState({
            ...state,
            finishedAt: state.finishedAt ?? at,
            termination: state.termination ?? { reason: '队长取消了本次运行', kind: 'cancelled' },
            plan: { ...state.plan, status: 'cancelled' },
          })
          return accept(sessionId, ['已取消本次运行：不会再有新的派发（已创建的成员仍可对话）'])
        }

        /**
         * r24：终止残留计划（用户手动收口）。
         *
         * 只允许「非终态 + 没有任何存活成员」的 run；目标已是终态时返回 `unchanged`
         * （幂等、不报错 —— 用户重复点同一行不该看到红字）；还有成员在跑时拒绝：
         * 终止正在推进的 run 必须走「取消本次运行」，两条路径的副作用与文案都不同。
         */
        case 'closeRun': {
          const state = deps.store.load(action.runId)
          if (!state) return reject('NOT_FOUND', `找不到运行 ${action.runId}`, sessionId)
          if (state.plan.sessionId !== sessionId) {
            return reject('NOT_FOUND', `运行 ${action.runId} 不属于当前会话`, sessionId)
          }
          if (state.plan.status === 'terminated' || state.plan.status === 'cancelled') {
            return {
              ...accept(sessionId, [`运行 ${action.runId} 已是终态，无需重复终止`]),
              unchanged: true,
            }
          }
          const live = await liveMemberNamesOf(state)
          if (live.unknown !== undefined) {
            return reject('BAD_REQUEST', `无法终止运行 ${action.runId}：${live.unknown}`, sessionId)
          }
          if (live.names.length > 0) {
            return reject(
              'BAD_REQUEST',
              `运行 ${action.runId} 仍有存活成员（${live.names.join('、')}）在跑：请先取消本次运行，或等成员结束再终止`,
              sessionId,
            )
          }
          const at = now()
          // r25：残留任务与终态必须落在**同一次写盘**里（saveState 内部只 save 一次）——
          // 先写 terminated 再补任务，中间态被面板读到就会出现「已终止但还有 running 任务」。
          const cancelled = cancelResidualTasks(state, at, CLOSE_RUN_REASON)
          saveState({
            ...state,
            finishedAt: at,
            termination: { reason: CLOSE_RUN_REASON, kind: 'stale' },
            plan: { ...state.plan, status: 'terminated', tasks: cancelled.tasks },
          })
          return accept(sessionId, [`已终止残留计划 ${action.runId}：不会再产生新的派发`])
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
          const binding = task.status === 'running' ? bindingFor(state, task.id) : undefined
          // r21 AC-4：中断是异步的 —— 先把 `stopping` 落盘，等待期间面板显示「停止中」，
          // 而不是「还在跑」或（中断失败后）假的「已停止」。
          let base = state
          if (binding !== undefined && binding.retired !== true) {
            base = {
              ...state,
              bindings: state.bindings.map((item) =>
                item.memberId === binding.memberId ? { ...item, stopping: true } : item,
              ),
            }
            saveState(base)
          }
          let stoppedOk = false
          if (binding !== undefined && binding.retired !== true) {
            const memberName = binding.name
            const interrupt = deps.interruptMember
            if (typeof interrupt === 'function') {
              const stopped = await interrupt(memberName)
              stoppedOk = stopped.ok
              notices.push(
                stopped.ok
                  ? `已中断成员 ${memberName}`
                  : `成员 ${memberName} 中断失败：${stopped.error ?? '未知原因'}（任务状态已取消，成员保持停止中，由 watcher 对账）`,
              )
            } else {
              notices.push(`宿主未装配成员中断端口：成员 ${memberName} 保持停止中，由 watcher 对账`)
            }
          }

          const downstream = downstreamOf(state, task.id)
          let next = withTask(base, task.id, (item) => {
            // r33：任务被取消即离开 running →「待回执」观察事实一并清掉（不能留在终态任务上）。
            const { waitingOn: _waiting, waitReason: _reason, silentFinish: _silentFinish, ...rest } = item
            return {
              ...rest,
              status: 'cancelled' as const,
              cancelledAt: at,
              cancelledBy: 'user' as const,
              cancelReason: reason === '' ? '队长取消任务' : reason,
            }
          })
          // 中断确认成功才退役 binding（清 stopping）；失败/未装配时保持 stopping=true（停止中）。
          if (stoppedOk && binding !== undefined) {
            next = {
              ...next,
              bindings: next.bindings.map((item) => {
                if (item.memberId !== binding.memberId) return item
                const { stopping: _stopping, ...rest } = item
                return { ...rest, retired: true, stoppedAt: rest.stoppedAt ?? at }
              }),
            }
          }
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
            // r33：跳过也让任务离开 running ⇒ 同一份「待回执」事实一并清掉。
            const { waitingOn: _waiting, waitReason: _reason, silentFinish: _silentFinish, ...rest } = item
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
          const gateContext = gateContextOf(sessionId)
          let outcome: { ok: boolean; evidence: GateEvidence }
          try {
            outcome = await enqueueGate(() =>
              Promise.resolve(
                runGate(gateTask, {
                  cwd: gateContext.cwd,
                  artifactsDir: gateContext.artifactsDir,
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
          const gateContext = gateContextOf(sessionId)

          let outcome: { ok: boolean; evidence: GateEvidence }
          try {
            // `Promise.resolve` 让门禁既接受异步 GateExec（TECH §5.3 的 v2）也接受同步实现：
            // 队列里排的永远是 Promise，同步实现不会阻塞其他回执的排队语义。
            outcome = await enqueueGate(() =>
              Promise.resolve(
                runGate(task, {
                  cwd: gateContext.cwd,
                  artifactsDir: gateContext.artifactsDir,
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
          const location = resolvedMemoryLocation(sessionId)
          const written = writeMemory(track, name, action.body ?? '', location.roots)
          if (!written.ok) return reject('BAD_REQUEST', written.error, sessionId)
          return accept(sessionId, [`已保存 ${track}/${written.name}`])
        }

        case 'curateMemory': {
          // r23：整理旧流水。track 缺省 project；失败也要返回快照（面板不清空列表），
          // 因此 reject() 里仍带 snapshot。成功把报告合并进 ActResult.curation。
          const track = trackOf(action.track) ?? 'project'
          const report = curateMemory({
            track,
            roots: resolvedMemoryLocation(sessionId).roots,
            dryRun: action.dryRun !== false,
          })
          if (!report.ok) return reject('BAD_REQUEST', report.warnings[0] ?? '整理失败', sessionId)
          const accepted = accept(sessionId, [curateSummaryOf(report)])
          return { ...accepted, curation: report }
        }

        case 'deleteMemory': {
          const track = trackOf(action.track)
          if (!track) return reject('BAD_REQUEST', 'track 必须是 public 或 project', sessionId)
          const name = safeMemoryName(action.name)
          if (name === null) return reject('BAD_REQUEST', '非法文件名：只允许单段名称（字母/数字/._-，自动补 .md）', sessionId)
          const removed = deleteMemory(track, name, resolvedMemoryLocation(sessionId).roots)
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

  /**
   * r34：装配后预热一次成员名单 —— 面板第一帧快照是同步的，等不到那次读盘；
   * 预热失败只落成 unknown（历史行不填 liveMembers），下一次快照按 TTL 重试。
   */
  if (deps.listMembers !== undefined) refreshMemberRoster()

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

    revise: reviseRun,

    /**
     * r14 AC-1：同步预检（工具受理制的「先问能不能派」）。
     *
     * 纯函数式读一次状态，不产生任何副作用：既可以把回答原样写进工具返回值，
     * 也可以被面板在点按钮前拿来禁用 —— 两处结论必须一致，因为判据同源。
     */
    precheckDispatch(sessionId: string, runId?: string): DispatchAdmission {
      return admissionOf(sessionId, runId)
    },

    /**
     * r13 AC-21/AC-22：左栏项目库。装配在 `host/library.ts`（带缓存），这里只转派；
     * 未装配时返回空库 —— 空库是「没有数据」，不是「假装没有项目」（PRD 反模式）。
     */
    library(query: { sessionId?: string; runId?: string }) {
      const view = deps.libraryView
      if (typeof view === 'function') return view(query)
      return { projects: [], global: { memories: [] } }
    },

    async readMemoryFile(track: MemoryTrack, name: string, workspace?: string, sessionId?: string) {
      const safe = safeMemoryName(name)
      if (safe === null) return { error: '非法文件名' }
      // r22：显式 workspace 仍走白名单；面板不带 workspace 时按会话解析项目根。
      let roots: MemoryRoots
      if (workspace !== undefined && workspace.trim() !== '') {
        const requested = rootsFor(workspace)
        if (requested === null) return { error: `未授权的工作区：${workspace ?? ''}` }
        roots = requested
      } else {
        roots = resolvedMemoryLocation(sessionId).roots
      }
      // r23：详情由宿主解析成结构化条目（客户端/模型不解析 md）；legacy 文件允许读，
      // `file.legacy=true`，其条目**不参与**注入与配额。
      const detail = readMemoryEntries(track, safe, roots)
      if (detail === null) return { error: `记忆文件不存在：${track}/${safe}` }
      return {
        data: {
          track,
          name: safe,
          body: detail.body,
          chars: detail.body.length,
          file: detail.file,
          entries: detail.parsed.entries.map(entryViewOf),
        },
      }
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

    memoryFor(goal: string, sessionId?: string) {
      const overview = memoryOverview(resolvedMemoryLocation(sessionId).roots)
      // AC-13 生效点③：队长侧注入预算与面板 `memory.budget` 必须**同源**（都读 settings），
      // 否则面板显示 4000 而成员实际只拿到 200 —— 本项目历史高频 bug 族的形态。
      const selected = selectMemoryEntries(goal, overview.entries, settingsOf().memoryBudget)
      return { text: selected.text, truncated: selected.truncated, chars: selected.chars }
    },

    remember(
      track: MemoryTrack,
      name: string,
      body: string,
      sessionId?: string,
    ): Result<{ name: string }> {
      const lines = (body ?? '').split('\n').slice(0, MEMORY_LINES_PER_TASK)
      const written = writeMemory(track, name, lines.join('\n'), resolvedMemoryLocation(sessionId).roots)
      if (!written.ok) return { error: written.error }
      return { data: { name: written.name } }
    },

    mutateMemory(
      track: MemoryTrack,
      drafts: readonly EntryDraft[],
      sessionId?: string,
    ): MemoryMutationResult {
      return mutateMemoryEntries(track, resolvedMemoryLocation(sessionId).roots, drafts)
    },

    expandMemory(id: string, depth?: number, sessionId?: string): Result<ExpandPayload> {
      const expander = deps.expander
      // 装配期缺失（宿主没接端口）→ 明确的 error；展开本身的失败（坏 ID / 越权 / 不存在 /
      // 跳数超限）走 data，因为码是结论，工具与模型都要看见（AC-11）。
      if (expander === undefined) {
        return { error: `记忆展开不可用：宿主未装配记忆目录（无法展开 ${id}）` }
      }
      try {
        // r22：把本次解析出的根交给 expander —— 与列表/注入/读写删同一份解析。
        return { data: expander(id, depth, resolvedMemoryLocation(sessionId).roots) }
      } catch (error) {
        // createExpander 按契约不抛；真抛了也不能连累工具调用链（AC-9）。
        return { error: `记忆展开失败：${error instanceof Error ? error.message : String(error)}` }
      }
    },
  }
}

/** `mutateMemory` 的成功回执：条目视图是本次新增/更新的那几条。 */
export interface MemoryMutationReceipt {
  ok: true
  entries: MemoryEntryView[]
  added: number
  updated: number
  revived: number
  superseded: number
  topics: MemoryTopicId[]
  evicted: MemoryEntryView[]
  notices: string[]
  changedFiles: string[]
}

export type MemoryMutationResult =
  | MemoryMutationReceipt
  | { ok: false; code: MemoryMutationCode | 'BAD_REQUEST'; message: string }

interface MemoryOverview {
  files: MemoryFileView[]
  entries: ParsedEntry[]
  quotas: { project: MemoryQuotaView; public: MemoryQuotaView }
  legacyFileCount: number
}

/** 整理报告的一行人类可读摘要（面板 notice 与工具返回值共用）。 */
function curateSummaryOf(report: { dryRun: boolean; track: MemoryTrack; scannedFiles: number; added: number; skippedExisting: number; skippedFull: number }): string {
  const phase = report.dryRun ? '预演' : '已写入'
  return `整理${phase}（${report.track}）：扫描 ${report.scannedFiles} 个旧文件，新增 ${report.added} 条，已存在 ${report.skippedExisting} 条，已满 ${report.skippedFull} 条`
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

/**
 * r33：快照任务行。`awaitingReceipt` 由宿主现算（要结合 silentFinish 事实），
 * 客户端只读不算 —— 否则每个客户端都要自己重推一遍「谁停了 / 有没有证据」。
 */
function panelTasksOf(state: RunState | null): PanelTaskView[] {
  return (state?.plan.tasks ?? []).map(panelTaskViewOf)
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
 * 任务状态 / 宿主成员状态 → 面板成员态（**唯一映射表**，watcher 复用，组件里禁止再写一份**）。
 * 宿主 4 态：running / inactive / provisioning / failed。
 *
 * r21 AC-4：`cancelled` / `stopped` / `stopping` / `waiting` 是新增的真实语义，
 * 不允许被 default 吞成 `idle`（"看不出任务停了"正是这条要修的 bug）。
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
    case 'cancelled':
      return 'cancelled'
    case 'stopped':
      return 'stopped'
    case 'stopping':
      return 'stopping'
    case 'waiting':
      return 'waiting'
    default:
      return 'idle'
  }
}

export { progressOf }
