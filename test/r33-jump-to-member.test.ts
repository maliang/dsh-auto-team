/**
 * r33 QA 回归（t3）：**点击跳成员会话**。
 *
 * 为什么单独成文件：本文件锁的是 r33 的三条用户可见承诺，每条都要能用
 * 「改回错误实现 → 变红」自证（变异矩阵见
 * docs/teamflow/2026-11-13-r33-jump-to-member/QA-REPORT.md §3）：
 *
 *  ① 判定全分支：有成员可跳（含 taskId 绑定优先）；任务无成员 / 节点无角色 /
 *     retired 绑定已被宿主过滤 / 会话 id 非法或空 → 一律 `available=false` + 人话原因；
 *  ② 三处入口（角色卡 / 任务行 / 流程图节点）只调 `memberJumpOf`，不各写一套判断；
 *  ③ 渲染层：卡片 role=button + Enter/Space，任务行按钮与流程节点是原生 button，
 *     title/aria-label 都来自判定结果；没有成员时 title 含原因（禁止点了没反应）。
 *
 * 断言有效性：每条都对应一处可回退的实现点；「只跑绿了」的恒真断言不放在这里。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MemberView } from '../src/shared/types.ts'
import {
  MEMBER_JUMP_NO_MEMBER_REASON,
  MEMBER_JUMP_NO_MEMBER_ROLE_REASON,
  MEMBER_JUMP_NO_MEMBER_TEXT,
  MEMBER_JUMP_NO_ROLE_REASON,
  MEMBER_JUMP_NOT_READY_TEXT,
  MEMBER_JUMP_REJECTED_TEXT,
  MEMBER_JUMP_SERVICE_MISSING_TEXT,
  memberForRole,
  memberJumpNoticeOf,
  memberJumpOf,
  roleJumpLabelOf,
  taskJumpLabelOf,
} from '../src/client/viewmodel.ts'
import {
  createMemberSessionOpener,
  registerMemberSession,
  requestMemberSession,
  resetMemberSessionOpener,
} from '../src/client/session.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 去掉注释再断言源码钩子（注释里出现关键词不算实现）。 */
function codeOf(rel: string): string {
  const source = readFileSync(join(ROOT, rel), 'utf8')
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const AT = 1_700_000_000_000

function memberOf(overrides: Partial<MemberView> = {}): MemberView {
  return {
    memberId: 'm1',
    name: '开发-1',
    roleId: 'dev',
    taskId: 't1',
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

/* ───────────────────────── ① memberJumpOf 全分支 ───────────────────────── */

test('r33 ① 角色有成员：可跳、带 memberId，title/label 由同一判定给出', () => {
  const member = memberOf({ memberId: 'm-dev', name: '开发-1', roleId: 'dev', taskId: 't1' })
  const jump = memberJumpOf(
    { kind: 'role', roleId: 'dev', taskId: 't1' },
    [member],
    { label: roleJumpLabelOf('开发') },
  )
  assert.equal(jump.available, true)
  assert.equal(jump.memberId, 'm-dev', 'memberId 必须与宿主会话 id 同源，直接交给 uiWorkspace')
  assert.equal(jump.member?.memberId, 'm-dev', '成员态 chip 复用同一次查找结果，不再二次检索')
  assert.equal(jump.title, '打开子智能体会话：开发-1')
  assert.equal(jump.label, '角色：开发，打开子智能体会话：开发-1', 'base.label 必须与跳转结果合并，不能覆盖')
  assert.match(jump.actionText, /开发-1/)
})

test('r33 ① 任务：明确绑定 taskId 的成员优先于同角色 running 成员', () => {
  const running = memberOf({ memberId: 'm-running', taskId: 't2', lastEventAt: AT + 500 })
  const bound = memberOf({ memberId: 'm-bound', taskId: 't1', status: 'idle', lastEventAt: AT })
  const jump = memberJumpOf(
    { kind: 'task', roleId: 'dev', taskId: 't1' },
    [running, bound],
    { label: taskJumpLabelOf('t1') },
  )
  assert.equal(jump.available, true)
  assert.equal(jump.memberId, 'm-bound', 'taskId 绑定优先：不能按「最近活跃」跳到别的任务的成员')
  // 没绑定关系的任务才回退到 running / 最近活跃。
  const fallback = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't9' }, [running, bound])
  assert.equal(fallback.memberId, 'm-running')
})

test('r33 ① 任务无成员：available=false + 人话原因，title/label 都含原因', () => {
  for (const members of [[], undefined, null]) {
    const jump = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, members, {
      label: taskJumpLabelOf('t1'),
    })
    assert.equal(jump.available, false, '没有成员绝不能伪装成可跳')
    assert.equal(jump.memberId, undefined, '不可跳时不得下发 memberId')
    assert.equal(jump.reason, MEMBER_JUMP_NO_MEMBER_REASON)
    assert.equal(jump.actionText, MEMBER_JUMP_NO_MEMBER_TEXT)
    assert.match(jump.title, new RegExp(MEMBER_JUMP_NO_MEMBER_REASON), '悬停必须说明为什么点不动')
    assert.match(jump.label, new RegExp(MEMBER_JUMP_NO_MEMBER_REASON))
  }
})

