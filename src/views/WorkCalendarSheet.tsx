import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { formatMDShort } from '../lib/date'
import { fetchEvents } from '../ports/in/fromCalendar'
import {
  cycleDay,
  dayKindOf,
  monthGrid,
  setDays,
  shiftMonth,
  toCalendarDays,
  yearCount,
  type CalendarDay,
  type DayKind,
} from '../lib/workCalendar'
import type { Settings, WorkCalendar } from '../types'

/* =========================================================
 * 会社カレンダー
 *
 * 会社が配る紙のカレンダー（祝日・一斉有給・土曜出勤）を、そのまま
 * 実日付で入れる画面。曜日の設定より優先して稼働日の判定に使う。
 *
 * 入れ方は2つ。
 *   1. Googleカレンダーの会社カレンダーから取り込む
 *      → 終日予定を拾い、件名から休み／出勤を見当づける。
 *        当てられないものは人が選ぶ（推測で埋めない）
 *   2. 月の枠を押して1日ずつ決める
 *      → 紙を見ながら順に押していける。指定なし → 休み → 出勤 → 指定なし
 *
 * 年間の稼働日数と休日数を出しているのは、紙に書かれた数字と
 * 突き合わせて「入れ間違えていないか」を自分で確かめられるようにするため。
 * =======================================================*/

const WEEK = ['月', '火', '水', '木', '金', '土', '日']

