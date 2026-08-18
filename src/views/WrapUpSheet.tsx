import { Icon } from '../components/Icon'
import { addDaysKey, diffDays, dueLabel, durationLabel, formatMD } from '../lib/date'
import { sortTasks } from '../lib/tasks'
import { taskMinutes, workMinutes } from '../lib/workday'
import type { Settings, Task } from '../types'

/* =========================================================
 * 明日の準備（終わりの締め）
 *
 * 1日の終わりに「今日やり残した分」と「明日ぶん」を並べて出す。
 * やり残しはその場で明日へ送れる。
 *
 * 朝に慌てて組み直すのではなく、前日の終わりに明日の姿を見ておく。
 * =======================================================*/

export function WrapUpSheet({
  tasks,
  today,
  settings,
  onPushAll,
  onPush,
  onClose,
}: {
  tasks: Task[]
  today: string
  settings: Settings
  /** 今日のやり残しをまとめて明日へ */
  onPushAll: (tasks: Task[]) => Promise<void>
  /** 1件だけ明日へ */
  onPush: (task: Task) => Promise<void>
  onClose: () => void
}) {
  const tomorrow = addDaysKey(today, 1)
  const open = tasks.filter((t) => t.status === 'open')
  const left = sortTasks(open.filter((t) => !!t.due && diffDays(t.due, today) <= 0))
  const next = sortTasks(open.filter((t) => t.due === tomorrow))
  const doneToday = tasks.filter((t) => t.status === 'done' && (t.doneAt ?? '').slice(0, 10) === today)

  const mins = (list: Task[]) =>
    list.reduce((s, t) => s + taskMinutes(t, settings.defaultEstimateMin), 0)

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label="明日の準備">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>明日の準備</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <p className="tp-wrap-done">
            <Icon name="check" size={15} />
            今日は <b className="tp-mono">{doneToday.length}</b> 件を終えました。
          </p>

          <h3 className="tp-wrap-h">
            今日のやり残し <b className="tp-mono">{left.length}</b>
            {left.length > 0 && <span className="tp-wrap-sum tp-mono">{durationLabel(mins(left))}</span>}
          </h3>
          {left.length === 0 ? (
            <p className="tp-wrap-empty">ありません。そのまま終わってよい状態です。</p>
          ) : (
            <>
              <ul className="tp-wrap-list">
                {left.map((t) => (
                  <li key={t.id}>
                    <span>
                      <b>{t.title}</b>
                      <small className="tp-mono">
                        {dueLabel(t.due, today)} ／ {durationLabel(taskMinutes(t, settings.defaultEstimateMin))}
                      </small>
                    </span>
                    <button type="button" className="tp-btn-ghost" onClick={() => void onPush(t)}>
                      明日へ
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="tp-btn-ghost tp-wrap-all" onClick={() => void onPushAll(left)}>
                <Icon name="arrow" size={15} />
                {left.length}件すべてを明日へ送る
              </button>
            </>
          )}

          <h3 className="tp-wrap-h">
            明日（{formatMD(tomorrow)}） <b className="tp-mono">{next.length}</b>
            {next.length > 0 && <span className="tp-wrap-sum tp-mono">{durationLabel(mins(next))}</span>}
          </h3>
          {next.length === 0 ? (
            <p className="tp-wrap-empty">まだ空いています。</p>
          ) : (
            <ul className="tp-wrap-list is-plain">
              {next.map((t) => (
                <li key={t.id}>
                  <span>
                    <b>{t.title}</b>
                    <small className="tp-mono">
                      {t.dueTime ? `${t.dueTime} ／ ` : ''}
                      {durationLabel(taskMinutes(t, settings.defaultEstimateMin))}
                      {t.category ? ` ／ ${t.category}` : ''}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="tp-hint">
            {(() => {
              const planned = mins(next)
              const cap = workMinutes(settings.workHours)
              if (planned === 0) return '明日はまだ何も入っていません。'
              if (planned > cap)
                return `明日ぶんは ${durationLabel(planned)}。実働 ${durationLabel(cap)} を ${durationLabel(planned - cap)} 超えています。いま何件か後ろへ送っておくと朝が楽になります。`
              return `明日ぶんは ${durationLabel(planned)}。実働 ${durationLabel(cap)} に対して ${durationLabel(cap - planned)} 空いています。`
            })()}
          </p>
        </div>

        <footer className="tp-sheet-foot">
          <button type="button" className="tp-btn-primary" onClick={onClose}>
            終わる
          </button>
        </footer>
      </div>
    </div>
  )
}
