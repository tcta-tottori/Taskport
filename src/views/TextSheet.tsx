import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'

/* =========================================================
 * 文章から作る
 *
 * ＋の扇の「文章」から開く独立した画面。
 * 用件をそのまま書く／メールの文面を貼ると、1文＝1件で候補になり、
 * 確認画面（ReviewSheet）へ渡る。ここでは保存しない。
 *
 * 解析は端末の中だけで動く。外へは送らない（design.md §10.1）。
 * =======================================================*/

export function TextSheet({
  busy,
  onParse,
  onClose,
}: {
  /** 解析中 */
  busy: boolean
  /** 自然文を候補にする（確認画面へ） */
  onParse: (text: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  // 開いたらそのまま打ち始められるようにする
  useEffect(() => {
    areaRef.current?.focus()
  }, [])

  const submit = () => {
    const t = text.trim()
    if (t) onParse(t)
  }

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label="文章から作る">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>文章から作る</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <div className="tp-free">
            <textarea
              ref={areaRef}
              className="tp-free-area"
              rows={7}
              value={text}
              placeholder={
                '用件をそのまま書く。メールの文面を貼ってもよい。\n例：明日までにサンプル商事へ AB-1234 の納期を確認する'
              }
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
              }}
            />
          </div>
          <p className="tp-hint">
            1文が1件になります。期限・時刻・優先度・区分は端末の中だけで読み取り、
            外へは送りません。読み違えることがあるので、次の確認画面で直してから登録します。
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
          <button
            type="button"
            className="tp-round-btn tp-round-go"
            disabled={!text.trim() || busy}
            onClick={submit}
            aria-label="候補にする"
            title="候補にする"
          >
            <Icon name="sparkle" size={22} strokeWidth={2.2} />
          </button>
        </footer>
      </div>
    </div>
  )
}
