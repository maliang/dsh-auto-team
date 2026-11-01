/**
 * 技能 md 仓储单测（r10 AC-19/AC-20）。
 *
 * 这里测的是**落盘语义**，不是「函数被调到」：
 *  - seed 三态（缺失写完整 / 缺 frontmatter 只前置 / 已有 frontmatter 一个字节不动）；
 *  - `modified` 现算（改正文就变 true，恢复出厂就变 false），且**不落盘**；
 *  - 内置不可删、用户三源可删、删除与恢复出厂互不影响。
 *
 * 用 mkdtemp，不依赖宿主、不依赖用户真实 `~/.dsh`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_TITLE_MAX } from '../src/shared/const.ts'
import { BUILTIN_SKILLS, builtinSkillBody } from '../src/host/roles/builtin.ts'
import {
  createSkillRepo,
  parseSkillFile,
  renderSkillFile,
  slugifySkillTitle,
  type SkillRepo,
} from '../src/host/roles/skills-repo.ts'

const NOW = 1_700_000_000_000

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function withRepo(fn: (repo: SkillRepo, dir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-skills-'))
  try {
    const dir = join(root, 'skills')
    fn(createSkillRepo({ dir, now: () => NOW }), dir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
}

/** 取盘上文件的正文（frontmatter 之后的部分），用于「正文一个字节不动」的断言。 */
function bodyOfFile(path: string): string {
  const text = readFileSync(path, 'utf8')
  const parts = text.split('\n---\n')
  return parts.length < 2 ? text : parts.slice(1).join('\n---\n')
}

/* ───────────────────────────── seed ───────────────────────────── */

test('seed()：12 条内置技能全部落成带 frontmatter 的 md', () => {
  assert.equal(BUILTIN_SKILLS.length, 12, '内置技能数量是契约（AC-19：12 条，与 11 个内置角色配套）')
  withRepo((repo, dir) => {
    repo.seed()
    assert.deepEqual(mdFiles(dir), BUILTIN_SKILLS.map((skill) => `${skill.id}.md`).sort())
    for (const skill of BUILTIN_SKILLS) {
      const text = readFileSync(join(dir, `${skill.id}.md`), 'utf8')
      assert.match(text, /^---\n/, `${skill.id} 必须以 frontmatter 开头`)
      assert.match(text, new RegExp(`\\nid: ${skill.id}\\n`), `${skill.id} 的 frontmatter 必须带 id`)
      assert.match(text, /\nsource: builtin\n/, `${skill.id} 的 source 必须是 builtin`)
      assert.match(text, /\nupdatedAt: 0\n/, `${skill.id} 出厂 updatedAt 必须是 0`)
      const record = repo.get(skill.id)
      assert.equal(record?.body, skill.body, `${skill.id} 落盘正文必须与出厂正文逐字相同`)
      assert.equal(record?.modified, false, '刚 seed 出来的内置技能不算「已修改」')
    }
  })
})

test('seed()：r7 老文件（无 frontmatter）只前置 frontmatter，正文一个字节不动', () => {
  withRepo((repo, dir) => {
    mkdirSync(dir, { recursive: true })
    // 逐字模拟 r7 落盘形状：只有正文、没有 frontmatter，且用户已经改过一句。
    const legacyBody = `# 需求与验收标准\n- 用户自己写的第 1 条\n- 用户自己写的第 2 条\n`
    writeFileSync(join(dir, 'prd-writing.md'), legacyBody, 'utf8')

    repo.seed()

    const text = readFileSync(join(dir, 'prd-writing.md'), 'utf8')
    assert.match(text, /^---\nid: prd-writing\n/, '老文件必须先被前置 frontmatter')
    assert.ok(text.endsWith(legacyBody), '正文必须逐字保留（含结尾换行），否则用户编辑会被吞掉')
    assert.equal(bodyOfFile(join(dir, 'prd-writing.md')), legacyBody, 'frontmatter 之后必须原样接正文')
    const record = repo.get('prd-writing')
    assert.equal(record?.source, 'builtin', 'id 命中出厂清单就是内置，与磁盘写法无关')
    assert.equal(record?.modified, true, '正文与出厂正文不同 → 迁移后必须立刻显示「已修改」')
    assert.equal(record?.title, '需求与验收标准', 'title 从首个 # 行派生')
  })
})

