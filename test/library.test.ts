/**
 * r13 T5：项目库装配 / 历史详情 / 记忆索引 / 路由（AC-15、AC-17、AC-21、AC-22、AC-23）。
 *
 * 这里刻意用**真 store + 真临时目录**（不是 mock 掉一切）：旧 run 归一、坏文件跳过、
 * 目录 mtime 缓存这些行为只有走真实 IO 才测得到；角色仓与记忆索引则用纯桩
 * （它们不属于本模块的职责，mock 掉反而更清楚边界）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { LibraryView, MemoryItemView, PlanTask, RunSummary } from '../src/shared/types.ts'
import type { Bridge } from '../src/host/bridge.ts'
import type { RunState } from '../src/host/store.ts'
import { RUN_STATE_VERSION, RunsStore } from '../src/host/store.ts'
import {
  UNKNOWN_PROJECT_ID,
  UNKNOWN_PROJECT_NAME,
  buildLibrary,
  createLibraryCache,
  flowOf,
  isKnownWorkspace,
  projectNameOf,
  runDetailOf,
  runDurationOf,
} from '../src/host/library.ts'
import { listMemoryItems } from '../src/host/memory/repo.ts'
import { buildHttpRoutes } from '../src/host/http.ts'
import { HISTORY_PAGE_SIZE, PROJECT_RUN_LIMIT } from '../src/shared/const.ts'

/* ───────────────────────────── 夹具 ───────────────────────────── */

function taskOf(id: string, over: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'true',
    status: 'ready',
    ...over,
  }
}

function stateOf(
  over: Partial<Omit<RunState, 'plan'>> & { plan?: Partial<RunState['plan']> } = {},
): RunState {
  const { plan: planOver, ...rest } = over
  return {
    version: RUN_STATE_VERSION,
    plannedAt: 1_100,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...rest,
    plan: {
      runId: 'run-1',
      sessionId: 's1',
      createdAt: 1_000,
      status: 'dispatching',
      tasks: [taskOf('t1')],
      maxConcurrent: 3,
      ...planOver,
    },
  }
}

function tempRuns(): { dir: string; store: RunsStore } {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-library-'))
  return { dir, store: new RunsStore(dir) }
}

function memoryItem(name: string, updatedAt: number): MemoryItemView {
  return { track: 'project', name, title: name, updatedAt, tokenEstimate: 2, tokenBasis: 'estimate' }
}

function depsFor(
  store: RunsStore,
  over: Partial<Parameters<typeof buildLibrary>[0]> = {},
): Parameters<typeof buildLibrary>[0] {
  return {
    store,
    workspace: '/work/current',
    now: () => 10_000,
    publicMemories: () => [memoryItem('pub.md', 1)],
    projectMemories: (workspace) => [memoryItem(`${projectNameOf(workspace)}-proj.md`, 2)],
    ...over,
  }
}

/* ───────────────────────────── AC-15 项目分组 ───────────────────────────── */

test('projectNameOf：basename / 尾斜杠 / 缺省（AC-15 未知项目）', () => {
  assert.equal(projectNameOf(undefined), UNKNOWN_PROJECT_NAME)
  assert.equal(projectNameOf('   '), UNKNOWN_PROJECT_NAME)
  assert.equal(projectNameOf('/a/b/'), 'b')
  assert.equal(projectNameOf('/a/b'), 'b')
  assert.equal(projectNameOf('b'), 'b')
})

test('项目列表 = runs 的 project 去重 ∪ 当前工作区；未知项目固定末位，按最近活跃倒序（AC-15）', () => {
  const { store } = tempRuns()
  store.save(stateOf({ plan: { runId: 'r-old', createdAt: 1_000 }, project: '/work/old' }))
  store.save(stateOf({ plan: { runId: 'r-new', createdAt: 5_000 }, project: '/work/new' }))
  store.save(stateOf({ plan: { runId: 'r-legacy', createdAt: 9_000 } })) // 旧 run：无 project
  store.save(stateOf({ plan: { runId: 'r-new-2', createdAt: 6_000 }, project: '/work/new' }))

  const view = buildLibrary(depsFor(store))
  const names = view.projects.map((project) => project.name)
  // 未知项目一定在最后；其余按最近活跃倒序（r-legacy 的 9_000 不算进任何已知项目）。
  assert.deepEqual(names, ['new', 'old', 'current', UNKNOWN_PROJECT_NAME])
  assert.equal(view.projects.at(-1)?.id, UNKNOWN_PROJECT_ID)
  assert.equal(view.projects.at(-1)?.unknown, true)
  // 同路径只有 1 行，runs 数按 run 聚合。
  assert.equal(view.projects.filter((project) => project.path === '/work/new').length, 1)
  assert.equal(view.projects.find((project) => project.path === '/work/new')?.runs, 2)
  // 当前工作区即便一次没跑过也必须在列（AC-15「∪ 当前工作区」）。
  assert.equal(view.projects.find((project) => project.path === '/work/current')?.runs, 0)
  assert.equal(view.currentProject, '/work/current')
})

