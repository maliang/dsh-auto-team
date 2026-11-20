/**
 * r60 CAS 加固验收（QA）：验 r59 D1/D2 是否**真的**修好，而不是「save 被调过」。
 *
 * 判定纪律（r60 QA 任务卡）：
 *  - ① 行为层：act 在**锁内 load 之后、save 之前**遭遇一次外部写盘（另一个写者直接落盘），
 *       断言 act 仍成功 —— 只有「显式 expectRev + 锁内重读重试」都在才会绿；裸 save 会静默重基、
 *       去掉重试会直接抛 StaleWriteError。
 *  - ② 同一时序下，外部写者的**其它字段必须存活**（不许只保版本号、把对方内容抹掉）。
 *       这是「CAS 只防版本号、没防丢更新」的判定位：不成立就如实红，不放宽断言。
 *  - ③ D2：给 dispatchReady 传一份「相对盘上已过期」的快照，断言盘上多出来的字段没被覆盖。
 *  - ④ 守卫：生产调用方必须走 saveWithCas，不得再有绕过 CAS 的裸 `deps.store.save(`。
 *
 * 变异验证（人工，见 QA-REPORT）：把 expectRev 去掉 ②/③ 变红；把重试去掉 ① 变红；
 * 把 dispatchReadyLocked 的 lockedSnapshot 退回入参 ③ 变红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridge, type BridgeDeps } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, StaleWriteError, type RunState } from '../src/host/store.ts'
import { applyReceipt, dispatchReady, type DispatchDeps } from '../src/host/team/dispatch.ts'
import type { MessageRecord, Plan, PlanTask, Role } from '../src/shared/types.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r60'
const RUN = 'run-t4'
/** 外部写者写入的可辨识正文：它必须活过桥的 CAS 重试。 */
const MARKER = 'r60 外部写者写入的账本标记'

function roleOf(id: string, name: string): Role {
  return { id, name, duty: `${name}的职责`, skillIds: [], builtin: false, updatedAt: NOW }
}

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: 'exit 0', status: 'pending', ...over }
}

function planOf(over: Partial<Plan> = {}): Plan {
  return {
    runId: RUN,
    sessionId: SESSION,
    createdAt: NOW,
    status: 'draft',
    tasks: [taskOf('t1')],
    maxConcurrent: 3,
    ...over,
  }
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return { version: RUN_STATE_VERSION, plan: planOf(), plannedAt: NOW, messages: [], bindings: [], routeAudits: [], ...over }
}

function markerMessage(): MessageRecord {
  return { at: NOW, from: 'captain', to: 'user', body: MARKER }
}

interface BridgeHarness {
  dir: string
  store: RunsStore
  deps: BridgeDeps
  cleanup(): void
}

