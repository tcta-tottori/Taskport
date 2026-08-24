import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { DayBand } from '../components/DayBand'
import { ActualRow } from './ActualSheet'
import { byStart } from '../lib/dashCards'
import { durationLabel, formatMD, fromMinutes } from '../lib/date'
import { trim } from '../lib/workday'
import { colorOfGroup } from '../lib/workCategories'
import type { DaySegment } from '../lib/worklog'
import type { CategoryGroup, Task, WorkHours, WorkRun } from '../types'

/* =========================================================
 * 時間帯（ポップアップ）
 *
 * カードの帯は縮めてあるので、短い区間は名前が出せない。
 * 押したらここを開き、**一覧の形**で読めるようにする。
 *   - 上に縦軸の帯（同時に動かしたぶんは横に並ぶ）
 *   - 下に「何時から何時まで・何を・どれだけ」の一覧
 *   - タスクの行は押すとその場で実績（開始時刻・かかった時間）を直せる
 *
 * 予定の時間は実行ログ（区間の記録）なのでここでは直さない。
 * 直したいときは実行の画面から記録ごと消す。
 * =======================================================*/

export function BandSheet({
  segments,
  day,
  today,
  nowMin,
  tasks,
  runs,
  workHours,
  categoryGroups,
  defaultEstimateMin,
  focusKey,
  onPatch,
  onClose,
}: {
  segments: DaySegment[]
  day: string
  today: string
  /** いまの時刻（0時からの分）。今日を見ているときだけ線を引く */
  nowMin: number
  /** その日の記録（実績を直せるもの） */
  tasks: Task[]
  /** 実行の記録。押して測った開始時刻をここから読む */
  runs: WorkRun[]
  workHours: WorkHours
  categoryGroups: CategoryGroup[]
  defaultEstimateMin: number
  /** 最初から開いておく区間（帯を押して開いたとき） */
  focusKey?: string | null
  onPatch: (task: Task, patch: Partial<Task>) => void
  onClose: () => void
}) {
  const [open, setOpen] = useState<string | null>(focusKey ?? null)
  const rows = bandRows(segments)
  const total = rows.reduce((sum, r) => sum + (r.seg.to - r.seg.from), 0)
  /** 帯を押したときに開く行。区間そのもので引く（鍵は並びから作る） */
  const keyOfSeg = (seg: DaySegment) => rows.find((r) => r.seg === seg)?.key ?? null

  return createPortal(
    <div className="tp-sheet tp-sheet-over" role="dialog" aria-modal="true" aria-label="時間帯">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>時間帯</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <p className="tp-note">
            {formatMD(day)} に<b>押して動かした時間</b>です（合計 {durationLabel(total)}）。
            同時に動かしたぶんは横に並んでいます。
          </p>

          <DayBand
            segments={segments}
            workHours={workHours}
            isToday={day === today}
            nowMin={nowMin}
            colorOfGroupName={(g) => colorOfGroup(categoryGroups, g)}
            onPick={(seg) => setOpen(keyOfSeg(seg))}
          />

          <ul className="tp-span-list">
            {rows.map(({ seg, key }) => {
              const task = seg.taskId ? tasks.find((t) => t.id === seg.taskId) ?? null : null
              const isOpen = open === key
              return (
                <li key={key} className={`tp-span${isOpen ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="tp-span-head"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : key)}
                  >
                    <span
                      className="tp-cat-dot"
                      style={{ '--cat': `var(--cat-${colorOfGroup(categoryGroups, seg.group)})` } as React.CSSProperties}
                      aria-hidden="true"
                    />
                    <span className="tp-span-time tp-mono">
                      {trim(fromMinutes(seg.from))}〜{trim(fromMinutes(seg.to))}
                    </span>
                    <span className="tp-span-title">
                      {seg.title}
                      {seg.kind === 'plan' && <span className="tp-span-kind">予定</span>}
                    </span>
                    <span className="tp-span-min tp-mono">{durationLabel(seg.to - seg.from)}</span>
                    <Icon name="chevron" size={16} className={isOpen ? 'tp-turn' : undefined} />
                  </button>

                  {isOpen && (
                    <div className="tp-span-body">
                      {task ? (
                        <ul className="tp-actual-list">
                          <ActualRow
                            task={task}
                            day={day}
                            runs={runs}
                            categoryGroups={categoryGroups}
                            defaultEstimateMin={defaultEstimateMin}
                            onPatch={onPatch}
                          />
                        </ul>
                      ) : (
                        <p className="tp-empty-body">
                          {seg.kind === 'plan'
                            ? '予定の時間は、実行の画面で押した記録そのものです。ここでは直しません。消したいときは実行の画面から記録ごと消してください。'
                            : 'この記録のタスクが見つかりません（消されたようです）。'}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <footer className="tp-sheet-foot">
          <button type="button" className="tp-btn-primary" onClick={onClose}>
            <Icon name="check" size={16} />
            閉じる
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 一覧に出す並びと、行ごとの鍵。
 *
 * 鍵に**時刻を入れない**（v1.31.1）。入れていたときは、実績を直した拍子に
 * 区間の位置が変わって鍵も変わり、いま開いて直している行がその場で閉じていた。
 * 同じ仕事を2回動かしたぶんは、並び順の番号で分ける。
 */
export function bandRows(segments: DaySegment[]): { seg: DaySegment; key: string }[] {
  const seen = new Map<string, number>()
  return byStart(segments).map((seg) => {
    const id = `${seg.kind}:${seg.taskId ?? seg.planId ?? seg.title}`
    const nth = seen.get(id) ?? 0
    seen.set(id, nth + 1)
    return { seg, key: `${id}#${nth}` }
  })
}
