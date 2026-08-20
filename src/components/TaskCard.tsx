import { useState } from 'react'
import { dueLabel } from '../lib/date'
import { overdueDays } from '../lib/tasks'
import { repeatLabel } from '../lib/repeat'
import { isRunning, runningMin } from '../lib/worklog'
import { timeboxLabel } from '../lib/timebox'
import { durationLabel } from '../lib/date'
import { Icon } from './Icon'
import { CategoryChip } from './CategoryChip'
import { colorOf } from '../lib/workCategories'
import { PRIORITY_LABEL, type CategoryGroup, type Task, type WorkHours } from '../types'

/**
 * 一覧の1件。
 * 左端5pxの色帯だけで優先度を示し、本文には色を付けない。
 * 期限・優先度・見込みは等幅で桁を揃え、一覧の走査を速くする。
 *
 * 手順（サブタスク）を持つときは、件数のチップから開いてその場で潰せる。
 * 一つ潰すたびに編集画面へ入るのは、歩きながらだと重すぎる。
 */
export function TaskCard({
  task,
  today,
  onToggle,
  onEdit,
  onToggleSubtask,
  onToggleRunning,
  workHours,
  categoryGroups,
  jobName,
}: {
  task: Task
  today: string
  /** 時間枠の名前を出すために使う。省略すると枠は出さない */
  workHours?: WorkHours
  /** 区分の色を引くためのマスタ */
  categoryGroups: CategoryGroup[]
  /** 案件の名前（工数の単位）。無いときは出さない */
  jobName?: string | null
  onToggle: (task: Task) => void
  onEdit: (task: Task) => void
  /** 手順1つの済／未了を切り替える */
  onToggleSubtask?: (task: Task, subtaskId: string) => void
  /** いま手を付ける／手を止める。渡さなければボタンを出さない */
  onToggleRunning?: (task: Task) => void
}) {
  const over = overdueDays(task, today)
  const done = task.status === 'done'
  const subs = task.subtasks
  const subDone = subs.filter((s) => s.done).length
  const [openSubs, setOpenSubs] = useState(false)
  const box = workHours && task.timebox ? timeboxLabel(task.timebox, workHours) : ''
  const live = isRunning(task)

  return (
    <li className={`tp-card tp-pri-${task.priority}${done ? ' is-done' : ''}${live ? ' is-live' : ''}`}>
      <div className="tp-card-main">
        <button
          type="button"
          className="tp-check"
          aria-pressed={done}
          aria-label={done ? `${task.title} を未完了に戻す` : `${task.title} を完了にする`}
          onClick={() => onToggle(task)}
        >
          {done && <Icon name="check" size={15} strokeWidth={2.6} />}
        </button>

        <button type="button" className="tp-card-body" onClick={() => onEdit(task)}>
          <span className="tp-card-title">{task.title}</span>
          {task.note && <span className="tp-card-note">{task.note}</span>}
          <span className="tp-card-meta">
            <span className={`tp-due${over > 0 ? ' is-over' : ''}`}>
              {over > 0 ? `${over}日超過` : dueLabel(task.due, today)}
            </span>
            {task.dueTime && (
              <span className="tp-chip-time">
                <Icon name="clock" size={12} /> {task.dueTime}
              </span>
            )}
            {live && (
              <span className="tp-chip-live tp-mono">実行中 {durationLabel(runningMin(task))}</span>
            )}
            {task.actualMin !== null && (
              <span className="tp-chip-act">実績 {durationLabel(task.actualMin)}</span>
            )}
            {task.estimateMin && <span className="tp-chip-est">{durationLabel(task.estimateMin)}</span>}
            {box && <span className="tp-chip-box">{box}</span>}
            {task.repeat && (
              <span className="tp-chip-rep">
                <Icon name="repeat" size={11} /> {repeatLabel(task.repeat)}
              </span>
            )}
            {jobName && (
              <span className="tp-chip-job">
                <Icon name="checklist" size={11} /> {jobName}
              </span>
            )}
            {task.categories.map((c) => (
              <CategoryChip key={c} label={c} color={colorOf(categoryGroups, c)} />
            ))}
            <span className="tp-pri-tag">{PRIORITY_LABEL[task.priority]}</span>
          </span>
        </button>

        {/* いま手を動かしているものを1タップで残す。押した時刻から数えるだけ。 */}
        {onToggleRunning && !done && (
          <button
            type="button"
            className={`tp-run${live ? ' is-on' : ''}`}
            aria-pressed={live}
            aria-label={live ? `${task.title} の手を止める` : `${task.title} を始める`}
            onClick={() => onToggleRunning(task)}
          >
            {live ? '止める' : '始める'}
          </button>
        )}
      </div>

      {subs.length > 0 && (
        <>
          <button
            type="button"
            className={`tp-sub-toggle${openSubs ? ' is-open' : ''}`}
            aria-expanded={openSubs}
            onClick={() => setOpenSubs((v) => !v)}
          >
            <Icon name="checklist" size={13} />
            <span className="tp-mono">
              {subDone}/{subs.length}
            </span>
            <span className="tp-sub-bar" aria-hidden="true">
              <span style={{ width: `${(subDone / subs.length) * 100}%` }} />
            </span>
            <Icon name="chevron" size={14} className="tp-sub-caret" />
          </button>

          {openSubs && (
            <ul className="tp-sub-list">
              {subs.map((st) => (
                <li key={st.id}>
                  <button
                    type="button"
                    className={`tp-sub-check${st.done ? ' is-on' : ''}`}
                    aria-pressed={st.done}
                    aria-label={st.done ? `${st.title} を未了に戻す` : `${st.title} を済にする`}
                    onClick={() => onToggleSubtask?.(task, st.id)}
                  >
                    {st.done && <Icon name="check" size={13} strokeWidth={2.6} />}
                  </button>
                  <span className={st.done ? 'is-done' : ''}>{st.title}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  )
}
