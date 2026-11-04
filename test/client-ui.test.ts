/**
 * 渲染描述层（`src/client/ui.ts`）的单测 —— AC-12 / AC-13 / AC-14 / AC-15 / AC-16 的判据落点。
 *
 * 为什么不用快照测试：本仓没有 `react-dom`（`node --test` 也不转 JSX），
 * `renderToStaticMarkup` 物理上跑不了。所以把「组件该显示什么」全部收进无 JSX 的纯函数，
 * 这里直接驱动它：hook 字面量、往返文案、busy 期间文案不变，全部是可断言的事实。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  deviationRowView,
  headerButtonView,
  modelPickerLabel,
  optionView,
  pauseButtonView,
  restoreConfirmView,
  scopeLockRowView,
  settingsKeysView,
  skillRowView,
  skillSourceLabel,
  taskRowView,
} from '../src/client/ui.ts'
import {
  deviationRowOf,
  deviationRowsOf,
  deviationWriteCountOf,
  progressOf,
  scopeLockRowOf,
  scopeLockRowsOf,
  statusBadge,
  taskActionsOf,
  waitReasonOf,
} from '../src/client/viewmodel.ts'
import { TASK_ACTION_ALLOW, TASK_STATUS_LABELS, taskActionDisabledReason } from '../src/shared/task-actions.ts'
import type {
  AutoTeamSettings,
  PlanStatus,
  PlanTask,
  Role,
  ScopeLockView,
  SkillInfo,
  SkillSource,
  DeviationView,
  TaskStatus,
} from '../src/shared/types.ts'

/* ────────────────────────── 夹具 ────────────────────────── */

function taskOf(id: string, status: TaskStatus, extra: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `任务${id}`,
    roleId: 'dev',
    dependsOn: [],
    acceptance: '能跑通',
    status,
    ...extra,
  }
}

function roleOf(id: string, name: string): Role {
  return { id, name, duty: '', skillIds: [], builtin: true, updatedAt: 1_760_000_000_000 }
}

const ROLES: Role[] = [roleOf('dev', '开发'), roleOf('qa', '测试')]

const SETTINGS: AutoTeamSettings = {
  concurrencyLimit: 3,
  memoryBudget: 4000,
  stallMs: 90_000,
  maxAttempts: 3,
  gateTimeoutMs: 300_000,
}

/* ───────────────────── ① hook 字面量（AC-19 根 hook 前缀） ───────────────────── */

test('hook：五个描述层输出都带 data-auto-team-* 唯一前缀（旧 data-dsh-* 前缀 0 命中）', () => {
  const views = [
    optionView({ enabled: true, busy: false, done: 1, total: 3 }),
    headerButtonView({ enabled: true, done: 1, total: 3 }),
    pauseButtonView({ paused: false, busy: false }),
    taskRowView(taskOf('t1', 'running'), ROLES),
  ]
  assert.deepEqual(
    views.map((view) => view.hook),
    [
      'data-auto-team-option',
      'data-auto-team-header-button',
      'data-auto-team-pause',
      'data-auto-team-task',
    ],
  )
  for (const view of views) {
    assert.match(view.hook, /^data-auto-team-/, '根 hook 前缀必须统一为 data-auto-team-')
    assert.doesNotMatch(view.hook, /data-dsh-/, '旧的 dsh 前缀 hook 已废弃（本轮统一改名）')
  }
})

/** 可供断言的固定状态集（r10 的可见文本恒为「自动团队」，状态语义全在 aria/tone）。 */
const OPTION_STATES = [
  { name: '未启用', input: { enabled: false, busy: false, done: 0, total: 0 } },
  { name: '计划就绪', input: { enabled: true, busy: false, planStatus: 'draft' as const, done: 0, total: 3 } },
  { name: '完成', input: { enabled: true, busy: false, planStatus: 'dispatching' as const, done: 3, total: 3 } },
  { name: '已暂停', input: { enabled: true, busy: false, planStatus: 'paused' as const, done: 1, total: 3 } },
  { name: '写盘在飞', input: { enabled: true, busy: true, planStatus: 'draft' as const, done: 0, total: 3 } },
] as const

/* ───────────────────── ② 输入框内胶囊（AC-3 / AC-6） ───────────────────── */

test('胶囊：可见文本逐字「自动团队」，状态只进 aria 与 state（AC-3）', () => {
  const off = optionView({ enabled: false, busy: false, done: 0, total: 0 })
  assert.equal(off.label, '自动团队', 'r10 起可见文本恒为「自动团队」，不再把状态拼进文案')
  assert.equal(off.state, 'off')
  assert.equal(off.pressed, false)
  assert.match(off.ariaLabel, /未启用/, '状态语义必须仍在无障碍名里，否则读屏用户看不到状态')

  const ready = optionView({ enabled: true, busy: false, planStatus: 'draft', done: 0, total: 3 })
  assert.equal(ready.label, '自动团队')
  assert.equal(ready.state, 'on')
  assert.equal(ready.pressed, true)
  assert.equal(ready.ariaLabel, '自动团队，已启用，计划就绪 · 3 任务')
  assert.equal(ready.dotTone, 'neutral')
  assert.equal(ready.failure, undefined, '无失败时不许渲染失败说明')

  const done = optionView({ enabled: true, busy: false, planStatus: 'dispatching', done: 3, total: 3 })
  assert.equal(done.label, '自动团队')
  assert.match(done.ariaLabel, /完成 3\/3/)

  const paused = optionView({ enabled: true, busy: false, planStatus: 'paused', done: 1, total: 3 })
  assert.equal(paused.label, '自动团队')
  assert.equal(paused.state, 'paused', '暂停态要能被组件单独上色（琥珀），不能与 on 混为一谈')
  assert.equal(paused.pressed, true, '暂停仍然是「已启用」，开关不能被画成关闭')

  // 五态：可见文本必须**完全一致**（AC-3 的字面要求），差异只允许落在 state/aria 上
  const views = OPTION_STATES.map((entry) => optionView(entry.input))
  assert.deepEqual(new Set(views.map((view) => view.label)), new Set(['自动团队']))
  assert.equal(new Set(views.map((view) => view.state)).size, 4, 'off/on/paused/busy 四态必须可分')
  assert.equal(new Set(views.map((view) => view.ariaLabel)).size, 4, 'aria 名也要可区分（busy 只换态，不改 aria）')
})

