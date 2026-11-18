/**
 * r54 QA 回归：左栏「运行详情抽屉」的三处子智能体跳转入口。
 *
 * 用户可见事实（AC）：
 *  ① 进行中的 run 且 `members` 有该行成员 → 任务行 `[data-task-open-member]`
 *     的 `data-member-jump=available`、角色标记 `role=button`，三个入口都能跳；
 *  ② 无成员 → 三个入口 `available=false`，可见文案与原因**逐字**一致；
 *  ③ 已结束 run（`isClosedRun`）且无成员 → 文案「子智能体 · 不可跳转」+
 *     原因「该运行已结束，子智能体会话已回收」；
 *  ④ 抽屉是只读快照：不渲染暂停/取消按钮（不传 onTaskAction / onTogglePause）；
 *  ⑤ 反向守卫：LibraryPage 里三处调用必须都带 `members` 与 `onJump`。
 *
 * 判据为什么这样写：本仓没有 react-dom，`node --test` 也不转 JSX。这里沿用
 * `test/r18-run-cards.test.ts` 的做法 —— 用 `typescript.transpileModule` 把
 * `.tsx` 就地编译成 CJS（`react` 由 `createRequire` 提供，FlowCanvas 的 hooks 用
 * 同步桩替代），拿到**真实元素树**再断言 DOM 钩子。这样 ① 断的是「组件真的
 * 把 available 贴到按钮上」，不是源码里有没有那个字符串；把 TaskTable 的
 * `data-member-jump={jump.available ? …}` 改成常量 `'available'`，② 与 ③ 都会红。
 *
 * ⑤ 是反向守卫：只去掉任意一处 `members=` / `onJump=`，对应断言即红。
 * ④ 同时有静态接线与组件门禁两段证据：抽屉区域没有写操作属性，且 TaskTable /
 * RunHeader 只有在收到写操作回调时才渲染按钮。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  DurationCell,
  FlowNodeView,
  FlowView,
  MemberView,
  RoleUsageView,
  RunDetailView,
  TaskDetailView,
  UsageCell,
} from '../src/shared/types.ts'
import {
  MEMBER_JUMP_CLOSED_RUN_REASON,
  MEMBER_JUMP_CLOSED_RUN_TEXT,
  MEMBER_JUMP_NO_MEMBER_REASON,
  MEMBER_JUMP_NO_MEMBER_ROLE_REASON,
  MEMBER_JUMP_NO_MEMBER_TEXT,
  isClosedRun,
  memberJumpOf,
} from '../src/client/viewmodel.ts'
import { buildRunDetail } from '../src/client/viewmodel.ts'
import type { TaskTableProps } from '../src/client/views/TaskTable.tsx'
import type { RoleGridProps } from '../src/client/views/RoleCard.tsx'
import type { FlowCanvasProps } from '../src/client/views/FlowCanvas.tsx'
import type { RunHeaderProps } from '../src/client/views/RunHeader.tsx'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ts = require('typescript') as typeof import('typescript')
const react = require('react') as unknown as Record<string, unknown>

function codeOf(rel: string): string {
  const source = readFileSync(join(ROOT, rel), 'utf8')
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/* ─────────────────── 就地编译 + 真实元素树 ─────────────────── */

interface HostNode {
  type: string
  props: Record<string, unknown>
}

/** FlowCanvas 的 hooks 桩：渲染期只读初值，不跑副作用。 */
function reactWithHooks(): Record<string, unknown> {
  return {
    createElement: react.createElement,
    Fragment: react.Fragment,
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useId: () => ':r54:',
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [value, () => {}],
    useEffect: () => {},
  }
}

