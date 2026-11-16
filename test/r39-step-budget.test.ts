/**
 * r39 回归：成员「步数与上下文预算」段 + 队长任务卡纪律 + 机械步数提醒。
 *
 * 成本 ≈ 步数² × 每步新增上下文（实测 296 步只 compress 9 次）。本轮不造新护栏，只加三样：
 *  - ① 成员提示词新增 `## 步数与上下文预算（硬指标）`：≤500 字符、四条逐字、位置在读取纪律之后；
 *  - ② 队长 `captainSection` 的「工作方式」里加任务卡纪律（≤3 文件 / path:line / >40 步拆卡）；
 *  - ③ watcher 到阈值（默认 40）给成员发**一条**提醒，幂等、不阻断、不改任务状态。
 *
 * 断言有效性：每条判据都问过「改回错误实现会不会红」——把阈值判断从 `>=` 改回 `>`，40 次那条红；
 * 把幂等键从 messageId 改回正文匹配，41 次那条红；把 `active` 判定去掉、对 done 任务也提醒，
 * 「收口后不提醒」红；删掉提示词四条中的任一条，逐字断言红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Plan, PlanTask, Role } from '../src/shared/types.ts'
import { RUN_STATE_VERSION, RunsStore, wrapLegacy, type RunState } from '../src/host/store.ts'
import type { Bridge } from '../src/host/bridge.ts'
import { buildMemberPrompt } from '../src/host/team/member-prompt.ts'
import { captainSection, type PromptDeps } from '../src/host/prompt.ts'
import {
  createMemberWatcher,
  stepReminderKeyOf,
  stepReminderTextOf,
  stepRemindersOf,
  type HostMember,
} from '../src/host/team/watcher.ts'
import { createSettingsRepo } from '../src/host/settings.ts'

const NOW = 1_700_000_000_000
const SESSION = 'sess-r39'
const RUN = 'run-r39'

const plan: Plan = {
  runId: RUN,
  sessionId: SESSION,
  createdAt: NOW - 60_000,
  status: 'dispatching',
  tasks: [],
  maxConcurrent: 3,
}

function makeTask(id: string, status: PlanTask['status'] = 'running'): PlanTask {
  return {
    id,
    title: `任务${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'exit 0',
    status,
  }
}

function makeRole(): Role {
  return { id: 'dev', name: '开发', duty: '负责交付', skillIds: [], builtin: true, updatedAt: NOW }
}

function makeState(tasks: PlanTask[], overrides: Partial<RunState> = {}): RunState {
  return {
    version: RUN_STATE_VERSION,
    plan: { ...plan, tasks },
    plannedAt: NOW - 60_000,
    messages: [],
    bindings: [],
    routeAudits: [],
    ...overrides,
  }
}

function bindingOf(taskId: string, memberId = 'm-1', name = 'dev-t1') {
  return { taskId, roleId: 'dev', memberId, name, spawnedAt: NOW - 10_000 }
}

/**
 * 取 `## ` 段正文：标题行之后到下一个 `## ` 标题之前。
 * 空串标题（正文里不会出现）直接抛，避免 `indexOf` 返回 0 时的假绿。
 */
function sectionBodyOf(text: string, heading: string): string {
  const at = text.indexOf(heading)
  assert.ok(at > 0, `提示词必须包含段落「${heading}」`)
  const start = text.indexOf('\n', at) + 1
  assert.ok(start > at, `段落「${heading}」必须是多行标题`)
  const next = text.indexOf('\n## ', at)
  const body = next > start ? text.slice(start, next) : text.slice(start)
  assert.ok(body.trim() !== '', `段落「${heading}」不能是空段`)
  return body
}

/* ------------------------------------------------------------------ ① 成员提示词 */

