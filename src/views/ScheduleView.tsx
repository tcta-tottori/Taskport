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
  dayLoad,
  isWorkDay,
  taskMinutes,
  trim,
  workSegments,
} from '../lib/workday'
import { bands, currentBand, timeboxOf } from '../lib/timebox'
import { fetchEvents } from '../ports/in/fromCalendar'
import { isConnected } from '../lib/googleAuth'
import {
  PRIORITY_LABEL,
  type CalendarEvent,
  type Settings,
  type Task,
  type TimeboxKey,
} from '../types'

/* =========================================================
 * スケジュールビュー
 *
 * 上: 選んだ1日を**勤務時間の枠ごと**に並べた表
 *     （午前前半／午前後半／午後前半／午後後半／時間外＝日報の時間区分そのもの）
 * 下: 2週間ぶんの日付軸。「いつ何が固まっているか」を面で見る。
 *
 * v1.16.0 で、1分＝0.9px の目盛りに置くタイムラインをやめた（§10.1）。
 * 実際の1日は予定の入っていない時間のほうが長く、画面のほとんどが空白で、
 * そのぶん**時刻を決めていないタスクが下へ押し出されて見えなくなっていた**。
 * 枠ごとに畳むと1画面に収まり、「この枠はもう埋まっているか」も同時に分かる。
 *
 * Googleカレンダーを繋いでいるときは、その日の予定を帯の右側に重ねる。
 * 予定はタスクとは別物として扱い、台帳には混ぜない
 * （取り込みたいものだけ、確認画面を通してタスクにする）。
 * =======================================================*/

/** 予定と枠を突き合わせた1枠ぶん */
interface BoardBand {
  key: TimeboxKey
  label: string
  /** 「8:20〜10:20」。時間外は空 */
  span: string
  /** 枠の長さ（分）。時間外は上限なし＝null */
  capacity: number | null
  /** 枠の終わり（0時からの分）。時間外は null */
  to: number | null
  tasks: Task[]
  events: CalendarEvent[]
  /** 積み上げた見込み（分） */
  planned: number
  /** 枠を超えた分 */
  over: number
}

/** 枠と枠のあいだの休憩（昼休憩・小休憩） */
interface BoardBreak {
  from: number
  to: number
  label: string
}

/**
 * その日を勤務時間の枠に割り付ける。
 *
 * どの枠に入るかは `timeboxOf`（自分で決めた枠 → 時刻から決まる枠 → 未割り当て）。
 * 時刻を決めていないタスクも枠に入るので、**タイムラインでは置き場が無くて
 * 下へ追いやられていたものが、ここでは同じ面に並ぶ**。
 */
function buildBoard(
  tasks: Task[],
  events: CalendarEvent[],
  settings: Settings,
): { bands: BoardBand[]; breaks: Map<TimeboxKey, BoardBreak>; unboxed: Task[] } {
  const wh = settings.workHours
  const list = bands(wh)
  const timed = events.filter((e) => !e.allDay && e.startTime)

  const bandOfMin = (min: number): TimeboxKey => {
    for (const b of list) {
      if (b.from !== null && b.to !== null && min >= b.from && min < b.to) return b.key
    }
    return 'out'
  }

  const out: BoardBand[] = list.map((b) => {
    const mine = sortTasks(tasks.filter((t) => timeboxOf(t, wh) === b.key))
    const evs = timed.filter((e) => bandOfMin(toMinutes(e.startTime as string) ?? 0) === b.key)
    const planned = mine.reduce((sum, t) => sum + taskMinutes(t, settings.defaultEstimateMin), 0)
    return {
      key: b.key,
      label: b.label,
      span: b.span,
      capacity: b.minutes,
      to: b.to,
      tasks: mine,
      events: evs,
      planned,
      over: b.minutes === null ? 0 : Math.max(0, planned - b.minutes),
    }
  })

  // 枠と枠のあいだは休憩。次の枠の頭に付けて出す。
  const breaks = new Map<TimeboxKey, BoardBreak>()
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1]
    const cur = list[i]
    if (prev.to === null || cur.from === null || cur.from <= prev.to) continue
    breaks.set(cur.key, {
      from: prev.to,
      to: cur.from,
      // 長いほうが昼休憩。時刻はそのまま出すので、名前は種類が分かれば足りる
      label: cur.from - prev.to >= 20 ? '昼休憩' : '休憩',
    })
  }

  return { bands: out, breaks, unboxed: sortTasks(tasks.filter((t) => timeboxOf(t, wh) === null)) }
}

/** 1件ぶんの時刻表示。「8:30–10:00」。時刻が無ければ見込みの長さ。 */
function itemTime(task: Task, defaultEstimateMin: number): string {
  const min = taskMinutes(task, defaultEstimateMin)
  const from = task.dueTime ? toMinutes(task.dueTime) : null
  if (from === null) return durationLabel(min)
  return `${trim(fromMinutes(from))}–${trim(fromMinutes(from + min))}`
}

/**
 * その日の予定を、勤務時間の枠ごとに並べる。
 *
 * 前は1分＝0.9px のタイムラインだったが、空いている時間のほうが長いので
 * 画面のほとんどが余白になり、**時刻を決めていないタスクが下に隠れていた**。
 * 枠ごとに畳めば1画面に収まり、枠が埋まっているかも同時に読める。
 */
