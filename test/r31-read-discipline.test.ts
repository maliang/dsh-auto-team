/**
 * r31 回归：成员读取纪律 + 任务卡 `path:line` 行号指针（软提示，不改派发流程）。
 *
 * 覆盖六条 AC 的五条可执行判定（第 ⑤ 条基线报告见 docs/teamflow/2026-11-13-r31-read-discipline/QA-REPORT.md）：
 *  - ① `buildMemberPrompt` 输出含「## 读取纪律」段：正文 ≤400 字符、四条关键短语逐字存在、
 *       位置在「工作纪律」之后、「验收判定」之前；
 *  - ② `hasLinePointer` 五形态：`path.ts:123` 真，裸路径 / 时间 / URL 端口 / 空串都假；
 *  - ③ 派发软提示：无指针任务恰好多一条 captain→user 且带 taskId；有指针任务零新增；
 *       rework 重派不重复（消息账本里 captain→user 恒为 1 条）；
 *  - ④ `TASK_ITEM_SCHEMA.title.description` 含 `path:line`。
 *
 * 断言有效性：每个判据都做过「改回错误实现」的突变反证（见 QA 报告 §3），不是恒真断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Plan, PlanTask, Role } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import type { RoleRepo } from '../src/host/roles/repo.ts'
import type { Bridge } from '../src/host/bridge.ts'
import type { ToolSpec } from '../src/host/adapters.ts'
import { buildMemberPrompt } from '../src/host/team/member-prompt.ts'
import {
  applyReceipt,
  dispatchReady,
  hasLinePointer,
  type DispatchDeps,
  type SpawnInput,
} from '../src/host/team/dispatch.ts'
import { buildToolSpecs } from '../src/host/tools.ts'

const NOW = 1_700_000_000_000

const plan: Plan = {
  runId: 'run-r31',
  sessionId: 'sess-r31',
  createdAt: NOW,
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

function makeRole(id = 'dev'): Role {
  return { id, name: '开发', duty: '负责交付', skillIds: [], builtin: true, updatedAt: NOW }
}

function makeState(tasks: PlanTask[], overrides: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: { ...plan, tasks },
    plannedAt: NOW,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...overrides,
  }
}

function makeRoleRepo(): RoleRepo {
  const roles = new Map([[makeRole().id, makeRole()]])
  return {
    list: () => [...roles.values()],
    get: (id: string) => roles.get(id),
    save: (role: Role) => ({ ok: true as const, role }),
    remove: () => ({ ok: true as const }),
    seed: () => {},
    restoreDefaults: () => ({ restored: [], kept: [] }),
  }
}

function makeDeps(store: RunsStore): { deps: DispatchDeps; spawned: SpawnInput[] } {
  const spawned: SpawnInput[] = []
  const deps: DispatchDeps = {
    store,
    roles: makeRoleRepo(),
    buildPrompt: () => 'PROMPT',
    listMembers: async () => [],
    spawn: async (input) => {
      spawned.push(input)
      return { ok: true, memberId: `m-${input.name}` }
    },
    hostConcurrency: () => ({ limit: 8, source: 'host' }),
    now: () => NOW,
  }
  return { deps, spawned }
}

function withStore(run: (store: RunsStore) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r31-'))
  const store = new RunsStore(dir)
  return run(store).finally(() => rmSync(dir, { recursive: true, force: true }))
}

/** 账本里 captain→user 的软提示（按 taskId 归属；工具消息都带 toMemberId，不属于这一类）。 */
function userHints(state: RunState, taskId: string) {
  return state.messages.filter(
    (message) => message.from === 'captain' && message.to === 'user' && message.taskId === taskId,
  )
}

function captainDispatchMessage(state: RunState) {
  return state.messages.find(
    (message) =>
      message.from === 'captain' && message.toMemberId !== undefined && message.body.includes('已派发给你'),
  )
}

// ---------------------------------------------------------------------------
// ① 成员提示词里的「读取纪律」段
// ---------------------------------------------------------------------------