test('每项目 recentRuns ≤ PROJECT_RUN_LIMIT，历史 runs ≤ HISTORY_PAGE_SIZE 且 createdAt 倒序（AC-21）', () => {
  const { store } = tempRuns()
  for (let index = 0; index < PROJECT_RUN_LIMIT + 5; index += 1) {
    store.save(
      stateOf({ plan: { runId: `r${index}`, createdAt: 1_000 + index }, project: '/work/current' }),
    )
  }
  const view = buildLibrary(depsFor(store))
  const project = view.projects.find((item) => item.path === '/work/current')
  assert.equal(project?.runs, PROJECT_RUN_LIMIT + 5)
  assert.equal(project?.recentRuns.length, PROJECT_RUN_LIMIT)
  assert.equal(project?.recentRuns[0]?.runId, 'r24')
  assert.equal(view.runs?.length, Math.min(PROJECT_RUN_LIMIT + 5, HISTORY_PAGE_SIZE))
  assert.equal(view.runs?.[0]?.runId, 'r24')
})

test('记忆索引：全局走 public、项目走 project；未知项目没有记忆轨（AC-16）', () => {
  const { store } = tempRuns()
  store.save(stateOf({ plan: { runId: 'r1' }, project: '/work/old' }))
  store.save(stateOf({ plan: { runId: 'r2', createdAt: 500 } }))

  const seen: string[] = []
  const deps = depsFor(store, {
    projectMemories: (workspace) => {
      seen.push(workspace)
      return [memoryItem(`${projectNameOf(workspace)}-only.md`, 2)]
    },
  })
  const view = buildLibrary(deps)
  assert.deepEqual(view.global.memories.map((item) => item.name), ['pub.md'])
  const old = view.projects.find((project) => project.path === '/work/old')
  assert.deepEqual(old?.memories.map((item) => item.name), ['old-only.md'])
  assert.deepEqual(view.projects.at(-1)?.memories, [])
  // 未知项目不扫项目记忆目录（没有可信路径，扫了就是拿当前工作区冒充）。
  assert.ok(!seen.includes(''))
})

/* ───────────────────────────── 历史详情（AC-21） ───────────────────────────── */

