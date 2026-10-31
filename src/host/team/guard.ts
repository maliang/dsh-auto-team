/**
 * noWait 守卫（**纯逻辑**：无 IO、无宿主 API、无定时器、不读任务/运行状态）。
 *
 * 为什么单独成模块：守卫要在 `tools/execute`（waterfall）里对队长的每一次 `bash` 做判定，
 * 而判定本身必须能被 `node --test` 直接跑 —— 这是 AC-6「短路成恒放行后 AC-4 必然变红」
 * 能成立的前提（判定与宿主绑定分开，绑定失败不会让判定本身失去覆盖）。
 *
 * 判据是**段首命令语义 + 时长**，不是字符串包含 `sleep`。理由写在 PRD anti-goal 1：
 * 守卫把队长自己的工作挡死，比不守卫更糟。所以 `echo sleep`、`grep -r sleep src/`、
 * `(sleep 30) &`、`git status` 一律放行，只有「段首就是 sleep/wait/tail -f 且前台同步」才拒。
 *
 * 依赖限制：只 import `../config.ts`（纯常量，自身只 import `shared/const.ts`），不 import
 * 任何带宿主形状或 IO 的模块。阈值以**参数**形式收进来（与 `stall.ts` 的 `stallMs` 同一纪律：
 * 单一定义在 config、可注入不同值做边界单测），缺省即 `NOWAIT_THRESHOLD_MS`。
 *
 * 失败方向：一律 fail-open —— 解析不出来、参数形状不认识、嵌套太深，全部放行。
 * 守卫的失败模式只能是「少拦一次」，不能是「拦住正常工作」。
 */
import { NOWAIT_THRESHOLD_MS } from '../config.ts'

/** 拒绝原因码（恰 3 个，与 PRD AC-4 的「可读原因码」一一对应）。 */
export type GuardCode = 'NOWAIT_FOREGROUND_WAIT' | 'NOWAIT_UNBOUNDED_OUTPUT' | 'NOWAIT_BLOCKING_TTY'

/** 守卫入参：`role` 决定是否适用（只作用于队长），`args` 是宿主 `bash` 工具的原始参数。 */
export interface GuardRequest {
  role: 'captain' | 'member'
  toolName: string
  args: unknown
}

/** 守卫结论：放行不带字段，拒绝带原因码 + 可读文案 + 命中的那一段命令。 */
export type GuardVerdict =
  | { allow: true }
  | { allow: false; code: GuardCode; message: string; command: string }

/** 一段（按 `;`/`&&`/`||`/`|`/换行切开后的）命令，以及它是否后台执行。 */
export interface CommandSegment {
  text: string
  background: boolean
}

/** 递归解析 `bash -c '<payload>'` 的层数上限（防 `bash -c "bash -c 'sleep 30'"` 无限套娃）。 */
const MAX_NEST_DEPTH = 2

/** 文案里回显命令的长度上限：拒绝信息要可读，但不能把整条长命令塞进模型上下文。 */
const ECHO_MAX = 160

