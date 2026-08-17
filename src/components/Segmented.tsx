/**
 * タブ切り替え。件数を右肩に出せる。
 * 件数は等幅にして、タブを行き来しても数字の位置が動かないようにする。
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: { key: T; label: string; count?: number }[]
  value: T
  onChange: (key: T) => void
  ariaLabel: string
}) {
  return (
    <div className="tp-seg" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={value === item.key}
          className={`tp-seg-btn${value === item.key ? ' is-on' : ''}`}
          onClick={() => onChange(item.key)}
        >
          <span>{item.label}</span>
          {typeof item.count === 'number' && <b className="tp-seg-n">{item.count}</b>}
        </button>
      ))}
    </div>
  )
}
