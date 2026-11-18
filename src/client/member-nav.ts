/**
 * r33 / t2：成员跳转的唯一落地动作（角色卡 / 任务行 / 流程图节点三处入口共用）。
 *
 * 判定已由 `viewmodel.ts` 的 `memberJumpOf` 做完，这里只负责「调宿主会话服务 + 把结局翻成人话」：
 *  - 不可跳（`available === false` 或没有 memberId）：留一行原因，禁止静默；
 *  - 可跳：调 `session.ts` 的 `requestMemberSession`，结局统一经 `memberJumpNoticeOf` 翻译。
 *
 * 返回 `null` = 成功（调用方清空提示，不渲染空行）。抽成独立模块而不是在组件里复制，
 * 是为了保证「任务页」与「左栏 RunDrawer」的跳转行为与文案永远一致。
 */
import { memberJumpNoticeOf } from './viewmodel.ts'
import type { MemberJumpView } from './viewmodel.ts'
import { requestMemberSession } from './session.ts'

export function jumpToMemberSession(jump: MemberJumpView): string | null {
  if (!jump.available || jump.memberId === undefined) {
    return memberJumpNoticeOf('no-member', jump) ?? null
  }
  return memberJumpNoticeOf(requestMemberSession(jump.memberId), jump) ?? null
}
