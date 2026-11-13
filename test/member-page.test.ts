/**
 * r17：子智能体主界面 + 「角色卡 / 任务行 / 流程图节点 → 成员页」导航的契约测试。
 *
 * 两层证据：
 *  1. 纯投影（`memberForRole` / `memberPageOf` / 导航 store）直接调真实函数；
 *  2. 组件接线用「去注释源码里的钩子」锁定（node 测试没有 JSX 转换，不能渲染组件）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  DurationCell,
  MemberView,
  MessageRecord,
  Role,
  RouteAudit,
  RunDetailView,
  TaskDetailView,
  UsageCell,
} from '../src/shared/types.ts'
import {
  MEMBER_MESSAGE_LIMIT,
  isStaleMemberNav,
  mainNavView,
  memberForRole,
  memberPageOf,
  navigateToMember,
  openLibraryNav,
  openMemberNav,
  resetMainNav,
  resolveMemberSessionId,
  subscribeMainNav,
} from '../src/client/nav.ts'
import { AWAITING_RECEIPT_MEMBER_TEXT, formatStamp } from '../src/client/viewmodel.ts'
import { resetLibrarySurfaceOpener } from '../src/client/slots.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function codeOf(rel: string): string {
  const source = readFileSync(join(ROOT, rel), 'utf8')
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const AT = Date.parse('2026-11-05T09:30:00+08:00')

const USAGE: UsageCell = { source: 'provider', text: '1,200', tokens: { total: 1200 } }
const UNAVAILABLE: UsageCell = { source: 'unavailable', reason: '宿主没有上报用量' }
const DURATION: DurationCell = { text: '2 分钟', state: 'done', startAt: AT - 120_000, endAt: AT }

function memberOf(overrides: Partial<MemberView> = {}): MemberView {
  return {
    memberId: 'm1',
    name: '成员甲',
    roleId: 'dev',
    taskId: 't1',
    status: 'running',
    lastEventAt: AT,
    modelRoute: 'deepseek-v4.1',
    canResume: true,
    stalled: false,
    stalledForMs: 0,
    stalledSecondsText: '',
    ...overrides,
  }
}

function taskOf(overrides: Partial<TaskDetailView> = {}): TaskDetailView {
  return {
    id: 't1',
    title: '实现成员页',
    roleId: 'dev',
    roleName: '高级全栈工程师',
    status: 'running',
    dependsOn: ['t0'],
    acceptance: 'pnpm typecheck',
    writeScopes: ['src/client/nav.ts'],
    evidence: { taskId: 't1', command: 'pnpm typecheck', exitCode: 0, tail: 'ok', artifacts: [], at: AT },
    usage: USAGE,
    duration: DURATION,
    messageCount: 1,
    ...overrides,
  }
}

function messageOf(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    at: AT,
    from: 'captain',
    to: '成员甲',
    toMemberId: 'm1',
    taskId: 't1',
    body: '继续实现成员页',
    messageId: 'msg-1',
    ...overrides,
  }
}

function roleOf(overrides: Partial<Role> = {}): Role {
  return {
    id: 'dev',
    name: '高级全栈工程师',
    duty: '按任务实现代码',
    skillIds: [],
    builtin: false,
    updatedAt: AT,
    ...overrides,
  }
}

/* ───────────────────────── memberForRole ───────────────────────── */

test('memberForRole：未知角色/空列表返回 undefined', () => {
  assert.equal(memberForRole([], 'dev'), undefined)
  assert.equal(memberForRole(undefined, 'dev'), undefined)
  assert.equal(memberForRole([memberOf()], 'qa'), undefined)
})

test('memberForRole：明确绑定 taskId 的成员优先于同角色的 running 成员', () => {
  const bound = memberOf({ memberId: 'm-bound', status: 'done', lastEventAt: AT - 10_000, taskId: 't1' })
  const running = memberOf({ memberId: 'm-running', status: 'running', lastEventAt: AT, taskId: 't2' })
  assert.equal(memberForRole([running, bound], 'dev', 't1')?.memberId, 'm-bound')
})

