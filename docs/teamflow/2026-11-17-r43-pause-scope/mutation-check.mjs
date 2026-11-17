#!/usr/bin/env node
/**
 * r43 变异自检（≥2 条）：证明 `test/r43-pause-scope.test.ts` 的两条关键断言**真的会红**。
 *
 * 纪律：每条变异都做「改坏 → 必红 → 字节还原（sha256 逐字节相同）→ 再跑必绿」。
 * 只改一行、只验证一条用例；还原放在 `finally`，脚本自身崩溃也不会把仓库留在变异态。
 *
 * 跑法（必须在仓库根，不能从归档目录跑 —— 相对根会解析错，见 AGENTS.md §4）：
 *   node docs/teamflow/2026-11-17-r43-pause-scope/mutation-check.mjs
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 锚定仓库根（本文件在 <repo>/docs/teamflow/<folder>/ 下，上三级即仓库根）。 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const TEST_FILE = 'test/r43-pause-scope.test.ts'

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

function runTests() {
  const result = spawnSync(process.execPath, ['--test', TEST_FILE], { cwd: ROOT, encoding: 'utf8' })
  const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  // 失败用例名出现在 "✖ 名称 (12.3ms)" 行；名称里的括号是全角，所以按「最后一个 (」切时长。
  const failed = [...out.matchAll(/^✖ (.+?) \([0-9.]+ms\)$/gm)].map((match) => match[1])
  const passed = Number((out.match(/^ℹ pass (\d+)$/m) ?? [])[1] ?? -1)
  const total = Number((out.match(/^ℹ tests (\d+)$/m) ?? [])[1] ?? -1)
  return { code: result.status, failed: [...new Set(failed)], passed, total }
}

const MUTATIONS = [
  {
    id: 'M1',
    name: 'resumeTeam 顺手解开任务级 paused（删掉「团队没冻过但有任务级记账」的守卫）',
    file: 'src/host/bridge.ts',
    find: 'if (restore[task.id] === undefined && state.taskPauses?.[task.id] !== undefined) return task',
    replace: '// [MUTATION-M1] 守卫被删除：团队继续会解开单卡暂停',
    expect: 'AC2 两级同时存在：resumeTeam 不解开单卡 paused，resumeTask 不解开团队暂停',
  },
  {
    id: 'M2',
    name: 'lastActivityAtOf 不计 taskPauses.at（暂停着等用户会被 30 分钟残留收口误杀）',
    file: 'src/host/store.ts',
    find: 'for (const record of Object.values(state.taskPauses ?? {})) bump(record?.at)',
    replace: '// [MUTATION-M2] 暂停时刻不再计入活动',
    expect: 'AC4 lastActivityAtOf 计入 taskPauses.at：暂停着等用户也算活动',
  },
]

const rows = []
let ok = true

function record(entry) {
  rows.push(entry)
  if (!entry.pass) ok = false
}

// ── 基线：未变异必须全绿 ────────────────────────────────────────────────
const baseline = runTests()
record({
  step: 'baseline（未变异）',
  expect: `exit 0，${TEST_FILE} 全绿`,
  actual: `exit ${baseline.code}，pass ${baseline.passed}/${baseline.total}`,
  pass: baseline.code === 0 && baseline.failed.length === 0,
})

// ── 逐条变异 ───────────────────────────────────────────────────────────
for (const mutation of MUTATIONS) {
  const path = join(ROOT, mutation.file)
  const original = readFileSync(path, 'utf8')
  const originalSha = sha256(original)
  const hits = original.split(mutation.find).length - 1
  if (hits !== 1) {
    record({
      step: `${mutation.id} 定位`,
      expect: `${mutation.file} 里目标行恰好 1 处`,
      actual: `${hits} 处`,
      pass: false,
    })
    continue
  }

  const mutated = original.replace(mutation.find, mutation.replace)
  record({
    step: `${mutation.id} 变异`,
    expect: `${mutation.file}：${mutation.find.slice(0, 60)}… → 替换为注释`,
    actual: `sha256 ${originalSha.slice(0, 12)}… → ${sha256(mutated).slice(0, 12)}…`,
    pass: mutated !== original,
  })

  let mutatedRun
  try {
    writeFileSync(path, mutated)
    mutatedRun = runTests()
  } finally {
    // 无论测试怎么挂，都必须把原始字节写回去。
    writeFileSync(path, original)
  }

  const restored = readFileSync(path, 'utf8')
  const restoredSha = sha256(restored)

  record({
    step: `${mutation.id} 变异后自检`,
    expect: `exit ≠ 0 且「${mutation.expect}」变红`,
    actual: `exit ${mutatedRun.code}；红：${mutatedRun.failed.join(' / ') || '（无）'}；绿 ${mutatedRun.passed}/${mutatedRun.total}`,
    pass: mutatedRun.code !== 0 && mutatedRun.failed.includes(mutation.expect),
  })

  record({
    step: `${mutation.id} 字节还原`,
    expect: `${mutation.file} sha256 与变异前逐字节相同（${originalSha.slice(0, 16)}…）`,
    actual: `sha256 ${restoredSha.slice(0, 16)}…${restoredSha === originalSha ? '（一致）' : '（不一致！）'}`,
    pass: restoredSha === originalSha,
  })

  const after = runTests()
  record({
    step: `${mutation.id} 还原后复跑`,
    expect: 'exit 0，全绿（证明上面变红是变异造成的，不是测试本来就不稳）',
    actual: `exit ${after.code}，pass ${after.passed}/${after.total}，红：${after.failed.join(' / ') || '（无）'}`,
    pass: after.code === 0 && after.failed.length === 0,
  })
}

// ── 输出 ───────────────────────────────────────────────────────────────
for (const row of rows) {
  console.log(`${row.pass ? 'PASS' : 'FAIL'} | ${row.step}\n  期望：${row.expect}\n  实测：${row.actual}`)
}
console.log(`\n${ok ? '变异自检全部通过' : '变异自检存在失败项'}：${rows.filter((row) => row.pass).length}/${rows.length} 项`)
process.exit(ok ? 0 : 1)
