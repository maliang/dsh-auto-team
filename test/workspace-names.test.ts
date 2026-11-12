/**
 * r19：左栏项目名必须来自宿主 `workspaceRegistry`，不是 run.project 的路径 basename。
 *
 * 真机证据（桌面宿主 profile `~/.dsh/profiles/desktop`）：run 创建时 `project` 被写成
 * profile 目录，左栏因此出现 `desktop`（13 次运行）与 `tmp`（1 次），用户自己的命名
 * （`tuoluojiang` / `nengtan`）完全看不到。这里用内存 store + 伪造 registry 固定三条语义：
 *   1. project 命中 registry path → 用 registry 的 title / canonical path；
 *   2. 老 run（project 是 profile 垃圾路径）按 sessionId 反查工作区；
 *   3. registry 缺失 / 不命中 → 逐字退回旧行为（basename、未知项目桶）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { HostWorkspaceEntry } from '../src/host/adapters.ts'
import type { RunSummary } from '../src/shared/types.ts'
import type { RunState } from '../src/host/store.ts'
import { UNKNOWN_PROJECT_NAME, buildLibrary, type RunsStorePort } from '../src/host/library.ts'

/** 桌面宿主的装配 cwd（真机 root cause ①）。 */
const PROFILE = '/Users/maliang/.dsh/profiles/desktop'
const TUOLUOJIANG = '/Users/maliang/Documents/develop/guangdahehui/oa/tuoluojiang'
const NENGTAN = '/Users/maliang/Documents/develop/guangdahehui/nengtan'

function summaryOf(over: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'run-1',
    sessionId: 's1',
    createdAt: 1_000,
    status: 'dispatching',
    tasks: 1,
    done: 1,
    ...over,
  }
}

function fakeStore(summaries: RunSummary[]): RunsStorePort {
  return {
    list: () => summaries,
    load: (_runId: string): RunState | null => null,
  }
}

function workspaceOf(over: Partial<HostWorkspaceEntry> & { path: string }): HostWorkspaceEntry {
  return { id: over.id ?? over.path, sessionIds: [], ...over }
}

function libraryWith(
  summaries: RunSummary[],
  options: { workspaces?: () => HostWorkspaceEntry[] } = {},
) {
  const seenMemories: string[] = []
  const view = buildLibrary({
    store: fakeStore(summaries),
    workspace: PROFILE,
    now: () => 10_000,
    publicMemories: () => [],
    projectMemories: (path) => {
      seenMemories.push(path)
      return []
    },
    ...(options.workspaces === undefined ? {} : { workspaces: options.workspaces }),
  })
  return { view, seenMemories }
}

/* ───────────── 命名：registry title 优先于 basename ───────────── */

test('r19：两个会话各自映射到工作区 → 聚成两个项目，name=title、path=工作区路径', () => {
  const { view } = libraryWith([summaryOf({ runId: 'r-a', sessionId: 's-tuo' }), summaryOf({ runId: 'r-b', sessionId: 's-neng', createdAt: 2_000 })], {
    workspaces: () => [
      workspaceOf({ path: TUOLUOJIANG, title: 'tuoluojiang', sessionIds: ['s-tuo'] }),
      workspaceOf({ path: NENGTAN, title: 'nengtan', sessionIds: ['s-neng'] }),
    ],
  })

  const tuo = view.projects.find((project) => project.path === TUOLUOJIANG)
  const neng = view.projects.find((project) => project.path === NENGTAN)
  assert.ok(tuo, 'tuoluojiang 必须成桶（project 缺失时按 sessionId 反查）')
  assert.ok(neng, 'nengtan 必须成桶')
  assert.equal(tuo?.name, 'tuoluojiang', '展示名必须是用户命名的工作区标题')
  assert.equal(neng?.name, 'nengtan')
  assert.equal(tuo?.runs, 1)
  assert.equal(neng?.runs, 1)
  // 垃圾 profile 桶不应再收下这两个 run（0 次，客户端已有过滤）。
  assert.equal(view.projects.find((project) => project.path === PROFILE)?.runs, 0)
})

test('r19：最根因场景 —— run.project 是 profile 目录，user 看到的是工作区标题', () => {
  const { view } = libraryWith([summaryOf({ runId: 'r-desktop', sessionId: 's-tuo', project: PROFILE })], {
    workspaces: () => [workspaceOf({ path: TUOLUOJIANG, title: 'tuoluojiang', sessionIds: ['s-tuo'] })],
  })

  assert.equal(view.projects.find((project) => project.path === TUOLUOJIANG)?.name, 'tuoluojiang')
  assert.equal(
    view.projects.some((project) => project.name === 'desktop' && project.runs > 0),
    false,
    'profile 目录不许再吞掉 run（真机症状：desktop 13 次）',
  )
})

