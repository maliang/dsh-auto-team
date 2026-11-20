/**
 * r59 写盘竞态回归（QA 独立判据，全部用**真 RunsStore + 真 createBridge**）。
 *
 * 覆盖点（对应任务卡 ①~④）：
 *  ① 同一 run 上 `reviewTask` 与 `receipt` 并发 → 两边字段都落盘，后执行者必须看到前者的写；
 *  ② 20 个并发动作 → `rev` 单调递增且等于累计落盘次数，消息账本一条不丢（无丢写）；
 *  ③ `store.save(state, { expectRev })` 不匹配 → 抛 `STALE_WRITE`，消息带 runId 与两个 rev；
 *  ④ 并发动作 5 秒内全部完成（锁可重入，动作入口不会自己锁死自己）。
 *
 * 断言设计原则：每条断言都要能「把实现改回错误版本后变红」。
 *  - ① 的红色点：去掉锁后 reviewTask 会在门禁期间读到 `t2.status='gate'` 的旧快照，
 *    然后被 receipt 的写盘整份覆盖（t1 退回 review）。
 *  - ② 的红色点：去掉锁后 20 个动作都基于同一份空账本 load→append→save，只剩最后 1 条。
 *    （只断言 rev 不够：save() 每次都从盘上重读 rev，即使丢写 rev 也会单调 +1。）
 *  - ③ 直接打 store 的 CAS，与桥无关。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GateEvidence, MemberBinding, Plan, PlanTask } from '../src/shared/types.ts'
import { createBridge, type Bridge, type BridgeDeps } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { applyReceipt as applyReceiptReal } from '../src/host/team/dispatch.ts'
import {
  RUN_STATE_VERSION,
  RunsStore,
  StaleWriteError,
  type RunState,
  type SaveOptions,
} from '../src/host/store.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r59'
const RUN_ID = 'run-r59'

/** 真 store 上加计数壳：落盘次数与每次落盘的 rev（顺序即真实写盘顺序）。 */
class CountingStore extends RunsStore {
  saves = 0
  revs: number[] = []

  override save(state: RunState, options?: SaveOptions): void {
    super.save(state, options)
    this.saves += 1
    this.revs.push(state.rev ?? 0)
  }
}

interface Harness {
  dir: string
  store: CountingStore
  bridge: Bridge
  deps: BridgeDeps
}

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: 'exit 0', status: 'pending', ...over }
}

function bindingOf(over: Partial<MemberBinding> = {}): MemberBinding {
  return { taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW + 1000, ...over }
}

function evidenceOf(taskId: string, command: string, exitCode: number): GateEvidence {
  return { taskId, command, exitCode, tail: '', artifacts: [], at: NOW }
}

function planOf(over: Partial<Plan> = {}): Plan {
  return { runId: RUN_ID, sessionId: SESSION, createdAt: NOW, status: 'draft', tasks: [taskOf('t1')], maxConcurrent: 3, ...over }
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return { version: RUN_STATE_VERSION, plan: planOf(), plannedAt: NOW, messages: [], bindings: [], routeAudits: [], ...over }
}

function setup(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r59-'))
  const store = new CountingStore(join(dir, 'runs'))
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir, now: () => NOW })
  const artifactsDir = join(dir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })

  const deps: BridgeDeps = {
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    // 本文件只验写盘竞态，不验派发语义：端口一律无副作用，避免给 rev 计数掺入额外写盘。
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: false }),
    applyReceipt: (state, taskId, receipt, at, maxAttempts) =>
      applyReceiptReal(state, taskId, receipt, at ?? NOW, maxAttempts),
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: dir, artifactsDir },
    now: () => NOW,
  }

  return { dir, store, bridge: createBridge(deps), deps }
}

async function enable(bridge: Bridge): Promise<void> {
  const result = await bridge.act(SESSION, { type: 'toggle', enabled: true })
  assert.equal(result.rejected, undefined, '启用动作本身不应被拒')
}

