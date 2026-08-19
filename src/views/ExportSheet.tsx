import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Segmented } from '../components/Segmented'
import { dayKey, formatMDShort } from '../lib/date'
import { sortTasks } from '../lib/tasks'
import { toCsv } from '../ports/out/toCsv'
import { toBulletList, toDailyReport, toStandupText, toWorkLogTsv } from '../ports/out/toPlainText'
import { toGoogleCalendarUrl, toIcs, workHoursIcs } from '../ports/out/toCalendar'
import { pushTasks } from '../ports/out/toGoogleCalendar'
import { copyText, downloadText } from '../ports/out/download'
import { workHoursSummary } from '../lib/workday'
import { occurrencesOn } from '../lib/plans'
import type { Plan, Settings, Task } from '../types'

/* =========================================================
 * 出力形式の選択
 *
 * 入れた情報が使いたい形で取り出せること。
 * どの形式も「Task[] を渡すだけ」で、変換処理は ports/out に置いてある。
 * =======================================================*/

type Kind = 'text' | 'calendar' | 'csv'

const KINDS: { key: Kind; label: string }[] = [
  { key: 'text', label: 'テキスト' },
  { key: 'calendar', label: 'カレンダー' },
  { key: 'csv', label: 'CSV' },
]

type TextForm = 'worklog' | 'report' | 'standup' | 'bullets'