test('memberForRole：没有绑定关系时 running 优先；同状态取最近活跃', () => {
  const idle = memberOf({ memberId: 'm-idle', status: 'idle', lastEventAt: AT, taskId: undefined })
  const runningOld = memberOf({ memberId: 'm-old', status: 'running', lastEventAt: AT - 60_000 })
  const runningNew = memberOf({ memberId: 'm-new', status: 'running', lastEventAt: AT })
  assert.equal(memberForRole([idle, runningOld, runningNew], 'dev', 't9')?.memberId, 'm-new')
})

test('memberForRole：最近活跃时间相同时按 memberId 升序稳定取第一个', () => {
  const a = memberOf({ memberId: 'm-b', status: 'idle', lastEventAt: AT })
  const b = memberOf({ memberId: 'm-a', status: 'idle', lastEventAt: AT })
  assert.equal(memberForRole([a, b], 'dev')?.memberId, 'm-a')
  assert.equal(memberForRole([b, a], 'dev')?.memberId, 'm-a')
})

test('memberForRole：不会跨角色取人', () => {
  const qa = memberOf({ memberId: 'q1', roleId: 'qa', status: 'running', lastEventAt: AT })
  const dev = memberOf({ memberId: 'd1', status: 'idle', lastEventAt: AT - 1 })
  assert.equal(memberForRole([qa, dev], 'dev')?.memberId, 'd1')
})

/* ───────────────────────── memberPageOf ───────────────────────── */

test('memberPageOf：基础投影（状态、角色、路由、任务单元格）', () => {
  const audits: RouteAudit[] = [
    { taskId: 't1', roleId: 'dev', declared: { provider: 'p', model: 'a' }, actual: { provider: 'p', model: 'a' }, at: AT, verdict: 'ok' },
  ]
  const view = memberPageOf({
    member: memberOf(),
    role: { roleId: 'dev', name: '开发', activeTaskId: 't1' },
    roleDefinition: roleOf(),
    task: taskOf(),
    messages: [messageOf()],
    audits,
  })
  assert.equal(view.memberId, 'm1')
  assert.equal(view.name, '成员甲')
  assert.equal(view.statusText, '运行中')
  assert.equal(view.statusTone, 'business')
  assert.equal(view.roleId, 'dev')
  assert.equal(view.roleName, '开发')
  assert.equal(view.duty, '按任务实现代码')
  assert.equal(view.modelRoute, 'deepseek-v4.1')
  assert.equal(view.routeAudit?.verdict, 'ok')
  assert.equal(view.routeAudit?.tone, 'success')
  assert.equal(view.routeAudit?.text, '声明 p/a · 已核对')
  assert.equal(view.lastActiveText, formatStamp(AT))
  assert.equal(view.canResume, true)
  assert.equal(view.resumeText, '可从面板「继续」恢复该成员')
  assert.equal(view.task?.taskId, 't1')
  assert.equal(view.task?.tokenText, '1,200')
  assert.equal(view.task?.durationText, '2 分钟')
  assert.equal(view.task?.usageSource, 'provider')
  assert.equal(view.task?.evidenceText, 'pnpm typecheck → 退出码 0')
  assert.equal(view.task?.acceptance, 'pnpm typecheck')
  assert.equal(view.task?.dependsText, 't0')
  assert.equal(view.task?.scopeText, 'src/client/nav.ts')
  assert.equal(view.messageCount, 1)
  assert.equal(view.messages[0]?.fromText, '队长')
})

