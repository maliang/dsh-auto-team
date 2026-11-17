#!/usr/bin/env node
/**
 * r41 QA 变异自检（任务卡要求 ≥2 条，且必须字节还原）。
 *
 * 目的：证明 `test/r41-idle-silent-finish.test.ts` 不是「怎么改都绿」的摆设——
 *   M1  去掉 idle 防误报护栏（`src/host/index.ts:377`）→ 第 2 条（刚 spawn 就 idle）必须变红；
 *   M2  把按 root 分组的名单 Map 换回「只取一次、全部复用」（`src/host/team/watcher.ts:440`）
 *       → 第 4 条（跨 root）必须变红。
 *
 * 纪律：
 *  - 先确认基线全绿，否则变异结论无意义；
 *  - 每次变异只做**一次**精确替换（替换次数必须恰好 1），避免误改别处；
 *  - 变异后断言「预期的**那条**用例失败」，不是「有任何一条红」；
 *  - 还原用内存里的原始字节（Buffer），还原后 sha256 必须与变异前逐字节一致，再跑一次确认回绿；
 *  - 任何一步失败都以非 0 退出（门禁可以据此判红）。
 *
 * 用法：node test/r41-mutation-probes.mjs   （在仓库根跑，从归档目录跑会因相对路径失败）
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const TEST_FILE = 'test/r41-idle-silent-finish.test.ts'
const EVIDENCE_DIR = join(ROOT, 'docs/teamflow/2026-11-17-r41-idle-silent-finish')
const REPORT = join(EVIDENCE_DIR, 'mutation-evidence.json')

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

function runTests() {
  const result = spawnSync(process.execPath, ['--test', TEST_FILE], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const failed = [...new Set([...output.matchAll(/^✖ (.+?)(?: \(\d[\d.]*ms\))?$/gm)].map((match) => match[1].trim()))]
  const summary = /ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(output)
  return {
    exitCode: result.status,
    failed,
    counts: summary === null ? null : { tests: Number(summary[1]), pass: Number(summary[2]), fail: Number(summary[3]) },
    tail: output.trim().split('\n').slice(-8).join('\n'),
  }
}

const MUTATIONS = [
  {
    id: 'M1',
    name: '去掉 idle 防误报护栏',
    file: 'src/host/index.ts',
    line: 377,
    from: 'if (!memberSawWork.has(info.memberId)) return',
    to: 'if (!memberSawWork.has(info.memberId)) { /* M1：护栏被移除，刚 spawn 的 idle 也落标 */ }',
    mustFail: 'r41 误报护栏：刚 spawn 就收到 idle（本轮从未 running/推进）→ 不落 silentFinish、任务仍 running',
  },
  {
    id: 'M2',
    name: 'Map 换回单变量（第一个 root 的名单复用给所有 root）',
    file: 'src/host/team/watcher.ts',
    line: 440,
    from: 'let members = membersByRoot.get(rootId)',
    to: 'let members = membersByRoot.get(rootId) ?? (membersByRoot.size === 0 ? undefined : [...membersByRoot.values()][0])',
    mustFail: 'r41 跨 root：两个 run 各取自己的名单（旧实现单变量 → 两次调用/第二个 run 失联断言必须红）',
  },
]

const evidence = { generatedAt: new Date().toISOString(), testFile: TEST_FILE, baseline: null, mutations: [] }

// 1) 基线必须全绿（否则变异红不代表变异有效）。
process.stdout.write(`[baseline] node --test ${TEST_FILE}\n`)
const baseline = runTests()
evidence.baseline = baseline
if (baseline.exitCode !== 0 || (baseline.counts?.fail ?? 1) !== 0) {
  process.stderr.write(`基线不是全绿，变异自检无意义：exit=${baseline.exitCode}\n${baseline.tail}\n`)
  writeFileSync(REPORT, JSON.stringify(evidence, null, 2))
  process.exit(1)
}
process.stdout.write(`[baseline] exit=0 tests=${baseline.counts?.tests} pass=${baseline.counts?.pass} fail=0\n`)

for (const mutation of MUTATIONS) {
  const path = join(ROOT, mutation.file)
  const original = readFileSync(path)
  const before = sha256(original)
  const beforeText = original.toString('utf8')
  const occurrences = beforeText.split(mutation.from).length - 1
  if (occurrences !== 1) {
    process.stderr.write(`${mutation.id} 目标片段命中 ${occurrences} 次（必须恰好 1 次），变异无法安全执行\n`)
    process.exit(1)
  }

  const mutatedText = beforeText.replace(mutation.from, mutation.to)
  writeFileSync(path, mutatedText, 'utf8')
  const after = sha256(readFileSync(path))
  process.stdout.write(`\n[${mutation.id}] ${mutation.name} @ ${mutation.file}:${mutation.line}\n  sha256 ${before} -> ${after}\n`)

  const mutated = runTests()
  const red = mutated.exitCode !== 0 && mutated.failed.includes(mutation.mustFail)
  process.stdout.write(`  test exit=${mutated.exitCode} failed=[${mutated.failed.join(' | ')}]\n`)
  process.stdout.write(`  预期红：${mutation.mustFail}\n  结果：${red ? 'RED（符合预期）' : '不是预期红 —— 变异自检失败'}\n`)

  // 无论断言结果如何都先还原，避免把变异留在工作树里。
  writeFileSync(path, original)
  const restored = sha256(readFileSync(path))
  const restoredOk = restored === before
  const post = runTests()
  const green = post.exitCode === 0 && (post.counts?.fail ?? 1) === 0
  process.stdout.write(`  还原 sha256=${restored}（与变异前一致：${restoredOk ? 'yes' : 'NO'}）；还原后 test exit=${post.exitCode} fail=${post.counts?.fail}\n`)

  evidence.mutations.push({
    id: mutation.id,
    name: mutation.name,
    target: `${mutation.file}:${mutation.line}`,
    replacement: { from: mutation.from, to: mutation.to },
    sha256Before: before,
    sha256Mutated: after,
    sha256Restored: restored,
    restoredByteIdentical: restoredOk,
    expectedRedTest: mutation.mustFail,
    mutatedExitCode: mutated.exitCode,
    mutatedFailed: mutated.failed,
    redAsExpected: red,
    postRestoreExitCode: post.exitCode,
    postRestoreFail: post.counts?.fail ?? null,
    postRestoreGreen: green,
  })

  if (!red || !restoredOk || !green) {
    writeFileSync(REPORT, JSON.stringify(evidence, null, 2))
    process.stderr.write(`\n${mutation.id} 变异自检失败（预期红=${red} 字节还原=${restoredOk} 回绿=${green}），已还原源码，停止。\n`)
    process.exit(1)
  }
}

mkdirSync(EVIDENCE_DIR, { recursive: true })
writeFileSync(REPORT, JSON.stringify(evidence, null, 2))
process.stdout.write(`\n[matrix] ${evidence.mutations.map((m) => `${m.id}@${m.target} red=${m.redAsExpected} restored=${m.restoredByteIdentical} green=${m.postRestoreGreen}`).join('  ')}\n`)
process.stdout.write(`[report] ${REPORT}\n`)
