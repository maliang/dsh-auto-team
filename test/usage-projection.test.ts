/**
 * t6：token 用量改读宿主**会话投影**（`sessionProjections.stateOf(session, 'tokenUsage')`）。
 *
 * 为什么不再用事件：真机 `~/.dsh/auto-team/runs/*.json` 全部没有 `usage` 键，而成员会话日志里
 * 明明有 assistant/message + usage —— 结论是 `session/event` 订阅在这个宿主里从未把事件投递给
 * 插件（解析/归属/累加/去重/落盘都已离线逐段验证正确）。投影由宿主从会话日志回放，不依赖投递，
 * 因此是本机唯一可靠的用量来源。
 *
 * 这里覆盖三层：adapters 的读口（buckets → TokenTotals，fail-open）、usage 的纯合成
 * （覆盖语义：重复刷新不翻倍）、bridge 的刷新（有数据才写、同值不落盘、读不到保持历史）。
 */
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { readSessionTokenUsage, type HostContext } from '../src/host/adapters.ts'
import { createBridge, type BridgeDeps } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState, type UsageRecord } from '../src/host/store.ts'
import {
  applyProjectionUsage,
  runUsageOf,
  taskUsageOf,
  type ProjectionUsageEntry,
} from '../src/host/team/usage.ts'
import type { MemberBinding, Plan, PlanTask, TokenTotals } from '../src/shared/types.ts'

const SESSION = 'sess-t6'
const RUN = 'run-t6'
const NOW = 1_700_000_000_000

/** 六项指标的固定顺序（与 `src/host/format.ts` 的 usageMetricsOf 同源，客户端只读透传）。 */
const METRIC_KEYS = ['input', 'cacheRead', 'cacheWrite', 'output', 'calls', 'hitRate']

/** 宿主 token-meter 投影的 state 形状（`@deepseek-ai/dsh-token-meter` 的 tokenUsage）。 */
const TOKEN_USAGE_STATE = {
  totals: { uncachedInputTokens: 120, outputTokens: 30, cacheReadTokens: 40, cacheWriteTokens: 7 },
  last: null,
}

/** 与 TOKEN_USAGE_STATE 对应的期望值：total = input + cacheRead + output（宿主口径，不含 cacheWrite）。 */
const TOTALS: TokenTotals = { total: 190, input: 120, output: 30, cacheRead: 40, cacheWrite: 7 }

interface FakeProjectionCtx {
  ctx: HostContext
  /** 交给 `stateOf` 的真实 Session 桩（回放依赖 header / snapshotEvents / seq）。 */
  session: Record<string, unknown> | null
  /** `stateOf` 收到的 (session, key)，按调用顺序记录。 */
  calls: Array<{ session: unknown; key: string }>
}

/**
 * 假 ctx：`agents.get(id)` 回 agent 桩、`get('sessionProjections')` 回投影服务桩。
 *
 * 未列入 `states` 的 key 视为「未注册」→ `stateOf` 返回 undefined（宿主真实行为）。
 */
function projectionCtx(
  input: {
    states?: Record<string, unknown>
    /** 所有 stateOf 调用都抛错（模拟回放失败）。 */
    boom?: boolean
    /** 完全没有 sessionProjections 服务。 */
    noService?: boolean
    /** null = 会话已卸载（agents.get 取不到）。 */
    session?: Record<string, unknown> | null
  } = {},
): FakeProjectionCtx {
  const calls: Array<{ session: unknown; key: string }> = []
  const session =
    input.session === null
      ? null
      : (input.session ?? {
          header: { id: SESSION },
          inheritedEventCount: 0,
          seq: 0,
          snapshotEvents: () => [],
        })
  const ctx = {
    agents: { get: (id: string) => (session !== null && id === SESSION ? { id, session } : undefined) },
    get: (name: string) => {
      if (name !== 'sessionProjections' || input.noService === true) return undefined
      return {
        stateOf: (target: unknown, key: string) => {
          calls.push({ session: target, key })
          if (input.boom === true) throw new Error('projection replay failed')
          return input.states?.[key]
        },
      }
    },
    logger: { warn: () => {} },
  } as unknown as HostContext
  return { ctx, session, calls }
}

// ---------------------------------------------------------------- adapters 读口

