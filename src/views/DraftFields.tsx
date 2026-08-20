import { useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { CategoryChip } from '../components/CategoryChip'
import { TimeField } from '../components/TimeField'
import { CategorySheet } from './CategorySheet'
import {
  PRIORITIES,
  PRIORITY_LABEL,
  type CategoryGroup,
  type Draft,
  type Job,
  type RepeatUnit,
  type Subtask,
  type WorkHours,
} from '../types'
import { colorOf, detectCategories } from '../lib/workCategories'
import { jobLabel } from '../lib/jobs'
import { emptyRepeat, REPEAT_UNITS } from '../lib/repeat'
import { bands } from '../lib/timebox'
import { weekdayOf } from '../lib/date'
import { ulid } from '../lib/ulid'

/**
 * Draft 1件ぶんの編集フォーム。
 * 確認画面（ReviewSheet）と編集画面（TaskEditor）で同じ形にして、
 * 「見た目が違うから設定を見落とす」ことがないようにする。
 */
export function DraftFields({
  draft,
  onChange,
  idPrefix,
  workHours,
  categoryGroups,
  onChangeCategoryGroups,
  jobs,
}: {
  draft: Draft
  onChange: (patch: Partial<Draft>) => void
  idPrefix: string
  /** 時間枠の並びを勤務時間から作るために使う */
  workHours: WorkHours
  /** 区分のマスタ（設定が持つ） */
  categoryGroups: CategoryGroup[]
  /** 区分の選択画面でマスタを直したとき */
  onChangeCategoryGroups: (next: CategoryGroup[]) => void
  /** 案件（工数の単位）。締めたものは選べない */
  jobs: Job[]
}) {
  const repeat = draft.repeat
  const WEEK = ['日', '月', '火', '水', '木', '金', '土']
  const [picking, setPicking] = useState(false)

  /**
   * 件名から自動で入れた区分。人が自分で選んだら null にして、以後は触らない
   * （選び直したものを、件名を直した拍子に上書きしないため）。
   */
  const autoRef = useRef<string[] | null>(draft.categories.length === 0 ? [] : null)

  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

  /** 件名を変える。区分をまだ人が触っていなければ、名前から当てて入れておく。 */
  const setTitle = (title: string) => {
    const auto = autoRef.current
    if (auto !== null && (draft.categories.length === 0 || same(draft.categories, auto))) {
      const next = detectCategories(title, categoryGroups)
      autoRef.current = next
      onChange({ title, categories: next })
      return
    }
    onChange({ title })
  }

  const autoFilled =
    autoRef.current !== null &&
    autoRef.current.length > 0 &&
    same(draft.categories, autoRef.current)

  const setUnit = (unit: RepeatUnit | null) => {
    if (!unit) return onChange({ repeat: null })
    const weekdays =
      unit === 'week' && repeat?.weekdays.length
        ? repeat.weekdays
        : unit === 'week' && draft.due
          ? [weekdayOf(draft.due)]
          : []
    onChange({ repeat: { ...emptyRepeat(unit), weekdays, until: repeat?.until ?? null } })
  }

  const setSubtasks = (subtasks: Subtask[]) => onChange({ subtasks })
  const doneCount = draft.subtasks.filter((s) => s.done).length

  return (
    <div className="tp-fields">
      <label className="tp-field">
        <span className="tp-label">件名</span>
        <input
          id={`${idPrefix}-title`}
          type="text"
          value={draft.title}
          placeholder="〜する の形で書く"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <div className="tp-field-row tp-field-row-4">
        <label className="tp-field tp-field-wide">
          <span className="tp-label">期限</span>
          <input
            type="date"
            value={draft.due ?? ''}
            onChange={(e) => onChange({ due: e.target.value || null })}
          />
        </label>
        <div className="tp-field">
          <span className="tp-label">時刻</span>
          <TimeField
            value={draft.dueTime}
            ariaLabel="時刻"
            onChange={(dueTime) => onChange({ dueTime })}
          />
        </div>
        <label className="tp-field tp-field-narrow">
          <span className="tp-label">見込み</span>
          <div className="tp-suffix">
            <input
              type="number"
              min={0}
              step={5}
              inputMode="numeric"
              value={draft.estimateMin ?? ''}
              placeholder="—"
              onChange={(e) => {
                const v = Number(e.target.value)
                onChange({ estimateMin: e.target.value === '' || v <= 0 ? null : v })
              }}
            />
            <span>分</span>
          </div>
        </label>
        {/* 実績。見込みと同じ欄に入れない（片方を直すともう片方の意味が変わる） */}
        <label className="tp-field tp-field-narrow">
          <span className="tp-label">実績</span>
          <div className="tp-suffix">
            <input
              type="number"
              min={0}
              step={5}
              inputMode="numeric"
              value={draft.actualMin ?? ''}
              placeholder="—"
              onChange={(e) => {
                const v = Number(e.target.value)
                onChange({ actualMin: e.target.value === '' || v <= 0 ? null : Math.round(v) })
              }}
            />
            <span>分</span>
          </div>
        </label>
      </div>
      <p className="tp-hint">
        「見込み」は積み上げの計算に、「実績」は日報と区分ごとの時間に使います。
        実績は完了にしたときにも入ります（始めてから完了までを数えます）。
      </p>

      <div className="tp-field">
        <span className="tp-label">優先度</span>
        <div className="tp-pri-pick" role="group" aria-label="優先度">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              className={`tp-pri-btn tp-pri-${p}${draft.priority === p ? ' is-on' : ''}`}
              aria-pressed={draft.priority === p}
              onClick={() => onChange({ priority: p })}
            >
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {/* 区分は複数選べる。数が多いので、押すと出る画面で階層から選ぶ。 */}
      <div className="tp-field">
        <span className="tp-label">区分</span>
        <button
          type="button"
          className="tp-cat-open"
          onClick={() => setPicking(true)}
          aria-label="区分を選ぶ"
        >
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
        {autoFilled && <p className="tp-hint">件名から当てました。違うときは押して選び直してください。</p>}
      </div>

      {/* 案件（工数の単位）。区分が「何をしたか」、案件は「何のためにしたか」 */}
      <label className="tp-field">
        <span className="tp-label">案件</span>
        <select
          value={draft.jobId ?? ''}
          onChange={(e) => onChange({ jobId: e.target.value || null })}
        >
          <option value="">案件なし</option>
          {jobs
            .filter((j) => !j.closed || j.id === draft.jobId)
            .map((j) => (
              <option key={j.id} value={j.id}>
                {jobLabel(j)}
                {j.closed ? '（締め）' : ''}
              </option>
            ))}
        </select>
        <p className="tp-hint">
          {jobs.length === 0
            ? '案件は工数の画面（JOBS）で作れます。入れると、押して測った時間がその案件に積まれます。'
            : '押して測った時間が、選んだ案件の工数に積まれます。'}
        </p>
      </label>

      {picking && (
        <CategorySheet
          groups={categoryGroups}
          selected={draft.categories}
          onChangeGroups={onChangeCategoryGroups}
          onCommit={(categories) => {
            autoRef.current = null
            onChange({ categories })
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      )}

      <div className="tp-field">
        <span className="tp-label">
          時間枠 <Icon name="clock" size={12} />
        </span>
        <div className="tp-chips" role="group" aria-label="どの時間帯にやるか">
          <button
            type="button"
            className={`tp-fchip${!draft.timebox ? ' is-on' : ''}`}
            aria-pressed={!draft.timebox}
            onClick={() => onChange({ timebox: null })}
          >
            決めない
          </button>
          {bands(workHours).map((b) => (
            <button
              key={b.key}
              type="button"
              className={`tp-fchip${draft.timebox === b.key ? ' is-on' : ''}`}
              aria-pressed={draft.timebox === b.key}
              onClick={() => onChange({ timebox: b.key })}
            >
              {b.label}
              <small className="tp-fchip-sub tp-mono">{b.span}</small>
            </button>
          ))}
        </div>
        <p className="tp-hint">
          「何時ちょうど」ではなく「どの帯でやるか」を決めます。時刻を入れると、スケジュールの軸に並びます。
          {draft.dueTime && !draft.timebox && ' 時刻を入れてあるので、その時刻の枠として数えます。'}
        </p>
      </div>

      <div className="tp-field">
        <span className="tp-label">
          手順 <Icon name="checklist" size={12} />
          {draft.subtasks.length > 0 && (
            <b className="tp-sub-count tp-mono">
              {doneCount}/{draft.subtasks.length}
            </b>
          )}
        </span>

        {draft.subtasks.length > 0 && (
          <ul className="tp-sub-edit">
            {draft.subtasks.map((st, i) => (
              <li key={st.id}>
                <button
                  type="button"
                  className={`tp-sub-check${st.done ? ' is-on' : ''}`}
                  aria-pressed={st.done}
                  aria-label={st.done ? `${st.title} を未了に戻す` : `${st.title} を済にする`}
                  onClick={() =>
                    setSubtasks(draft.subtasks.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))
                  }
                >
                  {st.done && <Icon name="check" size={13} strokeWidth={2.6} />}
                </button>
                <input
                  type="text"
                  value={st.title}
                  placeholder="手順を書く"
                  onChange={(e) =>
                    setSubtasks(draft.subtasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  className="tp-sub-del"
                  aria-label={`${st.title || '空の手順'} を消す`}
                  onClick={() => setSubtasks(draft.subtasks.filter((_, j) => j !== i))}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="tp-sub-add"
          onClick={() => setSubtasks([...draft.subtasks, { id: ulid(), title: '', done: false }])}
        >
          <Icon name="plus" size={14} />
          手順を足す
        </button>
        <p className="tp-hint">
          1つの作業が何工程かに分かれるときに使います。手順だけを済にしても、タスクは完了になりません。
        </p>
      </div>

      <div className="tp-field">
        <span className="tp-label">
          繰り返し <Icon name="repeat" size={12} />
        </span>
        <div className="tp-chips" role="group" aria-label="繰り返し">
          <button
            type="button"
            className={`tp-fchip${!repeat ? ' is-on' : ''}`}
            aria-pressed={!repeat}
            onClick={() => setUnit(null)}
          >
            しない
          </button>
          {REPEAT_UNITS.map((u) => (
            <button
              key={u.key}
              type="button"
              className={`tp-fchip${repeat?.unit === u.key ? ' is-on' : ''}`}
              aria-pressed={repeat?.unit === u.key}
              onClick={() => setUnit(u.key)}
            >
              {u.label}
            </button>
          ))}
        </div>

        {repeat?.unit === 'week' && (
          <div className="tp-chips" role="group" aria-label="繰り返す曜日">
            {WEEK.map((w, i) => (
              <button
                key={w}
                type="button"
                className={`tp-fchip tp-fchip-day${repeat.weekdays.includes(i) ? ' is-on' : ''}`}
                aria-pressed={repeat.weekdays.includes(i)}
                aria-label={`${w}曜日`}
                onClick={() =>
                  onChange({
                    repeat: {
                      ...repeat,
                      weekdays: repeat.weekdays.includes(i)
                        ? repeat.weekdays.filter((d) => d !== i)
                        : [...repeat.weekdays, i],
                    },
                  })
                }
              >
                {w}
              </button>
            ))}
          </div>
        )}

        {repeat && (
          <label className="tp-repeat-until">
            <span>いつまで</span>
            <input
              type="date"
              value={repeat.until ?? ''}
              onChange={(e) => onChange({ repeat: { ...repeat, until: e.target.value || null } })}
            />
            {repeat.until && (
              <button
                type="button"
                className="tp-link-quiet"
                onClick={() => onChange({ repeat: { ...repeat, until: null } })}
              >
                終わりなしに戻す
              </button>
            )}
          </label>
        )}

        <p className="tp-hint">
          {!repeat
            ? '日報・週次会議・棚卸のような定例に使います。期限は無くてもかまいません。'
            : draft.due
              ? '完了にしたとき、次の1件だけを作ります。手順のチェックは外した状態で引き継ぎます。'
              : '期限を入れていないので、完了にした日を起点に次回の期限を決めます。次の1件だけを作ります。'}
        </p>
      </div>

      <label className="tp-field">
        <span className="tp-label">
          メモ <Icon name="pencil" size={12} />
        </span>
        <textarea
          rows={2}
          value={draft.note}
          placeholder="相手先・品番・数量・背景"
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </label>
    </div>
  )
}
