import { diffDays } from './date'
import { sortDone, sortTasks } from './tasks'
import { groupOf } from './workCategories'
import {
  PRIORITY_LABEL,
  type CategoryGroup,
  type DueRange,
  type Task,
  type TaskFilter,
} from '../types'

/* =========================================================
 * 検索と絞り込み
 *
 * タブ（今日/今週/すべて/完了）は「いつやるか」で切る道具で、
 * 「あの件どうなったか」を探すのには向かない。台帳が数百件になると
 * タブだけでは目的の1件に届かなくなるので、横断で探す道を別に置く。
 *
 * ここは純関数だけ。React にも保存層にも依存させない。
 * =======================================================*/

export const DUE_RANGES: { key: DueRange; label: string }[] = [
  { key: 'any', label: 'すべて' },
  { key: 'overdue', label: '超過' },
  { key: 'today', label: '今日' },
  { key: 'week', label: '7日以内' },
  { key: 'later', label: 'それ以降' },
  { key: 'none', label: '期限なし' },
]

export const EMPTY_FILTER: TaskFilter = {
  q: '',
  groups: [],
  priorities: [],
  due: 'any',
  includeDone: false,
}

/**
 * 検索用に文字をならす。
 * 全角英数と半角カナの揺れ（NFKC）と大文字小文字だけを吸収する。
 * ひらがな⇄カタカナまでは寄せない（「はい」と「ハイ」は別語のことが多い）。
 */
function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase()
}

/** 語がすべて含まれるか（AND）。手順の中の語も探せる。 */
function matchQuery(task: Task, q: string): boolean {
  const terms = norm(q).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const hay = norm(
    `${task.title} ${task.note} ${task.categories.join(' ')} ${task.subtasks
      .map((s) => s.title)
      .join(' ')}`,
  )
  return terms.every((t) => hay.includes(t))
}

function matchDue(task: Task, range: DueRange, today: string): boolean {
  if (range === 'any') return true
  if (range === 'none') return !task.due
  if (!task.due) return false
  const d = diffDays(task.due, today) // 期限が今日より後なら正
  if (range === 'overdue') return d < 0 && task.status === 'open'
  if (range === 'today') return d === 0
  if (range === 'week') return d >= 0 && d <= 7
  return d > 7 // later
}

/** 何か絞り込んでいるか。false のときは一覧タブをそのまま出す。 */
export function isFilterActive(f: TaskFilter): boolean {
  return (
    f.q.trim() !== '' ||
    f.groups.length > 0 ||
    f.priorities.length > 0 ||
    f.due !== 'any' ||
    f.includeDone
  )
}

/** 絞り込みの条件数。ボタンの脇に出す数字。 */
export function activeCount(f: TaskFilter): number {
  return (
    (f.q.trim() ? 1 : 0) +
    f.groups.length +
    f.priorities.length +
    (f.due !== 'any' ? 1 : 0) +
    (f.includeDone ? 1 : 0)
  )
}

/** タスクが属するグループ名（重複なし）。区分が無いときは「未分類」1つ。 */
export function groupsOfTask(task: Task, groups: CategoryGroup[]): string[] {
  if (task.categories.length === 0) return [groupOf(groups, '')]
  return [...new Set(task.categories.map((c) => groupOf(groups, c)))]
}

/**
 * 絞り込みを当てる。未完了を先に、完了を後ろに並べる。
 * 完了は includeDone のときだけ混ざる。
 */
export function applyFilter(
  tasks: Task[],
  f: TaskFilter,
  today: string,
  groups: CategoryGroup[],
): Task[] {
  const hit = tasks.filter((t) => {
    if (!f.includeDone && t.status === 'done') return false
    if (!matchQuery(t, f.q)) return false
    // 区分は複数あるので、どれか1つでも当たれば残す
    if (
      f.groups.length > 0 &&
      !groupsOfTask(t, groups).some((g) => f.groups.includes(g))
    )
      return false
    if (f.priorities.length > 0 && !f.priorities.includes(t.priority)) return false
    if (!matchDue(t, f.due, today)) return false
    return true
  })
  return [
    ...sortTasks(hit.filter((t) => t.status === 'open')),
    ...sortDone(hit.filter((t) => t.status === 'done')),
  ]
}

/** 保存するときの既定の名前。条件をそのまま日本語にする。 */
export function filterLabel(f: TaskFilter): string {
  const parts: string[] = []
  if (f.q.trim()) parts.push(`「${f.q.trim()}」`)
  if (f.groups.length > 0) parts.push(f.groups.join('・'))
  if (f.priorities.length > 0) parts.push(f.priorities.map((p) => `優先${PRIORITY_LABEL[p]}`).join('・'))
  if (f.due !== 'any') parts.push(DUE_RANGES.find((r) => r.key === f.due)?.label ?? '')
  if (f.includeDone) parts.push('完了も')
  return parts.filter(Boolean).join(' / ') || 'すべて'
}

/** 保存済みの条件と同じか（同じものを二重に保存させないため） */
export function sameFilter(a: TaskFilter, b: TaskFilter): boolean {
  const key = (f: TaskFilter) =>
    JSON.stringify([f.q.trim(), [...f.groups].sort(), [...f.priorities].sort(), f.due, f.includeDone])
  return key(a) === key(b)
}
