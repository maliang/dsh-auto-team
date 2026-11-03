/**
 * host 半与 client 半**共享的纯类型**（本文件不含任何运行时代码、不做任何宿主调用）。
 *
 * 为什么全部集中在一个文件：两侧字段名一旦不一致，桥就会「返回了数据、界面读不到」——
 * 这是本项目的历史 bug 族（整包赋值 / 字段名漂移 / 状态枚举两套）。约定：
 *   1. 新增契约字段先落在本文件，两侧再按它实现；
 *   2. client 只允许 `import type`，不允许 import host 半的任何模块；
 *   3. 状态枚举只在这里定义一次（宿主 4 态 → 面板 7 态的映射在 host 侧唯一一处）。
 */

/** 任务状态（AC-30 的计划条目 / AC-18 的存活对账 / AC-19 的返工都会读它）。 */
export type TaskStatus =
  | 'pending'
  | 'blocked'
  | 'ready'
  | 'running'
  /**
   * 用户暂停（r7 AC-9）：原本 `ready`/`running` 的任务被冻结在此态。
   * 原状态不写进 `PlanTask`（AC-10 冻结字段集），统一记账在 `RunState.pause.tasks`（host/store.ts）；
   * 暂停期间不得派发、不得回执、不得因停滞被推进，恢复时按原状态还原。
   */
  | 'paused'
  | 'gate'
  | 'done'
  | 'rework'
  | 'failed'
  /**
   * 成员进程已死但上下文仍在（AC-18）：既不是失败也不能冒充运行中，必须能被用户看见，
   * 且只允许通过 resume 动作恢复（不能自动重派，否则可能重复执行副作用）。
   */
  | 'interrupted'
  /**
   * r11 AC-14：写域被别的 `running`/`gate` 任务占着，**开跑之前**就停在这里。
   *
   * 不 spawn 成员、不占 `maxConcurrent` 名额、不计入 running 数；`waitingOn`（持锁任务 id）
   * 与 `waitReason`（中文，宿主生成）说明在等谁、等哪条路径。
   */
  | 'waiting'
  /** r11 AC-15：用户取消（终态，立即释放写域，下游转 blocked）。 */
  | 'cancelled'
  /** r11 AC-26：用户跳过（终态，释放写域，且被下游视为「依赖已满足」）。 */
  | 'skipped'

/** 一次运行的总体状态。 */
export type PlanStatus = 'draft' | 'dispatching' | 'paused' | 'terminated' | 'cancelled'

/**
 * 面板成员 7 态（AC-18 的「状态必须可核验」）。
 *
 * interrupted 专指「成员上下文仍在、但当前轮被中断」——可续聊，不算失败。
 * 宿主实体只有 4 态（running / inactive / provisioning / failed），映射只在
 * `src/host/team/watcher.ts` 里做一次，组件里禁止再写映射表。
 */
export type MemberStatus =
  | 'running'
  | 'idle'
  | 'blocked'
  | 'rework'
  | 'done'
  | 'failed'
  | 'interrupted'

/**
 * 逐角色模型路由（AC-22）。provider/model 是**原样透传**的字面值，不做别名归一：
 * 面板展示必须与用户填写逐字一致，实际下发值另由 RouteAudit.actual 记录。
 */
export interface RoleModelRoute {
  provider: string
  model: string
  reasoningEffort?: 'low' | 'medium' | 'high'
}

/** 计划中的单个任务（依赖图的一个节点）。 */
export interface PlanTask {
  id: string
  title: string
  /** 执行该任务的角色 id（派发时据此创建成员）。 */
  roleId: string
  /** 必须先完成的任务 id（空数组 = 可立即派发）。 */
  dependsOn: string[]
  /** 验收命令；为空时门禁直接判失败并拒绝完成（AC-19）。 */
  acceptance: string
  status: TaskStatus
  /** 已创建的成员（派发后才有；与 bindings 的 memberId 一致）。 */
  memberId?: string
  /** 最近一次门禁证据（AC-19：命令、退出码、输出尾部、全量日志路径）。 */
  evidence?: GateEvidence
  /** 已返工次数（AC-19）：达到 MAX_ATTEMPTS 后转 failed 并需人工处理。 */
  attempts?: number
  /** 上一次 resume 的时间（AC-17 幂等去抖，见 RESUME_DEBOUNCE_MS）。 */
  lastResumeAt?: number
  /** 上一次 resume 时任务的状态（与 lastResumeAt 一起构成幂等判据）。 */
  lastResumeStatus?: TaskStatus
  /**
   * r11 AC-12：写域 —— 本任务预计改动的路径（文件或目录，相对仓库根）。
   *
   * 归一（去 `./`、折叠 `//`、去尾 `/`）由 `host/plan/scope.ts` 单点做；空/缺省 = 不限，
   * 不参与互斥。两个任务的写域相同或互为目录边界时互斥（AC-13）。
   */
  writeScopes?: string[]
  /** r11 AC-14：正在等哪些任务的写域（必须全部指向 `running`/`gate` 的任务，AC-17）。 */
  waitingOn?: string[]
  /** r11 AC-14：等待原因（中文，**宿主生成**，面板原样渲染：「等待 t2 释放 src/host/bridge.ts」）。 */
  waitReason?: string
}

/** 写域占用里的一条等待者（r11 AC-19/AC-20；`reason` 同样由宿主生成，客户端零拼装）。 */
export interface ScopeLockWaiterView {
  taskId: string
  /** 等待者已派出的成员名（没有成员时缺省）。 */
  member?: string
  reason: string
}

