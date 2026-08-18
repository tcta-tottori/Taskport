import { dayKey, isDayKey, parseDayKey } from './date'
import { isWorkDay } from './workday'
import { EMPTY_WORK_CALENDAR, type WorkCalendar, type WorkHours } from '../types'

/* =========================================================
 * 会社カレンダー
 *
 * 曜日の設定（月〜金）だけでは、実際の勤務日と合わない。
 *   - 祝日・一斉有給・年末年始は平日でも休み
 *   - 土曜出勤の日もある
 * 会社が配る紙のカレンダーがその答えなので、実日付で持って上書きする。
 *
 * 判定の順は「出勤の指定 → 休みの指定 → 曜日」。
 * 出勤を先に見るのは、休みの週に1日だけ出る、が表せるようにするため。
 * =======================================================*/

/** その日の扱い。画面の色分けに使う。 */
export type DayKind =
  /** 会社カレンダーで休みにした日 */
  | 'holiday'
  /** 会社カレンダーで出勤にした日（土曜出勤など） */
  | 'workday'
  /** 曜日の設定どおり（指定なし） */
  | 'normal'

export function dayKindOf(day: string, cal?: WorkCalendar | null): DayKind {
  if (!cal) return 'normal'
  if (cal.workdays.includes(day)) return 'workday'
  if (cal.holidays.includes(day)) return 'holiday'
  return 'normal'
}

/**
 * 1日ぶんの指定を切り替える。
 *   指定なし → 休み → 出勤 → 指定なし
 * 紙のカレンダーを見ながら順に押していけるように、1つのボタンで回す。
 */
export function cycleDay(cal: WorkCalendar, day: string, now = new Date().toISOString()): WorkCalendar {
  const kind = dayKindOf(day, cal)
  const holidays = cal.holidays.filter((d) => d !== day)
  const workdays = cal.workdays.filter((d) => d !== day)
  if (kind === 'normal') holidays.push(day)
  else if (kind === 'holiday') workdays.push(day)
  // 'workday' のときは、どちらにも入れない（指定なしへ戻る）
  return {
    ...cal,
    holidays: holidays.sort(),
    workdays: workdays.sort(),
    updatedAt: now,
  }
}

/** まとめて休みにする／出勤にする（取り込みで使う） */
export function setDays(
  cal: WorkCalendar,
  days: string[],
  kind: DayKind,
  now = new Date().toISOString(),
): WorkCalendar {
  const set = new Set(days.filter(isDayKey))
  const holidays = cal.holidays.filter((d) => !set.has(d))
  const workdays = cal.workdays.filter((d) => !set.has(d))
  if (kind === 'holiday') holidays.push(...set)
  if (kind === 'workday') workdays.push(...set)
  return {
    ...cal,
    holidays: [...new Set(holidays)].sort(),
    workdays: [...new Set(workdays)].sort(),
    updatedAt: now,
  }
}

/** その年の稼働日数と休日数。会社カレンダーの紙と突き合わせて確かめるために出す。 */
export function yearCount(
  year: number,
  wh: WorkHours,
  cal?: WorkCalendar | null,
): { work: number; off: number; days: number } {
  let work = 0
  let days = 0
  const d = new Date(year, 0, 1, 12, 0, 0, 0)
  while (d.getFullYear() === year) {
    days++
    if (isWorkDay(dayKey(d), wh, cal)) work++
    d.setDate(d.getDate() + 1)
  }
  return { work, off: days - work, days }
}

