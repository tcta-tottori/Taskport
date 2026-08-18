import { useMemo } from 'react'
import { Segmented } from '../components/Segmented'
import { TaskCard } from '../components/TaskCard'
import { Icon } from '../components/Icon'
import { FilterBar } from '../components/FilterBar'
import { TodayFlow } from './TodayFlow'
import { filterByTab, LIST_TABS, type ListTab } from '../lib/tasks'
import { applyFilter, isFilterActive } from '../lib/taskFilter'
import { diffDays, durationLabel } from '../lib/date'
import { workloadOf } from '../lib/stats'
import { isWorkDay, trim, workHoursSummary } from '../lib/workday'
import type { SavedFilter, Settings, Task, TaskFilter } from '../types'

/* =========================================================
 * 一覧ビュー（起動時の既定画面）
 * タブ: 今日 / 今週 / すべて / 完了
 * =======================================================*/

const EMPTY: Record<ListTab, { head: string; body: string }> = {
  today: {
    head: '今日締めのタスクはありません',
    body: '左下のマイクで話すか、右下の ＋ から書いてください。',
  },
  week: {
    head: '今週の期限はまだ空いています',
    body: '先の予定を入れておくと、スケジュールで山が見えます。',
  },
  all: {
    head: 'まだタスクがありません',
    body: '歩きながらなら左下のマイク、机の前なら右下の ＋。どちらも同じ場所に貯まります。',
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
  onToggleSubtask,
  filter,
  onFilterChange,
  saved,
  onSaveFilter,
  onRemoveSavedFilter,
  nowMin,
  onTriage,
  onWrapUp,
}: {
  tasks: Task[]
  today: string
  settings: Settings
  tab: ListTab
  onTabChange: (tab: ListTab) => void
  onToggle: (task: Task) => void
  onEdit: (task: Task) => void
  onToggleSubtask: (task: Task, subtaskId: string) => void
  filter: TaskFilter
  onFilterChange: (next: TaskFilter) => void
  saved: SavedFilter[]
  onSaveFilter: (name: string) => void
  onRemoveSavedFilter: (id: string) => void
  /** いまの時刻（0時からの分） */
  nowMin: number
  onTriage: () => void
  onWrapUp: () => void
}) {
  const counts = useMemo(
    () =>
      LIST_TABS.reduce<Record<string, number>>((acc, t) => {
        acc[t.key] = filterByTab(tasks, t.key, today).length
        return acc
      }, {}),
    [tasks, today],
  )
  const searching = isFilterActive(filter)
  // 絞り込み中はタブを離れ、台帳の全件から探す。
  // 「今日」に立ったまま来月の1件を探して0件、という迷い方を防ぐ。
  const found = useMemo(
    () => (searching ? applyFilter(tasks, filter, today, settings.categoryGroups) : []),
    [tasks, filter, today, searching, settings.categoryGroups],
  )
  const shown = useMemo(
    () => (searching ? found : filterByTab(tasks, tab, today)),
    [searching, found, tasks, tab, today],
  )
  const load = useMemo(() => workloadOf(tasks, today, settings), [tasks, today, settings])
  const working = isWorkDay(today, settings.workHours, settings.workCalendar)
  const overdueCount = useMemo(
    () => tasks.filter((t) => t.status === 'open' && !!t.due && diffDays(t.due, today) < 0).length,
    [tasks, today],
  )
  const wh = workHoursSummary(settings.workHours)
  const pct = Math.round(load.ratio * 100)

  return (
    <div className="tp-view tp-cols">
      {/* 左の列: その日の状況。PCでは一覧と並べて置き、スマホでは上に積む。 */}
      <div className="tp-col">
      {/* 今日の稼働。設定した勤務時間に対して、今日締めのタスクがどれだけ積まれているか。 */}
      <section className="tp-today-card">
        <div className="tp-today-row">
          <div>
            <p className="tp-label tp-today-label">TODAY</p>
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
          {!working
            ? load.tasks.length === 0
              ? '今日は会社カレンダーで休みです。'
              : `今日は休みですが、${load.tasks.length}件の期限が今日になっています。朝の仕分けで送り先を決めてください。`
            : load.tasks.length === 0
              ? '今日締めのタスクはまだありません。'
              : load.over > 0
                ? `${load.tasks.length}件で${durationLabel(load.over)}あふれています。期限をずらすか分担を検討してください。`
                : `${load.tasks.length}件・残り${durationLabel(load.capacity - load.planned)}ぶん空いています。`}
        </p>
      </section>

      {/* 今日タブのときだけ「今日の進めかた」を出す。
          ほかのタブは範囲が違うので、枠の話を持ち込むと読み違える。 */}
      {!searching && tab === 'today' && (
        <TodayFlow
          tasks={load.tasks}
          today={today}
          settings={settings}
          nowMin={nowMin}
          overdue={overdueCount}
          onToggle={onToggle}
          onEdit={onEdit}
          onTriage={onTriage}
          onWrapUp={onWrapUp}
        />
      )}

      </div>

      {/* 右の列: 探して、選んで、片づける */}
      <div className="tp-col">
      {/* 探す道具は、一覧が長くなっても手が届くように貼り付ける（スマホ） */}
      <div className="tp-sticky">
        <FilterBar
          filter={filter}
          categoryGroups={settings.categoryGroups}
          onChange={onFilterChange}
          saved={saved}
          onSave={onSaveFilter}
          onRemoveSaved={onRemoveSavedFilter}
          hits={found.length}
        />

        {!searching && (
          <Segmented
            items={LIST_TABS.map((t) => ({ ...t, count: counts[t.key] ?? 0 }))}
            value={tab}
            onChange={onTabChange}
            ariaLabel="表示するタスクの範囲"
          />
        )}
      </div>

      {shown.length === 0 ? (
        searching ? (
          <div className="tp-empty">
            <Icon name="search" size={26} />
            <p className="tp-empty-head">当てはまるタスクはありません</p>
            <p className="tp-empty-body">
              語を短くするか、区分・優先度・期限の条件を外してみてください。
            </p>
          </div>
        ) : (
          <div className="tp-empty">
            <Icon name="sparkle" size={26} />
            <p className="tp-empty-head">{EMPTY[tab].head}</p>
            <p className="tp-empty-body">{EMPTY[tab].body}</p>
          </div>
        )
      ) : (
        <ul className="tp-list">
          {shown.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              today={today}
              onToggle={onToggle}
              onEdit={onEdit}
              onToggleSubtask={onToggleSubtask}
              workHours={settings.workHours}
              categoryGroups={settings.categoryGroups}
            />
          ))}
        </ul>
      )}

      {!searching && tab !== 'done' && (
        <p className="tp-list-foot">
          勤務時間の既定は {trim(settings.workHours.start)} 始業・{trim(settings.workHours.end)} 終業。設定から変えられます。
        </p>
      )}
      </div>
    </div>
  )
}
