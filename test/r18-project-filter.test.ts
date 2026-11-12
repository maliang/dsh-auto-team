/**
 * r18 t3：项目库左栏「只显示用过自动团队的项目」（`project.runs > 0`）。
 *
 * 判据分两层：
 *  1) 行为层：直接驱动纯函数 `visibleProjectsOf`（`node --test` 不转 JSX，组件跑不起来）；
 *  2) 契约层：用 fs 读 `LibraryPage.tsx` 源码，断言它真的用了这个函数、计数用过滤后长度、
 *     选中项被过滤掉时有回落 —— 属于本仓 client-contract / client-ui 的既有写法。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { visibleProjectsOf } from '../src/client/project-filter.ts'
import type { ProjectView } from '../src/shared/types.ts'

function projectOf(id: string, runs: number, extra: Partial<ProjectView> = {}): ProjectView {
  return {
    id,
    name: id,
    runs,
    usage: { source: 'unavailable' },
    recentRuns: [],
    memories: [],
    ...extra,
  }
}

/** LibraryPage 源码去注释：断言「真的调用了」时不能被注释里的同名文字骗过。 */
function libraryCode(): string {
  return readFileSync(new URL('../src/client/LibraryPage.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/* ────────────────────────── 行为层：纯函数 ────────────────────────── */

test('runs > 0 保留、runs = 0 丢弃，且保持宿主给的顺序（不重排）', () => {
  const list = [
    projectOf('alpha', 1),
    projectOf('beta', 0),
    projectOf('gamma', 3),
    projectOf('zero', 0),
  ]
  assert.deepEqual(
    visibleProjectsOf(list).map((project) => project.id),
    ['alpha', 'gamma'],
    '只保留有过 run 的项目，顺序与入参一致',
  )
})

test('unknown 历史桶同样按 runs 过滤：0 次运行隐藏，>0 保留', () => {
  const emptyHistory = projectOf('history-empty', 0, { unknown: true, name: '历史运行（未记录工作区）' })
  const usedHistory = projectOf('history-used', 2, { unknown: true, name: '历史运行（未记录工作区）' })
  assert.deepEqual(visibleProjectsOf([emptyHistory, usedHistory]).map((project) => project.id), ['history-used'])
  assert.deepEqual(visibleProjectsOf([emptyHistory]), [], '0 次运行的历史桶不能留一个空桶在列表里')
})

test('空数组、全 0 run 都得到空数组', () => {
  assert.deepEqual(visibleProjectsOf([]), [])
  assert.deepEqual(visibleProjectsOf([projectOf('a', 0), projectOf('b', 0)]), [])
})

test('不修改入参、不改对象字段（返回同一批对象引用）', () => {
  const kept = projectOf('kept', 5, { name: '保留下来的项目' })
  const dropped = projectOf('dropped', 0)
  const list = [kept, dropped]
  const out = visibleProjectsOf(list)
  assert.deepEqual(out, [kept], '字段原样透传，不做裁剪/改写')
  assert.equal(out[0], kept, '同一对象引用：过滤层不复制、不重建项目')
  assert.deepEqual(list, [kept, dropped], '入参数组与对象均未被修改')
})

/* ────────────────────────── 契约层：LibraryPage ────────────────────────── */

test('LibraryPage 通过可见性纯函数过滤，且没有第二套 runs 判断', () => {
  const code = libraryCode()
  assert.match(code, /import \{ visibleProjectsOf \} from '\.\/project-filter\.ts'/, '必须从纯函数模块引入')
  assert.match(code, /visibleProjectsOf\(library\?\.projects \?\? \[\]\)/, '过滤必须作用在 library.projects 上')
  assert.equal(/runs\s*>\s*0/.test(code), false, 'runs 判断只许待在该纯函数里，页面不得内联第二份')
})

test('顶部「N 个项目」与 data-project-count 都用过滤后的长度', () => {
  const code = libraryCode()
  assert.match(code, /data-project-count=\{projects\.length\}/, '计数据钩子必须用过滤后的 projects')
  assert.match(code, /`\$\{projects\.length\} 个项目`/, '副标题计数据必须用过滤后的 projects')
  assert.equal(/library\??\.projects\.length/.test(code), false, '不得绕过过滤直接数 library.projects')
})

test('选中项被过滤掉时有回落：第一个可见项目，否则「全局」', () => {
  const code = libraryCode()
  assert.match(
    code,
    /projects\.some\(\(project\) => project\.id === storedId\)/,
    '先判断选中 id 是否仍在可见列表里',
  )
  assert.match(code, /projects\[0\]\?\.id \?\? 'global'/, '不可见时回落到第一个可见项目；一个不剩回「全局」')
})