test('memberPageOf：已确认停止 → 状态文案带停止时刻；没有时刻/尚未确认则不带', () => {
  const stopped = memberPageOf({ member: memberOf({ status: 'stopped', stoppedAt: AT }) })
  assert.equal(stopped.statusText, `已停止 ${formatStamp(AT)}`)
  const legacy = memberPageOf({ member: memberOf({ status: 'stopped' }) })
  assert.equal(legacy.statusText, '已停止', '旧快照/缺 stoppedAt 不补时刻')
  const stopping = memberPageOf({ member: memberOf({ status: 'stopping', stopping: true }) })
  assert.equal(stopping.statusText, '停止中', '未确认停止不得显示停止时刻')
})

test('memberPageOf：没有任务时给可读说明，不给空任务块', () => {
  const view = memberPageOf({
    member: memberOf({ taskId: 't-missing' }),
    role: null,
    roleDefinition: roleOf(),
    task: null,
  })
  assert.equal(view.task, undefined)
  assert.match(view.taskText, /t-missing/)
  assert.equal(view.roleName, '高级全栈工程师')
  assert.equal(view.duty, '按任务实现代码')
})

test('memberPageOf：未绑定任务与无审计的两条兜底文案', () => {
  const view = memberPageOf({ member: memberOf({ taskId: undefined, canResume: false }) })
  assert.equal(view.taskText, '未绑定任务')
  assert.equal(view.routeAudit, undefined)
  assert.equal(view.resumeText, '不可续聊')
  assert.equal(view.lastActiveText, formatStamp(AT))
})

test('memberPageOf：路由漂移与未下发两种审计', () => {
  const drift = memberPageOf({
    member: memberOf(),
    audits: [
      { taskId: 't1', roleId: 'dev', declared: { provider: 'p', model: 'a' }, actual: { provider: 'p', model: 'b' }, at: AT, verdict: 'drift' },
    ],
  })
  assert.equal(drift.routeAudit?.verdict, 'drift')
  assert.equal(drift.routeAudit?.tone, 'danger')
  assert.equal(drift.routeAudit?.text, '路由漂移：声明 p/a，实际 p/b')

  const unverified = memberPageOf({
    member: memberOf(),
    audits: [
      { taskId: 't1', roleId: 'dev', declared: { provider: 'p', model: 'a' }, actual: null, at: AT, verdict: 'unverified' },
    ],
  })
  assert.equal(unverified.routeAudit?.verdict, 'unverified')
  assert.equal(unverified.routeAudit?.tone, 'warn')
  assert.equal(unverified.routeAudit?.text, '声明 p/a · 宿主未回传实际路由')
})

test('memberPageOf：审计优先取最近一条，且 taskId 精确匹配优先', () => {
  const view = memberPageOf({
    member: memberOf(),
    audits: [
      { taskId: 't1', roleId: 'dev', declared: null, actual: null, at: AT - 10, verdict: 'ok' },
      { taskId: 't2', roleId: 'dev', declared: null, actual: null, at: AT, verdict: 'drift' },
      { taskId: 't1', roleId: 'dev', declared: null, actual: null, at: AT + 10, verdict: 'unverified' },
    ],
  })
  assert.equal(view.routeAudit?.verdict, 'unverified')
})

test('memberPageOf：消息按时间倒序、只取最近 MEMBER_MESSAGE_LIMIT 条、只算与该成员/任务相关的', () => {
  const related = Array.from({ length: MEMBER_MESSAGE_LIMIT + 4 }, (_, index) =>
    messageOf({ messageId: `msg-${index}`, at: AT + index, toMemberId: undefined, taskId: 't1' }),
  )
  const unrelated = messageOf({ messageId: 'other', at: AT + 100, toMemberId: 'm2', taskId: 't9' })
  const view = memberPageOf({ member: memberOf(), messages: [unrelated, ...related] })
  assert.equal(view.messages.length, MEMBER_MESSAGE_LIMIT)
  assert.equal(view.messageCount, MEMBER_MESSAGE_LIMIT + 4)
  assert.equal(view.messages[0]?.messageId, `msg-${MEMBER_MESSAGE_LIMIT + 3}`)
  assert.equal(view.messages.at(-1)?.messageId, 'msg-4')
})

