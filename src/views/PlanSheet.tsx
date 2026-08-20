import { useState } from 'react'
import { Icon } from '../components/Icon'
import { CategoryChip } from '../components/CategoryChip'
import { TimeField } from '../components/TimeField'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { CategorySheet } from './CategorySheet'
import { cleanPlan, DEFAULT_PLAN_MIN, planSpan } from '../lib/plans'
import { colorOf, detectCategories } from '../lib/workCategories'
import { emptyRepeat, REPEAT_UNITS } from '../lib/repeat'
import { toMinutes, weekdayOf } from '../lib/date'
import { jobLabel } from '../lib/jobs'
import type { CategoryGroup, Job, Plan, RepeatUnit } from '../types'

/* =========================================================
 * 予定を作る／直す
 *
 * 予定はタスクではない。打合せ・来客・棚卸の立ち会いのように、
 * 「済ませて消えるもの」ではなく「その時間そこにいるもの」を入れる。
 * だから優先度も見込み時間も持たない。持つのは時間そのもの。
 *
 * 計上のしかた（自動／手動）をここで切り替える。既定は設定の値。
 * =======================================================*/

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

/**
 * 開始を動かしたときの終了。
 * 終了が空、または開始より前になったら、既定の長さ（60分）ぶん後ろへ送る。
 * 黙って捨てると「終わりの無い予定」になり、枠の埋まり具合が実際と合わなくなる。
 */
