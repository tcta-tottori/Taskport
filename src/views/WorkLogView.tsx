import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { CategoryChip } from '../components/CategoryChip'
import { CategorySheet } from './CategorySheet'
import {
  addDaysKey,
  diffDays,
  durationLabel,
  formatMD,
  isoAt,
  toMinutes,
} from '../lib/date'
import { emptyDraft } from '../lib/tasks'
import { applyTemplate, rank } from '../lib/templates'
import { colorOf, detectCategories } from '../lib/workCategories'
import { isWorkDay, workMinutes } from '../lib/workday'
import {
  daySpent,
  isRunning,
  loggedMinutes,
  logStartTime,
  roundedNow,
  running,
  runningMin,
} from '../lib/worklog'
import type { CategoryGroup, Draft, Settings, Task, TaskTemplate } from '../types'

/* =========================================================
 * 実績（いまやっている業務・やった業務）
 *
 * 一覧とスケジュールが「これから」を見る画面なのに対し、ここは
 * **手が動いた記録**だけを日ごとに見る画面。
 *
 *   1. いま動いているもの … 押した時刻から数えるだけ。画面を閉じても続く
 *   2. その日の記録        … 開始時刻とかかった時間をその場で直せる
 *   3. やったことを足す    … 会議や電話のように、台帳に無いまま終わった仕事を後から1件入れる
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
  onEdit,
  onToggle,
  onToggleRunning,
  onPatch,
  onAddLog,
  onChangeCategoryGroups,
  onNotify,
}: {
  tasks: Task[]
  today: string
  settings: Settings
  templates: TaskTemplate[]
  onEdit: (task: Task) => void
  onToggle: (task: Task) => void
  /** 手を付ける／手を止める */
  onToggleRunning: (task: Task) => void
  /** 実績（開始時刻・かかった時間）を直す */
  onPatch: (task: Task, patch: Partial<Task>) => void
  onAddLog: (entry: LogEntry) => void
  onChangeCategoryGroups: (next: CategoryGroup[]) => void
  onNotify: (text: string, tone?: 'ok' | 'error') => void
}) {
  const [day, setDay] = useState(today)
  const [adding, setAdding] = useState(false)

  const live = useMemo(() => running(tasks), [tasks])
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
                    <span className="tp-live-meta tp-mono">
                      {logStartTime(t)} から {durationLabel(runningMin(t))}
                    </span>
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
        </section>

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

        <p className="tp-list-foot">
          日報の書き出しはこの記録から作ります。実績が入っていない仕事は見込みの時間で並びます。
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
