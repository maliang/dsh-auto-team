/**
 * run 头（r13 AC-5 / AC-8 / AC-20）：两行 64px + 可选降级行。
 *
 * 上行：runId（等宽）+ 计划状态 + 暂停开关 + 弹性空隙 + 「成员合计 N」；
 * 下行：起止时钟 + 用时 + 弹性空隙 + 派发在途状态。
 *
 * 为什么在 320px 面板里坚持两行：三行会超过 64px 的头部预算，把任务表挤到首屏之外；
 * 一行塞不下（runId 与时间都是不可压缩的），只能截断数字 —— 截断数字等于造假。
 *
 * 文本全部来自 `runHeadOf`（viewmodel）：组件里不出现第二份状态→文案映射，
 * 也不拼「分 / 小时」（AC-7 的 grep 断言盯的正是这个）。
 */
import * as React from 'react'
import type { RunDetailView } from '../../shared/types.ts'
import type { InflightState } from '../viewmodel.ts'
import { runHeadOf } from '../viewmodel.ts'

export interface RunHeaderProps {
  detail: RunDetailView
  paused?: boolean
  inflight: InflightState
  onTogglePause?: () => void
}

export function RunHeader(props: RunHeaderProps): React.ReactElement {
  const { detail, paused, inflight, onTogglePause } = props
  const head = runHeadOf(detail, inflight)
  return (
    <header data-region="run-head" data-paused={paused === true ? 'true' : 'false'}>
      <div data-run-line="identity">
        <code data-run-id title={head.plannedAtText}>
          {head.runId}
        </code>
        <span data-plan-status data-tone={head.planStatusTone}>
          {head.planStatusLabel}
        </span>
        {onTogglePause ? (
          <button
            type="button"
            data-auto-team-pause
            data-paused={paused === true ? 'true' : 'false'}
            aria-pressed={paused === true}
            onClick={onTogglePause}
          >
            {paused === true ? '继续' : '暂停'}
          </button>
        ) : null}
        <span data-run-spacer aria-hidden="true" />
        <span data-run-usage data-usage-source={head.usageSource} title={head.usageTitle}>
          成员合计 <b data-run-usage-value>{head.usageText}</b>
        </span>
      </div>
      <div data-run-line="timing">
        <span data-run-window>{head.windowText}</span>
        <span
          data-run-duration
          data-duration-state={head.durationState}
          title={head.durationState === 'unavailable' ? '没有开始时间，算不出 run 用时' : 'run 用时'}
        >
          {head.durationText}
        </span>
        <span data-run-spacer aria-hidden="true" />
        <span
          data-inflight-dispatch={head.inflightState}
          title={head.inflightState === 'idle' ? '计划落盘后自动派发就绪任务' : '正在把就绪任务派给成员'}
        >
          {head.inflightState === 'idle' ? null : <span data-inflight-dot aria-hidden="true" />}
          {head.inflightText}
        </span>
      </div>
      {head.downgrade ? (
        <p data-run-downgrade title={head.usageTitle}>
          {head.downgrade}
        </p>
      ) : null}
    </header>
  )
}

export default RunHeader
