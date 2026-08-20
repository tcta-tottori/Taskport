import { useMemo } from 'react'
import { Icon } from './Icon'
import { catStyle } from './CategoryChip'
import { addMonths, inMonth, monthGrid, monthKey, monthLabel } from '../lib/date'
import { groupByDue, sortTasks } from '../lib/tasks'
import { groupOccurrences, occurrencesInRange } from '../lib/plans'
import { colorOf, primaryCategory } from '../lib/workCategories'
import { dayLoad, isWorkDay } from '../lib/workday'
import type { Plan, Settings, Task } from '../types'

/* =========================================================
 * 月の升目（カレンダー）
 *
 * 1か月を一面で見て、「どこに山があるか」「どこが空いているか」を掴む。
 * 升目には**予定とタスクを並べて出す**。別々に見ると、会議で潰れている日に
 * タスクを積んでしまう（実際に起きていた）。
 *
 * 升目の中身は幅で出し分ける。
 *   狭い端末 … 色の点だけ（何件あるか・どの重さかが分かればよい）
 *   広い画面 … 件名の入った小さな帯
 * どちらも押すと、その日がスケジュールの上の面に開く。
 *
 * v1.24.0 でカレンダーの画面をやめ、スケジュールの最後の面として置いた
 * （同じ日を2つの画面で開くと、どちらで直したか分からなくなる）。
 * =======================================================*/

/** 升目に出す帯の数。これを超えたぶんは「+n」でまとめる。 */
const CHIP_MAX = 3
/** 点の数の上限。並べすぎると升目が潰れる。 */
const DOT_MAX = 4

