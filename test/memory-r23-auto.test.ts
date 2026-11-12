/**
 * r23 自动沉淀草稿（auto.ts 的 autoEntryDraftsOf）：终态才产出、失败写 pitfalls/P1、
 * 通过门禁命令去重写 commands/P2、无失败不写坑、永不产生 P0。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { autoEntryDraftsOf, type AutoMemoryInput, type AutoMemoryTask } from '../src/host/memory/auto.ts'
import { entryHash } from '../src/host/memory/entries.ts'

const NOW = new Date(2026, 10, 10, 17, 20).getTime()

function taskOf(id: string, over: Partial<AutoMemoryTask> = {}): AutoMemoryTask {
  return { id, title: `任务 ${id}`, status: 'done', ...over }
}

function inputOf(over: Partial<AutoMemoryInput> = {}): AutoMemoryInput {
  return {
    runId: 'run-r23',
    goal: '实现条目级记忆',
    status: 'terminated',
    createdAt: NOW - 600_000,
    plannedAt: NOW - 600_000,
    finishedAt: NOW,
    project: 'dsh-auto-team',
    sessionId: 'sess-r23',
    tasks: [taskOf('t1')],
    ...over,
  }
}

test('r23 自动沉淀：只有 terminated / cancelled 产出；进行中/草稿一律空', () => {
  for (const status of ['draft', 'dispatching', 'running', 'paused', 'pending']) {
    assert.deepEqual(autoEntryDraftsOf(inputOf({ status }), NOW), [], `${status} 不得沉淀`)
  }
  const failing = { tasks: [taskOf('t1', { status: 'failed' })] }
  assert.ok(autoEntryDraftsOf(inputOf({ status: 'terminated', ...failing }), NOW).length > 0)
  assert.ok(autoEntryDraftsOf(inputOf({ status: 'cancelled', ...failing }), NOW).length > 0)
})

test('r23 自动沉淀：失败门禁 → project/pitfalls/P1，文案含命令、退出码与输出尾部', () => {
  const drafts = autoEntryDraftsOf(
    inputOf({
      tasks: [
        taskOf('t1', {
          status: 'rework',
          attempts: 1,
          evidence: { command: 'pnpm test', exitCode: 1, tail: '✖ 3 failing' },
        }),
      ],
    }),
    NOW,
  )
  const pitfall = drafts.find((draft) => draft.track === 'project')
  assert.ok(pitfall)
  assert.equal(pitfall.topic, 'pitfalls')
  assert.equal(pitfall.level, 'P1')
  assert.equal(pitfall.source, '系统')
  assert.equal(pitfall.at, NOW, 'at 取 finishedAt')
  assert.equal(pitfall.text, '门禁 `pnpm test` 失败（退出码 1）；输出尾部：✖ 3 failing')
})

test('r23 自动沉淀：无证据但任务 failed → 任务失败文案；仅返工 >1 → 返工 N 次文案', () => {
  const failed = autoEntryDraftsOf(inputOf({ tasks: [taskOf('t1', { status: 'failed', attempts: 1 })] }), NOW)
  assert.equal(failed[0].text, '任务「任务 t1」失败（run-r23）')

  const rework = autoEntryDraftsOf(inputOf({ tasks: [taskOf('t1', { status: 'rework', attempts: 3 })] }), NOW)
  assert.equal(rework[0].text, '任务「任务 t1」返工 3 次（run-r23）')
})

test('r23 自动沉淀：证据 exitCode=0 → commands/P2「已验证命令：…」，同 run 内去重', () => {
  const drafts = autoEntryDraftsOf(
    inputOf({
      tasks: [
        taskOf('t1', { evidence: { command: 'pnpm typecheck', exitCode: 0 } }),
        taskOf('t2', { evidence: { command: 'pnpm typecheck', exitCode: 0 } }),
        taskOf('t3', { evidence: { command: 'pnpm build', exitCode: 0 } }),
      ],
    }),
    NOW,
  )
  const commands = drafts.filter((draft) => draft.topic === 'commands')
  assert.deepEqual(commands.map((draft) => draft.text), ['已验证命令：pnpm typecheck', '已验证命令：pnpm build'])
  for (const draft of commands) {
    assert.equal(draft.level, 'P2')
    assert.equal(draft.track, 'project')
  }
})

test('r23 自动沉淀：无失败不写 pitfalls、不写公共轨；有失败只写 1 条公共 P1 提醒', () => {
  const clean = autoEntryDraftsOf(inputOf({ tasks: [taskOf('t1')] }), NOW)
  assert.equal(clean.length, 0, '无失败且无通过证据 → 0 条')

  const drafts = autoEntryDraftsOf(
    inputOf({
      tasks: [
        taskOf('t1', { status: 'rework', attempts: 1, evidence: { command: 'pnpm test', exitCode: 1, tail: 'boom' } }),
        taskOf('t2', { status: 'failed', attempts: 1 }),
      ],
    }),
    NOW,
  )
  const pitfalls = drafts.filter((draft) => draft.topic === 'pitfalls')
  assert.equal(pitfalls.filter((draft) => draft.track === 'project').length, 2)
  const publicPitfalls = pitfalls.filter((draft) => draft.track === 'public')
  assert.equal(publicPitfalls.length, 1, '公共轨最多 1 条')
  assert.equal(publicPitfalls[0].level, 'P1')
  assert.match(publicPitfalls[0].text, /先本地重跑确认/)
})

test('r23 自动沉淀：永不产生 P0；同一条证据重复 → hash 相同（后续 upsert 只加修正次数）', () => {
  const input = inputOf({
    tasks: [taskOf('t1', { status: 'rework', attempts: 1, evidence: { command: 'pnpm test', exitCode: 1, tail: 'x' } })],
  })
  const first = autoEntryDraftsOf(input, NOW)
  const second = autoEntryDraftsOf(input, NOW + 1000)
  for (const draft of first) assert.notEqual(draft.level, 'P0')
  assert.equal(entryHash(first[0].text), entryHash(second[0].text), '同失败文案必须同 hash')
})
