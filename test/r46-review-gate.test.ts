/**
 * r46 / t4：人工验收闸门（review）全链路回归。
 *
 * 覆盖：策略判定（code/all/off × writeScopes）、门禁通过落 review（写域不释放、下游仍 blocked）、
 * 验收 pass→done、fail→rework、原作者自验拒绝、review 态回执拒绝且不重跑门禁、
 * 14 态 × 4 动作矩阵逐格一致、自动召集幂等。
 *
 * 纪律：每条断言先问「把实现改回错误版本会不会红」——
 *  - 状态迁移一律接**真 applyReceipt**（不是 mock 语义），并用**真 RunsStore** 读回落盘结论；
 *  - 「不释放写域」用 `scopeHoldersOf` + 释放通知 messageId 断言，不用「没有 done」这种间接判据；
 *  - 「下游仍 blocked」同时断言任务状态与 `readyTasks` 口径，M3（review 算满足）会两处都红；
 *  - 「不重跑门禁」用带副作用的验收命令（touch 一个文件）验真未执行，而不是只看拒绝码。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  GateEvidence,
  MemberBinding,
  Plan,
  PlanTask,
  Role,
  TaskStatus,
} from '../src/shared/types.ts'
import { createBridge, type Bridge, type BridgeDeps } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { createSettingsRepo, type SettingsRepo } from '../src/host/settings.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { depSatisfied, readyTasks } from '../src/host/plan/graph.ts'
import { scopeHoldersOf } from '../src/host/team/scope-locks.ts'
import {
  REVIEW_CONVENE_COOLDOWN_MS,
  applyReceipt as applyReceiptReal,
  conveneReviewers,
  needsReviewOf,
  resetReviewConveneState,
  type ReviewConveneDeps,
} from '../src/host/team/dispatch.ts'
import {
  TASK_ACTION_ALLOW,
  TASK_STATUS_LABELS,
  taskActionAllowed,
  taskActionDisabledReason,
  type TaskActionName,
} from '../src/shared/task-actions.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r46'
const RUN = 'run-r46'
const SRC_SCOPE = 'src/host/bridge.ts'

/* ───────────────────────────── 夹具 ───────────────────────────── */

interface Calls {
  dispatch: number
  sent: Array<{ memberId: string; text: string }>
}