/** 月の日付を並べる（週の頭は月曜。会社カレンダーの紙と同じ並び） */
export function monthGrid(year: number, month1: number): (string | null)[] {
  const first = new Date(year, month1 - 1, 1, 12, 0, 0, 0)
  const lead = (first.getDay() + 6) % 7 // 月曜起点
  const last = new Date(year, month1, 0, 12, 0, 0, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let i = 1; i <= last; i++) cells.push(dayKey(new Date(year, month1 - 1, i, 12)))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/** 月を1つ進める／戻す */
export function shiftMonth(year: number, month1: number, by: number): { year: number; month1: number } {
  const d = new Date(year, month1 - 1 + by, 1, 12)
  return { year: d.getFullYear(), month1: d.getMonth() + 1 }
}

/* ---------------------------------------------------------
 * Googleカレンダーからの取り込み
 * ------------------------------------------------------- */

/**
 * 予定の件名から休み／出勤を見当づける。
 * 当てられないものは 'normal'（＝人が選ぶ）。推測で埋めない。
 */
const HOLIDAY_WORDS = [
  // 会社が付けがちな言い方
  '休', '祝', '有給', '年末年始', '夏季', '冬季', 'GW', 'ゴールデンウィーク', '盆', '振替',
  // 祝日の名前そのもの（Googleの「日本の祝日」カレンダーはこの形で入る）。
  // 「休」の字が入らないので、名前で当てないと拾えない。
  '元日', '成人の日', '建国記念の日', '天皇誕生日', '春分の日', '昭和の日',
  '憲法記念日', 'みどりの日', 'こどもの日', '海の日', '山の日', '敬老の日',
  '秋分の日', 'スポーツの日', '体育の日', '文化の日', '勤労感謝の日', '国民の休日',
]
const WORKDAY_WORDS = ['出勤', '出社', '稼働', '所定労働']

export function guessKind(title: string): DayKind {
  const t = title.trim()
  if (!t) return 'normal'
  if (WORKDAY_WORDS.some((w) => t.includes(w))) return 'workday'
  if (HOLIDAY_WORDS.some((w) => t.includes(w))) return 'holiday'
  return 'normal'
}

/** 取り込み候補の1日ぶん */
export interface CalendarDay {
  day: string
  /** その日にあった終日予定の件名（複数あれば連結） */
  title: string
  kind: DayKind
}

/**
 * 終日予定の一覧を、日付ごとの候補にまとめる。
 * 同じ日に複数あれば件名をつなぎ、休みの語が1つでもあれば休み扱いにする。
 */
export function toCalendarDays(
  events: { day: string; endDay?: string | null; title: string; allDay: boolean }[],
): CalendarDay[] {
  const byDay = new Map<string, string[]>()
  for (const e of events) {
    if (!e.allDay || !isDayKey(e.day)) continue
    // 終日予定は複数日にまたがることがある（年末年始など）
    const from = parseDayKey(e.day)
    const to = e.endDay && isDayKey(e.endDay) ? parseDayKey(e.endDay) : from
    // Google の終日予定の終わりは「翌日」なので、1日戻して閉区間にする
    if (e.endDay) to.setDate(to.getDate() - 1)
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const k = dayKey(d)
      byDay.set(k, [...(byDay.get(k) ?? []), e.title])
      if (byDay.size > 800) break // 取りすぎない
    }
  }
  return [...byDay.entries()]
    .map(([day, titles]) => {
      const title = [...new Set(titles)].join(' / ')
      const kinds = titles.map(guessKind)
      const kind: DayKind = kinds.includes('holiday')
        ? 'holiday'
        : kinds.includes('workday')
          ? 'workday'
          : 'normal'
      return { day, title, kind }
    })
    .sort((a, b) => (a.day < b.day ? -1 : 1))
}

/** 保存されたものを現行の形へ寄せる（古い保存や取り込みで欠けていても壊れない） */
export function normalizeCalendar(raw: unknown): WorkCalendar {
  if (typeof raw !== 'object' || raw === null) return EMPTY_WORK_CALENDAR
  const o = raw as Record<string, unknown>
  const days = (v: unknown) => (Array.isArray(v) ? v.filter(isDayKey) : [])
  return {
    holidays: days(o.holidays),
    workdays: days(o.workdays),
    sourceCalendarId: typeof o.sourceCalendarId === 'string' ? o.sourceCalendarId : '',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : EMPTY_WORK_CALENDAR.updatedAt,
  }
}
