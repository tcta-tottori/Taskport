import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Reveal } from '../components/Reveal'
import { DayTimeline } from '../components/DayTimeline'
import { MonthGrid } from '../components/MonthGrid'
import { PlanRow } from '../components/PlanRow'
import {
  addDaysKey,
  durationShort,
  formatMD,
  formatMDShort,
  monthKey,
  weekdayLabel,
} from '../lib/date'
import { groupByDue, sortTasks } from '../lib/tasks'
import { isWorkDay, taskMinutes } from '../lib/workday'
import { busySlots, firstFit, fitLabel, freeMinutes, freeSlots } from '../lib/timebox'
import { fetchEvents } from '../ports/in/fromCalendar'
import { isConnected } from '../lib/googleAuth'
import { groupOccurrences, occurrencesInRange } from '../lib/plans'
import { dayBand, type DaySegment } from '../lib/worklog'
import { groupOf } from '../lib/workCategories'
import { ActualSheet } from './ActualSheet'
import type { RunBox } from '../lib/runs'
import type {
  CalendarEvent,
  Plan,
  Settings,
  Task,
  WorkRun,
} from '../types'

/* =========================================================
 * スケジュールビュー
 *
 * 上から順に、
 *   1. DAY   … **縦軸の時間の並び**（`DayTimeline`。予定・タスク・**実績**）
 *              ＋ 時刻未定の仕事
 *   2. 期限超過 … 拾い残しを上に出す
 *   3. WEEK  … **予定のある日だけ**を並べる
 *   4. MONTH … 月の升目（v1.24.0 でカレンダーの画面から移した）
 *
 * v1.27.0（利用者の指示）
 *   - 面の名前は英語の1語（DAY / WEEK / MONTH）。日と週と月の区別だけが要るので短くする
 *   - DAY は左上に名前、右上に日付（v1.27.1）。面の中に「予定を入れる」釦は置かない（右下の ＋ から）
 *
 * v1.24.0 で、1日を2時間の枠（午前前半…）に畳む形をやめた（§10.1）。
 * 枠に畳むと「何時から何時まで空いているか」が読めず、
 * 枠の切れ目をまたぐ予定の置き場も決められなかった。
 * 縦軸に戻したぶん、**時刻を決めていない仕事は軸の下に一覧で置く**
 * （前のタイムラインで見えなくなっていたのはここ）。完了したものは出さない。
 * =======================================================*/

