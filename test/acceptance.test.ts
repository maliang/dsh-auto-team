/**
 * 验收模板单测（r11 AC-4/AC-5/AC-6/AC-7；node --test 直跑 TS 源）。
 *
 * AC-4 的判据是「每条模板在应当通过的样本上真跑 exit 0、在应当失败的样本上 exit ≠ 0」，
 * 所以这里**真的用 bash -c 跑 6 次**（3 条模板 × 通过/失败）。只断言字符串长什么样，
 * 会让「命令跑不起来」这种最贵的缺陷一路滑到门禁才爆。
 *
 * 反目标 4：模板里不许出现 `pnpm lint`（本仓无该脚本），本文件同时守住这一点。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ACCEPTANCE_TEMPLATES,
  ACCEPTANCE_TEMPLATE_BLOCK,
  emptyAcceptanceError,
  suggestAcceptance,
  type AcceptanceSuggestion,
} from '../src/host/plan/acceptance.ts'

/** 跑一条命令，返回退出码（真跑，不 mock；`bash -c` 与门禁同一条执行路径）。 */
function run(command: string, cwd: string): number {
  try {
    execFileSync('bash', ['-c', command], { cwd, stdio: 'ignore' })
    return 0
  } catch (error) {
    const status = (error as { status?: number | null }).status
    return typeof status === 'number' ? status : 1
  }
}

/** 在临时目录里跑一段生产者代码，退出后清理。 */
function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-acceptance-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/* ───────────────────────── ① 模板原文（逐字 + 禁 pnpm lint） ───────────────────────── */

test('三条模板逐字：pnpm typecheck / grep -RIn / test -n "$(git status)"', () => {
  assert.equal(ACCEPTANCE_TEMPLATES.length, 3)
  assert.equal(ACCEPTANCE_TEMPLATES[0], 'pnpm typecheck')
  assert.equal(ACCEPTANCE_TEMPLATES[1], "grep -RIn --fixed-strings '<标识符>' <scope> >/dev/null")
  assert.equal(ACCEPTANCE_TEMPLATES[2], 'test -n "$(git status --porcelain -- <路径>)"')

  for (const template of ACCEPTANCE_TEMPLATES) {
    assert.ok(ACCEPTANCE_TEMPLATE_BLOCK.includes(template), `模板块必须含原文：${template}`)
    assert.doesNotMatch(template, /pnpm lint/, '反目标 4：本仓没有 lint 脚本，模板里不许出现')
    assert.doesNotMatch(template, /人工检查|请确认/, '模板必须是可执行命令，不能是要人做的事')
  }
  // 三条各出现一次（复制第二份会让逐字断言在改模板时互相打架）
  for (const template of ACCEPTANCE_TEMPLATES) {
    assert.equal(ACCEPTANCE_TEMPLATE_BLOCK.split(template).length - 1, 1, `模板只能出现一次：${template}`)
  }
})

/* ───────────────────────── ② 选择顺序（AC-4/AC-5） ───────────────────────── */

test('选命令 ①：有写域 + 仓库有 typecheck 脚本 → pnpm typecheck（顺序优先于 lint/test）', () => {
  const hit = suggestAcceptance({
    title: '改派发',
    writeScopes: ['src/host/team/dispatch.ts'],
    scripts: ['build', 'test', 'typecheck', 'lint'],
  })
  assert.equal(hit.command, 'pnpm typecheck')
  assert.equal(hit.template, ACCEPTANCE_TEMPLATES[0])

  assert.equal(suggestAcceptance({ title: 'x', writeScopes: ['src'], scripts: ['test'] }).command, 'pnpm test')
  assert.equal(
    suggestAcceptance({ title: 'x', writeScopes: ['src'], scripts: ['lint', 'test'] }).command,
    'pnpm lint',
    '偏好顺序是 typecheck → lint → test，只在仓库真有该脚本时选中',
  )
  // 没有写域时不选脚本型：否则「改文档」也会跑全仓 typecheck
  assert.equal(suggestAcceptance({ title: 'x', scripts: ['typecheck'] }).command, null)
})

test('选命令 ②：标题/描述里有反引号标识符 → grep（scope 取写域首元素）', () => {
  const scoped = suggestAcceptance({
    title: '把 `suggestAcceptance` 接进 auto_team_plan',
    writeScopes: ['src/host'],
    scripts: [],
  })
  assert.equal(scoped.command, "grep -RIn --fixed-strings 'suggestAcceptance' src/host >/dev/null")
  assert.equal(scoped.template, ACCEPTANCE_TEMPLATES[1])

  const rootless = suggestAcceptance({ title: '检查 `createBridge` 的签名', description: '顺手 grep 一下' })
  assert.equal(rootless.command, "grep -RIn --fixed-strings 'createBridge' . >/dev/null", '无写域时 scope 用 .')

  // 含单引号的标识符会破坏 shell 引号：跳过它，退回下一条模板
  const quoted = suggestAcceptance({ title: "修 `it's`", writeScopes: ['src/a.ts'], scripts: [] })
  assert.equal(quoted.command, 'test -n "$(git status --porcelain -- src/a.ts)"')
})

