/**
 * 记忆展开（Inline & Spill 的 Spill 半边）单测 —— AC-9 / AC-10。
 *
 * 断言的取向是「可分辨」而不是「看起来对」：
 *  - 正文一致用 **sha256 + Buffer 逐字节**双判（只断言 `includes('…')` 时，实现顺手 trim 一下也照样绿）；
 *  - 跳数上限断言到**第 3 跳的错误码**（只断言「2 跳成功」时，把上限删掉也绿）；
 *  - 路径逃逸分三组（相对上跳 / 绝对路径 / 家目录 + 分隔符）逐个断言错误码，
 *    并单独断言「合法 ID 不被误杀」——误杀是展开能力最可能的回归形态；
 *  - 「不抛异常」用敌意 ID 全量扫描来证明：一旦某条路径抛了，测试直接红在那一行。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MEMORY_EXPAND_MAX_CHARS, MEMORY_EXPAND_MAX_DEPTH, MEMORY_RELATED_MAX } from '../src/host/config.ts'
import { EXPAND_MESSAGES, createExpander, parseMemoryId, sha256Hex } from '../src/host/memory/expand.ts'
import type { MemoryRoots } from '../src/host/memory/repo.ts'

/* ────────────────────────── 夹具 ────────────────────────── */

// r23：文件级 ID 拼装已迁出 inject.ts（条目 ID 走 entries.entryIdOf）；
// 展开侧对「无 # 的整文件 ID」行为不变，这里保留同形 helper 作为同源判据。
function memoryIdOf(track: 'public' | 'project', name: string): string {
  return `mem://${track}/${name.replace(/\.md$/i, '')}`
}