test('readSessionTokenUsage：tokenUsage 投影映射为 TokenTotals，calls 不伪造', () => {
  const fake = projectionCtx({ states: { tokenUsage: TOKEN_USAGE_STATE } })
  const totals = readSessionTokenUsage(fake.ctx, SESSION)

  assert.deepEqual(totals, TOTALS, 'buckets 四项必须逐一映射，total 按宿主口径求和')
  assert.equal(totals?.calls, undefined, '宿主投影没有调用次数：拒绝补 0 伪造')
  assert.equal(fake.calls.length, 1, 'tokenUsage 有数据就不该再试 costUsage')
  assert.equal(fake.calls[0]?.key, 'tokenUsage')
  assert.equal(fake.calls[0]?.session, fake.session, '必须把真实 Session 交给投影（回放依赖它）')
})

test('readSessionTokenUsage：tokenUsage 未注册时用 costUsage 兜底，字段别名宽松兼容', () => {
  const fake = projectionCtx({
    states: {
      costUsage: { buckets: { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheWriteTokens: 8 } },
    },
  })
  const totals = readSessionTokenUsage(fake.ctx, SESSION)

  assert.deepEqual(totals, { total: 18, input: 5, output: 6, cacheRead: 7, cacheWrite: 8 })
  assert.deepEqual(
    fake.calls.map((call) => call.key),
    ['tokenUsage', 'costUsage'],
    'tokenUsage 取不到才轮到第三方 costUsage',
  )
})

test('readSessionTokenUsage：服务缺失 / 回放抛错 / key 未注册 / 字段缺失 / 会话已卸载 → undefined，绝不抛', () => {
  assert.equal(readSessionTokenUsage(projectionCtx({ noService: true }).ctx, SESSION), undefined, '服务缺失')
  assert.equal(readSessionTokenUsage(projectionCtx({ boom: true }).ctx, SESSION), undefined, '回放抛错')
  assert.equal(readSessionTokenUsage(projectionCtx({ states: {} }).ctx, SESSION), undefined, 'key 未注册')
  assert.equal(
    readSessionTokenUsage(projectionCtx({ states: { tokenUsage: { totals: {} } } }).ctx, SESSION),
    undefined,
    'totals 里一个数字都没有',
  )
  assert.equal(readSessionTokenUsage(projectionCtx({ session: null }).ctx, SESSION), undefined, '会话已卸载')
  assert.equal(readSessionTokenUsage(projectionCtx().ctx, 'sess-unknown'), undefined, '未知会话')
  assert.equal(readSessionTokenUsage(projectionCtx().ctx, ''), undefined, '空会话 id')
})

// ---------------------------------------------------------------- usage 纯合成

test('applyProjectionUsage：按成员覆盖、按任务累加、合计=成员之和（重复刷新不翻倍）', () => {
  const small: TokenTotals = { total: 60, input: 50, output: 10, cacheRead: 0, cacheWrite: 0 }
  const entries: ProjectionUsageEntry[] = [
    { memberId: 'm1', taskId: 't1', totals: TOTALS },
    { memberId: 'm2', taskId: 't1', totals: small },
  ]
  const record = applyProjectionUsage(undefined, entries, NOW)

  assert.ok(record)
  assert.equal(record.attribution, 'per-member')
  assert.equal(record.updatedAt, NOW)
  assert.deepEqual(record.byMember.m1, TOTALS, 'byMember = 该成员投影全量')
  assert.equal(record.byTask.t1?.total, 250, '同一任务的多个成员按投影全量累加')
  assert.equal(record.byTask.t1?.input, 170)
  assert.equal(record.total?.total, 250, 'run 合计 = 各 member 之和')
  assert.equal(record.total?.cacheWrite, 7)

  const again = applyProjectionUsage(record, entries, NOW + 5_000)
  assert.equal(again, record, '内容没变必须返回同一引用：调用方据此跳过落盘，且数值不得翻倍')
  assert.equal(again?.total?.total, 250)
})