test('选命令 ③：有写域但无标识符 → test -n "$(git status --porcelain -- <paths>)"', () => {
  const suggestion = suggestAcceptance({
    title: '调整计划页样式',
    writeScopes: ['./src/client/styles.ts/', 'src/client/ui.ts'],
  })
  assert.equal(suggestion.command, 'test -n "$(git status --porcelain -- src/client/styles.ts src/client/ui.ts)"')
  assert.equal(suggestion.template, ACCEPTANCE_TEMPLATES[2])
})

test('选命令 ④：什么都选不出 → command null，原因含「选不出」+ 三条模板 + 该补的参数（AC-5）', () => {
  const suggestion = suggestAcceptance({ title: '写一份说明文档' })
  assert.equal(suggestion.command, null)
  assert.match(suggestion.reason, /选不出/)
  for (const template of ACCEPTANCE_TEMPLATES) {
    assert.ok(suggestion.reason.includes(template), `原因里必须有模板原文：${template}`)
  }
  assert.match(suggestion.reason, /标识符/)
  assert.match(suggestion.reason, /路径/)
  assert.match(suggestion.reason, /脚本名/)
  assert.equal(suggestion.template, ACCEPTANCE_TEMPLATE_BLOCK)
})

/* ───────────────────────── ③ 三条模板真跑（AC-4：6 次） ───────────────────────── */

test('模板 ① 真跑：样本应过 exit 0 / 应败 exit ≠ 0', () => {
  withTempDir((dir) => {
    const pass = join(dir, 'pass')
    mkdirSync(pass)
    writeFileSync(join(pass, 'package.json'), JSON.stringify({ name: 'sample', scripts: { typecheck: 'exit 0' } }))
    const fail = join(dir, 'fail')
    mkdirSync(fail)
    writeFileSync(join(fail, 'package.json'), JSON.stringify({ name: 'sample', scripts: { typecheck: 'exit 3' } }))

    assert.equal(run('pnpm typecheck', pass), 0, 'typecheck 通过的样本必须 exit 0')
    const badCode = run('pnpm typecheck', fail)
    assert.notEqual(badCode, 0, 'typecheck 失败的样本必须 exit ≠ 0')
  })
})

test('模板 ② 真跑：标识符在范围内 exit 0 / 不在 exit ≠ 0', () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, 'src', 'host'), { recursive: true })
    writeFileSync(join(dir, 'src', 'host', 'plan.ts'), 'export function suggestAcceptance() {}\n')
    const hit = suggestAcceptance({
      title: '接 `suggestAcceptance`',
      writeScopes: ['src'],
      scripts: [],
    }).command
    assert.ok(hit !== null)
    assert.equal(run(hit, dir), 0, '标识符存在 → exit 0')

    const miss = suggestAcceptance({
      title: '接 `noSuchSymbolAnywhere`',
      writeScopes: ['src'],
      scripts: [],
    }).command
    assert.ok(miss !== null)
    assert.notEqual(run(miss, dir), 0, '标识符不存在 → exit ≠ 0')
  })
})

test('模板 ③ 真跑：范围内有改动 exit 0 / 工作树干净 exit ≠ 0', () => {
  withTempDir((dir) => {
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'ignore' })
    }
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1\n')
    git('init', '-q')
    git('add', '.')
    git('commit', '-qm', 'init')

    const command = suggestAcceptance({ title: '改 a.ts', writeScopes: ['src/a.ts'] }).command
    assert.ok(command !== null)

    assert.notEqual(run(command, dir), 0, '工作树干净 → test -n 失败（范围型门禁要求真有改动）')
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 2\n')
    assert.equal(run(command, dir), 0, '路径有未提交改动 → exit 0')
  })
})

/* ───────────────────────── ④ 空验收整批拒绝文案（AC-6/AC-7） ───────────────────────── */

test('空验收文案：点名违规任务、给出可抄命令、附三条模板原文', () => {
  const suggestions = new Map<string, AcceptanceSuggestion>([
    ['t1', suggestAcceptance({ title: '改派发', writeScopes: ['src/host'], scripts: ['typecheck'] })],
    ['t2', suggestAcceptance({ title: '写文档' })],
  ])
  const text = emptyAcceptanceError(
    [
      { id: 't1', title: '改派发' },
      { id: 't2' },
    ],
    suggestions,
  )

  assert.match(text, /拒绝/)
  assert.match(text, /t1（改派发）/)
  assert.match(text, /t2/)
  assert.match(text, /pnpm typecheck/, '能自动选中时必须把完整命令交出去（不是只给模板）')
  for (const template of ACCEPTANCE_TEMPLATES) {
    assert.ok(text.includes(template), `拒绝文案必须含模板原文：${template}`)
  }
  assert.equal(text.split(ACCEPTANCE_TEMPLATE_BLOCK).length - 1, 1, '模板块只能出现一次')
})

test('空验收文案：没有建议时也要给出该补什么，且不崩', () => {
  const text = emptyAcceptanceError([{ id: 't9' }])
  assert.match(text, /t9/)
  assert.match(text, /写域|标识符/)
  assert.ok(text.includes(ACCEPTANCE_TEMPLATE_BLOCK))
})
