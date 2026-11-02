/**
 * T3 工具层单测（tools.ts 的两个入口：`auto_team_plan` 与 `auto_team_add_tasks`）。
 *
 * 覆盖点与 PRD/TECHNICAL 的对应关系：
 *  - AC-2：plan 工具 description 必须明示「单任务计划合法 / 简单任务也走团队」，否则模型会绕过计划自己动手；
 *  - AC-6：空验收 → **整批拒绝且一条都不落盘**，错误文本含违规任务 id + 三条模板原文；
 *    判据是「store 目录前后逐字相等」，不是「返回 ok:false」——后者在 save 之后也成立；
 *  - AC-8：工具面 8 个、会话只经 `sessionOf` 且认宿主真实的 `exec.agent.id`；
 *  - AC-9：add_tasks 幂等（第二次 added=0、tasks 数不变、runId 不变）、依赖可指既有或同批、未知依赖整批拒绝；
 *  - AC-10：已取消/已终止的 run 追加失败，文案含 runId 与状态中文，store 不变；
 *  - AC-11：追加后 run 数量不变、tasks.length 等于追加前 + added。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Bridge } from '../src/host/bridge.ts'
import type { RoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { buildToolSpecs, sessionOf } from '../src/host/tools.ts'
import { ACCEPTANCE_TEMPLATES, ACCEPTANCE_TEMPLATE_BLOCK } from '../src/host/plan/acceptance.ts'
import type { ToolSpec } from '../src/host/adapters.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-t3'
/** 宿主真实形状：`exec` 上没有 sessionId，会话只在 `agent.id`（r11 真机事故）。 */
const META = { agent: { id: SESSION }, callId: 'call-1', name: 'auto_team_plan' }

interface Harness {
  dir: string
  store: RunsStore
  specs: ToolSpec[]
  tools: Map<string, ToolSpec>
}

function setup(options: { enabled?: boolean } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-t3-'))
  const store = new RunsStore(join(dir, 'runs'))
  // 这些用例只走 plan/add_tasks，不需要完整 Bridge；能答 enabled 即可。
  const bridge = { enabled: () => options.enabled ?? true } as unknown as Bridge
  const specs = buildToolSpecs({ store, roles: {} as RoleRepo, bridge, now: () => NOW })
  return { dir, store, specs, tools: new Map(specs.map((spec) => [spec.name, spec])) }
}

async function call(
  h: Harness,
  name: string,
  args: Record<string, unknown>,
  meta: unknown = META,
): Promise<Record<string, unknown>> {
  const spec = h.tools.get(name)
  assert.ok(spec, `工具 ${name} 必须存在`)
  return (await spec.handler(args, meta)) as Record<string, unknown>
}

/**
 * store 目录的「逐字快照」：文件名 → 内容原文。
 *
 * AC-6 的判据是「调用前后 store 内容完全相等」，所以必须比字节而不是比对象：
 * `save` 会归一化脏值、重排字段，对象深比较可能相等而文件已经变了（反之亦然）。
 */
function dirSnapshot(dir: string): Record<string, string> {
  const runsDir = join(dir, 'runs')
  if (!existsSync(runsDir)) return {}
  const out: Record<string, string> = {}
  for (const name of readdirSync(runsDir).sort()) {
    const full = join(runsDir, name)
    if (!statSync(full).isFile()) continue
    out[name] = readFileSync(full, 'utf8')
  }
  return out
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: {
      runId: 'run-t3',
      sessionId: SESSION,
      createdAt: NOW,
      status: 'draft',
      tasks: [
        {
          id: 't1',
          title: '任务 t1',
          roleId: 'dev',
          dependsOn: [],
          acceptance: 'exit 0',
          status: 'pending',
        },
      ],
      maxConcurrent: 3,
    },
    plannedAt: NOW,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...over,
  }
}

