/**
 * r47 t2 回归：跳转身份的**四种真实形态**逐个断言「不串」并给人话原因。
 *
 * 四种形态（都从宿主真实投影 `membersOf` 出发，再交给客户端唯一判定 `memberJumpOf`）：
 *   ① 同角色多任务：dev 名下两个成员各接一个任务 —— 任务行只能跳到承接自己的那个；
 *   ② 成员复用：同一 memberId 挂两条 binding（旧任务已 retired、新任务在跑）——
 *      旧任务靠 `taskIds` 全集仍能跳回该成员，不能因 `taskId` 只指向新任务而跳到别人；
 *   ③ 成员已退役：完全回收（retired 无 stoppedAt）→ 不可跳且不得回退到同角色别人；
 *      确认停止（retired + stoppedAt）→ 保留「已停止」位，仍可跳去看会话；
 *   ④ 任务无成员：该任务没有任何 binding —— 不可跳、不得回退到同角色其它任务的成员。
 *
 * 断言原则：先问「把实现改回错误版本，这条会不会红」。本文件配 `r47-jump-identity-probes.mjs`
 * 做变异验证：P1 恢复旧回退、P2 只认单 taskId、P3 宿主不补 taskIds、P4 不过滤已回收成员，
 * 四条补丁都必须让本文件变红（见 QA-REPORT §变异探针）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MemberBinding, MemberView, Plan, PlanTask, Role } from '../src/shared/types.ts'
import { createBridge, type BridgeDeps } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import {
  MEMBER_JUMP_NO_MEMBER_REASON,
  MEMBER_JUMP_NO_MEMBER_TEXT,
  MEMBER_JUMP_NO_ROLE_REASON,
  memberJumpOf,
  roleCardMultiMemberReasonOf,
  taskJumpLabelOf,
} from '../src/client/viewmodel.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r47-t2'

function roleOf(id: string, name: string): Role {
  return { id, name, duty: `${name}的职责`, skillIds: [], builtin: false, updatedAt: NOW }
}

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: 'exit 0', status: 'pending', ...over }
}

function bindingOf(over: Partial<MemberBinding> = {}): MemberBinding {
  return { taskId: 't1', roleId: 'dev', memberId: 'm1', name: '开发-1', spawnedAt: NOW + 1000, ...over }
}

function planOf(over: Partial<Plan> = {}): Plan {
  return { runId: 'run-r47-t2', sessionId: SESSION, createdAt: NOW, status: 'dispatching', tasks: [taskOf('t1')], maxConcurrent: 3, ...over }
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return { version: RUN_STATE_VERSION, plan: planOf(), plannedAt: NOW, messages: [], bindings: [], routeAudits: [], ...over }
}

/** 只造 membersOf 需要的依赖；其余端口给最小桩（本文件不触发派发/门禁）。 */
function setup(): { store: RunsStore; bridge: ReturnType<typeof createBridge> } {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r47-t2-'))
  const store = new RunsStore(join(dir, 'runs'))
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir, now: () => NOW })
  roles.seed()
  roles.save(roleOf('dev', '开发'))
  roles.save(roleOf('qa', '测试'))
  const artifactsDir = join(dir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })

  const deps: BridgeDeps = {
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: false }),
    applyReceipt: (state, taskId) => ({
      ...state,
      plan: { ...state.plan, tasks: state.plan.tasks.map((task) => (task.id === taskId ? { ...task, status: 'done' } : task)) },
    }),
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir },
    now: () => NOW,
  }
  return { store, bridge: createBridge(deps) }
}

function memberById(members: readonly MemberView[], memberId: string): MemberView {
  const member = members.find((item) => item.memberId === memberId)
  assert.ok(member, `快照里必须有成员 ${memberId}（实际：${members.map((item) => item.memberId).join('、') || '空'}）`)
  return member
}

/** 断言这条任务行跳到 `memberId`，且该成员名下确实包含这条任务（不串的机械判据）。 */
function assertJumpTo(members: readonly MemberView[], taskId: string, roleId: string, memberId: string): void {
  const jump = memberJumpOf({ kind: 'task', roleId, taskId }, members, { label: taskJumpLabelOf(taskId) })
  assert.equal(jump.available, true, `${taskId} 应当可跳（${jump.reason}）`)
  assert.equal(jump.memberId, memberId, `${taskId} 必须跳到承接它的 ${memberId}，不得串到同角色其它任务的成员`)
  assert.ok(
    (jump.member?.taskIds ?? []).includes(taskId),
    `${memberId}.taskIds 必须包含 ${taskId}（实际 ${JSON.stringify(jump.member?.taskIds)}），否则判定与投影漂移`,
  )
}

/* ───────────────── ① 同角色多任务：各跳各的，不按「最近活跃」串 ───────────────── */

