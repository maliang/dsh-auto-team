/**
 * 队长模型（AC-2 / AC-3）：配置读取 + 快照三态投影。
 *
 * **为什么把「配置位」与「能力位」拆成两个参数**：宿主能否给主 session（队长）单独指定模型
 * 尚未验证（TECHNICAL §5.2 与 §10 的 U3），而「用户写了什么配置」与「这个配置能不能生效」
 * 是两件互相独立的事实。把两者压成一个布尔，不可用时只有两条烂路：要么丢掉回显（用户看不到
 * 自己写的配置，下次还要再问一遍），要么假装生效（违反 anti-goal 5：不假称）。所以：
 *   - `readCaptainModel()` 只从盘上读数，读不到/残缺一律 `null`，**永不抛异常**（装配层不能因为
 *     一个手写的 json 写错就整插件崩掉）；
 *   - `captainModelView()` 只做投影：`source` 由 `route × capability` 机械决定，没有第三种推断。
 *
 * 配置源：`<dataRoot>/captain.json`（`{ provider, model, reasoningEffort? }`）。本期**不提供写入口**
 * —— 新增写入口只能走新 `PanelAction` 或新路由，两者都被 AC-16 的「复用既有动作/路由」硬约束排除，
 * 因此快照与面板只做**只读回显**，文件由用户手写（README 一行说明）。
 */
import { readFileSync } from 'node:fs'
import type { CaptainModelView, RoleModelRoute } from '../../shared/types.ts'
import { describeRouteOf } from './route.ts'

/** `reasoningEffort` 的合法集合（与 `RoleModelRoute.reasoningEffort` 的联合类型逐字一致）。 */
const EFFORTS: readonly string[] = ['low', 'medium', 'high']

/**
 * 读 `<dataRoot>/captain.json`；文件不存在、不可读、不是合法 JSON、或缺 provider/model → `null`。
 *
 * 「残缺」与「没配」在投影上等价（都是 `host-default`），所以这里不区分错误类型：
 * 区分只会让调用方多写一份文案，而用户能做的动作是同一个（去看那个文件）。
 */
export function readCaptainModel(dataRoot: string): RoleModelRoute | null {
  const root = (dataRoot ?? '').replace(/\/+$/, '')
  if (root === '') return null
  let raw: string
  try {
    raw = readFileSync(`${root}/captain.json`, 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return routeOf(parsed)
}

/** 逐字校验配置对象（provider/model 原样透传，只去首尾空白，不做别名归一）。 */
function routeOf(value: unknown): RoleModelRoute | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
  const model = typeof record.model === 'string' ? record.model.trim() : ''
  if (provider === '' || model === '') return null
  const route: RoleModelRoute = { provider, model }
  const effort = record.reasoningEffort
  // 未知 effort 丢掉而不是整份配置作废：provider/model 仍然可用，被丢弃的只是一条强度提示。
  if (typeof effort === 'string' && EFFORTS.includes(effort)) {
    route.reasoningEffort = effort as RoleModelRoute['reasoningEffort']
  }
  return route
}

/**
 * 快照投影（AC-2）：三态一一对应 PRD 的 `configured` / `host-default` / `unsupported`。
 *
 * `value` 在 `unsupported` 下**仍然回显配置值**（用户写了什么就一定看得见），
 * 区别只体现在 `source` 与 `note`：`unsupported` 的 note 明说「未生效」，绝不假称。
 */
export function captainModelView(
  route: RoleModelRoute | null,
  capability: 'ok' | 'unsupported',
): CaptainModelView {
  if (route === null) {
    return {
      value: null,
      route: null,
      source: 'host-default',
      note: '未指定队长模型：队长使用宿主会话默认模型（可在 <dataRoot>/captain.json 写入 provider/model）。',
    }
  }
  // 展示文案复用 `route.ts` 的 `describeRouteOf`：与角色模型审计（AC-22）同一份格式，
  // 避免「同一份路由在角色页与队长行显示不一致」这类分叉（客户端也复用它的 `formatModelRoute`）。
  const value = describeRouteOf(route)
  if (capability === 'ok') {
    return { value, route, source: 'configured', note: `队长模型已生效：${value}` }
  }
  return {
    value,
    route,
    source: 'unsupported',
    note: '宿主暂不支持单独指定队长模型：配置已保留，未生效。',
  }
}
