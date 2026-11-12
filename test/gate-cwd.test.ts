/**
 * 门禁执行目录（t3）：acceptance 必须跑在**会话工作区**，不是宿主 profile 目录。
 *
 * 真机症状：面板/工具回执里的门禁命令永远在 `~/.dsh/profiles/desktop` 下执行，
 * 用户仓库里的 `pnpm test` / `pwd` 全部找不到（cwd 是宿主启动目录，与当前会话无关）。
 *
 * 这里断言三层：
 *  1. `sessionWorkspaceOf()` 能从宿主 Agent 形状里读出 `session.header.cwd`（宽容读取）；
 *  2. `bridge.act('receipt')` 用 `gate.workspaceOf(sessionId)` 的返回值当 cwd，产物目录也跟着会话走；
 *  3. 取不到会话工作区时回退到装配 `cwd`（旧行为不能被这次修复弄坏）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessionWorkspaceOf } from '../src/host/adapters.ts'
import { createBridge, type Bridge, type BridgeDeps, type ReceiptInput } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import type { PlanTask, Role } from '../src/shared/types.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-gate-cwd'

interface Harness {
  dir: string
  store: RunsStore
  bridge: Bridge
  /** 会话工作区（门禁应当跑在这里）。 */
  sessionWs: string
  /** 装配层回退目录（修复前门禁实际跑在这里）。 */
  hostDir: string
}

function roleOf(id: string, name: string): Role {
  return { id, name, duty: `${name}的职责`, skillIds: [], builtin: false, updatedAt: NOW }
}

function taskOf(over: Partial<PlanTask> = {}): PlanTask {
  return { id: 't1', title: '任务 t1', roleId: 'dev', dependsOn: [], acceptance: 'exit 0', status: 'pending', ...over }
}

function stateOf(over: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: {
      runId: 'run-gate-cwd',
      sessionId: SESSION,
      createdAt: NOW,
      status: 'dispatching',
      tasks: [taskOf()],
      maxConcurrent: 3,
    },
    plannedAt: NOW,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...over,
  }
}

/** 同一份 deps 骨架；`workspaceOf` 缺省 = 旧宿主（取不到会话工作区，必须回退）。 */
function setup(workspaceOf?: (sessionId: string) => string | undefined): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-gate-cwd-'))
  const hostDir = join(dir, 'host-profile')
  const sessionWs = join(dir, 'session-workspace')
  mkdirSync(hostDir, { recursive: true })
  mkdirSync(sessionWs, { recursive: true })

  const store = new RunsStore(join(dir, 'runs'))
  const skillsDir = join(dir, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const roles = createRoleRepo({ dir: join(dir, 'roles'), skillsDir, now: () => NOW })
  roles.seed()
  roles.save(roleOf('dev', '开发'))

  const deps: BridgeDeps = {
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: false }),
    applyReceipt: (state, taskId, receipt: ReceiptInput) => ({
      ...state,
      plan: {
        ...state.plan,
        tasks: state.plan.tasks.map((task) =>
          task.id === taskId
            ? { ...task, status: receipt.verdict === 'done' ? 'done' : 'rework', evidence: receipt.evidence }
            : task,
        ),
      },
    }),
    sendMessage: async () => ({ ok: true }),
    gate: { cwd: hostDir, artifactsDir: join(hostDir, 'artifacts'), workspaceOf },
    now: () => NOW,
  }

  return { dir, store, bridge: createBridge(deps), sessionWs, hostDir }
}

async function enable(bridge: Bridge): Promise<void> {
  const result = await bridge.act(SESSION, { type: 'toggle', enabled: true })
  assert.equal(result.rejected, undefined, '启用动作本身不应被拒')
}

/** `pwd` 在 macOS 上会解析符号链接（/var → /private/var），断言前统一取真实路径。 */
function physical(path: string): string {
  return realpathSync(path)
}

test('sessionWorkspaceOf：只认 session.header.cwd 的非空字符串', () => {
  assert.equal(sessionWorkspaceOf({ session: { header: { cwd: '/repo/alpha' } } }), '/repo/alpha')
  assert.equal(sessionWorkspaceOf({ id: 's1', session: { header: { cwd: '/repo/beta' } } }), '/repo/beta')
  assert.equal(sessionWorkspaceOf({ id: 's1' }), undefined, '没有 session 时必须回退')
  assert.equal(sessionWorkspaceOf({ session: { header: {} } }), undefined, '没有 cwd 时必须回退')
  assert.equal(sessionWorkspaceOf({ session: { header: { cwd: '   ' } } }), undefined, '空白 cwd 视为缺失')
  assert.equal(sessionWorkspaceOf({ session: { header: { cwd: 42 } } }), undefined, '非字符串必须是缺失而不是崩溃')
  assert.equal(sessionWorkspaceOf(null), undefined)
  assert.equal(sessionWorkspaceOf(undefined), undefined)
})