test('memberPageOf：长正文标记 foldable，空消息给可读空态', () => {
  const long = messageOf({ body: 'x'.repeat(200) })
  const view = memberPageOf({ member: memberOf(), messages: [long] })
  assert.equal(view.messages[0]?.foldable, true)
  assert.equal(view.messages[0]?.body.length, 200)

  const empty = memberPageOf({ member: memberOf() })
  assert.equal(empty.messages.length, 0)
  assert.equal(empty.messageCount, 0)
  assert.match(empty.emptyMessagesText, /直接消息/)
})

test('memberPageOf：停滞只在 running + stalled 时显示，且只读宿主下发的秒数', () => {
  const stalled = memberPageOf({
    member: memberOf({ stalled: true, stalledSecondsText: '3 分 20 秒' }),
  })
  assert.equal(stalled.stalled, true)
  assert.match(stalled.stalledText, /3 分 20 秒/)

  const done = memberPageOf({ member: memberOf({ status: 'done', stalled: true, stalledSecondsText: '9 分' }) })
  assert.equal(done.stalled, false)
  assert.equal(done.stalledText, '')
})

test('memberPageOf：待回执与停滞是两件事（事实来源与文案都不同）', () => {
  const awaiting = memberPageOf({
    member: memberOf({ stalled: false }),
    // 旧快照只有 silentFinish：兜底也要能判出来
    task: { ...taskOf(), silentFinish: { at: AT, memberId: 'm1' } },
  })
  assert.equal(awaiting.stalled, false, '已结束本轮 ≠ 停滞')
  assert.equal(awaiting.awaitingReceipt?.text, AWAITING_RECEIPT_MEMBER_TEXT)
  assert.match(awaiting.awaitingReceipt?.title ?? '', /未提交回执/)

  // 还活着但没产出（停滞）→ 只有黄条，没有待回执
  const stalled = memberPageOf({
    member: memberOf({ stalled: true, stalledSecondsText: '3 分 20 秒' }),
    task: taskOf(),
  })
  assert.equal(stalled.stalled, true)
  assert.equal(stalled.awaitingReceipt, undefined)

  // 宿主显式 false（已补回执）→ 不再拿 silentFinish 反推
  const cleared = memberPageOf({
    member: memberOf(),
    task: { ...taskOf(), awaitingReceipt: false, silentFinish: { at: AT, memberId: 'm1' } },
  })
  assert.equal(cleared.awaitingReceipt, undefined)
})

test('memberPageOf：任务用量不可得时沿用「不可得」而不是 0', () => {
  const view = memberPageOf({ member: memberOf(), task: taskOf({ usage: UNAVAILABLE }) })
  assert.equal(view.task?.tokenText, '不可得')
  assert.equal(view.task?.usageSource, 'unavailable')
})

/* ───────────────────────── 导航 store ───────────────────────── */

test('导航 store：默认项目库，openMemberNav/openLibraryNav 驱动订阅者', () => {
  resetMainNav()
  assert.deepEqual(mainNavView(), { kind: 'library' })

  const seen: string[] = []
  const unsubscribe = subscribeMainNav(() => seen.push(mainNavView().kind))
  openMemberNav('m1', 't1')
  assert.deepEqual(mainNavView(), { kind: 'member', memberId: 'm1', taskId: 't1' })
  openLibraryNav()
  assert.deepEqual(mainNavView(), { kind: 'library' })
  assert.deepEqual(seen, ['member', 'library'])

  unsubscribe()
  openMemberNav('m2')
  assert.deepEqual(seen, ['member', 'library'], '取消订阅后不应再收到通知')
  resetMainNav()
})

test('导航 store：空 memberId 回项目库', () => {
  resetMainNav()
  openMemberNav('  ')
  assert.deepEqual(mainNavView(), { kind: 'library' })
  openMemberNav('m3', '  ')
  assert.deepEqual(mainNavView(), { kind: 'member', memberId: 'm3' })
  resetMainNav()
})

