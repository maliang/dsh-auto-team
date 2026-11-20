/**
 * r57 QA 回归：同一会话的多个非终态 run 必须**并行**继续推进（tick 不能只派最新那个）。
 *
 * 用户裁决（2026-11-20）：新建计划不再收口旧 run，任务没完成就都继续跑。
 * 自动派发 `tick()` 是唯一按 run 逐个兜底的推进点：它读 `store.list()` 后必须对
 * **每一条** active 且 draft/dispatching 的 run 各派一次，而不是挑最新一条。
 *
 * 判据为什么这样写：
 *  - 真跑 `RunsStore`（两个 run 文件）＋ 真 `dispatchReady`（只桩 spawn/roles/listMembers），
 *    没有假 dispatcher —— 于是「两条 run 都真的起了人」与「A 没被收口」都是可观测事实；
 *  - 变异：把 `tick()` 的 `summaries` 截成最新一条，`run-a` 必然缺席报告且 `spawned`
 *    缺 `t-a`，本文件第一条用例立即红（不靠断言 message 文本）。
 *
 * 已知缺口的修复（t4）：旧实现在 `src/host/team/watcher.ts` 的 tick 里对「只剩 pending、没有
 * running/gate/interrupted/paused 任务」的 run 直接 `continue`，而 `autoDispatcher.tick()` 只在
 * `onPoll`（仅对 active run 调）里被驱动 ⇒ 只剩 pending 的旧 run 永远拿不到下一次派发。
 * 现在派发挂在 tick **开头、无条件**执行；文件末尾的 watcher 用例专门锁这条（变异：把
 * `onDispatchTick` 挪回 `onPoll`，该用例立即红）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plan, PlanTask, Role } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import type { RoleRepo } from '../src/host/roles/repo.ts'
import { createAutoDispatcher } from '../src/host/team/auto-dispatch.ts'
import { createMemberWatcher } from '../src/host/team/watcher.ts'
import {
  dispatchReady,
  type DispatchDeps,
  type SpawnInput,
} from '../src/host/team/dispatch.ts'

const now = 1_700_000_000_000

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

function makeRole(id: string): Role {
  return { id, name: id, duty: '负责交付', skillIds: [], builtin: true, updatedAt: now }
}

function makeRoleRepo(roles: Role[]): RoleRepo {
  const map = new Map(roles.map((role) => [role.id, role]))
  return {
    list: () => [...map.values()],
    get: (id: string) => map.get(id),
    save: (role: Role) => ({ ok: true as const, role }),
    remove: () => ({ ok: true as const }),
    seed: () => {},
    restoreDefaults: () => ({ restored: [], kept: [] }),
  }
}

/** 一个 run 的计划：runId/sessionId 同会话、任务是待派发的 pending。 */
function stateOf(runId: string, taskId: string, createdAt: number): RunState {
  const task = makeTask(taskId)
  const plan: Plan = {
    runId,
    sessionId: 'sess-parallel',
    createdAt,
    status: 'dispatching',
    tasks: [task],
    maxConcurrent: 3,
  }
  return {
    version: RUN_STATE_VERSION,
    plan,
    plannedAt: createdAt,
    messages: [],
    bindings: [],
    routeAudits: [],
  }
}

function makeDeps(store: RunsStore): { deps: DispatchDeps; spawned: SpawnInput[] } {
  const spawned: SpawnInput[] = []
  const deps: DispatchDeps = {
    store,
    roles: makeRoleRepo([makeRole('dev')]),
    buildPrompt: (input) => `任务：${input.task.title}（${input.name}）`,
    listMembers: async () => [],
    spawn: async (input) => {
      spawned.push(input)
      return { ok: true, memberId: `m-${input.name}` }
    },
    hostConcurrency: () => ({ limit: 8, source: 'host' }),
    now: () => now,
  }
  return { deps, spawned }
}

