/**
 * r57 QA 回归：任务页切到「非当前 run」时，跳转入口必须带**那个 run 自己的成员**。
 *
 * 用户可见缺陷（t1 已修、本文件钉死）：
 *  旧实现 `const members = historicalRunId === null && snapshot !== undefined ? snapshot.members : []`
 *  —— 只要看的不是当前 run，members 恒为空数组，于是角色卡 / 任务行 / 流程节点三处
 *  全判「不可跳」，而卡片本身还写着「派发中」，用户点了没反应。
 *
 * 同时钉住 r9 的第二条语义：`closedRun` 只能由**这个 run 自己**的计划态判定，
 * 不得写成 `historicalRunId !== null || …` —— 否则一个还在派发中的旧 run 会被说成
 * 「该运行已结束，子智能体会话已回收」。
 *
 * 判据怎么防「改回错误实现不会红」：
 *  ① 真实执行 `TasksTab`（transpileModule → CJS → 元素树），断言它交给
 *    RoleGrid / TaskOverview / FlowCanvas 的 `members` 与 `closedRun`。把 members
 *    改回 `[]`，① 立即红；把 closedRun 改回 `historicalRunId !== null ||`，② 立即红。
 *  ② 子组件用**桩**（另一 run 正在改 RoleCard.tsx / viewmodel 的角色卡语义）：
 *    接线证据与判定证据分层——接线由桩 props 断言，判定用真实的 `memberJumpOf`
 *    三入口（role/task/node）在**同一份 detail.members** 上算 available。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  DurationCell,
  FlowView,
  MemberView,
  PanelSnapshot,
  RunDetailView,
  RunSummary,
  UsageCell,
} from '../src/shared/types.ts'
import type { TabProps } from '../src/client/Panel.tsx'
import {
  MEMBER_JUMP_CLOSED_RUN_REASON,
  MEMBER_JUMP_NO_MEMBER_REASON,
  MEMBER_JUMP_NO_MEMBER_ROLE_REASON,
  memberJumpOf,
} from '../src/client/viewmodel.ts'
import * as viewmodel from '../src/client/viewmodel.ts'
import * as nav from '../src/client/nav.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ts = require('typescript') as typeof import('typescript')
const react = require('react') as unknown as Record<string, unknown>

/* ─────────────────── 就地编译 TasksTab（子组件全部打桩） ─────────────────── */

function reactWithHooks(): Record<string, unknown> {
  return {
    createElement: react.createElement,
    Fragment: react.Fragment,
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useId: () => ':r57:',
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [value, () => {}],
    useEffect: () => {},
  }
}

function loadTab(): Record<string, unknown> {
  const file = join(ROOT, 'src/client/tabs/TasksTab.tsx')
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText
  // 桩组件用**字符串 type**：元素会留在树里（函数组件会被 elementsOf 就地展开、丢掉 props）。
  const stub = (name: string): string => `r57-stub-${name}`
  const shims: Record<string, unknown> = {
    react: reactWithHooks(),
    '../viewmodel.ts': viewmodel,
    '../nav.ts': nav,
    '../member-nav.ts': { jumpToMemberSession: async () => 'opened' },
    './rows.ts': {
      useTabScroll: () => ({ ref: { current: null }, scrollTo: () => {} }),
      useExpandedTask: () => [null, () => {}, () => {}],
      scrollToTaskRow: () => {},
    },
    '../views/RunHeader.tsx': { RunHeader: stub('run-header') },
    '../views/RunSwitcher.tsx': { RunSwitcher: stub('run-switcher') },
    '../views/RunCloseAction.tsx': { RunCloseAction: stub('run-close-action') },
    '../views/RoleCard.tsx': { RoleGrid: stub('role-grid') },
    '../views/TaskOverview.tsx': { TaskOverview: stub('task-overview') },
    '../views/FlowCanvas.tsx': { FlowCanvas: stub('flow-canvas') },
    '../views/EmptyState.tsx': { EmptyState: stub('empty-state') },
  }
  const localRequire = (id: string): unknown => {
    if (Object.hasOwn(shims, id)) return shims[id]
    if (id.startsWith('.')) return require(join(dirname(file), id))
    return require(id)
  }
  const moduleShim: { exports: Record<string, unknown> } = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    localRequire,
    moduleShim,
    moduleShim.exports,
  )
  return moduleShim.exports
}

