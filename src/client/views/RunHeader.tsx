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
import type { InflightState, PlanGoalView, RunStageView } from '../viewmodel.ts'
import { runHeadOf } from '../viewmodel.ts'

export interface RunHeaderProps {
  detail: RunDetailView
  paused?: boolean
  inflight: InflightState
  onTogglePause?: () => void
  /**
   * r21：当前 run 的「目标 + 追加需求」视图（`planGoalOf` 的结果）。
   * 历史 run 没有修订史 → 上游传 `null`，本组件整块不渲染。
   */
  plan?: PlanGoalView | null
  /**
   * r26：阶段判定结果（`stageOfDetail`）。传入后计划状态徽标与 run 卡 / 历史行同源；
   * 不传则退回原始计划状态（兼容直接调用 `runHeadOf` 的既有测试）。
   */
  stage?: RunStageView
}

export function RunHeader(props: RunHeaderProps): React.ReactElement {
  const { detail, paused, inflight, onTogglePause, plan, stage } = props
  const head = runHeadOf(detail, inflight, stage)
  return (
    <header data-region="run-head" data-paused={paused === true ? 'true' : 'false'}>
      <div data-run-line="identity">
        <code data-run-id title={head.plannedAtText}>
          {head.runId}
        </code>
        <span data-plan-status data-tone={head.planStatusTone} title={head.planStatusDetail}>
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
      {head.terminationReason ? (
        <p data-run-termination title={head.terminationReason}>
          终止原因：{head.terminationReason}
        </p>
      ) : null}
      {plan !== null && plan !== undefined ? (
        <section data-run-plan aria-label="本次运行的目标与需求修订">
          <div data-plan-block-head>
            {plan.revisionCountText ? (
              <span data-run-revisions>{plan.revisionCountText}</span>
            ) : null}
            {plan.mergedText ? (
              <span data-run-merged title={`本次运行已并入 ${head.runId}（复用同一个 runId）`}>
                {plan.mergedText}
              </span>
            ) : null}
          </div>
          {plan.sections.length > 0 ? (
            <div data-run-goal-sections>
              {plan.sections.map((section) => (
                <div
                  key={section.key}
                  data-goal-section={section.revision ? 'revision' : 'original'}
                >
                  <span data-goal-heading>
                    {section.revision ? <span data-goal-tag>追加需求</span> : null}
                    {section.heading}
                  </span>
                  <p data-goal-body>{section.body}</p>
                </div>
              ))}
            </div>
          ) : null}
          {plan.latestRevisionText ? (
            <p data-run-latest-revision title={plan.latestRevisionText}>
              {plan.latestRevisionText}
            </p>
          ) : null}
        </section>
      ) : null}
    </header>
  )
}

export default RunHeader
