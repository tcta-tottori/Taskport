import { useState } from 'react'
import { Icon } from '../components/Icon'
import { DraftFields } from './DraftFields'
import { dueLabel } from '../lib/date'
import { CategoryChip } from '../components/CategoryChip'
import { colorOf } from '../lib/workCategories'
import type { WhisperProgress } from '../lib/whisper'
import type { ParseEngine } from '../ports/in/parseToTasks'
import {
  PRIORITY_LABEL,
  SOURCE_LABEL,
  type CategoryGroup,
  type Job,
  type Draft,
  type WorkHours,
} from '../types'

/* =========================================================
 * 確認画面
 *
 * 解析が出した候補は必ずここを通る。
 * 無確認で保存する経路を作らない。これは仕様であり、簡略化しない。
 *
 * 解析は端末内で完結しており、外部のAIには送っていない。
 * そのぶん期限や優先度の読み取りは素朴なので、ここでの確認が要になる。
 * =======================================================*/

export function ReviewSheet({
  drafts,
  hint,
  sourceText,
  today,
  workHours,
  categoryGroups,
  jobs,
  onChangeCategoryGroups,
  onCommit,
  onCancel,
  canRefine,
  canGemini,
  engine,
  refined,
  refining,
  onRefine,
  onRefineGemini,
  onStopRefine,
  modelLabel,
}: {
  drafts: Draft[]
  /** 予定からの取り込みなど、経路ごとの補足 */
  hint?: string
  sourceText: string
  today: string
  workHours: WorkHours
  categoryGroups: CategoryGroup[]
  /** 案件（工数の単位） */
  jobs: Job[]
  onChangeCategoryGroups: (next: CategoryGroup[]) => void
  onCommit: (drafts: Draft[]) => void
  onCancel: () => void
  /** 録音が残っていて、端末内で取り直せるか */
  canRefine?: boolean
  /** GeminiのAPIキーが入っているか（入っていなければ出さない） */
  canGemini?: boolean
  /** どの読み手が出した候補か */
  engine?: ParseEngine
  /** すでに取り直したあとか */
  refined?: boolean
  /** 取り直しの進み具合。null なら走っていない */
  refining?: WhisperProgress | null
  onRefine?: () => void
  /** 録音を Gemini へ送って取り直す */
  onRefineGemini?: () => void
  onStopRefine?: () => void
  /** 初回に取り込む量の目安（「約80MB」） */
  modelLabel?: string
}) {
  const [items, setItems] = useState<Draft[]>(drafts)
  const [openId, setOpenId] = useState<string | null>(drafts.length === 1 ? drafts[0].tempId : null)
  const [showSource, setShowSource] = useState(false)

  const patch = (tempId: string, p: Partial<Draft>) =>
    setItems((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, ...p } : d)))
  const drop = (tempId: string) => setItems((prev) => prev.filter((d) => d.tempId !== tempId))

  const valid = items.filter((d) => d.title.trim().length > 0)

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label="タスク候補の確認">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>
            候補 <b className="tp-mono">{items.length}</b> 件
          </h2>
          <button type="button" className="tp-icon-btn" onClick={onCancel} aria-label="やめる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <p className={`tp-engine${engine === 'gemini' ? ' tp-engine-remote' : ' tp-engine-local'}`}>
          <Icon name="alert" size={14} />
          {engine === 'gemini'
            ? 'Geminiで解析しました（文章をGoogleへ送っています）。期限の取り違えが起きやすいので必ず確認してください。'
            : '端末内で解析しました。期限の取り違えが起きやすいので必ず確認してください。'}
        </p>
        {hint && <p className="tp-engine-note">{hint}</p>}

        {/* 録音から取り直す。録音中の文字は速いかわりに取りこぼすので、
            気になったときだけ、保存してある音声を端末内で聞き直させる。 */}
        {canRefine && (
          <div className="tp-refine">
            {refining ? (
              <>
                <p className="tp-refine-now">
                  <span className="tp-spin" aria-hidden="true" />
                  {refining.message}
                </p>
                {refining.percent !== null && (
                  <div className="tp-progress">
                    <span style={{ width: `${Math.min(100, refining.percent)}%` }} />
                  </div>
                )}
                <button type="button" className="tp-link-quiet" onClick={onStopRefine}>
                  やめる
                </button>
              </>
            ) : (
              <>
                <div className="tp-refine-row">
                  <button type="button" className="tp-refine-btn" onClick={onRefine}>
                    <Icon name="sparkle" size={15} />
                    端末内で取り直す
                  </button>
                  {canGemini && (
                    <button type="button" className="tp-refine-btn is-remote" onClick={onRefineGemini}>
                      <Icon name="share" size={15} />
                      Geminiで取り直す
                    </button>
                  )}
                </div>
                <p className="tp-refine-note">
                  {refined
                    ? '取り直したあとの文字です。もう一度押せばやり直せます。'
                    : 'いま出ているのは録音中に拾った文字です。取りこぼしがあれば、保存してある音声から作り直せます。'}
                  <br />
                  <b>端末内</b>＝音声は外へ出ません（初回だけモデル {modelLabel ?? ''} を取り込みます）。
                  {canGemini && (
                    <>
                      {' '}
                      <b>Gemini</b>＝<b>録音した音声そのものがGoogleへ送られます。</b>速くて精度は高めです。
                    </>
                  )}
                </p>
              </>
            )}
          </div>
        )}

        <div className="tp-sheet-body">
          {items.length === 0 && (
            <div className="tp-empty">
              <p className="tp-empty-head">候補がなくなりました</p>
              <p className="tp-empty-body">やめるを押して、もう一度入力してください。</p>
            </div>
          )}

          {items.map((d, i) => {
            const open = openId === d.tempId
            return (
              <article key={d.tempId} className={`tp-draft${open ? ' is-open' : ''}`}>
                <div className="tp-draft-head">
                  <button
                    type="button"
                    className="tp-draft-toggle"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : d.tempId)}
                  >
                    <span className="tp-draft-n tp-mono">{i + 1}</span>
                    <span className="tp-draft-sum">
                      <b>{d.title || '（件名が空です）'}</b>
                      <span className="tp-draft-meta">
                        <span className="tp-mono">{dueLabel(d.due, today)}</span>
                        {d.dueTime && <span className="tp-mono">{d.dueTime}</span>}
                        <span className={`tp-draft-pri tp-pri-${d.priority}`}>
                          {PRIORITY_LABEL[d.priority]}
                        </span>
                        {d.categories.map((c) => (
                          <CategoryChip key={c} label={c} color={colorOf(categoryGroups, c)} />
                        ))}
                        <span>{SOURCE_LABEL[d.source]}</span>
                      </span>
                    </span>
                    <Icon name="chevron" size={16} className="tp-draft-caret" />
                  </button>
                  <button
                    type="button"
                    className="tp-icon-btn tp-danger"
                    onClick={() => drop(d.tempId)}
                    aria-label={`${d.title || `候補${i + 1}`} を破棄する`}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
                {open && (
                  <DraftFields
                    draft={d}
                    idPrefix={`rev-${d.tempId}`}
                    workHours={workHours}
                    categoryGroups={categoryGroups}
                    jobs={jobs}
                    onChangeCategoryGroups={onChangeCategoryGroups}
                    onChange={(p) => patch(d.tempId, p)}
                  />
                )}
              </article>
            )
          })}

          <details className="tp-source" open={showSource} onToggle={(e) => setShowSource(e.currentTarget.open)}>
            <summary>元の文章を見る</summary>
            <p>{sourceText}</p>
          </details>
        </div>

        {/* 決めるのは ✓、やめるのは ✕ だけ。件数は上の見出しに出ている。 */}
        <footer className="tp-sheet-foot">
          <button
            type="button"
            className="tp-round-btn tp-round-cancel"
            onClick={onCancel}
            aria-label="やめる"
            title="やめる"
          >
            <Icon name="close" size={22} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            className="tp-round-btn tp-round-go"
            disabled={valid.length === 0}
            onClick={() => onCommit(valid)}
            aria-label={`${valid.length}件を登録する`}
            title={`${valid.length}件を登録`}
          >
            <Icon name="check" size={22} strokeWidth={2.4} />
            {valid.length > 1 && <b className="tp-mono tp-round-n">{valid.length}</b>}
          </button>
        </footer>
      </div>
    </div>
  )
}
