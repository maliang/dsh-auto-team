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
  | 'gate'
  | 'done'
  | 'rework'
  | 'failed'
  /**
   * 成员进程已死但上下文仍在（AC-18）：既不是失败也不能冒充运行中，必须能被用户看见，
   * 且只允许通过 resume 动作恢复（不能自动重派，否则可能重复执行副作用）。
   */
  | 'interrupted'

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
 * 面板动作全集（11 个）。**HTTP `/act` 与模型可见的 `auto_team_*` 工具共用同一套语义**，
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
  | { type: 'saveRole'; role: Role }
  | { type: 'deleteRole'; roleId: string }

/**
 * 拒绝码（11 个）。每条都必须能落到一句「用户下一步该做什么」的文案（见 bridge.reasonText），
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

/** 一次动作的结果：无论成功失败都带可读快照（界面不会因为没有数据而白屏）。 */
export interface ActResult {
  snapshot: PanelSnapshot
  /** 成功时的人话提示（如「已派发 2 个任务」），面板提示条直接显示。 */
  notices?: string[]
  /** 被拒绝时同时给码与文案；码供断言，文案供界面。 */
  rejected?: { code: RejectionCode; message: string }
}

/* ───────────────────────────────── 通用返回包装 ───────────────────────────────── */

/**
 * 统一返回包装（AC-13：本项目历史高频 bug 族是「整包赋值导致界面点了没反应」）。
 *
 * 契约：**恰好一个**字段有值；client 侧只允许 `src/client/api.ts` 解一次包，
 * 组件里禁止再解第二遍。传输层永远是 200，业务失败放在 data.rejected 里。
 */
export type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: string }
