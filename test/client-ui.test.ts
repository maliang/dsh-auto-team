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
  headerButtonView,
  optionView,
  pauseButtonView,
  settingsKeysView,
  taskRowView,
} from '../src/client/ui.ts'
import { progressOf } from '../src/client/viewmodel.ts'
import type {
  AutoTeamSettings,
  PlanStatus,
  PlanTask,
  Role,
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

/* ───────────────────── ② 输入框内胶囊（AC-12） ───────────────────── */

test('胶囊：未启用 / 计划就绪 / 完成 / 已暂停 四种文案，且 aria 名带状态', () => {
  const off = optionView({ enabled: false, busy: false, done: 0, total: 0 })
  assert.equal(off.label, '自动团队 · 未启用')
  assert.equal(off.state, 'off')
  assert.equal(off.pressed, false)
  assert.match(off.ariaLabel, /未启用/)

  const ready = optionView({ enabled: true, busy: false, planStatus: 'draft', done: 0, total: 3 })
  assert.equal(ready.label, '自动团队 · 计划就绪 · 3 任务')
  assert.equal(ready.state, 'on')
  assert.equal(ready.pressed, true)
  assert.equal(ready.ariaLabel, '自动团队，已启用，计划就绪 · 3 任务')

  const done = optionView({ enabled: true, busy: false, planStatus: 'dispatching', done: 3, total: 3 })
  assert.equal(done.label, '自动团队 · 完成 3/3')

  const paused = optionView({ enabled: true, busy: false, planStatus: 'paused', done: 1, total: 3 })
  assert.equal(paused.label, '自动团队 · 已暂停')
  assert.equal(paused.state, 'paused', '暂停态要能被组件单独上色（琥珀），不能与 on 混为一谈')
  assert.equal(paused.pressed, true, '暂停仍然是「已启用」，开关不能被画成关闭')

  // 四态文案互不重复：否则用户看不出到底是关着、在跑还是暂停了
  assert.equal(new Set([off.label, ready.label, done.label, paused.label]).size, 4)
})

test('胶囊：busy 期间文案逐字不变，只换 state（禁止乐观改文案）', () => {
  const idle = optionView({ enabled: true, busy: false, planStatus: 'draft', done: 0, total: 2 })
  const busy = optionView({ enabled: true, busy: true, planStatus: 'draft', done: 0, total: 2 })
  assert.equal(busy.label, idle.label, 'busy 不得改文案（否则「点了没反应」看起来像已生效）')
  assert.equal(busy.ariaLabel, idle.ariaLabel)
  assert.equal(busy.pressed, idle.pressed)
  assert.equal(busy.state, 'busy')

  // 关闭态 busy 也一样
  const offBusy = optionView({ enabled: false, busy: true, done: 0, total: 0 })
  assert.equal(offBusy.label, '自动团队 · 未启用')
  assert.equal(offBusy.state, 'busy')
})

test('胶囊：缺字段/负数/NaN 一律兜底，不出现 NaN 或 undefined 文案', () => {
  const broken = optionView({
    enabled: true,
    busy: false,
    done: Number.NaN,
    total: -1,
  })
  assert.doesNotMatch(broken.label, /NaN|undefined|null/)
  assert.equal(broken.label, '自动团队 · 待开工')

  const zero = optionView({ enabled: true, busy: false, planStatus: 'dispatching', done: 0, total: 0 })
  assert.equal(zero.label, '自动团队 · 派发中')
})

/* ───────────────────── ③ 会话头按钮（AC-13） ───────────────────── */

test('头按钮：文案含「自动团队」，角标是 完成数/总数，无计划时角标为空', () => {
  const view = headerButtonView({ enabled: true, planStatus: 'dispatching', done: 2, total: 5 })
  assert.equal(view.label, '自动团队')
  assert.match(view.label, /自动团队/, 'AC-13 判据：文案必须含「自动团队」')
  assert.equal(view.badge, '2/5')
  assert.match(view.ariaLabel, /^自动团队，已启用，/, '窄视口只留图标时仍要能读出完整名字')

  const empty = headerButtonView({ enabled: false, done: 0, total: 0 })
  assert.equal(empty.badge, '', '无计划时不渲染角标（空串，而不是 0/0）')
  assert.equal(empty.label, '自动团队')
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

test('任务行：状态标签唯一来自 progressOf（10 态全覆盖，组件不得自写映射）', () => {
  const statuses: TaskStatus[] = [
    'pending',
    'ready',
    'blocked',
    'rework',
    'running',
    'paused',
    'gate',
    'done',
    'failed',
    'interrupted',
  ]
  for (const status of statuses) {
    const row = taskRowView(taskOf('t', status), ROLES)
    const progress = progressOf(taskOf('t', status))
    assert.equal(row.statusLabel, progress.label, `${status}：任务行标签必须与 progressOf 一致`)
    assert.equal(row.statusTone, progress.tone)
    assert.notEqual(row.statusLabel, status, `${status} 不得回显英文原文`)
  }
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

/* ───────────────────── ⑦ 计划状态与胶囊的联动（AC-14 页头） ───────────────────── */

test('胶囊：计划 5 态文案各不相同（页头 chip 与 pill 同源）', () => {
  const statuses: PlanStatus[] = ['draft', 'dispatching', 'paused', 'terminated', 'cancelled']
  const labels = statuses.map(
    (planStatus) => optionView({ enabled: true, busy: false, planStatus, done: 0, total: 2 }).label,
  )
  assert.equal(new Set(labels).size, 5, '5 种计划状态必须给出 5 种不同文案')
  for (const label of labels) assert.doesNotMatch(label, /undefined|NaN/)
})

/* ───────────── ⑧ 端到端：把真实主路径走到底（启用→派发→暂停→继续→完成） ───────────── */

/**
 * 描述层的主路径走查（7c）：单点断言只能证明「每个函数各算对」，证明不了「状态推进时
 * 界面跟着对」。这里用一串真实推进的输入把界面文案从「未启用」走到「完成 2/2」这个终态，
 * 并检查中途的暂停/继续往返 —— 尤其是「已完成的不要重跑」在文案上必须可见。
 */
test('端到端（描述层）：未启用 → 计划就绪 → 派发中 → 暂停 → 继续 → 完成 2/2', () => {
  type Step = {
    name: string
    input: { enabled: boolean; busy: boolean; planStatus?: PlanStatus; done: number; total: number }
    pill: string
    pause: '暂停任务' | '继续任务'
  }

  const steps: Step[] = [
    {
      name: '未启用',
      input: { enabled: false, busy: false, done: 0, total: 0 },
      pill: '自动团队 · 未启用',
      pause: '暂停任务',
    },
    {
      name: '启用后计划就绪',
      input: { enabled: true, busy: false, planStatus: 'draft', done: 0, total: 2 },
      pill: '自动团队 · 计划就绪 · 2 任务',
      pause: '暂停任务',
    },
    {
      name: '派发中（1/2 完成）',
      input: { enabled: true, busy: false, planStatus: 'dispatching', done: 1, total: 2 },
      pill: '自动团队 · 派发中 · 1/2',
      pause: '暂停任务',
    },
    {
      name: '暂停',
      input: { enabled: true, busy: false, planStatus: 'paused', done: 1, total: 2 },
      pill: '自动团队 · 已暂停',
      pause: '继续任务',
    },
    {
      name: '继续（进度不丢，仍是 1/2）',
      input: { enabled: true, busy: false, planStatus: 'dispatching', done: 1, total: 2 },
      pill: '自动团队 · 派发中 · 1/2',
      pause: '暂停任务',
    },
    {
      name: '终态：全部完成',
      input: { enabled: true, busy: false, planStatus: 'dispatching', done: 2, total: 2 },
      pill: '自动团队 · 完成 2/2',
      pause: '暂停任务',
    },
  ]

  for (const step of steps) {
    const pill = optionView(step.input)
    const pause = pauseButtonView({ paused: step.input.planStatus === 'paused', busy: step.input.busy })
    assert.equal(pill.label, step.pill, `步骤「${step.name}」胶囊文案`)
    assert.equal(pause.label, step.pause, `步骤「${step.name}」暂停按钮文案`)
    // 终态必须真的「完成」，不能被任何后续状态盖回去
    if (step.name === '终态：全部完成') {
      assert.match(pill.label, /完成 2\/2/)
      assert.equal(headerButtonView(step.input).badge, '2/2')
    }
  }

  // 暂停往返的可分辨性：暂停那一步与「继续后」那一步的文案必须不同，否则用户看不出状态
  const paused = steps.find((step) => step.name === '暂停')!
  const resumed = steps.find((step) => step.name === '继续（进度不丢，仍是 1/2）')!
  assert.notEqual(optionView(paused.input).label, optionView(resumed.input).label)
  assert.equal(optionView(resumed.input).state, 'on')
  assert.equal(optionView(paused.input).state, 'paused')
  // 暂停前后完成数一致 —— 「已完成的不要重跑」在描述层可见
  assert.equal(paused.input.done, resumed.input.done)
})
