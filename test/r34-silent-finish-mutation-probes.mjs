#!/usr/bin/env node
/**
 * r34 QA · 「待回执」变异探针（4 条）：证明验收断言抓得住实现回退。
 *
 * 每条探针把实现改回一个**具体的错误版本**，目标用例必须变红；原样副本必须绿
 * （且标题真的出现在输出里 —— `node --test` 在 name-pattern 一条都没命中时会把整个文件算 pass）。
 *
 *   M1  去掉「无证据」判据（`task.evidence !== undefined` 短路）
 *        → `isSilentFinish` 矩阵必须红（有证据的任务会被误记成待回执）
 *   M2  轮询路径不写标（`reconcileMembers` 里的判定整段短路）
 *        → 轮询用例必须红（事件源降级时再也判不出来 —— 正是 r33 的事故形态）
 *   M3  `recordSilentFinish` 去掉 `silentFinish` 早退（重复呼叫重复写消息）
 *        → 事件路径幂等用例必须红（同一成员重复终结事件 → 通知 2 条）
 *   M4  删掉 `src/host/index.ts` 里的事件接线（函数都对，但没人调用）
 *        → 事件路径用例必须红（只有纯函数单测时这条删掉也全绿）
 *
 * 做法与 r16/r34 一致（全程不碰工作区）：复制 `src/`、`test/` 与构建配置到系统临时目录，
 * 先在原样副本跑目标用例，再派生一份只打该补丁的副本，必须 exit != 0 且命中 AssertionError。
 *
 * 用法：
 *   node test/r34-silent-finish-mutation-probes.mjs          # 4 条全过才 exit 0
 *   node test/r34-silent-finish-mutation-probes.mjs --keep   # 保留临时副本便于复查
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../', import.meta.url))
const KEEP = process.argv.includes('--keep')
const TMP = mkdtempSync(join(tmpdir(), 'auto-team-r34-silent-probes-'))
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' }
const MAX_BUFFER = 8 * 1024 * 1024

/* ────────────────────────── 副本与补丁 ────────────────────────── */

function makeTree(name) {
  const dir = join(TMP, name)
  mkdirSync(dir, { recursive: true })
  for (const entry of ['src', 'test']) {
    cpSync(join(REPO, entry), join(dir, entry), { recursive: true })
  }
  for (const entry of ['package.json', 'tsconfig.json', 'tsdown.config.ts', 'tsdown.host.config.ts']) {
    cpSync(join(REPO, entry), join(dir, entry))
  }
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'), 'dir')
  return dir
}

/** 精确替换一个锚点，命中次数必须恰好 1（补丁没打上必须整体失败，不能误判成「测试抓不住」）。 */
function replaceOnce(dir, relPath, from, to) {
  const file = join(dir, relPath)
  const source = readFileSync(file, 'utf8')
  const hits = source.split(from).length - 1
  if (hits !== 1) {
    throw new Error(`补丁锚点在 ${relPath} 命中 ${hits} 次（必须恰好 1 次）：${from.trim().slice(0, 120)}`)
  }
  writeFileSync(file, source.replace(from, () => to))
}

/* ────────────────────────── 探针定义 ────────────────────────── */

const PROBES = [
  {
    id: 'M1',
    name: '去掉「无证据」判据：有门禁证据的 running 任务会被误记成待回执',
    check: { file: 'test/silent-finish.test.ts', pattern: 'isSilentFinish：running', timeoutMs: 10000 },
    testTitle: 'isSilentFinish：running + 未退休绑定 + 成员已停 + 无证据 才命中',
    expectRed: /AssertionError/,
    mutate: (dir) =>
      replaceOnce(
        dir,
        'src/host/team/silent-finish.ts',
        '  if (task.evidence !== undefined) return false',
        '  if (task.evidence !== undefined && false) return false',
      ),
  },
  {
    id: 'M2',
    name: '轮询路径不写标：事件源降级时再也判不出「成员停了、任务还在跑」',
    check: { file: 'test/silent-finish.test.ts', pattern: 'reconcileMembers（轮询路）：宿主归一 inactive', timeoutMs: 10000 },
    testTitle: 'reconcileMembers（轮询路）：宿主归一 inactive → 记待回执 + 一条通知；第二次对账不重复',
    expectRed: /AssertionError/,
    mutate: (dir) =>
      replaceOnce(
        dir,
        'src/host/team/watcher.ts',
        '    if (binding !== undefined && isSilentFinish({ task, binding, memberStopped: status === \'dead\' })) {',
        '    if (false && binding !== undefined && isSilentFinish({ task, binding, memberStopped: status === \'dead\' })) {',
      ),
  },
  {
    id: 'M3',
    name: 'recordSilentFinish 去掉 silentFinish 早退：重复终结事件会重复通知队长',
    check: { file: 'test/r34-silent-finish-wire.test.ts', pattern: 'r34 事件路径', timeoutMs: 20000 },
    testTitle: 'r34 事件路径：真实 apply() 收到 subagent/end → 落盘 silentFinish + 恰一条 captain→user 通知',
    expectRed: /AssertionError/,
    mutate: (dir) =>
      replaceOnce(
        dir,
        'src/host/team/watcher.ts',
        '    task.evidence !== undefined ||\n    task.silentFinish !== undefined\n  ) {',
        '    task.evidence !== undefined\n  ) {',
      ),
  },
  {
    id: 'M4',
    name: '删掉事件接线：判定函数都在，但 subagent/end 永远不会调用它们',
    check: { file: 'test/r34-silent-finish-wire.test.ts', pattern: 'r34 事件路径', timeoutMs: 20000 },
    testTitle: 'r34 事件路径：真实 apply() 收到 subagent/end → 落盘 silentFinish + 恰一条 captain→user 通知',
    expectRed: /AssertionError/,
    mutate: (dir) =>
      replaceOnce(
        dir,
        'src/host/index.ts',
        `            const task = next.plan.tasks.find((item) => item.id === binding.taskId)
            if (task !== undefined && isSilentFinish({ task, binding, memberStopped: true })) {
              next = recordSilentFinish(next, {
                taskId: task.id,
                memberId: binding.memberId,
                memberName: binding.name,
                at,
              })
            }
`,
        '',
      ),
  },
]

