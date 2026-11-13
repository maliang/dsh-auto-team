/**
 * r32 QA 回归（t3）：**停滞真实性** + **进度记账** + **复用路径软提示**。
 *
 * 为什么单独建文件而不是往既有用例里塞：本文件验的是 r32 的三条用户可见承诺，
 * 每条都必须能用「改回错误实现 → 变红」自证（突变矩阵见
 * docs/teamflow/2026-11-13-r32-stall-truth/QA-REPORT.md §3）：
 *
 *  ① 停滞矩阵：有信号且久未推进 = 真停滞（秒数正确）；无信号 = 证据不足（不得染成黄条）；
 *     有信号后转 done/failed = 恒不判停滞。客户端只渲染宿主字段，零阈值。
 *  ② 进度记账：一次 `tools/result`（子 agent 身份）必须让 `state.progress[memberId].at`
 *     前进**并落盘**；binding 对不上的调用不得写进别人名下。
 *  ③ 复用软提示：与 spawn 路径同形（恰 1 条、带 taskId、排在派发消息之后、rework 不重复）。
 *
 * 断言有效性：每条断言都对应一处可回退的实现点（见报告 §3 的变异矩阵），
 * 不是「跑一遍绿了就算」的恒真断言。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../src/host/index.ts'
import { STALL_MS } from '../src/host/config.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { runsDir } from '../src/host/paths.ts'
import { secondsText, stallNoteOf, stallOf } from '../src/host/team/stall.ts'
import { applyReceipt, dispatchReady, type DispatchDeps } from '../src/host/team/dispatch.ts'
import { memberPageOf } from '../src/client/nav.ts'
import { stalledRowOf } from '../src/client/viewmodel.ts'
import type { MemberBinding, MemberView, Plan, PlanTask, Role } from '../src/shared/types.ts'
import type { RoleRepo } from '../src/host/roles/repo.ts'
import type { ToolSpec } from '../src/host/adapters.ts'

const NOW = 1_700_000_000_000

// ---------------------------------------------------------------------------
// ① 停滞矩阵（纯函数 + 宿主快照 + 客户端渲染三层）
// ---------------------------------------------------------------------------

test('① 停滞判定矩阵：有信号久未推进才 stalled，秒数与文案由同一处算好', () => {
  // 真停滞：100 秒没推进、阈值 90 秒。
  const quiet = stallOf(NOW - 100_000, NOW, STALL_MS)
  assert.equal(quiet.stalled, true)
  assert.equal(quiet.stalledForMs, 100_000, '秒数必须等于真实静默时长（不是派发时长，也不是 0）')
  assert.equal(quiet.reason, 'quiet', '有信号但久未推进 = quiet（与「证据不足」互斥）')
  assert.equal(secondsText(quiet.stalledForMs), '100 秒', '文案只由宿主这一处格式化')

  // 阈值边界：差 1ms 不判，正好达到就判（>= 口径）。
  assert.equal(stallOf(NOW - 89_999, NOW, STALL_MS).stalled, false)
  assert.equal(stallOf(NOW - 90_000, NOW, STALL_MS).stalled, true)

  // 从没有信号：证据不足，不是停滞。这条是 r32 真机事故（20 分钟干活被判 1210 秒）的根。
  const unreported = stallOf(undefined, NOW, STALL_MS)
  assert.equal(unreported.stalled, false)
  assert.equal(unreported.stalledForMs, 0, '证据不足不允许给出任何「停滞时长」')
  assert.equal(unreported.reason, 'unreported')
  assert.equal(stallNoteOf(unreported.reason), '宿主未上报推进信号，无法判定是否停滞')
  assert.equal(stallNoteOf('quiet'), '', '真停滞后不再显示证据不足文案（两者互斥）')
  assert.equal(stallNoteOf('none'), '')
  assert.equal(secondsText(unreported.stalledForMs), '0 秒', '未停滞时秒数文案不得出现误导性的非零值')
})

/** r32 的宿主快照只允许用 r21 夹具（真实 createBridge + 真实 RunsStore）。 */
import { bindingOf, createHarness, planOf, runStateOf, seed, SESSION, taskOf } from './r21-harness.ts'