test('applyProjectionUsage：数值变化时覆盖而不是相加，本帧读不到的成员保留既有值', () => {
  const small: TokenTotals = { total: 20, input: 20, output: 0 }
  const first = applyProjectionUsage(
    undefined,
    [
      { memberId: 'm1', taskId: 't1', totals: TOTALS },
      { memberId: 'm2', taskId: 't2', totals: small },
    ],
    NOW,
  )
  assert.ok(first)

  const grown: TokenTotals = { ...TOTALS, total: 260, output: 100 }
  const next = applyProjectionUsage(first, [{ memberId: 'm1', taskId: 't1', totals: grown }], NOW + 1_000)

  assert.ok(next)
  assert.notEqual(next, first)
  assert.equal(next.byMember.m1?.total, 260, '投影本身是累计值 ⇒ 覆盖，不能与上次相加')
  assert.equal(next.byMember.m2?.total, 20, '本帧读不到的成员（会话已卸载）保持落盘值，历史不丢')
  assert.equal(next.byTask.t2?.total, 20, '未触及的任务保留既有归属')
  assert.equal(next.total?.total, 280)
  assert.equal(next.updatedAt, NOW + 1_000)
})

test('applyProjectionUsage：空 entries 原样返回（没有数据就不假装有变化）', () => {
  assert.equal(applyProjectionUsage(undefined, [], NOW), undefined)
  const record = applyProjectionUsage(undefined, [{ memberId: 'm1', taskId: 't1', totals: TOTALS }], NOW)
  assert.ok(record)
  assert.equal(applyProjectionUsage(record, [], NOW + 1_000), record)
})

test('runUsageOf / taskUsageOf：六项指标顺序与可读性（calls 不可得、命中率 25%）', () => {
  const record = applyProjectionUsage(undefined, [{ memberId: 'm1', taskId: 't1', totals: TOTALS }], NOW)
  assert.ok(record)

  const cell = runUsageOf(record)
  assert.equal(cell.source, 'provider')
  assert.equal(cell.tokens?.total, 190)
  assert.deepEqual(
    (cell.details ?? []).map((detail) => detail.key),
    METRIC_KEYS,
    '六项顺序由宿主 format.ts 统一生成：input/cacheRead/cacheWrite/output/calls/hitRate',
  )
  const byKey = new Map((cell.details ?? []).map((detail) => [detail.key, detail]))
  assert.equal(byKey.get('input')?.text, '120')
  assert.equal(byKey.get('cacheWrite')?.text, '7', '投影给了 cacheWrite 就必须显示真数')
  assert.equal(byKey.get('cacheWrite')?.available, true)
  assert.equal(byKey.get('calls')?.available, false, '宿主投影没有调用次数 → 不可得')
  assert.equal(byKey.get('hitRate')?.text, '25%', '40 / (120 + 40)')

  const task = taskUsageOf(record, 't1')
  assert.equal(task.source, 'provider')
  assert.equal(task.tokens?.total, 190)
})

// ---------------------------------------------------------------- bridge 刷新

function t6Task(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: 'exit 0', status: 'pending', ...over }
}

function t6Binding(memberId: string, taskId = 't1', retired = false): MemberBinding {
  return { taskId, roleId: 'dev', memberId, name: memberId, spawnedAt: NOW, ...(retired ? { retired: true } : {}) }
}

function t6State(over: Partial<RunState> = {}): RunState {
  const plan: Plan = {
    runId: RUN,
    sessionId: SESSION,
    createdAt: NOW,
    status: 'dispatching',
    tasks: [t6Task('t1', { status: 'running' })],
    maxConcurrent: 3,
  }
  return {
    version: RUN_STATE_VERSION,
    plan,
    plannedAt: NOW,
    messages: [],
    bindings: [t6Binding('m1')],
    routeAudits: [],
    ...over,
  }
}

function t6Setup(overrides: Partial<BridgeDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-t6-'))
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const store = new RunsStore(join(dir, 'runs'))
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir, now: () => NOW })
  roles.seed()
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
    now: () => NOW,
    ...overrides,
  }
  return { dir, store, bridge: createBridge(deps) }
}

