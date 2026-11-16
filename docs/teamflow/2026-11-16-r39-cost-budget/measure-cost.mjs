#!/usr/bin/env node
/**
 * r39 成本度量：把「一次 run 到底花了多少」变成可复跑的数字。
 *
 * 用法（在仓库根跑，脚本不依赖仓库内模块）：
 *   node docs/teamflow/2026-11-16-r39-cost-budget/measure-cost.mjs
 *   node docs/teamflow/2026-11-16-r39-cost-budget/measure-cost.mjs --run run-mwiqveqm
 *   node docs/teamflow/2026-11-16-r39-cost-budget/measure-cost.mjs --usage-only --first 28
 *   node docs/teamflow/2026-11-16-r39-cost-budget/measure-cost.mjs --since 2026-11-16 --json
 *
 * 数据源与口径（写报告前先读这段，别把两种口径混着比）：
 *  - token / calls / cacheRead **只**来自 `$DSH_HOME/auto-team/runs/<runId>.json` 的
 *    `usage.byTask` / `usage.byMember`（宿主只在 run 状态里记账，成员会话 JSONL 里没有 usage）。
 *  - 工具调用数 / 字符数 / compress 次数 / 墙钟来自成员会话
 *    `$DSH_HOME/sessions/<workspace>/<memberId>/session.v4.jsonl.zstd`（zstd 解压后逐行 JSON）。
 *    `memberId` 由 run 的 `bindings[]` 给出，按目录名全局查找（成员会话可能落在任意 workspace 目录）。
 *  - toolCalls = `tool/call` 记录数；compressCalls = 其中 `data.name === 'compress'`；
 *    assistantChars = `assistant/message` 里 text 块 + tool-call arguments 的字符数；
 *    toolResultChars = `tool/result` 里 text 块字符数；wall = 记录 `time` 首末差。
 *  - 一个成员会话被同一 run 的多个任务复用时，字符数只算给该成员最早的那张任务卡
 *    （token 仍按 `usage.byTask` 精确归属），输出里标 `shared`，避免重复计数。
 *  - 会话找不到时 run 级 token 仍然有效（来自 run JSON），字符/工具数记 0 并在 `missingSessions` 里列出。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const HELP = `r39 成本度量（可复跑）

用法：
  node measure-cost.mjs [runId前缀] [选项]

选项：
  --run <prefix>        只统计 runId 以 prefix 开头的 run（等价于位置参数）
  --since <time>        只统计 plan.createdAt >= time（ISO 或毫秒）
  --until <time>        只统计 plan.createdAt <= time（ISO 或毫秒）
  --usage-only          跳过没有任何 usage 记账的 run（报告基线用的口径）
  --first <n>           按 createdAt 升序取前 n 个（复现历史基线用）
  --json                输出机器可读 JSON（默认是人类可读表）
  --home <dir>          DSH_HOME，缺省 $DSH_HOME 或 ~/.dsh
  --runs-dir <dir>      run 状态目录，缺省 <home>/auto-team/runs
  --sessions-dir <dir>  会话目录，缺省 <home>/sessions
  -h, --help            显示本帮助
`

function parseArgs(argv) {
  const options = {
    runPrefix: '',
    since: null,
    until: null,
    usageOnly: false,
    first: 0,
    json: false,
    home: process.env.DSH_HOME || join(homedir(), '.dsh'),
    runsDir: null,
    sessionsDir: null,
  }
  const takeValue = (index, flag) => {
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} 缺少取值`)
    return value
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') {
      options.help = true
    } else if (arg === '--run') {
      options.runPrefix = takeValue(index, '--run')
      index += 1
    } else if (arg === '--since') {
      options.since = parseTime(takeValue(index, '--since'))
      index += 1
    } else if (arg === '--until') {
      options.until = parseTime(takeValue(index, '--until'))
      index += 1
    } else if (arg === '--first') {
      options.first = Number(takeValue(index, '--first'))
      if (!Number.isInteger(options.first) || options.first <= 0) throw new Error('--first 必须是正整数')
      index += 1
    } else if (arg === '--usage-only') {
      options.usageOnly = true
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--home') {
      options.home = takeValue(index, '--home')
      index += 1
    } else if (arg === '--runs-dir') {
      options.runsDir = takeValue(index, '--runs-dir')
      index += 1
    } else if (arg === '--sessions-dir') {
      options.sessionsDir = takeValue(index, '--sessions-dir')
      index += 1
    } else if (arg.startsWith('--')) {
      throw new Error(`未知选项 ${arg}`)
    } else if (!options.runPrefix) {
      options.runPrefix = arg
    } else {
      throw new Error(`多余的参数 ${arg}`)
    }
  }
  options.runsDir = options.runsDir ?? join(options.home, 'auto-team', 'runs')
  options.sessionsDir = options.sessionsDir ?? join(options.home, 'sessions')
  return options
}

function parseTime(text) {
  const asNumber = Number(text)
  if (Number.isFinite(asNumber) && String(asNumber) === text.trim()) return asNumber
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) throw new Error(`时间看不懂：${text}（用 ISO 或毫秒）`)
  return parsed
}

/* --------------------------------------------------------------- run 读取 */

