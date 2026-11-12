/**
 * 自动记忆沉淀纯逻辑单测（r19 T1）。
 *
 * 覆盖点：
 *  - 只有 terminated / cancelled 产出；dispatching / paused / draft 返回空；
 *  - 项目记忆固定一条、文件名只由 runId 派生（同 state 调两次同名 = 幂等键）；
 *  - 失败判定三条件（failed / attempts>1 / exitCode!==0，含 null 超时）各自独立命中；
 *  - 无失败 → 没有公共记忆；有失败 → 有且只有一条 `lessons-<runId>.md`；
 *  - 正文行数上限（项目 24 / 公共 6），标题恒为单行且 ≤ 80 字；
 *  - 缺 evidence / attempts 的旧 state 不崩。
 *
 * 纯模块测试：不建临时目录、不碰 fs —— 这正是 auto.ts 不 import fs 的原因。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runMemoryOf, type AutoMemoryInput, type AutoMemoryTask } from '../src/host/memory/auto.ts'

const NOW = 1_700_000_000_000

function taskOf(id: string, over: Partial<AutoMemoryTask> = {}): AutoMemoryTask {
  return { id, title: `任务 ${id}`, status: 'done', ...over }
}

function inputOf(over: Partial<AutoMemoryInput> = {}): AutoMemoryInput {
  return {
    runId: 'run-r19',
    goal: '实现自动记忆',
    status: 'terminated',
    createdAt: NOW,
    plannedAt: NOW,
    finishedAt: NOW + 60_000,
    project: 'dsh-auto-team',
    sessionId: 'sess-r19',
    tasks: [taskOf('t1'), taskOf('t2')],
    ...over,
  }
}

function bodyLines(body: string): string[] {
  return body.split('\n')
}

function projectOf(memories: ReturnType<typeof runMemoryOf>) {
  return memories.find((memory) => memory.track === 'project')
}

function publicOf(memories: ReturnType<typeof runMemoryOf>) {
  return memories.filter((memory) => memory.track === 'public')
}

test('terminated：产出一条项目记忆，文件名 run-<runId>.md，首行是 `# goal · runId`', () => {
  const memories = runMemoryOf(inputOf())
  assert.equal(memories.length, 1, '无失败时只写项目轨')
  const project = projectOf(memories)
  assert.ok(project, '必须有项目记忆')
  assert.equal(project?.name, 'run-run-r19.md')
  assert.equal(bodyLines(project?.body ?? '')[0], '# 实现自动记忆 · run-r19')
  const body = project?.body ?? ''
  assert.match(body, /- 状态：已终止 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  assert.match(body, /- 项目：dsh-auto-team · 会话：sess-r19/)
  assert.match(body, /- 任务：done 2（共 2）/, '只列非零计数')
  assert.match(body, /- t1 \[done\] 任务 t1/)
  assert.match(body, /- t2 \[done\] 任务 t2/)
  assert.doesNotMatch(body, /## 失败与教训/, '没有失败时不写失败段')
})

test('cancelled：同样产出项目记忆，状态行写「已取消」', () => {
  const memories = runMemoryOf(inputOf({ status: 'cancelled' }))
  assert.equal(memories.length, 1)
  assert.equal(projectOf(memories)?.name, 'run-run-r19.md')
  assert.match(projectOf(memories)?.body ?? '', /- 状态：已取消 · \d{4}-\d{2}-\d{2}/)
})

test('进行中状态（dispatching / paused / draft）一律返回空数组', () => {
  for (const status of ['dispatching', 'paused', 'draft']) {
    const memories = runMemoryOf(inputOf({ status }))
    assert.deepEqual(memories, [], `${status} 不得产出记忆`)
  }
})

test('文件名跨多次调用稳定（同一 runId 不同时刻仍同名 = 幂等键）', () => {
  const first = runMemoryOf(inputOf())
  const second = runMemoryOf(inputOf({ finishedAt: NOW + 3_600_000 }))
  assert.equal(first[0]?.name, second[0]?.name, '名字不得混入 now/日期')
  assert.equal(first[0]?.name, 'run-run-r19.md')
})

test('失败判定条件一：任务状态 failed 即命中（即使没有 attempts / evidence）', () => {
  const memories = runMemoryOf(inputOf({ tasks: [taskOf('t1', { status: 'failed' })] }))
  assert.equal(publicOf(memories).length, 1)
  assert.match(projectOf(memories)?.body ?? '', /- t1 返工 0 次：门禁 `未记录` 退出码 未记录/)
})

test('失败判定条件二：attempts > 1 即命中（状态是 done、门禁证据通过也不行）', () => {
  const memories = runMemoryOf(
    inputOf({ tasks: [taskOf('t1', { attempts: 2, evidence: { command: 'exit 0', exitCode: 0 } })] }),
  )
  assert.equal(publicOf(memories).length, 1)
  assert.match(projectOf(memories)?.body ?? '', /- t1 返工 2 次：门禁 `exit 0` 退出码 0/)
})

test('失败判定条件三：evidence.exitCode !== 0（非 0 与 null 超时都算）', () => {
  const nonZero = runMemoryOf(
    inputOf({ tasks: [taskOf('t1', { evidence: { command: 'pnpm test', exitCode: 1, tail: 'boom' } })] }),
  )
  assert.equal(publicOf(nonZero).length, 1)
  assert.match(projectOf(nonZero)?.body ?? '', /退出码 1；输出尾部：boom/)

  const timedOut = runMemoryOf(
    inputOf({ tasks: [taskOf('t1', { evidence: { command: 'pnpm test', exitCode: null } })] }),
  )
  assert.equal(publicOf(timedOut).length, 1, 'null（超时）也是失败信号')
  assert.match(projectOf(timedOut)?.body ?? '', /退出码 null（超时）/)
})

test('非失败：done + attempts 0 + 退出码 0 → 没有公共记忆，也没有失败段', () => {
  const memories = runMemoryOf(
    inputOf({ tasks: [taskOf('t1', { evidence: { command: 'exit 0', exitCode: 0 } })] }),
  )
  assert.equal(publicOf(memories).length, 0)
  assert.doesNotMatch(projectOf(memories)?.body ?? '', /## 失败与教训/)
})

test('有失败信号 → 有且只有一条公共记忆 lessons-<runId>.md，首行带 runId', () => {
  const memories = runMemoryOf(
    inputOf({
      tasks: [
        taskOf('t1', { status: 'failed', attempts: 1 }),
        taskOf('t2', { attempts: 2 }),
        taskOf('t3'),
      ],
    }),
  )
  const lessons = publicOf(memories)
  assert.equal(lessons.length, 1)
  assert.equal(lessons[0]?.name, 'lessons-run-r19.md')
  assert.equal(bodyLines(lessons[0]?.body ?? '')[0], '# 自动团队教训 · run-r19')
  const body = lessons[0]?.body ?? ''
  assert.match(body, /- 日期：\d{4}-\d{2}-\d{2}/)
  assert.match(body, /- 目标：实现自动记忆/)
  assert.match(body, /- 失败模式：t1 门禁/)
  assert.match(body, /另有 1 条失败任务/)
  assert.match(body, /- 可复用提示：/)
})

test('正文行数上限：项目 ≤ 24 行（含标题与截断说明），公共 ≤ 6 行', () => {
  const tasks = Array.from({ length: 40 }, (_, index) => taskOf(`t${index + 1}`))
  tasks[0] = taskOf('t1', { status: 'failed', attempts: 2 })
  const memories = runMemoryOf(inputOf({ tasks }))
  const project = projectOf(memories)
  assert.ok(project)
  assert.ok(bodyLines(project?.body ?? '').length <= 24, '项目记忆不得超过 24 行')
  assert.match(project?.body ?? '', /条任务（已截断）/)
  const lessons = publicOf(memories)
  assert.equal(lessons.length, 1)
  assert.ok(bodyLines(lessons[0]?.body ?? '').length <= 6, '公共记忆不得超过 6 行')
})

test('标题：空目标是「未命名计划」，含换行/超长目标仍为单行且 ≤ 80 字', () => {
  const empty = runMemoryOf(inputOf({ goal: '' }))
  assert.equal(bodyLines(projectOf(empty)?.body ?? '')[0], '# 未命名计划 · run-r19')

  const multiline = runMemoryOf(inputOf({ goal: '实现\n自动记忆\r\n第二行' }))
  const first = bodyLines(projectOf(multiline)?.body ?? '')[0] ?? ''
  assert.equal(first, '# 实现 自动记忆 第二行 · run-r19')
  assert.equal(first.includes('\n'), false)

  const longGoal = runMemoryOf(inputOf({ goal: '很长的目标'.repeat(40) }))
  const longLine = bodyLines(projectOf(longGoal)?.body ?? '')[0] ?? ''
  assert.ok(longLine.length <= 80, `标题总长必须 ≤ 80（实际 ${longLine.length}）`)
  assert.ok(longLine.endsWith(' · run-r19'), 'runId 不能被目标挤掉')
})

test('缺 evidence / attempts 的旧 state 不崩（也不误判为失败）', () => {
  const memories = runMemoryOf(
    inputOf({ tasks: [{ id: 't1', title: '旧任务', status: 'done' }], project: undefined, sessionId: undefined }),
  )
  const project = projectOf(memories)
  assert.ok(project)
  assert.match(project?.body ?? '', /- t1 \[done\] 旧任务/)
  assert.doesNotMatch(project?.body ?? '', /项目：|会话：/, '缺省上下文不写空段')
})

test('run 上完全没有任务：不写统计段也不崩', () => {
  const memories = runMemoryOf(inputOf({ tasks: [] }))
  assert.equal(memories.length, 1)
  assert.doesNotMatch(projectOf(memories)?.body ?? '', /- 任务：/)
})