test('r31① 读取纪律段：≤400 字符、四条短语逐字、位于「工作纪律」之后「验收判定」之前', () => {
  const task = makeTask('t1')
  const prompt = buildMemberPrompt(
    { plan, task, role: makeRole(), name: 'dev-t1' },
    { memoryFor: () => ({ text: '', truncated: false }) },
  )

  const workAt = prompt.indexOf('## 工作纪律')
  const readAt = prompt.indexOf('## 读取纪律')
  const acceptAt = prompt.indexOf('## 验收判定')
  assert.ok(workAt >= 0, '成员提示词必须含「## 工作纪律」段（r28 既有契约）')
  assert.ok(readAt >= 0, '成员提示词必须含「## 读取纪律」段')
  assert.ok(acceptAt >= 0, '成员提示词必须含「## 验收判定」段')
  assert.ok(workAt < readAt, '读取纪律必须排在「工作纪律」之后（两段语义不同，不能倒挂）')
  assert.ok(readAt < acceptAt, '读取纪律必须排在「验收判定」之前（成员先知道边界，再读验收命令）')

  // 段正文 = 标题行之后到下一个 `## ` 标题之前。用 `\n## ` 定位，避免把段内字符算进下一段。
  const bodyStart = prompt.indexOf('\n', readAt) + 1
  const bodyEnd = prompt.indexOf('\n## ', readAt)
  assert.ok(bodyEnd > bodyStart, '读取纪律段必须位于两个 `## ` 标题之间（不能是末尾孤段）')
  const body = prompt.slice(bodyStart, bodyEnd)

  assert.ok(
    [...body].length <= 400,
    `读取纪律段正文必须 ≤400 字符（每次 spawn 都进上下文；实测 ${[...body].length}）`,
  )

  // 四条都是命令级边界，缺一条这个段就只剩口号。
  for (const phrase of ["sed -n '110,230p'", 'head -40', '--include=', 'grep -n']) {
    assert.ok(body.includes(phrase), `读取纪律段正文必须逐字包含「${phrase}」`)
  }
})

// ---------------------------------------------------------------------------
// ② hasLinePointer 五形态
// ---------------------------------------------------------------------------

test('r31② hasLinePointer：带扩展名路径 + 行号才算指针，裸路径/时间/URL 端口/空串都不算', () => {
  assert.equal(hasLinePointer('src/host/tools.ts:123'), true, '路径 + 行号必须命中')
  assert.equal(hasLinePointer('src/host/tools.ts'), false, '只有路径没有行号不算指针')
  assert.equal(hasLinePointer('12:30'), false, '时间不是行号指针')
  assert.equal(hasLinePointer('https://x:443'), false, 'URL 端口不是行号指针（路径段没有扩展名）')
  assert.equal(hasLinePointer(''), false, '空串不算指针')
})

// ---------------------------------------------------------------------------
// ③ 派发软提示：只提示、不拦派发、只提醒一次
// ---------------------------------------------------------------------------

test('r31③ 无指针任务：首次派发恰好多一条 captain→user 软提示，带 taskId 且排在派发消息之后', async () => {
  await withStore(async (store) => {
    const { deps } = makeDeps(store)
    const result = await dispatchReady(makeState([makeTask('t1')]), deps)

    assert.deepEqual(result.started, ['t1'], '软提示不许拦派发：任务仍要真的派出去')
    const hints = userHints(result.state, 't1')
    assert.equal(hints.length, 1, '任务卡没有 path:line 时必须在首次派发提醒恰好一次')
    assert.ok(hints[0]?.body.includes('t1'), '提醒必须点名任务 id（否则用户不知道改哪张卡）')
    assert.ok(hints[0]?.body.includes('path:line'), '提醒必须点名缺的是 path:line 指针')
    assert.equal(hints[0]?.toMemberId, undefined, '这是给用户的提醒，不是给成员的直达消息')

    const dispatchMessage = captainDispatchMessage(result.state)
    assert.ok(dispatchMessage, '首次派发必须先落一条派发消息')
    assert.ok(
      result.state.messages.indexOf(hints[0]!) > result.state.messages.indexOf(dispatchMessage),
      '提示必须排在派发消息之后（先派发、后提示）',
    )
  })
})

test('r31③ 复用成员路径同样恰 1 条：首次派发且任务卡无 path:line 时必须提醒（r31 D1）', async () => {
  await withStore(async (store) => {
    const { deps, spawned } = makeDeps(store)
    const sent: string[] = []
    deps.listMembers = async () => [{ id: 'm-old', name: 'dev-t1', status: 'idle' }]
    deps.sendMessage = async (_memberId, text) => {
      sent.push(text)
      return { ok: true }
    }

    const result = await dispatchReady(
      makeState([makeTask('t1', { status: 'done' }), makeTask('t2', { dependsOn: ['t1'] })], {
        bindings: [{ taskId: 't1', roleId: 'dev', memberId: 'm-old', name: 'dev-t1', spawnedAt: NOW }],
      }),
      deps,
    )

    assert.deepEqual(result.started, ['t2'], '软提示不许拦派发：复用任务仍要真的派出去')
    assert.equal(spawned.length, 0, '前置条件：t1 的 idle 成员可复用，不应 spawn 新成员')
    assert.equal(sent.length, 1, '前置条件：任务卡必须真的发给复用成员')

    const hints = userHints(result.state, 't2')
    assert.equal(hints.length, 1, '复用成员时首次派发也必须恰好提醒一次')
    assert.ok(hints[0]?.body.includes('path:line'), '提醒必须点名缺的是 path:line 指针')
    assert.equal(hints[0]?.toMemberId, undefined, '这是给用户的提醒，不是给成员的直达消息')

    const dispatchMessage = result.state.messages.find(
      (message) => message.from === 'captain' && message.to === 'dev-t1' && message.body === sent[0],
    )
    assert.ok(dispatchMessage, '复用路径必须先落一条发任务卡的派发消息')
    assert.ok(
      result.state.messages.indexOf(hints[0]!) > result.state.messages.indexOf(dispatchMessage),
      '提示必须排在派发消息之后（先派发、后提示）',
    )
  })
})