test('r39① 步数预算段：≤500 字符、四条逐字、位于读取纪律之后验收判定之前', () => {
  const task = makeTask('t1')
  const prompt = buildMemberPrompt(
    { plan, task, role: makeRole(), name: 'dev-t1' },
    { memoryFor: () => ({ text: '', truncated: false }) },
  )

  const heading = '## 步数与上下文预算（硬指标）'
  const workAt = prompt.indexOf('## 工作纪律')
  const readAt = prompt.indexOf('## 读取纪律')
  const stepAt = prompt.indexOf(heading)
  const acceptAt = prompt.indexOf('## 验收判定')
  assert.ok(workAt >= 0 && readAt >= 0 && acceptAt >= 0, '三段既有契约标题必须都在（工作纪律/读取纪律/验收判定）')
  assert.ok(stepAt >= 0, '必须有「## 步数与上下文预算（硬指标）」段')
  assert.ok(readAt < stepAt, '步数预算必须排在「读取纪律」之后（先读得少，再谈何时停）')
  assert.ok(stepAt < acceptAt, '步数预算必须排在「验收判定」之前（成员先知道预算，再看门禁命令）')

  const body = sectionBodyOf(prompt, heading)
  assert.ok(
    [...body].length <= 500,
    `步数预算段正文必须 ≤500 字符（每次 spawn 都进上下文；实测 ${[...body].length}）`,
  )

  // 四条都是命令级硬指标：逐字钉住，防止以后被「优化」成口号。
  const phrases = [
    '单任务目标 ≤60 次工具调用',
    '每 30 次工具调用必须 `compress` 一次',
    '到 40 次先发一条进度消息给队长',
    '不许拿全量 `pnpm test` 当探针',
  ]
  for (const phrase of phrases) {
    assert.ok(body.includes(phrase), `步数预算段正文必须逐字包含「${phrase}」`)
  }
  // 数值本身也钉住：只改措辞不改数字可以被上面的短语放过。
  for (const number of ['60', '30', '40']) {
    assert.ok(body.includes(number), `步数预算段必须给出具体数字「${number}」`)
  }
})

/* ------------------------------------------------------------------ ② 队长任务卡纪律 */

function makeSnapshot() {
  return {
    enabled: true,
    tasks: [],
    members: [],
    messages: [],
    routeAudits: [],
    concurrency: { limit: 3, running: 0, source: 'default' as const },
    memory: { injectedChars: 0, budget: 4000, truncated: false, files: [] },
    roles: [],
    activity: [],
  } as never
}

test('r39② 队长工作方式含任务卡纪律：≤3 文件 / path:line / >40 步拆卡 / >60 步改小', () => {
  const deps: PromptDeps = { bridge: { snapshot: () => makeSnapshot() } as unknown as Bridge }
  const text = captainSection(deps, SESSION)

  const workflowAt = text.indexOf('工作方式（顺序不可颠倒）')
  const disciplineAt = text.indexOf('任务卡要小')
  assert.ok(workflowAt >= 0, '队长段必须保留「工作方式」')
  assert.ok(disciplineAt > workflowAt, '任务卡纪律必须写在「工作方式」里（派发前自查），不能另起孤段')

  const lineEnd = text.indexOf('\n', disciplineAt)
  const line = text.slice(disciplineAt, lineEnd > disciplineAt ? lineEnd : undefined)
  for (const keyword of ['≤3 个文件', 'path:line', '>40 步', '60 步']) {
    assert.ok(line.includes(keyword), `任务卡纪律必须逐字包含「${keyword}」`)
  }
})

/* ------------------------------------------------------------------ ③ 步数提醒闸门 */

function withStore(run: (store: RunsStore) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r39-'))
  const store = new RunsStore(dir)
  return run(store).finally(() => rmSync(dir, { recursive: true, force: true }))
}

const MEMBER_ROW: HostMember = { id: 'm-1', name: 'dev-t1', status: 'running' }

function makeWatcher(
  store: RunsStore,
  options: {
    stepReminderAt?: number
    send?: (memberId: string, text: string) => Promise<{ ok: boolean; error?: string }>
  } = {},
) {
  const sent: Array<{ memberId: string; text: string }> = []
  const watcher = createMemberWatcher({
    store,
    listMembers: async () => [MEMBER_ROW],
    now: () => NOW,
    stallMs: 600_000,
    stepReminderAt: options.stepReminderAt ?? 40,
    sendMemberMessage: async (memberId, text) => {
      sent.push({ memberId, text })
      return options.send ? options.send(memberId, text) : { ok: true }
    },
  })
  return { watcher, sent }
}

