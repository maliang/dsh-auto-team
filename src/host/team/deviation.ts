/**
 * 队长亲手写文件的留痕（r11 F7 / AC-22~AC-24）。
 *
 * 为什么单独成模块：这里同时有「纯语义」（哪些工具算写文件、路径怎么归一、60 秒窗口怎么合并）
 * 与「唯一的文件读写点」。合并语义一旦散到 bridge 里，就会出现「bridge 合一次、append 又合一次」
 * 的双重计数，面板的 `×N` 与文件行数对不上 —— AC-24 的判据正是这两者必须一致。
 *
 * 三条硬约束（AC-23）：**fail-open**。任何异常（目录不可写、JSON 坏行、序列化失败）都只
 * `warn` 一次并返回 false / 空数组，绝不抛给调用方 —— 留痕是审计旁路，不能让工具结果变红。
 *
 * 只记 `write` / `edit`：`bash` 里重定向写文件不记（PRD 的显式排除）。理由是 bash 命令里
 * 的路径不可靠（可能写临时文件、可能是只读命令），误记比漏记更伤审计可信度。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DeviationView } from '../../shared/types.ts'
import {
  DEVIATION_LINE_LIMIT,
  DEVIATION_MERGE_MS,
  DEVIATION_REASON_MAX,
  DEVIATION_SNAPSHOT_LIMIT,
} from '../config.ts'

/** 视为「队长亲手写文件」的工具（基名，命名空间前缀由 {@link baseToolName} 剥掉）。 */
const CAPTAIN_WRITE_TOOLS: readonly string[] = ['write', 'edit']

/**
 * 取工具名的基名：`write` / `mcp__fs__write` / `fs.write` / `fs:write` 都归一成 `write`。
 *
 * 只按分隔符取**最后一段**，不做模糊匹配 —— 把 `rewrite` 认成 `write` 会让一次只读操作
 * 凭空出现在留痕里，比漏记更难解释。
 */
function baseToolName(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed === '') return ''
  const parts = trimmed.split(/__|[.:/]/)
  return (parts[parts.length - 1] ?? '').toLowerCase()
}

/** 该工具是否算「队长亲手写文件」（AC-22）。 */
export function isCaptainWriteTool(name: string): boolean {
  return CAPTAIN_WRITE_TOOLS.includes(baseToolName(name))
}

/** 路径归一：`\` → `/`、折叠 `//`、去 `./` 前缀、去首尾空白（绝对路径保留原样）。 */
function normalizePath(raw: string): string {
  let path = raw.trim().replace(/\\/g, '/')
  while (path.startsWith('./')) path = path.slice(2)
  return path.replace(/\/{2,}/g, '/')
}

/**
 * 从工具参数里取被写的路径（AC-22）。
 *
 * `write` 的宿主参数是 `{ path, content }`，`edit` 是 `{ file_path, old_string, new_string }`；
 * 两个都读（互为兜底）是因为不同宿主版本的字段名在这两者之间摇摆，而**读错的代价是漏记**。
 * 只取路径，绝不读 `content` —— 留痕里不许出现文件正文（AC-22 的隐私边界）。
 */
export function deviationPathsOf(toolName: string, args: unknown): string[] {
  if (!isCaptainWriteTool(toolName)) return []
  const record = (args !== null && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const base = baseToolName(toolName)
  const candidates: unknown[] =
    base === 'write' ? [record.path, record.file_path] : [record.file_path, record.path]
  const paths: string[] = []
  for (const value of candidates) {
    if (typeof value !== 'string') continue
    const path = normalizePath(value)
    if (path === '' || paths.includes(path)) continue
    paths.push(path)
  }
  return paths
}

/**
 * 合并键：基名 + **排序后**的路径集合（AC-24）。
 *
 * 排序让 `['a','b']` 与 `['b','a']` 落成同一条 —— 否则同一批文件换个书写顺序就会多出一行，
 * 面板上看起来像「队长又改了一次」。
 */
export function deviationKeyOf(record: Pick<DeviationView, 'toolName' | 'paths'>): string {
  const paths = record.paths.map((path) => normalizePath(path)).sort()
  return `${baseToolName(record.toolName)}|${paths.join(',')}`
}

/**
 * 60 秒窗口内的同键合并（AC-24）：返回 `count + 1` 的那一条，并标记 `merged`。
 *
 * `at` 取**新**记录的时刻（而不是保留旧时刻）：面板上「最后一次写是几秒前」比「第一次」有用；
 * 计数仍然累加，所以合并不会吞掉次数。
 */
export function mergeDeviation(
  prev: DeviationView | null,
  next: DeviationView,
  windowMs: number,
): { record: DeviationView; merged: boolean } {
  if (prev === null) return { record: next, merged: false }
  if (deviationKeyOf(prev) !== deviationKeyOf(next)) return { record: next, merged: false }
  const gap = next.at - prev.at
  // 时钟回拨（gap < 0）不合并：宁可多一条，也不要让「上一条在未来」的窗口把后面的写全吞掉。
  if (gap < 0 || gap >= windowMs) return { record: next, merged: false }
  return { record: { ...next, count: Math.max(1, prev.count ?? 1) + 1 }, merged: true }
}

/** 读原始行（坏行直接丢弃，不抛）。文件不存在 = 空列表。 */
function readRows(file: string): DeviationView[] {
  if (!existsSync(file)) return []
  const text = readFileSync(file, 'utf8')
  const rows: DeviationView[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const parsed = JSON.parse(trimmed) as Partial<DeviationView>
      if (
        typeof parsed?.at !== 'number' ||
        typeof parsed?.sessionId !== 'string' ||
        typeof parsed?.toolName !== 'string' ||
        !Array.isArray(parsed?.paths) ||
        typeof parsed?.reason !== 'string'
      ) {
        continue
      }
      rows.push({
        at: parsed.at,
        sessionId: parsed.sessionId,
        toolName: parsed.toolName,
        paths: parsed.paths.filter((path): path is string => typeof path === 'string'),
        reason: parsed.reason,
        count: typeof parsed.count === 'number' && parsed.count > 0 ? parsed.count : 1,
      })
    } catch {
      /* 坏行丢弃：一行坏掉不能让整份留痕读不出来（fail-open） */
    }
  }
  return rows
}