test('胶囊：失败零红字——只有琥珀点 + 失败说明，可见文本一字不变（AC-6）', () => {
  const ok = optionView({ enabled: true, busy: false, planStatus: 'draft', done: 0, total: 2 })
  const failed = optionView({
    enabled: true,
    busy: false,
    planStatus: 'draft',
    done: 0,
    total: 2,
    failure: '宿主未装配派发器\n第二行细节不进摘要',
  })
  assert.equal(failed.label, ok.label, '失败时可见文本不许变（不许追加「失败」或错误码）')
  assert.equal(failed.pressed, ok.pressed)
  assert.equal(failed.dotTone, 'warn', '失败用琥珀（可恢复），不是红')
  assert.equal(failed.failure, '操作失败：宿主未装配派发器', '失败说明带逐字前缀「操作失败」，且只取首行')
  assert.match(failed.ariaLabel, /^操作失败：/, '失败时无障碍名整句改成失败说明')
  assert.equal(ok.dotTone, 'neutral')

  // 空串/空白不算失败：不许制造「操作失败：」这种半截文案
  for (const raw of ['', '   ', undefined]) {
    const view = optionView({ enabled: false, busy: false, done: 0, total: 0, failure: raw })
    assert.equal(view.failure, undefined)
    assert.equal(view.dotTone, 'neutral')
  }
})

test('胶囊：busy 期间可见文本/aria 逐字不变，只换 state（禁止乐观）', () => {
  const idle = optionView({ enabled: true, busy: false, planStatus: 'draft', done: 0, total: 2 })
  const busy = optionView({ enabled: true, busy: true, planStatus: 'draft', done: 0, total: 2 })
  assert.equal(busy.label, idle.label, 'busy 不得改文案（否则「点了没反应」看起来像已生效）')
  assert.equal(busy.ariaLabel, idle.ariaLabel)
  assert.equal(busy.pressed, idle.pressed)
  assert.equal(busy.state, 'busy')

  // 关闭态 busy 也一样
  const offBusy = optionView({ enabled: false, busy: true, done: 0, total: 0 })
  assert.equal(offBusy.label, '自动团队')
  assert.equal(offBusy.state, 'busy')
})

test('胶囊：缺字段/负数/NaN 一律兜底，不出现 NaN 或 undefined 文案', () => {
  const broken = optionView({
    enabled: true,
    busy: false,
    done: Number.NaN,
    total: -1,
  })
  assert.doesNotMatch(broken.label + broken.ariaLabel, /NaN|undefined|null/)
  assert.equal(broken.label, '自动团队')
  assert.match(broken.ariaLabel, /待开工/)

  const zero = optionView({ enabled: true, busy: false, planStatus: 'dispatching', done: 0, total: 0 })
  assert.equal(zero.label, '自动团队')
  assert.match(zero.ariaLabel, /派发中/)
})

/* ───────────────────── ③ 会话头按钮（AC-11） ───────────────────── */

test('头按钮：三分支 aria-label，opened 由真实页签态驱动（AC-11）', () => {
  // 未打开 → 动作是 open
  const closed = headerButtonView({ enabled: true, planStatus: 'dispatching', done: 2, total: 5, opened: false })
  assert.equal(closed.label, '自动团队')
  assert.equal(closed.badge, '2/5')
  assert.equal(closed.action, 'open')
  assert.equal(closed.opened, false)
  assert.match(closed.ariaLabel, /^打开自动团队面板/, '未打开时的无障碍名必须是「打开…」')

  // 已打开且宿主给了关闭入口 → close
  const open = headerButtonView({ enabled: true, opened: true, canClose: true, done: 0, total: 0 })
  assert.equal(open.action, 'close')
  assert.equal(open.opened, true)
  assert.match(open.ariaLabel, /^收起自动团队面板/)

  // 已打开但宿主没有关闭入口 → 说真话，且**不翻转** aria-pressed
  const stuck = headerButtonView({ enabled: true, opened: true, canClose: false, done: 0, total: 0 })
  assert.match(stuck.ariaLabel, /^收起失败：宿主未提供关闭入口/)
  assert.equal(stuck.opened, true, '关不掉时 aria-pressed 不许自己翻成 false（非乐观）')

  // 宿主没有页签服务 → 回退到窗口事件，opened 一律 false
  const fallback = headerButtonView({ enabled: false, opened: true, available: false, done: 0, total: 0 })
  assert.equal(fallback.fallback, true)
  assert.equal(fallback.action, 'open')
  assert.equal(fallback.opened, false)
  assert.match(fallback.ariaLabel, /已回退为窗口事件/)

  const empty = headerButtonView({ enabled: false, done: 0, total: 0 })
  assert.equal(empty.badge, '', '无计划时不渲染角标（空串，而不是 0/0）')
})

/* ───────────────────── ④ 暂停 / 继续按钮（AC-15） ───────────────────── */

test('暂停按钮：paused 两态往返，文案与 action 严格配对', () => {
  const run = pauseButtonView({ paused: false, busy: false })
  assert.equal(run.label, '暂停任务')
  assert.equal(run.action, 'pause')
  assert.equal(run.tone, 'muted')
  assert.equal(run.disabled, false)

  const stopped = pauseButtonView({ paused: true, busy: false })
  assert.equal(stopped.label, '继续任务')
  assert.equal(stopped.action, 'resumeTeam')
  assert.equal(stopped.tone, 'warn', '已暂停是琥珀（用户主动冻结），不是红')
  assert.equal(stopped.disabled, false)

  // 往返：再点一次回到原文案（状态机级断言，而不是「文案变过就算过」）
  const back = pauseButtonView({ paused: false, busy: false })
  assert.deepEqual(back, run)
  assert.notDeepEqual(stopped, run)
})

test('暂停按钮：busy 只置 disabled，文案/action/tone 逐字不变（AC-15 不得乐观改文案）', () => {
  for (const paused of [false, true]) {
    const idle = pauseButtonView({ paused, busy: false })
    const busy = pauseButtonView({ paused, busy: true })
    assert.equal(busy.label, idle.label)
    assert.equal(busy.action, idle.action)
    assert.equal(busy.tone, idle.tone)
    assert.equal(busy.disabled, true)
    assert.equal(idle.disabled, false)
  }
  // 失败回滚的可分辨性：把 paused 当成 busy 用时，文案会变 —— 断言这两者不可互换
  assert.notEqual(pauseButtonView({ paused: false, busy: true }).label, pauseButtonView({ paused: true, busy: false }).label)
})

