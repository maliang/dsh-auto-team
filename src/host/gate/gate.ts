/**
 * 质量门禁：把任务的 `acceptance` 命令真正跑一遍，落全量日志、裁剪尾部证据（AC-19）。
 *
 * 两个必须守住的点：
 *  1. **绝不能同步执行**：旧实现用 `spawnSync`，最长阻塞事件循环 300s —— 面板轮询停摆，
 *     前面 AC-18 的 5 秒预算直接不成立。这里改成纯 Promise + 子进程，宿主线程始终可响应。
 *  2. **内存只留尾部**：全量输出流式写 `${artifactsDir}/${taskId}.log`，内存里只保留末尾
 *     GATE_TAIL_CHARS（4000）字符作为证据；一个跑完整测试套件的门禁能输出几十 MB。
 *
 * `exec` 是注入点：超时、SIGKILL、非零退出、启动失败这些分支不必真跑 shell 就能单测，
 * 否则「超时分支」只能靠等 5 分钟或伪造系统时间。
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GateEvidence, PlanTask } from '../../shared/types.ts'
import { GATE_FLUSH_TIMEOUT_MS, GATE_TAIL_CHARS, GATE_TIMEOUT_MS } from '../config.ts'

export interface GateOutcome {
  ok: boolean
  evidence: GateEvidence
}

export interface GateDeps {
  cwd: string
  artifactsDir: string
  /**
   * 证据时间戳。允许直接给数字，也允许给取时函数——bridge 是把自己的 `now()` 传进来的
   * （它在每个动作入口取一次时间），两种形态都接受，避免上层为了传值再造一层包装。
   */
  now?: number | (() => number)
  timeoutMs?: number
  /** 注入执行器（缺省真跑 shell）；返回 null 退出码表示超时/被信号杀。 */
  exec?: GateExec
}

/** 执行一条验收命令：退出码 + 尾部文本。退出码 null = 超时或被信号杀。 */
export type GateExec = (
  command: string,
  opts: { cwd: string; timeoutMs: number; logPath: string },
) => Promise<{ code: number | null; tail: string }>

/** 空验收命令的证据文案（与 bridge 的 GATE_FAILED 提示保持一致口径）。 */
export const EMPTY_ACCEPTANCE_TAIL = '该任务没有验收命令，需要人工确认后放行'

/** 跑门禁：全量日志落盘，只把尾部带回内存。 */
export async function runGate(task: PlanTask, deps: GateDeps): Promise<GateOutcome> {
  const now = typeof deps.now === 'function' ? deps.now() : (deps.now ?? Date.now())
  const command = (task.acceptance ?? '').trim()

  if (command === '') {
    return {
      ok: false,
      evidence: { taskId: task.id, command, exitCode: -1, tail: EMPTY_ACCEPTANCE_TAIL, artifacts: [], at: now },
    }
  }

  const timeoutMs = deps.timeoutMs ?? GATE_TIMEOUT_MS
  const exec = deps.exec ?? defaultGateExec
  const logPath = join(deps.artifactsDir, `${safeFileName(task.id)}.log`)

  try {
    mkdirSync(deps.artifactsDir, { recursive: true })
  } catch {
    /* 目录已存在或被并发创建，交给下面的写日志兜底 */
  }

  let result: { code: number | null; tail: string }
  try {
    result = await exec(command, { cwd: deps.cwd, timeoutMs, logPath })
  } catch (error) {
    result = { code: null, tail: `验收命令执行失败：${error instanceof Error ? error.message : String(error)}` }
  }

  // 注入了假 exec 的测试可能没写日志：补一份最小日志，产物路径不能指向空气。
  if (!existsSync(logPath)) {
    try {
      writeFileSync(logPath, `# task: ${task.id}\n# command: ${command}\n# exit: ${result.code ?? 'unknown'}\n\n${result.tail}\n`, 'utf8')
    } catch {
      /* 落日志失败不影响证据结论 */
    }
  }

  return {
    ok: result.code === 0,
    evidence: {
      taskId: task.id,
      command,
      exitCode: result.code,
      tail: tailOf(result.tail, GATE_TAIL_CHARS),
      artifacts: [logPath],
      at: now,
    },
  }
}

/**
 * 缺省执行器：`spawn(command,{shell:true})` + 超时 SIGKILL。
 * 全量输出流进 logPath，内存只滚动保留尾部，避免大输出把宿主内存打爆。
 */
export function defaultGateExec(
  command: string,
  opts: { cwd: string; timeoutMs: number; logPath: string },
): Promise<{ code: number | null; tail: string }> {
  return new Promise((resolve) => {
    let tail = ''
    let timedOut = false
    let settled = false
    let stream: ReturnType<typeof createWriteStream> | null = null

    try {
      stream = createWriteStream(opts.logPath, { flags: 'w', encoding: 'utf8' })
      stream.on('error', () => {
        stream = null
      })
      stream.write(`# command: ${command}\n\n`)
    } catch {
      stream = null
    }

    const child = spawn(command, { cwd: opts.cwd, shell: true })
    const sink = (chunk: string): void => {
      tail = (tail + chunk).slice(-GATE_TAIL_CHARS)
      try {
        stream?.write(chunk)
      } catch {
        /* 磁盘写失败不拦证据 */
      }
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => sink(chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => sink(chunk))

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs)

    const finish = (code: number | null, note?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const suffix = note ? `\n# ${note}` : ''
      const text = note ? `${note}\n${tail}` : tail
      const target = stream
      stream = null

      // 必须等写流真正 close 再 resolve：`end()` 只是把数据交给内核，立刻返回会让调用方
      // （回执/证据抽屉）读到空文件或半截日志，看起来像「验收命令没有输出」。
      // 单独跑测试看不出来，整套并行跑时这个竞态必现 —— 所以这里等事件，不等时间。
      let done = false
      const settle = (): void => {
        if (done) return
        done = true
        resolve({ code, tail: text })
      }
      if (!target) {
        settle()
        return
      }
      const guard = setTimeout(settle, GATE_FLUSH_TIMEOUT_MS)
      const flushed = (): void => {
        clearTimeout(guard)
        settle()
      }
      target.once('close', flushed)
      target.once('error', flushed)
      try {
        target.end(`\n# exit: ${code === null ? 'timeout-or-signal' : code}${suffix}\n`)
      } catch {
        flushed()
      }
    }

    child.on('error', (error: Error) => {
      finish(null, `启动失败：${error.message}`)
    })
    child.on('close', (code: number | null) => {
      if (timedOut) {
        finish(null, `超时（${opts.timeoutMs}ms）已被 SIGKILL 终止`)
        return
      }
      finish(code)
    })
  })
}

/** 只保留尾部 limit 字符，并显式标注前面省略了多少（AC-19 要求「不能假装是全量」）。 */
export function tailOf(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `…（前 ${text.length - limit} 字符已省略，全文见产物文件）\n${text.slice(-limit)}`
}

function safeFileName(taskId: string): string {
  const cleaned = taskId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned === '' ? 'gate' : cleaned.slice(0, 40)
}