test('receipt 门禁跑在会话工作区，产物目录跟随会话', async () => {
  const h = setup((sessionId) => (sessionId === SESSION ? h.sessionWs : undefined))
  // 会话根下建一个真实的仓库目录，避免把临时目录当成唯一证据。
  mkdirSync(join(h.sessionWs, 'packages'), { recursive: true })
  h.store.save(
    stateOf({
      plan: {
        ...stateOf().plan,
        tasks: [taskOf({ status: 'running', acceptance: 'pwd > gate-cwd.txt' })],
      },
    }),
  )
  await enable(h.bridge)

  const result = await h.bridge.act(SESSION, { type: 'receipt', taskId: 't1' })
  assert.equal(result.rejected, undefined, `回执不应被拒：${result.rejected?.message ?? ''}`)

  const state = h.store.latestForSession(SESSION)
  assert.ok(state, '回执后状态必须落盘')
  const task = state.plan.tasks.find((item) => item.id === 't1')
  assert.equal(task?.status, 'done', '门禁通过后任务必须完成')
  assert.equal(task?.evidence?.exitCode, 0, '门禁必须真的执行且退出码为 0')
  assert.deepEqual(task?.evidence?.artifacts, [join(h.sessionWs, '.auto-team/artifacts/t1.log')])

  const written = join(h.sessionWs, 'gate-cwd.txt')
  assert.ok(existsSync(written), '验收命令的相对路径必须落在会话工作区')
  assert.equal(
    readFileSync(written, 'utf8').trim(),
    physical(h.sessionWs),
    '门禁 cwd 必须是会话工作区（不是宿主 profile 目录）',
  )
  assert.equal(existsSync(join(h.hostDir, 'gate-cwd.txt')), false, '绝不能写到回退的宿主目录')
})

test('取不到会话工作区时回退装配 cwd（旧行为保持）', async () => {
  const h = setup(() => undefined)
  h.store.save(
    stateOf({
      plan: {
        ...stateOf().plan,
        tasks: [taskOf({ status: 'running', acceptance: 'pwd > fallback-cwd.txt' })],
      },
    }),
  )
  await enable(h.bridge)

  const result = await h.bridge.act(SESSION, { type: 'receipt', taskId: 't1' })
  assert.equal(result.rejected, undefined)

  const written = join(h.hostDir, 'fallback-cwd.txt')
  assert.ok(existsSync(written), '解析不到会话时必须回退到装配 cwd，而不是拒绝执行')
  assert.equal(readFileSync(written, 'utf8').trim(), physical(h.hostDir))
  assert.equal(existsSync(join(h.sessionWs, 'fallback-cwd.txt')), false, '回退时不能凭空写进未解析的会话目录')
})

test('done 任务改验收后重跑门禁，同样跑在会话工作区', async () => {
  const h = setup((sessionId) => (sessionId === SESSION ? h.sessionWs : undefined))
  h.store.save(
    stateOf({
      plan: {
        ...stateOf().plan,
        tasks: [taskOf({ status: 'done', acceptance: 'exit 0' })],
      },
    }),
  )
  await enable(h.bridge)

  const first = await h.bridge.act(SESSION, {
    type: 'updateAcceptance',
    taskId: 't1',
    acceptance: 'pwd > gate-recheck.txt',
  })
  assert.ok(first.pendingId, '改验收是 5 类不可逆动作之一，必须先生成待确认项')
  const confirmed = await h.bridge.act(SESSION, { type: 'confirmPending', pendingId: first.pendingId })
  assert.equal(confirmed.rejected, undefined, `确认后不应被拒：${confirmed.rejected?.message ?? ''}`)

  const written = join(h.sessionWs, 'gate-recheck.txt')
  assert.ok(existsSync(written), 'done 任务改验收后的重跑必须落在会话工作区')
  assert.equal(readFileSync(written, 'utf8').trim(), physical(h.sessionWs))
  assert.equal(existsSync(join(h.hostDir, 'gate-recheck.txt')), false)

  const state = h.store.latestForSession(SESSION)
  const task = state?.plan.tasks.find((item) => item.id === 't1')
  assert.equal(task?.status, 'done', '新验收通过后应保持 done')
  assert.equal(task?.evidence?.command, 'pwd > gate-recheck.txt', '证据必须换成本次重跑的命令')
})
