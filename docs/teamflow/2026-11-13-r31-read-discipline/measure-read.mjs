#!/usr/bin/env node
/**
 * r31 读取纪律基线快照脚本（口径固定、可复跑）。
 *
 * 目的：在「读取纪律」进入成员提示词**之前**，用真实成员会话量出当前的读取行为；
 * 这不是 A/B 实验，也不评价改动效果——只是给后续复测一个同口径的基线。
 *
 * 只读：源会话文件（`$DSH_HOME/sessions/<workspace>/<memberId>/session.v4.jsonl.zstd`）
 * 只被 `zstd -dc` 读取；脚本先把选中的样本拷贝到 /tmp（默认 /tmp/r31-read-baseline-sample），
 * 校验 sha256 一致后**只从副本统计**，不写源目录。
 *
 * 用法：
 *   node docs/teamflow/2026-11-13-r31-read-discipline/measure-read.mjs \
 *     [--runs <auto-team/runs 目录>] [--sessions <workspace 会话目录>] \
 *     [--sample <样本目录>] [--runs-count 20] [--json <输出文件>]
 *
 * 口径（复测必须保持一致，改了就不是对比）：
 *  - 样本：`~/.dsh/auto-team/runs/*.json` 里 `plan.status === 'terminated'` 的 run，
 *          按 `plan.createdAt` 倒序取最近 N（默认 20）个；按 binding.memberId 去重（成员可跨 run 复用），
 *          只统计该工作区存在 transcript 的成员会话。
 *  - 读类命令：`read` / `grep` 工具调用；bash 命令里出现
 *          `cat|head|tail|sed|grep|rg|awk|less|more|bat|wc` 或 `git diff|git show|git log -p`。
 *          先判测试/typecheck（命中则归测试类，不算读类），避免把门禁输出算成文件读取。
 *  - 字节：该次调用 tool/result 里 text block 的 UTF-8 字节（即真正进上下文的文本量）。
 *  - 单次 >8KB：上述字节 > 8192 的读类调用数。
 *  - 测试/typecheck 占比：bash 调用中命中 `pnpm test|node --test` 或 `pnpm typecheck|tsc --noEmit`
 *          的命令占比（一条命令同时含两者只算一次 gate）。
 *  - 会话内重复读：读事件按「文件路径」计（read 工具取 file_path，grep 取 path，
 *          bash 读命令里取带扩展名的路径 token），同一路径在本会话第 2 次及以后出现
 *          即为重复读；比例 = 重复读事件 / 全部可识别路径的读事件。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const READ_BASH = /\b(cat|head|tail|sed|grep|rg|awk|less|more|bat|wc)\b|\bgit\s+(diff|show|log\s+-p)\b/
const TEST_CMD = /(?:^|[;&|(\s])pnpm\s+test\b|node\s+--test\b/
const TYPECHECK_CMD = /(?:^|[;&|(\s])pnpm\s+typecheck\b|tsc\s+--noEmit\b/
// 路径 token：带扩展名、允许 / 与 -、允许 :行号 后缀；排除选项、/dev/*。
const FILE_TOKEN = /(?:^|[\s'"=])([A-Za-z0-9_./-]+\.[A-Za-z][A-Za-z0-9]{0,9})(?::\d+)?/g
const OVER_8K = 8192

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index >= 0 && process.argv[index + 1] !== undefined) return process.argv[index + 1]
  return fallback
}

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const repoRoot = resolve(new URL('../../../', import.meta.url).pathname)
// DSH 的 workspace 会话目录名：cwd 的每个 `/` 换成 `-`，再套 `--…--`。
const workspaceSessionDir = join(DSH_HOME, 'sessions', `-${repoRoot.replace(/\//g, '-')}--`)

const runsDir = arg('--runs', join(DSH_HOME, 'auto-team', 'runs'))
const sessionsDir = arg('--sessions', workspaceSessionDir)
const sampleDir = arg('--sample', join(tmpdir(), 'r31-read-baseline-sample'))
const runsCount = Number(arg('--runs-count', '20'))
const jsonOut = arg('--json', '')

function readRuns() {
  if (!existsSync(runsDir)) throw new Error(`runs 目录不存在：${runsDir}`)
  return readdirSync(runsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(runsDir, name), 'utf8')))
}

function selectSessions(runs) {
  const terminated = runs
    .filter((state) => state?.plan?.status === 'terminated')
    .sort((a, b) => (b.plan.createdAt ?? 0) - (a.plan.createdAt ?? 0))
  const picked = terminated.slice(0, runsCount)
  const seen = new Set()
  const candidates = []
  for (const state of picked) {
    for (const binding of state.bindings ?? []) {
      const memberId = binding?.memberId
      if (typeof memberId !== 'string' || memberId === '' || seen.has(memberId)) continue
      seen.add(memberId)
      candidates.push({
        memberId,
        runId: state.plan.runId,
        taskId: binding.taskId,
        roleId: binding.roleId,
        name: binding.name,
        spawnedAt: binding.spawnedAt ?? null,
        transcript: join(sessionsDir, memberId, 'session.v4.jsonl.zstd'),
      })
    }
  }
  return { terminatedRuns: terminated.length, pickedRuns: picked.length, candidates }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** 把样本拷到 /tmp 并校验 sha256；返回副本路径。 */