/** 整份重写（临时文件 + rename，避免半行写坏让下次读整份失败）。 */
function writeRows(file: string, rows: readonly DeviationView[]): void {
  mkdirSync(dirname(file), { recursive: true })
  const body = rows.map((row) => JSON.stringify(row)).join('\n')
  const tmp = `${file}.tmp`
  writeFileSync(tmp, body === '' ? '' : `${body}\n`, 'utf8')
  renameSync(tmp, file)
}

/**
 * 追加一条（或改写最后一行），返回是否写成功（AC-23：失败只返回 false，不抛）。
 *
 * 轮转：行数超过 `limit` 时**重写只保留最后 `limit/2` 行**（500 → 250）。留一半余量是为了
 * 让轮转不是每写一条就发生一次 —— 每次轮转都是整份重写，O(1) 分摊才成立。
 */
export function appendDeviation(
  file: string,
  record: DeviationView,
  windowMs: number,
  limit: number,
): boolean {
  try {
    const rows = readRows(file)
    const prev = rows.length > 0 ? (rows[rows.length - 1] ?? null) : null
    const outcome = mergeDeviation(prev, record, windowMs)
    const next = outcome.merged ? [...rows.slice(0, -1), outcome.record] : [...rows, outcome.record]
    const keep = limit > 0 ? Math.max(1, Math.floor(limit / 2)) : 0
    const capped = limit > 0 && next.length > limit ? next.slice(next.length - keep) : next
    writeRows(file, capped)
    return true
  } catch {
    return false
  }
}

/** 读最近 `limit` 条（文件顺序 = 时间顺序，返回尾部）。读失败 = 空数组（fail-open）。 */
export function readDeviations(file: string, limit: number): DeviationView[] {
  try {
    const rows = readRows(file)
    if (limit <= 0 || rows.length <= limit) return rows
    return rows.slice(rows.length - limit)
  } catch {
    return []
  }
}

export interface DeviationRecorderDeps {
  /** 落盘文件（`paths.deviationsPath(home)`，仓库外）。 */
  file: string
  /**
   * 记录归属的会话 id。由**装配层**注入：队长调用时 `exec.agent` 缺省，事件里拿不到会话，
   * 只能取装配期的默认会话（与面板 HTTP 入口同一个值，AC-28 的「同一会话两种入口」）。
   */
  sessionId: string
  now?: () => number
  mergeMs?: number
  lineLimit?: number
  reasonMax?: number
  /** 失败告警（装配层接 logger.warn）；缺省静默 —— fail-open 的第一层就是「没人听也不能抛」。 */
  warn?: (text: string) => void
}

export interface DeviationRecorder {
  record(input: { toolName: string; args: unknown }): void
  recent(limit?: number): DeviationView[]
}

/** 原因文案（宿主生成，面板原样渲染）：超长截断到 `reasonMax`。 */
function deviationReasonOf(paths: readonly string[], reasonMax: number): string {
  const body = `队长直接写入 ${paths.join('、')}`
  if (body.length <= reasonMax) return body
  return `${body.slice(0, Math.max(0, reasonMax - 1))}…`
}

/**
 * 记录器：`bridge` 只调 `recent()`，装配层只调 `record()`。
 *
 * 合并与落盘全部收敛在 `appendDeviation` 一处（见文件头），这里只负责「该不该记」与
 * 「记什么」。`record()` 返回 void：调用方（事件订阅）没有可用的失败处理，**也不该有**。
 */
export function createDeviationRecorder(deps: DeviationRecorderDeps): DeviationRecorder {
  const now = deps.now ?? (() => Date.now())
  const mergeMs = deps.mergeMs ?? DEVIATION_MERGE_MS
  const lineLimit = deps.lineLimit ?? DEVIATION_LINE_LIMIT
  const reasonMax = deps.reasonMax ?? DEVIATION_REASON_MAX
  const snapshotLimit = DEVIATION_SNAPSHOT_LIMIT
  let warned = false

  /** AC-23：只 warn 一次（同一个进程里反复写失败会把日志刷成噪音）。 */
  const failOpen = (error: unknown): void => {
    if (warned) return
    warned = true
    try {
      const message = error instanceof Error ? error.message : String(error)
      deps.warn?.(`[auto-team] 队长留痕写入失败（已忽略，不影响工具结果）：${message}`)
    } catch {
      /* warn 自身失败也不再往上抛：这是最后一道 fail-open */
    }
  }

  return {
    record(input) {
      try {
        if (!isCaptainWriteTool(input.toolName)) return
        const paths = deviationPathsOf(input.toolName, input.args)
        if (paths.length === 0) return
        const record: DeviationView = {
          at: now(),
          sessionId: deps.sessionId,
          toolName: input.toolName,
          paths,
          reason: deviationReasonOf(paths, reasonMax),
          count: 1,
        }
        if (!appendDeviation(deps.file, record, mergeMs, lineLimit)) {
          failOpen(new Error(`无法写入 ${deps.file}`))
        }
      } catch (error) {
        failOpen(error)
      }
    },

    recent(limit) {
      try {
        return readDeviations(deps.file, limit ?? snapshotLimit)
      } catch {
        return []
      }
    },
  }
}
