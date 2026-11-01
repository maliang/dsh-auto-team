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

const peerBody = '【上游直投】t1 把面板拆成三列 已通过门禁\n命令：pnpm -s test\n退出码：0\n产物：lib/index.js'

test('buildMemberPrompt：上游交接原样进 prompt，且排在「本次任务」之后、「验收判定」之前（AC-4b）', () => {
  const prompt = buildMemberPrompt(
    {
      plan,
      task: makeTask('t2', { dependsOn: ['t1'] }),
      role: makeRole([]),
      name: 'dev-t2',
      handoffs: [peerBody],
    },
    noMemory,
  )

  assert.ok(prompt.includes(peerBody), '交接正文必须逐字进 prompt（与账本同一字符串）')
  assert.ok(prompt.includes('## 上游交接'), '必须有小节标题，成员才知道这段不是队长转述')
  assert.ok(prompt.includes('以下内容由上游任务的门禁证据直接投递，不需要再问队长：'), '必须说明不用再问队长')
  assert.ok(!prompt.includes('captain'), 'prompt 里不许出现 captain（否则等于又绕回队长）')

  const taskAt = prompt.indexOf('## 本次任务（t2）')
  const handoffAt = prompt.indexOf('## 上游交接')
  const acceptanceAt = prompt.indexOf('## 验收判定')
  assert.ok(taskAt >= 0 && handoffAt > taskAt, '交接段必须在「本次任务」之后（先知道自己干什么，再读上游证据）')
  assert.ok(acceptanceAt > handoffAt, '交接段必须在「验收判定」之前（读验收命令前先拿到上游产物路径）')
})

test('buildMemberPrompt：没有 handoffs（空数组或未传）时不许出现「上游交接」段', () => {
  const empty = buildMemberPrompt(
    { plan, task: makeTask('t2'), role: makeRole([]), name: 'dev-t2', handoffs: [] },
    noMemory,
  )
  assert.ok(!empty.includes('## 上游交接'), '空数组不许造一个空小节')
  assert.ok(!empty.includes('以下内容由上游任务的门禁证据直接投递'), '引导句也不许出现')

  const absent = buildMemberPrompt({ plan, task: makeTask('t2'), role: makeRole([]), name: 'dev-t2' }, noMemory)
  assert.equal(empty, absent, 'handoffs 未传与空数组必须产出完全相同的 prompt（可选字段语义）')
})

test('buildMemberPrompt：多个上游按传入顺序排列，且不破坏空行过滤契约', () => {
  const second = '【上游直投】t3 另一个上游 已通过门禁\n命令：pnpm -s build\n退出码：0\n产物：无落盘产物'
  const prompt = buildMemberPrompt(
    {
      plan,
      task: makeTask('t4', { dependsOn: ['t1', 't3'] }),
      role: makeRole([]),
      name: 'dev-t4',
      handoffs: [peerBody, second],
    },
    noMemory,
  )
  assert.ok(prompt.indexOf(peerBody) < prompt.indexOf(second), '多个上游必须保持传入（时间正序）顺序')
  assert.ok(prompt.includes(second), '第二个上游正文也必须完整进 prompt')
  // 既有契约：lines.filter(l => l !== '') 之后不许出现连续空行（段落间恰好一个空行）。
  assert.ok(!prompt.includes('\n\n\n'), '不许出现连续空行，否则渲染成松散的空段落')
})

// ---------- r7 AC-7：role.prompt 必须真的进成员提示词 ----------

test('buildMemberPrompt：role.prompt 进 prompt，且排在「本次任务」之前（存了必须用上）', () => {
  // 特征串取自内置 pm 的逐字正文：只有真把 `role.prompt` 拼进去才会出现。
  const pm = BUILTIN_ROLES.find((role) => role.id === 'pm')
  assert.ok(pm?.prompt, '内置 pm 必须带 prompt（AC-7 的逐字来源）')
  const signature = '验收标准必须可判定'
  assert.ok(pm!.prompt!.includes(signature), '特征串必须在内置 prompt 里（否则本断言不承载信息）')

  const prompt = buildMemberPrompt(
    { plan, task: makeTask('t1', { roleId: 'pm' }), role: pm, name: 'pm-t1' },
    noMemory,
  )
  assert.ok(prompt.includes('## 角色要求'), 'prompt 必须有独立段标题（成员才知道这是「额外要求」）')
  assert.ok(prompt.includes(signature), '内置角色的 prompt 正文必须逐字进成员提示词')
  assert.ok(
    prompt.indexOf('## 角色要求') < prompt.indexOf('## 本次任务'),
    '角色要求必须排在本次任务之前：先给身份纪律、再给方法、最后给任务',
  )
})

