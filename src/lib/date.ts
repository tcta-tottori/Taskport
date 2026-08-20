/* =========================================================
 * 日付・時刻ユーティリティ
 *
 * アプリ内では日付を "YYYY-MM-DD"、時刻を "HH:mm" の文字列で扱う。
 * Date を使うのはこのファイルの中だけに閉じ込め、タイムゾーンの
 * 事故（UTC変換で1日ずれる）を外へ漏らさない。
 * =======================================================*/

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']

/** ローカル時刻での "YYYY-MM-DD" */
export function dayKey(d: Date | number = new Date()): string {
  const dt = typeof d === 'number' ? new Date(d) : d
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** ローカル時刻での "HH:mm" */
export function timeKey(d: Date | number = new Date()): string {
  const dt = typeof d === 'number' ? new Date(d) : d
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

/** "YYYY-MM-DD" をローカル正午の Date にする（正午にするのはDST境界の丸め事故を避けるため） */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

/**
 * ISO 8601 の瞬間を、**端末のローカル日付** "YYYY-MM-DD" にする。
 *
 * `iso.slice(0, 10)` で済ませてはいけない。ISO は UTC なので、日本時間の
 * 朝 8:20 に完了したタスクは "…T23:20:00Z"（前日）になり、その日の記録から
 * 消える。日付として使うときは必ずここを通す。
 */
export function dayOfIso(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : dayKey(d)
}

/** ISO 8601 の瞬間を、端末のローカル時刻 "HH:mm" にする。 */
export function timeOfIso(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : timeKey(d)
}

/** "YYYY-MM-DD" と "HH:mm" から、その瞬間の ISO を作る（ローカル時刻として解釈する） */
export function isoAt(day: string, hhmm: string, addMin = 0): string {
  const d = parseDayKey(day)
  const min = (toMinutes(hhmm) ?? 0) + addMin
  d.setHours(0, 0, 0, 0)
  d.setMinutes(min)
  return d.toISOString()
}

export function isDayKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

/**
 * 時刻の欄を空のまま押したときに入れる既定値。
 * 端末の選択画面は「いまの時刻」から始まるので、朝でも夜でも業務時間まで
 * 回すことになっていた。実際に入れる時刻はほぼ勤務時間の中なので、
 * 午前のいちばん使う時刻を既定にしてある。
 */
export const DEFAULT_TIME = '10:00'

export function isTimeKey(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}

/** "YYYY-MM-DD" に日数を足す */
export function addDaysKey(key: string, days: number): string {
  const d = parseDayKey(key)
  d.setDate(d.getDate() + days)
  return dayKey(d)
}

/** a - b の日数（a が後なら正） */
export function diffDays(a: string, b: string): number {
  const ms = parseDayKey(a).getTime() - parseDayKey(b).getTime()
  return Math.round(ms / 86_400_000)
}

/** 0=日 〜 6=土 */
export function weekdayOf(key: string): number {
  return parseDayKey(key).getDay()
}

/**
 * その週の頭（月曜）の日。工数の「今週」はここから7日ぶん。
 * 日曜始まりにしないのは、勤務が月〜金だから（週の途中で切れて見える）。
 */
export function startOfWeek(key: string): string {
  const wd = weekdayOf(key)
  // 0=日 なので、月曜まで戻るぶんは 日=6 / 月=0 / 火=1 …
  return addDaysKey(key, -((wd + 6) % 7))
}

export function weekdayLabel(key: string): string {
  return WEEKDAY_JA[weekdayOf(key)]
}

/** 「8/18（火）」 */
export function formatMD(key: string): string {
  const [, m, d] = key.split('-').map(Number)
  return `${m}/${d}（${weekdayLabel(key)}）`
}

/** 「8/18」 */
export function formatMDShort(key: string): string {
  const [, m, d] = key.split('-').map(Number)
  return `${m}/${d}`
}

/**
 * 一覧に出す期限の表示。今日を基準に相対で読めるようにする。
 * 超過は日数を明示する（「3日超過」）。
 */
export function dueLabel(due: string | null, today: string): string {
  if (!due) return '期限なし'
  const d = diffDays(due, today)
  if (d === 0) return '今日'
  if (d === 1) return '明日'
  if (d === 2) return '明後日'
  if (d < 0) return `${-d}日超過`
  if (d <= 7) return `${formatMDShort(due)}（あと${d}日）`
  return formatMD(due)
}

/* ---------------------------------------------------------
 * 時刻（分）
 * ------------------------------------------------------- */

/** "HH:mm" → 0時からの分。不正なら null */
export function toMinutes(hhmm: string): number | null {
  if (!isTimeKey(hhmm)) return null
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 分 → "HH:mm"（0〜1439 に丸める） */
export function fromMinutes(min: number): string {
  const v = Math.max(0, Math.min(1439, Math.round(min)))
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
}

/** 分数を「8時間05分」「45分」の形にする */
export function durationLabel(min: number): string {
  const v = Math.max(0, Math.round(min))
  const h = Math.floor(v / 60)
  const m = v % 60
  if (h === 0) return `${m}分`
  if (m === 0) return `${h}時間`
  return `${h}時間${String(m).padStart(2, '0')}分`
}

/**
 * 短い所要時間の表記（「15min」「1h」「1h30min」）。
 * 予定の行は件名を優先するので、時間は桁を食わない形で添える（v1.27.0。利用者の指示）。
 */
export function durationShort(min: number): string {
  const v = Math.max(0, Math.round(min))
  const h = Math.floor(v / 60)
  const m = v % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${m}min`
}

/** 直近 n 日ぶんの日付キー（古い順、末尾が today） */
export function lastNDays(today: string, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(addDaysKey(today, -i))
  return out
}

/* ---------------------------------------------------------
 * 月（カレンダーの月表示で使う）
 *
 * 月も文字列 "YYYY-MM" で持つ。Date を外へ出さない方針は同じ。
 * ------------------------------------------------------- */

/** "YYYY-MM-DD" → "YYYY-MM" */
export function monthKey(key: string = dayKey()): string {
  return key.slice(0, 7)
}

/** "YYYY-MM" に月数を足す */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1, 12, 0, 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 「2026年8月」 */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${y}年${m}月`
}

/** その月の日付をすべて（1日〜末日） */
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const out: string[] = []
  for (let d = 1; d <= last; d++) out.push(`${month}-${String(d).padStart(2, '0')}`)
  return out
}

/**
 * 月表示の升目。日曜始まりで6週（42日）ぶんを返す。
 * 常に同じ数にしておくと、月を送っても升目の高さが動かない。
 */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`
  const start = addDaysKey(first, -weekdayOf(first))
  const out: string[] = []
  for (let i = 0; i < 42; i++) out.push(addDaysKey(start, i))
  return out
}

/** その日付が month（"YYYY-MM"）の中か */
export function inMonth(key: string, month: string): boolean {
  return key.startsWith(month)
}

/** 秒数を「1:23:45」の形にする（動いている実行の経過を出す） */
export function clockLabel(sec: number): string {
  const v = Math.max(0, Math.floor(sec))
  const h = Math.floor(v / 3600)
  const m = Math.floor((v % 3600) / 60)
  const s = v % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}