const { TasksTab } = loadTab() as { TasksTab: (props: TabProps) => unknown }

function isElement(value: unknown): value is { type: unknown; props: Record<string, unknown> } {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value
}

/** 把渲染树摊平成元素列表（函数组件就地展开，桩组件保留为元素——按 props 断言）。 */
function elementsOf(node: unknown, out: { type: unknown; props: Record<string, unknown> }[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) elementsOf(child, out)
    return out
  }
  if (!isElement(node)) return out
  if (typeof node.type === 'function') {
    elementsOf((node.type as (props: Record<string, unknown>) => unknown)(node.props), out)
    return out
  }
  out.push(node)
  elementsOf(node.props.children, out)
  return out
}

function propsByName(props: TabProps): Record<string, Record<string, unknown>> {
  const found: Record<string, Record<string, unknown>> = {}
  for (const element of elementsOf(TasksTab(props))) {
    // 桩组件在 shims 里是匿名函数，无法按名字找；但三个入口的 props 各自有唯一标记字段：
    // RoleGrid 带 roles+members，TaskOverview 带 tasks+expandedTaskId，FlowCanvas 带 flow。
    const p = element.props
    if (Array.isArray(p.roles) && Array.isArray(p.members) && 'closedRun' in p && !found.RoleGrid) {
      found.RoleGrid = p
    } else if (Array.isArray(p.tasks) && 'expandedTaskId' in p && 'closedRun' in p && !found.TaskOverview) {
      found.TaskOverview = p
    } else if (p.flow !== undefined && Array.isArray(p.members) && 'closedRun' in p && !found.FlowCanvas) {
      found.FlowCanvas = p
    } else if (p.view !== undefined && 'onSelect' in p && !found.RunSwitcher) {
      found.RunSwitcher = p
    } else if (p.detail !== undefined && 'stage' in p && !found.RunHeader) {
      found.RunHeader = p
    }
  }
  return found
}

/* ───────────────────────────── 夹具 ───────────────────────────── */

const AT = Date.parse('2026-11-18T10:00:00+08:00')
const CUR = 'run-cur'
const OLD = 'run-old'
const USAGE: UsageCell = { source: 'provider', text: '1,200', tokens: { total: 1200 } }
const DURATION: DurationCell = { text: '2 分钟', state: 'done', startAt: AT - 120_000, endAt: AT }
const FLOW: FlowView = { nodes: [], edges: [], columns: 1, rows: 1 }

function memberOf(overrides: Partial<MemberView> = {}): MemberView {
  return {
    memberId: 'm-old-1',
    name: '开发-旧',
    roleId: 'dev',
    taskId: 't-old-1',
    taskIds: ['t-old-1'],
    status: 'running',
    modelRoute: 'deepseek:chat',
    canResume: true,
    stalled: false,
    stalledForMs: 0,
    stalledSecondsText: '',
    spawnedAt: AT,
    lastEventAt: AT + 1000,
    ...overrides,
  }
}

function runSummaryOf(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: CUR,
    sessionId: 'sess-1',
    createdAt: AT,
    status: 'dispatching',
    tasks: 1,
    done: 0,
    plannedAt: AT,
    active: true,
    ongoing: 1,
    ...overrides,
  }
}

