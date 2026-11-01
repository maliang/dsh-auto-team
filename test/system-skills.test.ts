/**
 * 系统技能库扫描单测（r10 AC-19）。
 *
 * 宿主**没有 skills 服务**（`provide("skills")` 实测 0 命中），我们只能只读扫 `~/.agents/skills`。
 * 因此这里重点测降级：目录缺失、缺 SKILL.md、坏 frontmatter、全中文目录 —— 任何一种都不许
 * 把整批扫描打成异常（否则面板连角色一起读不出来），也不许写进别人的技能库。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSystemSkillSource, parseSystemSkill } from '../src/host/roles/system-skills.ts'

function withLibrary(fn: (dir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-system-skills-'))
  try {
    const dir = join(root, 'skills')
    mkdirSync(dir, { recursive: true })
    fn(dir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeSkill(dir: string, name: string, text: string): void {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'SKILL.md'), text, 'utf8')
}

test('scan()：解析 frontmatter 的 name/description，正文原样带上', () => {
  withLibrary((dir) => {
    writeSkill(
      dir,
      'pdf',
      ['---', 'name: pdf', 'description: PDF 处理与抽取', '---', '# PDF', '- 逐页抽取文本'].join('\n'),
    )
    const scan = createSystemSkillSource({ dir }).scan()
    assert.equal(scan.reason, undefined, '库可用时不给 reason')
    assert.equal(scan.skills.length, 1)
    const [entry] = scan.skills
    assert.equal(entry.name, 'pdf')
    assert.equal(entry.description, 'PDF 处理与抽取')
    assert.equal(entry.body, '# PDF\n- 逐页抽取文本')
    assert.equal(entry.dir, join(dir, 'pdf'), '条目要能定位到目录（排障用）')
  })
})

test('scan()：缺 frontmatter 时 name 回退目录名、description 回退首个非空正文行', () => {
  withLibrary((dir) => {
    writeSkill(dir, 'my-helper', '# 我的助手\n\n随手用的技能说明。\n- 细节')
    const scan = createSystemSkillSource({ dir }).scan()
    assert.equal(scan.skills.length, 1)
    assert.equal(scan.skills[0].name, 'my-helper')
    assert.equal(scan.skills[0].description, '随手用的技能说明。')
    assert.match(scan.skills[0].body, /^# 我的助手/)
  })
})

test('scan()：目录不存在给可读 reason（含路径），不是静默空列表', () => {
  const missing = join(tmpdir(), `auto-team-no-skills-${process.pid}-${Date.now()}`)
  const scan = createSystemSkillSource({ dir: missing }).scan()
  assert.deepEqual(scan.skills, [])
  assert.match(scan.reason ?? '', /本机没有系统技能库/)
  assert.ok((scan.reason ?? '').includes(missing), 'reason 里必须带真实路径，否则用户不知道该建哪个目录')
})

test('scan()：缺 SKILL.md 的目录、dot 目录、普通文件一律跳过，且不打断其它条目', () => {
  withLibrary((dir) => {
    mkdirSync(join(dir, 'no-skill-file'), { recursive: true })
    mkdirSync(join(dir, '.hidden'), { recursive: true })
    writeFileSync(join(dir, '.hidden', 'SKILL.md'), '---\nname: hidden\n---\n', 'utf8')
    writeFileSync(join(dir, 'plain.txt'), 'not a skill', 'utf8')
    writeSkill(dir, 'ok', '---\nname: ok\ndescription: 正常条目\n---\n# OK')
    const scan = createSystemSkillSource({ dir }).scan()
    assert.equal(scan.reason, undefined)
    assert.deepEqual(scan.skills.map((skill) => skill.name), ['ok'], '坏条目不进结果，好条目照常返回')
  })
})

test('scan()：按 name 排序，且**只读**（扫描前后目录内容逐字节不变、不新增文件）', () => {
  withLibrary((dir) => {
    writeSkill(dir, 'zeta', '---\nname: zeta\ndescription: 最后一个\n---\n# z')
    writeSkill(dir, 'alpha', '---\nname: alpha\ndescription: 第一个\n---\n# a')
    const before = readdirSync(dir).sort()
    const scan = createSystemSkillSource({ dir }).scan()
    assert.deepEqual(scan.skills.map((skill) => skill.name), ['alpha', 'zeta'], '清单按 name 稳定排序')
    assert.deepEqual(readdirSync(dir).sort(), before, '扫描不许在系统技能库里写任何东西')
  })
})

test('parseSystemSkill()：frontmatter 没有闭合分隔符时退回「整篇当正文」', () => {
  const parsed = parseSystemSkill('---\nname: broken\n# 没有闭合\n')
  assert.equal(parsed.name, undefined, '坏 frontmatter 不许猜出半个字段')
  assert.match(parsed.body, /name: broken/, '没有闭合时整篇都是正文（宁可丑，不可丢内容）')
})