test('bridge：投影有数时面板/历史都拿到用量，同值刷新不重写落盘', () => {
  let clock = NOW
  let projected: TokenTotals | undefined = TOTALS
  const h = t6Setup({ now: () => clock, readSessionUsage: () => projected })
  h.store.save(t6State())

  const first = h.bridge.snapshot(SESSION)
  assert.equal(first.runUsage?.source, 'provider', '有投影就不能再报「尚无用量事件」')
  assert.deepEqual((first.runUsage?.details ?? []).map((detail) => detail.key), METRIC_KEYS)
  assert.equal(first.taskUsage?.t1?.source, 'provider', '任务行也要有数')
  assert.equal(first.taskUsage?.t1?.tokens?.total, 190)
  assert.equal(first.runs?.[0]?.usage?.source, 'provider', '历史列表同帧也要有数（落盘后读回）')

  assert.deepEqual(h.store.load(RUN)?.usage?.byMember.m1, TOTALS, '必须落盘：成员会话卸载后历史仍能显示')
  assert.equal(h.store.load(RUN)?.usage?.updatedAt, NOW)

  clock = NOW + 2_000
  const second = h.bridge.snapshot(SESSION)
  assert.equal(second.runUsage?.source, 'provider')
  assert.equal(h.store.load(RUN)?.usage?.updatedAt, NOW, '同值刷新不得重写落盘（否则每帧写盘）')

  clock = NOW + 4_000
  projected = { ...TOTALS, total: 260, output: 100 }
  const third = h.bridge.snapshot(SESSION)
  assert.equal(third.runUsage?.tokens?.total, 260)
  assert.equal(h.store.load(RUN)?.usage?.updatedAt, NOW + 4_000, '投影值变了必须落盘一次')
})

test('bridge：没有投影读口 → unavailable + 可读原因，绝不补 0', () => {
  const h = t6Setup()
  h.store.save(t6State())
  const snapshot = h.bridge.snapshot(SESSION)

  assert.equal(snapshot.runUsage?.source, 'unavailable')
  assert.equal(snapshot.runUsage?.reason, '尚无用量事件')
  assert.equal(snapshot.runUsage?.tokens, undefined, '不可得就是没有数字，不能用 0 顶替')
  assert.equal(snapshot.runs?.[0]?.usage?.source, 'unavailable')
  assert.equal(snapshot.runs?.[0]?.usage?.reason, '宿主未上报本 run 的用量')
})

test('bridge：只采样未退出绑定（retired 不再读投影）', () => {
  const asked: string[] = []
  const h = t6Setup({
    readSessionUsage: (sessionId) => {
      asked.push(sessionId)
      return sessionId === 'm1' ? TOTALS : undefined
    },
  })
  h.store.save(t6State({ bindings: [t6Binding('m1'), t6Binding('m2', 't1', true)] }))

  h.bridge.snapshot(SESSION)
  assert.deepEqual(asked, ['m1'], 'retired 绑定的会话已退出，不再采样')
})

test('bridge：读口抛错不打断快照；已有落盘用量时保持历史（fail-open）', () => {
  const persisted: UsageRecord = {
    attribution: 'per-member',
    byMember: { m1: TOTALS },
    byTask: { t1: TOTALS },
    total: TOTALS,
    updatedAt: NOW,
  }
  const h = t6Setup({
    readSessionUsage: () => {
      throw new Error('projection replay failed')
    },
  })
  h.store.save(t6State({ usage: persisted }))

  const snapshot = h.bridge.snapshot(SESSION)
  assert.equal(snapshot.runUsage?.source, 'provider')
  assert.equal(snapshot.runUsage?.tokens?.total, 190)
  assert.equal(h.store.load(RUN)?.usage?.updatedAt, NOW, '读不到就保持原样，不覆盖历史')
})

test('bridge：落盘失败仍返回内存新值，并把错误送进日志出口', () => {
  const errors: string[] = []
  const h = t6Setup({
    readSessionUsage: () => TOTALS,
    onUsagePersistError: (text) => errors.push(text),
  })
  h.store.save(t6State())

  const realSave = h.store.save.bind(h.store)
  h.store.save = () => {
    throw new Error('disk full')
  }
  const snapshot = h.bridge.snapshot(SESSION)
  h.store.save = realSave

  assert.equal(snapshot.runUsage?.source, 'provider', '落盘失败也不能让本帧显示回退')
  assert.equal(snapshot.runUsage?.tokens?.total, 190)
  assert.equal(errors.length, 1)
  assert.match(errors[0] ?? '', /用量落盘失败.*disk full/)
})

/* ─────────────── r20：调用次数（calls）与 token 同源、同落盘、同保留 ─────────────── */