/** 秒/毫秒换算表（`sleep 2m30s` 这类复合时长用）。 */
const UNIT_MS: Readonly<Record<string, number>> = {
  '': 1_000, // `sleep 30` = 30 秒
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

/** 剥离前缀时忽略的「包装命令」：它们不改变段首语义，只挡在前面。 */
const PREFIX_WORDS = new Set([
  'sudo',
  'time',
  'nohup',
  'command',
  'exec',
  'builtin',
  'env',
  'do',
  'then',
  'else',
])

/** 这些包装命令的部分选项要吃一个值（`sudo -u root sleep 30`），剥离时要连着值一起丢。 */
const PREFIX_FLAGS_WITH_VALUE = new Set([
  '-u',
  '-g',
  '-p',
  '-C',
  '-U',
  '-r',
  '-t',
  '-D',
  '--user',
  '--group',
  '--chdir',
  '--prompt',
])

/** 段首是这些命令就是「无界输出」：要么永远不退出，要么持续刷屏。 */
const UNBOUNDED_ALWAYS = new Set(['watch', 'yes', 'top'])

/** 交互式分页器/编辑器：进前台就是等人工操作，编排会卡死。 */
const PAGERS_AND_EDITORS = new Set(['less', 'more', 'vi', 'vim', 'nano'])

/** shell 家族：`-c` 后面的 payload 要递归解析。 */
const SHELL_NAMES = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'])

/** `ssh` 的这些选项吃一个值（判断「有没有远程命令」时要跳过）。 */
const SSH_FLAGS_WITH_VALUE = new Set([
  '-p',
  '-i',
  '-o',
  '-l',
  '-L',
  '-R',
  '-D',
  '-F',
  '-J',
  '-b',
  '-c',
  '-e',
  '-m',
  '-O',
  '-Q',
  '-S',
  '-W',
  '-w',
  '-E',
])

/**
 * 把一条 shell 命令按**未转义**的 `;` / `&&` / `||` / `|` / 换行切成段。
 *
 * 后台判定有两条来源，缺一不可：
 * ① 段尾单个 `&`（不是 `&&`）—— `sleep 30 &`；
 * ② 段被 `( … ) &` 包裹 —— 切段时 `&` 已经消费掉了，所以由「`&` 标记前一段为后台」覆盖。
 *
 * 引号内的分隔符不算分隔符（`echo "a;b"` 是一段）；`2>&1` / `&>` 这类重定向里的 `&`
 * 也不是后台标记 —— 这是最容易误杀正常命令的一处，单独判。
 */
export function segmentsOf(command: string): CommandSegment[] {
  const out: CommandSegment[] = []
  let buffer = ''
  let quote: '"' | "'" | null = null

  const push = (text: string, background: boolean): void => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    out.push({ text: trimmed, background })
  }

  for (let i = 0; i < command.length; i += 1) {
    const char = command.charAt(i)

    if (quote !== null) {
      buffer += char
      if (char === '\\' && quote === '"') {
        buffer += command.charAt(i + 1)
        i += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }

    if (char === '\\') {
      buffer += char + command.charAt(i + 1)
      i += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      buffer += char
      continue
    }
    if (char === '\n' || char === ';') {
      push(buffer, false)
      buffer = ''
      continue
    }
    if (char === '&') {
      const prev = command.charAt(i - 1)
      const next = command.charAt(i + 1)
      // 重定向里的 `&`（`2>&1`、`&>log`）不是后台标记。
      if (prev === '>' || prev === '<' || next === '>') {
        buffer += char
        continue
      }
      if (next === '&') {
        push(buffer, false)
        buffer = ''
        i += 1
        continue
      }
      // 单个 `&`：前一段是后台执行。
      push(buffer, true)
      buffer = ''
      continue
    }
    if (char === '|') {
      if (command.charAt(i + 1) === '|') {
        push(buffer, false)
        buffer = ''
        i += 1
        continue
      }
      push(buffer, false)
      buffer = ''
      continue
    }
    buffer += char
  }

  push(buffer, false)
  return out
}

/**
 * 解析 `sleep` 的时长（毫秒）：支持 `30` / `1.5` / `2m30s` / `1h` / `100ms` / `infinity`。
 *
 * @returns 非 `sleep` 命令或时长不可解析 → `null`（调用方据此 fail-open 放行）
 */
export function sleepMsOf(command: string): number | null {
  const words = stripPrefixes(tokensOf(command))
  const name = baseNameOf(words[0] ?? '')
  if (name !== 'sleep') return null
  return durationMsOf(words.slice(1))
}

/**
 * 这条命令是否属于「队长不得前台同步执行」的一类。
 *
 * 刻意复用 `guardOf` 的判定而不是另写一份包含匹配：探针与单测都从这里取结论，
 * 保证「测试里认为该拒的」和「运行期真拒的」是同一套判据（同一类风险只留一道实现）。
 */
export function isCaptainCommand(command: string): boolean {
  return guardOf({ role: 'captain', toolName: 'bash', args: { command } }).allow === false
}

/**
 * 守卫主判定。只看 `toolName === 'bash'` 且 `role === 'captain'`，其余一律放行。
 *
 * @param thresholdMs 前台同步等待阈值（毫秒）。缺省取 `config.NOWAIT_THRESHOLD_MS`；
 *                    单测可注入更小的值验边界，不必改常量。
 */
export function guardOf(
  request: GuardRequest,
  thresholdMs: number = NOWAIT_THRESHOLD_MS,
): GuardVerdict {
  if (request.role !== 'captain') return { allow: true }
  if (request.toolName !== 'bash') return { allow: true }

  const command = commandOf(request.args)
  if (command === null) return { allow: true }

  const threshold = Number.isFinite(thresholdMs) && thresholdMs > 0 ? thresholdMs : NOWAIT_THRESHOLD_MS

  for (const segment of segmentsOf(command)) {
    if (segment.background) continue
    const hit = inspectTokens(tokensOf(segment.text), 0, threshold)
    if (hit !== null) {
      return { allow: false, code: hit.code, message: messageOf(hit.code, hit.command), command: hit.command }
    }
  }

  return { allow: true }
}

/* ───────────────────────────── 内部实现 ───────────────────────────── */

interface Hit {
  code: GuardCode
  command: string
}

/** 从工具参数里取命令字符串；形状不认识（缺字段/非字符串）→ `null`（放行）。 */
function commandOf(args: unknown): string | null {
  if (args === null || typeof args !== 'object') return null
  const command = (args as { command?: unknown }).command
  return typeof command === 'string' ? command : null
}

/** 逐段判定：命中即返回，未命中返回 `null`。 */
function inspectTokens(tokens: string[], depth: number, thresholdMs: number): Hit | null {
  const words = stripPrefixes(tokens)
  if (words.length === 0) return null

  const name = baseNameOf(words[0] ?? '')
  const rest = words.slice(1)
  const text = words.join(' ')

  // `bash -c 'sleep 30'`：payload 才是真正的命令，必须递归（层数有限，深了放行）。
  if (SHELL_NAMES.has(name)) {
    const payload = shellPayloadOf(rest)
    if (payload !== null && depth < MAX_NEST_DEPTH) {
      for (const segment of segmentsOf(payload)) {
        if (segment.background) continue
        const hit = inspectTokens(tokensOf(segment.text), depth + 1, thresholdMs)
        if (hit !== null) return hit
      }
    }
    return null
  }

  // ① 前台同步等待：`sleep` 时长超阈值（`sleep infinity` = 永久，也走这条）。
  if (name === 'sleep') {
    const durationMs = durationMsOf(rest)
    if (durationMs !== null && durationMs >= thresholdMs) {
      return { code: 'NOWAIT_FOREGROUND_WAIT', command: text }
    }
    return null
  }

  // ② 无界输出 / 交互式前台。
  if (UNBOUNDED_ALWAYS.has(name)) return { code: 'NOWAIT_UNBOUNDED_OUTPUT', command: text }
  if (PAGERS_AND_EDITORS.has(name)) return { code: 'NOWAIT_UNBOUNDED_OUTPUT', command: text }
  if (name === 'tail' && followsTail(rest)) return { code: 'NOWAIT_UNBOUNDED_OUTPUT', command: text }
  if (name === 'ssh' && isInteractiveSsh(rest)) return { code: 'NOWAIT_UNBOUNDED_OUTPUT', command: text }

  // ③ 同步阻塞等待（没有超时，等到天荒地老）。
  if (name === 'wait' && rest.every((token) => token.startsWith('-'))) {
    return { code: 'NOWAIT_BLOCKING_TTY', command: text }
  }
  if (name === 'read' && !hasReadTimeout(rest)) {
    return { code: 'NOWAIT_BLOCKING_TTY', command: text }
  }

  return null
}

/** 剥掉前导 `(`/`{`/`!`、环境变量赋值、包装命令（含它们吃值的选项）。 */
function stripPrefixes(tokens: string[]): string[] {
  // 先剥「分组括号」：`(sleep 30)` 在词法上是 `(sleep` + `30)` 两个 token，
  // 不先归一化就会被当成一条段首为 `(sleep` 的命令，导致漏判（放行 = 少拦一次）。
  const words = tokens.map((token, index) => {
    let text = token
    if (index === 0) text = text.replace(/^[({!]+/, '')
    if (index === tokens.length - 1) text = text.replace(/[)}]+$/, '')
    return text
  })

  let index = 0
  for (;;) {
    const token = words[index]
    if (token === undefined) break
    if (token.length === 0) {
      index += 1
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1
      continue
    }
    const name = baseNameOf(token)
    if (PREFIX_WORDS.has(name)) {
      index += 1
      // `sudo -u root …` / `time -p …`：包装命令自己的选项连着值一起丢。
      while (words[index] !== undefined && (words[index] ?? '').startsWith('-')) {
        const flag = words[index] ?? ''
        index += 1
        if (PREFIX_FLAGS_WITH_VALUE.has(flag)) index += 1
      }
      continue
    }
    break
  }
  return words.slice(index).filter((token) => token.length > 0)
}

/** 词法切分（处理引号与反斜杠），得到「参数级」token。 */
function tokensOf(text: string): string[] {
  const out: string[] = []
  let current = ''
  let started = false
  let quote: '"' | "'" | null = null

  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i)

    if (quote !== null) {
      if (char === '\\' && quote === '"') {
        current += text.charAt(i + 1)
        i += 1
        started = true
        continue
      }
      if (char === quote) {
        quote = null
        continue
      }
      current += char
      started = true
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      started = true
      continue
    }
    if (char === '\\') {
      current += text.charAt(i + 1)
      i += 1
      started = true
      continue
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      if (started) {
        out.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }

  if (started) out.push(current)
  return out
}

/** 取命令名的 basename（`/bin/sleep` → `sleep`），并小写化。 */
function baseNameOf(token: string): string {
  const trimmed = token.trim()
  if (trimmed.length === 0) return ''
  const slash = trimmed.lastIndexOf('/')
  return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).toLowerCase()
}

