import { ulid } from './ulid'
import { diffDays, isDayKey, isTimeKey } from './date'
import { cleanCategories } from './workCategories'
import type { Draft, Priority, Source, Task } from '../types'

/* =========================================================
 * タスクの生成・並べ替え・絞り込み
 * =======================================================*/

const PRIORITY_RANK: Record<Priority, number> = { high: 0, mid: 1, low: 2 }

export function emptyDraft(source: Source = 'form'): Draft {
  return {
    tempId: ulid(),
    title: '',
    note: '',
    due: null,
    dueTime: null,
    estimateMin: null,
    startedAt: null,
    actualMin: null,
    priority: 'mid',
    categories: [],
    subtasks: [],
    timebox: null,
    repeat: null,
    source,
  }
}

/** Draft を保存できる Task にする。ここを通さずに Task を作らない。 */
export function draftToTask(draft: Draft): Task {
  const now = new Date().toISOString()
  return {
    id: ulid(),
    title: draft.title.trim(),
    note: draft.note.trim(),
    due: isDayKey(draft.due) ? draft.due : null,
    dueTime: isTimeKey(draft.dueTime) ? draft.dueTime : null,
    estimateMin:
      typeof draft.estimateMin === 'number' && draft.estimateMin > 0 ? draft.estimateMin : null,
    startedAt: draft.startedAt,
    actualMin:
      typeof draft.actualMin === 'number' && draft.actualMin > 0 ? Math.round(draft.actualMin) : null,
    priority: draft.priority,
    categories: cleanCategories(draft.categories),
    subtasks: draft.subtasks.filter((s) => s.title.trim()).map((s) => ({ ...s, title: s.title.trim() })),
    timebox: draft.timebox,
    // 期限が無くても持てる。起点は済ませた日になる（lib/repeat.ts）
    repeat: draft.repeat,
    status: 'open',
    source: draft.source,
    createdAt: now,
    updatedAt: now,
    doneAt: null,
  }
}

export function taskToDraft(task: Task): Draft {
  return {
    tempId: task.id,
    title: task.title,
    note: task.note,
    due: task.due,
    dueTime: task.dueTime,
    estimateMin: task.estimateMin,
    startedAt: task.startedAt,
    actualMin: task.actualMin,
    priority: task.priority,
    categories: [...task.categories],
    subtasks: task.subtasks,
    timebox: task.timebox,
    repeat: task.repeat,
    source: task.source,
  }
}

/** 期限昇順 → 優先度降順。期限なしは末尾。 */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.due !== b.due) {
      if (!a.due) return 1
      if (!b.due) return -1
      return a.due < b.due ? -1 : 1
    }
    if (a.dueTime !== b.dueTime) {
      if (!a.dueTime) return 1
      if (!b.dueTime) return -1
      return a.dueTime < b.dueTime ? -1 : 1
    }
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (p !== 0) return p
    return a.id < b.id ? -1 : 1
  })
}

/** 完了は新しい順（直近やったことから見たい） */
export function sortDone(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
}

export type ListTab = 'today' | 'week' | 'all' | 'done'

export const LIST_TABS: { key: ListTab; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '今週' },
  { key: 'all', label: 'すべて' },
  { key: 'done', label: '完了' },
]

/**
 * 一覧タブの絞り込み。
 *   今日 = 期限が今日以前の未完了（超過分を含む）
 *   今週 = 期限が7日以内の未完了
 */
export function filterByTab(tasks: Task[], tab: ListTab, today: string): Task[] {
  if (tab === 'done') return sortDone(tasks.filter((t) => t.status === 'done'))
  const open = tasks.filter((t) => t.status === 'open')
  if (tab === 'all') return sortTasks(open)
  if (tab === 'today') return sortTasks(open.filter((t) => !!t.due && diffDays(t.due, today) <= 0))
  return sortTasks(
    open.filter((t) => !!t.due && diffDays(t.due, today) >= 0 && diffDays(t.due, today) <= 7),
  )
}

/** 期限超過の日数。超過していなければ 0。 */
export function overdueDays(task: Task, today: string): number {
  if (!task.due || task.status === 'done') return 0
  const d = diffDays(today, task.due)
  return d > 0 ? d : 0
}

/** 日付ごとにまとめる。期限なしは undefined キーに落とさず、呼び出し側で別扱いにする。 */
export function groupByDue(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const t of tasks) {
    if (!t.due) continue
    const list = map.get(t.due)
    if (list) list.push(t)
    else map.set(t.due, [t])
  }
  for (const [, list] of map) list.sort((a, b) => (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99'))
  return map
}
