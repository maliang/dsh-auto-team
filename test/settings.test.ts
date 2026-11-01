/**
 * 可配参数（settings.json）单测：r7 AC-13 / AC-17 / AC-11。
 *
 * 三条判据按重要性排序：
 *   1. **非法提交磁盘逐字不变**（AC-17）—— 先校验后写盘的可判定形态；
 *   2. 每个字段的边界闭区间（上下界合法、越界拒绝）；
 *   3. 落点必须是 `<home>/.dsh/auto-team/settings.json`（拼第二层 `.dsh` 会「保存成功、重启全丢」）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, ROLE_PROMPT_MAX, SETTINGS_LIMITS } from '../src/host/config.ts'
import { settingsPath } from '../src/host/paths.ts'
import { createSettingsRepo, defaultSettings, validateSettings } from '../src/host/settings.ts'

const HOME = '/Users/maliang'

function withTempFile(fn: (file: string, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'auto-team-settings-'))
  try {
    fn(join(dir, 'settings.json'), dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/* ───────────────────────────── 缺省值与落点 ───────────────────────────── */

test('settingsPath：落点是 <home>/.dsh/auto-team/settings.json（不拼第二层 .dsh）', () => {
  assert.equal(settingsPath(HOME), '/Users/maliang/.dsh/auto-team/settings.json')
  assert.equal(settingsPath(`${HOME}/`), '/Users/maliang/.dsh/auto-team/settings.json', '尾斜杠不该产生双斜杠')
  assert.equal(settingsPath(HOME).includes('/.dsh/.dsh/'), false, '拼第二层 .dsh 会落到错误目录')
})

test('defaultSettings：等于 config 的 DEFAULT_SETTINGS，且返回的是拷贝', () => {
  assert.deepEqual(defaultSettings(), DEFAULT_SETTINGS)
  const copy = defaultSettings()
  copy.concurrencyLimit = 8
  assert.equal(DEFAULT_SETTINGS.concurrencyLimit, 3, '调用方改返回值不许污染常量')
  assert.equal(DEFAULT_SETTINGS.captainModel, undefined, '缺省 = 跟随会话默认，不得凭空塞一个模型')
})

test('缺省值引用冻结常量：改 config 的常量就是改缺省值（不存在第二份数字）', () => {
  // 这里断言「值相等」而不是「字面量相等」：一旦有人把 3 抄成 4，DEFAULT_MAX_CONCURRENT 会立刻不等。
  assert.equal(DEFAULT_SETTINGS.concurrencyLimit, 3)
  assert.equal(DEFAULT_SETTINGS.memoryBudget, 4000)
  assert.equal(DEFAULT_SETTINGS.stallMs, 90_000)
  assert.equal(DEFAULT_SETTINGS.maxAttempts, 3)
  assert.equal(DEFAULT_SETTINGS.gateTimeoutMs, 300_000)
  assert.equal(ROLE_PROMPT_MAX, 8000)
})

/* ───────────────────────────── 校验：数字项边界 ───────────────────────────── */

test('validateSettings：缺席 / null / 非对象 / 空对象都补成完整缺省值', () => {
  assert.deepEqual(validateSettings(undefined), { ok: true, settings: DEFAULT_SETTINGS })
  assert.deepEqual(validateSettings(null), { ok: true, settings: DEFAULT_SETTINGS })
  assert.deepEqual(validateSettings({}), { ok: true, settings: DEFAULT_SETTINGS })
  const notObject = validateSettings('nope')
  assert.equal(notObject.ok, false)
  if (!notObject.ok) assert.equal(notObject.reason, '设置必须是对象')
  assert.equal(validateSettings([1, 2]).ok, false, '数组不是设置对象')
})

test('validateSettings：并发上限 1~8 闭区间，越界/小数/字符串/布尔全部拒绝', () => {
  const [min, max] = SETTINGS_LIMITS.concurrencyLimit
  assert.equal(validateSettings({ concurrencyLimit: min }).ok, true)
  assert.equal(validateSettings({ concurrencyLimit: max }).ok, true)
  for (const bad of [min - 1, max + 1, 3.5, '3', true, NaN, Infinity]) {
    const verdict = validateSettings({ concurrencyLimit: bad })
    assert.equal(verdict.ok, false, `并发上限 ${String(bad)} 必须被拒`)
    if (!verdict.ok) assert.equal(verdict.reason, '并发上限需为 1~8 的整数')
  }
})