/* ───────────────────── ⑤ 任务行四要素（AC-14） ───────────────────── */

test('任务行：标题 / 内容 / 状态 / 角色 / 门禁证据五项齐全', () => {
  const task = taskOf('t1', 'running', {
    title: '实现输入框胶囊',
    acceptance: 'hook 出现且旧开关行消失',
    roleId: 'qa',
    evidence: {
      taskId: 't1',
      command: 'pnpm test',
      exitCode: 0,
      tail: '',
      artifacts: [],
      at: 1_760_000_000_000,
    },
  })
  const row = taskRowView(task, ROLES)
  assert.equal(row.hook, 'data-auto-team-task')
  assert.equal(row.title, '实现输入框胶囊')
  assert.equal(row.content, 'hook 出现且旧开关行消失')
  assert.equal(row.statusLabel, '运行中')
  assert.equal(row.statusTone, 'ok')
  assert.equal(row.roleLabel, '测试', '角色 chip 要显示角色名，不是 roleId')
  assert.equal(row.evidence, '退出码 0')
})

/** 13 态全集（r11 从 10 扩到 13；数组长度本身就是 AC-28 的形状判据）。 */
const ALL_TASK_STATUSES: TaskStatus[] = [
  'pending',
  'ready',
  'blocked',
  'waiting',
  'rework',
  'running',
  'paused',
  'gate',
  'done',
  'cancelled',
  'skipped',
  'failed',
  'interrupted',
]

test('任务行：状态标签唯一来自 progressOf（13 态全覆盖，组件不得自写映射）', () => {
  assert.equal(ALL_TASK_STATUSES.length, 13, 'TaskStatus 必须是 13 值（AC-28）')
  for (const status of ALL_TASK_STATUSES) {
    const row = taskRowView(taskOf('t', status), ROLES)
    const progress = progressOf(taskOf('t', status))
    assert.equal(row.statusLabel, progress.label, `${status}：任务行标签必须与 progressOf 一致`)
    assert.equal(row.statusTone, progress.tone)
    assert.notEqual(row.statusLabel, status, `${status} 不得回显英文原文`)
    assert.equal(row.statusLabel, TASK_STATUS_LABELS[status], `${status}：徽标文案必须读共享标签表`)
  }

  const badges = ALL_TASK_STATUSES.map((status) => statusBadge(status))
  assert.equal(new Set(badges.map((badge) => badge.text)).size, 13, '13 个中文标签必须互不重复')
  assert.equal(statusBadge('waiting').tone, 'warn', '等待是琥珀（被挡住，不是失败）')
  assert.equal(statusBadge('cancelled').tone, 'neutral', '取消是中性，不能标红')
  assert.equal(statusBadge('skipped').tone, 'neutral', '跳过是中性，不能标红')
  assert.equal(statusBadge('failed').tone, 'danger')
  assert.equal(statusBadge('interrupted').tone, 'danger')
})

/* ───────────────── ⑤b 三动作 disabled 矩阵（AC-27，13 × 3 = 39 格） ───────────────── */

const ACTION_TO_ALLOW_KEY = {
  cancel: 'cancel',
  skip: 'skip',
  'edit-acceptance': 'acceptance',
} as const

test('三动作：39 格 disabled 与 TASK_ACTION_ALLOW 逐格一致，禁用必须带原因（AC-27）', () => {
  let cells = 0
  for (const status of ALL_TASK_STATUSES) {
    const actions = taskActionsOf(taskOf('t2', status))
    assert.deepEqual(
      actions.map((action) => action.action),
      ['cancel', 'skip', 'edit-acceptance'],
      `${status}：按钮顺序必须是 取消 → 跳过 → 验收`,
    )
    assert.deepEqual(
      actions.map((action) => action.label),
      ['取消', '跳过', '验收'],
      `${status}：按钮文案逐字`,
    )
    for (const action of actions) {
      cells += 1
      const allowed = TASK_ACTION_ALLOW[status][ACTION_TO_ALLOW_KEY[action.action]]
      assert.equal(action.disabled, !allowed, `${status}/${action.action}：disabled 必须与允许表一致`)
      assert.match(action.ariaLabel, /t2/, `${status}/${action.action}：可访问名必须带任务 id`)
      if (allowed) {
        assert.equal(action.reason, undefined, `${status}/${action.action}：允许时不应有禁用原因`)
      } else {
        assert.equal(action.reason, taskActionDisabledReason(action.action, status), '禁用原因必须读共享表')
        assert.notEqual((action.reason ?? '').trim(), '', `${status}/${action.action}：disabled 不得空原因`)
      }
    }
  }
  assert.equal(cells, 39, 'AC-27 判据：13 态 × 3 动作 = 39 格')
})

/* ───────────────── ⑤c 等待原因：逐字取快照（AC-20，零拼装） ───────────────── */

test('等待条：waitReason 逐字返回快照原文，不 trim 不拼接（AC-20）', () => {
  const raw = '等待 t2 释放 src/host/bridge.ts'
  const waiting = taskOf('t3', 'waiting', { waitReason: raw, waitingOn: ['t2'] })
  assert.equal(waitReasonOf(waiting), raw)
  assert.equal(taskRowView(waiting, ROLES).waitReason, raw)
  assert.equal(taskRowView(waiting, ROLES).statusLabel, TASK_STATUS_LABELS.waiting)

  // 首尾空白也必须原样保留：客户端一旦 trim，宿主的逐字断言就会在无害重构后失效
  const spaced = '  等待 t2 释放 src/host/bridge.ts  '
  assert.equal(waitReasonOf(taskOf('t4', 'waiting', { waitReason: spaced })), spaced)

  assert.equal(waitReasonOf(taskOf('t5', 'pending')), '')
  // 非 waiting 态即使残留字段也不该渲染（组件侧的渲染判据在 client-contract 里断言）
  assert.equal(waitReasonOf(taskOf('t6', 'running', { waitReason: '残留' })), '残留')
})

/* ───────────────── ⑤d 写域占用行（AC-20，reason 原文 + 成员兜底） ───────────────── */