test('r39③ 39 次不提醒 / 40 次恰 1 条 / 41 次不重复（落盘幂等）', async () => {
  await withStore(async (store) => {
    const state = makeState([makeTask('t1')], {
      bindings: [bindingOf('t1')],
      progress: { 'm-1': { at: NOW, calls: 39 } },
    })
    store.save(state)
    const { watcher, sent } = makeWatcher(store)

    assert.deepEqual(stepRemindersOf(state, 40), [], '阈值 40 时 39 次不算到阈值')
    await watcher.tick()
    assert.equal(sent.length, 0, '39 次工具调用不许提醒（阈值是 40，不是 39）')

    // 40：恰好一条，正文逐字（N 带入当时的调用数），账本里以幂等键落账。
    store.save({ ...state, progress: { 'm-1': { at: NOW, calls: 40 } } })
    await watcher.tick()
    assert.equal(sent.length, 1, '40 次必须恰好提醒 1 条')
    assert.equal(sent[0]?.memberId, 'm-1', '提醒必须按 memberId 直达，而不是发到公开频道')
    assert.equal(sent[0]?.text, stepReminderTextOf(40), '提醒正文必须逐字取自唯一措辞来源')
    assert.ok(sent[0]?.text.includes('（预算 60）'), '提醒必须写明预算 60')
    assert.ok(sent[0]?.text.includes('compress'), '提醒必须点名 compress')
    assert.ok(sent[0]?.text.includes('5 步'), '提醒必须给出剩余计划上限')

    const after40 = store.load(RUN)
    assert.ok(after40, '提醒落账后 run 必须还能读回')
    const reminders = after40.messages.filter((message) => message.messageId === stepReminderKeyOf('t1'))
    assert.equal(reminders.length, 1, '幂等键 step-reminder:t1 必须恰好一条')
    assert.equal(reminders[0]?.toMemberId, 'm-1')
    assert.equal(reminders[0]?.taskId, 't1')
    assert.equal(reminders[0]?.from, 'captain')
    assert.equal(after40.plan.tasks[0]?.status, 'running', '提醒不许改任务状态（它不是护栏）')

    // 41：正文里的 N 变了，但同一任务只会有一条 —— 幂等靠 messageId，不靠正文匹配。
    store.save({ ...after40, progress: { 'm-1': { at: NOW, calls: 41 } } })
    await watcher.tick()
    assert.equal(sent.length, 1, '41 次不许重复提醒（同一任务同一阈值只发一次）')
    assert.equal(store.load(RUN)?.messages.filter((m) => m.messageId === stepReminderKeyOf('t1')).length, 1)
  })
})

test('r39③ stepReminderAt=0 全关：100 次也不提醒、不落账', async () => {
  await withStore(async (store) => {
    const state = makeState([makeTask('t1')], {
      bindings: [bindingOf('t1')],
      progress: { 'm-1': { at: NOW, calls: 100 } },
    })
    store.save(state)
    const { watcher, sent } = makeWatcher(store, { stepReminderAt: 0 })

    assert.deepEqual(stepRemindersOf(state, 0), [], '阈值 0 的纯函数必须返回空候选')
    await watcher.tick()
    assert.equal(sent.length, 0, 'stepReminderAt=0 必须整条链路关闭（不是只关纯函数）')
    assert.equal(store.load(RUN)?.messages.length, 0, '关闭时不许在账本留下提醒')
  })
})

test('r39③ 收口后不提醒：任务 done 时 100 次也不发', async () => {
  await withStore(async (store) => {
    const done = makeState([makeTask('t1', 'done')], {
      bindings: [bindingOf('t1')],
      progress: { 'm-1': { at: NOW, calls: 100 } },
    })
    done.plan.status = 'terminated'
    store.save(done)
    const { watcher, sent } = makeWatcher(store)

    assert.deepEqual(stepRemindersOf(done, 40), [], '终态任务不是提醒对象')
    await watcher.tick()
    assert.equal(sent.length, 0, '任务收口后（plan terminated / task done）不许再提醒')
    assert.equal(store.load(RUN)?.messages.length, 0)
  })
})

