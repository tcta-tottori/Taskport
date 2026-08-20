import { useState } from 'react'
import { Icon } from '../components/Icon'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DraftFields } from './DraftFields'
import { taskToDraft } from '../lib/tasks'
import { dayOfIso } from '../lib/date'
import { SOURCE_LABEL, type CategoryGroup, type Draft, type Job, type Task, type WorkHours } from '../types'

/* =========================================================
 * 既存タスクの編集 / 手描き（自分で書いて1件作る）
 *
 * ＋の扇の「手描き」から開く。AIを経由せず1件を作る経路（design.md §6.1.3）。
 *
 * v1.11.0 では、この画面の中に「記憶から呼び出す」「文章から作る」も
 * 抱えていたが、**v1.13.0 でそれぞれ独立した画面にした**（利用者の指示）。
 * 扇で選んだものがそのまま開くほうが手数が少なく、この画面も1つの仕事に戻る。
 * 記憶から呼び出したときは、中身の入った状態でこの画面が開く。
 *
 * 決める操作は ✓、やめる操作は ✕ の丸ボタンだけにしてある。
 * =======================================================*/

export function TaskEditor({
  task,
  initialDraft,
  onSave,
  onDelete,
  onClose,
  workHours,
  categoryGroups,
  jobs,
  onChangeCategoryGroups,
}: {
  /** 既存タスクの編集なら渡す。新規作成なら undefined */
  task?: Task
  /** 新規作成の下敷き。記憶から呼び出したときは中身が入っている */
  initialDraft: Draft
  workHours: WorkHours
  categoryGroups: CategoryGroup[]
  /** 案件（工数の単位） */
  jobs: Job[]
  onChangeCategoryGroups: (next: CategoryGroup[]) => void
  onSave: (draft: Draft) => void
  onDelete?: (task: Task) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft>(task ? taskToDraft(task) : initialDraft)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label={task ? 'タスクを編集' : 'タスクを作る'}>
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>{task ? 'タスクを編集' : 'タスクを作る'}</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <DraftFields
            draft={draft}
            idPrefix="edit"
            workHours={workHours}
            categoryGroups={categoryGroups}
            jobs={jobs}
            onChangeCategoryGroups={onChangeCategoryGroups}
            onChange={(p) => setDraft({ ...draft, ...p })}
          />
          {task && (
            <p className="tp-edit-meta">
              入口: {SOURCE_LABEL[task.source]} ／ 登録 {dayOfIso(task.createdAt)}
              {task.doneAt && ` ／ 完了 ${dayOfIso(task.doneAt)}`}
            </p>
          )}
        </div>

        {/* 消す・やめる・決める は下に固定して置く（v1.26.0。利用者の指示）。
            消すは左端に離し、押したら確かめる窓を1枚はさむ。 */}
        <footer className={`tp-sheet-foot${task && onDelete ? ' tp-foot-split' : ''}`}>
          {task && onDelete && (
            <button
              type="button"
              className="tp-round-btn tp-round-danger"
              onClick={() => setConfirmDelete(true)}
              aria-label="このタスクを消す"
              title="消す"
            >
              <Icon name="trash" size={20} />
            </button>
          )}
          <div className="tp-foot-right">
            <button
              type="button"
              className="tp-round-btn tp-round-cancel"
              onClick={onClose}
              aria-label="やめる"
              title="やめる"
            >
              <Icon name="close" size={22} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              className="tp-round-btn tp-round-go"
              disabled={!draft.title.trim()}
              onClick={() => onSave(draft)}
              aria-label={task ? '保存する' : '登録する'}
              title={task ? '保存' : '登録'}
            >
              <Icon name="check" size={22} strokeWidth={2.4} />
            </button>
          </div>
        </footer>

        {confirmDelete && task && onDelete && (
          <ConfirmDialog
            title="このタスクを消しますか"
            body={`「${task.title}」を消します。元に戻せません。`}
            okLabel="消す"
            onOk={() => onDelete(task)}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </div>

    </div>
  )
}
