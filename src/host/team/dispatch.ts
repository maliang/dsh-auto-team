/**
 * 派发编排主干：**只在这里创建成员**。
 *
 * 四件事必须同时成立，否则「并行团队」就是假的：
 *  1. 并发切片：in-flight ≤ min(计划上限, 宿主上限, MAX_CONCURRENT_LIMIT)，多出来的任务
 *     不报错、只标记「并发已满」——报错会让队长以为计划坏了；
 *  2. 角色缺失**不派发**：猜一个角色比不派发更糟（成员会用错技能/错模型干活）；
 *  3. 幂等：已有 binding 且成员还活着 → 只发续跑消息，绝不重复建人（AC-17 的判据之一）；
 *  4. 成员名确定性（`roleId-taskId`）：宿主重启后 id→name 的内存表就没了，
 *     名字是唯一能重建「这条任务归谁」的键，所以它必须是可推导的，而不是随机数。
 *
 * 本文件纯依赖注入（store/spawn/roles/buildPrompt/listMembers 全由外部传入），
 * 因此不需要起宿主就能用 node --test 完全覆盖。
 */
import type { MemberBinding, Plan, PlanTask, RejectionCode, Role, RoleModelRoute } from '../../shared/types.ts'
import type { RunState } from '../store.ts'
import type { RunsStore } from '../store.ts'
import type { TaskTimeRecord } from '../store.ts'
import type { RoleRepo } from '../roles/repo.ts'
import type { HostMember } from '../adapters.ts'
import {
  DEFAULT_MAX_CONCURRENT,
  HOST_MEMBER_NAME_MAX,
  MAX_ATTEMPTS,
  MAX_CONCURRENT_LIMIT,
  RESUME_DEBOUNCE_MS,
} from '../config.ts'
import { depSatisfied, readyTasks } from '../plan/graph.ts'
import { waitReasonOf } from '../plan/scope.ts'
import { handoffBodiesFor, handoffMessages } from './handoff.ts'
import { appendMessage, makeMessage } from './messages.ts'
import { auditRoute, describeRouteOf, preflightRoutes, routeDrift, type RoutePort } from './route.ts'
import { applyScopeWaits, releaseScopes, waitFor } from './scope-locks.ts'

/** 创建成员的入参：名字是确定性的，路由是角色声明的（宿主可能不支持 model，见 L1）。 */
export interface SpawnInput {
  plan: Plan
  task: PlanTask
  role: Role | undefined
  /** 成员名（= memberNameFor(task)，同一任务反复重试也是同一个名字）。 */
  name: string
  prompt: string
  /**
   * 上游交接正文（AC-4b）：本任务的上游直投内容，原样进成员首条提示词。
   * 加在 `SpawnInput`（基类型）上而不是 `PromptInput` 上 —— `PromptInput` 是
   * `Omit<SpawnInput, 'prompt'>`，自动继承；反向重建类型层级只会多一处要维护的地方。
   */
  handoffs?: string[]
}

/** 提示词构造入参（不含 prompt 本身，prompt 由它产出）。 */
export type PromptInput = Omit<SpawnInput, 'prompt'>

export type SpawnPort = (
  input: SpawnInput,
) => Promise<
  | { ok: true; memberId: string; actual?: RoleModelRoute | null }
  | { ok: false; error: string }
>

export type SendPort = (memberId: string, text: string) => Promise<{ ok: boolean; error?: string; code?: RejectionCode }>

export interface DispatchDeps {
  store: RunsStore
  spawn: SpawnPort
  roles: RoleRepo
  /** 方法式声明（而非属性式）以便既有实现的窄参数签名仍可传入。 */
  buildPrompt(input: PromptInput): string
  listMembers(): Promise<HostMember[]>
  /** 可选：逐角色模型预校验端口（AC-22）；未提供时视为「不预校验」。 */
  routePort?: RoutePort
  /**
   * 可选：读某个成员会话**当前真实**的模型路由（r27）。宿主名单里的 memberId 就是会话 id。
   *
   * 未提供 = 旧装配：复用闸门不启用（读不到路由不能变成「永远不复用」）。
   */
  readSessionRoute?(sessionId: string): RoleModelRoute | undefined
  /** 可选：读当前队长会话的真实路由；未声明模型的角色以它为复用目标路由。 */
  readCallerRoute?(): RoleModelRoute | undefined
  /** 可选：续跑/返工消息发送端口；未提供时只记账不发消息。 */
  sendMessage?: SendPort
  /** 可选：宿主实际并发上限（缺省用 DEFAULT_MAX_CONCURRENT）。 */
  hostConcurrency?(): { limit: number; source: 'host' | 'default' }
  /**
   * 可选：成员名算法注入点（缺省即本文件的 `memberNameFor`）。
   *
   * 生产装配不传；测试注入一个「恒同名」的算法，验证同名任务会被确定性追加序号继续派发
   * （`dev-dup` / `dev-dup-2`），而不是停派（AC-4/AC-7）。
   */
  memberNameFor?: (task: PlanTask) => string
  now?(): number
}

export interface DispatchResult {
  state: RunState
  started: string[]
  skipped: { taskId: string; reason: RejectionCode | 'ALREADY_RUNNING' }[]
  errors: { taskId: string; error: string; code?: RejectionCode }[]
  /** 本轮真消歧的任务（`suffix > 0` 且非沿用旧名）；bridge 把它转成用户可读 notice（AC-5）。 */
  renamed: RenameRecord[]
}

export interface ResumeDeps {
  store: RunsStore
  listMembers(): Promise<HostMember[]>
  sendMessage?: SendPort
  now?(): number
}

export interface ResumeResult {
  state: RunState
  resumed: number
  skipped: number
  unchanged: boolean
}

/** 可读段每段字符上限（只服务可读性，身份由哈希承担）。 */
const READABLE_MAX = 20

/** 消息账本里短任务标签的字符上限（含省略号；r28）。 */
const TASK_LABEL_MAX = 60

/** 身份短哈希位数（base36 末 6 位）。 */
const HASH_LEN = 6

/**
 * 可读段总预算 = 48(上限) - 6(哈希) - 1(连接符) = 41。
 *
 * 截断**只裁可读段，永不裁哈希** —— 否则两个 40 字长的 id 截断后会重新撞成同名（缺陷复发）。
 * 上限引用 `HOST_MEMBER_NAME_MAX` 字面量，不在本文件重写 48（config.ts 的注释要求同源）。
 */
const NAME_BUDGET = HOST_MEMBER_NAME_MAX - HASH_LEN - 1

/**
 * 归一化：**只用于可读段**，不承担身份编码。
 *
 * 宿主 `memberName()` 的硬契约是 lower-kebab（`HOST_MEMBER_NAME`，见 config.ts），而
 * `roleId` / `taskId` 是模型自填的（`Login_Flow`、`t 1`、`重构-登录` 都可能出现），
 * 所以可读段必须折叠成 `[a-z0-9-]`：大写折小写、非字符连续段折单个 `-`、去掉首尾 `-`。
 */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, READABLE_MAX)
    .replace(/-+$/g, '')
}

/**
 * 身份短哈希：FNV-1a 32 位 → base36 末 `len` 位。
 *
 * 输入是**原始**（未归一、未截断）字符串，因此两个只差大小写/分隔符、或只差末尾若干字符的
 * id 也必然得到不同哈希 —— 这是「两个中文 id 归一后同为空」不再塌缩的全部原因。
 * 纯 `charCodeAt` + `Math.imul` 算术：无 locale、无 `Intl`、无 `crypto`、无随机/时间输入，
 * 跨进程跨平台确定（AC-3）。
 */
export function shortIdentityHash(raw: string, len: number = HASH_LEN): string {
  let h = 0x811c9dc5
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(len, '0').slice(-len)
}

