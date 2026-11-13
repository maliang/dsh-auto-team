/**
 * r34 QA：宿主侧 `RunSummary.liveMembers` 的计算（`src/host/bridge.ts#liveMemberCountOf`）。
 *
 * 客户端「确认没有存活成员才提示残留」依赖这一格的三态语义，字段本身错一位就会把提示挂反：
 *  - 没有未退休 binding   → **0**（确实没人，字段必须存在；0 是事实，不是缺省）；
 *  - 有 alive 成员        → **>0**（宿主 4 态归一后 `alive` 才算，retired / dead 不算）；
 *  - 名单读失败 / 无读口  → **字段缺失**（不知道 ≠ 0）；
 *  - 整批 run             → 一次快照只读**一次**名单（计数器断言），绝不 per-run 读盘。
 *
 * 为什么必须计数：`historyOf` 是每次快照都跑的，如果实现写成 per-run 调 `listMembers()`，
 * 面板 2 秒一刷 + 50 个 run 会把宿主成员服务打爆；这条只有计数器能抓住。
 * 「改回错误实现会红」见 `test/r34-mutation-probes.mjs` 的 P3（未知写成 0 → ③ 红）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridge, type Bridge, type BridgeDeps } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import type { HostMember } from '../src/host/team/watcher.ts'
import type { MemberBinding, Plan, PlanTask, RunSummary } from '../src/shared/types.ts'

const NOW = 1_760_000_000_000
const SESSION = 'sess-r34-host'

function planTaskOf(id: string, status: PlanTask['status']): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: 'exit 0', status }
}

function planOf(runId: string): Plan {
  return {
    runId,
    sessionId: SESSION,
    createdAt: NOW - 300_000,
    status: 'dispatching',
    tasks: [planTaskOf('t1', 'running')],
    maxConcurrent: 3,
  }
}

function bindingOf(
  taskId: string,
  memberId: string,
  name: string,
  extra: Partial<MemberBinding> = {},
): MemberBinding {
  // plannedAt（NOW-120s）必须早于首个 binding 的 spawnedAt（AC-30）。
  return { taskId, roleId: 'dev', memberId, name, spawnedAt: NOW - 60_000, ...extra }
}

function stateOf(runId: string, bindings: MemberBinding[]): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: planOf(runId),
    plannedAt: NOW - 120_000,
    messages: [],
    bindings,
    routeAudits: [],
  }
}

interface HarnessOptions {
  members?: HostMember[]
  /** 名单读口同步抛错（模拟宿主会话服务不可用）。 */
  listMembersThrows?: boolean
  /** 完全不给名单读口（旧装配 / 单测桩）。 */
  omitReader?: boolean
  seed?: (store: RunsStore) => void
}

interface Harness {
  dir: string
  store: RunsStore
  bridge: Bridge
  calls: () => number
  resetCalls: () => void
  advance: (ms: number) => void
  settle: () => Promise<void>
}

function createHarness(options: HarnessOptions = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r34-'))
  const store = new RunsStore(join(dir, 'runs'))
  // 种子必须在 createBridge 之前落盘：装配期会做一次残留对账与名单预热。
  options.seed?.(store)
  let clock = NOW
  const roles = createRoleRepo({ dir: join(dir, 'roles'), now: () => clock })
  roles.seed()
  let calls = 0
  const deps: BridgeDeps = {
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    applyReceipt: (state) => state,
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
    now: () => clock,
  }
  if (options.omitReader !== true) {
    deps.listMembers = () => {
      calls += 1
      if (options.listMembersThrows === true) throw new Error('宿主会话服务不可用')
      return Promise.resolve(options.members ?? [])
    }
  }
  const bridge = createBridge(deps)
  bridge.setEnabled(SESSION, true)
  return {
    dir,
    store,
    bridge,
    calls: () => calls,
    resetCalls: () => {
      calls = 0
    },
    advance: (ms) => {
      clock += ms
    },
    // 名单读盘是异步的（`refreshMemberRoster` 的 then 回调），等一个宏任务再断言。
    settle: async () => {
      await new Promise((resolve) => setImmediate(resolve))
    },
  }
}

function snapshotRuns(h: Harness): RunSummary[] {
  return h.bridge.snapshot(SESSION).runs ?? []
}

function rowOf(h: Harness, runId: string): RunSummary {
  const row = snapshotRuns(h).find((item) => item.runId === runId)
  assert.ok(row, `${runId} 必须在历史列表里（否则下面的断言没有对象）`)
  return row
}

// ---------------------------------------------------------------------------
// ① 无 binding → 0
// ---------------------------------------------------------------------------