function loadRuns(options) {
  if (!existsSync(options.runsDir)) {
    throw new Error(`run 目录不存在：${options.runsDir}（用 --runs-dir 指定）`)
  }
  const runs = []
  for (const name of readdirSync(options.runsDir)) {
    if (!name.endsWith('.json')) continue
    const file = join(options.runsDir, name)
    let state
    try {
      state = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      runs.push({ runId: name.slice(0, -5), file, broken: String(error?.message ?? error) })
      continue
    }
    const runId = String(state?.plan?.runId ?? name.slice(0, -5))
    runs.push({ runId, file, state })
  }

  let selected = runs.filter((entry) => entry.runId.startsWith(options.runPrefix))
  selected = selected.filter((entry) => {
    if (entry.broken) return false
    const createdAt = Number(entry.state?.plan?.createdAt ?? 0)
    if (options.since !== null && createdAt < options.since) return false
    if (options.until !== null && createdAt > options.until) return false
    if (options.usageOnly && tokenTotals(entry.state?.usage?.byMember ?? entry.state?.usage?.total).calls <= 0) return false
    return true
  })
  selected.sort((left, right) => Number(left.state?.plan?.createdAt ?? 0) - Number(right.state?.plan?.createdAt ?? 0))
  if (options.first > 0) selected = selected.slice(0, options.first)
  return { selected, broken: runs.filter((entry) => entry.broken), all: runs.filter((entry) => !entry.broken) }
}

/* ------------------------------------------------------------ usage 汇总 */

function emptyTotals() {
  return { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 }
}

function addTotals(target, source) {
  if (!source || typeof source !== 'object') return target
  for (const key of Object.keys(target)) {
    const value = Number(source[key] ?? 0)
    if (Number.isFinite(value)) target[key] += value
  }
  return target
}

function tokenTotals(usageLike) {
  const totals = emptyTotals()
  if (!usageLike || typeof usageLike !== 'object') return totals
  if (Array.isArray(usageLike)) {
    for (const item of usageLike) addTotals(totals, item)
    return totals
  }
  // usage.byMember / usage.byTask 是 map；usage.total 是单个对象。
  if (typeof usageLike.total === 'number') return addTotals(totals, usageLike)
  for (const value of Object.values(usageLike)) addTotals(totals, value)
  return totals
}

/* --------------------------------------------------------- 会话索引/解析 */

/**
 * 一个成员上下文（memberId 目录）可能被同一会话里的多个 run 复用（续聊/返工）。
 * 会话 JSONL 里没有 runId，所以按 `bindings.spawnedAt` 把时间轴切成互不重叠的段：
 * 第 i 个 run 的段 = [本 run 的 spawnedAt, 下一个绑定同一成员 run 的 spawnedAt)；
 * 最后一个 run 到无穷。这样每个 run 的步数/字符数不会被同成员的历史 run 重复计数。
 */
function buildMemberSegments(allRuns) {
  const byMember = new Map()
  for (const entry of allRuns) {
    const plan = entry.state?.plan ?? {}
    for (const binding of entry.state?.bindings ?? []) {
      const memberId = binding?.memberId
      if (!memberId) continue
      const start = Number(binding.spawnedAt ?? plan.createdAt ?? 0)
      const list = byMember.get(memberId) ?? []
      const known = list.find((segment) => segment.runId === entry.runId)
      if (known) known.start = Math.min(known.start, start)
      else list.push({ runId: entry.runId, start })
      byMember.set(memberId, list)
    }
  }
  for (const segments of byMember.values()) {
    segments.sort((left, right) => left.start - right.start)
    for (let index = 0; index < segments.length; index += 1) {
      segments[index].end = index + 1 < segments.length ? segments[index + 1].start : Number.POSITIVE_INFINITY
    }
  }
  return byMember
}