/** 轮询等待文件出现（门禁子进程写标记用）；超时直接抛，避免测试挂死。 */
async function waitForFile(path: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`等待文件超时：${path}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** 给可能死锁的 promise 加硬超时：死锁时测试失败而不是把整个 test 进程挂住。 */
async function within<T>(ms: number, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`超过 ${ms}ms 未完成（疑似同一把锁死锁）`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

test('① reviewTask 与 receipt 并发：两边字段都落盘，后执行者看到前者的写（不得互相抹掉）', async () => {
  const h = setup()
  await enable(h.bridge)
  const gateStart = join(h.dir, 'gate-start.txt')
  h.store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [
          taskOf('t1', { status: 'review', memberId: 'member-1', evidence: evidenceOf('t1', 'exit 0', 0) }),
          taskOf('t2', {
            status: 'running',
            memberId: 'member-2',
            acceptance: `: > '${gateStart}'; sleep 0.3; exit 0`,
          }),
        ],
      }),
      bindings: [
        bindingOf({ taskId: 't1', memberId: 'member-1', name: '开发-1' }),
        bindingOf({ taskId: 't2', memberId: 'member-2', name: '测试-1' }),
      ],
    }),
  )

  // receipt 先进门禁（此时它持有该 run 的锁），再在同一 run 上下验收结论。
  const receiptP = h.bridge.act(SESSION, { type: 'receipt', taskId: 't2' })
  await waitForFile(gateStart)
  const reviewP = h.bridge.act(
    SESSION,
    { type: 'reviewTask', taskId: 't1', verdict: 'pass', reasons: ['回归通过，允许完成'] },
    undefined,
    { memberId: 'member-2' },
  )
  const [review, receipt] = await within(5000, Promise.all([reviewP, receiptP]))

  assert.equal(review.rejected, undefined, `reviewTask 被拒：${review.rejected?.message ?? ''}`)
  assert.equal(receipt.rejected, undefined, `receipt 被拒：${receipt.rejected?.message ?? ''}`)

  const final = h.store.load(RUN_ID)
  assert.ok(final !== null)
  const t1 = final.plan.tasks.find((task) => task.id === 't1')
  const t2 = final.plan.tasks.find((task) => task.id === 't2')
  assert.ok(t1 !== undefined && t2 !== undefined)

  // 两边字段都必须留在盘上：先写的（receipt 的 gate 状态）不能被后写的整份覆盖，
  // 后写的（review 的结论）也不能被 receipt 的终态写盘抹回旧值。
  assert.equal(t1.status, 'done', '验收通过必须落成 done（被 receipt 的旧快照覆盖时会退回 review）')
  assert.equal(t1.review?.verdict, 'pass', '验收结论必须落盘')
  assert.deepEqual(t1.review?.reasons, ['回归通过，允许完成'])
  assert.equal(t2.status, 'done', '门禁通过必须落成 done')
  assert.equal(t2.evidence?.exitCode, 0, '门禁证据必须落盘')

  // 串行化的直接证据：reviewTask 的返回快照必须在 receipt 写完之**后**读盘，
  // 因此它看到的 t2 已经是 done；没有锁时这里会是 gate。
  assert.equal(
    review.snapshot.tasks.find((task) => task.id === 't2')?.status,
    'done',
    'reviewTask 读到了门禁中的旧快照 —— 说明「读状态→改→写回」没有被同一把 run 锁串起来',
  )
})

test('②④ 20 个并发动作：rev 单调递增=落盘次数、消息一条不丢，5 秒内完成', async () => {
  const h = setup()
  await enable(h.bridge)
  h.store.save(
    stateOf({
      plan: planOf({
        status: 'dispatching',
        tasks: [taskOf('t1', { status: 'running', memberId: 'member-1' })],
      }),
      bindings: [bindingOf()],
    }),
  )
  const seedSaves = h.store.saves
  const seedRev = h.store.revs.at(-1)
  assert.equal(seedRev, 1, '第一份落盘的 rev 必须是 1（计数起点）')

  const started = Date.now()
  const results = await within(
    5000,
    Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        h.bridge.act(SESSION, { type: 'message', taskId: 't1', text: `并发消息 ${index}` }),
      ),
    ),
  )
  const elapsed = Date.now() - started

  for (const result of results) {
    assert.equal(result.rejected, undefined, `并发动作被拒：${result.rejected?.message ?? ''}`)
  }
  assert.ok(elapsed < 5000, `20 个并发动作耗时 ${elapsed}ms，超过 5 秒`)

  const final = h.store.load(RUN_ID)
  assert.ok(final !== null)
  assert.equal(h.store.saves, seedSaves + 20, '每个 message 动作应恰好落盘一次')
  // rev 必须等于累计落盘次数（每次 +1，不重复、不回退）。
  assert.equal(final.rev, h.store.saves, 'rev 必须等于累计落盘次数 —— 少一次就是丢写')
  assert.equal(final.rev, (seedRev as number) + 20)
  assert.equal(h.store.revs.at(-1), final.rev)
  for (let index = 1; index < h.store.revs.length; index += 1) {
    assert.equal(h.store.revs[index], (h.store.revs[index - 1] as number) + 1, 'rev 必须严格逐次 +1')
  }

  // 比 rev 更硬的判据：丢写会让后写者用旧账本覆盖，20 条只剩 1 条。
  const bodies = final.messages.map((message) => message.body)
  assert.equal(bodies.length, 20, '20 条消息一条都不能被覆盖')
  for (let index = 0; index < 20; index += 1) {
    assert.ok(bodies.includes(`并发消息 ${index}`), `消息账本缺少「并发消息 ${index}」`)
  }
})

test('③ expectRev 不匹配 → 抛 STALE_WRITE，错误信息带 runId 与两个 rev', () => {
  const h = setup()
  h.store.save(stateOf())
  const before = h.store.load(RUN_ID)
  assert.ok(before !== null)
  const diskRev = before.rev
  assert.equal(typeof diskRev, 'number')

  let caught: unknown
  try {
    h.store.save(before, { expectRev: (diskRev as number) - 1 })
  } catch (error) {
    caught = error
  }

  assert.ok(caught instanceof StaleWriteError, `期望 StaleWriteError，实际：${String(caught)}`)
  assert.equal(caught.code, 'STALE_WRITE')
  assert.equal(caught.runId, RUN_ID)
  assert.equal(caught.expectRev, (diskRev as number) - 1)
  assert.equal(caught.actualRev, diskRev)
  assert.match(caught.message, /run-r59/, '错误信息必须带 runId')
  assert.match(caught.message, new RegExp(`期望 rev=${(diskRev as number) - 1}`), '错误信息必须带期望 rev')
  assert.match(caught.message, new RegExp(`盘中 rev=${diskRev}`), '错误信息必须带盘中 rev')

  // 失败的那次写不得落盘。
  assert.equal(h.store.load(RUN_ID)?.rev, diskRev, 'CAS 失败后盘上 rev 不得变化')

  // 期望值等于盘中值时正常写入，且 rev 单调 +1。
  h.store.save(before, { expectRev: diskRev })
  assert.equal(h.store.load(RUN_ID)?.rev, (diskRev as number) + 1)
})
