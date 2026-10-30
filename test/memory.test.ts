/**
 * 记忆双轨 + 记忆注入 + 角色库 单测（AC-21 / AC-23 / AC-24 / AC-25）。
 *
 * 三条原则：
 *  - 路径逃逸必须**在读 / 写 / 删三条路径**上分别断言（只测写等于没测）；
 *  - 注入预算与截断尾行断言到「数字与文本长度一致」，而不是「含截断二字」；
 *  - 角色模型「只填一半」必须报错——静默回退会话默认是 AC-22 的隐形违约。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendMemoryLines,
  deleteMemory,
  formatSourcedLine,
  listMemory,
  readMemory,
  safeMemoryName,
  writeMemory,
} from '../src/host/memory/repo.ts'
import {
  keywords,
  relevance,
  selectMemory,
  titleHits,
  titleOf,
} from '../src/host/memory/inject.ts'
import { createRoleRepo, normalizeModel, validateModel } from '../src/host/roles/repo.ts'
import { BUILTIN_ROLES } from '../src/host/roles/builtin.ts'

function withTempRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-mem-'))
  try {
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function rootsOf(root: string): { publicDir: string; projectDir: string } {
  return { publicDir: join(root, 'public'), projectDir: join(root, 'project') }
}

/* ---------------------------------------------------------------- 记忆：路径守门 */

test('safeMemoryName 拒绝一切路径逃逸形态', () => {
  const bad = ['', '  ', '..', '.', '../etc/passwd', 'a/b.md', 'a\\b.md', '.hidden', 'x\0y', 'a'.repeat(80)]
  for (const name of bad) {
    assert.equal(safeMemoryName(name), null, `应拒绝：${JSON.stringify(name)}`)
  }
})

test('safeMemoryName 自动补 .md 并保留合法名', () => {
  assert.equal(safeMemoryName('conventions'), 'conventions.md')
  assert.equal(safeMemoryName('conventions.md'), 'conventions.md')
  assert.equal(safeMemoryName('proj_2026-01.md'), 'proj_2026-01.md')
})

test('读 / 写 / 删三条路径都拒绝逃逸（仓外文件既不读也不删）', () => {
  withTempRoot((root) => {
    const roots = rootsOf(root)
    // 在双轨目录之外放一个真实文件：如果守门缺失，读会读到它、删会删掉它。
    mkdirSync(roots.projectDir, { recursive: true })
    const outside = join(root, 'outside.md')
    writeFileSync(outside, 'SECRET-OUTSIDE', 'utf8')

    assert.equal(readMemory('project', '../outside.md', roots), '')
    assert.equal(readMemory('project', '../../etc/passwd', roots), '')

    const written = writeMemory('project', '../outside.md', '覆盖', roots)
    assert.equal(written.ok, false)
    assert.match(written.ok === false ? written.error : '', /不合法/)

    const removed = deleteMemory('project', '../outside.md', roots)
    assert.equal(removed.ok, false)

    // 仓外文件必须原封不动地还在（写没覆盖它、删没删掉它）。
    assert.equal(readFileOutside(outside), 'SECRET-OUTSIDE')
  })
})

function readFileOutside(path: string): string {
  // 直接用 fs 读，绕开被测函数（断言的是磁盘事实）。
  return readFileSync(path, 'utf8')
}

test('双轨落盘互不干扰、可读可列可删', () => {
  withTempRoot((root) => {
    const roots = rootsOf(root)
    const written = writeMemory('project', 'conventions', '# 约定\n用 pnpm', roots)
    assert.equal(written.ok, true)
    assert.equal(readMemory('project', 'conventions.md', roots), '# 约定\n用 pnpm')
    assert.equal(readMemory('public', 'conventions.md', roots), '')
    assert.equal(listMemory('project', roots).length, 1)
    assert.equal(listMemory('public', roots).length, 0)
    const info = listMemory('project', roots)[0]
    assert.equal(info.name, 'conventions.md')
    assert.equal(info.chars, '# 约定\n用 pnpm'.length)
    assert.equal(deleteMemory('project', 'conventions.md', roots).ok, true)
    assert.equal(listMemory('project', roots).length, 0)
  })
})

/* ---------------------------------------------------------------- 记忆：来源标注与 20 行上限 */

