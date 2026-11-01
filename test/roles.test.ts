/**
 * 角色库单测：r7 AC-7（角色提示词）/ AC-8（一键恢复默认、内置推导）。
 *
 * 重点不是「函数能跑」，而是三条会静默失效的语义：
 *   1. 内置角色的 `prompt` 是**恢复默认的唯一逐字来源**（改坏 → 恢复 → 必须逐字相等）；
 *   2. `builtin` 必须由 `BUILTIN_ROLES` 推导 —— 磁盘上写 `builtin: true` 不许换来删除豁免；
 *   3. `restoreDefaults` 只动内置 11 个，自建角色一个字节都不许变（sha256 断言）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROLE_PROMPT_MAX } from '../src/host/config.ts'
import { BUILTIN_ROLES, BUILTIN_SKILLS } from '../src/host/roles/builtin.ts'
import { createRoleRepo, validatePrompt } from '../src/host/roles/repo.ts'
import type { Role } from '../src/shared/types.ts'

const NOW = 1_700_000_000_000
const CJK = /[\u4e00-\u9fa5]/

function withRepo(fn: (repo: ReturnType<typeof createRoleRepo>, dir: string, skillsDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'auto-team-roles-'))
  try {
    const dir = join(root, 'roles')
    const skillsDir = join(root, 'skills')
    // 预建目录：升级路径的用例需要先摆好「老版本落下的文件」，再交给 seed()。
    mkdirSync(dir, { recursive: true })
    fn(createRoleRepo({ dir, skillsDir, now: () => NOW }), dir, skillsDir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function roleOf(overrides: Partial<Role> & { id: string }): Role {
  return { name: overrides.id, duty: '负责交付', skillIds: [], builtin: false, updatedAt: 0, ...overrides }
}

/* ───────────────────────────── 内置角色的提示词 ───────────────────────────── */

test('内置 11 个角色都带非空中文 prompt，两两互异，且不超过上限', () => {
  assert.equal(BUILTIN_ROLES.length, 11, '内置角色数量是契约（r10 AC-17：6 → 11，设置页「恢复默认」按它逐字重写）')
  const seen = new Map<string, string>()
  for (const role of BUILTIN_ROLES) {
    const prompt = role.prompt ?? ''
    assert.ok(prompt.trim() !== '', `${role.id} 的 prompt 不能为空`)
    assert.ok(prompt.length <= ROLE_PROMPT_MAX, `${role.id} 的 prompt 超过 ${ROLE_PROMPT_MAX} 字符`)
    assert.match(prompt, CJK, `${role.id} 的 prompt 必须是中文（面向中文团队成员）`)
    const clash = seen.get(prompt)
    assert.equal(clash, undefined, `${role.id} 的 prompt 与 ${clash} 逐字相同：那就是没有各自职责`)
    seen.set(prompt, role.id)
  }
})

test('内置角色：name/duty 两两互异、skillIds 1–2 且全部命中出厂技能（AC-17/AC-19）', () => {
  const ids = new Set<string>()
  const names = new Map<string, string>()
  const duties = new Map<string, string>()
  const skillIds = new Set(BUILTIN_SKILLS.map((skill) => skill.id))
  for (const role of BUILTIN_ROLES) {
    assert.equal(ids.has(role.id), false, `内置角色 id 重复：${role.id}`)
    ids.add(role.id)
    const nameClash = names.get(role.name)
    assert.equal(nameClash, undefined, `${role.id} 与 ${nameClash} 的 name 重复：界面上分不清谁是谁`)
    names.set(role.name, role.id)
    const dutyClash = duties.get(role.duty)
    assert.equal(dutyClash, undefined, `${role.id} 与 ${dutyClash} 的 duty 逐字相同`)
    duties.set(role.duty, role.id)
    assert.ok(role.skillIds.length >= 1 && role.skillIds.length <= 2, `${role.id} 的 skillIds 必须是 1–2 个`)
    for (const skillId of role.skillIds) {
      assert.equal(skillIds.has(skillId), true, `${role.id} 引用了不存在的技能：${skillId}（角色卡会显示悬空技能）`)
    }
  }
  // r10 新增的 5 个角色 id 是 PRD 里定死的（面板角色卡按 id 排序展示）。
  for (const id of ['frontend', 'backend', 'designer', 'devops', 'security']) {
    assert.equal(ids.has(id), true, `缺少 r10 新增内置角色：${id}`)
  }
})

