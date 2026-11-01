/**
 * 可配参数的读写与校验（r7 AC-13 / AC-17）。
 *
 * 三条不变量是本模块存在的全部理由：
 *   1. **校验与落盘一个入口**：`save()` 先 `validateSettings` 再写盘，非法提交磁盘逐字不变（AC-17）。
 *      绕开它直接写文件 = 允许 `{"concurrencyLimit": 999}` 进盘，下次启动并发被打满。
 *   2. **缺省值只有一个来源**：每个字段缺席就取 `config.ts` 的 `DEFAULT_SETTINGS`，
 *      所以「没有 settings.json」「空文件」「少写一项」三者等价 —— 而不是三套结论。
 *   3. **原子写**：先写 `<file>.tmp` 再 `rename`。半截文件会让 `read()` 回落到缺省值，
 *      用户看到的是「设置莫名全丢」，比拒绝保存难排查得多。
 *
 * 落点由调用方注入（`paths.settingsPath(home)`），本模块不读环境、不 import node:os。
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from './config.ts'
import { validateModel } from './roles/repo.ts'
import type { AutoTeamSettings } from '../shared/types.ts'

/** 保存结果：失败必须是**可读中文原因**（界面直接显示，不翻译）。 */
export type SettingsSaveResult = { ok: true; settings: AutoTeamSettings } | { ok: false; reason: string }

/** 校验结果（`read()` 内部也走它，保证读盘与写盘同一套规则）。 */
export type SettingsValidation = { ok: true; settings: AutoTeamSettings } | { ok: false; reason: string }

export interface SettingsRepoDeps {
  /** settings.json 的绝对路径（`paths.settingsPath(home)`）。 */
  file: string
  /** 预留时钟注入（当前无时间字段；保持契约稳定，避免以后为加 `updatedAt` 改签名）。 */
  now?: () => number
  /** 读盘回落时的告警出口（缺省静默：单测与无 logger 的宿主都不该被噪声打扰）。 */
  warn?: (message: string) => void
}

export interface SettingsRepo {
  /** 落点回显（面板「设置存在哪」与真机核对用）。 */
  path(): string
  /** 读盘：缺文件/损坏/非法都回落缺省值（绝不抛异常 —— 设置坏了不该让插件起不来）。 */
  read(): AutoTeamSettings
  /** 校验 + 原子写；非法时磁盘一字不改。 */
  save(raw: unknown): SettingsSaveResult
}

/** 缺省参数的一份拷贝（返回新对象：调用方改它不该污染常量）。 */
export function defaultSettings(): AutoTeamSettings {
  return { ...DEFAULT_SETTINGS }
}

/**
 * 校验并补齐参数。
 *
 * 规则：数字项必须是**整数**且落在 `SETTINGS_LIMITS` 的闭区间内；缺席 = 取缺省；
 * `captainModel` 复用 `roles/repo.ts` 的 `validateModel`（禁止在校验上出现第二份实现）。
 * 未知键忽略（前向兼容：新版本写下的字段不该让老版本整体拒绝）。
 */
export function validateSettings(raw: unknown): SettingsValidation {
  if (raw === null || raw === undefined) return { ok: true, settings: defaultSettings() }
  if (!isRecord(raw)) return { ok: false, reason: '设置必须是对象' }

  const settings = defaultSettings()
  const numbers: { key: NumericKey; label: string }[] = [
    { key: 'concurrencyLimit', label: '并发上限' },
    { key: 'memoryBudget', label: '记忆预算' },
    { key: 'stallMs', label: '停滞阈值' },
    { key: 'maxAttempts', label: '返工上限' },
    { key: 'gateTimeoutMs', label: '门禁超时' },
  ]
  for (const item of numbers) {
    const value = raw[item.key]
    if (value === undefined || value === null) continue
    const [min, max] = SETTINGS_LIMITS[item.key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      return { ok: false, reason: `${item.label}需为 ${min}~${max} 的整数` }
    }
    settings[item.key] = value
  }

  const rawModel = raw.captainModel
  if (rawModel !== undefined && rawModel !== null) {
    if (isRecord(rawModel)) {
      const hasProvider = hasText(rawModel.provider)
      const hasModel = hasText(rawModel.model)
      // 只填一半是最容易发生的输入事故（页面两个输入框、用户只填了一个）。
      if (hasProvider !== hasModel) return { ok: false, reason: '队长模型：提供方与模型需同时填写' }
    }
    const checked = validateModel(rawModel)
    if (!checked.ok) return { ok: false, reason: `队长模型不合法：${checked.error}` }
    if (checked.model) settings.captainModel = checked.model
  }

  return { ok: true, settings }
}

/** 创建仓储（一个文件一个实例；宿主侧只在 apply 里建一次）。 */
export function createSettingsRepo(deps: SettingsRepoDeps): SettingsRepo {
  const file = deps.file
  const warn = deps.warn ?? (() => {})

  return {
    path: () => file,

    read(): AutoTeamSettings {
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        // 首次启动必然没有这个文件：这是正常路径，不是错误。
        return defaultSettings()
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        warn(`settings.json 解析失败，回落缺省值：${describe(error)}`)
        return defaultSettings()
      }
      const checked = validateSettings(parsed)
      if (!checked.ok) {
        warn(`settings.json 内容非法（${checked.reason}），回落缺省值`)
        return defaultSettings()
      }
      return checked.settings
    },

    save(raw: unknown): SettingsSaveResult {
      const checked = validateSettings(raw)
      // 关键：校验失败时**一个字节都不写**（AC-17 的可判定形态）。
      if (!checked.ok) return checked
      const body = `${JSON.stringify(checked.settings, null, 2)}\n`
      const tmp = `${file}.tmp`
      try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(tmp, body, 'utf8')
        renameSync(tmp, file)
      } catch (error) {
        // 半截 tmp 不该留在磁盘上（下次读的是 settings.json，但目录里多一个垃圾文件）。
        try {
          rmSync(tmp, { force: true })
        } catch {
          /* 清理失败不影响结论：真正的失败原因已经拿到了 */
        }
        return { ok: false, reason: `写入设置失败：${describe(error)}` }
      }
      return { ok: true, settings: checked.settings }
    },
  }
}

/** 可配的数字项（与 `SETTINGS_LIMITS` 的键一一对应）。 */
type NumericKey = 'concurrencyLimit' | 'memoryBudget' | 'stallMs' | 'maxAttempts' | 'gateTimeoutMs'

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