test('同会话两个非终态 run：tick 对两个 run 都尝试派发，且都没被收口', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r57-parallel-'))
  const cleanup = (): void => rmSync(dir, { recursive: true, force: true })
  try {
    const store = new RunsStore(dir)
    // A 比 B 旧；tick 内部按 store.list()（createdAt 倒序）遍历 —— 只处理第一条的实现会漏掉 A。
    store.save(stateOf('run-a', 't-a', now - 60_000))
    store.save(stateOf('run-b', 't-b', now))

    const { deps, spawned } = makeDeps(store)
    const dispatcher = createAutoDispatcher({
      store,
      dispatch: (state) => dispatchReady(state, deps),
    })

    const reports = await dispatcher.tick()
    const byRun = new Map(reports.map((report) => [report.runId, report]))

    // ① 两个 run 都进了报告，且都真的调过派发端口。
    assert.equal(reports.length, 2, '两个非终态 run 都必须被 tick 到')
    for (const runId of ['run-a', 'run-b']) {
      const report = byRun.get(runId)
      assert.ok(report !== undefined, `${runId} 必须出现在 tick 报告里（只派最新 = 漏旧的）`)
      assert.equal(report.attempted, true, `${runId} 必须真的尝试过派发`)
    }

    // ② 两个 run 的 pending 任务都被起了人（不是「报了但没派」）。
    assert.deepEqual(byRun.get('run-a')?.started, ['t-a'], 'run-a 的 pending 任务必须被派发')
    assert.deepEqual(byRun.get('run-b')?.started, ['t-b'], 'run-b 的 pending 任务必须被派发')
    assert.deepEqual(
      spawned.map((input) => input.task.id).sort(),
      ['t-a', 't-b'],
      '两个 run 的任务都必须真的 spawn 出成员',
    )

    // ③ 旧 run A 不被收口：计划仍是 dispatching、无终止原因，任务已起而不是被 cancelled。
    const afterA = store.load('run-a')
    assert.ok(afterA !== null, 'run-a 仍在盘上')
    assert.equal(afterA?.plan.status, 'dispatching', 'run-a 不得被改成 terminated')
    assert.equal(afterA?.termination, undefined, 'run-a 不得写终止原因')
    assert.equal(afterA?.finishedAt, undefined, 'run-a 不得写结束时间')
    const taskA = afterA?.plan.tasks.find((task) => task.id === 't-a')
    assert.equal(taskA?.status, 'running', 'run-a 的 pending 任务应已派发（running）')
    assert.equal(
      (taskA as { cancelledBy?: string } | undefined)?.cancelledBy,
      undefined,
      'run-a 的任务不得被标记为 stale 取消',
    )

    // ④ 本会话的派发报告账本里两条都在（auto_team_status 的 dispatch 段依据）。
    assert.equal(dispatcher.reportsOf('sess-parallel').length, 2)
  } finally {
    cleanup()
  }
})

test('tick 幂等：已派发过的 run 再 tick 不会重复起人', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r57-parallel-idem-'))
  const cleanup = (): void => rmSync(dir, { recursive: true, force: true })
  try {
    const store = new RunsStore(dir)
    store.save(stateOf('run-a', 't-a', now - 60_000))
    store.save(stateOf('run-b', 't-b', now))
    const { deps, spawned } = makeDeps(store)
    const dispatcher = createAutoDispatcher({
      store,
      dispatch: (state) => dispatchReady(state, deps),
    })

    await dispatcher.tick()
    assert.equal(spawned.length, 2, '第一拍：两个 run 各起一个')
    const second = await dispatcher.tick()
    assert.deepEqual(
      second.map((report) => report.started),
      [[], []],
      '第二拍：均已派出，不得重复起人',
    )
    assert.equal(spawned.length, 2, '第二拍不得新增 spawn')
  } finally {
    cleanup()
  }
})

/**
 * t4 病因回归：**只剩 pending 的 run** 也必须每轮被自动派发一次。
 *
 * 场景就是实盘的僵尸卡：同一会话两条 dispatching run，任务全是 pending（没有 running/gate/
 * interrupted/paused）⇒ 旧实现里 watcher 的 active 判定为 false、`continue`，`onPoll` 从不被调，
 * 于是没有任何一拍会再去派发它们（新建计划又不再收口旧 run）。
 *
 * 判据：`onDispatchTick` 恰好 1 次、两条 run 的任务都真的 spawn；且本 tick 不应因「没有 active run」
 * 去取成员名单（取名单会抛 —— 抛了就证明它被错误地调用了）。
 */
test('watcher tick：只剩 pending 的 run 也每轮驱动一次自动派发（派发不受 active 过滤）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r57-watcher-'))
  const cleanup = (): void => rmSync(dir, { recursive: true, force: true })
  try {
    const store = new RunsStore(join(dir, 'runs'))
    store.save(stateOf('run-a', 't-a', now - 60_000))
    store.save(stateOf('run-b', 't-b', now))
    const { deps, spawned } = makeDeps(store)
    const dispatcher = createAutoDispatcher({
      store,
      dispatch: (state) => dispatchReady(state, deps),
    })

    let dispatchTicks = 0
    let listCalls = 0
    const watcher = createMemberWatcher({
      store,
      listMembers: async () => {
        listCalls += 1
        throw new Error('本 tick 没有任何 active run，不该取成员名单')
      },
      now: () => now,
      onDispatchTick: async () => {
        dispatchTicks += 1
        await dispatcher.tick()
      },
    })

    // 抛错的名单被 watcher 吞掉：tick 必须正常 resolve（否则盯着名单的停顿逻辑在生产里会静默停摆）。
    const changed = await watcher.tick()
    assert.equal(typeof changed, 'number')
    assert.equal(dispatchTicks, 1, '每轮 tick 必须无条件驱动一次自动派发（哪怕一条 active run 都没有）')
    assert.deepEqual(
      spawned.map((input) => input.task.id).sort(),
      ['t-a', 't-b'],
      '两条只剩 pending 的 run 都必须被尝试派发',
    )
    // 派发发生在 store.list() 之前，所以随后的对账看得见「任务已 running」——它确实进了失活分支。
    assert.equal(listCalls, 2, '派发后两条 run 都变成 active，对账各取一次名单（取不到就降级，不误杀）')
  } finally {
    cleanup()
  }
})
