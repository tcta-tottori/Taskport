import { useMemo, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { Reveal } from '../components/Reveal'
import { RunControl } from '../components/RunControl'
import { catStyle } from '../components/CategoryChip'
import {
  addMonths,
  durationLabel,
  formatMD,
  inMonth,
  monthGrid,
  monthKey,
  monthLabel,
} from '../lib/date'
import { groupByDue, sortTasks } from '../lib/tasks'
import { bookedMinutes, groupOccurrences, occurrencesInRange, planSpan } from '../lib/plans'
import { runOf, type RunBox } from '../lib/runs'
import { isRunning, runningMin } from '../lib/worklog'
import { colorOf, primaryCategory } from '../lib/workCategories'
import { dayLoad, isWorkDay, taskMinutes } from '../lib/workday'
import { PRIORITY_LABEL, type Plan, type PlanOccurrence, type Settings, type Task } from '../types'

/* =========================================================
 * カレンダー（月表示）
 *
 * 1か月を一面で見て、「どこに山があるか」「どこが空いているか」を掴む。
 * 升目には**予定とタスクを並べて出す**。別々に見ると、会議で潰れている日に
 * タスクを積んでしまう（実際に起きていた）。
 *
 * 升目の中身は幅で出し分ける。
 *   狭い端末 … 色の点だけ（何件あるか・どの重さかが分かればよい）
 *   広い画面 … 件名の入った小さな帯
 * どちらも押すと下に「その日」が開く。日をまたいで探し回らずに済む。
 *
 * 予定は台帳に混ざらない（design.md §10.1）。ここでも別の見た目にしてある。
 * =======================================================*/

/** 升目に出す帯の数。これを超えたぶんは「+n」でまとめる。 */
const CHIP_MAX = 3
/** 点の数の上限。並べすぎると升目が潰れる。 */
const DOT_MAX = 4

export function CalendarView({
  tasks,
  plans,
  today,
  settings,
  runBox,
  onEditTask,
  onToggleTask,
  onEditPlan,
  onAddPlan,
  onAddTask,
}: {
  tasks: Task[]
  plans: Plan[]
  today: string
  settings: Settings
  runBox: RunBox
  onEditTask: (task: Task) => void
  onToggleTask: (task: Task) => void
  onEditPlan: (plan: Plan) => void
  /** その日に予定を入れる */
  onAddPlan: (day: string) => void
  /** その日を期限にしてタスクを作る */
  onAddTask: (day: string) => void
}) {
  const [month, setMonth] = useState(() => monthKey(today))
  const [day, setDay] = useState(today)

  const rule = { workHours: settings.workHours, workCalendar: settings.workCalendar }
  const grid = useMemo(() => monthGrid(month), [month])
  const from = grid[0]
  const to = grid[grid.length - 1]

  const occurrences = useMemo(
    () => occurrencesInRange(plans, from, to, rule),
    // rule は settings から作り直されるので、中身で見張る
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans, from, to, settings.workHours, settings.workCalendar],
  )
  const planMap = useMemo(() => groupOccurrences(occurrences), [occurrences])
  const taskMap = useMemo(() => groupByDue(tasks), [tasks])

  const monthTasks = useMemo(
    () => tasks.filter((t) => !!t.due && inMonth(t.due, month)),
    [tasks, month],
  )
  const monthPlans = occurrences.filter((o) => inMonth(o.day, month))

  const dayPlans = planMap.get(day) ?? []
  const dayTasks = sortTasks((taskMap.get(day) ?? []).slice())
  const openTasks = dayTasks.filter((t) => t.status === 'open')
  const load = dayLoad(openTasks, settings.workHours, settings.defaultEstimateMin, day, settings.workCalendar)
  const booked = bookedMinutes(dayPlans)
  const working = isWorkDay(day, settings.workHours, settings.workCalendar)

  return (
    <div className="tp-view">
      <Reveal>
        <section className="tp-panel">
          <div className="tp-mon-head">
            <button
              type="button"
              className="tp-mon-nav"
              aria-label="前の月"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <Icon name="chevron" size={18} className="tp-flip" />
            </button>
            <h2 className="tp-mon-title tp-mono">{monthLabel(month)}</h2>
            <button
              type="button"
              className="tp-mon-nav"
              aria-label="次の月"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <Icon name="chevron" size={18} />
            </button>
            <button
              type="button"
              className="tp-mon-today"
              onClick={() => {
                setMonth(monthKey(today))
                setDay(today)
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
                  aria-label={`${formatMD(d)}${off ? '（休み）' : ''} 予定${ps.length}件 タスク${ts.length}件`}
                  className={`tp-mon-cell${d === day ? ' is-on' : ''}${d === today ? ' is-today' : ''}${
                    off ? ' is-off' : ''
                  }${outside ? ' is-outside' : ''}`}
                  onClick={() => setDay(d)}
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
                          style={catStyle(
                            colorOf(settings.categoryGroups, primaryCategory(c.occ.plan.categories)),
                          )}
                        >
                          <b className="tp-mono">
                            {c.occ.plan.allDay ? '終日' : (c.occ.plan.startTime ?? '')}
                          </b>
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

          <p className="tp-hint">
            日を押すと、その日の予定とタスクが下に出ます。棒はタスクの見込み時間が勤務時間のどれだけを埋めているか。
          </p>
        </section>
      </Reveal>

      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2>{formatMD(day)}</h2>
            <span className={`tp-badge${load.over > 0 ? ' is-over' : ''}`}>
              {durationLabel(load.planned + booked)} / {durationLabel(load.capacity)}
            </span>
          </div>

          {!working && (
            <p className="tp-note-off">
              <Icon name="sun" size={14} /> この日は会社カレンダーで休みです。
            </p>
          )}

          <p className="tp-note">
            予定 {dayPlans.length}件（{durationLabel(booked)}）／ タスク {openTasks.length}件（
            {durationLabel(load.planned)}）。
            {load.over > 0 && <b> 勤務時間を {durationLabel(load.over)} 超えています。</b>}
          </p>

          <h3 className="tp-sub-head">
            <Icon name="calendar" size={14} />
            予定
          </h3>
          {dayPlans.length === 0 ? (
            <p className="tp-empty-body">この日に予定はありません。打合せや来客は「予定を入れる」から。</p>
          ) : (
            <ul className="tp-daylist">
              {dayPlans.map((o) => (
                <PlanRow
                  key={o.key}
                  occ={o}
                  settings={settings}
                  runBox={runBox}
                  onEdit={() => onEditPlan(o.plan)}
                />
              ))}
            </ul>
          )}

          <h3 className="tp-sub-head">
            <Icon name="list" size={14} />
            タスク
          </h3>
          {dayTasks.length === 0 ? (
            <p className="tp-empty-body">この日を期限にしたタスクはありません。</p>
          ) : (
            <ul className="tp-daylist">
              {dayTasks.map((t) => {
                const live = isRunning(t)
                return (
                  <li key={t.id} className="tp-dayrow">
                    <button
                      type="button"
                      className="tp-check"
                      aria-pressed={t.status === 'done'}
                      aria-label={t.status === 'done' ? `${t.title} を未了に戻す` : `${t.title} を完了にする`}
                      onClick={() => onToggleTask(t)}
                    />
                    <button
                      type="button"
                      className={`tp-mini tp-pri-${t.priority}${t.status === 'done' ? ' is-done' : ''}`}
                      onClick={() => onEditTask(t)}
                    >
                      <span>{t.title}</span>
                      <span className={`tp-mono${live ? ' tp-live-meta' : ''}`}>
                        {live
                          ? `動いています（${durationLabel(runningMin(t))}）`
                          : `${t.dueTime ?? PRIORITY_LABEL[t.priority]} ／ ${durationLabel(
                              taskMinutes(t, settings.defaultEstimateMin),
                            )}`}
                      </span>
                    </button>
                    {/* タスクの実績は台帳が持つ（startedAt / actualMin）。
                        予定と違って区間は持たないので、押すのは始める／止めるの2つだけ。 */}
                    {t.status === 'open' && (
                      <button
                        type="button"
                        className={`tp-run tp-run-i${live ? ' is-on' : ''}`}
                        aria-pressed={live}
                        aria-label={live ? `${t.title} の手を止める` : `${t.title} を始める`}
                        title={live ? '止める' : '始める'}
                        onClick={() => runBox.toggleTask(t)}
                      >
                        <Icon name={live ? 'pause' : 'play'} size={16} />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <div className="tp-mon-acts">
            <button type="button" className="tp-btn-primary" onClick={() => onAddPlan(day)}>
              <Icon name="calendar" size={16} />
              予定を入れる
            </button>
            <button type="button" className="tp-btn-ghost" onClick={() => onAddTask(day)}>
              <Icon name="plus" size={16} />
              タスクを作る
            </button>
          </div>
        </section>
      </Reveal>
    </div>
  )
}

/** 予定1件の行。カレンダー・スケジュール・実行で同じ形にする。 */
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
