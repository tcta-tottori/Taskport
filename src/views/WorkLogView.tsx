import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { CategoryChip, catStyle } from '../components/CategoryChip'
import { CategorySheet } from './CategorySheet'
import { PlanRow } from './CalendarView'
import {
  addDaysKey,
  clockLabel,
  diffDays,
  dueLabel,
  durationLabel,
  formatMD,
  formatMDShort,
  isoAt,
  toMinutes,
} from '../lib/date'
import { emptyDraft, sortTasks } from '../lib/tasks'
import { applyTemplate, rank } from '../lib/templates'
import { colorOf, detectCategories } from '../lib/workCategories'
import { isWorkDay, taskMinutes, workMinutes } from '../lib/workday'
import {
  daySpent,
  isRunning,
  loggedMinutes,
  logStartTime,
  roundedNow,
  running,
  runningMin,
  runningSec,
} from '../lib/worklog'
import {
  currentOccurrence,
  nextOccurrenceOf,
  occurrencesOn,
  planSpan,
} from '../lib/plans'
import { activeRuns, dayMinutes, runSeconds, type RunBox } from '../lib/runs'
import type { CategoryGroup, Draft, Plan, Settings, Task, TaskTemplate } from '../types'

/* =========================================================
 * 実行（いま動かす・その日の記録）
 *
 * 一覧とスケジュールが「これから」を見る画面なのに対し、ここは
 * **手が動いた記録**と、**いま何に手を付けるか**の面。
 *
 *   1. いま動いているもの … タスクと予定。押した時刻から数える（画面を閉じても続く）
 *   2. 次にやる            … 今日締めのものを上から。押せばその場で始まる
 *   3. その日の予定        … 打合せなど。自動にしてあれば時刻で勝手に始まって終わる
 *   4. 近日の締め          … 明日から1週間。前倒しできるものを拾う
 *   5. その日の記録        … 開始時刻とかかった時間をその場で直せる
 *   6. やったことを足す／区分から始める … 台帳に無い仕事を1件立てる
 *
 * 【実績をどこが持つか】
 *   タスク … 台帳（`Task.startedAt` / `Task.actualMin`。`lib/worklog.ts`）
 *   予定   … 予定の実行ログ（`lib/runs.ts`）。予定はタスクではないので台帳に置けない
 * 1つの仕事が2か所に記録されないよう、この分担を崩さない。
 *
 * 日報はここの数字から書き出す。だから**見込みではなく実績**を持ち、
 * 実績が入っていないぶんは見込みで埋めていることを画面に書く（黙って混ぜない）。
 * =======================================================*/

/** 「やったことを足す」で作る1件 */
export interface LogEntry {
  draft: Draft
  /** "YYYY-MM-DD" */
  day: string
  /** 開始時刻 "HH:mm" */
  start: string
  /** かかった時間（分） */
  minutes: number
}

/** よく使う長さ。押すだけで入る */
const QUICK_MIN = [15, 30, 45, 60, 90, 120]