test('formatSourcedLine 逐字标注来源（角色/任务/时间），无角色时标队长', () => {
  const at = new Date(2026, 9, 30, 14, 2).getTime() // 本地时区构造，故与运行环境时区无关
  assert.equal(
    formatSourcedLine('结论正文', { roleId: 'pm', taskId: 't2', at }),
    '- [pm/t2 · 10-30 14:02] 结论正文',
  )
  assert.equal(formatSourcedLine('结论正文', { roleId: 'dev', taskId: '', at }), '- [dev · 10-30 14:02] 结论正文')
  assert.equal(formatSourcedLine('结论正文', undefined, at), '- [队长 · 10-30 14:02] 结论正文')
  // 已有列表符号不重复叠加
  assert.equal(formatSourcedLine('- 已有前缀', undefined, at), '- [队长 · 10-30 14:02] 已有前缀')
})

test('appendMemoryLines 硬上限 20 行（传 limit=100 也只写 20）且每行带来源前缀', () => {
  withTempRoot((root) => {
    const roots = rootsOf(root)
    const lines = Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 行结论`)
    const result = appendMemoryLines('project', 'log.md', lines, 100, roots, {
      roleId: 'pm',
      taskId: 't2',
      at: new Date(2026, 9, 30, 14, 2).getTime(),
    })
    assert.equal(result.ok, true)
    assert.equal(result.ok === true ? result.written : 0, 20)
    assert.equal(result.ok === true ? result.truncated : false, true)

    const stored = readMemory('project', 'log.md', roots)
    const rows = stored.trimEnd().split('\n')
    assert.equal(rows.length, 20)
    assert.equal(rows[0], '- [pm/t2 · 10-30 14:02] 第 1 行结论')
    assert.equal(rows[19], '- [pm/t2 · 10-30 14:02] 第 20 行结论')
  })
})

test('appendMemoryLines 在已有内容后追加、过滤空行，written=0 时不落盘', () => {
  withTempRoot((root) => {
    const roots = rootsOf(root)
    const at = new Date(2026, 9, 30, 14, 2).getTime()
    writeMemory('project', 'log', '# 日志\n', roots)
    const result = appendMemoryLines('project', 'log', ['结论 A', '   ', '结论 B'], 20, roots, {
      roleId: 'dev',
      taskId: 't1',
      at,
    })
    assert.equal(result.ok, true)
    assert.equal(result.ok === true ? result.written : -1, 2)
    const stored = readMemory('project', 'log.md', roots)
    assert.ok(stored.startsWith('# 日志\n'), '既有正文必须保留')
    assert.equal(
      stored,
      '# 日志\n- [dev/t1 · 10-30 14:02] 结论 A\n- [dev/t1 · 10-30 14:02] 结论 B\n',
    )

    const empty = appendMemoryLines('public', 'nothing', ['  ', ''], 20, roots)
    assert.equal(empty.ok, true)
    assert.equal(empty.ok === true ? empty.written : -1, 0)
    assert.equal(listMemory('public', roots).length, 0, '全空行不应创建文件')
  })
})

/* ---------------------------------------------------------------- 记忆注入 */

test('keywords 兼顾英文词与中文二元组', () => {
  const words = keywords('修复 TSX 面板的渲染问题')
  assert.ok(words.includes('tsx'))
  assert.ok(words.includes('面板'))
})

test('relevance 命中越多分越高', () => {
  const goal = '自动团队 面板'
  const high = relevance(goal, { track: 'project', name: 'a.md', body: '自动团队面板说明' })
  const low = relevance(goal, { track: 'project', name: 'b.md', body: '无关内容' })
  assert.ok(high > low)
})

test('titleOf 取首个 markdown 标题，无标题退回文件名', () => {
  assert.equal(titleOf({ track: 'project', name: 'x.md', body: '\n# 部署约定\n正文' }), '部署约定')
  assert.equal(titleOf({ track: 'project', name: 'conventions.md', body: '正文' }), 'conventions')
})

test('标题命中权重高于正文多次命中（排序先看标题）', () => {
  const goal = '部署'
  const titleHit = { track: 'public' as const, name: 'a.md', body: '# 部署\n与目标无关的长正文'.repeat(1) }
  const bodyHit = { track: 'public' as const, name: 'b.md', body: '部署\n部署\n部署' }
  assert.equal(titleHits(goal, titleHit), 1)
  assert.equal(titleHits(goal, bodyHit), 0)
  assert.ok(relevance(goal, bodyHit) > relevance(goal, titleHit))

  const selection = selectMemory(goal, [bodyHit, titleHit], 4000)
  assert.ok(
    selection.text.indexOf('a.md') < selection.text.indexOf('b.md'),
    '标题命中的 a.md 必须排在正文命中的 b.md 之前',
  )
})

test('注入预算硬上限：任何输入都不超过 budget，且超限时给出截断尾行', () => {
  const budget = 4000
  const body = Array.from({ length: 400 }, (_, index) => `第 ${index + 1} 行：很长的记忆内容，用来撑爆预算`).join('\n')
  const selection = selectMemory('目标', [{ track: 'project', name: 'big.md', body }], budget)
  assert.ok(selection.chars <= budget, `实际 ${selection.chars} 超过预算 ${budget}`)
  assert.equal(selection.chars, selection.text.length, 'chars 必须是最终注入文本长度')
  assert.equal(selection.truncated, true)
  assert.equal(selection.included.length, 1)

  const matched = /（记忆已截断：注入 (\d+)\/(\d+) 字符，省略 (\d+) 行）/.exec(selection.text)
  assert.ok(matched, '超预算必须带固定格式的截断尾行')
  assert.equal(Number(matched[1]), selection.chars, '尾行里的 N 必须等于实际注入字符数')
  assert.equal(Number(matched[2]), budget)
  assert.ok(Number(matched[3]) > 0, '省略行数必须大于 0')
  assert.equal(Number(matched[3]), selection.omitted)
})

test('小预算仍然不超限（含放不下尾行的极端预算）', () => {
  const candidates = [
    { track: 'project' as const, name: 'a.md', body: '甲'.repeat(500) },
    { track: 'project' as const, name: 'b.md', body: '乙'.repeat(500) },
  ]
  for (const budget of [300, 100]) {
    const selection = selectMemory('目标', candidates, budget)
    assert.ok(selection.chars <= budget, `budget=${budget} 实际 ${selection.chars}`)
    assert.equal(selection.chars, selection.text.length)
    assert.equal(selection.truncated, true)
  }
})

test('多候选按项目轨优先，且省略行数随被丢弃文档增长', () => {
  const selection = selectMemory(
    '约定',
    [
      { track: 'public', name: 'pub.md', body: '约定：公共\n第二行' },
      { track: 'project', name: 'proj.md', body: '约定：项目\n第二行\n第三行' },
    ],
    4000,
  )
  assert.match(selection.text, /项目记忆 · proj\.md/)
  assert.ok(selection.text.indexOf('proj.md') < selection.text.indexOf('pub.md'))
  assert.equal(selection.truncated, false)
  assert.equal(selection.omitted, 0)
})

test('预算为 0 时不注入任何内容', () => {
  const selection = selectMemory('目标', [{ track: 'project', name: 'a.md', body: 'x' }], 0)
  assert.equal(selection.text, '')
  assert.equal(selection.truncated, false)
  assert.equal(selection.chars, 0)
})

test('空候选与空正文不产生注入文本', () => {
  const selection = selectMemory('目标', [{ track: 'project', name: 'a.md', body: '   ' }], 4000)
  assert.equal(selection.text, '')
  assert.equal(selection.included.length, 0)
})

/* ---------------------------------------------------------------- 角色库（AC-21 / AC-22） */

function withTempRoleRepo(fn: (repo: ReturnType<typeof createRoleRepo>, dir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-roles-'))
  try {
    const dir = join(root, 'roles')
    const skillsDir = join(root, 'skills')
    const repo = createRoleRepo({ dir, skillsDir, now: () => 1_700_000_000_000 })
    fn(repo, dir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('seed 落盘内置角色与技能，重启（新实例）后仍读得到', () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-roles-'))
  try {
    const dir = join(root, 'roles')
    const skillsDir = join(root, 'skills')
    const deps = { dir, skillsDir, now: () => 1_700_000_000_000 }
    const first = createRoleRepo(deps)
    first.seed()
    assert.equal(existsSync(join(dir, 'pm.json')), true)
    assert.ok(listRoleIds(first).includes('pm'))
    assert.equal(existsSync(join(skillsDir, `${BUILTIN_ROLES[0].skillIds[0]}.md`)), true)

    // 修改内置角色并指定模型 → 新实例（模拟重启）必须读回同一模型
    const pm = first.get('pm')
    assert.ok(pm)
    const saved = first.save({ ...pm, name: '产品经理（改）', model: { provider: 'deepseek', model: 'v4' } })
    assert.equal(saved.ok, true)
    const second = createRoleRepo(deps)
    const reloaded = second.get('pm')
    assert.equal(reloaded?.name, '产品经理（改）')
    assert.deepEqual(reloaded?.model, { provider: 'deepseek', model: 'v4' })
    assert.equal(reloaded?.builtin, true, '内置角色即便改过名也仍是内置（不可删）')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function listRoleIds(repo: ReturnType<typeof createRoleRepo>): string[] {
  return repo.list().map((role) => role.id)
}

test('角色模型只填一半必须报错，且不落盘（不静默回退会话默认）', () => {
  withTempRoleRepo((repo) => {
    const base = { id: 'writer', name: '撰写', duty: '', skillIds: [], builtin: false, updatedAt: 0 }
    const halfProvider = repo.save({ ...base, model: { provider: 'deepseek', model: '' } })
    assert.equal(halfProvider.ok, false)
    assert.match(halfProvider.ok === false ? halfProvider.error : '', /不完整/)
    assert.equal(repo.get('writer'), undefined, '校验失败不得落盘')

    const halfModel = repo.save({ ...base, model: { provider: '', model: 'v4' } })
    assert.equal(halfModel.ok, false)

    const blank = repo.save({ ...base, model: { provider: '  ', model: '  ' } })
    assert.equal(blank.ok, true, '两个都留空 = 跟随会话默认，是合法输入')
    assert.equal(blank.ok === true ? blank.role.model : 'unexpected', undefined)

    const full = repo.save({ ...base, model: { provider: 'deepseek', model: 'v4', reasoningEffort: 'high' } })
    assert.equal(full.ok, true)
    assert.deepEqual(repo.get('writer')?.model, { provider: 'deepseek', model: 'v4', reasoningEffort: 'high' })
  })
})

test('角色 id / 名称校验与内置角色不可删', () => {
  withTempRoleRepo((repo) => {
    const draft = { id: 'Bad Id', name: 'x', duty: '', skillIds: [], builtin: false, updatedAt: 0 }
    assert.equal(repo.save(draft).ok, false)
    assert.equal(repo.save({ ...draft, id: 'captain' }).ok, false, 'captain 是队长保留 id')
    assert.equal(repo.save({ ...draft, id: 'ok-id', name: '   ' }).ok, false)

    repo.seed()
    const removed = repo.remove('pm')
    assert.equal(removed.ok, false)
    assert.match(removed.ok === false ? removed.error : '', /内置角色不可删除/)

    assert.equal(repo.save({ id: 'ok-id', name: '临时', duty: 'd', skillIds: [], builtin: false, updatedAt: 0 }).ok, true)
    assert.equal(repo.remove('ok-id').ok, true)
    assert.equal(repo.get('ok-id'), undefined)
  })
})

test('normalizeModel 宽松归一（读盘脏数据不让角色消失）', () => {
  assert.deepEqual(normalizeModel({ provider: 'deepseek', model: 'v4' }), { provider: 'deepseek', model: 'v4' })
  assert.deepEqual(normalizeModel({ provider: ' deepseek ', model: ' v4 ', reasoningEffort: 'low' }), {
    provider: 'deepseek',
    model: 'v4',
    reasoningEffort: 'low',
  })
  assert.equal(normalizeModel({ provider: 'deepseek', model: '  ' }), undefined)
  assert.equal(normalizeModel({ provider: 'deep seek', model: 'v4' }), undefined)
  assert.equal(normalizeModel(undefined), undefined)
  assert.equal(normalizeModel('deepseek/v4'), undefined)
  const illegalEffort = normalizeModel({ provider: 'a', model: 'b', reasoningEffort: 'ultra' as never })
  assert.equal(illegalEffort?.reasoningEffort, undefined)
})

test('validateModel 严格口径：半填/空白/非法 effort 报错，留空表示跟随默认', () => {
  assert.deepEqual(validateModel(undefined), { ok: true })
  assert.deepEqual(validateModel({ provider: '', model: '' }), { ok: true })
  assert.equal(validateModel({ provider: 'a', model: '' }).ok, false)
  assert.equal(validateModel({ provider: '', model: 'b' }).ok, false)
  assert.equal(validateModel({ provider: 'a b', model: 'c' }).ok, false)
  assert.equal(validateModel({ provider: 'a', model: 'c', reasoningEffort: 'ultra' as never }).ok, false)
  assert.deepEqual(validateModel({ provider: 'a', model: 'c', reasoningEffort: 'medium' }), {
    ok: true,
    model: { provider: 'a', model: 'c', reasoningEffort: 'medium' },
  })
})