function followEnd(start: string | null, end: string | null): string | null {
  if (!start) return end
  const from = toMinutes(start)
  const to = end ? toMinutes(end) : null
  if (from === null) return end
  if (to !== null && to > from) return end
  const next = Math.min(23 * 60 + 59, from + DEFAULT_PLAN_MIN)
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`
}

export function PlanSheet({
  plan,
  existing,
  categoryGroups,
  jobs,
  onChangeCategoryGroups,
  onSave,
  onDelete,
  onClose,
}: {
  /** 下敷き。新規なら emptyPlan、編集なら既存の予定 */
  plan: Plan
  /** 既存の予定を直しているか（消す口を出すかの判断に使う） */
  existing: boolean
  categoryGroups: CategoryGroup[]
  /** 案件（工数の単位）。打合せの時間も案件に積む */
  jobs: Job[]
  onChangeCategoryGroups: (next: CategoryGroup[]) => void
  onSave: (plan: Plan) => void
  onDelete?: (plan: Plan) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Plan>(plan)
  const [picking, setPicking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const repeat = draft.repeat

  const change = (patch: Partial<Plan>) => setDraft((d) => ({ ...d, ...patch }))

  /** 件名から区分を当てる。人が選び直したら以後は触らない（タスクと同じ扱い）。 */
  const [autoCats, setAutoCats] = useState<string[] | null>(
    draft.categories.length === 0 ? [] : null,
  )
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  const setTitle = (title: string) => {
    if (autoCats !== null && (draft.categories.length === 0 || same(draft.categories, autoCats))) {
      const next = detectCategories(title, categoryGroups)
      setAutoCats(next)
      change({ title, categories: next })
      return
    }
    change({ title })
  }

  const setUnit = (unit: RepeatUnit | null) => {
    if (!unit) return change({ repeat: null })
    const weekdays =
      unit === 'week' && repeat?.weekdays.length
        ? repeat.weekdays
        : unit === 'week'
          ? [weekdayOf(draft.day)]
          : []
    change({ repeat: { ...emptyRepeat(unit), weekdays, until: repeat?.until ?? null } })
  }

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label={existing ? '予定を直す' : '予定を入れる'}>
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>{existing ? '予定を直す' : '予定を入れる'}</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <p className="tp-note">
            打合せ・来客・固定の業務など、<b>その時間そこにいるもの</b>を入れます。
            タスクと違って完了の丸は付きません。時間だけが埋まります。
          </p>

          <div className="tp-fields">
            <label className="tp-field">
              <span className="tp-label">件名</span>
              <input
                type="text"
                value={draft.title}
                placeholder="生産会議 / 客先来訪 など"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>

            <div className="tp-field-row">
              <label className="tp-field tp-field-wide">
                <span className="tp-label">日付</span>
                <input
                  type="date"
                  value={draft.day}
                  onChange={(e) => e.target.value && change({ day: e.target.value })}
                />
              </label>
              <div className="tp-field">
                <span className="tp-label">開始</span>
                <TimeField
                  value={draft.startTime}
                  ariaLabel="開始時刻"
                  disabled={draft.allDay}
                  onChange={(startTime) => change({ startTime, endTime: followEnd(startTime, draft.endTime) })}
                />
              </div>
              <div className="tp-field">
                <span className="tp-label">終了</span>
                <TimeField
                  value={draft.endTime}
                  ariaLabel="終了時刻"
                  disabled={draft.allDay}
                  onChange={(endTime) => change({ endTime })}
                />
              </div>
            </div>

            <label className="tp-switch">
              <span>
                <b>終日にする</b>
                <small>出張・一日がかりの作業など。時間の帯には積まず、日付の上に出します。</small>
              </span>
              <input
                type="checkbox"
                checked={draft.allDay}
                onChange={(e) => change({ allDay: e.target.checked })}
              />
            </label>

            <label className="tp-switch">
              <span>
                <b>時間を自動で計上する</b>
                <small>
                  {draft.autoTrack
                    ? '開始時刻になったら実行が始まり、終了時刻で終わります。途中で手で止めることもできます。'
                    : '「開始」「終了」を自分で押します。始まりが読めない予定はこちら。'}
                </small>
              </span>
              <input
                type="checkbox"
                checked={draft.autoTrack}
                disabled={draft.allDay}
                onChange={(e) => change({ autoTrack: e.target.checked })}
              />
            </label>

            <label className="tp-field">
              <span className="tp-label">場所</span>
              <input
                type="text"
                value={draft.place}
                placeholder="第2会議室 / 客先 など"
                onChange={(e) => change({ place: e.target.value })}
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
              <p className="tp-hint">実行の記録は先頭の区分で数えます。</p>
            </div>

            {/* 案件（工数の単位）。会議に出た時間も案件に積む */}
            <label className="tp-field">
              <span className="tp-label">案件</span>
              <select
                value={draft.jobId ?? ''}
                onChange={(e) => change({ jobId: e.target.value || null })}
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
              <p className="tp-hint">開始・終了を押して測った時間が、その案件の工数に積まれます。</p>
            </label>

            {picking && (
              <CategorySheet
                groups={categoryGroups}
                selected={draft.categories}
                onChangeGroups={onChangeCategoryGroups}
                onCommit={(categories) => {
                  setAutoCats(null)
                  change({ categories })
                  setPicking(false)
                }}
                onClose={() => setPicking(false)}
              />
            )}

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
                        change({
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
                    onChange={(e) => change({ repeat: { ...repeat, until: e.target.value || null } })}
                  />
                  {repeat.until && (
                    <button
                      type="button"
                      className="tp-link-quiet"
                      onClick={() => change({ repeat: { ...repeat, until: null } })}
                    >
                      終わりなしに戻す
                    </button>
                  )}
                </label>
              )}
              <p className="tp-hint">
                定例は<b>作り置きしません</b>。この1件を持ったまま、カレンダーとスケジュールに毎回ぶんが出ます。
                やめるときはこの予定を消せば、先の回もまとめて消えます。
              </p>
            </div>

            <label className="tp-field">
              <span className="tp-label">
                メモ <Icon name="pencil" size={12} />
              </span>
              <textarea
                rows={2}
                value={draft.note}
                placeholder="議題・持ち物・相手先"
                onChange={(e) => change({ note: e.target.value })}
              />
            </label>
          </div>

          <p className="tp-edit-meta">
            {draft.day} ／ {planSpan(draft)}
            {draft.autoTrack && !draft.allDay ? ' ／ 自動で計上' : ' ／ 手で開始・終了'}
          </p>

        </div>

        <footer className={`tp-sheet-foot${existing && onDelete ? ' tp-foot-split' : ''}`}>
          {existing && onDelete && (
            <button
              type="button"
              className="tp-round-btn tp-round-danger"
              onClick={() => setConfirmDelete(true)}
              aria-label="この予定を消す"
              title="消す"
            >
              <Icon name="trash" size={20} />
            </button>
          )}
          <div className="tp-foot-right">
            <button
              type="button"
              className="tp-round-btn tp-round-cancel"
              onClick={onClose}
              aria-label="やめる"
              title="やめる"
            >
              <Icon name="close" size={22} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              className="tp-round-btn tp-round-go"
              disabled={!draft.title.trim()}
              onClick={() => onSave(cleanPlan(draft))}
              aria-label={existing ? '保存する' : '予定を入れる'}
              title={existing ? '保存' : '入れる'}
            >
              <Icon name="check" size={22} strokeWidth={2.4} />
            </button>
          </div>
        </footer>

        {confirmDelete && onDelete && (
          <ConfirmDialog
            title="この予定を消しますか"
            body="繰り返しにしてある場合は、先の回もまとめて消えます。元に戻せません。"
            okLabel="消す"
            onOk={() => onDelete(draft)}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </div>
    </div>
  )
}
