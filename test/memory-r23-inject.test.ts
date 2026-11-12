/**
 * r23 注入与仓库层（repo.ts + inject.ts）：条目级选择、P0 优先、作废不注入、
 * 旧 run-*.md / lessons-*.md 永不注入且不计配额，文件数与条目数硬上限暴露给面板。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  listMemoryViews,
  quotaOf,
  readMemoryEntries,
  writeMemoryFile,
  type MemoryRoots,
} from '../src/host/memory/repo.ts'
import { entryHash, evictForInsert, type ParsedEntry } from '../src/host/memory/entries.ts'
import { selectMemoryEntries } from '../src/host/memory/inject.ts'
import { createBridge } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RunsStore } from '../src/host/store.ts'

const NOW = new Date(2026, 10, 10, 17, 20).getTime()

function tempRoots(): { dir: string; roots: MemoryRoots } {
  const dir = mkdtempSync(join(tmpdir(), 'r23-mem-'))
  return { dir, roots: { publicDir: join(dir, 'public'), projectDir: join(dir, 'project') } }
}

function entryOf(over: Partial<ParsedEntry> & Pick<ParsedEntry, 'text'>): ParsedEntry {
  return {
    track: 'project',
    file: 'conventions.md',
    topic: 'conventions',
    level: 'P2',
    source: '系统',
    at: NOW,
    revisions: 1,
    lineIndex: 0,
    hash: entryHash(over.text),
    canonical: true,
    superseded: false,
    ...over,
  }
}

/* ───────────────────────────── 仓库层 ───────────────────────────── */

