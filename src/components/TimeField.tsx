import { Icon } from './Icon'
import { DEFAULT_TIME } from '../lib/date'

/* =========================================================
 * 時刻の欄
 *
 * 空のまま押すと、端末の時刻選択は**いまの時刻**から始まる。実際に入れたいのは
 * 業務時間の中の時刻なので、毎回そこまで回すことになっていた。
 * そこで、空の欄を押した時点で 10:00 を入れてから選択画面を開く。
 * 押した瞬間に DOM の値も入れるのは、選択画面が開く前に間に合わせるため
 * （React の描画を待つと、最初の1回だけ古い値で開く）。
 *
 * 入れた時刻は ✕ で消せる。時刻なし（日付だけ）に戻す道を消さない。
 * =======================================================*/

export function TimeField({
  value,
  onChange,
  ariaLabel,
  disabled,
  clearable = true,
}: {
  /** "HH:mm"。時刻なしは null */
  value: string | null
  onChange: (next: string | null) => void
  ariaLabel: string
  disabled?: boolean
  /** ✕（時刻なしに戻す）を出すか */
  clearable?: boolean
}) {
  return (
    <div className="tp-timefield">
      <input
        type="time"
        value={value ?? ''}
        aria-label={ariaLabel}
        disabled={disabled}
        onPointerDown={(e) => {
          if (disabled || e.currentTarget.value) return
          // 選択画面が開く前に入れる（DOM と state の両方）
          e.currentTarget.value = DEFAULT_TIME
          onChange(DEFAULT_TIME)
        }}
        onFocus={(e) => {
          // キーボードで辿り着いたとき（PC）の受け皿
          if (disabled || e.currentTarget.value) return
          onChange(DEFAULT_TIME)
        }}
        onChange={(e) => onChange(e.target.value || null)}
      />
      {clearable && value && !disabled && (
        <button
          type="button"
          className="tp-time-clear"
          aria-label={`${ariaLabel}を消す`}
          title="時刻なしに戻す"
          onClick={() => onChange(null)}
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  )
}
