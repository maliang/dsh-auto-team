/**
 * 项目记忆落点的**唯一**解析点（r22）。
 *
 * 背景（真实缺陷）：`apply()` 在宿主启动时只跑一次，那时 `ctx.agents` / `workspaceRegistry`
 * 都还没就绪，`options.workspace ?? process.cwd()` 拿到的是**宿主 profile 目录**。
 * 旧实现把这一刻的 workspace 算成 `memoryRoots.projectDir` 并在闭包里定格，于是所有 run 的
 * 项目记忆都写进 `~/.dsh/profiles/<profile>/.auto-team/memory`，真正的
 * `<repo>/.auto-team/memory` 永远不存在（用户报「已在使用的项目都没沉淀下记忆」）。
 *
 * 本模块只做纯计算：调用方每次要读写记忆时，把「这一次的 workspace」传进来重新解析，
 * 不在 apply 时刻定格。解析不到可用 workspace 时**明确退化**到装配目录并给出可读原因，
 * 由快照/工具/面板显示 —— 不允许静默写错位置。
 */
import { isAbsolute } from 'node:path'
import type { MemoryRoots } from './repo.ts'
import { normalizeWorkspace, projectMemoryDir } from '../paths.ts'

export interface MemoryLocationInput {
  /** 公共轨目录（全局，与项目无关）。 */
  publicDir: string
  /** 解析失败时的项目轨退路：装配层在 apply 时刻算出的目录（真实宿主里是 profile 目录）。 */
  fallbackProjectDir: string
  /** 本次读写的项目工作区（会话 cwd / run.project / HTTP 显式参数）。 */
  workspace?: string
  /** 可读来源标签（`会话 session-xxx` / `run run-xxx`），只用于退化原因文案。 */
  origin?: string
}

export interface MemoryLocation {
  /** 四口（列表/注入/expand/读写删）共用的根。 */
  roots: MemoryRoots
  /** 项目轨实际目录（等于 `roots.projectDir`，单独给快照显示「写到哪儿」）。 */
  projectDir: string
  /** 成功解析到的工作区（绝对路径、已归一化）；退化时缺省。 */
  workspace?: string
  degraded: boolean
  /** 仅 `degraded === true` 时给：为什么退化、实际写到哪儿。 */
  degradeReason?: string
}

/**
 * 可用的项目工作区判定：**必须是绝对路径**。
 *
 * 历史 run 的 `state.project` 里既有真实绝对路径，也有 r13 时代的 basename
 * （`dsh-auto-team`）——basename 相对当前进程 cwd 解析会写成另一个目录，必须当不可用。
 */
export function usableWorkspaceOf(workspace: string | undefined | null): string | undefined {
  if (typeof workspace !== 'string') return undefined
  const trimmed = workspace.trim()
  if (trimmed === '' || !isAbsolute(trimmed)) return undefined
  const normalized = normalizeWorkspace(trimmed)
  // 末尾斜杠不参与相等判定（`/work/a/` 与 `/work/a` 是同一个工作区）。
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '')
}

/** 解析本次读写的记忆根；`workspace` 缺失/非绝对路径时退化到 `fallbackProjectDir`。 */
export function memoryLocationOf(input: MemoryLocationInput): MemoryLocation {
  const workspace = usableWorkspaceOf(input.workspace)
  if (workspace !== undefined) {
    const projectDir = projectMemoryDir(workspace)
    return {
      roots: { publicDir: input.publicDir, projectDir },
      projectDir,
      workspace,
      degraded: false,
    }
  }

  const projectDir = input.fallbackProjectDir
  const who = (input.origin ?? '').trim()
  const subject = who === '' ? '本次' : who
  return {
    roots: { publicDir: input.publicDir, projectDir },
    projectDir,
    degraded: true,
    degradeReason:
      `未能解析${subject}的项目工作区（宿主未提供会话 cwd，工作区注册表也没有命中）；` +
      `项目记忆暂时退化到装配目录 ${projectDir}，不会写进具体项目的 .auto-team/memory。`,
  }
}
