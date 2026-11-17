/**
 * r42 回归：spawn 时把**任务名**作为 subagent label 下发。
 *
 * 用户现象：顶部「N 个子智能体」下拉里，成员显示 `t1`/`t2` 而不是任务名。
 * 根因链：`src/host/adapters.ts:1022 subagentLabelOf` 取 `description → taskId → name`
 * 的第一个非空值；而 `src/host/index.ts:408` 的 spawn 端口此前只传 `taskId`，
 * `description` 从未下发 → label 恒等于任务 id。
 *
 * 本文件用**假 ctx 跑真实 `apply()`**，在宿主边界捕获：
 *   - 新宿主路径 `subagents.startActivation({ label })` 的 `label`；
 *   - 旧宿主回退路径 `agentTeams.spawnTeammate(caller, { description })` 的 `description`。
 * 断言的是「宿主真正收到的那个字段」，不是源码里有没有那行字 ——
 * 把 `description: taskLabelOf(input.task)` 删掉（回到只传 taskId）第 1/3 例必红。
 *
 * 假 ctx 只实现 apply 真会调用的成员（形状与 test/wire.test.ts 的宿主桩一致）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/host/index.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import type { PlanTask } from '../src/shared/types.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r42'
const RUN_ID = 'run-r42'

type SpawnMode = 'startActivation' | 'spawnTeammate'

interface SpawnCapture {
  label: string
  description: string
  name: string
  provider: string
}

interface PanelRoute {
  kind: string
  path: string
  handler: (req: FakeReq, res: FakeRes) => Promise<void>
}

interface FakeReq {
  method: string
  url: string
  on(event: string, listener: (chunk?: unknown) => void): void
}

interface FakeRes {
  statusCode: number
  setHeader(name: string, value: string): void
  end(chunk?: string): void
}

interface Harness {
  ctx: Record<string, unknown>
  routes: PanelRoute[]
  spawned: SpawnCapture[]
}

function makeHarness(mode: SpawnMode): Harness {
  const routes: PanelRoute[] = []
  const spawned: SpawnCapture[] = []
  const members: Array<{ id: string; name: string; status: string }> = []
  let seq = 0

  const record = (input: {
    label?: unknown
    description?: unknown
    name?: unknown
    provider?: unknown
  }): void => {
    spawned.push({
      label: typeof input.label === 'string' ? input.label : '',
      description: typeof input.description === 'string' ? input.description : '',
      name: typeof input.name === 'string' ? input.name : '',
      provider: typeof input.provider === 'string' ? input.provider : '',
    })
  }

  const ctx = {
    tools: { register: () => {} },
    systemPrompt: { section: () => {} },
    webServer: { register: (route: unknown) => void routes.push(route as PanelRoute) },
    agents: { currentInitiator: () => ({ id: 'captain', name: 'captain' }) },
    // 可选服务只经 ctx.get 读取（与真宿主同一条路径）。
    get(name: string): unknown {
      return (ctx as Record<string, unknown>)[name]
    },
    agentTeams: {
      listMembers: async () =>
        members.map((member) => ({ ...member })),
      ...(mode === 'spawnTeammate'
        ? {
            spawnTeammate: async (_caller: unknown, request: Record<string, unknown>) => {
              seq += 1
              record(request)
              const member = { id: `m${seq}`, name: String(request.name ?? `member-${seq}`), status: 'running' }
              members.push(member)
              return { member }
            },
          }
        : {}),
    },
    ...(mode === 'startActivation'
      ? {
          subagents: {
            list: () => ['spawn'],
            getProvider: (name: string) => (name === 'spawn' ? { name } : undefined),
            startActivation: async (spec: Record<string, unknown>) => {
              seq += 1
              record(spec)
              const childId = `m${seq}`
              members.push({ id: childId, name: String(spec.name ?? `member-${seq}`), status: 'running' })
              return { childId, name: String(spec.name ?? '') }
            },
          },
        }
      : {}),
    llm: { resolveCallConfig: (config: unknown) => config },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
    effect: () => {},
    on: () => {},
    logger: { warn: () => {}, info: () => {} },
  }

  return { ctx, routes, spawned }
}

async function panel(
  routes: PanelRoute[],
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const route = routes[0]
  assert.ok(route, '面板路由必须已注册')
  const listeners = new Map<string, (chunk?: unknown) => void>()
  const chunks = body === undefined ? [] : [JSON.stringify(body)]
  let sent = ''
  const req: FakeReq = {
    method,
    url,
    on(event, listener) {
      listeners.set(event, listener)
    },
  }
  const res: FakeRes = {
    statusCode: 0,
    setHeader() {},
    end(chunk?: string) {
      sent = chunk ?? ''
    },
  }
  const done = route.handler(req, res)
  for (const chunk of chunks) listeners.get('data')?.(chunk)
  listeners.get('end')?.()
  await done
  return { status: res.statusCode, body: JSON.parse(sent) as Record<string, unknown> }
}

async function act(routes: PanelRoute[], action: Record<string, unknown>): Promise<Record<string, unknown>> {
  const reply = await panel(routes, 'POST', '/api/auto-team/act', { sessionId: SESSION, action })
  assert.equal(reply.status, 200, `面板动作 ${String(action.type)} 应返回 200`)
  assert.equal(reply.body.error, undefined, `面板动作 ${String(action.type)} 不应报错：${String(reply.body.error)}`)
  return (reply.body.data ?? {}) as Record<string, unknown>
}

function task(id: string, title: string): PlanTask {
  return {
    id,
    title,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'true',
    status: 'pending',
  }
}

/**
 * 起一个假宿主 → 启用 → 直接落一条 run（绕开 plan 工具对空标题的拒绝）→ 面板派发。
 *
 * 为什么直接落盘：`plan` 工具会 `title.trim()` 并拒绝空标题，而「标题为空/只有空白」
 * 的现实来源是**旧 run / 手改过的状态文件**，派发层仍必须安全降级（不抛、不甩正文）。
 */