/**
 * 成员名 = `<可读 role>-<可读 task>-<身份短哈希>`（可读段为空时用 `member` 兜底）。
 *
 * 确定性是 AC-17 的地基——同一 `(roleId, taskId)` 无论第几次派发、在哪个进程里都得到同一个名字，
 * 宿主重启后能靠它把任务重新绑回成员；签名与原实现一致，调用方零改动。
 *
 * 为什么**先编码身份段再归一化**（而不是旧实现的「整体归一化」）：`dev/登录流程` 与
 * `dev/注册接口` 归一后都是 `dev`，第二个就绪任务被宿主当成重名拒绝、永久 pending。
 * 身份段取原始串哈希，与可读段是否被截断无关，故名字两两不等（AC-1/AC-2）。
 *
 * 代价（如实记录）：纯中文 id 的可读段必然为空，名字形如 `dev-4k2m9a`，肉眼认不出是哪个任务；
 * 可读性由面板/消息里始终携带的 `taskId` + 标题承担，不靠名字自解释。
 */
export function memberNameFor(task: PlanTask): string {
  const hash = shortIdentityHash(`${task.roleId}\u0000${task.id}`)
  const head = [slugify(task.roleId), slugify(task.id)].filter((part) => part !== '').join('-')
  const base = head === '' ? 'member' : head
  // 截断后可能落在分隔符上（`dev-t1-xxxxx-`），结尾的 `-` 同样违约，二次归一。
  const trimmed = base.length > NAME_BUDGET ? base.slice(0, NAME_BUDGET).replace(/-+$/g, '') : base
  return `${trimmed === '' ? 'member' : trimmed}-${hash}`
}

/**
 * 消歧序号上限：`-2` … `-99`。
 *
 * 序号空间是「名字被占也照派」的最后一道兜底：全部耗尽才回退 `MEMBER_NAME_COLLISION`。
 * 上限取 99（而非更大）是为了让 `-99` 仍能把可读段预算留在 38 个字符（见 `withNameSuffix`）。
 */
export const NAME_SUFFIX_MAX = 99

/** 一次真实消歧的记录（AC-5 的 notice 数据源）。 */
export interface RenameRecord {
  taskId: string
  /** 原候选名（未消歧前算出的名字）。 */
  base: string
  /** 最终派发用的名字。 */
  final: string
}

/** 一个任务的名字分配结果（`suffix === null` 表示序号空间耗尽，不可派发）。 */
export interface NameAssignment {
  taskId: string
  base: string
  final: string
  /** 0 = 本名；≥2 = 消歧序号；null = 序号耗尽。 */
  suffix: number | null
  /** 沿用它自己未退役 binding 的名字（恢复/重试不递增）。 */
  reused: boolean
}

export interface AllocateOptions {
  /** 取名端口，缺省 `memberNameFor`（测试注入桩用）。 */
  nameOf?: (task: PlanTask) => string
  /** 未退役 binding：`{ taskId, name }`。同 taskId 的项视为「沿用」。 */
  reserved?: Array<{ taskId: string; name: string }>
  /** 宿主现存成员名（含没有 binding 的同名成员）；不可得时传 `[]`。 */
  hostNames?: string[]
  /** 序号上限，缺省 `NAME_SUFFIX_MAX`(99)；仅在穷尽性测试里调小。 */
  maxSuffix?: number
}

/**
 * 给 base 追加消歧序号，**只压可读段、逐字保留身份哈希**（AC-2）。
 *
 * 为什么不能简单 `base.slice(0, 48 - tail.length) + tail`：那会把 6 位身份哈希截掉一半，
 * 两个长 id 消歧后重新撞成同名 —— 正是 R2-1 缺陷的复发路径。哈希是唯一身份，永远不动。
 */
/** 身份哈希段的样子（`-<HASH_LEN 位 36 进制>`）：长度只在 `HASH_LEN` 一处定义，不许两处各自演化。 */
const HASH_TAIL = new RegExp(`-([a-z0-9]{${HASH_LEN}})$`)

export function withNameSuffix(base: string, suffix: number): string {
  if (!Number.isInteger(suffix) || suffix <= 0) return base
  const tail = `-${suffix}`
  if (base.length + tail.length <= HOST_MEMBER_NAME_MAX) return `${base}${tail}`

  const match = HASH_TAIL.exec(base)
  if (!match) {
    // 测试注入的桩名（如 `dev-dup`）没有哈希段：无可保留的身份信息，只能截可读段。
    return `${base.slice(0, HOST_MEMBER_NAME_MAX - tail.length).replace(/-+$/g, '')}${tail}`
  }
  const hash = match[1]
  const readable = base.slice(0, base.length - hash.length - 1)
  const budget = HOST_MEMBER_NAME_MAX - hash.length - 1 - tail.length
  if (budget <= 0) return `${hash}${tail}`
  // 截断后可能落在分隔符上（`dev-t1-xxxxx`），结尾的 `-` 违约，必须再归零一次。
  const trimmed = readable.slice(0, budget).replace(/-+$/g, '')
  // 可读段被压空时用 `member` 兜底，避免出现 `-abc123-2` 这种以分隔符开头的名字。
  const word = trimmed === '' ? 'member'.slice(0, budget) : trimmed
  return `${word}-${hash}${tail}`
}

/**
 * 一次性算完全计划任务的名字分配（AC-1/AC-3/AC-4）。
 *
 * **纯函数**：不读状态、不看 `ready` 顺序、无时间无随机 —— 输入集合相同则输出相同。
 * 这是「循环前一次算完」这条性质的落地形式：边派边算会让名字可用性取决于任务顺序，
 * 恢复后顺序一变，重绑就会翻倍（R2-1 已确立的反面教材）。
 *
 * 候选可用 ⇔ 未被占用 **且** 不是别的任务的本名（AC-4 不抢名）：
 * 只挑「第一个空号」的实现会把 `dev-2` 抢走，让本名就是 `dev-2` 的任务无处可去。
 */
export function allocateMemberNames(
  tasks: PlanTask[],
  options: AllocateOptions = {},
): Map<string, NameAssignment> {
  const nameOf = options.nameOf ?? memberNameFor
  const maxSuffix = options.maxSuffix ?? NAME_SUFFIX_MAX

  // 1. 本名：按 tasks 顺序，同 taskId 重复出现只算一次（防御，不让同一任务吃掉两个号）。
  const order: string[] = []
  const baseOf = new Map<string, string>()
  for (const task of tasks) {
    if (baseOf.has(task.id)) continue
    baseOf.set(task.id, nameOf(task))
    order.push(task.id)
  }

  // 2. 已占用集合：未退役 binding 名 ∪ 宿主现存成员名（名单不可得时退化为空，见下方名字分配处的取舍说明）。
  const bindingOfTask = new Map<string, string>()
  const taken = new Set<string>()
  for (const item of options.reserved ?? []) {
    bindingOfTask.set(item.taskId, item.name)
    taken.add(item.name)
  }
  for (const name of options.hostNames ?? []) taken.add(name)

  // 3. 本名归属表：用于「候选是不是别人本名」的判定。
  const byBase = new Map<string, string[]>()
  for (const taskId of order) {
    const base = baseOf.get(taskId) as string
    const owners = byBase.get(base)
    if (owners) owners.push(taskId)
    else byBase.set(base, [taskId])
  }

  // 4. 逐个任务分配：binding 沿用优先，其次 base，最后 `-2..-maxSuffix`。
  const result = new Map<string, NameAssignment>()
  for (const taskId of order) {
    const base = baseOf.get(taskId) as string
    const reuse = bindingOfTask.get(taskId)
    if (reuse !== undefined) {
      // 该名已在 taken 里；沿用它自己的名字绝不消耗新号，恢复/重试名字恒定（AC-3②）。
      result.set(taskId, { taskId, base, final: reuse, suffix: 0, reused: true })
      continue
    }

    const usable = (candidate: string): boolean => {
      if (taken.has(candidate)) return false
      if (candidate === base) return true
      const owners = byBase.get(candidate)
      return !owners || owners.every((owner) => owner === taskId)
    }

    let final: string | null = usable(base) ? base : null
    let suffix = 0
    if (final === null) {
      for (let n = 2; n <= maxSuffix; n += 1) {
        const candidate = withNameSuffix(base, n)
        if (!usable(candidate)) continue
        final = candidate
        suffix = n
        break
      }
    }

    if (final === null) {
      // 序号空间耗尽：如实报告，不静默留 pending（AC-6）。
      result.set(taskId, { taskId, base, final: base, suffix: null, reused: false })
      continue
    }
    taken.add(final)
    result.set(taskId, { taskId, base, final, suffix, reused: false })
  }
  return result
}

