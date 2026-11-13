/**
 * r34 QA：**事件路径真的接上了**（`subagent/end` → `recordSilentFinish`）。
 *
 * 为什么不能只测纯函数：r33 的事故形态是「判定函数写得对，但宿主事件里没人调用它」——
 * 只测 `recordSilentFinish` / `isSilentFinish` 时，把 `src/host/index.ts` 里那段调用整块删掉，
 * 单测依然全绿。本文件用真实 `apply()` + 假宿主，把 `subagent/end` 事件真的投进订阅器，
 * 再读**落盘**的 run 文件：删掉接线、删掉「无证据」判据、重复通知，都会在这里变红。
 *
 * 轮询路径（事件源降级）在 `test/silent-finish.test.ts` 用 `reconcileMembers` 覆盖；
 * 本文件最后一条把两路的落盘字段对齐，避免两处各写一套口径。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../src/host/index.ts'
import { RUN_STATE_VERSION, RunsStore, type RunState } from '../src/host/store.ts'
import { reconcileMembers, recordSilentFinish, type HostMember } from '../src/host/team/watcher.ts'
import type { MemberBinding, Plan, PlanTask } from '../src/shared/types.ts'

const SESSION = 'sess-r34-wire'
const RUN = 'run-r34-wire'
const MEMBER_ID = 'm-wire-1'
const MEMBER_NAME = 'dev-t1-wire'

interface FakeToolDef {
  name: string
  execute: (args: unknown, meta: unknown) => Promise<unknown>
}

interface Harness {
  ctx: Record<string, unknown>
  tools: FakeToolDef[]
  disposers: Array<() => void | Promise<void>>
  warnings: string[]
  /** 事件名 → 监听器（`subscribeHostEvent` 走 `ctx.on(event, listener, {global:true})`）。 */
  events: Map<string, Array<(...args: unknown[]) => void>>
  emit(event: string, payload: unknown): void
}

/** 与 `test/wire.test.ts` 同源的假宿主：只提供 `apply()` 真正读取的那几个服务。 */
function makeHarness(): Harness {
  const tools: FakeToolDef[] = []
  const disposers: Array<() => void | Promise<void>> = []
  const warnings: string[] = []
  const events = new Map<string, Array<(...args: unknown[]) => void>>()
  const members = [{ id: MEMBER_ID, name: MEMBER_NAME, status: 'running' }]

  const ctx: Record<string, unknown> = {
    tools: { register: (def: unknown) => void tools.push(def as FakeToolDef) },
    systemPrompt: { section: () => {} },
    webServer: { register: () => {} },
    agents: { currentInitiator: () => ({ id: 'captain', name: 'captain' }) },
    get(name: string): unknown {
      return ctx[name]
    },
    agentTeams: {
      listMembers: async () => members.map((member) => ({ ...member })),
      spawnTeammate: async () => {
        throw new Error('本用例不派发成员')
      },
      sendMessage: async () => {},
    },
    llm: { resolveCallConfig: (config: unknown) => config },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) },
    effect: (dispose: () => void | Promise<void>) => void disposers.push(dispose),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const list = events.get(event) ?? []
      list.push(listener)
      events.set(event, list)
    },
    logger: { warn: (text: string) => void warnings.push(text), info: () => {} },
  }

  return {
    ctx,
    tools,
    disposers,
    warnings,
    events,
    emit(event, payload) {
      for (const listener of events.get(event) ?? []) listener(payload)
    },
  }
}

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
    createdAt: 1_760_000_000_000,
    status: 'dispatching',
    tasks,
    maxConcurrent: 3,
  }
}

function bindingOf(): MemberBinding {
  return {
    taskId: 't1',
    roleId: 'dev',
    memberId: MEMBER_ID,
    name: MEMBER_NAME,
    spawnedAt: 1_760_000_000_100,
  }
}

function stateOf(tasks: PlanTask[], bindings: MemberBinding[]): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: planOf(tasks),
    plannedAt: 1_760_000_000_000,
    messages: [],
    bindings,
    routeAudits: [],
  }
}

const silentMessagesOf = (state: RunState): number =>
  state.messages.filter((message) => /已结束本轮但未提交回执/.test(message.body)).length