function loadView(rel: string, shims: Record<string, unknown> = {}): Record<string, unknown> {
  const file = join(ROOT, rel)
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText
  const localRequire = (id: string): unknown => {
    if (id === 'react') return shims.react ?? react
    if (Object.hasOwn(shims, id)) return shims[id]
    // 编译产物里的相对 import 要按**源文件**所在目录解析，否则会从 test/ 找起。
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

function isElement(value: unknown): value is { type: unknown; props: Record<string, unknown> } {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value
}

/** 收集渲染树里的宿主元素（字符串 type），函数组件就地展开。 */
function elementsOf(node: unknown, out: HostNode[] = []): HostNode[] {
  if (Array.isArray(node)) {
    for (const child of node) elementsOf(child, out)
    return out
  }
  if (!isElement(node)) return out
  if (typeof node.type === 'function') {
    elementsOf((node.type as (props: Record<string, unknown>) => unknown)(node.props), out)
    return out
  }
  if (typeof node.type === 'string') out.push({ type: node.type, props: node.props })
  elementsOf(node.props.children, out)
  return out
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!isElement(node)) return ''
  if (typeof node.type === 'function') {
    return textOf((node.type as (props: Record<string, unknown>) => unknown)(node.props))
  }
  return textOf(node.props.children)
}

function byHook(nodes: HostNode[], hook: string): HostNode | undefined {
  return nodes.find((node) => node.props[hook] !== undefined)
}

const TaskTable = loadView('src/client/views/TaskTable.tsx', {
  './EmptyState.tsx': { EmptyState: () => null },
}).TaskTable as (props: TaskTableProps) => unknown
const RoleGrid = loadView('src/client/views/RoleCard.tsx').RoleGrid as (
  props: RoleGridProps,
) => unknown
const FlowCanvas = loadView('src/client/views/FlowCanvas.tsx', {
  react: reactWithHooks(),
}).FlowCanvas as (props: FlowCanvasProps) => unknown
const RunHeader = loadView('src/client/views/RunHeader.tsx').RunHeader as (
  props: RunHeaderProps,
) => unknown

/* ────────────────────────── 夹具 ────────────────────────── */

const AT = Date.parse('2026-11-18T10:00:00+08:00')
const USAGE: UsageCell = { source: 'provider', text: '1,200', tokens: { total: 1200 } }
const DURATION: DurationCell = { text: '2 分钟', state: 'done', startAt: AT - 120_000, endAt: AT }

function taskOf(overrides: Partial<TaskDetailView> = {}): TaskDetailView {
  return {
    id: 't1',
    title: '实现运行详情抽屉',
    roleId: 'dev',
    roleName: '高级全栈工程师',
    status: 'running',
    dependsOn: [],
    acceptance: 'pnpm typecheck',
    usage: USAGE,
    duration: DURATION,
    messageCount: 0,
    ...overrides,
  }
}

function memberOf(overrides: Partial<MemberView> = {}): MemberView {
  return {
    memberId: 'm1',
    name: '开发-1',
    roleId: 'dev',
    taskId: 't1',
    taskIds: ['t1'],
    status: 'running',
    lastEventAt: AT,
    modelRoute: '会话默认',
    canResume: true,
    stalled: false,
    stalledForMs: 0,
    stalledSecondsText: '',
    ...overrides,
  }
}

function roleOf(overrides: Partial<RoleUsageView> = {}): RoleUsageView {
  return {
    roleId: 'dev',
    name: '高级全栈工程师',
    tasks: 1,
    usage: USAGE,
    done: 0,
    state: 'running',
    stateText: '执行中',
    activeTaskId: 't1',
    activeTaskTitle: '实现运行详情抽屉',
    duration: DURATION,
    ...overrides,
  }
}

function flowNodeOf(overrides: Partial<FlowNodeView> = {}): FlowNodeView {
  return {
    id: 't1',
    title: '实现运行详情抽屉',
    status: 'running',
    column: 0,
    row: 0,
    roleId: 'dev',
    roleName: '高级全栈工程师',
    usage: USAGE,
    duration: DURATION,
    ...overrides,
  }
}

function flowOf(nodes: FlowNodeView[]): FlowView {
  return { nodes, edges: [], columns: 1, rows: nodes.length }
}

/* ───────────── ① 进行中 run + 有成员：三入口真的可跳 ───────────── */

test('r54 ① 进行中 run：任务行按钮 available，角色标记 role=button 且可跳', () => {
  assert.equal(
    isClosedRun({ status: 'dispatching' }),
    false,
    '进行中的 run 不能被判成已结束（否则②③的文案分支会串）',
  )
  const nodes = elementsOf(
    TaskTable({
      tasks: [taskOf()],
      expandedTaskId: undefined,
      onToggleTask: () => {},
      members: [memberOf()],
      onJump: () => {},
    }),
  )

  const open = byHook(nodes, 'data-task-open-member')
  assert.ok(open, '任务行必须渲染 [data-task-open-member]（唯一跳转按钮）')
  assert.equal(open.type, 'button')
  assert.equal(open.props['data-member-jump'], 'available', '有成员 → available')
  assert.equal(open.props['data-member-id'], 'm1', 'memberId 必须来自命中的成员')
  assert.equal(open.props['data-task-id'], 't1')
  assert.match(textOf(open), /^子智能体 · .+ →$/, '可跳时按钮文案是成员/任务名 + 箭头')

  // 角色标记（同一行的第二入口）必须是可聚焦的 button 语义。
  const role = byHook(nodes, 'data-task-role')
  assert.ok(role, '任务行必须渲染角色标记 [data-task-role]')
  assert.equal(role.props.role, 'button', '有 onJump 时角色标记必须是 role=button')
  assert.equal(role.props.tabIndex, 0, '角色标记必须进 Tab 序列')
  assert.equal(role.props['data-member-jump'], 'available')
  assert.equal(role.props['data-member-id'], 'm1')
})

test('r54 ① 进行中 run：角色卡与流程图节点都能跳（同源判定）', () => {
  const roleNodes = elementsOf(
    RoleGrid({ roles: [roleOf()], members: [memberOf()], tasks: [taskOf()], onJump: () => {} }),
  )
  const card = byHook(roleNodes, 'data-role-card')
  assert.ok(card, '必须渲染 [data-role-card]')
  assert.equal(card.type, 'article')
  assert.equal(card.props.role, 'button', '有成员时角色卡是按钮语义')
  assert.equal(card.props.tabIndex, 0)
  assert.equal(card.props['data-member-jump'], 'available')
  assert.equal(card.props['data-member-id'], 'm1')

  const flowNodes = elementsOf(
    FlowCanvas({ flow: flowOf([flowNodeOf()]), onSelectTask: () => {}, members: [memberOf()], onJump: () => {} }),
  )
  const node = byHook(flowNodes, 'data-flow-node')
  assert.ok(node, '必须渲染流程图节点 [data-flow-node]')
  assert.equal(node.type, 'button')
  assert.equal(node.props['data-member-jump'], 'available', '有成员 → 节点可跳')
  assert.equal(node.props['data-member-id'], 'm1')

  // 三个入口的判定必须同一结果（不是各写一套）。
  const sources = [
    { kind: 'task', roleId: 'dev', taskId: 't1' } as const,
    { kind: 'role', roleId: 'dev', taskId: 't1' } as const,
    { kind: 'node', roleId: 'dev', taskId: 't1' } as const,
  ]
  for (const source of sources) {
    const jump = memberJumpOf(source, [memberOf()])
    assert.equal(jump.available, true, `${source.kind}：有成员必须可跳`)
    assert.equal(jump.memberId, 'm1')
  }
})

/* ───────────── ② 无成员：available=false，文案/原因逐字 ───────────── */

test('r54 ② 无成员：三个入口都不可跳，原因按入口类型逐字', () => {
  const taskJump = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, [])
  assert.equal(taskJump.available, false)
  assert.equal(taskJump.memberId, undefined, '不可跳时不得下发 memberId')
  assert.equal(taskJump.actionText, MEMBER_JUMP_NO_MEMBER_TEXT)
  assert.equal(taskJump.reason, MEMBER_JUMP_NO_MEMBER_REASON)
  assert.equal(taskJump.title, MEMBER_JUMP_NO_MEMBER_REASON, 'title 必须带原因（点击前可见）')

  const roleJump = memberJumpOf({ kind: 'role', roleId: 'dev', taskId: 't1' }, [])
  assert.equal(roleJump.available, false)
  assert.equal(roleJump.reason, MEMBER_JUMP_NO_MEMBER_ROLE_REASON, '角色卡无成员的原因文案不得复用任务行那句')

  const nodeJump = memberJumpOf({ kind: 'node', roleId: 'dev', taskId: 't1' }, [])
  assert.equal(nodeJump.available, false)
  assert.equal(nodeJump.reason, MEMBER_JUMP_NO_MEMBER_REASON)
})

