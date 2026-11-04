/**
 * 队长分层单测（AC-1 / AC-2 / AC-8 的便宜守卫）。
 *
 * 两个理由值得单测而不是只靠探针：
 *  1. **AC-1 的「不把整份计划塞进常驻上下文」是结构承诺**，只有把 `captainSection` 当纯函数调用、
 *     喂一份带 4000 字 acceptance 的计划，才能证明它真的没读 `tasks`（运行期肉眼看不出差别）；
 *  2. **AC-2 的三态投影**是「绝不假称生效」的唯一出口，`capability` 与 `route` 的四种组合里
 *     有三种必须落到 `host-default` / `unsupported` —— 这条用断言钉住才不会在集成时被悄悄放宽。
 *
 * 对应实现：`src/host/team/captain.ts`（配置读取 + 投影）、`src/host/prompt.ts`（提示词段落）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Bridge } from '../src/host/bridge.ts'
import type { CaptainModelView, PanelSnapshot, RoleModelRoute } from '../src/shared/types.ts'
import { captainModelView, readCaptainModel } from '../src/host/team/captain.ts'
import {
  CAPTAIN_CONSTRAINTS,
  captainModelLineOf,
  captainSection,
  memoryLineOf,
  type PromptDeps,
} from '../src/host/prompt.ts'

/** 段落长度上限（AC-1 硬判据，独立常量而不是引用被测实现，避免「两边一起变」）。 */
const SECTION_MAX = 2600

/**
 * AC-8 的禁用标注，**拼接构造**而不是写成字面量：QA 的判据是「全仓/产物 0 命中」，
 * 直接把字面量写进测试会让 grep 命中测试自己（记忆里的「判据会命中自身」坑）。
 */
const LEGACY_TRUNCATION = ['已', '截断'].join('')
const LEGACY_TRUNCATION_LONG = ['…[', '截断]'].join('')

/** 构造一份够用的快照；只填 `captainSection` 会读的三个字段，其余留空。 */
function makeSnapshot(overrides: Partial<PanelSnapshot> = {}): PanelSnapshot {
  return {
    enabled: true,
    tasks: [],
    members: [],
    messages: [],
    routeAudits: [],
    concurrency: { limit: 3, running: 0, source: 'default' },
    memory: { injectedChars: 0, budget: 4000, truncated: false, files: [] },
    roles: [],
    activity: [],
    ...overrides,
  } as PanelSnapshot
}

function sectionOf(snapshot: PanelSnapshot): string {
  const deps: PromptDeps = { bridge: { snapshot: () => snapshot } as unknown as Bridge }
  return captainSection(deps, 'sess-1')
}

/* ---------------------------------------------------------------- AC-1 提示词硬约束 */

test('AC-1：三条硬约束短语都出现在常驻段落里', () => {
  const text = sectionOf(makeSnapshot())
  assert.match(text, /不亲自干细活/)
  assert.match(text, /只做三件事/)
  assert.match(text, /不要同步等长任务/)
  // 三条约束必须逐字来自同一个导出常量，防止「改了一处、另一处留旧文案」。
  for (const line of CAPTAIN_CONSTRAINTS) assert.ok(text.includes(line), `缺少约束：${line}`)
})

test('AC-1：约束段落在「工作方式」之前', () => {
  const text = sectionOf(makeSnapshot())
  const constraintsAt = text.indexOf('不亲自干细活')
  const workflowAt = text.indexOf('工作方式（顺序不可颠倒）')
  assert.ok(constraintsAt > 0, '约束段缺失')
  assert.ok(workflowAt > 0, '工作方式段缺失')
  assert.ok(constraintsAt < workflowAt, '硬约束必须在工作方式之前')
})

test('r14 AC-2：受理制特征句在常驻段里（派发后立即结束本轮，不要等待成员）', () => {
  const text = sectionOf(makeSnapshot())
  const phrase = '派发后立即结束本轮，不要等待成员'
  assert.ok(text.includes(phrase), `缺少受理制特征句：${phrase}`)
  assert.ok(CAPTAIN_CONSTRAINTS.some((line) => line.includes(phrase)), '特征句必须来自同一个导出常量')
  assert.match(text, /返回「已接受派发」即表示后台已接手/, '要解释「为什么不用等」，否则模型仍会轮询')
  // 与三条老约束同段、同位置纪律：必须排在「工作方式」之前（先立规矩再讲流程）。
  assert.ok(text.indexOf(phrase) < text.indexOf('工作方式（顺序不可颠倒）'))
  assert.ok(text.length <= SECTION_MAX, `段落长度 ${text.length} 超过 ${SECTION_MAX}`)
})