test('runId → detail：任务/角色/流转图/用时/token 全部由宿主算好（AC-21）', () => {
  const { store } = tempRuns()
  store.save(
    stateOf({
      plan: {
        runId: 'r-detail',
        tasks: [
          taskOf('t1', { status: 'done' }),
          taskOf('t2', { dependsOn: ['t1'], status: 'running', roleId: 'qa' }),
          taskOf('t3', { dependsOn: ['t1'], status: 'ready', roleId: 'qa' }),
        ],
      },
      project: '/work/old',
      usage: {
        attribution: 'per-member',
        byMember: { m1: { total: 1_000 } },
        byTask: { t1: { total: 1_000, input: 400, output: 600 } },
        total: { total: 1_000 },
        updatedAt: 1,
      },
      taskTimes: { t1: { startedAt: 1_000, endedAt: 65_000 } },
      messages: [
        { at: 1, from: 'captain', to: 'dev-t1', taskId: 't1', body: 'go' },
        { at: 2, from: 'captain', to: 'dev-t1', taskId: 't1', body: 'again' },
      ],
      finishedAt: 70_000,
    }),
  )

  const view = buildLibrary(
    depsFor(store, { roles: () => [{ id: 'dev', name: '开发' }, { id: 'qa', name: '测试' }] }),
    { runId: 'r-detail' },
  )
  const detail = view.detail
  assert.ok(detail, 'detail 必须装配出来')
  assert.equal(detail?.runId, 'r-detail')
  assert.equal(detail?.project, '/work/old')
  assert.equal(detail?.usage.source, 'provider')
  assert.equal(detail?.usage.tokens?.total, 1_000)
  assert.equal(detail?.duration.text, '1 分 08 秒') // 68_900ms：formatDuration 向下取整到秒
  assert.equal(detail?.duration.state, 'done')

  const t1 = detail?.tasks.find((item) => item.id === 't1')
  assert.equal(t1?.roleName, '开发')
  assert.equal(t1?.messageCount, 2)
  assert.equal(t1?.duration.text, '1 分 04 秒') // 64_000ms
  assert.equal(t1?.usage.tokens?.input, 400)
  const t2 = detail?.tasks.find((item) => item.id === 't2')
  assert.equal(t2?.duration.state, 'not-started')
  assert.equal(t2?.duration.text, '未开始')
  assert.equal(t2?.usage.source, 'unavailable') // aggregate-only/per-member 都没这个任务的数
  assert.ok((t2?.usage.reason ?? '').length > 0, '不可得必须带原因')

  const roles = detail?.roles ?? []
  assert.deepEqual(roles.map((role) => [role.roleId, role.tasks]), [['dev', 1], ['qa', 2]])
  assert.equal(roles[0]?.usage.tokens?.total, 1_000)
  assert.equal(roles[1]?.usage.source, 'unavailable')
  // r16 AC-16：历史详情同样投影 taskRefs（按计划顺序、真实状态）
  assert.deepEqual(roles.map((role) => role.taskRefs), [
    [{ id: 't1', status: 'done' }],
    [
      { id: 't2', status: 'running' },
      { id: 't3', status: 'ready' },
    ],
  ])

  assert.deepEqual(
    detail?.flow.nodes.map((node) => [node.id, node.column, node.row]),
    [['t1', 0, 0], ['t2', 1, 0], ['t3', 1, 1]],
  )
  // r16 AC-12：节点带 roleId（客户端据此分列，不再信任 column）
  assert.deepEqual(detail?.flow.nodes.map((node) => [node.id, node.roleId]), [
    ['t1', 'dev'],
    ['t2', 'qa'],
    ['t3', 'qa'],
  ])
  assert.equal(detail?.flow.columns, 2)
  assert.equal(detail?.flow.rows, 2)
  assert.deepEqual(
    detail?.flow.edges.map((edge) => `${edge.from}->${edge.to}:${edge.upstreamDone}`),
    ['t1->t2:true', 't1->t3:true'],
  )
})

test('缺 project / 缺 finishedAt 的旧 run：未知项目 + 不可得，绝不伪造 0（AC-21）', () => {
  const { store } = tempRuns()
  store.save(
    stateOf({ plan: { runId: 'r-old', status: 'terminated' }, finishedAt: undefined, usage: undefined }),
  )
  const detail = buildLibrary(depsFor(store), { runId: 'r-old' }).detail
  assert.equal(detail?.project, undefined)
  assert.equal(detail?.usage.source, 'unavailable')
  assert.equal(detail?.duration.state, 'unavailable')
  assert.equal(detail?.duration.text, '不可得')
})

test('runDurationOf：进行中的 run 用 now 推当前耗时，终态缺结束时刻记不可得', () => {
  const running = runDurationOf(stateOf({ plannedAt: 1_000 }), 61_000)
  assert.equal(running.state, 'running')
  assert.equal(running.text, '1 分 00 秒')
  const cancelled = runDurationOf(stateOf({ plan: { status: 'cancelled' }, plannedAt: 1_000 }), 61_000)
  assert.equal(cancelled.state, 'unavailable')
})

test('flowOf：环依赖不抛错（坏数据也要能画出来）', () => {
  const tasks = [
    { ...taskOf('a', { dependsOn: ['b'] }) },
    { ...taskOf('b', { dependsOn: ['a'] }) },
  ].map((task) => ({
    id: task.id,
    title: task.title,
    roleId: task.roleId,
    roleName: task.roleId,
    status: task.status,
    dependsOn: task.dependsOn,
    acceptance: task.acceptance,
    usage: { source: 'unavailable' as const, reason: 'x' },
    duration: { state: 'not-started' as const, text: '未开始' },
    messageCount: 0,
  }))
  const flow = flowOf(tasks)
  assert.equal(flow.nodes.length, 2)
  assert.ok(flow.columns >= 1)
})

/* ───────────────────────────── 工作区白名单（AC-16） ───────────────────────────── */

test('isKnownWorkspace：当前工作区与既有 run 的 project 允许，其它/越界一律拒绝', () => {
  const { store } = tempRuns()
  store.save(stateOf({ plan: { runId: 'r1' }, project: '/work/old' }))
  const deps = depsFor(store)
  assert.equal(isKnownWorkspace(deps, '/work/current'), true)
  assert.equal(isKnownWorkspace(deps, '/work/current/sub'), true)
  assert.equal(isKnownWorkspace(deps, '/work/old'), true)
  assert.equal(isKnownWorkspace(deps, '/work/other'), false)
  assert.equal(isKnownWorkspace(deps, '/etc'), false)
  assert.equal(isKnownWorkspace(deps, '/work/current/../other'), false)
  assert.equal(isKnownWorkspace(deps, ''), false)
})