test('AC-8/AC-2：工具面 8 个，plan description 明示单任务合法', () => {
  const { specs, tools } = setup()

  assert.equal(specs.length, 8, '工具面从 7 扩到 8（新增 auto_team_add_tasks）')
  assert.deepEqual(
    specs.map((spec) => spec.name),
    [
      'auto_team_plan',
      'auto_team_dispatch',
      'auto_team_status',
      'auto_team_message',
      'auto_team_receipt',
      'auto_team_memory',
      'auto_team_role',
      'auto_team_add_tasks',
    ],
  )

  // AC-2：模型只有读到这句话才会「简单任务也拆成 1 个任务派出去」。
  const plan = tools.get('auto_team_plan')
  assert.ok(plan)
  assert.match(plan.description, /单任务/, 'plan description 必须出现「单任务」')
  assert.match(plan.description, /简单任务/, 'plan description 必须出现「简单任务」')
  assert.match(plan.description, /不自己动手/, 'plan description 必须说明队长不自己动手')
  assert.match(plan.description, /合法/, 'plan description 必须说明单任务计划合法')

  // 写域必须是**模型看得见**的字段：看不见的字段等于不存在（模型会照旧不声明）。
  const properties = (plan.parameters.properties ?? {}) as Record<string, Record<string, unknown>>
  const items = properties.tasks?.items as Record<string, unknown> | undefined
  const itemProperties = (items?.properties ?? {}) as Record<string, unknown>
  assert.ok(Object.keys(itemProperties).includes('writeScopes'), 'plan 的任务项必须暴露 writeScopes')

  const addTasks = tools.get('auto_team_add_tasks')
  assert.ok(addTasks)
  assert.deepEqual(addTasks.parameters.required, ['runId', 'tasks'])
  const addItems = ((addTasks.parameters.properties ?? {}) as Record<string, Record<string, unknown>>).tasks
    ?.items as Record<string, unknown> | undefined
  assert.ok(
    Object.keys((addItems?.properties ?? {}) as Record<string, unknown>).includes('writeScopes'),
    'add_tasks 的任务项必须暴露 writeScopes',
  )
  assert.match(addTasks.description, /runId/, 'add_tasks description 必须点明 runId 不变')

  // AC-8：会话读取口仍只有 sessionOf，且必须认 exec.agent.id。
  assert.equal(sessionOf(META), SESSION)
  assert.equal(sessionOf({ sessionId: 'legacy' }), 'legacy')
  assert.equal(sessionOf(undefined), 'current')
})