test('AC-1：段落总长 ≤ 2600 字符', () => {
  const text = sectionOf(makeSnapshot())
  assert.ok(text.length <= SECTION_MAX, `段落长度 ${text.length} 超过 ${SECTION_MAX}`)
})

test('r11：常驻段落不再断言「当前会话已启用/未启用」（改以面板与工具返回为准）', () => {
  const on = sectionOf(makeSnapshot({ enabled: true }))
  const off = sectionOf(makeSnapshot({ enabled: false }))
  // 旧文案用占位会话 id 查开关，真机上恒为「未启用」，于是队长被明确告知「不得创建成员」，
  // 用户看到的就是「开了自动团队但它从不干活」。段落拿不到会话维度（PromptSection.text
  // 只收到 AssembleContext），所以**开关状态不许影响这段文本**——两态必须逐字相同。
  assert.equal(on, off, '开关状态不得影响常驻段落：它拿不到会话维度，任何断言都会与实际不符')
  assert.equal(on.includes('当前会话的自动团队开关'), false)
  assert.equal(on.includes('未启用时不得创建成员'), false)
  assert.match(on, /按会话启用/)
  assert.match(on, /会直接返回「未启用」/)
})

test('AC-1：不把计划塞进常驻上下文（acceptance 原文 0 命中）', () => {
  const acceptance = `pnpm typecheck && node --test test/captain.test.ts 并逐条核对产物：${'验收证据'.repeat(1200)}`
  assert.ok(acceptance.length > 4000, '样本必须够长，否则断言不承载信息')
  const text = sectionOf(
    makeSnapshot({
      tasks: [
        {
          id: 't1',
          title: '任务一',
          roleId: 'dev',
          dependsOn: [],
          status: 'blocked',
          acceptance,
        } as unknown as PanelSnapshot['tasks'][number],
      ],
    }),
  )
  assert.equal(text.includes(acceptance), false, '常驻段落里出现了计划任务的 acceptance 原文')
  assert.equal(text.includes('验收证据'), false)
  // 同时确认段落没有因为塞进 tasks 而失控。
  assert.ok(text.length <= SECTION_MAX)
})

/* ---------------------------------------------------------------- AC-8 记忆行文案 */

