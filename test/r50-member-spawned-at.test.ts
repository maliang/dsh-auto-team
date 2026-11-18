/**
 * r50 / t4：`snapshot().members[].spawnedAt` 的宿主侧透传判据（行为断言，不靠 typecheck）。
 *
 * 为什么需要这个文件：`MemberView.spawnedAt?: number` 是可选字段，`pnpm typecheck` 只能证明
 * 客户端读的类型存在，证明不了桥真的把 `binding.spawnedAt` 透传出来、也证明不了 legacy
 * 兜底成员**没有**这个键（键缺席 ≠ 值为 undefined —— 客户端按 `in` 判断「有没有这个事实」）。
 *
 * 断言反向验证（改回错误实现会不会红）：
 *  - 用例 1：把 `spawnedAt: binding.spawnedAt` 删掉 → 取到 `undefined`，`equal(…, SPAWNED_AT)` 红；
 *    把它改成 `plannedAt` / `lastEventAt` → 两者都刻意取得与 SPAWNED_AT 不同，仍然红。
 *  - 用例 2：把 legacy 分支写成 `spawnedAt: task.evidence?.at` / `spawnedAt: state.plannedAt`
 *    甚至 `spawnedAt: undefined` → `'spawnedAt' in member` 变 true，`equal(…, false)` 红。
 *
 * 夹具都是真的：真 `RunsStore`（落盘再 load）+ 真 `createBridge`（deps 只注入端口桩），
 * 不走 `membersOf` 的私有入口，判据落在面板真正消费的 `snapshot()` 上。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Plan, PlanTask, Role } from '../src/shared/types.ts'
import { createBridge, type Bridge, type BridgeDeps } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r50'
const PLANNED_AT = NOW - 5_000
const SPAWNED_AT = NOW - 2_000
/** 比 spawnedAt 更晚的消息活动：用来证明 spawnedAt 不是拿 lastEventAt 冒充的。 */
const MESSAGE_AT = NOW - 1_000

interface Harness {
  store: RunsStore
  bridge: Bridge
}

function roleOf(id: string, name: string): Role {
  return { id, name, duty: `${name}的职责`, skillIds: [], builtin: false, updatedAt: NOW }
}

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: 'exit 0', status: 'pending', ...over }
}

function planOf(tasks: PlanTask[]): Plan {
  return { runId: 'run-r50', sessionId: SESSION, createdAt: PLANNED_AT, status: 'dispatching', tasks, maxConcurrent: 3 }
}

function setup(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r50-'))
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
    // 固定时钟：避免 createBridge 的对账把 NOW-5s 的测试计划判成「残留」。
    now: () => NOW,
  }
  return { store, bridge: createBridge(deps) }
}

test('带 binding 的成员：spawnedAt 逐字等于 binding.spawnedAt，不拿 plannedAt/lastEventAt 冒充', () => {
  const { store, bridge } = setup()
  const state: RunState = {
    version: RUN_STATE_VERSION,
    plan: planOf([taskOf('t1', { status: 'running', memberId: 'member-1' })]),
    plannedAt: PLANNED_AT,
    messages: [
      { at: MESSAGE_AT, from: 'captain', to: '开发-1', toMemberId: 'member-1', body: '开工' },
    ],
    bindings: [{ taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: SPAWNED_AT }],
    routeAudits: [],
  }
  store.save(state)

  const member = bridge.snapshot(SESSION).members.find((item) => item.memberId === 'member-1')
  assert.ok(member, '带 binding 的成员必须出现在快照 members 里')
  assert.equal(member.spawnedAt, SPAWNED_AT, 'spawnedAt 必须逐字来自 binding.spawnedAt')
  // 另两个候选时间都与 SPAWNED_AT 不同：上面那条 equal 才能证明来源唯一。
  assert.equal(member.lastEventAt, MESSAGE_AT, '夹具前提：lastEventAt 已被消息前移到 MESSAGE_AT')
  assert.notEqual(SPAWNED_AT, PLANNED_AT)
  assert.notEqual(SPAWNED_AT, MESSAGE_AT)
})

test('legacy 成员（只有 task.memberId、没有 binding）：「spawnedAt」键必须缺席，而不是 undefined', () => {
  const { store, bridge } = setup()
  const state: RunState = {
    version: RUN_STATE_VERSION,
    plan: planOf([taskOf('t1', { status: 'running', memberId: 'legacy-member-1' })]),
    plannedAt: PLANNED_AT,
    messages: [],
    bindings: [],
    routeAudits: [],
  }
  store.save(state)

  const member = bridge.snapshot(SESSION).members.find((item) => item.memberId === 'legacy-member-1')
  assert.ok(member, 'legacy 兜底成员必须出现在快照 members 里')
  // 关键：客户端用 `in` 判断「这个事实在不在」，`spawnedAt: undefined` 也会让 in 为 true。
  assert.equal('spawnedAt' in member, false, 'legacy 成员不得带 spawnedAt 键（缺席而非 undefined）')
})