test('seed()：已有 frontmatter 的文件（用户改过）重启不被覆盖', () => {
  withRepo((repo, dir) => {
    repo.seed()
    const path = join(dir, 'implementation.md')
    const edited = readFileSync(path, 'utf8').replace('- 改动最小化：', '- 用户改过的第一条：')
    writeFileSync(path, edited, 'utf8')
    const before = sha256(readFileSync(path, 'utf8'))

    repo.seed()

    assert.equal(sha256(readFileSync(path, 'utf8')), before, 'seed 不许覆盖用户改过的正文（AC-20）')
    assert.equal(repo.get('implementation')?.modified, true, '改过的内置技能必须一直显示「已修改」')
  })
})

/* ───────────────────────────── 四来源 CRUD ───────────────────────────── */

test('save()：新建按标题派生 id，撞名自动 -2/-3，不改已有技能', () => {
  withRepo((repo, dir) => {
    const first = repo.save({ title: 'My Skill', description: '一句话', body: '# My Skill\n正文', source: 'manual' })
    assert.equal(first.error, undefined)
    assert.equal(first.data?.id, 'my-skill')
    assert.equal(first.data?.updatedAt, NOW, '用户保存写 now()')

    const second = repo.save({ title: 'My Skill', description: '另一条', body: '# My Skill\n第二条', source: 'manual' })
    assert.equal(second.data?.id, 'my-skill-2', '撞名必须加 -2，不许静默覆盖已有技能')
    const third = repo.save({ title: 'My Skill', description: '第三条', body: '# My Skill\n第三条', source: 'manual' })
    assert.equal(third.data?.id, 'my-skill-3')

    assert.equal(repo.get('my-skill')?.description, '一句话', '第一条技能不能被后来者改掉')
    assert.equal(mdFiles(dir).filter((name) => name.startsWith('my-skill')).length, 3)
  })
})

test('save()：带 id 视为更新（id 不变），正文与说明按新值落盘', () => {
  withRepo((repo) => {
    const created = repo.save({ title: '导入的技能', description: '原说明', body: '# 导入的技能\n原正文', source: 'imported' })
    const id = created.data?.id ?? ''
    assert.match(id, /^[a-z0-9][a-z0-9-]{0,31}$/)

    const saved = repo.save({ id, title: '改过的标题', description: '新说明', body: '# 改过的标题\n新正文', source: 'imported' })
    assert.equal(saved.error, undefined)
    assert.equal(saved.data?.id, id, '更新不许改 id（角色 skillIds 引用的是它）')
    const record = repo.get(id)
    assert.equal(record?.title, '改过的标题')
    assert.equal(record?.body, '# 改过的标题\n新正文')
    assert.equal(record?.source, 'imported')
    assert.equal(record?.modified, false, '非内置技能永远不算「已修改」')
  })
})

test('save()：空正文、超长标题/正文/说明、非法 id 一律拒绝并给可读原因', () => {
  withRepo((repo, dir) => {
    const emptyBody = repo.save({ title: '空', description: '说明', body: '   ', source: 'manual' })
    assert.match(emptyBody.error ?? '', /正文不能为空/)

    const emptyTitle = repo.save({ title: '  ', description: '说明', body: '# x', source: 'manual' })
    assert.match(emptyTitle.error ?? '', /标题不能为空/)

    const longTitle = repo.save({ title: 'x'.repeat(SKILL_TITLE_MAX + 1), description: '说明', body: '# x', source: 'manual' })
    assert.match(longTitle.error ?? '', new RegExp(`最多 ${SKILL_TITLE_MAX} 字`))

    const longBody = repo.save({ title: '长', description: '说明', body: 'x'.repeat(SKILL_BODY_MAX + 1), source: 'manual' })
    assert.match(longBody.error ?? '', new RegExp(`最多 ${SKILL_BODY_MAX} 字`))

    const longDescription = repo.save({
      title: '说明超长',
      description: 'x'.repeat(SKILL_DESCRIPTION_MAX + 1),
      body: '# x',
      source: 'manual',
    })
    assert.match(longDescription.error ?? '', new RegExp(`最多 ${SKILL_DESCRIPTION_MAX} 字`))

    const badId = repo.save({ id: 'Bad Id', title: '非法', description: '说明', body: '# x', source: 'manual' })
    assert.match(badId.error ?? '', /id 不合法/)

    assert.deepEqual(mdFiles(dir), [], '任何一次失败都不许留下半截文件')
  })
})

test('save()：说明缺省时从正文派生（不逼用户填两遍）', () => {
  withRepo((repo) => {
    const saved = repo.save({ title: '派生说明', description: '   ', body: '# 派生说明\n- 正文第一句就是说明\n- 第二行', source: 'manual' })
    assert.equal(saved.data?.description, '正文第一句就是说明')
  })
})

