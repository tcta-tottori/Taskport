import type { CSSProperties } from 'react'
import { catStyle } from './CategoryChip'
import { durationLabel, fromMinutes, toMinutes } from '../lib/date'
import { trim, workSegments } from '../lib/workday'
import type { CategoryColor, WorkHours } from '../types'
import type { DaySegment } from '../lib/worklog'

/* =========================================================
 * その日の時間帯（何時に何をしていたか）
 *
 * 勤務時間を1本の帯にして、実際に動かした区間だけを区分の色で置く。
 * 円グラフが「どれだけ」なら、こちらは「いつ」。
 *
 * 色は区分のもの（--cat-*）を使うが、**色だけで見分けさせない**：
 *   - 幅のある区間には件名を直接書く
 *   - 押すとその仕事の実績（開始・かかった時間）を直せる
 *   - 下の目盛りに時刻を出す
 * =======================================================*/

/** 帯の高さ（px） */
const H = 34

export function DayBand({
  segments,
  workHours,
  colorOfGroupName,
  onPick,
}: {
  segments: DaySegment[]
  workHours: WorkHours
  colorOfGroupName: (group: string) => CategoryColor
  /** 区間を押したとき（実績を直す）。予定は taskId が null */
  onPick: (seg: DaySegment) => void
}) {
  const segs = workSegments(workHours)
  if (segs.length === 0 || segments.length === 0) return null

  // 表示の範囲。勤務時間の外で動かしたぶんも切らない
  const from = Math.min(segs[0].from, ...segments.map((s) => s.from))
  const to = Math.max(segs[segs.length - 1].to, ...segments.map((s) => s.to))
  const span = Math.max(1, to - from)
  const pct = (min: number) => ((min - from) / span) * 100

  // 正時の目盛り
  const hours: number[] = []
  for (let m = Math.ceil(from / 60) * 60; m <= to; m += 60) hours.push(m)

  return (
    <div className="tp-band-wrap">
      <div className="tp-band-rail" style={{ height: H }}>
        {/* 勤務している時間の地。休憩はここが抜けて見える */}
        {segs.map((s) => (
          <span
            key={`${s.from}-${s.to}`}
            className="tp-band-work"
            style={{ left: `${pct(s.from)}%`, width: `${((s.to - s.from) / span) * 100}%` }}
          />
        ))}

        {segments.map((seg, i) => {
          const w = ((seg.to - seg.from) / span) * 100
          const label = `${trim(fromMinutes(seg.from))}〜${trim(fromMinutes(seg.to))} ${seg.title}（${durationLabel(seg.to - seg.from)}）`
          return (
            <button
              key={`${seg.from}-${seg.title}-${i}`}
              type="button"
              className={`tp-band-seg${seg.kind === 'plan' ? ' is-plan' : ''}`}
              style={
                {
                  left: `${pct(seg.from)}%`,
                  width: `${Math.max(0.6, w)}%`,
                  ...catStyle(colorOfGroupName(seg.group)),
                } as CSSProperties
              }
              title={label}
              aria-label={label}
              onClick={() => onPick(seg)}
            >
              {/* 幅のあるものだけ件名を出す。潰れた文字は読めないので出さない */}
              {w > 14 && <span className="tp-band-seg-name">{seg.title}</span>}
            </button>
          )
        })}
      </div>

      <div className="tp-band-ticks" aria-hidden="true">
        {hours.map((m) => (
          <span key={m} className="tp-mono" style={{ left: `${pct(m)}%` }}>
            {trim(fromMinutes(m))}
          </span>
        ))}
      </div>
    </div>
  )
}

/** 帯に出せる区間があるか（無いときは面ごと出さない） */
export function hasBand(segments: DaySegment[], workHours: WorkHours): boolean {
  return segments.length > 0 && workSegments(workHours).length > 0 && toMinutes(workHours.start) !== null
}