/**
 * 写域占用的一条锁视图（r11 AC-19）：谁占着哪条路径、谁在等它。
 *
 * **不落盘**（AC-16）：每次快照按 `plan.tasks` 的 `status + writeScopes` 现算，
 * 因此重启、换 store 实例、从磁盘读回旧 run 之后等待关系都自动重建。
 */
export interface ScopeLockView {
  path: string
  holderTaskId: string
  /** 持锁任务的成员名（未派出时缺省）。 */
  holderMember?: string
  /** 同一路径上的多个等待者合并在这一条里（不重复渲染路径行）。 */
  waiters: ScopeLockWaiterView[]
}

/** 队长亲手写文件的留痕（r11 AC-23/AC-24）：60 秒内同一键合并成一条并累加 `count`。 */
export interface DeviationView {
  /** 记录时刻（毫秒）。 */
  at: number
  sessionId: string
  /** 工具名（`write` / `edit`，可带命名空间前缀）。 */
  toolName: string
  /** 归一后的路径集合。 */
  paths: string[]
  /** 中文原因（宿主生成，面板原文渲染）。 */
  reason: string
  /** 合并次数（≥1；面板显示 `×N`）。 */
  count: number
}

/** 一份计划（落盘时包在 RunState 里，见 src/host/store.ts）。 */
export interface Plan {
  runId: string
  sessionId: string
  createdAt: number
  status: PlanStatus
  tasks: PlanTask[]
  maxConcurrent: number
}

/** 角色（内置 + 用户自建，持久化在 roles.json）。 */
export interface Role {
  id: string
  name: string
  /** 职责描述，作为成员提示词的一部分。 */
  duty: string
  /** 引用的技能 id（内置技能种子在 src/host/roles/builtin.ts）。 */
  skillIds: string[]
  /** 该角色的模型路由；缺省 = 跟随会话默认（不静默回退到队长模型，AC-22）。 */
  model?: RoleModelRoute
  /** 内置角色（可改可删前需用户确认；seed 幂等依赖它）。 */
  builtin: boolean
  updatedAt: number
  /**
   * 角色提示词（r7 AC-7）：用户可编辑的一段中文职责补充，会整段进成员提示词。
   * 缺省 = 该角色只有技能正文（内置角色都带默认提示词，见 host/roles/builtin.ts）。
   */
  prompt?: string
}

/**
 * 技能来源（r10 AC-19）。**谁写的**决定界面上给哪个动作：
 * - `builtin`：出厂内置（可改、可恢复出厂，**不可删**）；
 * - `imported`：用户从本地 md 导入；
 * - `system`：从宿主系统技能库（`~/.agents/skills`）选入的副本；
 * - `manual`：在面板/设置页手写新建。
 */
export type SkillSource = 'builtin' | 'imported' | 'system' | 'manual'

/**
 * 技能的只读投影（r7 设置页的角色编辑区要给技能打勾；r10 起还要显示来源与「已修改」）。
 * 正文**不投影**：面板只显示 id/标题/说明，避免把上千字的技能正文塞进每 2s 一帧的快照。
 */
export interface SkillInfo {
  id: string
  title: string
  description: string
  /** r10：四个来源之一（决定内置不可删、以及是否给「恢复出厂」）。 */
  source: SkillSource
  /** r10：内置技能正文被用户改过（正文 sha256 与出厂不同，宿主现算，不落盘）。 */
  modified: boolean
}

/**
 * 技能写入载荷（r10 AC-19）：`saveRole` 动作里随角色一起上送，**不新开动作**。
 *
 * 三个来源的差异都在宿主侧（`roles/skills-repo.ts`）收敛：
 * - 内置技能：`id` 必须是出厂 id，正文写进用户覆盖层；
 * - 系统技能：客户端不知道正文（清单只下发 name/description），带 `systemName` 由宿主现读盘；
 * - 导入/手写：正文随载荷上来。
 */
export interface SkillDraft {
  /** 缺省 = 新建（宿主按标题派生 id）；给值 = 更新该 id。 */
  id?: string
  title: string
  description: string
  body: string
  source: SkillSource
  /** 仅 `source === 'system'` 有意义：宿主系统技能库里的目录名（正文由宿主读盘）。 */
  systemName?: string
}

/** 技能变更指令（r10）：一次 `saveRole` 可携带多条，宿主按顺序执行并汇总 notice。 */
export type SkillMutation =
  | { op: 'save'; skill: SkillDraft }
  | { op: 'delete'; id: string }
  | { op: 'restoreBuiltin'; id: string }

/** 模型清单里的一项（r10 AC-16 弹层选择器的一行）。 */
export interface ModelOption {
  provider: string
  providerName: string
  model: string
  modelName: string
}

/**
 * 宿主模型清单的投影（r10 AC-16）。
 *
 * `status` 三态是刻意的：`empty` 必须是**可读的降级**（带 `reason`），
 * 不能让「宿主没这个服务」与「还没取到」在界面上长得一样。
 */
export interface ModelCatalogView {
  status: 'loading' | 'ready' | 'empty'
  options: ModelOption[]
  reason?: string
}

/** 系统技能库的一条投影（r10 AC-19）：正文不上送，选入时宿主按 name 现读盘。 */
export interface SystemSkillInfo {
  name: string
  description: string
}

/**
 * 自动团队的可配参数（r7 AC-11/AC-13）：落盘在 `<dataRoot>/settings.json`，
 * 面板设置页改、宿主 5 个消费点读。**每项都是可选缺席 + 缺省值取 host/config.ts 的常量**，
 * 所以「没有 settings.json」与「settings.json 少写一项」必须等价。
 */