test('r47 t2 ① 同角色多任务：两个 dev 成员各接一任务，任务行各跳各的，角色卡因歧义不跳', () => {
  const { store, bridge } = setup()
  store.save(
    stateOf({
      plan: planOf({
        tasks: [
          taskOf('t1', { status: 'done', memberId: 'm1' }),
          taskOf('t2', { status: 'running', memberId: 'm2' }),
        ],
      }),
      // m2 更晚创建：旧实现按「running → 最近活跃」会把它当成 t1 的落点。
      bindings: [
        bindingOf({ taskId: 't1', memberId: 'm1', name: '开发-1', spawnedAt: NOW + 1000 }),
        bindingOf({ taskId: 't2', memberId: 'm2', name: '开发-2', spawnedAt: NOW + 2000 }),
      ],
    }),
  )
  const members = bridge.snapshot(SESSION).members
  assert.equal(members.length, 2, '两个成员各占一行')
  assert.deepEqual(memberById(members, 'm1').taskIds, ['t1'])
  assert.deepEqual(memberById(members, 'm2').taskIds, ['t2'])

  assertJumpTo(members, 't1', 'dev', 'm1')
  assertJumpTo(members, 't2', 'dev', 'm2')

  // 角色卡只有 roleId，名下两个成员时猜谁都是乱跳 —— 必须给「请从任务行进入」的人话原因。
  const roleJump = memberJumpOf({ kind: 'role', roleId: 'dev' }, members, { label: '角色：开发' })
  assert.equal(roleJump.available, false, '同角色多成员时角色卡不得按最近活跃猜一个')
  assert.equal(roleJump.memberId, undefined, '不可跳时不得下发 memberId')
  assert.equal(roleJump.reason, roleCardMultiMemberReasonOf(2))
  assert.equal(roleJump.reason, '该角色有 2 个子智能体，请从任务行进入')
  assert.match(roleJump.title, /请从任务行进入/, '悬停要说明该往哪走')
  assert.match(roleJump.label, /^角色：开发，该角色有 2 个子智能体，请从任务行进入$/)
})

/* ───────────────── ② 成员复用：一个 memberId 挂两条 binding ───────────────── */

test('r47 t2 ② 成员复用：旧任务已 retired、新任务在跑，旧任务仍跳回同一成员，任务行按 taskIds 全集定位', () => {
  const { store, bridge } = setup()
  store.save(
    stateOf({
      plan: planOf({
        tasks: [
          taskOf('t1', { status: 'done', memberId: 'm1' }),
          taskOf('t2', { status: 'running', memberId: 'm1' }),
        ],
      }),
      // 现实形态：复用后旧 binding 被标 retired（无 stoppedAt，保留审计），新 binding 在跑。
      bindings: [
        bindingOf({ taskId: 't1', memberId: 'm1', name: '开发-1', spawnedAt: NOW + 1000, retired: true }),
        bindingOf({ taskId: 't2', memberId: 'm1', name: '开发-1', spawnedAt: NOW + 2000 }),
      ],
    }),
  )
  const members = bridge.snapshot(SESSION).members
  assert.equal(members.length, 1, '同一 memberId 只占一行')
  const member = members[0]
  assert.equal(member?.memberId, 'm1')
  assert.equal(member?.taskId, 't2', 'taskId 仍是当前 binding 的任务（展示语义不变）')
  assert.deepEqual(member?.taskIds, ['t1', 't2'], 'taskIds 必须收集该成员名下全部任务（含已 retired 的旧 binding）')

  // 旧任务 t1 不在 member.taskId 上，只能靠 taskIds 命中；只认单值就会「不可跳」或串到别人。
  assertJumpTo(members, 't1', 'dev', 'm1')
  assertJumpTo(members, 't2', 'dev', 'm1')
  const roleJump = memberJumpOf({ kind: 'role', roleId: 'dev' }, members)
  assert.equal(roleJump.available, true, '该角色只有一个成员时角色卡可跳，不该被「多人歧义」误伤')
  assert.equal(roleJump.memberId, 'm1')
})

/* ───────────────── ③ 成员已退役：完全回收 / 确认停止两种事实位 ───────────────── */