function setupBridge(): BridgeHarness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r60-'))
  const store = new RunsStore(join(dir, 'runs'))
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir, now: () => NOW })
  roles.seed()
  roles.save(roleOf('dev', '开发'))
  const artifactsDir = join(dir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })

  const deps: BridgeDeps = {
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    applyReceipt: (state) => state,
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir },
    now: () => NOW,
  }
  return { dir, store, deps, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

interface Instrumented {
  proxy: RunsStore
  /** 每次写盘观察到的 options（含外部写者那一次之外的桥内写）。 */
  observed: Array<{ expectRev?: number }>
  /** 外部写盘次数 / 桥内写盘真正撞到 StaleWriteError 的次数。 */
  stats: { externalWrites: number; staleSeen: number }
}

/**
 * 包装 store：在**第一次** `save` 之前插一次外部写盘（另一个写者直接落盘一条账本）。
 *
 * 时序等价于「桥在锁内 load 之后、save 之前，锁外写者落了盘」——这是严格 CAS 唯一能暴露问题的窗口。
 * 外部写盘走内层真实 store（绕过包装），因此不会被算作桥内写。
 */
function instrument(inner: RunsStore, injectExternal: boolean): Instrumented {
  const observed: Array<{ expectRev?: number }> = []
  const stats = { externalWrites: 0, staleSeen: 0 }
  let injected = false
  const proxy = new Proxy(inner, {
    get(target, prop) {
      if (prop === 'save') {
        return (state: RunState, options?: { expectRev?: number }) => {
          if (injectExternal && !injected) {
            injected = true
            const disk = target.load(state.plan.runId)
            if (disk !== null) {
              target.save({ ...disk, messages: [...disk.messages, markerMessage()] })
              stats.externalWrites += 1
            }
          }
          observed.push({ expectRev: options?.expectRev })
          try {
            target.save(state, options)
          } catch (error) {
            if (error instanceof StaleWriteError) stats.staleSeen += 1
            throw error
          }
        }
      }
      const value = Reflect.get(target, prop, target) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  }) as RunsStore
  return { proxy, observed, stats }
}

/** 启用一次（不经过被观测的 store，避免把外部写盘注入到 toggle 上）。 */
async function enableFreshBridge(h: BridgeHarness): Promise<void> {
  const bridge = createBridge(h.deps)
  const result = await bridge.act(SESSION, { type: 'toggle', enabled: true })
  assert.equal(result.rejected, undefined, '启用动作本身不应被拒')
}

/**
 * ① 行为层（绿）：外部写盘插在锁内 load 与 save 之间，act 必须成功。
 *
 * 判据为什么有断言价值：裸 `save()` 在锁内会自动重基、不抛错，act 也会成功——所以
 * 「act 成功」单独没有价值，必须与 `staleSeen >= 1`（真的走过显式 CAS）同时断言；
 * 若把重试去掉，act 会抛 StaleWriteError，这一条直接红。
 */
test('r60 ①：act 锁内遭遇外部写盘 → 显式 CAS 触发重试，动作仍成功', async () => {
  const h = setupBridge()
  try {
    h.store.save(stateOf())
    await enableFreshBridge(h)

    const inst = instrument(h.store, true)
    const bridge = createBridge({ ...h.deps, store: inst.proxy })
    const result = await bridge.act(SESSION, { type: 'pause' })

    assert.equal(result.rejected, undefined, '外部写盘插进来之后 act 不应失败')
    assert.equal(inst.stats.externalWrites, 1, '外部写盘必须真的发生过（否则用例没测到 CAS 窗口）')
    assert.ok(inst.stats.staleSeen >= 1, '桥内写盘必须真的撞到一次 StaleWriteError（证明 expectRev 生效）')
    assert.equal(h.store.load(RUN)?.plan.status, 'paused', '重试之后本次动作必须真的落盘')
  } finally {
    h.cleanup()
  }
})

/**
 * ② 丢更新判定（任务卡补充项）：外部写者写的账本记录必须在 CAS 重试后仍然存在。
 *
 * 当前 saveWithCas 只重基 `rev`（`{ ...current, rev: fresh.rev }`），把我方整份内容写回，
 * 会把外部写者刚写的其它字段抹掉 —— 这一条按现状应当红；红了就是真缺陷，不许改断言凑绿。
 */
test('r60 ②：CAS 重试不得抹掉外部写者的其它字段（丢更新判定）', async () => {
  const h = setupBridge()
  try {
    h.store.save(stateOf())
    await enableFreshBridge(h)

    const inst = instrument(h.store, true)
    const bridge = createBridge({ ...h.deps, store: inst.proxy })
    const result = await bridge.act(SESSION, { type: 'pause' })
    assert.equal(result.rejected, undefined, '动作本身应成功')
    assert.equal(inst.stats.externalWrites, 1, '外部写盘必须真的发生过')

    const disk = h.store.load(RUN)
    assert.ok(disk, 'run 必须还在盘上')
    assert.equal(
      disk.messages.some((message) => message.body === MARKER),
      true,
      '外部写者写进盘的那条账本被 CAS 重试覆盖了 —— 只防版本号、没防丢更新',
    )
  } finally {
    h.cleanup()
  }
})

/**
 * ③ D1 的写盘口径（绿）：桥内每一次写盘都必须显式给 expectRev（数字），缺一次就退回静默重基。
 */
test('r60 ③：bridge 的每次写盘都显式带 expectRev', async () => {
  const h = setupBridge()
  try {
    h.store.save(stateOf())
    const inst = instrument(h.store, false)
    const bridge = createBridge({ ...h.deps, store: inst.proxy })
    await bridge.act(SESSION, { type: 'toggle', enabled: true })
    await bridge.act(SESSION, { type: 'pause' })

    // toggle 只写会话开关（不写 run 状态），pause 是本次唯一一次 RunState 写盘。
    assert.ok(inst.observed.length >= 1, `act 至少要落一次盘，实际 ${inst.observed.length}`)
    const bare = inst.observed.filter((options) => typeof options.expectRev !== 'number')
    assert.equal(bare.length, 0, `存在不带 expectRev 的写盘：${JSON.stringify(inst.observed)}`)
  } finally {
    h.cleanup()
  }
})

/**
 * ④ D2（绿）：dispatchReady 收到过期快照时，锁内必须重读盘上真值。
 *
 * 盘上已经收口 t1 并解锁 t2（rev 更高），入参还是 t1 pending / t2 blocked 的旧快照：
 * 不重读就会把 t2 压回 blocked、且把盘上后加的账本字段整份覆盖。
 */
test('r60 ④：dispatchReady 锁内重读盘上真值，过期快照不覆盖外部字段', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r60-dispatch-'))
  const store = new RunsStore(join(dir, 'runs'))
  try {
    const t1 = taskOf('t1')
    const t2 = taskOf('t2', { status: 'blocked', dependsOn: ['t1'] })
    const stale = stateOf({ plan: planOf({ status: 'dispatching', tasks: [t1, t2] }) })
    store.save(stale) // rev=1
    const disk = store.load(RUN)
    assert.ok(disk)
    store.save(applyReceipt(disk, 't1', { verdict: 'done' }, NOW)) // rev=2：t1 done、t2 解锁
    const afterReceipt = store.load(RUN)
    assert.ok(afterReceipt)
    store.save({ ...afterReceipt, messages: [...afterReceipt.messages, markerMessage()] }) // rev=3

    const deps: DispatchDeps = {
      store,
      roles: {
        list: () => [roleOf('dev', '开发')],
        get: (id: string) => (id === 'dev' ? roleOf('dev', '开发') : undefined),
        save: (role: Role) => ({ ok: true as const, role }),
        remove: () => ({ ok: true as const }),
        seed: () => {},
        restoreDefaults: () => ({ restored: [], kept: [] }),
      },
      buildPrompt: (input) => `你是 ${input.role?.name ?? '成员'}；任务：${input.task.title}`,
      listMembers: async () => [],
      spawn: async (input) => ({ ok: true, memberId: `m-${input.name}` }),
      hostConcurrency: () => ({ limit: 8, source: 'host' }),
      now: () => NOW,
    }

    const result = await dispatchReady(stale, deps)
    assert.deepEqual(result.started, ['t2'], '锁内重读后应只派发盘上真正就绪的 t2')

    const final = store.load(RUN)
    assert.ok(final)
    assert.equal(final.plan.tasks.find((task) => task.id === 't2')?.status, 'running', 't2 必须真的被派发')
    assert.equal(
      final.messages.some((message) => message.body === MARKER),
      true,
      '盘上后加的账本记录被过期快照覆盖了 —— 锁内没有重读',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * ⑤ 守卫（grep 级）：生产调用方不得绕过 CAS 助手直接写盘。
 */
test('r60 ⑤：生产路径使用 saveWithCas，dispatch 不得再有裸 deps.store.save(', () => {
  const bridgeSource = readFileSync(new URL('../src/host/bridge.ts', import.meta.url), 'utf8')
  const dispatchSource = readFileSync(new URL('../src/host/team/dispatch.ts', import.meta.url), 'utf8')
  assert.match(bridgeSource, /saveWithCas\(deps\.store/, 'bridge 的锁内写盘必须走 saveWithCas')
  assert.match(dispatchSource, /saveWithCas\(deps\.store/, 'dispatch 的锁内写盘必须走 saveWithCas')
  assert.equal(
    /deps\.store\.save\(/.test(dispatchSource),
    false,
    'dispatch 仍有绕过 CAS 的裸 deps.store.save(，严格 CAS 会被静默重基',
  )
})
