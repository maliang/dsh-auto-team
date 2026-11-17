/**
 * r45 QA（t3）：自动回执全链路回归 + 变异门禁。
 *
 * 为什么必须走真实 `apply()` + 假宿主 + 临时 HOME 真 RunsStore：
 * 「成员 idle 且任务 running 无证据 → 宿主代跑 acceptance」这条链路的每一环
 * （settings 读取、isSilentFinish 候选、in-flight 去重、bridge.act('receipt')、
 * runGate 真跑命令、applyReceipt 收口、账本消息）都可能单独被改坏而纯函数单测全绿。
 * 本文件把 idle 事件真的投进成员 `agent.ctx` 的订阅器，acceptance 真的 spawn
 * `node -e` 并通过计数文件统计「门禁被执行了几次」，再读**落盘**的 run 文件。
 *
 * 覆盖（对齐任务卡 6 条 + r41 保留分支）：
 *  ① shouldAutoReceipt 全组合（关开关 / 已有证据 / 任务暂停 / 团队暂停 / in-flight /
 *     非 running / 多因素同时成立）；
 *  ②a exit 0 → 任务 done + autoReceipt.exitCode===0 + evidence + 恰一条带 taskId 的
 *     「宿主代跑门禁」账本，silentFinish 不写；②b exit 3 → rework + attempts 递增；
 *  ③ 成员自己先交回执后 idle → 不再跑门禁（计数===1）；
 *  ④ autoReceipt=false → 退回 r41：写 silentFinish、任务仍 running、无宿主代跑账本；
 *  ⑤ 同一任务连续两次 idle → 门禁只跑一次（in-flight 幂等；M2 变异必须让本条红）；
 *  ⑥ 返工上限：attempts 达 maxAttempts 后不再无限重跑（跑固定次数后 failed）。
 *  ⑦ act 失败（空 acceptance → GATE_FAILED）→ 回落 silentFinish（M3 变异必须让本条红）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../src/host/index.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import {
  autoReceiptNoteOf,
  shouldAutoReceipt,
  withAutoReceipt,
  type AutoReceiptFacts,
} from '../src/host/team/auto-receipt.ts'
import type { HostMember } from '../src/host/team/watcher.ts'
import type { MemberBinding, Plan, PlanTask } from '../src/shared/types.ts'

const SESSION = 'sess-r45-auto-receipt'
const RUN = 'run-r45-auto-receipt'
const MEMBER_ID = 'm-auto-1'
const MEMBER_NAME = 'dev-t1-auto'
const NOW = 1_760_000_000_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
        const res: FakeRes = {
          statusCode: 0,
          setHeader: () => {},
          end: (text: string) => resolve(JSON.parse(text) as { data?: unknown; error?: string; status?: number }),
        }
        void route.handler(request, res)
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

/** 打开一个真实 `apply()` 的临时 HOME；返回 harness + 同目录 store。settings 在 apply 前落盘。 */
function openHarness(options: { members?: HostMember[]; settings?: Record<string, unknown> } = {}): {
  h: Harness
  home: string
  store: RunsStore
} {
  const home = mkdtempSync(join(tmpdir(), 'auto-team-r45-auto-'))
  const previousHome = process.env.HOME
  process.env.HOME = home
  try {
    if (options.settings !== undefined) {
      mkdirSync(join(home, '.dsh/auto-team'), { recursive: true })
      writeFileSync(join(home, '.dsh/auto-team/settings.json'), JSON.stringify(options.settings), 'utf8')
    }
    const h = makeHarness(options)
    apply(h.ctx as never, { workspace: home })
    return { h, home, store: new RunsStore(join(home, '.dsh/auto-team/runs')) }
  } finally {
    process.env.HOME = previousHome
  }
}

/* ───────────────────────────── run 状态构造 ───────────────────────────── */

