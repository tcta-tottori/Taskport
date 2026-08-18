import { useMemo } from 'react'
import { Segmented } from '../components/Segmented'
import { TaskCard } from '../components/TaskCard'
import { Icon } from '../components/Icon'
import { filterByTab, LIST_TABS, type ListTab } from '../lib/tasks'
import { durationLabel } from '../lib/date'
import { workloadOf } from '../lib/stats'
import { trim, workHoursSummary } from '../lib/workday'
import type { Settings, Task } from '../types'

/* =========================================================
 * 一覧ビュー（起動時の既定画面）
 * タブ: 今日 / 今週 / すべて / 完了
 * =======================================================*/

const EMPTY: Record<ListTab, { head: string; body: string }> = {
  today: {
    head: '今日締めのタスクはありません',
    body: '下のマイクを押して話すか、キーボードで用件をそのまま書いてください。',
  },
  week: {
    head: '今週の期限はまだ空いています',
    body: '先の予定を入れておくと、スケジュールで山が見えます。',
  },
  all: {
    head: 'まだタスクがありません',
    body: '歩きながらなら音声、PCならキーボード。どちらも同じ場所に貯まります。',
  },
  done: {
    head: '完了したタスクはまだありません',
    body: '左の丸を押すと完了になり、ここに積み上がります。',
  },
}

export function ListView({
  tasks,
  today,
  settings,
  tab,
  onTabChange,
  onToggle,
  onEdit,
}: {
  tasks: Task[]
  today: string
  settings: Settings
  tab: ListTab
  onTabChange: (tab: ListTab) => void
  onToggle: (task: Task) => void
  onEdit: (task: Task) => void
}) {
  const counts = useMemo(
    () =>
      LIST_TABS.reduce<Record<string, number>>((acc, t) => {
        acc[t.key] = filterByTab(tasks, t.key, today).length
        return acc
      }, {}),
    [tasks, today],
  )
  const shown = useMemo(() => filterByTab(tasks, tab, today), [tasks, tab, today])
  const load = useMemo(() => workloadOf(tasks, today, settings), [tasks, today, settings])
  const wh = workHoursSummary(settings.workHours)
  const pct = Math.round(load.ratio * 100)

  return (
    <div className="tp-view">
      {/* 今日の稼働。設定した勤務時間に対して、今日締めのタスクがどれだけ積まれているか。 */}
      <section className="tp-today-card">
        <div className="tp-today-row">
          <div>
            <p className="tp-label">本日の勤務</p>
            <p className="tp-today-span">{wh.span}</p>
            {wh.breakSpan && (
              <p className="tp-today-break">
                昼休憩 {wh.breakSpan}
                {wh.shortBreaks.length > 0 && ` ／ 小休憩 ${wh.shortBreaks.join(' ')}`}
              </p>
            )}
          </div>
          <div className="tp-today-num">
            <b>{durationLabel(load.planned)}</b>
            <span>/ {durationLabel(load.capacity)}</span>
          </div>
        </div>
        <div className="tp-progress">
          <span
            className={pct > 100 ? 'is-over' : pct > 80 ? 'is-tight' : ''}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <p className="tp-today-note">
          {load.tasks.length === 0
            ? '今日締めのタスクはまだありません。'
            : load.over > 0
              ? `${load.tasks.length}件で${durationLabel(load.over)}あふれています。期限をずらすか分担を検討してください。`
              : `${load.tasks.length}件・残り${durationLabel(load.capacity - load.planned)}ぶん空いています。`}
        </p>
      </section>

      <Segmented
        items={LIST_TABS.map((t) => ({ ...t, count: counts[t.key] ?? 0 }))}
        value={tab}
        onChange={onTabChange}
        ariaLabel="表示するタスクの範囲"
      />

      {shown.length === 0 ? (
        <div className="tp-empty">
          <Icon name="sparkle" size={26} />
          <p className="tp-empty-head">{EMPTY[tab].head}</p>
          <p className="tp-empty-body">{EMPTY[tab].body}</p>
        </div>
      ) : (
        <ul className="tp-list">
          {shown.map((task) => (
            <TaskCard key={task.id} task={task} today={today} onToggle={onToggle} onEdit={onEdit} />
          ))}
        </ul>
      )}

      {tab !== 'done' && (
        <p className="tp-list-foot">
          勤務時間の既定は {trim(settings.workHours.start)} 始業・{trim(settings.workHours.end)} 終業。設定から変えられます。
        </p>
      )}
    </div>
  )
}