test('r31③ 有指针任务：标题或写域带 path:line 时零新增 captain→user 消息', async () => {
  await withStore(async (store) => {
    const { deps } = makeDeps(store)
    const titled = await dispatchReady(
      makeState([makeTask('t1', { title: '修 src/host/tools.ts:123 的派发提示' })]),
      deps,
    )
    assert.deepEqual(titled.started, ['t1'])
    assert.equal(userHints(titled.state, 't1').length, 0, '标题已给 path:line 时不许再提醒')

    const scoped = await dispatchReady(
      makeState([makeTask('t2', { title: '改派发提示', writeScopes: ['src/host/team/dispatch.ts:912'] })]),
      deps,
    )
    assert.deepEqual(scoped.started, ['t2'])
    assert.equal(userHints(scoped.state, 't2').length, 0, '写域已给 path:line 时不许再提醒')
  })
})

test('r31③ rework 后重派不重复提醒：captain→user 软提示恒为 1 条（消息数不增）', async () => {
  await withStore(async (store) => {
    const { deps } = makeDeps(store)
    const first = await dispatchReady(makeState([makeTask('t1')]), deps)
    assert.equal(userHints(first.state, 't1').length, 1, '前置条件：首次派发已提醒一次')

    const reworked = applyReceipt(first.state, 't1', { verdict: 'rework' }, NOW + 1)
    assert.equal(reworked.plan.tasks[0]?.status, 'rework')
    assert.equal(reworked.plan.tasks[0]?.attempts, 1, '前置条件：attempts 已 +1')

    const again = await dispatchReady(reworked, deps)
    assert.deepEqual(again.started, ['t1'], '返工任务必须能重新派发')
    assert.equal(
      userHints(again.state, 't1').length,
      1,
      'rework 重派不得重复提醒（同一张卡只提醒一次，否则每轮返工都刷一条）',
    )
  })
})

test('r31③ attempts>0 的重派即使没有历史 binding 也不再提醒（返工判据独立成立）', async () => {
  await withStore(async (store) => {
    const { deps } = makeDeps(store)
    // 宿主重启/账本清理后 bindings 可能不在；此时只剩 attempts 能判「这张卡派过」。
    const reworkOnly = makeTask('t1', { status: 'rework', attempts: 1 })
    const result = await dispatchReady(makeState([reworkOnly]), deps)

    assert.deepEqual(result.started, ['t1'])
    assert.equal(userHints(result.state, 't1').length, 0, 'attempts>0 属于返工重派，不得再提醒')
  })
})

// ---------------------------------------------------------------------------
// ④ 计划/追加任务的 schema 文案带 `path:line`
// ---------------------------------------------------------------------------

test('r31④ TASK_ITEM_SCHEMA.title.description 要求 path:line（plan 与 add_tasks 同源）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r31-schema-'))
  try {
    const specs: ToolSpec[] = buildToolSpecs({
      store: new RunsStore(dir),
      roles: makeRoleRepo(),
      bridge: { enabled: () => true } as unknown as Bridge,
      now: () => NOW,
    })
    for (const toolName of ['auto_team_plan', 'auto_team_add_tasks']) {
      const spec = specs.find((item) => item.name === toolName)
      assert.ok(spec, `工具 ${toolName} 必须存在`)
      const properties = (spec.parameters.properties ?? {}) as Record<string, Record<string, unknown>>
      const items = (properties.tasks?.items ?? {}) as Record<string, unknown>
      const title = ((items.properties ?? {}) as Record<string, Record<string, unknown>>).title
      const description = String(title?.description ?? '')
      assert.ok(
        description.includes('path:line'),
        `${toolName} 的任务项 title.description 必须要求 path:line（模型看不见的字段等于不存在）`,
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
