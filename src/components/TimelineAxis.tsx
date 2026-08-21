import { type CSSProperties } from 'react'
import { catStyle } from './CategoryChip'
import { Icon } from './Icon'
import { durationShort, fromMinutes } from '../lib/date'
import { allBreaks, trim, workSegments } from '../lib/workday'
import type { WorkHours } from '../types'

/* =========================================================
 * 縦軸の時間の並び（軸そのもの）
 *
 * 「何をどこに置くか」は呼ぶ側が決め、ここは**置き方だけ**を持つ。
 * スケジュールの DAY（予定・タスク・実績）と、分析の時間帯（実績）が
 * 同じ軸を使う（v1.30.0）。2つの画面で目盛りの形が違うと、
 * 同じ日を見ているのに別の日に見える。
 *
 * 守っていること
 *   - 上から下へ時刻が進む。1時間ごとに目盛りを引く
 *   - **重なった時間は横に並べる**（重ねると下が読めず、押せない）
 *   - 休憩は地を沈めて出す。仕事の面と同じ濃さにしない
 *   - 今日はいまの時刻に線を引く
 *   - 色だけで伝えない。件名・所要時間を必ず添える
 * =======================================================*/

/** 1分あたりの高さ（px）。9時間で 600px 弱に収まる */
export const PX = 1.1
/** 短い予定でも文字が読める最低の高さ */
const MIN_H = 22
/** 左の時刻の目盛りの幅 */
const GUTTER = 42
/** いちばん上の時刻が切れないぶんの余白 */
const TOP_PAD = 8

/**
 * 置くものの種類。地の作りで見分けられるようにしてある（色に頼らない）。
 *   plan  … 予定（斜線）
 *   task  … これからやるタスク（塗り）
 *   done  … 実際に動かした記録＝実績（塗り＋ ✓。v1.30.0）
 *   event … Googleカレンダーの予定（細い斜線）
 */
export type TimelineKind = 'plan' | 'task' | 'done' | 'event'

export interface TimelineItem {
  key: string
  kind: TimelineKind
  title: string
  /** 0時からの分 */
  from: number
  to: number
  /** 区分の色（予定・タスク・実績）。Googleの予定は持たない */
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

export function TimelineAxis({
  items,
  workHours,
  isToday,
  nowMin,
  scale = PX,
}: {
  items: TimelineItem[]
  workHours: WorkHours
  isToday: boolean
  /** いまの時刻（0時からの分） */
  nowMin: number
  /** 1分あたりの高さ（px）。長い期間を出すときに縮める */
  scale?: number
}) {
  const segs = workSegments(workHours)

  if (segs.length === 0) {
    return (
      <p className="tp-empty-body">
        勤務時間の設定が読めません。設定画面で始業と終業を見直してください。
      </p>
    )
  }

  // 出す範囲。始業〜終業を基本に、外で動かしたものがあればそこまで伸ばす
  const workFrom = segs[0].from
  const workTo = segs[segs.length - 1].to
  const from = Math.floor(Math.min(workFrom, ...items.map((i) => i.from)) / 60) * 60
  const to = Math.ceil(Math.max(workTo, ...items.map((i) => i.to)) / 60) * 60
  const height = (to - from) * scale + TOP_PAD + 4
  const y = (min: number) => (min - from) * scale + TOP_PAD

  const hours: number[] = []
  for (let m = from; m <= to; m += 60) hours.push(m)

  const placed = packColumns(items)
  const breaks = allBreaks(workHours)

  return (
    <div className="tp-tline" style={{ height, ['--gutter' as string]: `${GUTTER}px` } as CSSProperties}>
      {/* 地 → 目盛りの順に置く（逆にすると地が目盛りを塗り潰す） */}
      {segs.map((s) => (
        <div
          key={`w-${s.from}`}
          className="tp-tline-work"
          style={{ top: y(s.from), height: (s.to - s.from) * scale }}
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
          style={{ top: y(b.from), height: Math.max(10, (b.to - b.from) * scale) }}
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

      {placed.map(({ item, col, cols }) => {
        const h = Math.max(MIN_H, (item.to - item.from) * scale)
        const span = `${trim(fromMinutes(item.from))}〜${trim(fromMinutes(item.to))}`
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
            aria-label={`${span} ${item.title}${item.kind === 'done' ? '（実績）' : ''}`}
            title={`${span} ${item.title}`}
          >
            {item.kind === 'event' && <Icon name="calendar" size={11} className="tp-tline-ico" />}
            {item.kind === 'done' && <Icon name="check" size={11} className="tp-tline-ico is-done" />}
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
