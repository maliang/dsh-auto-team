/**
 * r49 / t5：召集路径的 parent 身份 + 队长判断性语义。
 *
 * 覆盖：
 *  ① `createSpawnPorts().spawn` 必须把 `agents.get(sessionId)` 返回的**活 agent 实例**作为
 *     `startActivation` 的 parent（宿主按引用相等检查，拿错实例 → UNAUTHORIZED）；缺失时回退
 *     `currentInitiator()`；两者都没有时仍报 NO_CALLER。
 *  ② 真 bridge + 真 dispatchReady 走「receipt → review → conveneReviewers → spawn」链路：
 *     断言一旦 review 任务出现就**当场**去 spawn（不是等 tick 轮询）。
 *  ③ 队长常驻段落：含「拿不准」与「开关打开时队长不得自己改代码」，旧的本仓路径白名单字样消失，
 *     段落仍 ≤2600 字符。
 *
 * 纪律：断言先问「改回错误实现会不会红」——
 *  - ① 用 `assert.equal(spec.parent, liveAgent)` 引用相等（deepEqual 会放过「同 id 另一个对象」，
 *    正是宿主 UNAUTHORIZED 的成因，所以必须严格相等）；
 *  - ② 在 `act('receipt')` 返回后**立刻**断言 spawn 次数，不加 sleep/轮询；
 *  - ③ 直接读 `src/host/prompt.ts` 源文件 grep 旧字面量，不只断言渲染结果。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Plan, PlanTask, Role } from '../src/shared/types.ts'
import type { HostContext } from '../src/host/adapters.ts'
import { createSpawnPorts } from '../src/host/adapters.ts'
import { createBridge, type Bridge, type BridgeDeps } from '../src/host/bridge.ts'
import { captainSection } from '../src/host/prompt.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { createSettingsRepo } from '../src/host/settings.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import {
  applyReceipt as applyReceiptReal,
  dispatchReady,
  resetReviewConveneState,
} from '../src/host/team/dispatch.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r49'
const RUN = 'run-r49'

/* ───────────────────────────── 夹具 ───────────────────────────── */

interface FakeHost {
  ctx: HostContext
  specs: Array<Record<string, unknown>>
}

/**
 * 最小宿主桩：`subagents` 走 `ctx.get`（生产读口），`agents.get` 返回活实例。
 * `withAgentsGet: false` 用来模拟老宿主 / 取不到活实例。
 */
function fakeHostOf(options: { live?: unknown; initiator?: unknown; withAgentsGet?: boolean }): FakeHost {
  const specs: Array<Record<string, unknown>> = []
  const agents: Record<string, unknown> = {}
  if (options.withAgentsGet !== false) {
    agents.get = (id: string) => (id === SESSION ? options.live : undefined)
  }
  if (options.initiator !== undefined) agents.currentInitiator = () => options.initiator
  const ctx = {
    agents,
    get: (name: string) =>
      name === 'subagents'
        ? {
            getProvider: (provider: string) => (provider === 'spawn' ? { name: 'spawn' } : undefined),
            startActivation: async (spec: Record<string, unknown>) => {
              specs.push(spec)
              return { childId: 'child-1', name: String(spec.name ?? '') }
            },
          }
        : undefined,
    logger: { warn: () => {} },
  } as unknown as HostContext
  return { ctx, specs }
}

function roleOf(id: string, name: string): Role {
  return { id, name, duty: `${name}的职责`, skillIds: [], builtin: false, updatedAt: NOW }
}

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'exit 0',
    status: 'pending',
    ...over,
  }
}

function planOf(over: Partial<Plan> = {}): Plan {
  return {
    runId: RUN,
    sessionId: SESSION,
    createdAt: NOW,
    status: 'dispatching',
    tasks: [taskOf('t1')],
    maxConcurrent: 3,
    ...over,
  }
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: planOf(),
    plannedAt: NOW,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...over,
  }
}

/* ───────────── ① spawn 的 parent 必须是 agents.get 的活实例 ───────────── */