function snapshotMembers(state: RunState) {
  const h = createHarness()
  try {
    seed(h.store, state)
    return { members: h.bridge.snapshot(SESSION).members, dir: h.dir }
  } finally {
    // createHarness 的临时目录由进程退出清理即可；Windows 上避免占用句柄。
    void h.dir
  }
}

test('① 宿主快照：刚派发但从来没有 progress → 不 stalled、走「证据不足」且 lastEventAt 停在派发时刻', () => {
  const { members } = snapshotMembers(
    runStateOf({
      plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', 'running')] }),
      // 刚派发 3 秒：旧实现从 spawnedAt 倒计时，阈值内本就不该判；关键是**不因为有基线就"迟早会判"**。
      bindings: [bindingOf('t1', '开发-1', { spawnedAt: NOW - 3_000 })],
    }),
  )
  const member = members.find((item) => item.memberId === 'member-t1')
  assert.ok(member, '成员必须出现在快照里')
  assert.equal(member.stalled, false, '刚派发 + 无信号 = 不判停滞')
  assert.equal(member.stalledForMs, 0)
  assert.equal(member.stalledSecondsText, '', '没有秒数文案，面板就长不出黄条')
  assert.equal(member.stallReason, 'unreported')
  assert.equal(member.stallNote, '宿主未上报推进信号，无法判定是否停滞')
  assert.equal(member.lastEventAt, NOW - 3_000, '无进度时 lastEventAt 只能由派发时刻兜底')
})

test('① 宿主快照：从未上报（派发已 20 分钟）也不 persisted 成停滞；有 100 秒静默才判', () => {
  const unreported = snapshotMembers(
    runStateOf({
      plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', 'running')] }),
      // 真机形态：spawnedAt 很远，progress 为空。
      bindings: [bindingOf('t1', '开发-1', { spawnedAt: NOW - 1_210_840 })],
    }),
  )
  const silent = unreported.members.find((item) => item.memberId === 'member-t1')
  assert.equal(silent?.stalled, false, '没有证据就不许判停滞（旧实现这里 = true / 1210 秒）')
  assert.equal(silent?.stalledForMs, 0)
  assert.equal(silent?.stallReason, 'unreported')

  // 对照：同样的 spawnedAt，只要有一条 100 秒前的真进度，就必须判停滞（证明上面不是恒假）。
  const quiet = snapshotMembers(
    runStateOf({
      plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', 'running')] }),
      bindings: [bindingOf('t1', '开发-1', { spawnedAt: NOW - 1_210_840 })],
      progress: { 'member-t1': { at: NOW - 100_000 } },
    }),
  )
  const stalled = quiet.members.find((item) => item.memberId === 'member-t1')
  assert.equal(stalled?.stalled, true)
  assert.equal(stalled?.stalledForMs, 100_000, '停滞时长只能由 progress.at 算，不能掺 spawnedAt')
  assert.equal(stalled?.stalledSecondsText, '100 秒')
  assert.equal(stalled?.stallNote, '')
})

test('① 宿主快照：有 progress 后转 done / failed → stalled 恒 false（终态不再产出）', () => {
  for (const status of ['done', 'failed'] as const) {
    const { members } = snapshotMembers(
      runStateOf({
        plan: planOf({ status: 'dispatching', tasks: [taskOf('t1', status)] }),
        bindings: [bindingOf('t1', '开发-1', { spawnedAt: NOW - 1_210_840 })],
        // 进度停在很久以前：若判定只看 elapsed，这里会误报。
        progress: { 'member-t1': { at: NOW - 600_000 } },
      }),
    )
    const member = members.find((item) => item.memberId === 'member-t1')
    assert.equal(member?.stalled, false, `${status} 成员不得被判停滞`)
    assert.equal(member?.stalledForMs, 0)
    assert.equal(member?.stalledSecondsText, '')
    assert.equal(member?.stallReason, 'none', `${status} 不是「证据不足」也不是「停滞」`)
    assert.equal(member?.stallNote, '')
  }
})