test('r47 t2 ③ 成员已退役（完全回收）：旧任务要么跳回原成员、要么不可跳，任何情况都不回退到同角色别人', () => {
  // 形态 a：真实盘面（retired 且 task.memberId 仍在）—— legacy 兜底行仍指向原 memberId，
  // 任务行必须跳到 m1 本人，而不是更晚创建、正在跑的同角色 m2。
  const withLegacy = setup()
  withLegacy.store.save(
    stateOf({
      plan: planOf({
        tasks: [
          taskOf('t1', { status: 'done', memberId: 'm1' }),
          taskOf('t2', { status: 'running', memberId: 'm2' }),
        ],
      }),
      // m1 完全回收：retired 且无 stoppedAt → 绑定行不展示；m2 同角色仍在跑。
      bindings: [
        bindingOf({ taskId: 't1', memberId: 'm1', name: '开发-1', retired: true }),
        bindingOf({ taskId: 't2', memberId: 'm2', name: '开发-2', spawnedAt: NOW + 2000 }),
      ],
    }),
  )
  const members = withLegacy.bridge.snapshot(SESSION).members
  // 已知展示缺口（ROOT-CAUSE §Q4）：legacy 兜底会把成员名换成角色名、状态取自任务；
  // 身份（memberId/taskIds）仍是对的，这里只锁「落到谁」，展示失真单列进 QA 报告的建议栏。
  assert.deepEqual(memberById(members, 'm1').taskIds, ['t1'], 'legacy 兜底行也必须带上名下的任务全集')
  const kept = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, members, { label: taskJumpLabelOf('t1') })
  assert.equal(kept.available, true, '旧任务的承接成员仍可寻址（会话 id 没丢），不该被同角色别人顶替')
  assert.equal(kept.memberId, 'm1', '必须跳回原成员 m1；跳到 running 的 m2 就是身份串台')
  assert.notEqual(kept.memberId, 'm2')

  // 形态 b：合成退役变体（ROOT-CAUSE §Q4 的 SYNTH_RETIRE：标 retired + 清 task.memberId）——
  // 两个身份源都没了，正确行为是「不可跳 + 人话原因」，绝不回退到同角色别人。
  const withoutLegacy = setup()
  withoutLegacy.store.save(
    stateOf({
      plan: planOf({
        tasks: [taskOf('t1', { status: 'done' }), taskOf('t2', { status: 'running', memberId: 'm2' })],
      }),
      bindings: [
        bindingOf({ taskId: 't1', memberId: 'm1', name: '开发-1', retired: true }),
        bindingOf({ taskId: 't2', memberId: 'm2', name: '开发-2', spawnedAt: NOW + 2000 }),
      ],
    }),
  )
  const gone = withoutLegacy.bridge.snapshot(SESSION).members
  assert.deepEqual(gone.map((item) => item.memberId), ['m2'], '两个身份源都清掉后，已回收成员不得被投影复活')

  const lost = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, gone, { label: taskJumpLabelOf('t1') })
  assert.equal(lost.available, false, '任务 t1 的成员已回收：不能把同角色 m2 当成它的落点（那会打开别人的会话）')
  assert.equal(lost.memberId, undefined)
  assert.equal(lost.reason, MEMBER_JUMP_NO_MEMBER_REASON)
  assert.equal(lost.reason, '该任务还没有可跳转的成员：可能尚未派发，或成员已回收')
  assert.match(lost.reason, /成员已回收/, '原因必须解释「为什么点不动」，不能只说没有成员')
  assert.match(lost.title, /该任务还没有可跳转的成员/)
})

test('r47 t2 ③ 成员已退役（确认停止）：保留「已停止」位，任务仍可跳去看会话', () => {
  const { store, bridge } = setup()
  store.save(
    stateOf({
      plan: planOf({ tasks: [taskOf('t1', { status: 'done', memberId: 'm1' })] }),
      // 确认停止：retired + stoppedAt → 宿主保留一行 status='stopped'，会话仍可查看。
      bindings: [bindingOf({ taskId: 't1', memberId: 'm1', name: '开发-1', retired: true, stoppedAt: NOW + 5000 })],
    }),
  )
  const members = bridge.snapshot(SESSION).members
  assert.equal(members.length, 1)
  assert.equal(members[0]?.status, 'stopped')
  assert.equal(members[0]?.stoppedAt, NOW + 5000)
  assert.deepEqual(members[0]?.taskIds, ['t1'], '已停止成员的 binding 也要进 taskIds 全集')

  assertJumpTo(members, 't1', 'dev', 'm1')
})

/* ───────────────── ④ 任务无成员：一律不可跳，不借同角色别人 ───────────────── */