test('r39③ 发送失败不落账、下一轮重试：ok:false 不是「已提醒」', async () => {
  await withStore(async (store) => {
    let allow = false
    const state = makeState([makeTask('t1')], {
      bindings: [bindingOf('t1')],
      progress: { 'm-1': { at: NOW, calls: 40 } },
    })
    store.save(state)
    const { watcher, sent } = makeWatcher(store, {
      send: async () => (allow ? { ok: true } : { ok: false, error: 'NO_CALLER' }),
    })

    await watcher.tick()
    assert.equal(sent.length, 1, '失败也要尝试发送一次')
    assert.equal(store.load(RUN)?.messages.length, 0, '发送失败绝不能落账（否则幂等键会把重试永久堵死）')

    allow = true
    await watcher.tick()
    assert.equal(sent.length, 2, '下一轮 tick 必须重试（提醒不是护栏，但也不能静默丢失）')
    assert.equal(store.load(RUN)?.messages.filter((m) => m.messageId === stepReminderKeyOf('t1')).length, 1)
  })
})

/* ------------------------------------------------------------------ 落盘回归（QA D1） */

test('r39 store 往返：progress.calls 必须随 run 读回（丢了它提醒永不到阈值）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r39-store-'))
  try {
    const store = new RunsStore(dir)
    const state = makeState([makeTask('t1')], {
      bindings: [bindingOf('t1')],
      progress: { 'm-1': { at: NOW, calls: 40 } },
    })
    store.save(state)
    assert.equal(store.load(RUN)?.progress?.['m-1']?.calls, 40, 'save→load 必须保留 calls')

    // 归一化边界：坏计数（负数/非数字）整条删掉字段，但 at 仍有效；
    // 合法性由 wrapLegacy 单测钉住，避免「只剩 at」的老 bug 再回来。
    const raw = JSON.parse(JSON.stringify({ ...state, version: 1 })) as Record<string, unknown>
    const legacy = wrapLegacy(raw)
    assert.equal(legacy?.progress?.['m-1']?.calls, 40, 'wrapLegacy 也必须保留 calls')
    const bad = wrapLegacy({
      ...raw,
      progress: { 'm-1': { at: NOW, calls: -1 }, 'm-2': { at: NOW, calls: 'many' } },
    })
    assert.equal(bad?.progress?.['m-1']?.calls, undefined, '负数计数必须丢弃')
    assert.equal(bad?.progress?.['m-1']?.at, NOW, '计数坏不能连累 at（停滞判定仍要可用）')
    assert.equal(bad?.progress?.['m-2']?.calls, undefined, '非数字计数必须丢弃')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ 设置项持久化 */

test('r39 设置项：stepReminderAt=0 经面板式保存（缺键）也必须保住关闭态', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-r39-settings-'))
  try {
    const file = join(dir, 'settings.json')
    const repo = createSettingsRepo({ file })

    assert.equal(repo.save({ stepReminderAt: 0 }).ok, true)
    assert.equal(repo.read().stepReminderAt, 0, '显式写 0 必须读回 0（0 = 关闭，不是缺省 40）')

    // 面板设置页没有这一项，保存时 raw 里不带 stepReminderAt —— 不许把它悄悄改回缺省。
    assert.equal(repo.save({ concurrencyLimit: 2 }).ok, true)
    assert.equal(repo.read().stepReminderAt, 0, '缺键保存必须沿用磁盘旧值（否则用户关不掉提醒）')
    assert.equal(repo.read().concurrencyLimit, 2, '其它项仍按提交值保存')

    const before = readFileSync(file, 'utf8')
    assert.equal(repo.save({ stepReminderAt: 201 }).ok, false, '超出 [0,200] 必须拒绝')
    assert.equal(readFileSync(file, 'utf8'), before, '被拒的提交不许改盘一个字节')
    assert.equal(repo.read().stepReminderAt, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