/** 在飞任务数：running + gate（gate 期间成员仍占着一个并发位）。 */
export function runningCount(tasks: PlanTask[]): number {
  return tasks.filter((task) => task.status === 'running' || task.status === 'gate').length
}

/* ------------------------------------------------------------------ *
 * t5 按角色复用成员
 *
 * 宿主 Team 的 `maxMembers` 是**终身**名额：已结束的成员仍然占位（错误原文形如
 * `Team member limit 8 reached`）。旧实现每个任务都 spawn 一个新成员，一个会话跑两轮
 * 就把名额耗光，之后 dispatch 全部失败在创建成员那一步。
 *
 * 现在同一会话内**同 roleId 优先复用空闲成员**：用直达消息续聊、把新任务卡发给它；
 * 只有角色首次使用（或没有可复用的空闲成员）才真的 spawn。绑定仍按 taskId 逐条记录
 * （面板 / 门禁 / 停止逻辑全部读 binding），停止与退休语义不变。
 * ------------------------------------------------------------------ */

/** 成员空闲的判据：它上一个任务已经收口 —— 这一轮不会再产出，可以被派新活。 */
const MEMBER_FREE_TASK_STATUSES: ReadonlySet<PlanTask['status']> = new Set<PlanTask['status']>([
  'done',
  'failed',
  'cancelled',
  'skipped',
])

/**
 * 宿主名单里**不能**再派活的状态。`inactive` 刻意不在里面：那是「这一轮跑完了」，
 * 续聊消息能把它唤醒（把 inactive 当死亡会让我们白白多建一个成员）。
 */
const NON_REUSABLE_MEMBER_STATUSES: ReadonlySet<string> = new Set([
  'failed',
  'stopped',
  'terminated',
  'provisioning',
  'stopping',
])

/** 一个可复用的候选成员：角色 + 空闲成员 + 它上一个任务的路由审计。 */
interface ReuseCandidate {
  roleId: string
  memberId: string
  name: string
  /** 上一个任务的路由审计；null = 那个任务没声明模型（spawn 侧只有声明了才审计）。 */
  audit: { declared: RoleModelRoute | null; actual: RoleModelRoute | null } | null
}

/** 一条 binding 是否允许复用：未退休、不在停止过程中、且记着角色。 */
function reusableBinding(binding: MemberBinding): boolean {
  return binding.retired !== true && binding.stopping !== true && typeof binding.roleId === 'string' && binding.roleId !== ''
}

function auditOf(state: RunState, taskId: string): ReuseCandidate['audit'] {
  const audit = state.routeAudits.find((item) => item.taskId === taskId)
  if (!audit) return null
  return { declared: audit.declared ?? null, actual: audit.actual ?? null }
}

/**
 * 收集本次派发可复用的空闲成员：**当前 run** 已收口任务的绑定 + **同一会话其他已收口 run**
 * 的绑定。
 *
 * 跨 run 是必须的：每轮需求都是一个新 runId、`bindings` 从空开始，只扫本 run 等于没修
 * （「跑两轮就把名额用完」正是跨 run 的场景）。
 */
function collectReuseCandidates(state: RunState, store: RunsStore): ReuseCandidate[] {
  const out: ReuseCandidate[] = []
  const add = (run: RunState, binding: MemberBinding): void => {
    if (!reusableBinding(binding)) return
    const task = run.plan.tasks.find((item) => item.id === binding.taskId)
    if (!task || !MEMBER_FREE_TASK_STATUSES.has(task.status)) return
    out.push({
      roleId: binding.roleId,
      memberId: binding.memberId,
      name: binding.name,
      audit: auditOf(run, binding.taskId),
    })
  }

  for (const binding of state.bindings) add(state, binding)

  let summaries: ReturnType<RunsStore['list']>
  try {
    summaries = store.list()
  } catch {
    return out
  }
  for (const summary of summaries) {
    if (summary.runId === state.plan.runId || summary.sessionId !== state.plan.sessionId) continue
    // 只复用**已收口**的历史 run：还在跑/暂停的 run 恢复后仍要用自己的成员，
    // 两条 run 共用一个上下文会互相串任务（r21 修的正是「新旧两个 run 同时跑」）。
    if (summary.status !== 'terminated' && summary.status !== 'cancelled') continue
    const run = store.load(summary.runId)
    if (run === null) continue
    for (const binding of run.bindings) add(run, binding)
  }
  return out
}

/**
 * 复用前的路由一致性（AC-22 的「不静默换模型」同样适用于复用）。
 *
 * 判据：上个任务**声明**的路由必须与本次角色声明一致；若上个任务测到了**实际**路由，
 * 实际值也必须一致（漂移过的成员不能被派去跑新任务，否则 drift 就绕过了审计）。
 */
export function routeReusable(role: Role, audit: ReuseCandidate['audit']): boolean {
  const declared = role.model ?? null
  if (audit === null) return declared === null
  if (routeDrift(declared, audit.declared)) return false
  if (audit.actual !== null && routeDrift(declared, audit.actual)) return false
  return true
}

/**
 * 选一个可复用的空闲成员：同角色 + 宿主名单里没死 + 本次派发尚未占用 + 路由一致。
 *
 * 名单不可得（`members === null`）时调用方不应调用本函数 —— 宁可多建一个成员，也不把活
 * 派给一个可能已经死掉的上下文。
 */
function pickReuseCandidate(
  candidates: readonly ReuseCandidate[],
  role: Role,
  members: readonly HostMember[],
  claimed: ReadonlySet<string>,
  busy: ReadonlySet<string>,
): ReuseCandidate | null {
  for (const candidate of candidates) {
    if (candidate.roleId !== role.id) continue
    if (claimed.has(candidate.memberId)) continue
    // 成员可能一边挂着已收口任务的旧 binding、一边正在跑另一个任务（复用后就是这个形状）。
    if (busy.has(candidate.memberId)) continue
    if (!routeReusable(role, candidate.audit)) continue
    const member =
      members.find((item) => item.id === candidate.memberId) ??
      members.find((item) => item.name === candidate.name && item.name !== '')
    if (!member) continue
    const status = typeof member.status === 'string' ? member.status.toLowerCase() : ''
    if (NON_REUSABLE_MEMBER_STATUSES.has(status)) continue
    // 宿主名单里的 id/name 是权威值：binding 用的是它的 id，消息 target 用的是它的名字。
    const name = typeof member.name === 'string' && member.name !== '' ? member.name : candidate.name
    return { ...candidate, memberId: member.id, name }
  }
  return null
}

