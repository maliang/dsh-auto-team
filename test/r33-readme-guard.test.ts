/**
 * r33：README 精简重写的结构守卫（t5）。
 *
 * 为什么需要这个文件：README 是用户第一个入口，但它不在 `tsc` / 构建链路上，
 * 「h2 数量漂了、四张图少引用一张、双语命令改了一边、版本号忘了跟着 package.json 走」
 * 这些错误全都表现为「构建全绿、单测全绿」。r29-packaging 只钉了 h2 数量与图片**集合**，
 * 这里把 t5 验收里剩下的不变量补齐（不弱化、也不重复 r29 的既有断言）：
 *  - 四张图每张在每份 README 里**各引用 2 次**（hero + 原文件清单），集合且与约定一致；
 *  - 代码块里的命令行**逐字相等**且共 26 行（英文版不许只译一半命令）；
 *  - 版本号、engines 与 `package.json` 逐字一致；
 *  - 旧版 16 节 / 379 行的长章节标题不再出现，总行数 ≤ 200（r35 以「特色」开篇后的上限）；
 *  - 「变更记录 / Changelog」整节已删除，任何级别标题再出现即红（r35 新口径）；
 *  - 「特色」六项机制在双语各有一个固定锚点短语（删段即红，见 FEATURE_ANCHORS）；
 *  - 相对链接与四张截图文件真实存在（大图 > 20KB，输入框入口小截图 > 10KB，避免空文件/占位图混过）。
 *
 * 说明：测试基数（README 写的「1223 通过」）不与本文件对照 —— 新增用例本身会改变基数，
 * 自指断言只会永远红；它在 `docs/teamflow/2026-11-13-r33-jump-to-member/verify-readme.mjs`
 * （一次性脚本，实际跑 `pnpm test` 比对）里校验。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const readmeOf = (name: 'README.md' | 'README.en.md'): string => readFileSync(join(ROOT, name), 'utf8')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  version: string
  engines: { node: string; dsh: string }
}

const stripFences = (text: string): string =>
  text.replace(/^ {0,3}```[^\n]*\n[\s\S]*?^ {0,3}```[ \t]*$/gm, '')

const headingsOf = (text: string): string[] => stripFences(text).match(/^## .+$/gm) ?? []

const EXPECTED_IMAGES = [
  'docs/images/entry.png',
  'docs/images/panel-flow.png',
  'docs/images/panel-overview.png',
  'docs/images/panel-tasks.png',
]

function commandLinesOf(text: string): string[] {
  return [...text.matchAll(/^ {0,3}```[^\n]*\n([\s\S]*?)^ {0,3}```[ \t]*$/gm)]
    .flatMap((match) => match[1].split('\n'))
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}

test('r33 文档守卫：双语 h2 数量相等且非空', () => {
  const zh = headingsOf(readmeOf('README.md'))
  const en = headingsOf(readmeOf('README.en.md'))
  assert.ok(zh.length > 0, 'README.md 没有 h2 章节')
  assert.equal(en.length, zh.length, `双语 h2 数量不一致：zh=${zh.length}，en=${en.length}`)
})

test('r33 文档守卫：四张图各引用 2 次（hero + 原文件清单），双语集合一致', () => {
  for (const name of ['README.md', 'README.en.md'] as const) {
    const text = readmeOf(name)
    const cited = Array.from(new Set(text.match(/docs\/images\/[A-Za-z0-9._/-]+\.png/g) ?? [])).sort()
    assert.deepEqual(cited, EXPECTED_IMAGES, `${name} 引用的图片不是约定的四张：${cited.join(', ')}`)
    for (const path of EXPECTED_IMAGES) {
      const count = text.split(path).length - 1
      assert.equal(count, 2, `${name} 对 ${path} 的引用次数 = ${count}，要求 2（少一处就漏图）`)
    }
  }
})

test('r33 文档守卫：26 行命令双语逐字相同', () => {
  const zh = commandLinesOf(readmeOf('README.md'))
  const en = commandLinesOf(readmeOf('README.en.md'))
  assert.equal(zh.length, 26, `README.md 命令行数 = ${zh.length}，要求 26`)
  assert.equal(en.length, 26, `README.en.md 命令行数 = ${en.length}，要求 26`)
  assert.deepEqual(en, zh, '双语 README 的代码块命令必须逐字相同')
})

test('r33 文档守卫：版本号与 engines 跟 package.json 一致', () => {
  for (const name of ['README.md', 'README.en.md'] as const) {
    const text = readmeOf(name)
    const version = text.match(/dsh-auto-team@([0-9]+\.[0-9]+\.[0-9]+)/)?.[1]
    assert.equal(version, pkg.version, `${name} 版本号 = ${version}，package.json = ${pkg.version}`)

    const nodeRow = text.match(/^\|\s*Node\.js\s*\|\s*`([^`]+)`/m)?.[1]
    const dshRow = text.match(/^\|\s*(?:DSH 宿主|DSH host)\s*\|\s*`([^`]+)`/m)?.[1]
    assert.equal(nodeRow, pkg.engines.node, `${name} Node 要求 = ${nodeRow}`)
    assert.equal(dshRow, pkg.engines.dsh, `${name} DSH 要求 = ${dshRow}`)
  }
})

test('r33 文档守卫：旧版长节不复现、总行数 ≤ 200、变更记录整节已删除', () => {
  for (const name of ['README.md', 'README.en.md'] as const) {
    const text = readmeOf(name)
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    assert.ok(lines <= 200, `${name} 现有 ${lines} 行，要求 ≤ 200（r35 以「特色」开篇后的上限）`)

    const zhHeadings = headingsOf(readmeOf('README.md'))
    const enHeadings = headingsOf(readmeOf('README.en.md'))
    for (const old of [
      '## 功能截图',
      '## 30 秒看懂',
      '## 能力与入口',
      '## 同一需求的修订',
      '## 队长可用的 8 个工具',
      '## 门禁（acceptance）语义',
      '## 用量与用时',
      '## 记忆（双轨 md + 条目级）',
      '## 已知限制 / 未完成',
    ]) {
      assert.ok(!zhHeadings.includes(old), `${name} 仍含旧节标题「${old}」`)
      assert.ok(!enHeadings.includes(old), `${name} 仍含旧节标题「${old}」`)
    }
  }

  // r35 新口径：变更记录整节删除，历史只留在 git log / docs/teamflow/，README 里任何级别都不许再有。
  for (const [name, word] of [['README.md', '变更记录'], ['README.en.md', 'Changelog']] as const) {
    const text = readmeOf(name)
    assert.ok(
      !new RegExp(`^#{1,6}\\s*${word}`, 'm').test(text),
      `${name} 又出现了「${word}」节：r35 已删除整节，历史交给 git log 与 docs/teamflow/`,
    )
  }
})


// r35：README 以「特色」开篇，六项机制必须在双语各出现一次固定锚点短语。
// 短语与 t1 交付逐字对应；删掉「特色」整段时这些字符串计数变 0，断言即红。
const FEATURE_ANCHORS: Record<'README.md' | 'README.en.md', Array<[string, string]>> = {
  'README.md': [
    ['依赖图', '**多任务 + 依赖图**'],
    ['自动组队', '**自动组队**'],
    ['子 Agent 独立模型', '**子 Agent 独立模型**'],
    ['门禁 = 证据（回执）', '**门禁 = 证据**'],
    ['调用次数', '调用次数'],
    ['面板可观测', '**面板可观测**'],
    ['团队记忆 + 成员自助', '**团队记忆 + 成员自助**'],
  ],
  'README.en.md': [
    ['dependent task graph', '**Multiple tasks + dependency graph**'],
    ['team assembly', '**Automatic team assembly**'],
    ['per-sub-agent models', '**Per-sub-agent models**'],
    ['gate = evidence (receipt)', '**Gate = evidence**'],
    ['call count', 'call count'],
    ['observable panel', '**Observable panel**'],
    ['team memory + member self-service', '**Team memory + member self-service**'],
  ],
}

test('r33 文档守卫：「特色」六项机制在双语各有固定锚点（每处恰好 1 次）', () => {
  for (const name of ['README.md', 'README.en.md'] as const) {
    const text = readmeOf(name)
    const heading = name === 'README.md' ? '## 特色' : '## Features'
    assert.ok(headingsOf(text).includes(heading), `${name} 缺少「${heading}」章节`)
    for (const [label, phrase] of FEATURE_ANCHORS[name]) {
      const count = text.split(phrase).length - 1
      assert.equal(
        count,
        1,
        `${name} 的特色锚点「${label}」缺失或重复：期望固定短语「${phrase}」出现 1 次，实际 ${count} 次`,
      )
    }
    // 「回执」允许多次出现（30 秒上手与流程表都会提），只钉双语都确实提到。
    const receiptWord = name === 'README.md' ? '回执' : 'receipt'
    assert.ok(text.includes(receiptWord), `${name} 缺少「回执 / receipt」锚点：${receiptWord}`)
  }
})

test('r33 文档守卫：相对链接与截图路径无死链，截图体积下限', () => {
  const missing: string[] = []
  for (const name of ['README.md', 'README.en.md'] as const) {
    const text = readmeOf(name)
    const targets = [
      ...[...text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1]),
      ...[...text.matchAll(/\bdocs\/[A-Za-z0-9._/-]+/g)].map((match) => match[0]),
    ]
    for (const raw of targets) {
      if (/^(https?:|mailto:|#)/.test(raw)) continue
      const path = raw.replace(/^<|>$/g, '').replace(/[.,;:]+$/, '').split('#')[0]
      if (path === '') continue
      if (!existsSync(join(ROOT, path))) missing.push(`${name}: ${path}`)
    }
  }
  assert.deepEqual(missing, [], `README 存在失效链接：\n${missing.join('\n')}`)

  // 入口截图是输入框左下角的局部裁剪（2026-11-15 重截后 17970 B，图本身不许再改），
  // 因此给它单独的 10KB 下限；三张面板截图仍按 20KB 挡空文件 / 占位图（空 PNG 只有几十 B）。
  const MIN_BYTES: Record<string, number> = { 'docs/images/entry.png': 10 * 1024 }
  for (const path of EXPECTED_IMAGES) {
    const file = join(ROOT, path)
    assert.ok(existsSync(file), `缺截图 ${path}`)
    const floor = MIN_BYTES[path] ?? 20 * 1024
    const size = statSync(file).size
    assert.ok(size > floor, `${path} 只有 ${size} B，要求 > ${floor} B`)
  }
})