test('产品经理的 prompt 含「验收标准必须可判定」（AC-7 的特征串）', () => {
  const pm = BUILTIN_ROLES.find((role) => role.id === 'pm')
  assert.ok(pm)
  assert.ok((pm.prompt ?? '').includes('验收标准必须可判定'), 'pm 的 prompt 缺特征串')
})

test('validatePrompt：缺席/空白合法，超长与类型错报错（不截断）', () => {
  assert.deepEqual(validatePrompt(undefined), { ok: true })
  assert.deepEqual(validatePrompt('   '), { ok: true })
  assert.deepEqual(validatePrompt('  按方案实现  '), { ok: true, prompt: '按方案实现' })
  const tooLong = validatePrompt('x'.repeat(ROLE_PROMPT_MAX + 1))
  assert.equal(tooLong.ok, false)
  if (!tooLong.ok) assert.match(tooLong.error, new RegExp(`最多 ${ROLE_PROMPT_MAX} 字符`))
  const wrongType = validatePrompt(42)
  assert.equal(wrongType.ok, false)
  if (!wrongType.ok) assert.equal(wrongType.error, '角色提示词必须是文本')
})

/* ───────────────────────────── seed 与读盘 ───────────────────────────── */

test('seed()：11 个内置角色的 prompt 逐字落盘，且 get() 读回来一致', () => {
  withRepo((repo, dir) => {
    repo.seed()
    const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
    assert.deepEqual(files, BUILTIN_ROLES.map((role) => `${role.id}.json`).sort())
    for (const role of BUILTIN_ROLES) {
      const raw = JSON.parse(readFileSync(join(dir, `${role.id}.json`), 'utf8')) as Role
      assert.equal(raw.prompt, role.prompt, `${role.id} 的 prompt 必须原样落盘`)
      assert.equal(repo.get(role.id)?.prompt, role.prompt, `${role.id} 读回来的 prompt 必须与内置逐字相同`)
    }
  })
})

test('seed() 幂等：用户改过的角色不会被第二次 seed 覆盖', () => {
  withRepo((repo, dir) => {
    repo.seed()
    const saved = repo.save(roleOf({ id: 'pm', name: '产品经理', duty: '被用户改过', prompt: '自定义提示词' }))
    assert.equal(saved.ok, true)
    repo.seed()
    assert.equal(repo.get('pm')?.duty, '被用户改过', 'seed 只补缺，不覆盖用户编辑')
    assert.equal(JSON.parse(readFileSync(join(dir, 'pm.json'), 'utf8')).prompt, '自定义提示词')
  })
})

