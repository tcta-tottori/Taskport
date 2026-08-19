import { Icon } from './Icon'
import { clockLabel } from '../lib/date'
import { runSeconds } from '../lib/runs'
import type { PlanRun } from '../types'

/* =========================================================
 * 実行の操作（開始・一時停止・終了）
 *
 * カレンダー・スケジュール・実行の3画面から同じ形で使う。
 * 場所によって押す物の形が変わると、手が覚えられない。
 *
 * 経過時間は親から渡す `nowMs` で数える。1秒ごとに動かすのは
 * 実行の画面だけにして、ほかの画面では1分ごとに更新する
 * （動いている数字が常にあると、目が休まらない）。
 * =======================================================*/

export function RunControl({
  run,
  nowMs,
  title,
  onStart,
  onPause,
  onResume,
  onFinish,
  showTime = true,
}: {
  /** その対象の記録。まだ一度も始めていなければ null */
  run: PlanRun | null
  nowMs: number
  /** 読み上げ用。「◯◯ を開始」の◯◯ */
  title: string
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onFinish: () => void
  showTime?: boolean
}) {
  const secs = run ? runSeconds(run, nowMs) : 0

  if (!run) {
    return (
      <div className="tp-runctl">
        <button
          type="button"
          className="tp-run-btn tp-run-start"
          onClick={onStart}
          aria-label={`${title} を開始`}
          title="開始"
        >
          <Icon name="play" size={16} />
          <span>開始</span>
        </button>
      </div>
    )
  }

  if (run.state === 'done') {
    return (
      <div className="tp-runctl">
        {showTime && (
          <span className="tp-run-time tp-mono is-done">
            <Icon name="check" size={13} strokeWidth={2.4} />
            {clockLabel(secs)}
          </span>
        )}
        <button
          type="button"
          className="tp-run-btn tp-run-again"
          onClick={onResume}
          aria-label={`${title} をもう一度始める`}
          title="もう一度"
        >
          <Icon name="repeat" size={15} />
          <span>再開</span>
        </button>
      </div>
    )
  }

  const running = run.state === 'running'
  return (
    <div className="tp-runctl">
      {showTime && (
        <span className={`tp-run-time tp-mono${running ? ' is-running' : ' is-paused'}`}>
          {running && <span className="tp-run-dot" aria-hidden="true" />}
          {clockLabel(secs)}
        </span>
      )}
      {running ? (
        <button
          type="button"
          className="tp-run-btn tp-run-pause"
          onClick={onPause}
          aria-label={`${title} を一時停止`}
          title="一時停止"
        >
          <Icon name="pause" size={15} />
          <span>止める</span>
        </button>
      ) : (
        <button
          type="button"
          className="tp-run-btn tp-run-start"
          onClick={onResume}
          aria-label={`${title} を再開`}
          title="再開"
        >
          <Icon name="play" size={16} />
          <span>再開</span>
        </button>
      )}
      <button
        type="button"
        className="tp-run-btn tp-run-stop"
        onClick={onFinish}
        aria-label={`${title} を終了`}
        title="終了"
      >
        <Icon name="stop" size={14} />
        <span>終了</span>
      </button>
    </div>
  )
}
