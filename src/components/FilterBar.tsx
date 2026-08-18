import { useState } from 'react'
import { Icon } from './Icon'
import {
  activeCount,
  DUE_RANGES,
  EMPTY_FILTER,
  filterLabel,
  isFilterActive,
  sameFilter,
} from '../lib/taskFilter'
import { CATEGORY_MASTER } from '../lib/workCategories'
import { PRIORITIES, PRIORITY_LABEL, type SavedFilter, type TaskFilter } from '../types'

/* =========================================================
 * 検索と絞り込みの操作部
 *
 * 常に見えているのは検索欄と絞り込みボタンだけ。条件の面は畳んでおく。
 * よく使う条件は名前を付けて残せる（保存したものはチップで一発で戻る）。
 * =======================================================*/

function Chip({
  on,
  label,
  onClick,
}: {
  on: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button type="button" className={`tp-fchip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  )
}

export function FilterBar({
  filter,
  onChange,
  saved,
  onSave,
  onRemoveSaved,
  hits,
}: {
  filter: TaskFilter
  onChange: (next: TaskFilter) => void
  saved: SavedFilter[]
  /** 名前を付けていまの条件を残す */
  onSave: (name: string) => void
  onRemoveSaved: (id: string) => void
  /** いま何件当たっているか。絞り込み中だけ表示する */
  hits: number
}) {
  const [open, setOpen] = useState(false)
  const active = isFilterActive(filter)
  const count = activeCount(filter)
  const alreadySaved = saved.some((s) => sameFilter(s.filter, filter))

  const toggleIn = <T extends string>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

  return (
    <section className="tp-filter">
      <div className="tp-filter-row">
        <div className="tp-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            className="tp-search-input"
            value={filter.q}
            placeholder="件名・メモ・区分から探す"
            aria-label="タスクを探す"
            onChange={(e) => onChange({ ...filter, q: e.target.value })}
          />
          {filter.q && (
            <button
              type="button"
              className="tp-search-clear"
              aria-label="検索語を消す"
              onClick={() => onChange({ ...filter, q: '' })}
            >
              <Icon name="close" size={15} />
            </button>
          )}
        </div>

        <button
          type="button"
          className={`tp-filter-btn${open ? ' is-open' : ''}${count > 0 ? ' is-on' : ''}`}
          aria-expanded={open}
          aria-label="絞り込みの条件"
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="filter" size={16} />
          絞り込み
          {count > 0 && <span className="tp-filter-count tp-mono">{count}</span>}
        </button>
      </div>

      {saved.length > 0 && (
        <div className="tp-saved">
          {saved.map((s) => {
            const on = sameFilter(s.filter, filter)
            return (
              <span key={s.id} className={`tp-saved-chip${on ? ' is-on' : ''}`}>
                <button type="button" onClick={() => onChange(on ? EMPTY_FILTER : s.filter)}>
                  {s.name}
                </button>
                <button
                  type="button"
                  className="tp-saved-x"
                  aria-label={`保存した条件「${s.name}」を消す`}
                  onClick={() => onRemoveSaved(s.id)}
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {open && (
        <div className="tp-filter-panel">
          <p className="tp-filter-head">区分（大分類）</p>
          <div className="tp-chips">
            {CATEGORY_MASTER.map((g) => (
              <Chip
                key={g.group}
                label={g.group}
                on={filter.groups.includes(g.group)}
                onClick={() => onChange({ ...filter, groups: toggleIn(filter.groups, g.group) })}
              />
            ))}
            <Chip
              label="未分類"
              on={filter.groups.includes('未分類')}
              onClick={() => onChange({ ...filter, groups: toggleIn(filter.groups, '未分類') })}
            />
          </div>

          <p className="tp-filter-head">優先度</p>
          <div className="tp-chips">
            {PRIORITIES.map((p) => (
              <Chip
                key={p}
                label={PRIORITY_LABEL[p]}
                on={filter.priorities.includes(p)}
                onClick={() => onChange({ ...filter, priorities: toggleIn(filter.priorities, p) })}
              />
            ))}
          </div>

          <p className="tp-filter-head">期限</p>
          <div className="tp-chips">
            {DUE_RANGES.map((r) => (
              <Chip
                key={r.key}
                label={r.label}
                on={filter.due === r.key}
                onClick={() => onChange({ ...filter, due: r.key })}
              />
            ))}
          </div>

          <div className="tp-chips">
            <Chip
              label="完了したタスクも含める"
              on={filter.includeDone}
              onClick={() => onChange({ ...filter, includeDone: !filter.includeDone })}
            />
          </div>

          <div className="tp-filter-foot">
            <button type="button" className="tp-btn-ghost" onClick={() => onChange(EMPTY_FILTER)} disabled={!active}>
              条件を外す
            </button>
            <button
              type="button"
              className="tp-btn-ghost"
              disabled={!active || alreadySaved}
              onClick={() => onSave(filterLabel(filter))}
            >
              {alreadySaved ? '保存済み' : 'この条件を残す'}
            </button>
          </div>
        </div>
      )}

      {active && (
        <p className="tp-filter-hits">
          {hits > 0 ? (
            <>
              全件から <b className="tp-mono">{hits}</b> 件
            </>
          ) : (
            '当てはまるタスクはありません'
          )}
          <button type="button" className="tp-filter-reset" onClick={() => onChange(EMPTY_FILTER)}>
            解除
          </button>
        </p>
      )}
    </section>
  )
}
