import type { CSSProperties } from 'react'
import { Icon } from './Icon'
import type { CategoryColor } from '../types'

/* =========================================================
 * 区分のチップと、グループ色の受け渡し
 *
 * 色の値そのものは tokens.css の `--cat-*` にしかない。
 * ここでは「どの変数を使うか」だけを --cat に載せて渡す
 * （CSS 側は var(--cat) だけを見る。16進数はどこにも書かない）。
 * =======================================================*/

export function catStyle(color: CategoryColor): CSSProperties {
  return { '--cat': `var(--cat-${color})` } as CSSProperties
}

export function CategoryChip({
  label,
  color,
  onRemove,
}: {
  label: string
  color: CategoryColor
  /** 渡すと ✕ が付き、押すと外れる */
  onRemove?: () => void
}) {
  return (
    <span className="tp-cat-chip" style={catStyle(color)}>
      <span className="tp-cat-dot" aria-hidden="true" />
      <span className="tp-cat-name">{label}</span>
      {onRemove && (
        <button type="button" className="tp-cat-x" aria-label={`区分「${label}」を外す`} onClick={onRemove}>
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  )
}
