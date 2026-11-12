/**
 * r29：打包清单与文档回归。
 *
 * 为什么需要这个文件：`package.json` 的 `exports`/`files` 与 README 的「兼容性与版本支持」表
 * 分别维护，历史上漂移过多次（README 写 `>=22.18`、manifest 换了范围却没人发现；`locale/*.json`
 * 加进 `files` 时也可能只改一边）。这类漂移「构建全绿、单测全绿」，只有在真实 `npm pack` 清单与
 * 双语文档结构上才看得见，所以这里逐条钉死：
 *  - `version` 是合法 semver（`npm publish` 前才会炸的错误提前到测试）；
 *  - `engines.node` / `engines.dsh` 存在，且与 README / README.en.md 的「兼容性与版本支持」表逐字一致；
 *  - `exports` 含 `./locale/*.json`，`files` 含 `lib`、`cordis.patch.yml`、`locale/*.json`；
 *  - 两份 locale 的 `meta.title` / `meta.description` 非空（空串会让宿主面板显示空白标题）；
 *  - README.md 与 README.en.md 的 h2 数量、图片引用集合相等（双语版结构一一对应）；
 *  - 真实 `npm pack --dry-run --json` 清单含 7 个必需文件，且不含 `src/`、`test/`（别把源码/测试发出去）。
 *
 * 注意：README.md / README.en.md 被 npm **无条件收录**，所以只对真实清单断言它们存在，
 * 不断言它们出现在 `package.json` 的 `files` 里（写了也不算错，只是不必写）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根：用 URL 锚定，避免从别的 cwd 跑测试时把相对路径解析到别处。 */
const ROOT = fileURLToPath(new URL('../', import.meta.url))

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