export interface AutoTeamSettings {
  /** 并发上限（1..8）。 */
  concurrencyLimit: number
  /** 记忆注入预算（字符，200..4000）。 */
  memoryBudget: number
  /** 成员停滞判定阈值（毫秒，1000..600000）。 */
  stallMs: number
  /** 单任务返工上限（1..10）。 */
  maxAttempts: number
  /** 门禁命令超时（毫秒，1000..600000）。 */
  gateTimeoutMs: number
  /** 队长默认模型（缺省 = 跟随会话默认）；settings.json 是唯一写入点。 */
  captainModel?: RoleModelRoute
}

/** 面板上的成员行（由 RunState.bindings × Plan.tasks 组装，见 bridge.membersOf）。 */
export interface MemberView {
  memberId: string
  name: string
  roleId: string
  /** 该成员正在执行的任务（无绑定任务的成员没有此字段）。 */
  taskId?: string
  status: MemberStatus
  /** 最近一次活动时间（消息 / 证据 / 派发时间取最大），用于「多久没动静」。 */
  lastEventAt: number
  /**
   * 角色声明的模型路由文本（**逐字**：`provider/model #effort` 或「会话默认」）。
   * 实际生效值与它的差异见 RouteAudit / formatModelRoute。
   */
  modelRoute: string
  /** 失败 / 中断后可续聊（done 的成员不需要再 resume）。 */
  canResume: boolean
  /**
   * 是否停滞（活着但长时间没有实质工具调用）。
   * 只有 `running` 的成员可能为 true：终态成员本来就不再产出，判停滞只会制造假告警。
   */
  stalled: boolean
  /**
   * 已停滞的毫秒数（由宿主 `stall.stallOf` 在快照时刻算好，未停滞恒 0）。
   * 客户端**只渲染不比较**：任何阈值比较出现在 client 都意味着两套判定会分叉。
   */
  stalledForMs: number
  /** 已停滞时长的展示文案（如「92 秒」/「20 分 34 秒」）；未停滞为空串。客户端零格式化。 */
  stalledSecondsText: string
}

/**
 * 成员推进记录（`RunState.progress` 的值，key = memberId）。
 *
 * `at` = 最近一次**实质工具调用**的时间戳；`alertedAt` = 本停滞 episode 的告警时间
 * （存在即表示「这一轮已经告警过」，是「一次 episode 恰好一条告警」的幂等键）。
 * 放在 shared 而不是 store：`team/stall.ts` 是纯逻辑模块，不能 import 非纯的 store。
 */
export interface ProgressRecord {
  at: number
  alertedAt?: number
}

/** 记忆双轨（AC-24）：公共轨跨会话共享，项目轨跟随当前工作目录。 */
export type MemoryTrack = 'public' | 'project'

/** 记忆文件条目（面板记忆页列表用）。 */
export interface MemoryFileInfo {
  track: MemoryTrack
  name: string
  chars: number
  updatedAt: number
  /** r13：文件创建时间（取不到就不给，界面显示「—」，不拿 updatedAt 冒充）。 */
  createdAt?: number
  /** r13：token 估算值（`ceil(chars/2)`，见 host/format.ts 的 `memoryTokenEstimate`）。 */
  tokenEstimate?: number
  /** r13：估算口径标记 —— 有值即表示这是**估算**，界面必须带 `≈` 前缀。 */
  tokenBasis?: 'estimate'
}

/** 门禁证据（AC-19）：命令行退出码 + 输出尾部 + 全量日志路径，三者都要可核验。 */
export interface GateEvidence {
  taskId: string
  command: string
  /** 退出码；null = 超时 / 被信号杀掉（与「命令返回非 0」必须区分）。 */
  exitCode: number | null
  /** 输出尾部（默认 GATE_TAIL_CHARS 字符），面板证据抽屉直接显示。 */
  tail: string
  /**
   * 全量日志落盘路径（artifacts/ 下，可能多份：命令日志 + 产物文件）。
   * 空数组 = 没有落盘（例如 acceptance 为空、根本没执行命令）。
   */
  artifacts: string[]
  at: number
}

/* ─────────────────────────── 运行账本（RunState v2 的组成部分） ─────────────────────────── */

/**
 * 一条直达消息（AC-16）：`from / to / taskId / at` 四项必须可核验。
 *
 * 落盘在 RunState.messages（上限 200 条，超出丢最旧），恢复运行后仍可回看。
 * `from` 用普通 string：队长固定 'captain'，成员侧为成员名——成员名是运行期拼出来的，
 * 若收窄成 'captain'|'member' 反而会丢信息（bridge 的账本入口也按 string 传递）。
 */
export interface MessageRecord {
  at: number
  /** 发送方：队长固定 'captain'；成员侧为成员名。 */
  from: string
  /** 展示用接收方：成员名，或 'captain'。 */
  to: string
  /** 接收方 memberId（宿主侧寻址用；发给队长时缺省）。 */
  toMemberId?: string
  /** 该消息属于哪个任务（AC-16 按任务可检索）。 */
  taskId?: string
  body: string
  /** 账本内唯一 id（`msg-<at>-<seq>`），便于核对与去重。 */
  messageId?: string
}

/**
 * 任务 → 成员的绑定（AC-17 恢复幂等的唯一判据）。
 *
 * `name` 是**确定性**成员名（`${roleId}-${taskId}` normalize 后），所以「同一任务重复派发」
 * 能靠名字 + bindings 判断出「已经起过人」，不会重复建成员。
 */