function buildSessionIndex(sessionsDir, wantedIds) {
  const index = new Map()
  if (!existsSync(sessionsDir)) return index
  const wanted = new Set(wantedIds)
  if (wanted.size === 0) return index
  for (const workspace of readdirSync(sessionsDir)) {
    if (wanted.size === 0) break
    const workspaceDir = join(sessionsDir, workspace)
    let entries
    try {
      entries = readdirSync(workspaceDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !wanted.has(entry.name)) continue
      const file = join(workspaceDir, entry.name, 'session.v4.jsonl.zstd')
      if (!existsSync(file)) continue
      index.set(entry.name, file)
      wanted.delete(entry.name)
    }
  }
  return index
}

function emptySessionStats() {
  return { steps: 0, toolCalls: 0, compressCalls: 0, assistantChars: 0, toolResultChars: 0, firstTime: null, lastTime: null }
}

function addSessionStats(target, source) {
  target.steps += source.steps
  target.toolCalls += source.toolCalls
  target.compressCalls += source.compressCalls
  target.assistantChars += source.assistantChars
  target.toolResultChars += source.toolResultChars
  if (source.firstTime !== null) target.firstTime = target.firstTime === null ? source.firstTime : Math.min(target.firstTime, source.firstTime)
  if (source.lastTime !== null) target.lastTime = target.lastTime === null ? source.lastTime : Math.max(target.lastTime, source.lastTime)
}

function textLength(value) {
  if (typeof value === 'string') return value.length
  if (value === null || value === undefined) return 0
  try {
    return JSON.stringify(value).length
  } catch {
    return 0
  }
}

function contentTextLength(content) {
  if (!Array.isArray(content)) return textLength(content)
  let total = 0
  for (const block of content) total += textLength(block?.text)
  return total
}

function parseSessionSegments(file, segments) {
  const statsByRun = new Map(segments.map((segment) => [segment.runId, emptySessionStats()]))
  const meta = { bytes: 0, badLines: 0 }
  if (segments.length === 0) return { statsByRun, ...meta }
  let active = 0
  try {
    meta.bytes = statSync(file).size
    const raw = zstdDecompressSync(readFileSync(file)).toString('utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        meta.badLines += 1
        continue
      }
      const time = Number(record?.time ?? record?.data?.time ?? NaN)
      // 记录基本按时间递增；用游标找段，避免逐条二分。
      if (Number.isFinite(time)) {
        while (active + 1 < segments.length && time >= segments[active].end) active += 1
      }
      const stats = statsByRun.get(segments[active].runId)
      if (Number.isFinite(time)) {
        stats.firstTime = stats.firstTime === null ? time : Math.min(stats.firstTime, time)
        stats.lastTime = stats.lastTime === null ? time : Math.max(stats.lastTime, time)
      }
      const data = record?.data ?? {}
      if (record?.type === 'step/start') stats.steps += 1
      else if (record?.type === 'tool/call') {
        stats.toolCalls += 1
        if (data?.name === 'compress') stats.compressCalls += 1
      } else if (record?.type === 'tool/result') {
        stats.toolResultChars += contentTextLength(data?.message?.content ?? data?.content)
      } else if (record?.type === 'assistant/message') {
        const content = data?.message?.content ?? data?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text') stats.assistantChars += textLength(block.text)
            else if (block?.type === 'tool-call') stats.assistantChars += textLength(block.arguments)
          }
        } else {
          stats.assistantChars += textLength(content)
        }
      }
    }
  } catch (error) {
    return { statsByRun, ...meta, error: String(error?.message ?? error) }
  }
  return { statsByRun, ...meta }
}

/* -------------------------------------------------------------- 组装结果 */

