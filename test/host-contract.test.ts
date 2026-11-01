/**
 * 服务访问面守卫（AC-4）：源码扫描 `ctx.<x>`，把 `inject` 与被测系统绑成同一条契约。
 *
 * 为什么必须扫源码而不是 mock：`src/host/index.ts` 的 `inject` 是 **cordis 的加载期契约**
 * ——少声明一个服务，宿主不是「功能降级」而是**整条 entry 不激活**
 * （`dsh: warning: 1 entry did not activate` + `cannot get property "x" without inject`）。
 * 而任何手搓 fake ctx 都不会触发这条判据（所有字段都已存在、所有访问都合法），
 * 所以历史缺陷「单测全绿、真机插件从未激活」只能靠扫描源码堵住。
 *
 * 扫描用 TypeScript 编译器 AST，而不是「先剥注释再正则」：
 * 注释里的 `ctx.agentTeams`（本仓 adapter 文档大量出现）与字符串里的 `ctx.x` 天然不参与，
 * 正则字面量、模板串也不会被误当成代码——同一件事，AST 比手写状态机更难写错。
 *
 * 四条断言各自防一种漂移：
 *   1. 裸访问面 ⊆ inject ∪ 可选白名单  ← 漏声明必红（文案点名服务，红的是断言不是异常）
 *   2. inject ∩ 可选白名单 === ∅      ← 可选服务混进 inject 会让它变 required
 *   3. inject 精确等于 4 项（strict）  ← 悄悄扩容 inject 也必红
 *   4. optionalService 的字面量集合 === 白名单 ← 用了没登记 / 登记了没用 都红
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// typescript 是 `export =` 的 CJS 包：namespace import 在 verbatimModuleSyntax 下也能过 tsc，
// 且 node 的 cjs-module-lexer 能取到 createSourceFile（已实测两种写法都可用，选不依赖 esModuleInterop 的）。
import * as ts from 'typescript'
import { inject } from '../src/host/index.ts'
import { OPTIONAL_SERVICES } from '../src/host/adapters.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** cordis Context 自身成员，**不是服务**，永远不进 inject（设计 §9 层 1 的白名单）。 */
const CORE_MEMBERS: ReadonlySet<string> = new Set(['logger', 'effect', 'on', 'get'])

/** 可选服务白名单的字符串形态（从实现的唯一登记处派生，测试里不再抄一份字面量）。 */
const OPTIONAL: readonly string[] = [...OPTIONAL_SERVICES]

/**
 * 例外登记处：本项目里有**领域自有**的 `ctx` 形参（与宿主 ctx 同名但不是它）。
 * 每条例外都必须写出「它自己的 ctx 类型」，并且该文件一旦开始消费 `HostContext` 就会变红
 * （见下面的断言），所以例外不会变成静默漏洞。
 */
const LOCAL_CTX_MODULES: Readonly<Record<string, string>> = {
  'src/host/team/trigger.ts': 'FastContext',
}

/** 递归列出目录下的源文件（跳过 node_modules / lib）。 */
function sourceFiles(dir: string, exts: readonly string[], out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name.startsWith('.')) continue
    const relPath = `${dir}/${entry.name}`
    if (entry.isDirectory()) sourceFiles(relPath, exts, out)
    else if (exts.includes(extname(entry.name))) out.push(relPath)
  }
  return out
}

function parse(relPath: string): { source: string; file: ts.SourceFile } {
  const source = readFileSync(join(ROOT, relPath), 'utf8')
  const kind = relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return { source, file: ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, kind) }
}

interface CtxHit {
  name: string
  where: string
}

