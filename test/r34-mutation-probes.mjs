#!/usr/bin/env node
/**
 * r34 QA · 变异探针（3 条）：证明「残留判定收紧」的断言真的抓得住实现回退。
 *
 * 需求口径（用户 2026-11-13）：**确认没有存活成员才提示残留**。三条探针分别把三个判据改回错误版本：
 *   P1  去掉 `liveMembers === 0` 判据（`return true`）      → 客户端 ①（liveMembers>0 不提示）必须红；
 *   P2  把未知写成 0（`(liveMembers ?? 0) === 0`）          → 客户端 ③（undefined 不提示）必须红；
 *   P3  宿主把读失败写成 0（`liveMemberCountOf` 的 unknown 分支 `return 0`）
 *                                                          → 宿主 ③（字段缺失而不是 0）必须红。
 *
 * 做法与 r16 一致（全程不碰工作区）：复制 `src/`、`test/` 与类型/构建配置到系统临时目录，先在原样副本上
 * 跑目标用例（必须 exit 0 且标题真的出现在输出里——`node --test` 在 name-pattern 一条都没命中时会把整个
 * 文件算 pass），再派生一份只打该补丁的副本，必须 exit != 0 且失败证据命中 `AssertionError`。
 *
 * 用法：
 *   node test/r34-mutation-probes.mjs          # 3 条全过才 exit 0
 *   node test/r34-mutation-probes.mjs --keep   # 保留临时副本便于人工复查
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
const TMP = mkdtempSync(join(tmpdir(), 'auto-team-r34-probes-'))
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

/** 精确替换一个锚点，命中次数必须恰好 1（补丁没打上时必须整体失败，不能误判成「测试抓不住」）。 */
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
    id: 'P1',
    name: '去掉 liveMembers===0 判据：正在推进的 run 又会被提示「可能残留」',
    check: { file: 'test/r34-live-members-residual.test.ts', pattern: 'r34 ①', timeoutMs: 10000 },
    testTitle: 'liveMembers>0：正在推进的 run 不判残留',
    expectRed: /AssertionError/,
    mutate: (dir) =>
      replaceOnce(
        dir,
        'src/client/viewmodel.ts',
        '  return run.liveMembers === 0',
        '  return true',
      ),
  },
  {
    id: 'P2',
    name: '把未知写成 0（?? 0）：读不到存活成员时又会被当成「确认没人」而提示',
    check: { file: 'test/r34-live-members-residual.test.ts', pattern: 'r34 ③', timeoutMs: 10000 },
    testTitle: 'liveMembers===undefined（宿主读不到）',
    expectRed: /AssertionError/,
    mutate: (dir) =>
      replaceOnce(
        dir,
        'src/client/viewmodel.ts',
        '  return run.liveMembers === 0',
        '  return (run.liveMembers ?? 0) === 0',
      ),
  },
  {
    id: 'P3',
    name: '宿主把「名单读失败」写成 0：客户端从「不知道」变成「确实没人」，残留提示会误挂',
    check: { file: 'test/r34-host-live-members.test.ts', pattern: 'r34 宿主 ③', timeoutMs: 20000 },
    testTitle: '名单读失败或没有读口',
    expectRed: /AssertionError/,
    mutate: (dir) =>
      replaceOnce(
        dir,
        'src/host/bridge.ts',
        `    if (memberRoster === null || !('rows' in memberRoster)) return undefined
    return aliveMemberNamesOf(live, memberRoster.rows).length`,
        `    if (memberRoster === null || !('rows' in memberRoster)) return 0
    return aliveMemberNamesOf(live, memberRoster.rows).length`,
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
  const clean = output.replace(/\[[0-9;]*m/g, '')
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
  const clean = output.replace(/\[[0-9;]*m/g, '')
  return clean.split(/\r?\n/).slice(-count).join('\n')
}

function main() {
  console.log(`r34 残留判定变异探针：${PROBES.length} 条（副本在 ${TMP}）`)
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

if (!existsSync(join(REPO, 'src', 'client', 'viewmodel.ts'))) {
  console.error(`[env] 找不到 ${REPO}/src/client/viewmodel.ts：请从仓库根运行本脚本。`)
  process.exitCode = 1
} else {
  main()
}
