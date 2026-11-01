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
  memoryIdOf,
  memoryIndexOf,
  relevance,
  selectMemory,
  summaryOf,
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
    selection.text.indexOf('mem://public/a') < selection.text.indexOf('mem://public/b'),
    '标题命中的 a 必须排在正文命中的 b 之前',
  )
})

/* ---------------------------------------------------------------- 内联索引（AC-7 / AC-8） */

test('memoryIdOf 是 ID 拼装唯一出处，且 ID 的 stem 能与 safeMemoryName 逐字往返', () => {
  assert.equal(memoryIdOf('project', 'conventions.md'), 'mem://project/conventions')
  assert.equal(memoryIdOf('public', '  log.md  '), 'mem://public/log')
  for (const name of ['conventions.md', 'proj_2026-01.md', 'Log.md']) {
    const id = memoryIdOf('project', name)
    const stem = id.replace('mem://project/', '')
    assert.equal(safeMemoryName(stem), name, 'ID 的 stem 必须能还原成磁盘文件名（大小写不丢）')
    assert.equal(memoryIdOf('project', safeMemoryName(stem) ?? ''), id, 'ID 往返必须稳定')
  }
})

test('summaryOf 取首个非标题行的第一句并收敛长度', () => {
  assert.equal(summaryOf({ track: 'project', name: 'a.md', body: '# 标题\n- 列表首句。第二句' }), '列表首句。')
  assert.equal(summaryOf({ track: 'project', name: 'a.md', body: '无句号的一整行内容' }), '无句号的一整行内容')
  assert.equal(summaryOf({ track: 'project', name: 'a.md', body: '# 只有标题' }), '')
  const long = summaryOf({ track: 'project', name: 'a.md', body: '很'.repeat(200) })
  assert.ok(long.length <= 60, `摘要应 ≤60，实际 ${long.length}`)
  assert.ok(long.endsWith('…'))
})

test('AC-7：每条内联项 ≤200 字符，形如 mem:// ID + 轨道 + 标题 + 摘要，且带 ≥1 个关联 ID', () => {
  const candidates = [
    { track: 'project' as const, name: 'conventions.md', body: '# 团队约定\n提交前必须跑 pnpm build。第二段原文不该出现在注入里。' },
    { track: 'project' as const, name: 'testing.md', body: '# 测试约定\nnode --test 直接跑 TS 源。' },
    { track: 'public' as const, name: 'git.md', body: '# Git 纪律\n只在当前分支工作。' },
  ]
  const index = memoryIndexOf('提交前跑 build', candidates, 4000)
  assert.equal(index.entries.length, 3)
  assert.equal(index.omitted.length, 0)
  for (const entry of index.entries) {
    assert.ok(entry.chars <= 200, `内联项 ${entry.id} 长度 ${entry.chars} 超过 200`)
    assert.match(entry.id, /^mem:\/\/(public|project)\/[A-Za-z0-9][A-Za-z0-9._-]*$/)
    assert.ok(entry.related.length >= 1, `内联项 ${entry.id} 必须带 ≥1 个关联 ID`)
    assert.ok(!entry.related.includes(entry.id), '关联 ID 不得指向自身')
    assert.ok(entry.title.length > 0, '内联项必须带标题')
    assert.ok(entry.summary.length > 0, '内联项必须带摘要')
  }
  const line = index.text.split('\n').find((row) => row.startsWith('mem://project/conventions')) ?? ''
  assert.ok(line.length <= 200, `单行 ${line.length} 超过 200`)
  assert.match(
    line,
    /^mem:\/\/project\/conventions · 项目记忆 · 团队约定 — 提交前必须跑 pnpm build。 ⇄ mem:\/\//,
  )
  assert.ok(line.endsWith(memoryIdOf('public', 'git.md')) || line.includes('mem://'), '关联 ID 必须可读')
})

test('AC-7：源文件深处正文在注入文本里 0 命中（只给首句摘要，全文走 expand）', () => {
  const deep = 'DEEP-MARKER-正文深处的独有句子'
  const body = `# 部署约定\n第一段首句。\n\n${deep}\n\n又一段 ${deep}`
  const index = memoryIndexOf('部署', [{ track: 'project', name: 'deploy.md', body }], 4000)
  assert.equal(index.entries.length, 1)
  assert.ok(index.text.includes('mem://project/deploy'), '必须内联可展开 ID')
  assert.equal(index.text.includes(deep), false, '正文深处的内容不得整段塞进注入文本')
})