test('AC-6：plan 空验收整批拒绝，且 store 一处未写', async () => {
  const h = setup()
  const before = dirSnapshot(h.dir)

  const result = await call(h, 'auto_team_plan', {
    goal: '两个任务，第二个漏了验收',
    tasks: [
      { title: '写好验收', roleId: 'dev', acceptance: 'pnpm typecheck' },
      { title: '漏了验收', roleId: 'dev', acceptance: '   ' },
    ],
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'BAD_REQUEST')
  const error = String(result.error)
  assert.match(error, /t2/, '必须点名违规任务 id（t2），否则模型不知道该改哪条')
  assert.ok(error.includes(ACCEPTANCE_TEMPLATE_BLOCK), '错误文本必须逐字带三条模板')
  for (const template of ACCEPTANCE_TEMPLATES) {
    assert.ok(error.includes(template), `错误文本必须含模板原文：${template}`)
  }
  assert.deepEqual(dirSnapshot(h.dir), before, '整批拒绝时 store 必须一个字节都没变（一条都不落盘）')
  assert.equal(h.store.list().length, 0)
})

test('AC-6：plan 非法写域整批拒绝（判定只调 plan/scope.ts）', async () => {
  const h = setup()
  const before = dirSnapshot(h.dir)

  const notArray = await call(h, 'auto_team_plan', {
    goal: '写域写成字符串',
    tasks: [{ title: '任务', roleId: 'dev', acceptance: 'exit 0', writeScopes: 'src/host/tools.ts' }],
  })
  assert.equal(notArray.ok, false)
  assert.equal(notArray.code, 'BAD_REQUEST')
  assert.match(String(notArray.error), /写域不合法/)
  assert.match(String(notArray.error), /t1/)

  const blankSegment = await call(h, 'auto_team_plan', {
    goal: '写域里有空段',
    tasks: [{ title: '任务', roleId: 'dev', acceptance: 'exit 0', writeScopes: ['src/a.ts', '  '] }],
  })
  assert.equal(blankSegment.ok, false)
  assert.match(String(blankSegment.error), /写域不合法/)

  assert.deepEqual(dirSnapshot(h.dir), before, '非法写域同样一条都不落盘')
})

test('plan 正常路径：写域归一后落盘、run 可读', async () => {
  const h = setup()

  const result = await call(h, 'auto_team_plan', {
    goal: '单任务',
    tasks: [
      {
        title: '只改一个文件',
        roleId: 'dev',
        acceptance: 'pnpm typecheck',
        writeScopes: [' src/host/tools.ts ', 'src/host/tools.ts'],
      },
    ],
  })

  assert.equal(result.ok, true)
  const runId = String(result.runId)
  const state = h.store.load(runId)
  assert.ok(state)
  assert.equal(state.plan.tasks.length, 1)
  assert.deepEqual(state.plan.tasks[0]?.writeScopes, ['src/host/tools.ts'], '写域去重、去空白、字典序')
  assert.equal(state.plan.sessionId, SESSION, '会话只能来自 sessionOf（exec.agent.id）')
  assert.equal(h.store.list().length, 1)
})

test('AC-9/AC-11：add_tasks 幂等 —— 连调两次 added=0、tasks 与 runId 不变', async () => {
  const h = setup()
  const planned = await call(h, 'auto_team_plan', {
    goal: '先一个任务，再补两个',
    tasks: [{ title: '第一件', roleId: 'dev', acceptance: 'pnpm typecheck' }],
  })
  assert.equal(planned.ok, true)
  const runId = String(planned.runId)

  const payload = [
    { title: '依赖既有任务', roleId: 'dev', acceptance: 'pnpm typecheck', dependsOn: ['t1'] },
    { id: 't9', title: '同批依赖新任务', roleId: 'qa', acceptance: 'pnpm test', dependsOn: ['t2'] },
  ]

  const first = await call(h, 'auto_team_add_tasks', { runId, tasks: payload })
  assert.equal(first.ok, true)
  assert.equal(first.runId, runId, '追加不换 runId（AC-11）')
  assert.deepEqual(first.added, ['t2', 't9'], 'id 缺省按 t<next> 递增，显式 id 原样保留')
  assert.deepEqual(first.skipped, [])
  assert.equal(first.tasks, 3)

  const afterFirst = h.store.load(runId)
  assert.ok(afterFirst)
  assert.equal(afterFirst.plan.tasks.length, 3, 'tasks.length = 追加前 1 + added 2')
  assert.equal(h.store.list().length, 1, '追加不新建 run')

  const snapshotAfterFirst = dirSnapshot(h.dir)
  const second = await call(h, 'auto_team_add_tasks', { runId, tasks: payload })
  assert.equal(second.ok, true)
  assert.equal(second.runId, runId)
  assert.deepEqual(second.added, [], '同样内容再来一次必须一条都不加')
  // skipped 回报的是「调用方认得出的标识」：有显式 id 用 id，否则用标题（plan.ts 的既定语义）。
  assert.deepEqual(second.skipped, ['依赖既有任务', 't9'], '被跳过的条目必须逐条回报，模型才知道哪条没进去')
  assert.equal(second.tasks, 3)
  assert.deepEqual(dirSnapshot(h.dir), snapshotAfterFirst, '全被跳过时不落盘（幂等判据是文件字节都不变）')
})

test('AC-8/AC-6：add_tasks 的三种拒绝都不落盘', async () => {
  const h = setup()
  const planned = await call(h, 'auto_team_plan', {
    goal: '基线计划',
    tasks: [{ title: '第一件', roleId: 'dev', acceptance: 'pnpm typecheck' }],
  })
  const runId = String(planned.runId)
  const before = dirSnapshot(h.dir)

  const missingRunId = await call(h, 'auto_team_add_tasks', { tasks: [{ title: 'x', roleId: 'dev', acceptance: 'exit 0' }] })
  assert.equal(missingRunId.ok, false)
  assert.equal(missingRunId.code, 'NO_PLAN')
  assert.match(String(missingRunId.error), /runId/)

  const unknownRunId = await call(h, 'auto_team_add_tasks', {
    runId: 'run-does-not-exist',
    tasks: [{ title: 'x', roleId: 'dev', acceptance: 'exit 0' }],
  })
  assert.equal(unknownRunId.ok, false)
  assert.equal(unknownRunId.code, 'NOT_FOUND')
  assert.match(String(unknownRunId.error), /run-does-not-exist/, '必须把 runId 回显给模型')

  const emptyAcceptance = await call(h, 'auto_team_add_tasks', {
    runId,
    tasks: [
      { title: '合格的', roleId: 'dev', acceptance: 'pnpm typecheck' },
      { title: '空的', roleId: 'dev', acceptance: '' },
    ],
  })
  assert.equal(emptyAcceptance.ok, false)
  assert.equal(emptyAcceptance.code, 'BAD_REQUEST')
  assert.match(String(emptyAcceptance.error), /t2/, '违规任务 id 必须点名')
  assert.ok(String(emptyAcceptance.error).includes(ACCEPTANCE_TEMPLATE_BLOCK))

  const noTasks = await call(h, 'auto_team_add_tasks', { runId, tasks: [] })
  assert.equal(noTasks.ok, false)
  assert.equal(noTasks.code, 'BAD_REQUEST')

  const unknownDep = await call(h, 'auto_team_add_tasks', {
    runId,
    tasks: [{ title: '依赖不存在', roleId: 'dev', acceptance: 'exit 0', dependsOn: ['t404'] }],
  })
  assert.equal(unknownDep.ok, false)
  assert.equal(unknownDep.code, 'BAD_REQUEST')

  assert.deepEqual(dirSnapshot(h.dir), before, '被拒绝的追加一次都没写盘')
  const after = h.store.load(runId)
  assert.equal(after?.plan.tasks.length, 1, '基线计划仍是 1 条')
})

test('AC-10：已取消/已终止的 run 不能追加，文案含 runId 与状态中文', async () => {
  for (const status of ['cancelled', 'terminated'] as const) {
    const h = setup()
    h.store.save(stateOf({ plan: { ...stateOf().plan, status } }))
    const before = dirSnapshot(h.dir)

    const result = await call(h, 'auto_team_add_tasks', {
      runId: 'run-t3',
      tasks: [{ title: '晚了', roleId: 'dev', acceptance: 'exit 0' }],
    })

    assert.equal(result.ok, false, `${status} 的 run 必须拒绝追加`)
    assert.equal(result.code, 'BAD_REQUEST')
    const error = String(result.error)
    assert.match(error, /run-t3/, '必须点名 runId（否则模型不知道该换 run 还是开新计划）')
    assert.match(error, status === 'cancelled' ? /已取消/ : /已终止/, '必须带状态中文（读 shared 标签表）')
    assert.deepEqual(dirSnapshot(h.dir), before, `${status} 拒绝时 store 不变`)
  }
})

test('未启用时 plan / add_tasks 都返回统一文案', async () => {
  const h = setup({ enabled: false })

  for (const name of ['auto_team_plan', 'auto_team_add_tasks']) {
    const result = await call(h, name, { goal: 'g', runId: 'r', tasks: [] })
    assert.equal(result.ok, false)
    assert.match(String(result.error), /自动团队未启用/)
    assert.deepEqual(dirSnapshot(h.dir), {}, '未启用时一条都不能落盘')
  }
})
