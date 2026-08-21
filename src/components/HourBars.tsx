import { durationLabel } from '../lib/date'
import { workSegments } from '../lib/workday'
import type { WorkHours } from '../types'

/* =========================================================
 * 時刻ごとの合計（縦軸）
 *
 * 1日ぶんなら実物の帯（`DayBand`）を出せるが、週・月・全体では
 * 日をまたぐので帯にならない。そこで**縦軸はそのまま時刻**にして、
 * 横に伸びる棒でその時刻の合計を出す（v1.30.0）。
 *
 * 「何時に手が動いているか」が期間をまたいで読めるので、
 * 会議が固まっている時間帯や、夕方に伸びている残業が見つけられる。
 * =======================================================*/

export function HourBars({
  byHour,
  workHours,
  days,
}: {
  /** 0〜23時ごとの合計（分） */
  byHour: number[]
  workHours: WorkHours
  /** 期間の日数。1日あたりの平均を添える */
  days: number
}) {
  const segs = workSegments(workHours)
  const workFrom = segs.length > 0 ? Math.floor(segs[0].from / 60) : 8
  const workTo = segs.length > 0 ? Math.ceil(segs[segs.length - 1].to / 60) : 18
  const used = byHour.map((m, h) => ({ h, m })).filter((r) => r.m > 0)
  const first = Math.min(workFrom, ...used.map((r) => r.h))
  const last = Math.max(workTo, ...used.map((r) => r.h + 1))
  const max = Math.max(1, ...byHour)

  const rows: number[] = []
  for (let h = first; h < last; h++) rows.push(h)

  return (
    <ul className="tp-hourbars">
      {rows.map((h) => {
        const min = byHour[h] ?? 0
        const inWork = segs.some((s) => s.from < (h + 1) * 60 && s.to > h * 60)
        return (
          <li key={h} className={inWork ? '' : 'is-off'}>
            <span className="tp-hourbars-h tp-mono">{h}:00</span>
            <span className="tp-hourbars-track">
              <span className="tp-hourbars-fill" style={{ width: `${(min / max) * 100}%` }} />
            </span>
            <span className="tp-hourbars-min tp-mono">
              {min > 0 ? durationLabel(min) : '—'}
              {min > 0 && days > 1 && (
                <small>／日 {durationLabel(min / days)}</small>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