/**
 * 复用闸门的路由一致性判据（r27）。
 *
 * 只比较 provider/model（`reasoningEffort` 不参与：会话默认可能补上默认档位，但那不代表
 * 成员跑错了模型）。缺失语义：
 *  - 目标与成员两边都读不到 → 视为一致（旧宿主没有 `requestHeader.config`，不能因此永远不复用）；
 *  - 只有一边读得到 → 视为不一致（无法确认成员跑的就是本次目标路由，宁可新建成员）；
 *  - 两边都有但 provider 或 model 任一不同 → 不一致。
 */
export function routeAllowsReuse(
  target: RoleModelRoute | undefined,
  actual: RoleModelRoute | undefined,
): boolean {
  if (target === undefined && actual === undefined) return true
  if (target === undefined || actual === undefined) return false
  return target.provider === actual.provider && target.model === actual.model
}

/** 活动流里的路由文本：读不到写「不可得」，不拿空串假装一个模型。 */
function routeTextOf(route: RoleModelRoute | undefined): string {
  return route === undefined ? '不可得' : describeRouteOf(route)
}

/**
 * 复用成员时发出的「新任务卡」正文（t5）：只含本次任务，不再重复角色 / 技能 / 团队记忆
 * （那些已经在这个成员的上下文里），但上游交接必须带 —— 那是本任务新拿到的证据。
 */
export function taskCardText(task: PlanTask, role: Role | undefined, handoffs: readonly string[]): string {
  const lines = [
    `## 新任务（${task.id}）：${task.title}`,
    `角色：${role?.name ?? task.roleId}。你继续以同一角色工作；上一个任务已经结束，本次只执行下面这一张任务卡。`,
    task.dependsOn.length > 0 ? `前置任务（已完成）：${task.dependsOn.join('、')}` : '',
    '',
    ...(handoffs.length > 0
      ? ['## 上游交接', '以下内容由上游任务的门禁证据直接投递，不需要再问队长：', ...handoffs, '']
      : []),
    '## 验收判定（必须实际执行并回报退出码）',
    task.acceptance === '' ? '（未声明；视为需要人工确认，不得自称完成）' : `\`${task.acceptance}\``,
    '',
    `完成后按验收判定回报回执（taskId = ${task.id}）；回执只针对本次任务，不要把上一个任务的结论混进来。`,
  ]
  return lines.filter((line) => line !== '').join('\n')
}


/**
 * r29/r31：任务卡行号指针的软提示。spawn 与复用两条派发路径共用同一判据，避免只修一条。
 *
 * 只提示、不拦截；只在**首次派发**写一次。判据用 `state`（本次派发前的快照）：
 * 复用时 `next.bindings` 已经追加了当前任务的 binding，拿 `next` 判会把首次派发误判成返工。
 * 调用点负责把这条提示排在派发消息之后，并沿用同一个 `task.id` 归属。
 */
function appendMissingPointerHint(next: RunState, state: RunState, task: PlanTask, at: number): RunState {
  const dispatchedBefore =
    (task.attempts ?? 0) > 0 || state.bindings.some((item) => item.taskId === task.id)
  const cardText = `${task.title}\n${(task.writeScopes ?? []).join('\n')}`
  if (dispatchedBefore || hasLinePointer(cardText)) return next
  return appendMessage(
    next,
    makeMessage({
      from: 'captain',
      to: 'user',
      taskId: task.id,
      at,
      body: `任务 ${task.id} 的任务卡未给 path:line 指针，成员需自行搜索定位`,
    }),
  )
}

