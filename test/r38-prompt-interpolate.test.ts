/**
 * r38 回归：队长常驻段落注册时必须带 `interpolate: false`。
 *
 * 背景（真机事故族）：宿主 `renderPrompt` 默认对每个 section 的 text 做 `{{ 变量 }}` 插值，
 * 只有 `section.interpolate === false` 时才原样保留。遇到 `{{ … }}` 但不是合法变量名
 * （`^[a-z][a-z0-9_]*$`）会抛 `malformed prompt variable reference`，整轮对话直接 error。
 * 本插件的段落拼进了用户可写文本（记忆标题、角色名字/职责等），必须关闭插值。
 *
 * 这里的第二个测试**不只看字段**：它用一个按宿主语义实现的迷你 renderer 真跑一遍，
 * 所以「有人把 interpolate 删了」会同时让字段断言与渲染断言变红（变异自检见 QA 报告）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Bridge } from '../src/host/bridge.ts'
import type { PanelSnapshot } from '../src/shared/types.ts'
import { registerPromptSection, type HostContext } from '../src/host/adapters.ts'
import { captainSection, registerCaptainPrompt, type PromptDeps } from '../src/host/prompt.ts'

/** 用户可写文本：不是合法变量名，宿主默认插值会直接抛错。 */
const USER_TEXT = '{{ apiName }}'
const LEGAL_VAR = /^[a-z][a-z0-9_]*$/

interface CapturedSection {
  name: string
  order: number
  interpolate?: boolean
  text: () => string
}

function captureCtx(): { ctx: HostContext; sections: CapturedSection[] } {
  const sections: CapturedSection[] = []
  const ctx = {
    systemPrompt: { section: (section: unknown) => void sections.push(section as CapturedSection) },
  } as unknown as HostContext
  return { ctx, sections }
}

/**
 * 宿主 renderPrompt 的最小复刻：`interpolate === false` 原样返回，否则解析 `{{ var }}`，
 * 非法变量名抛错。断言用它而不是只断言字段，才能覆盖「字段在但宿主语义没被满足」的情况。
 */
function renderLikeHost(sections: CapturedSection[], vars: Record<string, string> = {}): string {
  return sections
    .map((section) => {
      const text = section.text()
      if (section.interpolate === false) return text
      return text.replace(/\{\{\s*(.*?)\s*\}\}/g, (_all, name: string) => {
        if (!LEGAL_VAR.test(name)) throw new Error(`malformed prompt variable reference: ${name}`)
        return vars[name] ?? ''
      })
    })
    .join('\n')
}

function makeSnapshot(overrides: Partial<PanelSnapshot> = {}): PanelSnapshot {
  return {
    enabled: true,
    tasks: [],
    members: [],
    messages: [],
    routeAudits: [],
    concurrency: { limit: 3, running: 0, source: 'default' },
    memory: {
      injectedChars: 0,
      budget: 4000,
      truncated: false,
      files: [],
      inline: [
        {
          id: 'mem://project/memory#r38probe',
          track: 'project',
          name: 'memory',
          title: `记忆标题 ${USER_TEXT}`,
          summary: '',
          related: [],
          chars: 0,
        },
      ],
    },
    roles: [],
    activity: [],
    captainModel: { value: USER_TEXT, route: null, source: 'configured', note: '' },
    ...overrides,
  } as PanelSnapshot
}

test('registerPromptSection 捕获到 interpolate: false，且含 {{ }} 的用户文本原样保留', () => {
  const { ctx, sections } = captureCtx()
  assert.equal(
    registerPromptSection(ctx, { name: 'auto-team', order: 900, content: `记忆标题 ${USER_TEXT}` }),
    true,
  )

  assert.equal(sections.length, 1)
  const section = sections[0]!
  assert.equal(section.interpolate, false, '宿主默认插值会因非法变量名抛错，必须显式关闭')
  assert.equal(section.text(), `记忆标题 ${USER_TEXT}`, '关闭插值后宿主拿到的仍是原文')
  // 按宿主语义真跑一遍：删掉 interpolate 后这里会抛 malformed prompt variable reference。
  assert.equal(renderLikeHost(sections), `记忆标题 ${USER_TEXT}`)
})

test('captainSection 拼进用户写的 {{ }} 时，registerCaptainPrompt 注册的段落仍关闭插值', () => {
  const deps: PromptDeps = { bridge: { snapshot: () => makeSnapshot() } as unknown as Bridge }
  const { ctx, sections } = captureCtx()

  registerCaptainPrompt(ctx, deps, 'sess-r38')

  assert.equal(sections.length, 1)
  const section = sections[0]!
  assert.equal(section.name, 'auto-team')
  assert.equal(section.order, 900)
  assert.equal(section.interpolate, false, '字段被删 = 真机上第三方/用户文本再次打死整轮对话')

  const text = section.text()
  // 记忆标题不在段落正文里（memoryLineOf 只输出计数），但队长模型配置值是用户可写的，
  // 它确实进了正文 —— 用它证明「用户写的 {{ … }} 真的流到了 section text」。
  assert.ok(captainSection(deps, 'sess-r38').includes(`队长模型：${USER_TEXT}`))
  assert.ok(text.includes(USER_TEXT), '用户可写文本应出现在段落正文里')
  assert.equal(text, captainSection(deps, 'sess-r38'))

  // 宿主语义复刻：若插值未关闭，这里必抛错。
  assert.equal(renderLikeHost(sections), text)
})