function DayBoard({
  tasks,
  events,
  settings,
  isToday,
  nowMin,
  onEdit,
  onImportEvent,
}: {
  tasks: Task[]
  events: CalendarEvent[]
  settings: Settings
  /** 表示している日が今日か（いまの枠を目立たせるのに使う） */
  isToday: boolean
  /** いまの時刻（0時からの分） */
  nowMin: number
  onEdit: (task: Task) => void
  onImportEvent: (ev: CalendarEvent) => void
}) {
  const wh = settings.workHours
  const board = useMemo(() => buildBoard(tasks, events, settings), [tasks, events, settings])
  const allDay = events.filter((e) => e.allDay)
  const now = isToday ? currentBand(wh, nowMin) : null

  if (workSegments(wh).length === 0) {
    return (
      <p className="tp-empty-body">
        勤務時間の設定が不正です。設定画面で始業と終業を見直してください。
      </p>
    )
  }

  return (
    <>
      {allDay.length > 0 && (
        <div className="tp-board-allday">
          <p className="tp-label">終日の予定</p>
          <ul>
            {allDay.map((ev) => (
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

      <ul className="tp-bands tp-board">
        {board.bands.map((b) => {
          const br = board.breaks.get(b.key)
          const count = b.tasks.length + b.events.length
          // 時間外は、何も無いなら出さない（毎日「空いています」と言われても仕方ない）
          if (b.key === 'out' && count === 0) return null
          const pct = b.capacity ? Math.min(100, Math.round((b.planned / b.capacity) * 100)) : 0
          // 今日で、もう終わった枠は落ち着かせる（残っているものは色を落とさない）
          const passed = isToday && b.to !== null && nowMin >= b.to
          return (
            <li key={b.key} className="tp-board-item">
              {br && (
                <p className="tp-board-break">
                  {br.label} {trim(fromMinutes(br.from))}〜{trim(fromMinutes(br.to))}
                </p>
              )}
              <div
                className={`tp-band${now === b.key ? ' is-now' : ''}${
                  passed && count === 0 ? ' is-passed' : ''
                }`}
              >
                <div className="tp-band-head">
                  <b>{b.label}</b>
                  <span className="tp-band-span tp-mono">{b.span}</span>
                  <span className={`tp-band-num tp-mono${b.over > 0 ? ' is-over' : ''}`}>
                    {b.capacity
                      ? `${durationLabel(b.planned)} / ${durationLabel(b.capacity)}`
                      : durationLabel(b.planned)}
                  </span>
                </div>
                {b.capacity !== null && (
                  <div className="tp-progress">
                    <span
                      className={b.over > 0 ? 'is-over' : pct > 80 ? 'is-tight' : ''}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}

                {count === 0 ? (
                  <p className="tp-band-note">
                    空いています{b.capacity ? `（${durationLabel(b.capacity)}）` : ''}
                  </p>
                ) : (
                  <ul className="tp-band-list">
                    {b.tasks.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className={`tp-mini tp-pri-${t.priority}${t.status === 'done' ? ' is-done' : ''}`}
                          onClick={() => onEdit(t)}
                        >
                          <span>{t.title}</span>
                          <span className="tp-mono">{itemTime(t, settings.defaultEstimateMin)}</span>
                        </button>
                      </li>
                    ))}
                    {b.events.map((ev) => (
                      <li key={ev.id}>
                        <button
                          type="button"
                          className="tp-mini tp-mini-event"
                          title={`${ev.title}（Googleカレンダー）`}
                          onClick={() => onImportEvent(ev)}
                        >
                          <span>{ev.title}</span>
                          <span className="tp-mono">
                            {ev.startTime}
                            {ev.endTime ? `–${ev.endTime}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {b.over > 0 && (
                  <p className="tp-band-note is-over">
                    {durationLabel(b.over)}あふれています。ほかの枠へ移すか、今日はやらないと決めてください。
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/* 枠を決めていないもの。前は一番下に押し出されて見えなかった。 */}
      {board.unboxed.length > 0 && (
        <div className="tp-board-free">
          <p className="tp-label">
            枠を決めていない <b className="tp-mono">{board.unboxed.length}</b> 件
          </p>
          <ul>
            {board.unboxed.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`tp-mini tp-pri-${t.priority}${t.status === 'done' ? ' is-done' : ''}`}
                  onClick={() => onEdit(t)}
                >
                  <span>{t.title}</span>
                  <span className="tp-mono">
                    {durationLabel(taskMinutes(t, settings.defaultEstimateMin))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="tp-hint">開いて時間枠を選ぶと、上のどれかの枠に積まれます。</p>
        </div>
      )}
    </>
  )
}

export function ScheduleView({
  tasks,
  today,
  settings,
  nowMin,
  onEdit,
  onImportEvent,
  onNotify,
}: {
  tasks: Task[]
  today: string
  settings: Settings
  /** いまの時刻（0時からの分）。今日の枠を目立たせるのに使う */
  nowMin: number
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
          {load.capacity > 0 && (
            <div className="tp-progress tp-day-progress">
              <span
                className={load.over > 0 ? 'is-over' : load.ratio > 0.8 ? 'is-tight' : ''}
                style={{ width: `${Math.min(100, Math.round(load.ratio * 100))}%` }}
              />
            </div>
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

          <DayBoard
            tasks={dayTasks}
            events={eventsByDay.get(day) ?? []}
            settings={settings}
            isToday={day === today}
            nowMin={nowMin}
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
