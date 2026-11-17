/**
 * r41 QA（t3）：`agent/status: idle` 作为「本轮结束」权威信号的回归门禁。
 *
 * 为什么必须走真实 `apply()` + 假宿主、而不是只测判定函数：
 * r40 的事故形态是「判定/事件都在，但没接到正确的信号上」——只测
 * `isSilentFinish` / `recordSilentFinish` 时，把 `src/host/index.ts` 里
 * `recordMemberIdle` 整段删掉、或把 `agent/status` 订阅删掉，单测依然全绿。
 * 本文件把 idle 事件真的投进成员 `agent.ctx` 的订阅器，再读**落盘**的 run 文件。
 *
 * 覆盖（对齐任务卡 6 条）：
 *  1) 先 running/tools 后 idle → 落 silentFinish + 恰一条 captain→user(taskId)；重复 idle 幂等；
 *  2) 刚 spawn 就 idle（护栏未满足）→ 不落、任务仍 running（M1 变异必须让本条变红）；
 *  3) task 已有 evidence / 已 done / binding retired → 不落；
 *  4) 跨 root：两个 run 各取自己的名单，第二个 run 的成员不被误判 interrupted（M2 变异必须让本条变红）；
 *  5) 名单抛错 → 内存健康态 ok:false+error，并被 bridge 快照投影为 membersSource；恢复后 ok:true；
 *  6) 客户端零改动的口径：快照 `awaitingReceipt` 仍由宿主机现算（silentFinish 在 → true）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../src/host/index.ts'
import { createBridge, type BridgeDeps } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { createMemberWatcher, type HostMember } from '../src/host/team/watcher.ts'
import type { MemberBinding, Plan, PlanTask } from '../src/shared/types.ts'

const SESSION = 'sess-r41-idle'
const RUN = 'run-r41-idle'
const MEMBER_ID = 'm-idle-1'
const MEMBER_NAME = 'dev-t1-idle'
const NOW = 1_760_000_000_000

/* ───────────────────────────── 假宿主（apply 真正读取的服务） ───────────────────────────── */

interface FakeAgent {
  id: string
  name: string
  ctx: { on: (event: string, listener: (...args: unknown[]) => void) => void }
}

interface FakeRes {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (text: string) => void
}

type RouteDef = { kind: string; path: string; handler: (req: EventEmitter, res: FakeRes) => Promise<void> }

interface Harness {
  ctx: Record<string, unknown>
  events: Map<string, Array<(...args: unknown[]) => void>>
  memberEvents: Map<string, Map<string, Array<(...args: unknown[]) => void>>>
  routes: RouteDef[]
  disposers: Array<() => void | Promise<void>>
  warnings: string[]
  emit(event: string, payload: unknown): void
  emitMember(memberId: string, event: string, payload: unknown): void
  act(sessionId: string, action: unknown): Promise<{ data?: unknown; error?: string; status?: number }>
  close(): Promise<void>
}

