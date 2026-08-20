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
 * **同時に動かしたぶんは行を増やして並べる**（v1.22.1）。
 * 電話を受けながら伝票を打つ、が実際に起きるので、重ねて置くと
 * 下になったほうが読めず、押すこともできない。
 *
 * 色は区分のもの（--cat-*）を使うが、**色だけで見分けさせない**：
 *   - 幅のある区間には件名を直接書く
 *   - 押すとその仕事の実績（開始・かかった時間）を直せる
 *   - 下の目盛りに時刻を出す
 * =======================================================*/

/** 1行の高さ（px）と行の間 */
const LANE_H = 30
const LANE_GAP = 4

/** 行を割り当てた区間 */
type Placed = { seg: DaySegment; lane: number }

/**
 * 重なる区間を別の行へ落とす。
 *
 * 早く始まったものから順に、**空いている中でいちばん上の行**へ置く。
 * 同時に始まったときは長いほうを上にする（上の行から読める並びにする）。
 */
export function packLanes(segments: DaySegment[]): { placed: Placed[]; lanes: number } {
  const sorted = [...segments].sort((a, b) => a.from - b.from || b.to - a.to)
  const ends: number[] = []
  const placed: Placed[] = []
  for (const seg of sorted) {
    let lane = ends.findIndex((end) => end <= seg.from)
    if (lane < 0) {
      lane = ends.length
      ends.push(seg.to)
    } else {
      ends[lane] = seg.to
    }
    placed.push({ seg, lane })
  }
  return { placed, lanes: Math.max(1, ends.length) }
}

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

  const { placed, lanes } = packLanes(segments)
  const height = lanes * LANE_H + (lanes - 1) * LANE_GAP

  // 正時の目盛り
  const hours: number[] = []
  for (let m = Math.ceil(from / 60) * 60; m <= to; m += 60) hours.push(m)

  return (
    <div className="tp-band-wrap">
      <div className="tp-band-rail" style={{ height }}>
        {/* 勤務している時間の地。休憩はここが抜けて見える */}
        {segs.map((s) => (
          <span
            key={`${s.from}-${s.to}`}
            className="tp-band-work"
            style={{ left: `${pct(s.from)}%`, width: `${((s.to - s.from) / span) * 100}%` }}
          />
        ))}

        {placed.map(({ seg, lane }, i) => {
          const w = ((seg.to - seg.from) / span) * 100
          const label = `${trim(fromMinutes(seg.from))}〜${trim(fromMinutes(seg.to))} ${seg.title}（${durationLabel(seg.to - seg.from)}）${lanes > 1 ? ` ／ ${lane + 1}行目` : ''}`
          return (
            <button
              key={`${seg.from}-${seg.title}-${i}`}
              type="button"
              className={`tp-band-seg${seg.kind === 'plan' ? ' is-plan' : ''}`}
              style={
                {
                  left: `${pct(seg.from)}%`,
                  width: `${Math.max(0.6, w)}%`,
                  top: lane * (LANE_H + LANE_GAP),
                  height: LANE_H,
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