test('① 客户端零阈值：只认宿主 stalled 标记与文案，绝不用 stalledForMs 自己判', () => {
  const base: MemberView = {
    memberId: 'member-t1',
    taskId: 't1',
    roleId: 'dev',
    name: '开发-1',
    status: 'running',
    lastEventAt: NOW,
    modelRoute: '会话默认',
    stalled: false,
    stalledForMs: 0,
    stalledSecondsText: '',
    stallReason: 'none',
    stallNote: '',
    canResume: true,
  }

  // 证据不足：页面显示宿主的唯一措辞，且**没有**黄条。
  const page = memberPageOf({ member: { ...base, stallReason: 'unreported', stallNote: '宿主未上报推进信号，无法判定是否停滞' } })
  assert.equal(page.stalled, false)
  assert.equal(page.stalledText, '')
  assert.equal(page.stallNote, '宿主未上报推进信号，无法判定是否停滞')

  // 标记为 false 但毫秒数很大：客户端不得自己「看着数字大就判停滞」。
  const notFlagged = stalledRowOf({ ...base, stalled: false, stalledForMs: 999_999 })
  assert.equal(notFlagged.show, false, '客户端若自己比阈值，这里会被错误点亮')

  // 标记为 true 但毫秒数只有 1：客户端只渲染宿主文案，不自己算秒。
  const flagged = stalledRowOf({
    ...base,
    stalled: true,
    stalledForMs: 1,
    stalledSecondsText: '1 秒',
    stallReason: 'quiet',
  })
  assert.equal(flagged.show, true)
  assert.match(flagged.text, /1 秒/, '文案逐字来自宿主，客户端零格式化')
})

// ---------------------------------------------------------------------------
// ② 进度记账（真实 apply() + 真实 RunsStore + 真落盘）
// ---------------------------------------------------------------------------

interface FakeScope {
  on(event: string, listener: (...args: unknown[]) => void): () => void
  emit(event: string, ...args: unknown[]): void
  count(event: string): number
}

