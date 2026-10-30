/**
 * 逐角色模型单测（AC-22）：派发前预校验（解析不出来就拒绝）/ 事后漂移审计 /
 * 拿不到实际路由一律 `unverified`（**不是 ok**）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PlanTask, Role, RoleModelRoute } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, type RunState } from '../src/host/store.ts'
import { auditRoute, preflightRoutes, routeDrift, type RoutePort } from '../src/host/team/route.ts'

const now = 1_700_000_000_000
const routeA: RoleModelRoute = { provider: 'deepseek', model: 'v4' }
const routeB: RoleModelRoute = { provider: 'deepseek', model: 'v4-flash' }

function makeRole(id: string, model?: RoleModelRoute): Role {
  return { id, name: id, duty: '负责交付', skillIds: [], model, builtin: true, updatedAt: now }
}

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 't1',
    title: '实现',
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'pnpm typecheck',
    status: 'running',
    ...overrides,
  }
}

function makeState(tasks: PlanTask[], overrides: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: { runId: 'run-1', sessionId: 's-1', createdAt: now, status: 'dispatching', tasks, maxConcurrent: 3 },
    plannedAt: now,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...overrides,
  }
}

test('preflightRoutes：未声明模型的角色直接通过，且不会去调用宿主解析', async () => {
  let calls = 0
  const port: RoutePort = {
    resolveRoute: async () => {
      calls += 1
      return routeA
    },
  }
  const result = await preflightRoutes([makeRole('dev'), makeRole('qa', routeA)], port)

  assert.deepEqual(result.ok.sort(), ['dev', 'qa'])
  assert.equal(result.failed.length, 0)
  assert.equal(calls, 1, '只有声明了模型的角色才需要预校验')
})

test('preflightRoutes：解析不出来 → 进 failed，带 label 与可读原因（下游可原样展示）', async () => {
  const port: RoutePort = { resolveRoute: async () => null }
  const result = await preflightRoutes([makeRole('dev', { provider: 'fake', model: 'nope' })], port)

  assert.equal(result.ok.length, 0)
  assert.equal(result.failed.length, 1)
  const failure = result.failed[0]!
  assert.equal(failure.roleId, 'dev')
  assert.equal(failure.label, 'fake/nope')
  assert.deepEqual(failure.route, { provider: 'fake', model: 'nope' })
  assert.match(failure.error, /模型路由无法解析：fake\/nope/)
})

test('preflightRoutes：宿主解析抛错也归入 failed（不把异常抛给派发链）', async () => {
  const port: RoutePort = {
    resolveRoute: async () => {
      throw new Error('provider 不存在')
    },
  }
  const result = await preflightRoutes([makeRole('dev', routeA)], port)

  assert.equal(result.failed.length, 1)
  assert.match(result.failed[0]!.error, /provider 不存在/)
})

test('routeDrift：一致不算漂移，不一致/声明缺失才算', () => {
  assert.equal(routeDrift(routeA, { ...routeA }), false)
  assert.equal(routeDrift(routeA, routeB), true)
  assert.equal(routeDrift(routeA, { ...routeA, reasoningEffort: 'high' }), true, 'effort 不同也是漂移')
  assert.equal(routeDrift(null, null), false, '两边都跟随会话默认，不存在漂移')
  assert.equal(routeDrift(routeA, null), true, '声明了模型却没拿到实际值，按漂移处理')
})

test('auditRoute：拿不到实际路由 → verdict=unverified（绝不写成 ok）', () => {
  const state = auditRoute(makeState([makeTask()]), 't1', routeA, null, now)

  assert.equal(state.routeAudits.length, 1)
  assert.equal(state.routeAudits[0]!.verdict, 'unverified')
  assert.equal(state.routeAudits[0]!.actual, null)
  assert.equal(state.plan.tasks[0]!.status, 'running', 'unverified 不应中断任务，只是证据不足')
})

test('auditRoute：声明与实际不一致 → verdict=drift，任务当场 failed 并留队长消息', () => {
  const state = auditRoute(makeState([makeTask()]), 't1', routeA, routeB, now)

  assert.equal(state.routeAudits[0]!.verdict, 'drift')
  assert.equal(state.plan.tasks[0]!.status, 'failed')
  assert.ok(state.messages.some((item) => /路由漂移/.test(item.body)))
  assert.ok(
    state.messages.some((item) => /不会静默回退/.test(item.body)),
    '漂移处置必须显式说明不会静默回退到队长模型',
  )
})

test('auditRoute：一致 → verdict=ok，任务状态不变', () => {
  const state = auditRoute(makeState([makeTask()]), 't1', routeA, { ...routeA }, now)

  assert.equal(state.routeAudits[0]!.verdict, 'ok')
  assert.equal(state.plan.tasks[0]!.status, 'running')
  assert.equal(state.messages.length, 0)
})

test('auditRoute：同一任务只保留一条最新审计（重复事件不堆积）', () => {
  let state = auditRoute(makeState([makeTask()]), 't1', routeA, null, now)
  state = auditRoute(state, 't1', routeA, { ...routeA }, now + 1)

  assert.equal(state.routeAudits.length, 1)
  assert.equal(state.routeAudits[0]!.verdict, 'ok')
  assert.equal(state.routeAudits[0]!.at, now + 1)
})
