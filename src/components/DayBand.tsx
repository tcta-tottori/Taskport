import { useMemo } from 'react'
import { TimelineAxis, type TimelineItem } from './TimelineAxis'
import type { DaySegment } from '../lib/worklog'
import type { CategoryColor, WorkHours } from '../types'

/* =========================================================
 * その日の時間帯（何時に何をしていたか）
 *
 * v1.30.0 で**縦軸**にした（利用者の指示）。横帯だと1日ぶんが画面の幅に
 * 押し込まれ、10分の仕事は線1本になって件名も出せなかった。
 * 縦にすると、スケジュールの DAY と同じ目盛りで同じ日を読める。
 *
 * 置くのは**実際に測れた区間だけ**。円グラフが「どれだけ」なら、こちらは「いつ」。
 * 色は区分のものを使うが、**色だけで見分けさせない**：
 *   - 件名を行に直接書く
 *   - 押すとその仕事の実績（開始・かかった時間）を直せる
 *   - 左の目盛りに時刻を出す
 * =======================================================*/

export function DayBand({
  segments,
  workHours,
  isToday,
  nowMin,
  colorOfGroupName,
  onPick,
}: {
  segments: DaySegment[]
  workHours: WorkHours
  /** 今日を見ているか（いまの時刻の線を引く） */
  isToday: boolean
  nowMin: number
  colorOfGroupName: (group: string) => CategoryColor
  /** 区間を押したとき（実績を直す）。予定は taskId が null */
  onPick: (seg: DaySegment) => void
}) {
  const items = useMemo<TimelineItem[]>(
    () =>
      segments.map((seg, i) => ({
        key: `${seg.from}-${seg.to}-${seg.title}-${i}`,
        kind: seg.kind === 'plan' ? 'plan' : 'done',
        title: seg.title,
        from: seg.from,
        to: seg.to,
        color: colorOfGroupName(seg.group),
        sub: '',
        onPick: () => onPick(seg),
        running: seg.live,
      })),
    [segments, colorOfGroupName, onPick],
  )

  if (segments.length === 0) return null

  return <TimelineAxis items={items} workHours={workHours} isToday={isToday} nowMin={nowMin} />
}
