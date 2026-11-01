/**
 * 角色模型弹层选择器（r10 AC-16，DESIGN §2.4 M4）。
 *
 * 为什么不再用两个裸输入框：r7 的 `provider` / `model` 文本框要求用户手打「宿主侧的服务名 +
 * 模型 id」，绝大多数人打不出、打错也不报错（直到派发时才炸）；而裸输入框还让卡片多出两行
 * 高度（AC-16 判据：角色卡里裸 provider / model 输入框必须 0 处，手填入口挪进气泡并改钩子）。
 *
 * 本组件的四条硬规则：
 *  1. **按钮 + 气泡**：按钮上只显示当前值（`provider/model`，空则「跟随会话默认」），
 *     点开才是搜索 + 列表；选中即回填并关闭。
 *  2. **手填兜底仍在，但换 hook 并折叠**：`data-model-manual-provider` / `data-model-manual-model`
 *     —— 宿主模型清单取不到时（`status === 'empty'`）用户仍有出路，同时不污染 AC-16 的计数。
 *  3. **空清单要说人话**：`[data-model-empty]` 两行（原因 + 出路），绝不静默空列表。
 *  4. **非乐观**：选中只上抛 `onChange`（父组件改草稿），值由 props 回流；本组件不存第二份值。
 *
 * 气泡用 `position: fixed` + 按按钮矩形算出坐标（top/left 走内联样式）：角色卡在右栏/设置页
 * 都有滚动容器，`position: absolute` 的气泡会被 `overflow:hidden` 裁掉；fixed 脱离该裁剪
 * 上下文，滚动/缩放时重算坐标即可。**不用 createPortal**：本仓没有 react-dom（node_modules 里
 * 只有 react，peerDependencies 也只声明 react，tsdown external 只列 'react'），import 它
 * 直接 TS2307；改成固定定位覆盖层后行为等价、且不引新依赖。
 */
import * as React from 'react'
import type { ModelCatalogView, ModelOption, RoleModelRoute } from '../shared/types.ts'
import { modelPickerLabel } from './ui.ts'

export interface ModelPickerProps {
  /** 当前值（undefined = 跟随会话默认）。 */
  value?: RoleModelRoute
  /** 宿主模型清单（快照字段，可能缺失 = 宿主没这个能力）。 */
  catalog?: ModelCatalogView
  /** 写盘在飞：按钮 disabled，避免连点产生两条互相覆盖的保存。 */
  busy: boolean
  /** 角色卡被禁用（例如整卡正在保存）时一起禁用。 */
  disabled?: boolean
  /** 回填；`undefined` = 清空回「跟随会话默认」。 */
  onChange: (model: RoleModelRoute | undefined) => void
}

/** 一行候选项的搜索键（provider 名、模型名都参与匹配，用户记哪个都能搜到）。 */
function matches(option: ModelOption, keyword: string): boolean {
  if (keyword === '') return true
  const haystack = `${option.provider} ${option.providerName} ${option.model} ${option.modelName}`.toLowerCase()
  return haystack.includes(keyword.toLowerCase())
}

/** 「当前选中」比较：provider + model 相同即算选中（effort 不属于清单维度）。 */
function isSelected(option: ModelOption, value?: RoleModelRoute): boolean {
  if (value === undefined) return false
  return option.provider === value.provider && option.model === value.model
}