test('r19：同一工作区的新旧 run 合并成一个桶（新 run 已写 workspace path）', () => {
  const { view } = libraryWith(
    [
      summaryOf({ runId: 'r-old', sessionId: 's-old', project: PROFILE, createdAt: 1_000 }),
      summaryOf({ runId: 'r-new', sessionId: 's-new', project: `${NENGTAN}/`, createdAt: 5_000 }),
    ],
    {
      workspaces: () => [
        workspaceOf({ path: NENGTAN, title: 'nengtan', sessionIds: ['s-old'] }),
      ],
    },
  )

  const neng = view.projects.filter((project) => project.path === NENGTAN)
  assert.equal(neng.length, 1, `同一工作区只许一个桶（尾斜杠也必须归一），实际 ${neng.length}`)
  assert.equal(neng[0]?.runs, 2, '旧 run 与新 run 必须合并')
  assert.equal(neng[0]?.name, 'nengtan')
  assert.equal(view.projects.at(-1)?.unknown, undefined, '两条 run 都有归属，不该出现历史桶')
})

/* ───────────── 降级：没有 registry = 旧行为逐字不变 ───────────── */

test('r19：registry 缺失 → 退回路径 basename（/work/x → x），旧行为不变', () => {
  const { view } = libraryWith([summaryOf({ runId: 'r-x', project: '/work/x' })])
  const x = view.projects.find((project) => project.path === '/work/x')
  assert.equal(x?.name, 'x')
  assert.equal(x?.runs, 1)
})

test('r19：registry 命中不了未注册目录 → 不吞掉，按 basename 展示', () => {
  const { view } = libraryWith([summaryOf({ runId: 'r-tmp', project: '/private/tmp' })], {
    workspaces: () => [workspaceOf({ path: TUOLUOJIANG, title: 'tuoluojiang', sessionIds: ['s-other'] })],
  })
  const tmp = view.projects.find((project) => project.path === '/private/tmp')
  assert.equal(tmp?.name, 'tmp', '未注册目录仍要可见（真机：tmp 1 次运行）')
  assert.equal(tmp?.runs, 1)
})

test('r19：无 project 且无会话映射 → 仍是历史桶（语义不变）', () => {
  const { view } = libraryWith([summaryOf({ runId: 'r-legacy', sessionId: 's-unknown' })], {
    workspaces: () => [workspaceOf({ path: NENGTAN, title: 'nengtan', sessionIds: ['s-other'] })],
  })
  assert.equal(view.projects.at(-1)?.name, UNKNOWN_PROJECT_NAME)
  assert.equal(view.projects.at(-1)?.runs, 1)
})

/* ───────────── 优先级：project 命中 > sessionId 映射 ───────────── */

test('r19：project 命中优先于 sessionId 映射（不把写对了的 run 拉回旧工作区）', () => {
  const A = '/work/a'
  const B = '/work/b'
  const { view } = libraryWith([summaryOf({ runId: 'r-a', sessionId: 's-b', project: A })], {
    workspaces: () => [
      workspaceOf({ path: A, title: '项目 A', sessionIds: [] }),
      workspaceOf({ path: B, title: '项目 B', sessionIds: ['s-b'] }),
    ],
  })

  assert.equal(view.projects.find((project) => project.path === A)?.runs, 1, 'project 命中的桶收下这个 run')
  assert.equal(
    view.projects.find((project) => project.path === B),
    undefined,
    'sessionId 映射只是兜底：project 已命中时不该凭空多出 B 桶',
  )
  assert.equal(view.projects.find((project) => project.path === A)?.name, '项目 A')
})

/* ───────────── 记忆目录：跟着解析后的 path 走 ───────────── */

test('r19：项目记忆按 registry 的 canonical path 读取（不是 profile 垃圾路径）', () => {
  const { view, seenMemories } = libraryWith(
    [
      summaryOf({ runId: 'r-old', sessionId: 's-old', project: `${PROFILE}/` }),
      summaryOf({ runId: 'r-new', sessionId: 's-new', project: `${NENGTAN}/` }),
    ],
    { workspaces: () => [workspaceOf({ path: NENGTAN, title: 'nengtan', sessionIds: ['s-old'] })] },
  )

  const neng = view.projects.find((project) => project.path === NENGTAN)
  assert.equal(neng?.runs, 2)
  assert.ok(seenMemories.includes(NENGTAN), `记忆目录必须用解析后的工作区路径，实际 ${seenMemories.join(', ')}`)
  assert.ok(
    !seenMemories.includes(`${NENGTAN}/`),
    '不得用带尾斜杠的原始串读记忆（会读到另一个目录）',
  )
  // 装配 workspace（profile）仍作为 0 次运行的保底桶在列、会读它自己的记忆目录；
  // 关键是**有 run 的那个桶**不再指向 profile（上面的 nengtan 断言）。
  assert.equal(view.projects.find((project) => project.path === PROFILE)?.runs, 0)
})