test('validateSettings：记忆预算 / 停滞阈值 / 返工上限 / 门禁超时 四个边界各自成立', () => {
  const cases: { key: 'memoryBudget' | 'stallMs' | 'maxAttempts' | 'gateTimeoutMs'; label: string }[] = [
    { key: 'memoryBudget', label: '记忆预算' },
    { key: 'stallMs', label: '停滞阈值' },
    { key: 'maxAttempts', label: '返工上限' },
    { key: 'gateTimeoutMs', label: '门禁超时' },
  ]
  for (const item of cases) {
    const [min, max] = SETTINGS_LIMITS[item.key]
    const atMin = validateSettings({ [item.key]: min })
    const atMax = validateSettings({ [item.key]: max })
    assert.equal(atMin.ok, true, `${item.label} 下界必须合法`)
    assert.equal(atMax.ok, true, `${item.label} 上界必须合法`)
    if (atMin.ok) assert.equal(atMin.settings[item.key], min)
    if (atMax.ok) assert.equal(atMax.settings[item.key], max)

    for (const bad of [min - 1, max + 1]) {
      const verdict = validateSettings({ [item.key]: bad })
      assert.equal(verdict.ok, false, `${item.label} 越界 ${bad} 必须被拒`)
      if (!verdict.ok) assert.equal(verdict.reason, `${item.label}需为 ${min}~${max} 的整数`)
    }
  }
})

test('validateSettings：只写一项时其余项保持缺省（少写一项 ≠ 全部丢失）', () => {
  const verdict = validateSettings({ memoryBudget: 200 })
  assert.equal(verdict.ok, true)
  if (!verdict.ok) return
  assert.equal(verdict.settings.memoryBudget, 200)
  assert.equal(verdict.settings.concurrencyLimit, DEFAULT_SETTINGS.concurrencyLimit)
  assert.equal(verdict.settings.stallMs, DEFAULT_SETTINGS.stallMs)
})

test('validateSettings：未知键忽略（前向兼容，老版本不该整体拒绝新字段）', () => {
  const verdict = validateSettings({ concurrencyLimit: 4, futureKey: 'x' })
  assert.equal(verdict.ok, true)
  if (verdict.ok) assert.equal(verdict.settings.concurrencyLimit, 4)
})

/* ───────────────────────────── 校验：队长模型 ───────────────────────────── */

