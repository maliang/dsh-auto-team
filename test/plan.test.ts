/**
 * 计划构造与落点解析单测。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan, planFingerprint, progressOf } from '../src/host/plan/plan.ts'
import { globalDataRoot, projectMemoryDir, publicMemoryDir, normalizeWorkspace } from '../src/host/paths.ts'

const now = 1_700_000_000_000

test('buildPlan 自动补 id 并统一初始状态为 pending', () => {
  const result = buildPlan(
    {
      sessionId: 's1',
      goal: '做插件',
      tasks: [
        { title: '骨架', roleId: 'architect' },
        { title: '实现', roleId: 'dev', dependsOn: ['t1'] },
      ],
    },
    'run-1',
    now,
  )
  assert.equal(result.ok, true)
  const plan = result.ok === true ? result.plan : undefined
  assert.ok(plan)
  assert.deepEqual(plan?.tasks.map((task) => task.id), ['t1', 't2'])
  assert.equal(plan?.tasks[0].status, 'pending')
  assert.equal(plan?.runId, 'run-1')
})

test('buildPlan 拒绝空标题与未指定角色', () => {
  const noTitle = buildPlan({ sessionId: 's1', tasks: [{ title: '  ', roleId: 'dev' }] }, 'r', now)
  assert.equal(noTitle.ok, false)
  const noRole = buildPlan({ sessionId: 's1', tasks: [{ title: 'x', roleId: '' }] }, 'r', now)
  assert.equal(noRole.ok, false)
})

test('buildPlan 拒绝成环依赖', () => {
  const result = buildPlan(
    {
      sessionId: 's1',
      tasks: [
        { id: 'a', title: 'A', roleId: 'dev', dependsOn: ['b'] },
        { id: 'b', title: 'B', roleId: 'dev', dependsOn: ['a'] },
      ],
    },
    'r',
    now,
  )
  assert.equal(result.ok, false)
})

test('并发上限被夹到 1..8', () => {
  const low = buildPlan({ sessionId: 's1', maxConcurrent: 0, tasks: [{ title: 'a', roleId: 'dev' }] }, 'r', now)
  assert.equal(low.ok === true ? low.plan.maxConcurrent : -1, 1)
  const high = buildPlan({ sessionId: 's1', maxConcurrent: 99, tasks: [{ title: 'a', roleId: 'dev' }] }, 'r', now)
  assert.equal(high.ok === true ? high.plan.maxConcurrent : -1, 8)
  const dflt = buildPlan({ sessionId: 's1', tasks: [{ title: 'a', roleId: 'dev' }] }, 'r', now)
  assert.equal(dflt.ok === true ? dflt.plan.maxConcurrent : -1, 3)
})

test('planFingerprint 与任务顺序无关', () => {
  const a = { tasks: [{ id: 'x', roleId: 'dev', dependsOn: [] }, { id: 'y', roleId: 'qa', dependsOn: ['x'] }] } as never
  const b = { tasks: [{ id: 'y', roleId: 'qa', dependsOn: ['x'] }, { id: 'x', roleId: 'dev', dependsOn: [] }] } as never
  assert.equal(planFingerprint(a), planFingerprint(b))
})

test('progressOf 无任务时不产生 NaN', () => {
  assert.deepEqual(progressOf([]), { done: 0, total: 0, ratio: 0 })
})

test('落点：全局数据根与项目记忆目录', () => {
  assert.equal(globalDataRoot('/home/u'), '/home/u/.dsh/auto-team')
  assert.equal(publicMemoryDir('/home/u'), '/home/u/.dsh/auto-team/memory/public')
  assert.equal(projectMemoryDir('/work/proj'), '/work/proj/.auto-team/memory')
  assert.equal(projectMemoryDir('/work/proj/'), '/work/proj/.auto-team/memory')
})

test('空工作区不产生相对路径（避免写进 cwd）', () => {
  assert.equal(normalizeWorkspace(''), '/default')
  assert.equal(normalizeWorkspace(undefined), '/default')
  assert.match(projectMemoryDir(''), /^\/default\//)
})