test('① spawn 用 agents.get(sessionId) 的活实例作 parent（同 id 的 initiator 不算）', async () => {
  const live = { id: SESSION, kind: 'live' }
  const decoy = { id: SESSION, kind: 'decoy' }
  const { ctx, specs } = fakeHostOf({ live, initiator: decoy })

  const result = await createSpawnPorts(ctx).spawn({
    prompt: '做 t1',
    name: 'dev-t1',
    sessionId: SESSION,
    taskId: 't1',
  })

  assert.equal(result.ok, true, `spawn 应成功，实际：${result.ok ? '' : result.error}`)
  assert.equal(specs.length, 1)
  // 引用相等：deepEqual 会放过「同 id 的另一个对象」，而宿主正是按引用比较判 UNAUTHORIZED。
  assert.equal(specs[0]?.parent, live, 'parent 必须是 agents.get 返回的那个实例，而不是 currentInitiator')
  assert.notEqual(specs[0]?.parent, decoy, '不能把同 id 的另一个对象当 parent')
})

test('①b agents.get 取不到活实例时回退 currentInitiator（旧行为不丢）', async () => {
  const initiator = { id: SESSION, kind: 'initiator' }
  const { ctx, specs } = fakeHostOf({ initiator, withAgentsGet: false })

  const result = await createSpawnPorts(ctx).spawn({
    prompt: '做 t1',
    name: 'dev-t1',
    sessionId: SESSION,
    taskId: 't1',
  })

  assert.equal(result.ok, true, `回退路径也必须能派发，实际：${result.ok ? '' : result.error}`)
  assert.equal(specs[0]?.parent, initiator, 'agents.get 不可用时回退 currentInitiator')
})

test('①c 活实例与 initiator 都没有时仍报 NO_CALLER（不给假 agent）', async () => {
  const { ctx, specs } = fakeHostOf({ withAgentsGet: false })

  const result = await createSpawnPorts(ctx).spawn({
    prompt: '做 t1',
    name: 'dev-t1',
    sessionId: SESSION,
    taskId: 't1',
  })

  assert.equal(result.ok, false, '没有活跃队长会话时不得创建成员')
  if (!result.ok) assert.match(result.error, /当前没有活跃的队长会话/, '必须保持 NO_CALLER 语义')
  assert.equal(specs.length, 0, '被拒时不得调用宿主 startActivation')
})

/* ───── ② 真 bridge：receipt → review → 当场召集 → spawn ───── */

interface Chain {
  dir: string
  store: RunsStore
  bridge: Bridge
  spawns: Array<{ name: string; taskId: string }>
  sent: Array<{ memberId: string; text: string; sessionId?: string }>
  /** startActivation 收到的 spec —— 用来断言 parent 引用。 */
  specs: Array<Record<string, unknown>>
  live: { id: string }
  decoy: { id: string }
  restoreHome: () => void
}

interface SpawnInput {
  plan: Plan
  task: PlanTask
  role?: Role
  name: string
  prompt: string
}

/**
 * 真 bridge + 真 dispatchReady + 真 createSpawnPorts 的完整链路。
 * HOME 指向临时目录（任务卡要求），所有落盘根也都在临时目录下，绝不碰真实 profile。
 */
function setupChain(): Chain {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r49-'))
  const home = join(dir, 'home')
  mkdirSync(home, { recursive: true })
  const prevHome = process.env.HOME
  process.env.HOME = home
  const restoreHome = (): void => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
  }

  const store = new RunsStore(join(dir, 'runs'))
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir, now: () => NOW })
  roles.seed()
  roles.save(roleOf('dev', '开发'))
  roles.save(roleOf('qa', '测试'))
  const settings = createSettingsRepo({ file: join(dir, 'settings.json') })
  const artifactsDir = join(dir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })

  const live = { id: SESSION }
  const decoy = { id: SESSION }
  const { ctx, specs } = fakeHostOf({ live, initiator: decoy })
  const spawnPorts = createSpawnPorts(ctx)
  const spawns: Chain['spawns'] = []
  const sent: Chain['sent'] = []

  // 与 src/host/index.ts:550-570 的装配一致：把 dispatch 层的 SpawnPort 翻译成宿主 spawn 请求。
  const spawn = async (input: SpawnInput) => {
    spawns.push({ name: input.name, taskId: input.task.id })
    return spawnPorts.spawn({
      prompt: input.prompt,
      name: input.name,
      route: input.role?.model,
      sessionId: input.plan.sessionId,
      taskId: input.task.id,
    })
  }

  const dispatch = async (state: RunState) => {
    const result = await dispatchReady(state, {
      store,
      spawn,
      roles,
      buildPrompt: () => 'prompt',
      listMembers: async () => [],
      sendMessage: async (memberId, text, sessionId) => {
        sent.push({ memberId, text, sessionId })
        return { ok: true }
      },
      now: () => NOW,
    })
    return { started: result.started, skipped: result.skipped, errors: result.errors, renamed: result.renamed }
  }

  const deps: BridgeDeps = {
    store,
    roles,
    settingsRepo: settings,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(home, '.dsh', 'auto-team'),
    applyReceipt: (state, taskId, receipt, at, maxAttempts) =>
      applyReceiptReal(state, taskId, receipt, at, maxAttempts),
    dispatch,
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    sendMessage: async (memberId, text, sessionId) => {
      sent.push({ memberId, text, sessionId })
      return { ok: true }
    },
    gate: { cwd: dir, artifactsDir },
    now: () => NOW,
  }

  return { dir, store, bridge: createBridge(deps), spawns, sent, specs, live, decoy, restoreHome }
}