/** 派发：把 ready 的任务按空闲并发位创建成员。 */
export async function dispatchReady(state: RunState, deps: DispatchDeps): Promise<DispatchResult> {
  const now = deps.now ?? Date.now
  const started: string[] = []
  const skipped: DispatchResult['skipped'] = []
  const errors: DispatchResult['errors'] = []
  const renamed: RenameRecord[] = []
  let next = state
  let changed = false

  const planStatus = next.plan.status
  // r7 AC-9/AC-16：**暂停不是可派发状态**。除了 `bridge.act` 的 PAUSED 闸门，纯函数层也收窄 ——
  // 否则换一条推进路径（工具/Trigger）绕过 bridge 就能在暂停期间起人，闸门变成一处例外。
  if (planStatus !== 'draft' && planStatus !== 'dispatching') {
    // 已终止/取消/暂停的计划不再派发：明确拒绝，而不是静默什么都不做。
    for (const task of next.plan.tasks) {
      if (task.status === 'pending' || task.status === 'ready') skipped.push({ taskId: task.id, reason: 'NO_PLAN' })
    }
    return { state: next, started, skipped, errors, renamed }
  }

  // r13 AC-11：已获准「强制并行」的任务必须先从写域等待里放出来。
  //
  // 只绕过下面的 `waitFor` 不够：`waiting` 不在 `readyTasks` 的口径里（graph.ts:121），
  // 任务会停在 waiting 永远进不了派发循环。用户确认过的那条授权是持久授权（记在 run 上），
  // 所以这里按 `state.forceParallel` 直接把它放回待办 —— 除此之外仍走四道闸的其余三闸。
  const forced = new Set(next.forceParallel ?? [])
  const revived = reviveForcedWaits(next, forced)
  if (revived !== next) {
    next = revived
    changed = true
  }

  // r11 F4：先把等待关系按当前持锁情况重算一遍（幂等）。
  // 放在派发闸门**之后**：暂停/终止的计划不允许被改状态（恢复时按原状态还原，AC-10）。
  // 放在成员名单**之前**：等待判定只看 plan.tasks 的 status + writeScopes，与成员死活无关。
  const settledWaits = applyScopeWaits(next, now())
  if (settledWaits !== next) {
    next = settledWaits
    changed = true
  }

  // 成员名单：拿不到就**保守当作成员都还活着**，宁可少派一个，也不重复建人。
  let members: HostMember[] | null = null
  try {
    members = await deps.listMembers()
  } catch {
    members = null
  }

  const hostLimit = deps.hostConcurrency ? deps.hostConcurrency().limit : DEFAULT_MAX_CONCURRENT
  const planned = next.plan.maxConcurrent > 0 ? next.plan.maxConcurrent : DEFAULT_MAX_CONCURRENT
  const limit = Math.max(1, Math.min(planned, hostLimit, MAX_CONCURRENT_LIMIT))
  let slots = limit - runningCount(next.plan.tasks)

  // 可派发集合 = 「还没开始/返工中且依赖已过门禁」+ 「被对账标成 interrupted、依赖已过门禁」。
  //
  // 后半部分是 AC-17「恢复后能恢复运行」的唯一入口：resume 刻意**不新建**成员（防自动翻倍），
  // 宿主重启/成员被杀之后，interrupted 任务只有靠一次显式 dispatch 才能用同一个确定性名字重建成员。
  // 少了这一段，任务会永远停在 interrupted —— 既派不出去，也不会自己变回 running。
  const depsDone = (task: (typeof next.plan.tasks)[number]): boolean =>
    task.dependsOn.every((dep) => {
      const upstream = next.plan.tasks.find((item) => item.id === dep)
      return upstream !== undefined && depSatisfied(upstream.status)
    })
  const recoverable = next.plan.tasks
    .filter((task) => task.status === 'interrupted' && depsDone(task))
    .map((task) => task.id)
  const ready = [...new Set([...readyTasks(next.plan.tasks), ...recoverable])]
  if (ready.length === 0) {
    if (changed) deps.store.save(next)
    return { state: next, started, skipped, errors, renamed }
  }

  if (slots <= 0) {
    for (const taskId of ready) skipped.push({ taskId, reason: 'CONCURRENCY_FULL' })
    // 等待关系可能刚被重算过（waiting → pending），必须落盘，否则下一轮又要算一遍。
    if (changed) deps.store.save(next)
    return { state: next, started, skipped, errors, renamed }
  }

  // 派发前一次性算完全计划的名字分配（AC-1/AC-4）：名字被占就追加确定性序号继续派发。
  //
  // 必须在循环之前算完，不能在循环里边派边算：边派边算会让「谁先被派」决定谁撞名，
  // 于是名字的可用性取决于任务顺序（恢复后顺序可能变，重绑就会翻倍）。
  // 宿主名单不可得（listMembers 抛错）时 `hostNames` 退化为空：这里**刻意不做保守预留**。
  // 预留会让重试拿到新序号，破坏 AC-3 的名字恒定与恢复幂等；真撞名交给宿主 spawn 失败、以
  // `errors` 显式暴露（可观测，不会静默卡在 pending）。注意这与上方成员 liveness 的保守策略
  // 方向**相反**，是刻意取舍：那边宁可少派一个，这边宁可先按「没人占名」算。
  const nameOf = deps.memberNameFor ?? memberNameFor
  const reserved = next.bindings
    .filter((binding) => binding.retired !== true)
    .map((binding) => ({ taskId: binding.taskId, name: binding.name }))
  const hostNames = members === null ? [] : members.map((member) => member.name)
  const names = allocateMemberNames(next.plan.tasks, { nameOf, reserved, hostNames })

  // t5：可复用成员候选（同角色优先复用，见上方「按角色复用成员」）。名单不可得 → 不复用。
  const reuseCandidates = members === null ? [] : collectReuseCandidates(next, deps.store)
  const claimedMembers = new Set<string>()
  // 当前 run 里还被未收口任务占着的成员（复用后同一成员会挂多条 binding）。
  const busyMembers = new Set(
    next.bindings
      .filter((item) => {
        if (item.retired === true) return false
        const task = next.plan.tasks.find((candidate) => candidate.id === item.taskId)
        return task === undefined || !MEMBER_FREE_TASK_STATUSES.has(task.status)
      })
      .map((item) => item.memberId),
  )

  for (const taskId of ready) {
    const task = next.plan.tasks.find((item) => item.id === taskId)
    if (!task) continue

    // 依赖未过门禁（防御性二次校验）：置 blocked，且**不算一次派发尝试**。
    // skipped 视为依赖满足的口径只在 graph.depSatisfied 里判（AC-26），这里复用同一函数。
    const unfinished = task.dependsOn.filter((dep) => {
      const upstream = next.plan.tasks.find((item) => item.id === dep)
      return !upstream || !depSatisfied(upstream.status)
    })
    if (unfinished.length > 0) {
      next = patchTask(next, taskId, { status: 'blocked' })
      changed = true
      continue
    }

    // r11 AC-14：写域正被别人占着 → 先排队：不 spawn、**不扣并发位**、不计入 running。
    // 位置刻意在「依赖校验」之后、「并发位判定」之前：
    //  - 依赖没满足的任务该显示 blocked，不是 waiting（waiting 的语义是「轮到我了但文件被占」）；
    //  - 等待不是「并发满了」，面板要能回答「在等谁、等哪条路径」，所以必须先于 slots 判定。
    //
    // r13 AC-11：用户在确认弹窗里显式点过「强制并行」的 task 跳过这道闸（写入 `state.forceParallel`），
    // 否则确认完仍会停在 waiting —— 那等于弹窗点了没用。其余三闸照旧生效。
    const conflict = forced.has(taskId) ? null : waitFor(next, task, started)
    if (conflict) {
      next = patchTask(next, taskId, {
        status: 'waiting',
        waitingOn: [conflict.holderTaskId],
        waitReason: waitReasonOf(conflict.holderTaskId, conflict.path),
      })
      changed = true
      continue
    }

    if (slots <= 0) {
      skipped.push({ taskId, reason: 'CONCURRENCY_FULL' })
      continue
    }

    // 步 a：角色缺失 → 不派发、不猜角色，任务留在原地等用户配。
    const role = deps.roles.get(task.roleId)
    if (!role) {
      skipped.push({ taskId, reason: 'ROLE_UNAVAILABLE' })
      continue
    }

    // 步 b：已有 binding 且在飞成员还活着 → 只续跑，不重建（幂等）。
    const binding = liveBinding(next, taskId)
    if (binding) {
      const alive = members === null || members.some((member) => member.id === binding.memberId || member.name === binding.name)
      if (alive) {
        const at = now()
        const text = resumeText(task)
        if (deps.sendMessage) {
          try {
            await deps.sendMessage(binding.memberId, text)
          } catch {
            /* 发送失败不拦派发：成员仍活着，下一轮 watcher/resume 会再试 */
          }
        }
        next = appendMessage(
          next,
          makeMessage({ from: 'captain', to: binding.name, toMemberId: binding.memberId, taskId, at, body: text }),
        )
        next = patchTask(next, taskId, {
          status: task.status === 'gate' ? 'gate' : 'running',
          memberId: binding.memberId,
          lastResumeAt: at,
          lastResumeStatus: task.status,
        })
        changed = true
        skipped.push({ taskId, reason: 'ALREADY_RUNNING' })
        continue
      }
      // 成员已死：退役旧 binding，重新建人（同一确定性名字）。
      next = {
        ...next,
        bindings: next.bindings.map((item) => (item.taskId === taskId && !item.retired ? { ...item, retired: true } : item)),
      }
      changed = true
    }

    // 步 c：逐角色模型预校验（AC-22）。解析不到就拒绝派发，绝不静默回退队长模型。
    if (role.model && deps.routePort) {
      const preflight = await preflightRoutes([role], deps.routePort)
      if (preflight.failed.length > 0) {
        skipped.push({ taskId, reason: 'MODEL_UNRESOLVABLE' })
        continue
      }
    }

    // 步 c2（t5）：同角色已有空闲成员 → 续聊派新任务卡，不再 spawn 新成员。
    //
    // 位置在模型预校验之后、名字分配之前：复用一个已有成员不消耗名字空间，也不该产生
    // rename notice。任何一环不满足（没有发送端口 / 名单不可得 / 没有空闲候选 / 发送失败）
    // 都**落回**下面的 spawn —— 复用是名额优化，绝不能变成「任务静默没派出去」。
    if (deps.sendMessage && members !== null) {
      const reusable = pickReuseCandidate(reuseCandidates, role, members, claimedMembers, busyMembers)
      if (reusable) {
        // r27 复用闸门：成员会一直停在它创建时的模型上，所以复用前必须核对**它会话当前**
        // 的真实路由。目标 = 角色声明；角色未声明 = 跟随当前会话默认（用 run 的 sessionId 读，
        // 后台派发没有 initiator 时也能读对）。装配层读不到任何会话路由（老宿主）时根本不接
        // 这个端口 → 闸门整体跳过；能读但某一侧缺失时 routeAllowsReuse 判为不一致，落回 spawn。
        const targetRoute =
          role.model ?? deps.readCallerRoute?.() ?? deps.readSessionRoute?.(next.plan.sessionId)
        const actualRoute = deps.readSessionRoute?.(reusable.memberId)
        const routeMatches = deps.readSessionRoute === undefined || routeAllowsReuse(targetRoute, actualRoute)
        if (!routeMatches) {
          const at = now()
          next = appendMessage(
            next,
            makeMessage({
              from: 'captain',
              to: 'user',
              taskId,
              at,
              body: `成员 ${reusable.name} 的模型是 ${routeTextOf(actualRoute)}，本次目标模型是 ${routeTextOf(targetRoute)}，模型不一致，改为新建成员`,
            }),
          )
          changed = true
          // 这批不再选它；落回 spawn 新建成员。
          claimedMembers.add(reusable.memberId)
        } else {
          let card = ''
          try {
            card = taskCardText(task, role, handoffBodiesFor(next.messages, taskId))
          } catch (error) {
            errors.push({ taskId, error: `生成提示词失败：${messageOf(error)}` })
            continue
          }
          let sent = false
          try {
            const result = await deps.sendMessage(reusable.memberId, card)
            sent = result.ok === true
          } catch {
            sent = false
          }
          if (!sent) {
            // 发送失败可能是成员刚死/名单过期：本批不再选它，直接落回 spawn 新建。
            // 不静默跳过任务，也不把这次失败算成派发成功。
            claimedMembers.add(reusable.memberId)
          } else {
            const at = now()
            // 旧任务的推进记录属于旧任务：不清掉会让新一轮停滞告警按旧时间戳误报。
            const progressRest = { ...(next.progress ?? {}) }
            delete progressRest[reusable.memberId]
            next = {
              ...next,
              bindings: [
                ...next.bindings,
                { taskId, roleId: task.roleId, memberId: reusable.memberId, name: reusable.name, spawnedAt: at },
              ],
              ...(next.progress === undefined ? {} : { progress: progressRest }),
            }
            next = patchTask(next, taskId, {
              status: 'running',
              memberId: reusable.memberId,
              attempts: task.attempts ?? 0,
            })
            next = stampTaskTime(next, taskId, { startedAt: at })
            // 复用不换模型：优先记成员会话**此刻**读到的真实路由；读不到才退回上次审计值
            // （都没有 → null → unverified，不拿声明值假装生效）。
            if (role.model) {
              const liveActual = deps.readSessionRoute?.(reusable.memberId)
              next = auditRoute(next, taskId, role.model, liveActual ?? reusable.audit?.actual ?? null, at)
            }
            next = appendMessage(
              next,
              makeMessage({
                from: 'captain',
                to: reusable.name,
                toMemberId: reusable.memberId,
                taskId,
                at,
                body: card,
              }),
            )
            // r31 D1：复用时同样要给「任务卡缺 path:line」软提示；判据与 spawn 分支共用。
            next = appendMissingPointerHint(next, state, task, at)
            started.push(taskId)
            claimedMembers.add(reusable.memberId)
            changed = true
            slots -= 1
            continue
          }
        }
      }
    }

    // 步 d：取本任务的分配结果（AC-4）——名字已在循环前算好，这里只做一次 Map 查表。
    // 位置在角色/模型预校验之后、`buildPrompt` 之前：名字定不下来就没有拼提示词的意义，
    // 而预校验仍排在更前面，保证「角色缺失」这类更有信息量的原因优先暴露。
    //
    // 只有「序号 -2…-99 全被占」才会走到 errors：那是可观测的兜底，不是静默 pending。
    const assignment = names.get(taskId)
    if (!assignment || assignment.suffix === null) {
      errors.push({
        taskId,
        code: 'MEMBER_NAME_COLLISION',
        error: `成员名冲突：${assignment?.base ?? nameOf(task)} 的序号候选（-2…-${NAME_SUFFIX_MAX}）全部被占用；本次不派发（请修改任务 id 或角色）`,
      })
      continue
    }
    const name = assignment.final
    // 沿用它自己已有的同名 binding（恢复/重试）不算「消歧」，不产生 notice；
    // 在 `spawn` 之前取快照 —— 步 e 会把新 binding 追加进 `next.bindings`，之后查必然命中自己。
    const reusedName = next.bindings.some((item) => item.taskId === taskId && item.name === name)

    // 步 e：创建成员。
    let prompt = ''
    try {
      prompt = deps.buildPrompt({
        plan: next.plan,
        task,
        role,
        name,
        // AC-4(b)：上游直投的正文在这里（唯一注入点）进成员首条提示词。只读账本、不重新拼装，
        // 所以成员看到的与面板里逐字相同。resumeRun 不注入（续跑成员已经有上下文了）。
        handoffs: handoffBodiesFor(next.messages, taskId),
      })
    } catch (error) {
      errors.push({ taskId, error: `生成提示词失败：${messageOf(error)}` })
      continue
    }

    try {
      const spawned = await deps.spawn({ plan: next.plan, task, role, name, prompt })
      if (!spawned.ok) {
        errors.push({ taskId, error: spawned.error })
        continue
      }
      const at = now()
      next = {
        ...next,
        bindings: [
          ...next.bindings,
          { taskId, roleId: task.roleId, memberId: spawned.memberId, name, spawnedAt: at },
        ],
      }
      next = patchTask(next, taskId, {
        status: 'running',
        memberId: spawned.memberId,
        attempts: task.attempts ?? 0,
      })
      // r13 AC-20：spawn 成功 = 任务真的开始了，计时起点**只在这里**写。
      // 刻意不覆盖已有的 `startedAt`：返工后重派属于同一段用时（AC-20 要求重读逐毫秒相同，
      // 起点漂移会让面板上的用时每次返工都「重新计时」）。
      next = stampTaskTime(next, taskId, { startedAt: at })
      // 步 f：逐角色模型漂移审计（AC-22）。
      //
      // 时序是这条审计的全部难点：宿主在 `spawnTeammate()` **内部**先 await `agent/created`
      // 监听，再返回 `{ member }`；事件到达那一刻 binding 还不存在，所以「事件里查 binding」
      // 在真机上永远查不到（旧实现在 index.ts 里这么写，结果 routeAudits 恒为空、面板把
      // 已经生效的模型显示成「未下发」）。改成由 spawn 端口把事件里观测到的实际路由带回来，
      // 在 binding 落盘之后**同一笔**写进 RunState。
      //
      // 角色没声明模型时不审计：那不是「未下发」，面板本来就该显示「会话默认模型」。
      // 声明了却拿不到实际值 → auditRoute 落 unverified（绝不拿声明值假装生效）。
      if (role.model) {
        next = auditRoute(
          next,
          taskId,
          role.model,
          deps.readSessionRoute?.(spawned.memberId) ?? spawned.actual ?? null,
          at,
        )
      }
      next = appendMessage(
        next,
        makeMessage({
          from: 'captain',
          to: name,
          toMemberId: spawned.memberId,
          taskId,
          at,
          body: `任务 ${task.id}「${taskLabelOf(task)}」已派发给你（角色 ${role.name}）。验收判定：${task.acceptance === '' ? '（未声明，需人工确认）' : task.acceptance}`,
        }),
      )
      // r29/r31：任务卡行号指针的软提示（与复用路径共用 appendMissingPointerHint）。
      next = appendMissingPointerHint(next, state, task, at)
      started.push(taskId)
      // 只在 spawn 成功后记录消歧（失败侧不产生 notice），且只记录**真消歧**：
      // 本名不算（suffix=0）、沿用自己老 binding 的同名也不算（重试/重建不重复提示）。
      if (assignment.suffix > 0 && !reusedName) {
        renamed.push({ taskId, base: assignment.base, final: name })
      }
      changed = true
      slots -= 1
    } catch (error) {
      errors.push({ taskId, error: messageOf(error) })
    }
  }

  if (changed) deps.store.save(next)
  return { state: next, started, skipped, errors, renamed }
}