test('validateSettings：captainModel 两个都空 = 跟随会话默认，两个都填 = 采用', () => {
  const empty = validateSettings({ captainModel: { provider: '', model: '' } })
  assert.equal(empty.ok, true)
  if (empty.ok) assert.equal(empty.settings.captainModel, undefined)

  const filled = validateSettings({ captainModel: { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' } })
  assert.equal(filled.ok, true)
  if (filled.ok) {
    assert.deepEqual(filled.settings.captainModel, {
      provider: 'deepseek',
      model: 'deepseek-v4',
      reasoningEffort: 'high',
    })
  }
})

test('validateSettings：captainModel 只填一半 → 「提供方与模型需同时填写」', () => {
  for (const half of [{ provider: 'deepseek' }, { model: 'deepseek-v4' }]) {
    const verdict = validateSettings({ captainModel: half })
    assert.equal(verdict.ok, false, `半份模型 ${JSON.stringify(half)} 必须被拒`)
    if (!verdict.ok) assert.equal(verdict.reason, '队长模型：提供方与模型需同时填写')
  }
})

test('validateSettings：captainModel 含空白 / 非法 reasoningEffort 走 repo 的同一套校验', () => {
  const spaced = validateSettings({ captainModel: { provider: 'deep seek', model: 'x' } })
  assert.equal(spaced.ok, false)
  if (!spaced.ok) assert.ok(spaced.reason.startsWith('队长模型不合法：'), spaced.reason)

  const badEffort = validateSettings({ captainModel: { provider: 'p', model: 'm', reasoningEffort: 'ultra' } })
  assert.equal(badEffort.ok, false)
  if (!badEffort.ok) assert.match(badEffort.reason, /reasoningEffort/)
})

/* ───────────────────────────── 仓储：读盘回落与写入 ───────────────────────────── */

test('repo.read()：文件不存在 = 首次启动，回落缺省值且不算错误', () => {
  withTempFile((file) => {
    let warned = 0
    const repo = createSettingsRepo({ file, warn: () => { warned += 1 } })
    assert.equal(repo.path(), file)
    assert.deepEqual(repo.read(), DEFAULT_SETTINGS)
    assert.equal(warned, 0, '没有文件是正常路径，不许刷告警')
  })
})

test('repo.read()：JSON 损坏 / 内容非法都回落缺省值并告警（绝不抛异常）', () => {
  withTempFile((file) => {
    const messages: string[] = []
    const repo = createSettingsRepo({ file, warn: (message) => messages.push(message) })

    writeFileSync(file, '{ not json', 'utf8')
    assert.deepEqual(repo.read(), DEFAULT_SETTINGS)
    assert.equal(messages.length, 1)
    assert.match(messages[0], /解析失败/)

    writeFileSync(file, JSON.stringify({ concurrencyLimit: 999 }), 'utf8')
    assert.deepEqual(repo.read(), DEFAULT_SETTINGS)
    assert.equal(messages.length, 2)
    assert.match(messages[1], /内容非法（并发上限需为 1~8 的整数）/)
  })
})

test('repo.save()：合法值落盘（缩进 2 + 结尾换行），跨实例读回一致', () => {
  withTempFile((file, dir) => {
    const repo = createSettingsRepo({ file })
    const saved = repo.save({ concurrencyLimit: 5, memoryBudget: 1000 })
    assert.equal(saved.ok, true)
    if (!saved.ok) return
    assert.equal(saved.settings.concurrencyLimit, 5)
    assert.equal(saved.settings.stallMs, DEFAULT_SETTINGS.stallMs, '缺席项必须补齐缺省值再落盘')

    const text = readFileSync(file, 'utf8')
    assert.ok(text.endsWith('\n'), '落盘文件以换行结尾（与项目其它 JSON 落盘一致）')
    assert.equal(JSON.parse(text).concurrencyLimit, 5)
    assert.deepEqual(readdirSync(dir), ['settings.json'], '原子写不许留下 .tmp')

    // 新实例 = 模拟宿主重启：参数必须还在（这是「保存成功但重启全丢」的反证）。
    const again = createSettingsRepo({ file })
    assert.equal(again.read().concurrencyLimit, 5)
    assert.equal(again.read().memoryBudget, 1000)
  })
})

test('repo.save()：非法提交被拒，且磁盘**逐字不变**（AC-17）', () => {
  withTempFile((file, dir) => {
    const repo = createSettingsRepo({ file })
    assert.equal(repo.save({ concurrencyLimit: 4, stallMs: 12_345 }).ok, true)
    const before = readFileSync(file, 'utf8')

    for (const bad of [
      { concurrencyLimit: 9 },
      { memoryBudget: 199 },
      { stallMs: 999 },
      { maxAttempts: 11 },
      { gateTimeoutMs: 0 },
      { captainModel: { provider: 'deepseek' } },
      'not-an-object',
    ]) {
      const verdict = repo.save(bad)
      assert.equal(verdict.ok, false, `非法提交 ${JSON.stringify(bad)} 必须被拒`)
      assert.equal(readFileSync(file, 'utf8'), before, '被拒的提交不许改动磁盘一个字节')
      assert.deepEqual(readdirSync(dir), ['settings.json'], '被拒时也不许留 .tmp')
    }
    assert.equal(repo.read().concurrencyLimit, 4, '旧值必须完好')
  })
})

test('repo.save()：首次保存会建父目录（settings.json 与 roles/ 同根）', () => {
  withTempFile((file) => {
    const nested = join(file, '..', 'deeper', 'settings.json')
    const repo = createSettingsRepo({ file: nested })
    assert.equal(repo.save({ concurrencyLimit: 2 }).ok, true)
    assert.equal(createSettingsRepo({ file: nested }).read().concurrencyLimit, 2)
  })
})

test('repo.save() → repo.read() 往返：captainModel 与五个数字项都不丢', () => {
  withTempFile((file) => {
    const repo = createSettingsRepo({ file })
    const input = {
      concurrencyLimit: 8,
      memoryBudget: 200,
      stallMs: 600_000,
      maxAttempts: 10,
      gateTimeoutMs: 1_000,
      captainModel: { provider: 'p', model: 'm' },
    }
    assert.equal(repo.save(input).ok, true)
    assert.deepEqual(repo.read(), input)
  })
})