test('r34 宿主 ① 没有任何成员绑定 → liveMembers=0 且字段存在（「确实没人」不是缺省）', async () => {
  const h = createHarness({
    members: [{ id: 'm-any', name: 'dev-any', status: 'running' }],
    seed: (store) => store.save(stateOf('run-empty', [])),
  })
  try {
    await h.settle()
    const row = rowOf(h, 'run-empty')
    assert.equal('liveMembers' in row, true, '没有 binding 也必须显式给 0，不能留空')
    assert.equal(row.liveMembers, 0)
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ② 有 alive → >0（retired / dead 不算）
// ---------------------------------------------------------------------------

test('r34 宿主 ② 有 binder 且宿主判 alive → liveMembers>0；retired 与 dead 一律不算', async () => {
  const h = createHarness({
    members: [
      { id: 'm-alive', name: 'dev-1', status: 'running' },
      { id: 'm-retired', name: 'dev-0', status: 'running' },
      { id: 'm-dead', name: 'dev-2', status: 'inactive' },
    ],
    seed: (store) =>
      store.save(
        stateOf('run-mixed', [
          bindingOf('t1', 'm-alive', 'dev-1'),
          // 已退休的绑定即使宿主那一行还是 running，也不得算存活。
          bindingOf('t0', 'm-retired', 'dev-0', { retired: true }),
          // 未退休但宿主判 inactive（dead）也不是存活。
          bindingOf('t2', 'm-dead', 'dev-2'),
        ]),
      ),
  })
  try {
    await h.settle()
    const row = rowOf(h, 'run-mixed')
    assert.equal(row.liveMembers, 1, '只应数到 1 个 alive；retired / inactive 都要排除')
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ③ 读失败 / 无读口 → 字段缺失（绝不是 0）
// ---------------------------------------------------------------------------

test('r34 宿主 ③ 名单读失败或没有读口 → liveMembers 字段缺失，不得写成 0', async () => {
  const seed = (store: RunsStore): void => {
    store.save(stateOf('run-has-binding', [bindingOf('t1', 'm1', 'dev-1')]))
  }

  const threw = createHarness({ listMembersThrows: true, seed })
  try {
    await threw.settle()
    const row = rowOf(threw, 'run-has-binding')
    assert.equal('liveMembers' in row, false, '读失败时字段必须缺席（不知道）')
    assert.notEqual(row.liveMembers, 0, '0 会被客户端读成「确实没人」，读失败不能冒充 0')
  } finally {
    rmSync(threw.dir, { recursive: true, force: true })
  }

  const absent = createHarness({ omitReader: true, seed })
  try {
    await absent.settle()
    const row = rowOf(absent, 'run-has-binding')
    assert.equal('liveMembers' in row, false, '没有读口时字段同样必须缺席')
    assert.notEqual(row.liveMembers, 0)
  } finally {
    rmSync(absent.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ④ 整批 run 只读一次名单 + 各自计数独立 + 不落盘
// ---------------------------------------------------------------------------

test('r34 宿主 ④ 一次快照的整批 run 只调一次 listMembers（计数器），计数各自独立且不落盘', async () => {
  const h = createHarness({
    members: [
      { id: 'm1', name: 'dev-1', status: 'running' },
      { id: 'm2', name: 'dev-2', status: 'provisioning' },
      { id: 'm3', name: 'dev-3', status: 'inactive' },
    ],
    seed: (store) => {
      store.save(stateOf('run-none', []))
      store.save(stateOf('run-one', [bindingOf('t1', 'm1', 'dev-1')]))
      store.save(
        stateOf('run-two', [bindingOf('t1', 'm2', 'dev-2'), bindingOf('t2', 'm3', 'dev-3')]),
      )
    },
  })
  try {
    // 装配期预热已经读过一次；从「面板这一帧」开始计数。
    await h.settle()
    h.resetCalls()

    // 越过 1.5s 名单 TTL，逼出一次真实重读：三条 run 必须共用这一次结果。
    h.advance(2_000)
    snapshotRuns(h)
    assert.equal(h.calls(), 1, '一次快照的整批 run 只允许一次 listMembers（不得 per-run 读盘）')

    await h.settle()
    const rows = snapshotRuns(h)
    assert.equal(h.calls(), 1, 'TTL 内的下一次快照不得再读名单')
    assert.equal(rows.length, 3, '三条 run 都必须在历史列表里')

    const byId = new Map(rows.map((row) => [row.runId, row]))
    assert.equal(byId.get('run-none')?.liveMembers, 0, '无 binding = 0')
    assert.equal(byId.get('run-one')?.liveMembers, 1, '1 个 alive')
    assert.equal(byId.get('run-two')?.liveMembers, 1, 'alive 1 个 + inactive 1 个 → 只数 alive')

    // 视图字段不落盘：run 文件里不得出现 liveMembers（每次读取现算）。
    const stored = h.store.load('run-one')
    assert.equal(stored === null ? false : 'liveMembers' in stored, false, 'liveMembers 不得落盘')
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})
