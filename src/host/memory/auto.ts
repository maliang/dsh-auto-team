/**
 * 自动记忆沉淀（r19）：run 到终态时把「这次跑成了什么」写进双轨记忆。
 *
 * 为什么需要它：注入链路一直是通的（`MEMORY_INJECT_BUDGET` → `bridge.memoryFor` → 提示词里的
 * 「已内联 N/4000 字符」），但写入只有**手动** `act.saveMemory` 与 `bridge.remember`——
 * 用户从没手动点过，于是两个记忆目录始终不存在、提示词永远内联 0 条。本模块补上「自动写」
 * 这一半：不靠成员记得写、不靠队长记得写，run 落终态时由 `bridge.saveState` 顺手沉淀。
 *
 * 两条口径（用户已确认）：
 *  1. **每个 run 结束写一条项目记忆**（终止/取消都算结束；进行中不写）；
 *  2. **按内容分两轨**：本次 run 的经过写项目轨（`<workspace>/.auto-team/memory`），
 *     跨项目可复用的教训写公共轨（`<home>/.dsh/auto-team/memory/public`）。
 *
 * 纯逻辑：不 import `fs`、不 import 宿主模块（连 `RunState` 的类型也不 import），
 * 入参是窄结构；因此能被 `node --test test/memory-auto.test.ts` 直接跑，也方便在别的宿主复用。
 *
 * **幂等键是文件名**：`run-<runId>.md` / `lessons-<runId>.md`，只由 runId 派生，不拼 `now`
 * 日期。`bridge` 侧「目标文件已存在就跳过」——用户手改过的记忆绝不会被下一次 saveState 覆盖。
 *
 * 内容模板（与既有 md 读取规则兼容）：
 *  - 首行恒为 `# <标题>`，`memoryTitleOf` 取「正文第一个 `#`」当标题，因此自动记忆在记忆页
 *    与注入索引里都有可读标题，而不是一串文件名；
 *  - 正文只写**证据**（状态、退出码、输出尾部），不编造失败原因；
 *  - 项目记忆 ≤ 24 行、公共记忆 ≤ 6 行，超出按「先砍任务行、再砍证据行」截断并留一行省略说明。
 */

import type { MemoryLevel, MemoryTopicId, MemoryTrack } from '../../shared/types.ts'
import { entryHash } from './entries.ts'

/** 一条待落盘的自动记忆：轨 + 文件名（含 `.md`）+ 正文。 */
export interface AutoMemory {
  track: 'project' | 'public'
  name: string
  body: string
}

/** 门禁证据（与 `GateEvidence` 的只读投影同形；`exitCode: null` = 超时/被信号杀掉）。 */
export interface AutoMemoryEvidence {
  command?: string | null
  exitCode?: number | null
  tail?: string | null
}

/** 任务的只读投影：`status` 用 string 而不 import TaskStatus，避免与本模块的纯逻辑耦合。 */
export interface AutoMemoryTask {
  id: string
  title: string
  status: string
  /** 已失败的门禁次数（宿主 `applyReceipt` 在失败/返工时 +1）。 */
  attempts?: number | null
  evidence?: AutoMemoryEvidence | null
}

/** `runMemoryOf` 的窄入参：够写两份记忆，且与 `RunState` 的形状解耦。 */
export interface AutoMemoryInput {
  runId: string
  goal?: string | null
  status: string
  createdAt?: number | null
  /** 计划落盘时刻（本模块暂不单独展示，保留在契约里供后续模板使用）。 */
  plannedAt?: number | null
  finishedAt?: number | null
  project?: string | null
  sessionId?: string | null
  tasks?: readonly AutoMemoryTask[] | null
}

/** 正文行数上限：项目记忆 24、公共教训 6（含首行标题）。 */
const PROJECT_BODY_LINES = 24
const PUBLIC_BODY_LINES = 6

/** 标题行总长（含 `# ` 前缀之外的部分：目标 + 分隔符 + runId）上限。 */
const TITLE_CHARS = 80
/** 逐任务行里的任务标题上限。 */
const TASK_TITLE_CHARS = 40
/** 证据尾部摘要上限。 */
const TAIL_CHARS = 120
/** runId 收敛后允许的最大长度（`run-<stem>.md` 仍 < safeMemoryName 的 64 字符上限）。 */
const RUN_STEM_CHARS = 40

const FALLBACK_GOAL = '未命名计划'
const TERMINAL_STATUSES: readonly string[] = ['terminated', 'cancelled']
const STATUS_LABELS: Record<string, string> = { terminated: '已终止', cancelled: '已取消' }