test('buildMemberPrompt：role.prompt 缺失或空白时不出现「角色要求」段（不许留空壳标题）', () => {
  for (const role of [makeRole([]), { ...makeRole([]), prompt: '   ' }]) {
    const prompt = buildMemberPrompt({ plan, task: makeTask('t1'), role, name: 'dev-t1' }, noMemory)
    assert.ok(!prompt.includes('## 角色要求'), '没有 prompt 时不许留一个空标题（成员会以为要求丢了）')
    assert.ok(prompt.includes('## 本次任务'), '其他段照常')
  }
})

test('buildMemberPrompt：自建角色改过的 prompt 立刻生效（面板/设置页改完不用重启）', () => {
  const role = { ...makeRole([]), prompt: '本团队约定：提交前必须跑 pnpm build，并在结论里贴退出码。' }
  const prompt = buildMemberPrompt({ plan, task: makeTask('t1'), role, name: 'dev-t1' }, noMemory)
  assert.ok(prompt.includes('提交前必须跑 pnpm build'), '自建/改写的 prompt 必须原样进提示词')
})

/* ─────────────────── r10：技能正文必须读盘上版本，而不是出厂常量 ─────────────────── */

const EDITED_BODY = '# 实现（我改过的版本）\n\n盘上正文特写句：先跑一遍失败用例再动手。'

function depsWithBodies(bodies: Record<string, string>): MemberPromptDeps {
  return { ...noMemory, skillBodyOf: (skillId: string) => bodies[skillId] ?? '' }
}

test('buildMemberPrompt：skillBodyOf 提供的盘上正文优先于内置常量（AC-29 重启读回的前提）', () => {
  const dev = BUILTIN_ROLES.find((role) => role.id === 'dev')
  assert.ok(dev, '内置 dev 角色必须存在')
  const builtinLine = signatureOf('implementation', '改动最小化')

  const prompt = buildMemberPrompt(
    { plan, task: makeTask('t1'), role: dev, name: 'dev-t1' },
    depsWithBodies({ implementation: EDITED_BODY }),
  )

  assert.ok(prompt.includes('盘上正文特写句'), '用户改过的内置技能正文必须进 prompt')
  assert.ok(!prompt.includes(builtinLine), '出厂正文不得覆盖盘上正文（否则「改了只在界面生效」的假象回来）')
})

test('buildMemberPrompt：skillBodyOf 对某技能返回空串时退回出厂正文，不许把技能正文变成空白段', () => {
  const dev = BUILTIN_ROLES.find((role) => role.id === 'dev')
  assert.ok(dev, '内置 dev 角色必须存在')
  const builtinLine = signatureOf('implementation', '改动最小化')

  const prompt = buildMemberPrompt(
    { plan, task: makeTask('t1'), role: dev, name: 'dev-t1' },
    depsWithBodies({ implementation: '' }),
  )

  assert.ok(prompt.includes(builtinLine), '盘上读不到时必须退回内置正文（不许静默变成空技能）')
})

test('buildMemberPrompt：未注入 skillBodyOf 时行为与 r9 一致（内置正文照旧）', () => {
  const dev = BUILTIN_ROLES.find((role) => role.id === 'dev')
  assert.ok(dev, '内置 dev 角色必须存在')
  const builtinLine = signatureOf('implementation', '改动最小化')
  const prompt = buildMemberPrompt({ plan, task: makeTask('t1'), role: dev, name: 'dev-t1' }, noMemory)
  assert.ok(prompt.includes(builtinLine), '缺省装配不得改变既有提示词内容')
})
