/**
 * 历史记忆回填（r22，一次性但可复跑）。
 *
 * 背景：旧实现把项目记忆写到 `apply` 时刻的装配 workspace（真实宿主 = profile 目录），
 * 修好动态解析之后，**已经结束的 run** 不会自己搬家。本模块扫描 runs 目录里的终态 run，
 * 按真实项目把它们补进各自的 `<workspace>/.auto-team/memory/run-<runId>.md`。
 *
 * 三条纪律（与在线沉淀一致，且更保守）：
 *  1. **只补缺失**：目标文件存在即跳过，绝不覆盖用户手改过的文件；
 *  2. **不猜项目**：优先工作区注册表按 sessionId 反查，其次 run 自己记录的绝对路径；
 *     两者都不可用（含「profile 目录冒充项目」）时 skip 并给出可读原因，不往猜测目录写；
 *  3. **可复跑 + dry-run**：同一份输入重复执行结果幂等；`dryRun` 只计算、不写盘，输出计数。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { projectMemoryNameOf, runMemoryOf } from './auto.ts'
import { usableWorkspaceOf } from './locate.ts'
import { projectMemoryDir } from '../paths.ts'

/** 工作区注册表里与本任务相关的一条映射（`~/.dsh/storages/workspace.json`）。 */
export interface WorkspaceBinding {
  path: string
  sessionIds: string[]
}

export interface BackfillOptions {
  /** `~/.dsh/auto-team/runs`（一个 run 一个 json）。 */
  runsDir: string
  /** 工作区注册表文件；缺省/不可读时只靠 run.project。 */
  registryFile?: string
  /**
   * 装配 workspace（`apply` 时刻那个）。run.project 等于它时说明是旧缺陷写下的非项目路径，
   * 不能当落点。CLI 不传时用 `$HOME/.dsh/profiles/<profile>` 形态兜底识别。
   */
  assemblyWorkspace?: string
  /**
   * 旧落点目录（profile 的 `.auto-team/memory`）。存在同名记忆时**复制原文**到目标项目，
   * 保留用户当时的手改；不存在才按 run 状态重新生成。
   */
  legacyMemoryDirs?: string[]
  dryRun?: boolean
}

export type BackfillAction = 'write' | 'copy' | 'exists' | 'skip'

export interface BackfillEntry {
  runId: string
  name: string
  projectDir?: string
  action: BackfillAction
  /** skip / copy 的来源或原因（可读中文）。 */
  reason?: string
}

export interface BackfillReport {
  runsDir: string
  scanned: number
  terminal: number
  /** 计划补写（write + copy）的条数；与 `written` 在 dry-run 时不同。 */
  planned: number
  written: number
  copied: number
  skippedExisting: number
  skippedNoProject: number
  skippedInvalid: number
  entries: BackfillEntry[]
}

interface RunRecord {
  plan?: {
    runId?: unknown
    goal?: unknown
    status?: unknown
    sessionId?: unknown
    createdAt?: unknown
    tasks?: unknown
  }
  project?: unknown
  plannedAt?: unknown
  finishedAt?: unknown
}

interface RunTaskRecord {
  id?: unknown
  title?: unknown
  status?: unknown
  attempts?: unknown
  evidence?: { command?: unknown; exitCode?: unknown; tail?: unknown }
}

const TERMINAL_STATUSES: readonly string[] = ['terminated', 'cancelled']

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 读工作区注册表。文件不存在/损坏 → `[]`（回填退化为「只认 run.project」，
 * 这是配置缺失，不是运行错误；CLI 会把空映射与 skip 原因打出来）。
 */