test('r47 t2 ④ 任务无成员：未派发任务不可跳，绝不回退同角色其它任务的成员，给「未派发/已回收」人话原因', () => {
  const { store, bridge } = setup()
  store.save(
    stateOf({
      plan: planOf({
        tasks: [
          taskOf('t2', { status: 'running', memberId: 'm2' }),
          taskOf('t3', { status: 'pending' }),
        ],
      }),
      // 同角色 m2 在跑别的任务：旧实现会把它当成 t3 的落点。
      bindings: [bindingOf({ taskId: 't2', memberId: 'm2', name: '开发-2' })],
    }),
  )
  const members = bridge.snapshot(SESSION).members
  assert.equal(members.length, 1)
  assert.deepEqual(memberById(members, 'm2').taskIds, ['t2'], 't3 不在任何成员名下')

  const jump = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't3' }, members, { label: taskJumpLabelOf('t3') })
  assert.equal(jump.available, false, '未派发任务伪装成可跳会让用户点开别人的会话')
  assert.equal(jump.memberId, undefined)
  assert.equal(jump.reason, MEMBER_JUMP_NO_MEMBER_REASON)
  assert.equal(jump.actionText, MEMBER_JUMP_NO_MEMBER_TEXT, '按钮文案也要说「未派发」，不能是可点样式')
  assert.match(jump.title, /该任务还没有可跳转的成员：可能尚未派发，或成员已回收/)
  assert.match(jump.label, /该任务还没有可跳转的成员/)

  // 流程图节点与任务行同一判定：节点带 roleId 也不回退别人。
  const node = memberJumpOf({ kind: 'node', roleId: 'dev', taskId: 't3' }, members)
  assert.equal(node.available, false)
  assert.equal(node.memberId, undefined)

  // 连角色都没有的节点：给「没有记录角色」的原因，而不是静默（与上面两种情况区分开）。
  const orphan = memberJumpOf({ kind: 'node', taskId: 't3' }, members)
  assert.equal(orphan.available, false)
  assert.equal(orphan.reason, MEMBER_JUMP_NO_ROLE_REASON)
  assert.match(orphan.reason, /没有记录角色/)
})

/* ───────── 全局不混：四种形态混在一张快照里，逐任务/逐角色都不串 ───────── */

test('r47 t2 总回归：四种形态同在一张快照，逐任务断言落点归属，逐角色断言歧义不跳', () => {
  const { store, bridge } = setup()
  store.save(
    stateOf({
      plan: planOf({
        tasks: [
          taskOf('a1', { status: 'done', memberId: 'ma' }),
          taskOf('a2', { status: 'running', memberId: 'mb' }),
          taskOf('b1', { status: 'done', memberId: 'mc' }),
          taskOf('b2', { status: 'running', memberId: 'mc' }),
          // 形态 c（合成退役变体）：成员已回收，task.memberId 也已清掉 —— 两个身份源都没了。
          taskOf('c1', { status: 'done' }),
          taskOf('d1', { status: 'pending' }),
        ],
      }),
      bindings: [
        bindingOf({ taskId: 'a1', memberId: 'ma', name: '开发-1' }),
        bindingOf({ taskId: 'a2', memberId: 'mb', name: '开发-2' }),
        bindingOf({ taskId: 'b1', memberId: 'mc', name: '开发-3', retired: true }),
        bindingOf({ taskId: 'b2', memberId: 'mc', name: '开发-3', spawnedAt: NOW + 2000 }),
        bindingOf({ taskId: 'c1', memberId: 'md', name: '开发-4', retired: true }),
      ],
    }),
  )
  const members = bridge.snapshot(SESSION).members
  const expected: Array<[taskId: string, memberId: string]> = [
    ['a1', 'ma'],
    ['a2', 'mb'],
    ['b1', 'mc'],
    ['b2', 'mc'],
  ]
  for (const [taskId, memberId] of expected) assertJumpTo(members, taskId, 'dev', memberId)

  // d1 无成员（同角色 ma/mb/mc 都在）：必须不可跳。
  const d1 = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 'd1' }, members)
  assert.equal(d1.available, false)
  assert.equal(d1.reason, MEMBER_JUMP_NO_MEMBER_REASON)

  // c1 的成员已完全回收 → 不可跳。
  const c1 = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 'c1' }, members)
  assert.equal(c1.available, false)
  assert.equal(c1.reason, MEMBER_JUMP_NO_MEMBER_REASON)
  assert.equal(c1.memberId, undefined)

  // dev 名下还有 ma/mb/mc 三个成员：角色卡一律不跳，原因里的数字要跟成员数一致。
  const roleJump = memberJumpOf({ kind: 'role', roleId: 'dev' }, members)
  assert.equal(roleJump.available, false)
  assert.equal(roleJump.reason, roleCardMultiMemberReasonOf(3))
  assert.equal(roleJump.reason, '该角色有 3 个子智能体，请从任务行进入')

  // 机械不变量：任何「可跳」的任务行，落点成员的 taskIds 必须包含该任务。
  for (const task of ['a1', 'a2', 'b1', 'b2', 'c1', 'd1']) {
    const jump = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: task }, members)
    if (jump.available) {
      assert.ok(
        (jump.member?.taskIds ?? []).includes(task),
        `${task} 的可跳落点 ${jump.memberId} 名下并不包含它：${JSON.stringify(jump.member?.taskIds)}`,
      )
    } else {
      assert.equal(jump.memberId, undefined, `${task} 不可跳时仍下发了 memberId=${jump.memberId}`)
      assert.ok((jump.reason ?? '').length > 0, `${task} 不可跳时必须给人话原因`)
    }
  }
})
