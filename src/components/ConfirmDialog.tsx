import { createPortal } from 'react-dom'
import { Icon } from './Icon'

/* =========================================================
 * 確かめる小さな窓
 *
 * 消す・元に戻せない操作の前に1枚はさむ。
 * 押した瞬間に消えるのを防ぐためで、**押し間違いのやり直しが効かない**操作にだけ使う。
 *
 * 画面の中（`.tp-main`）から開くこともあるので body へ出して描く
 * （`.tp-main` は重なりの基準で、中に置くと ＋ ボタンの下に潜る）。
 * =======================================================*/

export function ConfirmDialog({
  title,
  body,
  okLabel = 'OK',
  cancelLabel = 'やめる',
  danger = true,
  onOk,
  onCancel,
}: {
  title: string
  body?: string
  okLabel?: string
  cancelLabel?: string
  /** 消す操作か（赤くする） */
  danger?: boolean
  onOk: () => void
  onCancel: () => void
}) {
  return createPortal(
    <div className="tp-confirm" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="tp-confirm-back" aria-label={cancelLabel} onClick={onCancel} />
      <div className="tp-confirm-card">
        <p className="tp-confirm-title">{title}</p>
        {body && <p className="tp-confirm-body">{body}</p>}
        <div className="tp-confirm-acts">
          <button type="button" className="tp-btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'tp-btn-danger' : 'tp-btn-primary'}
            onClick={onOk}
            autoFocus
          >
            {danger && <Icon name="trash" size={15} />}
            {okLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