test('AC-8：有未内联条目时说「另有 N 条可按 ID 展开」，不说「被截断」', () => {
  const snapshot = makeSnapshot({
    memory: {
      injectedChars: 3800,
      budget: 4000,
      truncated: true,
      files: [],
      inline: [
        { id: 'mem://project/a', track: 'project', name: 'a', title: 'A', summary: 'a', related: [], chars: 80 },
      ],
      omitted: [
        { id: 'mem://project/b', track: 'project', name: 'b', title: 'B', summary: 'b', related: [], chars: 80 },
        { id: 'mem://public/c', track: 'public', name: 'c', title: 'C', summary: 'c', related: [], chars: 80 },
      ],
    },
  })
  const text = sectionOf(snapshot)
  assert.match(text, /另有 2 条未内联/)
  assert.match(text, /action=expand/)
  assert.match(text, /mem:\/\//)
  // AC-8：注入文本 0 命中旧标注。
  assert.equal(text.includes(LEGACY_TRUNCATION), false)
  assert.equal(text.includes(LEGACY_TRUNCATION_LONG), false)
})

test('AC-8：没有未内联条目时不写记忆行（常驻段不白占字符）', () => {
  const text = sectionOf(makeSnapshot())
  assert.equal(text.includes('未内联'), false)
  assert.equal(memoryLineOf(undefined), '')
  // 旧快照语义（truncated=true 但没有 omitted 明细）仍要给出可展开提示，而不是静默。
  const legacy = memoryLineOf({ injectedChars: 4000, budget: 4000, truncated: true, files: [] })
  assert.match(legacy, /action=expand/)
  assert.equal(legacy.includes(LEGACY_TRUNCATION), false)
})

/* ---------------------------------------------------------------- AC-2 提示词里的队长模型 */

test('AC-2：configured 写逐字路由，host-default 不写，unsupported 明说未生效', () => {
  const route: RoleModelRoute = { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high' }

  const configured = sectionOf(makeSnapshot({ captainModel: captainModelView(route, 'ok') }))
  assert.match(configured, /队长模型：openai\/gpt-5 #high/)

  const hostDefault = sectionOf(makeSnapshot({ captainModel: captainModelView(null, 'unsupported') }))
  assert.equal(hostDefault.includes('队长模型：'), false)

  const unsupported = sectionOf(
    makeSnapshot({ captainModel: captainModelView(route, 'unsupported') }),
  )
  assert.match(unsupported, /队长模型：宿主暂不支持单独指定（配置已保留，未生效）/)
  assert.equal(captainModelLineOf(undefined), '')
})

/* ---------------------------------------------------------------- AC-2 三态投影 */

test('AC-2：captainModelView 三态 —— 未配置恒 host-default，即使 capability=ok', () => {
  const view = captainModelView(null, 'ok')
  assert.equal(view.source, 'host-default')
  assert.equal(view.value, null)
  assert.equal(view.route, null)
  assert.ok(view.note.length > 0)
})

test('AC-2：captainModelView 三态 —— 配置 + capability=ok 才是 configured', () => {
  const route: RoleModelRoute = { provider: 'anthropic', model: 'claude-x', reasoningEffort: 'low' }
  const view: CaptainModelView = captainModelView(route, 'ok')
  assert.equal(view.source, 'configured')
  assert.equal(view.value, 'anthropic/claude-x #low')
  assert.deepEqual(view.route, route)
  assert.match(view.note, /已生效/)
})

test('AC-2：captainModelView 三态 —— capability=unsupported 时回显配置但标未生效', () => {
  const route: RoleModelRoute = { provider: 'openai', model: 'gpt-5' }
  const view = captainModelView(route, 'unsupported')
  assert.equal(view.source, 'unsupported')
  // 回显不能丢：用户写了什么就一定看得见。
  assert.equal(view.value, 'openai/gpt-5')
  assert.match(view.note, /未生效/)
  assert.equal(view.note.includes('已生效'), false, 'unsupported 不得说成已生效')
})

/* ---------------------------------------------------------------- 配置读取 */

test('readCaptainModel：正常配置逐字读出（含 effort）', () => {
  const root = mkdtempSync(join(tmpdir(), 'captain-'))
  try {
    writeFileSync(join(root, 'captain.json'), JSON.stringify({ provider: 'p', model: 'm', reasoningEffort: 'medium' }))
    assert.deepEqual(readCaptainModel(root), { provider: 'p', model: 'm', reasoningEffort: 'medium' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readCaptainModel：文件不存在 / 坏 JSON / 缺字段 / 未知 effort 都降级不抛', () => {
  const root = mkdtempSync(join(tmpdir(), 'captain-'))
  try {
    // ① 文件不存在
    assert.equal(readCaptainModel(root), null)
    // ② 坏 JSON
    writeFileSync(join(root, 'captain.json'), '{ not json')
    assert.equal(readCaptainModel(root), null)
    // ③ 缺 model（残缺 → null，而不是拿空字符串继续跑）
    writeFileSync(join(root, 'captain.json'), JSON.stringify({ provider: 'p' }))
    assert.equal(readCaptainModel(root), null)
    // ④ provider/model 空白
    writeFileSync(join(root, 'captain.json'), JSON.stringify({ provider: '  ', model: 'm' }))
    assert.equal(readCaptainModel(root), null)
    // ⑤ 未知 effort 只丢该字段，provider/model 仍可用
    writeFileSync(join(root, 'captain.json'), JSON.stringify({ provider: 'p', model: 'm', reasoningEffort: 'extreme' }))
    assert.deepEqual(readCaptainModel(root), { provider: 'p', model: 'm' })
    // ⑥ 空 dataRoot：没有落点就没有配置，且不得抛
    assert.equal(readCaptainModel(''), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readCaptainModel：trailing slash 的 dataRoot 也能读到同一份配置', () => {
  const root = mkdtempSync(join(tmpdir(), 'captain-'))
  try {
    writeFileSync(join(root, 'captain.json'), JSON.stringify({ provider: 'p', model: 'm' }))
    assert.deepEqual(readCaptainModel(`${root}/`), { provider: 'p', model: 'm' })
    assert.deepEqual(readCaptainModel(`${root}///`), { provider: 'p', model: 'm' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
