/**
 * r23 记忆条目纯逻辑（entries.ts）：解析 / 渲染逐字格式 / 判重 / upsert / supersede / 淘汰 / 上限。
 *
 * 断言都按 DESIGN §4–§7 的口径写：改回错误实现（M1 常量、M2 淘汰顺序、M3 允许淘汰 P0、
 * M6 hash 不归一、M11 tombstone 计 40）这些用例必须变红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyMemoryMutation,
  entryHash,
  entryIdOf,
  normalizeEntryText,
  parseEntryFile,
  renderEntryFile,
  routeTopic,
  supersedeEntry,
  upsertEntry,
  type EntryDraft,
  type ParsedEntry,
} from '../src/host/memory/entries.ts'

const NOW = new Date(2026, 10, 10, 17, 20).getTime()

function draftOf(over: Partial<EntryDraft> & Pick<EntryDraft, 'text'>): EntryDraft {
  return { track: 'project', level: 'P2', source: '队长', at: NOW, ...over }
}

function entryOf(over: Partial<ParsedEntry> = {}): ParsedEntry {
  const text = over.text ?? '失败教训'
  return {
    track: 'project',
    file: 'pitfalls.md',
    topic: 'pitfalls',
    level: 'P2',
    text,
    source: '系统',
    at: NOW,
    revisions: 1,
    lineIndex: 0,
    hash: entryHash(text),
    canonical: true,
    superseded: false,
    ...over,
  }
}

/* ───────────────────────────── 主题路由 ───────────────────────────── */

test('r23 路由：DESIGN §5.3 表驱动用例逐条命中（含优先级与兜底）', () => {
  const cases: Array<[string, string, string]> = [
    ['门禁 pnpm test 失败，退出码 1', 'project', 'pitfalls'],
    ['pnpm typecheck 通过后的门禁命令', 'project', 'commands'],
    ['面板字号必须用 font token', 'project', 'ui'],
    ['宿主 inject 漏声明导致 entry 不激活', 'project', 'host'],
    ['模块依赖方向铁律', 'project', 'architecture'],
    ['架构分层与共享类型', 'project', 'architecture'],
    ['需求变更并入原任务', 'project', 'workflow'],
    ['整理记忆流水', 'project', 'workflow'],
    ['今天天气', 'project', 'conventions'],
    ['面板布局', 'public', 'workflow'],
    ['业务字段迁移', 'public', 'architecture'],
  ]
  for (const [text, track, expected] of cases) {
    const result = routeTopic({ track: track as 'project' | 'public', text })
    assert.equal(result.ok, true, text)
    assert.equal(result.ok && result.topic, expected, `「${text}」应路由到 ${expected}`)
  }
})

test('r23 路由：显式 topic 优先于关键词；项目轨允许 ui；公共轨显式 ui 直接 BAD_TOPIC', () => {
  assert.deepEqual(routeTopic({ track: 'project', text: 'pnpm test 失败', topic: 'architecture' }), {
    ok: true,
    topic: 'architecture',
  })
  const bad = routeTopic({ track: 'public', text: '面板布局', topic: 'ui' })
  assert.equal(bad.ok, false)
  assert.equal(!bad.ok && bad.code, 'BAD_TOPIC')
  assert.match(!bad.ok ? bad.message : '', /允许：conventions、architecture、commands、pitfalls、workflow、host/)
})

test('r23 路由：关键词按 priority 小者先命中（失败先于命令、命令先于 ui）', () => {
  const r1 = routeTopic({ track: 'project', text: 'pnpm build 失败' })
  assert.equal(r1.ok && r1.topic, 'pitfalls', '失败教训优先级高于命令')
  const r2 = routeTopic({ track: 'project', text: 'pnpm 面板' })
  assert.equal(r2.ok && r2.topic, 'commands', 'commands priority 2 先于 ui 3')
})