/** 取 `ctx.<x>` / `ctx?.<x>`（`ctx` 必须是最内层的标识符，`store.ctx.x` 之类不会误收）。 */
function ctxAccesses(relPath: string): CtxHit[] {
  const { file } = parse(relPath)
  const hits: CtxHit[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'ctx'
    ) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
      hits.push({ name: node.name.text, where: `${relPath}:${line + 1}` })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

/** `optionalService(ctx, '<literal>')` 的第二个实参（必须是字面量，变量透传不算登记）。 */
function optionalServiceLiterals(relPath: string): Array<{ name: string; where: string }> {
  const { file } = parse(relPath)
  const hits: Array<{ name: string; where: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'optionalService') {
      const [first, second] = node.arguments
      if (first && ts.isIdentifier(first) && first.text === 'ctx' && second && ts.isStringLiteralLike(second)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
        hits.push({ name: second.text, where: `${relPath}:${line + 1}` })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

/** 扫一个目录，返回「服务名 → 出现位置」的合并视图（跳过例外模块）。 */
function scan(dir: string, exts: readonly string[]): Map<string, string[]> {
  const merged = new Map<string, string[]>()
  for (const relPath of sourceFiles(dir, exts)) {
    if (relPath in LOCAL_CTX_MODULES) continue
    for (const hit of ctxAccesses(relPath)) {
      const list = merged.get(hit.name) ?? []
      list.push(hit.where)
      merged.set(hit.name, list)
    }
  }
  return merged
}

const HOST_FILES = sourceFiles('src/host', ['.ts'])
const HOST_ACCESS = scan('src/host', ['.ts'])
const HOST_SERVICES = [...HOST_ACCESS.keys()].filter((name) => !CORE_MEMBERS.has(name)).sort()

test('扫描面自身不空转：扫到的文件数与服务数都必须是真实值（防「正则写错→恒绿」）', () => {
  assert.ok(HOST_FILES.length >= 20, `应扫到 ≥20 个宿主源文件，实际 ${HOST_FILES.length}`)
  for (const expected of ['tools', 'systemPrompt', 'agents', 'agentTeams']) {
    assert.ok(HOST_ACCESS.has(expected), `扫描结果里必须包含 ctx.${expected}（否则扫描逻辑坏了，守卫恒绿）`)
  }
  assert.ok(HOST_ACCESS.has('logger'), 'ctx.logger 是 cordis 自身成员，扫描必须能看见它')
})

test('inject 覆盖全部 ctx.<x> 裸访问面（漏一个真机就不激活）', () => {
  const declared = new Set<string>([...inject, ...OPTIONAL])
  const missing = HOST_SERVICES.filter((name) => !declared.has(name))
  const detail = missing
    .map((name) => `ctx.${name} 未在 inject 中登记（出现于 ${HOST_ACCESS.get(name)?.join(', ')}）`)
    .join('\n')
  assert.deepEqual(missing, [], `宿主服务访问面必须全部登记：\n${detail}`)
})

test('inject 精确等于 4 项硬依赖（strict：新增服务必须同时改这里）', () => {
  assert.deepEqual(
    [...inject].sort(),
    ['agentTeams', 'agents', 'systemPrompt', 'tools'],
    `inject 是 cordis 加载期契约，裸访问面变了就要同步改这里与 adapters 的可选白名单，实际 ${JSON.stringify(inject)}`,
  )
  assert.ok(Array.isArray(inject), 'inject 必须是数组字面量（对象形式 {required,optional} 会被宿主当成服务名）')
})

test('inject 与可选白名单互斥（可选服务混进 inject 会变 required）', () => {
  const overlap = inject.filter((name) => OPTIONAL.includes(name))
  assert.deepEqual(overlap, [], `可选服务不许写进 inject：${overlap.join(', ')}`)
})

test('optionalService 的字面量集合 === OPTIONAL_SERVICES（既防用了没登记，也防登记了没用）', () => {
  const used = new Set<string>()
  const places: string[] = []
  for (const relPath of HOST_FILES) {
    if (relPath in LOCAL_CTX_MODULES) continue
    for (const hit of optionalServiceLiterals(relPath)) {
      used.add(hit.name)
      places.push(`${hit.name} @ ${hit.where}`)
    }
  }
  assert.deepEqual(
    [...used].sort(),
    [...OPTIONAL].sort(),
    `可选服务的登记处（OPTIONAL_SERVICES）与真实调用点必须逐字一致，实际调用：${places.join(', ')}`,
  )
})

test('ctx.get 只允许出现在 adapters.ts（可选服务的唯一读取入口）', () => {
  const violations = (HOST_ACCESS.get('get') ?? []).filter((where) => !where.startsWith('src/host/adapters.ts:'))
  assert.deepEqual(violations, [], `可选服务只许经 optionalService() 读取，不许自己 ctx.get：${violations.join(', ')}`)
})

test('领域自有 ctx 的例外必须仍然成立（例外不能变成静默漏洞）', () => {
  for (const [relPath, localType] of Object.entries(LOCAL_CTX_MODULES)) {
    assert.ok(HOST_FILES.includes(relPath), `例外文件不存在了：${relPath}`)
    const { source } = parse(relPath)
    assert.ok(source.includes(localType), `${relPath} 必须仍声明它自己的 ctx 类型 ${localType}`)
    assert.ok(
      !source.includes('HostContext'),
      `${relPath} 若开始消费 HostContext，就必须移出例外并被扫描（当前例外会掩盖裸访问）`,
    )
  }
})

test('client 侧 ctx.<x> ⊆ inject(=[slots]) ∪ 非服务白名单', () => {
  // client 入口 import 了 .tsx，node --test 无法直接转，所以 inject 从源码里读（只读、不改）。
  const { source } = parse('src/client/index.ts')
  const match = /export\s+const\s+inject\s*=\s*\[([^\]]*)\]/.exec(source)
  assert.ok(match, 'src/client/index.ts 必须声明 export const inject = [...]')
  const clientInject = [...(match[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1] ?? '')
  assert.deepEqual(clientInject, ['slots'], `client 的 inject 只应有 slots，实际 ${JSON.stringify(clientInject)}`)

  const declared = new Set<string>([...clientInject, ...CORE_MEMBERS])
  const allowed = [...OPTIONAL]
  const violations: string[] = []
  for (const [name, places] of scan('src/client', ['.ts', '.tsx'])) {
    if (declared.has(name) || allowed.includes(name)) continue
    violations.push(`ctx.${name} 未在 client inject 中登记（${places.join(', ')}）`)
  }
  assert.deepEqual(violations, [], violations.join('\n'))
})
