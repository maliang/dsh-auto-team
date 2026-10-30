/**
 * 成员 prompt 纯模块单测（AC-10 的便宜守卫）。
 *
 * 为什么值得单测：技能正文进不进 prompt 是「产品能力是否真的接通」的问题，
 * 而它在运行期只有靠读成员的第一次输出才能发现。把 `buildMemberPrompt` 抽成纯函数后，
 * 这里用一条 `assert.match` 就能先于运行期探针把它钉住。
 *
 * 对应实现：`src/host/team/member-prompt.ts`（原 `index.ts` apply() 内闭包，AC-10 要求可 import）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Plan, PlanTask, Role } from '../src/shared/types.ts'
import { buildMemberPrompt, type MemberPromptDeps } from '../src/host/team/member-prompt.ts'
import { BUILTIN_ROLES, BUILTIN_SKILLS } from '../src/host/roles/builtin.ts'

const plan: Plan = {
  runId: 'run-1',
  sessionId: 'sess-1',
  createdAt: 0,
  status: 'dispatching',
  tasks: [],
  maxConcurrent: 3,
}

function makeTask(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'pnpm typecheck',
    status: 'pending',
    ...overrides,
  }
}

function makeRole(skillIds: string[]): Role {
  return {
    id: 'dev',
    name: '高级全栈工程师',
    duty: '按技术方案实现代码并自证',
    skillIds,
    builtin: true,
    updatedAt: 0,
  }
}

const noMemory: MemberPromptDeps = { memoryFor: () => ({ text: '', truncated: false }) }

/** 取技能正文里的一整行当特征句：正文没注入 / 被截断都会红。 */
function signatureOf(skillId: string, keyword: string): string {
  const skill = BUILTIN_SKILLS.find((item) => item.id === skillId)
  assert.ok(skill, `内置技能 ${skillId} 必须存在`)
  const line = skill.body.split('\n').find((item) => item.includes(keyword))
  assert.ok(line, `技能 ${skillId} 正文必须含「${keyword}」`)
  return line
}

test('buildMemberPrompt：内置 dev 角色的技能正文（implementation + testing）必须真的进 prompt', () => {
  // 用**真实内置角色**而不是手搓 role：否则 BUILTIN_ROLES 的 skillIds 写错/漏项时这条断言照样绿。
  const dev = BUILTIN_ROLES.find((role) => role.id === 'dev')
  assert.ok(dev, '内置 dev 角色必须存在')
  assert.deepEqual(dev.skillIds, ['implementation', 'testing'], 'dev 的技能组合是契约本身')
  const implementation = signatureOf('implementation', '改动最小化')
  const testing = signatureOf('testing', '断言前先问')

  const prompt = buildMemberPrompt({ plan, task: makeTask('t1'), role: dev, name: 'dev-t1' }, noMemory)

  assert.ok(prompt.includes(implementation), '实现技能正文必须整段进 prompt（AC-10a 的便宜版本）')
  assert.ok(prompt.includes(testing), '测试技能正文必须整段进 prompt（dev 声明了两个技能，缺一即漏注入）')
  // 反向对照：没声明技能的角色不得凭空出现技能正文 —— 否则上面的断言可能被别处满足。
  const bare = buildMemberPrompt({ plan, task: makeTask('t1'), role: makeRole([]), name: 'dev-t1' }, noMemory)
  assert.ok(!bare.includes(implementation), '没声明技能的角色不许出现实现技能正文')
  assert.ok(!bare.includes(testing), '没声明技能的角色不许出现测试技能正文')
  assert.ok(bare.includes('## 技能'), '即使无技能也要保留小节标题')

  // 未知技能必须显式报出，不许静默吞掉（技能 id 打错是最容易发生的配置事故）。
  const withMissing = buildMemberPrompt(
    { plan, task: makeTask('t1'), role: { ...dev, skillIds: [...dev.skillIds, 'not-exist'] }, name: 'dev-t1' },
    noMemory,
  )
  assert.ok(withMissing.includes('缺失技能定义：not-exist'), '未知技能必须显式报出')
  assert.ok(withMissing.includes(implementation), '报出缺失技能时不能丢掉已知技能的正文')
})

test('buildMemberPrompt：记忆正文进 prompt，截断时附加显式提示（无记忆给占位）', () => {
  const withMemory = buildMemberPrompt(
    { plan, task: makeTask('t2'), role: makeRole([]), name: 'dev-t2' },
    { memoryFor: () => ({ text: '团队约定：提交前跑 pnpm build', truncated: true }) },
  )
  assert.ok(withMemory.includes('团队约定：提交前跑 pnpm build'), '记忆正文必须进 prompt')
  assert.ok(withMemory.includes('记忆已截断'), '截断必须提示，否则成员会以为记忆就是全部')

  const withoutMemory = buildMemberPrompt(
    { plan, task: makeTask('t2'), role: makeRole([]), name: 'dev-t2' },
    noMemory,
  )
  assert.ok(withoutMemory.includes('（暂无相关记忆）'), '没有相关记忆时要显式说明')
  assert.ok(!withoutMemory.includes('记忆已截断'), '未截断时不许出现截断提示')
})

test('buildMemberPrompt：任务身份/验收命令/角色职责都在 prompt 里，无角色时用 roleId 兜底', () => {
  const prompt = buildMemberPrompt(
    {
      plan,
      task: makeTask('t3', { title: '把成员名改成可核验的', dependsOn: ['t1'], acceptance: 'pnpm -s test' }),
      role: makeRole(['implementation']),
      name: 'dev-t3',
    },
    noMemory,
  )
  assert.ok(prompt.includes('## 本次任务（t3）'), 'prompt 必须能让成员知道自己在做哪个任务')
  assert.ok(prompt.includes('把成员名改成可核验的'), '任务标题必须进 prompt')
  assert.ok(prompt.includes('前置任务（已完成）：t1'), '依赖必须显式告知（否则成员会重做上游）')
  assert.ok(prompt.includes('`pnpm -s test`'), '验收命令必须进 prompt（AC-19 的自证依据）')
  assert.ok(prompt.includes('职责：按技术方案实现代码并自证'), '角色职责必须进 prompt')
  assert.ok(prompt.includes('模型路由：会话默认'), '无模型路由时说明「会话默认」，不许静默省略')

  const noRole = buildMemberPrompt({ plan, task: makeTask('t4', { roleId: 'qa' }), role: undefined, name: 'qa-t4' }, noMemory)
  assert.ok(noRole.startsWith('# 角色：qa'), '角色缺失时用 roleId 兜底，且不许抛错')

  const noAcceptance = buildMemberPrompt(
    { plan, task: makeTask('t5', { acceptance: '' }), role: makeRole([]), name: 'dev-t5' },
    noMemory,
  )
  assert.ok(noAcceptance.includes('（未声明；视为需要人工确认，不得自称完成）'), '验收命令为空时必须显式警示')
})