test('r23 路由：更具体关键词优先——「依赖方向」不被 commands 的「依赖」遮蔽（D1 回归）', () => {
  // 改回「只按主题 priority 先命中」的实现时这条会红：commands(2) 的「依赖」会先吃掉它。
  const direction = routeTopic({ track: 'project', text: '模块依赖方向铁律' })
  assert.equal(direction.ok && direction.topic, 'architecture', 'DESIGN §5.3：依赖方向 应命中 architecture')
  // 不能靠删掉 commands 的「依赖」关键词过关：没有更长词可让位时它仍按 commands 路由。
  const bare = routeTopic({ track: 'project', text: '依赖' })
  assert.equal(bare.ok && bare.topic, 'commands')
  const install = routeTopic({ track: 'project', text: '安装依赖' })
  assert.equal(install.ok && install.topic, 'commands')
  // 无包含关系时 priority 仍是唯一裁判（失败 1 先于 pnpm commands 2）。
  const failed = routeTopic({ track: 'project', text: 'pnpm build 失败' })
  assert.equal(failed.ok && failed.topic, 'pitfalls')
})

/* ───────────────────────────── 规范化 / 判重 ───────────────────────────── */

test('r23 判重：大小写/全角标点/空白/列表标记归一后 hash 相同，来源与时间不参与', () => {
  const variants = [
    '模块 依赖方向铁律。',
    '- 模块 依赖方向铁律！',
    '  模块    依赖方向铁律，',
    '模块　依赖方向铁律．',
    '模块 依赖方向铁律',
  ]
  const hashes = new Set(variants.map((text) => entryHash(text)))
  assert.equal(hashes.size, 1, `归一后必须同一 hash，实际 ${[...hashes].join(', ')}`)
  assert.equal(normalizeEntryText('A  B。'), normalizeEntryText('a b'))
  // 不同的语义文本不能误合并
  assert.notEqual(entryHash('模块依赖方向'), entryHash('模块依赖方向铁律'))
})