/** 从 `sleep` 的参数里算总时长；多个参数按 GNU sleep 语义累加。 */
function durationMsOf(args: string[]): number | null {
  let total = 0
  let parsed = false
  for (const arg of args) {
    if (arg === 'infinity' || arg === 'inf') return Number.POSITIVE_INFINITY
    const part = durationOf(arg)
    if (part === null) continue
    total += part
    parsed = true
  }
  return parsed ? total : null
}

/** 单个时长 token（`30` / `1.5` / `2m30s` / `100ms`）→ 毫秒；不可解析 → `null`。 */
function durationOf(token: string): number | null {
  if (token.length === 0) return null
  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d)?/gi
  let total = 0
  let consumed = 0
  let matched = false
  for (;;) {
    const match = pattern.exec(token)
    if (match === null) break
    const amount = Number(match[1])
    const unit = (match[2] ?? '').toLowerCase()
    const factor = UNIT_MS[unit]
    if (!Number.isFinite(amount) || factor === undefined) return null
    total += amount * factor
    consumed += match[0].length
    matched = true
  }
  if (!matched || consumed !== token.length) return null
  return total
}

/** `bash -c '<payload>'` / `bash -lc '<payload>'` 里取 payload；没有 `-c` → `null`。 */
function shellPayloadOf(rest: string[]): string | null {
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? ''
    if (token === '-c' || token === '--command') return rest[i + 1] ?? null
    if (token.startsWith('-') && !token.startsWith('--')) {
      const at = token.indexOf('c')
      if (at > 0) {
        const inline = token.slice(at + 1)
        if (inline.length > 0) return inline
        return rest[i + 1] ?? null
      }
    }
  }
  return null
}

