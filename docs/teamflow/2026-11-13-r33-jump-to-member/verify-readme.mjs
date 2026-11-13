#!/usr/bin/env node
/**
 * r33 / t5 的 README 校验脚本（一次性验收入口，可重复跑）。
 *
 * 为什么是脚本而不是新增单测：本脚本要读「pnpm test 实际输出」来对照 README 声明的基线，
 * 把它做成单测会自己改变用例数（自指）。脚本从任务夹出发，用 `../../..` 锚定仓库根，
 * 归档位置变化也不会把相对根解析错。
 *
 * 用法：
 *   node docs/teamflow/2026-11-13-r33-jump-to-member/verify-readme.mjs          # 静态项 + 跑 pnpm test 对照基线
 *   node .../verify-readme.mjs --no-test                                        # 只跑静态项（其余任务正在改代码时用）
 *
 * 退出码 0 = 全绿；1 = 至少一项不满足（逐条打印 PASS/FAIL）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'

const ROOT = new URL('../../../', import.meta.url).pathname
const runTest = !process.argv.includes('--no-test')
const failures = []
let checks = 0

function check(name, fn) {
  checks += 1
  try {
    const detail = fn()
    console.log(`PASS  ${name}${detail === undefined || detail === '' ? '' : `  [${detail}]`}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push({ name, message })
    console.log(`FAIL  ${name}\n      ${message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert.equal = (actual, expected, message) => {
  if (actual !== expected) throw new Error(message ?? `期望 ${expected}，实际 ${actual}`)
}

assert.deepEqual = (actual, expected, message) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(message ?? `期望 ${b}，实际 ${a}`)
}

const read = (name) => readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8')

/** 去代码块：README 里代码块中的 `## ` 是命令注释，不是章节。 */
const stripFences = (text) => text.replace(/^ {0,3}```[^\n]*\n[\s\S]*?^ {0,3}```[ \t]*$/gm, '')

