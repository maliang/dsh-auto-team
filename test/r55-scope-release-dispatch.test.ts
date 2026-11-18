/**
 * r55 回归：写域释放后自动接上（真实 `RunsStore` + 真实 `createBridge` + 真实 auto-dispatch）。
 *
 * 现场：写域闸挡下的 `waiting` 不在 `readyTasks` 口径里（graph.ts 只认 pending/ready/rework）。
 * `shouldAutoDispatch` 若只看原始 plan，就只会在「最后一个持锁者已释放、盘面上只剩 waiting」时
 * 判成「没有就绪任务」直接早退 —— 而重算等待关系的 `applyScopeWaits` 只在 `dispatchReady` 里跑，
 * 于是那条复活逻辑永远等不到调用（死路）。r55 在 `shouldAutoDispatch` 里加了同一判定的纯投影。
 *
 * 本文件刻意全部走**真实装配**：真 store、真 bridge（与 src/host/index.ts:568/612 同一接线：
 * 面板派发与 tick 派发共用同一个 `dispatch` 闭包）、真 `dispatchReady` / `applyReceipt`。
 * 覆盖：
 *  ① `applyReceipt(done)` 释放写域后，下一轮 tick 必须真的把 t2 派起来（spawn 0→1、不再是 waiting）；
 *     以及「释放已落盘、等待关系还没重算」的存量盘面（旧版本/崩溃窗口）同样要能接上；
 *  ② 反向：持有人还 running 时 tick 不得提前派 t2；
 *  ③ 释放后并发已满：t2 保持 pending，而不是回到 waiting（回 waiting 就要等下一轮 release 才动）；
 *  ④ 惰命 `waitingOn`（指向已不在计划里的任务）：没有 holder 时必须被释放；
 *  ⑤ 变异（QA 手工验，见回执）：拆掉 `shouldAutoDispatch` 的纯投影后 ①③ 必须变红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Plan, PlanTask, Role } from '../src/shared/types.ts'
import { createBridge, type Bridge } from '../src/host/bridge.ts'
import { createRoleRepo, type RoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { createAutoDispatcher } from '../src/host/team/auto-dispatch.ts'
import { applyReceipt, dispatchReady, type DispatchDeps, type SpawnInput } from '../src/host/team/dispatch.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r55'
const RUN = 'run-r55'
const PATH_A = 'src/host/team/auto-dispatch.ts'
const PATH_B = 'src/host/team/scope-locks.ts'

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return { id, title: `任务${id}`, roleId: 'dev', dependsOn: [], acceptance: 'pnpm typecheck', status: 'pending', ...over }
}

function planOf(tasks: PlanTask[], over: Partial<Plan> = {}): Plan {
  return { runId: RUN, sessionId: SESSION, createdAt: NOW, status: 'dispatching', tasks, maxConcurrent: 3, ...over }
}

function stateOf(tasks: PlanTask[], over: Partial<Plan> = {}): RunState {
  return { version: RUN_STATE_VERSION, plan: planOf(tasks, over), plannedAt: NOW, messages: [], bindings: [], routeAudits: [] }
}

function roleOf(id: string, name: string): Role {
  return { id, name, duty: '负责交付', skillIds: [], builtin: false, updatedAt: NOW }
}

function evidenceOf(taskId: string) {
  return { taskId, command: 'pnpm typecheck', exitCode: 0, tail: 'typecheck 通过', artifacts: [], at: NOW }
}

interface Harness {
  dir: string
  store: RunsStore
  roles: RoleRepo
  bridge: Bridge
  spawned: SpawnInput[]
  dispatcher: ReturnType<typeof createAutoDispatcher>
  /** 把一条计划写进盘（tick 读的就是它）。 */
  save(tasks: PlanTask[], over?: Partial<Plan>): void
  load(): RunState
  statusOf(taskId: string): string | undefined
  cleanup(): void
}

/**
 * 真装配：`createBridge` 与 auto-dispatcher 共用同一个 `dispatch` 闭包。
 *
 * 这不是为了「多包一层」：面板 `act('dispatch')` 与 tick 必须走同一条实现，
 * 否则本文件证明不了「tick 真的接上了生产派发路径」。
 */
