#!/usr/bin/env node
/**
 * r47 t2 · 变异探针（5 条）：证明「四种真实形态」的回归断言改回错误实现会变红。
 *
 * 做法沿用 `test/r14-mutation-probes.mjs`（全程不碰工作区）：
 *   1. 把 `src/`、`test/` 与 package.json 复制到系统临时目录（`--keep` 可保留现场）；
 *   2. 先在**原样副本**上跑 `test/r47-jump-identity-shapes.test.ts`，必须 exit 0 且 6 条用例都执行过
 *      （node --test 的 name-pattern 一条都没命中时会把整个文件算 1 pass，所以这里不传 pattern）；
 *   3. 每条探针再从原样副本派生一份、只打这一条补丁，再跑同一个文件，必须 exit != 0
 *      且失败证据命中预期用例标题，避免「红得不明不白」。
 *
 * 五条补丁与形态的对应：
 *   P1 恢复旧回退（taskId 无人拥有 → 同角色最近活跃）→ ④ 任务无成员 / ③ 已退役（合成变体）红；
 *   P2 客户端只认单值 taskId（不读 taskIds）        → ② 成员复用 红；
 *   P3 宿主 taskIds 只填当前那条 binding            → ② 成员复用 红；
 *   P4 删掉 legacy 兜底（task.memberId 的第二身份源）→ ③ 已退役（真实盘面）红；
 *   P5 角色卡取消「多成员不跳」歧义规则              → ① 同角色多任务 红。
 *
 * 用法：
 *   node test/r47-jump-identity-probes.mjs          # 5 条全过才 exit 0
 *   node test/r47-jump-identity-probes.mjs --keep   # 保留临时副本，便于人工复查
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../', import.meta.url))
const KEEP = process.argv.includes('--keep')
const TMP = mkdtempSync(join(tmpdir(), 'auto-team-r47-probes-'))
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' }
const MAX_BUFFER = 8 * 1024 * 1024
const TEST_FILE = 'test/r47-jump-identity-shapes.test.ts'
const ALL_TITLES = [
  '① 同角色多任务',
  '② 成员复用',
  '③ 成员已退役（完全回收）',
  '③ 成员已退役（确认停止）',
  '④ 任务无成员',
  '总回归',
]

function makeTree(name) {
  const dir = join(TMP, name)
  mkdirSync(dir, { recursive: true })
  for (const entry of ['src', 'test', 'package.json']) {
    cpSync(join(REPO, entry), join(dir, entry), { recursive: true })
  }
  // 单测只跑 node 内置模块，但个别源码可能引用依赖的类型；软链避免多条全量拷贝。
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'), 'dir')
  return dir
}

/** 精确替换一个锚点：命中次数必须恰好 1，锚点漂移时宁可整体失败。 */
function replaceOnce(dir, relPath, from, to) {
  const file = join(dir, relPath)
  const source = readFileSync(file, 'utf8')
  const hits = source.split(from).length - 1
  if (hits !== 1) throw new Error(`补丁锚点在 ${relPath} 命中 ${hits} 次（必须恰好 1 次）：${from.trim().slice(0, 100)}`)
  writeFileSync(file, source.replace(from, () => to))
}

/* ────────────────────────── 探针定义 ────────────────────────── */