export function ExportSheet({
  tasks,
  today,
  settings,
  plans,
  onClose,
  onNotify,
}: {
  tasks: Task[]
  today: string
  settings: Settings
  /** その日の予定。日報の枠を先に取る（台帳には混ぜない） */
  plans: Plan[]
  onClose: () => void
  onNotify: (text: string, tone?: 'ok' | 'error') => void
}) {
  const [kind, setKind] = useState<Kind>('text')
  const [form, setForm] = useState<TextForm>('worklog')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pushing, setPushing] = useState(false)

  const open = useMemo(() => sortTasks(tasks.filter((t) => t.status === 'open')), [tasks])
  const withDue = useMemo(() => open.filter((t) => !!t.due), [open])
  const selected = useMemo(() => withDue.filter((t) => picked.has(t.id)), [withDue, picked])
  const wh = workHoursSummary(settings.workHours)
  // 予定はその日ぶんだけ展開する（繰り返しは持ち回らない）
  const occurrences = useMemo(
    () =>
      occurrencesOn(plans, today, {
        workHours: settings.workHours,
        workCalendar: settings.workCalendar,
      }),
    [plans, today, settings.workHours, settings.workCalendar],
  )

  const preview =
    form === 'worklog'
      ? toWorkLogTsv(tasks, today, settings.workHours, settings.defaultEstimateMin, occurrences)
      : form === 'report'
        ? toDailyReport(tasks, today, occurrences)
        : form === 'standup'
          ? toStandupText(tasks, today)
          : toBulletList(open)

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text)
    onNotify(
      ok ? `${what}をコピーしました` : 'コピーできませんでした。文面を選んで手動でコピーしてください。',
      ok ? 'ok' : 'error',
    )
  }

  return (
    <div className="tp-sheet" role="dialog" aria-modal="true" aria-label="書き出し">
      <div className="tp-sheet-card">
        <header className="tp-sheet-head">
          <h2>書き出し</h2>
          <button type="button" className="tp-icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="tp-sheet-body">
          <Segmented items={KINDS} value={kind} onChange={setKind} ariaLabel="書き出す形式" />

          {kind === 'text' && (
            <>
              <Segmented
                items={[
                  { key: 'worklog' as TextForm, label: '業務日報' },
                  { key: 'report' as TextForm, label: '日報' },
                  { key: 'standup' as TextForm, label: '朝会' },
                  { key: 'bullets' as TextForm, label: '箇条書き' },
                ]}
                value={form}
                onChange={setForm}
                ariaLabel="テキストの形"
              />
              {form === 'worklog' && (
                <p className="tp-note">
                  資材課日報の様式（30分枠 × 時間／業務内容／詳細内容）です。
                  タブ区切りなので、コピーして日報シートの時間欄にそのまま貼れます。
                  時刻のないタスクは空き枠へ上から詰めています。<b>埋まらなかった枠は空欄のままです。</b>
                </p>
              )}
              <pre className="tp-preview">{preview}</pre>
              <div className="tp-row-end">
                <button type="button" className="tp-btn-primary" onClick={() => copy(preview, '文面')}>
                  <Icon name="copy" size={16} />
                  クリップボードにコピー
                </button>
              </div>
            </>
          )}

          {kind === 'calendar' && (
            <>
              <p className="tp-note">
                時刻のないタスクは終日予定になります。見込み時間を入れておくと、その長さで登録されます。
              </p>

              <div className="tp-pick-head">
                <span className="tp-label">対象のタスク（{selected.length}件を選択中）</span>
                <button
                  type="button"
                  className="tp-link"
                  onClick={() =>
                    setPicked(picked.size === withDue.length ? new Set() : new Set(withDue.map((t) => t.id)))
                  }
                >
                  {picked.size === withDue.length ? 'すべて外す' : 'すべて選ぶ'}
                </button>
              </div>

              {withDue.length === 0 ? (
                <p className="tp-empty-body">期限のあるタスクがありません。期限を入れると登録できます。</p>
              ) : (
                <ul className="tp-picklist">
                  {withDue.map((t) => (
                    <li key={t.id}>
                      <label className="tp-pick">
                        <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
                        <span className="tp-pick-title">{t.title}</span>
                        <span className="tp-mono tp-muted">
                          {formatMDShort(t.due as string)}
                          {t.dueTime ? ` ${t.dueTime}` : ''}
                        </span>
                      </label>
                      <a
                        className="tp-link"
                        href={toGoogleCalendarUrl(t, settings.defaultEstimateMin) ?? '#'}
                        target="_blank"
                        rel="noreferrer"
                      >
                        1件だけ登録
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              {settings.googleClientId && (
                <p className="tp-note tp-note-warn">
                  <Icon name="alert" size={14} />
                  Googleカレンダーに追加すると、選んだタスクの件名とメモが Google に渡ります。
                </p>
              )}

              <div className="tp-row-end">
                {settings.googleClientId && (
                  <button
                    type="button"
                    className="tp-btn-ghost"
                    disabled={selected.length === 0 || pushing}
                    onClick={async () => {
                      setPushing(true)
                      try {
                        const r = await pushTasks(
                          settings.googleClientId,
                          settings.googleCalendarId,
                          selected,
                          settings.defaultEstimateMin,
                        )
                        const parts = [`${r.ok}件を追加しました`]
                        if (r.skipped > 0) parts.push(`期限なし${r.skipped}件は送れません`)
                        if (r.failed.length > 0) parts.push(`${r.failed.length}件が失敗`)
                        onNotify(parts.join('／'), r.failed.length > 0 ? 'error' : 'ok')
                      } catch (err) {
                        onNotify(err instanceof Error ? err.message : 'カレンダーに追加できませんでした', 'error')
                      } finally {
                        setPushing(false)
                      }
                    }}
                  >
                    <Icon name="calendar" size={15} />
                    {pushing ? '追加中…' : `${selected.length}件をGoogleカレンダーへ`}
                  </button>
                )}
                <button
                  type="button"
                  className="tp-btn-ghost"
                  onClick={() => {
                    downloadText(
                      `taskport-workhours-${today}.ics`,
                      workHoursIcs(today, settings.workHours),
                      'text/calendar',
                    )
                    onNotify('勤務時間の予定を書き出しました')
                  }}
                >
                  <Icon name="clock" size={15} />
                  勤務時間（{wh.span}）
                </button>
                <button
                  type="button"
                  className="tp-btn-primary"
                  disabled={selected.length === 0}
                  onClick={() => {
                    downloadText(
                      `taskport-${today}.ics`,
                      toIcs(selected, settings.defaultEstimateMin),
                      'text/calendar',
                    )
                    onNotify(`${selected.length}件を .ics に書き出しました`)
                  }}
                >
                  <Icon name="download" size={16} />
                  {selected.length}件を .ics で書き出す
                </button>
              </div>
            </>
          )}

          {kind === 'csv' && (
            <>
              <p className="tp-note">
                全項目を CSV で出します。Excel での集計や、上長への共有に使ってください。
              </p>
              <div className="tp-row-end">
                <button
                  type="button"
                  className="tp-btn-ghost"
                  onClick={() => copy(toCsv(tasks), 'CSV')}
                >
                  <Icon name="copy" size={15} />
                  コピー
                </button>
                <button
                  type="button"
                  className="tp-btn-primary"
                  onClick={() => {
                    downloadText(`taskport-${dayKey()}.csv`, toCsv(tasks), 'text/csv')
                    onNotify(`${tasks.length}件を CSV に書き出しました`)
                  }}
                >
                  <Icon name="download" size={16} />
                  {tasks.length}件を CSV で書き出す
                </button>
              </div>
            </>
          )}
        </div>

        <footer className="tp-sheet-foot">
          <button type="button" className="tp-btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </div>
    </div>
  )
}