test('导航 store：openMemberNav 携带来源会话；空 sessionId 不写该键', () => {
  resetMainNav()
  const returned = openMemberNav('m1', 't1', 'session-x')
  assert.deepEqual(returned, { kind: 'member', memberId: 'm1', taskId: 't1', sessionId: 'session-x' })
  assert.deepEqual(mainNavView(), { kind: 'member', memberId: 'm1', taskId: 't1', sessionId: 'session-x' })

  openMemberNav('m1', undefined, 'session-x')
  assert.deepEqual(mainNavView(), { kind: 'member', memberId: 'm1', sessionId: 'session-x' })

  openMemberNav('m1', 't1', '')
  assert.deepEqual(mainNavView(), { kind: 'member', memberId: 'm1', taskId: 't1' })

  openMemberNav('m1', 't1', '   ')
  assert.deepEqual(mainNavView(), { kind: 'member', memberId: 'm1', taskId: 't1' })
  resetMainNav()
})

test('resolveMemberSessionId：导航会话优先，props 会话次之，都空时原样返回', () => {
  // 真机根因：main 槽位 props 是 'current'，必须落到导航记下的 session-x。
  assert.equal(resolveMemberSessionId('current', { kind: 'member', memberId: 'm1', sessionId: 'session-x' }), 'session-x')
  // 导航没记会话（旧状态 / 直接 openMemberNav('m1')）→ 用 props。
  assert.equal(resolveMemberSessionId('session-y', { kind: 'member', memberId: 'm1' }), 'session-y')
  // 都不给 → 返回 props 原值（'current' 哨兵仍由调用方决定怎么用）。
  assert.equal(resolveMemberSessionId('current', { kind: 'library' }), 'current')
})

test('isStaleMemberNav：只剩「props 是另一个真实会话」才判陈旧', () => {
  const nav = { kind: 'member' as const, memberId: 'm1', sessionId: 'session-b' }
  // 陈旧：props 是真实会话 A，导航来自会话 B。
  assert.equal(isStaleMemberNav('session-a', nav), true)
  // 不陈旧：props 就是导航会话。
  assert.equal(isStaleMemberNav('session-b', nav), false)
  // 不陈旧：'current' 是「宿主没说」的哨兵，主界面靠它落到导航会话。
  assert.equal(isStaleMemberNav('current', nav), false)
  // 不陈旧：导航没记会话。
  assert.equal(isStaleMemberNav('session-a', { kind: 'member', memberId: 'm1' }), false)
  // 不陈旧：当前在项目库。
  assert.equal(isStaleMemberNav('session-a', { kind: 'library' }), false)
})

test('navigateToMember：先切导航再请求打开主区；没注册 opener 时 surface 为 null', () => {
  resetMainNav()
  resetLibrarySurfaceOpener()
  const result = navigateToMember('sess-1', 'm1', 't1')
  assert.deepEqual(result.nav, { kind: 'member', memberId: 'm1', taskId: 't1', sessionId: 'sess-1' })
  assert.equal(result.surface, null)
  assert.deepEqual(mainNavView(), result.nav)
  resetMainNav()
  resetLibrarySurfaceOpener()
})

/* ───────────────────────── 组件接线（源码契约） ───────────────────────── */

test('MemberPage.tsx：成员页钩子齐全，且不自行格式化', () => {
  const source = codeOf('src/client/views/MemberPage.tsx')
  for (const hook of [
    'data-member-page',
    'data-member-back',
    'data-member-name',
    'data-member-status',
    'data-member-model',
    'data-member-route-audit',
    'data-member-facts',
    'data-member-task',
    'data-member-task-empty',
    'data-region="member-messages"',
    'data-member-message',
    'data-member-found',
  ]) {
    assert.ok(source.includes(hook), `MemberPage 缺钩子 ${hook}`)
  }
  assert.doesNotMatch(source, /toLocaleString/, '成员页不得本地化数字')
  assert.doesNotMatch(source, /小时|分钟/, '成员页不得拼时长单位')
  assert.match(source, /from '\.\.\/nav\.ts'/, '成员页的类型/投影必须来自 nav.ts')
})