async function dispatchTitle(mode: SpawnMode, title: string): Promise<SpawnCapture> {
  const home = mkdtempSync(join(tmpdir(), `auto-team-r42-${mode}-`))
  const previousHome = process.env.HOME
  const h = makeHarness(mode)
  try {
    process.env.HOME = home
    try {
      apply(h.ctx as never, { workspace: home })
    } finally {
      process.env.HOME = previousHome
    }

    const roles = createRoleRepo({
      dir: join(home, '.dsh/auto-team/roles'),
      skillsDir: join(home, '.dsh/auto-team/skills'),
      now: () => NOW,
    })
    const saved = roles.save({
      id: 'dev',
      name: '开发',
      duty: '写代码',
      skillIds: [],
      model: { provider: 'deepseek', model: 'deepseek-chat' },
      builtin: false,
      updatedAt: NOW,
    })
    assert.equal(saved.ok, true, `角色必须能落盘：${saved.ok ? '' : saved.error}`)

    const toggled = await act(h.routes, { type: 'toggle', enabled: true })
    assert.ok(toggled.snapshot, '启用必须返回快照')

    const store = new RunsStore(join(home, '.dsh/auto-team/runs'))
    const state: RunState = {
      version: RUN_STATE_VERSION,
      plan: {
        runId: RUN_ID,
        sessionId: SESSION,
        createdAt: NOW,
        status: 'draft',
        goal: 'label 回归',
        tasks: [task('t-long', title)],
        maxConcurrent: 3,
      },
      plannedAt: NOW,
      messages: [],
      bindings: [],
      routeAudits: [],
    }
    store.save(state)

    const dispatched = await act(h.routes, { type: 'dispatch', runId: RUN_ID })
    assert.ok(dispatched.snapshot, '派发必须返回快照')
    assert.equal(h.spawned.length, 1, `必须恰好创建一个成员，实际 ${h.spawned.length}`)
    return h.spawned[0] as SpawnCapture
  } finally {
    process.env.HOME = previousHome
  }
}

/** 期望的 label：标题第一行、按 code point 截到 60（含省略号占 1 位）。 */
function expectedLabel(title: string): string {
  const firstLine = title.split(/\r?\n/, 1)[0].trim()
  const chars = Array.from(firstLine)
  return chars.length <= 60 ? firstLine : `${chars.slice(0, 59).join('')}…`
}

test('r42-1 新宿主：startActivation.label = 任务名第一行，按 code point 截到 60 且带省略号', async () => {
  const firstLine = `很长的多行标题${'甲'.repeat(70)}`
  const title = `${firstLine}\n第二行不该出现在 label 里 ${'乙'.repeat(200)}`
  const capture = await dispatchTitle('startActivation', title)

  const expected = expectedLabel(title)
  assert.equal(Array.from(expected).length, 60, '判据自身必须先满足 60 位（防止期望值写错）')
  assert.equal(capture.label, expected, '宿主收到的 label 必须等于「标题第一行截断 60 + …」')
  assert.ok(!capture.label.includes('\n'), 'label 不得含换行')
  assert.ok(!capture.label.includes('第二行'), 'label 不得包含标题后续行')
  assert.notEqual(capture.label, 't-long', 'label 不能退化成 taskId')
})

test('r42-2 标题空白：description 安全退化为空串（不抛错、不甩任务卡正文）', async () => {
  const title = `   \n第二行是正文：acceptance=pnpm typecheck，roleId=dev，${'丙'.repeat(500)}`
  const capture = await dispatchTitle('spawnTeammate', title)

  assert.equal(capture.description, '', '空白标题的 description 必须是空串（不是任务卡正文）')
  assert.ok(!capture.description.includes('\n'), 'description 不得含换行')
  assert.ok(!capture.description.includes('acceptance='), 'description 不得把任务卡正文甩给宿主')
  // 成员名不变（退化只影响 label/description，不影响幂等匹配用的名字）。
  assert.match(capture.name, /^dev-t-long-[0-9a-z]+$/, `成员名形状不得改变：${capture.name}`)
})

test('r42-3 旧宿主回退路径：description 优先于 taskId，宿主收到的是任务名', async () => {
  const title = `修复登录跳转\n第二行细节`
  const capture = await dispatchTitle('spawnTeammate', title)

  assert.equal(capture.description, '修复登录跳转', 'description 必须等于标题第一行')
  assert.notEqual(capture.description, 't-long', 'description 不能退化成 taskId')
  // 成员名仍是 <roleId>-<taskId>-<suffix>（幂等/复用匹配依赖它，不得回归）。
  assert.match(capture.name, /^dev-t-long-[0-9a-z]+$/, `成员名形状不得改变：${capture.name}`)
  assert.equal(capture.provider, 'spawn', 'provider 仍是 subagent provider 名（不是 LLM provider）')
})

test('r42-4 新宿主：description 存在时 label 优先取它，而不是 taskId', async () => {
  const title = '把任务名当 label'
  const capture = await dispatchTitle('startActivation', title)

  assert.equal(capture.label, '把任务名当 label', 'label 必须来自 description（任务名）')
  assert.notEqual(capture.label, 't-long', 'description 存在时不得回退到 taskId')
})
