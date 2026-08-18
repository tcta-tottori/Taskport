import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { Source } from '../types'

/* =========================================================
 * 画面下部の入力ドック
 *
 * 片手持ちの親指到達域に録音ボタンを置く。
 * 音声が使えない／失敗したときは必ずキーボード入力に到達できるようにする。
 * ここは「入口」を並べる場所で、録音の実体と解析は持たない
 * （録音は App の録音セッション、解析は parseToTasks が持つ）。
 * =======================================================*/

export function InputDock({
  onSubmitText,
  onStartVoice,
  onOpenForm,
  busy,
  voiceSupported,
}: {
  /** 自然文を構造化パイプラインへ渡す */
  onSubmitText: (text: string, source: Source) => void
  /** 録音を始める（画面は App 側の録音オーバーレイに切り替わる） */
  onStartVoice: () => void
  /** AIを通さず1件を直接作る */
  onOpenForm: () => void
  busy: boolean
  voiceSupported: boolean
}) {
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (typing) areaRef.current?.focus()
  }, [typing])

  const submit = () => {
    const t = text.trim()
    if (!t) return
    onSubmitText(t, 'text')
    setText('')
    setTyping(false)
  }

  return (
    <div className={`tp-dock${typing ? ' is-open' : ''}`}>
      {typing && (
        <div className="tp-dock-panel">
          <textarea
            ref={areaRef}
            className="tp-dock-area"
            value={text}
            placeholder={'用件をそのまま書く。メールの文面を貼ってもよい。\n例：明日までにサンプル商事へ AB-1234 の納期を確認する'}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
            }}
          />
          <div className="tp-dock-actions">
            <button
              type="button"
              className="tp-btn-ghost"
              onClick={() => {
                setTyping(false)
                setText('')
              }}
            >
              やめる
            </button>
            <button type="button" className="tp-btn-primary" disabled={!text.trim() || busy} onClick={submit}>
              <Icon name="sparkle" size={16} />
              タスクにする
            </button>
          </div>
        </div>
      )}

      <div className="tp-dock-bar">
        <button
          type="button"
          className={`tp-dock-side${typing ? ' is-on' : ''}`}
          onClick={() => setTyping((v) => !v)}
        >
          <Icon name="keyboard" size={20} />
          <span>キーボード</span>
        </button>

        <div className="tp-fab-slot">
          <button
            type="button"
            className="tp-fab"
            disabled={busy || !voiceSupported}
            aria-label="音声で入力する"
            onClick={() => {
              setTyping(false)
              onStartVoice()
            }}
          >
            <span className="tp-fab-ring" aria-hidden="true" />
            <Icon name="mic" size={26} strokeWidth={2} />
          </button>
          <span className="tp-fab-hint">
            {busy ? '解析中' : voiceSupported ? 'タップで話す' : '音声は未対応'}
          </span>
        </div>

        <button type="button" className="tp-dock-side" onClick={onOpenForm}>
          <Icon name="plus" size={20} />
          <span>直接入力</span>
        </button>
      </div>
    </div>
  )
}
