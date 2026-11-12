/**
 * r23 `auto_team_memory` 工具契约：新参数（importance / topic / supersedes）、结构化返回、
 * 条目 ID expand、整理命令（dry-run 缺省 true）与错误码。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridge, type Bridge } from '../src/host/bridge.ts'
import { createRoleRepo } from '../src/host/roles/repo.ts'
import { RunsStore } from '../src/host/store.ts'
import { buildToolSpecs } from '../src/host/tools.ts'
import { createExpander } from '../src/host/memory/expand.ts'
import type { MemoryRoots } from '../src/host/memory/repo.ts'
import { parseEntryFile } from '../src/host/memory/entries.ts'
import type { ToolSpec } from '../src/host/adapters.ts'

const NOW = new Date(2026, 10, 10, 17, 20).getTime()
const SESSION = 'sess-r23-tool'

interface Harness {
  dir: string
  roots: MemoryRoots
  bridge: Bridge
  call: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
  tool: ToolSpec
}

function makeHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'r23-tool-'))
  const roots: MemoryRoots = { publicDir: join(dir, 'public'), projectDir: join(dir, 'project') }
  mkdirSync(roots.projectDir, { recursive: true })
  mkdirSync(roots.publicDir, { recursive: true })
  const store = new RunsStore(join(dir, 'runs'))
  const roles = createRoleRepo({ dir: join(dir, 'roles'), now: () => NOW })
  roles.seed()
  const expander = createExpander({ roots })
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
    expander: (id, depth) => expander.expand(id, depth ?? 1),
  })
  bridge.setEnabled(SESSION, true)
  const specs = buildToolSpecs({ store, roles, bridge, now: () => NOW })
  const tool = specs.find((spec) => spec.name === 'auto_team_memory')
  assert.ok(tool, 'auto_team_memory 必须注册')
  return {
    dir,
    roots,
    bridge,
    tool,
    call: (args) =>
      tool.handler(args, { agent: { id: SESSION }, callId: 'call-r23', name: 'auto_team_memory' } as never) as Promise<Record<string, unknown>>,
  }
}

function withHarness(fn: (harness: Harness) => Promise<void>): () => Promise<void> {
  return async () => {
    const harness = makeHarness()
    try {
      await fn(harness)
    } finally {
      rmSync(harness.dir, { recursive: true, force: true })
    }
  }
}

test('r23 工具 list：空记忆返回配额（project 8 / public 6、每文件 40）与 legacyFileCount', withHarness(async ({ call, tool }) => {
  assert.deepEqual(tool.parameters?.required, ['action'])
  const list = await call({ action: 'list' })
  assert.equal(list.ok, true)
  assert.equal(list.budget, 4000)
  assert.deepEqual(list.files, [])
  const quotas = list.quotas as Record<string, Record<string, number>>
  assert.equal(quotas.project.maxFiles, 8)
  assert.equal(quotas.public.maxFiles, 6)
  assert.equal(quotas.project.maxEntriesPerFile, 40)
  assert.equal(list.legacyFileCount, 0)
  assert.equal(typeof list.projectDir, 'string')
}))

test('r23 工具 write：importance / topic 生效；同文本再写只加修正次数并升级等级（结构化返回）', withHarness(async ({ call }) => {
  const first = await call({ action: 'write', text: '门禁 pnpm test 失败', importance: 'P1', topic: 'pitfalls' })
  assert.equal(first.ok, true)
  assert.equal(first.written, 1)
  assert.equal(first.added, 1)
  assert.equal(first.updated, 0)
  assert.deepEqual(first.topics, ['pitfalls'])
  const firstEntry = (first.entries as Array<Record<string, unknown>>)[0]
  assert.equal(firstEntry.level, 'P1')
  assert.equal(firstEntry.source, '队长')
  assert.equal(firstEntry.revisions, 1)
  assert.match(String(firstEntry.id), /^mem:\/\/project\/pitfalls#[0-9a-f]{12}$/)

  const second = await call({ action: 'write', text: '门禁  pnpm test 失败。', importance: 'P0', topic: 'pitfalls' })
  assert.equal(second.added, 0)
  assert.equal(second.updated, 1)
  const secondEntry = (second.entries as Array<Record<string, unknown>>)[0]
  assert.equal(secondEntry.id, firstEntry.id, 'ID 不随等级/修正次数变化')
  assert.equal(secondEntry.level, 'P0')
  assert.equal(secondEntry.revisions, 2)

  const read = await call({ action: 'read', name: 'pitfalls' })
  assert.equal(read.ok, true)
  assert.equal(read.name, 'pitfalls.md')
  const file = read.file as Record<string, unknown>
  assert.equal((file.levels as Record<string, number>).P0, 1)
  const entries = read.entries as Array<Record<string, unknown>>
  assert.equal(entries.length, 1)
  assert.equal(entries[0].superseded, false)
}))

test('r23 工具 write：缺省 importance=P2；多行拆条跳过结构行，最多 20 条并标 truncated', withHarness(async ({ call }) => {
  const single = await call({ action: 'write', text: '普通一行' })
  assert.equal((single.entries as Array<Record<string, unknown>>)[0].level, 'P2')

  const lines = ['# 标题', '', '```', '- 围栏里的行', '```', '---', ...Array.from({ length: 25 }, (_, index) => `- 第${index}条`)]
  const many = await call({ action: 'write', text: lines.join('\n') })
  assert.equal(many.written, 20)
  assert.equal(many.truncated, true)
}))

test('r23 工具 write：参数错误各有明确错误码（空正文/importance/text+body/主题冲突/公共轨 ui）', withHarness(async ({ call }) => {
  const empty = await call({ action: 'write', text: '   ' })
  assert.equal(empty.ok, false)
  assert.equal(empty.code, 'BAD_TEXT')

  const importance = await call({ action: 'write', text: '正文', importance: 'P9' })
  assert.equal(importance.code, 'BAD_REQUEST')

  const both = await call({ action: 'write', text: 'a', body: 'b' })
  assert.equal(both.code, 'BAD_REQUEST')
  assert.match(String(both.error), /text 与 body 只能给一个/)

  const conflict = await call({ action: 'write', text: '正文', name: 'pitfalls', topic: 'commands' })
  assert.equal(conflict.code, 'BAD_TOPIC')

  const publicUi = await call({ action: 'write', track: 'public', topic: 'ui', text: '面板布局' })
  assert.equal(publicUi.code, 'BAD_TOPIC')
  assert.match(String(publicUi.error), /允许：conventions、architecture、commands、pitfalls、workflow、host/)
}))

test('r23 工具 write supersedes：旧条目转 tombstone、新条目 revisions+1；多条正文配 supersedes → BAD_REQUEST', withHarness(async ({ call }) => {
  await call({ action: 'write', text: '旧做法', importance: 'P1', topic: 'pitfalls' })
  const replaced = await call({ action: 'write', text: '新做法', importance: 'P0', topic: 'pitfalls', supersedes: '旧做法' })
  assert.equal(replaced.ok, true)
  assert.equal(replaced.added, 1)
  assert.equal(replaced.superseded, 1)
  const fresh = (replaced.entries as Array<Record<string, unknown>>)[0]
  assert.equal(fresh.level, 'P0')
  assert.equal(fresh.revisions, 2)

  const read = await call({ action: 'read', name: 'pitfalls' })
  const entries = read.entries as Array<Record<string, unknown>>
  assert.equal(entries.filter((entry) => entry.superseded === true).length, 1)
  assert.equal(entries.find((entry) => entry.superseded === true)?.text, '旧做法')

  const multi = await call({ action: 'write', text: '新一\n新二', supersedes: '旧做法' })
  assert.equal(multi.code, 'BAD_REQUEST')
  assert.match(String(multi.error), /supersedes 只能配一条正文/)
}))

test('r23 工具 expand：条目 ID 回填 level/revisions/source/at（活动行与 `~~[P1]` 作废包裹都认）', withHarness(async ({ call }) => {
  const written = await call({ action: 'write', text: '要展开的失败教训', importance: 'P1', topic: 'pitfalls' })
  const id = (written.entries as Array<Record<string, unknown>>)[0].id as string
  const expanded = await call({ action: 'expand', id })
  assert.equal(expanded.ok, true)
  assert.equal(expanded.code, 'OK')
  assert.equal(expanded.id, id)
  assert.equal(expanded.track, 'project')
  assert.match(String(expanded.body), /^- \[P1\] 要展开的失败教训/)
  // DESIGN §13.3：条目级 ID 展开必须回填四个结构化字段。D2 的 `[P012]` 字符类写法
  // 认不出字面 `[P1]`，这四个字段会恒缺失——改回旧正则可复现变红。
  assert.equal(expanded.level, 'P1')
  assert.equal(expanded.revisions, 1)
  assert.equal(expanded.source, '队长')
  assert.equal(expanded.at, NOW)

  // 作废条目的正文是 `- ~~[P2] …~~`，同样要回填四字段（旧判据只认行首 `~~`，不看里面的等级）。
  const old = await call({ action: 'write', text: '被取代的旧教训', importance: 'P2', topic: 'pitfalls' })
  const oldId = (old.entries as Array<Record<string, unknown>>)[0].id as string
  await call({ action: 'write', text: '取代后的新教训', importance: 'P1', topic: 'pitfalls', supersedes: '被取代的旧教训' })
  const tombstone = await call({ action: 'expand', id: oldId })
  assert.equal(tombstone.code, 'OK')
  assert.match(String(tombstone.body), /^- ~~\[P2\] 被取代的旧教训/)
  assert.equal(tombstone.level, 'P2')
  assert.equal(tombstone.revisions, 1)
  assert.equal(tombstone.source, '队长')
  assert.equal(tombstone.at, NOW)

  const missing = await call({ action: 'expand', id: 'mem://project/pitfalls#000000000000' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'EXPAND_NOT_FOUND')
  assert.match(String(missing.message), /条目已不存在（可能被整理或淘汰）：mem:\/\/project\/pitfalls#000000000000/)
}))

test('r23 工具 curate：dryRun 缺省 true（不写盘），显式 false 才写，第二次 added=0', withHarness(async ({ call, roots }) => {
  writeFileSync(join(roots.projectDir, 'run-legacy.md'), '# run\n\n## 失败与教训\n- 旧流水教训\n')
  const dry = await call({ action: 'curate' })
  assert.equal(dry.ok, true)
  const dryReport = dry.report as Record<string, unknown>
  assert.equal(dryReport.dryRun, true)
  assert.equal(dryReport.added, 1)
  assert.equal(existsSync(join(roots.projectDir, 'pitfalls.md')), false, 'dry-run 不得落盘')

  const real = await call({ action: 'curate', dryRun: false })
  assert.equal((real.report as Record<string, unknown>).added, 1)
  const body = readFileSync(join(roots.projectDir, 'pitfalls.md'), 'utf8')
  const parsed = parseEntryFile(body, { track: 'project', file: 'pitfalls.md', now: NOW, fallbackAt: NOW })
  assert.equal(parsed.entries[0].text, '旧流水教训')
  assert.equal(parsed.entries[0].level, 'P1')

  const again = await call({ action: 'curate', dryRun: false })
  assert.equal((again.report as Record<string, unknown>).added, 0)
  assert.equal((again.report as Record<string, unknown>).skippedExisting, 1)
}))

test('r23 工具 list：写满 8 个主题文件后配额报 files=8、legacy 仍单独计数', withHarness(async ({ call, roots }) => {
  const topics = ['conventions', 'architecture', 'commands', 'pitfalls', 'workflow', 'ui', 'host', 'domain']
  for (const topic of topics) {
    const result = await call({ action: 'write', text: `${topic} 的条目`, topic })
    assert.equal(result.ok, true, `${topic} 写入失败：${JSON.stringify(result)}`)
  }
  writeFileSync(join(roots.projectDir, 'run-x.md'), '# run\n\n- 旧流水\n')
  const list = await call({ action: 'list' })
  const quotas = list.quotas as Record<string, Record<string, unknown>>
  assert.equal(quotas.project.files, 8)
  assert.equal(list.legacyFileCount, 1)
  assert.equal((list.files as unknown[]).length, 8, 'legacy 不进 files 列表')
}))
