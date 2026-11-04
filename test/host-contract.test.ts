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
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// typescript 是 `export =` 的 CJS 包：namespace import 在 verbatimModuleSyntax 下也能过 tsc，
// 且 node 的 cjs-module-lexer 能取到 createSourceFile（已实测两种写法都可用，选不依赖 esModuleInterop 的）。
import * as ts from 'typescript'
import { inject } from '../src/host/index.ts'
import { OPTIONAL_SERVICES } from '../src/host/adapters.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * cordis Context 自身成员，**不是服务**，永远不进 inject（设计 §9 层 1 的白名单）。
 * `inject` 是 cordis 的「依赖就绪才回调」API（`ctx.inject(['<service>'], cb)`），
 * client 半用它取可选服务 `sidebarRightTabs`/`sidebarRight`（QA-02 修复），因此它不算裸访问面。
 */
// `root` 是 cordis 的 Context 核心成员（根上下文，子 ctx 原型链继承），不是可选服务。
const CORE_MEMBERS: ReadonlySet<string> = new Set(['logger', 'effect', 'on', 'get', 'inject', 'root'])

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

/**
 * 把「相对仓库根的路径」归一成绝对路径；绝对路径原样返回。
 *
 * 支持绝对路径是为了**可分辨性自检**：下列守卫（唯一 setInterval / 3 条路由 / 数据根单点）
 * 必须能在「合成的违规样本」上真的判红，否则它们只是恒绿的装饰
 * （本项目历史教训：判据恒绿与恒红一样不承载信息）。
 */
function absolute(relOrAbs: string): string {
  return isAbsolute(relOrAbs) ? relOrAbs : join(ROOT, relOrAbs)
}