test('seed() 升级路径：既有安装缺 prompt 字段时按内置补齐，且不覆盖用户已编辑的值（QA-R7-01）', () => {
  withRepo((repo, dir) => {
    // 逐字模拟 r6 落盘的形状：6 个内置角色文件，没有 `prompt` 键；其中 pm 的 duty 被用户改过。
    for (const role of BUILTIN_ROLES) {
      const legacy: Record<string, unknown> = {
        id: role.id,
        name: role.name,
        duty: role.id === 'pm' ? '用户改过的职责' : role.duty,
        skillIds: [...role.skillIds],
        builtin: true,
        updatedAt: 1_600_000_000_000,
      }
      writeFileSync(join(dir, `${role.id}.json`), `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
    }
    const customPath = join(dir, 'my-helper.json')
    writeFileSync(
      customPath,
      `${JSON.stringify({ id: 'my-helper', name: '我的助手', duty: '自建', skillIds: [], builtin: false, updatedAt: 5 }, null, 2)}\n`,
      'utf8',
    )
    const customBefore = sha256(customPath)

    repo.seed()

    for (const role of BUILTIN_ROLES) {
      assert.equal(repo.get(role.id)?.prompt, role.prompt, `${role.id} 升级后必须补上内置 prompt`)
    }
    assert.equal(repo.get('pm')?.duty, '用户改过的职责', '补齐只补缺键：用户改过的 duty 不许被覆盖')
    assert.equal(sha256(customPath), customBefore, '自建角色一个字节都不许变')
  })
})

test('seed() 升级路径：补齐只做一次 —— 用户清空的提示词不会被下次启动复活', () => {
  withRepo((repo, dir) => {
    const path = join(dir, 'dev.json')
    writeFileSync(
      path,
      `${JSON.stringify({ id: 'dev', name: '开发', duty: '', skillIds: [], builtin: true, updatedAt: 1 })}\n`,
      'utf8',
    )
    repo.seed()
    assert.ok((repo.get('dev')?.prompt ?? '') !== '', '第一次升级必须把缺的 prompt 补上')
    // 用户随后清空提示词：真实写盘形状就是「不写这个键」（见 save()）。
    writeFileSync(
      path,
      `${JSON.stringify({ id: 'dev', name: '开发', duty: '', skillIds: [], builtin: true, updatedAt: 2 })}\n`,
      'utf8',
    )
    repo.seed()
    assert.equal(repo.get('dev')?.prompt, undefined, '补齐只做一次：不许把用户清空的提示词复活')
  })
})

test('seed() 升级路径：文件损坏时不落补齐标记，修好后下一次启动仍能补上', () => {
  withRepo((repo, dir) => {
    const path = join(dir, 'qa.json')
    writeFileSync(path, '{ 半个 JSON', 'utf8')
    repo.seed()
    assert.equal(existsSync(join(dir, '.seeded')), false, '没补全就不许落标记（否则永久漏补）')

    writeFileSync(
      path,
      `${JSON.stringify({ id: 'qa', name: '测试', duty: '', skillIds: [], builtin: true, updatedAt: 1 })}\n`,
      'utf8',
    )
    repo.seed()
    assert.equal(repo.get('qa')?.prompt, BUILTIN_ROLES.find((role) => role.id === 'qa')?.prompt)
    assert.equal(existsSync(join(dir, '.seeded')), true)
  })
})

test('seed() 升级路径：r7 安装（标记 schema=2、只有 6 个内置角色）升级后补齐 5 个新内置角色（r10 AC-17）', () => {
  withRepo((repo, dir) => {
    const legacyIds = ['pm', 'architect', 'dev', 'qa', 'docs', 'reviewer']
    for (const role of BUILTIN_ROLES.filter((item) => legacyIds.includes(item.id))) {
      const legacy = {
        id: role.id,
        name: role.name,
        duty: role.id === 'pm' ? '用户改过的职责' : role.duty,
        skillIds: [...role.skillIds],
        builtin: true,
        updatedAt: 1_600_000_000_000,
      }
      writeFileSync(join(dir, `${role.id}.json`), `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
    }
    writeFileSync(join(dir, '.seeded'), `${JSON.stringify({ schema: 2, at: 1_600_000_000_000 })}\n`, 'utf8')

    repo.seed()

    for (const id of ['frontend', 'backend', 'designer', 'devops', 'security']) {
      assert.equal(existsSync(join(dir, `${id}.json`)), true, `升级必须把新内置角色落到盘上：${id}`)
      assert.equal(repo.get(id)?.prompt, BUILTIN_ROLES.find((role) => role.id === id)?.prompt, `${id} 的 prompt 必须是内置原样`)
    }
    assert.equal(repo.get('pm')?.duty, '用户改过的职责', '既有文件只补缺键：用户改过的 duty 不许被覆盖')
    assert.equal(JSON.parse(readFileSync(join(dir, '.seeded'), 'utf8')).schema, 3, '补齐完成后标记必须升到 3，否则每次启动都重补')
  })
})

test('save()：prompt 去空白后落盘；空提示词不写这个键（盘上不该出现 "prompt": ""）', () => {
  withRepo((repo, dir) => {
    const withPrompt = repo.save(roleOf({ id: 'dev', prompt: '  按方案实现并自测  ' }))
    assert.equal(withPrompt.ok, true)
    if (withPrompt.ok) assert.equal(withPrompt.role.prompt, '按方案实现并自测')
    assert.equal(JSON.parse(readFileSync(join(dir, 'dev.json'), 'utf8')).prompt, '按方案实现并自测')

    const cleared = repo.save(roleOf({ id: 'dev', prompt: '   ' }))
    assert.equal(cleared.ok, true)
    if (cleared.ok) assert.equal(cleared.role.prompt, undefined)
    const raw = JSON.parse(readFileSync(join(dir, 'dev.json'), 'utf8')) as Record<string, unknown>
    assert.equal('prompt' in raw, false, '清空提示词 = 不写该键，而不是写空串')
  })
})

test('save()：超长提示词被拒且磁盘逐字不变（不截断、不静默保存）', () => {
  withRepo((repo, dir) => {
    assert.equal(repo.save(roleOf({ id: 'dev', prompt: '正常提示词' })).ok, true)
    const path = join(dir, 'dev.json')
    const before = readFileSync(path, 'utf8')

    const verdict = repo.save(roleOf({ id: 'dev', prompt: 'x'.repeat(ROLE_PROMPT_MAX + 1) }))
    assert.equal(verdict.ok, false)
    if (!verdict.ok) assert.match(verdict.error, new RegExp(`最多 ${ROLE_PROMPT_MAX} 字符`))
    assert.equal(readFileSync(path, 'utf8'), before, '被拒的保存不许改动磁盘')

    const wrongType = repo.save(roleOf({ id: 'dev', prompt: 42 as unknown as string }))
    assert.equal(wrongType.ok, false, '面板把整个 role 回传时，类型错必须被拦住')
  })
})

/* ───────────────────────────── builtin 推导（AC-8 绕道） ───────────────────────────── */

test('save()：自建 id 即使带 builtin:true，落盘也必须是 builtin:false', () => {
  withRepo((repo, dir) => {
    const saved = repo.save(roleOf({ id: 'sneaky', builtin: true }))
    assert.equal(saved.ok, true)
    if (saved.ok) assert.equal(saved.role.builtin, false, 'builtin 必须由 BUILTIN_ROLES 推导')
    assert.equal(JSON.parse(readFileSync(join(dir, 'sneaky.json'), 'utf8')).builtin, false)
  })
})

test('save()：磁盘上已有的 builtin:true 不许被继承（这条是旧实现 `existing?.builtin ?? …` 的判死线）', () => {
  withRepo((repo, dir) => {
    repo.seed() // 建目录
    // 先手写一份「旧版本写坏的」自建角色文件：id 不在 BUILTIN_ROLES，但磁盘标了 builtin:true。
    writeFileSync(
      join(dir, 'inherited.json'),
      `${JSON.stringify({ id: 'inherited', name: '旧', duty: '', skillIds: [], builtin: true, updatedAt: 0 }, null, 2)}\n`,
      'utf8',
    )
    const saved = repo.save(roleOf({ id: 'inherited' }))
    assert.equal(saved.ok, true)
    // 旧实现从磁盘继承 builtin:true → 这里会是 true；新实现永远是 false。
    if (saved.ok) assert.equal(saved.role.builtin, false, 'builtin 不许从磁盘继承')
    assert.equal(JSON.parse(readFileSync(join(dir, 'inherited.json'), 'utf8')).builtin, false)
    assert.equal(repo.remove('inherited').ok, true, '改存后它就是普通自建角色，必须可删')
  })
})

test('remove()：手改磁盘的 builtin:true 不能提供删除豁免（旧版本数据也不许绕道）', () => {
  withRepo((repo, dir) => {
    repo.seed() // 先建目录与内置文件，再模拟旧版本留下的脏文件
    // 模拟旧版本/手改留下的脏文件：自建 id 但标了 builtin:true。
    writeFileSync(
      join(dir, 'legacy.json'),
      `${JSON.stringify({ id: 'legacy', name: '旧角色', duty: '', skillIds: [], builtin: true, updatedAt: 0 }, null, 2)}\n`,
      'utf8',
    )
    const removed = repo.remove('legacy')
    assert.equal(removed.ok, true, '自建 id 即使磁盘写着 builtin:true 也必须可删')
    assert.equal(existsSync(join(dir, 'legacy.json')), false)
  })
})

test('remove()：内置角色一律不可删（可改不可删）', () => {
  withRepo((repo) => {
    repo.seed()
    for (const role of BUILTIN_ROLES) {
      const verdict = repo.remove(role.id)
      assert.equal(verdict.ok, false, `${role.id} 是内置角色，不能删`)
      if (!verdict.ok) assert.match(verdict.error, /内置角色不可删除/)
    }
  })
})

test('list()/get()：内置角色即便文件被删也仍在列表里，且仍带 prompt', () => {
  withRepo((repo, dir) => {
    repo.seed()
    rmSync(join(dir, 'qa.json'))
    const listed = repo.list()
    assert.equal(listed.length, BUILTIN_ROLES.length)
    const qa = listed.find((role) => role.id === 'qa')
    assert.ok(qa)
    assert.equal(qa.prompt, BUILTIN_ROLES.find((role) => role.id === 'qa')?.prompt)
    assert.equal(repo.get('qa')?.builtin, true)
  })
})

/* ───────────────────────────── 一键恢复默认（AC-8） ───────────────────────────── */

test('restoreDefaults()：改坏的 pm 恢复成与内置逐字相等，自建角色字节不变', () => {
  withRepo((repo, dir) => {
    repo.seed()
    // 先把 pm 改坏（duty 与 prompt 都改），再造一个自建角色。
    assert.equal(
      repo.save(roleOf({ id: 'pm', name: '产品经理', duty: '被改坏的职责', prompt: '被改坏的提示词' })).ok,
      true,
    )
    assert.equal(repo.save(roleOf({ id: 'my-helper', name: '我的助手', duty: '自建角色', prompt: '自建提示词' })).ok, true)
    const customPath = join(dir, 'my-helper.json')
    const customBefore = sha256(customPath)
    // 先证明「改坏了」这件事真的发生过（否则下面的恢复断言可能天然成立）。
    assert.notEqual(repo.get('pm')?.prompt, BUILTIN_ROLES.find((role) => role.id === 'pm')?.prompt)

    const result = repo.restoreDefaults()
    assert.deepEqual(result.restored, BUILTIN_ROLES.map((role) => role.id).sort())
    assert.deepEqual(result.kept, ['my-helper'])

    const builtinPm = BUILTIN_ROLES.find((role) => role.id === 'pm')
    assert.ok(builtinPm)
    const restored = repo.get('pm')
    assert.ok(restored)
    assert.equal(restored.duty, builtinPm.duty, 'duty 必须逐字复原')
    assert.equal(restored.prompt, builtinPm.prompt, 'prompt 必须逐字复原')
    assert.deepEqual(restored.skillIds, builtinPm.skillIds)
    assert.equal(restored.builtin, true)
    assert.equal(restored.updatedAt, NOW, '恢复后要能看出动作发生过（不是内置的 0）')

    assert.equal(sha256(customPath), customBefore, '自建角色一个字节都不许变（AC-8）')
  })
})

test('restoreDefaults()：十一个内置角色全部逐字复原（不只 pm），kept 列出全部自建 id', () => {
  withRepo((repo, dir) => {
    repo.seed()
    for (const role of BUILTIN_ROLES) {
      repo.save({ ...role, duty: `改坏-${role.id}`, prompt: `改坏-${role.id}` })
    }
    repo.save(roleOf({ id: 'a-custom' }))
    repo.save(roleOf({ id: 'b-custom' }))

    const result = repo.restoreDefaults()
    assert.deepEqual(result.kept, ['a-custom', 'b-custom'])
    for (const role of BUILTIN_ROLES) {
      const onDisk = JSON.parse(readFileSync(join(dir, `${role.id}.json`), 'utf8')) as Role
      assert.equal(onDisk.duty, role.duty, `${role.id} duty 未复原`)
      assert.equal(onDisk.prompt, role.prompt, `${role.id} prompt 未复原`)
      assert.equal(onDisk.name, role.name, `${role.id} name 未复原`)
      assert.deepEqual(onDisk.skillIds, role.skillIds, `${role.id} skillIds 未复原`)
    }
    // 角色文件集合必须恰为「内置 11 + 自建 2」；`.seeded` 是升级补齐标记，不是角色文件。
    assert.deepEqual(
      readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .sort(),
      [...BUILTIN_ROLES.map((role) => `${role.id}.json`), 'a-custom.json', 'b-custom.json'].sort(),
    )
  })
})

test('restoreDefaults()：把被删掉的内置角色文件补回盘上（不新增自建、不删自建）', () => {
  withRepo((repo, dir) => {
    repo.seed()
    rmSync(join(dir, 'reviewer.json'))
    rmSync(join(dir, 'dev.json'))
    assert.equal(existsSync(join(dir, 'dev.json')), false)

    const result = repo.restoreDefaults()
    assert.equal(result.restored.length, BUILTIN_ROLES.length)
    assert.deepEqual(result.kept, [])
    for (const role of BUILTIN_ROLES) {
      assert.equal(existsSync(join(dir, `${role.id}.json`)), true, `${role.id} 文件必须被重建`)
    }
  })
})
