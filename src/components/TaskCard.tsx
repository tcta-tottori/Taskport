import { dueLabel } from '../lib/date'
import { overdueDays } from '../lib/tasks'
import { repeatLabel } from '../lib/repeat'
import { durationLabel } from '../lib/date'
import { Icon } from './Icon'
import { PRIORITY_LABEL, type Task } from '../types'

/**
 * 一覧の1件。
 * 左端5pxの色帯だけで優先度を示し、本文には色を付けない。
 * 期限・優先度・見込みは等幅で桁を揃え、一覧の走査を速くする。
 */
export function TaskCard({
  task,
  today,
  onToggle,
  onEdit,
}: {
  task: Task
  today: string
  onToggle: (task: Task) => void
  onEdit: (task: Task) => void
}) {
  const over = overdueDays(task, today)
  const done = task.status === 'done'

  return (
    <li className={`tp-card tp-pri-${task.priority}${done ? ' is-done' : ''}`}>
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
          {task.estimateMin && <span className="tp-chip-est">{durationLabel(task.estimateMin)}</span>}
          {task.repeat && (
            <span className="tp-chip-rep">
              <Icon name="repeat" size={11} /> {repeatLabel(task.repeat)}
            </span>
          )}
          {task.category && <span className="tp-chip-cat">{task.category}</span>}
          <span className="tp-pri-tag">{PRIORITY_LABEL[task.priority]}</span>
        </span>
      </button>
    </li>
  )
}
