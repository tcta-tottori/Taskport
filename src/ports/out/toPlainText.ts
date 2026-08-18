import { dayKey, dayOfIso, formatMD, formatMDShort, fromMinutes, toMinutes } from '../../lib/date'
import { sortTasks } from '../../lib/tasks'
import { trim, workSegments } from '../../lib/workday'
import { primaryCategory } from '../../lib/workCategories'
import { loggedMinutes, logStartTime, ofDay } from '../../lib/worklog'
import type { Task, WorkHours } from '../../types'

/* =========================================================
 * 出口: 日報・朝会用のプレーンテキスト
 *
 * Task[] を受け取る純関数。そのまま貼れる形にして返す。
 * =======================================================*/

/**
 * 日報用。
 *
 *   【8/18（火）実施】
 *   ・サンプル商事に注残8000本の前倒し可否を確認 → 完了
 *   ・パレット稟議書を仕上げる
 *
 *   【翌日以降】
 *   ・8/20 サンプル物流へ納期回答
 */
export function toDailyReport(tasks: Task[], today = dayKey()): string {
  const doneToday = tasks.filter((t) => t.status === 'done' && dayOfIso(t.doneAt) === today)
  const openToday = sortTasks(tasks.filter((t) => t.status === 'open' && t.due === today))
  const ahead = sortTasks(tasks.filter((t) => t.status === 'open' && !!t.due && t.due > today))
  const overdue = sortTasks(tasks.filter((t) => t.status === 'open' && !!t.due && t.due < today))

  const blocks: string[] = []

  const line = (t: Task, suffix = ''): string => `・${t.title}${suffix}`

  const todaySection = [
    ...doneToday.map((t) => line(t, ' → 完了')),
    ...openToday.map((t) => line(t)),
  ]
  blocks.push(`【${formatMD(today)}実施】\n${todaySection.length ? todaySection.join('\n') : '・（なし）'}`)

  if (overdue.length > 0) {
    blocks.push(
      `【期限超過】\n${overdue.map((t) => `・${formatMDShort(t.due as string)} ${t.title}`).join('\n')}`,
    )
  }
  if (ahead.length > 0) {
    blocks.push(
      `【翌日以降】\n${ahead
        .slice(0, 20)
        .map((t) => `・${formatMDShort(t.due as string)}${t.dueTime ? ` ${t.dueTime}` : ''} ${t.title}`)
        .join('\n')}`,
    )
  }
  return blocks.join('\n\n')
}

/** 朝会用。今日やることだけを優先度つきで並べる。 */
export function toStandupText(tasks: Task[], today = dayKey()): string {
  const targets = sortTasks(
    tasks.filter((t) => t.status === 'open' && !!t.due && t.due <= today),
  )
  if (targets.length === 0) return `【${formatMD(today)}】\n・本日の期限タスクなし`
  const mark: Record<Task['priority'], string> = { high: '[高]', mid: '[中]', low: '[低]' }
  return `【${formatMD(today)}】\n${targets
    .map((t) => `・${mark[t.priority]} ${t.title}${t.dueTime ? `（${t.dueTime}）` : ''}`)
    .join('\n')}`
}

/** 選んだタスクだけを素の箇条書きにする（メールに貼る用途） */
export function toBulletList(tasks: Task[]): string {
  return sortTasks(tasks)
    .map((t) => {
      const head = t.due ? `${formatMDShort(t.due)}${t.dueTime ? ` ${t.dueTime}` : ''} ` : ''
      const note = t.note ? `（${t.note}）` : ''
      return `・${head}${t.title}${note}`
    })
    .join('\n')
}

/* =========================================================
 * 出口: 業務日報（エクセル貼り付け用）
 *
 * 実際に使っている資材課日報と同じ「30分枠 × 時間／業務内容／詳細内容」
 * の並びで書き出す。タブ区切りなので、日報シートにそのまま貼れる。
 *
 * 枠は勤務時間の設定から作る（小休憩と昼休憩は枠を作らない）。
 * 時刻の入っているタスクをその枠に置き、時刻なしのタスクは空き枠へ
 * 上から詰める。埋まらなかった枠は空欄のままにする（勝手に埋めない）。
 *
 * 拾うのは**その日の記録**（`worklog.ofDay`）。完了した日で見るので、
 * 昨日ぶんを今朝片づけた1件も今日の日報に出る。長さは実績があれば実績、
 * 無ければ見込みを使う。
 * =======================================================*/

/** 30分枠を作る。休憩は挟まない。 */
export function workSlots(wh: WorkHours, slotMin = 30): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  for (const seg of workSegments(wh)) {
    for (let t = seg.from; t + slotMin <= seg.to; t += slotMin) {
      out.push({ from: t, to: t + slotMin })
    }
    // 端数（30分に満たない残り）も1枠として出す
    const rest = (seg.to - seg.from) % slotMin
    if (rest > 0) out.push({ from: seg.to - rest, to: seg.to })
  }
  return out.sort((a, b) => a.from - b.from)
}

export interface WorkLogRow {
  /** "8:20～8:50" */
  time: string
  /** 業務内容（区分） */
  category: string
  /** 詳細内容 */
  detail: string
}

/**
 * その日の日報の行を作る。
 * 時刻のあるタスクは該当枠へ、時刻なしは空き枠へ上から詰める。
 */
export function toWorkLogRows(
  tasks: Task[],
  day: string,
  wh: WorkHours,
  defaultEstimateMin: number,
): WorkLogRow[] {
  const slots = workSlots(wh)
  const rows: WorkLogRow[] = slots.map((s) => ({
    time: `${trim(fromMinutes(s.from))}～${trim(fromMinutes(s.to))}`,
    category: '',
    detail: '',
  }))

  const mine = ofDay(tasks, day)
  const timed = mine.filter((t) => logStartTime(t) !== null)
  const untimed = sortTasks(mine.filter((t) => logStartTime(t) === null))

  const fill = (index: number, task: Task) => {
    if (index < 0 || index >= rows.length || rows[index].detail) return false
    rows[index] = {
      time: rows[index].time,
      // 日報の1行に入るのは1つだけ。主区分（先頭）を書く
      category: primaryCategory(task.categories),
      detail: task.note ? `${task.title}（${task.note}）` : task.title,
    }
    return true
  }

  // 時刻のあるものを先に置く。長いタスクは続く枠も埋める。
  for (const t of timed) {
    const from = toMinutes(logStartTime(t) as string)
    if (from === null) continue
    const start = slots.findIndex((s) => from >= s.from && from < s.to)
    if (start < 0) continue
    const span = Math.max(1, Math.ceil(loggedMinutes(t, defaultEstimateMin) / 30))
    for (let i = 0; i < span; i++) fill(start + i, t)
  }
  // 時刻なしは空いている枠へ上から詰める
  let cursor = 0
  for (const t of untimed) {
    while (cursor < rows.length && rows[cursor].detail) cursor++
    if (cursor >= rows.length) break
    fill(cursor, t)
  }
  return rows
}

/** 日報シートにそのまま貼れるタブ区切りテキスト */
export function toWorkLogTsv(
  tasks: Task[],
  day: string,
  wh: WorkHours,
  defaultEstimateMin: number,
): string {
  return toWorkLogRows(tasks, day, wh, defaultEstimateMin)
    .map((r) => [r.time, r.category, r.detail].join('\t'))
    .join('\n')
}