function withTemp(fn: (roots: MemoryRoots) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-expand-'))
  const roots: MemoryRoots = { publicDir: join(root, 'public'), projectDir: join(root, 'project') }
  mkdirSync(roots.publicDir, { recursive: true })
  mkdirSync(roots.projectDir, { recursive: true })
  try {
    fn(roots)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function fixture(roots: MemoryRoots, track: 'public' | 'project', name: string, body: string): string {
  const dir = track === 'public' ? roots.publicDir : roots.projectDir
  const path = join(dir, name)
  writeFileSync(path, body, 'utf8')
  return path
}

/* ────────────────────────── ID 解析 ────────────────────────── */

test('parseMemoryId：合法 ID 归一成「轨道 + 安全文件名」', () => {
  assert.deepEqual(parseMemoryId('mem://project/conventions'), {
    ok: true,
    track: 'project',
    name: 'conventions.md',
    file: 'conventions.md',
  })
  assert.deepEqual(parseMemoryId('mem://public/git.md'), {
    ok: true,
    track: 'public',
    name: 'git.md',
    file: 'git.md',
  })
  // 大小写保留：ID 由 `inject.memoryIdOf` 生成（它保留原文件名大小写），展开期必须逐字还原，
  // 否则区分大小写的文件系统上会「注入期给出、展开期找不到」。
  assert.deepEqual(parseMemoryId('mem://project/Conventions'), {
    ok: true,
    track: 'project',
    name: 'Conventions.md',
    file: 'Conventions.md',
  })
  assert.deepEqual(parseMemoryId('  mem://project/testing  '), {
    ok: true,
    track: 'project',
    name: 'testing.md',
    file: 'testing.md',
  })
})

test('parseMemoryId：路径逃逸三组（相对上跳 / 绝对路径 / 家目录与分隔符）一律 EXPAND_PATH_ESCAPE', () => {
  const escapes = [
    '../etc/passwd',
    '../../secrets',
    '/etc/passwd',
    '~/secrets',
    'C:\\Windows\\win.ini',
    'mem://project/../../etc/passwd',
    'mem://project/a/b',
    'mem://project/a\\b',
    'mem://project/a\0b',
    'mem://project/a:b',
    'mem://project/~root',
  ]
  for (const id of escapes) {
    assert.equal(parseMemoryId(id).ok, false, `应拒绝：${JSON.stringify(id)}`)
    assert.deepEqual(parseMemoryId(id), { ok: false, code: 'EXPAND_PATH_ESCAPE' }, `码不对：${id}`)
  }
})

test('parseMemoryId：形态不对是 EXPAND_BAD_ID（不是逃逸）', () => {
  const bad = [
    '',
    '   ',
    'conventions',
    'mem:/project/x',
    'mem://',
    'mem://project',
    'mem://project/',
    'mem://other/x',
    'mem://project/.hidden',
    `mem://project/${'x'.repeat(70)}`,
  ]
  for (const id of bad) {
    assert.deepEqual(parseMemoryId(id), { ok: false, code: 'EXPAND_BAD_ID' }, `码不对：${JSON.stringify(id)}`)
  }
})

/* ────────────────────────── 展开主路径 ────────────────────────── */

test('expand：正文与源文件逐字节一致（sha256 + Buffer 双判）', () => {
  withTemp((roots) => {
    const body = '# 团队约定\n\n提交前必须跑 pnpm build —— 门禁纪律 😀\r\n末尾故意不留换行'
    const path = fixture(roots, 'project', 'conventions.md', body)
    const payload = createExpander({ roots }).expand('mem://project/conventions')

    assert.equal(payload.code, 'OK')
    assert.equal(payload.track, 'project')
    assert.equal(payload.name, 'conventions.md')
    assert.equal(payload.depth, 1)
    assert.equal(payload.truncated, false)
    assert.equal(payload.chars, body.length)
    // 逐字节：编码/换行/emoji 一个都不能被「顺手整理」。
    assert.deepEqual(Buffer.from(payload.body, 'utf8'), readFileSync(path))
    assert.equal(sha256Hex(payload.body), sha256Hex(readFileSync(path, 'utf8')))
    assert.equal(payload.hash, sha256Hex(readFileSync(path, 'utf8')))
  })
})

test('ID 同源：inject.memoryIdOf 给出的 ID 在 expand 侧必然解析成功（含大小写文件名）', () => {
  withTemp((roots) => {
    const cases = [
      { track: 'project' as const, name: 'Conventions.md', body: '大小写敏感的文件名' },
      { track: 'public' as const, name: 'git.md', body: '公共轨' },
    ]
    for (const item of cases) fixture(roots, item.track, item.name, item.body)
    const expander = createExpander({ roots })
    for (const item of cases) {
      const id = memoryIdOf(item.track, item.name)
      assert.ok(id.startsWith('mem://'), `ID 形态变了：${id}`)
      const payload = expander.expand(id)
      // 这一行就是「注入期与展开期必须同源」的判据：ID 拼装改一处、解析改另一处时必然红。
      assert.equal(payload.code, 'OK', `注入期给出的 ID 展开失败：${id}`)
      assert.equal(payload.name, item.name)
      assert.equal(payload.body, item.body)
    }
  })
})

test('expand：轨道隔离（同名文件在 public/project 各自取回）', () => {
  withTemp((roots) => {
    fixture(roots, 'public', 'shared.md', '公共版')
    fixture(roots, 'project', 'shared.md', '项目版')
    const expander = createExpander({ roots })
    assert.equal(expander.expand('mem://public/shared').body, '公共版')
    assert.equal(expander.expand('mem://project/shared').body, '项目版')
  })
})

test('expand：一跳关联可取回原文，第 3 跳返回 EXPAND_DEPTH_EXCEEDED（不递归、不抛）', () => {
  withTemp((roots) => {
    fixture(roots, 'project', 'a.md', 'A 正文')
    fixture(roots, 'project', 'b.md', 'B 正文')
    fixture(roots, 'project', 'c.md', 'C 正文')
    const graph: Record<string, string[]> = {
      'project/a.md': ['mem://project/b'],
      'project/b.md': ['mem://project/c'],
      'project/c.md': [],
    }
    const expander = createExpander({
      roots,
      relatedOf: (track, name) => graph[`${track}/${name}`] ?? [],
    })

    const first = expander.expand('mem://project/a')
    assert.equal(first.code, 'OK')
    assert.equal(first.body, 'A 正文')
    assert.deepEqual(first.related, ['mem://project/b'])

    const second = expander.expand(first.related[0], 2)
    assert.equal(second.code, 'OK')
    assert.equal(second.body, 'B 正文')
    assert.equal(second.depth, 2)

    const third = expander.expand(second.related[0], 3)
    assert.equal(third.code, 'EXPAND_DEPTH_EXCEEDED')
    assert.equal(third.depth, 3)
    assert.equal(third.body, '')
    assert.equal(third.chars, 0)
    assert.equal(third.message, EXPAND_MESSAGES.EXPAND_DEPTH_EXCEEDED)
  })
})

test('expand：depth 归一（缺省/0/NaN 按 1 跳，小数向下取整）', () => {
  withTemp((roots) => {
    fixture(roots, 'project', 'a.md', 'A')
    const expander = createExpander({ roots })
    assert.equal(expander.expand('mem://project/a').depth, 1)
    assert.equal(expander.expand('mem://project/a', 0).depth, 1)
    assert.equal(expander.expand('mem://project/a', Number.NaN).depth, 1)
    assert.equal(expander.expand('mem://project/a', 2.9).depth, 2)
    assert.equal(
      expander.expand('mem://project/a', MEMORY_EXPAND_MAX_DEPTH + 1).code,
      'EXPAND_DEPTH_EXCEEDED',
    )
  })
})

/* ────────────────────────── 降级路径 ────────────────────────── */

test('expand：源文件删除后降级为 EXPAND_NOT_FOUND，其他条目仍可展开', () => {
  withTemp((roots) => {
    const gone = fixture(roots, 'project', 'gone.md', '将被删除')
    fixture(roots, 'project', 'kept.md', '仍在')
    const expander = createExpander({ roots })
    assert.equal(expander.expand('mem://project/gone').code, 'OK')

    unlinkSync(gone)
    const after = expander.expand('mem://project/gone')
    assert.equal(after.code, 'EXPAND_NOT_FOUND')
    assert.equal(after.body, '')
    assert.equal(after.message, EXPAND_MESSAGES.EXPAND_NOT_FOUND)
    // 一条坏了不能拖垮整个展开器（快照/注入仍在用同一个实例）。
    assert.equal(expander.expand('mem://project/kept').body, '仍在')
  })
})

test('expand：损坏条目（同名目录，读盘会 EISDIR）降级为 EXPAND_NOT_FOUND，不抛', () => {
  withTemp((roots) => {
    mkdirSync(join(roots.projectDir, 'broken.md'))
    const payload = createExpander({ roots }).expand('mem://project/broken')
    assert.equal(payload.code, 'EXPAND_NOT_FOUND')
    assert.equal(payload.body, '')
  })
})

test('expand：relatedOf 抛错不影响正文展开', () => {
  withTemp((roots) => {
    fixture(roots, 'project', 'a.md', 'A')
    const expander = createExpander({
      roots,
      relatedOf: () => {
        throw new Error('boom')
      },
    })
    const payload = expander.expand('mem://project/a')
    assert.equal(payload.code, 'OK')
    assert.equal(payload.body, 'A')
    assert.deepEqual(payload.related, [])
  })
})

test('expand：关联 ID 过滤非法/自引用/重复，并受 MEMORY_RELATED_MAX 上限约束', () => {
  withTemp((roots) => {
    fixture(roots, 'project', 'a.md', 'A')
    const expander = createExpander({
      roots,
      relatedOf: () => [
        'mem://project/a', // 自引用
        '../escape', // 逃逸
        'mem://project/b',
        'mem://project/b', // 重复
        'mem://public/c',
        'mem://project/d',
        'mem://project/e',
      ],
    })
    const payload = expander.expand('mem://project/a')
    assert.equal(payload.related.length, MEMORY_RELATED_MAX)
    assert.deepEqual(payload.related, ['mem://project/b', 'mem://public/c', 'mem://project/d'])
  })
})

test('expand：超长记忆截断到 MEMORY_EXPAND_MAX_CHARS 并置 truncated', () => {
  withTemp((roots) => {
    const long = 'x'.repeat(MEMORY_EXPAND_MAX_CHARS + 37)
    fixture(roots, 'project', 'long.md', long)
    const payload = createExpander({ roots }).expand('mem://project/long')

    assert.equal(payload.code, 'OK')
    assert.equal(payload.truncated, true)
    assert.equal(payload.chars, MEMORY_EXPAND_MAX_CHARS)
    assert.equal(payload.body.length, MEMORY_EXPAND_MAX_CHARS)
    assert.equal(payload.hash, sha256Hex(payload.body))
    // 可分辨性：截断后的 hash 必须与全文 hash 不同（否则 truncated 只是摆设）。
    assert.notEqual(payload.hash, sha256Hex(long))
  })
})

test('expand：hash 依赖可注入（集成层换实现不改判定）', () => {
  withTemp((roots) => {
    fixture(roots, 'project', 'a.md', 'A')
    const payload = createExpander({ roots, hash: (text) => `len:${text.length}` }).expand(
      'mem://project/a',
    )
    assert.equal(payload.hash, 'len:1')
  })
})

/* ────────────────────────── 不抛异常 + 文案 ────────────────────────── */

test('expand：敌意 ID 全量扫描不抛异常，且只返回已知错误码', () => {
  withTemp((roots) => {
    const expander = createExpander({ roots })
    const known = new Set(Object.keys(EXPAND_MESSAGES))
    const hostile = [
      '',
      ' ',
      'conventions',
      'mem://',
      'mem://project',
      'mem://project/',
      'mem://other/a',
      '../etc/passwd',
      '/etc/passwd',
      '~/x',
      'mem://project/../../x',
      'mem://project/a/b',
      `mem://project/${'a'.repeat(200)}`,
      'mem://project/a\0b',
      'mem://project/a:b',
      'C:\\x',
      'mem://public/ok?',
    ]
    for (const id of hostile) {
      // 只要有一条路径抛出，这里就红在那一行（AC-10 的「不抛未捕获异常」）。
      const payload = expander.expand(id)
      assert.equal(known.has(payload.code), true, `未定义错误码：${payload.code}`)
      assert.ok(payload.message.length > 0, `缺文案：${payload.code}`)
      if (payload.code !== 'OK') assert.equal(payload.body, '', `失败却返回了正文：${id}`)
    }
  })
})

test('EXPAND_MESSAGES：5 个码各有一句可读中文（AC-10）', () => {
  const codes = [
    'OK',
    'EXPAND_BAD_ID',
    'EXPAND_PATH_ESCAPE',
    'EXPAND_NOT_FOUND',
    'EXPAND_DEPTH_EXCEEDED',
  ] as const
  for (const code of codes) {
    assert.equal(typeof EXPAND_MESSAGES[code], 'string')
    assert.ok(EXPAND_MESSAGES[code].length > 4, `文案过短：${code}`)
  }
})
