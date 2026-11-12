/**
 * r18b T1：`RunSummary.ongoing` —— 非终态任务数（宿主侧统计 + 视图透传）。
 *
 * 为什么用**真 store + 真临时目录**：本次改动全部落在「落盘 → list() 统计」这一层，
 * mock 掉 store 就等于把被测行为替换成夹具，测不到旧文件缺字段、坏文件跳过这些兼容性。
 * 视图层（library）则只断言**透传**：字段在 RunSummary 上算好，视图不得重建对象时丢掉。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PlanTask, TaskStatus } from '../src/shared/types.ts'
import type { RunState } from '../src/host/store.ts'
import { RUN_STATE_VERSION, RunsStore } from '../src/host/store.ts'
import { buildLibrary } from '../src/host/library.ts'

const now = 1_700_000_000_000

function taskOf(id: string, status: TaskStatus): PlanTask {
  return {
    id,
    title: `任务 ${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: 'true',
    status,
  }
}

function stateOf(runId: string, statuses: TaskStatus[], createdAt = now): RunState {
  return {
    version: RUN_STATE_VERSION,
    plannedAt: createdAt,
    messages: [],
    bindings: [],
    routeAudits: [],
    plan: {
      runId,
      sessionId: 's1',
      createdAt,
      status: 'dispatching',
      tasks: statuses.map((status, index) => taskOf(`t${index + 1}`, status)),
      maxConcurrent: 3,
    },
  }
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-ongoing-'))
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('r18b：混合状态（done + running + pending）→ ongoing = 2', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    store.save(stateOf('run-mixed', ['done', 'running', 'pending']))

    const summary = store.list().find((run) => run.runId === 'run-mixed')
    assert.ok(summary)
    assert.equal(summary.done, 1)
    assert.equal(summary.tasks, 3)
    assert.equal(summary.ongoing, 2, 'done 之外的 running/pending 都算进行中')
    // `active` 与 `ongoing` 必须同一口径（不能出现「ongoing=0 但仍标活跃」）。
    assert.equal(summary.active, true)
  })
})

test('r18b：全部终态（done/failed/cancelled/skipped/interrupted）→ ongoing = 0', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    store.save(stateOf('run-settled', ['done', 'failed', 'cancelled', 'skipped', 'interrupted']))

    const summary = store.list().find((run) => run.runId === 'run-settled')
    assert.ok(summary)
    assert.equal(summary.ongoing, 0, 'interrupted 也是终态（成员进程已死，不会再产出）')
    assert.equal(summary.active, false)
  })
})

test('r18b：旧文件缺 tasks 字段 → list() 不崩，该 run 被跳过', () => {
  withTempDir((dir) => {
    // v1 裸 Plan 形状但**没有 tasks**：normalizePlan 判成非法 run，load 返回 null。
    writeFileSync(
      join(dir, 'run-broken.json'),
      `${JSON.stringify({ runId: 'run-broken', sessionId: 's1', createdAt: now, status: 'draft' })}\n`,
      'utf8',
    )

    const store = new RunsStore(dir)
    let summaries: ReturnType<RunsStore['list']> = []
    assert.doesNotThrow(() => {
      summaries = store.list()
    })
    assert.deepEqual(
      summaries.map((run) => run.runId),
      [],
      '缺 tasks 的文件不可信，跳过而不是给一个 ongoing=0 的假 run',
    )
  })
})

test('r18b：多个 run 各自统计，ongoing 不串台', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    store.save(stateOf('run-a', ['running', 'pending'], now))
    store.save(stateOf('run-b', ['done'], now + 1000))
    store.save(stateOf('run-c', ['gate', 'ready', 'blocked'], now + 2000))

    const byId = new Map(store.list().map((run) => [run.runId, run]))
    assert.equal(byId.get('run-a')?.ongoing, 2)
    assert.equal(byId.get('run-b')?.ongoing, 0)
    assert.equal(byId.get('run-c')?.ongoing, 3)
  })
})

test('r18b：library.buildLibrary 透传 ongoing，历史行不丢字段', () => {
  withTempDir((dir) => {
    const store = new RunsStore(dir)
    store.save(stateOf('run-mixed', ['done', 'running', 'pending']))

    const view = buildLibrary({
      store,
      workspace: '/work/current',
      now: () => now + 100,
      publicMemories: () => [],
      projectMemories: () => [],
    })
    const row = (view.runs ?? []).find((run) => run.runId === 'run-mixed')
    assert.ok(row, '历史列表必须包含该 run')
    assert.equal(row.ongoing, 2, 'buildLibrary 用 spread 透传，重建对象时不得丢掉 ongoing')
  })
})
