/**
 * r28：省 token 改造（t1）——成员提示词常驻「工作纪律」+ 门禁/续聊消息改用短任务标签。
 *
 * 为什么钉在消息/标签这一层而不是只测辅助函数：`task.title` 现在鼓励写「实现什么 + 关键文件/符号」，
 * 一条标题 2~3k 字。若它整段拼进每条派发/门禁/续聊消息，账本与 `auto_team_status` 的返回会按
 * 消息条数线性膨胀——单函数测起来很绿，产品仍然费 token。所以这里断言的是**消息正文**：
 *  - 3000 字多行标题 → 消息里只出现第一行的 ≤60 字标签，长尾巴绝不进账本；
 *  - 短标题原样保留（不能为了省 token 把正常标题也砍掉）；
 *  - 成员提示词里纪律段常驻、位于验收判定之前、正文 ≤1000 字（这段每次 spawn 都进上下文）。
 *
 * 变异自检：把 `taskLabelOf` 改回 `return task.title`、把纪律段删掉、把 resumeText/gateSummary
 * 改回直接插 `${task.title}`，分别会红在 ②③⑤⑥⑧⑨ 各条（见 t3 基线报告）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plan, PlanTask, Role } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import type { RoleRepo } from '../src/host/roles/repo.ts'
import {
  applyReceipt,
  dispatchReady,
  resumeText,
  taskLabelOf,
  type DispatchDeps,
} from '../src/host/team/dispatch.ts'
import { buildMemberPrompt, type MemberPromptDeps } from '../src/host/team/member-prompt.ts'
import { MAX_ATTEMPTS } from '../src/host/config.ts'

const NOW = 1_800_000_000_000
const LABEL_MAX = 60

/** 真实形态的长标题：第一行是「做什么」，后面跟关键文件与验证方式（t1 起鼓励这么写）。 */
const LONG_LINE_TITLE = `实现省 token 的状态投影：${'x'.repeat(3000)}`

const LONG_TITLE = [
  '实现自动团队的 token 预算投影：把消息账本与成员提示词按条数/字数收敛',
  '关键文件：src/host/tools.ts、src/host/team/dispatch.ts、src/host/team/member-prompt.ts',
  '符号：messageBrief、taskLabelOf、buildMemberPrompt',
  '验证：pnpm typecheck && pnpm test',
  `备注：${'z'.repeat(2500)}`,
].join('\n')

function makeTask(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: LONG_TITLE,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'pnpm typecheck',
    status: 'pending',
    ...overrides,
  }
}

function makePlan(tasks: PlanTask[]): Plan {
  return {
    runId: 'run-r28',
    sessionId: 'sess-r28',
    createdAt: NOW,
    status: 'dispatching',
    tasks,
    maxConcurrent: 3,
  }
}

function makeState(tasks: PlanTask[]): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: makePlan(tasks),
    plannedAt: NOW,
    messages: [],
    bindings: [],
    routeAudits: [],
  }
}

function makeRole(): Role {
  return { id: 'dev', name: 'dev', duty: '负责交付', skillIds: [], builtin: true, updatedAt: NOW }
}

function makeRoleRepo(): RoleRepo {
  return {
    list: () => [makeRole()],
    get: () => makeRole(),
    save: (role) => ({ ok: true as const, role }),
    remove: () => ({ ok: true as const }),
    seed: () => {},
    restoreDefaults: () => ({ restored: [], kept: [] }),
  }
}

function countCodePoints(text: string): number {
  return Array.from(text).length
}

const noMemory: MemberPromptDeps = { memoryFor: () => ({ text: '', truncated: false }) }

// ── ① 短标签：长标题被裁到 ≤60 code point ──────────────────────────────────────

test('r28① taskLabelOf：多行长标题只取第一行，第二行起（关键文件/长备注）绝不进标签', () => {
  const label = taskLabelOf(makeTask('t1'))
  const firstLine = LONG_TITLE.split('\n')[0]!

  assert.equal(label.includes('\n'), false, '标签不能含换行（账本一条消息一行）')
  assert.ok(countCodePoints(label) <= LABEL_MAX, `标签必须 ≤${LABEL_MAX} 字，实际 ${countCodePoints(label)}`)
  assert.equal(label, firstLine, '第一行本身 ≤60 字时原样保留，不加省略号')
  // 长尾巴（关键文件 / 2500 字备注）绝不能借标签进账本。
  assert.equal(label.includes('关键文件'), false, '第二行起的内容不许进标签')
  assert.equal(label.includes('z'.repeat(10)), false, '长备注不许进标签')
})