test('② 真 bridge：receipt 落 review 后当场走 conveneReviewers→spawn，parent 是活实例', async () => {
  resetReviewConveneState()
  const chain = setupChain()
  try {
    await chain.bridge.act(SESSION, { type: 'toggle', enabled: true })
    chain.store.save(
      stateOf({
        plan: planOf({
          tasks: [
            taskOf('t1', {
              status: 'running',
              memberId: 'member-1',
              writeScopes: ['src/host/bridge.ts'],
            }),
          ],
        }),
        bindings: [{ taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW + 1000 }],
      }),
    )

    const result = await chain.bridge.act(SESSION, { type: 'receipt', taskId: 't1' })
    assert.equal(result.rejected, undefined, `回执不应被拒：${result.rejected?.message ?? ''}`)
    assert.equal(result.snapshot.tasks[0]?.status, 'review', '门禁 exit 0 且 src/ 写域 → 待验收')

    // 关键：不加 sleep / 不轮询 —— act 返回时召集已经完成（bridge.ts:3140 显式推了一把 dispatch）。
    assert.equal(chain.spawns.length, 1, 'review 一出现就必须当场 spawn 验收成员，不得等 tick')
    assert.match(chain.spawns[0]?.name ?? '', /^qa-review-/, '召集出来的是 QA 验收成员')
    assert.ok(chain.sent.length >= 1, '召集后必须把待验收清单发给 QA')
    assert.equal(chain.sent.at(-1)?.sessionId, SESSION, '发消息要带队长会话 id（后台链路取活 caller 用）')

    // parent 身份：这是宿主 UNAUTHORIZED 的判据。
    assert.equal(chain.specs.length, 1, '链路末端必须真的调用了宿主 startActivation')
    assert.equal(chain.specs[0]?.parent, chain.live, '召集路径的 parent 必须是 agents.get 的活实例')
    assert.notEqual(chain.specs[0]?.parent, chain.decoy, '不能拿 currentInitiator 的另一个对象当 parent')
    assert.equal(chain.store.load(RUN)?.plan.tasks[0]?.status, 'review', '状态已落盘（不是只改了快照）')
  } finally {
    chain.restoreHome()
  }
})

/* ───────────── ③ 队长段落：判断性语义 + 无旧白名单 ───────────── */

test('③ 队长段落含「拿不准」与「开关打开时不得自己改代码」，旧路径白名单字样为 0', async () => {
  const chain = setupChain()
  try {
    const section = captainSection({ bridge: chain.bridge }, SESSION)
    assert.match(section, /拿不准/, '必须有「拿不准一律按代码处理」的判断性语义')
    assert.match(section, /开关打开时队长不得自己改代码/, '必须重申开关打开时队长不得自己动手')
    assert.ok(section.length <= 2600, `常驻段落预算 ≤2600 字符，实际 ${section.length}`)

    // 旧白名单字样必须从队长提示词的**正文**里消失。源文件的历史注释（prompt.ts:58-62 记录
    // 旧版为何被推翻）不进入模型上下文，不算提示词正文，所以先剥注释再扫；渲染结果另扫一遍。
    const source = readFileSync(new URL('../src/host/prompt.ts', import.meta.url), 'utf8')
    const prose = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const token of ['src/** test/**', 'pnpm-lock.yaml', 'cordis.patch.yml', '.github/workflows/**', 'scripts/**']) {
      assert.equal(prose.includes(token), false, `队长提示词正文里不得再出现旧白名单字样：${token}`)
      assert.equal(section.includes(token), false, `渲染出的段落里不得出现旧白名单字样：${token}`)
    }
    // 反向守卫：新语义必须锚在「会被构建/运行/测试」上，而不是路径长相。
    assert.match(section, /会被构建\/运行\/测试/, '判据必须是与仓库无关的语义规则')
  } finally {
    chain.restoreHome()
  }
})
