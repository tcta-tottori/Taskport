import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { CategoryChip } from '../components/CategoryChip'
import { CategorySheet } from './CategorySheet'
import { durationLabel, formatMD, toMinutes } from '../lib/date'
import { roundedNow } from '../lib/worklog'
import { emptyDraft } from '../lib/tasks'
import { applyTemplate, rank } from '../lib/templates'
import { colorOf, detectCategories } from '../lib/workCategories'
import type { CategoryGroup, Draft, LogEntry, TaskTemplate } from '../types'

/* =========================================================
 * やったことを足す
 *
 * 会議・電話・応援など、台帳に無いまま終わった仕事を後から入れる。
 * 件名・区分・開始時刻・かかった時間だけ聞く。優先度も期限も聞かない
 * （もう終わった仕事に、これからの話を書かせない）。
 *
 * v1.28.0（利用者の指示）で、実行の画面から**スケジュールと分析**へ移した。
 * 実行の画面は「いま手を動かすもの」だけにし、後から足すのは
 * その日を見ている画面（DAY の軸・分析のその日）から開く。
 *
 * 画面の中（`.tp-main`）から開くので body へ出して描く
 * （`.tp-main` は重なりの基準で、中に置くと ＋ の下へ潜って閉じられない）。
 *
 * **先の日には開かない**（v1.26.0）。まだ起きていない仕事を実績にしない。
 * 呼ぶ側が day を渡すときに確かめる。
 * =======================================================*/

export function AddLogSheet({
  day,
  templates,
  categoryGroups,
  onChangeCategoryGroups,
  onCommit,
  onClose,
}: {
  day: string
  templates: TaskTemplate[]
  categoryGroups: CategoryGroup[]
  onChangeCategoryGroups: (next: CategoryGroup[]) => void
  onCommit: (entry: LogEntry) => void
  onClose: () => void
}) {
  return createPortal(
    <div className="tp-sheet tp-sheet-over" role="dialog" aria-modal="true" aria-label="やったことを足す">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>やったことを足す</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <p className="tp-note">
            <b className="tp-mono">{formatMD(day)}</b> の記録として入れます。
            会議・電話・応援など、台帳に無いまま終わった仕事のためのものです。
          </p>
          <AddLogBody
            day={day}
            templates={templates}
            categoryGroups={categoryGroups}
            onChangeCategoryGroups={onChangeCategoryGroups}
            onCommit={onCommit}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** よく使う長さ。押すだけで入る */
const QUICK_MIN = [15, 30, 45, 60, 90, 120]

function AddLogBody({
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
    <>
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
    </>
  )
}