/** 当前 run 的快照：members 只属于当前 run（宿主口径）。 */
function snapshotOf(overrides: Record<string, unknown> = {}): PanelSnapshot {
  return {
    enabled: true,
    runId: CUR,
    planStatus: 'dispatching',
    plannedAt: AT,
    tasks: [],
    members: [memberOf({ memberId: 'm-cur', name: '开发-当前', taskId: 't-cur', taskIds: ['t-cur'] })],
    messages: [],
    routeAudits: [],
    concurrency: { limit: 8, used: 1, source: 'host' },
    memory: { injectedChars: 0, budget: 4000, truncated: false, files: [] },
    roles: [],
    activity: [],
    runs: [
      runSummaryOf({ runId: OLD, createdAt: AT - 60_000, plannedAt: AT - 60_000 }),
      runSummaryOf(),
    ],
    ...overrides,
  } as unknown as PanelSnapshot
}

/** 历史 run 的详情（宿主下发）：dispatching 且成员仍在。 */
function oldDetailOf(overrides: Partial<RunDetailView> = {}): RunDetailView {
  return {
    runId: OLD,
    sessionId: 'sess-1',
    planStatus: 'dispatching',
    usage: USAGE,
    duration: DURATION,
    roles: [],
    tasks: [],
    flow: FLOW,
    members: [memberOf()],
    ...overrides,
  }
}

function tabProps(overrides: Partial<TabProps> = {}): TabProps {
  return {
    sessionId: 'sess-1',
    snapshot: snapshotOf(),
    act: async () => ({ ok: true }),
    readMemory: async () => undefined,
    loadLibrary: async () => undefined,
    openRun: () => {},
    closeRun: () => {},
    library: null,
    libraryError: null,
    detail: null,
    detailRunId: null,
    paused: false,
    pauseBusy: false,
    onTogglePause: () => {},
    ...overrides,
  } as unknown as TabProps
}

/* ─────────────────── ① 切到旧 run：members 必须来自该 run 的 detail ─────────────────── */

test('切到旧 run：三个入口都拿到该 run 自己的 detail.members，而不是空数组', () => {
  const detail = oldDetailOf()
  const found = propsByName(tabProps({ detail, detailRunId: OLD }))

  for (const name of ['RoleGrid', 'TaskOverview', 'FlowCanvas']) {
    const props = found[name]
    assert.ok(props, `${name} 没有渲染`)
    const members = props.members as MemberView[] | undefined
    assert.ok(Array.isArray(members), `${name}.members 必须是数组`)
    assert.deepEqual(
      members?.map((member) => member.memberId),
      ['m-old-1'],
      `${name}.members 必须取自旧 run 的 detail（旧实现恒为 []）`,
    )
  }
})

test('切到旧 run 且还在派发中：closedRun=false，不得显示「该运行已结束」', () => {
  const found = propsByName(tabProps({ detail: oldDetailOf(), detailRunId: OLD }))
  for (const name of ['RoleGrid', 'TaskOverview', 'FlowCanvas']) {
    assert.equal(found[name]?.closedRun, false, `${name}.closedRun 必须按该 run 自己的 dispatching 判定`)
  }
  // 旧实现写成 `historicalRunId !== null ||` 时会是 true（即用户看到「该运行已结束」）。
})

test('旧 run 真收口（terminated + finishedAt）后，closedRun 才变 true', () => {
  const detail = oldDetailOf({
    planStatus: 'terminated',
    terminationReason: '用户终止',
    finishedAt: AT,
    members: [],
  })
  const found = propsByName(tabProps({ detail, detailRunId: OLD }))
  for (const name of ['RoleGrid', 'TaskOverview', 'FlowCanvas']) {
    assert.equal(found[name]?.closedRun, true, `${name}.closedRun`)
  }
})

/* ─────────── ② 三个入口按同一份 members 判 available（真实 memberJumpOf） ─────────── */