test('写域占用：行视图 = 路径 + 持锁者 + 等待者，reason 原文，空数组 0 行', () => {
  const lock: ScopeLockView = {
    path: 'src/host/bridge.ts',
    holderTaskId: 't2',
    holderMember: '开发',
    waiters: [
      { taskId: 't3', member: '测试', reason: '等待 t2 释放 src/host/bridge.ts' },
      { taskId: 't4', reason: '等待 t2 释放 src/host/bridge.ts' },
    ],
  }
  const rows = scopeLockRowsOf({ scopeLocks: [lock], deviations: [] } as unknown as Parameters<typeof scopeLockRowsOf>[0])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.path, 'src/host/bridge.ts')
  assert.equal(rows[0]?.holderLabel, 't2 · 开发')
  assert.equal(rows[0]?.waiters.length, 2)
  assert.equal(rows[0]?.waiters[0]?.label, 't3 · 测试（等待 t2 释放 src/host/bridge.ts）')
  assert.equal(rows[0]?.waiters[0]?.reason, '等待 t2 释放 src/host/bridge.ts', '原因必须原文透传')
  assert.equal(rows[0]?.waiters[1]?.label, 't4 · 未派成员（等待 t2 释放 src/host/bridge.ts）')

  assert.deepEqual(scopeLockRowsOf(undefined), [], '无快照 → 0 行（组件据此不渲染整块）')
  assert.deepEqual(scopeLockRowsOf({ scopeLocks: [], deviations: [] } as unknown as Parameters<typeof scopeLockRowsOf>[0]), [])

  const noHolder = scopeLockRowsOf({
    scopeLocks: [{ path: 'a.ts', holderTaskId: 't9', waiters: [] }],
    deviations: [],
  } as unknown as Parameters<typeof scopeLockRowsOf>[0])
  assert.equal(noHolder[0]?.holderLabel, 't9 · 未派成员')
  assert.equal(scopeLockRowView(lock).holderLabel, scopeLockRowOf(lock).holderLabel, 'ui 层必须委托 viewmodel')
})

/* ───────────────── ⑤e 执行痕迹行（AC-24，时间 / 路径 / ×N / 原因） ───────────────── */

test('执行痕迹：时间格式化、多路径「、」、×N 只在 count>1 时给，原因原文', () => {
  const at = new Date(2026, 10, 2, 10, 41, 7).getTime()
  const merged: DeviationView = {
    at,
    sessionId: 's1',
    toolName: 'write',
    paths: ['src/host/bridge.ts', 'src/client/ui.ts'],
    reason: '补一处类型守卫后立刻派成员',
    count: 4,
  }
  const single: DeviationView = {
    at,
    sessionId: 's1',
    toolName: 'edit',
    paths: ['src/client/ui.ts'],
    reason: '修正文案',
    count: 1,
  }
  const rows = deviationRowsOf({ scopeLocks: [], deviations: [merged, single] } as unknown as Parameters<
    typeof deviationRowsOf
  >[0])
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.at, '10:41:07')
  assert.equal(rows[0]?.toolName, 'write')
  assert.equal(rows[0]?.paths, 'src/host/bridge.ts、src/client/ui.ts', '多路径用「、」连接')
  assert.equal(rows[0]?.countLabel, '×4')
  assert.equal(rows[0]?.reason, '补一处类型守卫后立刻派成员', '原因原文透传')
  assert.equal(rows[1]?.countLabel, '', 'count=1 不给 ×N')
  assert.equal(deviationWriteCountOf(rows), 5, '组标题 N 次 = Σcount，不是记录条数')

  assert.deepEqual(deviationRowsOf(undefined), [])
  assert.deepEqual(deviationRowsOf({ scopeLocks: [], deviations: [] } as unknown as Parameters<typeof deviationRowsOf>[0]), [])
  assert.equal(deviationWriteCountOf([]), 0)
  assert.equal(deviationRowView(merged).paths, deviationRowOf(merged).paths, 'ui 层必须委托 viewmodel')

  // 缺字段不许抛：非法 count 归 1，paths 非数组当空（宁少不崩）
  const broken = deviationRowOf({ at: 0, sessionId: '', toolName: '', paths: null, reason: '', count: Number.NaN } as unknown as DeviationView)
  assert.equal(broken.at, '—')
  assert.equal(broken.paths, '')
  assert.equal(broken.count, 1)
  assert.equal(broken.countLabel, '')
})

test('任务行：角色缺失显示「未分配」，证据缺失为空串（整块不渲染，不写「—」）', () => {
  const orphan = taskRowView(taskOf('t1', 'pending', { roleId: 'nobody' }), ROLES)
  assert.equal(orphan.roleLabel, '未分配')
  assert.equal(orphan.evidence, '', '无证据时给空串，让组件整块不渲染')
  assert.doesNotMatch(orphan.evidence, /—|--/, '不得用破折号占位')

  const noRole = taskRowView(taskOf('t2', 'pending', { roleId: '' }), [])
  assert.equal(noRole.roleLabel, '未分配')
})

test('任务行：门禁超时（exitCode=null）必须显式说「门禁超时」，不能显示成退出码 0', () => {
  const timedOut = taskRowView(
    taskOf('t1', 'gate', {
      evidence: {
        taskId: 't1',
        command: 'pnpm test',
        exitCode: null,
        tail: 'timeout',
        artifacts: [],
        at: 1_760_000_000_000,
      },
    }),
    ROLES,
  )
  assert.equal(timedOut.evidence, '门禁超时')
  assert.doesNotMatch(timedOut.evidence, /退出码/, '超时不是「命令返回非 0」，两种失败必须可区分')

  const failed = taskRowView(
    taskOf('t2', 'gate', {
      evidence: {
        taskId: 't2',
        command: 'pnpm test',
        exitCode: 1,
        tail: 'boom',
        artifacts: [],
        at: 1_760_000_000_000,
      },
    }),
    ROLES,
  )
  assert.equal(failed.evidence, '退出码 1')
})

/* ───────────────────── ⑥ 设置页 6 参数（AC-16） ───────────────────── */

