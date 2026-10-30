/**
 * 内置 6 角色与技能正文（PRD：预设多个角色自带技能；可改不可删）。
 *
 * 技能正文以常量形式内联，首次启动时由 roles/repo.ts seed 到 `<home>/.dsh/auto-team/skills/*.md`，
 * 让用户可以直接编辑 md 而不必改插件（同时插件升级不会覆盖用户已改过的正文）。
 */
import type { Role } from '../../shared/types.ts'

export interface BuiltinSkill {
  id: string
  title: string
  body: string
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    id: 'prd-writing',
    title: '需求与验收标准',
    body: [
      '# 需求与验收标准',
      '- 先把「用户要什么」写成可验收的条目（AC-n），每条必须可判定：命令、输出、或明确的人工判据。',
      '- 明确不做的事（范围外）与已知风险各写一行，避免下游扩张。',
      '- 每条 AC 都要能在交付物里定位到落点（文件/接口/界面元素）。',
    ].join('\n'),
  },
  {
    id: 'architecture',
    title: '架构与技术方案',
    body: [
      '# 架构与技术方案',
      '- 先定边界与契约（模块 → 输入/输出/错误），再谈实现细节。',
      '- 单点风险集中到一处胶水层，便于验证与替换。',
      '- 外部依赖必须写清版本与是否存在替代方案。',
    ].join('\n'),
  },
  {
    id: 'implementation',
    title: '编码实现',
    body: [
      '# 编码实现',
      '- 改动最小化：只碰任务范围内文件；公共契约变更必须同步更新调用方。',
      '- 不吞异常：错误要能传到 UI 或日志，禁止空 catch。',
      '- 交付前跑一次构建与类型检查，命令与结果写进回执。',
    ].join('\n'),
  },
  {
    id: 'testing',
    title: '测试与质量门禁',
    body: [
      '# 测试与质量门禁',
      '- 断言前先问：把实现改回错误版本，这条断言会不会红？不会红就不是断言。',
      '- 数值/计数类「不包含」断言禁止子串匹配。',
      '- 门禁命令必须留下退出码与输出尾部作为证据。',
    ].join('\n'),
  },
  {
    id: 'docs',
    title: '文档与交付说明',
    body: [
      '# 文档与交付说明',
      '- 文档写「怎么用、怎么验、失败怎么办」，不写实现流水账。',
      '- 命令必须可直接复制执行，并标注在哪个目录执行。',
      '- 未完成项必须显式列出，禁止用「全部完成」掩盖缺口。',
    ].join('\n'),
  },
  {
    id: 'review',
    title: '评审与风险',
    body: [
      '# 评审与风险',
      '- 先看边界与失败路径，再看正常路径。',
      '- 对每条结论标注证据（命令/文件行号），无证据的结论按假设处理。',
      '- 输出必须含「建议修改」与「可接受」两栏，避免只给结论不给依据。',
    ].join('\n'),
  },
]

/** 内置角色（id 稳定，内置标记不可删）。 */
export const BUILTIN_ROLES: Role[] = [
  {
    id: 'pm',
    name: '产品经理',
    duty: '澄清需求、拆解目标、定义验收标准与范围外事项',
    skillIds: ['prd-writing', 'docs'],
    builtin: true,
    updatedAt: 0,
  },
  {
    id: 'architect',
    name: '架构师',
    duty: '定模块边界与契约、技术选型权衡、脚手架与集成方案',
    skillIds: ['architecture', 'review'],
    builtin: true,
    updatedAt: 0,
  },
  {
    id: 'dev',
    name: '高级全栈工程师',
    duty: '按任务实现代码与配置、自测并给出可复核的回执',
    skillIds: ['implementation', 'testing'],
    builtin: true,
    updatedAt: 0,
  },
  {
    id: 'qa',
    name: 'QA 测试工程师',
    duty: '把 AC 转成可执行判定、跑门禁并记录证据与缺陷',
    skillIds: ['testing', 'review'],
    builtin: true,
    updatedAt: 0,
  },
  {
    id: 'docs',
    name: '技术文档工程师',
    duty: '维护 README/使用说明/变更记录，保证命令可复现',
    skillIds: ['docs'],
    builtin: true,
    updatedAt: 0,
  },
  {
    id: 'reviewer',
    name: '评审专家',
    duty: '独立复核交付物的边界、风险与证据完备性',
    skillIds: ['review', 'architecture'],
    builtin: true,
    updatedAt: 0,
  },
]

export function builtinSkillBody(skillId: string): string {
  return BUILTIN_SKILLS.find((skill) => skill.id === skillId)?.body ?? ''
}

/** 角色的完整技能正文（注入成员 prompt 时用；未知 skillId 静默跳过并在返回里报告）。 */
export function composeSkillPrompt(role: Role): { text: string; missing: string[] } {
  const parts: string[] = []
  const missing: string[] = []
  for (const skillId of role.skillIds) {
    const body = builtinSkillBody(skillId)
    if (body === '') {
      missing.push(skillId)
      continue
    }
    parts.push(body)
  }
  return { text: parts.join('\n\n'), missing }
}