export function WorkCalendarSheet({
  settings,
  today,
  onSave,
  onNotify,
  onClose,
}: {
  settings: Settings
  today: string
  onSave: (cal: WorkCalendar) => void
  onNotify: (text: string, tone?: 'ok' | 'error') => void
  onClose: () => void
}) {
  const [cal, setCal] = useState<WorkCalendar>(settings.workCalendar)
  const [{ year, month1 }, setMonth] = useState(() => {
    const [y, m] = today.split('-').map(Number)
    return { year: y, month1: m }
  })
  const [importing, setImporting] = useState(false)
  const [found, setFound] = useState<CalendarDay[] | null>(null)
  const [sourceId, setSourceId] = useState(settings.workCalendar.sourceCalendarId)

  const cells = useMemo(() => monthGrid(year, month1), [year, month1])
  const count = useMemo(() => yearCount(year, settings.workHours, cal), [year, settings.workHours, cal])
  const dirty = JSON.stringify(cal) !== JSON.stringify(settings.workCalendar)

  const runImport = async () => {
    if (!settings.googleClientId) {
      onNotify('GoogleのクライアントIDが未設定です。設定画面で登録してください。', 'error')
      return
    }
    setImporting(true)
    try {
      // その年ぜんぶを見る（紙のカレンダーが1年ぶんなので）
      const events = await fetchEvents(
        settings.googleClientId,
        sourceId.trim() || 'primary',
        `${year}-01-01`,
        `${year}-12-31`,
      )
      const days = toCalendarDays(events)
      setFound(days)
      if (days.length === 0) {
        onNotify('そのカレンダーに終日の予定が見つかりませんでした。', 'error')
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'カレンダーを読めませんでした', 'error')
    } finally {
      setImporting(false)
    }
  }

  const applyFound = (kind: Exclude<DayKind, 'normal'>) => {
    if (!found) return
    const days = found.filter((f) => f.kind === kind).map((f) => f.day)
    if (days.length === 0) return
    setCal((c) => setDays(c, days, kind))
    onNotify(`${days.length}日を${kind === 'holiday' ? '休み' : '出勤'}にしました`)
  }

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label="会社カレンダー">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>会社カレンダー</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <p className="tp-note">
            祝日・一斉有給・土曜出勤など、<b>曜日だけでは決まらない日</b>をここで指定します。
            稼働率・空き時間・スケジュール・「稼働日ごと」の繰り返しが、これに従います。
          </p>

          {/* --- 月の枠。紙を見ながら押していく --- */}
          <div className="tp-cal-head">
            <button
              type="button"
              className="tp-icon-btn"
              aria-label="前の月"
              onClick={() => setMonth(shiftMonth(year, month1, -1))}
            >
              <Icon name="chevron" size={18} className="tp-flip" />
            </button>
            <b className="tp-mono">
              {year}年 {month1}月
            </b>
            <button
              type="button"
              className="tp-icon-btn"
              aria-label="次の月"
              onClick={() => setMonth(shiftMonth(year, month1, 1))}
            >
              <Icon name="chevron" size={18} />
            </button>
          </div>

          <div className="tp-cal" role="group" aria-label={`${year}年${month1}月`}>
            {WEEK.map((w) => (
              <span key={w} className={`tp-cal-w${w === '土' || w === '日' ? ' is-end' : ''}`}>
                {w}
              </span>
            ))}
            {cells.map((day, i) =>
              day === null ? (
                <span key={`x${i}`} className="tp-cal-blank" />
              ) : (
                <button
                  key={day}
                  type="button"
                  className={`tp-cal-d is-${dayKindOf(day, cal)}${day === today ? ' is-today' : ''}`}
                  aria-label={`${formatMDShort(day)} を切り替える`}
                  onClick={() => setCal((c) => cycleDay(c, day))}
                >
                  <span className="tp-mono">{Number(day.slice(8))}</span>
                </button>
              ),
            )}
          </div>

          <p className="tp-cal-legend">
            <span className="tp-cal-key is-holiday" /> 休み
            <span className="tp-cal-key is-workday" /> 出勤
            <span className="tp-cal-key is-normal" /> 曜日どおり
          </p>
          <p className="tp-hint">押すたびに 曜日どおり → 休み → 出勤 → 曜日どおり と変わります。</p>

          <p className="tp-cal-count">
            {year}年は <b className="tp-mono">{count.work}</b> 日稼働・
            <b className="tp-mono">{count.off}</b> 日休み（会社カレンダーの紙と見比べてください）
          </p>

          {/* --- Googleカレンダーからの取り込み --- */}
          <h3 className="tp-cal-h">Googleカレンダーから取り込む</h3>
          <p className="tp-note">
            会社のカレンダーを Googleカレンダーに追加してあるなら、そのIDを入れて取り込めます。
            <b>終日の予定だけ</b>を見ます。件名から休み／出勤を見当づけ、分からないものは選んでもらいます。
          </p>
          <label className="tp-field">
            <span className="tp-label">会社カレンダーのID</span>
            <input
              type="text"
              inputMode="url"
              placeholder="例: xxxxx@group.calendar.google.com"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value.trim())}
            />
          </label>
          <div className="tp-row-end">
            <button type="button" className="tp-btn-ghost" disabled={importing} onClick={() => void runImport()}>
              <Icon name="calendar" size={15} />
              {importing ? '読んでいます…' : `${year}年ぶんを読む`}
            </button>
          </div>

          {found && found.length > 0 && (
            <>
              <p className="tp-cal-found">
                終日の予定が <b className="tp-mono">{found.length}</b> 日ぶん見つかりました。
              </p>
              <div className="tp-row-end">
                <button
                  type="button"
                  className="tp-btn-ghost"
                  disabled={!found.some((f) => f.kind === 'holiday')}
                  onClick={() => applyFound('holiday')}
                >
                  休みらしい {found.filter((f) => f.kind === 'holiday').length}日を休みにする
                </button>
                <button
                  type="button"
                  className="tp-btn-ghost"
                  disabled={!found.some((f) => f.kind === 'workday')}
                  onClick={() => applyFound('workday')}
                >
                  出勤らしい {found.filter((f) => f.kind === 'workday').length}日を出勤にする
                </button>
              </div>
              <ul className="tp-cal-list">
                {found.map((f) => (
                  <li key={f.day}>
                    <span>
                      <b className="tp-mono">{formatMDShort(f.day)}</b>
                      <small>{f.title}</small>
                    </span>
                    <span className="tp-chips">
                      {(['holiday', 'workday', 'normal'] as DayKind[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          className={`tp-fchip${dayKindOf(f.day, cal) === k ? ' is-on' : ''}`}
                          onClick={() => setCal((c) => setDays(c, [f.day], k))}
                        >
                          {k === 'holiday' ? '休み' : k === 'workday' ? '出勤' : '曜日どおり'}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <footer className="tp-sheet-foot">
          <button type="button" className="tp-btn-ghost" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="tp-btn-primary"
            disabled={!dirty && sourceId === settings.workCalendar.sourceCalendarId}
            onClick={() => {
              onSave({ ...cal, sourceCalendarId: sourceId, updatedAt: new Date().toISOString() })
              onClose()
            }}
          >
            <Icon name="check" size={16} />
            保存
          </button>
        </footer>
      </div>
    </div>
  )
}
