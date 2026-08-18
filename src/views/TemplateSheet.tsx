import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { CategoryChip } from '../components/CategoryChip'
import { searchTemplates } from '../lib/templates'
import { colorOf } from '../lib/workCategories'
import { durationLabel } from '../lib/date'
import { PRIORITY_LABEL, type CategoryGroup, type TaskTemplate } from '../types'

/* =========================================================
 * 記憶したタスクを呼び出す
 *
 * ＋の扇の「記憶」から開く独立した画面。
 * 一度作ったタスクは登録した時点で控えてある。同じ作業を毎回打ち直さない。
 * 押すと中身の入ったフォームが開く（そのまま登録はしない。期限は毎回違うので、
 * 呼び出したあとに人が入れる）。
 * =======================================================*/

export function TemplateSheet({
  templates,
  groups,
  onPick,
  onForget,
  onClose,
}: {
  templates: TaskTemplate[]
  groups: CategoryGroup[]
  onPick: (t: TaskTemplate) => void
  onForget: (t: TaskTemplate) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const list = useMemo(() => searchTemplates(templates, q), [templates, q])

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label="記憶したタスクを呼び出す">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>
            記憶したタスク <b className="tp-mono tp-head-n">{templates.length}</b>
          </h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <div className="tp-search tp-cat-search">
            <Icon name="search" size={16} />
            <input
              type="search"
              value={q}
              placeholder="件名・メモ・区分から探す"
              aria-label="記憶したタスクを探す"
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button type="button" className="tp-search-clear" aria-label="語を消す" onClick={() => setQ('')}>
                <Icon name="close" size={15} />
              </button>
            )}
          </div>

          {list.length === 0 ? (
            <div className="tp-empty">
              <Icon name="checklist" size={26} />
              <p className="tp-empty-head">
                {templates.length === 0 ? 'まだ記憶がありません' : '当てはまるものはありません'}
              </p>
              <p className="tp-empty-body">
                {templates.length === 0
                  ? 'タスクを登録すると、その件名・区分・見込み時間をここに控えます。次からは押すだけで埋まります。'
                  : '語を短くして探し直してください。'}
              </p>
            </div>
          ) : (
            <ul className="tp-tpl-list">
              {list.map((t) => (
                <li key={t.id} className="tp-tpl">
                  <button type="button" className="tp-tpl-body" onClick={() => onPick(t)}>
                    <span className="tp-tpl-title">{t.title}</span>
                    <span className="tp-tpl-meta">
                      {t.categories.map((c) => (
                        <CategoryChip key={c} label={c} color={colorOf(groups, c)} />
                      ))}
                      <span className={`tp-draft-pri tp-pri-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                      {t.estimateMin && <span className="tp-chip-est">{durationLabel(t.estimateMin)}</span>}
                      {t.steps.length > 0 && (
                        <span className="tp-chip-est">手順 {t.steps.length}</span>
                      )}
                      <span className="tp-mono tp-tpl-n">{t.useCount}回</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="tp-icon-btn tp-danger"
                    aria-label={`「${t.title}」を忘れる`}
                    onClick={() => onForget(t)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="tp-hint">
            期限は控えていません（毎回違うため）。呼び出したあとに入れてください。
            この控えは端末の中だけにあり、同期にも書き出しにも乗りません。
          </p>
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
        </footer>
      </div>
    </div>
  )
}