test('save()：内置 id 只能改、不能被「新建成内置」，source 永远由出厂清单裁定', () => {
  withRepo((repo) => {
    repo.seed()
    const edited = repo.save({
      id: 'testing',
      title: '测试与质量门禁',
      description: '用户改过的说明',
      body: '# 测试与质量门禁\n- 用户自己加的一条\n',
      source: 'builtin',
    })
    assert.equal(edited.error, undefined)
    assert.equal(edited.data?.source, 'builtin')
    assert.equal(edited.data?.modified, true, '正文与出厂不同 → 现算为已修改')

    // 谎报 builtin 但 id 不在出厂清单：必须拒（否则用户能造出「假内置」，永久删不掉）。
    const fake = repo.save({ id: 'my-fake', title: '假内置', description: '说明', body: '# x', source: 'builtin' })
    assert.match(fake.error ?? '', /不能新建内置技能/)
    assert.equal(repo.get('my-fake'), undefined)
  })
})

test('remove()：内置拒删（只能恢复出厂），用户三源可删，不存在给可读错误', () => {
  withRepo((repo, dir) => {
    repo.seed()
    const builtin = repo.remove('testing')
    assert.match(builtin.error ?? '', /内置技能不可删除/)
    assert.equal(existsSync(join(dir, 'testing.md')), true, '拒删必须真的不删文件')

    const created = repo.save({ title: '临时技能', description: '说明', body: '# 临时技能\n正文', source: 'manual' })
    const id = created.data?.id ?? ''
    const removed = repo.remove(id)
    assert.deepEqual(removed.data, { id, title: '临时技能' })
    assert.equal(existsSync(join(dir, `${id}.md`)), false)

    assert.match(repo.remove(id).error ?? '', /技能不存在/)
  })
})

test('restoreBuiltin()：正文回出厂、modified 归 false，且不影响其它技能', () => {
  withRepo((repo) => {
    repo.seed()
    repo.save({ id: 'testing', title: '测试与质量门禁', description: '改过', body: '# 用户版\n- 只有一行', source: 'builtin' })
    const mine = repo.save({ title: '我的技能', description: '说明', body: '# 我的技能\n正文', source: 'manual' })

    const restored = repo.restoreBuiltin('testing')
    assert.equal(restored.error, undefined)
    assert.equal(restored.data?.body, builtinSkillBody('testing'), '必须回到出厂正文')
    assert.equal(restored.data?.modified, false)
    assert.equal(repo.get('testing')?.body, builtinSkillBody('testing'), '重启后读到的也必须是出厂正文')

    assert.equal(repo.get('skill')?.body, '# 我的技能\n正文', '恢复出厂不许动用户技能')
    assert.ok(mine.data !== undefined)

    assert.match(repo.restoreBuiltin('my-skill').error ?? '', /只有内置技能可以恢复出厂/)
  })
})

test('restoreBuiltins()：全部内置回出厂，用户三源一个字节不动', () => {
  withRepo((repo, dir) => {
    repo.seed()
    repo.save({ id: 'docs', title: '文档与交付说明', description: '改过', body: '# 用户版文档', source: 'builtin' })
    const imported = repo.save({ title: 'Imported Skill', description: '导入', body: '# Imported\n导入正文', source: 'imported' })
    const system = repo.save({ title: 'System Skill', description: '系统', body: '# System\n系统正文', source: 'system' })
    const manual = repo.save({ title: 'Manual Skill', description: '手写', body: '# Manual\n手写正文', source: 'manual' })
    const users = [imported, system, manual].map((result) => join(dir, `${result.data?.id}.md`))
    const before = users.map((path) => sha256(readFileSync(path, 'utf8')))

    const { restored } = repo.restoreBuiltins()

    assert.equal(restored.length, BUILTIN_SKILLS.length, '恢复出厂必须覆盖全部内置技能')
    assert.equal(repo.get('docs')?.modified, false, '内置技能必须回到未修改状态')
    assert.deepEqual(
      users.map((path) => sha256(readFileSync(path, 'utf8'))),
      before,
      '用户三源必须逐字节不变（恢复出厂不是清空技能库）',
    )
  })
})

/* ───────────────────────────── 投影与排序 ───────────────────────────── */

