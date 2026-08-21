import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { CategoryChip } from '../components/CategoryChip'
import { TimeField } from '../components/TimeField'
import { durationLabel, formatMD, formatMDShort, isoAt } from '../lib/date'
import { logDay, logStartTime, loggedMinutes } from '../lib/worklog'
import { colorOf } from '../lib/workCategories'
import type { CategoryGroup, Task } from '../types'

/* =========================================================
 * 実績を直す
 *
 * 円グラフの区分や、時間帯の帯を押したときに開く。
 * 直すのは**かかった時間と開始時刻**の2つだけ（件名や期限は編集画面で）。
 *
 * 実行ログ（区間）は書き換えない。あれは「実際に押した時刻」の記録で、
 * ここで直すのは台帳側の合計（`actualMin`）。数字が食い違ったときは、
 * 人が入れたほうを正とする。
 *
 * この面は画面の中（`.tp-main`）から開くので、body へ出して描く。
 * `.tp-main` は重なりの基準になっていて、その中に置くと ＋ ボタンの下へ潜り、
 * 閉じるボタンが押せなくなる。
 * =======================================================*/

/** よく使う長さ。押すだけで入る */
const QUICK = [15, 30, 45, 60, 90, 120]

export function ActualSheet({
  tasks,
  day,
  label,
  title,
  categoryGroups,
  defaultEstimateMin,
  onPatch,
  onClose,
}: {
  /** 直せる仕事（その日の記録から絞ったもの） */
  tasks: Task[]
  /** 日が分からない記録の受け皿（週・月で開いたときは期間の始まり） */
  day: string
  /** 見出しに出す期間の名前。無ければ day を出す */
  label?: string
  /** 見出しの補足（区分の名前など） */
  title?: string
  categoryGroups: CategoryGroup[]
  defaultEstimateMin: number
  onPatch: (task: Task, patch: Partial<Task>) => void
  onClose: () => void
}) {
  return createPortal(
    <div className="tp-sheet tp-sheet-over" role="dialog" aria-modal="true" aria-label="実績を直す">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>実績を直す</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <p className="tp-note">
            {label ?? formatMD(day)}
            {title ? ` ／ ${title}` : ''} の記録です。
            <b>かかった時間</b>と<b>開始時刻</b>を直せます。件名や期限はカードから。
          </p>

          {tasks.length === 0 ? (
            <p className="tp-empty-body">
              直せる記録がありません。予定（打合せなど）の時間は、実行の画面で開始・終了を押した記録から作られます。
            </p>
          ) : (
            <ul className="tp-actual-list">
              {tasks.map((t) => (
                <ActualRow
                  key={t.id}
                  task={t}
                  day={day}
                  categoryGroups={categoryGroups}
                  defaultEstimateMin={defaultEstimateMin}
                  onPatch={onPatch}
                />
              ))}
            </ul>
          )}
        </div>

        <footer className="tp-sheet-foot">
          <button type="button" className="tp-btn-primary" onClick={onClose}>
            <Icon name="check" size={16} />
            閉じる
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

export function ActualRow({
  task,
  day,
  categoryGroups,
  defaultEstimateMin,
  onPatch,
}: {
  task: Task
  /** 日が分からないときの受け皿。記録そのものが日を持っていればそちらを使う */
  day: string
  categoryGroups: CategoryGroup[]
  defaultEstimateMin: number
  onPatch: (task: Task, patch: Partial<Task>) => void
}) {
  // 期間（週・月）で開いたときは、行ごとに日が違う。
  // 開始時刻を直すときは**その記録の日**で組み立てる（違う日に飛ばさない）。
  const rowDay = logDay(task) ?? day
  const [min, setMin] = useState<string>(
    typeof task.actualMin === 'number' && task.actualMin > 0 ? String(task.actualMin) : '',
  )
  const start = logStartTime(task)
  const shown = loggedMinutes(task, defaultEstimateMin)

  const commit = (value: string) => {
    setMin(value)
    const n = Number(value)
    onPatch(task, { actualMin: value === '' || n <= 0 ? null : Math.round(n) })
  }

  return (
    <li className={`tp-actual-row tp-pri-${task.priority}`}>
      <p className="tp-actual-title">
        {rowDay !== day && <span className="tp-mono tp-actual-day">{formatMDShort(rowDay)}</span>}
        {task.title}
      </p>
      <p className="tp-actual-cats">
        {task.categories.map((c) => (
          <CategoryChip key={c} label={c} color={colorOf(categoryGroups, c)} />
        ))}
        {task.actualMin === null && <span className="tp-chip-est">見込み {durationLabel(shown)}</span>}
      </p>

      <div className="tp-field-row-2">
        <label className="tp-field">
          <span className="tp-label">開始</span>
          <TimeField
            value={start}
            ariaLabel={`${task.title} の開始時刻`}
            onChange={(v) => onPatch(task, { startedAt: v ? isoAt(rowDay, v) : null })}
          />
        </label>
        <label className="tp-field">
          <span className="tp-label">かかった</span>
          <div className="tp-suffix">
            <input
              type="number"
              min={0}
              step={5}
              inputMode="numeric"
              value={min}
              placeholder={String(shown)}
              onChange={(e) => commit(e.target.value)}
            />
            <span>分</span>
          </div>
        </label>
      </div>

      <div className="tp-chips tp-actual-quick">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            className={`tp-fchip${Number(min) === q ? ' is-on' : ''}`}
            onClick={() => commit(String(q))}
          >
            {durationLabel(q)}
          </button>
        ))}
      </div>
    </li>
  )
}