/** 递归列出目录下的源文件（跳过 node_modules / lib）。 */
function sourceFiles(dir: string, exts: readonly string[], out: string[] = []): string[] {
  for (const entry of readdirSync(absolute(dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name.startsWith('.')) continue
    const relPath = `${dir}/${entry.name}`
    if (entry.isDirectory()) sourceFiles(relPath, exts, out)
    else if (exts.includes(extname(entry.name))) out.push(relPath)
  }
  return out
}

function parse(filePath: string): { source: string; file: ts.SourceFile } {
  const source = readFileSync(absolute(filePath), 'utf8')
  const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return { source, file: ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, kind) }
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

/**
 * `optionalService(ctx, '<literal>')` 与 `readServiceQuietly(ctx, '<literal>')` 的第二个实参
 * （必须是字面量，变量透传不算登记）。
 *
 * 两个读取口都要扫：`readServiceQuietly` 是「此刻缺失属正常时序」时的静默读法
 * （r6 真机实测的 webServer 早启动场景），不扫它就等于留了一条绕过白名单的路。
 */
function optionalServiceLiterals(relPath: string): Array<{ name: string; where: string }> {
  const { file } = parse(relPath)
  const READERS = new Set(['optionalService', 'readServiceQuietly'])
  const hits: Array<{ name: string; where: string }> = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      READERS.has(node.expression.text)
    ) {
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

/* ============================================================================
 * r7 新增：形态冻结的三条不变式（AC-11）
 *
 * PRD 把「3 条 HTTP 路由 / 4 项 inject / 唯一 setInterval」列为**冻结形状**：
 * r7 只许新增面板动作（pause / resumeTeam / restoreDefaultRoles / saveSettings），
 * 不许新增路由、不许另起心跳、不许把数据根拼到第二层 `.dsh`。
 *
 * 三条判据都必须落在 AST 上，因为这三样东西的失效形态全是「注释里说单点、运行时多了一处」：
 *   1. 多一条路由：宿主路由表与 `src/client/api.ts` 各自多一个入口，面板与工具读到两份真值；
 *   2. 多一个 setInterval：暂停后仍有心跳（假暂停），且卸载/退出时进程不干净；
 *   3. 数据根拼错：`~/.dsh/.dsh/auto-team/settings.json` 写得到处都是，面板永远读不到用户设置
 *      （PRD 澄清阶段实测过的真机落点是 `/Users/maliang/.dsh/auto-team/settings.json`）。
 * ========================================================================== */

/** 遍历单个文件的整棵 AST（含所有子节点）。 */
function walkAst(relPath: string, visit: (node: ts.Node, file: ts.SourceFile) => void): void {
  const { file } = parse(relPath)
  const visitNode = (node: ts.Node): void => {
    visit(node, file)
    ts.forEachChild(node, visitNode)
  }
  visitNode(file)
}

/** 收集某几个目录树里所有「callee 名字等于 name 的调用」位置（`f()` 与 `x.f()` 都算）。 */
function callSites(name: string, dirs: readonly string[], exts: readonly string[]): string[] {
  const sites: string[] = []
  for (const dir of dirs) {
    for (const relPath of sourceFiles(dir, exts)) {
      walkAst(relPath, (node, file) => {
        if (!ts.isCallExpression(node)) return
        const callee = node.expression
        const label = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : ''
        if (label !== name) return
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
        sites.push(`${relPath}:${line + 1}`)
      })
    }
  }
  return sites
}

/**
 * 从 `src/host/http.ts` 的 `buildHttpRoutes` 里取出「METHOD /尾段」表。
 *
 * 取的是**函数体里 return 的那个数组字面量**，不是源码正则：路由表一旦被改成
 * 「按条件 push」「从常量表 map 出来」，这里会直接判红并提示，而不是静默数错。
 */
function httpRouteTable(relPath = 'src/host/http.ts'): string[] {
  let routes: ts.ArrayLiteralExpression | undefined
  walkAst(relPath, (node) => {
    if (routes || !ts.isFunctionDeclaration(node) || node.name?.text !== 'buildHttpRoutes') return
    const visit = (inner: ts.Node): void => {
      if (routes) return
      if (ts.isReturnStatement(inner) && inner.expression && ts.isArrayLiteralExpression(inner.expression)) {
        routes = inner.expression
        return
      }
      ts.forEachChild(inner, visit)
    }
    visit(node)
  })
  assert.ok(routes, 'src/host/http.ts 必须仍有 buildHttpRoutes(...)，且**返回数组字面量**（动态拼表会让冻结判据失效）')
  const { file } = parse(relPath)
  return routes.elements.map((element) => {
    const text = element.getText(file)
    const method = /method:\s*'([A-Z]+)'/.exec(text)?.[1] ?? '?'
    // 路径是模板串 `${BRIDGE_ROUTE}/snapshot` —— 只取静态尾段（前缀由 BRIDGE_ROUTE 单点决定）。
    const tail = /\/([a-z]+)`/.exec(text)?.[1] ?? '?'
    return `${method} /${tail}`
  })
}

/** 收集所有 `{ kind: 'prefix' }` 宿主路由注册点（宿主 WebRoute 只有这一个 shape）。 */
function prefixRegistrations(): string[] {
  const hits: string[] = []
  for (const relPath of HOST_FILES) {
    walkAst(relPath, (node, file) => {
      if (!ts.isObjectLiteralExpression(node)) return
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        if (property.name.getText(file) !== 'kind') continue
        const value = property.initializer
        if (!ts.isStringLiteral(value) || value.text !== 'prefix') continue
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
        hits.push(`${relPath}:${line + 1}`)
      }
    })
  }
  return hits
}

test('setInterval 全仓只有 1 处调用，且必须在成员看护器里（AC-11：暂停/继续不得另起心跳）', () => {
  const sites = callSites('setInterval', ['src/host', 'src/client'], ['.ts', '.tsx'])
  assert.equal(sites.length, 1, `定时器必须单点（唯一 setInterval），实际 ${sites.length} 处：${sites.join('、')}`)
  assert.ok(
    sites[0]?.startsWith('src/host/team/watcher.ts:'),
    `唯一 setInterval 必须在 src/host/team/watcher.ts（暂停语义也在那里），实际 ${sites[0]}`,
  )
})

test('面板 HTTP 桥恰好 4 条路由（r13 AC-22：历史详情走 /library?runId=，不新增第 5 条），且经 1 条宿主 prefix 路由暴露', () => {
  assert.deepEqual(
    httpRouteTable().sort(),
    ['GET /library', 'GET /memory', 'GET /snapshot', 'POST /act'],
    `面板接口必须恰是这 4 条（历史详情复用 /library 的 runId 参数，不新增第 5 条），实际 ${httpRouteTable().join('、')}`,
  )
  const prefixes = prefixRegistrations()
  assert.equal(prefixes.length, 1, `宿主只许注册 1 条 prefix 路由（4 条内部路由合成 1 条），实际 ${prefixes.join('、')}`)
  assert.ok(
    prefixes[0]?.startsWith('src/host/adapters.ts:'),
    `宿主路由的唯一注册处必须是 src/host/adapters.ts（其余模块不许直接碰 ctx.webServer），实际 ${prefixes[0]}`,
  )
})

/** 收集「数据根字面量」出现的位置（字符串与模板串静态片段都算，注释里的不算）。 */
function dataRootLiterals(dirs: readonly string[]): string[] {
  const LITERALS = ['.dsh/auto-team', '.dsh\\auto-team'] as const
  const hits: string[] = []
  for (const dir of dirs) {
    for (const relPath of sourceFiles(dir, ['.ts', '.tsx'])) {
      walkAst(relPath, (node, file) => {
        const isText =
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        if (!isText) return
        const text = (node as ts.LiteralLikeNode).text
        if (!LITERALS.some((literal) => text.includes(literal))) return
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
        hits.push(`${relPath}:${line + 1}`)
      })
    }
  }
  return hits
}

test('数据根只在 paths.ts 里推导（AC-6：多拼一层 .dsh 会让 settings.json 落到错目录）', () => {
  const hits = dataRootLiterals(['src/host', 'src/client'])
  const outside = hits.filter((where) => !where.startsWith('src/host/paths.ts:'))
  assert.deepEqual(outside, [], `数据根只许在 src/host/paths.ts 里拼（settings/roles/runs 都从 globalDataRoot 派生）：${outside.join('、')}`)
  assert.ok(
    hits.some((where) => where.startsWith('src/host/paths.ts:')),
    'src/host/paths.ts 必须仍是数据根的唯一推导处（globalDataRoot）',
  )
})

test('ActivityEvent.kind 仍是 9 态（r7 不加新活动类型：面板改的是渲染，不是事件源）', () => {
  const { file } = parse('src/shared/types.ts')
  let kinds: string[] = []
  const visit = (node: ts.Node): void => {
    if (kinds.length === 0 && ts.isInterfaceDeclaration(node) && node.name.text === 'ActivityEvent') {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || member.name.getText(file) !== 'kind' || !member.type) continue
        if (!ts.isUnionTypeNode(member.type)) continue
        kinds = member.type.types
          .filter((item): item is ts.LiteralTypeNode => ts.isLiteralTypeNode(item))
          .map((item) => (item.literal as ts.StringLiteral).text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(kinds.length, 9, `ActivityEvent.kind 必须仍是 9 态，实际 ${kinds.length}：${kinds.join(', ')}`)
})

/**
 * 判据可分辨性自检（本项目的头号判据事故是「恒绿」）：
 * 三条冻结守卫必须能在一个**合成的违规样本**上真的判红。
 *
 * 这里不临时改真实源码（并行开发期改 src 会互相覆盖），而是在临时目录造三份小样本，
 * 直接喂给上面同一批扫描函数：能扫出 2 处 setInterval / 1 处越界数据根 / 少一条路由，
 * 就说明「=== 1 / 只在 paths.ts / === 3」这些数字不是装饰。
 */
test('冻结守卫可分辨：合成违规样本必须被判红（否则守卫只是恒绿）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-guard-'))
  const timerFile = join(dir, 'two-timers.ts')
  writeFileSync(
    timerFile,
    ['const a = setInterval(() => {}, 1000)', 'const b = globalThis.setInterval(() => {}, 10)', 'export { a, b }', ''].join('\n'),
    'utf8',
  )
  const rootFile = join(dir, 'bad-root.ts')
  writeFileSync(rootFile, ["import { join } from 'node:path'", "export const p = join('/home/x', '.dsh/auto-team/settings.json')", ''].join('\n'), 'utf8')
  const httpFile = join(dir, 'http-bad.ts')
  writeFileSync(
    httpFile,
    [
      'export function buildHttpRoutes(deps) {',
      '  return [',
      "    { method: 'GET', path: `${BRIDGE_ROUTE}/snapshot`, handle: () => deps },",
      '  ]',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )

  // ① 计数器必须能数到 2（真仓断言「=== 1」才有信息量）
  const timers = callSites('setInterval', [dir], ['.ts'])
  assert.equal(timers.length, 2, `扫描必须能同时数到 a() 与 globalThis.setInterval()，实际 ${timers.join('、')}`)
  // ② 越界数据根必须被扫到（且能点出行号）
  const roots = dataRootLiterals([dir])
  assert.equal(roots.length, 1, `越界数据根必须被抓到，实际 ${roots.join('、') || '0 处'}`)
  assert.ok(roots[0]?.startsWith(`${dir}/bad-root.ts:`), `必须点出越界位置，实际 ${roots[0]}`)
  // ③ 路由表读取必须能读出「只有 1 条」，即真仓的「=== 3」是可分辨的
  assert.deepEqual(httpRouteTable(httpFile), ['GET /snapshot'], '路由表读取必须能在样本上给出真实条目')
})