test('r54 ② 无成员时抽屉任务行按钮：data-member-jump=unavailable，可见文案逐字', () => {
  const nodes = elementsOf(
    TaskTable({
      tasks: [taskOf()],
      onToggleTask: () => {},
      members: [],
      onJump: () => {},
      closedRun: false,
    }),
  )
  const open = byHook(nodes, 'data-task-open-member')
  assert.ok(open)
  assert.equal(open.props['data-member-jump'], 'unavailable')
  assert.equal(textOf(open), MEMBER_JUMP_NO_MEMBER_TEXT)
  assert.match(String(open.props.title), /该任务还没有可跳转的成员/, 'title 必须包含逐字原因')

  // 反向证据：同一个组件在有成员时是 available —— 常量实现会同时骗过这里。
  const withMember = elementsOf(
    TaskTable({ tasks: [taskOf()], onToggleTask: () => {}, members: [memberOf()], onJump: () => {} }),
  )
  assert.equal(
    byHook(withMember, 'data-task-open-member')?.props['data-member-jump'],
    'available',
    'availability 必须由成员事实派生，不能写死',
  )
})

/* ───────────── ③ 已结束 run：换文案，不换入口 ───────────── */

test('r54 ③ isClosedRun：终止/取消为真，进行中为假，旧宿主靠 terminationReason+finishedAt', () => {
  assert.equal(isClosedRun({ status: 'terminated' }), true)
  assert.equal(isClosedRun({ status: 'cancelled' }), true)
  assert.equal(isClosedRun({ status: 'dispatching' }), false)
  assert.equal(isClosedRun({ status: 'paused' }), false)
  assert.equal(
    isClosedRun({ status: 'dispatching', terminationReason: '用户终止', finishedAt: AT }),
    true,
    '计划态没写终态但已终止且有结束时刻 → 仍视为已结束',
  )
  assert.equal(
    isClosedRun({ status: 'dispatching', terminationReason: '用户终止' }),
    false,
    '只有终止原因没有结束时刻 → 不能猜成已结束',
  )
})

