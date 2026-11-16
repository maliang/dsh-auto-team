/**
 * r36 回归：**轮询对账不再依赖 initiator 边界**，且失败不再静默吞掉。
 *
 * 事故形态（ROOT-CAUSE.md）：watcher 定时器回调在 initiator 边界外，
 * `listHostMembers(ctx)` 恒抛 NO_CALLER → `catch { return changed }` → `reconcileMembers`
 * 一次都没跑过，成员静默退出因此永远没人发现。本文件锁三件事：
 *
 *   ① `listHostMembers(ctx, rootId)` 有 rootId 时**不看调用者**，直接列该 root 的后代；
 *   ② watcher 用 `plan.sessionId` 当 root，名单失败要经 `onWarn` 报出来且**同一错误只报一次**；
 *      名单恢复后死成员照样落 `silentFinish`；
 *   ③ `lastActivityAtOf` 把 `silentFinish.at` 计入活动 —— 「成员已结束、等回执」的计划
 *      不会被 30 分钟 stale 判定连未开始的任务一起 cancelled。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listHostMembers, onCaptainScopedTriggerEvents } from '../src/host/adapters.ts'
import { createMemberWatcher } from '../src/host/team/watcher.ts'
import { RUN_STATE_VERSION, RunsStore, lastActivityAtOf, reconcileStalePlans, type RunState } from '../src/host/store.ts'
import type { MemberBinding, Plan, PlanTask } from '../src/shared/types.ts'

const SESSION = 'sess-r36-miss'
const RUN = 'run-r36-miss'
const MEMBER_ID = 'm-r36-1'
const MEMBER_NAME = 'dev-t1-r36'
const NOW = 1_760_000_000_000

function taskOf(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 't1',
    title: '实现待回执',
    roleId: 'dev',
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
  return { taskId: 't1', roleId: 'dev', memberId: MEMBER_ID, name: MEMBER_NAME, spawnedAt: NOW - 50_000 }
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

test('r36①：有 rootId 时不等调用者，直接列该 root 的后代（定时器回调也能对账）', async () => {
  const calls: string[] = []
  const ctx = {
    get: (name: string) =>
      name === 'subagents'
        ? {
            listDescendants: async (rootId: string) => {
              calls.push(rootId)
              return [{ id: MEMBER_ID, name: MEMBER_NAME, status: 'inactive' }]
            },
          }
        : undefined,
    logger: { warn: () => {} },
  }

  const members = await listHostMembers(ctx as never, SESSION)
  assert.deepEqual(calls, [SESSION], '必须拿 plan.sessionId 当 root 去列后代')
  assert.equal(members.length, 1)
  assert.equal(members[0]?.id, MEMBER_ID)
  assert.equal(members[0]?.status, 'inactive', '宿主状态要原样带回（对账靠它判 dead）')
})

test('r36③：队长作用域补订确实能收到 subagent/end / agent/error，且没有队长 agent 时如实降级', () => {
  const seen: Array<[string, unknown]> = []
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const captain = {
    id: 'captain',
    name: 'captain',
    ctx: {
      on: (name: string, listener: (...args: unknown[]) => void) => {
        const list = listeners.get(name) ?? []
        list.push(listener)
        listeners.set(name, list)
        return () => {
          const current = listeners.get(name) ?? []
          listeners.set(name, current.filter((item) => item !== listener))
        }
      },
    },
  }
  const ctx = {
    agents: { currentInitiator: () => captain },
    get: () => undefined,
    logger: { warn: () => {} },
  }

  const sub = onCaptainScopedTriggerEvents(ctx as never, (name, payload) => seen.push([name, payload]))
  assert.equal(sub.degraded, false)
  assert.deepEqual([...listeners.keys()].sort(), ['agent/error', 'subagent/end'])

  listeners.get('subagent/end')?.[0]?.({ agentId: MEMBER_ID })
  listeners.get('agent/error')?.[0]?.({ agentId: MEMBER_ID, message: 'boom' })
  assert.equal(seen.length, 2, '两个事件都得进同一个 handler（同源判定）')
  assert.equal(seen[0]?.[0], 'subagent/end')

  sub.stop()
  assert.equal(listeners.get('subagent/end')?.length, 0, 'stop 必须真的摘掉监听器')

  const degraded = onCaptainScopedTriggerEvents({ get: () => undefined, logger: { warn: () => {} } } as never, () => {})
  assert.equal(degraded.degraded, true, '拿不到队长 agent 只能降级（根作用域 + 轮询兜底），不许抛')
})

test('r36②：名单失败经 onWarn 报一次（同错不刷屏），恢复后死成员照常落 silentFinish', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r36-'))
  try {
    const store = new RunsStore(dir)
    store.save(stateOf([taskOf()], [bindingOf()]))

    const warnings: string[] = []
    const roots: Array<string | undefined> = []
    let round = 0
    const watcher = createMemberWatcher({
      store,
      listMembers: async (rootId?: string) => {
        roots.push(rootId)
        round += 1
        if (round <= 2) throw new Error('NO_CALLER: 定时器回调不在任何 initiator 边界内')
        return [{ id: MEMBER_ID, name: MEMBER_NAME, status: 'inactive' }]
      },
      onWarn: (text: string) => warnings.push(text),
      now: () => NOW,
      intervalMs: 1_500,
    })

    await watcher.tick()
    await watcher.tick()
    assert.equal(roots[0], SESSION, '轮询必须用 run 的 plan.sessionId 当 root（不再依赖 initiator）')
    assert.equal(warnings.length, 1, '同一种错误只报一次：两轮失败不等于刷两遍')
    assert.match(warnings[0] ?? '', /成员名单不可得/)
    assert.equal(store.load(RUN)?.plan.tasks[0]?.status, 'running', '名单不可得时不许据此判死')

    await watcher.tick()
    const after = store.load(RUN)?.plan.tasks[0]
    assert.equal(after?.silentFinish?.at, NOW, '名单恢复后：已停成员要落 silentFinish（事件源之外的第二路信号）')
    assert.equal(after?.status, 'interrupted', 'silentFinish 只记事实，任务照旧进 interrupted 等队长处理')
    assert.equal(warnings.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('r36④：silentFinish.at 计入活动 → 「等回执」的计划不会被判 stale 连未开始任务一起 cancelled', () => {
  const waiting = stateOf(
    [
      taskOf({ id: 't1', silentFinish: { at: NOW - 1_000, memberId: MEMBER_ID } }),
      taskOf({ id: 't2', status: 'pending', memberId: undefined }),
    ],
    [bindingOf()],
  )
  assert.equal(lastActivityAtOf(waiting), NOW - 1_000, 'silentFinish.at 必须参与活动时间')

  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r36-stale-'))
  try {
    const store = new RunsStore(dir)
    store.save(waiting)
    const closed = reconcileStalePlans(store, { now: NOW + 10 * 60_000 })
    assert.deepEqual(closed, [], '10 分钟前才有活动 → 远未到 30 分钟 stale 阈值')
    assert.equal(store.load(RUN)?.plan.tasks[1]?.status, 'pending', '未开始的任务不许被连坐')

    const closedLater = reconcileStalePlans(store, { now: NOW + 31 * 60_000 })
    assert.deepEqual(closedLater, [RUN], '真过期了仍然要收口（这条修的是误杀，不是取消收口）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
