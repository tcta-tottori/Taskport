import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { catStyle } from '../components/CategoryChip'
import { FilterBar } from '../components/FilterBar'
import { Segmented } from '../components/Segmented'
import { TaskCard } from '../components/TaskCard'
import {
  addDaysKey,
  clockLabel,
  diffDays,
  dueLabel,
  durationLabel,
  durationShort,
  formatMD,
  formatMDShort,
} from '../lib/date'
import { filterByTab, LIST_TABS, sortTasks, type ListTab } from '../lib/tasks'
import { jobOf } from '../lib/jobs'
import { applyFilter, isFilterActive } from '../lib/taskFilter'
import { colorOf, primaryCategory } from '../lib/workCategories'
import { taskMinutes } from '../lib/workday'
import { daySpent, isRunning, running, runningSec } from '../lib/worklog'
import { topRoutines, ROUTINE_DAYS, type Routine } from '../lib/routines'
import { activeRuns, runSeconds, type RunBox } from '../lib/runs'
import type {
  Job,
  SavedFilter,
  Settings,
  Task,
  TaskFilter,
} from '../types'

/* =========================================================
 * 実行（いま手を動かすもの）
 *
 * 一覧とスケジュールが「これから」を見る画面なのに対し、ここは
 * **いま何に手を付けるか**の面。
 *
 *   1. 実行中   … タスクと予定。押した時刻から数える（画面を閉じても続く）
 *   2. 停止中   … 止めてあるもの。▶ で続きから数える
 *   3. よくやる業務 … 押して動かした記録から上位3件。1押しで始まる（v1.31.0）
 *   4. 次の作業 … 今日締めのものを上から。▶ でその場で始まる
 *   5. 近日締切 … 明日から1週間。前倒しできるものを拾う
 *   6. タスク   … 台帳（検索・絞り込み・4つのタブ）
 *
 * v1.28.0（利用者の指示）で、この画面から次の3つを外した。
 *   - やったことを足す … スケジュール（DAY）と分析（その日）から開く
 *   - その日の記録     … 実績を直すのは分析の面（`ActualSheet`）
 *   - 区分から開始     … 右下の ＋ の扇に同じ道がある
 * 同じ道を2か所に置かない、という決まりに揃えたもの。
 *
 * 【実績をどこが持つか】
 *   タスク … 台帳（`Task.startedAt` / `Task.actualMin`。`lib/worklog.ts`）
 *   予定   … 予定の実行ログ（`lib/runs.ts`）。予定はタスクではないので台帳に置けない
 * 1つの仕事が2か所に記録されないよう、この分担を崩さない。
 * =======================================================*/