/**
 * 幂等恢复（AC-17）：只认「成员还在不在」，不猜、不自动建人。
 *
 * 判据：`lastResumeAt + RESUME_DEBOUNCE_MS` 内的第二次调用必须 `resumed=0 && unchanged=true`，
 * 且**不新增 binding**（成员数两次相等）——这样面板「续跑」按钮连点也不会造出一堆重复成员。
 */
export async function resumeRun(state: RunState, deps: ResumeDeps): Promise<ResumeResult> {
  const now = deps.now ?? Date.now
  let next = state
  let resumed = 0
  let skipped = 0
  let changedCount = 0

  const candidates = next.plan.tasks.filter(
    (task) => task.status === 'running' || task.status === 'gate' || task.status === 'interrupted',
  )
  if (candidates.length === 0) return { state: next, resumed, skipped, unchanged: true }

  let members: HostMember[] | null = null
  try {
    members = await deps.listMembers()
  } catch {
    // 名单不可得 → 一律不判定（宁可什么都不做，也不把活成员误标成中断）。
    return { state: next, resumed, skipped: candidates.length, unchanged: true }
  }

  for (const task of candidates) {
    const binding = liveBinding(next, task.id)
    if (!binding) {
      // 没有 binding 的「运行中」只可能是脏数据：标中断，等人工/重新派发。
      if (task.status !== 'interrupted') {
        next = patchTask(next, task.id, { status: 'interrupted' })
        // r11 AC-15：转 interrupted 是终态转换 → 立刻释放写域（否则等待者永远等不到）。
        next = releaseScopes(next, task.id, now())
        changedCount += 1
      } else {
        skipped += 1
      }
      continue
    }

    // 名字是唯一可重建的键（宿主重启后 id→name 内存表就没了）。
    const found = members.find((member) => member.id === binding.memberId || member.name === binding.name)
    if (!found) {
      if (task.status !== 'interrupted') {
        next = patchTask(next, task.id, { status: 'interrupted' })
        next = {
          ...next,
          bindings: next.bindings.map((item) =>
            item.taskId === task.id && !item.retired ? { ...item, retired: true } : item,
          ),
        }
        // r11 AC-15：同上，终态转换即释放写域。
        next = releaseScopes(next, task.id, now())
        changedCount += 1
      } else {
        skipped += 1
      }
      continue
    }

    const at = now()
    const debounced = task.lastResumeStatus === task.status && at - (task.lastResumeAt ?? 0) < RESUME_DEBOUNCE_MS
    if (debounced) {
      skipped += 1
      continue
    }

    const text = resumeText(task)
    if (deps.sendMessage) {
      try {
        await deps.sendMessage(binding.memberId, text)
      } catch {
        /* 发送失败也要更新去抖时间戳，否则每次轮询都会重复发 */
      }
    }
    next = patchTask(next, task.id, { lastResumeAt: at, lastResumeStatus: task.status, memberId: binding.memberId })
    next = appendMessage(
      next,
      makeMessage({ from: 'captain', to: binding.name, toMemberId: binding.memberId, taskId: task.id, at, body: text }),
    )
    resumed += 1
    changedCount += 1
  }

  if (changedCount > 0) deps.store.save(next)
  return { state: next, resumed, skipped, unchanged: resumed === 0 && changedCount === 0 }
}