test('r33 ① 角色无成员 / 节点没有记录角色：分别给出对应原因，绝不静默', () => {
  const role = memberJumpOf({ kind: 'role', roleId: 'qa' }, [])
  assert.equal(role.available, false)
  assert.equal(role.reason, MEMBER_JUMP_NO_MEMBER_ROLE_REASON)

  const node = memberJumpOf({ kind: 'node', taskId: 't1' }, [memberOf()], { title: '任务 t1' })
  assert.equal(node.available, false)
  assert.equal(node.reason, MEMBER_JUMP_NO_ROLE_REASON)
  assert.match(node.title, new RegExp(`${MEMBER_JUMP_NO_ROLE_REASON}`), '节点原有 title 必须与原因合并')
  assert.match(node.title, /任务 t1/)
})

test('r33 ① 成员已 retired：宿主已把它从 members 过滤掉 → 不可跳且给同一句原因', () => {
  // 宿主投影（src/host/bridge.ts:1212-1217）只保留「已确认停止」的 retired 成员；
  // 完全回收的绑定不会出现在快照 members 里，客户端拿到的就是「没有这个成员」。
  // 注意：同角色还有 running 成员时 memberForRole 会回退到它（r17 起的既有语义，
  // 见 QA-REPORT §2 可接受项），所以这里用「该角色一个成员都没有」构造已回收现场。
  const otherRole = memberOf({ memberId: 'm2', taskId: 't2', roleId: 'qa' })
  const jump = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, [otherRole])
  assert.equal(jump.available, false)
  assert.equal(jump.reason, MEMBER_JUMP_NO_MEMBER_REASON)
  assert.equal(jump.memberId, undefined, '已回收成员不得被客户端「复活」成跳转目标')
  assert.match(jump.title, new RegExp(MEMBER_JUMP_NO_MEMBER_REASON))
})

test('r33 ① 已停止（retired 但有 stoppedAt）的成员仍在列表里：可跳，失败由宿主抛错兜底', () => {
  // bridge.ts 的 membersOf 对 retired + stoppedAt 保留一行「已停止」位，会话仍在。
  const stopped = memberOf({ memberId: 'm-stopped', status: 'stopped', stoppedAt: AT, canResume: true })
  const jump = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, [stopped])
  assert.equal(jump.available, true, '会话仍可查看；宿主 retain 失败会走 rejected 的可见文案')
  assert.equal(jump.memberId, 'm-stopped')
})

