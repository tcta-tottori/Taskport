import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { CategoryChip, catStyle } from '../components/CategoryChip'
import { CategorySheet } from './CategorySheet'
import { FilterBar } from '../components/FilterBar'
import { Segmented } from '../components/Segmented'
import { TaskCard } from '../components/TaskCard'
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
import { emptyDraft, filterByTab, LIST_TABS, sortTasks, type ListTab } from '../lib/tasks'
import { applyFilter, isFilterActive } from '../lib/taskFilter'
import { applyTemplate, rank } from '../lib/templates'
import { colorOf, detectCategories } from '../lib/workCategories'
import { taskMinutes } from '../lib/workday'
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
import { activeRuns, runSeconds, type RunBox } from '../lib/runs'
import type {
  CategoryGroup,
  Draft,
  SavedFilter,
  Settings,
  Task,
  TaskFilter,
  TaskTemplate,
} from '../types'

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
  today,
  settings,
  templates,
  runBox,
  onEdit,
  onToggle,
  onToggleRunning,
  onPatch,
  onAddLog,
  onQuickTask,
  onChangeCategoryGroups,
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
  onNotify,
}: {
  tasks: Task[]
  today: string
  settings: Settings
  templates: TaskTemplate[]
  /** 予定の実行の操作。タスクのほうは onToggleRunning */
  runBox: RunBox
  onEdit: (task: Task) => void
  onToggle: (task: Task) => void
  /** 手を付ける／手を止める */
  onToggleRunning: (task: Task) => void
  /** 実績（開始時刻・かかった時間）を直す */
  onPatch: (task: Task, patch: Partial<Task>) => void
  onAddLog: (entry: LogEntry) => void
  /** 区分から1件立てる。start が true ならそのまま始める */
  onQuickTask: (category: string, start: boolean) => void
  onChangeCategoryGroups: (next: CategoryGroup[]) => void
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
  onNotify: (text: string, tone?: 'ok' | 'error') => void
}) {
  const [day, setDay] = useState(today)
  const [adding, setAdding] = useState(false)
  /** 完了したぶんを開いているか。既定は畳んでおく */
  const [showDone, setShowDone] = useState(false)

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

  /** 記録のうち、まだ終わっていないもの（実行の面に出すのはこちらだけ） */
  const openRecords = useMemo(() => spent.tasks.filter((t) => t.status !== 'done'), [spent.tasks])
  /** 済ませたもの。件数だけ出し、押したときに開く */
  const doneRecords = useMemo(() => spent.tasks.filter((t) => t.status === 'done'), [spent.tasks])

  const ahead = diffDays(day, today) > 0
  /** 期限を過ぎた未完了の件数（朝の仕分けに出す） */
  const overdueCount = useMemo(
    () => open.filter((t) => !!t.due && diffDays(t.due, today) < 0).length,
    [open, today],
  )

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
          {day !== today && (
            <button type="button" className="tp-btn-ghost tp-log-today" onClick={() => setDay(today)}>
              今日へ
            </button>
          )}
        </section>

        {/* 朝の仕分け・明日の準備。一覧の画面から移した（v1.24.0） */}
        {isToday && (
          <div className="tp-flow-acts tp-log-acts">
            <button type="button" className="tp-btn-ghost" onClick={onTriage} disabled={overdueCount === 0}>
              <Icon name="alert" size={15} />
              朝の仕分け
              {overdueCount > 0 && <span className="tp-flow-n tp-mono">{overdueCount}</span>}
            </button>
            <button type="button" className="tp-btn-ghost" onClick={onWrapUp}>
              <Icon name="sun" size={15} />
              明日の準備
            </button>
          </div>
        )}

        {/* --- RUNNING（いま動いているもの）---
            **1件も動いていないときは面ごと出さない**（v1.24.0。利用者の指示）。
            空の枠が常に居座ると、次に見る「UP NEXT」が下がるだけになる。 */}
        {(live.length > 0 || livePlans.length > 0) && (
        <section className="tp-live">
          <p className="tp-label">RUNNING</p>
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

        {/* --- PAUSED（止めてあるもの）。押せばその場から続きを数える --- */}
        {(pausedTasks.length > 0 || pausedPlans.length > 0) && (
          <section className="tp-live tp-paused">
            <p className="tp-label">PAUSED</p>
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

        {/* --- 次にやる（今日締め）。今日を見ているときだけ出す --- */}
        {isToday && (
          <section className="tp-panel">
            <div className="tp-panel-head">
              <h2>UP NEXT</h2>
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
              <p className="tp-hint">ほか {upNext.length - 8} 件は下の TASKS で見られます。</p>
            )}
          </section>
        )}

        {/* --- 近日の締め --- */}
        {isToday && soon.length > 0 && (
          <section className="tp-panel">
            <div className="tp-panel-head">
              <h2>DUE SOON</h2>
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
              <p className="tp-hint">ほか {soon.length - 6} 件は下の TASKS の「今週」で見られます。</p>
            )}
          </section>
        )}
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

        {/* --- TODAY'S LOG（その日の記録）---
            完了したものは出さない（実行の面に済んだ仕事が積み上がると、
            いま手を動かすものが埋もれる）。実績を直したいときのために、
            件数だけは残して押すと開けるようにしてある。 */}
        <p className="tp-label tp-log-head">{isToday ? "TODAY'S LOG" : 'LOG'}</p>
        {spent.tasks.length === 0 ? (
          <div className="tp-empty">
            <Icon name="clock" size={26} />
            <p className="tp-empty-head">{formatMD(day)}の記録はありません</p>
            <p className="tp-empty-body">
              上の「やったことを足す」で、終わった仕事を後から入れられます。
              下の TASKS から「始める」を押した仕事も、ここに出ます。
            </p>
          </div>
        ) : (
          <>
            <ul className="tp-log-list">
              {openRecords.map((t) => (
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

            {doneRecords.length > 0 && (
              <>
                <button
                  type="button"
                  className="tp-done-toggle"
                  aria-expanded={showDone}
                  onClick={() => setShowDone((v) => !v)}
                >
                  <Icon name="check" size={14} strokeWidth={2.4} />
                  完了した {doneRecords.length}件
                  <Icon name="chevron" size={15} className={showDone ? 'tp-caret-up' : 'tp-caret-down'} />
                </button>
                {showDone && (
                  <ul className="tp-log-list">
                    {doneRecords.map((t) => (
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
              </>
            )}

            {openRecords.length === 0 && !showDone && (
              <p className="tp-empty-body">
                残っている仕事はありません。上の件数を押すと、済ませたぶんを見て直せます。
              </p>
            )}
          </>
        )}

        {/* --- 区分から始める。台帳に無い飛び込みの作業を1タップで立てる --- */}
        {isToday && (
          <section className="tp-panel tp-launch-panel">
            <div className="tp-panel-head">
              <h2>START BY CATEGORY</h2>
              <Icon name="grid" size={16} />
            </div>
            <p className="tp-note">
              台帳に無い飛び込みの作業を、区分1つで立てて始めます。件名は区分の名前で作られるので、
              あとから直せます。＋は立てるだけ。
            </p>
            <CategoryLauncher groups={settings.categoryGroups} onPick={onQuickTask} />
          </section>
        )}

        {/* --- TASKS（台帳）---
            v1.24.0 で一覧の画面をやめ、ここへ集約した（利用者の指示）。
            「いま動かす」と「台帳から探す」を行き来するのに画面を変えなくて済む。 */}
        <section className="tp-panel tp-tasks-panel">
          <div className="tp-panel-head">
            <h2>TASKS</h2>
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
                />
              ))}
            </ul>
          )}
        </section>

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
        <h2>ADD LOG</h2>
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