function copySample(session) {
  const targetDir = join(sampleDir, session.memberId)
  mkdirSync(targetDir, { recursive: true })
  const target = join(targetDir, 'session.v4.jsonl.zstd')
  const sourceBytes = readFileSync(session.transcript)
  writeFileSync(target, sourceBytes)
  const copyBytes = readFileSync(target)
  return {
    path: target,
    sha256: sha256(copyBytes),
    sameAsSource: sha256(copyBytes) === sha256(sourceBytes),
  }
}

function decompress(path) {
  const result = spawnSync('zstd', ['-dc', path], { maxBuffer: 512 * 1024 * 1024 })
  if (result.error) throw new Error(`zstd 解压失败（${path}）：${result.error.message}`)
  if (result.status !== 0) throw new Error(`zstd 解压失败（${path}）：${String(result.stderr).slice(0, 200)}`)
  return result.stdout.toString('utf8')
}

function parseTranscript(text) {
  const calls = []
  const results = new Map()
  let bad = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      bad += 1
      continue
    }
    if (record.type === 'tool/call') {
      calls.push(record.data)
    } else if (record.type === 'tool/result') {
      const data = record.data ?? {}
      const callId =
        data.toolCallId ??
        (data.message ?? {}).toolCallId ??
        ((data.message ?? {}).source ?? {}).callId
      if (callId) results.set(callId, record)
    }
  }
  return { calls, results, bad }
}

function textBytesOf(result) {
  const message = result?.data?.message ?? {}
  const blocks = Array.isArray(message.content) ? message.content : []
  const texts = blocks.map((block) =>
    block?.type === 'text' ? String(block.text ?? '') : JSON.stringify(block ?? null),
  )
  return Buffer.byteLength(texts.join('\n'), 'utf8')
}

function pathsOfCall(name, args, command) {
  if (name === 'read' && typeof args.file_path === 'string') return [args.file_path]
  if (name === 'grep' && typeof args.path === 'string') return [args.path]
  if (name !== 'bash') return []
  const found = new Set()
  for (const match of command.matchAll(FILE_TOKEN)) {
    const token = match[1]
    if (token.startsWith('-') || token.startsWith('/dev/')) continue
    found.add(token)
  }
  return [...found]
}

function measureSession(session, transcriptPath) {
  const { calls, results, bad } = parseTranscript(decompress(transcriptPath))
  const rows = {
    memberId: session.memberId,
    runId: session.runId,
    taskId: session.taskId,
    roleId: session.roleId,
    name: session.name,
    toolCalls: calls.length,
    readCalls: 0,
    readBytes: 0,
    over8k: 0,
    bashCalls: 0,
    testCommands: 0,
    typecheckCommands: 0,
    gateCommands: 0,
    readEvents: 0,
    duplicateReads: 0,
    badLines: bad,
  }
  const seenPaths = new Set()
  for (const call of calls) {
    const name = String(call?.name ?? '')
    let args = {}
    try {
      args = JSON.parse(String(call?.arguments ?? '{}'))
    } catch {
      args = {}
    }
    const result = results.get(call?.callId)
    const bytes = textBytesOf(result)
    const command = name === 'bash' ? String(args.command ?? '') : ''

    let kind = 'other'
    if (name === 'read' || name === 'grep') {
      kind = 'read'
    } else if (name === 'bash') {
      rows.bashCalls += 1
      const isTest = TEST_CMD.test(command)
      const isTypecheck = TYPECHECK_CMD.test(command)
      if (isTest) rows.testCommands += 1
      if (isTypecheck) rows.typecheckCommands += 1
      if (isTest || isTypecheck) {
        rows.gateCommands += 1
        kind = 'gate'
      } else if (READ_BASH.test(command)) {
        kind = 'read'
      }
    }

    if (kind !== 'read') continue
    rows.readCalls += 1
    rows.readBytes += bytes
    if (bytes > OVER_8K) rows.over8k += 1
    for (const path of pathsOfCall(name, args, command)) {
      rows.readEvents += 1
      if (seenPaths.has(path)) rows.duplicateReads += 1
      else seenPaths.add(path)
    }
  }
  return rows
}

