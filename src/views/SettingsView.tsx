import { useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Reveal } from '../components/Reveal'
import { dayKey, durationLabel, toMinutes } from '../lib/date'
import { workHoursSummary } from '../lib/workday'
import { makeBackup, readBackup } from '../lib/backup'
import { downloadText } from '../ports/out/download'
import { DEFAULT_WORK_HOURS, type Settings, type Task, type WorkHours } from '../types'
import { APP_VERSION, buildLabel } from '../version'
import { acquireToken, disconnect, isConnected } from '../lib/googleAuth'
import { askPermission, leadLabel, notificationsUsable, triggersSupported } from '../lib/reminder'

/* =========================================================
 * 設定
 *   - 勤務時間（既定は日報の時間枠どおり。実働 8時間ちょうど）
 *   - 録音（音声を残すか・画面を点けたままにするか）
 *   - 期限のリマインド（出る条件をそのまま書く）
 *   - Googleカレンダー連携
 *   - JSON バックアップの書き出し／取り込み
 * =======================================================*/

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

/** リマインドの何分前。実務で使うところだけ並べる。 */
const LEADS = [0, 5, 10, 15, 30, 60]

/** 承認済みの JavaScript 生成元として Google Cloud に入れる値 */
const origin = window.location.origin

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
  sync,
  onSyncNow,
  onClearRemote,
  onEditCalendar,
}: {
  settings: Settings
  tasks: Task[]
  onSave: (s: Settings) => void
  onRestore: (tasks: Task[], settings: Partial<Settings> | null) => Promise<void>
  onNotify: (text: string, tone?: 'ok' | 'error') => void
  /** 同期の様子 */
  sync: { state: 'off' | 'idle' | 'running' | 'ok' | 'error'; at: string | null; message: string }
  onSyncNow: () => void
  /** Drive 側の置き場を空にする */
  onClearRemote: () => Promise<void>
  /** 会社カレンダーの画面を開く */
  onEditCalendar: () => void
}) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [connected, setConnected] = useState(isConnected())
  const [connecting, setConnecting] = useState(false)
  const [clearingRemote, setClearingRemote] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
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
              {summary.shortBreaks.length > 0 && ` ／ 小休憩 ${summary.shortBreaks.join(' ')}`}
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
              title="8:20 始業 / 小休憩 10:20〜10:25・15:05〜15:10 / 昼休憩 12:25〜13:05 / 17:10 終業 / 月〜金"
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
          <h2 className="tp-panel-title">会社カレンダー</h2>
          <p className="tp-note">
            祝日・一斉有給・土曜出勤など、<b>曜日だけでは決まらない日</b>を持ちます。
            稼働率・空き時間・スケジュール・「稼働日ごと」の繰り返しが、これに従います。
          </p>
          <p className="tp-cal-sum">
            <Icon name="calendar" size={15} />
            {settings.workCalendar.holidays.length + settings.workCalendar.workdays.length === 0 ? (
              'まだ登録がありません。曜日の設定だけで動いています。'
            ) : (
              <>
                休み <b className="tp-mono">{settings.workCalendar.holidays.length}</b> 日 ／ 出勤{' '}
                <b className="tp-mono">{settings.workCalendar.workdays.length}</b> 日
              </>
            )}
          </p>
          <div className="tp-row-end">
            <button type="button" className="tp-btn-ghost" onClick={onEditCalendar}>
              <Icon name="calendar" size={15} />
              カレンダーを開く
            </button>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="tp-panel">
          <h2 className="tp-panel-title">録音</h2>
          <p className="tp-note">
            録音した音声は<b>端末の中だけ</b>に残ります。外部には送信しません。
            AIに渡るのは認識後のテキストだけです。
          </p>
          <label className="tp-switch">
            <span>
              <b>音声を端末に残す</b>
              <small>「本当にそう言ったか」を後から録音履歴で確かめられます。切ると認識テキストだけ残ります。</small>
            </span>
            <input
              type="checkbox"
              checked={draft.keepAudio}
              onChange={(e) => setDraft({ ...draft, keepAudio: e.target.checked })}
            />
          </label>
          <label className="tp-switch">
            <span>
              <b>録音中は画面を点けたままにする</b>
              <small>電池を使います。画面を消しても録音は続くので、通常は切ったままで構いません。</small>
            </span>
            <input
              type="checkbox"
              checked={draft.keepAwake}
              onChange={(e) => setDraft({ ...draft, keepAwake: e.target.checked })}
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
          <h2 className="tp-panel-title">期限のリマインド</h2>
          <p className="tp-note">
            <b>時刻を入れたタスク</b>だけが対象です。期限が日付だけのものは通知しません。
          </p>

          <label className="tp-switch">
            <span>
              <b>締め切り前に通知する</b>
              <small>
                {triggersSupported()
                  ? 'この端末は予約に対応しています。アプリを閉じていても通知が出ます。'
                  : 'この端末は予約に対応していません。アプリを開いている間だけ通知が出ます。'}
              </small>
            </span>
            <input
              type="checkbox"
              checked={draft.reminderEnabled}
              onChange={async (e) => {
                const on = e.target.checked
                if (on) {
                  const p = await askPermission()
                  if (p !== 'granted') {
                    onNotify('通知が許可されていません。ブラウザの通知許可を確認してください。')
                    return
                  }
                }
                setDraft({ ...draft, reminderEnabled: on })
              }}
            />
          </label>

          {draft.reminderEnabled && (
            <div className="tp-field">
              <span className="tp-label">いつ出すか</span>
              <div className="tp-chips">
                {LEADS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`tp-fchip${draft.reminderLeadMin === m ? ' is-on' : ''}`}
                    aria-pressed={draft.reminderLeadMin === m}
                    onClick={() => setDraft({ ...draft, reminderLeadMin: m })}
                  >
                    {leadLabel(m)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="tp-note">
            通知はこの端末の中だけで組み立てます。予定を外部のサーバへ送ることはありません。
            そのぶん、<b>
              {triggersSupported()
                ? '7日先までのぶんを予約し、アプリを開くたびに張り直します。それより先の予定は、次にアプリを開いたときに予約されます。'
                : 'アプリを閉じている間は通知が出ません。'}
            </b>
            {!notificationsUsable() && ' この環境では通知そのものが使えません。'}
          </p>

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
          <h2 className="tp-panel-title">スマホとPCで共有する</h2>
          <p className="tp-note">
            同じ台帳をどちらの端末からも使えるようにします。
            置き場は <b>自分の Google Drive のアプリ専用フォルダ</b>で、
            マイドライブには出てこず、ほかのアプリからも見えません。
          </p>
          <p className="tp-note">
            <b>入れると、タスクの件名・メモ・区分が Google に保存されます。</b>
            これまでは端末の中だけでした。音声そのものは今までどおり外へ出しません。
            切れば、以後は上げません（すでに上がったぶんは下の「置き場を空にする」で消せます）。
          </p>

          <label className="tp-switch">
            <span>
              <b>ほかの端末と同じ台帳を使う</b>
              <small>
                下の Googleカレンダーと同じクライアントIDを使います。先にそちらを設定してください。
              </small>
            </span>
            <input
              type="checkbox"
              checked={draft.syncEnabled}
              disabled={!draft.googleClientId}
              onChange={(e) => setDraft({ ...draft, syncEnabled: e.target.checked })}
            />
          </label>

          {!draft.googleClientId && (
            <p className="tp-note">
              クライアントIDがまだ入っていません。下の「Googleカレンダー」の手順で作って貼ると、ここが使えるようになります。
            </p>
          )}

          {settings.syncEnabled && (
            <>
              <p className={`tp-sync-panel${sync.state === 'error' ? ' is-error' : sync.state === 'ok' ? ' is-ok' : ''}`}>
                <Icon name={sync.state === 'error' ? 'alert' : sync.state === 'ok' ? 'check' : 'repeat'} size={14} />
                {sync.state === 'running'
                  ? '同期しています…'
                  : sync.state === 'error'
                    ? sync.message
                    : sync.at
                      ? `最後に同期したのは ${sync.at.slice(11, 16)}`
                      : 'まだ同期していません'}
              </p>
              <p className="tp-note">
                アプリを開いたときと、画面に戻ってきたとき、変更してから数秒後に自動で合わせます。
                <b>同じ1件を2台でほぼ同時に直すと、あとから保存したほうだけが残ります。</b>
                通信が切れているときは手元にだけ残り、次につながったときに合流します。
              </p>
              <div className="tp-row-end">
                <button type="button" className="tp-btn-ghost" onClick={onSyncNow} disabled={sync.state === 'running'}>
                  <Icon name="repeat" size={15} />
                  {sync.state === 'running' ? '同期中…' : 'いま同期する'}
                </button>
              </div>
            </>
          )}

          {/* 置き場の後始末。同期を切っただけでは、上げたぶんは残ったまま。 */}
          <div className="tp-edit-danger">
            {confirmClear ? (
              <>
                <p>
                  Google Drive に置いたぶんを消し、<b>同期も切ります</b>
                  （入れたままだと、次の同期ですぐ上がり直してしまうため）。
                  <b>この端末のタスクは消えません。</b>ほかの端末にあるぶんも消えません。
                  <b>ほかの端末で同期が入ったままだと、そちらから上がり直します。</b>
                  完全にやめるなら、両方の端末で切ってから消してください。
                </p>
                <div className="tp-row-end">
                  <button type="button" className="tp-btn-ghost" onClick={() => setConfirmClear(false)}>
                    やめる
                  </button>
                  <button
                    type="button"
                    className="tp-btn-danger"
                    disabled={clearingRemote}
                    onClick={async () => {
                      setClearingRemote(true)
                      try {
                        await onClearRemote()
                        setConfirmClear(false)
                      } finally {
                        setClearingRemote(false)
                      }
                    }}
                  >
                    <Icon name="trash" size={15} />
                    {clearingRemote ? '消しています…' : '置き場を空にする'}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="tp-link-danger"
                disabled={!draft.googleClientId}
                onClick={() => setConfirmClear(true)}
              >
                <Icon name="trash" size={14} />
                Google に置いたぶんを消す
              </button>
            )}
          </div>

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
          <h2 className="tp-panel-title">Googleカレンダー</h2>
          <p className="tp-note">
            予定の読み込みと追加ができます。<b>予定を追加すると、タスクの件名とメモが Google に渡ります。</b>
            送るのは押したときに選んだ分だけで、自動では送りません。
          </p>
          {/* Google Cloud の画面は階層が深く、毎回たどるのが手間なので直接飛べるようにする。
              リンク先は Google のコンソール。ここを押した時点では何も送らない。 */}
          <ol className="tp-steps">
            <li>
              <span className="tp-step-n tp-mono">1</span>
              <span>
                <b>Google Calendar API を有効にする</b>
                <a
                  className="tp-step-link"
                  href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  APIライブラリを開く
                  <Icon name="arrow" size={13} />
                </a>
              </span>
            </li>
            <li>
              <span className="tp-step-n tp-mono">2</span>
              <span>
                <b>OAuth 同意画面を作る</b>
                <small>自分だけで使うなら、対象は「外部」でテストユーザーに自分を入れる。</small>
                <a
                  className="tp-step-link"
                  href="https://console.cloud.google.com/auth/overview"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  同意画面を開く
                  <Icon name="arrow" size={13} />
                </a>
              </span>
            </li>
            <li>
              <span className="tp-step-n tp-mono">3</span>
              <span>
                <b>OAuth クライアントID（ウェブアプリケーション）を作る</b>
                <small>
                  承認済みの JavaScript 生成元に、下の値をそのまま入れる。
                </small>
                <span className="tp-origin">
                  <code className="tp-mono">{origin}</code>
                  <button
                    type="button"
                    className="tp-btn-ghost tp-origin-copy"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(origin)
                        onNotify('生成元をコピーしました')
                      } catch {
                        onNotify('コピーできませんでした。手で入力してください。', 'error')
                      }
                    }}
                  >
                    <Icon name="copy" size={14} />
                    コピー
                  </button>
                </span>
                <a
                  className="tp-step-link"
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  認証情報を開く
                  <Icon name="arrow" size={13} />
                </a>
              </span>
            </li>
            <li>
              <span className="tp-step-n tp-mono">4</span>
              <span>
                <b>できたクライアントIDを下に貼る</b>
                <small>IDはこの端末の中だけに保存します。リポジトリには入りません。</small>
              </span>
            </li>
          </ol>
          <label className="tp-field">
            <span className="tp-label">クライアントID</span>
            <input
              type="text"
              inputMode="url"
              placeholder="xxxxxxxx.apps.googleusercontent.com"
              value={draft.googleClientId}
              onChange={(e) => setDraft({ ...draft, googleClientId: e.target.value.trim() })}
            />
          </label>
          <label className="tp-field">
            <span className="tp-label">カレンダーID</span>
            <input
              type="text"
              placeholder="primary"
              value={draft.googleCalendarId}
              onChange={(e) => setDraft({ ...draft, googleCalendarId: e.target.value.trim() })}
            />
          </label>
          <p className={`tp-conn tp-conn-${connected ? 'on' : 'off'}`}>
            <Icon name={connected ? 'check' : 'alert'} size={14} />
            {connected ? '接続しています' : '接続していません'}
          </p>
          <div className="tp-row-end">
            {connected ? (
              <button
                type="button"
                className="tp-btn-ghost"
                onClick={() => {
                  disconnect()
                  setConnected(false)
                  onNotify('Googleとの接続を切りました')
                }}
              >
                接続を切る
              </button>
            ) : (
              <button
                type="button"
                className="tp-btn-ghost"
                disabled={!draft.googleClientId || connecting}
                onClick={async () => {
                  setConnecting(true)
                  try {
                    // 接続前に設定を確定させる（IDが未保存だと読み込みで使えない）
                    if (dirty) onSave(draft)
                    await acquireToken(draft.googleClientId, true)
                    setConnected(isConnected())
                    onNotify('Googleと接続しました')
                  } catch (err) {
                    onNotify(err instanceof Error ? err.message : 'Googleと接続できませんでした', 'error')
                  } finally {
                    setConnecting(false)
                  }
                }}
              >
                <Icon name="calendar" size={15} />
                {connecting ? '接続中…' : 'Googleと接続'}
              </button>
            )}
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
            <dd>端末内で文字に変換し、録音も端末内にだけ残します。外部には送信しません。</dd>
            <dt>解析</dt>
            <dd>端末内で完結します。外部のAIサービスには送りません。</dd>
            <dt>外部へ出るもの</dt>
            <dd>Googleカレンダーへ追加したタスクの件名とメモだけ。押したときに選んだ分のみです。</dd>
            <dt>版</dt>
            <dd className="tp-mono">Ver. {APP_VERSION}</dd>
            <dt>ビルド</dt>
            <dd className="tp-mono">{buildLabel()}</dd>
          </dl>
        </section>
      </Reveal>
    </div>
  )
}