function collect(options) {
  const { selected, broken, all } = loadRuns(options)
  const memberSegments = buildMemberSegments(all)
  const wanted = new Set()
  for (const entry of selected) {
    for (const binding of entry.state?.bindings ?? []) {
      if (binding?.memberId) wanted.add(binding.memberId)
    }
  }
  const sessionIndex = buildSessionIndex(options.sessionsDir, wanted)

  const sessionCache = new Map()
  const memberSession = (memberId) => {
    if (sessionCache.has(memberId)) return sessionCache.get(memberId)
    const file = sessionIndex.get(memberId)
    if (!file) {
      const empty = { sessionFile: null, bytes: 0, statsByRun: new Map() }
      sessionCache.set(memberId, empty)
      return empty
    }
    const parsed = parseSessionSegments(file, memberSegments.get(memberId) ?? [])
    const record = { sessionFile: file, bytes: parsed.bytes, statsByRun: parsed.statsByRun }
    sessionCache.set(memberId, record)
    return record
  }
  const statsOfMember = (memberId, runId) => memberSession(memberId).statsByRun.get(runId) ?? emptySessionStats()

  const runRows = []
  for (const entry of selected) {
    const state = entry.state
    const plan = state?.plan ?? {}
    const bindings = Array.isArray(state?.bindings) ? state.bindings : []
    const tasks = Array.isArray(plan?.tasks) ? plan.tasks : []
    const members = new Map() // memberId -> { taskIds:Set, name, spawnedAt }
    for (const binding of bindings) {
      if (!binding?.memberId) continue
      const record = members.get(binding.memberId) ?? { taskIds: new Set(), name: binding.name ?? '', spawnedAt: binding.spawnedAt ?? null }
      record.taskIds.add(binding.taskId)
      members.set(binding.memberId, record)
    }

    const usageByMember = state?.usage?.byMember ?? null
    const usageTotals = usageByMember && typeof usageByMember === 'object' && Object.keys(usageByMember).length > 0
      ? tokenTotals(usageByMember)
      : tokenTotals(state?.usage?.total)

    const runStats = emptySessionStats()
    const missingSessions = []
    let bytes = 0
    for (const [memberId] of members) {
      const session = memberSession(memberId)
      if (!session.sessionFile) missingSessions.push(memberId)
      addSessionStats(runStats, statsOfMember(memberId, entry.runId))
      bytes += session.bytes ?? 0
    }

    const taskRows = []
    for (const task of tasks) {
      const taskId = task?.id
      if (!taskId) continue
      const taskMembers = [...members.entries()].filter(([, record]) => record.taskIds.has(taskId))
      const taskStats = emptySessionStats()
      const sharedFrom = []
      const taskMissing = []
      for (const [memberId, record] of taskMembers) {
        const stats = statsOfMember(memberId, entry.runId)
        const session = memberSession(memberId)
        if (!session.sessionFile) taskMissing.push(memberId)
        const ownerTask = [...record.taskIds][0]
        if (ownerTask !== taskId) {
          sharedFrom.push({ memberId, ownerTask })
          continue
        }
        addSessionStats(taskStats, stats)
      }
      const usageByTask = state?.usage?.byTask?.[taskId]
      const usage = usageByTask
        ? tokenTotals(usageByTask)
        : taskMembers.reduce((totals, [memberId]) => addTotals(totals, usageByMember?.[memberId]), emptyTotals())
      const times = state?.taskTimes?.[taskId] ?? null
      const wallMs = times && Number.isFinite(times.startedAt)
        ? Math.max(0, Number(times.endedAt ?? Date.now()) - Number(times.startedAt))
        : taskStats.firstTime !== null && taskStats.lastTime !== null
          ? taskStats.lastTime - taskStats.firstTime
          : null
      taskRows.push({
        taskId,
        title: String(task?.title ?? '').split('\n')[0].slice(0, 80),
        status: task?.status ?? null,
        members: taskMembers.map(([memberId, record]) => ({ memberId, name: record.name })),
        missingSessions: taskMissing,
        sharedFrom,
        usage,
        stats: taskStats,
        wallMs,
      })
    }
    taskRows.sort((left, right) => right.usage.calls - left.usage.calls || right.usage.total - left.usage.total)

    const createdAt = Number(plan.createdAt ?? 0)
    let endedAt = Number(state?.plan?.finishedAt ?? state?.endedAt ?? 0) || null
    if (!endedAt) {
      for (const times of Object.values(state?.taskTimes ?? {})) {
        if (Number.isFinite(times?.endedAt)) endedAt = Math.max(endedAt ?? 0, Number(times.endedAt))
      }
    }
    const wallMs = createdAt > 0 && endedAt !== null ? Math.max(0, endedAt - createdAt) : null

    runRows.push({
      runId: entry.runId,
      file: entry.file,
      createdAt,
      status: plan.status ?? null,
      goal: String(plan.goal ?? '').split('\n')[0].slice(0, 100),
      usage: usageTotals,
      usageSource: usageByMember && Object.keys(usageByMember).length > 0 ? 'byMember' : 'total',
      stats: runStats,
      wallMs,
      tasks: taskRows,
      members: [...members.entries()].map(([memberId, record]) => ({ memberId, name: record.name, taskIds: [...record.taskIds] })),
      missingSessions,
      sessionBytes: bytes,
    })
  }

  const totals = emptyTotals()
  const stats = emptySessionStats()
  for (const row of runRows) {
    addTotals(totals, row.usage)
    addSessionStats(stats, row.stats)
  }
  let worstTask = null
  for (const row of runRows) {
    for (const task of row.tasks) {
      if (!worstTask || task.usage.calls > worstTask.usage.calls || (task.usage.calls === worstTask.usage.calls && task.usage.total > worstTask.usage.total)) {
        worstTask = { runId: row.runId, ...task }
      }
    }
  }
  const totalWallMs = runRows.reduce((sum, row) => sum + (row.wallMs ?? 0), 0)
  return {
    generatedAt: Date.now(),
    home: options.home,
    runsDir: options.runsDir,
    sessionsDir: options.sessionsDir,
    filter: {
      runPrefix: options.runPrefix,
      since: options.since,
      until: options.until,
      usageOnly: options.usageOnly,
      first: options.first,
    },
    toolNote: 'token/calls/cacheRead 来自 run JSON 的 usage；工具数与字符数来自成员会话 JSONL',
    totals: {
      ...totals,
      runs: runRows.length,
      cacheReadPct: totals.total > 0 ? (totals.cacheRead / totals.total) * 100 : 0,
      avgTokensPerCall: totals.calls > 0 ? totals.total / totals.calls : 0,
      avgCallsPerRun: runRows.length > 0 ? totals.calls / runRows.length : 0,
      toolCalls: stats.toolCalls,
      steps: stats.steps,
      compressCalls: stats.compressCalls,
      assistantChars: stats.assistantChars,
      toolResultChars: stats.toolResultChars,
      wallMs: totalWallMs,
      worstTask: worstTask
        ? { runId: worstTask.runId, taskId: worstTask.taskId, calls: worstTask.usage.calls, total: worstTask.usage.total }
        : null,
    },
    runs: runRows,
    broken,
  }
}

