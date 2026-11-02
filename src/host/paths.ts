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

/** 技能正文目录（r10 起是真正的 md 仓储：内置覆盖层 + 导入/系统/手写四来源都在这里）。 */
export function skillsDir(home: string): string {
  return `${globalDataRoot(home)}/skills`
}

/**
 * 宿主系统技能库（r10 AC-19）：`<home>/.agents/skills`。
 *
 * 为什么**不**在 `globalDataRoot` 下面：那是 DSH 自己的技能库约定（`skill_manage` 的默认目录），
 * 我们只读不写——写进别人的库里等于污染宿主资产。放在这里只是为了集中派生、避免各处手拼。
 */
export function systemSkillsDir(home: string): string {
  return `${trimSlash(home)}/.agents/skills`
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

/**
 * 队长留痕落点：`<home>/.dsh/auto-team/deviations.jsonl`（r11 F7）。
 *
 * 同样**不再拼 `.dsh`** —— `globalDataRoot` 已含；多拼一层会落到
 * `~/.dsh/.dsh/auto-team/`，症状是「真有记录、面板永远是 0 条」。
 */
export function deviationsPath(home: string): string {
  return `${globalDataRoot(home)}/deviations.jsonl`
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
