#!/usr/bin/env node
/**
 * r16 T7 · 变异探针（7 条）：证明「实现错了测试会红」，而不是只测到函数名。
 *
 * 做法（全程不碰工作区）：
 *   1. 把 `src/`、`test/` 与类型/构建配置复制到系统临时目录（`--keep` 可保留现场）；
 *   2. 先在**原样副本**上跑每条探针的对应检查，必须 exit 0 且目标用例真的执行过
 *      （node --test 在 name-pattern 一条都没命中时会把整个文件算作 pass，
 *       所以这里额外要求输出里出现该用例标题）；
 *   3. 每条探针再从原样副本派生一份、只打这一条补丁，再跑同一个检查，必须 exit != 0
 *      且失败证据命中预期（断言 / 超时），避免「红得不明不白」。
 *
 * 七条对应 TECHNICAL §8.3 / PRD AC-21（AC 编号见每条 id）：
 *   AC-12a 角色分组退回 roleName（同 roleName 不同 roleId 被合并）
 *   AC-12b 角色列退回 node.column（依赖深度冒充角色列）
 *   AC-16  角色卡 taskRefs 反序（计划顺序被破坏）
 *   AC-6   已派发分支还原成错误码（幂等确认退化，队长会重复起人）
 *   AC-8   去掉左栏 500ms watchdog（glyph 点了没反应却没有任何降级）
 *   AC-11  进度环半径改回 28（80 环几何漂移）
 *   AC-1   队长提示词删掉「只有改代码才组队」条件（开关一开什么都组队）
 *
 * 用法：
 *   node test/r16-mutation-probes.mjs          # 7 条全过才 exit 0
 *   node test/r16-mutation-probes.mjs --keep   # 保留临时副本，便于人工复查
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../', import.meta.url))
const KEEP = process.argv.includes('--keep')
const TMP = mkdtempSync(join(tmpdir(), 'auto-team-r16-probes-'))
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
  // 单测只跑 node 内置模块；用软链避免每条探针全量拷贝 node_modules。
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'), 'dir')
  return dir
}

/**
 * 精确替换一个锚点。命中次数必须恰好 1：补丁锚点漂移时宁可整体失败，
 * 也不许「补丁没打上 → 原样仍绿 → 被误判成测试抓不住」。
 */
function replaceOnce(dir, relPath, from, to) {
  const file = join(dir, relPath)
  const source = readFileSync(file, 'utf8')
  const hits = source.split(from).length - 1
  if (hits !== 1) {
    throw new Error(`补丁锚点在 ${relPath} 命中 ${hits} 次（必须恰好 1 次）：${from.trim().slice(0, 100)}`)
  }
  writeFileSync(file, source.replace(from, () => to))
}

/* ────────────────────────── 探针定义 ────────────────────────── */

/** 分组/排行共用的两行锚点：只有分组处前面是 `for (const node of flow.nodes) {`。 */
const FLOW_GROUP_ANCHOR = `  for (const node of flow.nodes) {
    const key = node.roleId ?? node.roleName ?? FLOW_ROLE_FALLBACK`

