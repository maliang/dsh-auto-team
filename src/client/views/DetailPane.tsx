/**
 * 详情容器（r13 DESIGN §3.3）：面包屑 + 返回 + 内容，**内联展开**而不是抽屉。
 *
 * 为什么内联：左栏是两栏布局，抽屉会盖住项目列表，用户失去「我在哪个项目里」的定位；
 * 内联展开保留左列与选中态，深度靠面包屑表达（全局 / 项目 / 记忆 / 运行）。
 * 返回按钮是唯一出口 —— 组件不自己改路由，`onBack` 由页面决定退到哪一层。
 */
import * as React from 'react'

export interface DetailPaneProps {
  /** 从外到内的位置路径（如 `['项目库', 'auto-team', 't1']`）；最后一段是当前位置。 */
  breadcrumb: string[]
  onBack: () => void
  children: React.ReactNode
}

export function DetailPane(props: DetailPaneProps): React.ReactElement {
  const { breadcrumb, onBack, children } = props
  const last = breadcrumb.length - 1
  return (
    <section data-region="detail-pane" aria-label="详情">
      <div data-detail-bar>
        <button type="button" data-detail-back onClick={onBack}>
          <span aria-hidden="true">←</span> 返回
        </button>
        <nav data-detail-crumbs aria-label="位置">
          {breadcrumb.map((part, index) => (
            <span
              key={`${index}:${part}`}
              data-crumb={index === last ? 'current' : 'up'}
              aria-current={index === last ? 'page' : undefined}
            >
              {index > 0 ? (
                <span data-crumb-sep aria-hidden="true">
                  /
                </span>
              ) : null}
              {part}
            </span>
          ))}
        </nav>
      </div>
      <div data-detail-body>{children}</div>
    </section>
  )
}

export default DetailPane
