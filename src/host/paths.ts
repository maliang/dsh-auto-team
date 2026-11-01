/**
 * 纯函数：数据落点解析。不读环境（不 import node:os），由调用方注入 home/workspace，
 * 因此可被单测（AC：记忆落点与 `..` 逃逸防护必须可验证）。
 */
import { FALLBACK_WORKSPACE } from './config.ts'

/** 全局数据根：`<home>/.dsh/auto-team`（PRD：runs/roles/memory 都在这里）。 */
export function globalDataRoot(home: string): string {
  return `${trimSlash(home)}/.dsh/auto-team`
}

/** 运行状态目录。 */
export function runsDir(home: string): string {
  return `${globalDataRoot(home)}/runs`
}

/** 角色目录。 */
export function rolesDir(home: string): string {
  return `${globalDataRoot(home)}/roles`
}

/** 技能正文目录（内置角色的 skill md 由首次启动 seed 到这里）。 */
export function skillsDir(home: string): string {
  return `${globalDataRoot(home)}/skills`
}

/**
 * 可配参数落点：`<home>/.dsh/auto-team/settings.json`（r7 AC-13）。
 *
 * 真机目标是 `~/.dsh/auto-team/settings.json` —— `globalDataRoot` 里**已经含 `.dsh`**，
 * 这里绝不能再拼一层（拼了会落到 `~/.dsh/.dsh/...`，表现为「设置保存成功、重启全部丢失」）。
 */
export function settingsPath(home: string): string {
  return `${globalDataRoot(home)}/settings.json`
}

/** 公共记忆目录（跨项目）。 */
export function publicMemoryDir(home: string): string {
  return `${globalDataRoot(home)}/memory/public`
}

/** 项目记忆目录：`<workspace>/.auto-team/memory`（随工作区走）。 */
export function projectMemoryDir(workspace: string): string {
  return `${trimSlash(normalizeWorkspace(workspace))}/.auto-team/memory`
}

/** 项目门禁产物目录：`<workspace>/.auto-team/artifacts`。 */
export function projectArtifactsDir(workspace: string): string {
  return `${trimSlash(normalizeWorkspace(workspace))}/.auto-team/artifacts`
}

/** 空工作区兜底（只影响解析，不写盘）。 */
export function normalizeWorkspace(workspace: string | undefined | null): string {
  const value = (workspace ?? '').trim()
  return value === '' ? `/${FALLBACK_WORKSPACE}` : value
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