test('r23 repo：旧 run-*.md / lessons-*.md 默认不解析、不进配额，只报 legacyFileCount', () => {
  const { dir, roots } = tempRoots()
  try {
    writeMemoryFile('project', 'pitfalls.md', [entryOf({ text: '失败教训', level: 'P1', topic: 'pitfalls', file: 'pitfalls.md' })], roots)
    writeFileSync(join(roots.projectDir, 'run-abc123.md'), '# run\n\n## 失败与教训\n- 流水证据\n', 'utf8')
    writeFileSync(join(roots.projectDir, 'lessons-abc123.md'), '# lessons\n\n- 失败模式：旧公共教训\n', 'utf8')

    const views = listMemoryViews('project', roots, { now: NOW })
    assert.deepEqual(views.map((view) => view.name), ['pitfalls.md'], 'legacy 文件被排除')
    assert.equal(views[0].entries, 1)
    assert.equal(views[0].levels.P1, 1)

    const legacy = listMemoryViews('project', roots, { now: NOW, includeLegacy: true })
    assert.equal(legacy.length, 3, '显式 includeLegacy 时才可见（面板 legacyFileCount 另行统计）')

    const quota = quotaOf('project', views)
    assert.equal(quota.files, 1, 'legacy 不计文件数')
    assert.equal(quota.totalEntries, 1, 'legacy 不计条目数')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('r23 repo：配额上限 project 8 / public 6、每文件 40，near/over/full 标记可读', () => {
  const { dir, roots } = tempRoots()
  try {
    assert.equal(quotaOf('project', []).maxFiles, 8)
    assert.equal(quotaOf('public', []).maxFiles, 6)
    assert.equal(quotaOf('project', []).maxEntriesPerFile, 40)
    const views = listMemoryViews('project', roots, { now: NOW })
    const quota = quotaOf('project', views)
    assert.equal(quota.nearFiles, false)
    assert.equal(quota.overFiles, false)

    // 8 个主题文件都写 1 条 → 达到文件上限（nearFiles=true, overFiles=false）
    const topics = ['conventions', 'architecture', 'commands', 'pitfalls', 'workflow', 'ui', 'host', 'domain'] as const
    for (const topic of topics) {
      writeMemoryFile('project', `${topic}.md`, [entryOf({ text: `${topic} 内容`, file: `${topic}.md`, topic })], roots)
    }
    const full = quotaOf('project', listMemoryViews('project', roots, { now: NOW }))
    assert.equal(full.files, 8)
    assert.equal(full.nearFiles, true, '到上限即提示接近')
    assert.equal(full.overFiles, false)

    // 每文件 36 条 → nearFull；40 条 → full
    const many = Array.from({ length: 36 }, (_, index) =>
      entryOf({ text: `条目${index}`, at: NOW - index * 1000, lineIndex: index }),
    )
    writeMemoryFile('project', 'conventions.md', many, roots)
    const near = quotaOf('project', listMemoryViews('project', roots, { now: NOW }))
    assert.deepEqual(near.nearFullFiles, ['conventions.md'])
    assert.deepEqual(near.fullFiles, [])

    writeMemoryFile('project', 'conventions.md', many.slice(0, 40).concat(Array.from({ length: 4 }, (_, index) => entryOf({ text: `补${index}`, at: NOW - (36 + index) * 1000, lineIndex: 36 + index }))), roots)
    const exact = quotaOf('project', listMemoryViews('project', roots, { now: NOW }))
    assert.deepEqual(exact.fullFiles, ['conventions.md'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('r23 repo：readMemoryEntries 返回解析结果与原文，非主题文件 canonical=false / readOnly=true', () => {
  const { dir, roots } = tempRoots()
  try {
    mkdirSync(roots.projectDir, { recursive: true })
    writeFileSync(join(roots.projectDir, 'notes.md'), '# notes\n\n- 散落\n', 'utf8')
    const detail = readMemoryEntries('project', 'notes.md', roots, NOW)
    assert.ok(detail)
    assert.equal(detail?.parsed.entries[0].text, '散落')
    assert.equal(detail?.parsed.entries[0].canonical, false)
    const view = listMemoryViews('project', roots, { now: NOW })[0]
    assert.equal(view.readOnly, true)
    assert.equal(view.canonical, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('r23 淘汰入口：evictForInsert 只动 P2/P1，P0 与 incoming 永不被选', () => {
  const entries = [
    entryOf({ text: 'P0', level: 'P0' }),
    entryOf({ text: 'P1 旧', level: 'P1', at: NOW - 10_000 }),
    entryOf({ text: 'P2 新', level: 'P2', at: NOW - 1000 }),
  ]
  const incoming = { track: 'project', text: '新的 P2', level: 'P2', source: '系统', at: NOW } as const
  const victims = evictForInsert(entries, incoming, 3)
  assert.equal(victims.ok, true)
  assert.equal(victims.ok && victims.evicted.length, 1)
  assert.equal(victims.ok && victims.evicted[0].text, 'P2 新')
  const roomy = evictForInsert(entries.slice(0, 2), incoming, 3)
  assert.equal(roomy.ok && roomy.evicted.length, 0, '未超限不淘汰')
})

/* ───────────────────────────── 条目级注入 ───────────────────────────── */

function candidates(): ParsedEntry[] {
  return [
    entryOf({ text: '门禁 pnpm test 失败，退出码 1', level: 'P1', file: 'pitfalls.md', topic: 'pitfalls', at: NOW - 5000 }),
    entryOf({ text: '面板字号必须用 font token', level: 'P2', file: 'ui.md', topic: 'ui', at: NOW - 1000 }),
    entryOf({ text: '铁律：不得改 src', level: 'P0', file: 'conventions.md', topic: 'conventions', at: NOW - 9000 }),
    entryOf({ text: '跨项目约定', level: 'P2', track: 'public', file: 'workflow.md', topic: 'workflow', at: NOW - 2000 }),
    entryOf({ text: '已作废的失败', level: 'P0', file: 'pitfalls.md', topic: 'pitfalls', at: NOW - 100, superseded: true }),
  ]
}

test('r23 注入：已作废条目永不出现；P0 优先于相关性最高的 P2', () => {
  const result = selectMemoryEntries('pnpm test 失败 面板', candidates(), 4000)
  assert.equal(result.entries.some((entry) => entry.id.includes(entryHash('已作废的失败').slice(0, 12))), false)
  assert.equal(result.entries.length, 4)
  assert.equal(result.entries[0].level, 'P0', '零相关的 P0 也排第一')
  assert.equal(result.entries[0].title.startsWith('P0'), true, '等级徽标始终可见')
  assert.equal(result.text.includes('已作废的失败'), false)
})

test('r23 注入：头部与行格式逐字（ID · 轨标签 · 等级正文 — 来源摘要 ⇄ 关联）', () => {
  const result = selectMemoryEntries('', [entryOf({ text: '铁律', level: 'P0', file: 'conventions.md', topic: 'conventions' })], 4000)
  assert.equal(result.text.split('\n')[0], '团队记忆索引（按 ID 用 auto_team_memory expand 展开全文）：')
  const line = result.text.split('\n')[1]
  assert.match(line, /^mem:\/\/project\/conventions#[0-9a-f]{12} · 项目记忆 · P0 铁律 — 来源：系统 · 11-10 17:20 · 修正 1$/u)
})

test('r23 注入：预算永不超过，放不下的进 omitted 并给出「另有 N 条未内联」尾行', () => {
  for (const budget of [4000, 500, 200, 60]) {
    const result = selectMemoryEntries('pnpm test 失败 面板', candidates(), budget)
    assert.equal(result.chars, result.text.length)
    assert.ok(result.chars <= budget, `budget=${budget} 时 chars=${result.chars} 越界`)
    assert.equal(result.entries.length + result.omitted.length, 4, '条目只会内联或 omitted，绝不静默丢弃')
    if (result.omitted.length > 0) {
      assert.equal(result.truncated, true)
      assert.match(result.text, /另有 \d+ 条未内联（可按 ID 展开）/)
    }
  }
  const tiny = selectMemoryEntries('', candidates(), 90)
  assert.ok(tiny.entries.length <= 1, '预算很小时最多放下一条')
  assert.equal(tiny.entries.length + tiny.omitted.length, 4)
  assert.ok(tiny.chars <= 90)
})

test('r23 注入：单行 ≤200 字符（长正文/长关联被收敛）', () => {
  const long = Array.from({ length: 8 }, (_, index) =>
    entryOf({ text: `很长的失败教训${index}${'补'.repeat(300)}`, level: 'P1', file: 'pitfalls.md', topic: 'pitfalls', at: NOW - index }),
  )
  const result = selectMemoryEntries('失败', long, 4000)
  for (const entry of result.entries) assert.ok(entry.chars <= 200, `单行 ${entry.chars} 越界`)
})

test('r23 注入：同 (track,hash) 去重，canonical 优先、revisions 大者优先', () => {
  const misc = entryOf({ text: '同一句', file: 'notes.md', topic: null, canonical: false, revisions: 9 })
  const canonical = entryOf({ text: '同一句', file: 'conventions.md', topic: 'conventions', revisions: 1 })
  const result = selectMemoryEntries('', [misc, canonical], 4000)
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].name, `conventions#${entryHash('同一句').slice(0, 12)}`)

  const low = entryOf({ text: '同一句', file: 'commands.md', topic: 'commands', revisions: 1 })
  const high = entryOf({ text: '同一句。', file: 'commands.md', topic: 'commands', revisions: 3 })
  const deduped = selectMemoryEntries('', [low, high], 4000)
  assert.equal(deduped.entries.length, 1)
  assert.equal(deduped.entries[0].revisions, 3)
})

test('r23 注入：同等级同相关性时项目轨先于公共轨；空 goal 退化为等级→项目→时间', () => {
  const project = entryOf({ text: '项目条目', level: 'P1', at: NOW - 10_000 })
  const publicEntry = entryOf({ text: '公共条目', track: 'public', file: 'workflow.md', topic: 'workflow', level: 'P1', at: NOW })
  const result = selectMemoryEntries('', [publicEntry, project], 4000)
  assert.equal(result.entries[0].track, 'project')

  const ordered = selectMemoryEntries(
    '',
    [
      entryOf({ text: '旧 P1', level: 'P1', at: NOW - 20_000 }),
      entryOf({ text: '新 P1', level: 'P1', at: NOW }),
      entryOf({ text: 'P2', level: 'P2', at: NOW + 1000 }),
    ],
    4000,
  )
  assert.deepEqual(ordered.entries.map((entry) => entry.level), ['P1', 'P1', 'P2'])
  assert.match(ordered.entries[0].summary, /11-10 17:20/, '同等级按 at 降序')
})

test('r23 注入：相关条目只给同轨、最多 3 个，且不含自己', () => {
  const entries = Array.from({ length: 5 }, (_, index) =>
    entryOf({ text: `失败教训${index}`, level: 'P1', file: 'pitfalls.md', topic: 'pitfalls', at: NOW - index }),
  )
  entries.push(entryOf({ text: '公共教训', track: 'public', level: 'P1', at: NOW }))
  const result = selectMemoryEntries('失败', entries, 4000)
  const first = result.entries[0]
  assert.ok(first.related.length <= 3)
  assert.equal(first.related.includes(first.id), false)
  for (const related of first.related) assert.match(related, /^mem:\/\/project\//, '公共轨关联不混入')
})

/* ───────────────────────────── bridge 集成：legacy 不进注入 ───────────────────────────── */

test('r23 bridge：snapshot.memory 的 files/quotas 排除 legacy，memoryFor 不包含旧流水正文', () => {
  const { dir, roots } = tempRoots()
  try {
    writeMemoryFile('project', 'pitfalls.md', [entryOf({ text: '真教训', level: 'P1', file: 'pitfalls.md', topic: 'pitfalls' })], roots)
    writeFileSync(join(roots.projectDir, 'run-old.md'), '# run\n\n## 失败与教训\n- 旧流水里的 P0\n', 'utf8')

    const store = new RunsStore(join(dir, 'runs'))
    const roles = createRoleRepo({ dir: join(dir, 'roles'), now: () => NOW })
    roles.seed()
    const bridge = createBridge({
      store,
      roles,
      memoryRoots: roots,
      dataRoot: join(dir, 'data'),
      dispatch: async () => ({ started: [], skipped: [], errors: [] }),
      resume: async () => ({ resumed: 0, skipped: 0, unchanged: true }),
      applyReceipt: (state) => state,
      sendMessage: async () => ({ ok: true }),
      gate: { cwd: dir, artifactsDir: join(dir, 'artifacts') },
      now: () => NOW,
    })
    const snapshot = bridge.snapshot('sess-r23')
    assert.equal(snapshot.memory?.legacyFileCount, 1)
    assert.deepEqual(snapshot.memory?.files.map((file) => file.name), ['pitfalls.md'])
    assert.equal(snapshot.memory?.quotas?.project.files, 1)

    const memory = bridge.memoryFor('失败 教训 旧流水 P0', 'sess-r23')
    assert.match(memory.text, /真教训/)
    assert.doesNotMatch(memory.text, /旧流水里的 P0/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