test('r33 ① 节点有角色：与角色卡/任务行走同一套绑定优先规则', () => {
  const bound = memberOf({ memberId: 'm-qa', roleId: 'qa', taskId: 't3', status: 'idle' })
  const other = memberOf({ memberId: 'm-qa2', roleId: 'qa', taskId: 't4', status: 'running', lastEventAt: AT + 1 })
  const jump = memberJumpOf({ kind: 'node', roleId: 'qa', taskId: 't3' }, [bound, other])
  assert.equal(jump.available, true)
  assert.equal(jump.memberId, 'm-qa', '绑定该任务的成员优先，避免流程节点跳到相邻任务')
})

/* ───────────────────────── ② 会话打开：服务缺失 / 抛错 / 空 id ───────────────────────── */

test('r33 ② 服务缺失：回退 unavailable（不是静默 false），文案说明原因', () => {
  const opener = createMemberSessionOpener({})
  assert.equal(opener('m1'), 'unavailable')
  assert.equal(memberJumpNoticeOf('unavailable', memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, [])), MEMBER_JUMP_SERVICE_MISSING_TEXT)
  assert.match(MEMBER_JUMP_SERVICE_MISSING_TEXT, /宿主未提供会话导航服务/)
})

test('r33 ② 注入未就绪 / 注入抛错 / 面缺 openSession：一律 unavailable', () => {
  // inject 存在但回调永远不来（服务未激活）。
  const never = createMemberSessionOpener({ inject: () => undefined })
  assert.equal(never('m1'), 'unavailable')

  // inject 本身抛错：不能把 apply 弄崩，调用方仍按 unavailable 提示。
  const warn = console.warn
  console.warn = () => {}
  try {
    const boom = createMemberSessionOpener({
      inject: () => {
        throw new Error('inject failed')
      },
    })
    assert.equal(boom('m1'), 'unavailable')
  } finally {
    console.warn = warn
  }

  // 服务面没有 openSession（旧宿主/形状漂移）。
  const noMethod = createMemberSessionOpener({
    inject: (_deps, cb) => {
      cb({})
      return undefined
    },
  })
  assert.equal(noMethod('m1'), 'unavailable')
})

test('r33 ② 会话 id 非法/空：requestMemberSession → no-member，opener → unavailable', () => {
  const opener = createMemberSessionOpener({
    inject: (_deps, cb) => {
      cb({ uiWorkspace: { openSession: () => undefined } })
      return undefined
    },
  })
  for (const bad of ['', '   ']) {
    assert.equal(opener(bad), 'unavailable', `非法会话 id ${JSON.stringify(bad)} 不得交给宿主`)
  }
  // 未注册时返回 null（单测/非浏览器宿主），注册后空 id 才是 no-member —— 两者不能混。
  assert.equal(requestMemberSession(undefined), null, '未注册优先级最高：调用方据此显示「未就绪」')
  registerMemberSession({
    inject: (_deps, cb) => {
      cb({ uiWorkspace: { openSession: () => undefined } })
      return undefined
    },
  })
  try {
    assert.equal(requestMemberSession(undefined), 'no-member')
    assert.equal(requestMemberSession(''), 'no-member')
    assert.equal(requestMemberSession('   '), 'no-member')
  } finally {
    resetMemberSessionOpener()
  }
  assert.equal(memberJumpNoticeOf('no-member', memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, [])), MEMBER_JUMP_NO_MEMBER_REASON)
})

test('r33 ② 宿主拒绝（openSession 抛错）→ rejected，且提示可复试', () => {
  const opener = createMemberSessionOpener({
    inject: (_deps, cb) => {
      cb({
        uiWorkspace: {
          openSession: () => {
            throw new Error('retain failed')
          },
        },
      })
      return undefined
    },
  })
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(opener('m1'), 'rejected')
  } finally {
    console.warn = warn
  }
  const jump = memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, [memberOf()])
  assert.equal(memberJumpNoticeOf('rejected', jump), MEMBER_JUMP_REJECTED_TEXT)
  assert.match(MEMBER_JUMP_REJECTED_TEXT, /请再点一次/)
})