test('r54 ③ 已结束 run 无成员：文案「子智能体 · 不可跳转」+ 原因逐字（三入口）', () => {
  const sources = [
    { kind: 'task', roleId: 'dev', taskId: 't1' } as const,
    { kind: 'role', roleId: 'dev', taskId: 't1' } as const,
    { kind: 'node', roleId: 'dev', taskId: 't1' } as const,
  ]
  for (const source of sources) {
    const jump = memberJumpOf(source, [], { closedRun: true })
    assert.equal(jump.available, false, `${source.kind}：已结束 run 无成员必须不可跳`)
    assert.equal(jump.actionText, MEMBER_JUMP_CLOSED_RUN_TEXT, `${source.kind}：可见文案逐字`)
    assert.equal(jump.reason, MEMBER_JUMP_CLOSED_RUN_REASON, `${source.kind}：原因逐字`)
  }
})

test('r54 ③ 已结束 run 的抽屉任务行：按钮仍渲染，只是不可跳 + 换文案', () => {
  const nodes = elementsOf(
    TaskTable({
      tasks: [taskOf()],
      onToggleTask: () => {},
      members: [],
      onJump: () => {},
      closedRun: true,
    }),
  )
  const open = byHook(nodes, 'data-task-open-member')
  assert.ok(open, '入口必须保留（不能因历史 run 整体消失）')
  assert.equal(open.props['data-member-jump'], 'unavailable')
  assert.equal(textOf(open), MEMBER_JUMP_CLOSED_RUN_TEXT)
  assert.match(String(open.props.title), /该运行已结束，子智能体会话已回收/)
})

