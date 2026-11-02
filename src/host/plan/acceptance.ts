/**
 * 验收命令模板（r11 F2）：三条可执行模板 + 建议命令选择 + 空验收的错误文案。
 *
 * 三条模板的**原文只此一份**（`ACCEPTANCE_TEMPLATES`），工具提示、空验收拒绝文案、
 * `runGate` 的空命令证据尾部三处都从这里取（`ACCEPTANCE_TEMPLATE_BLOCK`）。
 * 复制第二份的后果：AC-4「模板可直接执行」与 AC-7「旧句逐字在前、模板随后」会互相打架。
 *
 * 反目标 4：模板里**禁止** `pnpm lint` —— 本仓没有 lint 脚本，给出必然失败的命令
 * 等于把「验收永远红」写进产品。脚本名一律按 `typecheck → lint → test` 的顺序
 * 从仓库真实的 `package.json` scripts 里挑第一个存在的。
 */
import { normalizeWriteScopes } from './scope.ts'

/**
 * 三条模板原文（逐字，不可改写；尖括号是占位符，不是 Markdown）。
 *
 * 1. 改代码型：跑仓库已有的脚本（本仓解析为 `pnpm typecheck`）。
 * 2. 存在性型：某个标识符必须真的出现在范围内（命中 exit 0）。
 * 3. 范围型：这些路径必须有未提交改动（`test -n` 判别空输出）。
 */
export const ACCEPTANCE_TEMPLATES = [
  'pnpm typecheck',
  "grep -RIn --fixed-strings '<标识符>' <scope> >/dev/null",
  'test -n "$(git status --porcelain -- <路径>)"',
] as const

/**
 * 三条模板的展示块（工具提示 / 拒绝文案 / 门禁证据尾部共用）。
 *
 * 开头一句人话解释「exit 0 才算过」，因为工具调用者（模型）最容易在这里犯的错
 * 是把「我检查过了」写进 acceptance —— 那不是命令。
 */
export const ACCEPTANCE_TEMPLATE_BLOCK = [
  '可直接抄的验收模板（把尖括号换成实际值，命令 exit 0 才算过）：',
  ...ACCEPTANCE_TEMPLATES.map((template, index) => `${index + 1}. ${template}`),
].join('\n')

/** 选脚本的固定顺序：先类型检查，再 lint（本仓没有），最后才是测试。 */
const SCRIPT_PREFERENCE = ['typecheck', 'lint', 'test'] as const

/** `suggestAcceptance` 的输入：任务的可核验信息（标题/描述/写域/仓库脚本名）。 */
export interface AcceptanceInput {
  title: string
  description?: string
  writeScopes?: readonly string[]
  /** 仓库 `package.json` 的 scripts 键名（装配层读一次传进来，纯函数不碰文件）。 */
  scripts?: readonly string[]
}

/** 建议结果：`command === null` 表示「选不出可直接执行的命令」，`reason` 说明该补什么。 */
export interface AcceptanceSuggestion {
  command: string | null
  reason: string
  /** 命中的模板原文；一条都选不出时是完整的模板块（三行原文）。 */
  template: string
}

/** 写域（容错：拒绝/脏输入时退化成「只保留非空字符串」，建议阶段不该因为写域脏而崩）。 */
function scopesOf(input: AcceptanceInput): string[] {
  const normalized = normalizeWriteScopes(input.writeScopes ?? [])
  if (normalized.ok) return normalized.scopes
  const scopes: string[] = []
  for (const raw of input.writeScopes ?? []) {
    if (typeof raw !== 'string') continue
    const scope = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
    if (scope !== '' && scope !== '.') scopes.push(scope)
  }
  return scopes
}

/** 仓库真实存在的第一个偏好脚本名（缺省 null = 一个都没有）。 */
function scriptOf(input: AcceptanceInput): string | null {
  const scripts = new Set((input.scripts ?? []).filter((name): name is string => typeof name === 'string'))
  for (const name of SCRIPT_PREFERENCE) {
    if (scripts.has(name)) return name
  }
  return null
}

/**
 * 从标题/描述里取一个反引号标识符（AC-4 第 ② 类）。
 *
 * 只接受能安全放进单引号里的标识符：含 `'` 的会破坏 shell 引号，直接跳过这条路
 * （选不出就退回模板 ③ / `command: null`，绝不给出跑不起来的命令）。
 */
