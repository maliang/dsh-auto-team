/**
 * 成员 spawn prompt 的**纯构造**模块（AC-10 的测试面）。
 *
 * 为什么从 `host/index.ts` 的 `apply()` 内闭包里搬出来：写在闭包里就无法被 import，
 * 独立运行期探针拿不到「真实的 buildPrompt」，只能另写一份近似实现去断言——
 * 那种断言证明的是探针，不是产品。搬成纯函数后：
 *   - 宿主装配层（`index.ts`）只留一行委托，不承载任何业务文案；
 *   - `test/member-prompt.test.ts` 可以直接单测「技能正文 / 记忆截断提示是否真的进了 prompt」；
 *   - `qa-skill-prompt-probe.mjs` 可以真实 `createBridge` + `dispatchReady` + 这里，
 *     捕获「宿主真正会拿到的 spawn prompt」。
 *
 * 依赖方向：`memoryFor` 由调用方注入（装配层注入 bridge 的实现），本模块不碰 `ctx.*`、
 * 不读文件、不抛错，因此可以脱离宿主直接运行。
 */
import type { Role } from '../../shared/types.ts'
import { describeRoute } from '../bridge.ts'
import { composeSkillPrompt } from '../roles/builtin.ts'
import type { PromptInput } from './dispatch.ts'

/** 本模块唯一的外部能力：按目标取相关团队记忆（已按预算裁剪好）。 */
export interface MemberPromptDeps {
  memoryFor(goal: string): { text: string; truncated: boolean }
}

/** 把角色 / 任务 / 团队记忆 / 技能正文拼成成员 spawn prompt。 */
export function buildMemberPrompt(input: PromptInput, deps: MemberPromptDeps): string {
  const role: Role | undefined = input.role
  const skills = role ? composeSkillPrompt(role) : { text: '', missing: [] }
  const memory = deps.memoryFor(input.task.title)
  // AC-4(b)：上游直投内容原样进首条提示词。段落位置是刻意的 —— 在「本次任务」之后
  // （成员已经知道自己要干什么）、「验收判定」之前（读验收命令前先拿到上游证据与产物路径）。
  const handoffs = input.handoffs ?? []
  // r7 AC-7：角色提示词（`Role.prompt`，设置页/面板可改）必须真的进成员提示词。
  // 顺序按 TECHNICAL §6.3 固定：角色名 → duty → prompt → 技能正文 → 任务与验收 → 记忆；
  // 位置刻意放在技能之前 —— 技能是「怎么做的方法」，prompt 是「这个角色额外要遵守什么」，
  // 先给身份与纪律、再给方法、最后给本次任务，成员读到的优先级与队长的意图一致。
  const rolePrompt = role?.prompt?.trim() ?? ''
  const lines = [
    `# 角色：${role?.name ?? input.task.roleId}`,
    role?.duty ? `职责：${role.duty}` : '',
    `模型路由：${describeRoute(role)}`,
    '',
    ...(rolePrompt === '' ? [] : ['## 角色要求', rolePrompt, '']),
    '## 技能',
    skills.text === '' ? '（无）' : skills.text,
    skills.missing.length > 0 ? `\n（缺失技能定义：${skills.missing.join('、')}）` : '',
    '',
    `## 本次任务（${input.task.id}）`,
    input.task.title,
    input.task.dependsOn.length > 0 ? `前置任务（已完成）：${input.task.dependsOn.join('、')}` : '',
    '',
    ...(handoffs.length > 0
      ? ['## 上游交接', '以下内容由上游任务的门禁证据直接投递，不需要再问队长：', ...handoffs, '']
      : []),
    '## 验收判定（必须实际执行并回报退出码）',
    input.task.acceptance === '' ? '（未声明；视为需要人工确认，不得自称完成）' : `\`${input.task.acceptance}\``,
    '',
    '## 团队记忆（截断策略：总预算固定，超出部分不进上下文）',
    memory.text === '' ? '（暂无相关记忆）' : memory.text,
    memory.truncated ? '\n（注意：记忆已截断，完整内容请用 auto_team_memory 读取）' : '',
  ]
  return lines.filter((line) => line !== '').join('\n')
}