export function WorkLogView({
  tasks,
  plans,
  today,
  settings,
  templates,
  nowMin,
  runBox,
  onEdit,
  onToggle,
  onToggleRunning,
  onPatch,
  onAddLog,
  onEditPlan,
  onTogglePlanAuto,
  onQuickTask,
  onChangeCategoryGroups,
  onNotify,
}: {
  tasks: Task[]
  /** 予定。繰り返しは画面に出すときに展開する（作り置きしない） */
  plans: Plan[]
  today: string
  settings: Settings
  templates: TaskTemplate[]
  /** いまの時刻（0時からの分） */
  nowMin: number
  /** 予定の実行の操作。タスクのほうは onToggleRunning */
  runBox: RunBox
  onEdit: (task: Task) => void
  onToggle: (task: Task) => void
  /** 手を付ける／手を止める */
  onToggleRunning: (task: Task) => void
  /** 実績（開始時刻・かかった時間）を直す */
  onPatch: (task: Task, patch: Partial<Task>) => void
  onAddLog: (entry: LogEntry) => void
  onEditPlan: (plan: Plan) => void
  /** 予定の自動計上を切り替える */
  onTogglePlanAuto: (plan: Plan) => void
  /** 区分から1件立てる。start が true ならそのまま始める */
  onQuickTask: (category: string, start: boolean) => void
  onChangeCategoryGroups: (next: CategoryGroup[]) => void
  onNotify: (text: string, tone?: 'ok' | 'error') => void
}) {
  const [day, setDay] = useState(today)
  const [adding, setAdding] = useState(false)

  const live = useMemo(() => running(tasks), [tasks])

  /* 実行中の経過時間は秒まで出す。動いているものがあるときだけ1秒ごとに書き換える。 */
  const [tick, setTick] = useState(() => Date.now())
  const livePlans = useMemo(() => activeRuns(runBox.runs), [runBox.runs])
  const anyPlanRunning = livePlans.some((r) => r.state === 'running')
  const anyRunning = anyPlanRunning || live.length > 0
  useEffect(() => {
    if (!anyRunning) return
    const id = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [anyRunning])
  const box: RunBox = { ...runBox, nowMs: anyRunning ? tick : runBox.nowMs }

  const occurrences = useMemo(
    () =>
      occurrencesOn(plans, day, {
        workHours: settings.workHours,
        workCalendar: settings.workCalendar,
      }),
    [plans, day, settings.workHours, settings.workCalendar],
  )
  const isToday = day === today
  const nowPlan = isToday ? currentOccurrence(occurrences, nowMin) : null
  const nextPlan = isToday ? nextOccurrenceOf(occurrences, nowMin) : null

  const open = useMemo(() => tasks.filter((t) => t.status === 'open'), [tasks])
  /** 今日締め（超過ぶんを含む）。動かしている最中のものは外す（同じ物が2か所に出ると迷う） */
  const upNext = useMemo(
    () => sortTasks(open.filter((t) => !!t.due && diffDays(t.due, today) <= 0 && !isRunning(t))),
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
  /** 予定ぶんの実働。台帳の実績とは別に数え、画面でも分けて書く */
  const planWorked = dayMinutes(box.runs, day, box.nowMs)
  const spent = useMemo(
    () => daySpent(tasks, day, settings.defaultEstimateMin),
    [tasks, day, settings.defaultEstimateMin],
  )
  const capacity = isWorkDay(day, settings.workHours, settings.workCalendar)
    ? workMinutes(settings.workHours)
    : 0
  const pct = capacity > 0 ? Math.round((spent.total / capacity) * 100) : 0
  const ahead = diffDays(day, today) > 0

  return (
    <div className="tp-view tp-cols">
      <div className="tp-col">
        {/* --- 日付を選ぶ --- */}
        <section className="tp-log-nav">
          <button
            type="button"
            className="tp-icon-btn"
            aria-label="前の日"
            onClick={() => setDay(addDaysKey(day, -1))}
          >
            <Icon name="chevron" size={18} className="tp-caret-prev" />
          </button>
          <div className="tp-log-day">
            <b className="tp-mono">{formatMD(day)}</b>
            <span>
              {day === today
                ? '今日'
                : diffDays(today, day) === 1
                  ? '昨日'
                  : ahead
                    ? `${diffDays(day, today)}日先`
                    : `${diffDays(today, day)}日前`}
            </span>
          </div>
          <button
            type="button"
            className="tp-icon-btn"
            aria-label="次の日"
            onClick={() => setDay(addDaysKey(day, 1))}
          >
            <Icon name="chevron" size={18} />
          </button>
          {day !== today && (
            <button type="button" className="tp-btn-ghost tp-log-today" onClick={() => setDay(today)}>
              今日へ
            </button>
          )}
        </section>

        {/* --- いま動いているもの --- */}
        <section className="tp-live">
          <p className="tp-label">いま動いているもの</p>
          {live.length === 0 ? (
            <p className="tp-live-empty">
              手を付けているものはありません。一覧のカードか下の記録から「始める」を押すと、
              押した時刻から数えます。
            </p>
          ) : (
            <ul className="tp-live-list">
              {live.map((t) => (
                <li key={t.id} className="tp-live-row">
                  <span className="tp-live-dot" aria-hidden="true" />
                  <button type="button" className="tp-live-body" onClick={() => onEdit(t)}>
                    <span className="tp-live-title">{t.title}</span>
                    {/* 出すのは経過時間だけ。始めた時刻や区分は下の記録で読める */}
                    <span className="tp-live-meta tp-mono">{clockLabel(runningSec(t, tick))}</span>
                  </button>
                  <button type="button" className="tp-btn-ghost" onClick={() => onToggleRunning(t)}>
                    止める
                  </button>
                  <button type="button" className="tp-btn-primary" onClick={() => onToggle(t)}>
                    完了
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* 予定ぶんの実行。台帳には入らないので、記録はこちらが持つ。 */}
          {livePlans.length > 0 && (
            <ul className="tp-live-list">
              {livePlans.map((r) => (
                <li
                  key={r.id}
                  className={`tp-live-row tp-live-plan${r.state === 'paused' ? ' is-paused' : ''}`}
                >
                  <span className="tp-live-dot" aria-hidden="true" />
                  <span className="tp-live-body">
                    <span className="tp-live-title">{r.title}</span>
                    <span className="tp-live-meta tp-mono">{clockLabel(runSeconds(r, box.nowMs))}</span>
                  </span>
                  <button
                    type="button"
                    className="tp-btn-ghost"
                    onClick={() => (r.state === 'running' ? box.pause(r) : box.resume(r))}
                  >
                    {r.state === 'running' ? '止める' : '再開'}
                  </button>
                  <button type="button" className="tp-btn-primary" onClick={() => box.finish(r)}>
                    終了
                  </button>
                </li>
              ))}
            </ul>
          )}

          {live.length + livePlans.length > 1 && (
            <p className="tp-hint">
              同時に {live.length + livePlans.length} 件を数えています。合計が実時間を超えるので、
              置いた作業は「止める」を押してください。
            </p>
          )}
        </section>

        {/* --- 次にやる（今日締め）。今日を見ているときだけ出す --- */}
        {isToday && (
          <section className="tp-panel">
            <div className="tp-panel-head">
              <h2>次にやる</h2>
              <span className="tp-badge tp-mono">{upNext.length}</span>
            </div>
            {upNext.length === 0 ? (
              <p className="tp-empty-body">
                今日締めのタスクは残っていません。近日の締めを前倒しするか、区分から立ててください。
              </p>
            ) : (
              <ul className="tp-daylist">
                {upNext.slice(0, 8).map((t, i) => (
                  <li key={t.id} className={`tp-dayrow${i === 0 ? ' is-next' : ''}`}>
                    <button
                      type="button"
                      className="tp-check"
                      aria-label={`${t.title} を完了にする`}
                      onClick={() => onToggle(t)}
                    />
                    <button
                      type="button"
                      className={`tp-mini tp-pri-${t.priority}`}
                      onClick={() => onEdit(t)}
                    >
                      <span>
                        {i === 0 && <b className="tp-next-tag">次</b>}
                        {t.title}
                      </span>
                      <span
                        className={`tp-mono${!!t.due && diffDays(t.due, today) < 0 ? ' tp-over' : ''}`}
                      >
                        {t.dueTime ? `${t.dueTime} 締め` : dueLabel(t.due, today)} ／{' '}
                        {durationLabel(taskMinutes(t, settings.defaultEstimateMin))}
                      </span>
                    </button>
                    {/* ✓ の丸と並ぶ行なので、こちらも記号だけにする。
                        言葉は aria-label と title に持たせる（読み上げと長押しで出る）。 */}
                    <button
                      type="button"
                      className="tp-run tp-run-i"
                      aria-label={`${t.title} を始める`}
                      title="始める"
                      onClick={() => onToggleRunning(t)}
                    >
                      <Icon name="play" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {upNext.length > 8 && (
              <p className="tp-hint">ほか {upNext.length - 8} 件は一覧の「今日」で見られます。</p>
            )}
          </section>
        )}

        {/* --- その日の予定 --- */}
        <section className="tp-panel">
          <div className="tp-panel-head">
            <h2>{isToday ? '今日の予定' : `${formatMDShort(day)}の予定`}</h2>
            <span className="tp-badge tp-mono">{occurrences.length}</span>
          </div>
          {occurrences.length === 0 ? (
            <p className="tp-empty-body">
              この日の予定はありません。打合せや来客はカレンダーの「予定を入れる」から足せます。
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

        {/* --- 近日の締め --- */}
        {isToday && soon.length > 0 && (
          <section className="tp-panel">
            <div className="tp-panel-head">
              <h2>近日の締め</h2>
              <span className="tp-badge tp-mono">{soon.length}</span>
            </div>
            <ul className="tp-daylist">
              {soon.slice(0, 6).map((t) => (
                <li key={t.id} className="tp-dayrow">
                  <button
                    type="button"
                    className={`tp-mini tp-pri-${t.priority}`}
                    onClick={() => onEdit(t)}
                  >
                    <span>{t.title}</span>
                    <span className="tp-mono">
                      {formatMDShort(t.due as string)}（あと{diffDays(t.due as string, today)}日）
                    </span>
                  </button>
                  <button
                    type="button"
                    className="tp-run tp-run-i"
                    aria-label={`${t.title} を始める`}
                    title="始める"
                    onClick={() => onToggleRunning(t)}
                  >
                    <Icon name="play" size={16} />
                  </button>
                </li>
              ))}
            </ul>
            {soon.length > 6 && (
              <p className="tp-hint">ほか {soon.length - 6} 件は一覧の「今週」で見られます。</p>
            )}
          </section>
        )}

        {/* --- その日の積み上がり --- */}
        <section className="tp-today-card">
          <div className="tp-today-row">
            <p className="tp-label tp-today-label">SPENT</p>
            <p className="tp-today-num">
              <b>{durationLabel(spent.total)}</b>
              <span>/ {capacity > 0 ? durationLabel(capacity) : '休み'}</span>
            </p>
          </div>
          <div className="tp-progress">
            <span
              className={pct > 100 ? 'is-over' : pct > 80 ? 'is-tight' : ''}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <p className="tp-today-note">
            {spent.tasks.length === 0
              ? 'この日の記録はまだありません。'
              : spent.measured === spent.tasks.length
                ? `${spent.tasks.length}件すべてに実績が入っています。`
                : `${spent.tasks.length}件のうち${spent.measured}件が実績。残りは見込みで埋めた数字です。`}
            {/* 予定ぶんは台帳に入らないので、上の数字とは別に出す（黙って混ぜない） */}
            {planWorked > 0 && ` ほかに予定で ${durationLabel(planWorked)}。`}
          </p>
        </section>
      </div>

      <div className="tp-col">
        {/* --- やったことを足す --- */}
        {adding ? (
          <AddLogForm
            day={day}
            templates={templates}
            categoryGroups={settings.categoryGroups}
            onChangeCategoryGroups={onChangeCategoryGroups}
            onCancel={() => setAdding(false)}
            onCommit={(entry) => {
              setAdding(false)
              onAddLog(entry)
            }}
          />
        ) : (
          <button type="button" className="tp-log-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
            やったことを足す
            <small>会議・電話・応援など、台帳に無いまま終わった仕事</small>
          </button>
        )}

        {/* --- その日の記録 --- */}
        {spent.tasks.length === 0 ? (
          <div className="tp-empty">
            <Icon name="clock" size={26} />
            <p className="tp-empty-head">{formatMD(day)}の記録はありません</p>
            <p className="tp-empty-body">
              上の「やったことを足す」で、終わった仕事を後から入れられます。
              一覧のカードから「始める」を押した仕事も、ここに出ます。
            </p>
          </div>
        ) : (
          <ul className="tp-log-list">
            {spent.tasks.map((t) => (
              <LogRow
                key={t.id}
                task={t}
                day={day}
                defaultEstimateMin={settings.defaultEstimateMin}
                categoryGroups={settings.categoryGroups}
                onEdit={onEdit}
                onToggle={onToggle}
                onToggleRunning={onToggleRunning}
                onPatch={onPatch}
                onNotify={onNotify}
              />
            ))}
          </ul>
        )}

        {/* --- 区分から始める。台帳に無い飛び込みの作業を1タップで立てる --- */}
        {isToday && (
          <section className="tp-panel tp-launch-panel">
            <div className="tp-panel-head">
              <h2>区分から始める</h2>
              <Icon name="grid" size={16} />
            </div>
            <p className="tp-note">
              台帳に無い飛び込みの作業を、区分1つで立てて始めます。件名は区分の名前で作られるので、
              あとから直せます。＋は立てるだけ。
            </p>
            <CategoryLauncher groups={settings.categoryGroups} onPick={onQuickTask} />
          </section>
        )}

        <p className="tp-list-foot">
          日報の書き出しはこの記録から作ります。実績が入っていない仕事は見込みの時間で並びます。
          予定（打合せなど）の時間は台帳に入らないので、日報には別の行で出ます。
        </p>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------
 * 記録の1行
 * ------------------------------------------------------- */

function LogRow({
  task,
  day,
  defaultEstimateMin,
  categoryGroups,
  onEdit,
  onToggle,
  onToggleRunning,
  onPatch,
  onNotify,
}: {
  task: Task
  day: string
  defaultEstimateMin: number
  categoryGroups: CategoryGroup[]
  onEdit: (task: Task) => void
  onToggle: (task: Task) => void
  onToggleRunning: (task: Task) => void
  onPatch: (task: Task, patch: Partial<Task>) => void
  onNotify: (text: string, tone?: 'ok' | 'error') => void
}) {
  const done = task.status === 'done'
  const live = isRunning(task)
  const start = logStartTime(task) ?? ''
  const shown = loggedMinutes(task, defaultEstimateMin)

  return (
    <li className={`tp-log-row tp-pri-${task.priority}${done ? ' is-done' : ''}${live ? ' is-live' : ''}`}>
      <div className="tp-log-main">
        <button
          type="button"
          className="tp-check"
          aria-pressed={done}
          aria-label={done ? `${task.title} を未完了に戻す` : `${task.title} を完了にする`}
          onClick={() => onToggle(task)}
        >
          {done && <Icon name="check" size={15} strokeWidth={2.6} />}
        </button>
        <button type="button" className="tp-log-body" onClick={() => onEdit(task)}>
          <span className="tp-log-title">{task.title}</span>
          <span className="tp-log-cats">
            {task.categories.map((c) => (
              <CategoryChip key={c} label={c} color={colorOf(categoryGroups, c)} />
            ))}
            {task.actualMin === null && <span className="tp-chip-est">見込み</span>}
            {live && <span className="tp-chip-live tp-mono">{durationLabel(runningMin(task))}</span>}
          </span>
        </button>
      </div>

      <div className="tp-log-fields">
        <label className="tp-log-field">
          <span className="tp-label">開始</span>
          <input
            type="time"
            value={start}
            onChange={(e) => {
              const v = e.target.value
              // 空にしたら「時刻の記録なし」に戻す。予定の時刻（dueTime）は触らない
              onPatch(task, { startedAt: v ? isoAt(day, v) : null })
            }}
          />
        </label>
        <label className="tp-log-field tp-log-field-narrow">
          <span className="tp-label">かかった</span>
          <div className="tp-suffix">
            <input
              type="number"
              min={0}
              step={5}
              inputMode="numeric"
              value={task.actualMin ?? ''}
              placeholder={String(shown)}
              onChange={(e) => {
                const v = Number(e.target.value)
                onPatch(task, { actualMin: e.target.value === '' || v <= 0 ? null : Math.round(v) })
              }}
            />
            <span>分</span>
          </div>
        </label>
        {!done && (
          <button
            type="button"
            className={live ? 'tp-btn-ghost' : 'tp-btn-primary'}
            onClick={() => onToggleRunning(task)}
          >
            {live ? '止める' : '始める'}
          </button>
        )}
        {done && task.actualMin === null && (
          <button
            type="button"
            className="tp-btn-ghost"
            onClick={() => {
              onPatch(task, { actualMin: shown })
              onNotify(`見込みの${durationLabel(shown)}を実績にしました`)
            }}
          >
            見込みを実績に
          </button>
        )}
      </div>
    </li>
  )
}

/* ---------------------------------------------------------
 * やったことを足す
 *
 * 件名・区分・開始時刻・かかった時間だけ。優先度も期限も聞かない
 * （もう終わった仕事に、これからの話を書かせない）。
 * ------------------------------------------------------- */

function AddLogForm({
  day,
  templates,
  categoryGroups,
  onChangeCategoryGroups,
  onCommit,
  onCancel,
}: {
  day: string
  templates: TaskTemplate[]
  categoryGroups: CategoryGroup[]
  onChangeCategoryGroups: (next: CategoryGroup[]) => void
  onCommit: (entry: LogEntry) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('form'))
  const [start, setStart] = useState(() => roundedNow())
  const [minutes, setMinutes] = useState(30)
  const [picking, setPicking] = useState(false)
  /** 区分を人が選んだか。選んだあとは件名から上書きしない */
  const [touched, setTouched] = useState(false)

  const recent = useMemo(() => [...templates].sort(rank).slice(0, 6), [templates])
  const endMin = (toMinutes(start) ?? 0) + minutes

  const setTitle = (title: string) => {
    if (touched) return setDraft({ ...draft, title })
    setDraft({ ...draft, title, categories: detectCategories(title, categoryGroups) })
  }

  return (
    <section className="tp-log-form">
      <header className="tp-log-form-head">
        <h2>やったことを足す</h2>
        <span className="tp-mono">{formatMD(day)}</span>
      </header>

      {recent.length > 0 && (
        <div className="tp-chips tp-log-recent" role="group" aria-label="記憶したタスクから入れる">
          {recent.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tp-fchip"
              onClick={() => {
                setDraft(applyTemplate(draft, t))
                setTouched(true)
                if (t.estimateMin && t.estimateMin > 0) setMinutes(t.estimateMin)
              }}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      <label className="tp-field">
        <span className="tp-label">やったこと</span>
        <input
          type="text"
          value={draft.title}
          placeholder="〜した の中身をそのまま"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <div className="tp-field">
        <span className="tp-label">区分</span>
        <button type="button" className="tp-cat-open" onClick={() => setPicking(true)} aria-label="区分を選ぶ">
          {draft.categories.length === 0 ? (
            <span className="tp-cat-empty">押して選ぶ（いくつでも）</span>
          ) : (
            <span className="tp-cat-list">
              {draft.categories.map((c) => (
                <CategoryChip key={c} label={c} color={colorOf(categoryGroups, c)} />
              ))}
            </span>
          )}
          <Icon name="chevron" size={16} className="tp-cat-open-caret" />
        </button>
      </div>

      {picking && (
        <CategorySheet
          groups={categoryGroups}
          selected={draft.categories}
          onChangeGroups={onChangeCategoryGroups}
          onCommit={(categories) => {
            setTouched(true)
            setDraft({ ...draft, categories })
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      )}

      <div className="tp-field-row tp-field-row-2">
        <label className="tp-field">
          <span className="tp-label">開始</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="tp-field tp-field-narrow">
          <span className="tp-label">かかった</span>
          <div className="tp-suffix">
            <input
              type="number"
              min={5}
              step={5}
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(Math.max(0, Number(e.target.value)))}
            />
            <span>分</span>
          </div>
        </label>
      </div>

      <div className="tp-chips" role="group" aria-label="かかった時間">
        {QUICK_MIN.map((m) => (
          <button
            key={m}
            type="button"
            className={`tp-fchip${minutes === m ? ' is-on' : ''}`}
            aria-pressed={minutes === m}
            onClick={() => setMinutes(m)}
          >
            {durationLabel(m)}
          </button>
        ))}
      </div>

      <label className="tp-field">
        <span className="tp-label">
          メモ <Icon name="pencil" size={12} />
        </span>
        <textarea
          rows={2}
          value={draft.note}
          placeholder="相手先・品番・数量・背景"
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
      </label>

      <p className="tp-hint tp-mono">
        {start} 〜 {endMin >= 1440 ? '翌日' : ''}
        {String(Math.floor((endMin % 1440) / 60)).padStart(2, '0')}:
        {String(endMin % 60).padStart(2, '0')} として記録します。
      </p>

      <div className="tp-row-end">
        <button
          type="button"
          className="tp-round-btn tp-round-cancel"
          onClick={onCancel}
          aria-label="やめる"
          title="やめる"
        >
          <Icon name="close" size={22} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          className="tp-round-btn tp-round-go"
          disabled={!draft.title.trim() || minutes <= 0}
          onClick={() => onCommit({ draft, day, start, minutes })}
          aria-label="記録する"
          title="記録する"
        >
          <Icon name="check" size={22} strokeWidth={2.4} />
        </button>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------
 * 区分から始める
 *
 * グループを押すと中の区分が開き、区分を押すとその場で1件立って動き出す。
 * ＋だけを押したときは立てるだけ（あとでやる物を放り込む用）。
 * ------------------------------------------------------- */

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