export function WorkLogView({
  tasks,
  today,
  settings,
  runBox,
  onEdit,
  onToggle,
  onToggleRunning,
  onToggleSubtask,
  tab,
  onTabChange,
  filter,
  onFilterChange,
  saved,
  onSaveFilter,
  onRemoveSavedFilter,
  onTriage,
  onWrapUp,
  onStartRoutine,
  jobs,
}: {
  tasks: Task[]
  today: string
  settings: Settings
  /** 予定の実行の操作。タスクのほうは onToggleRunning */
  runBox: RunBox
  onEdit: (task: Task) => void
  onToggle: (task: Task) => void
  /** 手を付ける／手を止める */
  onToggleRunning: (task: Task) => void
  /** 台帳（TASKS）の操作。一覧の画面をここへ集約した（v1.24.0） */
  onToggleSubtask: (task: Task, subtaskId: string) => void
  tab: ListTab
  onTabChange: (tab: ListTab) => void
  filter: TaskFilter
  onFilterChange: (next: TaskFilter) => void
  saved: SavedFilter[]
  onSaveFilter: (name: string) => void
  onRemoveSavedFilter: (id: string) => void
  /** 朝の仕分け・明日の準備 */
  onTriage: () => void
  onWrapUp: () => void
  /** よくやる業務を押したとき（台帳にあればそれを、無ければ1件立てて始める） */
  onStartRoutine: (routine: Routine) => void
  /** 案件（工数の単位）。カードに名前を出すために使う */
  jobs: Job[]
}) {
  const [day, setDay] = useState(today)

  const live = useMemo(() => running(tasks), [tasks])

  /* 実行中の経過時間は秒まで出す。動いているものがあるときだけ1秒ごとに書き換える。 */
  const [tick, setTick] = useState(() => Date.now())
  // 予定ぶんの記録だけ。タスクは台帳（startedAt / actualMin）で見る
  const activePlans = useMemo(
    () => activeRuns(runBox.runs).filter((r) => r.kind === 'plan'),
    [runBox.runs],
  )
  /** 動いている予定 */
  const livePlans = useMemo(() => activePlans.filter((r) => r.state === 'running'), [activePlans])
  /** 止めてある予定（あとで再開できる） */
  const pausedPlans = useMemo(() => activePlans.filter((r) => r.state === 'paused'), [activePlans])
  const anyWorkRunning = livePlans.length > 0
  const anyRunning = anyWorkRunning || live.length > 0
  useEffect(() => {
    if (!anyRunning) return
    const id = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [anyRunning])
  const box: RunBox = { ...runBox, nowMs: anyRunning ? tick : runBox.nowMs }

  const isToday = day === today

  const open = useMemo(() => tasks.filter((t) => t.status === 'open'), [tasks])
  /** 今日締め（超過ぶんを含む）。動かしている最中のものは外す（同じ物が2か所に出ると迷う） */
  const upNext = useMemo(
    () =>
      sortTasks(
        open.filter(
          (t) =>
            !!t.due &&
            diffDays(t.due, today) <= 0 &&
            !isRunning(t) &&
            // 止めてあるものは上に出ているので、ここには出さない
            !(typeof t.actualMin === 'number' && t.actualMin > 0),
        ),
      ),
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
  const spent = useMemo(
    () => daySpent(tasks, day, settings.defaultEstimateMin, box.runs),
    [tasks, day, settings.defaultEstimateMin, box.runs],
  )
  /**
   * 止めてあるタスク。手を付けて止めた（実績が入っている）が、まだ終わっていないもの。
   * 一度触ったものは、探し直さずに ▶ で戻れるようにする。
   */
  const pausedTasks = useMemo(
    () =>
      sortTasks(
        spent.tasks.filter(
          (t) => t.status === 'open' && !isRunning(t) && typeof t.actualMin === 'number' && t.actualMin > 0,
        ),
      ),
    [spent.tasks],
  )

  /**
   * よくやる業務（v1.31.0。利用者の指示）。
   * 押して動かした記録から「やった日の多い順」に上位3件。数え方は `lib/routines.ts`。
   * 動かしている最中のものは出さない（上の実行中に出ているし、押すと止まる）。
   */
  const routines = useMemo(
    () => topRoutines(tasks, box.runs, today, 3),
    [tasks, box.runs, today],
  )

  const ahead = diffDays(day, today) > 0

  /* --- 台帳（TASKS）。一覧の画面をここへ集約した --- */
  const counts = useMemo(
    () =>
      LIST_TABS.reduce<Record<string, number>>((acc, t) => {
        acc[t.key] = filterByTab(tasks, t.key, today).length
        return acc
      }, {}),
    [tasks, today],
  )
  const searching = isFilterActive(filter)
  // 絞り込み中はタブを離れ、台帳の全件から探す
  const found = useMemo(
    () => (searching ? applyFilter(tasks, filter, today, settings.categoryGroups) : []),
    [tasks, filter, today, searching, settings.categoryGroups],
  )
  const shown = useMemo(
    () => (searching ? found : filterByTab(tasks, tab, today)),
    [searching, found, tasks, tab, today],
  )

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
        </section>

        {/* 朝の仕分け・明日の準備。一覧の画面から移した（v1.24.0）。
            v1.28.0 で**件数の札を外し、押せない灰色もやめた**（利用者の指示）。
            片方だけ灰色だと壊れているように見え、札の有無でも大きさが揃わなかった。 */}
        {isToday && (
          <div className="tp-flow-acts tp-log-acts">
            <button type="button" className="tp-btn-ghost" onClick={onTriage}>
              <Icon name="alert" size={15} />
              朝の仕分け
            </button>
            <button type="button" className="tp-btn-ghost" onClick={onWrapUp}>
              <Icon name="sun" size={15} />
              明日の準備
            </button>
          </div>
        )}

        {/* --- 実行中（いま動いているもの）---
            **1件も動いていないときは面ごと出さない**（v1.24.0。利用者の指示）。
            空の枠が常に居座ると、次に見る「UP NEXT」が下がるだけになる。 */}
        {(live.length > 0 || livePlans.length > 0) && (
        <section className="tp-live">
          <p className="tp-label">実行中</p>
          {live.length === 0 ? null : (
            <ul className="tp-live-list">
              {live.map((t) => (
                <li key={t.id} className="tp-live-row">
                  <span className="tp-live-dot" aria-hidden="true" />
                  <button type="button" className="tp-live-body" onClick={() => onEdit(t)}>
                    <span className="tp-live-title">{t.title}</span>
                    {/* 出すのは経過時間だけ。始めた時刻や区分は下の記録で読める */}
                    <span className="tp-live-meta tp-mono">{clockLabel(runningSec(t, tick))}</span>
                  </button>
                  {/* 記号だけにする（v1.18.1 と同じ扱い）。言葉は読み上げと長押しで出る */}
                  <button
                    type="button"
                    className="tp-run-btn tp-run-pause"
                    aria-label={`${t.title} の手を止める`}
                    title="止める"
                    onClick={() => onToggleRunning(t)}
                  >
                    <Icon name="pause" size={16} />
                  </button>
                  <button
                    type="button"
                    className="tp-live-done"
                    aria-label={`${t.title} を完了にする`}
                    title="完了"
                    onClick={() => onToggle(t)}
                  >
                    <Icon name="check" size={18} strokeWidth={2.6} />
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
                    className={`tp-run-btn ${r.state === 'running' ? 'tp-run-pause' : 'tp-run-start'}`}
                    aria-label={`${r.title} を${r.state === 'running' ? '止める' : '再開する'}`}
                    title={r.state === 'running' ? '止める' : '再開'}
                    onClick={() => (r.state === 'running' ? box.pause(r) : box.resume(r))}
                  >
                    <Icon name={r.state === 'running' ? 'pause' : 'play'} size={16} />
                  </button>
                  <button
                    type="button"
                    className="tp-run-btn tp-run-stop"
                    aria-label={`${r.title} を終了する`}
                    title="終了"
                    onClick={() => box.finish(r)}
                  >
                    <Icon name="stop" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}

        </section>
        )}

        {/* --- 停止中（止めてあるもの）。押せばその場から続きを数える --- */}
        {(pausedTasks.length > 0 || pausedPlans.length > 0) && (
          <section className="tp-live tp-paused">
            <p className="tp-label">停止中</p>
            <ul className="tp-live-list">
              {pausedTasks.map((t) => (
                <li key={t.id} className="tp-live-row is-paused">
                  <span className="tp-live-dot" aria-hidden="true" />
                  <button type="button" className="tp-live-body" onClick={() => onEdit(t)}>
                    <span className="tp-live-title">{t.title}</span>
                    <span className="tp-live-meta tp-mono">ここまで {durationLabel(t.actualMin ?? 0)}</span>
                  </button>
                  <button
                    type="button"
                    className="tp-run-btn tp-run-start"
                    aria-label={`${t.title} を再開する`}
                    title="再開"
                    onClick={() => onToggleRunning(t)}
                  >
                    <Icon name="play" size={16} />
                  </button>
                  <button
                    type="button"
                    className="tp-live-done"
                    aria-label={`${t.title} を完了にする`}
                    title="完了"
                    onClick={() => onToggle(t)}
                  >
                    <Icon name="check" size={18} strokeWidth={2.6} />
                  </button>
                </li>
              ))}
              {pausedPlans.map((r) => (
                <li key={r.id} className="tp-live-row tp-live-plan is-paused">
                  <span className="tp-live-dot" aria-hidden="true" />
                  <span className="tp-live-body">
                    <span className="tp-live-title">{r.title}</span>
                    <span className="tp-live-meta tp-mono">ここまで {clockLabel(runSeconds(r, box.nowMs))}</span>
                  </span>
                  <button
                    type="button"
                    className="tp-run-btn tp-run-start"
                    aria-label={`${r.title} を再開する`}
                    title="再開"
                    onClick={() => box.resume(r)}
                  >
                    <Icon name="play" size={16} />
                  </button>
                  <button
                    type="button"
                    className="tp-run-btn tp-run-stop"
                    aria-label={`${r.title} を終了する`}
                    title="終了"
                    onClick={() => box.finish(r)}
                  >
                    <Icon name="stop" size={15} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="tp-hint">▶ を押すと、止めたところから続きを数えます。</p>
          </section>
        )}

        {live.length + livePlans.length > 1 && (
          <p className="tp-hint tp-live-warn">
            同時に {live.length + livePlans.length} 件を数えています。合計が実時間を超えるので、
            置いた作業は ⏸ で止めてください。
          </p>
        )}

        {/* --- よくやる業務（v1.31.0。利用者の指示）---
            同じ仕事は何度も回ってくるので、台帳から探さずに1押しで始められるようにする。
            出すのは上位3件だけ。並べすぎると「次の作業」が下がって、
            いま締めるべきものが見えなくなる。 */}
        {isToday && routines.length > 0 && (
          <section className="tp-panel">
            <div className="tp-panel-head">
              <h2>よくやる業務</h2>
              <span className="tp-badge tp-mono">直近{ROUTINE_DAYS}日</span>
            </div>
            {/* 行の作りは「次の作業」と同じ（▶ が左、件名が大きく、下に小さく数字）。
                面ごとに ▶ の位置が変わると壊れて見える（CLAUDE.md §9）。
                違うのは**行ぜんぶが1つの押しどころ**なところで、
                ここは開くのではなく始めるための面だから。 */}
            <ul className="tp-uplist">
              {routines.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    className="tp-up tp-routine"
                    style={r.category ? catStyle(colorOf(settings.categoryGroups, r.category)) : undefined}
                    aria-label={`${r.title} を始める。直近${ROUTINE_DAYS}日で ${r.days}日、1日あたり平均 ${durationLabel(r.avgMin)}`}
                    onClick={() => onStartRoutine(r)}
                  >
                    <span className="tp-up-run" aria-hidden="true">
                      <Icon name="play" size={18} />
                    </span>
                    <span className="tp-up-body">
                      <span className="tp-up-title">{r.title}</span>
                      <span className="tp-up-meta">
                        <span className="tp-mono">{r.days}日</span>
                        <span className="tp-mono">平均 {durationShort(r.avgMin)}</span>
                        {r.category && (
                          <span
                            className="tp-up-cat"
                            style={catStyle(colorOf(settings.categoryGroups, r.category))}
                          >
                            <span className="tp-cat-dot" aria-hidden="true" />
                            {r.category}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="tp-hint">
              押すとその場で始まります。台帳に同じ件名の未完了があればそれを、
              無ければ1件立てて始めます（件名と区分はあとから直せます）。
              数字は<b>やった日の数</b>と、1日あたりに測った時間です。
            </p>
          </section>
        )}

        {/* --- 次の作業（今日締め）。今日を見ているときだけ出す --- */}
        {isToday && (
          <section className="tp-panel">
            <div className="tp-panel-head">
              <h2>次の作業</h2>
              <span className="tp-badge tp-mono">{upNext.length}</span>
            </div>
            {upNext.length === 0 ? (
              <p className="tp-empty-body">
                今日締めのタスクは残っていません。近日締切を前倒しするか、右下の ＋ から1件立ててください。
              </p>
            ) : (
              <ul className="tp-uplist">
                {upNext.slice(0, 8).map((t, i) => (
                  <UpRow
                    key={t.id}
                    task={t}
                    today={today}
                    settings={settings}
                    first={i === 0}
                    onEdit={onEdit}
                    onStart={onToggleRunning}
                  />
                ))}
              </ul>
            )}
            {upNext.length > 8 && (
              <p className="tp-hint">ほか {upNext.length - 8} 件は下のタスク一覧で見られます。</p>
            )}
          </section>
        )}

        {/* --- 近日の締め --- */}
        {isToday && soon.length > 0 && (
          <section className="tp-panel">
            <div className="tp-panel-head">
              <h2>近日締切</h2>
              <span className="tp-badge tp-mono">{soon.length}</span>
            </div>
            <ul className="tp-uplist">
              {soon.slice(0, 6).map((t) => (
                <UpRow
                  key={t.id}
                  task={t}
                  today={today}
                  settings={settings}
                  onEdit={onEdit}
                  onStart={onToggleRunning}
                />
              ))}
            </ul>
            {soon.length > 6 && (
              <p className="tp-hint">ほか {soon.length - 6} 件は下のタスク一覧の「今週」で見られます。</p>
            )}
          </section>
        )}
      </div>

      <div className="tp-col">
        {/* --- タスク（台帳）---
            v1.24.0 で一覧の画面をやめ、ここへ集約した（利用者の指示）。
            「いま動かす」と「台帳から探す」を行き来するのに画面を変えなくて済む。 */}
        <section className="tp-panel tp-tasks-panel">
          <div className="tp-panel-head">
            <h2>タスク</h2>
            <span className="tp-badge tp-mono">{shown.length}</span>
          </div>

          <div className="tp-sticky">
            <FilterBar
              filter={filter}
              categoryGroups={settings.categoryGroups}
              onChange={onFilterChange}
              saved={saved}
              onSave={onSaveFilter}
              onRemoveSaved={onRemoveSavedFilter}
              hits={found.length}
            />
            {!searching && (
              <Segmented
                items={LIST_TABS.map((t) => ({ ...t, count: counts[t.key] ?? 0 }))}
                value={tab}
                onChange={onTabChange}
                ariaLabel="表示するタスクの範囲"
              />
            )}
          </div>

          {shown.length === 0 ? (
            <p className="tp-empty-body">
              {searching
                ? '当てはまるタスクはありません。語を短くするか、区分・優先度・期限の条件を外してみてください。'
                : '出すものがありません。右下の ＋ から、歩きながらならマイク、机の前なら手描き。'}
            </p>
          ) : (
            <ul className="tp-list">
              {shown.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  today={today}
                  onToggle={onToggle}
                  onEdit={onEdit}
                  onToggleSubtask={onToggleSubtask}
                  onToggleRunning={onToggleRunning}
                  workHours={settings.workHours}
                  categoryGroups={settings.categoryGroups}
                  jobName={jobOf(jobs, task.jobId)?.name ?? null}
                />
              ))}
            </ul>
          )}
        </section>

        <p className="tp-list-foot">
          やったことを後から足す・実績を直すのは、スケジュールの DAY と分析のその日から。
          日報の書き出しはその記録から作ります。
        </p>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------
 * 次にやる1件
 *
 * v1.28.0（利用者の指示）で作り直した。
 *   - **✓（完了）の丸を外す**。この面は「次に手を付けるもの」を選ぶ場所で、
 *     済ませる操作は行を開いた先（編集画面）にある
 *   - **▶ を左端に置く**。押す物が1つになったので、迷う余地を無くす
 *   - 行は1枚のカードにして、件名を大きく、期限・見込み・区分を下の行に小さく
 * ------------------------------------------------------- */

function UpRow({
  task,
  today,
  settings,
  first = false,
  onEdit,
  onStart,
}: {
  task: Task
  today: string
  settings: Settings
  /** いちばん上（「次」の札を出す） */
  first?: boolean
  onEdit: (task: Task) => void
  onStart: (task: Task) => void
}) {
  const over = !!task.due && diffDays(task.due, today) < 0
  const cat = primaryCategory(task.categories)
  const ahead = task.due ? diffDays(task.due, today) : 0
  return (
    <li className={`tp-up tp-pri-${task.priority}${first ? ' is-next' : ''}`}>
      <button
        type="button"
        className="tp-up-run"
        aria-label={`${task.title} を始める`}
        title="始める"
        onClick={() => onStart(task)}
      >
        <Icon name="play" size={18} />
      </button>
      <button
        type="button"
        className="tp-up-body"
        aria-label={`${task.title} を開く`}
        onClick={() => onEdit(task)}
      >
        <span className="tp-up-title">
          {first && <b className="tp-next-tag">次</b>}
          {task.title}
        </span>
        <span className="tp-up-meta">
          <span className={`tp-mono${over ? ' tp-over' : ''}`}>
            {task.dueTime
              ? `${task.dueTime} 締め`
              : ahead >= 1
                ? `${formatMDShort(task.due as string)}（あと${ahead}日）`
                : dueLabel(task.due, today)}
          </span>
          <span className="tp-mono">{durationLabel(taskMinutes(task, settings.defaultEstimateMin))}</span>
          {cat && (
            <span className="tp-up-cat" style={catStyle(colorOf(settings.categoryGroups, cat))}>
              <span className="tp-cat-dot" aria-hidden="true" />
              {cat}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
