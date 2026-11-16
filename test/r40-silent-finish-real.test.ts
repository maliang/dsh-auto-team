/**
 * r40 QA 回归：**两路 silentFinish 信号 + stale 收口不再误杀**（对照组见
 * `docs/teamflow/2026-11-16-r40-silent-finish-real/QA.md`）。
 *
 * 与 r36 单测的分工：r36 锁 adapters/watcher/store 的**单元行为**；本文件把 ROOT-CAUSE §6
 * 「用例 A」放大成**落盘断言**（真 `RunsStore` 指临时目录 → 重新 `new RunsStore()` 读回），
 * 并按任务卡 ③ 用**宿主形状的 payload**（`{id, parentSessionId, stopReason}`）同时打两路订阅。
 *
 * 每条断言都先过一句：「把修复改回旧实现，它会不会红？」—— 四个用例在 HEAD(8e990b0) 上
 * 全部变红，见 QA.md §3 的对照记录。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../src/host/index.ts'
import { createMemberWatcher } from '../src/host/team/watcher.ts'
import { RUN_STATE_VERSION, RunsStore, lastActivityAtOf, reconcileStalePlans, type RunState } from '../src/host/store.ts'
import type { MemberBinding, Plan, PlanTask } from '../src/shared/types.ts'

const SESSION = 'sess-r40-real'
const RUN = 'run-r40-real'
const MEMBER_ID = 'M'
const MEMBER_NAME = 'qa-t2'
const NOW = 1_760_000_000_000
const NO_CALLER = 'NO_CALLER: 定时器回调不在任何 initiator 边界内'

function taskOf(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 't2',
    title: '回归 silentFinish',
    roleId: 'qa',
    dependsOn: [],
    acceptance: 'exit 0',
    status: 'running',
    memberId: MEMBER_ID,
    ...overrides,
  }
}

function planOf(tasks: PlanTask[]): Plan {
  return {
    runId: RUN,
    sessionId: SESSION,
    createdAt: NOW - 60_000,
    status: 'dispatching',
    tasks,
    maxConcurrent: 3,
  }
}

function bindingOf(): MemberBinding {
  return { taskId: 't2', roleId: 'qa', memberId: MEMBER_ID, name: MEMBER_NAME, spawnedAt: NOW - 50_000 }
}

function stateOf(tasks: PlanTask[], bindings: MemberBinding[]): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: planOf(tasks),
    plannedAt: NOW - 60_000,
    messages: [],
    bindings,
    routeAudits: [],
  }
}

const silentNoticeCount = (state: RunState): number =>
  state.messages.filter((message) => /已结束本轮但未提交回执/.test(message.body)).length

const taskOfState = (state: RunState): PlanTask => state.plan.tasks.find((item) => item.id === 't2')!

// ─────────────────────────────────────────────────────────────────────────────
// ① 轮询路径（ROOT-CAUSE §6 用例 A）：名单必须按 plan.sessionId 取，落盘后重读仍在
// ─────────────────────────────────────────────────────────────────────────────
test('r40①：轮询用 plan.sessionId 列名单 → silentFinish 落盘（重新 load 仍在）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r40-poll-'))
  try {
    const store = new RunsStore(dir)
    store.save(stateOf([taskOf()], [bindingOf()]))

    const roots: Array<string | undefined> = []
    const watcher = createMemberWatcher({
      store,
      // 旧实现在这里不带参调用 → 直接 NO_CALLER（模拟定时器回调没有 initiator 边界）。
      listMembers: async (rootId?: string) => {
        roots.push(rootId)
        if (rootId !== SESSION) throw new Error(NO_CALLER)
        return [{ id: MEMBER_ID, name: MEMBER_NAME, status: 'inactive' }]
      },
      now: () => NOW,
      intervalMs: 1_500,
    })

    await watcher.tick()

    assert.deepEqual(roots, [SESSION], 'watcher 必须拿 run 的 plan.sessionId 当 root（不是无参调用）')
    const first = taskOfState(store.load(RUN)!)
    assert.equal(typeof first.silentFinish?.at, 'number', '成员已 inactive：轮询这条腿必须落 silentFinish')
    assert.ok(Number.isFinite(first.silentFinish?.at), 'at 必须是有限数（不是 NaN/Infinity）')
    assert.equal(first.silentFinish?.memberId, MEMBER_ID)

    // 关键：换一个全新的 store 实例从同一目录读 —— 证明是**落盘文件**，不是内存态。
    const reread = taskOfState(new RunsStore(dir).load(RUN)!)
    assert.equal(reread.silentFinish?.at, first.silentFinish?.at, 'silentFinish 必须真的落盘：重新 load 仍在')
    assert.equal(reread.silentFinish?.memberId, MEMBER_ID)
    assert.equal(silentNoticeCount(new RunsStore(dir).load(RUN)!), 1, '两路信号都只发一条 captain→user 通知')

    // 只记事实：不自动 done / 不替成员跑门禁；任务照旧进 interrupted 等队长处理。
    assert.equal(reread.status, 'interrupted', 'silentFinish 不改变「只记事实」的语义')
    assert.equal(reread.evidence, undefined, '不得替成员写门禁证据')
    watcher.stop()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ② 名单不可得不再静默：onWarn 恰一次、同错不刷屏、错误换文本才再报、期间不判死
// ─────────────────────────────────────────────────────────────────────────────
test('r40②：名单失败经 onWarn 报 1 次（同错不刷屏），期间不据此判死任何成员', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r40-warn-'))
  try {
    const store = new RunsStore(dir)
    store.save(stateOf([taskOf()], [bindingOf()]))

    const warnings: string[] = []
    let error = NO_CALLER
    let fail = true
    const watcher = createMemberWatcher({
      store,
      listMembers: async () => {
        if (fail) throw new Error(error)
        return [{ id: MEMBER_ID, name: MEMBER_NAME, status: 'inactive' }]
      },
      onWarn: (text: string) => warnings.push(text),
      now: () => NOW,
      intervalMs: 1_500,
    })

    await watcher.tick()
    await watcher.tick()
    await watcher.tick()
    assert.equal(warnings.length, 1, '同一错误连续三轮只报一次（去重在 watcher，不刷屏）')
    assert.match(warnings[0] ?? '', /成员名单不可得/)
    assert.match(warnings[0] ?? '', /NO_CALLER/)

    const stuck = taskOfState(store.load(RUN)!)
    assert.equal(stuck.status, 'running', '名单不可得 ≠ 成员死亡：不许据此判死')
    assert.equal(stuck.silentFinish, undefined, '名单不可得时不许伪造 silentFinish')

    // 错误文本变了 = 新的状态变化 → 允许再报一次；随后恢复成功，再故障也要重新报（恢复后再故障是新状态）。
    error = 'ECONNRESET: 宿主名单接口中断'
    await watcher.tick()
    assert.equal(warnings.length, 2, '错误内容变化要再报一次（否则第二次故障永远静默）')

    fail = false
    await watcher.tick()
    const healed = taskOfState(store.load(RUN)!)
    assert.equal(healed.silentFinish?.at, NOW, '名单恢复后照常对账出 silentFinish')

    // 面板可见的降级：watcher 只把文本交给 onWarn；装配层当前接到 ctx.logger.warn。
    // 这里断言装配层的「降级出口」确实被接到（text 到达某个可观测出口），面板字段另见 QA.md 缺陷 D1。
    const sinks: string[] = []
    const warnWatcher = createMemberWatcher({
      store,
      listMembers: async () => {
        throw new Error(NO_CALLER)
      },
      onWarn: (text: string) => sinks.push(text),
      now: () => NOW,
    })
    await warnWatcher.tick()
    assert.equal(sinks.length, 1, 'onWarn 是唯一告警出口，装配层必须接上（否则又回到静默吞错）')
    warnWatcher.stop()
    watcher.stop()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ③ 事件路双订阅不双写：宿主形状 payload 同时打到根作用域与队长 agent 作用域
// ─────────────────────────────────────────────────────────────────────────────
interface SilentHarness {
  ctx: Record<string, unknown>
  disposers: Array<() => void | Promise<void>>
  warnings: string[]
  events: Map<string, Array<(...args: unknown[]) => void>>
  captainEvents: Map<string, Array<(...args: unknown[]) => void>>
  emitBoth(event: string, payload: unknown): void
}

function makeHarness(): SilentHarness {
  const disposers: Array<() => void | Promise<void>> = []
  const warnings: string[] = []
  const events = new Map<string, Array<(...args: unknown[]) => void>>()
  const captainEvents = new Map<string, Array<(...args: unknown[]) => void>>()
  const subscribe = (map: Map<string, Array<(...args: unknown[]) => void>>, event: string, listener: (...args: unknown[]) => void) => {
    const list = map.get(event) ?? []
    list.push(listener)
    map.set(event, list)
  }

  const ctx: Record<string, unknown> = {
    tools: { register: () => {} },
    systemPrompt: { section: () => {} },
    webServer: { register: () => {} },
    agents: {
      currentInitiator: () =>
        ({
          id: 'captain',
          name: 'captain',
          ctx: { on: (event: string, listener: (...args: unknown[]) => void) => subscribe(captainEvents, event, listener) },
        }) as unknown,
    },
    get(name: string): unknown {
      return ctx[name]
    },
    agentTeams: {
      listMembers: async () => [{ id: MEMBER_ID, name: MEMBER_NAME, status: 'running' }],
      spawnTeammate: async () => {
        throw new Error('本用例不派发成员')
      },
      sendMessage: async () => {},
    },
    llm: { resolveCallConfig: (config: unknown) => config },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
    effect: (dispose: () => void | Promise<void>) => void disposers.push(dispose),
    on: (event: string, listener: (...args: unknown[]) => void) => subscribe(events, event, listener),
    logger: { warn: (text: string) => void warnings.push(text), info: () => {} },
  }

  return {
    ctx,
    disposers,
    warnings,
    events,
    captainEvents,
    emitBoth(event, payload) {
      for (const listener of events.get(event) ?? []) listener(payload)
      for (const listener of captainEvents.get(event) ?? []) listener(payload)
    },
  }
}

test('r40③：同一条 {id,parentSessionId,stopReason} 打到两路订阅 → silentFinish 只一条', async () => {
  const home = mkdtempSync(join(tmpdir(), 'auto-team-r40-dupe-'))
  const previousHome = process.env.HOME
  process.env.HOME = home
  const h = makeHarness()
  try {
    apply(h.ctx as never, { workspace: home })
  } finally {
    process.env.HOME = previousHome
  }

  try {
    assert.ok(h.events.has('subagent/end'), '根作用域仍要订阅（老宿主无队长 agent 时的唯一事件源）')
    assert.ok(h.captainEvents.has('subagent/end'), '队长 agent 作用域必须补订 subagent/end')
    assert.ok(h.captainEvents.has('agent/error'), '队长 agent 作用域必须补订 agent/error')

    const store = new RunsStore(join(home, '.dsh/auto-team/runs'))
    store.save(stateOf([taskOf()], [bindingOf()]))

    // 宿主形状（ROOT-CAUSE §6 用例 B / 任务卡 ③）：字段名与我们无关，判定只认「payload 里出现了已登记 id」。
    const payload = { id: MEMBER_ID, parentSessionId: SESSION, stopReason: 'completed' }
    h.emitBoth('subagent/end', payload)

    const after = taskOfState(store.load(RUN)!)
    assert.equal(typeof after.silentFinish?.at, 'number', '两路都必须能落 silentFinish（同源判定）')
    assert.equal(silentNoticeCount(store.load(RUN)!), 1, '两路各投一次 = handler 跑两次，通知仍只 1 条（幂等，不靠去重表）')
    assert.equal(after.status, 'running', 'silentFinish 只记事实：不自动 done/rework')

    // 重放同一 payload + 同一成员再来一个 agent/error：at 不刷新、通知不增长。
    const at = after.silentFinish?.at
    h.emitBoth('subagent/end', payload)
    h.emitBoth('agent/error', { id: MEMBER_ID, parentSessionId: SESSION, stopReason: 'error' })
    const replay = taskOfState(store.load(RUN)!)
    assert.equal(replay.silentFinish?.at, at, '重复投递不得刷新 at')
    assert.equal(silentNoticeCount(store.load(RUN)!), 1, '重复投递不得重复通知')
  } finally {
    for (const dispose of h.disposers.reverse()) await dispose()
    rmSync(home, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ④ stale 收口不误杀：「等回执」计入活动；真正死计划仍照样收口
// ─────────────────────────────────────────────────────────────────────────────
test('r40④：silentFinish.at 计入活动 → 30 分钟内不判 stale；真死计划仍收口', () => {
  const waiting = stateOf(
    [
      taskOf({ silentFinish: { at: NOW - 1_000, memberId: MEMBER_ID } }),
      taskOf({ id: 't3', status: 'pending', memberId: undefined }),
    ],
    [bindingOf()],
  )
  assert.equal(lastActivityAtOf(waiting), NOW - 1_000, 'lastActivityAtOf 必须把 silentFinish.at 计入活动')

  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r40-stale-'))
  try {
    const store = new RunsStore(dir)
    store.save(waiting)

    // 30 分钟阈值内不误杀：否则 t1 的 wait 会把**还没开始**的 t3 一起 cancelled。
    assert.deepEqual(reconcileStalePlans(store, { now: NOW + 10 * 60_000 }), [], '10 分钟前有 silentFinish 活动 → 不得收口')
    assert.deepEqual(reconcileStalePlans(store, { now: NOW + 29 * 60_000 }), [], '29 分钟仍未到 30 分钟阈值')
    const kept = store.load(RUN)!
    assert.equal(kept.plan.tasks.find((item) => item.id === 't3')?.status, 'pending', '未开始的任务不许被连坐')
    assert.equal(kept.termination, undefined)

    // 真过期（活动确实超过 30 分钟）：收口照旧，不能把阈值改没了。
    assert.deepEqual(reconcileStalePlans(store, { now: NOW + 31 * 60_000 }), [RUN], '真过期仍要收口')
    const closed = store.load(RUN)!
    assert.equal(closed.termination?.kind, 'stale')
    assert.equal(closed.plan.tasks.find((item) => item.id === 't3')?.status, 'cancelled', '残留任务随收口一并终结')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  // 对照：真正的死计划（无 silentFinish、无消息，只有 60 分钟前的 plannedAt）照样 30 分钟收口。
  const deadDir = mkdtempSync(join(tmpdir(), 'auto-team-r40-dead-'))
  try {
    const deadStore = new RunsStore(deadDir)
    deadStore.save(stateOf([taskOf({ status: 'running' })], [bindingOf()]))
    assert.deepEqual(reconcileStalePlans(deadStore, { now: NOW + 31 * 60_000 }), [RUN], '无任何活动的死计划必须照样收口')
  } finally {
    rmSync(deadDir, { recursive: true, force: true })
  }
})