test('设置页：6 行参数按 DESIGN §2.4 顺序，key 即 data-setting-key', () => {
  const rows = settingsKeysView(SETTINGS)
  assert.equal(rows.length, 6, 'AC-16 判据：参数区 6 项')
  assert.deepEqual(
    rows.map((row) => row.key),
    ['concurrencyLimit', 'memoryBudget', 'stallMs', 'maxAttempts', 'gateTimeoutMs', 'captainModel'],
  )
  assert.deepEqual(
    rows.map((row) => row.label),
    ['并发上限', '记忆注入预算', '停滞阈值(ms)', '返工上限', '门禁超时(ms)', '队长默认模型'],
  )
  assert.equal(new Set(rows.map((row) => row.label)).size, 6, '6 个标签必须互不重复')

  // 取值域文案必须与 host/config.ts 的 SETTINGS_LIMITS 一致（1–8 / 200–4000 / …）。
  // client 不能 import host（零直接 import 铁律），所以这里断言字面量；两处漂移由 T5 守卫脚本比对。
  const hintOf = (key: string) => rows.find((row) => row.key === key)?.hint ?? ''
  assert.equal(hintOf('concurrencyLimit'), '1–8')
  assert.equal(hintOf('memoryBudget'), '200–4000')
  assert.equal(hintOf('stallMs'), '1000–600000')
  assert.equal(hintOf('maxAttempts'), '1–10')
  assert.equal(hintOf('gateTimeoutMs'), '1000–600000')
  assert.match(hintOf('captainModel'), /会话默认/)

  // 初值逐项来自设置对象
  const valueOf = (key: string) => rows.find((row) => row.key === key)?.value ?? ''
  assert.equal(valueOf('concurrencyLimit'), '3')
  assert.equal(valueOf('memoryBudget'), '4000')
  assert.equal(valueOf('stallMs'), '90000')
  assert.equal(valueOf('maxAttempts'), '3')
  assert.equal(valueOf('gateTimeoutMs'), '300000')
  assert.equal(valueOf('captainModel'), '会话默认', '未配置队长模型时明确写「会话默认」，不写空')
})