function taskOf(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 't1',
    title: '实现自动回执',
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

function noticesOf(state: RunState, taskId = 't1'): RunState['messages'] {
  return state.messages.filter((message) => message.from === 'captain' && message.to === 'user' && message.taskId === taskId)
}

/** 从盘上读最新账本（断言收口后的消息，不依赖内存里的旧快照）。 */
function noticesOfRun(store: RunsStore, taskId = 't1'): RunState['messages'] {
  const state = store.load(RUN)
  return state === null ? [] : noticesOf(state, taskId)
}

/** 轮询等待异步落盘结果（不 sleep 猜时序）。 */
async function waitForTask(
  store: RunsStore,
  read: (task: PlanTask) => PlanTask | undefined,
  what: string,
  timeoutMs = 15_000,
): Promise<PlanTask> {
  const started = Date.now()
  for (;;) {
    const state = store.load(RUN)
    const task = state?.plan.tasks.find((candidate) => candidate.id === 't1')
    const value = task === undefined ? undefined : read(task)
    if (value !== undefined) return value
    if (Date.now() - started > timeoutMs) throw new Error(`等待超时：${what}（当前状态：${describe(state)})`)
    await sleep(20)
  }
}

function describe(state: RunState | null): string {
  if (state === null) return 'run 不存在'
  const task = state.plan.tasks[0]
  if (task === undefined) return 'task 不存在'
  const notices = noticesOf(state).map((message) => message.body)
  return `status=${task.status} attempts=${task.attempts ?? 0} autoReceipt=${JSON.stringify(task.autoReceipt)} silentFinish=${
    task.silentFinish === undefined ? 'undefined' : 'set'
  } evidence=${JSON.stringify(task.evidence?.exitCode)} messages=${JSON.stringify(notices)}`
}

/** 把任务状态手工改回指定值（只用于制造「状态闸放开、仅剩 in-flight 闸」的窗口）。 */
function setTaskStatus(store: RunsStore, status: PlanTask['status']): void {
  const state = store.load(RUN)
  assert.ok(state, 'run 必须仍在盘上')
  store.save({
    ...state,
    plan: { ...state.plan, tasks: state.plan.tasks.map((task) => (task.id === 't1' ? { ...task, status } : task)) },
  })
}

/* ───────────────────────────── 真门禁命令（计数文件 / 退出码 / 延迟可控） ───────────────────────────── */

/** acceptance：用 node 写计数文件再以指定退出码结束；延迟模拟「门禁正在跑」的 in-flight 窗口。 */
function gateScript(counterFile: string, exitCode: number, delayMs = 0): string {
  const body = `require('fs').appendFileSync('${counterFile}','x');process.exit(${exitCode})`
  const inner = delayMs > 0 ? `setTimeout(function(){${body}},${delayMs})` : body
  return `node -e "${inner}"`
}

function gateRuns(counterFile: string): number {
  if (!existsSync(counterFile)) return 0
  return readFileSync(counterFile, 'utf8').split('x').length - 1
}

/** 真 apply() + 真 RunsStore 的公共播种：toggle → save → resume → 成员级订阅 → 工作推进信号。 */
async function seedRun(h: Harness, store: RunsStore, task: PlanTask, plan: Partial<Plan> = {}): Promise<void> {
  const toggled = await h.act(SESSION, { type: 'toggle', enabled: true })
  assert.equal(toggled.error, undefined, `toggle 必须受理：${toggled.error ?? ''}`)
  store.save(stateOf([task], [bindingOf({ taskId: task.id })], plan))
  const resumed = await h.act(SESSION, { type: 'resume' })
  assert.equal((resumed.data as { rejected?: unknown } | undefined)?.rejected, undefined, 'resume 必须受理')
  assert.ok(h.memberEvents.get(MEMBER_ID)?.has('agent/status'), '成员级 agent/status 订阅未装到 agent.ctx')
  h.emitMember(MEMBER_ID, 'tools/result', { agent: { id: MEMBER_ID, name: MEMBER_NAME }, name: 'read_file' })
}

function idle(h: Harness): void {
  h.emitMember(MEMBER_ID, 'agent/status', { agent: { id: MEMBER_ID }, status: 'idle' })
}

/* ───────────────────────────── ① 判定函数全组合 ───────────────────────────── */

test('r45 ① shouldAutoReceipt 全组合：只有「开、running、无证据、未暂停、无在跑门禁」才为 true', () => {
  const base: AutoReceiptFacts = {
    status: 'running',
    paused: false,
    planPaused: false,
    hasEvidence: false,
    inflight: false,
    enabled: true,
  }
  const cases: Array<{ label: string; patch: Partial<AutoReceiptFacts>; expected: boolean }> = [
    { label: '全部满足', patch: {}, expected: true },
    { label: 'enabled=false', patch: { enabled: false }, expected: false },
    { label: '已有证据（成员已交回执）', patch: { hasEvidence: true }, expected: false },
    { label: '任务暂停（taskPauses）', patch: { paused: true }, expected: false },
    { label: '任务状态本身是 paused', patch: { status: 'paused' }, expected: false },
    { label: '团队暂停', patch: { planPaused: true }, expected: false },
    { label: 'in-flight（同一任务门禁在跑）', patch: { inflight: true }, expected: false },
    { label: '任务已 done（非 running）', patch: { status: 'done' }, expected: false },
    { label: '任务已 rework（非 running）', patch: { status: 'rework' }, expected: false },
    { label: '任务在门禁中 gate（非 running）', patch: { status: 'gate' }, expected: false },
    { label: '多因素同时成立', patch: { enabled: false, hasEvidence: true, paused: true }, expected: false },
  ]
  for (const item of cases) {
    assert.equal(shouldAutoReceipt({ ...base, ...item.patch }), item.expected, item.label)
  }

  // 账本文案：人话必须区分「已通过 / 转返工 / 未执行」，否则成员看不出该不该再交回执。
  assert.equal(autoReceiptNoteOf({ exitCode: 0 }), '宿主代跑门禁：exit 0 → 已通过')
  assert.match(autoReceiptNoteOf({ exitCode: 3 }), /exit 3 → 转返工/)
  assert.match(autoReceiptNoteOf({ rejected: { code: 'GATE_FAILED', message: '空验收命令' } }), /未执行（GATE_FAILED）：空验收命令/)

  // withAutoReceipt 只写事实字段，不改原对象与 evidence。
  const task = taskOf({ acceptance: 'exit 0' })
  const next = withAutoReceipt(task, { at: NOW + 1, exitCode: 0 })
  assert.deepEqual(next.autoReceipt, { at: NOW + 1, exitCode: 0 })
  assert.equal(task.autoReceipt, undefined, '不得原地改任务对象')
  assert.equal(next.evidence, task.evidence, '不得碰 evidence')
})

/* ───────────────────────────── ②a 真门禁 exit 0 → done ───────────────────────────── */

test('r45 ②a 成员 idle 且任务 running 无证据 → 宿主真跑 acceptance；exit 0 → done + autoReceipt，账本一条，不写 silentFinish', async () => {
  const { h, home, store } = openHarness()
  try {
    const counter = join(home, 'gate-exit0.txt')
    await seedRun(h, store, taskOf({ acceptance: gateScript(counter, 0) }))
    idle(h)

    const settled = await waitForTask(store, (task) => (task.status === 'done' ? task : undefined), '任务 done')
    assert.equal(gateRuns(counter), 1, '必须真跑一次 acceptance 命令（不是只标记）')
    assert.ok(settled.autoReceipt, '必须在任务上留下 autoReceipt 事实')
    assert.equal(settled.autoReceipt?.exitCode, 0, 'autoReceipt.exitCode 必须取真实门禁退出码')
    assert.equal(settled.evidence?.exitCode, 0, '证据必须由真 runGate 写入')
    assert.equal(settled.silentFinish, undefined, '代跑成功不得同时标记「待回执」')

    const notices = noticesOfRun(store)
    const auto = notices.filter((notice) => /宿主代跑门禁/.test(notice.body))
    assert.equal(auto.length, 1, '必须恰一条「宿主代跑门禁」账本')
    assert.match(auto[0].body, /exit 0 → 已通过/)
    assert.equal(auto[0].taskId, 't1', '账本消息必须带 taskId')

    // 幂等：任务已 done，再投递 idle 不得再跑门禁、不得追加第二条通知。
    idle(h)
    await sleep(200)
    const afterSecond = store.load(RUN)
    assert.ok(afterSecond)
    assert.equal(gateRuns(counter), 1, '重复 idle 不得再跑门禁')
    assert.equal(afterSecond.plan.tasks[0].autoReceipt?.at, settled.autoReceipt?.at, '重复 idle 不得刷新 autoReceipt.at')
    assert.equal(noticesOf(afterSecond).filter((notice) => /宿主代跑门禁/.test(notice.body)).length, 1)
  } finally {
    await h.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/* ───────────────────────────── ②b 真门禁 exit 3 → rework ───────────────────────────── */

test('r45 ②b 宿主代跑 exit 3 → 任务 rework、attempts 递增、保留证据、不写 silentFinish', async () => {
  const { h, home, store } = openHarness()
  try {
    const counter = join(home, 'gate-exit3.txt')
    await seedRun(h, store, taskOf({ acceptance: gateScript(counter, 3) }))
    idle(h)

    const settled = await waitForTask(store, (task) => (task.status === 'rework' ? task : undefined), '任务 rework')
    assert.equal(gateRuns(counter), 1)
    assert.equal(settled.status, 'rework', 'exit 3 → 必须转返工')
    assert.equal(settled.attempts, 1, '返工必须让 attempts 递增（由 applyReceipt 统一决定）')
    assert.equal(settled.autoReceipt?.exitCode, 3)
    assert.equal(settled.evidence?.exitCode, 3, '返工必须保留失败证据')
    assert.equal(settled.silentFinish, undefined, '代跑已收口（rework）不得再标「待回执」')
    assert.match(noticesOfRun(store).filter((notice) => /宿主代跑门禁/.test(notice.body))[0]?.body ?? '', /exit 3 → 转返工/)
  } finally {
    await h.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/* ───────────────────────────── ③ 成员自己先交回执 ───────────────────────────── */

test('r45 ③ 成员自己先交回执后再 idle → 不再跑门禁（门禁计数保持 1）', async () => {
  const { h, home, store } = openHarness()
  try {
    const counter = join(home, 'gate-manual.txt')
    await seedRun(h, store, taskOf({ acceptance: gateScript(counter, 0) }))

    const receipt = await h.act(SESSION, { type: 'receipt', taskId: 't1' })
    assert.equal(receipt.error, undefined, `成员回执必须被受理：${receipt.error ?? ''}`)
    const done = store.load(RUN)?.plan.tasks[0]
    assert.ok(done)
    assert.equal(done.status, 'done', '成员自己的回执必须把任务收口')
    assert.equal(gateRuns(counter), 1, '成员回执跑了一次门禁')

    idle(h)
    await sleep(500)
    const after = store.load(RUN)?.plan.tasks[0]
    assert.ok(after)
    assert.equal(gateRuns(counter), 1, '成员已交回执 → idle 不得再次代跑门禁')
    assert.equal(after.autoReceipt, undefined, '成员自己交的回执不得被标记为宿主代跑')
    assert.equal(noticesOf(store.load(RUN) as RunState).filter((notice) => /宿主代跑门禁/.test(notice.body)).length, 0)
  } finally {
    await h.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/* ───────────────────────────── ④ autoReceipt=false → 退回 r41 ───────────────────────────── */

test('r45 ④ autoReceipt=false → idle 仍写 silentFinish、任务 running、门禁 0 次、无宿主代跑账本', async () => {
  const { h, home, store } = openHarness({ settings: { autoReceipt: false } })
  try {
    const counter = join(home, 'gate-off.txt')
    await seedRun(h, store, taskOf({ acceptance: gateScript(counter, 0) }))
    idle(h)

    const after = await waitForTask(store, (task) => (task.silentFinish === undefined ? undefined : task), 'silentFinish 落盘')
    assert.equal(after.status, 'running', '关掉自动回执后任务不得被 idle 改写状态')
    assert.equal(after.silentFinish?.memberId, MEMBER_ID)
    assert.equal(after.autoReceipt, undefined)
    assert.equal(after.evidence, undefined, '待回执不允许伪造 evidence')
    assert.equal(gateRuns(counter), 0, '关掉自动回执后不得跑任何门禁')

    const notices = noticesOfRun(store)
    assert.equal(notices.length, 1, '必须恰一条待回执通知')
    assert.match(notices[0].body, /已结束本轮但未提交回执/)
    assert.equal(notices.some((notice) => /宿主代跑门禁/.test(notice.body)), false, '关掉后不得写宿主代跑账本')
  } finally {
    await h.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/* ───────────────────────────── ⑤ in-flight 幂等（M2 变异必须红） ───────────────────────────── */

test('r45 ⑤ 同一任务连续两次 idle → 门禁只跑一次（in-flight 去重；关掉去重即计数 2）', async () => {
  const { h, home, store } = openHarness()
  try {
    const counter = join(home, 'gate-inflight.txt')
    // 慢门禁：留出「第一次门禁还在跑」的窗口。
    await seedRun(h, store, taskOf({ acceptance: gateScript(counter, 0, 300) }))
    idle(h)

    // 第一轮真的进入 gate（门禁在跑），随后把状态闸手工放开，只留 in-flight 一道闸。
    await waitForTask(store, (task) => (task.status === 'gate' ? task : undefined), '门禁进入 gate', 5_000)
    setTaskStatus(store, 'running')

    idle(h) // 同一任务第二次 idle，恰在门禁 in-flight 期间

    const settled = await waitForTask(store, (task) => (task.autoReceipt === undefined ? undefined : task), '第一轮代跑收口')
    // 再等一段（超过门禁时长）确认没有第二次排队执行。
    await sleep(900)
    assert.equal(gateRuns(counter), 1, '同一任务连续两次 idle 只能跑一次门禁（in-flight 去重被去掉 → 2）')
    assert.equal(settled.autoReceipt?.exitCode, 0)
    const final = store.load(RUN)?.plan.tasks[0]
    assert.ok(final)
    assert.equal(final.status, 'done')
  } finally {
    await h.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/* ───────────────────────────── ⑥ 返工上限 ───────────────────────────── */

test('r45 ⑥ 返工上限：maxAttempts=1 时 exit 3 直接 failed，再 idle 不重跑（固定次数后停）', async () => {
  const { h, home, store } = openHarness({ settings: { maxAttempts: 1 } })
  try {
    const counter = join(home, 'gate-max.txt')
    await seedRun(h, store, taskOf({ acceptance: gateScript(counter, 3) }))
    idle(h)

    const failed = await waitForTask(store, (task) => (task.status === 'failed' ? task : undefined), '任务 failed')
    assert.equal(gateRuns(counter), 1)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.attempts, 1, 'maxAttempts=1 → 首次返工即给不出重试次数，直接 failed')
    assert.equal(failed.autoReceipt?.exitCode, 3)

    idle(h)
    await sleep(500)
    const after = store.load(RUN)?.plan.tasks[0]
    assert.ok(after)
    assert.equal(gateRuns(counter), 1, '已 failed 的任务不得被 idle 再次代跑（禁止自造重试循环）')
    assert.equal(after.status, 'failed')
    assert.equal(after.attempts, 1)
  } finally {
    await h.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/* ───────────────────────────── ⑦ act 失败回落 silentFinish（M3 变异必须红） ───────────────────────────── */

test('r45 ⑦ 代跑不可执行（空 acceptance → GATE_FAILED）→ 不写 autoReceipt，回落 silentFinish', async () => {
  const { h, home, store } = openHarness()
  try {
    // trim 后为空：bridge 不会 spawn shell，outcome 失败 → reject GATE_FAILED，任务保持 running。
    await seedRun(h, store, taskOf({ acceptance: '   ' }))
    idle(h)

    const after = await waitForTask(store, (task) => (task.silentFinish === undefined ? undefined : task), '回落 silentFinish', 8_000)
    assert.equal(after.status, 'running', '代跑失败不得把任务标成 done/failed')
    assert.equal(after.autoReceipt, undefined, '代跑失败不得留下 autoReceipt 假事实')
    assert.equal(after.evidence, undefined)
    const notices = noticesOfRun(store)
    assert.equal(notices.filter((notice) => /已结束本轮但未提交回执/.test(notice.body)).length, 1, '必须回落 r41 待回执通知')
    assert.equal(notices.filter((notice) => /宿主代跑门禁/.test(notice.body)).length, 0, '不得写「已通过」假账本')
  } finally {
    await h.close()
    rmSync(home, { recursive: true, force: true })
  }
})