/* ---------------------------------------------------------------- 输出 */

function formatInt(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-'
  return Math.round(Number(value)).toLocaleString('en-US')
}

function formatCompact(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  if (Math.abs(number) >= 1e9) return `${(number / 1e9).toFixed(3)}B`
  if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(1)}M`
  if (Math.abs(number) >= 1e3) return `${(number / 1e3).toFixed(1)}K`
  return String(Math.round(number))
}

function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '-'
  const totalSeconds = Math.round(Number(ms) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

function formatClock(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return '-'
  return new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 16)
}

function table(headers, rows) {
  const widths = headers.map((header, index) => Math.max(String(header).length, ...rows.map((row) => String(row[index] ?? '').length)))
  const render = (row) => row.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join('  ').trimEnd()
  return [render(headers), render(widths.map((width) => '-'.repeat(width))), ...rows.map(render)].join('\n')
}

function printHuman(report) {
  const lines = []
  lines.push('# r39 成本度量（可复跑）')
  lines.push('')
  lines.push(`- 生成时间（UTC）：${formatClock(report.generatedAt)}`)
  lines.push(`- 数据源：${report.runsDir}`)
  lines.push(`- 成员会话：${report.sessionsDir}`)
  const filterParts = []
  if (report.filter.runPrefix) filterParts.push(`runId 前缀 \`${report.filter.runPrefix}\``)
  if (report.filter.since !== null) filterParts.push(`createdAt >= ${formatClock(report.filter.since)}`)
  if (report.filter.until !== null) filterParts.push(`createdAt <= ${formatClock(report.filter.until)}`)
  if (report.filter.usageOnly) filterParts.push('只取有 usage 记账的 run')
  if (report.filter.first > 0) filterParts.push(`按 createdAt 升序前 ${report.filter.first} 个`)
  lines.push(`- 筛选：${filterParts.length > 0 ? filterParts.join('；') : '无（全部 run）'}`)
  lines.push(`- 口径：${report.toolNote}`)
  lines.push('')
  const total = report.totals
  if (total.runs === 0) {
    lines.push('没有符合条件的 run。')
    return lines.join('\n')
  }
  lines.push('## 总览')
  lines.push('')
  lines.push(table(
    ['run 数', 'usage calls', 'tokens', 'cacheRead', '命中率', '平均每次上下文', '平均每 run calls', '工具调用', 'compress', '墙钟'],
    [[
      formatInt(total.runs),
      formatInt(total.calls),
      formatCompact(total.total),
      formatCompact(total.cacheRead),
      `${total.cacheReadPct.toFixed(2)}%`,
      formatCompact(total.avgTokensPerCall),
      formatInt(total.avgCallsPerRun),
      formatInt(total.toolCalls),
      formatInt(total.compressCalls),
      formatDuration(total.wallMs),
    ]],
  ))
  if (total.worstTask) {
    lines.push('')
    lines.push(`- 最贵单任务：\`${total.worstTask.runId}\` / \`${total.worstTask.taskId}\` = ${formatInt(total.worstTask.calls)} calls / ${formatCompact(total.worstTask.total)} tokens`)
  }
  lines.push(`- 会话字符：assistant ${formatCompact(total.assistantChars)} chars，tool/result ${formatCompact(total.toolResultChars)} chars`)
  lines.push('')
  lines.push('## 按 run')
  lines.push('')
  lines.push(table(
    ['runId', 'createdAt', 'status', 'calls', 'tokens', 'cacheRead', '命中率', 'ctx/call', '工具数', 'compress', '字符/结果', '墙钟'],
    report.runs.map((row) => [
      row.runId,
      formatClock(row.createdAt),
      row.status ?? '-',
      formatInt(row.usage.calls),
      formatCompact(row.usage.total),
      formatCompact(row.usage.cacheRead),
      row.usage.total > 0 ? `${((row.usage.cacheRead / row.usage.total) * 100).toFixed(1)}%` : '-',
      row.usage.calls > 0 ? formatCompact(row.usage.total / row.usage.calls) : '-',
      formatInt(row.stats.toolCalls),
      formatInt(row.stats.compressCalls),
      `${formatCompact(row.stats.assistantChars)}/${formatCompact(row.stats.toolResultChars)}`,
      formatDuration(row.wallMs),
    ]),
  ))
  lines.push('')
  lines.push('## 按任务（只在所选 run 内）')
  lines.push('')
  const taskRows = []
  for (const row of report.runs) {
    for (const task of row.tasks) {
      taskRows.push([
        row.runId,
        task.taskId,
        task.status ?? '-',
        task.members.map((member) => member.name || member.memberId.slice(0, 8)).join(','),
        formatInt(task.usage.calls),
        formatCompact(task.usage.total),
        task.usage.total > 0 ? `${((task.usage.cacheRead / task.usage.total) * 100).toFixed(1)}%` : '-',
        formatInt(task.stats.toolCalls),
        formatInt(task.stats.compressCalls),
        `${formatCompact(task.stats.assistantChars)}/${formatCompact(task.stats.toolResultChars)}`,
        formatDuration(task.wallMs),
        task.sharedFrom.length > 0 ? `shared:${task.sharedFrom.map((item) => item.memberId.slice(0, 8)).join(',')}` : '',
      ])
    }
  }
  lines.push(table(
    ['runId', 'task', 'status', '成员', 'calls', 'tokens', 'cacheRead', '工具数', 'compress', '字符/结果', '墙钟', '备注'],
    taskRows,
  ))
  const missing = report.runs.filter((row) => row.missingSessions.length > 0)
  if (missing.length > 0) {
    lines.push('')
    lines.push('## 找不到成员会话（token 仍来自 run JSON，工具数/字符数按 0 计）')
    for (const row of missing) lines.push(`- ${row.runId}: ${row.missingSessions.join(', ')}`)
  }
  if (report.broken.length > 0) {
    lines.push('')
    lines.push('## 无法解析的 run 文件')
    for (const row of report.broken) lines.push(`- ${row.file}: ${row.broken}`)
  }
  return lines.join('\n')
}

/* ------------------------------------------------------------------ main */

let options
try {
  options = parseArgs(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error?.message ?? error}\n\n${HELP}`)
  process.exit(2)
}
if (options.help) {
  process.stdout.write(`${HELP}\n`)
  process.exit(0)
}

try {
  const report = collect(options)
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else process.stdout.write(`${printHuman(report)}\n`)
} catch (error) {
  process.stderr.write(`度量失败：${error?.message ?? error}\n`)
  process.exit(1)
}