/** `tail -f` / `tail -F` / `tail -n5 -f` / `tail --follow=name`。 */
function followsTail(rest: string[]): boolean {
  return rest.some((token) => {
    if (token.startsWith('--')) return token.startsWith('--follow')
    if (!token.startsWith('-')) return false
    return /[fF]/.test(token.slice(1))
  })
}

/**
 * 交互式 ssh：没有 `-T`（禁用伪终端）**且**没有远程命令 —— 也就是直接开一个登录 shell。
 * 带远程命令的 `ssh host 'ls'` 是有界的，不能拦（AC-5「不误杀」）。
 */
function isInteractiveSsh(rest: string[]): boolean {
  if (rest.some((token) => token === '-T' || token.startsWith('-T'))) return false
  let hostSeen = false
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? ''
    if (token.startsWith('-')) {
      if (SSH_FLAGS_WITH_VALUE.has(token)) i += 1
      continue
    }
    if (!hostSeen) {
      hostSeen = true
      continue
    }
    return false // 主机后面还有参数 = 远程命令，有界
  }
  return true
}

/** `read -t 5 var` 有超时就不算阻塞（`-n` 只是长度，不算超时）。 */
function hasReadTimeout(rest: string[]): boolean {
  return rest.some((token) => /^-[A-Za-z]*t/.test(token) || token === '--timeout')
}

/** 拒绝文案：原因码 + 命中命令 + 一句「下一步怎么做」（AC-4 要求可读、可执行）。 */
function messageOf(code: GuardCode, command: string): string {
  const echoed = command.length > ECHO_MAX ? `${command.slice(0, ECHO_MAX)}…` : command
  if (code === 'NOWAIT_FOREGROUND_WAIT') {
    return `前台同步等待被拒绝（NOWAIT_FOREGROUND_WAIT）：\`${echoed}\` 会阻塞整个编排。下一步：改成后台执行（命令末尾加 &），或用 auto_team_message 把这个等待派给成员。`
  }
  if (code === 'NOWAIT_UNBOUNDED_OUTPUT') {
    return `无界输出/交互式命令被拒绝（NOWAIT_UNBOUNDED_OUTPUT）：\`${echoed}\` 会占住前台并持续输出或等待人工操作。下一步：加超时与输出上限（如 \`timeout 5 … | head -50\`），或后台执行后再读日志。`
  }
  return `同步阻塞等待被拒绝（NOWAIT_BLOCKING_TTY）：\`${echoed}\` 没有超时，会一直等下去。下一步：加超时（\`read -t 5\` / 指定 pid 的 \`wait\`），或改成后台执行。`
}
