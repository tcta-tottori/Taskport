import { useMemo, type CSSProperties } from 'react'
import { catStyle } from './CategoryChip'
import { Icon } from './Icon'
import { durationShort, fromMinutes, toMinutes } from '../lib/date'
import { allBreaks, taskMinutes, trim, workSegments } from '../lib/workday'
import { planMinutes } from '../lib/plans'
import { colorOf, primaryCategory } from '../lib/workCategories'
import type {
  CalendarEvent,
  Plan,
  PlanOccurrence,
  Settings,
  Task,
} from '../types'

/* =========================================================
 * その日の時間の並び（縦軸）
 *
 * 勤務時間を上から下へ1本の軸にして、予定とタスクをその時刻の場所に置く。
 * v1.24.0 で、2時間の枠に畳んでいた形（DayBoard）をやめた。
 * 枠に畳むと「何時から何時まで空いているか」が読めず、
 * 枠の切れ目をまたぐ予定の置き場が決められなかった（利用者の指摘）。
 *
 * 守っていること
 *   - **重なった時間は横に並べる**（時間帯の帯と同じ考え。`packLanes`）
 *   - 休憩は地を沈めて出す。仕事の面と同じ濃さにしない
 *   - 今日はいまの時刻に線を引く
 *   - 色だけで伝えない。件名・所要時間を必ず添える
 *
 * v1.27.0（利用者の指示）で、1件を**1行**にした。
 * 「10:00–10:15」と件名を2行に積むと、短い予定では件名が枠から切れて読めない。
 * 始まりの時刻は軸の位置が示すので、行には**件名＋所要時間**だけを置く
 * （「所要確認 15min」。時間は薄く小さく、件名を食わない）。
 * =======================================================*/

/** 1分あたりの高さ（px）。9時間で 600px 弱に収まる */
const PX = 1.1
/** 短い予定でも文字が読める最低の高さ。1行になったぶん下げてある */
const MIN_H = 22
/** 左の時刻の目盛りの幅 */
const GUTTER = 42
/** いちばん上の時刻が切れないぶんの余白 */
const TOP_PAD = 8

export type TimelineKind = 'plan' | 'task' | 'event'

export interface TimelineItem {
  key: string
  kind: TimelineKind
  title: string
  /** 0時からの分 */
  from: number
  to: number
  /** 区分の色（予定・タスク）。Googleの予定は持たない */
  color: string | null
  /** 右に出す小さい字（場所・優先度など） */
  sub: string
  /** 押したとき */
  onPick: () => void
  /** 時刻が決まっていない（見込みで置いただけ） */
  loose?: boolean
  running?: boolean
}

/** 重なるものを横に分ける。早く始まったものから、空いている列へ入れる。 */
export function packColumns(items: TimelineItem[]): { item: TimelineItem; col: number; cols: number }[] {
  const sorted = [...items].sort((a, b) => a.from - b.from || b.to - a.to)
  const ends: number[] = []
  const placed = sorted.map((item) => {
    let col = ends.findIndex((end) => end <= item.from)
    if (col < 0) {
      col = ends.length
      ends.push(item.to)
    } else {
      ends[col] = item.to
    }
    return { item, col }
  })
  const cols = Math.max(1, ends.length)
  return placed.map((p) => ({ ...p, cols }))
}