function makeScope(): FakeScope {
  const hooks = new Map<string, Array<(...args: unknown[]) => void>>()
  return {
    on(event, listener) {
      const list = hooks.get(event) ?? []
      list.push(listener)
      hooks.set(event, list)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
    emit(event, ...args) {
      for (const listener of [...(hooks.get(event) ?? [])]) listener(...args)
    },
    count(event) {
      return hooks.get(event)?.length ?? 0
    },
  }
}

/**
 * 装配层假 ctx：只实现 `apply()` 会真的用到的面。
 *
 * 关键点：`agents.get(memberId)` 必须返回**带 ctx 的活 agent** —— r32 修复正是把订阅
 * 挂在成员 ctx 上（根作用域 `tools/result` 收不到子 agent 的调用）。假 ctx 若不给
 * `agents.get`，这条链在测试里就永远走「旧宿主降级」，测不出真机行为。
 */
interface ApplyHarness {
  ctx: Record<string, unknown>
  rootEmit(event: string, ...args: unknown[]): void
  addMember(id: string): FakeScope
  memberScope(id: string): FakeScope | undefined
  warnings: string[]
  routes: unknown[]
  disposeAll(): void
}

function makeApplyHarness(): ApplyHarness {
  const root = makeScope()
  const memberScopes = new Map<string, FakeScope>()
  const warnings: string[] = []
  const routes: unknown[] = []
  const disposers: Array<() => void | Promise<void>> = []
  const webServer = { register: (route: unknown) => void routes.push(route) }
  const services: Record<string, unknown> = {
    webServer,
    llm: { resolveCallConfig: (config: unknown) => config },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
    // 宿主 0.2.2-rc.2 的真实形状：namesOf 返回 { self, parent }，没有 name。
    subagents: { namesOf: (agent: { id?: string }) => ({ self: `lead/${String(agent?.id ?? '')}`, parent: 'lead' }) },
  }
  const ctx = {
    tools: { register: () => {} },
    systemPrompt: { section: () => {} },
    webServer,
    agents: {
      currentInitiator: () => ({ id: 'captain', name: 'captain' }),
      get: (id: string) => {
        const scope = memberScopes.get(id)
        return scope === undefined ? undefined : { id, ctx: scope, session: { header: { cwd: process.cwd() } } }
      },
    },
    agentTeams: {
      // 名单必须把成员报成 running：否则 watcher 的对账会在测试中途把它判成 interrupted。
      listMembers: async () => [...memberScopes.keys()].map((id) => ({ id, name: id, status: 'running' })),
      spawnTeammate: async () => ({ member: { id: 'unused', name: 'unused', status: 'running' } }),
      sendMessage: async () => {},
    },
    effect: (dispose: () => void | Promise<void>) => void disposers.push(dispose),
    on: (event: string, listener: (...args: unknown[]) => void) => root.on(event, listener),
    get: (name: string) => services[name],
    logger: { warn: (text: string) => void warnings.push(text), info: () => {} },
  }
  return {
    ctx,
    rootEmit: (event, ...args) => root.emit(event, ...args),
    addMember(id) {
      const scope = makeScope()
      memberScopes.set(id, scope)
      return scope
    },
    memberScope: (id) => memberScopes.get(id),
    warnings,
    routes,
    disposeAll() {
      for (const dispose of disposers.splice(0)) {
        try {
          void dispose()
        } catch {
          /* 清理失败不影响断言 */
        }
      }
    },
  }
}

function stateWithBinding(memberId: string, overrides: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: {
      runId: 'run-qa-progress',
      sessionId: 'sess-qa',
      createdAt: NOW,
      status: 'dispatching',
      tasks: [
        {
          id: 't1',
          title: '任务 t1',
          roleId: 'dev',
          dependsOn: [],
          acceptance: 'true',
          status: 'running',
          memberId,
        },
      ],
      maxConcurrent: 3,
    },
    plannedAt: NOW,
    messages: [],
    bindings: [{ taskId: 't1', roleId: 'dev', memberId, name: 'dev-t1', spawnedAt: NOW - 10_000 }],
    routeAudits: [],
    ...overrides,
  }
}

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'auto-team-r32-qa-'))
  const previous = process.env.HOME
  process.env.HOME = home
  try {
    run(home)
  } finally {
    process.env.HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

test('② 进度记账：一次子 agent 的 tools/result 必须推进 state.progress 且真的落盘', () => {
  withHome((home) => {
    const h = makeApplyHarness()
    const memberScope = h.addMember('member-m1')
    const store = new RunsStore(runsDir(home))
    store.save(stateWithBinding('member-m1'))
    apply(h.ctx as never, { workspace: home })

    const before = Date.now()
    // 根作用域投递（宿主真实签名 `(exec, result)`）；agent 身份 = 子 agent 的 SessionId。
    h.rootEmit('tools/result', { callId: 'c1', name: 'bash', agent: { id: 'member-m1' } }, { ok: true })

    const state = store.load('run-qa-progress')
    const at = state?.progress?.['member-m1']?.at
    assert.equal(typeof at, 'number', '一次实质工具调用必须写下 progress[memberId].at')
    assert.ok((at as number) >= before, 'at 必须是本次调用的时间（不得写成派发时刻）')

    // 落盘判据：直接读文件，而不是信内存对象（recordProgress 的唯一目的是写盘）。
    const onDisk = JSON.parse(readFileSync(join(runsDir(home), 'run-qa-progress.json'), 'utf8')) as RunState
    assert.equal(typeof onDisk.progress?.['member-m1']?.at, 'number', 'progress 必须真的进了 run JSON')
    assert.equal(onDisk.progress?.['member-m1']?.at, at)

    // 第二条来路：成员自己的 ctx 上必须装上了订阅（r32 的主修复点）。
    assert.equal(memberScope.count('tools/result'), 1, '成员 ctx 上必须挂上 tools/result（根作用域不是主路）')
    assert.equal(memberScope.count('agent/status'), 1)

    h.disposeAll()
  })
})

test('② 进度记账：成员 ctx 上的后续调用会继续推进 at（不是只记第一次）', () => {
  withHome((home) => {
    const h = makeApplyHarness()
    const memberScope = h.addMember('member-m1')
    const store = new RunsStore(runsDir(home))
    store.save(stateWithBinding('member-m1', { progress: { 'member-m1': { at: NOW - 500_000 } } }))
    apply(h.ctx as never, { workspace: home })

    // 先来一次根作用域信号：它的副作用之一是「补装成员级订阅」（冷恢复成员走的就是这条）。
    h.rootEmit('tools/result', { callId: 'c0', agent: { id: 'member-m1' } }, { ok: true })
    // 把 at 退回旧值，证明下一条**成员作用域**事件真的会让它前进（而不是停在第一次写入）。
    const first = store.load('run-qa-progress') as RunState
    store.save({ ...first, progress: { 'member-m1': { at: NOW - 500_000 } } })

    memberScope.emit('tools/result', { callId: 'c1', name: 'read', agent: { id: 'member-m1' } }, { ok: true })

    const after = store.load('run-qa-progress')?.progress?.['member-m1']?.at ?? 0
    assert.ok(after > NOW - 500_000, '成员 ctx 上的每次实质调用都必须推进 at（旧实现永远停在派发时刻）')
    assert.ok(Math.abs(after - Date.now()) < 5_000, 'at 应接近当前时刻')
    h.disposeAll()
  })
})

test('② 进度记账：binding 对不上的调用不得写进别人名下，且必须留一条可见 warn', () => {
  withHome((home) => {
    const h = makeApplyHarness()
    h.addMember('member-m1')
    const store = new RunsStore(runsDir(home))
    const old = NOW - 500_000
    store.save(stateWithBinding('member-m1', { progress: { 'member-m1': { at: old } } }))
    apply(h.ctx as never, { workspace: home })

    // 未登记的 agent：宿主投递了一个本 run 不认识的 SessionId。
    h.rootEmit('tools/result', { callId: 'cx', agent: { id: 'ghost-member' } }, { ok: true })

    const state = store.load('run-qa-progress') as RunState
    assert.equal(state.progress?.['member-m1']?.at, old, '别人的调用不得推进 member-m1 的进度（「A 的调用救 B」）')
    assert.equal(state.progress?.['ghost-member'], undefined, '没有 binding 就不许凭空写 progress')
    assert.ok(
      h.warnings.some((text) => text.includes('未登记的 agent') && text.includes('ghost-member')),
      `解析不到 binding 时必须留痕，实际 warnings=${JSON.stringify(h.warnings)}`,
    )
    h.disposeAll()
  })
})

// ---------------------------------------------------------------------------
// ③ 复用路径软提示（spawn / reuse 同形）
// ---------------------------------------------------------------------------

const R31_NOW = NOW

function role(): Role {
  return { id: 'dev', name: '开发', duty: '交付', skillIds: [], builtin: true, updatedAt: R31_NOW }
}

function roleRepo(): RoleRepo {
  const roles = new Map([[role().id, role()]])
  return {
    list: () => [...roles.values()],
    get: (id: string) => roles.get(id),
    save: (item: Role) => ({ ok: true as const, role: item }),
    remove: () => ({ ok: true as const }),
    seed: () => {},
    restoreDefaults: () => ({ restored: [], kept: [] }),
  }
}

function task(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
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

function dispatchState(tasks: PlanTask[], overrides: Partial<RunState> = {}): RunState {
  const plan: Plan = {
    runId: 'run-qa-hint',
    sessionId: 'sess-qa-hint',
    createdAt: R31_NOW,
    status: 'dispatching',
    tasks,
    maxConcurrent: 3,
  }
  return {
    version: RUN_STATE_VERSION,
    plan,
    plannedAt: R31_NOW,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...overrides,
  }
}

interface HintHarness {
  store: RunsStore
  dir: string
  deps: DispatchDeps
  spawned: string[]
  sent: string[]
  dispose(): void
}

function makeHintHarness(): HintHarness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r32-hint-'))
  const store = new RunsStore(dir)
  const spawned: string[] = []
  const sent: string[] = []
  const deps: DispatchDeps = {
    store,
    roles: roleRepo(),
    buildPrompt: () => 'PROMPT',
    listMembers: async () => [],
    spawn: async (input) => {
      spawned.push(input.name)
      return { ok: true, memberId: `m-${input.name}` }
    },
    sendMessage: async (_memberId: string, text: string) => {
      sent.push(text)
      return { ok: true }
    },
    hostConcurrency: () => ({ limit: 8, source: 'host' }),
    now: () => R31_NOW,
  }
  return {
    store,
    dir,
    deps,
    spawned,
    sent,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function userHints(state: RunState, taskId: string) {
  return state.messages.filter((message) => message.from === 'captain' && message.to === 'user' && message.taskId === taskId)
}

/** 派发消息 = captain 发给成员的那条（有 toMemberId）；spawn 与复用两条路径的正文措辞不同，故不按正文匹配。 */
function dispatchMessageOf(state: RunState) {
  return state.messages.filter((message) => message.from === 'captain' && message.toMemberId !== undefined).at(-1)
}

test('③ 软提示同形：spawn 与复用两条路径都恰 1 条、带 taskId、排在派发消息之后', async () => {
  // spawn 路径
  const spawnHarness = makeHintHarness()
  const spawned = await dispatchReady(dispatchState([task('t1')]), spawnHarness.deps)
  const spawnHints = userHints(spawned.state, 't1')
  assert.equal(spawned.started.length, 1, 'spawn 路径必须真的派发')
  assert.equal(spawnHints.length, 1, 'spawn 路径：无指针任务必须提醒恰好一次')
  assert.ok(spawnHints[0]?.body.includes('path:line'), '提醒必须点名 path:line')
  assert.equal(spawnHints[0]?.toMemberId, undefined, '给用户的提醒不是给成员的直达消息')
  const spawnDispatch = dispatchMessageOf(spawned.state)
  assert.ok(spawnDispatch, 'spawn 路径必须先落一条派发消息')
  assert.ok(spawned.state.messages.indexOf(spawnHints[0]!) > spawned.state.messages.indexOf(spawnDispatch))
  spawnHarness.dispose()

  // 复用路径：t1 已完成，t2 复用 t1 的 idle 成员
  const reuseHarness = makeHintHarness()
  reuseHarness.deps.listMembers = async () => [{ id: 'm-old', name: 'dev-t1', status: 'idle' }]
  const reuseBinding: MemberBinding = { taskId: 't1', roleId: 'dev', memberId: 'm-old', name: 'dev-t1', spawnedAt: R31_NOW }
  const reused = await dispatchReady(
    dispatchState([task('t1', { status: 'done' }), task('t2', { dependsOn: ['t1'] })], { bindings: [reuseBinding] }),
    reuseHarness.deps,
  )
  assert.deepEqual(reused.started, ['t2'], '复用路径必须真的派发')
  assert.equal(reuseHarness.spawned.length, 0, '前置条件：t2 必须走复用而不是新建成员')
  assert.equal(reuseHarness.sent.length, 1, '前置条件：任务卡必须真的发给复用成员')
  const reuseHints = userHints(reused.state, 't2')
  assert.equal(reuseHints.length, 1, '复用路径：无指针任务同样必须提醒恰好一次')
  assert.ok(reuseHints[0]?.body.includes('path:line'))
  assert.equal(reuseHints[0]?.toMemberId, undefined)
  const reuseDispatch = dispatchMessageOf(reused.state)
  assert.ok(reuseDispatch, '复用路径必须先落一条派发消息')
  assert.ok(reused.state.messages.indexOf(reuseHints[0]!) > reused.state.messages.indexOf(reuseDispatch))

  // 同形：两条路径的提醒句式逐字一致，只有任务 id 不同。
  assert.equal(
    reuseHints[0]?.body.replace('t2', 't1'),
    spawnHints[0]?.body,
    'spawn 与复用的提示必须是同一句话（共用 appendMissingPointerHint，不得各写一份）',
  )
  reuseHarness.dispose()
})

test('③ 软提示不重复：rework 重派后同一 taskId 的 captain→user 恒为 1 条', async () => {
  const h = makeHintHarness()
  const first = await dispatchReady(dispatchState([task('t1')]), h.deps)
  assert.equal(userHints(first.state, 't1').length, 1, '前置条件：首次派发已提醒')

  const reworked = applyReceipt(first.state, 't1', { verdict: 'rework' }, R31_NOW + 1)
  assert.equal(reworked.plan.tasks[0]?.attempts, 1, '前置条件：attempts 已 +1')
  const again = await dispatchReady(reworked, h.deps)
  assert.deepEqual(again.started, ['t1'], '返工任务必须能重新派发')
  assert.equal(userHints(again.state, 't1').length, 1, 'rework 重派不得再刷一条提示')
  h.dispose()
})