function makeHarness(options: { members?: HostMember[] } = {}): Harness {
  const members = (options.members ?? [{ id: MEMBER_ID, name: MEMBER_NAME, status: 'running' }]).map((m) => ({ ...m }))
  const events = new Map<string, Array<(...args: unknown[]) => void>>()
  const memberEvents = new Map<string, Map<string, Array<(...args: unknown[]) => void>>>()
  const routes: RouteDef[] = []
  const disposers: Array<() => void | Promise<void>> = []
  const warnings: string[] = []
  const agents = new Map<string, FakeAgent>()

  function memberAgent(id: string): FakeAgent | undefined {
    const row = members.find((member) => member.id === id)
    if (!row) return undefined
    const existing = agents.get(id)
    if (existing) return existing
    const per = new Map<string, Array<(...args: unknown[]) => void>>()
    memberEvents.set(id, per)
    const agent: FakeAgent = {
      id,
      name: row.name,
      ctx: {
        on(event, listener) {
          const list = per.get(event) ?? []
          list.push(listener)
          per.set(event, list)
        },
      },
    }
    agents.set(id, agent)
    return agent
  }

  const ctx: Record<string, unknown> = {
    tools: { register: () => {} },
    systemPrompt: { section: () => {} },
    webServer: { register: (spec: RouteDef) => void routes.push(spec) },
    agents: {
      currentInitiator: () => ({ id: 'captain', name: 'captain' }),
      get: (id: string) => memberAgent(id),
    },
    get(name: string): unknown {
      return ctx[name]
    },
    agentTeams: {
      listMembers: async () => members.map((member) => ({ ...member })),
      spawnTeammate: async () => {
        throw new Error('本用例不派发成员')
      },
      sendMessage: async () => {},
    },
    llm: { resolveCallConfig: (config: unknown) => config },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
    effect: (dispose: () => void | Promise<void>) => void disposers.push(dispose),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const list = events.get(event) ?? []
      list.push(listener)
      events.set(event, list)
    },
    logger: { warn: (text: string) => void warnings.push(text), info: () => {} },
  }

  return {
    ctx,
    events,
    memberEvents,
    routes,
    disposers,
    warnings,
    emit(event, payload) {
      for (const listener of events.get(event) ?? []) listener(payload)
    },
    emitMember(memberId, event, payload) {
      for (const listener of memberEvents.get(memberId)?.get(event) ?? []) listener(payload)
    },
    async act(sessionId, action) {
      const route = routes.find((candidate) => candidate.path === '/api/auto-team' && candidate.kind === 'prefix')
      assert.ok(route, 'apply() 必须注册 /api/auto-team 路由（拿不到 webServer 时走注入）')
      const request = new EventEmitter() as EventEmitter & { url: string; method: string }
      request.url = '/api/auto-team/act'
      request.method = 'POST'
      const pending = new Promise<{ data?: unknown; error?: string; status?: number }>((resolve) => {
        const response: FakeRes = {
          statusCode: 0,
          setHeader: () => {},
          end: (text: string) => resolve(JSON.parse(text) as { data?: unknown; error?: string; status?: number }),
        }
        void route.handler(request, response)
      })
      request.emit('data', Buffer.from(JSON.stringify({ sessionId, action })))
      request.emit('end')
      return pending
    },
    async close() {
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          await dispose()
        } catch {
          /* 单个 disposer 失败不影响断言 */
        }
      }
    },
  }
}

/** 打开一个真实 `apply()` 的临时 HOME；返回 harness + 同目录 store。 */
function openHarness(options: { members?: HostMember[] } = {}): { h: Harness; home: string; store: RunsStore } {
  const home = mkdtempSync(join(tmpdir(), 'auto-team-r41-idle-'))
  const previousHome = process.env.HOME
  process.env.HOME = home
  const h = makeHarness(options)
  try {
    apply(h.ctx as never, { workspace: home })
  } finally {
    process.env.HOME = previousHome
  }
  return { h, home, store: new RunsStore(join(home, '.dsh/auto-team/runs')) }
}

/* ───────────────────────────── run 状态构造 ───────────────────────────── */

function taskOf(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 't1',
    title: '实现 idle 待回执',
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'exit 0',
    status: 'running',
    memberId: MEMBER_ID,
    ...overrides,
  }
}

function planOf(tasks: PlanTask[], overrides: Partial<Plan> = {}): Plan {
  return {
    runId: RUN,
    sessionId: SESSION,
    createdAt: NOW,
    status: 'dispatching',
    tasks,
    maxConcurrent: 3,
    ...overrides,
  }
}

function bindingOf(overrides: Partial<MemberBinding> = {}): MemberBinding {
  return {
    taskId: 't1',
    roleId: 'dev',
    memberId: MEMBER_ID,
    name: MEMBER_NAME,
    spawnedAt: NOW + 100,
    ...overrides,
  }
}

function stateOf(tasks: PlanTask[], bindings: MemberBinding[], plan: Partial<Plan> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: planOf(tasks, plan),
    plannedAt: NOW,
    messages: [],
    bindings,
    routeAudits: [],
  }
}