test('r54 ③ 成员仍在快照里：已结束不改可跳性（判据始终是「有没有成员」）', () => {
  const nodes = elementsOf(
    TaskTable({
      tasks: [taskOf()],
      onToggleTask: () => {},
      members: [memberOf({ status: 'interrupted' })],
      onJump: () => {},
      closedRun: true,
    }),
  )
  const open = byHook(nodes, 'data-task-open-member')
  assert.ok(open)
  assert.equal(open.props['data-member-jump'], 'available', '成员还在 = 会话还在，照常可跳')
  assert.equal(open.props['data-member-id'], 'm1')
})

test('r54 ③ RunDetailView.members 透传到抽屉（缺省不补 []）', () => {
  const detail: RunDetailView = {
    runId: 'r54',
    sessionId: 's1',
    planStatus: 'terminated',
    usage: USAGE,
    duration: DURATION,
    roles: [roleOf()],
    tasks: [taskOf()],
    flow: flowOf([flowNodeOf()]),
    members: [memberOf()],
  }
  const view = buildRunDetail({ snapshot: null, runDetail: detail }, 'r54')
  assert.ok(view)
  assert.equal(view.members?.length, 1, '宿主已落盘的成员行必须原样到达抽屉，不能丢')
  assert.equal(view.members?.[0]?.memberId, 'm1')

  const withoutMembers: RunDetailView = { ...detail, members: undefined }
  assert.equal(
    buildRunDetail({ snapshot: null, runDetail: withoutMembers }, 'r54')?.members,
    undefined,
    '拿不到名单时不许补 [] 冒充「确实没有成员」',
  )
})

test('r54 ③ 文案常量与验收口径逐字一致（防止改了常量自证通过）', () => {
  assert.equal(MEMBER_JUMP_CLOSED_RUN_TEXT, '子智能体 · 不可跳转')
  assert.equal(MEMBER_JUMP_CLOSED_RUN_REASON, '该运行已结束，子智能体会话已回收')
  assert.equal(MEMBER_JUMP_NO_MEMBER_TEXT, '子智能体 · 未派发')
  assert.equal(
    MEMBER_JUMP_NO_MEMBER_REASON,
    '该任务还没有可跳转的成员：可能尚未派发，或成员已回收',
  )
})

/* ───────────── ④ 抽屉只读：不渲染暂停/取消按钮 ───────────── */

test('r54 ④ LibraryPage 抽屉区域不接写操作（无暂停/取消入口）', () => {
  const source = codeOf('src/client/LibraryPage.tsx')
  const start = source.indexOf('<RunDrawer')
  const end = source.indexOf('</RunDrawer>')
  assert.ok(start > 0 && end > start, 'LibraryPage 必须能找到 RunDrawer 区域')
  const drawer = source.slice(start, end)

  for (const forbidden of [
    'onTaskAction',
    'onTogglePause',
    'data-task-action',
    'closeRun',
    'RunCloseAction',
    'ConfirmDialog',
    'onTaskActionBusy',
  ]) {
    assert.equal(
      drawer.includes(forbidden),
      false,
      `抽屉是只读快照，不得出现写操作入口：${forbidden}`,
    )
  }
  // RunHeader 在抽屉里不传 onTogglePause（团队级暂停按钮唯一的开关）。
  assert.match(
    drawer,
    /<RunHeader\s+detail=\{detailView\}\s+inflight="idle"\s*\/>/,
    '抽屉 RunHeader 只能拿展示事实，不能挂暂停回调',
  )
})

