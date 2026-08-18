import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Reveal } from '../components/Reveal'
import {
  addDaysKey,
  durationLabel,
  formatMD,
  formatMDShort,
  fromMinutes,
  lastNDays,
  toMinutes,
  weekdayLabel,
} from '../lib/date'
import { groupByDue, sortTasks } from '../lib/tasks'
import {
  allBreaks,
  breakSegment,
  dayLoad,
  isWorkDay,
  placeTimed,
  taskMinutes,
  trim,
  workSegments,
} from '../lib/workday'
import { fetchEvents } from '../ports/in/fromCalendar'
import { isConnected } from '../lib/googleAuth'
import { PRIORITY_LABEL, type CalendarEvent, type Settings, type Task } from '../types'

/* =========================================================
 * スケジュールビュー
 *
 * 上: 選んだ1日を勤務時間の帯の上に並べたタイムライン
 *     （始業・昼休憩・終業が目盛りとして常に見える）
 * 下: 2週間ぶんの日付軸。「いつ何が固まっているか」を面で見る。
 *
 * Googleカレンダーを繋いでいるときは、その日の予定を帯の右側に重ねる。
 * 予定はタスクとは別物として扱い、台帳には混ぜない
 * （取り込みたいものだけ、確認画面を通してタスクにする）。
 * =======================================================*/

/** 1分あたりの高さ(px)。1日の勤務がスクロールなしで収まる程度に取る。 */
const PX_PER_MIN = 0.9