/** 回执应用：`done` 是任务完成的**唯一**写点（AC-19 的机械保证）。 */
export function applyReceipt(
  state: RunState,
  taskId: string,
  receipt: { verdict: 'done' | 'rework' | 'failed'; note?: string; evidence?: import('../../shared/types.ts').GateEvidence },
  now?: number,
  /**
   * 返工上限（r7 AC-13 的 settings 生效点）。缺省取 `config.MAX_ATTEMPTS` —— 常量的值不变，
   * 这里只接收参数，所以「没有 settings.json」与今天的逐字行为完全一致（AC-11）。
   */
  maxAttempts?: number,
): RunState {
  const limit = maxAttempts ?? MAX_ATTEMPTS
  const at = now ?? Date.now()
  const task = state.plan.tasks.find((item) => item.id === taskId)
  if (!task) return state
  // r11 AC-15/AC-18：只有**真的从非终态转成终态**才释放写域并通知等待者。
  // 判据取「进入本函数时的状态」：重放一条 done 回执（QA 的幂等探针会连发两次）时
  // wasTerminal 已经为 true，不会写出第二条释放通知。
  const wasTerminal = isTerminalTaskStatus(task.status)

  const attempts = task.attempts ?? 0
  const evidence = receipt.evidence ?? task.evidence
  let next = state
  let body = ''

  if (receipt.verdict === 'done') {
    next = patchTask(next, taskId, { status: 'done', evidence })
    body = gateSummary(task, evidence, '门禁通过')
  } else if (receipt.verdict === 'failed') {
    next = patchTask(next, taskId, { status: 'failed', attempts: attempts + 1, evidence })
    body = gateSummary(task, evidence, '已被判定失败')
  } else {
    const nextAttempts = attempts + 1
    const giveUp = nextAttempts >= limit
    next = patchTask(next, taskId, {
      status: giveUp ? 'failed' : 'rework',
      attempts: nextAttempts,
      evidence,
    })
    body = giveUp
      ? `返工已达上限（${nextAttempts}/${limit} 次）：任务 ${task.id}「${taskLabelOf(task)}」已转人工，下游保持阻塞。${receipt.note ?? ''}`.trim()
      : `返工第 ${nextAttempts}/${limit} 次：任务 ${task.id}「${taskLabelOf(task)}」未通过门禁，请按证据修改后再次回报。${receipt.note ?? ''}`.trim()
  }

  next = appendMessage(
    next,
    makeMessage({
      from: 'member',
      to: 'captain',
      toMemberId: task.memberId,
      taskId,
      at,
      body: evidence ? `${body}｜证据：exit=${evidence.exitCode ?? 'null'} ${evidence.tail}` : body,
    }),
  )

  // r11 AC-15：进入终态立即释放写域（done/failed/cancelled/skipped/interrupted 五态同待遇）。
  // 只在该任务**原本不是终态**时做：重放回执不能二次唤醒等待者。
  const settledTask = next.plan.tasks.find((item) => item.id === taskId)
  if (!wasTerminal && settledTask && isTerminalTaskStatus(settledTask.status)) {
    next = releaseScopes(next, taskId, at)
    // r13 AC-20：终点同样只在「首次进入终态」时写，重放回执不刷新（同一份证据重读必须逐毫秒相同）。
    next = stampTaskTime(next, taskId, { endedAt: at })
  }

  // done 后解锁下游：blocked → pending，让下一轮 dispatch 自然取到。
  // skipped 也算满足（AC-26）：用户显式跳过一条任务，下游必须能继续，否则整条计划被卡死。
  if (receipt.verdict === 'done') {
    next = {
      ...next,
      plan: {
        ...next.plan,
        tasks: next.plan.tasks.map((item) => {
          if (item.status !== 'blocked') return item
          const allDone = item.dependsOn.every((dep) => {
            const upstream = next.plan.tasks.find((candidate) => candidate.id === dep)
            return upstream !== undefined && depSatisfied(upstream.status)
          })
          return allDone ? { ...item, status: 'pending' as const } : item
        }),
      },
    }
  }

  // 直通投递（AC-1~AC-5）：done 且门禁 exitCode===0 → 给每个 dependsOn 含本任务的下游各一条
  // `from: 'peer'` 的交接。放在「解锁下游」之后，让这段看到的是解锁后的同一份快照。
  // **只落账、不实发**：applyReceipt 是纯函数（无 IO），把 body 送进成员会话的唯一入口是
  // `bridge.act('receipt')` —— 两条投递路径是不可接受的（AC-4a 的逐字一致会立刻分叉）。
  if (receipt.verdict === 'done' && evidence && evidence.exitCode === 0) {
    const upstreamTask = next.plan.tasks.find((item) => item.id === taskId) ?? task
    const existingIds = next.messages.flatMap((message) =>
      message.messageId === undefined ? [] : [message.messageId],
    )
    const downstream = next.plan.tasks.filter((item) => item.dependsOn.includes(taskId))
    for (const message of handoffMessages({
      upstream: upstreamTask,
      evidence,
      upstreamVerdict: receipt.verdict,
      downstream,
      at,
      existingIds,
      // to 的口径：下游成员已经存在 → 用成员名（并带 toMemberId 供实发）；
      // 尚未创建（常态：B 在 A 完成后才派发）→ `task:<id>`，等它创建时再注入提示词（AC-4b）。
      targetOf: (downstreamTaskId) => {
        const binding = liveBinding(next, downstreamTaskId)
        if (binding) return { to: binding.name, toMemberId: binding.memberId }
        return { to: `task:${downstreamTaskId}` }
      },
    })) {
      next = appendMessage(next, message)
    }
  }

  // 全部终态 → 计划终止（面板胶囊才会从「运行中」翻到「已完成/有失败」）。
  // 口径：done/failed/cancelled/skipped 都算「这条不会再跑了」；
  // interrupted **不算**——它的出路是续聊或改验收后重派，把计划终止掉会让恢复失去入口。
  const allSettled = next.plan.tasks.every((item) => SETTLED_PLAN_STATUSES.has(item.status))
  if (allSettled && next.plan.tasks.length > 0) {
    // r20：收口与结束时刻同一次落盘 —— 否则「已终止但没有结束时刻」的 run 只能永远显示
    // 「不可得」（历史缺值是回退口径，不能反过来把新 run 也留成缺口）。
    next = {
      ...next,
      finishedAt: next.finishedAt ?? at,
      plan: { ...next.plan, status: 'terminated' },
    }
  }

  return next
}