const headingsOf = (text) => stripFences(text).match(/^## .+$/gm) ?? []

const imagePathsOf = (text) =>
  Array.from(new Set(stripFences(text).match(/docs\/images\/[A-Za-z0-9._/-]+\.png/g) ?? [])).sort()

/** 代码块里的命令行（去掉空行与 shell 注释），用于双语逐字对照。 */
function commandLinesOf(text) {
  const blocks = [...text.matchAll(/^ {0,3}```[^\n]*\n([\s\S]*?)^ {0,3}```[ \t]*$/gm)]
  return blocks
    .flatMap((match) => match[1].split('\n'))
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}

const ZH = read('README.md')
const EN = read('README.en.md')
const pkg = JSON.parse(read('package.json'))

const EXPECTED_IMAGES = [
  'docs/images/panel-overview.png',
  'docs/images/panel-tasks.png',
  'docs/images/panel-flow.png',
  'docs/images/entry.png',
].sort()

// ---------- ① 双语结构 ----------
check('双语 h2 数量相等（去代码块）', () => {
  const zh = headingsOf(ZH)
  const en = headingsOf(EN)
  assert(zh.length > 0, 'README.md 没有 h2 章节')
  assert.equal(en.length, zh.length, `README.md=${zh.length}，README.en.md=${en.length}`)
  return `${zh.length} 节`
})

check('四张图都在，且每张在每个 README 里各引用 2 次', () => {
  for (const [file, text] of [['README.md', ZH], ['README.en.md', EN]]) {
    const paths = imagePathsOf(text)
    assert.deepEqual(paths, EXPECTED_IMAGES, `${file} 引用的图片集合不是约定的四张：${paths.join(', ')}`)
    for (const path of EXPECTED_IMAGES) {
      const count = text.split(path).length - 1
      assert.equal(count, 2, `${file} 对 ${path} 的引用次数 = ${count}，要求 2（hero + 原文件清单）`)
    }
  }
  return '4 × 2'
})

check('26 行命令双语逐字相同', () => {
  const zh = commandLinesOf(ZH)
  const en = commandLinesOf(EN)
  assert.equal(zh.length, 26, `README.md 命令行数 = ${zh.length}，要求 26`)
  assert.equal(en.length, 26, `README.en.md 命令行数 = ${en.length}，要求 26`)
  const diff = zh.findIndex((line, index) => line !== en[index])
  assert(diff === -1, `第 ${diff + 1} 行命令不一致：\n  zh: ${zh[diff]}\n  en: ${en[diff]}`)
  return '26 行'
})

// ---------- ② 基线 / 版本 ----------
check('版本号与 package.json 一致', () => {
  for (const [file, text] of [['README.md', ZH], ['README.en.md', EN]]) {
    const found = text.match(/dsh-auto-team@([0-9]+\.[0-9]+\.[0-9]+)/)?.[1]
    assert(found !== undefined, `${file} 没写 dsh-auto-team@<semver>`)
    assert.equal(found, pkg.version, `${file} 写 ${found}，package.json 是 ${pkg.version}`)
  }
  return pkg.version
})

check('engines 与双语兼容表逐字一致', () => {
  const rows = [
    ['README.md', /^\|\s*Node\.js\s*\|\s*`([^`]+)`/m, /^\|\s*DSH 宿主\s*\|\s*`([^`]+)`/m],
    ['README.en.md', /^\|\s*Node\.js\s*\|\s*`([^`]+)`/m, /^\|\s*DSH host\s*\|\s*`([^`]+)`/m],
  ]
  for (const [file, nodeRe, dshRe] of rows) {
    const text = file === 'README.md' ? ZH : EN
    const node = text.match(nodeRe)?.[1]
    const dsh = text.match(dshRe)?.[1]
    assert(node === pkg.engines.node, `${file} Node=${node}，package.json=${pkg.engines.node}`)
    assert(dsh === pkg.engines.dsh, `${file} DSH=${dsh}，package.json=${pkg.engines.dsh}`)
  }
  return `${pkg.engines.node} / ${pkg.engines.dsh}`
})

check('README 声明的测试基数 == pnpm test 实际输出', () => {
  const zh = ZH.match(/\*\*(\d+) 通过 \/ (\d+) 失败 \/ (\d+) skipped\*\*/)
  const en = EN.match(/\*\*(\d+) pass \/ (\d+) fail \/ (\d+) skipped\*\*/)
  assert(zh !== null, 'README.md 没写「N 通过 / N 失败 / N skipped」基线')
  assert(en !== null, 'README.en.md 没写「N pass / N fail / N skipped」基线')
  assert.deepEqual(en.slice(1), zh.slice(1), `双语基线不一致：zh=${zh.slice(1)}，en=${en.slice(1)}`)

  if (!runTest) return `声明 ${zh[1]} 例（--no-test 未对照实际输出）`

  let output = ''
  try {
    output = execFileSync('pnpm', ['test'], { cwd: ROOT, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    // 失败也要对照：断言会给出「声明 vs 实际」，而不是吞掉原始失败。
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  const actual = {
    tests: Number(output.match(/ℹ tests (\d+)/)?.[1] ?? NaN),
    pass: Number(output.match(/ℹ pass (\d+)/)?.[1] ?? NaN),
    fail: Number(output.match(/ℹ fail (\d+)/)?.[1] ?? NaN),
  }
  assert(Number.isFinite(actual.tests), '从 pnpm test 输出里解析不到「ℹ tests N」')
  assert.equal(
    actual.tests,
    Number(zh[1]),
    `README 声明 ${zh[1]} 例，实际 tests=${actual.tests}（pass=${actual.pass} fail=${actual.fail}）`,
  )
  assert.equal(actual.fail, Number(zh[2]), `README 声明 ${zh[2]} 失败，实际 fail=${actual.fail}`)
  return `tests=${actual.tests} pass=${actual.pass} fail=${actual.fail}`
})

// ---------- ③ 旧结构 / 死链 ----------
check('不再出现旧版长节标题，且总行数 <= 180', () => {
  for (const [file, text] of [['README.md', ZH], ['README.en.md', EN]]) {
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    assert(lines <= 180, `${file} 现有 ${lines} 行，要求 <= 180（旧版 379 行）`)
  }
  const gone = [
    '## 功能截图',
    '## 30 秒看懂',
    '## 能力与入口',
    '## 同一需求的修订',
    '## 安装（本机',
    '## 队长可用的 8 个工具',
    '## 门禁（acceptance）语义',
    '## 用量与用时',
    '## 记忆（双轨 md + 条目级）',
    '## 已知限制 / 未完成',
    '## 变更记录',
  ]
  const zhHeadings = headingsOf(ZH)
  const enHeadings = headingsOf(EN)
  for (const heading of gone) {
    assert(!zhHeadings.includes(heading), `README.md 仍含旧节标题「${heading}」`)
    assert(!enHeadings.includes(heading), `README.en.md 仍含旧节标题「${heading}」`)
  }
  return '<=180 行'
})

check('变更记录只留最近 3 条（h3）且链接到历史', () => {
  const zhHeading = ZH.match(/^### 变更记录[^\n]*$/m)?.[0] ?? ''
  const enHeading = EN.match(/^### Changelog[^\n]*$/m)?.[0] ?? ''
  assert(zhHeading !== '' && enHeading !== '', '缺少 h3 变更记录 / Changelog 标题')
  const zh = ZH.slice(ZH.indexOf(zhHeading) + zhHeading.length)
  const en = EN.slice(EN.indexOf(enHeading) + enHeading.length)
  const bullets = (text) => (text.match(/^- /gm) ?? []).length
  assert(bullets(zh) === 3, `README.md 变更记录条目 = ${bullets(zh)}，要求 3`)
  assert(bullets(en) === 3, `README.en.md 变更记录条目 = ${bullets(en)}，要求 3`)
  assert(/git log/.test(zhHeading) && /git log/.test(enHeading), '变更记录标题没指向 git log')
  return '3 条'
})

check('相对链接与图片路径全部存在（无死链）', () => {
  const missing = []
  for (const [file, text] of [['README.md', ZH], ['README.en.md', EN]]) {
    const targets = [
      ...[...text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1]),
      ...[...text.matchAll(/\bdocs\/[A-Za-z0-9._/-]+/g)].map((match) => match[0]),
    ]
    for (const raw of targets) {
      if (/^(https?:|mailto:|#)/.test(raw)) continue
      const path = raw.replace(/^<|>$/g, '').replace(/[.,;:]+$/, '').split('#')[0]
      if (path === '' || path.startsWith('#')) continue
      const absolute = new URL(`../../../${path}`, import.meta.url)
      if (!existsSync(absolute)) missing.push(`${file}: ${path}`)
    }
  }
  assert(missing.length === 0, `失效链接：\n      ${missing.join('\n      ')}`)
  return '全部命中'
})

check('四张图文件存在且 > 20KB', () => {
  const sizes = EXPECTED_IMAGES.map((path) => {
    const file = new URL(`../../../${path}`, import.meta.url)
    assert(existsSync(file), `缺文件 ${path}`)
    const stat = statSync(file)
    assert(stat.size > 20 * 1024, `${path} 只有 ${stat.size} B（要求 > 20KB）`)
    return `${path.split('/').pop()}=${Math.round(stat.size / 1024)}KB`
  })
  return sizes.join(' ')
})

// ---------- 汇总 ----------
console.log(`\n${checks - failures.length}/${checks} 项通过`)
if (failures.length > 0) {
  console.log('\n未通过：')
  for (const failure of failures) console.log(`- ${failure.name}: ${failure.message}`)
  process.exitCode = 1
}
