import { useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { Reveal } from '../components/Reveal'
import { Segmented } from '../components/Segmented'
import { CategoryChip } from '../components/CategoryChip'
import { addDaysKey, durationLabel, formatMD, formatMDShort } from '../lib/date'
import {
  categoryStats,
  computeStreak,
  overview,
  pointsBetween,
  priorityDist,
  sourceStats,
  type DayPoint,
} from '../lib/stats'
import {
  analyzeRange,
  estimateStats,
  minutesByDay,
  periodOf,
  shiftAnchor,
  SPANS,
  toSlices,
  type Span,
} from '../lib/analysis'
import { workHoursSummary, workMinutes } from '../lib/workday'
import { DonutChart } from '../components/DonutChart'
import { HourBars } from '../components/HourBars'
import { colorOf, colorOfGroup, groupOf, primaryCategory } from '../lib/workCategories'
import { logDay, timed } from '../lib/worklog'
import { jobLabel, NO_JOB, sortJobs } from '../lib/jobs'
import { DayBand } from '../components/DayBand'
import { ActualSheet } from './ActualSheet'
import { BandSheet, bandRows } from './BandSheet'
import {
  DASH_LABEL,
  DEFAULT_DASH_ORDER,
  moveCard,
  normalizeDashOrder,
  type DashCard,
} from '../lib/dashCards'
import {
  PRIORITIES,
  PRIORITY_LABEL,
  RUN_KEEP_DAYS,
  SOURCE_LABEL,
  type Job,
  type Plan,
  type Settings,
  type Task,
  type WorkRun,
} from '../types'

/* =========================================================
 * 分析ビュー
 *
 * v1.30.0（利用者の指示）で作りを変えた。
 *   - **いちばん上に期間の切り替え**（日／週／月／全体）と、前後の送り。
 *     どの面も同じ期間で描くので、上を1回押せば画面ぜんぶが同じ期間になる
 *   - 面の並びは 区分の割合 → 時間帯 → 区分ごとの時間 → 推移 → …
 *   - 時間帯は**縦軸**（`DayBand`）。週・月・全体では時刻ごとの合計（`HourBars`）
 *   - 「やったことを足す」はここに置かない（スケジュールの DAY にある）
 *   - 工数（案件ごと）は専用の画面をやめてここへ入れた
 *
 * 数えるのは**実際に押して測った時間だけ**。集計は lib/analysis.ts に置き、
 * ここは並べるだけにする。グラフの作りは StudyDeck の成績画面に合わせている。
 * =======================================================*/

export function DashboardView({
  tasks,
  plans,
  runs,
  jobs,
  today,
  nowMin,
  settings,
  onPatch,
  onSaveOrder,
  onNewJob,
  onEditJob,
  onAssignJob,
}: {
  tasks: Task[]
  /** 予定。実行の記録を通してのみ数える（入れただけの予定は0分） */
  plans: Plan[]
  /** 実行の記録。実測だけで数えるために使う */
  runs: WorkRun[]
  /** 案件（工数の単位） */
  jobs: Job[]
  today: string
  /** いまの時刻（0時からの分）。今日の軸に線を引くのに使う */
  nowMin: number
  settings: Settings
  /** 実績（かかった時間・開始時刻）を直す */
  onPatch: (task: Task, patch: Partial<Task>) => void
  /** 面の並びを保存する（設定が持つ） */
  onSaveOrder: (order: string[]) => void
  onNewJob: () => void
  onEditJob: (job: Job) => void
  /** タスクを案件に入れる／外す */
  onAssignJob: (task: Task, jobId: string | null) => void
}) {
  /** 期間の単位と、期間の中の1日（送りはこれを動かす） */
  const [span, setSpan] = useState<Span>('day')
  const [anchor, setAnchor] = useState(today)
  /** 実績を直す画面。開いている区分（または1件）。
      仕事は**IDで持つ**（実物を持つと、直したあとも古い値のままになる） */
  const [fixing, setFixing] = useState<{ title?: string; ids: string[] } | null>(null)
  /** 時間帯のポップアップ。focus は帯を押して開いたときの区間 */
  const [banding, setBanding] = useState<{ focus: string | null } | null>(null)
  /** 並べ替え中か。押している間だけ各カードに ↑↓ が出る */
  const [sorting, setSorting] = useState(false)

  /** 面の並び。保存されたものを、いまあるカードに合わせて整える */
  const order = useMemo(() => normalizeDashOrder(settings.dashOrder), [settings.dashOrder])
  const saveOrder = (next: DashCard[]) => onSaveOrder(next)

  /** 記録のいちばん古い日。「全体」の始まりに使う */
  const firstDay = useMemo(() => {
    let first = today
    for (const t of tasks) {
      const d = logDay(t) ?? t.createdAt.slice(0, 10)
      if (d && d < first) first = d
    }
    for (const r of runs) if (r.day < first) first = r.day
    return first
  }, [tasks, runs, today])

  const period = useMemo(
    () => periodOf(span, anchor, today, firstDay),
    [span, anchor, today, firstDay],
  )
  const stats = useMemo(
    () => analyzeRange({ tasks, plans, runs, period, settings }),
    [tasks, plans, runs, period, settings],
  )
  const est = useMemo(
    () => estimateStats(tasks, period.from, period.to, settings.categoryGroups),
    [tasks, period.from, period.to, settings.categoryGroups],
  )
  const slices = useMemo(
    () => toSlices(stats.groups, settings.categoryGroups),
    [stats.groups, settings.categoryGroups],
  )
  /** その期間の帯（1日ぶんのときだけ実物の並びにできる） */
  const band = useMemo(() => timed(stats.entries), [stats.entries])
  /** その期間に数えた仕事。実績を直せる相手 */
  const fixable = useMemo(() => {
    const ids = new Set(stats.entries.map((e) => e.taskId).filter((id): id is string => !!id))
    return tasks.filter((t) => ids.has(t.id))
  }, [stats.entries, tasks])

  /** 実績を直す相手。台帳から引き直す（直した値がその場で欄に返る） */
  const fixingTasks = useMemo(() => {
    if (!fixing) return []
    const ids = new Set(fixing.ids)
    return tasks.filter((t) => ids.has(t.id))
  }, [fixing, tasks])

  const ov = useMemo(() => overview(tasks, today), [tasks, today])
  const cats = useMemo(() => categoryStats(tasks), [tasks])
  const pri = useMemo(() => priorityDist(tasks), [tasks])
  const srcs = useMemo(() => sourceStats(tasks), [tasks])
  const streak = useMemo(() => computeStreak(tasks, today), [tasks, today])
  // 推移は期間ぶん。1日だけを見ているときは、その日までの2週間を出す
  const trendFrom = useMemo(() => {
    const from = period.span === 'day' ? addDaysKey(period.to, -13) : period.from
    const capped = period.days.length > 180 ? addDaysKey(period.to, -179) : from
    return capped > from ? capped : from
  }, [period])
  const trendDays = useMemo(
    () => pointsBetween(tasks, trendFrom, period.to),
    [tasks, trendFrom, period.to],
  )
  /** 推移の下に添える「その日に測った時間」。期間より長い範囲を数える */
  const trendMinutes = useMemo(
    () => minutesByDay(tasks, runs, trendFrom, period.to),
    [tasks, runs, trendFrom, period.to],
  )

  const wh = workHoursSummary(settings.workHours)
  const pct = stats.capacity > 0 ? Math.round((stats.total / stats.capacity) * 100) : 0
  const capacityOk = stats.total <= stats.capacity
  const groupOfTask = (t: Task) => groupOf(settings.categoryGroups, primaryCategory(t.categories))

  const empty = tasks.length === 0 && runs.length === 0

  /** 期間の切り替えと送り。どの面よりも上に置く（v1.30.0。利用者の指示） */
  const top = (
    <div className="tp-dash-top is-wide">
      <Segmented
        items={SPANS}
        value={span}
        onChange={(v) => setSpan(v as Span)}
        ariaLabel="集計する期間"
      />
      <div className="tp-period">
        <button
          type="button"
          className="tp-icon-btn"
          aria-label="前へ"
          disabled={span === 'all'}
          onClick={() => setAnchor(shiftAnchor(span, anchor, -1))}
        >
          <Icon name="chevron" size={18} className="tp-flip" />
        </button>
        <b className="tp-mono tp-period-label">{period.label}</b>
        <button
          type="button"
          className="tp-icon-btn"
          aria-label="次へ"
          disabled={span === 'all' || !period.hasNext}
          onClick={() => setAnchor(shiftAnchor(span, anchor, 1))}
        >
          <Icon name="chevron" size={18} />
        </button>
        {span !== 'all' && period.hasNext && (
          <button type="button" className="tp-link" onClick={() => setAnchor(today)}>
            今日へ
          </button>
        )}
      </div>
      <p className="tp-period-sub tp-mono">
        {span === 'day'
          ? `${durationLabel(stats.total)}／記録 ${stats.count}件`
          : `${formatMDShort(period.from)}〜${formatMDShort(period.to)}／${durationLabel(stats.total)}・記録 ${stats.count}件`}
      </p>
    </div>
  )

  if (empty) {
    return (
      <div className="tp-view tp-dash tp-grid">
        {top}
        <div className="tp-empty">
          <Icon name="chart" size={26} />
          <p className="tp-empty-head">まだ集計するデータがありません</p>
          <p className="tp-empty-body">
            実行の画面で「始める」を押すと、押した時刻から止めた時刻までがここに並びます。
            会議や電話など、台帳に無いまま終わった仕事は、スケジュールの DAY にある
            「やったことを足す」から入れられます。
          </p>
        </div>
      </div>
    )
  }

  /** 1枚ぶんの中身。並びは設定が持つので、ここでは鍵から引くだけにする */
  const cardOf = (key: DashCard, bar: ReactNode): ReactNode => {
    switch (key) {
      case 'share':
        return (
          <section className="tp-panel is-wide">
            {bar}
            <div className="tp-panel-head">
              <h2>区分の割合</h2>
              <span className="tp-badge tp-mono">{period.label}</span>
            </div>

            {stats.total === 0 ? (
              <p className="tp-empty-body">
                この期間に数えた時間がありません。実行の画面で「始める」を押すか、
                スケジュールの DAY で「やったことを足す」と出ます。
              </p>
            ) : (
              <>
                <DonutChart
                  slices={slices}
                  total={stats.total}
                  centerLabel="実測"
                  onPick={(group) =>
                    setFixing({
                      title: group,
                      ids: fixable.filter((t) => groupOfTask(t) === group).map((t) => t.id),
                    })
                  }
                />
                <p className="tp-hint">
                  実際に押して数えた時間だけで出しています
                  {stats.planMinutes > 0 && `（うち予定 ${durationLabel(stats.planMinutes)}）`}。
                  {stats.unmeasured > 0 &&
                    ` この期間に済ませた仕事のうち ${stats.unmeasured}件は時間を数えていません（入れていません）。`}
                  {' '}区分を押すと、その仕事の実績を直せます。
                </p>
              </>
            )}
          </section>
        )

      case 'band':
        return (
          <section className="tp-panel is-wide tp-band-card">
            {bar}
            <div className="tp-panel-head">
              <h2>時間帯</h2>
              {period.single ? (
                <button
                  type="button"
                  className="tp-btn-ghost tp-btn-sm"
                  onClick={() => setBanding({ focus: null })}
                  disabled={band.length === 0}
                >
                  <Icon name="search" size={14} />
                  大きく見る
                </button>
              ) : (
                <span className="tp-badge tp-mono">時刻ごとの合計</span>
              )}
            </div>

            {stats.total === 0 ? (
              <p className="tp-empty-body">
                この期間はまだ動かした記録がありません。実行の画面で「始める」を押すと、
                押した時刻から止めた時刻までがここに並びます。
              </p>
            ) : period.single ? (
              <>
                <DayBand
                  segments={band}
                  workHours={settings.workHours}
                  isToday={period.from === today}
                  nowMin={nowMin}
                  colorOfGroupName={(g) => colorOfGroup(settings.categoryGroups, g)}
                  onPick={(seg) => setBanding({ focus: bandRows(band).find((r) => r.seg === seg)?.key ?? null })}
                />
                <p className="tp-hint">
                  {formatMD(period.from)}／押した時刻から止めた時刻まで。
                  同時に動かしたぶんは横に並べています。
                  <b>押すと実績（開始時刻・かかった時間）を直せます。</b>
                  {stats.untimedMinutes > 0 &&
                    ` 開始時刻の分からない実績 ${durationLabel(stats.untimedMinutes)} は、ここには置いていません。`}
                </p>
              </>
            ) : (
              <>
                <HourBars
                  byHour={stats.byHour}
                  workHours={settings.workHours}
                  days={Math.max(1, stats.activeDays)}
                />
                <p className="tp-hint">
                  何時に手が動いていたかの合計です（記録のあった {stats.activeDays}日ぶん）。
                  日をまたぐので実物の並びにはできません。1日ずつ見るときは上の「日」へ。
                </p>
              </>
            )}
          </section>
        )

      case 'catTime':
        return (
          <section className="tp-panel is-wide">
            {bar}
            <div className="tp-panel-head">
              <h2>区分ごとの時間</h2>
              <span className="tp-badge tp-mono">{durationLabel(stats.total)}</span>
            </div>
            {stats.groups.length === 0 ? (
              <p className="tp-empty-body">
                この期間に数えた時間がありません。区分を付けて時間を測ると、
                日報と同じ形で配分が見えます。
              </p>
            ) : (
              <>
                {stats.groups.map((g) => (
                  <div className="tp-bar-item" key={g.group}>
                    <div className="tp-bar-head">
                      <span className="tp-bar-name">
                        <span
                          className="tp-cat-dot"
                          style={{ '--cat': `var(--cat-${g.color})` } as CSSProperties}
                          aria-hidden="true"
                        />
                        {g.group}
                      </span>
                      <span className="tp-muted tp-mono">
                        {durationLabel(g.minutes)}（{Math.round(g.share * 100)}%）
                      </span>
                    </div>
                    <div className="tp-bar-track">
                      <div
                        className="tp-bar-fill"
                        style={{
                          width: `${Math.round(g.share * 100)}%`,
                          background: `var(--cat-${g.color})`,
                        }}
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
                  合計 {durationLabel(stats.total)}。<b>押して測った時間だけ</b>で、
                  見込みでは埋めていません
                  {stats.planMinutes > 0 && `（うち予定 ${durationLabel(stats.planMinutes)}）`}。
                  区分を複数付けた仕事は、先頭の区分にだけ積んでいます。
                </p>
              </>
            )}
          </section>
        )

      case 'trend':
        return (
          <section className="tp-panel is-wide">
            {bar}
            {trendDays.length > 0 ? (
              <TrendCard
                allDays={trendDays}
                minutesOf={trendMinutes}
                capacity={dayCapacity(settings)}
              />
            ) : (
              <>
                <h2 className="tp-panel-title">推移</h2>
                <p className="tp-empty-body">
                  登録と完了を続けると、日ごとの件数と消化率の推移が出ます。
                </p>
              </>
            )}
          </section>
        )

      case 'hero':
        return (
          <section className="tp-panel tp-dash-hero is-wide">
            {bar}
            <div className="tp-panel-head">
              <h2>稼働</h2>
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
                <p className="tp-mono">
                  {durationLabel(stats.total)} / {durationLabel(stats.capacity)}
                </p>
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
              {stats.capacity === 0
                ? `この期間に稼働日はありません（会社カレンダーの休み）。測った時間は ${durationLabel(stats.total)}。`
                : capacityOk
                  ? `実働 ${durationLabel(stats.capacity)} に対し ${durationLabel(Math.max(0, stats.capacity - stats.total))} 残っています。`
                  : `実働 ${durationLabel(stats.capacity)} を ${durationLabel(stats.total - stats.capacity)} 超えています。`}
            </p>
            <p className="tp-hero-hours">
              数えたのは実際に動かした時間です（記録 {stats.count}件
              {stats.planMinutes > 0 && ` ／ うち予定 ${durationLabel(stats.planMinutes)}`}）。
              稼働日 {stats.workDays}日のうち、記録があったのは {stats.activeDays}日。
            </p>

            <div className="tp-statrow">
              <Stat label="完了" value={stats.done} tone="good" />
              <Stat
                label="未計測"
                value={stats.unmeasured}
                tone={stats.unmeasured > 0 ? 'bad' : undefined}
              />
              <Stat label="未完了" value={ov.open} />
              <Stat label="超過" value={ov.overdue} tone={ov.overdue > 0 ? 'bad' : undefined} />
            </div>
            <p className="tp-muted tp-small">
              完了・未計測はこの期間のぶん。未完了・超過は台帳ぜんぶのぶんです。
            </p>
          </section>
        )

      case 'effort':
        return (
          <section className="tp-panel is-wide">
            {bar}
            <div className="tp-panel-head">
              <h2>作業ごとの工数</h2>
              <span className="tp-badge tp-mono">{stats.effort.length}件</span>
            </div>
            {stats.effort.length === 0 ? (
              <p className="tp-empty-body">
                この期間に数えた時間がありません。時間を測ると、どの作業に何時間かかったかがここに出ます。
              </p>
            ) : (
              <>
                <ul className="tp-effort">
                  {stats.effort.slice(0, 12).map((row) => (
                    <li key={row.key}>
                      <span className="tp-effort-name">
                        <span
                          className="tp-cat-dot"
                          style={
                            {
                              '--cat': `var(--cat-${colorOf(settings.categoryGroups, row.category)})`,
                            } as CSSProperties
                          }
                          aria-hidden="true"
                        />
                        {row.title}
                      </span>
                      <span className="tp-effort-meta tp-mono">
                        {row.category}
                        {row.count > 1 && ` ／ ${row.count}回`}
                        {row.days > 1 && ` ／ ${row.days}日`}
                      </span>
                      <b className="tp-mono">{durationLabel(row.minutes)}</b>
                    </li>
                  ))}
                </ul>
                {stats.effort.length > 12 && (
                  <p className="tp-hint">
                    ほか {stats.effort.length - 12}件。ぜんぶは書き出し（CSV の「作業ごとの工数」）から出せます。
                  </p>
                )}
                <p className="tp-muted tp-small">
                  同じ件名・同じ区分のものはまとめています。数えているのは押して測った時間だけです。
                </p>
              </>
            )}
          </section>
        )

      case 'jobs':
        return jobsCard({
          jobs,
          tasks,
          byJob: stats.byJob,
          periodLabel: period.label,
          settings,
          bar,
          onNewJob,
          onEditJob,
          onAssignJob,
        })

      case 'estimate':
        return (
          <section className="tp-panel is-wide">
            {bar}
            <div className="tp-panel-head">
              <h2>見込みと実績</h2>
              <span className="tp-badge tp-mono">{est.count}件</span>
            </div>
            {est.count === 0 ? (
              <p className="tp-empty-body">
                見込みと実績の両方が入った仕事がまだありません。見込み時間を入れて時間を測ると、
                見積がどれだけ当たっているかがここに出ます。
              </p>
            ) : (
              <>
                <p className="tp-hero-note">
                  見込み {durationLabel(est.planned)} に対し、実績 {durationLabel(est.actual)}。
                  {est.planned > 0 && (
                    <b className={est.actual > est.planned ? ' tp-over' : ''}>
                      {' '}
                      {Math.round((est.actual / est.planned) * 100)}%
                    </b>
                  )}
                </p>
                {est.rows.map((r) => {
                  const ratio = r.planned > 0 ? r.actual / r.planned : 0
                  return (
                    <div className="tp-bar-item" key={r.group}>
                      <div className="tp-bar-head">
                        <span className="tp-bar-name">
                          <span
                            className="tp-cat-dot"
                            style={{ '--cat': `var(--cat-${r.color})` } as CSSProperties}
                            aria-hidden="true"
                          />
                          {r.group}
                        </span>
                        <span className="tp-muted tp-mono">
                          {durationLabel(r.planned)} → {durationLabel(r.actual)}（
                          {Math.round(ratio * 100)}%）
                        </span>
                      </div>
                      <div className="tp-bar-track">
                        <div
                          className="tp-bar-fill"
                          style={{
                            width: `${Math.min(100, Math.round(ratio * 50))}%`,
                            background:
                              ratio > 1.25
                                ? 'var(--chart-bad)'
                                : ratio < 0.75
                                  ? 'var(--chart-warn)'
                                  : 'var(--chart-good)',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
                <p className="tp-muted tp-small">
                  棒は 100%（見込みどおり）が真ん中です。
                  100% を超えるものは見込みが短すぎ、大きく下回るものは長すぎます。
                  両方が入っている仕事だけで数えています。
                </p>
              </>
            )}
          </section>
        )

      case 'weekday':
        return (
          <section className="tp-panel">
            {bar}
            <h2 className="tp-panel-title">曜日ごと</h2>
            {period.single ? (
              <p className="tp-empty-body">
                曜日の偏りは、上の「週」「月」「全体」で見ると出ます。
              </p>
            ) : stats.total === 0 ? (
              <p className="tp-empty-body">この期間に数えた時間がありません。</p>
            ) : (
              <WeekdayBars byWeekday={stats.byWeekday} />
            )}
          </section>
        )

      case 'progress':
        return (
          <section className="tp-panel">
            {bar}
            <h2 className="tp-panel-title">区分別の進捗</h2>
            {cats.length === 0 && <p className="tp-empty-body">区分のついたタスクがありません。</p>}
            {cats.map((c) => {
              const p = Math.round(c.rate * 100)
              return (
                <div className="tp-bar-item" key={c.category}>
                  <div className="tp-bar-head">
                    <span className="tp-bar-name">
                      <span
                        className="tp-cat-dot"
                        style={
                          {
                            '--cat': `var(--cat-${colorOf(settings.categoryGroups, c.category)})`,
                          } as CSSProperties
                        }
                        aria-hidden="true"
                      />
                      {c.category}
                    </span>
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
                          p >= 70
                            ? 'var(--chart-good)'
                            : p >= 40
                              ? 'var(--chart-warn)'
                              : 'var(--chart-bad)',
                      }}
                    />
                  </div>
                </div>
              )
            })}
            <p className="tp-muted tp-small">ここは台帳ぜんぶの件数です（期間で絞りません）。</p>
          </section>
        )

      case 'priority':
        return (
          <section className="tp-panel">
            {bar}
            <h2 className="tp-panel-title">優先度</h2>
            <PriorityBars dist={pri} />
            <p className="tp-muted tp-small">
              高が積み上がっているときは、期限をずらすより先に減らす対象を決めてください。
            </p>
          </section>
        )

      case 'source':
        return (
          <section className="tp-panel">
            {bar}
            <h2 className="tp-panel-title">入口別</h2>
            <SourceBar stats={srcs} total={tasks.length} />
            <p className="tp-muted tp-small">
              使われている入口が分かると、次に手を入れる入口を決められます。
            </p>
          </section>
        )
    }
  }

  return (
    <div className="tp-view tp-dash tp-grid">
      {fixing && (
        <ActualSheet
          tasks={fixingTasks}
          day={period.from}
          label={period.label}
          title={fixing.title}
          runs={runs}
          categoryGroups={settings.categoryGroups}
          defaultEstimateMin={settings.defaultEstimateMin}
          onPatch={onPatch}
          onClose={() => setFixing(null)}
        />
      )}
      {banding && (
        <BandSheet
          segments={band}
          day={period.from}
          today={today}
          nowMin={nowMin}
          tasks={fixable}
          runs={runs}
          workHours={settings.workHours}
          categoryGroups={settings.categoryGroups}
          defaultEstimateMin={settings.defaultEstimateMin}
          focusKey={banding.focus}
          onPatch={onPatch}
          onClose={() => setBanding(null)}
        />
      )}

      {top}

      {/* 並べ替え。押している間だけ、各カードの上に ↑↓ が出る */}
      <div className="tp-dash-tools is-wide">
        <button
          type="button"
          className={`tp-btn-ghost tp-btn-sm${sorting ? ' is-on' : ''}`}
          aria-pressed={sorting}
          onClick={() => setSorting((v) => !v)}
        >
          <Icon name={sorting ? 'check' : 'menu'} size={14} />
          {sorting ? '並べ替えを終わる' : '並べ替え'}
        </button>
        {sorting && order.join() !== DEFAULT_DASH_ORDER.join() && (
          <button
            type="button"
            className="tp-btn-ghost tp-btn-sm"
            onClick={() => saveOrder(DEFAULT_DASH_ORDER)}
          >
            もとの並びに戻す
          </button>
        )}
      </div>

      {order.map((key, i) => (
        <Reveal key={key}>
          {cardOf(
            key,
            sorting ? (
              <div className="tp-card-bar">
                <span className="tp-card-bar-name">{DASH_LABEL[key]}</span>
                <button
                  type="button"
                  className="tp-icon-btn"
                  aria-label={`${DASH_LABEL[key]}を上へ`}
                  disabled={i === 0}
                  onClick={() => saveOrder(moveCard(order, key, -1))}
                >
                  <Icon name="chevron" size={16} className="tp-turn-up" />
                </button>
                <button
                  type="button"
                  className="tp-icon-btn"
                  aria-label={`${DASH_LABEL[key]}を下へ`}
                  disabled={i === order.length - 1}
                  onClick={() => saveOrder(moveCard(order, key, 1))}
                >
                  <Icon name="chevron" size={16} className="tp-turn" />
                </button>
              </div>
            ) : null,
          ) as ReactElement}
        </Reveal>
      ))}
    </div>
  )
}

/** 1日ぶんの実働（分）。推移の下の帯の「満杯」の基準にする */
function dayCapacity(settings: Settings): number {
  return workMinutes(settings.workHours)
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
 * 案件ごとの工数（v1.30.0 で工数の画面からここへ移した）
 *
 * 期間の実績（押して測った時間）を案件ごとに並べ、見積とは別の列に置く。
 * 案件に入れていない仕事は、その場で案件へ入れられる。
 * ------------------------------------------------------- */

/**
 * 案件ごとの工数の面。
 * **コンポーネントではなく素の関数**にしてある。`Reveal` は子の要素に ref を付けて
 * 画面に入った時を見張るので、ここにコンポーネントを置くと ref が刺さらない
 * （関数コンポーネントは ref を受け取れない）。中で Hooks を使わないのもそのため。
 */
function jobsCard({
  jobs,
  tasks,
  byJob,
  periodLabel,
  settings,
  bar,
  onNewJob,
  onEditJob,
  onAssignJob,
}: {
  jobs: Job[]
  tasks: Task[]
  byJob: Map<string, number>
  periodLabel: string
  settings: Settings
  bar: ReactNode
  onNewJob: () => void
  onEditJob: (job: Job) => void
  onAssignJob: (task: Task, jobId: string | null) => void
}) {
  const live = sortJobs(jobs).filter((j) => !j.closed)
  const rows = live
    .map((job) => ({ job, minutes: byJob.get(job.id) ?? 0 }))
    .sort((a, b) => b.minutes - a.minutes)
  const loose = byJob.get(NO_JOB) ?? 0
  /** 案件に入れていない仕事。時間を数えたものだけ（入れる意味のあるもの） */
  const looseTasks = tasks.filter((t) => !t.jobId && (t.actualMin ?? 0) > 0).slice(0, 8)
  const total = [...byJob.values()].reduce((s, m) => s + m, 0)

  return (
    <section className="tp-panel is-wide">
      {bar}
      <div className="tp-panel-head">
        <h2>案件ごとの工数</h2>
        <div className="tp-head-acts">
          <span className="tp-badge tp-mono">{periodLabel}</span>
          <button type="button" className="tp-btn-ghost tp-btn-sm" onClick={onNewJob}>
            <Icon name="plus" size={15} />
            案件を作る
          </button>
        </div>
      </div>

      {live.length === 0 ? (
        <p className="tp-empty-body">
          案件がまだありません。「案件を作る」で1件作ると、タスクと予定から選べるようになります。
        </p>
      ) : (
        <ul className="tp-job-list">
          {rows.map(({ job, minutes }) => {
            const p = job.plannedMin > 0 ? Math.round((minutes / job.plannedMin) * 100) : null
            return (
              <li className="tp-job" key={job.id}>
                <button type="button" className="tp-job-head" onClick={() => onEditJob(job)}>
                  <span className="tp-job-name">
                    {job.code && <b className="tp-mono tp-job-code">{job.code}</b>}
                    {job.name}
                  </span>
                  <span className="tp-job-nums tp-mono">
                    {durationLabel(minutes)}
                    {job.plannedMin > 0 && <small> / {durationLabel(job.plannedMin)}</small>}
                  </span>
                  <Icon name="pencil" size={15} />
                </button>
                {job.plannedMin > 0 && (
                  <div className="tp-progress tp-job-bar">
                    <span
                      className={p !== null && p > 100 ? 'is-over' : p !== null && p > 80 ? 'is-tight' : ''}
                      style={{ width: `${Math.min(100, p ?? 0)}%` }}
                    />
                  </div>
                )}
                <p className="tp-job-meta tp-mono">
                  {job.client && <span>{job.client}</span>}
                  <span>{total > 0 ? Math.round((minutes / total) * 100) : 0}%</span>
                  {job.due && <span>期限 {formatMDShort(job.due)}</span>}
                  {p !== null && <span className={p > 100 ? 'tp-over' : ''}>見積の {p}%</span>}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      <p className="tp-hint">
        案件に入れていないぶんは {durationLabel(loose)}。
        実績は<b>押して測った時間だけ</b>で、見積（案件の予算）とは別の数字です。
        記録は {RUN_KEEP_DAYS}日ぶんしか残らないので、それより古い期間は出ません。
      </p>

      {looseTasks.length > 0 && (
        <>
          <p className="tp-label">案件に入れていない仕事</p>
          <ul className="tp-job-tasks">
            {looseTasks.map((t) => (
              <li key={t.id}>
                <span className={`tp-mini tp-pri-${t.priority}`}>
                  <span>
                    {t.title}
                    {t.categories.length > 0 && (
                      <CategoryChip
                        label={primaryCategory(t.categories)}
                        color={colorOf(settings.categoryGroups, primaryCategory(t.categories))}
                      />
                    )}
                  </span>
                  <span className="tp-mono">{durationLabel(t.actualMin ?? 0)}</span>
                </span>
                <label className="tp-job-pick">
                  <span className="tp-sr">案件を選ぶ</span>
                  <select
                    value=""
                    onChange={(e) => e.target.value && onAssignJob(t, e.target.value)}
                  >
                    <option value="">案件へ…</option>
                    {live.map((j) => (
                      <option key={j.id} value={j.id}>
                        {jobLabel(j)}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/* ---------------------------------------------------------
 * 日別の推移カード（表示日数をスライダーで切り替え）
 * ------------------------------------------------------- */

function TrendCard({
  allDays,
  minutesOf,
  capacity,
}: {
  allDays: DayPoint[]
  /** 日ごとの実測（分）。棒の下に細い帯で添える */
  minutesOf: Map<string, number>
  /** 1日あたりの実働（分）。帯の満杯の基準 */
  capacity: number
}) {
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
        <h2 className="tp-panel-title">推移</h2>
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
      {capacity > 0 && (
        <>
          <div className="tp-daymins" role="img" aria-label="日ごとに測った時間">
            {days.map((d) => {
              const m = minutesOf.get(d.key) ?? 0
              return (
                <span
                  key={d.key}
                  className="tp-daymins-col"
                  title={`${formatMDShort(d.key)} ${durationLabel(m)}`}
                >
                  <span
                    className={m > capacity ? 'is-over' : ''}
                    style={{ height: `${Math.min(100, (m / capacity) * 100)}%` }}
                  />
                </span>
              )
            })}
          </div>
          <p className="tp-muted tp-small">
            下の細い帯は、その日に<b>測った時間</b>（満杯で実働 {durationLabel(capacity)}）。
            上の棒と線は完了件数と消化率です。
          </p>
        </>
      )}
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
    <svg
      className="tp-trend"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="日別の完了件数と消化率の推移"
    >
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
      <text x={padL - 4} y={rateY(80) + 3} className="tp-t-goal" textAnchor="end">
        {goalCount}
      </text>
      <text x={W - padR + 4} y={rateY(80) + 3} className="tp-t-goal" textAnchor="start">
        80
      </text>

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

/** 曜日ごとの合計。どの曜日に時間を取られているかを見る */
function WeekdayBars({ byWeekday }: { byWeekday: number[] }) {
  const max = Math.max(1, ...byWeekday)
  const total = byWeekday.reduce((s, m) => s + m, 0)
  return (
    <>
      {byWeekday.map((min, i) => (
        <div className="tp-bar-item" key={i}>
          <div className="tp-bar-head">
            <span className="tp-bar-name">{'日月火水木金土'[i]}</span>
            <span className="tp-muted tp-mono">
              {durationLabel(min)}
              {total > 0 && `（${Math.round((min / total) * 100)}%）`}
            </span>
          </div>
          <div className="tp-bar-track">
            <div
              className="tp-bar-fill"
              style={{ width: `${(min / max) * 100}%`, background: 'var(--brand1)' }}
            />
          </div>
        </div>
      ))}
    </>
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
