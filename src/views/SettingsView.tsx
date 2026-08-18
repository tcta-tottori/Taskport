import { useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Reveal } from '../components/Reveal'
import { dayKey, durationLabel, toMinutes } from '../lib/date'
import { workHoursSummary } from '../lib/workday'
import { makeBackup, readBackup } from '../lib/backup'
import { downloadText } from '../ports/out/download'
import { DEFAULT_WORK_HOURS, type Settings, type Task, type WorkHours } from '../types'

/* =========================================================
 * 設定
 *   - 勤務時間（既定は 8:20 始業 / 12:25〜13:05 昼休憩 / 17:10 終業）
 *   - AI構造化プロキシのURL
 *   - JSON バックアップの書き出し／取り込み
 * =======================================================*/

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

declare const __BUILD_TIME__: string

/** 始業 < 昼休憩開始 < 昼休憩終了 < 終業 の順になっているか */
function validateWorkHours(wh: WorkHours): string | null {
  const s = toMinutes(wh.start)
  const bs = toMinutes(wh.breakStart)
  const be = toMinutes(wh.breakEnd)
  const e = toMinutes(wh.end)
  if (s === null || bs === null || be === null || e === null) return '時刻の形式が正しくありません。'
  if (e <= s) return '終業が始業より前になっています。'
  if (bs < s || be > e) return '昼休憩が勤務時間の外にあります。'
  if (be <= bs) return '昼休憩の終了が開始より前になっています。'
  return null
}