function setup(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r55-'))
  const store = new RunsStore(join(dir, 'runs'))
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir: join(dir, 'skills'), now: () => NOW })
  roles.seed()
  if (roles.get('dev') === undefined) roles.save(roleOf('dev', '开发'))

  const spawned: SpawnInput[] = []
  const dispatchDeps: DispatchDeps = {
    store,
    roles,
    buildPrompt: (input) => `你是 ${input.role?.name ?? '成员'}；任务：${input.task.title}（${input.name}）`,
    listMembers: async () => [],
    spawn: async (input) => {
      spawned.push(input)
      return { ok: true, memberId: `m-${input.name}` }
    },
    hostConcurrency: () => ({ limit: 8, source: 'host' }),
    now: () => NOW,
  }
  const dispatch = (state: RunState) => dispatchReady(state, dispatchDeps)

  const bridge = createBridge({
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch,
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    applyReceipt,
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
    now: () => NOW,
  })
  bridge.setEnabled(SESSION, true)

  const dispatcher = createAutoDispatcher({ store, dispatch, now: () => NOW })
  const load = (): RunState => {
    const state = store.load(RUN)
    assert.ok(state, 'run 必须在盘上')
    return state
  }
  return {
    dir,
    store,
    roles,
    bridge,
    spawned,
    dispatcher,
    save: (tasks, over) => store.save(stateOf(tasks, over)),
    load,
    statusOf: (taskId) => load().plan.tasks.find((task) => task.id === taskId)?.status,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/** ①-a：正常释放路径（`applyReceipt` 的唯一写点）。 */
test('① applyReceipt(done) 释放写域后，下一轮 tick 必须真的把 waiting 的 t2 派起来', async () => {
  const h = setup()
  try {
    h.save([
      taskOf('t1', { status: 'running', writeScopes: [PATH_A] }),
      taskOf('t2', { status: 'waiting', waitingOn: ['t1'], writeScopes: [PATH_A] }),
    ])

    const released = applyReceipt(h.load(), 't1', { verdict: 'done', evidence: evidenceOf('t1') }, NOW)
    h.store.save(released)
    assert.equal(h.statusOf('t1'), 'done', '回执后 t1 必须落成 done')

    const reports = await h.dispatcher.tick()
    assert.equal(reports.length, 1, 'tick 必须扫到这条 run')
    assert.equal(reports[0].attempted, true, '释放后必须真的调一次派发端口')
    assert.equal(h.spawned.length, 1, 't2 必须被派起来（spawn 0→1）')
    assert.equal(h.spawned[0].task.id, 't2')
    assert.notEqual(h.statusOf('t2'), 'waiting', 't2 不许还停在 waiting')
    assert.equal(h.statusOf('t2'), 'running')
    // 面板（真 bridge）必须看到同一结果，而不是只改了盘。
    const view = h.bridge.snapshot(SESSION, RUN).tasks.find((task) => task.id === 't2')
    assert.equal(view?.status, 'running')
  } finally {
    h.cleanup()
  }
})

/**
 * ①-b：存量盘面 —— 释放已经写进账本（t1 done），但等待关系还没被重算（t2 仍是 waiting）。
 *
 * 旧版本/崩溃窗口留下的就是这种盘：`shouldAutoDispatch` 少了纯投影时会判「没有就绪任务」，
 * 复活逻辑永远等不到 `dispatchReady` 里的重算。这条用例是 ⑤ 变异的主要红灯。
 */
test('① 释放已落盘但等待关系未重算（存量盘）→ tick 必须复活 t2', async () => {
  const h = setup()
  try {
    h.save([
      taskOf('t1', { status: 'done', writeScopes: [PATH_A] }),
      taskOf('t2', { status: 'waiting', waitingOn: ['t1'], writeScopes: [PATH_A] }),
    ])

    const reports = await h.dispatcher.tick()
    assert.equal(reports[0].attempted, true, '无人持锁的 waiting 必须被判成可派发')
    assert.equal(h.spawned.length, 1)
    assert.equal(h.spawned[0].task.id, 't2')
    assert.equal(h.statusOf('t2'), 'running')
    assert.equal(h.load().plan.tasks.find((task) => task.id === 't2')?.waitingOn, undefined, '复活后必须清掉 waitingOn')
  } finally {
    h.cleanup()
  }
})

/** ② 反向：写域还没放行时，tick 不许抢跑。 */
test('② 持有人还在 running 时，tick 不得提前派 waiting 的 t2', async () => {
  const h = setup()
  try {
    h.save([
      taskOf('t1', { status: 'running', writeScopes: [PATH_A] }),
      taskOf('t2', { status: 'waiting', waitingOn: ['t1'], writeScopes: [PATH_A] }),
    ])

    const reports = await h.dispatcher.tick()
    assert.equal(reports[0].attempted, false, '写域被占时不该调派发端口')
    assert.match(reports[0].reason ?? '', /没有就绪任务/)
    assert.equal(h.spawned.length, 0, 't2 必须一个成员都不起')
    assert.equal(h.statusOf('t2'), 'waiting', 't2 必须保持 waiting')
  } finally {
    h.cleanup()
  }
})

/** ③ 释放后并发已满：任务要停在 pending（等下一拍），不能被打回 waiting。 */
test('③ 释放后并发已满：t2 保持 pending 而非回 waiting', async () => {
  const h = setup()
  try {
    h.save(
      [
        taskOf('t1', { status: 'done', writeScopes: [PATH_A] }),
        taskOf('t3', { status: 'running' }),
        taskOf('t2', { status: 'waiting', waitingOn: ['t1'], writeScopes: [PATH_A] }),
      ],
      { maxConcurrent: 1 },
    )

    const reports = await h.dispatcher.tick()
    assert.equal(h.spawned.length, 0, '并发位已满，不许起人')
    assert.equal(h.statusOf('t2'), 'pending', '复活后没有并发位 → 保持 pending，回 waiting 会再错过一轮')
    assert.equal(h.statusOf('t3'), 'running', '已占位的任务不许被挤掉')
    assert.ok((reports[0].skipped ?? 0) >= 1, '被跳过的原因是并发满，必须计数')
    const view = h.bridge.snapshot(SESSION, RUN).tasks.find((task) => task.id === 't2')
    assert.equal(view?.status, 'pending', '面板口径必须与盘面一致')
  } finally {
    h.cleanup()
  }
})

/** ④ 惰命 waitingOn：指向已不在计划里的任务 = 没有 holder，必须释放。 */
test('④ 无 holder 的惰命 waitingOn（指向不存在的任务）必须被释放', async () => {
  const h = setup()
  try {
    h.save([taskOf('t2', { status: 'waiting', waitingOn: ['ghost'], writeScopes: [PATH_B] })])
    assert.equal(h.load().plan.tasks.some((task) => task.id === 'ghost'), false, '夹具前提：ghost 不在计划里')

    const reports = await h.dispatcher.tick()
    assert.equal(reports[0].attempted, true)
    assert.equal(h.spawned.length, 1, '没有 holder 的 waiting 必须被派起来')
    assert.equal(h.spawned[0].task.id, 't2')
    assert.equal(h.statusOf('t2'), 'running')
  } finally {
    h.cleanup()
  }
})