test('r28①b taskLabelOf：3000 字单行标题裁到 60 字并以省略号收尾', () => {
  const label = taskLabelOf(makeTask('t1', { title: LONG_LINE_TITLE }))
  assert.equal(countCodePoints(label), LABEL_MAX, '单行超长标题必须裁到 60 字（含省略号）')
  assert.ok(label.endsWith('…'))
  assert.equal(label, `${Array.from(LONG_LINE_TITLE).slice(0, LABEL_MAX - 1).join('')}…`)
})

test('r28② taskLabelOf：≤60 字标题原样返回（省 token 不等于砍正常标题）', () => {
  const exact = 'a'.repeat(LABEL_MAX)
  const short = '修复门禁 cwd'
  assert.equal(taskLabelOf(makeTask('t1', { title: exact })), exact, '正好 60 字不截断、不补省略号')
  assert.equal(taskLabelOf(makeTask('t1', { title: short })), short)
  const over = 'b'.repeat(LABEL_MAX + 1)
  const label = taskLabelOf(makeTask('t1', { title: over }))
  assert.equal(countCodePoints(label), LABEL_MAX, '61 字裁到 60（含省略号）')
  assert.equal(label, `${'b'.repeat(LABEL_MAX - 1)}…`, '第 61 个字被省略号取代')
})

test('r28③ taskLabelOf：按 code point 截断，emoji 不会被劈成孤立代理项', () => {
  const title = '😀'.repeat(90) // UTF-16 长度 180，code point 90
  const label = taskLabelOf(makeTask('t1', { title }))
  assert.ok(countCodePoints(label) <= LABEL_MAX)
  assert.doesNotMatch(label, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, '不能出现孤立高位代理项')
  assert.equal(label, `${'😀'.repeat(LABEL_MAX - 1)}…`)
})

// ── ② 续聊 / 门禁消息：正文用短标签，长标题不进账本 ────────────────────────────

test('r28④ resumeText：续聊消息只带短标签，3000 字标题不再整段进账本', () => {
  const text = resumeText(makeTask('t1'))
  const label = taskLabelOf(makeTask('t1'))

  assert.ok(text.includes('继续执行任务 t1'), '必须点名任务 id（短标签只服务「哪个任务」）')
  assert.ok(text.includes(`「${label}」`), '正文里的标签必须是截断后的短标签')
  assert.equal(text.includes('关键文件'), false, '标题长尾巴不许进续聊消息')
  assert.ok(countCodePoints(text) < 200, `续聊消息必须收敛（实际 ${countCodePoints(text)} 字）`)
})

test('r28⑤ applyReceipt：门禁通过 / 失败 / 返工三类消息都只用短标签', () => {
  const cases: Array<{ verdict: 'done' | 'failed' | 'rework'; prefix: string }> = [
    { verdict: 'done', prefix: '门禁通过' },
    { verdict: 'failed', prefix: '已被判定失败' },
    { verdict: 'rework', prefix: '返工第 1/' },
  ]
  const label = taskLabelOf(makeTask('t1'))

  for (const { verdict, prefix } of cases) {
    const next = applyReceipt(
      makeState([makeTask('t1', { status: 'running', memberId: 'm-dev-t1' })]),
      't1',
      { verdict, note: '证据：exit=1，断言未通过', evidence: { taskId: 't1', command: 'pnpm test', exitCode: 1, tail: 'not ok 1', artifacts: [], at: NOW } },
      NOW + 1,
    )
    const body = next.messages.at(-1)?.body ?? ''
    assert.ok(body.includes(`任务 t1「${label}」`), `${verdict}：消息必须用短标签（实际：${body.slice(0, 120)}）`)
    assert.ok(body.startsWith(`${prefix}`), `${verdict}：前缀原样保留（${body.slice(0, 40)}）`)
    assert.equal(body.includes('关键文件'), false, `${verdict}：标题长尾巴不许进门禁消息`)
    assert.ok(countCodePoints(body) < 400, `${verdict}：单条门禁消息必须收敛（实际 ${countCodePoints(body)} 字）`)
    // 证据必须仍然进消息：省 token 不能把审计信息一起省掉。
    assert.ok(body.includes('exit=1'), `${verdict}：证据 exit code 必须保留`)
  }
})

test('r28⑥ applyReceipt：返工达上限的转人工消息同样用短标签且保留自述', () => {
  const task = makeTask('t1', { status: 'running', memberId: 'm-dev-t1', attempts: MAX_ATTEMPTS - 1 })
  const next = applyReceipt(
    makeState([task]),
    't1',
    { verdict: 'rework', note: '第三次仍失败：测试断言与实现不一致' },
    NOW + 1,
  )
  const body = next.messages.at(-1)?.body ?? ''
  const label = taskLabelOf(task)

  assert.equal(next.plan.tasks[0]?.status, 'failed', '达到上限转 failed')
  assert.ok(body.includes(`任务 t1「${label}」已转人工`), '转人工文案必须用短标签')
  assert.ok(body.includes('第三次仍失败'), '成员自述必须保留（省 token 不等于省证据）')
  assert.equal(body.includes('关键文件'), false, '标题长尾巴不许进账本')
})

