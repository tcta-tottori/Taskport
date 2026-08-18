import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'
import { Wave } from '../components/Wave'
import type { RecordingSession } from '../ports/in/useRecordingSession'

/* =========================================================
 * 録音中の表示（NoteLoop 9.2 の体裁を、画面下半分のポップアップで）
 *
 *   経過時間 → ゲージ → 「文字起こし」の仕切り → 認識テキスト
 *   → 案内文 → 左:やめる／中央:停止／右:一時停止
 *
 * 全画面ではなく下半分に出すので、上半分の一覧が見えたまま録音できる。
 * NoteLoop と違うのは止めた後だけで、議事録ではなくタスク候補を作る。
 * =======================================================*/

function mmss(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

export function RecordingOverlay({
  session,
  onFinish,
  onCancel,
}: {
  session: RecordingSession
  /** 録音を止めてタスク候補づくりへ進む */
  onFinish: () => void
  /** 録音を捨ててやめる */
  onCancel: () => void
}) {
  const areaRef = useRef<HTMLDivElement | null>(null)

  // 認識が進むたび、いちばん新しい行が見えるように追う
  useEffect(() => {
    const el = areaRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session.transcript])

  return (
    <div className="tp-rec-wrap" role="dialog" aria-modal="true" aria-label="録音中">
      {/* 背景は暗くするだけ。ここをタップしても録音は止めない
          （うっかり触れて録音が消えるのを防ぐ。停止も破棄もボタンから行う）。 */}
      <div className="tp-rec-backdrop" aria-hidden="true" />

      <div className="tp-rec">
        <span className="tp-rec-grip" aria-hidden="true" />

        <div className={`tp-rec-timer${session.paused ? ' is-paused' : ''}`}>
          <span className="tp-rec-dot" aria-hidden="true" />
          <b className="tp-mono">{mmss(session.seconds)}</b>
        </div>

        <div className="tp-rec-gauge">
          <Wave active={!session.paused} level={session.level} />
        </div>

        {session.stalled && (
          <p className="tp-rec-alert" role="alert">
            <Icon name="alert" size={14} />
            音声が取り込めていません。録り直しています。画面を点けてアプリを前面に戻してください。
          </p>
        )}
        {!session.stalled && session.notificationBlocked && (
          <p className="tp-rec-note">
            <Icon name="alert" size={13} />
            通知が許可されていないため、画面を消すと録音中の表示が出ません。
          </p>
        )}
        {session.error && (
          <p className="tp-rec-alert" role="alert">
            <Icon name="alert" size={14} />
            {session.error}
          </p>
        )}

        <p className="tp-rec-divider">
          <span>文字起こし</span>
        </p>

        <div className="tp-rec-body" ref={areaRef}>
          {session.transcript ? (
            <p className="tp-rec-text">{session.transcript}</p>
          ) : (
            <p className="tp-rec-idle">
              {session.paused ? '一時停止中' : '準備中'}
              <span className="tp-rec-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </p>
          )}
        </div>

        <p className="tp-rec-hint">
          {session.paused ? '一時停止中／再開すると続きから録音します' : '録音中／画面を消しても続きます'}
        </p>

        <div className="tp-rec-bar">
          <button type="button" className="tp-rec-round" onClick={onCancel} aria-label="録音をやめる">
            <Icon name="close" size={21} />
          </button>

          <button
            type="button"
            className="tp-rec-fab"
            aria-label="録音を止めてタスクにする"
            onClick={onFinish}
          >
            <span className="tp-rec-ring" aria-hidden="true" />
            <span className="tp-rec-stop" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`tp-rec-round is-pause${session.paused ? ' is-on' : ''}`}
            onClick={session.togglePause}
            aria-label={session.paused ? '録音を再開する' : '録音を一時停止する'}
          >
            {session.paused ? (
              <Icon name="mic" size={20} />
            ) : (
              <span className="tp-rec-pause" aria-hidden="true">
                <i />
                <i />
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
