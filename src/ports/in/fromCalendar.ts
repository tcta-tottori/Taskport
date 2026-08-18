import { googleFetch } from '../../lib/googleAuth'
import { dayKey, isDayKey, isTimeKey } from '../../lib/date'
import { emptyDraft } from '../../lib/tasks'
import type { CalendarEvent, Draft } from '../../types'

/* =========================================================
 * 入口: Googleカレンダーの予定を読む
 *
 * 読んだ予定は台帳（タスク）に混ぜない。スケジュール画面に重ねて
 * 「その日はもう埋まっている」ことを見せるために使う。
 * タスクにしたいものは、確認のうえで1件ずつ取り込む。
 * =======================================================*/

const API = 'https://www.googleapis.com/calendar/v3'

interface RawEventTime {
  date?: string
  dateTime?: string
}
interface RawEvent {
  id?: string
  summary?: string
  location?: string
  htmlLink?: string
  status?: string
  start?: RawEventTime
  end?: RawEventTime
}

function localDayKey(iso: string): string {
  return dayKey(new Date(iso))
}

function localTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 返ってきた値は信用しない。形が合わないものは捨てる。 */
function toEvent(raw: unknown): CalendarEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as RawEvent
  if (o.status === 'cancelled') return null
  const id = typeof o.id === 'string' ? o.id : ''
  if (!id) return null
  const title = (typeof o.summary === 'string' ? o.summary : '').trim() || '（件名なし）'

  const s = o.start ?? {}
  const e = o.end ?? {}
  if (typeof s.date === 'string' && isDayKey(s.date)) {
    return {
      id,
      title,
      day: s.date,
      endDay: typeof e.date === 'string' && isDayKey(e.date) ? e.date : null,
      startTime: null,
      endTime: null,
      allDay: true,
      location: typeof o.location === 'string' ? o.location : '',
      htmlLink: typeof o.htmlLink === 'string' ? o.htmlLink : '',
    }
  }
  if (typeof s.dateTime === 'string') {
    const day = localDayKey(s.dateTime)
    const startTime = localTime(s.dateTime)
    const endTime = typeof e.dateTime === 'string' ? localTime(e.dateTime) : null
    if (!isDayKey(day) || !isTimeKey(startTime)) return null
    return {
      id,
      title,
      day,
      endDay: null,
      startTime,
      endTime: endTime && isTimeKey(endTime) ? endTime : null,
      allDay: false,
      location: typeof o.location === 'string' ? o.location : '',
      htmlLink: typeof o.htmlLink === 'string' ? o.htmlLink : '',
    }
  }
  return null
}

/**
 * 期間内の予定を読む。
 * @param from "YYYY-MM-DD"（この日の 00:00 から）
 * @param to   "YYYY-MM-DD"（この日の 23:59 まで）
 */
export async function fetchEvents(
  clientId: string,
  calendarId: string,
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  const timeMin = new Date(`${from}T00:00:00`).toISOString()
  const timeMax = new Date(`${to}T23:59:59`).toISOString()
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true', // 繰り返しは1件ずつに展開して受け取る
    orderBy: 'startTime',
    maxResults: '250',
  })
  const url = `${API}/calendars/${encodeURIComponent(calendarId || 'primary')}/events?${params.toString()}`
  const res = await googleFetch(clientId, url)
  if (!res.ok) {
    if (res.status === 404) throw new Error('カレンダーが見つかりません。カレンダーIDを確認してください。')
    if (res.status === 403) throw new Error('カレンダーを読む権限がありません。接続し直してください。')
    throw new Error(`カレンダーを読めませんでした（HTTP ${res.status}）。`)
  }
  const payload: unknown = await res.json()
  const items =
    typeof payload === 'object' && payload !== null && Array.isArray((payload as { items?: unknown }).items)
      ? ((payload as { items: unknown[] }).items)
      : []
  return items.map(toEvent).filter((e): e is CalendarEvent => e !== null)
}

/**
 * 予定をタスク候補にする。
 * 予定はすでに時間が押さえてあるので、見込み時間は予定の長さをそのまま入れる。
 * 必ず確認画面を通してから登録する（AIの候補と同じ扱い）。
 */
export function eventToDraft(ev: CalendarEvent): Draft {
  const minutes = (() => {
    if (ev.allDay || !ev.startTime || !ev.endTime) return null
    const [sh, sm] = ev.startTime.split(':').map(Number)
    const [eh, em] = ev.endTime.split(':').map(Number)
    const d = eh * 60 + em - (sh * 60 + sm)
    return d > 0 ? d : null
  })()
  return {
    ...emptyDraft('calendar'),
    title: ev.title,
    note: ev.location ? `場所: ${ev.location}` : '',
    due: ev.day,
    dueTime: ev.startTime,
    estimateMin: minutes,
    categories: ['打合せ、来客対応'],
    priority: 'mid',
  }
}
