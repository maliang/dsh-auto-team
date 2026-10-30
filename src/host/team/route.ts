/**
 * 逐角色模型路由：**预校验 + 漂移审计**（AC-22）。
 *
 * 两种时机：
 *  1. **预校验**（派发前）：用角色指定的 provider/model 让宿主解析一次，解析不到就当场
 *     拒绝派发并把它列进 `failed` —— 绝不「先派出去、再看看能不能跑」；
 *  2. **事后审计**（成员创建后）：宿主可能降级/替换模型。拿到实际路由就记 RouteAudit，
 *     与声明不一致即 `drift`；拿不到实际值记 `unverified`（**不是 ok**，面板显式标「未下发」）。
 *
 * 已知限制 L1：宿主 SpawnTeammateRequest 只有 `provider`、没有 `model` 字段，
 * 因此逐角色模型目前只能做到「预校验 + 审计」，实际下发要等宿主补字段。
 * 本模块的职责边界就落在这里：**禁止静默回退到队长模型**，宁可拒绝派发。
 */
import type { Role, RoleModelRoute } from '../../shared/types.ts'
import type { RunState } from '../store.ts'
import { describeRoute } from '../bridge.ts'
import { appendMessage, makeMessage } from './messages.ts'

/** 路由解析端口：解析成功返回（可能被宿主改写过的）路由，解析失败返回 null。 */
export interface RoutePort {
  resolveRoute(route: RoleModelRoute): Promise<RoleModelRoute | null>
}

export interface RouteFailure {
  roleId: string
  /** 角色声明的路由原文（逐字，供面板/错误信息引用）。 */
  route: RoleModelRoute
  /** 展示用标签：`provider/model #effort`。 */
  label: string
  error: string
}

export interface PreflightResult {
  /** 通过预校验的角色 id（未声明模型的角色永远通过：跟随会话默认）。 */
  ok: string[]
  failed: RouteFailure[]
}

/** 派发前批量预校验：只有声明了模型的角色需要校验。 */
export async function preflightRoutes(roles: Role[], port: RoutePort): Promise<PreflightResult> {
  const ok: string[] = []
  const failed: RouteFailure[] = []

  for (const role of roles) {
    const declared = role.model
    if (!declared) {
      // 未声明模型 = 跟随会话默认，宿主一定能跑，不需要也不应该拦。
      ok.push(role.id)
      continue
    }

    let resolved: RoleModelRoute | null = null
    let error = ''
    try {
      resolved = await port.resolveRoute(declared)
    } catch (thrown) {
      resolved = null
      error = thrown instanceof Error ? thrown.message : String(thrown)
    }

    if (resolved === null) {
      const label = describeRoute(role)
      failed.push({
        roleId: role.id,
        route: declared,
        label,
        error: error === '' ? `模型路由无法解析：${label}` : `模型路由无法解析：${label}（${error}）`,
      })
      continue
    }
    ok.push(role.id)
  }

  return { ok, failed }
}

/** 两条路由是否不等（null = 跟随会话默认；声明与实际的差异即漂移）。 */
export function routeDrift(declared: RoleModelRoute | null, actual: RoleModelRoute | null): boolean {
  return routeKey(declared) !== routeKey(actual)
}

/**
 * 记录一次路由审计（AC-22 的证据）。
 *
 * - `actual === null`（宿主没给出实际路由）→ `unverified`，**不写成 ok**；
 * - 声明 ≠ 实际 → `drift`，任务当场置 `failed`：派出去的人跑的不是用户配的模型，
 *   继续跑只会产出「看起来完成了、其实用错模型」的假结果；
 * - 一致 → `ok`。
 *
 * 同一 taskId 只保留一条最新审计（任务是审计的主体，不是每次事件各一条）；
 * 任务状态与审计同时变化，面板读到的两者永远对应。
 */
export function auditRoute(
  state: RunState,
  taskId: string,
  declared: RoleModelRoute | null,
  actual: RoleModelRoute | null,
  now?: number,
): RunState {
  const at = now ?? Date.now()
  const task = state.plan.tasks.find((item) => item.id === taskId)
  if (!task) return state

  const verdict: 'ok' | 'drift' | 'unverified' =
    actual === null ? 'unverified' : routeDrift(declared, actual) ? 'drift' : 'ok'

  const audit = {
    taskId,
    roleId: task.roleId,
    declared,
    actual,
    at,
    verdict,
  }

  const routeAudits = [...state.routeAudits.filter((item) => item.taskId !== taskId), audit]
  let next: RunState = { ...state, routeAudits }

  if (verdict === 'drift') {
    next = {
      ...next,
      plan: {
        ...next.plan,
        tasks: next.plan.tasks.map((item) => (item.id === taskId ? { ...item, status: 'failed' as const } : item)),
      },
    }
    next = appendMessage(
      next,
      makeMessage({
        from: 'captain',
        to: 'user',
        taskId,
        at,
        body: `路由漂移：任务「${task.title}」声明 ${describeRouteOf(declared)}，实际 ${describeRouteOf(actual)}。已停止该任务并标记失败，请核对角色模型（不会静默回退到队长模型）。`,
      }),
    )
  }

  return next
}

/** 审计里的路由文本（不依赖 Role 对象，因为 declared/actual 是裸路由）。 */
export function describeRouteOf(route: RoleModelRoute | null): string {
  if (!route) return '会话默认'
  const effort = route.reasoningEffort ? ` #${route.reasoningEffort}` : ''
  return `${route.provider}/${route.model}${effort}`
}

function routeKey(route: RoleModelRoute | null): string {
  if (!route) return 'session-default'
  return `${route.provider}/${route.model}${route.reasoningEffort ? `#${route.reasoningEffort}` : ''}`
}