export function DayTimeline({
  tasks,
  occurrences,
  events,
  settings,
  isToday,
  nowMin,
  onEdit,
  onEditPlan,
  onImportEvent,
}: {
  /** その日が期限のタスク（未完了・完了とも受け取り、未完了だけ置く） */
  tasks: Task[]
  occurrences: PlanOccurrence[]
  events: CalendarEvent[]
  settings: Settings
  isToday: boolean
  nowMin: number
  onEdit: (task: Task) => void
  onEditPlan: (plan: Plan) => void
  onImportEvent: (ev: CalendarEvent) => void
}) {
  const wh = settings.workHours
  const segs = workSegments(wh)

  const items = useMemo<TimelineItem[]>(() => {
    const out: TimelineItem[] = []
    for (const o of occurrences) {
      if (o.plan.allDay) continue
      const from = toMinutes(o.plan.startTime ?? '')
      if (from === null) continue
      out.push({
        key: o.key,
        kind: 'plan',
        title: o.plan.title,
        from,
        to: from + planMinutes(o.plan),
        color: colorOf(settings.categoryGroups, primaryCategory(o.plan.categories)),
        sub: o.plan.place,
        onPick: () => onEditPlan(o.plan),
      })
    }
    for (const t of tasks) {
      if (t.status === 'done') continue
      const from = t.dueTime ? toMinutes(t.dueTime) : null
      if (from === null) continue
      out.push({
        key: t.id,
        kind: 'task',
        title: t.title,
        from,
        to: from + taskMinutes(t, settings.defaultEstimateMin),
        color: colorOf(settings.categoryGroups, primaryCategory(t.categories)),
        sub: '',
        onPick: () => onEdit(t),
        running: !!t.startedAt,
      })
    }
    for (const e of events) {
      if (e.allDay || !e.startTime) continue
      const from = toMinutes(e.startTime)
      if (from === null) continue
      const to = e.endTime ? (toMinutes(e.endTime) ?? from + 60) : from + 60
      out.push({
        key: `ev:${e.id}`,
        kind: 'event',
        title: e.title,
        from,
        to: Math.max(to, from + 15),
        color: null,
        sub: e.location,
        onPick: () => onImportEvent(e),
      })
    }
    return out
  }, [tasks, occurrences, events, settings, onEdit, onEditPlan, onImportEvent])

  if (segs.length === 0) {
    return (
      <p className="tp-empty-body">
        勤務時間の設定が読めません。設定画面で始業と終業を見直してください。
      </p>
    )
  }

  // 出す範囲。始業〜終業を基本に、外で入っているものがあればそこまで伸ばす
  const workFrom = segs[0].from
  const workTo = segs[segs.length - 1].to
  const from = Math.floor(Math.min(workFrom, ...items.map((i) => i.from)) / 60) * 60
  const to = Math.ceil(Math.max(workTo, ...items.map((i) => i.to)) / 60) * 60
  const height = (to - from) * PX + TOP_PAD + 4
  const y = (min: number) => (min - from) * PX + TOP_PAD

  const hours: number[] = []
  for (let m = from; m <= to; m += 60) hours.push(m)

  const placed = packColumns(items)
  const breaks = allBreaks(wh)

  return (
    <div className="tp-tline" style={{ height, ['--gutter' as string]: `${GUTTER}px` } as CSSProperties}>
      {/* 地 → 目盛りの順に置く（逆にすると地が目盛りを塗り潰す） */}
      {segs.map((s) => (
        <div
          key={`w-${s.from}`}
          className="tp-tline-work"
          style={{ top: y(s.from), height: (s.to - s.from) * PX }}
          aria-hidden="true"
        />
      ))}

      {/* 左の時刻の帯。目盛りの数字はここに出す */}
      <div className="tp-tline-gutter" aria-hidden="true" />

      {/* 目盛り（1時間ごと） */}
      {hours.map((m) => (
        <div key={m} className="tp-tline-hour" style={{ top: y(m) }}>
          <span className="tp-mono">{trim(fromMinutes(m))}</span>
        </div>
      ))}

      {/* 休憩 */}
      {breaks.map((b) => (
        <div
          key={`b-${b.from}`}
          className="tp-tline-break"
          style={{ top: y(b.from), height: Math.max(10, (b.to - b.from) * PX) }}
        >
          <span>{b.to - b.from >= 20 ? '昼休憩' : '休憩'}</span>
        </div>
      ))}

      {/* いまの時刻 */}
      {isToday && nowMin >= from && nowMin <= to && (
        <div className="tp-tline-now" style={{ top: y(nowMin) }} aria-label="いまの時刻">
          <b className="tp-mono">{trim(fromMinutes(nowMin))}</b>
        </div>
      )}

      {/* 予定・タスク */}
      {placed.map(({ item, col, cols }) => {
        const h = Math.max(MIN_H, (item.to - item.from) * PX)
        // 行に時刻は出さない（軸の位置が示す）。読み上げと吹き出しにだけ時刻を添える。
        return (
          <button
            key={item.key}
            type="button"
            className={`tp-tline-item is-${item.kind}${item.running ? ' is-running' : ''}`}
            style={
              {
                top: y(item.from),
                height: h,
                left: `calc(var(--gutter) + (100% - var(--gutter)) * ${col / cols})`,
                width: `calc((100% - var(--gutter)) / ${cols} - 4px)`,
                ...(item.color ? catStyle(item.color as never) : {}),
              } as CSSProperties
            }
            onClick={item.onPick}
            aria-label={`${trim(fromMinutes(item.from))}〜${trim(fromMinutes(item.to))} ${item.title}`}
            title={`${trim(fromMinutes(item.from))}〜${trim(fromMinutes(item.to))} ${item.title}`}
          >
            {item.kind === 'event' && <Icon name="calendar" size={11} className="tp-tline-ico" />}
            <span className="tp-tline-title">
              {item.title}
              {item.sub && <small className="tp-tline-sub">／ {item.sub}</small>}
            </span>
            <span className="tp-tline-min tp-mono">{durationShort(item.to - item.from)}</span>
          </button>
        )
      })}
    </div>
  )
}
