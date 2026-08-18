import { googleFetch } from '../../lib/googleAuth'
import { toMinutes } from '../../lib/date'
import type { Task } from '../../types'

/* =========================================================
 * 出口: Googleカレンダーへ予定を追加する
 *
 * ここだけはタスクの内容（件名・メモ）が Google へ渡る。
 * 利用者が選んだ分だけを、押したときにだけ送る。自動送信はしない。
 * =======================================================*/

const API = 'https://www.googleapis.com/calendar/v3'

/** "YYYY-MM-DD" に1日足す（終日予定の終了日は翌日を指すため） */
function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d + 1, 12)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function localIso(day: string, minutes: number): string {
  const h = String(Math.floor(minutes / 60) % 24).padStart(2, '0')
  const m = String(minutes % 60).padStart(2, '0')
  return `${day}T${h}:${m}:00`
}

export interface PushResult {
  ok: number
  failed: { title: string; reason: string }[]
  /** 期限が無くて送れなかった件数 */
  skipped: number
}

/**
 * 選んだタスクを予定として追加する。
 * 時刻なしのタスクは終日予定にする。期限が無いものは送れないので飛ばす。
 */
export async function pushTasks(
  clientId: string,
  calendarId: string,
  tasks: Task[],
  defaultEstimateMin: number,
): Promise<PushResult> {
  const result: PushResult = { ok: 0, failed: [], skipped: 0 }
  const base = `${API}/calendars/${encodeURIComponent(calendarId || 'primary')}/events`
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'

  for (const task of tasks) {
    if (!task.due) {
      result.skipped++
      continue
    }
    const from = task.dueTime ? toMinutes(task.dueTime) : null
    const body =
      from === null
        ? {
            summary: task.title,
            description: buildDescription(task),
            start: { date: task.due },
            end: { date: nextDay(task.due) },
          }
        : {
            summary: task.title,
            description: buildDescription(task),
            start: { dateTime: localIso(task.due, from), timeZone: tz },
            end: {
              dateTime: localIso(task.due, from + (task.estimateMin && task.estimateMin > 0 ? task.estimateMin : defaultEstimateMin)),
              timeZone: tz,
            },
          }
    try {
      const res = await googleFetch(clientId, base, { method: 'POST', body: JSON.stringify(body) })
      if (res.ok) {
        result.ok++
      } else {
        result.failed.push({ title: task.title, reason: `HTTP ${res.status}` })
      }
    } catch (err) {
      result.failed.push({ title: task.title, reason: err instanceof Error ? err.message : '不明なエラー' })
    }
  }
  return result
}

function buildDescription(task: Task): string {
  const lines = [task.note]
  if (task.category) lines.push(`区分: ${task.category}`)
  lines.push(`優先度: ${task.priority}`)
  lines.push('Taskport から追加')
  return lines.filter(Boolean).join('\n')
}