export interface MemberBinding {
  taskId: string
  roleId: string
  memberId: string
  name: string
  spawnedAt: number
  /** 成员已退出（被 interrupted / done 后释放），绑定保留以便续聊与审计。 */
  retired?: boolean
}

/**
 * 逐角色模型的路由审计（AC-22）。
 *
 * 宿主 `spawnTeammate` 目前没有 `model` 字段（限制 L1），因此本项目的诚实口径是：
 *   - 派发前 preflightRoutes 预校验，解析不到就**拒绝派发**；
 *   - 派发后记录实际值（能拿到时），与声明不一致记 `drift`；拿不到实际值记 `unverified`；
 *   - 面板对 unverified 显式标「未下发」，**绝不假装生效、也绝不静默回退队长模型**。
 */
export interface RouteAudit {
  taskId: string
  roleId: string
  /** 角色声明的路由；null = 跟随会话默认（此时不存在漂移问题）。 */
  declared: RoleModelRoute | null
  /** 实际生效的路由；宿主未回传时为 null / 缺省（verdict 应为 unverified）。 */
  actual?: RoleModelRoute | null
  at: number
  verdict: 'ok' | 'drift' | 'unverified'
}

/** 并发三元组（AC-15）：上限、运行中、来源必须同时可见（QA 可断言 running ≤ limit）。 */
export interface ConcurrencyView {
  limit: number
  running: number
  /** host = 宿主给出了并发上限；default = 用插件默认值（MAX_CONCURRENT_LIMIT）。 */
  source: 'host' | 'default'
  /**
   * 用户在设置里填的上限（R2 修正：QA-R7-03）。
   *
   * 设置是**天花板**而不是命令：宿主只肯给 3 个时填 6 不会提升并发。界面上必须能看出
   * 「填了 6、实际生效 3」，否则用户只会看到数字跟填的不一样而没有任何解释。
   */
  requested: number
  /** true = `requested` 被更小的上限（宿主或计划）夹住了，`limit` 才是实际生效值。 */
  clamped: boolean
}

/* ───────────────────── r13 视图类型（宿主装配，客户端只渲染、零格式化） ───────────────────── */

/**
 * token 合计（AC-3/AC-19）：`total` 必给，`input/output` 只在来源真的分项时才给。
 *
 * `total: 0` 是**合法值**（provider 明确说这次没花钱），与「不可得」必须靠
 * {@link UsageCell.source} 区分 —— 用 `0` 冒充不可得、或用估算填 0 都是造假。
 */
export interface TokenTotals {
  input?: number
  output?: number
  total: number
}

/** 用量来源（AC-19 三态归一后的两种可交付形态）：`provider` 有值，`unavailable` 无值。 */
export type UsageSource = 'provider' | 'unavailable'

/**
 * 一个用量单元格（任务行 / 流转节点 / run 头共用同一形状）。
 *
 * `text` 是**宿主生成**的展示文本（`format.ts` 的 `usageCellOf`），客户端只许读不许拼：
 * 千分位、`不可得` 这些文案一旦在客户端再实现一遍，就会与宿主出现第二套口径
 * （r13 的历史教训：`tokenTextOf` 曾逐字镜像 `groupDigits`，行为对但多一处实现）。
 *
 * 字段是可选的：旧 run 的落盘数据与旧快照没有它，客户端退化为按 `source` 显示。
 * `source==='unavailable'` 时 `tokens` 必须缺省、`reason` 给一句人话
 * （面板据此显示「不可得」+ title 解释）。
 */
export interface UsageCell {
  tokens?: TokenTotals
  source: UsageSource
  reason?: string
  /** 宿主生成的展示文本（`1,234` / `不可得`）；缺省表示旧数据，客户端自行降级。 */
  text?: string
}

/** 用时状态（AC-20）：未开始 / 进行中 / 已结束 / 不可得，四态互斥。 */
export type DurationState = 'done' | 'running' | 'not-started' | 'unavailable'

/** 一个用时单元格：`text` 由宿主 `formatDuration` 生成（AC-7 要求客户端零拼接）。 */
export interface DurationCell {
  startAt?: number
  endAt?: number
  ms?: number
  text: string
  state: DurationState
}

/** run 头的角色条：该角色在本 run 里承担几个任务、合计多少 token。 */
export interface RoleUsageView {
  roleId: string
  name: string
  tasks: number
  usage: UsageCell
}

/** 任务表一行（右栏任务页与左栏项目页**共用**这一份形状，AC-18 的 deep equal 靠它）。 */
export interface TaskDetailView {
  id: string
  title: string
  roleId: string
  roleName: string
  status: TaskStatus
  dependsOn: string[]
  acceptance: string
  writeScopes?: string[]
  evidence?: GateEvidence
  usage: UsageCell
  duration: DurationCell
  /** 返工次数（缺省 = 0 次，界面不显示 0）。 */
  attempts?: number
  /** 写域等待原因（宿主生成的人话；缺省 = 没在等）。 */
  waitReason?: string
  /** 该任务名下的直达消息条数（面板「消息」徽标用）。 */
  messageCount: number
}

/** 流转图的一个节点（纯展示坐标，客户端不自算布局以外的东西）。 */
export interface FlowNodeView {
  id: string
  title: string
  status: TaskStatus
  /** 列 = 依赖深度（0 起）；行 = 同列内序号。 */
  column: number
  row: number
  usage: UsageCell
  duration: DurationCell
}