/* ───────────────────────────── 缓存（AC-23） ───────────────────────────── */

test('缓存命中不再重算（同一键 + TTL 内只装配一次），runId 变化要重算', () => {
  const { dir, store } = tempRuns()
  store.save(stateOf({ plan: { runId: 'r1' } }))
  let builds = 0
  const deps = depsFor(store, {
    runsDir: dir,
    now: () => 1_000,
    publicMemories: () => {
      builds += 1
      return [memoryItem('pub.md', 1)]
    },
  })
  const cache = createLibraryCache(deps)
  cache.view({})
  cache.view({})
  assert.equal(builds, 1, '同键同 TTL 内必须命中缓存')
  cache.view({ runId: 'r1' })
  assert.equal(builds, 2, 'runId 参与缓存键，必须重算')
  cache.invalidate()
  cache.view({})
  assert.equal(builds, 3, 'invalidate 后必须重算')
})

test('缓存：目录新增 run 后键变化（mtime/文件数），不需要手动 invalidate', () => {
  const { dir, store } = tempRuns()
  let builds = 0
  const deps = depsFor(store, {
    runsDir: dir,
    now: () => 1_000,
    publicMemories: () => {
      builds += 1
      return []
    },
  })
  const cache = createLibraryCache(deps)
  cache.view({})
  store.save(stateOf({ plan: { runId: 'r-new' }, project: '/work/current' }))
  const view = cache.view({})
  assert.equal(builds, 2)
  assert.equal(view.projects.find((project) => project.path === '/work/current')?.runs, 1)
})

/* ───────────────────────────── 记忆索引（AC-17） ───────────────────────────── */

test('listMemoryItems：标题取 # 标题、无标题退化成文件名，token 是 ≈ 估算（AC-17）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-memory-'))
  writeFileSync(join(dir, 'alpha.md'), '# 面板口径\n- [pm/t1 · 10-30 14:02] 内容\n', 'utf8')
  writeFileSync(join(dir, 'beta.md'), '- [pm/t1 · 10-30 14:02] 没有标题\n', 'utf8')
  writeFileSync(join(dir, 'notes.txt'), 'ignored', 'utf8')
  mkdirSync(join(dir, 'sub.md'))
  // 显式给 mtime：同目录连续写文件的 mtime 可能同毫秒，排序断言会飘。
  utimesSync(join(dir, 'alpha.md'), new Date(1_000_000), new Date(1_000_000))
  utimesSync(join(dir, 'beta.md'), new Date(2_000_000), new Date(2_000_000))
  utimesSync(join(dir, 'notes.txt'), new Date(3_000_000), new Date(3_000_000))

  const items = listMemoryItems(dir, 'project')
  // updatedAt 倒序；'.txt' 不进索引（否则点开读的是被补成 .md 的不存在文件）。
  assert.deepEqual(items.map((item) => item.name), ['beta.md', 'alpha.md'])
  assert.deepEqual(items.map((item) => item.updatedAt), [2_000_000, 1_000_000])
  assert.equal(items.find((item) => item.name === 'alpha.md')?.title, '面板口径')
  assert.equal(items.find((item) => item.name === 'beta.md')?.title, 'beta')
  for (const item of items) {
    assert.equal(item.tokenBasis, 'estimate')
    assert.equal(item.track, 'project')
    assert.ok(item.tokenEstimate > 0)
    assert.ok(item.updatedAt > 0)
  }
  assert.deepEqual(listMemoryItems(join(dir, 'missing'), 'public'), [])
})

/* ───────────────────────────── 路由（AC-22） ───────────────────────────── */

interface RouteCall {
  method: string
  path: string
  handle: (request: { url?: string; json?: () => Promise<unknown> }) => Promise<unknown>
}

function routesOf(over: { library?: (query: { sessionId?: string; runId?: string }) => LibraryView } = {}): RouteCall[] {
  const memoryCalls: unknown[][] = []
  const bridge = {
    snapshot: () => ({}),
    library: (query: { sessionId?: string; runId?: string }) => ({ ...query, projects: [] }),
    readMemoryFile: async (...args: unknown[]) => {
      memoryCalls.push(args)
      return { error: '未授权的工作区' }
    },
    act: async () => ({ ok: true }),
  }
  const routes = buildHttpRoutes({
    bridge: bridge as unknown as Bridge,
    defaultSessionId: () => 'default',
    ...over,
  }) as unknown as RouteCall[]
  ;(routes as unknown as { memoryCalls: unknown[][] }).memoryCalls = memoryCalls
  return routes
}