interface Harness {
  dir: string
  store: RunsStore
  roles: ReturnType<typeof createRoleRepo>
  settings: SettingsRepo
  bridge: Bridge
  deps: BridgeDeps
  calls: Calls
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

function bindingOf(over: Partial<MemberBinding> = {}): MemberBinding {
  return { taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW + 1000, ...over }
}

function evidenceOf(exitCode = 0): GateEvidence {
  return { taskId: 't1', command: 'exit 0', exitCode, tail: '', artifacts: [], at: NOW - 1000 }
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

/** 一条已通过门禁、等待人工验收的任务。 */
function reviewedTask(over: Partial<PlanTask> = {}): PlanTask {
  return taskOf('t1', {
    status: 'review',
    memberId: 'member-1',
    writeScopes: [SRC_SCOPE],
    evidence: evidenceOf(0),
    review: { verdict: 'pass', at: NOW - 500, by: 'gate', reasons: ['门禁通过（退出码 0），等待人工验收'] },
    ...over,
  })
}

function setup(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r46-'))
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
  const calls: Calls = { dispatch: 0, sent: [] }

  const deps: BridgeDeps = {
    store,
    roles,
    settingsRepo: settings,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    // 真 applyReceipt：本文件要验的就是状态机自己的出口，不是桩的语义。
    applyReceipt: (state, taskId, receipt, now, maxAttempts) =>
      applyReceiptReal(state, taskId, receipt, now, maxAttempts),
    // 调用方 stub：review 分支会调一次自动召集，这里只计数，不改任何任务状态。
    dispatch: async () => {
      calls.dispatch += 1
      return { started: [], skipped: [], errors: [] }
    },
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    sendMessage: async (memberId, text) => {
      calls.sent.push({ memberId, text })
      return { ok: true }
    },
    gate: { cwd: dir, artifactsDir },
    now: () => NOW,
  }

  return { dir, store, roles, settings, bridge: createBridge(deps), deps, calls }
}

async function enable(bridge: Bridge): Promise<void> {
  const result = await bridge.act(SESSION, { type: 'toggle', enabled: true })
  assert.equal(result.rejected, undefined, '启用动作本身不应被拒')
}

function taskOfState(state: RunState | null | undefined, id: string): PlanTask {
  const task = state?.plan.tasks.find((item) => item.id === id)
  assert.ok(task, `状态里必须有任务 ${id}`)
  return task
}

/* ───────────────────── ① 策略判定（纯函数 + 接真门禁） ───────────────────── */

test('① needsReviewOf：code 只看 src/ 写域、all 一律、off 一律不验（缺省按 code）', () => {
  const srcTask = taskOf('t1', { writeScopes: [SRC_SCOPE] })
  const docTask = taskOf('t2', { writeScopes: ['docs/teamflow/x.md'] })
  const noScope = taskOf('t3')

  for (const policy of ['code', undefined] as const) {
    assert.equal(needsReviewOf(srcTask, policy), true, 'code/缺省：src/ 写域必须验收')
    assert.equal(needsReviewOf(docTask, policy), false, 'code/缺省：纯文档改动不占人工验收')
    assert.equal(needsReviewOf(noScope, policy), false, 'code/缺省：无写域不验收')
  }
  assert.equal(needsReviewOf(srcTask, 'all'), true, 'all：src/ 要验')
  assert.equal(needsReviewOf(docTask, 'all'), true, 'all：文档也要验')
  assert.equal(needsReviewOf(noScope, 'all'), true, 'all：无写域也要验')
  for (const task of [srcTask, docTask, noScope]) {
    assert.equal(needsReviewOf(task, 'off'), false, 'off：一律不验（旧行为）')
  }

  // 边界：归一化只认路径边界，不做子串匹配（`srcfoo` 不是 src/ 写域）。
  assert.equal(needsReviewOf(taskOf('t4', { writeScopes: ['./src/'] }), 'code'), true, './src/ 归一化后命中')
  assert.equal(needsReviewOf(taskOf('t5', { writeScopes: ['src'] }), 'code'), true, '裸 src 也算 src/ 写域')
  assert.equal(needsReviewOf(taskOf('t6', { writeScopes: ['srcfoo/x.ts'] }), 'code'), false, 'srcfoo 不得被子串误判')
  assert.equal(
    needsReviewOf(taskOf('t7', { writeScopes: ['docs/a.md', 'src/x.ts'] }), 'code'),
    true,
    '多写域任一命中即要验',
  )
})

test('①b 三档策略接真门禁：code 只拦 src/、all 一律、off 全放行（落盘一致）', async () => {
  const cases = [
    { policy: 'code', scopes: [SRC_SCOPE], want: 'review' },
    { policy: 'code', scopes: ['docs/teamflow/x.md'], want: 'done' },
    { policy: 'all', scopes: ['docs/teamflow/x.md'], want: 'review' },
    { policy: 'off', scopes: [SRC_SCOPE], want: 'done' },
  ] as const

  for (const item of cases) {
    const h = setup()
    const saved = h.settings.save({ reviewPolicy: item.policy })
    assert.equal(saved.ok, true, `reviewPolicy=${item.policy} 必须能落盘`)
    await enable(h.bridge)
    h.store.save(
      stateOf({
        plan: planOf({
          tasks: [
            taskOf('t1', {
              status: 'running',
              memberId: 'member-1',
              writeScopes: [...item.scopes],
              evidence: undefined,
            }),
          ],
        }),
        bindings: [bindingOf()],
      }),
    )

    const result = await h.bridge.act(SESSION, { type: 'receipt', taskId: 't1' })
    assert.equal(result.rejected, undefined, `${item.policy}/${item.scopes.join(',')} 不应被拒`)
    const label = `${item.policy}/${item.scopes.join(',')}`
    assert.equal(result.snapshot.tasks[0]?.status, item.want, `${label} 快照状态`)
    assert.equal(h.store.load(RUN)?.plan.tasks[0]?.status, item.want, `${label} 落盘状态`)
    assert.equal(h.store.load(RUN)?.plan.tasks[0]?.evidence?.exitCode, 0, `${label} 证据退出码`)
  }
})

/* ─────────────── ② 门禁通过 → review：写域不释放、下游仍 blocked ─────────────── */

test('② 门禁 exit 0 落 review：写域保持占用、等待者不唤醒、下游仍 blocked', async () => {
  const h = setup()
  await enable(h.bridge)
  h.store.save(
    stateOf({
      plan: planOf({
        tasks: [
          taskOf('t1', { status: 'running', memberId: 'member-1', writeScopes: [SRC_SCOPE] }),
          taskOf('t2', {
            status: 'waiting',
            dependsOn: ['t1'],
            writeScopes: [SRC_SCOPE],
            waitingOn: ['t1'],
            waitReason: '等待 t1 释放 src/host/bridge.ts',
          }),
          taskOf('t3', { status: 'blocked', dependsOn: ['t1'], writeScopes: ['test/x.test.ts'] }),
        ],
      }),
      bindings: [bindingOf()],
    }),
  )

  const result = await h.bridge.act(SESSION, { type: 'receipt', taskId: 't1' })
  assert.equal(result.rejected, undefined)

  const saved = h.store.load(RUN) ?? assert.fail('真 RunsStore 必须能读回落盘状态')
  const t1 = taskOfState(saved, 't1')
  assert.equal(t1.status, 'review', '门禁通过且策略要求验收 → 必须是 review，不是 done')
  assert.equal(t1.review?.verdict, 'pass', '门禁这一票先记为 pass')
  assert.equal(t1.review?.by, 'gate', '门禁自动进入待验收，判定者必须是 gate')
  assert.equal(t1.evidence?.exitCode, 0, 'review 必须保留门禁证据')

  // 写域：review 仍是持有者；等待者没被唤醒，也没有释放通知。
  assert.deepEqual(
    scopeHoldersOf(saved).map((holder) => holder.taskId),
    ['t1'],
    'review 必须继续持有写域（验收的就是这一版代码）',
  )
  const t2 = taskOfState(saved, 't2')
  assert.equal(t2.status, 'waiting', '等待者不得被放回待办')
  assert.deepEqual(t2.waitingOn, ['t1'], '等待对象仍是待验收的 t1')
  assert.equal(
    saved.messages.some((message) => (message.messageId ?? '').startsWith('rel-t1-t2')),
    false,
    'review 不是终态：不得写写域释放通知',
  )

  // 下游：任务状态仍 blocked，且依赖口径（readyTasks）不认 review。
  assert.equal(taskOfState(saved, 't3').status, 'blocked', '下游必须保持阻塞')
  assert.deepEqual(readyTasks(saved.plan.tasks), [], 'review 不算依赖满足，不得有可派发任务')
  // 依赖口径锁死：即使下游已经被放到 pending（例如历史脏数据/别的路径写入），
  // depSatisfied(review) 也必须为 false —— 这是 M3 变异（review 算满足）的专属红线。
  assert.equal(depSatisfied('review'), false, 'review 不是满足态')
  assert.deepEqual(
    readyTasks([...saved.plan.tasks, taskOf('t9', { status: 'pending', dependsOn: ['t1'] })]),
    [],
    '待验收任务不得让下游进入可派发集合',
  )
  assert.equal(result.snapshot.tasks.find((task) => task.id === 't1')?.status, 'review', '快照同口径')
})

/* ───────────────────────── ③ 验收 pass → done ───────────────────────── */

test('③ 验收 pass → done + review.verdict=pass（真 applyReceipt 落盘，下游解锁 pending）', async () => {
  const h = setup()
  await enable(h.bridge)
  h.store.save(
    stateOf({
      plan: planOf({
        tasks: [reviewedTask(), taskOf('t2', { status: 'blocked', dependsOn: ['t1'], writeScopes: ['test/x.ts'] })],
      }),
      bindings: [bindingOf()],
    }),
  )

  const reasons = ['边界用例已补', 'build 已过']
  const result = await h.bridge.act(SESSION, { type: 'reviewTask', taskId: 't1', verdict: 'pass', reasons })
  assert.equal(result.rejected, undefined)

  const saved = h.store.load(RUN) ?? assert.fail('验收结论必须落盘')
  const t1 = taskOfState(saved, 't1')
  assert.equal(t1.status, 'done', 'pass 必须收口为 done')
  assert.equal(t1.review?.verdict, 'pass')
  assert.equal(t1.review?.by, 'user', '面板/人下结论，判定者不是 gate')
  assert.deepEqual(t1.review?.reasons, reasons, '验收理由必须逐条保留')
  assert.equal(t1.evidence?.exitCode, 0, '验收不得抹掉门禁证据')
  assert.equal(taskOfState(saved, 't2').status, 'pending', 'done 后下游必须解锁为 pending')
  assert.equal(result.snapshot.tasks.find((task) => task.id === 't1')?.status, 'done', '快照与落盘一致')
})

/* ───────────────────────── ④ 验收 fail → rework ───────────────────────── */

test('④ 验收 fail → rework + attempts+1 + 理由回发原作者，下游不 ready', async () => {
  const h = setup()
  await enable(h.bridge)
  h.store.save(
    stateOf({
      plan: planOf({
        tasks: [
          reviewedTask({ attempts: 0 }),
          taskOf('t2', { status: 'blocked', dependsOn: ['t1'], writeScopes: ['test/x.ts'] }),
        ],
      }),
      bindings: [bindingOf()],
    }),
  )

  const reasons = ['缺少失败路径用例', '未验证 reviewPolicy=off']
  const result = await h.bridge.act(SESSION, { type: 'reviewTask', taskId: 't1', verdict: 'fail', reasons })
  assert.equal(result.rejected, undefined)

  const saved = h.store.load(RUN) ?? assert.fail('验收结论必须落盘')
  const t1 = taskOfState(saved, 't1')
  assert.equal(t1.status, 'rework', 'fail 必须打回返工')
  assert.equal(t1.attempts, 1, '打回一次 attempts 必须 +1（由 applyReceipt 唯一写点负责）')
  assert.equal(t1.review?.verdict, 'fail')
  assert.deepEqual(t1.review?.reasons, reasons)

  // 返工要求走既有直达消息通道回原作者，理由逐条出现。
  assert.equal(h.calls.sent.length, 1, '必须恰发一条返工消息')
  assert.equal(h.calls.sent[0]?.memberId, 'member-1', '必须发回原作者')
  assert.match(h.calls.sent[0]?.text ?? '', /打回返工/)
  for (const reason of reasons) {
    assert.ok((h.calls.sent[0]?.text ?? '').includes(reason), `返工消息必须带理由：${reason}`)
  }

  // 下游保持阻塞：rework 不是 done，readyTasks 不得出现 t2。
  assert.equal(taskOfState(saved, 't2').status, 'blocked', '下游不得被打回动作解锁')
  // rework 的 t1 自己可以被重派（那是返工通道）；t2 不能因为 t1 是 rework 就变成可派发。
  assert.equal(readyTasks(saved.plan.tasks).includes('t2'), false, 'rework 不算依赖满足')
  assert.equal(depSatisfied('review'), false, 'review 不算依赖满足（M3 红线）')
})

/* ───────────────────── ⑤ 原作者不能验自己写的任务 ───────────────────── */

test('⑤ 原作者验自己的任务 → BAD_REQUEST、不写 review、任务仍在 review', async () => {
  const h = setup()
  await enable(h.bridge)
  h.store.save(stateOf({ plan: planOf({ tasks: [reviewedTask()] }), bindings: [bindingOf()] }))
  const before = h.store.load(RUN)
  assert.ok(before)

  const result = await h.bridge.act(
    SESSION,
    { type: 'reviewTask', taskId: 't1', verdict: 'pass', reasons: ['我说好就是好'] },
    undefined,
    { memberId: 'member-1' },
  )
  assert.equal(result.rejected?.code, 'BAD_REQUEST', '作者自验必须硬拒')
  assert.match(result.rejected?.message ?? '', /不能验自己写的任务/)

  const saved = h.store.load(RUN) ?? assert.fail('被拒后状态必须仍可读')
  const t1 = taskOfState(saved, 't1')
  assert.equal(t1.status, 'review', '被拒后任务仍在待验收（不落任何结论）')
  assert.equal(t1.review?.by, 'gate', '被拒不得覆盖门禁票')
  assert.equal(
    (t1.review?.reasons ?? []).includes('我说好就是好'),
    false,
    '被拒的结论理由不得写进 review',
  )
  assert.deepEqual(saved, before, '被拒动作不得产生任何落盘变化')
})

/* ───────────────── ⑥ review 态回执：拒绝且不重跑门禁 ───────────────── */

test('⑥ review 态再提回执 → BAD_REQUEST，且门禁一次都不执行（无副作用文件）', async () => {
  const h = setup()
  await enable(h.bridge)
  const marker = join(h.dir, 'gate-rerun.marker')
  assert.equal(existsSync(marker), false)
  h.store.save(
    stateOf({
      plan: planOf({
        tasks: [reviewedTask({ acceptance: `touch ${marker}; exit 0` })],
      }),
      bindings: [bindingOf()],
    }),
  )
  const before = h.store.load(RUN)
  assert.ok(before)

  const result = await h.bridge.act(SESSION, { type: 'receipt', taskId: 't1' })
  assert.equal(result.rejected?.code, 'BAD_REQUEST', '验收态不是门禁重入点')
  assert.match(result.rejected?.message ?? '', /验收中/)
  assert.equal(existsSync(marker), false, '验收态不得重跑门禁（验收命令的副作用不得发生）')
  assert.deepEqual(h.store.load(RUN), before, '被拒后状态与证据逐字不变')
})

/* ───────────────── ⑦ 14 态 × 4 动作 = 56 格逐格一致 ───────────────── */

test('⑦ 矩阵 14 态 × 4 动作 = 56 格：允许位与禁用原因逐格一致，review 行按设计', () => {
  const statuses = Object.keys(TASK_STATUS_LABELS) as TaskStatus[]
  const actions: TaskActionName[] = ['cancel', 'skip', 'edit-acceptance', 'pause']
  const keyOf: Record<TaskActionName, 'cancel' | 'skip' | 'acceptance' | 'pause'> = {
    cancel: 'cancel',
    skip: 'skip',
    'edit-acceptance': 'acceptance',
    pause: 'pause',
  }

  assert.equal(statuses.length, 14, '状态必须是 14 个（review 已加入）')
  assert.equal(new Set(statuses).size, 14, '状态标签不得重复')
  assert.ok(statuses.includes('review'), '14 态必须包含 review')

  let cells = 0
  for (const status of statuses) {
    const row = TASK_ACTION_ALLOW[status]
    assert.ok(row, `${status} 在 TASK_ACTION_ALLOW 里缺行`)
    assert.deepEqual(Object.keys(row).sort(), ['acceptance', 'cancel', 'pause', 'skip'], `${status} 必须是 4 列`)
    for (const action of actions) {
      const expected = row[keyOf[action]]
      assert.equal(typeof expected, 'boolean', `${status}/${action} 必须是显式布尔格`)
      assert.equal(taskActionAllowed(action, status), expected, `${status}/${action} 允许位与表不一致`)
      const reason = taskActionDisabledReason(action, status)
      assert.equal(reason === '', expected, `${status}/${action} 禁用原因必须与允许位相反`)
      if (!expected) assert.ok(reason.trim().length > 0, `${status}/${action} 被拒必须有可读原因`)
      cells += 1
    }
  }
  assert.equal(cells, 56, '必须覆盖 14 × 4 = 56 格')

  // review 行（r42）：取消/跳过/改验收允许，暂停拒绝且文案点名出路。
  assert.equal(TASK_ACTION_ALLOW.review.cancel, true)
  assert.equal(TASK_ACTION_ALLOW.review.skip, true)
  assert.equal(TASK_ACTION_ALLOW.review.acceptance, true)
  assert.equal(TASK_ACTION_ALLOW.review.pause, false)
  assert.match(taskActionDisabledReason('pause', 'review'), /验收中.*先打回或取消/)
})

/* ─────────────────── ⑧ 自动召集幂等：同一批只发一条 ─────────────────── */

test('⑧ 召集幂等：同一批待验任务只发一条消息、只建一个人、不改任务状态', async () => {
  resetReviewConveneState()
  const h = setup()
  const state = stateOf({
    plan: planOf({
      tasks: [
        taskOf('t1', { status: 'review', writeScopes: [SRC_SCOPE], evidence: evidenceOf(0) }),
        taskOf('t2', { status: 'review', writeScopes: ['test/x.ts'], evidence: evidenceOf(0) }),
      ],
    }),
  })
  const spawned: string[] = []
  const sent: Array<{ memberId: string; text: string }> = []
  const deps: ReviewConveneDeps = {
    roles: h.roles,
    spawn: async (input) => {
      spawned.push(input.name)
      return { ok: true, memberId: 'qa-review-1' }
    },
    buildPrompt: () => 'prompt',
    listMembers: async () => [],
    sendMessage: async (memberId, text) => {
      sent.push({ memberId, text })
      return { ok: true }
    },
    now: () => NOW,
    hostMembers: [],
  }

  const first = await conveneReviewers(state, deps)
  assert.ok(first.convened, '首次出现 review 必须召集')
  assert.equal(first.convened?.created, true, '没有 qa 成员时按角色新建')
  assert.deepEqual(first.convened?.taskIds, ['t1', 't2'], '必须一次带全部待验任务')
  assert.equal(first.convened?.memberId, 'qa-review-1')
  assert.equal(spawned.length, 1, '只建一个人')
  assert.equal(sent.length, 1, '同一批只发一条消息')
  assert.match(sent[0]?.text ?? '', /待验收任务（2 个）/)
  assert.match(sent[0]?.text ?? '', /t1/)
  assert.match(sent[0]?.text ?? '', /t2/)
  assert.match(sent[0]?.text ?? '', /门禁退出码 0/, '批量消息要带门禁退出码')
  assert.equal(first.state.bindings.length, 1, '新建成员必须落 binding 供身份解析')
  assert.equal(first.state.bindings[0]?.roleId, 'qa')
  assert.equal(first.state.messages.length, 1, '账本恰一条（队长 → QA）')
  assert.deepEqual(
    first.state.plan.tasks.map((task) => task.status),
    ['review', 'review'],
    '召集只发言、绝不改任务状态',
  )

  // 同批再进：不发消息、不再建人、账本不增（即使任务顺序变了，签名按 id 排序仍同批）。
  const reordered: RunState = {
    ...first.state,
    plan: { ...first.state.plan, tasks: [...first.state.plan.tasks].reverse() },
  }
  const second = await conveneReviewers(reordered, deps)
  assert.equal(second.skipped, 'COOLDOWN', '同一批必须命中幂等/冷却')
  assert.equal(sent.length, 1, '第二次不得再发消息')
  assert.equal(spawned.length, 1, '第二次不得再建人')
  assert.equal(second.state.messages.length, 1, '第二次不得再写账本')

  // 复用优先：已有活着的 qa 成员时不建第二个人。
  resetReviewConveneState()
  const withQa: RunState = {
    ...state,
    bindings: [{ taskId: 't1', roleId: 'qa', memberId: 'qa-9', name: 'qa-9', spawnedAt: NOW }],
  }
  const reused = await conveneReviewers(withQa, deps)
  assert.ok(reused.convened)
  assert.equal(reused.convened?.created, false, '已有 qa 成员必须复用')
  assert.equal(reused.convened?.memberId, 'qa-9')
  assert.equal(spawned.length, 1, '复用时不得新建成员')
  assert.equal(sent.length, 2, '新的一批（reset 后）才允许再发一条')

  // 冷却常量是设计的一部分：5 分钟；测试只需确认它被用上（签名不同且在窗口内 → 冷却）。
  assert.equal(REVIEW_CONVENE_COOLDOWN_MS, 5 * 60 * 1000)
})