/** 流转图的一条边：`upstreamDone` 决定它画实线还是虚线（下游为什么还没动）。 */
export interface FlowEdgeView {
  from: string
  to: string
  upstreamDone: boolean
}

export interface FlowView {
  nodes: FlowNodeView[]
  edges: FlowEdgeView[]
  columns: number
  rows: number
}

/** 未决确认的视图（AC-13）：`waitedText` 每次快照重算，不落盘 TTL。 */
export interface PendingConfirmationView {
  id: string
  /** 动作名（`cancel`/`cancelTask`/…，界面翻成动词短语，不用「确定」）。 */
  action: string
  taskId?: string
  runId: string
  createdAt: number
  /** 影响面一句话（宿主 `confirmSummaryOf` 生成，逐字）。 */
  summary: string
  irreversible: true
  /** 「已等待 N 分」的文本（宿主格式化，客户端不拼）。 */
  waitedText: string
}

/** 一个 run 的完整详情：**右栏任务页与左栏项目页的唯一数据形状**（AC-18）。 */
export interface RunDetailView {
  runId: string
  sessionId: string
  project?: string
  planStatus: PlanStatus
  plannedAt?: number
  finishedAt?: number
  usage: UsageCell
  duration: DurationCell
  roles: RoleUsageView[]
  tasks: TaskDetailView[]
  flow: FlowView
  pendingConfirmation?: PendingConfirmationView
}

/** 记忆索引一条（左栏项目记忆与右栏记忆页共用；token 是**估算**，必须带 ≈）。 */
export interface MemoryItemView {
  track: MemoryTrack
  name: string
  title: string
  createdAt?: number
  updatedAt: number
  tokenEstimate: number
  tokenBasis: 'estimate'
}

/** 项目里最近一个 run 的一行（左栏项目页「最近运行」用，不展开任务）。 */
export interface ProjectRunSummaryView {
  runId: string
  planStatus: PlanStatus
  plannedAt?: number
  finishedAt?: number
  tasks: number
  done: number
  usage: UsageCell
  duration: DurationCell
}

/** 左栏项目列表的一项：该项目最近 run 聚合 + 记忆索引。 */
export interface ProjectView {
  id: string
  name: string
  path?: string
  /** true = 没有 `project` 字段的历史 run 聚成的「未知项目」（固定末位）。 */
  unknown?: boolean
  runs: number
  usage: UsageCell
  lastActiveAt?: number
  recentRuns: ProjectRunSummaryView[]
  memories: MemoryItemView[]
}

/** 左栏整页数据（`GET /library` 的载荷；带 `runId` 时 `detail` 为该 run 的详情）。 */
export interface LibraryView {
  projects: ProjectView[]
  global: { memories: MemoryItemView[] }
  currentProject?: string
  /** 历史页用的 run 列表（`HISTORY_PAGE_SIZE` 条，createdAt 倒序）。 */
  runs?: RunSummary[]
  /** 历史详情（`?runId=` 时才有；AC-22 靠它避免新增第 5 条路由）。 */
  detail?: RunDetailView
}

/**
 * 运行列表的一行（面板/恢复入口/左栏历史用，不含消息账本等大字段）。
 *
 * 放 shared 而不是 store：`LibraryView.runs` 是共享契约，而 client 不允许 import host。
 * store.ts 只做 `export type { RunSummary }`，定义单点仍在 shared。
 */
export interface RunSummary {
  runId: string
  sessionId: string
  createdAt: number
  status: PlanStatus
  tasks: number
  done: number
  /** r13：项目（工作区路径的 basename）；旧 run 缺失 = 「未知项目」。 */
  project?: string
  /** r13：计划写入时间（AC-30 证据）。 */
  plannedAt?: number
  /** r13：进入终态的时间；进行中缺省。 */
  finishedAt?: number
  /** r13：run 合计用量（`aggregation` 三态见 UsageCell）。 */
  usageTotals?: TokenTotals
  /** r13：是否还有非终态任务（左栏「活跃」标记）。 */
  active?: boolean
}

/* ─────────────────────────────── 面板快照（HTTP / 工具共用） ─────────────────────────────── */