test('r23 判重：ID 形状 mem://<track>/<stem>#<hash12>，同文本跨文件同 ID', () => {
  assert.equal(entryIdOf('project', 'pitfalls', '失败 x'), `mem://project/pitfalls#${entryHash('失败 x').slice(0, 12)}`)
  assert.match(entryIdOf('public', 'workflow', '需求变更'), /^mem:\/\/public\/workflow#[0-9a-f]{12}$/)
})

/* ───────────────────────────── 解析 / 渲染逐字格式 ───────────────────────────── */

test('r23 渲染逐字：活动条目行格式固定，来源/时间/修正次数逐字', () => {
  const body = renderEntryFile('pitfalls', [
    entryOf({ text: '门禁 pnpm test 失败，退出码 1', level: 'P1', source: '系统', revisions: 2, at: NOW }),
  ])
  assert.equal(
    body,
    '# 失败与教训\n\n- [P1] 门禁 pnpm test 失败，退出码 1（来源：系统 · 11-10 17:20 · 修正 2）\n',
  )
})

test('r23 渲染 + 解析往返：等级/正文/来源/时间/修正次数/作废状态逐字段一致', () => {
  const entries = [
    entryOf({ text: 'P0 铁律', level: 'P0', source: '队长', revisions: 3, at: NOW, lineIndex: 0 }),
    entryOf({ text: 'P1 教训', level: 'P1', source: '系统', revisions: 2, at: NOW - 60_000, lineIndex: 1 }),
    entryOf({ text: 'P2 命令', level: 'P2', source: '队长', revisions: 1, at: NOW - 120_000, lineIndex: 2 }),
    entryOf({ text: '已作废', level: 'P1', source: '系统', revisions: 4, at: NOW - 180_000, lineIndex: 3, superseded: true }),
  ]
  const text = renderEntryFile('pitfalls', entries)
  assert.equal(text.match(/## 已作废/g)?.length, 1)
  const parsed = parseEntryFile(text, { track: 'project', file: 'pitfalls.md', now: NOW, fallbackAt: NOW })
  assert.equal(parsed.counts.formatted, 4)
  assert.equal(parsed.entries.length, 4)
  for (const expected of entries) {
    const actual = parsed.entries.find((entry) => entry.hash === expected.hash)
    assert.ok(actual, `往返后必须还能按 hash 找到「${expected.text}」`)
    assert.deepEqual(
      {
        level: actual.level,
        text: actual.text,
        source: actual.source,
        at: actual.at,
        revisions: actual.revisions,
        superseded: actual.superseded,
        topic: actual.topic,
        canonical: actual.canonical,
      },
      {
        level: expected.level,
        text: expected.text,
        source: expected.source,
        at: expected.at,
        revisions: expected.revisions,
        superseded: expected.superseded,
        topic: 'pitfalls',
        canonical: true,
      },
    )
  }
})

test('r23 渲染：活动条目按等级降序→at 降序，tombstone 单独成段且不计入活动行', () => {
  const text = renderEntryFile('pitfalls', [
    entryOf({ text: '旧 P2', level: 'P2', at: NOW - 10_000 }),
    entryOf({ text: '新 P1', level: 'P1', at: NOW }),
    entryOf({ text: '铁律', level: 'P0', at: NOW - 20_000 }),
    entryOf({ text: '作废条', level: 'P1', at: NOW - 30_000, superseded: true }),
  ])
  const lines = text.trimEnd().split('\n')
  assert.equal(lines[0], '# 失败与教训')
  assert.equal(lines[2], '- [P0] 铁律（来源：系统 · 11-10 17:19 · 修正 1）')
  assert.equal(lines[3], '- [P1] 新 P1（来源：系统 · 11-10 17:20 · 修正 1）')
  assert.equal(lines[4], '- [P2] 旧 P2（来源：系统 · 11-10 17:19 · 修正 1）')
  assert.equal(lines[5], '')
  assert.equal(lines[6], '## 已作废')
  assert.equal(lines[7], '- ~~[P1] 作废条（来源：系统 · 11-10 17:19 · 修正 1）~~')
  assert.equal(text.endsWith('\n'), true)
  assert.equal(text.endsWith('\n\n'), false, '文件末尾只允许一个换行')
})

test('r23 解析：旧手写 md 的 `- [来源 · MM-DD HH:mm] 正文` 按 P1 解析且来源保留', () => {
  const text = '# 旧笔记\n\n- [pm/t2 · 11-06 08:00] 旧手写来源\n- [队长 · 12-31 23:59] 跨年行\n'
  const parsed = parseEntryFile(text, { track: 'project', file: 'pitfalls.md', now: NOW, fallbackAt: NOW })
  assert.equal(parsed.counts.legacySourced, 2)
  const first = parsed.entries[0]
  assert.equal(first.level, 'P1')
  assert.equal(first.text, '旧手写来源')
  assert.equal(first.source, 'pm/t2')
  assert.equal(first.revisions, 1)
  assert.equal(first.superseded, false)
})

test('r23 解析：不合格式的行按 P1 兼容保留，绝不丢内容（含非法等级/非法时间/带后缀的怪行）', () => {
  const text = [
    '# 手写',
    '',
    '- [P9] 非法等级',
    '- [P1] 非法时间（来源：系统 · 13-45 88:99 · 修正 1）',
    '- 裸手写一行',
    '* 星号列表行',
    '普通段落行，不是列表',
    '',
  ].join('\n')
  const parsed = parseEntryFile(text, { track: 'project', file: 'pitfalls.md', now: NOW, fallbackAt: NOW })
  assert.equal(parsed.counts.compat, 5)
  const texts = parsed.entries.map((entry) => entry.text)
  assert.deepEqual(texts, [
    '[P9] 非法等级',
    '[P1] 非法时间（来源：系统 · 13-45 88:99 · 修正 1）',
    '裸手写一行',
    '星号列表行',
    '普通段落行，不是列表',
  ])
  for (const entry of parsed.entries) {
    assert.equal(entry.level, 'P1', '兼容行一律 P1')
    assert.equal(entry.source, '手写')
    assert.equal(entry.at, NOW, '兼容行用 fallbackAt')
  }
})

test('r23 解析：结构行（标题/围栏/分隔线/空行）不计条目；`## 已作废` 之后的条目为 superseded', () => {
  const text = [
    '# 标题',
    '',
    '```text',
    '```',
    '---',
    '- [P1] 活动条目（来源：系统 · 11-10 17:20 · 修正 1）',
    '',
    '## 已作废',
    '- [P1] 作废（来源：系统 · 11-10 17:19 · 修正 1）',
    '## 其他标题',
    '- 标题之后的兼容行也是作废区',
  ].join('\n')
  const parsed = parseEntryFile(text, { track: 'project', file: 'pitfalls.md', now: NOW, fallbackAt: NOW })
  assert.equal(parsed.entries.length, 3)
  assert.equal(parsed.entries[0].superseded, false)
  assert.equal(parsed.entries[1].superseded, true)
  assert.equal(parsed.entries[2].superseded, true, '进入作废段后不再有活动条目')
  assert.equal(parsed.counts.formatted, 2)
  assert.equal(parsed.counts.compat, 1)
})

test('r23 渲染：tombstone 每文件最多 20 条，按 at 新者优先保留', () => {
  const tombstones = Array.from({ length: 25 }, (_, index) =>
    entryOf({ text: `作废${index}`, level: 'P1', at: NOW - index * 1000, superseded: true, lineIndex: index }),
  )
  const text = renderEntryFile('pitfalls', tombstones)
  const rendered = text.split('\n').filter((line) => line.startsWith('- ~~'))
  assert.equal(rendered.length, 20)
  assert.match(text, /作废0/, '最新（at 最大）必须保留')
  assert.match(text, /作废19/, '第 20 新必须保留')
  assert.doesNotMatch(text, /作废2[0-9]/, '更旧的 5 条被截掉')
})

/* ───────────────────────────── upsert / 判重计数 ───────────────────────────── */

test('r23 upsert：新条目 added=1 / revisions=1；同文本（标点归一）再写 added=0、updated=1、revisions+1', () => {
  const first = upsertEntry([], draftOf({ text: '门禁 pnpm test 失败', level: 'P1', source: '系统' }), {
    maxPerFile: 40,
  })
  assert.equal(first.ok, true)
  assert.equal(first.ok && first.added, 1)
  assert.equal(first.ok && first.updated, 0)
  assert.equal(first.ok && first.touched[0].revisions, 1)

  const second = upsertEntry(first.ok ? first.entries : [], draftOf({ text: '门禁  pnpm test 失败。', level: 'P0', source: '队长', at: NOW + 1000 }), {
    maxPerFile: 40,
  })
  assert.equal(second.ok, true)
  assert.equal(second.ok && second.added, 0, '同 hash 不得重复新增')
  assert.equal(second.ok && second.updated, 1)
  assert.equal(second.ok && second.revived, 0)
  const active = second.ok ? second.entries.filter((entry) => !entry.superseded) : []
  assert.equal(active.length, 1)
  assert.equal(active[0].revisions, 2, '修正次数 +1')
  assert.equal(active[0].level, 'P0', '等级取较高者')
  assert.equal(active[0].source, '队长', '来源用最新一次')
  assert.equal(active[0].text, '门禁  pnpm test 失败。', '正文用最新一次（保留 incoming 原文）')
  assert.equal(active[0].hash, entryHash('门禁 pnpm test 失败'), 'hash 身份不随来源/等级变化')
})

test('r23 upsert：正文超 500 字截为 499+`…`，hash 基于截断后文本', () => {
  const long = '长'.repeat(501)
  const outcome = upsertEntry([], draftOf({ text: long, level: 'P1' }), { maxPerFile: 40 })
  assert.equal(outcome.ok, true)
  const entry = outcome.ok ? outcome.touched[0] : null
  assert.equal(entry?.text.length, 500)
  assert.equal(entry?.text, `${'长'.repeat(499)}…`)
  assert.equal(entry?.hash, entryHash(`${'长'.repeat(499)}…`))
})

test('r23 upsert：空正文 / 自带来源后缀 / 非法来源 → BAD_TEXT；公共轨显式 ui → BAD_TOPIC', () => {
  const empty = upsertEntry([], draftOf({ text: '   ' }), { maxPerFile: 40 })
  assert.equal(empty.ok, false)
  assert.equal(!empty.ok && empty.code, 'BAD_TEXT')

  const suffix = upsertEntry([], draftOf({ text: '正文（来源：系统 · 11-10 17:20 · 修正 1）' }), { maxPerFile: 40 })
  assert.equal(suffix.ok, false)
  assert.match(!suffix.ok ? suffix.message : '', /不能自带来源后缀/)

  const badSource = upsertEntry([], draftOf({ text: '正文', source: '系 统' }), { maxPerFile: 40 })
  assert.equal(badSource.ok, false)

  const badTopic = upsertEntry([], draftOf({ text: '面板布局', track: 'public', topic: 'ui' }), { maxPerFile: 40 })
  assert.equal(badTopic.ok, false)
  assert.equal(!badTopic.ok && badTopic.code, 'BAD_TOPIC')
})

test('r23 upsert：misc（非主题文件）里的同 hash 条目是只读碰撞，不合并、不改写', () => {
  const loose = entryOf({ file: 'notes.md', topic: null, canonical: false, text: '散落笔记' })
  const outcome = upsertEntry([loose], draftOf({ text: '散落笔记' }), { maxPerFile: 40 })
  assert.equal(outcome.ok, false)
  assert.equal(!outcome.ok && outcome.code, 'MEMORY_READONLY_COLLISION')
})

/* ───────────────────────────── 淘汰顺序 / 硬上限 ───────────────────────────── */

function fill(level: 'P0' | 'P1' | 'P2', count: number, offset: number): ParsedEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entryOf({ text: `条目${offset + index}`, level, at: NOW - (offset + index) * 1000, lineIndex: offset + index }),
  )
}

test('r23 淘汰：40 条满时先淘汰最旧 P2（即使有更旧的 P1）；P0 不动', () => {
  const entries = [...fill('P0', 2, 0), ...fill('P1', 18, 10), ...fill('P2', 20, 30)]
  const newestP2 = entries.filter((entry) => entry.level === 'P2').sort((a, b) => b.at - a.at)[0]
  const outcome = upsertEntry(entries, draftOf({ text: '新失败教训', level: 'P2', topic: 'pitfalls' }), { maxPerFile: 40 })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.ok && outcome.evicted.length, 1)
  assert.equal(outcome.ok && outcome.evicted[0].level, 'P2')
  assert.notEqual(outcome.ok && outcome.evicted[0].text, newestP2.text, '淘汰的是 P2 里最旧的，不是最新')
  const active = outcome.ok ? outcome.entries.filter((entry) => !entry.superseded) : []
  assert.equal(active.length, 40, '活动条目硬上限 40')
  assert.equal(active.filter((entry) => entry.level === 'P0').length, 2, 'P0 不动')
})