export function MonthGrid({
  month,
  onChangeMonth,
  day,
  today,
  tasks,
  plans,
  settings,
  onPickDay,
}: {
  /** "YYYY-MM" */
  month: string
  onChangeMonth: (month: string) => void
  /** 選んでいる日 */
  day: string
  today: string
  tasks: Task[]
  plans: Plan[]
  settings: Settings
  onPickDay: (day: string) => void
}) {
  const grid = useMemo(() => monthGrid(month), [month])
  const from = grid[0]
  const to = grid[grid.length - 1]

  const occurrences = useMemo(
    () =>
      occurrencesInRange(plans, from, to, {
        workHours: settings.workHours,
        workCalendar: settings.workCalendar,
      }),
    [plans, from, to, settings.workHours, settings.workCalendar],
  )
  const planMap = useMemo(() => groupOccurrences(occurrences), [occurrences])
  const taskMap = useMemo(() => groupByDue(tasks), [tasks])

  const monthTasks = useMemo(
    () => tasks.filter((t) => !!t.due && inMonth(t.due, month)),
    [tasks, month],
  )
  const monthPlans = occurrences.filter((o) => inMonth(o.day, month))

  return (
    <>
      <div className="tp-mon-head">
        <button
          type="button"
          className="tp-mon-nav"
          aria-label="前の月"
          onClick={() => onChangeMonth(addMonths(month, -1))}
        >
          <Icon name="chevron" size={18} className="tp-flip" />
        </button>
        <h3 className="tp-mon-title tp-mono">{monthLabel(month)}</h3>
        <button
          type="button"
          className="tp-mon-nav"
          aria-label="次の月"
          onClick={() => onChangeMonth(addMonths(month, 1))}
        >
          <Icon name="chevron" size={18} />
        </button>
        <button
          type="button"
          className="tp-mon-today"
          onClick={() => {
            onChangeMonth(monthKey(today))
            onPickDay(today)
          }}
        >
          今日
        </button>
      </div>

      <p className="tp-mon-sum tp-mono">
        予定 {monthPlans.length}件 ／ タスク {monthTasks.length}件（未完了{' '}
        {monthTasks.filter((t) => t.status === 'open').length}件）
      </p>

      {/* 升目は日ごとのボタンにしてある。読み上げには日付と件数を持たせ、
          見た目（点・帯）に頼らなくても中身が分かるようにする。 */}
      <div className="tp-mon-grid" aria-label={`${monthLabel(month)}のカレンダー`}>
        {['日', '月', '火', '水', '木', '金', '土'].map((w) => (
          <div key={w} className="tp-mon-wd" aria-hidden="true">
            {w}
          </div>
        ))}

        {grid.map((d) => {
          const ps = planMap.get(d) ?? []
          const ts = sortTasks((taskMap.get(d) ?? []).filter((t) => t.status === 'open'))
          const doneN = (taskMap.get(d) ?? []).filter((t) => t.status === 'done').length
          const off = !isWorkDay(d, settings.workHours, settings.workCalendar)
          const outside = !inMonth(d, month)
          const l = dayLoad(ts, settings.workHours, settings.defaultEstimateMin, d, settings.workCalendar)
          const total = ps.length + ts.length
          const chips = [
            ...ps.slice(0, CHIP_MAX).map((o) => ({ kind: 'plan' as const, occ: o })),
            ...ts.slice(0, Math.max(0, CHIP_MAX - ps.length)).map((t) => ({ kind: 'task' as const, task: t })),
          ]
          const rest = total - chips.length
          return (
            <button
              key={d}
              type="button"
              aria-pressed={d === day}
              aria-label={`${d}${off ? '（休み）' : ''} 予定${ps.length}件 タスク${ts.length}件`}
              className={`tp-mon-cell${d === day ? ' is-on' : ''}${d === today ? ' is-today' : ''}${
                off ? ' is-off' : ''
              }${outside ? ' is-outside' : ''}`}
              onClick={() => onPickDay(d)}
            >
              <span className="tp-mon-date tp-mono">{Number(d.slice(8))}</span>

              {/* 狭い端末はここだけ出る。件数と重さが色で分かればよい。 */}
              <span className="tp-mon-dots" aria-hidden="true">
                {ps.slice(0, DOT_MAX).map((o) => (
                  <i
                    key={o.key}
                    className="tp-mon-dot is-plan"
                    style={catStyle(colorOf(settings.categoryGroups, primaryCategory(o.plan.categories)))}
                  />
                ))}
                {ts.slice(0, Math.max(0, DOT_MAX - ps.length)).map((t) => (
                  <i key={t.id} className={`tp-mon-dot tp-pri-${t.priority}`} />
                ))}
                {total > DOT_MAX && <i className="tp-mon-more tp-mono">+{total - DOT_MAX}</i>}
              </span>

              {/* 広い画面は件名まで出す */}
              <span className="tp-mon-chips">
                {chips.map((c) =>
                  c.kind === 'plan' ? (
                    <span
                      key={c.occ.key}
                      className="tp-mon-chip is-plan"
                      style={catStyle(colorOf(settings.categoryGroups, primaryCategory(c.occ.plan.categories)))}
                    >
                      <b className="tp-mono">{c.occ.plan.allDay ? '終日' : (c.occ.plan.startTime ?? '')}</b>
                      {c.occ.plan.title}
                    </span>
                  ) : (
                    <span key={c.task.id} className={`tp-mon-chip tp-pri-${c.task.priority}`}>
                      {c.task.dueTime && <b className="tp-mono">{c.task.dueTime}</b>}
                      {c.task.title}
                    </span>
                  ),
                )}
                {rest > 0 && <span className="tp-mon-rest tp-mono">ほか{rest}件</span>}
                {doneN > 0 && chips.length === 0 && (
                  <span className="tp-mon-rest tp-mono">完了{doneN}件</span>
                )}
              </span>

              {l.planned > 0 && (
                <span className="tp-mon-bar" aria-hidden="true">
                  <span
                    className={l.over > 0 ? 'is-over' : ''}
                    style={{ width: `${Math.min(100, Math.round(l.ratio * 100))}%` }}
                  />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}
