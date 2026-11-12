/**
 * r21 测试夹具：真实 `createBridge` + 真实 `RunsStore` + 可注入的成员端口。
 *
 * 为什么不 mock bridge：t3 要验的是「落盘时序」——stopping 必须在 interrupt 之前写到盘上。
 * 只有真实 bridge（真实 store、真实 reviseRun 流程）才能证明这一点；mock 掉 bridge
 * 就等于把被测逻辑一起 mock 掉了。
 *
 * 文件名不匹配 `test/*.test.ts`，所以不会被 `node --test` 当作用例文件执行。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridge, type Bridge } from '../src/host/bridge.ts'
import { createRoleRepo, type RoleRepo } from '../src/host/roles/repo.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { buildToolSpecs } from '../src/host/tools.ts'
import type { ToolSpec } from '../src/host/adapters.ts'
import type { MemberBinding, Plan, PlanTask, TaskStatus } from '../src/shared/types.ts'

export const NOW = 1_700_000_000_000
export const SESSION = 'sess-r21'
export const RUN = 'run-r21'
/** 宿主真实形状：`exec` 上没有 sessionId，会话只在 `agent.id`（r11 真机事故）。 */
export const META = { agent: { id: SESSION }, callId: 'call-1', name: 'auto_team_plan' }

export interface Harness {
  dir: string
  store: RunsStore
  roles: RoleRepo
  bridge: Bridge
  specs: ToolSpec[]
  tools: Map<string, ToolSpec>
  /** `sendMessage` 的实收记录（通道 = 成员 id，正文逐字）。 */
  sent: Array<{ memberId: string; text: string }>
  /** `interruptMember` 的实收成员名。 */
  interrupted: string[]
  /** `autoDispatch` 的实收 (sessionId, runId, cause)。 */
  dispatched: Array<{ sessionId: string; runId: string | undefined; cause: string }>
  call(name: string, args: Record<string, unknown>, meta?: unknown): Promise<Record<string, unknown>>
  /** runs 目录逐字快照（文件名 → 原文），用于「拒绝时零写入」判据。 */
  snapshotRuns(): Record<string, string>
}

export interface HarnessOptions {
  /** 缺省 true：r21 用例都走已启用路径；验「未启用」的用例显式传 false。 */
  enabled?: boolean
  interrupt?: (name: string) => Promise<{ ok: boolean; error?: string }>
  send?: (memberId: string, text: string) => Promise<{ ok: boolean; error?: string }>
  now?: () => number
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r21-'))
  const store = new RunsStore(join(dir, 'runs'))
  const roles = createRoleRepo({ dir: join(dir, 'roles'), now: options.now ?? (() => NOW) })
  roles.seed()

  const sent: Array<{ memberId: string; text: string }> = []
  const interrupted: string[] = []
  const dispatched: Array<{ sessionId: string; runId: string | undefined; cause: string }> = []

  const bridge = createBridge({
    store,
    roles,
    memoryRoots: { publicDir: join(dir, 'memory-public'), projectDir: join(dir, 'memory-project') },
    dataRoot: join(dir, 'data'),
    dispatch: async () => ({ started: [], skipped: [], errors: [] }),
    resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
    applyReceipt: (state) => state,
    sendMessage: async (memberId, text) => {
      if (options.send) return options.send(memberId, text)
      sent.push({ memberId, text })
      return { ok: true }
    },
    gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
    now: options.now ?? (() => NOW),
    interruptMember: async (name) => {
      interrupted.push(name)
      if (options.interrupt) return options.interrupt(name)
      return { ok: true }
    },
  })

  if (options.enabled ?? true) bridge.setEnabled(SESSION, true)

  const specs = buildToolSpecs({
    store,
    roles,
    bridge,
    now: options.now ?? (() => NOW),
    autoDispatch: (sessionId, runId, cause) => {
      dispatched.push({ sessionId, runId, cause })
    },
  })

  function call(name: string, args: Record<string, unknown>, meta: unknown = META): Promise<Record<string, unknown>> {
    const spec = specs.find((item) => item.name === name)
    if (!spec) throw new Error(`工具 ${name} 必须存在`)
    return spec.handler(args, meta) as Promise<Record<string, unknown>>
  }

  function snapshotRuns(): Record<string, string> {
    const runsDir = join(dir, 'runs')
    if (!existsSync(runsDir)) return {}
    const out: Record<string, string> = {}
    for (const name of readdirSync(runsDir).sort()) {
      const full = join(runsDir, name)
      if (!statSync(full).isFile()) continue
      out[name] = readFileSync(full, 'utf8')
    }
    return out
  }

  return { dir, store, roles, bridge, specs, tools: new Map(specs.map((spec) => [spec.name, spec])), sent, interrupted, dispatched, call, snapshotRuns }
}

export function taskOf(id: string, status: TaskStatus, extra: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: `exit ${id}`,
    status,
    ...extra,
  }
}

export function bindingOf(taskId: string, name: string, extra: Partial<MemberBinding> = {}): MemberBinding {
  return {
    taskId,
    roleId: 'dev',
    memberId: `member-${taskId}`,
    name,
    spawnedAt: NOW - 10_000,
    ...extra,
  }
}

export function planOf(over: Partial<Plan> = {}): Plan {
  return {
    runId: RUN,
    sessionId: SESSION,
    createdAt: NOW - 60_000,
    status: 'draft',
    goal: '原始目标',
    tasks: [taskOf('t1', 'running'), taskOf('t2', 'pending')],
    maxConcurrent: 3,
    revisions: [],
    ...over,
  }
}

export function runStateOf(over: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: planOf(),
    plannedAt: NOW - 60_000,
    messages: [],
    bindings: [bindingOf('t1', '开发-1')],
    routeAudits: [],
    ...over,
  }
}

/** 清空 runs 目录的方式：不在夹具里删文件（避免误删 workspace），由每个用例用独立临时目录。 */
export function seed(store: RunsStore, state: RunState): void {
  store.save(state)
}