/** 面板快照：`GET {BRIDGE_ROUTE}/snapshot` 的载荷，也是每个动作返回的同一份形状。 */
export interface PanelSnapshot {
  /** 本会话是否已启用（AC-12：默认关，按会话持久化）。 */
  enabled: boolean
  runId?: string
  planStatus?: PlanStatus
  /** 计划条目写入时间（AC-30 证据）：必须早于首个成员的 spawnedAt。 */
  plannedAt?: number
  tasks: PlanTask[]
  members: MemberView[]
  /** 直达消息账本（AC-16），最多 200 条。 */
  messages: MessageRecord[]
  /** 逐角色模型审计（AC-22），按时间升序。 */
  routeAudits: RouteAudit[]
  concurrency: ConcurrencyView
  memory: {
    /** 按预算挑出的注入字符数（AC-25：≤ budget）。 */
    injectedChars: number
    budget: number
    truncated: boolean
    files: MemoryFileInfo[]
    /**
     * 内联进上下文的记忆索引（AC-7）：每条带 `mem://<track>/<stem>` ID + 标题 + 首句。
     *
     * 与 `files` 的差别：`files` 是「哪些文件参与注入」，`inline` 是「各自压成了什么」。
     * 可选是为了让 T0 契约先行不必同时改 `bridge.ts`（T8 负责填），运行期 T8 之后恒有值；
     * 消费端必须把 `undefined` 当作「旧快照 / 未投影」而不是「没有记忆」。
     */
    inline?: MemoryInlineEntry[]
    /** 未内联但可按 ID 展开的条目（AC-8：`truncated` 的语义 = 本数组非空）。 */
    omitted?: MemoryInlineEntry[]
  }
  roles: Role[]
  activity: ActivityEvent[]
  /**
   * 队长模型投影（AC-2）：`value` + 三态来源必须同时可见，`unsupported` 不得伪装成 `configured`。
   *
   * 可选的同一条理由：字段由 T8 的集成层填充，T0 只落契约。
   */
  captainModel?: CaptainModelView
  /** AC-18：事件订阅不可用时为 true —— 面板必须看得见，不得静默降级。 */
  degraded?: boolean
  /** 降级原因（`degraded === true` 时给一句中文），面板直接显示。 */
  degradeReason?: string
  /** 最近 N 条 Trigger 记录（含 dropped），供「为什么推进 / 为什么没推进」排查。 */
  triggers?: TriggerRecord[]
  /** r7 AC-9：暂停中（面板页头「暂停/继续」的单一真值，不从任务状态反推）。 */
  paused?: boolean
  /** r7 AC-9：进入暂停的时刻（毫秒），未暂停时缺省。 */
  pausedAt?: number
  /** r7 AC-13：当前生效的可配参数（缺省值已合并，面板设置页直接显示）。 */
  settings?: AutoTeamSettings
  /** r7 AC-7：技能清单（角色编辑区给 skillIds 打勾用；r10 起带来源与「已修改」）。 */
  skills?: SkillInfo[]
  /** r10 AC-16：宿主模型清单投影（缺省 = 宿主没提供，按 empty+reason 显示）。 */
  modelCatalog?: ModelCatalogView
  /** r10 AC-19：本机系统技能库投影（缺省 = 没扫描或本机没有该库，界面给可读说明）。 */
  systemSkills?: SystemSkillInfo[]
  /**
   * r10 AC-18b：系统技能库**不可用/未装配**时的可读原因（`systemSkills` 为空且本字段在时显示它）。
   *
   * 为什么要单独一个字段：空数组本身分不清「扫了但没有」与「库不存在」——不给原因，
   * 用户看到的就是一个空列表外加零解释（验收 R2 的原始缺陷）。
   */
  systemSkillsReason?: string
  /**
   * r11 AC-19：写域占用（谁占着哪条路径、谁在等）。**空数组必给**（面板据此渲染 0 节点）。
   *
   * 声明为可选只是为了让旧快照缺省即空；`bridge.snapshot` 一律给数组。
   */
  scopeLocks?: ScopeLockView[]
  /** r11 AC-24：队长亲手写文件的最近留痕（新的在后），**空数组必给**。 */
  deviations?: DeviationView[]
  /** r13：未决确认（AC-13）。缺省 = 没有待确认动作，界面不渲染弹窗。 */
  pendingConfirmation?: PendingConfirmationView
  /** r13 AC-3/AC-19：run 合计用量（文本由宿主生成；`source` 区分 0 与不可得）。 */
  runUsage?: UsageCell
  /** r13 AC-20：run 用时（`plannedAt → finishedAt`，未结束取 now 且 `state='running'`）。 */
  runDuration?: DurationCell
  /** r13：本 run 所属项目（工作区 basename）；旧 run 缺失 = 「未知项目」。 */
  project?: string
  /** r13 AC-3：任务级用量（key = taskId；文本已在宿主格式化）。 */
  taskUsage?: Record<string, UsageCell>
  /** r13 AC-20：任务级用时（key = taskId）。 */
  taskDurations?: Record<string, DurationCell>
  /** r13 AC-21：历史 run 列表（`HISTORY_PAGE_SIZE` 条，createdAt 倒序）。 */
  runs?: RunSummary[]
}

/** 活动流事件（面板「活动」区；上限由 host 侧 ACTIVITY_LIMIT 控制）。 */
export interface ActivityEvent {
  at: number
  memberId?: string
  taskId?: string
  kind:
    | 'plan'
    | 'spawn'
    | 'message'
    | 'tool'
    | 'gate'
    | 'status'
    | 'interrupt'
    | 'route_drift'
    | 'rework'
  text: string
  /**
   * 这条活动是「自动推进产生」还是「用户动作产生」（AC-17：面板要能区分）。
   *
   * 缺省 = 历史事件，按用户动作对待（老数据没有来源，不能倒推成自动 —— 那会让面板
   * 把用户自己点出来的动作说成「系统自动推进」）。
   */
  source?: 'trigger' | 'user'
}

/* ───────────────────────── r5：队长分层 / Inline & Spill / Trigger 总线 ───────────────────────── */

/**
 * 队长模型投影（AC-2）：`value` 与三态来源必须同时可见。
 *
 * `unsupported` 是 fail-closed 出口：宿主能否给主 session 指定模型尚未验证时，
 * 面板必须显示「宿主不支持」而不是假装配置已生效（anti-goal 5：不假称）。
 */
export interface CaptainModelView {
  /** `provider/model #effort` 或 null（未配置）。 */
  value: string | null
  route: RoleModelRoute | null
  source: 'configured' | 'host-default' | 'unsupported'
  /** 一句中文说明（配置生效 / 未配置 / 宿主不支持），面板直接显示。 */
  note: string
}