test('恰好 4 条路由，且 /library 带 runId 透传、/memory 透传 workspace（AC-22/AC-16）', async () => {
  const routes = routesOf()
  assert.deepEqual(
    routes.map((route) => `${route.method} ${route.path.split('/').at(-1)}`),
    ['GET snapshot', 'GET library', 'GET memory', 'POST act'],
  )

  const library = routes[1]
  assert.ok(library)
  const view = (await library.handle({ url: '/api/auto-team/library?sessionId=s1&runId=r1' })) as {
    data: { sessionId?: string; runId?: string }
  }
  assert.equal(view.data.sessionId, 's1')
  assert.equal(view.data.runId, 'r1')

  const memory = routes[2]
  assert.ok(memory)
  const result = (await memory.handle({
    url: '/api/auto-team/memory?track=project&name=a.md&workspace=%2Fwork%2Fold',
  })) as { error?: string }
  assert.equal(result.error, '未授权的工作区')
  const calls = (routes as unknown as { memoryCalls: unknown[][] }).memoryCalls
  assert.deepEqual(calls[0], ['project', 'a.md', '/work/old', 'default'])
})

test('/library 未注入装配时回落到 bridge.library（同一端口，不留第二条路径）', async () => {
  const routes = routesOf()
  const view = (await routes[1]?.handle({ url: '/api/auto-team/library?sessionId=s9' })) as {
    data: { sessionId?: string }
  }
  assert.equal(view.data.sessionId, 's9')
})

test('runs 摘要排序与 usage 直方图：不带数字的 run 在项目合计里被跳过而不是记 0（AC-21）', () => {
  const { store } = tempRuns()
  store.save(
    stateOf({
      plan: { runId: 'r-a', createdAt: 1_000 },
      project: '/work/current',
      usage: {
        attribution: 'per-member',
        byMember: {},
        byTask: {},
        total: { total: 250 },
        updatedAt: 1,
      },
    }),
  )
  store.save(stateOf({ plan: { runId: 'r-b', createdAt: 2_000 }, project: '/work/current' }))
  const view = buildLibrary(depsFor(store))
  const project = view.projects.find((item) => item.path === '/work/current')
  assert.equal(project?.usage.tokens?.total, 250)
  const summaries = project?.recentRuns ?? []
  assert.deepEqual(summaries.map((item) => item.runId), ['r-b', 'r-a'])
})

test('历史回退列表（library.runs）派生 usage 六项；缺用量记「不可得」而不是 0（r17）', () => {
  const { store } = tempRuns()
  store.save(
    stateOf({
      plan: { runId: 'r-token', createdAt: 2_000 },
      usage: {
        attribution: 'per-member',
        byMember: {},
        byTask: {},
        total: { total: 1_234, input: 1_000, output: 234 },
        updatedAt: 1,
      },
    }),
  )
  store.save(stateOf({ plan: { runId: 'r-empty', createdAt: 1_000 } }))
  const runs = buildLibrary(depsFor(store)).runs ?? []
  assert.deepEqual(runs.map((run) => run.runId), ['r-token', 'r-empty'])

  // snapshot 缺席时历史页退回 library.runs —— 必须与 bridge.historyOf 一样带 text + 六项。
  const cell = runs[0]?.usage
  assert.equal(cell?.source, 'provider')
  assert.equal(cell?.text, '1.23K', 'r19：合计与 details 同一口径（动态单位）')
  assert.deepEqual(
    cell?.details?.map((metric) => metric.key),
    ['input', 'cacheRead', 'cacheWrite', 'output', 'calls', 'hitRate'],
  )
  // r18b t6 起 details 里的 token 带单位；r19 起合计 cell.text 同口径。
  assert.equal(cell?.details?.find((metric) => metric.key === 'input')?.text, '1.00K')
  // 未上报分项是「不可得」，不补 0。
  assert.equal(cell?.details?.find((metric) => metric.key === 'cacheRead')?.available, false)

  const empty = runs[1]?.usage
  assert.equal(empty?.source, 'unavailable')
  assert.ok((empty?.reason ?? '').length > 0, '不可得必须带原因')
  assert.equal(empty?.tokens, undefined)
})