function identifierOf(input: AcceptanceInput): string | null {
  const text = `${input.title ?? ''}\n${input.description ?? ''}`
  const pattern = /`([^`\n]+)`/g
  let match: RegExpExecArray | null = pattern.exec(text)
  while (match !== null) {
    const identifier = (match[1] ?? '').trim()
    if (identifier !== '' && !identifier.includes("'")) return identifier
    match = pattern.exec(text)
  }
  return null
}

/** 选不出时的原因：含「选不出」三字 + 三条模板原文 + 该补的参数名（AC-5 逐字判据）。 */
function noCommandReason(): string {
  return [
    '选不出可直接执行的验收命令（不要写「人工检查」「请确认」这类非命令）。',
    '三条模板原文：',
    ACCEPTANCE_TEMPLATE_BLOCK,
    '需要补的参数（任选一条即可）：标识符（用反引号包起来）、路径（writeScopes）、脚本名（package.json 的 scripts）。',
  ].join('\n')
}

/**
 * 给任务建议一条**可直接执行**的验收命令（AC-4）。
 *
 * 选择顺序固定（确定性、无随机）：
 *  ① 有写域且仓库有 typecheck/lint/test 脚本 → `pnpm <script>`；
 *  ② 标题/描述里有反引号标识符 → `grep -RIn --fixed-strings '<标识符>' <scope> >/dev/null`；
 *  ③ 有写域但没有标识符 → `test -n "$(git status --porcelain -- <路径>)"`；
 *  ④ 都不满足 → `command: null` + 「选不出」原因。
 */
export function suggestAcceptance(input: AcceptanceInput): AcceptanceSuggestion {
  const scopes = scopesOf(input)
  const script = scriptOf(input)

  if (scopes.length > 0 && script !== null) {
    return {
      command: `pnpm ${script}`,
      reason: `改代码型：用仓库已有的 ${script} 脚本当门禁（本仓解析为 pnpm ${script}）。`,
      template: ACCEPTANCE_TEMPLATES[0],
    }
  }

  const identifier = identifierOf(input)
  if (identifier !== null) {
    const scope = scopes[0] ?? '.'
    return {
      command: `grep -RIn --fixed-strings '${identifier}' ${scope} >/dev/null`,
      reason: `存在性型：要求「${identifier}」在 ${scope} 下真的存在（grep 命中才 exit 0）。`,
      template: ACCEPTANCE_TEMPLATES[1],
    }
  }

  if (scopes.length > 0) {
    return {
      command: `test -n "$(git status --porcelain -- ${scopes.join(' ')})"`,
      reason: `范围型：要求 ${scopes.join('、')} 有未提交改动（空输出时 test 失败）。`,
      template: ACCEPTANCE_TEMPLATES[2],
    }
  }

  return { command: null, reason: noCommandReason(), template: ACCEPTANCE_TEMPLATE_BLOCK }
}

/**
 * 空验收（`acceptance` 为空白字符串）时的整批拒绝文案（AC-6）。
 *
 * 结构固定：**结论一句**（列出违规任务 id + 标题）→ 每个任务的可抄命令（能自动选中时）→
 * 三条模板原文。任务入口在 `save` 之前用它拦截，所以这段文案是模型唯一能看到的东西，
 * 必须自带「抄什么、还缺什么」。
 */
export function emptyAcceptanceError(
  violations: readonly { id: string; title?: string }[],
  suggestions?: ReadonlyMap<string, AcceptanceSuggestion>,
): string {
  const ids = violations.map((violation) => violation.id).join('、')
  const lines: string[] = [`拒绝：以下任务的验收命令为空（acceptance 不能是空白字符串）：${ids}`]
  for (const violation of violations) {
    const title = typeof violation.title === 'string' ? violation.title.trim() : ''
    const label = title === '' ? violation.id : `${violation.id}（${title}）`
    const suggestion = suggestions?.get(violation.id)
    if (suggestion !== undefined && suggestion.command !== null && suggestion.command !== '') {
      lines.push(`  - ${label}：可直接抄 ${suggestion.command}`)
    } else {
      lines.push(`  - ${label}：补上写域或反引号标识符后可以自动生成命令`)
    }
  }
  lines.push(ACCEPTANCE_TEMPLATE_BLOCK)
  return lines.join('\n')
}