test('三个入口（角色卡/任务行/流程节点）都按该 run 的成员给 available', () => {
  const members = oldDetailOf().members ?? []
  const role = memberJumpOf({ kind: 'role', roleId: 'dev' }, members, { closedRun: false })
  const task = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't-old-1' }, members, {
    closedRun: false,
  })
  const node = memberJumpOf({ kind: 'node', roleId: 'dev', taskId: 't-old-1' }, members, {
    closedRun: false,
  })
  for (const [name, jump] of [
    ['role', role],
    ['task', task],
    ['node', node],
  ] as const) {
    assert.equal(jump.available, true, `${name} 应可跳转`)
    assert.equal(jump.memberId, 'm-old-1', `${name} 应指向旧 run 的成员`)
  }
})

test('旧 run 未收口但没有成员：原因落回「未派发」，不得伪造或谎报已结束', () => {
  const members = oldDetailOf({ members: undefined }).members
  assert.equal(members, undefined, '夹具前提：宿主没给 members')
  const role = memberJumpOf({ kind: 'role', roleId: 'dev' }, members, { closedRun: false })
  const task = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't-old-1' }, members, {
    closedRun: false,
  })
  assert.equal(role.available, false)
  assert.equal(task.available, false)
  assert.equal(role.reason, MEMBER_JUMP_NO_MEMBER_ROLE_REASON)
  assert.equal(task.reason, MEMBER_JUMP_NO_MEMBER_REASON)
  assert.notEqual(role.reason, MEMBER_JUMP_CLOSED_RUN_REASON)
  assert.notEqual(task.reason, MEMBER_JUMP_CLOSED_RUN_REASON)

  // 接线口径：detail 没给 members 时，三入口拿到的是 []（而不是快照里别人的成员）。
  const found = propsByName(tabProps({ detail: oldDetailOf({ members: undefined }), detailRunId: OLD }))
  for (const name of ['RoleGrid', 'TaskOverview', 'FlowCanvas']) {
    assert.deepEqual(found[name]?.members, [], `${name}.members 不得借用当前 run 的成员`)
    assert.equal(found[name]?.closedRun, false, `${name}.closedRun`)
  }
})

test('旧 run 真收口且成员已回收：原因逐字是「该运行已结束，子智能体会话已回收」', () => {
  const members: MemberView[] = []
  const role = memberJumpOf({ kind: 'role', roleId: 'dev' }, members, { closedRun: true })
  const task = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't-old-1' }, members, {
    closedRun: true,
  })
  assert.equal(role.reason, MEMBER_JUMP_CLOSED_RUN_REASON)
  assert.equal(task.reason, MEMBER_JUMP_CLOSED_RUN_REASON)
})

/* ─────────── ③ 当前 run 仍走快照 members（守卫：别把旧 run 的修复改坏） ─────────── */

test('当前 run（detailRunId=null）仍取快照 members，且未收口', () => {
  const found = propsByName(tabProps())
  for (const name of ['RoleGrid', 'TaskOverview', 'FlowCanvas']) {
    const members = found[name]?.members as MemberView[] | undefined
    assert.deepEqual(members?.map((member) => member.memberId), ['m-cur'], `${name}.members`)
    assert.equal(found[name]?.closedRun, false, `${name}.closedRun`)
  }
})

/* ─────────── ④ 切换入口本身在：两个 run 都列在 run 行里，并选中旧 run ─────────── */

test('切到旧 run 时，run 行同时列出当前 run 与旧 run，并选中旧 run', () => {
  const found = propsByName(tabProps({ detail: oldDetailOf(), detailRunId: OLD }))
  const switcher = found.RunSwitcher
  assert.ok(switcher, 'RunSwitcher 没有渲染')
  const view = switcher.view as { rows: { runId: string }[]; selectedRunId?: string }
  assert.deepEqual(
    view.rows.map((row) => row.runId).sort(),
    [CUR, OLD].sort(),
    '两条进行中的 run 都应出现在 run 行里',
  )
  assert.equal(view.selectedRunId, OLD)
})
