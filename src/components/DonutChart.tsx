import { useState, type CSSProperties } from 'react'
import { catStyle } from './CategoryChip'
import { durationLabel } from '../lib/date'
import type { DayShare } from '../lib/stats'

/* =========================================================
 * 円グラフ（その日の区分の割合）
 *
 * 【色だけで見分けさせない】
 * 区分の色（tokens.css の --cat-*）は、チップ・絞り込み・棒グラフと
 * 同じものを使う。これは「同じ区分はどこでも同じ色」を優先した配色で、
 * 色覚の型によっては隣り合う色の差が足りない組み合わせがある
 * （藍と菫、緑と海松など）。だから
 *   - 切れのあいだに地の色の隙間を入れる
 *   - 名前と割合を必ず横の一覧に出す（色は目印であって、情報ではない）
 * の2つで補う。数字を読めば、色が見分けられなくても分かる。
 *
 * 【0から100%へ回す】
 * 切れは1つずつ「自分の開始位置から」伸び、開始の遅い切れほど遅れて出る。
 * 結果として、輪が上から時計回りに一周描かれる。
 * 動きは `.tp-reveal` の仕組みに乗せてあるので、画面に入った時に始まる。
 * `prefers-reduced-motion` では動かさず、最初から全部出す。
 * =======================================================*/

/** 円の半径（viewBox 座標）。太さと合わせてドーナツの見え方を決める */
const R = 44
const STROKE = 18
const SIZE = 120
const C = 2 * Math.PI * R
/** 切れのあいだに空ける地の隙間（viewBox 座標。実寸で約2px） */
const GAP = 1.4
/** 一周を描く時間 */
const SWEEP_MS = 900

export function DonutChart({
  slices,
  total,
  centerLabel = '実働',
}: {
  slices: DayShare[]
  /** 合計（分）。真ん中に出す */
  total: number
  centerLabel?: string
}) {
  /** 押して目立たせている切れ。もう一度押すと戻る */
  const [picked, setPicked] = useState<string | null>(null)

  let acc = 0
  const arcs = slices.map((s) => {
    const start = acc
    acc += s.share
    const raw = s.share * C
    // 小さすぎる切れも見えるように、細い線ぶんは残す
    const len = Math.max(1.5, raw - GAP)
    return { s, start, len, delay: Math.round(start * SWEEP_MS), dur: Math.max(120, Math.round(s.share * SWEEP_MS)) }
  })

  return (
    <div className="tp-donut">
      <svg
        className="tp-donut-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`区分ごとの割合。${slices
          .map((s) => `${s.group} ${Math.round(s.share * 100)}%`)
          .join('、')}`}
      >
        <circle className="tp-donut-track" cx={SIZE / 2} cy={SIZE / 2} r={R} strokeWidth={STROKE} />
        {arcs.map(({ s, start, len, delay, dur }) => (
          <circle
            key={s.group}
            className={`tp-donut-seg${picked && picked !== s.group ? ' is-dim' : ''}`}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            strokeWidth={STROKE}
            strokeDasharray={`${len} ${C}`}
            // 自分の開始位置が真上に来るように回してから、0 から伸ばす
            transform={`rotate(${start * 360 - 90} ${SIZE / 2} ${SIZE / 2})`}
            style={
              {
                ...catStyle(s.color),
                // CSS の stroke-dashoffset は長さを取るので px を付ける
                // （単位なしだと宣言ごと捨てられ、動きが出ない）
                '--len': `${len}px`,
                // 伸びる時間と待ち時間は切れごとに違う。薄くする動きのほうは
                // 待たせない（押してから反応するまで間が空くと、押せていないように見える）
                '--dur': `${dur}ms`,
                '--delay': `${delay}ms`,
                strokeDashoffset: 0,
              } as CSSProperties
            }
          >
            <title>{`${s.group} ${Math.round(s.share * 100)}%（${durationLabel(s.minutes)}）`}</title>
          </circle>
        ))}
      </svg>

      <div className="tp-donut-center" aria-hidden="true">
        <b className="tp-mono">{durationLabel(total)}</b>
        <span>{centerLabel}</span>
      </div>

      {/* 名前と割合。色が見分けられなくても、ここを読めば分かる */}
      <ul className="tp-donut-legend">
        {slices.map((s) => (
          <li key={s.group}>
            <button
              type="button"
              className={`tp-donut-row${picked === s.group ? ' is-on' : ''}`}
              aria-pressed={picked === s.group}
              style={catStyle(s.color)}
              onClick={() => setPicked(picked === s.group ? null : s.group)}
            >
              <span className="tp-cat-dot" aria-hidden="true" />
              <span className="tp-donut-name">{s.group}</span>
              <b className="tp-mono tp-donut-pct">{Math.round(s.share * 100)}%</b>
              <span className="tp-mono tp-donut-min">{durationLabel(s.minutes)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