export function readWorkspaceBindings(file: string | undefined): WorkspaceBinding[] {
  if (file === undefined || file.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const tables = (parsed as { tables?: unknown }).tables
  if (typeof tables !== 'object' || tables === null) return []
  const workspaces = (tables as { workspaces?: unknown }).workspaces
  if (typeof workspaces !== 'object' || workspaces === null) return []
  const out: WorkspaceBinding[] = []
  for (const raw of Object.values(workspaces as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue
    const path = text((raw as { path?: unknown }).path).trim()
    if (path === '') continue
    const ids = (raw as { sessionIds?: unknown }).sessionIds
    const sessionIds = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    out.push({ path, sessionIds })
  }
  return out
}

/** `.../.dsh/profiles/<profile>` 形态：旧 apply workspace 的典型值，不能当项目落点。 */
export function isProfileWorkspace(path: string): boolean {
  return /(^|\/)\.dsh\/profiles\/[^/]+\/?$/.test(path)
}

function taskRecordsOf(raw: unknown): RunTaskRecord[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is RunTaskRecord => typeof item === 'object' && item !== null)
}

/**
 * 回填一批 run。纯计算部分（计划/原因/计数）与写盘分开：`dryRun` 只跳过写盘。
 */
export function backfillRunMemories(options: BackfillOptions): BackfillReport {
  const report: BackfillReport = {
    runsDir: options.runsDir,
    scanned: 0,
    terminal: 0,
    planned: 0,
    written: 0,
    copied: 0,
    skippedExisting: 0,
    skippedNoProject: 0,
    skippedInvalid: 0,
    entries: [],
  }
  let files: string[]
  try {
    files = readdirSync(options.runsDir).filter((name) => name.endsWith('.json'))
  } catch {
    return report
  }

  const bindings = readWorkspaceBindings(options.registryFile)
  const bySession = new Map<string, string>()
  for (const binding of bindings) {
    const workspace = usableWorkspaceOf(binding.path)
    if (workspace === undefined) continue
    for (const sessionId of binding.sessionIds) {
      if (!bySession.has(sessionId)) bySession.set(sessionId, workspace)
    }
  }
  const assembly = usableWorkspaceOf(options.assemblyWorkspace)
  const legacyDirs = (options.legacyMemoryDirs ?? []).filter((dir) => dir.trim() !== '')

  for (const file of files.sort()) {
    report.scanned += 1
    const path = join(options.runsDir, file)
    let state: RunRecord
    try {
      state = JSON.parse(readFileSync(path, 'utf8')) as RunRecord
    } catch {
      report.skippedInvalid += 1
      report.entries.push({
        runId: file.replace(/\.json$/, ''),
        name: '',
        action: 'skip',
        reason: 'run 文件不是合法 JSON',
      })
      continue
    }

    const plan = state.plan
    const status = text(plan?.status)
    if (!TERMINAL_STATUSES.includes(status)) continue
    report.terminal += 1

    const runId = text(plan?.runId)
    if (runId.trim() === '') {
      report.skippedInvalid += 1
      report.entries.push({ runId: file.replace(/\.json$/, ''), name: '', action: 'skip', reason: 'run 缺少 plan.runId' })
      continue
    }
    const name = projectMemoryNameOf(runId)
    const sessionId = text(plan?.sessionId).trim()

    // 1) 注册表按会话反查（最可靠：用户当时打开的工作区）。
    let project = sessionId === '' ? undefined : bySession.get(sessionId)
    let reason: string | undefined
    if (project === undefined) {
      // 2) run 自己记录的绝对路径，但排除「装配 workspace 冒充项目」的旧值。
      const fromRun = usableWorkspaceOf(text(state.project))
      if (fromRun === undefined) {
        reason = 'run 没记录绝对项目路径，工作区注册表也没有该会话映射'
      } else if (isProfileWorkspace(fromRun) || (assembly !== undefined && projectMemoryDir(fromRun) === projectMemoryDir(assembly))) {
        reason = `run.project 是装配 workspace（${fromRun}），注册表也没有该会话映射`
      } else {
        project = fromRun
      }
    }

    if (project === undefined) {
      report.skippedNoProject += 1
      report.entries.push({ runId, name, action: 'skip', reason })
      continue
    }

    const projectDir = projectMemoryDir(project)
    const target = join(projectDir, name)
    if (existsSync(target)) {
      report.skippedExisting += 1
      report.entries.push({ runId, name, projectDir, action: 'exists', reason: '目标文件已存在（不覆盖）' })
      continue
    }

    // 优先复制旧落点里的原文（用户可能手改过）；没有才重新生成。
    const legacySource = legacyDirs
      .map((dir) => join(dir, name))
      .find((candidate) => existsSync(candidate))

    report.planned += 1
    if (options.dryRun === true) {
      report.entries.push({
        runId,
        name,
        projectDir,
        action: legacySource === undefined ? 'write' : 'copy',
        reason: legacySource === undefined ? '按 run 状态生成' : `复制既有副本 ${legacySource}`,
      })
      continue
    }

    try {
      mkdirSync(projectDir, { recursive: true })
      if (legacySource !== undefined) {
        writeFileSync(target, readFileSync(legacySource, 'utf8'), 'utf8')
        report.copied += 1
      } else {
        const memories = runMemoryOf({
          runId,
          goal: text(plan?.goal),
          status,
          createdAt: num(plan?.createdAt),
          plannedAt: num(state.plannedAt),
          finishedAt: num(state.finishedAt),
          project,
          sessionId,
          tasks: taskRecordsOf(plan?.tasks).map((task) => ({
            id: text(task.id),
            title: text(task.title),
            status: text(task.status),
            attempts: num(task.attempts),
            evidence:
              task.evidence === undefined
                ? undefined
                : {
                    command: text(task.evidence.command),
                    exitCode: num(task.evidence.exitCode) ?? null,
                    tail: text(task.evidence.tail),
                  },
          })),
        })
        const projectMemory = memories.find((memory) => memory.track === 'project')
        if (projectMemory === undefined) {
          report.planned -= 1
          report.skippedInvalid += 1
          report.entries.push({ runId, name, projectDir, action: 'skip', reason: 'runMemoryOf 未产出项目记忆' })
          continue
        }
        writeFileSync(target, projectMemory.body, 'utf8')
        report.written += 1
      }
      report.entries.push({
        runId,
        name,
        projectDir,
        action: legacySource === undefined ? 'write' : 'copy',
        reason: legacySource === undefined ? '按 run 状态生成' : `复制既有副本 ${legacySource}`,
      })
    } catch (error) {
      report.planned -= 1
      report.skippedInvalid += 1
      report.entries.push({
        runId,
        name,
        projectDir,
        action: 'skip',
        reason: `写入失败：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  return report
}

/** 供 CLI 与文档共用的一行摘要（dry-run 时 `written/copied` 必为 0）。 */
export function summarizeBackfill(report: BackfillReport, dryRun: boolean): string {
  return [
    `mode=${dryRun ? 'dry-run' : 'apply'}`,
    `scanned=${report.scanned}`,
    `terminal=${report.terminal}`,
    `planned=${report.planned}`,
    `written=${report.written}`,
    `copied=${report.copied}`,
    `skippedExisting=${report.skippedExisting}`,
    `skippedNoProject=${report.skippedNoProject}`,
    `skippedInvalid=${report.skippedInvalid}`,
  ].join(' ')
}

/** 默认旧落点候选：`$HOME/.dsh/profiles/<profile>/.auto-team/memory`（存在才返回）。 */
export function legacyMemoryDirsOf(home: string): string[] {
  const profilesRoot = resolve(home, '.dsh/profiles')
  let profiles: string[]
  try {
    profiles = readdirSync(profilesRoot)
  } catch {
    return []
  }
  return profiles
    .map((profile) => join(profilesRoot, profile, '.auto-team/memory'))
    .filter((dir) => existsSync(dir))
}