/**
 * 消息账本里的**短任务标签**（r28）：只取标题第一行并按 code point 截到 ≤60 字符。
 *
 * 为什么必须有：`task.title` 现在鼓励写「实现什么 + 关键文件/符号」，一条长标题 2~3k 字；
 * 把它整段拼进每条门禁/续聊消息，会让 run JSON（账本）与 `auto_team_status` 的返回按条数放大。
 * 标签只服务「这条消息说的是哪个任务」——任务全文仍在 `plan.tasks[].title`，面板与成员都能看全。
 *
 * 额外返回 `task.id` 的调用点（gateSummary/resumeText 等）负责把 id 放在标签外，
 * 所以本函数**只处理标题**，避免同一个 id 在文案里出现两次。
 */
export function taskLabelOf(task: Pick<PlanTask, 'title'>): string {
  const firstLine = (task.title ?? '').split(/\r?\n/, 1)[0].trim()
  // 按 code point 而不是 UTF-16 code unit 截断：emoji / 代理对不能被切成半个字符。
  const chars = Array.from(firstLine)
  if (chars.length <= TASK_LABEL_MAX) return firstLine
  return `${chars.slice(0, TASK_LABEL_MAX - 1).join('')}…`
}

/**
 * 任务卡里是否给了 `path:line` 行号指针（r29）。
 *
 * 判据是「带扩展名的路径 + 冒号 + 数字」，且路径前面必须是行首/空白/标点 ——
 * 这样 `src/host/tools.ts:123` 命中，而 `src/host/tools.ts`（无行号）、
 * `12:30`（时间）、`https://x:443`（URL 的端口，路径段没有扩展名）都不命中。
 *
 * 为什么不用更宽的 `\w+:\d+`：任务卡里到处都是时间、端口、版本号，
 * 一个宽正则会让「没给指针」的提示永不触发，等于没做。
 */
const LINE_POINTER_RE =
  /(?:^|[\s(（[【{「"'`<>,，;；、])[\w.-]+(?:\/[\w.-]+)*\.[A-Za-z][\w-]*:[0-9]+(?![A-Za-z0-9_])/u

/** 纯函数：给一段文本，判断是否含可点击的 `path:line` 指针。 */
export function hasLinePointer(text: string): boolean {
  return LINE_POINTER_RE.test(text ?? '')
}

/** 续跑文案：明确「从哪继续」，避免成员当作新任务重头做一遍。 */
export function resumeText(task: PlanTask): string {
  return `继续执行任务 ${task.id}「${taskLabelOf(task)}」：沿用你已有的上下文，补齐未完成部分；完成后按验收判定回报回执。`
}

function gateSummary(task: PlanTask, evidence: PlanTask['evidence'], prefix: string): string {
  const exit = evidence ? `退出码 ${evidence.exitCode ?? 'null（超时/被杀）'}` : '无门禁证据'
  return `${prefix}：任务 ${task.id}「${taskLabelOf(task)}」（${exit}）`
}

function liveBinding(state: RunState, taskId: string) {
  return state.bindings.find((item) => item.taskId === taskId && !item.retired)
}

/**
 * r13 AC-11：把「已获准强制并行」的 waiting 任务放回待办。
 *
 * 只动 `waiting`：pending/ready 本来就能进派发循环；running/gate 不能被强行并行改写状态。
 * 清掉 `waitingOn` / `waitReason`（与 `applyScopeWaits` 的 waiting → pending 同口径），
 * 否则面板会显示「在等 t1」可任务已经在跑了 —— 等待文案与事实不一致比没有文案更糟。
 */
function reviveForcedWaits(state: RunState, forced: ReadonlySet<string>): RunState {
  if (forced.size === 0) return state
  let changed = false
  const tasks = state.plan.tasks.map((task) => {
    if (task.status !== 'waiting' || !forced.has(task.id)) return task
    changed = true
    const revived: PlanTask = { ...task, status: 'pending' }
    delete revived.waitingOn
    delete revived.waitReason
    return revived
  })
  if (!changed) return state
  return { ...state, plan: { ...state.plan, tasks } }
}

/**
 * r13 AC-20：任务计时的**唯一**写入 helper（起点由 dispatch 写、终点由 applyReceipt 写）。
 *
 * 两条不变量：
 *  - `startedAt` / `endedAt` 都是「首次写入生效」——重派、重放回执、续跑都不得让用时漂移；
 *  - 没有 `startedAt` 就不写 `endedAt`（任务从未开始就被跳过时，用时口径是「未开始」而不是 0）。
 */
function stampTaskTime(state: RunState, taskId: string, patch: TaskTimeRecord): RunState {
  const current = state.taskTimes?.[taskId] ?? {}
  const next: TaskTimeRecord = { ...current }
  if (patch.startedAt !== undefined && next.startedAt === undefined) next.startedAt = patch.startedAt
  if (patch.endedAt !== undefined && next.endedAt === undefined && next.startedAt !== undefined) {
    next.endedAt = Math.max(patch.endedAt, next.startedAt)
  }
  // 无可写内容（例如从未开始的任务被跳过）或无变化时返回原对象：
  // dispatch 用 `changed` 决定是否落盘，凭空换新对象会多写一次盘。
  if (next.startedAt === undefined && next.endedAt === undefined) return state
  if (next.startedAt === current.startedAt && next.endedAt === current.endedAt) return state
  return { ...state, taskTimes: { ...(state.taskTimes ?? {}), [taskId]: next } }
}

/**
 * 终态集合（r11 AC-15）：进入即释放写域。
 *
 * `interrupted` 也在里面：成员进程已死，它不会再改文件，占着写域只会让等待者永远等下去。
 * 但它**不**让计划收口（见 SETTLED_PLAN_STATUSES）——中断的任务还能被续聊救回来。
 */
const TERMINAL_TASK_STATUSES: ReadonlySet<PlanTask['status']> = new Set<PlanTask['status']>([
  'done',
  'failed',
  'cancelled',
  'skipped',
  'interrupted',
])

/** 计划可以收口的任务状态（done/failed/cancelled/skipped）：interrupted 不算。 */
const SETTLED_PLAN_STATUSES: ReadonlySet<PlanTask['status']> = new Set<PlanTask['status']>([
  'done',
  'failed',
  'cancelled',
  'skipped',
])

/** 任务是否已进入终态（写域该释放了）。 */
export function isTerminalTaskStatus(status: PlanTask['status']): boolean {
  return TERMINAL_TASK_STATUSES.has(status)
}

function patchTask(state: RunState, taskId: string, patch: Partial<PlanTask>): RunState {
  return {
    ...state,
    plan: {
      ...state.plan,
      tasks: state.plan.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