/* ────────────────────────── 执行与判读 ────────────────────────── */

function runCheck(dir, probe) {
  const started = Date.now()
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      `--test-timeout=${probe.check.timeoutMs}`,
      `--test-name-pattern=${probe.check.pattern}`,
      probe.check.file,
    ],
    { cwd: dir, encoding: 'utf8', timeout: 120000, env: ENV, maxBuffer: MAX_BUFFER },
  )
  return {
    status: result.status === null ? 1 : result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    ms: Date.now() - started,
  }
}

function evidenceOf(output) {
  const clean = output.replace(/\[[0-9;]*m/g, '')
  const lines = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const hit = lines.find((line) => /test timed out after|AssertionError/.test(line))
  if (hit !== undefined) return hit.slice(0, 240)
  const marks = lines.filter((line) => /^(?:✖|not ok)/.test(line))
  return (marks.at(-1) ?? '（exit != 0，但未匹配到断言/超时行）').slice(0, 240)
}

function tailOf(output, count) {
  const clean = output.replace(/\[[0-9;]*m/g, '')
  return clean.split(/\r?\n/).slice(-count).join('\n')
}

function main() {
  console.log(`r34「待回执」变异探针：${PROBES.length} 条（副本在 ${TMP}）`)
  const base = makeTree('base')
  const rows = []
  let failed = 0

  for (const probe of PROBES) {
    const baseline = runCheck(base, probe)
    const baselineGreen =
      baseline.status === 0 &&
      baseline.output.includes(probe.testTitle) &&
      !/✖/.test(baseline.output)
    if (!baselineGreen) {
      failed += 1
      rows.push({ probe, baseline, mutated: null, ok: false, reason: '原样副本不绿（基线坏了，不能做变异证明）' })
      continue
    }

    const dir = makeTree(`probe-${probe.id.toLowerCase()}`)
    try {
      probe.mutate(dir)
    } catch (error) {
      failed += 1
      rows.push({ probe, baseline, mutated: null, ok: false, reason: `补丁失败：${error.message}` })
      continue
    }

    const mutated = runCheck(dir, probe)
    const mutationRed = mutated.status !== 0 && probe.expectRed.test(mutated.output)
    rows.push({
      probe,
      baseline,
      mutated,
      ok: mutationRed,
      reason: mutationRed ? '' : `变异后没有按预期变红（exit ${mutated.status}）`,
    })
    if (!mutationRed) failed += 1
  }

  for (const row of rows) {
    const { probe, baseline, mutated } = row
    if (!row.ok) {
      console.log(`✖ [${probe.id}] ${probe.name}：${row.reason}`)
      console.log(`  baseline: exit ${baseline.status}，${baseline.ms}ms`)
      if (mutated !== null) {
        console.log(`  mutation: exit ${mutated.status}，${mutated.ms}ms`)
        console.log(`  evidence: ${evidenceOf(mutated.output)}`)
        console.log(`  tail:\n${tailOf(mutated.output, 8)}`)
      }
      continue
    }
    console.log(
      `✔ [${probe.id}] ${probe.name}：原样绿（exit 0，${baseline.ms}ms）→ 变异红（exit ${mutated.status}，${mutated.ms}ms）｜${evidenceOf(mutated.output)}`,
    )
  }

  if (failed === 0) {
    console.log(`\n${PROBES.length}/${PROBES.length} 探针通过：每条都「原样绿 + 变异红」`)
    if (!KEEP) rmSync(TMP, { recursive: true, force: true })
    return
  }
  process.exitCode = 1
  console.log(`\n${failed}/${PROBES.length} 探针未通过；现场保留在 ${TMP}`)
}

if (!existsSync(join(REPO, 'src', 'host', 'team', 'silent-finish.ts'))) {
  console.error(`[env] 找不到 ${REPO}/src/host/team/silent-finish.ts：请从仓库根运行本脚本。`)
  process.exitCode = 1
} else {
  main()
}
