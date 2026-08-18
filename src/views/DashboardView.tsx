import { useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { Reveal } from '../components/Reveal'
import { durationLabel, formatMDShort } from '../lib/date'
import {
  categoryMinutes,
  categoryStats,
  computeStreak,
  dailyPoints,
  overview,
  priorityDist,
  sourceStats,
  trimLeadingEmpty,
  workloadOf,
  type DayPoint,
} from '../lib/stats'
import { workHoursSummary } from '../lib/workday'
import { addDaysKey } from '../lib/date'
import { PRIORITIES, PRIORITY_LABEL, SOURCE_LABEL, type Settings, type Task } from '../types'

/* =========================================================
 * 分析ビュー
 *
 * グラフの作りは StudyDeck の成績画面に合わせている。
 *   - 棒＋折れ線を1つの図にまとめ、横軸に日付を明示する
 *   - 棒は下から伸び、折れ線は左から描かれ、点は線の進行に合わせて出る
 *   - 目標線を1本引き、達成／未達が一目で分かるようにする
 * 数値の集計は lib/stats.ts に置き、ここは並べるだけにする。
 * =======================================================*/

export function DashboardView({
  tasks,
  today,
  settings,
}: {
  tasks: Task[]
  today: string
  settings: Settings
}) {
  const ov = useMemo(() => overview(tasks, today), [tasks, today])
  const cats = useMemo(() => categoryStats(tasks), [tasks])
  const pri = useMemo(() => priorityDist(tasks), [tasks])
  const srcs = useMemo(() => sourceStats(tasks), [tasks])
  const streak = useMemo(() => computeStreak(tasks, today), [tasks, today])
  const load = useMemo(() => workloadOf(tasks, today, settings), [tasks, today, settings])
  const allDays = useMemo(() => trimLeadingEmpty(dailyPoints(tasks, 90, today)), [tasks, today])
  // 日報の集計と同じ見方（大分類ごとの時間と構成比）。直近10日ぶん。
  const spent = useMemo(
    () => categoryMinutes(tasks, addDaysKey(today, -9), today, settings.defaultEstimateMin),
    [tasks, today, settings.defaultEstimateMin],
  )
  const wh = workHoursSummary(settings.workHours)

  const pct = Math.round(load.ratio * 100)
  const capacityOk = load.over === 0

  if (tasks.length === 0) {
    return (
      <div className="tp-view">
        <div className="tp-empty">
          <Icon name="chart" size={26} />
          <p className="tp-empty-head">まだ集計するデータがありません</p>
          <p className="tp-empty-body">
            タスクを登録して完了にしていくと、日ごとの推移と区分ごとの偏りがここに出ます。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="tp-view tp-dash tp-grid">
      <Reveal>
        <section className="tp-panel tp-dash-hero is-wide">
          <div className="tp-panel-head">
            <h2>本日の稼働</h2>
            <span className="tp-chip-flame">
              <Icon name="flame" size={13} /> 連続{streak}日
            </span>
          </div>
          <div className="tp-hero-row">
            <div className={`tp-hero-num${capacityOk ? '' : ' is-over'}`}>
              {pct}
              <small>%</small>
            </div>
            <div className="tp-hero-side">
              <p className="tp-mono">{durationLabel(load.planned)} / {durationLabel(load.capacity)}</p>
              <p className="tp-hero-hours">
                {wh.span}
                {wh.breakSpan && ` ／ 昼 ${wh.breakSpan}`}
              </p>
            </div>
          </div>
          <div className="tp-progress tp-progress-lg">
            <span
              className={pct > 100 ? 'is-over' : pct > 80 ? 'is-tight' : ''}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <p className="tp-hero-note">
            {capacityOk
              ? `実働 ${durationLabel(load.capacity)} に対し ${durationLabel(load.capacity - load.planned)} 空いています。`
              : `実働 ${durationLabel(load.capacity)} を ${durationLabel(load.over)} 超えています。`}
          </p>

          <div className="tp-statrow">
            <Stat label="未完了" value={ov.open} />
            <Stat label="超過" value={ov.overdue} tone={ov.overdue > 0 ? 'bad' : undefined} />
            <Stat label="今週" value={ov.weekOpen} />
            <Stat label="完了" value={ov.done} tone="good" />
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="tp-panel is-wide">
          {allDays.length > 0 ? (
            <TrendCard allDays={allDays} />
          ) : (
            <>
              <h2 className="tp-panel-title">処理の推移</h2>
              <p className="tp-empty-body">
                登録と完了を続けると、日ごとの件数と消化率の推移が出ます。
              </p>
            </>
          )}
        </section>
      </Reveal>

      <Reveal>
        <section className="tp-panel is-wide">
          <div className="tp-panel-head">
            <h2>区分ごとの時間</h2>
            <span className="tp-badge tp-mono">直近10日</span>
          </div>
          {spent.total === 0 ? (
            <p className="tp-empty-body">
              完了したタスクがまだありません。区分と見込み時間を入れて完了にすると、
              日報と同じ形で時間の配分が見えます。
            </p>
          ) : (
            <>
              {spent.groups.map((g) => (
                <div className="tp-bar-item" key={g.group}>
                  <div className="tp-bar-head">
                    <span>{g.group}</span>
                    <span className="tp-muted tp-mono">
                      {durationLabel(g.minutes)}（{Math.round(g.share * 100)}%）
                    </span>
                  </div>
                  <div className="tp-bar-track">
                    <div
                      className="tp-bar-fill"
                      style={{ width: `${Math.round(g.share * 100)}%`, background: 'var(--chart-bar)' }}
                    />
                  </div>
                  <ul className="tp-bar-items">
                    {g.items.map((it) => (
                      <li key={it.category}>
                        <span>{it.category}</span>
                        <span className="tp-mono">{durationLabel(it.minutes)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="tp-muted tp-small">
                合計 {durationLabel(spent.total)}。
                これは<b>完了したタスクの見込み時間</b>の集計で、実際にかかった時間ではありません。
              </p>
            </>
          )}
        </section>
      </Reveal>

      <Reveal>
        <section className="tp-panel">
          <h2 className="tp-panel-title">区分ごとの進み具合</h2>
          {cats.length === 0 && <p className="tp-empty-body">区分のついたタスクがありません。</p>}
          {cats.map((c) => {
            const p = Math.round(c.rate * 100)
            return (
              <div className="tp-bar-item" key={c.category}>
                <div className="tp-bar-head">
                  <span>{c.category}</span>
                  <span className="tp-muted tp-mono">
                    残{c.open} / 全{c.total}（{p}%完了）
                  </span>
                </div>
                <div className="tp-bar-track">
                  <div
                    className="tp-bar-fill"
                    style={{
                      width: `${p}%`,
                      background:
                        p >= 70 ? 'var(--chart-good)' : p >= 40 ? 'var(--chart-warn)' : 'var(--chart-bad)',
                    }}
                  />
                </div>
              </div>
            )
          })}
        </section>
      </Reveal>

      <Reveal>
        <section className="tp-panel">
          <h2 className="tp-panel-title">未完了の優先度分布</h2>
          <PriorityBars dist={pri} />
          <p className="tp-muted tp-small">
            高が積み上がっているときは、期限をずらすより先に減らす対象を決めてください。
          </p>
        </section>
      </Reveal>

      <Reveal>
        <section className="tp-panel">
          <h2 className="tp-panel-title">どの入口から入ったか</h2>
          <SourceBar stats={srcs} total={tasks.length} />
          <p className="tp-muted tp-small">
            使われている入口が分かると、次に手を入れる入口を決められます。
          </p>
        </section>
      </Reveal>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return (
    <div className={`tp-stat${tone ? ` is-${tone}` : ''}`}>
      <b className="tp-mono">{value}</b>
      <span>{label}</span>
    </div>
  )
}

/* ---------------------------------------------------------
 * 日別の推移カード（表示日数をスライダーで切り替え）
 * ------------------------------------------------------- */

function TrendCard({ allDays }: { allDays: DayPoint[] }) {
  const maxRange = allDays.length
  const minRange = Math.min(3, maxRange)
  const [range, setRange] = useState(Math.max(minRange, Math.min(14, maxRange)))
  const shown = Math.min(range, maxRange)
  const days = allDays.slice(-shown)
  const pct = maxRange > minRange ? ((shown - minRange) / (maxRange - minRange)) * 100 : 100
  const style = { '--pct': `${pct}%` } as CSSProperties

  return (
    <>
      <div className="tp-trend-head">
        <h2 className="tp-panel-title">処理の推移</h2>
        {maxRange > minRange && (
          <label className="tp-trend-range" title="表示する日数">
            <input
              type="range"
              min={minRange}
              max={maxRange}
              value={range}
              style={style}
              aria-label="表示する日数"
              onChange={(e) => setRange(Number(e.target.value))}
            />
            <span className="tp-mono">{shown}日</span>
          </label>
        )}
      </div>
      <Trend days={days} />
    </>
  )
}

/**
 * 1つの図に「完了件数（棒）」と「消化率（折れ線）」をまとめ、日付の横軸を明示する。
 * 左軸＝件数、右軸＝%。完了8件＝消化率80% が同じ高さの目標線に来るよう軸を揃える。
 */
function Trend({ days }: { days: DayPoint[] }) {
  const n = days.length
  const W = 340
  const H = 182
  const padL = 26
  const padR = 34
  const padTop = 30
  const axisY = 150
  const plotH = axisY - padTop
  const slot = (W - padL - padR) / n
  const cx = (i: number) => padL + slot * i + slot / 2
  const bw = Math.max(2, Math.min(18, slot - 4))

  // 左軸（件数）と右軸（%）を1本の目標線で結ぶ。
  // 目標線は右軸80%の高さに引き、左軸ではその高さに当たる件数を出す。
  // 上限は件数の最大値に合わせて伸ばす（伸ばさないと多い日の棒が黙って切れる）。
  const maxDone = Math.max(0, ...days.map((d) => d.done))
  const countMax = Math.max(10, Math.ceil(maxDone / 5) * 5)
  const goalCount = Math.round(countMax * 0.8)
  const gridY = (c: number) => axisY - (c / countMax) * plotH
  const barTop = (c: number) => Math.max(padTop, gridY(c))
  const rateY = (p: number) => axisY - (p / 100) * plotH
  const gridCounts = [Math.round(countMax / 2), countMax]

  const pts = days.map((d, i) => ({ i, x: cx(i), has: d.rate !== null, rate: d.rate ?? 0 }))

  // 折れ線は1本のパスにまとめる（データのない日はまたがず M で切る）
  let path = ''
  let pen = false
  for (const p of pts) {
    if (p.has) {
      path += `${pen ? 'L' : 'M'}${p.x},${rateY(p.rate)} `
      pen = true
    } else {
      pen = false
    }
  }

  const frac = (i: number) => (n > 1 ? i / (n - 1) : 0)
  const barDelay = (i: number) => 0.05 + frac(i) * 0.5
  const dotDelay = (i: number) => 0.2 + frac(i) * 0.85

  // 横軸ラベルは重ならない範囲でできるだけ多く出す
  const maxLabels = Math.max(2, Math.floor((W - padL - padR) / 40))
  const labelCount = Math.min(maxLabels, n)
  const labelIdx = [
    ...new Set(
      Array.from({ length: labelCount }, (_, k) =>
        Math.round((k * (n - 1)) / Math.max(1, labelCount - 1)),
      ),
    ),
  ]

  return (
    <svg className="tp-trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="日別の完了件数と消化率の推移">
      {/* 凡例 */}
      <rect x={padL} y={8} width={10} height={10} rx={2} className="tp-t-bar" />
      <text x={padL + 15} y={17} className="tp-t-leg">完了</text>
      <line x1={padL + 62} y1={13} x2={padL + 84} y2={13} className="tp-t-line" />
      <circle cx={padL + 73} cy={13} r={3.5} className="tp-t-dot ok" />
      <text x={padL + 89} y={17} className="tp-t-leg">消化率</text>

      {/* 補助線（左軸＝件数） */}
      {gridCounts.map((c) => (
        <line key={c} x1={padL} y1={gridY(c)} x2={W - padR} y2={gridY(c)} className="tp-t-grid" />
      ))}
      {gridCounts.map((c) => (
        <text key={`l${c}`} x={padL - 4} y={gridY(c) + 3} className="tp-t-tick" textAnchor="end">
          {c}
        </text>
      ))}

      {/* 目標線: 消化率80%（左軸ではその高さに当たる件数） */}
      <line x1={padL} y1={rateY(80)} x2={W - padR} y2={rateY(80)} className="tp-t-guide" />
      <text x={padL - 4} y={rateY(80) + 3} className="tp-t-goal" textAnchor="end">{goalCount}</text>
      <text x={W - padR + 4} y={rateY(80) + 3} className="tp-t-goal" textAnchor="start">80</text>

      <text x={4} y={padTop - 8} className="tp-t-tick">件</text>
      <text x={padL - 4} y={axisY} className="tp-t-tick" textAnchor="end">0</text>
      <text x={W - padR + 4} y={padTop + 3} className="tp-t-tick" textAnchor="start">100%</text>

      {/* 完了件数（棒） */}
      {days.map((d, i) =>
        d.done > 0 ? (
          <rect
            key={d.key}
            x={cx(i) - bw / 2}
            y={barTop(d.done)}
            width={bw}
            height={axisY - barTop(d.done)}
            rx={2.5}
            className="tp-t-bar tp-t-bar-col"
            style={{ animationDelay: `${barDelay(i)}s` }}
          />
        ) : null,
      )}

      <line x1={padL} y1={axisY} x2={W - padR} y2={axisY} className="tp-t-axis" />

      {path && <path d={path} pathLength={100} className="tp-t-line tp-t-line-anim" />}
      {pts.map((p) =>
        p.has ? (
          <circle
            key={p.i}
            cx={p.x}
            cy={rateY(p.rate)}
            r={4}
            className={`tp-t-dot tp-t-dot-pt ${p.rate >= 80 ? 'ok' : 'ng'}`}
            style={{ animationDelay: `${dotDelay(p.i)}s` }}
          />
        ) : null,
      )}

      {labelIdx.map((i) => (
        <text key={i} x={cx(i)} y={axisY + 16} className="tp-t-xlabel" textAnchor="middle">
          {formatMDShort(days[i].key)}
        </text>
      ))}
    </svg>
  )
}

/** 未完了の優先度分布。左が高、右が低。棒は下から伸びる。 */
function PriorityBars({ dist }: { dist: Record<'high' | 'mid' | 'low', number> }) {
  const max = Math.max(1, ...PRIORITIES.map((p) => dist[p]))
  return (
    <div className="tp-pri-bars">
      {PRIORITIES.map((p) => (
        <div key={p} className="tp-pri-col">
          <div className="tp-pri-slot">
            <div
              className={`tp-pri-bar tp-pri-${p}`}
              style={{ height: `${Math.max(4, (dist[p] / max) * 100)}%` }}
            />
          </div>
          <b className="tp-mono">{dist[p]}</b>
          <span>{PRIORITY_LABEL[p]}</span>
        </div>
      ))}
    </div>
  )
}

/** 入口別の内訳を1本の積み上げ帯で見せる */
function SourceBar({
  stats,
  total,
}: {
  stats: { source: keyof typeof SOURCE_LABEL; count: number }[]
  total: number
}) {
  if (total === 0) return <p className="tp-empty-body">データがありません。</p>
  return (
    <>
      <div className="tp-stack" role="img" aria-label="入口ごとの件数の内訳">
        {stats.map((s, i) => (
          <span
            key={s.source}
            className={`tp-stack-seg tp-src-${s.source}`}
            style={{ width: `${(s.count / total) * 100}%`, animationDelay: `${0.06 * i}s` }}
          />
        ))}
      </div>
      <ul className="tp-legend">
        {stats.map((s) => (
          <li key={s.source}>
            <i className={`tp-src-${s.source}`} aria-hidden="true" />
            {SOURCE_LABEL[s.source]}
            <b className="tp-mono">{s.count}</b>
          </li>
        ))}
      </ul>
    </>
  )
}
