import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Wave } from './Wave'
import { useVoiceInput } from '../ports/in/useVoiceInput'
import type { Source } from '../types'

/* =========================================================
 * 画面下部の入力ドック
 *
 * 片手持ちの親指到達域に録音ボタンを置く。
 * 音声が使えない／失敗したときは必ずキーボード入力に到達できるようにする。
 * ここは「入口」を並べる場所で、解析そのものはしない（parseToTasks に渡すだけ）。
 * =======================================================*/

function mmss(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

export function InputDock({
  onSubmitText,
  onOpenForm,
  busy,
  autoOpenVoice,
}: {
  /** 自然文を構造化パイプラインへ渡す */
  onSubmitText: (text: string, source: Source) => void
  /** AIを通さず1件を直接作る */
  onOpenForm: () => void
  busy: boolean
  autoOpenVoice: boolean
}) {
  const voice = useVoiceInput()
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const autoStarted = useRef(false)

  // 録音中は認識結果をそのまま欄に流し込み、止めた時点の文章を送る
  const shown = voice.recording ? voice.transcript : text

  useEffect(() => {
    if (typing) areaRef.current?.focus()
  }, [typing])

  // ショートカット（?dock=voice）から起動したときは録音を開けておく
  useEffect(() => {
    if (autoOpenVoice && !autoStarted.current && voice.supported) {
      autoStarted.current = true
      void voice.start()
    }
  }, [autoOpenVoice, voice])

  const submit = (body: string, source: Source) => {
    const t = body.trim()
    if (!t) return
    onSubmitText(t, source)
    setText('')
    voice.reset()
    setTyping(false)
  }

  const toggleVoice = () => {
    if (voice.recording) {
      const final = voice.stop()
      submit(final, 'voice')
    } else {
      setTyping(false)
      void voice.start()
    }
  }

  const showPanel = typing || voice.recording

  return (
    <div className={`tp-dock${showPanel ? ' is-open' : ''}`}>
      {voice.recording && (
        <div className="tp-dock-wave">
          <Wave active level={voice.level} />
          <span className="tp-wave-timer">{mmss(voice.seconds)}</span>
        </div>
      )}

      {showPanel && (
        <div className="tp-dock-panel">
          <textarea
            ref={areaRef}
            className="tp-dock-area"
            value={shown}
            readOnly={voice.recording}
            placeholder={
              voice.recording
                ? '聞き取っています…'
                : '用件をそのまま書く。メールの文面を貼ってもよい。\n例：明日までにサンプル商事へ AB-1234 の納期を確認する'
            }
            rows={voice.recording ? 4 : 3}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(text, 'text')
            }}
          />
          {!voice.recording && (
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
              <button
                type="button"
                className="tp-btn-primary"
                disabled={!text.trim() || busy}
                onClick={() => submit(text, 'text')}
              >
                <Icon name="sparkle" size={16} />
                タスクにする
              </button>
            </div>
          )}
        </div>
      )}

      {voice.error && (
        <p className="tp-dock-error" role="alert">
          {voice.error}
        </p>
      )}

      <div className="tp-dock-bar">
        <button
          type="button"
          className={`tp-dock-side${typing ? ' is-on' : ''}`}
          onClick={() => {
            if (voice.recording) voice.stop()
            setTyping((v) => !v)
          }}
        >
          <Icon name="keyboard" size={20} />
          <span>キーボード</span>
        </button>

        <div className="tp-fab-slot">
          <button
            type="button"
            className={`tp-fab${voice.recording ? ' is-rec' : ''}`}
            data-state={voice.recording ? 'recording' : 'idle'}
            disabled={busy || !voice.supported}
            aria-label={voice.recording ? '録音を止めてタスクにする' : '音声で入力する'}
            onClick={toggleVoice}
          >
            <span className="tp-fab-ring" aria-hidden="true" />
            <Icon name="mic" size={26} strokeWidth={2} />
          </button>
          <span className="tp-fab-hint">
            {busy
              ? '解析中'
              : voice.recording
                ? '録音中／タップで確定'
                : voice.supported
                  ? 'タップで話す'
                  : '音声は未対応'}
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
