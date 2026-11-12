/**
 * r18b t8：任务页顶部的 **run 横向滑动卡**（每个进行中的 run 一张卡）。
 *
 * 用户口径（2026-11-05）：「每条 run 做成一个卡，多个同时进行的任务通过点卡切换查看详情」，
 * 并选定「横向滑动卡，六项在卡内两行」。
 *
 * 结构与语义：
 *  - 外层仍是 `<section data-region="run-switcher" data-active-runs data-fallback>`；
 *  - 里面一层 `span[data-active-run-cards]`（display:flex + overflow-x:auto）负责横滑。
 *    这里刻意用 `span` 而不是 `div`：整块只装 phrasing content，容器本身也是 phrasing；
 *  - 每张卡是一个 `<button data-active-run>`（整卡可点，点哪张就切哪个 run），
 *    卡内只有 `span` / `b`（button 的内容模型限制），三行靠 CSS grid 放置；
 *    r18b t9（用户：「任务卡高度可以再小一些，以任务名称显示为主」）把三行压成
 *    「①标题 + 状态徽标（同一 header span，标题占满剩余宽度）②meta ③六项」；
 *    r18b t10 真机实测发现 t9 的「label + value 同行」在 63px 列宽里全被省略号截断
 *    （「输入未命中 246.…」「缓存命中率 7」），用户要求「其他辅助信息要显示全」，
 *    于是六项回到**同一格内上下两行**（label 上 / value 下），靠行高与间距把卡高
 *    控制在 96–108px；结构、文案与所有钩子与 t9 完全一致，只改 CSS 排布；
 *  - 标题/状态徽标/meta/token 六项全部来自 `RunRowView`（与历史列表同一套投影），
 *    组件不格式化数字、不拼时间。
 *
 * 旧钩子（`data-run-cards` / `data-run-card` / `data-run-back`）保持为零：
 * 选中语义只靠 `data-selected` / `aria-pressed`，「当前 run」只靠 `data-current`。
 *
 * r24：残留计划（`row.residualBadge` 存在）的卡下方注入「终止计划」入口。入口由调用方
 * 通过 `residualAction` 渲染（本组件不 import 弹窗/动作层）：卡本身是 `button`，终止按钮
 * 不能嵌套，只能作为兄弟节点，所以这类卡外面多一层 `span[data-active-run-item]`。
 * 非残留卡（以及调用方没接入口时）输出与 r18 完全一致，不新增任何包装节点。
 */
import * as React from 'react'
import type { ActiveRunsView, ActiveRunRow } from '../nav.ts'

export interface RunSwitcherProps {
  /** 要渲染的 run 行（已过滤：进行中的 run；没有时只有一条兜底行）。 */
  view: ActiveRunsView
  /** 点了某张卡：把该 runId 交给调用方（当前 run 也照常回调，由调用方决定是否关历史详情）。 */
  onSelect: (runId: string) => void
  /** 历史详情读取中：整排卡禁用，避免连点打乱请求顺序。 */
  busy?: boolean
  /**
   * r24：给残留计划卡渲染「终止计划」入口（调用方注入，通常是 `RunCloseAction`）。
   *
   * 用注入而不是直接 import：切换器只做展示，弹窗/动作属于任务页；同时让既有
   * `test/r18-run-cards.test.ts` 的就地编译不依赖新的运行时模块。
   */
  residualAction?: (row: ActiveRunRow) => React.ReactNode
}

export function RunSwitcher(props: RunSwitcherProps): React.ReactElement {
  const { view, onSelect, busy = false, residualAction } = props
  // disabled 已经挡住指针/键盘；这里再守一道，避免程序化 click（含测试）绕过禁用态。
  const pick = (runId: string): void => {
    if (busy) return
    onSelect(runId)
  }
  return (
    <section
      data-region="run-switcher"
      data-active-runs={view.rows.length}
      data-fallback={view.fallback ? 'true' : 'false'}
      aria-label="进行中的 run"
    >
      {/* 横滑容器：`span` + display:flex，卡多时横向滚动（scroll-snap 吸附到卡左缘）。 */}
      <span data-active-run-cards>
        {view.rows.map((row) => {
          const card = cardOf(row, busy, pick)
          const extra = row.residualBadge === undefined ? null : residualAction?.(row)
          // 普通 run（或调用方没接入口）保持原样：卡就是横滑容器的直接子元素。
          if (extra === null || extra === undefined || extra === false) return card
          // r24：未收口 run 的「终止计划」按钮只能是卡的兄弟节点（不能嵌套 button）。
          return (
            <span key={row.runId} data-active-run-item data-residual="true">
              {card}
              {extra}
            </span>
          )
        })}
      </span>
    </section>
  )
}

/**
 * 单张 run 卡（横滑容器的直接子元素）。
 *
 * 声明放在组件之后：`test/r18-styles.test.ts` 用源码顺序断言「横滑容器先于卡」，
 * 把卡挪进前面的辅助函数会让 `data-active-run-cards` 出现在 `<button` 之后而假红。
 */
function cardOf(
  row: ActiveRunRow,
  busy: boolean,
  pick: (runId: string) => void,
): React.ReactElement {
  return (
    <button
      key={row.runId}
      type="button"
      data-active-run
      data-run-id={row.runId}
      data-current={row.current ? 'true' : 'false'}
      data-selected={row.selected ? 'true' : 'false'}
      data-ongoing={row.hasOngoing ? 'true' : 'false'}
      aria-pressed={row.selected}
      title={row.titleTitle ?? row.title}
      disabled={busy}
      onClick={() => pick(row.runId)}
    >
      {/* ① 标题行：标题（占满剩余宽度、单行省略）与状态徽标（右对齐）同一行，
          外层 header span 负责两者的水平排布；标题仍是视觉第一层。 */}
      <span data-active-run-head>
        <span data-active-run-title data-title-source={row.titleSource}>
          {row.title}
        </span>
        <span
          data-active-run-status
          data-tone={row.statusTone}
          title={
            row.statusTitle === undefined
              ? `状态：${row.statusText}`
              : `状态：${row.statusText} · ${row.statusTitle}`
          }
        >
          <span aria-hidden="true">{row.statusIcon}</span> {row.statusText}
        </span>
      </span>
      {/* ② meta 行：卡内贴**紧凑全文**（`cardMetaText`：`13:35:00 起 · 进行中 · 任务 0/1`），
          完整的历史文案（`开始 … · 结束 … · 任务 d/t`）仍放 `title`，悬停可看原始全文。
          t11：历史长文案在 196px 内容宽里会被省略号截断，任务数直接看不到。 */}
      <span data-active-run-meta title={row.metaText}>{row.cardMetaText}</span>
      {row.usageMetrics.length > 0 ? (
        // ③ token 六项：3 列 × 2 行，每格 label 在上、value 在下（t10：不省略、不截断）。
        //    标签与数值都来自宿主下发的 `UsageMetric`（顺序即数组顺序），
        //    `data-available="false"` 区分「宿主没上报」与真 0。
        <span data-active-run-usage>
          {row.usageMetrics.map((metric) => (
            <span
              key={metric.key}
              data-active-run-metric={metric.key}
              data-available={metric.available ? 'true' : 'false'}
              title={`${metric.label}：${metric.text}`}
            >
              <span data-active-run-metric-label>{metric.label}</span>{' '}
              <b data-active-run-metric-value>{metric.text}</b>
            </span>
          ))}
        </span>
      ) : null}
    </button>
  )
}

export default RunSwitcher