/* ------------------------------------------------------------------ 文本工具 */

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 压成单行：标题/证据里出现换行会把 md 结构拆坏（一次 title 注入就能污染整段索引）。 */
function oneLine(value: unknown): string {
  return text(value).replace(/\s+/g, ' ').trim()
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  if (max <= 1) return value.slice(0, Math.max(0, max))
  return `${value.slice(0, max - 1)}…`
}

/** runId → 可做文件名的稳定片段（同名 state 每次得到同一个名字 = 幂等键）。 */
function runStem(runId: unknown): string {
  const raw = oneLine(runId)
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '')
  const stem = cleaned.slice(0, RUN_STEM_CHARS)
  return stem === '' ? 'unknown' : stem
}

/**
 * 项目记忆文件名（`run-<runId>.md` 的归一化形式）。
 *
 * 沉淀（`projectMemoryOf`）与历史回填共用这一个派生函数：回填要「只补缺失、绝不覆盖」，
 * 文件名一旦两处各拼一遍，就可能因归一化差异把同一 run 补成第二份。
 *
 * @deprecated r23 起不再生成旧流水文件；仅历史回填使用。
 */
export function projectMemoryNameOf(runId: unknown): string {
  return `run-${runStem(runId)}.md`
}

function timestampOf(...candidates: Array<number | null | undefined>): number {
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

/** 本地时间 `YYYY-MM-DD HH:mm`；不做跨时区承诺（记忆是给人读的）。 */
function formatLocal(at: number): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return '未记录'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 本地日期 `YYYY-MM-DD`。 */
function formatDay(at: number): string {
  return formatLocal(at).replace(/ .*$/, '')
}

function goalOf(input: AutoMemoryInput): string {
  const goal = oneLine(input.goal)
  return goal === '' ? FALLBACK_GOAL : goal
}

/**
 * 首行标题：`# <goal> · <runId>`，总长 ≤ 80 且**恒为单行**。
 *
 * 先给 runId 留位再裁目标：runId 是幂等键的一半，被目标挤掉就分不清是哪次 run。
 */
function titleLineOf(input: AutoMemoryInput): string {
  const runId = oneLine(input.runId)
  const tail = ` · ${runId}`
  // `TITLE_CHARS` 是首行总长（含 `# ` 前缀）：runId 先占位，剩下的才给目标。
  const room = TITLE_CHARS - '# '.length - tail.length
  const head = room > 0 ? clip(goalOf(input), room) : ''
  return clip(`# ${head}${tail}`, TITLE_CHARS)
}

/* ------------------------------------------------------------------ 任务与失败 */

function attemptsOf(task: AutoMemoryTask): number {
  const value = task.attempts
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/** 退出码文案：`null` 必须与「非 0」区分（超时不是失败原因，只是证据）。 */
function exitLabelOf(evidence: AutoMemoryEvidence | null | undefined): string {
  if (evidence === null || evidence === undefined) return '未记录'
  const code = evidence.exitCode
  if (code === null) return 'null（超时）'
  if (typeof code === 'number' && Number.isFinite(code)) return String(code)
  return '未记录'
}

function commandOf(evidence: AutoMemoryEvidence | null | undefined): string {
  const command = oneLine(evidence?.command)
  return command === '' ? '未记录' : command
}

function tailOf(evidence: AutoMemoryEvidence | null | undefined): string {
  return clip(oneLine(evidence?.tail), TAIL_CHARS)
}

interface FailureSignal {
  task: AutoMemoryTask
  rework: number
  command: string
  exitLabel: string
  tail: string
}

/**
 * 失败判定（三条各自独立命中，任一即算）：
 *  1. 任务状态是 `failed`；
 *  2. `attempts > 1`（走过返工）；
 *  3. 有证据且 `exitCode !== 0`——`null`（超时/被信号杀）同样算失败。
 */
function failureOf(task: AutoMemoryTask): FailureSignal | null {
  const evidence = task.evidence ?? undefined
  const exitCode = evidence?.exitCode
  const gateFailed =
    evidence !== undefined && (exitCode === null || (typeof exitCode === 'number' && exitCode !== 0))
  if (task.status !== 'failed' && attemptsOf(task) <= 1 && !gateFailed) return null
  return {
    task,
    rework: attemptsOf(task),
    command: commandOf(evidence),
    exitLabel: exitLabelOf(evidence),
    tail: tailOf(evidence),
  }
}

function taskLineOf(task: AutoMemoryTask): string {
  const id = oneLine(task.id) === '' ? '?' : oneLine(task.id)
  const status = oneLine(task.status) === '' ? 'unknown' : oneLine(task.status)
  const title = oneLine(task.title)
  return `- ${id} [${status}] ${title === '' ? id : clip(title, TASK_TITLE_CHARS)}`
}

function failureLineOf(signal: FailureSignal): string {
  const id = oneLine(signal.task.id) === '' ? '?' : oneLine(signal.task.id)
  const head = `- ${id} 返工 ${signal.rework} 次：门禁 \`${signal.command}\` 退出码 ${signal.exitLabel}`
  return signal.tail === '' ? head : `${head}；输出尾部：${signal.tail}`
}

/* ------------------------------------------------------------------ 项目记忆 */

/**
 * @deprecated r23 起改用条目模型（见 `autoEntryDraftsOf`）；仅历史回填使用。
 */
function projectMemoryOf(input: AutoMemoryInput, tasks: readonly AutoMemoryTask[]): AutoMemory {
  const runId = oneLine(input.runId)
  const at = timestampOf(input.finishedAt, input.createdAt, input.plannedAt)
  const status = oneLine(input.status)
  const statusLabel = STATUS_LABELS[status] ?? status

  const head: string[] = [
    titleLineOf(input),
    `- 状态：${statusLabel} · ${formatLocal(at)}`,
  ]

  const project = oneLine(input.project)
  const session = oneLine(input.sessionId)
  const contextParts: string[] = []
  if (project !== '') contextParts.push(`项目：${project}`)
  if (session !== '') contextParts.push(`会话：${session}`)
  if (contextParts.length > 0) head.push(`- ${contextParts.join(' · ')}`)

  const counts = { done: 0, failed: 0, cancelled: 0, skipped: 0 }
  for (const task of tasks) {
    const status = oneLine(task.status)
    if (status in counts) counts[status as keyof typeof counts] += 1
  }
  const countParts: string[] = []
  for (const key of ['done', 'failed', 'cancelled', 'skipped'] as const) {
    if (counts[key] > 0) countParts.push(`${key} ${counts[key]}`)
  }
  if (countParts.length > 0) head.push(`- 任务：${countParts.join(' · ')}（共 ${tasks.length}）`)

  const taskLines = tasks.map(taskLineOf)
  const failures = tasks
    .map(failureOf)
    .filter((signal): signal is FailureSignal => signal !== null)
  const failureLines = failures.map(failureLineOf)

  // 预算：先留足头段与失败段（失败证据是最该留的部分），任务行用剩下的空间；
  // 任何一段放不下就截断并留一行省略说明——正文**硬上限** 24 行，不靠调用方自觉。
  const fixed = head.length
  const failureRoom = Math.max(0, PROJECT_BODY_LINES - fixed - 1)
  let shownFailures = failureLines
  if (failureLines.length > failureRoom) {
    shownFailures =
      failureRoom === 0
        ? []
        : [
            ...failureLines.slice(0, failureRoom - 1),
            `- …另有 ${failureLines.length - (failureRoom - 1)} 条失败证据（已截断）`,
          ]
  }
  const failureBlock = shownFailures.length === 0 ? [] : ['## 失败与教训', ...shownFailures]

  const taskRoom = PROJECT_BODY_LINES - fixed - failureBlock.length
  let shownTasks = taskLines
  if (taskLines.length > taskRoom) {
    shownTasks =
      taskRoom <= 0
        ? []
        : [
            ...taskLines.slice(0, taskRoom - 1),
            `- …另有 ${taskLines.length - (taskRoom - 1)} 条任务（已截断）`,
          ]
  }

  const bodyLines = [...head, ...shownTasks, ...failureBlock].slice(0, PROJECT_BODY_LINES)
  return {
    track: 'project',
    name: projectMemoryNameOf(input.runId),
    body: bodyLines.join('\n'),
  }
}

/* ------------------------------------------------------------------ 公共教训 */

/**
 * @deprecated r23 起改用条目模型（见 `autoEntryDraftsOf`）；仅历史回填使用。
 */
function publicMemoryOf(
  input: AutoMemoryInput,
  failures: readonly FailureSignal[],
): AutoMemory | null {
  if (failures.length === 0) return null
  const at = timestampOf(input.finishedAt, input.createdAt, input.plannedAt)
  const first = failures[0]
  const id = oneLine(first.task.id) === '' ? '?' : oneLine(first.task.id)
  const more = failures.length > 1 ? `（另有 ${failures.length - 1} 条失败任务）` : ''
  const tail = first.tail === '' ? '' : `；输出尾部：${first.tail}`
  const lines = [
    `# 自动团队教训 · ${oneLine(input.runId)}`,
    `- 日期：${formatDay(at)}`,
    `- 目标：${clip(goalOf(input), TITLE_CHARS)}`,
    `- 失败模式：${id} 门禁 \`${first.command}\` 退出码 ${first.exitLabel}${tail}${more}`,
    `- 可复用提示：同一门禁失败先在本地重跑 \`${first.command}\` 并对照输出尾部，确认结论后再让成员返工（证据：退出码 ${first.exitLabel}）`,
  ]
  return {
    track: 'public',
    name: `lessons-${runStem(input.runId)}.md`,
    body: lines.slice(0, PUBLIC_BODY_LINES).join('\n'),
  }
}

/* ------------------------------------------------------------------ 入口 */

/**
 * run 终态 → 自动记忆（纯函数）。
 *
 * 只在 `status === 'terminated' | 'cancelled'` 时产出：进行中的 run 每轮 saveState 都会调用
 * 本函数，若也写记忆，记忆目录会被半成品刷屏；其它状态一律返回空数组（调用方无需判断）。
 *
 * 返回值顺序固定为「项目轨在前、公共轨在后」，便于调用方按轨落盘与测试断言。
 *
 * @deprecated r23 起自动沉淀改走 `autoEntryDraftsOf` 的条目模型（pitfalls/commands），
 * 不再生成 `run-*.md` / `lessons-*.md`；保留本函数只为历史回填（backfill）读取旧流水。
 */
export function runMemoryOf(input: AutoMemoryInput): AutoMemory[] {
  const status = oneLine(input?.status)
  if (!TERMINAL_STATUSES.includes(status)) return []
  const tasks = Array.isArray(input.tasks) ? input.tasks : []
  const project = projectMemoryOf(input, tasks)
  const failures = tasks
    .map(failureOf)
    .filter((signal): signal is FailureSignal => signal !== null)
  const publicLesson = publicMemoryOf(input, failures)
  return publicLesson === null ? [project] : [project, publicLesson]
}

/* ------------------------------------------------------------------ r23：条目级草稿 */

/** 自动沉淀的条目草稿（纯数据，交给 `entries.ts` 的 upsert 应用）。 */
export interface AutoEntryDraft {
  track: MemoryTrack
  text: string
  topic?: MemoryTopicId
  level: MemoryLevel
  source: string
  at: number
}

const AUTO_SOURCE = '系统'

/**
 * run 终态 → 条目草稿（纯函数，DESIGN §11）。
 *
 * - 只处理终态；非终态返回 `[]`。
 * - 失败证据 → 项目轨 `pitfalls`/P1（没有失败就不产生 pitfalls 草稿，避免「本轮无失败」噪声）。
 * - 通过的门禁命令 → 项目轨 `commands`/P2（同 run 内按规范化 hash 去重）。
 * - 公共轨：仅当项目失败数 > 0 时写 1 条 `pitfalls`/P1。
 * - 自动流程**永不产生 P0**。
 */
export function autoEntryDraftsOf(input: AutoMemoryInput, now?: number): AutoEntryDraft[] {
  const status = oneLine(input?.status)
  if (!TERMINAL_STATUSES.includes(status)) return []
  const at = timestampOf(input.finishedAt, input.createdAt, input.plannedAt) || (now ?? Date.now())
  const runId = oneLine(input.runId) === '' ? '?' : oneLine(input.runId)
  const tasks = Array.isArray(input.tasks) ? input.tasks : []

  const drafts: AutoEntryDraft[] = []
  const seen = new Set<string>()
  let failures = 0

  for (const task of tasks) {
    const signal = failureOf(task)
    if (signal !== null) {
      failures += 1
      const title = clip(oneLine(task.title) === '' ? '?' : oneLine(task.title), TASK_TITLE_CHARS)
      let text: string
      if (signal.command !== '未记录') {
        const tail = signal.tail === '' ? '' : `；输出尾部：${signal.tail}`
        text = `门禁 \`${signal.command}\` 失败（退出码 ${signal.exitLabel}）${tail}`
      } else if (oneLine(task.status) === 'failed') {
        text = `任务「${title}」失败（${runId}）`
      } else {
        text = `任务「${title}」返工 ${signal.rework} 次（${runId}）`
      }
      drafts.push({ track: 'project', text, topic: 'pitfalls', level: 'P1', source: AUTO_SOURCE, at })
    }

    const evidence = task.evidence
    const command = oneLine(evidence?.command)
    if (evidence !== undefined && evidence !== null && evidence.exitCode === 0 && command !== '') {
      const text = `已验证命令：${command}`
      const key = entryHash(text)
      if (!seen.has(key)) {
        seen.add(key)
        drafts.push({ track: 'project', text, topic: 'commands', level: 'P2', source: AUTO_SOURCE, at })
      }
    }
  }

  if (failures === 0) return drafts

  const first = tasks.map(failureOf).find((signal): signal is FailureSignal => signal !== null)
  const publicText =
    first !== undefined && first.command !== '未记录'
      ? `门禁 \`${first.command}\` 失败（退出码 ${first.exitLabel}）——先本地重跑确认，再把证据发回成员返工`
      : '有任务失败——返工前先核对门禁证据，确认失败原因再改'
  drafts.push({ track: 'public', text: publicText, topic: 'pitfalls', level: 'P1', source: AUTO_SOURCE, at })
  return drafts
}
