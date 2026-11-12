/**
 * r24 / t4 回归：历史列表 5s memo 的「写后失效」。
 *
 * 背景：`bridge.historyOf` 为面板 2 秒一刷做了 5 秒 memo，但落盘后从不失效 —— `closeRun`
 * 成功返回（服务端已 terminated）之后，紧接的历史列表仍可能显示旧状态，最长 5 秒。
 *
 * 断言口径（每条都问过「改回错误实现会不会红」）：
 *  - closeRun：先 `snapshot()` 占满 memo，再终止；同一时刻的 `snapshot().runs` 必须已经
 *    `terminated` 且带 `terminationReason`。把 invalidation 删掉 → 这条读到 memo 里的 `draft`，红。
 *  - 外部写入口：直接 `store.save()`（模拟 dispatch / applyReceipt / watcher 的写路径），
 *    同样必须立刻反映。只在 `bridge.saveState` 里清 memo 的实现过不了这条。
 *  - 不退化：无写盘时两次快照只读一次 `list()`；只改 usage 的 `historyNeutral` 写盘也不失效
 *    （否则正在跑的 run 每个 2 秒轮询帧都会全量读盘）；真正改状态的写盘才失效。
 *  - 写失败（非法 runId）不推进版本号：版本号表示「盘上真的变了」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridge, type Bridge } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import type { Plan, PlanTask } from '../src/shared/types.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-t4'
const RUN = 'run-t4'

function taskOf(id: string, status: PlanTask['status']): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: `exit ${id}`, status }
}

function stateOf(over: Partial<RunState> = {}, plan: Partial<Plan> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: {
      runId: RUN,
      sessionId: SESSION,
      createdAt: NOW - 60 * 60_000,
      status: 'draft',
      tasks: [taskOf('t1', 'pending')],
      maxConcurrent: 3,
      ...plan,
    },
    plannedAt: NOW - 60 * 60_000,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...over,
  }
}

/** 数 `list()` 调用次数的真 store（只覆写读口，写盘仍走父类）。 */
class CountingStore extends RunsStore {
  listCalls = 0

  override list(): ReturnType<RunsStore['list']> {
    this.listCalls += 1
    return super.list()
  }
}

interface Harness {
  dir: string
  store: RunsStore
  bridge: Bridge
}

function createHarness(store?: RunsStore, dir?: string): Harness {
  const root = dir ?? mkdtempSync(join(tmpdir(), 'auto-team-t4-'))
  const runs = store ?? new RunsStore(join(root, 'runs'))
  const roles = createRoleRepo({ dir: join(root, 'roles'), now: () => NOW })
  roles.seed()
  // 种子数据必须在 createBridge 之前落盘（与 r24 的自动对账时序一致）。
  const bridge = createBridge({
    store: runs,
    roles,
    memoryRoots: { publicDir: join(root, 'memory-public'), projectDir: join(root, 'memory-project') },
    dataRoot: join(root, 'data'),
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    applyReceipt: (state) => state,
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: root, artifactsDir: join(root, 'artifacts') },
    now: () => NOW,
  })
  bridge.setEnabled(SESSION, true)
  return { dir: root, store: runs, bridge }
}