const PROBES = [
  {
    id: 'P1',
    name: '恢复旧回退：taskId 无成员拥有时回退到同角色 running/最近活跃',
    expectRed: /④ 任务无成员|③ 成员已退役（完全回收）/,
    mutate(dir) {
      replaceOnce(
        dir,
        'src/client/viewmodel.ts',
        `    return owners.length > 0 ? latestMemberOf(owners) : undefined`,
        `    return owners.length > 0 ? latestMemberOf(owners) : latestMemberOf(list)`,
      )
    },
  },
  {
    id: 'P2',
    name: '客户端只认单值 taskId（不读 taskIds 全集）',
    expectRed: /② 成员复用/,
    mutate(dir) {
      replaceOnce(
        dir,
        'src/client/viewmodel.ts',
        `  if (member.taskId === taskId) return true
  const ids = member.taskIds
  return Array.isArray(ids) && ids.includes(taskId)`,
        `  return member.taskId === taskId`,
      )
    },
  },
  {
    id: 'P3',
    name: '宿主 taskIds 只填当前 binding（复用成员的历史任务丢失）',
    expectRed: /② 成员复用/,
    mutate(dir) {
      replaceOnce(
        dir,
        'src/host/bridge.ts',
        `        taskIds: taskIdsOf.get(memberId) ?? [binding.taskId],`,
        `        taskIds: [binding.taskId],`,
      )
    },
  },
  {
    id: 'P4',
    name: '删掉 legacy 兜底（task.memberId 这条第二身份源）',
    expectRed: /③ 成员已退役（完全回收）/,
    mutate(dir) {
      replaceOnce(
        dir,
        'src/host/bridge.ts',
        `      if (task.memberId === undefined || seen.has(task.memberId)) continue`,
        `      if (task.memberId === undefined || seen.has(task.memberId) || true) continue`,
      )
    },
  },
  {
    id: 'P5',
    name: '角色卡取消多成员歧义规则（按最近活跃猜一个）',
    expectRed: /① 同角色多任务/,
    mutate(dir) {
      replaceOnce(dir, 'src/client/viewmodel.ts', `  if (count <= 1) {`, `  if (count >= 0) {`)
    },
  },
]

/* ────────────────────────── 执行与判读 ────────────────────────── */

function runCheck(dir) {
  const started = Date.now()
  const result = spawnSync(process.execPath, ['--test', TEST_FILE], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120000,
    env: ENV,
    maxBuffer: MAX_BUFFER,
  })
  return {
    status: result.status === null ? 1 : result.status,
    signal: result.signal ?? null,
    spawnError: result.error ?? null,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    ms: Date.now() - started,
  }
}

function tailOf(output, count) {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '')
  return clean.split(/\r?\n/).slice(-count).join('\n')
}

function main() {
  console.log(`r47 t2 变异探针：${PROBES.length} 条（副本在 ${TMP}）`)
  const base = makeTree('base')
  const baseline = runCheck(base)
  const missing = ALL_TITLES.filter((title) => !baseline.output.includes(title))
  if (baseline.status !== 0 || missing.length > 0) {
    console.log(`✖ 原样副本不绿：exit ${baseline.status}；未执行的用例：${missing.join('、') || '无'}`)
    console.log(tailOf(baseline.output, 30))
    process.exit(1)
  }
  console.log(`✔ 基线绿：6/6 用例执行，${baseline.ms}ms`)

  const rows = []
  let failed = 0
  for (const probe of PROBES) {
    const dir = makeTree(`probe-${probe.id.toLowerCase()}`)
    try {
      probe.mutate(dir)
    } catch (error) {
      failed += 1
      rows.push({ probe, mutated: null, ok: false, reason: `补丁失败：${error.message}` })
      continue
    }
    const mutated = runCheck(dir)
    const red = mutated.status !== 0 && probe.expectRed.test(mutated.output) && /✖/.test(mutated.output)
    if (!red) failed += 1
    rows.push({
      probe,
      mutated,
      ok: red,
      reason: red ? '' : `变异后没有按预期变红（exit ${mutated.status}，期望命中 ${probe.expectRed}）`,
    })
  }

  for (const row of rows) {
    const { probe, mutated } = row
    if (!row.ok) {
      console.log(`✖ [${probe.id}] ${probe.name}：${row.reason}`)
      if (mutated !== null) console.log(tailOf(mutated.output, 20))
      continue
    }
    const failedLine =
      mutated.output
        .replace(/\u001b\[[0-9;]*m/g, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^✖/.test(line)) ?? '（已变红）'
    console.log(`✔ [${probe.id}] ${probe.name} → 变异后 exit ${mutated.status}，${failedLine.slice(0, 120)}`)
  }

  console.log(failed === 0 ? `\n全部 ${PROBES.length}/${PROBES.length} 条变异探针通过` : `\n${failed} 条探针失败`)
  if (!KEEP) {
    // 临时副本随进程清理；--keep 时保留现场供人工复查。
  }
  process.exit(failed === 0 ? 0 : 1)
}

main()
