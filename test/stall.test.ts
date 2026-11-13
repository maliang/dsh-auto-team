/**
 * 停滞核心单测：判定纯函数（`stall.stallOf` 等）+ 告警唯一出口（`watcher.stallAlertsOf`）
 * + 真 store / 真轮询器的端到端主路径。
 *
 * 为什么既有纯函数用例又有端到端用例：AC-8「一次 episode 恰好一条告警」的失效方式
 * 从来不是某个函数算错，而是**同一处被调用了两次**（事件一条 + 轮询一条）。纯函数用例
 * 只能证明「调一次产一条」，只有让 `createMemberWatcher` 对着真 `RunsStore` 连跑多轮，
 * 才能证明「重复 tick 不会长出第二条」以及「告警真的落盘了（跨重启才幂等）」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_MAX_CONCURRENT, STALL_MS } from '../src/host/config.ts'
import { RunsStore, RUN_STATE_VERSION, STALL_ALERTS_LIMIT } from '../src/host/store.ts'
import type { RunState } from '../src/host/store.ts'
import type { MemberBinding, Plan, PlanTask } from '../src/shared/types.ts'
import { clearAlerted, secondsText, stallNoteOf, stallOf, stallSentence, touchProgress } from '../src/host/team/stall.ts'
import { createMemberWatcher, stallAlertsOf } from '../src/host/team/watcher.ts'

const NOW = 1_700_000_000_000
const THRESHOLD = 90_000

function taskOf(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return { id, title: `任务 ${id}`, roleId: 'dev', dependsOn: [], acceptance: 'pnpm test', status: 'running', ...overrides }
}

function bindingOf(overrides: Partial<MemberBinding> = {}): MemberBinding {
  return { taskId: 't1', roleId: 'dev', memberId: 'member-1', name: '开发-1', spawnedAt: NOW - 10_000, ...overrides }
}

function planOf(overrides: Partial<Plan> = {}): Plan {
  return {
    runId: 'run-stall',
    sessionId: 's-stall',
    createdAt: NOW - 20_000,
    status: 'dispatching',
    tasks: [taskOf('t1')],
    maxConcurrent: DEFAULT_MAX_CONCURRENT,
    ...overrides,
  }
}

function stateOf(overrides: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: planOf(),
    plannedAt: NOW - 20_000,
    messages: [],
    bindings: [bindingOf()],
    routeAudits: [],
    ...overrides,
  }
}

function withTempDir(run: (dir: string) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-stall-'))
  const cleanup = (): void => rmSync(dir, { recursive: true, force: true })
  try {
    const result = run(dir)
    if (result instanceof Promise) return result.finally(cleanup)
    cleanup()
    return undefined
  } catch (error) {
    cleanup()
    throw error
  }
}

test('STALL_MS 是 90 秒（全仓唯一定义处，stallOf 只接收参数）', () => {
  assert.equal(STALL_MS, 90_000)
})

test('stallOf：阈值是「达到即停滞」，89999 不判、90000 判', () => {
  const below = stallOf(NOW - 89_999, NOW, THRESHOLD)
  assert.deepEqual(below, { stalled: false, stalledForMs: 0, reason: 'none' }, '未停滞时 stalledForMs 恒 0')

  const exact = stallOf(NOW - 90_000, NOW, THRESHOLD)
  assert.equal(exact.stalled, true)
  assert.equal(exact.stalledForMs, 90_000)
  assert.equal(exact.reason, 'quiet')
})

test('stallOf：没有推进记录 = 证据不足（unreported），绝不计时成停滞（r32）', () => {
  // 旧实现会回落到 spawnedAt：派发 120 秒后即使一次信号都没有也判「停滞 120 秒」，
  // 真机 r32 就是这样把正在干活的成员说成 stalledForMs=1210840。
  const noSignal = stallOf(undefined, NOW, THRESHOLD)
  assert.deepEqual(noSignal, { stalled: false, stalledForMs: 0, reason: 'unreported' })
  assert.equal(stallOf(Number.NaN, NOW, THRESHOLD).reason, 'unreported', 'NaN 也要落到证据不足，不能算停滞')
  assert.equal(stallOf(Number.POSITIVE_INFINITY, NOW, THRESHOLD).reason, 'unreported')

  // 有信号但恰好没超阈值：reason 必须是 none，不能混成 unreported（否则面板会误报「无信号」）。
  assert.equal(stallOf(NOW - 1_000, NOW, THRESHOLD).reason, 'none')
})

test('stallOf：时钟回拨不产生负数停滞', () => {
  const back = stallOf(NOW + 60_000, NOW, THRESHOLD)
  assert.deepEqual(back, { stalled: false, stalledForMs: 0, reason: 'none' })
})

test('stallNoteOf：只有「证据不足」有措辞，停滞时长另有 secondsText', () => {
  assert.equal(stallNoteOf('unreported'), '宿主未上报推进信号，无法判定是否停滞')
  assert.equal(stallNoteOf('quiet'), '')
  assert.equal(stallNoteOf('none'), '')
})

test('secondsText：<600 秒直写、≥600 秒换「M 分 S 秒」且永不省略秒', () => {
  assert.equal(secondsText(92_000), '92 秒')
  assert.equal(secondsText(0), '0 秒')
  assert.equal(secondsText(599_999), '599 秒', '毫秒取 floor，不四舍五入成 600 秒')
  assert.equal(secondsText(600_000), '10 分 0 秒', '分秒两段都写，不省略 0 秒')
  assert.equal(secondsText(1_234_000), '20 分 34 秒')
  assert.equal(secondsText(Number.NaN), '0 秒')
  assert.equal(secondsText(-5), '0 秒')
})

test('stallSentence：文案逐字（面板与活动流共用同一句）', () => {
  assert.equal(stallSentence('开发-1', 100_000), '开发-1 已 100 秒无实质工具调用，疑似停滞')
  assert.equal(stallSentence('t1-worker', 92_000), 't1-worker 已 92 秒无实质工具调用，疑似停滞')
})

test('touchProgress：推进 at 且不改入参，保留本 episode 的 alertedAt', () => {
  const before = { 'member-1': { at: NOW - 500_000, alertedAt: NOW - 400_000 } }
  const after = touchProgress(before, 'member-1', NOW)
  assert.notEqual(after, before, '返回新对象：调用方要拿它落盘')
  assert.deepEqual(before['member-1'], { at: NOW - 500_000, alertedAt: NOW - 400_000 }, '入参不被就地修改')
  assert.deepEqual(after['member-1'], { at: NOW, alertedAt: NOW - 400_000 })
})

test('clearAlerted：只清 episode 标记，at 保留；无记录时原样返回', () => {
  const progress = { 'member-1': { at: NOW - 1_000, alertedAt: NOW - 500 } }
  assert.deepEqual(clearAlerted(progress, 'member-1')['member-1'], { at: NOW - 1_000 })

  const untouched = { 'member-1': { at: NOW } }
  assert.equal(clearAlerted(untouched, 'member-1'), untouched, '没有标记就不产生新对象（避免无意义落盘）')
  assert.deepEqual(clearAlerted(undefined, 'member-1'), {})
})

test('stallAlertsOf：停滞 → 恰好一条 kind=tool 事件，且写回 alertedAt 幂等键', () => {
  const state = stateOf({ progress: { 'member-1': { at: NOW - 100_000 } } })
  const result = stallAlertsOf(state, NOW, THRESHOLD)

  assert.equal(result.raised.length, 1)
  assert.equal(result.state.stallAlerts?.length, 1)
  const event = result.state.stallAlerts?.[0]
  assert.equal(event?.kind, 'tool')
  assert.equal(event?.memberId, 'member-1')
  assert.equal(event?.taskId, 't1')
  assert.equal(event?.at, NOW)
  assert.equal(event?.text, '开发-1 已 100 秒无实质工具调用，疑似停滞')
  assert.equal(result.state.progress?.['member-1']?.alertedAt, NOW)
  assert.equal(result.state.progress?.['member-1']?.at, NOW - 100_000, 'at 不被告警改写（基线仍是上次实质调用）')
})

test('stallAlertsOf：连续 5 轮判定后仍只有 1 条（一次 episode 一条，AC-8）', () => {
  let state = stateOf({ progress: { 'member-1': { at: NOW - 100_000 } } })
  let raised = 0
  for (let round = 0; round < 5; round += 1) {
    const result = stallAlertsOf(state, NOW + round * 1_500, THRESHOLD)
    raised += result.raised.length
    state = result.state
  }
  assert.equal(raised, 1)
  assert.equal(state.stallAlerts?.length, 1)
})

test('stallAlertsOf：恢复产出 → 清标记；再次卡住 → 第二次告警（不是一辈子只响一次）', () => {
  const stalled = stallAlertsOf(stateOf({ progress: { 'member-1': { at: NOW - 100_000 } } }), NOW, THRESHOLD)
  assert.equal(stalled.raised.length, 1)

  // 成员重新调用工具：at 前进到「现在」，同一 tick 立刻判为未停滞 → 标记被清掉。
  const touched = { ...stalled.state, progress: touchProgress(stalled.state.progress, 'member-1', NOW) }
  const recovered = stallAlertsOf(touched, NOW, THRESHOLD)
  assert.equal(recovered.raised.length, 0)
  assert.equal(recovered.state.progress?.['member-1']?.alertedAt, undefined, '恢复即清 episode 标记')
  assert.equal(recovered.state.stallAlerts?.length, 1, '历史告警不因恢复而消失')

  // 又卡了 100 秒：新 episode，允许第二条。
  const again = stallAlertsOf(recovered.state, NOW + 100_000, THRESHOLD)
  assert.equal(again.raised.length, 1)
  assert.equal(again.state.stallAlerts?.length, 2)
})

test('stallAlertsOf：终态任务 / 无 live binding 一律不判（少一条假告警比多一条真告警重要）', () => {
  const done = stateOf({
    plan: planOf({ tasks: [taskOf('t1', { status: 'done' })] }),
    progress: { 'member-1': { at: NOW - 500_000 } },
  })
  assert.equal(stallAlertsOf(done, NOW, THRESHOLD).raised.length, 0)

  const retired = stateOf({ bindings: [bindingOf({ retired: true })] })
  assert.equal(stallAlertsOf(retired, NOW, THRESHOLD).raised.length, 0)

  const unbound = stateOf({ bindings: [] })
  assert.equal(stallAlertsOf(unbound, NOW, THRESHOLD).raised.length, 0)
})

test('stallAlertsOf：从未收到推进信号 → 一条告警都不许发（r32 假停滞的真机形态）', () => {
  // 真机场景：binding 派发已 20 分钟（spawnedAt 很远），但宿主一次进度都没上报（progress 为空）。
  // 旧实现回落到 spawnedAt，于是把「正在干活的成员」告警成「疑似停滞 1210 秒」。
  const silent = stateOf({ bindings: [bindingOf({ spawnedAt: NOW - 1_210_840 })] })
  const result = stallAlertsOf(silent, NOW, THRESHOLD)
  assert.equal(result.raised.length, 0, '证据不足不得转成停滞告警')
  assert.equal(result.state.stallAlerts?.length ?? 0, 0)
  assert.equal(result.state.progress?.['member-1'], undefined, '没有信号就不许凭空写 progress')

  // 对照证明这条断言不是恒真：同样的 spawnedAt、只要有一条 100 秒前的推进记录，就必须告警。
  const withSignal = stallAlertsOf(
    stateOf({ bindings: [bindingOf({ spawnedAt: NOW - 1_210_840 })], progress: { 'member-1': { at: NOW - 100_000 } } }),
    NOW,
    THRESHOLD,
  )
  assert.equal(withSignal.raised.length, 1)
})

test('stallAlertsOf：不碰 plan（tasks 深相等），无变更时返回原引用', () => {
  const state = stateOf({ progress: { 'member-1': { at: NOW - 1_000 } } })
  const result = stallAlertsOf(state, NOW, THRESHOLD)
  assert.deepEqual(result.state.plan.tasks, state.plan.tasks, 'AC-13：判定不得改计划')
  assert.equal(result.state, state, '无事发生时不产生新对象（不必落盘）')

  const stalled = stallAlertsOf(stateOf({ progress: { 'member-1': { at: NOW - 100_000 } } }), NOW, THRESHOLD)
  assert.deepEqual(stalled.state.plan.tasks, planOf().tasks)
})

test(`stallAlertsOf：告警上限 ${STALL_ALERTS_LIMIT} 条，超出丢最旧`, () => {
  const full = Array.from({ length: STALL_ALERTS_LIMIT }, (_, index) => ({
    at: NOW - 10_000 + index,
    kind: 'tool' as const,
    text: `旧告警 ${index}`,
  }))
  const state = stateOf({ stallAlerts: full, progress: { 'member-1': { at: NOW - 100_000 } } })
  const result = stallAlertsOf(state, NOW, THRESHOLD)
  assert.equal(result.state.stallAlerts?.length, STALL_ALERTS_LIMIT)
  assert.equal(result.state.stallAlerts?.at(-1)?.at, NOW, '最新一条在尾部（面板按时间倒序取）')
})

test('端到端：真 store + 真 watcher 连跑 5 轮 → 落盘恰好 1 条告警；恢复后再卡住 → 第 2 条', async () => {
  await withTempDir(async (dir) => {
    const store = new RunsStore(dir)
    let clock = NOW
    store.save(stateOf({ plan: planOf({ tasks: [taskOf('t1')] }), progress: { 'member-1': { at: NOW - 100_000 } } }))

    const watcher = createMemberWatcher({
      store,
      listMembers: async () => [{ id: 'member-1', name: '开发-1', status: 'running' }],
      now: () => clock,
      stallMs: THRESHOLD,
      intervalMs: 1_500,
    })

    for (let round = 0; round < 5; round += 1) {
      clock += 1_500
      await watcher.tick()
    }

    const afterTicks = store.load('run-stall')
    assert.equal(afterTicks?.plan.tasks[0]?.status, 'running', '成员活着：任务不许被对账误杀')
    assert.equal(afterTicks?.stallAlerts?.length, 1, '连跑 5 轮仍是 1 条（幂等靠落盘的 alertedAt）')
    assert.match(afterTicks?.stallAlerts?.[0]?.text ?? '', /^开发-1 已 \d+ 秒无实质工具调用，疑似停滞$/)

    // 恢复：记一次实质调用，下一 tick 应清掉 episode 标记。
    const touched = store.load('run-stall') as RunState
    store.save({ ...touched, progress: touchProgress(touched.progress, 'member-1', clock) })
    clock += 1_500
    await watcher.tick()
    const recovered = store.load('run-stall')
    assert.equal(recovered?.progress?.['member-1']?.alertedAt, undefined)
    assert.equal(recovered?.stallAlerts?.length, 1)

    // 再卡 100 秒：新 episode 再响一次，总计 2 条。
    clock += 100_000
    await watcher.tick()
    const again = store.load('run-stall')
    assert.equal(again?.stallAlerts?.length, 2, '恢复后再次停滞必须能重新告警')
    watcher.stop()
  })
})