test('r33 ② 注册/调用/复位：opened 只把 memberId 原样交给宿主', () => {
  const seen: string[] = []
  registerMemberSession({
    inject: (_deps, cb) => {
      cb({
        uiWorkspace: {
          openSession: (id: string) => {
            seen.push(id)
          },
        },
      })
      return undefined
    },
  })
  assert.equal(requestMemberSession('m-jump'), 'opened')
  assert.deepEqual(seen, ['m-jump'], '成员 id 与会话 id 同源，不得二次拼接/改写')
  assert.equal(memberJumpNoticeOf('opened', memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, [memberOf()])), undefined, '成功不渲染空提示行')

  resetMemberSessionOpener()
  assert.equal(requestMemberSession('m-jump'), null, '未注册（非浏览器宿主）与「失败」必须可区分')
  assert.equal(memberJumpNoticeOf(null, memberJumpOf({ kind: 'task', roleId: 'dev', taskId: 't1' }, [])), MEMBER_JUMP_NOT_READY_TEXT)
})

/* ───────────────────────── ③ 三入口复用同一判定（源码契约） ───────────────────────── */

test('r33 ③ 三个入口都只调 memberJumpOf，不各自 find/filter 成员', () => {
  const entries: Array<[string, string]> = [
    ['src/client/views/RoleCard.tsx', 'role'],
    ['src/client/views/TaskTable.tsx', 'task'],
    ['src/client/views/FlowCanvas.tsx', 'node'],
  ]
  for (const [file, kind] of entries) {
    const source = codeOf(file)
    assert.match(source, /memberJumpOf\(/, `${file} 必须调用唯一判定 memberJumpOf`)
    assert.match(source, new RegExp(`kind: '${kind}'`), `${file} 必须把自家数据装成 ${kind} 形状`)
    assert.match(source, /memberJumpOf\([\s\S]{0,220}?members,/, `${file} 必须把成员列表交给同一判定（不能自己查）`)
    assert.equal(source.includes('memberForRole('), false, `${file} 不得绕过 memberJumpOf 直接找成员`)
    assert.equal(/members\?\.(find|filter)|members\.(find|filter)/.test(source), false, `${file} 不得自带成员筛选`)
    assert.equal(/MEMBER_JUMP_[A-Z_]+_REASON\s*=/.test(source), false, `${file} 不得复制原因文案常量`)
    assert.equal(source.includes('status === \'running\''), false, `${file} 不得自带「谁能跳」的状态判断`)
  }
})

test('r33 ③ 落地动作只在任务页：requestMemberSession + 统一结局翻译', () => {
  const source = codeOf('src/client/tabs/TasksTab.tsx')
  assert.match(source, /if \(!jump\.available \|\| jump\.memberId === undefined\)/, '不可跳分支必须先于调用服务')
  assert.match(source, /memberJumpNoticeOf\('no-member', jump\)/, '不可跳也要留一行原因（禁止静默）')
  assert.match(source, /requestMemberSession\(jump\.memberId\)/, '唯一落地动作：调用会话服务')
  assert.match(source, /memberJumpNoticeOf\(requestMemberSession\(jump\.memberId\), jump\)/, '结局必须经同一处翻译')
  assert.equal(source.includes('memberForRole('), false, '任务页只消费判定，不得再查一次成员')
  assert.equal(source.includes('openSession('), false, '组件不得直接摸宿主服务（注册/调用集中在 session.ts）')
})

test('r33 ③ 历史 run 不提供跳转（onJump 只在当前 run 传入）', () => {
  const source = codeOf('src/client/tabs/TasksTab.tsx')
  assert.match(source, /historicalRunId === null \? jumpToMember : undefined/)
  assert.match(source, /historicalRunId === null && snapshot !== undefined \? snapshot\.members : \[\]/)
  assert.equal(/snapshot\.members\?\.filter/.test(source), false, '不得按状态二次过滤成员（已停止位要保留）')
})

/* ───────────────────────── ③ 渲染层：语义 / 键盘 / 原因 ───────────────────────── */

test('r33 ③ 角色卡：可点时 role=button + tabIndex + Enter/Space，label/title 来自判定', () => {
  const source = codeOf('src/client/views/RoleCard.tsx')
  for (const hook of [
    "role={onJump === undefined ? undefined : 'button'}",
    'tabIndex={onJump === undefined ? undefined : 0}',
    'aria-label={onJump === undefined ? undefined : jump.label}',
    'title={onJump === undefined ? undefined : jump.title}',
    'onClick={onJump === undefined ? undefined : () => onJump(jump)}',
    'onKeyDown=',
    "if (event.key !== 'Enter' && event.key !== ' ') return",
    'event.preventDefault()',
    'data-member-jump=',
    'data-member-id={jump.memberId}',
  ]) {
    assert.ok(source.includes(hook), `RoleCard 缺少可达性/判定钩子：${hook}`)
  }
  assert.equal(source.includes('stopPropagation'), false, '卡内没有嵌套可交互元素，不得无理由吞事件')
})

test('r33 ③ 任务行：独立 button 入口、不吞展开，title/aria-label 来自判定', () => {
  const source = codeOf('src/client/views/TaskTable.tsx')
  const openMemberAt = source.indexOf('data-task-open-member')
  const toggleAt = source.indexOf('data-task-toggle')
  assert.ok(toggleAt >= 0, '原有展开按钮必须保留')
  assert.ok(openMemberAt > toggleAt, '「子智能体」入口必须与展开按钮并列，且不替换它')
  const buttonRegion = source.slice(source.lastIndexOf('<button', openMemberAt), source.indexOf('</button>', openMemberAt))
  assert.match(buttonRegion, /type="button"/, '入口必须是原生 button（天然 Enter/Space 可达）')
  assert.match(buttonRegion, /title=\{jump\.title\}/)
  assert.match(buttonRegion, /aria-label=\{jump\.label\}/)
  assert.match(buttonRegion, /data-member-jump=\{jump\.available \? 'available' : 'unavailable'\}/)
  assert.equal(source.includes('stopPropagation'), false, '兄弟节点不冒泡到展开按钮，不需要 stopPropagation')
  assert.match(source, /onClick=\{\(\) => onJump\(jump\)\}/)
})

test('r33 ③ 流程图节点：原生 button，可跳优先、不可跳给原因并保留选中回退', () => {
  const source = codeOf('src/client/views/FlowCanvas.tsx')
  assert.match(source, /data-flow-node=\{node\.id\}/)
  assert.match(source, /data-member-jump=\{jump\.available \? 'available' : 'unavailable'\}/)
  assert.match(source, /data-member-id=\{jump\.memberId\}/)
  assert.match(source, /title=\{jump\.title\}/)
  assert.match(source, /aria-label=\{jump\.label\}/)
  assert.match(source, /if \(jump\.available\) \{[\s\S]*?onJump\(jump\)[\s\S]*?return/, '可跳时必须真的调用落地动作')
  assert.match(source, /onJump\?\.\(jump\)/, '不可跳时也必须把原因交上去（禁止静默）')
  assert.match(source, /onSelectTask\(node\.id\)/, '原有选中任务回退必须保留')
  const nodeAt = source.indexOf('data-flow-node={node.id}')
  const nodeRegion = source.slice(source.lastIndexOf('<button', nodeAt), source.indexOf('</button>', nodeAt))
  assert.equal(nodeRegion.includes('stopPropagation'), false, '节点本身不吞事件；拖动抑制由画布 onClickCapture 统一处理')
  assert.match(source, /onClickCapture=\{onClickCapture\}/, '拖拽后的 click 抑制必须保留')
})
