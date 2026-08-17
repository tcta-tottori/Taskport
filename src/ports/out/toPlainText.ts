import { dayKey, formatMD, formatMDShort } from '../../lib/date'
import { sortTasks } from '../../lib/tasks'
import type { Task } from '../../types'

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
  const doneToday = tasks.filter((t) => t.status === 'done' && (t.doneAt ?? '').slice(0, 10) === today)
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
