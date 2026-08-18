import { Icon } from '../components/Icon'
import { durationLabel, toMinutes } from '../lib/date'
import { bandLoads, currentBand, nextUp, timeboxLabel, unboxed } from '../lib/timebox'
import { isWorkDay, taskMinutes } from '../lib/workday'
import type { Settings, Task } from '../types'

/* =========================================================
 * 今日の進めかた
 *
 *   1. いま やる1件      … 次に何をやるか毎回考えないで済ませる
 *   2. 枠ごとの積み上げ  … 詰め込みすぎを朝のうちに気づく
 *   3. 超過の仕分けへの入口 … 溜まったやり残しを朝に片づける
 *
 * 一覧の上に置く。ここを見れば「いま何をやるか」と
 * 「このままで今日は終わるか」の2つが分かる。
 * =======================================================*/

export function TodayFlow({
  tasks,
  today,
  settings,
  nowMin,
  overdue,
  onToggle,
  onEdit,
  onTriage,
  onWrapUp,
}: {
  /** 今日やる未完了タスク（超過ぶんを含む） */
  tasks: Task[]
  today: string
  settings: Settings
  /** いまの時刻（0時からの分） */
  nowMin: number
  /** 期限を過ぎた未完了の件数 */
  overdue: number
  onToggle: (task: Task) => void
  onEdit: (task: Task) => void
  onTriage: () => void
  onWrapUp: () => void
}) {
  const wh = settings.workHours
  const now = currentBand(wh, nowMin)
  const next = nextUp(tasks, wh, nowMin)
  const loads = bandLoads(tasks, wh, settings.defaultEstimateMin)
  const free = unboxed(tasks, wh)
  const endMin = toMinutes(wh.end) ?? 0
  const working = isWorkDay(today, wh, settings.workCalendar)

  return (
    <section className="tp-flow">
      <div className="tp-flow-head">
        <h2>今日の進めかた</h2>
        <span className="tp-flow-now tp-mono">
          {now === 'out' ? '時間外' : `${timeboxLabel(now, wh)}`}
        </span>
      </div>

      {/* 会社カレンダーで休みの日は、枠の話をしても意味がないので先に断る */}
      {!working && (
        <p className="tp-flow-off">
          <Icon name="sun" size={15} />
          今日は会社カレンダーで休みです。
        </p>
      )}

      {/* --- いま やる1件 --- */}
      {next ? (
        <div className="tp-now">
          <p className="tp-now-label">いま やる1件</p>
          <div className="tp-now-row">
            <button
              type="button"
              className="tp-check"
              aria-label={`${next.title} を完了にする`}
              onClick={() => onToggle(next)}
            />
            <button type="button" className="tp-now-body" onClick={() => onEdit(next)}>
              <span className="tp-now-title">{next.title}</span>
              <span className="tp-now-meta tp-mono">
                {next.timebox || next.dueTime ? timeboxLabel(next.timebox, wh) || '枠なし' : '枠なし'}
                {' ／ '}
                {durationLabel(taskMinutes(next, settings.defaultEstimateMin))}
                {next.dueTime && ` ／ ${next.dueTime} 締め`}
              </span>
            </button>
          </div>
          <p className="tp-now-hint">これだけ見て手を動かす。終わったら次の1件に入れ替わる。</p>
        </div>
      ) : (
        <p className="tp-now-empty">
          <Icon name="check" size={15} />
          今日ぶんは片づいています。
        </p>
      )}

      {/* --- 枠ごとの積み上げ（休みの日は出さない） --- */}
      {working && (
      <ul className="tp-bands">
        {loads.map((l) => {
          const cap = l.capacity
          const pct = cap ? Math.min(100, Math.round((l.planned / cap) * 100)) : 0
          const passed = l.band.to !== null && nowMin >= l.band.to
          const isNow = l.band.key === now
          if (l.band.key === 'out' && l.tasks.length === 0) return null
          return (
            <li
              key={l.band.key}
              className={`tp-band${isNow ? ' is-now' : ''}${passed ? ' is-passed' : ''}`}
            >
              <div className="tp-band-head">
                <b>{l.band.label}</b>
                <span className="tp-band-span tp-mono">{l.band.span}</span>
                <span className={`tp-band-num tp-mono${l.over > 0 ? ' is-over' : ''}`}>
                  {cap
                    ? `${durationLabel(l.planned)} / ${durationLabel(cap)}`
                    : durationLabel(l.planned)}
                </span>
              </div>
              {cap !== null && (
                <div className="tp-progress">
                  <span className={l.over > 0 ? 'is-over' : pct > 80 ? 'is-tight' : ''} style={{ width: `${pct}%` }} />
                </div>
              )}
              <p className="tp-band-note">
                {l.tasks.length === 0
                  ? '空いています'
                  : l.over > 0
                    ? `${l.tasks.length}件で${durationLabel(l.over)}あふれています。ほかの枠へ移すか、今日はやらないと決めてください。`
                    : `${l.tasks.length}件`}
              </p>
            </li>
          )
        })}
      </ul>
      )}

      {working && free.length > 0 && (
        <p className="tp-band-free">
          <Icon name="clock" size={13} />
          枠を決めていないタスクが <b className="tp-mono">{free.length}</b> 件あります。
          カードを開いて時間枠を選ぶと、ここに積まれます。
        </p>
      )}

      <div className="tp-flow-acts">
        <button type="button" className="tp-btn-ghost" onClick={onTriage} disabled={overdue === 0}>
          <Icon name="alert" size={15} />
          朝の仕分け
          {overdue > 0 && <span className="tp-flow-n tp-mono">{overdue}</span>}
        </button>
        <button type="button" className="tp-btn-ghost" onClick={onWrapUp}>
          <Icon name="sun" size={15} />
          {nowMin >= endMin - 60 ? '今日を締める' : '明日の準備'}
        </button>
      </div>
      <p className="tp-flow-foot">朝は超過を仕分け、終わりに明日を見る。</p>
    </section>
  )
}