test('设置页：队长模型按 provider/model #effort 逐字回显；非法数字给空串而不是 0', () => {
  const rows = settingsKeysView({
    ...SETTINGS,
    captainModel: { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' },
    concurrencyLimit: Number.NaN,
  })
  const captain = rows.find((row) => row.key === 'captainModel')
  assert.equal(captain?.value, 'deepseek/deepseek-v4 #high')

  const concurrency = rows.find((row) => row.key === 'concurrencyLimit')
  assert.equal(concurrency?.value, '', '缺失/非法值给空串：让用户看出「没设过」，不能静默变成 0')
  assert.doesNotMatch(concurrency?.value ?? '', /NaN/)
})

test('设置页：设置对象整体缺失也不崩（防御式默认值）', () => {
  const rows = settingsKeysView(undefined as unknown as AutoTeamSettings)
  assert.equal(rows.length, 6)
  assert.ok(rows.every((row) => row.label !== '' && row.hint !== ''))
})

/* ───────────────────── ⑨ 技能四来源（AC-20 / AC-23） ───────────────────── */

function skillOf(over: Partial<SkillInfo> & { source: SkillSource }): SkillInfo {
  return { id: 'sk-1', title: '技能甲', description: '一句说明', modified: false, ...over }
}

test('技能来源：四来源各有人话标签，未知来源不输出 undefined', () => {
  assert.equal(skillSourceLabel('builtin'), '内置')
  assert.equal(skillSourceLabel('imported'), '导入')
  assert.equal(skillSourceLabel('system'), '系统')
  assert.equal(skillSourceLabel('manual'), '手动')
  assert.equal(skillSourceLabel('whatever' as SkillSource), '未知')
})

test('技能行：内置只「恢复出厂」、用户三源只「删除」（AC-23 机械判据）', () => {
  const builtin = skillRowView(skillOf({ source: 'builtin', modified: true }), false)
  assert.equal(builtin.actions.restore, '恢复出厂')
  assert.equal(builtin.actions.delete, null, '内置技能不可删（删了下次 seed 又回来，用户会以为删除失效）')
  assert.equal(builtin.actions.edit, '编辑')
  assert.equal(builtin.modifiedLabel, '已修改', '内置技能被改过必须有可见徽标')
  assert.equal(builtin.sourceTone, 'neutral')
  assert.equal(builtin.checkboxLabel, '选择技能：技能甲（内置）')

  for (const source of ['imported', 'system', 'manual'] as const) {
    const row = skillRowView(skillOf({ source }), true)
    assert.equal(row.actions.delete, '删除', `${source} 必须可删`)
    assert.equal(row.actions.restore, null, `${source} 没有出厂版本可恢复`)
    assert.equal(row.checked, true)
    assert.equal(row.modifiedLabel, null, '用户自建技能的「已修改」没有意义（它本来就是用户的）')
  }

  // 三种用户来源的色调互不相同（内置 vs 导入 vs 系统 vs 手动，靠色调 + 文字双重区分）
  const tones = new Set(
    (['builtin', 'imported', 'system', 'manual'] as const).map(
      (source) => skillRowView(skillOf({ source }), false).sourceTone,
    ),
  )
  assert.equal(tones.size, 4)

  // 缺字段不许产出 undefined 文案
  const broken = skillRowView({} as SkillInfo, false)
  assert.equal(broken.title, '')
  assert.doesNotMatch(JSON.stringify(broken), /undefined/)
})

/* ───────────────────── ⑩ 模型选择器文案（AC-16） ───────────────────── */

test('模型选择器：空值写「跟随会话默认」，有值走 provider/model（带 #effort）', () => {
  assert.equal(modelPickerLabel(undefined), '跟随会话默认')
  assert.equal(modelPickerLabel({ provider: '', model: '' }), '跟随会话默认', '空串等价于没配，不许渲染空按钮')
  assert.equal(modelPickerLabel({ provider: 'dsh-primary', model: 'deepseek-v4' }), 'dsh-primary/deepseek-v4')
  assert.equal(
    modelPickerLabel({ provider: 'dsh-primary', model: 'deepseek-v4', reasoningEffort: 'high' }),
    'dsh-primary/deepseek-v4 #high',
  )
})

/* ───────────────────── ⑪ 恢复默认对话框（AC-22） ───────────────────── */

test('恢复默认：三个数字全部来自入参，不许写死', () => {
  const one = restoreConfirmView({ builtinRoles: 11, customRoles: 0, userSkills: 0, builtinSkills: 12 })
  assert.equal(one.confirmLabel, '恢复默认')
  assert.equal(one.title, '恢复默认角色与内置技能')
  assert.equal(one.lines.length, 4, '一句范围说明 + 角色/技能各一行 + 一句「你不受影响」')
  assert.match(one.lines[0]!, /11 个内置角色与 12 条内置技能/)
  assert.match(one.lines[3]!, /不会删除任何用户数据/)

  // 换成另一组数字：文案必须跟着变（可分辨性自检：写死就过不了这条）
  const two = restoreConfirmView({ builtinRoles: 3, customRoles: 2, userSkills: 5, builtinSkills: 4 })
  assert.match(two.lines[0]!, /3 个内置角色与 4 条内置技能/)
  assert.match(two.lines[3]!, /2 个自建角色、5 条/)
  assert.notDeepEqual(one.lines, two.lines)

  // 非法/缺失数字兜底成 0，不产生 NaN
  const broken = restoreConfirmView({} as never)
  assert.doesNotMatch(broken.lines.join(' '), /NaN|undefined/)
  assert.match(broken.lines[0]!, /0 个内置角色与 0 条内置技能/)
})


test('胶囊：计划 5 态在 aria 名与 state 上各不相同（可见文本恒为「自动团队」）', () => {
  const statuses: PlanStatus[] = ['draft', 'dispatching', 'paused', 'terminated', 'cancelled']
  const views = statuses.map((planStatus) => optionView({ enabled: true, busy: false, planStatus, done: 0, total: 2 }))
  assert.deepEqual(new Set(views.map((view) => view.label)), new Set(['自动团队']), 'AC-3：可见文本逐字一致')
  assert.equal(new Set(views.map((view) => view.ariaLabel)).size, 5, '5 种计划状态必须给出 5 种不同的无障碍名')
  for (const view of views) assert.doesNotMatch(view.ariaLabel, /undefined|NaN/)
})

/* ───────────── ⑧ 端到端：把真实主路径走到底（启用→派发→暂停→继续→完成） ───────────── */

/**
 * 描述层的主路径走查（7c）：单点断言只能证明「每个函数各算对」，证明不了「状态推进时
 * 界面跟着对」。这里用一串真实推进的输入把界面从「未启用」走到「完成 2/2」这个终态，
 * 并检查中途的暂停/继续往返 —— 尤其是「已完成的不要重跑」在进度上必须可见。
 */
test('端到端（描述层）：未启用 → 计划就绪 → 派发中 → 暂停 → 继续 → 完成 2/2', () => {
  type Step = {
    name: string
    input: { enabled: boolean; busy: boolean; planStatus?: PlanStatus; done: number; total: number }
    /** aria 名里必须出现的片段（可见文本恒为「自动团队」，状态语义全在这里）。 */
    aria: RegExp
    state: 'off' | 'on' | 'paused' | 'busy'
    pause: '暂停任务' | '继续任务'
  }

  const steps: Step[] = [
    {
      name: '未启用',
      input: { enabled: false, busy: false, done: 0, total: 0 },
      aria: /^自动团队，未启用$/,
      state: 'off',
      pause: '暂停任务',
    },
    {
      name: '启用后计划就绪',
      input: { enabled: true, busy: false, planStatus: 'draft', done: 0, total: 2 },
      aria: /已启用，计划就绪 · 2 任务/,
      state: 'on',
      pause: '暂停任务',
    },
    {
      name: '派发中（1/2 完成）',
      input: { enabled: true, busy: false, planStatus: 'dispatching', done: 1, total: 2 },
      aria: /派发中 · 1\/2/,
      state: 'on',
      pause: '暂停任务',
    },
    {
      name: '暂停',
      input: { enabled: true, busy: false, planStatus: 'paused', done: 1, total: 2 },
      aria: /已暂停/,
      state: 'paused',
      pause: '继续任务',
    },
    {
      name: '继续（进度不丢，仍是 1/2）',
      input: { enabled: true, busy: false, planStatus: 'dispatching', done: 1, total: 2 },
      aria: /派发中 · 1\/2/,
      state: 'on',
      pause: '暂停任务',
    },
    {
      name: '终态：全部完成',
      input: { enabled: true, busy: false, planStatus: 'dispatching', done: 2, total: 2 },
      aria: /完成 2\/2/,
      state: 'on',
      pause: '暂停任务',
    },
  ]

  for (const step of steps) {
    const option = optionView(step.input)
    const pause = pauseButtonView({ paused: step.input.planStatus === 'paused', busy: step.input.busy })
    assert.equal(option.label, '自动团队', `步骤「${step.name}」可见文本恒为「自动团队」`)
    assert.match(option.ariaLabel, step.aria, `步骤「${step.name}」无障碍名要能读出状态`)
    assert.equal(option.state, step.state, `步骤「${step.name}」视觉态`)
    assert.equal(pause.label, step.pause, `步骤「${step.name}」暂停按钮文案`)
    // 终态必须真的「完成」，不能被任何后续状态盖回去
    if (step.name === '终态：全部完成') {
      assert.match(option.ariaLabel, /完成 2\/2/)
      assert.equal(headerButtonView(step.input).badge, '2/2')
      assert.equal(headerButtonView(step.input).ariaLabel.includes('完成 2/2'), true)
    }
  }

  // 暂停往返的可分辨性：暂停那一步与「继续后」那一步必须在 state/aria 上不同
  const paused = steps.find((step) => step.name === '暂停')!
  const resumed = steps.find((step) => step.name === '继续（进度不丢，仍是 1/2）')!
  assert.notEqual(optionView(paused.input).state, optionView(resumed.input).state)
  assert.notEqual(optionView(paused.input).ariaLabel, optionView(resumed.input).ariaLabel)
  assert.equal(optionView(resumed.input).state, 'on')
  assert.equal(optionView(paused.input).state, 'paused')
  // 暂停前后完成数一致 —— 「已完成的不要重跑」在描述层可见
  assert.equal(paused.input.done, resumed.input.done)
})

/* ══════════════════════════════════════════════════════════════════════════
 * r13 的 8 个纯展示组件（`src/client/views/`）与样式单串
 *
 * 为什么是源码断言而不是渲染断言：本仓没有 react-dom，`node --test` 也不转 JSX，
 * 组件物理上跑不起来。能在这里守住的是三条**契约级事实**：
 *  1) 钩子清单（`data-tab` / `data-cell` / `data-flow-node` / `data-confirm-dialog` …）逐字存在，
 *     因为左栏、右栏、QA 探针都靠这些钩子认元素；
 *  2) 组件只做展示 —— token/用时的文本必须来自 viewmodel，组件内不许出现第二套格式化；
 *  3) 安全默认值 —— 确认弹窗的初始焦点在「取消」，Esc 取消，不用原生 <dialog>（无法降级）。
 * ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs'
import { AUTO_TEAM_CSS } from '../src/client/styles.ts'

const VIEWS_DIR = new URL('../src/client/views/', import.meta.url)

function viewSource(name: string): string {
  return readFileSync(new URL(`${name}.tsx`, VIEWS_DIR), 'utf8')
}

/** 去掉注释的源码：断言「实现了某钩子」时不能被注释里的同名文字骗过。 */
function viewCode(name: string): string {
  return viewSource(name)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

test('视图组件全部存在，命名导出与设计契约一致，且只依赖 react 与本地模块', () => {
  const expected: Record<string, string> = {
    RunHeader: 'RunHeader',
    RoleStrip: 'RoleStrip',
    TaskTable: 'TaskTable',
    ProgressRing: 'ProgressRing',
    RoleCard: 'RoleCard',
    TaskOverview: 'TaskOverview',
    FlowCanvas: 'FlowCanvas',
    MemoryList: 'MemoryList',
    ConfirmDialog: 'ConfirmDialog',
    DetailPane: 'DetailPane',
    EmptyState: 'EmptyState',
  }
  for (const [file, exportName] of Object.entries(expected)) {
    const code = viewCode(file)
    assert.match(code, new RegExp(`export function ${exportName}\\(`), `${file} 必须导出 ${exportName}`)
    assert.match(code, /import \* as React from 'react'/, `${file} 必须用 classic JSX（宿主只解析 react）`)
    assert.equal(/jsx-runtime|react-dom/.test(code), false, `${file} 不许依赖 jsx-runtime / react-dom`)
    // 展示组件不取数：没有 fetch，也没有宿主 import（host/client 零直接 import 铁律）
    assert.equal(/\bfetch\(/.test(code), false, `${file} 不许自己取数`)
    assert.equal(/from '\.\.\/\.\.\/host\//.test(code), false, `${file} 不许 import 宿主模块`)
  }
})

test('RunHeader：run 头钩子、暂停按钮、在途派发三态、降级行', () => {
  const code = viewCode('RunHeader')
  assert.match(code, /data-region="run-head"/)
  assert.match(code, /data-run-id/)
  assert.match(code, /data-plan-status/)
  assert.match(code, /data-auto-team-pause/)
  assert.match(code, /aria-pressed=/)
  assert.match(code, /data-inflight-dispatch=\{/)
  assert.match(code, /data-inflight-dot/)
  assert.match(code, /data-run-usage/)
  assert.match(code, /data-usage-source=\{/)
  assert.match(code, /data-run-window/)
  assert.match(code, /data-run-duration/)
  assert.match(code, /data-duration-state=\{/)
  assert.match(code, /data-run-downgrade/)
  // 文本全部来自 viewmodel（runHeadOf），组件内不拼 token/用时
  assert.match(code, /runHeadOf\(/)
  assert.equal(/toLocaleString|\\B\(\?=\(\\d\{3\}\)/.test(code), false, '组件内不许出现第二套千分位实现')
})

test('RoleStrip：角色 chip 带任务数与 token 来源标记', () => {
  const code = viewCode('RoleStrip')
  assert.match(code, /data-region="task-roles"/)
  assert.match(code, /data-role-chip/)
  assert.match(code, /data-role-id=/)
  assert.match(code, /data-role-name/)
  assert.match(code, /data-role-tasks/)
  assert.match(code, /data-role-token/)
  assert.match(code, /data-usage-source=/)
  assert.match(code, /roleChipsOf\(/)
})

test('TaskTable：两行式任务行、token/用时 data-cell、展开详情与门禁证据', () => {
  const code = viewCode('TaskTable')
  assert.match(code, /data-region="task-list"/)
  assert.match(code, /data-task-head/)
  assert.match(code, /data-head-cell="token"/)
  assert.match(code, /data-head-cell="duration"/)
  assert.match(code, /data-task-rows/)
  assert.match(code, /data-task-row/)
  assert.match(code, /data-task-line="title"/)
  assert.match(code, /data-task-line="meta"/)
  assert.match(code, /data-cell="token"/)
  assert.match(code, /data-cell="duration"/)
  assert.match(code, /data-usage-source=/)
  assert.match(code, /data-duration-state=/)
  assert.match(code, /aria-expanded=/)
  assert.match(code, /data-task-detail/)
  assert.match(code, /data-gate-evidence/)
  assert.match(code, /data-gate-tail/)
  // 排序/筛选/格式化都归 viewmodel：组件只消费 TaskRowView（AC-7 的单点）
  assert.match(code, /taskRowOf\(/)
  assert.equal(code.includes('toLocaleString'), false, 'token 千分位只能在 viewmodel.tokenTextOf')
})

test('FlowCanvas：可平移视口 + rAF 直写 transform，节点第一行是角色名', () => {
  const code = viewCode('FlowCanvas')
  assert.match(code, /data-region="task-flow"/)
  assert.match(code, /data-flow-canvas/)
  assert.match(code, /data-flow-viewport/)
  assert.match(code, /data-flow-edges/)
  assert.match(code, /data-flow-edge/)
  assert.match(code, /data-upstream-done=/)
  assert.match(code, /data-flow-node=/)
  assert.match(code, /data-flow-column=/)
  assert.match(code, /data-flow-row=/)
  assert.match(code, /data-flow-node-role/)
  assert.match(code, /data-flow-node-title/)
  assert.match(code, /data-flow-line="meta"/)
  assert.match(code, /data-flow-legend/)
  assert.match(code, /data-canvas-reset/)
  assert.match(code, /flowLayoutOf\(/)
  // 拖动只写 transform + rAF 合帧 + 4px 累计阈值（AC-22：60 帧不来 60 次重排）
  assert.match(code, /requestAnimationFrame\(/)
  assert.match(code, /style\.transform = /)
  assert.match(code, /FLOW_DRAG_THRESHOLD/)
  // 不引图形库（零运行时依赖）
  assert.equal(/from '(d3|mermaid|reactflow|cytoscape)/.test(code), false)
})

test('ProgressRing：64×64、r=28、两档字号，环内文字严格是 done/total', () => {
  const code = viewCode('ProgressRing')
  assert.match(code, /data-progress-ring/)
  assert.match(code, /data-done=\{String/)
  assert.match(code, /data-total=\{String/)
  assert.match(code, /data-ring-track/)
  assert.match(code, /data-ring-arc/)
  assert.match(code, /data-complete=/)
  assert.match(code, /data-progress-text/)
  assert.match(code, /data-text-tier=/)
  assert.match(code, /rotate\(-90 32 32\)/)
  assert.match(code, /PROGRESS_RING_RADIUS/)
  assert.match(code, /PROGRESS_RING_CIRCUMFERENCE/)
  assert.match(code, /strokeDashoffset=/)
  assert.match(code, /role="img"/)
  // 组件不做除法：dashOffset 由 taskOverviewOf 预计算（避免两处舍入不一致）
  assert.match(code, /props\.dashOffset/)
})

test('RoleCard / RoleGrid：2 列网格只渲染、六个派生量全来自 shared 的单点', () => {
  const code = viewCode('RoleCard')
  assert.match(code, /data-role-grid/)
  assert.match(code, /data-role-card/)
  assert.match(code, /data-role-id=/)
  assert.match(code, /data-role-name/)
  assert.match(code, /data-role-status/)
  assert.match(code, /data-tone=/)
  assert.match(code, /data-role-active-task/)
  assert.match(code, /data-role-usage/)
  assert.match(code, /data-usage-source=/)
  assert.match(code, /data-role-duration/)
  assert.match(code, /data-duration-state=/)
  // 状态文本只能来自 shared 的 ROLE_STATE_TEXT（宿主/客户端同源），不许在组件里另写一张表
  assert.match(code, /ROLE_STATE_TEXT/)
})

test('TaskOverview：环与两组由同一次 taskOverviewOf 派生（AC-11 同帧）', () => {
  const code = viewCode('TaskOverview')
  assert.match(code, /data-task-overview/)
  assert.match(code, /data-overview-ring/)
  assert.match(code, /data-overview-list/)
  assert.match(code, /taskOverviewOf\(/)
  assert.match(code, /ProgressRing/)
  assert.match(code, /grouped/)
})

test('MemoryList：条目钩子 = track/name，正文逐字，错误态不吞', () => {
  const code = viewCode('MemoryList')
  assert.match(code, /data-memory-list/)
  assert.match(code, /data-memory-row/)
  assert.match(code, /data-auto-team-memory-item=/)
  assert.match(code, /data-memory-title/)
  assert.match(code, /data-memory-token/)
  assert.match(code, /data-memory-body/)
  assert.match(code, /data-error/)
  assert.match(code, /data-memory-loading/)
  assert.match(code, /memoryRowOf\(/)
  // token 单元格刻意不用 data-cell（那是任务行/流转图的计数口径）
  assert.equal(code.includes('data-cell='), false)
})

test('ConfirmDialog：默认焦点在取消、Esc 取消、非原生 dialog、确认按钮是动词短语', () => {
  const code = viewCode('ConfirmDialog')
  assert.match(code, /data-confirm-overlay/)
  assert.match(code, /data-confirm-dialog/)
  assert.match(code, /role="dialog"/)
  assert.match(code, /aria-modal="true"/)
  assert.match(code, /aria-labelledby=/)
  assert.match(code, /aria-describedby=/)
  assert.match(code, /data-dialog-mode=/)
  assert.match(code, /data-dialog-title/)
  assert.match(code, /data-dialog-action="reject"/)
  assert.match(code, /data-dialog-action="confirm"/)
  assert.match(code, /data-dialog-waited/)
  // 安全默认值：初始焦点必须在 reject（按钮也先于 confirm 声明，Tab 顺序与视觉顺序一致）
  assert.match(code, /rejectRef\.current\?\.focus\(\)/)
  assert.equal(
    code.indexOf('data-dialog-action="reject"') < code.indexOf('data-dialog-action="confirm"'),
    true,
    '「取消」必须声明在确认按钮之前',
  )
  assert.match(code, /'Escape'/)
  // 原生 <dialog> 在宿主面板里无法降级（transform 祖先会让 fixed 失效），必须自绘
  assert.equal(/<dialog/.test(code), false, '不用原生 <dialog>')
  assert.match(code, /confirmDialogOf\(/)
})

test('DetailPane / EmptyState：详情面包屑与三段式空态', () => {
  const detail = viewCode('DetailPane')
  assert.match(detail, /data-region="detail-pane"/)
  assert.match(detail, /data-detail-bar/)
  assert.match(detail, /data-detail-back/)
  assert.match(detail, /data-detail-crumbs/)
  assert.match(detail, /data-crumb=/)

  const empty = viewCode('EmptyState')
  assert.match(empty, /data-empty-title/)
  assert.match(empty, /data-empty-hint/)
  assert.match(empty, /role="status"/)
})

test('样式：r13 新块只用宿主 token，关键尺寸来自设计稿', () => {
  const marker = AUTO_TEAM_CSS.indexOf('r13：三页面板')
  assert.ok(marker > 0, 'r13 样式块必须存在于 AUTO_TEAM_CSS 单串内')
  const block = AUTO_TEAM_CSS.slice(marker)
  // 1) 字号必须是 font 简写（`font-size: var(--dsw-font-*)` 是无效声明，AGENTS §4 铁律）
  assert.equal(/font-size:\s*var\(--dsw-font/.test(block), false, '不许写 font-size: var(--dsw-font-*)')
  // 2) 新块不写 16 进制色值（旧块的历史兜底不复制过来）
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(block), false, 'r13 新块不许出现 #hex 色值')
  // 3) 关键尺寸：任务行 56、表头 24、run 头 64、节点 180×76、画布 300、弹窗 402、
  //    项目列表列宽走 --lib-list-w 变量（AC-13 要能拖动，所以不能再写死 220px）
  for (const snippet of [
    'min-height: 56px',
    'height: 24px',
    'min-height: 64px',
    'width: 180px',
    'height: 76px',
    'height: 300px',
    'width: 402px',
    '--lib-list-w',
    'flex: 0 0 var(--lib-list-w',
    'grid-template-columns: minmax(0, 1fr) 76px 84px',
  ]) {
    assert.equal(block.includes(snippet), true, `r14 样式必须包含 \`${snippet}\``)
  }
  // 4) 折叠与动效兜底都在（主区宽度 ≠ 视口宽度，容器查询优先）
  assert.equal(block.includes('@container (max-width: 719px)'), true)
  assert.equal(block.includes('@media (prefers-reduced-motion: reduce)'), true)
  // 5) 右栏与左栏共用同一批规则（否则同一任务行两处会长得不一样）
  const shared = block.split('[data-auto-team-panel]').length - 1
  assert.equal(shared > 3, true, '样式必须同时覆盖左栏与右栏作用域')
})