export function SettingsView({
  settings,
  tasks,
  onSave,
  onRestore,
  onNotify,
}: {
  settings: Settings
  tasks: Task[]
  onSave: (s: Settings) => void
  onRestore: (tasks: Task[], settings: Partial<Settings> | null) => Promise<void>
  onNotify: (text: string, tone?: 'ok' | 'error') => void
}) {
  const [draft, setDraft] = useState<Settings>(settings)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const whError = validateWorkHours(draft.workHours)
  const summary = workHoursSummary(draft.workHours)
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  const setWh = (patch: Partial<WorkHours>) =>
    setDraft((d) => ({ ...d, workHours: { ...d.workHours, ...patch } }))

  const toggleDay = (n: number) =>
    setWh({
      workDays: draft.workHours.workDays.includes(n)
        ? draft.workHours.workDays.filter((x) => x !== n)
        : [...draft.workHours.workDays, n].sort(),
    })

  const importFile = async (file: File) => {
    try {
      const text = await file.text()
      const result = readBackup(text)
      await onRestore(result.tasks, result.settings)
      if (result.settings) setDraft((d) => ({ ...d, ...result.settings }))
      onNotify(
        result.skipped > 0
          ? `${result.tasks.length}件を取り込みました（${result.skipped}件は形が合わず取り込めませんでした）`
          : `${result.tasks.length}件を取り込みました`,
      )
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '取り込みに失敗しました', 'error')
    }
  }

  return (
    <div className="tp-view">
      <Reveal>
        <section className="tp-panel">
          <h2 className="tp-panel-title">勤務時間</h2>
          <p className="tp-note">
            スケジュールの目盛りと、1日にどれだけ積めるかの判定に使います。
          </p>

          <div className="tp-wh-grid">
            <label className="tp-field">
              <span className="tp-label">始業</span>
              <input type="time" value={draft.workHours.start} onChange={(e) => setWh({ start: e.target.value })} />
            </label>
            <label className="tp-field">
              <span className="tp-label">昼休憩 開始</span>
              <input
                type="time"
                value={draft.workHours.breakStart}
                onChange={(e) => setWh({ breakStart: e.target.value })}
              />
            </label>
            <label className="tp-field">
              <span className="tp-label">昼休憩 終了</span>
              <input
                type="time"
                value={draft.workHours.breakEnd}
                onChange={(e) => setWh({ breakEnd: e.target.value })}
              />
            </label>
            <label className="tp-field">
              <span className="tp-label">終業</span>
              <input type="time" value={draft.workHours.end} onChange={(e) => setWh({ end: e.target.value })} />
            </label>
          </div>

          <div className="tp-field">
            <span className="tp-label">稼働曜日</span>
            <div className="tp-daypick" role="group" aria-label="稼働曜日">
              {WEEKDAY.map((w, i) => (
                <button
                  key={w}
                  type="button"
                  className={`tp-daypick-btn${draft.workHours.workDays.includes(i) ? ' is-on' : ''}`}
                  aria-pressed={draft.workHours.workDays.includes(i)}
                  onClick={() => toggleDay(i)}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          {whError ? (
            <p className="tp-error" role="alert">
              {whError}
            </p>
          ) : (
            <p className="tp-wh-sum">
              {summary.span}
              {summary.breakSpan && ` ／ 昼休憩 ${summary.breakSpan}`}
              <b> 実働 {durationLabel(summary.minutes)}</b>
            </p>
          )}

          <label className="tp-field">
            <span className="tp-label">見積のないタスクを積むときの既定値</span>
            <div className="tp-suffix">
              <input
                type="number"
                min={5}
                step={5}
                inputMode="numeric"
                value={draft.defaultEstimateMin}
                onChange={(e) =>
                  setDraft({ ...draft, defaultEstimateMin: Math.max(5, Number(e.target.value) || 5) })
                }
              />
              <span>分</span>
            </div>
          </label>

          <div className="tp-row-end">
            <button
              type="button"
              className="tp-btn-ghost"
              title="8:20 始業 / 12:25〜13:05 昼休憩 / 17:10 終業 / 月〜金"
              onClick={() => setWh(DEFAULT_WORK_HOURS)}
            >
              既定に戻す
            </button>
            <button
              type="button"
              className="tp-btn-primary"
              disabled={!!whError || !dirty}
              onClick={() => {
                onSave(draft)
                onNotify('設定を保存しました')
              }}
            >
              <Icon name="check" size={16} />
              保存
            </button>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="tp-panel">
          <h2 className="tp-panel-title">AI構造化プロキシ</h2>
          <p className="tp-note">
            自然文をタスクに分解する Cloudflare Workers のURLです。未設定でも動きますが、
            そのときは端末内のかんたん解析になり、期限の読み取り精度が落ちます。
            <b>APIキーはこの画面に入れないでください。</b>キーは Workers 側に置きます。
          </p>
          <label className="tp-field">
            <span className="tp-label">エンドポイント</span>
            <input
              type="url"
              inputMode="url"
              placeholder="https://taskport-parse.example.workers.dev/parse"
              value={draft.parseEndpoint}
              onChange={(e) => setDraft({ ...draft, parseEndpoint: e.target.value })}
            />
          </label>
          <div className="tp-row-end">
            <button
              type="button"
              className="tp-btn-primary"
              disabled={!dirty}
              onClick={() => {
                onSave(draft)
                onNotify('設定を保存しました')
              }}
            >
              <Icon name="check" size={16} />
              保存
            </button>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="tp-panel">
          <h2 className="tp-panel-title">バックアップ</h2>
          <p className="tp-note">
            タスクは端末の中だけに保存されます。端末の故障やブラウザのデータ削除に備えて、
            ときどき書き出しておいてください。
          </p>
          <div className="tp-row-end">
            <button
              type="button"
              className="tp-btn-ghost"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="export" size={15} />
              JSONを取り込む
            </button>
            <button
              type="button"
              className="tp-btn-primary"
              onClick={() => {
                downloadText(`taskport-backup-${dayKey()}.json`, makeBackup(tasks, settings), 'application/json')
                onNotify(`${tasks.length}件を書き出しました`)
              }}
            >
              <Icon name="download" size={16} />
              JSONで書き出す（{tasks.length}件）
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importFile(f)
              e.target.value = ''
            }}
          />
          <p className="tp-warn">
            <Icon name="alert" size={14} />
            取り込むと、いま端末にあるタスクはすべて置き換わります。
          </p>
        </section>
      </Reveal>

      <Reveal>
        <section className="tp-panel">
          <h2 className="tp-panel-title">このアプリについて</h2>
          <dl className="tp-about">
            <dt>データの置き場所</dt>
            <dd>端末内（IndexedDB）のみ。サーバには置きません。</dd>
            <dt>音声</dt>
            <dd>端末内で文字に変換します。音声データそのものは外部に送信しません。</dd>
            <dt>AIに渡すもの</dt>
            <dd>変換後のテキストだけ。APIキーは Workers 側にあります。</dd>
            <dt>最終更新</dt>
            <dd className="tp-mono">{typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__.slice(0, 16).replace('T', ' ') : '—'}</dd>
          </dl>
        </section>
      </Reveal>
    </div>
  )
}