interface PackageJson {
  version?: unknown
  engines?: { node?: unknown; dsh?: unknown }
  exports?: unknown
  files?: unknown
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as PackageJson
const files = Array.isArray(pkg.files) ? (pkg.files as string[]) : []

function readmeOf(name: 'README.md' | 'README.en.md'): string {
  return readFileSync(join(ROOT, name), 'utf8')
}

/** 取 `## <heading>` 到下一个 `## ` 之间的正文；标题不存在时直接失败（矩阵节被删/改名也算漂移）。 */
function sectionOf(readme: string, heading: string, file: string): string {
  const lines = readme.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  assert.notEqual(start, -1, `${file} 缺少「${heading}」一节`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^## /.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** 在兼容性表里按首列标签取值（值必须是反引号里的原文）。 */
function engineRow(section: string, label: RegExp, file: string): string {
  const row = section.split('\n').find((line) => label.test(line))
  assert.ok(row, `${file} 的兼容性表缺少 ${label} 行`)
  const value = row.match(/`([^`]+)`/)
  assert.ok(value, `${file} 的兼容性表中 ${label} 行没有用反引号标出要求值`)
  return value[1]
}

test('r29-packaging: version 是合法 semver，engines 声明存在', () => {
  assert.equal(typeof pkg.version, 'string', 'package.json 缺少 version')
  const version = pkg.version as string
  assert.equal(version, version.trim(), 'version 前后不能有空白')
  assert.match(version, SEMVER, `version "${version}" 不是合法 semver`)

  assert.equal(typeof pkg.engines, 'object', 'package.json 缺少 engines')
  assert.equal(typeof pkg.engines?.node, 'string', 'package.json 缺少 engines.node')
  assert.equal(typeof pkg.engines?.dsh, 'string', 'package.json 缺少 engines.dsh')
  assert.ok((pkg.engines?.node as string).trim(), 'engines.node 不能为空')
  assert.ok((pkg.engines?.dsh as string).trim(), 'engines.dsh 不能为空')
})

test('r29-packaging: engines 与 README 双语「兼容性与版本支持」表一致', () => {
  const zh = sectionOf(readmeOf('README.md'), '兼容性与版本支持', 'README.md')
  const en = sectionOf(
    readmeOf('README.en.md'),
    'Compatibility and version support',
    'README.en.md',
  )

  assert.equal(
    engineRow(zh, /^\|\s*Node\.js\s*\|/, 'README.md'),
    pkg.engines?.node,
    'README.md 的 Node.js 要求与 package.json 的 engines.node 不一致',
  )
  assert.equal(
    engineRow(zh, /^\|\s*DSH 宿主\s*\|/, 'README.md'),
    pkg.engines?.dsh,
    'README.md 的 DSH 宿主要求与 package.json 的 engines.dsh 不一致',
  )
  assert.equal(
    engineRow(en, /^\|\s*Node\.js\s*\|/, 'README.en.md'),
    pkg.engines?.node,
    'README.en.md 的 Node.js 要求与 package.json 的 engines.node 不一致',
  )
  assert.equal(
    engineRow(en, /^\|\s*DSH host\s*\|/, 'README.en.md'),
    pkg.engines?.dsh,
    'README.en.md 的 DSH host 要求与 package.json 的 engines.dsh 不一致',
  )
})

test('r29-packaging: exports 含 locale，files 含 lib / cordis.patch.yml / locale', () => {
  assert.ok(pkg.exports && typeof pkg.exports === 'object', 'package.json 缺少 exports')
  const exportsMap = pkg.exports as Record<string, unknown>
  assert.ok(
    Object.prototype.hasOwnProperty.call(exportsMap, './locale/*.json'),
    'exports 缺少 "./locale/*.json" 子路径',
  )
  assert.equal(
    exportsMap['./locale/*.json'],
    './locale/*.json',
    'exports["./locale/*.json"] 应指向 ./locale/*.json',
  )

  for (const entry of ['lib', 'cordis.patch.yml', 'locale/*.json']) {
    assert.ok(files.includes(entry), `files 缺少 "${entry}"（当前：${files.join(', ')}）`)
  }
})

test('r29-packaging: 两份 locale 的 meta.title / meta.description 非空', () => {
  for (const file of ['locale/en.json', 'locale/zh.json'] as const) {
    const json = JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as {
      meta?: { title?: unknown; description?: unknown }
    }
    for (const field of ['title', 'description'] as const) {
      const value = json.meta?.[field]
      assert.equal(typeof value, 'string', `${file} 缺少 meta.${field}`)
      assert.ok((value as string).trim(), `${file} 的 meta.${field} 不能为空`)
    }
  }
})

test('r29-packaging: README 双语 h2 数量与图片引用集合相等', () => {
  const zh = readmeOf('README.md')
  const en = readmeOf('README.en.md')

  // 只比较正文结构：代码块里的 `## ` 是命令注释，不是章节。
  const stripFences = (text: string): string => text.replace(/^ {0,3}```[^\n]*\n[\s\S]*?^ {0,3}```[ \t]*$/gm, '')
  const headingsOf = (text: string): string[] => stripFences(text).match(/^## .+$/gm) ?? []
  const imagesOf = (text: string): string[] =>
    Array.from(
      new Set(
        (stripFences(text).match(/docs\/images\/[A-Za-z0-9._/-]+\.png/g) ?? []).map((path) => path),
      ),
    ).sort()

  const zhHeadings = headingsOf(zh)
  const enHeadings = headingsOf(en)
  assert.ok(zhHeadings.length > 0, 'README.md 没有 h2 章节')
  assert.equal(
    enHeadings.length,
    zhHeadings.length,
    `双语 README 的 h2 数量不一致：README.md=${zhHeadings.length}，README.en.md=${enHeadings.length}`,
  )

  const zhImages = imagesOf(zh)
  const enImages = imagesOf(en)
  assert.ok(zhImages.length > 0, 'README.md 没有引用任何 docs/images/*.png')
  assert.deepEqual(enImages, zhImages, '双语 README 的图片引用集合不一致')
})

test('r29-packaging: 真实 npm pack 清单含 7 个必需文件且不含源码/测试', () => {
  const cache = mkdtempSync(join(tmpdir(), 'dsh-r29-pack-'))
  const stdout = execFileSync(
    'npm',
    ['pack', '--dry-run', '--json', '--cache', cache],
    { cwd: ROOT, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const parsed = JSON.parse(stdout) as Array<{ files?: Array<{ path: string }> }>
  assert.ok(Array.isArray(parsed) && parsed.length === 1, 'npm pack --json 应返回单个包描述')
  const paths = (parsed[0].files ?? []).map((entry) => entry.path)
  assert.ok(paths.length > 0, 'npm pack 清单为空')

  for (const required of [
    'lib/index.js',
    'lib/client.js',
    'cordis.patch.yml',
    'README.md',
    'README.en.md',
    'locale/en.json',
    'locale/zh.json',
  ]) {
    assert.ok(
      paths.includes(required),
      `npm pack 清单缺少 ${required}（实际：${paths.join(', ')}）`,
    )
  }

  for (const path of paths) {
    assert.ok(!path.startsWith('src/'), `npm pack 不应包含源码：${path}`)
    assert.ok(!path.startsWith('test/'), `npm pack 不应包含测试：${path}`)
  }
})
