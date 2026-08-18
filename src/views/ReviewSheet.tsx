import { useState } from 'react'
import { Icon } from '../components/Icon'
import { DraftFields } from './DraftFields'
import { dueLabel } from '../lib/date'
import { PRIORITY_LABEL, SOURCE_LABEL, type Draft } from '../types'

/* =========================================================
 * 確認画面
 *
 * 解析が出した候補は必ずここを通る。
 * 無確認で保存する経路を作らない。これは仕様であり、簡略化しない。
 *
 * 解析は端末内で完結しており、外部のAIには送っていない。
 * そのぶん期限や優先度の読み取りは素朴なので、ここでの確認が要になる。
 * =======================================================*/

export function ReviewSheet({
  drafts,
  hint,
  sourceText,
  today,
  onCommit,
  onCancel,
}: {
  drafts: Draft[]
  /** 予定からの取り込みなど、経路ごとの補足 */
  hint?: string
  sourceText: string
  today: string
  onCommit: (drafts: Draft[]) => void
  onCancel: () => void
}) {
  const [items, setItems] = useState<Draft[]>(drafts)
  const [openId, setOpenId] = useState<string | null>(drafts.length === 1 ? drafts[0].tempId : null)
  const [showSource, setShowSource] = useState(false)

  const patch = (tempId: string, p: Partial<Draft>) =>
    setItems((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, ...p } : d)))
  const drop = (tempId: string) => setItems((prev) => prev.filter((d) => d.tempId !== tempId))

  const valid = items.filter((d) => d.title.trim().length > 0)

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label="タスク候補の確認">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>
            候補 <b className="tp-mono">{items.length}</b> 件
          </h2>
          <button type="button" className="tp-icon-btn" onClick={onCancel} aria-label="やめる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <p className="tp-engine tp-engine-local">
          <Icon name="alert" size={14} />
          端末内で解析しました。期限の取り違えが起きやすいので必ず確認してください。
        </p>
        {hint && <p className="tp-engine-note">{hint}</p>}

        <div className="tp-sheet-body">
          {items.length === 0 && (
            <div className="tp-empty">
              <p className="tp-empty-head">候補がなくなりました</p>
              <p className="tp-empty-body">やめるを押して、もう一度入力してください。</p>
            </div>
          )}

          {items.map((d, i) => {
            const open = openId === d.tempId
            return (
              <article key={d.tempId} className={`tp-draft${open ? ' is-open' : ''}`}>
                <div className="tp-draft-head">
                  <button
                    type="button"
                    className="tp-draft-toggle"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : d.tempId)}
                  >
                    <span className="tp-draft-n tp-mono">{i + 1}</span>
                    <span className="tp-draft-sum">
                      <b>{d.title || '（件名が空です）'}</b>
                      <span className="tp-draft-meta">
                        <span className="tp-mono">{dueLabel(d.due, today)}</span>
                        {d.dueTime && <span className="tp-mono">{d.dueTime}</span>}
                        <span className={`tp-draft-pri tp-pri-${d.priority}`}>
                          {PRIORITY_LABEL[d.priority]}
                        </span>
                        {d.category && <span>{d.category}</span>}
                        <span>{SOURCE_LABEL[d.source]}</span>
                      </span>
                    </span>
                    <Icon name="chevron" size={16} className="tp-draft-caret" />
                  </button>
                  <button
                    type="button"
                    className="tp-icon-btn tp-danger"
                    onClick={() => drop(d.tempId)}
                    aria-label={`${d.title || `候補${i + 1}`} を破棄する`}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
                {open && (
                  <DraftFields
                    draft={d}
                    idPrefix={`rev-${d.tempId}`}
                    onChange={(p) => patch(d.tempId, p)}
                  />
                )}
              </article>
            )
          })}

          <details className="tp-source" open={showSource} onToggle={(e) => setShowSource(e.currentTarget.open)}>
            <summary>元の文章を見る</summary>
            <p>{sourceText}</p>
          </details>
        </div>

        <footer className="tp-sheet-foot">
          <button type="button" className="tp-btn-ghost" onClick={onCancel}>
            やめる
          </button>
          <button
            type="button"
            className="tp-btn-primary"
            disabled={valid.length === 0}
            onClick={() => onCommit(valid)}
          >
            <Icon name="check" size={16} />
            {valid.length}件を登録
          </button>
        </footer>
      </div>
    </div>
  )
}
