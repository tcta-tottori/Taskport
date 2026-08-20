import type { ReactNode } from 'react'
import { RunControl } from './RunControl'
import { catStyle } from './CategoryChip'
import { planSpan } from '../lib/plans'
import { runOf, type RunBox } from '../lib/runs'
import { colorOf, primaryCategory } from '../lib/workCategories'
import type { PlanOccurrence, Settings } from '../types'

/* =========================================================
 * 予定の1行
 *
 * スケジュール・実行・カレンダーで同じ形に見えるよう、ここに1つだけ置く。
 * 予定はタスクではないので、完了の丸は付けない（時間だけが埋まる）。
 * =======================================================*/

export function PlanRow({
  occ,
  settings,
  runBox,
  onEdit,
  now = false,
  extra,
}: {
  occ: PlanOccurrence
  settings: Settings
  runBox: RunBox
  onEdit: () => void
  /** いまその時間か（実行の画面で今の予定を立てるのに使う） */
  now?: boolean
  /** 行の下に足すもの（自動／手動の切り替えなど） */
  extra?: ReactNode
}) {
  const plan = occ.plan
  const run = runOf(runBox.runs, occ.key)
  const color = colorOf(settings.categoryGroups, primaryCategory(plan.categories))
  return (
    <li className={`tp-dayrow${now ? ' is-now' : ''}${extra ? ' tp-dayrow-stack' : ''}`}>
      <button type="button" className="tp-mini tp-mini-plan" style={catStyle(color)} onClick={onEdit}>
        <span>
          {plan.title}
          {plan.place && <small className="tp-plan-place">／ {plan.place}</small>}
        </span>
        <span className="tp-mono">
          {planSpan(plan)}
          {plan.autoTrack && !plan.allDay ? ' ・自動' : ''}
        </span>
      </button>
      {!plan.allDay && (
        <RunControl
          run={run}
          nowMs={runBox.nowMs}
          title={plan.title}
          showTime={!!run}
          onStart={() => runBox.startPlan(occ)}
          onPause={() => run && runBox.pause(run)}
          onResume={() => run && runBox.resume(run)}
          onFinish={() => run && runBox.finish(run)}
        />
      )}
      {extra}
    </li>
  )
}
