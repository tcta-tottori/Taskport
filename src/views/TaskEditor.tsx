import { useState } from 'react'
import { Icon } from '../components/Icon'
import { DraftFields } from './DraftFields'
import { taskToDraft } from '../lib/tasks'
import { SOURCE_LABEL, type Draft, type Task } from '../types'

/* =========================================================
 * 既存タスクの編集 / フォーム直接入力
 *
 * AIを経由せず1件を作る経路もここを使う（design.md §6.1.3）。
 * =======================================================*/

export function TaskEditor({
  task,
  initialDraft,
  onSave,
  onDelete,
  onClose,
}: {
  /** 既存タスクの編集なら渡す。新規作成なら undefined */
  task?: Task
  initialDraft: Draft
  onSave: (draft: Draft) => void
  onDelete?: (task: Task) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft>(task ? taskToDraft(task) : initialDraft)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label={task ? 'タスクを編集' : 'タスクを直接作る'}>
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>{task ? 'タスクを編集' : 'タスクを直接作る'}</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <DraftFields draft={draft} idPrefix="edit" onChange={(p) => setDraft({ ...draft, ...p })} />
          {task && (
            <p className="tp-edit-meta">
              入口: {SOURCE_LABEL[task.source]} ／ 登録 {task.createdAt.slice(0, 10)}
              {task.doneAt && ` ／ 完了 ${task.doneAt.slice(0, 10)}`}
            </p>
          )}
          {task && onDelete && (
            <div className="tp-edit-danger">
              {confirmDelete ? (
                <>
                  <p>このタスクを消します。元に戻せません。</p>
                  <div className="tp-row-end">
                    <button type="button" className="tp-btn-ghost" onClick={() => setConfirmDelete(false)}>
                      やめる
                    </button>
                    <button type="button" className="tp-btn-danger" onClick={() => onDelete(task)}>
                      <Icon name="trash" size={15} />
                      消す
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="tp-link-danger" onClick={() => setConfirmDelete(true)}>
                  <Icon name="trash" size={14} />
                  このタスクを消す
                </button>
              )}
            </div>
          )}
        </div>

        <footer className="tp-sheet-foot">
          <button type="button" className="tp-btn-ghost" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="tp-btn-primary"
            disabled={!draft.title.trim()}
            onClick={() => onSave(draft)}
          >
            <Icon name="check" size={16} />
            {task ? '保存' : '登録'}
          </button>
        </footer>
      </div>
    </div>
  )
}