test('r54 ④ 组件门禁：没有写回调就不渲染暂停按钮（静态接线之外的执行证据）', () => {
  const plain = elementsOf(
    TaskTable({ tasks: [taskOf()], onToggleTask: () => {}, members: [], onJump: () => {} }),
  )
  assert.equal(byHook(plain, 'data-task-action'), undefined, '不传 onTaskAction → 不渲染任务动作按钮')

  const withAction = elementsOf(
    TaskTable({
      tasks: [taskOf()],
      onToggleTask: () => {},
      members: [],
      onJump: () => {},
      onTaskAction: () => {},
    }),
  )
  const pause = byHook(withAction, 'data-task-action')
  assert.ok(pause, '反向证据：传了 onTaskAction 才出现暂停按钮')
  assert.equal(pause.props['data-task-action'], 'pause')

  const detail: RunDetailView = {
    runId: 'r54',
    sessionId: 's1',
    planStatus: 'dispatching',
    usage: USAGE,
    duration: DURATION,
    roles: [roleOf()],
    tasks: [taskOf()],
    flow: flowOf([flowNodeOf()]),
    members: [],
  }
  const header = elementsOf(RunHeader({ detail, inflight: 'idle' }))
  assert.equal(byHook(header, 'data-auto-team-pause'), undefined, '不传 onTogglePause → 不渲染暂停团队按钮')
  const headerWithPause = elementsOf(
    RunHeader({ detail, inflight: 'idle', onTogglePause: () => {} }),
  )
  assert.ok(byHook(headerWithPause, 'data-auto-team-pause'), '反向证据：传了回调才出现暂停按钮')
})

/* ───────────── ⑤ 反向守卫：三处调用必须都带 members / onJump ───────────── */

test('r54 ⑤ LibraryPage 的 RoleGrid/TaskOverview/FlowCanvas 不得缺 members 或 onJump', () => {
  const source = codeOf('src/client/LibraryPage.tsx')
  const calls = [...source.matchAll(/<(RoleGrid|TaskOverview|FlowCanvas)\b[\s\S]*?\/>/g)]
  assert.equal(calls.length, 3, 'LibraryPage 应恰好有 3 处跳转入口调用')

  const seen = new Set<string>()
  for (const call of calls) {
    const tag = call[1] as string
    const block = call[0]
    seen.add(tag)
    assert.match(block, /members=\{drawerMembers\}/, `${tag} 必须收到同一份成员列表`)
    assert.match(block, /onJump=\{jumpToMember\}/, `${tag} 必须接到同一条跳转动作`)
    assert.equal(
      /members=\{undefined\}|onJump=\{undefined\}/.test(block),
      false,
      `${tag} 不得用 undefined 占位冒充接线`,
    )
  }
  assert.deepEqual([...seen].sort(), ['FlowCanvas', 'RoleGrid', 'TaskOverview'])
})

test('r54 ⑤ 成员列表与已结束判定都来自抽屉事实，不是写死或二次查询', () => {
  const source = codeOf('src/client/LibraryPage.tsx')
  assert.match(source, /const drawerMembers = detailView === null \? \[\] : \(detailView\.members \?\? \[\]\)/, '成员列表必须取 detailView.members')
  assert.match(source, /const drawerClosedRun = detailView !== null && isClosedRun\(\{ status: detailView\.planStatus \}\)/, '已结束判定必须复用 isClosedRun')
  assert.equal(source.includes('memberForRole('), false, '页面不得二次查成员，判定只在下游一次')
})
