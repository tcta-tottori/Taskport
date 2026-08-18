import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Reveal } from '../components/Reveal'
import {
  addDaysKey,
  durationLabel,
  formatMD,
  formatMDShort,
  fromMinutes,
  lastNDays,
  weekdayLabel,
} from '../lib/date'
import { groupByDue, sortTasks } from '../lib/tasks'
import {
  breakSegment,
  dayLoad,
  isWorkDay,
  placeTimed,
  taskMinutes,
  trim,
  workSegments,
} from '../lib/workday'
import { PRIORITY_LABEL, type Settings, type Task } from '../types'

/* =========================================================
 * スケジュールビュー
 *
 * 上: 選んだ1日を勤務時間の帯の上に並べたタイムライン
 *     （始業・昼休憩・終業が目盛りとして常に見える）
 * 下: 2週間ぶんの日付軸。「いつ何が固まっているか」を面で見る。
 * =======================================================*/

/** 1分あたりの高さ(px)。1日の勤務がスクロールなしで収まる程度に取る。 */
const PX_PER_MIN = 0.9

function DayTimeline({
  tasks,
  settings,
  onEdit,
}: {
  tasks: Task[]
  settings: Settings
  onEdit: (task: Task) => void
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
  const from = Math.min(workFrom - 30, ...placed.map((p) => p.from - 15))
  const to = Math.max(workTo + 30, ...placed.map((p) => p.to + 15))
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

        {br && (
          <div className="tp-tl-break" style={{ top: y(br.from), height: (br.to - br.from) * PX_PER_MIN }}>
            <span>昼休憩 {trim(fromMinutes(br.from))}〜{trim(fromMinutes(br.to))}</span>
          </div>
        )}

        <div className="tp-tl-edge" style={{ top: y(workFrom) }}>
          <span>始業 {trim(wh.start)}</span>
        </div>
        <div className="tp-tl-edge" style={{ top: y(workTo) }}>
          <span>終業 {trim(wh.end)}</span>
        </div>

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
}: {
  tasks: Task[]
  today: string
  settings: Settings
  onEdit: (task: Task) => void
}) {
  const [day, setDay] = useState(today)

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

          <div className="tp-daystrip" role="tablist" aria-label="表示する日">
            {strip.map((d) => {
              const n = (byDue.get(d) ?? []).filter((t) => t.status === 'open').length
              const off = !isWorkDay(d, settings.workHours)
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

          {!isWorkDay(day, settings.workHours) && (
            <p className="tp-note-off">
              <Icon name="sun" size={14} /> この日は稼働曜日ではありません。
            </p>
          )}

          <DayTimeline tasks={dayTasks} settings={settings} onEdit={onEdit} />
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
              const off = !isWorkDay(d, settings.workHours)
              const l = dayLoad(list, settings.workHours, settings.defaultEstimateMin)
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