test('closeRun：先占满历史 memo，终止后紧接的快照立即是 terminated + reason', async () => {
  const h = createHarness()
  try {
    h.store.save(stateOf())
    // 先在 5 秒窗口内建立 memo（真实面板一进页面就会这样）。
    const before = h.bridge.snapshot(SESSION)
    assert.equal(before.runs?.[0]?.status, 'draft')
    assert.equal(before.runs?.[0]?.terminationReason, undefined)

    const result = await h.bridge.act(SESSION, { type: 'closeRun', runId: RUN })
    assert.equal(result.rejected, undefined)
    assert.equal(result.unchanged, undefined)

    // act 返回的快照与下一次独立快照都必须看到新状态（同一 now，仍在 5 秒窗口内）。
    assert.equal(result.snapshot.runs?.[0]?.status, 'terminated')
    assert.equal(result.snapshot.runs?.[0]?.terminationReason, '用户终止残留计划')

    const after = h.bridge.snapshot(SESSION)
    assert.equal(after.runs?.[0]?.status, 'terminated')
    assert.equal(after.runs?.[0]?.terminationReason, '用户终止残留计划')
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

test('外部写入口（直接 store.save）同样让历史 memo 失效：不只在 saveState 里清', () => {
  const h = createHarness()
  try {
    h.store.save(stateOf())
    assert.equal(h.bridge.snapshot(SESSION).runs?.[0]?.status, 'draft')

    // 模拟 dispatch / watcher / tools 的写路径：它们直接拿 deps.store.save，不经过 bridge。
    h.store.save(
      stateOf(
        {
          finishedAt: NOW,
          termination: { kind: 'cancelled', reason: '外部写入口落盘' },
        },
        { status: 'cancelled' },
      ),
    )

    const after = h.bridge.snapshot(SESSION)
    assert.equal(after.runs?.[0]?.status, 'cancelled', '任何落盘都应让历史缓存立即失效')
    assert.equal(after.runs?.[0]?.terminationReason, '外部写入口落盘')
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})

test('不退化：无写盘 / historyNeutral 写盘都保留 5s 合并读，改状态的写盘才失效', () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-t4-count-'))
  const store = new CountingStore(join(root, 'runs'))
  const h = createHarness(store, root)
  try {
    h.store.save(stateOf())
    // 第一次快照读盘并建 memo。注意每次快照本身的 `latestForSession` 也会 `list()` 一次，
    // 所以用「相邻两次快照的 list 增量」做判据：命中 memo = 只多 1 次（loadState），
    // memo 失效 = 多 2 次（loadState + historyOf）。
    assert.equal(h.bridge.snapshot(SESSION).runs?.[0]?.status, 'draft')
    const base = store.listCalls

    // 无写盘：同一 5 秒窗口内再次快照必须命中 memo。
    h.bridge.snapshot(SESSION)
    assert.equal(store.listCalls - base, 1, '没有写盘时不得退化成每次全量读盘')

    // 只改 usage 的投影写盘（每个轮询帧都可能发生）：不推进 epoch、不失效 memo。
    const epochBefore = store.writeEpoch()
    store.save(
      stateOf({
        usage: {
          attribution: 'per-member',
          byMember: {},
          byTask: {},
          total: { input: 10, output: 5, total: 15 },
          updatedAt: NOW,
        },
      }),
      { historyNeutral: true },
    )
    assert.equal(store.writeEpoch(), epochBefore, 'historyNeutral 写盘不推进版本号')
    const neutralBase = store.listCalls
    h.bridge.snapshot(SESSION)
    assert.equal(store.listCalls - neutralBase, 1, 'usage 投影写盘不得打穿历史 memo')

    // 真正改状态/终止原因的写盘：版本号推进 + memo 失效。
    store.save(stateOf({ finishedAt: NOW, termination: { kind: 'stale', reason: '收口' } }, { status: 'terminated' }))
    assert.equal(store.writeEpoch(), epochBefore + 1)
    const staleBase = store.listCalls
    const after = h.bridge.snapshot(SESSION)
    assert.equal(store.listCalls - staleBase, 2, '改状态的写盘必须让历史 memo 失效（多读一次 list）')
    assert.equal(after.runs?.[0]?.status, 'terminated')
    assert.equal(after.runs?.[0]?.terminationReason, '收口')

    // 写失败（非法 runId）没有落盘，就不能推进版本号。
    const epochAfter = store.writeEpoch()
    assert.throws(() => store.save(stateOf({}, { runId: '../escape' })))
    assert.equal(store.writeEpoch(), epochAfter, '写失败不得推进版本号')
  } finally {
    rmSync(h.dir, { recursive: true, force: true })
  }
})