test('projection()：不含正文、带 source/modified，整包体积远小于正文总和', () => {
  withRepo((repo) => {
    repo.seed()
    repo.save({ title: 'Manual Skill', description: '手写', body: '# Manual\n手写正文', source: 'manual' })
    const projection = repo.projection()
    assert.equal(projection.length, BUILTIN_SKILLS.length + 1)
    for (const item of projection) {
      assert.equal(Object.keys(item).sort().join(','), 'description,id,modified,source,title', '投影字段集合是契约')
      assert.equal('body' in item, false, '正文绝不进快照')
    }
    const payload = JSON.stringify(projection)
    assert.ok(payload.length < 8_192, `投影必须够小（实际 ${payload.length} 字节）`)
    const bodies = BUILTIN_SKILLS.reduce((sum, skill) => sum + skill.body.length, 0)
    assert.ok(bodies > payload.length, '内置正文总和必须大于投影体积（否则这条断言不承载信息）')
  })
})

test('list()：内置按出厂序在前，用户三源按 导入→系统→手写 排序', () => {
  withRepo((repo) => {
    repo.seed()
    repo.save({ title: 'Z Manual', description: '手写', body: '# Z\n手写', source: 'manual' })
    repo.save({ title: 'A System', description: '系统', body: '# A\n系统', source: 'system' })
    repo.save({ title: 'M Imported', description: '导入', body: '# M\n导入', source: 'imported' })

    const ids = repo.list().map((record) => record.id)
    assert.deepEqual(ids.slice(0, BUILTIN_SKILLS.length), BUILTIN_SKILLS.map((skill) => skill.id), '内置按出厂序')
    const tail = ids.slice(BUILTIN_SKILLS.length)
    assert.deepEqual(tail, ['m-imported', 'a-system', 'z-manual'], '用户三源：导入 → 系统 → 手写')
  })
})

test('readBody()：读盘上正文（用户改过的内置技能读回用户版本），不存在给可读错误', () => {
  withRepo((repo) => {
    repo.seed()
    repo.save({ id: 'review', title: '评审与风险', description: '改过', body: '# 用户版评审\n- 只留一条', source: 'builtin' })
    const body = repo.readBody('review')
    assert.equal(body.data, '# 用户版评审\n- 只留一条', '读正文必须读盘，不能读回出厂常量（否则界面改了、提示词没变）')
    assert.match(repo.readBody('no-such-skill').error ?? '', /技能不存在/)
  })
})

/* ───────────────────────────── 解析 / 渲染 / slug ───────────────────────────── */

test('parseSkillFile()：无 frontmatter 的老文件按正文派生 title/description，id 取文件名', () => {
  const parsed = parseSkillFile('legacy-note.md', '# 老技能标题\n\n这是第一段说明。\n- 第二条\n')
  assert.equal(parsed.id, 'legacy-note')
  assert.equal(parsed.title, '老技能标题')
  assert.equal(parsed.description, '这是第一段说明。')
  assert.equal(parsed.source, 'manual', 'id 不在出厂清单 → manual')
  assert.equal(parsed.hasFrontmatter, false)
  assert.equal(parsed.body, '# 老技能标题\n\n这是第一段说明。\n- 第二条')
})

test('parseSkillFile()/renderSkillFile()：往返一致，且 frontmatter 只有 5 个键', () => {
  const record = {
    id: 'round-trip',
    title: '往返',
    description: '一句话',
    body: '# 往返\n- 第一行\n- 第二行',
    source: 'manual' as const,
    modified: false,
    updatedAt: NOW,
  }
  const text = renderSkillFile(record)
  const keys = text
    .split('\n---\n')[0]
    .split('\n')
    .filter((line) => line.includes(':'))
    .map((line) => line.slice(0, line.indexOf(':')))
  assert.deepEqual(keys, ['id', 'title', 'description', 'source', 'updatedAt'], 'frontmatter 键集合与顺序固定')
  const parsed = parseSkillFile('round-trip.md', text)
  assert.equal(parsed.body, record.body)
  assert.equal(parsed.title, record.title)
  assert.equal(parsed.description, record.description)
  assert.equal(parsed.source, 'manual')
  assert.equal(parsed.updatedAt, NOW)
})

test('slugifySkillTitle()：非 [a-z0-9] 折连字符、压缩重复、截 32、空则 skill', () => {
  assert.equal(slugifySkillTitle('My Skill'), 'my-skill')
  assert.equal(slugifySkillTitle('  A__B  '), 'a-b')
  assert.equal(slugifySkillTitle('中文标题'), 'skill', '全中文标题折完为空 → 兜底 skill')
  assert.equal(slugifySkillTitle('x'.repeat(80)).length, 32)
  assert.equal(slugifySkillTitle('---'), 'skill')
})
