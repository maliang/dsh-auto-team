/**
 * 设置页（`settings.section` 挂载点，DESIGN §2.4 / TECHNICAL §4.6）。
 *
 * 两条硬规矩：
 *  1. **参数行（顺序 / 标签 / 范围提示）单点来自 `ui.settingsKeysView`** —— 本组件不再自写
 *     一套中文文案，否则设置页与面板里对同一个参数的叫法迟早分叉。
 *  2. **保存只能走 `act({type:'saveSettings'})`**：不新增 fetch、不新增路由。
 *     宿主 `settingsRepo.save` 是「先校验后原子写」的唯一入口，非法值在磁盘上逐字不变
 *     （AC-17）；客户端这份范围校验只是为了少跑一趟网络（文案与 host SETTINGS_LIMITS 对齐）。
 *
 * 角色区与面板角色页共用 `RoleEditorList`（同一个保存链，DESIGN §0.8-9）：
 * 这里只是换 `density="page"`（宽、大字号），行为完全一致。
 */
import * as React from 'react'
import type { AutoTeamSettings, Result, Role, SkillInfo, SkillMutation } from '../shared/types.ts'
import { settingsKeysView } from './ui.ts'
import { actFeedback, hintOf } from './viewmodel.ts'
import { panelApi } from './api.ts'
import type { SkillBodyPayload } from './api.ts'
import { RoleEditorList } from './RoleEditor.tsx'
import { usePanelState, sessionIdOf } from './state.ts'
import { useAutoTeamStyle } from './styles.ts'

/** 与 host `src/host/config.ts` 的 `DEFAULT_SETTINGS` 逐字一致：仅在快照未带 settings 时兜底显示。 */
const FALLBACK_SETTINGS: AutoTeamSettings = {
  concurrencyLimit: 3,
  memoryBudget: 4000,
  stallMs: 90000,
  maxAttempts: 3,
  gateTimeoutMs: 300000,
}

/** 与 host `src/host/config.ts` 的 `SETTINGS_LIMITS` 逐字一致（client 不能 import host）。 */
const LIMITS: Record<'concurrencyLimit' | 'memoryBudget' | 'stallMs' | 'maxAttempts' | 'gateTimeoutMs', [number, number]> = {
  concurrencyLimit: [1, 8],
  memoryBudget: [200, 4000],
  stallMs: [1000, 600000],
  maxAttempts: [1, 10],
  gateTimeoutMs: [1000, 600000],
}

const NUMBER_KEYS = ['concurrencyLimit', 'memoryBudget', 'stallMs', 'maxAttempts', 'gateTimeoutMs'] as const
type NumberKey = (typeof NUMBER_KEYS)[number]

interface Draft {
  concurrencyLimit: string
  memoryBudget: string
  stallMs: string
  maxAttempts: string
  gateTimeoutMs: string
  captainProvider: string
  captainModel: string
}

function draftOf(settings: AutoTeamSettings): Draft {
  return {
    concurrencyLimit: String(settings.concurrencyLimit),
    memoryBudget: String(settings.memoryBudget),
    stallMs: String(settings.stallMs),
    maxAttempts: String(settings.maxAttempts),
    gateTimeoutMs: String(settings.gateTimeoutMs),
    captainProvider: settings.captainModel?.provider ?? '',
    captainModel: settings.captainModel?.model ?? '',
  }
}

/** 返回 `{ key: message }`，空对象 = 全部合法。 */
function validateDraft(draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const key of NUMBER_KEYS) {
    const raw = draft[key].trim()
    const [low, high] = LIMITS[key]
    if (raw === '') {
      errors[key] = '必填'
      continue
    }
    const value = Number(raw)
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      errors[key] = '必须是整数'
      continue
    }
    if (value < low || value > high) errors[key] = `取值范围 ${low}–${high}`
  }
  const provider = draft.captainProvider.trim()
  const model = draft.captainModel.trim()
  if ((provider === '') !== (model === '')) errors.captainModel = 'provider 与 model 必须同时填写或同时留空'
  return errors
}

