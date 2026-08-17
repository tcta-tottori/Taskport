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

export function isDayKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

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

/** 直近 n 日ぶんの日付キー（古い順、末尾が today） */
export function lastNDays(today: string, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(addDaysKey(today, -i))
  return out
}
