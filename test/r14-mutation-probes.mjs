#!/usr/bin/env node
/**
 * r14 AC-20 · 变异探针（6 条）：证明「实现错了会红」。
 *
 * 做法（全程不碰工作区）：
 *   1. 把 `src/`、`test/` 与类型/构建配置复制到系统临时目录（`--keep` 可保留现场）；
 *   2. 先在**原样副本**上跑每条探针的对应检查，必须 exit 0 且目标用例真的执行过
 *      （node --test 在 name-pattern 一条都没命中时会诡异地把整个文件算作 1 个 pass，
 *       所以这里额外要求输出里出现该用例标题）；
 *   3. 每条探针再从原样副本派生一份、只打这一条补丁，再跑同一个检查，必须 exit != 0
 *      且失败证据命中预期（断言 / 超时 / TS 错误码），避免「红得不明不白」。
 *
 * 为什么第 6 条用 typecheck 而不是 client-ui：`RunDrawer` 目前没有静态单测
 * （client-ui 的组件清单与钩子断言里都没有它），删掉文件后整个项目仍能 `node --test` 绿；
 * 但仓库既有门禁 `tsc --noEmit` 会以 TS2307 明确报错 —— 这是可重复执行的真红，
 * 不是手写结论。补测试的后续动作已写进交付说明（不在本任务的写域内）。
 *
 * 用法：
 *   node test/r14-mutation-probes.mjs          # 6 条全过才 exit 0
 *   node test/r14-mutation-probes.mjs --keep   # 保留临时副本，便于人工复查
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
const TSC = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc')
const KEEP = process.argv.includes('--keep')
const TMP = mkdtempSync(join(tmpdir(), 'auto-team-r14-probes-'))
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
  // tsc 需要 node_modules 里的类型；单测只跑 node 内置模块。用软链避免 6 份全量拷贝。
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

function removeOnce(dir, relPath) {
  const file = join(dir, relPath)
  if (!existsSync(file)) throw new Error(`探针要删除的文件不存在：${relPath}`)
  rmSync(file)
}

/** 删除 [startMarker, endMarker) 之间的整段代码（两端锚点必须唯一命中）。 */
function removeBetween(dir, relPath, startMarker, endMarker) {
  const file = join(dir, relPath)
  const source = readFileSync(file, 'utf8')
  const start = source.indexOf(startMarker)
  if (start === -1) throw new Error(`删除锚点开始标记在 ${relPath} 不存在：${startMarker.trim().slice(0, 80)}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  if (end === -1) throw new Error(`删除锚点结束标记在 ${relPath} 不存在：${endMarker.trim().slice(0, 80)}`)
  writeFileSync(file, source.slice(0, start) + source.slice(end))
}

/* ────────────────────────── 探针定义 ────────────────────────── */

const PROBES = [
  {
    id: 'AC-1',
    name: '派发改回 await spawn（队长轮再次被拖住）',
    check: { kind: 'node-test', file: 'test/dispatch-nonblocking.test.ts', pattern: 'AC-1', timeoutMs: 2000 },
    testTitle: 'AC-1：受理制',
    expectRed: /test timed out after \d+ms|cancelled [1-9]/,
    mutate(dir) {
      // 原实现：预检 → deps.autoDispatch(...)（同步 kick）→ 立即 return。
      // 变异：改回 await bridge.act('dispatch') —— 测试桩的 spawn 永不 resolve，工具随之挂住。
      replaceOnce(
        dir,
        'src/host/tools.ts',
        `        deps.autoDispatch(sessionId, runId, 'manual')`,
        `        const blocked = await deps.bridge.act(sessionId, { type: 'dispatch', runId })
        void blocked`,
      )
    },
  },
  {
    id: 'AC-4',
    name: '去掉画布 pointer 拖动（含 4px 阈值判定）',
    check: { kind: 'node-test', file: 'test/client-ui.test.ts', pattern: 'FlowCanvas', timeoutMs: 10000 },
    testTitle: 'FlowCanvas：可平移视口',
    expectRed: /FLOW_DRAG_THRESHOLD|did not match the regular expression/,
    mutate(dir) {
      // 去掉 pointer 拖动的完整实现：两个 handler（onPointerDown/onPointerMove）、JSX 绑定、
      // 以及只服务于拖动的累计位移阈值。client-ui 没有 DOM，靠源码钩子/常量断言守这条交互
      // （AC-22 的 rAF 直写 transform 断言仍保留在 schedulePaint/paint 里）。
      removeBetween(dir, 'src/client/views/FlowCanvas.tsx', '  const onPointerDown = ', '  const onPointerEnd = ')
      replaceOnce(dir, 'src/client/views/FlowCanvas.tsx', 'export const FLOW_DRAG_THRESHOLD = 4\n', '')
      replaceOnce(
        dir,
        'src/client/views/FlowCanvas.tsx',
        '        onPointerDown={onPointerDown}\n' +
          '        onPointerMove={onPointerMove}\n' +
          '        onPointerUp={onPointerEnd}\n' +
          '        onPointerCancel={onPointerEnd}\n',
        '',
      )
    },
  },
  {
    id: 'AC-5',
    name: '节点主标签改回 task.id（角色名不再显示）',
    check: { kind: 'node-test', file: 'test/viewmodel.test.ts', pattern: 'flowNodeViewOf', timeoutMs: 10000 },
    testTitle: 'flowNodeViewOf',
    expectRed: /角色未记录/,
    mutate(dir) {
      // 节点第一行的唯一派生点是 flowNodeViewOf.roleText：改回 node.id 即 AC-5 回退。
      replaceOnce(
        dir,
        'src/client/viewmodel.ts',
        `  const roleText = (node.roleName ?? '').trim() || FLOW_ROLE_FALLBACK`,
        `  const roleText = node.id`,
      )
    },
  },
  {
    id: 'AC-10',
    name: '进度环写死 dashOffset = 0（弧长不再等于 done/total）',
    check: { kind: 'node-test', file: 'test/task-overview.test.ts', pattern: 'taskOverviewOf', timeoutMs: 10000 },
    testTitle: 'taskOverviewOf：2 done + 1 running',
    expectRed: /dashoffset/i,
    mutate(dir) {
      replaceOnce(
        dir,
        'src/client/viewmodel.ts',
        `    dashOffset: PROGRESS_RING_CIRCUMFERENCE * (1 - ratio),`,
        `    dashOffset: 0,`,
      )
    },
  },
  {
    id: 'AC-15',
    name: '项目行改为 PlanTask 行（一个大任务裂成多行）',
    check: { kind: 'node-test', file: 'test/library-project.test.ts', pattern: 'AC-15', timeoutMs: 10000 },
    testTitle: 'AC-15：项目行是「一个大任务一行」',
    expectRed: /2 个任务也只能有 1 行|recentRuns/,
    mutate(dir) {
      // 把 run 级投影改成按 plan.tasks 展开：2 个任务的 run 会变成 2 行（AC-15 回退）。
      replaceOnce(
        dir,
        'src/host/library.ts',
        `    recentRuns: runs.slice(0, PROJECT_RUN_LIMIT).map((summary) => projectRunViewOf(summary, at)),`,
        `    recentRuns: runs.slice(0, PROJECT_RUN_LIMIT).flatMap((summary) => {
      const base = projectRunViewOf(summary, at)
      const state = deps.store.load(summary.runId)
      return state === null
        ? [base]
        : state.plan.tasks.map((task) => ({ ...base, runId: task.id, goal: task.title }))
    }),`,
      )
    },
  },
  {
    id: 'AC-16',
    name: '删掉 RunDrawer（抽屉宿主失去实现）',
    check: { kind: 'typecheck', timeoutMs: 120000 },
    expectRed: /error TS2307: Cannot find module '\.\/views\/RunDrawer\.tsx'/,
    mutate(dir) {
      removeOnce(dir, 'src/client/views/RunDrawer.tsx')
    },
  },
]

/* ────────────────────────── 执行与判读 ────────────────────────── */

function runCheck(dir, probe) {
  const started = Date.now()
  const result =
    probe.check.kind === 'typecheck'
      ? spawnSync(process.execPath, [TSC, '--noEmit', '-p', 'tsconfig.json'], {
          cwd: dir,
          encoding: 'utf8',
          timeout: probe.check.timeoutMs,
          env: ENV,
          maxBuffer: MAX_BUFFER,
        })
      : spawnSync(
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
  const hit = lines.find((line) =>
    /test timed out after|did not match the regular expression|AssertionError|error TS\d+/.test(line),
  )
  if (hit !== undefined) return hit.slice(0, 240)
  const marks = lines.filter((line) => /^(?:✖|not ok)/.test(line))
  return (marks.at(-1) ?? '（exit != 0，但未匹配到断言/超时行）').slice(0, 240)
}

function tailOf(output, count) {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '')
  return clean.split(/\r?\n/).slice(-count).join('\n')
}

function main() {
  console.log(`r14 AC-20 变异探针：${PROBES.length} 条（副本在 ${TMP}）`)
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

if (!existsSync(TSC)) {
  console.error(`[env] 找不到 ${TSC}：请在仓库根安装依赖后再跑（本探针不会联网安装）。`)
  process.exitCode = 1
} else {
  main()
}
