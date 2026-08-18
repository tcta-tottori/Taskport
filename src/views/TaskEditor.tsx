import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { DraftFields } from './DraftFields'
import { TemplateSheet } from './TemplateSheet'
import { taskToDraft } from '../lib/tasks'
import { applyTemplate } from '../lib/templates'
import {
  SOURCE_LABEL,
  type CategoryGroup,
  type Draft,
  type Task,
  type TaskTemplate,
  type WorkHours,
} from '../types'

/* =========================================================
 * 既存タスクの編集 / 直接入力
 *
 * AIを経由せず1件を作る経路もここを使う（design.md §6.1.3）。
 * v1.11.0 から、自然文からまとめて作る経路もこの画面の中に入れた
 * （下部の「キーボード」ボタンは廃止。入口が2つに割れていて分かりにくかった）。
 *
 * 決める操作は ✓、やめる操作は ✕ の丸ボタンだけにしてある。
 * =======================================================*/

export function TaskEditor({
  task,
  initialDraft,
  initialMode = 'form',
  onSave,
  onDelete,
  onClose,
  workHours,
  categoryGroups,
  onChangeCategoryGroups,
  templates,
  onForgetTemplate,
  onParseText,
  parsing,
}: {
  /** 既存タスクの編集なら渡す。新規作成なら undefined */
  task?: Task
  initialDraft: Draft
  /**
   * どの入口から開いたか（＋の扇で選んだもの）。
   *   form … 空のフォーム ／ memory … 記憶を開いた状態 ／ text … 文章の欄を開いた状態
   */
  initialMode?: 'form' | 'memory' | 'text'
  workHours: WorkHours
  categoryGroups: CategoryGroup[]
  onChangeCategoryGroups: (next: CategoryGroup[]) => void
  /** 記憶したタスク（呼び出して埋める） */
  templates: TaskTemplate[]
  onForgetTemplate: (t: TaskTemplate) => void
  /** 自然文をまとめて候補にする。確認画面へ渡る */
  onParseText: (text: string) => void
  /** 解析中 */
  parsing: boolean
  onSave: (draft: Draft) => void
  onDelete?: (task: Task) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft>(task ? taskToDraft(task) : initialDraft)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 開いた入口に合わせて、最初から該当の面を出しておく
  const [recalling, setRecalling] = useState(!task && initialMode === 'memory')
  const [freeText, setFreeText] = useState('')
  const [freeOpen, setFreeOpen] = useState(!task && initialMode === 'text')
  const freeRef = useRef<HTMLTextAreaElement | null>(null)

  const creating = !task

  // 「文章から作る」で開いたときは、そのまま打ち始められるようにする
  useEffect(() => {
    if (creating && initialMode === 'text') freeRef.current?.focus()
  }, [creating, initialMode])

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
          {creating && (
            <div className="tp-make">
              {/* 一度作ったタスクは控えてある。同じ作業を打ち直さない。 */}
              <button
                type="button"
                className="tp-make-btn"
                disabled={templates.length === 0}
                onClick={() => setRecalling(true)}
              >
                <Icon name="checklist" size={16} />
                <span>記憶から呼び出す</span>
                <b className="tp-mono">{templates.length}</b>
              </button>

              {/* 自然文の入口。1文＝1タスクで、まとめて何件も作れる。 */}
              <button
                type="button"
                className={`tp-make-btn${freeOpen ? ' is-on' : ''}`}
                aria-expanded={freeOpen}
                onClick={() => setFreeOpen((v) => !v)}
              >
                <Icon name="sparkle" size={16} />
                <span>文章から作る</span>
                <Icon name="chevron" size={15} className={`tp-cat-caret${freeOpen ? ' is-open' : ''}`} />
              </button>
            </div>
          )}

          {creating && freeOpen && (
            <div className="tp-free">
              <textarea
                ref={freeRef}
                className="tp-free-area"
                rows={3}
                value={freeText}
                placeholder={
                  '用件をそのまま書く。メールの文面を貼ってもよい。\n例：明日までにサンプル商事へ AB-1234 の納期を確認する'
                }
                onChange={(e) => setFreeText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && freeText.trim()) {
                    onParseText(freeText.trim())
                  }
                }}
              />
              <div className="tp-row-end">
                <button
                  type="button"
                  className="tp-btn-ghost"
                  disabled={!freeText.trim() || parsing}
                  onClick={() => onParseText(freeText.trim())}
                >
                  <Icon name="sparkle" size={15} />
                  {parsing ? '解析中' : '候補にする'}
                </button>
              </div>
              <p className="tp-hint">
                端末の中だけで読み取ります。1文が1件になり、確認画面で直してから登録します。
              </p>
            </div>
          )}

          <DraftFields
            draft={draft}
            idPrefix="edit"
            workHours={workHours}
            categoryGroups={categoryGroups}
            onChangeCategoryGroups={onChangeCategoryGroups}
            onChange={(p) => setDraft({ ...draft, ...p })}
          />
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
        </footer>
      </div>

      {recalling && (
        <TemplateSheet
          templates={templates}
          groups={categoryGroups}
          onPick={(t) => {
            setDraft((d) => applyTemplate(d, t))
            setRecalling(false)
          }}
          onForget={onForgetTemplate}
          onClose={() => setRecalling(false)}
        />
      )}
    </div>
  )
}