test('AC-8：10KB 记忆库注入 ≤4000，0 命中旧截断标记，省略项仍可按 ID 展开取回', () => {
  const budget = 4000
  const candidates = Array.from({ length: 60 }, (_, index) => ({
    track: (index % 3 === 0 ? 'public' : 'project') as 'public' | 'project',
    name: `note-${String(index).padStart(2, '0')}.md`,
    body: `# 记忆 ${index}\n${'内容'.repeat(90)}`,
  }))
  const libraryChars = candidates.reduce((sum, item) => sum + item.body.length, 0)
  assert.ok(libraryChars >= 10_000, `夹具应 ≥10KB，实际 ${libraryChars}`)

  const index = memoryIndexOf('内容', candidates, budget)
  assert.ok(index.chars <= budget, `实际 ${index.chars} 超过预算 ${budget}`)
  assert.equal(index.chars, index.text.length, 'chars 必须是最终注入文本长度')
  assert.equal(index.entries.length + index.omitted.length, candidates.length, '未内联的条目不得丢失')
  assert.ok(index.entries.length < candidates.length, '超预算时必须真的省略了条目（内联数 < 候选数）')
  assert.equal(index.truncated, true, 'truncated 的语义 = 有未内联条目')
  assert.equal(index.text.includes('记忆已截断'), false, '旧截断标注必须 0 命中')
  assert.equal(index.text.includes('[截断]'), false, '旧截断标记必须 0 命中')
  assert.match(index.text, /另有 \d+ 条未内联（可按 ID 展开）：mem:\/\//)

  // 省略项仍可按 ID 取回：ID 必须能还原成磁盘文件名，且与内存期同源
  for (const entry of index.omitted) {
    assert.equal(safeMemoryName(entry.name), entry.name, '省略项文件名必须可还原')
    assert.equal(memoryIdOf(entry.track, entry.name), entry.id)
  }
})

test('小预算仍然不超限（含放不下任何一条的极端预算）', () => {
  const candidates = [
    { track: 'project' as const, name: 'a.md', body: '甲'.repeat(500) },
    { track: 'project' as const, name: 'b.md', body: '乙'.repeat(500) },
  ]
  for (const budget of [250, 100]) {
    const index = memoryIndexOf('目标', candidates, budget)
    assert.ok(index.chars <= budget, `budget=${budget} 实际 ${index.chars}`)
    assert.equal(index.chars, index.text.length)
    assert.equal(index.truncated, index.omitted.length > 0, 'truncated 必须等价于「有未内联条目」')
    assert.ok(index.omitted.length > 0, `budget=${budget} 应当有条目放不下`)
    assert.equal(index.entries.length + index.omitted.length, 2, '条目只能进 entries 或 omitted，不能凭空消失')
  }
})

test('多候选按项目轨优先，全部放下时 truncated=false 且 omitted 为空', () => {
  const index = memoryIndexOf(
    '约定',
    [
      { track: 'public', name: 'pub.md', body: '约定：公共\n第二行' },
      { track: 'project', name: 'proj.md', body: '约定：项目\n第二行\n第三行' },
    ],
    4000,
  )
  assert.match(index.text, /mem:\/\/project\/proj/)
  assert.ok(index.text.indexOf('mem://project/proj') < index.text.indexOf('mem://public/pub'))
  assert.equal(index.truncated, false)
  assert.equal(index.omitted.length, 0)
  assert.equal(index.entries.length, 2)
})

test('selectMemory 是兼容壳：text 与 memoryIndexOf 同源，omitted 改为未内联条目数', () => {
  const candidates = [
    { track: 'project' as const, name: 'a.md', body: '甲'.repeat(500) },
    { track: 'project' as const, name: 'b.md', body: '乙'.repeat(500) },
  ]
  const index = memoryIndexOf('目标', candidates, 300)
  const selection = selectMemory('目标', candidates, 300)
  assert.equal(selection.text, index.text)
  assert.equal(selection.chars, index.chars)
  assert.equal(selection.truncated, index.truncated)
  assert.equal(selection.omitted, index.omitted.length)
  assert.deepEqual(selection.included, index.entries.map((entry) => entry.name))
  assert.deepEqual(selection.notInlined, index.omitted)
})

test('预算为 0 时不注入任何内容', () => {
  const index = memoryIndexOf('目标', [{ track: 'project', name: 'a.md', body: 'x' }], 0)
  assert.equal(index.text, '')
  assert.equal(index.truncated, false)
  assert.equal(index.chars, 0)
  assert.equal(index.entries.length, 0)
})

test('空候选与空正文不产生注入文本', () => {
  const index = memoryIndexOf('目标', [{ track: 'project', name: 'a.md', body: '   ' }], 4000)
  assert.equal(index.text, '')
  assert.equal(index.entries.length, 0)
  assert.equal(index.truncated, false)
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

test('seed 落盘内置角色，重启（新实例）后仍读得到（技能 md 归 skills-repo，角色库不再写）', () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-roles-'))
  try {
    const dir = join(root, 'roles')
    const skillsDir = join(root, 'skills')
    const deps = { dir, skillsDir, now: () => 1_700_000_000_000 }
    const first = createRoleRepo(deps)
    first.seed()
    assert.equal(existsSync(join(dir, 'pm.json')), true)
    assert.ok(listRoleIds(first).includes('pm'))
    // r10：角色库只写角色 JSON，技能 md 的 seed 已迁到 roles/skills-repo.ts（覆盖层 + frontmatter）。
    assert.equal(existsSync(join(skillsDir, `${BUILTIN_ROLES[0].skillIds[0]}.md`)), false)

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