test('MemberPage.tsx：找不到成员时给可读空态与返回入口', () => {
  const source = codeOf('src/client/views/MemberPage.tsx')
  assert.match(source, /view === null/)
  assert.match(source, /成员已不在当前 run 里/)
  assert.match(source, /data-member-back[^>]*onClick=\{onBack\}/)
})

test('RoleCard.tsx：整张卡片可点，打开执行该角色的成员', () => {
  const source = codeOf('src/client/views/RoleCard.tsx')
  assert.ok(source.includes('data-role-card-open'), '角色卡缺 data-role-card-open')
  // r33：判定统一收口到 memberJumpOf（三入口唯一实现），组件不再直接找成员。
  assert.match(source, /memberJumpOf\(/)
  assert.equal(source.includes('memberForRole('), false)
  assert.match(source, /role=\{onJump === undefined \? undefined : 'button'\}/)
  assert.match(source, /onClick=\{onJump === undefined \? undefined : \(\) => onJump\(jump\)\}/)
  assert.match(source, /onKeyDown=/)
})

test('TaskTable.tsx：任务行有独立的「子智能体」入口且不吞展开事件', () => {
  const source = codeOf('src/client/views/TaskTable.tsx')
  assert.ok(source.includes('data-task-open-member'), '任务行缺 data-task-open-member')
  assert.match(source, /memberJumpOf\(/)
  assert.equal(source.includes('memberForRole('), false)
  assert.match(source, /onClick=\{\(\) => onJump\(jump\)\}/)
  assert.ok(source.includes('data-task-toggle'), '原有展开按钮必须保留')
})

test('TaskOverview.tsx：把成员导航透传给分组任务表', () => {
  const source = codeOf('src/client/views/TaskOverview.tsx')
  assert.match(source, /onJump\?: \(jump: MemberJumpView\) => void/)
  assert.match(source, /members=\{members\}/)
  assert.match(source, /onJump=\{onJump\}/)
})

test('FlowCanvas.tsx：点节点优先打开成员，找不到成员才退回选中任务', () => {
  const source = codeOf('src/client/views/FlowCanvas.tsx')
  assert.match(source, /memberJumpOf\(/)
  assert.equal(source.includes('memberForRole('), false)
  assert.match(source, /onJump\(jump\)/)
  assert.match(source, /onSelectTask\(node\.id\)/)
})


test('LibraryPage.tsx：主界面按导航渲染项目库或成员页', () => {
  const source = codeOf('src/client/LibraryPage.tsx')
  assert.match(source, /subscribeMainNav/)
  assert.match(source, /memberPageOf\(\{/)
  assert.match(source, /<MemberPage/)
  assert.match(source, /onBack=\{openLibraryNav\}/)
  assert.ok(source.includes('data-library-view={nav.kind}'), '外壳缺 data-library-view')
  // t8：成员页的会话必须来自导航（main 槽位 props 只有 'current'），陈旧导航要回落项目库。
  assert.match(source, /resolveMemberSessionId\(propsSessionId, nav\)/)
  // 陈旧回落时喂给 usePanelState 的必须是 props 的真实会话，不能沿用导航会话。
  assert.match(source, /staleMemberNav \? propsSessionId : resolveMemberSessionId\(propsSessionId, nav\)/)
  assert.match(source, /const propsSessionId = sessionIdOf\(props\)/)
  assert.match(source, /isStaleMemberNav\(propsSessionId, nav\)/)
  assert.match(source, /nav\.kind === 'member' && !staleMemberNav/)
})
