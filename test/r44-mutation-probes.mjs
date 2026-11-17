#!/usr/bin/env node
/**
 * r44 QA 变异自检（t6 任务卡要求 ≥2 条必红，这里给 3 条）。
 *
 * 目的：证明 `test/r44-http-admission.test.ts` 与 `...-warn.test.ts` 不是「怎么改都绿」的摆设：
 *   M1 把 `refusalOf` 调用从「查 route 之前」挪到「route.handle 之后」
 *      → 403/401 用例的 `handleCalls === 0` 变 1（`src/host/adapters.ts` handler）；
 *   M2 去掉模块级告警去重（`warnedNoConnection`）
 *      → 降级用例的三次请求推三条告警，`warnings.length === 1` 变红；
 *   M3 把 401/403 的响应体写反
 *      → `body === 'forbidden'` / `'unauthorized'` 断言变红。
 *
 * 纪律（沿用 r41 探针）：
 *  - 先确认基线全绿，否则变异结论无意义；
 *  - 每次变异只做精确替换，且每个目标片段命中次数必须恰好 1；
 *  - 断言「预期的**那条**用例失败」，不是「有任何一条红」；
 *  - 还原用内存里的原始字节（Buffer），sha256 必须与变异前一致，再跑一次确认回绿；
 *  - 任何一步失败都以非 0 退出（门禁可据此判红）。
 *
 * 用法：node test/r44-mutation-probes.mjs   （必须在仓库根跑；从归档目录跑会因相对根失败）
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const TEST_FILES = ['test/r44-http-admission.test.ts', 'test/r44-http-admission-warn.test.ts']
const EVIDENCE_DIR = join(ROOT, 'docs/teamflow/2026-11-17-r44-http-admission')
const REPORT = join(EVIDENCE_DIR, 'mutation-evidence.json')

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

function runTests() {
  const result = spawnSync(process.execPath, ['--test', ...TEST_FILES], {
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
    name: '把准入挪到 route.handle 之后（读 body / 执行面板动作之后才拒绝）',
    file: 'src/host/adapters.ts',
    replacements: [
      {
        from:
          "          const refusal = refusalOf(ctx, req)\n" +
          "          if (refusal !== undefined) {\n" +
          "            res.statusCode = refusal\n" +
          "            res.end(refusal === 401 ? 'unauthorized' : 'forbidden')\n" +
          "            return\n" +
          "          }\n\n",
        to: '',
      },
      {
        from: '            const result = await route.handle({ method, pathname, url, json: async () => body })\n',
        to:
          '            const result = await route.handle({ method, pathname, url, json: async () => body })\n' +
          '            const refusal = refusalOf(ctx, req)\n' +
          '            if (refusal !== undefined) {\n' +
          '              res.statusCode = refusal\n' +
          "              res.end(refusal === 401 ? 'unauthorized' : 'forbidden')\n" +
          '              return\n' +
          '            }\n',
      },
    ],
    mustFail: 'r44 准入：403 拒绝 → 403 / forbidden，且 route.handle 计数为 0',
  },
  {
    id: 'M2',
    name: '去掉模块级告警去重（connection 缺失时每请求都 warn）',
    file: 'src/host/adapters.ts',
    replacements: [
      {
        from: '  if (warnedNoConnection) return\n  warnedNoConnection = true\n',
        to: '  /* M2：去重被移除，每次请求都会 warn */\n',
      },
    ],
    mustFail: 'r44 准入降级：connection 缺失 → 放行，且整个进程只 warn 一条',
  },
  {
    id: 'M3',
    name: '把 401 / 403 的响应体写反',
    file: 'src/host/adapters.ts',
    replacements: [
      {
        from: "          res.end(refusal === 401 ? 'unauthorized' : 'forbidden')\n",
        to: "          res.end(refusal === 401 ? 'forbidden' : 'unauthorized')\n",
      },
    ],
    mustFail: 'r44 准入：403 拒绝 → 403 / forbidden，且 route.handle 计数为 0',
  },
]

const evidence = {
  generatedAt: new Date().toISOString(),
  testFiles: TEST_FILES,
  baseline: null,
  mutations: [],
}

process.stdout.write(`[baseline] node --test ${TEST_FILES.join(' ')}\n`)
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
  let mutatedText = original.toString('utf8')

  for (const [index, replacement] of mutation.replacements.entries()) {
    const occurrences = mutatedText.split(replacement.from).length - 1
    if (occurrences !== 1) {
      process.stderr.write(
        `${mutation.id} 第 ${index + 1} 段目标命中 ${occurrences} 次（必须恰好 1 次），变异无法安全执行\n`,
      )
      writeFileSync(REPORT, JSON.stringify(evidence, null, 2))
      process.exit(1)
    }
    mutatedText = mutatedText.replace(replacement.from, replacement.to)
  }

  writeFileSync(path, mutatedText, 'utf8')
  const after = sha256(readFileSync(path))
  process.stdout.write(`\n[${mutation.id}] ${mutation.name} @ ${mutation.file}\n  sha256 ${before} -> ${after}\n`)

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
  process.stdout.write(
    `  还原 sha256=${restored}（与变异前一致：${restoredOk ? 'yes' : 'NO'}）；还原后 exit=${post.exitCode} fail=${post.counts?.fail}\n`,
  )

  evidence.mutations.push({
    id: mutation.id,
    name: mutation.name,
    target: mutation.file,
    replacements: mutation.replacements,
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
process.stdout.write(
  `\n[matrix] ${evidence.mutations.map((m) => `${m.id}@${m.target} red=${m.redAsExpected} restored=${m.restoredByteIdentical} green=${m.postRestoreGreen}`).join('  ')}\n`,
)
process.stdout.write(`[report] ${REPORT}\n`)