function median(numbers) {
  if (numbers.length === 0) return 0
  const sorted = [...numbers].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function main() {
  const runs = readRuns()
  const { terminatedRuns, pickedRuns, candidates } = selectSessions(runs)
  const selected = candidates.filter((candidate) => existsSync(candidate.transcript))
  const copied = []
  for (const session of selected) {
    const sample = copySample(session)
    copied.push({ ...session, sample })
  }
  const perSession = copied.map((session) => measureSession(session, session.sample.path))
  const sum = (key) => perSession.reduce((total, row) => total + row[key], 0)
  const totals = {
    sessions: perSession.length,
    toolCalls: sum('toolCalls'),
    readCalls: sum('readCalls'),
    readBytes: sum('readBytes'),
    over8k: sum('over8k'),
    bashCalls: sum('bashCalls'),
    testCommands: sum('testCommands'),
    typecheckCommands: sum('typecheckCommands'),
    gateCommands: sum('gateCommands'),
    readEvents: sum('readEvents'),
    duplicateReads: sum('duplicateReads'),
  }
  const shares = {
    readShareOfToolCalls: totals.toolCalls === 0 ? 0 : totals.readCalls / totals.toolCalls,
    over8kShareOfReadCalls: totals.readCalls === 0 ? 0 : totals.over8k / totals.readCalls,
    gateShareOfBashCalls: totals.bashCalls === 0 ? 0 : totals.gateCommands / totals.bashCalls,
    duplicateReadShare: totals.readEvents === 0 ? 0 : totals.duplicateReads / totals.readEvents,
  }
  const bytesPerSession = perSession.map((row) => row.readBytes)
  const report = {
    generatedAt: new Date().toISOString(),
    criteria: {
      sample: `最近 ${runsCount} 个 terminated run 的成员会话（按 memberId 去重，仅统计有 transcript 的）`,
      readClass:
        'read/grep 工具 + bash 中的 cat/head/tail/sed/grep/rg/awk/less/more/bat/wc/git diff/git show/git log -p（命中测试/typecheck 的 bash 先归测试类）',
      bytes: 'tool/result 中 text block 的 UTF-8 字节',
      over8k: `单次读类调用 > ${OVER_8K} 字节`,
      gateShare: 'bash 中含 pnpm test|node --test 或 pnpm typecheck|tsc --noEmit 的命令占比（或运算去重）',
      duplicateRead: '同一路径在本会话第 2 次及以后读 = 重复读；比例 = 重复读事件 / 全部可识别路径读事件',
    },
    source: {
      repoRoot,
      runsDir,
      sessionsDir,
      sampleDir,
      terminatedRuns,
      pickedRuns,
      candidateMembers: candidates.length,
      sessionsMeasured: perSession.length,
      sessionsWithoutTranscript: candidates.length - perSession.length,
    },
    sampleIntegrity: {
      allCopiesMatchSource: copied.every((session) => session.sample.sameAsSource),
      copies: copied.map((session) => ({
        memberId: session.memberId,
        sha256: session.sample.sha256,
        path: session.sample.path,
      })),
    },
    totals,
    shares,
    perSessionBytes: {
      min: bytesPerSession.length === 0 ? 0 : Math.min(...bytesPerSession),
      median: median(bytesPerSession),
      max: bytesPerSession.length === 0 ? 0 : Math.max(...bytesPerSession),
      total: totals.readBytes,
    },
    perSession,
  }
  const json = JSON.stringify(report, null, 2)
  if (jsonOut !== '') writeFileSync(jsonOut, `${json}\n`)
  process.stdout.write(`${json}\n`)
}

main()
