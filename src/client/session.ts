/**
 * r33：把「点角色卡 / 任务行 / 流程图节点」变成「切到那个成员的宿主会话」。
 *
 * 唯一入口（t1 侦察结论，见 docs/teamflow/2026-11-13-r33-jump-to-member/API-FINDINGS.md）：
 *  宿主 client 服务 `uiWorkspace` 的 `openSession(sessionId)`：
 *   - 成员 id 与 session id 同源，直接传 `memberId`；
 *   - **同步**、返回 `void`、失败会 **throw**（不返回 false），所以必须 try/catch；
 *   - 主区回会话由宿主自己 `layout.selectPanel(null)`，插件不用管；
 *   - 服务稍后就绪：必须用 `ctx.inject(['uiWorkspace'], cb)` 等，不写进 entry 的 inject
 *     （那会让整条 entry 因缺服务不激活），也不用 `ctx.get`（client 半禁用它）。
 *
 * 这里只做「注册/调用」两件事，文案不在这里拼：结局码交给 `viewmodel.ts` 的
 * `memberJumpNoticeOf` 统一翻译，避免组件各处再写一套人话。
 */
import type { MemberSessionOutcome } from './viewmodel.ts'
import type { UiWorkspaceFace } from './slots.ts'

export type { UiWorkspaceFace }

/** cordis `ctx.inject(deps, cb)` 回调拿到的可选服务作用域。 */
export interface MemberSessionScope {
  uiWorkspace?: UiWorkspaceFace
}

/** 宿主交给 `apply` 的 ctx 里本模块需要的部分。 */
export interface MemberSessionContext {
  inject?(deps: readonly string[], fn: (scope: MemberSessionScope) => void): unknown
}

/** opener 的返回：`opened` 成功；`unavailable` 服务缺失；`rejected` 宿主抛错。 */
export type MemberSessionOpenOutcome = Exclude<MemberSessionOutcome, 'no-member'>

let memberSessionOpener: ((memberId: string) => MemberSessionOpenOutcome) | null = null

/**
 * 生成「打开成员会话」的闭包：服务缺失返回 `unavailable`，宿主抛错返回 `rejected`。
 * 两种情况调用方都要给用户一行原因（禁止静默）。
 */
export function createMemberSessionOpener(ctx: MemberSessionContext): (memberId: string) => MemberSessionOpenOutcome {
  let face: UiWorkspaceFace | undefined
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['uiWorkspace'], (scope) => {
        const found = scope.uiWorkspace
        if (found !== undefined) face = found
      })
    } catch (error) {
      // 注入本身失败 = 这个宿主永远给不了服务；保留日志，调用方仍按 unavailable 提示。
      console.warn('[dsh-auto-team] 会话导航服务注入失败，成员会话跳转将不可用', error)
    }
  }
  return (memberId: string): MemberSessionOpenOutcome => {
    if (typeof memberId !== 'string' || memberId.trim() === '') return 'unavailable'
    if (face === undefined || typeof face.openSession !== 'function') return 'unavailable'
    try {
      face.openSession(memberId)
      return 'opened'
    } catch (error) {
      console.warn('[dsh-auto-team] 宿主拒绝切换成员会话', memberId, error)
      return 'rejected'
    }
  }
}

/**
 * 在插件 `apply` 里注册 opener（幂等：重复调用只换实现，不叠加副作用）。
 * 返回是否注册成功，便于测试与启动日志。
 */
export function registerMemberSession(ctx: MemberSessionContext): boolean {
  memberSessionOpener = createMemberSessionOpener(ctx)
  return true
}

/** 清掉已注册的 opener（单测 / 卸载用）。 */
export function resetMemberSessionOpener(): void {
  memberSessionOpener = null
}

/**
 * 调用已注册的 opener。
 * `null` = 还没注册（单测 / 非浏览器宿主）；`no-member` = 传进来的成员 id 为空。
 */
export function requestMemberSession(memberId: string | undefined): MemberSessionOutcome | null {
  const opener = memberSessionOpener
  if (opener === null) return null
  if (typeof memberId !== 'string' || memberId.trim() === '') return 'no-member'
  return opener(memberId)
}