const PROBES = [
  {
    id: 'AC-12a',
    name: '角色分组退回 roleName（短 id 的快照不再按 roleId 分列）',
    check: { file: 'test/viewmodel.test.ts', pattern: 'flowLayoutOf：旧快照按 roleName', timeoutMs: 10000 },
    testTitle: '同名不同 roleId 不合并',
    expectRed: /AssertionError|角色未记录/,
    mutate(dir) {
      // 原实现：key = roleId ?? roleName ?? FALLBACK（短 id 快照里 b 的 roleId=qa 必须单独一列）。
      // 变异：只看 roleName —— a、b 同名即合并，b 的任务落进第 1 列（AC-12 回退）。
      replaceOnce(
        dir,
        'src/client/viewmodel.ts',
        FLOW_GROUP_ANCHOR,
        `  for (const node of flow.nodes) {
    const key = node.roleName ?? FLOW_ROLE_FALLBACK`,
      )
    },
  },
  {
    id: 'AC-12b',
    name: '角色列退回 node.column（依赖深度冒充角色列）',
    check: { file: 'test/viewmodel.test.ts', pattern: 'flowLayoutOf：按角色分列', timeoutMs: 10000 },
    testTitle: '同角色按计划顺序排行',
    expectRed: /AssertionError|col-/,
    mutate(dir) {
      // 原实现：列 = 角色（与依赖深度无关）。变异：列 = node.column，`dev` 的两个任务
      // 会被拆到依赖深度 0/1 两列，stage.key 变成 col-0/col-1（AC-12 回退）。
      replaceOnce(
        dir,
        'src/client/viewmodel.ts',
        FLOW_GROUP_ANCHOR,
        `  for (const node of flow.nodes) {
    const key = \`col-\${node.column ?? 0}\``,
      )
    },
  },
  {
    id: 'AC-16',
    name: '角色卡 taskRefs 反序（计划顺序被破坏）',
    check: { file: 'test/viewmodel.test.ts', pattern: 'roleUsageOf：只列有任务的角色', timeoutMs: 10000 },
    testTitle: '全有来源才合计',
    expectRed: /AssertionError|deep-equal|taskRefs/,
    mutate(dir) {
      replaceOnce(
        dir,
        'src/client/viewmodel.ts',
        `      taskRefs: list.map((task) => ({ id: task.id, status: task.status })),`,
        `      taskRefs: list.map((task) => ({ id: task.id, status: task.status })).reverse(),`,
      )
    },
  },
  {
    id: 'AC-6',
    name: '已派发分支还原成错误码（幂等确认退化）',
    check: { file: 'test/dispatch-nonblocking.test.ts', pattern: '准入与面板同源', timeoutMs: 10000 },
    testTitle: '已派发转幂等确认',
    expectRed: /幂等确认|AssertionError/,
    mutate(dir) {
      // 原实现：PLAN_ALREADY_DISPATCHED → ok:true/alreadyDispatched:true（零 kick）。
      // 变异：分支条件改成一个永不出现的码，落回旧的 `ok:false + code`（AC-6 回退）。
      replaceOnce(
        dir,
        'src/host/tools.ts',
        `          if (admission.code === 'PLAN_ALREADY_DISPATCHED') {`,
        `          if (admission.code === 'PLAN_ALREADY_DISPATCHED_NEVER') {`,
      )
    },
  },
  {
    id: 'AC-8',
    name: '去掉左栏 500ms watchdog（主区没挂载时不再降级）',
    check: { file: 'test/r16-library-open.test.ts', pattern: '主区没挂载', timeoutMs: 10000 },
    testTitle: '主区没挂载',
    expectRed: /watchdog|AssertionError/,
    mutate(dir) {
      // 原实现：mainArea.open() 说成功后挂一次性 watchdog，500ms 内主区没挂载就降级右栏。
      // 变异：只留 markLibraryOpenRequest() —— 用户看到的正是「点了没反应」（AC-8 回退）。
      replaceOnce(
        dir,
        'src/client/slots.ts',
        `        markLibraryOpenRequest()
        // 一次性 watchdog（不是 setInterval）：主区说打开了、实际没挂载时 500ms 内降级。
        setTimeout(() => {
          if (visibleLibrarySurface() === 'main') return
          fallback(sessionId, true)
        }, LIBRARY_OPEN_WATCHDOG_MS)`,
        `        markLibraryOpenRequest()`,
      )
    },
  },
  {
    id: 'AC-11',
    name: '进度环半径改回 28（80 环几何漂移）',
    check: { file: 'test/task-overview.test.ts', pattern: 'taskOverviewOf：2 done', timeoutMs: 10000 },
    testTitle: '2 done',
    expectRed: /PROGRESS_RING_RADIUS|AssertionError/,
    mutate(dir) {
      // 原实现（DESIGN §2.1）：viewBox 80 / r34 / stroke 8 / C≈213.628。
      // 变异：r 改回 r14 的 28 —— 圆环变小、弧长与 dashoffset 全错（AC-11 回退）。
      replaceOnce(
        dir,
        'src/client/viewmodel.ts',
        `export const PROGRESS_RING_RADIUS = 34`,
        `export const PROGRESS_RING_RADIUS = 28`,
      )
    },
  },
  {
    id: 'AC-1',
    name: '队长提示词删掉「只有改代码才组队」条件',
    check: { file: 'test/captain.test.ts', pattern: 'r16 AC-1：条件式规则', timeoutMs: 10000 },
    testTitle: '条件式规则',
    expectRed: /需要修改代码|AssertionError/,
    mutate(dir) {
      // 原实现：条件式规则 —— 只有需要修改代码的任务才组队（文档/问答/查证不组队）。
      // 变异：退回无条件组队（开关一开，用户只是问一句也落计划、起成员；PRD 反目标 1）。
      replaceOnce(
        dir,
        'src/host/prompt.ts',
        `'1. **先判性质**：只有「需要修改代码」的任务才组队。算：`,
        `'1. **先判性质**：所有任务都组队。算：`,
      )
    },
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
    {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120000,
      env: ENV,
      maxBuffer: MAX_BUFFER,
    },
  )
  return {
    status: result.status === null ? 1 : result.status,
    signal: result.signal ?? null,
    spawnError: result.error ?? null,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    ms: Date.now() - started,
  }
}

function evidenceOf(output) {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '')
  const lines = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const hit = lines.find((line) => /test timed out after|did not match the regular expression|AssertionError/.test(line))
  if (hit !== undefined) return hit.slice(0, 240)
  const marks = lines.filter((line) => /^(?:✖|not ok)/.test(line))
  return (marks.at(-1) ?? '（exit != 0，但未匹配到断言/超时行）').slice(0, 240)
}

function tailOf(output, count) {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '')
  return clean.split(/\r?\n/).slice(-count).join('\n')
}

function main() {
  console.log(`r16 T7 变异探针：${PROBES.length} 条（副本在 ${TMP}）`)
  const base = makeTree('base')
  const rows = []
  let failed = 0

  for (const probe of PROBES) {
    const baseline = runCheck(base, probe)
    const baselineGreen =
      baseline.status === 0 &&
      (probe.testTitle === undefined || baseline.output.includes(probe.testTitle)) &&
      !/✖/.test(baseline.output)
    if (!baselineGreen) {
      failed += 1
      rows.push({ probe, baseline, mutated: null, ok: false, reason: '原样副本不绿（基线本身坏了，不能拿它做变异证明）' })
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
  console.log(`\n${failed}/${PROBES.length} 探针未通过；现场保留在 ${TMP}（复查后可手动删除）`)
}

if (!existsSync(join(REPO, 'src', 'client', 'viewmodel.ts'))) {
  console.error(`[env] 找不到 ${REPO}/src/client/viewmodel.ts：请从仓库根运行本脚本。`)
  process.exitCode = 1
} else {
  main()
}