test('r34 事件路径：真实 apply() 收到 subagent/end → 落盘 silentFinish + 恰一条 captain→user 通知', async () => {
  const home = mkdtempSync(join(tmpdir(), 'auto-team-r34-wire-'))
  const previousHome = process.env.HOME
  process.env.HOME = home
  const h = makeHarness()
  try {
    apply(h.ctx as never, { workspace: home })
  } finally {
    process.env.HOME = previousHome
  }

  try {
    assert.ok(h.events.has('subagent/end'), 'apply() 必须真的订阅 subagent/end（否则事件路径根本不存在）')
    const store = new RunsStore(join(home, '.dsh/auto-team/runs'))
    store.save(stateOf([taskOf()], [bindingOf()]))

    h.emit('subagent/end', { memberId: MEMBER_ID, name: MEMBER_NAME })

    const after = store.load(RUN)
    assert.ok(after, 'run 必须仍在盘上')
    const task = after.plan.tasks.find((item) => item.id === 't1')!
    assert.equal(typeof task.silentFinish?.at, 'number', '事件路径必须落盘 silentFinish.at')
    assert.equal(task.silentFinish?.memberId, MEMBER_ID)
    // 只记事实：不自动完成、不自动返工、不替成员跑门禁。
    assert.equal(task.status, 'running', '待回执不得把任务改成 done/failed')
    assert.equal(task.evidence, undefined, '不得替成员写门禁证据')

    assert.equal(silentMessagesOf(after), 1, '通知恰一条')
    const notice = after.messages.find((message) => /已结束本轮但未提交回执/.test(message.body))!
    assert.equal(notice.from, 'captain')
    assert.equal(notice.to, 'user')
    assert.equal(notice.taskId, 't1', '通知必须带 taskId（客户端靠它跳到任务行）')
    assert.equal(notice.at, task.silentFinish?.at, '通知时刻与落盘 at 必须同源')
    assert.match(notice.body, /任务 t1/)
    assert.match(notice.body, /auto_team_message/)
    assert.match(notice.body, /auto_team_receipt/)

    // 同一成员重复发终结事件（宿主重放 / agent/error 紧跟 subagent/end）：at 不变、通知仍 1 条。
    const firstAt = task.silentFinish?.at
    h.emit('subagent/end', { memberId: MEMBER_ID, name: MEMBER_NAME })
    h.emit('agent/error', { memberId: MEMBER_ID, name: MEMBER_NAME })
    const replay = store.load(RUN)!
    assert.equal(replay.plan.tasks[0]?.silentFinish?.at, firstAt, '重复事件不得刷新 at')
    assert.equal(silentMessagesOf(replay), 1, '重复事件不得重复通知')
  } finally {
    for (const dispose of h.disposers.reverse()) await dispose()
    rmSync(home, { recursive: true, force: true })
  }
})

test('r34 两路一致：事件路径与轮询路径落盘的 silentFinish 字段/通知正文同口径', () => {
  // 事件路径（与 index.ts:749 同一组调用）。
  const eventState = stateOf([taskOf()], [bindingOf()])
  const at = 1_760_000_000_500
  const eventNext = recordSilentFinish(eventState, {
    taskId: 't1',
    memberId: MEMBER_ID,
    memberName: MEMBER_NAME,
    at,
  })

  // 轮询路径（事件源降级：只有 listMembers 对账）。
  const pollState = stateOf([taskOf()], [bindingOf()])
  const dead: HostMember[] = [{ id: MEMBER_ID, name: MEMBER_NAME, status: 'inactive' }]
  const pollNext = reconcileMembers(pollState, dead, at).state

  const eventTask = eventNext.plan.tasks[0]!
  const pollTask = pollNext.plan.tasks[0]!
  assert.deepEqual(
    { at: eventTask.silentFinish?.at, memberId: eventTask.silentFinish?.memberId },
    { at: pollTask.silentFinish?.at, memberId: pollTask.silentFinish?.memberId },
    '两条路径落盘的观察事实必须逐字段相同',
  )
  const eventBody = eventNext.messages.find((message) => message.taskId === 't1')?.body ?? ''
  const pollBody = pollNext.messages.find((message) => /已结束本轮但未提交回执/.test(message.body))?.body ?? ''
  assert.equal(eventBody, pollBody, '两条路径的通知正文必须同口径（同一句文案）')
})
