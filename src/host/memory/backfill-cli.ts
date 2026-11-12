#!/usr/bin/env node
/**
 * r22 历史记忆回填 CLI。
 *
 * 用法（在仓库根执行；Node ≥ 22.18 可直接跑 TS 源）：
 *   node src/host/memory/backfill-cli.ts --dry-run
 *   node src/host/memory/backfill-cli.ts
 *
 * 默认值：
 *   --runs-dir   $HOME/.dsh/auto-team/runs
 *   --registry   $HOME/.dsh/storages/workspace.json
 *   --legacy-memory 自动扫描 $HOME/.dsh/profiles/<profile>/.auto-team/memory（存在才用）
 *   --assembly-workspace 不传时按 `.../.dsh/profiles/<profile>` 形态识别旧装配路径
 *
 * 只补缺失的 run-<runId>.md，绝不覆盖已存在的文件；重复执行结果幂等。
 */
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backfillRunMemories, legacyMemoryDirsOf, summarizeBackfill } from './backfill.ts'
import { runsDir as runsDirOf } from '../paths.ts'

interface CliOptions {
  runsDir: string
  registryFile: string
  assemblyWorkspace?: string
  legacyMemoryDirs: string[]
  dryRun: boolean
}

function usage(): string {
  return [
    '用法: node src/host/memory/backfill-cli.ts [选项]',
    '',
    `  --runs-dir <dir>             runs 目录（默认 ${runsDirOf('$HOME')}）`,
    '  --registry <file>            工作区注册表（默认 $HOME/.dsh/storages/workspace.json）',
    '  --assembly-workspace <dir>   旧 apply workspace（可选）',
    '  --legacy-memory <dir>        旧落点目录，可重复（默认扫描 ~/.dsh/profiles/<profile>/.auto-team/memory）',
    '  --dry-run                    只输出计划与计数，不写盘',
    '  -h, --help                   显示本帮助',
  ].join('\n')
}

function parseArgs(argv: readonly string[], home: string): CliOptions | null {
  let runsDir = runsDirOf(home)
  let registryFile = resolve(home, '.dsh/storages/workspace.json')
  let assemblyWorkspace: string | undefined
  const legacyMemoryDirs: string[] = []
  let dryRun = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 缺少取值`)
      i += 1
      return value
    }
    switch (arg) {
      case '--runs-dir':
        runsDir = resolve(next())
        break
      case '--registry':
        registryFile = resolve(next())
        break
      case '--assembly-workspace':
        assemblyWorkspace = resolve(next())
        break
      case '--legacy-memory':
        legacyMemoryDirs.push(resolve(next()))
        break
      case '--dry-run':
        dryRun = true
        break
      case '-h':
      case '--help':
        return null
      default:
        throw new Error(`未知参数：${arg}`)
    }
  }

  return {
    runsDir,
    registryFile,
    assemblyWorkspace,
    legacyMemoryDirs: legacyMemoryDirs.length > 0 ? legacyMemoryDirs : legacyMemoryDirsOf(home),
    dryRun,
  }
}

export function main(argv: readonly string[] = process.argv.slice(2), home = homedir()): number {
  let options: CliOptions | null
  try {
    options = parseArgs(argv, home)
  } catch (error) {
    console.error(`[backfill] ${error instanceof Error ? error.message : String(error)}`)
    console.error(usage())
    return 2
  }
  if (options === null) {
    console.log(usage())
    return 0
  }

  const report = backfillRunMemories({
    runsDir: options.runsDir,
    registryFile: options.registryFile,
    assemblyWorkspace: options.assemblyWorkspace,
    legacyMemoryDirs: options.legacyMemoryDirs,
    dryRun: options.dryRun,
  })

  console.log(`[backfill] ${options.dryRun ? 'dry-run（不写盘）' : 'apply'}`)
  console.log(`[backfill] runs=${options.runsDir}`)
  console.log(`[backfill] registry=${options.registryFile}`)
  if (options.legacyMemoryDirs.length > 0) {
    console.log(`[backfill] legacy=${options.legacyMemoryDirs.join(', ')}`)
  }
  for (const entry of report.entries) {
    const where = entry.projectDir === undefined ? '' : ` → ${entry.projectDir}`
    const why = entry.reason === undefined ? '' : `（${entry.reason}）`
    console.log(`[backfill] ${entry.action.padEnd(6)} ${entry.runId}/${entry.name}${where}${why}`)
  }
  console.log(`[backfill] ${summarizeBackfill(report, options.dryRun)}`)
  return 0
}

/** 仅当被直接执行（而非单测 import）时运行。 */
function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return fileURLToPath(import.meta.url) === resolve(entry)
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  process.exitCode = main()
}
