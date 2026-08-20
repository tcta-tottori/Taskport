import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { catStyle } from '../components/CategoryChip'
import { diffDays, dueLabel, durationLabel } from '../lib/date'
import { sortTasks } from '../lib/tasks'
import { isRunning } from '../lib/worklog'
import { taskMinutes } from '../lib/workday'
import type { CategoryGroup, Settings, Task } from '../types'

/* =========================================================
 * 始める（＋の扇から開く）
 *
 * 「いまから手を動かす」ための入口。作る画面とは別で、押した時点で
 * 時間を数え始める。2つの入り方を1つの画面に持つ。
 *
 *   タスクから … 台帳にあるものを選ぶ（今日締めが上、そのあと近日）
 *   区分から   … 台帳に無い飛び込みの作業を、区分の名前で1件立てて始める
 *
 * 選んだら閉じて、実行の画面のいちばん上へ移る（App 側の goRun）。
 * =======================================================*/

export type StartMode = 'task' | 'category'

export function StartSheet({
  mode,
  tasks,
  today,
  settings,
  onStartTask,
  onQuickTask,
  onClose,
}: {
  /** どちらから開いたか。中でも切り替えられる */
  mode: StartMode
  tasks: Task[]
  today: string
  settings: Settings
  onStartTask: (task: Task) => void
  /** 区分から1件立てる。start が true ならそのまま始める */
  onQuickTask: (category: string, start: boolean) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<StartMode>(mode)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  /** 今日締め → 近日 → 期限なし の順。動かしている最中のものは出さない */
  const list = useMemo(() => {
    const open = tasks.filter((t) => t.status === 'open' && !isRunning(t))
    const rank = (t: Task) => {
      if (!t.due) return 2
      return diffDays(t.due, today) <= 0 ? 0 : 1
    }
    const hit = (t: Task) =>
      !q.trim() ||
      `${t.title} ${t.note} ${t.categories.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())
    return sortTasks(open.filter(hit)).sort((a, b) => rank(a) - rank(b))
  }, [tasks, today, q])

  const groups: CategoryGroup[] = settings.categoryGroups

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label="始める">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>始める</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-seg tp-start-seg" role="tablist" aria-label="始め方">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'task'}
            className={`tp-seg-btn${tab === 'task' ? ' is-on' : ''}`}
            onClick={() => setTab('task')}
          >
            タスクから
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'category'}
            className={`tp-seg-btn${tab === 'category' ? ' is-on' : ''}`}
            onClick={() => setTab('category')}
          >
            区分から
          </button>
        </div>

        <div className="tp-sheet-body">
          {tab === 'task' ? (
            <>
              <label className="tp-search">
                <Icon name="search" size={16} />
                <input
                  type="text"
                  className="tp-search-input"
                  value={q}
                  placeholder="件名・区分で探す"
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>

              {list.length === 0 ? (
                <p className="tp-empty-body">
                  {q.trim()
                    ? '見つかりませんでした。区分から立てて始めることもできます。'
                    : '始められるタスクがありません。「区分から」で1件立てて始められます。'}
                </p>
              ) : (
                <ul className="tp-start-list">
                  {list.slice(0, 40).map((t) => (
                    <li key={t.id}>
                      <button type="button" className={`tp-start-item tp-pri-${t.priority}`} onClick={() => onStartTask(t)}>
                        <Icon name="play" size={15} />
                        <span className="tp-start-name">{t.title}</span>
                        <span className="tp-mono tp-start-meta">
                          {dueLabel(t.due, today)} ／ {durationLabel(taskMinutes(t, settings.defaultEstimateMin))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="tp-hint">押すとその場で時間を数え始め、実行の画面へ移ります。</p>
            </>
          ) : (
            <>
              <p className="tp-note">
                台帳に無い飛び込みの作業を、区分1つで立てて始めます。件名は区分の名前で作られるので、
                あとから直せます。＋は立てるだけ。
              </p>
              <div className="tp-launch">
                <div className="tp-launch-groups">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`tp-launch-group${openId === g.id ? ' is-on' : ''}`}
                      style={catStyle(g.color)}
                      aria-expanded={openId === g.id}
                      onClick={() => setOpenId(openId === g.id ? null : g.id)}
                    >
                      <span className="tp-cat-dot" aria-hidden="true" />
                      {g.name}
                    </button>
                  ))}
                </div>
                {openId && (
                  <ul className="tp-launch-items">
                    {(groups.find((g) => g.id === openId)?.items ?? []).map((item) => (
                      <li key={item}>
                        <button
                          type="button"
                          className="tp-launch-item"
                          title="立てて始める"
                          onClick={() => onQuickTask(item, true)}
                        >
                          <Icon name="play" size={14} />
                          <span>{item}</span>
                        </button>
                        <button
                          type="button"
                          className="tp-launch-add"
                          aria-label={`${item} を立てるだけ`}
                          title="立てるだけ"
                          onClick={() => onQuickTask(item, false)}
                        >
                          <Icon name="plus" size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
