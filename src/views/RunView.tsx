import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Reveal } from '../components/Reveal'
import { RunControl } from '../components/RunControl'
import { catStyle } from '../components/CategoryChip'
import { PlanRow } from './CalendarView'
import {
  clockLabel,
  diffDays,
  dueLabel,
  durationLabel,
  formatMDShort,
  toMinutes,
} from '../lib/date'
import { sortTasks } from '../lib/tasks'
import { currentOccurrence, nextOccurrenceOf, occurrencesOn, planSpan } from '../lib/plans'
import { activeRuns, dayMinutes, runSeconds, type RunBox } from '../lib/runs'
import { colorOf, primaryCategory } from '../lib/workCategories'
import { isWorkDay, remainingWorkMinutes, taskMinutes, workMinutes } from '../lib/workday'
import { currentBand, timeboxLabel } from '../lib/timebox'
import type { CategoryGroup, Plan, Settings, Task, WorkRun } from '../types'

/* =========================================================
 * 実行（開始・一時停止・終了）
 *
 * この画面だけは「決める」ためではなく「動かす」ためにある。
 *   1. いま動いているもの … 手を付けている物を全部、経過時間つきで
 *   2. 次にやる          … 今日締めのものを上から。押せばその場で始まる
 *   3. 今日の予定        … 会議や来客。自動のものは時刻で勝手に始まって終わる
 *   4. 近日の締め        … 明日から1週間。前倒しできるものを拾う
 *   5. 区分から始める    … 台帳に無い飛び込みの作業を、区分1タップで立てて始める
 *
 * **同時に何本でも走らせられる**。電話を受けながら伝票を打つ、が実際に起きる。
 * 走っている物を一番上に置き、次にやる物をすぐ下に置く。
 * =======================================================*/