function DayTimeline({
  tasks,
  events,
  settings,
  onEdit,
  onImportEvent,
}: {
  tasks: Task[]
  events: CalendarEvent[]
  settings: Settings
  onEdit: (task: Task) => void
  onImportEvent: (ev: CalendarEvent) => void
}) {
  const wh = settings.workHours
  const segs = workSegments(wh)
  const br = breakSegment(wh)
  const placed = useMemo(
    () => placeTimed(tasks, wh, settings.defaultEstimateMin),
    [tasks, wh, settings.defaultEstimateMin],
  )
  const untimed = useMemo(() => tasks.filter((t) => !t.dueTime), [tasks])

  if (segs.length === 0) {
    return <p className="tp-empty-body">勤務時間の設定が不正です。設定画面で始業と終業を見直してください。</p>
  }

  // 勤務時間外に置かれたタスクも切れないよう、表示範囲を広げる
  const workFrom = segs[0].from
  const workTo = segs[segs.length - 1].to
  const timedEvents = events.filter((e) => !e.allDay && e.startTime)
  const evMins = timedEvents.flatMap((e) => {
    const a = toMinutes(e.startTime as string)
    const b = e.endTime ? toMinutes(e.endTime) : null
    return [a, b].filter((v): v is number => v !== null)
  })
  const from = Math.min(workFrom - 30, ...placed.map((p) => p.from - 15), ...evMins.map((m) => m - 15))
  const to = Math.max(workTo + 30, ...placed.map((p) => p.to + 15), ...evMins.map((m) => m + 15))
  const height = (to - from) * PX_PER_MIN
  const y = (min: number) => (min - from) * PX_PER_MIN

  // 正時の目盛り
  const hours: number[] = []
  for (let m = Math.ceil(from / 60) * 60; m <= to; m += 60) hours.push(m)

  return (
    <>
      <div className="tp-tl" style={{ height }}>
        {hours.map((m) => (
          <div key={m} className="tp-tl-hour" style={{ top: y(m) }}>
            <span className="tp-mono">{fromMinutes(m)}</span>
          </div>
        ))}

        {segs.map((s) => (
          <div
            key={s.label}
            className="tp-tl-work"
            style={{ top: y(s.from), height: (s.to - s.from) * PX_PER_MIN }}
          />
        ))}

        {/* 昼休憩と小休憩。日報の時間枠と同じ位置に出す。 */}
        {allBreaks(wh).map((b) => {
          const isLunch = !!br && b.from === br.from
          const h = (b.to - b.from) * PX_PER_MIN
          return (
            <div
              key={`${b.from}-${b.to}`}
              className={`tp-tl-break${isLunch ? '' : ' is-short'}`}
              style={{ top: y(b.from), height: h }}
            >
              {isLunch && (
                <span>
                  昼休憩 {trim(fromMinutes(b.from))}〜{trim(fromMinutes(b.to))}
                </span>
              )}
            </div>
          )
        })}

        <div className="tp-tl-edge" style={{ top: y(workFrom) }}>
          <span>始業 {trim(wh.start)}</span>
        </div>
        <div className="tp-tl-edge" style={{ top: y(workTo) }}>
          <span>終業 {trim(wh.end)}</span>
        </div>

        {/* Googleカレンダーの予定。タスクの帯とぶつからないよう右側に細く重ねる。 */}
        {timedEvents.map((ev) => {
          const a = toMinutes(ev.startTime as string)
          if (a === null) return null
          const b = ev.endTime ? toMinutes(ev.endTime) : null
          const h = Math.max(20, ((b ?? a + 30) - a) * PX_PER_MIN - 2)
          return (
            <button
              key={ev.id}
              type="button"
              className="tp-tl-event"
              style={{ top: y(a), height: h }}
              title={`${ev.title}（Googleカレンダー）`}
              onClick={() => onImportEvent(ev)}
            >
              <b>{ev.title}</b>
              <span className="tp-mono">
                {ev.startTime}
                {ev.endTime ? `–${ev.endTime}` : ''}
              </span>
            </button>
          )
        })}

        {placed.map((p) => {
          const h = Math.max(24, (p.to - p.from) * PX_PER_MIN - 2)
          // 短い予定は2行に収まらないので、件名と時刻を1行に並べる。
          // 件名が隠れると一覧としての意味がなくなるため、件名を優先する。
          const short = h < 44
          return (
            <button
              key={p.task.id}
              type="button"
              className={`tp-tl-task tp-pri-${p.task.priority}${short ? ' is-short' : ''}${
                p.outside ? ' is-outside' : ''
              }${p.task.status === 'done' ? ' is-done' : ''}`}
              style={{ top: y(p.from), height: h }}
              onClick={() => onEdit(p.task)}
            >
              <b>{p.task.title}</b>
              <span className="tp-mono">
                {fromMinutes(p.from)}–{fromMinutes(p.to)}
                {p.outside ? ' ・勤務時間外' : ''}
              </span>
            </button>
          )
        })}
      </div>

      {events.some((e) => e.allDay) && (
        <div className="tp-tl-allday">
          <p className="tp-label">終日の予定</p>
          <ul>
            {events
              .filter((e) => e.allDay)
              .map((ev) => (
                <li key={ev.id}>
                  <button type="button" className="tp-mini tp-mini-event" onClick={() => onImportEvent(ev)}>
                    <span>{ev.title}</span>
                    <span className="tp-mono">終日</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      {untimed.length > 0 && (
        <div className="tp-tl-untimed">
          <p className="tp-label">時間未指定 {untimed.length}件</p>
          <ul>
            {sortTasks(untimed).map((t) => (
              <li key={t.id}>
                <button type="button" className={`tp-mini tp-pri-${t.priority}`} onClick={() => onEdit(t)}>
                  <span>{t.title}</span>
                  <span className="tp-mono">{durationLabel(taskMinutes(t, settings.defaultEstimateMin))}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

export function ScheduleView({
  tasks,
  today,
  settings,
  onEdit,
  onImportEvent,
  onNotify,
}: {
  tasks: Task[]
  today: string
  settings: Settings
  onEdit: (task: Task) => void
  /** 予定をタスク候補にする（確認画面を通す） */
  onImportEvent: (ev: CalendarEvent) => void
  onNotify: (text: string, tone?: 'ok' | 'error') => void
}) {
  const [day, setDay] = useState(today)
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

  const open = useMemo(() => tasks.filter((t) => t.status === 'open'), [tasks])
  const byDue = useMemo(() => groupByDue(tasks), [tasks])
  const dayTasks = useMemo(
    () => sortTasks(tasks.filter((t) => t.due === day)),
    [tasks, day],
  )
  const load = dayLoad(
    dayTasks.filter((t) => t.status === 'open'),
    settings.workHours,
    settings.defaultEstimateMin,
    day,
    settings.workCalendar,
  )
  const noDue = useMemo(() => sortTasks(open.filter((t) => !t.due)), [open])

  // 2週間ぶん。過ぎた期限は先頭にまとめて出す。
  const fortnight = useMemo(() => {
    const days: string[] = []
    for (let i = 0; i < 14; i++) days.push(addDaysKey(today, i))
    return days
  }, [today])
  const overdue = useMemo(
    () => sortTasks(open.filter((t) => !!t.due && t.due < today)),
    [open, today],
  )

  // 日付の横スクロール帯は、昨日から2週間先まで
  const strip = useMemo(() => [addDaysKey(today, -1), ...lastNDays(addDaysKey(today, 13), 14)], [today])

  return (
    <div className="tp-view">
      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2>{formatMD(day)}</h2>
            <span className={`tp-badge${load.over > 0 ? ' is-over' : ''}`}>
              {durationLabel(load.planned)} / {durationLabel(load.capacity)}
            </span>
          </div>

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

          <div className="tp-daystrip" role="tablist" aria-label="表示する日">
            {strip.map((d) => {
              const n = (byDue.get(d) ?? []).filter((t) => t.status === 'open').length
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
                  onClick={() => setDay(d)}
                >
                  <span className="tp-mono">{formatMDShort(d)}</span>
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

          <DayTimeline
            tasks={dayTasks}
            events={eventsByDay.get(day) ?? []}
            settings={settings}
            onEdit={onEdit}
            onImportEvent={onImportEvent}
          />
        </section>
      </Reveal>

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

      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2>これから2週間</h2>
          </div>
          <ol className="tp-fortnight">
            {fortnight.map((d) => {
              const list = (byDue.get(d) ?? []).filter((t) => t.status === 'open')
              const off = !isWorkDay(d, settings.workHours, settings.workCalendar)
              const l = dayLoad(list, settings.workHours, settings.defaultEstimateMin, d, settings.workCalendar)
              return (
                <li key={d} className={`tp-fn-row${off ? ' is-off' : ''}${d === today ? ' is-today' : ''}`}>
                  <button type="button" className="tp-fn-date" onClick={() => setDay(d)}>
                    <span className="tp-mono">{formatMDShort(d)}</span>
                    <span className="tp-fn-wd">{weekdayLabel(d)}</span>
                  </button>
                  <div className="tp-fn-body">
                    {list.length === 0 ? (
                      <span className="tp-fn-none">—</span>
                    ) : (
                      <>
                        <div className="tp-fn-bar" aria-hidden="true">
                          <span
                            className={l.over > 0 ? 'is-over' : ''}
                            style={{ width: `${Math.min(100, Math.round(l.ratio * 100))}%` }}
                          />
                        </div>
                        <ul>
                          {list.map((t) => (
                            <li key={t.id}>
                              <button
                                type="button"
                                className={`tp-mini tp-pri-${t.priority}`}
                                onClick={() => onEdit(t)}
                              >
                                <span>{t.title}</span>
                                <span className="tp-mono">
                                  {t.dueTime ?? PRIORITY_LABEL[t.priority]}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      </Reveal>

      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2>期限未設定</h2>
            <span className="tp-badge tp-mono">{noDue.length}</span>
          </div>
          {noDue.length === 0 ? (
            <p className="tp-empty-body">期限のないタスクはありません。</p>
          ) : (
            <ul className="tp-daylist">
              {noDue.map((t) => (
                <li key={t.id}>
                  <button type="button" className={`tp-mini tp-pri-${t.priority}`} onClick={() => onEdit(t)}>
                    <span>{t.title}</span>
                    <span className="tp-mono">{PRIORITY_LABEL[t.priority]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Reveal>
    </div>
  )
}