/** Trigger 种类（AC-13）：**恰 4 个**，新增种类必须同时补归一化、Fast 层判据与面板文案。 */
export type TriggerKind = 'gate_failed' | 'member_exit' | 'dep_ready' | 'stall_timeout'

/** 来源：`event` = 宿主事件即时触发，`poll` = watcher tick 兜底（AC-18 的降级通路）。 */
export type TriggerSource = 'event' | 'poll'

/**
 * Fast 层原因码（AC-14）：**恰 7 个**，全部落在「事件类型 / 任务状态 / 门禁退出码 /
 * 成员存在性 / 去重窗口」这五类**程序判据**上 —— 这里出现任何一个需要语义理解才能判的码，
 * 就说明 Fast 层偷偷变成了模型调用（AC-14 的机械上限）。
 */
export type FastReason =
  /** 放行。 */
  | 'ok'
  /** 会话开关关闭。 */
  | 'not_enabled'
  /** 不属于四类监听集合。 */
  | 'not_listened'
  /** taskId / memberId 在当前 run 里找不到。 */
  | 'unknown_entity'
  /** 任务状态不允许该推进（如已 done 又收到 dep_ready）。 */
  | 'task_state'
  /** 门禁退出码为 0，不该报「失败」。 */
  | 'gate_exit_zero'
  /** 去重窗口内已推进过。 */
  | 'duplicate'

/** 一条 Trigger 的落盘记录：accepted / dropped 都留，否则「为什么没推进」无从排查。 */
export interface TriggerRecord {
  at: number
  kind: TriggerKind
  source: TriggerSource
  runId: string
  taskId?: string
  memberId?: string
  /** 去重键（`kind:runId:entityId`），与 `fastOf` 注入的窗口共同构成幂等。 */
  dedupeKey: string
  accepted: boolean
  reason: FastReason
  /** 中文可读原因（AC-17）：含短语 + 实体 id + 结果；未推进时写成「未推进：<为什么>」。 */
  text: string
  /** accepted 时实际调用的 action 类型（`dispatch` / `resume` / `message`…），未推进时缺省。 */
  action?: PanelAction['type']
  /** `bridge.act` 的拒绝码（并发已满等）：动作发出但被业务拒绝时记录。 */
  rejected?: RejectionCode
}

/** 内联索引条目（AC-7）：面板与测试都能看到「内联了哪几条、各自多长」。 */
export interface MemoryInlineEntry {
  /** `mem://<track>/<stem>`（由 `memoryIdOf` 单点生成）。 */
  id: string
  track: MemoryTrack
  name: string
  title: string
  /** 首句摘要（不是全文；全文走 expand）。 */
  summary: string
  /** ≥1 个关联 id（同轨相邻条目），供模型顺着展开下一层。 */
  related: string[]
  /** 该条内联文本长度（≤ `MEMORY_INLINE_ITEM_MAX`）。 */
  chars: number
}

/** 记忆展开结果码（AC-9/AC-10）：失败一律降级成码，**不抛异常**（工具调用面不能崩）。 */
export type ExpandCode =
  | 'OK'
  | 'EXPAND_BAD_ID'
  | 'EXPAND_PATH_ESCAPE'
  | 'EXPAND_NOT_FOUND'
  | 'EXPAND_DEPTH_EXCEEDED'

/** 按 ID 展开一条记忆的载荷（`auto_team_memory` 的 `expand` 动作返回它）。 */
export interface ExpandPayload {
  code: ExpandCode
  id: string
  track: MemoryTrack | null
  name: string | null
  /** `code === 'OK'` 时是正文；超 `MEMORY_EXPAND_MAX_CHARS` 截断并置 `truncated`。 */
  body: string
  chars: number
  truncated: boolean
  /** 本次展开的跳数（1 起）。 */
  depth: number
  related: string[]
  /** 每个码一句可读中文（面板/工具结果直接显示）。 */
  message: string
}

/* ───────────────────────────────── 动作与结果 ───────────────────────────────── */

/**
 * 面板动作全集（18 个）。**HTTP `/act` 与模型可见的 `auto_team_*` 工具共用同一套语义**，
 * 两条入口都走 `bridge.act`，不允许各写一套分支（历史高频缺陷：工具能用、面板不能用）。
 */
