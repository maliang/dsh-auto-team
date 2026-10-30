/**
 * 队长常驻提示词（ctx.systemPrompt.section）。
 *
 * 只描述「怎么当一个合格的队长」——具体角色、任务、记忆都按需由工具读取，
 * 不把整份计划塞进常驻上下文（那会随每次对话重复计费）。
 */
import type { Bridge } from './bridge.ts'
import { registerPromptSection, type HostContext } from './adapters.ts'

export interface PromptDeps {
  bridge: Bridge
}

export function captainSection(deps: PromptDeps, sessionId: string): string {
  const snapshot = deps.bridge.snapshot(sessionId)
  const enabled = snapshot.enabled ? '已启用' : '未启用'
  const lines = [
    '## 自动团队（队长视角）',
    `当前会话的自动团队开关：${enabled}${snapshot.enabled ? '' : '——未启用时不得创建成员，先用一句话说明如何启用'}。`,
    '',
    '工作方式（顺序不可颠倒）：',
    '1. **先 plan，再 dispatch**：把目标拆成有依赖的任务图用 `auto_team_plan`（每个任务必须指定 roleId 与可执行的 acceptance），**计划条目先落地**，用户确认（或明确说「开干」）后才用 `auto_team_dispatch` 派发。',
    '2. `auto_team_dispatch` **必须带 plan 返回的 runId**：它同时用于确认「你派的是刚给用户看的那份计划」。缺少 runId 会被直接拒绝——这是「计划早于第一个成员」的机械保证（AC-30），不要试图绕过。',
    '3. 派发前提醒用户：计划可在面板「计划」页改角色、取消；取消后成员数为 0。派发后同一时刻在跑的任务数受 maxConcurrent 限制（默认 3），超出的会排队等前置任务过门禁。',
    '4. 成员是**可续聊**的独立 Agent：用 `auto_team_message` 直达消息，中断后用同一 memberId 继续（面板「继续」或 `resume`），不要重新创建同名成员。',
    '5. **完成必须过门禁**：任务从 running 到 done 唯一入口是 `auto_team_receipt`（host 会执行该任务的 acceptance 并记录命令、退出码、输出尾部）。成员口头说「做完了」、你读代码觉得「应该没问题」都不算完成；门禁失败的任务转 rework，其下游保持 blocked，你必须把失败证据发回原成员再改。',
    '6. 团队记忆分公共与项目两轨，都是 md：相关约定优先 `auto_team_memory` 读取，沉淀时才写入。',
    '7. 面板（输入框下方开关 + 右栏「自动团队」）是用户的可视入口与唯一状态来源；你的结论要与面板显示一致。',
  ]
  if (snapshot.memory.truncated) {
    lines.push('', `注意：团队记忆已超出注入预算（${snapshot.memory.injectedChars}/${snapshot.memory.budget} 字符），面板显示「已截断」。`)
  }
  return lines.join('\n')
}

export function registerCaptainPrompt(ctx: HostContext, deps: PromptDeps, sessionId: string): void {
  registerPromptSection(ctx, {
    name: 'auto-team',
    order: 900,
    content: () => captainSection(deps, sessionId),
  })
}