export interface SettingsSectionProps {
  sessionId?: string
  session?: unknown
}

export function SettingsSection(props: SettingsSectionProps): React.ReactElement {
  useAutoTeamStyle()
  const sessionId = sessionIdOf(props)
  const state = usePanelState(sessionId)
  const settings: AutoTeamSettings = state.snapshot?.settings ?? FALLBACK_SETTINGS
  const roles: Role[] = state.snapshot?.roles ?? []
  const skills: SkillInfo[] = state.snapshot?.skills ?? []

  const [draft, setDraft] = React.useState<Draft>(() => draftOf(settings))
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [hint, setHint] = React.useState<string | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)

  // 只在**已保存的值真的变了**时重置草稿：store 每 2s 轮询会产出新对象，
  // 拿对象引用当依赖会把用户正在改的数字每秒清一次（静默丢输入）。
  const savedSignature = JSON.stringify(settings)
  const signatureRef = React.useRef(savedSignature)
  React.useEffect(() => {
    if (signatureRef.current === savedSignature) return
    signatureRef.current = savedSignature
    setDraft(draftOf(settings))
    setErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖是内容签名，不是对象引用（见上）
  }, [savedSignature])

  const act = state.act as (action: unknown) => Promise<unknown>

  async function save(): Promise<void> {
    const found = validateDraft(draft)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setHint('有参数不合法，未提交（磁盘上的设置保持原样）')
      return
    }
    const next: AutoTeamSettings = {
      concurrencyLimit: Number(draft.concurrencyLimit.trim()),
      memoryBudget: Number(draft.memoryBudget.trim()),
      stallMs: Number(draft.stallMs.trim()),
      maxAttempts: Number(draft.maxAttempts.trim()),
      gateTimeoutMs: Number(draft.gateTimeoutMs.trim()),
    }
    const provider = draft.captainProvider.trim()
    const model = draft.captainModel.trim()
    if (provider !== '' && model !== '') next.captainModel = { provider, model }

    setBusy(true)
    try {
      const feedback = await actFeedback(act, { type: 'saveSettings', settings: next })
      setHint(hintOf(feedback) ?? (feedback.ok ? '设置已保存' : '保存失败'))
      if (feedback.ok) signatureRef.current = JSON.stringify(next)
    } finally {
      setBusy(false)
    }
  }

  function patch(key: NumberKey | 'captainProvider' | 'captainModel', value: string): void {
    setDraft((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => {
      const target = key === 'captainProvider' || key === 'captainModel' ? 'captainModel' : key
      if (previous[target] === undefined) return previous
      return { ...previous, [target]: '' }
    })
  }

  async function roleAction(action: unknown, done: string): Promise<void> {
    setBusy(true)
    try {
      const feedback = await actFeedback(act, action)
      setHint(hintOf(feedback) ?? (feedback.ok ? done : '动作未生效'))
      if (feedback.ok) await state.refresh()
    } finally {
      setBusy(false)
    }
  }

  // R2（QA-R7-03）：设置是天花板，不是命令。填了比宿主更大的值时必须当场说清
  // 「实际生效多少」，否则用户只会看到并发数跟自己填的不一样而不知道为什么。
  const concurrency = state.snapshot?.concurrency
  const clampNote =
    concurrency && concurrency.clamped
      ? `受更小的上限约束，实际生效 ${String(concurrency.limit)}（设置 ${String(concurrency.requested)}）`
      : undefined

  const rows = settingsKeysView(settings)

  return (
    <section data-auto-team-settings data-busy={busy ? 'true' : 'false'}>
      <header data-settings-head>
        <h3 data-settings-title>自动团队</h3>
        <p data-settings-intro>
          这些参数对整个 profile 生效；保存后立即应用（无需重启宿主）。
        </p>
      </header>

      <div data-settings-grid>
        {rows.map((row) => {
          const key = row.key
          const fieldId = `dsh-auto-team-setting-${key}`
          const hintId = `${fieldId}-hint`
          if (key === 'captainModel') {
            return (
              <div key={key} data-setting-row data-setting-key={key} data-error-state={errors.captainModel ? 'true' : 'false'}>
                <span data-setting-label>队长默认模型</span>
                <span data-setting-inputs>
                  <input
                    id={fieldId}
                    data-setting-input="captainModel.provider"
                    placeholder="provider（留空 = 会话默认）"
                    value={draft.captainProvider}
                    disabled={busy}
                    aria-describedby={hintId}
                    onChange={(event) => patch('captainProvider', event.target.value)}
                  />
                  <input
                    data-setting-input="captainModel.model"
                    placeholder="model"
                    value={draft.captainModel}
                    disabled={busy}
                    aria-describedby={hintId}
                    onChange={(event) => patch('captainModel', event.target.value)}
                  />
                </span>
                <span data-setting-hint id={hintId}>
                  {errors.captainModel ?? row.hint}
                </span>
              </div>
            )
          }
          const numberKey = key as NumberKey
          return (
            <div key={key} data-setting-row data-setting-key={key} data-error-state={errors[numberKey] ? 'true' : 'false'}>
              <label data-setting-label htmlFor={fieldId}>
                {row.label}
              </label>
              <span data-setting-inputs>
                <input
                  id={fieldId}
                  data-setting-input={key}
                  inputMode="numeric"
                  value={draft[numberKey]}
                  disabled={busy}
                  aria-describedby={hintId}
                  onChange={(event) => patch(numberKey, event.target.value)}
                />
              </span>
              <span data-setting-hint id={hintId} data-setting-clamped={numberKey === 'concurrencyLimit' && clampNote ? 'true' : 'false'}>
                {errors[numberKey] ?? (numberKey === 'concurrencyLimit' ? clampNote : undefined) ?? row.hint}
              </span>
            </div>
          )
        })}
      </div>

      <div data-settings-actions>
        <button type="button" data-settings-save disabled={busy} onClick={() => void save()}>
          {busy ? '保存中…' : '保存设置'}
        </button>
        <button
          type="button"
          data-settings-reload
          disabled={busy}
          onClick={() => {
            setDraft(draftOf(settings))
            setErrors({})
            setHint('已还原为当前生效的设置')
          }}
        >
          还原
        </button>
        {hint === undefined ? null : (
          <span data-hint role="status">
            {hint}
          </span>
        )}
      </div>

      <hr data-settings-divider />

      <header data-settings-roles-head>
        <h4 data-settings-roles-title>团队角色</h4>
        <p data-settings-roles-intro>
          角色的描述、提示词、技能与默认模型都可改；自建角色可删，内置角色可一键恢复出厂定义。
        </p>
      </header>

      <RoleEditorList
        roles={roles}
        skills={skills}
        density="page"
        busy={busy}
        modelCatalog={state.snapshot?.modelCatalog}
        systemSkills={state.snapshot?.systemSkills}
        systemSkillsReason={state.snapshot?.systemSkillsReason}
        readSkill={(id: string): Promise<Result<SkillBodyPayload>> => panelApi.readSkill(sessionId ?? '', id)}
        onSave={(role?: Role, mutations?: SkillMutation[]) =>
          void roleAction(
            mutations === undefined ? { type: 'saveRole', role } : { type: 'saveRole', role, skills: mutations },
            role === undefined ? '已保存技能变更' : `已保存角色「${role.name}」`,
          )
        }
        onDelete={(id) => void roleAction({ type: 'deleteRole', roleId: id }, `已删除角色 ${id}`)}
        onRestoreDefaults={() =>
          void roleAction({ type: 'restoreDefaultRoles' }, '已把内置角色与内置技能恢复为出厂定义')
        }
      />
    </section>
  )
}

export default SettingsSection