export type PanelAction =
  /** 只改开关，绝不派发（反面目标 1：打开开关不该自动起人）。 */
  | { type: 'toggle'; enabled: boolean }
  /**
   * 派发就绪任务。`runId` 可选：面板从快照里带（防止对着过期计划派发）；
   * 模型工具 `auto_team_dispatch` 强制必填——这是 AC-30「先计划、后派发」的机械保证。
   */
  | { type: 'dispatch'; runId?: string }
  | { type: 'cancel' }
  /** 派发前替换某任务的角色（AC-14）；派发后拒绝。 */
  | { type: 'setTaskRole'; taskId: string; roleId: string }
  /** 直达消息：按 memberId 或 taskId 定位成员（AC-16）。 */
  | { type: 'message'; memberId?: string; taskId?: string; text: string }
  /**
   * 续聊被中断的成员（AC-17）：可按 taskId 或 memberId 定位（面板成员行用 memberId）。
   * 两者都缺省 = 恢复所有需要恢复的任务（幂等：窗口内重复调用必须 resumed=0）。
   */
  | { type: 'resume'; taskId?: string; memberId?: string }
  /** 成员自述完成 → 跑门禁 → 判定（AC-19）；note 写入证据说明。 */
  | { type: 'receipt'; taskId: string; note?: string }
  | { type: 'saveMemory'; track: MemoryTrack; name: string; body: string }
  | { type: 'deleteMemory'; track: MemoryTrack; name: string }
  /**
   * r10 AC-19：`role` 与 `skills` 至少给一个 —— 技能变更随角色保存一起上送，
   * 所以动作数仍是 15 条（不新开 `saveSkills`），客户端只有一条写路径。
   */
  | { type: 'saveRole'; role?: Role; skills?: SkillMutation[] }
  | { type: 'deleteRole'; roleId: string }
  /** r7 AC-9：暂停推进（只掐派发/回执/停滞判定，不打断在跑成员、不清门禁证据）。 */
  | { type: 'pause' }
  /** r7 AC-9：恢复推进，按 `RunState.pause` 记录的原状态还原任务。 */
  | { type: 'resumeTeam' }
  /** r7 AC-8：一键恢复默认角色（只重写内置 6 个，自建角色不动）。 */
  | { type: 'restoreDefaultRoles' }
  /** r7 AC-13：保存可配参数（`unknown`：校验在 host/settings.ts 单点做，非法即整份拒绝）。 */
  | { type: 'saveSettings'; settings: unknown }
  /**
   * r11 AC-25/AC-26：单任务取消（终态 → `cancelled`，running 时连带中断成员，释放写域）。
   * 允许集与拒绝文案的唯一来源是 `src/shared/task-actions.ts`。
   */
  | { type: 'cancelTask'; taskId: string; reason?: string }
  /** r11 AC-26：单任务跳过（终态 → `skipped`，其依赖视为满足，释放写域）。 */
  | { type: 'skipTask'; taskId: string }
  /** r11 AC-26：改验收命令（下次门禁生效；空串拒绝并回三条模板）。 */
  | { type: 'updateAcceptance'; taskId: string; acceptance: string }
  /**
   * r13 AC-13：确认一条待确认动作（`pendingId` 必须命中当前未决记录，否则 NOT_FOUND）。
   *
   * 确认后**复用同一个执行体**（`executeAction`），因此行为与直接调用完全一致 ——
   * 这里不复制分支，只多一道闸。
   */
  | { type: 'confirmPending'; pendingId: string }
  /** r13 AC-13：拒绝一条待确认动作（清空 pending，状态一字不改）。 */
  | { type: 'rejectPending'; pendingId: string }
  /**
   * r13 AC-11：强制并行（不可逆，需确认）。确认一次后记住该 `taskId`，
   * 复用同一任务的写域闸不再弹窗（`RunState.forceParallel`）。
   */
  | { type: 'forceParallel'; taskId: string }

/**
 * 拒绝码（12 个）。每条都必须能落到一句「用户下一步该做什么」的文案（见 bridge.reasonText），
 * 新增码要同时补文案与面板展示，否则界面会出现「点了没反应」。
 */
export type RejectionCode =
  | 'NOT_ENABLED'
  | 'NO_PLAN'
  | 'PLAN_ALREADY_DISPATCHED'
  | 'ROLE_UNAVAILABLE'
  | 'MODEL_UNRESOLVABLE'
  | 'ROUTE_DRIFT'
  | 'CONCURRENCY_FULL'
  | 'NOT_FOUND'
  | 'NO_CALLER'
  | 'BAD_REQUEST'
  /**
   * 成员名冲突：≥2 个任务名撞成同一个，本次不派发（R2-1 / AC-4）。
   *
   * 只作为 `errors[].code` 与 `ActResult.rejected.code` 出现，**不落盘** RunState；
   * bridge 的 `act('dispatch')` 已把 `errors[0].code` 原样透传成 `rejected.code`
   * （`reject(first.code ?? 'BAD_REQUEST')`），所以这里扩联合类型就够了 ——
   * 不要在 bridge 里为它加分支，那等于维护第二份码表。
   */
  | 'MEMBER_NAME_COLLISION'
  /**
   * r7 AC-10：当前处于暂停态，该动作被闸门拦截（`dispatch`/`resume`/`receipt` 一律拒绝）。
   * 语义是「先继续再做事」，所以面板必须把这条码翻成一句带「继续」的动作指引。
   */
  | 'PAUSED'
  /**
   * r13 AC-13：该动作不可逆，已被确认闸拦下（`ActResult.pendingId` 指向 `pendingConfirmation`）。
   *
   * 语义是「去面板点确认」，不是失败：面板必须把它翻成带确认入口的提示，
   * 工具面则把 `pendingId` 一并返回，让队长知道该等用户确认而不是反复重试。
   */
  | 'CONFIRM_REQUIRED'

/** 一次动作的结果：无论成功失败都带可读快照（界面不会因为没有数据而白屏）。 */
export interface ActResult {
  snapshot: PanelSnapshot
  /** 成功时的人话提示（如「已派发 2 个任务」），面板提示条直接显示。 */
  notices?: string[]
  /** 被拒绝时同时给码与文案；码供断言，文案供界面。 */
  rejected?: { code: RejectionCode; message: string }
  /** r13 AC-13：`rejected.code === 'CONFIRM_REQUIRED'` 时指向刚挂起的待确认记录。 */
  pendingId?: string
}

/* ───────────────────────────────── 通用返回包装 ───────────────────────────────── */

/**
 * 统一返回包装（AC-13：本项目历史高频 bug 族是「整包赋值导致界面点了没反应」）。
 *
 * 契约：**恰好一个**字段有值；client 侧只允许 `src/client/api.ts` 解一次包，
 * 组件里禁止再解第二遍。传输层永远是 200，业务失败放在 data.rejected 里。
 */
export type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: string }
