import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { durationLabel } from '../lib/date'
import type { Job } from '../types'

/* =========================================================
 * 案件（工数の単位）を作る／直す
 *
 * 持つのは「名前・管理番号・相手先・見積工数・期限」だけ。
 * 実績はここで入れない（押して測った時間から出る）。
 * 見積と実績を同じ欄に入れない、という決まりはここでも同じ。
 * =======================================================*/

/** 見積工数によく使う長さ（時間） */
const QUICK_H = [1, 2, 4, 8, 16, 40]

export function JobSheet({
  job,
  existing,
  onSave,
  onDelete,
  onClose,
}: {
  job: Job
  existing: boolean
  onSave: (job: Job) => void
  onDelete?: (job: Job) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Job>(job)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const change = (patch: Partial<Job>) => setDraft((d) => ({ ...d, ...patch }))
  const hours = draft.plannedMin > 0 ? String(Math.round((draft.plannedMin / 60) * 10) / 10) : ''

  return createPortal(
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label={existing ? '案件を直す' : '案件を作る'}>
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>{existing ? '案件を直す' : '案件を作る'}</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <p className="tp-note">
            案件は<b>工数をまとめる単位</b>です。タスクと予定から案件を選ぶと、
            押して測った時間がここに積まれます。区分（何をしたか）とは別の軸です。
          </p>

          <div className="tp-fields">
            <label className="tp-field">
              <span className="tp-label">案件名</span>
              <input
                type="text"
                value={draft.name}
                placeholder="AB-1234 立ち上げ / 月次棚卸 など"
                onChange={(e) => change({ name: e.target.value })}
              />
            </label>

            <div className="tp-field-row tp-field-row-2">
              <label className="tp-field">
                <span className="tp-label">管理番号</span>
                <input
                  type="text"
                  value={draft.code}
                  placeholder="AB-1234"
                  onChange={(e) => change({ code: e.target.value })}
                />
              </label>
              <label className="tp-field">
                <span className="tp-label">相手先</span>
                <input
                  type="text"
                  value={draft.client}
                  placeholder="サンプル商事 / 製造部 など"
                  onChange={(e) => change({ client: e.target.value })}
                />
              </label>
            </div>

            <div className="tp-field-row tp-field-row-2">
              <label className="tp-field">
                <span className="tp-label">見積工数</span>
                <div className="tp-suffix">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    inputMode="decimal"
                    value={hours}
                    placeholder="0"
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      change({ plannedMin: e.target.value === '' || n <= 0 ? 0 : Math.round(n * 60) })
                    }}
                  />
                  <span>時間</span>
                </div>
              </label>
              <label className="tp-field">
                <span className="tp-label">期限</span>
                <input
                  type="date"
                  value={draft.due ?? ''}
                  onChange={(e) => change({ due: e.target.value || null })}
                />
              </label>
            </div>

            <div className="tp-chips">
              {QUICK_H.map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`tp-fchip${draft.plannedMin === h * 60 ? ' is-on' : ''}`}
                  onClick={() => change({ plannedMin: h * 60 })}
                >
                  {durationLabel(h * 60)}
                </button>
              ))}
              {draft.plannedMin > 0 && (
                <button type="button" className="tp-fchip" onClick={() => change({ plannedMin: 0 })}>
                  決めない
                </button>
              )}
            </div>

            <label className="tp-field">
              <span className="tp-label">メモ</span>
              <textarea
                rows={2}
                value={draft.note}
                placeholder="背景・注意点など"
                onChange={(e) => change({ note: e.target.value })}
              />
            </label>

            <label className="tp-switch">
              <span>
                <b>締めた案件にする</b>
                <small>一覧の下へ畳みます。実績はそのまま残ります。</small>
              </span>
              <input
                type="checkbox"
                checked={draft.closed}
                onChange={(e) => change({ closed: e.target.checked })}
              />
            </label>
          </div>

          {existing && onDelete && (
            <div className="tp-job-danger">
              {confirmDelete ? (
                <>
                  <p className="tp-note">
                    この案件を消します。<b>タスクと予定は消えません</b>（案件なしに戻ります）。
                  </p>
                  <div className="tp-flow-acts">
                    <button type="button" className="tp-btn-ghost" onClick={() => setConfirmDelete(false)}>
                      やめる
                    </button>
                    <button type="button" className="tp-btn-danger" onClick={() => onDelete(draft)}>
                      <Icon name="trash" size={15} />
                      消す
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="tp-btn-ghost" onClick={() => setConfirmDelete(true)}>
                  <Icon name="trash" size={15} />
                  この案件を消す
                </button>
              )}
            </div>
          )}
        </div>

        <footer className="tp-sheet-foot">
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
            disabled={!draft.name.trim()}
            onClick={() =>
              onSave({ ...draft, name: draft.name.trim(), code: draft.code.trim(), client: draft.client.trim() })
            }
            aria-label={existing ? '保存する' : '案件を作る'}
            title={existing ? '保存' : '作る'}
          >
            <Icon name="check" size={22} strokeWidth={2.4} />
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