const receiptNoticesOf = (state: RunState): RunState['messages'] =>
  state.messages.filter((message) => message.from === 'captain' && message.to === 'user' && message.taskId === 't1')

const interruptedOf = (state: RunState): boolean =>
  state.plan.tasks[0].status === 'interrupted' || /已失联/.test(state.messages.map((m) => m.body).join('\n'))

/* ───────────────────────────── 1) idle → 待回执 + 幂等 ───────────────────────────── */

test('r41 idle→待回执：先 running 再 idle 落 silentFinish，通知恰一条且 taskId 正确；重复 idle 幂等', async () => {
  const { h, home, store } = openHarness()
  try {
    await h.act(SESSION, { type: 'toggle', enabled: true })
    store.save(stateOf([taskOf()], [bindingOf()]))
    const resumed = await h.act(SESSION, { type: 'resume' })
    assert.equal((resumed.data as { rejected?: unknown } | undefined)?.rejected, undefined, 'resume 必须受理')

    // 订阅必须真的装在**成员 agent.ctx** 上（否则事件路径根本不存在，后面全是假绿）。
    const memberBus = h.memberEvents.get(MEMBER_ID)
    assert.ok(memberBus?.has('agent/status'), '成员级 agent/status 订阅未装到 agent.ctx')

    // 工作推进信号：成员自己的 tools/result（宿主按 exec.agent keyed 派发）。
    h.emitMember(MEMBER_ID, 'tools/result', { agent: { id: MEMBER_ID, name: MEMBER_NAME }, name: 'read_file' })

    const idleSentAt = Date.now()
    h.emitMember(MEMBER_ID, 'agent/status', { agent: { id: MEMBER_ID }, status: 'idle' })

    const afterFirst = store.load(RUN)
    assert.ok(afterFirst, 'run 必须仍在盘上')
    const silent = afterFirst.plan.tasks[0].silentFinish
    assert.ok(silent, '先 running/tools 再 idle 必须落 silentFinish（这是本轮结束事实）')
    assert.ok(Math.abs(silent.at - idleSentAt) < 5_000, 'silentFinish.at 必须取 idle 到达时刻')
    assert.equal(silent.memberId, MEMBER_ID)

    const notices = receiptNoticesOf(afterFirst)
    assert.equal(notices.length, 1, '必须恰一条 captain→user 通知')
    assert.match(notices[0].body, /已结束本轮但未提交回执/)
    assert.equal(notices[0].at, silent.at, '消息时间必须与事实同一时刻')
    assert.equal(afterFirst.plan.tasks[0].evidence, undefined, '待回执不允许伪造 evidence')
    assert.equal(afterFirst.plan.tasks[0].status, 'running', 'idle 不得顺手把任务标 done/failed')

    // 幂等：重复投递 idle，at 不变、消息仍 1 条。
    h.emitMember(MEMBER_ID, 'agent/status', { agent: { id: MEMBER_ID }, status: 'idle' })
    const afterSecond = store.load(RUN)
    assert.ok(afterSecond)
    assert.equal(afterSecond.plan.tasks[0].silentFinish?.at, silent.at, '重复 idle 不得刷新 at')
    assert.equal(receiptNoticesOf(afterSecond).length, 1, '重复 idle 不得追加第二条通知')
  } finally {
    await h.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/* ───────────────────────────── 2) 护栏：刚 spawn 就 idle ───────────────────────────── */

test('r41 误报护栏：刚 spawn 就收到 idle（本轮从未 running/推进）→ 不落 silentFinish、任务仍 running', async () => {
  const { h, home, store } = openHarness()
  try {
    await h.act(SESSION, { type: 'toggle', enabled: true })
    store.save(stateOf([taskOf()], [bindingOf()]))
    const resumed = await h.act(SESSION, { type: 'resume' })
    assert.equal((resumed.data as { rejected?: unknown } | undefined)?.rejected, undefined, 'resume 必须受理')
    assert.ok(h.memberEvents.get(MEMBER_ID)?.has('agent/status'), '成员级 agent/status 订阅未装到 agent.ctx')

    // 关键：本轮**没有任何**工作信号（没有 running、没有 tools/result），直接 idle。
    // 宿主在 spawn 瞬间会投递一次 idle（没有驱动被调度），这不是「本轮结束」，是误报。
    h.emitMember(MEMBER_ID, 'agent/status', { agent: { id: MEMBER_ID }, status: 'idle' })

    const after = store.load(RUN)
    assert.ok(after)
    assert.equal(after.plan.tasks[0].silentFinish, undefined, '护栏未满足时的 idle 不得落待回执')
    assert.equal(after.plan.tasks[0].status, 'running', '任务必须仍是 running')
    assert.equal(receiptNoticesOf(after).length, 0, '误报不得写账本')
  } finally {
    await h.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/* ───────────────────────────── 3) 反例：evidence / done / retired ───────────────────────────── */

test('r41 反例：task 已有 evidence、或已 done、或 binding retired → idle 不落 silentFinish', async () => {
  const variants: Array<{ name: string; state: RunState; expectStatus: PlanTask['status'] }> = [
    {
      name: '已有 evidence（已交过回执事实）',
      state: stateOf(
        [taskOf({ evidence: { taskId: 't1', command: 'exit 0', exitCode: 0, tail: 'ok', artifacts: [], at: NOW } })],
        [bindingOf()],
      ),
      expectStatus: 'running',
    },
    {
      name: '已 done（终态）',
      state: stateOf([taskOf({ status: 'done' })], [bindingOf()]),
      expectStatus: 'done',
    },
    {
      name: 'binding 已 retired',
      state: stateOf([taskOf()], [bindingOf({ retired: true })]),
      expectStatus: 'running',
    },
  ]

  for (const variant of variants) {
    const { h, home, store } = openHarness()
    try {
      store.save(variant.state)
      // done 任务不会被 resume 选中 → 用根作用域 tools/result 装订阅（真实宿主里队长的全局观察路径）。
      h.emit('tools/result', { exec: { agent: { id: MEMBER_ID, name: MEMBER_NAME }, name: 'read_file' } })
      const memberBus = h.memberEvents.get(MEMBER_ID)
      assert.ok(memberBus?.has('agent/status'), `${variant.name}：成员级 agent/status 订阅未被装到 agent.ctx`)
      h.emitMember(MEMBER_ID, 'agent/status', { agent: { id: MEMBER_ID }, status: 'running' })
      h.emitMember(MEMBER_ID, 'agent/status', { agent: { id: MEMBER_ID }, status: 'idle' })

      const after = store.load(RUN)
      assert.ok(after)
      assert.equal(after.plan.tasks[0].silentFinish, undefined, `${variant.name}：不得落 silentFinish`)
      assert.equal(after.plan.tasks[0].status, variant.expectStatus, `${variant.name}：任务状态不得被 idle 改写`)
      assert.equal(receiptNoticesOf(after).length, 0, `${variant.name}：不得写待回执账本`)
    } finally {
      await h.close()
      rmSync(home, { recursive: true, force: true })
    }
  }
})

/* ───────────────────────────── 4) 跨 root 名单 ───────────────────────────── */

test('r41 跨 root：两个 run 各取自己的名单（旧实现单变量 → 两次调用/第二个 run 失联断言必须红）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'auto-team-r41-roots-'))
  const store = new RunsStore(join(home, '.dsh/auto-team/runs'))
  const ROOT_A = 'sess-root-a'
  const ROOT_B = 'sess-root-b'
  const MEMBER_A = 'm-root-a'
  const MEMBER_B = 'm-root-b'

  store.save(stateOf([taskOf({ id: 't1', memberId: MEMBER_A })], [bindingOf({ memberId: MEMBER_A, name: 'dev-a' })], {
    runId: 'run-root-a',
    sessionId: ROOT_A,
  }))
  store.save(stateOf([taskOf({ id: 't1', memberId: MEMBER_B })], [bindingOf({ memberId: MEMBER_B, name: 'dev-b' })], {
    runId: 'run-root-b',
    sessionId: ROOT_B,
  }))

  const calls: Array<string | undefined> = []
  const watcher = createMemberWatcher({
    store,
    now: () => NOW,
    listMembers: async (rootId?: string): Promise<HostMember[]> => {
      calls.push(rootId)
      // 每个 root 只认识自己的成员：拿 A 的名单去对 B，B 的成员必然「不存在」。
      if (rootId === ROOT_A) return [{ id: MEMBER_A, name: 'dev-a', status: 'running' }]
      if (rootId === ROOT_B) return [{ id: MEMBER_B, name: 'dev-b', status: 'running' }]
      return []
    },
  })

  try {
    await watcher.tick()
    assert.deepEqual([...calls].sort(), [ROOT_A, ROOT_B].sort(), '必须对两个 root 各取一次名单')
    assert.equal(calls.filter((root) => root === ROOT_A).length, 1)
    assert.equal(calls.filter((root) => root === ROOT_B).length, 1)

    const a = store.load('run-root-a')
    const b = store.load('run-root-b')
    assert.ok(a && b)
    assert.equal(a.plan.tasks[0].status, 'running', 'root A 的成员活着，不得被判失联')
    assert.equal(interruptedOf(a), false)
    assert.equal(b.plan.tasks[0].status, 'running', 'root B 的成员只存在于 B 的名单里，不得被 A 的名单误杀')
    assert.equal(interruptedOf(b), false)
    assert.equal(watcher.memberListHealth(ROOT_A)?.ok, true)
    assert.equal(watcher.memberListHealth(ROOT_B)?.ok, true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

/* ───────────────────────────── 5) 名单不可得：降级可见 + 恢复 ───────────────────────────── */

test('r41 降级可见：名单抛错 → ok:false+error 且进快照 membersSource；同一 tick 其余 root 继续对账；恢复后 ok:true', async () => {
  const home = mkdtempSync(join(tmpdir(), 'auto-team-r41-degrade-'))
  const store = new RunsStore(join(home, '.dsh/auto-team/runs'))
  const ROOT_OK = 'sess-degrade-ok'
  const MEMBER_OK = 'm-degrade-ok'

  // SESSION 的 run 由 watcher 对账（名单会抛错），ROOT_OK 的 run 用来证明「一个 root 失败不跳过其余」。
  store.save(stateOf([taskOf()], [bindingOf()]))
  store.save(stateOf([taskOf({ memberId: MEMBER_OK })], [bindingOf({ memberId: MEMBER_OK, name: 'dev-ok' })], {
    runId: 'run-degrade-ok',
    sessionId: ROOT_OK,
  }))

  let broken = true
  const warnings: string[] = []
  const watcher = createMemberWatcher({
    store,
    now: () => NOW,
    onWarn: (message) => void warnings.push(message),
    listMembers: async (rootId?: string): Promise<HostMember[]> => {
      if (rootId === SESSION) {
        if (broken) throw new Error('宿主 members 端口不可用（E_HOST_MEMBERS_OFFLINE）')
        return [{ id: MEMBER_ID, name: MEMBER_NAME, status: 'running' }]
      }
      // ROOT_OK 的名单里没有自己的成员 → 必须被判失联，证明 continue 而非 return。
      return [{ id: 'stranger', name: 'stranger', status: 'running' }]
    },
  })

  // bridge 只读 watcher 的内存健康态（t2 的装配形状），不新增落盘字段。
  const dataRoot = join(home, '.dsh', 'auto-team')
  const artifactsDir = join(home, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })
  const deps: BridgeDeps = {
    store,
    roles: createRoleRepo({ dir: join(dataRoot, 'roles'), now: () => NOW }),
    memoryRoots: { publicDir: join(dataRoot, 'memory', 'public'), projectDir: join(dataRoot, 'memory', 'project') },
    dataRoot,
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    applyReceipt: (state: RunState) => state,
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: home, artifactsDir },
    now: () => NOW,
    memberListHealth: (sessionId) => watcher.memberListHealth(sessionId),
  }
  const bridge = createBridge(deps)
  bridge.setEnabled(SESSION, true)

  try {
    await watcher.tick()

    const degraded = watcher.memberListHealth(SESSION)
    assert.ok(degraded, '名单失败必须留下内存健康态')
    assert.equal(degraded.ok, false, '名单抛错时 ok 必须是 false')
    assert.match(degraded.error ?? '', /E_HOST_MEMBERS_OFFLINE/, 'error 必须带真实原因文本')
    assert.equal(watcher.memberListHealth(ROOT_OK)?.ok, true, '一个 root 失败不得让其余 root 跳过对账（skip 不是 return）')

    const okRun = store.load('run-degrade-ok')
    assert.ok(okRun)
    assert.equal(okRun.plan.tasks[0].status, 'interrupted', '其余 root 必须照常对账（该失联的仍要报失联）')
    assert.equal(warnings.length >= 1, true, '降级必须留下告警（不许静默）')

    const degradedSnap = bridge.snapshot(SESSION)
    assert.deepEqual(
      degradedSnap.membersSource,
      { ok: false, error: degraded.error, at: NOW },
      '快照必须如实投影 membersSource（面板可见降级）',
    )

    // 名单恢复：ok 回到 true，且快照跟着恢复。
    broken = false
    await watcher.tick()
    assert.equal(watcher.memberListHealth(SESSION)?.ok, true, '名单恢复后必须 ok:true')
    assert.equal(watcher.memberListHealth(SESSION)?.error, undefined, '恢复后不得残留旧错误文本')
    const healthySnap = bridge.snapshot(SESSION)
    assert.equal(healthySnap.membersSource?.ok, true, '恢复后快照 membersSource.ok 必须为 true')

    // 缺省语义：没有任何健康记录时字段缺席（不能编一个 ok:true 假装正常）。
    const absent = bridge.snapshot('sess-never-ticked')
    assert.equal('membersSource' in absent, false, '没有对账记录时 membersSource 必须缺席')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

/* ───────────────────────────── 6) 客户端零改动：快照 awaitingReceipt ───────────────────────────── */

test('r41 客户端零改动：silentFinish 在 → 快照 awaitingReceipt=true；不在 → 不出现真值', async () => {
  const home = mkdtempSync(join(tmpdir(), 'auto-team-r41-snapshot-'))
  const store = new RunsStore(join(home, '.dsh/auto-team/runs'))
  const dataRoot = join(home, '.dsh', 'auto-team')

  store.save(
    stateOf(
      [
        taskOf({ id: 't1', silentFinish: { at: NOW + 500, memberId: MEMBER_ID } }),
        taskOf({ id: 't2', title: '没有待回执的任务', memberId: 'm-other' }),
      ],
      [bindingOf(), bindingOf({ taskId: 't2', memberId: 'm-other', name: 'dev-other' })],
    ),
  )

  const bridge = createBridge({
    store,
    roles: createRoleRepo({ dir: join(dataRoot, 'roles'), now: () => NOW }),
    memoryRoots: { publicDir: join(dataRoot, 'memory', 'public'), projectDir: join(dataRoot, 'memory', 'project') },
    dataRoot,
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    applyReceipt: (state: RunState) => state,
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: home, artifactsDir: join(home, 'artifacts') },
    now: () => NOW,
  })
  bridge.setEnabled(SESSION, true)

  try {
    const snap = bridge.snapshot(SESSION)
    const t1 = snap.tasks.find((task) => task.id === 't1')
    const t2 = snap.tasks.find((task) => task.id === 't2')
    assert.ok(t1 && t2, '快照必须包含两个任务行')
    assert.equal(t1.awaitingReceipt, true, 'silentFinish 在 → 客户端零改动也能显示「待回执」')
    assert.notEqual(t2.awaitingReceipt, true, '没有 silentFinish 的任务不得显示待回执')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