// ── ③ 派发消息：账本用短标签，spawn prompt 仍拿完整标题 ───────────────────────

test('r28⑦ dispatchReady：派发消息用短标签，成员拿到的 task 仍是完整标题', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r28-'))
  try {
    const store = new RunsStore(dir)
    const spawned: PlanTask[] = []
    const deps: DispatchDeps = {
      store,
      roles: makeRoleRepo(),
      buildPrompt: () => 'prompt',
      listMembers: async () => [],
      spawn: async (input) => {
        spawned.push(input.task)
        return { ok: true as const, memberId: 'm-dev-t1' }
      },
      hostConcurrency: () => ({ limit: 8, source: 'host' }),
      now: () => NOW,
    }
    const result = await dispatchReady(makeState([makeTask('t1')]), deps)
    const body = result.state.messages.at(-1)?.body ?? ''
    const label = taskLabelOf(makeTask('t1'))

    assert.deepEqual(result.started, ['t1'])
    assert.ok(body.includes(`任务 t1「${label}」`), '派发消息必须用短标签')
    assert.equal(body.includes('关键文件'), false, '派发消息不许带标题长尾巴')
    assert.ok(body.includes('pnpm typecheck'), '验收判定必须保留（成员要知道怎么自证）')
    assert.equal(spawned[0]?.title, LONG_TITLE, 'spawn 输入里的任务标题必须完整（成员要按它干活）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── ④ 成员提示词：工作纪律常驻且不膨胀 ────────────────────────────────────────

const DISCIPLINE_HEADER = '## 工作纪律（省 token，硬要求）'

function disciplineSectionOf(prompt: string): string {
  const start = prompt.indexOf(DISCIPLINE_HEADER)
  assert.ok(start >= 0, '提示词必须含「工作纪律（省 token，硬要求）」段')
  const nextHeader = prompt.indexOf('\n## ', start + DISCIPLINE_HEADER.length)
  return nextHeader < 0 ? prompt.slice(start) : prompt.slice(start, nextHeader)
}

test('r28⑧ buildMemberPrompt：省 token 纪律常驻，且排在验收判定之前', () => {
  // 无技能、无记忆、无交接：纪律不能被「有技能正文才出现」之类条件挂住。
  const prompt = buildMemberPrompt({ plan: makePlan([makeTask('t1')]), task: makeTask('t1'), role: makeRole(), name: 'dev-t1' }, noMemory)
  const section = disciplineSectionOf(prompt)
  const disciplineAt = prompt.indexOf(DISCIPLINE_HEADER)
  const acceptanceAt = prompt.indexOf('## 验收判定')

  assert.ok(disciplineAt >= 0)
  assert.ok(acceptanceAt > disciplineAt, '纪律必须排在验收判定之前（先学怎么省，再读命令）')
  assert.ok(prompt.indexOf('## 本次任务') >= 0, '任务段必须存在')
  // 六条硬要求缺一不可。
  for (const keyword of ['grep -n', '并行发多个互不依赖的工具调用', 'tail -30', '全量门禁只在收尾跑一次', 'compress', 'reasoning 只写决策']) {
    assert.ok(section.includes(keyword), `纪律段必须含「${keyword}」`)
  }
  assert.equal((section.match(/^- /gm) ?? []).length, 6, '纪律段固定 6 条（增删一条都要改这段契约）')
})

test('r28⑨ buildMemberPrompt：纪律段 ≤1000 字——它每次 spawn 都进上下文', () => {
  const prompt = buildMemberPrompt({ plan: makePlan([makeTask('t1')]), task: makeTask('t1'), role: makeRole(), name: 'dev-t1' }, noMemory)
  const section = disciplineSectionOf(prompt)
  assert.ok(countCodePoints(section) <= 1000, `纪律段必须 ≤1000 字（实际 ${countCodePoints(section)}）`)
})

test('r28⑩ buildMemberPrompt：上游交接与短标签互不干扰（交接原样、任务标题仍完整）', () => {
  const task = makeTask('t1')
  const prompt = buildMemberPrompt(
    {
      plan: makePlan([task]),
      task,
      role: makeRole(),
      name: 'dev-t1',
      handoffs: ['【上游直投】t1 … 已通过门禁\n产物：/tmp/t1.log'],
    },
    noMemory,
  )
  assert.ok(prompt.includes('产物：/tmp/t1.log'), '上游交接必须原样进提示词')
  assert.ok(prompt.includes(LONG_TITLE), '成员任务标题必须完整（短标签只用于消息账本）')
})
