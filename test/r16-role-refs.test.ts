/**
 * r16 T4 · 角色卡任务引用（refs/tN chip）与 80px 进度环的契约。
 *
 * 为什么值得写：本仓没有 react-dom，`node --test` 也不转 JSX，组件物理上渲染不出来；
 * 能锁死的是两件事 ——
 *   ① 纯派生函数的事实：chip 文本严格 `tN`、状态中文**只**进 title/aria、tone 收敛 5 档、
 *      顺序与数量来自 `taskRefs`（计划顺序，不排序不去重），`done` 统一叫「已通过」；
 *   ② 组件源码的结构契约：refs 行在 active 之后 / meta 之前、空数组整行不渲染、
 *      环的 80/viewBox80/圆心40/rotate 40 与默认 size 取常量（逐步改成 64/32 会立刻红）。
 *
 * 文案唯一来源是 `statusBadge().text`（13 态一张表）：PRD 里「t3 · 已完成」是口语示例，
 * 这里以共享表为准，避免为凑例句在组件里另造第二套状态词。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  PROGRESS_RING_RADIUS,
  PROGRESS_RING_SIZE,
  PROGRESS_RING_STROKE,
  PROGRESS_RING_VIEWBOX,
  buildTaskDetail,
  roleTaskRefViewOf,
  roleUsageOf,
  statusBadge,
} from '../src/client/viewmodel.ts'
import type { PlanTask, Role, RoleTaskRef, TaskDetailView, TaskStatus } from '../src/shared/types.ts'

const VIEWS_DIR = new URL('../src/client/views/', import.meta.url)

/** 去掉注释的源码：断言「实现了某钩子」时不能被注释里的同名文字骗过。 */
function viewCode(name: string): string {
  return readFileSync(new URL(`${name}.tsx`, VIEWS_DIR), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 13 态全集（与 `TaskStatus` 联合类型同步；漏一个就少测一个 tone/文案）。 */
const ALL_STATUSES: readonly TaskStatus[] = [
  'pending',
  'ready',
  'blocked',
  'waiting',
  'running',
  'rework',
  'failed',
  'interrupted',
  'gate',
  'paused',
  'done',
  'cancelled',
  'skipped',
]

/** DESIGN §2.2：彩点只允许这 5 个 tone（与 ROLE_STATE_TONE 同族）。 */
const TONES = new Set(['business', 'warn', 'danger', 'success', 'neutral'])

/* ────────────────────────── 夹具 ────────────────────────── */

function taskOf(id: string, roleId: string, status: TaskStatus, title = `任务${id}`): PlanTask {
  return {
    id,
    title,
    roleId,
    dependsOn: [],
    acceptance: '能跑通',
    status,
  }
}

function detailOf(task: PlanTask): TaskDetailView {
  return buildTaskDetail(task, { roleName: task.roleId, messageCount: 0 })
}

function roleOf(id: string, name: string): Role {
  return { id, name, duty: '', skillIds: [], builtin: false, updatedAt: 0 }
}

/* ────────────────────────── ① roleTaskRefViewOf ────────────────────────── */

test('roleTaskRefViewOf：13 态 text 严格 tN，状态中文只进 title/aria，tone 收敛 5 档', () => {
  for (const status of ALL_STATUSES) {
    const ref: RoleTaskRef = { id: 't7', status }
    const chip = roleTaskRefViewOf(ref)
    const badge = statusBadge(status)
    assert.equal(chip.id, 't7')
    assert.equal(chip.status, status)
    assert.equal(chip.text, 't7', `chip 文本必须严格等于任务编号（${status}）`)
    assert.equal(chip.text.includes('·'), false, 'chip 文本不得带状态分隔符')
    assert.equal(chip.title, `t7 · ${badge.text}`, `title 必须含「tN · 状态中文」（${status}）`)
    assert.equal(chip.label, chip.title, 'aria-label 与 title 逐字相等')
    assert.match(chip.title, /[\u4e00-\u9fff]/, `状态文案必须含中文（${status}）`)
    assert.equal(chip.tone, badge.tone, 'tone 只能来自 statusBadge')
    assert.equal(TONES.has(chip.tone), true, `tone 越界：${chip.tone}`)
  }
})

test('roleTaskRefViewOf：done 统一显示「已通过」（不另造「已完成」第二套词）', () => {
  assert.equal(roleTaskRefViewOf({ id: 't3', status: 'done' }).title, 't3 · 已通过')
  assert.equal(roleTaskRefViewOf({ id: 't3', status: 'running' }).title, 't3 · 运行中')
})

test('roleTaskRefViewOf：tN 编号原样透传（两位数 t10 不被截断/补零）', () => {
  assert.equal(roleTaskRefViewOf({ id: 't10', status: 'pending' }).text, 't10')
})

/* ────────────────────────── ② roleUsageOf.taskRefs ────────────────────────── */

test('roleUsageOf：taskRefs 按计划顺序、数量 = role.tasks、只含本角色任务', () => {
  const tasks = [
    detailOf(taskOf('t1', 'dev', 'done')),
    detailOf(taskOf('t2', 'qa', 'running')),
    detailOf(taskOf('t3', 'dev', 'gate')),
    detailOf(taskOf('t4', 'dev', 'pending')),
  ]
  const roles = [roleOf('dev', '开发'), roleOf('qa', '测试'), roleOf('pm', '产品')]
  const usage = roleUsageOf(tasks, roles)

  assert.deepEqual(
    usage.map((role) => role.roleId),
    ['dev', 'qa'],
    '零任务角色（pm）不出卡',
  )
  const dev = usage[0]
  assert.equal(dev.tasks, 3)
  assert.deepEqual(
    dev.taskRefs?.map((ref) => ref.id),
    ['t1', 't3', 't4'],
    '顺序 = 计划顺序（不排序：done 仍在最前）',
  )
  assert.deepEqual(
    dev.taskRefs?.map((ref) => ref.status),
    ['done', 'gate', 'pending'],
    '状态原样透传',
  )
  assert.equal(dev.taskRefs?.length, dev.tasks, 'refs 数量必须等于 role.tasks')
  assert.deepEqual(usage[1].taskRefs, [{ id: 't2', status: 'running' }], '不跨角色串任务')
})

test('roleUsageOf：空任务列表 → 无角色卡，也不伪造 refs', () => {
  const usage = roleUsageOf([], [roleOf('dev', '开发')])
  assert.deepEqual(usage, [], '没有任务就没有角色卡（不显示假 refs）')
})

test('roleUsageOf：分组键是 roleId（旧快照 roleName 为空也归到同一张卡），refs 仍可用', () => {
  const task = detailOf(taskOf('t1', 'dev', 'done'))
  const view = roleUsageOf([{ ...task, roleName: '' }], [])
  assert.equal(view.length, 1)
  assert.equal(view[0].roleId, 'dev', '分组只认 roleId，不依赖 roleName')
  assert.deepEqual(view[0].taskRefs, [{ id: 't1', status: 'done' }])
})

/* ────────────────────────── ③ RoleCard 源码结构 ────────────────────────── */

test('RoleCard：refs 行位于 active 之后 / meta 之前，空数组整行不渲染', () => {
  const code = viewCode('RoleCard')
  const active = code.indexOf('data-role-active-task')
  const refs = code.indexOf('data-role-task-refs')
  const meta = code.indexOf('data-role-line="meta"')
  assert.ok(active >= 0, '缺少 data-role-active-task')
  assert.ok(refs > active, 'refs 行必须在 active task 之后（DESIGN §2.2 固定顺序）')
  assert.ok(meta > refs, 'refs 行必须在 meta 之前')
  assert.match(code, /role\.taskRefs \?\? \[\]/, '旧快照缺 taskRefs 时必须空数组兜底')
  assert.match(code, /refs\.length > 0 \?/, 'refs 为空必须整行不渲染（不写「0 个任务」）')
  assert.match(code, /roleTaskRefViewOf/, 'chip 文案必须来自纯派生函数，组件不自己拼状态词')
})

test('RoleCard：chip 只有 tN 文本 + 6px 彩点，状态中文只放 title/aria', () => {
  const code = viewCode('RoleCard')
  for (const hook of [
    'data-role-task-ref',
    'data-task-id={chip.id}',
    'data-status={chip.status}',
    'data-tone={chip.tone}',
    'title={chip.title}',
    'aria-label={chip.label}',
    'data-task-ref-dot',
    'aria-hidden="true"',
    'data-task-ref-id',
  ]) {
    assert.ok(code.includes(hook), `缺少 chip 钩子：${hook}`)
  }
  assert.match(code, /data-task-ref-dot[^>]*\/>/, '彩点必须是空元素（textContent 不能混进状态文字）')
  assert.match(code, /data-task-ref-id>\{chip\.text\}</, 'chip 文本只渲染 chip.text（严格 tN）')
  const refsBlock = code.slice(code.indexOf('data-role-task-refs'), code.indexOf('data-role-line="meta"'))
  assert.equal(/[\u4e00-\u9fff]/.test(refsBlock), false, 'chip 内部不得写死中文状态词（只能来自 chip.title/label）')
})

/* ────────────────────────── ④ ProgressRing 源码结构 ────────────────────────── */

test('ProgressRing：80 / viewBox 80 / 圆心 40 / rotate(-90 40 40)，默认 size 取常量', () => {
  const code = viewCode('ProgressRing')
  // 旧值（64/32/r28）必须在源码里绝迹：出现即说明有人回退到 r14 的环
  assert.equal(/viewBox="0 0 64 64"/.test(code), false, '不得再用 64 视口')
  assert.equal(/rotate\(-90 32 32\)/.test(code), false, '不得再用 32 圆心')
  assert.match(code, /PROGRESS_RING_VIEWBOX/, 'viewBox 必须来自几何常量')
  assert.match(code, /const CENTER = PROGRESS_RING_VIEWBOX \/ 2/, '圆心必须由 viewBox 派生（40）')
  assert.match(code, /rotate\(-90 \$\{CENTER\} \$\{CENTER\}\)/, '弧的旋转中心必须跟随圆心')
  assert.match(code, /size = PROGRESS_RING_SIZE/, '默认 size 必须是 80 常量（不写死也不留 64）')
  assert.equal(/size = 64/.test(code), false, '不得保留 64 默认值')
  // 组件仍不做除法：dashOffset 由 taskOverviewOf 预算
  assert.match(code, /props\.dashOffset/)
  assert.match(code, /text\.length <= 5 \? 'short' : 'long'/, '两档字号判据不能漂移')
  assert.match(code, /data-text-tier=\{textTier\}/)
})

test('ProgressRing 几何常量：80 环、r34、stroke8（与 DESIGN §2.1 一致）', () => {
  assert.equal(PROGRESS_RING_SIZE, 80)
  assert.equal(PROGRESS_RING_VIEWBOX, 80)
  assert.equal(PROGRESS_RING_RADIUS, 34)
  assert.equal(PROGRESS_RING_STROKE, 8)
})

/* ────────────────────────── ⑤ TaskOverview 显式 size ────────────────────────── */

test('TaskOverview：显式传 size={PROGRESS_RING_SIZE}，不依赖组件默认值', () => {
  const code = viewCode('TaskOverview')
  assert.match(code, /size=\{PROGRESS_RING_SIZE\}/, 'DESIGN §2.1：总览必须显式传 80，防止默认值漂移')
  assert.match(code, /import \{[^}]*PROGRESS_RING_SIZE[^}]*\} from '\.\.\/viewmodel\.ts'/)
  assert.match(code, /dashOffset=\{overview\.dashOffset\}/, '环与分组必须共用 taskOverviewOf 的同一次结果')
})
