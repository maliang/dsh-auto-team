/**
 * 空态（r13 DESIGN §2.7）：**三段式** —— 标题 / 一句说明 / 下一步。
 *
 * 为什么不是一句「暂无数据」：空态是用户唯一能知道「接下来该做什么」的地方，
 * 只说「没有」等于把人留在原地。三段文案全部由调用方给（页签自己知道下一步），
 * 组件不做任何状态判断，右栏与左栏因此可以共用同一个空态。
 *
 * 与「降级说明」的区别（DESIGN §2.2）：空态 = **没有数据**；降级 = 有数据但拿不到某个量
 * （如 token 无来源）。两者混用会让人以为计划根本没跑，所以降级用 `[data-run-downgrade]`
 * 画在 run 头里，不经过本组件。
 */
import * as React from 'react'

export interface EmptyStateProps {
  title: string
  hint?: string
  /** 下一步（可选）：一句话告诉用户「去说什么 / 去点哪里」。 */
  next?: string
}

export function EmptyState(props: EmptyStateProps): React.ReactElement {
  return (
    <div data-empty role="status">
      <p data-empty-title>{props.title}</p>
      {props.hint ? <p data-empty-hint>{props.hint}</p> : null}
      {props.next ? <p data-empty-next>{props.next}</p> : null}
    </div>
  )
}

export default EmptyState