export function ScheduleView({
  tasks,
  plans,
  runs,
  today,
  settings,
  nowMin,
  runBox,
  onEdit,
  onEditPlan,
  onImportEvent,
  onAddLog,
  onPlace,
  onPatch,
  onNotify,
}: {
  tasks: Task[]
  /** 自分で入れた予定。繰り返しはここで展開する（作り置きしない） */
  plans: Plan[]
  /** 実行の記録。**実際に動かした時間**を同じ軸に置くために渡す（v1.30.0） */
  runs: WorkRun[]
  today: string
  settings: Settings
  /** いまの時刻（0時からの分）。今日の軸に線を引くのに使う */
  nowMin: number
  runBox: RunBox
  onEdit: (task: Task) => void
  onEditPlan: (plan: Plan) => void
  /** Googleカレンダーの予定をタスク候補にする（確認画面を通す） */
  onImportEvent: (ev: CalendarEvent) => void
  /** やったことを後から足す（v1.28.0 で実行の画面から移した）。先の日には出さない */
  onAddLog: (day: string) => void
  /** 時刻を決めていない仕事を、その日の空きへ置く（タイムボックス。v1.29.0） */
  onPlace: (task: Task, time: string) => void
  /** 実績（かかった時間・開始時刻）を直す */
  onPatch: (task: Task, patch: Partial<Task>) => void
  onNotify: (text: string, tone?: 'ok' | 'error') => void
}) {
  const [day, setDay] = useState(today)
  /** 実績を直している相手。null なら閉じている */
  const [fixing, setFixing] = useState<Task | null>(null)
  const [month, setMonth] = useState(() => monthKey(today))
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)

  const calendarReady = !!settings.googleClientId

  const loadEvents = useCallback(async () => {
    if (!calendarReady) return
    setLoadingEvents(true)
    try {
      const list = await fetchEvents(
        settings.googleClientId,
        settings.googleCalendarId,
        today,
        addDaysKey(today, 13),
      )
      setEvents(list)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'カレンダーを読めませんでした', 'error')
    } finally {
      setLoadingEvents(false)
    }
  }, [calendarReady, settings.googleClientId, settings.googleCalendarId, today, onNotify])

  // 接続済みなら黙って読む。未接続なら「読み込む」を押してもらう。
  useEffect(() => {
    if (calendarReady && isConnected()) void loadEvents()
  }, [calendarReady, loadEvents])

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>()
    for (const e of events) {
      const list = m.get(e.day)
      if (list) list.push(e)
      else m.set(e.day, [e])
    }
    return m
  }, [events])

  // 予定は昨日から2週間先まで展開する（日付の帯と1週間の面がこの範囲）
  const occurrences = useMemo(
    () =>
      occurrencesInRange(plans, addDaysKey(today, -1), addDaysKey(today, 13), {
        workHours: settings.workHours,
        workCalendar: settings.workCalendar,
      }),
    [plans, today, settings.workHours, settings.workCalendar],
  )
  const plansByDay = useMemo(() => groupOccurrences(occurrences), [occurrences])

  const open = useMemo(() => tasks.filter((t) => t.status === 'open'), [tasks])
  const byDue = useMemo(() => groupByDue(tasks), [tasks])
  const dayTasks = useMemo(() => sortTasks(tasks.filter((t) => t.due === day)), [tasks, day])
  const dayPlans = plansByDay.get(day) ?? []
  const allDayPlans = dayPlans.filter((o) => o.plan.allDay)

  /** 時刻を決めていない仕事。**未完了だけ**（済んだものを並べても選べない） */
  const loose = useMemo(
    () => dayTasks.filter((t) => t.status === 'open' && !t.dueTime),
    [dayTasks],
  )

  /* --- タイムボックス（v1.29.0）---
     その日の空いている区間を出して、時刻未定の仕事を早いところから置けるようにする。
     今日はいまより前を空きにしない。先の日は始業から。 */
  const busy = useMemo(
    () => busySlots(dayTasks, dayPlans, settings.defaultEstimateMin),
    [dayTasks, dayPlans, settings.defaultEstimateMin],
  )
  const slots = useMemo(
    () => freeSlots(settings.workHours, busy, day === today ? nowMin : null),
    [settings.workHours, busy, day, today, nowMin],
  )
  const free = freeMinutes(slots)

  /* --- 実績（v1.30.0。利用者の指示）---
     予定だけを並べても、実際にはその通りに動かない日のほうが多い。
     押して測った区間とあとから足した記録を、**同じ軸に**置く。
     予定と実績が横に並ぶので、ずれた時間がそのまま読める。 */
  const actual = useMemo(
    () => dayBand(tasks, runs, day, (c) => groupOf(settings.categoryGroups, c)),
    [tasks, runs, day, settings.categoryGroups],
  )
  const actualMin = useMemo(() => actual.reduce((s2, a) => s2 + a.minutes, 0), [actual])

  const overdue = useMemo(() => sortTasks(open.filter((t) => !!t.due && t.due < today)), [open, today])

  // 日付の横スクロール帯は、昨日から2週間先まで
  const strip = useMemo(() => {
    const days: string[] = []
    for (let i = -1; i < 14; i++) days.push(addDaysKey(today, i))
    return days
  }, [today])

  /** 1週間ぶん。**予定のある日だけ**を出す（空の日を並べても読むところがない） */
  const week = useMemo(() => {
    const days: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = addDaysKey(today, i)
      if ((plansByDay.get(d) ?? []).length > 0) days.push(d)
    }
    return days
  }, [today, plansByDay])

  const pickDay = (d: string) => {
    setDay(d)
    setMonth(monthKey(d))
  }

  return (
    <div className="tp-view">
      {fixing && (
        <ActualSheet
          tasks={[fixing]}
          day={day}
          categoryGroups={settings.categoryGroups}
          defaultEstimateMin={settings.defaultEstimateMin}
          onPatch={onPatch}
          onClose={() => setFixing(null)}
        />
      )}

      {/* --- DAY（その日） --- */}
      <Reveal>
        <section className="tp-panel">
          {/* 左上に面の名前、右上に日付（v1.27.1。利用者の指示）。
              予定もタスクも右下の ＋ から入れるので、ここに足す釦は置かない */}
          <div className="tp-panel-head">
            <h2 className="tp-card-en">DAY</h2>
            <p className="tp-card-date tp-mono">{formatMD(day)}</p>
          </div>

          <div className="tp-daystrip" role="tablist" aria-label="表示する日">
            {strip.map((d) => {
              const n =
                (byDue.get(d) ?? []).filter((t) => t.status === 'open').length +
                (plansByDay.get(d) ?? []).length
              const off = !isWorkDay(d, settings.workHours, settings.workCalendar)
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={d === day}
                  className={`tp-daychip${d === day ? ' is-on' : ''}${off ? ' is-off' : ''}${
                    d === today ? ' is-today' : ''
                  }`}
                  onClick={() => pickDay(d)}
                >
                  <span className="tp-mono">{formatMDShort(d)}</span>
                  <span className="tp-daychip-wd">{weekdayLabel(d)}</span>
                  <b className="tp-mono">{n > 0 ? n : '·'}</b>
                </button>
              )
            })}
          </div>

          {!isWorkDay(day, settings.workHours, settings.workCalendar) && (
            <p className="tp-note-off">
              <Icon name="sun" size={14} /> この日は稼働曜日ではありません。
            </p>
          )}

          {/* 終日の予定は軸に置けないので、上にまとめて出す */}
          {allDayPlans.length > 0 && (
            <div className="tp-board-allday">
              <p className="tp-label">終日</p>
              <ul className="tp-daylist">
                {allDayPlans.map((o) => (
                  <PlanRow
                    key={o.key}
                    occ={o}
                    settings={settings}
                    runBox={runBox}
                    onEdit={() => onEditPlan(o.plan)}
                  />
                ))}
              </ul>
            </div>
          )}

          <DayTimeline
            tasks={dayTasks}
            occurrences={dayPlans}
            events={eventsByDay.get(day) ?? []}
            actual={actual}
            settings={settings}
            isToday={day === today}
            nowMin={nowMin}
            onEdit={onEdit}
            onEditPlan={onEditPlan}
            onImportEvent={onImportEvent}
            onPickActual={(seg: DaySegment) => {
              const t = seg.taskId ? tasks.find((x) => x.id === seg.taskId) ?? null : null
              if (t) setFixing(t)
            }}
          />

          {actual.length > 0 && (
            <p className="tp-hint">
              ✓ の付いた面は<b>実際に動かした記録</b>です（この日 {durationShort(actualMin)}）。
              押すと、かかった時間と開始時刻を直せます。
            </p>
          )}

          {/* 時刻を決めていない仕事。軸に置けないぶんをここで拾う（未完了だけ）。
              v1.29.0 で、空いている時間へ置く釦を足した（タイムボックス）。
              置き先は見込みの長さで決める。実績には触らない。 */}
          <div className="tp-board-free">
            <p className="tp-label">
              時刻未定 <b className="tp-mono">{loose.length}</b>
              <span className="tp-free-note tp-mono">空き {durationShort(free)}</span>
            </p>
            {loose.length === 0 ? (
              <p className="tp-hint">この日は、時刻を決めていない仕事はありません。</p>
            ) : (
              <>
                <ul className="tp-daylist">
                  {loose.map((t) => {
                    const need = taskMinutes(t, settings.defaultEstimateMin)
                    const at = firstFit(need, slots)
                    return (
                      <li key={t.id} className="tp-dayrow">
                        <button
                          type="button"
                          className={`tp-mini tp-pri-${t.priority}`}
                          onClick={() => onEdit(t)}
                        >
                          <span>{t.title}</span>
                          <span className="tp-mono">{durationShort(need)}</span>
                        </button>
                        {at === null ? (
                          <span className="tp-place is-full tp-mono" title="空いている時間に入りません">
                            空きなし
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="tp-place tp-mono"
                            aria-label={`${t.title} を ${fitLabel(at)} に置く`}
                            title="空いている時間に置く"
                            onClick={() => onPlace(t, fitLabel(at))}
                          >
                            {fitLabel(at)}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <p className="tp-hint">
                  時刻を押すと、その仕事を空いている時間へ置きます（見込みの長さぶん。
                  休憩と入っている予定は避けます）。開いて時刻を直すこともできます。
                </p>
              </>
            )}
          </div>

          {/* やったことを足す。会議・電話・応援など、台帳に無いまま終わった仕事を後から入れる。
              **先の日には出さない**（v1.26.0）。まだ起きていない仕事を実績にしない。 */}
          {day <= today && (
            <button type="button" className="tp-log-add" onClick={() => onAddLog(day)}>
              <Icon name="plus" size={16} />
              やったことを足す
              <small>会議・電話・応援など、台帳に無いまま終わった仕事</small>
            </button>
          )}

          {calendarReady && (
            <div className="tp-cal-bar">
              <span className="tp-mono">
                Googleカレンダー {events.length > 0 ? `${events.length}件` : '未読込'}
              </span>
              <button type="button" className="tp-link" disabled={loadingEvents} onClick={() => void loadEvents()}>
                {loadingEvents ? '読み込み中…' : '予定を読み込む'}
              </button>
            </div>
          )}
        </section>
      </Reveal>

      {/* --- 期限超過 --- */}
      {overdue.length > 0 && (
        <Reveal>
          <section className="tp-panel">
            <div className="tp-panel-head">
              <h2>期限超過</h2>
              <span className="tp-badge is-over tp-mono">{overdue.length}</span>
            </div>
            <ul className="tp-daylist">
              {overdue.map((t) => (
                <li key={t.id}>
                  <button type="button" className={`tp-mini tp-pri-${t.priority}`} onClick={() => onEdit(t)}>
                    <span>{t.title}</span>
                    <span className="tp-mono">{formatMDShort(t.due as string)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>
      )}

      {/* --- WEEK（予定のある日だけ） --- */}
      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2 className="tp-card-en">WEEK</h2>
            <span className="tp-badge tp-mono">{week.length}日</span>
          </div>
          {week.length === 0 ? (
            <p className="tp-empty-body">
              これから1週間に予定はありません。打合せや来客は ＋ の「予定」から入れられます。
            </p>
          ) : (
            <ol className="tp-week">
              {week.map((d) => {
                const list = plansByDay.get(d) ?? []
                const off = !isWorkDay(d, settings.workHours, settings.workCalendar)
                const dueN = (byDue.get(d) ?? []).filter((t) => t.status === 'open').length
                return (
                  <li key={d} className={`tp-week-row${off ? ' is-off' : ''}${d === today ? ' is-today' : ''}`}>
                    <button type="button" className="tp-week-date" onClick={() => pickDay(d)}>
                      <span className="tp-mono">{formatMDShort(d)}</span>
                      <span className="tp-week-wd">{weekdayLabel(d)}</span>
                      {dueN > 0 && <b className="tp-mono">締め{dueN}</b>}
                    </button>
                    <ul className="tp-daylist">
                      {list.map((o) => (
                        <PlanRow
                          key={o.key}
                          occ={o}
                          settings={settings}
                          runBox={runBox}
                          onEdit={() => onEditPlan(o.plan)}
                        />
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </Reveal>

      {/* --- MONTH（月の升目） --- */}
      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2 className="tp-card-en">MONTH</h2>
          </div>
          <MonthGrid
            month={month}
            onChangeMonth={setMonth}
            day={day}
            today={today}
            tasks={tasks}
            plans={plans}
            settings={settings}
            onPickDay={(d) => {
              setDay(d)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
          <p className="tp-hint">
            日を押すと、いちばん上の DAY がその日に変わります。棒はタスクの見込み時間が
            勤務時間のどれだけを埋めているか。
          </p>
        </section>
      </Reveal>
    </div>
  )
}
