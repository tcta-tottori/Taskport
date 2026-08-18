import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'
import { Wave } from '../components/Wave'
import type { RecordingSession } from '../ports/in/useRecordingSession'

/* =========================================================
 * 録音中の画面（NoteLoop 9.2 と同じ体裁）
 *
 *   上にウェーブと経過時間、その下に認識テキストをそのまま流す。
 *   下部は一時停止と録音完了。画面を消しても録音は続く。
 *
 * NoteLoop と違うのは止めた後だけ。議事録ではなくタスク候補を作る。
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
    <div className="tp-rec" role="dialog" aria-modal="true" aria-label="録音中">
      <div className="tp-rec-wave">
        <Wave active={!session.paused} level={session.level} />
        <span className={`tp-rec-timer${session.paused ? ' is-paused' : ''}`}>{mmss(session.seconds)}</span>
      </div>

      {session.stalled && (
        <p className="tp-rec-alert" role="alert">
          <Icon name="alert" size={15} />
          音声が取り込めていません。録り直しています。画面を点けてアプリを前面に戻してください。
        </p>
      )}
      {!session.stalled && session.notificationBlocked && (
        <p className="tp-rec-note">
          <Icon name="alert" size={14} />
          通知が許可されていないため、画面を消すと録音中の表示が出ません。
        </p>
      )}
      {session.error && (
        <p className="tp-rec-alert" role="alert">
          <Icon name="alert" size={15} />
          {session.error}
        </p>
      )}

      <div className="tp-rec-body" ref={areaRef}>
        {session.transcript ? (
          <p className="tp-rec-text">{session.transcript}</p>
        ) : (
          <p className="tp-rec-idle">
            {session.paused ? '一時停止中です。' : '聞き取っています。用件をそのまま話してください。'}
          </p>
        )}
      </div>

      <p className="tp-rec-hint">
        {session.paused ? '一時停止中／再開すると続きから録音します' : '録音中／画面を消しても続きます'}
      </p>

      <div className="tp-rec-bar">
        <button type="button" className="tp-rec-side" onClick={onCancel}>
          <Icon name="close" size={20} />
          <span>やめる</span>
        </button>

        <div className="tp-fab-slot">
          <button
            type="button"
            className="tp-fab is-rec"
            aria-label="録音を止めてタスクにする"
            onClick={onFinish}
          >
            <span className="tp-fab-ring" aria-hidden="true" />
            <span className="tp-fab-stop" aria-hidden="true" />
          </button>
          <span className="tp-fab-hint">タップで確定</span>
        </div>

        <button type="button" className="tp-rec-side" onClick={session.togglePause}>
          <Icon name={session.paused ? 'mic' : 'clock'} size={20} />
          <span>{session.paused ? '再開' : '一時停止'}</span>
        </button>
      </div>
    </div>
  )
}
