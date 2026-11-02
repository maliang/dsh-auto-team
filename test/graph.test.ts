/**
 * 任务依赖图单测（node --test）。
 * 直接跑 TS 源：Node 22.18+ 原生类型擦除；本文件导入的 graph.ts 无任何本地依赖。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockedTasks, depSatisfied, findCycle, readyTasks, topoLayers, validateGraph } from '../src/host/plan/graph.ts'

test('空计划被拒：给出中文原因而不是静默通过', () => {
  const result = validateGraph([])
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.reason : '', /计划为空/)
})

test('重复 id 被拒', () => {
  const result = validateGraph([
    { id: 'a', dependsOn: [] },
    { id: 'a', dependsOn: [] },
  ])
  assert.equal(result.ok, false)
})

test('依赖不存在的任务被拒（并点名是哪条）', () => {
  const result = validateGraph([{ id: 'a', dependsOn: ['ghost'] }])
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.reason : '', /ghost/)
})

test('自依赖被拒', () => {
  const result = validateGraph([{ id: 'a', dependsOn: ['a'] }])
  assert.equal(result.ok, false)
})

test('成环被拒，且能指出环路', () => {
  const nodes = [
    { id: 'a', dependsOn: ['c'] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['b'] },
  ]
  const check = validateGraph(nodes)
  assert.equal(check.ok, false)
  const cycle = findCycle(nodes)
  assert.notEqual(cycle, null)
  assert.ok((cycle ?? []).length >= 2)
  // 首尾相同 = 闭合回路
  const closed = cycle ?? []
  assert.equal(closed[0], closed[closed.length - 1])
})

test('合法图通过校验', () => {
  const check = validateGraph([
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
  ])
  assert.deepEqual(check, { ok: true })
})

test('readyTasks 只放依赖已完成的；blockedTasks 说明在等谁', () => {
  const tasks = [
    { id: 'a', dependsOn: [], status: 'done' },
    { id: 'b', dependsOn: ['a'], status: 'pending' },
    { id: 'c', dependsOn: ['b'], status: 'pending' },
  ]
  assert.deepEqual(readyTasks(tasks), ['b'])
  assert.deepEqual(blockedTasks(tasks), [{ id: 'c', waitingOn: ['b'] }])
})

test('readyTasks 不含已完成与在跑的任务（避免重复派发）', () => {
  const tasks = [
    { id: 'a', dependsOn: [], status: 'running' },
    { id: 'b', dependsOn: [], status: 'done' },
    { id: 'c', dependsOn: [], status: 'failed' },
  ]
  assert.deepEqual(readyTasks(tasks), [])
})

test('topoLayers 同层可并行', () => {
  const layers = topoLayers([
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: [] },
    { id: 'c', dependsOn: ['a', 'b'] },
  ])
  assert.deepEqual(layers, [['a', 'b'], ['c']])
})

// ── r11 · skipped 视为依赖满足（唯一判定口 depSatisfied）─────────────────────

test('depSatisfied：done 与 skipped 满足，cancelled/failed/running 不满足（AC-26）', () => {
  assert.equal(depSatisfied('done'), true)
  assert.equal(depSatisfied('skipped'), true, '用户主动跳过 = 下游不必再等它')
  assert.equal(depSatisfied('cancelled'), false, '取消是放弃，下游不能被顺带放行')
  assert.equal(depSatisfied('failed'), false)
  assert.equal(depSatisfied('interrupted'), false)
  assert.equal(depSatisfied('running'), false)
  assert.equal(depSatisfied('pending'), false)
})

test('readyTasks / blockedTasks：skipped 满足依赖，cancelled 不满足', () => {
  const skipped = [
    { id: 't1', dependsOn: [], status: 'skipped' },
    { id: 't2', dependsOn: ['t1'], status: 'pending' },
  ]
  assert.deepEqual(readyTasks(skipped), ['t2'], '上游 skipped 时下游必须就绪')
  assert.deepEqual(blockedTasks(skipped), [])

  const cancelled = [
    { id: 't1', dependsOn: [], status: 'cancelled' },
    { id: 't2', dependsOn: ['t1'], status: 'pending' },
  ]
  assert.deepEqual(readyTasks(cancelled), [], '上游 cancelled 时下游保持阻塞')
  assert.deepEqual(blockedTasks(cancelled), [{ id: 't2', waitingOn: ['t1'] }])
})

