import { useState } from 'react'
import { Icon } from '../components/Icon'
import { addDaysKey, dueLabel, durationLabel } from '../lib/date'
import { taskMinutes } from '../lib/workday'
import { bands } from '../lib/timebox'
import type { Settings, Task, TimeboxKey } from '../types'

/* =========================================================
 * 朝の仕分け
 *
 * 期限を過ぎたまま残っているタスクを1件ずつ出し、
 * 「今日やる／明日へ／期限を外す／完了」の4つから選ぶだけにする。
 *
 * 一覧の中で1件ずつ開いて直すと手間がかかり、結局そのまま溜まる。
 * 判断だけを並べて、迷う余地を減らす。
 * =======================================================*/

export type TriageAction =
  | { kind: 'today'; timebox: TimeboxKey | null }
  | { kind: 'tomorrow' }
  | { kind: 'someday' }
  | { kind: 'done' }

export function TriageSheet({
  tasks,
  today,
  settings,
  onApply,
  onClose,
}: {
  /** 期限を過ぎた未完了タスク（古い順） */
  tasks: Task[]
  today: string
  settings: Settings
  /** 1件ぶんの決定。呼び出し側が保存する */
  onApply: (task: Task, action: TriageAction) => Promise<void>
  onClose: () => void
}) {
  /**
   * 開いた時点の一覧を写し取って使う。
   * 元の一覧をそのまま見ると、1件さばくたびに「超過」でなくなって列が縮み、
   * 次の1件を飛ばしてしまう（開いた分だけ確実に手当てする）。
   */
  const [queue] = useState<Task[]>(tasks)
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(false)
  const [box, setBox] = useState<TimeboxKey | null>(null)
  const task = queue[i]
  const wh = settings.workHours

  const step = async (action: TriageAction) => {
    if (!task || busy) return
    setBusy(true)
    try {
      await onApply(task, action)
      setBox(null)
      setI((v) => v + 1)
    } finally {
      setBusy(false)
    }
  }

  const done = !task

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label="朝の仕分け">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>
            朝の仕分け{' '}
            {!done && (
              <b className="tp-mono">
                {i + 1}/{queue.length}
              </b>
            )}
          </h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          {done ? (
            <div className="tp-empty">
              <Icon name="check" size={26} />
              <p className="tp-empty-head">仕分けが終わりました</p>
              <p className="tp-empty-body">
                残っていた {queue.length} 件を片づけました。今日の枠を確かめて始めてください。
              </p>
            </div>
          ) : (
            <>
              <p className="tp-triage-lead">
                期限が過ぎています。<b>今日やるか、後ろへ送るか</b>を決めてください。
              </p>

              <article className="tp-triage-card">
                <h3>{task.title}</h3>
                {task.note && <p className="tp-triage-note">{task.note}</p>}
                <p className="tp-triage-meta tp-mono">
                  <span className="is-over">{dueLabel(task.due, today)}</span>
                  {' ／ '}
                  {durationLabel(taskMinutes(task, settings.defaultEstimateMin))}
                  {task.category && ` ／ ${task.category}`}
                </p>
              </article>

              <p className="tp-label">今日やるなら、どの枠で</p>
              <div className="tp-chips" role="group" aria-label="時間枠">
                {bands(wh).map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    className={`tp-fchip${box === b.key ? ' is-on' : ''}`}
                    aria-pressed={box === b.key}
                    onClick={() => setBox(box === b.key ? null : b.key)}
                  >
                    {b.label}
                    <small className="tp-fchip-sub tp-mono">{b.span}</small>
                  </button>
                ))}
              </div>

              <div className="tp-triage-acts">
                <button
                  type="button"
                  className="tp-btn-primary"
                  disabled={busy}
                  onClick={() => void step({ kind: 'today', timebox: box })}
                >
                  <Icon name="arrow" size={15} />
                  今日やる
                </button>
                <button
                  type="button"
                  className="tp-btn-ghost"
                  disabled={busy}
                  onClick={() => void step({ kind: 'tomorrow' })}
                >
                  明日へ（{addDaysKey(today, 1).slice(5).replace('-', '/')}）
                </button>
                <button
                  type="button"
                  className="tp-btn-ghost"
                  disabled={busy}
                  onClick={() => void step({ kind: 'someday' })}
                >
                  期限を外す
                </button>
                <button
                  type="button"
                  className="tp-btn-ghost"
                  disabled={busy}
                  onClick={() => void step({ kind: 'done' })}
                >
                  <Icon name="check" size={15} />
                  もう終わっている
                </button>
              </div>
              <p className="tp-hint">
                「期限を外す」は消すことではありません。すべてのタブには残り、期限だけが空になります。
              </p>
            </>
          )}
        </div>

        <footer className="tp-sheet-foot">
          <button type="button" className={done ? 'tp-btn-primary' : 'tp-btn-ghost'} onClick={onClose}>
            {done ? '始める' : 'あとにする'}
          </button>
        </footer>
      </div>
    </div>
  )
}