export function RunView({
  tasks,
  plans,
  today,
  settings,
  nowMin,
  runBox,
  onEditTask,
  onToggleTask,
  onEditPlan,
  onTogglePlanAuto,
  onQuickTask,
}: {
  tasks: Task[]
  plans: Plan[]
  today: string
  settings: Settings
  /** いまの時刻（0時からの分） */
  nowMin: number
  runBox: RunBox
  onEditTask: (task: Task) => void
  onToggleTask: (task: Task) => void
  onEditPlan: (plan: Plan) => void
  /** 予定の自動計上を切り替える */
  onTogglePlanAuto: (plan: Plan) => void
  /** 区分から1件立てる。start が true ならそのまま始める */
  onQuickTask: (category: string, start: boolean) => void
}) {
  /* 動いている物があるときだけ秒を刻む。ほかの画面まで毎秒書き換えない。 */
  const [tick, setTick] = useState(() => Date.now())
  const active = useMemo(() => activeRuns(runBox.runs), [runBox.runs])
  const anyRunning = active.some((r) => r.state === 'running')
  useEffect(() => {
    if (!anyRunning) return
    const id = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [anyRunning])
  const box: RunBox = { ...runBox, nowMs: anyRunning ? tick : runBox.nowMs }

  const rule = { workHours: settings.workHours, workCalendar: settings.workCalendar }
  const occurrences = useMemo(
    () => occurrencesOn(plans, today, rule),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans, today, settings.workHours, settings.workCalendar],
  )
  const nowPlan = currentOccurrence(occurrences, nowMin)
  const nextPlan = nextOccurrenceOf(occurrences, nowMin)

  const open = useMemo(() => tasks.filter((t) => t.status === 'open'), [tasks])
  /** 今日締め（超過ぶんを含む）。上から順に手を付ければよいように並べる。 */
  const dueToday = useMemo(
    () => sortTasks(open.filter((t) => !!t.due && diffDays(t.due, today) <= 0)),
    [open, today],
  )
  const soon = useMemo(
    () =>
      sortTasks(
        open.filter((t) => {
          if (!t.due) return false
          const d = diffDays(t.due, today)
          return d >= 1 && d <= 7
        }),
      ),
    [open, today],
  )
  /** 動かしている物は「次にやる」から外す（同じ物が2か所に出ると迷う） */
  const activeIds = new Set(active.map((r) => r.targetId))
  const upNext = dueToday.filter((t) => !activeIds.has(t.id))

  const worked = dayMinutes(box.runs, today, box.nowMs)
  const capacity = isWorkDay(today, settings.workHours, settings.workCalendar)
    ? workMinutes(settings.workHours)
    : 0
  const left = remainingWorkMinutes(settings.workHours, nowMin)
  const band = currentBand(settings.workHours, nowMin)
  const pct = capacity > 0 ? Math.min(100, Math.round((worked / capacity) * 100)) : 0

  return (
    <div className="tp-view">
      {/* --- いまの状況。実績（実行した時間）であって、見込みの積み上げではない --- */}
      <section className="tp-run-hero">
        <div className="tp-today-row">
          <p className="tp-label tp-today-label">NOW</p>
          <p className="tp-today-num">
            <b>{durationLabel(worked)}</b>
            <span>/ {durationLabel(capacity)}</span>
          </p>
        </div>
        <div className="tp-progress">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="tp-run-hero-note tp-mono">
          {band === 'out' ? '時間外' : timeboxLabel(band, settings.workHours)}
          {' ／ 終業まで '}
          {durationLabel(left)}
          {nowPlan && ` ／ いま「${nowPlan.plan.title}」の時間`}
        </p>
        <p className="tp-run-hero-sub">
          ここに出るのは<b>実際に動かした時間</b>です（見込みの積み上げは一覧の TODAY）。
        </p>
      </section>

      {/* --- 1. いま動いているもの --- */}
      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2>いま動いているもの</h2>
            <span className={`tp-badge${anyRunning ? '' : ' is-quiet'}`}>{active.length}</span>
          </div>
          {active.length === 0 ? (
            <p className="tp-empty-body">
              手を付けている作業はありません。下の「次にやる」から ▶ を押すと、そこから時間を数え始めます。
            </p>
          ) : (
            <ul className="tp-runlist">
              {active.map((r) => (
                <RunRow
                  key={r.id}
                  run={r}
                  today={today}
                  settings={settings}
                  box={box}
                  onOpen={() => {
                    const t = tasks.find((x) => x.id === r.targetId)
                    if (t) onEditTask(t)
                  }}
                />
              ))}
            </ul>
          )}
          {active.length > 1 && (
            <p className="tp-hint">
              同時に {active.length} 件を数えています。合計が実時間を超えるので、置いた作業は「止める」を押してください。
            </p>
          )}
        </section>
      </Reveal>

      {/* --- 2. 次にやる（今日締め） --- */}
      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2>次にやる</h2>
            <span className="tp-badge tp-mono">{upNext.length}</span>
          </div>
          {upNext.length === 0 ? (
            <p className="tp-empty-body">今日締めのタスクは残っていません。近日の締めを前倒しするか、区分から立ててください。</p>
          ) : (
            <ul className="tp-daylist">
              {upNext.map((t, i) => {
                const over = !!t.due && diffDays(t.due, today) < 0
                return (
                  <li key={t.id} className={`tp-dayrow${i === 0 ? ' is-next' : ''}`}>
                    <button
                      type="button"
                      className="tp-check"
                      aria-label={`${t.title} を完了にする`}
                      onClick={() => onToggleTask(t)}
                    />
                    <button type="button" className={`tp-mini tp-pri-${t.priority}`} onClick={() => onEditTask(t)}>
                      <span>
                        {i === 0 && <b className="tp-next-tag">次</b>}
                        {t.title}
                      </span>
                      <span className={`tp-mono${over ? ' tp-over' : ''}`}>
                        {t.dueTime ? `${t.dueTime} 締め` : dueLabel(t.due, today)} ／{' '}
                        {durationLabel(taskMinutes(t, settings.defaultEstimateMin))}
                      </span>
                    </button>
                    <RunControl
                      run={null}
                      nowMs={box.nowMs}
                      title={t.title}
                      showTime={false}
                      onStart={() => box.startTask(t)}
                      onPause={() => {}}
                      onResume={() => {}}
                      onFinish={() => {}}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </Reveal>

      {/* --- 3. 今日の予定 --- */}
      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2>今日の予定</h2>
            <span className="tp-badge tp-mono">{occurrences.length}</span>
          </div>
          {occurrences.length === 0 ? (
            <p className="tp-empty-body">
              今日の予定はありません。打合せや来客はカレンダーの「予定を入れる」から足せます。
            </p>
          ) : (
            <>
              {nextPlan && (
                <p className="tp-run-next-plan tp-mono">
                  <Icon name="clock" size={13} />
                  次の予定 {planSpan(nextPlan.plan)}「{nextPlan.plan.title}」
                  {(() => {
                    const from = nextPlan.plan.startTime ? toMinutes(nextPlan.plan.startTime) : null
                    return from !== null ? `（あと${durationLabel(from - nowMin)}）` : ''
                  })()}
                </p>
              )}
              <ul className="tp-daylist">
                {occurrences.map((o) => (
                  <PlanRow
                    key={o.key}
                    occ={o}
                    settings={settings}
                    runBox={box}
                    now={o.key === nowPlan?.key}
                    onEdit={() => onEditPlan(o.plan)}
                    extra={
                      o.plan.allDay ? undefined : (
                        <button
                          type="button"
                          className={`tp-auto-toggle${o.plan.autoTrack ? ' is-on' : ''}`}
                          aria-pressed={o.plan.autoTrack}
                          onClick={() => onTogglePlanAuto(o.plan)}
                        >
                          <Icon name={o.plan.autoTrack ? 'repeat' : 'clock'} size={12} />
                          {o.plan.autoTrack ? '自動で計上（押すと手動に）' : '手で開始・終了（押すと自動に）'}
                        </button>
                      )
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      </Reveal>

      {/* --- 4. 近日の締め --- */}
      {soon.length > 0 && (
        <Reveal>
          <section className="tp-panel">
            <div className="tp-panel-head">
              <h2>近日の締め</h2>
              <span className="tp-badge tp-mono">{soon.length}</span>
            </div>
            <ul className="tp-daylist">
              {soon.slice(0, 8).map((t) => (
                <li key={t.id} className="tp-dayrow">
                  <button type="button" className={`tp-mini tp-pri-${t.priority}`} onClick={() => onEditTask(t)}>
                    <span>{t.title}</span>
                    <span className="tp-mono">
                      {formatMDShort(t.due as string)}（あと{diffDays(t.due as string, today)}日）
                    </span>
                  </button>
                  <RunControl
                    run={null}
                    nowMs={box.nowMs}
                    title={t.title}
                    showTime={false}
                    onStart={() => box.startTask(t)}
                    onPause={() => {}}
                    onResume={() => {}}
                    onFinish={() => {}}
                  />
                </li>
              ))}
            </ul>
            {soon.length > 8 && <p className="tp-hint">ほか {soon.length - 8} 件は一覧の「今週」で見られます。</p>}
          </section>
        </Reveal>
      )}

      {/* --- 5. 区分から始める --- */}
      <Reveal>
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2>区分から始める</h2>
            <Icon name="grid" size={16} />
          </div>
          <p className="tp-note">
            台帳に無い飛び込みの作業を、区分1つで立てて始めます。件名は区分の名前で作られるので、
            あとから直せます。
          </p>
          <CategoryLauncher groups={settings.categoryGroups} onPick={onQuickTask} />
        </section>
      </Reveal>
    </div>
  )
}

/** 動いている（または止めてある）記録1件 */
function RunRow({
  run,
  today,
  settings,
  box,
  onOpen,
}: {
  run: WorkRun
  today: string
  settings: Settings
  box: RunBox
  onOpen: () => void
}) {
  const cat = primaryCategory(run.categories)
  return (
    <li className={`tp-runrow${run.state === 'running' ? ' is-running' : ' is-paused'}`}>
      <div className="tp-runrow-main">
        <button type="button" className="tp-runrow-title" onClick={onOpen}>
          <span>{run.title}</span>
          <span className="tp-runrow-meta tp-mono">
            {run.kind === 'plan' ? '予定' : 'タスク'}
            {cat && ` ／ ${cat}`}
            {run.auto && ' ／ 自動'}
            {/* 前の日から動いたままのものは、日付を出して止め忘れに気づけるようにする */}
            {run.day !== today && ` ／ ${formatMDShort(run.day)}から`}
          </span>
        </button>
        {cat && (
          <span className="tp-cat-dot-lg" style={catStyle(colorOf(settings.categoryGroups, cat))} aria-hidden="true" />
        )}
      </div>
      <div className="tp-runrow-foot">
        <span className={`tp-run-clock tp-mono${run.state === 'running' ? ' is-running' : ''}`}>
          {clockLabel(runSeconds(run, box.nowMs))}
        </span>
        <RunControl
          run={run}
          nowMs={box.nowMs}
          title={run.title}
          showTime={false}
          onStart={() => box.resume(run)}
          onPause={() => box.pause(run)}
          onResume={() => box.resume(run)}
          onFinish={() => box.finish(run)}
        />
      </div>
    </li>
  )
}

/**
 * 区分から立てる。グループを押すと中の区分が開き、区分を押すとその場で始まる。
 * ＋だけを押したときは、立てるだけで始めない（あとでやる物を放り込む用）。
 */
function CategoryLauncher({
  groups,
  onPick,
}: {
  groups: CategoryGroup[]
  onPick: (category: string, start: boolean) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <div className="tp-launch">
      <div className="tp-launch-groups">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`tp-launch-group${openId === g.id ? ' is-on' : ''}`}
            style={catStyle(g.color)}
            aria-expanded={openId === g.id}
            onClick={() => setOpenId(openId === g.id ? null : g.id)}
          >
            <span className="tp-cat-dot" aria-hidden="true" />
            {g.name}
          </button>
        ))}
      </div>
      {openId && (
        <ul className="tp-launch-items">
          {(groups.find((g) => g.id === openId)?.items ?? []).map((item) => (
            <li key={item}>
              <button
                type="button"
                className="tp-launch-item"
                onClick={() => onPick(item, true)}
                title="立てて始める"
              >
                <Icon name="play" size={14} />
                <span>{item}</span>
              </button>
              <button
                type="button"
                className="tp-launch-add"
                aria-label={`${item} を立てるだけ`}
                title="立てるだけ"
                onClick={() => onPick(item, false)}
              >
                <Icon name="plus" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