test('r23 淘汰：P2 耗尽后淘汰最旧 P1；incoming 是 P0 也照样淘汰 P2', () => {
  const p1Only = [...fill('P0', 1, 0), ...fill('P1', 39, 10)]
  const outcome = upsertEntry(p1Only, draftOf({ text: '新失败教训', level: 'P1', topic: 'pitfalls' }), {
    maxPerFile: 40,
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.ok && outcome.evicted[0]?.level, 'P1')

  const mixed = [...fill('P0', 1, 0), ...fill('P1', 19, 10), ...fill('P2', 20, 30)]
  const p0Incoming = upsertEntry(mixed, draftOf({ text: '新铁律', level: 'P0', topic: 'pitfalls' }), {
    maxPerFile: 40,
  })
  assert.equal(p0Incoming.ok, true)
  assert.equal(p0Incoming.ok && p0Incoming.evicted[0]?.level, 'P2')
})

test('r23 淘汰：全 40 条 P0 → MEMORY_QUOTA_FULL，文案逐字且不落任何改动', () => {
  const p0 = fill('P0', 40, 0)
  const before = JSON.stringify(p0)
  const outcome = upsertEntry(p0, draftOf({ text: '新的失败教训', level: 'P1', topic: 'pitfalls' }), {
    maxPerFile: 40,
  })
  assert.equal(outcome.ok, false)
  assert.equal(!outcome.ok && outcome.code, 'MEMORY_QUOTA_FULL')
  assert.equal(
    !outcome.ok ? outcome.message : '',
    '「pitfalls.md」已有 40 条且全部为 P0（P0 不淘汰）：请先手工删除或降级一条 P0 再写入',
  )
  assert.equal(JSON.stringify(p0), before, '失败不得改动入参')
})

test('r23 上限：tombstone 不计入 40 条活动上限，也不会被新增挤掉', () => {
  const tombstones = Array.from({ length: 20 }, (_, index) =>
    entryOf({ text: `作废${index}`, level: 'P1', at: NOW - index * 1000, superseded: true, lineIndex: index }),
  )
  const active = fill('P1', 39, 100)
  const entries = [...active, ...tombstones]
  const outcome = upsertEntry(entries, draftOf({ text: '第 40 条失败', level: 'P1', topic: 'pitfalls' }), {
    maxPerFile: 40,
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.ok && outcome.evicted.length, 0, '40 = 39 活动 + 1，不需要淘汰')
  assert.equal(outcome.ok ? outcome.entries.filter((entry) => entry.superseded).length : 0, 20)
})

/* ───────────────────────────── supersede ───────────────────────────── */

test('r23 supersede：旧条目置 tombstone、新条目 revisions=旧+1、等级取 max，返回被取代条目', () => {
  const old = entryOf({ text: '旧做法', level: 'P2', revisions: 2 })
  const outcome = supersedeEntry([old], '旧做法', draftOf({ text: '新做法', level: 'P0', source: '队长', at: NOW + 5000 }), {
    maxPerFile: 40,
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.ok && outcome.added, 1)
  assert.equal(outcome.ok && outcome.superseded.length, 1)
  const entries = outcome.ok ? outcome.entries : []
  const tomb = entries.find((entry) => entry.superseded)
  const fresh = entries.find((entry) => !entry.superseded)
  assert.equal(tomb?.hash, old.hash)
  assert.equal(fresh?.revisions, 3)
  assert.equal(fresh?.level, 'P0')
  assert.equal(fresh?.source, '队长')
})

test('r23 supersede：目标不存在 / 已作废 / 新 hash 已存在 / misc 只读 各有明确错误码', () => {
  const missing = supersedeEntry([], '不存在', draftOf({ text: '新做法' }), { maxPerFile: 40 })
  assert.equal(!missing.ok && missing.code, 'SUPERSEDE_NOT_FOUND')

  const already = supersedeEntry([entryOf({ text: '旧做法', superseded: true })], '旧做法', draftOf({ text: '新做法' }), {
    maxPerFile: 40,
  })
  assert.equal(!already.ok && already.code, 'SUPERSEDE_NOT_FOUND')
  assert.match(!already.ok ? already.message : '', /目标已作废/)

  const duplicate = supersedeEntry([entryOf({ text: '旧做法' }), entryOf({ text: '新做法' })], '旧做法', draftOf({ text: '新做法' }), {
    maxPerFile: 40,
  })
  assert.equal(!duplicate.ok && duplicate.code, 'SUPERSEDE_DUPLICATE')

  const readonly = supersedeEntry(
    [entryOf({ file: 'notes.md', topic: null, canonical: false, text: '旧做法' })],
    '旧做法',
    draftOf({ text: '新做法' }),
    { maxPerFile: 40 },
  )
  assert.equal(!readonly.ok && readonly.code, 'SUPERSEDE_LEGACY_READONLY')
})

test('r23 supersede：跨文件且目标文件已满且无可淘汰 → 整体拒绝（原子：不留下 tombstone）', () => {
  const target = entryOf({ text: '旧做法', level: 'P0', file: 'architecture.md', topic: 'architecture', revisions: 1 })
  const fillers = Array.from({ length: 40 }, (_, index) =>
    entryOf({ text: `满${index}`, level: 'P0', file: 'pitfalls.md', topic: 'pitfalls', at: NOW - index * 1000, lineIndex: index }),
  )
  const entries = [target, ...fillers]
  const outcome = supersedeEntry(entries, '旧做法', draftOf({ text: '新坑做法', level: 'P1', topic: 'pitfalls' }), {
    maxPerFile: 40,
  })
  assert.equal(outcome.ok, false, '目标文件 40 条全 P0，新条目无处落盘')
  assert.equal(!outcome.ok && outcome.code, 'MEMORY_QUOTA_FULL')
  assert.equal(entries.find((entry) => entry.hash === target.hash)?.superseded, false, '入参里不得留下 tombstone')
})

test('r23 applyMemoryMutation：无 supersedes 走 upsert，有 supersedes 走 supersede', () => {
  const added = applyMemoryMutation([], draftOf({ text: '新失败教训', level: 'P1' }), { maxPerFile: 40 })
  assert.equal(added.ok && added.added, 1)

  const base = upsertEntry([], draftOf({ text: '旧做法', level: 'P1' }), { maxPerFile: 40 })
  const replaced = applyMemoryMutation(base.ok ? base.entries : [], draftOf({ text: '新做法', level: 'P1', supersedes: '旧做法' }), {
    maxPerFile: 40,
  })
  assert.equal(replaced.ok && replaced.added, 1)
  assert.equal(replaced.ok && replaced.superseded.length, 1)
})