/** 已落盘的用量：带调用次数（token 投影本身没有 calls）。 */
function t6UsageWithCalls(calls: number): UsageRecord {
  const totals: TokenTotals = { ...TOTALS, calls }
  return {
    attribution: 'per-member',
    byMember: { m1: totals },
    byTask: { t1: totals },
    total: totals,
    updatedAt: NOW,
  }
}

test('bridge：calls 合并进 TokenTotals，按成员/任务/run 归属并落盘可读回', () => {
  const h = t6Setup({ readSessionUsage: () => TOTALS, readSessionCalls: () => 3 })
  h.store.save(t6State())

  const snapshot = h.bridge.snapshot(SESSION)
  const callsMetric = (snapshot.runUsage?.details ?? []).find((detail) => detail.key === 'calls')
  assert.equal(snapshot.runUsage?.tokens?.calls, 3, '调用次数必须进 run 合计单元格')
  assert.equal(callsMetric?.available, true, '读到了就是可用值（不是「不可得」）')
  assert.equal(callsMetric?.text, '3')

  const loaded = h.store.load(RUN)
  assert.deepEqual(loaded?.usage?.byMember.m1, { ...TOTALS, calls: 3 }, '成员归属带上 calls')
  assert.equal(loaded?.usage?.byTask.t1?.calls, 3, '任务归属带上 calls')
  assert.equal(loaded?.usage?.total?.calls, 3, 'run 合计带上 calls')
  // 落盘再读一次（新 store 实例）仍然是同一个数：calls 没有被 normalizeUsage 丢掉。
  assert.equal(new RunsStore(join(h.dir, 'runs')).load(RUN)?.usage?.byMember.m1?.calls, 3)
})

test('bridge：calls = 0 是真实计数，必须落盘并显示 0（不是不可得、不是跳过）', () => {
  const h = t6Setup({ readSessionUsage: () => TOTALS, readSessionCalls: () => 0 })
  h.store.save(t6State())

  const snapshot = h.bridge.snapshot(SESSION)
  assert.equal(snapshot.runUsage?.tokens?.calls, 0)
  const callsMetric = (snapshot.runUsage?.details ?? []).find((detail) => detail.key === 'calls')
  assert.equal(callsMetric?.available, true, '0 是合法计数，不能渲染成「不可得」')
  assert.equal(callsMetric?.text, '0')
  assert.equal(h.store.load(RUN)?.usage?.byMember.m1?.calls, 0)
})

test('bridge：calls 读口抛错 / 返回 undefined → 保留已落盘的 calls，不覆盖成不可得', () => {
  const readers: Array<[string, () => number | undefined]> = [
    ['抛错', () => {
      throw new Error('session log unreadable')
    }],
    ['返回 undefined', () => undefined],
  ]
  for (const [label, readSessionCalls] of readers) {
    const h = t6Setup({ readSessionUsage: () => TOTALS, readSessionCalls })
    h.store.save(t6State({ usage: t6UsageWithCalls(7) }))

    const snapshot = h.bridge.snapshot(SESSION)
    const callsMetric = (snapshot.runUsage?.details ?? []).find((detail) => detail.key === 'calls')
    assert.equal(callsMetric?.text, '7', `${label}：本帧读不到，界面仍显示历史 7 次`)
    assert.equal(h.store.load(RUN)?.usage?.byMember.m1?.calls, 7, `${label}：落盘值必须保留`)
    assert.equal(h.store.load(RUN)?.usage?.updatedAt, NOW, `${label}：数值未变不重写盘`)
  }
})

test('bridge：token 投影整个读不到时，连 calls 也不单独写（否则会抹掉已落盘 token）', () => {
  const h = t6Setup({ readSessionUsage: () => undefined, readSessionCalls: () => 9 })
  h.store.save(t6State({ usage: t6UsageWithCalls(7) }))

  h.bridge.snapshot(SESSION)
  const loaded = h.store.load(RUN)
  assert.equal(loaded?.usage?.byMember.m1?.total, 190, 'token 历史不能因为这一帧读不到而消失')
  assert.equal(loaded?.usage?.byMember.m1?.calls, 7, 'calls 也不能被单独写进来的 9 覆盖')
  assert.equal(loaded?.usage?.updatedAt, NOW)
})
