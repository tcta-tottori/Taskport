import { toMinutes } from '../../lib/date'
import type { Task, WorkHours } from '../../types'

/* =========================================================
 * 出口: Googleカレンダー / ICS
 *
 * Task[] を受け取る純関数。React に依存させない。
 * 時刻なしのタスクは終日予定として扱う。
 * =======================================================*/

/** "YYYY-MM-DD" → "YYYYMMDD" */
function compactDate(day: string): string {
  return day.replace(/-/g, '')
}

/** ローカル時刻の "YYYYMMDDTHHMMSS"（TZ指定なし＝端末のローカル時刻として解釈される） */
function localStamp(day: string, minutes: number): string {
  const h = String(Math.floor(minutes / 60) % 24).padStart(2, '0')
  const m = String(minutes % 60).padStart(2, '0')
  return `${compactDate(day)}T${h}${m}00`
}

function nextDay(day: string): string {
  const [y, mo, d] = day.split('-').map(Number)
  const dt = new Date(y, mo - 1, d + 1, 12)
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`
}

interface Span {
  start: string
  end: string
  allDay: boolean
}

/**
 * タスクの開始・終了を決める。
 *   時刻あり → その時刻から見込み所要時間ぶん（未見積は既定値）
 *   時刻なし → 終日予定（Google/ICS とも終了日は翌日を指す）
 */
function spanOf(task: Task, defaultEstimateMin: number): Span | null {
  if (!task.due) return null
  const from = task.dueTime ? toMinutes(task.dueTime) : null
  if (from === null) {
    return { start: compactDate(task.due), end: nextDay(task.due), allDay: true }
  }
  const dur = task.estimateMin && task.estimateMin > 0 ? task.estimateMin : defaultEstimateMin
  return { start: localStamp(task.due, from), end: localStamp(task.due, from + dur), allDay: false }
}

function detailOf(task: Task): string {
  const lines = [task.note]
  if (task.categories.length > 0) lines.push(`区分: ${task.categories.join(' / ')}`)
  lines.push(`優先度: ${task.priority}`)
  lines.push('Taskport から書き出し')
  return lines.filter(Boolean).join('\n')
}

/** 単発登録用のGoogleカレンダーURL。期限なしのタスクは登録できないので null。 */
export function toGoogleCalendarUrl(task: Task, defaultEstimateMin: number): string | null {
  const span = spanOf(task, defaultEstimateMin)
  if (!span) return null
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: task.title,
    dates: `${span.start}/${span.end}`,
    details: detailOf(task),
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** ICS の仕様上エスケープが要る文字 */
function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/** 75オクテット折り返し。長い件名でカレンダー側が壊れるのを防ぐ。 */
function fold(line: string): string {
  if (line.length <= 73) return line
  const parts: string[] = []
  let rest = line
  parts.push(rest.slice(0, 73))
  rest = rest.slice(73)
  while (rest.length > 72) {
    parts.push(' ' + rest.slice(0, 72))
    rest = rest.slice(72)
  }
  if (rest) parts.push(' ' + rest)
  return parts.join('\r\n')
}

/** 選んだタスクをまとめて .ics にする。カレンダー側でインポートして使う。 */
export function toIcs(tasks: Task[], defaultEstimateMin: number): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Taskport//JA//',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  for (const task of tasks) {
    const span = spanOf(task, defaultEstimateMin)
    if (!span) continue
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${task.id}@taskport`)
    lines.push(`DTSTAMP:${stamp}`)
    if (span.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${span.start}`)
      lines.push(`DTEND;VALUE=DATE:${span.end}`)
    } else {
      lines.push(`DTSTART:${span.start}`)
      lines.push(`DTEND:${span.end}`)
    }
    lines.push(fold(`SUMMARY:${esc(task.title)}`))
    const detail = detailOf(task)
    if (detail) lines.push(fold(`DESCRIPTION:${esc(detail)}`))
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/**
 * 勤務時間そのものをカレンダーに置くための1日ぶんの ICS。
 * 「始業・昼休憩・終業」を見える形で共有したいときに使う。
 */
export function workHoursIcs(day: string, wh: WorkHours): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const ev = (uid: string, summary: string, from: string, to: string): string[] => {
    const f = toMinutes(from)
    const t = toMinutes(to)
    if (f === null || t === null) return []
    return [
      'BEGIN:VEVENT',
      `UID:${uid}-${day}@taskport`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${localStamp(day, f)}`,
      `DTEND:${localStamp(day, t)}`,
      `SUMMARY:${esc(summary)}`,
      'END:VEVENT',
    ]
  }
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Taskport//JA//',
    ...ev('work-am', '勤務（午前）', wh.start, wh.breakStart),
    ...ev('lunch', '昼休憩', wh.breakStart, wh.breakEnd),
    ...ev('work-pm', '勤務（午後）', wh.breakEnd, wh.end),
    'END:VCALENDAR',
  ].join('\r\n')
}
