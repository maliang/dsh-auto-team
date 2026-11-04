/**
 * 队长常驻提示词（ctx.systemPrompt.section）。
 *
 * 只描述「怎么当一个合格的队长」——具体角色、任务、记忆都按需由工具读取，
 * 不把整份计划塞进常驻上下文（那会随每次对话重复计费）。
 *
 * r5（AC-1）：队长分层靠两条腿——**提示词里的硬约束**（模型自己愿意守）与 **noWait 守卫**
 * （机械拒绝，见 `team/guard.ts`）。提示词这一侧固化三条可 grep 的中文特征句；同时本函数
 * **结构上只读** `snapshot.enabled / snapshot.memory / snapshot.captainModel`，从不触碰计划
 * 任务列表 —— 「不把整份计划塞进常驻上下文」由不取那份数据来保证，而不是靠自律。
 */
import type { Bridge } from './bridge.ts'
import { registerPromptSection, type HostContext } from './adapters.ts'
import type { CaptainModelView, PanelSnapshot } from '../shared/types.ts'

export interface PromptDeps {
  bridge: Bridge
}

/** 硬约束（AC-1 的可 grep 特征句；r14 追加「受理后立即结束本轮」一条）：独立成段放在「工作方式」之前。 */
export const CAPTAIN_CONSTRAINTS: readonly string[] = [
  '- 你**不亲自干细活**：读文件、改代码、跑测试、修 bug 一律派给成员。',
  '- 你**只做三件事**：拆解目标、分派任务、验收结果。',
  '- **不要同步等长任务**：任何可能超过 5 秒的命令都必须后台执行（命令末尾加 `&`）或派给成员；前台 `sleep` 会被 noWait 守卫直接拒绝并返回错误码。',
  // r14 AC-2：派发是**受理制** —— 工具返回「已接受派发」时成员还没起来。队长若留在本轮查状态，
  // 用户看到的就是「派发完了主对话还在转」；这句同时解释为什么不用等（成员不是宿主队友）。
  '- **派发后立即结束本轮，不要等待成员**：`auto_team_dispatch` 返回「已接受派发」即表示后台已接手；成员不是宿主队友、不需要你等，也不要在同一轮反复查状态或轮询——用户会带着进展回来。',
]

export function captainSection(deps: PromptDeps, sessionId: string): string {
  const snapshot = deps.bridge.snapshot(sessionId)
  const lines = [
    '## 自动团队（队长视角）',
    // r11 修复：常驻段落是按插件作用域注册的、拿不到会话维度（`PromptSection.text` 只收到
    // `AssembleContext = { scope?, signal? }`，没有 session id），所以**不许断言「当前会话已启用/未启用」**
    // ——旧文案用占位会话 id 去查，真机上恒为「未启用」，于是队长被明确告知「不得创建成员」，
    // 用户看到的现象就是「开了自动团队但它从不干活」。改成把判定权交给工具：工具按真实
    // `exec.agent.id` 查开关，未开时回一条可读的「未启用」。
    '本插件按会话启用：开关是输入框工具条里的「自动团队」选项，状态以它和面板为准（本段不替你断言当前会话是否已开）。',
    '开关没开时 `auto_team_*` 工具会直接返回「未启用」：那时用一句话告诉用户在哪里打开，不要假设已开启、也不要自行创建成员。',
    '',
    '队长定位（硬约束，任何情况下都不得违反）：',
    ...CAPTAIN_CONSTRAINTS,
    '',
    '工作方式（顺序不可颠倒）：',
    '1. **先 plan，再 dispatch**：把目标拆成有依赖的任务图用 `auto_team_plan`（每个任务必须指定 roleId 与可执行的 acceptance），**计划条目先落地**，用户确认（或明确说「开干」）后才用 `auto_team_dispatch` 派发。',
    '2. `auto_team_dispatch` **必须带 plan 返回的 runId**：它同时用于确认「你派的是刚给用户看的那份计划」。缺少 runId 会被直接拒绝——这是「计划早于第一个成员」的机械保证（AC-30），不要试图绕过。',
    '3. 派发前提醒用户：计划可在面板「计划」页改角色、取消；取消后成员数为 0。派发后同一时刻在跑的任务数受 maxConcurrent 限制（默认 3），超出的会排队等前置任务过门禁。',
    '4. 成员是**可续聊**的独立 Agent：用 `auto_team_message` 直达消息，中断后用同一 memberId 继续（面板「继续」或 `resume`），不要重新创建同名成员。',
    '5. **完成必须过门禁**：任务从 running 到 done 唯一入口是 `auto_team_receipt`（host 会执行该任务的 acceptance 并记录命令、退出码、输出尾部）。成员口头说「做完了」、你读代码觉得「应该没问题」都不算完成；门禁失败的任务转 rework，其下游保持 blocked，你必须把失败证据发回原成员再改。',
    '6. 团队记忆分公共与项目两轨，都是 md：相关约定优先 `auto_team_memory` 读取，沉淀时才写入。',
    '7. 面板（输入框内「自动团队」选项 + 右栏面板）是用户的可视入口与唯一状态来源；你的结论要与面板显示一致。',
  ]
  // 两行都「有内容才出现」，避免常驻段随风膨胀（预算 ≤2600 字符，见 test/captain.test.ts）。
  const notes = [captainModelLineOf(snapshot.captainModel), memoryLineOf(snapshot.memory)].filter(
    (line) => line !== '',
  )
  if (notes.length > 0) lines.push('', ...notes)
  return lines.join('\n')
}

/**
 * 队长模型一行（AC-2）：`host-default` 不写（未配置时不改变任何行为，也不占上下文）；
 * `configured` 写逐字路由；`unsupported` 明说「未生效」——绝不把保留的配置说成已生效。
 */
export function captainModelLineOf(view: CaptainModelView | null | undefined): string {
  if (!view || view.source === 'host-default') return ''
  if (view.source === 'configured') return `队长模型：${view.value ?? ''}`.trim()
  return '队长模型：宿主暂不支持单独指定（配置已保留，未生效）'
}

/**
 * 记忆一行（AC-8）：`truncated` 的语义已改成「有未内联条目」，于是文案不再使用旧的
 * 旧标注，而是告诉模型「另外还有几条、怎么按 ID 取回」——超预算的那部分从「丢掉」变成「可按需展开」。
 */
export function memoryLineOf(memory: PanelSnapshot['memory'] | undefined): string {
  if (!memory) return ''
  const omitted = memory.omitted?.length ?? 0
  const usage = `已内联 ${memory.injectedChars}/${memory.budget} 字符`
  if (omitted > 0) {
    return `团队记忆另有 ${omitted} 条未内联（${usage}）：按 \`mem://\` ID 用 \`auto_team_memory\`（action=expand）展开全文。`
  }
  if (memory.truncated) {
    return `团队记忆超出注入预算（${usage}）：按 \`mem://\` ID 用 \`auto_team_memory\`（action=expand）展开全文。`
  }
  return ''
}

export function registerCaptainPrompt(ctx: HostContext, deps: PromptDeps, sessionId: string): void {
  registerPromptSection(ctx, {
    name: 'auto-team',
    order: 900,
    content: () => captainSection(deps, sessionId),
  })
}