export function ModelPicker(props: ModelPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [keyword, setKeyword] = React.useState('')
  const [manualOpen, setManualOpen] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  const popoverRef = React.useRef<HTMLDivElement | null>(null)
  // 气泡坐标：fixed 定位需要视口坐标，打开时与滚动/缩放时各算一次（DESIGN §2.4 宽 296）。
  const [anchor, setAnchor] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const options = props.catalog?.options ?? []
  const visible = options.filter((option) => matches(option, keyword))
  const label = modelPickerLabel(props.value)

  // 关闭时把键盘焦点还给按钮（弹层类组件的统一规矩，DESIGN §2.5）。
  const close = React.useCallback(() => {
    setOpen(false)
    setManualOpen(false)
    setKeyword('')
    const button = buttonRef.current
    if (button !== null && typeof button.focus === 'function') button.focus()
  }, [])

  // Esc 关闭 + 点击外部关闭。两个都要有：只有 Esc 时鼠标用户关不掉，只有外点时键盘用户被困。
  React.useEffect(() => {
    if (!open) return undefined
    const place = (): void => {
      const button = buttonRef.current
      if (button === null || typeof button.getBoundingClientRect !== 'function') return
      const rect = button.getBoundingClientRect()
      const width = 296
      const margin = 8
      const viewport = typeof window === 'undefined' ? width + margin * 2 : window.innerWidth
      // 贴按钮下沿展开，左右夹在视口内（窄宽下不许溢出到屏幕外，AC-14）
      const left = Math.max(margin, Math.min(rect.left, viewport - width - margin))
      setAnchor({ top: rect.bottom + 4, left })
    }
    place()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (popoverRef.current?.contains(target) === true) return
      if (buttonRef.current?.contains(target) === true) return
      close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, close])

  function pick(option: ModelOption): void {
    props.onChange({ provider: option.provider, model: option.model })
    close()
  }

  function patchManual(field: 'provider' | 'model', raw: string): void {
    const provider = field === 'provider' ? raw : (props.value?.provider ?? '')
    const model = field === 'model' ? raw : (props.value?.model ?? '')
    if (provider.trim() === '' && model.trim() === '') {
      props.onChange(undefined)
      return
    }
    const next: RoleModelRoute = { provider, model }
    if (props.value?.reasoningEffort !== undefined) next.reasoningEffort = props.value.reasoningEffort
    props.onChange(next)
  }

  const popover = open ? (
    <div
      ref={popoverRef}
      data-role-model-popover
      role="dialog"
      aria-label="选择角色模型"
      data-catalog-status={props.catalog?.status ?? 'loading'}
      style={{ top: anchor.top, left: anchor.left }}
    >
      <div data-model-search-row>
        <input
          data-model-search
          type="search"
          value={keyword}
          placeholder="搜索服务或模型"
          aria-label="搜索服务或模型"
          onChange={(event) => setKeyword(event.currentTarget.value)}
        />
      </div>

      {props.catalog === undefined || props.catalog.status === 'loading' ? (
        <div data-model-loading>正在读取宿主模型清单…</div>
      ) : props.catalog.status === 'empty' || options.length === 0 ? (
        <div data-model-empty>
          <p data-model-empty-reason>
            宿主没有提供模型清单{(props.catalog?.reason ?? '').trim() === '' ? '' : `：${props.catalog.reason}`}
          </p>
          <p data-model-empty-hint>仍可在下面的「手动填写」里直接输入服务名与模型 id。</p>
        </div>
      ) : visible.length === 0 ? (
        <div data-model-empty data-model-no-match>
          没有匹配「{keyword}」的模型，换个关键词或手动填写。
        </div>
      ) : (
        <div data-model-list role="listbox" aria-label="可选模型">
          {visible.map((option) => {
            const selected = isSelected(option, props.value)
            return (
              <button
                key={`${option.provider}/${option.model}`}
                type="button"
                role="option"
                data-model-option
                data-provider={option.provider}
                data-model={option.model}
                aria-selected={selected}
                onClick={() => pick(option)}
              >
                <span data-model-option-name>{option.modelName || option.model}</span>
                <span data-model-option-provider>{option.providerName || option.provider}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 手填兜底：默认折叠，钩子是 `data-model-manual-*`（不是 `data-role-model-*`）。 */}
      <div data-role-model-manual data-open={manualOpen ? 'true' : 'false'}>
        <button type="button" data-model-manual-toggle onClick={() => setManualOpen((previous) => !previous)}>
          {manualOpen ? '收起手动填写' : '手动填写'}
        </button>
        {manualOpen ? (
          <div data-model-manual-fields>
            <label data-model-manual-field>
              <span>服务名</span>
              <input
                data-model-manual-provider
                aria-label="服务名"
                value={props.value?.provider ?? ''}
                placeholder="例如 dsh-primary"
                onChange={(event) => patchManual('provider', event.currentTarget.value)}
              />
            </label>
            <label data-model-manual-field>
              <span>模型 id</span>
              <input
                data-model-manual-model
                aria-label="模型 id"
                value={props.value?.model ?? ''}
                placeholder="例如 deepseek-v4.1-flash"
                onChange={(event) => patchManual('model', event.currentTarget.value)}
              />
            </label>
          </div>
        ) : null}
      </div>

      <div data-model-popover-foot>
        <button type="button" data-model-clear onClick={() => {
          props.onChange(undefined)
          close()
        }}>
          清空（跟随会话默认）
        </button>
        <button type="button" data-model-close onClick={close}>
          关闭
        </button>
      </div>
    </div>
  ) : null

  return (
    <div data-role-model-picker data-open={open ? 'true' : 'false'}>
      <button
        ref={buttonRef}
        type="button"
        data-role-model-picker-button
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={props.busy || props.disabled === true}
        title={label}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span data-model-value>{label}</span>
        <span data-model-caret aria-hidden="true">
          ▾
        </span>
      </button>
      {/* 固定定位气泡：fixed + 视口坐标（见文件头注释，本仓无 react-dom 故不做 portal）。 */}
      {popover}
    </div>
  )
}

export default ModelPicker
