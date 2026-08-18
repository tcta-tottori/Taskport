import { Icon } from '../components/Icon'
import { PRIORITIES, PRIORITY_LABEL, type Draft } from '../types'
import { CATEGORY_MASTER } from '../lib/workCategories'

/**
 * Draft 1件ぶんの編集フォーム。
 * 確認画面（ReviewSheet）と編集画面（TaskEditor）で同じ形にして、
 * 「見た目が違うから設定を見落とす」ことがないようにする。
 */
export function DraftFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: Draft
  onChange: (patch: Partial<Draft>) => void
  idPrefix: string
}) {
  return (
    <div className="tp-fields">
      <label className="tp-field">
        <span className="tp-label">件名</span>
        <input
          id={`${idPrefix}-title`}
          type="text"
          value={draft.title}
          placeholder="〜する の形で書く"
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </label>

      <div className="tp-field-row">
        <label className="tp-field">
          <span className="tp-label">期限</span>
          <input
            type="date"
            value={draft.due ?? ''}
            onChange={(e) => onChange({ due: e.target.value || null })}
          />
        </label>
        <label className="tp-field">
          <span className="tp-label">時刻</span>
          <input
            type="time"
            value={draft.dueTime ?? ''}
            onChange={(e) => onChange({ dueTime: e.target.value || null })}
          />
        </label>
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
      </div>

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

      <label className="tp-field">
        <span className="tp-label">区分</span>
        <input
          type="text"
          list={`${idPrefix}-cats`}
          value={draft.category}
          placeholder="在庫確認、処理 / 納期確認、日程調整 など"
          onChange={(e) => onChange({ category: e.target.value })}
        />
        {/* 日報の作業内容をそのまま候補にする。大分類ごとにまとめて出す。 */}
        <datalist id={`${idPrefix}-cats`}>
          {CATEGORY_MASTER.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((c) => (
                <option key={c} value={c} />
              ))}
            </optgroup>
          ))}
        </datalist>
      </label>

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
